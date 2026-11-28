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
import { S, H, noise3, cells3, distanceField, sculptMaterial } from '../sculpt.js';
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
/** lay the chain along T and turn the head to look along it, then by (hx, hy, hz) radians */
function laySerpent(rig, T, lay, Ls, hx = 0, hy = 0, hz = 0) {
  layChain((p, o) => pathAt(T, p, o), Ls, lay);
  const segs = [rig.body, ...(rig.tail || [])];
  if (segs.every(Boolean)) poseChain(segs, lay);
  if (rig.head) headQuat(rig.head.quaternion, T, lay, hx, hy, hz);
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
  const nodes = serpentNodes(K, lay, { detail: { default: 0.52, head: 0.9 }, minRes: { [last]: 30 } }, NYAMI.T);
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
    [1.0, 0.015]);
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
  for (let r = 0; r <= 26; r++) {
    const u = 0.02 + (r / 26) * 0.96, z = -u * HL, w = hw(u), ring = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * PI * 2, x = w * Math.cos(a), s = Math.sin(a), th = 0.01 + 0.045 * Math.max(0, 1 - (x / 0.085) ** 2);
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
  const nodes = serpentNodes(K, lay, { detail: { default: 0.43, head: 0.9, body: 0.62 } }, VASU.T, -6);
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
let _mirageMat = null, _beamMat = null;
function mirageMat(beam) {
  if (!_mirageMat) {
    _mirageMat = sculptMaterial().clone();
    Object.assign(_mirageMat, { transparent: true, opacity: 0.5, depthWrite: false, side: THREE.FrontSide });
    _beamMat = sculptMaterial().clone();
    Object.assign(_beamMat, { transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  }
  return beam ? _beamMat : _mirageMat;
}
function mirageDesc(def) {
  const base = num(def.color, 0xb8d8f0), pale = mix(base, 0xffffff, 0.3), cyan = mix(base, 0x30b8e8, 0.55), violet = mix(base, 0x7a50d8, 0.6), goldL = 0xf0c870, deep = mix(base, 0x2a48b0, 0.6);
  const brass = 0xb8862e, brassDk = 0x6a4a18, verd = 0x4a8a6a, G = 0.45;
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
  for (let z = -0.3; z > -3.1; z -= 0.22) prims[K.nodeOf(z)].push(S.box(0.7, 0.7, 0.03, 0.01).at(0, 0, z).color(goldL).glow(0.6).paint(0.012, 0));
  K.stripe(0.3, -3.2, 0, (z) => at(z).h * 0.25, (p) => p.color(mix(pale, 0xffffff, 0.2)).glow(0.5).paint(0.02, 0), 0.14);
  eyes(K, 'head', surfer(headHull), 0.24, 0.035, 0.018, { iris: 0xd0c090, rim: 0x806030, white: 0xc0b080, shape: 'none', irisDeg: 60, rough: 0.1, glow: 1.2 }, { socket: 0x6080c0 });
  const JW = addJaw(K, 'head', { tip: MIRA.tip, hinge: 0.1, yT: -0.014, yH: -0.028, mouth: 0x8a90d8, sk, palate: 0.02, back: 0.04, jawTip: MIRA.tip - 0.02 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  teeth(hard.head, sfH, { z0: 0.16, z1: 0.4, n: 7, mY: JW.mY, up: 1, r: 0.005, len: 0.024, col: 0xffffff, hook: 0.2, rake: 6, inset: 0.4 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: 0.18, z1: 0.39, n: 6, mY: JW.mY, up: -1, r: 0.005, len: 0.022, col: 0xffffff, hook: 0.2, rake: -6, inset: 0.4 });
  for (const h of [...hard.head, ...jawHard]) h.color(0x8090a0).glow(0.5);
  // horns and frills of light
  const fr = (sd) => place(fan([{ a: -20, len: 0.12 }, { a: 10, len: 0.2 }, { a: 40, len: 0.24 }, { a: 70, len: 0.24 }, { a: 100, len: 0.19 }, { a: 130, len: 0.12 }], cyan, goldL, 0xffffff, { dip: 0.25, cup: -0.05 * sd, spineR: 0.005 }), 0, sd * -38, sd * -14, sd * 0.07, 0.01, 0.05);
  hard.head.push(...fr(1), ...fr(-1), ...H.mirrorX([horn([[0.04, 0.06, 0.18], [0.06, 0.1, 0.1], [0.075, 0.16, 0.02], [0.07, 0.22, -0.04]], 0.014, 0.004, goldL, 0xffffff)]));
  // a sail of light down the back, and a leaf of a tail
  const finH = (z) => 0.09 * smooth((-0.1 - z) / 0.3) * (1 - smooth((z + 2.9) / -0.3)) * (1 + 0.15 * Math.sin(z * 22));
  strip(K, -0.1, -3.05, (z) => at(z).h - 0.02, (z) => at(z).h + finH(z), deep, goldL, { rays: 120, amp: 0.008 });
  const last = `tail${MIRA.n - 2}`;
  hard[last].push(...place(fan([{ a: 30, len: 0.12 }, { a: 55, len: 0.22 }, { a: 80, len: 0.28 }, { a: 100, len: 0.28 }, { a: 125, len: 0.22 }, { a: 150, len: 0.12 }], violet, goldL, 0xffffff, { dip: 0.2 }), 0, 0, 0, 0, 0, -MIRA.len + 0.12));
  // motes of glimmer drifting about the body
  const mote = (r, x, y, z, i) => H.geo(octaGeo()).scale(r, r * 1.6, r).rot(0, i * 37, 0).at(x, y, z).color(i % 3 ? 0xc0c8d0 : i % 2 ? 0xd0b060 : 0x60b0e0).glow(1.5).lod(1);
  for (const [n, z0, z1] of K.segs) {
    const k = n === 'head' ? 6 : 5;
    for (let j = 0; j < k; j++) {
      const i = (z0 * 100 | 0) * 7 + j, z = lerp(z0, z1, rnd(i, 1)), q = at(z), a = rnd(i, 2) * PI * 2, d = 1.25 + rnd(i, 3) * 1.4;
      hard[n].push(mote(0.007 + rnd(i, 4) * 0.008, Math.cos(a) * q.w * d, Math.sin(a) * q.h * d, z, i));
    }
  }
  for (const h of Object.values(hard).flat()) if (h.glowV < 0.3) h.glow(0.35);
  const lay = layChain((p, o) => pathAt(miragePath(0, 0), p, o), MIRA.Ls, MIRA.lay);
  const nodes = serpentNodes(K, lay, { detail: { default: 0.55, head: 0.95 } }, MIRA.T);
  nodes.push(JW.node(jawHard, 10, 0.95));
  // ---- the give-away: a brass buoy where the neck meets the water, a lens in its crown throwing the light ----
  const nb = pathAt(MIRA.T, 1.1, [0, 0, 0]), BZ = nb[2] + 0.34, by = 0.0;
  const buoy = [
    H.lathe([[0.0, -0.09], [0.05, -0.085], [0.08, -0.05], [0.088, 0.0], [0.08, 0.03], [0.05, 0.05], [0.036, 0.055], [0.036, 0.1], [0.044, 0.105], [0.044, 0.118], [0.0, 0.12]], 18)
      .shade((x, y) => (y < -0.02 ? mix(verd, brassDk, 0.4) : Math.abs(y - 0.0) < 0.006 || Math.abs(y - 0.104) < 0.004 ? brassDk : brass)).pbr(0.3, 0.85),
    H.sphere(0.03, 14).at(0, 0.13, 0).color(0xfff2c0).pbr(0.05, 0).glow(1.6),
    ...[0, 1, 2, 3].map((k) => H.box(0.006, 0.05, 0.006, 0.001).rot(0, k * 90 + 45, 0).at(Math.cos(k * PI / 2 + PI / 4) * 0.032, 0.14, Math.sin(k * PI / 2 + PI / 4) * 0.032).color(brass).pbr(0.3, 0.85)),
    H.cone(0.04, 0.03, 10).rot(180, 0, 0).at(0, 0.185, 0).color(brassDk).pbr(0.35, 0.8),
    ...Array.from({ length: 10 }, (_, k) => H.sphere(0.006, 6).at(Math.cos(k * 0.628) * 0.087, 0.0, Math.sin(k * 0.628) * 0.087).color(brassDk).pbr(0.3, 0.9).lod(1)),
  ];
  const lens0 = [0, 0.13, BZ], head0 = pathAt(MIRA.T, 0.15, [0, 0, 0]), dir = sub(head0, lens0);
  const beam = [aim(H.cyl(0.16, 0.012, 1, 16, true).at(0, 0.5, 0).scale(1, Math.hypot(dir[0], dir[1], dir[2]) * 0.92, 1), lens0, dir).color(0xd8c088).pbr(1, 0).glow(0.7)];
  nodes.push({ name: 'buoy', parent: 'root', rig: 'buoy', pos: [0, by, BZ], hard: buoy, detail: 1 });
  nodes.push({ name: 'beam', parent: 'root', rig: 'beam', pos: [0, 0, 0], hard: beam });
  return { kind: 'mirageLeviathan', nodes };
}
function finishMirage(tpl) {
  // everything but the buoy is light: drawn additively, half seen through, casting no shadow
  tpl.traverse((o) => {
    if (!o.isMesh) return;
    let p = o.parent, isBuoy = false, isBeam = false;
    while (p) { if (p.name.startsWith('rig:buoy')) isBuoy = true; if (p.name.startsWith('rig:beam')) isBeam = true; p = p.parent; }
    if (!isBuoy) { o.material = mirageMat(isBeam); o.castShadow = false; o.renderOrder = 2; }
  });
}
function animMirage(model, ctx) {
  const rig = model?.userData?.rig; if (!rig) return;
  const t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const c = frac(t * 0.17 + phase * 0.23), rear = pulse(c, 0.0, 0.35), lunge = pulse(c, 0.25, 0.45);
  miragePath(t, phase, rear - lunge);
  // now and then the picture slips, as a projection does when the buoy rolls
  const g = frac(t * 0.37 + phase * 0.31), slip = g > 0.9 ? Math.sin(g * 120) * 0.04 : 0;
  laySerpent(rig, MIRA.T, MIRA.lay, MIRA.Ls, -rear * 0.3 + lunge * 0.35 + Math.sin(t * 1.1 + phase) * 0.05, Math.sin(t * 0.75 + phase) * 0.12, slip * 3);
  if (rig.body) rig.body.position.x += slip;
  R(rig.jaw, 0.06 + rear * 0.6 - lunge * 0.5 + Math.max(0, Math.sin(t * 1.5 + phase)) * 0.06);
  const b = rig.buoy?.[0];
  if (b) { P(b, 0, Math.sin(t * 1.7 + phase) * 0.012, 0); R(b, Math.sin(t * 1.3 + phase) * 0.12, t * 0.6, Math.sin(t * 1.1 + phase + 1) * 0.1); }
  const m = _mirageMat;
  if (m) m.opacity = 0.5 + Math.sin(t * 2.7) * 0.07 + (frac(t * 0.37) > 0.9 ? -0.18 : 0);
  if (_beamMat) _beamMat.opacity = 0.14 + Math.sin(t * 5.3) * 0.04;
}

// =====================================================================================
// WOLF-EEL OF THE BLACK GULF: the Khanates' hounds of the sea. A long grey eel with a wolf's head: a lupine snout,
// pricked ears, a shaggy black mane down the neck; they hunt in packs
// =====================================================================================
const WOLF = { len: 2.7, tip: 0.38, n: 12 };
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
    { z: 0.38, w: 0.024, h: 0.024, y: -0.008 }, { z: 0.355, w: 0.036, h: 0.034, y: -0.005 }, { z: 0.27, w: 0.048, h: 0.046, y: -0.001 }, { z: 0.2, w: 0.06, h: 0.056, y: 0.005 },
    { z: 0.15, w: 0.08, h: 0.074, y: 0.018 }, { z: 0.07, w: 0.094, h: 0.084, y: 0.016 }, { z: 0.0, w: 0.084, h: 0.086, y: 0 }, { z: -0.25, w: 0.078, h: 0.096, y: 0 },
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
    sk(S.capsule([0, 0.035, 0.33], [0, 0.07, 0.17], 0.015, 0.025).blend(0.03), 'top'),
    S.ellipsoid(0.025, 0.018, 0.02).at(0, 0.018, 0.378).color(nose).pbr(0.2).blend(0.015),
  );
  const headHull = prims.head.slice();
  prims.head.push(...S.mirrorX([S.sphere(0.0065).at(0.01, 0.016, 0.394).color(0x000000).paint(0.003, -0.004)]));
  K.stripe(0.32, -2.6, 0, (z) => at(z).h * 0.45, (p) => p.color(back).pbr(wet).paint(0.02, 0), 0.13);
  K.belly((z) => at(z).y - at(z).h * 0.5, belly, 0.02, wet);
  K.dapple({ n: 120, z0: -0.1, z1: -2.5, th0: 25, th1: 110, r0: 0.01, r1: 0.024, seed: 91, wref: 0.09, make: (p) => p.color(spot).pbr(wet).paint(0.006, 0) });
  // a pale muzzle and a dark mask about the eyes
  prims.head.push(S.ellipsoid(0.055, 0.032, 0.11).at(0, -0.03, 0.29).color(mix(grey, belly, 0.6)).pbr(wet).paint(0.02, 0));
  prims.head.push(...S.mirrorX([S.ellipsoid(0.03, 0.02, 0.04).at(0.042, 0.047, 0.19).color(mane).pbr(0.6).paint(0.012, 0)]));
  eyes(K, 'head', surfer(headHull), 0.19, 0.05, 0.015, { iris: 0xf0b020, rim: 0x6a3a08, white: 0xe8b030, pupilDeg: 16, irisDeg: 56, rough: 0.06, glow: 0.7 }, { socket: 0x0a0a0a, yaw: 58, pitch: -6 });
  // ---- jaws and a wolf's teeth: canines, carnassials ----
  const JW = addJaw(K, 'head', { tip: WOLF.tip, hinge: 0.09, yT: -0.014, yH: -0.03, mouth, sk, palate: 0.02, tongue: 0.01, back: 0.04, belly, bellyLine: (z) => at(z).y - at(z).h * 0.3, wet, jawTip: WOLF.tip - 0.014 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  teeth(hard.head, sfH, { z0: 0.14, z1: 0.36, n: 7, mY: JW.mY, up: 1, r: 0.005, len: (i) => (i === 5 ? 0.04 : 0.016), col: tooth, hook: 0.25, rake: 6, splay: 8, inset: 0.5 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: 0.15, z1: 0.355, n: 6, mY: JW.mY, up: -1, r: 0.005, len: (i) => (i === 4 ? 0.036 : 0.015), col: tooth, hook: 0.25, rake: -6, splay: 8, inset: 0.5 });
  jawHard.push(...H.mirrorX([H.tube([[0.02, -0.06, 0.12], [0.05, -0.08, 0.04], [0.06, -0.09, -0.04]], [0.016, 0.012, 0.004], 8, 6).color(mane).pbr(0.85).lod(1)]));
  // ---- ears ----
  const ear = (sd) => spike(0.12, 0.05, 0, 6, 0.4).shade((x, y) => (x < -0.1 && y < 0.8 ? 0x5a3a3a : y > 0.85 ? mane : null)).rot(0, 90, 0).rot(-14, 0, sd * 18).rot(0, sd * -12, 0).at(sd * 0.05, 0.078, 0.07).color(mix(back, grey, 0.3)).pbr(0.8);
  hard.head.push(ear(1), ear(-1));
  // ---- the mane: a shaggy ridge from the crown down the neck, strands standing out of it ----
  const maneLen = 0.75;
  for (const [n, z0, z1] of K.segs) {
    const a = Math.min(z0, 0.12), b = Math.max(z1, -maneLen);
    if (a - b < 0.02) continue;
    const m = Math.max(1, Math.round((a - b) / 0.05));
    for (let i = 0; i < m; i++) {
      const z = lerp(a, b, (i + 0.5) / m), q = at(z), k = 1 - smooth((-z - 0.1) / (maneLen - 0.1)) * 0.75;
      prims[n].push(fur(S.ellipsoid(q.w * 0.85, 0.05 * k + 0.012, 0.055).at(0, q.y + q.h * 0.9, z).blend(0.025)));
      for (const sd of [-1, 1]) for (let j = 0; j < 4; j++) {
        const ii = (Math.round(z * 1000) + 500) * 4 + j + (sd > 0 ? 7 : 0), th = sd * (4 + j * 20 + rnd(ii, 3) * 10) * DEG;
        const p0 = [Math.sin(th) * q.w * 0.9, q.y + Math.cos(th) * q.h * 0.9, z + (rnd(ii, 5) - 0.5) * 0.03];
        hard[n].push(aim(spike((0.08 + rnd(ii, 4) * 0.06) * (0.45 + 0.55 * k), 0.02, 0, 5, 0.3), p0, [Math.sin(th) * 0.7, 0.3 + Math.cos(th) * 0.35, -1], 90).shade((x, y) => (y > 0.55 ? maneTip : null)).color(mane).pbr(0.85).lod(1));
      }
    }
  }
  // ---- fins: a dark crest running from the mane to the tail tip, and an anal fin ----
  const finH = (z) => 0.05 * smooth((-0.7 - z) / 0.3) * (1 - smooth((-2.3 - z) / 0.3));
  strip(K, -0.7, -2.6, (z) => at(z).h - 0.02, (z) => at(z).h + finH(z), mix(back, grey, 0.2), mane);
  strip(K, -1.2, -2.6, (z) => -at(z).h + 0.02, (z) => -at(z).h - 0.04 * smooth((-1.2 - z) / 0.3) * (1 - smooth((-2.3 - z) / 0.3)), mix(belly, grey, 0.6), back);
  const lay = layChain((p, o) => pathAt(wolfPath(0, 0), p, o), WOLF.Ls, WOLF.lay);
  const nodes = serpentNodes(K, lay, { detail: { default: 0.55, head: 0.88, body: 0.66 } }, WOLF.T);
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

// =====================================================================================
// CETUS-PRIMEVAL: the Pearl-Fleets' great whale-dragon. A whale's bulk under rows of ivory plate rimmed in gold,
// set with pearls and turquoise, a gentle horned head, and fins that trail long ribbons through the water
// =====================================================================================
function cetusDesc(def) {
  const ivory = num(def.color, 0xe8e0d0), ivoryDk = mix(ivory, 0x8a7a5a, 0.35), hide = mix(ivory, 0x7a90a0, 0.45), hideDk = mix(hide, 0x2a3a4a, 0.4), belly = 0xf4eee2;
  const gold = 0xd8a840, turq = 0x2ab8b0, turqDk = 0x147a78, pearl = 0xfaf6ee, mouth = 0x9a4a5a, wet = 0.32;
  const CY = -0.05;
  const TAB = [
    { z: 1.22, w: 0.05, h: 0.045, y: CY - 0.02 }, { z: 1.15, w: 0.11, h: 0.09, y: CY - 0.015 }, { z: 1.0, w: 0.18, h: 0.15, y: CY - 0.005 }, { z: 0.82, w: 0.23, h: 0.2, y: CY },
    { z: 0.6, w: 0.28, h: 0.25, y: CY }, { z: 0.3, w: 0.31, h: 0.28, y: CY }, { z: 0.0, w: 0.3, h: 0.27, y: CY }, { z: -0.3, w: 0.24, h: 0.22, y: CY + 0.01 },
    { z: -0.55, w: 0.16, h: 0.15, y: CY + 0.02 }, { z: -0.78, w: 0.1, h: 0.1, y: CY + 0.03 }, { z: -0.96, w: 0.065, h: 0.06, y: CY + 0.035 }, { z: -1.08, w: 0.045, h: 0.04, y: CY + 0.035 },
  ];
  const sk = (p, part) => p.color(part === 'top' ? mix(hide, hideDk, 0.4) : part === 'bottom' ? belly : hide).pbr(wet).bump(0.003, 26).tint(0.1, 9);
  const HZ = 0.72;
  const K = carcass(TAB, [['head', 1.22, HZ], ['body', HZ, -0.3], ['tail0', -0.3, -0.58], ['tail1', -0.58, -0.82], ['tail2', -0.82, -1.08]], 'body', sk, { pivot: 0.2, core: hide });
  const { at, skin, prims, hard } = K;
  // ---- the head: a broad brow over a whale's mouth, a crest down the snout ----
  prims.head.push(
    ...S.mirrorX([sk(S.ellipsoid(0.08, 0.06, 0.12).at(0.1, CY + 0.13, 0.86).blend(0.06), 'top'), sk(S.ellipsoid(0.06, 0.06, 0.1).at(0.15, CY - 0.04, 0.8).blend(0.05), 'core')]),
    sk(S.capsule([0, CY + 0.1, 1.12], [0, CY + 0.2, 0.84], 0.03, 0.05).blend(0.05), 'top'),
  );
  const headHull = prims.head.slice();
  // ---- ivory plate: rows of embossed shields rimmed in gold; pearls down the spine, turquoise on the flanks ----
  const plate = (z, th, rw, rz, inlay) => {
    const q = skin(z, th, 0.0), n = K.nodeOf(z);
    prims[n].push(S.box(rw * 2.25, 0.2, rz * 2.25, Math.min(rw, rz) * 0.5).rot(0, 0, -th).at(q.p[0], q.p[1], q.p[2]).color(gold).pbr(0.3, 0.55).paint(0.006, 0.006));
    prims[n].push(S.box(rw * 2, 0.2, rz * 2, Math.min(rw, rz) * 0.5).rot(0, 0, -th).at(q.p[0], q.p[1], q.p[2]).color(mix(ivory, ivoryDk, rnd(Math.round(z * 100), th) * 0.3)).pbr(0.38).bump(0.002, 30).paint(0.006, 0.012));
    if (inlay === 'pearl') hard[n].push(H.sphere(Math.min(rw, rz) * 0.42, 12).at(q.p[0] + q.n[0] * 0.012, q.p[1] + q.n[1] * 0.012, q.p[2]).color(pearl).pbr(0.08, 0.15).lod(1));
    else if (inlay) prims[n].push(S.ellipsoid(rw * 0.55, 0.2, rz * 0.5).rot(0, 0, -th).at(q.p[0], q.p[1], q.p[2]).color(turq).pbr(0.2, 0.3).glow(0.08).paint(0.004, 0.014));
  };
  for (let z = 1.06; z > -0.95; z -= 0.15) {
    const w = at(z).w, k = clamp(w / 0.3, 0.3, 1);
    plate(z, 0, 0.07 * k, 0.06, z < 0.95 && z > -0.8 ? 'pearl' : null);
    if (z < 0.98) for (const sd of [-1, 1]) {
      plate(z - 0.04, sd * 36, 0.065 * k, 0.055, 'turq');
      if (z < 0.85 && z > -0.6) plate(z, sd * 68, 0.06 * k, 0.05, null);
    }
  }
  // turquoise inlay lines along the flank, belly grooves below
  K.stripe(0.95, -1.0, 92, (z) => at(z).h * 0.035, (p) => p.color(turq).pbr(0.2, 0.3).paint(0.006, 0.004), 0.12);
  K.stripe(0.95, -1.0, 100, (z) => at(z).h * 0.02, (p) => p.color(gold).pbr(0.3, 0.5).paint(0.004, 0.003), 0.12);
  K.belly((z) => at(z).y - at(z).h * 0.45, belly, 0.02, wet);
  for (const th of [150, 162, 174]) K.stripe(1.05, 0.0, th, 0.008, (p) => p.color(mix(belly, 0xb89a8a, 0.5)).pbr(wet).paint(0.004, -0.004), 0.12);
  // gentle eyes under a heavy lid, a pearl on the brow
  eyes(K, 'head', surfer(headHull), 0.9, CY + 0.07, 0.035, { iris: 0x5a3418, rim: 0xc89a40, white: 0xf2ead8, pupilDeg: 20, irisDeg: 52, rough: 0.05, glow: 0.1 }, { socket: 0x2a2018, ring: gold, yaw: 76 });
  prims.head.push(...S.mirrorX([sk(S.capsule([0.1, CY + 0.12, 0.96], [0.15, CY + 0.12, 0.84], 0.014, 0.018).blend(0.02), 'top')]));
  hard.head.push(H.sphere(0.03, 14).at(0, CY + 0.215, 0.95).color(pearl).pbr(0.06, 0.2), H.torus(0.032, 0.007, 16, 6).rot(80, 0, 0).at(0, CY + 0.21, 0.95).color(gold).pbr(0.3, 0.7));
  // horns: two long backswept ivory horns and a shorter pair, tipped in gold
  hard.head.push(...H.mirrorX([
    horn([[0.1, CY + 0.17, 0.88], [0.14, CY + 0.24, 0.8], [0.18, CY + 0.3, 0.68], [0.2, CY + 0.32, 0.54], [0.2, CY + 0.3, 0.42]], 0.032, 0.008, ivory, gold, 8),
    horn([[0.16, CY + 0.1, 0.84], [0.22, CY + 0.13, 0.78], [0.27, CY + 0.15, 0.7], [0.29, CY + 0.14, 0.62]], 0.02, 0.005, ivory, gold, 6),
  ]));
  // ---- the mouth: a whale's long gape, a fringe of pale baleen ----
  const JW = addJaw(K, 'head', { tip: 1.22, hinge: 0.78, yT: CY - 0.03, yH: CY - 0.06, mouth, sk, palate: 0.05, tongue: 0.025, back: 0.05, belly, bellyLine: (z) => at(z).y - at(z).h * 0.45, wet, jawTip: 1.2 });
  for (let i = 0; i < 9; i++) { const z = 0.84 + i * 0.038; hard.head.push(...H.mirrorX([H.box(0.006, 0.05, 0.03, 0.002).at(at(z).w * 0.8, JW.mY(z) + 0.02, z).color(0xe8dcc0).pbr(0.4).lod(1)])); }
  const jawHard = [];
  // ---- fins: long pectoral flippers and a broad fluke, each trailing ribbons ----
  const rib = (pts, w0, i) => streamer(pts, w0, 0.008, [1, 0, 0], i % 2 ? turq : gold, i % 2 ? 0xd8f4f0 : ivory, 0.5, 14).pbr(0.35, 0.2);
  const flipper = (sd) => {
    const sp = 0.56, out = [fin({ span: sp, chord: 0.2, peak: 0.3, root: 0.7, tip: 0.25, pw: 1.1, sweep: 0.55, curve: 1.4, thick: 0.12, rows: 10 }).shade((x, y, z) => mix(x * sd > 0 ? belly : mix(ivory, hide, 0.3), turqDk, Math.sin(y * 60) > 0.85 ? 0.5 : clamp(y / sp, 0, 1) ** 2 * 0.3)).pbr(0.34)];
    for (let i = 0; i < 3; i++) { const y = sp * (0.35 + i * 0.25), te = -0.06 - y * 0.55 * Math.pow(y / sp, 1.4) - 0.04; out.push(rib([[0, y, te + 0.02], [0, y + 0.03, te - 0.15], [0.02 * sd, y + 0.02, te - 0.35], [0, y - 0.02, te - 0.55], [0, y - 0.05, te - 0.72]], 0.024, i)); }
    return out;
  };
  const fluke = (sd) => {
    const out = [fin({ span: 0.36, chord: 0.2, peak: 0.25, root: 0.7, tip: 0.3, pw: 1.0, sweep: 0.6, curve: 1.5, thick: 0.12, rows: 9 }).shade((x, y) => mix(mix(ivory, hide, 0.35), turqDk, clamp(y / 0.36, 0, 1) ** 2 * 0.4)).pbr(0.34)];
    out.push(rib([[0, 0.33, -0.24], [0, 0.37, -0.36], [0, 0.38, -0.5], [0, 0.35, -0.64]], 0.026, 0), rib([[0, 0.22, -0.2], [0, 0.25, -0.33], [0, 0.25, -0.48], [0, 0.22, -0.6]], 0.022, 1));
    return place(out, 0, 0, sd * -90, 0, at(-1.02).y, -1.0);
  };
  hard.tail2.push(...fluke(1), ...fluke(-1));
  prims.tail2.push(sk(S.ellipsoid(0.09, 0.03, 0.06).at(0, at(-1.02).y, -1.04).blend(0.03), 'core'));
  // a crest of ornate fins down the spine: turquoise webs on ivory spines
  for (const [n, z] of [['body', 0.42], ['body', 0.18], ['body', -0.06], ['tail0', -0.36], ['tail1', -0.62]]) {
    const q = at(z), k = clamp(q.h / 0.27, 0.45, 1);
    hard[n].push(...place(fan([{ a: -30, len: 0.07 * k }, { a: 10, len: 0.12 * k }, { a: 45, len: 0.13 * k }, { a: 80, len: 0.1 * k }, { a: 110, len: 0.06 * k }], turqDk, turq, ivory, { dip: 0.3, spineR: 0.006, tipCol: gold }), 0, 0, 0, 0, q.y + q.h + 0.03, z));
  }
  const nodes = K.nodes({ detail: { default: 0.36, head: 0.55, body: 0.36 } });
  nodes.push(JW.node(jawHard, 6, 0.55));
  const fz = 0.5, fx = at(fz).w - 0.04;
  nodes.push(finNode(K, 'finL', 'body', [fx, CY - 0.16, fz], [-14, -18, -112], flipper(1)), finNode(K, 'finR', 'body', [-fx, CY - 0.16, fz], [-14, 18, 112], flipper(-1)));
  return { kind: 'cetusPrimeval', nodes };
}
function animCetus(model, ctx) {
  const rig = model?.userData?.rig; if (!rig) return;
  const t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 1.3 + phase;
  // a slow whale's stroke; now and then it heaves its head up and booms (the wave), or runs in to ram
  const c = frac(t * 0.1 + phase * 0.17), boom = pulse(c, 0.0, 0.3), ram = pulse(c, 0.5, 0.72);
  R(rig.body, -boom * 0.12 + ram * 0.05 + Math.sin(w) * 0.025, Math.sin(w * 0.5) * 0.02, Math.sin(w * 0.5 + 1) * 0.03);
  P(rig.body, 0, Math.sin(w + 0.4) * 0.02 + boom * 0.06, ram * 0.12);
  R(rig.head, -boom * 0.12 + Math.sin(w + 0.6) * 0.02, Math.sin(t * 0.4 + phase) * 0.04, 0);
  R(rig.jaw, 0.03 + boom * 0.42 + Math.max(0, Math.sin(t * 0.7 + phase)) * 0.04);
  (rig.tail || []).forEach((n, i) => R(n, Math.sin(w - 0.8 - i * 0.75) * (0.08 + i * 0.07) * (1 + ram * 0.6), 0, 0));
  (rig.fins || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, Math.sin(w + 0.5) * 0.18, 0, sg * (Math.sin(w) * 0.22 + boom * 0.2)); });
}

// =====================================================================================
// BAHAMUT: the radiant fish of the Golden Sands, that the world is said to rest upon. An immense silver fish whose
// scales give off light, a whiskered head, and long fins trailing behind like banners
// =====================================================================================
function bahamutDesc(def) {
  const silver = mix(num(def.color, 0xd8e0e8), 0xffffff, 0.35), steel = mix(silver, 0x6a8ab8, 0.35), backC = mix(silver, 0x3a5a9a, 0.5), pearlW = 0xf8f6f0, gold = 0xe8c060, goldDk = 0x9a6a20, mouth = 0x8a3040, wet = 0.2, MET = 0.7;
  const CY = -0.06;
  const TAB = [
    { z: 1.2, w: 0.045, h: 0.055, y: CY + 0.01 }, { z: 1.13, w: 0.095, h: 0.115, y: CY + 0.005 }, { z: 1.0, w: 0.15, h: 0.19, y: CY }, { z: 0.8, w: 0.2, h: 0.27, y: CY },
    { z: 0.5, w: 0.235, h: 0.32, y: CY }, { z: 0.15, w: 0.24, h: 0.33, y: CY }, { z: -0.2, w: 0.205, h: 0.28, y: CY + 0.005 }, { z: -0.5, w: 0.145, h: 0.2, y: CY + 0.015 },
    { z: -0.75, w: 0.088, h: 0.12, y: CY + 0.025 }, { z: -0.93, w: 0.05, h: 0.068, y: CY + 0.03 }, { z: -1.04, w: 0.035, h: 0.048, y: CY + 0.03 },
  ];
  const sk = (p, part) => (part === 'top' ? p.color(backC).pbr(wet, 0.5) : p.color(part === 'bottom' ? pearlW : silver).pbr(wet, MET)).bump(0.009, 15, 'scales').tint(0.08, 10).glow(0.22);
  const smoothSk = (p, part) => p.color(part === 'top' ? backC : part === 'bottom' ? pearlW : mix(silver, steel, 0.25)).pbr(wet, 0.6).bump(0.003, 24).glow(0.1);
  const GZ = 0.78;
  const K = carcass(TAB, [['body', 1.2, -0.2], ['tail0', -0.2, -0.48], ['tail1', -0.48, -0.72], ['tail2', -0.72, -0.9], ['tail3', -0.9, -1.04]], 'body', sk, { pivot: 0.3, core: silver });
  const { at, skin, prims, hard } = K;
  prims.body.length = 0;
  prims.body.push(...hull(span(TAB, 1.2, GZ - 0.03), smoothSk, 0.016), ...hull(span(TAB, GZ - 0.03, -0.2), sk, 0.016));
  const headHull = hull(span(TAB, 1.2, 0.5), smoothSk);
  // a carp's gill plate in gold-rimmed silver, a blue back, a gold lateral line; the scales flash with light
  prims.body.push(...S.mirrorX([smoothSk(S.ellipsoid(0.05, 0.2, 0.12).at(at(0.86).w - 0.03, CY - 0.02, 0.87).blend(0.03), 'core')]));
  for (const sd of [-1, 1]) for (let i = 0; i < 7; i++) { const a = skin(GZ - Math.sin((i / 7) * PI) * 0.035, sd * (40 + i * 18)), b = skin(GZ - Math.sin(((i + 1) / 7) * PI) * 0.035, sd * (40 + (i + 1) * 18)); prims.body.push(S.capsule(a.p, b.p, 0.012).color(gold).pbr(0.25, 0.8).glow(0.2).paint(0.005, 0.004)); }
  K.stripe(GZ - 0.05, -1.02, 0, (z) => at(z).h * 0.22, (p) => p.color(backC).pbr(wet, 0.5).glow(0.08).paint(0.03, 0), 0.12);
  K.stripe(GZ - 0.05, -1.02, 26, (z) => at(z).h * 0.1, (p) => p.color(steel).pbr(wet, 0.6).glow(0.1).paint(0.03, 0), 0.12);
  K.stripe(GZ - 0.06, -1.0, 72, (z) => at(z).h * 0.03, (p) => p.color(gold).pbr(0.25, 0.8).glow(0.35).paint(0.006, 0.003), 0.12);
  K.belly((z) => at(z).y - at(z).h * 0.62, pearlW, 0.03, wet, 0.4);
  // light breaks from the scales: a scatter of glowing scales over the flanks
  K.dapple({ n: 200, z0: GZ - 0.06, z1: -0.95, th0: 20, th1: 130, r0: 0.01, r1: 0.024, seed: 101, wref: 0.24, stretch: 1.4, make: (p, i) => p.color(i % 4 ? 0xffffff : gold).pbr(0.15, 0.6).glow(0.7).paint(0.006, 0.002) });
  eyes(K, 'body', surfer(headHull), 1.02, CY + 0.07, 0.034, { iris: 0xf0d060, rim: 0x6a4a10, white: 0xfff0b0, pupilDeg: 18, irisDeg: 50, rough: 0.05, glow: 0.8 }, { socket: 0x1a2030, ring: gold });
  // ---- mouth and whiskers ----
  const JW = addJaw(K, 'body', { tip: 1.2, hinge: 0.97, yT: CY - 0.01, yH: CY - 0.05, mouth, sk: smoothSk, palate: 0.04, back: 0.05, wk: 0.97, jawTip: 1.18 });
  const wcol = gold, wtip = 0xfff4d0;
  hard.body.push(...H.mirrorX([
    whisker([[0.05, CY - 0.01, 1.17], [0.1, CY - 0.03, 1.12], [0.18, CY - 0.09, 1.0], [0.24, CY - 0.17, 0.82], [0.26, CY - 0.22, 0.62], [0.26, CY - 0.25, 0.44]], 0.011, wcol, wtip, 18).glow(0.4),
    whisker([[0.035, CY + 0.02, 1.19], [0.08, CY + 0.02, 1.25], [0.16, CY - 0.01, 1.24], [0.24, CY - 0.05, 1.14], [0.3, CY - 0.08, 0.98], [0.33, CY - 0.1, 0.8]], 0.008, wcol, wtip, 18).glow(0.4),
  ]));
  const jawHard = [...H.mirrorX([whisker([[0.03, CY - 0.06, 1.12], [0.05, CY - 0.11, 1.08], [0.07, CY - 0.18, 1.0], [0.08, CY - 0.24, 0.9]], 0.007, wcol, wtip, 12).glow(0.4)])];
  // ---- long trailing fins of light ----
  const fcol = (sp) => (x, y, z) => mix(mix(steel, gold, clamp(y / sp, 0, 1) ** 1.2 * 0.8), 0xffffff, Math.sin(z * 120 + y * 40) > 0.8 ? 0.4 : 0);
  const finH = (z) => 0.13 * smooth((0.55 - z) / 0.25) * (1 - smooth((z + 0.85) / -0.15)) * (1 + 0.15 * Math.sin(z * 26));
  strip(K, 0.55, -1.0, (z) => at(z).y + at(z).h - 0.03, (z) => at(z).y + at(z).h + finH(z), steel, gold, { rays: 110, amp: 0.012, metal: 0.4 });
  strip(K, -0.3, -0.95, (z) => at(z).y - at(z).h + 0.03, (z) => at(z).y - at(z).h - 0.08 * smooth((-0.3 - z) / 0.2) * (1 - smooth((z + 0.85) / -0.12)), steel, gold, { rays: 110, metal: 0.4 });
  for (const h of Object.values(hard).flat()) if (h.glowV < 0.2) h.glow(0.25);
  const lobe = (ang, down) => [fin({ span: 0.62, chord: 0.18, tip: 0.12, sweep: 0.5, thick: 0.07, pw: 0.85, rows: 11, curve: 1.6 }).shade(fcol(0.62)).pbr(0.25, 0.4).glow(0.3),
    streamer([[0, 0.55, -0.3], [0, 0.6, -0.42], [0, 0.62, -0.58], [0, 0.6, -0.72]], 0.028, 0.006, [1, 0, 0], gold, 0xffffff, 0.4, 12).pbr(0.25, 0.3).glow(0.4)];
  hard.tail3.push(...place(lobe(-34, false), 0, 0, 0, 0, 0, 0).map((h) => h.rot(-34, 0, 0).at(0, at(-1.0).y, -0.98)), ...place(lobe(34, true), 0, 0, 180, 0, 0, 0).map((h) => h.rot(34, 0, 0).at(0, at(-1.0).y, -0.98)));
  prims.tail3.push(sk(S.capsule([0, at(-1.0).y + 0.07, -1.02], [0, at(-1.0).y - 0.07, -1.02], 0.032, 0.032).blend(0.03), 'core'));
  const pec = (sd) => [fin({ span: 0.6, chord: 0.12, tip: 0.1, sweep: 0.75, thick: 0.08, pw: 0.8, curve: 1.6, rows: 11 }).shade(fcol(0.6)).pbr(0.25, 0.4).glow(0.3),
    streamer([[0, 0.55, -0.44], [0, 0.6, -0.56], [0.02 * sd, 0.62, -0.72], [0, 0.6, -0.86]], 0.022, 0.005, [1, 0, 0], gold, 0xffffff, 0.45, 12).pbr(0.25, 0.3).glow(0.4)];
  const pelv = (sd) => [fin({ span: 0.42, chord: 0.08, tip: 0.1, sweep: 1.0, thick: 0.08, pw: 0.8, curve: 1.7, rows: 9 }).shade(fcol(0.42)).pbr(0.25, 0.4).glow(0.3)];
  prims.body.push(...S.mirrorX([smoothSk(S.ellipsoid(0.05, 0.04, 0.08).at(at(0.66).w - 0.03, CY - 0.2, 0.66).blend(0.04), 'core')]));
  const nodes = K.nodes({ detail: { default: 0.5, body: 0.52 }, minRes: { tail3: 30 } });
  nodes.push(JW.node(jawHard, 8, 0.6));
  nodes.push(
    finNode(K, 'finL', 'body', [at(0.66).w - 0.02, CY - 0.22, 0.68], [-40, -18, -118], pec(1)), finNode(K, 'finR', 'body', [-(at(0.66).w - 0.02), CY - 0.22, 0.68], [-40, 18, 118], pec(-1)),
    finNode(K, 'finPL', 'body', [0.08, at(0.0).y - at(0.0).h + 0.04, 0.0], [-30, -8, -158], pelv(1)), finNode(K, 'finPR', 'body', [-0.08, at(0.0).y - at(0.0).h + 0.04, 0.0], [-30, 8, 158], pelv(-1)),
  );
  return { kind: 'bahamut', nodes };
}
function animBahamut(model, ctx) {
  const rig = model?.userData?.rig; if (!rig) return;
  const t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 2.0 + phase;
  // a stately sweep of the tail; it rolls its flank up to blaze light (the snare), then surges with a gape
  const c = frac(t * 0.12 + phase * 0.21), blaze = pulse(c, 0.0, 0.3), surge = pulse(c, 0.45, 0.7);
  R(rig.body, Math.sin(w * 0.5) * 0.015 - surge * 0.06, -Math.sin(w + 0.9) * 0.04, Math.sin(w) * 0.02 + blaze * 0.32);
  P(rig.body, 0, Math.sin(w * 0.5 + 1) * 0.015 + blaze * 0.05, surge * 0.1);
  R(rig.jaw, 0.04 + surge * 0.5 + Math.max(0, Math.sin(t * 0.9 + phase)) * 0.05);
  (rig.tail || []).forEach((n, i) => R(n, 0, Math.sin(w - i * 0.75) * (0.08 + i * 0.06) * (1 + surge * 0.5), 0));
  (rig.fins || []).forEach((n, i) => { const sg = i % 2 ? -1 : 1, k = w * 0.7 + i * 1.3; R(n, Math.sin(k) * 0.14, 0, sg * (Math.sin(k + 0.9) * 0.16 + blaze * 0.25)); });
}

// =====================================================================================
// MATRIARCH-CAIMAN: the old queen of the Emerald River. A colossal caiman under rows of keeled armour, moss
// grown thick on her back, vines trailing from her flanks and water-lilies blooming among the scutes
// =====================================================================================
/** a lily pad (a notched disc lying flat, radius r) with an optional flower */
function lily(r, p, seed, flower, petal = 0xf0c8d8) {
  const out = [H.geo(cached('lilyPad', () => new THREE.CircleGeometry(1, 18, 0.35, PI * 2 - 0.7))).rot(-90, 0, 0).scale(r, 1, r).rot(0, rnd(seed, 1) * 360, 0).at(p[0], p[1] + 0.004, p[2])
    .shade((x, y) => mix(0x5a9a3a, 0x2a5a1a, clamp(Math.hypot(x, y) * 1.1, 0, 1) ** 2)).pbr(0.35)];
  if (flower) {
    for (let k = 0; k < 8; k++) out.push(spike(r * 0.75, r * 0.22, 0.4, 5, 0.45).rot(-50 - (k % 2) * 18, 0, 0).rot(0, k * 45 + 10, 0).at(p[0], p[1] + 0.01, p[2]).color(k % 2 ? petal : 0xfaf0f4).pbr(0.4).lod(1));
    out.push(H.sphere(r * 0.18, 8).at(p[0], p[1] + 0.02, p[2]).color(0xf0c030).pbr(0.5).lod(1));
  }
  return out;
}
function caimanDesc(def) {
  const base = num(def.color, 0x4a5a2a), olive = tone(base, 0, 0.02, 0.02), dark = mix(base, 0x141a0c, 0.45), scute = mix(base, 0x2a2a1a, 0.3), belly = 0xd8d0a0;
  const moss = 0x3a6418, mossLt = 0x5a8428, vine = 0x2a4a16, mouth = 0xd8b0a0, tooth = 0xf0e8d0, wet = 0.5;
  const CY = -0.035;
  const TAB = [
    { z: 1.25, w: 0.05, h: 0.026, y: CY + 0.005 }, { z: 1.2, w: 0.068, h: 0.034, y: CY + 0.006 }, { z: 1.02, w: 0.084, h: 0.044, y: CY + 0.01 }, { z: 0.9, w: 0.11, h: 0.056, y: CY + 0.014 },
    { z: 0.8, w: 0.135, h: 0.07, y: CY + 0.014 }, { z: 0.66, w: 0.16, h: 0.088, y: CY + 0.008 }, { z: 0.4, w: 0.235, h: 0.115, y: CY }, { z: 0.05, w: 0.25, h: 0.12, y: CY },
    { z: -0.22, w: 0.17, h: 0.105, y: CY }, { z: -0.45, w: 0.1, h: 0.095, y: CY }, { z: -0.75, w: 0.066, h: 0.08, y: CY }, { z: -1.02, w: 0.04, h: 0.058, y: CY }, { z: -1.22, w: 0.02, h: 0.034, y: CY }, { z: -1.32, w: 0.008, h: 0.012, y: CY },
  ];
  const sk = (p, part) => p.color(part === 'top' ? dark : part === 'bottom' ? belly : olive).pbr(wet).bump(0.004, 34, 'scales').tint(0.15, 10);
  const TZ = [-0.22, -0.45, -0.66, -0.86, -1.04, -1.19, -1.32];
  const segs = [['head', 1.25, 0.78], ['body', 0.78, -0.22]];
  for (let i = 0; i < TZ.length - 1; i++) segs.push([`tail${i}`, TZ[i], TZ[i + 1]]);
  const K = carcass(TAB, segs, 'body', sk, { pivot: 0.3, core: olive });
  const { at, skin, prims, hard } = K;
  // ---- the skull: raised orbits and nostrils, so that only they and the back break the surface; a bony brow ----
  prims.head.push(
    ...S.mirrorX([
      sk(S.ellipsoid(0.04, 0.035, 0.045).at(0.06, CY + 0.06, 0.88).blend(0.04), 'top'),
      sk(S.ellipsoid(0.05, 0.04, 0.07).at(0.1, CY + 0.01, 0.82).blend(0.04), 'core'),
      sk(S.capsule([0.035, CY + 0.045, 1.02], [0.05, CY + 0.055, 0.92], 0.012, 0.016).blend(0.02), 'top'),
    ]),
    sk(S.ellipsoid(0.04, 0.022, 0.035).at(0, CY + 0.03, 1.215).blend(0.025), 'top'),
    sk(S.capsule([0, CY + 0.048, 0.94], [0, CY + 0.06, 0.82], 0.02, 0.024).blend(0.03), 'top'),
  );
  const headHull = prims.head.slice();
  prims.head.push(...S.mirrorX([S.sphere(0.009).at(0.016, CY + 0.05, 1.22).color(0x0c0c08).paint(0.004, -0.005)]));
  // ---- armour: rows of keeled scutes over the back, a double crest of plates down the tail ----
  const scuteAt = (z, th, rw, rz, k) => {
    const q = skin(z, th), n = K.nodeOf(z), c = mix(scute, moss, rnd(Math.round(z * 97), th + 3) > 0.6 ? 0.45 : 0.08);
    prims[n].push(S.box(rw * 2, 0.2, rz * 2, Math.min(rw, rz) * 0.4).rot(0, 0, -th).at(q.p[0], q.p[1], q.p[2]).color(c).pbr(0.7).bump(0.004, 28, 'rock').paint(0.004, 0.012 * k));
    prims[n].push(S.capsule([q.p[0], q.p[1], z + rz * 0.7], [q.p[0], q.p[1], z - rz * 0.7], 0.006 * k + 0.004).color(mix(c, 0x1a1a10, 0.3)).pbr(0.7).paint(0.004, 0.02 * k));
  };
  for (let z = 0.72; z > -0.2; z -= 0.072) for (const th of [0, 16, -16, 33, -33, 52, -52]) if (Math.abs(th) < 40 || (z < 0.55 && z > -0.1)) scuteAt(z, th, 0.028 * clamp(at(z).w / 0.22, 0.5, 1.2), 0.03, Math.abs(th) > 40 ? 0.6 : 1);
  for (let z = -0.25; z > -1.28; z -= 0.06) {
    const q = at(z), n = K.nodeOf(z), k = clamp(q.h / 0.1, 0.3, 1), dbl = z > -0.8;
    for (const x of dbl ? [-q.w * 0.45, q.w * 0.45] : [0]) hard[n].push(spike(0.06 * k + 0.012, 0.03 * k + 0.008, -0.2, 4, 0.3).rot(0, 0, x * -60).at(x, q.y + q.h - 0.006, z).color(mix(scute, 0x1a1a0c, 0.2)).pbr(0.7));
  }
  for (let z = 0.62; z > -0.5; z -= 0.05) for (const th of [-62, 62]) prims[K.nodeOf(z)].push(S.sphere(0.014).at(...skin(z, th).p).color(scute).pbr(0.7).paint(0.004, 0.008));
  // ---- moss, lilies and vines ----
  K.dapple({ n: 46, z0: 0.65, z1: -0.6, th0: 0, th1: 50, r0: 0.018, r1: 0.045, seed: 111, wref: 0.2, stretch: 1.6, make: (p, i) => p.color(i % 3 ? moss : mossLt).pbr(0.95).bump(0.006, 40, 'fur').paint(0.01, 0.008) });
  K.belly((z) => at(z).y - at(z).h * 0.4, belly, 0.02, wet);
  K.stripe(1.2, -1.3, 76, (z) => at(z).h * 0.15, (p) => p.color(mix(olive, belly, 0.3)).pbr(wet).paint(0.02, 0), 0.12);
  K.dapple({ n: 70, z0: 0.6, z1: -1.2, th0: 60, th1: 100, r0: 0.01, r1: 0.022, seed: 113, wref: 0.15, make: (p) => p.color(dark).pbr(wet).paint(0.006, 0) });
  const lilies = [[0.45, 10, 0.05, true], [0.2, -22, 0.06, false], [0.05, 18, 0.045, true], [-0.12, -8, 0.04, false], [0.6, -26, 0.035, false], [-0.4, 0, 0.035, true]];
  lilies.forEach(([z, th, r, fl], i) => { const q = skin(z, th, 0.012); hard[K.nodeOf(z)].push(...lily(r, q.p, i + 3, fl, i % 2 ? 0xf0b0c8 : 0xf8e8f0)); });
  for (const [z, sd] of [[0.5, 1], [0.15, -1], [-0.05, 1], [0.32, -1]]) {
    const n = K.nodeOf(z), q = at(z), pts = [[-sd * q.w * 0.4, q.y + q.h * 1.05, z + 0.03], [sd * q.w * 0.2, q.y + q.h * 1.1, z - 0.02], [sd * q.w * 0.85, q.y + q.h * 0.7, z - 0.05], [sd * q.w * 1.12, q.y - q.h * 0.1, z - 0.06], [sd * q.w * 1.18, q.y - q.h * 0.9, z - 0.1], [sd * q.w * 1.2, q.y - q.h * 1.7, z - 0.13]];
    hard[n].push(H.tube(pts, 0.008, 22, 5).color(vine).pbr(0.7));
    for (let k = 1; k < 5; k++) hard[n].push(H.geo(cached('leaf', () => new THREE.CircleGeometry(1, 7))).scale(0.022, 0.012, 1).rot(-60, 0, 0).rot(0, k * 70, 0).at(pts[k][0] + sd * 0.01, pts[k][1], pts[k][2]).color(k % 2 ? 0x3a7a22 : 0x4a8a2a).pbr(0.6).lod(1));
  }
  // ---- golden eyes on their turrets ----
  eyes(K, 'head', surfer(headHull), 0.88, CY + 0.07, 0.022, { iris: 0xf0b820, rim: 0x6a4a08, white: 0xe8c040, shape: 'slit', pupilDeg: 14, irisDeg: 62, rough: 0.05, glow: 0.45 }, { socket: 0x10140a, pitch: -30, yaw: 60 });
  // ---- jaws: a broad snout lined with interlocking teeth ----
  const JW = addJaw(K, 'head', { tip: 1.25, hinge: 0.8, yT: CY - 0.004, yH: CY - 0.016, mouth, sk, palate: 0.024, tongue: 0.012, back: 0.06, belly, bellyLine: (z) => at(z).y - at(z).h * 0.4, wet, jawTip: 1.23 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  teeth(hard.head, sfH, { z0: 0.84, z1: 1.21, n: 12, mY: JW.mY, up: 1, r: 0.0065, len: (i) => 0.02 + (i === 3 || i === 9 ? 0.016 : 0), col: tooth, hook: 0.15, rake: 4, splay: 10, inset: 0.35 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: 0.85, z1: 1.2, n: 11, mY: JW.mY, up: -1, r: 0.0065, len: (i) => 0.02 + (i === 1 || i === 8 ? 0.014 : 0), col: tooth, hook: 0.15, rake: -4, splay: 10, inset: 0.35 });
  // ---- legs: splayed, clawed, a paddle of webbing between the toes ----
  const leg = (sd, rear) => {
    const L1 = rear ? 0.15 : 0.12, L2 = rear ? 0.13 : 0.11, p0 = [0, 0, 0], p1 = [sd * L1, -0.05, rear ? -0.04 : 0.03], p2 = [sd * (L1 + 0.03), -0.05 - L2, rear ? -0.06 : 0.06];
    const pr = [sk(S.capsule(p0, p1, rear ? 0.05 : 0.042, 0.032).blend(0.03), 'core'), sk(S.capsule(p1, p2, 0.03, 0.024).blend(0.025), 'core'), sk(S.ellipsoid(0.04, 0.014, 0.05).at(p2[0] + sd * 0.01, p2[1] - 0.01, p2[2] + 0.03).blend(0.02), 'core')];
    const hd = [H.geo(coreGeo(0.04, 0.03, 0.16)).color(olive).pbr(wet).rot(0, sd * 80, 0).lod(3)];
    for (let k = 0; k < 4; k++) hd.push(spike(0.04, 0.008, 0.3, 5).rot(80, (k - 1.5) * 22, 0).at(p2[0] + sd * 0.01 + (k - 1.5) * 0.02, p2[1] - 0.012, p2[2] + 0.06).color(0x2a2418).pbr(0.4).lod(1));
    return { prims: pr, hard: hd };
  };
  const nodes = K.nodes({ detail: { default: 0.54, head: 0.78, body: 0.5 }, minRes: { tail4: 30, tail5: 32 } });
  nodes.push(JW.node(jawHard, 6, 0.78));
  for (const [nm, sd, rear, z] of [['legFL', 1, false, 0.55], ['legFR', -1, false, 0.55], ['legRL', 1, true, -0.12], ['legRR', -1, true, -0.12]]) {
    const q = at(z), L = leg(sd, rear), pos = [sd * (q.w - 0.04), CY - q.h * 0.35, z];
    nodes.push({ name: nm, parent: 'body', rig: 'legs', pos: sub(pos, K.ORG.body), rot: [0, 0, sd * 10], prims: L.prims, hard: L.hard, detail: 0.9, minRes: 26 });
  }
  return { kind: 'matriarchCaiman', nodes };
}
function animCaiman(model, ctx) {
  const rig = model?.userData?.rig; if (!rig) return;
  const t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 1.8 + phase;
  // she drifts, then lunges with a sideways snap of the head and a thrash of the tail that throws men overboard
  const c = frac(t * 0.14 + phase * 0.21), lunge = pulse(c, 0.0, 0.22), snap = pulse(c, 0.14, 0.26), thrash = pulse(c, 0.22, 0.5);
  const sd = Math.sin(phase * 7.1) > 0 ? 1 : -1;
  R(rig.body, -lunge * 0.06 + Math.sin(w * 0.5) * 0.01, -Math.sin(w + 1) * 0.04 + snap * 0.1 * sd, Math.sin(w * 0.5) * 0.02 + thrash * Math.sin(t * 9) * 0.06);
  P(rig.body, 0, lunge * 0.03 + Math.sin(w * 0.5) * 0.008, lunge * 0.1);
  R(rig.head, -lunge * 0.18 + snap * 0.08, Math.sin(w + 1) * 0.05 + snap * 0.35 * sd, snap * 0.2 * sd);
  R(rig.jaw, 0.02 + lunge * 0.75 - snap * 0.7 + Math.max(0, Math.sin(t * 0.6 + phase)) * 0.05);
  (rig.tail || []).forEach((n, i) => R(n, 0, Math.sin(w - i * 0.7) * (0.06 + i * 0.03) + Math.sin(t * 9 - i * 0.8) * thrash * (0.08 + i * 0.03), 0));
  (rig.legs || []).forEach((n, i) => { const s = i % 2 ? -1 : 1, k = w + (i > 1 ? PI : 0) + (i % 2) * PI; R(n, Math.sin(k) * 0.3, Math.cos(k) * 0.25 * s, s * (Math.sin(k + 0.5) * 0.15 + lunge * 0.3)); });
}

// =====================================================================================
// ZARATAN: the island that swims, beast of the Golden Sands. A sea-turtle the size of a country, its shell set with
// scutes like jewels, and on its back an oasis: dunes, palms, a pool and a ruined dome
// =====================================================================================
/** a palm frond: a drooping, folded leaf along +Z, length 1 */
function frondGeo() {
  return cached('frond', () => {
    const g = new THREE.PlaneGeometry(1, 1, 4, 9), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) * 2, v = p.getY(i) + 0.5, w = 0.11 * Math.pow(Math.sin(PI * Math.min(1, v * 1.05)), 0.7) + 0.005;
      const saw = 1 - 0.35 * (Math.abs(Math.sin(v * 40)) * Math.abs(u));
      p.setXYZ(i, u * w * saw, -0.55 * v * v + Math.abs(u) * w * 0.6, v);
    }
    g.computeVertexNormals();
    return g;
  });
}
function palm(x, y, z, h, lean, yaw, seed) {
  const out = [], top = [x + Math.sin(yaw * DEG) * lean, y + h, z + Math.cos(yaw * DEG) * lean];
  const pts = [[x, y - 0.02, z], [x + (top[0] - x) * 0.2, y + h * 0.35, z + (top[2] - z) * 0.2], [x + (top[0] - x) * 0.6, y + h * 0.72, z + (top[2] - z) * 0.6], top];
  out.push(H.tube(pts, [h * 0.075, h * 0.06, h * 0.05, h * 0.045], 16, 7).shade((px, py) => (Math.sin(py * 180) > 0.4 ? 0x6a4a2a : 0x8a6a42)).pbr(0.85));
  for (let k = 0; k < 9; k++) {
    const a = k * 40 + rnd(seed, k) * 20, L = h * (0.62 + rnd(seed, k + 9) * 0.2);
    out.push(H.geo(frondGeo()).shade((px, py, pz) => mix(Math.abs(px) < 0.01 ? 0xa8a040 : 0x3a8a2a, 0x2a5a1a, pz * 0.7)).scale(L, L, L).rot(-20 - rnd(seed, k + 3) * 20, 0, 0).rot(0, a, 0).at(top[0], top[1], top[2]).pbr(0.6));
  }
  for (let k = 0; k < 3; k++) out.push(H.sphere(h * 0.045, 8).at(top[0] + Math.cos(k * 2.1) * h * 0.05, top[1] - h * 0.04, top[2] + Math.sin(k * 2.1) * h * 0.05).color(0x5a3a1a).pbr(0.6).lod(1));
  return out;
}
function zaratanDesc(def) {
  const base = num(def.color, 0x7a8a5a), skinC = tone(base, 0, 0.0, -0.02), skinDk = mix(base, 0x1a2014, 0.45), shellC = mix(base, 0x3a3020, 0.5), gold = 0xd8a838;
  const jewels = [0x2a50b8, 0x20a8a0, 0x9a2040, 0x2a9050, 0xc88a20, 0x6a3aa8], sand = 0xe0c890, sandDk = 0xb89a60, stone = 0xd8c098, tile = 0x2a8aa8, belly = 0xd8cca0, wet = 0.45;
  const SC = [0, 0.0, -0.05], A = 0.84, B = 0.3, C = 1.0;   // the carapace: an ellipsoid centre and radii
  const shellPt = (u, v) => { const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v); const p = [SC[0] + A * cv * su, SC[1] + B * sv, SC[2] + C * cv * cu]; const n = [(p[0] - SC[0]) / (A * A), (p[1] - SC[1]) / (B * B), (p[2] - SC[2]) / (C * C)], l = Math.hypot(...n); return { p, n: n.map((v2) => v2 / l) }; };
  const body = [], bodyHard = [];
  // ---- carapace, rim and plastron ----
  const shell = S.ellipsoid(A, B, C).at(...SC).color(shellC).pbr(0.4, 0.2).bump(0.006, 10, 'rock').tint(0.1, 6);
  body.push(shell,
    S.ellipsoid(A * 1.05, 0.07, C * 1.05).at(SC[0], SC[1] - 0.02, SC[2]).color(mix(shellC, gold, 0.25)).pbr(0.4, 0.3).blend(0.04),
    S.ellipsoid(A * 0.9, 0.2, C * 0.92).at(SC[0], SC[1] - 0.1, SC[2]).color(belly).pbr(0.5).blend(0.06));
  // jewel scutes: a gold setting with a coloured stone, in rings from the rim up
  const rings = [[0.12, 24, 0.075], [0.42, 16, 0.1], [0.78, 9, 0.11]];
  rings.forEach(([v, n, r], ri) => {
    for (let k = 0; k < n; k++) {
      const u = (k / n) * PI * 2 + (ri % 2 ? PI / n : 0), s = shellPt(u, v), col = jewels[(k * 3 + ri * 2) % jewels.length];
      body.push(S.sphere(r * 1.12).at(...s.p).color(gold).pbr(0.3, 0.7).paint(0.008, 0.006));
      body.push(S.sphere(r * 0.86).at(...s.p).color(col).pbr(0.12, 0.35).glow(0.06).paint(0.006, 0.014));
      if (ri < 2) bodyHard.push(H.sphere(r * 0.22, 10).at(s.p[0] + s.n[0] * 0.012, s.p[1] + s.n[1] * 0.012, s.p[2] + s.n[2] * 0.012).color(0xfff4e0).pbr(0.08, 0.2).lod(1));
    }
  });
  // ---- the oasis on its back: dunes, rocks, a pool, palms and a ruined dome ----
  const sTop = SC[1] + B;
  body.push(
    S.ellipsoid(0.6, 0.12, 0.66).at(0, sTop - 0.02, -0.08).color(sand).pbr(0.95).bump(0.01, 7, 'noise').tint(0.1, 5).blend(0.1),
    S.ellipsoid(0.3, 0.1, 0.3).at(-0.18, sTop + 0.06, -0.3).color(sand).pbr(0.95).bump(0.01, 7).blend(0.12),
    S.ellipsoid(0.22, 0.08, 0.26).at(0.22, sTop + 0.04, 0.2).color(mix(sand, sandDk, 0.3)).pbr(0.95).bump(0.008, 8).blend(0.12),
    S.ellipsoid(0.13, 0.05, 0.1).at(0.08, sTop + 0.1, 0.12).cut(0.03).color(sandDk),
  );
  for (let i = 0; i < 7; i++) { const a = rnd(i, 51) * PI * 2, r = 0.25 + rnd(i, 52) * 0.3; body.push(S.ellipsoid(0.05 + rnd(i, 53) * 0.04, 0.04 + rnd(i, 54) * 0.04, 0.06).rot(0, rnd(i, 55) * 180, 0).at(Math.sin(a) * r, sTop + 0.06, -0.08 + Math.cos(a) * r).color(mix(0x9a8a6a, 0x6a5a42, rnd(i, 56))).pbr(0.9).bump(0.008, 20, 'rock').blend(0.03)); }
  // green fringe of the oasis
  body.push(S.ellipsoid(0.16, 0.04, 0.13).at(0.08, sTop + 0.075, 0.12).color(0x5a8a2a).pbr(0.9).bump(0.006, 40, 'fur').paint(0.04, 0.012));
  bodyHard.push(H.cyl(1, 1, 0.006, 22).scale(0.1, 1, 0.075).at(0.08, sTop + 0.085, 0.12).color(0x2ab0c0).pbr(0.05, 0.3).glow(0.1));
  bodyHard.push(...palm(0.0, sTop + 0.08, 0.3, 0.36, 0.08, 20, 1), ...palm(0.2, sTop + 0.06, 0.02, 0.3, 0.1, 130, 2), ...palm(-0.08, sTop + 0.08, -0.02, 0.42, 0.06, 260, 3), ...palm(-0.3, sTop + 0.02, 0.25, 0.26, 0.1, 300, 4));
  for (let i = 0; i < 14; i++) { const a = rnd(i, 61) * PI * 2, r = 0.12 + rnd(i, 62) * 0.4; bodyHard.push(spike(0.04 + rnd(i, 63) * 0.03, 0.012, 0.1, 4, 0.4).rot(rnd(i, 64) * 30 - 15, rnd(i, 65) * 360, 0).at(Math.sin(a) * r, sTop + 0.1 - r * 0.12, -0.08 + Math.cos(a) * r).color(0x8a9a3a).pbr(0.8).lod(1)); }
  // the ruin: a drum of sandstone under a broken tiled dome, toppled columns about it
  const D = [-0.2, sTop + 0.1, -0.32];
  bodyHard.push(
    H.cyl(0.1, 0.105, 0.08, 20).at(D[0], D[1] + 0.04, D[2]).shade((px, py) => (Math.abs(py - 0.025) < 0.006 ? 0xb89a68 : null)).color(stone).pbr(0.85),
    H.geo(new THREE.SphereGeometry(0.1, 18, 8, 0.6, PI * 1.45, 0, PI / 2)).at(D[0], D[1] + 0.08, D[2]).shade((px, py, pz) => (Math.sin(Math.atan2(pz, px) * 18) > 0.85 || Math.sin(py * 140) > 0.9 ? 0xd8c088 : tile)).pbr(0.3, 0.2),
    H.cyl(0.024, 0.024, 0.03, 12).at(D[0], D[1] + 0.195, D[2]).color(gold).pbr(0.3, 0.7),
    ...[0, 1, 2, 3, 4].map((k) => { const a = k * 1.25 + 0.4, hgt = [0.12, 0.07, 0.14, 0.05, 0.09][k]; return H.cyl(0.013, 0.015, hgt, 8).at(D[0] + Math.cos(a) * 0.17, D[1] + hgt / 2 - 0.02, D[2] + Math.sin(a) * 0.17).color(stone).pbr(0.85); }),
    H.cyl(0.013, 0.013, 0.12, 8).rot(0, 0, 84).at(D[0] + 0.16, D[1] - 0.005, D[2] + 0.1).color(stone).pbr(0.85),
    ...[0, 1, 2].map((k) => H.box(0.04, 0.025, 0.03, 0.004).rot(0, k * 40, k * 12).at(D[0] - 0.12 + k * 0.05, D[1] - 0.01, D[2] - 0.12 - k * 0.02).color(mix(stone, 0x9a8a6a, k * 0.3)).pbr(0.9)),
  );
  // barnacles low on the rim
  for (let k = 0; k < 16; k++) { const s = shellPt(rnd(k, 71) * PI * 2, 0.02); bodyHard.push(barnacle(0.018 + rnd(k, 72) * 0.012, s.p, s.n).lod(1)); }
  // ---- neck, head and beak ----
  const nsk = (p) => p.color(skinC).pbr(wet).bump(0.006, 22, 'ridges').tint(0.12, 10);
  const neck = [nsk(S.capsule([0, 0, -0.08], [0, 0.02, 0.2], 0.16, 0.12).blend(0.04)), ...S.mirrorX([nsk(S.capsule([0.06, 0.06, 0.0], [0.05, 0.07, 0.16], 0.04, 0.03).blend(0.04))]),
    S.ellipsoid(0.2, 0.08, 0.25).at(0, -0.11, 0.06).color(belly).pbr(wet).paint(0.03, 0)];
  const hsk = (p, c = skinC) => p.color(c).pbr(wet).bump(0.005, 26, 'scales').tint(0.12, 12);
  const head = [
    hsk(S.ellipsoid(0.15, 0.13, 0.19).at(0, 0.02, 0.1)), hsk(S.ellipsoid(0.12, 0.09, 0.12).at(0, 0.0, 0.22).blend(0.06)),
    hsk(S.capsule([0, 0.06, 0.24], [0, -0.01, 0.34], 0.06, 0.03).blend(0.04), 0x3a3426),
    ...S.mirrorX([hsk(S.ellipsoid(0.04, 0.03, 0.05).at(0.1, 0.09, 0.15).blend(0.03), skinDk)]),
    S.box(0.4, 0.1, 0.3, 0.01).at(0, -0.075, 0.24).cut(0.008).color(0x4a1a1a),
  ];
  for (let k = 0; k < 7; k++) { const a = (k / 7) * PI * 1.2 - 0.6 * PI + PI / 2; head.push(S.sphere(0.036).at(Math.cos(a) * 0.09, 0.13, 0.08 + Math.sin(a) * 0.07).color(gold).pbr(0.3, 0.7).paint(0.006, 0.006), S.sphere(0.026).at(Math.cos(a) * 0.09, 0.135, 0.08 + Math.sin(a) * 0.07).color(jewels[k % jewels.length]).pbr(0.12, 0.35).paint(0.005, 0.01)); }
  const eyeL = eye(0.028, { iris: 0xd89020, rim: 0x5a3008, white: 0xd8b860, pupilDeg: 20, irisDeg: 52, rough: 0.06, glow: 0.3 });
  const headHard = H.mirrorX([eyeL.rot(-10, 70, 0).at(0.118, 0.065, 0.17), spike(0.05, 0.02, 0.4, 5).rot(180, 0, 0).rot(-30, 0, 0).at(0, -0.02, 0.33).color(0x3a3426).pbr(0.4)]).slice(0, 3);
  const jaw = [hsk(S.ellipsoid(0.12, 0.05, 0.16).at(0, -0.02, 0.12)), hsk(S.capsule([0, -0.02, 0.2], [0, 0.0, 0.29], 0.04, 0.02).blend(0.03), 0x3a3426), S.ellipsoid(0.1, 0.03, 0.14).at(0, 0.02, 0.12).cut(0.01).color(0x5a1a20), S.ellipsoid(0.1, 0.04, 0.14).at(0, -0.06, 0.1).color(belly).pbr(wet).paint(0.02, 0)];
  // ---- flippers: broad, jewel-flecked ----
  const fshade = (sp, sd) => (x, y, z) => { const c = cells3(x * 40, y * 40, z * 40); return c < 0.25 ? (c < 0.12 ? jewels[Math.floor(noise3(x * 9, y * 9, z * 9) * 6) % 6] : gold) : mix(x * sd > 0 ? belly : skinC, skinDk, clamp(y / sp, 0, 1) ** 1.5 * 0.5); };
  const flip = (sd, sp, ch) => [fin({ span: sp, chord: ch, peak: 0.35, root: 0.6, tip: 0.3, pw: 1.3, sweep: 0.5, curve: 1.4, thick: 0.14, rows: 10 }).shade(fshade(sp, sd)).pbr(0.45, 0.1)];
  const tail = [nsk(S.capsule([0, 0, 0], [0, -0.01, -0.18], 0.06, 0.015).blend(0.03))];
  return { kind: 'zaratan', nodes: [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: [0, 0, 0], prims: body, hard: bodyHard, detail: 0.37 },
    { name: 'neck0', parent: 'body', rig: 'necks', pos: [0, -0.04, 0.88], rot: [-6, 0, 0], prims: neck, detail: 0.6 },
    { name: 'head', parent: 'neck0', rig: 'head', pos: [0, 0.04, 0.2], rot: [10, 0, 0], prims: head, hard: headHard, detail: 0.75 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: [0, -0.06, 0.06], rot: [6, 0, 0], prims: into([0, -0.06, 0.06], jaw), detail: 0.75 },
    { name: 'finFL', parent: 'body', rig: 'fins', pos: [0.6, -0.08, 0.5], rot: [-8, -28, -100], hard: flip(1, 0.78, 0.3) },
    { name: 'finFR', parent: 'body', rig: 'fins', pos: [-0.6, -0.08, 0.5], rot: [-8, 28, 100], hard: flip(-1, 0.78, 0.3) },
    { name: 'finRL', parent: 'body', rig: 'fins', pos: [0.55, -0.08, -0.62], rot: [-8, -50, -100], hard: flip(1, 0.44, 0.24) },
    { name: 'finRR', parent: 'body', rig: 'fins', pos: [-0.55, -0.08, -0.62], rot: [-8, 50, 100], hard: flip(-1, 0.44, 0.24) },
    { name: 'tail0', parent: 'body', rig: 'tail', pos: [0, -0.05, -1.0], prims: tail, detail: 0.8 },
  ] };
}
function animZaratan(model, ctx) {
  const rig = model?.userData?.rig; if (!rig) return;
  const t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 0.9 + phase;
  // the island rocks gently on the swell; it stretches its neck out to ram, or rears and slams (its wave)
  const c = frac(t * 0.08 + phase * 0.13), ram = pulse(c, 0.0, 0.25), slam = pulse(c, 0.5, 0.75);
  R(rig.body, Math.sin(w * 0.7) * 0.015 - slam * 0.05 + ram * 0.02, Math.sin(w * 0.4) * 0.02, Math.sin(w * 0.55 + 1) * 0.02);
  P(rig.body, 0, Math.sin(w * 0.7 + 0.5) * 0.012 + slam * 0.04 - Math.max(0, Math.sin(((c - 0.5) / 0.25) * PI * 2)) * slam * 0.05, ram * 0.06);
  const N = rig.necks?.[0];
  if (N) { R(N, -ram * 0.15 + Math.sin(w) * 0.04, Math.sin(t * 0.3 + phase) * 0.18 * (1 - ram), 0); P(N, 0, 0, ram * 0.12); }
  R(rig.head, -slam * 0.25 + ram * 0.1 + Math.sin(w * 1.3) * 0.04, Math.sin(t * 0.5 + phase) * 0.1, 0);
  R(rig.jaw, 0.03 + ram * 0.5 + slam * 0.45 + Math.max(0, Math.sin(t * 0.6 + phase)) * 0.04);
  (rig.tail || []).forEach((n) => R(n, 0, Math.sin(w) * 0.2, 0));
  (rig.fins || []).forEach((n, i) => { const sg = i % 2 ? -1 : 1, k = w * 1.4 - (i > 1 ? 1.4 : 0); R(n, Math.cos(k) * 0.22 * (i > 1 ? 0.6 : 1), Math.sin(k) * 0.1 * sg, sg * (Math.sin(k) * 0.3 * (i > 1 ? 0.6 : 1) + slam * 0.2)); });
}

// =====================================================================================
// MANGROVE-HYDRA: the Deep-Root's walking islet. A tangle of living mangrove roots and leaf crowned with green,
// out of which rise snapping-turtle heads and banded water-snakes with venom in their fangs
// =====================================================================================
const HYDRA = [
  // kind, azimuth from the front, base distance, base height, elevation, segment lengths, radii
  { kind: 'turtle', az: 34, r: 0.5, y: 0.12, elev: 34, L: [0.11, 0.11, 0.1], R: [0.07, 0.06, 0.056, 0.052], bend: [6, 10, 12], head: -2 },
  { kind: 'turtle', az: -34, r: 0.5, y: 0.12, elev: 34, L: [0.11, 0.11, 0.1], R: [0.07, 0.06, 0.056, 0.052], bend: [6, 10, 12], head: -2 },
  { kind: 'snake', az: 10, r: 0.3, y: 0.22, elev: 62, L: [0.13, 0.13, 0.12, 0.12, 0.1], R: [0.04, 0.034, 0.03, 0.028, 0.026, 0.024], bend: [0, 14, 22, 24, 18], head: 6 },
  { kind: 'snake', az: -12, r: 0.3, y: 0.2, elev: 58, L: [0.12, 0.12, 0.12, 0.11, 0.1], R: [0.04, 0.034, 0.03, 0.028, 0.026, 0.024], bend: [0, 12, 20, 22, 18], head: 8 },
  { kind: 'snake', az: 70, r: 0.48, y: 0.1, elev: 50, L: [0.12, 0.12, 0.11, 0.1], R: [0.036, 0.032, 0.028, 0.026, 0.024], bend: [0, 18, 22, 20], head: 4 },
  { kind: 'snake', az: -72, r: 0.48, y: 0.1, elev: 52, L: [0.12, 0.12, 0.11, 0.1], R: [0.036, 0.032, 0.028, 0.026, 0.024], bend: [0, 18, 22, 20], head: 4 },
];
function hydraDesc(def) {
  const base = num(def.color, 0x4a5a2a), bark = 0x5a4a38, barkDk = 0x3a2e22, barkLt = 0x8a7a62, mud = 0x3a3424, leaf = mix(base, 0x2a6a2a, 0.5), leafLt = 0x6a9a3a, leafDk = 0x1e3a18;
  const turtleC = 0x5a5a3a, turtleDk = 0x2e2e1e, beak = 0x2a261c, snakeC = 0x8a8a3a, snakeBand = 0x1a1c10, snakeBelly = 0xd8c060, mouth = 0x6a2a2a, fang = 0xf0ead8;
  const barkSk = (p, c = bark) => p.color(c).pbr(0.85).bump(0.008, 18, 'fur').tint(0.18, 9);
  const body = [], bodyHard = [];
  // ---- the root-mass: a low knotted mound with buttress roots running out into the water ----
  body.push(barkSk(S.ellipsoid(0.48, 0.22, 0.5).at(0, 0.0, -0.02)), barkSk(S.ellipsoid(0.3, 0.2, 0.3).at(0.05, 0.16, -0.08).blend(0.08), barkDk));
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * PI * 2 + rnd(i, 3) * 0.3, r1 = 0.78 + rnd(i, 4) * 0.22, r0 = 0.2, c = Math.cos(a), s = Math.sin(a);
    const pts = [[s * r0, 0.22, c * r0], [s * (r0 + r1) * 0.45, 0.24 + rnd(i, 5) * 0.05, c * (r0 + r1) * 0.45], [s * r1 * 0.85, 0.06, c * r1 * 0.85], [s * r1, -0.12, c * r1]];
    body.push(...S.limb(pts, [0.07, 0.055, 0.04, 0.035]).map((p) => barkSk(p.blend(0.04), i % 3 ? bark : barkDk)));
  }
  body.push(S.box(3, 0.4, 3, 0.01).at(0, -0.17, 0).color(mud).pbr(0.9).paint(0.06, 0));
  // knots, lichen and hanging moss
  for (let i = 0; i < 24; i++) { const a = rnd(i, 11) * PI * 2, r = 0.2 + rnd(i, 12) * 0.35; body.push(S.sphere(0.03 + rnd(i, 13) * 0.03).at(Math.sin(a) * r, 0.12 + rnd(i, 14) * 0.12 - r * 0.15, Math.cos(a) * r).color(i % 3 ? barkLt : 0x7a8a4a).pbr(0.9).bump(0.006, 30, 'rock').paint(0.02, 0.012)); }
  // the prop roots: a thicket of thin arching roots
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * PI * 2 + rnd(i, 21) * 0.2, c = Math.cos(a), s = Math.sin(a), r0 = 0.25 + rnd(i, 22) * 0.2, r1 = 0.7 + rnd(i, 23) * 0.35, hh = 0.32 + rnd(i, 24) * 0.18;
    const pts = [[s * r0, hh, c * r0], [s * (r0 * 0.4 + r1 * 0.6), hh + 0.06, c * (r0 * 0.4 + r1 * 0.6)], [s * r1 * 0.95, hh * 0.45, c * r1 * 0.95], [s * r1, -0.1, c * r1]];
    bodyHard.push(H.tube(pts, [0.016, 0.014, 0.012, 0.011], 11, 5).shade((x, y) => (y < 0.02 ? mud : null)).color(i % 2 ? bark : barkLt).pbr(0.85));
  }
  // ---- the crown: a few trunks and clumps of leathery mangrove leaf ----
  for (const [x, z, h] of [[0.06, -0.14, 0.62], [-0.16, -0.02, 0.5], [0.18, 0.05, 0.46], [-0.02, -0.3, 0.52]]) body.push(barkSk(S.capsule([x * 0.6, 0.2, z * 0.6], [x, h, z], 0.045, 0.025).blend(0.04)));
  const clumps = [[0.06, 0.66, -0.16, 0.2], [-0.18, 0.54, -0.04, 0.17], [0.2, 0.5, 0.06, 0.16], [-0.04, 0.56, -0.34, 0.17], [0.15, 0.58, -0.3, 0.13], [-0.25, 0.44, -0.28, 0.13], [-0.06, 0.72, -0.02, 0.12]];
  clumps.forEach(([x, y, z, r], i) => {
    body.push(S.ellipsoid(r * 1.15, r * 0.75, r).at(x, y, z).color(i % 2 ? leaf : mix(leaf, leafDk, 0.3)).pbr(0.75).bump(0.026, 11, 'noise').tint(0.3, 9).blend(0.06));
    for (let k = 0; k < 6; k++) { const a = rnd(i * 6 + k, 31) * PI * 2, b = rnd(i * 6 + k, 32) * 0.8; body.push(S.sphere(r * 0.25).at(x + Math.cos(a) * r * 0.9 * Math.cos(b), y + Math.sin(b) * r * 0.6, z + Math.sin(a) * r * 0.85 * Math.cos(b)).color(leafLt).pbr(0.7).paint(0.03, 0.01)); }
  });
  for (let i = 0; i < 10; i++) { const a = rnd(i, 41) * PI * 2, r = 0.25 + rnd(i, 42) * 0.1, x = Math.sin(a) * r, z = -0.15 + Math.cos(a) * r; bodyHard.push(streamer([[x, 0.5, z], [x * 1.05, 0.38, z * 1.05], [x * 1.1, 0.24, z * 1.1]], 0.02, 0.006, [Math.cos(a), 0, -Math.sin(a)], 0x5a6a3a, 0x8a9a5a, 0.5, 6).pbr(0.9).lod(1)); }
  // ---- necks and heads ----
  const nodes = [ROOT, { name: 'body', parent: 'root', rig: 'body', pos: [0, 0, 0], prims: body, hard: bodyHard, detail: 0.27 }];
  HYDRA.forEach((N, k) => {
    const snake = N.kind === 'snake', az = N.az * DEG, base = [Math.sin(az) * N.r, N.y, Math.cos(az) * N.r];
    nodes.push({ name: `nb${k}`, parent: 'body', pos: base, rot: [0, N.az, 0] }, { name: `ne${k}`, parent: `nb${k}`, rot: [-N.elev, 0, 0] });
    N.L.forEach((L, j) => {
      const r0 = N.R[j], r1 = N.R[j + 1], prims = [], hard = [H.geo(coreGeo(r0, r1, L, 0.78)).color(snake ? snakeC : turtleC).pbr(0.5)];
      if (snake) {
        prims.push(S.capsule([0, 0, 0], [0, 0, L], r0, r1).color(snakeC).pbr(0.35).bump(0.003, 50, 'scales').tint(0.1, 14));
        for (let b = 0; b < 2; b++) prims.push(S.box(0.2, 0.2, L * 0.16, 0.004).at(0, 0, L * (0.25 + b * 0.5)).color(snakeBand).pbr(0.4).paint(0.006, 0));
        prims.push(S.box(0.2, 0.1, L + 0.02, 0.004).at(0, -0.06 - r0 * 0.45, L / 2).color(snakeBelly).pbr(0.4).paint(0.008, 0));
      } else {
        prims.push(S.capsule([0, 0, 0], [0, 0, L], r0, r1).color(turtleC).pbr(0.6).bump(0.007, 26, 'rock').tint(0.15, 10));
        for (let b = 0; b < 2; b++) prims.push(S.sphere(r0 * 0.3).at(0, r0 * 0.85, L * (0.3 + b * 0.45)).color(turtleDk).pbr(0.6).blend(0.01));
        hard.push(spike(0.03, 0.01, 0.2, 4).rot(-30, 0, 0).at(0, r0 * 0.95, L * 0.5).color(turtleDk).pbr(0.6).lod(1));
      }
      nodes.push({ name: `n${k}_${j}`, parent: j ? `n${k}_${j - 1}` : `ne${k}`, rig: `neck${k}`, pos: j ? [0, 0, N.L[j - 1]] : [0, 0, 0], rot: [N.bend[j], 0, 0], prims, hard, detail: 0.6, minRes: 24 });
    });
    const last = `n${k}_${N.L.length - 1}`, tipZ = N.L[N.L.length - 1];
    let head, headHard, jaw, jawHard, J;
    if (snake) {
      // a banded water-snake: a flat, wedge-shaped head, red eyes, two long fangs
      head = [S.ellipsoid(0.042, 0.026, 0.06).at(0, 0.006, 0.045).color(snakeC).pbr(0.35).bump(0.003, 50, 'scales'), S.ellipsoid(0.032, 0.02, 0.045).at(0, 0.004, 0.1).color(snakeC).pbr(0.35).blend(0.03),
        S.box(0.2, 0.2, 0.012, 0.003).at(0, 0, 0.0).color(snakeBand).paint(0.004, 0), S.box(0.2, 0.06, 0.2, 0.003).at(0, 0.05, 0.06).color(mix(snakeC, snakeBand, 0.5)).paint(0.01, 0),
        S.box(0.3, 0.06, 0.3, 0.01).at(0, -0.03, 0.08).cut(0.004).color(mouth)];
      headHard = [...H.mirrorX([eye(0.009, { iris: 0xd83020, rim: 0x400808, white: 0xd83020, shape: 'slit', pupilDeg: 14, irisDeg: 60, glow: 0.6, seg: 12 }).rot(-6, 72, 0).at(0.03, 0.016, 0.075), spike(0.032, 0.0045, 0.4, 5).rot(180, 0, 0).rot(-12, 0, 0).at(0.016, -0.002, 0.12).color(fang).pbr(0.2)])];
      J = [0, -0.004, 0.0];
      jaw = [S.ellipsoid(0.036, 0.014, 0.065).at(0, -0.012, 0.07).color(snakeBelly).pbr(0.4), S.ellipsoid(0.03, 0.008, 0.05).at(0, -0.004, 0.07).color(mouth).paint(0.004, 0)];
      jawHard = [H.tube([[0, -0.008, 0.08], [0, -0.006, 0.14], [0, -0.004, 0.17]], [0.004, 0.003, 0.0015], 6, 5).color(0x1a0a10).pbr(0.3).lod(1)];
    } else {
      // a snapping turtle: a blocky knobbed head and a hooked beak
      head = [S.ellipsoid(0.072, 0.058, 0.085).at(0, 0.01, 0.06).color(turtleC).pbr(0.6).bump(0.007, 24, 'rock'), S.ellipsoid(0.05, 0.04, 0.05).at(0, 0.01, 0.12).color(turtleC).pbr(0.6).blend(0.03),
        S.capsule([0, 0.03, 0.14], [0, -0.012, 0.18], 0.028, 0.012).color(beak).pbr(0.4).blend(0.015), S.box(0.3, 0.06, 0.3, 0.01).at(0, -0.04, 0.12).cut(0.004).color(mouth),
        ...S.mirrorX([S.sphere(0.014).at(0.05, 0.05, 0.02).color(turtleDk).pbr(0.6).blend(0.01), S.sphere(0.012).at(0.03, 0.06, 0.06).color(turtleDk).pbr(0.6).blend(0.01)])];
      headHard = [...H.mirrorX([eye(0.012, { iris: 0xc8a030, rim: 0x403010, white: 0xa08a40, pupilDeg: 22, irisDeg: 58, glow: 0.2, seg: 12 }).rot(-10, 70, 0).at(0.05, 0.03, 0.105)])];
      J = [0, -0.012, 0.02];
      jaw = [S.ellipsoid(0.06, 0.024, 0.08).at(0, -0.024, 0.08).color(turtleC).pbr(0.6).bump(0.006, 24, 'rock'), S.capsule([0, -0.02, 0.12], [0, -0.006, 0.168], 0.02, 0.01).color(beak).pbr(0.4).blend(0.012), S.ellipsoid(0.045, 0.01, 0.06).at(0, -0.008, 0.08).color(mouth).paint(0.004, 0)];
      jawHard = [];
    }
    nodes.push({ name: `h${k}`, parent: last, rig: 'heads', pos: [0, 0, tipZ], rot: [N.head, 0, 0], prims: head, hard: headHard, detail: 0.85, minRes: 30 });
    nodes.push({ name: `j${k}`, parent: `h${k}`, rig: 'jaws', pos: J, rot: [8, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 0.85, minRes: 30 });
  });
  return { kind: 'mangroveHydra', nodes };
}
function animHydra(model, ctx) {
  const rig = model?.userData?.rig; if (!rig) return;
  const t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  // the islet wallows; the snakes weave and strike in turn, the turtles crane and snap
  R(rig.body, Math.sin(t * 0.6 + phase) * 0.02, Math.sin(t * 0.25 + phase) * 0.04, Math.sin(t * 0.5 + phase + 1) * 0.02);
  P(rig.body, 0, Math.sin(t * 0.7 + phase) * 0.01, 0);
  HYDRA.forEach((N, k) => {
    const segs = rig[`neck${k}`] || [], snake = N.kind === 'snake', o = phase + k * 1.7;
    const c = frac(t * (snake ? 0.2 : 0.16) + o * 0.21), strike = pulse(c, 0.0, snake ? 0.2 : 0.16), coil = pulse(c, 0.8, 1.0), snap = pulse(c, snake ? 0.12 : 0.08, snake ? 0.22 : 0.18);
    segs.forEach((s, j) => {
      const f = j / Math.max(1, segs.length - 1);
      if (snake) R(s, coil * 0.25 * (j % 2 ? 1 : -0.6) - strike * (j ? 0.32 : -0.25) + Math.sin(t * 1.4 + o - j * 0.7) * 0.06, Math.sin(t * 1.1 + o - j * 0.8) * (0.12 + f * 0.1) * (1 - strike), 0);
      else R(s, -strike * 0.12 + Math.sin(t * 0.7 + o - j) * 0.04, Math.sin(t * 0.45 + o - j * 0.5) * 0.14, 0);
    });
    const h = rig.heads?.[k], jw = rig.jaws?.[k];
    if (h) R(h, strike * 0.2 + Math.sin(t * 1.3 + o) * 0.05, Math.sin(t * 0.9 + o) * 0.1, 0);
    if (jw) R(jw, (snake ? 0.05 : 0.03) + strike * (snake ? 0.9 : 0.6) - snap * (snake ? 0.85 : 0.6) + Math.max(0, Math.sin(t * 2 + o)) * 0.05);
  });
}

export const creatures = {
  nyamiNyami: (def) => rigged(def, nyamiDesc),
  vasukiLeviathan: (def) => rigged(def, vasukiDesc),
  cetusPrimeval: (def) => rigged(def, cetusDesc),
  mirageLeviathan: (def) => riggedWith(def, mirageDesc, finishMirage),
  wolfEel: (def) => rigged(def, wolfEelDesc),
  matriarchCaiman: (def) => rigged(def, caimanDesc),
  mangroveHydra: (def) => rigged(def, hydraDesc),
  zaratan: (def) => rigged(def, zaratanDesc),
  bahamut: (def) => rigged(def, bahamutDesc),
};
export const animators = {
  nyamiNyami: animNyami,
  vasukiLeviathan: animVasuki,
  cetusPrimeval: animCetus,
  mirageLeviathan: animMirage,
  wolfEel: animWolfEel,
  matriarchCaiman: animCaiman,
  mangroveHydra: animHydra,
  zaratan: animZaratan,
  bahamut: animBahamut,
};
