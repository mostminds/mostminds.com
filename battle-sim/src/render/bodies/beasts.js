// Beasts and mounts: the dire wolf, the giant spider, the vampire bat and the three mounted units.
//
//   bodies.quadruped(def, o)  dire wolf                                   kind 'beast.quad'    attack 'bite'
//   bodies.rider(def, o)      lancer (horse), wolf rider, griffon rider   kind 'beast.rider'   attack / hold from the rider's weapon
//   bodies.spider(def, o)     giant spider                                kind 'beast.spider'  attack 'bite'
//   bodies.bat(def, o)        vampire bat                                 kind 'beast.bat'     attack 'bite'
//
// Authoring convention (the same one monsters.js uses): a model is laid out in ONE space, its rest pose (Y up,
// facing +Z, feet on y = 0). Every node records the point it pivots about (`o`); finish() moves each node's pieces
// into the node's own space, works out its position under its parent, and can scale the whole animal (the war-wolf
// and the horse are built at one size and scaled, the rider is scaled separately). Heads and jaws are authored in
// their own tilted frame instead (they carry `pos` / `rot`).
//
// Rig keys beyond the stock ones (animate.js), all driven by the animators at the bottom of each section:
//   paws        four-legged beasts: the third segment of each leg (paw, hoof or talons). `legs` (upper), `shins`
//               (middle) and `paws` are each [front-left, front-right, back-left, back-right]
//   body, mneck, mhead, mjaw   a MOUNT's trunk, neck, head and jaw. Its rider keeps the stock upper-body keys
//               (torso, head, arms, forearms, hands, weapon), so base.upperBody and humanoid's poseCarried work on it.
//               A beast without a rider uses the stock torso / neck / head / jaw.
//   wingskins   bat: the skin between arm and flank, a child of each wing, squeezed shut when the wing folds
//   abdomen, palps   spider: the abdomen and the two pedipalps. Its eight `legs` / `shins` are ordered
//               L1 R1 R2 L2 L3 R3 R4 L4, so alternate entries form the two gait groups; each leg reaches out along
//               its own local X, so lifting is a rotation about local Z and sweeping one about local Y.
// Plain values on the description that the animators read from the rig: gait ('wolf' | 'horse' | 'griffon'),
// mount, hold, feathered (griffon wings), hingeX/Y/Z (the axis the bat's hand folds about).
// Fliers (griffon, bat) are built with their wings spread; the animators fold them on the ground and blend
// between the two as `flying` changes.
import * as THREE from 'three';
import { S, H, rgb, noise3, distanceField } from '../sculpt.js';
import { proportions } from './anatomy.js';
import { humanoid, poseCarried } from './humanoid.js';

const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => mul3(a, 1 / (len3(a) || 1e-9));
const flat = (x) => [x].flat(Infinity).filter(Boolean);
const mirX = (v) => [-v[0], v[1], v[2]];

// ---------- deterministic variation ----------
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- colour ----------
const _c = new THREE.Color(), _c2 = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };
/** shift a colour in hue / saturation / lightness (sRGB terms) */
function tone(hex, dh = 0, ds = 0, dl = 0) {
  _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace);
  _c.setHSL(((_hsl.h + dh) % 1 + 1) % 1, clamp(_hsl.s + ds), clamp(_hsl.l + dl), THREE.SRGBColorSpace);
  return _c.getHex();
}
function mix(a, b, t) { return _c.set(a).lerp(_c2.set(b), t).getHex(); }
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

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
/** tapered capsule from a to b whose local Y follows the bone, so fur strands and ridges run along it */
function bone(a, b, ra, rb = ra, zHint) { return orient(S.capsule([0, 0, 0], [0, len3(sub3(b, a)), 0], ra, rb), a, sub3(b, a), zHint); }
/** ellipsoid given by its radii in model X / Y / Z whose local Y lies along model Z: fur on it runs nose to tail */
const lay = (rx, ry, rz) => S.ellipsoid(rx, rz, ry).rot(90, 0, 0);
/** smooth curve through points (Catmull-Rom), n samples */
function curve(pts, n) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const out = [];
  for (let i = 0; i <= n; i++) { const v = c.getPoint(i / n); out.push([v.x, v.y, v.z]); }
  return out;
}
/** walk from `from` along `dir` until the surface of a compiled distance field */
function surfHit(df, from, dir, maxSteps = 22) {
  const u = norm3(dir);
  let p = from.slice();
  for (let i = 0; i < maxSteps; i++) { const d = df(p[0], p[1], p[2]); if (d < 0.0008) break; p = add3(p, mul3(u, d)); }
  return p;
}

const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

// ---------- nodes ----------
/** start a node: o = the point it pivots about, in the space its pieces are authored in */
function node(name, parent, o, extra = {}) { return { name, parent, o, prims: [], hard: [], ...extra }; }
/** move every node's pieces into its own space (and scale the whole model by s) and produce what rigkit wants */
function finish(nodes, s = 1) {
  const by = new Map(nodes.map((n) => [n.name, n]));
  return nodes.map((n) => {
    const par = n.parent ? by.get(n.parent) : null;
    let pos = n.pos ?? (par ? sub3(n.o, par.o) : n.o);
    const prims = flat(n.prims), hard = flat(n.hard);
    if (n.o[0] || n.o[1] || n.o[2]) { for (const p of prims) p.at(-n.o[0], -n.o[1], -n.o[2]); for (const h of hard) h.at(-n.o[0], -n.o[1], -n.o[2]); }
    if (s !== 1) { for (const p of prims) p.scale(s); for (const h of hard) h.scale(s); pos = mul3(pos, s); }
    const out = { name: n.name, pos, prims, hard };
    if (n.parent) out.parent = n.parent;
    if (n.rig) out.rig = n.rig;
    if (n.rot) out.rot = n.rot;
    if (n.detail) out.detail = n.detail;
    if (n.minRes) out.minRes = n.minRes;
    return out;
  });
}
const mirrorAll = (list) => flat(list).map((p) => p.mirrorX());

// ---------- crisp pieces ----------
/** a curved cone pointing along +Y from the origin, hooking toward +Z: claws, fangs, talons */
function clawGeo(hook, aspect, flatX = 1) {
  return cached(`claw${hook}:${aspect}:${flatX}`, () => {
    const g = new THREE.ConeGeometry(aspect, 1, 8, 5);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setXYZ(i, p.getX(i) * flatX, y, p.getZ(i) + hook * y * y); }
    g.computeVertexNormals();
    return g;
  });
}
function claw(len, r, color, hook = 0.3, flatX = 1) { return H.geo(clawGeo(hook, Math.max(0.05, Math.round((r / len) * 20) / 20), flatX)).scale(len).color(color).pbr(0.32, 0); }
/** claw from base pointing along dir, hooking toward `toward` */
const spike = (base, dir, len, r, color, toward = [0, 0, 1], hook = 0.3, flatX = 1) => orient(claw(len, r, color, hook, flatX), base, dir, toward);

/** a lock of fur: a flattened, curling ogive along +Y (unit length), curling toward +Z */
function lockGeo(hook, wide, thick) {
  return cached(`lock${hook}:${wide}:${thick}`, () => {
    const g = new THREE.ConeGeometry(1, 1, 6, 4, true);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), lin = Math.max(1e-4, 1 - y), r = Math.pow(Math.max(0, 1 - Math.pow(y, 1.6)), 0.9) / lin;
      p.setXYZ(i, p.getX(i) * r * wide, y, p.getZ(i) * r * thick + hook * y * y);
    }
    g.computeVertexNormals();
    return g;
  });
}
/** a lock of fur from base along dir, curling toward `toward`; colours run root -> tip */
function lock(base, dir, len, wide, thick, colA, colB, toward = [0, -1, 0], hook = 0.25) {
  const q = (v) => Math.max(0.04, Math.round((v / len) * 25) / 25);
  const a = rgb(colA), b = rgb(colB);
  const h = H.geo(lockGeo(hook, q(wide), q(thick))).shade((x, y) => mixRgb(a, b, smooth((y - 0.15) / 0.8))).color(colA).pbr(0.95).scale(len);
  return orient(h, base, dir, toward);
}

/** eyeball: a lathe whose pole faces +Y, with rings placed exactly on the pupil and iris edges so they stay crisp */
function eyeGeo() {
  return cached('eye', () => {
    const angles = [112, 92, 76, 60, 46, 34.4, 33.6, 25, 16.4, 15.6, 9, 0];
    const prof = angles.map((a) => { const r = 1 + 0.05 * Math.max(0, Math.cos(Math.min(90, a * 2.4) * DEG)); return new THREE.Vector2(Math.max(1e-5, Math.sin(a * DEG) * r), Math.cos(a * DEG) * r); });
    return new THREE.LatheGeometry(prof, 16);
  });
}
/** eye(r, look) -> hard piece centred on the origin looking along +Z. look: { iris, pupil, white, rim, slit, glow } */
function eye(r, look = {}) {
  const iris = look.iris ?? 0xffb62a, white = look.white ?? 0x1c1410, pupil = look.pupil ?? 0x070606, rim = look.rim ?? tone(iris, -0.02, 0.05, -0.2);
  const pA = Math.sin(16 * DEG) * (look.pupilSize ?? 1), iA = Math.sin(34 * DEG) * (look.irisSize ?? 1);
  const h = H.geo(eyeGeo()).shade((x, y, z) => {
    if (y < 0.2) return null;
    const d = Math.hypot(x, z);
    if (look.slit) { if (Math.abs(x) < pA * 0.42 && Math.abs(z) < iA * 0.86) return pupil; } else if (d < pA * 1.01) return pupil;
    if (d < iA * 0.84) return iris;
    if (d < iA) return rim;
    return null;
  }).color(white).pbr(0.12, 0);
  if (look.glow) h.glow(look.glow);
  return h.scale(r).rot(90, 0, 0);
}

// =====================================================================================
//  Fur: clumps that lie on a sculpted surface like shingles, plus crisp locks at their tips
// =====================================================================================

/** outward normal of a compiled distance field at p */
function gradAt(df, p) {
  const e = 0.004;
  return norm3([df(p[0] + e, p[1], p[2]) - df(p[0] - e, p[1], p[2]), df(p[0], p[1] + e, p[2]) - df(p[0], p[1] - e, p[2]), df(p[0], p[1], p[2] + e) - df(p[0], p[1], p[2] - e)]);
}
/**
 * One clump of fur on the surface `df`, found by walking from `from` along `ray`, combed along `flow`.
 * Pushes a sculpted leaf (so the coat stays layered at a distance) onto prims and a crisp lock onto hard.
 * o: { L length, W half-width, T thickness, lift 0..1 how far the tip stands off, colA root, colB tip, style(prim), lockOnly, primOnly, lod }
 */
function clump(part, df, from, ray, flow, o) {
  const root = surfHit(df, from, ray), n = gradAt(df, root);
  const fl = norm3(flow), d = fl[0] * n[0] + fl[1] * n[1] + fl[2] * n[2];
  const tan = norm3(sub3(fl, mul3(n, d)));
  const lift = o.lift ?? 0.22, dir = norm3(add3(tan, mul3(n, lift)));
  const L = o.L, W = o.W, T = o.T ?? W * 0.5;
  if (!o.lockOnly) {
    // a tapering tongue of fur: its root sunk in the coat, its point lying along the body
    part.prims.push(o.style(bone(add3(root, mul3(n, -W * 0.45)), add3(root, mul3(dir, L * 0.92)), W * 0.8, 0.0035)).blend(o.blend ?? 0.014));
  }
  if (o.lock || o.lockOnly) {
    const base = add3(root, add3(mul3(dir, L * 0.18), mul3(n, -T * 0.3)));
    const tipDir = norm3(add3(tan, mul3(n, lift + 0.1)));
    const h = lock(base, tipDir, L * 0.95, W * 0.8, W * 0.5, o.colA, o.colB, mul3(n, -1), o.curl ?? 0.2);
    part.hard.push(h.lod(o.lod ?? 1));
  }
  return root;
}

// =====================================================================================
//  WOLVES: the dire wolf, and the goblins' war-wolf (a bigger, scarred animal that carries a saddle)
// =====================================================================================

function wolfPalette(base, war) {
  const fur = war ? mix(base, 0x4a4036, 0.55) : mix(base, 0x565c66, 0.4);
  return {
    fur,
    back: tone(fur, 0, -0.02, war ? -0.14 : -0.12),
    mane: tone(fur, 0, -0.04, war ? -0.21 : -0.19),
    flank: tone(fur, 0, 0.0, 0.06),
    belly: mix(tone(fur, 0, -0.03, 0.16), 0xc9bca6, war ? 0.3 : 0.42),
    pale: mix(tone(fur, 0, -0.04, 0.2), 0xcfc4ae, 0.45),
    leg: mix(tone(fur, 0, 0, 0.05), 0x94806a, 0.3),
    sock: mix(tone(fur, 0, 0, 0.12), 0xb3a188, 0.4),
    muzzle: tone(fur, 0, -0.03, -0.1),
    nose: 0x14110f, lip: 0x1e1616, mouth: 0x5c1a22, gum: 0x8a2c34, tongue: 0xd0606c, tooth: 0xf0e7cc, claw: 0x1e1a17,
    earIn: mix(fur, 0x6a4a4a, 0.5), pad: 0x2a2220,
    eye: war ? { iris: 0xff5a1e, rim: 0x8a1a08, glow: 0.55 } : { iris: 0xffc02a, rim: 0x9a5a08, glow: 0.4 },
    scar: 0xc99a94,
  };
}

/**
 * A wolf in its rest pose. opt: { war, keys: rig key names, detail }.
 * Returns { nodes (unfinished), C, rnd, pts } so a rider can add tack before finish().
 */
function buildWolf(def, base, opt = {}) {
  const war = !!opt.war;
  const C = wolfPalette(base, war);
  const rnd = rng(hashStr((def?.id || 'wolf') + (war ? ':war' : '')));
  const K = opt.keys || { body: 'torso', neck: 'neck', head: 'head', jaw: 'jaw' };
  const D = opt.detail ?? 1;
  const furC = (col, amp = 0.0095, f = 38) => (q) => q.color(col).tint(0.2, 22).bump(amp, f, 'fur').pbr(0.93);
  const fur = furC(C.fur);
  const vary = (col) => tone(col, 0, 0, (rnd() - 0.5) * 0.05);
  const nodes = [];
  const root = node('root', null, [0, 0, 0]); nodes.push(root);

  // ---------------- key points ----------------
  const NB = [0, 0.555, 0.3], HJ = [0, 0.675, 0.5];                        // neck base, skull joint
  const SH = [0.105, 0.5, 0.24], EL = [0.12, 0.343, 0.187], CA = [0.12, 0.14, 0.215];     // shoulder, elbow, wrist
  const HP = [0.095, 0.5, -0.31], ST = [0.126, 0.335, -0.215], HK = [0.12, 0.172, -0.385]; // hip, stifle, hock
  const TL = [[0, 0.548, -0.425], [0, 0.515, -0.535], [0, 0.45, -0.635], [0, 0.385, -0.72], [0, 0.345, -0.8]];

  // ---------------- torso ----------------
  const torso = node('torso', 'root', [0, 0.5, 0], { rig: K.body, detail: 0.95 * D }); nodes.push(torso);
  {
    const p = torso.prims;
    p.push(fur(lay(0.126, 0.154, 0.215).rot(-5, 0, 0).at(0, 0.482, 0.15)));                            // rib cage: deep and narrow
    p.push(fur(lay(0.08, 0.075, 0.135).at(0, 0.58, 0.165).blend(0.05)));                               // shoulder hump
    p.push(fur(lay(0.096, 0.098, 0.2).at(0, 0.52, -0.12).blend(0.06)));                                // loin, tucked up
    p.push(fur(lay(0.11, 0.116, 0.14).rot(8, 0, 0).at(0, 0.512, -0.31).blend(0.05)));                  // pelvis
    p.push(fur(lay(0.09, 0.1, 0.09).at(0, 0.462, 0.315).blend(0.05)));                                 // breast
    p.push(fur(lay(0.058, 0.07, 0.12).at(0, 0.39, 0.235).blend(0.04)));                                // keel of the chest
    p.push(fur(bone([0, 0.525, 0.27], [0, 0.6, 0.395], 0.124, 0.108).blend(0.05)));                    // root of the neck
    p.push(fur(bone([0, 0.54, -0.37], [0, 0.545, -0.45], 0.062, 0.046).blend(0.04)));                  // root of the tail
    p.push(...S.mirrorX([
      fur(S.ellipsoid(0.048, 0.1, 0.078).rot(-14, 0, -8).at(0.1, 0.522, 0.225).blend(0.03)),           // shoulder blade
      fur(S.ellipsoid(0.05, 0.1, 0.1).rot(20, 0, -6).at(0.09, 0.505, -0.3).blend(0.035)),              // haunch
      fur(lay(0.04, 0.045, 0.2).at(0.05, 0.572, -0.1).blend(0.04)),                                    // long back muscles
    ]));
    // lean flanks: the last ribs show through the coat
    for (let i = 0; i < 4; i++) {
      p.push(...S.mirrorX([S.ellipsoid(0.012, 0.085, 0.012).rot(16 + i * 3, 0, -6).at(0.118 - i * 0.004, 0.47 + i * 0.006, 0.105 - i * 0.05).color(C.flank).pbr(0.93).paint(0.01, 0.004)]));
    }
    // colour: dark saddle along the back, pale underside, pale bib
    p.push(lay(0.085, 0.09, 0.52).at(0, 0.625, -0.06).color(C.back).pbr(0.93).tint(0.22, 20).paint(0.045));
    p.push(lay(0.045, 0.05, 0.5).at(0, 0.66, -0.05).color(C.mane).pbr(0.93).tint(0.22, 26).paint(0.03));
    p.push(lay(0.1, 0.085, 0.4).at(0, 0.365, -0.02).color(C.belly).pbr(0.93).tint(0.16, 26).paint(0.05));
    p.push(lay(0.085, 0.11, 0.09).at(0, 0.41, 0.35).color(C.pale).pbr(0.93).tint(0.16, 26).paint(0.045));
    p.push(...S.mirrorX([lay(0.03, 0.09, 0.09).rot(20, 0, 0).at(0.14, 0.47, -0.27).color(C.flank).pbr(0.93).tint(0.16, 26).paint(0.04)]));
    const df = distanceField(p);
    // the mane: three ragged rows of clumps over the withers, thinning to a ridge along the spine
    for (let i = 0; i < 12; i++) {
      const f = i / 11, z = 0.3 - i * 0.058 + (rnd() - 0.5) * 0.01;
      const rows = i < 5 ? [-1, 0, 1] : i < 8 ? [-0.5, 0.5] : [0];
      if (opt.saddle && z < opt.saddle[1] && z > opt.saddle[0]) continue;
      for (const r of rows) {
        const L = lerp(0.115, 0.06, smooth(f)) * (0.85 + rnd() * 0.3);
        clump(torso, df, [r * 0.04 + (rnd() - 0.5) * 0.01, 0.85, z - Math.abs(r) * 0.02], [0, -1, 0], [r * 0.35, 0.1, -1],
          { L, W: L * 0.3, T: L * 0.17, lift: 0.3 + rnd() * 0.18, colA: C.mane, colB: vary(mix(C.mane, C.fur, 0.4)), style: furC(vary(C.mane), 0.004, 60), curl: 0.3, lock: r === 0 || i % 2 === 0 });
      }
    }
    // the bib: clumps cascading down the breast
    for (let r = 0; r < 4; r++) for (let j = 0; j < 4 + (r % 2); j++) {
      const a = ((j + 0.5) / (4 + (r % 2)) - 0.5) * 1.7, y = 0.5 - r * 0.045;
      const L = 0.075 + rnd() * 0.025;
      clump(torso, df, [Math.sin(a) * 0.4, y, 0.3 + Math.cos(a) * 0.4], [-Math.sin(a), 0, -Math.cos(a)], [Math.sin(a) * 0.4, -1, -0.15],
        { L, W: L * 0.3, T: L * 0.16, lift: 0.2 + rnd() * 0.12, colA: C.belly, colB: vary(C.pale), style: furC(vary(r < 1 ? C.belly : C.pale), 0.004, 60), lock: r === 3 || (j + r) % 3 === 0 });
    }
    // the tuck of the flank and the feathering under the belly
    for (const sx of [1, -1]) for (let i = 0; i < 6; i++) {
      const z = 0.06 - i * 0.055, L = 0.05 + rnd() * 0.02;
      clump(torso, df, [sx * 0.065, 0.1, z], [0, 1, 0], [sx * 0.2, -0.5, -1], { L, W: L * 0.28, T: L * 0.15, lift: 0.35, colA: C.belly, colB: C.pale, lockOnly: true });
    }
  }

  // ---------------- neck: a heavy ruff ----------------
  const neck = node('neck', 'torso', NB, { rig: K.neck, detail: 0.92 * D }); nodes.push(neck);
  {
    const p = neck.prims, ax = norm3(sub3(HJ, NB));
    p.push(fur(bone(add3(NB, mul3(ax, -0.03)), HJ, 0.116, 0.088)));
    p.push(fur(S.sphere(0.11).at(NB[0], NB[1] - 0.012, NB[2] - 0.01).blend(0.04)));                                   // buried in the shoulders
    p.push(fur(bone([0, 0.5, 0.36], [0, 0.6, 0.5], 0.078, 0.064).blend(0.04)));                                       // throat
    p.push(bone(add3(NB, [0, 0.085, -0.02]), add3(HJ, [0, 0.075, -0.03]), 0.065, 0.055).color(C.mane).pbr(0.93).tint(0.22, 26).paint(0.035));
    p.push(bone([0, 0.44, 0.37], [0, 0.585, 0.5], 0.075, 0.06).color(C.pale).pbr(0.93).tint(0.16, 26).paint(0.04));
    const df = distanceField(p);
    // collars of clumps, each row overlapping the one behind it
    for (let r = 0; r < 4; r++) {
      const f = 0.92 - r * 0.25, c = lerp3(NB, HJ, f), n = 8 + (r % 2);
      for (let j = 0; j < n; j++) {
        const a = ((j + (r % 2) * 0.5) / n) * Math.PI * 2, sx = Math.sin(a), cy = Math.cos(a);       // a = 0 on the nape
        const out = norm3([sx, cy * ax[2], -cy * ax[1]]);
        const L = (0.095 + 0.03 * Math.abs(cy) + rnd() * 0.025) * (r === 0 ? 0.8 : 1);
        const zone = cy > 0.4 ? 0 : cy < -0.25 ? 2 : 1;
        const colA = [C.mane, C.back, C.belly][zone], colB = vary([mix(C.mane, C.fur, 0.55), C.fur, C.pale][zone]);
        clump(neck, df, add3(c, mul3(out, 0.35)), mul3(out, -1), add3(mul3(ax, -1), [0, zone === 2 ? -0.5 : -0.12, 0]),
          { L, W: L * 0.3, T: L * 0.17, lift: 0.26 + rnd() * 0.16, colA, colB, style: furC(vary([C.mane, C.fur, C.pale][zone]), 0.004, 60), curl: 0.28, lock: r === 3 || (j + r) % 2 === 0 });
      }
    }
  }

  // ---------------- head and jaw ----------------
  const hd = wolfHead(C, rnd, war);
  const head = node('head', 'neck', [0, 0, 0], { rig: K.head, pos: sub3(HJ, NB), rot: [14, 0, 0], detail: 1.42 * D });
  head.prims = hd.p; head.hard = hd.hard; nodes.push(head);
  const jaw = node('jaw', 'head', hd.hinge, { rig: K.jaw, pos: hd.hinge, rot: [7, 0, 0], detail: 1.35 * D });
  jaw.prims = hd.jp; jaw.hard = hd.jhard; nodes.push(jaw);

  // ---------------- legs ----------------
  const legCol = furC(C.leg, 0.005, 54), sockCol = furC(C.sock, 0.004, 58);
  const toes = (part, c, col) => {
    // c = centre of the paw on the ground plane; four fat toes spread forward, each with a short dark claw
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.3, dx = Math.sin(a), dz = Math.cos(a), mid = i === 1 || i === 2;
      const t = [c[0] + dx * 0.02 + (i - 1.5) * 0.016, 0.022, c[2] + dz * (mid ? 0.052 : 0.038)];
      part.prims.push(col(S.ellipsoid(0.0165, 0.02, 0.027).rot(0, a / DEG, 0).at(t[0], t[1], t[2]).blend(0.007)));
      part.hard.push(spike([t[0] + dx * 0.016, 0.025, t[2] + dz * 0.019], [dx * 0.8, -0.5, dz], 0.021, 0.0075, C.claw, [0, -1, 0], 0.4).lod(1));
    }
  };
  const fl = { up: { prims: [], hard: [] }, lo: { prims: [], hard: [] }, paw: { prims: [], hard: [] } };
  {
    const u = fl.up.prims, l = fl.lo.prims, w = fl.paw.prims;
    u.push(fur(bone([0.11, 0.5, 0.25], EL, 0.064, 0.05)));
    u.push(fur(S.ellipsoid(0.052, 0.088, 0.072).rot(-18, 0, -4).at(0.114, 0.45, 0.228).blend(0.03)));   // shoulder muscle
    u.push(fur(S.ellipsoid(0.042, 0.06, 0.052).rot(25, 0, 0).at(0.12, 0.405, 0.185).blend(0.02)));      // triceps
    u.push(fur(S.sphere(0.048).at(EL[0], EL[1], EL[2]).blend(0.02)));
    l.push(fur(S.sphere(0.046).at(EL[0], EL[1], EL[2])));
    l.push(legCol(bone(EL, CA, 0.044, 0.031).blend(0.03)));
    l.push(legCol(S.ellipsoid(0.033, 0.062, 0.04).at(EL[0], lerp(EL[1], CA[1], 0.28), EL[2] - 0.004).blend(0.02)));
    l.push(legCol(S.sphere(0.034).at(CA[0], CA[1] + 0.004, CA[2]).blend(0.012)));
    l.push(bone(add3(EL, [0, -0.02, 0.034]), add3(CA, [0, 0.01, 0.025]), 0.016, 0.012).color(C.back).pbr(0.93).paint(0.012));  // the dark stripe down the foreleg
    w.push(legCol(S.sphere(0.033).at(CA[0], CA[1], CA[2])));
    w.push(sockCol(bone(CA, [0.12, 0.055, 0.232], 0.031, 0.031).blend(0.02)));
    w.push(sockCol(S.ellipsoid(0.046, 0.031, 0.05).at(0.12, 0.033, 0.25).blend(0.018)));
    w.push(S.ellipsoid(0.02, 0.014, 0.018).at(0.12, 0.08, 0.196).color(C.pad).pbr(0.7).blend(0.006));   // carpal pad
    toes(fl.paw, [0.12, 0, 0.266], sockCol);
    const dfu = distanceField(u), dfl = distanceField(l);
    for (let i = 0; i < 5; i++) {                                                                       // layered coat over the shoulder
      const L = 0.085 + rnd() * 0.02;
      clump(fl.up, dfu, [0.4, 0.53 - (i % 3) * 0.045, 0.275 - Math.floor(i / 3) * 0.06 - (i % 3) * 0.02], [-1, 0, 0], [0, -0.6, -1], { L: L * 0.85, W: L * 0.26, T: L * 0.15, lift: 0.02, colA: C.fur, colB: C.flank, style: furC(vary(C.fur), 0.005, 56) });
    }
    for (let i = 0; i < 4; i++) {                                                                       // elbow tuft
      const L = 0.06 + rnd() * 0.02;
      clump(fl.up, dfu, [0.12 + (i % 2 ? 0.02 : -0.02), 0.4 - i * 0.02, -0.2], [0, 0, 1], [0, -0.8, -0.6], { L, W: L * 0.3, T: L * 0.16, lift: 0.3, colA: C.fur, colB: vary(C.flank), style: furC(vary(C.fur), 0.004, 60), lock: i < 2 });
    }
    for (let i = 0; i < 5; i++) {                                                                       // feathering behind the foreleg
      const L = 0.042 + rnd() * 0.014;
      clump(fl.lo, dfl, [0.12, EL[1] - 0.035 - i * 0.034, -0.1], [0, 0, 1], [0, -1, -0.3], { L, W: L * 0.3, T: L * 0.16, lift: 0.4, colA: C.leg, colB: C.sock, lockOnly: true });
    }
  }
  const bl = { up: { prims: [], hard: [] }, lo: { prims: [], hard: [] }, paw: { prims: [], hard: [] } };
  {
    const u = bl.up.prims, l = bl.lo.prims, w = bl.paw.prims;
    u.push(fur(bone(HP, ST, 0.076, 0.053)));
    u.push(fur(S.ellipsoid(0.052, 0.115, 0.1).rot(26, 0, -5).at(0.107, 0.43, -0.28).blend(0.03)));      // the broad thigh
    u.push(fur(S.sphere(0.05).at(ST[0], ST[1], ST[2]).blend(0.02)));
    l.push(fur(S.sphere(0.048).at(ST[0], ST[1], ST[2])));
    l.push(legCol(bone(ST, HK, 0.047, 0.028).blend(0.03)));
    l.push(legCol(S.ellipsoid(0.03, 0.056, 0.038).rot(-40, 0, 0).at(ST[0], lerp(ST[1], HK[1], 0.3), lerp(ST[2], HK[2], 0.3) - 0.014).blend(0.02)));   // gaskin
    l.push(legCol(S.sphere(0.03).at(HK[0], HK[1], HK[2]).blend(0.012)));
    l.push(legCol(S.ellipsoid(0.019, 0.028, 0.022).at(HK[0], HK[1] + 0.012, HK[2] - 0.022).blend(0.01)));  // point of the hock
    w.push(legCol(S.sphere(0.03).at(HK[0], HK[1], HK[2])));
    w.push(sockCol(bone(HK, [0.12, 0.055, -0.362], 0.028, 0.029).blend(0.02)));
    w.push(sockCol(S.ellipsoid(0.044, 0.031, 0.05).at(0.12, 0.033, -0.345).blend(0.018)));
    toes(bl.paw, [0.12, 0, -0.329], sockCol);
    const dfu = distanceField(u);
    for (let i = 0; i < 4; i++) {                                                                       // layered coat over the haunch
      const L = 0.085 + rnd() * 0.02;
      clump(bl.up, dfu, [0.4, 0.52 - (i % 2) * 0.06, -0.245 - Math.floor(i / 2) * 0.06 - (i % 2) * 0.02], [-1, 0, 0], [0, -0.7, -1], { L, W: L * 0.28, T: L * 0.15, lift: 0.1, colA: C.fur, colB: C.flank, style: furC(vary(C.fur), 0.005, 56) });
    }
    for (let i = 0; i < 8; i++) {                                                                       // breeches down the back of the thigh
      const L = 0.07 + rnd() * 0.025;
      clump(bl.up, dfu, [0.1 + (i % 2 ? 0.02 : -0.012), 0.5 - i * 0.026, -0.7], [0, 0, 1], [0, -0.85, -0.5], { L, W: L * 0.3, T: L * 0.16, lift: 0.28, colA: C.fur, colB: vary(C.flank), style: furC(vary(C.flank), 0.004, 60), lock: i % 2 === 0 });
    }
  }
  const legDefs = [['FL', fl, 1, SH, EL, CA], ['FR', fl, -1, SH, EL, CA], ['BL', bl, 1, HP, ST, HK], ['BR', bl, -1, HP, ST, HK]];
  for (const [nm, part, side, J0, J1, J2] of legDefs) {
    const cp = (list) => (side > 0 ? flat(list).map((q) => q.clone()) : mirrorAll(list));
    const m = (v) => (side > 0 ? v : mirX(v));
    const up = node(`leg${nm}`, 'torso', m(J0), { rig: 'legs', detail: 0.86 * D, minRes: 16 });
    const lo = node(`shin${nm}`, `leg${nm}`, m(J1), { rig: 'shins', detail: 0.96 * D, minRes: 19 });
    const pw = node(`paw${nm}`, `shin${nm}`, m(J2), { rig: 'paws', detail: 1.08 * D, minRes: 17 });
    up.prims = cp(part.up.prims); up.hard = cp(part.up.hard);
    lo.prims = cp(part.lo.prims); lo.hard = cp(part.lo.hard);
    pw.prims = cp(part.paw.prims); pw.hard = cp(part.paw.hard);
    nodes.push(up, lo, pw);
  }

  // ---------------- tail: a heavy brush ----------------
  const tr = [0.04, 0.05, 0.052, 0.04, 0.008];
  for (let i = 0; i < 4; i++) {
    const n = node(`tail${i}`, i === 0 ? 'torso' : `tail${i - 1}`, TL[i], { rig: 'tail', detail: 0.82 * D, minRes: 16 });
    nodes.push(n);
    const a = TL[i], b = TL[i + 1], t = norm3(sub3(b, a)), col = i === 3 ? C.mane : i === 2 ? C.back : C.fur;
    n.prims.push(furC(col, 0.009, 34)(bone(a, b, tr[i], tr[i + 1])));
    n.prims.push(furC(col, 0.009, 34)(S.sphere(tr[i] * 0.98).at(a[0], a[1], a[2]).blend(0.02)));
    n.prims.push(bone(add3(a, [0, -tr[i] * 0.6, 0]), add3(b, [0, -tr[i + 1] * 0.6, 0]), tr[i] * 0.7, tr[i + 1] * 0.7).color(i === 3 ? C.back : C.flank).pbr(0.93).tint(0.16, 26).paint(0.02));
    const df = distanceField(n.prims);
    const up = [0, t[2], -t[1]];
    for (let j = 0; j < 6; j++) {
      const f = (j % 3) * 0.3 + 0.1 + rnd() * 0.1, ang = (j / 6) * Math.PI * 2 + i * 0.5, c = lerp3(a, b, f);
      const out = norm3(add3(mul3(up, Math.cos(ang)), [Math.sin(ang), 0, 0]));
      const L = (0.08 + rnd() * 0.03) * (i === 3 ? 0.8 : 1), top = Math.cos(ang) > 0;
      clump(n, df, add3(c, mul3(out, 0.3)), mul3(out, -1), t, { L: L * 1.2, W: L * 0.3, T: L * 0.17, lift: 0.2 + rnd() * 0.12, colA: top ? C.back : C.fur, colB: vary(top ? col : C.flank), style: furC(vary(top ? col : C.flank), 0.004, 60), lock: j % 2 === 0 || i === 3 });
    }
  }

  return { nodes, C, rnd, pts: { NB, HJ, SH, HP } };
}

