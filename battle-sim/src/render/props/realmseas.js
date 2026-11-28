// Realm seas: the great beasts the newer realms bring to war at sea, sculpted, rigged and animated in code.
//
//   creatures[def.model](def)            -> a rigged model (rigkit.cloneRigged of a cached template),
//                                           head toward +X, waterline at y = 0, sized by def.size
//   animators[kind](model, { t, phase }) -> poses model.userData.rig each frame (kind = the model key)
//
// Same conventions as seacreatures.js and ancientseas.js: every beast is authored facing +Z, mirrored across
// X = 0, in a normalised space where it fits a circle of radius ~1.3; the root node turns it to +X and
// assemble() scales it by def.size. They ride high so that backs, heads and the working parts break the
// surface and read from a high battle camera. The battle view sinks a beast that dives and rolls a dead one;
// the animators here swim, and every so often strike (each beast its own way).
// The small kit at the top is a copy of the private helpers of ancientseas.js and seacreatures.js.
import * as THREE from 'three';
import { S, H, noise3, distanceField } from '../sculpt.js';
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

// ---------- from seacreatures.js: fans, horns, barnacles, ribbons and bodies that follow a curve ----------
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

function barnacleGeo() {
  return cached('barnacle', () => new THREE.LatheGeometry([[1, -0.15], [0.96, 0.1], [0.72, 0.6], [0.46, 1.0], [0.36, 1.08], [0.27, 1.0], [0.2, 0.7]].map(([r, y]) => new THREE.Vector2(r, y)), 9));
}
function barnacle(r, p, n, col = 0xb9b29c) {
  return aim(H.geo(barnacleGeo()).shade((x, y, z) => (y > 0.75 && Math.hypot(x, z) < 0.36 ? 0x5a5446 : Math.sin(Math.atan2(z, x) * 9) > 0.3 ? mix(col, 0x7a705a, 0.5) : null)).scale(r, r * (0.8 + rnd(Math.round(r * 9973), 2) * 0.5), r), p, n).color(col).pbr(0.9);
}
/** an old harpoon stuck at p leaning along dir, with a ring and a length of line hanging toward `drop` */
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

// ---------- small extras ----------
/** a quaternion-free way to put a list of creature-space pieces on a node: copies of `into` for hard and prims */
const vnorm = (d) => { const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };
const vadd = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
/** a lumpy faceted crystal / ice / ember chunk: base at the origin, pointing +Y */
function shardGeo(seg = 5, kink = 0.3) {
  return cached(`shard:${seg}:${kink}`, () => {
    const rings = [];
    for (const [v, r] of [[0, 0.7], [0.15, 1], [0.7, 0.75 + kink * 0.2], [1, 0.02]]) { const ring = []; for (let k = 0; k < seg; k++) { const a = (k / seg) * PI * 2 + v * kink; ring.push([Math.cos(a) * r, v, Math.sin(a) * r]); } rings.push(ring); }
    const g = loft(rings, true, true).toNonIndexed(); g.computeVertexNormals(); return g;
  });
}
function shard(len, r, seg = 5, kink = 0.3) { return H.geo(shardGeo(seg, kink)).scale(r, len, r); }
/** a seam of glowing (or painted) capsules round the hull at z from th0 to th1 degrees */
function ring(K, z, th0, th1, r, make, step = 20) {
  const n = K.nodeOf(z);
  for (let th = th0; th < th1 - 1e-6; th += step) K.prims[n].push(make(S.capsule(K.skin(z, th).p, K.skin(z, Math.min(th1, th + step)).p, r)));
}
/** overlapping rows of scale plates over a carcass: o = { z0, z1, dz, th, dth, r, cols: [..], seed, raise, rough, metal } */
function scaleRows(K, o) {
  let row = 0;
  for (let z = o.z0; z > o.z1; z -= o.dz, row++) {
    const q = K.at(z), k = clamp(q.w / (o.wref || 0.25), 0.35, 1.2);
    for (let th = -o.th + (row % 2) * o.dth * 0.5; th <= o.th; th += o.dth) {
      const s = K.skin(z, th), i = row * 31 + Math.round(th);
      const a = Math.atan2(s.n[0], s.n[1]) / DEG;
      const col = o.cols[Math.floor(rnd(i, o.seed || 3) * o.cols.length) % o.cols.length];
      K.prims[K.nodeOf(z)].push(S.ellipsoid(o.r * k, o.r * 0.32 * k, o.r * 1.25 * k).rot(-8, 0, 0).rot(0, 0, -a).at(s.p[0], s.p[1], s.p[2]).color(col).pbr(o.rough ?? 0.4, o.metal ?? 0).paint(0.006, o.raise ?? 0.006));
    }
  }
}

