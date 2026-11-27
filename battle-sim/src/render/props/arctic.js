// Arctic seas: sculpted war-beasts of the ice (walrus, orca, narwhal, ice kraken, polar serpent, berg titan) and cheap
// low-poly scenery for frozen water (floes, icebergs, penguins).
//
//   creatures[def.model](def)            -> a rigged model (rigkit.cloneRigged of a cached template),
//                                           head toward +X, waterline at y = 0, sized by def.size
//   animators[kind](model, { t, phase }) -> poses model.userData.rig each frame (kind = the model key)
//   scenery[name](seed)                  -> a static THREE.Object3D, y = 0 at the waterline, about 2 tiles across at scale 1
//   animateScenery(obj, t)               -> penguins waddle, flap and hop; anything else is left alone
//
// Same conventions as seacreatures.js / ancientseas.js: every animal is authored facing +Z, mirrored across X = 0, in a
// normalised space where it fits a circle of radius ~1.3; the root node turns it to +X and assemble() scales it by
// def.size. The sea is drawn opaque, so everything rides high. The small kit at the top is a copy of the private
// helpers of ancientseas.js.
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

// ---------- ice ----------
/** flat-faced copy of a geometry */
function facet(g) { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; }
/** a jagged lump of ice: an icosphere with its corners pushed about, flat-faced, radius ~1 */
function cragGeo(seed = 0, jag = 0.35, detail = 1) {
  return cached(`crag:${seed}:${jag}:${detail}`, () => {
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (noise3(x * 2.3 + seed * 7.1, y * 2.3 + seed * 3.3, z * 2.3 + seed) - 0.5) * 2 * jag;
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    return g;
  });
}
/** an ice crystal: base at the origin, point along +Y, flat-faced */
function shardGeo(seg = 5, seed = 0) {
  return cached(`shard:${seg}:${seed}`, () => {
    const ring = (y, r, k) => { const o = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * PI * 2 + seed, rr = r * (0.72 + rnd(i, seed + k) * 0.56); o.push([Math.cos(a) * rr, y, Math.sin(a) * rr]); } return o; };
    return facet(loft([ring(0, 1, 1), ring(0.36 + rnd(seed, 3) * 0.2, 0.84, 2), ring(1, 0.03, 3)]));
  });
}
/** a slab of plate ice lying on the XZ plane, 1 thick (y 0..1), radius ~1 */
function plateGeo(seed = 0, n = 6) {
  return cached(`plate:${seed}:${n}`, () => {
    const ring = (y, r, k) => { const o = []; for (let i = 0; i < n; i++) { const a = ((i + (rnd(i, seed + 30) - 0.5) * 0.7) / n) * PI * 2 + seed * 1.7, rr = r * (0.55 + rnd(i, seed + 20) * 0.9); o.push([Math.cos(a) * rr, y + (k ? (rnd(i, seed + 40) - 0.5) * 0.7 : 0), Math.sin(a) * rr]); } return o; };
    return facet(loft([ring(0, 1.08, 0), ring(1, 0.84, 1)]));
  });
}
/** facet colours for ice: faces that look up carry snow, the rest run from pale to deep blue */
const iceShade = (snow, lite, deep, seed = 0, cut = 0.6) => (x, y, z, nx, ny, nz) => {
  if (ny > cut) return snow;
  return mix(lite, deep, clamp(0.42 - ny * 0.5 + (noise3(nx * 4 + seed, ny * 4 + seed * 2, nz * 4) - 0.5) * 0.9, 0, 1));
};
function shard(len, r, seed = 0, seg = 5) { return H.geo(shardGeo(seg, seed)).scale(r, len, r); }
const norm = (d) => { const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };

// =====================================================================================
// TUSK WALRUS: a mountain of wrinkled blubber hauled half out of the sea, tusks as long as a ship's boat
// =====================================================================================
function tuskWalrusDesc(def) {
  const base = num(def.color, 0x7a6654), dark = mix(base, 0x2a1c14, 0.5), pink = mix(base, 0xc48a74, 0.55), pale = mix(base, 0xd9c2a2, 0.5), ivory = 0xf3ead0, mouth = 0x7a3038, wet = 0.55;
  // blubber: the local Y of each mass runs along the body, so the 'ridges' relief rings it with wrinkles
  const blub = (rx, ry, rz, x, y, z, pitch = 0, k = 0.09, f = 7.5) => S.ellipsoid(rx, rz, ry).rot(-90 - pitch, 0, 0).at(x, y, z).blend(k).color(base).pbr(wet).bump(0.019, f, 'ridges').tint(0.26, 5);
  const smoothHide = (p, c = base) => p.color(c).pbr(wet).bump(0.005, 16).tint(0.2, 8);
  const BO = [0, 0.02, -0.45];
  const body = [
    blub(0.44, 0.34, 0.56, 0, 0.1, -0.42),
    blub(0.5, 0.42, 0.5, 0, 0.2, 0.0, 12, 0.1, 6.5),
    blub(0.45, 0.44, 0.4, 0, 0.42, 0.3, 36, 0.1, 7),
    blub(0.35, 0.33, 0.3, 0, 0.64, 0.43, 58, 0.09, 8.5),
    smoothHide(S.capsule([0, 0.05, -0.8], [0, 0.03, -1.02], 0.25, 0.1).blend(0.08)),
    // rolls of fat at the back of the neck and over the shoulders
    blub(0.33, 0.07, 0.3, 0, 0.75, 0.36, 62, 0.03),
    blub(0.4, 0.08, 0.34, 0, 0.6, 0.22, 48, 0.035),
    ...S.mirrorX([smoothHide(S.ellipsoid(0.13, 0.17, 0.17).at(0.36, 0.2, 0.33).blend(0.07))]),
  ];
  const sfB = surfer(body);
  /** a point on the hide seen from the body's axis at z, az degrees round from the top */
  const hideAt = (z, az, out = 0) => { const a = az * DEG, d = [Math.sin(a), Math.cos(a), 0], c = [0, 0.15 + clamp(z + 0.1, 0, 0.6) * 0.5, z]; const p = sfB([c[0] + d[0] * 1.5, c[1] + d[1] * 1.5, c[2]], [-d[0], -d[1], 0]); return { p: [p[0] + d[0] * out, p[1] + d[1] * out, p[2]], n: d }; };
  // blotches: pink where the blood runs near the skin, dark where it is old and scarred
  body.push(S.capsule([0, 0.62, -0.6], [0, 1.0, 0.3], 0.3, 0.26).color(mix(base, dark, 0.55)).pbr(wet).paint(0.12, 0));   // weathered back
  for (let i = 0; i < 30; i++) { const q = hideAt(lerp(-0.85, 0.5, rnd(i, 1)), (rnd(i, 2) - 0.5) * 220), r = 0.05 + rnd(i, 3) ** 2 * 0.09; body.push(S.sphere(r).at(q.p[0], q.p[1], q.p[2]).color(i % 3 ? mix(base, pink, 0.55) : mix(base, dark, 0.6)).pbr(wet).paint(0.05, 0)); }
  // deep creases where the rolls of blubber meet
  [[-0.66, 0.02], [-0.38, -0.03], [-0.12, 0.03], [0.1, -0.02], [0.26, 0.03]].forEach(([z, lean], f) => { for (let az = -112; az < 112; az += 16) { const wob = (a) => z + lean * Math.cos(a * DEG * 2) + (rnd(Math.round(a), f + 5) - 0.5) * 0.035 + Math.abs(a) * 0.0012 * (z > 0 ? -1 : 0); body.push(S.capsule(hideAt(wob(az), az).p, hideAt(wob(az + 16), az + 16).p, 0.014).color(mix(base, 0x1c120c, 0.42)).pbr(wet).paint(0.014, -0.014)); } });
  body.push(S.box(2, 0.5, 2.6, 0.02).at(0, -0.2, -0.1).color(mix(base, pale, 0.6)).pbr(wet).paint(0.08, 0));   // paler underside
  // scars: raking slashes of pale, puckered skin
  const scar = (z, az, len, lean, n = 3) => { for (let k = 0; k < n; k++) { const zz = z + k * 0.075 + rnd(k, 7) * 0.02; az += rnd(k, 8) * 6; const a = hideAt(zz, az), b = hideAt(zz + lean, az + len * (0.7 + rnd(k, 9) * 0.5)); const m = hideAt(zz + lean * 0.5, az + len * 0.4).p; body.push(S.capsule(a.p, m, 0.007, 0.013).color(0xdcae9c).pbr(0.4).paint(0.006, -0.009), S.capsule(m, b.p, 0.013, 0.005).color(0xdcae9c).pbr(0.4).paint(0.006, -0.009)); } };
  scar(-0.3, 16, 44, 0.16); scar(0.14, -70, 40, -0.12, 3); scar(-0.6, -34, 30, 0.1, 2); scar(0.3, 44, 26, 0.08, 2);
  // old harpoons: broken shafts still standing in the blubber, a trail of rope
  const bodyHard = [];
  [[-0.2, -24, 0.24, -14], [0.1, 38, 0.2, 20], [-0.55, 12, 0.17, 8], [0.3, -40, 0.15, -30]].forEach(([z, az, len, lean], i) => {
    const q = hideAt(z, az), d = norm([q.n[0] + lean * 0.01, q.n[1], -0.35 + i * 0.12]), p0 = [q.p[0] - d[0] * 0.05, q.p[1] - d[1] * 0.05, q.p[2] - d[2] * 0.05];
    bodyHard.push(aim(H.cyl(0.011, 0.014, len + 0.05, 6), [p0[0] + d[0] * (len + 0.05) / 2, p0[1] + d[1] * (len + 0.05) / 2, p0[2] + d[2] * (len + 0.05) / 2], d).shade((x, y) => mix(0x6a4a2a, 0x3a2614, noise3(x * 90, y * 9, 2))).pbr(0.8));
    bodyHard.push(aim(H.cyl(0.018, 0.018, 0.035, 6), [q.p[0] + d[0] * len * 0.45, q.p[1] + d[1] * len * 0.45, q.p[2] + d[2] * len * 0.45], d).color(0x4a4640).pbr(0.5, 0.7).lod(1));
    const r0 = [q.p[0] + d[0] * len * 0.4, q.p[1] + d[1] * len * 0.4, q.p[2] + d[2] * len * 0.4], r1 = hideAt(z - 0.12, az + (az > 0 ? 14 : -14), 0.012).p, r2 = hideAt(z - 0.2, az + (az > 0 ? 34 : -34), 0.01).p;
    bodyHard.push(H.tube([r0, [(r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2 - 0.02, (r0[2] + r1[2]) / 2], r1, r2], 0.007, 10, 5).color(0xb49a68).pbr(0.9).lod(1));
  });

  // ---- head: a small skull behind a huge whiskered muzzle ----
  const HO = [0, 0.72, 0.5];
  const head = [
    smoothHide(S.ellipsoid(0.23, 0.215, 0.24).at(0, 0.83, 0.63)),
    smoothHide(S.ellipsoid(0.2, 0.15, 0.16).at(0, 0.76, 0.78).blend(0.06)),
    ...S.mirrorX([smoothHide(S.ellipsoid(0.075, 0.04, 0.085).at(0.125, 0.93, 0.76).blend(0.04), mix(base, dark, 0.3))]),
    ...S.mirrorX([S.ellipsoid(0.13, 0.12, 0.125).at(0.098, 0.715, 0.865).blend(0.03).color(pale).pbr(0.6).bump(0.006, 38).tint(0.15, 14)]),
    S.ellipsoid(0.07, 0.045, 0.05).at(0, 0.815, 0.915).blend(0.02).color(dark).pbr(0.35),
    ...S.mirrorX([S.sphere(0.016).at(0.028, 0.82, 0.958).cut(0.005).color(0x1a0e0c)]),
    S.ellipsoid(0.1, 0.035, 0.1).at(0, 0.648, 0.82).cut(0.008).color(mouth),
  ];
  const sfH = surfer(head.slice(0, 6));
  const headHard = [];
  // whiskers: a stiff moustache of quills on each pad
  for (const sd of [-1, 1]) for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
    const d = norm([sd * (0.2 + c * 0.22), -0.2 - r * 0.24, 1 - c * 0.14]), o = [sd * 0.098, 0.715, 0.865], p = sfH([o[0] + d[0] * 0.4, o[1] + d[1] * 0.4, o[2] + d[2] * 0.4], [-d[0], -d[1], -d[2]]);
    headHard.push(aim(spike(0.085 + rnd(r, c) * 0.06, 0.0048, 0.3, 4), [p[0] - d[0] * 0.012, p[1] - d[1] * 0.012, p[2] - d[2] * 0.012], [d[0], d[1] - 0.45, d[2]]).color(mix(0xe8dcbc, 0xb8a47c, rnd(c, r + 4))).pbr(0.5).lod(1));
    head.push(S.sphere(0.009).at(p[0], p[1], p[2]).color(dark).paint(0.004, -0.004));
  }
  // small, red-rimmed eyes
  const ep = sfH([0.6, 0.9, 0.77], [-1, 0, 0]);
  head.push(...S.mirrorX([S.sphere(0.032).at(ep[0] - 0.008, 0.9, 0.77).cut(0.006).color(0x5a1c1c)]));
  headHard.push(...H.mirrorX([eye(0.026, { iris: 0x3a2410, rim: 0x140a06, white: 0xd8b8a0, pupilDeg: 22, irisDeg: 58, rough: 0.08, seg: 14 }).rot(0, 62, 0).at(ep[0] - 0.018, 0.9, 0.772)]));
  // the tusks
  const tuskPts = [[0.105, 0.71, 0.84], [0.128, 0.49, 0.935], [0.146, 0.23, 0.97], [0.15, -0.03, 0.925]];
  headHard.push(...H.mirrorX([
    H.tube(tuskPts, [0.064, 0.06, 0.047, 0.015], 18, 9).shade((x, y, z) => mix(ivory, 0x9c8250, clamp((y - 0.5) * 2.4, 0, 0.55) + (noise3(x * 70, y * 7, z * 70) - 0.4) * 0.3)).pbr(0.28),
    H.sphere(0.0155, 8).at(0.15, -0.03, 0.925).color(ivory).pbr(0.28),
  ]));
  // gums swelling round the roots of the tusks
  head.push(...S.mirrorX([S.ellipsoid(0.085, 0.07, 0.075).at(0.105, 0.675, 0.855).blend(0.02).color(mix(pale, pink, 0.5)).pbr(0.5)]));
  const J = [0, 0.67, 0.66];
  const jaw = [smoothHide(S.ellipsoid(0.13, 0.07, 0.16).at(0, 0.6, 0.76), mix(base, pale, 0.5)), smoothHide(S.ellipsoid(0.085, 0.04, 0.06).at(0, 0.615, 0.88).blend(0.03), pale), S.ellipsoid(0.085, 0.03, 0.1).at(0, 0.652, 0.8).cut(0.008).color(mouth)];

  // ---- flippers: short thick arms ending in square paddles that slap the water ----
  const SL = [0.36, 0.15, 0.34];
  const flipL = [
    smoothHide(S.capsule([0.36, 0.15, 0.34], [0.62, 0.075, 0.43], 0.125, 0.085)),
    smoothHide(S.ellipsoid(0.18, 0.036, 0.16).rot(0, -22, 0).at(0.77, 0.05, 0.49).blend(0.04), mix(base, dark, 0.35)),
  ];
  for (let k = 0; k < 5; k++) { const a = (-58 + k * 27) * DEG, L = 0.3 - Math.abs(k - 2) * 0.03; flipL.push(smoothHide(S.capsule([0.63, 0.06, 0.44], [0.63 + Math.cos(a) * L, 0.05, 0.44 - Math.sin(a) * L], 0.032, 0.022).blend(0.02), dark)); }
  const flipR = flipL.map((p) => p.mirrorX());
  const TO = [0, 0.03, -0.95];
  const hind = S.mirrorX([
    smoothHide(S.capsule([0.06, 0.04, -0.95], [0.2, 0.035, -1.08], 0.085, 0.055)),
    smoothHide(S.ellipsoid(0.115, 0.03, 0.15).rot(0, 38, 0).at(0.27, 0.035, -1.15).blend(0.04), mix(base, dark, 0.35)),
    ...[0, 1, 2].map((k) => smoothHide(S.capsule([0.2, 0.04, -1.08], [0.24 + k * 0.06, 0.035, -1.27 + k * 0.03], 0.026, 0.018).blend(0.02), dark)),
  ]);
  const nodes = [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: BO, prims: into(BO, body), hard: into(BO, bodyHard), detail: 0.52 },
    { name: 'head', parent: 'body', rig: 'head', pos: sub(HO, BO), prims: into(HO, head), hard: into(HO, headHard), detail: 0.95 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: sub(J, HO), rot: [4, 0, 0], prims: into(J, jaw), detail: 0.8 },
    { name: 'finL', parent: 'body', rig: 'fins', pos: sub(SL, BO), prims: into(SL, flipL), detail: 0.7, minRes: 22 },
    { name: 'finR', parent: 'body', rig: 'fins', pos: sub([-SL[0], SL[1], SL[2]], BO), prims: into([-SL[0], SL[1], SL[2]], flipR), detail: 0.7, minRes: 22 },
    { name: 'tail0', parent: 'body', rig: 'tail', pos: sub(TO, BO), prims: into(TO, hind), detail: 0.7, minRes: 22 },
  ];
  return { kind: 'tuskWalrus', nodes };
}
function animTuskWalrus(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 1.3 + phase, breath = Math.sin(w);
  // the flourish: it rears, throws its head back with a roar and brings the tusks down like picks
  const c = frac(t * 0.1 + phase * 0.17), rear = pulse(c, 0.0, 0.42), slam = pulse(c, 0.27, 0.47);
  R(rig.body, -rear * 0.34 + slam * 0.12 + breath * 0.012, Math.sin(t * 0.45 + phase) * 0.05, Math.sin(t * 0.7 + phase) * 0.025);
  P(rig.body, 0, rear * 0.07 - slam * 0.05 + breath * 0.008, 0);
  if (rig.body) rig.body.scale.set(1 + breath * 0.012, 1 + breath * 0.016, 1);
  R(rig.head, -rear * 0.5 + slam * 1.05 + Math.sin(t * 0.8 + phase) * 0.04, Math.sin(t * 0.55 + phase * 2) * 0.16 * (1 - rear), Math.sin(t * 0.4 + phase) * 0.04);
  R(rig.jaw, 0.03 + Math.max(0, Math.sin(t * 0.9 + phase)) * 0.06 + rear * 0.5 - slam * 0.4);
  // fore-flippers slap the water in turn; both come down with the tusks
  (rig.fins || []).forEach((n, i) => {
    const sg = i ? -1 : 1, k = frac(t * 0.33 + phase * 0.11 + i * 0.5), up = pulse(k, 0.0, 0.3) * (1 - rear) + rear * 0.9 - slam * 0.9;
    R(n, -up * 0.25, sg * up * 0.2, sg * up * 0.62);
  });
  (rig.tail || []).forEach((n) => R(n, Math.sin(w * 1.3) * 0.12 + rear * 0.3, Math.sin(w * 0.8) * 0.1, 0));
}

