// Sea creatures for naval battles: sculpted, rigged and animated in code.
//
//   creatures[def.model](def)            -> a rigged model (rigkit.cloneRigged of a cached template),
//                                           head toward +X, waterline at y = 0, sized by def.size
//   animators[kind](model, { t, phase }) -> poses model.userData.rig each frame
//
// Every creature is authored like a unit, facing +Z and mirrored across X = 0, in a
// normalised space where the body fits a circle of radius ~1.3; a root node turned 90
// degrees points the head down +X and assemble() scales the whole thing by def.size.
// Thin parts (fins, legs, fingers, spines) are hard pieces so they survive at every
// detail level; flesh and shell are sculpted prims with relief.
import * as THREE from 'three';
import { S, H, noise3, distanceTo, buildPartGeometry } from '../sculpt.js';
import { assemble, cloneRigged, getDetail } from '../rigkit.js';
import { install as installDeepkin } from './deepkin.js';

const DEG = Math.PI / 180, PI = Math.PI;
const _c = new THREE.Color(), _c2 = new THREE.Color();
/** shift a colour in hue / saturation / lightness */
function tone(hex, dh = 0, ds = 0, dl = 0) { return _c.set(hex).offsetHSL(dh, ds, dl).getHex(); }
function mix(a, b, t) { return _c.set(a).lerp(_c2.set(b), t).getHex(); }
/** deterministic 0..1 from two integers */
const rnd = (i, k = 0) => noise3(i * 7 + 3, k * 13 + 5, 11);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

/** move a finished list of prims / hard pieces (authored in creature space) into a node whose origin is `o` */
function into(o, list) { for (const p of list.flat(Infinity)) if (p) p.at(-o[0], -o[1], -o[2]); return list; }

// ---------- custom geometry ----------
/** skin a stack of closed rings ([[x,y,z] * n] per ring) into a solid with outward faces */
function loft(rings, capA = true, capB = true) {
  const n = rings[0].length, m = rings.length, pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  for (let i = 0; i < m - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + ((j + 1) % n), c = (i + 1) * n + ((j + 1) % n), d = (i + 1) * n + j;
    idx.push(a, b, c, a, c, d);
  }
  const cap = (ri, flip) => {
    const r = rings[ri], base = ri * n, ci = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (const p of r) { cx += p[0]; cy += p[1]; cz += p[2]; }
    pos.push(cx / n, cy / n, cz / n);
    for (let j = 0; j < n; j++) { const a = base + j, b = base + ((j + 1) % n); if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
  };
  if (capA) cap(0, true);
  if (capB) cap(m - 1, false);
  // make the faces point outward whichever way the rings were wound
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) + pos[a + 1] * (pos[b + 2] * pos[c] - pos[b] * pos[c + 2]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A solid fin. The root runs along Z on the plane y = 0 (leading edge toward +Z), the span rises +Y and the
 * thickness is along X. chord = root length, tip = tip chord as a fraction, sweep = how far the tip trails
 * (in spans), thick = thickness as a fraction of chord, notch = [v, depth, width] bite out of the trailing edge.
 */
function bladeGeo(o) {
  const { span, chord, tip = 0.3, sweep = 0.6, thick = 0.1, rows = 9, seg = 7, falcate = 0, notch = null, lean = 0 } = o;
  const rings = [];
  for (let r = 0; r <= rows; r++) {
    const v = (r / rows) * 0.985;
    const c = chord * (tip * (1 - v * 0.6) + (1 - tip) * Math.pow(1 - v, 0.85 + falcate));
    const le = chord * 0.5 - sweep * span * Math.pow(v, 1.35);
    let te = le - c;
    if (notch) te += notch[1] * chord * Math.exp(-(((v - notch[0]) / notch[2]) ** 2));
    const th = thick * chord * (1 - 0.8 * v), ring = [];
    for (let k = 0; k < seg * 2; k++) {
      const a = (k / (seg * 2)) * PI * 2, xc = (1 - Math.cos(a)) / 2;
      const yt = th * 1.3 * Math.sqrt(xc) * Math.pow(1 - xc, 0.8) * (a < PI ? 1 : -1);
      ring.push([yt + lean * span * v * v, span * v, le + (te - le) * xc]);
    }
    rings.push(ring);
  }
  return loft(rings, true, true);
}
function blade(o) { return H.geo(cached(`blade:${JSON.stringify(o)}`, () => bladeGeo(o))); }

/** eyeball looking along +Z. look: { iris, pupil, white, rim, shape: 'round' | 'slit' | 'bar' | 'none', pupilDeg, irisDeg, glow, rough } */
function eye(r, look = {}) {
  const pA = look.pupilDeg ?? 15, iA = look.irisDeg ?? 36, shape = look.shape || 'round';
  const iris = look.iris ?? 0xc9a23a, white = look.white ?? 0xe8e2d2, pupil = look.pupil ?? 0x07070a, rim = look.rim ?? tone(iris, 0, 0.05, -0.2);
  const geo = cached(`eye:${pA}:${iA}:${look.seg || 20}`, () => {
    const angles = [125, 104, 84, 66, 50, iA + 0.6, iA - 0.6, iA * 0.82, (iA + pA) / 2, pA + 0.5, pA - 0.5, pA * 0.5, 0];
    return new THREE.LatheGeometry(angles.map((a) => new THREE.Vector2(Math.max(1e-5, Math.sin(a * DEG)), Math.cos(a * DEG))), look.seg || 20);
  });
  const sP = Math.sin(pA * DEG), sI = Math.sin(iA * DEG);
  const h = H.geo(geo).shade((x, y, z) => {
    if (y < 0.1) return null;
    const d = Math.hypot(x, z);
    if (d > sI) return null;
    if (shape === 'slit') { if (Math.abs(x) < sP * 0.32 * (1 - (z / sI) ** 2) + 0.01 && Math.abs(z) < sI * 0.9) return pupil; }
    else if (shape === 'bar') { if (Math.abs(z) < sP * 0.5 && Math.abs(x) < sI * 0.8) return pupil; }
    else if (shape !== 'none' && d < sP * 1.02) return pupil;
    if (d > sI * 0.84) return rim;
    return iris;
  }).color(white).pbr(look.rough ?? 0.12, 0);
  if (look.glow) h.glow(look.glow);
  return h.scale(r).rot(90, 0, 0);
}

/** a conical tooth / spine / claw: base at the origin, point along +Y, optional hook toward +Z */
function spikeGeo(hook = 0, seg = 6, rows = 5, flat = 1) {
  return cached(`spike:${hook}:${seg}:${rows}:${flat}`, () => {
    const rings = [];
    for (let i = 0; i <= rows; i++) {
      const v = i / rows, r = Math.pow(1 - v, 0.85) * 0.98 + 0.02, ring = [];
      for (let k = 0; k < seg; k++) { const a = (k / seg) * PI * 2; ring.push([Math.cos(a) * r * flat, v, Math.sin(a) * r + hook * v * v]); }
      rings.push(ring);
    }
    return loft(rings, true, true);
  });
}
/** spike of length len and base radius r, base at the origin pointing +Y */
function spike(len, r, hook = 0, seg = 6, flat = 1) { return H.geo(spikeGeo(hook, seg, 5, flat)).scale(r, len, r); }

/** point a +Y-built piece along direction d (any length) and put its base at p */
function aim(piece, p, d, roll = 0) {
  const l = Math.hypot(d[0], d[1], d[2]) || 1, x = d[0] / l, y = d[1] / l, z = d[2] / l;
  // Euler XYZ with rz = 0: Y axis -> (sin(ry) * sin(rx)... ) is awkward; use yaw about Y after tilting about X
  const tilt = Math.acos(clamp(y, -1, 1)) / DEG, yaw = Math.atan2(x, z) / DEG;
  return piece.rot(0, roll, 0).rot(tilt, 0, 0).rot(0, yaw, 0).at(p[0], p[1], p[2]);
}


// ---------- sculpt helpers ----------
/** walk from `from` along `dir` (unit) until the surface of `prims` is reached; returns the point */
function surf(prims, from, dir) {
  let x = from[0], y = from[1], z = from[2];
  for (let i = 0; i < 48; i++) {
    const d = distanceTo(prims, x, y, z);
    if (d < 0.0008) break;
    x += dir[0] * d * 0.9; y += dir[1] * d * 0.9; z += dir[2] * d * 0.9;
  }
  return [x, y, z];
}
/** linear lookup in a table of stations [{ z, ... }] sorted by falling z */
function station(tab, z) {
  if (z >= tab[0].z) return tab[0];
  for (let i = 1; i < tab.length; i++) if (z >= tab[i].z) {
    const a = tab[i - 1], b = tab[i], f = (a.z - z) / (a.z - b.z), o = { z };
    for (const k of Object.keys(a)) if (k !== 'z') o[k] = lerp(a[k], b[k], f);
    return o;
  }
  return tab[tab.length - 1];
}
/**
 * A fish-like hull through stations { z, w, h, y }: half-width, half-height, centre height. Authored in
 * creature space (run it through into() for a node), so relief and mottling line up across the joints.
 * paint(prim, part) colours each piece; part is 'core' | 'top' | 'bottom'.
 */
function hull(st, paint, k = 0.04) {
  const out = [];
  // each capsule is built with its own Y down the body (so 'ridges' relief rings it) in one shared frame
  const cap = (ay, az, by, bz, ra, rb) => S.capsule([0, -az, ay], [0, -bz, by], ra, rb).rot(-90, 0, 0).blend(k);
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    out.push(paint(cap(a.y, a.z, b.y, b.z, a.w, b.w), 'core'));
    const ea = Math.max(0, a.h - a.w * 0.74), eb = Math.max(0, b.h - b.w * 0.74);
    if (ea > 0.003 || eb > 0.003) {
      out.push(paint(cap(a.y + ea, a.z, b.y + eb, b.z, a.w * 0.74, b.w * 0.74), 'top'));
      out.push(paint(cap(a.y - ea, a.z, b.y - eb, b.z, a.w * 0.74, b.w * 0.74), 'bottom'));
    }
  }
  return out;
}
/** stations of `tab` between z0 and z1 (inclusive, interpolated at the ends) */
function span(tab, z0, z1) {
  const out = [station(tab, z0)];
  for (const s of tab) if (s.z < z0 - 1e-6 && s.z > z1 + 1e-6) out.push(s);
  out.push(station(tab, z1));
  return out;
}
/** a thick slab lying against the line (z0, y0) - (z1, y1) in the YZ plane: side -1 = under it, +1 = over it */
function slab(z0, y0, z1, y1, side = -1, pad = 0.05, D = 0.6) {
  if (z1 < z0) { let t = z0; z0 = z1; z1 = t; t = y0; y0 = y1; y1 = t; }
  const ang = Math.atan2(y1 - y0, z1 - z0), len = Math.hypot(z1 - z0, y1 - y0) + pad * 2;
  return S.box(1.6, D, len, 0.02).rot(-ang / DEG, 0, 0).at(0, (y0 + y1) / 2 + side * Math.cos(ang) * D / 2, (z0 + z1) / 2 - side * Math.sin(ang) * D / 2);
}
/** paint everything under the line (z0, y0) - (z1, y1), for bellies */
function under(z0, y0, z1, y1, color, soft = 0.03, rough = 0.4) { return slab(z0, y0, z1, y1, -1).color(color).pbr(rough).paint(soft, 0); }
/** upright membrane in the plane x = 0 from z0 to z1: base(z) and top(z) give its root and edge heights */
function finStrip(z0, z1, base, top, colA, colB, o = {}) {
  const nz = Math.max(3, Math.round(Math.abs(z1 - z0) / (o.step || 0.012))), ny = o.rows || 4, rays = o.rays || 175, amp = o.amp ?? 0.007, wave = o.wave || 40;
  const g = new THREE.PlaneGeometry(1, 1, nz, ny), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5, z = lerp(z0, z1, u);
    p.setXYZ(i, Math.sin(z * wave) * amp * v * v, lerp(base(z), top(z), v), z);
  }
  g.computeVertexNormals();
  const dark = mix(colA, 0x101410, 0.5);
  return H.geo(g).shade((x, y, z) => {
    const b = base(z), v = clamp((y - b) / ((top(z) - b) || 1e-6), 0, 1);
    return mix(mix(colA, colB, v * v), dark, Math.sin(z * rays) > 0.72 ? 0.3 : 0);
  });
}

/**
 * A spined, webbed fan in the plane x = 0, hinged at the origin: each spine { a, len } leans a degrees from +Y
 * toward -Z. The web dips between the spines. Returns hard pieces: the web, then the spines.
 */
function fan(spines, colA, colB, spineCol, o = {}) {
  const dip = o.dip ?? 0.22, rows = o.rows || 4, sub = o.sub || 3, cup = o.cup || 0, r0 = o.inner || 0;
  const edge = (a) => {
    for (let i = 0; i < spines.length - 1; i++) if (a <= spines[i + 1].a + 1e-6) { const f = clamp((a - spines[i].a) / (spines[i + 1].a - spines[i].a), 0, 1); return lerp(spines[i].len, spines[i + 1].len, f) * (1 - dip * Math.sin(f * PI)); }
    return spines[spines.length - 1].len;
  };
  const cols = (spines.length - 1) * sub, pos = [], idx = [];
  for (let c = 0; c <= cols; c++) {
    const si = Math.min(spines.length - 2, Math.floor(c / sub)), f = (c - si * sub) / sub, a = lerp(spines[si].a, spines[si + 1].a, f) * DEG, R = edge(a / DEG);
    for (let j = 0; j <= rows; j++) { const r = lerp(r0, R, j / rows); pos.push(cup * Math.sin((c / cols) * PI) * (r / R) ** 2 * R, r * Math.cos(a), -r * Math.sin(a)); }
  }
  for (let c = 0; c < cols; c++) for (let j = 0; j < rows; j++) { const a = c * (rows + 1) + j, b = a + rows + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  const dark = mix(colA, 0x0c0c10, 0.45);
  const web = H.geo(g).shade((x, y, z) => {
    const r = Math.hypot(y, z), a = Math.atan2(-z, y) / DEG, v = clamp(r / (edge(a) || 1e-6), 0, 1);
    return mix(mix(colA, colB, v ** (o.fade || 1.6)), dark, Math.sin(a * (o.rays || 2.4)) > 0.75 ? 0.28 : 0);
  }).pbr(o.rough ?? 0.45);
  const out = [web];
  for (const sp of spines) if (!sp.bare) { const sk = spike(sp.len * (o.over ?? 1.08), o.spineR || 0.007, 0, 5); if (o.tipCol != null) sk.shade((x, y) => (y > 0.8 ? o.tipCol : null)); out.push(sk.rot(-sp.a, 0, 0).color(spineCol).pbr(0.4).lod(o.spineLod ?? 1)); }
  return out;
}
/** move / turn a list of hard pieces together */
function place(list, rx, ry, rz, x, y, z) { for (const h of list.flat(Infinity)) h.rot(rx, ry, rz).at(x, y, z); return list; }
/** a ridged horn through points, base colour to tip colour */
function horn(pts, r0, r1, colA, colB, rings = 7, radial = 7) {
  const n = rings * 2 + 1, radii = [];
  for (let i = 0; i < n; i++) { const f = i / (n - 1); radii.push(lerp(r0, r1, Math.pow(f, 0.8)) * (i % 2 ? 1.07 : 0.96)); }
  radii[n - 1] = r1 * 0.4;
  const a = pts[0], len = pts.reduce((acc, q, i) => (i ? acc + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1], q[2] - pts[i - 1][2]) : 0), 0);
  return H.tube(pts, radii, n - 1, radial).shade((x, y, z) => mix(colA, colB, clamp(Math.hypot(x - a[0], y - a[1], z - a[2]) / len, 0, 1) ** 1.3)).pbr(0.42);
}

/** a plain tapered prism from the origin along +Z: hidden inside a thin sculpted limb so that it survives at the far detail levels */
function coreGeo(r0, r1, L, k = 0.8) {
  return loft([0, 1].map((e) => { const r = (e ? r1 : r0) * k, ring = []; for (let j = 0; j < 6; j++) { const a = (j / 6) * PI * 2; ring.push([Math.cos(a) * r, Math.sin(a) * r, e * L]); } return ring; }));
}
/** a barnacle: ribbed cone with a crater, base at the origin, opening +Y, radius 1 */
function barnacleGeo() {
  return cached('barnacle', () => new THREE.LatheGeometry([[1, -0.15], [0.96, 0.1], [0.72, 0.6], [0.46, 1.0], [0.36, 1.08], [0.27, 1.0], [0.2, 0.7]].map(([r, y]) => new THREE.Vector2(r, y)), 9));
}
function barnacle(r, p, n, col = 0xb9b29c) {
  return aim(H.geo(barnacleGeo()).shade((x, y, z) => (y > 0.75 && Math.hypot(x, z) < 0.36 ? 0x5a5446 : Math.sin(Math.atan2(z, x) * 9) > 0.3 ? mix(col, 0x7a705a, 0.5) : null)).scale(r, r * (0.8 + rnd(Math.round(r * 9973), 2) * 0.5), r), p, n).color(col).pbr(0.9);
}
/** an old harpoon stuck at p leaning along dir, with a ring and a length of line hanging toward `drop` */
function harpoon(p, dir, len, drop, k = 1) {
  const l = Math.hypot(dir[0], dir[1], dir[2]), d = [dir[0] / l, dir[1] / l, dir[2] / l], top = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
  const mid = [p[0] + d[0] * len * 0.42, p[1] + d[1] * len * 0.42, p[2] + d[2] * len * 0.42];
  return [
    aim(H.cyl(0.006 * k, 0.0075 * k, len * 1.16, 7), mid, d).color(0x3a3530).pbr(0.55, 0.85).shade((x, y, z) => (noise3(x * 500, y * 70, z * 500) > 0.55 ? 0x6a3a22 : null)),
    aim(H.torus(0.011 * k, 0.0036 * k, 12, 6), top, [d[2], 0.3, -d[0]]).color(0x3a3530).pbr(0.5, 0.85).lod(1),
    H.tube([top, [top[0] + drop[0] * 0.3, top[1] + drop[1] * 0.3 - len * 0.2, top[2] + drop[2] * 0.3], [top[0] + drop[0] * 0.7, top[1] + drop[1] * 0.7 - len * 0.1, top[2] + drop[2] * 0.7], [top[0] + drop[0], top[1] + drop[1], top[2] + drop[2]]], [0.0045 * k, 0.0045 * k, 0.004 * k, 0.003 * k], 14, 6).color(0xb49a6a).pbr(0.95).lod(1),
  ];
}

