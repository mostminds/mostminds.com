// Beasts of the newer realms, second part: nine great sea monsters sculpted, rigged and animated in code.
//
//   creatures[def.model](def)            -> a rigged model (rigkit.cloneRigged of a cached template),
//                                           head toward +X, waterline at y = 0, sized by def.size
//   animators[kind](model, { t, phase }) -> poses model.userData.rig each frame (kind = the model key)
//
// Same conventions as seacreatures.js and ancientseas.js: every beast is authored facing +Z, mirrored across
// X = 0, in a normalised space where it fits a circle of radius ~1.3; the root node turns it to +X and assemble()
// scales it by def.size. Diving, sinking and the death roll are done by the naval view around the whole model;
// the animators here swim, rear, strike and snap. The kit below is a copy of the private helpers of
// ancientseas.js and seacreatures.js, followed by a path tracer that lays the long bodies along a curve.
import * as THREE from 'three';
import { S, H, noise3, distanceField, sculptMaterial } from '../sculpt.js';
import { assemble, cloneRigged, getDetail } from '../rigkit.js';

const DEG = Math.PI / 180, PI = Math.PI;
const _c = new THREE.Color(), _c2 = new THREE.Color();
function tone(hex, dh = 0, ds = 0, dl = 0) { return _c.set(hex).offsetHSL(dh, ds, dl).getHex(); }
function mix(a, b, t) { return _c.set(a).lerp(_c2.set(b), t).getHex(); }
const rnd = (i, k = 0) => noise3(i * 7 + 3, k * 13 + 5, 11);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const fin0 = (v) => (Number.isFinite(v) ? v : 0);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

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
 * A solid fin, flipper or fluke. The root runs along Z on the plane y = 0 (leading edge toward +Z), the span rises
 * +Y and the thickness is along X. chord = widest chord; root = root chord as a fraction of it; peak = where along
 * the span it is widest (0 = at the root); tip = tip chord fraction; pw shapes the taper; sweep = how far the tip
 * trails (in spans); curve bends the leading edge; fwd = share of the swelling that goes forward.
 */
function finGeo(o) {
  const { span, chord, peak = 0, tip = 0.2, pw = 1.2, sweep = 0.5, curve = 1.35, fwd = 0.3, thick = 0.1, rows = 9, seg = 5, lean = 0 } = o;
  const root = peak > 0 ? (o.root ?? 0.6) : 1;
  const prof = (v) => {
    if (v < peak) return lerp(root, 1, smooth(v / peak));
    const u = (v - peak) / (1 - peak);
    return lerp(1, tip, Math.pow(u, pw)) * Math.sqrt(1 - Math.pow(u, 6));
  };
  const rings = [];
  for (let r = 0; r <= rows; r++) {
    const v = (r / rows) * 0.992, c = chord * Math.max(0.04, prof(v));
    const le = chord * root * 0.5 + (c - chord * root) * fwd - sweep * span * Math.pow(v, curve), te = le - c;
    const th = thick * (chord * 0.35 + c * 0.65) * (1 - 0.6 * v), ring = [];
    for (let k = 0; k < seg * 2; k++) {
      const a = (k / (seg * 2)) * PI * 2, xc = (1 - Math.cos(a)) / 2;
      const yt = th * 1.3 * Math.sqrt(xc) * Math.pow(1 - xc, 0.8) * (a < PI ? 1 : -1);
      ring.push([yt + lean * span * v * v, span * v, le + (te - le) * xc]);
    }
    rings.push(ring);
  }
  return loft(rings, true, true);
}
function fin(o) { return H.geo(cached(`fin:${JSON.stringify(o)}`, () => finGeo(o))); }

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
function spike(len, r, hook = 0, seg = 6, flat = 1) { return H.geo(spikeGeo(hook, seg, 5, flat)).scale(r, len, r); }

/** point a +Y-built piece along direction d (any length) and put its base at p */
function aim(piece, p, d, roll = 0) {
  const l = Math.hypot(d[0], d[1], d[2]) || 1, x = d[0] / l, y = d[1] / l, z = d[2] / l;
  const tilt = Math.acos(clamp(y, -1, 1)) / DEG, yaw = Math.atan2(x, z) / DEG;
  return piece.rot(0, roll, 0).rot(tilt, 0, 0).rot(0, yaw, 0).at(p[0], p[1], p[2]);
}