/** wolf head and lower jaw in the head's own frame: skull joint at the origin, muzzle along +Z */
function wolfHead(C, rnd, war) {
  const p = [], hard = [], jp = [], jhard = [];
  const furC = (col, amp = 0.0058, f = 52) => (q) => q.color(col).tint(0.2, 30).bump(amp, f, 'fur').pbr(0.93);
  const fur = furC(C.fur);
  const bare = (col) => (q) => q.color(col).tint(0.1, 40).pbr(0.9);
  const vary = (col) => tone(col, 0, 0, (rnd() - 0.5) * 0.05);
  const w = war ? 1.08 : 1;
  // ---- skull ----
  p.push(fur(lay(0.08 * w, 0.068, 0.088).at(0, 0.03, 0.05)));                                               // cranium
  p.push(fur(S.sphere(0.078).at(0, 0.008, -0.012).blend(0.03)));                                             // nape: hides the neck joint
  p.push(fur(lay(0.054, 0.038, 0.07).rot(12, 0, 0).at(0, 0.04, 0.115).blend(0.03)));                         // forehead sloping to the stop
  p.push(bare(C.muzzle)(bone([0, 0.006, 0.115], [0, -0.004, 0.262], 0.049 * w, 0.034).blend(0.03)));         // muzzle
  p.push(bare(C.muzzle)(lay(0.03, 0.02, 0.075).at(0, 0.027, 0.2).blend(0.02)));                              // bridge of the nose
  p.push(...S.mirrorX([
    fur(lay(0.036 * w, 0.042, 0.054).at(0.06, 0.002, 0.058).blend(0.03)),                                    // cheekbone and jaw muscle
    bare(C.pale)(S.ellipsoid(0.022, 0.024, 0.042).at(0.028, -0.012, 0.232).blend(0.014)),                    // whisker pad
    fur(S.ellipsoid(0.03, 0.013, 0.022).rot(0, -22, -26).at(0.044, 0.074, 0.103).blend(0.014)),              // scowling brow
  ]));
  // the flat roof of the mouth, so the teeth have something to hang from
  p.push(S.box(0.084, 0.05, 0.215, 0.012).at(0, -0.054, 0.178).cut(0.006).color(C.mouth));
  p.push(S.ellipsoid(0.025, 0.021, 0.021).at(0, 0.006, 0.29).color(C.nose).pbr(0.3).blend(0.007));           // nose
  p.push(...S.mirrorX([S.ellipsoid(0.0066, 0.0055, 0.009).rot(0, 20, 0).at(0.012, 0.005, 0.307).cut(0.003).color(0x050404)]));
  p.push(S.box(0.003, 0.02, 0.012, 0.001).at(0, -0.008, 0.305).cut(0.002).color(0x050404));                  // the split of the lip
  // ---- eyes: deep-set under the brow, lined in black ----
  const ex = 0.0465, ey = 0.046, ez = 0.107, er = 0.0172;
  p.push(...S.mirrorX([
    S.ellipsoid(0.0215, 0.0155, 0.016).rot(0, 30, -16).at(ex + 0.004, ey - 0.001, ez + 0.012).cut(0.005).color(0x0b0908),
    S.sphere(er * 0.95).at(ex, ey, ez).color(C.eye.iris).glow(C.eye.glow * 0.8).pbr(0.3).blend(0),
  ]));
  hard.push(...H.mirrorX([eye(er, { ...C.eye, pupilSize: 0.75, irisSize: 1.45 }).rot(-4, 32, 0).at(ex, ey, ez).lod(1)]));
  // ---- colour: pale cheeks and brow spots, dark top of the muzzle ----
  p.push(...S.mirrorX([
    S.ellipsoid(0.03, 0.04, 0.06).at(0.07, -0.016, 0.07).color(C.pale).pbr(0.93).tint(0.12, 30).paint(0.02),
    S.sphere(0.011).at(0.036, 0.085, 0.098).color(C.pale).pbr(0.93).paint(0.006),
    S.ellipsoid(0.008, 0.016, 0.09).at(0.049, -0.026, 0.19).color(C.lip).pbr(0.6).paint(0.004),             // lip line
  ]));
  p.push(lay(0.02, 0.014, 0.085).at(0, 0.037, 0.19).color(C.back).pbr(0.93).paint(0.014));
  p.push(lay(0.04, 0.03, 0.07).at(0, 0.09, 0.03).color(C.back).pbr(0.93).tint(0.2, 30).paint(0.025));
  // ---- ears: broad, cupped triangles lined with pale hair ----
  const ear = (notch) => {
    const e = [
      fur(S.capsule([0, 0, 0], [0, 0.082, -0.004], 0.034, 0.006)),
      fur(S.ellipsoid(0.032, 0.026, 0.024).at(0, -0.004, -0.006).blend(0.012)),
      S.ellipsoid(0.026, 0.06, 0.026).at(0, 0.03, 0.03).cut(0.005).color(C.earIn),                           // hollow of the ear
      S.ellipsoid(0.03, 0.07, 0.03).at(0, 0.03, -0.043).cut(0.004),                                          // flatten the back
      S.ellipsoid(0.014, 0.02, 0.012).at(0, 0.076, 0).color(C.mane).pbr(0.93).paint(0.008),
    ];
    if (notch) e.push(S.ellipsoid(0.014, 0.012, 0.03).rot(0, 0, 30).at(0.03, 0.052, 0).cut(0.003).color(C.earIn));
    return e.map((q) => q.rot(-10, 22, -24).at(0.05, 0.082, 0.014));
  };
  p.push(...ear(false), ...mirrorAll(ear(war)));
  for (const sx of [1, -1]) for (let i = 0; i < 3; i++) hard.push(lock([sx * (0.05 + i * 0.006), 0.094 + i * 0.008, 0.026], [sx * 0.75, 0.7, 0.25], 0.02, 0.005, 0.004, C.belly, C.pale, [0, 0, 1], 0.1).lod(0));
  // ---- cheek ruff: jagged clumps sweeping back from the jaw ----
  const df = distanceField(p);
  const cheek = { prims: p, hard };
  for (let i = 0; i < 7; i++) {                                                                              // the ragged crest between the ears
    const x = ((i % 3) - 1) * 0.026 + (rnd() - 0.5) * 0.008, z = 0.075 - Math.floor(i / 3) * 0.038, L = 0.05 + rnd() * 0.015;
    clump(cheek, df, [x, 0.3, z], [0, -1, 0], [x * 2, 0.1, -1], { L, W: L * 0.3, T: L * 0.17, lift: 0.3, colA: C.back, colB: C.fur, style: furC(vary(C.back)), lock: i % 2 === 0 });
  }
  for (const sx of [1, -1]) for (let i = 0; i < 6; i++) {
    const y = 0.045 - i * 0.021, L = 0.06 + rnd() * 0.02 + (i > 1 && i < 5 ? 0.012 : 0);
    clump(cheek, df, [sx * 0.3, y, 0.045 - Math.abs(i - 2.5) * 0.008], [-sx, 0, 0], [sx * 0.55, -0.2 - i * 0.12, -1],
      { L, W: L * 0.3, T: L * 0.17, lift: 0.3, colA: i < 2 ? C.fur : C.belly, colB: vary(i < 2 ? C.flank : C.pale), style: furC(vary(i < 2 ? C.fur : C.pale)), curl: 0.25, lock: i % 2 === 1 });
  }
  if (war) {   // an old wound across the left eye and muzzle
    p.push(S.ellipsoid(0.005, 0.05, 0.02).rot(24, 0, 18).at(0.038, 0.04, 0.125).color(C.scar).pbr(0.6).paint(0.003, -0.003));
    p.push(S.ellipsoid(0.004, 0.012, 0.045).rot(0, 24, 0).at(-0.029, 0.02, 0.2).color(C.scar).pbr(0.6).paint(0.003, -0.0025));
  }
  // ---- upper teeth ----
  const T = C.tooth, gumY = -0.028;
  for (const sx of [1, -1]) {
    hard.push(spike([sx * 0.0275, gumY, 0.232], [sx * 0.08, -1, 0.1], 0.048 * w, 0.009, T, [0, 0, -1], 0.3));                  // canine
    for (let i = 0; i < 3; i++) hard.push(spike([sx * (0.006 + i * 0.0075), gumY, 0.264 - i * 0.004], [0, -1, 0.1], 0.012, 0.0036, T, [0, 0, -1], 0.1).lod(1));  // incisors
    for (let i = 0; i < 4; i++) hard.push(spike([sx * (0.031 + i * 0.0022), gumY, 0.205 - i * 0.026], [sx * 0.08, -1, 0], i === 3 ? 0.02 : 0.015, i === 3 ? 0.0085 : 0.006, T, [0, 0, -1], 0.15, 0.6).lod(1));  // premolars, carnassial
  }

  // ---- lower jaw (authored in the head frame; pivots about the hinge) ----
  const hinge = [0, -0.014, 0.05];
  const jf = furC(C.pale);
  jp.push(...S.mirrorX([jf(bone([0.038, -0.02, 0.05], [0.021, -0.048, 0.2], 0.02, 0.016))]));
  jp.push(jf(lay(0.025, 0.015, 0.03).at(0, -0.05, 0.226).blend(0.012)));                                     // chin
  jp.push(jf(lay(0.032, 0.013, 0.08).at(0, -0.054, 0.14).blend(0.012)));                                     // floor of the mouth
  jp.push(S.box(0.038, 0.02, 0.17, 0.006).at(0, -0.03, 0.155).cut(0.005).color(C.mouth));                    // trough for the tongue
  jp.push(S.ellipsoid(0.0155, 0.007, 0.066).rot(-4, 0, 0).at(0, -0.038, 0.168).color(C.tongue).pbr(0.4).blend(0.003));
  jp.push(S.ellipsoid(0.003, 0.004, 0.05).at(0, -0.0315, 0.175).color(tone(C.tongue, 0, 0, -0.12)).paint(0.002, -0.0015));
  jp.push(...S.mirrorX([S.ellipsoid(0.007, 0.007, 0.075).at(0.025, -0.036, 0.15).color(C.lip).pbr(0.6).paint(0.004)]));
  for (const sx of [1, -1]) {
    jhard.push(spike([sx * 0.021, -0.04, 0.244], [sx * 0.1, 1, 0.06], 0.036 * w, 0.0075, T, [0, 0, -1], 0.25));
    for (let i = 0; i < 2; i++) jhard.push(spike([sx * (0.005 + i * 0.007), -0.04, 0.254 - i * 0.003], [0, 1, 0.1], 0.009, 0.003, T, [0, 0, -1], 0.1).lod(1));
    for (let i = 0; i < 4; i++) jhard.push(spike([sx * (0.024 + i * 0.0026), -0.038, 0.213 - i * 0.027], [sx * 0.05, 1, 0], i === 3 ? 0.016 : 0.012, i === 3 ? 0.007 : 0.005, T, [0, 0, -1], 0.1, 0.6).lod(1));
  }
  const dfj = distanceField(jp), chin = { prims: jp, hard: jhard };
  for (let i = 0; i < 5; i++) {
    const L = 0.045 + rnd() * 0.012;
    clump(chin, dfj, [(i - 2) * 0.012, -0.2, 0.13 - Math.abs(i - 2) * 0.012], [0, 1, 0], [(i - 2) * 0.15, -0.3, -1], { L, W: L * 0.3, T: L * 0.17, lift: 0.3, colA: C.belly, colB: C.pale, lockOnly: true });
  }
  return { p, hard, jp, jhard, hinge };
}

function quadruped(def, o = {}) {
  const w = buildWolf(def, o.fur ?? o.mount ?? 0x5b5b5b, { detail: 0.83 });
  return { kind: 'beast.quad', attack: 'bite', gait: 'wolf', nodes: finish(w.nodes, 1.12) };
}

// =====================================================================================
//  Riders: a humanoid built in its riding pose and re-parented onto a mount's back
// =====================================================================================
const MOUNT_KEYS = { body: 'body', neck: 'mneck', head: 'mhead', jaw: 'mjaw' };
const _e1 = new THREE.Euler(), _ma = new THREE.Matrix4(), _mb = new THREE.Matrix4(), _v1 = new THREE.Vector3();

/**
 * Build the rider for a mounted unit. f scales the rider inside the model (a goblin on a big wolf).
 * Returns { desc, P, f, at(seat) -> helpers }, where the points are in the rider's own root space (unscaled):
 *   hip [0, hipY, 0], knee(side), foot(side) = where the sole of the foot is, side = +1 left / -1 right.
 */
function makeRider(def, o, f = 1) {
  const desc = humanoid(def, { ...o, pose: 'riding' });
  const P = proportions(o);
  const by = new Map(desc.nodes.map((n) => [n.name, n]));
  const chain = (leg, shin, local) => {
    const L = by.get(leg), Sn = by.get(shin);
    const rot = (n) => _mb.makeRotationFromEuler(_e1.set((n.rot?.[0] || 0) * DEG, (n.rot?.[1] || 0) * DEG, (n.rot?.[2] || 0) * DEG, 'XYZ'));
    _ma.makeTranslation(L.pos[0], L.pos[1], L.pos[2]).multiply(rot(L));
    if (Sn) _ma.multiply(_mb.makeTranslation(Sn.pos[0], Sn.pos[1], Sn.pos[2])).multiply(rot(Sn));
    _v1.set(local[0], local[1], local[2]).applyMatrix4(_ma);
    return [_v1.x, _v1.y, _v1.z];
  };
  const knee = (side) => chain(side > 0 ? 'legL' : 'legR', null, [0, -P.thigh, 0]);
  const foot = (side) => chain(side > 0 ? 'legL' : 'legR', side > 0 ? 'shinL' : 'shinR', [0, -P.shin - P.footH, P.footLen * 0.28]);
  const ankle = (side) => chain(side > 0 ? 'legL' : 'legR', side > 0 ? 'shinL' : 'shinR', [0, -P.shin, 0]);
  return { desc, P, f, knee, foot, ankle };
}
/**
 * Seat a rider. `out` = the mount's finished nodes, bodyName = the node the saddle belongs to, bodyO = that node's
 * pivot and seatA = where the rider's hip joint goes (both in the mount's authoring space), s = the mount's scale.
 * The rider's root becomes the node `rider`; its other nodes keep their names with an `r_` prefix and their rig keys.
 */
function seatRider(out, R, bodyName, bodyO, seatA, s) {
  const f = R.f, P = R.P;
  for (const n of R.desc.nodes) {
    const m = { ...n, name: n.name === 'root' ? 'rider' : `r_${n.name}` };
    if (n.name === 'root') { m.parent = bodyName; m.pos = [(seatA[0] - bodyO[0]) * s, (seatA[1] - bodyO[1]) * s - P.hipY * f, (seatA[2] - bodyO[2]) * s]; }
    else { m.parent = n.parent === 'root' ? 'rider' : `r_${n.parent}`; m.pos = mul3(n.pos, f); }
    if (f !== 1) { m.prims = flat(n.prims); m.hard = flat(n.hard); for (const q of m.prims) q.scale(f); for (const q of m.hard) q.scale(f); }
    out.push(m);
  }
  return out;
}
/** a point of the rider (rider root space) expressed in the mount's authoring space */
const riderToMount = (R, seatA, s, pt) => [seatA[0] + pt[0] * R.f / s, seatA[1] + (pt[1] - R.P.hipY) * R.f / s, seatA[2] + pt[2] * R.f / s];