// =====================================================================================
// BRASS LEVIATHAN (Kharnak): a sea-hound the size of a whale, plated in overlapping volcanic brass, furnace light
// in every seam, steam venting from its back, and a snout that splits four ways into snapping jaws
// =====================================================================================
const BRASS = { az: [0, -90, 180, 90], PL: 0.33, PR: 0.175, vents: [[0.13, 0.36], [-0.13, 0.36], [0.11, 0.08], [-0.11, 0.08]] };
function brassLeviathanDesc(def) {
  const brass = num(def.color, 0xb07a2a), brassLt = tone(brass, 0.012, 0.06, 0.12), brassDk = mix(tone(brass, -0.01, -0.06, -0.17), 0x2a1a0c, 0.3);
  const iron = 0x1c1a1c, ironLt = 0x4a4446, crimson = 0x9a1a22, crimsonDk = 0x4a0a10, fire = 0xff6a14, fireHot = 0xffb83a, mouth = 0x5a0c10, MET = 0.72, RO = 0.36;
  const CY = 0.07;
  const TAB = [
    { z: 1.02, w: 0.13, h: 0.12, y: CY + 0.06 }, { z: 0.95, w: 0.175, h: 0.165, y: CY + 0.065 }, { z: 0.83, w: 0.2, h: 0.19, y: CY + 0.075 }, { z: 0.7, w: 0.18, h: 0.18, y: CY + 0.07 },
    { z: 0.56, w: 0.23, h: 0.25, y: CY + 0.04 }, { z: 0.36, w: 0.3, h: 0.3, y: CY + 0.02 }, { z: 0.1, w: 0.31, h: 0.285, y: CY + 0.02 }, { z: -0.15, w: 0.26, h: 0.24, y: CY + 0.03 },
    { z: -0.4, w: 0.17, h: 0.16, y: CY + 0.05 }, { z: -0.64, w: 0.11, h: 0.11, y: CY + 0.06 }, { z: -0.88, w: 0.072, h: 0.072, y: CY + 0.07 }, { z: -1.08, w: 0.046, h: 0.046, y: CY + 0.075 }, { z: -1.22, w: 0.024, h: 0.024, y: CY + 0.08 },
  ];
  const sk = (p, part) => p.color(part === 'top' ? brassDk : part === 'bottom' ? mix(brass, crimsonDk, 0.55) : brass).pbr(RO, MET).bump(0.006, 15, 'scales').tint(0.1, 7);
  const K = carcass(TAB, [['head', 1.02, 0.7], ['neck0', 0.7, 0.5], ['body', 0.5, -0.3], ['tail0', -0.3, -0.55], ['tail1', -0.55, -0.79], ['tail2', -0.79, -1.01], ['tail3', -1.01, -1.22]], 'body', sk, { pivot: 0.15, core: brass, kOf: { body: 0.03 } });
  const { at, skin, prims, hard, ORG } = K;
  // a hound's skull: heavy brows, cheek muscle, a crest of black iron
  prims.head.push(
    ...S.mirrorX([sk(S.ellipsoid(0.07, 0.085, 0.12).at(0.13, CY + 0.06, 0.8).blend(0.05)), sk(S.capsule([0.07, CY + 0.2, 0.95], [0.13, CY + 0.23, 0.8], 0.035, 0.045).blend(0.05), 'top')]),
    sk(S.capsule([0, CY + 0.25, 0.93], [0, CY + 0.27, 0.72], 0.03, 0.05).blend(0.05), 'top').color(iron).pbr(0.45, 0.6),
  );
  const headHull = prims.head.slice();
  // shoulders and haunches the paddles work from; a crest of iron down the spine
  prims.body.push(...S.mirrorX([sk(S.ellipsoid(0.1, 0.12, 0.15).at(at(0.3).w - 0.06, CY - 0.06, 0.3).blend(0.07)), sk(S.ellipsoid(0.09, 0.1, 0.13).at(at(-0.18).w - 0.05, CY - 0.04, -0.18).blend(0.07))]));
  K.stripe(0.62, -1.15, 0, (z) => Math.max(0.012, at(z).w * 0.14), (p) => p.color(iron).pbr(0.42, 0.65).paint(0.01, 0.012), 0.1);
  // overlapping brass scales, the old ones burnt dark
  scaleRows(K, { z0: 0.66, z1: -1.12, dz: 0.075, th: 150, dth: 24, r: 0.052, wref: 0.28, seed: 5, cols: [brass, brassLt, brass, mix(brass, brassDk, 0.5)], rough: 0.34, metal: 0.7 });
  // furnace light in the seams between the bands of plate
  const seam = (p) => p.color(fire).pbr(0.5, 0).glow(1.1).paint(0.007, -0.004);
  for (const z of [0.47, 0.27, 0.05, -0.17, -0.38, -0.6, -0.82]) ring(K, z, -125, 125, 0.011 * clamp(at(z).w / 0.25, 0.5, 1.1), seam, 25);
  K.stripe(0.5, -0.95, 62, (z) => 0.009 * clamp(at(z).w / 0.25, 0.5, 1.1), seam, 0.1);
  K.belly((z) => at(z).y - at(z).h * 0.55, mix(crimsonDk, brassDk, 0.4), 0.03, 0.5, 0.4);
  ring(K, 0.62, -180, 180, 0.04, (p) => p.color(iron).pbr(0.4, 0.7).blend(0.02), 30);    // the black iron collar
  eyes(K, 'head', surfer(headHull), 0.875, CY + 0.15, 0.032, { iris: fireHot, rim: fire, white: fire, shape: 'slit', pupilDeg: 14, irisDeg: 62, rough: 0.2, glow: 1.2 }, { socket: 0x100808, yaw: 70, pitch: -10 });
  // horns and ears
  hard.head.push(...H.mirrorX([
    horn([[0.1, CY + 0.24, 0.82], [0.17, CY + 0.32, 0.74], [0.22, CY + 0.36, 0.62], [0.24, CY + 0.35, 0.5]], 0.04, 0.008, iron, ironLt).pbr(0.4, 0.6),
    ...place(fan([{ a: 20, len: 0.12 }, { a: 50, len: 0.2 }, { a: 78, len: 0.24 }, { a: 104, len: 0.18 }], crimsonDk, crimson, iron, { dip: 0.25, spineR: 0.008, cup: 0.04 }), 0, 0, -38, 0.15, CY + 0.15, 0.76),
  ]));
  // collar spikes
  for (let i = 0; i < 9; i++) { const th = -120 + i * 30, s = skin(0.62, th, 0.02); hard[K.nodeOf(0.62)].push(aim(spike(0.09, 0.022, 0.1, 6), s.p, vadd(s.n, [0, 0, -0.5])).color(iron).pbr(0.35, 0.7)); }
  // spines down the back and the tail, and a mace of spikes at its end
  for (let i = 0; i < 14; i++) {
    const z = 0.45 - i * 0.11, q = at(z), s = skin(z, 0, 0), L = 0.07 + 0.08 * Math.sin(clamp((0.5 - z) / 1.6, 0, 1) * PI) + (z < -0.5 ? 0.04 : 0);
    hard[K.nodeOf(z)].push(aim(spike(L, Math.max(0.012, q.w * 0.12), -0.3, 6), s.p, [0, 1, -0.55]).color(iron).pbr(0.35, 0.7));
    if (z < -0.35) for (const sd of [-1, 1]) { const f = skin(z - 0.05, sd * 85, 0); hard[K.nodeOf(z)].push(aim(spike(L * 0.7, Math.max(0.01, q.w * 0.1), -0.2, 5), f.p, vadd(f.n, [0, 0.2, -0.6])).color(iron).pbr(0.35, 0.7).lod(1)); }
  }
  const mz = -1.17, mq = at(mz);
  prims.tail3.push(S.sphere(0.06).at(0, mq.y, mz).color(iron).pbr(0.4, 0.7).bump(0.006, 20, 'rock').blend(0.03));
  for (let i = 0; i < 10; i++) { const a = i * 2.39996, e = Math.asin(1 - (2 * (i + 0.5)) / 10), d = [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a) * 0.8 - 0.4]; hard.tail3.push(aim(spike(0.09, 0.02, 0, 6), vadd([0, mq.y, mz], vnorm(d), 0.05), d).color(iron).pbr(0.35, 0.7)); }
  // steam vents: brass chimneys on the shoulders and back, glowing inside
  for (const [x, z] of BRASS.vents) {
    const s = skin(z, x > 0 ? 38 : -38, -0.01), d = vadd(s.n, [0, 1.4, -0.3]);
    hard[K.nodeOf(z)].push(aim(H.cyl(0.03, 0.04, 0.09, 10, true), vadd(s.p, vnorm(d), 0.03), d).color(ironLt).pbr(0.4, 0.8),
      aim(H.torus(0.032, 0.008, 12, 5), vadd(s.p, vnorm(d), 0.075), [vnorm(d)[2], 0, -vnorm(d)[0]]).color(iron).pbr(0.35, 0.8).lod(1),
      aim(H.cyl(0.026, 0.026, 0.012, 10), vadd(s.p, vnorm(d), 0.07), d).color(fireHot).glow(1.3));
  }

  // ---- the four-way maw: the snout is four jaws, each a quarter of it, hinged at the root and lined with fangs ----
  const { PL, PR } = BRASS, AX = [0, at(0.95).y, 0.93], tooth = 0xf0e0b8;
  hard.head.push(H.sphere(0.11, 16).scale(1, 1, 0.5).at(AX[0], AX[1], AX[2] - 0.07).color(fireHot).glow(1.4));       // the furnace in its throat
  prims.head.push(S.box(1, 1, 0.5).at(0, 0, AX[2] + 0.26).cut(0.012).color(crimson), S.sphere(0.13).at(AX[0], AX[1], AX[2] - 0.01).cut(0.012).color(crimsonDk).glow(0.3));
  const petal = (i) => {
    const r = (z) => lerp(PR, 0.03, clamp(z / PL, 0, 1) ** 1.3);
    const pp = [
      sk(S.capsule([0, 0, -0.01], [0, 0.005, PL], PR, 0.026)),
      sk(S.ellipsoid(0.07, 0.045, 0.13).at(0, PR * 0.82, 0.1).blend(0.05), 'top'),
      S.capsule([0, -0.005, -0.06], [0, 0, PL - 0.05], PR - 0.032, 0.008).cut(0.01).color(crimson),
      ...[-1, 1].map((sd) => S.box(1, 1, 1.6, 0.002).rot(0, 0, -sd * 45).at(sd * 0.5 * Math.SQRT1_2 + sd * 0.008, -0.5 * Math.SQRT1_2 - 0.008, 0.3).cut(0.004).color(fire).glow(0.7)),
      S.box(1, 1, 1, 0.002).at(0, 0, -0.52).cut(0.004).color(crimsonDk),
      S.capsule([0, r(0.05) * 0.92, 0.06], [0, r(PL * 0.8) * 0.9, PL * 0.8], 0.012).color(iron).pbr(0.4, 0.6).paint(0.006, 0.006),
    ];
    // a few plates on each jaw, and a glowing seam across its root
    for (let k = 0; k < 4; k++) for (const sd of [-1, 0, 1]) { const z = 0.05 + k * 0.08, a = sd * 26 * DEG, rr = r(z); pp.push(S.ellipsoid(0.04 * (1 - k * 0.15), 0.014, 0.05).rot(0, 0, -sd * 26).at(Math.sin(a) * rr, Math.cos(a) * rr, z).color(k % 2 ? brassLt : brass).pbr(0.32, 0.8).paint(0.006, 0.005)); }
    pp.push(S.torus(PR - 0.002, 0.008).rot(90, 0, 0).at(0, 0, 0.03).color(fire).glow(1.0).paint(0.006, -0.003));
    const hd = [];
    for (let k = 0; k < 6; k++) for (const sd of [-1, 1]) {
      const z = 0.04 + k * 0.058, rr = r(z) * 0.86, a = sd * 43 * DEG, p = [Math.sin(a) * rr, Math.cos(a) * rr, z];
      hd.push(aim(spike(0.05 + (k === 5 ? 0.03 : 0) - k * 0.002, 0.012, 0.25, 5), p, [-Math.sin(a) * 0.8 + sd * 0.35, -Math.cos(a), 0.35]).color(mix(tooth, 0x8a6a3a, rnd(i * 9 + k, sd + 3) * 0.4)).pbr(0.3).lod(k > 3 ? 1 : 0));
    }
    hd.push(aim(spike(0.07, 0.02, 0.5, 6), [0, r(PL - 0.04) * 0.4, PL - 0.03], [0, -0.6, 1]).color(iron).pbr(0.35, 0.7));   // a hooked iron tip
    const hinge = [0, PR - 0.02, 0];
    return { prims: into(hinge, pp), hard: into(hinge, hd), hinge };
  };

  // ---- paddles: broad webbed limbs with iron claws ----
  const paddle = (sd, sp) => {
    const out = [fin({ span: sp, chord: sp * 0.5, peak: 0.45, root: 0.6, tip: 0.55, pw: 1.4, sweep: 0.32, thick: 0.14, rows: 9 }).shade(flipShade(brassDk, crimsonDk, iron, sp, sd)).pbr(0.4, 0.6)];
    for (let k = 0; k < 3; k++) out.push(spike(0.07, 0.014, 0.6, 5).rot(0, 0, 0).at(0, sp * 0.97, sp * 0.5 * 0.2 - k * sp * 0.13 - sp * 0.03).color(iron).pbr(0.35, 0.7));
    return out;
  };
  const nodes = K.nodes({ detail: { default: 0.36, head: 0.5, neck0: 0.42, body: 0.34 }, minRes: { tail3: 30 } });
  BRASS.az.forEach((az, i) => {
    const AX = [0, at(0.95).y, 0.93], pt = petal(i), c = Math.cos(az * DEG), s = Math.sin(az * DEG), hw = [AX[0] - pt.hinge[1] * s, AX[1] + pt.hinge[1] * c, AX[2]];
    nodes.push({ name: `maw${i}`, parent: 'head', pos: sub(hw, ORG.head), rot: [0, 0, az] });
    nodes.push({ name: `jaw${i}`, parent: `maw${i}`, rig: 'jaws', pos: [0, 0, 0], prims: pt.prims, hard: pt.hard, detail: 0.5, minRes: 40 });
  });
  const fx = at(0.3).w - 0.04, rx = at(-0.18).w - 0.04;
  nodes.push(
    finNode(K, 'finFL', 'body', [fx, CY - 0.12, 0.32], [-10, -18, -100], paddle(1, 0.42)), finNode(K, 'finFR', 'body', [-fx, CY - 0.12, 0.32], [-10, 18, 100], paddle(-1, 0.42)),
    finNode(K, 'finRL', 'body', [rx, CY - 0.1, -0.17], [-10, -30, -100], paddle(1, 0.34)), finNode(K, 'finRR', 'body', [-rx, CY - 0.1, -0.17], [-10, 30, 100], paddle(-1, 0.34)),
  );
  // the steam: a few puffs over each vent, lifted and swollen by the animator
  BRASS.vents.forEach(([x, z], i) => {
    const s = skin(z, x > 0 ? 38 : -38, -0.01), d = vnorm(vadd(s.n, [0, 1.4, -0.3])), o = vadd(s.p, d, 0.1);
    const puff = [[0, 0.02, 0, 0.04], [0.03, 0.05, -0.02, 0.034], [-0.03, 0.06, -0.01, 0.032], [0.005, 0.09, -0.04, 0.04], [0.02, 0.12, -0.07, 0.03], [-0.02, 0.11, -0.06, 0.028]]
      .map(([px, py, pz, r], k) => H.sphere(r * 0.8, 9).scale(1.2, 0.85, 1.2).at(px, py, pz).color(mix(0xd4d0ca, 0xf2f0ec, k / 5)).pbr(0.95));
    nodes.push({ name: `steam${i}`, parent: K.nodeOf(z), rig: 'steam', pos: sub(o, ORG[K.nodeOf(z)]), hard: puff });
  });
  return { kind: 'brassLeviathan', nodes };
}
function animBrassLeviathan(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 2.0 + phase;
  // the lunge: head thrown forward and up, the four jaws flower open round the furnace, then slam shut
  const c = frac(t * 0.15 + phase * 0.17), lunge = pulse(c, 0.0, 0.38), open = pulse(c, 0.02, 0.3), snap = pulse(c, 0.24, 0.36);
  R(rig.body, Math.sin(w * 2) * 0.012 - lunge * 0.06, Math.sin(t * 0.5 + phase) * 0.03, Math.sin(w) * 0.03);
  P(rig.body, 0, Math.sin(w * 2 + 0.6) * 0.012 + lunge * 0.04, lunge * 0.06);
  (rig.necks || []).forEach((n) => R(n, -lunge * 0.14 + Math.sin(w * 0.5) * 0.03, Math.sin(t * 0.7 + phase) * 0.08 * (1 - lunge), 0));
  R(rig.head, -lunge * 0.12 + snap * 0.08 + Math.sin(t * 0.9 + phase) * 0.02, Math.sin(t * 0.6 + phase * 2) * 0.05 * (1 - lunge), 0);
  const idle = Math.max(0, Math.sin(t * 1.3 + phase)) * 0.08;
  (rig.jaws || []).forEach((n, i) => R(n, -(idle + open * (i === 2 ? 0.75 : 0.95) - snap * 0.3 + Math.sin(t * 9 + i * 1.7) * 0.02 * open)));
  (rig.tail || []).forEach((n, i) => R(n, Math.sin(w * 2 - i * 0.6) * 0.03, Math.sin(w * 0.5 - i * 0.7) * (0.06 + i * 0.05) + lunge * Math.sin(t * 6 - i) * 0.05, 0));
  fly4(rig, w, 0.9, 0.05 + lunge * 0.12);
  (rig.steam || []).forEach((n, i) => {
    const s = frac(t * 0.45 + i * 0.29 + phase * 0.1), k = 0.25 + Math.sin(s * PI) * 1.2;
    P(n, 0, s * 0.16, -s * 0.05); n.scale.setScalar(k);
  });
}
/** underwater flight on four flippers: the front pair leads, the hind pair follows a quarter-beat behind */
function fly4(rig, w, amp, lift = 0) {
  (rig.fins || []).forEach((n, i) => { const sg = i % 2 ? -1 : 1, k = w - (i > 1 ? 1.7 : 0); R(n, Math.cos(k) * 0.3 * amp, 0, sg * (Math.sin(k) * 0.42 * amp + lift)); });
}


