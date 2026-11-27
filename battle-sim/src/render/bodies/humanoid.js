// Two-legged bodies: sculpted anatomy, heads and faces for every humanoid species.
//
//   bodies.humanoid(def, o) -> rig description for rigkit.assemble()
//
// Rig nodes (docs/MODELING.md): root, legL, shinL, legR, shinR, torso, head, armL, foreL, armR, foreR.
// Extra nodes this module adds (none of them are known to the stock animators, so they simply follow their parent):
//   hair            child of head: scalp hair, beards, crests (kept apart so hairlines stay crisp)
//   handL, handR    children of foreL / foreR at the wrist (rig list `hands`): the fist or open hand
//   weaponR         child of handR at the grip, in the weapon frame (rig list `weapon`)
//   shieldL         child of foreL, in the shield frame (rig list `shield`)
//   wingL, wingR    children of torso (rig list `wings`); tail0..tail2 chained from torso (rig list `tail`)
//   stringU, stringL, arrow   longbow only: children of weaponR (rig lists `string`, `arrow`); the bow's rigid string is
//                   replaced by two hinged halves and a nocked arrow so the archer can draw and loose
// Rig values on the description (rigkit copies them to the rig): hold, reach (weapon length), butt (how far the weapon
// runs back past the grip), lie (how high a corpse's back lifts it), pass (arrow offset), build (arm length against a
// man's), wscale (weapon scale), handR.
// Far level: every limb has a `.far()` stand-in at its real thickness (a six-sided CylinderGeometry tagged 'limbRod',
// which gear.js recolours to the garment), hands and feet seven-sided spindles tagged 'handRod' / 'footRod' that take
// the colour of whatever covers them after gear.dress(), and blade ears flat spikes. Human ear prims are tagged 'ear'.
// Joint positions come from proportions(o) in anatomy.js. Every part is built for the LEFT side
// (lateral = +X, medial = -X) and mirrored for the right.
//
// o.pose === 'riding' builds the legs astride (their nodes then carry no `rig` tag, so a mount's animator leaves
// them alone). gear.dress(ctx) is called once the bare body exists; weapons and shields are attached after it.
// The description's kind is `humanoid.<hold>[.shield]`, which picks the animator at the bottom of this file.
import * as THREE from 'three';
import { S, H, rgb, noise3, distanceTo } from '../sculpt.js';
import { proportions } from './anatomy.js';
import { dress, headCover } from './gear.js';
import { weapon as makeWeapon, shield as makeShield } from './weapons.js';

const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => mul3(a, 1 / (len3(a) || 1e-9));
const flat = (x) => [x].flat(Infinity).filter(Boolean);
const tagged = (x, tag) => { x.tag = tag; return x; };
const mirrorAll = (list) => flat(list).map((p) => p.mirrorX());

// ---------- deterministic variation ----------
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- colour ----------
const _c = new THREE.Color(), _c2 = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };
/** shift a colour in hue / saturation / lightness (all in sRGB terms) */
function tone(hex, dh = 0, ds = 0, dl = 0) {
  _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace);
  _c.setHSL(((_hsl.h + dh) % 1 + 1) % 1, clamp(_hsl.s + ds), clamp(_hsl.l + dl), THREE.SRGBColorSpace);
  return _c.getHex();
}
function mix(a, b, t) { return _c.set(a).lerp(_c2.set(b), t).getHex(); }

// ---------- placement helpers ----------
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
/** tapered capsule from a to b whose local Y axis follows the bone (so ridges / fur / scales run along it) */
function bone(a, b, ra, rb = ra, zHint) { return orient(S.capsule([0, 0, 0], [0, len3(sub3(b, a)), 0], ra, rb), a, sub3(b, a), zHint); }
/** a paint volume for a stroke on a surface whose depth is only roughly known: long, thin across, deep along z */
function stroke(cx, cy, cz, len, thick, depth, yaw = 0, slant = 0) { return S.ellipsoid(len, thick, depth).rot(0, yaw, slant).at(cx, cy, cz); }
/** walk from `from` along `dir` until the sculpt's surface: where to put eyes, teeth, spikes */
function hit(prims, from, dir, maxSteps = 18) {
  const u = norm3(dir);
  let p = from.slice();
  for (let i = 0; i < maxSteps; i++) { const d = distanceTo(prims, p[0], p[1], p[2]); if (d < 0.0005) break; p = add3(p, mul3(u, d)); }
  return p;
}
const surfZ = (prims, x, y, z0) => hit(prims, [x, y, z0], [0, 0, -1])[2];

const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

// ---------- crisp pieces: eyes, lids, claws, teeth, feathers ----------
/** eyeball: a lathe whose pole faces +Y, with rings placed exactly on the pupil and iris edges so they stay crisp */
function eyeGeo(cornea) {
  return cached(`eye${cornea}`, () => {
    const angles = [112, 92, 76, 60, 46, 34.4, 33.6, 25, 16.4, 15.6, 9, 0];
    const prof = angles.map((a) => { const r = 1 + cornea * Math.max(0, Math.cos(Math.min(90, a * 2.4) * DEG)); return new THREE.Vector2(Math.max(1e-5, Math.sin(a * DEG) * r), Math.cos(a * DEG) * r); });
    return new THREE.LatheGeometry(prof, 16);
  });
}
/** eye(r, look) -> hard piece centred on the origin looking along +Z. look: { iris, pupil, white, slit, glow, ring } */
function eye(r, look = {}) {
  const iris = look.iris ?? 0x4a6a8a, white = look.white ?? 0xefe8da, pupil = look.pupil ?? 0x0b0a0c, rim = look.ring ?? tone(iris, 0, 0.05, -0.18);
  const slit = !!look.slit, bar = look.slit === 'bar', pA = Math.sin(16 * DEG) * (look.pupilSize ?? 1), iA = Math.sin(34 * DEG);
  const h = H.geo(eyeGeo(look.cornea ?? 0.045)).shade((x, y, z) => {
    if (y < 0.2) return null;
    const d = Math.hypot(x, z);
    if (slit) { if (bar ? Math.abs(z) < pA * 0.46 && Math.abs(x) < iA * 0.8 : Math.abs(x) < pA * 0.4 && Math.abs(z) < iA * 0.86) return pupil; } else if (d < pA * 1.01) return pupil;
    if (d < iA * 0.84) return iris;
    if (d < iA) return rim;
    return null;
  }).color(white).pbr(look.glow ? 0.4 : 0.16, 0);
  if (look.glow) h.glow(look.glow);
  return h.scale(r).rot(90, 0, 0).lod(1);
}
function lidGeo(theta) { return cached(`lid${theta}`, () => new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, theta * DEG)); }
/** hard eyelids + lash line around an eyeball of radius er at c. upper / lower = how far each lid closes (degrees), roll < 0 scowls */
function eyelids(c, er, color, lash, opt = {}) {
  const up = opt.upper ?? 38, lo = opt.lower ?? 0, tilt = opt.tilt ?? 30, roll = opt.roll ?? 0, rl = er * 1.075;
  const out = [H.geo(lidGeo(up)).scale(rl).rot(tilt, 0, roll).at(c[0], c[1], c[2]).color(color).pbr(0.7).lod(1)];
  if (lo > 0) out.push(H.geo(lidGeo(lo)).scale(rl).rot(180 - tilt, 0, -roll * 0.4).at(c[0], c[1], c[2]).color(opt.lowerColor ?? color).pbr(0.7).lod(1));
  if (lash != null) out.push(H.torus(rl * Math.sin(up * DEG), er * 0.07, 14, 4).rot(90, 0, 0).at(0, rl * Math.cos(up * DEG), 0).rot(tilt, 0, roll).at(c[0], c[1], c[2]).color(lash).pbr(0.8).lod(0));
  return out;
}
/**
 * A pair of eyes (or one, with single) set into the sculpt p at (+-x, y): cuts the sockets, backs them with a
 * white ball that survives at distance, and adds the crisp eyeball, lids and lash line. Returns the eye's z.
 */
function eyeSet(p, hard, C, e) {
  const r = e.r, z = surfZ(p, e.x, e.y, e.z0 ?? 0.5) - r * (1 + (e.sink ?? 0.05));
  const one = (list) => (e.single ? list : S.mirrorX(list)), oneH = (list) => (e.single ? list : H.mirrorX(list));
  p.push(...one([
    S.ellipsoid(r * (e.wide ?? 1.2), r * (e.tall ?? 0.84), r * 0.85).at(e.x, e.y + r * 0.1, z + r * (1.0 + (e.sink ?? 0.05) * 0.5)).cut(0.006).color(e.socket ?? tone(C.skin, -0.005, 0.02, -0.04)),
    S.sphere(r * 0.95).at(e.x, e.y, z).color(e.look?.white ?? C.white).pbr(0.3).blend(0),
  ]));
  hard.push(...oneH([
    eye(r, e.look).rot(0, e.single ? 0 : (e.yaw ?? 3), 0).at(e.x, e.y, z),
    ...(e.noLids ? [] : eyelids([e.x, e.y, z], r, e.lidCol ?? tone(C.skin, -0.005, -0.06, -0.18), e.lash, e.lid)),
  ]));
  return z;
}

/** a curved cone pointing along +Y from the origin, hooking toward +Z: claws, talons, fangs, tusks, spikes */
function clawGeo(hook, aspect) {
  return cached(`claw${hook}:${aspect}`, () => {
    const g = new THREE.ConeGeometry(aspect, 1, 7, 4);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, p.getZ(i) + hook * y * y); }
    g.computeVertexNormals();
    return g;
  });
}
function claw(len, r, color, hook = 0.3) { return H.geo(clawGeo(hook, Math.max(0.05, Math.round((r / len) * 20) / 20))).scale(len).color(color).pbr(0.35, 0).lod(1); }
/** claw from base pointing along dir, hooking toward `toward` */
const spike = (base, dir, len, r, color, toward = [0, 0, 1], hook = 0.3) => orient(claw(len, r, color, hook), base, dir, toward);

