// Ancient seas: prehistoric marine animals as war-beasts for naval battles, sculpted, rigged and animated in code.
//
//   creatures[def.model](def)            -> a rigged model (rigkit.cloneRigged of a cached template),
//                                           head toward +X, waterline at y = 0, sized by def.size
//   animators[kind](model, { t, phase }) -> poses model.userData.rig each frame (kind = the model key)
//
// Same conventions as seacreatures.js: every animal is authored facing +Z, mirrored across X = 0, in a
// normalised space where it fits a circle of radius ~1.3; the root node turns it to +X and assemble() scales
// it by def.size. The animals ride high so that the back, the head and the working fins break the surface.
// The small kit at the top is a copy of the private helpers of seacreatures.js.
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

// =====================================================================================
// DUNKLEOSTEUS: the armoured fish. Head and chest in hinged bone plate, self-sharpening blades for jaws
// =====================================================================================
function dunkleosteusDesc(def) {
  const base = num(def.color, 0x6b7a3a), olive = tone(base, 0, 0.02, -0.02), oliveDk = tone(base, 0.01, 0.0, -0.13), bone = 0xc9bd98, boneDk = 0x8a7f62;
  const hide = mix(tone(base, 0.03, -0.12, -0.1), 0x39403a, 0.3), back = mix(hide, 0x1c211c, 0.35), belly = 0xd8d0b0, mouth = 0x6e2028, ivory = 0xf1e8c8, wet = 0.4;
  const CY = -0.035;
  const TAB = [
    { z: 1.1, w: 0.15, h: 0.15, y: CY + 0.01 }, { z: 1.03, w: 0.225, h: 0.235, y: CY + 0.005 }, { z: 0.86, w: 0.285, h: 0.3, y: CY }, { z: 0.62, w: 0.315, h: 0.335, y: CY },
    { z: 0.32, w: 0.305, h: 0.33, y: CY }, { z: 0.05, w: 0.25, h: 0.275, y: CY + 0.005 }, { z: -0.25, w: 0.175, h: 0.205, y: CY + 0.015 }, { z: -0.55, w: 0.115, h: 0.14, y: CY + 0.03 },
    { z: -0.8, w: 0.07, h: 0.09, y: CY + 0.045 }, { z: -0.98, w: 0.042, h: 0.055, y: CY + 0.055 }, { z: -1.04, w: 0.036, h: 0.046, y: CY + 0.058 },
  ];
  const HZ = 0.6;   // the hinge between the head shield and the trunk shield
  const armour = (p, part) => p.color(part === 'top' ? oliveDk : olive).pbr(0.62).bump(0.009, 19, 'rock').tint(0.3, 9);
  const flesh = (p, part) => p.color(part === 'top' ? back : hide).pbr(wet).bump(0.004, 30).tint(0.16, 10);
  const sk = (p, part) => flesh(p, part);
  const K = carcass(TAB, [['head', 1.1, HZ], ['body', HZ, -0.12], ['tail0', -0.12, -0.4], ['tail1', -0.4, -0.64], ['tail2', -0.64, -0.85], ['tail3', -0.85, -1.04]], 'body', sk, { pivot: 0.2, lift: { head: 0.2 } });
  const { at, skin, prims, hard } = K;
  // the head is all plate
  prims.head.length = 0;
  prims.head.push(...hull(span(TAB, 1.1, HZ + 0.035), armour));
  const headHull = prims.head.slice();
  // the trunk shield: a collar of plate standing proud of the head in front and of the hide behind
  const TS = TAB.map((q) => ({ ...q, w: q.w * 1.065, h: q.h * 1.065 }));
  prims.body.push(...hull(span(TS, HZ - 0.01, 0.12), armour, 0.02));
  prims.body.push(armour(S.capsule([0, at(0.5).y + at(0.5).h * 1.02, 0.56], [0, at(0.1).y + at(0.1).h * 1.0, 0.02], 0.05, 0.03).blend(0.035), 'top'));   // keel of the median dorsal plate
  // dark hide in the gap of the hinge
  prims.head.push(S.box(1.6, 1.6, 0.05, 0.01).at(0, CY, HZ + 0.02).color(0x15170f).pbr(0.6).paint(0.008, -0.014));
  // plates: low embossed fields, olive weathering to bone, with dark sutures between and bare bone along the rims
  const plate = (n, z, th, rw, rz, k, yaw = 0) => { const q = skin(z, th, 0.01); prims[n].push(S.box(rw * 2, 0.2, rz * 2, Math.min(rw, rz) * 0.45).rot(0, yaw, 0).rot(0, 0, -th).at(q.p[0], q.p[1], q.p[2]).color(mix(olive, bone, k)).pbr(0.66).bump(0.007, 24, 'rock').tint(0.3, 15).paint(0.012, 0.007)); };
  plate('head', 0.86, 0, 0.12, 0.15, 0.3);                 // skull roof
  plate('head', 1.03, 0, 0.1, 0.06, 0.42);                  // rostral
  for (const sd of [-1, 1]) {
    plate('head', 0.82, sd * 50, 0.085, 0.13, 0.3, sd * 8);  // cheek
    plate('head', 0.76, sd * 98, 0.085, 0.1, 0.36);            // under the eye
    plate('body', 0.4, sd * 42, 0.105, 0.16, 0.3);           // anterior dorso-lateral
    plate('body', 0.4, sd * 86, 0.1, 0.15, 0.22);             // anterior lateral
    plate('body', 0.4, sd * 128, 0.09, 0.14, 0.4);            // ventro-lateral
  }
  plate('body', 0.34, 0, 0.1, 0.2, 0.36);                     // median dorsal
  const suture = (n, a, b, r = 0.007) => prims[n].push(S.capsule(a, b, r).color(0x23261c).pbr(0.7).paint(0.004, -0.009));
  suture('head', skin(1.08, 0, 0.0).p, skin(HZ + 0.06, 0, 0.0).p);
  for (const sd of [-1, 1]) {
    suture('head', skin(1.0, sd * 26).p, skin(0.68, sd * 28).p); suture('head', skin(0.95, sd * 72).p, skin(0.68, sd * 76).p);
    suture('head', skin(0.96, sd * 6).p, skin(0.95, sd * 72).p);
    suture('body', skin(0.56, sd * 64, 0.02).p, skin(0.14, sd * 60, 0.02).p); suture('body', skin(0.56, sd * 108, 0.02).p, skin(0.14, sd * 106, 0.02).p);
    suture('body', skin(0.56, sd * 20, 0.02).p, skin(0.14, sd * 22, 0.02).p);
  }
  // worn bone showing along the rims of both shields, and in scuffs across them
  for (const [n, z, lift] of [['head', HZ + 0.075, 0], ['body', HZ - 0.03, 0.02], ['body', 0.15, 0.02], ['head', 1.07, 0]]) for (let i = 0; i < 10; i++) {
    const a = skin(z, -150 + i * 30, lift), b = skin(z, -150 + (i + 1) * 30, lift);
    prims[n].push(S.capsule(a.p, b.p, 0.02).color(mix(bone, boneDk, rnd(i, 17) * 0.6)).pbr(0.6).tint(0.3, 20).paint(0.008, 0.004));
  }
  for (let i = 0; i < 32; i++) { const z = 1.05 - rnd(i, 13) * 0.9, th = (rnd(i, 14) - 0.5) * 260, n = z > HZ ? 'head' : 'body', q = skin(z, th, n === 'body' ? 0.02 : 0); prims[n].push(S.ellipsoid(0.012 + rnd(i, 15) * 0.02, 0.02, 0.012 + rnd(i, 16) * 0.03).at(q.p[0], q.p[1], q.p[2]).color(mix(bone, olive, rnd(i, 18) * 0.5)).pbr(0.6).paint(0.008, 0)); }
  // pits and scars of old fights in the bone
  for (let i = 0; i < 16; i++) { const z = 1.0 - rnd(i, 3) * 0.82, th = (rnd(i, 4) - 0.5) * 200, n = z > HZ ? 'head' : 'body', q = skin(z, th, n === 'body' ? 0.02 : 0); prims[n].push(S.sphere(0.008 + rnd(i, 5) * 0.012).at(q.p[0], q.p[1], q.p[2]).cut(0.005).color(boneDk)); }
  // pale underside
  const bellyLine = (z) => { const q = at(z); return q.y - q.h * 0.5; };
  K.belly(bellyLine, belly, 0.035, wet);
  // dark blotches along the bare back
  K.dapple({ n: 26, z0: 0.05, z1: -0.95, th0: 0, th1: 70, r0: 0.02, r1: 0.05, seed: 11, wref: 0.2, make: (p) => p.color(back).pbr(wet).paint(0.012, 0) });

  // eye: small, staring, in a ring of bone
  eyes(K, 'head', surfer(headHull), 0.9, CY + 0.1, 0.034, { iris: 0xe0a82a, rim: 0x5a3a0a, white: 0xd8cfa8, pupilDeg: 17, irisDeg: 50, rough: 0.1, glow: 0.15 }, { ring: bone, socket: 0x1a1a14 });
  prims.head.push(...S.mirrorX([S.sphere(0.014).at(0.07, CY + 0.07, 1.085).color(0x14140e).paint(0.004, -0.006)]));   // nostrils

  // ---- jaws: no teeth, only blades of bone that sharpen on each other ----
  const jawSk = (p, part) => p.color(part === 'bottom' ? mix(olive, belly, 0.45) : olive).pbr(0.62).bump(0.008, 19, 'rock').tint(0.3, 9);
  const JW = addJaw(K, 'head', { tip: 1.1, hinge: 0.7, yT: CY - 0.035, yH: CY - 0.085, mouth, sk: jawSk, palate: 0.07, tongue: 0.03, back: 0.05, jawTip: 1.07 });
  const bladeUp = (L) => [[0, 0.03], [L, 0.03], [L + 0.006, -0.03], [L - 0.012, -0.125], [L - 0.05, -0.04], [L - 0.085, -0.075], [L - 0.125, -0.03], [L - 0.165, -0.058], [L - 0.205, -0.024], [L - 0.25, -0.042], [0.02, -0.012]];
  const bladeDn = (L) => [[0, -0.03], [0.02, 0.012], [L - 0.24, 0.04], [L - 0.2, 0.02], [L - 0.165, 0.062], [L - 0.125, 0.026], [L - 0.085, 0.08], [L - 0.05, 0.04], [L - 0.014, 0.135], [L + 0.004, 0.02], [L, -0.03]];
  const boneShade = (x, y) => mix(ivory, 0x9a8a5e, clamp(Math.abs(y) * 5.5 - 0.1 + noise3(x * 40, y * 40, 3) * 0.35, 0, 1) * 0.55);
  const sfH = surfer(headHull);
  const lip = (z, y) => sfH([1.4, y, z], [-1, 0, 0])[0];
  const bl = (outline, y0, up) => {
    const xa = lip(0.74, y0) - 0.02, xb = 0.055, L = Math.hypot(1.075 - 0.74, xa - xb), yaw = Math.atan2(xb - xa, 1.075 - 0.74) / DEG;
    return H.mirrorX([H.extrude(outline(L), 0.03, 0.007).shade(boneShade).pbr(0.32).rot(0, -90, 0).rot(0, yaw, 0).rot(up, 0, 0).at(xa, y0, 0.74)]);
  };
  hard.head.push(...bl(bladeUp, JW.mY(0.74) + 0.012, 0));
  const jawHard = [...bl(bladeDn, JW.mY(0.74) - 0.012, 0)];

  // ---- fins and the shark-like tail ----
  const fcol = (sp) => (x, y) => mix(hide, 0x20241e, clamp(y / sp, 0, 1) * 0.55);
  hard.tail0.push(fin({ span: 0.2, chord: 0.3, tip: 0.25, sweep: 0.7, thick: 0.1 }).shade(fcol(0.2)).pbr(wet).at(0, at(-0.22).y + at(-0.22).h - 0.02, -0.2));     // dorsal
  hard.tail1.push(fin({ span: 0.1, chord: 0.14, tip: 0.3, sweep: 0.8, thick: 0.1 }).shade(fcol(0.1)).pbr(wet).rot(0, 0, 180).at(0, at(-0.52).y - at(-0.52).h + 0.015, -0.5));   // anal
  hard.tail0.push(...H.mirrorX([fin({ span: 0.13, chord: 0.14, tip: 0.3, sweep: 0.7, thick: 0.1 }).shade(fcol(0.13)).pbr(wet).rot(0, 0, -125).rot(-20, 0, 0).at(0.1, at(-0.25).y - at(-0.25).h * 0.7, -0.24)]));   // pelvics
  const lobe = (sp, chord, ang, down) => fin({ span: sp, chord, tip: 0.14, sweep: 0.45, thick: 0.1, pw: 0.9, rows: 10 }).shade(fcol(sp)).pbr(wet).rot(0, 0, down ? 180 : 0).rot(ang, 0, 0).at(0, at(-1.0).y, -1.0);
  hard.tail3.push(lobe(0.5, 0.21, -40, false), lobe(0.27, 0.17, 42, true));
  prims.tail3.push(sk(S.capsule([0, at(-1.0).y + 0.06, -1.03], [0, at(-1.0).y - 0.04, -1.04], 0.03, 0.026).blend(0.03)));
  const pec = (sd) => [fin({ span: 0.3, chord: 0.2, tip: 0.3, sweep: 0.55, thick: 0.11, peak: 0.25, root: 0.7 }).shade(flipShade(hide, belly, 0x20241e, 0.3, sd)).pbr(wet)];
  prims.body.push(...S.mirrorX([flesh(S.ellipsoid(0.05, 0.035, 0.09).at(0.27, CY - 0.17, 0.08).blend(0.04), 'core')]));

  const nodes = K.nodes({ detail: { default: 0.68, head: 0.8, body: 0.68 } });
  nodes.push(JW.node(jawHard, 13, 0.8));
  nodes.push(finNode(K, 'finL', 'body', [0.27, CY - 0.18, 0.1], [-20, -12, -122], pec(1)), finNode(K, 'finR', 'body', [-0.27, CY - 0.18, 0.1], [-20, 12, 122], pec(-1)));
  return { kind: 'dunkleosteus', nodes };
}
function animDunkleosteus(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 3.1 + phase;
  // the bite: the skull tips up on its hinge as the jaw drops, then both slam shut
  const c = frac(t * 0.2 + phase * 0.137), bite = pulse(c, 0.0, 0.3), snap = pulse(c, 0.2, 0.32), chew = Math.max(0, Math.sin(t * 1.1 + phase));
  R(rig.body, -bite * 0.1 + Math.sin(w * 0.5) * 0.02, -Math.sin(w + 0.9) * 0.05, Math.sin(w) * 0.035);
  P(rig.body, 0, bite * 0.05 + Math.sin(w * 0.5) * 0.008, 0);
  R(rig.head, -(0.04 + chew * 0.07 + bite * 0.3 - snap * 0.16), Math.sin(w + 0.9) * 0.03, 0);
  R(rig.jaw, chew * 0.14 + bite * 0.55 - snap * 0.42);
  (rig.tail || []).forEach((n, i) => R(n, bite * 0.04, Math.sin(w - i * 0.8) * (0.1 + i * 0.07), 0));
  (rig.fins || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, Math.sin(w * 0.6 + i * 2) * 0.12, 0, sg * (Math.sin(w * 0.6 + i * 2 + 0.9) * 0.14 - bite * 0.25)); });
}