// ---------- tack pieces ----------
const LEATHER = 0x5a3a22, LEATHER_DARK = 0x3a2616, IRON = 0x6c7078, BRASS = 0xc9a23e, BONE = 0xe4d9bc, ROPE = 0xa98f5c;
/** a strap through points: a flat-ish leather band built from capsules, with an optional row of rivets */
function strap(pts, r, color, opt = {}) {
  const c = curve(pts, opt.n ?? pts.length * 3);
  return c.slice(0, -1).map((a, i) => S.capsule(a, c[i + 1], r).color(color).pbr(opt.rough ?? 0.62, opt.metal ?? 0).blend(i ? 0.004 : (opt.blend ?? 0.004)));
}
function rivets(pts, n, r, color = BRASS, lodN = 0) {
  const c = curve(pts, n * 2), out = [];
  for (let i = 0; i < n; i++) { const q = c[i * 2 + 1]; out.push(H.sphere(r, 8).at(q[0], q[1], q[2]).color(color).pbr(0.35, 1).lod(lodN)); }
  return out;
}
/** a ring (buckle, stirrup) in the plane whose normal is `nrm` */
const ringAt = (c, nrm, R, r, color, metal = 1) => orient(H.torus(R, r, 18, 8).rot(90, 0, 0), c, nrm).color(color).pbr(0.4, metal);

// ---------- the goblins' war-wolf ----------
function wolfRider(def, o) {
  const s = 1.4, f = clamp(0.72 / (o.scale || 0.85), 0.6, 1);                 // a goblin no bigger than his cousins on foot
  const R = makeRider(def, o, f);
  const seatA = [0, 0.652, 0.035];
  const w = buildWolf(def, o.mount ?? 0x5b5b5b, { war: true, keys: MOUNT_KEYS, detail: 0.72, saddle: [-0.14, 0.17] });
  const rnd = w.rnd;
  const hide = 0x7a5a3a, hideDark = 0x4a3524, paint = o.cloth ?? 0x8a2c2c;
  const tack = node('tack', 'torso', [0, 0.5, 0]); w.nodes.push(tack);
  tack.detail = 0.7;
  const p = tack.prims, h = tack.hard;
  // a hide thrown over the back, fur side down, and a hard leather seat lashed on top of it
  p.push(lay(0.139, 0.105, 0.155).at(0, 0.525, 0.015).color(hide).tint(0.2, 30).pbr(0.9).bump(0.004, 40, 'noise'));
  p.push(S.box(0.4, 0.3, 0.5, 0.02).at(0, 0.32, 0.0).cut(0.01).color(hideDark));                                   // the hide stops half way down the flank
  p.push(lay(0.085, 0.03, 0.105).at(0, 0.622, 0.02).color(LEATHER_DARK).tint(0.14, 40).pbr(0.6).blend(0.012));     // seat
  p.push(lay(0.07, 0.04, 0.022).rot(-12, 0, 0).at(0, 0.64, -0.085).color(LEATHER).pbr(0.6).blend(0.01));           // cantle
  p.push(lay(0.05, 0.036, 0.02).rot(14, 0, 0).at(0, 0.64, 0.125).color(LEATHER).pbr(0.6).blend(0.01));             // pommel
  // ragged hem: the hide was cut with a knife, not a tailor's shears
  for (const sx of [1, -1]) for (let i = 0; i < 7; i++) {
    const z = -0.125 + i * 0.045 + (rnd() - 0.5) * 0.01;
    p.push(S.ellipsoid(0.02, 0.022 + rnd() * 0.012, 0.016).at(sx * 0.139, 0.468, z).cut(0.006).color(hideDark));
    h.push(H.cyl(0.0035, 0.0035, 0.02, 6).rot(0, 0, 90).at(sx * 0.137, 0.5 + (i % 2) * 0.014, z + 0.022).color(BONE).pbr(0.6).lod(0));   // bone toggles / stitches
  }
  p.push(...S.mirrorX([S.ellipsoid(0.02, 0.05, 0.07).at(0.139, 0.56, 0.0).color(paint).pbr(0.9).paint(0.004)]));                      // a daub of warpaint on the hide
  h.push(...H.mirrorX([H.torus(0.022, 0.006, 14, 6).rot(0, 90, 0).at(0.146, 0.56, 0.0).color(tone(paint, 0, 0, 0.12)).pbr(0.9).lod(1)]));
  // girth and breast strap
  p.push(S.torus(0.142, 0.011).rot(90, 0, 0).at(0, 0.5, 0.055).color(LEATHER_DARK).pbr(0.6).blend(0.004));
  p.push(S.torus(0.129, 0.011).rot(90, 0, 0).at(0, 0.5, -0.06).color(LEATHER_DARK).pbr(0.6).blend(0.004));
  h.push(H.box(0.03, 0.036, 0.008, 0.003).rot(0, 90, 0).at(0.147, 0.44, 0.055).color(IRON).pbr(0.45, 1).lod(1));
  const breast = [[0.136, 0.55, 0.12], [0.158, 0.5, 0.24], [0.11, 0.445, 0.375], [0, 0.425, 0.42]];
  p.push(...strap(breast, 0.0105, LEATHER, { n: 8 }), ...mirrorAll(strap(breast, 0.0105, LEATHER, { n: 8 })));
  // trophies strung on the breast strap: fangs and finger bones, and one small skull over the breastbone
  const bc = curve(breast, 12);
  for (const sx of [1, -1]) for (let i = 3; i < 12; i += 1) {
    const q = bc[i], big = i % 3 === 0;
    h.push(spike([sx * q[0] * 1.02, q[1] - 0.006, q[2] * 1.01 + 0.004], [sx * 0.15, -1, 0.25], big ? 0.05 : 0.03, big ? 0.008 : 0.005, BONE, [0, 0, 1], 0.35).lod(1));
  }
  const sk = [0, 0.4, 0.44];
  p.push(S.ellipsoid(0.03, 0.03, 0.03).at(sk[0], sk[1], sk[2]).color(BONE).tint(0.12, 60).pbr(0.7).blend(0));
  p.push(S.ellipsoid(0.02, 0.018, 0.02).at(sk[0], sk[1] - 0.026, sk[2] + 0.008).color(BONE).pbr(0.7).blend(0.008));
  p.push(...S.mirrorX([S.sphere(0.0085).at(0.011, sk[1] + 0.002, sk[2] + 0.027).cut(0.003).color(0x1a120c)]));
  p.push(S.ellipsoid(0.004, 0.007, 0.006).at(0, sk[1] - 0.014, sk[2] + 0.03).cut(0.002).color(0x1a120c));
  for (let i = -2; i <= 2; i++) h.push(H.box(0.005, 0.009, 0.004, 0.001).at(i * 0.0065, sk[1] - 0.04, sk[2] + 0.022).color(BONE).pbr(0.6).lod(0));
  h.push(...H.mirrorX([spike([0.022, sk[1] + 0.02, sk[2]], [0.8, 0.7, 0], 0.05, 0.009, 0xcfc4a4, [0, 1, 0], 0.4).lod(1)]));     // it had horns
  // stirrups: rope loops knotted to the girth
  for (const side of [1, -1]) {
    const ft = riderToMount(R, seatA, s, R.foot(side)), top = [side * 0.139, 0.555, 0.06];
    const mid = [ft[0] + side * 0.012, ft[1] + 0.05, ft[2] - 0.004];
    p.push(...strap([top, lerp3(top, mid, 0.5), mid], 0.0075, ROPE, { n: 4, rough: 0.9 }));
    h.push(ringAt([ft[0], ft[1] + 0.02, ft[2]], [0, 0.15, 1], 0.034, 0.0065, ROPE, 0).pbr(0.9));
    h.push(H.sphere(0.011, 10).at(mid[0], mid[1], mid[2]).color(tone(ROPE, 0, 0, -0.08)).pbr(0.9).lod(1));
  }
  // a rope halter: a collar round the neck with a rein back to the pommel
  const neck = w.nodes.find((n) => n.name === 'neck');
  const ax = norm3(sub3(w.pts.HJ, w.pts.NB)), cc = lerp3(w.pts.NB, w.pts.HJ, 0.52);
  neck.prims.push(orient(S.torus(0.118, 0.012), cc, ax).color(ROPE).pbr(0.9).bump(0.003, 90, 'ridges').blend(0.004));
  neck.hard.push(spike(add3(cc, [0, -0.115, 0.04]), [0, -1, 0.2], 0.05, 0.01, BONE, [0, 0, 1], 0.3).lod(1));
  for (const sx of [1, -1]) neck.hard.push(spike(add3(cc, [sx * 0.085, -0.09, 0.03]), [sx * 0.4, -1, 0.2], 0.036, 0.007, BONE, [0, 0, 1], 0.3).lod(1));
  const reinA = add3(cc, [0, 0.105, -0.06]);
  neck.hard.push(H.tube([reinA, [0, 0.665, 0.25]], 0.006, 6, 6).color(ROPE).pbr(0.9).near());
  h.push(H.tube([[0, 0.665, 0.25], [0, 0.648, 0.19], [0, 0.668, 0.14]], 0.006, 8, 6).color(ROPE).pbr(0.9).near());
  h.push(H.sphere(0.012, 10).at(0, 0.672, 0.137).color(tone(ROPE, 0, 0, -0.08)).pbr(0.9).lod(1));
  // a second trophy: a string of teeth behind the saddle
  for (let i = -3; i <= 3; i++) h.push(spike([i * 0.03, 0.62 - Math.abs(i) * 0.012, -0.135], [i * 0.05, -0.3, -1], 0.034, 0.006, BONE, [0, -1, 0], 0.35).lod(1));
  p.push(S.torus(0.12, 0.006).rot(90, 0, 0).at(0, 0.51, -0.132).color(ROPE).pbr(0.9).blend(0.003));

  const nodes = finish(w.nodes, s);
  seatRider(nodes, R, 'torso', [0, 0.5, 0], seatA, s);
  return { kind: 'beast.rider', attack: R.desc.attack, hold: R.desc.hold || 'none', gait: 'wolf', mount: 'wolf', nodes };
}

// =====================================================================================
//  WAR HORSE (the lancer's mount)
// =====================================================================================

function horsePalette(base) {
  return {
    coat: base, shade: tone(base, -0.01, 0.02, -0.07), light: tone(base, 0.012, 0.04, 0.07), belly: tone(base, 0.01, -0.02, 0.04),
    point: 0x1d1714, mane: 0x15110f, maneTip: 0x3a2c22, muzzle: 0x2b2421, blaze: 0xe9e1d2, sock: 0xe2d9c8, pink: 0xb98a80,
    hoof: 0x2a221c, hoofPale: 0xb9a888, eye: 0x1c0f08, mouth: 0x3a1c1c,
  };
}

/**
 * A cloth fitted over a body: it hugs the surface `df` around the axis (0, yc, z) down to `hug` degrees either side
 * of the spine, then hangs free. us / vs are the grid lines (v = -1 .. 1 across the back, |v| <= vh hugs), so trim
 * can be given its own crisp rows. col(u, |v|, v) -> colour, drop(u) -> how far it hangs, dag(u) -> extra at the hem.
 */