// =====================================================================================
// THE WHALES: orca (black and white, a tall dorsal fin, a mouth full of pegs) and narwhal (mottled, a spiral tusk)
// =====================================================================================
/** horizontal tail flukes on piece `n` of a carcass */
function flukes(K, n, z, y, o, over, und, wet) {
  for (const sd of [-1, 1]) K.hard[n].push(fin(o).shade(flipShade(over, und, over, o.span, sd)).pbr(wet).rot(0, 0, -sd * 90).at(sd * 0.008, y, z));
}
function orcaDesc(def) {
  const black = num(def.color, 0x15171c), top = mix(black, 0x000004, 0.3), white = 0xf4f4ee, grey = mix(black, 0x8a929c, 0.55), mouth = 0xb85a66, tooth = 0xf4efdf, wet = 0.2;
  const CY = 0.07;
  const TAB = [
    { z: 1.08, w: 0.05, h: 0.045, y: CY - 0.035 }, { z: 1.02, w: 0.1, h: 0.09, y: CY - 0.025 }, { z: 0.9, w: 0.16, h: 0.155, y: CY - 0.008 }, { z: 0.72, w: 0.215, h: 0.22, y: CY },
    { z: 0.45, w: 0.255, h: 0.27, y: CY }, { z: 0.15, w: 0.26, h: 0.28, y: CY }, { z: -0.15, w: 0.225, h: 0.25, y: CY + 0.005 }, { z: -0.45, w: 0.15, h: 0.19, y: CY + 0.015 },
    { z: -0.7, w: 0.085, h: 0.125, y: CY + 0.025 }, { z: -0.9, w: 0.045, h: 0.075, y: CY + 0.03 }, { z: -1.02, w: 0.03, h: 0.04, y: CY + 0.032 },
  ];
  const sk = (p, part) => p.color(part === 'top' ? top : black).pbr(wet).bump(0.002, 30).tint(0.1, 9);
  const K = carcass(TAB, [['body', 1.08, -0.2], ['tail0', -0.2, -0.46], ['tail1', -0.46, -0.7], ['tail2', -0.7, -0.88], ['tail3', -0.88, -1.02]], 'body', sk, { pivot: 0.2, core: (x, y) => (y < CY - 0.05 ? white : black) });
  const { at, skin, prims, hard } = K;
  // the melon, and the roots of the paddles
  prims.body.push(sk(S.ellipsoid(0.14, 0.1, 0.15).at(0, CY + 0.085, 0.82).blend(0.07), 'top'), ...S.mirrorX([sk(S.ellipsoid(0.05, 0.04, 0.09).at(at(0.5).w - 0.035, CY - 0.15, 0.5).blend(0.04), 'core')]));
  const headHull = prims.body.slice();
  // white: chin, throat and belly, sweeping up the flank behind the dorsal fin
  const bl = (z) => { const q = at(z), flank = Math.exp(-(((z + 0.42) / 0.2) ** 2)); return q.y - q.h * (lerp(0.45, 0.2, smooth((z - 0.55) / 0.35)) - flank * 0.78); };
  K.belly(bl, white, 0.012, wet);
  // the eye patch and the grey saddle
  for (const sd of [-1, 1]) { const q = skin(0.73, sd * 64); prims.body.push(S.ellipsoid(0.05, 0.052, 0.105).rot(-10, 0, 0).at(q.p[0], q.p[1], q.p[2]).color(white).pbr(wet).paint(0.005, 0)); }
    for (const [n, z] of [['body', -0.14], ['tail0', -0.26]]) for (const sd of [-1, 1]) { const q = skin(z, sd * 34); prims[n].push(S.ellipsoid(0.07, 0.05, 0.1).at(q.p[0], q.p[1], q.p[2]).color(grey).pbr(wet).paint(0.03, 0)); }
  eyes(K, 'body', surfer(headHull), 0.875, CY - 0.012, 0.019, { iris: 0x3a2a1a, rim: 0x0a0806, white: 0x241c14, pupilDeg: 24, irisDeg: 58, rough: 0.05 }, { socket: 0x08090c });
  prims.body.push(S.ellipsoid(0.028, 0.02, 0.035).at(0, CY + 0.2, 0.7).cut(0.006).color(0x08090c));   // blowhole
  // ---- jaws: a white chin and two rows of blunt pegs ----
  const JW = addJaw(K, 'body', { tip: 1.08, hinge: 0.78, yT: CY - 0.04, yH: CY - 0.075, mouth, sk, palate: 0.045, tongue: 0.02, back: 0.05, belly: white, bellyLine: () => CY + 0.3, wet, jawTip: 1.065 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  teeth(hard.body, sfH, { z0: 0.84, z1: 1.05, n: 8, mY: JW.mY, up: 1, r: 0.0095, len: 0.03, col: tooth, hook: 0.15, rake: 4, splay: 4 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: 0.85, z1: 1.04, n: 7, mY: JW.mY, up: -1, r: 0.0095, len: 0.03, col: tooth, hook: 0.15, rake: -4, splay: 4 });
  // ---- the tall dorsal fin, flukes and paddles ----
  hard.body.push(fin({ span: 0.52, chord: 0.3, tip: 0.16, sweep: 0.26, thick: 0.09, pw: 0.8, curve: 1.5, rows: 9 }).shade(() => top).pbr(wet).at(0, at(0.1).y + at(0.1).h - 0.035, 0.12));
  flukes(K, 'tail3', -0.965, at(-1.0).y, { span: 0.36, chord: 0.25, tip: 0.1, sweep: 0.5, thick: 0.1, pw: 0.85, curve: 1.6, rows: 8 }, black, white, wet);
  prims.tail3.push(sk(S.ellipsoid(0.07, 0.03, 0.06).at(0, at(-1.0).y, -0.99).blend(0.03), 'core'));
  const paddle = (sd) => [fin({ span: 0.3, chord: 0.2, peak: 0.5, root: 0.6, tip: 0.55, pw: 1.7, sweep: 0.36, thick: 0.12, rows: 8 }).shade(flipShade(black, mix(black, 0x50565e, 0.5), black, 0.3, sd)).pbr(wet)];
  const nodes = K.nodes({ detail: { default: 0.5, body: 0.54 }, minRes: { body: 16, tail0: 14, tail1: 16, tail2: 20, tail3: 30 } });
  nodes.push(JW.node(jawHard, 5, 0.66));
  nodes.push(finNode(K, 'finL', 'body', [at(0.5).w - 0.03, CY - 0.16, 0.52], [-22, -14, -104], paddle(1)), finNode(K, 'finR', 'body', [-(at(0.5).w - 0.03), CY - 0.16, 0.52], [-22, 14, 104], paddle(-1)));
  return { kind: 'orca', nodes };
}
function animOrca(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  // porpoising, and every so often a full breach: up through the surface, jaws wide, and back in nose first
  const w = t * 2.3 + phase, s = Math.sin(w), co = Math.cos(w), wb = t * 7 + phase;
  const c = frac(t * 0.13 + phase * 0.21), u = clamp(c / 0.3, 0, 1), breach = pulse(c, 0.0, 0.3), tip = Math.sin(u * PI * 2) * (c < 0.3 ? 1 : 0), calm = 1 - breach;
  P(rig.body, 0, 0.02 + s * 0.06 * calm + breach * 0.3, breach * 0.1);
  R(rig.body, -co * 0.15 * calm - tip * 0.5, 0, Math.sin(w * 0.5) * 0.04 + breach * 0.25);
  R(rig.jaw, 0.02 + Math.max(0, s) * 0.05 + pulse(c, 0.04, 0.26) * 0.5);
  (rig.tail || []).forEach((n, i) => R(n, Math.sin(wb - i * 0.8) * (0.07 + i * 0.06) + co * 0.06 * calm - tip * 0.1, 0, 0));
  (rig.fins || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, -0.1 - s * 0.14, 0, sg * (co * 0.2 + 0.05 + breach * 0.5)); });
}

