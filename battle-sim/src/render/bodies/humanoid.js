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
// Joint positions come from proportions(o) in anatomy.js. Every part is built for the LEFT side
// (lateral = +X, medial = -X) and mirrored for the right.
//
// o.pose === 'riding' builds the legs astride (their nodes then carry no `rig` tag, so a mount's animator leaves
// them alone). gear.dress(ctx) is called once the bare body exists; weapons and shields are attached after it.
// The description's kind is `humanoid.<hold>[.shield]`, which picks the animator at the bottom of this file.
import * as THREE from 'three';
import { S, H, rgb, noise3, distanceTo } from '../sculpt.js';
import { proportions } from './anatomy.js';
import { dress } from './gear.js';
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
  const slit = !!look.slit, pA = Math.sin(16 * DEG) * (look.pupilSize ?? 1), iA = Math.sin(34 * DEG);
  const h = H.geo(eyeGeo(look.cornea ?? 0.045)).shade((x, y, z) => {
    if (y < 0.2) return null;
    const d = Math.hypot(x, z);
    if (slit) { if (Math.abs(x) < pA * 0.4 && Math.abs(z) < iA * 0.86) return pupil; } else if (d < pA * 1.01) return pupil;
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
  ogre: { muscle: 0.2, gut: 1, fingers: 4, feet: 'bare', toes: 4, claws: 0.2, det: 1.08, armOut: 15, tint: [0.09, 13] },
  troll: { muscle: 0.5, gut: 0.24, fingers: 3, feet: 'bare', toes: 3, claws: 0.6, det: 1.0, armOut: 8, tint: [0.15, 11], hide: ['noise', 0.0035, 30] },
  cyclops: { muscle: 0.8, gut: 0.15, fingers: 4, feet: 'bare', toes: 4, claws: 0.2, det: 1.08, armOut: 9, tint: [0.08, 16] },
  minotaur: { muscle: 1, fingers: 3, feet: 'hoof', claws: 0.2, det: 1.0, armOut: 9, tint: [0.12, 14], tail: 'bull' },
  demon: { muscle: 1, fingers: 4, feet: 'bare', toes: 3, claws: 1, det: 1.08, armOut: 9, tint: [0.14, 12], tail: 'barb', wings: 'bat' },
  imp: { muscle: 0.3, gut: 0.35, fingers: 3, feet: 'bare', toes: 3, claws: 0.7, det: 1, armOut: 6, tint: [0.12, 16], tail: 'spade', wings: 'bat' },
  ghoul: { muscle: 0.2, fingers: 4, feet: 'bare', toes: 4, claws: 1, det: 1, armOut: 5, tint: [0.15, 13], gaunt: 1 },
  harpy: { muscle: 0.3, fingers: 3, feet: 'talon', claws: 0.9, det: 1, armOut: 6, tint: [0.07, 26], female: 1, noWrap: 1, tail: 'fan', wings: 'feather' },
};

function palette(def, o, sp) {
  const skin = o.skin ?? 0xd9a77c;
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
  if (sp === 'minotaur') Object.assign(C, { lip: 0x2a1c18, nail: 0x1c1614, claw: 0x1c1614, linen: 0x2c2018, light: tone(skin, 0.015, -0.06, 0.16), fur: tone(skin, 0, -0.04, -0.09), horn: 0xd8cba6 });
  if (sp === 'demon' || sp === 'imp') Object.assign(C, { lip: tone(skin, 0, 0, -0.16), blush: tone(skin, 0.02, 0.05, 0.04), nail: 0x141012, claw: 0x141012, linen: 0x1e1614, tooth: 0xf0e6c8, light: tone(skin, 0.015, 0.02, 0.06), horn: 0x1a1416, mouth: 0x2a0a08, ember: 0xff7a1e });
  if (sp === 'harpy') Object.assign(C, { claw: 0x2a2622, nail: 0x2a2622, plume: o.cloth ?? 0x6a5a8a, scale: 0xc79a3e });
  C.fur ??= tone(skin, 0, -0.05, -0.12);
  C.horn ??= 0xd8cba6;
  C.plume ??= o.cloth ?? 0x6a5a8a;
  return C;
}

// =====================================================================================
//  Body parts. Each returns { prims, hard } in its node's space, built for the LEFT side.
// =====================================================================================

/**
 * A plain tapered rod hidden inside a limb, from y = 0 down to y = -len. Up close it is buried in the sculpt;
 * on the farthest detail level, where a thin limb can fall between the sculpt's sample points, it is what
 * keeps the limb there at all.
 */
const core = (rTop, rBottom, len, color) => H.cyl(rTop, rBottom, len, 6).at(0, -len / 2, 0).color(color).pbr(0.8);

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
  // smallclothes: a wrap around the hips so nobody is ever naked
  if (!st.noWrap) {
    p.push(S.cyl(hw * 1.9, 0.135, 0.02).at(0, -0.022, 0).color(C.linen).tint(0.1, 60).pbr(0.92).paint(0.004, 0));
    p.push(S.cyl(hw * 1.3, 0.016, 0.004).at(0, 0.04, 0).color(tone(C.linen, 0, 0, -0.12)).pbr(0.9).paint(0.003, 0.004));
  }
  return { prims: p, hard };
}

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
  if (sp === 'minotaur') p.push(B.fur(S.ellipsoid(r * 1.2, r * 1.0, r * 1.2).at(r * 0.15, -r * 0.1, -r * 0.1).blend(0.03), 0.01));
  if (sp === 'harpy') p.push(B.plume(S.ellipsoid(r * 1.25, r * 1.5, r * 1.25).at(r * 0.15, -r * 0.5, 0).blend(0.014)));
  if (sp === 'hobgoblin') p.push(S.cyl(r * 2, 0.016, 0.004).at(0, -U * 0.42, 0).color(0x6e1c14).pbr(0.85).paint(0.004, 0));     // war paint band
  if (sp === 'demon') hard.push(spike([0, -U + r * 0.1, -r * 0.8], [0, 0.35, -1], r * 1.5, r * 0.34, C.horn, [0, 1, 0], 0.3));   // elbow spur
  if (B.lord) p.push(S.capsule([r * 0.9, -r * 0.6, r * 0.5], [r * 0.6, -U * 0.5, r * 0.8], 0.005).color(C.ember).glow(1.7).paint(0.004, 0), S.capsule([r * 0.6, -U * 0.5, r * 0.8], [r * 0.9, -U * 0.8, r * 0.3], 0.005).color(C.ember).glow(1.7).paint(0.004, 0));
  if (sp === 'ghoul') p.push(S.capsule([-r * 0.3, -r, r * 0.8], [r * 0.1, -U * 0.9, r * 0.75], 0.004).color(0x3c4250).paint(0.004, 0.001));
  hard.push(core(r * 0.7, r * 0.58, U, C.skin));
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
  if (sp === 'minotaur') p.push(S.cyl(r * 2, F * 0.5, 0.004).at(0, -F * 0.3, 0).color(C.fur).paint(0.03, 0));
  if (sp === 'ghoul') p.push(S.capsule([r * 0.5, -F * 0.1, r * 0.6], [r * 0.2, -F * 0.9, rw * 0.9], 0.004).color(0x3c4250).paint(0.004, 0.001));
  hard.push(core(r * 0.68, rw * 0.7, F, C.skin));
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
  hard.push(core(r * 0.76, rc * 0.68, L, sp === 'harpy' ? C.plume : C.skin));
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
    hard.push(core(rc * 0.7, ra * 0.9, L * 0.92, C.fur));
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
    hard.push(core(ra * 0.66, ra * 0.58, L, C.scale));
    return { prims: p, hard };
  }
  p.push(sk(S.sphere(rc * 0.98)));
  p.push(sk(S.capsule([0, 0, 0], [0, -L, 0], rc * 0.88, ra).blend(0.03)));
  p.push(sk(S.ellipsoid(rc * 0.6, L * 0.27, rc * 0.72).at(-rc * 0.28, -L * 0.29, -rc * 0.48).blend(0.018)));            // calf: inner head
  p.push(sk(S.ellipsoid(rc * 0.54, L * 0.24, rc * 0.64).at(rc * 0.34, -L * 0.3, -rc * 0.42).blend(0.018)));             // calf: outer head
  p.push(sk(S.capsule([0, -L * 0.1, rc * 0.5], [0, -L * 0.9, ra * 0.55], rc * 0.3, ra * 0.4).blend(0.016)));            // shin bone
  p.push(...[1, -1].map((s) => sk(S.sphere(ra * 0.5).at(s * ra * 0.78, -L + ra * 0.1, -ra * 0.1).blend(0.01))));        // ankle bones
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
  p.push(S.box(0.4, 0.1, 0.5, 0).at(0, gy - 0.05, 0.05).cut(0.003));                                                   // flat sole on the ground
  hard.push(core(rc * 0.66, ra * 0.7, L, st.feet === 'shoe' ? C.skin : C.skin));
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
  crossbow: { hair: 'crop', hairCol: 0x1e1814, beard: 'goatee', jaw: 1.02, nose: 0.96, brow: 1.15, eye: 0x4a3a2a, scar: 1 },
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
  // nose
  const ns = fem ? 0.82 : 1;
  p.push(sk(S.capsule([0, R * 0.1, R * 0.84], [0, -R * 0.34 * nl, R * (0.98 + 0.08 * nl)], R * 0.065 * ns, R * 0.09 * ns).blend(0.014)));
  p.push(sk(S.sphere(R * 0.105 * ns).at(0, -R * 0.37 * nl, R * (0.98 + 0.07 * nl)).blend(0.01)));
  p.push(...S.mirrorX([sk(S.sphere(R * 0.07 * ns).at(R * 0.11 * ns, -R * 0.4 * nl - R * 0.02, R * 0.93).blend(0.009))]));
  // mouth mound
  const my = -R * 0.66, mz = R * 0.875;
  p.push(sk(S.ellipsoid(R * 0.3, R * 0.2, R * 0.2).at(0, my + R * 0.01, R * 0.69).blend(0.018)));
  // ears
  p.push(...S.mirrorX([
    sk(S.ellipsoid(R * 0.07, R * 0.23, R * 0.16).rot(-12, 22, 0).at(R * 0.86, -R * 0.08, -R * 0.06).blend(0.01)),
    S.ellipsoid(R * 0.045, R * 0.14, R * 0.085).rot(-12, 22, 0).at(R * 0.935, -R * 0.07, -R * 0.03).cut(0.006).color(C.shade),
  ]));
  p.push(neckStub(B, R));
  // eyes
  const er = R * (fem ? 0.185 : 0.168);
  eyeSet(p, hard, C, { x: R * 0.38, y: 0, r: er, z0: R * 2, look: { iris: f.eye, glow: f.glowEyes }, lash: fem ? 0x1c1014 : 0x2a1c14,
    lidCol: tone(C.skin, -0.005, -0.08, gauntF ? -0.26 : -0.2), socket: gauntF ? C.deep : undefined, lid: { upper: old ? 44 : 37, roll: -4 * (bh - 0.9) * 2.5 } });
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
  p.push(...S.mirrorX([stroke(R * 0.36, R * (0.3 + 0.015 * bh), R * 0.84, R * 0.24, R * 0.05 * bh * (fem ? 0.7 : 1), R * 0.2, 24, 5 - 8 * (bh - 1)).color(old ? 0xcfcac0 : fem ? 0x2a2030 : tone(hc, 0, 0, -0.06)).pbr(0.9).paint(0.004, 0.0028)]));
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
      break;
    case 'tonsure':
      p.push(cap(0.06), S.box(R * 3, R * 3, R * 2, 0).at(0, 0, R * 1.14).cut(0.012).color(hc));       // nothing left in front of the ears
      p.push(S.ellipsoid(R * 0.78, R * 0.62, R * 0.86).at(0, R * 0.98, -R * 0.06).cut(0.012).color(hc), napeCut(-18, -1.0));
      break;
    case 'crest': {
      // harpy: a cap of small feathers and a crest of long plumes swept back from the brow
      const cols = B.featherCols, pl = B.plume;
      p.push(pl(S.ellipsoid(R * 0.92, R * 0.96 * L, R * 1.04).at(0, R * 0.22, -R * 0.1)), faceCut(-0.42, 0.7, 0.98), napeCut(-30, -1.2));
      for (let i = -3; i <= 3; i++) {
        const a = i / 3;
        hard.push(feather([R * a * 0.4, R * (0.86 - a * a * 0.16), R * (0.5 - Math.abs(a) * 0.1)], [a * 0.5, 0.7 - Math.abs(a) * 0.15, -1], R * (1.5 - Math.abs(a) * 0.5), R * 0.36, [a * 0.6, 1, 0.5], cols));
      }
      for (const s of [-1, 1]) for (let j = 0; j < 3; j++) hard.push(feather([s * R * 0.84, R * (0.1 - j * 0.14), -R * 0.1], [s * 0.5, 0.15 - j * 0.25, -1], R * (0.9 - j * 0.12), R * 0.3, [s, 0.2, 0.3], cols, 1));
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
      // a mossy mane straggling down from the crown in ropes
      const hc = 0x2c3620, hp = [];
      const hair = (x) => x.color(hc).tint(0.3, 20).pbr(0.9).bump(0.006, 40, 'fur');
      hp.push(hair(S.ellipsoid(R * 0.3, R * 0.14, R * 0.4).at(0, R * 1.28, -R * 0.3)));
      for (let i = 0; i < 9; i++) {
        const a = (i - 4) * 0.38, len = 0.9 + 0.5 * ((i * 7) % 3) / 2;
        const top = [Math.sin(a) * R * 0.22, R * 1.3, -R * 0.34], mid = [Math.sin(a) * R * 0.7, R * (0.95 - Math.cos(a) * 0.1), -R * (0.3 + Math.cos(a) * 0.7)], end = [Math.sin(a) * R * 0.86, R * (0.95 - len), -R * (0.26 + Math.cos(a) * 0.84)];
        hp.push(hair(bone(top, mid, R * 0.1, R * 0.085).blend(0.01)), hair(bone(mid, end, R * 0.085, R * 0.035).blend(0.008)));
      }
      hairPart = { prims: hp, hard: [] };
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
      // bald crown with a shaggy fringe behind the ears
      const hp = [];
      const hair = (x) => x.color(0x3a2a1e).tint(0.25, 22).pbr(0.75).bump(0.011, 32, 'fur');
      for (let i = 0; i < 9; i++) { const a = (i - 4) * 0.36; hp.push(hair(bone([Math.sin(a) * R * 0.8, R * 0.24, -R * (0.08 + Math.cos(a) * 0.86)], [Math.sin(a) * R * (1.0 + 0.08 * (i % 2)), -R * (0.2 + 0.14 * (i % 3)), -R * (0.1 + Math.cos(a) * 0.98)], R * 0.2, R * 0.08).blend(0.02))); }
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
    bull: { l: 0.115 * k, r: [0.017 * k, 0.013 * k, 0.011 * k, 0.01 * k], rot: [[-74, 0, 0], [-10, 0, 0], [8, 0, 0]] } }[kind];
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

