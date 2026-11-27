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
  // mitre: two peaks, a gold band and orphrey, lappets behind
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
}