/** a feather: unit length along +Y, half-width 0.5 along X, faintly cambered, face toward +Z */
function featherGeo() {
  return cached('feather', () => {
    const N = 6, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, w = 0.5 * Math.min(1, Math.pow(t * 3.2, 0.7)) * Math.pow(Math.max(0, 1 - Math.pow(t, 3.2)), 0.55) + 0.02 * (1 - t);
      pos.push(-w, t, -0.07 * w * 2, 0, t, 0.05, w, t, -0.07 * w * 2);
    }
    for (let i = 0; i < N; i++) { const a = i * 3, b = a + 3; idx.push(a, a + 1, b + 1, a, b + 1, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}
/** feather from base along dir with its face toward `face`; colours run base -> main -> tip */
function feather(base, dir, len, width, face, cols, lod) {
  const h = H.geo(featherGeo()).shade((x, y) => (y > 0.74 ? cols[2] : y < 0.14 ? cols[0] : Math.abs(x) < 0.04 ? cols[0] : cols[1])).color(cols[1]).pbr(0.82).scale(width, len, width);
  if (lod != null) h.lod(lod);
  return orient(h, base, dir, face);
}

// ---------- species ----------
// What makes each species' body: numbers and switches the part builders read.
//   muscle 0..1 definition, gut 0..1 belly, fingers per hand, claws 0..1 (above 0.3 they are real claws),
//   feet shoe | bare | hoof | talon, det = sculpt detail multiplier, armOut = degrees the arms hang away from the body
const SPECIES = {
  human: { muscle: 0.5, fingers: 4, feet: 'shoe', det: 1, armOut: 4, tint: [0.07, 26] },
  goblin: { muscle: 0.3, gut: 0.22, fingers: 3, feet: 'bare', toes: 3, claws: 0.45, det: 1, armOut: 6, tint: [0.13, 15] },
  hobgoblin: { muscle: 0.85, gut: 0.12, fingers: 4, feet: 'bare', toes: 4, claws: 0.36, det: 1, armOut: 7, tint: [0.1, 16] },
  ogre: { muscle: 0.42, gut: 1, fingers: 4, feet: 'bare', toes: 4, claws: 0.2, det: 1.08, armOut: 15, tint: [0.12, 13], hide: ['noise', 0.0022, 46] },
  troll: { muscle: 0.5, gut: 0.24, fingers: 3, feet: 'bare', toes: 3, claws: 0.6, det: 1.0, armOut: 8, tint: [0.15, 11], hide: ['noise', 0.0035, 30] },
  cyclops: { muscle: 0.8, gut: 0.15, fingers: 4, feet: 'bare', toes: 4, claws: 0.2, det: 1.08, armOut: 9, tint: [0.08, 16] },
  minotaur: { muscle: 1, fingers: 3, feet: 'hoof', claws: 0.2, det: 1.0, armOut: 9, tint: [0.12, 14], tail: 'bull' },
  demon: { muscle: 1, fingers: 4, feet: 'bare', toes: 3, claws: 1, det: 1.08, armOut: 9, tint: [0.14, 12], tail: 'barb', wings: 'bat', hide: ['noise', 0.0018, 58] },
  imp: { muscle: 0.45, gut: 0.3, fingers: 3, feet: 'bare', toes: 3, claws: 0.7, det: 1, armOut: 6, tint: [0.16, 16], tail: 'spade', wings: 'bat', hide: ['noise', 0.0016, 64] },
  ghoul: { muscle: 0.2, fingers: 4, feet: 'bare', toes: 4, claws: 1, det: 1, armOut: 5, tint: [0.15, 13], gaunt: 1 },
  harpy: { muscle: 0.3, fingers: 3, feet: 'talon', claws: 0.9, det: 1, armOut: 6, tint: [0.07, 26], female: 1, noWrap: 1, tail: 'fan', wings: 'feather' },
  // the wider races (feet: 'claw' = a raised hock and three splayed talons, for the look of a digitigrade leg)
  elf: { muscle: 0.36, fingers: 4, feet: 'shoe', det: 1, armOut: 4, tint: [0.05, 26] },
  dwarf: { muscle: 0.8, gut: 0.36, fingers: 4, feet: 'shoe', det: 1, armOut: 10, tint: [0.08, 22] },
  orc: { muscle: 0.88, gut: 0.1, fingers: 4, feet: 'bare', toes: 4, claws: 0.26, det: 0.92, armOut: 12, tint: [0.11, 14], hide: ['noise', 0.0016, 50] },
  lizard: { muscle: 0.6, fingers: 3, feet: 'claw', toes: 3, claws: 0.8, det: 1, armOut: 7, tint: [0.16, 13], hide: ['scales', 0.003, 50], tail: 'lizard' },
  rat: { muscle: 0.25, fingers: 4, feet: 'bare', toes: 4, claws: 0.5, det: 1, armOut: 5, tint: [0.14, 20], hide: ['fur', 0.004, 42], tail: 'rat' },
  goat: { muscle: 0.85, fingers: 4, feet: 'hoof', claws: 0.2, det: 1, armOut: 9, tint: [0.13, 16], hide: ['fur', 0.0035, 42], tail: 'goat' },
  tiger: { muscle: 0.85, fingers: 4, feet: 'bare', toes: 4, claws: 0.42, det: 1.02, armOut: 7, tint: [0.07, 18], hide: ['fur', 0.003, 44], tail: 'tiger' },
  mummy: { muscle: 0.15, fingers: 4, feet: 'bare', toes: 4, claws: 0.2, det: 1, armOut: 5, tint: [0.13, 30], gaunt: 1, noWrap: 1, hide: ['ridges', 0.0026, 27] },
};
/** skin colour when the descriptor gives none */
const DEFAULT_SKIN = { elf: 0xe8cdb0, dwarf: 0xd09a74, orc: 0x5f7a3a, lizard: 0x4f7a4a, rat: 0x6a5a4a, goat: 0x6a5238, tiger: 0xd9822a, mummy: 0x3a2e24 };

function palette(def, o, sp) {
  const flesh = o.skin ?? DEFAULT_SKIN[sp] ?? 0xd9a77c;
  const skin = sp === 'mummy' ? o.cloth2 ?? 0xb9ab88 : flesh;          // a mummy's surface is its wrappings; `skin` is the dried flesh in the gaps
  const C = {
    skin,
    shade: tone(skin, -0.012, 0.05, -0.08),
    deep: tone(skin, -0.02, 0.04, -0.2),
    light: tone(skin, 0.008, -0.05, 0.06),
    line: tone(skin, 0, 0.02, -0.05),
    lip: mix(tone(skin, -0.02, 0.04, -0.08), 0x9a4a40, 0.35),
    blush: mix(skin, 0xc2553f, 0.22),
    nail: tone(skin, 0, -0.15, 0.14),
    claw: 0x2a2420, tooth: 0xe9dfc4, mouth: 0x3a1a18, linen: 0xc9bea2, white: 0xefe8da, shoe: 0x4a3524,
    cloth: o.cloth ?? 0x6b5a44,
  };
  if (sp === 'goblin' || sp === 'hobgoblin') Object.assign(C, { lip: tone(skin, -0.02, 0, -0.17), blush: tone(skin, -0.04, 0.05, -0.05), nail: 0x3a3424, claw: 0x2c2a1c, linen: 0x5b4630, light: tone(skin, 0.02, -0.06, 0.07), white: 0xe6dfa8, tooth: 0xe3d9a8 });
  if (sp === 'ghoul') Object.assign(C, { lip: tone(skin, 0, -0.02, -0.25), blush: tone(skin, 0.3, 0, -0.08), claw: 0x23201c, nail: 0x3a3832, linen: 0x4a463c, tooth: 0xcfc59e, light: tone(skin, 0.02, -0.03, 0.08), mouth: 0x1e1412 });
  if (sp === 'troll' || sp === 'ogre' || sp === 'cyclops') Object.assign(C, { lip: tone(skin, -0.02, 0.02, -0.2), nail: tone(skin, 0, -0.1, -0.25), claw: tone(skin, 0, -0.12, -0.34), linen: mix(o.cloth ?? 0x5a4630, 0x3a2e22, 0.5) });
  if (sp === 'minotaur') Object.assign(C, { skin: tone(skin, 0.005, 0.05, 0.075), lip: 0x2a1c18, nail: 0x1c1614, claw: 0x1c1614, linen: 0x2c2018, light: tone(skin, 0.02, -0.04, 0.24), fur: tone(skin, -0.005, -0.02, -0.07), horn: 0xd8cba6, sheen: tone(skin, 0.01, 0.02, 0.17) });
  if (sp === 'demon' || sp === 'imp') Object.assign(C, { lip: tone(skin, 0, 0, -0.16), blush: tone(skin, 0.02, 0.05, 0.04), nail: 0x141012, claw: 0x141012, linen: 0x1e1614, tooth: 0xf0e6c8, light: tone(skin, 0.015, 0.02, 0.06), horn: 0x1a1416, mouth: 0x2a0a08, ember: 0xff7a1e,
    scorch: tone(skin, -0.012, -0.08, -0.1), scorch2: tone(skin, -0.02, -0.16, -0.2) });
  if (sp === 'harpy') Object.assign(C, { claw: 0x2a2622, nail: 0x2a2622, plume: o.cloth ?? 0x6a5a8a, scale: 0xc79a3e });
  if (sp === 'elf') Object.assign(C, { blush: mix(skin, 0xc2553f, 0.14), shoe: 0x4a3a28 });
  if (sp === 'dwarf') Object.assign(C, { blush: mix(skin, 0xc2452f, 0.36), shoe: 0x3a2a1c, linen: 0x8a7a5c });
  if (sp === 'orc') Object.assign(C, { lip: tone(skin, -0.02, 0, -0.19), blush: tone(skin, -0.03, 0.04, -0.06), nail: 0x2a261c, claw: 0x2a261c, linen: 0x3a2c20, white: 0xe6dcae, tooth: 0xe6dcb4, mouth: 0x2a1210, light: tone(skin, 0.02, -0.05, 0.07) });
  if (sp === 'lizard') Object.assign(C, { light: mix(tone(skin, 0.04, -0.14, 0.2), 0xdcd29a, 0.5), lip: tone(skin, 0, 0, -0.2), nail: 0x1c1a14, claw: 0x1c1a14, linen: 0x4a3a26, tooth: 0xeee6c8, mouth: 0x4a1418,
    crest: mix(0xc2482a, skin, 0.22), crestDeep: mix(0x7a2418, skin, 0.3) });
  if (sp === 'rat') Object.assign(C, { light: tone(skin, 0.01, -0.06, 0.17), pink: 0xd39a92, lip: 0x8a5a56, nail: 0x3a3028, claw: 0x3a3028, linen: 0x3a3026, tooth: 0xe6c458, mouth: 0x3a1616, fur: tone(skin, 0, -0.02, -0.045) });
  if (sp === 'goat') Object.assign(C, { light: tone(skin, 0.02, -0.08, 0.2), lip: 0x2a1c18, nail: 0x1c1614, claw: 0x1c1614, linen: 0x2c2018, fur: tone(skin, -0.01, -0.03, -0.06), hornA: 0x3a3028, horn: 0xbfb294 });
  if (sp === 'tiger') Object.assign(C, { pale: 0xf0e8d8, light: 0xf0e8d8, stripe: 0x1a1410, lip: 0x1a1410, nail: 0xe2d8c0, claw: 0xe2d8c0, tooth: 0xf2ead4, mouth: 0x3a1614, linen: mix(o.cloth ?? 0x6a2a22, 0x2a1c18, 0.35) });
  if (sp === 'mummy') Object.assign(C, { flesh: tone(flesh, 0, 0, -0.02), lip: flesh, blush: skin, nail: tone(flesh, 0, -0.05, 0.1), claw: tone(flesh, 0, -0.05, 0.1), tooth: 0xcfc59e, mouth: 0x140e0c, light: tone(skin, 0, -0.02, 0.07) });
  C.fur ??= tone(skin, 0, -0.05, -0.12);
  C.horn ??= 0xd8cba6;
  C.plume ??= o.cloth ?? 0x6a5a8a;
  return C;
}

// =====================================================================================
//  Body parts. Each returns { prims, hard } in its node's space, built for the LEFT side.
// =====================================================================================

/**
 * The limb's stand-in for the farthest detail level, from y = 0 down to y = -len, at the limb's real thickness: there a
 * thin limb falls between the sculpt's sample points, and this is what keeps it solid and correctly proportioned.
 * It exists only on that level (.far()). gear.js recolours it to the garment by recognising an un-flagged six-sided
 * CylinderGeometry (keep those three things), and it is tagged `limbRod` so that can be done by tag instead.
 */
const core = (rTop, rBottom, len, color) => { const h = H.cyl(rTop, rBottom, len, 6).at(0, -len / 2, 0).color(color).pbr(0.8).far(); h.tag = 'limbRod'; return h; };
/** far-level stand-in for a hand or foot: a flattened seven-sided spindle (seven sides, so gear's rod recolouring passes it by) */
const knob = (rTop, rBottom, len, color, tag) => { const h = H.cyl(rTop, rBottom, len, 7).color(color).pbr(0.75).far(); h.tag = tag; return h; };

function buildTorso(B) {
  const { P, st, C, sk, sp } = B;
  const T = P.torso, cw = P.chestW / 2, cd = P.chestD / 2, ww = P.waistW / 2, wd = P.waistD / 2, hw = P.hipW / 2, sx = P.shoulderX;
  const k = T / 0.3, m = st.muscle, gut = st.gut || 0, gaunt = st.gaunt || 0;
  const p = [], hard = [];
  const chestY = T - 0.118 * k;
  const mb = lerp(0.03, 0.008, m);                   // how crisply muscle groups stand apart
  const groove = (a, b, r = 0.005, depth = 0.003) => S.capsule(a, b, r * k).color(C.line).paint(0.006, -depth * (0.4 + m));
  // rib cage, shoulder yoke, belly, pelvis
  p.push(sk(S.ellipsoid(cw * 0.96, 0.126 * k, cd * 0.96).at(0, chestY, 0)));
  p.push(sk(S.capsule([-(sx - 0.05), T - 0.048, -0.006], [sx - 0.05, T - 0.048, -0.006], 0.034 * k * (0.9 + 0.2 * m)).blend(0.035)));
  p.push(sk(S.ellipsoid(ww * (1 - 0.1 * gaunt), 0.1 * k, wd * (1 - 0.18 * gaunt)).at(0, 0.115 * k, 0.004).blend(0.04)));
  p.push(sk(S.ellipsoid(hw, 0.078, wd * 1.08).at(0, 0.002, -0.002).blend(0.04)));
  p.push(sk(S.ellipsoid(0.05, 0.045, 0.048).at(0, -0.052, 0.008).blend(0.04)));                         // groin fills the gap between the thighs
  p.push(...S.mirrorX([
    sk(S.capsule([cw * 0.84, T - 0.17 * k, 0], [ww * 0.93, 0.065 * k, 0.002], 0.038 * k, 0.033 * k).blend(0.035)),                     // flank: ribs down to the hip
    sk(S.capsule([0.014, T + 0.012, -0.016], [sx - 0.065, T - 0.026, -0.012], 0.024 * k * (0.8 + 0.4 * m), 0.019 * k).blend(0.03)),      // trapezius
    sk(S.ellipsoid(0.056 * (hw / 0.1125), 0.058, 0.05).at(hw * 0.46, -0.022, -wd * 0.66).blend(0.02)),                                 // glutes
    // back: lats flaring from the waist to the armpit, shoulder blades, the two columns beside the spine
    sk(S.ellipsoid(cw * 0.42, 0.105 * k, cd * (0.34 + 0.1 * m)).rot(0, 0, -12).at(cw * 0.6, T - 0.16 * k, -cd * 0.5).blend(mb + 0.012)),
    sk(S.ellipsoid(0.04 * k, 0.05 * k, 0.013 * k).rot(0, 0, 14).at(cw * 0.5, T - 0.085 * k, -cd * 0.84).blend(mb + 0.012)),
    sk(S.capsule([0.024 * k, T - 0.09 * k, -cd * (0.8 + 0.04 * m)], [0.026 * k, 0.045, -wd * (0.82 + 0.04 * m)], 0.021 * k, 0.019 * k).blend(mb + 0.006)),
  ]));
  // chest
  if (st.female) {
    p.push(...S.mirrorX([sk(S.ellipsoid(cw * 0.42, 0.045 * k, cd * 0.5).at(cw * 0.44, T - 0.11 * k, cd * 0.62).blend(0.022))]));
  } else {
    const sag = gut > 0.6 ? 0.02 : 0;
    p.push(...S.mirrorX([
      sk(S.ellipsoid(cw * 0.5, (0.05 + sag) * k, cd * 0.4 * (0.4 + 0.7 * m + sag * 14)).rot(0, 0, 12).at(cw * 0.48, T - (0.094 + sag) * k, cd * (0.54 + 0.14 * m + sag * 4)).blend(mb + 0.002)),
      groove([0.012, T - (0.146 + sag) * k, cd * 1.02], [cw * 0.78, T - (0.128 + sag) * k, cd * 0.72], 0.005, 0.003),              // under the pectoral
    ]));
    p.push(groove([0, T - 0.05 * k, cd * 0.96], [0, T - 0.15 * k, cd * 1.02], 0.006, 0.0032));                                     // breastbone
  }
  // abdomen
  if (gut > 0.05) {
    p.push(sk(S.ellipsoid(ww * (0.86 + 0.2 * gut), 0.1 * k * (0.9 + 0.45 * gut), wd * (0.8 + 0.5 * gut)).at(0, 0.1 * k, wd * (0.2 + 0.42 * gut)).blend(0.045)));
    if (gut > 0.6) p.push(...S.mirrorX([sk(S.ellipsoid(ww * 0.5, 0.07 * k, wd * 0.6).at(ww * 0.62, 0.07 * k, wd * 0.1).blend(0.04))])); // love handles
  }
  if (m > 0.4 && gut < 0.5 && !gaunt) {
    // stomach muscles: three bands split down the middle, with the serrated muscles over the ribs beside them
    const az = wd * (0.84 + 0.2 * gut), aw = Math.min(0.052 * k, ww * 0.54);
    for (let i = 0; i < 3; i++) p.push(sk(S.ellipsoid(aw * (1 - i * 0.08), 0.019 * k, 0.019 * k).at(0, (0.198 - i * 0.043) * k, az - i * 0.002).blend(mb * 0.8)));
    p.push(groove([0, 0.222 * k, az + 0.014], [0, 0.1 * k, az + 0.012], 0.006, 0.0036));
    if (m > 0.7) for (let i = 0; i < 3; i++) p.push(...S.mirrorX([S.capsule([cw * 0.6, T - (0.165 + i * 0.03) * k, cd * 0.74], [cw * 0.84, T - (0.185 + i * 0.03) * k, cd * 0.42], 0.008 * k).color(C.skin).paint(0.006, 0.0035)]));
  }
  if (gaunt) {
    // ribs show through, the belly is hollow, the spine stands out
    for (let i = 0; i < 4; i++) p.push(...S.mirrorX([S.capsule([0.02, chestY + 0.03 - i * 0.03, cd * 0.95], [cw * 0.86, chestY - 0.005 - i * 0.034, cd * 0.4], 0.008).color(C.light).paint(0.007, 0.0045)]));
    for (let i = 0; i < 6; i++) p.push(S.sphere(0.013).at(0, T - 0.03 - i * 0.047 * k, -cd * (0.98 - 0.05 * i) - 0.004).color(C.light).paint(0.006, 0.005));
  } else {
    p.push(groove([0, T - 0.04, -cd * 1.0], [0, 0.05, -wd * 1.0], 0.007, 0.004));                                                  // spine furrow
  }
  // collar bones
  p.push(...S.mirrorX([S.capsule([0.016, T - 0.03, cd * 0.62], [sx - 0.05, T - 0.014, 0.014], 0.007).color(C.light).paint(0.006, 0.0035)]));
  // neck
  const nr = P.rNeck;
  p.push(sk(S.capsule([0, T - 0.03, -0.012], [0, T + P.neck + 0.035, 0.002], nr * 1.14, nr).blend(0.03)));
  // navel, nipples
  if (!st.female) {
    p.push(S.sphere(0.008 * k).at(0, 0.088 * k, wd * (1 + 1.1 * gut) + 0.002).color(C.deep).paint(0.004, -0.004));
    p.push(...S.mirrorX([S.sphere(0.0075 * k).at(cw * 0.5, T - 0.105 * k, cd * 0.98 + 0.004).color(tone(C.lip, 0, -0.05, 0.04)).paint(0.004, 0)]));
  }
  // joint cover balls
  p.push(...S.mirrorX([
    sk(S.ellipsoid(P.rUpper * 0.98, P.rUpper * 0.8, P.rUpper * 0.98).at(sx, T - 0.024, 0).blend(0.025)),
    sk(S.sphere(P.rThigh * 1.02).at(P.hipX, -0.012, 0).blend(0.03)),
  ]));
  // hunched species carry a rounded upper back
  if (P.hunch > 14) p.push(sk(S.ellipsoid(cw * 0.8, 0.09 * k, cd * 0.6).at(0, T - 0.07 * k, -cd * 0.62).blend(0.045)));

  // ---- species ----
  const rr = rng(hashStr((B.def.id || sp) + ':body'));
  const backZ = (y) => -cd * 0.98 - (P.hunch > 14 ? cd * 0.25 : 0) * clamp((y - T * 0.5) / (T * 0.4));
  if (sp === 'goblin' || sp === 'hobgoblin' || sp === 'troll' || sp === 'ogre') {
    // blotchy hide: darker patches over the shoulders and back
    const dark = tone(C.skin, sp === 'ogre' ? 0.01 : -0.02, 0.02, sp === 'ogre' ? -0.05 : -0.09);
    for (let i = 0; i < 9; i++) p.push(S.sphere(0.022 * k + rr() * 0.02).at((rr() - 0.5) * cw * 2.2, T - 0.02 - rr() * T * 0.6, -cd * (0.5 + rr() * 0.5)).color(dark).paint(0.012, 0));
  }
  if (sp === 'hobgoblin') {
    // war paint over the shoulders and a scar across the chest
    const war = 0x6e1c14;
    p.push(...S.mirrorX([stroke(sx - 0.05, T - 0.035, 0.02, 0.012, 0.05, 0.1, 0, 20).color(war).pbr(0.85).paint(0.004, 0)]));
    p.push(stroke(cw * 0.25, T - 0.12 * k, cd * 0.9, 0.07, 0.0045, 0.06, 0, -32).color(tone(C.skin, -0.02, -0.05, 0.12)).paint(0.003, 0.0012));
  }
  if (sp === 'troll') {
    // knobbly back: stony lumps along the spine and shoulders, moss in the hollows, warts
    const stone = tone(C.skin, 0, -0.05, -0.05);
    for (let i = 0; i < 5; i++) { const y = T - 0.02 - i * 0.058 * k - rr() * 0.012; p.push(sk(S.ellipsoid((0.02 + rr() * 0.014) * k, (0.018 + rr() * 0.008) * k, 0.011 * k).rot(rr() * 30 - 15, 0, rr() * 50 - 25).at((rr() - 0.5) * 0.02, y, backZ(y) - 0.002).blend(0.02)).color(stone)); }
    p.push(...S.mirrorX([sk(S.ellipsoid(0.034, 0.022, 0.03).rot(0, 0, -24).at(sx - 0.075, T - 0.006, -cd * 0.55).blend(0.02)).color(stone), sk(S.ellipsoid(0.024, 0.018, 0.022).at(sx - 0.115, T - 0.03, -cd * 0.9).blend(0.02)).color(stone)]));
    const moss = 0x4f6a2e;
    for (let i = 0; i < 6; i++) p.push(S.sphere(0.02 + rr() * 0.018).at((rr() - 0.5) * cw * 2, T - 0.03 - rr() * T * 0.4, -cd * (0.6 + rr() * 0.4)).color(moss).pbr(0.95).paint(0.014, 0));
    for (let i = 0; i < 7; i++) { const a = rr() * 6.28, y = T * (0.3 + rr() * 0.6); p.push(S.sphere(0.008 + rr() * 0.005).at(Math.cos(a) * cw * 0.95, y, Math.sin(a) * cd * 0.95).color(tone(C.skin, 0, 0.02, -0.1)).paint(0.004, 0.004)); }
  }
  if (sp === 'ogre') {
    // folds of fat: rolls at the back of the neck, a crease under the chest and under the overhang of the gut
    const fold = (a, b, r) => S.capsule(a, b, r).color(tone(C.skin, -0.01, 0.02, -0.16)).paint(0.008, -0.004);
    p.push(fold([-cw * 0.62, T - 0.17 * k, cd * 0.6], [cw * 0.62, T - 0.17 * k, cd * 0.6], 0.006 * k));
    p.push(...S.mirrorX([fold([0.02, 0.03 * k, wd * 1.25], [ww * 0.95, 0.07 * k, wd * 0.5], 0.007 * k), fold([0.02, T + 0.005, -cd * 0.75], [cw * 0.5, T - 0.01, -cd * 0.7], 0.005 * k)]));
    p.push(...S.mirrorX([S.ellipsoid(cw * 0.42, 0.05 * k, cd * 0.4).at(cw * 0.46, T - 0.12 * k, cd * 0.86).color(tone(C.skin, 0, 0, 0.06)).paint(0.03, 0)]));   // light on the slabs of the chest
    // old scar across the gut, a patch of chest hair
    p.push(stroke(-ww * 0.2, 0.15 * k, wd * 1.5, 0.085, 0.005, 0.2, 0, 24).color(tone(C.skin, -0.02, -0.08, 0.1)).paint(0.004, 0.0015));
    p.push(S.ellipsoid(cw * 0.45, 0.04 * k, 0.06).at(0, T - 0.085 * k, cd * 0.95).color(tone(C.skin, -0.01, -0.1, -0.22)).paint(0.02, 0));
  }
  if (sp === 'cyclops') {
    p.push(stroke(cw * 0.3, T - 0.1 * k, cd * 0.92, 0.075, 0.0045, 0.08, 0, 38).color(tone(C.skin, -0.02, -0.08, 0.1)).paint(0.003, 0.0012));
    p.push(stroke(cw * 0.42, T - 0.115 * k, cd * 0.92, 0.06, 0.004, 0.08, 0, 42).color(tone(C.skin, -0.02, -0.08, 0.1)).paint(0.003, 0.0012));
  }
  if (sp === 'ghoul') {
    // rot: livid blotches, dark veins creeping up the neck
    for (let i = 0; i < 7; i++) p.push(S.sphere(0.018 + rr() * 0.02).at((rr() - 0.5) * cw * 2, rr() * T, (rr() - 0.5) * cd * 2.2).color(i % 2 ? 0x5a5a6e : 0x6e7a52).paint(0.014, 0));
    p.push(...S.mirrorX([S.capsule([nr * 0.7, T + 0.03, 0.01], [cw * 0.5, T - 0.07, cd * 0.7], 0.004).color(0x3c4250).paint(0.004, 0.001)]));
  }
  if (sp === 'minotaur') {
    // shaggy mane over the neck, shoulders and down the spine; coarse fur over the hips
    const fur = B.fur;
    p.push(fur(S.ellipsoid(nr * 1.45, 0.075 * k, nr * 1.45).at(0, T + 0.03, -0.014).blend(0.025), 0.012));
    for (let i = 0; i < 4; i++) for (const s of i ? [1, -1] : [1]) {                                                     // overlapping tufts falling from the neck over the shoulder blades
      const x = s * i * cw * 0.3, y0 = T + 0.02 - i * 0.012, z0 = -cd * (0.5 + 0.12 * i);
      p.push(fur(bone([x, y0, z0], [x * 1.25, y0 - (0.13 - i * 0.012) * k, -cd * (1.02 - i * 0.1)], 0.034 * k, 0.014 * k).blend(0.014), 0.011));
    }
    for (let i = 0; i < 3; i++) p.push(fur(bone([0, T - 0.1 * k - i * 0.05 * k, -cd * 0.9], [0, T - 0.17 * k - i * 0.05 * k, -cd * 1.04 + i * 0.01], 0.026 * k, 0.01 * k).blend(0.012), 0.01));   // crest down the spine
    p.push(...S.mirrorX([fur(S.ellipsoid(0.05 * k, 0.04 * k, 0.055 * k).at(sx - 0.045, T - 0.004, -0.014).blend(0.022), 0.011)]));
    p.push(fur(S.ellipsoid(cw * 0.26, 0.06 * k, 0.026).at(0, T - 0.1 * k, cd * 0.9).blend(0.016), 0.008));               // chest tuft
    p.push(fur(S.ellipsoid(hw * 1.05, 0.08, wd * 1.16).at(0, -0.012, -0.002).blend(0.03), 0.009));
    p.push(S.ellipsoid(cw * 0.7, 0.13 * k, 0.05).at(0, 0.16 * k, wd * 0.98).color(C.light).paint(0.04, 0));               // paler belly
    p.push(...S.mirrorX([S.ellipsoid(cw * 0.36, 0.035 * k, cd * 0.4).rot(0, 0, 12).at(cw * 0.48, T - 0.08 * k, cd * 0.86).color(C.sheen).paint(0.03, 0)]));   // light on the chest
  }
  if (sp === 'demon' || sp === 'imp') {
    const big = sp === 'demon';
    // a ridge of spines down the back
    const n = big ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const y = T - 0.02 - i * (T * 0.8 / n), base = hit(p, [0, y, -0.5], [0, 0, 1]);
      hard.push(spike(add3(base, [0, 0, 0.012]), [0, 0.35, -1], (big ? 0.075 : 0.035) * k * (1 - i * 0.1), (big ? 0.016 : 0.009) * k, C.horn, [0, -1, 0], 0.25));
    }
    if (big) {
      // bony spurs on the shoulders, darker mottling
      hard.push(...H.mirrorX([spike([sx - 0.035, T + 0.012, -0.012], [0.5, 1, -0.25], 0.085 * k, 0.02 * k, C.horn, [1, 0, 0], 0.3), spike([sx - 0.075, T + 0.02, -0.02], [0.2, 1, -0.3], 0.055 * k, 0.015 * k, C.horn, [1, 0, 0], 0.3)]));
      for (let i = 0; i < 8; i++) p.push(S.sphere(0.02 + rr() * 0.02).at((rr() - 0.5) * cw * 2.2, T * (0.2 + rr() * 0.8), -cd * (0.3 + rr() * 0.7)).color(tone(C.skin, 0, 0, -0.07)).paint(0.014, 0));
      p.push(S.ellipsoid(cw * 0.7, 0.16 * k, 0.05).at(0, 0.17 * k, wd * 0.95).color(C.light).paint(0.04, 0));         // paler belly
    }
    if (B.lord) {
      // the lord burns from within: branching fissures glow across chest, belly, flanks and back
      const crack = (a, b) => S.capsule(a, b, 0.0055 * k).color(C.ember).glow(1.7).pbr(0.6).paint(0.004, 0);
      const fissure = (from, dir, n, len) => {
        let q = from, d = dir;
        for (let i = 0; i < n; i++) {
          const nx = hit(p, add3(q, [d[0] * len + (rr() - 0.5) * len * 0.9, d[1] * len + (rr() - 0.5) * len * 0.5, d[2] > 0 ? 0.3 : -0.3]), [0, 0, d[2] > 0 ? -1 : 1], 12);
          cracks.push(crack(q, nx));
          if (i === 1 || i === 3) { const br = hit(p, add3(q, [-d[0] * len * 0.7 + (rr() - 0.5) * len, d[1] * len * 0.8, d[2] > 0 ? 0.3 : -0.3]), [0, 0, d[2] > 0 ? -1 : 1], 12); cracks.push(crack(q, br)); }
          q = nx;
        }
      };
      const cracks = [];
      for (const s of [1, -1]) {
        fissure(hit(p, [s * 0.012, T - 0.08 * k, 0.4], [0, 0, -1]), [s * 0.5, -0.85, 1], 5, 0.045 * k);
        fissure(hit(p, [s * cw * 0.5, T - 0.16 * k, 0.4], [0, 0, -1]), [s * 0.2, -1, 1], 4, 0.04 * k);
        fissure(hit(p, [s * 0.02, T - 0.06 * k, -0.4], [0, 0, 1]), [s * 0.6, -0.8, -1], 4, 0.05 * k);
      }
      p.push(...cracks);
    }
  }
  if (sp === 'harpy') {
    // plumage: a feathered bodice and a skirt of feathers over the hips
    const pl = B.plume;
    p.push(pl(S.ellipsoid(cw * 1.04, 0.092 * k, cd * 1.1).at(0, chestY + 0.012, 0.002).blend(0.012)));
    p.push(...S.mirrorX([pl(S.ellipsoid(cw * 0.44, 0.05 * k, cd * 0.54).at(cw * 0.44, T - 0.112 * k, cd * 0.64).blend(0.016))]));
    p.push(pl(S.ellipsoid(hw * 1.08, 0.085, wd * 1.2).at(0, -0.008, -0.004).blend(0.014)));
    p.push(pl(S.ellipsoid(0.055, 0.05, 0.052).at(0, -0.055, 0.008).blend(0.03)));
    p.push(...S.mirrorX([pl(S.sphere(P.rThigh * 1.08).at(P.hipX, -0.012, 0).blend(0.02))]));
    // ruff of longer feathers at the collar
    const cols = B.featherCols;
    for (let i = -3; i <= 3; i++) hard.push(feather([i * cw * 0.26, T - 0.045, cd * (0.9 - Math.abs(i) * 0.12)], [i * 0.12, -1, 0.25], 0.07, 0.034, [i * 0.2, 0.3, 1], cols, 1));
  }
  if (sp === 'orc') {
    // slabs of muscle piled on the neck and shoulders, a mottled back, old scars
    const dark = tone(C.skin, -0.015, 0.02, -0.08), scar = tone(C.skin, -0.02, -0.08, 0.13);
    p.push(...S.mirrorX([sk(S.ellipsoid(0.075 * k, 0.05 * k, 0.062 * k).rot(0, 0, -22).at(sx * 0.42, T + 0.012, -0.022).blend(0.03))]));
    p.push(sk(S.ellipsoid(cw * 0.62, 0.07 * k, cd * 0.5).at(0, T - 0.03 * k, -cd * 0.66).blend(0.04)));
    for (let i = 0; i < 11; i++) p.push(S.sphere(0.026 * k + rr() * 0.024).at((rr() - 0.5) * cw * 2.2, T - 0.02 - rr() * T * 0.65, -cd * (0.4 + rr() * 0.6)).color(dark).paint(0.014, 0));
    p.push(stroke(-cw * 0.3, T - 0.11 * k, cd * 0.92, 0.085, 0.005, 0.08, 0, 28).color(scar).paint(0.003, 0.0013));
    p.push(stroke(cw * 0.26, 0.15 * k, wd * 0.95, 0.05, 0.0045, 0.08, 0, -38).color(scar).paint(0.003, 0.0013));
    p.push(stroke(cw * 0.4, T - 0.07 * k, -cd * 0.9, 0.09, 0.005, 0.08, 0, -50).color(scar).paint(0.003, 0.0013));
  }
  if (sp === 'lizard') {
    // pale plated belly from throat to groin, darker bands over the back, a row of spines down the spine
    const dark = tone(C.skin, -0.02, 0.03, -0.11), seam = tone(C.light, 0, 0.02, -0.2);
    p.push(S.ellipsoid(cw * 0.62, T * 0.56, 0.07).at(0, T * 0.46, wd * 1.0).color(C.light).pbr(0.6).paint(0.02, 0));
    p.push(S.ellipsoid(nr * 0.9, 0.07, 0.04).at(0, T + 0.02, nr * 0.8).color(C.light).paint(0.02, 0));
    for (let i = 0; i < 7; i++) { const y = T - 0.06 * k - i * 0.034 * k; p.push(S.box(cw * 1.0, 0.007, 0.2, 0).at(0, y, wd + 0.06).color(seam).paint(0.003, -0.003)); }
    for (let i = 0; i < 5; i++) p.push(...S.mirrorX([S.ellipsoid(cw * 0.8, 0.016 * k, cd * 1.2).rot(0, 0, -16).at(cw * 0.5, T - 0.03 - i * 0.058 * k, -cd * 0.5).color(dark).paint(0.012, 0)]));
    for (let i = 0; i < 6; i++) {
      const y = T + 0.01 - i * (T * 0.86 / 6), base = hit(p, [0, y, -0.5], [0, 0, 1]);
      hard.push(spike(add3(base, [0, 0, 0.014]), [0, 0.5, -1], 0.062 * k * (1 - i * 0.1), 0.015 * k, C.crest, [0, -1, 0], 0.25).lod(2));
    }
  }
  if (sp === 'rat') {
    // paler belly, a ridge of coarse dark fur over the hump of the back
    const fur = B.fur;
    p.push(S.ellipsoid(cw * 0.66, T * 0.5, 0.06).at(0, T * 0.46, wd * 0.98).color(C.light).paint(0.04, 0));
    for (let i = 0; i < 5; i++) p.push(fur(bone([0, T + 0.02 - i * 0.05 * k, backZ(T - i * 0.05 * k) + 0.012], [0, T - 0.04 - i * 0.05 * k, backZ(T - 0.06 - i * 0.05 * k) - 0.012], 0.03 * k, 0.012 * k).blend(0.014), 0.011));
    p.push(...S.mirrorX([fur(S.ellipsoid(0.04 * k, 0.03 * k, 0.045 * k).at(sx - 0.03, T - 0.004, -0.016).blend(0.022), 0.01)]));
    for (let i = 0; i < 3; i++) { const a = rr() * 6.28; p.push(S.sphere(0.014 + rr() * 0.012).at(Math.cos(a) * cw * 0.9, T * (0.3 + rr() * 0.5), Math.sin(a) * cd * 0.9).color(mix(C.skin, C.pink, 0.55)).paint(0.008, -0.0015)); }   // mange
  }
  if (sp === 'goat') {
    // a filthy matted pelt: mane over the neck and shoulders, a mat of it on the chest, shaggy hips
    const fur = B.fur, filth = mix(C.fur, 0x2a2418, 0.5);
    p.push(fur(S.ellipsoid(nr * 1.4, 0.07 * k, nr * 1.4).at(0, T + 0.03, -0.014).blend(0.025), 0.012));
    for (let i = 0; i < 4; i++) for (const s of i ? [1, -1] : [1]) {
      const x = s * i * cw * 0.3, y0 = T + 0.02 - i * 0.012, z0 = -cd * (0.5 + 0.12 * i);
      p.push(fur(bone([x, y0, z0], [x * 1.25, y0 - (0.14 - i * 0.012) * k, -cd * (1.04 - i * 0.1)], 0.036 * k, 0.014 * k).blend(0.014), 0.012));
    }
    p.push(...S.mirrorX([fur(S.ellipsoid(0.058 * k, 0.046 * k, 0.062 * k).at(sx - 0.04, T - 0.002, -0.012).blend(0.022), 0.012)]));
    for (let i = -1; i <= 1; i++) p.push(fur(bone([i * cw * 0.3, T - 0.04 * k, cd * (0.82 - Math.abs(i) * 0.1)], [i * cw * 0.22, T - (0.2 - Math.abs(i) * 0.04) * k, cd * (1.0 - Math.abs(i) * 0.08)], 0.04 * k, 0.014 * k).blend(0.016), 0.011));
    p.push(fur(S.ellipsoid(hw * 1.06, 0.085, wd * 1.18).at(0, -0.012, -0.002).blend(0.03), 0.01));
    p.push(S.ellipsoid(cw * 0.6, 0.12 * k, 0.05).at(0, 0.15 * k, wd * 0.98).color(C.light).paint(0.04, 0));
    for (let i = 0; i < 6; i++) p.push(S.sphere(0.02 + rr() * 0.02).at((rr() - 0.5) * cw * 2, T * (0.5 + rr() * 0.55), (rr() - 0.5) * cd * 2.4).color(filth).pbr(0.95).paint(0.014, 0));
  }
  if (sp === 'tiger') {
    // white from the throat down the chest and belly, black stripes wrapping in from the spine
    const white = (x) => x.color(C.pale).pbr(0.85).paint(0.03, 0), stripe = (x) => x.color(C.stripe).pbr(0.85).paint(0.0035, 0);
    p.push(white(S.ellipsoid(cw * 0.6, T * 0.58, 0.075).at(0, T * 0.46, wd * 1.02)));
    p.push(white(S.ellipsoid(nr * 1.0, 0.08, 0.05).at(0, T + 0.02, nr * 0.8)));
    p.push(B.fur(S.ellipsoid(cw * 0.34, 0.05 * k, 0.03).at(0, T - 0.07 * k, cd * 0.92).blend(0.02), 0.009).color(C.pale));          // ruff of the chest
    for (let i = 0; i < 7; i++) {
      const y = T - 0.012 - i * 0.047 * k, w = i < 2 ? 1 : 0.86;
      p.push(...S.mirrorX([stripe(S.ellipsoid(cw * 0.78 * w, (0.0085 + (i % 2) * 0.003) * k, cd * 1.3).rot(0, 0, -15 - (i % 3) * 4).at(cw * 0.62 * w, y, -cd * 0.52))]));
      if (i % 2) p.push(...S.mirrorX([stripe(S.ellipsoid(cw * 0.26, 0.007 * k, cd * 0.5).rot(0, 0, 12).at(cw * 0.86 * w, y + 0.022 * k, cd * 0.2))]));
    }
    p.push(stripe(S.capsule([0, T + 0.02, -cd * 0.9], [0, 0.0, -wd * 0.95], 0.012 * k)));
  }
  if (sp === 'mummy') {
    // bands wound every which way: their edges show as creases, with gaps where the dried flesh shows through
    const edge = tone(C.skin, 0, 0, -0.22), flesh = (x, raise = -0.0045) => x.color(C.flesh).pbr(0.85).tint(0.2, 40).paint(0.004, raise);
    for (let i = 0; i < 8; i++) p.push(S.cyl(0.4, 0.0045, 0).rot(rr() * 30 - 15, 0, rr() * 44 - 22).at(0, T * (0.04 + i * 0.125), 0).color(edge).paint(0.003, -0.003));
    for (const s of [1, -1]) p.push(S.box(0.07 * k, T * 1.5, 0.5, 0).rot(0, 0, s * 38).at(0, T * 0.52, 0).color(tone(C.skin, 0, 0, 0.03)).paint(0.004, 0.003));            // two broad bands crossed over the chest
    p.push(flesh(S.ellipsoid(cw * 0.4, 0.016 * k, 0.07).rot(0, 0, 14).at(cw * 0.36, T - 0.15 * k, cd * 0.86)));
    p.push(flesh(S.ellipsoid(ww * 0.6, 0.02 * k, 0.07).rot(0, 0, -10).at(-ww * 0.3, 0.13 * k, wd * 0.9)));
    p.push(flesh(S.ellipsoid(cw * 0.5, 0.018 * k, 0.07).rot(0, 0, -18).at(-cw * 0.3, T - 0.1 * k, -cd * 0.9)));
    p.push(flesh(S.sphere(0.024 * k).at(cw * 0.8, T * 0.45, 0.01), -0.006));
    for (let i = 0; i < 5; i++) p.push(S.sphere(0.03 + rr() * 0.03).at((rr() - 0.5) * cw * 2, rr() * T, (rr() - 0.5) * cd * 2.2).color(tone(C.skin, -0.02, 0.06, -0.12)).paint(0.02, 0));   // stains
    p.push(S.cyl(hw * 1.9, 0.14, 0.02).at(0, -0.02, 0).color(tone(C.skin, 0, 0.02, -0.07)).pbr(0.95).paint(0.004, 0.002));                                             // the hips bound in a broader, darker cloth
    const strip = (w, len, at, rot) => H.box(w, len, 0.0024, 0.0008).at(0, -len / 2, 0).rot(rot[0], rot[1], rot[2]).at(at[0], at[1], at[2]).color(tone(C.skin, 0, 0, -0.07)).pbr(0.95).lod(1);
    hard.push(strip(0.026, 0.1, [-ww * 0.7, 0.07, wd * 0.9], [8, 0, -6]), strip(0.022, 0.13, [cw * 0.5, T - 0.2 * k, -cd * 0.95], [-10, 0, 8]), strip(0.02, 0.075, [ww * 0.96, 0.1, 0], [0, 0, 14]));
  }
  if (sp === 'dwarf') {
    // barrel chest thick with hair
    p.push(S.ellipsoid(cw * 0.5, 0.07 * k, 0.06).at(0, T - 0.1 * k, cd * 0.95).color(mix(C.skin, B.face.hairCol ?? 0x5a3d24, 0.45)).paint(0.03, 0));
  }
  // smallclothes: a wrap around the hips so nobody is ever naked
  if (!st.noWrap) {
    p.push(S.cyl(hw * 1.9, 0.135, 0.02).at(0, -0.022, 0).color(C.linen).tint(0.1, 60).pbr(0.92).paint(0.004, 0));
    p.push(S.cyl(hw * 1.3, 0.016, 0.004).at(0, 0.04, 0).color(tone(C.linen, 0, 0, -0.12)).pbr(0.9).paint(0.003, 0.004));
  }
  return { prims: p, hard };
}

/** what a species wears on its own hide along a limb (stripes, bandage edges, bands of darker scale): `part` is arm | fore | leg | shin */
function limbDeco(B, part, p, hard, L, r) {
  const { sp, C, def } = B;
  if (sp === 'tiger') {
    const n = part === 'leg' ? 4 : 3;
    for (let i = 0; i < n; i++) p.push(S.ellipsoid(r * 1.5, Math.max(0.006, r * 0.13), r * 1.8).rot(i % 2 ? 12 : -10, 0, i % 2 ? -9 : 10).at(r * 0.55, -L * (0.16 + (0.76 / n) * i), -r * 0.2).color(C.stripe).pbr(0.85).paint(0.0035, 0));
    if (part === 'leg' || part === 'arm') p.push(S.ellipsoid(r * 0.6, L * 0.4, r * 0.9).at(-r * 0.8, -L * 0.55, 0).color(C.pale).paint(0.02, 0));       // pale inside of the limb
  } else if (sp === 'mummy') {
    const rr = rng(hashStr((def.id || sp) + ':' + part)), edge = tone(C.skin, 0, 0, -0.22);
    for (let i = 0; i < 4; i++) p.push(S.cyl(r * 3, 0.004, 0).rot(rr() * 40 - 20, 0, rr() * 50 - 25).at(0, -L * (0.12 + i * 0.24), 0).color(edge).paint(0.0025, -0.0028));
    const a = rr() * 6.28;
    p.push(S.ellipsoid(r * 0.9, Math.max(0.008, L * 0.07), r * 0.9).rot(0, 0, rr() * 40 - 20).at(Math.cos(a) * r * 0.8, -L * (0.3 + rr() * 0.4), Math.sin(a) * r * 0.8).color(C.flesh).pbr(0.85).paint(0.003, -0.004));
    if (part === 'fore') hard.push(H.box(r * 0.62, L * 0.34, 0.002, 0.0006).at(0, -L * 0.17, 0).rot(-14 - rr() * 10, 0, rr() * 16 - 8).at(r * 0.2, -L * (0.5 + rr() * 0.2), -r * 0.9).color(tone(C.skin, 0, 0, -0.07)).pbr(0.95).lod(1));
  } else if (sp === 'lizard') {
    const dark = tone(C.skin, -0.02, 0.03, -0.11);
    for (let i = 0; i < 3; i++) p.push(S.ellipsoid(r * 1.4, Math.max(0.008, L * 0.07), r * 1.7).at(r * 0.5, -L * (0.2 + i * 0.28), -r * 0.2).color(dark).paint(0.008, 0));
    p.push(S.ellipsoid(r * 0.6, L * 0.42, r * 0.8).at(-r * 0.8, -L * 0.5, r * 0.2).color(C.light).paint(0.02, 0));
    if (part === 'arm') hard.push(spike([0, -L + r * 0.1, -r * 0.8], [0, 0.3, -1], r * 1.1, r * 0.3, C.claw, [0, 1, 0], 0.3));
  } else if (sp === 'rat') {
    if (part === 'arm' || part === 'leg') p.push(S.ellipsoid(r * 0.6, L * 0.4, r * 0.8).at(-r * 0.8, -L * 0.5, r * 0.2).color(C.light).paint(0.02, 0));
  } else if (sp === 'goat') {
    if (part === 'arm') p.push(B.fur(S.ellipsoid(r * 1.2, r * 1.05, r * 1.2).at(r * 0.15, -r * 0.15, -r * 0.1).blend(0.03), 0.011), B.fur(bone([r * 0.2, -r * 0.4, -r * 0.5], [r * 0.3, -L * 0.6, -r * 0.8], r * 0.7, r * 0.2).blend(0.016), 0.011));
    if (part === 'fore') p.push(B.fur(bone([r * 0.3, -L * 0.05, -r * 0.5], [r * 0.2, -L * 0.6, -r * 0.6], r * 0.6, r * 0.16).blend(0.014), 0.01));
    if (part === 'leg') p.push(B.fur(S.ellipsoid(r * 1.12, L * 0.5, r * 1.1).at(0, -L * 0.4, -r * 0.05).blend(0.03), 0.011), B.fur(bone([r * 0.4, -L * 0.5, -r * 0.5], [r * 0.5, -L * 1.02, -r * 0.6], r * 0.6, r * 0.2).blend(0.016), 0.012));
  } else if (sp === 'orc') {
    if (part === 'arm') p.push(stroke(r * 0.9, -L * 0.5, 0, 0.012, L * 0.2, r * 1.2, 0, 14).color(tone(C.skin, -0.02, -0.08, 0.13)).paint(0.003, 0.0012));
    if (part === 'fore') p.push(sk4(B, S.ellipsoid(r * 0.72, L * 0.3, r * 0.8).at(r * 0.3, -L * 0.3, r * 0.05).blend(0.016)));                    // a forearm like a ham
  } else if (sp === 'dwarf') {
    if (part === 'fore') p.push(S.ellipsoid(r * 0.9, L * 0.36, r * 0.9).at(r * 0.5, -L * 0.45, -r * 0.2).color(mix(C.skin, B.face.hairCol ?? 0x5a3d24, 0.4)).paint(0.02, 0));
  }
}
const sk4 = (B, x) => B.sk(x);
/** bare pink skin (rat), over a whole hand or foot */
const barePaint = (B, p, at, rad) => { if (B.C.pink) p.push(S.sphere(rad).at(at[0], at[1], at[2]).color(B.C.pink).pbr(0.6).paint(0.012, 0)); };

function buildArm(B) {
  const { P, st, C, sk, sp } = B;
  const U = P.upper, r = P.rUpper, m = st.muscle, mb = lerp(0.026, 0.009, m);
  const p = [], hard = [];
  p.push(sk(S.ellipsoid(r * 0.98, r * 0.82, r * 0.98)));                                                      // shoulder cap hides the seam
  p.push(sk(S.ellipsoid(r * (0.9 + 0.14 * m), r * 1.32, r * (0.98 + 0.1 * m)).at(r * 0.3, -r * 0.9, 0).blend(mb + 0.008)));    // deltoid
  p.push(sk(S.capsule([0, -r * 0.4, 0], [0, -U, 0], r * 0.92, r * 0.84).blend(0.025)));
  p.push(sk(S.ellipsoid(r * 0.66, U * 0.3, r * (0.56 + 0.3 * m)).at(-r * 0.08, -U * 0.56, r * 0.44).blend(mb)));        // biceps
  p.push(sk(S.ellipsoid(r * 0.66, U * 0.34, r * (0.54 + 0.22 * m)).at(r * 0.18, -U * 0.46, -r * 0.46).blend(mb)));      // triceps
  p.push(sk(S.sphere(r * 0.86).at(0, -U, 0).blend(0.02)));                                                              // elbow
  p.push(sk(S.sphere(r * 0.4).at(0, -U + r * 0.05, -r * 0.64).blend(0.014)));                                            // point of the elbow
  if (sp === 'minotaur') p.push(B.fur(S.ellipsoid(r * 1.2, r * 1.0, r * 1.2).at(r * 0.15, -r * 0.1, -r * 0.1).blend(0.03), 0.01), S.ellipsoid(r * 0.7, U * 0.26, r * 0.6).at(-r * 0.05, -U * 0.55, r * 0.6).color(C.sheen).paint(0.025, 0));
  if (sp === 'harpy') p.push(B.plume(S.ellipsoid(r * 1.25, r * 1.5, r * 1.25).at(r * 0.15, -r * 0.5, 0).blend(0.014)));
  if (sp === 'hobgoblin') p.push(S.cyl(r * 2, 0.016, 0.004).at(0, -U * 0.42, 0).color(0x6e1c14).pbr(0.85).paint(0.004, 0));     // war paint band
  if (sp === 'demon') hard.push(spike([0, -U + r * 0.1, -r * 0.8], [0, 0.35, -1], r * 1.5, r * 0.34, C.horn, [0, 1, 0], 0.3));   // elbow spur
  if (B.lord) p.push(S.capsule([r * 0.9, -r * 0.6, r * 0.5], [r * 0.6, -U * 0.5, r * 0.8], 0.005).color(C.ember).glow(1.7).paint(0.004, 0), S.capsule([r * 0.6, -U * 0.5, r * 0.8], [r * 0.9, -U * 0.8, r * 0.3], 0.005).color(C.ember).glow(1.7).paint(0.004, 0));
  if (sp === 'ghoul') p.push(S.capsule([-r * 0.3, -r, r * 0.8], [r * 0.1, -U * 0.9, r * 0.75], 0.004).color(0x3c4250).paint(0.004, 0.001));
  limbDeco(B, 'arm', p, hard, U, r);
  hard.push(core(r * 1.0, r * 0.84, U, sp === 'harpy' ? C.plume : sp === 'minotaur' ? C.fur : C.skin));
  return { prims: p, hard };
}

function buildForearm(B) {
  const { P, st, C, sk, sp } = B;
  const F = P.fore, r = P.rFore, rw = P.rWrist, m = st.muscle, mb = lerp(0.024, 0.012, m);
  const p = [], hard = [];
  p.push(sk(S.sphere(r * 0.98)));
  p.push(sk(S.capsule([0, 0, 0], [0, -F, 0], r * 0.9, rw).blend(0.025)));
  p.push(sk(S.ellipsoid(r * 0.6, F * 0.3, r * (0.62 + 0.18 * m)).at(r * 0.32, -F * 0.28, r * 0.1).blend(mb)));          // extensors
  p.push(sk(S.ellipsoid(r * 0.54, F * 0.28, r * 0.6).at(-r * 0.3, -F * 0.32, -r * 0.05).blend(mb)));                    // flexors
  p.push(sk(S.sphere(rw * 0.5).at(rw * 0.62, -F + rw * 0.25, -rw * 0.5).blend(0.01)));                               // wrist bone
  p.push(sk(S.sphere(rw * 1.0).at(0, -F, 0).blend(0.012)));                                                          // wrist ball hides the seam
  if (sp === 'demon') for (let i = 0; i < 3; i++) hard.push(spike([r * 0.75, -F * (0.2 + i * 0.22), -r * 0.35], [1, -0.5, -0.5], r * (1.1 - i * 0.2), r * 0.24, C.horn, [0, -1, 0], 0.3));
  if (C.scorch) p.push(S.capsule([0, -F * 0.55, 0], [0, -F * 1.3, 0], r * 1.8).color(C.scorch).paint(0.035, 0), S.capsule([0, -F * 0.85, 0], [0, -F * 1.3, 0], r * 1.8).color(C.scorch2).paint(0.03, 0));
  if (sp === 'minotaur') p.push(S.cyl(r * 2, F * 0.5, 0.004).at(0, -F * 0.3, 0).color(C.fur).paint(0.03, 0));
  if (sp === 'ghoul') p.push(S.capsule([r * 0.5, -F * 0.1, r * 0.6], [r * 0.2, -F * 0.9, rw * 0.9], 0.004).color(0x3c4250).paint(0.004, 0.001));
  limbDeco(B, 'fore', p, hard, F, r);
  hard.push(core(r * 0.96, rw * 1.0, F, C.skin));
  return { prims: p, hard };
}

/** nail (painted) or claw (hard) on the end of a finger or toe; back = the side the nail is on */
function fingertip(B, p, hard, a, b, r, back, big = 1) {
  const { st, C } = B;
  const u = norm3(sub3(b, a));
  if (st.claws > 0.3) {
    const len = r * (1.6 + 2.2 * st.claws) * big, base = add3(b, mul3(u, -r * 0.3));
    hard.push(spike(base, add3(u, mul3(back, 0.12)), len, r * 0.82, C.claw, mul3(back, -1), 0.32));
  } else {
    p.push(S.sphere(r * 0.95).at(...add3(add3(b, mul3(back, r * 0.75)), mul3(u, -r * 0.2))).color(C.nail).pbr(0.45).paint(0.0025, 0));
  }
}

/** open, relaxed hand hanging from the wrist at the origin (left hand: palm faces -X, thumb forward) */
function openHand(B) {
  const { P, st, sk } = B;
  const hr = P.handR, n = st.fingers, fr = hr * (n === 4 ? 0.175 : 0.225);
  const zs = n === 4 ? [0.57, 0.19, -0.19, -0.55] : [0.5, 0, -0.5];
  const ls = n === 4 ? [0.96, 1.06, 0.98, 0.78] : [1, 1.08, 0.9];
  const p = [], hard = [];
  p.push(sk(S.sphere(P.rWrist * 1.02)));
  p.push(sk(S.box(hr * 0.56, hr * 1.5, hr * 1.56, hr * 0.24).at(0, -hr * 0.98, 0).blend(0.014)));               // palm
  p.push(sk(S.ellipsoid(hr * 0.3, hr * 0.56, hr * 0.38).at(-hr * 0.16, -hr * 0.72, hr * 0.5).blend(0.012)));     // ball of the thumb
  const kY = -hr * 1.68;
  for (let i = 0; i < n; i++) {
    const z = zs[i] * hr, L = ls[i] * hr, rr = fr * (i === n - 1 ? 0.88 : 1);
    const curl = [16 + i * 3, 46 + i * 5, 70 + i * 6], seg = [0.56, 0.4, 0.33];
    let a = [0.02 * hr, kY, z];
    p.push(sk(S.sphere(rr * 1.1).at(hr * 0.1, kY + rr * 0.3, z).blend(0.004)));                                 // knuckle
    for (let j = 0; j < 3; j++) {
      const c = curl[j] * DEG, b = [a[0] - Math.sin(c) * L * seg[j], a[1] - Math.cos(c) * L * seg[j], z * (1 + 0.04 * (j + 1))];
      p.push(sk(S.capsule(a, b, rr * (1 - j * 0.08), rr * (0.92 - j * 0.08)).blend(j ? 0.0015 : 0.003)));
      if (j === 2) fingertip(B, p, hard, a, b, rr * 0.8, [1, 0, 0]);
      a = b;
    }
  }
  const t0 = [-hr * 0.1, -hr * 0.5, hr * 0.66], t1 = [-hr * 0.34, -hr * 1.12, hr * 1.02], t2 = [-hr * 0.52, -hr * 1.62, hr * 1.04];
  p.push(sk(S.capsule(t0, t1, fr * 1.22, fr * 1.1).blend(0.01)), sk(S.capsule(t1, t2, fr * 1.08, fr * 0.95).blend(0.004)));
  fingertip(B, p, hard, t1, t2, fr * 0.95, [0.5, 0, 0.86]);
  if (B.C.scorch) p.push(S.sphere(hr * 3).at(0, -hr, 0).color(B.C.scorch2).paint(0.02, 0));
  barePaint(B, p, [0, -hr * 1.5, 0], hr * 2.2);
  return { prims: p, hard };
}

/**
 * A fist closed around a shaft. Built in the WEAPON frame (shaft along +Y through the origin, knuckles toward +Z,
 * palm on the lateral +X side), then turned by `rot` and moved to `pos` in the hand node (origin at the wrist).
 */
function gripHand(B, gr, rot, pos) {
  const { P, st, sk } = B;
  const hr = P.handR, n = st.fingers, fr = hr * (n === 4 ? 0.18 : 0.235), pt = hr * 0.52;
  const ys = n === 4 ? [0.6, 0.2, -0.2, -0.6] : [0.5, 0, -0.5];
  const q = [], qh = [];
  const px = gr + pt * 0.5 - 0.002;
  q.push(sk(S.box(pt, hr * 1.62, hr * 1.5, hr * 0.22).at(px, 0, -hr * 0.12).blend(0.012)));                     // palm
  q.push(sk(S.ellipsoid(hr * 0.34, hr * 0.5, hr * 0.42).at(px - pt * 0.2, hr * 0.38, -hr * 0.62).blend(0.012))); // ball of the thumb
  const R = gr + fr * 0.92;
  const ring = (deg, y, k = 1) => [Math.cos(deg * DEG) * R * k, y, Math.sin(deg * DEG) * R * k];
  for (let i = 0; i < n; i++) {
    const y = ys[i] * hr, rr = fr * (i === n - 1 ? 0.9 : 1);
    const a0 = [px + pt * 0.15, y, hr * 0.5], a1 = ring(86, y, 1.12), a2 = ring(158, y * 0.98), a3 = ring(228, y * 0.96), a4 = ring(282, y * 0.95, 0.96);
    q.push(sk(S.sphere(rr * 1.15).at(a0[0], y, a0[2] + rr * 0.2).blend(0.004)));                                // knuckle
    q.push(sk(S.capsule(a0, a1, rr, rr).blend(0.003)), sk(S.capsule(a1, a2, rr, rr * 0.95).blend(0.0015)), sk(S.capsule(a2, a3, rr * 0.95, rr * 0.9).blend(0.0015)), sk(S.capsule(a3, a4, rr * 0.9, rr * 0.82).blend(0.0015)));
    fingertip(B, q, qh, a3, a4, rr * 0.78, [-0.9, 0, -0.4], 0.8);
  }
  // thumb crosses over the fingers on the medial side
  const t0 = [px - pt * 0.3, hr * 0.62, -hr * 0.55], t1 = [-R * 0.25, hr * 0.92, -R * 0.95], t2 = [-R * 0.98, hr * 0.9, R * 0.15];
  q.push(sk(S.capsule(t0, t1, fr * 1.25, fr * 1.12).blend(0.01)), sk(S.capsule(t1, t2, fr * 1.1, fr * 0.95).blend(0.004)));
  fingertip(B, q, qh, t1, t2, fr * 0.9, [0, 1, 0], 0.8);
  const place = (x) => x.rot(rot[0], rot[1], rot[2]).at(pos[0], pos[1], pos[2]);
  const p = [sk(S.sphere(P.rWrist * 1.02))];
  // heel of the hand joins the wrist to the palm
  const palm = new THREE.Vector3(px, 0, -hr * 0.35).applyEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
  p.push(sk(S.capsule([0, -P.rWrist * 0.2, 0], [pos[0] + palm.x, pos[1] + palm.y, pos[2] + palm.z], P.rWrist * 0.95, hr * 0.44).blend(0.014)));
  for (const x of q) p.push(place(x));
  if (B.C.scorch) p.push(S.sphere(hr * 3).at(pos[0], pos[1], pos[2]).color(B.C.scorch2).paint(0.02, 0));
  barePaint(B, p, [pos[0], pos[1] - hr * 0.3, pos[2]], hr * 2.2);
  return { prims: p, hard: qh.map(place) };
}

function buildLeg(B) {
  const { P, st, C, sk, sp } = B;
  const L = P.thigh, r = P.rThigh, rc = P.rCalf, m = st.muscle, mb = lerp(0.03, 0.012, m);
  const skin = sp === 'harpy' ? B.plume : sk;
  const p = [], hard = [];
  p.push(skin(S.sphere(r * 1.05)));
  p.push(skin(S.capsule([0, 0, 0], [0, -L, 0], r * 1.0, rc * 0.92).blend(0.03)));
  p.push(skin(S.ellipsoid(r * 0.52, L * 0.4, r * (0.46 + 0.14 * m)).at(r * 0.02, -L * 0.42, r * 0.52).blend(mb)));       // front of the thigh
  p.push(skin(S.ellipsoid(r * 0.5, L * 0.36, r * 0.62).at(r * 0.5, -L * 0.48, r * 0.1).blend(mb)));                     // outer sweep
  p.push(skin(S.ellipsoid(r * 0.4, L * 0.2, r * 0.42).at(-r * 0.4, -L * 0.76, r * 0.3).blend(mb)));                     // teardrop above the knee
  p.push(skin(S.ellipsoid(r * 0.72, L * 0.38, r * 0.62).at(0, -L * 0.48, -r * 0.34).blend(0.026)));                     // hamstrings
  p.push(skin(S.ellipsoid(r * 0.9, r * 0.95, r * 0.8).at(r * 0.1, -r * 0.1, -r * 0.3).blend(0.03)));                    // buttock / hip
  p.push(sk(S.sphere(rc * 0.96).at(0, -L, 0).blend(0.022)));
  p.push(sk(S.ellipsoid(rc * 0.46, rc * 0.5, rc * 0.3).at(0, -L + rc * 0.12, rc * 0.62).blend(0.03)));                  // kneecap
  if (sp === 'minotaur') p.push(B.fur(S.ellipsoid(r * 1.08, L * 0.36, r * 1.06).at(0, -L * 0.22, -r * 0.05).blend(0.03), 0.009));
  if (sp === 'demon') hard.push(spike([0, -L + rc * 0.2, rc * 0.9], [0, 0.5, 1], rc * 1.1, rc * 0.3, C.horn, [0, 1, 0], 0.3));
  if (B.lord) p.push(S.capsule([r * 0.5, -L * 0.2, r * 0.95], [r * 0.2, -L * 0.5, r * 1.0], 0.005).color(C.ember).glow(1.7).paint(0.004, 0), S.capsule([r * 0.2, -L * 0.5, r * 1.0], [r * 0.6, -L * 0.75, r * 0.7], 0.005).color(C.ember).glow(1.7).paint(0.004, 0));
  if (!st.noWrap) {
    const hem = sp === 'human' ? 0.38 : 0.2;                 // braies for humans, a brief wrap for everything else
    p.push(S.cyl(r * 1.7, L * (hem + 0.2), 0.01).at(0, -L * (hem - 0.2) / 2, 0).color(C.linen).tint(0.1, 60).pbr(0.92).paint(0.004, 0));
    p.push(S.cyl(r * 1.25, 0.012, 0.003).at(0, -L * (hem - 0.02), 0).color(tone(C.linen, 0, 0, -0.1)).pbr(0.92).paint(0.003, 0.0035));
  }
  limbDeco(B, 'leg', p, hard, L, r);
  hard.push(core(r * 1.0, rc * 0.96, L, sp === 'harpy' ? C.plume : sp === 'minotaur' || sp === 'goat' ? C.fur : C.skin));
  return { prims: p, hard };
}

function buildShin(B) {
  const { P, st, C, sk, sp } = B;
  const L = P.shin, rc = P.rCalf, ra = P.rAnkle, FL = P.footLen, gy = -L - P.footH;
  const p = [], hard = [];
  const fw = FL * (st.feet === 'shoe' ? 0.37 : 0.42);
  if (st.feet === 'hoof') {
    // shaggy lower leg ending in a cloven hoof
    const fur = B.fur, hc = 0x1e1814;
    p.push(sk(S.sphere(rc * 0.98)));
    p.push(fur(S.capsule([0, -L * 0.04, 0], [0, -L * 0.82, 0.006], rc * 0.98, ra * 1.25).blend(0.02), 0.009));
    p.push(fur(S.ellipsoid(rc * 0.84, L * 0.3, rc * 0.86).at(0, -L * 0.3, -rc * 0.4).blend(0.022), 0.009));
    p.push(fur(S.ellipsoid(ra * 1.75, L * 0.13, ra * 1.9).at(0, -L * 0.86, 0).blend(0.016), 0.012));                    // fetlock
    const hh = P.footH + L * 0.1;
    for (const s of [1, -1]) {
      p.push(S.cone(ra * 0.92, ra * 0.7, hh, 0.006).rot(-14, 0, s * 5).at(s * ra * 0.58, gy + hh * 0.5, FL * 0.18).color(hc).pbr(0.4).tint(0.2, 60).blend(0.004));
      p.push(S.ellipsoid(ra * 0.62, hh * 0.3, ra * 0.9).at(s * ra * 0.6, gy + hh * 0.2, FL * 0.34).color(hc).pbr(0.4).blend(0.008));
    }
    p.push(...[1, -1].map((s) => S.sphere(ra * 0.34).at(s * ra * 0.6, gy + hh * 1.0, -ra * 0.9).color(hc).pbr(0.4).blend(0.006)));  // dew claws
    p.push(S.box(0.4, 0.1, 0.5, 0).at(0, gy - 0.05, 0.05).cut(0.003).color(hc));
    hard.push(core(rc * 0.96, ra * 1.2, L * 0.92, C.fur), knob(ra * 0.95, ra * 1.05, P.footH + L * 0.1, 0x1e1814, 'footRod').at(0, gy + (P.footH + L * 0.1) / 2, FL * 0.16));
    return { prims: p, hard };
  }
  if (st.feet === 'talon') {
    // scaly bird leg: bare shank, three toes forward and one back, each ending in a talon
    const sc = (x) => x.color(C.scale).tint(0.14, 40).pbr(0.6).bump(0.0028, 60, 'scales');
    p.push(B.plume(S.sphere(rc * 1.1)));
    p.push(B.plume(S.ellipsoid(rc * 1.0, L * 0.22, rc * 1.05).at(0, -L * 0.12, -rc * 0.1).blend(0.012)));
    p.push(sc(S.capsule([0, -L * 0.16, 0], [0, -L, 0.004], ra * 0.92, ra * 0.8).blend(0.008)));
    p.push(sc(S.sphere(ra * 1.05).at(0, gy + ra * 1.1, 0.004).blend(0.01)));
    const toe = (dir, len, r0) => {
      const a = [0, gy + r0 * 1.15, 0.004], mid = add3(a, mul3(dir, len * 0.55)), b = add3(a, mul3(dir, len));
      mid[1] = gy + r0 * 1.5; b[1] = gy + r0 * 0.8;
      p.push(sc(S.capsule(a, mid, r0, r0 * 0.9).blend(0.006)), sc(S.capsule(mid, b, r0 * 0.9, r0 * 0.75).blend(0.004)), sc(S.sphere(r0 * 1.0).at(...mid).blend(0.004)));
      hard.push(spike(add3(b, [0, r0 * 0.15, 0]), [dir[0], -0.35, dir[2]], r0 * 4.2, r0 * 0.78, C.claw, [0, -1, 0], 0.38));
    };
    const tr = ra * 0.42;
    toe(norm3([-0.42, 0, 1]), FL * 0.56, tr); toe([0, 0, 1], FL * 0.66, tr * 1.05); toe(norm3([0.46, 0, 1]), FL * 0.54, tr); toe(norm3([-0.1, 0, -1]), FL * 0.36, tr);
    hard.push(core(ra * 0.95, ra * 0.8, L, C.scale), knob(ra * 0.5, ra * 0.9, FL * 0.85, C.scale, 'footRod').rot(90, 0, 0).scale(1.6, 0.5, 1).at(0, gy + ra * 0.5, FL * 0.22));
    return { prims: p, hard };
  }
  if (st.feet === 'claw') {
    // the look of a digitigrade leg: the shank runs down and back to a raised hock, a long instep slopes forward to the
    // ground, and the weight sits on three splayed, clawed toes with a spur behind
    const hock = [0, -L * 0.6, -rc * 1.2], ball = [0, gy + ra * 1.1, FL * 0.16];
    p.push(sk(S.sphere(rc * 0.98)));
    p.push(sk(bone([0, 0, 0], hock, rc * 0.95, ra * 1.2).blend(0.03)));
    p.push(sk(S.ellipsoid(rc * 0.78, L * 0.22, rc * 0.84).at(0, -L * 0.24, -rc * 0.62).blend(0.022)));                  // drumstick
    p.push(sk(S.sphere(ra * 1.22).at(hock[0], hock[1], hock[2]).blend(0.014)));
    p.push(sk(bone(hock, ball, ra * 1.1, ra * 1.02).blend(0.016)));
    p.push(sk(S.ellipsoid(fw * 0.5, ra * 1.0, FL * 0.17).at(0, gy + ra * 1.0, FL * 0.2).blend(0.016)));                 // ball of the foot
    const toe = (dir, len, r0) => {
      const a = [0, gy + r0 * 1.2, FL * 0.22], mid = add3(a, mul3(dir, len * 0.55)), b = add3(a, mul3(dir, len));
      mid[1] = gy + r0 * 1.7; b[1] = gy + r0 * 0.85;
      p.push(sk(S.capsule(a, mid, r0, r0 * 0.92).blend(0.006)), sk(S.capsule(mid, b, r0 * 0.92, r0 * 0.78).blend(0.004)), sk(S.sphere(r0 * 1.04).at(mid[0], mid[1], mid[2]).blend(0.004)));
      hard.push(spike(add3(b, [0, r0 * 0.2, 0]), [dir[0], -0.3, dir[2]], r0 * 3.4, r0 * 0.8, C.claw, [0, -1, 0], 0.36));
    };
    const tr = ra * 0.56;
    toe(norm3([-0.5, 0, 1]), FL * 0.5, tr); toe([0, 0, 1], FL * 0.6, tr * 1.08); toe(norm3([0.54, 0, 1]), FL * 0.48, tr); toe(norm3([-0.12, 0, -1]), FL * 0.34, tr * 0.8);
    limbDeco(B, 'shin', p, hard, L * 0.6, rc);
    p.push(S.box(0.4, 0.1, 0.6, 0).at(0, gy - 0.05, 0.05).cut(0.003).color(C.skin));
    hard.push(core(rc * 0.96, ra * 1.1, L, C.skin), knob(fw * 0.42, fw * 0.55, FL * 1.0, C.skin, 'footRod').rot(90, 0, 0).scale(1, 0.62, 1).at(0, gy + 0.02, FL * 0.26));
    return { prims: p, hard };
  }
  p.push(sk(S.sphere(rc * 0.98)));
  p.push(sk(S.capsule([0, 0, 0], [0, -L, 0], rc * 0.88, ra).blend(0.03)));
  p.push(sk(S.ellipsoid(rc * 0.6, L * 0.27, rc * 0.72).at(-rc * 0.28, -L * 0.29, -rc * 0.48).blend(0.018)));            // calf: inner head
  p.push(sk(S.ellipsoid(rc * 0.54, L * 0.24, rc * 0.64).at(rc * 0.34, -L * 0.3, -rc * 0.42).blend(0.018)));             // calf: outer head
  p.push(sk(S.capsule([0, -L * 0.1, rc * 0.5], [0, -L * 0.9, ra * 0.55], rc * 0.3, ra * 0.4).blend(0.016)));            // shin bone
  p.push(...[1, -1].map((s) => sk(S.sphere(ra * 0.5).at(s * ra * 0.78, -L + ra * 0.1, -ra * 0.1).blend(0.01))));        // ankle bones
  const scorchLeg = () => { if (C.scorch) p.push(S.capsule([0, -L * 0.5, 0], [0, gy - 0.05, FL * 0.3], rc * 2.4).color(C.scorch).paint(0.04, 0), S.capsule([0, -L * 0.88, 0], [0, gy - 0.05, FL * 0.3], rc * 2.4).color(C.scorch2).paint(0.03, 0)); };
  if (st.feet === 'shoe') {
    // neutral foot in a soft turnshoe, for species that are normally booted
    const sc = C.shoe;
    const f = [
      S.ellipsoid(fw * 0.5, 0.028, FL * 0.2).at(0, gy + 0.027, -FL * 0.1),
      S.capsule([0, -L - 0.004, 0.004], [0, gy + 0.024, FL * 0.36], ra * 1.02, 0.022).blend(0.02),
      S.ellipsoid(fw * 0.56, 0.021, FL * 0.24).at(-fw * 0.03, gy + 0.02, FL * 0.44).blend(0.018),
      S.ellipsoid(fw * 0.46, 0.019, FL * 0.14).at(-fw * 0.08, gy + 0.018, FL * 0.6).blend(0.016),
    ];
    for (const x of f) p.push(x.color(sc).tint(0.12, 50).pbr(0.75));
    p.push(S.cyl(ra * 2, 0.014, 0.003).at(0, -L + 0.012, 0.002).color(tone(sc, 0, 0, -0.06)).pbr(0.7).paint(0.003, 0.0035));        // cuff
    p.push(S.box(fw * 1.5, 0.012, FL * 1.3, 0.004).at(0, gy + 0.005, FL * 0.22).color(0x2c2018).pbr(0.85).paint(0.003, 0.0015));    // sole
  } else {
    const n = st.toes;
    p.push(sk(S.ellipsoid(fw * 0.42, 0.027, FL * 0.19).at(0, gy + 0.026, -FL * 0.1).blend(0.02)));                      // heel
    p.push(sk(S.capsule([0, -L - 0.004, 0.004], [-fw * 0.05, gy + 0.024, FL * 0.34], ra * 1.0, 0.021).blend(0.02)));     // instep
    p.push(sk(S.capsule([fw * 0.3, gy + 0.016, -FL * 0.05], [fw * 0.36, gy + 0.014, FL * 0.4], 0.016, 0.015).blend(0.016))); // outer edge
    p.push(sk(S.ellipsoid(fw * 0.56, 0.019, FL * 0.15).at(0, gy + 0.018, FL * 0.42).blend(0.016)));                      // ball
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1), x = lerp(-fw * 0.4, fw * 0.42, t);
      const tr = fw * (n >= 4 ? 0.13 : 0.175) * (i === 0 ? 1.35 : 1 - t * 0.2), tl = FL * (0.26 - 0.07 * t) * (i === 0 ? 1.05 : 1);
      const a = [x, gy + tr * 1.02, FL * 0.5], b = [x * 1.16, gy + tr * 0.95, FL * 0.5 + tl];
      p.push(sk(S.capsule(a, b, tr, tr * 0.92).blend(0.006)));
      fingertip(B, p, hard, a, b, tr * 0.85, [0, 1, 0], 0.62);
    }
  }
  scorchLeg();
  limbDeco(B, 'shin', p, hard, L, rc);
  barePaint(B, p, [0, gy + 0.008, FL * 0.3], FL * 0.42);
  p.push(S.box(0.4, 0.1, 0.5, 0).at(0, gy - 0.05, 0.05).cut(0.003));                                                   // flat sole on the ground
  hard.push(core(rc * 0.96, ra * 1.0, L, C.skin), knob(fw * 0.42, fw * 0.5, FL * 1.08, st.feet === 'shoe' ? C.shoe : C.skin, 'footRod').rot(90, 0, 0).scale(1, 0.62, 1).at(0, gy + 0.02, FL * 0.2));
  return { prims: p, hard };
}