/** a narwhal's tooth: base at the origin, point along +Y, radius 1 at the base, wound with a spiral groove */
function tuskGeo() {
  return cached('tusk', () => {
    const rows = 18, seg = 10, rings = [];
    for (let i = 0; i <= rows; i++) { const v = i / rows, r = (1 - v) ** 0.8 * 0.97 + 0.03, ring = []; for (let k = 0; k < seg; k++) { const a = (k / seg) * PI * 2, rr = r * (1 + 0.22 * Math.cos(2 * a - v * 26)); ring.push([Math.cos(a) * rr, v, Math.sin(a) * rr]); } rings.push(ring); }
    return loft(rings);
  });
}
function narwhalDesc(def) {
  const grey = num(def.color, 0x8e98a2), back = mix(grey, 0x2a3038, 0.6), spot = mix(grey, 0x14181e, 0.75), white = 0xf2f2ec, wet = 0.26;
  const CY = 0.085;
  const TAB = [
    { z: 0.62, w: 0.06, h: 0.06, y: CY - 0.03 }, { z: 0.57, w: 0.11, h: 0.11, y: CY - 0.012 }, { z: 0.45, w: 0.152, h: 0.165, y: CY + 0.002 }, { z: 0.25, w: 0.182, h: 0.195, y: CY },
    { z: 0.0, w: 0.2, h: 0.215, y: CY }, { z: -0.25, w: 0.185, h: 0.2, y: CY }, { z: -0.5, w: 0.13, h: 0.155, y: CY + 0.01 }, { z: -0.7, w: 0.075, h: 0.105, y: CY + 0.02 },
    { z: -0.86, w: 0.04, h: 0.06, y: CY + 0.025 }, { z: -0.95, w: 0.028, h: 0.035, y: CY + 0.027 },
  ];
  const sk = (p, part) => p.color(part === 'top' ? back : part === 'bottom' ? white : grey).pbr(wet).bump(0.002, 30).tint(0.14, 12);
  const K = carcass(TAB, [['body', 0.62, -0.3], ['tail0', -0.3, -0.52], ['tail1', -0.52, -0.72], ['tail2', -0.72, -0.95]], 'body', sk, { pivot: 0.1, core: (x, y) => (y < CY - 0.03 ? white : grey) });
  const { at, skin, prims, hard } = K;
  prims.body.push(sk(S.ellipsoid(0.125, 0.1, 0.12).at(0, CY + 0.085, 0.42).blend(0.06), 'top'), ...S.mirrorX([sk(S.ellipsoid(0.04, 0.03, 0.07).at(at(0.25).w - 0.03, CY - 0.11, 0.26).blend(0.035), 'core')]));
  const headHull = prims.body.slice();
  // a dark back breaking up into blotches down the flanks, pale blotches below, a white belly
  K.stripe(0.5, -0.92, 0, (z) => at(z).h * 0.5, (p) => p.color(back).pbr(wet).paint(0.03, 0), 0.12);
  K.stripe(0.2, -0.75, 0, 0.022, (p) => p.color(mix(back, 0x14181e, 0.5)).pbr(wet).paint(0.008, 0.008), 0.12);   // the low ridge it has for a dorsal fin
  K.dapple({ n: 210, z0: 0.55, z1: -0.9, th0: 0, th1: 108, r0: 0.008, r1: 0.03, seed: 101, wref: 0.18, make: (p, i) => p.color(i % 4 ? spot : mix(spot, grey, 0.4)).pbr(wet).paint(0.007, 0) });
  K.dapple({ n: 90, z0: 0.5, z1: -0.85, th0: 40, th1: 125, r0: 0.009, r1: 0.026, seed: 111, wref: 0.18, make: (p) => p.color(white).pbr(wet).paint(0.008, 0) });
  K.belly((z) => at(z).y - at(z).h * 0.5, white, 0.03, wet);
  eyes(K, 'body', surfer(headHull), 0.47, CY - 0.02, 0.014, { iris: 0x2a1c10, rim: 0x0a0806, white: 0x1c1410, pupilDeg: 24, irisDeg: 58, rough: 0.05 }, { socket: 0x0c0e12 });
  // a small upturned mouth, the blowhole
  for (const sd of [-1, 1]) { const sf = surfer(headHull), a = sf([sd * 0.6, CY - 0.075, 0.5], [-sd, 0, 0]), b = sf([sd * 0.6, CY - 0.06, 0.585], [-sd, 0, 0]); prims.body.push(S.capsule(a, b, 0.007).color(0x24181c).paint(0.004, -0.006)); }
  prims.body.push(S.ellipsoid(0.02, 0.016, 0.026).at(0, CY + 0.185, 0.36).cut(0.005).color(0x0c0e12));
  // the tusk: the left tooth, grown out through the lip in a left-handed spiral
  hard.body.push(aim(H.geo(tuskGeo()).shade((x, y, z) => mix(0xf4ecd4, 0x8a7a58, clamp(0.5 - Math.cos(2 * Math.atan2(z, x) - y * 26) * 0.9, 0, 1) * 0.75)).pbr(0.3).scale(0.024, 0.76, 0.024), [0.028, CY - 0.012, 0.56], [0.012, 0.045, 1], 30));
  prims.body.push(sk(S.sphere(0.04).at(0.028, CY - 0.01, 0.6).blend(0.02), 'core'));
  flukes(K, 'tail2', -0.9, at(-0.93).y, { span: 0.27, chord: 0.2, tip: 0.1, sweep: 0.42, thick: 0.1, pw: 0.85, curve: 1.5, rows: 8 }, back, white, wet);
  prims.tail2.push(sk(S.ellipsoid(0.055, 0.025, 0.05).at(0, at(-0.93).y, -0.925).blend(0.03), 'core'));
  const paddle = (sd) => [fin({ span: 0.17, chord: 0.12, peak: 0.45, root: 0.6, tip: 0.5, pw: 1.6, sweep: 0.4, thick: 0.13, rows: 7 }).shade(flipShade(back, grey, back, 0.17, sd)).pbr(wet)];
  const nodes = K.nodes({ detail: { default: 0.6, body: 0.66 }, minRes: { body: 16, tail0: 16, tail1: 20, tail2: 32 } });
  nodes.push(finNode(K, 'finL', 'body', [at(0.25).w - 0.025, CY - 0.12, 0.27], [-22, -14, -104], paddle(1)), finNode(K, 'finR', 'body', [-(at(0.25).w - 0.025), CY - 0.12, 0.27], [-22, 14, 104], paddle(-1)));
  return { kind: 'narwhal', nodes };
}
function animNarwhal(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const w = t * 2.6 + phase, s = Math.sin(w), co = Math.cos(w), wb = t * 8 + phase;
  // the thrust: it draws back, drives the tusk forward and up, then fences with it
  const c = frac(t * 0.19 + phase * 0.23), back = pulse(c, 0.0, 0.16), jab = pulse(c, 0.1, 0.34), fence = Math.sin(clamp((c - 0.16) / 0.2, 0, 1) * PI * 3) * jab;
  P(rig.body, 0, 0.015 + s * 0.045 * (1 - jab) + jab * 0.07, jab * 0.2 - back * 0.1);
  R(rig.body, -co * 0.13 * (1 - jab) - jab * 0.3, fence * 0.16, Math.sin(w * 0.5) * 0.05);
  (rig.tail || []).forEach((n, i) => R(n, Math.sin(wb - i * 0.9) * (0.08 + i * 0.07) * (1 + jab * 0.6) + co * 0.05, 0, 0));
  (rig.fins || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, -0.1 - s * 0.14, 0, sg * (co * 0.2 + 0.05 + jab * 0.3)); });
}

// =====================================================================================
// ICE KRAKEN: a pale kraken of the pack ice. A tall mantle armoured in plate ice and crowned with icicles, cold lamps
// for eyes, glassy arms ringed in pale blue
// =====================================================================================
const IK = { NA: 6, yaw: [20, -20, 62, -62, 108, -108, 152, -152], len: [0.2, 0.19, 0.18, 0.17, 0.15, 0.13], r: [0.088, 0.075, 0.062, 0.049, 0.037, 0.026, 0.011],
  lift: [54, 54, 30, 30, 24, 24, 36, 36], bend: [[4, 24, 30, 26, -18, -42], [2, 18, 22, 8, -24, -40]] };