// =====================================================================================
// LEEDSICHTHYS: the gilded giant. A slow, deep-flanked filter feeder striped in gold, bronze and cream
// =====================================================================================
function leedsichthysDesc(def) {
  const gold = num(def.color, 0xc9a23a), bronze = mix(tone(gold, -0.035, 0.0, -0.17), 0x5a3414, 0.25), cream = 0xf0e2b4, backC = mix(bronze, 0x2a1c10, 0.45), belly = 0xf2ead0;
  const goldLt = tone(gold, 0.01, 0.05, 0.1), mouth = 0x8a3038, wet = 0.3, MET = 0.35;
  const CY = -0.1;
  const TAB = [
    { z: 1.2, w: 0.07, h: 0.075, y: CY + 0.03 }, { z: 1.13, w: 0.135, h: 0.15, y: CY + 0.022 }, { z: 1.0, w: 0.2, h: 0.24, y: CY + 0.01 }, { z: 0.82, w: 0.255, h: 0.335, y: CY },
    { z: 0.52, w: 0.3, h: 0.41, y: CY }, { z: 0.18, w: 0.305, h: 0.425, y: CY }, { z: -0.18, w: 0.265, h: 0.375, y: CY + 0.005 }, { z: -0.5, w: 0.19, h: 0.27, y: CY + 0.02 },
    { z: -0.75, w: 0.12, h: 0.17, y: CY + 0.035 }, { z: -0.95, w: 0.068, h: 0.095, y: CY + 0.05 }, { z: -1.08, w: 0.046, h: 0.062, y: CY + 0.055 },
  ];
  const sk = (p, part) => p.color(part === 'top' ? backC : part === 'bottom' ? cream : gold).pbr(wet, MET).bump(0.0085, 17, 'scales').tint(0.1, 8);
  const smoothSk = (p, part) => p.color(part === 'top' ? backC : part === 'bottom' ? cream : mix(gold, bronze, 0.45)).pbr(wet + 0.06, 0.12).bump(0.004, 24).tint(0.14, 9);
  const GZ = 0.78;   // rear edge of the gill plate
  const K = carcass(TAB, [['body', 1.2, -0.22], ['tail0', -0.22, -0.5], ['tail1', -0.5, -0.74], ['tail2', -0.74, -0.93], ['tail3', -0.93, -1.08]], 'body', sk, { pivot: 0.3 });
  const { at, skin, prims, hard } = K;
  // the head is smooth skin and bone, not scaled
  prims.body.length = 0;
  prims.body.push(...hull(span(TAB, 1.2, GZ - 0.03), smoothSk, 0.016), ...hull(span(TAB, GZ - 0.03, -0.22), sk, 0.016));
  const headHull = hull(span(TAB, 1.2, 0.5), smoothSk);
  // gill plate: a great curved lid of bronze, with the dark slit of the gill behind it
  prims.body.push(...S.mirrorX([
    smoothSk(S.ellipsoid(0.06, 0.22, 0.13).at(at(0.86).w - 0.035, CY - 0.02, 0.87).blend(0.03), 'core'),
    smoothSk(S.ellipsoid(0.045, 0.12, 0.08).at(at(1.0).w - 0.02, CY + 0.0, 1.0).blend(0.03), 'core'),          // cheek
  ]));
  // stripes: bands of bronze, gold and cream from the gill plates to the root of the tail
  const band = (th, k, col, m = MET) => K.stripe(GZ - 0.02, -1.06, th, (z) => at(z).h * k, (p) => p.color(col).pbr(wet, m).paint(0.008, 0), 0.1);
  band(19, 0.085, goldLt); band(33, 0.07, cream, 0.3); band(46, 0.075, bronze); band(60, 0.085, goldLt); band(75, 0.08, cream, 0.3); band(90, 0.085, bronze); band(105, 0.085, goldLt); band(120, 0.085, cream, 0.3); band(136, 0.09, bronze, 0.4);
  K.stripe(GZ - 0.05, -1.06, 0, (z) => at(z).h * 0.1, (p) => p.color(backC).pbr(wet + 0.1, 0.3).paint(0.012, 0), 0.1);
  K.belly((z) => at(z).y - at(z).h * 0.8, belly, 0.03, wet, 0.25);
  // the gill slit, engraved behind the plate
  for (const sd of [-1, 1]) for (let i = 0; i < 6; i++) { const a = skin(GZ - 0.012 - Math.sin((i / 6) * PI) * 0.03, sd * (50 + i * 17)), b = skin(GZ - 0.012 - Math.sin(((i + 1) / 6) * PI) * 0.03, sd * (50 + (i + 1) * 17)); prims.body.push(S.capsule(a.p, b.p, 0.014).color(0x3a140e).pbr(0.6).paint(0.006, -0.014)); }
  // eye: small for so vast a fish
  eyes(K, 'body', surfer(headHull), 1.04, CY + 0.07, 0.03, { iris: 0xf0c84a, rim: 0x6a4a10, white: 0xe8dcae, pupilDeg: 20, irisDeg: 52, rough: 0.08 }, { socket: 0x2a1c0c, ring: bronze });
  prims.body.push(...S.mirrorX([S.sphere(0.012).at(0.05, CY + 0.07, 1.17).color(0x1c120a).paint(0.004, -0.005)]));

  // ---- the huge gape: the whole lower half of the head drops ----
  const JW = addJaw(K, 'body', { tip: 1.2, hinge: 0.86, yT: CY + 0.01, yH: CY - 0.05, mouth, sk: smoothSk, palate: 0.13, back: 0.07, wk: 0.975 });
  // gill rakers: pale combs across the roof and floor of the mouth
  for (let i = 0; i < 5; i++) { const z = 0.9 + i * 0.045; const hw = at(z).w * 1.1; prims.body.push(S.box(hw, 0.12, 0.012, 0.004).at(0, JW.mY(z) + 0.065, z).color(0xe8b8a0).paint(0.004, 0)); JW.jaw.push(S.box(hw, 0.1, 0.012, 0.004).at(0, JW.mY(z) - 0.055, z).color(0xe8b8a0).paint(0.004, 0)); }
  const jawHard = [];

  // ---- fins ----
  const finA = mix(bronze, 0x3a2410, 0.3), finB = goldLt;
  const fcol = (sp) => (x, y, z) => mix(mix(finA, finB, clamp(y / sp, 0, 1) ** 1.5 * 0.7), 0x2a1a0a, Math.sin(z * 150 + y * 60) > 0.75 ? 0.3 : 0);
  hard.tail0.push(fin({ span: 0.2, chord: 0.24, tip: 0.2, sweep: 0.75, thick: 0.08, pw: 0.9 }).shade(fcol(0.2)).pbr(wet, 0.3).at(0, at(-0.36).y + at(-0.36).h - 0.03, -0.3));               // dorsal, set far back
  hard.tail0.push(fin({ span: 0.16, chord: 0.2, tip: 0.2, sweep: 0.8, thick: 0.08 }).shade(fcol(0.16)).pbr(wet, 0.3).rot(0, 0, 180).at(0, at(-0.4).y - at(-0.4).h + 0.03, -0.36));       // anal
  const lobe = (ang, down) => fin({ span: 0.6, chord: 0.2, tip: 0.1, sweep: 0.36, thick: 0.09, pw: 0.85, rows: 10, curve: 1.6 }).shade(fcol(0.6)).pbr(wet, 0.3).rot(0, 0, down ? 180 : 0).rot(ang, 0, 0).at(0, at(-1.05).y, -1.03);
  hard.tail3.push(lobe(-34, false), lobe(34, true));
  prims.tail3.push(sk(S.capsule([0, at(-1.05).y + 0.07, -1.07], [0, at(-1.05).y - 0.07, -1.07], 0.036, 0.036).blend(0.03), 'core'));
  const pec = (sd) => [fin({ span: 0.56, chord: 0.15, tip: 0.12, sweep: 0.62, thick: 0.1, pw: 0.8, curve: 1.7, rows: 10 }).shade((x, y, z) => mix(mix(x * sd > 0 ? cream : bronze, finB, clamp(y / 0.56, 0, 1) ** 2 * 0.6), 0x2a1a0a, Math.sin(z * 140 + y * 50) > 0.75 ? 0.25 : 0)).pbr(wet, 0.3)];
  prims.body.push(...S.mirrorX([smoothSk(S.ellipsoid(0.05, 0.04, 0.08).at(at(0.66).w - 0.03, CY - 0.2, 0.66).blend(0.04), 'core')]));

  const nodes = K.nodes({ detail: { default: 0.62, body: 0.64 } });
  nodes.push(JW.node(jawHard, 12, 0.62));
  nodes.push(finNode(K, 'finL', 'body', [at(0.66).w - 0.02, CY - 0.22, 0.68], [-30, -16, -112], pec(1)), finNode(K, 'finR', 'body', [-(at(0.66).w - 0.02), CY - 0.22, 0.68], [-30, 16, 112], pec(-1)));
  return { kind: 'leedsichthys', nodes };
}
function animLeedsichthys(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 1.25 + phase;
  // now and then the great mouth swings open to strain the sea
  const c = frac(t * 0.085 + phase * 0.173), gape = pulse(c, 0.0, 0.5);
  R(rig.body, Math.sin(w * 0.5) * 0.012 - gape * 0.15, -Math.sin(w + 0.8) * 0.03, Math.sin(w) * 0.02);
  P(rig.body, 0, Math.sin(w * 0.5 + 1) * 0.012 + gape * 0.06, 0);
  R(rig.jaw, Math.sin(t * 0.7 + phase) * 0.03 + gape * 0.62);
  (rig.tail || []).forEach((n, i) => R(n, 0, Math.sin(w - i * 0.7) * (0.07 + i * 0.05), 0));
  (rig.fins || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, Math.sin(w * 0.7 + i * 2.2) * 0.1, 0, sg * (Math.sin(w * 0.7 + i * 2.2 + 0.8) * 0.15 + gape * 0.2)); });
}