// =====================================================================================
//  Heads. Each returns { prims, hard, hair } in head space (origin at the centre of the skull, face toward +Z).
// =====================================================================================

/** per-unit face: fixed looks for the game's own units, hashed variation for anything else */
const FACES = {
  militia: { hair: 'bowl', hairCol: 0x6a4526, beard: 'none', jaw: 0.94, nose: 1.0, brow: 0.9, eye: 0x5a7a4a, freckles: 1 },
  footman: { hair: 'crop', hairCol: 0x2c2018, beard: 'stubble', jaw: 1.08, nose: 1.02, brow: 1.1, eye: 0x4a6a8a },
  knight: { hair: 'crop', hairCol: 0x3a2a1c, beard: 'moustache', jaw: 1.06, nose: 1.08, brow: 1.1, eye: 0x4a6a8a },
  halberdier: { hair: 'crop', hairCol: 0x8a4a22, beard: 'moustache', jaw: 1.04, nose: 1.12, brow: 1.05, eye: 0x6a5a3a },
  lancer: { hair: 'swept', hairCol: 0x4a3220, beard: 'moustache', jaw: 1.0, nose: 1.0, brow: 1.0, eye: 0x5a4a2e },
  longbow: { hair: 'swept', hairCol: 0xb08a4e, beard: 'short', jaw: 0.96, nose: 1.06, brow: 0.95, eye: 0x5a7a4a },
  crossbow: { hair: 'crop', hairCol: 0x3a2618, beard: 'short', jaw: 1.02, nose: 0.96, brow: 1.15, eye: 0x4a3a2a, scar: 1 },
  battlemage: { hair: 'long', hairCol: 0x8c8880, beard: 'long', jaw: 0.98, nose: 1.15, brow: 1.2, eye: 0x7a5a2a },
  cleric: { hair: 'tonsure', hairCol: 0xd8d4c8, beard: 'none', jaw: 1.0, nose: 1.04, brow: 0.9, eye: 0x4a6a8a, old: 1 },
  paladin: { hair: 'swept', hairCol: 0xc09a58, beard: 'short', jaw: 1.1, nose: 1.0, brow: 1.1, eye: 0x4a7a9a },
  griffon: { hair: 'swept', hairCol: 0xb08a4e, beard: 'stubble', jaw: 1.02, nose: 1.0, brow: 1.0, eye: 0x4a6a8a },
  necromancer: { hair: 'bald', hairCol: 0x1a1618, beard: 'goatee', jaw: 0.9, nose: 1.14, brow: 1.15, eye: 0x9adf6a, gauntFace: 1, glowEyes: 0.9 },
  harpy: { hair: 'crest', hairCol: 0x4a3c6a, beard: 'none', jaw: 0.84, nose: 0.86, brow: 0.8, eye: 0xe0a020, female: 1 },
};
const HAIRS = ['crop', 'bowl', 'swept', 'long', 'tonsure', 'bald'];
const HAIR_COLS = [0x1e1814, 0x3a2a1c, 0x5a3d24, 0x7a4424, 0xb08a4e, 0x8c8880];
const BEARDS = ['none', 'stubble', 'moustache', 'short', 'goatee', 'none', 'long'];
const EYE_COLS = [0x4a6a8a, 0x5a7a4a, 0x5a4a2e, 0x4a3a2a, 0x6a7a8a];
function faceFor(def, sp) {
  const id = def.id || 'unit';
  if (sp === 'harpy') return FACES.harpy;
  if (sp === 'elf' || sp === 'dwarf' || sp === 'orc') {
    const r = rng(hashStr(id + ':' + sp)), pick = (list) => list[Math.floor(r() * list.length)];
    if (sp === 'elf') return { hair: 'long', hairCol: pick([0xd9c48a, 0xe6dfc6, 0x2a2018, 0x8a4a22, 0xb9b4a8]), beard: 'none', jaw: 0.84 + r() * 0.06, nose: 0.86 + r() * 0.1, brow: 0.78 + r() * 0.1, eye: pick([0x5a9ac8, 0x6ab07a, 0xb89a3a, 0x8a7ac8]) };
    if (sp === 'dwarf') return { hair: pick(['swept', 'crop', 'long', 'swept', 'bald']), hairCol: pick([0x9a4a1e, 0x6a4526, 0x8a5a2a, 0xa8a49c, 0xb0702a]), beard: 'great', jaw: 1.12 + r() * 0.1, nose: 1.0 + r() * 0.12, brow: 1.3 + r() * 0.2, eye: pick([0x4a6a8a, 0x5a4a2e, 0x4a3a2a]) };
    return { hair: pick(['topknot', 'bald', 'mohawk', 'topknot']), hairCol: 0x16130f, beard: 'none' };
  }
  if (FACES[id]) return FACES[id];
  const r = rng(hashStr(id));
  return { hair: HAIRS[Math.floor(r() * HAIRS.length)], hairCol: HAIR_COLS[Math.floor(r() * HAIR_COLS.length)], beard: BEARDS[Math.floor(r() * BEARDS.length)],
    jaw: 0.92 + r() * 0.2, nose: 0.9 + r() * 0.25, brow: 0.9 + r() * 0.3, eye: EYE_COLS[Math.floor(r() * EYE_COLS.length)], scar: r() > 0.8 ? 1 : 0 };
}

const neckStub = (B, R, r = 1.02, z = -0.14) => B.sk(S.capsule([0, -R * 0.55, R * z], [0, -R * 1.45, R * (z - 0.04)], B.P.rNeck * r, B.P.rNeck * r).blend(0.03));

function humanHead(B) {
  const { P, C, sk } = B;
  const R = P.headR, L = P.headLen / 1.12, f = B.face;
  const p = [], hard = [];
  const jw = f.jaw ?? 1, nl = f.nose ?? 1, bh = f.brow ?? 1, gauntF = f.gauntFace || 0, old = f.old || 0, fem = f.female || 0;
  const elf = B.sp === 'elf', dwarf = B.sp === 'dwarf';
  // skull, face mass
  p.push(sk(S.ellipsoid(R * 0.86, R * 0.92 * L, R * 0.98).at(0, R * 0.2, -R * 0.08)));
  p.push(sk(S.ellipsoid(R * 0.68, R * 0.85, R * 0.6).at(0, -R * 0.3, R * 0.3).blend(0.02)));
  // jaw: two branches of the mandible meeting at the chin, with the floor of the mouth between them
  p.push(...S.mirrorX([sk(S.capsule([R * 0.56 * jw, -R * 0.5, R * 0.02], [R * 0.15 * jw, -R * 0.93, R * 0.64], R * 0.17, R * 0.145).blend(0.024))]));
  p.push(sk(S.ellipsoid(R * 0.48 * jw, R * 0.3, R * 0.48).at(0, -R * 0.68, R * 0.22).blend(0.02)));
  p.push(sk(S.ellipsoid(R * 0.21 * jw, R * 0.15, R * 0.15).at(0, -R * 0.97, R * 0.7).blend(0.018)));
  // cheekbones, brow ridge
  p.push(...S.mirrorX([
    sk(S.ellipsoid(R * 0.2, R * 0.13, R * 0.17).at(R * 0.5, -R * 0.3, R * 0.55).blend(0.032)),
    sk(S.capsule([0, R * 0.26, R * 0.87], [R * 0.56, R * 0.3, R * 0.6], R * 0.092 * bh, R * 0.07 * bh).blend(0.014)),
  ]));
  if (gauntF) p.push(...S.mirrorX([S.ellipsoid(R * 0.14, R * 0.22, R * 0.16).at(R * 0.56, -R * 0.56, R * 0.64).cut(0.035).color(C.shade)]));
  if (elf) p.push(...S.mirrorX([                                                                                               // high, sharp cheekbones over hollow cheeks
    sk(S.ellipsoid(R * 0.2, R * 0.085, R * 0.2).rot(0, 0, 24).at(R * 0.52, -R * 0.2, R * 0.56).blend(0.018)),
  ]));
  if (dwarf) p.push(...S.mirrorX([                                                                                             // broad cheeks, a shelf of brow
    sk(S.ellipsoid(R * 0.27, R * 0.22, R * 0.24).at(R * 0.52, -R * 0.36, R * 0.52).blend(0.03)),
    sk(S.ellipsoid(R * 0.3, R * 0.11, R * 0.16).at(R * 0.34, R * 0.34, R * 0.78).blend(0.02)),
  ]));
  // nose
  const ns = fem ? 0.82 : dwarf ? 1.75 : elf ? 0.86 : 1;
  p.push(sk(S.capsule([0, R * 0.1, R * 0.84], [0, -R * 0.34 * nl, R * (0.98 + 0.08 * nl)], R * 0.065 * ns, R * 0.09 * ns).blend(0.014)));
  p.push(sk(S.sphere(R * 0.105 * ns).at(0, -R * 0.37 * nl, R * (0.98 + 0.07 * nl)).blend(0.01)));
  p.push(...S.mirrorX([sk(S.sphere(R * 0.07 * ns).at(R * 0.11 * ns, -R * 0.4 * nl - R * 0.02, R * 0.93).blend(0.009))]));
  // mouth mound
  const my = -R * 0.66, mz = R * 0.875;
  p.push(sk(S.ellipsoid(R * 0.3, R * 0.2, R * 0.2).at(0, my + R * 0.01, R * 0.69).blend(0.018)));
  // ears (tagged 'ear' so gear can take them off under a hood or coif)
  if (elf) {
    // long blades swept up and back, clear of the hair
    earBlade(B, p, [R * 0.8, -R * 0.04, -R * 0.08], [0.78, 0.6, -0.56], R * 0.74, R * 0.14, R * 0.05, mix(C.skin, C.blush, 0.5));
    for (const x of p.slice(-3)) p.push(x.mirrorX());
  } else p.push(...S.mirrorX([
    tagged(sk(S.ellipsoid(R * 0.07, R * 0.23, R * 0.16).rot(-12, 22, 0).at(R * 0.86, -R * 0.08, -R * 0.06).blend(0.01)), 'ear'),
    tagged(S.ellipsoid(R * 0.045, R * 0.14, R * 0.085).rot(-12, 22, 0).at(R * 0.935, -R * 0.07, -R * 0.03).cut(0.006).color(C.shade), 'ear'),
  ]));
  p.push(neckStub(B, R));
  // a harpy's raptor mask: a hooked tip on the nose, dark plumage round the eyes running down the cheeks in malar stripes
  const harpy = B.sp === 'harpy', mask = harpy ? tone(C.plume, 0, 0.06, -0.24) : 0;
  if (harpy) {
    p.push(sk(S.ellipsoid(R * 0.075, R * 0.11, R * 0.07).rot(-30, 0, 0).at(0, -R * 0.44, R * 1.0).blend(0.008)));
    p.push(...S.mirrorX([sk(S.ellipsoid(R * 0.16, R * 0.08, R * 0.12).rot(0, 0, -20).at(R * 0.5, R * 0.3, R * 0.66).blend(0.012))]));   // a fiercer, swept brow
  }
  // eyes
  const er = R * (fem || elf ? 0.185 : dwarf ? 0.15 : 0.168);
  eyeSet(p, hard, C, { x: R * 0.38, y: 0, r: er, z0: R * 2, look: { iris: f.eye, glow: f.glowEyes, ring: harpy ? 0x3a2408 : undefined, pupilSize: harpy ? 0.8 : 1 }, lash: fem ? 0x1c1014 : 0x2a1c14,
    lidCol: harpy ? tone(mask, 0, 0, -0.04) : tone(C.skin, -0.005, -0.08, gauntF ? -0.26 : -0.2), socket: gauntF ? C.deep : undefined, lid: { upper: old ? 44 : harpy ? 44 : dwarf ? 42 : 37, roll: harpy ? -16 : elf ? -11 : -4 * (bh - 0.9) * 2.5, lower: harpy ? 14 : 0 } });
  if (harpy) p.push(...S.mirrorX([
    S.ellipsoid(R * 0.27, R * 0.17, R * 0.22).rot(0, 0, -16).at(R * 0.42, R * 0.04, R * 0.74).color(mask).pbr(0.85).paint(0.018, 0),
    stroke(R * 0.44, -R * 0.36, R * 0.74, R * 0.055, R * 0.24, R * 0.28, 0, 10).color(mask).pbr(0.85).paint(0.012, 0),
    stroke(R * 0.62, R * 0.08, R * 0.6, R * 0.2, R * 0.045, R * 0.3, 30, 18).color(mask).pbr(0.85).paint(0.008, 0),
  ]));
  // paint: lips, mouth line, nostrils, cheeks, eyebrows, marks
  const lip = fem ? mix(C.lip, 0xa83a44, 0.5) : C.lip;
  p.push(S.ellipsoid(R * 0.21, R * 0.04, R * 0.14).at(0, my + R * 0.045, mz).color(mix(C.skin, lip, fem ? 0.9 : 0.6)).paint(0.004, 0));
  p.push(S.ellipsoid(R * 0.17, R * 0.055, R * 0.14).at(0, my - R * 0.055, mz - R * 0.01).color(lip).paint(0.004, 0.002));
  p.push(stroke(0, my, mz, R * 0.23, R * 0.018, R * 0.16).color(C.mouth).paint(0.003, -0.0035));
  p.push(...S.mirrorX([
    S.sphere(R * 0.04).at(R * 0.065, -R * 0.45 * nl - R * 0.035, R * 0.96).color(C.deep).paint(0.003, 0),
    S.sphere(R * 0.2).at(R * 0.46, -R * 0.4, R * 0.66).color(mix(C.skin, C.blush, 0.4)).paint(0.035, 0),
  ]));
  if (old || gauntF) p.push(...S.mirrorX([S.capsule([R * 0.19, -R * 0.42, R * 0.9], [R * 0.33, -R * 0.68, R * 0.78], R * 0.02).color(C.shade).paint(0.005, -0.003)]));
  const hc = f.hairCol ?? 0x3a2a1c;
  p.push(...S.mirrorX([stroke(R * 0.36, R * (0.3 + 0.015 * bh), R * 0.84, R * 0.24, R * 0.05 * bh * (fem ? 0.7 : 1), R * 0.2, 24, harpy ? 22 : elf ? 17 : 5 - 8 * (bh - 1)).color(old ? 0xcfcac0 : harpy ? mask : fem ? 0x2a2030 : tone(hc, 0, 0, -0.06)).pbr(0.9).paint(0.004, 0.0028)]));
  if (f.freckles) for (let i = 0; i < 9; i++) p.push(S.sphere(R * 0.022).at((noise3(i * 3.1, 2, 5) - 0.5) * R * 0.9, -R * 0.24 - noise3(i * 1.7, 9, 1) * R * 0.14, R * 0.84).color(tone(C.skin, -0.02, 0.1, -0.14)).paint(0.004, 0));
  if (f.scar) p.push(stroke(R * 0.52, R * 0.0, R * 0.7, R * 0.016, R * 0.4, R * 0.3, 0, -8).color(tone(C.skin, -0.02, -0.05, 0.1)).paint(0.004, 0.0012));
  if (f.beard === 'stubble') p.push(S.ellipsoid(R * 0.72, R * 0.4, R * 0.62).at(0, -R * 0.8, R * 0.32).color(mix(C.skin, hc, 0.4)).paint(0.02, 0));
  return { prims: p, hard, hair: humanHair(B, f, hc) };
}