function iceKrakenDesc(def) {
  const base = num(def.color, 0xcfe4f2), frost = mix(base, 0xffffff, 0.7), blue = mix(tone(base, 0.0, 0.25, -0.18), 0x4a9ad8, 0.5), deep = mix(blue, 0x1a4a8a, 0.55), flesh = mix(base, 0xeaf8ff, 0.5), band = mix(blue, 0x8fd8ff, 0.4), lamp = 0x7fe8ff;
  const rime = (p, c = base) => p.color(c).pbr(0.34).bump(0.008, 15, 'rock').tint(0.2, 7);
  const ice = (seed) => iceShade(frost, mix(base, blue, 0.35), deep, seed);
  const HO = [0, 0.1, 0], MO = [0, 0.3, -0.05], ER = 0.096;
  // ---- head: the skirt the arms grow from, two eye turrets ----
  const head = [
    rime(S.ellipsoid(0.37, 0.17, 0.37).at(0, 0.07, 0.02)),
    rime(S.ellipsoid(0.3, 0.24, 0.3).at(0, 0.24, 0.0).blend(0.07)),
    ...S.mirrorX([rime(S.sphere(0.13).at(0.21, 0.3, 0.21).blend(0.05), mix(base, blue, 0.3))]),
    rime(S.ellipsoid(0.12, 0.07, 0.1).at(0, 0.16, 0.33).blend(0.05), mix(base, blue, 0.4)),
    ...S.mirrorX([S.sphere(ER * 1.04).at(0.265, 0.31, 0.265).cut(0.008).color(deep)]),
  ];
  const headHard = [...H.mirrorX([eye(ER, { iris: lamp, rim: 0x1a5aa8, white: 0xd4f8ff, pupil: 0x0a2a5a, shape: 'slit', pupilDeg: 17, irisDeg: 62, rough: 0.1, glow: 1.15, seg: 18 }).rot(-6, 45, 0).at(0.258, 0.31, 0.258)])];
  // a shelf of ice over each eye, hung with icicles
  for (const sd of [-1, 1]) {
    headHard.push(H.geo(plateGeo(sd + 3)).shade(ice(sd)).pbr(0.14, 0.1).scale(0.13, 0.04, 0.1).rot(-8, 0, -sd * 22).rot(0, sd * 45, 0).at(sd * 0.2, 0.445, 0.19));
    for (let k = 0; k < 5; k++) { const a = (sd * (45 + (k - 2) * 26)) * DEG; headHard.push(shard(0.03 + rnd(k, sd + 2) * 0.05, 0.014, k + sd, 4).rot(180, 0, 0).at(sd * 0.2 + Math.sin(a) * 0.11, 0.452 - Math.abs(k - 2) * 0.008, 0.19 + Math.cos(a) * 0.09).shade(ice(k)).pbr(0.1, 0.1).glow(0.12).lod(1)); }
  }
  // ---- mantle: a leaning spire of frozen flesh ----
  const axis = (h) => [0, h, -0.05 - (h - 0.3) * 0.46];
  const mantle = [
    rime(S.ellipsoid(0.31, 0.3, 0.31).at(0, 0.42, -0.12), mix(base, blue, 0.3)),
    rime(S.ellipsoid(0.275, 0.3, 0.275).at(0, 0.68, -0.24).blend(0.08), mix(base, blue, 0.12)),
    rime(S.ellipsoid(0.21, 0.26, 0.21).at(0, 0.92, -0.35).blend(0.08)),
    rime(S.capsule([0, 1.02, -0.4], [0, 1.2, -0.5], 0.125, 0.035).blend(0.06), mix(base, blue, 0.3)),
  ];
  const sfM = surfer(mantle);
  /** a point on the mantle at height h, az degrees round from the front, and the way out from it */
  const mAt = (h, az, out = 0) => { const a = az * DEG, c = axis(h), d = norm([Math.sin(a), 0.25, Math.cos(a)]), p = sfM([c[0] + d[0] * 1.2, c[1] + d[1] * 1.2, c[2] + d[2] * 1.2], [-d[0], -d[1], -d[2]]); return { p: [p[0] + d[0] * out, p[1] + d[1] * out, p[2] + d[2] * out], n: d }; };
  // veins of cold light under the ice, branching down the brow
  const vein = (pts, r = 0.011) => { for (let i = 0; i < pts.length - 1; i++) mantle.push(S.capsule(mAt(pts[i][0], pts[i][1]).p, mAt(pts[i + 1][0], pts[i + 1][1]).p, r, r * 0.8).color(0x49b4f0).pbr(0.2).glow(0.75).paint(0.005, -0.006)); };
  vein([[1.0, 0], [0.86, 14], [0.72, 4], [0.58, 20], [0.44, 10]]); vein([[0.72, 4], [0.62, -18], [0.48, -26]]); vein([[0.86, 14], [0.8, 44], [0.66, 58], [0.5, 50]]); vein([[0.95, -30], [0.8, -48], [0.64, -40], [0.52, -62]]);
  for (let i = 0; i < 40; i++) { const q = mAt(0.3 + rnd(i, 31) * 0.85, (rnd(i, 32) - 0.5) * 360); mantle.push(S.sphere(0.03 + rnd(i, 33) * 0.06).at(q.p[0], q.p[1], q.p[2]).color(i % 3 ? frost : mix(base, blue, 0.5)).pbr(0.5).paint(0.02, 0)); }
  const mantleHard = [];
  // armour: plates of pack ice frozen over the back and flanks
  for (let i = 0; i < 20; i++) {
    const h = 0.34 + rnd(i, 41) * 0.72, az = 180 + (rnd(i, 42) - 0.5) * 250, q = mAt(h, az, -0.012), r = (0.075 + rnd(i, 43) * 0.07) * (1.25 - h * 0.4);
    mantleHard.push(aim(H.geo(plateGeo(i % 5)).shade(ice(i)).pbr(0.14, 0.1).scale(r, 0.03 + rnd(i, 44) * 0.035, r * (0.8 + rnd(i, 45) * 0.5)), q.p, q.n, rnd(i, 46) * 360).lod(i % 3 ? 2 : 9));
  }
  // icicle spines: a ragged crest down the back, smaller rows either side, a crown at the tip
  const spine = (h, az, len, r, up, seed, lodN = 9) => { const q = mAt(h, az, -0.02); mantleHard.push(aim(shard(len, r, seed, 5), q.p, [q.n[0], q.n[1] + up, q.n[2]], seed * 40).shade(ice(seed + 9)).pbr(0.1, 0.1).glow(0.1).lod(lodN)); };
  for (let i = 0; i < 8; i++) spine(1.08 - i * 0.1, 180, 0.3 - i * 0.022 + rnd(i, 51) * 0.05, 0.05 - i * 0.003, 0.9 - i * 0.05, i);
  for (const sd of [-1, 1]) for (let i = 0; i < 6; i++) spine(1.0 - i * 0.12, 180 + sd * (48 + i * 5), 0.15 + rnd(i, 52 + sd) * 0.07, 0.03, 0.7, i + sd * 3 + 20, 2);
  for (let i = 0; i < 5; i++) spine(1.12, i * 72 + 20, 0.12 + rnd(i, 55) * 0.1, 0.03, 1.6, i + 40, 2);
  for (let i = 0; i < 9; i++) spine(0.5 + rnd(i, 57) * 0.5, (rnd(i, 58) - 0.5) * 150, 0.05 + rnd(i, 59) * 0.05, 0.016, 0.2, i + 60, 1);

  const nodes = [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: HO, prims: into(HO, head), hard: into(HO, headHard), detail: 0.85 },
    { name: 'mantle', parent: 'body', rig: 'core', pos: sub(MO, HO), prims: into(MO, mantle), hard: into(MO, mantleHard), detail: 0.6 },
  ];
  // ---- arms ----
  IK.yaw.forEach((yaw, a) => {
    const y = yaw * DEG, bend = IK.bend[a < 2 ? 0 : 1];
    const seg = (j, r0, r1, L) => {
      const prims = [
        S.capsule([0, 0, 0], [0, 0, L], r0, r1).color(flesh).pbr(0.16).glow(0.1).bump(0.0025, 36).tint(0.1, 12),
        S.box(1, 0.5, L + 0.3, 0.02).at(0, -0.25 - r0 * 0.3, L / 2).color(mix(flesh, 0xffffff, 0.6)).pbr(0.22).paint(r0 * 0.3, 0),
        ...[0.22, 0.72].map((f) => S.torus(lerp(r0, r1, f), 0.008 + r0 * 0.2).rot(90, 0, 0).at(0, 0, L * f).color(band).pbr(0.14).glow(0.3).paint(0.006, 0.003)),
      ];
      const hard = [H.geo(coreGeo(r0, r1, L, 0.78)).color(mix(flesh, band, 0.3)).pbr(0.2)];
      // rime: thorns of ice along the upper side, suckers like frozen drops below
      if (j < 4) for (let k = 0; k < 2; k++) { const f = (k + 0.5) / 2; hard.push(shard(0.045 + r0 * 0.55, 0.012 + r0 * 0.13, a * 7 + j * 3 + k, 4).rot(-24, 0, 0).at(0, lerp(r0, r1, f) * 0.85, L * f).shade(ice(a + j + k)).pbr(0.1, 0.1).glow(0.1).lod(1)); }
      if (j < 5) for (let k = 0; k < 1; k++) for (const e of [-1, 1]) { const f = (k + 0.5) / 1, rr = lerp(r0, r1, f); hard.push(H.sphere(rr * 0.3, 5).scale(1, 0.55, 1).at(e * rr * 0.42, -rr * 0.86, L * f).color(band).pbr(0.15).glow(0.2).lod(0)); }
      return { prims, hard };
    };
    chain(nodes, `arm${a}`, 'body', sub([Math.sin(y) * 0.27, 0.085, Math.cos(y) * 0.27 + 0.02], HO), [[0, yaw, 0], [-IK.lift[a], 0, 0]], IK.len, IK.r,
      { rig: 'arms', seg, detail: 0.62, minRes: 15, rest: (j) => [bend[j] + (rnd(a, j) - 0.5) * 10, (rnd(a, j + 9) - 0.5) * 16, 0] });
  });
  return { kind: 'iceKraken', nodes };
}
function animIceKraken(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const breath = Math.sin(t * 1.5 + phase);
  if (rig.core) rig.core.scale.set(1 + breath * 0.025, 1 - breath * 0.012, 1 + breath * 0.025);
  R(rig.core, Math.sin(t * 0.6 + phase) * 0.04, 0, Math.sin(t * 0.45 + phase * 2) * 0.04);
  R(rig.body, Math.sin(t * 0.7 + phase) * 0.03, Math.sin(t * 0.4 + phase) * 0.06, Math.sin(t * 0.55 + phase * 2) * 0.03);
  P(rig.body, 0, Math.sin(t * 0.9 + phase) * 0.012, 0);
  // arms writhe; in turn they rear out of the sea and crash down
  const A = rig.arms || [], c = t * 0.11 + phase * 0.17;
  for (let i = 0; i < A.length; i++) {
    const a = Math.floor(i / IK.NA), j = i % IK.NA, front = a < 2, ca = frac(c + (a >> 1) * 0.07 + (a & 1) * 0.5);
    const lift = pulse(ca, 0.0, 0.4), slam = pulse(ca, 0.28, 0.46);
    const up = j === 0 ? -(front ? 0.55 : 0.4) * lift + slam * (front ? 0.85 : 0.6) : j < 3 ? -0.14 * lift + slam * 0.06 : 0.22 * lift - slam * 0.2;
    R(A[i], Math.sin(t * 1.5 - j * 0.8 + a * 1.7 + phase) * (0.05 + j * 0.055) + up, Math.sin(t * 1.1 - j * 0.7 + a * 2.3 + phase) * (0.05 + j * 0.05), 0);
  }
}