// =====================================================================================
// SERPENT KIT: long bodies of rigid segments laid along a swimming curve (after the sea serpent of seacreatures.js)
// =====================================================================================
/**
 * A path on the water, integrated once from a turning rate: kappa(p) radians per unit of length, starting at
 * (x0, z0) heading down -Z. Returns { step, n, xs, zs } for lookups with pathAt.
 */
function bakePath(len, kappa, x0 = 0, z0 = 0, step = 0.01) {
  const n = Math.ceil((len + 1) / step), xs = new Float32Array(n), zs = new Float32Array(n);
  let x = x0, z = z0, psi = 0;
  for (let i = 0; i < n; i++) { xs[i] = x; zs[i] = z; psi += kappa(i * step) * step; x += Math.sin(psi) * step; z -= Math.cos(psi) * step; }
  return { step, n, xs, zs };
}
function pathAt(B, p, o) {
  const f = clamp(p / B.step, 0, B.n - 1.001), i = Math.floor(f), k = f - i;
  o[0] = lerp(B.xs[i], B.xs[i + 1], k); o[2] = lerp(B.zs[i], B.zs[i + 1], k);
  return o;
}
/**
 * The body: o = { Ls, TAB (straight space: z = 0 at the head joint, falling toward the tail), sk(prim, part),
 * curve(p, t, phase, out), lay, deco(i, z0, z1, prims, hard), detail (number or fn(i)), minRes, k, core }
 */
function serpentSegs(o) {
  const lay = layChain((p, out) => o.curve(p, 0, 0, out), o.Ls, o.lay);
  const nodes = [];
  let z0 = 0;
  o.Ls.forEach((L, i) => {
    const z1 = z0 - L, prims = hull(span(o.TAB, z0, z1), o.sk, o.k ?? 0.02), hard = [];
    if (o.core != null) {
      const rings = span(o.TAB, z0 + 0.01, z1 - 0.01).map((q) => { const r = []; for (let j = 0; j < 6; j++) { const a = (j / 6) * PI * 2; r.push([Math.cos(a) * q.w * 0.72, q.y + Math.sin(a) * q.h * 0.72, q.z]); } return r; });
      hard.push(H.geo(loft(rings)).color(o.core).pbr(0.4));
    }
    o.deco?.(i, z0, z1, prims, hard);
    nodes.push({ name: `seg${i}`, parent: i ? `seg${i - 1}` : 'root', rig: 'segs', pos: i ? [0, 0, -o.Ls[i - 1]] : lay.pos.slice(), rot: eulerDeg(lay.quats[i]),
      prims: into([0, 0, z0], prims), hard: into([0, 0, z0], hard), detail: typeof o.detail === 'function' ? o.detail(i) : o.detail ?? 0.5, minRes: o.minRes });
    z0 = z1;
  });
  return nodes;
}
const sumLs = (Ls) => Ls.reduce((a, b) => a + b, 0);
/** a head carried at the front joint of a serpent: it follows the line of the neck, lifted and turned by (pitch, yaw) */
function carryHead(rig, lay, pitch, yaw, follow = 0.3) {
  if (!rig.head) return;
  rig.head.position.set(lay.pos[0], lay.pos[1], lay.pos[2]);
  _eu.set(pitch, yaw, 0, 'YXZ');
  rig.head.quaternion.copy(lay.abs[0]).slerp(_hq.identity(), follow).multiply(_q.setFromEuler(_eu));
}
const _hq = new THREE.Quaternion();

