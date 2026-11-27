// Great beasts of the deep for naval battles: the sea-god, the living waterspout, the sea dragon, the giant
// shark, the armoured crab, the abyssal angler, the coiling serpent and the horned whale.
//
// Built with the same kit as seacreatures.js, which hands its helpers over through install() and merges the
// result into its own `creatures` and `animators`. Same conventions: authored facing +Z in a normalised space
// (body inside a circle of radius ~1.3), turned to +X by the root node, scaled by def.size, waterline y = 0.
import * as THREE from 'three';
import { S, H, noise3, buildPartGeometry } from '../sculpt.js';

const DEG = Math.PI / 180, PI = Math.PI;
const ROOT = { name: 'root', pos: [0, 0, 0], rot: [0, 90, 0] };
let tone, mix, rnd, lerp, clamp, smooth, cached, into, loft, blade, eye, spike, aim, surf, station, hull, span, slab, under, fan, place, horn,
  coreGeo, barnacle, harpoon, ribbonGeo, newLay, layChain, eulerDeg, poseChain, R, P, pulse, frac, rigged;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const FOAM = 0xf1f7f9, MIST = 0xe4f1f8;
/** foam on the water: a ring of flattened white lumps of radius R about the origin (rx, rz stretch it) */
function foamRing(Rr, n, r, seed, rz = 1, y = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i + rnd(i, seed) * 0.7) / n * PI * 2, k = 0.6 + rnd(i, seed + 1) * 0.8, rr = Rr * (0.93 + rnd(i, seed + 2) * 0.16);
    out.push(H.sphere(r * k, 11).scale(1.5, 0.55, 1.1).rot(0, -a / DEG, 0).at(Math.sin(a) * rr, y + r * 0.05, Math.cos(a) * rr * rz).color(FOAM).pbr(0.95).glow(0.14).lod(k > 1 ? 9 : 1));
  }
  return out;
}
/** a table of (z, y) against distance along a path that starts at (z0, y0) and heads the way dir(p) says (radians below the -Z axis) */
function pathTable(z0, y0, len, dir, step = 0.02) {
  const n = Math.ceil(len / step) + 4, zs = new Float32Array(n), ys = new Float32Array(n);
  let z = z0, y = y0;
  for (let i = 0; i < n; i++) { zs[i] = z; ys[i] = y; const d = dir(i * step); z -= Math.cos(d) * step; y -= Math.sin(d) * step; }
  return { step, n, zs, ys };
}
function pathAt(B, p, o) {
  const f = clamp(p / B.step, 0, B.n - 1.001), i = Math.floor(f), k = f - i;
  o[1] = lerp(B.ys[i], B.ys[i + 1], k); o[2] = lerp(B.zs[i], B.zs[i + 1], k);
  return o;
}
/** a plume of mist sculpted once and carried as one hard piece (so it can be left off the far levels) */
function mistPiece(prims, lo, hi, top, res = 56) {
  const g = buildPartGeometry({ prims }, { res, ao: 0.35 });
  return g ? H.geo(g).shade((x, y, z) => mix(lo, hi, clamp(y / top, 0, 1) * 0.55 + noise3(x * 30, y * 30, z * 30) * 0.45)).pbr(1).glow(0.12) : null;
}
const finite = (v) => (Number.isFinite(v) ? v : 0);