// ---------- sculpt helpers ----------
/** compiled once: (from, dir) walks from `from` along `dir` (unit) until the surface of `prims` is reached */
function surfer(prims) {
  const f = distanceField(prims);
  return (from, dir) => {
    let x = from[0], y = from[1], z = from[2];
    for (let i = 0; i < 56; i++) {
      const d = f(x, y, z);
      if (!(d > 0.0008)) break;
      x += dir[0] * d * 0.9; y += dir[1] * d * 0.9; z += dir[2] * d * 0.9;
    }
    return [x, y, z];
  };
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
const LOBE = 0.9;   // lobe radius as a share of the core radius: near 1 keeps the seam between them shallow
function hull(st, paint, k = 0.04) {
  const out = [];
  const cap = (ax, ay, az, bx, by, bz, ra, rb) => S.capsule([ax, -az, ay], [bx, -bz, by], ra, rb).rot(-90, 0, 0).blend(k);
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1], ra = Math.min(a.w, a.h), rb = Math.min(b.w, b.h);
    out.push(paint(cap(0, a.y, a.z, 0, b.y, b.z, ra, rb), 'core'));
    // deeper than wide: lobes above and below; wider than deep: lobes to either side
    const ea = Math.max(0, a.h - ra * LOBE), eb = Math.max(0, b.h - rb * LOBE);
    if ((ea > 0.003 || eb > 0.003) && (a.h > a.w || b.h > b.w)) {
      out.push(paint(cap(0, a.y + ea, a.z, 0, b.y + eb, b.z, ra * LOBE, rb * LOBE), 'top'));
      out.push(paint(cap(0, a.y - ea, a.z, 0, b.y - eb, b.z, ra * LOBE, rb * LOBE), 'bottom'));
    }
    const sa = Math.max(0, a.w - ra * LOBE), sb = Math.max(0, b.w - rb * LOBE);
    if ((sa > 0.003 || sb > 0.003) && (a.w > a.h || b.w > b.h)) for (const sd of [-1, 1]) out.push(paint(cap(sd * sa, a.y, a.z, sd * sb, b.y, b.z, ra * LOBE, rb * LOBE), 'core'));
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
function slab(z0, y0, z1, y1, side = -1, pad = 0.05, D = 0.6, W = 1.6) {
  if (z1 < z0) { let t = z0; z0 = z1; z1 = t; t = y0; y0 = y1; y1 = t; }
  const ang = Math.atan2(y1 - y0, z1 - z0), len = Math.hypot(z1 - z0, y1 - y0) + pad * 2;
  return S.box(W, D, len, 0.02).rot(-ang / DEG, 0, 0).at(0, (y0 + y1) / 2 + side * Math.cos(ang) * D / 2, (z0 + z1) / 2 - side * Math.sin(ang) * D / 2);
}
/** paint everything under the line (z0, y0) - (z1, y1), for bellies */
function under(z0, y0, z1, y1, color, soft = 0.03, rough = 0.4, metal = 0) { return slab(z0, y0, z1, y1, -1).color(color).pbr(rough, metal).paint(soft, 0); }
/** a plain tapered prism from the origin along +Z: hidden inside a thin sculpted limb so that it survives at the far detail levels */
function coreGeo(r0, r1, L, k = 0.8) {
  return loft([0, 1].map((e) => { const r = (e ? r1 : r0) * k, ring = []; for (let j = 0; j < 6; j++) { const a = (j / 6) * PI * 2; ring.push([Math.cos(a) * r, Math.sin(a) * r, e * L]); } return ring; }));
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
  def = def && typeof def === 'object' ? def : {};
  const detail = getDetail();
  if (detail !== cachedDetail) { templates.clear(); cachedDetail = detail; }
  const size = num(def.size, 1) > 0 ? num(def.size, 1) : 1;
  const key = `${build.name}:${def.id || def.model}:${def.color}:${size}`;
  let tpl = templates.get(key);
  if (!tpl) { tpl = assemble(build(def), size * k); templates.set(key, tpl); }
  return cloneRigged(tpl);
}
const ROOT = { name: 'root', pos: [0, 0, 0], rot: [0, 90, 0] };

// =====================================================================================
// THE SHARED CARCASS: a hull cut into rigid pieces, with the paint, jaws, teeth and fins that go on it
// =====================================================================================
/**
 * Cut the hull TAB into segments [[name, zFront, zBack], ...] listed from the snout back. `bodyName` is the piece
 * that hangs from the root; pieces ahead of it hinge at their rear end on the piece behind (a neck, a head), pieces
 * behind it hinge at their front end on the piece ahead (a tail). Everything is authored in creature space and
 * moved into its node by nodes(). Rig tags: body, head, `necks` (from the body outward), `tail` (from the body back).
 */
function carcass(TAB, segs, bodyName, sk, o = {}) {
  const at = (z) => station(TAB, z);
  /** a point on the hull th degrees round from the top, and the way out from it */
  let sfAll = null;
  const skin = (z, th, lift = 0) => {
    const q = at(z), a = th * DEG, nx = Math.sin(a) / q.w, ny = Math.cos(a) / q.h, nl = Math.hypot(nx, ny), n = [nx / nl, ny / nl, 0];
    sfAll ||= surfer(Object.values(bare));
    // the hull is fuller than an ellipse: drop onto the real surface from just outside it
    const p = sfAll([Math.sin(a) * q.w + n[0] * 0.12, q.y + Math.cos(a) * q.h + n[1] * 0.12, z], [-n[0], -n[1], 0]);
    return { p: [p[0] + n[0] * lift, p[1] + n[1] * lift, z], n };
  };
  const bi = segs.findIndex((s) => s[0] === bodyName);
  const prims = {}, hard = {}, ORG = {}, bare = {};
  segs.forEach(([n, z0, z1], i) => {
    prims[n] = hull(span(TAB, z0, z1), sk, o.kOf?.[n] ?? o.k ?? 0.016);
    hard[n] = []; bare[n] = prims[n].slice();
    const pz = i < bi ? z1 : i > bi ? z0 : (o.pivot ?? (z0 + z1) / 2);
    ORG[n] = [0, at(pz).y + (o.lift?.[n] || 0), pz];
    // a plain core inside the thin pieces, so that they are still there at the far detail levels
    if (o.core != null && Math.min(at(z0).w, at(z1).w, at(z0).h, at(z1).h) < 0.075) {
      const rings = span(TAB, z0, z1).map((q) => { const ring = []; for (let j = 0; j < 6; j++) { const a = (j / 6) * PI * 2; ring.push([Math.cos(a) * q.w * 0.74, q.y + Math.sin(a) * q.h * 0.74, q.z]); } return ring; });
      const c = o.core;
      hard[n].push(H.geo(loft(rings)).shade(typeof c === 'function' ? c : () => c).pbr(0.4));
    }
  });
  const nodeOf = (z) => { for (const [n, z0, z1] of segs) if (z <= z0 && z >= z1) return n; return z > segs[0][1] ? segs[0][0] : segs[segs.length - 1][0]; };
  const rigOf = (n) => (n === bodyName ? 'body' : n === 'head' ? 'head' : n.startsWith('neck') ? 'necks' : n.startsWith('tail') ? 'tail' : undefined);
  const K = { TAB, segs, at, skin, prims, hard, bare, ORG, nodeOf };
  /** paint everything below line(z) on every piece */
  K.belly = (line, color, soft = 0.03, rough = 0.4, metal = 0) => {
    for (const [n, z0, z1] of segs) { const st = span(TAB, z0, z1); for (let i = 0; i < st.length - 1; i++) prims[n].push(under(st[i].z + 0.01, line(st[i].z + 0.01), st[i + 1].z - 0.01, line(st[i + 1].z - 0.01), color, soft, rough, metal)); }
  };
  /** a painted (or embossed) line along the hull at th degrees round from the top, on both flanks unless th is 0 or 180 */
  K.stripe = (z0, z1, th, r, make, step = 0.11) => {
    for (const [n, a0, a1] of segs) {
      if (Math.min(z0, a0) - Math.max(z1, a1) < 0.004) continue;
      // run a little past each joint: the rounded ends of a piece can show through its neighbour there
      const hi = Math.min(z0, a0 + 0.03), lo = Math.max(z1, a1 - 0.03);
      const m = Math.max(1, Math.ceil((hi - lo) / step));
      for (let i = 0; i < m; i++) {
        const za = lerp(hi, lo, i / m), zb = lerp(hi, lo, (i + 1) / m), ra = typeof r === 'function' ? r(za) : r, rb = typeof r === 'function' ? r(zb) : r;
        for (const sd of th % 180 === 0 ? [1] : [1, -1]) prims[n].push(make(S.capsule(skin(za + 0.004, sd * th).p, skin(zb - 0.004, sd * th).p, ra, rb)));
      }
    }
  };
  /** scatter painted blots over the hull: o = { n, z0, z1, th0, th1, r0, r1, seed, make(prim, i), stretch } */
  K.dapple = (d) => {
    for (let i = 0; i < d.n; i++) {
      const z = lerp(d.z0, d.z1, rnd(i, d.seed)), th = lerp(d.th0, d.th1, rnd(i, d.seed + 1)) * (rnd(i, d.seed + 2) > 0.5 ? 1 : -1);
      const q = skin(z, th), r = (d.r0 + rnd(i, d.seed + 3) ** 2 * (d.r1 - d.r0)) * clamp(at(z).w / (d.wref || 0.2), 0.3, 1.2);
      prims[nodeOf(z)].push(d.make(S.ellipsoid(r, r, r * (d.stretch || 1.2)).at(q.p[0], q.p[1], q.p[2]), i));
    }
  };
  /** the finished node list: detail = { default, name: multiplier }, rot = { name: [degX, degY, degZ] } */
  K.nodes = (n2 = {}) => {
    const out = [ROOT];
    const mk = (i) => {
      const n = segs[i][0], parent = i === bi ? 'root' : i < bi ? segs[i + 1][0] : segs[i - 1][0];
      out.push({ name: n, parent, rig: rigOf(n), pos: i === bi ? ORG[n].slice() : sub(ORG[n], ORG[parent]), rot: n2.rot?.[n], prims: into(ORG[n], prims[n]), hard: into(ORG[n], hard[n]), detail: n2.detail?.[n] ?? n2.detail?.default ?? 0.8, minRes: n2.minRes?.[n] });
    };
    mk(bi);
    for (let i = bi - 1; i >= 0; i--) mk(i);
    for (let i = bi + 1; i < segs.length; i++) mk(i);
    return out;
  };
  return K;
}

/**
 * Split a mouth into the piece `hn` of a carcass: everything under the line from (hinge, yH) to (tip, yT) is cut
 * away and comes back as a lower jaw on its own joint. o = { tip, hinge, yT, yH, mouth, sk, extra: prims for the jaw,
 * palate: depth of the vault, back: how far the jaw runs on behind the hinge }.
 * Call it after the head is otherwise finished (the cut takes every prim before it).
 */
function addJaw(K, hn, o) {
  const { tip, hinge, yT, yH, mouth, sk } = o, D = o.D ?? 0.6, back = o.back ?? 0.06, wk = o.wk ?? 0.97;
  const mY = (z) => lerp(yH, yT, (z - hinge) / (tip - hinge)), zF = tip + 0.3;
  K.prims[hn].push(slab(zF, mY(zF), hinge, yH, -1, 0, D).cut(0.006).color(mouth));
  if (o.palate) { const z = lerp(hinge, tip, 0.45), q = K.at(z); K.prims[hn].push(S.ellipsoid(q.w * 0.6, o.palate, (tip - hinge) * 0.42).at(0, mY(z) + 0.004, z).cut(0.02).color(tone(mouth, 0, 0, -0.1))); }
  const TJ = K.TAB.map((q) => ({ ...q, w: q.w * wk, h: q.h * wk }));
  const jawHull = hull(span(TJ, o.jawTip ?? tip - 0.01, hinge - back), sk, 0.016);
  const jaw = [...jawHull, ...(o.extra || [])];
  if (o.belly != null) jaw.push(under(zF, o.bellyLine(tip), hinge - back - 0.1, o.bellyLine(hinge - back), o.belly, 0.03, o.wet ?? 0.4));
  jaw.push(...(o.paint || []));
  jaw.push(slab(zF, mY(zF), hinge - back - 0.15, mY(hinge - back - 0.15), 1, 0, D).cut(0.006).color(mouth));
  if (o.palate) { const z = lerp(hinge, tip, 0.45), q = K.at(z); jaw.push(S.ellipsoid(q.w * 0.56, o.palate * 0.6, (tip - hinge) * 0.4).at(0, mY(z) - 0.004, z).cut(0.02).color(tone(mouth, 0, 0, -0.06))); }
  if (o.tongue) { const z = lerp(hinge, tip, 0.4), q = K.at(z); jaw.push(S.ellipsoid(q.w * 0.36, o.tongue, (tip - hinge) * 0.3).at(0, mY(z) - (o.palate || 0) * 0.6, z).color(o.tongueCol ?? 0xa04a56).pbr(0.3).blend(0.012)); }
  const J = [0, yH, hinge];
  return { J, mY, jaw, jawHull, node: (hard, open, detail) => ({ name: 'jaw', parent: hn, rig: 'jaw', pos: sub(J, K.ORG[hn]), rot: [open, 0, 0], prims: into(J, jaw), hard: into(J, hard), detail }) };
}

/**
 * A row of teeth along the lip on both sides: sf = surfer of the hull they stand on, mY = the mouth line,
 * up = +1 hangs from the upper jaw, -1 stands on the lower. len may be a function (i, f).
 */
function teeth(out, sf, o) {
  const { z0, z1, n, mY, up, r, hook = 0.2, col = 0xf2eede, lod = 1, splay = 6, flat = 1, rake = 8, inset = 1 } = o;
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0, z = lerp(z0, z1, f), y = mY(z);
    const x = clamp(sf([1.4, y + up * (o.dy ?? 0.012), z], [-1, 0, 0])[0] - r * inset, o.xMin ?? 0.004, 1.4) * (o.xk ?? 1);
    const L = typeof o.len === 'function' ? o.len(i, f) : o.len, rr = typeof r === 'function' ? r(i, f) : r;
    for (const sd of [-1, 1]) out.push(spike(L, rr, hook, 5, flat).rot(up > 0 ? 180 : 0, 0, 0).rot(up > 0 ? -rake : rake, 0, sd * (up > 0 ? splay : -splay)).at(sd * x, y + up * 0.004, z).color(typeof col === 'function' ? col(i) : col).pbr(0.25).lod(lod));
  }
}
/** eyes on both sides of piece `hn`: a socket cut into the hull and a ball set in it. Returns the surface point. */
function eyes(K, hn, sf, z, y, r, look, o = {}) {
  const p = sf([1.4, y, z], [-1, 0, 0]);
  K.prims[hn].push(...S.mirrorX([S.sphere(r * 1.16).at(p[0] - r * 0.3, y, z).cut(0.006).color(o.socket ?? 0x14181c)]));
  const ball = eye(r, { seg: r < 0.03 ? 12 : 18, ...look }).rot(o.pitch ?? 0, o.yaw ?? 80, 0).at(p[0] - r * (o.inset ?? 0.75), y, z);
  K.hard[hn].push(...H.mirrorX([r < 0.02 ? ball.near() : ball]));
  // a ring of bone round the eye (the sclerotic ring of the old sea reptiles and armoured fishes)
  if (o.ring != null) K.hard[hn].push(...H.mirrorX([H.torus(r * 1.08, r * 0.3, 14, 6).rot(o.pitch ?? 0, o.yaw ?? 80, 0).at(p[0] - r * 0.3, y, z).color(o.ring).pbr(0.6).lod(2)]));
  return p;
}
/** a fin or flipper on its own joint. at = root in creature space; rot = rest pose in degrees. */
function finNode(K, name, parent, at3, rot, pieces, rig = 'fins') {
  return { name, parent, rig, pos: sub(at3, K.ORG[parent]), rot, hard: pieces };
}
/** two-tone shading for a flipper built by fin(): over = upper side, und = under side, dark toward the tip. sd = +1 left (+X) flipper */
const flipShade = (over, und, tipCol, sp, sd) => (x, y) => mix(x * sd > 0 ? und : over, tipCol, clamp(y / sp, 0, 1) ** 1.6 * 0.6);
/**
 * An FK limb of sculpted segments from `pos` on `parent`; each segment runs down its own +Z. `rots` is a list of
 * nested base rotations (degrees). With [[0, 0, az], [-splay, 0, 0]] the limb leaves along +Z leaning `splay` degrees
 * outward at azimuth az about Z ([180 - splay, 0, 0] for one that trails down -Z); for such a limb a positive X
 * rotation of a segment closes it toward the axis and a Y rotation swings it round the axis.
 */