// =====================================================================================
// POLAR SERPENT: a white-furred sea serpent with a mane of feathers, belly plates of blue ice and a frill of frost
// round a head that breathes a plume of frozen mist. It swims in standing arches.
// =====================================================================================
// neck: elevation of each segment and then of the head (degrees above the horizontal); TH, K: the wave down the body
const PS = { NN: 6, NT: 16, LN: 0.16, LT: 0.11, ZB: 0.35, BL: 0.2, HL: 0.28, neck: [26, 50, 68, 70, 54, 28, 4], rear: [14, 22, 18, 6, -8, -30, -42], blow: [0, 0, -6, -18, -30, -40, -32], TH: 55, K: 5.0, PH0: 0.9, Y0: 0.06, AMP: 0.171 };
/** elevation (degrees) of every piece for wave phase wt: { b, n: [neck..., head], t: [tail...] } */
function psPose(wt, rear = 0, blow = 0, sway = null) {
  const b = PS.TH * Math.cos(-wt), n = [], tl = [];
  for (let j = 0; j <= PS.NN; j++) n.push(PS.neck[j] + Math.max(0, 1 - (j + 1) / 3) * b + PS.rear[j] * rear + PS.blow[j] * blow + (sway ? sway(j) : 0));
  for (let i = 0; i < PS.NT; i++) tl.push(PS.TH * Math.cos(PS.K * (PS.BL / 2 + (i + 0.5) * PS.LT) - wt));
  return { b, n, t: tl, y: PS.Y0 + PS.AMP * Math.sin(wt) };
}
function polarSerpentDesc(def) {
  const white = num(def.color, 0xeef3f8), fur = mix(white, 0xffffff, 0.5), shade = mix(white, 0x7f9cc4, 0.6), belly = 0x86c4ea, plate = 0x3f86c0, frostC = 0xd8f2ff, iceB = 0x4aa0e0, mouth = 0x4a6aa8, tooth = 0xf2fbff;
  const rest = psPose(PS.PH0), YR = rest.y, zb = PS.ZB, zt = zb - PS.BL, hz = zb + PS.NN * PS.LN, tip = hz + PS.HL, zEnd = zt - PS.NT * PS.LT;
  const TAB = [
    { z: tip, w: 0.028, h: 0.024, y: YR - 0.006 }, { z: tip - 0.05, w: 0.055, h: 0.045, y: YR - 0.004 }, { z: tip - 0.12, w: 0.07, h: 0.06, y: YR }, { z: tip - 0.2, w: 0.094, h: 0.084, y: YR }, { z: hz, w: 0.088, h: 0.086, y: YR },
    { z: hz - 0.16, w: 0.082, h: 0.088, y: YR }, { z: zb + 0.4, w: 0.095, h: 0.1, y: YR }, { z: zb, w: 0.108, h: 0.114, y: YR }, { z: zt - 0.45, w: 0.108, h: 0.114, y: YR },
    { z: zt - 1.0, w: 0.092, h: 0.098, y: YR }, { z: zt - 1.4, w: 0.064, h: 0.07, y: YR }, { z: zt - 1.65, w: 0.034, h: 0.04, y: YR }, { z: zEnd, w: 0.012, h: 0.015, y: YR },
  ];
  const sk = (p, part) => p.color(part === 'top' ? fur : white).pbr(0.78).bump(0.0055, 44, 'fur').tint(0.1, 9);
  const segs = [['head', tip, hz]];
  for (let j = PS.NN - 1; j >= 0; j--) segs.push([`neck${j}`, zb + (j + 1) * PS.LN, zb + j * PS.LN]);
  segs.push(['body', zb, zt]);
  for (let i = 0; i < PS.NT; i++) segs.push([`tail${i}`, zt - i * PS.LT, zt - (i + 1) * PS.LT]);
  const K = carcass(TAB, segs, 'body', sk, { pivot: (zb + zt) / 2, core: (x, y) => (y < YR - 0.03 ? belly : white) });
  const { at, skin, prims, hard } = K;
  // skull: heavy brows, a ridge down the snout
  prims.head.push(...S.mirrorX([sk(S.capsule([0.05, YR + 0.07, tip - 0.14], [0.075, YR + 0.085, tip - 0.24], 0.018, 0.024).blend(0.035), 'top'), sk(S.ellipsoid(0.035, 0.04, 0.06).at(0.07, YR + 0.0, hz + 0.04).blend(0.03), 'core')]),
    sk(S.capsule([0, YR + 0.05, tip - 0.06], [0, YR + 0.085, tip - 0.2], 0.016, 0.024).blend(0.03), 'top'));
  const headHull = prims.head.slice();
  // blue shadow in the fur along the flanks; the belly is plated in blue ice
  K.dapple({ n: 110, z0: hz, z1: zEnd + 0.15, th0: 55, th1: 105, r0: 0.012, r1: 0.035, seed: 121, wref: 0.11, make: (p) => p.color(shade).pbr(0.78).paint(0.012, 0), stretch: 2.2 });
  const bellyLine = (z) => at(z).y - at(z).h * 0.3;
  K.belly(bellyLine, belly, 0.012, 0.24, 0.35);
  for (let z = tip - 0.3; z > zEnd + 0.1; z -= 0.045) prims[K.nodeOf(z)].push(S.box(0.5, 0.4, 0.009, 0.002).at(0, at(z).y - at(z).h * 0.42 - 0.2, z).color(plate).pbr(0.3, 0.3).paint(0.005, -0.005));
  eyes(K, 'head', surfer(headHull), tip - 0.18, YR + 0.034, 0.019, { iris: 0x8feaff, rim: 0x1a4a9a, white: 0xd8f6ff, pupil: 0x0a1a4a, shape: 'slit', pupilDeg: 15, irisDeg: 58, rough: 0.08, glow: 0.95 }, { socket: 0x1a2a40 });
  prims.head.push(...S.mirrorX([S.sphere(0.008).at(0.022, YR + 0.03, tip - 0.03).color(0x1a2a40).paint(0.003, -0.004)]));
  // ---- jaws: fangs of ice ----
  const JW = addJaw(K, 'head', { tip, hinge: tip - 0.215, yT: YR - 0.006, yH: YR - 0.024, mouth, sk, palate: 0.022, tongue: 0.01, tongueCol: 0x7ab8e8, back: 0.04, belly, bellyLine, wet: 0.24, jawTip: tip - 0.02 });
  const sfH = surfer(headHull), sfJ = surfer(JW.jawHull);
  teeth(hard.head, sfH, { z0: tip - 0.17, z1: tip - 0.03, n: 8, mY: JW.mY, up: 1, r: 0.006, len: (i) => 0.022 + (i > 5 ? 0.024 : i % 2 ? 0.008 : 0), col: tooth, hook: 0.3, rake: 8, lod: 1 });
  const jawHard = [];
  teeth(jawHard, sfJ, { z0: tip - 0.165, z1: tip - 0.04, n: 7, mY: JW.mY, up: -1, r: 0.006, len: (i) => 0.022 + (i > 4 ? 0.02 : 0), col: tooth, hook: 0.3, rake: -6, lod: 1 });
  for (let k = 0; k < 4; k++) jawHard.push(shard(0.05 + rnd(k, 131) * 0.04, 0.012, k, 4).rot(180 - 25, 0, 0).at((k - 1.5) * 0.022, YR - 0.07, tip - 0.14 - k % 2 * 0.03).shade(iceShade(frostC, frostC, iceB, k)).pbr(0.12, 0.1).glow(0.15).lod(1));   // an icicle beard
  // ---- the frost frill: blades of ice standing round the back of the skull, and two swept horns ----
  const blade = () => fin({ span: 1, chord: 0.46, peak: 0.3, root: 0.5, tip: 0.06, pw: 1.0, sweep: 0.45, thick: 0.07, rows: 5, seg: 3 }).shade((x, y) => mix(frostC, iceB, clamp(1 - y * 1.15, 0, 1) ** 1.5)).pbr(0.14, 0.1).glow(0.22);
  [[-112, 0.15], [-78, 0.2], [-45, 0.24], [-15, 0.2], [15, 0.2], [45, 0.24], [78, 0.2], [112, 0.15]].forEach(([th, L]) => { const q = skin(hz + 0.035, th, -0.015); hard.head.push(blade().scale(L).rot(-42, 0, 0).rot(0, 0, -th).at(q.p[0], q.p[1], q.p[2])); });
  for (const sd of [-1, 1]) hard.head.push(aim(shard(0.24, 0.026, sd + 5, 5), [sd * 0.05, YR + 0.07, tip - 0.25], [sd * 0.35, 0.55, -0.8]).shade(iceShade(frostC, frostC, iceB, sd)).pbr(0.12, 0.1).glow(0.15));
  // ---- the mane: white feathers tipped with blue, three rows down the neck, one along the back ----
  const feather = (L, lodN) => { const f = fin({ span: 1, chord: 0.4, peak: 0.35, root: 0.45, tip: 0.1, pw: 1.1, sweep: 0.85, thick: 0.09, rows: 4, seg: 3 }).shade((x, y) => mix(0xffffff, 0x8fcaf0, clamp(y, 0, 1) ** 2.2 * 0.85)).pbr(0.6).scale(L); return lodN == null ? f : f.lod(lodN); };
  let fi = 0;
  for (let z = hz - 0.02; z > zEnd + 0.12; z -= z > zb ? 0.042 : 0.062, fi++) {
    const n = K.nodeOf(z), neck = z > zb, L = (neck ? 0.14 : 0.105) * (0.8 + rnd(fi, 141) * 0.4) * clamp(at(z).w / 0.09, 0.3, 1);
    const q = skin(z, 0, -0.012);
    hard[n].push(feather(L, fi % 3 ? 2 : null).rot(-18 + rnd(fi, 142) * 12, 0, (rnd(fi, 143) - 0.5) * 16).at(q.p[0], q.p[1], q.p[2]));
    if (neck) for (const sd of [-1, 1]) { const th = sd * (26 + rnd(fi, 144 + sd) * 14), s = skin(z - 0.02, th, -0.012); hard[n].push(feather(L * 0.85, 1).rot(-22, 0, -th).at(s.p[0], s.p[1], s.p[2])); }
  }
  // tail tuft
  for (let k = 0; k < 5; k++) hard[`tail${PS.NT - 1}`].push(feather(0.11, k < 2 ? null : 1).rot(-90 + (k - 2) * 8, 0, 0).rot(0, 0, k * 72).at(0, YR, zEnd + 0.03));
  const rot = {}, det = { default: 0.78, head: 1.4 }, minRes = {};
  rot.body = [-rest.b, 0, 0];
  for (let j = 0; j <= PS.NN; j++) { rot[j < PS.NN ? `neck${j}` : 'head'] = [-(rest.n[j] - (j ? rest.n[j - 1] : rest.b)), 0, 0]; if (j < PS.NN) minRes[`neck${j}`] = 15; }
  minRes.body = 15;
  for (let i = 0; i < PS.NT; i++) { rot[`tail${i}`] = [-(rest.t[i] - (i ? rest.t[i - 1] : rest.b)), 0, 0]; minRes[`tail${i}`] = i > 11 ? 28 : 15; }
  const nodes = K.nodes({ detail: det, rot, minRes });
  nodes.push(JW.node(jawHard, 8, 1.5));
  // ---- the breath: a plume of frozen mist and ice needles, kept folded away until it blows ----
  const puff = cached('puff', () => new THREE.IcosahedronGeometry(1, 1)), breath = [];
  for (let i = 0; i < 18; i++) { const f = i / 17, r = 0.014 + f * 0.05 * (0.7 + rnd(i, 156) * 0.6), a = i * 2.4, o = (0.004 + f * 0.11) * (i ? 1 : 0); breath.push(H.geo(puff).scale(r, r * 0.85, r * 1.3).at(Math.cos(a) * o, Math.sin(a) * o - f * f * 0.05, 0.02 + f * 0.6).color(mix(0xffffff, 0x9fd8ff, 0.2 + rnd(i, 152) * 0.7)).pbr(0.95).glow(0.55).near()); }
  for (let i = 0; i < 14; i++) { const f = rnd(i, 153), a = rnd(i, 154) * PI * 2, o = 0.02 + f * 0.14; breath.push(aim(shard(0.04 + rnd(i, 155) * 0.05, 0.008, i, 4), [Math.cos(a) * o, Math.sin(a) * o - f * 0.04, 0.08 + f * 0.5], [Math.cos(a) * 0.3, Math.sin(a) * 0.3, 1]).color(0xe8faff).pbr(0.1, 0.2).glow(0.8).lod(1)); }
  nodes.push({ name: 'breath', parent: 'head', rig: 'breath', pos: sub([0, YR - 0.018, tip - 0.01], K.ORG.head), hard: breath });
  return { kind: 'polarSerpent', nodes };
}
function animPolarSerpent(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const wt = PS.PH0 + t * 1.5 + phase, rest = psPose(PS.PH0);
  // the breath: the neck rears, the head comes down and forward, the jaws gape and the mist pours out
  const c = frac(t * 0.09 + phase * 0.19), rear = pulse(c, 0.0, 0.3), blow = smooth((c - 0.17) / 0.07) * (1 - smooth((c - 0.42) / 0.08));
  const p = psPose(wt, rear * (1 - blow), blow, (j) => Math.sin(t * 1.1 + phase - j * 0.6) * 5 * (1 - blow * 0.6));
  R(rig.body, -(p.b - rest.b) * DEG, 0, Math.sin(t * 0.8 + phase) * 0.04);
  P(rig.body, 0, p.y - rest.y, 0);
  const N = rig.necks || [], T = rig.tail || [];
  for (let j = 0; j <= N.length; j++) {
    const d = (p.n[j] - (j ? p.n[j - 1] : p.b)) - (rest.n[j] - (j ? rest.n[j - 1] : rest.b));
    R(j < N.length ? N[j] : rig.head, -fin0(d) * DEG, Math.sin(t * 0.85 + phase * 1.3 - j * 0.55) * 0.06 * (1 - blow * 0.7), 0);
  }
  for (let i = 0; i < T.length; i++) {
    const d = (p.t[i] - (i ? p.t[i - 1] : p.b)) - (rest.t[i] - (i ? rest.t[i - 1] : rest.b));
    R(T[i], -fin0(d) * DEG, Math.sin(t * 0.7 + phase - i * 0.5) * 0.035, 0);
  }
  R(rig.jaw, 0.03 + Math.max(0, Math.sin(t * 1.2 + phase)) * 0.07 + blow * 0.55 + rear * 0.15);
  const B = rig.breath && rig.breath[0];
  if (B) { const k = Math.max(0.001, blow), fl = 1 + Math.sin(t * 17 + phase) * 0.06; B.scale.set(k * fl, k * (2 - fl), k * (0.75 + 0.35 * blow)); B.rotation.z = t * 1.3 % (PI * 2); }
}