// =====================================================================================
// XIPHACTINUS: the bulldog fish. Emerald and silver, an upturned jaw full of daggers; hunts in packs
// =====================================================================================
function xiphactinusDesc(def) {
  const green = num(def.color, 0x1f8a5a), back = mix(tone(green, 0.01, 0.05, -0.1), 0x0a2a20, 0.3), silver = 0xc4ced2, belly = 0xeef2f0, mouth = 0x8a2a34, tooth = 0xf6f2e2, wet = 0.26;
  const CY = -0.055;
  const TAB = [
    { z: 1.15, w: 0.035, h: 0.06, y: CY + 0.035 }, { z: 1.09, w: 0.065, h: 0.11, y: CY + 0.02 }, { z: 0.96, w: 0.09, h: 0.155, y: CY + 0.008 }, { z: 0.78, w: 0.112, h: 0.19, y: CY },
    { z: 0.48, w: 0.13, h: 0.215, y: CY }, { z: 0.15, w: 0.128, h: 0.21, y: CY }, { z: -0.2, w: 0.105, h: 0.175, y: CY + 0.005 }, { z: -0.5, w: 0.074, h: 0.125, y: CY + 0.012 },
    { z: -0.75, w: 0.046, h: 0.08, y: CY + 0.02 }, { z: -0.92, w: 0.03, h: 0.052, y: CY + 0.025 }, { z: -1.0, w: 0.025, h: 0.043, y: CY + 0.027 },
  ];
  const sk = (p, part) => (part === 'top' ? p.color(back).pbr(wet, 0.25) : p.color(part === 'bottom' ? belly : silver).pbr(wet - 0.04, 0.55)).bump(0.0035, 34, 'scales').tint(0.1, 12);
  const K = carcass(TAB, [['body', 1.15, -0.05], ['tail0', -0.05, -0.34], ['tail1', -0.34, -0.6], ['tail2', -0.6, -0.82], ['tail3', -0.82, -1.0]], 'body', sk, { pivot: 0.35, core: silver });
  const { at, skin, prims, hard } = K;
  const headHull = K.bare.body.slice();
  // emerald back shading down into the silver flank; a darker lateral line
  K.stripe(1.12, -1.0, 0, (z) => at(z).h * 0.42, (p) => p.color(back).pbr(wet, 0.25).paint(0.012, 0), 0.14);
  K.stripe(1.1, -1.0, 38, (z) => at(z).h * 0.24, (p) => p.color(green).pbr(wet, 0.4).paint(0.02, 0), 0.14);
  K.stripe(0.7, -0.98, 84, 0.006, (p) => p.color(mix(silver, 0x3a5a52, 0.6)).pbr(wet, 0.4).paint(0.004, -0.002), 0.16);
  K.belly((z) => at(z).y - at(z).h * 0.62, belly, 0.03, wet, 0.4);
  // gill cover
  prims.body.push(...S.mirrorX([S.torus(0.105, 0.007).rot(0, 0, 90).rot(0, 12, 0).at(at(0.74).w - 0.012, CY - 0.01, 0.8).color(0x4a5a58).pbr(0.4, 0.4).paint(0.004, -0.006)]));
  eyes(K, 'body', surfer(headHull), 0.99, CY + 0.07, 0.026, { iris: 0xf2d24a, rim: 0x1a3a2a, white: 0xe8ecd8, pupilDeg: 19, irisDeg: 50, rough: 0.06 }, { socket: 0x10201a });

  // ---- the upturned jaw: the mouth line climbs steeply to the snout, so the chin is deep and thrust out ----
  const JW = addJaw(K, 'body', { tip: 1.15, hinge: 0.86, yT: CY + 0.085, yH: CY - 0.075, mouth, sk, palate: 0.05, back: 0.05,
    extra: [sk(S.ellipsoid(0.05, 0.05, 0.06).at(0, CY - 0.045, 1.09).blend(0.035), 'bottom')] });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull.concat(JW.jaw.slice(JW.jawHull.length, JW.jawHull.length + 1)));
  // daggers: long fangs at the front of both jaws, shorter ones behind
  teeth(hard.body, sfH, { z0: 0.9, z1: 1.12, n: 8, mY: JW.mY, up: 1, r: 0.0085, len: (i, f) => 0.03 + (i >= 6 ? 0.05 : i % 2 ? 0.012 : 0), col: tooth, hook: 0.25, rake: 16, lod: 1 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: 0.9, z1: 1.12, n: 7, mY: JW.mY, up: -1, r: 0.0095, len: (i, f) => 0.036 + (i >= 4 ? 0.055 : i % 2 ? 0.014 : 0), col: tooth, hook: 0.3, rake: -10, lod: 1 });

  // ---- fins: everything set well back, and a deeply forked tail ----
  const fcol = (sp) => (x, y) => mix(mix(green, 0x0c2a20, 0.4), 0x06140e, clamp(y / sp, 0, 1) * 0.5);
  hard.tail0.push(fin({ span: 0.17, chord: 0.17, tip: 0.2, sweep: 0.75, thick: 0.08, pw: 0.9 }).shade(fcol(0.17)).pbr(wet).at(0, at(-0.3).y + at(-0.3).h - 0.02, -0.26));
  hard.tail1.push(fin({ span: 0.11, chord: 0.2, tip: 0.3, sweep: 0.9, thick: 0.08 }).shade(fcol(0.11)).pbr(wet).rot(0, 0, 180).at(0, at(-0.45).y - at(-0.45).h + 0.014, -0.42));
  hard.tail0.push(...H.mirrorX([fin({ span: 0.1, chord: 0.07, tip: 0.3, sweep: 0.8, thick: 0.1 }).shade(fcol(0.1)).pbr(wet).rot(0, 0, -150).rot(-25, 0, 0).at(0.04, at(-0.15).y - at(-0.15).h * 0.9, -0.15)]));
  const lobe = (ang, down) => fin({ span: 0.42, chord: 0.13, tip: 0.1, sweep: 0.42, thick: 0.09, pw: 0.8, rows: 9, curve: 1.6 }).shade(fcol(0.42)).pbr(wet).rot(0, 0, down ? 180 : 0).rot(ang, 0, 0).at(0, at(-0.98).y, -0.975);
  hard.tail3.push(lobe(-47, false), lobe(47, true));
  const pec = (sd) => [fin({ span: 0.3, chord: 0.085, tip: 0.15, sweep: 0.7, thick: 0.1, pw: 0.8, curve: 1.6, rows: 8 }).shade(flipShade(mix(green, silver, 0.4), belly, 0x0c2a20, 0.3, sd)).pbr(wet, 0.3)];

  const nodes = K.nodes({ detail: { default: 0.62, body: 0.7 }, minRes: { tail2: 30, tail3: 34 } });
  nodes.push(JW.node(jawHard, 10, 0.8));
  nodes.push(finNode(K, 'finL', 'body', [at(0.66).w - 0.02, CY - 0.13, 0.68], [-35, -14, -128], pec(1)), finNode(K, 'finR', 'body', [-(at(0.66).w - 0.02), CY - 0.13, 0.68], [-35, 14, 128], pec(-1)));
  return { kind: 'xiphactinus', nodes };
}
function animXiphactinus(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  // darting: a burst of tail-beats throws it forward, then it glides
  const c = frac(t * 0.42 + phase * 0.21), burst = pulse(c, 0.0, 0.34), snap = pulse(c, 0.22, 0.4);
  const w = t * 7.5 + phase + burst * 1.5, amp = 0.55 + burst * 0.75;
  R(rig.body, -burst * 0.07, -Math.sin(w + 0.9) * 0.05 * amp, Math.sin(w) * 0.04);
  P(rig.body, 0, burst * 0.02, Math.sin(clamp(c / 0.34, 0, 1) * PI) * 0.09 - 0.03);
  R(rig.jaw, 0.04 + Math.max(0, Math.sin(t * 1.3 + phase)) * 0.08 + burst * 0.5 - snap * 0.5);
  (rig.tail || []).forEach((n, i) => R(n, 0, Math.sin(w - i * 0.85) * (0.1 + i * 0.075) * amp, 0));
  (rig.fins || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, -burst * 0.3, 0, sg * (Math.sin(t * 2.2 + phase + i * 2) * 0.1 - burst * 0.3)); });
}