// =====================================================================================
// ABYSSAL OUROBOROS (Ash-Hordes): a colossal black sea-serpent lying in a coil, ringed with eight fins that burn
// red with carved runes, its horned head reared over the coil
// =====================================================================================
const OURO = { Ls: [0.2, 0.22, 0.24, 0.26, 0.27, 0.28, 0.28, 0.28, 0.28, 0.27, 0.26, 0.25, 0.23, 0.21, 0.19], fins: [2, 3, 5, 6, 8, 9, 11, 12], path: null };
OURO.n = OURO.Ls.length; OURO.len = sumLs(OURO.Ls); OURO.lay = newLay(OURO.n);
function ouroPath() {
  if (OURO.path) return OURO.path;
  // the neck runs back from the head and swings left, then the body wraps round to the right in a tightening coil
  const k = (p) => (p < 0.3 ? 0 : p < 0.62 ? -4.6 : 1 / lerp(0.6, 0.34, clamp((p - 0.62) / 3.2, 0, 1)));
  const B = bakePath(OURO.len, k);
  let mx = Infinity, Mx = -Infinity, mz = Infinity, Mz = -Infinity;
  for (let i = 0; i < B.n; i++) { if (i * B.step > OURO.len) break; mx = Math.min(mx, B.xs[i]); Mx = Math.max(Mx, B.xs[i]); mz = Math.min(mz, B.zs[i]); Mz = Math.max(Mz, B.zs[i]); }
  const cx = (mx + Mx) / 2, dz = 1.0 - Mz;
  for (let i = 0; i < B.n; i++) { B.xs[i] -= cx * 0.6; B.zs[i] += dz; }
  OURO.path = B;
  return B;
}
function ouroCurve(p, t, phase, o) {
  pathAt(ouroPath(), p, o);
  const body = smooth((p - 0.45) / 0.5), tip = smooth((p - (OURO.len - 0.6)) / 0.6);
  o[0] += Math.sin(p * 3.1 - t * 1.1 - phase) * 0.025 * body;
  o[1] = 0.44 * (1 - smooth(p / 0.7)) + Math.sin(t * 0.9 + phase) * 0.02 * (1 - body) + body * (0.05 * Math.sin(p * 4.3 - t * 1.7 - phase * 1.3) + 0.045) + tip * 0.03;
}
function abyssalOuroborosDesc(def) {
  const black = num(def.color, 0x1a1a24), scale = mix(black, 0x2a2438, 0.5), sheen = mix(black, 0x5a3a6a, 0.35), belly = 0x3a2a2a, ember = 0xd81e10, emberHot = 0xff7a2a, bone = 0x2a2226, boneLt = 0x6a5a50, mouth = 0x6a0e14, tooth = 0xe8dcc0;
  const sk = (p, part) => (part === 'bottom' ? p.color(belly).pbr(0.5).bump(0.005, 14, 'ridges').tint(0.1, 20) : p.color(part === 'top' ? black : scale).pbr(0.3, 0.25).bump(0.006, 30, 'scales').tint(0.22, 10));
  const TAB = [{ z: 0.03, w: 0.075, h: 0.08, y: 0 }, { z: -0.3, w: 0.088, h: 0.094, y: 0 }, { z: -0.9, w: 0.112, h: 0.118, y: 0 }, { z: -1.8, w: 0.118, h: 0.122, y: 0 }, { z: -2.8, w: 0.096, h: 0.1, y: 0 }, { z: -3.4, w: 0.06, h: 0.064, y: 0 }, { z: -OURO.len, w: 0.02, h: 0.022, y: 0 }];
  const at = (z) => station(TAB, z);
  // a burning rune carved into a fin: angular strokes in a band across the web
  const runeFin = (H0, seed) => {
    const sp = [{ a: -40, len: H0 * 0.55 }, { a: -14, len: H0 * 0.85 }, { a: 12, len: H0 }, { a: 38, len: H0 * 0.92 }, { a: 62, len: H0 * 0.7 }, { a: 84, len: H0 * 0.42 }];
    const f = fan(sp, 0x5a0606, ember, bone, { dip: 0.2, spineR: 0.008, tipCol: boneLt });
    f[0].shade((x, y, z) => {
      const r = Math.hypot(y, z), a = Math.atan2(-z, y) / DEG, v = r / H0;
      const cell = Math.floor((a + 60) / 16), ac = -60 + cell * 16 + 8, h = rnd(cell, seed);
      let lit = v > 0.32 && v < 0.74 && (Math.abs(a - ac) < 1.6 || Math.abs(v - 0.53 - (a - ac) * (h > 0.5 ? 0.02 : -0.02)) < 0.035 || (h > 0.3 && Math.abs(v - (h > 0.65 ? 0.38 : 0.68)) < 0.03 && Math.abs(a - ac) < 5));
      return lit ? emberHot : mix(mix(0x3a0404, ember, clamp(v * 1.3, 0, 1)), 0x1a0204, Math.sin(a * 2.4) > 0.8 ? 0.4 : 0);
    }).glow(0.75);
    return f;
  };
  const nodes = [ROOT, ...serpentSegs({ Ls: OURO.Ls, TAB, sk, curve: ouroCurve, lay: OURO.lay, detail: 0.4, minRes: 26, core: scale,
    deco: (i, z0, z1, p, hard) => {
      const L = z0 - z1, mid = at((z0 + z1) / 2), zm = (z0 + z1) / 2;
      // a low crest of black bone, a ring of ember-red runes at each joint, a dull red belly
      p.push(sk(S.capsule([0, mid.h * 0.92, z0 - L * 0.1], [0, mid.h * 0.92, z1 + L * 0.1], 0.018, 0.018).blend(0.03), 'top'));
      for (let k = 0; k < 2; k++) { const z = z0 - L * (0.25 + k * 0.5); p.push(S.torus(at(z).w * 0.99, 0.006).rot(90, 0, 0).scale(1, at(z).h / at(z).w, 1).at(0, 0, z).color(k ? sheen : ember).glow(k ? 0 : 0.7).paint(0.005, -0.002)); }
      for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) { const z = lerp(z0, z1, (k + 0.5) / 5), q = at(z), a = sd * (40 + rnd(i * 5 + k, 3) * 40) * DEG; p.push(S.ellipsoid(0.02, 0.01, 0.03).rot(0, 0, -a / DEG).at(Math.sin(a) * q.w, Math.cos(a) * q.h, z).color(sheen).pbr(0.25, 0.4).paint(0.005, 0.003)); }
      p.push(under(z0 + 0.06, -mid.h * 0.45, z1 - 0.06, -at(z1).h * 0.45, belly, 0.02, 0.5));
      const fi = OURO.fins.indexOf(i);
      if (fi >= 0) hard.push(...place(runeFin(0.2 + (fi < 4 ? 0.03 : 0) - fi * 0.006, fi * 7 + 1), 0, 0, 0, 0, mid.h - 0.02, zm + L * 0.2));
      else if (i < OURO.n - 2) for (let k = 0; k < 2; k++) hard.push(aim(spike(0.06, 0.014, -0.3, 5), [0, mid.h + 0.005, z0 - L * (0.3 + k * 0.4)], [0, 1, -0.6]).color(bone).pbr(0.35).lod(1));
      if (i === OURO.n - 1) hard.push(...place(fan([{ a: 40, len: 0.08 }, { a: 70, len: 0.16 }, { a: 96, len: 0.2 }, { a: 122, len: 0.16 }, { a: 150, len: 0.07 }], 0x5a0606, ember, bone, { dip: 0.2 }), 0, 0, 0, 0, 0, z0 - L * 0.2));
    } }),
  ];
  // ---- the head: a long horned skull, burning eyes, hooked fangs ----
  const HT = [{ z: 0.46, w: 0.022, h: 0.02, y: -0.02 }, { z: 0.42, w: 0.045, h: 0.036, y: -0.016 }, { z: 0.32, w: 0.066, h: 0.052, y: -0.01 }, { z: 0.2, w: 0.09, h: 0.07, y: 0 }, { z: 0.08, w: 0.105, h: 0.088, y: 0.006 }, { z: -0.04, w: 0.08, h: 0.084, y: 0 }];
  const mY = (z) => lerp(-0.034, -0.026, (z - 0.06) / 0.4);
  const skull = [
    ...hull(HT, sk),
    ...S.mirrorX([sk(S.ellipsoid(0.035, 0.05, 0.08).at(0.09, -0.005, 0.07).blend(0.04)), sk(S.capsule([0.035, 0.07, 0.3], [0.075, 0.095, 0.12], 0.02, 0.034).blend(0.03), 'top')]),
    sk(S.capsule([0, 0.06, 0.38], [0, 0.095, 0.1], 0.02, 0.036).blend(0.035), 'top'),
  ];
  const head = [...skull, under(0.5, -0.05, -0.06, -0.06, belly, 0.02, 0.5),
    slab(0.56, mY(0.56), 0.06, mY(0.06), -1, 0, 0.5).cut(0.006).color(mouth), S.ellipsoid(0.04, 0.024, 0.15).at(0, -0.026, 0.26).cut(0.016).color(tone(mouth, 0, 0, -0.06))];
  const sfS = surfer(skull), eyeP = sfS([0.3, 0.04, 0.24], [-1, 0, 0]);
  head.push(...S.mirrorX([S.sphere(0.024).at(eyeP[0] - 0.004, eyeP[1], eyeP[2]).cut(0.007).color(0x100608), S.capsule([0.05, 0.03, 0.2], [0.09, 0.0, 0.05], 0.006).color(ember).glow(0.8).paint(0.005, -0.003)]));
  const hornAt = (x, y, z, pts, r0, r1) => horn(pts.map((q) => [x + q[0], y + q[1], z + q[2]]), r0, r1, bone, boneLt);
  const headHard = [
    ...H.mirrorX([
      eye(0.02, { iris: emberHot, rim: ember, white: ember, shape: 'slit', pupilDeg: 12, irisDeg: 62, rough: 0.1, glow: 1.3 }).rot(-6, 64, 0).at(eyeP[0] - 0.012, eyeP[1], eyeP[2]),
      hornAt(0.07, 0.09, 0.12, [[0, 0, 0], [0.03, 0.05, -0.08], [0.06, 0.1, -0.18], [0.07, 0.17, -0.27], [0.05, 0.25, -0.31]], 0.03, 0.006),
      hornAt(0.095, 0.03, 0.03, [[0, 0, 0], [0.04, 0.02, -0.06], [0.07, 0.03, -0.13], [0.08, 0.06, -0.19]], 0.02, 0.004),
      hornAt(0.09, -0.03, 0.04, [[0, 0, 0], [0.035, -0.02, -0.05], [0.055, -0.02, -0.11]], 0.014, 0.003).lod(1),
    ]),
    spike(0.06, 0.014, 0.35, 6).rot(-22, 0, 0).at(0, 0.055, 0.4).color(bone).pbr(0.35),
  ];
  const lipX = (z, dy) => sfS([0.3, mY(z) + dy, z], [-1, 0, 0])[0] - 0.008;
  const fang = (hard, x, z, len, up, r = 0.0065) => hard.push(spike(len, r, 0.3, 5).rot(up > 0 ? 180 : 0, 0, 0).rot(up > 0 ? -6 : 6, 0, 0).at(x, mY(z) + up * 0.005, z).color(tooth).pbr(0.2).lod(1));
  for (let i = 0; i < 9; i++) for (const sd of [-1, 1]) fang(headHard, sd * lipX(0.12 + i * 0.034, 0.012), 0.12 + i * 0.034, 0.022 + (i === 7 ? 0.04 : 0), 1, i === 7 ? 0.01 : 0.0065);
  const J = [0, mY(0.06), 0.06];
  const jaw = [...hull(span(HT.map((q) => ({ ...q, w: q.w * 0.96 })), 0.43, 0.0), sk), under(0.5, -0.045, -0.06, -0.05, belly, 0.02, 0.5),
    slab(0.56, mY(0.56), -0.02, mY(-0.02), 1, 0, 0.5).cut(0.006).color(mouth), S.box(0.4, 0.4, 0.2, 0.01).at(0, 0, -0.06).cut(0.01).color(mouth)];
  const jawHard = [];
  for (let i = 0; i < 8; i++) for (const sd of [-1, 1]) fang(jawHard, sd * (lipX(0.11 + i * 0.034, -0.012) - 0.004), 0.11 + i * 0.034, 0.02 + (i === 6 ? 0.034 : 0), -1, i === 6 ? 0.009 : 0.006);
  jawHard.push(spike(0.05, 0.012, 0.3, 5).rot(160, 0, 0).at(0, -0.08, 0.28).color(bone).pbr(0.35));
  const lay = layChain((p, o) => ouroCurve(p, 0, 0, o), OURO.Ls, OURO.lay);
  nodes.push(
    { name: 'head', parent: 'root', rig: 'head', pos: lay.pos.slice(), rot: eulerDeg(_q.copy(lay.abs[0]).slerp(_hq.identity(), 0.3).multiply(_qp.setFromEuler(_eu.set(-0.1, 0, 0, 'YXZ')))), prims: head, hard: headHard, detail: 0.8 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: J, rot: [12, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 0.8 },
  );
  return { kind: 'abyssalOuroboros', nodes };
}
function animAbyssalOuroboros(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const lay = layChain((p, o) => ouroCurve(p, t, phase, o), OURO.Ls, OURO.lay);
  poseChain(rig.segs, lay);
  // it draws its head back over the coil, then strikes down and forward
  const c = frac(t * 0.15 + phase * 0.19), coil = pulse(c, 0.0, 0.25), strike = pulse(c, 0.18, 0.42), snap = pulse(c, 0.34, 0.44);
  carryHead(rig, lay, -0.1 - coil * 0.35 + strike * 0.3 + Math.sin(t * 1.2 + phase) * 0.04, Math.sin(t * 0.7 + phase * 2) * 0.18 * (1 - strike));
  if (rig.head) rig.head.position.z += strike * 0.12 - coil * 0.05;
  R(rig.jaw, Math.sin(t * 1.7 + phase) * 0.05 + coil * 0.2 + strike * 0.55 - snap * 0.6);
}