// =====================================================================================
// BERG TITAN: an iceberg that has stood up. Blocks of glacier ice split by cracks of deep blue light, snow on its
// shoulders, a floe for a pedestal, fists like calved bergs
// =====================================================================================
function bergTitanDesc(def) {
  const ice = num(def.color, 0xbfe0f4), lite = mix(ice, 0xffffff, 0.5), mid = mix(ice, 0x6fb4f0, 0.5), deep = mix(tone(ice, 0.02, 0.25, -0.22), 0x2f78d0, 0.55), snow = 0xf6fbff, glowC = 0x1f86ff, abyss = 0x0a2a6a;
  // the inner body: blocks of old blue ice, where the cracks run
  const berg = (p, c = mid) => p.color(c).pbr(0.24, 0.05).bump(0.02, 6.5, 'rock').tint(0.25, 5).blend(0.006);
  const blk = (w, h, d, rx, ry, rz, x, y, z, c) => berg(S.box(w, h, d, 0.014).rot(rx, ry, rz).at(x, y, z), c);
  // the outer body: split, flat-faced crags of white glacier ice lying over the blue
  const crag = (seed, rx, ry, rz, x, y, z, yaw = 0, tx = 0, tz = 0) => H.geo(cragGeo(seed, 0.34)).shade(iceShade(snow, mix(ice, 0xe4f3ff, 0.4), mix(deep, 0x2a70d0, 0.3), seed, 0.66)).pbr(0.2, 0.06).scale(rx, ry, rz).rot(tx, yaw, tz).at(x, y, z);
  const spire = (x, y, z, len, r, d, seed) => aim(shard(len, r, seed, 5), [x, y, z], d, seed * 50).shade(iceShade(lite, mix(ice, 0xe4f3ff, 0.5), mix(deep, 0x2a70d0, 0.2), seed, 2)).pbr(0.16, 0.08);
  const snowy = (rx, ry, rz, x, y, z) => S.ellipsoid(rx, ry, rz).at(x, y, z).blend(0.02).color(snow).pbr(0.9).bump(0.006, 14);
  /** glowing cracks: a jagged path across the face of a sculpt as seen along `dir` (an axis) */
  const crack = (list, sf, dir, path, r = 0.012) => {
    const pt = (a, b) => { const o = dir[2] ? [a, b, dir[2] * 2] : dir[0] ? [dir[0] * 2, b, a] : [a, 2, b]; return sf(o, [-dir[0], -dir[1], -dir[2]]); };
    for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < 3; k++) {
      const f0 = k / 3, f1 = (k + 1) / 3, a = pt(lerp(path[i][0], path[i + 1][0], f0), lerp(path[i][1], path[i + 1][1], f0)), b = pt(lerp(path[i][0], path[i + 1][0], f1), lerp(path[i][1], path[i + 1][1], f1));
      list.push(S.capsule(a, b, r * (1 - i / path.length * 0.5)).color(glowC).pbr(0.3).glow(1.5).paint(0.004, -0.02));
    }
  };
  // ---- the floe it stands on ----
  const floeRing = (y, k) => { const o = []; for (let i = 0; i < 11; i++) { const a = (i / 11) * PI * 2, r = (0.72 + rnd(i, 161) * 0.26) * k; o.push([Math.cos(a) * r * 1.02, y, Math.sin(a) * r * 0.9 - 0.02]); } return o; };
  const floeHard = [H.geo(cached('titanFloe', () => facet(loft([floeRing(-0.1, 1.05), floeRing(0.035, 1.03), floeRing(0.075, 0.95)])))).shade((x, y, z, nx, ny) => (ny > 0.6 ? snow : mix(lite, deep, clamp(0.3 - y * 4 + noise3(x * 5, y * 5, z * 5) * 0.5, 0, 1)))).pbr(0.3, 0.05)];
  for (let i = 0; i < 7; i++) { const a = rnd(i, 162) * PI * 2, r = 0.62 + rnd(i, 163) * 0.2, s = 0.07 + rnd(i, 164) * 0.08; floeHard.push(crag(i + 30, s * 1.4, s * 0.8, s, Math.cos(a) * r, 0.07 + s * 0.3, Math.sin(a) * r * 0.88, rnd(i, 166) * 360, rnd(i, 165) * 30).lod(2)); }
  const floe = [snowy(0.5, 0.08, 0.42, 0, 0.07, -0.02), snowy(0.2, 0.06, 0.2, -0.42, 0.075, 0.3), snowy(0.22, 0.05, 0.18, 0.4, 0.075, -0.36)];
  // ---- torso: broad in the shoulder, tapering to the waist ----
  const TO = [0, 0.12, 0];
  const torso = [
    blk(0.56, 0.42, 0.42, 4, 10, -3, 0, 0.3, 0, deep),
    blk(0.86, 0.44, 0.48, -6, -6, 4, 0, 0.67, 0.03),
    ...S.mirrorX([S.box(0.5, 0.5, 1, 0.01).rot(0, 0, 33).at(0.6, 0.38, 0).cut(0.004).color(mid)]),
    blk(0.5, 0.28, 0.4, 10, 20, 0, 0, 0.92, -0.06),
    blk(0.38, 0.3, 0.42, 0, 15, 14, 0.48, 0.88, 0.0),
    blk(0.4, 0.32, 0.42, 0, -10, -12, -0.48, 0.88, 0.0),
  ];
  const sfT = surfer(torso);
  // the heart: a hollow in the chest where the light is strongest
  torso.push(S.ellipsoid(0.085, 0.12, 0.09).rot(0, 0, 14).at(0.02, 0.66, 0.28).cut(0.012).color(0x3aa0ff).glow(1.6));
  crack(torso, sfT, [0, 0, 1], [[0.0, 0.88], [0.07, 0.78], [0.02, 0.66], [0.07, 0.5], [-0.03, 0.36], [0.05, 0.2]], 0.017);
  crack(torso, sfT, [0, 0, 1], [[0.02, 0.66], [-0.17, 0.72], [-0.3, 0.62], [-0.38, 0.72]]);
  crack(torso, sfT, [0, 0, 1], [[0.07, 0.5], [0.2, 0.5], [0.24, 0.4]]);
  crack(torso, sfT, [0, 0, 1], [[0.07, 0.78], [0.26, 0.84], [0.44, 0.96], [0.6, 0.9]]);
  crack(torso, sfT, [0, 0, 1], [[-0.3, 0.62], [-0.44, 0.84], [-0.58, 0.98]]);
  crack(torso, sfT, [0, 0, 1], [[-0.03, 0.36], [-0.16, 0.3], [-0.2, 0.18]]);
  crack(torso, sfT, [0, 0, -1], [[0.05, 0.98], [-0.04, 0.8], [0.06, 0.62], [-0.05, 0.42], [0.03, 0.24]], 0.016);
  crack(torso, sfT, [0, 0, -1], [[-0.04, 0.8], [-0.26, 0.86], [-0.46, 0.8]]); crack(torso, sfT, [0, 0, -1], [[0.06, 0.62], [0.26, 0.6], [0.36, 0.44]]);
  crack(torso, sfT, [1, 0, 0], [[0.1, 1.0], [0.0, 0.84], [0.08, 0.7]]); crack(torso, sfT, [-1, 0, 0], [[0.1, 1.0], [-0.02, 0.86], [0.08, 0.72]]);
  torso.push(snowy(0.17, 0.05, 0.18, 0.52, 1.1, -0.04), snowy(0.18, 0.055, 0.19, -0.55, 1.11, -0.03), snowy(0.2, 0.05, 0.14, 0, 1.06, -0.18));
  const torsoHard = [
    crag(1, 0.3, 0.17, 0.3, 0.53, 0.97, -0.02, 20), crag(2, 0.32, 0.18, 0.3, -0.55, 0.97, -0.02, -40),                 // pauldrons
    crag(3, 0.19, 0.19, 0.09, 0.27, 0.71, 0.27, 0, -6, -8), crag(4, 0.2, 0.18, 0.09, -0.26, 0.73, 0.26, 30, -6, 10),      // breast
    crag(5, 0.13, 0.13, 0.08, 0.16, 0.37, 0.2, 10, 4, 0).lod(2), crag(6, 0.14, 0.15, 0.08, -0.17, 0.4, 0.19, 50, 4, 0).lod(2),
    crag(7, 0.34, 0.3, 0.2, 0, 0.74, -0.25, 10), crag(8, 0.26, 0.22, 0.18, 0.2, 0.42, -0.2, 0), crag(9, 0.24, 0.2, 0.16, -0.24, 0.4, -0.18, 70),   // back
    crag(10, 0.13, 0.2, 0.2, 0.33, 0.5, 0.02, 0, 0, -20), crag(11, 0.13, 0.2, 0.2, -0.33, 0.5, 0.0, 30, 0, 20),
    crag(12, 0.22, 0.11, 0.18, 0, 1.02, -0.16, 45),
    // spires along the shoulders and down the back
    spire(0.56, 1.02, -0.14, 0.34, 0.085, [0.3, 1, -0.3], 70), spire(0.72, 0.96, 0.02, 0.24, 0.07, [0.7, 0.8, 0], 71), spire(-0.6, 1.02, -0.12, 0.4, 0.09, [-0.35, 1, -0.25], 72), spire(-0.74, 0.94, 0.06, 0.22, 0.065, [-0.8, 0.7, 0.1], 73),
    spire(0.12, 0.98, -0.3, 0.36, 0.09, [0.1, 0.8, -0.7], 74), spire(-0.14, 0.84, -0.36, 0.3, 0.085, [-0.15, 0.6, -0.9], 75), spire(0.05, 0.6, -0.36, 0.24, 0.08, [0.1, 0.3, -1], 76),
    spire(0.4, 1.06, 0.1, 0.16, 0.05, [0.2, 1, 0.2], 77).lod(2), spire(-0.38, 1.08, 0.1, 0.18, 0.055, [-0.1, 1, 0.25], 78).lod(2),
  ];
  // icicles hanging under the chest
  for (let i = 0; i < 9; i++) { const x = -0.4 + i * 0.1 + rnd(i, 171) * 0.04; torsoHard.push(shard(0.06 + rnd(i, 172) * 0.1, 0.02, i, 4).rot(180, 0, 0).at(x, 0.5 - Math.abs(x) * 0.1, 0.27 - Math.abs(x) * 0.12).shade(iceShade(lite, lite, deep, i, 2)).pbr(0.1, 0.1).glow(0.1).lod(1)); }
  // ---- head: a wedge of blue ice under a heavy brow, lamps for eyes ----
  const HO = [0, 1.05, 0.05];
  const head = [
    blk(0.3, 0.26, 0.32, -8, 0, 0, 0, 1.2, 0.1),
    ...S.mirrorX([S.ellipsoid(0.06, 0.034, 0.06).rot(0, 0, -14).at(0.085, 1.205, 0.26).cut(0.006).color(abyss).glow(0.4)]),
  ];
  const sfHd = surfer(head.slice(0, 1));
  crack(head, sfHd, [0, 0, 1], [[0.0, 1.17], [0.03, 1.12], [-0.02, 1.07]], 0.008); crack(head, sfHd, [1, 0, 0], [[0.2, 1.28], [0.1, 1.18], [0.14, 1.1]], 0.008); crack(head, sfHd, [-1, 0, 0], [[0.18, 1.26], [0.12, 1.16], [0.04, 1.12]], 0.008);
  const headHard = [
    ...H.mirrorX([H.sphere(0.03, 10).scale(1.45, 0.72, 1).rot(0, 0, -14).at(0.085, 1.205, 0.238).color(0x6ac4ff).pbr(0.2).glow(1.9)]),
    H.box(0.22, 0.035, 0.2, 0.004).at(0, 1.08, 0.13).color(glowC).pbr(0.3).glow(1.4),
    crag(13, 0.21, 0.06, 0.13, 0, 1.3, 0.19, 0, 16, 0), crag(15, 0.18, 0.1, 0.18, 0, 1.33, 0.03, 30),
    ...H.mirrorX([crag(14, 0.06, 0.1, 0.13, 0.165, 1.15, 0.14, 0, 0, -8)]),
    spire(0, 1.33, -0.02, 0.26, 0.06, [0, 1, -0.5], 90), spire(0.12, 1.3, 0.0, 0.18, 0.05, [0.5, 1, -0.3], 91), spire(-0.12, 1.3, 0.0, 0.2, 0.05, [-0.5, 1, -0.3], 92), spire(0.06, 1.3, -0.1, 0.16, 0.05, [0.2, 0.7, -0.8], 93).lod(2), spire(-0.07, 1.28, -0.1, 0.14, 0.045, [-0.3, 0.6, -0.8], 94).lod(2),
  ];
  const J = [0, 1.1, 0.02];
  const jaw = [blk(0.27, 0.1, 0.26, 0, 0, 0, 0, 1.035, 0.14), blk(0.18, 0.08, 0.12, 0, 0, 0, 0, 0.99, 0.19, deep)];
  const jawHard = [crag(16, 0.13, 0.06, 0.08, 0, 1.0, 0.25, 0, 10, 0)];
  for (let i = 0; i < 6; i++) jawHard.push(shard(0.05 + rnd(i, 181) * 0.03, 0.022, i, 4).at(-0.105 + i * 0.042, 1.075, 0.25).shade(iceShade(lite, lite, deep, i, 2)).pbr(0.12, 0.1).lod(1));
  for (let i = 0; i < 5; i++) jawHard.push(shard(0.08 + rnd(i, 182) * 0.1, 0.02, i + 4, 4).rot(180, 0, 0).at(-0.1 + i * 0.05, 0.96, 0.22 - Math.abs(i - 2) * 0.02).shade(iceShade(lite, lite, deep, i, 2)).pbr(0.1, 0.1).glow(0.1).lod(1));
  // ---- arms: an upper block, then a forearm running into a fist the size of a boat ----
  const SL = [0.6, 0.9, 0.0], EL = [0.76, 0.46, 0.06];
  const upper = [blk(0.26, 0.5, 0.28, 0, 0, 16, 0.7, 0.66, 0.03), blk(0.24, 0.22, 0.26, 20, 0, 30, 0.76, 0.46, 0.06, deep)];
  const fore = [
    blk(0.27, 0.27, 0.5, 38, 0, 0, 0.8, 0.31, 0.24),
    blk(0.36, 0.34, 0.4, 12, 12, 5, 0.82, 0.17, 0.5),
  ];
  const sfF = surfer(fore);
  crack(fore, sfF, [0, 0, 1], [[0.74, 0.32], [0.8, 0.24], [0.78, 0.12], [0.86, 0.03]], 0.016); crack(fore, sfF, [0, 0, 1], [[0.8, 0.24], [0.9, 0.2], [0.95, 0.08]], 0.014);
  crack(fore, sfF, [-1, 0, 0], [[0.1, 0.42], [0.3, 0.3], [0.44, 0.32], [0.6, 0.18]]); crack(fore, sfF, [0, 1, 0], [[0.7, 0.36], [0.8, 0.5], [0.9, 0.6]]); crack(fore, sfF, [-1, 0, 0], [[0.44, 0.32], [0.5, 0.1]]);
  const upperHard = [crag(17, 0.19, 0.25, 0.2, 0.79, 0.7, 0.02, 0, 0, 16), crag(18, 0.17, 0.14, 0.17, 0.82, 0.45, 0.05, 40), spire(0.84, 0.78, -0.04, 0.2, 0.06, [0.9, 0.5, -0.2], 100), spire(0.9, 0.56, 0.0, 0.16, 0.05, [1, 0.1, -0.3], 101).lod(2)];
  const foreHard = [crag(19, 0.15, 0.2, 0.25, 0.97, 0.2, 0.47, 12), crag(23, 0.13, 0.2, 0.24, 0.66, 0.18, 0.5, -20), crag(24, 0.2, 0.18, 0.12, 0.82, 0.16, 0.3, 0, 12, 0), crag(25, 0.11, 0.1, 0.06, 0.74, 0.1, 0.71, 0, 10, 0).lod(2), crag(20, 0.21, 0.09, 0.22, 0.83, 0.36, 0.48, 30, 12, 0), crag(21, 0.16, 0.15, 0.17, 0.82, 0.37, 0.2, 0, 38, 0), crag(22, 0.12, 0.16, 0.2, 0.68, 0.36, 0.3, 0, 38, 0).lod(2)];
  for (let i = 0; i < 4; i++) foreHard.push(spire(0.68 + i * 0.09, 0.3, 0.64, 0.16 + rnd(i, 191) * 0.06, 0.07, [0, 0.35 - i * 0.03, 1], 110 + i));   // knuckles
  const mir = (l) => l.map((p) => p.mirrorX());
  const upperR = mir(upper), foreR = mir(fore), upperHardR = mir(upperHard), foreHardR = mir(foreHard), SR = [-SL[0], SL[1], SL[2]], ERt = [-EL[0], EL[1], EL[2]];
  const nodes = [
    ROOT,
    { name: 'floe', parent: 'root', pos: [0, 0, 0], prims: floe, hard: floeHard, detail: 0.5 },
    { name: 'torso', parent: 'root', rig: 'body', pos: TO, prims: into(TO, torso), hard: into(TO, torsoHard), detail: 0.5 },
    { name: 'head', parent: 'torso', rig: 'head', pos: sub(HO, TO), prims: into(HO, head), hard: into(HO, headHard), detail: 0.9 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: sub(J, HO), rot: [3, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 0.8 },
    { name: 'armL', parent: 'torso', rig: 'arms', pos: sub(SL, TO), prims: into(SL, upper), hard: into(SL, upperHard), detail: 0.5 },
    { name: 'foreL', parent: 'armL', rig: 'forearms', pos: sub(EL, SL), prims: into(EL, fore), hard: into(EL, foreHard), detail: 0.56 },
    { name: 'armR', parent: 'torso', rig: 'arms', pos: sub(SR, TO), prims: into(SR, upperR), hard: into(SR, upperHardR), detail: 0.5 },
    { name: 'foreR', parent: 'armR', rig: 'forearms', pos: sub(ERt, SR), prims: into(ERt, foreR), hard: into(ERt, foreHardR), detail: 0.56 },
  ];
  return { kind: 'bergTitan', nodes };
}
/** time that sticks and slips: ice grinding on ice */
const grind = (t, rate = 1.4) => { const u = t * rate, f = u - Math.floor(u); return (Math.floor(u) + smooth(f * 1.6)) / rate; };
function animBergTitan(model, ctx) {
  const rig = model.userData.rig, t = fin0(ctx?.t), phase = fin0(ctx?.phase);
  const g = grind(t + phase * 0.7) * 0.6;
  // each fist in turn is heaved up and brought grinding down
  const c = frac(t * 0.075 + phase * 0.13), up = [pulse(c, 0.0, 0.36), pulse(c, 0.5, 0.86)], down = [pulse(c, 0.24, 0.4), pulse(c, 0.74, 0.9)];
  const lean = up[0] - up[1];
  R(rig.body, Math.sin(g * 0.9) * 0.035 + (down[0] + down[1]) * 0.1, Math.sin(g * 0.6) * 0.07 + lean * 0.16, Math.sin(g * 0.75 + 1) * 0.025 - lean * 0.05);
  P(rig.body, 0, Math.sin(g * 1.3) * 0.008, 0);
  R(rig.head, Math.sin(g * 1.1 + 2) * 0.05 + (down[0] + down[1]) * 0.12, Math.sin(g * 0.5 + 1) * 0.22 - lean * 0.2, 0);
  R(rig.jaw, 0.04 + Math.max(0, Math.sin(g * 1.7)) * 0.1 + (up[0] + up[1]) * 0.3);
  (rig.arms || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, -up[i] * 1.15 + down[i] * 0.55 + Math.sin(g + i * 2) * 0.04, 0, sg * (up[i] * 0.3 + Math.sin(g * 0.8 + i) * 0.03)); });
  (rig.forearms || []).forEach((n, i) => R(n, -up[i] * 0.75 + down[i] * 0.7 + Math.sin(g * 1.2 + i * 2 + 1) * 0.04, 0, 0));
}