/** point on a Catmull-Rom spline through P at parameter u (0 .. P.length - 1) */
function crEval(P, u, o) {
  const n = P.length - 1, i = Math.min(n - 1, Math.max(0, Math.floor(u))), f = u - i;
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)];
  for (let k = 0; k < 3; k++) o[k] = 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * f * f * f);
  return o;
}
/** a kelp-like ribbon along a path: ruffled edges, a raised midrib. width(s) for s = 0..1, out = the side the blade faces */
function ribbonGeo(pts, width, out, ruffle = 0.35, rings = 14) {
  const pos = [], idx = [], c = [0, 0, 0], d = [0, 0, 0];
  for (let i = 0; i <= rings; i++) {
    const s = i / rings, u = s * (pts.length - 1);
    crEval(pts, u, c); crEval(pts, Math.min(pts.length - 1, u + 0.05), d);
    let tx = d[0] - c[0], ty = d[1] - c[1], tz = d[2] - c[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let bx = ty * out[2] - tz * out[1], by = tz * out[0] - tx * out[2], bz = tx * out[1] - ty * out[0]; const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
    const nx = by * tz - bz * ty, ny = bz * tx - bx * tz, nz = bx * ty - by * tx, w = width(s), r = Math.sin(s * 19 + pts[0][0] * 40) * ruffle * w;
    pos.push(c[0] - bx * w + nx * r, c[1] - by * w + ny * r, c[2] - bz * w + nz * r, c[0] + nx * w * 0.25, c[1] + ny * w * 0.25, c[2] + nz * w * 0.25, c[0] + bx * w - nx * r, c[1] + by * w - ny * r, c[2] + bz * w - nz * r);
    if (i < rings) for (let k = 0; k < 2; k++) { const a = i * 3 + k, b = a + 3; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------- bodies that follow a curve ----------
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _eu = new THREE.Euler(), _v = [0, 0, 0];
function newLay(n) { return { pos: [0, 0, 0], quats: Array.from({ length: n }, () => new THREE.Quaternion()), abs: Array.from({ length: n }, () => new THREE.Quaternion()) }; }
/**
 * Lay a chain of rigid segments (each running down its own -Z) along a curve. f(p, out) writes the point of the
 * curve at distance-parameter p, growing toward the tail. Fills lay.pos (joint 0), lay.quats (each segment's
 * rotation relative to the one before) and lay.abs (in creature space). The dorsal side stays up; roll(i) banks.
 */
function layChain(f, L, lay, roll) {
  let p = 0;
  f(0, _v);
  let px = _v[0], py = _v[1], pz = _v[2];
  lay.pos[0] = px; lay.pos[1] = py; lay.pos[2] = pz;
  _qp.identity();
  for (let i = 0; i < L.length; i++) {
    let q = p + L[i], dx = 0, dy = 0, dz = -1, d = 1;
    for (let it = 0; it < 4; it++) {
      f(q, _v); dx = _v[0] - px; dy = _v[1] - py; dz = _v[2] - pz; d = Math.hypot(dx, dy, dz) || 1e-6;
      if (it < 3) q = p + (q - p) * L[i] / d;
    }
    dx /= d; dy /= d; dz /= d;
    _eu.set(Math.asin(clamp(dy, -1, 1)), Math.atan2(-dx, -dz), roll ? roll(i) : 0, 'YXZ');
    _q.setFromEuler(_eu);
    lay.abs[i].copy(_q);
    lay.quats[i].copy(_qi.copy(_qp).invert().multiply(_q));
    _qp.copy(_q);
    px += dx * L[i]; py += dy * L[i]; pz += dz * L[i]; p = q;
  }
  return lay;
}
function eulerDeg(q) { _eu.setFromQuaternion(q, 'XYZ'); return [_eu.x / DEG, _eu.y / DEG, _eu.z / DEG]; }
function poseChain(segs, lay) {
  if (!segs || !segs.length) return;
  segs[0].position.set(lay.pos[0], lay.pos[1], lay.pos[2]);
  for (let i = 0; i < segs.length; i++) segs[i].quaternion.copy(lay.quats[i]);
}

// ---------- rig helpers ----------
function R(o, x = 0, y = 0, z = 0) {
  if (!o) return;
  const r = o.userData.rest;
  if (r) o.rotation.set(r[0] + x, r[1] + y, r[2] + z); else o.rotation.set(x, y, z);
}
function P(o, x = 0, y = 0, z = 0) {
  if (!o) return;
  const r = o.userData.rest;
  if (r) o.position.set(r[3] + x, r[4] + y, r[5] + z);
}
/** eased pulse 0..1..0 over the window [a, b] of a 0..1 cycle */
function pulse(c, a, b) { if (c <= a || c >= b) return 0; const u = (c - a) / (b - a); return Math.sin(u * PI) ** 2; }
const frac = (v) => v - Math.floor(v);

// templates are cached per creature and detail preset; clones share their geometry
const templates = new Map();
let cachedDetail = null;
function rigged(def, build, k = 1) {
  const detail = getDetail();
  if (detail !== cachedDetail) { templates.clear(); cachedDetail = detail; }
  const key = `${def.id || def.model}:${def.color}:${def.size}`;
  let tpl = templates.get(key);
  if (!tpl) { tpl = assemble(build(def), (def.size || 1) * k); templates.set(key, tpl); }
  return cloneRigged(tpl);
}
const ROOT = { name: 'root', pos: [0, 0, 0], rot: [0, 90, 0] };

// =====================================================================================
// GREAT SHARK: scarred slate-backed hunter with a broken harpoon in its shoulder
// =====================================================================================
function sharkDesc(def) {
  const top = def.color ?? 0x6a7a8a, back = tone(top, 0.01, 0.05, -0.09), belly = 0xe9e6dc, mouth = 0x8a2f38, gum = 0xc98a8a;
  const fin = tone(top, 0.0, 0.0, -0.07), tooth = 0xf2eede, scar = mix(top, 0xe0cfc8, 0.6);
  const wet = 0.36;
  const sk = (p, part) => p.color(part === 'top' ? back : top).pbr(wet).tint(0.1, 9).bump(0.0018, 46);
  // half-width, half-height and centre height along the body (z = +1.08 snout ... -1.0 root of the tail fin)
  const TAB = [
    { z: 1.09, w: 0.02, h: 0.019, y: -0.012 }, { z: 0.97, w: 0.07, h: 0.064, y: -0.014 }, { z: 0.82, w: 0.128, h: 0.124, y: -0.018 },
    { z: 0.62, w: 0.176, h: 0.19, y: -0.024 }, { z: 0.36, w: 0.207, h: 0.238, y: -0.034 }, { z: 0.1, w: 0.212, h: 0.246, y: -0.038 },
    { z: -0.12, w: 0.188, h: 0.218, y: -0.032 }, { z: -0.38, w: 0.132, h: 0.156, y: -0.02 }, { z: -0.6, w: 0.087, h: 0.106, y: -0.011 },
    { z: -0.8, w: 0.052, h: 0.066, y: -0.003 }, { z: -0.95, w: 0.034, h: 0.042, y: 0 }, { z: -1.0, w: 0.03, h: 0.036, y: 0 },
  ];
  const bellyLine = (z) => { const s = station(TAB, z); return s.y - s.h * (z > 0.62 ? lerp(0.34, 0.1, (z - 0.62) / 0.46) : 0.34); };
  const O = [0, -0.03, 0.25]; // body pivot in creature space
  const OV = 0, SINK = -0.055; // joints sit mid-way along a straight taper, so the two sides meet without a crease

  // ---- head and trunk (one rigid piece) ----
  const body = [
    ...hull(span(TAB, 1.09, -0.27 - OV), sk),
    ...S.mirrorX([
      sk(S.ellipsoid(0.045, 0.11, 0.2).at(0.165, -0.03, 0.5).blend(0.07)),                            // gill bulge
      sk(S.ellipsoid(0.03, 0.022, 0.06).at(0.092, 0.058, 0.83).blend(0.035)),                          // brow over the eye
      sk(S.ellipsoid(0.06, 0.035, 0.1).at(0.18, -0.13, 0.42).blend(0.04)),                            // pectoral root
    ]),
    sk(S.capsule([0, 0.205, 0.3], [0, 0.2, 0.0], 0.03, 0.02).blend(0.05), 'top'),                     // dorsal fin root
  ];
  const outer = body.slice();
  // countershading: pale belly with a soft, uneven edge along the flank
  body.push(under(1.1, bellyLine(1.08), 0.62, bellyLine(0.62), belly, 0.02), under(0.62, bellyLine(0.62), -0.36, bellyLine(-0.36), belly, 0.035));
  for (let i = 0; i < 7; i++) body.push(...S.mirrorX([S.ellipsoid(0.1, 0.03, 0.06).at(0.2, bellyLine(0.56 - i * 0.12) + 0.012, 0.56 - i * 0.12 + rnd(i, 3) * 0.04).color(belly).pbr(wet).paint(0.02, 0)]));
  // mouth: the lower jaw is a plug cut out of the underside of the head
  const E = () => S.ellipsoid(0.104, 0.062, 0.172).at(0, -0.092, 0.79);
  body.push(E().cut(0.006).color(mouth), S.ellipsoid(0.07, 0.03, 0.11).at(0, -0.04, 0.8).cut(0.012).color(tone(mouth, 0, 0, -0.1)));
  // eye sockets, gill slits, nostrils, lateral line, old scars
  const eyeP = surf(outer, [0.4, 0.012, 0.835], [-1, 0, 0]);
  body.push(...S.mirrorX([S.sphere(0.028).at(eyeP[0] - 0.006, eyeP[1], eyeP[2]).cut(0.008).color(0x20262e)]));
  for (let i = 0; i < 5; i++) body.push(...S.mirrorX([S.box(0.2, 0.13 - i * 0.01, 0.012, 0.004).rot(-10, 0, 0).at(0.2, 0.0, 0.6 - i * 0.043).color(tone(top, 0, 0.02, -0.24)).paint(0.004, -0.008)]));
  body.push(...S.mirrorX([
    S.sphere(0.012).at(0.05, -0.04, 1.01).color(0x1a1c20).paint(0.004, -0.004),
    S.capsule([0.2, -0.01, 0.34], [0.16, -0.01, -0.27], 0.004).color(tone(top, 0, 0, -0.08)).paint(0.004, -0.0015),
  ]));
  for (const [x, y, z, len, ang, w] of [[-0.2, 0.11, 0.2, 0.22, 17, 0.013], [-0.2, 0.07, 0.17, 0.3, 14, 0.016], [-0.2, 0.03, 0.15, 0.2, 12, 0.012], [0.16, 0.13, -0.06, 0.16, 32, 0.013]]) {
    body.push(S.ellipsoid(0.15, w, len / 2).rot(ang, 0, 0).at(x, y, z).color(scar).pbr(0.55).paint(0.006, -0.0025));
  }
  body.push(S.ellipsoid(0.012, 0.1, 0.05).rot(0, 35, 0).at(0.05, 0.1, 0.9).color(scar).pbr(0.55).paint(0.006, -0.0025));
  const bodyHard = [
    // eyes: black, glossy, deep set
    ...H.mirrorX([eye(0.024, { iris: 0x0c1016, rim: 0x2a3644, white: 0x18202a, pupilDeg: 28, irisDeg: 52, rough: 0.05 }).rot(0, 80, 0).at(eyeP[0] - 0.02, eyeP[1], eyeP[2])]),
    // first dorsal: tall, notched by an old bite
    blade({ span: 0.37, chord: 0.34, tip: 0.2, sweep: 0.55, thick: 0.12, falcate: 0.5, notch: [0.55, 0.16, 0.07] }).shade((x, y) => mix(fin, back, clamp(y / 0.37, 0, 1) * 0.6)).pbr(wet).at(0, 0.2, 0.13),
    // pectorals: long, swept, angled down and out
    ...H.mirrorX([blade({ span: 0.46, chord: 0.25, tip: 0.22, sweep: 0.5, thick: 0.1, falcate: 0.35 }).shade((x, y) => (x > 0 ? belly : mix(fin, 0x2a3038, clamp(y / 0.46, 0, 1) * 0.5))).pbr(wet).rot(0, 0, -112).rot(-8, -10, 0).at(0.16, -0.13, 0.44)]),
  ];
  // upper teeth hang from the palate, two staggered rows
  for (let row = 0; row < 2; row++) for (let i = 0; i < 15 - row * 2; i++) {
    const a = (-80 + (i + row * 0.5) * (160 / (14 - row * 2))) * DEG, k = 0.86 - row * 0.15;
    bodyHard.push(spike(0.04 - row * 0.01, 0.012, 0, 4, 0.5).rot(180, 0, 0).rot(0, a / DEG - 90, 0).at(Math.sin(a) * 0.104 * k, -0.062 + row * 0.006, 0.79 + Math.cos(a) * 0.172 * k).color(tooth).pbr(0.25).lod(row ? 0 : 1));
  }
  // a broken harpoon, long healed over, with a frayed length of line
  const hp = surf(outer, [-0.11, 0.5, -0.08], [0, -1, 0]);
  bodyHard.push(
    aim(H.cyl(0.006, 0.007, 0.15, 7), [hp[0] - 0.008, hp[1] + 0.035, hp[2] - 0.055], [-0.12, 0.45, -0.85]).color(0x3a3530).pbr(0.55, 0.85).shade((x, y, z) => (noise3(x * 500, y * 70, z * 500) > 0.55 ? 0x6a3a22 : null)),
    aim(H.torus(0.011, 0.0036, 12, 6), [hp[0] - 0.018, hp[1] + 0.074, hp[2] - 0.128], [0.9, 0.3, 0.2]).color(0x3a3530).pbr(0.5, 0.85).lod(1),
    H.tube([[hp[0] - 0.02, hp[1] + 0.066, hp[2] - 0.13], [hp[0] - 0.045, hp[1] + 0.02, hp[2] - 0.18], [hp[0] - 0.075, hp[1] - 0.04, hp[2] - 0.24], [hp[0] - 0.08, hp[1] - 0.075, hp[2] - 0.33]], [0.0045, 0.0045, 0.004, 0.003], 14, 6).color(0xb49a6a).pbr(0.95).lod(1),
  );
  body.push(S.ellipsoid(0.022, 0.012, 0.026).at(hp[0], hp[1] - 0.002, hp[2]).color(mix(scar, 0xb08a88, 0.5)).pbr(0.6).blend(0.016));

  // ---- lower jaw: the plug, with its top sliced off to make the floor of the mouth ----
  const J = [0, -0.118, 0.625];
  const jaw = [
    S.ellipsoid(0.1, 0.058, 0.168).at(0, -0.092, 0.79).color(belly).pbr(wet + 0.04),
    S.box(0.4, 0.2, 0.5, 0.01).rot(-4, 0, 0).at(0, 0.004, 0.8).cut(0.006).color(mouth),
    S.ellipsoid(0.07, 0.02, 0.12).at(0, -0.094, 0.79).cut(0.012).color(tone(mouth, 0, 0, -0.08)),
    S.ellipsoid(0.042, 0.013, 0.075).at(0, -0.108, 0.76).color(gum).pbr(0.3).blend(0.012),      // tongue
  ];
  const jawHard = [];
  for (let row = 0; row < 2; row++) for (let i = 0; i < 13 - row * 2; i++) {
    const a = (-78 + (i + row * 0.5) * (156 / (12 - row * 2))) * DEG, k = 0.8 - row * 0.15, z = 0.79 + Math.cos(a) * 0.168 * k;
    jawHard.push(spike(0.034 - row * 0.008, 0.0105, 0, 4, 0.5).rot(0, a / DEG - 90, 0).at(Math.sin(a) * 0.1 * k, -0.099 - (z - 0.8) * 0.07, z).color(tooth).pbr(0.25).lod(row ? 0 : 1));
  }

  // ---- tail: three tapering segments, then the caudal fin on its own joint ----
  const TZ = [-0.27, -0.5, -0.71, -0.89, -1.0];
  const tail = [];
  for (let i = 0; i < 4; i++) {
    const jz = TZ[i], jy = station(TAB, jz).y, r0 = station(TAB, jz).h;
    const p = [...hull(span(TAB, TZ[i] + OV, i < 3 ? TZ[i + 1] - OV : TZ[i + 1]), sk), under(TZ[i] + 0.09, bellyLine(TZ[i] + 0.09), TZ[i + 1] - 0.09, bellyLine(TZ[i + 1] - 0.09), belly, 0.03)];
    const hard = [];
    if (i === 0) hard.push(...H.mirrorX([blade({ span: 0.12, chord: 0.13, tip: 0.3, sweep: 0.8, thick: 0.1 }).color(mix(belly, top, 0.45)).pbr(wet).rot(0, 0, -118).rot(-32, 0, 0).at(0.075, jy - r0 * 0.72, jz - 0.1)]));  // pelvic fins
    if (i === 1) hard.push(
      blade({ span: 0.1, chord: 0.11, tip: 0.3, sweep: 0.75, thick: 0.1, falcate: 0.3 }).color(fin).pbr(wet).at(0, jy + r0 * 0.86, jz - 0.08),                     // second dorsal
      blade({ span: 0.08, chord: 0.09, tip: 0.3, sweep: 0.75, thick: 0.1 }).color(mix(belly, top, 0.45)).pbr(wet).rot(0, 0, 180).at(0, jy - r0 * 0.8, jz - 0.13)); // anal fin
    if (i === 3) {
      p.push(...S.mirrorX([sk(S.ellipsoid(0.02, 0.011, 0.07).at(0.036, 0, -0.93).blend(0.02))]));                                                                  // keels
      const lobe = (sp, chord, ang, down) => blade({ span: sp, chord, tip: 0.16, sweep: 0.42, thick: 0.1, falcate: 0.6, rows: 11 }).shade((x, y) => mix(fin, 0x2c333c, clamp(y / sp, 0, 1) * 0.55)).pbr(wet).rot(0, 0, down ? 180 : 0).rot(ang, 0, 0).at(0, 0, -0.985);
      hard.push(lobe(0.46, 0.2, -38, false), lobe(0.3, 0.17, 38, true));
      p.push(sk(S.capsule([0, 0.05, -1.0], [0, -0.04, -1.01], 0.028, 0.024).blend(0.03)));
    }
    const o = [0, jy, jz], prev = i ? [0, station(TAB, TZ[i - 1]).y, TZ[i - 1]] : O;
    tail.push({ name: `tail${i}`, parent: i ? `tail${i - 1}` : 'body', rig: 'tail', pos: [0, o[1] - prev[1], o[2] - prev[2]], prims: into(o, p), hard: into(o, hard), detail: 0.9 });
  }

  return { kind: 'shark', nodes: [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: [O[0], O[1] + SINK, O[2]], prims: into(O, body), hard: into(O, bodyHard), detail: 0.95 },
    { name: 'jaw', parent: 'body', rig: 'jaw', pos: [J[0] - O[0], J[1] - O[1], J[2] - O[2]], prims: into(J, jaw), hard: into(J, jawHard), detail: 1.2 },
    ...tail,
  ] };
}

function animShark(model, { t, phase }) {
  const rig = model.userData.rig;
  const w = t * 4.6 + phase;
  // lunge: every few seconds the head comes up out of the water and the jaws gape, then snap
  const c = frac(t * 0.21 + phase * 0.137), bite = pulse(c, 0.0, 0.3), snap = pulse(c, 0.2, 0.32);
  R(rig.body, -bite * 0.3 + Math.sin(w * 0.5) * 0.02, -Math.sin(w + 0.9) * 0.07, Math.sin(w) * 0.05);
  P(rig.body, 0, bite * 0.09, 0);
  R(rig.jaw, 0.06 + Math.max(0, Math.sin(t * 0.9 + phase)) * 0.1 + bite * 0.62 - snap * 0.3);
  (rig.tail || []).forEach((n, i) => R(n, bite * 0.07, Math.sin(w - i * 0.75) * (0.13 + i * 0.07), 0));
}

// =====================================================================================
// GIANT EEL: a mottled, slab-sided ambusher with a gaping, needle-toothed mouth
// =====================================================================================
const EEL = { n: 12, L: 0.225, len: 2.7, lay: newLay(12) };
EEL.Ls = Array.from({ length: EEL.n }, () => EEL.L);
function eelCurve(p, t, phase, o) {
  const u = clamp(p / EEL.len, 0, 1.1);
  const w = p * 3.5 - t * 3.3 - phase;
  o[0] = Math.sin(w) * (0.04 + 0.17 * Math.pow(u, 1.1));
  o[1] = -0.066 + 0.12 * Math.exp(-Math.max(0, p) * 2.6) + Math.sin(p * 2.7 - t * 1.9 - phase * 0.7) * 0.024 * clamp(p * 2, 0, 1);
  o[2] = 1.04 - p * 0.9;
}
function eelDesc(def) {
  const base = def.color ?? 0x3a5a3a, skin = tone(base, 0.01, 0.0, 0.06), back = tone(base, -0.01, 0.02, -0.015), belly = 0xcfc48c, blotch = mix(skin, 0xc9a63e, 0.72), mouth = 0xd9a9a2, tooth = 0xf3efdc;
  const finA = tone(skin, 0, 0.02, -0.05), finB = 0xd0b24a, wet = 0.3;
  const sk = (p, part) => p.color(part === 'top' ? back : skin).pbr(wet).tint(0.16, 26).bump(0.0022, 60);
  // straight space: the head joint is z = 0, the snout +0.4, the tail tip -2.7
  const TAB = [
    { z: 0.4, w: 0.02, h: 0.022, y: -0.004 }, { z: 0.365, w: 0.043, h: 0.045, y: -0.004 }, { z: 0.3, w: 0.064, h: 0.07, y: -0.002 },
    { z: 0.2, w: 0.086, h: 0.106, y: 0.002 }, { z: 0.1, w: 0.096, h: 0.13, y: 0.005 }, { z: -0.03, w: 0.088, h: 0.12, y: 0 },
    { z: -0.2, w: 0.082, h: 0.114, y: 0 }, { z: -0.9, w: 0.088, h: 0.124, y: 0 }, { z: -1.7, w: 0.066, h: 0.102, y: 0 }, { z: -2.3, w: 0.04, h: 0.076, y: 0 }, { z: -2.62, w: 0.017, h: 0.04, y: 0 }, { z: -2.7, w: 0.008, h: 0.014, y: 0 },
  ];
  const at = (z) => station(TAB, z);
  const finH = (z) => 0.062 * smooth((0.04 - z) / 0.25) * (z < -2.3 ? lerp(1, 0.55, (-2.3 - z) / 0.4) : 1) * (1 + 0.1 * Math.sin(z * 70));
  const dorsalBase = (z) => at(z).y + at(z).h - 0.022, dorsalTop = (z) => at(z).y + at(z).h + finH(z);
  const analH = (z) => 0.05 * smooth((-1.0 - z) / 0.4) * (z < -2.3 ? lerp(1, 0.55, (-2.3 - z) / 0.4) : 1);
  const analBase = (z) => at(z).y - at(z).h + 0.02, analTop = (z) => at(z).y - at(z).h - analH(z);
  // one list of blotches for the whole animal, so a blotch that straddles a joint is painted on both sides of it
  const SPOTS = [];
  for (let i = 0; i < 230; i++) {
    const z = 0.36 - rnd(i, 1) * 3.0, th = (rnd(i, 41) * 2 - 1) * 2.0, st = at(z), r = (0.01 + rnd(i, 81) ** 2 * 0.026) * (st.w / 0.09);
    SPOTS.push({ z, r, make: () => S.ellipsoid(r, r * 1.25, r * (1 + rnd(i, 4) * 0.9)).rot(0, 0, -th / DEG).at(Math.sin(th) * st.w * 0.99, st.y + Math.cos(th) * st.h * 0.97, z).color(mix(blotch, belly, rnd(i, 9) * 0.35)).pbr(wet).paint(0.006, 0) });
  }
  const blotches = (z0, z1) => SPOTS.filter((b) => b.z < z0 + b.r * 2 && b.z > z1 - b.r * 2).map((b) => b.make());

  // ---- head: skull and upper jaw, with everything under the mouth line sliced away ----
  const mY = (z) => lerp(-0.034, -0.012, (z - 0.07) / 0.33);            // the mouth line
  const skull = [
    ...hull(span(TAB, 0.4, -0.04), sk),
    ...S.mirrorX([
      sk(S.ellipsoid(0.036, 0.062, 0.075).at(0.066, 0.0, 0.085).blend(0.05)),                        // jaw muscle
      sk(S.ellipsoid(0.02, 0.016, 0.034).at(0.047, 0.064, 0.262).blend(0.022)),                      // brow
    ]),
    sk(S.capsule([0, 0.118, 0.14], [0, 0.07, 0.3], 0.03, 0.018).blend(0.04), 'top'),               // crest of the skull
  ];
  const head = [...skull, under(0.42, -0.05, -0.06, -0.066, belly, 0.02, wet), ...blotches(0.4, -0.05)];
  head.push(
    slab(0.5, mY(0.5), 0.085, mY(0.085), -1, 0, 0.5).cut(0.006).color(mouth),
    S.ellipsoid(0.034, 0.02, 0.115).at(0, -0.016, 0.235).cut(0.016).color(tone(mouth, 0, 0.05, -0.1)),  // palate
    S.sphere(0.05).at(0, -0.03, 0.09).color(0x5a2630).paint(0.03, 0),                                    // throat
  );
  const eyeP = surf(skull, [0.3, 0.04, 0.268], [-1, 0, 0]);
  head.push(...S.mirrorX([
    S.sphere(0.019).at(eyeP[0] - 0.004, eyeP[1], eyeP[2]).cut(0.006).color(0x18200e),
    S.sphere(0.014).at(surf(skull, [0.3, -0.005, -0.025], [-1, 0, 0])[0], -0.005, -0.025).color(0x10140c).paint(0.006, -0.006),   // gill opening
    S.capsule([0.07, 0.0, 0.2], [0.085, -0.03, 0.04], 0.006).color(back).paint(0.005, -0.003),                                // cheek fold
    S.capsule([0.08, 0.05, 0.12], [0.088, 0.02, -0.02], 0.006).color(back).paint(0.005, -0.003),
  ]));
  const headHard = [
    ...H.mirrorX([
      eye(0.0165, { iris: 0xe8d9a0, rim: 0x5a4a1c, white: 0x2a2a18, pupilDeg: 17, irisDeg: 44, rough: 0.08 }).rot(-8, 74, 0).at(eyeP[0] - 0.011, eyeP[1], eyeP[2]),
      aim(H.cyl(0.0052, 0.007, 0.026, 7), [0.017, 0.022, 0.392], [0.25, 0.5, 0.85]).color(tone(skin, 0, 0, 0.04)).pbr(wet).lod(1),        // nostril tubes
    ]),
    finStrip(0.06, -0.04, dorsalBase, dorsalTop, finA, finB),
  ];
  // upper teeth: needles along the lip, long fangs at the front
  const toothAt = (hard, z, side, len, up) => {
    const sx = surf(skull, [0.3, mY(z) + up * 0.012, z], [-1, 0, 0])[0] - 0.0075;
    hard.push(spike(len, 0.0052, 0.25, 5).rot(up > 0 ? 180 : 0, 0, 0).rot(up > 0 ? -8 : 8, 0, side * (up > 0 ? 6 : -6)).at(side * sx, mY(z) + up * 0.004, z).color(tooth).pbr(0.2).lod(1));
  };
  for (let i = 0; i < 9; i++) for (const sd of [-1, 1]) toothAt(headHard, 0.13 + i * 0.027, sd, 0.022 + (i > 6 ? 0.018 : 0) + rnd(i, 2) * 0.008, 1);
  for (const x of [-0.011, 0.011]) headHard.push(spike(0.04, 0.0058, 0.25, 5).rot(180, 0, 0).rot(-10, 0, 0).at(x, mY(0.37) + 0.004, 0.376).color(tooth).pbr(0.2).lod(1));
  for (let i = 0; i < 4; i++) headHard.push(spike(0.02, 0.0045, 0.2, 5).rot(180, 0, 0).at(0, -0.012 + 0.012, 0.17 + i * 0.045).color(tooth).pbr(0.2).lod(0));   // palate row

  // ---- lower jaw: the same head with everything over the mouth line sliced away ----
  const J = [0, mY(0.085), 0.085];
  const jawHull = hull(span(TAB.map((s) => ({ ...s, w: s.w * 0.97 })), 0.385, 0.03), sk);
  const jaw = [
    ...jawHull,
    sk(S.ellipsoid(0.05, 0.03, 0.1).at(0, -0.072, 0.2).blend(0.04)),                                 // throat pouch
    under(0.42, -0.045, -0.06, -0.06, belly, 0.02, wet),
    slab(0.5, mY(0.5), 0.0, mY(0.0), 1, 0, 0.5).cut(0.006).color(mouth),
    S.box(0.4, 0.4, 0.2, 0.01).at(0, 0, -0.045).cut(0.01).color(mouth),
    S.ellipsoid(0.04, 0.007, 0.12).at(0, -0.022, 0.24).cut(0.012).color(tone(mouth, 0, 0.05, -0.05)),
    S.ellipsoid(0.022, 0.011, 0.08).at(0, -0.026, 0.215).color(tone(mouth, -0.01, 0.14, -0.08)).pbr(0.3).blend(0.012),   // tongue
    S.sphere(0.05).at(0, -0.03, 0.09).color(0x5a2630).paint(0.03, 0),
  ];
  const jawHard = [];
  for (let i = 0; i < 9; i++) for (const sd of [-1, 1]) toothAt(jawHard, 0.118 + i * 0.027, sd, 0.02 + (i > 6 ? 0.016 : 0) + rnd(i, 6) * 0.008, -1);
  for (const x of [-0.02, 0.02]) jawHard.push(spike(0.036, 0.0055, 0.25, 5).rot(8, 0, 0).at(x, mY(0.36) - 0.004, 0.36).color(tooth).pbr(0.2).lod(1));

  // ---- body: a dozen segments laid along the swimming curve ----
  const lay = layChain((p, o) => eelCurve(p, 0, 0, o), EEL.Ls, EEL.lay);
  const segs = [];
  for (let i = 0; i < EEL.n; i++) {
    const z0 = -i * EEL.L, z1 = -(i + 1) * EEL.L, o = [0, 0, z0];
    const p = [
      ...hull(span(TAB, z0, z1), sk),
      under(z0 + 0.06, at(z0).y - at(z0).h * 0.42, z1 - 0.06, at(z1).y - at(z1).h * 0.42, belly, 0.025, wet),
      ...blotches(z0, z1),
    ];
    const hard = [finStrip(z0, z1, dorsalBase, dorsalTop, finA, finB)];
    if (i >= 4) hard.push(finStrip(z0, z1, analBase, analTop, mix(belly, skin, 0.5), finB));
    segs.push({ name: `seg${i}`, parent: i ? `seg${i - 1}` : 'root', rig: 'segs', pos: i ? [0, 0, -EEL.L] : lay.pos.slice(), rot: eulerDeg(lay.quats[i]), prims: into(o, p), hard: into(o, hard), detail: 0.84 });
  }
  return { kind: 'eel', nodes: [
    ROOT,
    ...segs,
    { name: 'head', parent: 'root', rig: 'head', pos: lay.pos.slice(), rot: [-16, 0, 0], prims: head, hard: headHard, detail: 1.4 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: J, rot: [17, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 1.4 },
  ] };
}
const _hq = new THREE.Quaternion();
function animEel(model, { t, phase }) {
  const rig = model.userData.rig, lay = layChain((p, o) => eelCurve(p, t, phase, o), EEL.Ls, EEL.lay);
  poseChain(rig.segs, lay);
  if (rig.head) {
    // the head carries on the line of the neck, lifted, with a slow sideways cast
    const c = frac(t * 0.19 + phase * 0.21), strike = pulse(c, 0.0, 0.26);
    rig.head.position.set(lay.pos[0], lay.pos[1], lay.pos[2]);
    _eu.set(-0.1 - strike * 0.22 + Math.sin(t * 1.3 + phase) * 0.04, 0, 0, 'YXZ');
    rig.head.quaternion.copy(lay.abs[0]).slerp(_hq.identity(), 0.3).multiply(_q.setFromEuler(_eu));
    if (rig.jaw) R(rig.jaw, Math.sin(t * 2.1 + phase) * 0.09 + strike * 0.5 - pulse(c, 0.2, 0.3) * 0.55);
  }
}

// =====================================================================================
// SEA SERPENT: horned, frilled sea dragon, neck arched high, body looping through the swell
// =====================================================================================
const SERP = { Ls: [0.17, 0.17, 0.18, 0.2, 0.22, 0.25, 0.27, 0.27, 0.27, 0.27, 0.26, 0.25, 0.24, 0.22], base: null };
SERP.n = SERP.Ls.length; SERP.len = SERP.Ls.reduce((a, b) => a + b, 0); SERP.lay = newLay(SERP.n);
/** the arch of the neck: a table of (z, y) against distance behind the head, integrated once */
function serpBase() {
  if (SERP.base) return SERP.base;
  const step = 0.02, n = Math.ceil((SERP.len + 0.6) / step), zs = new Float32Array(n), ys = new Float32Array(n);
  let z = 0.84, y = 0.5;
  for (let i = 0; i < n; i++) {
    zs[i] = z; ys[i] = y;
    const p = i * step, d = -0.16 + 1.42 * smooth((p - 0.1) / 0.36) - 1.26 * smooth((p - 0.6) / 0.42);
    z -= Math.cos(d) * step; y -= Math.sin(d) * step;
  }
  SERP.base = { step, n, zs, ys };
  return SERP.base;
}
function serpCurve(p, t, phase, o) {
  const B = serpBase(), f = clamp(p / B.step, 0, B.n - 1.001), i = Math.floor(f), k = f - i;
  const env = smooth((p - 0.8) / 0.55), neck = 1 - smooth(p / 0.9);
  const tailUp = smooth((p - (SERP.len - 0.75)) / 0.6);
  o[0] = Math.sin(p * 1.5 - t * 0.9 - phase) * 0.14 * env + Math.sin(t * 0.7 + phase) * 0.05 * neck;
  o[1] = lerp(B.ys[i], B.ys[i + 1], k) * (1 + Math.sin(t * 1.1 + phase) * 0.035 * neck) + env * (0.2 - tailUp * 0.08) * Math.sin(p * 4.9 - t * 2.3 - phase * 1.3 + 0.2) + tailUp * 0.1 - env * 0.04;
  o[2] = lerp(B.zs[i], B.zs[i + 1], k) + Math.sin(t * 1.1 + phase) * 0.02 * neck;
}
function serpentDesc(def) {
  const base = def.color ?? 0x2a6a5a, skin = tone(base, 0, 0.02, 0.03), back = tone(base, 0.02, 0.04, -0.07), belly = 0xd9cf9c, bellyDk = 0xb7a86c;
  const web = 0xd9822b, webIn = tone(base, 0.03, 0.05, -0.04), bone = 0xe6dcc0, boneDk = 0x4a3d30, mouth = 0x9a2f3a, tooth = 0xf4efdc;
  const wet = 0.38;
  const sk = (p, part) => (part === 'bottom'
    ? p.color(belly).pbr(wet + 0.05).bump(0.005, 15, 'ridges').tint(0.08, 30)
    : p.color(part === 'top' ? back : skin).pbr(wet).bump(0.0058, 36, 'scales').tint(0.14, 12));
  // straight space: z = -(distance behind the head joint)
  const TAB = [
    { z: 0.03, w: 0.07, h: 0.076, y: 0 }, { z: -0.3, w: 0.078, h: 0.086, y: 0 }, { z: -0.8, w: 0.1, h: 0.112, y: 0 }, { z: -1.35, w: 0.116, h: 0.128, y: 0 },
    { z: -2.1, w: 0.102, h: 0.112, y: 0 }, { z: -2.75, w: 0.064, h: 0.072, y: 0 }, { z: -3.15, w: 0.034, h: 0.04, y: 0 }, { z: -SERP.len, w: 0.016, h: 0.02, y: 0 },
  ];
  const at = (z) => station(TAB, z);
  const lay = layChain((p, o) => serpCurve(p, 0, 0, o), SERP.Ls, SERP.lay);

  // ---- body segments: scaled hide, plated belly, a spined sail on each ----
  const segs = [];
  let z0 = 0;
  for (let i = 0; i < SERP.n; i++) {
    const L = SERP.Ls[i], z1 = z0 - L, o = [0, 0, z0], mid = at((z0 + z1) / 2);
    const p = [...hull(span(TAB, z0, z1), sk)];
    // a darker saddle over each joint and pale flecks along the flank
    p.push(S.ellipsoid(mid.w * 0.8, 0.05, L * 0.26).at(0, mid.h * 0.98, (z0 + z1) / 2).color(mix(back, 0x0e2a26, 0.35)).paint(0.04, 0));
    for (let k = 0; k < 6; k++) for (const sd of [-1, 1]) p.push(S.sphere(0.008 + rnd(i * 9 + k, 3) * 0.009).at(sd * mid.w * 0.98, (rnd(i * 9 + k, sd + 5) - 0.62) * mid.h * 0.8, lerp(z0, z1, rnd(i * 9 + k, sd + 8))).color(mix(skin, belly, 0.5)).paint(0.006, 0));
    const hard = [];
    // sail: tall on the neck, lower along the body, gone at the tail fin
    const sailH = (i < 5 ? 0.15 : 0.125) * (i > SERP.n - 4 ? 0 : 1) * (i === 0 ? 0.75 : 1) * (i === SERP.n - 4 ? 0.7 : 1);
    if (sailH > 0) {
      const sp = [{ a: -58, len: sailH * 0.62 }, { a: -30, len: sailH * 0.86 }, { a: -4, len: sailH }, { a: 22, len: sailH * 1.08 }, { a: 46, len: sailH * 0.98 }, { a: 68, len: sailH * 0.74 }];
      hard.push(place(fan(sp, webIn, web, boneDk, { dip: 0.28, spineR: 0.0065 }), 0, 0, 0, 0, mid.h - 0.014, (z0 + z1) / 2 + L * 0.06));
      p.push(sk(S.capsule([0, mid.h - 0.01, z0 - L * 0.22], [0, mid.h - 0.01, z1 + L * 0.22], 0.02, 0.02).blend(0.03), 'top'));
    }
    if (i === 4) {
      // fore-fins where the neck meets the water
      for (const sd of [-1, 1]) hard.push(place(fan([{ a: 14, len: 0.16 }, { a: 40, len: 0.27 }, { a: 62, len: 0.31 }, { a: 84, len: 0.27 }, { a: 106, len: 0.17 }], webIn, web, boneDk, { dip: 0.25, cup: 0.05 * sd }), 0, 0, sd * -74, sd * (mid.w - 0.015), -0.01, (z0 + z1) / 2 + 0.07));
    }
    if (i >= SERP.n - 2) {
      // tail fin: a tall spined leaf, upper and lower
      const k = i === SERP.n - 1 ? 1 : 0.62;
      hard.push(place(fan([{ a: 28, len: 0.1 * k }, { a: 50, len: 0.2 * k }, { a: 68, len: 0.27 * k }, { a: 84, len: 0.3 * k }, { a: 96, len: 0.3 * k }, { a: 112, len: 0.27 * k }, { a: 130, len: 0.2 * k }, { a: 152, len: 0.1 * k }], webIn, web, boneDk, { dip: 0.2, spineR: 0.006 }), 0, 0, 0, 0, 0, z0 - L * 0.15));
    }
    segs.push({ name: `seg${i}`, parent: i ? `seg${i - 1}` : 'root', rig: 'segs', pos: i ? [0, 0, -SERP.Ls[i - 1]] : lay.pos.slice(), rot: eulerDeg(lay.quats[i]), prims: into(o, p), hard: into(o, hard), detail: 1.12 });
    z0 = z1;
  }

  // ---- head ----
  const HT = [
    { z: 0.455, w: 0.016, h: 0.016, y: -0.02 }, { z: 0.43, w: 0.034, h: 0.03, y: -0.017 }, { z: 0.36, w: 0.05, h: 0.044, y: -0.012 }, { z: 0.26, w: 0.07, h: 0.06, y: -0.006 },
    { z: 0.16, w: 0.092, h: 0.08, y: 0 }, { z: 0.06, w: 0.098, h: 0.088, y: 0.004 }, { z: -0.04, w: 0.074, h: 0.08, y: 0 },
  ];
  const mY = (z) => lerp(-0.03, -0.024, (z - 0.06) / 0.4);
  const skull = [
    ...hull(HT, sk),
    ...S.mirrorX([
      sk(S.ellipsoid(0.03, 0.045, 0.07).at(0.082, -0.005, 0.07).blend(0.04)),                           // jaw muscle
      sk(S.capsule([0.03, 0.064, 0.3], [0.066, 0.086, 0.13], 0.018, 0.03).blend(0.03), 'top'),          // brow ridge running into the horn
      sk(S.ellipsoid(0.02, 0.014, 0.03).at(0.03, 0.032, 0.41).blend(0.02)),                              // nostril mound
    ]),
    sk(S.capsule([0, 0.058, 0.36], [0, 0.085, 0.1], 0.02, 0.034).blend(0.035), 'top'),                 // ridge of the snout
    sk(S.ellipsoid(0.022, 0.02, 0.03).at(0, -0.03, 0.44).blend(0.02)),                                   // hooked tip of the upper jaw
  ];
  const head = [...skull, under(0.5, -0.045, -0.06, -0.05, belly, 0.02, wet)];
  head.push(
    slab(0.56, mY(0.56), 0.065, mY(0.065), -1, 0, 0.5).cut(0.006).color(mouth),
    S.ellipsoid(0.036, 0.022, 0.15).at(0, -0.024, 0.25).cut(0.016).color(tone(mouth, 0, 0, -0.08)),
    S.sphere(0.05).at(0, -0.03, 0.07).color(0x40141c).paint(0.03, 0),
  );
  const eyeP = surf(skull, [0.3, 0.036, 0.215], [-1, 0, 0]);
  head.push(...S.mirrorX([
    S.sphere(0.021).at(eyeP[0] - 0.005, eyeP[1], eyeP[2]).cut(0.007).color(0x101814),
    S.sphere(0.008).at(0.036, 0.034, 0.43).color(0x0c1010).paint(0.004, -0.005),
  ]));
  const hornAt = (x, y, z, pts, r0, r1) => horn(pts.map((q) => [x + q[0], y + q[1], z + q[2]]), r0, r1, bone, boneDk);
  const headHard = [
    ...H.mirrorX([
      eye(0.0185, { iris: 0xf2b21e, rim: 0x8a3a10, white: 0xf2b21e, shape: 'slit', pupilDeg: 14, irisDeg: 60, rough: 0.1, glow: 0.35 }).rot(-6, 62, 0).at(eyeP[0] - 0.012, eyeP[1], eyeP[2]),
      hornAt(0.062, 0.088, 0.12, [[0, 0, 0], [0.02, 0.04, -0.07], [0.036, 0.1, -0.16], [0.04, 0.19, -0.23], [0.03, 0.29, -0.25]], 0.026, 0.006),   // great horns
      hornAt(0.092, 0.03, 0.04, [[0, 0, 0], [0.03, 0.012, -0.05], [0.05, 0.035, -0.11], [0.055, 0.07, -0.16]], 0.016, 0.004).lod(2),             // cheek horns
      hornAt(0.085, -0.025, 0.05, [[0, 0, 0], [0.025, -0.01, -0.04], [0.04, -0.012, -0.09]], 0.012, 0.003).lod(1),
      spike(0.035, 0.008, 0.3, 5).rot(-25, 0, -20).at(0.04, 0.07, 0.3).color(bone).pbr(0.4).lod(1),                                                // brow studs
      spike(0.03, 0.007, 0.3, 5).rot(-25, 0, -20).at(0.03, 0.06, 0.36).color(bone).pbr(0.4).lod(1),
    ]),
    spike(0.05, 0.012, 0.35, 6).rot(-18, 0, 0).at(0, 0.06, 0.4).color(bone).pbr(0.4),                                                              // nose horn
  ];
  const fang = (hard, x, z, len, up, r = 0.0062) => hard.push(spike(len, r, 0.3, 5).rot(up > 0 ? 180 : 0, 0, 0).rot(up > 0 ? -6 : 6, 0, 0).at(x, mY(z) + up * 0.005, z).color(tooth).pbr(0.2).lod(1));
  const lipX = (z, dy) => surf(skull, [0.3, mY(z) + dy, z], [-1, 0, 0])[0] - 0.008;
  for (let i = 0; i < 10; i++) for (const sd of [-1, 1]) fang(headHard, sd * lipX(0.12 + i * 0.03, 0.012), 0.12 + i * 0.03, 0.02 + rnd(i, 3) * 0.008 + (i === 8 ? 0.035 : 0), 1, i === 8 ? 0.009 : 0.0062);

  const J = [0, mY(0.065), 0.065];
  const jawHull = hull(span(HT.map((q) => ({ ...q, w: q.w * 0.96 })), 0.425, 0.0), sk);
  const jaw = [
    ...jawHull,
    sk(S.ellipsoid(0.04, 0.02, 0.1).at(0, -0.062, 0.2).blend(0.035), 'bottom'),
    under(0.5, -0.04, -0.06, -0.046, belly, 0.02, wet),
    slab(0.56, mY(0.56), -0.02, mY(-0.02), 1, 0, 0.5).cut(0.006).color(mouth),
    S.box(0.4, 0.4, 0.2, 0.01).at(0, 0, -0.06).cut(0.01).color(mouth),
    S.ellipsoid(0.036, 0.008, 0.14).at(0, -0.034, 0.25).cut(0.012).color(tone(mouth, 0, 0, -0.06)),
    S.capsule([0, -0.04, 0.1], [0, -0.036, 0.26], 0.016, 0.009).color(0xc9566a).pbr(0.3).blend(0.01),       // root of the tongue
    S.sphere(0.05).at(0, -0.03, 0.07).color(0x40141c).paint(0.03, 0),
  ];
  const jawHard = [];
  for (let i = 0; i < 9; i++) for (const sd of [-1, 1]) fang(jawHard, sd * (lipX(0.11 + i * 0.03, -0.012) - 0.004), 0.11 + i * 0.03, 0.018 + rnd(i, 7) * 0.008 + (i === 7 ? 0.028 : 0), -1, i === 7 ? 0.008 : 0.0058);
  jawHard.push(
    ...H.mirrorX([
      H.tube([[0.03, -0.075, 0.3], [0.045, -0.12, 0.27], [0.05, -0.17, 0.2], [0.04, -0.2, 0.12]], [0.007, 0.006, 0.004, 0.0015], 14, 6).color(mix(skin, belly, 0.4)).pbr(wet),   // barbels
      spike(0.035, 0.008, 0.2, 5).rot(150, 0, 12).at(0.04, -0.07, 0.16).color(bone).pbr(0.4).lod(1),
    ]),
    spike(0.045, 0.01, 0.3, 5).rot(160, 0, 0).at(0, -0.078, 0.3).color(bone).pbr(0.4).lod(2),                // chin spike
    // forked tongue
    H.tube([[0, -0.034, 0.24], [0, -0.03, 0.34], [0, -0.022, 0.42]], [0.008, 0.006, 0.0045], 8, 6).color(0xc9566a).pbr(0.3).lod(1),
    ...H.mirrorX([H.tube([[0, -0.022, 0.42], [0.008, -0.016, 0.455], [0.02, -0.006, 0.485]], [0.0045, 0.003, 0.001], 6, 5).color(0xc9566a).pbr(0.3).lod(1)]),
  );
  // frills: webbed fans hinged behind the jaw, flared by the animator
  const frill = (sd) => place(fan([{ a: -28, len: 0.13 }, { a: 4, len: 0.2 }, { a: 34, len: 0.245 }, { a: 64, len: 0.25 }, { a: 96, len: 0.21 }, { a: 128, len: 0.15 }, { a: 156, len: 0.09 }], webIn, web, boneDk, { dip: 0.24, cup: -0.06 * sd, spineR: 0.006 }), 0, 0, 0, 0, 0, 0);

  return { kind: 'serpent', nodes: [
    ROOT,
    ...segs,
    { name: 'head', parent: 'seg0', rig: 'head', pos: [0, 0, 0], rot: [8, 0, 0], prims: head, hard: headHard, detail: 1.55 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: J, rot: [14, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 1.55 },
    { name: 'frillL', parent: 'head', rig: 'frills', pos: [0.082, 0.0, 0.035], rot: [0, -34, -12], hard: frill(1) },
    { name: 'frillR', parent: 'head', rig: 'frills', pos: [-0.082, 0.0, 0.035], rot: [0, 34, 12], hard: frill(-1) },
  ] };
}
function animSerpent(model, { t, phase }) {
  const rig = model.userData.rig;
  poseChain(rig.segs, layChain((p, o) => serpCurve(p, t, phase, o), SERP.Ls, SERP.lay));
  // every so often it rears, gapes and flares its frills
  const c = frac(t * 0.16 + phase * 0.19), roar = pulse(c, 0.0, 0.32);
  R(rig.head, -roar * 0.28 + Math.sin(t * 1.3 + phase) * 0.05, Math.sin(t * 0.8 + phase * 2) * 0.16 * (1 - roar), 0);
  R(rig.jaw, Math.sin(t * 1.7 + phase) * 0.06 + roar * 0.55);
  const fl = roar * 0.5 + Math.sin(t * 2.4 + phase) * 0.06;
  if (rig.frills) { R(rig.frills[0], 0, -fl, 0); R(rig.frills[1], 0, fl, 0); }
}

// =====================================================================================
// LEVIATHAN: an ancient armoured whale, bone-plated, barnacled and scarred
// =====================================================================================
function leviathanDesc(def) {
  const base = def.color ?? 0x2a3a5a, hide = mix(tone(base, 0, -0.14, -0.01), 0x1c2228, 0.3), back = mix(tone(base, 0.01, -0.16, -0.06), 0x161a1e, 0.35), belly = 0x9aa6ac, groove = 0x66737c;
  const bone = 0x77735f, boneDk = 0x47463a, mouth = 0x6a1f2a, tooth = 0xe9e2c8, scar = mix(hide, 0xc9c0c4, 0.5), wet = 0.42;
  const CY = -0.065;
  const sk = (p, part) => (part === 'top'
    ? p.color(back).pbr(wet + 0.12).bump(0.013, 21, 'rock').tint(0.2, 7)
    : p.color(part === 'bottom' ? mix(hide, belly, 0.5) : hide).pbr(wet).bump(0.006, 20).tint(0.14, 8));
  const TAB = [
    { z: 1.27, w: 0.09, h: 0.075, y: CY + 0.03 }, { z: 1.17, w: 0.2, h: 0.16, y: CY + 0.025 }, { z: 0.96, w: 0.285, h: 0.235, y: CY + 0.012 }, { z: 0.7, w: 0.335, h: 0.275, y: CY },
    { z: 0.35, w: 0.362, h: 0.3, y: CY }, { z: 0.0, w: 0.348, h: 0.296, y: CY }, { z: -0.3, w: 0.285, h: 0.252, y: CY + 0.01 }, { z: -0.58, w: 0.192, h: 0.182, y: CY + 0.02 },
    { z: -0.82, w: 0.122, h: 0.126, y: CY + 0.03 }, { z: -1.02, w: 0.072, h: 0.08, y: CY + 0.035 }, { z: -1.2, w: 0.042, h: 0.046, y: CY + 0.04 },
  ];
  const at = (z) => station(TAB, z);
  /** a point on the hull th degrees round from the top, and the way out from it */
  const skin = (z, th, lift = 0) => { const q = at(z), a = th * DEG, nx = Math.sin(a) / q.w, ny = Math.cos(a) / q.h, nl = Math.hypot(nx, ny); return { p: [Math.sin(a) * (q.w + lift), q.y + Math.cos(a) * (q.h + lift), z], n: [nx / nl, ny / nl, 0] }; };
  const bellyLine = (z) => { const q = at(z); return q.y - q.h * 0.42; };
  const NZ = 0.6, TZ = [-0.44, -0.69, -0.92, -1.1, -1.2];        // neck joint, tail joints
  const MZ = 0.1;   // the trunk is meshed as two pieces (a fixed seam) so that neither carries every plate
  const nodeOf = (z) => { if (z >= NZ) return 'head'; if (z >= MZ) return 'body'; if (z >= TZ[0]) return 'rear'; for (let i = 0; i < 4; i++) if (z >= TZ[i + 1]) return `tail${i}`; return 'tail3'; };
  const prims = { head: [], body: [], rear: [], tail0: [], tail1: [], tail2: [], tail3: [] }, hard = { head: [], body: [], rear: [], tail0: [], tail1: [], tail2: [], tail3: [] };
  const ORG = { head: [0, at(NZ).y, NZ], body: [0, CY, 0.1] };
  for (let i = 0; i < 4; i++) ORG[`tail${i}`] = [0, at(TZ[i]).y, TZ[i]];

  // ---- hulls ----
  prims.head.push(...hull(span(TAB, 1.27, NZ), sk));
  prims.body.push(...hull(span(TAB, NZ, MZ), sk));
  prims.rear.push(...hull(span(TAB, MZ, TZ[0]), sk));
  for (let i = 0; i < 4; i++) prims[`tail${i}`].push(...hull(span(TAB, TZ[i], TZ[i + 1]), sk));
  const headHull = prims.head.slice();
  // pale underside; the front of the trunk shows through the open mouth as the back of the throat
  prims.head.push(under(1.3, bellyLine(1.27) + 0.02, NZ - 0.06, bellyLine(NZ), belly, 0.03, wet));
  prims.body.push(S.box(1.4, 1.2, 0.6, 0.02).at(0, CY, NZ + 0.15 + 0.3).color(0x2a0a10).pbr(0.5).paint(0.03, 0));
  prims.body.push(under(NZ + 0.06, bellyLine(NZ), MZ - 0.1, bellyLine(MZ - 0.1), belly, 0.04, wet));
  prims.rear.push(under(MZ + 0.1, bellyLine(MZ + 0.1), TZ[0] - 0.06, bellyLine(TZ[0]), belly, 0.04, wet));
  for (let i = 0; i < 4; i++) prims[`tail${i}`].push(under(TZ[i] + 0.06, bellyLine(TZ[i] + 0.06), TZ[i + 1] - 0.06, bellyLine(TZ[i + 1] - 0.06), belly, 0.03, wet));
  // throat grooves along the chest
  for (let k = -4; k <= 4; k++) {
    const th = 180 + k * 11;
    for (const [n, z0, z1] of [['body', NZ + 0.03, MZ - 0.04], ['rear', MZ + 0.04, -0.05 - Math.abs(k) * 0.03]]) {
      const a = skin(z0, th), b = skin(z1, th);
      prims[n].push(S.capsule(a.p, b.p, 0.012, 0.008).color(groove).paint(0.006, -0.008));
    }
  }

  // ---- armour: a row of keeled scutes down the spine, embossed plates shingled over the flanks ----
  const scute = (z, k, tall) => {
    const n = nodeOf(z), q = skin(z, 0), col = mix(bone, boneDk, rnd(Math.round(z * 100), 3) * 0.55), rw = 0.105 * k, rz = 0.078 * (0.55 + 0.45 * k);
    prims[n].push(
      S.ellipsoid(rw, 0.034 * k + 0.008, rz).rot(-7, 0, 0).at(0, q.p[1] + 0.006, z).color(col).pbr(0.8).bump(0.008, 30, 'rock').tint(0.3, 16).blend(0.012),
      S.capsule([0, q.p[1] + 0.02 * k, z + rz * 0.72], [0, q.p[1] + (0.04 + tall * 1.5) * k, z - rz * 0.66], 0.014 * k + 0.004, 0.028 * k + 0.004).color(mix(col, 0xb9b299, 0.3)).pbr(0.75).bump(0.004, 34, 'rock').blend(0.016),
    );
  };
  const plate = (z, th, rw, rz, raise) => {
    const id = Math.round(z * 100) * 7 + Math.round(th), col = mix(bone, boneDk, 0.15 + rnd(id, 1) * 0.7);
    z += (rnd(id, 2) - 0.5) * 0.03; th += (rnd(id, 3) - 0.5) * 5; rw *= 0.82 + rnd(id, 4) * 0.36; rz *= 0.82 + rnd(id, 5) * 0.36;
    const n = nodeOf(z), q = skin(z, th);
    prims[n].push(
      S.box(rw * 2, 0.16, rz * 2, Math.min(rw, rz) * 0.7).rot(0, (rnd(id, 6) - 0.5) * 30, 0).rot(0, 0, -th).at(q.p[0], q.p[1], q.p[2]).color(col).pbr(0.82).bump(0.008, 24, 'rock').tint(0.3, 16).paint(0.006, raise),
      S.capsule([q.p[0], q.p[1], z + rz * 0.6], [q.p[0], q.p[1], z - rz * 0.6], 0.012, 0.016).color(mix(col, 0xb9b299, 0.25)).pbr(0.78).paint(0.006, raise * 0.5),     // low keel
    );
  };
  for (let i = 0; i < 13; i++) {
    const z = 0.5 - i * 0.134, k = clamp(at(z).w / 0.36, 0.22, 1);
    scute(z, k, i % 3 === 1 ? 0.075 : 0.036);
    if (i < 11) for (const sd of [-1, 1]) {
      plate(z - 0.067, sd * 27, 0.074 * k, 0.058 * (0.6 + 0.4 * k), 0.024 * k + 0.004);
      if (i < 9) plate(z, sd * 51, 0.066 * k, 0.056, 0.02 * k + 0.003);
      if (i < 7 && i > 0) plate(z - 0.067, sd * 73, 0.05 * k, 0.05, 0.015 * k + 0.002);
    }
  }
  // head shield: one great sutured plate over the skull, swelling into a ram over the snout
  const shieldTop = (z) => at(z).y + at(z).h;
  prims.head.push(
    S.ellipsoid(0.27, 0.11, 0.395).at(0, shieldTop(0.95) - 0.072, 0.95).color(mix(bone, boneDk, 0.25)).pbr(0.84).bump(0.015, 27, 'rock').tint(0.55, 13).blend(0.012),
    S.ellipsoid(0.25, 0.085, 0.17).at(0, shieldTop(0.76) - 0.05, 0.765).color(mix(bone, boneDk, 0.4)).pbr(0.84).bump(0.015, 27, 'rock').tint(0.55, 13).blend(0.012),            // nape plate
    S.ellipsoid(0.17, 0.07, 0.13).at(0, shieldTop(1.16) - 0.012, 1.15).color(mix(bone, 0xb9b299, 0.25)).pbr(0.8).bump(0.014, 20, 'rock').tint(0.35, 10).blend(0.03),       // the ram
    S.box(0.014, 0.4, 0.9, 0.005).at(0, shieldTop(0.95), 0.9).color(boneDk).paint(0.005, -0.012),
    S.box(0.7, 0.4, 0.014, 0.005).rot(0, 12, 0).at(0.1, shieldTop(0.95), 0.82).color(boneDk).paint(0.005, -0.011),
    S.box(0.7, 0.4, 0.014, 0.005).rot(0, -12, 0).at(-0.1, shieldTop(0.95), 0.82).color(boneDk).paint(0.005, -0.011),
    S.box(0.7, 0.4, 0.014, 0.005).rot(0, -9, 0).at(0, shieldTop(0.95), 1.03).color(boneDk).paint(0.005, -0.011),
    ...S.mirrorX([
      S.capsule([0.2, CY + 0.11, 1.02], [0.31, CY + 0.075, 0.68], 0.034, 0.046).color(mix(bone, boneDk, 0.3)).pbr(0.78).bump(0.008, 24, 'rock').blend(0.022),            // brow ridge
      S.ellipsoid(0.036, 0.034, 0.05).at(0.1, shieldTop(1.2) + 0.012, 1.19).color(mix(bone, 0xcfc8ae, 0.4)).pbr(0.7).blend(0.014),                                      // bosses on the ram
      S.ellipsoid(0.03, 0.03, 0.04).at(0.15, shieldTop(1.08) + 0.004, 1.1).color(mix(bone, 0xcfc8ae, 0.4)).pbr(0.7).blend(0.014),
      S.ellipsoid(0.034, 0.032, 0.045).at(0.25, CY + 0.13, 0.86).color(mix(bone, 0xcfc8ae, 0.4)).pbr(0.7).blend(0.014),
    ]),
    S.ellipsoid(0.04, 0.04, 0.05).at(0, shieldTop(1.22) - 0.005, 1.25).color(mix(bone, 0xcfc8ae, 0.4)).pbr(0.7).blend(0.014),
  );
  // old wounds pitted into the shield itself
  for (let i = 0; i < 12; i++) {
    const x = (rnd(i, 31) - 0.5) * 0.3, z = 0.9 + rnd(i, 32) * 0.3, e = 1 - (x / 0.27) ** 2 - ((z - 0.95) / 0.395) ** 2;
    prims.head.push(S.sphere(0.01 + rnd(i, 33) * 0.012).at(x, shieldTop(0.95) - 0.072 + 0.11 * Math.sqrt(Math.max(0, e)) + 0.006, z).cut(0.006).color(boneDk));
  }
  // weed and algae in the lee of the plates
  for (let i = 0; i < 9; i++) { const z = 0.45 - i * 0.2, q = skin(z, (i % 2 ? 1 : -1) * (14 + rnd(i, 5) * 20)); prims[nodeOf(z)].push(S.sphere(0.05 + rnd(i, 7) * 0.03).at(q.p[0], q.p[1], q.p[2]).color(0x4a5a3c).pbr(0.9).paint(0.035, 0)); }
  // blowholes on a mound behind the shield
  prims.body.push(
    sk(S.ellipsoid(0.07, 0.03, 0.08).at(0, shieldTop(0.52) - 0.005, 0.52).blend(0.03), 'top'),
    ...S.mirrorX([S.ellipsoid(0.012, 0.03, 0.03).rot(0, 18, 0).at(0.02, shieldTop(0.52) + 0.022, 0.525).cut(0.006).color(0x0a0c10)]),
  );
  // scars
  for (const [z, th, len, ang, w] of [[0.24, 93, 0.36, 14, 0.008], [0.2, 99, 0.3, 12, 0.007], [0.16, 105, 0.22, 10, 0.006], [-0.16, -96, 0.3, -18, 0.008], [-0.2, -103, 0.2, -16, 0.006], [0.9, 96, 0.16, 30, 0.006]]) {
    const q = skin(z, th);
    prims[nodeOf(z)].push(S.ellipsoid(0.1, w, len / 2).rot(ang, 0, -th).at(q.p[0], q.p[1], q.p[2]).color(scar).pbr(0.6).paint(0.005, -0.007));
  }

  // ---- barnacles, in colonies ----
  const colony = (z, th, count, r, seed) => {
    for (let i = 0; i < count; i++) {
      const zz = z + (rnd(i, seed) - 0.5) * r * 9, tt = th + (rnd(i, seed + 20) - 0.5) * r * 1400, q = skin(zz, tt, 0.004), rr = r * (0.55 + rnd(i, seed + 40) * 0.9);
      hard[nodeOf(zz)].push(barnacle(rr, [q.p[0] - q.n[0] * rr * 0.1, q.p[1] - q.n[1] * rr * 0.1, zz], q.n).lod(rr > 0.03 ? 2 : 1));
    }
  };
  colony(1.04, 26, 9, 0.024, 1); colony(0.84, -40, 8, 0.022, 2); colony(1.17, -16, 5, 0.018, 3); colony(0.72, 58, 7, 0.022, 4);
  colony(0.42, -84, 10, 0.026, 5); colony(0.1, 86, 9, 0.025, 6); colony(-0.2, -80, 7, 0.022, 7); colony(0.27, 12, 5, 0.018, 8);
  colony(-0.52, 62, 6, 0.018, 9); colony(-0.8, -40, 5, 0.014, 10); colony(0.0, -100, 7, 0.022, 11); colony(0.5, 100, 6, 0.02, 12);
  colony(-0.36, 14, 5, 0.018, 13); colony(0.62, -96, 6, 0.022, 14);

  // ---- harpoons from forgotten hunts ----
  { const q = skin(0.22, -24); hard[nodeOf(0.22)].push(harpoon(q.p, [-0.35, 0.8, -0.45], 0.1, [-0.05, -0.1, -0.12])); }
  { const q = skin(-0.08, 30); hard[nodeOf(-0.08)].push(harpoon(q.p, [0.3, 0.75, -0.6], 0.085, [0.07, -0.09, -0.1])); }
  { const q = skin(0.34, 44); hard[nodeOf(0.34)].push(harpoon(q.p, [0.6, 0.6, -0.5], 0.075, [0.03, -0.12, -0.06])); }

  // ---- head: eye, mouth ----
  const mY = (z) => at(z).y - at(z).h * lerp(0.12, 0.3, clamp((z - NZ) / 0.6, 0, 1));
  const hingeZ = NZ + 0.04;
  prims.head.push(
    slab(1.45, mY(1.27) + (mY(1.27) - mY(hingeZ)) * 0.25, hingeZ, mY(hingeZ), -1, 0, 0.6).cut(0.008).color(mouth),
    S.ellipsoid(0.17, 0.09, 0.3).at(0, mY(0.95) + 0.01, 0.95).cut(0.03).color(tone(mouth, 0, 0, -0.08)),               // vault of the palate
    S.sphere(0.2).at(0, mY(hingeZ), hingeZ + 0.03).color(0x1a060a).paint(0.12, 0),                                       // gullet
  );
  const eyeP = surf(headHull, [0.6, mY(0.74) + 0.07, 0.74], [-1, 0, 0]);
  prims.head.push(...S.mirrorX([
    S.ellipsoid(0.03, 0.04, 0.05).at(eyeP[0] + 0.004, eyeP[1], eyeP[2]).color(mix(hide, belly, 0.25)).pbr(0.6).blend(0.02),                      // wrinkled socket
    S.sphere(0.024).at(eyeP[0] + 0.01, eyeP[1], eyeP[2]).cut(0.006).color(0x0c0e12),
    S.torus(0.03, 0.004).rot(0, 0, 90).at(eyeP[0] + 0.022, eyeP[1], eyeP[2]).color(mix(hide, 0x10141c, 0.5)).paint(0.004, -0.003),
    S.torus(0.042, 0.004).rot(0, 0, 90).at(eyeP[0] + 0.018, eyeP[1] - 0.004, eyeP[2] - 0.004).color(mix(hide, 0x10141c, 0.5)).paint(0.004, -0.003),
  ]));
  hard.head.push(...H.mirrorX([eye(0.02, { iris: 0xb9d0da, rim: 0x4a6070, white: 0xe2decd, pupilDeg: 13, irisDeg: 50, rough: 0.12, glow: 0.12 }).rot(0, 84, 0).at(eyeP[0] - 0.003, eyeP[1], eyeP[2])]));
  // upper teeth: worn pegs along the lip
  const lipX = (z, dy) => surf(headHull, [0.6, mY(z) + dy, z], [-1, 0, 0])[0];
  for (let i = 0; i < 11; i++) for (const sd of [-1, 1]) {
    const z = 0.72 + i * 0.047, len = 0.034 + rnd(i, sd + 3) * 0.014;
    hard.head.push(spike(len, 0.012, 0.15, 6).rot(180, 0, 0).at(sd * (lipX(z, 0.02) - 0.022), mY(z) + 0.006, z).color(mix(tooth, 0x9a8a60, rnd(i, sd + 9) * 0.5)).pbr(0.35).lod(1));
  }

  // ---- lower jaw ----
  const J = [0, mY(hingeZ), hingeZ];
  const jawHull = hull(span(TAB.map((q) => ({ ...q, w: q.w * 0.985 })), 1.25, NZ - 0.04), sk);
  const jaw = [
    ...jawHull,
    under(1.3, bellyLine(1.27) + 0.02, NZ - 0.1, bellyLine(NZ), belly, 0.03, wet),
    slab(1.45, mY(1.27) + (mY(1.27) - mY(hingeZ)) * 0.25, NZ - 0.12, mY(hingeZ) - (mY(1.27) - mY(hingeZ)) * 0.25, 1, 0, 0.7).cut(0.008).color(mouth),
    S.box(1, 1, 0.3, 0.01).at(0, CY, NZ - 0.17).cut(0.01).color(mouth),
    S.ellipsoid(0.16, 0.035, 0.27).at(0, mY(0.95) - 0.012, 0.95).cut(0.03).color(tone(mouth, 0, 0, -0.06)),
    S.ellipsoid(0.1, 0.035, 0.2).at(0, mY(0.9) - 0.045, 0.9).color(0x8a3442).pbr(0.35).bump(0.004, 30).blend(0.02),        // tongue
    S.sphere(0.2).at(0, mY(hingeZ), hingeZ + 0.03).color(0x1a060a).paint(0.12, 0),
  ];
  for (let k = -3; k <= 3; k++) { const a = skin(1.1 - Math.abs(k) * 0.03, 180 + k * 12), b = skin(NZ + 0.02, 180 + k * 11); jaw.push(S.capsule(a.p, b.p, 0.008, 0.012).color(groove).paint(0.006, -0.008)); }
  const jawHard = [];
  for (let i = 0; i < 10; i++) for (const sd of [-1, 1]) {
    const z = 0.745 + i * 0.047, len = 0.05 + rnd(i, sd + 13) * 0.02 + (i === 8 ? 0.03 : 0);
    jawHard.push(spike(len, 0.015, 0.2, 6).at(sd * (lipX(z, -0.02) * 0.985 - 0.03), mY(z) - 0.008, z).color(mix(tooth, 0x9a8a60, rnd(i, sd + 19) * 0.5)).pbr(0.35).lod(1));
  }
  { const q = skin(1.0, 168, 0.003); jawHard.push(barnacle(0.016, q.p, q.n).lod(2), barnacle(0.011, [q.p[0] + 0.03, q.p[1] + 0.004, q.p[2] + 0.02], q.n).lod(1), barnacle(0.012, [q.p[0] - 0.01, q.p[1], q.p[2] - 0.035], q.n).lod(1)); }

  // ---- flippers ----
  const flipper = (sd) => [
    blade({ span: 0.56, chord: 0.2, tip: 0.5, sweep: 0.28, thick: 0.13, rows: 12, seg: 8 }).shade((x, y, z) => {
      const knob = Math.sin(y * 62) > 0.4 && z > 0.02 ? 0.25 : 0;
      return mix(x * sd > 0 ? mix(hide, belly, 0.55) : back, bone, knob);
    }).pbr(wet + 0.05),
  ];
  const finL = flipper(1), finR = flipper(-1);
  finL.push(barnacle(0.012, [-0.012, 0.3, 0.04], [-1, 0, 0.2]).lod(1), barnacle(0.009, [-0.012, 0.36, 0.01], [-1, 0, 0.2]).lod(1));

  // ---- tail flukes ----
  for (const sd of [-1, 1]) {
    hard.tail3.push(blade({ span: 0.4, chord: 0.25, tip: 0.2, sweep: 0.5, thick: 0.1, falcate: 0.45, rows: 11, notch: sd > 0 ? [0.5, 0.12, 0.06] : null }).shade((x, y) => mix(back, 0x151a26, clamp(y / 0.4, 0, 1) * 0.5)).pbr(wet).rot(0, 0, -90 * sd).at(sd * 0.01, at(-1.19).y, -1.2));
  }
  prims.tail3.push(sk(S.ellipsoid(0.07, 0.022, 0.06).at(0, at(-1.19).y, -1.19).blend(0.03), 'top'));

  // ---- spout: a column of mist and fine spray the animator blows from time to time ----
  const mist = 0xe4f1f8, spoutHard = [], mp = (q) => q.color(mist).pbr(1).glow(0.28);
  const spout = [
    mp(S.cone(0.012, 0.03, 0.26, 0.01).at(0, 0.13, -0.01)).bump(0.012, 26),
    mp(S.capsule([0, 0.24, -0.02], [0.075, 0.4, -0.06], 0.03, 0.045)).bump(0.024, 21).blend(0.04),
    mp(S.capsule([0, 0.24, -0.02], [-0.08, 0.41, -0.05], 0.03, 0.042)).bump(0.024, 21).blend(0.04),
    mp(S.ellipsoid(0.035, 0.05, 0.035).at(0.0, 0.36, -0.1)).bump(0.02, 23).blend(0.04),
    mp(S.sphere(0.022).at(0.12, 0.45, -0.09)).bump(0.012, 30).blend(0.02),
    mp(S.sphere(0.02).at(-0.13, 0.46, -0.08)).bump(0.012, 30).blend(0.02),
  ];
  // a plug buried in the blowhole keeps this node from being empty at the far levels (an empty level would
  // fall back to the nearer one and leave the whole plume standing in the distant mesh)
  spoutHard.push(H.cyl(0.04, 0.04, 0.012, 6).at(0, -0.06, 0).color(back).pbr(0.6));
  // the mist is sculpted once and carried as a hard piece, so that it can be left off the far detail levels
  const mistGeo = buildPartGeometry({ prims: spout }, { res: 60, ao: 0.35 });
  if (mistGeo) spoutHard.push(H.geo(mistGeo).shade((x, y, z) => mix(0x8fb2c8, 0xffffff, clamp(y / 0.42, 0, 1) * 0.55 + noise3(x * 30, y * 30, z * 30) * 0.45)).pbr(1).glow(0.1).lod(1));
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * PI * 2 + rnd(i, 61), out = 0.06 + rnd(i, 62) * 0.12, up = 0.36 + rnd(i, 63) * 0.2, bx = Math.cos(a) * out, bz = Math.sin(a) * out * 0.7 - 0.07;
    spoutHard.push(H.tube([[bx * 0.2, 0.2, bz * 0.2], [bx * 0.6, up * 0.8, bz * 0.6], [bx * 0.9, up, bz * 0.9], [bx * 1.15, up * 0.94, bz * 1.15]], [0.006, 0.0045, 0.003, 0.001], 8, 4).color(mist).pbr(1).glow(0.28).lod(1));
    for (let k = 0; k < 2; k++) spoutHard.push(H.sphere(0.004 + rnd(i * 3 + k, 64) * 0.005, 6).at(bx * (1.2 + k * 0.16) + (rnd(i * 3 + k, 65) - 0.5) * 0.03, up * (0.9 - k * 0.15) + rnd(i * 3 + k, 66) * 0.04, bz * (1.2 + k * 0.16)).color(mist).pbr(1).glow(0.28).lod(0));
  }

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const nodes = [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: ORG.body, prims: into(ORG.body, prims.body), hard: into(ORG.body, hard.body), detail: 0.72 },
    { name: 'rear', parent: 'body', pos: [0, 0, 0], prims: into(ORG.body, prims.rear), hard: into(ORG.body, hard.rear), detail: 0.72 },
    { name: 'head', parent: 'body', rig: 'head', pos: sub(ORG.head, ORG.body), rot: [-3, 0, 0], prims: into(ORG.head, prims.head), hard: into(ORG.head, hard.head), detail: 0.8 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: sub(J, ORG.head), rot: [9, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 0.7 },
    { name: 'finL', parent: 'body', rig: 'fins', pos: sub([0.3, CY - 0.17, 0.42], ORG.body), rot: [-24, -12, -116], hard: finL },
    { name: 'finR', parent: 'body', rig: 'fins', pos: sub([-0.3, CY - 0.17, 0.42], ORG.body), rot: [-24, 12, 116], hard: finR },
    { name: 'spout', parent: 'body', rig: 'core', pos: sub([0, shieldTop(0.52) + 0.01, 0.52], ORG.body), rot: [-10, 0, 0], hard: spoutHard },
  ];
  for (let i = 0; i < 4; i++) nodes.push({ name: `tail${i}`, parent: i ? `tail${i - 1}` : 'body', rig: 'tail', pos: sub(ORG[`tail${i}`], i ? ORG[`tail${i - 1}`] : ORG.body), prims: into(ORG[`tail${i}`], prims[`tail${i}`]), hard: into(ORG[`tail${i}`], hard[`tail${i}`]), detail: 0.72 });
  return { kind: 'leviathan', nodes };
}
function animLeviathan(model, { t, phase }) {
  const rig = model.userData.rig;
  const w = t * 1.5 + phase;
  // a long breath: the head heaves up, the jaw falls open, then the spout goes
  const c = frac(t * 0.115 + phase * 0.173), gape = pulse(c, 0.0, 0.38), blow = pulse(c, 0.34, 0.62);
  R(rig.body, Math.sin(w * 0.5) * 0.015 - gape * 0.24, 0, Math.sin(w * 0.37) * 0.02);
  P(rig.body, 0, gape * 0.06, 0);
  R(rig.head, -gape * 0.1 + Math.sin(w * 0.5 + 1) * 0.012);
  R(rig.jaw, 0.02 + Math.sin(t * 0.8 + phase) * 0.03 + gape * 0.58);
  (rig.tail || []).forEach((n, i) => R(n, Math.sin(w - i * 0.62) * (0.07 + i * 0.045) - gape * 0.06, 0, 0));
  (rig.fins || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, Math.sin(w * 0.8 + i * 2.1) * 0.12, 0, sg * (Math.sin(w * 0.8 + i * 2.1 + 0.8) * 0.16 + pulse(frac(c + 0.5 + i * 0.07), 0, 0.3) * 0.5)); });
  if (rig.core) {
    const k = blow;
    rig.core.visible = k > 0.02;
    rig.core.scale.set(0.5 + k * 0.6, Math.max(0.02, Math.sin(Math.min(1, (c - 0.34) / 0.1) * PI * 0.5) * (0.4 + k * 0.7)), 0.5 + k * 0.6);
  }
}

// =====================================================================================
// KRAKEN: a warty, wine-dark mantle, two baleful eyes, a beak, eight arms and two hunting tentacles
// =====================================================================================
const KRAKEN = {
  armYaw: [20, -20, 62, -62, 108, -108, 152, -152], tentYaw: [84, -84], NA: 7, NT: 7,
  armLen: [0.17, 0.17, 0.165, 0.16, 0.155, 0.15, 0.14], armR: [0.086, 0.074, 0.062, 0.05, 0.039, 0.029, 0.02, 0.012],
  tentLen: [0.22, 0.22, 0.22, 0.21, 0.2, 0.15, 0.15], tentR: [0.04, 0.036, 0.032, 0.03, 0.028, 0.03, 0.042, 0.016],
  low: [7, -15, -16, 3, 15, -22, -34], high: [-38, -24, -8, 9, 20, -18, -38], tent: [-50, -26, -10, 6, 20, 26, 18],
};
function krakenDesc(def) {
  const base = def.color ?? 0x7a2a4a, skin = tone(base, 0, -0.04, -0.035), dark = mix(skin, 0x1a0a14, 0.5), pale = 0xdcb6a8, spot = mix(skin, 0xe8a886, 0.5);
  const cup = 0xead6c4, cupIn = 0xb5707a, beak = 0x1c1612, wet = 0.34;
  const hide = (p) => p.color(skin).pbr(wet).bump(0.007, 22, 'scales').tint(0.2, 9);
  const smoothHide = (p) => p.color(skin).pbr(wet).bump(0.003, 30).tint(0.2, 9);

  // ---- head: eye turrets, brows, the skirt the arms grow from ----
  const TUR = [0.185, 0.17, 0.2], ED = [0.61, 0.13, 0.78], eyeC = [TUR[0] + ED[0] * 0.058, TUR[1] + ED[1] * 0.058, TUR[2] + ED[2] * 0.058], ER = 0.094;
  const head = [
    hide(S.ellipsoid(0.27, 0.19, 0.25).at(0, 0.1, 0.1)),
    hide(S.ellipsoid(0.34, 0.13, 0.34).at(0, -0.035, 0.07).blend(0.07)),
    ...S.mirrorX([hide(S.sphere(0.126).at(TUR[0], TUR[1], TUR[2]).blend(0.05))]),
    hide(S.ellipsoid(0.1, 0.08, 0.1).at(0, 0.02, 0.33).blend(0.05)).color(mix(skin, pale, 0.3)),                          // lips round the beak
    // funnel
    smoothHide(S.capsule([-0.2, 0.02, -0.02], [-0.36, 0.06, 0.06], 0.06, 0.042).blend(0.04)).color(mix(skin, pale, 0.35)),
  ];
  const headBase = head.slice();
  head.push(
    S.sphere(0.07).at(0, 0.02, 0.41).cut(0.02).color(0x3a1420),
    S.capsule([-0.33, 0.055, 0.045], [-0.42, 0.075, 0.09], 0.026, 0.028).cut(0.008).color(0x3a1420),
    ...S.mirrorX([
      S.sphere(ER * 1.04).at(eyeC[0], eyeC[1], eyeC[2]).cut(0.012).color(0x1a0a12),
      // heavy lid drawn down toward the middle, and a fold beneath
      hide(S.ellipsoid(0.115, 0.036, 0.1).rot(0, 38, 0).rot(0, 0, 20).at(eyeC[0] - 0.014, eyeC[1] + 0.082, eyeC[2] + 0.004).blend(0.024)).color(mix(skin, dark, 0.55)),
      hide(S.capsule([eyeC[0] - 0.08, eyeC[1] - 0.084, eyeC[2] + 0.062], [eyeC[0] + 0.075, eyeC[1] - 0.074, eyeC[2] - 0.058], 0.018, 0.024).blend(0.02)).color(mix(skin, dark, 0.35)),
    ]),
    under(0.6, -0.085, -0.4, -0.085, pale, 0.03, wet),
  );
  for (let i = 0; i < 12; i++) {
    const a = rnd(i, 71) * PI * 2, e = 0.25 + rnd(i, 72) * 1.0, q = surf(headBase, [Math.sin(a) * Math.cos(e) * 0.7, 0.1 + Math.sin(e) * 0.7, 0.1 + Math.cos(a) * Math.cos(e) * 0.7], [-Math.sin(a) * Math.cos(e), -Math.sin(e), -Math.cos(a) * Math.cos(e)]);
    head.push(S.sphere(0.012 + rnd(i, 73) * 0.018).at(q[0], q[1], q[2]).color(spot).paint(0.008, 0.002));
  }
  const beakCol = (x, y) => (y > 0.72 ? 0x5a4630 : null);
  const headHard = [
    ...H.mirrorX([eye(ER, { iris: 0xf0c02a, rim: 0x8a3a08, white: 0xf0c02a, shape: 'bar', pupilDeg: 21, irisDeg: 62, rough: 0.07, glow: 0.3, seg: 28 }).rot(-13, 31, 0).at(eyeC[0], eyeC[1], eyeC[2])]),
    // upper beak: a hooked horn
    spike(0.13, 0.058, 0.55, 9, 0.8).rot(112, 0, 0).at(0, 0.08, 0.33).color(beak).pbr(0.22).shade(beakCol),
  ];
  const jawHard = [spike(0.1, 0.048, 0.5, 9, 0.8).rot(-108, 180, 0).at(0, -0.045, 0.03).color(beak).pbr(0.22).shade(beakCol)];

  // ---- mantle: baggy, warted, crested, leaning back over the water ----
  const mantle = [
    hide(S.ellipsoid(0.3, 0.27, 0.27).at(0, 0.17, 0)),
    hide(S.ellipsoid(0.25, 0.3, 0.225).at(0, 0.42, 0.01).blend(0.09)),
    hide(S.ellipsoid(0.165, 0.22, 0.15).at(0, 0.65, 0.0).blend(0.09)),
    hide(S.sphere(0.075).at(0, 0.84, -0.01).blend(0.07)),
    smoothHide(S.torus(0.262, 0.05).at(0, 0.035, 0).blend(0.035)).color(mix(skin, pale, 0.25)),                           // collar
  ];
  const crestPts = [[0, 0.1, -0.27], [0, 0.3, -0.265], [0, 0.5, -0.21], [0, 0.68, -0.14], [0, 0.84, -0.06]];
  mantle.push(...S.limb(crestPts, [0.03, 0.04, 0.04, 0.032, 0.022]).map((q) => hide(q.blend(0.035)).color(dark)));
  for (let i = 0; i < 6; i++) {
    const f = 0.08 + i * 0.165, k = Math.min(crestPts.length - 2, Math.floor(f * (crestPts.length - 1))), u = f * (crestPts.length - 1) - k, a = crestPts[k], b = crestPts[k + 1];
    const y = lerp(a[1], b[1], u), z = lerp(a[2], b[2], u), len = 0.11 - Math.abs(i - 2.5) * 0.012;
    mantle.push(hide(S.cone(0.034, 0.008, len, 0.008).at(0, len / 2, 0).rot(-62 - i * 4, 0, 0).at(0, y, z - 0.02).blend(0.022)).color(mix(dark, skin, 0.3)));
  }
  const mantleBase = mantle.slice(0, 4);
  for (let i = 0; i < 34; i++) {
    const a = rnd(i, 81) * PI * 2, y = 0.1 + rnd(i, 82) * 0.72, q = surf(mantleBase, [Math.sin(a) * 0.6, y, Math.cos(a) * 0.6], [-Math.sin(a), 0, -Math.cos(a)]);
    const r = 0.014 + rnd(i, 83) ** 2 * 0.036;
    mantle.push(S.sphere(r).at(q[0], q[1], q[2]).color(spot).paint(0.008, 0.003));
    if (r > 0.03) mantle.push(S.sphere(r * 0.5).at(q[0], q[1], q[2]).color(mix(skin, dark, 0.6)).paint(0.008, 0));
  }
  for (let i = 0; i < 9; i++) {   // warts
    const a = PI + (rnd(i, 91) - 0.5) * 3.4, y = 0.16 + rnd(i, 92) * 0.6, q = surf(mantleBase, [Math.sin(a) * 0.6, y, Math.cos(a) * 0.6], [-Math.sin(a), 0, -Math.cos(a)]);
    mantle.push(hide(S.sphere(0.02 + rnd(i, 93) * 0.018).at(q[0], q[1], q[2]).blend(0.02)).color(mix(skin, dark, 0.5)));
  }
  const mantleHard = H.mirrorX([
    blade({ span: 0.2, chord: 0.3, tip: 0.5, sweep: 0.15, thick: 0.1, rows: 8, seg: 6 }).shade((x, y) => mix(skin, spot, clamp(y / 0.2, 0, 1) ** 2 * 0.7)).pbr(wet).rot(90, 0, 0).rot(0, 0, -78).at(0.13, 0.64, -0.03),
  ]);

  // ---- arms and tentacles ----
  const suckerGeo = (seg) => cached(`sucker${seg}`, () => new THREE.LatheGeometry([[0.6, -0.1], [1, 0.3], [0.9, 0.52], [0.36, 0.2]].map(([r, y]) => new THREE.Vector2(r, y)), seg));
  const sucker = (r, p, n) => aim(H.geo(suckerGeo(r > 0.02 ? 11 : 7)).shade((x, y, z) => (Math.hypot(x, z) < 0.7 && y < 0.47 ? cupIn : null)).scale(r), p, n).color(cup).pbr(0.4);
  const limbSeg = (r0, r1, L, seed, o = {}) => {
    const prims = [
      (o.smooth ? smoothHide : hide)(S.capsule([0, 0, 0], [0, 0, L], r0, r1)),
      S.box(1, 0.5, L + 0.3, 0.02).at(0, -0.25 - r0 * (o.smooth ? 0.55 : 0.3), L / 2).color(pale).pbr(wet + 0.05).paint(r0 * 0.3, 0),
    ];
    for (let k = 0; k < 2; k++) { const z = L * (0.25 + 0.5 * rnd(seed, k + 3)), a = (rnd(seed, k + 5) - 0.5) * 1.6, r = lerp(r0, r1, z / L); prims.push(S.sphere(r * (0.2 + rnd(seed, k + 7) * 0.2)).at(Math.sin(a) * r, Math.cos(a) * r, z).color(spot).paint(0.006, 0.002)); }
    const hard = [H.geo(coreGeo(r0, r1, L)).shade((x, y) => (y < -r1 * 0.25 ? pale : skin)).pbr(wet)];
    const n = o.suckers ?? Math.max(2, Math.round(L / (r0 * 1.15)));
    for (let k = 0; k < n; k++) for (const sd of [-1, 1]) {
      const z = L * (k + 0.5 + (sd > 0 ? 0.2 : -0.2)) / n, r = lerp(r0, r1, z / L), a = sd * 27 * DEG;
      hard.push(sucker(r * 0.4, [Math.sin(a) * r * 0.93, -Math.cos(a) * r * 0.93, z], [Math.sin(a), -Math.cos(a), 0]).lod(r0 > 0.05 ? 1 : 0));
    }
    return { prims, hard };
  };
  const nodes = [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: [0, 0, 0], prims: head, hard: headHard, detail: 1 },
    { name: 'jaw', parent: 'body', rig: 'jaw', pos: [0, 0.04, 0.32], rot: [10, 0, 0], hard: jawHard },
    { name: 'mantle', parent: 'body', rig: 'core', pos: [0, 0.06, -0.04], rot: [-36, 0, 0], prims: mantle, hard: mantleHard, detail: 0.85 },
  ];
  KRAKEN.armYaw.forEach((yaw, a) => {
    const sd = yaw > 0 ? 1 : -1, rest = (a >> 1) === 2 ? KRAKEN.high : KRAKEN.low, y = yaw * DEG;
    nodes.push({ name: `armBase${a}`, parent: 'body', pos: [Math.sin(y) * 0.25, -0.03, 0.07 + Math.cos(y) * 0.25], rot: [0, yaw, sd * 24] });
    for (let j = 0; j < KRAKEN.NA; j++) {
      const g = limbSeg(KRAKEN.armR[j], KRAKEN.armR[j + 1], KRAKEN.armLen[j], a * 10 + j);
      nodes.push({ name: `arm${a}_${j}`, parent: j ? `arm${a}_${j - 1}` : `armBase${a}`, rig: 'arms', pos: j ? [0, 0, KRAKEN.armLen[j - 1]] : [0, 0, 0], rot: [rest[j] + (rnd(a, j) - 0.5) * 10, (rnd(a, j + 9) - 0.5) * 14, 0], prims: g.prims, hard: g.hard, detail: 0.69 });
    }
  });
  KRAKEN.tentYaw.forEach((yaw, a) => {
    const sd = yaw > 0 ? 1 : -1, y = yaw * DEG;
    nodes.push({ name: `tentBase${a}`, parent: 'body', pos: [Math.sin(y) * 0.24, 0.0, 0.07 + Math.cos(y) * 0.24], rot: [0, yaw - sd * 46, sd * 10] });
    for (let j = 0; j < 7; j++) {
      const club = j >= 5, L = KRAKEN.tentLen[j];
      let g;
      if (!club) g = limbSeg(KRAKEN.tentR[j], KRAKEN.tentR[j + 1], L, 100 + a * 10 + j, { smooth: true, suckers: 0 });
      else {
        // the club: a flattened paddle, its palm studded with big suckers and hooks
        const r0 = KRAKEN.tentR[j], r1 = KRAKEN.tentR[j + 1], w0 = j === 5 ? 0.03 : 0.058, w1 = j === 5 ? 0.058 : 0.016;
        const prims = [
          hide(S.capsule([0, 0, 0], [0, 0, L], r0, r1)),
          ...S.mirrorX([hide(S.capsule([r0 * 0.3, -0.006, 0], [w1, -0.006, L], Math.min(r0, w0 * 0.6) * 0.8, w1 * 0.5).blend(0.03))]),
          S.box(1, 0.5, L + 0.3, 0.02).at(0, -0.25 - 0.008, L / 2).color(pale).pbr(wet + 0.05).paint(0.01, 0),
        ];
        const hard = [H.geo(coreGeo(r0, r1, L)).shade((x, yy) => (yy < -r1 * 0.25 ? pale : skin)).pbr(wet)];
        for (let k = 0; k < 4; k++) for (let c = -1; c <= 1; c++) {
          const z = L * (k + 0.5) / 4, half = lerp(w0, w1, z / L) * 1.25, x = c * half * 0.62, rr = Math.max(0.008, half * 0.3);
          if (Math.abs(x) + rr > half * 1.15) continue;
          hard.push(sucker(rr, [x, -lerp(r0, r1, z / L) * 0.82, z], [c * 0.2, -1, 0]).lod(1));
          if (c !== 0 && k % 2) hard.push(spike(rr * 2.2, rr * 0.5, 0.5, 5).rot(180, 0, 0).at(x * 1.5, -lerp(r0, r1, z / L) * 0.6, z + 0.012).color(0x2a2018).pbr(0.3).lod(1));
        }
        g = { prims, hard };
      }
      nodes.push({ name: `tent${a}_${j}`, parent: j ? `tent${a}_${j - 1}` : `tentBase${a}`, rig: 'tentacles', pos: j ? [0, 0, KRAKEN.tentLen[j - 1]] : [0, 0, 0], rot: [KRAKEN.tent[j], (rnd(a + 5, j) - 0.5) * 10, 0], prims: g.prims, hard: g.hard, detail: club ? 1 : 0.9 });
    }
  });
  return { kind: 'kraken', nodes };
}
function animKraken(model, { t, phase }) {
  const rig = model.userData.rig;
  const breath = Math.sin(t * 1.1 + phase);
  if (rig.core) { rig.core.scale.set(1 + breath * 0.035, 1 - breath * 0.03, 1 + breath * 0.035); R(rig.core, Math.sin(t * 0.6 + phase) * 0.05, 0, Math.sin(t * 0.47 + phase * 2) * 0.04); }
  R(rig.body, Math.sin(t * 0.8 + phase) * 0.03, 0, Math.sin(t * 0.63 + phase) * 0.025);
  R(rig.jaw, Math.max(0, Math.sin(t * 2.4 + phase)) * 0.35);
  const A = rig.arms || [], T = rig.tentacles || [];
  for (let i = 0; i < A.length; i++) {
    const a = Math.floor(i / KRAKEN.NA), j = i % KRAKEN.NA;
    // each arm in turn rears out of the water and whips back down
    const c = frac(t * 0.13 + a * 0.375 + phase * 0.11), rear = pulse(c, 0, 0.36), whip = pulse(c, 0.3, 0.5);
    const wave = Math.sin(t * 1.5 - j * 0.8 + a * 1.9 + phase) * (0.06 + j * 0.028);
    R(A[i], wave - rear * (j === 0 ? 0.5 : j < 3 ? 0.15 : -0.08) + whip * (j < 2 ? 0.28 : 0.1), Math.sin(t * 0.9 - j * 0.6 + a * 2.3 + phase) * (0.05 + j * 0.018), 0);
  }
  for (let i = 0; i < T.length; i++) {
    const a = Math.floor(i / KRAKEN.NT), j = i % KRAKEN.NT, sg = a ? -1 : 1;
    const c = frac(t * 0.17 + a * 0.5 + phase * 0.13), strike = pulse(c, 0, 0.3);
    R(T[i], Math.sin(t * 1.2 - j * 0.6 + a * 2.6 + phase) * (0.05 + j * 0.02) + strike * (j < 2 ? 0.34 : j < 5 ? 0.05 : -0.3), sg * Math.sin(t * 0.8 - j * 0.5 + a + phase) * (0.06 + j * 0.02), 0);
  }
}

// =====================================================================================
// REEF CRAB: a spined, barnacled shell, one crusher claw and one cutter, paddles for back legs
// =====================================================================================
function crabDesc(def) {
  const shell = def.color ?? 0xc0502a, dark = tone(shell, -0.02, 0.0, -0.13), lite = tone(shell, 0.02, 0.04, 0.1), cream = 0xe9d7b0, tip = 0x2a1a14, ivory = 0xefe3c4;
  const sh = (p) => p.color(shell).pbr(0.46).bump(0.0085, 34, 'rock').tint(0.2, 11);
  const CY = 0.045;

  // ---- carapace ----
  const top = [
    sh(S.ellipsoid(0.4, 0.14, 0.27).at(0, CY + 0.005, 0.03)),
    sh(S.ellipsoid(0.28, 0.12, 0.2).at(0, CY - 0.005, -0.12).blend(0.06)),
    ...S.mirrorX([
      sh(S.ellipsoid(0.15, 0.085, 0.15).at(0.26, CY + 0.005, 0.1).blend(0.05)),
      sh(S.ellipsoid(0.15, 0.075, 0.16).at(0.2, CY + 0.085, -0.03).blend(0.045)).color(dark),          // branchial lobes
    ]),
    sh(S.ellipsoid(0.12, 0.065, 0.1).at(0, CY + 0.1, 0.13).blend(0.04)).color(dark),                   // gastric lobe
    sh(S.ellipsoid(0.095, 0.06, 0.11).at(0, CY + 0.1, -0.09).blend(0.04)).color(dark),                 // cardiac lobe
  ];
  const body = top.slice();
  // teeth round the front margin, the long side spines, a toothed brow between the eyes
  for (let i = 0; i < 6; i++) for (const sd of [-1, 1]) {
    const a = (24 + i * 12.5) * DEG, len = i === 5 ? 0.12 : 0.04 + i * 0.006, x = Math.sin(a) * 0.4, z = 0.03 + Math.cos(a) * 0.27;
    body.push(sh(S.cone(i === 5 ? 0.032 : 0.024, 0.004, len, 0.004).at(0, len / 2, 0).rot(88, 0, 0).rot(0, sd * (a / DEG + (i === 5 ? 12 : -8)), 0).at(sd * x * 0.97, CY - 0.004, z * 0.97).blend(0.014)).color(i === 5 ? lite : shell));
  }
  for (const x of [-0.045, -0.015, 0.015, 0.045]) body.push(sh(S.cone(0.014, 0.003, 0.035, 0.003).at(0, 0.0175, 0).rot(86, 0, 0).at(x, CY + 0.012, 0.29).blend(0.01)).color(lite));
  // knobs and short spines on the lobes
  for (const [x, z, h] of [[0, 0.15, 0.03], [0.09, 0.12, 0.022], [0, -0.07, 0.034], [0.2, 0.0, 0.04], [0.26, -0.07, 0.026], [0.14, -0.1, 0.022], [0.3, 0.06, 0.024], [0.1, -0.2, 0.02]]) {
    for (const sd of x ? [-1, 1] : [1]) { const q = surf(top, [sd * x, 0.5, z], [0, -1, 0]); body.push(sh(S.cone(0.02, 0.005, h, 0.005).at(sd * x, q[1] + h * 0.35, z).blend(0.016)).color(mix(shell, lite, 0.5))); }
  }
  // grooves between the lobes, a rim line, pale freckles
  body.push(
    ...S.mirrorX([
      S.capsule([0.07, CY + 0.2, 0.2], [0.09, CY + 0.2, -0.16], 0.01).color(tone(dark, 0, 0, -0.06)).paint(0.012, -0.006),
      S.capsule([0.07, CY + 0.2, 0.03], [0.3, CY + 0.2, 0.12], 0.009).color(tone(dark, 0, 0, -0.06)).paint(0.012, -0.005),
    ]),
    S.capsule([-0.08, CY + 0.2, 0.03], [0.08, CY + 0.2, 0.03], 0.009).color(tone(dark, 0, 0, -0.06)).paint(0.012, -0.005),
  );
  for (let i = 0; i < 30; i++) { const x = (rnd(i, 51) - 0.5) * 0.7, z = (rnd(i, 52) - 0.5) * 0.48, q = surf(top, [x, 0.5, z], [0, -1, 0]); body.push(S.sphere(0.004 + rnd(i, 53) * 0.005).at(x, q[1], z).color(mix(lite, cream, 0.35)).paint(0.003, 0.001)); }
  // underside: pale plates, the folded tail, seams
  body.push(
    S.ellipsoid(0.33, 0.065, 0.24).at(0, CY - 0.07, -0.01).color(cream).pbr(0.5).blend(0.03),
    under(0.5, CY - 0.06, -0.5, CY - 0.06, cream, 0.02, 0.5),
    S.ellipsoid(0.1, 0.03, 0.15).at(0, CY - 0.13, -0.06).color(mix(cream, shell, 0.2)).pbr(0.5).blend(0.012),         // tail flap
  );
  for (let i = 0; i < 6; i++) body.push(S.box(0.3, 0.1, 0.008, 0.003).at(0, CY - 0.15, 0.06 - i * 0.045).color(0x9a7a50).paint(0.004, -0.005));
  for (let i = 0; i < 4; i++) body.push(...S.mirrorX([S.box(0.24, 0.1, 0.008, 0.003).rot(0, 16 - i * 14, 0).at(0.22, CY - 0.12, 0.13 - i * 0.085).color(0x9a7a50).paint(0.004, -0.004)]));
  // eye notches and the dark face under the brow
  body.push(...S.mirrorX([S.sphere(0.03).at(0.09, CY + 0.035, 0.29).cut(0.01).color(dark)]), S.ellipsoid(0.1, 0.035, 0.03).at(0, CY - 0.045, 0.285).cut(0.012).color(0x3a1c14));
  const bodyHard = [
    // mouthparts
    ...H.mirrorX([H.box(0.046, 0.042, 0.012, 0.006).rot(8, 0, 0).at(0.027, CY - 0.048, 0.266).color(mix(cream, shell, 0.7)).pbr(0.5).shade((x, y) => (y < -0.008 ? mix(shell, 0x3a1c14, 0.5) : null)).lod(1)]),
    // feelers
    ...H.mirrorX([H.tube([[0.04, CY + 0.03, 0.29], [0.055, CY + 0.07, 0.34], [0.08, CY + 0.08, 0.4]], [0.004, 0.003, 0.001], 8, 5).color(dark).pbr(0.5).lod(1)]),
  ];
  // what has grown on the shell: barnacles, a sprig of pale coral, weed
  const grow = (x, z) => surf(top, [x, 0.5, z], [0, -1, 0]);
  for (const [x, z, r] of [[-0.2, -0.13, 0.02], [-0.235, -0.1, 0.014], [-0.17, -0.16, 0.015], [-0.215, -0.165, 0.011], [-0.26, -0.135, 0.01], [0.13, 0.03, 0.016], [0.16, 0.055, 0.011], [0.1, 0.055, 0.009], [0.3, -0.03, 0.012]]) {
    const q = grow(x, z); bodyHard.push(barnacle(r, [x, q[1] - r * 0.15, z], [x * 0.5, 1, z * 0.5]).lod(r > 0.013 ? 2 : 1));
  }
  { const q = grow(0.19, -0.15), c = 0xe9b3a8;
    const sprig = (pts, r) => H.tube(pts.map((v) => [q[0] + v[0], q[1] + v[1], q[2] + v[2]]), [r, r * 0.8, r * 0.6], 6, 5).color(c).pbr(0.85).shade((x, y) => (y > q[1] + 0.06 ? 0xf6ded2 : null));
    bodyHard.push(sprig([[0, -0.01, 0], [0.005, 0.04, -0.005], [0.02, 0.085, -0.012]], 0.009), sprig([[0.004, 0.035, -0.004], [-0.012, 0.06, 0.004], [-0.022, 0.09, 0.012]], 0.007).lod(2),
      sprig([[0.012, 0.06, -0.008], [0.03, 0.075, 0.0], [0.042, 0.1, 0.004]], 0.006).lod(1), sprig([[-0.015, -0.01, -0.02], [-0.024, 0.03, -0.03], [-0.02, 0.06, -0.045]], 0.007).lod(2));
  }
  body.push(S.sphere(0.07).at(-0.12, CY + 0.16, -0.19).color(0x5a6a36).pbr(0.9).paint(0.04, 0), S.sphere(0.045).at(0.27, CY + 0.1, 0.04).color(0x5a6a36).pbr(0.9).paint(0.03, 0));

  const nodes = [ROOT, { name: 'body', parent: 'root', rig: 'body', pos: [0, -0.06, 0], prims: body, hard: bodyHard, detail: 0.95 }];

  // ---- eyes on stalks ----
  for (const sd of [1, -1]) {
    nodes.push({ name: `eye${sd}`, parent: 'body', rig: 'eyes', pos: [sd * 0.09, CY + 0.04, 0.285], rot: [18, sd * 14, sd * -14],
      prims: [S.capsule([0, 0, 0], [0, 0.07, 0], 0.016, 0.014).color(lite).pbr(0.45), S.sphere(0.019).at(0, 0.074, 0).color(dark).pbr(0.4).blend(0.006)],
      hard: [H.sphere(0.0185, 14).at(0, 0.083, 0.004).color(0x0c0a0c).pbr(0.06).shade((x, y, z) => (z > 0.011 && y > 0.004 ? 0x3a3a48 : null)), H.geo(coreGeo(0.014, 0.012, 0.07, 0.7)).rot(-90, 0, 0).color(lite)], detail: 1.6 });
  }

  // ---- claws: the right is the crusher, the left the cutter ----
  const claw = (sd, big) => {
    const k = big ? 1 : 0.74, La = 0.2 * (big ? 1 : 0.94), pr = [0.08 * k, 0.074 * k, 0.115 * k], fl = big ? 0.17 : 0.19, pz = 0.05 + pr[2];
    const n = sd > 0 ? 'L' : 'R';
    nodes.push({ name: `clawBase${n}`, parent: 'body', pos: [sd * 0.3, CY - 0.03, 0.19], rot: [0, sd * 50, 0] });
    const arm = [
      sh(S.capsule([0, 0, 0], [0, 0.005, La], 0.055 * k, 0.05 * k)),
      sh(S.ellipsoid(0.045 * k, 0.05 * k, 0.08).at(0, 0.012, La * 0.55).blend(0.03)),
      S.box(0.3, 0.2, 0.5, 0.01).at(0, -0.1 - 0.018 * k, La / 2).color(cream).pbr(0.5).paint(0.012, 0),
    ];
    const armHard = [H.geo(coreGeo(0.05 * k, 0.045 * k, La)).color(shell)];
    for (let i = 0; i < 3; i++) armHard.push(spike(0.035 * k, 0.011 * k, 0.3, 5).rot(-15, 0, 0).at(0, 0.045 * k, La * (0.3 + i * 0.25)).color(lite).pbr(0.45).lod(1));
    nodes.push({ name: `arm${n}`, parent: `clawBase${n}`, rig: 'arms', pos: [0, 0, 0], rot: [-24, 0, 0], prims: arm, hard: armHard, detail: 1 });
    // wrist, palm and the fixed finger
    const fixed = [[0, -pr[1] * 0.42, pz + pr[2] * 0.55], [0, -pr[1] * 0.46, pz + pr[2] * 0.55 + fl * 0.5], [0, -pr[1] * 0.16, pz + pr[2] * 0.55 + fl]];
    const fr = big ? [0.042, 0.03, 0.013] : [0.026, 0.019, 0.009];
    const palm = [
      sh(S.sphere(0.056 * k).at(0, 0, 0.01)),
      sh(S.ellipsoid(pr[0], pr[1], pr[2]).at(0, 0, pz).blend(0.03)).bump(0.005, 36, 'scales'),
      sh(S.ellipsoid(pr[0] * 0.7, pr[1] * 0.5, pr[2] * 0.8).at(0, pr[1] * 0.62, pz - 0.01).blend(0.03)).color(dark),
      S.box(0.4, 0.2, 0.6, 0.01).at(0, -0.1 - pr[1] * 0.45, pz).color(cream).pbr(0.5).paint(0.014, 0),
      sh(S.capsule(fixed[0], fixed[1], fr[0], fr[1]).blend(0.025)).color(mix(shell, cream, 0.5)),
      S.capsule(fixed[1], fixed[2], fr[1], fr[2]).color(ivory).pbr(0.4).blend(0.015),
      S.sphere(fr[2] * 1.15).at(fixed[2][0], fixed[2][1], fixed[2][2]).color(tip).pbr(0.35).blend(0.008),
    ];
    const palmHard = [H.geo(coreGeo(pr[0] * 0.8, fr[1], pz + pr[2] * 0.55 + fl * 0.5)).color(shell)];
    for (let i = 0; i < (big ? 5 : 8); i++) {
      const f = (i + 0.6) / (big ? 5.4 : 8.6), z = lerp(fixed[0][2] + 0.02, fixed[2][2] - 0.012, f), y = lerp(fixed[0][1], fixed[2][1], f * f) + lerp(fr[0], fr[2], f) * 0.86;
      palmHard.push(H.sphere(big ? 0.012 - i * 0.001 : 0.0055, 8).scale(1, 0.8, 1).at(0, y, z).color(ivory).pbr(0.35).lod(1));
    }
    for (let i = 0; i < 4; i++) palmHard.push(spike(0.022 * k, 0.009 * k, 0.2, 5).at((i % 2 ? 1 : -1) * pr[0] * 0.3, pr[1] * 0.96, pz - pr[2] * 0.5 + i * pr[2] * 0.3).color(lite).pbr(0.45).lod(1));
    nodes.push({ name: `fore${n}`, parent: `arm${n}`, rig: 'forearms', pos: [0, 0.005, La], rot: [-12, sd * -76, 0], prims: palm, hard: palmHard, detail: 1 });
    // the moving finger
    const dz = fl + pr[2] * 0.18, dr = big ? [0.04, 0.03, 0.012] : [0.025, 0.018, 0.008];
    const dPts = [[0, 0, 0], [0, 0.028, dz * 0.5], [0, -0.03, dz]];
    const dact = [
      sh(S.capsule(dPts[0], dPts[1], dr[0], dr[1])).color(mix(shell, dark, 0.4)),
      S.capsule(dPts[1], dPts[2], dr[1], dr[2]).color(ivory).pbr(0.4).blend(0.015),
      S.sphere(dr[2] * 1.15).at(dPts[2][0], dPts[2][1], dPts[2][2]).color(tip).pbr(0.35).blend(0.008),
    ];
    const dHard = [H.geo(coreGeo(dr[0], dr[1], dz * 0.5)).rot(-3, 0, 0).color(shell)];
    for (let i = 0; i < (big ? 4 : 7); i++) {
      const f = (i + 0.7) / (big ? 4.6 : 7.8), z = lerp(0.03, dz - 0.014, f), y = (f < 0.5 ? lerp(0, 0.028, f * 2) : lerp(0.028, -0.03, (f - 0.5) * 2)) - lerp(dr[0], dr[2], f) * 0.86;
      dHard.push(H.sphere(big ? 0.011 - i * 0.001 : 0.005, 8).scale(1, 0.8, 1).at(0, y, z).color(ivory).pbr(0.35).lod(1));
    }
    nodes.push({ name: `dact${n}`, parent: `fore${n}`, rig: 'claws', pos: [0, pr[1] * 0.3, pz + pr[2] * 0.42], rot: [-16, 0, 0], prims: dact, hard: dHard, detail: 1 });
  };
  claw(1, false); claw(-1, true);

  // ---- legs: three walking pairs and a pair of swimming paddles ----
  const LEG = [{ z: 0.12, fwd: 26, len: 1 }, { z: 0.025, fwd: 4, len: 1.08 }, { z: -0.075, fwd: -20, len: 1 }, { z: -0.165, fwd: -52, len: 0.8, paddle: true }];
  for (const sd of [1, -1]) LEG.forEach((lg, i) => {
    const n = `${sd > 0 ? 'L' : 'R'}${i}`, L1 = 0.27 * lg.len, L2 = 0.2 * lg.len, L3 = 0.19 * lg.len, r = 0.036;
    nodes.push({ name: `legBase${n}`, parent: 'body', pos: [sd * (0.3 - i * 0.022), CY - 0.05, lg.z], rot: [0, sd * (90 - lg.fwd), 0] });
    const upper = [
      sh(S.capsule([0, 0, 0], [0, 0, L1], r * 1.05, r * 0.9)),
      sh(S.ellipsoid(r * 0.75, r * 1.25, L1 * 0.36).at(0, 0.004, L1 * 0.5).blend(0.02)),                        // the flattened blade of the thigh
      sh(S.sphere(r * 1.0).at(0, 0, L1).blend(0.014)).color(mix(shell, lite, 0.45)),
      S.box(0.2, 0.2, 0.6, 0.01).at(0, -0.1 - r * 0.25, L1 / 2).color(cream).pbr(0.5).paint(0.01, 0),
    ];
    const upperHard = [H.geo(coreGeo(r, r * 0.85, L1)).color(shell)];
    for (let k = 0; k < 3; k++) upperHard.push(spike(0.02, 0.006, 0.3, 5).rot(-20, 0, 0).at(0, r * 1.2, L1 * (0.3 + k * 0.22)).color(lite).pbr(0.45).lod(0));
    nodes.push({ name: `leg${n}`, parent: `legBase${n}`, rig: 'legs', pos: [0, 0, 0], rot: [lg.paddle ? -24 : -34, 0, 0], prims: upper, hard: upperHard, detail: 0.82 });
    let lower, lowerHard;
    if (!lg.paddle) {
      const c3 = Math.cos(34 * DEG), s3 = Math.sin(34 * DEG), e = [0, -s3 * L3, L2 + c3 * L3];
      lower = [
        sh(S.capsule([0, 0, 0], [0, 0, L2], r * 0.86, r * 0.66)),
        sh(S.sphere(r * 0.7).at(0, 0, L2).blend(0.012)).color(mix(shell, lite, 0.45)),
        sh(S.capsule([0, 0, L2], [e[0], e[1] * 0.55, L2 + c3 * L3 * 0.55], r * 0.6, r * 0.38).blend(0.01)).color(mix(shell, dark, 0.5)),
        S.box(0.2, 0.2, L2 * 0.9, 0.01).at(0, -0.1 - r * 0.2, L2 * 0.45).color(cream).pbr(0.5).paint(0.01, 0),
        S.capsule([e[0], e[1] * 0.55, L2 + c3 * L3 * 0.55], e, r * 0.38, r * 0.14).color(tip).pbr(0.4).blend(0.01),
      ];
      lowerHard = [
        H.geo(coreGeo(r * 0.86, r * 0.62, L2)).color(shell),
        aim(spike(L3 * 1.02, r * 0.5, 0, 6), [0, 0, L2], [0, -s3, c3]).shade((x, y) => (y > 0.5 ? tip : mix(shell, dark, 0.5))).pbr(0.4),
      ];
    } else {
      lower = [sh(S.capsule([0, 0, 0], [0, 0, L2 * 0.8], r * 0.8, r * 0.6)), sh(S.sphere(r * 0.64).at(0, 0, L2 * 0.8).blend(0.012)).color(mix(shell, lite, 0.45))];
      lowerHard = [
        H.geo(coreGeo(r * 0.8, r * 0.6, L2 * 0.8)).color(shell),
        H.sphere(1, 14).scale(0.058, 0.011, 0.1).rot(8, 0, 0).at(0, -0.012, L2 * 0.8 + 0.09).shade((x, y, z) => (Math.hypot(x, z) > 0.8 ? cream : Math.abs(x) < 0.08 ? dark : null)).color(lite).pbr(0.45),
      ];
    }
    nodes.push({ name: `shin${n}`, parent: `leg${n}`, rig: 'shins', pos: [0, 0, L1], rot: [lg.paddle ? 30 : 72, 0, 0], prims: lower, hard: lowerHard, detail: 0.82 });
  });
  return { kind: 'crab', nodes };
}
function animCrab(model, { t, phase }) {
  const rig = model.userData.rig;
  R(rig.body, Math.sin(t * 1.7 + phase) * 0.035, 0, Math.sin(t * 1.3 + phase * 1.7) * 0.04);
  P(rig.body, 0, Math.sin(t * 2.1 + phase) * 0.012, 0);
  const L = rig.legs || [], S2 = rig.shins || [];
  for (let i = 0; i < L.length; i++) {
    const k = i % 4, sg = i < 4 ? 1 : -1, w = t * 6.5 + phase + k * 1.5 + (i < 4 ? 0 : PI);
    if (k === 3) { R(L[i], Math.sin(w * 1.3) * 0.22, sg * Math.cos(w * 1.3) * 0.5, 0); R(S2[i], Math.sin(w * 1.3 + 1) * 0.3); continue; }   // paddles scull
    R(L[i], -Math.max(0, Math.sin(w)) * 0.3, sg * Math.cos(w) * 0.24, 0);
    R(S2[i], Math.max(0, Math.sin(w + 0.5)) * 0.32);
  }
  const A = rig.arms || [], F = rig.forearms || [], C = rig.claws || [];
  for (let i = 0; i < A.length; i++) {
    const sg = i ? -1 : 1, c = frac(t * 0.27 + i * 0.5 + phase * 0.13), snap = pulse(c, 0, 0.2), raise = pulse(frac(c + 0.1), 0, 0.5);
    R(A[i], -raise * 0.35 + Math.sin(t * 1.9 + i * 2 + phase) * 0.06, sg * Math.sin(t * 1.1 + i + phase) * 0.1, 0);
    R(F[i], -raise * 0.2, sg * (raise * 0.3 + Math.sin(t * 1.4 + i * 3 + phase) * 0.08), 0);
    R(C[i], -0.18 - Math.sin(t * 2.3 + i * 1.7 + phase) * 0.12 + snap * 0.42);
  }
  (rig.eyes || []).forEach((e, i) => R(e, Math.sin(t * 3.1 + i * 2 + phase) * 0.12, 0, Math.sin(t * 2.3 + i + phase) * 0.14));
}

// =====================================================================================
// SIREN: a sea-witch, pale and finned, kelp for hair, a pearl of light over her casting hand
// =====================================================================================
const SIREN = {
  Ls: [0.22, 0.24, 0.24, 0.24, 0.23, 0.22], hips: [0, 0.085, 0.3],
  path: [[0, 0.085, 0.3], [0, -0.13, 0.2], [0, -0.21, -0.04], [0, -0.19, -0.3], [0, -0.12, -0.55], [0, 0.0, -0.76], [0, 0.17, -0.9], [0, 0.3, -0.98]],
};
SIREN.n = SIREN.Ls.length; SIREN.len = SIREN.Ls.reduce((a, b) => a + b, 0); SIREN.lay = newLay(SIREN.n);
function sirenCurve(p, t, phase, o) {
  crEval(SIREN.path, p / 0.262, o);
  const k = smooth(p / 1.1);
  o[0] += Math.sin(p * 3.4 - t * 2.3 - phase) * 0.11 * k;
  o[1] += Math.sin(p * 2.2 - t * 1.7 - phase * 0.8) * 0.045 * smooth((p - 0.5) / 0.8);
}
function sirenDesc(def) {
  const scale = def.color ?? 0x6ad0c0, scaleDk = tone(scale, 0.02, 0.0, -0.17), skin = mix(scale, 0xe9efe2, 0.68), skinSh = mix(skin, 0x6a8a90, 0.4), belly = mix(scale, 0xf0f0dc, 0.6);
  const lip = 0x2f6a72, kelp = 0x34502a, kelpLt = 0x8a8a3a, finA = tone(scale, 0.03, 0.0, -0.1), finB = 0xc7a6e0, pearl = 0xf2ead8, coral = 0xe58f7c, wet = 0.36;
  const sk = (q) => q.color(skin).pbr(0.42).tint(0.05, 30);
  const sc = (q, part) => (part === 'bottom' ? q.color(belly).pbr(wet).bump(0.0026, 44, 'scales') : q.color(part === 'top' ? scaleDk : scale).pbr(wet).bump(0.0042, 40, 'scales').tint(0.14, 14));
  const H0 = SIREN.hips, R = 0.07;

  // ---- torso (origin at the hips) ----
  const torso = [
    sc(S.ellipsoid(0.083, 0.07, 0.066).at(0, -0.005, 0)),
    sk(S.ellipsoid(0.061, 0.075, 0.049).at(0, 0.078, 0.004).blend(0.04)),
    sk(S.ellipsoid(0.084, 0.086, 0.06).at(0, 0.19, -0.002).blend(0.045)),
    sk(S.capsule([-0.094, 0.262, -0.008], [0.094, 0.262, -0.008], 0.033).blend(0.035)),
    sk(S.capsule([0, 0.27, -0.008], [0, 0.345, 0.004], 0.03, 0.025).blend(0.02)),
    ...S.mirrorX([
      sk(S.sphere(0.035).at(0.112, 0.262, -0.008).blend(0.02)),                                           // shoulder
      sk(S.ellipsoid(0.03, 0.05, 0.02).at(0.04, 0.2, -0.05).blend(0.03)),                                 // shoulder blade
      sk(S.capsule([0.012, 0.293, 0.02], [0.085, 0.28, 0.012], 0.007).blend(0.01)),                       // collarbone
    ]),
    // a bodice of her own scales
    sc(S.ellipsoid(0.088, 0.04, 0.066).at(0, 0.196, 0.002).blend(0.008)),
    ...S.mirrorX([sc(S.ellipsoid(0.04, 0.037, 0.036).at(0.041, 0.2, 0.046).blend(0.012))]),
    sc(S.ellipsoid(0.03, 0.03, 0.02).at(0, 0.165, 0.05).blend(0.012), 'top'),
    // scales climbing the flanks from the tail
    ...S.mirrorX([
      S.ellipsoid(0.03, 0.06, 0.05).at(0.06, 0.06, -0.005).color(scale).pbr(wet).paint(0.012, 0.002),
      S.sphere(0.022).at(0.055, 0.115, -0.02).color(scale).pbr(wet).paint(0.01, 0.002),
      S.sphere(0.02).at(0.1, 0.25, -0.03).color(scale).pbr(wet).paint(0.01, 0.002),
      S.box(0.02, 0.006, 0.03, 0.002).rot(0, 0, 28).at(0.026, 0.318, 0.004).color(skinSh).paint(0.003, -0.003),      // gills
      S.box(0.02, 0.006, 0.03, 0.002).rot(0, 0, 28).at(0.027, 0.305, 0.004).color(skinSh).paint(0.003, -0.003),
      S.box(0.02, 0.006, 0.03, 0.002).rot(0, 0, 28).at(0.028, 0.292, 0.004).color(skinSh).paint(0.003, -0.003),
    ]),
    S.capsule([0, 0.25, -0.064], [0, 0.07, -0.05], 0.007).color(skinSh).paint(0.008, -0.004),                         // spine
    S.sphere(0.006).at(0, 0.075, 0.052).color(skinSh).paint(0.004, -0.004),                                           // navel
  ];
  const torsoHard = [];
  // necklace: shells and pearls on a cord
  for (let i = 0; i < 11; i++) {
    const a = (-75 + i * 15) * DEG, x = Math.sin(a) * 0.05, z = 0.012 + Math.cos(a) * 0.044, y = 0.292 - Math.cos(a) * 0.022;
    torsoHard.push(H.sphere(i === 5 ? 0.0085 : 0.0048, 8).at(x, y - (i === 5 ? 0.008 : 0), z + (i === 5 ? 0.004 : 0)).color(i % 2 ? pearl : coral).pbr(0.25).lod(1));
  }
  torsoHard.push(aim(spike(0.03, 0.012, 0.3, 6, 0.5), [0, 0.268, 0.058], [0, -1, 0.25]).color(pearl).pbr(0.3).lod(1));
  // fins at the hips and a low crest down the spine
  for (const sd of [-1, 1]) torsoHard.push(place(fan([{ a: 20, len: 0.06 }, { a: 48, len: 0.1 }, { a: 76, len: 0.115 }, { a: 104, len: 0.09 }], finA, finB, scaleDk, { dip: 0.3, spineR: 0.0034, cup: 0.03 * sd }), 0, 0, sd * -68, sd * 0.072, 0.0, -0.01));
  torsoHard.push(place(fan([{ a: 30, len: 0.02 }, { a: 62, len: 0.045 }, { a: 92, len: 0.05 }, { a: 124, len: 0.04 }, { a: 150, len: 0.02 }], finA, finB, scaleDk, { dip: 0.3, spineR: 0.0028 }), 0, 0, 0, 0, 0.19, -0.056));

  // ---- head (origin at the top of the neck) ----
  const head = [
    sk(S.ellipsoid(R * 0.93, R * 1.06, R).at(0, R * 1.12, -R * 0.06)),
    sk(S.ellipsoid(R * 0.68, R * 0.8, R * 0.6).at(0, R * 0.72, R * 0.3).blend(0.02)),
    sk(S.ellipsoid(R * 0.25, R * 0.19, R * 0.2).at(0, R * 0.1, R * 0.62).blend(0.018)),
    ...S.mirrorX([
      sk(S.capsule([R * 0.56, R * 0.6, R * 0.02], [R * 0.15, R * 0.14, R * 0.6], R * 0.15, R * 0.12).blend(0.022)),
      sk(S.ellipsoid(R * 0.2, R * 0.12, R * 0.17).at(R * 0.5, R * 0.8, R * 0.55).blend(0.03)),
      sk(S.capsule([R * 0.04, R * 1.26, R * 0.87], [R * 0.6, R * 1.34, R * 0.55], R * 0.075, R * 0.055).blend(0.014)),
    ]),
    sk(S.capsule([0, R * 1.12, R * 0.84], [0, R * 0.74, R * 1.02], R * 0.055, R * 0.07).blend(0.014)),
    sk(S.sphere(R * 0.08).at(0, R * 0.72, R * 1.02).blend(0.01)),
    sk(S.ellipsoid(R * 0.27, R * 0.17, R * 0.18).at(0, R * 0.4, R * 0.72).blend(0.018)),
    sk(S.capsule([0, 0.02, -0.004], [0, -0.03, -0.01], 0.026, 0.028).blend(0.02)),                             // neck stub
  ];
  const er = R * 0.15, eyeAt = [R * 0.36, R * 1.03, R * 0.77];
  head.push(
    ...S.mirrorX([
      S.ellipsoid(er * 1.5, er * 0.82, er).rot(0, 0, 13).at(eyeAt[0], eyeAt[1] + er * 0.05, eyeAt[2] + er * 0.9).cut(0.005).color(mix(skin, 0x2a4a58, 0.7)),
      S.ellipsoid(er * 1.6, er * 0.4, er * 0.8).rot(0, 12, 13).at(eyeAt[0] + er * 0.1, eyeAt[1] + er * 0.78, eyeAt[2] + er * 0.66).color(mix(skin, 0x2f6a72, 0.55)).pbr(0.4).blend(0.006),   // heavy upper lid
      S.ellipsoid(er * 1.3, er * 0.24, er * 0.6).rot(0, 12, 8).at(eyeAt[0] + er * 0.1, eyeAt[1] - er * 0.82, eyeAt[2] + er * 0.56).color(mix(skin, skinSh, 0.5)).blend(0.006),
      S.sphere(R * 0.3).at(R * 0.4, R * 1.12, R * 0.74).color(mix(skin, 0x2f6a72, 0.4)).paint(0.03, 0),                                                    // shadow round the eye
      S.sphere(R * 0.035).at(R * 0.06, R * 0.66, R * 0.98).color(skinSh).paint(0.003, 0),
      S.sphere(R * 0.2).at(R * 0.5, R * 0.62, R * 0.6).color(mix(skin, scale, 0.35)).paint(0.03, 0),          // sheen on the cheek
      S.ellipsoid(R * 0.2, R * 0.2, R * 0.1).at(R * 0.62, R * 1.3, R * 0.5).color(scale).pbr(wet).paint(0.012, 0.0015),   // scales at the temple
    ]),
    S.ellipsoid(R * 0.19, R * 0.045, R * 0.14).at(0, R * 0.46, R * 0.87).color(lip).pbr(0.3).paint(0.004, 0.0015),
    S.ellipsoid(R * 0.15, R * 0.06, R * 0.14).at(0, R * 0.35, R * 0.86).color(lip).pbr(0.3).paint(0.004, 0.0025),
    S.ellipsoid(R * 0.21, R * 0.014, R * 0.16).at(0, R * 0.408, R * 0.88).color(0x183a40).paint(0.003, -0.003),
    // the scalp the kelp grows from
    S.ellipsoid(R * 0.99, R * 0.98, R * 1.05).at(0, R * 1.3, -R * 0.2).color(kelp).pbr(0.5).bump(0.0075, 50, 'fur').tint(0.3, 60).blend(0.006),
  );
  const headHard = [
    ...H.mirrorX([
      eye(er, { iris: 0xf6e7a0, rim: 0x6fd0c0, white: 0xf6e7a0, shape: 'slit', pupilDeg: 12, irisDeg: 64, rough: 0.18, glow: 0.75 }).rot(-4, 9, 0).at(eyeAt[0], eyeAt[1], eyeAt[2]).lod(2),
      // fin ears
      ...place(fan([{ a: -36, len: R * 0.5 }, { a: 4, len: R * 1.05 }, { a: 40, len: R * 1.2 }, { a: 78, len: R * 0.95 }, { a: 112, len: R * 0.5 }], finA, finB, scaleDk, { dip: 0.3, spineR: 0.003, spineLod: 2 }), 0, -58, -22, R * 0.84, R * 0.98, -R * 0.02),
      // brow spines instead of eyebrows
      spike(R * 0.2, R * 0.03, 0.3, 4).rot(-60, 0, -58).at(R * 0.5, R * 1.36, R * 0.62).color(scaleDk).lod(1),
      spike(R * 0.16, R * 0.028, 0.3, 4).rot(-60, 0, -40).at(R * 0.36, R * 1.38, R * 0.74).color(scaleDk).lod(1),
    ]),
    // a circlet of coral with a pearl at the brow
    H.torus(R * 0.93, R * 0.035, 30, 6).rot(90, 0, 0).rot(-14, 0, 0).at(0, R * 1.62, -R * 0.08).color(coral).pbr(0.6),
    H.sphere(R * 0.085, 10).at(0, R * 1.5, R * 0.86).color(pearl).pbr(0.2).lod(2),
  ];
  for (let i = 0; i < 7; i++) {
    const a = (-78 + i * 26) * DEG, len = R * (0.34 + (i === 3 ? 0.3 : (i % 2) * 0.14));
    headHard.push(aim(horn([[0, 0, 0], [0.003, len * 0.5, 0], [-0.002, len, 0.004]], R * 0.045, R * 0.012, coral, 0xf6dcd0, 3, 5), [Math.sin(a) * R * 0.92, R * 1.63 + Math.cos(a) * R * 0.22, -R * 0.08 + Math.cos(a) * R * 0.9], [Math.sin(a) * 0.4, 1, Math.cos(a) * 0.25]).lod(1));
  }
  // blades of kelp lying over the scalp from the crown, so the head reads as hair rather than a cap
  for (let i = 0; i < 17; i++) {
    const az = (i < 3 ? (i - 1) * 24 : 42 + (i - 3) * 21.5) * DEG * (i % 2 || i < 3 ? 1 : -1), el0 = i < 3 ? 60 : 30 - (i % 3) * 8, C = [0, R * 1.3, -R * 0.2];
    const on = (el, k = 1.035) => [C[0] + Math.sin(az) * Math.cos(el * DEG) * R * 0.99 * k, C[1] + Math.sin(el * DEG) * R * 0.98 * k, C[2] + Math.cos(az) * Math.cos(el * DEG) * R * 1.05 * k];
    const pts = [[C[0], C[1] + R * 1.0, C[2] + R * 0.05], on(74), on((74 + el0) / 2), on(el0, 1.05)];
    headHard.push(H.geo(ribbonGeo(pts, (q) => R * (0.1 + 0.2 * Math.sin(Math.min(1, q * 1.1) * PI * 0.9)), [Math.sin(az), 0.6, Math.cos(az)], 0.25, 7)).shade((x, y) => mix(kelp, kelpLt, clamp((C[1] + R - y) / (R * 1.2), 0, 1) ** 2 * 0.5 + (i % 3) * 0.08)).pbr(0.4).lod(1));
  }
  // kelp hair: three bunches that the animator sways
  const HP = [0, R * 1.5, -R * 0.3];
  const strand = (x0, z0, x1, y1, z1, w, bulbs) => {
    const a = [x0, R * 1.86 - Math.abs(x0) * 0.5, z0], out = [x0 * 1.6, 0.25, z0 - 0.02], mid = [lerp(x0, x1, 0.55) + x0 * 0.8, lerp(a[1], y1, 0.4), lerp(z0, z1, 0.5) - 0.02];
    const pts = [a, [x0 * 1.5, a[1] - 0.012, z0 * 1.35 - 0.01], mid, [lerp(x0, x1, 0.85) + Math.sin(x0 * 90) * 0.012, lerp(a[1], y1, 0.72), lerp(z0, z1, 0.8) + Math.cos(x0 * 70) * 0.012], [x1, y1, z1]];
    const piece = [H.geo(ribbonGeo(pts, (s2) => w * (0.55 + 0.6 * Math.sin(Math.min(1, s2 * 1.2) * PI) ** 0.7) * (s2 > 0.9 ? (1 - s2) * 10 * 0.8 + 0.2 : 1), out)).shade((x, y) => mix(kelp, kelpLt, clamp((a[1] - y) / (a[1] - y1), 0, 1) ** 1.5 * 0.75)).pbr(0.38)];
    for (let k = 0; k < bulbs; k++) { const q = crEval(pts, 1.4 + k * 1.1, [0, 0, 0]); piece.push(H.sphere(0.0065, 7).scale(1, 1.5, 1).at(q[0] + 0.004, q[1], q[2] - 0.005).color(kelpLt).pbr(0.3).lod(1)); }
    return into(HP, piece);
  };
  const hairL = [], hairR = [], hairB = [];
  for (let i = 0; i < 5; i++) {
    const f = i / 4, x0 = R * (0.86 - f * 0.34), z0 = R * (0.2 - f * 0.75);
    hairL.push(strand(x0, z0, 0.1 + f * 0.035, -0.29 + (i % 2) * 0.05 - f * 0.03, 0.05 - f * 0.11, 0.012 + (i % 2) * 0.004, i % 2 ? 2 : 1));
    hairR.push(strand(-x0, z0 - 0.004, -0.1 - f * 0.03, -0.3 + ((i + 1) % 2) * 0.06 - f * 0.03, 0.04 - f * 0.11, 0.012 + ((i + 1) % 2) * 0.004, i % 2 ? 1 : 2));
  }
  for (let i = 0; i < 5; i++) { const x0 = R * (-0.44 + i * 0.22); hairB.push(strand(x0, -R * 0.98, x0 * 1.5, -0.33 - (i % 2) * 0.04, -0.13 - (i % 3) * 0.02, 0.014, i % 2 ? 2 : 0)); }
  // strands falling forward over the shoulders, and shorter ones from the parting that frame the face
  hairL.push(strand(R * 0.84, R * 0.36, 0.085, -0.2, 0.075, 0.009, 0));
  hairR.push(strand(-R * 0.84, R * 0.36, -0.08, -0.17, 0.08, 0.009, 1));
  for (let i = 0; i < 4; i++) {
    const z0 = R * (0.62 - i * 0.36);
    hairL.push(strand(R * (0.3 + (i % 2) * 0.1), z0, 0.094 + i * 0.006, -0.03 - i * 0.05, 0.04 - i * 0.03, 0.011, 0));
    hairR.push(strand(-R * (0.3 + ((i + 1) % 2) * 0.1), z0, -0.094 - i * 0.006, -0.05 - i * 0.045, 0.045 - i * 0.03, 0.011, 0));
  }

  // ---- arms: hanging down -Y in their own frames, posed by the node rotations ----
  const UP = 0.16, FO = 0.15;
  const upper = () => ({
    prims: [sk(S.capsule([0, 0, 0], [0, -UP, 0], 0.028, 0.023)), sk(S.sphere(0.031).at(0, 0, 0).blend(0.02)), sk(S.ellipsoid(0.02, 0.05, 0.022).at(0.004, -0.06, 0.006).blend(0.02))],
    hard: [H.geo(coreGeo(0.026, 0.022, UP, 0.75)).rot(90, 0, 0).color(skin)],
  });
  const fore = (sd) => {
    const prims = [
      sk(S.capsule([0, 0, 0], [0, -FO, 0], 0.024, 0.016)), sk(S.sphere(0.025).blend(0.015)),
      sk(S.ellipsoid(0.019, 0.027, 0.009).at(0, -FO - 0.022, 0).blend(0.012)),                                     // palm
      S.ellipsoid(0.02, 0.07, 0.03).at(sd * 0.018, -0.07, -0.012).color(scale).pbr(wet).paint(0.008, 0),          // scales along the forearm
    ];
    const hard = [
      H.geo(coreGeo(0.022, 0.015, FO, 0.75)).rot(90, 0, 0).color(skin),
      // webbed fingers, clawed
      ...fan([{ a: -30, len: 0.042 }, { a: -11, len: 0.054 }, { a: 8, len: 0.052 }, { a: 27, len: 0.042 }], mix(skin, finB, 0.4), finB, skin, { dip: 0.42, spineR: 0.0068, spineLod: 2, tipCol: 0x24484c, over: 1.12, fade: 1, rows: 3 }).map((h) => h.rot(0, 90, 0).rot(0, 0, 180).at(0, -FO - 0.034, 0)),
      spike(0.038, 0.007, 0.2, 5).shade((x, y) => (y > 0.8 ? 0x24484c : null)).rot(0, 0, sd * 125).at(sd * 0.014, -FO - 0.018, 0.003).color(skin).pbr(0.4).lod(2),   // thumb
      // fin along the outside of the forearm
      ...place(fan([{ a: 16, len: 0.03 }, { a: 42, len: 0.06 }, { a: 66, len: 0.068 }, { a: 92, len: 0.045 }], finA, finB, scaleDk, { dip: 0.3, spineR: 0.0028, spineLod: 2 }), 0, 0, 180, 0, -0.03, -0.014),
    ];
    return { prims, hard };
  };
  // ---- the pearl of light ----
  const orbHard = [
    H.sphere(0.03, 16).color(0xd9fff6).pbr(0.3).glow(1.7),
    H.torus(0.047, 0.0028, 28, 5).rot(70, 0, 20).color(0x9ff0e0).pbr(0.4).glow(1.3).lod(2),
    H.torus(0.058, 0.0022, 28, 5).rot(-50, 30, 0).color(0xc9b6f0).pbr(0.4).glow(1.3).lod(2),
  ];
  for (let i = 0; i < 6; i++) { const a = i * 1.05, r = 0.05 + (i % 3) * 0.012; orbHard.push(H.sphere(0.005 - (i % 2) * 0.0015, 6).at(Math.cos(a) * r, Math.sin(i * 2.3) * 0.03, Math.sin(a) * r).color(0xeafff8).glow(1.6).lod(1)); }

  // ---- tail ----
  const TAB = [
    { z: 0.03, w: 0.08, h: 0.076, y: 0 }, { z: -0.3, w: 0.068, h: 0.074, y: 0 }, { z: -0.8, w: 0.045, h: 0.054, y: 0 }, { z: -1.2, w: 0.027, h: 0.034, y: 0 }, { z: -SIREN.len, w: 0.015, h: 0.02, y: 0 },
  ];
  const at = (z) => station(TAB, z);
  const lay = layChain((pp, o) => sirenCurve(pp, 0, 0, o), SIREN.Ls, SIREN.lay);
  const tail = [];
  let z0 = 0;
  for (let i = 0; i < SIREN.n; i++) {
    const L = SIREN.Ls[i], z1 = z0 - L, o = [0, 0, z0], mid = at((z0 + z1) / 2);
    const prims = [...hull(span(TAB, z0, z1), sc), under(z0 + 0.03, -at(z0).h * 0.5, z1 - 0.03, -at(z1).h * 0.5, belly, 0.015, wet)];
    const hard = [H.geo(coreGeo(at(z1).w, at(z0).w, L, 0.72)).color(scale).at(0, 0, z1)];
    if (i > 0 && i < SIREN.n - 1) { const k = 0.6 + 0.4 * mid.w / 0.06; hard.push(place(fan([{ a: -46, len: 0.04 * k }, { a: -14, len: 0.07 * k }, { a: 18, len: 0.085 * k }, { a: 48, len: 0.07 * k }, { a: 74, len: 0.04 * k }], finA, finB, scaleDk, { dip: 0.3, spineR: 0.003 }), 0, 0, 0, 0, mid.h - 0.008, (z0 + z1) / 2 + 0.03)); }
    if (i === SIREN.n - 1) {
      // flukes: two webbed lobes
      for (const sd of [-1, 1]) hard.push(place(fan([{ a: 34, len: 0.11 }, { a: 54, len: 0.2 }, { a: 72, len: 0.27 }, { a: 88, len: 0.3 }, { a: 104, len: 0.27 }, { a: 122, len: 0.18 }, { a: 144, len: 0.08 }], finA, finB, scaleDk, { dip: 0.22, spineR: 0.0042, cup: 0.04 * sd, sub: 4, rows: 5 }), 0, 0, sd * -66, sd * 0.004, 0, z1 + 0.05));
    }
    tail.push({ name: `tail${i}`, parent: i ? `tail${i - 1}` : 'root', rig: 'tail', pos: i ? [0, 0, -SIREN.Ls[i - 1]] : lay.pos.slice(), rot: eulerDeg(lay.quats[i]), prims: into(o, prims), hard: into(o, hard), detail: 1.1 });
    z0 = z1;
  }

  const aL = upper(), aR = upper(), fL = fore(1), fR = fore(-1);
  return { kind: 'siren', nodes: [
    ROOT,
    ...tail,
    { name: 'torso', parent: 'root', rig: 'torso', pos: H0, rot: [6, 0, 0], prims: torso, hard: torsoHard, detail: 1.5 },
    { name: 'head', parent: 'torso', rig: 'head', pos: [0, 0.345, 0.004], rot: [-4, -8, 0], prims: head, hard: headHard, detail: 2.4 },
    { name: 'hairL', parent: 'head', rig: 'hair', pos: HP, hard: hairL },
    { name: 'hairR', parent: 'head', rig: 'hair', pos: HP, hard: hairR },
    { name: 'hairB', parent: 'head', rig: 'hair', pos: HP, hard: hairB },
    { name: 'armL', parent: 'torso', rig: 'arms', pos: [0.118, 0.262, -0.008], rot: [-38, 0, 52], prims: aL.prims, hard: aL.hard, detail: 1.8 },
    { name: 'foreL', parent: 'armL', rig: 'forearms', pos: [0, -UP, 0], rot: [-62, 0, 0], prims: fL.prims, hard: fL.hard, detail: 1.8 },
    { name: 'armR', parent: 'torso', rig: 'arms', pos: [-0.118, 0.262, -0.008], rot: [-112, 0, -16], prims: aR.prims, hard: aR.hard, detail: 1.8 },
    { name: 'foreR', parent: 'armR', rig: 'forearms', pos: [0, -UP, 0], rot: [-46, 0, 0], prims: fR.prims, hard: fR.hard, detail: 1.8 },
    { name: 'orb', parent: 'foreR', rig: 'core', pos: [0, -FO - 0.16, 0.012], hard: orbHard },
  ] };
}
function animSiren(model, { t, phase }) {
  const rig = model.userData.rig;
  poseChain(rig.tail, layChain((p, o) => sirenCurve(p, t, phase, o), SIREN.Ls, SIREN.lay));
  const c = frac(t * 0.2 + phase * 0.17), cast = pulse(c, 0.0, 0.5), w = t * 1.4 + phase;
  R(rig.torso, Math.sin(w) * 0.04 - cast * 0.1, Math.sin(w * 0.7) * 0.14, Math.sin(w * 0.9 + 1) * 0.04);
  P(rig.torso, 0, Math.sin(w * 1.3) * 0.012, 0);
  R(rig.head, Math.sin(w * 1.1 + 0.5) * 0.05 - cast * 0.12, Math.sin(w * 0.6 + 2) * 0.16, 0);
  const A = rig.arms || [], F = rig.forearms || [];
  // the casting arm lifts the pearl; the other hand weaves beside her
  R(A[1], -cast * 0.45 + Math.sin(w * 1.2) * 0.07, 0, -cast * 0.12 + Math.sin(w * 0.8) * 0.05);
  R(F[1], cast * 0.3 + Math.sin(w * 1.5 + 1) * 0.1);
  R(A[0], Math.sin(w * 1.1 + 2) * 0.2 - cast * 0.3, 0, Math.sin(w * 0.9) * 0.16 + cast * 0.25);
  R(F[0], Math.sin(w * 1.6) * 0.22 - cast * 0.3);
  if (rig.core) { rig.core.scale.setScalar(0.85 + Math.sin(t * 5.2 + phase) * 0.12 + cast * 0.75); rig.core.rotation.set(t * 1.1, t * 2.6 + phase, 0); }
  (rig.hair || []).forEach((h, i) => R(h, Math.sin(w * 1.2 + i * 1.9) * 0.045, 0, Math.sin(w * 0.9 + i * 2.3) * 0.04));
}

// the great beasts live in deepkin.js and are built with this file's kit
const deepkin = installDeepkin({ tone, mix, rnd, lerp, clamp, smooth, cached, into, loft, blade, eye, spike, aim, surf, station, hull, span, slab, under, fan, place, horn,
  coreGeo, barnacle, harpoon, ribbonGeo, newLay, layChain, eulerDeg, poseChain, R, P, pulse, frac, rigged });

export const creatures = {
  shark: (def) => rigged(def, sharkDesc),
  eel: (def) => rigged(def, eelDesc),
  serpent: (def) => rigged(def, serpentDesc),
  leviathan: (def) => rigged(def, leviathanDesc),
  kraken: (def) => rigged(def, krakenDesc),
  crab: (def) => rigged(def, crabDesc),
  siren: (def) => rigged(def, sirenDesc, 1.32),
  ...deepkin.creatures,
};
export const animators = {
  shark: animShark,
  eel: animEel,
  serpent: animSerpent,
  leviathan: animLeviathan,
  kraken: animKraken,
  crab: animCrab,
  siren: animSiren,
  ...deepkin.animators,
};