function chain(nodes, name, parent, pos, rots, lens, radii, o) {
  let par = parent;
  rots.forEach((r, i) => { nodes.push({ name: `${name}B${i}`, parent: par, pos: i ? [0, 0, 0] : pos, rot: r }); par = `${name}B${i}`; });
  for (let j = 0; j < lens.length; j++) {
    const L = lens[j], r0 = radii[j], r1 = radii[j + 1];
    const g = o.seg ? o.seg(j, r0, r1, L) : null;
    const prims = g ? g.prims : [o.sk(S.capsule([0, 0, 0], [0, 0, L], r0, r1), j)];
    const hard = g ? g.hard : [H.geo(coreGeo(r0, r1, L, 0.78)).color(o.col).pbr(0.4)];
    nodes.push({ name: `${name}_${j}`, parent: j ? `${name}_${j - 1}` : par, rig: o.rig, pos: j ? [0, 0, lens[j - 1]] : [0, 0, 0], rot: o.rest ? o.rest(j) : undefined, prims, hard, detail: o.detail ?? 0.8, minRes: o.minRes });
  }
}

// ---------- from seacreatures.js ----------
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

/** a barnacle: ribbed cone with a crater, base at the origin, opening +Y, radius 1 */
function barnacleGeo() {
  return cached('barnacle', () => new THREE.LatheGeometry([[1, -0.15], [0.96, 0.1], [0.72, 0.6], [0.46, 1.0], [0.36, 1.08], [0.27, 1.0], [0.2, 0.7]].map(([r, y]) => new THREE.Vector2(r, y)), 9));
}
function barnacle(r, p, n, col = 0xb9b29c) {
  return aim(H.geo(barnacleGeo()).shade((x, y, z) => (y > 0.75 && Math.hypot(x, z) < 0.36 ? 0x5a5446 : Math.sin(Math.atan2(z, x) * 9) > 0.3 ? mix(col, 0x7a705a, 0.5) : null)).scale(r, r * (0.8 + rnd(Math.round(r * 9973), 2) * 0.5), r), p, n).color(col).pbr(0.9);
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


// ---------- long bodies laid along a traced path ----------
/** a reusable buffer for a path of length `len`, sampled every `step` */
function newPath(len, step = 0.02) { const n = Math.ceil(len / step) + 3; return { step, n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n) }; }
/**
 * Trace a path back from the head joint `at` = [x, y, z, yaw]: at distance p behind the head it turns by yaw(p)
 * radians per unit and slopes down by pitch(p) radians. level = [p, y] lifts or sinks the whole path so that it
 * passes height y at distance p (so a body that rears its neck keeps its coils on the water).
 */
function trace(T, at, yaw, pitch, level) {
  let x = at[0], y = at[1], z = at[2], psi = at[3] || 0;
  for (let i = 0; i < T.n; i++) {
    const p = i * T.step, ph = pitch(p);
    T.x[i] = x; T.y[i] = y; T.z[i] = z;
    psi += fin0(yaw(p)) * T.step;
    const c = Math.cos(ph);
    x -= Math.sin(psi) * c * T.step; y -= Math.sin(ph) * T.step; z -= Math.cos(psi) * c * T.step;
  }
  if (level) {
    const i = clamp(Math.round(level[0] / T.step), 0, T.n - 1), d = level[1] - T.y[i];
    for (let k = 0; k < T.n; k++) T.y[k] += d;
  }
  return T;
}
function pathAt(T, p, o) {
  const f = clamp(p / T.step, 0, T.n - 1.001), i = Math.floor(f), k = f - i;
  o[0] = lerp(T.x[i], T.x[i + 1], k); o[1] = lerp(T.y[i], T.y[i + 1], k); o[2] = lerp(T.z[i], T.z[i + 1], k);
  return o;
}
/** n segment lengths summing to total, in proportion to w(u) for u = 0..1 */
function lens(total, n, w) { const ws = Array.from({ length: n }, (_, i) => w(n > 1 ? i / (n - 1) : 0)); const s = ws.reduce((a, b) => a + b, 0); return ws.map((v) => (v * total) / s); }
/**
 * A long body cut into a head (tip .. 0) and a chain of segments down -Z: the first segment is the rig's body,
 * the rest its tail. TAB is authored straight, with y = 0 along the axis behind the head.
 */
function serpent(TAB, tip, Ls, sk, o = {}) {
  const segs = [['head', tip, 0]];
  let z = 0;
  Ls.forEach((L, i) => { segs.push([i ? `tail${i - 1}` : 'body', z, z - L]); z -= L; });
  const K = carcass(TAB, segs, 'body', sk, { pivot: 0, ...o });
  K.Ls = Ls;
  return K;
}
/** the carcass nodes with the chain laid along `lay` (traced on T) for the rest pose; the head looks along the path */
function serpentNodes(K, lay, n2, T, hx = 0) {
  const nodes = K.nodes(n2);
  for (const nd of nodes) {
    if (nd.name === 'body') { nd.pos = lay.pos.slice(); nd.rot = eulerDeg(lay.quats[0]); }
    else if (/^tail\d+$/.test(nd.name)) nd.rot = eulerDeg(lay.quats[+nd.name.slice(4) + 1]);
    else if (nd.name === 'head') nd.rot = eulerDeg(headQuat(_hq, T, lay, hx * DEG, 0, 0));
  }
  return nodes;
}
const _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _he = new THREE.Euler(), _h0 = [0, 0, 0], _h1 = [0, 0, 0];
/** the head's turn relative to the first segment so that it looks along the start of the path, then turned by (x, y, z) */
function headQuat(out, T, lay, x = 0, y = 0, z = 0) {
  pathAt(T, 0, _h0); pathAt(T, 0.04, _h1);
  const dx = _h1[0] - _h0[0], dy = _h1[1] - _h0[1], dz = _h1[2] - _h0[2], d = Math.hypot(dx, dy, dz) || 1;
  _he.set(Math.asin(clamp(dy / d, -1, 1)), Math.atan2(-dx / d, -dz / d), 0, 'YXZ');
  out.copy(lay.abs[0]).invert().multiply(_hq2.setFromEuler(_he));
  return out.multiply(_hq2.setFromEuler(_he.set(x, y, z, 'XYZ')));
}
/** a dorsal / anal membrane along the segments of K between z0 and z1 (straight space) */
function strip(K, z0, z1, base, top, colA, colB, o = {}) {
  for (const [n, a0, a1] of K.segs) {
    const hi = Math.min(z0, a0 + 0.01), lo = Math.max(z1, a1 - 0.01);
    if (hi - lo < 0.01) continue;
    K.hard[n].push(finStrip(hi, lo, base, top, colA, colB, o).pbr(o.rough ?? 0.4, o.metal ?? 0));
  }
}
/** a strand of weed or a streamer: a ribbon through pts, wide at the root, shaded root -> tip */
function streamer(pts, w0, w1, out, colA, colB, ruffle = 0.3, rings = 12) {
  const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
  return H.geo(ribbonGeo(pts, (s) => lerp(w0, w1, s) * (0.6 + 0.4 * Math.sin(Math.min(1, s * 4) * PI / 2)), out, ruffle, rings))
    .shade((x, y, z) => mix(colA, colB, clamp(Math.hypot(x - a[0], y - a[1], z - a[2]) / L, 0, 1) ** 1.2));
}
/** a whisker / barbel: a tapering tube through pts */
function whisker(pts, r0, col, colTip = col, seg = 14) {
  const a = pts[0], radii = pts.map((_, i) => r0 * Math.pow(1 - i / pts.length, 0.9) + 0.0008);
  return H.tube(pts, radii, seg, 5).shade((x, y, z) => mix(col, colTip, clamp(Math.hypot(x - a[0], y - a[1], z - a[2]) / 0.4, 0, 1))).pbr(0.45);
}
const octaGeo = () => cached('octa', () => new THREE.OctahedronGeometry(1, 0));