export const creatures = {
  tuskWalrus: (def) => rigged(def, tuskWalrusDesc),
  orca: (def) => rigged(def, orcaDesc),
  narwhal: (def) => rigged(def, narwhalDesc),
  iceKraken: (def) => rigged(def, iceKrakenDesc),
  polarSerpent: (def) => { const m = rigged(def, polarSerpentDesc), b = m.userData.rig.breath; if (b && b[0]) b[0].scale.setScalar(0.001); return m; },
  bergTitan: (def) => rigged(def, bergTitanDesc),
};
export const animators = {
  tuskWalrus: animTuskWalrus,
  orca: animOrca,
  narwhal: animNarwhal,
  iceKraken: animIceKraken,
  polarSerpent: animPolarSerpent,
  bergTitan: animBergTitan,
};

// =====================================================================================
// SCENERY: pack ice, icebergs and penguins. Plain low-poly meshes with vertex colours; geometry is built once per
// variant and shared by every instance, and everything uses two materials.
// =====================================================================================
let iceMat = null, birdMat = null;
function sceneMats() {
  iceMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.04 });
  birdMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 });
}
const seedOf = (seed) => { const n = Math.floor(num(Number(seed), 0)); return Number.isFinite(n) ? Math.abs(n) % 1000003 : 0; };
function rng(seed) { let s = (seedOf(seed) * 2654435761 + 97) >>> 0; return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; s ^= s >>> 13; return ((Math.imul(s, 3266489909) >>> 0) / 4294967296); }; }
/** collects coloured triangles; colours may be given per corner */
class Tris {
  constructor() { this.p = []; this.c = []; }
  tri(a, b, c, ca, cb = ca, cc = ca) { this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); for (const k of [ca, cb, cc]) { _c.set(k); this.c.push(_c.r, _c.g, _c.b); } return this; }
  quad(a, b, c, d, ca, cb = ca, cc = ca, cd = ca) { return this.tri(a, b, c, ca, cb, cc).tri(a, c, d, ca, cc, cd); }
  /** a closed convex-ish lump from a stack of rings (bottom first, counter-clockwise seen from above), colour(faceCentre, faceNormal) */
  stack(rings, colour, capTop = true, capBottom = false) {
    const face = (a, c, b) => { const n = norm([(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]); this.tri(a, b, c, colour([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], n)); };
    for (let i = 0; i < rings.length - 1; i++) { const A = rings[i], B = rings[i + 1], n = A.length; for (let j = 0; j < n; j++) { const k = (j + 1) % n; face(A[j], B[k], A[k]); face(A[j], B[j], B[k]); } }
    const cap = (r, top) => { const m = [0, 0, 0]; for (const q of r) { m[0] += q[0] / r.length; m[1] += q[1] / r.length; m[2] += q[2] / r.length; } for (let j = 0; j < r.length; j++) { const k = (j + 1) % r.length; if (top) face(m, r[k], r[j]); else face(m, r[j], r[k]); } };
    if (capTop) cap(rings[rings.length - 1], true);
    if (capBottom) cap(rings[0], false);
    return this;
  }
  /** a small box: centre, half sizes, yaw and tilt in radians */
  block(c, h, yaw, tilt, colour) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const v = (x, y, z) => { const y2 = y * ct - z * st, z2 = y * st + z * ct; return [c[0] + x * cy + z2 * sy, c[1] + y2, c[2] - x * sy + z2 * cy]; };
    const ring = (y) => [v(-h[0], y, -h[2]), v(-h[0], y, h[2]), v(h[0], y, h[2]), v(h[0], y, -h[2])];
    return this.stack([ring(-h[1]), ring(h[1])], colour, true, false);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.computeVertexNormals();
    return g;
  }
}
const SNOW = 0xf7fbff, EDGE = 0xcfe6f6, PALE = 0xa9d2ee, BLUE = 0x6fb0dc, DEEPB = 0x3f86b8, SKIRT = 0x2f7aa6;
function sceneMesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; }

/** pack ice: a flat irregular plate ~2 across, top 0.12 above the water. Four shapes, picked by seed. */
function floeGeo(v) {
  return cached(`floe:${v}`, () => {
    const R = rng(v * 31 + 7), T = new Tris(), n = 9 + (v % 3), sx = [1, 1.12, 0.94, 1.08][v], sz = [1, 0.8, 1.02, 0.74][v], pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * PI * 2 + R() * 0.3, r = 0.72 + R() * 0.3 - (v === 2 && i % 4 === 0 ? 0.2 : 0); pts.push([Math.cos(a) * r * sx, Math.sin(a) * r * sz]); }
    const ring = (k, y, grow = 0) => pts.map(([x, z]) => { const l = Math.hypot(x, z) || 1; return [x * k + (x / l) * grow, y, -(z * k + (z / l) * grow)]; });
    const top = ring(0.8, 0.12), lip = ring(1, 0.095), foot = ring(1, -0.05, 0.05);
    for (let i = 0; i < n; i++) { const k = (i + 1) % n; T.tri([0, 0.12, 0], top[i], top[k], SNOW); T.quad(top[i], lip[i], lip[k], top[k], SNOW, EDGE, EDGE, SNOW); T.quad(lip[i], foot[i], foot[k], lip[k], i % 2 ? PALE : EDGE, BLUE, BLUE, i % 2 ? PALE : EDGE); }
    // cracks: thin dark wedges running in from the edge
    for (let c = 0; c < 3; c++) {
      let a = R() * PI * 2, x = Math.cos(a) * 0.74 * sx, z = Math.sin(a) * 0.74 * sz, w = 0.028;
      a += PI + (R() - 0.5) * 0.8;
      for (let s = 0; s < 3; s++) {
        const L = 0.2 + R() * 0.16, nx = x + Math.cos(a) * L, nz = z + Math.sin(a) * L, px = -Math.sin(a), pz = Math.cos(a), w2 = w * 0.55;
        T.quad([x - px * w, 0.124, z - pz * w], [x + px * w, 0.124, z + pz * w], [nx + px * w2, 0.124, nz + pz * w2], [nx - px * w2, 0.124, nz - pz * w2], DEEPB, DEEPB, BLUE, BLUE);
        x = nx; z = nz; w = w2; a += (R() - 0.5) * 1.3;
      }
    }
    // rafted slabs and a snow hummock
    const tint = (p, nrm) => (nrm[1] > 0.5 ? SNOW : mix(EDGE, BLUE, clamp(0.5 - nrm[1] * 0.5 + (nrm[0] + nrm[2]) * 0.3, 0, 1)));
    for (let b = 0; b < 3; b++) { const a = R() * PI * 2, r = 0.25 + R() * 0.4; T.block([Math.cos(a) * r * sx, 0.13 + R() * 0.03, Math.sin(a) * r * sz], [0.1 + R() * 0.1, 0.025 + R() * 0.02, 0.07 + R() * 0.07], R() * PI, 0.2 + R() * 0.3, tint); }
    const hx = (R() - 0.5) * 0.5, hz = (R() - 0.5) * 0.4, hr = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; hr.push([hx + Math.cos(a) * (0.16 + R() * 0.07), 0.12, hz - Math.sin(a) * (0.13 + R() * 0.06)]); }
    for (let i = 0; i < 6; i++) T.tri([hx, 0.19, hz], hr[i], hr[(i + 1) % 6], SNOW, i % 2 ? EDGE : SNOW, i % 2 ? SNOW : EDGE);
    return T.geo();
  });
}
/** an iceberg ~2 across and 2.6-3.9 high with a ring of drowned ice round its foot. Three shapes, picked by seed. */
function icebergGeo(v) {
  return cached(`berg:${v}`, () => {
    const R = rng(v * 53 + 11), T = new Tris();
    const tint = (p, nrm) => {
      if (nrm[1] > 0.52) return SNOW;
      const shadow = clamp(0.62 - nrm[0] * 0.5 + nrm[2] * 0.25 - nrm[1] * 0.3 + (R() - 0.5) * 0.3, 0, 1);   // the faces turned from the sun go blue
      return mix(mix(0xe6f3fc, BLUE, shadow), 0x7fd0e0, clamp(0.35 - p[1], 0, 0.35) * 1.6);
    };
    // a peak: rings of n corners up a leaning axis, pinched to a ridge or a point
    const peak = (cx, cz, r0, H, n, lean, prof, flat) => {
      const jit = []; for (let j = 0; j < n; j++) jit.push(0.78 + R() * 0.44);
      const rings = prof.map(([f, k], ri) => { const o = []; for (let j = 0; j < n; j++) { const a = (j / n) * PI * 2 + ri * 0.22, r = r0 * k * (jit[j] * 0.7 + 0.3 + (R() - 0.5) * 0.18); o.push([cx + lean[0] * f * H + Math.cos(a) * r, f * H + (ri && ri < prof.length - 1 ? (R() - 0.5) * 0.12 * H / prof.length : 0), cz + lean[1] * f * H - Math.sin(a) * r * flat]); } return o; });
      T.stack(rings, tint, true, false);
      return rings[0];
    };
    const P1 = [[-0.02, 1.04], [0.1, 0.98], [0.34, 0.74], [0.6, 0.5], [0.84, 0.27], [1, 0.05]], P2 = [[-0.02, 1.02], [0.16, 0.92], [0.5, 0.62], [0.82, 0.34], [1, 0.06]], PT = [[-0.02, 1.03], [0.12, 1.0], [0.55, 0.9], [0.86, 0.78], [1, 0.52]];
    if (v === 0) { peak(0, 0, 0.92, 3.9, 9, [0.05, -0.03], P1, 0.9); peak(0.5, 0.42, 0.5, 1.7, 7, [0.06, 0.08], P2, 1); peak(-0.55, -0.3, 0.42, 1.2, 6, [-0.1, 0], P2, 1); }
    else if (v === 1) { peak(-0.3, 0.05, 0.74, 3.1, 8, [-0.07, 0.02], P1, 0.95); peak(0.42, -0.1, 0.62, 2.3, 8, [0.1, -0.02], P1, 0.9); peak(0.1, 0.5, 0.4, 1.0, 6, [0, 0.1], P2, 1); }
    else { peak(0, 0, 0.96, 1.7, 10, [0.03, 0], PT, 0.82); peak(-0.34, -0.1, 0.44, 2.7, 7, [-0.03, 0.02], P1, 1); peak(0.5, 0.2, 0.36, 2.0, 6, [0.05, 0.03], P2, 1); }
    // the drowned skirt: a shelf of ice just under the surface, showing darker round the foot
    const n = 12, inner = [], outer = [];
    for (let j = 0; j < n; j++) { const a = (j / n) * PI * 2, r = 1.1 + R() * 0.2; inner.push([Math.cos(a) * 0.55, 0.024, -Math.sin(a) * 0.5]); outer.push([Math.cos(a) * r, 0.012, -Math.sin(a) * r * 0.92]); }
    for (let j = 0; j < n; j++) { const k = (j + 1) % n; T.quad(inner[j], outer[j], outer[k], inner[k], 0x6fb8d8, SKIRT, SKIRT, 0x6fb8d8); }
    // growlers: lumps calved off and drifting alongside
    for (let b = 0; b < 2; b++) { const a = R() * PI * 2, r = 0.95 + R() * 0.2; T.block([Math.cos(a) * r, 0.04, Math.sin(a) * r * 0.9], [0.1 + R() * 0.07, 0.07 + R() * 0.05, 0.08 + R() * 0.06], R() * PI, 0.3, tint); }
    return T.geo();
  });
}