/** scalp hair, beards and crests as their own piece (a child node of the head), so the hairline stays crisp */
function humanHair(B, f, hc) {
  const { P, o } = B;
  const R = P.headR, L = P.headLen / 1.12;
  const p = [], hard = [];
  const hair = (x, amp = 0.0065) => x.color(hc).tint(0.24, 22).pbr(0.7).bump(amp, 56, 'fur');
  const covered = !!(o.helm || o.hood);
  const style = covered ? 'none' : f.hair;
  const cap = (grow, y = 0.2, z = -0.08) => hair(S.ellipsoid(R * (0.86 + grow), R * (0.92 * L + grow), R * (0.98 + grow)).at(0, R * y, R * z));
  // the hairline: square across the brow, straight down in front of the ears
  const faceCut = (y, w = 0.74, h = 0.9) => S.box(R * w * 1.86, R * h * 2, R * 1.5, R * 0.34).at(0, R * (y - 0.03), R * 0.92).cut(0.01).color(hc);
  const napeCut = (deg, y) => S.box(R * 3, R * 1.2, R * 3, 0).rot(deg, 0, 0).at(0, R * y, 0).cut(0.012).color(hc);
  switch (style) {
    case 'crop':
      p.push(cap(0.07), faceCut(-0.38, 0.74, 0.92), napeCut(-18, -1.02));
      break;
    case 'bowl':
      p.push(cap(0.075, 0.22, -0.06));
      p.push(S.box(R * 3, R * 1.6, R * 3, 0).rot(-23, 0, 0).at(0, -R * 0.8, 0).cut(0.012).color(hc));
      for (let i = -2; i <= 2; i++) p.push(hair(S.ellipsoid(R * 0.2, R * (0.2 + 0.05 * noise3(i * 2.3, 1, 7)), R * 0.1).rot(10, i * 22, i * 6).at(R * i * 0.3, R * (0.56 - Math.abs(i) * 0.03), R * (0.93 - i * i * 0.075)).blend(0.014)));
      p.push(...S.mirrorX([hair(S.ellipsoid(R * 0.11, R * 0.34, R * 0.26).at(R * 0.9, R * 0.06, R * 0.1).blend(0.018)), hair(S.ellipsoid(R * 0.17, R * 0.4, R * 0.28).at(R * 0.74, -R * 0.16, -R * 0.56).blend(0.018))]));
      p.push(hair(S.ellipsoid(R * 0.46, R * 0.4, R * 0.18).at(0, -R * 0.3, -R * 0.96).blend(0.018)));
      break;
    case 'swept':
      p.push(cap(0.075, 0.22, -0.1), faceCut(-0.42, 0.76, 0.98));
      p.push(hair(S.ellipsoid(R * 0.62, R * 0.2, R * 0.4).rot(22, 0, -8).at(R * 0.08, R * 0.92, R * 0.42).blend(0.025)));          // quiff
      p.push(hair(S.ellipsoid(R * 0.62, R * 0.36, R * 0.3).at(0, -R * 0.2, -R * 0.84).blend(0.03)));                              // nape
      p.push(napeCut(-24, -1.12));
      break;
    case 'long':
      p.push(cap(0.075, 0.22, -0.08), faceCut(-0.4, 0.74, 0.96));
      p.push(hair(S.ellipsoid(R * 0.8, R * 0.72, R * 0.36).at(0, -R * 0.5, -R * 0.72).blend(0.03)));
      p.push(...S.mirrorX([hair(S.ellipsoid(R * 0.2, R * 0.66, R * 0.4).at(R * 0.76, -R * 0.42, -R * 0.3).blend(0.025))]));
      if (B.sp === 'elf') {
        // an elf's hair is longer and straighter: a sheet down between the shoulder blades, parted in the middle
        const zb = -Math.max(R * 0.9, P.chestD / 2 + 0.026);
        p.push(hair(bone([0, -R * 0.7, -R * 0.8], [0, -R * 2.5, zb], R * 0.6, R * 0.42).blend(0.03), 0.005));
        p.push(...S.mirrorX([hair(bone([R * 0.5, -R * 0.6, -R * 0.66], [R * 0.46, -R * 2.2, zb + R * 0.06], R * 0.3, R * 0.16).blend(0.02), 0.005)]));
        p.push(S.capsule([0, R * 1.3, R * 0.6], [0, R * 0.9, -R * 1.0], R * 0.02).color(tone(hc, 0, 0, -0.1)).paint(0.003, -0.0025));
      }
      break;
    case 'tonsure':
      p.push(cap(0.06), S.box(R * 3, R * 3, R * 2, 0).at(0, 0, R * 1.14).cut(0.012).color(hc));       // nothing left in front of the ears
      p.push(S.ellipsoid(R * 0.78, R * 0.62, R * 0.86).at(0, R * 0.98, -R * 0.06).cut(0.012).color(hc), napeCut(-18, -1.0));
      break;
    case 'crest': {
      // harpy: a cap of small feathers and a crest of long plumes swept back from the brow
      const cols = B.featherCols, pl = B.plume;
      p.push(pl(S.ellipsoid(R * 0.92, R * 0.96 * L, R * 1.04).at(0, R * 0.22, -R * 0.1)).bump(0.0032, 78, 'scales'), faceCut(-0.42, 0.7, 0.98), napeCut(-30, -1.2));
      for (let i = -3; i <= 3; i++) {
        const a = i / 3;
        hard.push(feather([R * a * 0.4, R * (0.86 - a * a * 0.16), R * (0.5 - Math.abs(a) * 0.1)], [a * 0.5, 0.7 - Math.abs(a) * 0.15, -1], R * (1.5 - Math.abs(a) * 0.5), R * 0.36, [a * 0.6, 1, 0.5], cols));
      }
      for (const s of [-1, 1]) for (let j = 0; j < 3; j++) hard.push(feather([s * R * 0.84, R * (0.1 - j * 0.14), -R * 0.1], [s * 0.5, 0.15 - j * 0.25, -1], R * (0.9 - j * 0.12), R * 0.3, [s, 0.2, 0.3], cols, 1));
      break;
    }
    case 'topknot':
      // scraped up into a knot on the crown, bound with a thong, its tail falling behind
      p.push(cap(0.05), faceCut(-0.3, 0.74, 0.8), napeCut(-12, -0.78));
      p.push(hair(S.sphere(R * 0.27).at(0, R * (0.36 + 0.92 * L), -R * 0.26).blend(0.02), 0.008));
      p.push(hair(bone([0, R * (0.42 + 0.92 * L), -R * 0.36], [0, R * 0.36, -R * 1.22], R * 0.15, R * 0.05).blend(0.02), 0.008));
      p.push(S.cyl(R * 0.26, R * 0.075, 0).at(0, R * (0.2 + 0.92 * L), -R * 0.2).color(0x7a2a1e).pbr(0.8).paint(0.004, 0.003));
      break;
    case 'mohawk':
      // the skull shaved but for a stiff crest from brow to nape
      for (let i = 0; i < 9; i++) { const a = (-34 + i * 20) * DEG; p.push(hair(orient(S.ellipsoid(R * 0.16, R * (0.48 - Math.abs(i - 3) * 0.035), R * 0.12), [0, R * (0.2 + 0.94 * L * Math.cos(a)), R * (-0.08 - 1.0 * Math.sin(a))], [0, Math.cos(a) + 0.25, -Math.sin(a) - 0.5], [1, 0, 0]).blend(0.016), 0.008)); }
      break;
    case 'spiked': {
      // stiffened with lime: bleached spikes raked back from the brow
      const lime = mix(hc, 0xece6d2, 0.74);
      p.push(cap(0.045).color(mix(hc, 0xece6d2, 0.3)), faceCut(-0.34, 0.74, 0.88), napeCut(-16, -0.92));
      for (let i = 0; i < 5; i++) for (let j = -2; j <= 2; j++) {
        const a = (-32 + i * 28) * DEG, b = j * 25 * DEG;
        const n = [Math.sin(b), Math.cos(a) * Math.cos(b), -Math.sin(a) * Math.cos(b)];
        const base = [n[0] * R * 0.82, R * 0.2 + n[1] * R * 0.88 * L, -R * 0.08 + n[2] * R * 0.94];
        const len = R * (0.6 - Math.abs(j) * 0.07 + ((i * 3 + j + 7) % 3) * 0.09);
        p.push(bone(base, add3(base, mul3(norm3([n[0] * 0.8, n[1] + 0.25, n[2] - 0.7]), len)), R * 0.105, R * 0.016).color(lime).tint(0.1, 30).pbr(0.92).blend(0.008));
      }
      break;
    }
    case 'braids': {
      // parted in the middle and drawn into two long plaits that hang in front of the shoulders
      const zf = P.chestD / 2 + 0.03, n = 8, tie = 0x7a2a1e;
      p.push(cap(0.07, 0.22, -0.08), faceCut(-0.4, 0.72, 0.96), napeCut(-22, -1.1));
      p.push(S.capsule([0, R * 1.3, R * 0.7], [0, R * 1.0, -R * 0.9], R * 0.025).color(tone(hc, 0, 0, -0.12)).paint(0.003, -0.003));
      for (const s of [1, -1]) {
        const path = (t) => [s * R * lerp(0.84, 0.74, t), -R * lerp(0.25, 3.0, t), lerp(-R * 0.1, zf, clamp(t * 2.6))];
        p.push(hair(S.ellipsoid(R * 0.2, R * 0.42, R * 0.3).at(s * R * 0.78, -R * 0.16, -R * 0.2).blend(0.02)));
        for (let i = 0; i < n; i++) { const q = path((i + 0.5) / n); p.push(hair(S.ellipsoid(R * 0.15, R * 0.21, R * 0.135).rot(0, 0, s * (i % 2 ? 18 : -18)).at(q[0], q[1], q[2]).blend(0.006), 0.004)); }
        const e = path(1);
        p.push(S.ellipsoid(R * 0.13, R * 0.07, R * 0.13).at(e[0], e[1] + R * 0.06, e[2]).color(tie).pbr(0.8).blend(0.004), hair(S.ellipsoid(R * 0.1, R * 0.16, R * 0.1).at(e[0], e[1] - R * 0.1, e[2]).blend(0.008), 0.006));
      }
      break;
    }
    default:
  }
  const bc = tone(hc, 0, 0, 0.02);
  const beard = (x, amp = 0.005) => x.color(bc).tint(0.2, 30).pbr(0.78).bump(amp, 40, 'fur');
  const my = -R * 0.66;
  const tash = (w = 0.2, droop = -16) => S.mirrorX([beard(S.ellipsoid(R * w, R * 0.06, R * 0.08).rot(0, 14, droop).at(R * 0.13, my + R * 0.115, R * 0.9).blend(0.006), 0.003)]);
  switch (o.helm === 'full' ? 'none' : f.beard) {
    case 'moustache': p.push(...tash(0.21, -14)); break;
    case 'goatee':
      p.push(...tash(0.17, -22));
      p.push(beard(S.ellipsoid(R * 0.2, R * 0.24, R * 0.15).at(0, -R * 1.02, R * 0.72).blend(0.014)));
      break;
    case 'short':
    case 'long':
      p.push(...tash(0.2, -16));
      p.push(beard(S.ellipsoid(R * 0.66, R * 0.42, R * 0.5).at(0, -R * 0.84, R * 0.36).blend(0.012)));
      p.push(...S.mirrorX([beard(S.ellipsoid(R * 0.12, R * 0.3, R * 0.24).at(R * 0.72, -R * 0.46, R * 0.16).blend(0.016))]));
      if (f.beard === 'long') p.push(beard(S.ellipsoid(R * 0.36, R * 0.62, R * 0.22).at(0, -R * 1.42, R * 0.62).blend(0.03)));
      p.push(S.ellipsoid(R * 0.2, R * 0.075, R * 0.3).at(0, my - R * 0.04, R * 0.9).cut(0.008).color(bc));                        // the mouth shows through
      break;
    case 'great':
    case 'braided':
    case 'forked':
    case 'curled': {
      // the big beards hang down over the chest: they are measured against the body (how far out the chest is, where the belt sits)
      const kind = f.beard, zc = Math.max(R * 0.66, P.chestD / 2 + 0.036 - R * 0.3), belt = P.torso + P.neck + R * P.headLen * 0.9 - 0.075 * (P.torso / 0.3);
      const mouth = () => p.push(S.ellipsoid(R * 0.2, R * 0.07, R * 0.3).at(0, my - R * 0.04, R * 0.92).cut(0.008).color(bc));
      const base = (w = 0.7) => {
        p.push(...S.mirrorX([beard(S.ellipsoid(R * 0.3, R * 0.095, R * 0.11).rot(0, 16, -28).at(R * 0.2, my + R * 0.09, R * 0.9).blend(0.006), 0.004)]));    // a moustache to match
        p.push(beard(S.ellipsoid(R * w, R * 0.46, R * 0.54).at(0, -R * 0.86, R * 0.36).blend(0.012), 0.007));
        p.push(...S.mirrorX([beard(S.ellipsoid(R * 0.13, R * 0.34, R * 0.26).at(R * 0.74, -R * 0.42, R * 0.14).blend(0.016), 0.006)]));
      };
      if (kind === 'great') {
        const len = clamp(belt * 0.66, R * 1.9, R * 3.1);
base(0.8);
        p.push(beard(bone([0, -R * 1.0, R * 0.56], [0, -len * 0.62, zc], R * 0.66, R * 0.6).blend(0.03), 0.009));
        p.push(...S.mirrorX([
          beard(bone([R * 0.56, -R * 0.84, R * 0.36], [R * 0.52, -len * 0.74, zc], R * 0.34, R * 0.3).blend(0.02), 0.009),
          beard(bone([R * 0.3, -len * 0.6, zc + R * 0.04], [R * 0.36, -len, zc + R * 0.1], R * 0.42, R * 0.2).blend(0.02), 0.009),
        ]));
        p.push(beard(bone([0, -len * 0.6, zc + R * 0.04], [0, -len * 1.06, zc + R * 0.1], R * 0.46, R * 0.22).blend(0.02), 0.009));
        for (let i = -3; i <= 3; i++) p.push(S.box(R * 0.035, len, R * 1.6, 0).rot(0, 0, i * 3).at(i * R * 0.19, -R * 0.9 - len * 0.42, R * 1.0).color(tone(bc, 0, 0, -0.1)).paint(0.004, -0.004));   // the hang of the strands
      } else if (kind === 'braided') {
        // three plaits to the belt, each ringed with metal
        const len = clamp(belt, R * 2.4, R * 4.4);
        base(0.72);
        p.push(beard(bone([0, -R * 1.0, R * 0.56], [0, -R * 1.7, zc], R * 0.56, R * 0.4).blend(0.03), 0.007));
        for (const s of [0, 1, -1]) {
          const x0 = s * R * 0.36, l = len * (s ? 0.88 : 1), n = Math.max(4, Math.round((l - R * 1.5) / (R * 0.3)));
          const zEnd = Math.max(zc, P.waistD / 2 * (1.32 + (B.st.gut || 0) * 0.5) + 0.016);
          for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, y = -lerp(R * 1.5, l, t); p.push(beard(S.ellipsoid(R * 0.17, R * 0.2, R * 0.15).rot(0, 0, i % 2 ? 20 : -20).at(x0 * lerp(1, 1.25, t), y, lerp(zc, zEnd, t) + R * 0.1).blend(0.006), 0.004)); }
          hard.push(H.torus(R * 0.13, R * 0.045, 12, 6).rot(90, 0, 0).at(x0 * 1.25, -l - R * 0.02, zEnd + R * 0.1).color(0xc9a23a).pbr(0.35, 1).lod(1));
          p.push(beard(S.ellipsoid(R * 0.1, R * 0.16, R * 0.1).at(x0 * 1.25, -l - R * 0.2, zEnd + R * 0.1).blend(0.006), 0.006));
        }
      } else if (kind === 'forked') {
        const len = clamp(belt * 0.6, R * 1.9, R * 2.8);
        base(0.68);
        p.push(...S.mirrorX([beard(bone([R * 0.12, -R * 0.96, R * 0.6], [R * 0.3, -len * 0.7, zc + R * 0.1], R * 0.34, R * 0.22).blend(0.022), 0.007), beard(bone([R * 0.3, -len * 0.7, zc + R * 0.1], [R * 0.4, -len, zc + R * 0.14], R * 0.22, R * 0.03).blend(0.012), 0.007)]));
      } else {
        // oiled and curled: a squared block of ringlets in tiers
        const len = clamp(belt * 0.5, R * 1.7, R * 2.4), oil = (x) => x.color(tone(hc, 0, 0, -0.04)).tint(0.1, 30).pbr(0.42).bump(0.008, 30, 'scales');
        p.push(...S.mirrorX([oil(S.ellipsoid(R * 0.3, R * 0.1, R * 0.11).rot(0, 16, -18).at(R * 0.2, my + R * 0.09, R * 0.9).blend(0.006))]));
        p.push(oil(S.ellipsoid(R * 0.72, R * 0.46, R * 0.54).at(0, -R * 0.86, R * 0.36).blend(0.012)));
        p.push(...S.mirrorX([oil(S.ellipsoid(R * 0.13, R * 0.36, R * 0.26).at(R * 0.74, -R * 0.4, R * 0.14).blend(0.016))]));
        const tiers = 4;
        for (let i = 0; i < tiers; i++) { const t = (i + 0.5) / tiers, y = -lerp(R * 1.0, len, t); p.push(oil(S.box(R * (1.16 - t * 0.2), (len - R) / tiers * 1.2, R * 0.5, R * 0.12).at(0, y, lerp(R * 0.62, zc + R * 0.1, t)).blend(0.006))); }
        for (let i = 1; i < tiers; i++) p.push(S.box(R * 1.6, R * 0.03, R * 1.2, 0).at(0, -lerp(R * 1.0, len, i / tiers), R * 0.9).color(tone(hc, 0, 0, -0.1)).paint(0.003, -0.004));
      }
      mouth();
      break;
    }
    default:
  }
  return p.length || hard.length ? { prims: p, hard } : null;
}

/** a flat pointed ear blade from `root` along `dir`, with a hollowed inner face (adds three prims: mirror the last three) */
function earBlade(B, p, root, dir, len, width, thick, inner) {
  const u = norm3(dir), c = add3(root, mul3(u, len * 0.82)), face = [0.25, 0.1, 1], t = thick * 1.7;
  p.push(B.sk(S.capsule(root, add3(root, mul3(u, len * 0.5)), width * 0.62, width * 0.5).blend(0.02)));
  p.push(B.sk(orient(S.ellipsoid(width, len, t), c, u, face).blend(0.012)));
  const e = frameEuler(u, face);
  const off = new THREE.Vector3(0, -len * 0.08, t * 0.95).applyEuler(new THREE.Euler(e[0] * DEG, e[1] * DEG, e[2] * DEG, 'XYZ'));
  p.push(S.ellipsoid(width * 0.6, len * 0.74, t * 0.9).rot(e[0], e[1], e[2]).at(c[0] + off.x, c[1] + off.y, c[2] + off.z).color(inner).paint(0.004, -0.003));
  // the blade is too thin for the farthest level: a flat four-sided spike keeps the ear's silhouette there (both sides)
  const far = orient(H.cone(width * 0.9, len * 1.72, 4).at(0, len * 0.86, 0).scale(1, 1, 0.34), root, u, face).color(B.C.skin).pbr(0.75).far();
  (B.farHard ||= []).push(far, far.mirrorX());
  return { c, u, tip: add3(c, mul3(u, len)) };
}
/** a row of teeth along the mouth: xs = positions across, dir +1 = lower teeth pointing up */
function teethRow(p0, hard, xs, y, z0, len, r, color, dir = -1, splay = 0) {
  for (const x of xs) {
    const s = hit(p0, [x, y, z0], [0, 0, -1]);
    hard.push(spike([x, y, s[2] - r * 0.6], [Math.sign(x) * splay, dir, 0.12], len, r, color, [0, 0, -1], 0.12));
  }
}
/** horn through points with radii: ridged sculpt for the body, a crisp cone for the tip */
function horn(p, hard, pts, radii, colA, colB, ridge = 0.004) {
  const n = pts.length - 1;
  for (let i = 0; i < n - 1; i++) {
    const c = mix(colA, colB, (i / n) * 0.75);
    p.push(bone(pts[i], pts[i + 1], radii[i], radii[i + 1]).color(c).pbr(0.45).tint(0.1, 40).bump(ridge * 0.45 * (1 - i / n), 0.7 / Math.max(0.012, radii[0]), 'ridges').blend(i ? 0.008 : 0.012));
  }
  const a = pts[n - 1], b = pts[n];
  hard.push(orient(claw(len3(sub3(b, a)) * 1.04, radii[n - 1] * 1.0, mix(colA, colB, 0.75), 0.12), a, sub3(b, a), sub3(b, pts[Math.max(0, n - 2)])).lod(99));
  // a plain rod buried in the sculpted horn keeps the silhouette on the farthest detail level
  hard.push(H.tube(pts.slice(0, n), radii.slice(0, n).map((r) => r * 0.66), Math.max(3, (n - 1) * 3), 5).color(mix(colA, colB, 0.35)).pbr(0.5));
}
const wart = (pos, r, color) => S.sphere(r).at(pos[0], pos[1], pos[2]).color(color).paint(r * 0.5, r * 0.55);

function goblinHead(B) {
  const { P, C, sk, sp, def } = B;
  const R = P.headR, p = [], hard = [];
  const r = rng(hashStr((def.id || sp) + ':face'));
  const hob = sp === 'hobgoblin', boss = hob && (B.o.build === 'heavy');
  let hairPart = null;
  if (!hob) {
    const nl = 0.88 + r() * 0.3, el = 0.9 + r() * 0.28, droop = (r() - 0.4) * 0.5, eyeCol = [0xe8c020, 0xe89a18, 0xd8d838, 0xe86a1a][Math.floor(r() * 4)];
    // wide flat skull, sharp cheeks, narrow pointed jaw
    p.push(sk(S.ellipsoid(R * 0.95, R * 0.82, R * 0.95).at(0, R * 0.16, -R * 0.06)));
    p.push(sk(S.ellipsoid(R * 0.8, R * 0.64, R * 0.6).at(0, -R * 0.22, R * 0.26).blend(0.03)));
    p.push(...S.mirrorX([sk(S.capsule([R * 0.5, -R * 0.4, R * 0.1], [R * 0.1, -R * 0.82, R * 0.6], R * 0.16, R * 0.12).blend(0.024))]));
    p.push(sk(S.ellipsoid(R * 0.36, R * 0.24, R * 0.36).at(0, -R * 0.6, R * 0.3).blend(0.02)));
    p.push(sk(S.ellipsoid(R * 0.15, R * 0.13, R * 0.13).at(0, -R * 0.9, R * 0.66).blend(0.016)));
    p.push(...S.mirrorX([
      sk(S.ellipsoid(R * 0.2, R * 0.11, R * 0.17).at(R * 0.58, -R * 0.16, R * 0.52).blend(0.026)),
      sk(S.capsule([R * 0.05, R * 0.2, R * 0.84], [R * 0.7, R * 0.4, R * 0.46], R * 0.12, R * 0.085).blend(0.014)),            // sly, angled brow
    ]));
    // long hooked nose
    const tip = [0, -R * 0.26 * nl, R * (0.84 + 0.5 * nl)];
    p.push(sk(S.capsule([0, R * 0.04, R * 0.82], tip, R * 0.115, R * 0.07).blend(0.016)));
    p.push(sk(S.sphere(R * 0.078).at(tip[0], tip[1] - R * 0.05, tip[2] + R * 0.01).blend(0.01)));
    p.push(...S.mirrorX([sk(S.sphere(R * 0.085).at(R * 0.13, -R * 0.3, R * 0.95).blend(0.01))]));
    p.push(sk(S.ellipsoid(R * 0.38, R * 0.16, R * 0.2).at(0, -R * 0.52, R * 0.62).blend(0.02)));                              // mouth mound
    p.push(neckStub(B, R, 1.0));
    // ears: huge blades
    const inner = tone(C.skin, -0.06, 0.04, -0.14);
    const earL = earBlade(B, p, [R * 0.8, R * 0.02, -R * 0.1], [0.9, 0.3 - droop, -0.3], R * 0.58 * el, R * 0.21, R * 0.05, inner);
    for (const x of p.slice(-3)) p.push(x.mirrorX());
    if (r() > 0.45) hard.push(H.torus(R * 0.07, R * 0.016, 14, 6).rot(0, 60, 0).at(earL.c[0] - R * 0.1, earL.c[1] - R * 0.24, earL.c[2] + R * 0.02).color(0xc9a23a).pbr(0.35, 1).lod(1));
    if (r() > 0.5) p.push(S.sphere(R * 0.07).at(-(earL.c[0] + R * 0.1), earL.c[1] + R * 0.2, earL.c[2]).cut(0.004).color(inner));    // a notch out of the right ear
    // wide grin with needle teeth
    const base = p.slice();
    const my = -R * 0.53;
    p.push(...S.mirrorX([S.capsule([0, my - R * 0.02, R * 1.0], [R * 0.46, my + R * 0.1, R * 0.62], R * 0.034, R * 0.026).cut(0.004).color(C.mouth)]));
    teethRow(base, hard, [-0.3, -0.18, -0.06, 0.06, 0.18, 0.3].map((x) => x * R), my + R * 0.03, R * 2, R * 0.075, R * 0.022, C.tooth, -1, 0);
    teethRow(base, hard, [-0.26, 0.26].map((x) => x * R), my - R * 0.03, R * 2, R * 0.11, R * 0.028, C.tooth, 1, 0.2);
    p.push(stroke(0, my - R * 0.07, R * 0.8, R * 0.34, R * 0.035, R * 0.22).color(C.lip).paint(0.006, 0.001));
    // eyes: big, yellow, slit pupils
    eyeSet(p, hard, C, { x: R * 0.42, y: R * 0.06, r: R * 0.2, z0: R * 2, yaw: 6, look: { iris: eyeCol, slit: 1, white: 0xe9e2a4, ring: tone(eyeCol, -0.03, 0, -0.2) }, lash: 0x1c2410,
      lidCol: tone(C.skin, 0, 0.02, -0.12), lid: { upper: 44, roll: -13, lower: 20, lowerColor: tone(C.skin, 0, 0.02, 0.04) } });
    // warts and blotches
    const wc = tone(C.skin, -0.01, 0.04, -0.1);
    for (let i = 0; i < 5; i++) { const a = r() * 6.28, q = hit(base, [Math.cos(a) * R * 0.6, R * (0.3 + r() * 0.5), R * 1.6], [0, -0.2, -1]); p.push(wart(q, R * (0.03 + r() * 0.02), wc)); }
    p.push(wart([tip[0] + R * 0.06, tip[1] + R * 0.1, tip[2] - R * 0.08], R * 0.035, wc));
    for (let i = 0; i < 6; i++) p.push(S.sphere(R * (0.1 + r() * 0.1)).at((r() - 0.5) * R * 1.5, R * (0.5 + r() * 0.5), (r() - 0.6) * R * 1.4).color(tone(C.skin, -0.02, 0.02, -0.08)).paint(0.012, 0));
  } else {
    const tusk = boss ? 1.35 : 1, eyeCol = boss ? 0xe04a1a : 0xe8861a;
    // low skull, massive undershot jaw
    p.push(sk(S.ellipsoid(R * 0.88, R * 0.88, R * 0.96).at(0, R * 0.18, -R * 0.08)));
    p.push(sk(S.ellipsoid(R * 0.76, R * 0.74, R * 0.62).at(0, -R * 0.24, R * 0.27).blend(0.025)));
    p.push(sk(S.box(R * 1.36, R * 0.46, R * 0.92, R * 0.2).at(0, -R * 0.66, R * 0.2).blend(0.03)));
    p.push(sk(S.ellipsoid(R * 0.4, R * 0.2, R * 0.22).at(0, -R * 0.8, R * 0.72).blend(0.024)));                               // jutting chin
    p.push(...S.mirrorX([
      sk(S.ellipsoid(R * 0.2, R * 0.12, R * 0.17).at(R * 0.54, -R * 0.2, R * 0.56).blend(0.026)),
      sk(S.capsule([0, R * 0.2, R * 0.92], [R * 0.64, R * 0.27, R * 0.56], R * 0.135, R * 0.1).blend(0.014)),                 // heavy brow
    ]));
    // flat nose, flared nostrils
    p.push(sk(S.ellipsoid(R * 0.17, R * 0.14, R * 0.15).at(0, -R * 0.2, R * 0.96).blend(0.016)));
    p.push(...S.mirrorX([sk(S.sphere(R * 0.1).at(R * 0.15, -R * 0.26, R * 0.9).blend(0.012)), S.sphere(R * 0.05).at(R * 0.085, -R * 0.29, R * 1.04).cut(0.004).color(C.mouth)]));
    p.push(sk(S.ellipsoid(R * 0.4, R * 0.085, R * 0.14).at(0, -R * 0.6, R * 0.88).blend(0.012)));                             // lower lip shelf
    p.push(neckStub(B, R, 1.04));
    const inner = tone(C.skin, -0.05, 0.04, -0.14);
    earBlade(B, p, [R * 0.82, R * 0.0, -R * 0.1], [0.7, 0.5, -0.5], R * 0.36, R * 0.15, R * 0.05, inner);
    for (const x of p.slice(-3)) p.push(x.mirrorX());
    const base = p.slice();
    // mouth line and tusks rising from the lower jaw
    p.push(stroke(0, -R * 0.5, R * 0.9, R * 0.36, R * 0.022, R * 0.2).color(C.mouth).paint(0.003, -0.004));
    p.push(stroke(0, -R * 0.62, R * 0.9, R * 0.34, R * 0.04, R * 0.2).color(C.lip).paint(0.005, 0));
    for (const s of [1, -1]) {
      const q = hit(base, [s * R * 0.27, -R * 0.56, R * 2], [0, 0, -1]);
      hard.push(spike([q[0], q[1] - R * 0.03, q[2] - R * 0.05], [s * 0.16, 1, 0.1], R * 0.34 * tusk, R * 0.07, C.tooth, [0, 0, -1], 0.2).lod(99));
    }
    teethRow(base, hard, [-0.12, 0, 0.12].map((x) => x * R), -R * 0.55, R * 2, R * 0.06, R * 0.03, C.tooth, 1, 0);
    eyeSet(p, hard, C, { x: R * 0.36, y: R * 0.03, r: R * 0.15, z0: R * 2, look: { iris: eyeCol, white: 0xe6dcae, pupilSize: 0.8 }, lash: 0x1a1a10,
      lidCol: tone(C.skin, 0, 0.02, -0.14), lid: { upper: 46, roll: -10, lower: 22 } });
    // scars, war paint
    p.push(stroke(R * 0.3, R * 0.22, R * 0.8, R * 0.018, R * 0.3, R * 0.3, 0, -18).color(tone(C.skin, -0.02, -0.06, 0.12)).paint(0.004, 0.0012));
    p.push(stroke(0, -R * 0.02, R * 0.8, R * 0.7, R * 0.05, R * 0.45).color(0x6e1c14).pbr(0.85).paint(0.005, 0));
    if (boss) p.push(stroke(-R * 0.4, -R * 0.3, R * 0.75, R * 0.016, R * 0.2, R * 0.3, 0, 14).color(tone(C.skin, -0.02, -0.06, 0.12)).paint(0.004, 0.0012));
    // top-knot / mohawk
    if (!(B.o.helm || B.o.hood)) {
      const hc = 0x16130f, hp = [];
      const hair = (x) => x.color(hc).tint(0.2, 30).pbr(0.7).bump(0.008, 36, 'fur');
      for (let i = 0; i < 9; i++) { const a = (-34 + i * 20) * DEG; hp.push(hair(orient(S.ellipsoid(R * 0.2, R * (0.4 - Math.abs(i - 3) * 0.035), R * 0.11), [0, R * (0.2 + 0.98 * Math.cos(a)), R * (-0.08 - 1.0 * Math.sin(a))], [0, Math.cos(a) + 0.25, -Math.sin(a) - 0.55], [1, 0, 0]).blend(0.016))); }
      hairPart = { prims: hp, hard: [] };
    }
  }
  return { prims: p, hard, hair: hairPart };
}

function ghoulHead(B) {
  const { P, C, sk, def } = B;
  const R = P.headR, p = [], hard = [];
  const r = rng(hashStr((def.id || 'ghoul') + ':face'));
  // long skull, narrow face, hollow cheeks
  p.push(sk(S.ellipsoid(R * 0.84, R * 0.94, R * 1.04).at(0, R * 0.2, -R * 0.12)));
  p.push(sk(S.ellipsoid(R * 0.62, R * 0.8, R * 0.56).at(0, -R * 0.28, R * 0.3).blend(0.02)));
  p.push(...S.mirrorX([sk(S.capsule([R * 0.48, -R * 0.46, R * 0.04], [R * 0.11, -R * 0.98, R * 0.56], R * 0.125, R * 0.1).blend(0.02))]));
  p.push(sk(S.ellipsoid(R * 0.17, R * 0.13, R * 0.13).at(0, -R * 1.02, R * 0.62).blend(0.014)));
  p.push(...S.mirrorX([
    sk(S.ellipsoid(R * 0.19, R * 0.1, R * 0.17).at(R * 0.5, -R * 0.2, R * 0.56).blend(0.02)),
    sk(S.capsule([0, R * 0.24, R * 0.86], [R * 0.56, R * 0.3, R * 0.58], R * 0.1, R * 0.075).blend(0.012)),
    S.ellipsoid(R * 0.15, R * 0.24, R * 0.2).at(R * 0.5, -R * 0.56, R * 0.5).cut(0.03).color(C.deep),
  ]));
  p.push(sk(S.capsule([0, R * 0.1, R * 0.84], [0, -R * 0.14, R * 0.92], R * 0.07, R * 0.06).blend(0.012)));                 // what is left of the nose
  p.push(sk(S.ellipsoid(R * 0.3, R * 0.18, R * 0.2).at(0, -R * 0.62, R * 0.66).blend(0.016)));
  p.push(neckStub(B, R, 0.98));
  const inner = 0x4a4440;
  earBlade(B, p, [R * 0.8, R * 0.02, -R * 0.1], [0.6, 0.62, -0.45], R * 0.3, R * 0.12, R * 0.04, inner);
  for (const x of p.slice(-3)) p.push(x.mirrorX());
  p.push(S.sphere(R * 0.06).at(R * 1.12, R * 0.44, -R * 0.36).cut(0.004).color(inner));                                      // torn ear
  const base = p.slice();
  // nasal slits
  const nz = surfZ(base, 0, -R * 0.3, R * 2);
  p.push(...S.mirrorX([S.ellipsoid(R * 0.04, R * 0.11, R * 0.1).rot(0, 0, -14).at(R * 0.065, -R * 0.3, nz).cut(0.004).color(0x15100e)]));
  // lipless mouth full of long teeth
  const my = -R * 0.64;
  p.push(S.ellipsoid(R * 0.36, R * 0.085, R * 0.2).at(0, my, surfZ(base, 0, my, R * 2) - R * 0.02).cut(0.005).color(C.mouth));
  teethRow(base, hard, [-0.27, -0.18, -0.09, 0, 0.09, 0.18, 0.27].map((x) => x * R), my + R * 0.075, R * 2, R * 0.11, R * 0.026, C.tooth, -1, 0);
  teethRow(base, hard, [-0.225, -0.135, -0.045, 0.045, 0.135, 0.225].map((x) => x * R), my - R * 0.075, R * 2, R * 0.09, R * 0.024, C.tooth, 1, 0);
  // sunken sockets with small pale burning eyes
  const ex = R * 0.34, ey = R * 0.02, er = R * 0.12;
  const sz = surfZ(base, ex, ey, R * 2);
  p.push(...S.mirrorX([S.sphere(R * 0.22).at(ex, ey, sz - R * 0.02).cut(0.012).color(0x1c1816)]));
  hard.push(...H.mirrorX([eye(er, { iris: 0xdff2a0, white: 0xb8c890, pupilSize: 0.55, ring: 0x7a9a3a, glow: 0.9 }).at(ex, ey, sz - R * 0.2)]));
  // veins, bruised eye sockets, livid patches
  p.push(...S.mirrorX([
    S.sphere(R * 0.3).at(ex, ey, sz).color(tone(C.skin, 0.7, 0, -0.2)).paint(0.025, 0),
    S.capsule([R * 0.6, R * 0.5, R * 0.5], [R * 0.72, R * 0.2, R * 0.36], R * 0.03).color(0x3c4250).paint(0.004, 0.0012),
    S.capsule([R * 0.66, R * 0.36, R * 0.44], [R * 0.5, R * 0.34, R * 0.66], R * 0.025).color(0x3c4250).paint(0.004, 0.001),
  ]));
  for (let i = 0; i < 5; i++) p.push(S.sphere(R * (0.12 + r() * 0.1)).at((r() - 0.5) * R * 1.4, R * (0.3 + r() * 0.7), (r() - 0.6) * R * 1.6).color(i % 2 ? 0x5a5a6e : 0x6e7a52).paint(0.012, 0));
  return { prims: p, hard, hair: null };
}