// =====================================================================================
// TRITON: a sea-god risen to the waist, bearded, coral-crowned, a bronze trident cocked to stab
// =====================================================================================
function tritonDesc(def) {
  const base = def.color ?? 0x4f9a86, skin = mix(base, 0xa9824e, 0.26), shade = tone(skin, 0.02, 0.02, -0.1), lite = mix(skin, 0xd0a868, 0.3), scale = tone(base, 0.03, 0.08, -0.14);
  const bronze = 0xb07f38, gold = 0xe2bd62, verd = 0x4f9a86, beard = 0xdfeee6, beardDk = 0x8fbcae, kelp = 0x2f5a34, kelpLt = 0x5d8a3a, coral = 0xe0604a, coralLt = 0xf4b08a, pearl = 0xf2ecdf;
  const wet = 0.42;
  const sk = (p, c = skin) => p.color(c).pbr(wet).bump(0.004, 26).tint(0.12, 7);
  const sc = (p) => p.color(scale).pbr(0.36).bump(0.007, 30, 'scales').tint(0.18, 11);
  const br = (p, c = bronze) => p.color(c).pbr(0.34, 0.85).tint(0.2, 14);

  // ---- hips at the waterline: girdle of bronze scales, a shell clasp, kelp trailing into the sea ----
  const hips = [
    sk(S.ellipsoid(0.34, 0.22, 0.25).at(0, -0.06, 0)),
    br(S.torus(0.315, 0.05).at(0, 0.1, 0).blend(0.01)).scale(1),
  ];
  hips[1].bump(0.004, 40, 'weave');
  for (let row = 0; row < 2; row++) for (let i = 0; i < 16; i++) {
    const a = (i + row * 0.5) / 16 * PI * 2, rx = 0.35 + row * 0.03, rz = 0.265 + row * 0.03, c = (i + row) % 3 === 0 ? gold : i % 2 ? bronze : tone(verd, 0, 0, -0.08);
    hips.push(S.ellipsoid(0.07, 0.1, 0.026).rot(14, a / DEG, 0).at(Math.sin(a) * rx, 0.0 - row * 0.1, Math.cos(a) * rz).color(c).pbr(0.34, 0.8).bump(0.004, 44, 'scales').blend(0.008));
  }
  const hipsHard = [
    // the clasp: a ribbed scallop over the navel
    H.sphere(1, 18).scale(0.1, 0.1, 0.03).at(0, 0.1, 0.275).shade((x, y) => (Math.sin(Math.atan2(x, y + 0.12) * 26) > 0.2 ? coralLt : null)).color(pearl).pbr(0.3),
    H.sphere(0.028, 10).at(0, 0.035, 0.285).color(pearl).pbr(0.2).lod(2),
  ];
  for (let i = 0; i < 12; i++) {
    const a = (i + 0.5 + (rnd(i, 3) - 0.5) * 0.5) / 12 * PI * 2, sx = Math.sin(a), cz = Math.cos(a), L = 0.22 + rnd(i, 5) * 0.14;
    const pts = [[sx * 0.33, 0.06, cz * 0.25], [sx * 0.39, -0.04, cz * 0.31], [sx * (0.42 + rnd(i, 6) * 0.06), -0.05 - L * 0.5, cz * 0.35], [sx * 0.46, -0.06 - L, cz * 0.4]];
    hipsHard.push(H.geo(ribbonGeo(pts, (s) => 0.03 + Math.sin(s * PI) * 0.025, [sx, 0.2, cz], 0.3, 10)).color(i % 3 ? kelp : kelpLt).pbr(0.5).lod(i % 2 ? 2 : 9));
  }

  // ---- torso ----
  const TO = [0, 0.1, 0];
  const torso = [
    sk(S.ellipsoid(0.3, 0.3, 0.215).at(0, 0.3, 0.0)),                                                    // belly
    sk(S.ellipsoid(0.41, 0.33, 0.27).at(0, 0.74, -0.015).blend(0.08)),                                    // ribcage
    sk(S.capsule([0, 1.0, -0.05], [0, 1.24, 0.0], 0.17, 0.125).blend(0.06)),                              // neck
    ...S.mirrorX([
      sk(S.ellipsoid(0.215, 0.16, 0.115).rot(0, 0, 8).at(0.19, 0.86, 0.19).blend(0.035), lite),          // pectorals
      sk(S.capsule([0.1, 1.15, -0.06], [0.42, 1.07, -0.04], 0.11, 0.1).blend(0.06)),                      // trapezius
      sk(S.ellipsoid(0.13, 0.3, 0.15).at(0.34, 0.62, -0.1).blend(0.06), shade),                           // lats
      sk(S.ellipsoid(0.16, 0.2, 0.1).at(0.16, 0.88, -0.23).blend(0.05)),                                  // shoulder blades
      sk(S.ellipsoid(0.07, 0.17, 0.09).rot(0, 0, -12).at(0.275, 0.4, 0.09).blend(0.04), shade),           // obliques
      sk(S.capsule([0.03, 1.07, 0.15], [0.36, 1.1, 0.08], 0.03, 0.035).blend(0.03), lite),                // collar bones
      sk(S.sphere(0.15).at(0.47, 1.04, 0.0).blend(0.05)),                                                 // socket under the deltoid
    ]),
  ];
  for (let i = 0; i < 4; i++) torso.push(...S.mirrorX([sk(S.ellipsoid(0.078, 0.058, 0.05).at(0.082, 0.62 - i * 0.125, 0.185 - Math.abs(i - 1) * 0.008).blend(0.03), lite)]));   // the wall of the stomach
  for (let i = 0; i < 3; i++) torso.push(...S.mirrorX([sk(S.ellipsoid(0.06, 0.035, 0.06).rot(0, 0, -30).at(0.3, 0.72 - i * 0.085, 0.14 - i * 0.015).blend(0.025))]));          // ribs under the arm
  torso.push(
    S.capsule([0, 0.25, -0.24], [0, 0.98, -0.3], 0.03).color(shade).paint(0.03, -0.02),                   // spine
    S.capsule([0, 0.3, 0.24], [0, 0.82, 0.3], 0.018).color(shade).paint(0.02, -0.012),                    // midline
    S.sphere(0.025).at(0, 0.215, 0.212).cut(0.01).color(shade),
    // scaled hide over the shoulders and down the flanks, a necklace of shell and tooth
    ...S.mirrorX([
      sc(S.ellipsoid(0.2, 0.1, 0.2).at(0.36, 1.1, -0.04).blend(0.03)).paint(0.03, 0.006),
      sc(S.ellipsoid(0.08, 0.3, 0.2).at(0.38, 0.55, -0.06)).paint(0.03, 0.004),
    ]),
    sc(S.ellipsoid(0.12, 0.42, 0.08).at(0, 0.62, -0.3)).paint(0.03, 0.005),
  );
  const torsoHard = [];
  for (let i = 0; i < 11; i++) {
    const u = (i - 5) / 5, x = u * 0.27, y = 1.0 - (1 - u * u) * 0.13, z = 0.2 + (1 - u * u) * 0.085;
    torsoHard.push(i % 2 ? H.sphere(0.036, 10).at(x, y, z).color(pearl).pbr(0.2).lod(1) : spike(0.13, 0.03, 0.3, 6).rot(180, 0, 0).at(x, y + 0.01, z + 0.004).color(0xe9e0c6).pbr(0.3).lod(2));
  }
  // a dorsal crest of spines down the back
  for (let i = 0; i < 6; i++) torsoHard.push(spike(0.13 - i * 0.012, 0.03, 0.3, 6, 0.5).rot(-70 - i * 3, 0, 0).at(0, 0.98 - i * 0.13, -0.3 + Math.abs(i - 2) * 0.012).color(scale).pbr(0.4).shade((x, y) => (y > 0.6 ? coralLt : null)));

  // ---- head: heavy brow, hooked nose, beard like breaking surf, kelp for hair ----
  const HD = [0, 1.25, 0.0];
  const skull = [
    sk(S.ellipsoid(0.15, 0.17, 0.175).at(0, 1.46, 0.0)),
    sk(S.ellipsoid(0.125, 0.12, 0.13).at(0, 1.34, 0.045).blend(0.05)),                                    // jaw
    ...S.mirrorX([sk(S.capsule([0.0, 1.476, 0.15], [0.115, 1.502, 0.12], 0.036, 0.034).blend(0.025), shade)]),    // brow, drawn down in anger
    sk(S.capsule([0, 1.485, 0.16], [0, 1.39, 0.215], 0.026, 0.036).blend(0.02)),                          // nose
    ...S.mirrorX([
      sk(S.ellipsoid(0.045, 0.035, 0.04).at(0.09, 1.41, 0.13).blend(0.03), lite),                         // cheekbones
      sk(S.ellipsoid(0.02, 0.045, 0.03).rot(0, 0, -10).at(0.155, 1.45, 0.0).blend(0.015)),                // ears: finned
    ]),
  ];
  const head = [...skull,
    ...S.mirrorX([S.ellipsoid(0.034, 0.017, 0.03).rot(0, 0, 12).at(0.066, 1.452, 0.155).cut(0.01).color(0x12302c)]),
    S.capsule([-0.05, 1.335, 0.165], [0.05, 1.335, 0.165], 0.012).cut(0.008).color(0x4a1a22),             // the mouth, set in a snarl
    S.capsule([-0.045, 1.352, 0.166], [0.045, 1.352, 0.166], 0.014, 0.014).color(tone(skin, 0, 0, -0.14)).pbr(0.4).blend(0.01),
  ];
  const lock = (pts, r0, r1, c, k = 0.022, rg = false) => S.limb(pts, pts.map((_, i) => lerp(r0, r1, i / (pts.length - 1)))).map((q) => q.color(c).pbr(0.6).bump(rg ? 0.004 : 0.007, rg ? 30 : 20, rg ? 'ridges' : 'noise').blend(k));
  // beard: a dozen heavy locks tumbling to the chest, a moustache swept wide
  for (let i = 0; i < 11; i++) {
    const u = (i - 5) / 5, x = u * 0.115, z0 = 0.13 - Math.abs(u) * 0.09, L = 0.36 - Math.abs(u) * 0.14 + rnd(i, 21) * 0.05, wob = (rnd(i, 22) - 0.5) * 0.06;
    head.push(...lock([[x, 1.32 - Math.abs(u) * -0.03, z0], [x * 1.25 + wob, 1.32 - L * 0.4, z0 + 0.075], [x * 1.3 - wob, 1.32 - L * 0.75, z0 + 0.09], [x * 1.1 + wob * 0.5, 1.32 - L, z0 + 0.06]], 0.048, 0.016, i % 3 === 1 ? beardDk : beard));
  }
  head.push(...S.mirrorX([...lock([[0.012, 1.362, 0.175], [0.07, 1.345, 0.165], [0.13, 1.3, 0.13], [0.17, 1.22, 0.11]], 0.026, 0.01, beard, 0.012)]));
  head.push(...S.mirrorX([...lock([[0.03, 1.5, 0.15], [0.085, 1.515, 0.135], [0.135, 1.495, 0.1]], 0.02, 0.012, beardDk, 0.01)]));   // eyebrows
  // hair: ropes of kelp down the back and over the shoulders
  for (let i = 0; i < 9; i++) {
    const a = (70 + i * 27.5) * DEG, sx = Math.sin(a), cz = Math.cos(a), L = 0.38 + rnd(i, 31) * 0.16;
    head.push(...lock([[sx * 0.11, 1.57, cz * 0.12], [sx * 0.17, 1.44, cz * 0.17 - 0.02], [sx * 0.2, 1.44 - L * 0.5, cz * 0.19 - 0.05], [sx * 0.22 + (rnd(i, 32) - 0.5) * 0.08, 1.44 - L, cz * 0.2 - 0.06]], 0.045, 0.018, i % 2 ? kelp : mix(kelp, kelpLt, 0.5), 0.022, true));
  }
  const headHard = [
    ...H.mirrorX([eye(0.026, { iris: 0xa8fff0, rim: 0x2c8a84, white: 0x9fe8de, shape: 'none', irisDeg: 58, rough: 0.1, glow: 1.2 }).rot(0, 8, 0).at(0.066, 1.452, 0.14)]),
    // crown: a hoop of beaten gold, branching coral, shells and pearls
    H.torus(0.158, 0.022, 28, 8).rot(90, 0, 0).rot(-8, 0, 0).at(0, 1.56, -0.005).color(gold).pbr(0.3, 0.9),
  ];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2, sx = Math.sin(a), cz = Math.cos(a), hgt = (i === 0 ? 0.27 : 0.15 + rnd(i, 41) * 0.1), y0 = 1.56 + cz * 0.022, bx = sx * 0.158, bz = cz * 0.158 - 0.005;
    const tw = (rnd(i, 42) - 0.5) * 0.08;
    headHard.push(horn([[bx, y0, bz], [bx * 1.12 + tw, y0 + hgt * 0.45, bz * 1.12], [bx * 1.2 - tw, y0 + hgt, bz * 1.2 + tw]], 0.022, 0.007, coral, coralLt, 4, 6));
    headHard.push(horn([[bx * 1.1 + tw * 0.6, y0 + hgt * 0.38, bz * 1.1], [bx * 1.32 + tw, y0 + hgt * 0.6, bz * 1.3 - tw], [bx * 1.42, y0 + hgt * 0.86, bz * 1.38]], 0.013, 0.005, coral, coralLt, 3, 5).lod(2));
    headHard.push(H.sphere(0.02, 8).at(sx * 0.17 * Math.cos(0.35) + cz * 0.17 * Math.sin(0.35), y0 - 0.004 + Math.cos(a + 0.35) * 0.002, cz * 0.17 * Math.cos(0.35) - sx * 0.17 * Math.sin(0.35)).color(pearl).pbr(0.2).lod(1));
  }
  headHard.push(H.sphere(1, 16).scale(0.06, 0.065, 0.02).rot(-12, 0, 0).at(0, 1.6, 0.16).shade((x, y) => (Math.sin(Math.atan2(x, y + 0.08) * 22) > 0.2 ? coralLt : null)).color(pearl).pbr(0.3));

  // ---- arms ----
  const UP = 0.56, FO = 0.47;
  const upper = () => [
    sk(S.sphere(0.175).at(0, 0.0, 0)),
    sk(S.capsule([0, 0, 0], [0, -UP, 0], 0.125, 0.092).blend(0.05)),
    sk(S.ellipsoid(0.105, 0.19, 0.115).at(0, -0.27, 0.045).blend(0.04), lite),                            // biceps
    sk(S.ellipsoid(0.1, 0.2, 0.1).at(0, -0.25, -0.055).blend(0.04), shade),                               // triceps
    sk(S.sphere(0.1).at(0, -UP, 0).blend(0.03)),
    sc(S.ellipsoid(0.2, 0.13, 0.2).at(0, 0.05, -0.02)).paint(0.03, 0.006),
  ];
  const fore = (sd, fist) => {
    const p = [
      sk(S.sphere(0.097).at(0, 0, 0)),
      sk(S.capsule([0, 0, 0], [0, -FO, 0], 0.1, 0.066).blend(0.03)),
      sk(S.ellipsoid(0.085, 0.16, 0.09).at(sd * 0.02, -0.14, 0.02).blend(0.04), lite),
      // vambrace: bronze, banded with gold
      br(S.cyl(0.092, 0.2, 0.012).at(0, -0.3, 0).blend(0.004)).bump(0.004, 44, 'scales'),
      br(S.torus(0.094, 0.016).at(0, -0.2, 0).blend(0.004), gold),
      br(S.torus(0.08, 0.014).at(0, -0.4, 0).blend(0.004), gold),
    ];
    const hard = [H.geo(coreGeo(0.085, 0.06, FO)).rot(90, 0, 0).color(skin), spike(0.15, 0.03, 0.4, 6, 0.4).rot(110, 0, 0).at(0, -0.1, -0.09).color(scale).pbr(0.4), spike(0.11, 0.026, 0.4, 6, 0.4).rot(110, 0, 0).at(0, -0.22, -0.085).color(scale).pbr(0.4).lod(2)];
    const wy = -FO - 0.085;
    if (fist) {
      // a fist round the shaft (which runs along Z through the palm)
      p.push(sk(S.ellipsoid(0.085, 0.07, 0.1).at(0, -FO - 0.04, 0).blend(0.03)));
      for (let i = 0; i < 4; i++) p.push(sk(S.torus(0.062, 0.031).rot(90, 0, 0).at(0, wy - 0.012, -0.078 + i * 0.052).blend(0.012), i % 2 ? skin : lite));
      p.push(sk(S.capsule([-sd * 0.05, -FO - 0.03, 0.06], [-sd * 0.055, wy - 0.05, 0.1], 0.033, 0.026).blend(0.015)));
    } else {
      // an open, grasping hand
      p.push(sk(S.ellipsoid(0.08, 0.085, 0.045).at(0, -FO - 0.07, 0.0).blend(0.03)));
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 0.045, k = 1 - Math.abs(i - 1.5) * 0.12, b = [x, -FO - 0.14, 0.0], m = [x * 1.2, -FO - 0.14 - 0.1 * k, 0.03], e = [x * 1.25, -FO - 0.14 - 0.17 * k, 0.085];
        p.push(sk(S.capsule(b, m, 0.027, 0.023).blend(0.012)), sk(S.capsule(m, e, 0.023, 0.017).blend(0.008)));
        hard.push(aim(spike(0.045, 0.014, 0.3, 5), e, [0, -0.5, 0.8]).color(0xd9e6da).pbr(0.3).lod(1));
      }
      p.push(sk(S.capsule([-sd * 0.07, -FO - 0.05, 0.02], [-sd * 0.12, -FO - 0.12, 0.07], 0.03, 0.02).blend(0.012)));
    }
    return { prims: p, hard };
  };
  const fL = fore(1, false), fR = fore(-1, true);

  // ---- trident: grip at the origin, tines toward +Z ----
  const tri = [], G = (h) => h.color(bronze).pbr(0.3, 0.9), TL = 1.06, BL = 0.74;
  tri.push(
    H.cyl(0.029, 0.031, TL + BL, 10).rot(90, 0, 0).at(0, 0, (TL - BL) / 2).color(tone(bronze, 0, -0.05, -0.1)).pbr(0.4, 0.85).shade((x, y, z) => (noise3(x * 90, y * 14, z * 90) > 0.62 ? verd : null)),
    G(H.cyl(0.05, 0.036, 0.1, 10).rot(90, 0, 0).at(0, 0, TL - 0.03)),
    G(H.torus(0.04, 0.014, 14, 6).at(0, 0, TL - 0.12)).color(gold), G(H.torus(0.04, 0.014, 14, 6).at(0, 0, 0.2)).color(gold).lod(2), G(H.torus(0.04, 0.014, 14, 6).at(0, 0, -0.2)).color(gold).lod(2),
    G(H.sphere(0.055, 12).scale(1, 1, 1.5).at(0, 0, -BL)).color(gold),
    aim(spike(0.13, 0.04, 0, 6), [0, 0, -BL - 0.05], [0, 0, -1]).color(bronze).pbr(0.3, 0.9).lod(2),
    // the head: a crescent bar, three barbed tines
    G(H.tube([[-0.2, 0, TL + 0.2], [-0.17, 0, TL + 0.06], [-0.08, 0, TL], [0, 0, TL - 0.01], [0.08, 0, TL], [0.17, 0, TL + 0.06], [0.2, 0, TL + 0.2]], [0.026, 0.034, 0.042, 0.048, 0.042, 0.034, 0.026], 24, 8)),
    aim(spike(0.5, 0.042, 0, 8, 0.55), [0, 0, TL - 0.01], [0, 0, 1]).color(gold).pbr(0.22, 0.95),
  );
  for (const sd of [-1, 1]) {
    tri.push(aim(spike(0.3, 0.034, 0, 8, 0.55), [sd * 0.2, 0, TL + 0.17], [sd * -0.06, 0, 1]).color(gold).pbr(0.22, 0.95));
    for (const x of [0, sd * 0.2]) tri.push(aim(spike(0.1, 0.022, 0, 5, 0.5), [x + sd * 0.012, 0, TL + (x ? 0.36 : 0.36)], [sd * 0.9, 0, -0.75]).color(gold).pbr(0.22, 0.95).lod(2));
  }

  const foam = [...foamRing(0.47, 22, 0.075, 3, 0.86), ...foamRing(0.6, 15, 0.05, 7, 0.86)];
  const foam2 = [...foamRing(0.78, 14, 0.04, 11, 0.9)];
  return { kind: 'triton', nodes: [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: [0, 0.14, 0], prims: hips, hard: hipsHard, detail: 0.62 },
    { name: 'torso', parent: 'body', rig: 'torso', pos: TO, prims: into(TO, torso), hard: into(TO, torsoHard), detail: 0.6 },
    { name: 'head', parent: 'torso', rig: 'head', pos: sub(HD, TO), prims: into(HD, head), hard: into(HD, headHard), detail: 0.95 },
    { name: 'armL', parent: 'torso', rig: 'arms', pos: sub([0.5, 1.05, 0], TO), rot: [-38, 0, 24], prims: upper(), hard: [H.geo(coreGeo(0.1, 0.08, UP)).rot(90, 0, 0).color(skin)], detail: 0.6 },
    { name: 'foreL', parent: 'armL', rig: 'forearms', pos: [0, -UP, 0], rot: [-62, 0, -14], prims: fL.prims, hard: fL.hard, detail: 0.72 },
    { name: 'armR', parent: 'torso', rig: 'arms', pos: sub([-0.5, 1.05, 0], TO), rot: [0, -8, -104], prims: upper(), hard: [H.geo(coreGeo(0.1, 0.08, UP)).rot(90, 0, 0).color(skin)], detail: 0.6 },
    { name: 'foreR', parent: 'armR', rig: 'forearms', pos: [0, -UP, 0], rot: [0, 0, -92], prims: fR.prims, hard: fR.hard, detail: 0.72 },
    { name: 'trident', parent: 'foreR', rig: 'weapon', pos: [0, -FO - 0.097, 0], rot: [16, 0, 0], hard: tri },
    { name: 'foam0', parent: 'root', rig: 'foam', pos: [0, 0, 0], hard: foam },
    { name: 'foam1', parent: 'root', rig: 'foam', pos: [0, 0, 0], hard: foam2 },
  ] };
}
function animTriton(model, { t, phase }) {
  const rig = model.userData.rig, w = t * 1.1 + phase;
  // every few seconds he draws the trident back and drives it down at the sea ahead
  const c = frac(t * 0.15 + phase * 0.17), draw = pulse(c, 0.0, 0.34), stab = pulse(c, 0.24, 0.46);
  const breath = Math.sin(w * 1.3);
  R(rig.body, Math.sin(w * 0.5) * 0.02, 0, Math.sin(w * 0.4 + 1) * 0.02);
  P(rig.body, 0, Math.sin(w * 0.8) * 0.012, 0);
  R(rig.torso, Math.sin(w * 0.7) * 0.03 - draw * 0.1 + stab * 0.32, Math.sin(w * 0.45) * 0.1 - draw * 0.34 + stab * 0.5, Math.sin(w * 0.6 + 2) * 0.025);
  if (rig.torso) rig.torso.scale.set(1 + breath * 0.012, 1, 1 + breath * 0.02);
  R(rig.head, Math.sin(w * 0.8 + 1) * 0.04 + stab * 0.12 - draw * 0.06, Math.sin(w * 0.37 + 2) * 0.2 * (1 - draw) + draw * 0.2 - stab * 0.3, 0);
  const A = rig.arms || [], F = rig.forearms || [];
  R(A[0], Math.sin(w * 0.9) * 0.08 - draw * 0.5 + stab * 0.25, 0, Math.sin(w * 0.7 + 1) * 0.06 + draw * 0.2);
  R(F[0], Math.sin(w * 1.1 + 2) * 0.1 + draw * 0.35 - stab * 0.2, 0, 0);
  R(A[1], 0, Math.sin(w * 0.6) * 0.05 - draw * 0.42 + stab * 0.75, Math.sin(w * 0.9 + 0.5) * 0.04 - draw * 0.1 + stab * 0.3);
  R(F[1], 0, 0, Math.sin(w * 0.8 + 1) * 0.04 - draw * 0.12 + stab * 0.5);
  const W = rig.weapon && rig.weapon[0];
  R(W, Math.sin(w * 0.9) * 0.03 - draw * 0.08 + stab * 0.3, 0, 0);
  (rig.foam || []).forEach((f, i) => { const k = 1 + Math.sin(t * (1.7 - i * 0.5) + phase + i * 2) * 0.06 + stab * 0.1 * (i + 1); f.scale.set(k, 1, k); f.rotation.y = t * (i ? -0.12 : 0.16) + i; });
}
// REG ['triton', tritonDesc, animTriton],