function drape(df, o) {
  const us = o.us, vs = o.vs, pos = [], idx = [], cols = [];
  const hug = (o.hug ?? 95) * DEG, vh = o.vh ?? 0.55, off = o.off ?? 0.007;
  const yc = (z) => (typeof o.yc === 'function' ? o.yc(z) : o.yc);
  const baseAt = (z, th, sg) => { const d = [sg * Math.sin(th), Math.cos(th), 0]; return add3(surfHit(df, [d[0] * 0.7, yc(z) + d[1] * 0.7, z], mul3(d, -1), 30), mul3(d, off)); };
  const at = (u, v) => {
    const z = lerp(o.z0, o.z1, u), a = Math.abs(v), sg = v < 0 ? -1 : 1;
    if (a <= vh) return baseAt(z, (a / vh) * hug, sg);
    const t = (a - vh) / (1 - vh), b = baseAt(z, hug, sg), drop = o.drop(u) * t + (t > 0.999 && o.dag ? o.dag(u) : 0);
    return [b[0] + sg * ((o.flare ?? 0.02) * t + (o.ripple ?? 0.005) * t * Math.sin(u * (o.folds ?? 9) * Math.PI)), b[1] - drop, b[2]];
  };
  for (const u of us) for (const v of vs) { const pt = at(u, v); pos.push(pt[0], pt[1], pt[2]); cols.push(rgb(o.col(u, Math.abs(v), v))); }
  const nv = vs.length;
  for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < nv - 1; j++) { const a = i * nv + j, b = a + 1, c = a + nv, d = c + 1; idx.push(a, c, d, a, d, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  const h = H.geo(g).shade((x, y, z, nx, ny, nz, i) => cols[i]).pbr(o.rough ?? 0.85, 0);
  h.at2 = at;
  return h;
}
/** grid lines 0..1 (or -1..1 when sym) with extra lines hard against each `edge` so a colour change there stays crisp */
function gridLines(n, edges = [], sym = false) {
  const out = new Set();
  for (let i = 0; i <= n; i++) out.add(+(sym ? -1 + (2 * i) / n : i / n).toFixed(5));
  for (const e of edges) for (const sg of sym ? [1, -1] : [1]) { out.add(+(sg * e).toFixed(5)); out.add(+(sg * (e + 0.004)).toFixed(5)); }
  return [...out].sort((a, b) => a - b);
}

function buildHorse(def, o) {
  const C = horsePalette(tone(o.mount ?? 0x6b4a2e, 0.005, 0.1, 0.02));
  const rnd = rng(hashStr((def?.id || 'horse') + ':horse'));
  const coatC = (col) => (q) => q.color(col).tint(0.14, 11).pbr(0.63);
  const coat = coatC(C.coat), dark = coatC(C.point);
  const hair = (q, col = C.mane) => q.color(col).tint(0.25, 30).bump(0.0055, 46, 'fur').pbr(0.7);
  const nodes = [];
  nodes.push(node('root', null, [0, 0, 0]));
  const BO = [0, 0.68, 0];
  const NB = [0, 0.78, 0.33], PJ = [0, 1.19, 0.515], headPitch = 58;

  // ---------------- torso ----------------
  const torso = node('torso', 'root', BO, { rig: 'body', detail: 0.66 }); nodes.push(torso);
  {
    const p = torso.prims;
    p.push(coat(lay(0.18, 0.192, 0.3).at(0, 0.662, 0.0)));                                         // barrel
    p.push(coat(lay(0.172, 0.208, 0.175).at(0, 0.668, 0.225).blend(0.06)));                        // the deep girth of the forehand
    p.push(coat(lay(0.064, 0.07, 0.15).at(0, 0.838, 0.19).blend(0.05)));                           // withers
    p.push(coat(lay(0.162, 0.168, 0.17).at(0, 0.7, -0.2).blend(0.06)));                            // coupling
    p.push(coat(lay(0.15, 0.16, 0.105).at(0, 0.665, -0.365).blend(0.05)));                         // buttocks
    p.push(coat(bone([0, 0.7, 0.29], [0, 0.86, 0.42], 0.155, 0.13).blend(0.06)));                  // root of the neck
    p.push(coat(bone([0, 0.815, -0.4], [0, 0.816, -0.47], 0.05, 0.038).blend(0.03)));              // dock
    p.push(...S.mirrorX([
      coat(S.ellipsoid(0.07, 0.1, 0.06).at(0.062, 0.63, 0.375).blend(0.045)),                     // breast muscles
      coat(S.ellipsoid(0.066, 0.155, 0.116).rot(-25, 0, -6).at(0.134, 0.69, 0.275).blend(0.04)),   // shoulder
      coat(S.ellipsoid(0.118, 0.15, 0.18).rot(14, 0, 0).at(0.076, 0.728, -0.3).blend(0.05)),       // croup: two great rounds of muscle
      coat(lay(0.05, 0.05, 0.2).at(0.062, 0.832, -0.08).blend(0.05)),                              // long back muscles
      coat(S.ellipsoid(0.03, 0.06, 0.09).rot(30, 0, 0).at(0.165, 0.6, -0.14).blend(0.04)),         // fold of the flank
    ]));
    p.push(lay(0.012, 0.03, 0.2).at(0, 0.895, -0.27).cut(0.03));                                    // the groove of the spine over the croup
    p.push(S.ellipsoid(0.01, 0.07, 0.03).at(0, 0.62, 0.44).cut(0.025));                             // and between the breast muscles
    p.push(...S.mirrorX([
      coat(S.ellipsoid(0.03, 0.11, 0.05).rot(-28, 0, -8).at(0.158, 0.7, 0.33).blend(0.03)),           // spine of the shoulder blade
      coat(S.ellipsoid(0.04, 0.085, 0.075).rot(20, 0, -6).at(0.168, 0.66, 0.2).blend(0.035)),         // triceps
      S.ellipsoid(0.03, 0.15, 0.012).rot(-30, 12, 0).at(0.14, 0.72, 0.385).color(C.shade).pbr(0.63).paint(0.012, -0.006),   // groove where neck meets shoulder
      S.ellipsoid(0.03, 0.12, 0.01).rot(12, 0, 0).at(0.178, 0.66, 0.135).color(C.shade).pbr(0.63).paint(0.012, -0.005),     // behind the elbow
      S.ellipsoid(0.03, 0.14, 0.01).rot(28, 0, 0).at(0.178, 0.67, -0.165).color(C.shade).pbr(0.63).paint(0.012, -0.005),    // the line of the flank
      S.ellipsoid(0.03, 0.16, 0.009).rot(-14, 0, 0).at(0.176, 0.68, -0.37).color(C.shade).pbr(0.63).paint(0.01, -0.004),    // between the muscles of the quarter
    ]));
    p.push(lay(0.15, 0.06, 0.4).at(0, 0.49, 0.0).color(C.belly).pbr(0.6).tint(0.1, 12).paint(0.05));
    p.push(lay(0.2, 0.2, 0.5).at(0, 1.03, -0.1).color(C.shade).pbr(0.56).tint(0.1, 12).paint(0.1));
    p.push(...S.mirrorX([S.ellipsoid(0.06, 0.09, 0.11).at(0.16, 0.76, -0.3).color(C.light).pbr(0.5).tint(0.3, 30).paint(0.05)]));   // dappled sheen on the quarters
  }

  // ---------------- neck: arched, with a mane falling to both sides ----------------
  const neck = node('neck', 'torso', NB, { rig: 'mneck', detail: 0.74 }); nodes.push(neck);
  const NC = [[0, 0.77, 0.36], [0, 0.915, 0.452], [0, 1.055, 0.502], [0, 1.165, 0.512]];        // centres up the neck
  const crest = curve([[0, 0.87, 0.2], [0, 0.995, 0.33], [0, 1.13, 0.412], [0, 1.228, 0.462], [0, 1.275, 0.51]], 20);
  {
    const p = neck.prims, wd = [0.094, 0.074, 0.058, 0.05], dp = [0.158, 0.128, 0.098, 0.08];
    for (let i = 0; i < 3; i++) {
      const a = NC[i], b = NC[i + 1], t = norm3(sub3(b, a)), dor = [0, t[2], -t[1]], L = len3(sub3(b, a));
      p.push(coat(orient(S.ellipsoid((wd[i] + wd[i + 1]) / 2, L * 0.78, (dp[i] + dp[i + 1]) / 2), lerp3(a, b, 0.5), t, dor).blend(i ? 0.05 : 0.025)));
    }
    p.push(coat(S.ellipsoid(0.105, 0.16, 0.155).at(0, 0.755, 0.335).blend(0.05)));                                 // buried in the shoulders
    p.push(coat(bone([0, 0.88, 0.25], [0, 1.21, 0.45], 0.05, 0.034).blend(0.04)));                                 // the crest
    p.push(coat(S.ellipsoid(0.05, 0.06, 0.06).at(0, 1.165, 0.512).blend(0.03)));                                   // poll
    p.push(...S.mirrorX([bone([0.046, 0.84, 0.475], [0.036, 1.06, 0.545], 0.016, 0.012).color(C.shade).pbr(0.58).paint(0.012, -0.004)])); // jugular groove
    // mane: short heavy locks, alternating sides
    for (let i = 2; i < 20; i++) {
      const c0 = crest[i], sx = i % 2 ? 1 : -1, L = (0.105 + rnd() * 0.04) * (i > 16 ? 0.75 : 1), sw = 0.025 + rnd() * 0.02;
      const mid = add3(c0, [sx * 0.048, -L * 0.45, -sw * 0.5]), tip = add3(c0, [sx * (0.056 + rnd() * 0.016), -L, -sw]);
      p.push(hair(bone(add3(c0, [0, -0.012, -0.008]), mid, 0.022, 0.018).blend(0.01)), hair(bone(mid, tip, 0.018, 0.004).blend(0.008)));
      neck.hard.push(lock(lerp3(mid, tip, 0.35), norm3(sub3(tip, mid)), L * 0.5, 0.015, 0.009, C.mane, C.maneTip, [sx, 0, 0], 0.15).lod(1));
    }
    p.push(bone(crest[1], crest[19], 0.026, 0.02).color(C.mane).pbr(0.7).paint(0.008));
  }

  // ---------------- head ----------------
  const hd = horseHead(C, rnd, o);
  const head = node('head', 'neck', [0, 0, 0], { rig: 'mhead', pos: sub3(PJ, NB), rot: [headPitch, 0, 0], detail: 1.2 });
  head.prims = hd.p; head.hard = hd.hard; nodes.push(head);

  // ---------------- legs ----------------
  const EL = [0.126, 0.535, 0.235], KN = [0.12, 0.3, 0.25], FF = [0.12, 0.11, 0.252];
  const HP = [0.108, 0.7, -0.3], ST = [0.14, 0.5, -0.215], HK = [0.126, 0.318, -0.375], FH = [0.126, 0.11, -0.35];
  const hoof = (part, c, pale) => {
    const hc = pale ? C.hoofPale : C.hoof;
    part.prims.push(S.cone(0.062, 0.047, 0.07, 0.008).rot(10, 0, 0).at(c[0], 0.034, c[2]).color(hc).tint(0.2, 30).pbr(0.38).blend(0.008));
    part.prims.push(S.torus(0.047, 0.007).rot(10, 0, 0).at(c[0], 0.07, c[2] - 0.006).color(pale ? C.sock : C.point).pbr(0.6).paint(0.004, 0.003));    // coronet
    part.hard.push(H.torus(0.054, 0.008, 16, 6, Math.PI * 1.5).rot(90, 0, 0).rot(0, 135, 0).at(c[0], 0.005, c[2] + 0.004).color(IRON).pbr(0.45, 1).lod(1));   // the shoe
  };
  const fl = { up: { prims: [], hard: [] }, lo: { prims: [], hard: [] }, paw: { prims: [], hard: [] } };
  {
    const u = fl.up.prims, l = fl.lo.prims, w = fl.paw.prims;
    u.push(coat(bone(EL, KN, 0.07, 0.046)));
    u.push(coat(S.ellipsoid(0.062, 0.1, 0.092).rot(-30, 0, 0).at(0.13, 0.575, 0.243).blend(0.03)));             // elbow and upper arm
    u.push(coat(S.ellipsoid(0.046, 0.095, 0.056).at(0.136, 0.455, 0.254).blend(0.02)));                          // forearm muscle
    u.push(coat(S.sphere(0.048).at(KN[0], KN[1], KN[2]).blend(0.02)));
    u.push(S.cyl(0.09, 0.12, 0.01).at(KN[0], KN[1] + 0.03, KN[2]).color(C.point).pbr(0.58).tint(0.1, 12).paint(0.05));   // black points creep up from the knee
    l.push(dark(S.ellipsoid(0.046, 0.05, 0.047).at(KN[0], KN[1], KN[2])));
    l.push(dark(bone(KN, FF, 0.036, 0.032).blend(0.02)));
    l.push(dark(bone(add3(KN, [0, -0.04, -0.027]), add3(FF, [0, 0.03, -0.023]), 0.014, 0.014).blend(0.012)));    // tendon
    l.push(dark(S.sphere(0.042).at(FF[0], FF[1], FF[2]).blend(0.014)));
    w.push(dark(S.sphere(0.041).at(FF[0], FF[1], FF[2])));
    w.push(dark(bone(FF, [0.12, 0.062, 0.27], 0.036, 0.042).blend(0.014)));
    hoof(fl.paw, [0.12, 0, 0.282], false);
    for (let i = 0; i < 5; i++) {
      const L = 0.075 + rnd() * 0.02;
      w.push(hair(bone([0.12 + (i - 2) * 0.014, 0.125, 0.232], [0.12 + (i - 2) * 0.022, 0.125 - L, 0.215 - (i % 2) * 0.012], 0.02, 0.004).blend(0.01)));   // feather
    }
  }
  const bl = { up: { prims: [], hard: [] }, lo: { prims: [], hard: [] }, paw: { prims: [], hard: [] } };
  {
    const u = bl.up.prims, l = bl.lo.prims, w = bl.paw.prims;
    u.push(coat(S.ellipsoid(0.084, 0.178, 0.14).rot(18, 0, -4).at(0.122, 0.6, -0.285)));                        // thigh
    u.push(coat(bone(ST, HK, 0.078, 0.042).blend(0.035)));                                                       // gaskin
    u.push(coat(S.sphere(0.064).at(ST[0], ST[1], ST[2]).blend(0.03)));                                           // stifle
    u.push(coat(S.sphere(0.045).at(HK[0], HK[1], HK[2]).blend(0.02)));
    u.push(S.cyl(0.09, 0.1, 0.01).at(HK[0], HK[1] + 0.02, HK[2]).color(C.point).pbr(0.58).tint(0.1, 12).paint(0.05));
    l.push(dark(S.ellipsoid(0.042, 0.054, 0.05).at(HK[0], HK[1], HK[2])));
    l.push(dark(S.ellipsoid(0.022, 0.038, 0.025).at(HK[0], HK[1] + 0.024, HK[2] - 0.036).blend(0.012)));         // point of the hock
    l.push(dark(bone(HK, FH, 0.037, 0.033).blend(0.02)));
    l.push(dark(bone(add3(HK, [0, -0.04, -0.03]), add3(FH, [0, 0.03, -0.024]), 0.014, 0.014).blend(0.012)));
    l.push(dark(S.sphere(0.043).at(FH[0], FH[1], FH[2]).blend(0.014)));
    l.push(S.cyl(0.07, 0.1, 0.01).at(FH[0], FH[1] + 0.02, FH[2]).color(C.sock).pbr(0.6).paint(0.014));            // white socks behind
    w.push(coatC(C.sock)(S.sphere(0.042).at(FH[0], FH[1], FH[2])));
    w.push(coatC(C.sock)(bone(FH, [0.126, 0.062, -0.332], 0.037, 0.043).blend(0.014)));
    hoof(bl.paw, [0.126, 0, -0.32], true);
    for (let i = 0; i < 5; i++) {
      const L = 0.075 + rnd() * 0.02;
      w.push(hair(bone([0.126 + (i - 2) * 0.014, 0.125, -0.372], [0.126 + (i - 2) * 0.022, 0.125 - L, -0.388 - (i % 2) * 0.012], 0.02, 0.004).blend(0.01), C.sock));
    }
  }
  const J = { F: [[0.122, 0.6, 0.25], KN, FF], B: [HP, HK, FH] };
  for (const [nm, part, side, js] of [['FL', fl, 1, J.F], ['FR', fl, -1, J.F], ['BL', bl, 1, J.B], ['BR', bl, -1, J.B]]) {
    const cp = (list) => (side > 0 ? flat(list).map((q) => q.clone()) : mirrorAll(list));
    const m = (v) => (side > 0 ? v : mirX(v));
    const up = node(`leg${nm}`, 'torso', m(js[0]), { rig: 'legs', detail: 0.7, minRes: 16 });
    const lo = node(`shin${nm}`, `leg${nm}`, m(js[1]), { rig: 'shins', detail: 0.82, minRes: 20 });
    const pw = node(`paw${nm}`, `shin${nm}`, m(js[2]), { rig: 'paws', detail: 0.9, minRes: 18 });
    up.prims = cp(part.up.prims); up.hard = cp(part.up.hard);
    lo.prims = cp(part.lo.prims); lo.hard = cp(part.lo.hard);
    pw.prims = cp(part.paw.prims); pw.hard = cp(part.paw.hard);
    nodes.push(up, lo, pw);
  }

  // ---------------- tail: a dock and a long fall of hair ----------------
  const TL = [[0, 0.816, -0.46], [0, 0.765, -0.565], [0, 0.56, -0.64], [0, 0.3, -0.63]];
  for (let i = 0; i < 3; i++) {
    const n = node(`tail${i}`, i === 0 ? 'torso' : `tail${i - 1}`, TL[i], { rig: 'tail', detail: 0.7, minRes: 16 });
    nodes.push(n);
    const a = TL[i], b = TL[i + 1], r0 = [0.036, 0.056, 0.064][i], r1 = [0.056, 0.064, 0.012][i];
    n.prims.push(hair(S.sphere(r0 * 0.9).at(a[0], a[1], a[2])));
    const ns = i === 2 ? 8 : 6;
    for (let j = 0; j < ns; j++) {
      const ang = (j / ns) * Math.PI * 2 + i * 0.6, ox = Math.cos(ang), oz = Math.sin(ang);
      const e = i === 2 ? [b[0] + ox * 0.07, b[1] + rnd() * 0.17 - 0.05, b[2] + oz * 0.05] : [b[0] + ox * r1 * 0.45, b[1], b[2] + oz * r1 * 0.4];
      if (i === 2 && j % 2 === 0) n.hard.push(lock(lerp3([a[0] + ox * r0 * 0.45, a[1], a[2] + oz * r0 * 0.4], e, 0.55), [ox * 0.25, -1, oz * 0.2 - 0.1], 0.13 + rnd() * 0.05, 0.022, 0.014, C.mane, C.maneTip, [0, 0, -1], 0.12).lod(1));
      n.prims.push(hair(bone([a[0] + ox * r0 * 0.45, a[1], a[2] + oz * r0 * 0.4], e, r0 * 0.58, i === 2 ? 0.005 : r1 * 0.58).blend(0.012), j % 2 ? C.mane : tone(C.mane, 0, 0, 0.035)));
    }
  }
  return { nodes, C, rnd, NB, PJ, headPitch, BO, crest };
}

/** horse head in its own frame: the poll at the origin, the face running along +Z, the jaw on the -Y side */
function horseHead(C, rnd, o) {
  const p = [], hard = [];
  const coatC = (col) => (q) => q.color(col).tint(0.1, 18).pbr(0.58);
  const coat = coatC(C.coat), mz = coatC(C.muzzle);
  const hair = (q) => q.color(C.mane).tint(0.25, 30).bump(0.005, 50, 'fur').pbr(0.7);
  const cloth = o.cloth ?? 0x2f5aa8, steel = o.armor ?? 0x9aa3ad, gold = BRASS;
  p.push(coat(lay(0.064, 0.062, 0.078).at(0, 0, 0.035)));                                                    // cranium
  p.push(coat(S.sphere(0.058).at(0, -0.01, -0.01).blend(0.03)));                                              // hides the neck joint
  p.push(coat(bone([0, 0.012, 0.06], [0, 0.004, 0.3], 0.053, 0.037).blend(0.03)));                            // the long bones of the face
  p.push(coat(bone([0, -0.085, 0.07], [0, -0.05, 0.3], 0.045, 0.03).blend(0.03)));                            // jaw
  p.push(...S.mirrorX([
    coat(S.ellipsoid(0.034, 0.078, 0.086).at(0.037, -0.07, 0.072).blend(0.025)),                              // the round plate of the cheek
    coat(S.ellipsoid(0.02, 0.016, 0.03).rot(0, 0, -20).at(0.05, 0.022, 0.1).blend(0.012)),                    // bony brow over the eye
    coat(S.ellipsoid(0.012, 0.01, 0.07).at(0.04, -0.008, 0.2).blend(0.012)),                                  // cheekbone ridge
  ]));
  p.push(mz(lay(0.046, 0.05, 0.052).at(0, -0.016, 0.328).blend(0.03)));                                       // muzzle
  p.push(mz(S.ellipsoid(0.03, 0.024, 0.032).at(0, -0.06, 0.332).blend(0.016)));                               // chin
  p.push(...S.mirrorX([
    mz(S.ellipsoid(0.018, 0.022, 0.02).rot(0, 20, 0).at(0.03, 0.0, 0.352).blend(0.01)),                       // flare of the nostril
    S.ellipsoid(0.009, 0.014, 0.012).rot(0, 20, 20).at(0.036, 0.002, 0.364).cut(0.004).color(0x0a0707),
  ]));
  p.push(S.ellipsoid(0.06, 0.0045, 0.06).at(0, -0.04, 0.325).color(0x120c0b).paint(0.003, -0.003));            // the line of the mouth
  p.push(S.ellipsoid(0.02, 0.02, 0.015).at(0, -0.02, 0.378).color(C.pink).pbr(0.6).paint(0.012));              // a pink snip between the nostrils
  // eyes: large, dark and set on the side of the head
  const ex = 0.0535, ey = 0.004, ez = 0.108, er = 0.0165;
  p.push(...S.mirrorX([
    S.ellipsoid(0.014, 0.0135, 0.019).at(ex + 0.008, ey, ez).cut(0.005).color(0x120b08),
    S.sphere(er * 0.94).at(ex, ey, ez).color(C.eye).pbr(0.15).blend(0),
  ]));
  hard.push(...H.mirrorX([
    eye(er, { iris: 0x4a2a14, rim: 0x1a0d06, white: 0x1a0f0a, pupilSize: 1.6, irisSize: 1.5 }).rot(0, 78, 0).at(ex, ey, ez).lod(1),
    H.sphere(0.0035, 8).at(ex + 0.0135, ey + 0.006, ez + 0.006).color(0xffffff).glow(0.6).pbr(0.1).lod(0),                 // a catch-light
  ]));
  // ears
  const ear = [
    coat(S.capsule([0, 0, 0], [0, 0.092, 0], 0.03, 0.006)),
    S.ellipsoid(0.022, 0.06, 0.024).at(0, 0.04, 0.028).cut(0.005).color(tone(C.coat, 0, -0.05, -0.16)),
    S.ellipsoid(0.03, 0.08, 0.03).at(0, 0.03, -0.044).cut(0.004),
    S.ellipsoid(0.012, 0.016, 0.012).at(0, 0.088, 0).color(C.point).pbr(0.58).paint(0.008),
  ].map((q) => q.rot(-62, 14, -16).at(0.04, 0.045, -0.012));
  p.push(...ear, ...mirrorAll(ear));

  // ---- chamfron: a steel plate down the face, flanged round the eyes, with a boss and a short spike ----
  const st = (q) => q.color(steel).pbr(0.34, 1).tint(0.08, 30);
  p.push(st(bone([0, 0.03, 0.0], [0, 0.012, 0.29], 0.052, 0.034)).paint(0.003, 0.0075));
  p.push(...S.mirrorX([st(S.ellipsoid(0.03, 0.04, 0.05).at(0.044, 0.03, 0.105)).paint(0.003, 0.0075)]));
  p.push(...S.mirrorX([S.ellipsoid(0.017, 0.017, 0.022).at(ex + 0.006, ey, ez).color(C.coat).pbr(0.58).paint(0.003, 0)]));   // the eye shows through its cut-out
  p.push(st(S.capsule([0, 0.064, 0.03], [0, 0.038, 0.3], 0.0085)).blend(0.004));                                             // medial ridge
  p.push(S.capsule([0, 0.02, 0.292], [0.03, 0.006, 0.288], 0.006).color(gold).pbr(0.35, 1).blend(0.003), S.capsule([0, 0.02, 0.292], [-0.03, 0.006, 0.288], 0.006).color(gold).pbr(0.35, 1).blend(0.003));
  hard.push(H.lathe([[0.0, 0.0], [0.028, 0.0], [0.03, 0.006], [0.02, 0.012], [0.008, 0.018], [0.006, 0.05], [0, 0.075]], 16).rot(8, 0, 0).at(0, 0.066, 0.075).color(gold).pbr(0.3, 1).near());  // boss and spike
  for (const sx of [1, -1]) for (let i = 0; i < 5; i++) hard.push(H.sphere(0.004, 8).at(sx * (0.042 - i * 0.004), 0.036 - i * 0.004, 0.02 + i * 0.062).color(gold).pbr(0.3, 1).lod(0));
  // ---- bridle ----
  const lea = (q) => q.color(LEATHER_DARK).pbr(0.6).blend(0.003);
  const nose = []; for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; nose.push([Math.sin(a) * 0.046, -0.022 + Math.cos(a) * 0.062, 0.262 + Math.cos(a) * 0.004]); }
  for (let i = 0; i < 12; i++) p.push(lea(S.capsule(nose[i], nose[i + 1], 0.0062)));
  p.push(...S.mirrorX([...strap([[0.047, -0.03, 0.262], [0.062, -0.03, 0.15], [0.058, 0.0, 0.03], [0.045, 0.03, -0.03]], 0.006, LEATHER_DARK, { n: 8 })]));   // cheek pieces
  hard.push(...H.mirrorX([
    ringAt([0.05, -0.05, 0.285], [1, 0, 0], 0.016, 0.0038, BRASS).lod(1),
    H.tube([[0.052, -0.05, 0.283], [0.066, -0.075, 0.17], [0.068, -0.1, 0.06], [0.064, -0.085, -0.02]], 0.005, 10, 5).color(cloth).pbr(0.8).near(),            // rein, back to the throat
  ]));
  hard.push(H.cyl(0.0045, 0.0045, 0.1, 8).rot(0, 0, 90).at(0, -0.05, 0.285).color(IRON).pbr(0.4, 1).lod(1));                                            // the bit
  // ---- forelock and a plume in the lancer's colour ----
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.02, L = 0.07 + rnd() * 0.025;
    p.push(hair(bone([x * 0.6, 0.07, -0.02], [x * 1.6, 0.082, 0.01 + L], 0.017, 0.004).blend(0.01)));
  }
  const plumeCols = [tone(cloth, 0, 0, -0.14), cloth, tone(cloth, 0, -0.1, 0.2), tone(cloth, 0, 0, -0.2)];
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.2, L = 0.2 - Math.abs(i - 3) * 0.022 + rnd() * 0.015;
    hard.push(feather([Math.sin(a) * 0.012, 0.078, -0.034 - Math.abs(i - 3) * 0.003], norm3([Math.sin(a) * 0.55, 1, -0.5 - Math.abs(a) * 0.3]), L, 0.06, [0, 0.4, 1], plumeCols, 0.72, 2.6).lod(i % 2 ? 1 : 2));
  }
  p.push(S.cone(0.016, 0.022, 0.03, 0.003).at(0, 0.086, -0.036).color(gold).pbr(0.35, 1).blend(0.002));
  return { p, hard };
}

/** saddle, saddle cloth, breast strap, crupper, stirrups and the body's share of the reins */
function horseTack(hs, R, seatA, o) {
  const cloth = o.cloth ?? 0x2f5aa8, gold = 0xd8b23a, clothDark = tone(cloth, 0, 0, -0.1);
  const torso = hs.nodes.find((n) => n.name === 'torso'), neck = hs.nodes.find((n) => n.name === 'neck');
  const df = distanceField(torso.prims);
  const tack = node('tack', 'torso', hs.BO, { detail: 0.85 }); hs.nodes.push(tack);
  const p = tack.prims, h = tack.hard;
  // ---- saddle cloth: square-cut, gold-bordered, a little longer in front than behind ----
  const mk = (n, m, far) => drape(df, {
    z0: 0.235, z1: -0.235, yc: 0.662, hug: 100, vh: 0.6, off: 0.008, flare: 0.012, ripple: far ? 0 : 0.004, folds: 7,
    us: gridLines(n, far ? [] : [0.04, 0.955]), vs: gridLines(m, far ? [] : [0.9], true),
    drop: (u) => 0.12 - 0.05 * smooth((u - 0.45) / 0.55), dag: null,
    col: (u, a) => (a > 0.902 || u < 0.042 || u > 0.957 ? gold : a > 0.84 && a < 0.87 ? clothDark : cloth),
  });
  const sc = mk(26, 44, false);
  h.push(sc.near(), mk(5, 8, true).far());
  // the lancer's badge on the cloth: a gold sun
  for (const sg of [1, -1]) {
    const c = sc.at2(0.78, sg * 0.78), c2 = sc.at2(0.78, sg * 0.8), nrm = [sg, 0.12, 0];
    h.push(orient(H.cyl(0.024, 0.024, 0.004, 20), add3(c, [sg * 0.002, 0, 0]), nrm).color(gold).pbr(0.4, 1).lod(1));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; h.push(orient(H.cone(0.007, 0.02, 4), add3(c, [sg * 0.002, Math.cos(a) * 0.036, Math.sin(a) * 0.036]), [0, Math.cos(a), Math.sin(a)]).color(gold).pbr(0.4, 1).lod(1)); }
    void c2;
  }
  // ---- war saddle: deep seat, high pommel and cantle, long flaps ----
  const lea = (q, col = LEATHER) => q.color(col).tint(0.12, 40).pbr(0.55);
  p.push(lea(lay(0.105, 0.04, 0.14).at(0, 0.868, 0.0)));
  p.push(lea(lay(0.085, 0.07, 0.03).rot(-16, 0, 0).at(0, 0.91, 0.135), LEATHER_DARK).blend(0.014));          // pommel
  p.push(lea(lay(0.108, 0.075, 0.032).rot(16, 0, 0).at(0, 0.915, -0.135), LEATHER_DARK).blend(0.014));       // cantle
  p.push(lay(0.07, 0.04, 0.09).at(0, 0.925, 0.0).cut(0.03).color(LEATHER_DARK));                              // the dish of the seat
  p.push(...S.mirrorX([lea(S.ellipsoid(0.022, 0.125, 0.105).rot(0, 0, -9).at(0.168, 0.775, 0.02), LEATHER_DARK).blend(0.02)]));   // flaps
  p.push(S.torus(0.196, 0.014).rot(90, 0, 0).at(0, 0.662, 0.09).color(LEATHER_DARK).pbr(0.6).blend(0.004));  // girth
  h.push(...H.mirrorX([H.box(0.034, 0.04, 0.008, 0.003).rot(0, 90, 0).at(0.2, 0.6, 0.09).color(BRASS).pbr(0.35, 1).lod(1)]));
  h.push(...rivets([[0.07, 0.932, 0.15], [0, 0.965, 0.15], [-0.07, 0.932, 0.15]], 5, 0.006), ...rivets([[0.09, 0.94, -0.152], [0, 0.975, -0.155], [-0.09, 0.94, -0.152]], 6, 0.006));
  // ---- stirrups ----
  for (const side of [1, -1]) {
    const ft = riderToMount(R, seatA, 1, R.foot(side)), top = [side * 0.176, 0.83, 0.05], eye0 = [ft[0], ft[1] + 0.085, ft[2] - 0.005];
    p.push(...strap([top, lerp3(top, eye0, 0.5), eye0], 0.008, LEATHER, { n: 4 }));
    h.push(ringAt([ft[0], ft[1] + 0.036, ft[2]], [0, 0.1, 1], 0.045, 0.0075, IRON).near());
    h.push(H.box(0.085, 0.01, 0.045, 0.003).at(ft[0], ft[1] - 0.006, ft[2]).color(IRON).pbr(0.45, 1).near());
  }
  // ---- breast strap with pendants ----
  const breast = [[0.172, 0.8, 0.17], [0.19, 0.735, 0.3], [0.125, 0.7, 0.415], [0, 0.692, 0.447]];
  p.push(...strap(breast, 0.014, LEATHER, { n: 8 }), ...mirrorAll(strap(breast, 0.014, LEATHER, { n: 8 })));
  const tab = [[-0.022, 0], [0.022, 0], [0.022, -0.035], [0, -0.062], [-0.022, -0.035]];
  const bc = curve(breast, 12);
  const pend = (q, nrm) => [
    orient(H.extrude(tab, 0.005, 0.002), add3(q, mul3(nrm, 0.012)), [0, 1, 0], nrm).color(cloth).pbr(0.8).near(),
    orient(H.sphere(0.008, 10).scale(1, 1, 0.5), add3(q, add3(mul3(nrm, 0.017), [0, -0.024, 0])), [0, 1, 0], nrm).color(gold).pbr(0.35, 1).lod(1),
  ];
  for (const sg of [1, -1]) for (const i of [3, 6, 9]) { const q = [sg * bc[i][0], bc[i][1], bc[i][2]]; h.push(...pend(q, gradAt(df, q))); }
  h.push(...pend([0, 0.692, 0.447], [0, 0, 1]), ...H.mirrorX(rivets(breast, 6, 0.0055)));
  // ---- crupper ----
  const back = [[0, 0.895, -0.15], [0, 0.898, -0.3], [0, 0.85, -0.42]];
  p.push(...strap(back, 0.012, LEATHER, { n: 6 }));
  const hip = [[0, 0.9, -0.27], [0.1, 0.875, -0.3], [0.175, 0.79, -0.33]];
  p.push(...strap(hip, 0.011, LEATHER, { n: 6 }), ...mirrorAll(strap(hip, 0.011, LEATHER, { n: 6 })));
  for (const sg of [1, -1]) { const q = [sg * 0.178, 0.79, -0.33]; h.push(...pend(q, [sg, 0.1, 0])); }
  h.push(H.sphere(0.014, 12).scale(1, 0.6, 1).at(0, 0.91, -0.27).color(gold).pbr(0.35, 1).lod(1));
  // ---- reins: along the neck (they pass close to its joints, so they hold together when it moves) and up to the hand ----
  const hp = hs.headPitch * DEG, toRest = (q) => [q[0], hs.PJ[1] + q[1] * Math.cos(hp) - q[2] * Math.sin(hp), hs.PJ[2] + q[1] * Math.sin(hp) + q[2] * Math.cos(hp)];
  for (const sg of [1, -1]) {
    const a = toRest([sg * 0.064, -0.085, -0.02]), b = [sg * 0.085, 0.98, 0.37], c = [sg * 0.08, 0.9, 0.27];
    neck.hard.push(H.tube([a, lerp3(a, b, 0.5), b, c], 0.005, 10, 5).color(cloth).pbr(0.8).near());
    h.push(H.tube([c, [sg * 0.06, 0.925, 0.21], [0.045 + sg * 0.012, 0.985, 0.17]], 0.005, 6, 5).color(cloth).pbr(0.8).near());
  }
  return tack;
}

function lancer(def, o) {
  const s = 1.14;
  const R = makeRider(def, o, 1);
  const seatA = [0, 0.945 / 1 , 0.0];
  const hs = buildHorse(def, o);
  horseTack(hs, R, seatA, o);
  const nodes = finish(hs.nodes, s);
  seatRider(nodes, R, 'torso', hs.BO, seatA, s);
  return { kind: 'beast.rider', attack: R.desc.attack, hold: R.desc.hold || 'none', gait: 'horse', mount: 'horse', nodes };
}

// =====================================================================================
//  GRIFFON: eagle before, lion behind
// =====================================================================================