function giantHead(B) {
  const { P, C, sk, sp, def } = B;
  const R = P.headR, p = [], hard = [];
  const r = rng(hashStr((def.id || sp) + ':face'));
  let hairPart = null;
  const hairOk = !(B.o.helm || B.o.hood);
  if (sp === 'troll') {
    // tall narrow skull, lantern jaw, a great drooping nose
    p.push(sk(S.ellipsoid(R * 0.82, R * 1.0, R * 0.92).at(0, R * 0.3, -R * 0.1)));
    p.push(sk(S.ellipsoid(R * 0.74, R * 0.9, R * 0.6).at(0, -R * 0.25, R * 0.25).blend(0.025)));
    p.push(sk(S.box(R * 1.24, R * 0.5, R * 0.9, R * 0.22).at(0, -R * 0.82, R * 0.22).blend(0.03)));
    p.push(sk(S.ellipsoid(R * 0.32, R * 0.2, R * 0.2).at(0, -R * 1.04, R * 0.7).blend(0.022)));
    p.push(...S.mirrorX([
      sk(S.ellipsoid(R * 0.2, R * 0.13, R * 0.17).at(R * 0.5, -R * 0.14, R * 0.54).blend(0.026)),
      sk(S.capsule([0, R * 0.32, R * 0.92], [R * 0.6, R * 0.36, R * 0.54], R * 0.145, R * 0.1).blend(0.014)),
    ]));
    const tip = [0, -R * 0.56, R * 1.28];
    p.push(sk(S.capsule([0, R * 0.16, R * 0.86], tip, R * 0.12, R * 0.17).blend(0.016)));
    p.push(sk(S.ellipsoid(R * 0.2, R * 0.22, R * 0.2).at(tip[0], tip[1] - R * 0.04, tip[2] - R * 0.02).blend(0.012)));
    p.push(...S.mirrorX([sk(S.sphere(R * 0.115).at(R * 0.17, -R * 0.5, R * 1.08).blend(0.012))]));
    p.push(sk(S.ellipsoid(R * 0.42, R * 0.1, R * 0.15).at(0, -R * 0.78, R * 0.84).blend(0.014)));                             // heavy lower lip
    p.push(neckStub(B, R, 1.04));
    const inner = tone(C.skin, -0.05, 0.04, -0.14);
    earBlade(B, p, [R * 0.78, R * 0.04, -R * 0.1], [0.78, -0.42, -0.42], R * 0.5, R * 0.17, R * 0.05, inner);
    for (const x of p.slice(-3)) p.push(x.mirrorX());
    const base = p.slice();
    p.push(stroke(0, -R * 0.68, R * 0.86, R * 0.4, R * 0.022, R * 0.22).color(C.mouth).paint(0.003, -0.004));
    p.push(stroke(0, -R * 0.8, R * 0.86, R * 0.38, R * 0.045, R * 0.22).color(C.lip).paint(0.006, 0));
    for (const s of [1, -1]) { const q = hit(base, [s * R * 0.36, -R * 0.74, R * 2], [0, 0, -1]); hard.push(spike([q[0], q[1] - R * 0.04, q[2] - R * 0.06], [s * 0.22, 1, 0.12], R * 0.46, R * 0.085, C.tooth, [0, 0, -1], 0.22).lod(99)); }
    teethRow(base, hard, [-0.14, 0.02, 0.17].map((x) => x * R), -R * 0.72, R * 2, R * 0.07, R * 0.035, C.tooth, 1, 0);
    eyeSet(p, hard, C, { x: R * 0.3, y: R * 0.12, r: R * 0.125, z0: R * 2, look: { iris: 0xb8c832, white: 0xe2dcae, pupilSize: 0.8 }, lash: 0x1a1e12, lidCol: tone(C.skin, 0, 0.02, -0.14), lid: { upper: 48, roll: -4, lower: 26 } });
    const wc = tone(C.skin, -0.01, 0.03, -0.1);
    p.push(wart([R * 0.1, -R * 0.4, R * 1.36], R * 0.05, wc), wart([-R * 0.14, -R * 0.2, R * 1.12], R * 0.04, wc), wart([R * 0.46, -R * 0.4, R * 0.74], R * 0.045, wc), wart([-R * 0.3, R * 0.5, R * 0.78], R * 0.05, wc), wart([R * 0.2, -R * 1.0, R * 0.86], R * 0.04, wc));
    for (let i = 0; i < 5; i++) p.push(S.sphere(R * (0.14 + r() * 0.1)).at((r() - 0.5) * R * 1.4, R * (0.6 + r() * 0.6), (r() - 0.7) * R * 1.4).color(0x4f6a2e).pbr(0.95).paint(0.014, 0));
    if (hairOk) {
      // a shock of mossy dreadlocks: they spring from a matted crown, arch out over the skull and fall to the shoulders,
      // a few strung with bone beads; three greasy strands hang from the chin
      const hcs = [0x34401f, 0x4a5428, 0x2a3218], hp = [], hh = [];
      const hair = (x, j, amp = 0.0055) => x.color(hcs[j % 3]).tint(0.32, 18).pbr(0.88).bump(amp, 46, 'fur');
      hp.push(hair(S.ellipsoid(R * 0.62, R * 0.3, R * 0.7).at(0, R * 1.18, -R * 0.24), 0, 0.008));
      const bead = (q, r, col) => H.cyl(r, r, r * 1.3, 8).color(col).pbr(0.5).lod(1).at(q[0], q[1], q[2]);
      for (let i = 0; i < 13; i++) {
        const t = i / 12, a = (t - 0.5) * 3.9, sa = Math.sin(a), ca = Math.cos(a), len = 0.95 + 0.6 * (((i * 5) % 4) / 3);
        const root = [sa * R * 0.4, R * (1.32 - 0.1 * Math.abs(sa)), -R * 0.24 - ca * R * 0.42];
        const arch = [sa * R * 0.98, R * (1.08 - 0.12 * Math.abs(sa)), -R * 0.14 - ca * R * 1.0];
        const fall = [sa * R * 1.12, R * (0.6 - len * 0.4), -R * 0.12 - ca * R * 1.12];
        const end = [sa * R * 1.18 + Math.sin(i * 2.1) * R * 0.08, R * (0.6 - len), -R * 0.08 - ca * R * 1.2];
        hp.push(hair(bone(root, arch, R * 0.1, R * 0.095).blend(0.01), i), hair(bone(arch, fall, R * 0.095, R * 0.08).blend(0.006), i), hair(bone(fall, end, R * 0.08, R * 0.035).blend(0.004), i));
        if (i % 3 === 1) hh.push(bead(lerp3(fall, end, 0.35), R * 0.1, i % 2 ? 0xd8cba6 : 0x6a4a2a));
      }
      for (let i = -1; i <= 1; i++) hp.push(hair(bone([i * R * 0.14, -R * 1.06, R * 0.7], [i * R * 0.22, -R * (1.5 + Math.abs(i) * -0.1), R * 0.62], R * 0.06, R * 0.02).blend(0.008), 2));
      hairPart = { prims: hp, hard: hh };
    }
  } else if (sp === 'ogre') {
    // small skull lost in jowls and chins
    p.push(sk(S.ellipsoid(R * 0.9, R * 0.92, R * 0.98).at(0, R * 0.2, -R * 0.06)));
    p.push(sk(S.ellipsoid(R * 1.04, R * 0.74, R * 0.8).at(0, -R * 0.42, R * 0.18).blend(0.03)));
    p.push(sk(S.ellipsoid(R * 0.86, R * 0.42, R * 0.66).at(0, -R * 0.92, R * 0.16).blend(0.03)));
    p.push(sk(S.ellipsoid(R * 0.36, R * 0.2, R * 0.2).at(0, -R * 0.82, R * 0.86).blend(0.02)));
    p.push(...S.mirrorX([
      sk(S.ellipsoid(R * 0.3, R * 0.26, R * 0.26).at(R * 0.56, -R * 0.42, R * 0.6).blend(0.03)),                             // cheeks
      sk(S.capsule([0, R * 0.26, R * 0.92], [R * 0.6, R * 0.3, R * 0.58], R * 0.135, R * 0.1).blend(0.014)),
      sk(S.ellipsoid(R * 0.1, R * 0.2, R * 0.16).rot(-10, 26, 0).at(R * 0.94, -R * 0.02, -R * 0.05).blend(0.012)),
      S.ellipsoid(R * 0.05, R * 0.11, R * 0.08).rot(-10, 26, 0).at(R * 1.02, -R * 0.02, -R * 0.02).cut(0.006).color(C.shade),
    ]));
    p.push(sk(S.ellipsoid(R * 0.21, R * 0.17, R * 0.17).at(0, -R * 0.18, R * 1.0).blend(0.016)));
    p.push(...S.mirrorX([sk(S.sphere(R * 0.125).at(R * 0.18, -R * 0.24, R * 0.94).blend(0.012)), S.sphere(R * 0.055).at(R * 0.1, -R * 0.3, R * 1.1).cut(0.004).color(C.mouth)]));
    p.push(sk(S.ellipsoid(R * 0.44, R * 0.1, R * 0.16).at(0, -R * 0.64, R * 0.94).blend(0.012)));
    p.push(neckStub(B, R, 1.1));
    const base = p.slice();
    p.push(stroke(0, -R * 0.54, R * 0.96, R * 0.42, R * 0.022, R * 0.26).color(C.mouth).paint(0.003, -0.004));
    p.push(stroke(0, -R * 0.66, R * 0.96, R * 0.4, R * 0.045, R * 0.26).color(C.lip).paint(0.006, 0));
    for (const s of [1, -1]) { const q = hit(base, [s * R * 0.24, -R * 0.6, R * 2], [0, 0, -1]); hard.push(spike([q[0], q[1] - R * 0.03, q[2] - R * 0.06], [s * 0.1, 1, 0.1], R * 0.22, R * 0.075, C.tooth, [0, 0, -1], 0.1).lod(99)); }
    eyeSet(p, hard, C, { x: R * 0.32, y: R * 0.08, r: R * 0.115, z0: R * 2, look: { iris: 0x5a4020, pupilSize: 0.9 }, lash: 0x1e1610, lidCol: tone(C.skin, 0, 0.02, -0.12), lid: { upper: 48, roll: 3, lower: 28 } });
    p.push(S.ellipsoid(R * 0.86, R * 0.4, R * 0.7).at(0, -R * 0.78, R * 0.4).color(mix(C.skin, 0x2a2018, 0.3)).paint(0.03, 0));       // stubble
    const crease = (a, b, r) => S.capsule(a, b, R * r).color(tone(C.skin, -0.01, 0.03, -0.2)).paint(0.006, -0.0045);
    p.push(crease([-R * 0.3, R * 0.52, R * 0.84], [R * 0.3, R * 0.52, R * 0.84], 0.022), crease([-R * 0.22, R * 0.62, R * 0.8], [R * 0.22, R * 0.62, R * 0.8], 0.018));   // furrowed brow
    p.push(...S.mirrorX([crease([R * 0.26, -R * 0.2, R * 0.98], [R * 0.4, -R * 0.6, R * 0.86], 0.024), crease([R * 0.5, R * 0.1, R * 0.74], [R * 0.62, R * 0.04, R * 0.6], 0.016)]));   // folds beside the nose, crow's feet
    p.push(crease([-R * 0.22, -R * 0.96, R * 0.92], [R * 0.22, -R * 0.96, R * 0.92], 0.022));                                      // chin
    p.push(stroke(-R * 0.34, R * 0.34, R * 0.8, R * 0.018, R * 0.26, R * 0.3, 0, 12).color(tone(C.skin, -0.02, -0.06, 0.1)).paint(0.004, 0.0012));
    if (hairOk) {
      // greasy top-knot bound with a thong
      const hc = 0x17130f, hp = [];
      const hair = (x) => x.color(hc).tint(0.2, 30).pbr(0.6).bump(0.008, 36, 'fur');
      hp.push(hair(S.ellipsoid(R * 0.5, R * 0.16, R * 0.56).at(0, R * 1.04, -R * 0.1)));
      hp.push(hair(S.sphere(R * 0.26).at(0, R * 1.3, -R * 0.2).blend(0.02)));
      hp.push(hair(S.capsule([0, R * 1.34, -R * 0.3], [0, R * 0.9, -R * 1.02], R * 0.14, R * 0.06).blend(0.02)));
      hp.push(S.cyl(R * 0.3, R * 0.07).at(0, R * 1.12, -R * 0.14).color(0x7a2a1e).paint(0.004, 0.003));
      hairPart = { prims: hp, hard: [] };
    }
  } else {
    // cyclops: one great eye under a single heavy brow
    p.push(sk(S.ellipsoid(R * 0.9, R * 0.96, R * 0.98).at(0, R * 0.2, -R * 0.08)));
    p.push(sk(S.ellipsoid(R * 0.76, R * 0.86, R * 0.62).at(0, -R * 0.3, R * 0.28).blend(0.022)));
    p.push(...S.mirrorX([sk(S.capsule([R * 0.6, -R * 0.5, R * 0.02], [R * 0.17, -R * 0.95, R * 0.62], R * 0.19, R * 0.16).blend(0.024))]));
    p.push(sk(S.ellipsoid(R * 0.5, R * 0.3, R * 0.48).at(0, -R * 0.7, R * 0.22).blend(0.02)));
    p.push(sk(S.ellipsoid(R * 0.27, R * 0.17, R * 0.17).at(0, -R * 0.99, R * 0.7).blend(0.018)));
    p.push(...S.mirrorX([
      sk(S.ellipsoid(R * 0.22, R * 0.13, R * 0.18).at(R * 0.5, -R * 0.26, R * 0.56).blend(0.03)),
      sk(S.capsule([0, R * 0.52, R * 0.92], [R * 0.62, R * 0.3, R * 0.56], R * 0.16, R * 0.1).blend(0.016)),                  // one brow arching over the eye
      sk(S.ellipsoid(R * 0.08, R * 0.25, R * 0.17).rot(-12, 22, 0).at(R * 0.9, -R * 0.06, -R * 0.06).blend(0.01)),
      S.ellipsoid(R * 0.05, R * 0.15, R * 0.09).rot(-12, 22, 0).at(R * 0.98, -R * 0.05, -R * 0.03).cut(0.006).color(C.shade),
    ]));
    p.push(sk(S.capsule([0, -R * 0.22, R * 0.9], [0, -R * 0.46, R * 1.06], R * 0.1, R * 0.13).blend(0.016)));
    p.push(...S.mirrorX([sk(S.sphere(R * 0.1).at(R * 0.15, -R * 0.5, R * 0.96).blend(0.01)), S.sphere(R * 0.045).at(R * 0.085, -R * 0.56, R * 1.04).color(C.deep).paint(0.003, 0)]));
    p.push(sk(S.ellipsoid(R * 0.34, R * 0.2, R * 0.2).at(0, -R * 0.74, R * 0.7).blend(0.018)));
    p.push(neckStub(B, R, 1.04));
    const base = p.slice();
    p.push(stroke(0, -R * 0.74, R * 0.9, R * 0.3, R * 0.022, R * 0.2).color(C.mouth).paint(0.003, -0.004));
    p.push(stroke(0, -R * 0.82, R * 0.88, R * 0.22, R * 0.05, R * 0.2).color(C.lip).paint(0.005, 0.002));
    teethRow(base, hard, [-0.18, 0.18].map((x) => x * R), -R * 0.77, R * 2, R * 0.1, R * 0.04, C.tooth, 1, 0.1);
    eyeSet(p, hard, C, { single: 1, x: 0, y: R * 0.1, r: R * 0.3, z0: R * 2, sink: 0.12, wide: 1.16, tall: 0.86, look: { iris: 0xc8862a, ring: 0x5a3410 }, lash: 0x241810, lidCol: tone(C.skin, -0.01, 0.03, -0.1), lid: { upper: 44, lower: 24, roll: 0 } });
    const hc = 0x2a1e16;
    p.push(...S.mirrorX([stroke(R * 0.3, R * 0.5, R * 0.86, R * 0.36, R * 0.06, R * 0.24, 22, -18).color(hc).pbr(0.9).paint(0.005, 0.003)]));   // the brow hair
    p.push(S.ellipsoid(R * 0.76, R * 0.4, R * 0.62).at(0, -R * 0.84, R * 0.34).color(mix(C.skin, hc, 0.3)).paint(0.025, 0));
    if (hairOk) {
      // bald crown ringed by a horseshoe of shaggy locks from ear to ear, with bushy sideburns down to the jaw
      const hp = [], hc = 0x4a2e1c;
      const hair = (x, amp = 0.0075) => x.color(hc).tint(0.3, 24).pbr(0.82).bump(amp, 44, 'fur');
      hp.push(hair(S.ellipsoid(R * 0.96, R * 1.02, R * 1.05).at(0, R * 0.2, -R * 0.1), 0.006));        // the mat the locks grow from
      hp.push(S.ellipsoid(R * 0.86, R * 0.62, R * 1.0).at(0, R * 0.86, -R * 0.02).cut(0.02).color(hc));     // the bald crown
      hp.push(S.box(R * 3, R * 3, R * 2, 0).at(0, 0, R * 1.02).cut(0.016).color(hc));                     // nothing in front of the ears
      hp.push(S.box(R * 3, R * 2, R * 3, 0).rot(-14, 0, 0).at(0, -R * 1.42, 0).cut(0.02).color(hc));      // nape
      for (let i = 0; i < 15; i++) {
        const t = i / 14, a = (t - 0.5) * 4.3, sa = Math.sin(a), ca = Math.cos(a), lk = 0.42 + 0.3 * (((i * 7) % 5) / 4);
        const y0 = R * (0.36 - 0.12 * Math.abs(sa)), out = 1.06 + 0.05 * (i % 2);
        const root = [sa * R * 0.9, y0, -R * 0.1 - ca * R * 0.96], mid = [sa * R * out, y0 - R * lk * 0.55, -R * 0.1 - ca * R * (out + 0.04)];
        const tip = [sa * R * (out + 0.1), y0 - R * lk, -R * 0.1 - ca * R * (out + 0.14)];
        hp.push(hair(bone(root, mid, R * 0.15, R * 0.12).blend(0.01)), hair(bone(mid, tip, R * 0.12, R * 0.035).blend(0.006)));
      }
      for (const sx of [1, -1]) hp.push(hair(bone([sx * R * 0.86, R * 0.06, R * 0.02], [sx * R * 0.8, -R * 0.62, R * 0.24], R * 0.13, R * 0.06).blend(0.012)));
      hairPart = { prims: hp, hard: [] };
    }
  }
  return { prims: p, hard, hair: hairPart };
}

function bullHead(B) {
  const { P, C, sk } = B;
  const R = P.headR, p = [], hard = [];
  const fur = B.fur, pale = (x) => sk(x).color(C.light);
  // skull, broad brow, long muzzle and lower jaw
  p.push(sk(S.ellipsoid(R * 0.88, R * 0.86, R * 0.9).at(0, R * 0.16, -R * 0.1)));
  p.push(sk(S.ellipsoid(R * 0.72, R * 0.5, R * 0.42).at(0, R * 0.3, R * 0.48).blend(0.03)));
  p.push(sk(S.capsule([0, -R * 0.02, R * 0.5], [0, -R * 0.58, R * 1.18], R * 0.5, R * 0.36).blend(0.04)));
  p.push(...S.mirrorX([
    sk(S.ellipsoid(R * 0.3, R * 0.38, R * 0.32).at(R * 0.54, -R * 0.4, R * 0.2).blend(0.03)),                                // jaw muscle
    sk(S.capsule([R * 0.2, R * 0.24, R * 0.82], [R * 0.74, R * 0.24, R * 0.4], R * 0.14, R * 0.11).blend(0.016)),            // brow over each eye
  ]));
  p.push(pale(S.capsule([0, -R * 0.56, R * 0.3], [0, -R * 0.96, R * 1.04], R * 0.3, R * 0.23).blend(0.014)));               // lower jaw
  p.push(S.ellipsoid(R * 0.37, R * 0.27, R * 0.21).at(0, -R * 0.64, R * 1.36).color(0x2a1c1a).pbr(0.35).tint(0.1, 40).blend(0.02));   // wet nose pad
  p.push(pale(S.ellipsoid(R * 0.3, R * 0.2, R * 0.3).at(0, -R * 0.46, R * 1.12).blend(0.03)));
  p.push(neckStub(B, R, 1.1, -0.2));
  // ears
  const inner = tone(C.skin, 0.02, 0.05, 0.1);
  earBlade(B, p, [R * 0.74, R * 0.2, -R * 0.26], [0.92, -0.14, -0.3], R * 0.34, R * 0.15, R * 0.05, inner);
  for (const x of p.slice(-3)) p.push(x.mirrorX());
  const base = p.slice();
  // nostrils, mouth line
  p.push(...S.mirrorX([S.ellipsoid(R * 0.085, R * 0.055, R * 0.1).rot(0, 0, 28).at(R * 0.16, -R * 0.6, surfZ(base, R * 0.16, -R * 0.6, R * 2.4)).cut(0.006).color(0x120c0c)]));
  p.push(...S.mirrorX([S.capsule([R * 0.02, -R * 0.84, R * 1.3], [R * 0.36, -R * 0.66, R * 0.56], R * 0.03).color(0x1c1210).paint(0.004, -0.004)]));
  p.push(S.ellipsoid(R * 0.4, R * 0.3, R * 0.5).at(0, -R * 0.5, R * 1.0).color(C.light).paint(0.06, 0));                          // the muzzle pales toward the nose
  p.push(...S.mirrorX([S.sphere(R * 0.24).at(R * 0.5, R * 0.02, R * 0.66).color(tone(C.skin, 0, 0, -0.08)).paint(0.04, 0)]));          // dark rings round the eyes
  // forelock and shaggy cheeks
  p.push(fur(S.ellipsoid(R * 0.5, R * 0.3, R * 0.4).at(0, R * 0.82, R * 0.2).blend(0.03), 0.014));
  p.push(fur(S.ellipsoid(R * 0.3, R * 0.36, R * 0.2).rot(30, 0, 0).at(0, R * 0.52, R * 0.74).blend(0.03), 0.012));
  p.push(fur(S.ellipsoid(R * 0.86, R * 0.7, R * 0.5).at(0, R * 0.1, -R * 0.62).blend(0.03), 0.014));
  p.push(...S.mirrorX([fur(S.ellipsoid(R * 0.2, R * 0.4, R * 0.36).at(R * 0.7, -R * 0.5, -R * 0.1).blend(0.03), 0.012)]));
  // horns: out, forward and up
  const hl = B.o.build === 'heavy' ? 1.2 : 1;
  const pts = [[0.6, 0.5, -0.06], [1.22, 0.58, -0.02], [1.66, 0.9, 0.3], [1.74, 1.42 * hl, 0.72 * hl]].map((q) => mul3(q, R));
  const hp = [], hh = [];
  horn(hp, hh, pts, [R * 0.21, R * 0.17, R * 0.11, 0], C.horn, 0x3a2e24, 0.005);
  p.push(...hp, ...hp.map((x) => x.mirrorX())); hard.push(...hh, ...hh.map((x) => x.mirrorX()));
  // eyes, set wide and glaring
  eyeSet(p, hard, C, { x: R * 0.5, y: R * 0.02, r: R * 0.135, z0: R * 2, yaw: 24, look: { iris: 0xb8361a, white: 0x2a1614, ring: 0x3a100a, pupilSize: 0.9, glow: 0.35 }, lash: 0x120c0a, lidCol: tone(C.skin, 0, 0, -0.1), lid: { upper: 46, roll: -10, lower: 20 } });
  // brass ring through the nose
  hard.push(H.torus(R * 0.15, R * 0.026, 20, 8).at(0, -R * 0.9, R * 1.46).color(0xc9a23a).pbr(0.3, 1));
  return { prims: p, hard, hair: null };
}

function fiendHead(B) {
  const { P, C, sk, sp, def } = B;
  const R = P.headR, p = [], hard = [];
  const imp = sp === 'imp', lord = B.lord;
  if (imp) {
    p.push(sk(S.ellipsoid(R * 0.92, R * 0.86, R * 0.94).at(0, R * 0.14, -R * 0.06)));
    p.push(sk(S.ellipsoid(R * 0.76, R * 0.66, R * 0.6).at(0, -R * 0.24, R * 0.26).blend(0.03)));
    p.push(...S.mirrorX([sk(S.capsule([R * 0.5, -R * 0.4, R * 0.1], [R * 0.1, -R * 0.84, R * 0.52], R * 0.15, R * 0.11).blend(0.022))]));
    p.push(sk(S.ellipsoid(R * 0.34, R * 0.24, R * 0.34).at(0, -R * 0.6, R * 0.28).blend(0.02)));
    p.push(sk(S.ellipsoid(R * 0.15, R * 0.2, R * 0.14).at(0, -R * 0.92, R * 0.56).blend(0.016)));                             // pointed chin
    p.push(...S.mirrorX([
      sk(S.ellipsoid(R * 0.2, R * 0.11, R * 0.17).at(R * 0.56, -R * 0.16, R * 0.52).blend(0.026)),
      sk(S.capsule([R * 0.06, R * 0.18, R * 0.84], [R * 0.68, R * 0.46, R * 0.46], R * 0.115, R * 0.08).blend(0.014)),
    ]));
    p.push(sk(S.sphere(R * 0.1).at(0, -R * 0.16, R * 0.98).blend(0.014)));                                                   // snub nose
    p.push(sk(S.ellipsoid(R * 0.36, R * 0.16, R * 0.2).at(0, -R * 0.5, R * 0.62).blend(0.02)));
    p.push(neckStub(B, R, 1.0));
    const inner = tone(C.skin, 0.02, 0, -0.16);
    earBlade(B, p, [R * 0.8, R * 0.04, -R * 0.1], [0.85, 0.5, -0.25], R * 0.52, R * 0.18, R * 0.05, inner);
    for (const x of p.slice(-3)) p.push(x.mirrorX());
    const base = p.slice();
    p.push(...S.mirrorX([S.sphere(R * 0.035).at(R * 0.05, -R * 0.2, R * 1.07).color(C.mouth).paint(0.003, 0)]));
    // a grin too wide for the face
    const my = -R * 0.5;
    p.push(...S.mirrorX([S.capsule([0, my - R * 0.05, R * 1.0], [R * 0.5, my + R * 0.14, R * 0.56], R * 0.04, R * 0.028).cut(0.004).color(C.mouth)]));
    teethRow(base, hard, [-0.34, -0.22, -0.1, 0.1, 0.22, 0.34].map((x) => x * R), my + R * 0.04, R * 2, R * 0.09, R * 0.026, C.tooth, -1, 0);
    teethRow(base, hard, [-0.28, -0.16, 0.16, 0.28].map((x) => x * R), my - R * 0.04, R * 2, R * 0.08, R * 0.024, C.tooth, 1, 0);
    eyeSet(p, hard, C, { x: R * 0.4, y: R * 0.05, r: R * 0.2, z0: R * 2, yaw: 6, look: { iris: 0xffd21e, white: 0xf2c84a, slit: 1, ring: 0xd86a10, glow: 0.7 }, lash: 0x1a0808,
      lidCol: tone(C.skin, 0, 0, -0.14), lid: { upper: 42, roll: -16, lower: 18 } });
    const hp = [], hh = [];
    horn(hp, hh, [[0.36, 0.72, 0.2], [0.5, 1.04, 0.24], [0.5, 1.3, 0.4]].map((q) => mul3(q, R)), [R * 0.12, R * 0.085, 0], 0x3a1c18, C.horn, 0.003);
    p.push(...hp, ...hp.map((x) => x.mirrorX())); hard.push(...hh, ...hh.map((x) => x.mirrorX()));
  } else {
    // demon: a skull-like mask of ridges, fangs and horn
    p.push(sk(S.ellipsoid(R * 0.86, R * 0.94, R * 0.98).at(0, R * 0.2, -R * 0.08)));
    p.push(sk(S.ellipsoid(R * 0.7, R * 0.84, R * 0.6).at(0, -R * 0.3, R * 0.28).blend(0.022)));
    p.push(...S.mirrorX([sk(S.capsule([R * 0.58, -R * 0.46, R * 0.02], [R * 0.13, -R * 0.98, R * 0.6], R * 0.16, R * 0.12).blend(0.02))]));
    p.push(sk(S.ellipsoid(R * 0.44, R * 0.28, R * 0.44).at(0, -R * 0.7, R * 0.24).blend(0.02)));
    p.push(sk(S.ellipsoid(R * 0.17, R * 0.26, R * 0.16).at(0, -R * 1.08, R * 0.66).blend(0.016)));                            // long chin
    p.push(...S.mirrorX([
      sk(S.ellipsoid(R * 0.21, R * 0.1, R * 0.18).at(R * 0.54, -R * 0.16, R * 0.56).blend(0.02)),
      sk(S.capsule([R * 0.04, R * 0.16, R * 0.9], [R * 0.68, R * 0.46, R * 0.5], R * 0.14, R * 0.09).blend(0.014)),           // scowling brow
      S.ellipsoid(R * 0.13, R * 0.22, R * 0.16).at(R * 0.54, -R * 0.56, R * 0.6).cut(0.03).color(C.shade),
    ]));
    p.push(sk(S.capsule([0, R * 0.04, R * 0.86], [0, -R * 0.3, R * 1.0], R * 0.09, R * 0.12).blend(0.014)));
    p.push(...S.mirrorX([sk(S.sphere(R * 0.085).at(R * 0.12, -R * 0.34, R * 0.94).blend(0.01))]));
    p.push(sk(S.ellipsoid(R * 0.32, R * 0.18, R * 0.2).at(0, -R * 0.64, R * 0.7).blend(0.016)));
    p.push(sk(S.capsule([0, R * 0.5, R * 0.78], [0, R * 1.0, R * 0.1], R * 0.08, R * 0.06).blend(0.014)));                    // crest ridge
    p.push(neckStub(B, R, 1.06));
    const inner = tone(C.skin, 0.02, 0, -0.16);
    earBlade(B, p, [R * 0.8, R * 0.02, -R * 0.1], [0.62, 0.5, -0.6], R * 0.4, R * 0.14, R * 0.045, inner);
    for (const x of p.slice(-3)) p.push(x.mirrorX());
    const base = p.slice();
    p.push(...S.mirrorX([S.ellipsoid(R * 0.04, R * 0.09, R * 0.1).rot(0, 0, -20).at(R * 0.075, -R * 0.36, surfZ(base, R * 0.075, -R * 0.36, R * 2)).cut(0.004).color(0x120808)]));
    // snarl: fangs above, tusks below
    const my = -R * 0.66;
    p.push(S.ellipsoid(R * 0.34, R * 0.07, R * 0.2).at(0, my, surfZ(base, 0, my, R * 2) - R * 0.02).cut(0.005).color(C.mouth));
    teethRow(base, hard, [-0.1, 0.1].map((x) => x * R), my + R * 0.06, R * 2, R * 0.08, R * 0.03, C.tooth, -1, 0);
    teethRow(base, hard, [-0.25, 0.25].map((x) => x * R), my + R * 0.07, R * 2, R * 0.19, R * 0.04, C.tooth, -1, 0.1);
    teethRow(base, hard, [-0.17, 0.17].map((x) => x * R), my - R * 0.06, R * 2, R * 0.14, R * 0.036, C.tooth, 1, 0.15);
    eyeSet(p, hard, C, { x: R * 0.36, y: R * 0.03, r: R * 0.15, z0: R * 2, look: { iris: 0xff9a1e, white: 0xffd86a, slit: 1, ring: 0xe04a0a, glow: 1.3 }, lash: 0x120606, socket: 0x1a0a0a,
      lidCol: tone(C.skin, 0, 0, -0.16), lid: { upper: 48, roll: -18, lower: 20 } });
    // bone spurs: brow, chin, crest
    for (const s of [1, -1]) for (let i = 0; i < 3; i++) { const q = hit(base, [s * R * (0.2 + i * 0.2), R * (0.36 + i * 0.1), R * 2], [0, 0, -1]); hard.push(spike([q[0], q[1], q[2] - R * 0.04], [s * 0.3, 0.9, 0.5], R * (0.16 - i * 0.02), R * 0.045, C.horn, [0, 1, 0], 0.2)); }
    hard.push(spike([0, -R * 1.24, R * 0.7], [0, -1, 0.3], R * 0.3, R * 0.07, C.horn, [0, 0, 1], 0.25).lod(99));
    for (let i = 0; i < 4; i++) hard.push(spike([0, R * (1.0 + 0.06 * i - i * i * 0.03), R * (0.34 - i * 0.3)], [0, 1, -0.2 - i * 0.3], R * (0.3 - i * 0.03), R * 0.06, C.horn, [0, 0, -1], 0.25));
    // great horns sweeping back, out and up
    const hs = lord ? 1.25 : 1;
    const pts = [[0.5, 0.66, -0.02], [1.02, 0.96, -0.3], [1.3, 1.6, -0.3], [1.12, 2.2, 0.16]].map((q) => [q[0] * R * hs, q[1] * R * (0.4 + 0.6 * hs), q[2] * R * hs]);
    const hp = [], hh = [];
    horn(hp, hh, pts, [R * 0.25 * hs, R * 0.2 * hs, R * 0.13 * hs, 0], 0x3a2420, C.horn, 0.006);
    if (lord) horn(hp, hh, [[0.66, -0.3, 0.1], [1.04, -0.36, 0.34], [1.2, -0.1, 0.8]].map((q) => mul3(q, R)), [R * 0.15, R * 0.11, 0], 0x3a2420, C.horn, 0.004);   // a second pair, thrust forward from the jaw
    p.push(...hp, ...hp.map((x) => x.mirrorX())); hard.push(...hh, ...hh.map((x) => x.mirrorX()));
    if (lord) p.push(...S.mirrorX([S.capsule([R * 0.3, R * 0.5, R * 0.8], [R * 0.5, R * 0.1, R * 0.74], R * 0.035).color(C.ember).glow(1.6).paint(0.004, 0), S.capsule([R * 0.5, R * 0.1, R * 0.74], [R * 0.62, -R * 0.4, R * 0.5], R * 0.03).color(C.ember).glow(1.6).paint(0.004, 0)]));
  }
  return { prims: p, hard, hair: null };
}


// =====================================================================================
//  The wider races: orc, lizard, rat, goat, tiger, mummy (elf and dwarf are built on the human head)
// =====================================================================================