// ---- penguins: chunky birds 0.35 tall, facing +Z ----
const P_BLACK = 0x1c1f26, P_WHITE = 0xf4f4ee, P_ORANGE = 0xf08a1e, P_YELLOW = 0xf2c84a;
function birdBody(T) {
  const prof = [[0.012, 0.062], [0.06, 0.098], [0.13, 0.105], [0.2, 0.088], [0.252, 0.06]], n = 8;
  const rings = prof.map(([y, r]) => { const o = []; for (let j = 0; j < n; j++) { const a = ((j + 0.5) / n) * PI * 2; o.push([Math.cos(a) * r, y, -Math.sin(a) * r * 0.88 + 0.008]); } return o; });
  T.stack(rings, (p, nrm) => (nrm[2] > 0.5 ? (p[1] > 0.2 ? P_YELLOW : P_WHITE) : nrm[2] > 0.2 && Math.abs(nrm[0]) < 0.75 ? P_WHITE : P_BLACK), true, true);
  for (const sd of [-1, 1]) { const x = sd * 0.045; T.tri([x - 0.03, 0.004, 0.05], [x + 0.03, 0.004, 0.05], [x + sd * 0.012, 0.004, 0.14], P_ORANGE).tri([x - 0.03, 0.004, 0.05], [x + sd * 0.012, 0.004, 0.14], [x, 0.03, 0.06], P_ORANGE).tri([x + 0.03, 0.004, 0.05], [x, 0.03, 0.06], [x + sd * 0.012, 0.004, 0.14], P_ORANGE); }
  T.tri([-0.035, 0.03, -0.07], [0.035, 0.03, -0.07], [0, 0.005, -0.15], P_BLACK).tri([0.035, 0.03, -0.07], [-0.035, 0.03, -0.07], [0, 0.05, -0.08], P_BLACK).tri([-0.035, 0.03, -0.07], [0, 0.005, -0.15], [0, 0.05, -0.08], P_BLACK).tri([0, 0.005, -0.15], [0.035, 0.03, -0.07], [0, 0.05, -0.08], P_BLACK);
}
/** the head about its neck joint at (ox, oy, oz) */
function birdHead(T, oy = 0) {
  const n = 6, r = 0.058, cy = oy + 0.042, rings = [];
  for (const [f, k] of [[-0.78, 0.6], [-0.1, 1], [0.55, 0.84], [0.95, 0.34]]) { const o = []; for (let j = 0; j < n; j++) { const a = ((j + 0.5) / n) * PI * 2; o.push([Math.cos(a) * r * k, cy + f * r, -Math.sin(a) * r * k + 0.006]); } rings.push(o); }
  T.stack(rings, (p, nrm) => (Math.abs(nrm[0]) > 0.55 && nrm[2] > -0.2 && p[1] < cy + 0.03 && p[1] > cy - 0.03 ? P_WHITE : P_BLACK), true, false);
  const b = [0, cy - 0.004, 0.125], q = [[-0.02, cy + 0.012, 0.05], [0.02, cy + 0.012, 0.05], [0.014, cy - 0.02, 0.048], [-0.014, cy - 0.02, 0.048]];
  for (let j = 0; j < 4; j++) T.tri(q[j], q[(j + 3) % 4], b, j === 2 ? 0xc85a14 : P_ORANGE);
}
/** a flipper hanging from its shoulder joint at the origin; sd = +1 left (+X) */
function birdWing(T, sd) {
  const a = [0, 0.012, 0], f = [sd * 0.012, -0.07, 0.036], bk = [sd * 0.012, -0.075, -0.034], tip = [sd * 0.03, -0.165, -0.004], out = [sd * 0.03, -0.07, 0], inn = [sd * -0.004, -0.07, 0];
  const tris = [[a, f, out], [a, out, bk], [f, tip, out], [out, tip, bk], [a, inn, f], [a, bk, inn], [f, inn, tip], [inn, bk, tip]];
  for (const [p, q, r] of tris) { if (sd > 0) T.tri(p, q, r, P_BLACK); else T.tri(p, r, q, P_BLACK); }
}
const NECK_Y = 0.262, SHOULDER = [0.094, 0.222, 0.004];
function birdGeos() {
  return cached('bird', () => {
    const body = new Tris(); birdBody(body);
    const both = new Tris(); birdBody(both); birdHead(both, NECK_Y);
    const head = new Tris(); birdHead(head, 0);
    const wl = new Tris(); birdWing(wl, 1);
    const wr = new Tris(); birdWing(wr, -1);
    return { body: body.geo(), both: both.geo(), head: head.geo(), wingL: wl.geo(), wingR: wr.geo() };
  });
}
/** one bird: a Group (the animator owns its position and rotation) with userData.parts. merged = head built into the body mesh */
function makeBird(seed, merged = false) {
  sceneMats();
  const G = birdGeos(), R = rng(seed * 7 + 3), g = new THREE.Group();
  const body = sceneMesh(merged ? G.both : G.body, birdMat), wingL = sceneMesh(G.wingL, birdMat), wingR = sceneMesh(G.wingR, birdMat);
  let head = null;
  if (!merged) { head = sceneMesh(G.head, birdMat); head.position.set(0, NECK_Y, 0); g.add(head); }
  wingL.position.set(SHOULDER[0], SHOULDER[1], SHOULDER[2]); wingR.position.set(-SHOULDER[0], SHOULDER[1], SHOULDER[2]);
  g.add(body, wingL, wingR);
  const s = 0.9 + R() * 0.2;
  g.scale.setScalar(s);
  g.userData = { parts: { body, wingL, wingR, head }, rest: { x: 0, y: 0, z: 0, ry: 0 }, phase: R() * 40, rate: 0.8 + R() * 0.45, size: s };
  return g;
}
function place(b, x, y, z, ry) { b.position.set(x, y, z); b.rotation.set(0, ry, 0); b.userData.rest = { x, y, z, ry }; return b; }
function snowPatchGeo(v) {
  return cached(`patch:${v}`, () => {
    const R = rng(v * 17 + 5), T = new Tris(), n = 9, top = [], rim = [];
    for (let j = 0; j < n; j++) { const a = (j / n) * PI * 2, r = 0.5 + R() * 0.14; top.push([Math.cos(a) * r * 0.78, 0.05, -Math.sin(a) * r * 0.78]); rim.push([Math.cos(a) * (r + 0.06), 0, -Math.sin(a) * (r + 0.06)]); }
    for (let j = 0; j < n; j++) { const k = (j + 1) % n; T.tri([0, 0.05, 0], top[j], top[k], SNOW); T.quad(top[j], rim[j], rim[k], top[k], SNOW, EDGE, EDGE, SNOW); }
    return T.geo();
  });
}
export const scenery = {
  floe(seed) { sceneMats(); const s = seedOf(seed), m = sceneMesh(floeGeo(s % 4), iceMat); m.rotation.y = (s * 2.399) % (PI * 2); m.userData = { kind: 'floe', variant: s % 4 }; return m; },
  iceberg(seed) { sceneMats(); const s = seedOf(seed), m = sceneMesh(icebergGeo(s % 3), iceMat); m.rotation.y = (s * 2.399) % (PI * 2); m.userData = { kind: 'iceberg', variant: s % 3, height: [3.9, 3.1, 2.7][s % 3] }; return m; },
  /** one penguin standing at the origin, facing +Z. userData.parts = { body, wingL, wingR, head }; userData.bird is the inner group that animateScenery moves. */
  penguin(seed) { const g = new THREE.Group(), b = makeBird(seedOf(seed)); g.add(b); g.userData = { kind: 'penguin', parts: b.userData.parts, bird: b }; return g; },
  /** a huddle of 4-7 penguins on a patch of snow ~1.2 across; userData.birds lists them (each with userData.parts; the head is part of the body mesh) */
  penguinGroup(seed) {
    sceneMats();
    const s = seedOf(seed), R = rng(s * 13 + 1), g = new THREE.Group(), n = 4 + (s % 4), birds = [], spots = [];
    g.add(sceneMesh(snowPatchGeo(s % 3), iceMat));
    const facing = R() * PI * 2;
    for (let i = 0; i < n; i++) {
      let x = 0, z = 0;
      for (let k = 0; k < 30; k++) { const a = R() * PI * 2, r = Math.sqrt(R()) * 0.36; x = Math.cos(a) * r; z = Math.sin(a) * r; if (spots.every(([px, pz]) => Math.hypot(px - x, pz - z) > 0.2)) break; }
      spots.push([x, z]);
      const b = place(makeBird(s * 31 + i, true), x, 0.05, z, R() < 0.6 ? facing + (R() - 0.5) * 0.9 : R() * PI * 2);
      birds.push(b); g.add(b);
    }
    g.userData = { kind: 'penguinGroup', birds };
    return g;
  },
};
function animBird(b, t) {
  const u = b && b.userData, p = u && u.parts, r = u && u.rest;
  if (!p || !r) return;
  const ph = fin0(u.phase), rate = num(u.rate, 1), w = t * 5.4 * rate + ph;
  // bouts of shuffling on the spot: rocking from foot to foot, turning a little this way and that
  const act = 0.25 + 0.75 * smooth(Math.sin(t * 0.37 * rate + ph * 1.7) * 1.6 + 0.5);
  const hc = frac(t * 0.11 * rate + ph * 0.37), hop = pulse(hc, 0.0, 0.07), dip = pulse(frac(t * 0.17 * rate + ph * 0.53), 0.0, 0.12);
  const s = num(u.size, 1);
  b.rotation.set(dip * 0.35, r.ry + Math.sin(w * 0.5) * 0.14 * act + Math.sin(t * 0.21 + ph) * 0.3, Math.sin(w) * 0.14 * act * (1 - hop));
  b.position.set(r.x + Math.sin(w) * 0.008 * act, r.y + (hop * 0.075 + Math.abs(Math.sin(w)) * 0.006 * act) * s, r.z);
  // flippers: held a little out, flapped in bursts and thrown wide on a hop
  const flap = pulse(frac(t * 0.19 * rate + ph * 0.61), 0.0, 0.28), f = 0.1 + flap * (0.55 + 0.4 * Math.sin(t * 21 + ph)) + hop * 1.0 + Math.max(0, Math.sin(w)) * 0.06 * act;
  if (p.wingL) p.wingL.rotation.set(0, 0, f);
  if (p.wingR) p.wingR.rotation.set(0, 0, -f);
  if (p.head) p.head.rotation.set(-hop * 0.3 + Math.sin(t * 1.3 + ph) * 0.06, Math.sin(t * 0.83 * rate + ph * 2.3) * 0.55, 0);
}
/** per-frame animation for scenery: penguins waddle on the spot, flap their flippers, bob and hop. Anything else is left alone. */
export function animateScenery(obj, t) {
  const u = obj && obj.userData;
  if (!u) return;
  t = fin0(Number(t));
  if (Array.isArray(u.birds)) { for (const b of u.birds) animBird(b, t); return; }
  if (u.bird) animBird(u.bird, t);
}