// =====================================================================================
// BALOR-MAW (Balor): a colossal abyssal eel crusted with barnacles, one great eye in its brow that burns yellow
// and, when it opens wide, throws a beam of light that sets ships afire
// =====================================================================================
const BALOR = { Ls: [0.2, 0.21, 0.22, 0.23, 0.23, 0.23, 0.23, 0.22, 0.21, 0.2, 0.19, 0.17], ER: 0.085 };
BALOR.n = BALOR.Ls.length; BALOR.len = sumLs(BALOR.Ls); BALOR.lay = newLay(BALOR.n);
function balorCurve(p, t, phase, o) {
  const u = clamp(p / BALOR.len, 0, 1.1), w = p * 2.9 - t * 2.4 - phase;
  o[0] = Math.sin(w) * (0.05 + 0.2 * Math.pow(u, 1.1));
  o[1] = 0.075 + 0.16 * Math.exp(-Math.max(0, p) * 2.4) + Math.sin(p * 2.6 - t * 1.6 - phase * 0.7) * 0.03 * clamp(p * 2, 0, 1);
  o[2] = 1.0 - p * 0.92;
}
function balorMawDesc(def) {
  const base = num(def.color, 0x3a4a3a), skin = tone(base, 0.0, 0.02, 0.02), back = mix(tone(base, 0.01, 0.0, -0.07), 0x141a16, 0.3), belly = 0x8a9278, crust = 0x8e8a74, crustDk = 0x56544a;
  const gold = 0xffd23a, goldHot = 0xfff0a0, mouth = 0x5a1a20, tooth = 0xe8e0c8, wet = 0.32;
  const sk = (p, part) => p.color(part === 'top' ? back : part === 'bottom' ? mix(skin, belly, 0.6) : skin).pbr(wet).bump(0.004, 26).tint(0.2, 9);
  const TAB = [{ z: 0.03, w: 0.1, h: 0.11, y: 0 }, { z: -0.25, w: 0.11, h: 0.125, y: 0 }, { z: -0.9, w: 0.118, h: 0.13, y: 0 }, { z: -1.7, w: 0.096, h: 0.11, y: 0 }, { z: -2.25, w: 0.06, h: 0.08, y: 0 }, { z: -BALOR.len, w: 0.018, h: 0.03, y: 0 }];
  const at = (z) => station(TAB, z);
  const crustPatch = (p, i, z0, z1, n) => {
    for (let k = 0; k < n; k++) { const z = lerp(z0, z1, rnd(i * 13 + k, 1)), q = at(z), a = (rnd(i * 13 + k, 2) - 0.5) * 2.2, r = 0.02 + rnd(i * 13 + k, 3) * 0.035; p.push(S.ellipsoid(r * 1.4, r, r * 1.6).rot(0, 0, -a / DEG).at(Math.sin(a) * q.w, q.y + Math.cos(a) * q.h, z).color(mix(crust, crustDk, rnd(i * 13 + k, 4))).pbr(0.9).bump(0.004, 40, 'rock').paint(0.008, 0.006)); }
  };
  const barnacles = (hard, i, z0, z1, n, lod = 1) => {
    for (let k = 0; k < n; k++) { const z = lerp(z0, z1, rnd(i * 17 + k, 5)), q = at(z), a = (rnd(i * 17 + k, 6) - 0.5) * 2.4, nrm = [Math.sin(a) / q.w, Math.cos(a) / q.h, 0], r = 0.012 + rnd(i * 17 + k, 7) * 0.016;
      hard.push(barnacle(r, [Math.sin(a) * q.w * 0.97, q.y + Math.cos(a) * q.h * 0.97, z], vnorm(nrm), mix(crust, 0xd8d0b8, rnd(i, k))).lod(k % 3 ? lod : 2)); }
  };
  const nodes = [ROOT, ...serpentSegs({ Ls: BALOR.Ls, TAB, sk, curve: balorCurve, lay: BALOR.lay, detail: 0.42, minRes: 26, core: skin,
    deco: (i, z0, z1, p, hard) => {
      const L = z0 - z1, mid = at((z0 + z1) / 2);
      p.push(under(z0 + 0.05, -mid.h * 0.4, z1 - 0.05, -at(z1).h * 0.4, belly, 0.025, wet));
      crustPatch(p, i, z0, z1, 7);
      if (i < BALOR.n - 1) barnacles(hard, i, z0 - 0.02, z1 + 0.02, i < 7 ? 6 : 3);
      // a ragged ribbon of fin down the back and under the tail
      hard.push(finStrip(z0 + 0.01, z1 - 0.01, (z) => at(z).h - 0.02, (z) => at(z).h + 0.05 * smooth((0.5 - z) / 0.8) * (1 + 0.25 * Math.sin(z * 40)), back, 0x6a7a5a, { amp: 0.006 }).pbr(0.45));
      if (i > 5) hard.push(finStrip(z0 + 0.01, z1 - 0.01, (z) => -at(z).h + 0.02, (z) => -at(z).h - 0.04 * smooth((-1.4 - z) / 0.5), back, 0x6a7a5a, { amp: 0.006 }).pbr(0.45));
      void L;
    } }),
  ];
  // ---- the head: a blunt, heavy skull, a single eye under a ridge of crust, a wide maw of needles ----
  const HT = [{ z: 0.42, w: 0.05, h: 0.04, y: -0.012 }, { z: 0.38, w: 0.09, h: 0.07, y: -0.008 }, { z: 0.28, w: 0.13, h: 0.1, y: 0 }, { z: 0.15, w: 0.145, h: 0.118, y: 0.006 }, { z: 0.03, w: 0.12, h: 0.115, y: 0 }, { z: -0.06, w: 0.1, h: 0.11, y: 0 }];
  const mY = (z) => lerp(-0.045, -0.02, (z - 0.05) / 0.37);
  const EC = [0, 0.1, 0.27], ER = BALOR.ER;
  const skull = [...hull(HT, sk), sk(S.ellipsoid(0.1, 0.07, 0.1).at(0, 0.075, 0.24).blend(0.06), 'top'), ...S.mirrorX([sk(S.ellipsoid(0.05, 0.06, 0.09).at(0.11, -0.01, 0.08).blend(0.05))])];
  const head = [...skull, under(0.5, -0.06, -0.08, -0.08, belly, 0.02, wet),
    slab(0.5, mY(0.5), 0.05, mY(0.05), -1, 0, 0.5).cut(0.006).color(mouth), S.ellipsoid(0.07, 0.03, 0.15).at(0, mY(0.22) + 0.01, 0.22).cut(0.016).color(tone(mouth, 0, 0, -0.08)),
    S.sphere(ER * 1.12).at(EC[0], EC[1], EC[2]).cut(0.01).color(0x0c0c08)];
  crustPatch(head, 99, 0.36, -0.04, 12);
  // the brow over the eye: a thick ridge of crust and barnacles
  head.push(sk(S.capsule([-0.075, EC[1] + 0.05, EC[2] - 0.02], [0.075, EC[1] + 0.05, EC[2] - 0.02], 0.03).blend(0.03), 'top').color(crustDk).bump(0.006, 30, 'rock'));
  const headHard = [eye(ER, { iris: gold, rim: 0xb86a10, white: 0xffe680, shape: 'slit', pupilDeg: 13, irisDeg: 64, rough: 0.08, glow: 1.5, seg: 22 }).rot(-35, 0, 0).at(EC[0], EC[1] + 0.006, EC[2] + 0.01)];
  barnacles(headHard, 98, 0.3, -0.04, 10, 1);
  const sfS = surfer(skull);
  const lipX = (z, dy) => sfS([0.4, mY(z) + dy, z], [-1, 0, 0])[0] - 0.01;
  const fang = (hard, x, z, len, up, r = 0.006) => hard.push(spike(len, r, 0.3, 5).rot(up > 0 ? 180 : 0, 0, 0).rot(up > 0 ? -10 : 10, 0, 0).at(x, mY(z) + up * 0.005, z).color(tooth).pbr(0.2).lod(1));
  for (let i = 0; i < 10; i++) for (const sd of [-1, 1]) fang(headHard, sd * lipX(0.08 + i * 0.033, 0.012), 0.08 + i * 0.033, 0.03 + (i % 3 === 0 ? 0.018 : 0), 1);
  const J = [0, mY(0.05), 0.05];
  const jaw = [...hull(span(HT.map((q) => ({ ...q, w: q.w * 0.97 })), 0.4, -0.02), sk), sk(S.ellipsoid(0.08, 0.04, 0.13).at(0, -0.09, 0.18).blend(0.04), 'bottom'), under(0.5, -0.05, -0.08, -0.07, belly, 0.02, wet),
    slab(0.5, mY(0.5), -0.03, mY(-0.03), 1, 0, 0.5).cut(0.006).color(mouth), S.box(0.4, 0.4, 0.2, 0.01).at(0, 0, -0.08).cut(0.01).color(mouth)];
  crustPatch(jaw, 97, 0.36, 0.0, 5);
  const jawHard = [];
  for (let i = 0; i < 9; i++) for (const sd of [-1, 1]) fang(jawHard, sd * (lipX(0.07 + i * 0.033, -0.012) - 0.004), 0.07 + i * 0.033, 0.028 + (i % 3 === 1 ? 0.016 : 0), -1);
  // the lid over the eye, and the beam it throws when it opens wide (hidden until then)
  const lid = [H.geo(new THREE.SphereGeometry(ER * 1.12, 18, 8, 0, PI * 2, 0, PI * 0.5)).shade((x, y) => (y < ER * 0.25 ? crustDk : null)).color(back).pbr(0.6).rot(-35, 0, 0)];
  const beam = [H.cyl(ER * 2.2, ER * 0.9, 1.1, 16, true).rot(90, 0, 0).at(0, 0, 0.55).color(gold).glow(1.4).near(), H.cyl(ER * 0.9, ER * 0.45, 1.15, 12).rot(90, 0, 0).at(0, 0, 0.575).color(goldHot).glow(2).near()];
  const lay = layChain((p, o) => balorCurve(p, 0, 0, o), BALOR.Ls, BALOR.lay);
  nodes.push(
    { name: 'head', parent: 'root', rig: 'head', pos: lay.pos.slice(), rot: [-10, 0, 0], prims: head, hard: headHard, detail: 0.85 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: J, rot: [16, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 0.85 },
    { name: 'lid', parent: 'head', rig: 'lids', pos: EC.slice(), rot: [0, 0, 0], hard: lid },
    { name: 'beamBase', parent: 'head', pos: [EC[0], EC[1] + 0.01, EC[2] + 0.03], rot: [14, 0, 0] },
    { name: 'beam', parent: 'beamBase', rig: 'beam', pos: [0, 0, 0], hard: beam },
  );
  return { kind: 'balorMaw', nodes };
}
function animBalorMaw(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const lay = layChain((p, o) => balorCurve(p, t, phase, o), BALOR.Ls, BALOR.lay);
  poseChain(rig.segs, lay);
  // it rears, the lid rolls back off the great eye, and the eye throws its light; between times it gapes and bites
  const c = frac(t * 0.14 + phase * 0.21), gaze = pulse(c, 0.0, 0.42), fire = pulse(c, 0.08, 0.36), bite = pulse(c, 0.55, 0.75), snap = pulse(c, 0.68, 0.78);
  carryHead(rig, lay, -0.12 - gaze * 0.2 - bite * 0.15 + Math.sin(t * 1.3 + phase) * 0.04, Math.sin(t * 0.8 + phase * 2) * 0.12 * (1 - gaze));
  R(rig.jaw, Math.sin(t * 2.1 + phase) * 0.06 + bite * 0.6 - snap * 0.5 + gaze * 0.12);
  (rig.lids || []).forEach((n) => R(n, -gaze * 1.1 + Math.max(0, Math.sin(t * 0.37 + phase * 3)) ** 40 * 1.2));
  (rig.beam || []).forEach((b) => { const k = Math.max(0.001, fire); b.scale.set(0.4 + k * 0.6 + Math.sin(t * 23) * 0.05 * k, 0.4 + k * 0.6 + Math.sin(t * 19) * 0.05 * k, k); b.visible = fire > 0.02; });
}


// =====================================================================================
// SIREN-SCOLOPENDRA (Velvet): a long, glimmering sea-centipede trailing ribbon-fins and venom-tipped legs; where its
// head should be rises a singing angelic figure in gilded armour and violet robes, haloed and winged
// =====================================================================================
const SCOLO = { Ls: [0.15, 0.16, 0.17, 0.18, 0.19, 0.19, 0.19, 0.19, 0.19, 0.18, 0.17, 0.16, 0.15, 0.14] };
SCOLO.n = SCOLO.Ls.length; SCOLO.len = sumLs(SCOLO.Ls); SCOLO.lay = newLay(SCOLO.n);
function scoloCurve(p, t, phase, o) {
  const up = 1 - smooth(p / 0.5), body = smooth((p - 0.35) / 0.6);
  o[0] = Math.sin(p * 2.6 - t * 2.2 - phase) * 0.17 * body + Math.sin(t * 0.8 + phase) * 0.02 * up;
  o[1] = 0.34 * Math.pow(up, 1.15) + (1 - up) * (0.035 + 0.025 * Math.sin(p * 4.4 - t * 2.0 - phase));
  o[2] = 1.0 - 0.16 * smooth(p / 0.5) - Math.max(0, p - 0.38) * 0.96 + Math.sin(t * 0.8 + phase) * 0.015 * up;
}
function sirenScolopendraDesc(def) {
  const violet = num(def.color, 0xb87ad8), deep = mix(tone(violet, 0.02, 0.05, -0.28), 0x1a0a2a, 0.3), pearl = 0xf2eaf2, pearlDk = 0xc8b8d8, gold = 0xe0b040, goldDk = 0x8a6418;
  const glowA = 0xff6ad8, glowB = 0x7ae8ff, skinC = 0xf4e2e4, hair = 0xe0d0f4;
  const sk = (p, part) => p.color(part === 'top' ? deep : part === 'bottom' ? pearlDk : mix(deep, violet, 0.5)).pbr(0.25, 0.35).bump(0.003, 30).tint(0.1, 9);
  const TAB = [{ z: 0.02, w: 0.07, h: 0.07, y: 0 }, { z: -0.4, w: 0.088, h: 0.072, y: 0 }, { z: -1.2, w: 0.094, h: 0.074, y: 0 }, { z: -2.0, w: 0.07, h: 0.058, y: 0 }, { z: -SCOLO.len, w: 0.026, h: 0.024, y: 0 }];
  const at = (z) => station(TAB, z);
  const ribbon = (sd, i, L) => {
    const r0 = [sd * 0.06, 0.03, 0], len = 0.26 + 0.04 * Math.sin(i * 1.3);
    const pts = [r0, [sd * 0.14, 0.04, -L * 0.3], [sd * (0.12 + len * 0.6), 0.02, -L * 0.9], [sd * (0.1 + len * 0.85), 0.0, -L * 1.6]];
    return H.geo(ribbonGeo(pts, (u) => 0.035 * Math.sin(Math.min(1, u * 1.2 + 0.1) * PI) + 0.005, [0, 1, 0], 0.3, 12))
      .shade((x) => { const u = clamp((Math.abs(x) - 0.06) / (len * 0.9), 0, 1); return u < 0.5 ? mix(violet, pearl, u * 2) : mix(pearl, gold, (u - 0.5) * 2); }).pbr(0.3, 0.3).glow(0.35);
  };
  const nodes = [ROOT, ...serpentSegs({ Ls: SCOLO.Ls, TAB, sk, curve: scoloCurve, lay: SCOLO.lay, detail: 0.5, minRes: 28, core: deep, k: 0.012,
    deco: (i, z0, z1, p, hard) => {
      const L = z0 - z1, zm = (z0 + z1) / 2, q = at(zm);
      // a pearl-rimmed back plate on each segment, a pale belly, glowing spots along the flanks
      p.push(S.ellipsoid(q.w * 1.06, q.h * 0.5, L * 0.46).at(0, q.h * 0.62, zm).color(deep).pbr(0.2, 0.5).blend(0.012));
      p.push(S.torus(q.w * 0.98, 0.008).rot(90, 0, 0).scale(1, q.h / q.w, 1).at(0, 0, z1 + 0.012).color(pearl).pbr(0.2, 0.4).paint(0.005, 0.004));
      p.push(under(z0 + 0.05, -q.h * 0.3, z1 - 0.05, -q.h * 0.3, pearlDk, 0.02, 0.3));
      for (const sd of [-1, 1]) for (let k = 0; k < 2; k++) { const a = sd * (62 + k * 30) * DEG, z = zm + (k ? -0.03 : 0.03); p.push(S.sphere(0.012).at(Math.sin(a) * q.w, Math.cos(a) * q.h, z).color(k ? glowB : glowA).glow(1.2).paint(0.004, 0.003)); }
      if (i === 0) return;
      // venom legs: a jointed pair per segment, black-violet with gold fangs at the tips; and the ribbon-fins
      for (const sd of [-1, 1]) {
        const b = [sd * q.w * 0.8, -q.h * 0.4, zm], k = [sd * (q.w + 0.09), -0.02, zm + 0.02], tp = [sd * (q.w + 0.13), -0.11, zm - 0.04];
        hard.push(H.tube([b, k, tp], [0.012, 0.009, 0.003], 10, 6).shade((x, y) => (y < -0.07 ? gold : deep)).pbr(0.3, 0.4).lod(2));
        if (i < SCOLO.n - 1) hard.push(ribbon(sd, i, L).at(0, q.h * 0.4, zm));
      }
      if (i === SCOLO.n - 1) for (const sd of [-1, 1]) hard.push(H.tube([[sd * 0.02, 0, z1 + 0.02], [sd * 0.07, 0.02, z1 - 0.12], [sd * 0.08, 0.03, z1 - 0.26]], [0.012, 0.008, 0.002], 12, 6).color(gold).pbr(0.3, 0.6).glow(0.3));   // the tail forceps
    } }),
  ];
  // ---- the singer: waist to crown, authored upright with the waist at the origin, facing +Z ----
  const cloth = (p, c = violet) => p.color(c).pbr(0.55).bump(0.003, 40, 'weave').tint(0.08, 12);
  const plate = (p, c = gold) => p.color(c).pbr(0.25, 0.85).bump(0.002, 30).tint(0.06, 9);
  const fl = (p) => p.color(skinC).pbr(0.45).tint(0.04, 12);
  const body = [
    cloth(S.ellipsoid(0.095, 0.07, 0.085).at(0, 0.0, 0.0), deep),                                          // the robe gathered at the waist
    cloth(S.capsule([0, 0.0, 0], [0, 0.15, 0.005], 0.06, 0.068).blend(0.03)),
    plate(S.ellipsoid(0.098, 0.08, 0.068).at(0, 0.2, 0.008).blend(0.03)),                                  // gilded breastplate
    plate(S.capsule([0, 0.13, 0.05], [0, 0.26, 0.06], 0.012).blend(0.01), goldDk),
    ...S.mirrorX([plate(S.ellipsoid(0.052, 0.04, 0.05).at(0.1, 0.26, 0).blend(0.02)), plate(S.ellipsoid(0.035, 0.016, 0.04).at(0.12, 0.23, 0).blend(0.01), goldDk)]),
    cloth(S.torus(0.075, 0.012).at(0, 0.11, 0).blend(0.01), gold).pbr(0.3, 0.8),                            // girdle
    fl(S.capsule([0, 0.26, 0], [0, 0.33, 0.006], 0.026, 0.024)),
    S.sphere(0.018).at(0, 0.21, 0.07).color(glowB).glow(1.2).blend(0.005),                                  // the pearl on her breast
  ];
  // flowing sleeves of the robe hanging from the girdle down onto the body like a skirt
  for (let k = 0; k < 8; k++) { const a = (k / 8) * PI * 2 + 0.2; body.push(cloth(S.capsule([Math.sin(a) * 0.07, 0.08, Math.cos(a) * 0.06], [Math.sin(a) * 0.11, -0.06, Math.cos(a) * 0.1], 0.024, 0.032).blend(0.03), k % 2 ? violet : mix(violet, deep, 0.4))); }
  const HC = [0, 0.385, 0.01];
  const headP = [
    fl(S.ellipsoid(0.044, 0.054, 0.048).at(HC[0], HC[1], HC[2])),
    fl(S.ellipsoid(0.03, 0.026, 0.03).at(0, HC[1] - 0.03, HC[2] + 0.018).blend(0.02)),                       // jaw and chin
    S.ellipsoid(0.012, 0.014, 0.01).at(0, HC[1] - 0.026, HC[2] + 0.046).cut(0.004).color(0x5a1a3a),          // singing
    ...S.mirrorX([S.ellipsoid(0.01, 0.006, 0.006).at(0.017, HC[1] + 0.006, HC[2] + 0.042).color(glowB).glow(1.4).paint(0.003, -0.001)]),
    // hair: a long fall of pale lilac down the back
    S.ellipsoid(0.047, 0.05, 0.046).at(0, HC[1] + 0.02, HC[2] - 0.022).color(hair).pbr(0.4).bump(0.004, 30, 'fur').blend(0.015),
    ...S.limb([[0, HC[1] + 0.01, HC[2] - 0.045], [0, HC[1] - 0.08, HC[2] - 0.066], [0, 0.18, -0.08], [0, 0.08, -0.08]], [0.05, 0.05, 0.042, 0.02]).map((q) => q.color(hair).pbr(0.4).bump(0.004, 30, 'fur').blend(0.02)),
    plate(S.torus(0.046, 0.006).rot(-12, 0, 0).at(0, HC[1] + 0.03, HC[2])),                                  // circlet
  ];
  const headH = [H.torus(0.085, 0.006, 40, 6).rot(-10, 0, 0).at(0, HC[1] + 0.02, HC[2] - 0.06).color(0xffe08a).glow(1.4),     // halo
    spike(0.03, 0.008, 0, 5).at(0, HC[1] + 0.07, HC[2] + 0.03).color(gold).pbr(0.3, 0.8).glow(0.3)];
  // wings: feathered fans of pearl and lilac from the shoulder-blades
  const wing = (sd) => place(fan([{ a: -30, len: 0.18 }, { a: -8, len: 0.3 }, { a: 14, len: 0.36 }, { a: 36, len: 0.34 }, { a: 58, len: 0.27 }, { a: 80, len: 0.18 }], hair, pearl, gold, { dip: 0.32, spineR: 0.006, cup: 0.05 * sd, tipCol: 0xfff0c0, rays: 6, fade: 0.8 }), 0, 0, 0, 0, 0, 0).map((h) => h.glow(0.25));
  const lay = layChain((p, o) => scoloCurve(p, 0, 0, o), SCOLO.Ls, SCOLO.lay);
  const WP = lay.pos.slice();
  nodes.push(
    { name: 'torso', parent: 'root', rig: 'torso', pos: WP, prims: body, detail: 1.05 },
    { name: 'head', parent: 'torso', rig: 'head', pos: [0, 0.32, 0], prims: into([0, 0.32, 0], headP), hard: into([0, 0.32, 0], headH), detail: 1.7 },
    { name: 'wingL', parent: 'torso', rig: 'wings', pos: [0.04, 0.27, -0.06], rot: [10, -30, -32], hard: wing(1) },
    { name: 'wingR', parent: 'torso', rig: 'wings', pos: [-0.04, 0.27, -0.06], rot: [10, 30, 32], hard: wing(-1) },
  );
  // arms: robed upper arm, gilded forearm, open hand; the right one holds up a pearl of light
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R';
    const up = [cloth(S.capsule([0, 0, 0], [0, 0, 0.13], 0.024, 0.02)), cloth(S.capsule([0, -0.01, 0.06], [0, -0.04, 0.12], 0.03, 0.035).blend(0.02), mix(violet, deep, 0.3))];
    const fore = [plate(S.capsule([0, 0, 0], [0, 0, 0.11], 0.02, 0.016)), fl(S.ellipsoid(0.016, 0.008, 0.026).at(0, 0, 0.13).blend(0.012))];
    const foreH = sd < 0 ? [H.sphere(0.024, 14).at(0, 0.03, 0.14).color(0xf0f8ff).glow(1.6)] : [];
    nodes.push(
      { name: `arm${n}0`, parent: 'torso', rig: 'arms', pos: [sd * 0.11, 0.255, 0], rot: [sd > 0 ? 30 : -10, sd * 62, 0], prims: up, detail: 1.3 },
      { name: `arm${n}1`, parent: `arm${n}0`, rig: 'arms', pos: [0, 0, 0.13], rot: [sd > 0 ? -50 : -95, 0, 0], prims: fore, hard: foreH, detail: 1.3 },
    );
  }
  return { kind: 'sirenScolopendra', nodes };
}
function animSirenScolopendra(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const lay = layChain((p, o) => scoloCurve(p, t, phase, o), SCOLO.Ls, SCOLO.lay);
  poseChain(rig.segs, lay);
  // the song: she rises, throws her arms wide and her wings open; then she bows forward to strike
  const c = frac(t * 0.13 + phase * 0.23), song = pulse(c, 0.0, 0.45), strike = pulse(c, 0.55, 0.75);
  if (rig.torso) {
    rig.torso.position.set(lay.pos[0], lay.pos[1] + song * 0.04, lay.pos[2]);
    R(rig.torso, -song * 0.18 + strike * 0.45 + Math.sin(t * 1.1 + phase) * 0.04, Math.sin(t * 0.7 + phase) * 0.15 * (1 - song), Math.sin(t * 0.9 + phase * 2) * 0.05);
  }
  R(rig.head, -song * 0.25 + strike * 0.1 + Math.sin(t * 1.4 + phase) * 0.05, Math.sin(t * 0.6 + phase) * 0.2, Math.sin(t * 1.1) * 0.06);
  const A = rig.arms || [];
  for (let i = 0; i < A.length; i++) { const sd = i < 2 ? 1 : -1, j = i % 2; R(A[i], j ? song * 0.7 - strike * 0.3 + Math.sin(t * 1.3 + i) * 0.08 : -song * 0.6 + strike * 0.5 + Math.sin(t * 1.1 + i) * 0.1, j ? 0 : -sd * song * 0.3, 0); }
  (rig.wings || []).forEach((n, i) => { const sd = i ? -1 : 1; R(n, Math.sin(t * 1.6 + phase) * 0.06, sd * (-song * 0.5 + Math.sin(t * 1.6 + phase) * 0.08), sd * -song * 0.3); });
}