/** whiskers: thin tapering rods fanned from a muzzle pad at (+-root), close level only */
function whiskers(hard, root, R, color, n = 3, len = 0.9) {
  for (const s of [1, -1]) for (let i = 0; i < n; i++) {
    const a = (i - (n - 1) / 2) * 0.34, L = R * len * (1 - Math.abs(i - (n - 1) / 2) * 0.12);
    hard.push(orient(H.cyl(R * 0.004, R * 0.014, L, 4).at(0, L / 2, 0), [s * root[0], root[1] + (i - (n - 1) / 2) * R * 0.05, root[2]], [s, Math.sin(a) * 0.55 - 0.08, 0.16 - i * 0.14]).color(color).pbr(0.6).lod(0));
  }
}
/** a round, cupped ear: a thick disc with a hollowed inner face, plus a flat stand-in for the farthest level (left side; mirror the prims) */
function roundEar(B, at, rw, rh, thick, rot, back, inner) {
  const out = [
    S.ellipsoid(rw, rh, thick).rot(rot[0], rot[1], rot[2]).at(at[0], at[1], at[2]).color(back).tint(0.12, 30).pbr(0.8).blend(0.012),
  ];
  const e = new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'), off = new THREE.Vector3(0, -rh * 0.06, thick * 0.9).applyEuler(e);
  out.push(S.ellipsoid(rw * 0.7, rh * 0.72, thick * 0.9).rot(rot[0], rot[1], rot[2]).at(at[0] + off.x, at[1] + off.y, at[2] + off.z).cut(0.006).color(inner));
  const far = H.cyl(rw * 0.9, rw * 0.9, thick * 0.8, 7).rot(90, 0, 0).scale(1, rh / rw, 1).rot(rot[0], rot[1], rot[2]).at(at[0], at[1], at[2]).color(back).pbr(0.8).far();
  (B.farHard ||= []).push(far, far.mirrorX());
  return out;
}

function orcHead(B) {
  const { P, C, sk, def, o } = B;
  const R = P.headR, p = [], hard = [];
  const r = rng(hashStr((def.id || 'orc') + ':face'));
  const boss = o.build === 'heavy', tusk = (boss ? 1.3 : 1) * (0.92 + r() * 0.22), eyeCol = [0xd8421a, 0xe8861a, 0xc8a01e][Math.floor(r() * 3)];
  // a small flat-topped skull sunk between the shoulders, a slab of brow, and a jaw wider than the skull that juts past the upper lip
  p.push(sk(S.ellipsoid(R * 0.86, R * 0.84, R * 0.96).at(0, R * 0.2, -R * 0.1)));
  p.push(sk(S.ellipsoid(R * 0.78, R * 0.72, R * 0.62).at(0, -R * 0.2, R * 0.28).blend(0.025)));
  p.push(sk(S.box(R * 1.66, R * 0.58, R * 1.02, R * 0.24).at(0, -R * 0.68, R * 0.26).blend(0.03)));
  p.push(sk(S.box(R * 0.92, R * 0.38, R * 0.42, R * 0.15).at(0, -R * 0.82, R * 0.86).blend(0.028)));                          // square chin thrust forward
  p.push(...S.mirrorX([
    sk(S.ellipsoid(R * 0.24, R * 0.32, R * 0.3).at(R * 0.72, -R * 0.5, R * 0.12).blend(0.03)),                               // jaw muscle
    sk(S.ellipsoid(R * 0.22, R * 0.12, R * 0.18).at(R * 0.56, -R * 0.12, R * 0.58).blend(0.026)),                            // cheekbone
    sk(S.capsule([0, R * 0.2, R * 0.98], [R * 0.68, R * 0.26, R * 0.56], R * 0.16, R * 0.115).blend(0.014)),                  // brow like a lintel
  ]));
  p.push(sk(S.capsule([0, R * 0.56, R * 0.7], [0, R * 0.98, -R * 0.2], R * 0.09, R * 0.07).blend(0.02)));                    // ridge over the crown
  // short upturned snout
  p.push(sk(S.ellipsoid(R * 0.2, R * 0.15, R * 0.17).rot(-18, 0, 0).at(0, -R * 0.14, R * 0.99).blend(0.016)));
  p.push(...S.mirrorX([sk(S.sphere(R * 0.105).at(R * 0.16, -R * 0.2, R * 0.93).blend(0.012)), S.sphere(R * 0.052).at(R * 0.085, -R * 0.2, R * 1.1).cut(0.004).color(C.mouth)]));
  p.push(sk(S.ellipsoid(R * 0.52, R * 0.1, R * 0.17).at(0, -R * 0.6, R * 0.98).blend(0.012)));                               // lower lip shelf
  p.push(neckStub(B, R, 1.08));
  const inner = tone(C.skin, -0.04, 0.04, -0.15);
  earBlade(B, p, [R * 0.84, R * 0.04, -R * 0.12], [0.62, 0.55, -0.56], R * 0.24, R * 0.12, R * 0.05, inner);
  for (const x of p.slice(-3)) p.push(x.mirrorX());
  if (r() > 0.5) p.push(S.sphere(R * 0.06).at(R * 1.08, R * 0.3, -R * 0.36).cut(0.004).color(inner));                         // a bite out of one ear
  const base = p.slice();
  p.push(stroke(0, -R * 0.47, R * 0.96, R * 0.44, R * 0.024, R * 0.26).color(C.mouth).paint(0.003, -0.0045));
  p.push(stroke(0, -R * 0.61, R * 1.0, R * 0.42, R * 0.045, R * 0.24).color(C.lip).paint(0.005, 0));
  // tusks from the lower jaw, a row of blunt teeth between them
  for (const s of [1, -1]) {
    const q = hit(base, [s * R * 0.36, -R * 0.56, R * 2], [0, 0, -1]);
    hard.push(spike([q[0], q[1] - R * 0.05, q[2] - R * 0.07], [s * 0.2, 1, 0.16], R * 0.42 * tusk * (s < 0 && r() > 0.7 ? 0.6 : 1), R * 0.085, C.tooth, [0, 0, -1], 0.24).lod(99));
  }
  teethRow(base, hard, [-0.2, -0.07, 0.07, 0.2].map((x) => x * R), -R * 0.54, R * 2, R * 0.065, R * 0.034, C.tooth, 1, 0);
  eyeSet(p, hard, C, { x: R * 0.35, y: R * 0.03, r: R * 0.13, z0: R * 2, look: { iris: eyeCol, white: 0xe6dcae, pupilSize: 0.75 }, lash: 0x16160e,
    lidCol: tone(C.skin, 0, 0.02, -0.16), socket: tone(C.skin, -0.01, 0.02, -0.14), lid: { upper: 48, roll: -12, lower: 24 } });
  // scars and weathering
  const scar = tone(C.skin, -0.02, -0.08, 0.13);
  p.push(stroke(-R * 0.32, R * 0.16, R * 0.8, R * 0.018, R * 0.34, R * 0.3, 0, 16).color(scar).paint(0.004, 0.0012));
  if (r() > 0.4) p.push(stroke(R * 0.46, -R * 0.36, R * 0.74, R * 0.2, R * 0.016, R * 0.3, 0, 30).color(scar).paint(0.004, 0.0012));
  for (let i = 0; i < 6; i++) p.push(S.sphere(R * (0.1 + r() * 0.1)).at((r() - 0.5) * R * 1.5, R * (0.4 + r() * 0.6), (r() - 0.6) * R * 1.4).color(tone(C.skin, -0.015, 0.02, -0.08)).paint(0.012, 0));
  p.push(S.ellipsoid(R * 0.8, R * 0.36, R * 0.66).at(0, -R * 0.8, R * 0.4).color(tone(C.skin, -0.01, -0.04, -0.07)).paint(0.03, 0));       // dark jowls
  return { prims: p, hard, hair: humanHair(B, B.face, B.face.hairCol ?? 0x16130f) };
}

function lizardHead(B) {
  const { P, C, sk, def, o } = B;
  const R = P.headR, p = [], hard = [];
  const r = rng(hashStr((def.id || 'lizard') + ':face'));
  const belly = (x) => sk(x).color(C.light);
  // low wedge of a skull drawn out into a long, deep snout; the lower jaw is a separate, paler bar
  p.push(sk(S.ellipsoid(R * 0.8, R * 0.72, R * 0.92).at(0, R * 0.16, -R * 0.12)));
  p.push(sk(S.capsule([0, R * 0.06, R * 0.36], [0, -R * 0.26, R * 1.52], R * 0.5, R * 0.27).blend(0.04)));
  p.push(sk(S.ellipsoid(R * 0.3, R * 0.2, R * 0.26).at(0, -R * 0.2, R * 1.62).blend(0.03)));                                  // bulb of the nose
  p.push(...S.mirrorX([
    sk(S.ellipsoid(R * 0.3, R * 0.36, R * 0.36).at(R * 0.56, -R * 0.34, R * 0.1).blend(0.03)),                               // jaw muscle
    sk(S.capsule([R * 0.16, R * 0.34, R * 0.92], [R * 0.74, R * 0.5, R * 0.02], R * 0.13, R * 0.1).blend(0.014)),             // bony ridge over the eye, running back
    sk(S.sphere(R * 0.085).at(R * 0.14, -R * 0.06, R * 1.72).blend(0.012)),                                                  // nostril mound
  ]));
  p.push(belly(S.capsule([0, -R * 0.56, R * 0.12], [0, -R * 0.66, R * 1.4], R * 0.34, R * 0.2).blend(0.01)));                // lower jaw
  p.push(belly(S.ellipsoid(R * 0.44, R * 0.3, R * 0.5).at(0, -R * 0.78, R * 0.2).blend(0.03)));                              // throat pouch
  p.push(neckStub(B, R, 1.12, -0.22));
  const base = p.slice();
  p.push(...S.mirrorX([S.ellipsoid(R * 0.04, R * 0.03, R * 0.06).rot(0, 30, 0).at(R * 0.16, -R * 0.04, R * 1.79).cut(0.004).color(0x120c0a)]));
  // the gape: a dark line between the jaws, running back and up to the hinge
  p.push(...S.mirrorX([S.capsule([R * 0.04, -R * 0.5, R * 1.62], [R * 0.4, -R * 0.44, R * 0.7], R * 0.03).color(C.mouth).paint(0.004, -0.004), S.capsule([R * 0.4, -R * 0.44, R * 0.7], [R * 0.62, -R * 0.3, R * 0.3], R * 0.03).color(C.mouth).paint(0.004, -0.004)]));
  // teeth: a picket of cones along both jaws, the foremost upper pair longer
  for (const s of [1, -1]) for (let i = 0; i < 6; i++) {
    const z = R * (0.62 + i * 0.185), q = hit(base, [s * R * 1.2, -R * 0.4, z], [-s, 0, 0]);
    hard.push(spike([q[0] - s * R * 0.03, q[1], q[2]], [s * 0.1, -1, 0.1], R * (i === 4 ? 0.2 : 0.12), R * 0.035, C.tooth, [0, 0, -1], 0.15));
    if (i % 2 === 0) { const q2 = hit(base, [s * R * 1.2, -R * 0.58, z + R * 0.09], [-s, 0, 0]); hard.push(spike([q2[0] - s * R * 0.03, q2[1], q2[2]], [s * 0.1, 1, 0.1], R * 0.1, R * 0.03, C.tooth, [0, 0, -1], 0.15)); }
  }
  teethRow(base, hard, [-0.12, 0.12].map((x) => x * R), -R * 0.42, R * 3, R * 0.11, R * 0.03, C.tooth, -1, 0);
  // eyes on the sides of the head: gold with a slit
  eyeSet(p, hard, C, { x: R * 0.52, y: R * 0.14, r: R * 0.15, z0: R * 2, yaw: 34, look: { iris: 0xe8b21e, white: 0xd8a01a, slit: 1, ring: 0x6a3a08 }, lash: 0x14180c,
    lidCol: tone(C.skin, 0, 0.02, -0.14), socket: tone(C.skin, 0, 0, -0.12), lid: { upper: 44, roll: -14, lower: 22 } });
  // markings: a dark saddle over the skull, bands across the snout, pale lips
  const dark = tone(C.skin, -0.02, 0.03, -0.11);
  p.push(S.ellipsoid(R * 0.5, R * 0.3, R * 0.8).at(0, R * 0.74, -R * 0.2).color(dark).paint(0.03, 0));
  for (let i = 0; i < 3; i++) p.push(stroke(0, R * (0.3 - i * 0.14), R * (0.8 + i * 0.3), R * 0.5, R * 0.3, R * 0.07).color(dark).paint(0.012, 0));
  for (let i = 0; i < 6; i++) p.push(wart([(r() - 0.5) * R * 0.9, R * (0.3 + r() * 0.3), R * (0.3 + r() * 0.5)], R * (0.03 + r() * 0.02), tone(C.skin, 0, 0, 0.06)));
  // crest: a sail of skin on spines from the brow to the nape (left off under a helm or hood)
  if (!(o.helm || o.hood)) {
    const out = [[-0.62, 0.5], [-0.5, 0.98], [-0.34, 1.34], [-0.2, 1.02], [0.0, 1.56], [0.2, 1.06], [0.42, 1.5], [0.6, 0.96], [0.86, 1.26], [0.98, 0.72], [1.24, 0.82], [1.16, 0.3], [0.9, -0.1], [0.4, 0.3], [-0.2, 0.4]].map((q) => [q[0] * R, q[1] * R]);
    hard.push(H.extrude(out, R * 0.03, R * 0.014).rot(0, 90, 0).color(C.crest).pbr(0.6).shade((x, y) => (y < R * 0.98 ? C.crestDeep : null)));
    for (const [z, y, l] of [[0.34, 1.3, 0.2], [0.0, 1.5, 0.24], [-0.42, 1.44, 0.22], [-0.86, 1.2, 0.2], [-1.24, 0.78, 0.16]]) hard.push(spike([0, R * (y - 0.1), R * z], [0, 1, -0.25], R * l, R * 0.04, C.claw, [0, 0, -1], 0.2));
  }
  return { prims: p, hard, hair: null };
}

function ratHead(B) {
  const { P, C, sk, def } = B;
  const R = P.headR, p = [], hard = [];
  const r = rng(hashStr((def.id || 'rat') + ':face'));
  const pale = (x) => sk(x).color(C.light), fur = B.fur;
  // narrow skull running straight into a long, tapering muzzle; a weak lower jaw tucked under it
  p.push(sk(S.ellipsoid(R * 0.8, R * 0.78, R * 0.94).at(0, R * 0.16, -R * 0.12)));
  p.push(sk(S.capsule([0, R * 0.04, R * 0.36], [0, -R * 0.36, R * 1.46], R * 0.5, R * 0.19).blend(0.045)));
  p.push(...S.mirrorX([
    sk(S.ellipsoid(R * 0.26, R * 0.3, R * 0.32).at(R * 0.5, -R * 0.36, R * 0.16).blend(0.03)),
    sk(S.capsule([R * 0.12, R * 0.34, R * 0.84], [R * 0.66, R * 0.4, R * 0.36], R * 0.11, R * 0.09).blend(0.016)),
    pale(S.ellipsoid(R * 0.17, R * 0.15, R * 0.2).at(R * 0.13, -R * 0.46, R * 1.36).blend(0.016)),                           // whisker pads
  ]));
  p.push(pale(S.capsule([0, -R * 0.56, R * 0.16], [0, -R * 0.66, R * 1.08], R * 0.3, R * 0.14).blend(0.012)));
  p.push(S.sphere(R * 0.115).at(0, -R * 0.34, R * 1.64).color(C.pink).pbr(0.4).blend(0.012));                                 // nose
  p.push(neckStub(B, R, 1.06, -0.2));
  // great round ears, one of them torn
  p.push(...S.mirrorX(roundEar(B, [R * 0.74, R * 0.72, -R * 0.26], R * 0.44, R * 0.5, R * 0.085, [-8, -28, -24], tone(C.skin, 0, -0.02, -0.04), C.pink)));
  if (r() > 0.4) p.push(S.sphere(R * 0.13).at(R * 1.1, R * 1.14, -R * 0.4).cut(0.006).color(C.pink));
  const base = p.slice();
  // scruffy fur on the crown and cheeks
  p.push(fur(S.ellipsoid(R * 0.44, R * 0.26, R * 0.6).at(0, R * 0.82, -R * 0.3).blend(0.03), 0.01));
  p.push(...S.mirrorX([fur(S.ellipsoid(R * 0.2, R * 0.34, R * 0.34).rot(0, 0, 12).at(R * 0.66, -R * 0.4, -R * 0.06).blend(0.028), 0.01)]));
  p.push(fur(S.ellipsoid(R * 0.8, R * 0.62, R * 0.44).at(0, R * 0.04, -R * 0.66).blend(0.03), 0.01));
  // mouth line, and the long yellow incisors
  p.push(...S.mirrorX([S.capsule([0, -R * 0.56, R * 1.42], [R * 0.34, -R * 0.5, R * 0.6], R * 0.026).color(C.mouth).paint(0.004, -0.004)]));
  for (const s of [1, -1]) hard.push(H.box(R * 0.075, R * 0.26, R * 0.045, R * 0.012).rot(-10, 0, s * 3).at(s * R * 0.045, -R * 0.66, R * 1.44).color(C.tooth).pbr(0.3));
  for (const s of [1, -1]) hard.push(H.box(R * 0.06, R * 0.12, R * 0.04, R * 0.01).rot(8, 0, 0).at(s * R * 0.036, -R * 0.7, R * 1.14).color(C.tooth).pbr(0.3).lod(1));
  // beady eyes
  eyeSet(p, hard, C, { x: R * 0.4, y: R * 0.14, r: R * 0.125, z0: R * 2, yaw: 22, sink: 0.02, look: { iris: 0x7a1410, white: 0x2a0e0c, ring: 0x1a0606, pupilSize: 1.3, glow: 0.25 }, lash: 0x100a08,
    lidCol: tone(C.skin, 0, 0, -0.16), socket: tone(C.skin, 0, 0, -0.14), lid: { upper: 36, roll: -8, lower: 10 } });
  whiskers(hard, [R * 0.26, -R * 0.44, R * 1.34], R, 0xd8d0c0, 3, 0.95);
  // mange: bare pink patches, darker fur down the middle of the skull
  p.push(S.ellipsoid(R * 0.3, R * 0.3, R * 0.9).at(0, R * 0.7, R * 0.0).color(tone(C.skin, 0, 0, -0.08)).paint(0.03, 0));
  for (let i = 0; i < 2; i++) { const q = hit(base, [(r() - 0.5) * R, R * (0.2 + r() * 0.5), -R * 2], [0, 0, 1]); p.push(S.sphere(R * (0.08 + r() * 0.05)).at(q[0], q[1], q[2]).color(mix(C.skin, C.pink, 0.6)).paint(0.008, -0.002)); }
  return { prims: p, hard, hair: null };
}

const GOAT_HORNS = {
  curl: { pts: [[0.4, 0.78, -0.14], [0.78, 1.06, -0.56], [1.16, 0.74, -0.98], [1.3, 0.18, -0.76], [1.22, -0.16, -0.22], [1.34, 0.04, 0.3]], r: [0.24, 0.22, 0.19, 0.15, 0.1, 0] },
  swept: { pts: [[0.34, 0.84, -0.08], [0.5, 1.36, -0.42], [0.66, 1.62, -1.02], [0.8, 1.56, -1.66], [0.9, 1.3, -2.2]], r: [0.2, 0.18, 0.14, 0.09, 0] },
  long: { pts: [[0.32, 0.86, -0.04], [0.5, 1.5, -0.14], [0.76, 2.16, -0.36], [1.0, 2.74, -0.44], [1.16, 3.2, -0.3]], r: [0.19, 0.16, 0.12, 0.075, 0] },
};
function goatHead(B) {
  const { P, C, sk, def, o } = B;
  const R = P.headR, p = [], hard = [];
  const r = rng(hashStr((def.id || 'goat') + ':face'));
  const fur = B.fur, pale = (x) => sk(x).color(C.light);
  // narrow skull, flat forehead, a long arched nose and a slim lower jaw
  p.push(sk(S.ellipsoid(R * 0.8, R * 0.82, R * 0.9).at(0, R * 0.18, -R * 0.1)));
  p.push(sk(S.ellipsoid(R * 0.6, R * 0.46, R * 0.4).at(0, R * 0.34, R * 0.46).blend(0.03)));
  p.push(sk(S.capsule([0, R * 0.02, R * 0.46], [0, -R * 0.62, R * 1.3], R * 0.42, R * 0.26).blend(0.04)));
  p.push(sk(S.ellipsoid(R * 0.2, R * 0.2, R * 0.3).rot(36, 0, 0).at(0, -R * 0.2, R * 1.06).blend(0.03)));                    // the arch of the nose
  p.push(...S.mirrorX([
    sk(S.ellipsoid(R * 0.26, R * 0.36, R * 0.3).at(R * 0.5, -R * 0.36, R * 0.18).blend(0.03)),
    sk(S.capsule([R * 0.18, R * 0.3, R * 0.8], [R * 0.72, R * 0.3, R * 0.36], R * 0.13, R * 0.1).blend(0.016)),
  ]));
  p.push(pale(S.capsule([0, -R * 0.58, R * 0.26], [0, -R * 0.98, R * 1.12], R * 0.26, R * 0.17).blend(0.014)));
  p.push(S.ellipsoid(R * 0.2, R * 0.14, R * 0.12).at(0, -R * 0.7, R * 1.5).color(0x2a1e1c).pbr(0.4).blend(0.016));           // nose pad
  p.push(neckStub(B, R, 1.08, -0.2));
  const inner = mix(C.skin, 0xd8a09a, 0.5);
  earBlade(B, p, [R * 0.72, R * 0.12, -R * 0.3], [0.94, -0.3, -0.12], R * 0.4, R * 0.15, R * 0.05, inner);
  for (const x of p.slice(-3)) p.push(x.mirrorX());
  const base = p.slice();
  p.push(...S.mirrorX([S.ellipsoid(R * 0.07, R * 0.035, R * 0.08).rot(0, 0, 34).at(R * 0.11, -R * 0.66, surfZ(base, R * 0.11, -R * 0.66, R * 2.6)).cut(0.005).color(0x120c0c)]));
  p.push(S.capsule([0, -R * 0.78, R * 1.56], [0, -R * 0.92, R * 1.4], R * 0.02).color(0x1c1210).paint(0.003, -0.003));          // split lip
  p.push(...S.mirrorX([S.capsule([R * 0.02, -R * 0.9, R * 1.36], [R * 0.34, -R * 0.68, R * 0.56], R * 0.028).color(0x1c1210).paint(0.004, -0.004)]));
  p.push(S.ellipsoid(R * 0.34, R * 0.26, R * 0.44).at(0, -R * 0.58, R * 1.2).color(C.light).paint(0.05, 0));                   // pale muzzle
  p.push(S.ellipsoid(R * 0.16, R * 0.5, R * 0.3).rot(40, 0, 0).at(0, R * 0.2, R * 0.86).color(tone(C.skin, 0, 0, -0.09)).paint(0.03, 0));   // dark blaze down the face
  // matted forelock, shaggy cheeks and the beard
  p.push(fur(S.ellipsoid(R * 0.4, R * 0.26, R * 0.36).at(0, R * 0.84, R * 0.24).blend(0.03), 0.013));
  p.push(fur(S.ellipsoid(R * 0.84, R * 0.7, R * 0.5).at(0, R * 0.08, -R * 0.62).blend(0.03), 0.014));
  p.push(...S.mirrorX([fur(S.ellipsoid(R * 0.2, R * 0.42, R * 0.34).at(R * 0.66, -R * 0.52, -R * 0.06).blend(0.03), 0.012)]));
  p.push(fur(bone([0, -R * 1.0, R * 0.84], [0, -R * 1.5, R * 0.86], R * 0.17, R * 0.12).blend(0.02), 0.012), fur(bone([0, -R * 1.5, R * 0.86], [0, -R * 2.0, R * 0.74], R * 0.12, R * 0.03).blend(0.01), 0.012));
  // horns
  const hs = GOAT_HORNS[o.horns] || GOAT_HORNS.curl, big = o.build === 'heavy' ? 1.15 : 1;
  const hp = [], hh = [];
  horn(hp, hh, hs.pts.map((q) => [q[0] * R, R * 0.6 + (q[1] - 0.6) * R * big, q[2] * R * big]), hs.r.map((x) => x * R * big), C.hornA, C.horn, 0.007);
  p.push(...hp, ...hp.map((x) => x.mirrorX())); hard.push(...hh, ...hh.map((x) => x.mirrorX()));
  // eyes: pale gold with a bar for a pupil
  eyeSet(p, hard, C, { x: R * 0.5, y: R * 0.06, r: R * 0.14, z0: R * 2, yaw: 30, look: { iris: 0xd8b84a, white: 0xcaa63a, slit: 'bar', ring: 0x5a3a10 }, lash: 0x140e0a,
    lidCol: tone(C.skin, 0, 0, -0.12), socket: tone(C.skin, 0, 0, -0.1), lid: { upper: 40, roll: -6, lower: 18 } });
  void r;
  return { prims: p, hard, hair: null };
}

function tigerHead(B) {
  const { P, C, sk, def } = B;
  const R = P.headR, p = [], hard = [];
  const r = rng(hashStr((def.id || 'tiger') + ':face'));
  const white = (x) => sk(x).color(C.pale), black = C.stripe;
  // broad round skull, short deep muzzle, heavy cheeks with a ruff
  p.push(sk(S.ellipsoid(R * 0.92, R * 0.86, R * 0.92).at(0, R * 0.16, -R * 0.08)));
  p.push(sk(S.ellipsoid(R * 0.7, R * 0.5, R * 0.5).at(0, R * 0.3, R * 0.42).blend(0.03)));
  p.push(sk(S.capsule([0, R * 0.0, R * 0.5], [0, -R * 0.3, R * 1.02], R * 0.44, R * 0.32).blend(0.04)));
  p.push(...S.mirrorX([
    sk(S.ellipsoid(R * 0.3, R * 0.3, R * 0.3).at(R * 0.56, -R * 0.3, R * 0.36).blend(0.03)),                                 // cheek
    sk(S.capsule([R * 0.16, R * 0.3, R * 0.86], [R * 0.7, R * 0.34, R * 0.44], R * 0.12, R * 0.1).blend(0.018)),              // brow
    white(S.ellipsoid(R * 0.27, R * 0.22, R * 0.25).at(R * 0.19, -R * 0.5, R * 1.08).blend(0.016)),                          // whisker pads
    white(S.ellipsoid(R * 0.2, R * 0.46, R * 0.3).rot(0, 0, 18).at(R * 0.82, -R * 0.44, R * 0.06).blend(0.03)).bump(0.01, 34, 'fur'),   // ruff
  ]));
  p.push(white(S.capsule([0, -R * 0.62, R * 0.2], [0, -R * 0.8, R * 0.94], R * 0.34, R * 0.2).blend(0.014)));                // lower jaw and chin
  p.push(S.ellipsoid(R * 0.15, R * 0.1, R * 0.09).at(0, -R * 0.32, R * 1.32).color(0x8a4a44).pbr(0.4).blend(0.012));          // nose leather
  p.push(neckStub(B, R, 1.1, -0.18));
  // ears: round, black-backed with a white spot
  p.push(...S.mirrorX(roundEar(B, [R * 0.62, R * 0.9, -R * 0.2], R * 0.26, R * 0.27, R * 0.09, [-10, -24, -16], black, C.pale)));
  p.push(...S.mirrorX([S.sphere(R * 0.09).at(R * 0.68, R * 0.96, -R * 0.32).color(C.pale).paint(0.006, 0)]));
  const base = p.slice();
  p.push(S.capsule([0, -R * 0.38, R * 1.36], [0, -R * 0.56, R * 1.3], R * 0.02).color(black).paint(0.003, -0.003));             // the cleft under the nose
  p.push(...S.mirrorX([S.capsule([0, -R * 0.58, R * 1.3], [R * 0.4, -R * 0.56, R * 0.7], R * 0.028).color(black).paint(0.004, -0.004)]));
  for (const s of [1, -1]) { const q = hit(base, [s * R * 0.2, -R * 0.6, R * 2], [0, 0, -1]); hard.push(spike([q[0], q[1] + R * 0.02, q[2] - R * 0.05], [0, -1, 0.1], R * 0.2, R * 0.045, C.tooth, [0, 0, -1], 0.2)); }
  // eyes: amber, rimmed in black, a white flash over each
  eyeSet(p, hard, C, { x: R * 0.4, y: R * 0.08, r: R * 0.15, z0: R * 2, yaw: 14, look: { iris: 0xe8a81e, white: 0xd8c05a, ring: 0x4a2a08, pupilSize: 0.85 }, lash: 0x0e0a08,
    lidCol: 0x1c1410, socket: 0x1c1410, lid: { upper: 42, roll: -12, lower: 18 } });
  p.push(...S.mirrorX([S.ellipsoid(R * 0.2, R * 0.1, R * 0.2).rot(0, 0, 14).at(R * 0.4, R * 0.36, R * 0.8).color(C.pale).paint(0.012, 0)]));
  // stripes: forehead chevrons, bars on the cheeks and over the skull
  const st = (x) => x.color(black).pbr(0.85).paint(0.004, 0);
  for (let i = 0; i < 3; i++) p.push(...S.mirrorX([st(stroke(R * (0.13 + i * 0.03), R * (0.52 + i * 0.13), R * (0.84 - i * 0.14), R * 0.15, R * 0.028, R * 0.3, 20, 26))]));
  p.push(st(stroke(0, R * 0.6, R * 0.86, R * 0.022, R * 0.14, R * 0.3)));
  for (let i = 0; i < 3; i++) p.push(...S.mirrorX([st(stroke(R * 0.78, -R * (0.14 + i * 0.2), R * 0.26, R * 0.22, R * 0.03, R * 0.36, 60, -12 - i * 8))]));
  for (let i = 0; i < 4; i++) p.push(...S.mirrorX([st(S.ellipsoid(R * 0.4, R * 0.5, R * 0.035).rot(-10 - i * 14, 0, 0).at(R * 0.5, R * 0.5, -R * (0.1 + i * 0.24)))]));
  whiskers(hard, [R * 0.38, -R * 0.5, R * 1.12], R, 0xf2ece0, 3, 0.9);
  void r;
  return { prims: p, hard, hair: null };
}

function mummyHead(B) {
  const { P, C, sk, def, o } = B;
  const R = P.headR, L = P.headLen / 1.12, p = [], hard = [];
  const r = rng(hashStr((def.id || 'mummy') + ':face'));
  const glow = o.glow ?? 0x8fe8c0;
  // a skull under the wrappings: no nose to speak of, cheeks fallen in, the jaw bound shut
  p.push(sk(S.ellipsoid(R * 0.86, R * 0.92 * L, R * 0.98).at(0, R * 0.2, -R * 0.08)));
  p.push(sk(S.ellipsoid(R * 0.64, R * 0.82, R * 0.58).at(0, -R * 0.3, R * 0.3).blend(0.02)));
  p.push(...S.mirrorX([sk(S.capsule([R * 0.5, -R * 0.48, R * 0.04], [R * 0.13, -R * 0.94, R * 0.6], R * 0.14, R * 0.115).blend(0.022))]));
  p.push(sk(S.ellipsoid(R * 0.4, R * 0.26, R * 0.44).at(0, -R * 0.68, R * 0.24).blend(0.02)));
  p.push(sk(S.ellipsoid(R * 0.18, R * 0.14, R * 0.14).at(0, -R * 0.98, R * 0.66).blend(0.016)));
  p.push(...S.mirrorX([
    sk(S.ellipsoid(R * 0.19, R * 0.11, R * 0.17).at(R * 0.5, -R * 0.24, R * 0.56).blend(0.024)),
    sk(S.capsule([0, R * 0.26, R * 0.86], [R * 0.56, R * 0.3, R * 0.6], R * 0.09, R * 0.07).blend(0.014)),
    S.ellipsoid(R * 0.14, R * 0.22, R * 0.18).at(R * 0.52, -R * 0.58, R * 0.56).cut(0.03).color(C.shade),
  ]));
  p.push(sk(S.capsule([0, R * 0.1, R * 0.86], [0, -R * 0.2, R * 0.95], R * 0.065, R * 0.06).blend(0.014)));
  p.push(sk(S.ellipsoid(R * 0.28, R * 0.18, R * 0.2).at(0, -R * 0.64, R * 0.68).blend(0.016)));
  p.push(neckStub(B, R, 1.0));
  const base = p.slice();
  // the wrappings have slipped from the eyes and one side of the jaw: dried flesh shows, the sockets are empty
  const flesh = (x, raise = -0.004) => x.color(C.flesh).pbr(0.85).tint(0.2, 40).paint(0.004, raise);
  p.push(flesh(S.ellipsoid(R * 0.72, R * 0.2, R * 0.4).rot(0, 0, 7).at(0, R * 0.03, R * 0.74), -0.006));
  p.push(flesh(S.ellipsoid(R * 0.3, R * 0.2, R * 0.3).rot(0, 0, -20).at(-R * 0.3, -R * 0.66, R * 0.62), -0.006));
  const ex = R * 0.36, ey = R * 0.02, sz = surfZ(base, ex, ey, R * 2);
  p.push(...S.mirrorX([S.sphere(R * 0.2).at(ex, ey, sz - R * 0.02).cut(0.012).color(0x0c0a0a)]));
  hard.push(...H.mirrorX([H.sphere(R * 0.05, 12).at(ex, ey, sz - R * 0.15).color(glow).pbr(0.4).glow(1.0)]));
  // nose hole and the teeth of the bared side
  const nz = surfZ(base, 0, -R * 0.28, R * 2);
  p.push(S.ellipsoid(R * 0.07, R * 0.1, R * 0.1).at(0, -R * 0.26, nz).cut(0.005).color(0x0c0a0a));
  teethRow(base, hard, [-0.4, -0.31, -0.22, -0.13].map((x) => x * R), -R * 0.6, R * 2, R * 0.085, R * 0.026, C.tooth, -1, 0);
  teethRow(base, hard, [-0.36, -0.27, -0.18].map((x) => x * R), -R * 0.74, R * 2, R * 0.07, R * 0.024, C.tooth, 1, 0);
  // the edges of the bands: creases winding round the skull at odd angles, a few stained
  const edge = tone(C.skin, 0, 0, -0.22);
  for (let i = 0; i < 7; i++) p.push(S.cyl(R * 1.0, R * 0.035, 0).rot(r() * 50 - 25, 0, r() * 60 - 30).at(0, R * (1.0 - i * 0.34), -R * 0.06).color(edge).paint(0.003, -0.003));
  for (let i = 0; i < 4; i++) p.push(S.sphere(R * (0.14 + r() * 0.12)).at((r() - 0.5) * R * 1.6, R * (r() * 1.4 - 0.5), (r() - 0.5) * R * 1.6).color(tone(C.skin, -0.02, 0.06, -0.12)).paint(0.014, 0));
  // loose ends trailing from the back of the head
  const strip = (w, len, at, rot) => H.box(w, len, R * 0.02, R * 0.006).at(0, -len / 2, 0).rot(rot[0], rot[1], rot[2]).at(at[0], at[1], at[2]).color(tone(C.skin, 0, 0, -0.06)).pbr(0.95).lod(1);
  if (!(o.helm || o.hood)) hard.push(strip(R * 0.22, R * 0.7, [R * 0.3, -R * 0.5, -R * 0.84], [-22, 10, 10]), strip(R * 0.17, R * 0.45, [-R * 0.5, -R * 0.6, -R * 0.7], [-16, -20, -14]));
  return { prims: p, hard, hair: null };
}