const HEADS = { human: humanHead, harpy: humanHead, goblin: goblinHead, hobgoblin: goblinHead, ghoul: ghoulHead, troll: giantHead, ogre: giantHead, cyclops: giantHead, minotaur: bullHead, demon: fiendHead, imp: fiendHead };
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
  const B = { def, o, P, st, C, sk, fur, plume, featherCols, sp, face: faceFor(def, sp), lord: sp === 'demon' && (def.id === 'infernalLord' || o.build === 'heavy') };
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
    segs.forEach((s, i) => { node(`tail${i}`, parent, 'tail', pos, s, 1.15 * det, s.rot); parent = `tail${i}`; pos = [0, 0, -s.len]; });
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

  // ---- weapon and shield ----
  let attack = w ? w.attack : (def.style === 'magic' ? 'cast' : st.claws > 0.3 ? 'claw' : 'swing');
  if (w && held) {
    const rot = w.hold === 'bow' ? [90, -24, 0] : [gripRot[0], 0, -gripRot[2]];
    node('weaponR', 'handR', 'weapon', [-gripAt[0], gripAt[1], gripAt[2]], { prims: w.prims, hard: w.hard }, 1.2, rot);
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
  return { kind: `humanoid.${hold}${o.shield ? '.shield' : ''}`, attack: attack || 'swing', nodes: order, hold };
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
 */
export function poseCarried(rig, c, base, hold = 'none', shield = false) {
  const A = rig.arms, F = rig.forearms, Hn = rig.hands, T = rig.torso;
  if (!A || !F || !Hn || !T || A.length < 2 || Hn.length < 2) return;
  const { R, keys } = base;
  const W = rig.weapon && rig.weapon[0], Sh = rig.shield && rig.shield[0];
  Hn[0].quaternion.identity(); Hn[1].quaternion.identity();
  if (c.dead > 0) { if (Sh) R(Sh); return; }                                        // the dead let go: arms fall back to the stock pose
  const a = c.atk, k = c.moving && !c.flying ? 1 : 0, s = Math.sin(c.t * 9.5 + c.phase) * k, idle = Math.sin(c.t * 1.6 + c.phase);
  const carry = CARRY[hold], style = rig.attack;

  // ---- weapon arm ----
  let both = carry && carry.left ? 1 : 0, spacing = carry && carry.left ? carry.left : 0;
  const known = a < 0 || style === 'swing' || style === 'thrust' || style === 'cast' || (style === 'slam' && (hold === 'two' || hold === 'pole'));
  if (carry && W && known) {
    let ax = carry.ax - s * (hold === 'one' ? 0.22 : 0.06) + idle * 0.015, fx = carry.fx - Math.max(0, -s) * 0.08, az = 0, aim = carry.aim;
    _vd.set(carry.d[0], carry.d[1], carry.d[2]);
    const two = hold === 'two' || (hold === 'pole' && !shield);
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
    if (aim > 0) aimHand(rig, 1, _vd, _ve.crossVectors(_vd, _va.set(-1, 0, 0)), aim, restQuat(W));
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
  if (W && both > 0 && !shield) {
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

/** custom animators: one entry per way of carrying things, so the rig's kind says how the hands are used */
export const animators = {};
for (const hold of ['none', 'one', 'two', 'pole', 'staff', 'bow', 'xbow']) {
  for (const sh of [false, true]) animators[`humanoid.${hold}${sh ? '.shield' : ''}`] = (rig, inner, c, base) => { base.biped(rig, inner, c); poseCarried(rig, c, base, hold, sh); };
}