/** a feather: unit length along +Y, half-width 0.5 along X, cambered about its shaft, upper face toward +Z */
function featherGeo(round) {
  return cached(`feather${round}`, () => {
    const N = 7, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, w = 0.5 * Math.min(1, Math.pow(t * 3.4, 0.7)) * Math.pow(Math.max(0, 1 - Math.pow(t, round)), 0.55) + 0.025 * (1 - t);
      pos.push(-w, t, -0.16 * w, 0, t, 0.035, w, t, -0.16 * w);
    }
    for (let i = 0; i < N; i++) { const a = i * 3, b = a + 3; idx.push(a, a + 1, b + 1, a, b + 1, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}
/** feather from base along dir with its upper face toward `face`; cols = [root, vane, tip, shaft]; band = where the tip colour starts */
function feather(base, dir, len, width, face, cols, band = 0.7, round = 3.2) {
  const c = cols.map((x) => rgb(x));
  const h = H.geo(featherGeo(round)).shade((x, y) => (Math.abs(x) < 0.01 && y < 0.9 ? c[3] : y > band ? c[2] : y < 0.24 ? c[0] : c[1])).color(cols[1]).pbr(0.8).scale(width, len, width);
  return orient(h, base, dir, face);
}

function griffonPalette(base) {
  const fur = tone(base, 0, 0.06, 0.0);
  return {
    fur, furDark: tone(fur, -0.01, 0.02, -0.12), furPale: mix(tone(fur, 0.01, -0.05, 0.16), 0xf0e2c0, 0.4), tuft: 0x3a2416,
    white: 0xefe6d2, cream: 0xe2d2b0, chest: 0x8a5428, chestDark: 0x5e3a1e, umber: 0x2c1a10, bar: 0x6e4826,
    beak: 0xf0a81e, beakTip: 0x3a2a1c, cere: 0xf2c63a, scale: 0xe2a62a, scaleDark: 0xb87a1a, talon: 0x1a1512,
    mouth: 0x7a2a2e, tongue: 0xd0686a, pad: 0x3a2a24,
    eye: { iris: 0xffc21a, rim: 0x8a4a06, white: 0x1a1008, glow: 0.35 },
  };
}

/** one wing, spread, authored for the LEFT side: { S, W, arm: { prims, hard }, tip: { prims, hard } } */
function griffonWing(C, rnd) {
  const Sh = [0.105, 0.925, 0.2], E = [0.345, 0.99, 0.135], W = [0.665, 1.0, 0.235], T = [0.99, 0.975, 0.15];
  const arm = { prims: [], hard: [] }, tip = { prims: [], hard: [] };
  const pl = (q) => q.color(C.chestDark).tint(0.2, 30).bump(0.0055, 34, 'scales').pbr(0.85);
  arm.prims.push(pl(S.sphere(0.062).at(Sh[0], Sh[1], Sh[2])));
  arm.prims.push(pl(bone(Sh, E, 0.058, 0.046).blend(0.02)), pl(S.ellipsoid(0.05, 0.04, 0.07).at(...lerp3(Sh, E, 0.4)).blend(0.03)));
  arm.prims.push(pl(S.sphere(0.047).at(E[0], E[1], E[2]).blend(0.02)), pl(bone(E, W, 0.045, 0.034).blend(0.02)), pl(S.sphere(0.036).at(W[0], W[1], W[2]).blend(0.014)));
  tip.prims.push(pl(S.sphere(0.035).at(W[0], W[1], W[2])), pl(bone(W, T, 0.034, 0.014).blend(0.014)));
  const up = [0, 1, 0.05];
  const flight = [C.cream, C.bar, C.umber, 0xd8c8a4], covert = [C.chestDark, C.chest, 0xb5884c, 0x4a2e18], small = [C.umber, C.chestDark, C.chest, 0x3a2416];
  const jit = () => (rnd() - 0.5) * 0.05;
  const far = { arm: [], tip: [] };
  // tertials and secondaries hang from the arm
  const nT = 5, nS = 11, nP = 10;
  for (let i = 0; i < nT; i++) {
    const t = 0.3 + 0.7 * (i + 0.5) / nT, b = add3(lerp3(Sh, E, t), [0, -0.02, -0.02]), d = norm3([-0.1 + jit(), -0.03, -1]), L = 0.3 + t * 0.1;
    arm.hard.push(feather(b, d, L, 0.1, up, flight, 0.72).near());
    arm.hard.push(feather(add3(b, [0, 0.012, 0.005]), d, L * 0.5, 0.095, up, covert, 0.7).near(), feather(add3(b, [0, 0.022, 0.012]), d, L * 0.28, 0.09, up, small, 0.6).lod(1));
    far.arm.push(add3(b, mul3(d, L)));
  }
  for (let i = 0; i < nS; i++) {
    const t = (i + 0.5) / nS, b = add3(lerp3(E, W, t), [0, -0.018, -0.02]), d = norm3([0.02 + t * 0.2 + jit(), -0.02, -1]), L = 0.43 + t * 0.06;
    arm.hard.push(feather(b, d, L, 0.092, up, flight, 0.72).near());
    arm.hard.push(feather(add3(b, [0, 0.012, 0.004]), d, L * 0.5, 0.088, up, covert, 0.7).near(), feather(add3(b, [0, 0.022, 0.012]), d, L * 0.27, 0.085, up, small, 0.6).lod(1));
    far.arm.push(add3(b, mul3(d, L)));
  }
  // primaries fan from the hand
  for (let i = 0; i < nP; i++) {
    const t = i / (nP - 1), b = add3(lerp3(W, T, t), [0, -0.012, -0.014]), d = norm3([0.25 + t * 1.25 + jit(), -0.03 - t * 0.05, -1 + t * 0.72]), L = 0.5 + 0.12 * Math.sin(t * Math.PI * 0.9) - t * 0.06;
    tip.hard.push(feather(b, d, L, 0.088 - t * 0.02, up, flight, 0.66, 4).near());
    tip.hard.push(feather(add3(b, [0, 0.01, 0.004]), d, L * 0.42, 0.08, up, covert, 0.7).near());
    if (i % 2 === 0) tip.hard.push(feather(add3(b, [0, 0.018, 0.01]), d, L * 0.24, 0.078, up, small, 0.6).lod(1));
    far.tip.push(add3(b, mul3(d, L)));
  }
  for (let i = 0; i < 3; i++) tip.hard.push(feather(add3(W, [0.01 + i * 0.02, 0.006, 0.02]), norm3([1, 0, -0.12 - i * 0.12]), 0.15 - i * 0.02, 0.05, up, small, 0.6).lod(1));   // alula
  // far stand-ins: one flat fan per node
  const fan = (edge, trail, cA, cB) => {
    const pos = [], idx = [], cols = [];
    const n = Math.max(edge.length, trail.length);
    for (let i = 0; i < n; i++) {
      const a = edge[Math.min(edge.length - 1, Math.round((i / (n - 1)) * (edge.length - 1)))], b = trail[Math.min(trail.length - 1, Math.round((i / (n - 1)) * (trail.length - 1)))];
      pos.push(a[0], a[1], a[2], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, b[0], b[1], b[2]); cols.push(cA, cB, rgb(C.umber));
    }
    for (let i = 0; i < n - 1; i++) { const a = i * 3, b = a + 3; idx.push(a, b, b + 1, a, b + 1, a + 1, a + 1, b + 1, b + 2, a + 1, b + 2, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setIndex(idx); g.computeVertexNormals();
    return H.geo(g).shade((x, y, z, nx, ny, nz, i) => cols[i]).pbr(0.85).far();
  };
  arm.hard.push(fan([Sh, lerp3(Sh, E, 0.5), E, lerp3(E, W, 0.33), lerp3(E, W, 0.66), W], far.arm, rgb(C.chestDark), rgb(C.bar)));
  tip.hard.push(fan([W, lerp3(W, T, 0.5), T], far.tip, rgb(C.chestDark), rgb(C.bar)));
  return { S: Sh, W, arm, tip };
}

function buildGriffon(def, o) {
  const C = griffonPalette(o.mount ?? 0xc8a050);
  const rnd = rng(hashStr((def?.id || 'griffon') + ':griffon'));
  const furC = (col, amp = 0.0085, f = 26) => (q) => q.color(col).tint(0.24, 14).bump(amp, f, 'fur').pbr(0.85);
  const fur = furC(C.fur);
  const vary = (col) => tone(col, 0, 0, (rnd() - 0.5) * 0.05);
  const plC = (col, amp = 0.006, f = 30) => (q) => q.color(col).tint(0.2, 26).bump(amp, f, 'scales').pbr(0.85);
  const plume = plC(C.chest), white = plC(C.white, 0.005, 36);
  const nodes = [];
  nodes.push(node('root', null, [0, 0, 0]));
  const BO = [0, 0.68, 0];
  const NB = [0, 0.83, 0.3], HJ = [0, 1.125, 0.47], headPitch = 16;

  // ---------------- torso ----------------
  const torso = node('torso', 'root', BO, { rig: 'body', detail: 0.67 }); nodes.push(torso);
  {
    const p = torso.prims;
    p.push(plume(lay(0.165, 0.19, 0.2).rot(-8, 0, 0).at(0, 0.7, 0.2)));                               // the eagle's deep breast
    p.push(plume(lay(0.1, 0.13, 0.11).at(0, 0.64, 0.36).blend(0.05)));                                 // keel
    p.push(fur(lay(0.15, 0.158, 0.2).at(0, 0.69, -0.1).blend(0.06)));                                  // the lion's loin
    p.push(fur(lay(0.166, 0.176, 0.16).rot(8, 0, 0).at(0, 0.668, -0.32).blend(0.05)));                 // pelvis
    p.push(plume(bone([0, 0.76, 0.26], [0, 0.88, 0.36], 0.14, 0.125).blend(0.06)));                    // root of the neck
    p.push(fur(bone([0, 0.69, -0.42], [0, 0.68, -0.49], 0.05, 0.036).blend(0.03)));                    // root of the tail
    p.push(...S.mirrorX([
      plume(S.ellipsoid(0.07, 0.08, 0.11).rot(0, 0, 20).at(0.1, 0.87, 0.19).blend(0.04)),              // the flight muscles under each wing
      fur(S.ellipsoid(0.086, 0.15, 0.15).rot(18, 0, -6).at(0.118, 0.665, -0.31).blend(0.04)),          // haunch
      fur(lay(0.045, 0.045, 0.18).at(0.055, 0.8, -0.14).blend(0.04)),                                  // back muscles
    ]));
    p.push(lay(0.11, 0.07, 0.34).at(0, 0.5, -0.12).color(C.furPale).pbr(0.85).tint(0.14, 22).paint(0.05));    // pale belly
    p.push(lay(0.09, 0.1, 0.1).at(0, 0.56, 0.37).color(C.cream).pbr(0.85).tint(0.14, 22).paint(0.05));        // pale bib
    p.push(lay(0.2, 0.2, 0.4).at(0, 0.98, -0.2).color(C.furDark).pbr(0.85).tint(0.2, 16).paint(0.12));         // darker along the spine
    const df = distanceField(p);
    // the lion half: a fringe under the belly and a darker flank
    p.push(...S.mirrorX([lay(0.03, 0.09, 0.16).at(0.15, 0.71, -0.2).color(C.furDark).pbr(0.85).tint(0.2, 16).paint(0.05)]));
    for (const sx of [1, -1]) for (let i = 0; i < 7; i++) {
      const L = 0.06 + rnd() * 0.025;
      clump(torso, df, [sx * 0.055, 0.2, -0.05 - i * 0.05], [0, 1, 0], [sx * 0.25, -0.6, -1], { L, W: L * 0.28, T: L * 0.15, lift: 0.4, colA: C.fur, colB: vary(C.furPale), lockOnly: true });
    }
    // breast feathers in rows, and the ragged hem where plumage gives way to fur
    const hd = torso.hard;
    for (let r = 0; r < 5; r++) for (let j = 0; j < 7; j++) {
      const a = ((j + (r % 2) * 0.5) / 7 - 0.46) * 2.3, y = 0.82 - r * 0.07;
      const from = [Math.sin(a) * 0.5, y, 0.22 + Math.cos(a) * 0.5], root = surfHit(df, from, [-Math.sin(a), 0, -Math.cos(a)]), n = gradAt(df, root);
      const L = 0.085 + rnd() * 0.02, cols = y < 0.62 && Math.abs(a) < 0.7 ? [C.cream, C.cream, C.white, 0xd8c8a4] : [C.chestDark, C.chest, 0xb5884c, 0x4a2e18];
      hd.push(feather(add3(root, mul3(n, 0.002)), norm3(add3([0, -1, -0.25], mul3(n, 0.22))), L, L * 0.62, n, cols, 0.66).lod(1));
    }
    for (let j = 0; j < 22; j++) {
      const a = (j / 22) * Math.PI * 2, d = [Math.sin(a), Math.cos(a), 0], z = 0.01 + 0.03 * Math.sin(j * 2.1);
      const root = surfHit(df, [d[0] * 0.5, 0.69 + d[1] * 0.5, z], mul3(d, -1)), n = gradAt(df, root), L = 0.1 + rnd() * 0.04;
      hd.push(feather(add3(root, mul3(n, 0.003)), norm3(add3([0, 0, -1], mul3(n, 0.2))), L, L * 0.55, n, [C.chestDark, C.chest, 0xb5884c, 0x4a2e18], 0.66).lod(1));
      if (j % 2 === 0) { const r2 = surfHit(df, [d[0] * 0.5, 0.69 + d[1] * 0.5, z + 0.07], mul3(d, -1)), n2 = gradAt(df, r2); hd.push(feather(add3(r2, mul3(n2, 0.003)), norm3(add3([0, 0, -1], mul3(n2, 0.2))), L, L * 0.55, n2, [C.umber, C.chestDark, C.chest, 0x3a2416], 0.66).lod(1)); }
    }
  }

  // ---------------- neck: thick with hackles ----------------
  const neck = node('neck', 'torso', NB, { rig: 'mneck', detail: 0.8 }); nodes.push(neck);
  {
    const p = neck.prims, ax = norm3(sub3(HJ, NB));
    p.push(white(bone(add3(NB, mul3(ax, -0.03)), HJ, 0.128, 0.09)));
    p.push(plume(S.sphere(0.125).at(NB[0], NB[1] - 0.02, NB[2] - 0.01).blend(0.04)));
    p.push(white(bone([0, 0.82, 0.39], [0, 1.06, 0.5], 0.085, 0.07).blend(0.04)));                              // crop
    const df = distanceField(p);
    for (let r = 0; r < 5; r++) {
      const f = 0.95 - r * 0.21, c = lerp3(NB, HJ, f), n = 9;
      for (let j = 0; j < n; j++) {
        const a = ((j + (r % 2) * 0.5) / n) * Math.PI * 2, out = norm3([Math.sin(a), Math.cos(a) * ax[2], -Math.cos(a) * ax[1]]);
        const root = surfHit(df, add3(c, mul3(out, 0.4)), mul3(out, -1)), nn = gradAt(df, root), L = 0.1 + rnd() * 0.03 + (r === 4 ? 0.03 : 0);
        const cols = r < 3 ? [C.cream, C.white, C.white, 0xd8cdb4] : r === 3 ? [C.cream, C.cream, C.chest, 0xd8c8a4] : [C.chest, C.chest, C.chestDark, 0x4a2e18];
        neck.hard.push(feather(add3(root, mul3(nn, 0.003)), norm3(add3(mul3(ax, -1), mul3(nn, 0.3 + rnd() * 0.15))), L, L * 0.5, nn, cols, 0.7, 2.4).lod(1));
      }
    }
  }

  // ---------------- head ----------------
  const hd = griffonHead(C, rnd);
  const head = node('head', 'neck', [0, 0, 0], { rig: 'mhead', pos: sub3(HJ, NB), rot: [headPitch, 0, 0], detail: 1.3 });
  head.prims = hd.p; head.hard = hd.hard; nodes.push(head);
  const jaw = node('jaw', 'head', hd.hinge, { rig: 'mjaw', pos: hd.hinge, rot: [3, 0, 0], detail: 1.3 });
  jaw.prims = hd.jp; jaw.hard = hd.jhard; nodes.push(jaw);

  // ---------------- front legs: an eagle's, feathered to the heel, scaled below ----------------
  const SH = [0.13, 0.66, 0.24], EL = [0.148, 0.42, 0.165], WR = [0.148, 0.075, 0.235];
  const scaly = (q) => q.color(C.scale).tint(0.14, 30).bump(0.004, 26, 'ridges').pbr(0.5);
  const fl = { up: { prims: [], hard: [] }, lo: { prims: [], hard: [] }, paw: { prims: [], hard: [] } };
  {
    const u = fl.up.prims, l = fl.lo.prims, w = fl.paw.prims;
    u.push(plume(bone([0.135, 0.67, 0.245], EL, 0.08, 0.052)));
    u.push(plume(S.ellipsoid(0.066, 0.12, 0.095).rot(-16, 0, -5).at(0.14, 0.57, 0.215).blend(0.03)));       // the drumstick
    u.push(plume(S.sphere(0.05).at(EL[0], EL[1], EL[2]).blend(0.02)));
    const dfu = distanceField(u);
    for (let r = 0; r < 3; r++) for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2 + r * 0.5, d = [Math.sin(a), 0, Math.cos(a)], y = 0.6 - r * 0.075;
      const root = surfHit(dfu, [0.14 + d[0] * 0.3, y, 0.2 + d[2] * 0.3], mul3(d, -1)), n = gradAt(dfu, root), L = 0.085 + rnd() * 0.025;
      fl.up.hard.push(feather(add3(root, mul3(n, 0.002)), norm3(add3([0, -1, -0.1], mul3(n, 0.25))), L, L * 0.55, n, [C.chestDark, C.chest, r === 2 ? C.cream : 0xb5884c, 0x4a2e18], 0.64).lod(1));
    }
    l.push(plume(S.sphere(0.046).at(EL[0], EL[1], EL[2])));
    l.push(scaly(bone(EL, WR, 0.038, 0.033).blend(0.02)));
    l.push(scaly(S.sphere(0.038).at(WR[0], WR[1], WR[2]).blend(0.012)));
    w.push(scaly(S.sphere(0.037).at(WR[0], WR[1], WR[2])));
    w.push(scaly(S.ellipsoid(0.042, 0.03, 0.045).at(WR[0], 0.045, WR[2] + 0.012).blend(0.02)));
    // three toes forward and a hallux behind, each ending in a hooked talon
    const toe = (ang, len, back) => {
      const dx = Math.sin(ang), dz = Math.cos(ang) * (back ? -1 : 1), b0 = [WR[0] + dx * 0.02, 0.04, WR[2] + 0.012 + dz * 0.025];
      const k1 = [b0[0] + dx * len * 0.5, 0.052, b0[2] + dz * len * 0.5], k2 = [b0[0] + dx * len, 0.03, b0[2] + dz * len];
      w.push(scaly(bone(b0, k1, 0.021, 0.019).blend(0.012)), scaly(bone(k1, k2, 0.019, 0.016).blend(0.01)), scaly(S.sphere(0.021).at(k1[0], k1[1] + 0.004, k1[2]).blend(0.006)));
      fl.paw.hard.push(spike([k2[0], 0.036, k2[2]], [dx, -0.25, dz], 0.075, 0.0145, C.talon, [0, -1, 0], 0.55).pbr(0.25).near());
    };
    toe(-0.5, 0.085); toe(0, 0.1); toe(0.5, 0.085); toe(0.15, 0.06, true);
  }
  // ---------------- hind legs: a lion's ----------------
  const HP = [0.115, 0.66, -0.33], ST = [0.152, 0.44, -0.225], HK = [0.142, 0.235, -0.405];
  const bl = { up: { prims: [], hard: [] }, lo: { prims: [], hard: [] }, paw: { prims: [], hard: [] } };
  {
    const u = bl.up.prims, l = bl.lo.prims, w = bl.paw.prims;
    u.push(fur(bone(HP, ST, 0.11, 0.076)));
    u.push(fur(S.ellipsoid(0.086, 0.16, 0.142).rot(26, 0, -5).at(0.135, 0.565, -0.295).blend(0.03)));
    u.push(fur(S.sphere(0.072).at(ST[0], ST[1], ST[2]).blend(0.02)));
    u.push(S.ellipsoid(0.03, 0.1, 0.08).rot(26, 0, 0).at(0.185, 0.56, -0.29).color(C.furPale).pbr(0.85).tint(0.2, 16).paint(0.05));    // sheen on the great muscle of the thigh
    const dfu = distanceField(u);
    for (let i = 0; i < 6; i++) {                                                                            // the coat lies in heavy overlapping locks over the quarter
      const L = 0.1 + rnd() * 0.025;
      clump(bl.up, dfu, [0.5, 0.7 - (i % 3) * 0.075, -0.24 - Math.floor(i / 3) * 0.085 - (i % 3) * 0.02], [-1, 0, 0], [0, -0.75, -1], { L, W: L * 0.27, T: L * 0.14, lift: 0.03, colA: C.furDark, colB: C.fur, style: furC(vary(C.furDark), 0.005, 50) });
    }
    for (let i = 0; i < 7; i++) {                                                                            // feathering down the back of the thigh
      const L = 0.07 + rnd() * 0.025;
      clump(bl.up, dfu, [0.125 + (i % 2 ? 0.022 : -0.014), 0.66 - i * 0.034, -0.8], [0, 0, 1], [0, -0.85, -0.5], { L, W: L * 0.3, T: L * 0.16, lift: 0.3, colA: C.furDark, colB: vary(C.fur), style: furC(vary(C.furDark), 0.004, 60), lock: i % 2 === 0 });
    }
    l.push(fur(S.sphere(0.07).at(ST[0], ST[1], ST[2])));
    l.push(fur(bone(ST, HK, 0.068, 0.041).blend(0.03)));
    l.push(fur(S.ellipsoid(0.042, 0.08, 0.056).rot(-40, 0, 0).at(ST[0], lerp(ST[1], HK[1], 0.3), lerp(ST[2], HK[2], 0.3) - 0.018).blend(0.02)));
    l.push(fur(S.sphere(0.043).at(HK[0], HK[1], HK[2]).blend(0.012)));
    l.push(fur(S.ellipsoid(0.025, 0.038, 0.03).at(HK[0], HK[1] + 0.014, HK[2] - 0.032).blend(0.01)));
    w.push(fur(S.sphere(0.043).at(HK[0], HK[1], HK[2])));
    w.push(fur(bone(HK, [0.142, 0.07, -0.37], 0.041, 0.045).blend(0.02)));
    w.push(furC(C.furPale)(S.ellipsoid(0.068, 0.044, 0.072).at(0.142, 0.044, -0.345).blend(0.02)));
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.28, dx = Math.sin(a), dz = Math.cos(a), t = [0.142 + dx * 0.03 + (i - 1.5) * 0.02, 0.028, -0.345 + dz * 0.06];
      w.push(furC(C.furPale)(S.ellipsoid(0.021, 0.025, 0.033).rot(0, a / DEG, 0).at(t[0], t[1], t[2]).blend(0.008)));
      bl.paw.hard.push(spike([t[0] + dx * 0.02, 0.03, t[2] + dz * 0.024], [dx * 0.8, -0.5, dz], 0.026, 0.009, C.talon, [0, -1, 0], 0.45).lod(1));
    }
  }
  for (const [nm, part, side, js, det] of [['FL', fl, 1, [SH, EL, WR], 1], ['FR', fl, -1, [SH, EL, WR], 1], ['BL', bl, 1, [HP, ST, HK], 1], ['BR', bl, -1, [HP, ST, HK], 1]]) {
    const cp = (list) => (side > 0 ? flat(list).map((q) => q.clone()) : mirrorAll(list));
    const m = (v) => (side > 0 ? v : mirX(v));
    const up = node(`leg${nm}`, 'torso', m(js[0]), { rig: 'legs', detail: 0.72 * det, minRes: 16 });
    const lo = node(`shin${nm}`, `leg${nm}`, m(js[1]), { rig: 'shins', detail: 0.78 * det, minRes: 20 });
    const pw = node(`paw${nm}`, `shin${nm}`, m(js[2]), { rig: 'paws', detail: 0.92 * det, minRes: 20 });
    up.prims = cp(part.up.prims); up.hard = cp(part.up.hard);
    lo.prims = cp(part.lo.prims); lo.hard = cp(part.lo.hard);
    pw.prims = cp(part.paw.prims); pw.hard = cp(part.paw.hard);
    nodes.push(up, lo, pw);
  }

  // ---------------- wings ----------------
  for (const side of [1, -1]) {
    const wg = griffonWing(C, rng(hashStr('griffon-wing')));
    const nm = side > 0 ? 'L' : 'R';
    const cp = (list) => (side > 0 ? flat(list) : mirrorAll(list));
    const w = node(`wing${nm}`, 'torso', side > 0 ? wg.S : mirX(wg.S), { rig: 'wings', detail: 0.64 });
    const tp = node(`wingtip${nm}`, `wing${nm}`, side > 0 ? wg.W : mirX(wg.W), { rig: 'wingtips', detail: 0.64, minRes: 18 });
    w.prims = cp(wg.arm.prims); w.hard = cp(wg.arm.hard); tp.prims = cp(wg.tip.prims); tp.hard = cp(wg.tip.hard);
    nodes.push(w, tp);
  }

  // ---------------- tail: a lion's, with a dark tuft ----------------
  const TL = [[0, 0.68, -0.475], [0, 0.6, -0.6], [0, 0.5, -0.72], [0, 0.465, -0.865], [0, 0.54, -0.975]];
  const tr = [0.043, 0.035, 0.029, 0.025, 0.023];
  for (let i = 0; i < 4; i++) {
    const n = node(`tail${i}`, i === 0 ? 'torso' : `tail${i - 1}`, TL[i], { rig: 'tail', detail: 0.9, minRes: 24 });
    nodes.push(n);
    const a = TL[i], b = TL[i + 1];
    n.prims.push(fur(S.sphere(tr[i]).at(a[0], a[1], a[2])), fur(bone(a, b, tr[i], tr[i + 1]).blend(0.01)));
    if (i === 3) {
      const t = norm3(sub3(b, a));
      n.prims.push(furC(C.tuft, 0.008, 40)(orient(S.ellipsoid(0.04, 0.075, 0.04), add3(b, mul3(t, 0.035)), t).blend(0.015)));
      for (let j = 0; j < 6; j++) { const ang = (j / 6) * Math.PI * 2, out = [Math.cos(ang), Math.sin(ang) * t[2], -Math.sin(ang) * t[1]]; n.hard.push(lock(add3(b, add3(mul3(t, 0.03), mul3(out, 0.02))), norm3(add3(t, mul3(out, 0.35))), 0.09 + rnd() * 0.03, 0.02, 0.014, C.tuft, C.umber, out, 0.2).lod(1)); }
    }
  }
  return { nodes, C, rnd, BO, NB, HJ, headPitch };
}

/** eagle head and lower beak in the head's frame: skull joint at the origin, beak along +Z */
function griffonHead(C, rnd) {
  const p = [], hard = [], jp = [], jhard = [];
  const white = (q) => q.color(C.white).tint(0.14, 30).bump(0.0045, 40, 'scales').pbr(0.85);
  const horn = (q, col = C.beak) => q.color(col).tint(0.12, 30).pbr(0.32);
  p.push(white(lay(0.078, 0.07, 0.09).at(0, 0.022, 0.04)));                                                   // skull
  p.push(white(S.sphere(0.085).at(0, 0.0, -0.02).blend(0.03)));
  p.push(white(lay(0.055, 0.045, 0.06).rot(14, 0, 0).at(0, 0.03, 0.1).blend(0.03)));                          // flat crown running into the beak
  p.push(...S.mirrorX([
    white(S.ellipsoid(0.034, 0.016, 0.05).rot(0, -14, -24).at(0.046, 0.058, 0.085).blend(0.012)),             // the scowling shelf of bone over each eye
    white(S.ellipsoid(0.03, 0.035, 0.05).at(0.055, -0.012, 0.05).blend(0.025)),                               // cheek
  ]));
  // upper beak: deep at the root, hooked at the tip
  p.push(horn(bone([0, 0.012, 0.105], [0, 0.006, 0.19], 0.04, 0.034).blend(0.012), C.cere));
  p.push(horn(bone([0, 0.006, 0.18], [0, -0.012, 0.255], 0.034, 0.022).blend(0.012)));
  p.push(horn(bone([0, -0.012, 0.25], [0, -0.05, 0.272], 0.024, 0.011).blend(0.01)));
  p.push(horn(bone([0, -0.05, 0.272], [0, -0.078, 0.262], 0.011, 0.003).blend(0.006), C.beakTip));
  p.push(S.ellipsoid(0.03, 0.03, 0.03).at(0, -0.06, 0.275).color(C.beakTip).pbr(0.3).paint(0.014));
  p.push(S.box(0.07, 0.04, 0.2, 0.01).at(0, -0.047, 0.15).cut(0.006).color(C.mouth));                         // the flat cutting edge underneath
  p.push(...S.mirrorX([
    S.ellipsoid(0.006, 0.005, 0.011).rot(0, 0, 0).at(0.027, 0.02, 0.155).cut(0.003).color(0x2a1a10),          // nostril
    S.ellipsoid(0.006, 0.006, 0.07).at(0.036, -0.022, 0.17).color(tone(C.beak, 0, 0, -0.14)).pbr(0.4).paint(0.003, -0.002),   // tomium line
  ]));
  // eyes
  const ex = 0.052, ey = 0.026, ez = 0.085, er = 0.0165;
  p.push(...S.mirrorX([
    S.ellipsoid(0.019, 0.015, 0.018).rot(0, 40, -10).at(ex + 0.004, ey, ez + 0.006).cut(0.005).color(0x1a100a),
    S.sphere(er * 0.94).at(ex, ey, ez).color(C.eye.iris).glow(C.eye.glow * 0.7).pbr(0.3).blend(0),
    S.ellipsoid(0.012, 0.007, 0.04).rot(0, 20, 0).at(0.05, 0.012, 0.12).color(0x2a1c12).pbr(0.8).paint(0.006),            // the dark stripe from eye to beak
  ]));
  hard.push(...H.mirrorX([eye(er, { ...C.eye, pupilSize: 0.95, irisSize: 1.4 }).rot(-4, 52, 0).at(ex, ey, ez).lod(1)]));
  // feathered ears and a crest of hackles
  for (const sx of [1, -1]) {
    p.push(white(bone([sx * 0.05, 0.065, 0.02], [sx * 0.085, 0.16, -0.06], 0.026, 0.006).blend(0.014)));
    for (let i = 0; i < 4; i++) hard.push(feather([sx * (0.052 + i * 0.004), 0.07 + i * 0.012, 0.02 - i * 0.012], norm3([sx * (0.32 + i * 0.05), 0.95, -0.55 - i * 0.12]), 0.12 - i * 0.012, 0.042, [sx, 0.2, 0.5], [C.cream, C.white, i < 2 ? C.umber : C.chest, 0xd8cdb4], 0.72, 2.2).lod(1));
  }
  for (let r = 0; r < 3; r++) for (let j = 0; j < 5; j++) {
    const x = (j - 2) * 0.026, L = 0.085 + rnd() * 0.02;
    hard.push(feather([x, 0.078 - Math.abs(x) * 0.35, 0.035 - r * 0.04], norm3([x * 2, 0.5 - r * 0.1, -1]), L, 0.04, [0, 1, 0.3], [C.cream, C.white, r === 2 ? C.chest : C.white, 0xd8cdb4], 0.74, 2.2).lod(1));
  }
  // lower beak
  const hinge = [0, -0.025, 0.045];
  jp.push(white(lay(0.045, 0.022, 0.05).at(0, -0.045, 0.06)));                                                // feathered chin
  jp.push(horn(bone([0, -0.045, 0.09], [0, -0.05, 0.215], 0.028, 0.012).blend(0.012)));
  jp.push(S.box(0.036, 0.02, 0.13, 0.005).at(0, -0.03, 0.16).cut(0.005).color(C.mouth));
  jp.push(S.ellipsoid(0.011, 0.006, 0.05).at(0, -0.039, 0.15).color(C.tongue).pbr(0.4).blend(0.003));
  return { p, hard, jp, jhard, hinge };
}

function griffonTack(gs, R, seatA, o, s) {
  const cloth = o.cloth ?? 0x2f5aa8, gold = 0xd8b23a;
  const torso = gs.nodes.find((n) => n.name === 'torso');
  const df = distanceField(torso.prims);
  const tack = node('tack', 'torso', gs.BO, { detail: 0.85 }); gs.nodes.push(tack);
  const p = tack.prims, h = tack.hard, z0 = seatA[2];
  const mk = (n, m, far) => drape(df, {
    z0: z0 + 0.15, z1: z0 - 0.17, yc: 0.685, hug: 92, vh: 0.66, off: 0.008, flare: 0.01, ripple: far ? 0 : 0.004, folds: 5,
    us: gridLines(n, far ? [] : [0.06, 0.935]), vs: gridLines(m, far ? [] : [0.88], true),
    drop: (u) => 0.075 - 0.03 * Math.abs(u - 0.5) * 2, dag: null,
    col: (u, a) => (a > 0.882 || u < 0.062 || u > 0.937 ? gold : cloth),
  });
  h.push(mk(18, 36, false).near(), mk(4, 8, true).far());
  const top = surfHit(df, [0, 1.4, z0], [0, -1, 0])[1];
  const lea = (q, col = LEATHER) => q.color(col).tint(0.12, 40).pbr(0.55);
  p.push(lea(lay(0.095, 0.036, 0.125).at(0, top + 0.012, z0)));
  p.push(lea(lay(0.07, 0.06, 0.028).rot(-16, 0, 0).at(0, top + 0.05, z0 + 0.12), LEATHER_DARK).blend(0.014));
  p.push(lea(lay(0.095, 0.065, 0.03).rot(16, 0, 0).at(0, top + 0.052, z0 - 0.12), LEATHER_DARK).blend(0.014));
  p.push(lay(0.062, 0.036, 0.08).at(0, top + 0.064, z0).cut(0.028).color(LEATHER_DARK));
  p.push(S.torus(0.158, 0.012).rot(90, 0, 0).at(0, 0.685, z0 + 0.03).color(LEATHER_DARK).pbr(0.6).blend(0.004));
  h.push(...rivets([[0.06, top + 0.07, z0 + 0.132], [0, top + 0.1, z0 + 0.134], [-0.06, top + 0.07, z0 + 0.132]], 5, 0.0055));
  for (const side of [1, -1]) {
    const ft = riderToMount(R, seatA, s, R.foot(side)), tp = [side * 0.15, top - 0.04, z0 + 0.04], e0 = [ft[0], ft[1] + 0.075, ft[2] - 0.004];
    p.push(...strap([tp, lerp3(tp, e0, 0.5), e0], 0.0075, LEATHER, { n: 4 }));
    h.push(ringAt([ft[0], ft[1] + 0.032, ft[2]], [0, 0.1, 1], 0.04, 0.007, IRON).near());
    h.push(H.box(0.076, 0.009, 0.04, 0.003).at(ft[0], ft[1] - 0.005, ft[2]).color(IRON).pbr(0.45, 1).near());
  }
  // a collar at the root of the neck with the rider's badge, and the reins that run from it
  const cc = [0, 0.82, 0.305], cn = norm3([0, 0.45, 0.89]);
  p.push(orient(S.torus(0.148, 0.014), cc, cn).color(cloth).pbr(0.75).blend(0.004));
  p.push(orient(S.torus(0.148, 0.0055).at(0, 0.011, 0), cc, cn).color(gold).pbr(0.35, 1).blend(0.002), orient(S.torus(0.148, 0.0055).at(0, -0.011, 0), cc, cn).color(gold).pbr(0.35, 1).blend(0.002));
  h.push(orient(H.cyl(0.034, 0.034, 0.008, 20), [0, 0.705, 0.375], [0, -0.35, 0.94]).color(gold).pbr(0.35, 1).near());
  h.push(orient(H.cyl(0.02, 0.02, 0.011, 16), [0, 0.705, 0.377], [0, -0.35, 0.94]).color(cloth).pbr(0.6).lod(1));
  for (const sg of [1, -1]) h.push(H.tube([[sg * 0.12, 0.9, 0.25], [sg * 0.09, 0.93, 0.12], [0.045 + sg * 0.012, top + 0.13, z0 + 0.17]], 0.005, 8, 5).color(cloth).pbr(0.8).near());
  return tack;
}

function griffonRider(def, o) {
  const s = 1.1;
  const R = makeRider(def, o, 1);
  const gs = buildGriffon(def, o);
  const torso = gs.nodes.find((n) => n.name === 'torso');
  const z0 = -0.1, top = surfHit(distanceField(torso.prims), [0, 1.4, z0], [0, -1, 0])[1];
  const seatA = [0, top + 0.085, z0];
  griffonTack(gs, R, seatA, o, s);
  const nodes = finish(gs.nodes, s);
  seatRider(nodes, R, 'torso', gs.BO, seatA, s);
  return { kind: 'beast.rider', attack: R.desc.attack, hold: R.desc.hold || 'none', gait: 'griffon', mount: 'griffon', feathered: true, nodes };
}

function rider(def, o = {}) {
  if (o.mountType === 'wolf') return wolfRider(def, o);
  if (o.mountType === 'griffon') return griffonRider(def, o);
  return lancer(def, o);
}

// =====================================================================================
//  GIANT SPIDER
// =====================================================================================

function spider(def, o = {}) {
  const base = o.fur ?? 0x2a2420;
  const rnd = rng(hashStr((def?.id || 'spider') + ':spider'));
  const C = {
    shell: tone(base, 0, 0.02, -0.02), shellDark: tone(base, 0, 0, -0.07), hairDark: tone(base, 0.01, 0.04, 0.03),
    rust: 0xb8542a, rustDark: 0x7a3418, flame: 0xe0601e, gold: 0xf0b63c, cream: 0xe8d8b0, belly: tone(base, 0.01, 0.03, 0.06),
    fang: 0x0e0b0a, venom: 0x9be03a, eye: 0xd81c14, eyeRim: 0x3a0806,
  };
  const chitin = (q, col = C.shell) => q.color(col).tint(0.14, 30).pbr(0.34);
  const hairy = (q, col = C.hairDark, amp = 0.0065, f = 50) => q.color(col).tint(0.22, 30).bump(amp, f, 'fur').pbr(0.85);
  const nodes = [];
  nodes.push(node('root', null, [0, 0, 0]));
  const CO = [0, 0.3, 0.1];

  // ---------------- cephalothorax ----------------
  const ceph = node('torso', 'root', CO, { rig: 'torso', detail: 1.15 }); nodes.push(ceph);
  {
    const p = ceph.prims;
    p.push(chitin(lay(0.156, 0.092, 0.186).at(0, 0.308, 0.115)));                                    // carapace
    p.push(chitin(lay(0.106, 0.082, 0.096).at(0, 0.34, 0.222).blend(0.04)));                         // the raised head
    p.push(chitin(lay(0.11, 0.05, 0.12).at(0, 0.255, 0.12).blend(0.03), C.shellDark));               // sternum
    p.push(chitin(S.sphere(0.05).at(0, 0.305, -0.055).blend(0.03), C.shellDark));                    // pedicel
    p.push(S.ellipsoid(0.012, 0.03, 0.045).at(0, 0.402, 0.07).cut(0.014).color(C.shellDark));        // fovea
    for (let i = 0; i < 4; i++) p.push(...S.mirrorX([S.ellipsoid(0.07, 0.03, 0.007).rot(0, 58 - i * 36, 0).rot(0, 0, -14).at(0.075, 0.383, 0.07 + [0.08, 0.03, -0.022, -0.066][i]).color(C.shellDark).pbr(0.4).paint(0.004, -0.004)]));  // furrows to each leg
    for (let i = 0; i < 4; i++) p.push(...S.mirrorX([S.ellipsoid(0.075, 0.04, 0.012).rot(0, 40 - i * 36, 0).rot(0, 0, -14).at(0.085, 0.375, 0.07 + [0.055, 0.004, -0.045, -0.085][i]).color(C.rustDark).pbr(0.7).tint(0.2, 40).paint(0.007)]));   // bands of rusty down between them
    p.push(lay(0.055, 0.03, 0.085).at(0, 0.412, 0.205).color(C.rustDark).pbr(0.6).tint(0.2, 40).paint(0.03));   // a rusty blaze on the head
    // a fringe of rusty hair round the rim of the carapace
    const df = distanceField(p);
    for (let j = 0; j < 26; j++) {
      const a = (j / 26) * Math.PI * 2, d = [Math.sin(a), 0, Math.cos(a)];
      const root = surfHit(df, [d[0] * 0.5, 0.3, 0.115 + d[2] * 0.5], mul3(d, -1)), L = 0.045 + rnd() * 0.02;
      ceph.hard.push(lock(add3(root, mul3(d, -0.006)), norm3([d[0], -0.35, d[2]]), L, 0.011, 0.008, C.rustDark, C.rust, [0, -1, 0], 0.3).lod(1));
    }
    // eight eyes: two great ones in front, a small one either side, four in a square on top
    const Hc = [0, 0.34, 0.222];
    for (const [dx, dy, dz, r] of [[0.3, 0.14, 1, 0.021], [0.68, 0.1, 0.74, 0.013], [0.32, 0.8, 0.62, 0.0115], [0.6, 0.78, 0.3, 0.0115]]) {
      const n = norm3([dx, dy, dz]), q = surfHit(df, add3(Hc, mul3(n, 0.4)), mul3(n, -1)), c = add3(q, mul3(n, -r * 0.35));
      p.push(...S.mirrorX([S.sphere(r * 0.95).at(c[0], c[1], c[2]).color(C.eye).glow(0.5).pbr(0.2).blend(0.002)]));
      ceph.hard.push(...H.mirrorX([orient(eye(r * 1.02, { iris: C.eye, rim: C.eyeRim, white: 0x1a0504, pupilSize: 1.3, irisSize: 1.6, glow: 0.6 }).rot(-90, 0, 0), add3(c, mul3(n, r * 0.25)), n).lod(1)]));
    }
  }

  // ---------------- chelicerae and fangs (the jaw) ----------------
  const JH = [0, 0.3, 0.27];
  const jaw = node('jaw', 'torso', JH, { rig: 'jaw', detail: 1.1 }); nodes.push(jaw);
  {
    const a = [0.043, 0.305, 0.268], b = [0.04, 0.2, 0.325];
    const one = [
      hairy(bone(a, b, 0.043, 0.035), C.rustDark, 0.007, 44),
      chitin(S.sphere(0.03).at(b[0], b[1] - 0.004, b[2]).blend(0.01), C.shellDark),
    ];
    jaw.prims.push(...one, ...mirrorAll(one));
    for (const sx of [1, -1]) {
      jaw.hard.push(spike([sx * 0.04, 0.19, 0.325], [-sx * 0.25, -1, 0.1], 0.1, 0.017, C.fang, [-sx, 0, -0.3], 0.5).shade((x, y) => (y > 0.82 ? C.venom : null)).pbr(0.18).near());
      jaw.hard.push(H.sphere(0.0075, 8).scale(1, 1.4, 1).at(-sx * 0.031, 0.094, 0.321).color(C.venom).glow(0.9).pbr(0.2).lod(1));  // a bead of venom
      for (let i = 0; i < 7; i++) jaw.hard.push(lock([sx * (0.043 + Math.cos(i * 1.7) * 0.03), 0.29 - i * 0.012, 0.3 + Math.abs(Math.sin(i * 1.7)) * 0.02 + i * 0.004], [sx * Math.cos(i * 1.7) * 0.5, -0.8, 0.5], 0.05 + rnd() * 0.02, 0.01, 0.007, C.rustDark, C.rust, [0, 0, 1], 0.3).lod(1));
    }
  }
  // ---------------- pedipalps ----------------
  for (const sx of [1, -1]) {
    const A = [sx * 0.09, 0.3, 0.24], B = [sx * 0.12, 0.31, 0.36], Cc = [sx * 0.105, 0.2, 0.43], Dd = [sx * 0.095, 0.09, 0.44];
    const n = node(`palp${sx > 0 ? 'L' : 'R'}`, 'torso', A, { rig: 'palps', detail: 0.95 }); nodes.push(n);
    n.prims.push(hairy(bone(A, B, 0.03, 0.026)), chitin(S.sphere(0.027).at(B[0], B[1], B[2]).blend(0.008), C.rustDark), hairy(bone(B, Cc, 0.025, 0.021).blend(0.008)), chitin(S.sphere(0.022).at(Cc[0], Cc[1], Cc[2]).blend(0.006), C.rustDark), hairy(bone(Cc, Dd, 0.021, 0.012).blend(0.006), C.rustDark));
    n.hard.push(H.tube([A, B, Cc, Dd], [0.018, 0.016, 0.013, 0.007], 6, 4).color(C.hairDark).pbr(0.8).far());
  }

  // ---------------- abdomen ----------------
  const AO = [0, 0.31, -0.07];
  const abd = node('abdomen', 'torso', AO, { rig: 'abdomen', detail: 0.9 }); nodes.push(abd);
  {
    const p = abd.prims, c = [0, 0.39, -0.3];
    p.push(hairy(lay(0.205, 0.19, 0.25).rot(-8, 0, 0).at(c[0], c[1], c[2]), C.hairDark, 0.007, 40));
    p.push(hairy(lay(0.12, 0.12, 0.14).at(0, 0.34, -0.12).blend(0.05), C.hairDark, 0.006, 44));
    p.push(hairy(lay(0.11, 0.1, 0.1).at(0, 0.33, -0.5).blend(0.06), C.hairDark, 0.006, 44));                // the tapering tip
    p.push(lay(0.16, 0.08, 0.2).at(0, 0.24, -0.3).color(C.belly).pbr(0.85).tint(0.2, 30).paint(0.04));
    // the marking: a spine of flame down the back with barbs sweeping out and back, and a row of pale spots along each side
    const top = (z) => 0.39 + 0.19 * Math.sqrt(Math.max(0, 1 - Math.pow((z + 0.3) / 0.25, 2))) * 0.99;
    p.push(lay(0.022, 0.06, 0.2).at(0, 0.56, -0.29).color(C.flame).pbr(0.8).tint(0.14, 40).paint(0.008));
    for (let i = 0; i < 5; i++) {
      const z = -0.13 - i * 0.075, y = top(z), w = 0.085 - i * 0.008;
      p.push(...S.mirrorX([S.ellipsoid(w, 0.05, 0.017).rot(0, 34, -20 - i * 3).at(w * 0.72, y - 0.018 - i * 0.004, z - 0.03).color(i % 2 ? C.gold : C.flame).pbr(0.8).tint(0.12, 40).paint(0.006)]));
      p.push(S.ellipsoid(0.02, 0.04, 0.014).at(0, y, z + 0.012).color(C.cream).pbr(0.8).paint(0.005));
    }
    for (let i = 0; i < 5; i++) {
      const z = -0.12 - i * 0.085, r = 0.205 * Math.sqrt(Math.max(0, 1 - Math.pow((z + 0.3) / 0.25, 2)));
      p.push(...S.mirrorX([S.sphere(0.02 - i * 0.002).at(r * 0.97, 0.4, z).color(C.cream).pbr(0.8).paint(0.006)]));
    }
    // spinnerets
    p.push(...S.mirrorX([chitin(S.cone(0.018, 0.006, 0.05, 0.004).rot(-115, 0, 0).at(0.022, 0.3, -0.585), C.rustDark).blend(0.008)]));
    // long bristles standing out of the velvet
    const df = distanceField(p);
    for (let j = 0; j < 46; j++) {
      const u = (j * 0.618) % 1, v = (j * 0.371 + 0.13) % 1, th = u * Math.PI * 2, ph = 0.25 + v * 1.9;
      const d = [Math.sin(ph) * Math.sin(th), Math.cos(ph) * 0.9 + 0.1, Math.sin(ph) * Math.cos(th)];
      if (d[1] < -0.3 || (d[1] > 0.8 && Math.abs(d[0]) < 0.3)) continue;
      const root = surfHit(df, add3(c, mul3(d, 0.6)), mul3(d, -1)), n = gradAt(df, root), L = 0.05 + rnd() * 0.035;
      abd.hard.push(lock(add3(root, mul3(n, -0.006)), norm3(add3(n, [0, -0.1, -0.7])), L, 0.008, 0.006, C.hairDark, j % 4 === 0 ? C.rust : tone(C.hairDark, 0, 0, 0.1), [0, -1, 0], 0.3).lod(j % 2 ? 0 : 1));
    }
  }

  // ---------------- legs ----------------
  // order: L1 R1 R2 L2 L3 R3 R4 L4, so alternate entries form the two tripod-and-one gait groups
  const LEG = [
    { az: 58, z: 0.215, k: 1.0 }, { az: 24, z: 0.15, k: 0.9 }, { az: -14, z: 0.085, k: 0.87 }, { az: -50, z: 0.02, k: 0.98 },
  ];
  const order = [[0, 1], [0, -1], [1, -1], [1, 1], [2, 1], [2, -1], [3, -1], [3, 1]];
  for (const [li, side] of order) {
    const g = LEG[li], k = g.k;
    // authored for the left side in the leg's own frame: it reaches out along +X in the XY plane
    const K = [0.27 * k, 0.29 * k, 0], Jn = [0.52 * k, 0.1 + 0.02 * k, 0], Mt = [0.64 * k, -0.14, 0], F = [0.7 * k, -0.285, 0];
    const band = (q, at, r) => S.torus(r, r * 0.5).rot(0, 0, 90).at(at[0], at[1], at[2]).color(C.rust).pbr(0.85).tint(0.2, 40).paint(0.008, 0.002);
    const up = [
      chitin(S.sphere(0.052), C.shellDark),                                                               // coxa
      hairy(bone([0.02, 0.0, 0], [0.085, 0.045, 0], 0.046, 0.043).blend(0.012)),                          // trochanter
      hairy(bone([0.085, 0.045, 0], K, 0.046, 0.037).blend(0.012)),                                       // femur
      hairy(S.ellipsoid(0.1 * k, 0.036, 0.042).rot(0, 0, 48).at(lerp(0.085, K[0], 0.45), lerp(0.045, K[1], 0.45) + 0.012, 0).blend(0.02)),   // its swell of muscle
      chitin(S.sphere(0.043).at(K[0], K[1], K[2]).blend(0.008), C.rustDark),                              // knee
      band(null, lerp3([0.085, 0.045, 0], K, 0.86), 0.039),
    ];
    const KL = sub3(Jn, K), ML = sub3(Mt, K), FL = sub3(F, K);
    const lo = [
      chitin(S.sphere(0.041), C.rustDark),
      hairy(bone([0, 0, 0], KL, 0.038, 0.031).blend(0.01)),                                               // tibia
      chitin(S.sphere(0.033).at(KL[0], KL[1], 0).blend(0.006), C.rustDark),
      hairy(bone(KL, ML, 0.03, 0.022).blend(0.008)),                                                      // metatarsus
      hairy(bone(ML, FL, 0.022, 0.009).blend(0.006), C.shellDark),                                        // tarsus
      band(null, lerp3([0, 0, 0], KL, 0.85), 0.032), band(null, lerp3(KL, ML, 0.86), 0.024),
    ];
    const upH = [H.tube([[0, 0, 0], [0.085, 0.045, 0], K], [0.03, 0.03, 0.026], 4, 4).color(C.hairDark).pbr(0.8).far()];
    const loH = [
      H.tube([[0, 0, 0], KL, ML, FL], [0.026, 0.02, 0.014, 0.006], 6, 4).color(C.hairDark).pbr(0.8).far(),
      spike(add3(FL, [0, 0.012, 0]), [0.3, -1, 0], 0.03, 0.007, C.fang, [1, 0, 0], 0.4).lod(1),
    ];
    for (let j = 0; j < 5; j++) {                                                                          // bristles
      const t = 0.15 + j * 0.17, q = lerp3([0.085, 0.045, 0], K, t), q2 = j < 3 ? lerp3([0, 0, 0], KL, 0.2 + j * 0.3) : lerp3(KL, ML, 0.3 + (j - 3) * 0.4);
      upH.push(lock(add3(q, [0, 0.02, (j % 2 ? 1 : -1) * 0.018]), norm3([0.5, 0.7, (j % 2 ? 1 : -1) * 0.6]), 0.045 + rnd() * 0.02, 0.008, 0.006, C.hairDark, C.rust, [1, 0, 0], 0.3).lod(j % 2));
      loH.push(lock(add3(q2, [0.012, 0.012, (j % 2 ? 1 : -1) * 0.014]), norm3([0.7, 0.3, (j % 2 ? 1 : -1) * 0.7]), 0.04 + rnd() * 0.02, 0.007, 0.005, C.hairDark, C.rust, [0, -1, 0], 0.3).lod(j % 2));
    }
    const nm = `${side > 0 ? 'L' : 'R'}${li + 1}`;
    const cp = (list) => (side > 0 ? flat(list) : mirrorAll(list));
    const A0 = [side * 0.116, 0.285, g.z];
    const un = node(`leg${nm}`, 'torso', [0, 0, 0], { rig: 'legs', pos: sub3(A0, CO), rot: [0, -side * g.az, 0], detail: 0.8, minRes: 13 });
    const ln = node(`shin${nm}`, `leg${nm}`, [0, 0, 0], { rig: 'shins', pos: [side * K[0], K[1], 0], detail: 0.8, minRes: 13 });
    un.prims = cp(up); un.hard = cp(upH); ln.prims = cp(lo); ln.hard = cp(loH);
    nodes.push(un, ln);
  }
  return { kind: 'beast.spider', attack: 'bite', nodes: finish(nodes) };
}

function spiderAnim(rig, inner, c, base) {
  const { R, keys } = base;
  const s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk;
  const L = rig.legs || [], Sn = rig.shins || [], P = rig.palps || [], abd = rig.abdomen?.[0];
  const k = c.moving ? 1 : 0, g = t * 13 + ph, idle = Math.sin(t * 1.7 + ph), idle2 = Math.sin(t * 0.8 + ph * 1.3);
  let rear = 0, strike = 0, pitch = 0, py = Math.sin(t * 2.4 + ph) * 0.008 + k * Math.sin(g * 2) * 0.008, pz = 0, jw = idle * 0.04;
  if (a >= 0) {
    rear = keys(a, [[0, 0], [0.32, 1], [0.46, 0.85], [0.58, 0], [1, 0]]);
    strike = keys(a, [[0, 0], [0.42, 0], [0.56, 1], [0.76, 0.7], [1, 0]]);
    pitch = -0.38 * rear + 0.16 * strike;
    py += 0.05 * rear - 0.03 * strike; pz = -0.05 * rear + 0.2 * strike;
    jw = -0.55 * rear + 0.5 * strike;
  }
  const deadF = c.dead > 0 ? Math.min(1, c.dead * 2) : 0;
  L.forEach((l, i) => {
    const sg = sideOf(l, i), pair = Math.floor((i + (i % 4 > 1 ? 0 : 0)) / 2), ap = g + (i % 2) * Math.PI + pair * 0.5;
    let sweep = k * Math.sin(ap) * 0.26, lift = k * Math.max(0, Math.cos(ap)) * 0.3, curl = k * Math.max(0, Math.cos(ap)) * 0.34;
    if (!k && a < 0 && i === 0) { const tap = Math.max(0, Math.sin(t * 2.3 + ph)); lift += tap * tap * 0.12; curl += tap * 0.1; }     // a restless foreleg
    if (a >= 0) {
      const front = i < 2 ? 1 : i < 4 ? 0.55 : 0;
      lift += rear * front * 0.95 - strike * front * 0.35; curl += -rear * front * 0.5 + strike * front * 0.5; sweep += (rear - strike) * front * -0.25;
      if (i >= 4) { lift -= rear * 0.12; curl -= rear * 0.1; }
    }
    if (deadF) { lift = lerp(lift, -0.55, deadF) + deadF * 0.9; curl = lerp(curl, 1.25, deadF); sweep *= 1 - deadF; }
    R(l, 0, -sg * sweep, sg * lift);
    R(Sn[i], 0, 0, -sg * curl);
  });
  R(rig.jaw, jw);
  P.forEach((q, i) => R(q, Math.sin(t * 3.1 + ph + i * 1.9) * 0.1 - rear * 0.5 + strike * 0.3, 0, 0));
  R(abd, Math.sin(t * 2.4 + ph + 1) * 0.03 + k * Math.sin(g * 2 + 1) * 0.03 + rear * 0.25 - strike * 0.12 + deadF * 0.2, k * Math.sin(g) * 0.04 + idle2 * 0.02, 0);
  inner.position.z = pz * s;
  if (deadF) {
    // on its back with the legs drawn in
    inner.rotation.z = deadF * Math.PI; inner.rotation.x = 0;
    inner.position.y = (0.56 * Math.sin(deadF * Math.PI / 2) + 0.1 * Math.sin(deadF * Math.PI) - Math.max(0, c.dead - 0.5) * 0.8) * s;
    return;
  }
  inner.rotation.z = 0; inner.rotation.x = pitch;
  inner.position.y = py * s;
}

// =====================================================================================
//  VAMPIRE BAT
// =====================================================================================

/**
 * A skin stretched between two bones. A(u), B(u) with u in 0..1 give points along each; the sheet runs from A (v = 0)
 * to B (v = 1). Its far edge (u = 1) is scalloped between the two and the middle billows along `up`.
 */
function membrane(A, B, opt = {}) {
  const nu = opt.nu ?? 10, nv = opt.nv ?? 8, sc = opt.scallop ?? 0.2, bil = opt.billow ?? 0.03, up = opt.up ?? [0, 1, 0];
  const pos = [], idx = [], cols = [];
  const surf = (u0, v) => {
    const arch = Math.pow(4 * v * (1 - v), opt.archPow ?? 0.8);
    const u = u0 * (1 - sc * arch);
    const a = A(u), b = B(u);
    const lift = bil * arch * Math.sin(Math.PI * (0.12 + 0.8 * u0));
    return [lerp(a[0], b[0], v) + up[0] * lift, lerp(a[1], b[1], v) + up[1] * lift, lerp(a[2], b[2], v) + up[2] * lift];
  };
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const v = j / nv, u0 = i / nu, q = surf(u0, v);
    pos.push(q[0], q[1], q[2]);
    cols.push(opt.col ? opt.col(u0, v, q) : [0.5, 0.5, 0.5]);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, d, a, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  const h = H.geo(g).pbr(opt.rough ?? 0.6, 0).shade((x, y, z, nx, ny, nz, i) => cols[i]);
  h.surf = surf;
  return h;
}
/** straight line a -> b as a curve function, optionally bowed by `bow` (a vector added at the middle) */
const lineFn = (a, b, bow) => (u) => { const q = lerp3(a, b, u); if (bow) { const k = 4 * u * (1 - u); q[0] += bow[0] * k; q[1] += bow[1] * k; q[2] += bow[2] * k; } return q; };

function bat(def, o = {}) {
  const base = o.fur ?? 0x2a1f24;
  const rnd = rng(hashStr((def?.id || 'bat') + ':bat'));
  const C = {
    fur: tone(base, 0, 0.03, 0.02), back: tone(base, 0, 0, -0.04), ruff: mix(tone(base, 0.01, 0.2, 0.14), 0x7a3226, 0.45), ruffTip: 0xa8563a,
    belly: mix(tone(base, 0, -0.02, 0.16), 0x8a7a78, 0.4), skin: 0x8a6068, skinDark: 0x5a3a44, ear: 0xb07880,
    webA: 0x2c1b26, webB: 0x7a3440, webC: 0x4a2430, bone: 0x6e4a54, claw: 0x15100f, tooth: 0xf4ecd8, mouth: 0x6a1420, tongue: 0xd8606a,
    eye: { iris: 0xff2a1a, rim: 0x7a0a06, white: 0x1a0606, glow: 0.9 },
  };
  const furC = (col, amp = 0.0085, f = 42) => (q) => q.color(col).tint(0.2, 26).bump(amp, f, 'fur').pbr(0.92);
  const fur = furC(C.fur);
  const skin = (q, col = C.skin) => q.color(col).tint(0.14, 30).pbr(0.6);
  const vary = (col) => tone(col, 0, 0, (rnd() - 0.5) * 0.06);
  const nodes = [];
  nodes.push(node('root', null, [0, 0, 0]));
  const BO = [0, 0.43, 0];

  // ---------------- body ----------------
  const torso = node('torso', 'root', BO, { rig: 'torso', detail: 1.1 }); nodes.push(torso);
  {
    const p = torso.prims;
    p.push(fur(lay(0.112, 0.105, 0.135).at(0, 0.44, 0.06)));                                            // chest
    p.push(fur(lay(0.09, 0.085, 0.115).at(0, 0.415, -0.1).blend(0.05)));                                // belly
    p.push(fur(lay(0.062, 0.058, 0.06).at(0, 0.4, -0.2).blend(0.04)));                                  // rump
    p.push(fur(S.sphere(0.092).at(0, 0.468, 0.16).blend(0.04)));                                        // neck
    p.push(...S.mirrorX([fur(S.ellipsoid(0.06, 0.055, 0.075).rot(0, 0, 18).at(0.08, 0.485, 0.09).blend(0.03))]));     // the great flight muscles
    p.push(lay(0.07, 0.05, 0.16).at(0, 0.345, -0.02).color(C.belly).pbr(0.92).tint(0.16, 26).paint(0.04));
    p.push(lay(0.08, 0.05, 0.2).at(0, 0.555, -0.03).color(C.back).pbr(0.92).tint(0.16, 26).paint(0.04));
    const df = distanceField(p);
    // a rusty ruff round the neck, and the rest of the coat in layered clumps
    for (let r = 0; r < 3; r++) {
      const n = 9 + r, z = 0.2 - r * 0.045;
      for (let j = 0; j < n; j++) {
        const a = ((j + (r % 2) * 0.5) / n) * Math.PI * 2, d = [Math.sin(a), Math.cos(a), 0], L = 0.075 + rnd() * 0.025;
        clump(torso, df, [d[0] * 0.5, 0.46 + d[1] * 0.5, z], mul3(d, -1), [d[0] * 0.25, d[1] * 0.25 - 0.1, -1],
          { L, W: L * 0.3, T: L * 0.17, lift: 0.3 + rnd() * 0.15, colA: C.ruff, colB: vary(C.ruffTip), style: furC(vary(C.ruff), 0.004, 60), lock: (j + r) % 2 === 0 });
      }
    }
    for (let r = 0; r < 3; r++) for (let j = 0; j < 7; j++) {
      const a = ((j + (r % 2) * 0.5) / 7) * Math.PI * 2, d = [Math.sin(a), Math.cos(a), 0], L = 0.07 + rnd() * 0.02, z = 0.02 - r * 0.08;
      clump(torso, df, [d[0] * 0.5, 0.43 + d[1] * 0.5, z], mul3(d, -1), [0, -0.12, -1],
        { L, W: L * 0.3, T: L * 0.17, lift: 0.22 + rnd() * 0.12, colA: d[1] < -0.3 ? C.belly : C.back, colB: vary(d[1] < -0.3 ? C.belly : C.fur), style: furC(vary(d[1] < -0.3 ? C.belly : C.fur), 0.004, 60), lock: r === 2 && j % 2 === 0 });
    }
    for (let j = 0; j < 5; j++) torso.hard.push(lock([(j - 2) * 0.014, 0.405, -0.245], [(j - 2) * 0.18, -0.25, -1], 0.07 + rnd() * 0.02, 0.014, 0.01, C.back, C.fur, [0, -1, 0], 0.2).lod(1));   // a stub of a tail
  }

  // ---------------- head and jaw ----------------
  const HJ = [0, 0.485, 0.2];
  const hd = batHead(C, rnd);
  const head = node('head', 'torso', [0, 0, 0], { rig: 'head', pos: sub3(HJ, BO), rot: [-12, 0, 0], detail: 1.6 });
  head.prims = hd.p; head.hard = hd.hard; nodes.push(head);
  const jaw = node('jaw', 'head', hd.hinge, { rig: 'jaw', pos: hd.hinge, rot: [14, 0, 0], detail: 1.6 });
  jaw.prims = hd.jp; jaw.hard = hd.jhard; nodes.push(jaw);

  // ---------------- wings ----------------
  const SH = [0.1, 0.5, 0.1], EL = [0.3, 0.535, 0.02], WR = [0.57, 0.6, 0.16];
  const D5 = [0.6, 0.47, -0.4];                                                       // the fifth finger runs straight back: the hand hinges about it
  const F2 = [0.83, 0.575, 0.1], F3 = [1.02, 0.5, -0.03], F4 = [0.85, 0.44, -0.33];
  const ANK = [0.105, 0.4, -0.3], PIT = [0.105, 0.455, 0.03];
  const cA = rgb(C.webA), cB = rgb(C.webB), cC = rgb(C.webC), cV = rgb(C.bone);
  const webCol = (seed) => (u, v) => {
    const mid = Math.pow(4 * v * (1 - v), 0.7), n = noise3(u * 5 + seed * 3.1, v * 4 + seed, 0.4);
    let c3 = mixRgb(cA, cB, clamp(mid * (0.25 + 0.8 * smooth(u * 1.3)) + (n - 0.5) * 0.3));          // thin skin glows wine-red between the bones
    if (u > 0.86) c3 = mixRgb(c3, cA, (u - 0.86) / 0.14);                                             // darker, thicker rim
    if (Math.abs(((u * 4 + v * 2.5 + seed) % 1) - 0.5) < 0.035 && mid > 0.25) c3 = mixRgb(c3, cV, 0.45);   // veins
    return c3;
  };
  const fingerTube = (pts, r0, lodN) => {
    const c = curve(pts, 10), rr = c.map((_, i) => r0 * (1 - 0.72 * (i / 10)));
    return [H.tube(c, rr, 14, 6).color(C.bone).pbr(0.5).lod(lodN), H.tube([pts[0], pts[pts.length - 1]], [r0 * 0.8, r0 * 0.3], 2, 3).color(C.bone).pbr(0.5).far()];
  };
  const arm = { prims: [], hard: [] }, skinN = { prims: [], hard: [] }, tip = { prims: [], hard: [] };
  {
    arm.prims.push(fur(S.sphere(0.058).at(SH[0], SH[1], SH[2])), fur(bone(SH, lerp3(SH, EL, 0.55), 0.05, 0.03).blend(0.02)));
    arm.prims.push(skin(bone(lerp3(SH, EL, 0.4), EL, 0.03, 0.024).blend(0.02)), skin(S.sphere(0.03).at(EL[0], EL[1], EL[2]).blend(0.01)));
    arm.prims.push(skin(bone(EL, WR, 0.025, 0.02).blend(0.01)), skin(S.ellipsoid(0.03, 0.022, 0.035).rot(0, -28, 12).at(...lerp3(EL, WR, 0.25)).blend(0.014)), skin(S.sphere(0.027).at(WR[0], WR[1], WR[2]).blend(0.008), C.skinDark));
    arm.hard.push(H.tube([SH, EL, WR], [0.03, 0.02, 0.018], 4, 4).color(C.bone).pbr(0.6).far());
    // thumb: a hooked claw on the wrist, the bat's crampon when it crawls
    arm.prims.push(skin(bone(WR, add3(WR, [0.02, -0.005, 0.05]), 0.016, 0.011).blend(0.006), C.skinDark));
    arm.hard.push(spike(add3(WR, [0.02, -0.005, 0.05]), [0.25, -0.5, 0.85], 0.07, 0.012, C.claw, [0, -1, 0], 0.5).pbr(0.25).near());
    // fifth finger: the strut the hand folds about
    arm.hard.push(...fingerTube([WR, lerp3(WR, D5, 0.5), D5], 0.014, 2));
    // membrane from the arm back to the flank and the ankle
    const m = membrane(lineFn(WR, D5), lineFn(PIT, ANK, [0, 0.0, 0]), { nu: 12, nv: 12, scallop: 0.3, billow: 0.03, col: webCol(3), archPow: 0.9 });
    skinN.hard.push(m.near(), membrane(lineFn(WR, D5), lineFn(PIT, ANK), { nu: 3, nv: 3, scallop: 0.3, billow: 0.02, col: () => mixRgb(cA, cB, 0.4) }).far());
    skinN.hard.push(membrane(lineFn(SH, WR), lineFn(SH, lerp3(SH, WR, 0.999), [0, 0.012, 0.085]), { nu: 8, nv: 3, scallop: 0, billow: 0, col: () => cC }).near());   // leading skin ahead of the elbow
    // the hand: three long fingers and the skin between them
    tip.prims.push(skin(S.sphere(0.024).at(WR[0], WR[1], WR[2]), C.skinDark));
    const f2 = lineFn(WR, F2, [0, 0.008, 0.02]), f3 = lineFn(WR, F3, [0.01, 0.035, 0.04]), f4 = lineFn(WR, F4, [0.035, 0.03, 0.01]), f5 = lineFn(WR, D5);
    for (const [f, r] of [[f2, 0.011], [f3, 0.0145], [f4, 0.013]]) {
      tip.hard.push(...fingerTube([0, 0.25, 0.5, 0.75, 1].map(f), r, 2));
      tip.hard.push(H.sphere(r * 1.15, 8).at(...f(0.5)).color(C.bone).pbr(0.5).lod(1));
    }
    tip.hard.push(spike(F3, norm3(sub3(F3, f3(0.9))), 0.03, 0.006, C.claw, [0, -1, 0], 0.3).lod(1));
    const mk = (a, b, seed, nv2, sc) => [membrane(a, b, { nu: 12, nv: nv2, scallop: sc, billow: 0.028, col: webCol(seed) }).near(), membrane(a, b, { nu: 3, nv: 2, scallop: sc, billow: 0.02, col: () => mixRgb(cA, cB, 0.4) }).far()];
    tip.hard.push(...mk(f2, f3, 0, 5, 0.12), ...mk(f3, f4, 1, 9, 0.22), ...mk(f4, f5, 2, 9, 0.24));
  }
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const cp = (list) => (side > 0 ? flat(list).map((q) => q.clone()) : mirrorAll(list));
    const m = (v) => (side > 0 ? v : mirX(v));
    const w = node(`wing${nm}`, 'torso', m(SH), { rig: 'wings', detail: 1.0, minRes: 20 });
    const sk = node(`wingskin${nm}`, `wing${nm}`, m(SH), { rig: 'wingskins' });
    const tp = node(`wingtip${nm}`, `wing${nm}`, m(WR), { rig: 'wingtips', detail: 1.0, minRes: 20 });
    w.prims = cp(arm.prims); w.hard = cp(arm.hard); sk.hard = cp(skinN.hard); tp.prims = cp(tip.prims); tp.hard = cp(tip.hard);
    nodes.push(w, sk, tp);
  }

  // ---------------- legs: short, with long hooked toes ----------------
  const HP = [0.062, 0.395, -0.17], KN = [0.105, 0.385, -0.255], AK = [0.105, 0.4, -0.35];
  const lg = { up: { prims: [], hard: [] }, lo: { prims: [], hard: [] } };
  {
    lg.up.prims.push(fur(S.sphere(0.04).at(HP[0], HP[1], HP[2])), fur(bone(HP, KN, 0.038, 0.025).blend(0.02)), skin(S.sphere(0.024).at(KN[0], KN[1], KN[2]).blend(0.01)));
    lg.up.hard.push(H.tube([HP, KN], [0.022, 0.016], 2, 4).color(C.fur).pbr(0.9).far());
    lg.lo.prims.push(skin(S.sphere(0.023).at(KN[0], KN[1], KN[2])), skin(bone(KN, AK, 0.021, 0.016).blend(0.01)), skin(S.ellipsoid(0.022, 0.014, 0.024).at(AK[0], AK[1] - 0.004, AK[2] - 0.012).blend(0.01), C.skinDark));
    lg.lo.hard.push(H.tube([KN, AK], [0.014, 0.011], 2, 4).color(C.skin).pbr(0.7).far());
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.3, b0 = [AK[0] + Math.sin(a) * 0.012, AK[1] - 0.006, AK[2] - 0.022], t1 = [AK[0] + Math.sin(a) * 0.03, AK[1] - 0.014, AK[2] - 0.062];
      lg.lo.hard.push(H.tube([b0, t1], [0.006, 0.0045], 2, 5).color(C.skinDark).pbr(0.6).lod(1));
      lg.lo.hard.push(spike(t1, [Math.sin(a) * 0.4, -0.55, -1], 0.03, 0.005, C.claw, [0, -1, 0], 0.55).pbr(0.25).lod(1));
    }
  }
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const cp = (list) => (side > 0 ? flat(list).map((q) => q.clone()) : mirrorAll(list));
    const m = (v) => (side > 0 ? v : mirX(v));
    const up = node(`leg${nm}`, 'torso', m(HP), { rig: 'legs', detail: 1.1, minRes: 22 });
    const lo = node(`shin${nm}`, `leg${nm}`, m(KN), { rig: 'shins', detail: 1.3, minRes: 22 });
    up.prims = cp(lg.up.prims); up.hard = cp(lg.up.hard); lo.prims = cp(lg.lo.prims); lo.hard = cp(lg.lo.hard);
    nodes.push(up, lo);
  }
  const hinge = norm3(sub3(D5, WR));
  return { kind: 'beast.bat', attack: 'bite', hingeX: hinge[0], hingeY: hinge[1], hingeZ: hinge[2], nodes: finish(nodes) };
}