const ALL = [
  ['triton', tritonDesc, animTriton],
];

// =====================================================================================
const creatures = {}, animators = {};
function reg(key, desc, anim, k = 1) {
  creatures[key] = (def) => {
    let d = def && typeof def === 'object' ? def : {};
    if (!(d.id || d.model) || !(d.size > 0) || (d.color != null && !Number.isFinite(+d.color))) d = { ...d, model: d.model || key, size: d.size > 0 ? +d.size : 1, color: Number.isFinite(+d.color) && d.color != null ? +d.color : undefined };
    return rigged(d, desc, k);
  };
  animators[key] = (model, ctx) => { if (model && model.userData && model.userData.rig) anim(model, { t: finite(ctx && ctx.t), phase: finite(ctx && ctx.phase) }); };
}
/** called once by seacreatures.js with its helpers; returns { creatures, animators } to merge */
export function install(kit) {
  ({ tone, mix, rnd, lerp, clamp, smooth, cached, into, loft, blade, eye, spike, aim, surf, station, hull, span, slab, under, fan, place, horn,
    coreGeo, barnacle, harpoon, ribbonGeo, newLay, layChain, eulerDeg, poseChain, R, P, pulse, frac, rigged } = kit);
  for (const [key, desc, anim, k] of ALL) reg(key, desc, anim, k);
  return { creatures, animators };
}