// =====================================================================================
// TYLOSAURUS: the mosasaur. A sea lizard with a crocodile's head, four paddles and a fluked tail
// =====================================================================================
function tylosaurusDesc(def) {
  const moss = num(def.color, 0x4f6a3a), back = mix(tone(moss, 0.01, 0.0, -0.07), 0x1a2218, 0.3), spot = 0x1c2020, lite = tone(moss, -0.02, 0.04, 0.09), belly = 0xe8e0c0, mouth = 0xb4525c, tooth = 0xf3eedc, wet = 0.42;
  const CY = -0.012;
  const TAB = [
    { z: 1.25, w: 0.024, h: 0.022, y: CY + 0.012 }, { z: 1.16, w: 0.046, h: 0.04, y: CY + 0.01 }, { z: 1.02, w: 0.068, h: 0.06, y: CY + 0.008 }, { z: 0.88, w: 0.094, h: 0.084, y: CY + 0.005 },
    { z: 0.78, w: 0.1, h: 0.1, y: CY }, { z: 0.6, w: 0.126, h: 0.135, y: CY }, { z: 0.32, w: 0.15, h: 0.162, y: CY }, { z: 0.02, w: 0.146, h: 0.158, y: CY },
    { z: -0.22, w: 0.116, h: 0.134, y: CY }, { z: -0.46, w: 0.08, h: 0.108, y: CY }, { z: -0.68, w: 0.056, h: 0.088, y: CY }, { z: -0.88, w: 0.038, h: 0.072, y: CY },
    { z: -1.04, w: 0.025, h: 0.054, y: CY }, { z: -1.16, w: 0.016, h: 0.036, y: CY }, { z: -1.25, w: 0.008, h: 0.016, y: CY },
  ];
  const sk = (p, part) => p.color(part === 'top' ? back : moss).pbr(wet).bump(0.0028, 44, 'scales').tint(0.14, 11);
  const TZ = [0.34, 0.08, -0.18, -0.42, -0.64, -0.84, -1.0, -1.13, -1.25];
  const segs = [['head', 1.25, 0.8], ['body', 0.8, 0.34]];
  for (let i = 0; i < 8; i++) segs.push([`tail${i}`, TZ[i], TZ[i + 1]]);
  const K = carcass(TAB, segs, 'body', sk, { pivot: 0.58, core: (x, y) => (y < CY - 0.03 ? belly : moss) });
  const { at, skin, prims, hard } = K;
  // skull: jaw muscles swelling behind the eyes, brow ridges, a blunt bony prow
  prims.head.push(...S.mirrorX([
    sk(S.ellipsoid(0.04, 0.05, 0.075).at(0.075, CY + 0.012, 0.86).blend(0.04), 'core'),
    sk(S.capsule([0.056, CY + 0.066, 1.0], [0.072, CY + 0.078, 0.9], 0.016, 0.02).blend(0.045), 'top'),
  ]), sk(S.ellipsoid(0.03, 0.026, 0.04).at(0, CY + 0.014, 1.235).blend(0.02), 'top'));
  const headHull = prims.head.slice();
  prims.body.push(...S.mirrorX([sk(S.ellipsoid(0.04, 0.035, 0.07).at(at(0.62).w - 0.02, CY - 0.05, 0.62).blend(0.035), 'core')]));
  prims.tail1.push(...S.mirrorX([sk(S.ellipsoid(0.035, 0.03, 0.06).at(at(-0.1).w - 0.02, CY - 0.05, -0.1).blend(0.035), 'core')]));
  K.stripe(1.2, 0.3, 0, (z) => at(z).h * 0.6, (p) => p.color(back).pbr(wet).paint(0.02, 0), 0.13);
  // mottled moss: paler blotches on the flank, charcoal spots thick along the back
  K.dapple({ n: 70, z0: 1.0, z1: -1.2, th0: 30, th1: 105, r0: 0.014, r1: 0.04, seed: 21, wref: 0.14, make: (p) => p.color(lite).pbr(wet).paint(0.012, 0) });
  K.dapple({ n: 150, z0: 1.15, z1: -1.22, th0: 0, th1: 100, r0: 0.009, r1: 0.032, seed: 31, wref: 0.14, make: (p, i) => p.color(i % 5 ? spot : mix(spot, moss, 0.4)).pbr(wet).paint(0.005, 0) });
  K.belly((z) => at(z).y - at(z).h * 0.42, belly, 0.022, wet);
  eyes(K, 'head', surfer(headHull), 0.955, CY + 0.052, 0.02, { iris: 0xe8b82a, rim: 0x4a3a0a, white: 0xd8d0a0, shape: 'slit', pupilDeg: 16, irisDeg: 56, rough: 0.08, glow: 0.12 }, { socket: 0x14180e, ring: mix(moss, belly, 0.4) });
  prims.head.push(...S.mirrorX([S.sphere(0.008).at(0.03, CY + 0.04, 1.13).color(0x0c100a).paint(0.003, -0.004)]));

  // ---- jaws: hooked teeth along the lips and a second pair of rows on the roof of the mouth ----
  const JW = addJaw(K, 'head', { tip: 1.25, hinge: 0.855, yT: CY + 0.006, yH: CY - 0.022, mouth, sk, palate: 0.034, tongue: 0.012, back: 0.05, belly, bellyLine: (z) => at(z).y - at(z).h * 0.42, wet, jawTip: 1.225 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  teeth(hard.head, sfH, { z0: 0.9, z1: 1.2, n: 12, mY: JW.mY, up: 1, r: 0.0075, len: (i) => 0.026 + (i % 3 === 1 ? 0.012 : 0), col: tooth, hook: 0.3, rake: 4 });
  for (let i = 0; i < 7; i++) for (const sd of [-1, 1]) { const z = 0.9 + i * 0.034; hard.head.push(spike(0.026, 0.006, 0.3, 5).rot(180, 0, 0).at(sd * 0.022, JW.mY(z) + 0.03, z).color(tooth).pbr(0.25).lod(1)); }   // palate rows
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: 0.915, z1: 1.2, n: 11, mY: JW.mY, up: -1, r: 0.0075, len: (i) => 0.026 + (i % 3 === 0 ? 0.01 : 0), col: tooth, hook: -0.3, rake: -4 });

  // ---- tail: drooping at the end into the lower lobe of the fluke, a fleshy lobe standing above ----
  const fcol = (sp) => (x, y) => mix(back, 0x0e120e, clamp(y / sp, 0, 1) * 0.45);
  hard.tail5.push(fin({ span: 0.055, chord: 0.2, tip: 0.6, sweep: 0.9, thick: 0.1, pw: 2 }).shade(fcol(0.055)).pbr(wet).at(0, at(-0.92).y + at(-0.92).h - 0.012, -0.92));
  hard.tail6.push(fin({ span: 0.24, chord: 0.2, tip: 0.2, sweep: 0.75, thick: 0.1, pw: 0.9, peak: 0.25, root: 0.8, rows: 10 }).shade(fcol(0.24)).pbr(wet).at(0, at(-1.06).y + at(-1.06).h - 0.02, -1.05));
  hard.tail6.push(fin({ span: 0.05, chord: 0.14, tip: 0.5, sweep: 0.6, thick: 0.1 }).shade(fcol(0.05)).pbr(wet).rot(0, 0, 180).at(0, at(-1.06).y - at(-1.06).h + 0.012, -1.06));
  hard.tail7.push(fin({ span: 0.06, chord: 0.12, tip: 0.3, sweep: 0.8, thick: 0.1 }).shade(fcol(0.06)).pbr(wet).rot(0, 0, 180).at(0, at(-1.19).y - at(-1.19).h + 0.008, -1.18),
    fin({ span: 0.05, chord: 0.12, tip: 0.3, sweep: 1.0, thick: 0.1 }).shade(fcol(0.05)).pbr(wet).at(0, at(-1.19).y + at(-1.19).h - 0.008, -1.18));
  // ---- paddles ----
  const paddle = (sd, sp) => [fin({ span: sp, chord: sp * 0.56, peak: 0.5, root: 0.55, tip: 0.5, pw: 1.6, sweep: 0.42, thick: 0.12, rows: 9 }).shade(flipShade(back, belly, 0x10140e, sp, sd)).pbr(wet)];
  const nodes = K.nodes({ detail: { default: 0.95, head: 1.3, body: 0.95 }, rot: { tail5: [-5, 0, 0], tail6: [-8, 0, 0], tail7: [-7, 0, 0] }, minRes: { tail5: 40, tail6: 44, tail7: 48 } });
  nodes.push(JW.node(jawHard, 9, 1.3));
  nodes.push(
    finNode(K, 'finFL', 'body', [at(0.62).w - 0.015, CY - 0.055, 0.63], [-10, -22, -99], paddle(1, 0.27)), finNode(K, 'finFR', 'body', [-(at(0.62).w - 0.015), CY - 0.055, 0.63], [-10, 22, 99], paddle(-1, 0.27)),
    finNode(K, 'finRL', 'tail1', [at(-0.1).w - 0.015, CY - 0.055, -0.09], [-10, -30, -99], paddle(1, 0.23)), finNode(K, 'finRR', 'tail1', [-(at(-0.1).w - 0.015), CY - 0.055, -0.09], [-10, 30, 99], paddle(-1, 0.23)),
  );
  return { kind: 'tylosaurus', nodes };
}
function animTylosaurus(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 3.0 + phase;
  // a lunge and snap, then later in the cycle the tail cracks like a whip
  const c = frac(t * 0.15 + phase * 0.19), bite = pulse(c, 0.0, 0.26), snap = pulse(c, 0.17, 0.28), lash = pulse(c, 0.45, 0.78);
  const whip = Math.sin(((c - 0.45) / 0.33) * PI * 3) * lash;
  R(rig.body, -bite * 0.14, -Math.sin(w + 1.3) * 0.07, Math.sin(w) * 0.035);
  P(rig.body, 0, bite * 0.035, 0);
  R(rig.head, -bite * 0.2 + Math.sin(t * 0.9 + phase) * 0.02, Math.sin(w + 1.3) * 0.06 + Math.sin(t * 0.7 + phase) * 0.05, 0);
  R(rig.jaw, 0.03 + Math.max(0, Math.sin(t * 1.2 + phase)) * 0.07 + bite * 0.62 - snap * 0.5);
  (rig.tail || []).forEach((n, i) => R(n, 0, Math.sin(w - i * 0.62) * (0.07 + i * 0.024) + whip * (0.05 + i * 0.05), 0));
  (rig.fins || []).forEach((n, i) => { const sg = i % 2 ? -1 : 1, k = w * 0.5 + (i > 1 ? 1.6 : 0) + (i % 2) * PI; R(n, Math.sin(k) * 0.16 - 0.05, 0, sg * (Math.sin(k + 0.9) * 0.18 + bite * 0.2)); });
}