/** bat head and lower jaw in the head's frame: neck joint at the origin, snout along +Z */
function batHead(C, rnd) {
  const p = [], hard = [], jp = [], jhard = [];
  const furC = (col, amp = 0.0055, f = 56) => (q) => q.color(col).tint(0.2, 32).bump(amp, f, 'fur').pbr(0.92);
  const fur = furC(C.fur);
  const skin = (q, col = C.skin) => q.color(col).tint(0.14, 36).pbr(0.55);
  const vary = (col) => tone(col, 0, 0, (rnd() - 0.5) * 0.06);
  p.push(fur(lay(0.094, 0.082, 0.088).at(0, 0.022, 0.045)));                                                 // skull: broad and low
  p.push(fur(S.sphere(0.085).at(0, 0.005, -0.01).blend(0.03)));
  p.push(...S.mirrorX([
    fur(S.ellipsoid(0.04, 0.036, 0.045).at(0.058, -0.012, 0.075).blend(0.025)),                              // cheek
    fur(S.ellipsoid(0.03, 0.014, 0.024).rot(0, -18, -26).at(0.044, 0.066, 0.097).blend(0.012)),              // brow
  ]));
  p.push(skin(lay(0.052, 0.04, 0.045).at(0, -0.006, 0.118).blend(0.025), C.skinDark));                       // short snout
  // pug nose: a wrinkled pad with two forward nostrils and a little upturned leaf
  p.push(skin(S.ellipsoid(0.034, 0.025, 0.016).at(0, 0.006, 0.16).blend(0.008)));
  p.push(skin(S.ellipsoid(0.02, 0.026, 0.008).rot(-24, 0, 0).at(0, 0.036, 0.152).blend(0.006)));
  p.push(...S.mirrorX([
    S.ellipsoid(0.0085, 0.0075, 0.008).at(0.013, 0.006, 0.174).cut(0.003).color(0x1a0a0c),
    S.ellipsoid(0.02, 0.004, 0.02).rot(0, 0, 22).at(0.02, 0.024, 0.15).color(C.skinDark).paint(0.003, -0.002),   // wrinkles
  ]));
  p.push(S.box(0.07, 0.04, 0.12, 0.01).at(0, -0.05, 0.12).cut(0.006).color(C.mouth));                        // roof of the mouth
  p.push(S.ellipsoid(0.003, 0.012, 0.006).at(0, -0.014, 0.166).cut(0.002).color(0x1a0a0c));                   // cleft lip
  // beady eyes that burn red
  const ex = 0.046, ey = 0.034, ez = 0.102, er = 0.0155;
  p.push(...S.mirrorX([
    S.ellipsoid(0.019, 0.015, 0.016).rot(0, 26, -14).at(ex + 0.003, ey, ez + 0.007).cut(0.005).color(0x120608),
    S.sphere(er * 0.94).at(ex, ey, ez).color(C.eye.iris).glow(C.eye.glow * 0.8).pbr(0.3).blend(0),
  ]));
  hard.push(...H.mirrorX([eye(er, { ...C.eye, pupilSize: 0.6, irisSize: 1.5 }).rot(-4, 28, 0).at(ex, ey, ez).lod(1)]));
  // ears: great ribbed sails
  const ear = [
    fur(S.capsule([0, 0, 0], [0.01, 0.2, -0.02], 0.062, 0.008)),
    fur(S.ellipsoid(0.055, 0.04, 0.04).at(0, -0.01, -0.012).blend(0.014)),
    S.ellipsoid(0.05, 0.16, 0.05).at(0.004, 0.085, 0.058).cut(0.006).color(C.ear),                            // the hollow
    S.ellipsoid(0.07, 0.22, 0.06).at(0, 0.08, -0.082).cut(0.005),                                             // flatten the back
    ...[0.045, 0.08, 0.115].map((y) => S.ellipsoid(0.04 - y * 0.12, 0.004, 0.03).rot(0, 0, 8).at(0.002, y, 0.012).color(C.skinDark).paint(0.003, -0.002)),   // ribs
    skin(S.cone(0.012, 0.003, 0.05, 0.003).at(-0.012, 0.03, 0.03).blend(0.004)),                              // tragus
  ].map((q) => q.rot(-6, 16, -26).at(0.064, 0.058, 0.012));
  p.push(...ear, ...mirrorAll(ear));
  // crest and cheek tufts
  const df = distanceField(p), part = { prims: p, hard };
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.02, L = 0.05 + rnd() * 0.015;
    clump(part, df, [x, 0.3, 0.06 - Math.abs(i - 2) * 0.01], [0, -1, 0], [x * 2, 0.15, -1], { L, W: L * 0.3, T: L * 0.17, lift: 0.4, colA: C.back, colB: C.fur, style: furC(vary(C.fur)), lock: i % 2 === 0 });
  }
  for (const sx of [1, -1]) for (let i = 0; i < 4; i++) {
    const L = 0.055 + rnd() * 0.02;
    clump(part, df, [sx * 0.3, 0.01 - i * 0.022, 0.06], [-sx, 0, 0], [sx * 0.7, -0.3 - i * 0.15, -0.8], { L, W: L * 0.3, T: L * 0.17, lift: 0.35, colA: C.ruff, colB: vary(C.ruffTip), style: furC(vary(C.ruff)), lock: i % 2 === 1 });
  }
  // teeth: two long blades in front and a fang either side
  const T = C.tooth, gy = -0.03;
  for (const sx of [1, -1]) {
    hard.push(spike([sx * 0.0085, gy, 0.158], [sx * 0.03, -1, 0.12], 0.05, 0.0075, T, [0, 0, -1], 0.2, 0.7).near());
    hard.push(spike([sx * 0.029, gy, 0.132], [sx * 0.12, -1, 0.05], 0.04, 0.007, T, [0, 0, -1], 0.3).near());
    for (let i = 0; i < 2; i++) hard.push(spike([sx * 0.034, gy, 0.105 - i * 0.02], [sx * 0.08, -1, 0], 0.014, 0.005, T, [0, 0, -1], 0.1).lod(1));
  }
  // lower jaw
  const hinge = [0, -0.02, 0.045];
  const jf = furC(C.belly);
  jp.push(...S.mirrorX([jf(bone([0.04, -0.026, 0.045], [0.022, -0.05, 0.13], 0.02, 0.016))]));
  jp.push(jf(lay(0.03, 0.016, 0.03).at(0, -0.052, 0.14).blend(0.012)));
  jp.push(jf(lay(0.034, 0.014, 0.05).at(0, -0.056, 0.09).blend(0.012)));
  jp.push(S.box(0.04, 0.02, 0.1, 0.006).at(0, -0.034, 0.105).cut(0.005).color(C.mouth));
  jp.push(S.ellipsoid(0.015, 0.007, 0.04).at(0, -0.042, 0.112).color(C.tongue).pbr(0.4).blend(0.003));
  for (const sx of [1, -1]) {
    jhard.push(spike([sx * 0.022, -0.042, 0.148], [sx * 0.1, 1, 0.05], 0.026, 0.0055, T, [0, 0, -1], 0.25).near());
    for (let i = 0; i < 2; i++) jhard.push(spike([sx * (0.005 + i * 0.008), -0.042, 0.16 - i * 0.003], [0, 1, 0.1], 0.009, 0.003, T, [0, 0, -1], 0.1).lod(1));
  }
  return { p, hard, jp, jhard, hinge };
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _ax = new THREE.Vector3();
function batAnim(rig, inner, c, base) {
  const { R, keys } = base;
  const s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk;
  const W = rig.wings || [], WT = rig.wingtips || [], WS = rig.wingskins || [], L = rig.legs || [], Sn = rig.shins || [];
  const idle = Math.sin(t * 1.7 + ph), idle2 = Math.sin(t * 0.9 + ph * 1.6);
  const deadF = c.dead > 0 ? Math.min(1, c.dead * 2) : 0;
  const beat = t * 11.5 + ph, f = Math.sin(beat), g = Math.cos(beat);
  const bite = a >= 0 ? keys(a, [[0, 0], [0.3, -1], [0.5, 1], [0.7, 0.7], [1, 0]]) : 0;
  let jw = 0.05 + 0.1 * Math.max(0, idle2), hx = 0, hy = idle2 * 0.2, py = 0, pz = 0, pitch = 0;
  if (a >= 0) { jw = keys(a, [[0, 0.1], [0.3, 0.95], [0.5, 1.0], [0.58, 0.05], [0.8, 0.2], [1, 0.1]]); hx = keys(a, [[0, 0], [0.3, -0.4], [0.55, 0.3], [1, 0]]); hy = 0; pz = (bite > 0 ? bite * 0.22 : bite * 0.06); }
  // air = 1 in flight, 0 crouched on the ground: wings spread, or folded to crawl on the wrists
  const air = airBlend(rig, c), biteF = Math.max(0, bite), coil = Math.max(0, -bite);
  W.forEach((w, i) => {
    const sg = sideOf(w, i), tp = WT[i], sk = WS[i];
    let fold;
    if (deadF) { wingQ(w, sg, -0.1, 0.1, lerp(-0.6, -0.42 + (sg > 0 ? -0.1 : 0.1), deadF)); fold = 0.45; }
    else {
      const step = c.moving ? Math.sin(t * 9 + ph + (sg > 0 ? 0 : Math.PI)) : 0;
      wingQ(w, sg, -0.3 + step * 0.22 - biteF * 0.25, 0.25, -0.66 + Math.max(0, step) * 0.14 + idle * 0.01 + coil * 0.12);
      if (air > 0.001) { _qf.copy(w.quaternion); wingQ(w, sg, 0.02 + 0.12 * g - biteF * 0.35, 0.16 * g + biteF * 0.2, 0.14 + f * 0.58 + coil * 0.3); if (air < 0.999) w.quaternion.slerp(_qf, 1 - air); }
      fold = 1 - air;
    }
    if (tp) {
      // in the air the hand hinges about the fifth finger and lags the arm; folded, the fingers close like a fan and lie back along the forearm
      _ax.set(sg * (rig.hingeX || 0), rig.hingeY || 0, rig.hingeZ || -1);
      _qa.setFromAxisAngle(_ax, -sg * (Math.sin(beat - 1.0) * 0.5 - 0.05) * (1 - fold));
      _qb.setFromEuler(_ew.set(0.5 * fold, sg * 1.12 * fold, 0, 'YXZ'));
      tp.quaternion.copy(_qb).multiply(_qa);
      tp.scale.set(lerp(1, 0.2, fold), 1, lerp(1, 0.8, fold));
    }
    if (sk) sk.scale.set(1, 1, lerp(1, 0.34, fold));
  });
  // legs: trailing in flight, planted under the rump on the ground
  for (let i = 0; i < L.length; i++) {
    const sg = sideOf(L[i], i), step = c.moving ? Math.sin(t * 9 + ph + (sg > 0 ? Math.PI : 0)) : 0, gr = 1 - air;
    R(L[i], lerp(Math.sin(t * 2.3 + i) * 0.08 - biteF * 0.9, -1.25 + step * 0.25 + deadF * 1.0, gr), sg * 0.35 * (1 - deadF) * gr, sg * (0.25 + deadF * 0.5) * gr);
    R(Sn[i], lerp(biteF * -0.5, -0.55 - Math.max(0, step) * 0.3 + deadF * 0.4, gr));
  }
  if (!deadF) {
    pitch = lerp(-0.52 + idle * 0.015 + 0.12 * bite, -0.2 + 0.03 * g - 0.25 * biteF + 0.3 * coil, air);
    py = lerp(-0.185 + idle * 0.004 + (c.moving ? Math.abs(Math.sin(t * 9 + ph)) * 0.015 : 0), g * 0.05 - 0.02, air);
    hx += lerp(0.34, 0.12, air);
  }
  R(rig.head, hx, hy, hy * 0.2); R(rig.jaw, jw);
  inner.position.z = pz * s;
  if (deadF) {
    // crumpled on its belly, wings slack on the ground
    inner.rotation.x = lerp(-0.2, 0.1, deadF); inner.rotation.z = deadF * 0.22;
    inner.position.y = (lerp(c.flying ? 0 : -0.185, -0.31, deadF) - Math.max(0, c.dead - 0.5) * 0.8) * s;
    R(rig.head, 0.5 * deadF, 0.3 * deadF, 0); R(rig.jaw, 0.6 * deadF);
    return;
  }
  inner.rotation.z = 0; inner.rotation.x = pitch;
  inner.position.y = py * s;
}