/**
 * Body paint (o.paint): swirls on the chest and shoulder blades, chevrons down the belly, a spiral and bands on each arm,
 * bars across the cheeks and brow. Laid on as paint volumes after everything else, so it follows whatever shape is there.
 */
function warPaint(B, col, torso, head, arm, fore) {
  const { P } = B, T = P.torso, k = T / 0.3, cw = P.chestW / 2, cd = P.chestD / 2, wd = P.waistD / 2, R = P.headR;
  const ink = (x) => x.color(col).pbr(0.85).paint(0.0025, 0);
  /** a spiral of short bars in the plane facing `axis` ('z' front/back, 'x' the side), deep enough to reach the surface */
  const spiral = (c, rad, turns, w, depth, axis = 'z', hand = 1) => {
    const out = [], n = Math.round(turns * 9);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = t * turns * 6.2832, rr = rad * (0.1 + 0.9 * t), q = [Math.cos(a) * rr * hand, Math.sin(a) * rr];
      if (prev) {
        const du = q[0] - prev[0], dv = q[1] - prev[1], len = Math.hypot(du, dv) * 1.3, mu = (q[0] + prev[0]) / 2, mv = (q[1] + prev[1]) / 2;
        out.push(axis === 'z' ? ink(S.box(len, w, depth, 0).rot(0, 0, Math.atan2(dv, du) / DEG).at(c[0] + mu, c[1] + mv, c[2])) : ink(S.box(depth, w, len, 0).rot(Math.atan2(-dv, du) / DEG, 0, 0).at(c[0], c[1] + mv, c[2] + mu)));
      }
      prev = q;
    }
    return out;
  };
  torso.prims.push(...S.mirrorX(spiral([cw * 0.5, T - 0.105 * k, cd * 0.9 + 0.035], 0.042 * k, 1.7, 0.0075 * k, 0.12)));
  torso.prims.push(...S.mirrorX(spiral([cw * 0.5, T - 0.11 * k, -(cd * 0.9 + 0.035)], 0.05 * k, 1.7, 0.008 * k, 0.12, 'z', -1)));
  for (let i = 0; i < 3; i++) torso.prims.push(...S.mirrorX([ink(S.box(0.05 * k, 0.0075 * k, 0.14, 0).rot(0, 0, -30).at(0.026 * k, (0.2 - i * 0.04) * k, wd + 0.04))]));
  torso.prims.push(ink(S.box(0.0075 * k, 0.05 * k, 0.12, 0).at(0, T - 0.05 * k, cd * 0.9 + 0.035)));
  const U = P.upper, r = P.rUpper, F = P.fore, rf = P.rFore;
  arm.prims.push(...spiral([r * 0.95, -U * 0.34, 0], Math.min(r * 1.0, U * 0.26), 1.6, r * 0.17, r * 1.3, 'x'));
  arm.prims.push(ink(S.cyl(r * 2.4, r * 0.2, 0).rot(0, 0, 10).at(0, -U * 0.74, 0)));
  fore.prims.push(ink(S.cyl(rf * 2.4, rf * 0.22, 0).rot(0, 0, -12).at(0, -F * 0.3, 0)), ink(S.cyl(rf * 2.4, rf * 0.14, 0).rot(0, 0, -12).at(0, -F * 0.46, 0)));
  if (head.prims.length) {
    head.prims.push(...S.mirrorX([
      ink(stroke(R * 0.5, -R * 0.3, R * 0.72, R * 0.2, R * 0.032, R * 0.3, 24, -34)),
      ink(stroke(R * 0.46, -R * 0.46, R * 0.74, R * 0.16, R * 0.028, R * 0.3, 24, -34)),
      ink(stroke(R * 0.4, R * 0.52, R * 0.78, R * 0.17, R * 0.03, R * 0.3, 20, 28)),
    ]));
    head.prims.push(ink(stroke(0, -R * 0.84, R * 0.8, R * 0.03, R * 0.1, R * 0.2)), ink(stroke(0, R * 0.62, R * 0.86, R * 0.03, R * 0.16, R * 0.3)));
  }
}

// =====================================================================================
//  Wings and tails (left wing, in the wing node's space: root at the origin, +X outward)
// =====================================================================================

/** a web of skin stretched between bones: each panel is ruled between bone A (a0 -> a1) and bone B (b0 -> b1) */
function membraneGeo(panels, sag, billow) {
  const NU = 6, NV = 5, pos = [], idx = [];
  for (const pn of panels) {
    const base = pos.length / 3, c = lerp3(pn.a0, pn.b0, 0.5);
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const u = i / NU, v = j / NV;
      const q = lerp3(lerp3(pn.a0, pn.a1, v), lerp3(pn.b0, pn.b1, v), u);
      const pull = 1 - sag * Math.sin(Math.PI * u) * v * v, bl = billow * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.15) * 0.5);
      pos.push(c[0] + (q[0] - c[0]) * pull, c[1] + (q[1] - c[1]) * pull, c[2] + (q[2] - c[2]) * pull - bl);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = base + j * (NU + 1) + i, b = a + NU + 1; idx.push(a, a + 1, b + 1, a, b + 1, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** leathery wing. size = model units from root to the furthest fingertip when spread; spread 0 (mantled) .. 1 (in flight) */
function batWing(B, size, spread) {
  const { C } = B;
  const K = (f, s) => mul3(lerp3(f, s, spread), size);
  const O = [0, 0, 0];
  const E = K([0.2, 0.34, -0.2], [0.3, 0.12, -0.06]);                // elbow
  const W = K([0.42, 0.62, -0.26], [0.62, 0.3, -0.04]);              // wrist
  const F = [K([0.72, 0.5, -0.4], [1.0, 0.36, -0.08]), K([0.74, 0.06, -0.46], [0.98, -0.12, -0.12]), K([0.56, -0.3, -0.42], [0.72, -0.44, -0.14]), K([0.3, -0.46, -0.3], [0.38, -0.52, -0.12])];
  const Bd = K([0.03, -0.32, -0.04], [0.03, -0.34, -0.03]);          // where the web meets the back
  const dark = tone(C.skin, 0, -0.04, -0.13), bcol = tone(C.skin, 0, 0, -0.07);
  const bn = (a, b, ra, rb) => S.capsule(a, b, ra * size, rb * size).color(bcol).tint(0.12, 20).pbr(0.6);
  const p = [S.sphere(0.05 * size).color(bcol), bn(O, E, 0.045, 0.034).blend(0.02), bn(E, W, 0.034, 0.024).blend(0.012), S.sphere(0.04 * size).at(...E).color(bcol).blend(0.012), S.sphere(0.032 * size).at(...W).color(bcol).blend(0.01)];
  for (const f of F) { const mid = add3(lerp3(W, f, 0.55), [0, 0.012 * size, -0.01 * size]); p.push(bn(W, mid, 0.022, 0.016).blend(0.008), bn(mid, f, 0.016, 0.01).blend(0.004)); }
  const panels = [{ a0: O, a1: W, b0: O, b1: E }, { a0: W, a1: F[0], b0: W, b1: F[1] }, { a0: W, a1: F[1], b0: W, b1: F[2] }, { a0: W, a1: F[2], b0: W, b1: F[3] }, { a0: W, a1: F[3], b0: E, b1: Bd }, { a0: E, a1: Bd, b0: O, b1: mul3(Bd, 0.5) }];
  const c0 = rgb(dark), c1 = rgb(tone(C.skin, 0.01, 0.04, -0.02)), c2 = rgb(tone(C.skin, 0, -0.08, -0.2));
  const web = H.geo(membraneGeo(panels, 0.2, 0.035 * size)).shade((x, y, z) => {
    const n = noise3(x * 9 / size, y * 9 / size, z * 9 / size + 3), far = clamp(Math.hypot(x, y) / size - 0.25);
    const t = clamp(n * 0.8 + far * 0.35);
    return t < 0.5 ? lerp3(c2, c0, t * 2) : lerp3(c0, c1, (t - 0.5) * 2);
  }).color(dark).pbr(0.7);
  const hard = [web, spike(add3(W, [0, 0.01 * size, 0]), [0.2, 1, 0.35], 0.09 * size, 0.02 * size, C.claw, [1, 0, 0], 0.35).lod(99)];
  for (const f of F) hard.push(spike(f, norm3(sub3(f, W)), 0.035 * size, 0.008 * size, C.claw, [0, -1, 0], 0.3));
  return { prims: p, hard };
}

/** feathered wing: a sculpted arm clothed in small feathers, with rows of flight feathers hung from it */
function featherWing(B, size, spread) {
  const cols = B.featherCols, pl = B.plume;
  const K = (f, s) => mul3(lerp3(f, s, spread), size);
  const O = [0, 0, 0];
  const E = K([0.18, 0.3, -0.2], [0.3, 0.14, -0.06]), W = K([0.4, 0.56, -0.26], [0.62, 0.2, -0.03]), T = K([0.56, 0.5, -0.34], [0.86, 0.16, -0.04]);
  const p = [pl(S.sphere(0.06 * size)), pl(bone(O, E, 0.058 * size, 0.05 * size).blend(0.02)), pl(bone(E, W, 0.05 * size, 0.04 * size).blend(0.014)), pl(bone(W, T, 0.04 * size, 0.022 * size).blend(0.012))];
  const hard = [];
  const face = [0.05, 0.1, 1];
  const down = (out, back = -0.12) => norm3([out, -1, back]);
  // tertials and secondaries hang from the arm, primaries fan out from the hand
  for (let i = 0; i < 5; i++) { const t = (i + 0.5) / 5; hard.push(feather(add3(lerp3(O, E, t), [0, -0.02 * size, -0.012 * size]), down(0.02 + t * 0.1), size * (0.3 + t * 0.12), size * 0.11, face, cols)); }
  for (let i = 0; i < 8; i++) { const t = (i + 0.5) / 8; hard.push(feather(add3(lerp3(E, W, t), [0, -0.02 * size, -0.016 * size]), down(0.1 + t * 0.2 + spread * t * 0.15), size * (0.44 + t * 0.1), size * 0.105, face, cols)); }
  for (let i = 0; i < 8; i++) { const t = i / 7; hard.push(feather(add3(lerp3(W, T, t), [0, -0.012 * size, -0.02 * size]), norm3([0.32 + t * (0.5 + spread * 1.6), -1 + t * (0.2 + spread * 0.75), -0.14]), size * (0.56 - Math.abs(t - 0.45) * 0.2), size * 0.1, face, cols)); }
  // a row of coverts over the roots of the flight feathers
  const cov = [cols[1], cols[3], cols[1]];
  for (let i = 0; i < 12; i++) { const t = (i + 0.5) / 12, a = t < 0.5 ? lerp3(O, E, t * 2) : t < 0.86 ? lerp3(E, W, (t - 0.5) / 0.36) : lerp3(W, T, (t - 0.86) / 0.14); hard.push(feather(add3(a, [0, -0.01 * size, 0.012 * size]), down(0.05 + t * 0.35), size * 0.2, size * 0.085, face, cov, 1)); }
  return { prims: p, hard };
}

/** tail segments, each in its own node's space running back along -Z from the origin */
function buildTail(B, kind) {
  const { P, C, sk, st } = B;
  const k = P.torso / 0.3, segs = [];
  if (kind === 'fan') {
    // harpy: a fan of long tail feathers
    const hard = [], cols = B.featherCols;
    for (let i = -3; i <= 3; i++) hard.push(feather([i * 0.008, 0, -0.01], [i * 0.24, -0.5 + Math.abs(i) * 0.05, -1], 0.3 - Math.abs(i) * 0.025, 0.07, [0, 1, 0.3], cols));
    for (let i = -2; i <= 2; i++) hard.push(feather([i * 0.012, 0.012, 0], [i * 0.3, -0.3, -1], 0.13, 0.06, [0, 1, 0.3], [cols[1], cols[3], cols[1]], 1));
    return [{ rot: [0, 0, 0], len: 0, prims: [B.plume(S.ellipsoid(0.05, 0.035, 0.05).at(0, 0, 0.01))], hard }];
  }
  const spec = { barb: { l: 0.2 * k, r: [0.052 * k, 0.04 * k, 0.028 * k, 0.014 * k], rot: [[-38, 0, 0], [22, 0, 0], [34, 0, 0]] },
    spade: { l: 0.13, r: [0.017, 0.013, 0.01, 0.007], rot: [[-30, 0, 0], [30, 0, 0], [44, 0, 0]] },
    bull: { l: 0.115 * k, r: [0.017 * k, 0.013 * k, 0.011 * k, 0.01 * k], rot: [[-74, 0, 0], [-10, 0, 0], [8, 0, 0]] },
    lizard: { l: 0.165 * k, r: [0.066 * k, 0.05 * k, 0.032 * k, 0.011 * k], rot: [[-50, 0, 0], [16, 0, 0], [22, 0, 0]] },
    rat: { l: 0.19, r: [0.018, 0.014, 0.0095, 0.0045], rot: [[-60, 0, 0], [24, 0, 0], [34, 0, 0]] },
    goat: { l: 0.026 * k, r: [0.02 * k, 0.019 * k, 0.015 * k, 0.007 * k], rot: [[20, 0, 0], [16, 0, 0], [12, 0, 0]] },
    tiger: { l: 0.15 * k, r: [0.026 * k, 0.023 * k, 0.021 * k, 0.02 * k], rot: [[-68, 0, 0], [22, 0, 0], [42, 0, 0]] } }[kind];
  if (!spec) return segs;
  if (kind === 'lizard' || kind === 'rat' || kind === 'goat' || kind === 'tiger') {
    const skin = kind === 'rat' ? (x) => x.color(C.pink).tint(0.14, 30).pbr(0.6) : kind === 'goat' ? (x) => B.fur(x, 0.008) : sk;
    const col = kind === 'rat' ? C.pink : kind === 'goat' ? C.fur : C.skin, l = spec.l;
    const ring = (z, w, c) => S.cyl(0.2, w, 0).rot(90, 0, 0).at(0, 0, z).color(c).pbr(0.85).paint(0.0035, 0);
    for (let i = 0; i < 3; i++) {
      const a = spec.r[i], b = spec.r[i + 1], p = [skin(S.sphere(a * 1.04)), skin(S.capsule([0, 0, 0], [0, 0, -l], a, b).blend(0.01)), skin(S.sphere(b * 1.02).at(0, 0, -l).blend(0.006))];
      const hard = [H.cyl(a, b, l, 5).rot(90, 0, 0).at(0, 0, -l / 2).color(col).pbr(0.8).far()];
      if (kind === 'lizard') {
        p.push(S.ellipsoid(a * 0.8, a * 0.7, l * 0.7).at(0, -a * 0.7, -l * 0.5).color(C.light).paint(a * 0.3, 0));                               // pale underside
        for (let j = 0; j < 2; j++) p.push(ring(-l * (0.3 + j * 0.45), l * 0.14, tone(C.skin, -0.02, 0.03, -0.11)));
        p.push(S.ellipsoid(a * 0.8, a * 0.7, l * 0.7).at(0, -a * 0.7, -l * 0.5).color(C.light).paint(a * 0.3, 0));
        for (let j = 0; j < 3; j++) { const t = (j + 0.4) / 3, rr = lerp(a, b, t); hard.push(spike([0, rr * 0.8, -l * t], [0, 1, -0.6], rr * 0.95, rr * 0.3, C.crest, [0, 0, -1], 0.3)); }
      }
      if (kind === 'rat') for (let j = 0; j < 4; j++) p.push(ring(-l * (0.12 + j * 0.25), 0.004, tone(C.pink, 0, -0.05, -0.12)));
      if (kind === 'goat' && i === 2) p.push(B.fur(S.ellipsoid(b * 1.6, b * 1.6, l * 0.6).at(0, 0, -l * 1.0).blend(0.012), 0.009));
      if (kind === 'tiger') {
        for (let j = 0; j < 3; j++) p.push(ring(-l * (0.18 + j * 0.32), l * 0.11, C.stripe));
        p.push(S.ellipsoid(a * 0.7, a * 0.6, l * 0.7).at(0, -a * 0.8, -l * 0.5).color(C.pale).paint(a * 0.3, 0));
        if (i === 2) p.push(skin(S.sphere(b * 1.25).at(0, 0, -l).blend(0.01)), S.sphere(b * 2.2).at(0, 0, -l * 1.02).color(C.stripe).pbr(0.85).paint(0.006, 0));
      }
      segs.push({ rot: spec.rot[i], len: l, prims: p, hard });
    }
    return segs;
  }
  for (let i = 0; i < 3; i++) {
    const a = spec.r[i], b = spec.r[i + 1], p = [sk(S.sphere(a * 1.04)), sk(S.capsule([0, 0, 0], [0, 0, -spec.l], a, b).blend(0.01)), sk(S.sphere(b * 1.02).at(0, 0, -spec.l).blend(0.006))], hard = [];
    if (kind === 'barb') {
      for (let j = 0; j < 2; j++) hard.push(spike([0, a * 0.8, -spec.l * (0.3 + j * 0.42)], [0, 1, -0.5], a * 1.2, a * 0.3, C.horn, [0, 0, -1], 0.3));   // dorsal spines
      if (i === 2) {
        hard.push(spike([0, 0, -spec.l * 0.9], [0, 0, -1], spec.l * 0.75, b * 1.7, C.horn, [0, 1, 0], 0.1).lod(99));
        for (const s of [1, -1]) hard.push(spike([s * b * 0.6, 0, -spec.l * 0.96], [s, 0, 0.55], spec.l * 0.34, b * 1.0, C.horn, [0, 0, 1], 0.35));
      }
    }
    if (kind === 'spade' && i === 2) hard.push(H.extrude([[0, 0], [0.026, 0.016], [0.02, 0.04], [0, 0.085], [-0.02, 0.04], [-0.026, 0.016]], 0.008, 0.003).rot(-90, 0, 0).at(0, 0, -spec.l * 0.92).color(tone(C.skin, 0, 0, -0.1)).pbr(0.5));
    if (kind === 'bull' && i === 2) p.push(B.fur(S.ellipsoid(b * 2.6, b * 2.6, spec.l * 0.5).at(0, 0, -spec.l * 1.1).blend(0.012), 0.008));
    segs.push({ rot: spec.rot[i], len: spec.l, prims: p, hard });
  }
  void st;
  return segs;
}

// =====================================================================================
//  Assembly
// =====================================================================================

const HEADS = { human: humanHead, harpy: humanHead, goblin: goblinHead, hobgoblin: goblinHead, ghoul: ghoulHead, troll: giantHead, ogre: giantHead, cyclops: giantHead, minotaur: bullHead, demon: fiendHead, imp: fiendHead,
  elf: humanHead, dwarf: humanHead, orc: orcHead, lizard: lizardHead, rat: ratHead, goat: goatHead, tiger: tigerHead, mummy: mummyHead };
const SHIELD_SHAPE = { footman: 'round', knight: 'kite', paladin: 'tower', skeleton: 'round' };
/** how each kind of weapon sits in the hand at rest: elevation of the business end above straight ahead, and lean toward the body */
const HOLD = { one: { up: 24, lean: 0 }, two: { up: 46, lean: 10 }, pole: { up: 62, lean: 3 }, staff: { up: 82, lean: 0 }, bow: { up: 0, lean: 0 } };

/** centre of a sculpt prim or hard piece in its node's space */
function centreOf(x) {
  const v = new THREE.Vector3();
  if (x.geo) { if (!x.geo.boundingSphere) x.geo.computeBoundingSphere(); v.copy(x.geo.boundingSphere.center); } else if (x.p && x.p.a) v.set((x.p.a[0] + x.p.b[0]) / 2, (x.p.a[1] + x.p.b[1]) / 2, (x.p.a[2] + x.p.b[2]) / 2);
  return v.applyMatrix4(x.m);
}

export function humanoid(def = {}, o = {}) {
  if (!o.helm && !o.hood && headCover(def, o)) o = { ...o, helm: true };   // the outfit brings its own headgear (gear.js): no scalp hair under it
  const P = proportions(o);
  const sp = o.cyclops ? 'cyclops' : SPECIES[P.species] ? P.species : 'human';
  const st = { ...SPECIES[sp] };
  if (o.build === 'heavy') { st.gut = Math.max(st.gut || 0, sp === 'demon' ? 0.12 : 0.5); st.muscle = Math.min(1, st.muscle + 0.1); }
  const C = palette(def, o, sp);
  const pose = o.pose === 'riding' ? 'riding' : 'stand';
  const sk = (x) => { x.color(C.skin).tint(st.tint[0], st.tint[1]).pbr(0.72); if (st.hide) x.bump(st.hide[1], st.hide[2], st.hide[0]); return x; };
  const fur = (x, amp = 0.008) => x.color(C.fur).tint(0.2, 26).pbr(0.9).bump(amp, 34, 'fur');
  const plume = (x) => x.color(C.plume).tint(0.18, 28).pbr(0.85).bump(0.006, 40, 'scales');
  const featherCols = [tone(C.plume, 0, -0.05, -0.16), C.plume, tone(C.plume, 0.02, 0, -0.2), mix(C.plume, 0xe8e0d0, 0.35)];
  // Face and hide options any unit may set (unknown values are ignored: the hair is then left off, the species' own look kept):
  //   hair: crop | bowl | swept | long | tonsure | bald | topknot | spiked (stiff lime-washed spikes) | braids (two long plaits) | mohawk
  //   beard: none | stubble | moustache | short | goatee | long | great (a dwarf's default: down over the chest) |
  //          braided (plaits to the belt) | curled (oiled ringlets in tiers) | forked
  //   hairColor: hex for hair and beard          (hair and beard apply to the heads that grow them: human, elf, dwarf, orc)
  //   paint: hex of body / war paint: swirls on face, chest, back and arms (any species)
  //   horns: curl | swept | long (goat; anything else, such as `true`, is curl)      glow: hex of a mummy's eye-light
  //   skin: hide / fur / scale colour (a mummy's dried flesh); cloth2: a mummy's wrappings (aged linen if absent)
  let face = faceFor(def, sp);
  if (typeof o.hair === 'string' || typeof o.beard === 'string' || typeof o.hairColor === 'number') {
    face = { ...face };
    if (typeof o.hair === 'string') face.hair = o.hair;
    if (typeof o.beard === 'string') face.beard = o.beard;
    if (typeof o.hairColor === 'number') face.hairCol = o.hairColor;
  }
  const B = { def, o, P, st, C, sk, fur, plume, featherCols, sp, face, lord: sp === 'demon' && (def.id === 'infernalLord' || o.build === 'heavy') };
  const det = st.det;

  // ---- what is carried ----
  const hr = P.handR, ws = lerp(1, hr / 0.036, 0.7);
  const w = o.weapon && o.weapon !== 'none' ? makeWeapon(o.weapon, { scale: ws }) : null;
  const held = w && w.hold && w.hold !== 'none' ? HOLD[w.hold] || HOLD.one : null;
  const gr = hr * 0.4;
  const gripAt = [-(gr + hr * 0.26) * 0.8, -hr, hr * 0.05];
  const gripRot = held ? (w.hold === 'bow' ? [90, 0, 0] : [90 - held.up, 0, held.lean]) : null;   // left-hand convention; mirrored for the right
  const bothHands = held && !o.shield && (w.hold === 'two' || w.hold === 'pole');

  // ---- sculpt ----
  const torso = buildTorso(B), head = (HEADS[sp] || humanHead)(B), arm = buildArm(B), fore = buildForearm(B), leg = buildLeg(B), shin = buildShin(B);
  if (B.farHard) { head.hard.push(...B.farHard); B.farHard = null; }
  if (typeof o.paint === 'number' && Number.isFinite(o.paint)) warPaint(B, o.paint, torso, head, arm, fore);
  const handR = held ? gripHand(B, gr, gripRot, gripAt) : openHand(B);
  const handL = bothHands ? gripHand(B, gr, [90 - 30, 0, 0], gripAt) : openHand(B);

  const nodes = {}, order = [];
  const node = (name, parent, rig, pos, part, detail, rot) => {
    const n = { name, pos, prims: part ? flat(part.prims) : [], hard: part ? flat(part.hard) : [] };
    if (parent) n.parent = parent;
    if (rig) n.rig = rig;
    if (detail) n.detail = detail;
    if (rot && (rot[0] || rot[1] || rot[2])) n.rot = rot;
    nodes[name] = n; order.push(n);
    return n;
  };
  const mir = (part) => ({ prims: mirrorAll(part.prims), hard: mirrorAll(part.hard) });
  const riding = pose === 'riding', hu = P.hunch || 0, ao = st.armOut || 0;
  node('root', null, null, [0, 0, 0], null);
  node('legL', 'root', riding ? null : 'legs', [P.hipX, P.hipY, 0], leg, 0.95 * det, riding ? [-62, 0, 30] : null);
  node('shinL', 'legL', riding ? null : 'shins', [0, -P.thigh, 0], shin, 1.08 * det, riding ? [72, 0, -6] : null);
  node('legR', 'root', riding ? null : 'legs', [-P.hipX, P.hipY, 0], mir(leg), 0.95 * det, riding ? [-62, 0, -30] : null);
  node('shinR', 'legR', riding ? null : 'shins', [0, -P.thigh, 0], mir(shin), 1.08 * det, riding ? [72, 0, 6] : null);
  node('torso', 'root', 'torso', [0, P.hipY, 0], torso, 0.97 * det, [hu, 0, 0]);
  node('head', 'torso', 'head', [0, P.torso + P.neck + P.headR * P.headLen * 0.9, 0], head, 1.58 * det, [-hu * 0.8, 0, 0]);
  if (head.hair) node('hair', 'head', null, [0, 0, 0], head.hair, 1.65 * det);
  node('armL', 'torso', 'arms', [P.shoulderX, P.torso - 0.02, 0], arm, 1.0 * det, [-hu * 0.9, 0, ao]);
  node('foreL', 'armL', 'forearms', [0, -P.upper, 0], fore, 1.1 * det);
  node('handL', 'foreL', 'hands', [0, -P.fore, 0], handL, 2.05 * det);
  node('armR', 'torso', 'arms', [-P.shoulderX, P.torso - 0.02, 0], mir(arm), 1.0 * det, [-hu * 0.9, 0, -ao]);
  node('foreR', 'armR', 'forearms', [0, -P.upper, 0], mir(fore), 1.1 * det);
  node('handR', 'foreR', 'hands', [0, -P.fore, 0], mir(handR), 2.05 * det);

  // ---- wings and tail ----
  const k = P.torso / 0.3, cd = P.chestD / 2, wd = P.waistD / 2;
  const wingKind = st.wings || (o.wings && !riding && !o.mountType ? 'bat' : null);
  if (wingKind) {
    const flying = !!def.fly, size = wingKind === 'feather' ? 0.62 : sp === 'imp' ? 0.5 : 0.78 * k * (o.build === 'heavy' ? 1.08 : 1);
    const wing = wingKind === 'feather' ? featherWing(B, size, flying ? 1 : 0.35) : batWing(B, size, flying ? 1 : 0.12);
    const at = [0.06 * k, P.torso - 0.075 * k, -cd * 0.82];
    node('wingL', 'torso', 'wings', at, wing, (wingKind === 'feather' ? 1.0 : 0.8) * det, [0, flying ? -12 : -6, 0]);
    node('wingR', 'torso', 'wings', [-at[0], at[1], at[2]], mir(wing), (wingKind === 'feather' ? 1.0 : 0.8) * det, [0, flying ? 12 : 6, 0]);
  }
  if (st.tail) {
    const segs = buildTail(B, st.tail);
    let parent = 'torso', pos = [0, st.tail === 'fan' ? 0.0 : -0.012, -wd * 0.92];
    // (a rider's tail carries no rig tag, like its legs: the mount's animator owns the `tail` list and poses it as the mount's own)
    segs.forEach((s, i) => { node(`tail${i}`, parent, riding ? null : 'tail', pos, s, 1.15 * det, s.rot); parent = `tail${i}`; pos = [0, 0, -s.len]; });
  }

  // ---- clothing and armour (gear.js) ----
  // Gear addresses the documented nodes. The hands are their own nodes here, so anything gear adds to a
  // forearm below the wrist is handed on to that hand (re-based to the wrist) and follows it.
  const F = P.fore;
  const facade = (foreName, handName) => {
    const fn = nodes[foreName], hn = nodes[handName];
    return { name: foreName, pos: fn.pos, parent: fn.parent, prims: [...fn.prims, ...hn.prims.map((x) => x.clone().at(0, -F, 0))], hard: [...fn.hard, ...hn.hard.map((x) => x.clone().at(0, -F, 0))] };
  };
  const view = { ...nodes, foreL: facade('foreL', 'handL'), foreR: facade('foreR', 'handR') };
  const counts = { foreL: [view.foreL.prims.length, view.foreL.hard.length], foreR: [view.foreR.prims.length, view.foreR.hard.length] };
  const route = (name, list, key) => {
    const hand = name === 'foreL' ? nodes.handL : name === 'foreR' ? nodes.handR : null;
    for (const x of flat(list)) {
      if (hand && centreOf(x).y < -F - hr * 0.2) hand[key].push(x.at(0, F, 0)); else nodes[name][key].push(x);
    }
  };
  const ctx = {
    def, o, P, pose, nodes: view,
    add(name, part) {
      if (!nodes[name] || !part) return;
      if (part.prims) route(name, part.prims, 'prims');
      if (part.hard) route(name, part.hard, 'hard');
    },
  };
  dress(ctx);
  for (const name of ['foreL', 'foreR']) {          // pieces pushed straight onto the lists rather than through add()
    route(name, view[name].prims.slice(counts[name][0]), 'prims');
    route(name, view[name].hard.slice(counts[name][1]), 'hard');
  }

  // ---- far level: hands and feet get stand-ins the colour of whatever now covers them (glove, gauntlet, boot, shoe, skin) ----
  const coverAt = (n, pt, rad) => {
    for (let i = n.prims.length - 1; i >= 0; i--) { const x = n.prims[i]; if (x.op === 0 && x.hasCol && !x.glowV && centreOf(x).distanceTo(pt) < rad) return x; }
    return null;
  };
  const dressIn = (h, cover) => { if (cover) { h.col = cover.col.slice(); h.rough = cover.rough; h.metal = cover.metal; } return h; };
  const _pt = new THREE.Vector3();
  for (const name of ['handL', 'handR']) {
    const n = nodes[name], h = knob(P.rWrist * 1.02, hr * 0.62, hr * 2, C.skin, 'handRod').scale(0.72, 1, 1).at(0, -hr, 0);
    n.hard.push(dressIn(h, coverAt(n, _pt.set(0, -hr, 0), hr * 1.7)));
  }
  for (const name of ['shinL', 'shinR']) for (const h of nodes[name].hard) if (h.tag === 'footRod') dressIn(h, coverAt(nodes[name], centreOf(h), P.footLen * 0.55));
  if ((o.scale || 1) >= 1.4) nodes.head.minRes = 32;                                  // a giant's face is big enough on screen to keep at distance

  // ---- weapon and shield ----
  let attack = w ? w.attack : (def.style === 'magic' ? 'cast' : st.claws > 0.3 ? 'claw' : 'swing');
  let pass = 0, butt = 0;
  if (w && held) {
    const rot = w.hold === 'bow' ? [90, -24, 0] : [gripRot[0], 0, -gripRot[2]];
    const wn = node('weaponR', 'handR', 'weapon', [-gripAt[0], gripAt[1], gripAt[2]], { prims: w.prims, hard: w.hard }, 1.2, rot);
    for (const h of wn.hard) { if (!h.geo.boundingBox) h.geo.computeBoundingBox(); butt = Math.max(butt, -_bb.copy(h.geo.boundingBox).applyMatrix4(h.m).min.y); }
    if (o.weapon === 'longbow') pass = restring(wn, node, ws);
  } else if (w && st.claws <= 0.3) {
    // strap-on claws for hands that have none of their own: hand at the origin, fingers along +Y, back of the hand +Z
    const wl = makeWeapon(o.weapon, { scale: ws });
    nodes.handL.hard.push(...flat(wl.hard).map((x) => orient(x, [0.004, -hr * 1.3, 0], [0, -1, 0], [1, 0, 0])));
    nodes.handR.hard.push(...flat(w.hard).map((x) => orient(x, [-0.004, -hr * 1.3, 0], [0, -1, 0], [-1, 0, 0])));
  }
  if (o.shield) {
    const sh = makeShield({ color: o.cloth, shape: SHIELD_SHAPE[def.id] || 'kite' });
    const yaw = 62, off = P.rFore + 0.034;
    node('shieldL', 'foreL', 'shield', [Math.sin(yaw * DEG) * off, -F * 0.58, Math.cos(yaw * DEG) * off], { prims: sh.prims, hard: sh.hard }, 1.2, [0, yaw, 0]);
  }
  const hold = held ? (o.weapon === 'crossbow' ? 'xbow' : w.hold) : 'none';
  // plain values the animators read (rigkit copies them onto the rig): weapon reach and how far its butt runs back
  // past the grip, how high a corpse lies, the arrow's pass, the body's size against a man's, the weapon's scale
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    kind: `humanoid.${hold}${o.shield ? '.shield' : ''}`, attack: attack || 'swing', nodes: order, hold,
    reach: r3(w && held ? w.length : 0), butt: r3(Math.min(butt, 0.6)), lie: r3(P.chestD * 0.36 + (st.gut || 0) * 0.02), pass: r3(pass),
    build: r3((P.upper + P.fore) / 0.325), wscale: r3(ws), handR: r3(hr),
  };
}

const _bb = new THREE.Box3();
/**
 * A longbow comes with a rigid string. Take it off and string the bow again as two halves, each its own node hinged at a
 * limb tip (rig list `string`), plus an arrow nocked where they meet (rig list `arrow`), so the animator can draw it.
 * Returns how far to the side of the grip the arrow passes the bow, or 0 if the string could not be found (the bow then
 * keeps its rigid string and the archer falls back to simply levelling it). Adapted from undead.js.
 */