// =====================================================================================
// SHONISAURUS: the giant ichthyosaur. A dolphin's lines on a barrel of a body, a long thin beak, scythes for flippers
// =====================================================================================
function shonisaurusDesc(def) {
  const red = num(def.color, 0xa8502e), back = mix(tone(red, -0.005, 0.0, -0.09), 0x3a1c12, 0.3), rust = mix(tone(red, 0.01, -0.05, -0.14), 0x4a2a1a, 0.4), white = 0xf4f2ea, mouth = 0xb85a60, tooth = 0xf3eedc, wet = 0.44;
  const CY = -0.1;
  const TAB = [
    { z: 1.22, w: 0.015, h: 0.015, y: CY + 0.02 }, { z: 1.06, w: 0.03, h: 0.03, y: CY + 0.02 }, { z: 0.9, w: 0.052, h: 0.054, y: CY + 0.018 }, { z: 0.79, w: 0.1, h: 0.115, y: CY + 0.012 },
    { z: 0.67, w: 0.16, h: 0.195, y: CY + 0.004 }, { z: 0.46, w: 0.24, h: 0.3, y: CY }, { z: 0.2, w: 0.275, h: 0.345, y: CY }, { z: -0.1, w: 0.25, h: 0.315, y: CY + 0.005 },
    { z: -0.4, w: 0.17, h: 0.22, y: CY + 0.02 }, { z: -0.65, w: 0.105, h: 0.14, y: CY + 0.035 }, { z: -0.85, w: 0.06, h: 0.08, y: CY + 0.05 }, { z: -1.0, w: 0.036, h: 0.046, y: CY + 0.06 }, { z: -1.08, w: 0.028, h: 0.036, y: CY + 0.062 },
  ];
  const sk = (p, part) => p.color(part === 'top' ? back : part === 'bottom' ? white : red).pbr(wet).bump(0.0025, 32).tint(0.12, 9);
  const K = carcass(TAB, [['body', 1.22, -0.22], ['tail0', -0.22, -0.48], ['tail1', -0.48, -0.72], ['tail2', -0.72, -0.92], ['tail3', -0.92, -1.08]], 'body', sk, { pivot: 0.2, core: (x, y) => (y < CY ? white : red) });
  const { at, skin, prims, hard } = K;
  // forehead swelling over the beak, flipper roots, a low dorsal ridge
  prims.body.push(sk(S.ellipsoid(0.085, 0.07, 0.1).at(0, CY + 0.1, 0.72).blend(0.05), 'top'),
    ...S.mirrorX([sk(S.ellipsoid(0.05, 0.04, 0.085).at(at(0.48).w - 0.035, CY - 0.13, 0.48).blend(0.04), 'core')]));
  const headHull = prims.body.slice();
  prims.body.push(...S.mirrorX([sk(S.ellipsoid(0.04, 0.035, 0.07).at(at(-0.14).w - 0.03, CY - 0.12, -0.14).blend(0.04), 'core')]));
  // rust-brown saddles and flecks over the terracotta; a stark white belly with a clean edge
  K.stripe(0.9, -1.06, 0, (z) => at(z).h * 0.3, (p) => p.color(back).pbr(wet).paint(0.02, 0), 0.12);
  K.dapple({ n: 130, z0: 0.74, z1: -1.02, th0: 0, th1: 86, r0: 0.01, r1: 0.036, seed: 41, wref: 0.24, make: (p, i) => p.color(i % 4 ? rust : mix(rust, 0x1c0e0a, 0.4)).pbr(wet).paint(0.008, 0) });
  K.belly((z) => at(z).y - at(z).h * (z > 0.8 ? 0.05 : 0.3), white, 0.012, wet);
  eyes(K, 'body', surfer(headHull), 0.7, CY + 0.045, 0.04, { iris: 0x2a1a10, rim: 0x0c0806, white: 0x1c120c, pupilDeg: 24, irisDeg: 56, rough: 0.05 }, { socket: 0x1a0c08, ring: mix(red, 0xe8c8a0, 0.55) });

  // ---- the beak ----
  const JW = addJaw(K, 'body', { tip: 1.22, hinge: 0.745, yT: CY + 0.02, yH: CY - 0.002, mouth, sk, palate: 0.02, back: 0.05, belly: white, bellyLine: () => CY + 0.3, wet, jawTip: 1.2 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  teeth(hard.body, sfH, { z0: 0.84, z1: 1.19, n: 15, mY: JW.mY, up: 1, r: 0.0045, len: 0.014, col: tooth, hook: 0.1, rake: 0, splay: 4, dy: 0.006 });
  const jawHard = [H.geo(coreGeo(0.03, 0.011, 0.36, 0.8)).color(white).pbr(wet).at(0, CY + 0.004, 0.86)];
  teeth(jawHard, sfJ, { z0: 0.85, z1: 1.18, n: 14, mY: JW.mY, up: -1, r: 0.0045, len: 0.014, col: tooth, hook: 0.1, rake: 0, splay: 4, dy: 0.006 });
  hard.body.push(H.geo(coreGeo(0.034, 0.012, 0.37, 0.8)).color(red).pbr(wet).at(0, CY + 0.034, 0.86));

  // ---- fins: a low dorsal, a crescent tail with the spine running down into the lower lobe ----
  const fcol = (sp) => (x, y) => mix(back, 0x1c0e0a, clamp(y / sp, 0, 1) * 0.5);
  hard.body.push(fin({ span: 0.17, chord: 0.26, tip: 0.2, sweep: 0.95, thick: 0.1, pw: 0.9, curve: 1.6 }).shade(fcol(0.17)).pbr(wet).at(0, at(0.0).y + at(0.0).h - 0.03, 0.02));
  const lobe = (sp, chord, ang, down) => fin({ span: sp, chord, tip: 0.12, sweep: 0.5, thick: 0.1, pw: 0.85, rows: 10, curve: 1.7 }).shade(fcol(sp)).pbr(wet).rot(0, 0, down ? 180 : 0).rot(ang, 0, 0).at(0, at(-1.05).y, -1.04);
  hard.tail3.push(lobe(0.36, 0.17, -30, false), lobe(0.42, 0.18, 32, true));
  prims.tail3.push(sk(S.capsule([0, at(-1.05).y + 0.04, -1.07], [0, at(-1.05).y - 0.05, -1.07], 0.02, 0.022).blend(0.03), 'core'));
  const scythe = (sd, sp) => [fin({ span: sp, chord: sp * 0.25, peak: 0.18, root: 0.8, tip: 0.2, pw: 0.9, sweep: 0.62, curve: 1.8, thick: 0.13, rows: 10 }).shade(flipShade(back, white, 0x1c0e0a, sp, sd)).pbr(wet)];
  const nodes = K.nodes({ detail: { default: 0.66, body: 0.7 }, minRes: { tail3: 34 } });
  nodes.push(JW.node(jawHard, 6, 0.9));
  nodes.push(
    finNode(K, 'finFL', 'body', [at(0.48).w - 0.03, CY - 0.14, 0.5], [-22, -14, -106], scythe(1, 0.52)), finNode(K, 'finFR', 'body', [-(at(0.48).w - 0.03), CY - 0.14, 0.5], [-22, 14, 106], scythe(-1, 0.52)),
    finNode(K, 'finRL', 'body', [at(-0.14).w - 0.03, CY - 0.13, -0.13], [-22, -14, -108], scythe(1, 0.4)), finNode(K, 'finRR', 'body', [-(at(-0.14).w - 0.03), CY - 0.13, -0.13], [-22, 14, 108], scythe(-1, 0.4)),
  );
  return { kind: 'shonisaurus', nodes };
}
function animShonisaurus(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  // porpoising: the body arcs up through the surface and noses back under, the tail beating fast behind
  const w = t * 2.5 + phase, s = Math.sin(w), co = Math.cos(w), wb = t * 8.5 + phase;
  P(rig.body, 0, 0.035 + s * 0.085, 0);
  R(rig.body, -co * 0.21, -Math.sin(wb + 0.8) * 0.02, Math.sin(w * 0.5) * 0.04);
  const c = frac(t * 0.19 + phase * 0.23);
  R(rig.jaw, 0.02 + pulse(c, 0.0, 0.25) * 0.38 + Math.max(0, s) * 0.05);
  (rig.tail || []).forEach((n, i) => R(n, co * 0.07, Math.sin(wb - i * 0.8) * (0.07 + i * 0.06), 0));
  (rig.fins || []).forEach((n, i) => { const sg = i % 2 ? -1 : 1; R(n, -0.12 - s * 0.16 - (i > 1 ? 0.06 : 0), 0, sg * (co * 0.22 + 0.06)); });
}

// =====================================================================================
// KRONOSAURUS: the pliosaur. A skull a third of its length, fangs like tent pegs, four wings to fly through the sea
// =====================================================================================
function kronosaurusDesc(def) {
  const orange = num(def.color, 0xc9692a), ochre = mix(tone(orange, 0.035, 0.0, 0.08), 0xd9a84a, 0.45), back = mix(tone(orange, -0.01, 0.0, -0.12), 0x4a2410, 0.3), dark = 0x3a2012, belly = 0xf0dfb4, mouth = 0xa8404a, tooth = 0xf4ecd4, wet = 0.44;
  const CY = -0.02;
  const TAB = [
    { z: 1.2, w: 0.04, h: 0.032, y: CY - 0.004 }, { z: 1.1, w: 0.064, h: 0.052, y: CY }, { z: 0.9, w: 0.1, h: 0.086, y: CY + 0.004 }, { z: 0.7, w: 0.155, h: 0.124, y: CY + 0.006 },
    { z: 0.52, w: 0.215, h: 0.165, y: CY + 0.006 }, { z: 0.42, w: 0.225, h: 0.185, y: CY + 0.004 }, { z: 0.2, w: 0.285, h: 0.235, y: CY }, { z: -0.05, w: 0.3, h: 0.252, y: CY },
    { z: -0.3, w: 0.262, h: 0.222, y: CY }, { z: -0.55, w: 0.18, h: 0.162, y: CY + 0.005 }, { z: -0.8, w: 0.1, h: 0.1, y: CY + 0.01 }, { z: -1.0, w: 0.055, h: 0.06, y: CY + 0.014 }, { z: -1.2, w: 0.018, h: 0.024, y: CY + 0.016 },
  ];
  const sk = (p, part) => p.color(part === 'top' ? back : part === 'bottom' ? mix(ochre, belly, 0.5) : orange).pbr(wet).bump(0.004, 26).tint(0.14, 8);
  const HZ = 0.42;
  const K = carcass(TAB, [['head', 1.2, HZ], ['body', HZ, -0.5], ['tail0', -0.5, -0.76], ['tail1', -0.76, -0.99], ['tail2', -0.99, -1.2]], 'body', sk, { pivot: -0.02, core: orange, lift: { head: 0.03 } });
  const { at, skin, prims, hard } = K;
  // skull: great jaw muscles bulging behind the eyes, brow ridges, a crest along the snout, the swollen tip
  prims.head.push(
    ...S.mirrorX([
      sk(S.ellipsoid(0.085, 0.075, 0.13).at(0.13, CY + 0.085, 0.56).blend(0.05), 'top'),
      sk(S.capsule([0.07, CY + 0.092, 0.84], [0.125, CY + 0.118, 0.72], 0.022, 0.03).blend(0.06), 'top'),
      sk(S.ellipsoid(0.035, 0.028, 0.06).at(0.04, CY + 0.012, 1.13).blend(0.025), 'core'),
    ]),
    sk(S.capsule([0, CY + 0.07, 1.08], [0, CY + 0.13, 0.76], 0.02, 0.03).blend(0.035), 'top'),
  );
  const headHull = prims.head.slice();
  prims.body.push(...S.mirrorX([sk(S.ellipsoid(0.07, 0.045, 0.1).at(at(0.22).w - 0.03, CY - 0.07, 0.22).blend(0.05), 'core'), sk(S.ellipsoid(0.06, 0.04, 0.09).at(at(-0.36).w - 0.03, CY - 0.07, -0.36).blend(0.05), 'core')]));
  // ochre flanks, dark mottling over the back, cream below
  K.stripe(1.0, -1.1, 76, (z) => at(z).h * 0.3, (p) => p.color(ochre).pbr(wet).paint(0.03, 0), 0.13);
  K.stripe(1.16, -1.15, 0, (z) => at(z).h * 0.6, (p) => p.color(back).pbr(wet).paint(0.03, 0), 0.13);
  K.stripe(0.4, -1.15, 0, (z) => at(z).h * 0.2, (p) => p.color(mix(back, dark, 0.5)).pbr(wet).paint(0.03, 0), 0.13);
  K.dapple({ n: 190, z0: 1.1, z1: -1.12, th0: 0, th1: 72, r0: 0.01, r1: 0.042, seed: 51, wref: 0.26, make: (p, i) => p.color(i % 4 ? dark : mix(dark, orange, 0.5)).pbr(wet).paint(0.008, 0) });
  K.belly((z) => at(z).y - at(z).h * 0.45, belly, 0.03, wet);
  eyes(K, 'head', surfer(headHull), 0.74, CY + 0.075, 0.024, { iris: 0xf2d040, rim: 0x5a3008, white: 0xe0d4a0, shape: 'slit', pupilDeg: 16, irisDeg: 58, rough: 0.08, glow: 0.18 }, { socket: 0x1c100a, yaw: 68, pitch: -14 });
  prims.head.push(...S.mirrorX([S.ellipsoid(0.008, 0.008, 0.016).at(0.035, CY + 0.075, 0.9).color(0x140a06).paint(0.003, -0.005)]));

  // ---- jaws ----
  const JW = addJaw(K, 'head', { tip: 1.2, hinge: 0.5, yT: CY - 0.008, yH: CY - 0.03, mouth, sk, palate: 0.06, tongue: 0.022, back: 0.07, belly, bellyLine: (z) => at(z).y - at(z).h * 0.45, wet, jawTip: 1.17 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  const tcol = (i) => mix(tooth, 0xc9b27a, rnd(i, 7) * 0.4);
  teeth(hard.head, sfH, { z0: 0.6, z1: 0.98, n: 7, mY: JW.mY, up: 1, r: 0.014, len: (i) => 0.05 + (i % 2) * 0.016, col: tcol, hook: 0.25, rake: 6, splay: 10 });
  teeth(hard.head, sfH, { z0: 1.04, z1: 1.17, n: 3, mY: JW.mY, up: 1, r: 0.018, len: (i) => 0.095 - i * 0.01, col: tcol, hook: 0.3, rake: 10, splay: 14, lod: 2 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: 0.63, z1: 0.96, n: 6, mY: JW.mY, up: -1, r: 0.014, len: (i) => 0.05 + ((i + 1) % 2) * 0.016, col: tcol, hook: -0.25, rake: -6, splay: 10 });
  teeth(jawHard, sfJ, { z0: 1.01, z1: 1.14, n: 3, mY: JW.mY, up: -1, r: 0.018, len: (i) => 0.088 - i * 0.008, col: tcol, hook: -0.3, rake: -10, splay: 14, lod: 2 });

  // ---- four wings ----
  const wing = (sd, sp) => [fin({ span: sp, chord: sp * 0.36, peak: 0.3, root: 0.62, tip: 0.2, pw: 1.15, sweep: 0.42, curve: 1.5, thick: 0.13, rows: 10 }).shade(flipShade(back, belly, dark, sp, sd)).pbr(wet)];
  const nodes = K.nodes({ detail: { default: 0.74, head: 0.95, body: 0.7 } });
  nodes.push(JW.node(jawHard, 10, 0.95));
  nodes.push(
    finNode(K, 'finFL', 'body', [at(0.22).w - 0.03, CY - 0.075, 0.24], [-8, -12, -96], wing(1, 0.6)), finNode(K, 'finFR', 'body', [-(at(0.22).w - 0.03), CY - 0.075, 0.24], [-8, 12, 96], wing(-1, 0.6)),
    finNode(K, 'finRL', 'body', [at(-0.36).w - 0.03, CY - 0.075, -0.35], [-8, -20, -96], wing(1, 0.54)), finNode(K, 'finRR', 'body', [-(at(-0.36).w - 0.03), CY - 0.075, -0.35], [-8, 20, 96], wing(-1, 0.54)),
  );
  return { kind: 'kronosaurus', nodes };
}
/** underwater flight on four flippers: the front pair leads, the hind pair follows a quarter-beat behind */
function fly4(rig, w, amp, lift = 0) {
  (rig.fins || []).forEach((n, i) => { const sg = i % 2 ? -1 : 1, k = w - (i > 1 ? 1.7 : 0); R(n, Math.cos(k) * 0.3 * amp, 0, sg * (Math.sin(k) * 0.42 * amp + lift)); });
}
function animKronosaurus(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 2.3 + phase;
  // the great gape: head thrown up, jaws wide, then the trap shuts
  const c = frac(t * 0.14 + phase * 0.17), gape = pulse(c, 0.0, 0.36), snap = pulse(c, 0.27, 0.38);
  R(rig.body, Math.sin(w * 2) * 0.012 - gape * 0.1, 0, Math.sin(w) * 0.03);
  P(rig.body, 0, Math.sin(w * 2 + 0.6) * 0.012 + gape * 0.05, 0);
  R(rig.head, -gape * 0.3 + snap * 0.1 + Math.sin(t * 0.8 + phase) * 0.02, Math.sin(t * 0.6 + phase * 2) * 0.07 * (1 - gape), 0);
  R(rig.jaw, 0.02 + Math.max(0, Math.sin(t * 1.1 + phase)) * 0.06 + gape * 0.72 - snap * 0.6);
  (rig.tail || []).forEach((n, i) => R(n, Math.sin(w * 2 - i * 0.6) * 0.03, Math.sin(w * 0.5 - i * 0.7) * (0.05 + i * 0.04), 0));
  fly4(rig, w, 1, 0.05 + gape * 0.1);
}

// =====================================================================================
// THE LONG NECKS: Elasmosaurus (a broad turtle of a body under a neck longer than itself) and Styxosaurus
// (smaller, sleeker, its neck reared like a cobra)
// =====================================================================================
// absolute pitch of each neck segment and then of the head, in degrees above the horizontal, for three poses
const NECK = {
  elasmosaurus: { n: 9, L: 0.135, HL: 0.17, ZB: 0.25, BL: 0.82, TL: 0.36, bw: 0.3, bh: 0.2, nb: 0.105, nt: 0.042,
    rest: [30, 48, 60, 64, 60, 50, 36, 18, 0, -15], coil: [46, 72, 88, 90, 76, 50, 18, -8, -22, -26], strike: [14, 19, 22, 22, 20, 16, 10, 4, -4, -12] },
  styxosaurus: { n: 8, L: 0.13, HL: 0.165, ZB: 0.36, BL: 0.86, TL: 0.42, bw: 0.215, bh: 0.175, nb: 0.092, nt: 0.04,
    rest: [50, 72, 84, 86, 76, 52, 22, -5, -25], coil: [38, 74, 100, 106, 82, 40, 4, -16, -22], strike: [62, 65, 66, 64, 62, 60, 56, 52, 44] },
};
function plesioDesc(def, kind, pal) {
  const C = NECK[kind], wet = 0.44, CY = -0.005;
  const tip = C.ZB + C.n * C.L + C.HL, hz = tip - C.HL, NY = CY + 0.03, zb = C.ZB, zt = zb - C.BL;
  const TAB = [
    { z: tip, w: 0.014, h: 0.012, y: NY - 0.004 }, { z: tip - 0.035, w: 0.03, h: 0.024, y: NY - 0.002 }, { z: tip - 0.095, w: 0.045, h: 0.038, y: NY }, { z: hz + 0.012, w: 0.047, h: 0.045, y: NY },
    { z: hz - 0.06, w: C.nt, h: C.nt * 1.04, y: NY }, { z: zb + 0.06, w: C.nb, h: C.nb * 1.08, y: NY - 0.005 }, { z: zb - 0.1, w: C.bw * 0.74, h: C.bh * 0.82, y: CY + 0.004 },
    { z: zb - C.BL * 0.4, w: C.bw, h: C.bh, y: CY }, { z: zb - C.BL * 0.68, w: C.bw * 0.95, h: C.bh * 0.96, y: CY }, { z: zt, w: C.bw * 0.58, h: C.bh * 0.66, y: CY + 0.004 },
    { z: zt - C.TL * 0.5, w: C.bw * 0.3, h: C.bh * 0.38, y: CY + 0.008 }, { z: zt - C.TL, w: 0.014, h: 0.018, y: CY + 0.01 },
  ];
  const sk = (p, part) => p.color(part === 'top' ? pal.back : part === 'bottom' ? pal.under : pal.flank).pbr(wet, pal.metal || 0).bump(0.003, 34).tint(0.13, 9);
  const segs = [['head', tip, hz]];
  for (let j = C.n - 1; j >= 0; j--) segs.push([`neck${j}`, zb + (j + 1) * C.L, zb + j * C.L]);
  segs.push(['body', zb, zt], ['tail0', zt, zt - C.TL * 0.5], ['tail1', zt - C.TL * 0.5, zt - C.TL]);
  const K = carcass(TAB, segs, 'body', sk, { pivot: zb - C.BL * 0.45, kOf: { body: 0.045 }, core: (x, y) => (y < NY - 0.02 ? pal.belly : pal.flank) });
  const { at, skin, prims, hard } = K;
  // shoulders and hips the flippers work from; a low ridge down the spine
  const fz = zb - C.BL * 0.2, rz = zt + C.BL * 0.14, fy = CY - C.bh * 0.3;
  prims.body.push(...S.mirrorX([
    sk(S.ellipsoid(0.07, 0.045, 0.1).at(at(fz).w - 0.035, fy, fz).blend(0.05), 'core'), sk(S.ellipsoid(0.06, 0.04, 0.09).at(at(rz).w - 0.03, fy, rz).blend(0.05), 'core'),
  ]),
    // the root of the neck, faired into the shoulders along the line the neck leaves on
    sk(S.capsule([0, CY + 0.01, zb - 0.1], [0, NY + Math.sin(C.rest[0] * DEG) * 0.07, zb + Math.cos(C.rest[0] * DEG) * 0.07], C.nb * 1.3, C.nb * 1.02).blend(0.07), 'core'));
  prims.head.push(...S.mirrorX([sk(S.ellipsoid(0.018, 0.014, 0.03).at(0.03, NY + 0.034, hz + C.HL * 0.42).blend(0.016), 'top')]));     // brows
  const headHull = prims.head.slice();
  // markings
  K.stripe(tip - 0.03, zt - C.TL * 0.9, 0, (z) => at(z).h * 0.5, (p) => p.color(pal.back).pbr(wet, pal.metal || 0).paint(0.02, 0), 0.12);
  K.dapple({ n: pal.spots ?? 150, z0: hz, z1: zt - C.TL * 0.7, th0: 0, th1: 92, r0: 0.009, r1: 0.034, seed: pal.seed || 61, wref: 0.22, make: (p, i) => p.color(i % 5 ? pal.dapple : pal.fleck).pbr(wet, pal.metal || 0).paint(0.01, 0) });
  if (pal.bands) for (let j = 0; j < C.n * 2; j++) { const z = zb + 0.08 + j * C.L * 0.5; prims[K.nodeOf(z)].push(S.box(0.6, 0.6, C.L * 0.1, 0.01).at(0, NY + 0.3 + at(z).h * 0.35, z).color(pal.bands).pbr(wet).paint(0.014, 0)); }
  K.belly((z) => at(z).y - at(z).h * 0.38, pal.belly, 0.022, wet, pal.metal || 0);
  eyes(K, 'head', surfer(headHull), hz + C.HL * 0.44, NY + 0.016, 0.0135, { iris: pal.iris, rim: 0x1a1408, white: 0xe8e0c0, pupilDeg: 20, irisDeg: 56, rough: 0.08, glow: pal.eyeGlow || 0 }, { socket: 0x14100c });

  // ---- a small head with a cage of needle teeth that mesh outside the lips ----
  const JW = addJaw(K, 'head', { tip, hinge: hz + C.HL * 0.2, yT: NY - 0.004, yH: NY - 0.008, mouth: 0xb0525a, sk, palate: 0.012, back: 0.03, belly: pal.belly, bellyLine: (z) => at(z).y - at(z).h * 0.38, wet, jawTip: tip - 0.012, wk: 0.96 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull), tooth = 0xf6f0de;
  teeth(hard.head, sfH, { z0: hz + C.HL * 0.36, z1: tip - 0.012, n: 8, mY: JW.mY, up: 1, r: 0.0042, len: (i) => 0.024 + (i > 4 ? 0.012 : 0), col: tooth, hook: 0.2, rake: 18, splay: 26, dy: 0.006, inset: 0.4 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: hz + C.HL * 0.4, z1: tip - 0.022, n: 7, mY: JW.mY, up: -1, r: 0.0042, len: (i) => 0.024 + (i > 3 ? 0.012 : 0), col: tooth, hook: 0.2, rake: 18, splay: 26, dy: 0.006, inset: 0.4 });

  // ---- flippers ----
  const flip = (sd, sp) => [fin({ span: sp, chord: sp * pal.chord, peak: pal.peak, root: 0.5, tip: 0.12, pw: 1.25, sweep: pal.sweep, curve: 1.3, thick: 0.12, rows: 10 }).shade(flipShade(pal.back, pal.belly, pal.tip, sp, sd)).pbr(wet, pal.metal || 0)];
  const rot = {}, det = { default: 1.0, head: 1.7, body: 0.74, tail0: 0.8, tail1: 0.9 }, minRes = { head: 34 };
  let prev = 0;
  for (let j = 0; j <= C.n; j++) { const n = j < C.n ? `neck${j}` : 'head'; rot[n] = [-(C.rest[j] - prev), 0, 0]; prev = C.rest[j]; if (j < C.n) { det[n] = lerp(0.9, 1.25, j / C.n); minRes[n] = 24; } }
  const nodes = K.nodes({ detail: det, rot, minRes });
  nodes.push(JW.node(jawHard, 7, 1.7));
  const fx = at(fz).w - 0.03, rx = at(rz).w - 0.03;
  nodes.push(
    finNode(K, 'finFL', 'body', [fx, fy, fz + 0.02], [-6, -14, -94], flip(1, pal.span)), finNode(K, 'finFR', 'body', [-fx, fy, fz + 0.02], [-6, 14, 94], flip(-1, pal.span)),
    finNode(K, 'finRL', 'body', [rx, fy, rz], [-6, -24, -94], flip(1, pal.span * 0.94)), finNode(K, 'finRR', 'body', [-rx, fy, rz], [-6, 24, 94], flip(-1, pal.span * 0.94)),
  );
  return { kind, nodes };
}
function elasmosaurusDesc(def) {
  const tan = num(def.color, 0xc99a4a), amber = mix(tone(tan, -0.02, 0.08, -0.1), 0x8a4a12, 0.3);
  return plesioDesc(def, 'elasmosaurus', { flank: tan, back: amber, under: mix(tan, 0xf4e6bc, 0.55), belly: 0xf4e8c4, dapple: mix(amber, 0x5a2e0c, 0.45), fleck: tone(tan, 0.01, 0.04, 0.06), bands: mix(amber, 0x5a2e0c, 0.3),
    iris: 0x2a1c0c, tip: 0x6a3a12, span: 0.5, chord: 0.4, peak: 0.42, sweep: 0.36, seed: 61 });
}
function styxosaurusDesc(def) {
  const slate = num(def.color, 0x3a4e6a), back = mix(tone(slate, 0.0, 0.02, -0.08), 0x141c2a, 0.3), silver = 0xdfe9ef;
  return plesioDesc(def, 'styxosaurus', { flank: mix(slate, silver, 0.18), back, under: mix(slate, silver, 0.7), belly: silver, dapple: mix(back, 0x0a1018, 0.4), fleck: mix(slate, silver, 0.25), metal: 0.3,
    iris: 0xbfe4f2, eyeGlow: 0.35, tip: 0x141c2a, span: 0.46, chord: 0.33, peak: 0.36, sweep: 0.5, seed: 71, spots: 120 });
}
/** blend the neck between its rest, coiled and striking poses and lay a travelling sway over it */
function poseNeck(rig, C, kCoil, kStrike, sway) {
  const N = rig.necks || [];
  let pa = 0, pt = 0;
  for (let j = 0; j <= N.length; j++) {
    const a = C.rest[j] ?? 0, tg = a + ((C.coil[j] ?? a) - a) * kCoil + ((C.strike[j] ?? a) - a) * kStrike;
    const d = -((tg - pt) - (a - pa)) * DEG, f = N.length ? j / N.length : 0;
    pa = a; pt = tg;
    R(j < N.length ? N[j] : rig.head, d + sway(j, f, 0), sway(j, f, 1), 0);
  }
}
function animElasmosaurus(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 1.7 + phase;
  // the neck weaves; now and then it draws back and darts its head out low over the water
  const c = frac(t * 0.13 + phase * 0.17), coil = pulse(c, 0.0, 0.3), dart = pulse(c, 0.2, 0.46), snap = pulse(c, 0.36, 0.46), calm = 1 - dart * 0.7;
  R(rig.body, Math.sin(w * 2) * 0.012 - dart * 0.04 + coil * 0.03, Math.sin(t * 0.5 + phase) * 0.03, Math.sin(w) * 0.03);
  P(rig.body, 0, Math.sin(w * 2 + 0.6) * 0.01, 0);
  poseNeck(rig, NECK.elasmosaurus, coil * (1 - dart), dart, (j, f, ax) => (ax ? Math.sin(t * 0.95 + phase - j * 0.5) * 0.085 * calm : Math.sin(t * 0.7 + phase * 1.3 - j * 0.55) * 0.03 * calm));
  R(rig.jaw, 0.03 + Math.max(0, Math.sin(t * 1.3 + phase)) * 0.1 + dart * 0.6 - snap * 0.6);
  (rig.tail || []).forEach((n, i) => R(n, 0, Math.sin(w * 0.5 - i * 0.8) * 0.1, 0));
  fly4(rig, w, 0.85, 0.06);
}
function animStyxosaurus(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 2.1 + phase;
  // the cobra strike: the neck sinks into a tight S, then lashes up and out of the surf at full stretch
  const c = frac(t * 0.17 + phase * 0.19), coil = pulse(c, 0.0, 0.3), strike = pulse(c, 0.22, 0.44), snap = pulse(c, 0.34, 0.44), calm = 1 - strike * 0.8;
  R(rig.body, Math.sin(w * 2) * 0.012 - strike * 0.12 + coil * 0.05, Math.sin(t * 0.6 + phase) * 0.03, Math.sin(w) * 0.035);
  P(rig.body, 0, Math.sin(w * 2 + 0.6) * 0.012 + strike * 0.05, 0);
  poseNeck(rig, NECK.styxosaurus, coil * (1 - strike), strike, (j, f, ax) => (ax ? Math.sin(t * 1.3 + phase - j * 0.55) * 0.07 * calm : Math.sin(t * 0.9 + phase * 1.3 - j * 0.6) * 0.035 * calm));
  R(rig.jaw, 0.03 + Math.max(0, Math.sin(t * 1.5 + phase)) * 0.1 + strike * 0.7 - snap * 0.7);
  (rig.tail || []).forEach((n, i) => R(n, strike * 0.08, Math.sin(w * 0.5 - i * 0.8) * 0.12, 0));
  fly4(rig, w, 0.9, 0.06 + strike * 0.2);
}

// =====================================================================================
// TUSOTEUTHIS: the giant squid. A crimson torpedo, eight short arms and two whip-thin tentacles with barbed clubs
// =====================================================================================
const TUSO = { NA: 3, NT: 7, armLen: [0.13, 0.12, 0.1], armR: [0.036, 0.027, 0.017, 0.006], tentLen: [0.15, 0.15, 0.15, 0.15, 0.14, 0.11, 0.1], tentR: [0.021, 0.016, 0.014, 0.013, 0.013, 0.016, 0.03, 0.007], tentRest: [9, 6, 1, -4, -6, -4, 0] };
function tusoteuthisDesc(def) {
  const red = num(def.color, 0xc8281e), verm = mix(tone(red, 0.03, 0.05, 0.07), 0xf0602a, 0.35), dark = mix(red, 0x3a0810, 0.55), pale = 0xf2c8b0, wet = 0.28;
  const CY = -0.05;
  const sk = (p, part) => p.color(part === 'top' ? mix(red, dark, 0.45) : part === 'bottom' ? mix(verm, pale, 0.45) : red).pbr(wet).bump(0.003, 30).tint(0.16, 10);
  const MT = [
    { z: 0.2, w: 0.15, h: 0.15, y: CY }, { z: 0.12, w: 0.182, h: 0.182, y: CY }, { z: -0.2, w: 0.2, h: 0.2, y: CY }, { z: -0.6, w: 0.172, h: 0.172, y: CY },
    { z: -0.92, w: 0.105, h: 0.105, y: CY + 0.01 }, { z: -1.12, w: 0.04, h: 0.04, y: CY + 0.02 }, { z: -1.2, w: 0.012, h: 0.012, y: CY + 0.022 },
  ];
  const at = (z) => station(MT, z);
  const MO = [0, CY, 0.16];
  const mantle = [
    ...hull(MT, sk, 0.04),
    sk(S.torus(0.172, 0.022).rot(90, 0, 0).at(0, CY, 0.17).blend(0.02), 'core').color(verm),                                        // rim of the mantle
    S.capsule([0, CY + 0.2, 0.1], [0, CY + 0.1, -1.0], 0.05, 0.03).color(dark).pbr(wet).paint(0.03, 0),                               // dark stripe down the back
  ];
  // chromatophores: freckles of vermilion and dark red
  for (let i = 0; i < 70; i++) { const z = 0.1 - rnd(i, 81) * 1.15, th = (rnd(i, 82) - 0.5) * 230 * DEG, q = at(z), r = 0.01 + rnd(i, 83) ** 2 * 0.026; mantle.push(S.sphere(r).at(Math.sin(th) * q.w, q.y + Math.cos(th) * q.h, z).color(i % 3 ? verm : dark).pbr(wet).paint(0.006, 0)); }
  mantle.push(under(0.3, CY - 0.11, -1.25, CY - 0.02, pale, 0.04, wet));
  const mantleHard = [H.geo(loft(span(MT, -0.85, -1.2).map((q) => { const ring = []; for (let j = 0; j < 6; j++) { const a = (j / 6) * PI * 2; ring.push([Math.cos(a) * q.w * 0.75, q.y + Math.sin(a) * q.h * 0.75, q.z]); } return ring; }))).color(red).pbr(wet)];
  // tail fins: two triangles that make an arrowhead
  const tailFin = (sd) => [fin({ span: 0.3, chord: 0.52, tip: 0.04, sweep: 0.95, thick: 0.07, pw: 1.0, curve: 1.0, rows: 10 }).shade((x, y, z) => mix(mix(x * sd > 0 ? mix(red, pale, 0.4) : mix(red, dark, 0.3), verm, clamp(y / 0.3, 0, 1) * 0.7), dark, Math.sin(z * 90) > 0.8 ? 0.2 : 0)).pbr(wet)];

  // ---- head: big eyes, a crown of arms ----
  const HO = [0, CY, 0.26], ER = 0.058;
  const head = [
    sk(S.ellipsoid(0.125, 0.115, 0.15).at(0, CY, 0.3), 'core'),
    sk(S.ellipsoid(0.1, 0.095, 0.1).at(0, CY, 0.42).blend(0.05), 'core'),
    ...S.mirrorX([sk(S.sphere(0.07).at(0.085, CY + 0.012, 0.31).blend(0.04), 'core')]),
    sk(S.capsule([0, CY - 0.1, 0.3], [0, CY - 0.14, 0.14], 0.045, 0.035).blend(0.03), 'bottom'),                                      // funnel
  ];
  head.push(...S.mirrorX([S.sphere(ER * 1.05).at(0.115, CY + 0.014, 0.31).cut(0.008).color(0x2a0a10)]), S.capsule([0, CY + 0.13, 0.4], [0, CY + 0.13, 0.2], 0.05, 0.05).color(mix(red, dark, 0.45)).pbr(wet).paint(0.03, 0), under(0.6, CY - 0.07, 0.1, CY - 0.07, pale, 0.03, wet));
  const headHard = [...H.mirrorX([eye(ER, { iris: 0xf2c23a, rim: 0x8a4a10, white: 0xf2c23a, pupilDeg: 30, irisDeg: 62, rough: 0.3, glow: 0.25, seg: 18 }).rot(-6, 84, 0).at(0.115, CY + 0.014, 0.31)])];
  // the beak, deep in the crown
  headHard.push(spike(0.05, 0.022, 0.5, 7, 0.8).rot(90, 0, 0).at(0, CY + 0.008, 0.5).color(0x1c1410).pbr(0.25).lod(1));

  const nodes = [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: HO, prims: into(HO, head), hard: into(HO, headHard), detail: 1.0 },
    { name: 'mantle', parent: 'body', rig: 'core', pos: sub(MO, HO), prims: into(MO, mantle), hard: into(MO, mantleHard), detail: 0.74 },
    { name: 'finL', parent: 'mantle', rig: 'fins', pos: sub([0.07, CY + 0.02, -0.84], MO), rot: [0, 0, -90], hard: tailFin(1) },
    { name: 'finR', parent: 'mantle', rig: 'fins', pos: sub([-0.07, CY + 0.02, -0.84], MO), rot: [0, 0, 90], hard: tailFin(-1) },
  ];
  const limbSk = (p) => p.color(red).pbr(wet).bump(0.002, 40).tint(0.14, 14);
  const armSeg = (pal) => (j, r0, r1, L) => ({
    prims: [limbSk(S.capsule([0, 0, 0], [0, 0, L], r0, r1)), S.box(1, 0.5, L + 0.3, 0.02).at(0, -0.25 - r0 * 0.4, L / 2).color(pal).pbr(wet).paint(r0 * 0.3, 0)],
    hard: [H.geo(coreGeo(r0, r1, L, 0.78)).color(red).pbr(wet)],
  });
  for (let a = 0; a < 8; a++) {
    const az = 22.5 + a * 45;
    chain(nodes, `arm${a}`, 'body', sub([-Math.sin(az * DEG) * 0.055, CY + Math.cos(az * DEG) * 0.055, 0.47], HO), [[0, 0, az], [-13, 0, 0]], TUSO.armLen, TUSO.armR,
      { rig: 'arms', seg: armSeg(mix(pale, verm, 0.3)), detail: 1.1, minRes: 24, rest: (j) => [(rnd(a, j) - 0.5) * 14 - j * 3, (rnd(a, j + 5) - 0.5) * 16, 0] });
  }
  // the two hunting tentacles: thin stalks, then a flattened club set with hooks
  const hook = 0x2a1a12;
  for (let a = 0; a < 2; a++) {
    const sd = a ? -1 : 1, up = a ? 1 : -1;   // which way a Y rotation lifts this tentacle
    const seg = (j, r0, r1, L) => {
      if (j < 5) return { prims: [limbSk(S.capsule([0, 0, 0], [0, 0, L], r0, r1))], hard: [H.geo(coreGeo(r0, r1, L, 0.85)).color(red).pbr(wet)] };
      const w0 = j === 5 ? 0.016 : 0.044, w1 = j === 5 ? 0.044 : 0.008;
      // the palm of the club faces the other tentacle (local -Y is inward... the flat lies in the local XZ plane)
      const prims = [limbSk(S.capsule([0, 0, 0], [0, 0, L], r0 * 0.8, r1 * 0.8)), ...[-1, 1].map((e) => limbSk(S.capsule([e * w0 * 0.5, 0, 0], [e * w1 * 0.7, 0, L], Math.max(0.008, w0 * 0.5), Math.max(0.006, w1 * 0.5)).blend(0.02)).color(verm))];
      const hard = [H.geo(coreGeo(r0, r1, L, 0.8)).color(red).pbr(wet)];
      for (let k = 0; k < 4; k++) for (const e of [-1, 1]) { const z = L * (k + 0.5) / 4, x = e * lerp(w0, w1, z / L) * 0.75; hard.push(spike(0.03, 0.007, 0.5, 5).rot(0, 0, 180).rot(0, 0, -e * 30).at(x, -0.006, z).color(hook).pbr(0.3).lod(1), H.sphere(0.008, 6).scale(1, 0.5, 1).at(x * 0.5, -0.012, z + 0.01).color(pale).pbr(0.4).lod(0)); }
      return { prims, hard };
    };
    chain(nodes, `tent${a}`, 'body', sub([sd * 0.07, CY + 0.02, 0.45], HO), [[0, 0, -sd * 90], [-6, 0, 0]], TUSO.tentLen, TUSO.tentR,
      { rig: 'tentacles', seg, detail: 1.3, minRes: 28, rest: (j) => [0, up * TUSO.tentRest[j], 0] });
  }
  return { kind: 'tusoteuthis', nodes };
}
function animTusoteuthis(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const breath = Math.sin(t * 2.2 + phase);
  if (rig.core) rig.core.scale.set(1 + breath * 0.03, 1 + breath * 0.03, 1 - breath * 0.012);
  R(rig.body, Math.sin(t * 0.9 + phase) * 0.025, Math.sin(t * 0.6 + phase) * 0.035, Math.sin(t * 0.7 + phase * 2) * 0.05);
  P(rig.body, 0, Math.sin(t * 1.1 + phase) * 0.01, breath * 0.012);
  (rig.fins || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, Math.sin(t * 3.4 + phase + 0.9) * 0.12, 0, sg * Math.sin(t * 3.4 + phase) * 0.3); });
  const A = rig.arms || [], T = rig.tentacles || [];
  for (let i = 0; i < A.length; i++) {
    const a = Math.floor(i / TUSO.NA), j = i % TUSO.NA;
    R(A[i], Math.sin(t * 1.9 - j * 0.9 + a * 1.3 + phase) * (0.1 + j * 0.09) - (j === 0 ? breath * 0.08 : 0), Math.sin(t * 1.4 - j * 0.7 + a * 2.1 + phase) * (0.08 + j * 0.07), 0);
  }
  for (let i = 0; i < T.length; i++) {
    const a = Math.floor(i / TUSO.NT), j = i % TUSO.NT, up = a ? 1 : -1;
    // the strike: both whips shoot out straight and the clubs clap together
    const c = frac(t * 0.19 + phase * 0.13), reach = pulse(c, 0.0, 0.34), grab = pulse(c, 0.2, 0.4);
    const k = 1 - reach * 0.75;
    R(T[i], Math.sin(t * 1.3 - j * 0.65 + a * 2.4 + phase) * (0.05 + j * 0.03) * k + grab * (j < 2 ? 0.1 : j > 4 ? 0.12 : 0.02) - reach * (j === 0 ? 0.06 : 0),
      up * (Math.sin(t * 1.7 - j * 0.7 + a * 1.1 + phase) * (0.05 + j * 0.03) * k - reach * TUSO.tentRest[j] * DEG * 0.8 + reach * (j === 0 ? 0.12 : 0)), 0);
  }
}

// =====================================================================================
// ORTHOCERAS: the straight-shelled nautiloid. A long striped spire that jets along point first, tentacles trailing
// =====================================================================================
const ORTHO = { N: 10, NA: 3, len: [0.23, 0.21, 0.19], r: [0.044, 0.033, 0.021, 0.007] };
function orthocerasDesc(def) {
  const tan = num(def.color, 0xb98a5a), ivory = 0xf2e8cf, chest = mix(tone(tan, -0.02, 0.1, -0.3), 0x2e1206, 0.7), flesh = 0x9e2a58, fleshDk = mix(flesh, 0x2a0a2a, 0.5), fleshLt = 0xe07a8a, wet = 0.3;
  const AY = -0.015, ZA = 1.3, ZM = -0.4, RM = 0.2, L = ZA - ZM;
  const rAt = (z) => lerp(RM, 0.012, (z - ZM) / L);
  const BO = [0, AY, 0.2];
  const shell = [S.cone(RM, 0.012, L, 0.008).rot(90, 0, 0).at(0, AY, (ZA + ZM) / 2).color(ivory).pbr(0.3).bump(0.003, 30, 'ridges').tint(0.08, 12)];
  // bands of chestnut and tan, leaning one way and then the other so that they read as chevrons from above
  let z = ZM + 0.05, i = 0;
  while (z < ZA - 0.04) {
    const r = rAt(z), wide = i % 2 === 0, bw = (wide ? 0.07 : 0.055) * (0.4 + 0.6 * r / RM), lean = (i % 4 < 2 ? 1 : -1) * 11;
    shell.push(S.cyl(r + 0.05, bw).rot(90, 0, 0).rot(lean, 0, 0).at(0, AY, z).color(wide ? chest : mix(tone(tan, 0, 0.12, -0.04), chest, 0.2)).pbr(0.3).paint(0.008, 0));
    z += (wide ? 0.115 : 0.1) * (0.4 + 0.6 * r / RM); i++;
  }
  shell.push(
    S.torus(RM - 0.004, 0.012).rot(90, 0, 0).at(0, AY, ZM + 0.008).color(mix(ivory, tan, 0.4)).pbr(0.3).blend(0.006),                 // the lip
    S.cyl(RM * 0.88, 0.2).rot(90, 0, 0).at(0, AY, ZM - 0.02).cut(0.004).color(0xe6d2c8),                                             // the living chamber
  );
  const shellHard = [H.lathe([[RM * 0.7, 0.02], [0.008, L - 0.01]], 8).rot(90, 0, 0).at(0, AY, ZM).shade((x, y) => (Math.sin(y * 34) > 0.2 ? chest : ivory)).pbr(0.35)];
  // a couple of barnacle-scars and chips for age
  for (let k = 0; k < 7; k++) { const zz = ZM + 0.1 + rnd(k, 91) * 1.2, th = (rnd(k, 92) - 0.5) * 3, r = rAt(zz); shell.push(S.sphere(0.008 + rnd(k, 93) * 0.012).at(Math.sin(th) * r, AY + Math.cos(th) * r, zz).cut(0.004).color(mix(ivory, 0x8a7a5a, 0.5))); }

  // ---- the animal at the mouth of the shell: a leathery hood, staring eyes, a funnel, ten arms ----
  const HO = [0, AY, ZM], ER = 0.058;
  const fl = (p, c = flesh) => p.color(c).pbr(wet).bump(0.0035, 28).tint(0.18, 10);
  const head = [
    fl(S.ellipsoid(0.165, 0.158, 0.16).at(0, AY, ZM - 0.04)),
    fl(S.ellipsoid(0.12, 0.11, 0.1).at(0, AY - 0.01, ZM - 0.16).blend(0.05)),
    ...S.mirrorX([fl(S.sphere(0.075).at(0.125, AY + 0.02, ZM - 0.1).blend(0.035))]),
    fl(S.ellipsoid(0.16, 0.06, 0.15).at(0, AY + 0.125, ZM - 0.05).blend(0.02), mix(tan, 0x6a3a1a, 0.5)).bump(0.008, 22, 'rock'),               // hood
    fl(S.capsule([0, AY - 0.13, ZM - 0.06], [0, AY - 0.17, ZM - 0.24], 0.05, 0.036).blend(0.03), fleshLt),                                   // funnel
  ];
  head.push(...S.mirrorX([S.sphere(ER * 1.06).at(0.165, AY + 0.024, ZM - 0.11).cut(0.008).color(0x1c0a18)]),
    S.capsule([0, AY - 0.17, ZM - 0.25], [0, AY - 0.19, ZM - 0.32], 0.022, 0.022).cut(0.006).color(0x3a1028),
    under(ZM + 0.1, AY - 0.09, ZM - 0.4, AY - 0.09, fleshLt, 0.03, wet));
  for (let k = 0; k < 16; k++) { const a = rnd(k, 95) * PI * 2, zz = ZM - 0.04 - rnd(k, 96) * 0.14; head.push(S.sphere(0.014 + rnd(k, 97) * 0.014).at(Math.sin(a) * 0.15, AY + Math.cos(a) * 0.14, zz).color(k % 2 ? fleshDk : fleshLt).pbr(wet).paint(0.008, 0)); }
  const headHard = [...H.mirrorX([eye(ER, { iris: 0xf2e2a0, rim: 0x7a4a1a, white: 0xf2e2a0, shape: 'bar', pupilDeg: 24, irisDeg: 64, rough: 0.25, glow: 0.25, seg: 18 }).rot(-4, 100, 0).at(0.168, AY + 0.024, ZM - 0.11)])];
  const nodes = [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: BO, prims: into(BO, shell), hard: into(BO, shellHard), detail: 0.8, minRes: 22 },
    { name: 'head', parent: 'body', rig: 'head', pos: sub(HO, BO), prims: into(HO, head), hard: into(HO, headHard), detail: 0.95 },
  ];
  const seg = (j, r0, r1, LL) => ({
    prims: [fl(S.capsule([0, 0, 0], [0, 0, LL], r0, r1)), S.box(1, 0.5, LL + 0.3, 0.02).at(0, 0.25 + r0 * 0.4, LL / 2).color(fleshLt).pbr(wet).paint(r0 * 0.3, 0),
      ...[0.3, 0.7].map((f) => S.torus(lerp(r0, r1, f) * 1.02, 0.005).rot(90, 0, 0).at(0, 0, LL * f).color(fleshDk).pbr(wet).paint(0.004, 0.002))],
    hard: [H.geo(coreGeo(r0, r1, LL, 0.78)).color(flesh).pbr(wet)],
  });
  for (let a = 0; a < ORTHO.N; a++) {
    const az = a * 36 + 18, rr = a % 2 ? 0.085 : 0.06;
    chain(nodes, `arm${a}`, 'head', sub([-Math.sin(az * DEG) * rr, AY - 0.01 + Math.cos(az * DEG) * rr, ZM - 0.2], HO), [[0, 0, az], [180 + 21, 0, 0]], ORTHO.len, ORTHO.r,
      { rig: 'arms', seg, detail: 1.0, minRes: 22, rest: (j) => [(rnd(a, j + 2) - 0.5) * 12, (rnd(a, j + 7) - 0.5) * 14, 0] });
  }
  return { kind: 'orthoceras', nodes };
}
function animOrthoceras(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  // jet propulsion: a squeeze throws the shell forward point first and the arms stream together; then it coasts and they open
  const c = frac(t * 0.5 + phase * 0.23), jet = pulse(c, 0.0, 0.32), surge = c < 0.25 ? smooth(c / 0.25) : 1 - smooth((c - 0.25) / 0.75);
  P(rig.body, 0, Math.sin(t * 1.1 + phase) * 0.012, (surge - 0.45) * 0.16);
  R(rig.body, Math.sin(t * 0.8 + phase) * 0.02 - jet * 0.03, Math.sin(t * 0.55 + phase * 2) * 0.035, Math.sin(t * 0.9 + phase) * 0.06);
  if (rig.head) rig.head.scale.set(1 - jet * 0.07, 1 - jet * 0.07, 1 + jet * 0.1);
  const A = rig.arms || [];
  for (let i = 0; i < A.length; i++) {
    const a = Math.floor(i / ORTHO.NA), j = i % ORTHO.NA, open = 1 - jet;
    R(A[i], -jet * (j === 0 ? 0.3 : 0.03) + open * (j === 0 ? 0.1 : 0.06) + Math.sin(t * 2.3 - j * 1.0 + a * 1.7 + phase) * (0.07 + j * 0.09) * (0.35 + open * 0.65),
      Math.sin(t * 1.7 - j * 0.8 + a * 2.3 + phase) * (0.06 + j * 0.08) * (0.3 + open * 0.7), 0);
  }
}

export const creatures = {
  dunkleosteus: (def) => rigged(def, dunkleosteusDesc),
  leedsichthys: (def) => rigged(def, leedsichthysDesc),
  tylosaurus: (def) => rigged(def, tylosaurusDesc),
  shonisaurus: (def) => rigged(def, shonisaurusDesc),
  kronosaurus: (def) => rigged(def, kronosaurusDesc),
  elasmosaurus: (def) => rigged(def, elasmosaurusDesc),
  tusoteuthis: (def) => rigged(def, tusoteuthisDesc),
  orthoceras: (def) => rigged(def, orthocerasDesc),
  xiphactinus: (def) => rigged(def, xiphactinusDesc),
  styxosaurus: (def) => rigged(def, styxosaurusDesc),
};
export const animators = {
  dunkleosteus: animDunkleosteus,
  leedsichthys: animLeedsichthys,
  tylosaurus: animTylosaurus,
  shonisaurus: animShonisaurus,
  kronosaurus: animKronosaurus,
  elasmosaurus: animElasmosaurus,
  tusoteuthis: animTusoteuthis,
  orthoceras: animOrthoceras,
  xiphactinus: animXiphactinus,
  styxosaurus: animStyxosaurus,
};