// =====================================================================================
//  Animation for everything on four legs
// =====================================================================================
// Leg coefficients: L = upper, S = middle, P = foot. Rotation about X, radians; negative swings a limb forward.
//   lift  = mid-swing (the leg is in the air, coming forward)   ext = the leg is trailing (end of its push)
//   reach = the leg is stretched forward (about to land)
const GAITS = {
  wolf: {
    rate: 10.5, off: [0, 0.6, Math.PI + 0.2, Math.PI + 0.85], bob: 0.032, pitch: 0.075, spine: 0.03, clear: 0.3, clearAtk: 0.3,
    front: { A: 0.6, lift: [-0.18, -0.95, 1.05], ext: [0, 0.12, 0.35], reach: [0, 0.1, -0.5] },
    hind: { A: 0.62, lift: [-0.22, 0.85, -0.8], ext: [0.05, -0.28, 0.55], reach: [0, 0.2, -0.1] },
  },
  horse: {
    rate: 10, off: [0, 0.65, Math.PI + 0.25, Math.PI + 0.9], bob: 0.035, pitch: 0.05, spine: 0.015, girth: 1.5,
    front: { A: 0.5, lift: [-0.3, 1.25, 0.6], ext: [0, 0, 0.4], reach: [0, 0, -0.3] },
    hind: { A: 0.48, lift: [-0.12, -0.6, 0.9], ext: [0, 0.4, 0.3], reach: [0, -0.1, -0.2] },
  },
  griffon: {
    rate: 8.5, off: [0, Math.PI, Math.PI, 0], bob: 0.02, pitch: 0.02, spine: 0.03, girth: 1.4,
    front: { A: 0.42, lift: [-0.15, -0.8, 0.95], ext: [0, 0.1, 0.3], reach: [0, 0.08, -0.4] },
    hind: { A: 0.45, lift: [-0.18, 0.75, -0.7], ext: [0.05, -0.22, 0.45], reach: [0, 0.15, -0.1] },
    beat: 7.6, tail: [0.55, 0.3, 0.1, -0.25], clear: 0.2, clearAtk: 0.14,
  },
};
const _cu = { t: 0, moving: false, atk: -1, dead: 0, phase: 0, flying: false };