// templates with a finishing step run once on the template (the mirage's own material)
function riggedWith(def, build, post) {
  def = def && typeof def === 'object' ? def : {};
  const detail = getDetail();
  if (detail !== cachedDetail) { templates.clear(); cachedDetail = detail; }
  const size = num(def.size, 1) > 0 ? num(def.size, 1) : 1;
  const key = `${build.name}:${def.id || def.model}:${def.color}:${size}`;
  let tpl = templates.get(key);
  if (!tpl) { tpl = assemble(build(def), size); post(tpl); templates.set(key, tpl); }
  return cloneRigged(tpl);
}

// =====================================================================================
// NYAMI-NYAMI: the river god of the Baobab-Kin. A dragon's head on the body of a tiger-fish: silver flanks barred
// in black and gold, blood-red fins, long whiskers and a crest of river-weed streaming from its brow
// =====================================================================================
const NYAMI = { len: 2.95, tip: 0.47, n: 14 };
NYAMI.Ls = lens(NYAMI.len, NYAMI.n, (u) => 0.7 + 0.45 * Math.sin(u * PI * 0.9));
NYAMI.T = newPath(NYAMI.len + 0.3); NYAMI.lay = newLay(NYAMI.n);
function nyamiPath(t, phase, rear = 0) {
  const w = t * 1.5 + phase, y0 = Math.sin(t * 0.55 + phase * 1.3) * 0.22 * (1 - rear);
  return trace(NYAMI.T, [0, 0, 0.9, y0],
    (p) => Math.sin(p * 2.5 - w) * 1.45 * smooth((p - 0.55) / 0.6) - (p < 0.6 ? y0 / 0.6 : 0),
    (p) => (1.0 + rear * 0.3) * (smooth((p - 0.04) / 0.3) - smooth((p - 0.55) / 0.45)) + Math.sin(p * 4.4 - w * 1.3) * 0.3 * smooth((p - 1.0) / 0.5),
    [1.15, 0.02]);
}
function nyamiDesc(def) {
  const base = num(def.color, 0x5a8a7a), back = mix(tone(base, 0.02, 0.05, -0.14), 0x16302c, 0.3), silver = 0xc8cec8, gold = 0xd9a63a, bar = 0x1e2424;
  const belly = 0xeef0e4, red = 0xc8301c, redDk = 0x6a140c, mouth = 0x8a2a30, tooth = 0xf4f0e0, horn0 = 0xe8dcb8, weed = 0x4a6a2a, weedTip = 0xa8a83a, wet = 0.26;
  const TAB = [
    { z: 0.47, w: 0.016, h: 0.014, y: -0.012 }, { z: 0.44, w: 0.034, h: 0.028, y: -0.01 }, { z: 0.35, w: 0.052, h: 0.044, y: -0.006 }, { z: 0.23, w: 0.068, h: 0.06, y: 0 },
    { z: 0.11, w: 0.08, h: 0.078, y: 0.004 }, { z: 0.0, w: 0.074, h: 0.086, y: 0 }, { z: -0.18, w: 0.074, h: 0.096, y: 0 }, { z: -0.7, w: 0.094, h: 0.135, y: 0 },
    { z: -1.35, w: 0.098, h: 0.14, y: 0 }, { z: -2.0, w: 0.078, h: 0.11, y: 0 }, { z: -2.5, w: 0.048, h: 0.07, y: 0 }, { z: -2.8, w: 0.024, h: 0.036, y: 0 }, { z: -NYAMI.len, w: 0.01, h: 0.014, y: 0 },
  ];
  const sk = (p, part) => (part === 'top' ? p.color(back).pbr(wet, 0.3) : part === 'bottom' ? p.color(belly).pbr(wet, 0.3) : p.color(silver).pbr(wet - 0.04, 0.55)).bump(0.0042, 34, 'scales').tint(0.1, 12);
  const K = serpent(TAB, NYAMI.tip, NYAMI.Ls, sk, { core: (x, y) => (y > 0.01 ? back : silver) });
  const { at, skin, prims, hard } = K;
  // ---- the skull: a dragon's brow and snout, cheeks swelling over the jaw hinge ----
  prims.head.push(
    ...S.mirrorX([
      sk(S.ellipsoid(0.03, 0.04, 0.06).at(0.064, 0.004, 0.1).blend(0.035), 'core'),
      sk(S.capsule([0.026, 0.05, 0.36], [0.056, 0.074, 0.18], 0.013, 0.022).blend(0.03), 'top'),
      sk(S.ellipsoid(0.016, 0.013, 0.026).at(0.022, 0.022, 0.42).blend(0.018), 'top'),
    ]),
    sk(S.capsule([0, 0.04, 0.38], [0, 0.074, 0.12], 0.016, 0.026).blend(0.03), 'top'),
  );
  const headHull = prims.head.slice();
  // ---- markings: an olive back, black bars along the silver flank with gold between, a white belly ----
  K.stripe(0.2, -2.9, 0, (z) => at(z).h * 0.5, (p) => p.color(back).pbr(wet, 0.3).paint(0.02, 0), 0.12);
  for (const [th, k, col, m] of [[50, 0.075, gold, 0.6], [64, 0.07, bar, 0.2], [80, 0.06, gold, 0.6], [95, 0.07, bar, 0.2], [110, 0.06, gold, 0.6], [124, 0.06, bar, 0.2]])
    K.stripe(-0.06, -2.85, th, (z) => at(z).h * k, (p) => p.color(col).pbr(wet, m).paint(0.007, 0), 0.11);
  K.belly((z) => at(z).y - at(z).h * 0.66, belly, 0.02, wet, 0.3);
  K.dapple({ n: 60, z0: -0.1, z1: -2.6, th0: 20, th1: 60, r0: 0.01, r1: 0.024, seed: 5, wref: 0.1, make: (p) => p.color(mix(back, gold, 0.4)).pbr(wet, 0.5).paint(0.006, 0) });
  // gill cover: a crescent of gold over a dark slit
  for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) { const a = skin(0.0 - Math.sin((i / 5) * PI) * 0.02, sd * (45 + i * 22)), b = skin(0.0 - Math.sin(((i + 1) / 5) * PI) * 0.02, sd * (45 + (i + 1) * 22)); prims.body.push(S.capsule(a.p, b.p, 0.008).color(0x2a1410).pbr(0.5).paint(0.004, -0.006)); prims.head.push(S.capsule(a.p, b.p, 0.012).color(gold).pbr(0.3, 0.6).paint(0.006, 0.002)); }
  eyes(K, 'head', surfer(headHull), 0.25, 0.04, 0.019, { iris: 0xf0b020, rim: 0x8a2a08, white: 0xf0c040, pupilDeg: 18, irisDeg: 54, rough: 0.08, glow: 0.4 }, { socket: 0x14100c, yaw: 70 });
  prims.head.push(...S.mirrorX([S.sphere(0.007).at(0.026, 0.026, 0.44).color(0x0c0c0a).paint(0.003, -0.004)]));
  // ---- jaws and the tiger-fish's great fangs, standing outside the lips ----
  const JW = addJaw(K, 'head', { tip: NYAMI.tip, hinge: 0.11, yT: -0.014, yH: -0.03, mouth, sk, palate: 0.022, tongue: 0.01, back: 0.04, belly, bellyLine: (z) => at(z).y - at(z).h * 0.5, wet, jawTip: NYAMI.tip - 0.02 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  teeth(hard.head, sfH, { z0: 0.17, z1: 0.43, n: 7, mY: JW.mY, up: 1, r: 0.0068, len: (i) => 0.026 + (i % 2) * 0.016 + (i === 6 ? 0.01 : 0), col: tooth, hook: 0.12, rake: 6, splay: 10, inset: 0.2 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: 0.19, z1: 0.42, n: 6, mY: JW.mY, up: -1, r: 0.0068, len: (i) => 0.026 + ((i + 1) % 2) * 0.016, col: tooth, hook: 0.12, rake: -6, splay: 10, inset: 0.2 });
  // ---- horns, whiskers and the crest of weed ----
  hard.head.push(...H.mirrorX([
    horn([[0.05, 0.066, 0.16], [0.07, 0.1, 0.09], [0.085, 0.15, 0.03], [0.08, 0.2, -0.02], [0.06, 0.23, -0.01]], 0.017, 0.005, horn0, 0x6a4a2a),
    whisker([[0.03, -0.006, 0.42], [0.07, -0.02, 0.38], [0.13, -0.06, 0.29], [0.18, -0.11, 0.16], [0.2, -0.15, 0.02], [0.2, -0.17, -0.1]], 0.006, gold, red),
    whisker([[0.05, -0.02, 0.2], [0.09, -0.06, 0.16], [0.12, -0.11, 0.08], [0.13, -0.15, -0.02]], 0.004, gold, red, 10),
  ]));
  const weedStrand = (x, y, z, k, i) => streamer([[x, y, z], [x * 1.6, y + 0.06 * k, z - 0.07], [x * 2.6, y + 0.09 * k, z - 0.2 * k], [x * 3.4, y + 0.07 * k, z - 0.36 * k], [x * 4, y + 0.02 * k, z - 0.5 * k]],
    0.018 * k, 0.006, [1, 0, 0], mix(weed, 0x2a3a1a, rnd(i, 3) * 0.6), weedTip, 0.45, 12).pbr(0.55);
  for (let i = 0; i < 7; i++) hard.head.push(weedStrand((i % 2 ? 1 : -1) * (0.006 + (i % 3) * 0.006), 0.07 + (i < 3 ? 0.012 : 0), 0.24 - i * 0.03, 0.8 + rnd(i, 5) * 0.4, i));
  for (let i = 0; i < 6; i++) { const z = -0.03 - i * 0.12; hard[K.nodeOf(z)].push(weedStrand((i % 2 ? 1 : -1) * 0.008, at(z).h - 0.01, z, 0.65 - i * 0.06, i + 10)); }
  // ---- fins: a red dorsal and anal running to a forked red tail; red pectorals behind the gills ----
  const finH = (z) => 0.085 * smooth((-0.25 - z) / 0.3) * (1 - smooth((z + 2.5) / -0.3)) * (1 + 0.12 * Math.sin(z * 30));
  strip(K, -0.25, -2.75, (z) => at(z).h - 0.02, (z) => at(z).h + finH(z), redDk, red, { rays: 160, amp: 0.006 });
  strip(K, -1.7, -2.75, (z) => -at(z).h + 0.02, (z) => -at(z).h - 0.055 * smooth((-1.7 - z) / 0.3), redDk, red, { rays: 160 });
  const fcol = (sp) => (x, y) => mix(redDk, red, clamp(y / sp, 0, 1) ** 0.8);
  const lobe = (ang, down) => fin({ span: 0.34, chord: 0.12, tip: 0.12, sweep: 0.4, thick: 0.08, pw: 0.85, rows: 9, curve: 1.6 }).shade(fcol(0.34)).pbr(0.4).rot(0, 0, down ? 180 : 0).rot(ang, 0, 0).at(0, 0, -NYAMI.len + 0.08);
  const last = `tail${NYAMI.n - 2}`;
  hard[last].push(lobe(-36, false), lobe(36, true));
  const pec = (sd) => [fin({ span: 0.24, chord: 0.11, tip: 0.2, sweep: 0.6, thick: 0.1, pw: 0.9, rows: 8 }).shade(flipShade(redDk, red, red, 0.24, sd)).pbr(0.4)];
  const lay = layChain((p, o) => pathAt(nyamiPath(0, 0), p, o), NYAMI.Ls, NYAMI.lay);
  const nodes = serpentNodes(K, lay, { detail: { default: 0.55, head: 0.95 }, minRes: { [last]: 30 } }, NYAMI.T);
  nodes.push(JW.node(jawHard, 10, 0.95));
  nodes.push(finNode(K, 'finL', 'body', [at(-0.1).w - 0.012, -0.05, -0.1], [-30, -16, -115], pec(1)), finNode(K, 'finR', 'body', [-(at(-0.1).w - 0.012), -0.05, -0.1], [-30, 16, 115], pec(-1)));
  return { kind: 'nyamiNyami', nodes };
}
function animNyami(model, ctx) {
  const rig = model?.userData?.rig; if (!rig) return;
  const t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  // it rises on its neck and calls up the river (its wave), then strikes down with the fangs
  const c = frac(t * 0.14 + phase * 0.19), rear = pulse(c, 0.0, 0.36), strike = pulse(c, 0.26, 0.42);
  nyamiPath(t, phase, rear - strike * 0.6);
  laySerpent(rig, NYAMI.T, NYAMI.lay, NYAMI.Ls, -rear * 0.32 + strike * 0.32 + Math.sin(t * 1.2 + phase) * 0.04, Math.sin(t * 0.8 + phase) * 0.08 * (1 - rear), 0);
  R(rig.jaw, 0.04 + Math.max(0, Math.sin(t * 1.6 + phase)) * 0.07 + rear * 0.55 - strike * 0.45);
  (rig.fins || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, Math.sin(t * 2.2 + phase + i * 2) * 0.15, 0, sg * Math.sin(t * 2.2 + phase + i * 2 + 0.9) * 0.18); });
}

