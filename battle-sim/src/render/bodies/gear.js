// Clothing, armour, headgear, capes and robes for humanoid bodies.
//
// dress(ctx) is called once per humanoid after its bare body exists (see humanoid.js):
//   ctx.def   the unit definition (ctx.def.id is the unit id, e.g. 'knight')
//   ctx.o     the unit's model descriptor (species, cloth, armor, helm, hood, robe, shield, outfit, ...)
//   ctx.P     proportions from anatomy.js
//   ctx.nodes the rig nodes built so far; nodes[name].prims / .hard is the bare body in that node's space
//   ctx.add(nodeName, { prims: [...], hard: [...] })  appends pieces to a rig node, in that node's space
//   ctx.pose  'stand' | 'riding'
// headCover(def, o) tells the body which outfits bring a helm although the descriptor has no helm / hood flag.
//
// ctx.o.outfit picks the kit (OUTFITS below): peasant, footman, arbalist, manAtArms, knight, paladin, ranger, mage,
// priest, necromancer, lancer, skyKnight, rags, sapper, shaman, raider, hides, warlord, tatters, loincloth,
// infernalPlate, feathers, none. Anything else is dressed from the descriptor's flags (robe, armor, helm, hood).
//
// How garments are made:
//   - tight layers (hose, shirts, mail under plate, boots, bracers, belts, trim) are PAINT volumes with a little
//     raise: they follow the anatomy exactly, cost almost nothing and keep their colour on the far detail level;
//   - anything with its own volume (padded jacks, breastplates, pauldrons, skirts, hoods, closed helms) is a sculpt
//     prim on the node that moves with it: crisp (.blend ~0.003) for metal, soft for cloth. Under every such shell the
//     body is first painted the garment's colour, so nothing of the skin bleeds through where the shell sits close;
//   - skirts and robes hang from the ROOT node, so they stay upright while the torso leans and the legs swing
//     inside them; when riding they are left off and short lappets ride on the thighs instead. A long robe also
//     wraps the legs in cloth, so a striding leg that pushes through the bell reads as the robe swinging;
//   - hoods and coifs go in FRONT of the head's own prims, so the face opening can be carved without touching the
//     face; closed helms replace the face altogether (the head is the dearest node to mesh);
//   - thin or crisp things (capes, open helms and brims, plumes, buckles, rivets, emblems, feathers, bones) are hard
//     pieces, flagged .lod(0) / .lod(1) or given .near() / .far() twins so the far level stays lean.
// Everything is fitted from ctx.P and from measurements of the body's own distance field (G.tp), so one garment
// fits a goblin, a knight and an ogre. Builds are deterministic (variation is hashed from def.id) and nothing is
// built at module load.
import * as THREE from 'three';
import { S, H, noise3, distanceField } from '../sculpt.js';

const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const flat = (x) => [x].flat(Infinity).filter(Boolean);
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => mul3(a, 1 / (len3(a) || 1e-9));

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- colour ----------
const _c = new THREE.Color(), _c2 = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };
function tone(hex, dh = 0, ds = 0, dl = 0) {
  _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace);
  _c.setHSL(((_hsl.h + dh) % 1 + 1) % 1, clamp(_hsl.s + ds), clamp(_hsl.l + dl), THREE.SRGBColorSpace);
  return _c.getHex();
}
/** a second colour that sets off `hex`: cream-gold beside deep colours, a deep red beside yellows, a dark shade beside pale ones */
function contrast(hex) {
  _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace);
  const { h, s, l } = _hsl;
  if (l > 0.62) return tone(hex, 0, 0.12, -0.36);
  if (s < 0.14) return l < 0.3 ? 0xb9b2a2 : 0x7a2620;
  if (h > 0.08 && h < 0.2) return 0x8a2620;
  return 0xe2c65a;
}
function mix(a, b, t) { return _c.set(a).lerp(_c2.set(b), t).getHex(); }
const MUZZLE = 1.42;
let asked = null;   // the descriptor headCover() was last asked about (humanoid.js asks just before it builds the body)
const GOLD = 0xd9a93e, BRASS = 0xb98a3a, LEATHER = 0x5a3a22, DARK_LEATHER = 0x3a2618, LINEN = 0xd8ccb0, BONE = 0xe2d8ba, RUST = 0x7a4a2a;

// ---------- materials: the same call works on sculpt prims and hard pieces ----------
const fin = (x, c, rough, metal, tAmp, tFreq) => { x.color(c).pbr(rough, metal); if (tAmp && x.tint) x.tint(tAmp, tFreq); return x; };
const cloth = (x, c) => fin(x, c, 0.9, 0, 0.1, 34);
const leather = (x, c = LEATHER) => fin(x, c, 0.6, 0, 0.14, 40);
const steel = (x, c) => fin(x, c, 0.3, 1, 0.06, 22);
const iron = (x, c) => fin(x, c, 0.6, 0.55, 0.2, 24);
const gold = (x, c = GOLD) => fin(x, c, 0.3, 1, 0.05, 30);
const bone = (x, c = BONE) => fin(x, c, 0.55, 0, 0.12, 40);
const mail = (x, c) => fin(x, c, 0.58, 0.6, 0.22, 80);

// ---------- placement ----------
const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler(), _vx = new THREE.Vector3(), _vy = new THREE.Vector3(), _vz = new THREE.Vector3();
/** Euler angles (degrees, XYZ) of the frame whose +Y is yDir and whose +Z leans toward zHint */
function frameEuler(yDir, zHint = [0, 0, 1]) {
  _vy.set(yDir[0], yDir[1], yDir[2]).normalize();
  _vz.set(zHint[0], zHint[1], zHint[2]);
  _vx.crossVectors(_vy, _vz);
  if (_vx.lengthSq() < 1e-8) _vx.crossVectors(_vy, _vz.set(1, 0, 0));
  if (_vx.lengthSq() < 1e-8) _vx.crossVectors(_vy, _vz.set(0, 0, 1));
  _vx.normalize();
  _vz.crossVectors(_vx, _vy);
  _eu.setFromRotationMatrix(_m4.makeBasis(_vx, _vy, _vz), 'XYZ');
  return [_eu.x / DEG, _eu.y / DEG, _eu.z / DEG];
}
/** turn a piece built along +Y so +Y points along yDir (and +Z toward zHint), then move it to origin */
function orient(piece, origin, yDir, zHint) {
  const e = frameEuler(yDir, zHint);
  return piece.rot(e[0], e[1], e[2]).at(origin[0], origin[1], origin[2]);
}
/** tapered capsule from a to b whose local Y follows the bone (so ridges / fur run along it) */
function rod(a, b, ra, rb = ra, zHint) { return orient(S.capsule([0, 0, 0], [0, len3(sub3(b, a)), 0], ra, rb), a, sub3(b, a), zHint); }

/** walk from `from` along `dir` to the surface of a distance field; null if nothing is hit within `reach` */
function trace(f, from, dir, reach = 2) {
  const u = norm3(dir);
  let p = from.slice(), gone = 0;
  for (let i = 0; i < 40; i++) {
    const d = f(p[0], p[1], p[2]);
    if (d < 0.0006) return p;
    const step = d * 0.9;
    gone += step;
    if (gone > reach) return null;
    p = add3(p, mul3(u, step));
  }
  return p;
}
function gradient(f, p, e = 0.004) {
  return norm3([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);
}

// ---------- shared geometry ----------
const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
/** a low dome, pole +Y: rivets and studs */
const domeGeo = () => cached('dome', () => new THREE.SphereGeometry(1, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2));
/**
 * Grid surface from fn(u, v) -> [x, y, z]. nu / nv are segment counts or explicit lists of sample positions (0..1),
 * so two rows can sit close together where a colour must change crisply. Vertex i is column i % cols, row floor(i / cols).
 * closed: the u = 0 and u = 1 columns are the same line (a shell swept round an axis): their normals are welded.
 */
function surfaceGeo(nu, nv, fn, flip = false, closed = false) {
  const us = Array.isArray(nu) ? nu : Array.from({ length: nu + 1 }, (_, i) => i / nu), vs = Array.isArray(nv) ? nv : Array.from({ length: nv + 1 }, (_, i) => i / nv);
  const cu = us.length, cv = vs.length;
  const pos = new Float32Array(cu * cv * 3), idx = [];
  for (let j = 0; j < cv; j++) for (let i = 0; i < cu; i++) pos.set(fn(us[i], vs[j]), (j * cu + i) * 3);
  for (let j = 0; j < cv - 1; j++) for (let i = 0; i < cu - 1; i++) {
    const a = j * cu + i, b = a + 1, c = a + cu, d = c + 1;
    if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  if (closed) {
    const n = g.attributes.normal;
    for (let j = 0; j < cv; j++) {
      const a = j * cu, b = a + cu - 1;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
  }
  return g;
}
/** smooth curve through control points (uniform Catmull-Rom), t = 0..1 */
function spline(pts, t) {
  const n = pts.length - 1, f = clamp(t) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  return p1.map((_, k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u * u * u));
}
/**
 * A helmet shell swept round the Y axis. front / side / back are profiles [[radius, y], ...] from the crown to the rim,
 * blended by bearing, so a bowl can carry a peak in front and a tail behind. The rim is turned under for thickness.
 */
function shellGeo(key, front, side, back, seg = 30, rings = 11) {
  return cached(`shell:${key}:${seg}`, () => {
    const prof = (a, t) => {
      const c = Math.cos(a), s2 = Math.sin(a) ** 2;
      const fb = spline(c >= 0 ? front : back, t), sd = spline(side, t), w = Math.pow(s2, 0.8);
      return [lerp(fb[0], sd[0], w), lerp(fb[1], sd[1], w)];
    };
    const vs = []; for (let j = 0; j <= rings; j++) vs.push((j / rings) * 0.94); vs.push(0.97, 1);
    return surfaceGeo(seg, vs, (u, v) => {
      const a = u * Math.PI * 2 + Math.PI;                             // the seam sits at the back
      let r, y;
      if (v <= 0.94) [r, y] = prof(a, v / 0.94);
      else {
        const e = prof(a, 1), e0 = prof(a, 0.9), dx = e0[0] - e[0], dy = e0[1] - e[1], l = Math.hypot(dx, dy) || 1;
        if (v < 0.985) { r = e[0] + 0.014; y = e[1] - 0.036; } else { r = e[0] + (dx / l) * 0.13; y = e[1] + (dy / l) * 0.13 - 0.06; }
      }
      r = Math.max(r, 1e-4);
      return [Math.sin(a) * r, y, Math.cos(a) * r];
    }, false, true);
  });
}
/** a feather / leaf blade: unit length along +Y, half-width 0.5 along X, lightly cambered, face +Z */
function bladeGeo() {
  return cached('blade', () => {
    const N = 5, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, w = 0.5 * Math.min(1, Math.pow(t * 3.2, 0.7)) * Math.pow(Math.max(0, 1 - Math.pow(t, 3.2)), 0.55) + 0.02 * (1 - t);
      pos.push(-w, t, -0.14 * w, 0, t, 0.05, w, t, -0.14 * w);
    }
    for (let i = 0; i < N; i++) { const a = i * 3, b = a + 3; idx.push(a, a + 1, b + 1, a, b + 1, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}
/** feather from base along dir, face toward `face`; cols = [quill, vane, tip] */
function feather(base, dir, len, width, face, cols) {
  const h = H.geo(bladeGeo()).shade((x, y) => (y > 0.72 ? cols[2] : y < 0.12 || Math.abs(x) < 0.05 ? cols[0] : cols[1])).color(cols[1]).pbr(0.82).scale(width, len, width);
  return orient(h, base, dir, face);
}
/** rivet / stud at pos sitting on a surface whose outward normal is n */
function stud(pos, n, r, color = 0xb8bcc2, rough = 0.35, metal = 1) { return orient(H.geo(domeGeo()).scale(r), pos, n).color(color).pbr(rough, metal).lod(0); }

// star-convex outlines for emblems, counter-clockwise, radius <= 1
const SHAPES = {
  sun: (() => { const o = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.56 : 1; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; })(),
  disc: (() => { const o = []; for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; o.push([Math.cos(a), Math.sin(a)]); } return o; })(),
  cross: [[0.2, 1], [-0.2, 1], [-0.2, 0.36], [-0.66, 0.36], [-0.66, -0.02], [-0.2, -0.02], [-0.2, -1], [0.2, -1], [0.2, -0.02], [0.66, -0.02], [0.66, 0.36], [0.2, 0.36]].map(([x, y]) => [x, y - 0.1]),
  lozenge: [[0, 1], [-0.62, 0], [0, -1], [0.62, 0]],
  star: (() => { const o = []; for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.42 : 1; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; })(),
  flame: [[0, 1], [-0.22, 0.5], [-0.5, 0.62], [-0.44, 0.1], [-0.62, -0.3], [-0.4, -0.8], [0, -1], [0.4, -0.8], [0.62, -0.3], [0.4, 0.2], [0.5, 0.56], [0.2, 0.44]],
  skull: [[0, 1], [-0.5, 0.86], [-0.8, 0.4], [-0.74, -0.1], [-0.44, -0.4], [-0.4, -0.92], [0.4, -0.92], [0.44, -0.4], [0.74, -0.1], [0.8, 0.4], [0.5, 0.86]],
  shield: [[0, 1], [-0.8, 0.9], [-0.8, 0.1], [-0.5, -0.56], [0, -1], [0.5, -0.56], [0.8, 0.1], [0.8, 0.9]],
};

// =====================================================================================
//  The kit: everything an outfit needs to measure the body and hang things on it
// =====================================================================================
function kit(ctx) {
  const { P, o, def } = ctx;
  const T = P.torso, k = T / 0.3;
  const G = {
    ctx, P, o, def, T, k, id: def.id || 'unit',
    cw: P.chestW / 2, cd: P.chestD / 2, ww: P.waistW / 2, wd: P.waistD / 2, hw: P.hipW / 2, sx: P.shoulderX,
    R: P.headR, U: P.upper, F: P.fore, hr: P.handR, chestY: T - 0.118 * k,
    riding: ctx.pose === 'riding', nodes: ctx.nodes,
    cloth: o.cloth ?? 0x6b5a44, armor: o.armor ?? 0x9aa3ad, skin: o.skin ?? 0xd9a77c,
    rand: rng(hashStr((def.id || 'unit') + ':gear')),
  };
  G.add = (name, prims, hard) => { if (ctx.nodes[name]) ctx.add(name, { prims: flat(prims), hard: flat(hard) }); };
  /** add to the left node and, mirrored, to the right one: lr('arm', ...) -> armL, armR */
  G.lr = (base, prims, hard) => {
    const rp = flat(prims).map((x) => x.mirrorX()), rh = flat(hard).map((x) => x.mirrorX());   // before routing: pieces handed to a hand are moved in place
    G.add(base + 'L', prims, hard);
    G.add(base + 'R', rp, rh);
  };
  /** distance field of a node as it stands now (body plus whatever gear has been added so far) */
  G.field = (name) => distanceField(ctx.nodes[name].prims);
  /** how far the torso reaches at height y (torso space): { front, back, side } as positive distances from the axis */
  const tpCache = new Map(), bare = ctx.nodes.torso.prims.slice();
  let bodyField = null;
  G.tp = (y) => {
    const key = Math.round(y * 500);
    if (tpCache.has(key)) return tpCache.get(key);
    bodyField ||= distanceField(bare);
    let front = 0, back = 0, side = 0;
    for (const x of [0, G.cw * 0.45]) {
      const a = trace(bodyField, [x, y, 1], [0, 0, -1]); if (a) front = Math.max(front, a[2]);
      const b = trace(bodyField, [x, y, -1], [0, 0, 1]); if (b) back = Math.max(back, -b[2]);
    }
    for (const z of [0, (front - back) / 2]) { const c = trace(bodyField, [1, y, z], [-1, 0, 0]); if (c) side = Math.max(side, c[0]); }
    const r = { front, back, side, depth: (front + back) / 2, zc: (front - back) / 2 };
    tpCache.set(key, r);
    return r;
  };
  /** an ellipsoid that wraps the torso at height y with `grow` of clearance: the building block of jacks, mail and cuirasses */
  G.shell = (y, ry, grow = 0.01, gz = grow) => { const e = G.tp(y); return S.ellipsoid(e.side + grow, ry, e.depth + gz).at(0, y, e.zc); };
  /** a horizontal slab that paints whatever it crosses in a node: belts, hems, cuffs, trim lines */
  G.band = (y, h, r = 0.4) => S.cyl(r, h, 0).at(0, y, 0);
  /** recolour the hidden rod that stands in for a thin limb on the far level, so it shows cloth, not skin */
  G.core = (name, color) => { const n = ctx.nodes[name]; if (!n) return; for (const h of n.hard) if (h.geo && h.geo.type === 'CylinderGeometry' && h.geo.parameters.radialSegments === 6 && h.maxLod === 99) h.color(color); };
  G.cores = (base, color) => { G.core(base + 'L', color); G.core(base + 'R', color); };
  // second colour, ornament colour, options shared by the wardrobe outfits
  G.c2 = o.cloth2 ?? contrast(G.cloth); G.trim = o.trim ?? GOLD; G.bare = !!o.bare; G.variant = o.variant;
  G.Lk = (0.08 + 0.98 * (P.headLen / 1.12)) / 1.06;                    // how tall the skull is next to a human's: hats are squashed to fit
  G.helmAsked = !!o.helm && !(asked && !asked.helm && Object.keys(o).every((key) => key === 'helm' || o[key] === asked[key]));   // false when the helm flag only came from headCover()
  /** how far the face reaches forward at mouth height, in head radii (about 1.1 on a man; a muzzle reaches much further) */
  let reach = null;
  G.faceReach = () => {
    if (reach != null) return reach;
    reach = 1;
    try { const f = G.field('head'), R = P.headR; for (const y of [-0.25, -0.5]) { const q = trace(f, [0, R * y, R * 4], [0, 0, -1], R * 5); if (q) reach = Math.max(reach, q[2] / R); } } catch (err) { reach = 1; }
    return reach;
  };
  /** a closed helm would not fit over this head: outfits fall back to an open bowl */
  G.muzzled = () => G.faceReach() > MUZZLE;
  return G;
}

/** an emblem laid onto a node's surface: a crisp patch that follows the curve of whatever is underneath */
function decal(G, node, shape, o) {
  const f = o.field || G.field(node), out = SHAPES[shape] || SHAPES.disc;
  const ex = o.ex || [1, 0, 0], ey = o.ey || [0, 1, 0], dir = o.dir || [0, 0, -1], org = o.at, size = o.size, lift = o.lift ?? 0.0022, rings = o.rings ?? 3;
  const pos = [], idx = [];
  const put = (px, py) => {
    const from = add3(add3(org, mul3(ex, px * size)), mul3(ey, py * size));
    const p = trace(f, sub3(from, mul3(dir, 0.5)), dir, 1.2) || from;
    pos.push(p[0] - dir[0] * lift, p[1] - dir[1] * lift, p[2] - dir[2] * lift);
  };
  put(0, 0);
  for (let r = 1; r <= rings; r++) for (const q of out) put((q[0] * r) / rings, (q[1] * r) / rings);
  const n = out.length;
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
  for (let r = 1; r < rings; r++) for (let i = 0; i < n; i++) {
    const a = 1 + (r - 1) * n + i, b = 1 + (r - 1) * n + ((i + 1) % n), c = a + n, d = b + n;
    idx.push(a, c, d, a, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return H.geo(g).color(o.color).pbr(o.rough ?? 0.5, o.metal ?? 0).lod(o.lod ?? 1);
}

/** a row of studs pressed onto a node's surface: pts are points outside it, each walked along dir (or toward the node's Y axis) */
function studs(G, node, pts, o = {}) {
  const f = o.field || G.field(node), out = [];
  for (const q of pts) {
    const dir = o.dir || norm3([-q[0], 0, -q[2]]);
    const p = trace(f, q, dir, 1);
    if (!p) continue;
    out.push(stud(p, gradient(f, p), o.r ?? 0.005, o.color ?? 0xb8bcc2, o.rough ?? 0.35, o.metal ?? 1).lod(o.lod ?? 0));
  }
  return out;
}

// =====================================================================================
//  Torso
// =====================================================================================

/** recolour the whole torso below the collar (and optionally lift it a little): shirts, mail, the cloth under plate */
function torsoLayer(G, mat, o = {}) {
  const { T } = G, y0 = o.y0 ?? -0.09, y1 = o.y1 ?? T + 0.006, w = o.w ?? 1;
  return mat(S.box(w, y1 - y0, 1, 0.004).at(0, (y0 + y1) / 2, 0)).paint(o.soft ?? 0.005, o.raise ?? 0);
}

/** a padded or plated body: stacked shells fitted to the torso. Returns prims (first one crisp against the skin) */
function torsoShells(G, mat, o = {}) {
  const { T, k, sx } = G, g = o.grow ?? 0.012, out = [];
  const bl = o.blend ?? 0.03;
  out.push(mat(S.box(1, T + 0.02 - (o.hips === false ? 0.03 : -0.08), 1, 0.004).at(0, (T + 0.02 + (o.hips === false ? 0.03 : -0.08)) / 2, 0)).paint(0.005, 0.001));   // nothing of what is underneath shows where a shell sits close
  out.push(mat(G.shell(G.chestY + 0.004, 0.136 * k, g, g + (o.chest ?? 0))).blend(0.006));
  out.push(mat(S.capsule([-(sx - 0.05), T - 0.046, -0.006], [sx - 0.05, T - 0.046, -0.006], 0.036 * k + g * 0.8)).blend(bl));
  out.push(mat(G.shell(0.118 * k, 0.1 * k, g * 0.9)).blend(o.waist ?? bl));
  if (o.hips !== false) out.push(mat(G.shell(0.0, 0.07, g * 0.8)).blend(bl));
  return out;
}

/** belt at height y (torso space) with a buckle; returns { prims, hard } */
function belt(G, y, o = {}) {
  const h = o.h ?? 0.03, c = o.color ?? LEATHER, e = G.tp(y);
  const prims = [leather(G.band(y, h), c).paint(0.004, o.raise ?? 0.006)];
  const hard = [];
  if (o.buckle !== false) {
    const bz = e.front + (o.raise ?? 0.006) + 0.004, bc = o.buckleColor ?? BRASS;
    hard.push(gold(H.box(h * 1.5, h * 1.35, 0.008, 0.003), bc).at(o.bx ?? 0, y, bz).lod(1));
    hard.push(leather(H.box(h * 0.9, h * 0.78, 0.01, 0.002), tone(c, 0, 0, -0.06)).at(o.bx ?? 0, y, bz).lod(1));
    hard.push(gold(H.box(h * 0.16, h * 1.1, 0.012, 0.002), bc).at(o.bx ?? 0, y, bz + 0.002).lod(0));
  }
  return { prims, hard };
}

/** a pouch hanging from the belt at angle `deg` round the waist (0 = front, 90 = the left hip) */
function pouch(G, y, deg, o = {}) {
  const e = G.tp(y), a = deg * DEG, s = o.size ?? 1, c = o.color ?? DARK_LEATHER;
  const x = Math.sin(a) * (e.side + 0.012), z = e.zc + Math.cos(a) * (e.depth + 0.014);
  const prims = [
    leather(S.box(0.05 * s, 0.055 * s, 0.03 * s, 0.012 * s), c).rot(0, deg, 0).at(x, y - 0.035 * s, z).blend(0.004),
    leather(S.box(0.054 * s, 0.03 * s, 0.034 * s, 0.01 * s), tone(c, 0, 0, 0.05)).rot(0, deg, 0).at(x, y - 0.016 * s, z).blend(0.003),
  ];
  const hard = [gold(H.sphere(0.005 * s, 8), BRASS).at(x + Math.sin(a) * 0.018 * s, y - 0.03 * s, z + Math.cos(a) * 0.018 * s).lod(0)];
  return { prims, hard };
}

/**
 * A skirt hanging from the hips. Standing: a flared bell on the root node (it stays upright while the torso leans and
 * the legs swing inside it). Riding: nothing hangs between the legs; a lappet rides on each thigh instead.
 * o: top (above the hip joint), len, flare, mat, fold (pleat depth), hem { color, h }, panel { mat, w, raise } front and back
 */
function skirt(G, o) {
  const { P } = G, mat = o.mat, top = o.top ?? 0.035, len = o.len ?? 0.17, flare = o.flare ?? 0.05;
  if (G.riding) {
    const r = P.rThigh, L = P.thigh, l2 = Math.min(len * 0.8, L * 0.6);
    const lap = [mat(S.ellipsoid(r * 1.25, l2 * 0.62, r * 1.2).at(r * 0.12, -l2 * 0.36, r * 0.1)).blend(0.012)];
    if (o.fold) lap[0].bump(o.fold * 0.7, 18, 'fur');
    if (o.hem) lap.push(fin(G.band(-l2 * 0.9, o.hem.h ?? 0.012, r * 2.4), o.hem.color, 0.85, 0).paint(0.004, 0.002));
    G.lr('leg', lap);
    return;
  }
  const a = G.tp(0.0), b = G.tp(-0.03), front = Math.max(a.front, b.front), back = Math.max(a.back, b.back), side = Math.max(a.side, b.side);
  const rTop = (front + back) / 2 + (o.grow ?? 0.012), zc = (front - back) / 2, ox = Math.max(0, side + (o.grow ?? 0.012) - rTop);
  const y1 = P.hipY + top, yc = y1 - len / 2;
  const prims = [], long = len > 0.3, rHem = rTop + flare;
  for (const s of ox > 0.004 ? [-1, 1] : [0]) {
    // a long skirt is a bell: it falls nearly straight from the hips, then swings out to the hem
    const parts = long
      ? [S.cone(rTop + flare * 0.36, rTop, len * 0.52, 0.012).at(s * ox, y1 - len * 0.26, zc), S.cone(rHem, rTop + flare * 0.3, len * 0.56, 0.012).at(s * ox, y1 - len * 0.72, zc)]
      : [S.cone(rHem, rTop, len, 0.012).at(s * ox, yc, zc)];
    parts.forEach((q, i) => {
      const c = mat(q).blend(i ? 0.05 : s > 0 ? 0.03 : 0.01);
      if (o.fold) c.bump(o.fold * (i || !long ? 1 : 0.6), o.foldFreq ?? 15, 'fur');
      prims.push(c);
    });
  }
  // the hem is hollow: seen from below (a fallen body) it is a dark opening the legs come out of, not a solid base
  if (o.hollow !== false) prims.push(S.ellipsoid(ox + rHem - 0.016, Math.min(len * 0.4, 0.07), rHem - 0.016).at(0, y1 - len, zc).cut(0.006).color(o.inside ?? 0x1a1512));
  if (o.panel) {
    const pm = o.panel.mat, w = (o.panel.w ?? 0.75) * 2 * (ox + rTop);
    prims.push(pm(S.box(w, len * 1.2, 1, 0.004).at(0, yc, 0)).paint(0.004, o.panel.raise ?? 0.005));
    if (o.panel.trim) for (const s of [-1, 1]) prims.push(fin(S.box(0.012, len * 1.2, 1, 0.002).at(s * (w / 2 - 0.006), yc, 0), o.panel.trim, 0.5, 0.6).paint(0.003, (o.panel.raise ?? 0.005) + 0.0015));
  }
  if (o.hem) prims.push(fin(G.band(y1 - len + (o.hem.h ?? 0.014) / 2 + 0.002, o.hem.h ?? 0.014), o.hem.color, o.hem.rough ?? 0.85, o.hem.metal ?? 0).paint(0.004, 0.0025));
  G.add('root', prims);
  return { rTop, zc, ox, y1, len, rHem };
}

/** a cape hung from the shoulders (torso node). o: color, len, trim, band (colours), width (at the hem), slope, folds, ragged */
function cape(G, o) {
  const { T, cd, sx } = G, riding = G.riding;
  const len = (o.len ?? 0.5) * (riding ? 0.72 : 1), slope = (o.slope ?? 0.3) * (riding ? 1.9 : 1), wHem = o.width ?? sx * 2.6, wTop = o.wTop ?? sx * 0.98;
  const nf = o.folds ?? 3.2, amp = o.foldAmp ?? 0.03, rag = o.ragged ?? 0, top = Math.max(G.tp(T - 0.05).back, cd * 0.9) + (o.off ?? 0.014);
  const seed = hashStr(G.id + ':cape') % 97;
  const foldAt = (s) => Math.sin(s * Math.PI * nf + seed) * 0.62 + Math.sin(s * Math.PI * nf * 2.1 + seed * 1.7) * 0.38;
  const fn = (u, v) => {
    const s = 1 - 2 * u, s2 = s * s, f = foldAt(s);
    const x = s * lerp(wTop, wHem / 2, Math.pow(v, 0.85));
    const z = -top - slope * len * Math.pow(v, 1.25) + s2 * cd * 0.95 * Math.pow(1 - v, 2.2) * (wTop / (sx * 0.98)) - Math.sin(Math.PI * v) * 0.012 + f * amp * Math.pow(v, 0.75);
    let y = T - 0.006 - s2 * 0.026 * (1 - v) - len * v + f * 0.012 * v + (riding ? slope * len * 0.12 * v : 0);
    if (rag && v > 0.99) y += rag * (noise3(u * 13 + seed, 3.1, 7.7) - 0.3);
    return [x, y, z];
  };
  const base = o.color, trim = o.trim, dark = tone(base, 0, 0.02, -0.08), light = tone(base, 0, 0, 0.04);
  const us = [0, 0.04, 0.047], vs = [];
  const nu = o.nu ?? 16, nv = o.nv ?? 13;
  for (let i = 1; i < nu; i++) us.push(0.047 + (0.906 * i) / nu);
  us.push(0.953, 0.96, 1);
  for (let i = 0; i <= nv; i++) vs.push((i / nv) * 0.925);
  vs.push(0.932, 1);
  const cu = us.length, cv = vs.length;
  const shade = (x, y, z, nx, ny, nz, i) => {
    const ci = i % cu, ri = Math.floor(i / cu);
    if (trim != null && (ci < 2 || ci >= cu - 2 || ri >= cv - 2)) return trim;
    if (o.band != null && (ri === cv - 4 || ri === cv - 5)) return o.band;
    const f = foldAt(1 - 2 * us[ci]);
    if (o.pattern) { const pc = o.pattern(us[ci], vs[ri], f); if (pc != null) return pc; }
    return f > 0.35 ? dark : f < -0.45 ? light : null;
  };
  G.add('torso', [], [
    cloth(H.geo(surfaceGeo(us, vs, fn)), base).shade(shade).near(),
    cloth(H.geo(surfaceGeo(4, 3, fn)), o.farColor ?? base).far(),
  ]);
  return { at: fn };   // where the cloth is at (u across, v down), torso space: for things sewn on to it
}

// =====================================================================================
//  Limbs. Everything is built for the LEFT side and mirrored by G.lr.
// =====================================================================================

/** hose / leggings: a tight painted layer over the leg and the shin down to the ankle */
function hose(G, mat, o = {}) {
  const { P } = G;
  const leg = [mat(S.cyl(P.rThigh * 3, P.thigh * 1.5, 0).at(0, -P.thigh * 0.5, 0)).paint(0.005, o.raise ?? 0.0025)];
  const shin = [mat(S.cyl(P.rCalf * 3, P.shin * 1.02, 0).at(0, -P.shin * 0.47, 0)).paint(0.005, o.raise ?? 0.0025)];
  if (o.left !== false) { G.add('legL', leg); G.add('shinL', shin); }
  if (o.right !== false) { G.add('legR', leg.map((x) => x.mirrorX())); G.add('shinR', shin.map((x) => x.mirrorX())); }
}

/** boots: leather over the foot and up the shin to `top` (0..1 of the shin), with a turned cuff */
function boots(G, o = {}) {
  const { P } = G, L = P.shin, c = o.color ?? LEATHER, top = o.top ?? 0.45, gy = -L - P.footH;
  const yTop = -L * (1 - top);
  const prims = [
    leather(S.box(0.3, -gy + yTop + 0.02, 0.6, 0.004).at(0, (gy + yTop) / 2 - 0.01, 0.05), c).paint(0.004, 0.004),
    leather(G.band(yTop - 0.012, 0.024, P.rCalf * 2.6), tone(c, 0, 0, o.cuff ?? 0.06)).paint(0.004, 0.0085),
    leather(S.box(0.3, 0.014, 0.6, 0.003).at(0, gy + 0.006, 0.05), tone(c, 0, -0.05, -0.1)).paint(0.003, 0.0045),
  ];
  const hard = [];
  if (o.strap) { prims.push(leather(G.band(-L + 0.03, 0.012, P.rCalf * 2.6), tone(c, 0, 0, -0.08)).paint(0.003, 0.006)); hard.push(gold(H.box(0.014, 0.016, 0.006, 0.002), BRASS).at(P.rAnkle * 1.25, -L + 0.03, 0.004).lod(0)); }
  G.lr('shin', prims, hard);
}

/** a loose sleeve on the upper arm, optionally with relief (quilting, mail) */
function sleeve(G, mat, o = {}) {
  const { P } = G, r = P.rUpper, U = P.upper, g = o.grow ?? 1;
  const end = o.end ?? 1;
  const prims = [
    mat(S.cyl(r * 3, U * end + r * 2.2, 0).at(0, -(U * end) / 2 + r * 1.1, 0)).paint(0.004, 0.002),
    mat(S.ellipsoid(r * 1.12 * g, r * 1.42, r * 1.2 * g).at(r * 0.28, -r * 0.82, 0)).blend(0.008),
    mat(S.capsule([0, -r * 0.3, 0], [0, -U * end, 0], r * 1.2 * g, r * (o.cuff ?? 1.08) * g)).blend(0.02),
  ];
  if (o.bump) for (const x of prims.slice(1)) x.bump(o.bump[0], o.bump[1], o.bump[2]);
  if (o.hem) prims.push(fin(G.band(-U * end - r * 0.2, 0.014, r * 2.6), o.hem, 0.85, 0).paint(0.004, 0.003));
  return prims;
}
/** glove or gauntlet hand: recolours the fingers and palm (it is handed to the hand node) */
function glove(G, mat, raise = 0.0012) { const { P } = G; return mat(S.sphere(P.handR * 2.7).at(0, -P.fore - P.handR * 1.15, 0)).paint(0.004, raise); }
/** a leather bracer laced over the forearm */
function bracer(G, c = LEATHER, o = {}) {
  const { P } = G, F = P.fore, r = P.rFore;
  const y0 = -F * (o.from ?? 0.3), y1 = -F * (o.to ?? 0.9);
  const prims = [leather(S.cyl(r * 2.2, y0 - y1, 0).at(0, (y0 + y1) / 2, 0), c).paint(0.004, o.raise ?? 0.006)];
  for (const y of [y0 - 0.008, y1 + 0.008]) prims.push(leather(G.band(y, 0.011, r * 2.4), tone(c, 0, 0, -0.07)).paint(0.003, (o.raise ?? 0.006) + 0.003));
  return prims;
}

// ---------- plate ----------
// Plate is crisp sculpt: each piece is a volume slightly larger than the limb with a hard seam (.blend ~0.003)
// against what lies under it, so lames overlap visibly. o.mat sets the metal, o.trim a colour for raised edging
// (or o.trimMat a finish, e.g. a glowing seam), o.rivet the colour of the stud heads.

/** plate for one arm: { arm, armH, fore, foreH } (left side). o: pauldron (size, 0 = none), lames, upper, couter, fore */
function plateArm(G, c, o = {}) {
  const { P } = G, r = P.rUpper, U = P.upper, rf = P.rFore, rw = P.rWrist, F = P.fore;
  const st = o.mat || ((x) => steel(x, c)), tm = o.trimMat || (o.trim != null ? (x) => gold(x, o.trim) : null), rv = o.rivet ?? o.trim ?? 0xd8dce0;
  const arm = [], armH = [], fore = [], foreH = [];
  const ps = o.pauldron ?? 1;
  if (ps) {
    arm.push(st(S.ellipsoid(r * 1.5 * ps, r * 1.26 * ps, r * 1.62 * ps).at(r * 0.36, r * 0.14, 0)).blend(0.004));
    const lames = o.lames ?? 2, q = Math.sqrt(ps);
    for (let i = 0; i < lames; i++) arm.push(st(S.ellipsoid(r * (1.44 - i * 0.1) * q, r * 0.74, r * (1.52 - i * 0.1) * q).at(r * (0.3 - i * 0.08), -r * (0.92 + i * 0.74), 0)).blend(0.0025));
    if (tm) {
      arm.push(tm(S.cyl(r * 2.4 * ps, r * 0.2, 0).at(r * 0.36, -r * 0.42 * ps, 0)).paint(0.003, 0.0022));
      for (let i = 0; i < lames; i++) arm.push(tm(S.cyl(r * 2.2 * ps, r * 0.14, 0).at(r * 0.3, -r * (1.36 + i * 0.74), 0)).paint(0.003, 0.002));
    }
    for (const z of [-1, 1]) armH.push(stud([r * (0.36 + 1.2 * ps), r * 0.14, z * r * 0.86 * ps], [0.8, 0, z * 0.6], r * 0.16, rv));
  }
  if (o.upper !== false) arm.push(st(S.capsule([0, -U * 0.44, 0], [0, -U * 0.86, 0], r * 1.2, r * 1.1)).blend(0.003));
  if (o.couter !== false) {
    arm.push(st(S.sphere(r * 1.24).at(0, -U, -r * 0.12)).blend(0.003));
    arm.push(st(S.ellipsoid(r * 0.3, r * 1.02, r * 1.02).at(r * 1.08, -U, 0)).blend(0.004));
    armH.push(stud([r * 1.36, -U, 0], [1, 0, 0], r * 0.2, rv));
  }
  if (o.fore !== false) {
    fore.push(st(S.capsule([0, -F * 0.2, 0], [0, -F * 0.8, 0], rf * 1.2, rw * 1.34)).blend(0.003));
    fore.push(st(S.capsule([rf * 0.9, -F * 0.24, 0], [rw * 1.1, -F * 0.76, 0], 0.008, 0.007)).blend(0.006));          // ridge along the outside
    fore.push(st(S.cone(rw * 1.3, rw * 1.85, F * 0.3, 0.004).at(0, -F * 0.8, 0)).blend(0.003));                       // flared cuff
    if (tm) fore.push(tm(G.band(-F * 0.67, 0.01, rw * 3)).paint(0.003, 0.002));
    if (o.hand !== false) fore.push(glove(G, st, 0.0016));
  }
  return { arm, armH, fore, foreH };
}

/** plate for one leg: { leg, legH, shin, shinH } (left side). o: tasset, cuisse, poleyn, greave, sabaton */
function plateLeg(G, c, o = {}) {
  const { P } = G, r = P.rThigh, rc = P.rCalf, ra = P.rAnkle, L = P.thigh, Ls = P.shin, FL = P.footLen, gy = -Ls - P.footH;
  const st = o.mat || ((x) => steel(x, c)), tm = o.trimMat || (o.trim != null ? (x) => gold(x, o.trim) : null), rv = o.rivet ?? o.trim ?? 0xd8dce0;
  const leg = [], legH = [], shin = [], shinH = [];
  if (o.tasset !== false) {
    leg.push(st(S.ellipsoid(r * 1.0, L * 0.25, r * 0.5).rot(-5, 0, -7).at(r * 0.22, -L * 0.2, r * 0.74)).blend(0.004));
    leg.push(st(S.ellipsoid(r * 0.5, L * 0.23, r * 0.9).rot(0, 0, -7).at(r * 0.86, -L * 0.2, r * 0.05)).blend(0.006));
    if (tm) leg.push(tm(S.cyl(r * 2.6, 0.01, 0).at(0, -L * 0.385, 0)).paint(0.003, 0.002));
  }
  if (o.cuisse !== false) leg.push(st(S.capsule([0, -L * 0.4, 0.004], [0, -L * 0.84, 0.002], r * 1.1, rc * 1.24)).blend(0.003));
  if (o.poleyn !== false) {
    leg.push(st(S.sphere(rc * 1.32).at(0, -L, rc * 0.3)).blend(0.003));
    leg.push(st(S.ellipsoid(rc * 0.3, rc * 1.0, rc * 1.0).at(rc * 1.2, -L, 0)).blend(0.004));
    leg.push(st(S.ellipsoid(rc * 1.0, rc * 0.5, rc * 0.5).at(0, -L + rc * 1.05, rc * 0.72)).blend(0.003));
    legH.push(stud([rc * 1.5, -L, 0], [1, 0, 0], rc * 0.2, rv));
  }
  if (o.greave !== false) {
    shin.push(st(S.capsule([0, -Ls * 0.1, 0], [0, -Ls * 0.9, 0], rc * 1.2, ra * 1.42)).blend(0.003));
    shin.push(st(S.ellipsoid(rc * 0.98, Ls * 0.3, rc * 0.92).at(0, -Ls * 0.32, -rc * 0.42)).blend(0.012));
    shin.push(st(S.capsule([0, -Ls * 0.12, rc * 1.06], [0, -Ls * 0.86, ra * 1.28], 0.008, 0.006)).blend(0.006));
    if (tm) shin.push(tm(G.band(-Ls * 0.14, 0.01, rc * 3)).paint(0.003, 0.002));
  }
  if (o.sabaton !== false) {
    shin.push(st(S.box(0.3, P.footH + 0.05, 0.6, 0.004).at(0, gy + (P.footH + 0.05) / 2 - 0.012, 0.05)).paint(0.004, 0.0035));
    for (let i = 0; i < 3; i++) shin.push(fin(S.box(0.3, 0.08, 0.008, 0).rot(18, 0, 0).at(0, gy + 0.03, FL * (0.2 + i * 0.16)), 0x2a2e34, 0.5, 0.8).paint(0.003, -0.003));
  }
  return { leg, legH, shin, shinH };
}

/** breastplate, backplate, plackart, fauld and gorget over the torso. o: fauld (lames), gorget, keel, grow */
function cuirass(G, c, o = {}) {
  const { T, k, sx, P } = G, st = o.mat || ((x) => steel(x, c)), tm = o.trimMat || (o.trim != null ? (x) => gold(x, o.trim) : null);
  const prims = [], hard = [];
  const g = o.grow ?? 0.012;
  const ch = G.tp(G.chestY);
  prims.push(st(S.ellipsoid(ch.side + g, 0.138 * k, ch.depth + g + 0.008).at(0, G.chestY + 0.004, ch.zc + 0.005)).blend(0.004));
  if (o.keel !== false) prims.push(st(S.ellipsoid(0.02, 0.105 * k, 0.03).at(0, G.chestY - 0.012, ch.front + g + 0.002)).blend(0.03));
  prims.push(st(S.capsule([-(sx - 0.05), T - 0.046, -0.006], [sx - 0.05, T - 0.046, -0.006], 0.036 * k + g)).blend(0.012));
  const w = G.tp(0.118 * k);
  prims.push(st(S.ellipsoid(w.side + g * 1.15, 0.09 * k, w.depth + g * 1.3).at(0, 0.125 * k, w.zc)).blend(0.003));
  const n = o.fauld ?? 3;
  for (let i = 0; i < n; i++) {
    const y = 0.042 - i * 0.03, e = G.tp(Math.max(-0.03, y - 0.01));
    prims.push(st(S.ellipsoid(e.side + g + i * 0.005, 0.036, e.depth + g + 0.004 + i * 0.006).at(0, y, e.zc)).blend(0.002));
    if (tm && (i === n - 1 || o.seams)) prims.push(tm(G.band(y - 0.02, 0.009)).paint(0.003, o.seams ? -0.002 : 0.002));
  }
  if (o.gorget !== false) {
    const nr = P.rNeck;
    prims.push(st(S.cone(nr * 2.0, nr * 1.28, 0.06, 0.008).at(0, T + 0.02, -0.006)).blend(0.004));
    prims.push((tm || st)(S.torus(nr * 1.3, 0.007)).at(0, T + 0.05, -0.006).blend(0.003));
  }
  if (tm) prims.push(tm(G.band(0.2 * k, 0.009)).paint(0.003, o.seams ? -0.002 : 0.002));
  return { prims, hard };
}

// =====================================================================================
//  Heads
// =====================================================================================

/** take the face away under a closed helm: nothing of it would show, and the head is the dearest node to mesh */
function clearHead(G) {
  const h = G.nodes.head;
  h.prims.length = 0; h.hard.length = 0;
  const hair = G.nodes.hair;
  if (hair) { hair.prims.length = 0; hair.hard.length = 0; }
}

/** one curling plume feather: quill at the origin rising along +Y and arching over toward -Z, unit length */
function plumeGeo(curl, N, M) {
  return cached(`plume:${curl}:${N}:${M}`, () => {
    const line = [[0, 0, 0]], ang = [0], steps = N * 4;
    for (let i = 1; i <= steps; i++) { const v = i / steps, th = curl * Math.pow(v, 1.3), q = line[i - 1]; line.push([0, q[1] + Math.cos(th) / steps, q[2] - Math.sin(th) / steps]); ang.push(th); }
    return surfaceGeo(M, N, (u, v) => {
      const i = Math.round(v * steps), c = line[i], th = ang[i], s = 2 * u - 1;
      const w = 0.03 + 0.3 * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.62)), 0.7) * (1 - 0.3 * v), sag = -0.55 * w * Math.pow(Math.abs(s), 1.6);
      return [s * w, c[1] + Math.sin(th) * sag, c[2] + Math.cos(th) * sag];
    }, true);
  });
}
/** a plume of dyed feathers bursting from a socket at `at` (head space) and falling back: hard pieces with a lean far twin */
function plume(G, c, o = {}) {
  const R = G.R, s = o.size ?? 1, b = o.at ?? [0, R * 1.16, -R * 0.05], n = o.n ?? 7, out = [];
  const c2 = tone(c, 0, -0.04, 0.1), c3 = tone(c, 0, 0.02, -0.1), N = 9, M = 4;
  const shade = (a, b2) => (x, y, z, nx, ny, nz, i) => { const ci = i % (M + 1), ri = Math.floor(i / (M + 1)); return ci === M / 2 ? c3 : ri >= N - 2 ? b2 : (ci + ri) % 2 ? a : null; };
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5, phi = t * 2.3, arch = [Math.sin(phi), 0, -Math.cos(phi)];
    const len = R * (2.1 - Math.abs(t) * 0.9 + (i % 2) * 0.25) * s, up = norm3([arch[0] * 0.22, 1, arch[2] * 0.22 + 0.1]);
    const h = cloth(H.geo(plumeGeo(2.0 + (i % 3) * 0.25, N, M)), i % 2 ? c2 : c).shade(shade(i % 2 ? c : c2, i % 2 ? c : c2)).scale(len * 0.9, len, len);
    out.push(orient(h, add3(b, [arch[0] * R * 0.06, 0, arch[2] * R * 0.06]), up, mul3(arch, -1)).near());
  }
  for (const t of [-0.3, 0.3]) {
    const arch = [Math.sin(t * 2), 0, -Math.cos(t * 2)], len = R * 2.1 * s;
    out.push(orient(cloth(H.geo(plumeGeo(2.1, 3, 2)), c).scale(len * 1.3, len, len), b, norm3([arch[0] * 0.2, 1, arch[2] * 0.2 + 0.1]), mul3(arch, -1)).far());
  }
  return out;
}

function kettleGeo(key, o) {
  return cached(`kettle:${key}`, () => {
    const pts = [], rd = o.rd, hd = o.hd, rb = o.rb, droop = o.droop, t = o.t ?? 0.03;
    for (let i = 0; i <= 7; i++) { const a = (i / 7) * 86 * DEG; pts.push([Math.max(1e-4, Math.sin(a) * rd), Math.cos(a) * hd]); }
    pts.push([rd * 1.01, -0.03]);                                   // crown band
    pts.push([rd * 1.05, -0.05]);
    pts.push([lerp(rd, rb, 0.5), -0.05 - droop * 0.42]);
    pts.push([rb, -0.05 - droop]);
    pts.push([rb + t * 0.3, -0.05 - droop - t * 0.5]);              // rolled edge
    pts.push([rb, -0.05 - droop - t]);
    pts.push([lerp(rd, rb, 0.5), -0.05 - droop * 0.42 - t]);
    pts.push([rd * 0.97, -0.05 - t]);
    pts.push([rd * 0.95, 0.1]);
    return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), o.seg ?? 32);
  });
}
/** broad-brimmed war hat: a lathed bowl with a real brim (hard piece, with a lean twin for the far level) */
function kettleHelm(G, c, o = {}) {
  const R = G.R, st = (x) => steel(x, c);
  const shape = { rd: 1.1, hd: o.tall ?? 0.9, rb: o.brim ?? 1.56, droop: o.droop ?? 0.16 };
  const place = (h) => h.scale(R * 0.95, R, R * 1.06).rot(o.tilt ?? -5, 0, 0).at(0, R * (o.y ?? 0.4), -R * 0.07);
  const key = `${shape.hd}:${shape.rb}:${shape.droop}`;
  const hard = [
    place(st(H.geo(kettleGeo(key, shape)))).near(),
    place(st(H.geo(kettleGeo(`far:${key}`, { ...shape, seg: 9 })))).far(),
  ];
  if (o.ridge !== false) hard.push(place(st(H.torus(1.105, 0.035, 24, 6, Math.PI)).rot(0, -90, 0).scale(0.9, shape.hd / 1.105, 1)).lod(1));
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + 0.3; hard.push(place(H.geo(domeGeo()).scale(0.036).rot(0, 0, -90).rot(0, -a / DEG, 0).at(Math.cos(a) * 1.105, -0.012, Math.sin(a) * 1.105).color(o.rivet ?? 0xd8dce0).pbr(0.3, 1)).lod(0)); }
  return hard;
}

const SHELLS = {
  // open-faced bowl with a long tail: front rim just over the eyes
  sallet: { f: [[0, 1.1], [0.5, 1.02], [0.86, 0.74], [1.03, 0.4], [1.08, 0.2], [1.14, 0.1]], s: [[0, 1.1], [0.5, 1.02], [0.86, 0.74], [1.03, 0.36], [1.07, -0.02], [1.13, -0.2]], b: [[0, 1.1], [0.5, 1.02], [0.9, 0.72], [1.06, 0.3], [1.13, -0.25], [1.44, -0.68]] },
  // peaked horseman's helm
  burgonet: { f: [[0, 1.1], [0.5, 1.03], [0.86, 0.78], [1.02, 0.54], [1.12, 0.42], [1.56, 0.3]], s: [[0, 1.1], [0.5, 1.02], [0.86, 0.74], [1.02, 0.42], [1.05, 0.22], [1.08, 0.12]], b: [[0, 1.1], [0.5, 1.02], [0.9, 0.72], [1.06, 0.3], [1.1, -0.22], [1.28, -0.5]] },
  // plain round cap
  cap: { f: [[0, 1.08], [0.5, 1.0], [0.86, 0.74], [1.01, 0.52], [1.05, 0.42], [1.08, 0.38]], s: [[0, 1.08], [0.5, 1.0], [0.86, 0.74], [1.02, 0.44], [1.05, 0.26], [1.08, 0.18]], b: [[0, 1.08], [0.5, 1.0], [0.9, 0.72], [1.05, 0.36], [1.08, 0.08], [1.12, -0.04]] },
  // crude pot hammered out of scrap
  pot: { f: [[0, 1.2], [0.5, 1.14], [0.88, 0.92], [1.03, 0.62], [1.06, 0.4], [1.15, 0.34]], s: [[0, 1.2], [0.5, 1.14], [0.88, 0.92], [1.03, 0.62], [1.06, 0.4], [1.13, 0.34]], b: [[0, 1.2], [0.5, 1.14], [0.88, 0.92], [1.04, 0.58], [1.07, 0.26], [1.17, 0.16]] },
};
/** a helmet bowl from SHELLS as hard pieces: detailed shell, lean far twin, optional comb. place(h) seats it on the head */
function helmShell(G, kind, mat, o = {}) {
  const R = G.R, sh = SHELLS[kind];
  const place = o.place || ((h) => h.scale(R * (o.sx ?? 0.95), R * (o.sy ?? 1), R * (o.sz ?? 1.07)).rot(o.tilt ?? 0, 0, 0).at(0, R * (o.y ?? 0.08), R * (o.z ?? -0.06)));
  const hard = [
    place(mat(H.geo(shellGeo(kind, sh.f, sh.s, sh.b, 30, 11)))).near(),
    place(mat(H.geo(shellGeo(kind, sh.f, sh.s, sh.b, 9, 4)))).far(),
  ];
  if (o.comb) hard.push(place((o.combMat || mat)(H.torus(1.0, 0.05, 20, 6, Math.PI * 0.86)).rot(0, 0, 14).rot(0, -90, 0).scale(0.55, (sh.f[0][1] + 0.02 + o.comb) / 1.05, 1.02).at(0, 0, 0)).lod(1));
  return { hard, place };
}

/** under a hood, coif or cheek plates a human's ears only bleed their colour through the cloth: take them off */
function dropEars(G) {
  if (G.P.species !== 'human') return;
  const h = G.nodes.head, R = G.R;
  for (let i = h.prims.length - 1; i >= 0; i--) { const e = h.prims[i].m.elements; if (Math.abs(e[12]) > R * 0.8 && Math.abs(e[13]) < R * 0.3 && !h.prims[i].p.a) h.prims.splice(i, 1); }
}
/** cheek guards hung from an open helm: sculpted onto the sides of the face */
function cheekPlates(G, mat) {
  const R = G.R;
  return S.mirrorX([
    mat(S.box(R * 0.12, R * 0.86, R * 0.6, R * 0.05).rot(8, 0, 5).at(R * 0.9, -R * 0.36, R * 0.12)).blend(0.004),
    mat(S.box(R * 0.1, R * 0.34, R * 0.34, R * 0.045).rot(20, 14, 16).at(R * 0.82, -R * 0.78, R * 0.34)).blend(0.006),
  ]);
}

/**
 * A close hood or coif round the face. It is put in FRONT of the head's own prims, so the opening can be carved
 * without touching the face that is unioned in afterwards. o: grow, open [w, h] (in head radii), oy (centre of the
 * opening), bump, peak (a point trailing behind), deep (0..1 overhang), inside (colour of the hollow)
 */
function hoodShell(G, mat, o = {}) {
  const R = G.R, L = G.P.headLen / 1.12, g = o.grow ?? 0.12, deep = o.deep ?? 0;
  const open = o.open ?? [0.66, 0.84];
  const p = [];
  dropEars(G);
  p.push(mat(S.ellipsoid(R * (0.92 + g), R * (0.98 * L + g), R * (1.02 + g + deep * 0.14)).at(0, R * 0.16, R * (-0.08 + deep * 0.14))));
  if (o.neck !== false) {
    p.push(mat(S.ellipsoid(R * (0.9 + g), R * 0.62, R * (0.86 + g)).at(0, -R * 0.52, -R * 0.12)).blend(0.03));                                       // round the jaw
    p.push(mat(S.capsule([0, -R * 0.5, -R * 0.12], [0, -R * 1.5, -R * 0.18], G.P.rNeck * 1.3 + R * g * 0.5, G.P.rNeck * 1.42 + R * g * 0.5)).blend(0.03));   // round the neck
  }
  if (o.peak) p.push(mat(rod([0, R * 0.92, -R * 0.5], [0, R * (0.92 - o.peak * 0.7), -R * (1.15 + o.peak)], R * 0.44, R * 0.09)).blend(0.05));
  if (o.bump) for (const x of p) x.bump(o.bump[0], o.bump[1], o.bump[2]);
  const oy = o.oy ?? -0.2;
  p.push(S.ellipsoid(R * open[0], R * open[1], R * (0.9 + deep * 0.3)).at(0, R * oy, R * (0.98 + deep * 0.14)).cut(0.012).color(o.inside ?? 0x1a1614));
  G.nodes.head.prims.unshift(...p);
}

/** a small skull for trophies and fetishes: cranium, jaw, dark sockets */
function skull(pos, r, yaw = 0, pitch = 0, c = BONE) {
  const dark = 0x1a1410;
  const cr = bone(H.sphere(1, 12), c).shade((x, y, z) => (z > 0.5 && Math.abs(x) > 0.16 && Math.abs(x) < 0.62 && y > -0.3 && y < 0.2 ? dark : z > 0.74 && Math.abs(x) < 0.1 && y < -0.3 && y > -0.62 ? dark : null)).scale(r * 0.9, r, r * 1.06);
  const jaw = bone(H.box(r * 1.05, r * 0.5, r * 0.95, r * 0.14), tone(c, 0, 0, -0.06)).at(0, -r * 0.82, r * 0.2);
  const teeth = H.box(r * 0.8, r * 0.06, r * 0.1, 0).at(0, -r * 0.62, r * 0.68).color(dark).pbr(0.9);
  return [cr, jaw, teeth].map((h) => h.rot(pitch, yaw, 0).at(pos[0], pos[1], pos[2]).lod(1));
}
/** a bone from a to b with knuckled ends */
function boneRod(a, b, r, c = BONE) {
  const d = sub3(b, a), l = len3(d), out = [orient(bone(H.cyl(r * 0.8, r * 0.8, l, 6), c), add3(a, mul3(d, 0.5)), d)];
  for (const e of [a, b]) out.push(bone(H.sphere(r * 1.5, 6), c).at(e[0], e[1], e[2]));
  return out.map((h) => h.lod(1));
}

// =====================================================================================
//  Bigger garments built from the pieces above
// =====================================================================================

/** a long robe: soft body, wide sleeves, a bell skirt to the ankle and cloth round the legs inside it */
function robe(G, c, o = {}) {
  const { P } = G, m = o.mat || ((x) => cloth(x, c)), fold = o.fold ?? 0.012;
  const under = o.under ?? tone(c, 0, -0.03, -0.09);
  G.add('torso', [torsoLayer(G, m, { raise: 0.003 }), ...torsoShells(G, (x) => m(x).bump(0.003, 17, 'fur'), { grow: 0.01 })]);
  const r = P.rFore, F = P.fore;
  G.lr('arm', sleeve(G, m, { grow: 1.05, bump: [0.003, 22, 'fur'] }));
  const fore = o.fore === false ? [] : [m(S.sphere(r * 1.25)).blend(0.01), m(S.cone(r * (o.bell ?? 2.0), r * 1.25, F * 0.92, 0.012).at(0, -F * 0.47, 0)).blend(0.02).bump(0.003, 24, 'fur')];
  if (o.cuff != null) fore.push(fin(G.band(-F * 0.9, 0.018, r * 4), o.cuff, o.cuffRough ?? 0.5, o.cuffMetal ?? 0.7).paint(0.003, 0.002));
  G.lr('fore', fore);
  G.cores('arm', c); G.cores('fore', c); G.cores('leg', under); G.cores('shin', under);
  const hemY = o.hemY ?? 0.045;
  if (!G.riding) G.nodes.root.detail = 0.82;
  const sk = skirt(G, { mat: m, top: 0.03, len: P.hipY + 0.03 - hemY, flare: o.flare ?? 0.115, fold, foldFreq: 13, hem: o.hem, panel: o.panel });
  if (!G.riding) {
    // cloth round the legs, so a striding leg that pushes through the bell reads as the robe swinging
    G.lr('leg', [cloth(S.capsule([0, 0, 0], [0, -P.thigh, 0], P.rThigh * 1.3, P.rCalf * 1.75), under).blend(0.02)]);
    if (!o.barefoot) G.lr('shin', [
      cloth(S.box(0.3, P.footH + 0.06, 0.6, 0.004).at(0, -P.shin - P.footH + (P.footH + 0.06) / 2 - 0.012, 0.05), o.shoe ?? tone(under, 0, 0, -0.05)).paint(0.004, 0.002),   // slippers
      cloth(S.cone(P.rCalf * 2.1, P.rCalf * 1.7, P.shin * 0.86, 0.01).at(0, -P.shin * 0.43, 0), under).blend(0.02),
    ]);
  }
  return sk;
}

/** a short cape over the shoulders (torso node): mantles, cowls, hood collars */
function mantle(G, mat, o = {}) {
  const { T, k, sx } = G, e = G.tp(T - 0.05), drop = o.drop ?? 0.05;
  const prims = [
    mat(S.ellipsoid(sx + (o.reach ?? 0.03), drop * k, e.depth + 0.03).at(0, T - 0.012 - drop * k * 0.35, e.zc)).blend(0.012),
    mat(S.ellipsoid(G.P.rNeck * 1.7, 0.045, G.P.rNeck * 1.7).at(0, T + 0.004, -0.008)).blend(0.03),
  ];
  if (o.bump) for (const x of prims) x.bump(o.bump[0], o.bump[1], o.bump[2]);
  if (o.trim != null) prims.push(fin(G.band(T - 0.012 - drop * k * 0.92, 0.014), o.trim, o.trimRough ?? 0.5, o.trimMetal ?? 0.7).paint(0.003, 0.002));
  return prims;
}

/** a strap slung from one shoulder to the opposite hip (paints front and back). left = it sits on the left shoulder */
function baldric(G, c = LEATHER, left = true, w = 0.026) {
  const { T } = G, a = Math.atan2(G.sx * 0.9 + G.tp(0.06).side * 0.9, T * 0.82) / DEG;
  return leather(S.box(w, T * 2.2, 1, 0.003).rot(0, 0, left ? -a : a).at(0, T * 0.5, 0), c).paint(0.004, 0.006);
}

/** quiver of arrows across the back, its mouth over the left shoulder */
function quiver(G, o = {}) {
  const { T, k } = G, zb = -(G.tp(T * 0.5).back + (o.off ?? 0.05));
  const a = [-0.06 * k, 0.03, zb + 0.005], b = [0.075 * k, T + 0.03, zb - 0.012], d = norm3(sub3(b, a)), l = len3(sub3(b, a));
  const mid = add3(a, mul3(d, l * 0.5)), c = o.color ?? LEATHER;
  const hard = [
    orient(leather(H.cyl(0.034, 0.026, l, 10), c), mid, d),
    orient(leather(H.torus(0.035, 0.006, 14, 6), tone(c, 0, 0, -0.08)).rot(90, 0, 0), b, d).lod(1),
    orient(leather(H.torus(0.031, 0.005, 14, 6), tone(c, 0, 0, -0.08)).rot(90, 0, 0), add3(a, mul3(d, l * 0.35)), d).lod(1),
  ];
  const r = rng(hashStr(G.id + ':quiver')), fl = o.fletch ?? [0xe8e2d0, 0xb03a2e, 0xe8e2d0];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * 6.283, off = [Math.cos(ang) * 0.016, 0, Math.sin(ang) * 0.016];
    const base = add3(add3(b, off), mul3(d, -0.02)), dir = norm3(add3(d, [(r() - 0.5) * 0.22, 0, (r() - 0.5) * 0.22])), len = 0.09 + r() * 0.03;
    hard.push(orient(H.cyl(0.0035, 0.0035, len, 5), add3(base, mul3(dir, len / 2)), dir).color(0xb89a6a).pbr(0.7).lod(1));
    for (const tw of [0, 90]) hard.push(feather(add3(base, mul3(dir, len * 0.45)), dir, len * 0.62, 0.022, [Math.cos(tw * DEG), 0, Math.sin(tw * DEG)], [0x8a7a5a, fl[i % 3], fl[i % 3]]).lod(1));
  }
  return hard;
}

/** a book hung from the belt */
function tome(G, y, deg, o = {}) {
  const e = G.tp(y), a = deg * DEG, c = o.color ?? 0x6a2a22, s = o.size ?? 1;
  const x = Math.sin(a) * (e.side + 0.022), z = e.zc + Math.cos(a) * (e.depth + 0.022);
  const put = (h) => h.rot(0, 0, 8).rot(0, deg, 0).at(x, y - 0.075 * s, z);
  return [
    put(leather(H.box(0.066 * s, 0.086 * s, 0.03 * s, 0.004), c)).lod(1),
    put(H.box(0.058 * s, 0.078 * s, 0.022 * s, 0.001).at(0.004 * s, 0, 0).color(0xe6dcc0).pbr(0.9)).lod(1),
    put(gold(H.box(0.07 * s, 0.012 * s, 0.032 * s, 0.002), BRASS).at(0, 0.02 * s, 0)).lod(0),
    put(gold(H.box(0.07 * s, 0.012 * s, 0.032 * s, 0.002), BRASS).at(0, -0.02 * s, 0)).lod(0),
    put(gold(H.sphere(0.008 * s, 8), GOLD).scale(1, 1, 0.5).at(0, 0, 0.016 * s)).lod(0),
    put(leather(H.box(0.008, 0.07 * s, 0.006, 0.001), DARK_LEATHER).at(0, 0.07 * s, -0.006 * s)).lod(1),
  ];
}

/** an empty scabbard slung at the left hip, raked back */
function scabbard(G, y, o = {}) {
  const e = G.tp(y), len = o.len ?? 0.3, c = o.color ?? DARK_LEATHER, x = e.side + 0.016, top = [x, y - 0.01, e.zc + 0.03], d = norm3([0.12, -1, -0.52]);
  const mid = add3(top, mul3(d, len / 2));
  return [
    orient(leather(H.box(0.012, len, 0.03, 0.004), c), mid, d, [1, 0, 0]).lod(1),
    orient(gold(H.box(0.015, 0.03, 0.034, 0.003), o.metal ?? BRASS), add3(top, mul3(d, 0.016)), d, [1, 0, 0]).lod(1),
    orient(gold(H.box(0.015, 0.04, 0.03, 0.006), o.metal ?? BRASS), add3(top, mul3(d, len - 0.018)), d, [1, 0, 0]).lod(1),
    leather(H.box(0.008, 0.05, 0.01, 0.002), c).rot(20, 0, 0).at(x - 0.004, y + 0.012, e.zc + 0.03).lod(1),
  ];
}
/** a sheathed knife on the belt at the right hip */
function knife(G, y) {
  const e = G.tp(y), x = -(e.side * 0.72), z = e.zc + e.depth * 0.72 + 0.012;
  const put = (h) => h.rot(0, 0, -14).rot(0, -40, 0).at(x, y - 0.03, z);
  return [
    put(leather(H.box(0.014, 0.075, 0.024, 0.004), DARK_LEATHER).at(0, -0.02, 0)).lod(1),
    put(fin(H.cyl(0.0075, 0.0085, 0.045, 8), 0x7a5a3a, 0.7, 0).at(0, 0.04, 0)).lod(1),
    put(gold(H.sphere(0.01, 8), BRASS).at(0, 0.066, 0)).lod(1),
    put(gold(H.box(0.02, 0.006, 0.028, 0.002), BRASS).at(0, 0.018, 0)).lod(1),
  ];
}

// =====================================================================================
//  Outfits
// =====================================================================================
const OUTFITS = {};
/** outfits that bring headgear covering the scalp (true, or a test of the descriptor): see headCover() */
const HEADGEAR = {};

// ---- Kingdom: militia. Quilted jack, hose, a cowl pushed back off the head ----
OUTFITS.peasant = (G) => {
  const { T, k, P } = G, jack = G.cloth, c2 = tone(jack, 0, 0, -0.08), accent = 0x8a4636;
  const jm = (x) => cloth(x, jack);
  const quilt = (x) => x.bump(0.005, 20, 'ridges');
  // jack: padded shells quilted in vertical channels (the shells are turned so the ridges run up and down)
  const ch = G.tp(G.chestY), w = G.tp(0.118 * k), g = 0.013;
  G.add('torso', [
    torsoLayer(G, jm, { raise: 0.003 }),
    quilt(jm(S.ellipsoid(0.136 * k, ch.side + g, ch.depth + g).rot(0, 0, 90).at(0, G.chestY + 0.004, ch.zc))).blend(0.008),
    jm(S.capsule([-(G.sx - 0.05), T - 0.046, -0.006], [G.sx - 0.05, T - 0.046, -0.006], 0.036 * k + g * 0.8)).blend(0.03),
    quilt(jm(S.ellipsoid(0.1 * k, w.side + g, w.depth + g).rot(0, 0, 90).at(0, 0.118 * k, w.zc))).blend(0.03),
    cloth(S.cone(P.rNeck * 1.75, P.rNeck * 1.3, 0.04, 0.008).at(0, T + 0.012, -0.004), c2).blend(0.01),      // standing collar
    ...[-3, -2, -1, 1, 2, 3].map((i) => cloth(S.box(0.007, T * 0.86, 1, 0.001).at(i * G.cw * 0.29, T * 0.47, 0), c2).paint(0.003, -0.003)),   // quilting seams
  ]);
  const b = belt(G, 0.05 * k, { h: 0.032 }), pch = pouch(G, 0.05 * k, 62, { size: 1.5, color: 0x6a4a2c });
  G.add('torso', [baldric(G, 0x5a3c22, false, 0.022), b.prims, pch.prims], [b.hard, pch.hard, knife(G, 0.05 * k)]);
  // a row of toggles down the front
  G.add('torso', [], studs(G, 'torso', [0, 1, 2, 3].map((i) => [0.006, 0.09 * k + i * 0.05 * k, 0.5]), { dir: [0, 0, -1], r: 0.0075, color: 0x4a3524, rough: 0.6, metal: 0, lod: 1 }));
  // cowl worn down round the shoulders
  G.add('torso', mantle(G, (x) => cloth(x, accent), { drop: 0.045, reach: 0.012, bump: [0.004, 16, 'noise'] }));
  G.add('torso', [cloth(rod([0, T - 0.0, -G.cd * 1.25], [0, T - 0.12, -G.cd * 1.5], 0.036, 0.008), accent).blend(0.025)]);
  skirt(G, { mat: (x) => quilt(jm(x)), len: 0.13, flare: 0.04, top: 0.03, hem: { color: c2 } });
  // sleeves: quilted to the elbow, linen shirt below, wrist wraps
  G.lr('arm', sleeve(G, jm, { bump: [0.004, 24, 'ridges'], end: 0.92, hem: c2 }));
  G.lr('fore', [cloth(S.cyl(P.rFore * 3, P.fore * 1.2, 0).at(0, -P.fore * 0.42, 0), LINEN).paint(0.004, 0.003), ...bracer(G, LEATHER, { from: 0.62, to: 0.95, raise: 0.004 })]);
  G.cores('arm', jack); G.cores('fore', LINEN);
  const hoseC = 0x5d4a34;
  hose(G, (x) => cloth(x, hoseC)); G.cores('leg', hoseC); G.cores('shin', hoseC);
  G.lr('leg', [cloth(S.sphere(P.rCalf * 0.9).at(0, -P.thigh, P.rCalf * 0.7), tone(hoseC, 0.02, 0.05, 0.08)).paint(0.006, 0.002)]);   // a patched knee
  boots(G, { top: 0.3, color: 0x4a3524 });
};

/** mail hauberk with a belted tabard: shared by the footman and the arbalist. o.device(G, field) adds the charge */
function hauberk(G, o = {}) {
  const { T, k, P } = G, steelC = G.armor, mailC = tone(steelC, 0, -0.02, -0.17);
  const tab = o.tab, ml = (x) => mail(x, mailC), trimC = o.trim ?? GOLD;
  G.add('torso', [
    torsoLayer(G, ml, { raise: 0.004 }),
    mail(S.cone(P.rNeck * 2.3, P.rNeck * 1.25, 0.075, 0.01).at(0, T + 0.012, -0.006), mailC).blend(0.012).bump(0.003, 60, 'weave'),   // mantle of the coif
  ]);
  const tw = G.cw * 1.62;
  G.add('torso', [
    ...tab(S.box(tw, T + 0.2, 1, 0.006).at(0, T / 2 - 0.085, 0), (x) => x.paint(0.004, 0.0065)),
    ...[-1, 1].map((s) => gold(S.box(0.012, T + 0.2, 1, 0.002).at(s * (tw / 2 - 0.006), T / 2 - 0.085, 0), trimC).paint(0.003, 0.008)),
  ]);
  if (o.device) o.device(G.field('torso'));
  const b = belt(G, 0.05 * k, { h: 0.03, color: DARK_LEATHER });
  G.add('torso', b.prims, b.hard);
  skirt(G, { mat: (x) => ml(x).bump(0.003, 60, 'weave'), len: o.len ?? 0.17, flare: 0.045, top: 0.03, panel: { mat: o.panel, w: 0.62, raise: 0.006, trim: trimC }, hem: { color: tone(mailC, 0, 0, -0.08), rough: 0.5, metal: 0.8 } });
  G.lr('arm', sleeve(G, ml, { bump: [0.003, 60, 'weave'], end: 0.96, grow: 1.03 }));
  G.cores('arm', mailC);
  return { mailC, ml };
}

// ---- Kingdom: footman. Mail hauberk, tabard with the sun, kettle helm, greaves ----
OUTFITS.footman = (G) => {
  const { k, P } = G, blue = G.cloth, steelC = G.armor, trimC = GOLD;
  const tabM = (x) => cloth(x, blue);
  const { ml } = hauberk(G, {
    tab: (x, paint) => [paint(tabM(x))], panel: tabM,
    device: (f) => G.add('torso', [gold(S.sphere(0.03 * k).at(0, G.chestY - 0.012, G.tp(G.chestY).front), trimC).paint(0.006, 0)], [
      decal(G, 'torso', 'sun', { field: f, at: [0, G.chestY - 0.012, 0], size: 0.052 * k, color: trimC, rough: 0.45, metal: 0.7 }),
      decal(G, 'torso', 'disc', { field: f, at: [0, G.chestY - 0.012, 0], size: 0.021 * k, color: tone(trimC, 0, 0, 0.1), rough: 0.35, metal: 0.9, lift: 0.004, rings: 2 }),
    ]),
  });
  G.lr('fore', [cloth(S.cyl(P.rFore * 3, P.fore * 1.2, 0).at(0, -P.fore * 0.42, 0), tone(blue, 0, -0.1, -0.12)).paint(0.004, 0.003), ...bracer(G, LEATHER, { from: 0.4, to: 0.95 }), glove(G, (x) => leather(x, DARK_LEATHER))]);
  G.cores('fore', LEATHER);
  const hoseC = tone(blue, 0, -0.2, -0.2);
  hose(G, (x) => cloth(x, hoseC)); G.cores('leg', hoseC); G.cores('shin', steelC);
  boots(G, { top: 0.2, color: DARK_LEATHER });
  const pl = plateLeg(G, steelC, { tasset: false, cuisse: false, sabaton: false, poleyn: true });
  G.lr('leg', pl.leg, pl.legH); G.lr('shin', pl.shin, pl.shinH);
  G.add('torso', [], scabbard(G, 0.05 * k, { len: 0.28 }));
  hoodShell(G, ml, { grow: 0.07, bump: [0.003, 62, 'weave'], open: [0.64, 0.8], oy: -0.24 });
  G.add('head', [], kettleHelm(G, steelC, {}));
};

// ---- Kingdom: crossbowman. Mail, a tabard halved in the kingdom's colours, tall war hat, bolt case ----
OUTFITS.arbalist = (G) => {
  const { T, k, P } = G, blue = G.cloth, steelC = G.armor, pale = 0xe2d6b4;
  const split = (x, paint) => {
    // left half blue, right half pale: the same panel painted twice, the second copy clipped to one side
    const a = paint(cloth(x, blue)), q = x.p;
    const b = paint(cloth(S.box(q.w / 2, q.h, q.d, 0.004), pale)).at(-q.w / 4, T / 2 - 0.085, 0);
    return [a, b];
  };
  hauberk(G, { tab: split, panel: (x) => cloth(x, blue), len: 0.15 });
  // padded forearms, open-fingered gloves
  G.lr('fore', [cloth(S.cyl(P.rFore * 3, P.fore * 1.2, 0).at(0, -P.fore * 0.42, 0), pale).paint(0.004, 0.003), ...bracer(G, DARK_LEATHER, { from: 0.3, to: 0.92 })]);
  G.cores('fore', DARK_LEATHER);
  // bolt case on the right hip, spanning hook at the belt
  const y = 0.05 * k, e = G.tp(y), bx = -(e.side + 0.03), bz = e.zc - 0.01;
  const hard = [
    leather(H.box(0.05, 0.13, 0.07, 0.008), LEATHER).rot(8, 0, 6).at(bx, y - 0.07, bz).lod(1),
    leather(H.box(0.054, 0.02, 0.074, 0.004), DARK_LEATHER).rot(8, 0, 6).at(bx - 0.004, y - 0.012, bz + 0.008).lod(1),
    gold(H.torus(0.014, 0.004, 10, 5, Math.PI * 1.3), 0x8a8f96).rot(0, 0, 200).at(0.03, y - 0.03, e.front + 0.012).lod(0),
  ];
  for (let i = 0; i < 5; i++) {
    const p0 = [bx - 0.004 + ((i % 2) - 0.5) * 0.018, y, bz + 0.01 + (i - 2) * 0.013];
    hard.push(H.cyl(0.004, 0.004, 0.05, 5).rot(8, 0, 6).at(p0[0], p0[1] + 0.012, p0[2]).color(0xb89a6a).pbr(0.7).lod(1));
    hard.push(feather([p0[0], p0[1] + 0.012, p0[2]], [-0.1, 1, 0.14], 0.034, 0.02, [1, 0, 0.3], [0x8a7a5a, i % 2 ? 0xe8e2d0 : 0x2f5aa8, 0xe8e2d0]).lod(1));
  }
  G.add('torso', [], hard);
  const hoseC = tone(blue, 0, -0.15, -0.16);
  hose(G, (x) => cloth(x, hoseC)); G.cores('leg', hoseC); G.cores('shin', DARK_LEATHER);
  boots(G, { top: 0.62, color: DARK_LEATHER, strap: true });
  const pl = plateLeg(G, steelC, { tasset: false, cuisse: false, sabaton: false, greave: false });
  G.lr('leg', pl.leg, pl.legH);
  // padded coif under a tall hat with a narrow brim
  hoodShell(G, (x) => cloth(x, 0x7a5a3a), { grow: 0.07, bump: [0.003, 30, 'ridges'], open: [0.66, 0.82], oy: -0.24 });
  G.add('head', [], kettleHelm(G, steelC, { tall: 1.06, brim: 1.38, droop: 0.26, tilt: -3, y: 0.36 }));
};

// ---- Kingdom: halberdier. Brigandine studded with brass, plate arms and legs, sallet ----
OUTFITS.manAtArms = (G) => {
  const { T, k, P } = G, blue = G.cloth, c = G.armor, mailC = tone(c, 0, -0.02, -0.2);
  const ml = (x) => mail(x, mailC), st = (x) => steel(x, c), br = (x) => cloth(x, blue);
  G.add('torso', [torsoLayer(G, ml, { raise: 0.003 })]);
  // brigandine: cloth-faced plates, so the shells are firm and the rivet heads show in rows
  const shells = torsoShells(G, br, { grow: 0.017, chest: 0.004, blend: 0.03, hips: false });
  G.add('torso', shells);
  G.add('torso', [
    leather(G.band(T - 0.1 * k, 0.012), tone(blue, 0, 0, -0.12)).paint(0.003, -0.002),
    leather(G.band(0.2 * k, 0.012), tone(blue, 0, 0, -0.12)).paint(0.003, -0.002),
    gold(S.box(0.016, T * 0.9, 0.4, 0.002).at(0, T * 0.5, 0.2), tone(blue, 0, 0, -0.14)).paint(0.003, -0.002),          // front opening
  ]);
  const f = G.field('torso'), pts = [];
  for (let row = 0; row < 5; row++) for (let i = 0; i < 16; i++) { const a = ((i + (row % 2) * 0.5) / 16) * Math.PI * 2; pts.push([Math.sin(a) * 0.5, 0.075 * k + row * 0.048 * k, Math.cos(a) * 0.5]); }
  G.add('torso', [], studs(G, 'torso', pts, { field: f, r: 0.0052, color: BRASS }));
  // gorget and bevor rising to the chin
  G.add('torso', [
    st(S.cone(P.rNeck * 2.1, P.rNeck * 1.34, 0.07, 0.008).at(0, T + 0.024, -0.004)).blend(0.004),
    st(S.torus(P.rNeck * 1.36, 0.007).at(0, T + 0.058, -0.004)).blend(0.003),
  ]);
  const b = belt(G, 0.05 * k, { h: 0.03, color: DARK_LEATHER }), pch = pouch(G, 0.05 * k, -60, { size: 0.9 });
  G.add('torso', [b.prims, pch.prims], [b.hard, pch.hard]);
  skirt(G, { mat: br, len: 0.13, flare: 0.04, top: 0.03, hem: { color: BRASS, rough: 0.4, metal: 0.9, h: 0.01 }, fold: 0 });
  const pa = plateArm(G, c, { pauldron: 0.86, lames: 1 });
  G.lr('arm', [ml(S.cyl(P.rUpper * 3, P.upper * 1.6, 0).at(0, -P.upper * 0.5, 0)).paint(0.005, 0.002), ...pa.arm], pa.armH);
  G.lr('fore', [ml(S.cyl(P.rFore * 3, P.fore * 1.1, 0).at(0, -P.fore * 0.45, 0)).paint(0.005, 0), ...pa.fore], pa.foreH);
  // legs: particoloured hose, plate from the knee down
  hose(G, (x) => cloth(x, tone(blue, 0, -0.1, -0.1)), { right: false });
  hose(G, (x) => cloth(x, 0xcbb98a), { left: false });
  const pl = plateLeg(G, c, { tasset: false, cuisse: false });
  G.lr('leg', pl.leg, pl.legH); G.lr('shin', pl.shin, pl.shinH);
  for (const n of ['arm', 'fore', 'shin']) G.cores(n, c);
  G.core('legL', tone(blue, 0, -0.1, -0.1)); G.core('legR', 0xcbb98a);
  // sallet over a mail collar
  const hs = helmShell(G, 'sallet', st, { tilt: -4, comb: 0.02 });
  G.add('head', [], hs.hard);
  for (const s of [-1, 1]) G.add('head', [], [hs.place(H.geo(domeGeo()).scale(0.07).rot(0, 0, -90 * s).at(s * 1.035, 0.3, 0.1).color(0xd8dce0).pbr(0.3, 1)).lod(0)]);
};

// ---- Kingdom: knight. Full articulated plate, great helm with a plume, cape ----
/** full plate over mail: shared by the knight and the paladin */
function fullPlate(G, c, o = {}) {
  const { P } = G, mailC = tone(c, 0, -0.03, -0.32), trim = o.trim;
  const ml = (x) => mail(x, mailC);
  G.add('torso', [torsoLayer(G, ml)]);
  G.lr('arm', [ml(S.cyl(P.rUpper * 3, P.upper * 1.6, 0).at(0, -P.upper * 0.5, 0)).paint(0.005, 0)]);
  G.lr('fore', [ml(S.cyl(P.rFore * 3, P.fore * 1.1, 0).at(0, -P.fore * 0.45, 0)).paint(0.005, 0)]);
  G.lr('leg', [ml(S.cyl(P.rThigh * 3, P.thigh * 1.5, 0).at(0, -P.thigh * 0.5, 0)).paint(0.005, 0)]);
  G.lr('shin', [ml(S.cyl(P.rCalf * 3, P.shin * 1.0, 0).at(0, -P.shin * 0.46, 0)).paint(0.005, 0)]);
  for (const n of ['arm', 'fore', 'leg', 'shin']) G.cores(n, c);
  const cu = cuirass(G, c, { trim, fauld: o.fauld ?? 3 });
  G.add('torso', cu.prims, cu.hard);
  const pa = plateArm(G, c, { trim, pauldron: o.pauldron ?? 1.08, lames: o.lames ?? 2 });
  G.lr('arm', pa.arm, pa.armH); G.lr('fore', pa.fore, pa.foreH);
  const pl = plateLeg(G, c, { trim });
  G.lr('leg', pl.leg, pl.legH); G.lr('shin', pl.shin, pl.shinH);
  // a short skirt of mail under the fauld
  skirt(G, { mat: (x) => ml(x).bump(0.003, 60, 'weave'), len: 0.105, flare: 0.022, top: 0.0, grow: 0.004, panel: o.panel });
  return { ml, mailC };
}

OUTFITS.knight = (G) => {
  const { k, R } = G, c = G.armor, blue = G.cloth, trim = GOLD;
  const st = (x) => steel(x, c);
  fullPlate(G, c, { trim });
  const f = G.field('torso');
  G.add('torso', [], [decal(G, 'torso', 'sun', { field: f, at: [0, G.chestY + 0.004, 0], size: 0.042 * k, color: trim, rough: 0.3, metal: 1 })]);
  const b = belt(G, 0.058 * k, { h: 0.024, color: DARK_LEATHER, raise: 0.004, buckleColor: GOLD });
  G.add('torso', b.prims, b.hard);
  cape(G, { color: blue, len: 0.56, trim, slope: 0.3 });
  G.add('torso', [], scabbard(G, 0.058 * k, { len: 0.36, color: 0x2a2a4a, metal: GOLD }));
  // great helm: barrel, brow band, brass cross over the sights, breaths, a plume
  clearHead(G);
  const gh = [
    st(S.cone(R * 1.13, R * 1.0, R * 2.0, R * 0.08).at(0, -R * 0.1, 0)),
    st(S.ellipsoid(R * 0.97, R * 0.3, R * 0.97).at(0, R * 0.84, 0)).blend(0.025),
    st(S.cone(R * 1.24, R * 1.14, R * 0.2, R * 0.03).at(0, -R * 1.06, 0)).blend(0.006),
    st(S.cyl(R * 1.09, R * 0.3, R * 0.02).at(0, R * 0.12, 0)).blend(0.003),
    gold(S.box(R * 0.2, R * 1.84, R * 0.8, 0.003).at(0, -R * 0.14, R * 0.98), trim).paint(0.003, 0.004),
    gold(S.box(R * 2.6, R * 0.3, R * 1.2, 0.003).at(0, R * 0.12, R * 0.7), trim).paint(0.003, 0.003),
    ...[-1, 1].map((s) => S.box(R * 0.56, R * 0.1, R * 0.5, 0.002).at(s * R * 0.43, R * 0.12, R * 1.0).cut(0.002).color(0x08080a)),
    gold(G.band(-R * 1.14, R * 0.08, R * 2), trim).paint(0.003, 0.003),
  ];
  const ghH = [gold(H.cyl(R * 0.1, R * 0.17, R * 0.14, 10), trim).at(0, R * 1.16, -R * 0.02).lod(1), ...plume(G, blue, { at: [0, R * 1.18, -R * 0.02], size: 1.0 })];
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ghH.push(H.cyl(R * 0.03, R * 0.03, 0.004, 8).rot(90, 0, 0).rot(0, s * (22 + i * 9), 0).at(s * R * (0.4 + i * 0.165), -R * (0.42 + j * 0.16), R * (1.045 - i * 0.075)).color(0x08080a).pbr(0.9).lod(0));
  G.add('head', gh, ghH);
};

// ---- Kingdom: paladin. Gilded ivory plate, winged helm, a long cape with the sun band ----
OUTFITS.paladin = (G) => {
  const { k, R, T } = G, c = G.armor, cl = G.cloth, trim = GOLD, white = 0xf2ecdc;
  const st = (x) => steel(x, c);
  fullPlate(G, c, { trim, pauldron: 1.2, lames: 3, panel: { mat: (x) => cloth(x, white), w: 0.42, raise: 0.006, trim } });
  const f = G.field('torso');
  G.add('torso', [gold(G.band(0.118 * k, 0.05), trim).paint(0.003, 0.002)], [
    decal(G, 'torso', 'sun', { field: f, at: [0, G.chestY + 0.002, 0], size: 0.058 * k, color: trim, rough: 0.28, metal: 1 }),
    decal(G, 'torso', 'disc', { field: f, at: [0, G.chestY + 0.002, 0], size: 0.02 * k, color: 0xfff2c0, rough: 0.3, metal: 0.6, lift: 0.004, rings: 2 }),
  ]);
  const b = belt(G, 0.058 * k, { h: 0.026, color: 0x6a4a2a, raise: 0.004, buckleColor: GOLD });
  G.add('torso', b.prims, b.hard);
  cape(G, { color: cl, len: 0.68, trim: white, slope: 0.3, width: G.sx * 2.9 });
  // cape clasps
  for (const s of [-1, 1]) G.add('torso', [], [gold(H.sphere(0.016, 10), trim).scale(1, 1, 0.5).at(s * G.sx * 0.62, T - 0.03, G.tp(T - 0.04).front * 0.72 + 0.016).lod(1)]);
  // helm: rounded skull, a prow of a visor, a gilded comb and a wing at each temple
  clearHead(G);
  const hp = [
    st(S.ellipsoid(R * 1.06, R * 1.12, R * 1.14).at(0, R * 0.14, -R * 0.04)),
    st(S.cone(R * 0.84, R * 0.2, R * 0.9, R * 0.04).rot(90, 0, 0).at(0, -R * 0.24, R * 0.7)).blend(0.004),
    st(S.ellipsoid(R * 0.9, R * 0.5, R * 0.94).at(0, -R * 0.8, R * 0.08)).blend(0.004),
    st(S.cone(R * 1.26, R * 1.0, R * 0.36, R * 0.03).at(0, -R * 1.12, -R * 0.02)).blend(0.006),
    gold(S.ellipsoid(R * 0.07, R * 1.24, R * 1.25).at(0, R * 0.2, -R * 0.07), trim).blend(0.004),
    S.box(R * 1.36, R * 0.1, R * 0.7, 0.002).at(0, R * 0.02, R * 0.92).cut(0.002).color(0x08080a),
    gold(S.box(R * 2.4, R * 0.07, R * 1.4, 0.002).at(0, R * 0.13, R * 0.6), trim).paint(0.003, 0.003),
    gold(S.box(R * 2.4, R * 0.07, R * 1.4, 0.002).at(0, -R * 0.56, R * 0.6), trim).paint(0.003, 0.003),
    gold(G.band(-R * 1.24, R * 0.09, R * 2), trim).paint(0.003, 0.003),
  ];
  const hh = [];
  const cols = [tone(trim, 0, 0, -0.1), white, trim];
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
    const a = (28 + i * 14) * DEG, len = R * (1.5 - i * 0.14);
    hh.push(feather([s * R * 1.0, R * (0.2 + i * 0.03), -R * (0.1 + i * 0.05)], [s * 0.3, Math.sin(a), -Math.cos(a)], len, R * 0.3, [s, 0, 0.2], cols).lod(i < 2 ? 99 : 1));
  }
  for (const s of [-1, 1]) hh.push(gold(H.sphere(R * 0.16, 10), trim).scale(0.5, 1, 1).at(s * R * 1.04, R * 0.2, -R * 0.1).lod(1));
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) hh.push(H.cyl(R * 0.028, R * 0.028, 0.004, 8).rot(90, 0, 0).rot(0, s * 40, 0).at(s * R * (0.28 + i * 0.1), -R * 0.36, R * (0.93 - i * 0.13)).color(0x08080a).pbr(0.9).lod(0));
  G.add('head', hp, hh);
};

// ---- Kingdom: longbowman. Hooded cloak, leather jerkin, bracer, quiver ----
OUTFITS.ranger = (G) => {
  const { T, k, P } = G, green = G.cloth, dk = tone(green, 0.01, -0.05, -0.08), jerkin = 0x6a4a2c, shirt = 0xb8ad8a;
  const gm = (x) => cloth(x, green);
  G.add('torso', [
    torsoLayer(G, (x) => cloth(x, shirt), { raise: 0.002 }),
    ...torsoShells(G, (x) => leather(x, jerkin), { grow: 0.009, blend: 0.025, hips: false }),
    leather(S.box(0.012, T * 0.8, 0.4, 0.002).at(0, T * 0.5, 0.2), DARK_LEATHER).paint(0.003, -0.0025),                 // laced front
  ]);
  const f = G.field('torso');
  G.add('torso', [], studs(G, 'torso', [0, 1, 2, 3, 4].flatMap((i) => [-1, 1].map((s) => [s * 0.014, 0.085 * k + i * 0.04 * k, 0.5])), { field: f, dir: [0, 0, -1], r: 0.0042, color: BRASS }));
  G.add('torso', [baldric(G, DARK_LEATHER, true)]);
  const b = belt(G, 0.05 * k, { h: 0.03 }), pch = pouch(G, 0.05 * k, -55);
  G.add('torso', [b.prims, pch.prims], [b.hard, pch.hard]);
  skirt(G, { mat: (x) => leather(x, jerkin), len: 0.115, flare: 0.035, top: 0.03, hem: { color: DARK_LEATHER, rough: 0.6 } });
  // cloak: a cowl over the shoulders and a cape behind
  G.add('torso', mantle(G, gm, { drop: 0.055, reach: 0.02, bump: [0.004, 15, 'noise'] }));
  cape(G, { color: green, len: 0.5, slope: 0.3, ragged: 0.03, foldAmp: 0.034, width: G.sx * 2.5 });
  G.add('torso', [], quiver(G, { off: 0.075 }));
  // sleeves: green wool, a long bracer on the bow arm, a shooting glove on the string hand
  G.lr('arm', sleeve(G, (x) => cloth(x, dk), { bump: [0.003, 20, 'fur'], grow: 1.03 }));
  G.lr('fore', [cloth(S.cyl(P.rFore * 3, P.fore * 1.2, 0).at(0, -P.fore * 0.42, 0), dk).paint(0.004, 0.003)]);
  G.add('foreR', bracer(G, jerkin, { from: 0.12, to: 0.95, raise: 0.007 }).map((x) => x.mirrorX()));
  G.add('foreL', [...bracer(G, DARK_LEATHER, { from: 0.66, to: 0.96, raise: 0.004 }), glove(G, (x) => leather(x, jerkin))]);
  G.cores('arm', dk); G.cores('fore', dk);
  const hoseC = tone(green, 0.02, -0.1, -0.12);
  hose(G, (x) => cloth(x, hoseC)); G.cores('leg', hoseC); G.cores('shin', 0x4a3524);
  boots(G, { top: 0.72, color: 0x4a3524, cuff: 0.08, strap: true });
  hoodShell(G, gm, { grow: 0.15, open: [0.7, 0.88], oy: -0.2, peak: 0.45, bump: [0.004, 16, 'noise'], deep: 0.25 });
};

// ---- Kingdom: battle mage. Layered robe with gilt edges, hood, a belt of pouches and a tome ----
OUTFITS.mage = (G) => {
  const { T, k } = G, red = G.cloth, deep = tone(red, 0, 0.04, -0.1), inner = 0x3a2c44, trim = GOLD;
  const rm = (x) => cloth(x, red);
  robe(G, red, {
    cuff: trim, bell: 2.1,
    hem: { color: trim, h: 0.02, rough: 0.5, metal: 0.7 },
    panel: { mat: (x) => cloth(x, inner), w: 0.3, raise: -0.003, trim },
  });
  // the under-robe shows down the front, edged in gold
  G.add('torso', [
    cloth(S.box(0.07 * k, T * 0.92, 0.5, 0.004).at(0, T * 0.46, 0.25), inner).paint(0.004, -0.003),
    ...[-1, 1].map((s) => gold(S.box(0.012, T * 0.92, 0.5, 0.002).at(s * 0.04 * k, T * 0.46, 0.25), trim).paint(0.003, 0.002)),
  ]);
  G.add('root', [gold(G.band(0.045 + 0.05, 0.008), trim).paint(0.003, 0.002)]);
  // mantle and standing collar
  G.add('torso', mantle(G, (x) => cloth(x, deep), { drop: 0.062, reach: 0.034, trim, bump: [0.003, 18, 'fur'] }));
  // belt of pouches, a tome on a strap
  const y = 0.055 * k, b = belt(G, y, { h: 0.034, color: 0x4a3020, buckleColor: GOLD });
  const p1 = pouch(G, y, 52), p2 = pouch(G, y, -40, { size: 0.85, color: 0x5a3a22 }), p3 = pouch(G, y, 150, { size: 0.9 });
  G.add('torso', [b.prims, p1.prims, p2.prims, p3.prims], [b.hard, p1.hard, p2.hard, p3.hard, tome(G, y, -84)]);
  // a single steel shoulder and bracers mark him as a war wizard
  const pa = plateArm(G, 0x9aa3ad, { pauldron: 0.95, lames: 1, upper: false, couter: false, fore: false, trim });
  G.add('armL', pa.arm, pa.armH);
  hoodShell(G, rm, { grow: 0.16, open: [0.72, 0.92], oy: -0.22, peak: 0.7, deep: 0.3, bump: [0.003, 18, 'noise'] });
  G.add('head', [gold(S.torus(G.R * 0.8, G.R * 0.05).rot(90, 0, 0).at(0, -G.R * 0.2, G.R * 0.93), trim).paint(0.004, 0.002)]);
};

/** a mitre: two peaks, a band and orphrey in the trim colour, lappets behind (head node) */
function mitre(G, white, trim) {
  const R = G.R;
  const us = [], vs = [0, 0.16, 0.175];
  for (let i = 0; i <= 24; i++) us.push(i / 24);
  for (const d of [7 / 360, 9 / 360]) us.push(d, 1 - d, 0.5 - d, 0.5 + d);
  us.sort((a, b2) => a - b2);
  for (let i = 1; i <= 8; i++) vs.push(0.175 + (0.745 * i) / 8);
  vs.push(0.932, 1);
  const cu = us.length, cv = vs.length;
  const mfn = (u, v) => {
    const a = u * Math.PI * 2, ca = Math.cos(a), h = R * (0.62 + 0.95 * Math.pow(Math.abs(ca), 1.8));
    const bulge = 1 + 0.2 * Math.sin(Math.min(1, v * 1.4) * Math.PI) * Math.abs(ca), pinch = 1 - 0.72 * Math.pow(v, 2.4);
    return [Math.sin(a) * R * 0.86 * (1 - 0.5 * v * v * (1 - Math.abs(ca))) * (0.5 + 0.5 * pinch), R * 0.58 + v * h, ca * R * 0.98 * bulge * pinch - R * 0.06];
  };
  const mshade = (x, y, z, nx, ny, nz, i) => { const ci = i % cu, ri = Math.floor(i / cu), u = us[ci]; return ri <= 1 || ri >= cv - 2 || Math.min(u, 1 - u) < 8 / 360 || Math.abs(u - 0.5) < 8 / 360 ? trim : null; };
  const lap = (s) => surfaceGeo(2, 5, (u, v) => [s * R * 0.2 + (u - 0.5) * R * 0.2, R * 0.6 - v * R * 1.5, -R * (1.0 + 0.12 * Math.sin(v * 3)) - v * R * 0.2], true);
  G.add('head', [], [
    cloth(H.geo(surfaceGeo(us, vs, mfn, false, true)), white).shade(mshade).near(),
    cloth(H.geo(surfaceGeo(8, 3, mfn, false, true)), white).far(),
    ...[-1, 1].map((s) => cloth(H.geo(lap(s)), white).shade((x, y, z, nx, ny, nz, i) => (i >= 15 ? trim : null)).lod(1)),
  ]);
}

// ---- Kingdom: cleric. White vestments, a blue-and-gold stole, mitre, the sun on a chain ----
OUTFITS.priest = (G) => {
  const { T, k, P, R } = G, white = G.cloth, blue = 0x2f5aa8, trim = GOLD;
  const sk = robe(G, white, { cuff: trim, bell: 1.9, flare: 0.105, hem: { color: trim, h: 0.016, rough: 0.5, metal: 0.7 }, under: tone(white, 0, 0, -0.12) });
  // chasuble: a broad panel front and back with a gold border
  const cwid = G.cw * 1.5;
  G.add('torso', [
    cloth(S.box(cwid, T + 0.2, 1, 0.006).at(0, T / 2 - 0.09, 0), tone(white, 0.02, 0.04, 0.03)).paint(0.004, 0.005),
    ...[-1, 1].map((s) => gold(S.box(0.014, T + 0.2, 1, 0.002).at(s * (cwid / 2 - 0.007), T / 2 - 0.09, 0), trim).paint(0.003, 0.0065)),
  ]);
  // stole: two bands down the front, over the belt and on down the skirt
  const sw = 0.034 * k, sxo = 0.045 * k;
  const stoleT = [-1, 1].flatMap((s) => [
    cloth(S.box(sw, T * 1.3, 0.5, 0.003).at(s * sxo, T * 0.4, 0.25), blue).paint(0.003, 0.0085),
    gold(S.box(0.007, T * 1.3, 0.5, 0.001).at(s * (sxo + sw / 2), T * 0.4, 0.25), trim).paint(0.002, 0.0095),
    gold(S.box(0.007, T * 1.3, 0.5, 0.001).at(s * (sxo - sw / 2), T * 0.4, 0.25), trim).paint(0.002, 0.0095),
  ]);
  G.add('torso', [...stoleT, cloth(S.torus(P.rNeck * 1.5, 0.014).at(0, T + 0.004, -0.004), blue).blend(0.006), cloth(S.cone(P.rNeck * 1.5, P.rNeck * 1.22, 0.035, 0.006).at(0, T + 0.03, -0.004), white).blend(0.008)]);
  if (sk) {
    const y0 = sk.y1 - 0.24, hgt = 0.26;
    G.add('root', [-1, 1].flatMap((s) => [
      cloth(S.box(sw, hgt, 0.5, 0.003).at(s * sxo, y0 + hgt / 2, 0.25), blue).paint(0.003, 0.006),
      gold(S.box(sw + 0.008, 0.03, 0.5, 0.002).at(s * sxo, y0 + 0.015, 0.25), trim).paint(0.003, 0.007),
    ]));
  }
  const b = belt(G, 0.055 * k, { h: 0.02, color: trim, raise: 0.004, buckle: false });
  G.add('torso', b.prims.map((x) => gold(x, 0xc9a23a)));
  // the sun on a chain
  const cy = G.chestY + 0.012, cz = G.tp(cy).front + 0.014;
  const chain = [[-P.rNeck * 1.2, T + 0.01, 0.0], [-0.03, T - 0.045, cz * 0.8], [0, cy + 0.02, cz], [0.03, T - 0.045, cz * 0.8], [P.rNeck * 1.2, T + 0.01, 0.0]];
  G.add('torso', [], [
    gold(H.tube(chain, 0.0028, 20, 5), trim).lod(1),
    gold(H.extrude(SHAPES.sun.map(([x, y]) => [x * 0.03 * k, y * 0.03 * k]), 0.004, 0.001), trim).at(0, cy, cz).lod(1),
    gold(H.sphere(0.011 * k, 10), 0xfff0b0).scale(1, 1, 0.5).at(0, cy, cz + 0.004).lod(1),
  ]);
  mitre(G, white, trim);
};

// ---- Undead: necromancer. Ragged dark robe, a cavernous hood, bones ----
OUTFITS.necromancer = (G) => {
  const { T, k, P } = G, dark = G.cloth, blk = tone(dark, 0, -0.05, -0.07);
  const rm = (x) => cloth(x, dark);
  robe(G, dark, { bell: 2.3, flare: 0.11, fold: 0.011, under: blk, hem: { color: blk, h: 0.03 }, hemY: 0.03 });
  G.add('torso', mantle(G, (x) => cloth(x, blk), { drop: 0.066, reach: 0.03, bump: [0.005, 14, 'fur'] }));
  // tatters hanging from the hem of the mantle, the sleeves and the skirt
  const r = rng(hashStr(G.id + ':rags'));
  const strip = (w, len, sway) => surfaceGeo(2, 4, (u, v) => [(u - 0.5) * w * (1 - v * 0.7), -v * len, Math.sin(v * 2.6 + sway) * len * 0.12], false);
  const rags = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.4, e = G.tp(T - 0.07);
    rags.push(cloth(H.geo(strip(0.05 + r() * 0.03, 0.07 + r() * 0.07, r() * 6)), i % 2 ? dark : blk).rot(0, a / DEG, 0).rot(-P.hunch, 0, 0).at(Math.sin(a) * (G.sx + 0.02), T - 0.06, e.zc + Math.cos(a) * (e.depth + 0.03)).lod(1));
  }
  G.add('torso', [], rags);
  cape(G, { color: blk, len: 0.6, slope: 0.26, ragged: 0.07, foldAmp: 0.036, width: G.sx * 2.5 });
  // bones: ribs clasped across the chest, a spine of knuckles, a skull at the belt
  const f = G.field('torso'), ribs = [];
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    const y = G.chestY + 0.035 - i * 0.034 * k, pts = [];
    for (let j = 0; j <= 4; j++) { const x = s * (0.012 + j * 0.022 * k), p = trace(f, [x, y - j * 0.006, 0.5], [0, 0, -1]) || [x, y, G.cd]; pts.push([p[0], p[1], p[2] + 0.004]); }
    ribs.push(bone(H.tube(pts, [0.0075, 0.007, 0.006, 0.005, 0.003], 10, 6)).lod(1));
  }
  for (let i = 0; i < 4; i++) { const y = G.chestY + 0.05 - i * 0.03 * k, p = trace(f, [0, y, 0.5], [0, 0, -1]) || [0, y, G.cd]; ribs.push(bone(H.sphere(0.0095, 8)).at(0, p[1], p[2] + 0.004).lod(1)); }
  const y = 0.055 * k, b = belt(G, y, { h: 0.026, color: 0x2a2018, buckle: false }), e = G.tp(y);
  G.add('torso', b.prims, [ribs, skull([0, y - 0.012, e.front + 0.024], 0.026, 0, 8), skull([-(e.side + 0.012), y - 0.05, e.zc + 0.01], 0.021, -80, 0, 0xcfc59e), boneRod([e.side * 0.6, y - 0.02, e.front + 0.012], [e.side * 0.95, y - 0.1, e.front * 0.8 + 0.012], 0.006)]);
  // bone spikes on the left shoulder
  for (let i = 0; i < 3; i++) G.add('torso', [], [orient(bone(H.cone(0.012, 0.07 - i * 0.012, 7)), [G.sx - 0.03 - i * 0.03, T + 0.02 + i * 0.004, -0.02 + i * 0.012], [0.5 - i * 0.2, 1, -0.2]).lod(1)]);
  // deep hood: the face sits back in shadow, the eyes burn
  hoodShell(G, rm, { grow: 0.2, open: [0.74, 0.96], oy: -0.2, peak: 0.55, deep: 0.75, bump: [0.005, 14, 'fur'], inside: 0x0c0a10 });
};

/** horseman's kit shared by the lancer and the griffon rider: half plate over a padded coat, tall boots, spurs */
function cavalry(G, o = {}) {
  const { k, P } = G, c = G.armor, blue = G.cloth, mailC = tone(c, 0, -0.02, -0.2), trim = o.trim;
  const ml = (x) => mail(x, mailC), coat = o.coat ?? ((x) => cloth(x, blue));
  G.add('torso', [torsoLayer(G, coat, { raise: 0.003 })]);
  const cu = cuirass(G, c, { trim, fauld: o.fauld ?? 1, gorget: o.gorget });
  G.add('torso', cu.prims, cu.hard);
  const b = belt(G, 0.058 * k, { h: 0.026, color: DARK_LEATHER, raise: 0.004 });
  G.add('torso', b.prims, b.hard);
  skirt(G, { mat: coat, len: 0.16, flare: 0.045, top: 0.01, fold: 0.004, hem: { color: trim ?? tone(blue, 0, 0, -0.1), rough: 0.6, metal: trim != null ? 0.7 : 0 } });
  const pa = plateArm(G, c, { trim, pauldron: o.pauldron ?? 0.95, lames: o.lames ?? 1, upper: o.upper });
  G.lr('arm', [(o.sleeve ?? ml)(S.cyl(P.rUpper * 3, P.upper * 1.6, 0).at(0, -P.upper * 0.5, 0)).paint(0.005, 0.002), ...pa.arm], pa.armH);
  G.lr('fore', [(o.sleeve ?? ml)(S.cyl(P.rFore * 3, P.fore * 1.1, 0).at(0, -P.fore * 0.45, 0)).paint(0.005, 0), ...pa.fore], pa.foreH);
  // legs: padded breeches, plate on the thigh and knee, tall boots with spurs
  const br = o.breeches ?? tone(blue, 0, -0.15, -0.16);
  hose(G, (x) => cloth(x, br));
  const pl = plateLeg(G, c, { tasset: o.tasset ?? true, greave: false, sabaton: false, trim });
  G.lr('leg', pl.leg, pl.legH);
  boots(G, { top: 0.86, color: o.boot ?? 0x3a2618, cuff: 0.07, strap: true });
  const L = P.shin, gy = -L - P.footH;
  G.lr('shin', [], [
    gold(H.torus(P.rAnkle * 1.5, 0.004, 12, 5, Math.PI), 0x9aa0a8).rot(90, 0, 0).rot(0, 180, 0).at(0, gy + 0.045, -P.footLen * 0.1).lod(1),
    gold(H.cyl(0.003, 0.003, 0.03, 5), 0x9aa0a8).rot(90, 0, 0).at(0, gy + 0.045, -P.footLen * 0.1 - P.rAnkle * 1.5 - 0.014).lod(1),
    gold(H.cyl(0.011, 0.011, 0.003, 8), 0xc9a23a).rot(0, 0, 90).at(0, gy + 0.045, -P.footLen * 0.1 - P.rAnkle * 1.5 - 0.03).lod(1),
  ]);
  for (const n of ['arm', 'fore']) G.cores(n, c);
  G.cores('leg', c); G.cores('shin', o.boot ?? 0x3a2618);
}

// ---- Kingdom: lancer. Half plate, a short surcoat, peaked helm with a plume ----
OUTFITS.lancer = (G) => {
  const { k, R, T } = G, c = G.armor, blue = G.cloth, trim = GOLD;
  const st = (x) => steel(x, c);
  cavalry(G, { trim });
  const f = G.field('torso');
  G.add('torso', [], [decal(G, 'torso', 'sun', { field: f, at: [0, G.chestY + 0.004, 0], size: 0.04 * k, color: trim, rough: 0.3, metal: 1 })]);
  cape(G, { color: blue, len: 0.4, trim, slope: 0.34, width: G.sx * 2.3 });
  // a sash across the breastplate
  G.add('torso', [cloth(S.box(0.04, T * 2.2, 1, 0.003).rot(0, 0, 38).at(0, T * 0.5, 0), blue).paint(0.004, 0.004)]);
  dropEars(G);
  G.add('head', cheekPlates(G, st));
  const hs = helmShell(G, 'burgonet', st, { comb: 0.06, tilt: -3 });
  G.add('head', [], [
    hs.hard,
    plume(G, blue, { at: [0, R * 1.2, -R * 0.36], size: 0.85, n: 5 }),
    hs.place(gold(H.cyl(0.1, 0.16, 0.14, 10), trim).at(0, 1.1, -0.3)).lod(1),
    ...[-1, 1].map((s) => hs.place(gold(H.geo(domeGeo()).scale(0.07).rot(0, 0, -90 * s).at(s * 1.03, 0.16, 0.2), trim)).lod(0)),
  ]);
};

// ---- Kingdom: griffon rider. Fur-collared flying coat over a breastplate, cap with goggles, a long scarf ----
OUTFITS.skyKnight = (G) => {
  const { k, R, T, P } = G, c = G.armor, blue = G.cloth, coatC = 0x6a4a30, fur = 0xd8ceb4;
  const st = (x) => steel(x, c);
  cavalry(G, { coat: (x) => leather(x, coatC), sleeve: (x) => leather(x, coatC), pauldron: 0.8, lames: 0, upper: false, tasset: false, breeches: tone(blue, 0, -0.1, -0.1), gorget: false, boot: 0x4a3222 });
  G.lr('arm', sleeve(G, (x) => leather(x, coatC), { grow: 1.0, end: 0.9 }));
  // fur collar
  G.add('torso', [
    cloth(S.torus(P.rNeck * 1.75, 0.03).at(0, T + 0.012, -0.006), fur).bump(0.007, 40, 'fur').blend(0.008),
    cloth(S.ellipsoid(G.sx * 0.7, 0.024, G.cd * 1.1).at(0, T - 0.006, 0), fur).bump(0.007, 40, 'fur').blend(0.02),
  ]);
  // the scarf streams back over the left shoulder
  const scarf = surfaceGeo(3, 9, (u, v) => { const w = 0.06 * (1 - v * 0.3); return [P.rNeck * 1.2 + v * 0.1 + (u - 0.5) * w * 0.4, T + 0.03 - v * 0.05 + Math.sin(v * 7) * 0.02 + (u - 0.5) * w, -P.rNeck * 1.4 - v * 0.42]; });
  G.add('torso', [cloth(S.torus(P.rNeck * 1.5, 0.018).at(0, T + 0.04, -0.004), blue).blend(0.006)], [cloth(H.geo(scarf), blue).shade((x, y, z, nx, ny, nz, i) => (i >= 36 ? 0xe8e2d0 : null))]);
  const f = G.field('torso');
  G.add('torso', [], [decal(G, 'torso', 'star', { field: f, at: [0, G.chestY + 0.004, 0], size: 0.036 * k, color: GOLD, rough: 0.3, metal: 1 })]);
  // steel cap, leather flaps, goggles pushed up on the brow, a feather at each side
  hoodShell(G, (x) => leather(x, coatC), { grow: 0.04, open: [0.7, 0.86], oy: -0.22 });
  const hs = helmShell(G, 'cap', st, { y: 0.17 });
  const gog = [];
  for (const s of [-1, 1]) {
    gog.push(hs.place(gold(H.torus(0.2, 0.05, 16, 6), BRASS).at(s * 0.3, 0.56, 1.0)).lod(1));
    gog.push(hs.place(H.cyl(0.19, 0.19, 0.03, 12).rot(90, 0, 0).at(s * 0.3, 0.56, 1.0).color(0x2a3a4a).pbr(0.1, 0.3)).lod(1));
    gog.push(feather([s * R * 1.0, R * 0.5, -R * 0.2], [s * 0.35, 0.8, -0.6], R * 1.2, R * 0.3, [s, 0, 0.3], [0x6a5a3a, 0xe8e2d0, blue]).lod(1));
  }
  gog.push(hs.place(leather(H.torus(1.07, 0.04, 28, 5), DARK_LEATHER).rot(90, 0, 0).rot(-8, 0, 0).at(0, 0.5, 0)).lod(1));
  G.add('head', [], [hs.hard, gog]);
};

// =====================================================================================
//  Goblins, giants, the dead and the damned
// =====================================================================================
const furM = (c, amp = 0.008, freq = 40) => (x) => cloth(x, c).bump(amp, freq, 'fur');
const rusty = (c) => (x) => iron(x, c);
/** scrap iron for hard pieces: rust blooms over the plate */
const scrap = (h, c, seed = 0) => iron(h, c).shade((x, y, z) => { const n = noise3(x * 2.6 + seed, y * 2.6, z * 2.6 + seed); return n > 0.62 ? RUST : n > 0.54 ? mix(c, RUST, 0.5) : null; });

/** blooms of rust painted over whatever lies within r of c (node space) */
function rustOn(c, r, n = 4, seed = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.4 + seed, b2 = i * 1.7 + seed * 0.7;
    out.push(fin(S.sphere(r * (0.34 + 0.2 * ((i * 7 + seed) % 3) / 2)).at(c[0] + Math.cos(a) * Math.cos(b2) * r * 0.8, c[1] + Math.sin(b2) * r * 0.7, c[2] + Math.sin(a) * Math.cos(b2) * r * 0.8), RUST, 0.85, 0.15, 0.2, 60).paint(0.012, 0));
  }
  return out;
}
const darkEdge = (x) => fin(x, 0x35353a, 0.5, 0.7);

/** ragged strips hanging round a ring: torn hems. o: n, y, len, w, colors, ring(a) -> [x, z], flare, seed, lean (the node's forward pitch, so they still hang plumb) */
function tatters(G, o) {
  const r = rng(hashStr(`${G.id}:${o.seed ?? 'tat'}`)), out = [];
  for (let i = 0; i < o.n; i++) {
    const a = (i / o.n) * Math.PI * 2 + r() * 0.3, len = o.len * (0.6 + r() * 0.8), w = o.w * (0.7 + r() * 0.6), sway = r() * 6, fl = o.flare ?? 0.15;
    const g = surfaceGeo(2, 4, (u, v) => [(u - 0.5) * w * (1 - v * 0.75), -v * len, Math.sin(v * 2.4 + sway) * len * 0.1 + v * len * fl]);
    const q = o.ring(a);
    out.push(cloth(H.geo(g), o.colors[i % o.colors.length]).rot(0, a / DEG, 0).rot(-(o.lean ?? 0), 0, 0).at(q[0], o.y, q[1]).lod(o.lod ?? 1));
  }
  return out;
}
/** ring round the torso at height y, `out` beyond the surface */
const waistRing = (G, y, out = 0.01) => { const e = G.tp(y); return (a) => [Math.sin(a) * (e.side + out), e.zc + Math.cos(a) * (e.depth + out)]; };
/** ring round a skirt's hem (root space) */
const hemRing = (sk, out = 0.0) => (a) => [Math.sin(a) * (sk.ox + sk.rHem + out), sk.zc + Math.cos(a) * (sk.rHem + out)];

/** a flap of hide or cloth hanging from the belt in front (s = 1) or behind (s = -1): root node */
function flap(G, sk, s, o = {}) {
  const w = o.w ?? 0.11, len = o.len ?? 0.2, c = o.color, seed = hashStr(G.id + ':flap' + s) % 53;
  const z0 = sk.zc + s * (sk.rTop + 0.008);
  const fn = (u, v) => [(u - 0.5) * w * (1 - 0.15 * v), sk.y1 - 0.02 - v * len - (v > 0.99 ? (o.ragged ?? 0.02) * noise3(u * 7 + seed, 1.3, 4.1) : 0), z0 + s * (0.004 + v * len * (o.slant ?? 0.3) + Math.sin(u * 9 + seed) * 0.006 * v)];
  const us = [0, 0.1, 0.12, 0.3, 0.5, 0.7, 0.88, 0.9, 1], vs = [0, 0.2, 0.4, 0.6, 0.8, 0.9, 0.92, 1];
  const h = cloth(H.geo(surfaceGeo(us, vs, fn, s < 0)), c);
  if (o.trim != null) h.shade((x, y, z, nx, ny, nz, i) => { const ci = i % us.length, ri = Math.floor(i / us.length); return ci < 2 || ci >= us.length - 2 || ri >= vs.length - 2 ? o.trim : null; });
  return h;
}

/** a crude hide wrap round the hips with a belt: returns the skirt record */
function hideKilt(G, c, o = {}) {
  const { k } = G, y = o.beltY ?? 0.04 * k;
  const sk = skirt(G, { mat: o.mat || ((x) => leather(x, c).bump(0.004, 22, 'noise')), len: o.len ?? 0.12, flare: o.flare ?? 0.035, top: 0.025, hem: o.hem });
  const b = belt(G, y, { h: o.beltH ?? 0.034, color: o.belt ?? DARK_LEATHER, buckle: o.buckle ?? false, buckleColor: 0x6a6a6e });
  G.add('torso', b.prims, b.hard);
  return sk;
}

/** bands wound round a limb node: wraps, bandages, rope. ys = heights along the bone */
const wraps = (r, ys, c, h = 0.014, raise = 0.004) => ys.map((y, i) => fin(S.cyl(r * 2.6, h, 0).rot(0, 0, i % 2 ? 7 : -7).at(0, y, 0), c, 0.85, 0, 0.14, 50).paint(0.003, raise));

/** scavenged pot helm for goblin heads: sits above the ears */
function potHelm(G, c, o = {}) {
  const hs = helmShell(G, 'pot', (h) => scrap(h, c, 3), { sx: 1.0, sy: o.sy ?? 0.94, sz: 1.04, y: o.y ?? 0.1, z: -0.04, tilt: o.tilt ?? 0 });
  const hard = [hs.hard];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.4; hard.push(hs.place(H.geo(domeGeo()).scale(0.05).rot(0, 0, -90).rot(0, -a / DEG, 0).at(Math.cos(a) * 1.08, 0.42, Math.sin(a) * 1.08).color(0x4a4a4e).pbr(0.5, 0.9)).lod(0)); }
  return { hard, place: hs.place };
}

// ---- Goblin grunt and slinger: sacking, rope, one piece of scavenged iron each ----
OUTFITS.rags = (G) => {
  const { T, k, P } = G, c = G.cloth, patch = tone(c, 0.04, 0.06, 0.12), slinger = G.o.weapon === 'sling', rope = 0xa8935c, ironC = 0x8a8782;
  const rm = (x) => cloth(x, c);
  const e = G.tp(0.15 * k);
  G.add('torso', [
    torsoLayer(G, rm, { raise: 0.004, y1: T - 0.07 * k }),
    cloth(S.box(0.06, T, 1, 0.004).rot(0, 0, -24).at(G.cw * 0.62, T - 0.08, 0), c).paint(0.004, 0.004),                  // hangs from one shoulder
    cloth(S.sphere(0.034).at(-G.cw * 0.4, 0.15 * k, e.front), patch).paint(0.004, 0.002),                             // patches
    cloth(S.sphere(0.03).at(G.cw * 0.3, 0.09 * k, -e.back), tone(c, -0.03, 0, -0.1)).paint(0.004, 0.002),
    fin(G.band(0.05 * k, 0.02), rope, 0.9, 0).paint(0.004, 0.006),
  ]);
  const f = G.field('torso'), kn = trace(f, [0.03, 0.05 * k, 0.5], [0, 0, -1]) || [0.03, 0.05 * k, e.front];
  G.add('torso', [], [
    fin(H.sphere(0.014, 8), rope, 0.9, 0).at(kn[0], kn[1], kn[2] + 0.006).lod(1),
    fin(H.tube([[kn[0], kn[1], kn[2] + 0.008], [kn[0] + 0.012, kn[1] - 0.04, kn[2] + 0.016], [kn[0] + 0.006, kn[1] - 0.08, kn[2] + 0.012]], 0.005, 8, 5), rope, 0.9, 0).lod(1),
    fin(H.tube([[kn[0], kn[1], kn[2] + 0.008], [kn[0] - 0.014, kn[1] - 0.03, kn[2] + 0.016], [kn[0] - 0.012, kn[1] - 0.06, kn[2] + 0.012]], 0.005, 8, 5), rope, 0.9, 0).lod(1),
    // crude stitches round the chest patch
    ...studs(G, 'torso', [0, 1, 2, 3, 4, 5].map((i) => [-G.cw * 0.4 + Math.cos(i * 1.05) * 0.036, 0.15 * k + Math.sin(i * 1.05) * 0.036, 0.5]), { field: f, dir: [0, 0, -1], r: 0.004, color: 0x2a2018, rough: 0.9, metal: 0 }),
  ]);
  const sk = skirt(G, { mat: rm, len: 0.1, flare: 0.035, top: 0.03, fold: 0.005 });
  if (sk) G.add('root', [], tatters(G, { n: 9, y: sk.y1 - sk.len + 0.012, len: 0.06, w: 0.05, colors: [c, tone(c, 0, 0, -0.08), patch], ring: hemRing(sk, -0.004) }));
  // scavenged iron: a pauldron strapped to the left shoulder, a greave on the right shin
  const pa = plateArm(G, ironC, { mat: rusty(ironC), pauldron: 1.05, lames: slinger ? 0 : 1, upper: false, couter: false, fore: false, rivet: 0x3a3a3e, trimMat: darkEdge });
  G.add('armL', [pa.arm, rustOn([P.rUpper * 0.36, 0, 0], P.rUpper * 1.7, 5, 1)], pa.armH);
  G.add('torso', [baldric(G, DARK_LEATHER, true, 0.022)]);
  G.add('foreR', bracer(G, LEATHER, { from: 0.3, to: 0.85 }).map((x) => x.mirrorX()));
  G.add('foreL', wraps(P.rFore, [-P.fore * 0.62, -P.fore * 0.74, -P.fore * 0.86], 0x9a8a68));
  const pl = plateLeg(G, ironC, { mat: rusty(ironC), tasset: false, cuisse: false, poleyn: false, sabaton: false, rivet: 0x3a3a3e });
  G.add('shinR', [...pl.shin, ...rustOn([0, -P.shin * 0.5, 0], P.shin * 0.5, 5, 2)].map((x) => x.mirrorX()));
  G.add('shinL', wraps(P.rCalf, [-P.shin * 0.5, -P.shin * 0.62, -P.shin * 0.74, -P.shin * 0.86], 0x9a8a68));
  if (slinger) {
    // slinger: a stitched leather cap and a bag of stones on the hip
    const hs = helmShell(G, 'cap', (h) => leather(h, 0x6a4a2c), { sx: 1.0, sy: 0.9, sz: 1.03, y: 0.06, z: -0.04 });
    G.add('head', [], [hs.hard, hs.place(leather(H.torus(1.06, 0.04, 24, 5), DARK_LEATHER).rot(90, 0, 0).rot(-6, 0, 0).at(0, 0.36, 0)).lod(1)]);
    const pch = pouch(G, 0.05 * k, -62, { size: 1.5, color: 0x6a4a2c });
    const px = -(G.tp(0.05 * k).side + 0.02);
    G.add('torso', pch.prims, [pch.hard, ...[0, 1, 2].map((i) => fin(H.sphere(0.014, 7), 0x8a8880, 0.9, 0).scale(1, 0.8, 0.9).at(px + (i - 1) * 0.012, 0.05 * k + 0.004 + (i % 2) * 0.006, 0.012 + (i - 1) * 0.014).lod(1))]);
  } else {
    // grunt: a dented pot for a helm, worn askew
    G.add('head', [], potHelm(G, ironC, { tilt: -7 }).hard);
  }
};

// ---- Goblin sapper: leather apron, satchel charges, a miner's cap with a candle ----
OUTFITS.sapper = (G) => {
  const { T, k, P, R } = G, c = G.cloth, apron = 0x5a3c22, ironC = 0x7c7c80;
  G.add('torso', [
    torsoLayer(G, (x) => cloth(x, c), { raise: 0.003 }),
    leather(S.box(G.cw * 1.5, T * 0.95, 0.5, 0.01).at(0, T * 0.36, 0.25), apron).paint(0.004, 0.007),                   // apron bib
    leather(S.box(0.022, T, 1, 0.003).rot(0, 0, 18).at(G.cw * 0.3, T * 0.72, 0), DARK_LEATHER).paint(0.003, 0.0085),     // neck straps
    leather(S.box(0.022, T, 1, 0.003).rot(0, 0, -18).at(-G.cw * 0.3, T * 0.72, 0), DARK_LEATHER).paint(0.003, 0.0085),
  ]);
  const y = 0.05 * k, b = belt(G, y, { h: 0.032, color: DARK_LEATHER, buckleColor: 0x8a8a8e });
  const bag = pouch(G, y, 70, { size: 1.7, color: 0x6a4a2c });
  G.add('torso', [b.prims, bag.prims], [b.hard, bag.hard]);
  // charges on the bandolier: iron balls with fuses, one lit
  const f = G.field('torso'), bombs = [];
  for (let i = 0; i < 3; i++) {
    const p0 = trace(f, [-G.cw * 0.55 + i * G.cw * 0.5, 0.2 * k - i * 0.035 * k, 0.5], [0, 0, -1]);
    if (!p0) continue;
    const q = [p0[0], p0[1], p0[2] + 0.016];
    bombs.push(iron(H.sphere(0.021, 10), 0x2e2e32).at(q[0], q[1], q[2]).lod(1));
    bombs.push(gold(H.cyl(0.006, 0.006, 0.008, 6), BRASS).at(q[0], q[1] + 0.022, q[2]).lod(1));
    bombs.push(fin(H.tube([[q[0], q[1] + 0.024, q[2]], [q[0] + 0.006, q[1] + 0.04, q[2] + 0.004], [q[0] + 0.016, q[1] + 0.048, q[2] + 0.002]], 0.0022, 6, 4), 0xc8b88a, 0.9, 0).lod(1));
    if (i === 2) bombs.push(H.sphere(0.006, 6).at(q[0] + 0.017, q[1] + 0.05, q[2] + 0.002).color(0xff7a1e).glow(1.8).lod(1));
  }
  G.add('torso', [leather(S.box(0.026, T * 2.2, 1, 0.003).rot(0, 0, 50).at(0, T * 0.52, 0), DARK_LEATHER).paint(0.004, 0.009)], bombs);
  skirt(G, { mat: (x) => cloth(x, tone(c, 0, -0.05, -0.1)), len: 0.11, flare: 0.035, top: 0.03, panel: { mat: (x) => leather(x, apron), w: 0.58, raise: 0.006 } });
  G.lr('arm', sleeve(G, (x) => cloth(x, c), { end: 0.6, grow: 1.02, hem: tone(c, 0, 0, -0.1) }));
  G.lr('fore', [...bracer(G, apron, { from: 0.35, to: 0.98, raise: 0.007 }), glove(G, (x) => leather(x, apron), 0.002)]);
  G.cores('arm', c);
  G.lr('shin', wraps(P.rCalf, [-P.shin * 0.3, -P.shin * 0.44, -P.shin * 0.58, -P.shin * 0.72, -P.shin * 0.86], 0x8a7a5a));
  // cap: iron pot with a leather band and a candle stuck on the brim
  const ph = potHelm(G, ironC, {});
  G.add('head', [], [
    ph.hard,
    ph.place(leather(H.torus(1.1, 0.05, 24, 5), DARK_LEATHER).rot(90, 0, 0).at(0, 0.4, 0)).lod(1),
    fin(H.cyl(R * 0.1, R * 0.12, R * 0.3, 8), 0xe8dfc0, 0.6, 0).at(0, R * 0.72, R * 0.98).lod(1),
    H.cone(R * 0.07, R * 0.22, 6).at(0, R * 0.98, R * 0.98).color(0xff8a1e).glow(1.8).lod(1),
    gold(H.cyl(R * 0.17, R * 0.17, R * 0.03, 8), BRASS).at(0, R * 0.57, R * 0.98).lod(1),
  ]);
};

// ---- Goblin shaman: ragged robe, fur mantle, bones and a crown of feathers ----
OUTFITS.shaman = (G) => {
  const { T, k, P, R } = G, c = G.cloth, furC = 0x5a4630, fc = [[0x4a3a2a, 0xc2452e, 0xe8a23a], [0x4a3a2a, 0x2f8a7a, 0xe8e2d0], [0x4a3a2a, 0xd8862a, 0xc2452e]];
  const sk = robe(G, c, { bell: 1.9, flare: 0.085, fold: 0.008, hem: { color: tone(c, 0, 0, -0.14), h: 0.02 }, panel: { mat: (x) => cloth(x, tone(c, 0.03, -0.05, -0.16)), w: 0.3, raise: -0.002 } });
  if (sk) G.add('root', [], tatters(G, { n: 11, y: sk.y1 - sk.len + 0.015, len: 0.045, w: 0.06, colors: [c, tone(c, 0, 0, -0.12)], ring: hemRing(sk, -0.006), flare: 0.3 }));
  G.add('torso', mantle(G, furM(furC, 0.009, 34), { drop: 0.06, reach: 0.03 }));
  // necklace of teeth and knucklebones
  const f = G.field('torso'), neck = [];
  for (let i = -4; i <= 4; i++) {
    const p0 = trace(f, [i * 0.02 * k, T - 0.075 * k - (16 - i * i) * 0.0014, 0.5], [0, 0, -1]);
    if (p0) neck.push(orient(bone(H.cone(0.006, i % 2 ? 0.026 : 0.036, 5)), [p0[0], p0[1] - 0.012, p0[2] + 0.006], [0, -1, 0.2]).lod(1));
  }
  const y = 0.055 * k, e = G.tp(y);
  G.add('torso', [fin(G.band(y, 0.02), 0xa8935c, 0.9, 0).paint(0.004, 0.005)], [
    neck,
    skull([e.side * 0.5, y - 0.04, e.front + 0.022], 0.02, 14, 6),
    boneRod([-e.side * 0.4, y - 0.01, e.front + 0.012], [-e.side * 0.55, y - 0.085, e.front + 0.016], 0.005),
    boneRod([-e.side * 0.7, y - 0.01, e.front * 0.8 + 0.012], [-e.side * 0.8, y - 0.07, e.front * 0.8 + 0.014], 0.004),
    feather([-e.side * 0.1, y - 0.01, e.front + 0.014], [0.1, -1, 0.2], 0.07, 0.022, [0, 0.2, 1], fc[0]).lod(1),
  ]);
  // headdress: a hide band, a fan of feathers, a small beast skull over the brow
  const hh = [leather(H.torus(1.0, 0.075, 24, 6), 0x5a3a22).rot(90, 0, 0).scale(R * 0.9, R, R * 0.91).rot(-8, 0, 0).at(0, R * 0.5, -R * 0.06).lod(1)];
  for (let i = -3; i <= 3; i++) {
    const a = i * 22 * DEG;
    hh.push(feather([Math.sin(a) * R * 0.7, R * 0.62, -R * 0.2 - Math.cos(a) * R * 0.3], [Math.sin(a) * 0.75, 1, -0.3], R * (1.5 - Math.abs(i) * 0.18), R * 0.34, [0, 0.2, 1], fc[(i + 3) % 3]).lod(Math.abs(i) % 2 ? 1 : 99));
  }
  hh.push(...skull([0, R * 0.74, R * 0.72], R * 0.26, 0, -20, 0xd8ceb0));
  G.add('head', [], hh);
  G.lr('fore', [fin(G.band(-P.fore * 0.55, 0.012, P.rFore * 4), 0xa8935c, 0.9, 0).paint(0.003, 0.003)]);
};

// ---- Wolf rider: hide jerkin, fur over the shoulders, a spiked pot helm ----
OUTFITS.raider = (G) => {
  const { T, k, P, R } = G, c = G.cloth, ironC = 0x86827c, furC = 0x6a6258;
  G.add('torso', [
    torsoLayer(G, (x) => leather(x, c), { raise: 0.004, y1: T - 0.03 }),
    leather(S.box(0.012, T * 0.8, 0.4, 0.002).at(0, T * 0.45, 0.2), DARK_LEATHER).paint(0.003, -0.002),
  ]);
  G.add('torso', mantle(G, furM(furC, 0.009, 34), { drop: 0.05, reach: 0.026 }));
  const b = belt(G, 0.05 * k, { h: 0.03, color: DARK_LEATHER, buckleColor: 0x7a7a7e });
  G.add('torso', b.prims, [b.hard, skull([-(G.tp(0.05 * k).side + 0.014), 0.02 * k, 0.01], 0.022, -80, 0)]);
  skirt(G, { mat: (x) => leather(x, tone(c, 0, 0, -0.06)), len: 0.11, flare: 0.035, top: 0.03 });
  const pa = plateArm(G, ironC, { mat: rusty(ironC), pauldron: 1.0, lames: 1, upper: false, couter: false, fore: false, rivet: 0x3a3a3e, trimMat: darkEdge });
  G.add('armR', [pa.arm, rustOn([P.rUpper * 0.36, 0, 0], P.rUpper * 1.7, 5, 3)].flat().map((x) => x.mirrorX()), pa.armH.map((x) => x.mirrorX()));
  G.lr('fore', bracer(G, DARK_LEATHER, { from: 0.25, to: 0.9 }));
  G.lr('shin', wraps(P.rCalf, [-P.shin * 0.35, -P.shin * 0.5, -P.shin * 0.65, -P.shin * 0.8], 0x6a5236));
  const ph = potHelm(G, ironC, { y: 0.12 });
  G.add('head', [], [
    ph.hard,
    orient(scrap(H.cone(R * 0.16, R * 0.5, 7), ironC, 5), [0, R * 1.42, -R * 0.04], [0, 1, 0]),
    plume(G, 0x9a2c22, { at: [0, R * 1.3, -R * 0.2], size: 0.62, n: 3 }),
  ]);
};

// ---- Hobgoblin brute / ogre: hides and crude iron ----
OUTFITS.hides = (G) => (G.P.species === 'ogre' ? ogreHides(G) : hobHides(G));

function hobHides(G) {
  const { T, k, P } = G, c = G.cloth, ironC = 0x7e7b78, furC = 0x3a3028;
  // crossed straps over a bare chest, an iron ring where they meet
  G.add('torso', [baldric(G, DARK_LEATHER, true, 0.03), baldric(G, DARK_LEATHER, false, 0.03)]);
  const f = G.field('torso'), cp = trace(f, [0, T * 0.5, 0.5], [0, 0, -1]) || [0, T * 0.5, G.cd];
  G.add('torso', mantle(G, furM(furC, 0.01, 32), { drop: 0.05, reach: 0.02 }), [
    iron(H.torus(0.028, 0.008, 16, 6), ironC).at(cp[0], cp[1], cp[2] + 0.008).lod(1),
  ]);
  const sk = hideKilt(G, c, { len: 0.15, flare: 0.04, beltH: 0.04, hem: { color: tone(furC, 0, 0, 0.1), h: 0.024 } });
  const e = G.tp(0.04 * k);
  G.add('torso', [], [
    scrap(H.box(0.07, 0.06, 0.012, 0.006), ironC, 2).at(0, 0.04 * k, e.front + 0.012).lod(1),
    ...[-1, 1].flatMap((s) => [-1, 1].map((t) => stud([s * 0.024, 0.04 * k + t * 0.018, e.front + 0.018], [0, 0, 1], 0.006, 0x3a3a3e))),
    skull([e.side + 0.016, 0.0, 0.0], 0.026, 80, 0),
  ]);
  if (sk) G.add('root', [], [flap(G, sk, 1, { color: tone(c, 0.02, 0.05, -0.08), len: 0.2, w: 0.1, trim: 0x8a2c2c })]);
  const pa = plateArm(G, ironC, { mat: rusty(ironC), pauldron: 1.15, lames: 1, upper: false, couter: false, fore: false, rivet: 0x2e2e32, trimMat: darkEdge });
  const r = P.rUpper;
  G.add('armL', [pa.arm, rustOn([r * 0.36, 0, 0], r * 1.9, 6, 4)], [pa.armH, ...[0, 1].map((i) => orient(scrap(H.cone(r * 0.34, r * 1.3, 6), ironC, i), [r * (0.5 + i * 0.7), r * (1.25 - i * 0.35), (i - 0.5) * r * 0.5], [0.4 + i * 0.5, 1, 0]))]);
  G.lr('fore', [rusty(ironC)(S.cyl(P.rFore * 2.4, P.fore * 0.5, 0).at(0, -P.fore * 0.52, 0)).paint(0.004, 0.008)], [0.32, 0.72].map((t) => stud([P.rFore * 1.25, -P.fore * t, 0], [1, 0, 0], 0.006, 0x2e2e32)));
  G.lr('shin', wraps(P.rCalf, [-P.shin * 0.3, -P.shin * 0.45, -P.shin * 0.6, -P.shin * 0.75], 0x4a3524, 0.02, 0.005));
  const pl = plateLeg(G, ironC, { mat: rusty(ironC), tasset: false, cuisse: false, greave: false, sabaton: false, rivet: 0x2e2e32 });
  G.add('legR', pl.leg.map((x) => x.mirrorX()), pl.legH.map((x) => x.mirrorX()));
}

function ogreHides(G) {
  const { T, k, P } = G, c = G.cloth, ironC = 0x86827e, furC = 0x4a3a2a, hide = tone(c, 0, 0, 0.02);
  // a pelt slung over the left shoulder
  const a = Math.atan2(G.sx * 1.6, T) / DEG;
  G.add('torso', [
    furM(furC, 0.009, 30)(S.box(0.17 * k, T * 2.4, 1, 0.01).rot(0, 0, -a).at(0.02, T * 0.5, 0)).paint(0.006, 0.008),
    furM(furC, 0.011, 30)(S.ellipsoid(0.085 * k, 0.05 * k, G.cd * 1.1).at(G.sx - 0.06, T - 0.01, -0.01)).blend(0.014),
  ]);
  // belly strap with a pot lid for a buckle
  const y = 0.105 * k, e = G.tp(y);
  G.add('torso', [leather(G.band(y, 0.06 * k, 0.6), DARK_LEATHER).paint(0.005, 0.008)], [
    scrap(H.lathe([[0.0001, 0.02], [0.012, 0.02], [0.016, 0.012], [0.03, 0.01], [0.064 * k, 0.004], [0.07 * k, 0], [0.064 * k, -0.004], [0.0001, -0.004]], 16), ironC, 1).rot(90, 0, 0).at(0, y, e.front + 0.014).lod(1),
    ...[0, 1, 2, 3, 4, 5].map((i) => stud([Math.cos(i * 1.047) * 0.052 * k, y + Math.sin(i * 1.047) * 0.052 * k, e.front + 0.02], [0, 0, 1], 0.006, 0x2e2e32)),
  ]);
  const sk = hideKilt(G, hide, { len: 0.16, flare: 0.04, beltY: 0.02 * k, beltH: 0.03, hem: { color: tone(furC, 0, 0, 0.08), h: 0.026 } });
  if (sk) G.add('root', [], [
    ...tatters(G, { n: 10, y: sk.y1 - sk.len + 0.014, len: 0.05, w: 0.08, colors: [hide, tone(hide, 0, 0, -0.1)], ring: hemRing(sk, -0.006), flare: 0.25 }),
    flap(G, sk, 1, { color: tone(c, 0.01, 0.04, -0.12), len: 0.2, w: 0.14 }),
  ]);
  // trophies: a ham bone and a knife-sized cleaver would be nice; bones on a thong do the job
  const f = G.field('torso'), bones = [];
  for (let i = -2; i <= 2; i++) { const p0 = trace(f, [i * 0.045 * k, T - 0.08 * k - (4 - i * i) * 0.006, 0.6], [0, 0, -1]); if (p0) bones.push(...boneRod([p0[0], p0[1], p0[2] + 0.01], [p0[0] + i * 0.004, p0[1] - 0.05, p0[2] + 0.014], 0.006)); }
  G.add('torso', [], bones);
  // crude shoulder plate on the right, hammered from a shield boss
  const pa = plateArm(G, ironC, { mat: rusty(ironC), pauldron: 1.12, lames: 1, upper: false, couter: false, fore: false, rivet: 0x2e2e32, trimMat: darkEdge });
  G.add('armR', [pa.arm, rustOn([P.rUpper * 0.36, 0, 0], P.rUpper * 1.9, 6, 5)].flat().map((x) => x.mirrorX()), pa.armH.map((x) => x.mirrorX()));
  G.add('torso', [leather(S.box(0.03, T * 2.4, 1, 0.003).rot(0, 0, a * 0.9).at(-0.02, T * 0.52, 0), DARK_LEATHER).paint(0.004, 0.006)]);
  G.lr('fore', wraps(P.rFore, [-P.fore * 0.5, -P.fore * 0.64, -P.fore * 0.78, -P.fore * 0.92], 0x5a4630, 0.022, 0.006));
  G.lr('shin', wraps(P.rCalf, [-P.shin * 0.45, -P.shin * 0.6, -P.shin * 0.75, -P.shin * 0.9], 0x5a4630, 0.022, 0.006));
}

// ---- Goblin warboss: spiked black iron, horned helm, a cloak hung with trophies ----
OUTFITS.warlord = (G) => {
  const { T, k, P, R } = G, red = G.cloth, ironC = tone(G.armor, 0, -0.02, 0.0), spikeC = 0x34343a, furC = 0x2e2620;
  const im = (x) => iron(x, ironC);
  G.add('torso', [torsoLayer(G, (x) => cloth(x, tone(red, 0, -0.1, -0.12)), { raise: 0.002 })]);
  const cu = cuirass(G, ironC, { mat: im, fauld: 2, grow: 0.014, trim: 0x8a2c2c, trimMat: (x) => fin(x, 0x3a3a3e, 0.5, 0.9) });
  G.add('torso', cu.prims, cu.hard);
  // rivets round the belly plate, spikes on the collar
  const f = G.field('torso'), pts = [];
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; pts.push([Math.sin(a) * 0.6, 0.17 * k, Math.cos(a) * 0.6]); }
  G.add('torso', [], [studs(G, 'torso', pts, { field: f, r: 0.0075, color: spikeC, rough: 0.5, metal: 0.9 }), skull([0, 0.045 * k, G.tp(0.04 * k).front + 0.034], 0.034, 0, 6)]);
  const b = belt(G, 0.045 * k, { h: 0.034, color: 0x2a1e16, buckle: false, raise: 0.004 });
  G.add('torso', b.prims);
  const sk = skirt(G, { mat: (x) => cloth(x, red), len: 0.17, flare: 0.045, top: 0.01, fold: 0.006, hem: { color: 0x3a3a3e, rough: 0.5, metal: 0.9, h: 0.016 } });
  if (sk) G.add('root', [], tatters(G, { n: 10, y: sk.y1 - sk.len + 0.014, len: 0.05, w: 0.07, colors: [red, tone(red, 0, 0, -0.1)], ring: hemRing(sk, -0.006), flare: 0.25 }));
  const r = P.rUpper;
  const pa = plateArm(G, ironC, { mat: im, pauldron: 1.36, lames: 1, rivet: spikeC });
  const spikes = [0, 1, 2].map((i) => orient(iron(H.cone(r * 0.32, r * (1.5 - i * 0.2), 6), spikeC), [r * (0.2 + i * 0.75), r * (1.72 - i * 0.42), (i - 1) * r * 0.3], [-0.1 + i * 0.5, 1, 0]));
  G.lr('arm', pa.arm, [pa.armH, spikes]);
  G.lr('fore', pa.fore, [pa.foreH, [0.3, 0.55].map((t) => orient(iron(H.cone(0.012, 0.045, 6), spikeC), [P.rFore * 1.2, -P.fore * t, 0], [1, 0.2, 0]).lod(1))]);
  const pl = plateLeg(G, ironC, { mat: im, sabaton: false, rivet: spikeC });
  G.lr('leg', pl.leg, pl.legH); G.lr('shin', pl.shin, [pl.shinH, orient(iron(H.cone(0.014, 0.05, 6), spikeC), [0, -P.shin * 0.04, P.rCalf * 1.3], [0, 0.5, 1]).lod(1)]);
  for (const n of ['arm', 'fore', 'leg', 'shin']) G.cores(n, ironC);
  // trophy cloak: a fur collar, a ragged red cape, skulls at the shoulders
  G.add('torso', mantle(G, furM(furC, 0.011, 30), { drop: 0.04, reach: 0.0 }), [-1, 1].flatMap((s) => skull([s * (G.sx - 0.07), T + 0.018, -G.cd * 1.5], 0.03, s * 150, -10)));
  cape(G, { color: red, len: 0.62, slope: 0.28, ragged: 0.08, foldAmp: 0.04, width: G.sx * 2.5, trim: 0x2a1e16 });
  // helm: an iron pot with a brow plate, cheek guards and a pair of great horns
  const hs = helmShell(G, 'pot', (h) => iron(h, ironC), { sx: 1.0, sy: 1.02, sz: 1.06, y: 0.14, z: -0.05 });
  const hh = [hs.hard, hs.place(iron(H.box(0.22, 0.66, 0.09, 0.03), ironC).rot(-14, 0, 0).at(0, 0.1, 1.1)).lod(1), hs.place(iron(H.box(0.5, 0.14, 0.1, 0.03), ironC).rot(-6, 0, 0).at(0, 0.36, 1.13)).lod(1), hs.place(iron(H.torus(1.11, 0.06, 26, 6), spikeC).rot(90, 0, 0).at(0, 0.36, 0)).lod(1)];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.39; hh.push(hs.place(H.geo(domeGeo()).scale(0.07).rot(0, 0, -90).rot(0, -a / DEG, 0).at(Math.cos(a) * 1.13, 0.37, Math.sin(a) * 1.13).color(0x8a8a8e).pbr(0.4, 1)).lod(0)); }
  for (const s of [-1, 1]) {
    const hp = [[s * 0.96, 0.62, -0.1], [s * 1.5, 0.74, -0.14], [s * 1.9, 1.2, 0.0], [s * 1.88, 1.8, 0.3]].map((q) => mul3(q, R));
    const shadeHorn = (x, y) => (y > R * 1.5 ? 0x3a3026 : null);
    hh.push(bone(H.tube(hp, [R * 0.22, R * 0.19, R * 0.12, R * 0.015], 14, 8), 0xd8cba6).shade(shadeHorn).near());
    hh.push(bone(H.tube(hp, [R * 0.22, R * 0.19, R * 0.12, R * 0.015], 4, 5), 0xd8cba6).far());
    hh.push(iron(H.torus(R * 0.23, R * 0.05, 12, 5), spikeC).rot(0, 0, 90).at(s * R * 1.04, R * 0.63, -R * 0.1).lod(1));
  }
  G.add('head', [], hh);
};

// ---- Ghoul: the shreds of a shroud ----
OUTFITS.tatters = (G) => {
  const { T, k, P } = G, c = G.cloth, c2 = tone(c, 0.02, 0, 0.08), linen = 0x8a8468;
  G.add('torso', [
    torsoLayer(G, (x) => cloth(x, c), { raise: 0.003, y1: 0.11 * k }),
    cloth(S.box(0.085, T * 2, 1, 0.006).rot(0, 0, 30).at(-0.01, T * 0.55, 0), c).paint(0.006, 0.003),                    // what is left of the shroud, over one shoulder
    cloth(S.sphere(0.045).at(G.cw * 0.5, 0.2 * k, 0.0), c2).paint(0.012, 0.002),
    fin(G.band(0.045 * k, 0.016), 0x6a5a3a, 0.9, 0).paint(0.004, 0.005),
  ]);
  G.add('torso', [], tatters(G, { n: 8, y: 0.115 * k, len: 0.05, w: 0.05, colors: [c, c2], ring: waistRing(G, 0.115 * k, 0.004), flare: 0.1, seed: 'chest', lean: P.hunch }));
  const sk = skirt(G, { mat: (x) => cloth(x, c), len: 0.09, flare: 0.03, top: 0.03, fold: 0.006 });
  if (sk) G.add('root', [], [
    ...tatters(G, { n: 12, y: sk.y1 - sk.len + 0.02, len: 0.1, w: 0.05, colors: [c, c2, tone(c, 0, 0, -0.06)], ring: hemRing(sk, -0.006), flare: 0.18 }),
    flap(G, sk, 1, { color: c2, len: 0.2, w: 0.08, ragged: 0.06 }), flap(G, sk, -1, { color: c, len: 0.24, w: 0.1, ragged: 0.07 }),
  ]);
  // a broken manacle on the right wrist, grave wrappings on the left arm and right shin
  const rw = P.rWrist, F = P.fore, links = [];
  for (let i = 0; i < 4; i++) links.push(iron(H.torus(0.012, 0.0036, 10, 5), 0x4a4a4e).rot(i % 2 ? 90 : 0, i * 30, 20).at(rw * 1.3 + 0.004, -F * 0.86 - 0.012 - i * 0.017, (i % 2) * 0.004).lod(1));
  G.add('foreR', [iron(S.cyl(rw * 2.6, 0.028, 0).at(0, -F * 0.86, 0), 0x4a4a4e).paint(0.003, 0.007)].map((x) => x.mirrorX()), links.map((x) => x.mirrorX()));
  G.add('foreL', wraps(P.rFore, [-F * 0.25, -F * 0.37, -F * 0.49, -F * 0.61, -F * 0.73], linen, 0.016, 0.004));
  G.add('armL', wraps(P.rUpper, [-P.upper * 0.7, -P.upper * 0.84], linen, 0.016, 0.004));
  G.add('shinR', wraps(P.rCalf, [-P.shin * 0.3, -P.shin * 0.42, -P.shin * 0.54, -P.shin * 0.66], linen, 0.016, 0.004).map((x) => x.mirrorX()));
};

// ---- Giants and fiends: a wrap round the hips, belts, bracers, trophies ----
OUTFITS.loincloth = (G) => {
  (LOIN[G.o.cyclops ? 'cyclops' : G.P.species] || LOIN.troll)(G);
};
const LOIN = {
  troll(G) {
    const { T, k, P } = G, c = G.cloth, rope = 0x8a7a4e;
    const sk = hideKilt(G, c, { len: 0.11, flare: 0.03, beltH: 0.03, belt: rope });
    G.add('torso', [fin(G.band(0.04 * k + 0.008, 0.008), tone(rope, 0, 0, -0.14), 0.9, 0).paint(0.002, -0.002)]);
    const e = G.tp(0.04 * k);
    if (sk) G.add('root', [], [
      ...tatters(G, { n: 9, y: sk.y1 - sk.len + 0.014, len: 0.06, w: 0.07, colors: [c, tone(c, 0, 0, -0.1), tone(c, 0.02, 0, 0.06)], ring: hemRing(sk, -0.006), flare: 0.22 }),
      flap(G, sk, 1, { color: tone(c, 0.01, 0, -0.08), len: 0.22, w: 0.12, ragged: 0.05 }), flap(G, sk, -1, { color: tone(c, 0, 0, -0.04), len: 0.2, w: 0.14, ragged: 0.05 }),
    ]);
    // trophies on the rope: two skulls and a thigh bone; a string of teeth round the neck
    const f = G.field('torso'), teeth = [];
    for (let i = -4; i <= 4; i++) { const p0 = trace(f, [i * 0.022 * k, T - 0.07 * k - (16 - i * i) * 0.0016, 0.6], [0, 0, -1]); if (p0) teeth.push(orient(bone(H.cone(0.007, 0.03 + (i % 2) * 0.012, 5)), [p0[0], p0[1] - 0.012, p0[2] + 0.007], [0, -1, 0.25]).lod(1)); }
    G.add('torso', [], [
      skull([e.side * 0.75, 0.04 * k - 0.045, e.front * 0.75 + 0.03], 0.027, 40, 4), skull([-(e.side + 0.018), 0.04 * k - 0.05, 0.0], 0.024, -85, 0, 0xcfc59e),
      boneRod([-e.side * 0.5, 0.04 * k - 0.01, e.front + 0.014], [-e.side * 0.72, 0.04 * k - 0.12, e.front * 0.9 + 0.02], 0.008), teeth,
    ]);
    // bark-leather bracers studded with knucklebones
    G.lr('fore', bracer(G, 0x4a3a28, { from: 0.3, to: 0.85, raise: 0.008 }), [0.4, 0.58, 0.76].map((t) => bone(H.sphere(0.009, 6)).at(P.rFore * 1.2, -P.fore * t, 0).lod(1)));
    G.lr('shin', wraps(P.rCalf, [-P.shin * 0.7, -P.shin * 0.82], rope, 0.014, 0.005));
  },
  cyclops(G) {
    const { T, k, P } = G, c = G.cloth, furC = 0x7a6248, bronze = 0xb07a3a;
    const bz = (x) => fin(x, bronze, 0.38, 1, 0.08, 20);
    // a pelt over the right shoulder, pinned with a bronze disc
    const a = Math.atan2(G.sx * 1.5, T) / DEG;
    G.add('torso', [
      furM(furC, 0.009, 30)(S.box(0.15 * k, T * 2.4, 1, 0.01).rot(0, 0, a).at(-0.02, T * 0.5, 0)).paint(0.006, 0.008),
      furM(furC, 0.011, 30)(S.ellipsoid(0.08 * k, 0.045 * k, G.cd * 1.05).at(-(G.sx - 0.06), T - 0.012, -0.01)).blend(0.014),
    ]);
    const f = G.field('torso'), pin = trace(f, [-G.cw * 0.52, T - 0.085 * k, 0.6], [0, 0, -1]);
    const sk = hideKilt(G, c, { len: 0.15, flare: 0.04, beltH: 0.042, belt: 0x4a3020, hem: { color: tone(furC, 0, 0, 0.08), h: 0.024 } });
    const e = G.tp(0.04 * k);
    G.add('torso', [], [
      pin && bz(H.cyl(0.03 * k, 0.03 * k, 0.008, 14)).rot(90, 0, 0).at(pin[0], pin[1], pin[2] + 0.008).lod(1),
      pin && bz(H.sphere(0.012 * k, 8)).at(pin[0], pin[1], pin[2] + 0.014).lod(1),
      bz(H.cyl(0.044 * k, 0.044 * k, 0.01, 16)).rot(90, 0, 0).at(0, 0.04 * k, e.front + 0.014).lod(1),
      bz(H.torus(0.03 * k, 0.006, 14, 5)).at(0, 0.04 * k, e.front + 0.02).lod(1),
    ]);
    if (sk) G.add('root', [], [flap(G, sk, 1, { color: tone(c, 0.01, 0.04, -0.1), len: 0.2, w: 0.12, trim: bronze })]);
    G.lr('fore', [bz(S.cyl(P.rFore * 2.4, P.fore * 0.46, 0).at(0, -P.fore * 0.56, 0)).paint(0.004, 0.008), bz(G.band(-P.fore * 0.34, 0.012, P.rFore * 3)).paint(0.003, 0.011), bz(G.band(-P.fore * 0.78, 0.012, P.rFore * 3)).paint(0.003, 0.011)]);
    G.lr('shin', [leather(G.band(-P.shin * 0.82, 0.016, P.rCalf * 3), 0x4a3020).paint(0.003, 0.005), leather(G.band(-P.shin * 0.94, 0.016, P.rCalf * 3), 0x4a3020).paint(0.003, 0.005)]);
  },
  minotaur(G) {
    const { k, P } = G, c = G.cloth, bronze = 0xb8823a, red = 0x7a2a22;
    const bz = (x) => fin(x, bronze, 0.36, 1, 0.08, 20);
    const y = 0.045 * k, e = G.tp(y);
    const sk = skirt(G, { mat: (x) => leather(x, tone(c, 0, 0, -0.04)), len: 0.1, flare: 0.03, top: 0.03 });
    G.add('torso', [bz(G.band(y, 0.05)).paint(0.004, 0.008), bz(G.band(y + 0.03, 0.008)).paint(0.003, 0.011), bz(G.band(y - 0.03, 0.008)).paint(0.003, 0.011)], [
      bz(H.torus(0.026 * k, 0.007, 14, 6)).at(0, y, e.front + 0.016).lod(1),
      ...[-3, -2, -1, 1, 2, 3].map((i) => stud([Math.sin(i * 0.3) * (e.side + 0.008), y, e.zc + Math.cos(i * 0.3) * (e.depth + 0.011)], [Math.sin(i * 0.3), 0, Math.cos(i * 0.3)], 0.006, 0x8a5a2a)),
    ]);
    // pteruges: a skirt of leather straps, each tipped with bronze
    if (sk) {
      const straps = [], ring = hemRing({ ...sk, rHem: sk.rTop + 0.004 }, 0), n = 14;
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * Math.PI * 2, q = ring(a), len = 0.17 + (i % 2) * 0.02, w = 0.05;
        const us = [0, 1], vs = [0, 0.5, 0.86, 0.88, 1];
        const g = surfaceGeo(us, vs, (u, v) => [(u - 0.5) * w * (1 - (v > 0.9 ? 0.5 : 0)), -v * len, v * len * 0.22]);
        straps.push(leather(H.geo(g), i % 2 ? red : tone(c, 0.01, 0.05, 0.04)).shade((x, yy, z, nx, ny, nz, vi) => (vi >= 6 ? bronze : null)).rot(0, a / DEG, 0).at(q[0], sk.y1 - 0.03, q[1]));
      }
      G.add('root', [], straps);
    }
    // harness and a bronze shoulder
    G.add('torso', [baldric(G, 0x4a2c1c, false, 0.034)]);
    const pa = plateArm(G, bronze, { mat: bz, pauldron: 1.1, lames: 1, upper: false, couter: false, fore: false, rivet: 0x6a4a22 });
    G.add('armL', pa.arm, pa.armH);
    G.lr('fore', [bz(S.cyl(P.rFore * 2.4, P.fore * 0.5, 0).at(0, -P.fore * 0.55, 0)).paint(0.004, 0.008), bz(G.band(-P.fore * 0.32, 0.012, P.rFore * 3)).paint(0.003, 0.011), bz(G.band(-P.fore * 0.78, 0.012, P.rFore * 3)).paint(0.003, 0.011)]);
    G.lr('shin', [bz(G.band(-P.shin * 0.76, 0.02, P.rCalf * 3)).paint(0.003, 0.012)]);
    },
  demon(G) {
    const { k, P } = G, c = G.cloth, ironC = 0x2a2a2e, ember = 0xff5a14;
    const im = (x) => iron(x, ironC);
    const y = 0.04 * k, e = G.tp(y);
    const sk = skirt(G, { mat: (x) => cloth(x, c), len: 0.1, flare: 0.03, top: 0.03, fold: 0.006 });
    // a belt of chain with a horned skull for a buckle
    const links = [], n = 22;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; links.push(iron(H.torus(0.017, 0.005, 10, 5), i % 2 ? ironC : 0x3a3a40).rot(i % 2 ? 90 : 0, 0, 0).rot(0, a / DEG + 90, 0).at(Math.sin(a) * (e.side + 0.012), y + Math.sin(a * 3) * 0.004, e.zc + Math.cos(a) * (e.depth + 0.012)).lod(1)); }
    G.add('torso', [im(G.band(y, 0.022)).paint(0.004, 0.004)], [links, skull([0, y - 0.006, e.front + 0.034], 0.034, 0, 8, 0xd8ceb0),
      ...[-1, 1].map((s) => orient(bone(H.cone(0.01, 0.05, 6), 0x2a2020), [s * 0.026, y + 0.022, e.front + 0.03], [s * 0.6, 1, 0.1]).lod(1))]);
    if (sk) G.add('root', [], [
      ...tatters(G, { n: 12, y: sk.y1 - sk.len + 0.02, len: 0.11, w: 0.06, colors: [c, tone(c, 0, 0.1, 0.05), 0x3a1410], ring: hemRing(sk, -0.006), flare: 0.2 }),
      flap(G, sk, 1, { color: 0x4a1410, len: 0.26, w: 0.11, ragged: 0.06, trim: 0x1a1010 }), flap(G, sk, -1, { color: 0x3a1010, len: 0.22, w: 0.12, ragged: 0.06 }),
    ]);
    // shackles: spiked iron on wrists and ankles, a few links of broken chain
    const shack = (r, yy) => [im(S.cyl(r * 2.6, 0.045, 0).at(0, yy, 0)).paint(0.003, 0.009), fin(S.cyl(r * 3, 0.008, 0).at(0, yy, 0), ember, 0.5, 0).glow(1.4).paint(0.003, -0.002)];
    const spk = (r, yy) => [0, 1, 2, 3].map((i) => orient(iron(H.cone(0.011, 0.04, 5), ironC), [Math.cos(i * 1.57 + 0.4) * r * 1.2, yy, Math.sin(i * 1.57 + 0.4) * r * 1.2], [Math.cos(i * 1.57 + 0.4), 0.2, Math.sin(i * 1.57 + 0.4)]).lod(1));
    G.lr('fore', shack(P.rFore * 0.86, -P.fore * 0.72), spk(P.rFore * 0.86, -P.fore * 0.72));
    G.lr('shin', shack(P.rAnkle * 1.2, -P.shin * 0.84), spk(P.rAnkle * 1.2, -P.shin * 0.84));
    },
};

// ---- Infernal lord: black iron plate, its seams lit from within ----
OUTFITS.infernalPlate = (G) => {
  const { T, k, P } = G, c = tone(G.armor, 0, 0, -0.03), ember = 0xff5a14, spikeC = 0x16161a;
  const im = (x) => fin(x, c, 0.5, 0.9, 0.22, 18);
  const seam = (x) => fin(x, ember, 0.6, 0).glow(1.7);
  const cu = cuirass(G, c, { mat: im, fauld: 3, grow: 0.014, trimMat: seam, seams: true });
  G.add('torso', cu.prims, cu.hard);
  // burning seams: down the breastbone and under the breast, a brand on the chest
  const ch = G.tp(G.chestY);
  G.add('torso', [
    seam(S.box(0.009, T * 0.5, 0.5, 0.002).at(0, G.chestY - 0.01, 0.25)).paint(0.003, -0.003),
    ...[-1, 1].map((s) => seam(S.box(0.009, T * 0.4, 0.5, 0.002).rot(0, 0, s * 62).at(s * ch.side * 0.48, G.chestY - 0.07 * k, 0.25)).paint(0.003, -0.003)),
    seam(S.box(0.009, T * 0.6, 0.5, 0.002).at(0, T * 0.4, -0.25)).paint(0.003, -0.003),
  ]);
  const f = G.field('torso');
  G.add('torso', [], [decal(G, 'torso', 'flame', { field: f, at: [0, G.chestY + 0.012, 0], size: 0.04 * k, color: ember, lift: 0.003 }).glow(1.6)]);
  const sk = skirt(G, { mat: (x) => cloth(x, 0x3a100c), len: 0.13, flare: 0.035, top: 0.0, fold: 0.006, grow: 0.004 });
  if (sk) G.add('root', [], [
    ...tatters(G, { n: 12, y: sk.y1 - sk.len + 0.02, len: 0.1, w: 0.06, colors: [0x3a100c, 0x5a1810, 0x1a0a0a], ring: hemRing(sk, -0.006), flare: 0.2 }),
    flap(G, sk, 1, { color: 0x5a1810, len: 0.3, w: 0.12, ragged: 0.06, trim: 0x16161a }), flap(G, sk, -1, { color: 0x3a100c, len: 0.26, w: 0.13, ragged: 0.06 }),
  ]);
  const r = P.rUpper;
  const pa = plateArm(G, c, { mat: im, pauldron: 1.3, lames: 2, trimMat: seam, rivet: spikeC, hand: false });
  const spikes = [0, 1, 2].map((i) => orient(iron(H.cone(r * 0.3, r * (1.7 - i * 0.25), 6), spikeC), [r * (0.1 + i * 0.75), r * (1.66 - i * 0.42), -r * 0.2 + (i - 1) * r * 0.3], [-0.15 + i * 0.5, 1, -0.1]));
  G.lr('arm', pa.arm, [pa.armH, spikes]);
  G.lr('fore', pa.fore, pa.foreH);
  const pl = plateLeg(G, c, { mat: im, sabaton: false, trimMat: seam, rivet: spikeC });
  G.lr('leg', pl.leg, pl.legH); G.lr('shin', pl.shin, pl.shinH);
  for (const n of ['arm', 'fore', 'leg', 'shin']) G.cores(n, c);
};

// ---- Harpy: she has her plumage; a little stolen gold ----
OUTFITS.feathers = (G) => {
  const { T, P } = G, g = GOLD, gem = 0x3aa7c9;
  G.add('torso', [gold(S.torus(P.rNeck * 1.2, 0.009).at(0, T + 0.022, -0.002), g).blend(0.003)], [
    H.sphere(0.012, 10).scale(1, 1.2, 0.7).at(0, T + 0.012, P.rNeck * 1.2 + 0.004).color(gem).pbr(0.15, 0.2).glow(0.25).lod(1),
    gold(H.torus(0.013, 0.003, 12, 5), g).at(0, T + 0.012, P.rNeck * 1.2 + 0.004).lod(1),
  ]);
  G.lr('arm', [gold(G.band(-P.upper * 0.5, 0.016, P.rUpper * 3), g).paint(0.003, 0.004), gold(G.band(-P.upper * 0.62, 0.008, P.rUpper * 3), g).paint(0.003, 0.004)]);
  G.lr('fore', [gold(G.band(-P.fore * 0.84, 0.014, P.rFore * 3), g).paint(0.003, 0.004)]);
  G.add('shinL', [gold(G.band(-P.shin * 0.55, 0.014, P.rCalf * 3), g).paint(0.003, 0.004)]);
};

//@@WARDROBE@@
// =====================================================================================
//  Wardrobe: outfits picked by `outfit` alone. Each reads cloth (main colour), cloth2 (second colour), armor (metal),
//  trim (ornament) and brings its own headgear unless the descriptor says bare: true. Everything is sized from the
//  proportions and from the body's own distance field, so they fit any two-legged species.
// =====================================================================================
const BRONZE = 0xb8823a, COPPER = 0xb86a3a, TURQ = 0x2fb6a8, LAPIS = 0x2a4a9a, WOOD = 0x6a4a2a, PARCH = 0xe2d6b0, ROPE = 0xa8935c;
const silk = (x, c) => fin(x, c, 0.5, 0.08, 0.06, 30);
const wood = (x, c = WOOD) => fin(x, c, 0.8, 0, 0.2, 30);
const dkSteel = (c) => (x) => fin(x, c, 0.42, 0.9, 0.16, 20);
const gem = (h, c, glow = 0.3) => h.color(c).pbr(0.12, 0.25).glow(glow);
/** a painted slab: recolours (and lifts) whatever it crosses in a node */
const pbox = (mat, w, h, at, raise = 0.003, d = 1, soft = 0.004) => mat(S.box(w, h, d, 0.002).at(at[0], at[1], at[2])).paint(soft, raise);

/** seats hat pieces modelled round a unit skull (radius 1, brow line near y = 0.4, face toward +Z) on the head */
function hatPlace(G, o = {}) {
  const R = G.R;
  return (h) => h.scale(R * (o.sx ?? 0.97), R * (o.sy ?? 1) * (o.fit === false ? 1 : G.Lk), R * (o.sz ?? 1.08)).rot(o.tilt ?? 0, o.yaw ?? 0, o.roll ?? 0).at(R * (o.x ?? 0), R * (o.y ?? 0.08), R * (o.z ?? -0.06));
}
/** a lathed hat (profile [[r, y], ...] from the crown down, unit-skull space): detailed piece and a lean far twin */
function latheHat(G, key, prof, mat, o = {}) {
  const place = o.place || hatPlace(G, o);
  const geo = (seg) => cached(`lathe:${key}:${seg}`, () => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg));
  return { place, hard: [place(mat(H.geo(geo(o.seg ?? 26)))).near(), place(mat(H.geo(geo(8)))).far()] };
}
/** a brim that is not round: fn(a, t) -> [radius, y] for bearing a (0 = front) and t = 0 (crown) .. 1 (edge), unit-skull space */
function brimGeo(key, fn, seg = 36, rings = 4) {
  return cached(`brim:${key}:${seg}`, () => surfaceGeo(seg, rings, (u, v) => { const a = u * Math.PI * 2 + Math.PI, q = fn(a, v); return [Math.sin(a) * q[0], q[1], Math.cos(a) * q[0]]; }, false, true));
}
function brim(G, key, fn, mat, place, shade) {
  const near = mat(H.geo(brimGeo(key, fn, 36, 4)));
  if (shade) near.shade(shade);
  return [place(near).near(), place(mat(H.geo(brimGeo(key, fn, 9, 1)))).far()];
}
/** a flat fan or arch standing in the XY plane, hub at the origin: fn(a, u) -> radius at bearing a (radians, 0 = +X). rs are the rings of
 *  vertices (0..1 of the radius), so it can be shaded in bands: vertex i is column i % (nu + 1) round the arc, row floor(i / (nu + 1)) outward */
function fanGeo(a0, a1, nu, rs, fn) { return surfaceGeo(nu, rs, (u, v) => { const a = lerp(a0, a1, u), r = fn(a, u) * v; return [Math.cos(a) * r, Math.sin(a) * r, 0]; }); }
const slabGeo = () => cached('slab', () => new THREE.BoxGeometry(1, 1, 1));
/** a pair of horns: pts for the left one in head radii, mirrored for the right */
function hornPair(G, pts, radii, o = {}) {
  const R = G.R, out = [], c = o.color ?? 0xd8cba6, m = o.mat || bone;
  for (const s of [-1, 1]) {
    const hp = pts.map((q) => [s * q[0] * R, q[1] * R, q[2] * R]), rr = radii.map((x) => x * R);
    const near = m(H.tube(hp, rr, o.seg ?? 14, 8), c);
    if (o.tip != null) near.shade((x, y, z, nx, ny, nz, i) => (i >= ((o.seg ?? 14) + 1) * 9 * 0.62 ? o.tip : null));
    out.push(near.near(), m(H.tube(hp, rr, 4, 5), c).far());
    if (o.ring != null) out.push(iron(H.torus(rr[0] * 1.06, rr[0] * 0.24, 12, 5), o.ring).rot(0, 90, 0).at(hp[0][0], hp[0][1], hp[0][2]).lod(1));
  }
  return out;
}
/** points of a chain or cord sagging between a and b */
function sag(a, b, drop, n = 6) { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, q = add3(a, mul3(sub3(b, a), t)); out.push([q[0], q[1] - drop * 4 * t * (1 - t), q[2]]); } return out; }
/** a chain as a tube whose rings alternate dark and bright, so it reads as links */
function chain(pts, r = 0.005, c = 0x4a4a50, o = {}) {
  const n = o.n ?? Math.max(8, pts.length * 4), rad = 5, c2 = tone(c, 0, 0, 0.14);
  return fin(H.tube(pts, r, n, rad), c, o.rough ?? 0.5, o.metal ?? 0.8).shade((x, y, z, nx, ny, nz, i) => (Math.floor(i / (rad + 1)) % 2 ? c2 : null)).lod(o.lod ?? 1);
}
/** a strip of cloth hanging from `at`, turned `yaw` degrees round the vertical: sash ends, scrolls, weed, veils */
function hang(at, w, len, c, o = {}) {
  const sway = o.sway ?? 0, taper = o.taper ?? 0.5, nv = o.nv ?? 4;
  const g = surfaceGeo(2, nv, (u, v) => [(u - 0.5) * w * (1 - v * taper), -v * len, Math.sin(v * 2.6 + sway) * len * (o.wave ?? 0.1) + v * len * (o.out ?? 0.12)]);
  const h = (o.mat || cloth)(H.geo(g), c);
  if (o.shade) h.shade(o.shade);
  return h.rot(o.pitch ?? 0, o.yaw ?? 0, 0).at(at[0], at[1], at[2]).lod(o.lod ?? 1);
}
/** rope round the waist with a knot and two hanging ends */
function ropeBelt(G, y, c = ROPE, o = {}) {
  const f = G.field('torso'), e = G.tp(y), kx = o.kx ?? 0.03, kn = trace(f, [kx, y, 0.6], [0, 0, -1]) || [kx, y, e.front];
  const rp = (h) => fin(h, c, 0.9, 0, 0.1, 60), L = o.len ?? 0.09;
  return {
    prims: [fin(G.band(y, o.h ?? 0.02, 0.6), c, 0.9, 0, 0.12, 70).paint(0.004, 0.006), fin(G.band(y, 0.004, 0.6), tone(c, 0, 0, -0.14), 0.9, 0).paint(0.002, 0.004)],
    hard: [
      rp(H.sphere(0.014, 8)).at(kn[0], kn[1], kn[2] + 0.006).lod(1),
      rp(H.tube([[kn[0], kn[1], kn[2] + 0.008], [kn[0] + 0.012, kn[1] - L * 0.45, kn[2] + 0.016], [kn[0] + 0.006, kn[1] - L, kn[2] + 0.012]], 0.005, 8, 5)).lod(1),
      rp(H.tube([[kn[0], kn[1], kn[2] + 0.008], [kn[0] - 0.014, kn[1] - L * 0.35, kn[2] + 0.016], [kn[0] - 0.012, kn[1] - L * 0.75, kn[2] + 0.012]], 0.005, 8, 5)).lod(1),
      rp(H.sphere(0.008, 6)).at(kn[0] + 0.006, kn[1] - L, kn[2] + 0.012).lod(1), rp(H.sphere(0.008, 6)).at(kn[0] - 0.012, kn[1] - L * 0.75, kn[2] + 0.012).lod(1),
    ],
  };
}
/** a stitched patch on the torso where the ray from `from` along `dir` meets it */
function patchOn(G, f, from, dir, r, c) {
  const p = trace(f, from, dir, 1.5);
  if (!p) return { prims: [], hard: [] };
  const ax = Math.abs(dir[2]) > 0.5 ? [1, 0, 0] : [0, 0, 1], pts = [];
  for (let i = 0; i < 7; i++) { const a = i * 0.9; pts.push(add3(add3(sub3(p, mul3(dir, 0.3)), mul3(ax, Math.cos(a) * r * 1.05)), [0, Math.sin(a) * r * 1.05, 0])); }
  return { prims: [cloth(S.sphere(r * 1.25).at(p[0], p[1], p[2]), c).paint(0.004, 0.002)], hard: studs(G, 'torso', pts, { field: f, dir, r: 0.004, color: 0x2a2018, rough: 0.9, metal: 0 }) };
}
/** a broad sash wound round the waist, knotted at `deg` with two ends hanging */
function sash(G, y, c, o = {}) {
  const h = o.h ?? 0.055, e = G.tp(y), a = (o.deg ?? 40) * DEG, m = o.mat || cloth;
  const x = Math.sin(a) * (e.side + 0.014), z = e.zc + Math.cos(a) * (e.depth + 0.016), L = o.len ?? 0.16;
  const prims = [m(G.band(y, h, 0.7), c).paint(0.004, o.raise ?? 0.008), m(G.band(y + h * 0.18, 0.005, 0.7), tone(c, 0, 0, -0.1)).paint(0.002, (o.raise ?? 0.008) - 0.002), m(G.band(y - h * 0.2, 0.005, 0.7), tone(c, 0, 0, -0.1)).paint(0.002, (o.raise ?? 0.008) - 0.002)];
  const hard = o.ends === false ? [] : [
    m(H.sphere(h * 0.36, 8), tone(c, 0, 0, -0.05)).scale(1, 0.8, 0.8).at(x, y, z).lod(1),
    hang([x, y - 0.004, z], h * 0.8, L, c, { yaw: a / DEG, sway: 1, taper: -0.3, mat: m, shade: o.fringe != null ? (px, py) => (py < -L * 0.86 ? o.fringe : null) : null, lod: 99 }),
    hang([x + 0.012 * Math.cos(a), y - 0.004, z - 0.012 * Math.sin(a)], h * 0.7, L * 0.78, tone(c, 0, 0, -0.07), { yaw: a / DEG + 14, sway: 3, taper: -0.2, mat: m, shade: o.fringe != null ? (px, py) => (py < -L * 0.66 ? o.fringe : null) : null }),
  ];
  return { prims, hard };
}
/** bare feet: the body's painted shoe goes back to skin */
function barefoot(G) { const { P } = G; G.lr('shin', [fin(S.box(0.3, P.footH + 0.06, 0.7, 0.004).at(0, -P.shin - P.footH + (P.footH + 0.06) / 2 - 0.014, 0.05), G.skin, 0.72, 0, 0.08, 30).paint(0.004, 0)]); }
/** cloth painted down the whole arm */
function armPaint(G, mat, raise = 0.0025) {
  const { P } = G;
  G.lr('arm', [mat(S.cyl(P.rUpper * 3, P.upper * 1.6, 0).at(0, -P.upper * 0.5, 0)).paint(0.005, raise)]);
  G.lr('fore', [mat(S.cyl(P.rFore * 3, P.fore * 1.14, 0).at(0, -P.fore * 0.45, 0)).paint(0.005, raise)]);
}
/** slashes: narrow panes of a second colour let into a puffed sleeve or leg, centred at height y of a limb node */
function slashes(c, r, y, len, n = 4, raise = -0.003) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    out.push(cloth(S.box(r * 0.26, len, 1, 0.002).at(t * r * 2.2, y, 0), c).paint(0.003, raise));
    out.push(cloth(S.box(1, len, r * 0.26, 0.002).at(0, y, t * r * 2.2), c).paint(0.003, raise));
  }
  return out;
}
/** full plate over an arming layer, any finish: the general form of fullPlate() */
function plateSuit(G, c, o = {}) {
  const { P } = G, under = o.under ?? tone(c, 0, -0.03, -0.32), um = o.underMat || ((x) => mail(x, under));
  const po = { mat: o.mat, trim: o.trim, trimMat: o.trimMat, rivet: o.rivet };
  G.add('torso', [torsoLayer(G, um)]);
  G.lr('arm', [um(S.cyl(P.rUpper * 3, P.upper * 1.6, 0).at(0, -P.upper * 0.5, 0)).paint(0.005, 0)]);
  G.lr('fore', [um(S.cyl(P.rFore * 3, P.fore * 1.1, 0).at(0, -P.fore * 0.45, 0)).paint(0.005, 0)]);
  G.lr('leg', [um(S.cyl(P.rThigh * 3, P.thigh * 1.5, 0).at(0, -P.thigh * 0.5, 0)).paint(0.005, 0)]);
  G.lr('shin', [um(S.cyl(P.rCalf * 3, P.shin * 1.0, 0).at(0, -P.shin * 0.46, 0)).paint(0.005, 0)]);
  for (const n of ['arm', 'fore', 'leg', 'shin']) G.cores(n, c);
  const cu = cuirass(G, c, { ...po, fauld: o.fauld ?? 3, grow: o.grow, gorget: o.gorget, keel: o.keel, seams: o.seams });
  G.add('torso', cu.prims, cu.hard);
  const pa = plateArm(G, c, { ...po, pauldron: o.pauldron ?? 1.08, lames: o.lames ?? 2, hand: o.hand });
  G.lr('arm', pa.arm, pa.armH); G.lr('fore', pa.fore, pa.foreH);
  const pl = plateLeg(G, c, { ...po, sabaton: o.sabaton, tasset: o.tasset });
  G.lr('leg', pl.leg, pl.legH); G.lr('shin', pl.shin, pl.shinH);
  if (o.skirt !== false) skirt(G, { mat: (x) => um(x).bump(0.003, 60, 'weave'), len: 0.105, flare: 0.022, top: 0.0, grow: 0.004 });
}
/** cones standing on a limb or plate: [[pos, dir, r, len], ...] */
const spikes = (list, mat, lodN = 99) => list.map(([p, d, r, l]) => orient(mat(H.cone(r, l, 6)), add3(p, mul3(norm3(d), l * 0.42)), d).lod(lodN));
/** an open bowl with the outfit's crest: what a closed helm becomes on a head with a muzzle */
function openBowl(G, mat, o = {}) {
  const hs = helmShell(G, o.kind ?? 'cap', mat, { sy: G.Lk * (o.sy ?? 1), y: o.y ?? 0.12, comb: o.comb, combMat: o.combMat });
  G.add('head', [], hs.hard);
  return hs;
}

// ---- Levy spearman: patched wool tunic, muddy hose, a rope for a belt, a kettle helm that has seen better days ----
OUTFITS.levy = (G) => {
  const { T, k, P } = G, c = G.cloth, dk = tone(c, 0, -0.04, -0.1), pc = G.o.cloth2 ?? tone(c, 0.06, 0.04, 0.1), hoseC = 0x5c4b38, mudC = 0x3a2c20;
  const wm = (x) => cloth(x, c);
  G.add('torso', [
    torsoLayer(G, wm, { raise: 0.003 }),
    ...torsoShells(G, (x) => wm(x).bump(0.003, 34, 'weave'), { grow: 0.011, blend: 0.03, hips: false }),
    cloth(S.cone(P.rNeck * 1.7, P.rNeck * 1.25, 0.03, 0.008).at(0, T + 0.008, -0.004), LINEN).blend(0.01),
    pbox((x) => cloth(x, tone(LINEN, 0, 0, -0.08)), 0.02, T * 0.26, [0, T * 0.9, 0.25], -0.003, 0.5),            // neck slit showing the shirt
    pbox((x) => cloth(x, dk), 0.006, T * 0.7, [G.cw * 0.86, T * 0.42, 0], -0.002),                               // side seams
    pbox((x) => cloth(x, dk), 0.006, T * 0.7, [-G.cw * 0.86, T * 0.42, 0], -0.002),
  ]);
  const f = G.field('torso');
  const p1 = patchOn(G, f, [-G.cw * 0.42, 0.16 * k, 0.6], [0, 0, -1], 0.03, pc), p2 = patchOn(G, f, [G.cw * 0.3, 0.1 * k, -0.6], [0, 0, 1], 0.034, tone(c, -0.03, 0, -0.12)), p3 = patchOn(G, f, [G.cw * 0.5, T * 0.72, 0.6], [0, 0, -1], 0.022, tone(pc, 0, -0.1, -0.1));
  const rb = ropeBelt(G, 0.05 * k), bag = pouch(G, 0.05 * k, -64, { size: 1.3, color: 0x6a4a2c });
  G.add('torso', [p1.prims, p2.prims, p3.prims, rb.prims, bag.prims, baldric(G, 0x5a3c22, true, 0.02)], [p1.hard, p2.hard, p3.hard, rb.hard, bag.hard]);
  const sk = skirt(G, { mat: (x) => wm(x), len: 0.17, flare: 0.045, top: 0.03, fold: 0.006, hem: { color: dk, h: 0.012 } });
  if (sk) G.add('root', [cloth(S.sphere(0.036).at(sk.rTop * 0.6, sk.y1 - sk.len * 0.6, sk.zc + sk.rTop + 0.02), tone(c, -0.03, 0, -0.12)).paint(0.006, 0.002)], tatters(G, { n: 7, y: sk.y1 - sk.len + 0.01, len: 0.035, w: 0.05, colors: [c, dk], ring: hemRing(sk, -0.005) }));
  G.lr('arm', sleeve(G, wm, { end: 0.96, grow: 1.05, hem: dk, bump: [0.003, 34, 'weave'] }));
  G.lr('fore', [cloth(S.cyl(P.rFore * 3, P.fore * 1.2, 0).at(0, -P.fore * 0.42, 0), LINEN).paint(0.004, 0.003), ...wraps(P.rFore, [-P.fore * 0.78, -P.fore * 0.9], 0x8a7450, 0.014, 0.004)]);
  G.add('armR', [cloth(S.sphere(P.rUpper * 0.9).at(-P.rUpper, -P.upper * 0.55, 0), pc).paint(0.005, 0.002)]);
  G.cores('arm', c); G.cores('fore', LINEN);
  hose(G, (x) => cloth(x, hoseC)); G.cores('leg', hoseC); G.cores('shin', mudC);
  G.lr('leg', [cloth(S.sphere(P.rCalf * 0.95).at(0, -P.thigh, P.rCalf * 0.7), tone(hoseC, 0.02, 0.05, 0.09)).paint(0.006, 0.002)]);
  boots(G, { top: 0.2, color: 0x4a3524, cuff: 0.02 });
  G.lr('shin', [fin(S.ellipsoid(0.2, P.shin * 0.42 + P.footH, 0.3).at(0, -P.shin - P.footH * 0.4, 0.04), mudC, 0.95, 0, 0.3, 46).paint(0.03, 0)]);        // mud to the calf
  if (!G.bare) {
    hoodShell(G, (x) => cloth(x, tone(c, 0.02, -0.04, -0.14)), { grow: 0.06, bump: [0.002, 40, 'weave'], open: [0.68, 0.84], oy: -0.24 });
    G.add('head', [], kettleHelm(G, G.armor, { brim: 1.62, droop: 0.2, tall: 0.84, tilt: -7, rivet: 0x6a6a6e, ridge: false }));
  }
};
HEADGEAR.levy = true;

// ---- Knight banneret: plate under a long quartered surcoat, great helm with a fan crest ----
/** a flat-topped great helm; trim picks out the cross over the sights */
function greatHelm(G, st, trim) {
  const R = G.R;
  clearHead(G);
  const gh = [
    st(S.cone(R * 1.13, R * 1.0, R * 2.0, R * 0.08).at(0, -R * 0.1, 0)),
    st(S.ellipsoid(R * 0.97, R * 0.3, R * 0.97).at(0, R * 0.84, 0)).blend(0.025),
    st(S.cone(R * 1.24, R * 1.14, R * 0.2, R * 0.03).at(0, -R * 1.06, 0)).blend(0.006),
    st(S.cyl(R * 1.09, R * 0.3, R * 0.02).at(0, R * 0.12, 0)).blend(0.003),
    gold(S.box(R * 0.2, R * 1.84, R * 0.8, 0.003).at(0, -R * 0.14, R * 0.98), trim).paint(0.003, 0.004),
    gold(S.box(R * 2.6, R * 0.3, R * 1.2, 0.003).at(0, R * 0.12, R * 0.7), trim).paint(0.003, 0.003),
    ...[-1, 1].map((s) => S.box(R * 0.56, R * 0.1, R * 0.5, 0.002).at(s * R * 0.43, R * 0.12, R * 1.0).cut(0.002).color(0x08080a)),
    gold(G.band(-R * 1.14, R * 0.08, R * 2), trim).paint(0.003, 0.003),
  ];
  const ghH = [];
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ghH.push(H.cyl(R * 0.03, R * 0.03, 0.004, 8).rot(90, 0, 0).rot(0, s * (22 + i * 9), 0).at(s * R * (0.4 + i * 0.165), -R * (0.42 + j * 0.16), R * (1.045 - i * 0.075)).color(0x08080a).pbr(0.9).lod(0));
  G.add('head', gh, ghH);
  return R * 1.14;   // height of the flat top
}
/** a fan crest across the helm, halved in two colours, on a twisted wreath */
function fanCrest(G, y, c, c2, trim, o = {}) {
  const R = G.R, s = o.size ?? 1.5, out = [], nu = 18, rs = [0.14, 0.5, 0.82, 0.86, 1];
  const fan = cloth(H.geo(fanGeo(162 * DEG, 18 * DEG, nu, rs, (a, u) => R * s * (1 + 0.07 * Math.cos(u * nu * Math.PI)))), c).shade((x, yy, z, nx, ny, nz, i) => { const ci = i % (nu + 1), ri = Math.floor(i / (nu + 1)); return ri >= 3 ? trim : Math.floor(ci / 3.01) % 2 ? c2 : null; });
  out.push(fan.scale(1.0, 1.3, 1).rot(-6, 0, 0).at(0, y - R * 0.05, -R * 0.04));
  out.push(cloth(H.geo(fanGeo(162 * DEG, 18 * DEG, 4, [0.14, 1], () => R * s)), c).scale(1.0, 1.3, 1).rot(-6, 0, 0).at(0, y - R * 0.05, -R * 0.04).far());
  out[0].near();
  out.push(cloth(H.torus(R * 0.52, R * 0.1, 16, 6), c).shade((x, yy) => (((Math.atan2(yy, x) / DEG + 360) % 60) < 30 ? c2 : null)).rot(90, 0, 0).at(0, y + R * 0.03, -R * 0.02).lod(1));
  return out;
}
OUTFITS.surcoat = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, steelC = G.armor, trim = G.trim, dev = typeof G.o.device === 'string' && SHAPES[G.o.device] ? G.o.device : null;
  const st = (x) => steel(x, steelC), sm = (x) => cloth(x, c), quartered = G.o.quartered ?? !dev;
  plateSuit(G, steelC, { fauld: 2, skirt: false, pauldron: 1.0 });
  // the surcoat: sleeveless, belted, split for the saddle
  const g = 0.026, yq = T - 0.078 * k;
  G.add('torso', [
    sm(G.shell(G.chestY + 0.004, 0.143 * k, g, g + 0.01)).blend(0.006).bump(0.002, 18, 'fur'),
    sm(G.shell(0.118 * k, 0.1 * k, g * 0.95)).blend(0.02),
    sm(G.shell(0.01, 0.07, g + 0.004)).blend(0.02),
    quartered && pbox((x) => cloth(x, c2), 0.5, yq + 0.12, [0.25, (yq - 0.12) / 2, 0], 0, 1, 0.003),
    pbox((x) => gold(x, trim), 0.5, 0.012, [0, yq - 0.012, 0], 0.002, 1, 0.003),                                   // neckline
  ]);
  const f = G.field('torso');
  if (dev) G.add('torso', [], [decal(G, 'torso', dev, { field: f, at: [0, G.chestY - 0.01, 0], size: 0.06 * k, color: G.o.deviceColor ?? c2, rough: 0.8, lift: 0.003 }), decal(G, 'torso', dev, { field: f, at: [0, G.chestY - 0.01, 0], size: 0.055 * k, color: G.o.deviceColor ?? c2, rough: 0.8, lift: 0.003, dir: [0, 0, 1], ex: [-1, 0, 0] })]);
  const b = belt(G, 0.06 * k, { h: 0.026, color: DARK_LEATHER, raise: 0.005, buckleColor: trim });
  G.add('torso', b.prims, [b.hard, scabbard(G, 0.06 * k, { len: 0.36, color: tone(c, 0, -0.1, -0.2), metal: trim })]);
  const len = Math.min(P.hipY - 0.13, 0.36);
  const sk = skirt(G, { mat: sm, top: 0.035, len, flare: 0.085, fold: 0.011, foldFreq: 12, grow: 0.03, hem: { color: trim, h: 0.014, rough: 0.5, metal: 0.6 } });
  if (sk) G.add('root', [
    quartered && pbox((x) => cloth(x, c2), 0.6, len * 1.2, [-0.3, sk.y1 - len / 2, 0], 0, 1.4, 0.003),
    pbox((x) => cloth(x, 0x1a1512), 0.01, len * 0.62, [0, sk.y1 - len * 0.7, sk.zc + 0.4], -0.004, 0.8),          // the riding split
    pbox((x) => gold(x, trim), 0.6, 0.014, [0, sk.y1 - len + 0.009, 0], 0.0025, 1.4),
  ]);
  else G.lr('leg', [gold(G.band(-Math.min(0.17 * 0.8, P.thigh * 0.6) * 0.9, 0.012, P.rThigh * 2.4), trim).paint(0.004, 0.002)]);
  if (G.bare) return;
  let top;
  if (G.muzzled()) { openBowl(G, st, {}); top = R * 1.16 * G.Lk; } else top = greatHelm(G, st, trim);
  G.add('head', [], fanCrest(G, top, c, c2, trim));
};
HEADGEAR.surcoat = true;

// ---- Landsknecht: slashed and puffed in two colours, a breastplate, an enormous hat ----
OUTFITS.landsknecht = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, steelC = G.armor, st = (x) => steel(x, steelC);
  const dm = (x) => cloth(x, c);
  G.add('torso', [torsoLayer(G, dm, { raise: 0.003 }), ...slashes(c2, G.cw, T * 0.5, T * 0.5, 5, -0.002)]);
  const cu = cuirass(G, steelC, { fauld: 1, gorget: false });
  G.add('torso', [cu.prims, cloth(S.torus(P.rNeck * 1.45, 0.012).at(0, T + 0.012, -0.004), LINEN).blend(0.004).bump(0.004, 60, 'ridges')], cu.hard);
  const b = belt(G, 0.05 * k, { h: 0.028, color: DARK_LEATHER, raise: 0.004 });
  G.add('torso', b.prims, [b.hard, scabbard(G, 0.05 * k, { len: 0.24, color: 0x3a2618, metal: BRASS })]);
  skirt(G, { mat: (x) => cloth(x, c2), len: 0.1, flare: 0.05, top: 0.02, fold: 0.012, foldFreq: 9, hem: { color: c, h: 0.016 } });
  // mi-parti: the left side leads with the main colour, the right with the second
  const limb = (a, b2) => {
    const r = P.rUpper, U = P.upper, rf = P.rFore, F = P.fore, rt = P.rThigh, L = P.thigh;
    const am = (x) => cloth(x, a), bm = (x) => cloth(x, b2);
    return {
      arm: [am(S.cyl(r * 3, U * 1.6, 0).at(0, -U * 0.5, 0)).paint(0.005, 0.002), am(S.ellipsoid(r * 1.8, U * 0.5, r * 1.85).at(r * 0.2, -U * 0.4, 0)).blend(0.012), ...slashes(b2, r * 1.5, -U * 0.42, U * 0.6, 4), bm(G.band(-U * 0.93, 0.02, r * 3)).paint(0.003, 0.006)],
      fore: [bm(S.cyl(rf * 3, F * 1.14, 0).at(0, -F * 0.45, 0)).paint(0.005, 0.002), bm(S.ellipsoid(rf * 1.6, F * 0.34, rf * 1.6).at(0, -F * 0.36, 0)).blend(0.012), ...slashes(a, rf * 1.3, -F * 0.36, F * 0.44, 3), am(G.band(-F * 0.84, 0.022, rf * 3)).paint(0.003, 0.005)],
      leg: [am(S.cyl(rt * 3, L * 1.5, 0).at(0, -L * 0.5, 0)).paint(0.005, 0.002), am(S.ellipsoid(rt * 1.42, L * 0.46, rt * 1.5).at(rt * 0.1, -L * 0.42, 0)).blend(0.016), ...slashes(b2, rt * 1.3, -L * 0.42, L * 0.6, 4), bm(G.band(-L * 0.9, 0.022, rt * 3)).paint(0.003, 0.006)],
      legH: [cloth(H.sphere(0.014, 6), b2).scale(1.5, 0.8, 0.7).at(P.rCalf * 1.1, -L * 0.9, 0).lod(1)],
      shin: [bm(S.cyl(P.rCalf * 3, P.shin * 1.02, 0).at(0, -P.shin * 0.47, 0)).paint(0.005, 0.002), ...[-1, 0, 1].map((i) => am(S.box(P.rCalf * 0.4, P.shin, 1, 0.002).at(i * P.rCalf * 0.8, -P.shin * 0.47, 0)).paint(0.003, 0.0026))],
    };
  };
  const lf = limb(c, c2), rt = limb(c2, c), mir = (l) => flat(l).map((x) => x.mirrorX());
  G.add('armL', lf.arm); G.add('foreL', lf.fore); G.add('legL', lf.leg, lf.legH); G.add('shinL', lf.shin);
  G.add('armR', mir(rt.arm)); G.add('foreR', mir(rt.fore)); G.add('legR', mir(rt.leg), mir(rt.legH)); G.add('shinR', mir(rt.shin));
  G.core('armL', c); G.core('foreL', c2); G.core('legL', c); G.core('shinL', c2); G.core('armR', c2); G.core('foreR', c); G.core('legR', c2); G.core('shinR', c);
  boots(G, { top: 0.12, color: 0x3a2a1e, cuff: 0.03 });
  if (G.bare) return;
  // the hat: a slashed brim wider than the shoulders, a soft crown, ostrich feathers
  const place = hatPlace(G, { tilt: -8, roll: 10, y: 0.12 });
  const bf = (a, t) => [lerp(1.02, 2.15 + 0.12 * Math.cos(a * 9), t), 0.44 - 0.2 * t * t + 0.16 * t * Math.sin(a * 3 + 1.2)];
  const crown = latheHat(G, 'beret', [[0, 0.98], [0.5, 1.0], [0.95, 0.94], [1.3, 0.78], [1.36, 0.62], [1.2, 0.48], [1.02, 0.44]], (h) => cloth(h, c2), { place });
  G.add('head', [], [
    brim(G, 'lands', bf, (h) => cloth(h, c), place, (x, y, z) => (((Math.atan2(x, z) / DEG + 360) % 40) < 14 && Math.hypot(x, z) > 1.45 ? c2 : null)),
    crown.hard,
    place(cloth(H.torus(1.2, 0.06, 20, 5), c).rot(90, 0, 0).at(0, 0.5, 0)).lod(1),
    plume(G, 0xf0ead8, { at: [-R * 0.9, R * 0.75, -R * 0.3], size: 1.05, n: 4 }),
    plume(G, c2, { at: [-R * 0.7, R * 0.78, -R * 0.55], size: 0.9, n: 3 }),
  ]);
};
HEADGEAR.landsknecht = true;

// ---- Flagellant: what is left of a monk's habit, a rope, chains, bare feet ----
OUTFITS.flagellant = (G) => {
  const { T, k, P } = G, c = G.cloth, dk = tone(c, 0, -0.03, -0.1), ironC = 0x4a4a50;
  const sk = robe(G, c, { fore: false, barefoot: true, bell: 1.8, flare: 0.09, fold: 0.012, hemY: Math.min(0.14, P.shin * 0.6), under: dk });
  barefoot(G);
  if (sk) G.add('root', [], tatters(G, { n: 13, y: sk.y1 - sk.len + 0.02, len: 0.1, w: 0.06, colors: [c, dk, tone(c, 0.02, 0, 0.06)], ring: hemRing(sk, -0.006), flare: 0.14 }));
  // torn sleeves end above the elbow in strips
  for (const s of [1, -1]) G.add(s > 0 ? 'armL' : 'armR', [], tatters(G, { n: 6, y: -P.upper * 0.86, len: 0.07, w: 0.04, colors: [c, dk], ring: (a) => [Math.sin(a) * P.rUpper * 1.25, Math.cos(a) * P.rUpper * 1.25], flare: 0.05, seed: 'slv' + s }));
  // the hood hangs down the back
  G.add('torso', [...mantle(G, (x) => cloth(x, dk), { drop: 0.05, reach: 0.014, bump: [0.005, 14, 'noise'] }), cloth(rod([0, T + 0.01, -G.cd * 1.2], [0, T - 0.16, -G.cd * 1.75], 0.05, 0.012), dk).blend(0.03)]);
  const f = G.field('torso');
  const p1 = patchOn(G, f, [G.cw * 0.4, 0.17 * k, 0.6], [0, 0, -1], 0.03, tone(c, 0.04, 0, 0.08));
  const rb = ropeBelt(G, 0.055 * k, ROPE, { len: 0.2, h: 0.022 }), e = G.tp(0.055 * k);
  // a chain over each shoulder crossing on the chest, a padlock where they meet; manacles trailing links
  const a = Math.atan2(G.sx * 1.5, T) / DEG, cm = (x) => fin(x, ironC, 0.55, 0.8, 0.2, 90);
  const cp = trace(f, [0, T * 0.52, 0.6], [0, 0, -1]) || [0, T * 0.52, G.cd];
  G.add('torso', [p1.prims, rb.prims, cm(S.box(0.022, T * 2.4, 1, 0.004).rot(0, 0, a).at(0, T * 0.52, 0)).paint(0.003, 0.007).bump(0.003, 70, 'ridges'), cm(S.box(0.022, T * 2.4, 1, 0.004).rot(0, 0, -a).at(0, T * 0.52, 0)).paint(0.003, 0.007).bump(0.003, 70, 'ridges')], [
    p1.hard, rb.hard,
    iron(H.box(0.04, 0.036, 0.016, 0.005), 0x3a3a40).at(cp[0], cp[1] - 0.012, cp[2] + 0.012).lod(1), iron(H.torus(0.013, 0.004, 10, 5, Math.PI), 0x5a5a60).at(cp[0], cp[1] + 0.006, cp[2] + 0.012).lod(1),
    // a wooden token and a scourge at the belt
    wood(H.box(0.03, 0.04, 0.008, 0.003), 0x5a3c22).rot(0, -50, 0).at(-e.side * 0.8, 0.055 * k - 0.06, e.zc + e.depth * 0.8).lod(1),
    wood(H.cyl(0.006, 0.007, 0.09, 6), 0x4a3020).rot(0, 0, 12).at(e.side + 0.014, 0.055 * k - 0.04, e.zc).lod(1),
    ...[0, 1, 2].map((i) => chain(sag([e.side + 0.02, 0.055 * k - 0.085, e.zc], [e.side + 0.03 + i * 0.012, 0.055 * k - 0.2, e.zc + (i - 1) * 0.02], -0.006, 3), 0.003, 0x3a2a1e, { metal: 0, rough: 0.9 })),
  ]);
  const F = P.fore, rw = P.rWrist;
  const man = [iron(S.cyl(rw * 2.6, 0.03, 0).at(0, -F * 0.86, 0), ironC).paint(0.003, 0.007)];
  const links = (s) => chain([[s * (rw * 1.3 + 0.004), -F * 0.86, 0], [s * (rw * 1.3 + 0.01), -F * 0.86 - 0.05, 0.004], [s * (rw * 1.3 + 0.006), -F * 0.86 - 0.1, -0.004]], 0.0055, ironC);
  G.add('foreL', man, [links(1)]); G.add('foreR', man.map((x) => x.mirrorX()), [links(-1)]);
  G.add('foreL', wraps(P.rFore, [-F * 0.3, -F * 0.42, -F * 0.54], 0x9a8a68, 0.016, 0.004));
};

// ---- Elven guard: white-gold scale over a long tunic, a spotless cloak, a tall winged helm ----
SHELLS.spire = { f: [[0, 2.2], [0.17, 1.8], [0.5, 1.2], [0.88, 0.78], [1.03, 0.52], [1.1, 0.38]], s: [[0, 2.2], [0.17, 1.8], [0.5, 1.2], [0.88, 0.76], [1.04, 0.36], [1.08, 0.0]], b: [[0, 2.2], [0.19, 1.8], [0.56, 1.2], [0.94, 0.74], [1.08, 0.2], [1.2, -0.4]] };
OUTFITS.elfScale = (G) => {
  const { T, k, P, R } = G, c = G.cloth, m = G.armor, trim = G.trim, white = tone(c, 0, -0.5, 0.0) && 0xf1ede2;
  const sc = (x) => fin(x, m, 0.28, 1, 0.05, 30), st = (x) => fin(x, m, 0.24, 1, 0.04, 24), tm = (x) => cloth(x, white);
  G.add('torso', [torsoLayer(G, tm, { raise: 0.002 }), ...torsoShells(G, (x) => sc(x).bump(0.0045, 46, 'scales'), { grow: 0.013, blend: 0.02, hips: false })]);
  G.add('torso', [
    st(S.cone(P.rNeck * 1.9, P.rNeck * 1.26, 0.05, 0.008).at(0, T + 0.016, -0.004)).blend(0.004), gold(S.torus(P.rNeck * 1.28, 0.006).at(0, T + 0.042, -0.004), trim).blend(0.003),
    gold(G.band(0.2 * k, 0.008), trim).paint(0.003, 0.002),
  ]);
  const f = G.field('torso');
  G.add('torso', [], [decal(G, 'torso', 'star', { field: f, at: [0, G.chestY + 0.012, 0], size: 0.034 * k, color: trim, rough: 0.3, metal: 1, lift: 0.004 }), gem(H.sphere(0.009 * k, 8), 0x7fd8e8).at(0, G.chestY + 0.012, G.tp(G.chestY).front + 0.022).lod(1)]);
  const b = belt(G, 0.055 * k, { h: 0.022, color: tone(c, 0, -0.05, -0.12), raise: 0.004, buckleColor: trim });
  G.add('torso', b.prims, b.hard);
  // scale skirt over the long tunic
  const len = Math.min(0.3, P.hipY - 0.2);
  const sk = skirt(G, { mat: tm, top: 0.03, len, flare: 0.06, fold: 0.008, hem: { color: trim, h: 0.012, rough: 0.4, metal: 0.8 } });
  if (sk) G.add('root', [sc(S.cone(sk.rTop + 0.034, sk.rTop + 0.008, 0.13, 0.01).at(0, sk.y1 - 0.06, sk.zc)).blend(0.004).bump(0.0045, 46, 'scales'), gold(G.band(sk.y1 - 0.128, 0.008), trim).paint(0.003, 0.002),
    pbox((x) => cloth(x, 0x1a1512), 0.008, len * 0.5, [0, sk.y1 - len * 0.76, sk.zc + 0.4], -0.003, 0.8)]);
  // leaf-shaped shoulders, slim vambraces and greaves
  const pa = plateArm(G, m, { mat: st, trim, pauldron: 0.98, lames: 1, upper: false, couter: false });
  const r = P.rUpper;
  G.lr('arm', [tm(S.cyl(r * 3, P.upper * 1.6, 0).at(0, -P.upper * 0.5, 0)).paint(0.005, 0.002), sc(S.capsule([0, -r * 0.6, 0], [0, -P.upper * 0.7, 0], r * 1.16, r * 1.1)).blend(0.006).bump(0.004, 50, 'scales'), ...pa.arm, st(S.ellipsoid(r * 0.5, r * 1.5, r * 1.2).rot(0, 0, 24).at(r * 1.5, r * 0.5, 0)).blend(0.006)], pa.armH);
  G.lr('fore', [tm(S.cyl(P.rFore * 3, P.fore * 1.14, 0).at(0, -P.fore * 0.45, 0)).paint(0.005, 0.002), ...pa.fore], pa.foreH);
  const hoseC = tone(c, 0, -0.1, -0.16);
  hose(G, (x) => cloth(x, hoseC));
  const pl = plateLeg(G, m, { mat: st, trim, tasset: false, cuisse: false });
  G.lr('leg', pl.leg, pl.legH); G.lr('shin', pl.shin, pl.shinH);
  G.cores('arm', m); G.cores('fore', m); G.cores('leg', hoseC); G.cores('shin', m);
  cape(G, { color: c, len: 0.7, trim: white, slope: 0.28, width: G.sx * 2.8, foldAmp: 0.026 });
  for (const s of [-1, 1]) G.add('torso', [], [gold(H.sphere(0.015, 10), trim).scale(1, 1, 0.5).at(s * G.sx * 0.6, T - 0.03, G.tp(T - 0.04).front * 0.7 + 0.02).lod(1)]);
  if (G.bare) return;
  dropEars(G);
  G.add('head', cheekPlates(G, st));
  const hs = helmShell(G, 'spire', st, { sy: G.Lk, y: 0.1 });
  const hh = [hs.hard, hs.place(gold(H.torus(1.085, 0.045, 28, 6), trim).rot(90, 0, 0).rot(-10, 0, 0).at(0, 0.42, 0.0)).lod(1), hs.place(gold(H.box(0.12, 0.7, 0.05, 0.02), trim).rot(-8, 0, 0).at(0, 0.1, 1.1)).lod(1),
    hs.place(gold(H.torus(1.0, 0.03, 20, 5, Math.PI * 0.6), trim).rot(0, 0, 60).rot(0, -90, 0).scale(0.5, 2.14, 1.0)).lod(1)];
  const cols = [tone(trim, 0, 0, -0.1), 0xf6f2e8, trim];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const a = (40 + i * 11) * DEG, len = R * (2.9 - i * 0.26);
      hh.push(feather([s * R * 0.98, R * (0.32 + i * 0.02), -R * (0.05 + i * 0.07)], [s * 0.5, Math.sin(a), -Math.cos(a)], len, R * 0.5, [s, 0, 0.25], cols).lod(i < 4 ? 99 : 1));
    }
    hh.push(gold(H.sphere(R * 0.17, 10), trim).scale(0.5, 1, 1).at(s * R * 1.03, R * 0.3, -R * 0.08).lod(1));
  }
  G.add('head', [], hh);
};
HEADGEAR.elfScale = true;

// ---- Dark champion: black plate that is all hooks and edges, a crimson cloak, a masked helm with a blade for a crest ----
OUTFITS.barbed = (G) => {
  const { T, k, P, R } = G, red = G.cloth, c = G.armor, edge = tone(c, 0, 0, 0.16), trim = G.o.trim ?? tone(c, 0, 0, 0.2);
  const st = dkSteel(c), eg = dkSteel(edge), hk = (h) => fin(h, edge, 0.34, 1);
  plateSuit(G, c, { mat: st, trimMat: eg, pauldron: 1.2, lames: 2, fauld: 3, under: tone(red, 0, -0.2, -0.24), underMat: (x) => cloth(x, tone(red, 0, -0.2, -0.24)), rivet: edge, skirt: false });
  const r = P.rUpper, rf = P.rFore, F = P.fore, L = P.thigh, rc = P.rCalf;
  // barbs: swept blades on the shoulders, fins on the forearms, hooks at knee and hip
  const fin2 = (len, w) => H.extrude([[0, 0], [w, len * 0.2], [w * 0.5, len * 0.42], [w * 0.95, len * 0.6], [w * 0.25, len * 0.74], [0, len], [-w * 0.2, len * 0.4]], 0.006, 0.002);
  G.lr('arm', [], [
    ...[0, 1, 2].map((i) => orient(hk(fin2(r * (2.6 - i * 0.5), r * 0.9)), [r * (0.3 + i * 0.62), r * (1.2 - i * 0.36), -r * 0.2 + (i - 1) * r * 0.3], [0.1 + i * 0.5, 1, -0.25], [0, 0, 1]).lod(i ? 1 : 99)),
    orient(hk(H.cone(r * 0.3, r * 1.3, 5)), [r * 1.5, -P.upper, -r * 0.2], [0.8, 0.2, -0.6]).lod(1),
  ]);
  G.lr('fore', [], [0, 1, 2].map((i) => orient(hk(fin2(rf * (1.9 - i * 0.3), rf * 0.8)), [rf * 1.05, -F * (0.3 + i * 0.2), -rf * 0.3], [0.9, -0.5, -0.3], [0, 0, 1]).lod(1)));
  G.lr('leg', [], [orient(hk(H.cone(rc * 0.5, rc * 2.0, 5)), [0, -L + rc * 0.5, rc * 1.5], [0, 0.55, 1]), orient(hk(fin2(P.rThigh * 1.5, P.rThigh * 0.6)), [P.rThigh * 1.2, -L * 0.3, 0], [1, -0.5, 0], [0, 0, 1]).lod(1)]);
  G.lr('shin', [], [orient(hk(fin2(rc * 1.9, rc * 0.7)), [0, -P.shin * 0.3, -rc * 1.0], [0, -0.5, -1], [1, 0, 0]).lod(1)]);
  // a jagged brow of steel over the breast, a ragged skirt of mail and leather
  const f = G.field('torso'), ch = G.tp(G.chestY);
  G.add('torso', [...[-1, 1].map((s) => eg(S.box(0.012, T * 0.42, 0.5, 0.002).rot(0, 0, s * 58).at(s * ch.side * 0.45, G.chestY - 0.06 * k, 0.25)).paint(0.003, 0.003)), eg(S.box(0.012, T * 0.5, 0.5, 0.002).at(0, G.chestY - 0.01, 0.25)).paint(0.003, 0.003)],
    [decal(G, 'torso', 'lozenge', { field: f, at: [0, G.chestY + 0.02, 0], size: 0.03 * k, color: red, rough: 0.3, metal: 0.4, lift: 0.004 }), ...[-1, 1].map((s) => orient(hk(H.cone(0.014, 0.07, 5)), [s * (G.sx - 0.07), T + 0.03, -0.01], [s * 0.4, 1, -0.2]).lod(1))]);
  const sk = skirt(G, { mat: (x) => cloth(x, tone(red, 0, -0.1, -0.2)), len: 0.15, flare: 0.035, top: 0.0, fold: 0.006, grow: 0.004 });
  if (sk) G.add('root', [], [...tatters(G, { n: 11, y: sk.y1 - sk.len + 0.02, len: 0.09, w: 0.055, colors: [tone(red, 0, -0.1, -0.2), tone(red, 0, 0, -0.1), 0x16161a], ring: hemRing(sk, -0.006), flare: 0.2 }),
    flap(G, sk, 1, { color: red, len: 0.3, w: 0.1, ragged: 0.05, trim: 0x16161a })]);
  cape(G, { color: red, len: 0.72, slope: 0.27, ragged: 0.06, foldAmp: 0.036, width: G.sx * 2.8, trim: tone(red, 0, -0.1, -0.2) });
  if (G.bare) return;
  const crest = fin2(R * 2.3, R * 0.62);
  const blade = (y) => [hk(H.extrude([[-1.3, -0.5], [-1.2, 0.3], [-0.7, 0.9], [0.0, 1.25], [0.8, 1.1], [1.7, 1.5], [1.3, 0.5], [0.95, 0.0], [0.3, 0.2], [-0.3, 0.16], [-0.9, -0.14]].map(([x, yy]) => [x * R, yy * R]), 0.007, 0.002)).rot(0, 90, 0).at(0, y, -R * 0.1)];
  if (G.muzzled()) { openBowl(G, st, {}); G.add('head', [], blade(R * 0.86 * G.Lk)); return; }
  clearHead(G);
  const glowC = G.o.glow;
  const slit = (s) => { const x = S.box(R * 0.5, R * 0.1, R * 0.5, 0.002).rot(0, 0, s * 16).at(s * R * 0.36, R * 0.06, R * 0.96).cut(0.002).color(glowC ?? 0x060608); return glowC != null ? x.glow(1.5) : x; };
  G.add('head', [
    st(S.ellipsoid(R * 1.03, R * 1.14, R * 1.12).at(0, R * 0.18, -R * 0.05)),
    st(S.cone(R * 0.42, R * 0.98, R * 1.25, R * 0.05).at(0, -R * 0.6, R * 0.12)).blend(0.03),
    st(S.cone(R * 1.2, R * 0.96, R * 0.34, R * 0.03).at(0, -R * 1.1, -R * 0.04)).blend(0.006),
    eg(S.ellipsoid(R * 0.07, R * 0.8, R * 0.3).rot(-8, 0, 0).at(0, -R * 0.42, R * 0.98)).blend(0.006),                 // the keel of the mask
    eg(S.box(R * 1.5, R * 0.12, R * 0.4, R * 0.03).at(0, R * 0.26, R * 0.9)).blend(0.005),                           // brow
    slit(-1), slit(1),
    ...[-1, 1].flatMap((s) => [0, 1, 2].map((i) => S.box(R * 0.03, R * 0.26, R * 0.4, 0).rot(0, s * 20, 0).at(s * R * (0.2 + i * 0.13), -R * 0.5, R * 0.95).cut(0.002).color(0x060608))),
  ], [
    blade(R * 1.02),
    ...[-1, 1].flatMap((s) => [orient(hk(crest), [s * R * 0.96, R * 0.2, -R * 0.1], [s * 0.45, 0.5, -1], [0, 1, 0]).scale(1, 1, 1), orient(hk(fin2(R * 1.3, R * 0.4)), [s * R * 0.9, -R * 0.5, 0], [s * 0.5, -0.1, -1], [0, 1, 0]).lod(1)]),
  ]);
};
HEADGEAR.barbed = true;

// ---- Wood warden: a hooded cloak of autumn leaves over a breastplate grown, not forged ----
OUTFITS.leafcloak = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, bark = G.o.armor ?? 0x5c4028, pale = tone(bark, 0.01, -0.05, 0.12), tunic = mix(c, 0x26301c, 0.78), vein = tone(c, 0, -0.1, -0.2);
  const wm = (x) => wood(x, bark), lm = (x) => fin(x, c, 0.9, 0, 0.34, 46).bump(0.009, 27, 'scales');
  /** blotches of the other leaf colours over whatever is within r of p */
  const dapple = (p, r, n, seed) => { const out = [], rr = rng(seed); for (let i = 0; i < n; i++) { const a = rr() * 6.283, b = (rr() - 0.5) * 2; out.push(cloth(S.sphere(r * (0.2 + rr() * 0.16)).at(p[0] + Math.cos(a) * r * 0.9, p[1] + b * r * 0.6, p[2] + Math.sin(a) * r * 0.9), i % 3 ? c2 : mix(c, c2, 0.5)).paint(0.004, 0.0015)); } return out; };
  const leafCols = [[vein, c, c2], [vein, c2, c], [vein, mix(c, c2, 0.5), c2]];
  G.add('torso', [torsoLayer(G, (x) => cloth(x, tunic), { raise: 0.003 })]);
  armPaint(G, (x) => cloth(x, tunic));
  // breastplate: bark grain running up the body, roots twisting across it
  const ch = G.tp(G.chestY), w = G.tp(0.118 * k), g = 0.014;
  G.add('torso', [
    wm(S.ellipsoid(0.134 * k, ch.side + g, ch.depth + g + 0.006).rot(0, 0, 90).at(0, G.chestY + 0.002, ch.zc + 0.004)).blend(0.006).bump(0.006, 24, 'ridges'),
    wm(S.ellipsoid(0.094 * k, w.side + g, w.depth + g).rot(0, 0, 90).at(0, 0.122 * k, w.zc)).blend(0.012).bump(0.006, 24, 'ridges'),
  ]);
  const f = G.field('torso'), vines = [];
  const lay = (xy, rr, col) => { const pts = []; for (const [x, y] of xy) { const p = trace(f, [x, y, 0.6], [0, 0, -1]) || [x, y, ch.front]; pts.push([p[0], p[1], p[2] + rr[0] * 0.5]); } return wood(H.tube(pts, rr, 14, 6), col).lod(1); };
  vines.push(lay([[-ch.side * 0.7, 0.07 * k], [-ch.side * 0.3, 0.14 * k], [ch.side * 0.1, 0.17 * k], [ch.side * 0.5, 0.235 * k], [ch.side * 0.62, T - 0.07 * k]], [0.011, 0.01, 0.009, 0.007, 0.004], pale));
  vines.push(lay([[ch.side * 0.66, 0.08 * k], [ch.side * 0.2, 0.12 * k], [-ch.side * 0.25, 0.2 * k], [-ch.side * 0.55, T - 0.09 * k]], [0.009, 0.009, 0.007, 0.004], tone(bark, 0, 0, 0.06)));
  vines.push(lay([[0, 0.07 * k], [ch.side * 0.06, 0.15 * k], [-ch.side * 0.05, 0.22 * k], [0, T - 0.07 * k]], [0.008, 0.007, 0.006, 0.003], pale));
  const kn = trace(f, [ch.side * 0.1, 0.17 * k, 0.6], [0, 0, -1]);
  if (kn) vines.push(wood(H.sphere(0.017, 8), pale).scale(1, 1, 0.6).at(kn[0], kn[1], kn[2] + 0.008).lod(1), gem(H.sphere(0.008, 8), 0xd9a02a, 0.5).at(kn[0], kn[1], kn[2] + 0.017).lod(1));
  const rb = ropeBelt(G, 0.05 * k, 0x5a5a2c, { len: 0.07 }), pch = pouch(G, 0.05 * k, -62, { color: 0x4a3524 });
  G.add('torso', [rb.prims, pch.prims], [vines, rb.hard, pch.hard]);
  // kilt of leaves
  const sk = skirt(G, { mat: lm, len: 0.14, flare: 0.045, top: 0.03 });
  if (sk) { G.add('root', dapple([0, sk.y1 - sk.len * 0.5, sk.zc], sk.rHem + sk.ox, 14, 9)); const ring = hemRing(sk, -0.004), lv = []; for (let i = 0; i < 12; i++) { const a = ((i + 0.5) / 12) * Math.PI * 2, q = ring(a); lv.push(feather([q[0], sk.y1 - sk.len + 0.02, q[1]], [Math.sin(a) * 0.3, -1, Math.cos(a) * 0.3], 0.07 + (i % 3) * 0.012, 0.05, [Math.sin(a), 0.3, Math.cos(a)], leafCols[i % 3]).lod(1)); } G.add('root', [], lv); }
  // bracers of wound root, soft boots
  const F = P.fore, rf = P.rFore;
  G.lr('fore', [wm(S.capsule([0, -F * 0.3, 0], [0, -F * 0.84, 0], rf * 1.22, P.rWrist * 1.4)).blend(0.004).bump(0.005, 34, 'ridges')], [wood(H.tube([0, 1, 2, 3, 4, 5, 6].map((i) => [Math.cos(i * 1.3) * rf * 1.2, -F * (0.3 + i * 0.09), Math.sin(i * 1.3) * rf * 1.2]), 0.006, 18, 5), pale).lod(1)]);
  const hoseC = tone(tunic, 0.02, 0, -0.04);
  hose(G, (x) => cloth(x, hoseC)); boots(G, { top: 0.55, color: 0x4a3524, cuff: 0.06 });
  G.cores('arm', tunic); G.cores('fore', bark); G.cores('leg', hoseC); G.cores('shin', 0x4a3524);
  // the cloak: every leaf sewn on by hand
  G.add('torso', [...mantle(G, lm, { drop: 0.066, reach: 0.034 }), ...dapple([0, T - 0.03, 0], G.sx + 0.03, 16, 7)]);
  const e = G.tp(T - 0.07), fr = [];
  for (let i = 0; i < 16; i++) { const a = ((i + 0.5) / 16) * Math.PI * 2, x = Math.sin(a) * (G.sx + 0.03), z = e.zc + Math.cos(a) * (e.depth + 0.04); fr.push(feather([x, T - 0.06 * k, z], [Math.sin(a) * 0.5, -1, Math.cos(a) * 0.5], 0.065 + (i % 3) * 0.014, 0.05, [Math.sin(a), 0.5, Math.cos(a)], leafCols[i % 3]).lod(i % 2 ? 1 : 99)); }
  G.add('torso', [], fr);
  const seed = hashStr(G.id) % 50;
  cape(G, { color: c, len: 0.6, slope: 0.28, ragged: 0.07, foldAmp: 0.03, width: G.sx * 2.6, nu: 26, nv: 24, farColor: mix(c, c2, 0.4),
    pattern: (u, v) => { const row = Math.floor(v * 13), col = Math.floor(u * 11 + (row % 2) * 0.5), n = noise3(col * 7.7 + seed, row * 5.3, 5.1), fv = v * 13 - row; return fv < 0.14 ? vein : n < 0.42 ? null : n < 0.58 ? c2 : mix(c, c2, 0.5); } });
  if (G.bare) return;
  hoodShell(G, lm, { grow: 0.16, open: [0.72, 0.9], oy: -0.2, peak: 0.42, deep: 0.3 });
  { const hp = G.nodes.head.prims, at = hp.findIndex((x) => x.op === 1); if (at > 0) hp.splice(at, 0, ...dapple([0, R * 0.2, -R * 0.1], R * 1.2, 16, 11)); }
  const hl = [];
  for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.6; hl.push(feather([Math.sin(a) * R * 0.95, R * 0.86 + Math.cos(a) * R * 0.3, R * 0.5 * Math.cos(a) + R * 0.3], [Math.sin(a) * 0.3, -0.25, 1], R * 0.5, R * 0.36, [Math.sin(a) * 0.4, 1, 0.3], leafCols[i % 3]).lod(1)); }
  if (G.o.antlers) {
    const ac = 0x9a8460;
    hl.push(hornPair(G, [[0.5, 0.95, -0.2], [0.95, 1.55, -0.4], [1.3, 2.2, -0.2], [1.2, 2.9, 0.2]], [0.13, 0.11, 0.085, 0.02], { color: ac, seg: 12 }));
    hl.push(hornPair(G, [[0.92, 1.5, -0.38], [1.0, 1.75, 0.1], [0.95, 2.1, 0.5]], [0.08, 0.06, 0.015], { color: ac, seg: 6 }));
    hl.push(hornPair(G, [[1.28, 2.15, -0.22], [1.7, 2.45, -0.3], [1.95, 2.85, -0.15]], [0.07, 0.05, 0.012], { color: ac, seg: 6 }));
    hl.push(hornPair(G, [[1.1, 1.85, -0.34], [1.2, 2.0, -0.8], [1.25, 2.35, -1.05]], [0.065, 0.05, 0.012], { color: ac, seg: 6 }).map((h) => h.lod(1)));
  }
  G.add('head', [], hl);
};
HEADGEAR.leafcloak = true;

/** a band of ornament metal cut with runes, round a ring(a) -> [x, z] at height y of a node */
function runeBand(G, y, h, ring, n, trim, glow) {
  const out = [gold(S.cyl(1, h, 0).at(0, y, 0), trim).paint(0.003, 0.0035)], r = rng(hashStr(`${G.id}:runes:${Math.round(y * 1000)}`));
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2, q = ring(a), kind = Math.floor(r() * 3);
    for (const tilt of kind === 0 ? [0, 38] : kind === 1 ? [-30, 30] : [0, -40]) {
      const x = S.box(h * 0.14, h * 0.72, 0.05, 0).rot(0, 0, tilt).rot(0, a / DEG, 0).at(q[0], y, q[1]).paint(0.002, -0.002).color(glow ?? 0x15151c);
      if (glow != null) x.glow(1.5);
      out.push(x);
    }
  }
  return out;
}
const limbRing = (r) => (a) => [Math.sin(a) * r, Math.cos(a) * r];

// ---- Dwarf ironbreaker: slabs of star-iron locked one over the next, rune bands, the face of an ancestor for a visor ----
OUTFITS.starIron = (G) => {
  const { T, k, P, R } = G, c = G.armor, trim = G.trim, under = tone(G.cloth, 0, -0.1, -0.2), glow = G.o.glow;
  const st = (x) => fin(x, c, 0.36, 1, 0.1, 18), tm = (x) => gold(x, trim);
  plateSuit(G, c, { mat: st, grow: 0.019, pauldron: 1.3, lames: 2, fauld: 3, underMat: (x) => mail(x, under), under, rivet: trim });
  const ch = G.tp(G.chestY), w = G.tp(0.118 * k), g = 0.02;
  G.add('torso', [
    st(S.box(ch.side * 1.5, 0.105 * k, 0.07, 0.014).at(0, G.chestY + 0.024, ch.front - 0.008)).blend(0.004),            // breast slab
    st(S.box(w.side * 1.2, 0.08 * k, 0.07, 0.014).at(0, 0.125 * k, w.front + 0.002)).blend(0.004),                      // belly slab
    st(S.box(ch.side * 1.4, 0.16 * k, 0.07, 0.014).at(0, G.chestY, -ch.back + 0.008)).blend(0.004),                    // back slab
    ...runeBand(G, 0.2 * k, 0.026, waistRing(G, 0.2 * k, 0.02), 12, trim, glow),
    ...runeBand(G, T + 0.03, 0.022, limbRing(P.rNeck * 1.8), 8, trim, glow),
  ]);
  const b = belt(G, 0.055 * k, { h: 0.034, color: 0x3a2a1e, raise: 0.004, buckle: false }), e = G.tp(0.055 * k);
  G.add('torso', b.prims, [
    tm(H.box(0.06, 0.05, 0.014, 0.006)).at(0, 0.055 * k, e.front + g + 0.006).lod(1), gem(H.box(0.022, 0.022, 0.01, 0.006), 0x3aa7c9).rot(0, 0, 45).at(0, 0.055 * k, e.front + g + 0.014).lod(1),
    ...studs(G, 'torso', [-1, 1].flatMap((s) => [0, 1, 2].map((i) => [s * ch.side * 0.6, G.chestY - 0.02 + i * 0.045 * k, 0.6])), { dir: [0, 0, -1], r: 0.008, color: trim }),
  ]);
  const r = P.rUpper, rf = P.rFore, F = P.fore, rc = P.rCalf;
  G.lr('arm', [st(S.box(r * 2.9, r * 0.8, r * 3.3, r * 0.25).rot(0, 0, -16).at(r * 0.6, r * 0.95, 0)).blend(0.004), tm(S.box(r * 3.2, r * 0.22, r * 3.6, 0.002).rot(0, 0, -16).at(r * 0.55, r * 0.62, 0)).paint(0.003, 0.003)],
    studs(G, 'torso', [], {}));
  G.lr('fore', runeBand(G, -F * 0.3, 0.022, limbRing(rf * 1.2), 6, trim, glow));
  G.lr('shin', runeBand(G, -P.shin * 0.14, 0.022, limbRing(rc * 1.2), 6, trim, glow));
  G.lr('leg', [st(S.box(P.rThigh * 2.3, P.thigh * 0.5, 0.03, 0.01).rot(-6, 0, 0).at(P.rThigh * 0.1, -P.thigh * 0.28, P.rThigh * 0.95)).blend(0.004)]);
  if (G.bare) return;
  if (G.muzzled()) { const hs = openBowl(G, st, { comb: 0.05, combMat: tm }); G.add('head', [], [hs.place(tm(H.torus(1.09, 0.06, 26, 6)).rot(90, 0, 0).at(0, 0.4, 0)).lod(1)]); return; }
  clearHead(G);
  const hole = (s) => S.ellipsoid(R * 0.2, R * 0.1, R * 0.3).rot(0, 0, s * 8).at(s * R * 0.36, R * 0.04, R * 1.02).cut(0.004).color(glow ?? 0x08080a);
  G.add('head', [
    st(S.ellipsoid(R * 1.1, R * 1.06, R * 1.14).at(0, R * 0.22, -R * 0.05)),
    st(S.cone(R * 1.36, R * 1.06, R * 0.8, R * 0.05).at(0, -R * 0.72, -R * 0.12)).blend(0.01),                           // neck guard
    st(S.box(R * 0.2, R * 0.5, R * 2.1, R * 0.06).at(0, R * 1.08, -R * 0.08)).blend(0.01),                            // ridge
    tm(S.ellipsoid(R * 0.86, R * 1.0, R * 0.56).at(0, -R * 0.2, R * 0.66)).blend(0.004),                              // the mask
    tm(S.box(R * 1.6, R * 0.22, R * 0.4, R * 0.08).at(0, R * 0.3, R * 0.98)).blend(0.012),                             // heavy brow
    ...[-1, 1].map((s) => tm(S.box(R * 0.7, R * 0.14, R * 0.3, R * 0.05).rot(0, 0, -s * 14).at(s * R * 0.38, R * 0.26, R * 1.08)).blend(0.006)),
    tm(S.box(R * 0.24, R * 0.62, R * 0.36, R * 0.07).rot(-12, 0, 0).at(0, -R * 0.1, R * 1.14)).blend(0.01),              // nose
    tm(S.ellipsoid(R * 0.3, R * 0.18, R * 0.2).at(0, -R * 0.36, R * 1.2)).blend(0.01),
    ...[-1, 1].map((s) => tm(rod([s * R * 0.08, -R * 0.5, R * 1.16], [s * R * 0.62, -R * 0.82, R * 0.96], R * 0.15, R * 0.08)).blend(0.008)),   // moustache
    ...[-2, -1, 0, 1, 2].map((i) => tm(rod([i * R * 0.2, -R * 0.66, R * 1.02], [i * R * 0.3, -R * (1.75 - Math.abs(i) * 0.22), R * (1.12 - Math.abs(i) * 0.08)], R * 0.16, R * 0.1)).blend(0.006).bump(0.004, 60, 'ridges')),   // plaited beard
    hole(-1), hole(1),
    S.box(R * 0.5, R * 0.05, R * 0.3, 0).at(0, -R * 0.62, R * 1.1).cut(0.003).color(0x08080a),
    ...runeBand(G, R * 0.62, R * 0.2, limbRing(R * 1.1), 9, trim, glow),
  ], [
    ...[-2, -1, 0, 1, 2].map((i) => iron(H.torus(R * 0.11, R * 0.035, 8, 5), c).rot(90, 0, 0).at(i * R * 0.3, -R * (1.72 - Math.abs(i) * 0.22), R * (1.12 - Math.abs(i) * 0.08)).lod(1)),
    ...[-1, 1].map((s) => tm(H.box(R * 0.12, R * 0.8, R * 0.7, R * 0.04)).rot(-20, 0, s * 12).at(s * R * 1.12, R * 0.75, -R * 0.1)),         // upright cheek fins
  ]);
};
HEADGEAR.starIron = true;

// ---- Sun warrior: hammered gold on bare skin, turquoise, feathers, a little banner on his back ----
OUTFITS.sunGold = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, g = G.trim, tq = G.o.gem ?? TURQ;
  const gm = (x) => gold(x, g), tqm = (x) => fin(x, tq, 0.4, 0.1, 0.1, 40);
  const fc = [[0x3a3020, c2, tq], [0x3a3020, tq, c2], [0x3a3020, c, 0xf2ead0]];
  // pectoral: a broad collar and a breast plate with the sun on it
  const e = G.tp(T - 0.05), ch = G.tp(G.chestY);
  G.add('torso', [
    gm(S.ellipsoid(G.sx * 0.9, 0.034 * k, e.depth + 0.014).at(0, T - 0.026, e.zc)).blend(0.006).bump(0.002, 50, 'noise'),
    gm(S.box(ch.side * 1.25, 0.1 * k, 0.05, 0.016).at(0, G.chestY + 0.012, ch.front - 0.012)).blend(0.006).bump(0.002, 50, 'noise'),
    tqm(S.torus(P.rNeck * 1.9, 0.01).at(0, T - 0.004, e.zc)).paint(0.003, 0.002), tqm(S.torus(G.sx * 0.78, 0.008).at(0, T - 0.03, e.zc)).paint(0.003, 0.002),
    pbox(tqm, ch.side * 1.25, 0.008, [0, G.chestY + 0.012 - 0.044 * k, ch.front], 0.002, 0.2),
  ]);
  const cz = ch.front + 0.02;
  G.add('torso', [], [
    gm(H.extrude(SHAPES.sun.map(([x, y]) => [x * 0.05 * k, y * 0.05 * k]), 0.006, 0.002)).at(0, G.chestY + 0.014, cz),
    gm(H.sphere(0.024 * k, 12), tone(g, 0, 0, 0.08)).scale(1, 1, 0.45).at(0, G.chestY + 0.014, cz + 0.004).lod(1),
    tqm(H.torus(0.026 * k, 0.004, 14, 5)).at(0, G.chestY + 0.014, cz + 0.006).lod(1),
  ]);
  // belt, loincloth, a fringe of feathers
  const y = 0.045 * k, we = G.tp(y);
  G.add('torso', [gm(G.band(y, 0.042, 0.7)).paint(0.004, 0.007), tqm(G.band(y, 0.01, 0.7)).paint(0.003, 0.008)], [
    gm(H.cyl(0.03 * k, 0.03 * k, 0.01, 12)).rot(90, 0, 0).at(0, y, we.front + 0.014).lod(1), tqm(H.sphere(0.013 * k, 8)).scale(1, 1, 0.5).at(0, y, we.front + 0.02).lod(1),
  ]);
  const sk = skirt(G, { mat: (x) => cloth(x, c), len: 0.1, flare: 0.03, top: 0.025, fold: 0.004, hem: { color: g, h: 0.012, metal: 0.8, rough: 0.4 } });
  if (sk) {
    const ring = hemRing({ ...sk, rHem: sk.rTop + 0.006 }, 0), fl = [];
    for (let i = 0; i < 14; i++) { const a = ((i + 0.5) / 14) * Math.PI * 2, q = ring(a); if (Math.abs(Math.sin(a)) < 0.3) continue; fl.push(feather([q[0], sk.y1 - 0.03, q[1]], [Math.sin(a) * 0.28, -1, Math.cos(a) * 0.28], 0.15 + (i % 2) * 0.02, 0.045, [Math.sin(a), 0.3, Math.cos(a)], fc[i % 3]).lod(i % 2 ? 1 : 99)); }
    G.add('root', [], [fl, flap(G, sk, 1, { color: c, len: 0.27, w: 0.1, trim: g, ragged: 0.0 }), flap(G, sk, -1, { color: c, len: 0.24, w: 0.11, trim: g, ragged: 0.0 })]);
  }
  // bands on arms and legs
  const band = (r, yy, h = 0.03) => [gm(G.band(yy, h, r * 3)).paint(0.003, 0.006), tqm(G.band(yy, h * 0.3, r * 3)).paint(0.002, 0.007)];
  G.lr('arm', band(P.rUpper, -P.upper * 0.5));
  G.lr('fore', [...band(P.rFore, -P.fore * 0.74, 0.05)]);
  const cf = (s) => [0, 1, 2, 3, 4].map((i) => { const a = (i - 2) * 0.6 + (s > 0 ? 1.57 : -1.57); return feather([Math.sin(a) * P.rCalf * 1.1, -P.shin * 0.2, Math.cos(a) * P.rCalf * 1.1], [Math.sin(a) * 0.4, -1, Math.cos(a) * 0.4], 0.075, 0.035, [Math.sin(a), 0.3, Math.cos(a)], fc[i % 3]).lod(1); });
  G.add('shinL', band(P.rCalf, -P.shin * 0.16, 0.034), cf(1)); G.add('shinR', band(P.rCalf, -P.shin * 0.16, 0.034), cf(-1));
  barefoot(G);
  G.lr('shin', [leather(G.band(-P.shin * 0.92, 0.012, P.rCalf * 3), 0x5a3a22).paint(0.003, 0.004), leather(S.box(0.3, 0.012, 0.6, 0.003).at(0, -P.shin - P.footH + 0.005, 0.05), 0x5a3a22).paint(0.003, 0.004), leather(S.box(0.3, 0.1, 0.014, 0.003).at(0, -P.shin - P.footH + 0.03, P.footLen * 0.45), 0x5a3a22).paint(0.003, 0.003)]);
  // the banner: a staff strapped to the back, a small cloth with the sun, a spray of feathers
  const top = T + P.neck + R * 2 * P.headLen + R * 2.4, zb = -(G.tp(T * 0.6).back + 0.022), bw = 0.16, bh = 0.15;
  const bn = [
    wood(H.cyl(0.007, 0.008, top - T * 0.25, 6), 0x7a5a36).at(0, (top + T * 0.25) / 2, zb),
    wood(H.cyl(0.005, 0.005, bw + 0.02, 5), 0x7a5a36).rot(0, 0, 90).at(0, top - 0.03, zb).lod(1),
    cloth(H.geo(surfaceGeo([0, 0.1, 0.9, 1], [0, 0.1, 0.5, 0.86, 1], (u, v) => [(u - 0.5) * bw, top - 0.03 - v * bh - (v > 0.99 ? 0.03 * Math.abs(Math.sin(u * 9.5)) : 0), zb - 0.006 - Math.sin(v * 3) * 0.012])), c).shade((x, yy, z, nx, ny, nz, i) => { const ci = i % 4, ri = Math.floor(i / 4); return ci === 0 || ci === 3 || ri === 0 || ri >= 3 ? g : null; }),
    gm(H.extrude(SHAPES.sun.map(([x, yy]) => [x * 0.04, yy * 0.04]), 0.004, 0.001)).at(0, top - 0.03 - bh * 0.45, zb - 0.018).lod(1),
    leather(H.box(0.03, 0.02, 0.02, 0.004), 0x5a3a22).at(0, T * 0.5, zb + 0.008).lod(1),
  ];
  for (let i = -3; i <= 3; i++) bn.push(feather([i * 0.004, top - 0.03, zb], [Math.sin(i * 0.42), Math.cos(i * 0.42), -0.05], 0.13 - Math.abs(i) * 0.012, 0.045, [0, 0, 1], fc[(i + 3) % 3]).lod(Math.abs(i) % 2 ? 1 : 99));
  G.add('torso', [leather(S.box(0.022, T * 2.2, 1, 0.003).rot(0, 0, 30).at(0, T * 0.55, 0), 0x5a3a22).paint(0.004, 0.005), leather(S.box(0.022, T * 2.2, 1, 0.003).rot(0, 0, -30).at(0, T * 0.55, 0), 0x5a3a22).paint(0.004, 0.005)], bn);
  // ear spools
  G.add('head', [], [-1, 1].flatMap((s) => [tqm(H.cyl(R * 0.17, R * 0.17, R * 0.14, 10)).rot(0, 0, 90).at(s * R * 1.0, -R * 0.14, R * 0.0).lod(1), gm(H.torus(R * 0.17, R * 0.04, 10, 5)).rot(0, 90, 0).at(s * R * 1.07, -R * 0.14, R * 0.0).lod(1)]));
  if (G.bare) return;
  // headdress: a gold cap, the sun's rays standing over the brow, tall plumes behind
  const hs = helmShell(G, 'cap', gm, { sy: G.Lk, y: 0.1 });
  const rays = []; for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI, r = i % 2 ? 1.0 : 1.75; rays.push([Math.cos(a) * r, Math.sin(a) * r * 1.05]); }
  const hh = [hs.hard, hs.place(tqm(H.torus(1.08, 0.05, 26, 6)).rot(90, 0, 0).rot(-6, 0, 0).at(0, 0.44, 0)).lod(1),
    gm(H.extrude(rays.map(([x, yy]) => [x * R, yy * R]), 0.006, 0.002)).rot(-10, 0, 0).at(0, R * 0.62 * G.Lk, R * 0.2),
    gm(H.sphere(R * 0.3, 10), tone(g, 0, 0, 0.08)).scale(1, 1, 0.4).at(0, R * (0.62 * G.Lk + 0.36), R * 0.16).lod(1), tqm(H.torus(R * 0.32, R * 0.05, 12, 5)).rot(-10, 0, 0).at(0, R * (0.62 * G.Lk + 0.36), R * 0.17).lod(1)];
  for (let i = -3; i <= 3; i++) hh.push(feather([i * R * 0.2, R * 0.8 * G.Lk, -R * 0.35], [Math.sin(i * 0.3), 1, -0.3], R * (2.7 - Math.abs(i) * 0.3), R * 0.42, [0, 0.2, 1], fc[(i + 3) % 3]).lod(Math.abs(i) % 2 ? 1 : 99));
  G.add('head', [], hh);
};
HEADGEAR.sunGold = true;

// ---- Musketeer of the old guard: a long belted kaftan with braid across the chest, fur at collar, cuff and hem, a tall fur hat ----
OUTFITS.streltsy = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, trim = G.trim, fur = G.o.fur ?? 0x3e2e22, dk = tone(c, 0, 0.02, -0.1);
  const km = (x) => cloth(x, c), fm = furM(fur, 0.008, 38);
  G.add('torso', [torsoLayer(G, km, { raise: 0.003 }), ...torsoShells(G, km, { grow: 0.014, blend: 0.03 }), pbox((x) => cloth(x, dk), 0.008, T, [0, T * 0.48, 0.25], -0.003, 0.5)]);
  // frogging: bars of braid with a button at the middle and a tassel at each end
  const f = G.field('torso'), bars = [], btn = [];
  for (let i = 0; i < 5; i++) {
    const y = T * 0.86 - i * 0.047 * k, wd = G.cw * (1.0 - i * 0.07);
    bars.push(pbox((x) => gold(x, trim), wd, 0.014, [0, y, 0.25], 0.004, 0.5));
    for (const s of [-1, 0, 1]) btn.push([s * wd * 0.5, y, 0.6]);
  }
  G.add('torso', bars, studs(G, 'torso', btn, { field: f, dir: [0, 0, -1], r: 0.0075, color: trim, lod: 1 }));
  G.add('torso', [fm(S.torus(P.rNeck * 1.62, 0.024).at(0, T + 0.012, -0.004)).blend(0.006)]);
  const sa = sash(G, 0.06 * k, c2, { h: 0.05, deg: -42, len: 0.15, fringe: trim });
  G.add('torso', sa.prims, sa.hard);
  // bandolier of powder charges
  const ba = Math.atan2(G.sx * 0.9 + G.tp(0.06).side * 0.9, T * 0.82), ch = [];
  for (let i = 0; i < 6; i++) { const t = 0.3 + i * 0.085, x = lerp(-1, 1, t) * Math.sin(ba) * T * 0.62 * -1, y = T * 0.5 + lerp(-1, 1, t) * Math.cos(ba) * T * 0.62 - 0.0, p = trace(f, [x, y, 0.6], [0, 0, -1]); if (p) ch.push(wood(H.cyl(0.008, 0.008, 0.04, 6), 0x7a5a36).at(p[0], p[1] - 0.03, p[2] + 0.012).lod(1), gold(H.cyl(0.009, 0.009, 0.008, 6), BRASS).at(p[0], p[1] - 0.008, p[2] + 0.012).lod(1)); }
  G.add('torso', [], ch.slice(0, 0));
  const len = Math.min(0.37, P.hipY - 0.15);
  const sk = skirt(G, { mat: km, top: 0.03, len, flare: 0.08, fold: 0.008, foldFreq: 11, hem: { color: fur, h: 0.034 } });
  if (sk) G.add('root', [pbox((x) => cloth(x, 0x1a1512), 0.008, len, [0.022, sk.y1 - len / 2, sk.zc + 0.4], -0.003, 0.8), pbox((x) => gold(x, trim), 0.008, len, [0.034, sk.y1 - len / 2, sk.zc + 0.4], 0.002, 0.8), pbox((x) => gold(x, trim), 0.008, len, [0.01, sk.y1 - len / 2, sk.zc + 0.4], 0.002, 0.8),
    furM(fur, 0.007, 38)(S.torus(sk.rHem + sk.ox * 0.5, 0.016).at(0, sk.y1 - len + 0.014, sk.zc)).paint(0.004, 0.004)]);
  G.lr('arm', sleeve(G, km, { grow: 1.1, bump: [0.002, 20, 'fur'] }));
  G.lr('fore', [km(S.cyl(P.rFore * 3, P.fore * 1.14, 0).at(0, -P.fore * 0.45, 0)).paint(0.005, 0.003), fm(S.cyl(P.rFore * 1.5, 0.04, 0.012).at(0, -P.fore * 0.84, 0)).blend(0.005), glove(G, (x) => leather(x, 0x4a3020))]);
  const bootC = mix(c2, 0x6a4a2a, 0.4);
  hose(G, (x) => cloth(x, dk)); boots(G, { top: 0.8, color: bootC, cuff: 0.05 });
  G.cores('arm', c); G.cores('fore', c); G.cores('leg', dk); G.cores('shin', bootC);
  if (G.bare) return;
  G.add('head', [
    km(S.cone(R * 0.98, R * 0.6, R * 1.7 * G.Lk, R * 0.2).rot(-9, 0, 0).at(0, R * (0.52 + 0.82 * G.Lk), -R * 0.2)).blend(0.004),
    km(rod([0, R * (0.6 + 1.5 * G.Lk), -R * 0.36], [0, R * (0.6 + 1.2 * G.Lk), -R * 1.1], R * 0.44, R * 0.16)).blend(0.05),
    fm(S.torus(R * 0.92, R * 0.3).at(0, R * (0.2 + 0.36 * G.Lk), -R * 0.07)).blend(0.004),
  ], [gold(H.sphere(R * 0.11, 8), trim).scale(1, 1, 0.5).at(0, R * (0.52 + 0.4 * G.Lk), R * 0.78).lod(1), gold(H.sphere(R * 0.1, 6), trim).at(0, R * (0.6 + 1.16 * G.Lk), -R * 1.22).lod(1)]);
};
HEADGEAR.streltsy = true;

// ---- Winged hussar: cuirass and tassets, a leopard skin over one shoulder, two tall wings of feathers ----
SHELLS.lobster = { f: [[0, 1.12], [0.5, 1.04], [0.86, 0.78], [1.03, 0.52], [1.12, 0.42], [1.46, 0.34]], s: [[0, 1.12], [0.5, 1.04], [0.86, 0.76], [1.03, 0.44], [1.06, 0.24], [1.1, 0.14]], b: [[0, 1.12], [0.5, 1.04], [0.9, 0.74], [1.07, 0.3], [1.16, -0.32], [1.52, -0.98]] };
OUTFITS.hussar = (G) => {
  const { T, k, P, R } = G, c = G.cloth, steelC = G.armor, trim = G.trim, fc = G.o.cloth2 ?? 0xf2efe6, pelt = 0xc08a44, spot = 0x2a1e14;
  const st = (x) => steel(x, steelC), cm = (x) => cloth(x, c);
  G.add('torso', [torsoLayer(G, cm, { raise: 0.003 })]);
  armPaint(G, (x) => mail(x, tone(steelC, 0, -0.02, -0.22)), 0.002);
  const cu = cuirass(G, steelC, { trim, fauld: 3 });
  G.add('torso', cu.prims, cu.hard);
  const f = G.field('torso');
  G.add('torso', [], [decal(G, 'torso', 'cross', { field: f, at: [0, G.chestY + 0.004, 0], size: 0.036 * k, color: trim, rough: 0.3, metal: 1 }),
    ...studs(G, 'torso', [-1, 1].map((s) => [s * G.cw * 0.5, T - 0.085 * k, 0.6]), { field: f, dir: [0, 0, -1], r: 0.011, color: trim, lod: 1 })]);
  // the pelt: over the left shoulder and across the back, a paw hanging in front
  const a = Math.atan2(G.sx * 1.6, T) / DEG, fm = furM(pelt, 0.008, 34), spots = [], r2 = rng(hashStr(G.id + ':spots'));
  for (let i = 0; i < 30; i++) { const t = r2() * 1.7 - 0.85, off = (r2() - 0.5) * 0.12 * k, ca = Math.cos(a * DEG), sa2 = Math.sin(a * DEG); spots.push(fin(S.sphere(0.008 + r2() * 0.006).at(0.02 + sa2 * t * T * 0.9 + ca * off, T * 0.5 + ca * t * T * 0.9 - sa2 * off, 0), spot, 0.9, 0).scale(1)); }
  G.add('torso', [
    fm(S.box(0.16 * k, T * 2.4, 1, 0.01).rot(0, 0, -a).at(0.02, T * 0.5, 0)).paint(0.006, 0.008),
    fm(S.ellipsoid(0.085 * k, 0.05 * k, G.cd * 1.15).at(G.sx - 0.06, T - 0.008, -0.01)).blend(0.014),
    ...spots.map((x) => { const e = x.m.elements; return fin(S.cyl(0.0075, 1, 0).rot(90, 0, 0).at(e[12], e[13], 0), spot, 0.9, 0).paint(0.003, 0.0085); }),
    fm(rod([-G.tp(0.1 * k).side * 0.8, 0.1 * k, G.tp(0.1 * k).front * 0.8], [-G.tp(0.1 * k).side * 0.9, 0.0, G.tp(0.02).front * 0.9 + 0.02], 0.024, 0.018)).blend(0.01),
  ]);
  const b = belt(G, 0.058 * k, { h: 0.026, color: DARK_LEATHER, raise: 0.004, buckleColor: trim });
  G.add('torso', b.prims, [b.hard, scabbard(G, 0.058 * k, { len: 0.34, color: 0x2a2018, metal: trim })]);
  skirt(G, { mat: cm, len: 0.15, flare: 0.045, top: 0.01, fold: 0.005, hem: { color: trim, rough: 0.5, metal: 0.7 } });
  const pa = plateArm(G, steelC, { trim, pauldron: 1.0, lames: 2 });
  G.lr('arm', pa.arm, pa.armH); G.lr('fore', pa.fore, pa.foreH);
  hose(G, cm);
  const pl = plateLeg(G, steelC, { trim, greave: false, sabaton: false });
  G.lr('leg', pl.leg, pl.legH);
  const bootC = 0x9a742e;
  boots(G, { top: 0.88, color: bootC, cuff: 0.06 });
  G.cores('arm', steelC); G.cores('fore', steelC); G.cores('leg', steelC); G.cores('shin', bootC);
  // the wings: a painted frame rising from the backplate, curling over the head, a feather in every socket
  const zb = -(G.tp(T * 0.5).back + 0.03), top = T + P.neck + R * 2 * P.headLen, wh = [];
  for (const s of [-1, 1]) {
    const x0 = s * 0.075 * k;
    const ctl = [[x0, T * 0.3, zb], [x0 * 1.3, T * 0.8, zb - 0.03], [x0 * 1.6, top - 0.02, zb - 0.05], [x0 * 1.75, top + 0.17, zb - 0.02], [x0 * 1.65, top + 0.26, zb + 0.06], [x0 * 1.5, top + 0.26, zb + 0.13]];
    wh.push(wood(H.tube(ctl, 0.01, 16, 5), c));
    const n = 15, fcols = [0x8a8474, fc, tone(fc, 0, 0, -0.34)];
    const at = (t) => spline(ctl, t);
    // feathers stand out from the frame, back and to the side, square to it all the way round the curl
    const outAt = (t) => { const p = at(t), q = at(Math.min(1, t + 0.02)), tan = norm3(sub3(q, p)), b0 = [s * 0.78, 0.12, -0.62], d = b0[0] * tan[0] + b0[1] * tan[1] + b0[2] * tan[2]; return { p, tan, out: norm3(sub3(b0, mul3(tan, d))) }; };
    for (let i = 0; i < n; i++) {
      const t = 0.14 + (i / (n - 1)) * 0.86, q = outAt(t);
      const nrm = [q.tan[1] * q.out[2] - q.tan[2] * q.out[1], q.tan[2] * q.out[0] - q.tan[0] * q.out[2], q.tan[0] * q.out[1] - q.tan[1] * q.out[0]];
      wh.push(feather(q.p, q.out, 0.21 - t * 0.06, 0.075, nrm, fcols).near());
    }
    wh.push(cloth(H.geo(surfaceGeo(1, 5, (u, v) => { const t = 0.14 + v * 0.86, q = outAt(t); return add3(q.p, mul3(q.out, u * (0.19 - t * 0.05))); })), fc).far());
    wh.push(leather(H.box(0.024, 0.03, 0.03, 0.004), DARK_LEATHER).at(x0, T * 0.34, zb + 0.012).lod(1), leather(H.box(0.024, 0.03, 0.03, 0.004), DARK_LEATHER).at(x0 * 1.1, T * 0.8, zb - 0.012).lod(1));
  }
  G.add('torso', [], wh);
  if (G.bare) return;
  dropEars(G);
  G.add('head', cheekPlates(G, st));
  const hs = helmShell(G, 'lobster', st, { sy: G.Lk, comb: 0.03, tilt: -3 });
  G.add('head', [], [
    hs.hard,
    ...[0, 1, 2].map((i) => hs.place(fin(H.torus(1.2 + i * 0.12, 0.022, 14, 4, Math.PI * 0.9), tone(steelC, 0, 0, -0.2), 0.4, 0.9).rot(0, 0, 180 + 9).rot(90, 0, 0).rot(-34 - i * 3, 0, 0).at(0, -0.2 - i * 0.24, -0.14 - i * 0.02)).lod(1)),
    hs.place(st(H.box(0.09, 1.25, 0.05, 0.02)).rot(-5, 0, 0).at(0, -0.12, 1.3)).lod(1),
    hs.place(gold(H.extrude(SHAPES.lozenge.map(([x, y]) => [x * 0.22, y * 0.22]), 0.04, 0.01), trim).at(0, -0.72, 1.36)).lod(1),
    hs.place(gold(H.box(0.2, 0.16, 0.08, 0.03), trim).at(0, 0.44, 1.34)).lod(1),
    ...[-1, 1].map((s) => hs.place(gold(H.geo(domeGeo()).scale(0.08).rot(0, 0, -90 * s).at(s * 1.04, 0.22, 0.16), trim)).lod(0)),
  ]);
};
HEADGEAR.hussar = true;

/** an ice crystal: a six-sided shard */
function crystal(pos, dir, len, r, c = 0xbfe6f5) {
  const d = norm3(dir);
  return [orient(gem(H.cone(r, len * 0.72, 6), c, 0.35), add3(pos, mul3(d, len * 0.64)), d), orient(gem(H.cone(r, len * 0.28, 6), tone(c, 0, 0, -0.08), 0.35), add3(pos, mul3(d, len * 0.14)), mul3(d, -1))];
}
// ---- Winter boyarina: a robe of stiff brocade, a collar higher than her ears, ice for jewels ----
OUTFITS.brocade = (G) => {
  const { T, k, P, R } = G, c = G.cloth, trim = G.trim, ice = G.o.gem ?? 0xbfe6f5, fur = 0xf0eee8, lt = tone(c, 0, -0.06, 0.12);
  const bm = (x) => fin(x, c, 0.6, 0.12, 0.08, 30), tm = (x) => gold(x, trim);
  const sk = robe(G, c, { mat: bm, bell: 1.7, flare: 0.13, fold: 0.005, cuff: trim, hem: { color: fur, h: 0.036 }, shoe: tone(c, 0, 0, -0.1), panel: { mat: (x) => fin(x, lt, 0.6, 0.12), w: 0.3, raise: 0.003, trim } });
  // the brocade: a lattice of metal thread
  const lat = (n, h, yc, sp) => { const out = []; for (let i = -n; i <= n; i++) for (const s of [-1, 1]) out.push(tm(S.box(0.005, h * 1.6, 1.2, 0).rot(0, 0, s * 38).at(i * sp, yc, 0)).paint(0.002, 0.0012)); return out; };
  G.add('torso', [...lat(3, T, T * 0.5, 0.062 * k), pbox((x) => cloth(x, fur), 0.036, T * 1.04, [0, T * 0.47, 0.25], 0.006, 0.5), tm(G.band(0.058 * k, 0.03)).paint(0.003, 0.007)]);
  if (sk) G.add('root', lat(4, sk.len, sk.y1 - sk.len / 2, 0.075));
  G.add('torso', mantle(G, furM(fur, 0.008, 40), { drop: 0.042, reach: 0.02 }));
  // the collar stands up behind the head
  const rn = P.rNeck, ch = R * 2.3;
  const colFn = (u, v) => { const a = (u - 0.5) * 4.3, t = 0.5 + 0.5 * Math.cos(a / 1.25), r = rn * 1.8 + v * (0.035 + 0.05 * t); return [Math.sin(a) * r * 1.25, T + 0.005 + v * ch * (0.3 + 0.7 * t), -Math.cos(a) * r - 0.012 - v * 0.03 * t]; };
  const us = [0, 0.04, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.96, 1], vs = [0, 0.3, 0.6, 0.9, 0.94, 1];
  const ez = G.tp(0.058 * k).front, cr = [];
  for (const s of [-1, 1]) { cr.push(crystal([s * (G.sx - 0.03), T + 0.02, -0.01], [s * 0.4, 1, -0.1], 0.085, 0.014, ice), crystal([s * (G.sx + 0.01), T + 0.01, 0.01], [s * 0.9, 0.7, 0.2], 0.06, 0.011, ice).map((h) => h.lod(1)), crystal([s * (G.sx - 0.06), T + 0.025, -0.03], [s * 0.1, 1, -0.4], 0.06, 0.01, ice).map((h) => h.lod(1))); }
  G.add('torso', [bm(S.cone(rn * 2.0, rn * 1.5, 0.04, 0.008).at(0, T + 0.012, -0.006)).blend(0.006)], [
    fin(H.geo(surfaceGeo(us, vs, colFn)), c, 0.6, 0.12).shade((x, y, z, nx, ny, nz, i) => { const ci = i % us.length, ri = Math.floor(i / us.length); return ri >= 4 || ci < 2 || ci >= us.length - 2 ? trim : ri === 2 && ci % 2 ? lt : null; }),
    cr, gem(H.box(0.03, 0.03, 0.012, 0.008), ice, 0.35).rot(0, 0, 45).at(0, 0.058 * k, ez + 0.016).lod(1), tm(H.box(0.044, 0.044, 0.008, 0.004)).rot(0, 0, 45).at(0, 0.058 * k, ez + 0.01).lod(1),
  ]);
  G.lr('fore', [furM(fur, 0.007, 40)(S.cyl(P.rFore * 2.0, 0.03, 0.01).at(0, -P.fore * 0.9, 0)).blend(0.005)]);
  if (G.bare) return;
  // kokoshnik: a tall rounded crown plate over a close cap, a veil behind, strings of pearls at the temples
  hoodShell(G, bm, { grow: 0.05, open: [0.72, 0.86], oy: -0.2, neck: false });
  const kn = 16, krs = [0.08, 0.5, 0.56, 0.6, 0.86, 0.9, 1];
  const hh = [
    fin(H.geo(fanGeo(Math.PI * 1.04, -Math.PI * 0.04, kn, krs, () => R)), c, 0.55, 0.15).shade((x, y, z, nx, ny, nz, i) => { const ri = Math.floor(i / (kn + 1)), ci = i % (kn + 1); return ri >= 5 ? trim : ri === 2 || ri === 3 ? 0xf4f2ec : ri === 4 && ci % 2 ? lt : null; }).scale(1.32, 1.75 * G.Lk, 1).rot(-14, 0, 0).at(0, R * 0.46, R * 0.2).near(),
    fin(H.geo(fanGeo(Math.PI * 1.04, -Math.PI * 0.04, 5, [0.08, 1], () => R)), c, 0.55, 0.15).scale(1.32, 1.75 * G.Lk, 1).rot(-14, 0, 0).at(0, R * 0.46, R * 0.2).far(),
    gem(H.box(R * 0.3, R * 0.3, R * 0.1, R * 0.06), ice, 0.4).rot(0, 0, 45).rot(-14, 0, 0).at(0, R * (0.36 + 0.75 * G.Lk), R * 0.1).lod(1),
    hang([0, R * 0.6, -R * 1.06], R * 1.1, R * 2.3, lt, { yaw: 180, taper: -0.4, wave: 0.04, out: 0.06, lod: 99, nv: 5, shade: (x, y) => (y < -R * 2.0 || Math.abs(x) > R * 0.62 ? 0xf2f0ea : null) }),
  ];
  for (let i = -2; i <= 2; i++) { const a = Math.PI / 2 - i * 0.5; hh.push(...crystal([Math.cos(a) * R * 1.28, R * (0.44 + Math.sin(a) * 1.7 * G.Lk), R * (0.2 - Math.sin(a) * 0.42)], [Math.cos(a), Math.sin(a) * 1.2, -0.25], R * (0.75 - Math.abs(i) * 0.14), R * 0.1, ice).map((h) => h.lod(i % 2 ? 1 : 99))); }
  for (const s of [-1, 1]) hh.push(chain([[s * R * 1.0, R * 0.36, R * 0.3], [s * R * 1.04, -R * 0.3, R * 0.34], [s * R * 0.98, -R * 0.95, R * 0.36]], R * 0.045, 0xf2f0ea, { metal: 0.2, rough: 0.3 }), gem(H.sphere(R * 0.09, 6), ice).at(s * R * 0.98, -R * 1.02, R * 0.36).lod(1));
  G.add('head', [], hh);
};
HEADGEAR.brocade = true;

/** part of a lathed surface: an arc of `span` radians centred behind the head */
function arcLathe(key, prof, span, seg = 14) { return cached(`arc:${key}:${seg}`, () => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg, Math.PI - span / 2, span)); }

// ---- Eastern soldier: lacquered lamellar laced with coloured cord. variant: celestial | samurai | ashigaru ----
OUTFITS.lamellar = (G) => {
  const { T, k, P, R } = G, v = G.variant === 'samurai' || G.variant === 'ashigaru' ? G.variant : 'celestial';
  const lac = G.o.armor ?? 0x7a1a16, cord = G.cloth, silkC = G.c2, trim = G.trim, uc = tone(cord, 0, -0.12, -0.2), dark = 0x1a1512;
  const lm = (x) => fin(x, lac, 0.3, 0.3, 0.06, 30), cm = (x) => cloth(x, cord), um = (x) => cloth(x, uc);
  G.add('torso', [torsoLayer(G, um, { raise: 0.003 })]);
  armPaint(G, um);
  const g = 0.014;
  if (v === 'ashigaru') {
    G.add('torso', [...torsoShells(G, lm, { grow: g, blend: 0.004, hips: false }), pbox((x) => fin(x, dark, 0.5, 0.2), 1, 0.006, [0, 0.19 * k, 0], -0.002), pbox((x) => fin(x, dark, 0.5, 0.2), 1, 0.006, [0, 0.11 * k, 0], -0.002), pbox(cm, 0.01, T * 0.5, [0, T * 0.45, 0.25], 0.002, 0.5)]);
    G.add('torso', [], [decal(G, 'torso', 'disc', { at: [0, G.chestY, 0], size: 0.034 * k, color: trim, rough: 0.4, metal: 0.8 })]);
  } else {
    const rows = [];
    for (let i = 0; i < 7; i++) { const y = T - 0.045 * k - i * 0.034 * k; rows.push(lm(G.shell(y, 0.03 * k, g + (i % 2) * 0.0025, g + 0.003 + (i % 2) * 0.0025)).blend(0.0025)); }
    rows.push(lm(S.capsule([-(G.sx - 0.05), T - 0.04, -0.006], [G.sx - 0.05, T - 0.04, -0.006], 0.034 * k + g * 0.7)).blend(0.01));
    for (let i = -4; i <= 4; i++) rows.push(pbox(cm, 0.007, T * 0.72, [i * G.cw * 0.21, T * 0.5, 0], 0.0015));
    rows.push(pbox(cm, 1, 0.012, [0, T - 0.062 * k, 0], 0.002), pbox((x) => gold(x, trim), 1, 0.008, [0, 0.085 * k, 0], 0.002));
    G.add('torso', rows);
  }
  const sa = sash(G, 0.05 * k, silkC, { h: 0.058, deg: -38, len: 0.2, fringe: trim, mat: silk });
  G.add('torso', sa.prims, sa.hard);
  // skirt plates hung on cords
  const sk = skirt(G, { mat: lm, len: v === 'ashigaru' ? 0.13 : 0.18, flare: 0.055, top: 0.02, fold: 0, hem: { color: cord, h: 0.012 }, grow: 0.014 });
  if (sk) {
    const pr = [];
    for (let i = 1; i < 5; i++) pr.push(pbox((x) => fin(x, dark, 0.5, 0.2), 1.4, 0.005, [0, sk.y1 - (sk.len * i) / 5, 0], -0.002, 1.4));
    for (let i = 0; i < 6; i++) { const a = ((i + 0.5) / 6) * Math.PI * 2; pr.push(fin(S.box(0.012, sk.len * 0.92, 0.3, 0).rot(0, a / DEG, 0).at(Math.sin(a) * (sk.rHem + sk.ox), sk.y1 - sk.len * 0.56, sk.zc + Math.cos(a) * sk.rHem), dark, 0.9, 0).paint(0.002, -0.005)); }
    if (v !== 'ashigaru') for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; pr.push(cm(S.box(0.007, sk.len * 0.9, 0.3, 0).rot(0, a / DEG, 0).at(Math.sin(a) * (sk.rHem + sk.ox), sk.y1 - sk.len * 0.5, sk.zc + Math.cos(a) * sk.rHem)).paint(0.002, 0.0015)); }
    G.add('root', pr);
  }
  // arms
  const r = P.rUpper, U = P.upper, rf = P.rFore, F = P.fore, sleeveC = v === 'ashigaru' ? uc : silkC;
  G.lr('arm', sleeve(G, (x) => cloth(x, sleeveC), { grow: 1.08, end: 0.95 }));
  if (v === 'samurai') {
    const sode = [lm(S.box(r * 0.75, U * 0.98, r * 3.9, r * 0.2).rot(0, 0, -7).at(r * 1.45, -U * 0.3, 0)).blend(0.003)];
    for (let i = 0; i < 5; i++) sode.push(pbox(i === 0 ? (x) => gold(x, trim) : cm, r * 1.3, 0.008, [r * 1.55, U * 0.12 - i * U * 0.2, 0], 0.0015, r * 4.2));
    for (let i = -2; i <= 2; i++) sode.push(pbox(cm, r * 1.3, U * 0.9, [r * 1.6, -U * 0.3, i * r * 0.75], 0.001, 0.006));
    G.lr('arm', sode);
  } else if (v === 'celestial') {
    const pa = plateArm(G, lac, { mat: lm, pauldron: 0.95, lames: 2, upper: false, couter: false, fore: false, trimMat: cm, rivet: trim });
    G.lr('arm', pa.arm, pa.armH);
  }
  if (v === 'ashigaru') G.lr('fore', [cloth(S.cyl(rf * 3, F * 1.14, 0).at(0, -F * 0.45, 0), uc).paint(0.005, 0.003), ...wraps(rf, [-F * 0.5, -F * 0.64, -F * 0.78, -F * 0.92], tone(uc, 0, 0, 0.12), 0.012, 0.003)]);
  else G.lr('fore', [cloth(S.cyl(rf * 3, F * 1.14, 0).at(0, -F * 0.45, 0), uc).paint(0.005, 0.003), ...[-1, 0, 1].map((i) => lm(S.box(rf * 0.52, F * 0.62, 1, 0.004).at(i * rf * 0.72, -F * 0.52, 0)).paint(0.003, 0.005)), (v === 'samurai' ? (x) => gold(x, trim) : cm)(G.band(-F * 0.84, 0.012, rf * 3)).paint(0.003, 0.006), glove(G, um)]);
  // legs: full trousers, splinted shins
  const tr = v === 'ashigaru' ? uc : tone(silkC, 0, -0.08, -0.08), rc = P.rCalf;
  hose(G, (x) => cloth(x, tr), { raise: 0.004 });
  G.lr('leg', [cloth(S.capsule([0, -P.thigh * 0.1, 0], [0, -P.thigh * 0.8, 0], P.rThigh * 1.22, P.rThigh * 1.16), tr).blend(0.02).bump(0.003, 16, 'fur')]);
  if (v === 'ashigaru') G.lr('shin', wraps(rc, [-P.shin * 0.3, -P.shin * 0.44, -P.shin * 0.58, -P.shin * 0.72, -P.shin * 0.86], tone(uc, 0, 0, 0.12), 0.016, 0.004));
  else G.lr('shin', [...[-1, 0, 1].map((i) => lm(S.box(rc * 0.56, P.shin * 0.66, 1, 0.004).at(i * rc * 0.74, -P.shin * 0.5, 0)).paint(0.003, 0.005)), cm(G.band(-P.shin * 0.2, 0.012, rc * 3)).paint(0.003, 0.006), cm(G.band(-P.shin * 0.8, 0.012, rc * 3)).paint(0.003, 0.006)]);
  boots(G, { top: 0.1, color: 0x2a2018, cuff: 0.02 });
  G.cores('arm', sleeveC); G.cores('fore', v === 'ashigaru' ? uc : lac); G.cores('leg', tr); G.cores('shin', v === 'ashigaru' ? uc : lac);
  if (G.bare) return;
  const lh = (h) => fin(h, lac, 0.3, 0.3);
  if (v === 'ashigaru') {
    const hat = latheHat(G, 'jingasa', [[0, 1.0], [0.1, 1.02], [0.34, 0.9], [1.95, 0.3], [2.0, 0.25], [1.94, 0.23], [0.34, 0.8]], lh, { y: 0.14, tilt: -5 });
    G.add('head', [cloth(S.torus(R * 0.93, R * 0.09).rot(-8, 0, 0).at(0, R * 0.42, -R * 0.06), tone(cord, 0, 0, 0.05)).blend(0.004)], [hat.hard, hat.place(gold(H.cyl(0.26, 0.26, 0.02, 12), trim).rot(68, 0, 0).at(0, 0.62, 0.98)).lod(1), hat.place(gold(H.sphere(0.1, 6), trim).at(0, 1.03, 0)).lod(1),
      chain([[R * 0.9, R * 0.3, 0], [R * 0.8, -R * 0.6, R * 0.5], [0, -R * 1.0, R * 0.75], [-R * 0.8, -R * 0.6, R * 0.5], [-R * 0.9, R * 0.3, 0]], R * 0.03, cord, { metal: 0, rough: 0.9 })]);
    return;
  }
  // a neck curtain of lamellae under either helm
  hoodShell(G, (x) => lm(x).bump(0.004, 30, 'ridges'), { grow: 0.09, open: [0.74, 0.9], oy: -0.18 });
  if (v === 'celestial') {
    const hat = latheHat(G, 'spike', [[0, 2.0], [0.05, 1.82], [0.09, 1.56], [0.2, 1.4], [0.56, 1.06], [0.92, 0.7], [1.07, 0.42], [1.13, 0.36], [1.13, 0.3]], lh, { y: 0.1 });
    G.add('head', [], [hat.hard, hat.place(gold(H.torus(1.1, 0.05, 26, 6), trim).rot(90, 0, 0).at(0, 0.36, 0)).lod(1), hat.place(gold(H.sphere(0.13, 8), trim).at(0, 1.5, 0)).lod(1),
      hat.place(gold(H.box(0.3, 0.36, 0.06, 0.03), trim).at(0, 0.56, 1.02)).lod(1),
      plume(G, G.o.tassel ?? 0xc22a1e, { at: [0, R * (0.1 + 1.9 * G.Lk), 0], size: 0.72, n: 7 })]);
    return;
  }
  // kabuto: ribbed bowl, a wide neck guard, turn-backs, a gilded crest of horns
  const hs = helmShell(G, 'cap', lh, { sy: G.Lk, y: 0.12 });
  const hh = [hs.hard, hs.place(gold(H.sphere(0.12, 8), trim).scale(1, 0.6, 1).at(0, 1.1, 0)).lod(1), hs.place(lh(H.box(1.3, 0.05, 0.5, 0.02)).rot(14, 0, 0).at(0, 0.4, 1.12)).lod(1)];
  for (let i = 0; i < 6; i++) hh.push(hs.place(fin(H.torus(1.0, 0.022, 14, 4, Math.PI), tone(lac, 0, 0, 0.1), 0.3, 0.4).rot(0, i * 30, 0).scale(1.06, 1.1, 1.06)).lod(1));
  for (let i = 0; i < 3; i++) {
    const gk = arcLathe(`shikoro${i}`, [[1.08 + i * 0.16, 0.34 - i * 0.26], [1.36 + i * 0.2, 0.1 - i * 0.28], [1.4 + i * 0.2, 0.04 - i * 0.28]], Math.PI * 1.38);
    hh.push(hs.place(lh(H.geo(gk)).shade((x, y) => (y < 0.09 - i * 0.28 ? cord : null))).lod(i === 2 ? 99 : 1));
  }
  for (const s of [-1, 1]) {
    hh.push(hs.place(lh(H.box(0.5, 0.4, 0.05, 0.02)).rot(0, s * 50, 0).at(s * 1.2, 0.3, 0.72)).lod(1));
    hh.push(hs.place(gold(H.extrude([[0.1, 0], [0.42, 0.5], [0.62, 1.2], [0.6, 1.9], [0.86, 1.25], [0.72, 0.45], [0.3, -0.1]].map(([x, y]) => [s * x, y]), 0.03, 0.01), trim).rot(-10, 0, 0).at(0, 0.55, 1.06)));
  }
  hh.push(hs.place(gold(H.cyl(0.2, 0.2, 0.04, 12), trim).rot(80, 0, 0).at(0, 0.66, 1.1)).lod(1));
  G.add('head', [], hh);
};
HEADGEAR.lamellar = true;

/** points of a chain or thong lying on the front (dir -1 looks from +Z) or back of the torso between a and b, sagging by drop */
function drape(f, a, b, drop, n = 7, lift = 0.006, front = true) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t) - drop * 4 * t * (1 - t);
    const p = trace(f, [x, y, front ? 0.7 : -0.7], [0, 0, front ? -1 : 1], 1.4);
    out.push(p ? [p[0], p[1], p[2] + (front ? lift : -lift)] : [x, y, 0]);
  }
  return out;
}

// ---- Dread champion: a hulk of black iron, spiked and fluted, skulls swinging on chains, a cloak of pelts and bones ----
OUTFITS.dreadPlate = (G) => {
  const { T, k, P, R } = G, c = G.o.armor ?? 0x2a2a30, red = G.cloth, trim = G.o.trim ?? 0x8a7650, spikeC = tone(c, 0, 0, -0.06), furC = 0x2e2620, glow = G.o.glow ?? 0xe0341a;
  const im = (x) => fin(x, c, 0.5, 0.9, 0.22, 18), tm = (x) => fin(x, trim, 0.45, 0.9, 0.2, 30), sp = (h) => iron(h, spikeC);
  plateSuit(G, c, { mat: im, trimMat: tm, grow: 0.022, pauldron: 1.5, lames: 2, fauld: 3, underMat: (x) => cloth(x, 0x1a181c), under: 0x1a181c, rivet: trim, skirt: false });
  // fluting fanned over the breast, a grinning boss at the belt
  const ch = G.tp(G.chestY), f0 = G.field('torso');
  G.add('torso', [...[-2, -1, 1, 2].map((i) => tm(S.box(0.008, T * 0.44, 0.5, 0.002).rot(0, 0, i * 17).at(i * ch.side * 0.2, G.chestY - 0.012, 0.25)).paint(0.003, 0.003)), ...[-1, 1].map((s) => tm(S.box(0.008, T * 0.6, 0.5, 0.002).rot(0, 0, s * 20).at(s * ch.side * 0.3, T * 0.5, -0.25)).paint(0.003, 0.003))]);
  const y = 0.05 * k, e = G.tp(y);
  const b = belt(G, y, { h: 0.036, color: 0x241c16, buckle: false, raise: 0.004 });
  // skulls on chains: two swags across the chest, one hanging at the hip
  const f = G.field('torso'), sw1 = drape(f, [-G.sx * 0.8, T - 0.04], [G.sx * 0.8, T - 0.04], 0.085 * k, 8, 0.008), sw2 = drape(f, [-G.sx * 0.72, T - 0.06], [G.sx * 0.5, T - 0.2 * k], 0.04 * k, 7, 0.008);
  const hang1 = [sw1[2], sw1[4], sw1[6]].flatMap((p, i) => skull([p[0], p[1] - 0.026, p[2] + 0.014], i === 1 ? 0.026 : 0.02, (i - 1) * 16, 8));
  G.add('torso', b.prims, [chain(sw1, 0.0055, 0x55555c), chain(sw2, 0.0045, 0x4a4a50), hang1, skull([0, y, e.front + 0.05], 0.036, 0, 8),
    chain([[e.side + 0.02, y, 0.01], [e.side + 0.03, y - 0.06, 0.02], [e.side + 0.026, y - 0.11, 0.012]], 0.0045, 0x4a4a50), skull([e.side + 0.028, y - 0.135, 0.012], 0.024, 70, 0, 0xcfc59e),
    ...[-2, -1, 0, 1, 2].map((i) => orient(sp(H.cone(0.013, 0.07 - Math.abs(i) * 0.01, 6)), [i * 0.03, T + 0.035, -G.cd * 0.9 - 0.02 + Math.abs(i) * 0.014], [i * 0.25, 1, -0.7]).lod(1))]);
  // spikes everywhere a blow might land
  const r = P.rUpper, rf = P.rFore, F = P.fore, rc = P.rCalf;
  G.lr('arm', [im(S.ellipsoid(r * 1.0, r * 0.5, r * 1.9).rot(0, 0, -24).at(r * 1.5, r * 0.5, 0)).blend(0.004), tm(S.box(r * 0.4, r * 0.3, r * 4, 0.002).rot(0, 0, -24).at(r * 2.2, r * 0.2, 0)).paint(0.003, 0.003)],
    [spikes([[[r * 0.1, r * 1.5, 0], [-0.2, 1, 0], r * 0.36, r * 2.3], [[r * 1.0, r * 1.25, -r * 0.5], [0.45, 1, -0.3], r * 0.33, r * 1.9], [[r * 1.8, r * 0.7, r * 0.3], [1, 0.7, 0.2], r * 0.3, r * 1.6]], sp), spikes([[[r * 1.3, -P.upper, 0], [1, 0.1, -0.3], r * 0.26, r * 1.1]], sp, 1), ...skull([r * 1.1, r * 0.2, r * 1.5], r * 0.5, 30, 0, 0xcfc59e)]);
  G.lr('fore', [], spikes([0.25, 0.45, 0.65].map((t) => [[rf * 1.1, -F * t, -rf * 0.2], [1, 0.3, -0.2], rf * 0.26, rf * 1.2]), sp, 1));
  G.lr('leg', [], spikes([[[0, -P.thigh + rc * 0.3, rc * 1.3], [0, 0.45, 1], rc * 0.4, rc * 1.7]], sp));
  G.lr('shin', [], spikes([[[0, -P.shin * 0.92, P.footLen * 0.7], [0, 0.5, 1], 0.012, 0.04]], sp, 1));
  const sk = skirt(G, { mat: (x) => cloth(x, tone(red, 0, -0.1, -0.16)), len: 0.16, flare: 0.04, top: 0.0, fold: 0.006, grow: 0.006 });
  if (sk) G.add('root', [], [...tatters(G, { n: 12, y: sk.y1 - sk.len + 0.02, len: 0.1, w: 0.06, colors: [tone(red, 0, -0.1, -0.16), tone(red, 0, 0, -0.08), 0x16141a], ring: hemRing(sk, -0.006), flare: 0.2 }), flap(G, sk, 1, { color: red, len: 0.32, w: 0.12, ragged: 0.06, trim })]);
  // the cloak: pelts sewn together, skulls at the shoulders and one between the blades
  G.add('torso', mantle(G, furM(furC, 0.012, 28), { drop: 0.06, reach: 0.03 }), [-1, 1].flatMap((s) => skull([s * (G.sx - 0.03), T + 0.034, -G.cd * 1.3], 0.034, s * 150, -10)));
  const seed = hashStr(G.id) % 40, cp = cape(G, { color: furC, len: 0.66, slope: 0.27, ragged: 0.1, foldAmp: 0.04, width: G.sx * 2.9, nu: 20, nv: 18, off: 0.03,
    pattern: (u, v) => { const n = noise3(u * 26 + seed, v * 5, 2.2); return v > 0.5 && Math.abs(u - 0.5) < 0.3 * (v - 0.4) ? tone(red, 0, -0.1, -0.2) : n > 0.62 ? 0x4a3e30 : n < 0.34 ? 0x1c1814 : null; } });
  const bk = cp.at(0.5, 0.26);
  G.add('torso', [], [skull([bk[0], bk[1], bk[2] - 0.024], 0.036, 180, 0), boneRod(add3(cp.at(0.3, 0.3), [0, 0, -0.01]), add3(cp.at(0.42, 0.42), [0, 0, -0.012]), 0.007), boneRod(add3(cp.at(0.7, 0.3), [0, 0, -0.01]), add3(cp.at(0.58, 0.42), [0, 0, -0.012]), 0.007)]);
  if (G.bare) return;
  const horns = hornPair(G, [[0.95, 0.62, -0.1], [1.7, 0.66, -0.2], [2.25, 1.25, -0.05], [2.3, 2.2, 0.4]], [0.3, 0.27, 0.17, 0.02], { color: 0x4a4038, tip: 0x1a1612, ring: trim });
  if (G.muzzled()) { openBowl(G, im, { kind: 'pot' }); G.add('head', [], horns); return; }
  clearHead(G);
  const eye = S.box(R * 1.3, R * 0.11, R * 0.5, 0.002).at(0, R * 0.1, R * 1.0).cut(0.002).color(glow ?? 0x060608);
  if (glow != null) eye.glow(1.6);
  const crown = [];
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + 0.35; crown.push([[Math.sin(a) * R * 0.86, R * 0.86, Math.cos(a) * R * 0.86 - R * 0.02], [Math.sin(a) * 0.5, 1, Math.cos(a) * 0.5], R * 0.13, R * 0.62]); }
  G.add('head', [
    im(S.cone(R * 1.18, R * 1.02, R * 2.1, R * 0.08).at(0, -R * 0.12, 0)),
    im(S.ellipsoid(R * 1.0, R * 0.4, R * 1.0).at(0, R * 0.84, 0)).blend(0.03),
    im(S.cone(R * 1.34, R * 1.16, R * 0.3, R * 0.03).at(0, -R * 1.1, 0)).blend(0.006),
    im(S.cone(R * 0.3, R * 0.7, R * 1.0, R * 0.04).rot(8, 0, 0).at(0, -R * 0.55, R * 0.9)).blend(0.02),                  // a beak of a visor
    tm(S.box(R * 0.14, R * 1.2, R * 0.5, 0.003).at(0, -R * 0.4, R * 1.2)).paint(0.003, 0.003),
    tm(S.cyl(R * 1.5, R * 0.2, 0).at(0, R * 0.42, 0)).paint(0.003, 0.004),
    tm(G.band(-R * 1.2, R * 0.1, R * 2)).paint(0.003, 0.003),
    eye,
    ...[-1, 1].flatMap((s) => [0, 1, 2].map((i) => S.box(R * 0.035, R * 0.34, R * 0.5, 0).rot(0, s * 24, 0).at(s * R * (0.3 + i * 0.14), -R * 0.5, R * 0.9).cut(0.002).color(0x060608))),
  ], [horns, spikes(crown, sp, 1)]);
};
HEADGEAR.dreadPlate = true;

// ---- Northern reaver: bare chest, a wolf skin over the shoulders with its head for a cap, a fur kilt ----
OUTFITS.pelts = (G) => {
  const { T, k, P, R } = G, furC = G.cloth, pale = tone(furC, 0, -0.02, 0.14), dkf = tone(furC, 0, 0, -0.12), ironC = G.armor;
  const fm = furM(furC, 0.011, 30);
  // crossed straps, an iron ring where they meet, a string of fangs
  G.add('torso', [baldric(G, DARK_LEATHER, true, 0.028), baldric(G, DARK_LEATHER, false, 0.028)]);
  const f = G.field('torso'), cp = trace(f, [0, T * 0.5, 0.6], [0, 0, -1]) || [0, T * 0.5, G.cd], fangs = [];
  for (let i = -3; i <= 3; i++) { const p0 = trace(f, [i * 0.024 * k, T - 0.085 * k - (9 - i * i) * 0.0024, 0.6], [0, 0, -1]); if (p0) fangs.push(orient(bone(H.cone(0.006, 0.03 + (i % 2 ? 0 : 0.01), 5)), [p0[0], p0[1] - 0.012, p0[2] + 0.007], [0, -1, 0.25]).lod(1)); }
  // the pelt: thick over the shoulders, forelegs knotted on the chest, the rest down the back to the tail
  const paw = (s) => fm(rod([s * (G.sx - 0.05), T - 0.03, G.tp(T - 0.05).front * 0.6], [s * 0.022, T - 0.115 * k, G.tp(T - 0.12 * k).front + 0.004], 0.034, 0.022)).blend(0.012);
  G.add('torso', [...mantle(G, fm, { drop: 0.074, reach: 0.045 }), paw(1), paw(-1)], [
    iron(H.torus(0.026, 0.007, 14, 6), ironC).at(cp[0], cp[1], cp[2] + 0.008).lod(1), fangs,
    ...[-1, 1].flatMap((s) => [0, 1, 2].map((i) => orient(bone(H.cone(0.004, 0.016, 4), 0x2a2420), [s * (0.012 + i * 0.008), T - 0.135 * k, G.tp(T - 0.13 * k).front + 0.012], [s * 0.2, -1, 0.5]).lod(0))),
  ]);
  const cpe = cape(G, { color: furC, len: 0.4, slope: 0.2, ragged: 0.07, foldAmp: 0.02, width: G.sx * 1.9, wTop: G.sx * 0.9, off: 0.03, nu: 14, nv: 12,
    pattern: (u, v) => (Math.abs(u - 0.5) < 0.1 ? dkf : Math.abs(u - 0.5) > 0.4 ? pale : noise3(u * 30, v * 6, 1.5) > 0.6 ? dkf : null) });
  const t0 = cpe.at(0.5, 0.98);
  G.add('torso', [], [cloth(H.tube([t0, [t0[0] + 0.01, t0[1] - 0.07, t0[2] - 0.014], [t0[0] - 0.006, t0[1] - 0.15, t0[2] - 0.004]], [0.02, 0.026, 0.006], 8, 6), dkf).shade((x, y) => (y < t0[1] - 0.11 ? pale : null))]);
  const sk = hideKilt(G, furC, { mat: furM(dkf, 0.011, 30), len: 0.15, flare: 0.045, beltH: 0.04, belt: DARK_LEATHER, buckle: true, hem: { color: pale, h: 0.02 } });
  if (sk) G.add('root', [], [flap(G, sk, 1, { color: 0x5a3c26, len: 0.22, w: 0.09, ragged: 0.03, trim: DARK_LEATHER }), ...tatters(G, { n: 9, y: sk.y1 - sk.len + 0.012, len: 0.04, w: 0.06, colors: [dkf, furC], ring: hemRing(sk, -0.005), flare: 0.2 })]);
  const e = G.tp(0.04 * k);
  G.add('torso', [], [skull([-(e.side + 0.016), 0.0, 0.0], 0.024, -80, 0)]);
  G.lr('fore', [...bracer(G, 0x4a3524, { from: 0.3, to: 0.9, raise: 0.006 }), fm(S.cyl(P.rFore * 1.4, 0.03, 0.01).at(0, -P.fore * 0.3, 0)).blend(0.005)]);
  G.lr('arm', [leather(G.band(-P.upper * 0.5, 0.016, P.rUpper * 3), DARK_LEATHER).paint(0.003, 0.004)]);
  boots(G, { top: 0.3, color: 0x4a3524 });
  G.lr('shin', [fm(S.capsule([0, -P.shin * 0.42, 0], [0, -P.shin * 0.82, 0], P.rCalf * 1.4, P.rAnkle * 1.7)).blend(0.006), ...wraps(P.rCalf * 1.4, [-P.shin * 0.5, -P.shin * 0.7], DARK_LEATHER, 0.012, 0.003)]);
  G.cores('shin', furC);
  if (G.bare) return;
  if (G.helmAsked) {
    // horned iron helm; the wolf's head hangs behind
    const st = (h) => iron(h, ironC), hs = helmShell(G, 'pot', st, { sx: 1.0, sy: 0.96 * G.Lk, sz: 1.05, y: 0.12, z: -0.05 });
    G.add('head', [], [hs.hard, hs.place(st(H.box(0.2, 0.74, 0.08, 0.03)).rot(-12, 0, 0).at(0, 0.06, 1.12)).lod(1), hs.place(iron(H.torus(1.1, 0.06, 26, 6), tone(ironC, 0, 0, -0.14)).rot(90, 0, 0).at(0, 0.38, 0)).lod(1),
      hornPair(G, [[0.96, 0.6, -0.08], [1.45, 0.8, -0.1], [1.7, 1.3, 0.05], [1.62, 1.8, 0.25]], [0.21, 0.18, 0.11, 0.015], { tip: 0x3a3026, ring: tone(ironC, 0, 0, -0.14) })]);
    G.add('torso', [fm(S.ellipsoid(0.05 * k, 0.04 * k, 0.045 * k).at(0, T - 0.02, -G.cd * 1.5)).blend(0.02)]);
    return;
  }
  dropEars(G);
  G.add('head', [
    fm(S.ellipsoid(R * 1.06, R * 0.66 * G.Lk, R * 1.12).at(0, R * (0.2 + 0.46 * G.Lk), -R * 0.18)).blend(0.004),
    fm(S.ellipsoid(R * 0.96, R * 0.95, R * 0.5).at(0, -R * 0.25, -R * 0.82)).blend(0.03),
    ...[-1, 1].map((s) => fm(S.ellipsoid(R * 0.3, R * 0.8, R * 0.62).at(s * R * 0.98, -R * 0.3, -R * 0.36)).blend(0.03)),
    fm(rod([0, R * (0.3 + 0.52 * G.Lk), R * 0.4], [0, R * (0.2 + 0.4 * G.Lk), R * 1.7], R * 0.46, R * 0.23)).blend(0.03),                          // muzzle over the brow
    ...[-1, 1].map((s) => fm(rod([s * R * 0.52, R * (0.5 + 0.5 * G.Lk), -R * 0.2], [s * R * 0.9, R * (0.5 + 1.3 * G.Lk), -R * 0.4], R * 0.3, R * 0.04)).blend(0.012)),   // ears
    fin(S.sphere(R * 0.14).at(0, R * (0.22 + 0.4 * G.Lk), R * 1.93), 0x1a1614, 0.4, 0).blend(0.004),
    ...[-1, 1].map((s) => fin(S.sphere(R * 0.1).at(s * R * 0.34, R * (0.44 + 0.56 * G.Lk), R * 0.74), 0x0e0c0a, 0.3, 0).paint(0.003, -0.003)),
  ], [-1, 1].flatMap((s) => [0, 1, 2].map((i) => orient(bone(H.cone(R * 0.05, R * (i ? 0.16 : 0.3), 5)), [s * R * (0.16 + i * 0.04), R * (0.02 + 0.4 * G.Lk), R * (1.74 - i * 0.26)], [0, -1, 0.1]).lod(1))));
};
HEADGEAR.pelts = true;

/** a flat plate of scrap lying on the torso where the ray from `from` meets it, with a bolt at each corner */
function scrapPlateAt(f, from, dir, w, h, turn, c, seed, bolt = 0x2e2e32) {
  const p = trace(f, from, dir, 1.5);
  if (!p) return [];
  const n = gradient(f, p), yaw = Math.atan2(n[0], n[2]) / DEG, pitch = -Math.asin(clamp(n[1], -1, 1)) / DEG;
  const put = (hd) => hd.rot(0, 0, turn).rot(pitch, 0, 0).rot(0, yaw, 0).at(p[0] + n[0] * 0.007, p[1] + n[1] * 0.007, p[2] + n[2] * 0.007);
  const out = [put(scrap(H.box(w, h, 0.012, 0.004), c, seed)).near(), put(iron(H.geo(slabGeo()).scale(w, h, 0.012), c)).far()];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push(put(H.geo(domeGeo()).scale(0.007).rot(90, 0, 0).at(sx * (w / 2 - 0.012), sy * (h / 2 - 0.012), 0.006).color(bolt).pbr(0.5, 0.9)).lod(0));
  return out;
}

// ---- Scrap-iron brute: whatever plate could be found, bolted and strapped over rough leather ----
OUTFITS.scrapPlate = (G) => {
  const { T, k, P, R } = G, c = G.o.armor ?? 0x7c7874, c2 = tone(c, 0.02, 0.06, -0.1), c3 = tone(c, 0, -0.02, 0.1), lc = G.cloth;
  G.add('torso', [torsoLayer(G, (x) => leather(x, lc), { raise: 0.004, y1: T - 0.02 }), baldric(G, DARK_LEATHER, true, 0.03), baldric(G, DARK_LEATHER, false, 0.03), leather(G.band(0.12 * k, 0.03), DARK_LEATHER).paint(0.004, 0.006)]);
  const f = G.field('torso'), ch = G.tp(G.chestY);
  const b = belt(G, 0.045 * k, { h: 0.04, color: 0x2a1e16, buckle: false });
  G.add('torso', b.prims, [
    scrapPlateAt(f, [0.01, G.chestY + 0.01, 0.7], [0, 0, -1], ch.side * 1.5, 0.125 * k, 5, c, 1),
    scrapPlateAt(f, [-0.012, 0.115 * k, 0.7], [0, 0, -1], ch.side * 1.05, 0.085 * k, -7, c2, 2),
    scrapPlateAt(f, [0.02, G.chestY - 0.01, -0.7], [0, 0, 1], ch.side * 1.3, 0.17 * k, -4, c3, 3),
    scrapPlateAt(f, [0.7, 0.14 * k, 0.0], [-1, 0, 0], 0.09 * k, 0.1 * k, 8, c2, 4),
    scrapPlateAt(f, [0, 0.045 * k, 0.7], [0, 0, -1], 0.075, 0.06, 0, c3, 5),
  ]);
  const sk = skirt(G, { mat: (x) => leather(x, tone(lc, 0, 0, -0.05)).bump(0.004, 22, 'noise'), len: 0.13, flare: 0.04, top: 0.03 });
  if (sk) G.add('root', [], [tatters(G, { n: 9, y: sk.y1 - sk.len + 0.012, len: 0.05, w: 0.07, colors: [lc, tone(lc, 0, 0, -0.1)], ring: hemRing(sk, -0.005), flare: 0.2 }),
    scrap(H.box(0.085, 0.11, 0.01, 0.004), c, 6).rot(-8, 0, 0).at(0, sk.y1 - 0.1, sk.zc + sk.rTop + 0.03).lod(1), scrap(H.box(0.07, 0.1, 0.01, 0.004), c2, 7).rot(0, 90, 0).rot(0, 0, -8).at(sk.ox + sk.rTop + 0.03, sk.y1 - 0.09, sk.zc).lod(1)]);
  // arms: a great rusty shoulder on the left, a shield boss on the right; splints and a crude vambrace
  const r = P.rUpper, rf = P.rFore, F = P.fore, rc = P.rCalf;
  const pa = plateArm(G, c, { mat: rusty(c), pauldron: 1.32, lames: 2, upper: false, couter: false, fore: false, rivet: 0x2e2e32, trimMat: darkEdge });
  G.add('armL', [pa.arm, rustOn([r * 0.36, 0, 0], r * 2, 6, 2)], pa.armH);
  G.add('armR', [leather(G.band(-P.upper * 0.3, 0.02, r * 3), DARK_LEATHER).paint(0.003, 0.005)], [
    ...[12, 6].map((seg, i) => { const h = orient(scrap(H.lathe([[0.0001, 0.5], [0.3, 0.46], [0.5, 0.26], [0.62, 0.2], [1, 0.1], [1.04, 0], [0.96, -0.06], [0.0001, -0.06]].map(([x, y]) => [x * r * 1.7, y * r * 1.7]), seg), c3, 8), [-r * 0.95, r * 0.25, 0], [-1, 0.55, 0]); return i ? h.far() : h.near(); }),
    ...[0, 1, 2, 3, 4].map((i) => orient(H.geo(domeGeo()).scale(r * 0.14), [-r * 0.95 - r * 0.3, r * 0.25 + Math.cos(i * 1.256) * r * 1.3 * 0.84, Math.sin(i * 1.256) * r * 1.3], [-1, 0.55, 0]).color(0x2e2e32).pbr(0.5, 0.9).lod(0)),
  ]);
  G.add('foreL', [...[-1, 0, 1].map((i) => rusty(c2)(S.box(rf * 0.5, F * 0.6, 1, 0.004).at(i * rf * 0.72, -F * 0.52, 0)).paint(0.003, 0.006)), leather(G.band(-F * 0.3, 0.014, rf * 3), DARK_LEATHER).paint(0.003, 0.008), leather(G.band(-F * 0.76, 0.014, rf * 3), DARK_LEATHER).paint(0.003, 0.008)]);
  const pr = plateArm(G, c3, { mat: rusty(c3), pauldron: 0, upper: false, couter: false, hand: false, rivet: 0x2e2e32 });
  G.add('foreR', [...pr.fore, ...rustOn([0, -F * 0.5, 0], F * 0.5, 4, 5)].map((x) => x.mirrorX()));
  // legs: knee and greave on the left, a thigh plate on the right
  const pl = plateLeg(G, c, { mat: rusty(c), tasset: false, cuisse: false, sabaton: false, rivet: 0x2e2e32 });
  G.add('legL', pl.leg, pl.legH); G.add('shinL', [...pl.shin, ...rustOn([0, -P.shin * 0.5, 0], P.shin * 0.5, 5, 6)]);
  G.add('legR', [leather(G.band(-P.thigh * 0.25, 0.016, P.rThigh * 3), DARK_LEATHER).paint(0.003, 0.005), leather(G.band(-P.thigh * 0.7, 0.016, P.rThigh * 3), DARK_LEATHER).paint(0.003, 0.005)], [scrap(H.box(P.rThigh * 1.7, P.thigh * 0.62, 0.01, 0.004), c2, 9).rot(-4, -20, 0).at(-P.rThigh * 0.3, -P.thigh * 0.46, P.rThigh * 1.02).near(), iron(H.geo(slabGeo()).scale(P.rThigh * 1.7, P.thigh * 0.62, 0.01), c2).rot(-4, -20, 0).at(-P.rThigh * 0.3, -P.thigh * 0.46, P.rThigh * 1.02).far()]);
  G.add('shinR', wraps(rc, [-P.shin * 0.3, -P.shin * 0.45, -P.shin * 0.6, -P.shin * 0.75], 0x4a3524, 0.02, 0.005));
  boots(G, { top: 0.25, color: 0x3a2a1e });
  G.core('armL', c); G.core('foreR', c3); G.core('shinL', c);
  if (G.bare) return;
  // skull-cap and a jagged jaw-guard hung from it
  const reach = Math.max(1, G.faceReach() / 1.1), hs = helmShell(G, 'cap', (h) => scrap(h, c, 3), { sx: 1.0, sy: 0.9 * G.Lk, sz: 1.04, y: 0.14, z: -0.04 });
  const jz = 1.04 * reach, jaw = cached('scrapjaw', () => new THREE.LatheGeometry([[1.1, -0.28], [1.18, -0.62], [1.08, -1.0], [0.8, -1.12]].map(([x, y]) => new THREE.Vector2(x, y)), 12, -1.9, 3.8));
  const hh = [hs.hard, hs.place(scrap(H.geo(jaw), c2, 4).scale(1, 1, jz)), hs.place(iron(H.box(0.2, 0.5, 0.06, 0.02), c).at(0, 0.3, 1.1)).lod(1)];
  for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 3.4; hh.push(hs.place(scrap(H.cone(0.12, 0.3 + (i % 2) * 0.14, 4), c2, i).at(Math.sin(a) * 1.12, -0.16 + (i % 2) * 0.06, Math.cos(a) * 1.12 * jz)).lod(1)); }
  for (const s of [-1, 1]) hh.push(hs.place(leather(H.box(0.06, 0.6, 0.2, 0.02), DARK_LEATHER).at(s * 1.08, 0.0, -0.3)).lod(1), hs.place(H.geo(domeGeo()).scale(0.08).rot(0, 0, -90 * s).at(s * 1.12, -0.5, 0.0).color(0x2e2e32).pbr(0.5, 0.9)).lod(0));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.5; hh.push(hs.place(H.geo(domeGeo()).scale(0.06).rot(0, 0, -90).rot(0, -a / DEG, 0).at(Math.cos(a) * 1.07, 0.42, Math.sin(a) * 1.07).color(0x2e2e32).pbr(0.5, 0.9)).lod(0)); }
  G.add('head', [], hh);
};
HEADGEAR.scrapPlate = true;

// ---- Night goblin: a ragged black robe and a hood that comes to a long point ----
OUTFITS.darkHood = (G) => {
  const { T, k, P, R } = G, c = G.cloth, dk = tone(c, 0, -0.03, -0.06), lt = tone(c, 0.02, 0.02, 0.07);
  const cm = (x) => cloth(x, c);
  const sk = robe(G, c, { bell: 1.7, flare: 0.085, fold: 0.011, under: dk, hem: { color: dk, h: 0.024 }, hemY: 0.04 });
  if (sk) G.add('root', [cloth(S.sphere(0.04).at(sk.rTop * 0.5, sk.y1 - sk.len * 0.55, sk.zc + sk.rTop + 0.04), lt).paint(0.008, 0.002)], tatters(G, { n: 13, y: sk.y1 - sk.len + 0.02, len: 0.06, w: 0.06, colors: [c, dk, lt], ring: hemRing(sk, -0.006), flare: 0.22 }));
  for (const s of [1, -1]) G.add(s > 0 ? 'foreL' : 'foreR', wraps(P.rFore, [-P.fore * 0.86, -P.fore * 0.96], 0x6a6250, 0.012, 0.003), tatters(G, { n: 6, y: -P.fore * 0.86, len: 0.05, w: 0.04, colors: [c, dk], ring: limbRing(P.rFore * 1.8), flare: 0.05, seed: 'cuff' + s }));
  G.add('torso', mantle(G, (x) => cloth(x, dk), { drop: 0.07, reach: 0.03, bump: [0.005, 14, 'noise'] }), tatters(G, { n: 10, y: T - 0.075 * k, len: 0.05, w: 0.05, colors: [dk, c], ring: (a) => [Math.sin(a) * (G.sx + 0.03), G.tp(T - 0.07).zc + Math.cos(a) * (G.tp(T - 0.07).depth + 0.035)], flare: 0.1, seed: 'cowl', lean: P.hunch }));
  const f = G.field('torso'), p1 = patchOn(G, f, [-G.cw * 0.4, 0.14 * k, 0.6], [0, 0, -1], 0.028, lt);
  const rb = ropeBelt(G, 0.055 * k, 0x8a7a52, { len: 0.12 }), pch = pouch(G, 0.055 * k, 60, { size: 1.1, color: 0x3a2a1e });
  G.add('torso', [p1.prims, rb.prims, pch.prims], [p1.hard, rb.hard, pch.hard, knife(G, 0.055 * k)]);
  if (G.bare) return;
  hoodShell(G, cm, { grow: 0.17, open: [0.74, 0.92], oy: -0.2, deep: 0.5, bump: [0.004, 16, 'noise'], inside: 0x08080a });
  G.nodes.head.prims.unshift(
    cm(rod([0, R * 0.8, -R * 0.3], [0, R * 2.3, -R * 0.75], R * 0.64, R * 0.27)).blend(0.06),
    cm(rod([0, R * 2.3, -R * 0.75], [0, R * 3.0, -R * 1.35], R * 0.27, R * 0.13)).blend(0.04),
    cm(rod([0, R * 3.0, -R * 1.35], [0, R * 2.75, -R * 2.1], R * 0.13, R * 0.035)).blend(0.03),
  );
};
HEADGEAR.darkHood = true;

// ---- Plague tinker: rags, scavenged plate, copper pipes and a flask of something that glows ----
OUTFITS.ragGoggles = (G) => {
  const { T, k, P, R } = G, c = G.cloth, patchC = tone(c, 0.05, 0.05, 0.1), glowC = G.o.glow ?? 0x62ff3a, ironC = G.o.armor ?? 0x86827c, cu = COPPER;
  const rm = (x) => cloth(x, c), cop = (h) => fin(h, cu, 0.4, 1), br = (h) => gold(h, BRASS), gl = (h, v = 1.5) => h.color(glowC).pbr(0.2, 0).glow(v);
  G.add('torso', [torsoLayer(G, rm, { raise: 0.004, y1: T - 0.04 * k }), cloth(S.sphere(0.036).at(-G.cw * 0.4, 0.13 * k, G.tp(0.13 * k).front), patchC).paint(0.004, 0.002), cloth(S.sphere(0.03).at(G.cw * 0.2, 0.08 * k, -G.tp(0.08 * k).back), tone(c, -0.03, 0, -0.1)).paint(0.004, 0.002)]);
  const rb = ropeBelt(G, 0.05 * k, ROPE, { kx: -0.03 }), e = G.tp(0.05 * k);
  const f = G.field('torso');
  // a pot lid for a breastplate, held by the pack straps
  const lid = trace(f, [G.cw * 0.2, G.chestY, 0.7], [0, 0, -1]) || [0, G.chestY, G.cd];
  G.add('torso', [rb.prims, baldric(G, DARK_LEATHER, true, 0.028), baldric(G, DARK_LEATHER, false, 0.028)], [rb.hard,
    scrap(H.lathe([[0.0001, 0.018], [0.01, 0.018], [0.014, 0.01], [0.05 * k, 0.006], [0.062 * k, 0], [0.05 * k, -0.004], [0.0001, -0.004]], 14), ironC, 1).rot(82, 0, 0).at(lid[0], lid[1], lid[2] + 0.008).lod(1),
    gl(H.capsule(0.011, 0.05, 8), 1.2).rot(0, 0, 20).at(-(e.side * 0.7), 0.05 * k - 0.04, e.zc + e.depth * 0.75 + 0.014).lod(1), br(H.cyl(0.008, 0.008, 0.012, 6)).rot(0, 0, 20).at(-(e.side * 0.7) - 0.009, 0.05 * k - 0.014, e.zc + e.depth * 0.75 + 0.014).lod(1),
  ]);
  const sk = skirt(G, { mat: rm, len: 0.11, flare: 0.035, top: 0.03, fold: 0.005 });
  if (sk) G.add('root', [], tatters(G, { n: 10, y: sk.y1 - sk.len + 0.012, len: 0.07, w: 0.05, colors: [c, tone(c, 0, 0, -0.08), patchC], ring: hemRing(sk, -0.004) }));
  // the pack: a frame, the big flask in its cage, a copper canister, pipes over the shoulder and round the ribs
  const zb = -(G.tp(T * 0.55).back + 0.045), fy = T * 0.56, fh = 0.15 * k, fr = 0.034 * k;
  const pack = [
    leather(H.box(0.15 * k, 0.17 * k, 0.03, 0.008), 0x4a3524).at(0, fy, zb + 0.022),
    gl(H.capsule(fr, fh, 10)).at(-0.03 * k, fy + 0.01, zb - fr * 0.7),
    br(H.cyl(fr * 0.7, fr * 1.02, 0.02, 10)).at(-0.03 * k, fy + 0.01 + fh / 2, zb - fr * 0.7).lod(1), br(H.cyl(fr * 1.02, fr * 0.8, 0.02, 10)).at(-0.03 * k, fy + 0.01 - fh / 2, zb - fr * 0.7).lod(1),
    ...[-0.2, 0.2].map((t) => iron(H.torus(fr * 1.04, 0.004, 12, 4), 0x3a3a3e).rot(90, 0, 0).at(-0.03 * k, fy + 0.01 + t * fh, zb - fr * 0.7).lod(1)),
    cop(H.cyl(0.022 * k, 0.022 * k, 0.1 * k, 8)).at(0.045 * k, fy - 0.02, zb - 0.02 * k), br(H.sphere(0.022 * k, 8)).scale(1, 0.6, 1).at(0.045 * k, fy - 0.02 + 0.05 * k, zb - 0.02 * k).lod(1),
    cop(H.tube([[-0.03 * k, fy + fh / 2 + 0.02, zb - fr * 0.7], [-0.04 * k, T + 0.035, zb + 0.02], [-0.05 * k, T + 0.03, 0.0], [lid[0] - 0.05 * k, T - 0.06, lid[2] * 0.8], [lid[0], lid[1] + 0.03, lid[2] + 0.014]], 0.0075, 22, 6)),
    cop(H.tube([[0.045 * k, fy - 0.02 - 0.05 * k, zb - 0.02 * k], [0.09 * k, 0.1 * k, zb + 0.01], [e.side + 0.03, 0.09 * k, 0.0], [e.side * 0.7, 0.07 * k, e.zc + e.depth * 0.8 + 0.02]], 0.006, 18, 6)).lod(1),
    br(H.cyl(0.014, 0.014, 0.012, 8)).rot(82, 0, 0).at(lid[0], lid[1] + 0.03, lid[2] + 0.016).lod(1), br(H.torus(0.01, 0.004, 8, 4)).rot(0, 90, 0).at(-0.05 * k, T + 0.032, 0.0).lod(1),
    gl(H.sphere(0.008, 6), 1.6).at(lid[0], lid[1] + 0.03, lid[2] + 0.026).lod(1),
  ];
  G.add('torso', [], pack);
  // scavenged iron
  const pa = plateArm(G, ironC, { mat: rusty(ironC), pauldron: 1.0, lames: 0, upper: false, couter: false, fore: false, rivet: 0x3a3a3e, trimMat: darkEdge });
  G.add('armR', [pa.arm, rustOn([P.rUpper * 0.36, 0, 0], P.rUpper * 1.7, 5, 1)].flat().map((x) => x.mirrorX()), pa.armH.map((x) => x.mirrorX()));
  const pl = plateLeg(G, ironC, { mat: rusty(ironC), tasset: false, cuisse: false, poleyn: false, sabaton: false, rivet: 0x3a3a3e });
  G.add('shinL', [...pl.shin, ...rustOn([0, -P.shin * 0.5, 0], P.shin * 0.5, 5, 2)]);
  G.add('shinR', wraps(P.rCalf, [-P.shin * 0.4, -P.shin * 0.55, -P.shin * 0.7, -P.shin * 0.85], 0x9a8a68));
  G.add('foreL', [...bracer(G, 0x4a3524, { from: 0.3, to: 0.92 }), glove(G, (x) => leather(x, 0x4a3524))], [cop(H.tube([0, 1, 2, 3, 4].map((i) => [Math.cos(i * 1.5) * P.rFore * 1.25, -P.fore * (0.3 + i * 0.14), Math.sin(i * 1.5) * P.rFore * 1.25]), 0.005, 14, 5)).lod(1)]);
  G.add('foreR', wraps(P.rFore, [-P.fore * 0.5, -P.fore * 0.64, -P.fore * 0.78], 0x9a8a68));
  if (G.bare) return;
  const hs = helmShell(G, 'cap', (h) => leather(h, 0x5a3c26), { sx: 1.0, sy: 0.92 * G.Lk, sz: 1.04, y: 0.08, z: -0.04 });
  const hh = [hs.hard, hs.place(leather(H.torus(1.07, 0.05, 26, 5), DARK_LEATHER).rot(90, 0, 0).rot(-6, 0, 0).at(0, 0.46, 0)).lod(1), hs.place(br(H.cyl(0.07, 0.07, 0.1, 6)).at(0, 1.1, 0)).lod(1)];
  for (const s of [-1, 1]) {
    hh.push(hs.place(br(H.cyl(0.27, 0.3, 0.2, 12)).rot(84, 0, 0).at(s * 0.36, 0.5, 1.02)));
    hh.push(hs.place(gl(H.cyl(0.21, 0.21, 0.03, 12), 0.9).rot(84, 0, 0).at(s * 0.36, 0.51, 1.13)));
    hh.push(hs.place(leather(H.box(0.5, 0.3, 0.26, 0.06), 0x5a3c26).at(s * 0.98, -0.1, -0.1)).lod(1));
  }
  hh.push(hs.place(br(H.box(0.2, 0.08, 0.06, 0.02)).at(0, 0.5, 1.08)).lod(1));
  G.add('head', [], hh);
};
HEADGEAR.ragGoggles = true;

// ---- River-kingdom spearman: obsidian scale, a long fringed skirt, a wide belt, a hat like a stepped tower ----
OUTFITS.ziggurat = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, trim = G.trim, ob = G.o.armor ?? 0x1e1c26;
  const om = (x) => fin(x, ob, 0.2, 0.6, 0.05, 30), cm = (x) => cloth(x, c), tm = (x) => gold(x, trim);
  G.add('torso', [torsoLayer(G, cm, { raise: 0.002 }), ...torsoShells(G, (x) => om(x).bump(0.0055, 42, 'scales'), { grow: 0.013, blend: 0.02, hips: false }), tm(G.band(T - 0.075 * k, 0.012)).paint(0.003, 0.002)]);
  // a fringed shawl over the left shoulder
  const a = Math.atan2(G.sx * 1.5, T) / DEG;
  G.add('torso', [cloth(S.box(0.085 * k, T * 2.4, 1, 0.006).rot(0, 0, -a).at(0.01, T * 0.52, 0), c2).paint(0.004, 0.006), ...[-1, 1].map((s) => tm(S.box(0.01, T * 2.4, 1, 0.002).rot(0, 0, -a).at(0.01 + s * 0.046 * k, T * 0.52 + s * 0.02, 0)).paint(0.003, 0.0075))]);
  const y = 0.052 * k, e = G.tp(y), ros = [];
  for (let i = 0; i < 10; i++) { const an = (i / 10) * Math.PI * 2 + 0.31; ros.push([Math.sin(an) * 0.6, y, Math.cos(an) * 0.6]); }
  G.add('torso', [tm(G.band(y, 0.062, 0.7)).paint(0.004, 0.008), fin(G.band(y + 0.022, 0.005, 0.7), 0x3a2a1a, 0.6, 0.4).paint(0.002, 0.007), fin(G.band(y - 0.022, 0.005, 0.7), 0x3a2a1a, 0.6, 0.4).paint(0.002, 0.007)], [studs(G, 'torso', ros, { r: 0.011, color: c2, rough: 0.5, metal: 0.3, lod: 1 }), knife(G, y)]);
  const len = Math.min(0.38, P.hipY - 0.12);
  const sk = skirt(G, { mat: cm, top: 0.03, len, flare: 0.05, fold: 0.004, hem: { color: trim, h: 0.012, metal: 0.7, rough: 0.5 }, panel: { mat: (x) => cloth(x, c2), w: 0.3, raise: 0.004, trim } });
  if (sk) {
    const tiers = [0.36, 0.68, 1].map((t) => sk.y1 - len * t), fr = [], pr = [];
    tiers.forEach((ty, i) => {
      const rr = lerp(sk.rTop, sk.rHem, i === 2 ? 1 : [0.36, 0.68][i] * 0.6);
      if (i < 2) pr.push(tm(G.band(ty + 0.012, 0.01, 0.7)).paint(0.003, 0.003));
      fr.push(tatters(G, { n: 22, y: ty + 0.008, len: 0.038, w: 0.034, colors: [trim, c2, trim], ring: hemRing({ ...sk, rHem: rr }, 0.003), flare: 0.1, seed: 'fr' + i, lod: i === 2 ? 1 : 0 }));
    });
    G.add('root', pr, fr);
  }
  const r = P.rUpper;
  G.lr('arm', [om(S.capsule([0, -r * 0.3, 0], [0, -P.upper * 0.5, 0], r * 1.2, r * 1.14)).blend(0.006).bump(0.005, 46, 'scales'), om(S.ellipsoid(r * 1.16, r * 1.3, r * 1.24).at(r * 0.24, -r * 0.5, 0)).blend(0.008).bump(0.005, 46, 'scales'), tm(G.band(-P.upper * 0.66, 0.016, r * 3)).paint(0.003, 0.004)]);
  G.lr('fore', [tm(S.cyl(P.rFore * 2.4, P.fore * 0.3, 0).at(0, -P.fore * 0.72, 0)).paint(0.004, 0.006)], [stud([P.rFore * 1.1, -P.fore * 0.72, 0], [1, 0, 0], 0.012, c2, 0.5, 0.3).lod(1)]);
  barefoot(G);
  G.lr('shin', [leather(G.band(-P.shin * 0.9, 0.012, P.rCalf * 3), 0x5a3a22).paint(0.003, 0.004), leather(G.band(-P.shin * 0.76, 0.012, P.rCalf * 3), 0x5a3a22).paint(0.003, 0.004), leather(S.box(0.3, 0.012, 0.6, 0.003).at(0, -P.shin - P.footH + 0.005, 0.05), 0x5a3a22).paint(0.003, 0.004), leather(S.box(0.3, 0.1, 0.014, 0.003).at(0, -P.shin - P.footH + 0.03, P.footLen * 0.45), 0x5a3a22).paint(0.003, 0.003)]);
  G.cores('arm', ob);
  if (G.bare) return;
  const zp = [[0, 3.0, 1], [0.1, 2.98, 1], [0.16, 2.72, 1], [0.52, 2.66, 1], [0.58, 2.6, 1], [0.58, 2.5, 1], [0.58, 2.48, 0], [0.58, 2.1, 0], [0.6, 2.08, 1], [0.76, 2.0, 1], [0.84, 1.94, 1], [0.84, 1.84, 1], [0.84, 1.82, 0], [0.84, 1.46, 0], [0.86, 1.44, 1], [1.0, 1.36, 1], [1.08, 1.3, 1], [1.08, 1.2, 1], [1.08, 1.18, 0], [1.08, 0.62, 0], [1.08, 0.6, 1], [1.15, 0.47, 1], [1.15, 0.36, 1], [1.05, 0.36, 1]];
  const hat = latheHat(G, 'zig', zp, (h) => cloth(h, c2).shade((x, yy, z, nx, ny, nz, i) => (zp[i % zp.length][2] ? trim : null)), { y: 0.06, sy: 0.92, seg: 20 });
  G.add('head', [], [hat.hard, hat.place(gold(H.sphere(0.16, 8), trim).at(0, 3.02, 0)).lod(1), hat.place(gold(H.extrude(SHAPES.star.map(([x, yy]) => [x * 0.3, yy * 0.3]), 0.04, 0.01), trim).at(0, 0.9, 1.1)).lod(1),
    hang([0, R * 0.42, -R * 1.02], R * 1.5, R * 1.3, c2, { yaw: 180, taper: -0.1, wave: 0.04, out: 0.1, shade: (x, yy) => (yy < -R * 1.1 ? trim : null) })]);
};
HEADGEAR.ziggurat = true;

// ---- Lord of the dead: crimson enamel on black plate, a collar like wings behind the head, a cape of velvet ----
OUTFITS.nobleDead = (G) => {
  const { T, k, P, R } = G, red = G.cloth, blk = G.o.armor ?? 0x201e26, trim = G.trim;
  const bm = dkSteel(blk), rm = (x) => fin(x, red, 0.3, 0.55, 0.06, 30), tm = (x) => gold(x, trim);
  plateSuit(G, blk, { mat: bm, trim, pauldron: 1.16, lames: 3, fauld: 3, underMat: (x) => cloth(x, 0x1a1418), under: 0x1a1418, skirt: false });
  // enamel panels and filigree
  const ch = G.tp(G.chestY), w = G.tp(0.125 * k);
  G.add('torso', [
    ...[-1, 1].map((s) => pbox(rm, ch.side * 0.62, 0.13 * k, [s * ch.side * 0.46, G.chestY + 0.012, 0.25], 0.0015, 0.5)),
    pbox(rm, w.side * 0.9, 0.06 * k, [0, 0.125 * k, 0.25], 0.0015, 0.5), pbox(rm, ch.side * 1.2, 0.16 * k, [0, G.chestY, -0.25], 0.0015, 0.5),
    ...[-1, 1].flatMap((s) => [tm(S.torus(0.024 * k, 0.004).rot(90, 0, 0).at(s * ch.side * 0.46, G.chestY + 0.03, ch.front + 0.01)).paint(0.002, 0.002), tm(S.torus(0.014 * k, 0.004).rot(90, 0, 0).at(s * ch.side * 0.46, G.chestY - 0.016, ch.front + 0.01)).paint(0.002, 0.002),
      tm(S.box(0.006, 0.13 * k, 0.5, 0).at(s * ch.side * 0.14, G.chestY + 0.012, 0.25)).paint(0.002, 0.002)]),
  ]);
  const f = G.field('torso'), cz = G.tp(G.chestY + 0.02).front;
  G.add('torso', [], [gold(H.extrude(SHAPES.lozenge.map(([x, y]) => [x * 0.03 * k, y * 0.03 * k]), 0.008, 0.003), trim).at(0, T - 0.07 * k, G.tp(T - 0.07 * k).front + 0.02).lod(1), gem(H.sphere(0.011 * k, 8), 0xc0141c, 0.6).scale(1, 1.3, 0.6).at(0, T - 0.07 * k, G.tp(T - 0.07 * k).front + 0.028).lod(1),
    chain(drape(f, [-G.sx * 0.62, T - 0.03], [G.sx * 0.62, T - 0.03], 0.05 * k, 8, 0.008), 0.0045, trim, { metal: 1, rough: 0.3 })]);
  const r = P.rUpper;
  G.lr('arm', [rm(S.sphere(r * 1.0).at(r * 0.5, r * 0.9, 0)).paint(0.004, 0.0015), tm(S.torus(r * 0.9, 0.004).rot(0, 0, -30).at(r * 0.5, r * 0.75, 0)).paint(0.002, 0.002)]);
  G.lr('fore', [pbox(rm, P.rFore * 0.9, P.fore * 0.44, [P.rFore * 0.8, -P.fore * 0.48, 0], 0.0015, 0.5)]);
  G.lr('leg', [pbox(rm, P.rThigh * 0.9, P.thigh * 0.34, [0, -P.thigh * 0.62, P.rThigh], 0.0015, P.rThigh)]);
  G.lr('shin', [pbox(rm, P.rCalf * 0.8, P.shin * 0.5, [0, -P.shin * 0.5, P.rCalf], 0.0015, P.rCalf)]);
  const b = belt(G, 0.058 * k, { h: 0.026, color: 0x1a1418, raise: 0.004, buckleColor: trim });
  G.add('torso', b.prims, [b.hard, scabbard(G, 0.058 * k, { len: 0.36, color: tone(red, 0, 0, -0.14), metal: trim })]);
  const sk = skirt(G, { mat: (x) => silk(x, tone(red, 0, 0, -0.1)), len: 0.14, flare: 0.035, top: 0.0, fold: 0.006, grow: 0.004, hem: { color: trim, h: 0.01, rough: 0.4, metal: 0.8 } });
  if (sk) G.add('root', [], [flap(G, sk, 1, { color: 0x16141a, len: 0.28, w: 0.1, ragged: 0, trim })]);
  // the collar: two leaves of plate rising past the ears, enamelled inside
  const rn = P.rNeck, hgt = P.neck + R * 2.05 * P.headLen;
  const colFn = (off) => (u, v) => { const a = (u - 0.5) * 3.9, t = Math.pow(Math.abs(Math.sin(a * 0.62)), 0.8), rr = rn * 1.9 + off + v * (0.03 + 0.07 * t); return [Math.sin(a) * rr * 1.2, T + 0.006 + v * hgt * (0.42 + 0.58 * t) + (v > 0.9 ? 0.02 * t : 0), -Math.cos(a) * rr * 0.95 - 0.014 - v * 0.02]; };
  const us = [0, 0.05, 0.12, 0.2, 0.28, 0.36, 0.44, 0.5, 0.56, 0.64, 0.72, 0.8, 0.88, 0.95, 1], vs = [0, 0.35, 0.7, 0.92, 0.95, 1];
  const edge = (x, y, z, nx, ny, nz, i) => { const ci = i % us.length, ri = Math.floor(i / us.length); return ri >= 4 || ci < 1 || ci >= us.length - 1 ? trim : null; };
  G.add('torso', [], [fin(H.geo(surfaceGeo(us, vs, colFn(0.004))), blk, 0.42, 0.9).shade(edge), fin(H.geo(surfaceGeo(us, vs, colFn(0))), red, 0.4, 0.4).shade(edge).lod(1)]);
  cape(G, { color: red, len: 0.78, trim, slope: 0.27, width: G.sx * 3.0, foldAmp: 0.04, off: 0.02 });
  for (const s of [-1, 1]) G.add('torso', [], [gold(H.sphere(0.017, 10), trim).scale(1, 1, 0.5).at(s * G.sx * 0.62, T - 0.03, G.tp(T - 0.04).front * 0.72 + 0.022).lod(1)]);
};

/** leather sandals over bare feet */
function sandals(G, c = 0x5a3a22) {
  const { P } = G;
  barefoot(G);
  G.lr('shin', [leather(G.band(-P.shin * 0.9, 0.012, P.rCalf * 3), c).paint(0.003, 0.004), leather(S.box(0.3, 0.012, 0.6, 0.003).at(0, -P.shin - P.footH + 0.005, 0.05), c).paint(0.003, 0.004), leather(S.box(0.3, 0.1, 0.014, 0.003).at(0, -P.shin - P.footH + 0.03, P.footLen * 0.45), c).paint(0.003, 0.003)]);
}

// ---- Tomb king (variant 'guard': his plainer bronze-banded guardsman): broad collar, pleated kilt, striped headcloth, a mask of gold ----
OUTFITS.pharaoh = (G) => {
  const { T, k, P, R } = G, guard = G.variant === 'guard', gC = guard ? (G.o.trim ?? G.o.armor ?? BRONZE) : G.trim, stripe = G.cloth, lapis = G.o.gem ?? LAPIS, linen = 0xece6d2;
  const gm = (x) => fin(x, gC, guard ? 0.42 : 0.28, 1, 0.05, 30), lp = (x) => fin(x, lapis, 0.35, 0.2, 0.08, 40), L = P.headLen / 1.12;
  // the collar: rings of gold and stone lying on the shoulders
  const e = G.tp(T - 0.05);
  const rings = guard ? [gC, gC, stripe, stripe, gC, gC] : [gC, lapis, gC, TURQ, gC, 0xa8322a, gC], rh = (0.076 * k) / rings.length;
  G.add('torso', [
    gm(S.ellipsoid(G.sx * 0.96, 0.038 * k, e.depth + 0.016).at(0, T - 0.028, e.zc)).blend(0.006),
    ...rings.map((col, i) => fin(G.band(T + 0.01 * k - (i + 0.5) * rh, rh, 0.7), col, col === gC ? 0.3 : 0.4, col === gC ? 1 : 0.15).paint(0.0015, i % 2 ? 0.0006 : 0.0016)),
  ]);
  if (!guard) {
    const cy = G.chestY - 0.012, cz = G.tp(cy).front + 0.012;
    G.add('torso', [], [gm(H.cyl(0.026 * k, 0.026 * k, 0.008, 12)).rot(90, 0, 0).at(0, cy, cz).lod(1), lp(H.sphere(0.016 * k, 8)).scale(1, 1.2, 0.5).at(0, cy, cz + 0.004).lod(1),
      ...[-1, 1].map((s) => lp(H.extrude([[0.02, -0.012], [0.085, 0.02], [0.08, 0.034], [0.02, 0.012]].map(([x, y]) => [s * x * k, y * k]), 0.005, 0.0015)).shade((x) => (Math.abs(x) > 0.06 * k ? gC : null)).at(0, cy, cz - 0.004).lod(1))]);
  }
  // belt, pleated kilt, the apron in front
  const y = 0.045 * k;
  G.add('torso', [gm(G.band(y, 0.04, 0.7)).paint(0.004, 0.007), !guard && lp(G.band(y, 0.01, 0.7)).paint(0.003, 0.008)]);
  const sk = skirt(G, { mat: (x) => cloth(x, linen), len: 0.2, flare: 0.04, top: 0.025, fold: 0.008, foldFreq: 30, hem: guard ? null : { color: gC, h: 0.01, metal: 0.8, rough: 0.4 } });
  if (sk) G.add('root', [], [flap(G, sk, 1, { color: stripe, len: 0.22, w: 0.085, trim: gC, ragged: 0, slant: 0.34 })]);
  const band = (r, yy, h) => [gm(G.band(yy, h, r * 3)).paint(0.003, 0.006), !guard && lp(G.band(yy, h * 0.3, r * 3)).paint(0.002, 0.007)];
  G.lr('arm', band(P.rUpper, -P.upper * 0.5, 0.03));
  G.lr('fore', band(P.rFore, -P.fore * 0.78, guard ? 0.03 : 0.05));
  if (!guard) { const pl = plateLeg(G, gC, { mat: gm, tasset: false, cuisse: false, poleyn: false, sabaton: false, trimMat: lp }); G.lr('shin', pl.shin, pl.shinH); G.cores('shin', gC); }
  sandals(G, guard ? 0x5a3a22 : 0x8a6a2a);
  if (G.bare) return;
  // the headcloth is built before the face so its opening can be cut; on the king a mask replaces the face
  const mask = !guard && !G.muzzled();
  if (mask) {
    clearHead(G);
    const kohl = (x) => fin(x, lapis, 0.4, 0.2);
    G.add('head', [
      gm(S.ellipsoid(R * 0.84, R * 1.04 * L, R * 0.92).at(0, -R * 0.04, R * 0.06)),
      gm(S.capsule([0, -R * 0.7, -R * 0.1], [0, -R * 1.6, -R * 0.16], P.rNeck * 1.1, P.rNeck * 1.2)).blend(0.012),
      gm(S.ellipsoid(R * 0.5, R * 0.34, R * 0.3).at(0, -R * 0.72, R * 0.62)).blend(0.014),                              // chin
      gm(rod([0, R * 0.16, R * 0.92], [0, -R * 0.3, R * 1.1], R * 0.08, R * 0.13)).blend(0.008),                         // nose
      ...[-1, 1].map((s) => gm(S.ellipsoid(R * 0.2, R * 0.26, R * 0.2).at(s * R * 0.42, -R * 0.22, R * 0.76)).blend(0.014)),   // cheeks
      gm(S.ellipsoid(R * 0.24, R * 0.06, R * 0.1).at(0, -R * 0.5, R * 0.94)).blend(0.005), gm(S.ellipsoid(R * 0.2, R * 0.055, R * 0.09).at(0, -R * 0.6, R * 0.92)).blend(0.005),   // lips
      S.box(R * 0.36, R * 0.016, R * 0.2, 0).at(0, -R * 0.55, R * 0.98).cut(0.004).color(0x3a2a10),
      ...[-1, 1].flatMap((s) => [
        kohl(S.ellipsoid(R * 0.22, R * 0.09, R * 0.3).at(s * R * 0.34, R * 0.1, R * 0.84)).paint(0.002, 0.001),
        kohl(S.box(R * 0.34, R * 0.045, R * 0.4, 0).rot(0, 0, s * 4).at(s * R * 0.62, R * 0.1, R * 0.7)).paint(0.002, 0.001),
        fin(S.ellipsoid(R * 0.15, R * 0.055, R * 0.3).at(s * R * 0.34, R * 0.1, R * 0.86), 0xf2ecd8, 0.3, 0).paint(0.002, 0.0015),
        fin(S.sphere(R * 0.055).at(s * R * 0.34, R * 0.1, R * 0.9), 0x0a0a0c, 0.2, 0).paint(0.002, 0.002),
        kohl(S.box(R * 0.42, R * 0.05, R * 0.4, 0).rot(0, 0, s * 8).at(s * R * 0.36, R * 0.27, R * 0.84)).paint(0.002, 0.002),     // brows
      ]),
      lp(rod([0, -R * 0.98, R * 0.72], [0, -R * 1.75, R * 0.86], R * 0.11, R * 0.16)).blend(0.006).bump(0.005, 70, 'ridges'),       // the plaited beard
      gm(G.band(-R * 1.78, R * 0.07, R * 0.6)).paint(0.002, 0.002),
    ]);
  } else dropEars(G);
  const s2 = guard ? linen : gC, nm = (x) => (guard || s2 !== gC ? cloth(x, stripe) : fin(x, stripe, 0.5, 0.2, 0.06, 30));
  const nemes = [
    nm(S.ellipsoid(R * 1.07, R * (0.98 * L + 0.1), R * 1.12).at(0, R * 0.22, -R * 0.12)),
    nm(S.ellipsoid(R * 0.98, R * 1.0, R * 0.5).at(0, -R * 0.4, -R * 0.74)).blend(0.04),
    ...[-1, 1].flatMap((s) => [
      nm(S.ellipsoid(R * 0.4, R * 1.1, R * 0.74).rot(0, 0, s * 13).at(s * R * 1.1, -R * 0.42, -R * 0.1)).blend(0.04),          // the wings beside the face
      nm(S.box(R * 0.44, R * 1.15, R * 0.2, R * 0.08).rot(-6, 0, s * 3).at(s * R * 0.66, -R * 1.5, R * 0.42)).blend(0.03),       // lappets on the chest
    ]),
    nm(rod([0, -R * 1.1, -R * 1.0], [0, -R * 2.0, -R * 0.95], R * 0.24, R * 0.16)).blend(0.03),                            // the queue behind
  ];
  for (let i = 0; i < 16; i++) nemes.push(fin(S.box(R * 5, R * 0.115, R * 5, 0).at(0, R * (1.2 - i * 0.23), 0), s2, s2 === gC ? 0.3 : 0.85, s2 === gC ? 1 : 0).paint(0.002, 0.0012));
  nemes.push(gm(S.cyl(R * 1.5, R * 0.14, 0).rot(-8, 0, 0).at(0, R * 0.56, 0)).paint(0.002, 0.003));
  nemes.push(S.ellipsoid(R * 0.72, R * 0.86, R * 0.9).at(0, -R * 0.22, R * 1.0).cut(0.012).color(mask ? gC : 0x1a1614));
  G.nodes.head.prims.unshift(...nemes);
  if (!guard) G.add('head', [], [gm(H.tube([[0, R * 0.52, R * 0.98], [0, R * 0.8, R * 1.16], [0, R * 1.02, R * 1.1]], [R * 0.06, R * 0.07, R * 0.1], 8, 6)).lod(1), gm(H.sphere(R * 0.13, 8)).scale(1.3, 1, 0.7).at(0, R * 1.04, R * 1.1).lod(1), lp(H.sphere(R * 0.06, 6)).at(0, R * 1.0, R * 1.2).lod(1)]);
};
HEADGEAR.pharaoh = true;

/** a cluster of barnacles round p on a surface with outward normal n */
function barnacles(p, n, count = 5, r = 0.009, seed = 1) {
  const out = [], rr = rng(seed * 977 + 13), u = norm3(Math.abs(n[1]) > 0.8 ? [1, 0, 0] : [-n[2], 0, n[0]]), w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  for (let i = 0; i < count; i++) {
    const a = rr() * 6.283, d = i ? r * (1.2 + rr() * 1.6) : 0, s = r * (0.6 + rr() * 0.7), q = add3(p, add3(mul3(u, Math.cos(a) * d), mul3(w, Math.sin(a) * d)));
    out.push(orient(fin(H.cyl(s * 0.5, s, s * 1.1, 6), 0xc9c2a6, 0.9, 0), add3(q, mul3(n, s * 0.4)), n).lod(1), orient(fin(H.cyl(s * 0.36, s * 0.36, s * 0.2, 5), 0x2a2620, 0.9, 0), add3(q, mul3(n, s * 0.92)), n).lod(0));
  }
  return out;
}
const weed = (at, len, yaw, seed = 0, c = 0x4c8a3a) => [hang(at, 0.034, len, c, { yaw, sway: seed, taper: 0.6, wave: 0.22, out: 0.05, nv: 5, lod: 99 }), hang(add3(at, [0.008, 0, 0.004]), 0.026, len * 0.66, tone(c, 0.03, 0, -0.1), { yaw: yaw + 30, sway: seed + 2, taper: 0.6, wave: 0.25, out: 0.1, nv: 4 }), hang(add3(at, [-0.01, 0, -0.004]), 0.02, len * 0.8, tone(c, -0.02, 0, 0.06), { yaw: yaw - 24, sway: seed + 4, taper: 0.6, wave: 0.25, out: 0.12, nv: 4 })];

// ---- Drowned buccaneer: a long coat gone to rot, striped breeches, a sash, things from the sea bed still clinging ----
OUTFITS.pirate = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, trim = G.o.trim ?? 0x9a8650, dk = tone(c, 0.02, 0, -0.08), shirt = 0xb9b49a, mould = 0x3a5236;
  const cm = (x) => fin(x, c, 0.92, 0, 0.26, 16);
  G.add('torso', [torsoLayer(G, (x) => cloth(x, shirt), { raise: 0.002 }), ...torsoShells(G, cm, { grow: 0.015, blend: 0.03 }),
    pbox((x) => cloth(x, shirt), 0.075 * k, T * 0.86, [0, T * 0.5, 0.25], -0.005, 0.5),                                   // the coat hangs open on the shirt
    ...[-1, 1].map((s) => pbox((x) => cloth(x, dk), 0.03 * k, T * 0.86, [s * 0.055 * k, T * 0.5, 0.25], 0.003, 0.5)),     // facings
    fin(S.sphere(0.05).at(G.cw * 0.7, T * 0.3, 0.02), mould, 0.95, 0).paint(0.03, 0), fin(S.sphere(0.06).at(-G.cw * 0.5, T * 0.7, -G.cd), mould, 0.95, 0).paint(0.03, 0),
  ]);
  const f = G.field('torso');
  G.add('torso', [], studs(G, 'torso', [0, 1, 2, 3].flatMap((i) => [-1, 1].map((s) => [s * 0.066 * k, T * 0.78 - i * 0.05 * k, 0.6])), { field: f, dir: [0, 0, -1], r: 0.008, color: trim, rough: 0.6, metal: 0.8, lod: 1 }));
  const sa = sash(G, 0.06 * k, c2, { h: 0.06, deg: 46, len: 0.2 }), b = belt(G, 0.075 * k, { h: 0.024, color: 0x2a1e16, raise: 0.011, buckleColor: trim }), e = G.tp(0.06 * k);
  const sh = trace(f, [G.sx * 0.55, T + 0.3, -0.01], [0, -1, 0]) || [G.sx * 0.55, T, 0], bp = trace(f, [-G.cw * 0.55, G.chestY, 0.6], [0, 0, -1]);
  G.add('torso', [sa.prims, b.prims, baldric(G, 0x3a2a1e, false, 0.03)], [sa.hard, b.hard,
    // a pistol thrust through the sash
    wood(H.box(0.02, 0.06, 0.022, 0.006), 0x4a3020).rot(0, 0, -62).at(-0.03, 0.06 * k + 0.02, e.front + 0.022).lod(1), iron(H.cyl(0.007, 0.008, 0.11, 6), 0x3a3a40).rot(0, 0, 64).at(0.03, 0.06 * k - 0.004, e.front + 0.024).lod(1),
    barnacles(sh, [0.2, 1, 0], 7, 0.015, 2), bp ? barnacles([bp[0], bp[1], bp[2]], [0, 0.1, 1], 6, 0.012, 3) : [],
    weed([sh[0] + 0.02, sh[1], sh[2] - 0.02], 0.2, 200, 1), weed([-G.sx * 0.6, T - 0.01, -G.cd * 0.9], 0.16, 170, 4), weed([e.side + 0.012, 0.06 * k, 0], 0.15, 90, 2),
  ]);
  const len = Math.min(0.33, P.hipY - 0.2);
  const sk = skirt(G, { mat: cm, top: 0.03, len, flare: 0.075, fold: 0.01, foldFreq: 11, panel: { mat: (x) => cloth(x, 0x191613), w: 0.2, raise: -0.006 } });
  if (sk) G.add('root', [fin(S.sphere(0.07).at(sk.rHem, sk.y1 - len * 0.8, -sk.rHem * 0.5), mould, 0.95, 0).paint(0.04, 0), fin(S.sphere(0.06).at(-sk.rHem, sk.y1 - len * 0.5, sk.rHem * 0.6), tone(c, 0, 0, -0.14), 0.95, 0).paint(0.04, 0)],
    [tatters(G, { n: 12, y: sk.y1 - len + 0.016, len: 0.07, w: 0.06, colors: [c, dk, mould], ring: hemRing(sk, -0.006), flare: 0.16 }), weed([sk.rHem * 0.7, sk.y1 - len + 0.01, -sk.rHem * 0.7], 0.1, 140, 6)]);
  G.lr('arm', sleeve(G, cm, { grow: 1.08 }));
  G.lr('fore', [cm(S.cyl(P.rFore * 3, P.fore * 1.1, 0).at(0, -P.fore * 0.45, 0)).paint(0.005, 0.003), fin(S.cone(P.rFore * 1.9, P.rFore * 1.45, P.fore * 0.36, 0.008).at(0, -P.fore * 0.68, 0), dk, 0.92, 0, 0.2, 20).blend(0.006), cloth(G.band(-P.fore * 0.92, 0.02, P.rFore * 3), shirt).paint(0.003, 0.004)],
    [0.56, 0.74].map((t) => stud([P.rFore * 1.75, -P.fore * t, 0], [1, 0, 0], 0.007, trim, 0.6, 0.8).lod(1)));
  // striped breeches to the knee, bucket boots
  const br = 0xcfc8ae, rt = P.rThigh, rc = P.rCalf;
  hose(G, (x) => cloth(x, br), { raise: 0.004 });
  G.lr('leg', [...[-1, 0, 1].flatMap((i) => [cloth(S.box(rt * 0.36, P.thigh * 1.2, 1, 0.002).at(i * rt * 0.78, -P.thigh * 0.5, 0), c2).paint(0.003, 0.0045), cloth(S.box(1, P.thigh * 1.2, rt * 0.36, 0.002).at(0, -P.thigh * 0.5, (i + 0.5) * rt * 0.78), c2).paint(0.003, 0.0045)])]);
  boots(G, { top: 0.72, color: 0x2c2018, cuff: 0.04 });
  G.lr('shin', [leather(S.cone(rc * 1.25, rc * 1.95, P.shin * 0.2, 0.008).at(0, -P.shin * 0.2, 0), 0x33261c).blend(0.006)]);
  G.add('shinL', [], barnacles([rc * 1.1, -P.shin * 0.6, rc * 0.4], [1, 0.2, 0.4], 4, 0.008, 5));
  G.cores('arm', c); G.cores('fore', c); G.cores('leg', br); G.cores('shin', 0x2c2018);
  if (G.bare) return;
  const place = hatPlace(G, { tilt: -5, y: 0.1 });
  const tf = (a, t) => { const fold = Math.pow((1 - Math.cos(a * 3)) / 2, 0.8); return [lerp(1.04, lerp(2.1, 1.32, fold), t), 0.42 + Math.pow(t, 1.2) * lerp(0.06, 0.72, fold)]; };
  const hm = (h) => fin(h, dk, 0.9, 0), crown = latheHat(G, 'tricrown', [[0, 1.04], [0.5, 1.06], [0.92, 0.94], [1.06, 0.7], [1.06, 0.42]], hm, { place });
  G.add('head', [], [crown.hard, brim(G, 'tricorn', tf, hm, place, (x, y, z) => (Math.hypot(x, z) > 1.24 && y > 0.4 && (Math.hypot(x, z) > 1.92 || y > 0.98) ? trim : null)),
    place(gold(H.torus(1.07, 0.04, 22, 5), trim).rot(90, 0, 0).at(0, 0.5, 0)).lod(1),
    barnacles([R * 0.5, R * (0.1 + 1.0 * G.Lk), R * 0.3], [0.2, 1, 0.2], 5, R * 0.1, 7), weed([-R * 0.9, R * 0.9, -R * 0.4], R * 1.8, 250, 3), weed([R * 0.3, R * 0.6, -R * 1.2], R * 1.3, 180, 5)]);
};
HEADGEAR.pirate = true;

// ---- Ogre gut-buster: fur trousers, a great round plate strapped over the belly, trophies on a shoulder strap ----
OUTFITS.gutplate = (G) => {
  const { T, k, P } = G, furC = G.cloth, ironC = G.o.armor ?? 0x74706c, trim = G.trim, dev = typeof G.o.device === 'string' && SHAPES[G.o.device] ? G.o.device : 'skull';
  const fm = furM(furC, 0.011, 30), lc = 0x3a2a1e;
  // trousers of pelts gathered at the ankle
  G.lr('leg', [cloth(S.cyl(P.rThigh * 3, P.thigh * 1.5, 0).at(0, -P.thigh * 0.5, 0), furC).paint(0.005, 0.003), fm(S.capsule([0, -P.thigh * 0.08, 0], [0, -P.thigh * 0.92, 0], P.rThigh * 1.24, P.rCalf * 1.5)).blend(0.02)]);
  G.lr('shin', [fm(S.capsule([0, -P.shin * 0.02, 0], [0, -P.shin * 0.74, 0], P.rCalf * 1.46, P.rAnkle * 1.7)).blend(0.02), ...wraps(P.rAnkle * 1.6, [-P.shin * 0.78, -P.shin * 0.9], lc, 0.02, 0.006)]);
  boots(G, { top: 0.1, color: 0x3a2a1e });
  G.cores('leg', furC); G.cores('shin', furC);
  const sk = hideKilt(G, furC, { mat: furM(tone(furC, 0, 0, -0.08), 0.011, 30), len: 0.1, flare: 0.03, beltY: 0.03 * k, beltH: 0.045, belt: lc });
  if (sk) G.add('root', [], [flap(G, sk, 1, { color: tone(furC, 0.01, 0.04, -0.16), len: 0.17, w: 0.13, ragged: 0.03 })]);
  // the gut plate and its harness
  const y = 0.125 * k, e = G.tp(y), rp = Math.min(e.side * 0.96, T * 0.36), z = e.front + 0.004;
  const prof = [[0.0001, 0.24], [0.16, 0.25], [0.2, 0.2], [0.55, 0.16], [0.86, 0.08], [0.96, 0.06], [1, 0.0], [0.94, -0.05], [0.0001, -0.05]].map(([r, yy]) => [r * rp, yy * rp]);
  const disc = (seg) => scrap(H.lathe(prof, seg), ironC, 3).rot(90, 0, 0).at(0, y, z);
  const hard = [disc(22).near(), disc(8).far()];
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + 0.2; hard.push(stud([Math.cos(a) * rp * 0.9, y + Math.sin(a) * rp * 0.9, z + rp * 0.085], [0, 0, 1], rp * 0.055, 0x2e2e32)); }
  hard.push(fin(H.extrude(SHAPES[dev].map(([x, yy]) => [x * rp * 0.5, yy * rp * 0.5]), 0.006, 0.002), trim, 0.6, 0.5).at(0, y, z + rp * 0.2));
  if (dev === 'skull') hard.push(...[-1, 1].map((s) => H.sphere(rp * 0.1, 6).scale(1, 1.1, 0.3).at(s * rp * 0.17, y + rp * 0.08, z + rp * 0.2 + 0.004).color(0x1a1410).pbr(0.9).lod(1)));
  const a = Math.atan2(G.sx * 1.5, T) / DEG, f = G.field('torso');
  G.add('torso', [
    leather(G.band(y, 0.05 * k, 0.8), lc).paint(0.005, 0.007),
    ...[-1, 1].map((s) => pbox((x) => leather(x, lc), 0.036, T * 1.3, [s * e.side * 0.5, T * 0.7, 0], 0.007)),
    leather(S.box(0.044, T * 2.4, 1, 0.003).rot(0, 0, -a).at(0, T * 0.52, 0), 0x4a3524).paint(0.004, 0.009),
  ], hard);
  // trophies along the strap
  const tr = [];
  for (let i = 0; i < 3; i++) { const t = 0.2 + i * 0.26, x = Math.sin(a * DEG) * (t - 0.5) * T * 1.5 * -1 + 0.02, yy = T * 0.52 + Math.cos(a * DEG) * (t - 0.5) * T * -1.5 + T * 0.62, p = trace(f, [x, Math.min(yy, T - 0.02), 0.7], [0, 0, -1]); if (p && p[1] > y + rp * 0.7) tr.push(i === 1 ? boneRod([p[0], p[1], p[2] + 0.012], [p[0] + 0.02, p[1] - 0.07, p[2] + 0.02], 0.007) : skull([p[0], p[1] - 0.03, p[2] + 0.024], 0.026 + i * 0.003, i * 20 - 14, 6, i ? 0xcfc59e : BONE)); }
  const sh = [G.sx * 0.5, T + 0.012, 0];
  G.add('torso', [], [tr, spikes([[sh, [0.2, 1, 0], 0.014, 0.06], [add3(sh, [0.04, -0.008, 0.02]), [0.6, 1, 0.3], 0.012, 0.05]], (h) => iron(h, 0x2e2e32), 1), skull([-(e.side + 0.02), 0.02 * k, 0.0], 0.03, -80, 0)]);
  G.lr('fore', [rusty(ironC)(S.cyl(P.rFore * 2.4, P.fore * 0.36, 0).at(0, -P.fore * 0.66, 0)).paint(0.004, 0.008)], spikes([0, 1, 2].map((i) => [[Math.cos(i * 1.2 - 0.6) * P.rFore * 1.1, -P.fore * 0.66, Math.sin(i * 1.2 - 0.6) * P.rFore * 1.1 * -1], [Math.cos(i * 1.2 - 0.6), 0.1, -Math.sin(i * 1.2 - 0.6)], 0.011, 0.04]), (h) => iron(h, 0x2e2e32), 1));
  G.add('armL', [leather(G.band(-P.upper * 0.45, 0.022, P.rUpper * 3), lc).paint(0.003, 0.005)]);
};

SHELLS.morion = { f: [[0, 1.3], [0.5, 1.14], [0.88, 0.82], [1.04, 0.52], [1.2, 0.36], [1.8, 0.66]], s: [[0, 1.3], [0.5, 1.14], [0.88, 0.82], [1.04, 0.5], [1.12, 0.32], [1.3, 0.22]], b: [[0, 1.3], [0.5, 1.14], [0.88, 0.82], [1.04, 0.52], [1.2, 0.36], [1.8, 0.66]] };
// ---- Gentleman of the pike: silk doublet and breeches, gold chains. stripes, cuirass, hat: plumed | morion | cap ----
OUTFITS.doublet = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, trim = G.trim, o = G.o, hat = o.hat === 'morion' || o.hat === 'cap' ? o.hat : 'plumed', white = 0xefe9da;
  const sm = (x) => silk(x, c), s2 = (x) => silk(x, c2), w = G.tp(0.1 * k);
  G.add('torso', [torsoLayer(G, sm, { raise: 0.003 }), ...torsoShells(G, sm, { grow: 0.012, blend: 0.03, hips: false }), sm(S.ellipsoid(w.side * 0.55, 0.085 * k, 0.034).at(0, 0.1 * k, w.front + 0.002)).blend(0.035),
    o.stripes ? [-3, -2, -1, 0, 1, 2, 3].map((i) => pbox(s2, G.cw * 0.15, T * 1.1, [i * G.cw * 0.3, T * 0.5, 0], 0.0006)) : [-1, 1].map((s) => pbox(s2, 0.012, T * 0.9, [s * 0.02 * k, T * 0.5, 0.25], 0.002, 0.5)),
    cloth(S.torus(P.rNeck * 1.6, 0.022).at(0, T + 0.024, -0.004), white).blend(0.004).bump(0.006, 50, 'weave'),
  ]);
  if (o.cuirass) { const cu = cuirass(G, G.armor, { fauld: 1, gorget: false, trim }); G.add('torso', cu.prims, cu.hard); }
  const f = G.field('torso');
  const b = belt(G, 0.05 * k, { h: 0.022, color: 0x2a1e16, raise: 0.004, buckleColor: trim });
  G.add('torso', b.prims, [b.hard, scabbard(G, 0.05 * k, { len: 0.34, color: 0x2a2018, metal: trim }),
    chain(drape(f, [-G.sx * 0.66, T - 0.03], [G.sx * 0.66, T - 0.03], 0.075 * k, 9, 0.008), 0.0055, trim, { metal: 1, rough: 0.3 }), chain(drape(f, [-G.sx * 0.6, T - 0.03], [G.sx * 0.6, T - 0.03], 0.11 * k, 9, 0.008), 0.0045, trim, { metal: 1, rough: 0.3 }),
    ...(() => { const p = drape(f, [0, T - 0.03 - 0.11 * k], [0, T - 0.03 - 0.11 * k], 0, 1, 0.012)[0]; return [gold(H.cyl(0.016, 0.016, 0.005, 10), trim).rot(90, 0, 0).at(p[0], p[1] - 0.014, p[2]).lod(1), gem(H.sphere(0.007, 6), 0xb0202a).at(p[0], p[1] - 0.014, p[2] + 0.004).lod(1)]; })(),
    !o.cuirass && studs(G, 'torso', [0, 1, 2, 3, 4].map((i) => [0, 0.08 * k + i * 0.036 * k, 0.6]), { field: f, dir: [0, 0, -1], r: 0.006, color: trim, lod: 1 })]);
  skirt(G, { mat: sm, len: 0.075, flare: 0.045, top: 0.025, fold: 0.008, foldFreq: 10, hem: { color: c2, h: 0.012 } });
  // full sleeves gathered at the wrist, breeches gathered at the knee
  const r = P.rUpper, U = P.upper, rf = P.rFore, F = P.fore, rt = P.rThigh, L = P.thigh, st = o.stripes;
  G.lr('arm', [sm(S.cyl(r * 3, U * 1.6, 0).at(0, -U * 0.5, 0)).paint(0.005, 0.002), sm(S.ellipsoid(r * 1.55, U * 0.56, r * 1.6).at(r * 0.16, -U * 0.42, 0)).blend(0.014), ...(st ? slashes(c2, r * 1.4, -U * 0.45, U * 0.9, 3, 0.0006) : []), s2(S.ellipsoid(r * 1.3, r * 0.5, r * 1.4).at(r * 0.3, r * 0.2, 0)).blend(0.01)]);
  G.lr('fore', [sm(S.cyl(rf * 3, F * 1.14, 0).at(0, -F * 0.45, 0)).paint(0.005, 0.002), sm(S.capsule([0, -F * 0.06, 0], [0, -F * 0.74, 0], rf * 1.42, P.rWrist * 1.3)).blend(0.014), ...(st ? slashes(c2, rf * 1.2, -F * 0.42, F * 0.76, 3, 0.0006) : []), cloth(S.cyl(P.rWrist * 1.8, 0.022, 0.008).at(0, -F * 0.88, 0), white).blend(0.004).bump(0.004, 60, 'weave')]);
  G.lr('leg', [sm(S.cyl(rt * 3, L * 1.5, 0).at(0, -L * 0.5, 0)).paint(0.005, 0.002), sm(S.ellipsoid(rt * 1.4, L * 0.5, rt * 1.46).at(rt * 0.08, -L * 0.42, 0)).blend(0.016), ...(st ? slashes(c2, rt * 1.3, -L * 0.45, L * 0.9, 3, 0.0006) : []), s2(G.band(-L * 0.92, 0.022, rt * 3)).paint(0.003, 0.006)],
    [silk(H.sphere(0.013, 6), c2).scale(1.4, 0.9, 0.7).at(P.rCalf * 1.15, -L * 0.92, 0).lod(1)]);
  const hoseC = st ? white : tone(c2, 0, -0.05, 0.05);
  G.lr('shin', [cloth(S.cyl(P.rCalf * 3, P.shin * 1.02, 0).at(0, -P.shin * 0.47, 0), hoseC).paint(0.005, 0.002)]);
  boots(G, { top: 0.08, color: 0x2a2018, cuff: 0.02 });
  G.lr('shin', [], [silk(H.sphere(0.012, 6), c2).scale(1.3, 0.8, 1).at(0, -P.shin - P.footH + 0.05, P.footLen * 0.32).lod(1)]);
  G.cores('arm', c); G.cores('fore', c); G.cores('leg', c); G.cores('shin', hoseC);
  if (G.bare) return;
  if (hat === 'morion') {
    const stl = (x) => steel(x, G.armor), hs = helmShell(G, 'morion', stl, { sy: G.Lk, y: 0.1, comb: 0.3 });
    const hh = [hs.hard, hs.place(gold(H.torus(1.08, 0.04, 26, 5), trim).rot(90, 0, 0).at(0, 0.5, 0)).lod(1)];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + 0.3; hh.push(hs.place(H.geo(domeGeo()).scale(0.05).rot(0, 0, -90).rot(0, -a / DEG, 0).at(Math.cos(a) * 1.08, 0.5, Math.sin(a) * 1.08).color(trim).pbr(0.3, 1)).lod(0)); }
    dropEars(G);
    G.add('head', cheekPlates(G, stl), hh);
    return;
  }
  const felt = tone(c, 0, -0.2, -0.24), fm = (h) => cloth(h, hat === 'cap' ? c : felt);
  if (hat === 'cap') {
    const place = hatPlace(G, { tilt: -6, roll: 14, y: 0.12 }), cap = latheHat(G, 'flatcap', [[0, 0.96], [0.6, 1.0], [1.2, 0.92], [1.42, 0.74], [1.3, 0.56], [1.04, 0.46]], fm, { place });
    G.add('head', [], [cap.hard, place(cloth(H.torus(1.06, 0.07, 22, 5), c2).rot(90, 0, 0).at(0, 0.46, 0)).lod(1), place(gold(H.sphere(0.1, 8), trim).scale(1, 1, 0.5).at(-0.75, 0.6, 0.95)).lod(1),
      feather([-R * 0.72, R * 0.62, R * 0.9], [-0.5, 1, -0.5], R * 1.5, R * 0.36, [0, 0.2, 1], [0x8a8474, white, c2])]);
    return;
  }
  const place = hatPlace(G, { tilt: -6, y: 0.1 });
  const bf = (a, t) => [lerp(1.04, 2.05, t), 0.44 - 0.1 * t + t * 0.8 * Math.pow(Math.max(0, Math.sin(a)), 2) - 0.1 * t * Math.pow(Math.max(0, -Math.sin(a)), 2)];
  const crown = latheHat(G, 'cavalier', [[0, 1.3], [0.4, 1.32], [0.8, 1.2], [1.0, 0.9], [1.06, 0.5], [1.06, 0.42]], fm, { place });
  G.add('head', [], [crown.hard, brim(G, 'cavalier', bf, fm, place), place(silk(H.torus(1.07, 0.06, 22, 5), c2).rot(90, 0, 0).at(0, 0.52, 0)).lod(1), place(gold(H.box(0.16, 0.14, 0.04, 0.02), trim).at(0.5, 0.52, 0.96).rot(0, 0, 0)).lod(1),
    plume(G, white, { at: [R * 0.85, R * 0.72, -R * 0.1], size: 1.1, n: 5 }), plume(G, c2, { at: [R * 0.7, R * 0.72, -R * 0.4], size: 0.85, n: 3 })]);
};
HEADGEAR.doublet = true;

/** a wound turban (head node). o: size, mat, jewel (colour), feather [quill, vane, tip], tail */
function turban(G, c, o = {}) {
  const R = G.R, s = o.size ?? 1, m = o.mat || cloth, y = R * (0.38 + 0.46 * G.Lk), dk = tone(c, 0, 0, -0.07);
  const lobe = (rz, x, col) => m(S.ellipsoid(R * 1.2 * s, R * 0.56 * s, R * 1.24 * s).rot(0, 0, rz).at(x, y, -R * 0.08), col).bump(0.007, 36, 'ridges');
  const prims = [m(S.ellipsoid(R * 1.1 * s, R * 0.6 * s, R * 1.16 * s).at(0, y, -R * 0.08), c).blend(0.004), lobe(26, R * 0.12, c).blend(0.02), lobe(-26, -R * 0.12, dk).blend(0.02), m(S.ellipsoid(R * 0.52 * s, R * 0.3 * s, R * 0.56 * s).at(0, y + R * 0.56 * s, -R * 0.1), o.top ?? c).blend(0.03)];
  const jz = R * 1.18 * s - R * 0.06, hard = [];
  if (o.jewel !== false) hard.push(gold(H.sphere(R * 0.17, 10), o.setting ?? GOLD).scale(1, 1.25, 0.5).at(0, y + R * 0.1, jz).lod(1), gem(H.sphere(R * 0.1, 8), o.jewel ?? 0xc0202a, 0.5).scale(1, 1.3, 0.6).at(0, y + R * 0.1, jz + R * 0.05).lod(1));
  if (o.feather) hard.push(feather([0, y + R * 0.2, jz - R * 0.06], [0.06, 1, -0.22], R * 1.9 * s, R * 0.4, [0, 0.2, 1], o.feather));
  if (o.tail) hard.push(hang([R * 0.5, y - R * 0.2, -R * 1.05 * s], R * 0.6, R * 1.7, c, { yaw: 180, taper: -0.1, wave: 0.08, out: 0.14, mat: m }));
  return { prims, hard, y };
}

// ---- Vizier or sultan's guard: flowing layered silks and a sash; mail: true puts gilded mail-and-plate over the chest ----
OUTFITS.silkRobe = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, trim = G.trim, mailOn = !!G.o.mail, dk = tone(c, 0, 0.03, -0.1);
  const s1 = (x) => silk(x, c), s2 = (x) => silk(x, c2), shoe = mix(c2, 0x5a3a22, 0.3);
  const sk = robe(G, c, { mat: s1, bell: 2.4, flare: 0.12, fold: 0.012, cuff: trim, hem: { color: trim, h: 0.016, rough: 0.5, metal: 0.7 }, under: tone(c2, 0, 0, -0.1), shoe, panel: { mat: s2, w: 0.3, raise: -0.003, trim } });
  // the under-robe crosses at the throat; a long open coat lies over it
  G.add('torso', [
    ...[-1, 1].map((s) => s2(S.box(0.07 * k, T * 0.8, 0.5, 0.004).rot(0, 0, s * 16).at(s * 0.016 * k, T * 0.56, 0.25)).paint(0.004, -0.003)),
    ...[-1, 1].map((s) => gold(S.box(0.01, T * 0.8, 0.5, 0.002).rot(0, 0, s * 16).at(s * 0.056 * k, T * 0.56, 0.25), trim).paint(0.003, 0.002)),
    ...mantle(G, (x) => silk(x, dk), { drop: 0.046, reach: 0.016, trim }),
  ]);
  if (sk) G.add('root', [gold(G.band(0.045 + 0.05, 0.008), trim).paint(0.003, 0.002)]);
  if (mailOn) {
    const mc = mix(trim, 0xc0c0c0, 0.3), ml = (x) => fin(x, mc, 0.45, 0.85, 0.18, 80), pm = (x) => gold(x, trim), ch = G.tp(G.chestY);
    G.add('torso', [...torsoShells(G, (x) => ml(x).bump(0.003, 60, 'weave'), { grow: 0.012, blend: 0.02, hips: false }),
      ...[0, 1, 2].flatMap((row) => [-2, -1, 0, 1, 2].map((i) => pbox(pm, ch.side * 0.3, 0.03 * k, [i * ch.side * 0.34, 0.085 * k + row * 0.036 * k, 0.25], 0.004, 0.5))),
      ...[0, 1, 2].flatMap((row) => [-2, -1, 0, 1, 2].map((i) => pbox(pm, ch.side * 0.3, 0.03 * k, [i * ch.side * 0.34, 0.085 * k + row * 0.036 * k, -0.25], 0.004, 0.5)))]);
    const cz = ch.front + 0.016, cy = G.chestY + 0.012;
    G.add('torso', [], [pm(H.lathe([[0.0001, 0.012], [0.012 * k, 0.012], [0.02 * k, 0.006], [0.05 * k, 0.004], [0.055 * k, 0], [0.0001, 0]], 16)).rot(90, 0, 0).at(0, cy, cz), ...[0, 1, 2, 3, 4, 5].map((i) => stud([Math.cos(i * 1.047) * 0.042 * k, cy + Math.sin(i * 1.047) * 0.042 * k, cz + 0.005], [0, 0, 1], 0.005, 0x8a8a8e))]);
    G.lr('arm', sleeve(G, ml, { bump: [0.003, 60, 'weave'], end: 0.8, grow: 1.1 }));
    const pa = plateArm(G, trim, { mat: pm, pauldron: 0, upper: false, couter: false, hand: false });
    G.lr('fore', pa.fore, pa.foreH);
  }
  const sa = sash(G, 0.06 * k, c2, { h: 0.075, deg: 36, len: 0.22, fringe: trim, mat: silk });
  G.add('torso', sa.prims, [sa.hard, knife(G, 0.06 * k)]);
  if (!G.riding) G.lr('shin', [], [orient(silk(H.cone(0.016, 0.05, 6), shoe), [0, -P.shin - P.footH + 0.03, P.footLen * 0.82], [0, 0.9, 1]).lod(1)]);
  if (G.bare) return;
  if (mailOn) hoodShell(G, (x) => fin(x, mix(trim, 0xc0c0c0, 0.3), 0.45, 0.85, 0.18, 80), { grow: 0.07, bump: [0.003, 62, 'weave'], open: [0.66, 0.82], oy: -0.24 });
  const tb = turban(G, G.o.turban ?? 0xf0ead8, { size: mailOn ? 0.96 : 1.08, mat: silk, top: mailOn ? trim : c2, jewel: 0xc0202a, setting: trim, feather: [0x8a8474, c2, 0xf2ead0], tail: !mailOn });
  G.add('head', tb.prims, [tb.hard, mailOn && gold(H.lathe([[0.0001, 1.05], [0.04, 0.8], [0.1, 0.5], [0.3, 0.2], [0.52, 0.0]].map(([r, y]) => [r * R, y * R]), 12), trim).at(0, tb.y + R * 0.46, -R * 0.1)]);
};
HEADGEAR.silkRobe = true;

// ---- Shadow agent: close dark wraps, split-toed shoes, arm guards, a hood that leaves only the eyes ----
OUTFITS.shinobi = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.o.cloth2 ?? tone(c, 0, 0.02, 0.1), ironC = G.o.trim ?? 0x55565e, dk = tone(c, 0, 0, -0.05);
  const cm = (x) => cloth(x, c), wm = (x) => cloth(x, c2);
  G.add('torso', [torsoLayer(G, cm, { raise: 0.003 }),
    ...[-1, 1].map((s) => cloth(S.box(0.014, T * 0.9, 0.5, 0.002).rot(0, 0, s * 22).at(s * 0.01, T * 0.58, 0.25), c2).paint(0.003, 0.003)),            // crossed lapels
    wm(G.band(0.06 * k, 0.05, 0.7)).paint(0.004, 0.006), cloth(G.band(0.06 * k, 0.005, 0.7), dk).paint(0.002, 0.005),
    cloth(S.box(0.016, T * 2.2, 1, 0.003).rot(0, 0, -40).at(0, T * 0.52, 0), c2).paint(0.003, 0.005),                                           // sword cord
  ]);
  // the blade across the back, stars at the belt
  const zb = -(G.tp(T * 0.6).back + 0.02), e = G.tp(0.06 * k), d = norm3([0.72, 0.7, 0]);
  const star = SHAPES.star.map(([x, y]) => [x * 0.02, y * 0.02]);
  G.add('torso', [], [
    orient(fin(H.box(0.02, 0.36, 0.012, 0.004), 0x16161a, 0.4, 0.2), [0.01, T * 0.56, zb], d, [0, 0, 1]), orient(fin(H.box(0.036, 0.008, 0.03, 0.002), ironC, 0.4, 0.9), add3([0.01, T * 0.56, zb], mul3(d, 0.185)), d, [0, 0, 1]).lod(1),
    orient(wm(H.cyl(0.008, 0.008, 0.1, 6)), add3([0.01, T * 0.56, zb], mul3(d, 0.24)), d).lod(1),
    cloth(H.sphere(0.02, 8), c2).scale(1.2, 0.8, 0.6).at(0, 0.06 * k, -(e.back + 0.012)).lod(1), hang([0.01, 0.06 * k, -(e.back + 0.014)], 0.03, 0.1, c2, { yaw: 170 }), hang([-0.01, 0.06 * k, -(e.back + 0.014)], 0.03, 0.08, c2, { yaw: 195, sway: 2 }),
    ...[0, 1].map((i) => fin(H.extrude(star, 0.003, 0.001), ironC, 0.3, 1).rot(0, 0, i * 30).rot(0, -60, 0).at(-(e.side * 0.85 + 0.008), 0.06 * k + 0.004 - i * 0.012, e.zc + e.depth * 0.6 + i * 0.012).lod(1)),
  ]);
  skirt(G, { mat: cm, len: 0.075, flare: 0.03, top: 0.03, fold: 0.004 });
  armPaint(G, cm, 0.003);
  const rf = P.rFore, F = P.fore, rc = P.rCalf;
  G.lr('fore', [...[-1, 0, 1].map((i) => fin(S.box(rf * 0.5, F * 0.56, 1, 0.004).at(i * rf * 0.72, -F * 0.5, 0), ironC, 0.45, 0.8, 0.1, 30).paint(0.003, 0.004)), ...wraps(rf, [-F * 0.2, -F * 0.82, -F * 0.92], c2, 0.014, 0.0055), glove(G, cm)]);
  G.lr('arm', wraps(P.rUpper, [-P.upper * 0.5, -P.upper * 0.6], c2, 0.012, 0.004));
  hose(G, cm, { raise: 0.0035 });
  G.lr('leg', wraps(P.rThigh, [-P.thigh * 0.86, -P.thigh * 0.95], c2, 0.014, 0.005));
  G.lr('shin', [...wraps(rc, [-P.shin * 0.3, -P.shin * 0.43, -P.shin * 0.56, -P.shin * 0.69, -P.shin * 0.82], c2, 0.016, 0.0045),
    cm(S.box(0.3, P.footH + 0.06, 0.7, 0.004).at(0, -P.shin - P.footH + (P.footH + 0.06) / 2 - 0.014, 0.05)).paint(0.004, 0.003),                    // tabi
    fin(S.box(0.3, 0.012, 0.7, 0.003).at(0, -P.shin - P.footH + 0.004, 0.05), 0xb8a878, 0.9, 0).paint(0.003, 0.004),                                // straw sole
    fin(S.box(0.007, P.footH + 0.02, P.footLen * 0.5, 0).at(-0.01, -P.shin - P.footH * 0.5, P.footLen * 0.62), 0x0a0a0c, 0.9, 0).paint(0.002, -0.006),    // the split toe
  ]);
  for (const n of ['arm', 'fore', 'leg', 'shin']) G.cores(n, c);
  if (G.bare) return;
  hoodShell(G, cm, { grow: 0.09, open: [0.7, 0.2], oy: 0.07, inside: G.skin });
  { const hair = G.nodes.hair; if (hair) { hair.prims.length = 0; hair.hard.length = 0; } }      // no beard through the wrap
  // the wrap over nose and mouth goes on after the face, the brow cloth above the eyes
  G.add('head', [cm(S.ellipsoid(R * 0.74, R * 0.62, R * 0.62).at(0, -R * 0.56, R * 0.5)).blend(0.02), cm(S.ellipsoid(R * 0.3, R * 0.3, R * 0.3).at(0, -R * 0.3, R * 0.9)).blend(0.05), cm(S.ellipsoid(R * 0.8, R * 0.3, R * 0.5).at(0, R * 0.5, R * 0.62)).blend(0.02),
    ...[0, 1, 2].map((i) => cloth(S.box(R * 2, R * 0.03, R * 2, 0).rot(0, 0, 6).at(0, -R * (0.3 + i * 0.2), R * 0.6), dk).paint(0.002, -0.002)),
    fin(S.box(R * 0.9, R * 0.22, R * 0.4, R * 0.04).at(0, R * 0.5, R * 0.96), ironC, 0.4, 0.9).blend(0.004), wm(S.cyl(R * 1.5, R * 0.2, 0).rot(-4, 0, 0).at(0, R * 0.5, 0)).paint(0.003, 0.004)],
    [cloth(H.sphere(R * 0.16, 6), c2).at(0, R * 0.44, -R * 1.12).lod(1), hang([R * 0.06, R * 0.44, -R * 1.14], R * 0.3, R * 1.4, c2, { yaw: 165, wave: 0.16, out: 0.3 }), hang([-R * 0.06, R * 0.44, -R * 1.14], R * 0.3, R * 1.1, c2, { yaw: 200, sway: 2, wave: 0.16, out: 0.3 })]);
};
HEADGEAR.shinobi = true;

/** plaid: bands and bars of a second colour (and a fine overcheck) round a limb of radius r, from y0 down to y1 */
function plaid(c2, c3, r, y0, y1, step = 0.05) {
  const out = [], m2 = (x) => cloth(x, c2), m3 = (x) => cloth(x, c3), len = y0 - y1, yc = (y0 + y1) / 2;
  for (let y = y0 - step * 0.5; y > y1; y -= step) { out.push(m2(S.cyl(r * 3, step * 0.3, 0).at(0, y, 0)).paint(0.002, 0.0042), m3(S.cyl(r * 3, step * 0.06, 0).at(0, y - step * 0.5, 0)).paint(0.002, 0.0044)); }
  for (const i of [-1, 0, 1]) {
    out.push(m2(S.box(r * 0.34, len, 1, 0).at(i * r * 0.8, yc, 0)).paint(0.002, 0.0042), m2(S.box(1, len, r * 0.34, 0).at(0, yc, (i + 0.5) * r * 0.8)).paint(0.002, 0.0042));
    out.push(m3(S.box(r * 0.07, len, 1, 0).at((i + 0.5) * r * 0.8, yc, 0)).paint(0.002, 0.0044));
  }
  return out;
}
// ---- Hill tribesman: bare painted chest, plaid trousers, bronze at neck and arm; cloak: true pins a plaid over one shoulder ----
OUTFITS.woad = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, bz = G.o.trim ?? BRONZE, wc = G.o.paint ?? 0x3d5ea6, c3 = tone(c2, 0, -0.1, 0.25);
  const wp = (x) => fin(x, wc, 0.8, 0).paint(0.004, 0), bm = (x) => fin(x, bz, 0.36, 1, 0.08, 24);
  // woad: spirals on the breast, bars on the arms and across the eyes
  const ch = G.tp(G.chestY), bk = G.tp(T * 0.6);
  G.add('torso', [
    ...[-1, 1].flatMap((s) => [wp(S.torus(0.03 * k, 0.006).rot(90, 0, 0).at(s * ch.side * 0.48, G.chestY + 0.01, ch.front)), wp(S.torus(0.013 * k, 0.005).rot(90, 0, 0).at(s * ch.side * 0.48, G.chestY + 0.01, ch.front)),
      wp(S.box(0.012, 0.1 * k, 0.3, 0).rot(0, 0, s * 30).at(s * ch.side * 0.3, 0.13 * k, ch.front)), wp(S.box(0.012, 0.08 * k, 0.3, 0).rot(0, 0, s * 30).at(s * ch.side * 0.52, 0.12 * k, ch.front))]),
    wp(S.torus(0.05 * k, 0.007).rot(90, 0, 0).at(0, T * 0.62, -bk.back)), wp(S.torus(0.024 * k, 0.006).rot(90, 0, 0).at(0, T * 0.62, -bk.back)), wp(S.box(0.012, 0.16 * k, 0.3, 0).at(0, T * 0.3, -bk.back)),
  ]);
  G.lr('arm', [wp(S.cyl(P.rUpper * 3, 0.012, 0).rot(0, 0, 16).at(0, -P.upper * 0.3, 0)), wp(S.cyl(P.rUpper * 3, 0.012, 0).rot(0, 0, 16).at(0, -P.upper * 0.42, 0)), bm(G.band(-P.upper * 0.62, 0.022, P.rUpper * 3)).paint(0.003, 0.006), fin(G.band(-P.upper * 0.62, 0.005, P.rUpper * 3), tone(bz, 0, 0, -0.18), 0.4, 1).paint(0.002, 0.005)]);
  G.lr('fore', [...bracer(G, 0x4a3524, { from: 0.45, to: 0.92, raise: 0.005 }), wp(S.cyl(P.rFore * 3, 0.012, 0).rot(0, 0, -14).at(0, -P.fore * 0.24, 0))]);
  G.add('head', [...[-1, 1].map((s) => wp(S.box(R * 0.5, R * 0.1, R * 0.8, 0).rot(0, 0, s * 20).at(s * R * 0.5, -R * 0.14, R * 0.7))), wp(S.box(R * 0.1, R * 0.4, R * 0.4, 0).at(0, R * 0.48, R * 0.9))]);
  // torc with ball terminals
  const nr = P.rNeck;
  G.add('torso', [bm(S.torus(nr * 1.22, 0.009).rot(-10, 0, 0).at(0, T + 0.016, 0)).blend(0.003).bump(0.003, 80, 'ridges')], [-1, 1].map((s) => bm(H.sphere(0.013, 8)).at(s * 0.014, T + 0.004, nr * 1.2 + 0.006).lod(1)));
  // trousers, belt
  hose(G, (x) => cloth(x, c), { raise: 0.004 });
  G.lr('leg', [cloth(S.capsule([0, -P.thigh * 0.08, 0], [0, -P.thigh * 0.9, 0], P.rThigh * 1.16, P.rCalf * 1.3), c).blend(0.02), ...plaid(c2, c3, P.rThigh, P.thigh * 0.2, -P.thigh * 1.1)]);
  G.lr('shin', [cloth(S.capsule([0, -P.shin * 0.04, 0], [0, -P.shin * 0.7, 0], P.rCalf * 1.24, P.rAnkle * 1.5), c).blend(0.02), ...plaid(c2, c3, P.rCalf, 0, -P.shin * 0.78), ...wraps(P.rAnkle * 1.5, [-P.shin * 0.74, -P.shin * 0.86], 0x4a3524, 0.012, 0.004)]);
  boots(G, { top: 0.14, color: 0x4a3524, cuff: 0.02 });
  G.cores('leg', c); G.cores('shin', c);
  const sk = skirt(G, { mat: (x) => cloth(x, c), len: 0.07, flare: 0.016, top: 0.03, grow: 0.008 });
  if (sk) G.add('root', plaid(c2, c3, sk.rTop + sk.ox, sk.y1, sk.y1 - 0.09).filter((x, i) => i < 4 || i % 2 === 0));
  const y = 0.05 * k, e = G.tp(y), b = belt(G, y, { h: 0.034, color: 0x3a2a1e, buckle: false }), pch = pouch(G, y, -30, { size: 1.2, color: 0x5a3c26 });
  G.add('torso', [b.prims, pch.prims], [pch.hard, bm(H.cyl(0.026, 0.026, 0.008, 12)).rot(90, 0, 0).at(0, y, e.front + 0.014).lod(1), bm(H.torus(0.016, 0.004, 10, 5)).at(0, y, e.front + 0.02).lod(1)]);
  if (!G.o.cloak) return;
  // the cloak: gathered on the left shoulder under a ring brooch
  const mm = (x) => cloth(x, c).bump(0.004, 16, 'noise');
  G.add('torso', [mm(S.ellipsoid(0.06 * k, 0.04 * k, G.cd * 1.1).at(G.sx - 0.06, T - 0.012, -0.012)).blend(0.014), mm(rod([G.sx - 0.08, T - 0.02, G.cd * 0.7], [-G.sx * 0.3, T - 0.07 * k, -G.cd * 1.0], 0.03, 0.03)).blend(0.02),
    cloth(S.box(0.07 * k, T * 1.2, 0.4, 0.004).rot(0, 0, -34).at(G.cw * 0.5, T * 0.74, 0.2), c).paint(0.004, 0.006)],
    [bm(H.torus(0.022, 0.005, 14, 5)).rot(-30, 20, 0).at(G.sx - 0.07, T - 0.045, G.tp(T - 0.05).front * 0.8 + 0.022).lod(1), bm(H.cyl(0.003, 0.003, 0.06, 5)).rot(-30, 20, 40).at(G.sx - 0.07, T - 0.045, G.tp(T - 0.05).front * 0.8 + 0.026).lod(1)]);
  cape(G, { color: c, len: 0.56, slope: 0.28, width: G.sx * 2.4, ragged: 0.02, nu: 24, nv: 20, foldAmp: 0.03,
    pattern: (u, v) => { const a = (u * 8) % 1, b2 = (v * 9) % 1; return (a < 0.3) !== (b2 < 0.3) ? c2 : a < 0.3 && b2 < 0.3 ? tone(c2, 0, 0, -0.12) : Math.abs(a - 0.65) < 0.05 || Math.abs(b2 - 0.65) < 0.05 ? c3 : null; } });
};

// ---- Tiger guard: gilded scale, an ornate turban, a tiger's skin for a cloak ----
OUTFITS.tigerPelt = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, trim = G.trim, gC = G.o.armor ?? trim, tg = 0xd9862c, blk = 0x1c1612, cream = 0xf0e4c8;
  const sc = (x) => fin(x, gC, 0.3, 1, 0.05, 30), cm = (x) => cloth(x, c);
  G.add('torso', [torsoLayer(G, cm, { raise: 0.002 }), ...torsoShells(G, (x) => sc(x).bump(0.005, 44, 'scales'), { grow: 0.013, blend: 0.02, hips: false }), gold(G.band(T - 0.076 * k, 0.012), tone(gC, 0, 0, -0.1)).paint(0.003, 0.002)]);
  const sa = sash(G, 0.055 * k, c2, { h: 0.06, deg: -40, len: 0.18, fringe: trim, mat: silk });
  G.add('torso', sa.prims, [sa.hard, knife(G, 0.055 * k)]);
  const len = Math.min(0.24, P.hipY - 0.24);
  const sk = skirt(G, { mat: cm, top: 0.03, len, flare: 0.055, fold: 0.008, hem: { color: trim, h: 0.012, rough: 0.5, metal: 0.7 } });
  if (sk) G.add('root', [sc(S.cone(sk.rTop + 0.034, sk.rTop + 0.008, 0.13, 0.01).at(0, sk.y1 - 0.06, sk.zc)).blend(0.004).bump(0.005, 44, 'scales'), gold(G.band(sk.y1 - 0.128, 0.008), tone(gC, 0, 0, -0.1)).paint(0.003, 0.002)]);
  const r = P.rUpper;
  G.lr('arm', [cm(S.cyl(r * 3, P.upper * 1.6, 0).at(0, -P.upper * 0.5, 0)).paint(0.005, 0.002), sc(S.ellipsoid(r * 1.2, r * 1.36, r * 1.3).at(r * 0.26, -r * 0.5, 0)).blend(0.008).bump(0.005, 46, 'scales'), sc(S.capsule([0, -r * 0.4, 0], [0, -P.upper * 0.66, 0], r * 1.2, r * 1.14)).blend(0.006).bump(0.005, 46, 'scales')]);
  const pa = plateArm(G, gC, { mat: sc, pauldron: 0, upper: false, couter: false, hand: false, trim: tone(gC, 0, 0, -0.14) });
  G.lr('fore', [cm(S.cyl(P.rFore * 3, P.fore * 1.14, 0).at(0, -P.fore * 0.45, 0)).paint(0.005, 0.002), ...pa.fore], pa.foreH);
  const tr = tone(c, 0, -0.04, -0.08), bootC = 0x7a3a22;
  hose(G, (x) => cloth(x, tr), { raise: 0.004 });
  G.lr('leg', [cloth(S.capsule([0, -P.thigh * 0.1, 0], [0, -P.thigh * 0.86, 0], P.rThigh * 1.24, P.rThigh * 1.16), tr).blend(0.02).bump(0.003, 16, 'fur')]);
  boots(G, { top: 0.6, color: bootC, cuff: 0.05 });
  if (!G.riding) G.lr('shin', [], [orient(leather(H.cone(0.016, 0.045, 6), bootC), [0, -P.shin - P.footH + 0.03, P.footLen * 0.84], [0, 0.9, 1]).lod(1)]);
  G.cores('arm', gC); G.cores('fore', gC); G.cores('leg', tr); G.cores('shin', bootC);
  // the tiger: forelegs knotted at the throat, the skin down the back, the tail swinging
  const tf = furM(tg, 0.007, 36), stripe = (x) => fin(x, blk, 0.9, 0).paint(0.003, 0.0005);
  const paw = (s) => tf(rod([s * (G.sx - 0.04), T - 0.02, G.tp(T - 0.05).front * 0.5], [s * 0.02, T - 0.1 * k, G.tp(T - 0.1 * k).front + 0.012], 0.032, 0.024)).blend(0.012);
  G.add('torso', [...mantle(G, tf, { drop: 0.05, reach: 0.03 }), paw(1), paw(-1), ...[-3, -2, -1, 1, 2, 3].map((i) => stripe(S.box(0.012, 0.16, 0.6, 0).rot(0, 0, i * 6).at(i * G.sx * 0.3, T - 0.03, 0)))],
    [fin(H.sphere(0.024, 8), cream, 0.9, 0).scale(1.2, 0.9, 0.8).at(0, T - 0.105 * k, G.tp(T - 0.1 * k).front + 0.03).lod(1)]);
  const cp = cape(G, { color: tg, len: 0.62, slope: 0.27, width: G.sx * 2.5, wTop: G.sx * 0.95, ragged: 0.03, foldAmp: 0.026, nu: 30, nv: 28, off: 0.02,
    pattern: (u, v) => { const d = Math.abs(u - 0.5); return d > 0.42 ? cream : Math.sin(v * 40 + Math.sin(u * 9) * 2.0 - d * 14) > 0.5 && d > 0.03 ? blk : d > 0.36 ? mix(tg, cream, 0.5) : null; } });
  const t0 = cp.at(0.5, 0.97);
  G.add('torso', [], [furOrPlain(H.tube([t0, [t0[0] + 0.02, t0[1] - 0.08, t0[2] - 0.02], [t0[0] + 0.03, t0[1] - 0.17, t0[2] - 0.01], [t0[0] + 0.01, t0[1] - 0.22, t0[2] + 0.02]], [0.016, 0.014, 0.012, 0.008], 12, 6), tg).shade((x, y) => (Math.floor((t0[1] - y) / 0.022) % 2 ? blk : null))]);
  if (G.bare) return;
  const tb = turban(G, c, { size: 1.06, mat: silk, top: c2, jewel: 0x2fb6a8, setting: trim, feather: [0x8a8474, cream, tg] });
  G.add('head', [...tb.prims, silk(S.cyl(G.R * 1.6, G.R * 0.14, 0).rot(0, 0, 24).at(0, tb.y, 0), c2).paint(0.003, 0.003)], tb.hard);
};
const furOrPlain = (h, c) => cloth(h, c);
HEADGEAR.tigerPelt = true;

/** a prayer scroll pinned at p: parchment with lines of script and a wax seal */
function scroll(p, w, len, yaw = 0, o = {}) {
  return [
    hang(p, w, len, PARCH, { yaw, taper: 0, wave: 0.05, out: o.out ?? 0.06, nv: 6, sway: o.sway ?? 0, lod: o.lod ?? 1, shade: (x, y) => (Math.abs(x) < w * 0.34 && Math.floor(-y / (len / 7)) % 2 === 1 && y > -len * 0.92 ? 0x4a3a2a : null) }),
    fin(H.cyl(w * 0.34, w * 0.34, 0.006, 8), 0x9a1c1c, 0.4, 0).rot(90, 0, 0).rot(0, yaw, 0).at(p[0], p[1] - 0.006, p[2]).lod(1),
  ];
}
// ---- War priest: a heavy habit, a collar of iron, reliquaries and scrolls of scripture. hat: 'mitre' or the cowl ----
OUTFITS.gothicHabit = (G) => {
  const { T, k, P, R } = G, c = G.cloth, c2 = G.c2, trim = G.trim, ironC = G.armor, dev = typeof G.o.device === 'string' && SHAPES[G.o.device] ? G.o.device : 'cross';
  const im = (x) => fin(x, ironC, 0.45, 0.9, 0.14, 22);
  const sk = robe(G, c, { bell: 2.1, flare: 0.11, fold: 0.012, hem: { color: tone(c, 0, 0, -0.1), h: 0.022 }, panel: { mat: (x) => cloth(x, c2), w: 0.36, raise: 0.004, trim } });
  const sw = G.cw * 1.24;
  G.add('torso', [pbox((x) => cloth(x, c2), sw, T + 0.2, [0, T / 2 - 0.085, 0], 0.005), ...[-1, 1].map((s) => pbox((x) => gold(x, trim), 0.012, T + 0.2, [s * (sw / 2 - 0.006), T / 2 - 0.085, 0], 0.0065))]);
  const f = G.field('torso');
  G.add('torso', [], [decal(G, 'torso', dev, { field: f, at: [0, G.chestY - 0.03 * k, 0], size: 0.046 * k, color: trim, rough: 0.4, metal: 0.8, lift: 0.003 })]);
  // the collar: iron over the shoulders, a ring of rivets, a high throat
  const col = mantle(G, im, { drop: 0.05, reach: 0.02, trim });
  const e2 = G.tp(T - 0.05), rv = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.26; rv.push(stud([Math.sin(a) * (G.sx - 0.01) * 0.86, T - 0.012, e2.zc + Math.cos(a) * (e2.depth + 0.02) * 0.86], [Math.sin(a) * 0.5, 1, Math.cos(a) * 0.5], 0.007, trim)); }
  G.add('torso', [...col, im(S.cone(P.rNeck * 2.0, P.rNeck * 1.4, 0.06, 0.008).at(0, T + 0.026, -0.006)).blend(0.004), gold(S.torus(P.rNeck * 1.42, 0.007).at(0, T + 0.056, -0.006), trim).blend(0.003)], rv);
  // belt of rope and chain: a reliquary, a book, scrolls
  const y = 0.055 * k, e = G.tp(y), rb = ropeBelt(G, y, 0x9a8a5c, { len: 0.16, kx: -0.04 });
  const rx = e.side * 0.62, rz = e.zc + e.depth * 0.78 + 0.02;
  G.add('torso', rb.prims, [rb.hard, tome(G, y, -84, { color: 0x3a1c1c }),
    chain([[rx, y, rz - 0.008], [rx + 0.004, y - 0.04, rz], [rx, y - 0.075, rz]], 0.0035, trim, { metal: 1, rough: 0.3 }),
    gold(H.box(0.036, 0.046, 0.024, 0.006), trim).at(rx, y - 0.1, rz).lod(1), gold(H.cone(0.022, 0.02, 4), trim).rot(0, 45, 0).at(rx, y - 0.068, rz).lod(1), gem(H.sphere(0.008, 6), 0xb0202a, 0.5).at(rx, y - 0.1, rz + 0.013).lod(1),
    scroll([-e.side * 0.3, y - 0.008, e.front + 0.02], 0.034, 0.15, 0, { lod: 99 }), scroll([e.side * 0.2, y - 0.008, e.front + 0.02], 0.028, 0.1, 8, { sway: 2 }),
    scroll([-G.cw * 0.62, T - 0.07 * k, G.tp(T - 0.08 * k).front * 0.86 + 0.012], 0.03, 0.12, -14, { sway: 1 }), scroll([0.02, T * 0.6, -(G.tp(T * 0.6).back + 0.016)], 0.036, 0.16, 180, { sway: 3 }),
  ]);
  const pa = plateArm(G, ironC, { mat: im, pauldron: 1.12, lames: 1, upper: false, couter: false, fore: false, trim });
  G.add('armL', pa.arm, [pa.armH, scroll([P.rUpper * 1.5, -P.rUpper * 0.4, P.rUpper * 0.4], 0.028, 0.09, 70, { sway: 4 })]);
  G.lr('fore', [im(G.band(-P.fore * 0.86, 0.024, P.rFore * 5)).paint(0.003, 0.003)]);
  if (G.bare) return;
  if (G.o.hat === 'mitre') { mitre(G, c2, trim); return; }
  hoodShell(G, (x) => cloth(x, c), { grow: 0.16, open: [0.72, 0.9], oy: -0.2, peak: 0.36, deep: 0.5, bump: [0.004, 16, 'noise'], inside: 0x100e10 });
  G.add('head', [gold(S.torus(R * 0.82, R * 0.045).rot(90, 0, 0).at(0, -R * 0.2, R * 1.0), trim).paint(0.004, 0.002)]);
};
HEADGEAR.gothicHabit = true;

// ---- The bloated: sores, rusted chain and bells, rags that never close over the belly ----
OUTFITS.bloat = (G) => {
  const { T, k, P } = G, c = G.cloth, dk = tone(c, 0, 0, -0.09), ironC = 0x6a4e3a, r = rng(hashStr(G.id + ':sores'));
  const f = G.field('torso'), sore = (p, rr) => [fin(S.sphere(rr * 1.9).at(p[0], p[1], p[2]), mix(G.skin, 0x8a2a2a, 0.45), 0.8, 0).paint(rr, 0.0008), fin(S.sphere(rr).at(p[0], p[1], p[2]), 0x6e1a1c, 0.35, 0).paint(0.004, 0.003), fin(S.sphere(rr * 0.5).at(p[0], p[1], p[2]), 0xd6c56a, 0.3, 0).paint(0.003, 0.0045)];
  const sores = [];
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + r() * 0.4, y = lerp(0.03, T * 0.88, r()), p = trace(f, [Math.sin(a) * 0.9, y, Math.cos(a) * 0.9], [-Math.sin(a), 0, -Math.cos(a)], 1.2);
    if (p) sores.push(...sore(p, (0.011 + r() * 0.012) * k));
  }
  G.add('torso', sores);
  G.lr('arm', sore([P.rUpper * 0.95, -P.upper * 0.4, P.rUpper * 0.3], 0.01)); G.add('foreL', sore([P.rFore * 0.8, -P.fore * 0.5, P.rFore * 0.5], 0.009));
  G.add('legR', sore([-P.rThigh * 0.7, -P.thigh * 0.6, P.rThigh * 0.7], 0.012)); G.add('shinL', sore([P.rCalf * 0.6, -P.shin * 0.4, P.rCalf * 0.7], 0.009));
  // a gash sewn shut across the belly
  const gy = 0.1 * k, gp = [];
  for (let i = -3; i <= 3; i++) gp.push([i * G.tp(gy).side * 0.14 + 0.02, gy + i * 0.006, 0.9]);
  G.add('torso', [fin(S.box(G.tp(gy).side * 0.95, 0.01, 0.6, 0).rot(0, 0, 8).at(0.02, gy, 0.3), 0x5a1a1c, 0.5, 0).paint(0.004, -0.002)], studs(G, 'torso', gp.flatMap((q) => [[q[0], q[1] + 0.012, q[2]], [q[0], q[1] - 0.012, q[2]]]), { field: f, dir: [0, 0, -1], r: 0.0045, color: 0x1a1410, rough: 0.9, metal: 0 }));
  // a vest split wide over the gut, a torn wrap round the hips
  const ch = G.tp(G.chestY);
  G.add('torso', [...[-1, 1].map((s) => pbox((x) => cloth(x, c), 1, T * 0.62, [s * (0.5 + ch.side * 0.52), T * 0.66, 0], 0.004)), cloth(S.box(1, T * 0.62, 0.5, 0.004).at(0, T * 0.66, -0.25 - ch.back * 0.3), c).paint(0.004, 0.004),
    fin(G.band(0.04 * k, 0.022, 0.9), ROPE, 0.9, 0, 0.1, 70).paint(0.004, 0.006)],
    tatters(G, { n: 14, y: T * 0.37, len: 0.04, w: 0.05, colors: [dk, c], ring: (a) => { const e = G.tp(T * 0.36), q = [Math.sin(a) * (e.side + 0.006), e.zc + Math.cos(a) * (e.depth + 0.006)]; return Math.cos(a) > 0.45 ? [q[0] * 3, q[1] + 3] : q; }, flare: -0.1, seed: 'vest', lean: P.hunch }).filter((h) => h.m.elements[14] < 1));
  const sk = skirt(G, { mat: (x) => cloth(x, dk), len: 0.09, flare: 0.03, top: 0.03, fold: 0.006 });
  if (sk) G.add('root', [], [tatters(G, { n: 13, y: sk.y1 - sk.len + 0.02, len: 0.11, w: 0.06, colors: [c, dk, tone(c, 0.02, 0, 0.07)], ring: hemRing(sk, -0.006), flare: 0.18 }), flap(G, sk, -1, { color: c, len: 0.24, w: 0.13, ragged: 0.07 }), flap(G, sk, 1, { color: dk, len: 0.15, w: 0.07, ragged: 0.08 })]);
  // chains: one over the shoulder, one slung under the belly with bells on it; a hook
  const a = Math.atan2(G.sx * 1.5, T) / DEG, cm = (x) => fin(x, ironC, 0.7, 0.6, 0.25, 60);
  const f2 = G.field('torso'), sw = drape(f2, [-G.tp(0.09 * k).side * 0.98, 0.1 * k], [G.tp(0.09 * k).side * 0.98, 0.1 * k], 0.045 * k, 9, 0.01);
  const bell = (p, s) => [fin(H.lathe([[0.0001, 1.0], [0.3, 0.96], [0.5, 0.7], [0.6, 0.2], [0.9, 0.0], [0.8, -0.04], [0.5, 0.1]].map(([x, y]) => [x * s, y * s]), 8), 0x8a6a3a, 0.6, 0.8).at(p[0], p[1] - s * 1.5, p[2] + 0.004).lod(1), iron(H.sphere(s * 0.22, 5), 0x3a3a3e).at(p[0], p[1] - s * 1.5, p[2] + 0.004).lod(1), chain([p, [p[0], p[1] - s * 0.5, p[2] + 0.004]], 0.003, ironC, { n: 3 })];
  G.add('torso', [cm(S.box(0.026, T * 2.4, 1, 0.004).rot(0, 0, a).at(0, T * 0.52, 0)).paint(0.003, 0.007).bump(0.003, 60, 'ridges')], [
    chain(sw, 0.0065, ironC), bell(sw[2], 0.026 * k), bell(sw[5], 0.032 * k), bell(sw[7], 0.022 * k),
    iron(H.tube([sw[4], [sw[4][0], sw[4][1] - 0.05, sw[4][2] + 0.01], [sw[4][0] + 0.02, sw[4][1] - 0.075, sw[4][2] + 0.012], [sw[4][0] + 0.035, sw[4][1] - 0.05, sw[4][2] + 0.012]], [0.005, 0.005, 0.005, 0.001], 10, 5), 0x4a4038).lod(1),
  ]);
  const F = P.fore, rw = P.rWrist;
  const man = [iron(S.cyl(rw * 2.6, 0.034, 0).at(0, -F * 0.86, 0), ironC).paint(0.003, 0.008)];
  G.add('foreL', man, [chain([[rw * 1.3 + 0.004, -F * 0.86, 0], [rw * 1.3 + 0.012, -F * 0.86 - 0.06, 0.006], [rw * 1.3 + 0.004, -F * 0.86 - 0.12, -0.004]], 0.006, ironC)]); G.add('foreR', man.map((x) => x.mirrorX()));
  G.add('shinR', [iron(S.cyl(P.rAnkle * 3, 0.03, 0).at(0, -P.shin * 0.86, 0), ironC).paint(0.003, 0.008)]);
};


OUTFITS.none = () => {};

// ---- anything else: dress by the descriptor's flags ----
function fallback(G) {
  const { o, k } = G;
  if (o.outfit === 'none') return;
  const c = G.cloth;
  if (o.robe) robe(G, c, {});
  else {
    G.add('torso', [torsoLayer(G, (x) => cloth(x, c), { raise: 0.004 })]);
    skirt(G, { mat: (x) => cloth(x, c), len: 0.13, flare: 0.04, fold: 0.006 });
    G.lr('arm', sleeve(G, (x) => cloth(x, c)));
    G.cores('arm', c);
  }
  const b = belt(G, 0.05 * k, {});
  G.add('torso', b.prims, b.hard);
  if (o.armor) { const cu = cuirass(G, o.armor, {}); G.add('torso', cu.prims, cu.hard); }
  if (o.hood) hoodShell(G, (x) => cloth(x, c), { grow: 0.15, peak: 0.4 });
  else if (o.helm) G.add('head', [], helmShell(G, 'cap', (x) => steel(x, o.armor ?? 0x9aa3ad), {}).hard);
}

/** headgear an outfit brings although the descriptor has no helm / hood flag: the body leaves scalp hair off under it */
export function headCover(def, o) {
  asked = o;
  if (HEADGEAR[o.outfit]) { const hg = HEADGEAR[o.outfit]; return !o.bare && (typeof hg === 'function' ? !!hg(o) : true); }
  return o.outfit === 'lancer' || o.outfit === 'skyKnight';
}

export function dress(ctx) {
  const G = kit(ctx);
  try {
    (OUTFITS[ctx.o.outfit] || fallback)(G);
  } catch (err) {
    console.warn(`[models] gear: outfit "${ctx.o.outfit}" for ${G.id} failed, the unit is left partly dressed`, err);
  }
  asked = null;
}