function poseLegs(rig, c, base, G, k, g) {
  const { R } = base;
  const L = rig.legs || [], Sn = rig.shins || [], Pw = rig.paws || [];
  for (let i = 0; i < L.length; i++) {
    const q = i < 2 ? G.front : G.hind, ph = g + G.off[i];
    const sw = Math.sin(ph), lift = Math.max(0, Math.cos(ph)), ext = Math.pow(Math.max(0, -sw), 1.5), reach = Math.pow(Math.max(0, sw), 1.5);
    R(L[i], k * (-sw * q.A + lift * q.lift[0] + ext * q.ext[0] + reach * q.reach[0]));
    R(Sn[i], k * (lift * q.lift[1] + ext * q.ext[1] + reach * q.reach[1]));
    R(Pw[i], k * (lift * q.lift[2] + ext * q.ext[2] + reach * q.reach[2]));
  }
}

const _ew = new THREE.Euler(0, 0, 0, 'YXZ'), _qf = new THREE.Quaternion();
/** 0 on the ground .. 1 in the air, eased over about a third of a second so landing and taking off do not snap */
function airBlend(rig, c) {
  const target = c.flying && !(c.dead > 0) ? 1 : 0;
  const dt = rig._t === undefined ? 1 : Math.min(0.25, Math.abs(c.t - rig._t));
  rig._t = c.t;
  rig._air = rig._air === undefined ? target : rig._air + (target - rig._air) * Math.min(1, dt * 7);
  return rig._air;
}
/** point a wing node: sweep it back (yaw), roll it about its own span, raise it (dihedral). sg = +1 left, -1 right */
function wingQ(n, sg, yaw, roll, dihedral) { if (n) n.quaternion.setFromEuler(_ew.set(roll, sg * yaw, sg * dihedral, 'YXZ')); }
const sideOf = (n, i) => ((n.userData.rest?.[3] ?? (i ? -1 : 1)) >= 0 ? 1 : -1);

/** feathered wings: beating in the air; on the ground raised over the back with the hands folded in, heraldry's way */
function poseFeatherWings(rig, c, s, beat, flare, deadF) {
  const W = rig.wings || [], WT = rig.wingtips || [];
  const idle = Math.sin(c.t * 1.3 + (c.phase || 0)), air = airBlend(rig, c);
  W.forEach((w, i) => {
    const sg = sideOf(w, i), tp = WT[i];
    if (deadF > 0) { wingQ(w, sg, 0.75 * deadF, -0.3 * deadF, lerp(0.9, sg > 0 ? -0.5 : 0.15, deadF)); wingQ(tp, sg, 1.5, 0, -0.1); return; }
    const open = flare;                                                       // the wings mantle open when it strikes
    wingQ(w, sg, lerp(0.72, 0.3, open), lerp(0.28, -0.1, open), lerp(1.02, 0.7, open) + idle * 0.025);
    wingQ(tp, sg, lerp(1.75, 0.5, open), 0, lerp(-0.12, -0.05, open));
    if (air > 0.001) {
      const f = Math.sin(beat), g = Math.cos(beat);
      _qf.copy(w.quaternion); wingQ(w, sg, 0.06 + 0.1 * g + flare * 0.25, 0.1 * g - flare * 0.3, 0.2 + f * 0.5); if (air < 0.999) w.quaternion.slerp(_qf, 1 - air);
      if (tp) { _qf.copy(tp.quaternion); wingQ(tp, sg, 0.12 - 0.16 * Math.cos(beat - 0.5), 0.12 * g, Math.sin(beat - 1.0) * 0.42 - 0.06); if (air < 0.999) tp.quaternion.slerp(_qf, 1 - air); }
    }
  });
}

/** the animal itself: gait, neck, jaws, tail, wings, the bite or the charge, dying. Returns true while dead. */
function beastMotion(rig, inner, c, base, mounted) {
  const { R, keys } = base;
  const s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk, fly = !!c.flying;
  const G = GAITS[rig.gait] || GAITS.wolf;
  const body = rig.body || rig.torso, neck = mounted ? rig.mneck?.[0] : rig.neck, head = mounted ? rig.mhead?.[0] : rig.head, jaw = mounted ? rig.mjaw?.[0] : rig.jaw;
  const L = rig.legs || [], Sn = rig.shins || [], Pw = rig.paws || [], T = rig.tail || [];
  const k = c.moving && !fly ? 1 : 0, g = t * G.rate + ph;
  const idle = Math.sin(t * 1.5 + ph), idle2 = Math.sin(t * 0.9 + ph * 1.7);
  const beat = t * (G.beat || 8) + ph;
  poseLegs(rig, c, base, G, k, g);
  let nx = idle * 0.03 - k * 0.12 + k * Math.sin(g + 0.6) * 0.05, hx = -idle * 0.025 + k * 0.1, hy = idle2 * 0.16 * (1 - k), jw = 0.04 + 0.05 * Math.max(0, idle2) + k * 0.1;
  let py = k * (0.5 + 0.5 * Math.sin(g * 1 + 2.2)) * G.bob, pz = 0, pitch = k * Math.sin(g + 1.2) * G.pitch, tailLift = k * 0.5, flare = 0;
  if (fly) {
    // legs gathered up: talons under the breast, hind legs trailing
    for (let i = 0; i < L.length; i++) {
      const d = Math.sin(t * 2.1 + i * 1.3 + ph) * 0.05;
      if (i < 2) { R(L[i], 0.8 + d); R(Sn[i], -1.95 - d); R(Pw[i], 1.1); } else { R(L[i], 0.95 + d); R(Sn[i], 0.3 + d); R(Pw[i], 0.75); }
    }
    nx = 0.34 + idle * 0.03; hx = -0.26; hy = idle2 * 0.1; jw = 0.03; tailLift = 1.1;
    py = Math.cos(beat) * 0.045; pitch = -0.07;
  }
  if (a >= 0) {
    // the bite: sink back on the haunches, then spring with the jaws wide and snap them shut
    const m = mounted ? 0.6 : 1;                                                        // a ridden beast lunges less: its rider has work to do
    const spring = keys(a, [[0, 0], [0.3, -1], [0.5, 1], [0.72, 0.8], [1, 0]]);
    flare = keys(a, [[0, 0], [0.3, 1], [0.62, 0.8], [1, 0]]);
    pz = (spring > 0 ? spring * 0.26 : spring * 0.07) * m;
    nx += keys(a, [[0, 0], [0.3, -0.32], [0.5, 0.2], [0.62, 0.34], [1, 0]]) * (mounted ? 0.5 : 1) + (mounted ? 0.12 * Math.sin(Math.PI * a) : 0);
    hx += keys(a, [[0, 0], [0.3, -0.42], [0.5, -0.05], [0.6, 0.3], [1, 0]]) * (mounted ? 0.5 : 1);
    hy = keys(a, [[0, 0], [0.6, 0], [0.72, 0.25], [0.84, -0.2], [1, 0]]);                // a shake of the head with the mouthful
    jw = keys(a, [[0, 0.05], [0.28, 0.85], [0.5, 0.95], [0.58, 0.02], [0.8, 0.1], [1, 0.05]]);
    tailLift = Math.max(tailLift, 0.9);
    if (fly) {
      // stooping: the talons swing forward to strike
      const grab = keys(a, [[0, 0], [0.35, 0.3], [0.55, 1], [0.75, 0.8], [1, 0]]);
      for (let i = 0; i < 2 && i < L.length; i++) { R(L[i], 0.8 - grab * 1.5); R(Sn[i], -1.95 + grab * 1.6); R(Pw[i], 1.1 - grab * 1.35); }
      pitch += -0.12 * grab;
    } else {
      py = keys(a, [[0, 0], [0.3, -0.035], [0.46, 0.07], [0.6, 0.01], [1, 0]]) * m;
      pitch = keys(a, [[0, 0], [0.3, 0.07], [0.45, -0.16], [0.6, 0.04], [1, 0]]) * m * m;
      const crouch = Math.max(0, -spring) * m, leap = Math.max(0, spring) * m;
      for (let i = 0; i < L.length; i++) {
        if (i < 2) { R(L[i], crouch * 0.25 - leap * 0.62); R(Sn[i], -crouch * 0.5 + leap * 0.1); R(Pw[i], crouch * 0.3 + leap * 0.5); }
        else { R(L[i], -crouch * 0.3 + leap * 0.5); R(Sn[i], crouch * 0.55 - leap * 0.25); R(Pw[i], -crouch * 0.35 + leap * 0.5); }
      }
    }
  }
  // a ridden beast carries its head a little low and to the left when the lance comes down, out of the weapon's way
  const clear = mounted ? (c.moving || fly || a >= 0 ? (G.clear || 0.17) : 0) + (a >= 0 ? Math.sin(Math.PI * Math.min(1, a * 1.25)) * (G.clearAtk || 0.12) : 0) : 0;
  R(neck, nx + clear * 0.5, hy * 0.4 + clear); R(head, hx, hy * 0.6 - clear * 0.5, hy * 0.15); R(jaw, jw);
  R(body, 0, k * Math.sin(g) * G.spine, 0);
  const tl = G.tail || [0.5, 0.25, 0.12, 0.05];
  T.forEach((seg, i) => R(seg, tailLift * tl[i] + Math.sin(t * 1.3 + ph - i * 0.6) * 0.04 + k * Math.sin(g - i * 0.8) * 0.1, Math.sin(t * (k || fly ? 5 : 2.2) + ph - i * 0.7) * (0.1 + 0.05 * i) * (fly ? 0.5 : 1)));

  const dead = base.die(inner, c, true);
  const deadF = dead ? Math.min(1, c.dead * 2) : 0;
  if (rig.wings && rig.feathered) poseFeatherWings(rig, c, s, beat, flare, deadF);
  inner.position.z = pz * s;
  if (dead) {
    const f = deadF;
    inner.rotation.x = 0;
    inner.position.y += f * 0.115 * s * (G.girth || 1);                         // lies on its flank instead of half in the ground
    R(neck, 0.25 * f, 0, -0.3 * f); R(head, 0.2 * f, 0, -0.35 * f); R(jaw, 0.55 * f);
    for (let i = 0; i < L.length; i++) {
      const up = i % 2 === 1;                                                   // the legs of the upper side sag across the body
      if (i < 2) { R(L[i], -0.35 * f, 0, (up ? 0.3 : -0.08) * f); R(Sn[i], -0.5 * f * (G.front.lift[1] < 0 ? 1 : -1)); R(Pw[i], 0.7 * f); } else { R(L[i], 0.3 * f, 0, (up ? 0.28 : -0.08) * f); R(Sn[i], 0.35 * f * (G.hind.lift[1] > 0 ? 1 : -1)); R(Pw[i], 0.3 * f); }
    }
    T.forEach((seg, i) => R(seg, 0.15 * f, 0, 0.2 * f * (i ? 1 : 0)));
    return true;
  }
  inner.rotation.x = pitch;
  inner.position.y = py * s;
  return false;
}

function quadAnim(rig, inner, c, base) { beastMotion(rig, inner, c, base, false); }

/** the rider: upper body from the stock animator, the weapon couched, the free hand on the rein */
function poseRider(rig, c, base, dead) {
  const { R } = base;
  const A = rig.arms || [], F = rig.forearms || [], T = rig.torso, Hn = rig.hands || [];
  const riding = c.moving || c.flying;
  _cu.t = c.t; _cu.phase = c.phase; _cu.dead = c.dead; _cu.flying = false; _cu.moving = false;
  _cu.atk = c.atk >= 0 ? c.atk : riding && rig.attack === 'thrust' ? 0.2 : -1;            // couched level at the gallop
  base.upperBody(rig, _cu);
  const g = c.t * (GAITS[rig.gait] || GAITS.wolf).rate + (c.phase || 0), k = c.moving && !c.flying ? 1 : 0;
  const bounce = k * Math.sin(g * 1 + 0.8), idle = Math.sin(c.t * 1.6 + (c.phase || 0));
  const couch = !dead && _cu.atk >= 0 ? 1 : 0;
  if (T && !dead) {
    T.rotation.x += (riding ? 0.16 : 0.03) + bounce * 0.04;                               // forward in the saddle at speed
    if (couch) { T.rotation.y *= 0.55; T.rotation.z += 0.09; }                            // and out over the weapon side, so the point clears the mount
  }
  poseCarried(rig, _cu, base, rig.hold, true);                                            // `true`: one hand only, the other has the rein
  if (dead) return;
  if (couch && T && A[1] && F[1] && Hn[1]) {
    // splay the couched weapon a few degrees outward, away from the mount's neck
    _qa.copy(T.quaternion).multiply(A[1].quaternion).multiply(F[1].quaternion);
    _qb.setFromAxisAngle(_ax.set(0, 1, 0), -0.1);
    Hn[1].quaternion.premultiply(_qa).premultiply(_qb).premultiply(_qa.invert());
  }
  if (!(rig.shield && rig.shield[0])) { R(A[0], -0.62 + bounce * 0.05 + idle * 0.02, 0, 0.16); R(F[0], -0.95 - bounce * 0.06); }
}

function riderAnim(rig, inner, c, base) {
  const dead = beastMotion(rig, inner, c, base, true);
  poseRider(rig, c, base, dead);
}

// =====================================================================================
export const bodies = { quadruped, rider, spider, bat };
export const animators = { 'beast.quad': quadAnim, 'beast.rider': riderAnim, 'beast.spider': spiderAnim, 'beast.bat': batAnim };