// =====================================================================================
// VASUKI-LEVIATHAN: the serpent-king of the Nagavar. A hooded sea-cobra of iridescent emerald banded in gold, its
// neck reared above the waves, its coils thrown in great loops across the water, wide enough to take a ship
// =====================================================================================
const VASU = { len: 4.5, tip: 0.4, n: 19 };
VASU.Ls = [0.42, ...lens(VASU.len - 0.42, VASU.n - 1, (u) => 0.9 + 0.2 * Math.sin(u * PI))];
VASU.T = newPath(VASU.len + 0.3); VASU.lay = newLay(VASU.n);
function vasukiPath(t, phase, rear = 0, strike = 0) {
  const w = t * 0.8 + phase, y0 = Math.sin(t * 0.45 + phase * 1.7) * 0.35 * (1 - rear);
  const up = 1.42 + rear * 0.1 - strike * 0.55;
  return trace(VASU.T, [0, 0, 0.5 + strike * 0.12, y0],
    (p) => 2.5 * Math.sin((p - 0.9) * 1.85 - w * 0.5) * smooth((p - 0.7) / 0.5) - (p > 0.45 && p < 0.85 ? y0 / 0.4 : 0),
    (p) => up * (smooth(p / 0.08) - smooth((p - 0.48) / 0.4)) + Math.sin(p * 4.6 - w * 2.2) * 0.62 * smooth((p - 1.1) / 0.5) * (1 - smooth((p - 4.0) / 0.4)),
    [1.0, -0.03]);
}
function vasukiDesc(def) {
  const em = num(def.color, 0x2a8a5a), back = mix(tone(em, 0.02, 0.05, -0.12), 0x062a1c, 0.25), lite = tone(em, -0.03, 0.08, 0.1), teal = mix(em, 0x2ab8b0, 0.5), blue = mix(em, 0x2a5ab8, 0.45);
  const gold = 0xf2c23a, goldDk = 0x8a5a14, cream = 0xece0b0, black = 0x0e1410, mouth = 0x5a1a2a, fang = 0xf6f0de, wet = 0.24, MET = 0.35;
  const TAB = [
    { z: 0.4, w: 0.02, h: 0.014, y: -0.008 }, { z: 0.37, w: 0.048, h: 0.026, y: -0.006 }, { z: 0.29, w: 0.078, h: 0.04, y: -0.002 }, { z: 0.18, w: 0.094, h: 0.05, y: 0.002 },
    { z: 0.08, w: 0.088, h: 0.052, y: 0 }, { z: 0.0, w: 0.07, h: 0.058, y: 0 }, { z: -0.08, w: 0.074, h: 0.058, y: 0 }, { z: -0.25, w: 0.09, h: 0.055, y: 0 }, { z: -0.42, w: 0.086, h: 0.066, y: 0 },
    { z: -0.6, w: 0.09, h: 0.082, y: 0 }, { z: -1.1, w: 0.115, h: 0.105, y: 0 }, { z: -2.3, w: 0.13, h: 0.12, y: 0 }, { z: -3.5, w: 0.11, h: 0.1, y: 0 }, { z: -4.1, w: 0.066, h: 0.062, y: 0 },
    { z: -4.38, w: 0.03, h: 0.03, y: 0 }, { z: -VASU.len, w: 0.01, h: 0.012, y: 0 },
  ];
  const sk = (p, part) => (part === 'bottom' ? p.color(cream).pbr(0.34).bump(0.004, 22, 'ridges') : p.color(part === 'top' ? back : em).pbr(wet, MET).bump(0.0055, 26, 'scales')).tint(0.12, 7);
  const K = serpent(TAB, VASU.tip, VASU.Ls, sk, { core: (x, y) => (y < -0.02 ? cream : em) });
  const { at, prims, hard } = K;
  // a broad, flat cobra's head under gold crown-shields
  prims.head.push(...S.mirrorX([sk(S.ellipsoid(0.04, 0.03, 0.07).at(0.05, 0.004, 0.1).blend(0.035), 'core'), sk(S.capsule([0.03, 0.03, 0.32], [0.06, 0.042, 0.16], 0.012, 0.02).blend(0.03), 'top')]));
  const headHull = prims.head.slice();
  const shield = (x, z, rw, rz) => prims.head.push(S.box(rw * 2, 0.2, rz * 2, Math.min(rw, rz) * 0.6).at(x, 0.05, z).color(gold).pbr(0.25, 0.8).paint(0.006, 0.004));
  shield(0, 0.25, 0.026, 0.04); shield(0.035, 0.17, 0.026, 0.045); shield(-0.035, 0.17, 0.026, 0.045); shield(0, 0.1, 0.03, 0.04); shield(0, 0.33, 0.02, 0.025);
  // ---- iridescent scales: emerald darkening over the back, flecked with teal and blue; gold bands edged in black ----
  K.stripe(0.0, -4.4, 0, (z) => at(z).h * 0.45, (p) => p.color(back).pbr(wet, MET).paint(0.02, 0), 0.14);
  K.dapple({ n: 260, z0: -0.05, z1: -4.35, th0: 10, th1: 110, r0: 0.012, r1: 0.03, seed: 81, wref: 0.12, make: (p, i) => p.color(i % 3 === 0 ? teal : i % 3 === 1 ? blue : lite).pbr(wet - 0.05, 0.55).paint(0.006, 0) });
  K.belly((z) => at(z).y - at(z).h * 0.4, cream, 0.012, 0.34);
  for (let z = -0.6; z > -4.25; z -= 0.32) {
    prims[K.nodeOf(z)].push(S.box(0.7, 0.7, 0.07, 0.01).at(0, 0, z).color(black).pbr(0.3, 0.3).paint(0.006, 0));
    prims[K.nodeOf(z)].push(S.box(0.7, 0.7, 0.04, 0.01).at(0, 0, z).color(gold).pbr(0.3, 0.45).glow(0.08).paint(0.005, 0.005));
  }
  eyes(K, 'head', surfer(headHull), 0.255, 0.03, 0.017, { iris: 0xe8d030, rim: 0x2a4a10, white: 0xe8d030, shape: 'slit', pupilDeg: 14, irisDeg: 62, rough: 0.06, glow: 0.55 }, { socket: 0x081008, yaw: 64, ring: gold });
  prims.head.push(...S.mirrorX([S.sphere(0.007).at(0.022, 0.012, 0.385).color(0x081008).paint(0.003, -0.004)]));
  // ---- jaws: two great hollow fangs, and a forked tongue ----
  const JW = addJaw(K, 'head', { tip: VASU.tip, hinge: 0.07, yT: -0.012, yH: -0.022, mouth, sk, palate: 0.018, back: 0.04, belly: cream, bellyLine: (z) => at(z).y - at(z).h * 0.3, wet, jawTip: VASU.tip - 0.016 });
  const sfH = surfer(headHull);
  hard.head.push(...H.mirrorX([spike(0.07, 0.009, 0.45, 6).rot(180, 0, 0).rot(-14, 0, 6).at(0.04, JW.mY(0.34) + 0.006, 0.34).color(fang).pbr(0.18)]));
  teeth(hard.head, sfH, { z0: 0.14, z1: 0.3, n: 5, mY: JW.mY, up: 1, r: 0.004, len: 0.014, col: fang, hook: 0.2, rake: 6, inset: 0.6 });
  const jawHard = [
    H.tube([[0, -0.02, 0.2], [0, -0.018, 0.34], [0, -0.016, 0.44]], [0.007, 0.005, 0.0035], 8, 6).color(0x2a0a14).pbr(0.3),
    ...H.mirrorX([H.tube([[0, -0.016, 0.44], [0.01, -0.012, 0.48], [0.022, -0.004, 0.51]], [0.0035, 0.0022, 0.0008], 6, 5).color(0x2a0a14).pbr(0.3)]),
  ];
  // ---- the hood: a broad flap round the reared neck, spectacled on the back in black and gold ----
  const HL = 0.4, hw = (u) => 0.07 + 0.26 * Math.pow(Math.sin(PI * Math.pow(u, 0.72)), 1.15);
  const rings = [];
  for (let r = 0; r <= 14; r++) {
    const u = 0.02 + (r / 14) * 0.96, z = -u * HL, w = hw(u), ring = [];
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * PI * 2, x = w * Math.cos(a), s = Math.sin(a), th = 0.01 + 0.045 * Math.max(0, 1 - (x / 0.085) ** 2);
      ring.push([x, Math.sign(s) * th * Math.sqrt(Math.abs(s)) - 0.07 * (x / 0.33) ** 2 + 0.01, z]);
    }
    rings.push(ring);
  }
  const hoodShade = (x, y, z) => {
    const u = -z / HL, w = hw(clamp(u, 0, 1)), dorsal = y > 0.01 - 0.07 * (x / 0.33) ** 2;
    if (!dorsal) return Math.abs(((-z + 0.02) % 0.1) - 0.05) < 0.012 && u < 0.7 ? mix(cream, 0x3a2a10, 0.6) : mix(cream, em, Math.abs(x) / w * 0.5);
    const d = Math.hypot(Math.abs(x) - 0.13, z + 0.15);
    if (d < 0.026) return black; if (d < 0.046) return gold; if (d < 0.06) return black;
    if (Math.abs(x) > w - 0.016) return gold;
    if (Math.abs(z + 0.3) < 0.01 && Math.abs(x) < 0.1) return gold;
    return mix(em, back, clamp(Math.abs(x) / w, 0, 1) * 0.6 + noise3(x * 40, z * 40, 1) * 0.3);
  };
  const hood = H.geo(loft(rings)).shade(hoodShade).pbr(0.3, 0.3);
  const lay = layChain((p, o) => pathAt(vasukiPath(0, 0), p, o), VASU.Ls, VASU.lay);
  const nodes = serpentNodes(K, lay, { detail: { default: 0.46, head: 0.95, body: 0.7 } }, VASU.T, -6);
  nodes.push(JW.node(jawHard, 8, 0.95));
  nodes.push({ name: 'hood', parent: 'body', rig: 'frills', pos: [0, 0, 0], hard: [hood] });
  return { kind: 'vasukiLeviathan', nodes };
}
function animVasuki(model, ctx) {
  const rig = model?.userData?.rig; if (!rig) return;
  const t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  // the hood flares as it draws back, then the head drives down and out at the ship; the coils sway and arch
  const c = frac(t * 0.12 + phase * 0.17), rear = pulse(c, 0.0, 0.32), strike = pulse(c, 0.24, 0.42), snap = pulse(c, 0.34, 0.44);
  vasukiPath(t, phase, rear, strike);
  laySerpent(rig, VASU.T, VASU.lay, VASU.Ls, -rear * 0.28 + strike * 0.45 + Math.sin(t * 1.1 + phase) * 0.04, Math.sin(t * 0.7 + phase) * 0.1 * (1 - rear - strike), 0);
  R(rig.jaw, 0.03 + Math.max(0, Math.sin(t * 1.9 + phase)) * 0.06 + rear * 0.75 - snap * 0.7);
  const hood = rig.frills?.[0];
  if (hood) { const f = 1 + rear * 0.22 + Math.sin(t * 2.1 + phase) * 0.02; hood.scale.set(f, 1, 1); }
}