// =====================================================================================
// SUMP-KRAKEN (Morbus): a colossal rotting cephalopod, pale green and weeping with boils, dragging a skirt of
// long stinging jelly-tentacles through a slick of murk and weed
// =====================================================================================
const SUMP = {
  armYaw: [22, -22, 64, -64, 108, -108, 150, -150], NA: 6, armLen: [0.17, 0.17, 0.16, 0.15, 0.14, 0.13], armR: [0.075, 0.064, 0.053, 0.042, 0.032, 0.022, 0.012],
  armRest: [4, -10, -8, 2, 8, 12],
  stingYaw: [170, -170, 150, -150, 128, -128, 160, -160, 140, -140], NS: 6, stingLen: [0.16, 0.17, 0.17, 0.17, 0.16, 0.15], stingR: [0.022, 0.018, 0.015, 0.012, 0.01, 0.008, 0.004],
};
/** a rough, lobed slick lying on the water: radius r(a), coloured by f(u = distance / edge) */
function slickGeo(r, f, seg = 48, rings = 4, y = 0.012) {
  const pos = [], col = [], idx = [], c = new THREE.Color();
  pos.push(0, y, 0); c.set(f(0)); col.push(c.r, c.g, c.b);
  for (let j = 1; j <= rings; j++) for (let k = 0; k < seg; k++) { const a = (k / seg) * PI * 2, u = j / rings, R0 = r(a) * u; pos.push(Math.sin(a) * R0, y + (j === rings ? -0.004 : 0), Math.cos(a) * R0); c.set(f(u, a)); col.push(c.r, c.g, c.b); }
  for (let k = 0; k < seg; k++) idx.push(0, 1 + k, 1 + ((k + 1) % seg));
  for (let j = 1; j < rings; j++) for (let k = 0; k < seg; k++) { const a = 1 + (j - 1) * seg + k, b = 1 + (j - 1) * seg + ((k + 1) % seg), cc = a + seg, d = b + seg; idx.push(a, cc, b, b, cc, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return { g, col };
}
function sumpKrakenDesc(def) {
  const base = num(def.color, 0x9ab87a), skin = tone(base, 0, -0.08, -0.04), rot = mix(base, 0x4a4a2a, 0.55), dark = mix(base, 0x1a2010, 0.6), pale = mix(base, 0xe8e4c0, 0.5);
  const boil = 0xd8d060, pus = 0xe8f070, ooze = 0x6a8a1a, murk = 0x3a4222, weed = 0x3a6a2a, beak = 0x2a2216, wet = 0.3;
  const hide = (p, c = skin) => p.color(c).pbr(wet).bump(0.007, 18, 'rock').tint(0.25, 7);
  const boils = (list, base0, n, seed, at, rr = [0.014, 0.04]) => {
    const sf = surfer(base0);
    for (let i = 0; i < n; i++) {
      const a = rnd(i, seed) * PI * 2, e = (rnd(i, seed + 1) - 0.25) * 1.4, d = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
      const q = sf([at[0] + d[0], at[1] + d[1], at[2] + d[2]], [-d[0], -d[1], -d[2]]), r = rr[0] + rnd(i, seed + 2) ** 2 * (rr[1] - rr[0]);
      list.push(hide(S.sphere(r).at(q[0], q[1], q[2]).blend(r * 0.5), mix(boil, skin, 0.35)).glow(0.15));
      list.push(S.sphere(r * 0.42).at(q[0] + d[0] * r * 0.8, q[1] + d[1] * r * 0.8, q[2] + d[2] * r * 0.8).color(pus).glow(0.6).paint(0.004, 0.002));
      if (i % 3 === 0) list.push(S.ellipsoid(r * 0.4, r * 1.6, r * 0.4).at(q[0] + d[0] * r * 0.5, q[1] - r * 1.4, q[2] + d[2] * r * 0.5).color(ooze).glow(0.3).paint(0.006, 0.002));   // weeping
    }
  };
  // ---- head: heavy-lidded milky eyes, the beak, the skirt the arms grow from ----
  const ER = 0.08, EC = [0.17, 0.17, 0.2];
  const head = [hide(S.ellipsoid(0.27, 0.19, 0.25).at(0, 0.1, 0.1)), hide(S.ellipsoid(0.34, 0.12, 0.34).at(0, -0.02, 0.07).blend(0.07)), ...S.mirrorX([hide(S.sphere(0.115).at(EC[0], EC[1] - 0.01, EC[2] - 0.02).blend(0.05))]),
    hide(S.ellipsoid(0.1, 0.08, 0.1).at(0, 0.02, 0.33).blend(0.05), pale)];
  const headBase = head.slice();
  head.push(S.sphere(0.065).at(0, 0.02, 0.41).cut(0.02).color(0x2a1a10), ...S.mirrorX([S.sphere(ER * 1.04).at(EC[0], EC[1], EC[2]).cut(0.012).color(0x1a1a0a),
    hide(S.ellipsoid(0.11, 0.04, 0.1).rot(0, 38, 0).rot(0, 0, 24).at(EC[0] - 0.014, EC[1] + 0.07, EC[2]).blend(0.024), rot)]), under(0.6, -0.08, -0.4, -0.08, pale, 0.03, wet));
  boils(head, headBase, 16, 11, [0, 0.1, 0.1]);
  for (let i = 0; i < 10; i++) { const a = rnd(i, 21) * PI * 2, q = surfer(headBase)([Math.sin(a) * 0.6, 0.15, Math.cos(a) * 0.6], [-Math.sin(a), -0.2, -Math.cos(a)]); head.push(S.sphere(0.03 + rnd(i, 22) * 0.04).at(q[0], q[1], q[2]).color(rot).paint(0.02, 0)); }
  const headHard = [...H.mirrorX([eye(ER, { iris: 0xd8d8a0, rim: 0x8a8a4a, white: 0xc8c89a, shape: 'round', pupilDeg: 12, irisDeg: 55, rough: 0.3, glow: 0.35, seg: 22 }).rot(-13, 31, 0).at(EC[0], EC[1], EC[2])]),
    spike(0.12, 0.05, 0.55, 8, 0.8).rot(112, 0, 0).at(0, 0.075, 0.33).color(beak).pbr(0.3)];
  const jawHard = [spike(0.09, 0.044, 0.5, 8, 0.8).rot(-108, 180, 0).at(0, -0.045, 0.03).color(beak).pbr(0.3)];
  // ---- mantle: a swollen sack slumped back over the water, split and boiled, hung with weed ----
  const mantle = [hide(S.ellipsoid(0.3, 0.26, 0.28).at(0, 0.17, 0)), hide(S.ellipsoid(0.27, 0.27, 0.24).at(0.02, 0.4, 0.0).blend(0.09)), hide(S.ellipsoid(0.19, 0.2, 0.17).at(-0.02, 0.62, 0.01).blend(0.09)),
    hide(S.torus(0.26, 0.05).at(0, 0.035, 0).blend(0.035), pale)];
  const mantleBase = mantle.slice();
  boils(mantle, mantleBase, 34, 31, [0, 0.35, 0], [0.018, 0.055]);
  for (let i = 0; i < 4; i++) { const a = rnd(i, 41) * PI * 2, q = surfer(mantleBase)([Math.sin(a) * 0.7, 0.3 + rnd(i, 42) * 0.3, Math.cos(a) * 0.7], [-Math.sin(a), 0, -Math.cos(a)]); mantle.push(S.ellipsoid(0.04, 0.06, 0.04).at(q[0], q[1], q[2]).cut(0.01).color(0x1a1408)); }
  for (let i = 0; i < 22; i++) { const a = rnd(i, 51) * PI * 2, q = surfer(mantleBase)([Math.sin(a) * 0.7, 0.2 + rnd(i, 52) * 0.5, Math.cos(a) * 0.7], [-Math.sin(a), 0, -Math.cos(a)]); mantle.push(S.sphere(0.05 + rnd(i, 53) * 0.07).at(q[0], q[1], q[2]).color(i % 2 ? rot : dark).paint(0.03, 0)); }
  const mantleHard = [];
  for (let i = 0; i < 9; i++) {   // weed hanging off it
    const a = (i / 9) * PI * 2 + 0.3, q = surfer(mantleBase)([Math.sin(a) * 0.7, 0.45 + rnd(i, 61) * 0.2, Math.cos(a) * 0.7], [-Math.sin(a), 0, -Math.cos(a)]), L = 0.2 + rnd(i, 62) * 0.2;
    mantleHard.push(H.geo(ribbonGeo([q, [q[0] * 1.15, q[1] - L * 0.4, q[2] * 1.15], [q[0] * 1.25, q[1] - L * 0.8, q[2] * 1.25], [q[0] * 1.3, Math.max(0.05, q[1] - L * 1.2), q[2] * 1.3]], (u) => 0.025 * (1 - u * 0.6), [Math.sin(a), 0, Math.cos(a)], 0.5, 10)).color(i % 2 ? weed : mix(weed, murk, 0.5)).pbr(0.7).lod(1));
  }
  // ---- the slick of murk and weed it lies in ----
  const sl = slickGeo((a) => 1.15 + 0.18 * Math.sin(a * 3 + 1) + 0.1 * Math.sin(a * 7) + 0.25 * Math.max(0, -Math.cos(a)), (u, a = 0) => mix(mix(murk, 0x2a301a, u), weed, Math.max(0, Math.sin(a * 11 + u * 9)) ** 6 * 0.6), 56, 4, 0.015);
  const slick = [H.geo(sl.g).shade((x, y, z, nx, ny, nz, i) => [sl.col[i * 3], sl.col[i * 3 + 1], sl.col[i * 3 + 2]]).pbr(0.95)];
  for (let i = 0; i < 18; i++) { const a = rnd(i, 71) * PI * 2, r = 0.5 + rnd(i, 72) * 0.7; slick.push(H.sphere(0.04 + rnd(i, 73) * 0.05, 8).scale(1.4, 0.25, 1).rot(0, a / DEG, 0).at(Math.sin(a) * r, 0.02, Math.cos(a) * r).color(i % 3 ? weed : 0x6a7a3a).pbr(0.8).lod(1)); }

  const limbSeg = (r0, r1, L, seed) => {
    const prims = [hide(S.capsule([0, 0, 0], [0, 0, L], r0, r1)), S.box(1, 0.5, L + 0.3, 0.02).at(0, -0.25 - r0 * 0.3, L / 2).color(pale).pbr(wet).paint(r0 * 0.3, 0)];
    for (let k = 0; k < 2; k++) { const z = L * (0.2 + 0.6 * rnd(seed, k)), a = (rnd(seed, k + 3) - 0.5) * 1.8, r = lerp(r0, r1, z / L), b = r * (0.25 + rnd(seed, k + 5) * 0.2); prims.push(hide(S.sphere(b).at(Math.sin(a) * r, Math.cos(a) * r, z).blend(b * 0.4), mix(boil, skin, 0.4)), S.sphere(b * 0.45).at(Math.sin(a) * (r + b * 0.8), Math.cos(a) * (r + b * 0.8), z).color(pus).glow(0.6).paint(0.003, 0.001)); }
    return { prims, hard: [H.geo(coreGeo(r0, r1, L)).shade((x, y) => (y < -r1 * 0.25 ? pale : skin)).pbr(wet)] };
  };
  const nodes = [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: [0, 0.13, 0.18], prims: head, hard: headHard, detail: 0.52 },
    { name: 'jaw', parent: 'body', rig: 'jaw', pos: [0, 0.04, 0.32], rot: [10, 0, 0], hard: jawHard },
    { name: 'mantle', parent: 'body', rig: 'core', pos: [0, 0.06, -0.06], rot: [-48, 0, 0], prims: mantle, hard: mantleHard, detail: 0.42 },
    { name: 'slick', parent: 'root', pos: [0, 0, -0.1], hard: slick },
  ];
  SUMP.armYaw.forEach((yaw, a) => {
    const sd = yaw > 0 ? 1 : -1, y = yaw * DEG;
    nodes.push({ name: `armBase${a}`, parent: 'body', pos: [Math.sin(y) * 0.25, -0.03, 0.07 + Math.cos(y) * 0.25], rot: [0, yaw, sd * 16] });
    for (let j = 0; j < SUMP.NA; j++) {
      const g = limbSeg(SUMP.armR[j], SUMP.armR[j + 1], SUMP.armLen[j], a * 10 + j);
      nodes.push({ name: `arm${a}_${j}`, parent: j ? `arm${a}_${j - 1}` : `armBase${a}`, rig: 'arms', pos: j ? [0, 0, SUMP.armLen[j - 1]] : [0, 0, 0], rot: [SUMP.armRest[j] + (rnd(a, j) - 0.5) * 10, (rnd(a, j + 9) - 0.5) * 16, 0], prims: g.prims, hard: g.hard, detail: 0.4, minRes: 18 });
    }
  });
  // the stinging skirt: long glassy tentacles beaded with venom, trailing behind
  const glass = mix(base, 0xdff0c0, 0.5);
  SUMP.stingYaw.forEach((yaw, a) => {
    const y = yaw * DEG, rr = 0.2 + (a % 3) * 0.03;
    nodes.push({ name: `stingBase${a}`, parent: 'body', pos: [Math.sin(y) * rr, -0.02, 0.05 + Math.cos(y) * rr], rot: [6, yaw + (a % 2 ? 1 : -1) * (a > 5 ? 20 : 6), 0] });
    for (let j = 0; j < SUMP.NS; j++) {
      const L = SUMP.stingLen[j] * (a > 5 ? 1.15 : 1), r0 = SUMP.stingR[j], r1 = SUMP.stingR[j + 1];
      const hard = [H.cyl(r1, r0, L, 7).rot(90, 0, 0).at(0, 0, L / 2).color(glass).pbr(0.15, 0.1).glow(0.25)];
      for (let k = 0; k < 3; k++) hard.push(H.sphere(r0 * 1.15, 7).at(0, 0, L * (k + 0.5) / 3).color(k % 2 ? pus : 0xa0e060).glow(0.9).lod(1));
      if (j === 2 || j === 4) hard.push(...H.mirrorX([H.tube([[0, 0, L * 0.5], [0.04, -0.01, L * 0.3], [0.07, -0.02, 0]], [0.004, 0.003, 0.001], 8, 4).color(glass).glow(0.3).lod(1)]));
      nodes.push({ name: `sting${a}_${j}`, parent: j ? `sting${a}_${j - 1}` : `stingBase${a}`, rig: 'stings', pos: j ? [0, 0, SUMP.stingLen[j - 1] * (a > 5 ? 1.15 : 1)] : [0, 0, 0], rot: [(rnd(a, j + 30) - 0.5) * 8, (rnd(a, j + 40) - 0.5) * 20, 0], hard });
    }
  });
  return { kind: 'sumpKraken', nodes };
}
function animSumpKraken(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const breath = Math.sin(t * 0.9 + phase);
  if (rig.core) { rig.core.scale.set(1 + breath * 0.04, 1 - breath * 0.035, 1 + breath * 0.04); R(rig.core, Math.sin(t * 0.5 + phase) * 0.05, 0, Math.sin(t * 0.37 + phase * 2) * 0.05); }
  R(rig.body, Math.sin(t * 0.7 + phase) * 0.03, 0, Math.sin(t * 0.53 + phase) * 0.03);
  R(rig.jaw, Math.max(0, Math.sin(t * 1.9 + phase)) * 0.3);
  // the crush: a pair of arms at a time heaves up out of the slick and comes down
  const A = rig.arms || [], T = rig.stings || [];
  for (let i = 0; i < A.length; i++) {
    const a = Math.floor(i / SUMP.NA), j = i % SUMP.NA, c = frac(t * 0.12 + (a >> 1) * 0.25 + phase * 0.11), rear = pulse(c, 0, 0.34), slam = pulse(c, 0.28, 0.46);
    R(A[i], Math.sin(t * 1.2 - j * 0.8 + a * 1.9 + phase) * (0.05 + j * 0.025) - rear * (j === 0 ? 0.55 : j < 3 ? 0.18 : -0.1) + slam * (j < 2 ? 0.3 : 0.12), Math.sin(t * 0.8 - j * 0.6 + a * 2.3 + phase) * (0.05 + j * 0.02), 0);
  }
  // the stingers drift and coil like a jellyfish's, and lash outward now and then
  for (let i = 0; i < T.length; i++) {
    const a = Math.floor(i / SUMP.NS), j = i % SUMP.NS, c = frac(t * 0.16 + a * 0.13 + phase * 0.07), lash = pulse(c, 0, 0.22);
    R(T[i], Math.sin(t * 0.9 - j * 0.7 + a * 1.3 + phase) * 0.06 - lash * (j === 0 ? 0.25 : -0.05), Math.sin(t * 0.7 - j * 0.9 + a * 2.1 + phase) * (0.1 + j * 0.04) + (a % 2 ? -1 : 1) * lash * 0.2, 0);
  }
}

export const creatures = {
  brassLeviathan: (def) => rigged(def, brassLeviathanDesc),
  abyssalOuroboros: (def) => rigged(def, abyssalOuroborosDesc),
  balorMaw: (def) => rigged(def, balorMawDesc),
  sirenScolopendra: (def) => rigged(def, sirenScolopendraDesc),
  sumpKraken: (def) => rigged(def, sumpKrakenDesc),
};
export const animators = {
  brassLeviathan: animBrassLeviathan,
  abyssalOuroboros: animAbyssalOuroboros,
  balorMaw: animBalorMaw,
  sirenScolopendra: animSirenScolopendra,
  sumpKraken: animSumpKraken,
};