function restring(wn, node, sc = 1) {
  const box = (h) => { if (!h.geo.boundingBox) h.geo.computeBoundingBox(); return _bb.copy(h.geo.boundingBox).applyMatrix4(h.m); };
  const isString = (h) => { const b = box(h); return b.max.x - b.min.x < 0.012 * sc && b.max.z - b.min.z < 0.012 * sc && b.max.z < -0.05 * sc; };
  const own = wn.hard.filter(isString);
  if (!own.length) return 0;
  wn.hard = wn.hard.filter((h) => !isString(h));
  let yTop = 0, yBot = 0, z = 0;
  for (const h of own) { const b = box(h); if (b.max.y > yTop) { yTop = b.max.y; z = (b.min.z + b.max.z) / 2; } yBot = Math.min(yBot, b.min.y); }
  const ny = 0.062 * sc, cord = 0xe4d9b8, serving = 0x6a5f48, sv = 0.03 * sc;
  const half = (len, sg) => ({ prims: [], hard: [
    H.cyl(0.002 * sc, 0.002 * sc, len - sv, 5).at(0, sg * (len - sv) / 2, 0).color(cord).pbr(0.8).near(),
    H.cyl(0.0029 * sc, 0.0029 * sc, sv, 5).at(0, sg * (len - sv / 2), 0).color(serving).pbr(0.85).lod(1),
  ] });
  node('stringU', 'weaponR', 'string', [0, yTop, z], half(yTop - ny, -1));
  node('stringL', 'weaponR', 'string', [0, yBot, z], half(ny - yBot, 1));
  // the arrow: nock at the node's origin, point toward +Z; goose-feather fletching in the unit's own green-grey
  const L = 0.45 * sc, ar = [
    H.cyl(0.0027 * sc, 0.0027 * sc, L - 0.03 * sc, 5).rot(90, 0, 0).at(0, 0, (L - 0.03 * sc) / 2 - 0.004 * sc).color(0x8a7450).pbr(0.8).lod(1),
    H.cone(0.0075 * sc, 0.036 * sc, 4).rot(90, 0, 0).at(0, 0, L - 0.012 * sc).color(0x5e5c64).pbr(0.5, 0.6).lod(1),
    H.cyl(0.0042 * sc, 0.0042 * sc, 0.008 * sc, 5).rot(90, 0, 0).at(0, 0, L - 0.036 * sc).color(0x5e5c64).pbr(0.5, 0.6).lod(1),
  ];
  for (let k = 0; k < 3; k++) ar.push(H.box(0.0008 * sc, 0.011 * sc, 0.055 * sc, 0.0003).at(0, 0.0072 * sc, 0.042 * sc).rot(0, 0, 30 + k * 120).color(k ? 0x8c8a7c : 0x9a3a2a).pbr(0.9).lod(1));
  node('arrow', 'weaponR', 'arrow', [0, ny, z], { prims: [], hard: ar });
  return 0.0172 * sc;
}

export const bodies = { humanoid };

// =====================================================================================
//  Animation: the stock biped does legs, torso, wings, tail and dying; this adds what a body
//  that actually holds things needs: wrists, a planted staff, a couched spear, a raised shield,
//  the second hand on a two-handed weapon.
// =====================================================================================
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _qe = new THREE.Quaternion();
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3(), _vd = new THREE.Vector3(), _ve = new THREE.Vector3();
const LEFT_GRIP = new THREE.Quaternion().setFromEuler(new THREE.Euler(60 * DEG, 0, 0, 'XYZ'));
const CARRY = {
  one: { ax: -0.12, fx: -0.55, d: [0, 0.8, 0.6], aim: 0 },
  two: { ax: -0.3, ay: 0.5, fx: -1.15, d: [0.34, 0.86, 0.36], aim: 1, left: -0.8 },
  pole: { ax: -0.1, fx: -0.95, d: [0.04, 0.9, 0.42], aim: 1 },
  staff: { ax: -0.1, fx: -1.3, d: [0.02, 1, 0.1], aim: 1 },
};
// right arm through an attack: [time, shoulder pitch, elbow bend, shoulder spread, weapon direction (or null = the carry direction)]
const MOVES = {
  swing: [[0, null, null, 0, null], [0.38, -2.0, -0.6, -0.25, [-0.22, 0.62, -0.75]], [0.47, -1.4, -0.4, -0.1, [-0.05, 0.92, 0.4]], [0.56, -0.55, -0.15, 0.12, [0.1, -0.1, 1]], [0.74, -0.32, -0.3, 0.1, [0.22, -0.4, 0.88]], [1, null, null, 0, null]],
  swing2: [[0, null, null, 0, null], [0.38, -2.1, -0.9, 0.12, [-0.3, 0.62, -0.72]], [0.47, -1.5, -0.6, 0.16, [0, 0.95, 0.3]], [0.56, -0.7, -0.3, 0.2, [0.12, -0.22, 0.97]], [0.74, -0.45, -0.4, 0.2, [0.25, -0.45, 0.86]], [1, null, null, 0, null]],
  slam: [[0, null, null, 0, null], [0.4, -2.35, -0.95, 0.12, [0, 0.68, -0.73]], [0.5, -1.6, -0.6, 0.16, [0, 1, 0.2]], [0.58, -0.75, -0.25, 0.2, [0, -0.3, 0.95]], [0.76, -0.5, -0.35, 0.2, [0, -0.45, 0.89]], [1, null, null, 0, null]],
  thrust: [[0, null, null, 0, null], [0.2, 0.35, -1.0, 0, [0.04, 0.04, 1]], [0.35, 0.6, -1.25, 0, [0.04, 0.02, 1]], [0.55, -0.5, -0.12, 0.08, [0.04, -0.02, 1]], [0.72, -0.4, -0.2, 0.06, [0.04, -0.02, 1]], [1, null, null, 0, null]],
  cast: [[0, null, null, 0, null], [0.4, -1.2, -0.55, -0.1, [0, 0.92, 0.38]], [0.6, -1.45, -0.12, 0, [0, 0.72, 0.7]], [1, null, null, 0, null]],
};
const ease = (t) => t * t * (3 - 2 * t);
const NO_OPTS = Object.freeze({}), OWN = Object.freeze({ ground: true }), ALIVE = {};

const restQuats = new WeakMap();
function restQuat(node) {
  let q = restQuats.get(node);
  if (!q) { const r = node.userData.rest; q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, 'XYZ')); restQuats.set(node, q); }
  return q;
}
/** rotation (in the root's space) that points a carried piece's +Y along d with its +Z as near to e as it can be */
function frameQuat(out, d, e) {
  _vy.copy(d).normalize();
  _vx.crossVectors(_vy, e);
  if (_vx.lengthSq() < 1e-8) _vx.set(1, 0, 0);
  _vx.normalize();
  _vz.crossVectors(_vx, _vy);
  return out.setFromRotationMatrix(_m4.makeBasis(_vx, _vy, _vz));
}
const foreQuat = (out, rig, i) => out.copy(rig.torso.quaternion).multiply(rig.arms[i].quaternion).multiply(rig.forearms[i].quaternion);
function wristPos(out, rig, i) {
  const arm = rig.arms[i], fore = rig.forearms[i], T = rig.torso;
  return out.copy(rig.hands[i].position).applyQuaternion(fore.quaternion).add(fore.position).applyQuaternion(arm.quaternion).add(arm.position).applyQuaternion(T.quaternion).add(T.position);
}
/** turn hand i at the wrist so that what it carries (rest rotation `carried` in the hand) faces along d / e, blended by w */
function aimHand(rig, i, d, e, w, carried) {
  if (w <= 0) return;
  frameQuat(_qb, d, e).multiply(_qc.copy(carried).invert());
  foreQuat(_qa, rig, i).invert().multiply(_qb);
  if (w >= 1) rig.hands[i].quaternion.copy(_qa); else rig.hands[i].quaternion.slerp(_qa, w);
}
/** two-bone reach: bend arm i so its wrist arrives at `target` (root space), blended by w over whatever it was doing */
function reach(rig, i, target, w) {
  const arm = rig.arms[i], fore = rig.forearms[i], T = rig.torso;
  _va.copy(arm.position).applyQuaternion(T.quaternion).add(T.position);
  const U = fore.position.length(), L = rig.hands[i].position.length();
  _vb.copy(target).sub(_va);
  const dist = clamp(_vb.length(), Math.abs(U - L) + 1e-3, U + L - 1e-3);
  const flex = Math.PI - Math.acos(clamp((U * U + L * L - dist * dist) / (2 * U * L), -1, 1));
  _vc.set(0, -U - L * Math.cos(flex), L * Math.sin(flex)).normalize();
  _vb.normalize().applyQuaternion(_qd.copy(T.quaternion).invert());
  _qd.setFromUnitVectors(_vc, _vb);
  if (w >= 1) { arm.quaternion.copy(_qd); fore.rotation.set(-flex, 0, 0); } else { arm.quaternion.slerp(_qd, w); fore.rotation.set(lerp(fore.rotation.x, -flex, w), fore.rotation.y * (1 - w), fore.rotation.z * (1 - w)); }
}

/**
 * Pose arms, wrists, weapon and shield for a body built by humanoid(). Call after the stock upper-body animation.
 * hold: none | one | two | pole | staff | bow | xbow.  Exported so mounted riders can reuse it.
 * shield: true keeps the left hand off the weapon (it has a shield, or a rein). Mounts have long passed `true` with no
 *   shield node to get a one-handed couched lance; that still works exactly as before.
 * opts (optional):
 *   oneHand  true: the weapon is wielded in the right hand only, even when there is no shield (the clean way to ask
 *            for a one-handed couch: poseCarried(rig, c, base, rig.hold, false, { oneHand: true })).
 *   ground   true: lift a swung weapon's direction so its head never digs into the ground (needs rig.reach and the
 *            rig standing on y = 0 in inner space, so the humanoid's own animators set it and mounts should not).
 */
export function poseCarried(rig, c, base, hold = 'none', shield = false, opts = NO_OPTS) {
  const A = rig.arms, F = rig.forearms, Hn = rig.hands, T = rig.torso;
  if (!A || !F || !Hn || !T || A.length < 2 || Hn.length < 2) return;
  const { R, keys } = base;
  const W = rig.weapon && rig.weapon[0], Sh = rig.shield && rig.shield[0];
  Hn[0].quaternion.identity(); Hn[1].quaternion.identity();
  if (W) { R(W); if (base.P) base.P(W); }                                            // whatever turned the weapon on its grip last frame starts from rest
  if (c.dead > 0) { if (Sh) R(Sh); return; }                                        // the dead let go: arms fall back to the stock pose
  const a = c.atk, k = c.moving && !c.flying ? 1 : 0, s = Math.sin(c.t * 9.5 + c.phase) * k, idle = Math.sin(c.t * 1.6 + c.phase);
  const carry = CARRY[hold], style = rig.attack, single = shield || !!opts.oneHand;

  // ---- weapon arm ----
  let both = carry && carry.left ? 1 : 0, spacing = carry && carry.left ? carry.left : 0;
  const known = a < 0 || style === 'swing' || style === 'thrust' || style === 'cast' || (style === 'slam' && (hold === 'two' || hold === 'pole'));
  if (carry && W && known) {
    let ax = carry.ax - s * (hold === 'one' ? 0.22 : 0.06) + idle * 0.015, fx = carry.fx - Math.max(0, -s) * 0.08, az = 0, aim = carry.aim;
    _vd.set(carry.d[0], carry.d[1], carry.d[2]);
    const two = hold === 'two' || (hold === 'pole' && !single);
    const move = a >= 0 ? (style === 'swing' ? (two ? MOVES.swing2 : MOVES.swing) : style === 'slam' ? (hold === 'two' || hold === 'pole' ? MOVES.slam : null) : MOVES[style]) : null;
    if (move) {
      let i = 1;
      while (i < move.length - 1 && a > move[i][0]) i++;
      const k0 = move[i - 1], k1 = move[i], t = ease(clamp((a - k0[0]) / (k1[0] - k0[0])));
      const v = (key, j, rest) => (key[j] == null ? rest : key[j]);
      ax = lerp(v(k0, 1, ax), v(k1, 1, ax), t); fx = lerp(v(k0, 2, fx), v(k1, 2, fx), t); az = lerp(k0[3], k1[3], t);
      const d0 = k0[4] || carry.d, d1 = k1[4] || carry.d;
      _vd.set(lerp(d0[0], d1[0], t), lerp(d0[1], d1[1], t), lerp(d0[2], d1[2], t));
      aim = lerp(k0[4] ? 1 : carry.aim, k1[4] ? 1 : carry.aim, t);
      if (two && hold === 'pole') { both = lerp(k0[4] ? 1 : 0, k1[4] ? 1 : 0, t); spacing = style === 'thrust' ? 1.5 : -1.25; }
    }
    R(A[1], ax, (carry.ay || 0) + (two && hold === 'pole' ? 0.5 * both : 0), az); R(F[1], fx);
    if (opts.ground && a >= 0) clearGround(rig, _vd);
    if (aim > 0) aimHand(rig, 1, _vd, _ve.crossVectors(_vd, _va.set(-1, 0, 0)), aim, restQuat(W));
    if (hold === 'one' && style === 'shoot') whirlSling(rig, c, base, W);           // the sling hangs slack from the fist
  } else if (hold === 'bow' && W && rig.arrow && rig.string && rig.hands) {
    shootBow(rig, c, base, W);
  } else if (hold === 'xbow' && W && style === 'shoot') {
    aimCrossbow(rig, c, base, W);
  } else if (hold === 'one' && W && a >= 0 && style === 'shoot') {
    whirlSling(rig, c, base, W);
  } else if ((hold === 'bow' || hold === 'xbow') && W && a >= 0 && style === 'shoot') {
    // level the bow at the target however the arm happens to be raised
    const lv = keys(a, [[0, 0], [0.22, 1], [0.72, 1], [1, 0]]);
    aimHand(rig, 1, _vd.set(0, 1, 0), _ve.set(0, 0, 1), lv, restQuat(W));
    if (hold === 'xbow') {
      // a crossbow is steadied from below with the off hand instead of being drawn
      foreQuat(_qe, rig, 1).multiply(Hn[1].quaternion);
      wristPos(_va, rig, 1);
      _vb.copy(W.position).applyQuaternion(_qe).add(_va);
      _qe.multiply(restQuat(W));
      const L = Hn[0].position.length();
      _vb.addScaledVector(_vd.set(0, 0, 1).applyQuaternion(_qe), L * 0.95).addScaledVector(_ve.set(0, 1, 0).applyQuaternion(_qe), -L * 0.12).addScaledVector(_vc.set(1, 0, 0).applyQuaternion(_qe), L * 0.2);
      reach(rig, 0, _vb, lv);
    }
  }

  // ---- off hand: the second grip of a two-handed weapon ----
  if (W && both > 0 && !single) {
    foreQuat(_qe, rig, 1).multiply(Hn[1].quaternion);                              // weapon hand in root space
    wristPos(_va, rig, 1);
    _vb.copy(W.position).applyQuaternion(_qe).add(_va);                            // the grip
    _qe.multiply(restQuat(W));                                                     // the weapon itself
    _vd.set(0, 1, 0).applyQuaternion(_qe); _ve.set(0, 0, 1).applyQuaternion(_qe);
    _vb.addScaledVector(_vd, spacing * Hn[0].position.length());                   // where the off hand closes on the shaft
    frameQuat(_qb, _vd, _ve).multiply(_qc.copy(LEFT_GRIP).invert());               // off hand in root space
    _vc.set(-W.position.x, W.position.y, W.position.z).applyQuaternion(_qb);
    _vb.sub(_vc);                                                                  // so its wrist must be here
    _qe.copy(_qb);
    reach(rig, 0, _vb, both);
    foreQuat(_qa, rig, 0).invert().multiply(_qe);
    if (both >= 1) Hn[0].quaternion.copy(_qa); else Hn[0].quaternion.slerp(_qa, both);
  }

  // ---- shield arm: forearm laid across the body, the shield strapped to it kept upright and facing the enemy ----
  if (Sh) {
    const lift = a >= 0 ? Math.sin(Math.PI * clamp(a)) : 0;
    R(A[0], -0.35 - lift * 0.1 + s * 0.05, 0, 0.2);
    const r = Sh.userData.rest, yaw = r ? r[1] : 1.08, sn = Math.sin(yaw), cs = Math.cos(yaw);
    _vy.set(0.72, -0.2 - lift * 0.15, -0.66).normalize();                           // the forearm's own +Y: back toward the elbow
    _vd.set(0.35, 0, 0.94); _vd.addScaledVector(_vy, -_vd.dot(_vy)).normalize();    // which way the strapped side should face
    _ve.crossVectors(_vy, _vd);
    _vx.copy(_vd).multiplyScalar(sn).addScaledVector(_ve, cs); _vz.copy(_vd).multiplyScalar(cs).addScaledVector(_ve, -sn);
    _qb.setFromRotationMatrix(_m4.makeBasis(_vx, _vy, _vz));                        // forearm in root space
    F[0].quaternion.copy(_qa.copy(T.quaternion).multiply(A[0].quaternion).invert().multiply(_qb));
    _vx.crossVectors(_va.set(0, 1, 0), _vd).normalize(); _vy.crossVectors(_vd, _vx);
    _qc.setFromRotationMatrix(_m4.makeBasis(_vx, _vy, _vd));                        // shield upright in root space
    Sh.quaternion.copy(_qb.invert().multiply(_qc));
  }
}

// =====================================================================================
//  Archers, crossbowmen and slingers. Two-bone reach with an elbow pole, wrist placement and the drawn
//  string are adapted from the skeleton archer in undead.js. All of it works in "inner" space: the space
//  the root node sits in, before the model's own scale.
// =====================================================================================
const _ka = new THREE.Vector3(), _kb = new THREE.Vector3(), _kc = new THREE.Vector3(), _kd = new THREE.Vector3(), _ke = new THREE.Vector3(), _kf = new THREE.Vector3(), _kg = new THREE.Vector3();
const _kx = new THREE.Vector3(), _ky = new THREE.Vector3(), _kz = new THREE.Vector3(), _wrist = new THREE.Vector3(), _km = new THREE.Matrix4();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qh = new THREE.Quaternion(), _qw = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0), _eul = new THREE.Euler();
/** orientation whose +Y lies along d and whose +Z is as near e as it can be (own temporaries, so callers may pass _va.. vectors) */
function frameQ(out, d, e) {
  _ky.copy(d).normalize();
  _kx.crossVectors(_ky, e);
  if (_kx.lengthSq() < 1e-8) _kx.set(1, 0, 0);
  _kx.normalize();
  _kz.crossVectors(_kx, _ky);
  return out.setFromRotationMatrix(_km.makeBasis(_kx, _ky, _kz));
}
/** two-bone reach with the elbow leaning toward `pole`; blended by w; leaves the wrist actually reached in _wrist */
function reachArm(rig, i, target, pole, w = 1) {
  const T = rig.torso, arm = rig.arms[i], fore = rig.forearms[i], hand = rig.hands[i];
  const S = _ka.copy(arm.position).applyQuaternion(T.quaternion).add(T.position);
  const U = fore.position.length(), L = hand.position.length();
  const D = _kb.copy(target).sub(S);
  const dist = clamp(D.length(), Math.abs(U - L) + 1e-4, (U + L) * 0.998);
  D.normalize();
  const along = (U * U - L * L + dist * dist) / (2 * dist), out = Math.sqrt(Math.max(0, U * U - along * along));
  const Pv = _kc.copy(pole).addScaledVector(D, -pole.dot(D));
  if (Pv.lengthSq() < 1e-8) Pv.set(0.3, -1, -0.3).addScaledVector(D, -(0.3 * D.x - D.y - 0.3 * D.z));
  Pv.normalize();
  _wrist.copy(S).addScaledVector(D, dist);
  _ky.copy(D).multiplyScalar(along).addScaledVector(Pv, out).normalize().negate();     // the upper arm's +Y: elbow up to the shoulder
  _kz.copy(Pv).negate(); _kz.addScaledVector(_ky, -_kz.dot(_ky)).normalize();          // the way the forearm folds
  _kx.crossVectors(_ky, _kz);
  _q1.setFromRotationMatrix(_km.makeBasis(_kx, _ky, _kz));
  _q2.copy(T.quaternion).invert().multiply(_q1);
  const flex = Math.PI - Math.acos(clamp((U * U + L * L - dist * dist) / (2 * U * L), -1, 1));
  _q3.setFromAxisAngle(X_AXIS, -flex);
  if (w >= 1) { arm.quaternion.copy(_q2); fore.quaternion.copy(_q3); } else { arm.quaternion.slerp(_q2, w); fore.quaternion.slerp(_q3, w); }
}
/** turn hand i at the wrist to the orientation q (inner space), blended by w */
function setHand(rig, i, q, w = 1) {
  _q1.copy(rig.torso.quaternion).multiply(rig.arms[i].quaternion).multiply(rig.forearms[i].quaternion).invert().multiply(q);
  if (w >= 1) rig.hands[i].quaternion.copy(_q1); else rig.hands[i].quaternion.slerp(_q1, w);
}
/** put the weapon's grip at G with +Y along d and +Z near e by moving the right arm and wrist; leaves the weapon's orientation in _qw */
function holdWeapon(rig, G, d, e, lean, w = 1) {
  const W = rig.weapon[0];
  frameQ(_qw, d, e);
  _qh.copy(_qw).multiply(_q3.copy(restQuat(W)).invert());                            // the hand that holds it so
  _kd.copy(W.position).applyQuaternion(_qh);                                          // wrist to grip
  _ke.set(0, 1, 0).applyQuaternion(_qh).add(lean);                                    // the forearm comes in along the hand
  reachArm(rig, 1, _kf.copy(G).sub(_kd), _ke, w);
  setHand(rig, 1, _qh, w);
  G.copy(_wrist).add(_kd);
}
/** turn the carried piece W (a child of hand i) so it lies along d / e in inner space, whatever the hand is doing */
function orientCarried(rig, i, W, d, e, w = 1) {
  frameQ(_q2, d, e);
  _q1.copy(rig.torso.quaternion).multiply(rig.arms[i].quaternion).multiply(rig.forearms[i].quaternion).multiply(rig.hands[i].quaternion).invert().multiply(_q2);
  if (w >= 1) W.quaternion.copy(_q1); else W.quaternion.slerp(_q1, w);
}
/** swing the two halves of the bowstring to meet `draw` behind where they rest, and seat the arrow on them */
function setString(rig, draw, shown) {
  const St = rig.string, Ar = rig.arrow && rig.arrow[0];
  if (!St || St.length < 2 || !Ar) return;
  const nock = Ar.userData.rest;
  if (!nock) return;
  St.forEach((n, i) => {
    const r = n.userData.rest, len = Math.abs(nock[4] - r[4]) || 1;
    n.rotation.set((i ? -1 : 1) * Math.atan2(draw, len), 0, 0);
    n.scale.set(1, Math.hypot(draw, len) / len, 1);
  });
  Ar.visible = shown;
  Ar.position.set(nock[3], nock[4], nock[5] - draw);
  Ar.rotation.set(0, -Math.atan2(rig.pass || 0, draw - nock[5]), 0);                // the shaft lies past the side of the grip
}

/** longbow: at the trail beside the leg; to shoot, turn side-on, raise the bow at the target, draw to the jaw and loose */
function shootBow(rig, c, base, W) {
  const { R, keys } = base, T = rig.torso, Ar = rig.arrow[0], a = c.atk;
  frameQ(_qw, _kg.set(0.1, 0.6, 0.8), _kb.set(0, -0.8, 0.6));                         // the trail: lower limb swung clear of the leg
  setHand(rig, 1, _qh.copy(_qw).multiply(_q3.copy(restQuat(W)).invert()));
  if (a < 0) { setString(rig, 0, false); return; }
  const up = keys(a, [[0, 0], [0.2, 1], [0.74, 1], [1, 0]]);                           // bow raised
  const pull = keys(a, [[0, 0], [0.18, 0], [0.46, 1], [0.66, 1], [1, 0.4]]);           // string hand back to the jaw (and it stays there after the loose)
  const held = keys(a, [[0, 0], [0.14, 0], [0.24, 1], [0.5, 1], [0.525, 0], [1, 0]]);  // fingers on the string
  const B = rig.build || 1;
  const ty = up * 1.2;                                                                 // side-on to the target, head turned back over the bow shoulder
  R(T, -0.04 * up, ty, 0.03 * up);
  R(rig.head, 0.02 * up, -ty * 0.9, 0);
  const hp = _kg.copy(rig.head.position).applyQuaternion(T.quaternion).add(T.position);
  const ax = hp.x + 0.122 * B, ay = hp.y - 0.05 * B, az = hp.z + 0.03 * B;            // the anchor beside the jaw (the head's origin is at eye level)
  const nock = Ar.userData.rest, brace = -nock[5], full = 0.29 * B;
  const G = _kg.set(ax, ay - nock[4], az + brace + full);
  holdWeapon(rig, G, _ka.set(0, 1, 0), _kb.set(0, 0, 1), _kc.set(-0.5, -0.9, 0), up);  // bow arm straight out at the target, bow upright
  const gx = G.x, gy = G.y, gz = G.z;
  // string hand: fingers forward and hooked round the string, palm to the face, forearm in line with the arrow
  _qh.setFromRotationMatrix(_km.makeBasis(_kx.set(1, 0, 0), _ky.set(0, 0, -1), _kz.set(0, 1, 0)));
  _qh.multiply(_q3.setFromEuler(_eul.set(0, 0, -0.5 * (1 - pull))));
  const hook = _kd.set(-0.018 * B, -0.086 * B, 0).applyQuaternion(_qh);
  const reachW = keys(a, [[0, 0], [0.2, 1], [0.66, 1], [1, 0]]);
  _kf.set(gx, gy + nock[4], lerp(gz - brace - 0.03 * B, az, pull)).sub(hook);
  _qw.copy(_qh);
  reachArm(rig, 0, _kf, _ke.set(0.5, 0.35, -1), reachW);
  setHand(rig, 0, _qw, reachW);
  const draw = clamp(gz - brace - (_wrist.z + hook.z), 0, full * 1.4) * held * up;
  setString(rig, draw, held > 0.03);
}

/** crossbow: carried at the side; to shoot, shoulder it with the butt in the pocket of the right shoulder, the off hand under the tiller */
const XBOW_SUPPORT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)));
function aimCrossbow(rig, c, base, W) {
  const { R, keys } = base, T = rig.torso, A = rig.arms, a = c.atk;
  if (a < 0) return;
  const up = keys(a, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]);                            // shouldered and aimed
  const kick = keys(a, [[0, 0], [0.44, 0], [0.47, 1], [0.66, 0], [1, 0]]);             // the loose jolts the muzzle up
  const B = rig.build || 1, ws = rig.wscale || 1, hr = rig.handR || 0.036;
  R(T, (-0.03 - 0.06 * kick) * up, -0.5 * up, 0.02 * up);                             // left shoulder toward the target
  R(rig.head, 0.17 * up, 0.42 * up, 0.24 * up);                                       // cheek down to the stock, eye along it
  // the butt plate sits in front of the right shoulder joint (torso space), the bolt points at the target
  const S = _kg.copy(A[1].position).add(_ka.set(0.05 * B, 0.035 * B, 0.075 * B)).applyQuaternion(T.quaternion).add(T.position);
  const k = 0.13 * kick;
  _kc.set(0, Math.cos(k), -Math.sin(k)); _ke.set(0, Math.sin(k), Math.cos(k));
  frameQ(_qw, _kc, _ke);
  const G = S.sub(_ka.set(0, 0.043 * ws, -0.2 * ws).applyQuaternion(_qw));
  holdWeapon(rig, G, _kc, _ke, _kb.set(-0.5, -0.85, -0.25), up);
  // off hand: palm up under the tiller ahead of the lock, fingers forward
  _qh.copy(_qw).multiply(XBOW_SUPPORT);
  const contact = _kf.set(0, 0.036 * ws, 0.11 * ws).applyQuaternion(_qw).add(G);
  contact.sub(_kd.set(-0.3 * hr, -1.0 * hr, 0.15 * hr).applyQuaternion(_qh));          // so the wrist goes here
  const q = _q2.copy(_qh);
  reachArm(rig, 0, contact, _ke.set(0.6, -1, 0.05), up);
  setHand(rig, 0, q, up);
}

/** sling: hangs from the fist; to shoot, whirl it overhead twice and cast it overarm at the target */
function whirlSling(rig, c, base, W) {
  const { R, keys } = base, T = rig.torso, A = rig.arms, F = rig.forearms, a = c.atk;
  if (a < 0) {
    const k = c.moving ? 1 : 0, sw = Math.sin(c.t * 9.5 + (c.phase || 0)) * k;
    orientCarried(rig, 1, W, _kc.set(0.02, -1, 0.08 + sw * 0.25), _ke.set(0, 0, 1));    // hanging slack from the fist, swinging with the stride
    return;
  }
  R(A[1], keys(a, [[0, 0], [0.14, -2.55], [0.6, -2.6], [0.67, -1.6], [0.77, -0.55], [1, 0]]), 0, keys(a, [[0, 0], [0.14, -0.4], [0.6, -0.38], [0.7, -0.08], [1, 0]]));
  R(F[1], keys(a, [[0, -0.2], [0.14, -0.75], [0.6, -0.75], [0.67, -0.3], [0.8, -0.35], [1, -0.2]]));
  R(A[0], keys(a, [[0, 0], [0.22, -1.25], [0.66, -1.3], [0.8, -0.35], [1, 0]]), 0, 0.12); R(F[0], -0.25);   // the free hand points the way
  R(T, keys(a, [[0, 0], [0.6, -0.06], [0.7, 0.22], [1, 0]]), keys(a, [[0, 0], [0.14, 0.32], [0.6, 0.38], [0.7, -0.3], [1, 0]]), 0);
  R(rig.head, 0, keys(a, [[0, 0], [0.14, -0.3], [0.6, -0.36], [0.7, 0.25], [1, 0]]), 0);
  let e = _ke.set(0, 1, 0);
  if (a < 0.14) { const t = ease(a / 0.14); _kc.set(0, lerp(-1, 0.2, t), lerp(0.08, -1, t)); }
  else if (a < 0.6) { const ph = -Math.PI / 2 - (0.6 - a) / 0.46 * 4 * Math.PI; _kc.set(Math.cos(ph), 0.22, Math.sin(ph)); }
  else if (a < 0.77) { const b = keys(a, [[0.6, 168], [0.645, 95], [0.69, 18], [0.77, -50]]) * DEG; _kc.set(0, Math.sin(b), Math.cos(b)); e = _ke.set(1, 0, 0); }
  else { const t = ease((a - 0.77) / 0.23); _kc.set(0, lerp(Math.sin(-50 * DEG), -1, t), lerp(Math.cos(-50 * DEG), 0.08, t)); }
  orientCarried(rig, 1, W, _kc, e);
}

/** keep the business end of a swung weapon out of the ground: lift the direction d (inner space) if the tip would dig in */
function clearGround(rig, d) {
  const reachLen = rig.reach || 0;
  if (!reachLen || !rig.hands) return;
  const y = wristPos(_kg, rig, 1).y, floor = 0.03;
  d.normalize();
  if (y + d.y * reachLen >= floor) return;
  const ny = clamp((floor - y) / reachLen, -1, 0.6), h = Math.hypot(d.x, d.z) || 1, s = Math.sqrt(Math.max(0, 1 - ny * ny)) / h;
  d.set(d.x * s, ny, d.z * s);
}

/**
 * The dead let go and lie slack: limbs splayed, head lolled to one side, what was carried lying flat beside the hand
 * instead of standing up out of the corpse, wings spread on the ground, the tail laid out to one side. Every joint
 * eases from the pose it had when the blow landed (the carry pose is posed first), so nothing snaps.
 */
const _qt = new THREE.Quaternion(), _et = new THREE.Euler(), _pt3 = new THREE.Vector3();
function toward(n, x, y, z, e) {
  if (!n) return;
  const r = n.userData.rest;
  _qt.setFromEuler(_et.set((r ? r[0] : 0) + x, (r ? r[1] : 0) + y, (r ? r[2] : 0) + z, 'XYZ'));
  n.quaternion.slerp(_qt, e);
}
function fallen(rig, inner, c) {
  const f = Math.min(1, c.dead * 2), e = ease(f), sg = Math.sin((c.phase || 0) * 7) >= 0 ? 1 : -1;
  const A = rig.arms || [], F = rig.forearms || [], L = rig.legs || [], Sn = rig.shins || [], T = rig.torso;
  if (T) { const r = T.userData.rest; toward(T, -(r ? r[0] : 0) * 0.7, 0, 0, e); }        // the hunch straightens out on the ground (no twist: lying down it would roll the body)
  toward(rig.head, -0.08, 0.55 * sg, 0.15 * sg, e);
  // arms flung out and dropped back to the ground (a deep chest lifts the shoulders off it)
  const drop = A[0] && F[0] && rig.hands ? Math.asin(clamp((rig.lie || 0) / (F[0].position.length() + rig.hands[0].position.length() + 0.04), 0, 0.6)) : 0;
  toward(A[0], 0.02 + drop, 0, 0.8 + 0.25 * sg, e); toward(F[0], -0.12, 0, 0, e);
  toward(A[1], 0.02 + drop, 0, -(0.8 - 0.25 * sg), e); toward(F[1], -0.16, 0, 0, e);
  // one knee drawn up (the thigh lifts so the foot rests on the ground instead of bending into it)
  const kn0 = sg > 0 ? 0.6 : 0.12, kn1 = sg > 0 ? 0.1 : 0.55;
  toward(L[0], -0.02 - kn0 * 0.62, 0, 0.13 + 0.05 * sg, e); toward(Sn[0], kn0, 0, 0, e);
  toward(L[1], -0.02 - kn1 * 0.62, 0, -(0.15 - 0.05 * sg), e); toward(Sn[1], kn1, 0, 0, e);
  for (const h of rig.hands || []) h.quaternion.slerp(_qt.identity(), e);
  // the weapon falls out of the hand and lies past it, butt at the fingers, blade flat; the shield lies flat on its arm
  for (const n of rig.weapon || []) {
    const r = n.userData.rest;
    toward(n, Math.PI - (r ? r[0] : 0), Math.PI / 2 - (r ? r[1] : 0), 0, e);
    if (r) n.position.lerp(_pt3.set(r[3], r[4] - (rig.butt || 0), r[5]), e);
  }
  for (const n of rig.shield || []) { const r = n.userData.rest; toward(n, 0, -(r ? r[1] : 0), 0, e); }
  setString(rig, 0, false);
  (rig.wings || []).forEach((w, i) => toward(w, 0.22, (i ? 1 : -1) * 0.36, (i ? 1 : -1) * 0.38, e));   // spread flat on the ground instead of folded into it
  // the tail: the root swung down to lie along the ground off to one side, the rest curling flat beside it
  (rig.tail || []).forEach((s, i) => { const r = s.userData.rest; toward(s, -(r ? r[0] : 0) - (i ? 0 : Math.PI / 2), (i ? 0.35 : 1.25) * sg, 0, e); });
  inner.position.y += (rig.lie || 0) * (inner.scale.y || 1) * f;                       // lie on the ground, not half in it
}

/** custom animators: one entry per way of carrying things, so the rig's kind says how the hands are used */
export const animators = {};
for (const hold of ['none', 'one', 'two', 'pole', 'staff', 'bow', 'xbow']) {
  for (const sh of [false, true]) {
    animators[`humanoid.${hold}${sh ? '.shield' : ''}`] = (rig, inner, c, base) => {
      base.biped(rig, inner, c);
      if (c.dead > 0) {
        // pose what the living body was doing with its hands, then let every joint ease from there into the fall
        poseCarried(rig, Object.assign(ALIVE, c, { dead: 0, atk: -1 }), base, hold, sh, OWN);
        fallen(rig, inner, c);
      } else poseCarried(rig, c, base, hold, sh, OWN);
    };
  }
}