// =====================================================================================
// MIRAGE-LEVIATHAN: the Glimmer-Hill's trick of light. No beast at all but a towering sea-serpent of mist and
// glimmer thrown up from a brass projector-buoy bobbing at its foot
// =====================================================================================
const MIRA = { len: 3.3, tip: 0.44, n: 14 };
MIRA.Ls = lens(MIRA.len, MIRA.n, (u) => 0.75 + 0.4 * Math.sin(u * PI * 0.85));
MIRA.T = newPath(MIRA.len + 0.3); MIRA.lay = newLay(MIRA.n);
function miragePath(t, phase, rear = 0) {
  const w = t * 1.1 + phase, y0 = Math.sin(t * 0.5 + phase) * 0.3;
  return trace(MIRA.T, [0, 0, 0.62, y0],
    (p) => Math.sin(p * 2.2 - w) * 1.6 * smooth((p - 1.2) / 0.5) - (p > 0.9 && p < 1.3 ? y0 / 0.4 : 0),
    (p) => (1.22 + rear * 0.12) * (smooth((p - 0.02) / 0.22) - smooth((p - 0.95) / 0.5)) - 0.25 * smooth(p / 0.1) * (1 - smooth((p - 0.25) / 0.2)) + Math.sin(p * 4.6 - w * 1.4) * 0.36 * smooth((p - 1.6) / 0.5),
    [1.55, -0.03]);
}
let _mirageMat = null;
function mirageMat() {
  if (!_mirageMat) {
    _mirageMat = sculptMaterial().clone();
    Object.assign(_mirageMat, { transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  }
  return _mirageMat;
}
function mirageDesc(def) {
  const base = num(def.color, 0xb8d8f0), pale = mix(base, 0xffffff, 0.35), cyan = mix(base, 0x40e0ff, 0.5), violet = mix(base, 0x9a70f0, 0.55), goldL = 0xffd890, deep = mix(base, 0x2a50c0, 0.5);
  const brass = 0xb8862e, brassDk = 0x6a4a18, verd = 0x4a8a6a, G = 0.85;
  const TAB = [
    { z: 0.44, w: 0.016, h: 0.014, y: -0.012 }, { z: 0.41, w: 0.032, h: 0.028, y: -0.01 }, { z: 0.32, w: 0.05, h: 0.044, y: -0.006 }, { z: 0.2, w: 0.066, h: 0.06, y: 0 },
    { z: 0.09, w: 0.078, h: 0.076, y: 0.004 }, { z: 0.0, w: 0.068, h: 0.074, y: 0 }, { z: -0.4, w: 0.07, h: 0.078, y: 0 }, { z: -1.1, w: 0.098, h: 0.104, y: 0 },
    { z: -1.9, w: 0.094, h: 0.1, y: 0 }, { z: -2.6, w: 0.06, h: 0.066, y: 0 }, { z: -3.05, w: 0.03, h: 0.034, y: 0 }, { z: -MIRA.len, w: 0.01, h: 0.012, y: 0 },
  ];
  // light, not flesh: every surface glows; the colours drift from white-gold at the head through cyan to violet
  const hue = (z) => (z > -0.2 ? mix(pale, goldL, 0.3) : z > -1.6 ? mix(pale, cyan, clamp((-0.2 - z) / 1.4, 0, 1)) : mix(cyan, violet, clamp((-1.6 - z) / 1.5, 0, 1)));
  const sk = (p, part) => p.color(part === 'top' ? mix(deep, cyan, 0.5) : part === 'bottom' ? pale : cyan).pbr(0.3, 0).glow(G).tint(0.25, 6);
  const K = serpent(TAB, MIRA.tip, MIRA.Ls, sk, { core: cyan });
  const { at, prims, hard } = K;
  for (const [n, z0, z1] of K.segs) prims[n].push(S.box(0.7, 0.7, z0 - z1 + 0.06, 0.01).at(0, 0, (z0 + z1) / 2).color(hue((z0 + z1) / 2)).glow(G).paint(0.03, 0));
  prims.head.push(...S.mirrorX([sk(S.capsule([0.024, 0.046, 0.34], [0.05, 0.07, 0.17], 0.012, 0.02).blend(0.03), 'top'), sk(S.ellipsoid(0.03, 0.036, 0.055).at(0.06, 0.004, 0.09).blend(0.03), 'core')]));
  const headHull = prims.head.slice();
  // bands of brighter light run down the body like the rings of a lantern-slide
  for (let z = -0.3; z > -3.1; z -= 0.22) prims[K.nodeOf(z)].push(S.box(0.7, 0.7, 0.03, 0.01).at(0, 0, z).color(goldL).glow(1.2).paint(0.012, 0));
  K.stripe(0.3, -3.2, 0, (z) => at(z).h * 0.25, (p) => p.color(0xffffff).glow(1.3).paint(0.02, 0), 0.14);
  eyes(K, 'head', surfer(headHull), 0.24, 0.035, 0.018, { iris: 0xffffff, rim: 0xffe0a0, white: 0xfff4d0, shape: 'none', irisDeg: 60, rough: 0.1, glow: 1.6 }, { socket: 0x6080c0 });
  const JW = addJaw(K, 'head', { tip: MIRA.tip, hinge: 0.1, yT: -0.014, yH: -0.028, mouth: 0x3040a0, sk, palate: 0.02, back: 0.04, jawTip: MIRA.tip - 0.02 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  teeth(hard.head, sfH, { z0: 0.16, z1: 0.4, n: 7, mY: JW.mY, up: 1, r: 0.005, len: 0.024, col: 0xffffff, hook: 0.2, rake: 6, inset: 0.4 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: 0.18, z1: 0.39, n: 6, mY: JW.mY, up: -1, r: 0.005, len: 0.022, col: 0xffffff, hook: 0.2, rake: -6, inset: 0.4 });
  for (const h of [...hard.head, ...jawHard]) h.glow(1.2);
  // horns and frills of light
  const fr = (sd) => place(fan([{ a: -20, len: 0.12 }, { a: 10, len: 0.2 }, { a: 40, len: 0.24 }, { a: 70, len: 0.24 }, { a: 100, len: 0.19 }, { a: 130, len: 0.12 }], cyan, goldL, 0xffffff, { dip: 0.25, cup: -0.05 * sd, spineR: 0.005 }), 0, sd * -38, sd * -14, sd * 0.07, 0.01, 0.05);
  hard.head.push(...fr(1), ...fr(-1), ...H.mirrorX([horn([[0.04, 0.06, 0.18], [0.06, 0.1, 0.1], [0.075, 0.16, 0.02], [0.07, 0.22, -0.04]], 0.014, 0.004, goldL, 0xffffff)]));
  // a sail of light down the back, and a leaf of a tail
  const finH = (z) => 0.09 * smooth((-0.1 - z) / 0.3) * (1 - smooth((z + 2.9) / -0.3)) * (1 + 0.15 * Math.sin(z * 22));
  strip(K, -0.1, -3.05, (z) => at(z).h - 0.02, (z) => at(z).h + finH(z), deep, goldL, { rays: 120, amp: 0.008 });
  const last = `tail${MIRA.n - 2}`;
  hard[last].push(...place(fan([{ a: 30, len: 0.12 }, { a: 55, len: 0.22 }, { a: 80, len: 0.28 }, { a: 100, len: 0.28 }, { a: 125, len: 0.22 }, { a: 150, len: 0.12 }], violet, goldL, 0xffffff, { dip: 0.2 }), 0, 0, 0, 0, 0, -MIRA.len + 0.12));
  // motes of glimmer drifting about the body
  const mote = (r, x, y, z, i) => H.geo(octaGeo()).scale(r, r * 1.6, r).rot(0, i * 37, 0).at(x, y, z).color(i % 3 ? 0xffffff : i % 2 ? goldL : cyan).glow(2).lod(1);
  for (const [n, z0, z1] of K.segs) {
    const k = n === 'head' ? 6 : 5;
    for (let j = 0; j < k; j++) {
      const i = (z0 * 100 | 0) * 7 + j, z = lerp(z0, z1, rnd(i, 1)), q = at(z), a = rnd(i, 2) * PI * 2, d = 1.25 + rnd(i, 3) * 1.4;
      hard[n].push(mote(0.007 + rnd(i, 4) * 0.008, Math.cos(a) * q.w * d, Math.sin(a) * q.h * d, z, i));
    }
  }
  for (const h of Object.values(hard).flat()) if (h.glowV < 0.5) h.glow(0.9);
  const lay = layChain((p, o) => pathAt(miragePath(0, 0), p, o), MIRA.Ls, MIRA.lay);
  const nodes = serpentNodes(K, lay, { detail: { default: 0.55, head: 0.95 } }, MIRA.T);
  nodes.push(JW.node(jawHard, 10, 0.95));
  // ---- the give-away: a brass buoy where the neck meets the water, a lens in its crown throwing the light ----
  const nb = pathAt(MIRA.T, 1.5, [0, 0, 0]), BZ = nb[2] + 0.2, by = 0.0;
  const buoy = [
    H.lathe([[0.0, -0.09], [0.05, -0.085], [0.08, -0.05], [0.088, 0.0], [0.08, 0.03], [0.05, 0.05], [0.036, 0.055], [0.036, 0.1], [0.044, 0.105], [0.044, 0.118], [0.0, 0.12]], 18)
      .shade((x, y) => (y < -0.02 ? mix(verd, brassDk, 0.4) : Math.abs(y - 0.0) < 0.006 || Math.abs(y - 0.104) < 0.004 ? brassDk : brass)).pbr(0.3, 0.85),
    H.sphere(0.03, 14).at(0, 0.13, 0).color(0xfff2c0).pbr(0.05, 0).glow(1.6),
    ...[0, 1, 2, 3].map((k) => H.box(0.006, 0.05, 0.006, 0.001).rot(0, k * 90 + 45, 0).at(Math.cos(k * PI / 2 + PI / 4) * 0.032, 0.14, Math.sin(k * PI / 2 + PI / 4) * 0.032).color(brass).pbr(0.3, 0.85)),
    H.cone(0.04, 0.03, 10).rot(180, 0, 0).at(0, 0.185, 0).color(brassDk).pbr(0.35, 0.8),
    ...Array.from({ length: 10 }, (_, k) => H.sphere(0.006, 6).at(Math.cos(k * 0.628) * 0.087, 0.0, Math.sin(k * 0.628) * 0.087).color(brassDk).pbr(0.3, 0.9).lod(1)),
  ];
  const lens0 = [0, 0.13, BZ], head0 = pathAt(MIRA.T, 0.15, [0, 0, 0]), dir = sub(head0, lens0);
  const beam = [aim(H.cyl(0.16, 0.012, 1, 16, true).at(0, 0.5, 0).scale(1, Math.hypot(dir[0], dir[1], dir[2]) * 0.92, 1), lens0, dir).color(0x8090a0).pbr(1, 0).glow(1)];
  nodes.push({ name: 'buoy', parent: 'root', rig: 'buoy', pos: [0, by, BZ], hard: buoy, detail: 1 });
  nodes.push({ name: 'beam', parent: 'root', rig: 'beam', pos: [0, 0, 0], hard: beam });
  return { kind: 'mirageLeviathan', nodes };
}
function finishMirage(tpl) {
  // everything but the buoy is light: drawn additively, half seen through, casting no shadow
  tpl.traverse((o) => {
    if (!o.isMesh) return;
    let p = o.parent, isBuoy = false;
    while (p) { if (p.name.startsWith('rig:buoy')) { isBuoy = true; break; } p = p.parent; }
    if (!isBuoy) { o.material = mirageMat(); o.castShadow = false; o.renderOrder = 2; }
  });
}
function animMirage(model, ctx) {
  const rig = model?.userData?.rig; if (!rig) return;
  const t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const c = frac(t * 0.17 + phase * 0.23), rear = pulse(c, 0.0, 0.35), lunge = pulse(c, 0.25, 0.45);
  miragePath(t, phase, rear - lunge);
  laySerpent(rig, MIRA.T, MIRA.lay, MIRA.Ls);
  // now and then the picture slips, as a projection does when the buoy rolls
  const g = frac(t * 0.37 + phase * 0.31), slip = g > 0.9 ? Math.sin(g * 120) * 0.04 : 0;
  if (rig.body) rig.body.position.x += slip;
  R(rig.head, -rear * 0.3 + lunge * 0.35 + Math.sin(t * 1.1 + phase) * 0.05, Math.sin(t * 0.75 + phase) * 0.12, slip * 3);
  R(rig.jaw, 0.06 + rear * 0.6 - lunge * 0.5 + Math.max(0, Math.sin(t * 1.5 + phase)) * 0.06);
  const b = rig.buoy?.[0];
  if (b) { P(b, 0, Math.sin(t * 1.7 + phase) * 0.012, 0); R(b, Math.sin(t * 1.3 + phase) * 0.12, t * 0.6, Math.sin(t * 1.1 + phase + 1) * 0.1); }
  const m = _mirageMat;
  if (m) m.opacity = 0.46 + Math.sin(t * 2.7) * 0.06 + (frac(t * 0.37) > 0.9 ? -0.15 : 0);
}

// =====================================================================================
// WOLF-EEL OF THE BLACK GULF: the Khanates' hounds of the sea. A long grey eel with a wolf's head: a lupine snout,
// pricked ears, a shaggy black mane down the neck; they hunt in packs
// =====================================================================================
const WOLF = { len: 2.7, tip: 0.42, n: 12 };
WOLF.Ls = lens(WOLF.len, WOLF.n, (u) => 0.85 + 0.25 * Math.sin(u * PI));
WOLF.T = newPath(WOLF.len + 0.3); WOLF.lay = newLay(WOLF.n);
function wolfPath(t, phase, lunge = 0) {
  const w = t * 3.4 + phase;
  return trace(WOLF.T, [0, 0, 1.0 + lunge * 0.1, Math.sin(t * 1.3 + phase) * 0.15],
    (p) => Math.sin(p * 3.4 - w) * (1.2 + 1.4 * smooth(p / 2)) * smooth((p - 0.2) / 0.4),
    (p) => (0.32 + lunge * 0.2) * (smooth(p / 0.12) - smooth((p - 0.3) / 0.4)) + Math.sin(p * 4.2 - w * 0.6) * 0.18 * smooth((p - 0.7) / 0.5),
    [0.85, -0.035]);
}
function wolfEelDesc(def) {
  const base = num(def.color, 0x3a3a3a), grey = tone(base, 0, 0.02, 0.2), back = mix(base, 0x16181a, 0.4), belly = 0xb8b2a4, mane = 0x141416, maneTip = 0x4a4a4e;
  const spot = mix(base, 0x101012, 0.5), nose = 0x0a0a0a, mouth = 0x6a2028, tooth = 0xf2ecdc, wet = 0.34;
  const TAB = [
    { z: 0.42, w: 0.02, h: 0.022, y: -0.01 }, { z: 0.39, w: 0.03, h: 0.032, y: -0.006 }, { z: 0.3, w: 0.04, h: 0.042, y: -0.002 }, { z: 0.21, w: 0.054, h: 0.052, y: 0.004 },
    { z: 0.14, w: 0.074, h: 0.07, y: 0.016 }, { z: 0.06, w: 0.086, h: 0.08, y: 0.016 }, { z: 0.0, w: 0.08, h: 0.084, y: 0 }, { z: -0.25, w: 0.078, h: 0.096, y: 0 },
    { z: -0.9, w: 0.084, h: 0.108, y: 0 }, { z: -1.7, w: 0.064, h: 0.09, y: 0 }, { z: -2.3, w: 0.04, h: 0.062, y: 0 }, { z: -2.6, w: 0.018, h: 0.032, y: 0 }, { z: -WOLF.len, w: 0.008, h: 0.012, y: 0 },
  ];
  const sk = (p, part) => p.color(part === 'top' ? back : part === 'bottom' ? belly : grey).pbr(wet).bump(0.003, 40).tint(0.12, 14);
  const fur = (p, c = mane) => p.color(c).pbr(0.85).bump(0.007, 30, 'fur').tint(0.2, 18);
  const K = serpent(TAB, WOLF.tip, WOLF.Ls, sk, { core: grey });
  const { at, prims, hard } = K;
  // ---- the wolf's skull: a stop above the eyes, a long muzzle, heavy jowls, a black nose ----
  prims.head.push(
    ...S.mirrorX([
      sk(S.ellipsoid(0.036, 0.04, 0.06).at(0.05, 0.004, 0.09).blend(0.035), 'core'),
      sk(S.capsule([0.022, 0.052, 0.24], [0.04, 0.07, 0.12], 0.012, 0.02).blend(0.03), 'top'),
      fur(S.ellipsoid(0.03, 0.05, 0.05).at(0.07, -0.02, 0.04).blend(0.03), mix(grey, mane, 0.5)),
    ]),
    sk(S.capsule([0, 0.035, 0.36], [0, 0.07, 0.17], 0.014, 0.024).blend(0.03), 'top'),
    S.ellipsoid(0.022, 0.016, 0.018).at(0, 0.016, 0.418).color(nose).pbr(0.2).blend(0.015),
  );
  const headHull = prims.head.slice();
  prims.head.push(...S.mirrorX([S.sphere(0.006).at(0.009, 0.014, 0.432).color(0x000000).paint(0.003, -0.004)]));
  K.stripe(0.32, -2.6, 0, (z) => at(z).h * 0.45, (p) => p.color(back).pbr(wet).paint(0.02, 0), 0.13);
  K.belly((z) => at(z).y - at(z).h * 0.5, belly, 0.02, wet);
  K.dapple({ n: 120, z0: -0.1, z1: -2.5, th0: 25, th1: 110, r0: 0.01, r1: 0.024, seed: 91, wref: 0.09, make: (p) => p.color(spot).pbr(wet).paint(0.006, 0) });
  // a pale muzzle and a dark mask about the eyes
  prims.head.push(S.ellipsoid(0.05, 0.03, 0.12).at(0, -0.03, 0.32).color(mix(grey, belly, 0.6)).pbr(wet).paint(0.02, 0));
  prims.head.push(...S.mirrorX([S.ellipsoid(0.03, 0.02, 0.04).at(0.04, 0.045, 0.2).color(mane).pbr(0.6).paint(0.012, 0)]));
  eyes(K, 'head', surfer(headHull), 0.205, 0.05, 0.014, { iris: 0xf0b020, rim: 0x6a3a08, white: 0xe8b030, pupilDeg: 16, irisDeg: 56, rough: 0.06, glow: 0.7 }, { socket: 0x0a0a0a, yaw: 58, pitch: -6 });
  // ---- jaws and a wolf's teeth: canines, carnassials ----
  const JW = addJaw(K, 'head', { tip: WOLF.tip, hinge: 0.09, yT: -0.014, yH: -0.03, mouth, sk, palate: 0.02, tongue: 0.01, back: 0.04, belly, bellyLine: (z) => at(z).y - at(z).h * 0.3, wet, jawTip: WOLF.tip - 0.014 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  teeth(hard.head, sfH, { z0: 0.15, z1: 0.4, n: 7, mY: JW.mY, up: 1, r: 0.005, len: (i) => (i === 5 ? 0.04 : 0.016), col: tooth, hook: 0.25, rake: 6, splay: 8, inset: 0.5 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: 0.16, z1: 0.39, n: 6, mY: JW.mY, up: -1, r: 0.005, len: (i) => (i === 4 ? 0.036 : 0.015), col: tooth, hook: 0.25, rake: -6, splay: 8, inset: 0.5 });
  jawHard.push(...H.mirrorX([H.tube([[0.02, -0.06, 0.12], [0.05, -0.08, 0.04], [0.06, -0.09, -0.04]], [0.016, 0.012, 0.004], 8, 6).color(mane).pbr(0.85).lod(1)]));
  // ---- ears ----
  const ear = (sd) => spike(0.085, 0.034, 0, 6, 0.42).shade((x, y) => (x < -0.1 && y < 0.8 ? 0x5a3a3a : y > 0.85 ? mane : null)).rot(0, 90, 0).rot(-22, 0, sd * 24).rot(0, sd * -16, 0).at(sd * 0.048, 0.08, 0.075).color(mix(back, grey, 0.3)).pbr(0.8);
  hard.head.push(ear(1), ear(-1));
  // ---- the mane: a shaggy ridge from the crown down the neck, strands standing out of it ----
  const maneLen = 0.75;
  for (const [n, z0, z1] of K.segs) {
    const a = Math.min(z0, 0.12), b = Math.max(z1, -maneLen);
    if (a - b < 0.02) continue;
    const m = Math.max(1, Math.round((a - b) / 0.05));
    for (let i = 0; i < m; i++) {
      const z = lerp(a, b, (i + 0.5) / m), q = at(z), k = 1 - smooth((-z - 0.1) / (maneLen - 0.1)) * 0.75;
      prims[n].push(fur(S.ellipsoid(q.w * 0.75, 0.035 * k + 0.01, 0.05).at(0, q.y + q.h * 0.92, z).blend(0.025)));
      for (const sd of [-1, 1]) for (let j = 0; j < 3; j++) {
        const ii = (Math.round(z * 1000) + 500) * 3 + j + (sd > 0 ? 7 : 0), th = sd * (10 + j * 26 + rnd(ii, 3) * 12) * DEG;
        const p0 = [Math.sin(th) * q.w * 0.95, q.y + Math.cos(th) * q.h * 0.95, z];
        hard[n].push(aim(spike((0.05 + rnd(ii, 4) * 0.04) * (0.5 + 0.5 * k), 0.011, 0, 5, 0.6), p0, [Math.sin(th) * 0.8, Math.cos(th) * 0.6, -1]).shade((x, y) => (y > 0.6 ? maneTip : null)).color(mane).pbr(0.85).lod(1));
      }
    }
  }
  // ---- fins: a dark crest running from the mane to the tail tip, and an anal fin ----
  const finH = (z) => 0.05 * smooth((-0.7 - z) / 0.3) * (z < -2.35 ? lerp(1, 0.6, (-2.35 - z) / 0.35) : 1);
  strip(K, -0.7, -2.68, (z) => at(z).h - 0.02, (z) => at(z).h + finH(z), mix(back, grey, 0.2), mane);
  strip(K, -1.2, -2.68, (z) => -at(z).h + 0.02, (z) => -at(z).h - 0.04 * smooth((-1.2 - z) / 0.3), mix(belly, grey, 0.6), back);
  const lay = layChain((p, o) => pathAt(wolfPath(0, 0), p, o), WOLF.Ls, WOLF.lay);
  const nodes = serpentNodes(K, lay, { detail: { default: 0.58, head: 0.95, body: 0.7 } }, WOLF.T);
  nodes.push(JW.node(jawHard, 10, 0.95));
  return { kind: 'wolfEel', nodes };
}
function animWolfEel(model, ctx) {
  const rig = model?.userData?.rig; if (!rig) return;
  const t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  // a quick swimmer: it lunges and worries what it bites, shaking its head
  const c = frac(t * 0.3 + phase * 0.27), lunge = pulse(c, 0.0, 0.25), worry = pulse(c, 0.18, 0.5);
  wolfPath(t, phase, lunge);
  laySerpent(rig, WOLF.T, WOLF.lay, WOLF.Ls, -lunge * 0.25 + Math.sin(t * 1.5 + phase) * 0.04, Math.sin(t * 17 + phase) * 0.14 * worry + Math.sin(t * 0.9 + phase) * 0.08, Math.sin(t * 17 + phase + 1) * 0.12 * worry);
  R(rig.jaw, 0.08 + lunge * 0.6 - worry * 0.08 + Math.max(0, Math.sin(t * 2.3 + phase)) * 0.06);
}

export const creatures = {
  nyamiNyami: (def) => rigged(def, nyamiDesc),
  vasukiLeviathan: (def) => rigged(def, vasukiDesc),
  mirageLeviathan: (def) => riggedWith(def, mirageDesc, finishMirage),
  wolfEel: (def) => rigged(def, wolfEelDesc),
};
export const animators = {
  nyamiNyami: animNyami,
  vasukiLeviathan: animVasuki,
  mirageLeviathan: animMirage,
  wolfEel: animWolfEel,
};
