// Great beasts of the deep for naval battles: the sea-god, the living waterspout, the sea dragon, the giant
// shark, the armoured crab, the abyssal angler, the coiling serpent and the horned whale.
//
// Built with the same kit as seacreatures.js, which hands its helpers over through install() and merges the
// result into its own `creatures` and `animators`. Same conventions: authored facing +Z in a normalised space
// (body inside a circle of radius ~1.3), turned to +X by the root node, scaled by def.size, waterline y = 0.
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
    const lump = (seg) => H.sphere(r * k, seg).scale(1.5, 0.55, 1.1).rot(0, -a / DEG, 0).at(Math.sin(a) * rr, y + r * 0.05, Math.cos(a) * rr * rz).color(FOAM).pbr(0.95).glow(0.14);
    if (k > 1.12) out.push(lump(11).near(), lump(5).far()); else out.push(lump(k > 0.9 ? 11 : 8).lod(k > 0.9 ? 2 : 1));
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
    H.sphere(1, 18).scale(0.1, 0.1, 0.03).at(0, 0.1, 0.275).shade((x, y) => (Math.sin(Math.atan2(x, y + 0.12) * 26) > 0.2 ? coralLt : null)).color(pearl).pbr(0.3).near(),
    H.sphere(0.028, 10).at(0, 0.035, 0.285).color(pearl).pbr(0.2).near(),
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
    torsoHard.push(i % 2 ? H.sphere(0.036, 10).at(x, y, z).color(pearl).pbr(0.2).lod(1) : spike(0.13, 0.03, 0.3, 6).rot(180, 0, 0).at(x, y + 0.01, z + 0.004).color(0xe9e0c6).pbr(0.3).near());
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
    ...H.mirrorX([eye(0.026, { iris: 0xa8fff0, rim: 0x2c8a84, white: 0x9fe8de, shape: 'none', irisDeg: 58, rough: 0.1, glow: 1.2 }).rot(0, 8, 0).at(0.066, 1.452, 0.14).near(), H.sphere(0.02, 6).at(0.066, 1.452, 0.15).color(0xa8fff0).glow(1.2).far()]),
    // crown: a hoop of beaten gold, branching coral, shells and pearls
    H.torus(0.158, 0.022, 18, 6).rot(90, 0, 0).rot(-8, 0, 0).at(0, 1.56, -0.005).color(gold).pbr(0.3, 0.9),
  ];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2, sx = Math.sin(a), cz = Math.cos(a), hgt = (i === 0 ? 0.27 : 0.15 + rnd(i, 41) * 0.1), y0 = 1.56 + cz * 0.022, bx = sx * 0.158, bz = cz * 0.158 - 0.005;
    const tw = (rnd(i, 42) - 0.5) * 0.08;
    headHard.push(horn([[bx, y0, bz], [bx * 1.12 + tw, y0 + hgt * 0.45, bz * 1.12], [bx * 1.2 - tw, y0 + hgt, bz * 1.2 + tw]], 0.022, 0.007, coral, coralLt, 4, 6));
    headHard.push(horn([[bx * 1.1 + tw * 0.6, y0 + hgt * 0.38, bz * 1.1], [bx * 1.32 + tw, y0 + hgt * 0.6, bz * 1.3 - tw], [bx * 1.42, y0 + hgt * 0.86, bz * 1.38]], 0.013, 0.005, coral, coralLt, 3, 5).near());
    headHard.push(H.sphere(0.02, 8).at(sx * 0.17 * Math.cos(0.35) + cz * 0.17 * Math.sin(0.35), y0 - 0.004 + Math.cos(a + 0.35) * 0.002, cz * 0.17 * Math.cos(0.35) - sx * 0.17 * Math.sin(0.35)).color(pearl).pbr(0.2).lod(1));
  }
  headHard.push(H.sphere(1, 16).scale(0.06, 0.065, 0.02).rot(-12, 0, 0).at(0, 1.6, 0.16).shade((x, y) => (Math.sin(Math.atan2(x, y + 0.08) * 22) > 0.2 ? coralLt : null)).color(pearl).pbr(0.3).near());

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
    const hard = [H.geo(coreGeo(0.085, 0.06, FO)).rot(90, 0, 0).color(skin), spike(0.15, 0.03, 0.4, 6, 0.4).rot(110, 0, 0).at(0, -0.1, -0.09).color(scale).pbr(0.4), spike(0.11, 0.026, 0.4, 6, 0.4).rot(110, 0, 0).at(0, -0.22, -0.085).color(scale).pbr(0.4).near()];
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
    G(H.torus(0.04, 0.014, 14, 6).at(0, 0, TL - 0.12)).color(gold), G(H.torus(0.04, 0.014, 14, 6).at(0, 0, 0.2)).color(gold).near(), G(H.torus(0.04, 0.014, 14, 6).at(0, 0, -0.2)).color(gold).near(),
    G(H.sphere(0.055, 12).scale(1, 1, 1.5).at(0, 0, -BL)).color(gold),
    aim(spike(0.13, 0.04, 0, 6), [0, 0, -BL - 0.05], [0, 0, -1]).color(bronze).pbr(0.3, 0.9).near(),
    // the head: a crescent bar, three barbed tines
    G(H.tube([[-0.2, 0, TL + 0.2], [-0.17, 0, TL + 0.06], [-0.08, 0, TL], [0, 0, TL - 0.01], [0.08, 0, TL], [0.17, 0, TL + 0.06], [0.2, 0, TL + 0.2]], [0.026, 0.034, 0.042, 0.048, 0.042, 0.034, 0.026], 24, 8)),
    aim(spike(0.5, 0.042, 0, 8, 0.55), [0, 0, TL - 0.01], [0, 0, 1]).color(gold).pbr(0.22, 0.95),
  );
  for (const sd of [-1, 1]) {
    tri.push(aim(spike(0.3, 0.034, 0, 8, 0.55), [sd * 0.2, 0, TL + 0.17], [sd * -0.06, 0, 1]).color(gold).pbr(0.22, 0.95));
    for (const x of [0, sd * 0.2]) tri.push(aim(spike(0.1, 0.022, 0, 5, 0.5), [x + sd * 0.012, 0, TL + (x ? 0.36 : 0.36)], [sd * 0.9, 0, -0.75]).color(gold).pbr(0.22, 0.95).near());
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

// =====================================================================================
// SEA ELEMENTAL: a waterspout that has grown a chest, two arms of falling water and a breaking wave for a head
// =====================================================================================
function seaElementalDesc(def) {
  const base = def.color ?? 0x2f7fb8, deep = tone(base, 0.01, 0.06, -0.15), mid = base, lite = mix(base, 0xbfe6fb, 0.3), pale = mix(base, 0xe6f7ff, 0.62), abyss = tone(base, 0.03, 0.05, -0.27);
  const wat = (p, c, g = 0.06) => p.color(c).pbr(0.16).glow(g).tint(0.1, 6);
  const fm = (p) => p.color(FOAM).pbr(0.95).glow(0.16).bump(0.012, 22);
  const drop = (r, x, y, z, l = 1) => H.sphere(r, 7).at(x, y, z).color(pale).pbr(0.2).glow(0.2).lod(l);
  // radius of the spout against height
  const LIFT = 0.26;
  const PROF = [{ z: 0.92 + LIFT, w: 0.34 }, { z: 1.0, w: 0.29 }, { z: 0.8, w: 0.225 }, { z: 0.58, w: 0.19 }, { z: 0.36, w: 0.2 }, { z: 0.16, w: 0.3 }, { z: 0.0, w: 0.5 }, { z: -0.1, w: 0.58 }];
  const rad = (y) => station(PROF, y).w;
  const CUT = [-0.1, 0.34, 0.76, 0.92 + LIFT], COL = [deep, mid, lite], RIB = [mid, lite, pale];

  // ---- the spout: three stacked lengths that turn at different speeds, ribbed with spiralling water ----
  const segs = [];
  for (let s = 0; s < 3; s++) {
    const y0 = CUT[s], y1 = CUT[s + 1], p = [], hard = [], N = 5;
    for (let i = 0; i < N; i++) { const a = lerp(y0, y1, i / N), b = lerp(y0, y1, (i + 1) / N); p.push(wat(S.cone(rad(a), rad(b), b - a + 0.02, 0.01).at(0, (a + b) / 2, 0).blend(0.03), mix(COL[s], COL[Math.min(2, s + 1)], i / N)).bump(0.006, 16, 'ridges')); }
    for (let k = 0; k < 4; k++) {
      const pts = [], rr = [];
      for (let i = 0; i <= 6; i++) { const y = lerp(y0, y1, i / 6), a = (k / 4) * PI * 2 + (y - CUT[0]) * 4.6, r = rad(y) * 0.99; pts.push([Math.sin(a) * r, y, Math.cos(a) * r]); rr.push(0.05 - s * 0.006 + (s === 0 ? (1 - i / 6) * 0.03 : 0)); }
      p.push(...S.limb(pts, rr).map((q) => wat(q, RIB[s], 0.1).blend(0.035)));
    }
    if (s === 0) {
      // the skirt: tongues of water thrown up where the spout tears at the sea, foam along its lip
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * PI * 2 + rnd(i, 3), h = 0.14 + rnd(i, 4) * 0.16, r = 0.5 + rnd(i, 5) * 0.06;
        p.push(wat(S.capsule([Math.sin(a) * r * 0.9, -0.02, Math.cos(a) * r * 0.9], [Math.sin(a + 0.3) * (r + 0.08), h, Math.cos(a + 0.3) * (r + 0.08)], 0.07, 0.022).blend(0.05), lite, 0.1));
        p.push(fm(S.sphere(0.035).at(Math.sin(a + 0.3) * (r + 0.085), h + 0.01, Math.cos(a + 0.3) * (r + 0.085)).blend(0.015)));
        hard.push(drop(0.014 + rnd(i, 6) * 0.012, Math.sin(a + 0.5) * (r + 0.15), h + 0.05 + rnd(i, 7) * 0.1, Math.cos(a + 0.5) * (r + 0.15)), drop(0.011, Math.sin(a + 0.1) * (r + 0.2), h * 0.5 + 0.03, Math.cos(a + 0.1) * (r + 0.2), 0));
      }
      p.push(fm(S.torus(0.53, 0.05).at(0, 0.0, 0).blend(0.03)));
    }
    if (s === 1) for (let i = 0; i < 5; i++) { const a = rnd(i, 13) * PI * 2, y = 0.4 + i * 0.07; p.push(fm(S.ellipsoid(0.06, 0.02, 0.03).rot(0, a / DEG, 0).at(Math.sin(a) * rad(y), y, Math.cos(a) * rad(y)).blend(0.012))); }
    const o = [0, y0, 0];
    segs.push({ name: `spout${s}`, parent: 'root', rig: 'segs', pos: o, prims: into(o, p), hard: into(o, hard), detail: 0.6 });
  }

  // ---- chest and shoulders, swelling out of the top of the spout ----
  const TO = [0, 0.9, 0];
  const torso = [
    wat(S.cone(0.33, 0.3, 0.14, 0.02).at(0, 0.94, 0), lite),
    wat(S.ellipsoid(0.36, 0.25, 0.25).at(0, 1.12, 0.01).blend(0.07), mid, 0.08).bump(0.006, 14, 'ridges'),
    ...S.mirrorX([
      wat(S.ellipsoid(0.19, 0.13, 0.11).rot(0, 0, 10).at(0.16, 1.17, 0.17).blend(0.04), lite, 0.1),          // chest plates of paler water
      wat(S.sphere(0.17).at(0.37, 1.24, 0).blend(0.06), lite, 0.08),
      wat(S.capsule([0.1, 1.3, -0.03], [0.34, 1.3, -0.02], 0.1, 0.11).blend(0.05), lite),
    ]),
    wat(S.capsule([0, 1.28, -0.02], [0, 1.4, 0.0], 0.13, 0.11).blend(0.05), lite),
    wat(S.capsule([0, 0.95, 0.2], [0, 1.1, 0.27], 0.02).paint(0.03, -0.012), mid),
    wat(S.capsule([0, 0.96, -0.2], [0, 1.3, -0.25], 0.03).paint(0.04, -0.016), mid),
    fm(S.torus(0.335, 0.045).at(0, 0.925, 0).blend(0.02)),                                                 // where the spout breaks into the body
  ];
  for (let i = 0; i < 3; i++) torso.push(...S.mirrorX([wat(S.capsule([0.05, 1.04 - i * 0.045, 0.24], [0.26, 1.0 - i * 0.03, 0.13], 0.02, 0.016).paint(0.02, 0.008), pale, 0.1)]));
  const torsoHard = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2 + rnd(i, 21); torsoHard.push(drop(0.012 + rnd(i, 22) * 0.012, Math.sin(a) * (0.4 + rnd(i, 23) * 0.08), 0.93 + rnd(i, 24) * 0.1, Math.cos(a) * (0.36 + rnd(i, 23) * 0.08), i % 2)); }

  // ---- head: a hollow-eyed swell, a wave curling over it, foam where it breaks ----
  const HD = [0, 1.38, 0];
  const head = [
    wat(S.ellipsoid(0.15, 0.17, 0.16).at(0, 1.5, 0.01), lite, 0.08),
    wat(S.ellipsoid(0.11, 0.09, 0.1).at(0, 1.41, 0.07).blend(0.04), lite, 0.08),                           // jaw
    ...S.mirrorX([wat(S.capsule([0.015, 1.535, 0.15], [0.12, 1.57, 0.1], 0.036, 0.03).blend(0.02), mid, 0.04)]),    // brows
    ...S.limb([[0, 1.5, -0.14], [0, 1.68, -0.13], [0, 1.82, -0.02], [0, 1.84, 0.14], [0, 1.74, 0.25], [0, 1.65, 0.24]], [0.13, 0.115, 0.095, 0.075, 0.055, 0.035]).map((q, i) => wat(q, i < 2 ? mid : i < 4 ? lite : pale, 0.1).blend(0.05).bump(0.006, 18, 'ridges')),
    ...S.mirrorX([...S.limb([[0.08, 1.52, -0.12], [0.16, 1.66, -0.12], [0.2, 1.74, -0.02], [0.2, 1.72, 0.09], [0.17, 1.65, 0.13]], [0.09, 0.075, 0.06, 0.045, 0.028]).map((q, i) => wat(q, i < 2 ? mid : lite, 0.1).blend(0.04))]),
    fm(S.ellipsoid(0.06, 0.05, 0.05).at(0, 1.64, 0.25).blend(0.02)), fm(S.ellipsoid(0.07, 0.045, 0.08).at(0, 1.86, 0.08).blend(0.025)),
    ...S.mirrorX([fm(S.sphere(0.04).at(0.17, 1.64, 0.14).blend(0.015)), fm(S.ellipsoid(0.04, 0.035, 0.06).at(0.2, 1.76, 0.02).blend(0.02))]),
    ...S.mirrorX([S.ellipsoid(0.042, 0.03, 0.04).rot(0, 0, 14).at(0.065, 1.51, 0.14).cut(0.012).color(abyss)]),
    S.ellipsoid(0.055, 0.045, 0.05).at(0, 1.4, 0.15).cut(0.015).color(abyss),                              // the howl
  ];
  const headHard = [
    ...H.mirrorX([H.sphere(0.024, 12).at(0.065, 1.508, 0.125).color(0xe8ffff).pbr(0.3).glow(1.8)]),
    // the far stand-in keeps a spark where the eyes are
  ];
  for (let i = 0; i < 8; i++) headHard.push(drop(0.01 + rnd(i, 31) * 0.01, (rnd(i, 32) - 0.5) * 0.4, 1.7 + rnd(i, 33) * 0.2, 0.2 + rnd(i, 34) * 0.14, i % 2));

  // ---- arms: ropes of water, thickening to fists of surf ----
  const UP = 0.4, FO = 0.4;
  const strand = (L, r0, r1, turns, c, n = 2) => { const out = []; for (let k = 0; k < n; k++) { const pts = [], rr = []; for (let i = 0; i <= 5; i++) { const y = -L * i / 5, a = (k / n) * PI * 2 + (i / 5) * turns * PI * 2, r = lerp(r0, r1, i / 5); pts.push([Math.sin(a) * r, y, Math.cos(a) * r]); rr.push(0.036); } out.push(...S.limb(pts, rr).map((q) => wat(q, c, 0.1).blend(0.03))); } return out; };
  const upper = () => [wat(S.sphere(0.15).at(0, 0, 0), lite, 0.08), wat(S.capsule([0, 0, 0], [0, -UP, 0], 0.13, 0.105).blend(0.05), lite), ...strand(UP, 0.12, 0.1, 0.6, pale), wat(S.sphere(0.115).at(0, -UP, 0).blend(0.03), mid)];
  const fore = () => [wat(S.sphere(0.11).at(0, 0, 0), mid), wat(S.capsule([0, 0, 0], [0, -FO, 0], 0.105, 0.15).blend(0.04), mid), ...strand(FO, 0.1, 0.145, 0.7, lite), fm(S.torus(0.15, 0.04).at(0, -FO + 0.02, 0).blend(0.02))];
  const fist = (sd) => {
    const p = [wat(S.ellipsoid(0.18, 0.17, 0.17).at(0, -0.13, 0), deep, 0.04), wat(S.ellipsoid(0.15, 0.1, 0.15).at(0, -0.06, 0).blend(0.05), mid)];
    for (let i = 0; i < 4; i++) { const x = (i - 1.5) * 0.085; p.push(wat(S.capsule([x, -0.2, 0.06], [x * 1.1, -0.3, 0.12], 0.055, 0.042).blend(0.03), mid), fm(S.sphere(0.034).at(x * 1.1, -0.325, 0.135).blend(0.012))); }
    p.push(wat(S.capsule([-sd * 0.14, -0.1, 0.05], [-sd * 0.19, -0.22, 0.13], 0.055, 0.04).blend(0.03), mid));
    const hard = [];
    for (let i = 0; i < 7; i++) hard.push(drop(0.012 + rnd(i, 41) * 0.014, (rnd(i, 42 + sd) - 0.5) * 0.4, -0.3 - rnd(i, 43) * 0.2, (rnd(i, 44) - 0.3) * 0.3, i % 2));
    return { prims: p, hard };
  };
  const fiL = fist(1), fiR = fist(-1);
  const nodes = [
    ROOT, ...segs,
    { name: 'torso', parent: 'root', rig: 'torso', pos: [0, TO[1] + LIFT, 0], prims: into(TO, torso), hard: into(TO, torsoHard), detail: 0.62 },
    { name: 'head', parent: 'torso', rig: 'head', pos: sub(HD, TO), prims: into(HD, head), hard: into(HD, headHard), detail: 0.9 },
  ];
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R', f = sd > 0 ? fiL : fiR;
    nodes.push(
      { name: `arm${n}`, parent: 'torso', rig: 'arms', pos: sub([sd * 0.4, 1.25, 0], TO), rot: [-20, 0, sd * 62], prims: upper(), hard: [H.geo(coreGeo(0.1, 0.085, UP)).rot(90, 0, 0).color(lite).pbr(0.2)], detail: 0.6 },
      { name: `fore${n}`, parent: `arm${n}`, rig: 'forearms', pos: [0, -UP, 0], rot: [-64, 0, sd * 18], prims: fore(), hard: [H.geo(coreGeo(0.09, 0.12, FO)).rot(90, 0, 0).color(mid).pbr(0.2)], detail: 0.6 },
      { name: `fist${n}`, parent: `fore${n}`, rig: 'hands', pos: [0, -FO, 0], rot: [-20, 0, 0], prims: f.prims, hard: f.hard, detail: 0.62 },
    );
  }
  nodes.push(
    { name: 'foam0', parent: 'root', rig: 'foam', pos: [0, 0, 0], hard: [...foamRing(0.66, 20, 0.07, 3), ...foamRing(0.56, 12, 0.05, 5)] },
    { name: 'foam1', parent: 'root', rig: 'foam', pos: [0, 0, 0], hard: foamRing(0.86, 16, 0.05, 9) },
    { name: 'foam2', parent: 'root', rig: 'foam', pos: [0, 0, 0], hard: foamRing(1.05, 12, 0.035, 14) },
  );
  return { kind: 'seaElemental', nodes };
}
function animSeaElemental(model, { t, phase }) {
  const rig = model.userData.rig, w = t * 1.2 + phase;
  // now and then both fists go up and come down like a breaking sea
  const c = frac(t * 0.14 + phase * 0.19), rise = pulse(c, 0.0, 0.36), slam = pulse(c, 0.27, 0.48);
  (rig.segs || []).forEach((s, i) => { s.rotation.y = (t * (1.5 + i * 0.55) + phase) % (PI * 2); const k = 1 + Math.sin(w * 1.7 + i * 1.3) * 0.035; s.scale.set(k, 1, k); });
  R(rig.torso, Math.sin(w * 0.8) * 0.05 - rise * 0.14 + slam * 0.34, Math.sin(w * 0.5) * 0.16, Math.sin(w * 0.65 + 1) * 0.05);
  P(rig.torso, Math.sin(w * 0.9) * 0.02, Math.sin(w * 1.4) * 0.022 + rise * 0.04 - slam * 0.05, Math.cos(w * 0.9) * 0.02);
  R(rig.head, Math.sin(w * 1.1 + 1) * 0.06 - rise * 0.2 + slam * 0.22, Math.sin(w * 0.43 + 2) * 0.22, Math.sin(w * 0.7) * 0.04);
  const A = rig.arms || [], F = rig.forearms || [], Hn = rig.hands || [];
  for (let i = 0; i < A.length; i++) {
    const sg = i ? -1 : 1, o = i * 2.2;
    R(A[i], Math.sin(w * 0.9 + o) * 0.1 - rise * 1.25 + slam * 1.0, 0, sg * (Math.sin(w * 0.7 + o) * 0.1 + rise * 0.25 - slam * 0.2));
    R(F[i], Math.sin(w * 1.3 + o + 1) * 0.16 - rise * 0.2 + slam * 0.7, 0, sg * Math.sin(w * 1.1 + o) * 0.08);
    R(Hn[i], Math.sin(w * 1.6 + o + 2) * 0.14 + slam * 0.3, Math.sin(w * 0.8 + o) * 0.2, 0);
  }
  (rig.foam || []).forEach((f, i) => { const k = 1 + Math.sin(t * (1.9 - i * 0.4) + phase + i * 2) * 0.07 + slam * 0.12 * (i + 1); f.scale.set(k, 1, k); f.rotation.y = (t * (0.55 - i * 0.14) + i) % (PI * 2); });
}

// =====================================================================================
// SEA DRAGON: wingless, barrel-bodied, a great sail down its back, the neck reared and the tail humping astern
// =====================================================================================
const DRG = { Ls: [0.17, 0.17, 0.18, 0.19, 0.2, 0.21, 0.22, 0.22, 0.22, 0.22, 0.22, 0.22, 0.21, 0.2, 0.2, 0.2], base: null, lay: null };
DRG.n = DRG.Ls.length; DRG.len = DRG.Ls.reduce((a, b) => a + b, 0);
function drgCurve(p, t, phase, o) {
  if (!DRG.base) DRG.base = pathTable(0.8, 1.1, DRG.len + 0.4, (q) => -0.1 + 1.5 * smooth((q - 0.08) / 0.26) - 1.4 * smooth((q - 1.1) / 0.36)
    + 0.55 * smooth((q - 1.95) / 0.2) - 1.6 * smooth((q - 2.15) / 0.3) + 2.0 * smooth((q - 2.47) / 0.34) - 1.6 * smooth((q - 2.9) / 0.3));
  pathAt(DRG.base, p, o);
  const neck = 1 - smooth(p / 1.3), tail = smooth((p - 2.0) / 0.5), w = t * 1.1 + phase;
  // the neck weaves and reaches; the tail sculls and its hump rolls astern
  o[0] = Math.sin(w * 0.6) * 0.1 * neck + Math.sin(p * 2.2 - w * 1.5) * 0.13 * tail;
  o[1] = o[1] * (1 + Math.sin(w * 0.9) * 0.04 * neck) + tail * Math.sin(p * 3.4 - w * 1.9) * 0.07;
  o[2] += Math.sin(w * 0.9 + 1) * 0.05 * neck;
}
function seaDragonDesc(def) {
  const base = def.color ?? 0x2f7a8a, skin = tone(base, 0, 0.03, 0.02), back = tone(base, 0.03, 0.05, -0.1), belly = 0xe2d6a4, bellyDk = 0xb9a66c;
  const web = tone(base, 0.52, 0.12, 0.08), webIn = tone(base, 0.04, 0.04, -0.12), bone = 0xe9dfc4, boneDk = 0x4a3d30, mouth = 0x9a2f3a, tooth = 0xf4efdc, wet = 0.38;
  const sk = (p, part) => (part === 'bottom'
    ? p.color(belly).pbr(wet + 0.05).bump(0.007, 12, 'ridges').tint(0.08, 30)
    : p.color(part === 'top' ? back : skin).pbr(wet).bump(0.0075, 26, 'scales').tint(0.16, 9));
  const TAB = [
    { z: 0.03, w: 0.088, h: 0.094, y: 0 }, { z: -0.4, w: 0.098, h: 0.106, y: 0 }, { z: -0.95, w: 0.13, h: 0.14, y: 0 }, { z: -1.28, w: 0.2, h: 0.2, y: 0 }, { z: -1.55, w: 0.265, h: 0.25, y: 0 },
    { z: -1.9, w: 0.26, h: 0.245, y: 0 }, { z: -2.2, w: 0.19, h: 0.19, y: 0 }, { z: -2.55, w: 0.125, h: 0.135, y: 0 }, { z: -2.9, w: 0.07, h: 0.08, y: 0 }, { z: -3.12, w: 0.036, h: 0.042, y: 0 }, { z: -DRG.len, w: 0.016, h: 0.02, y: 0 },
  ];
  const at = (z) => station(TAB, z);
  DRG.lay = DRG.lay || newLay(DRG.n);
  const lay = layChain((p, o) => drgCurve(p, 0, 0, o), DRG.Ls, DRG.lay);
  const SAIL = [0.05, 0.085, 0.1, 0.105, 0.11, 0.15, 0.25, 0.36, 0.43, 0.4, 0.3, 0.19, 0.11, 0.07, 0, 0];

  const segs = [], extra = [];
  let z0 = 0;
  for (let i = 0; i < DRG.n; i++) {
    const L = DRG.Ls[i], z1 = z0 - L, o = [0, 0, z0], zm = (z0 + z1) / 2, mid = at(zm);
    const p = [...hull(span(TAB, z0, z1), sk)];
    p.push(S.ellipsoid(mid.w * 0.85, 0.06, L * 0.24).at(0, mid.h * 0.98, zm).color(mix(back, 0x0c2026, 0.4)).paint(0.04, 0));        // dark saddles
    for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) p.push(S.sphere(0.01 + rnd(i * 9 + k, 3) * 0.012).at(sd * mid.w * 0.98, (rnd(i * 9 + k, sd + 5) - 0.55) * mid.h * 0.9, lerp(z0, z1, rnd(i * 9 + k, sd + 8))).color(mix(skin, belly, 0.55)).paint(0.008, 0));
    const hard = [];
    const sh = SAIL[i];
    if (sh > 0) {
      const sp = [{ a: -56, len: sh * 0.7 }, { a: -30, len: sh * 0.9 }, { a: -6, len: sh }, { a: 18, len: sh * 1.05 }, { a: 42, len: sh * 0.98 }, { a: 64, len: sh * 0.8 }];
      hard.push(place(fan(sp, webIn, web, boneDk, { dip: 0.24, spineR: 0.006 + sh * 0.014, rays: 3.1 }), 0, 0, 0, 0, mid.h - 0.02, zm + L * 0.08));
      p.push(sk(S.capsule([0, mid.h - 0.012, z0 - L * 0.2], [0, mid.h - 0.012, z1 + L * 0.2], 0.022 + sh * 0.03, 0.022 + sh * 0.03).blend(0.03), 'top'));
    }
    if (i >= 7 && i <= 10) for (const sd of [-1, 1]) for (let k = 0; k < 2; k++) hard.push(spike(0.07, 0.022, 0.4, 5, 0.6).rot(-50, 0, sd * -62).at(sd * mid.w * 0.83, mid.h * 0.55, zm + (k - 0.5) * L * 0.5).color(bone).pbr(0.4).shade((x, y) => (y < 0.35 ? back : null)).lod(1));   // flank studs
    if (i === 11) for (const sd of [-1, 1]) hard.push(place(fan([{ a: 20, len: 0.12 }, { a: 44, len: 0.2 }, { a: 66, len: 0.23 }, { a: 90, len: 0.19 }, { a: 112, len: 0.11 }], webIn, web, boneDk, { dip: 0.25, cup: 0.05 * sd }), 0, 0, sd * -100, sd * (mid.w - 0.02), -0.04, zm + 0.05));   // hind fins
    if (i >= DRG.n - 2) {
      const k = i === DRG.n - 1 ? 1 : 0.6;
      hard.push(place(fan([{ a: 30, len: 0.1 * k }, { a: 52, len: 0.21 * k }, { a: 70, len: 0.29 * k }, { a: 86, len: 0.33 * k }, { a: 98, len: 0.33 * k }, { a: 114, len: 0.28 * k }, { a: 132, len: 0.2 * k }, { a: 152, len: 0.1 * k }], webIn, web, boneDk, { dip: 0.2, spineR: 0.007 }), 0, 0, 0, 0, 0, z0 - L * 0.15));
    }
    hard.push(H.geo(coreGeo(at(z0).w, at(z1).w, L, 0.7)).rot(0, 180, 0).at(0, 0, z0).color(skin).pbr(wet));
    segs.push({ name: `seg${i}`, parent: i ? `seg${i - 1}` : 'root', rig: 'segs', pos: i ? [0, 0, -DRG.Ls[i - 1]] : lay.pos.slice(), rot: eulerDeg(lay.quats[i]), prims: into(o, p), hard: into(o, hard), detail: i >= 6 && i <= 11 ? 0.62 : 0.85 });
    if (i === 7) {
      // fore-flippers: a thick arm, four long fingers, webbed to the tips
      for (const sd of [1, -1]) {
        const arm = [sk(S.sphere(0.085).at(0, 0, 0)), sk(S.capsule([0, 0, 0], [0, -0.26, 0], 0.08, 0.055).blend(0.03)), sk(S.sphere(0.058).at(0, -0.26, 0).blend(0.02))];
        const fh = [H.geo(coreGeo(0.065, 0.045, 0.26)).rot(90, 0, 0).color(skin).pbr(wet)];
        const f = fan([{ a: -32, len: 0.3 }, { a: -8, len: 0.44 }, { a: 14, len: 0.5 }, { a: 36, len: 0.46 }, { a: 58, len: 0.34 }, { a: 78, len: 0.2 }], webIn, web, boneDk, { dip: 0.2, spineR: 0.012, cup: 0.05 * sd, tipCol: bone });
        fh.push(place(f, 180, 0, 0, 0, -0.22, 0));
        extra.push({ name: `fin${sd > 0 ? 'L' : 'R'}`, parent: 'seg7', rig: 'fins', pos: [sd * (mid.w - 0.03), -0.02, (z0 + z1) / 2 - z0 + 0.04], rot: [-30, 0, sd * 78], prims: arm, hard: fh, detail: 0.8 });
      }
    }
    z0 = z1;
  }

  // ---- head: long, heavy-jawed, a boss on the snout, swept horns, finned cheeks ----
  const HT = [
    { z: 0.56, w: 0.022, h: 0.02, y: -0.02 }, { z: 0.53, w: 0.046, h: 0.038, y: -0.018 }, { z: 0.44, w: 0.068, h: 0.055, y: -0.012 }, { z: 0.32, w: 0.09, h: 0.074, y: -0.006 },
    { z: 0.19, w: 0.116, h: 0.1, y: 0 }, { z: 0.07, w: 0.126, h: 0.112, y: 0.004 }, { z: -0.05, w: 0.096, h: 0.1, y: 0 },
  ];
  const mY = (z) => lerp(-0.038, -0.03, (z - 0.07) / 0.5);
  const skull = [
    ...hull(HT, sk),
    ...S.mirrorX([
      sk(S.ellipsoid(0.04, 0.058, 0.09).at(0.104, -0.008, 0.08).blend(0.045)),                             // jaw muscle
      sk(S.capsule([0.036, 0.08, 0.37], [0.082, 0.108, 0.15], 0.024, 0.04).blend(0.035), 'top'),          // brow ridge
      sk(S.ellipsoid(0.026, 0.02, 0.036).at(0.036, 0.04, 0.5).blend(0.02)),                                // nostril mound
    ]),
    sk(S.capsule([0, 0.07, 0.45], [0, 0.108, 0.12], 0.026, 0.044).blend(0.04), 'top'),
    sk(S.ellipsoid(0.05, 0.036, 0.06).at(0, 0.06, 0.45).blend(0.03), 'top'),                               // boss on the snout
    sk(S.ellipsoid(0.028, 0.026, 0.036).at(0, -0.036, 0.54).blend(0.02)),
  ];
  const head = [...skull, under(0.62, -0.056, -0.07, -0.062, belly, 0.02, wet)];
  head.push(
    slab(0.7, mY(0.7), 0.075, mY(0.075), -1, 0, 0.5).cut(0.007).color(mouth),
    S.ellipsoid(0.046, 0.028, 0.19).at(0, -0.03, 0.31).cut(0.02).color(tone(mouth, 0, 0, -0.08)),
    S.sphere(0.064).at(0, -0.038, 0.08).color(0x40141c).paint(0.04, 0),
  );
  const eyeP = surf(skull, [0.4, 0.046, 0.262], [-1, 0, 0]);
  head.push(...S.mirrorX([
    S.sphere(0.027).at(eyeP[0] - 0.006, eyeP[1], eyeP[2]).cut(0.008).color(0x101814),
    S.sphere(0.011).at(0.044, 0.044, 0.525).color(0x0c1010).paint(0.005, -0.007),
  ]));
  const hornAt = (x, y, z, pts, r0, r1) => horn(pts.map((q) => [x + q[0], y + q[1], z + q[2]]), r0, r1, bone, boneDk);
  const headHard = [
    ...H.mirrorX([
      eye(0.024, { iris: 0xff9a1e, rim: 0x8a2a10, white: 0xffb428, shape: 'slit', pupilDeg: 13, irisDeg: 60, rough: 0.1, glow: 0.45 }).rot(-6, 62, 0).at(eyeP[0] - 0.015, eyeP[1], eyeP[2]).near(),
      hornAt(0.078, 0.11, 0.14, [[0, 0, 0], [0.03, 0.03, -0.1], [0.06, 0.05, -0.22], [0.075, 0.1, -0.34], [0.07, 0.18, -0.42]], 0.036, 0.007),      // great horns, swept back
      hornAt(0.045, 0.12, 0.06, [[0, 0, 0], [0.01, 0.05, -0.07], [0.016, 0.12, -0.13], [0.012, 0.2, -0.16]], 0.022, 0.005).near(),
      hornAt(0.115, 0.03, 0.03, [[0, 0, 0], [0.04, 0.008, -0.06], [0.07, 0.02, -0.14], [0.08, 0.05, -0.2]], 0.02, 0.005).near(),
      spike(0.04, 0.01, 0.3, 5).rot(-25, 0, -20).at(0.05, 0.088, 0.37).color(bone).pbr(0.4).lod(1),
      spike(0.036, 0.009, 0.3, 5).rot(-25, 0, -20).at(0.04, 0.076, 0.44).color(bone).pbr(0.4).lod(1),
    ]),
    spike(0.085, 0.022, 0.4, 6).rot(-24, 0, 0).at(0, 0.085, 0.46).color(bone).pbr(0.4).shade((x, y) => (y < 0.3 ? boneDk : null)),                  // nose horn
  ];
  const fang = (hard, x, z, len, up, r = 0.0078) => hard.push(spike(len, r, 0.3, 5).rot(up > 0 ? 180 : 0, 0, 0).rot(up > 0 ? -6 : 6, 0, 0).at(x, mY(z) + up * 0.006, z).color(tooth).pbr(0.2).lod(len > 0.045 ? 2 : 1));
  const lipX = (z, dy) => surf(skull, [0.4, mY(z) + dy, z], [-1, 0, 0])[0] - 0.01;
  for (let i = 0; i < 11; i++) for (const sd of [-1, 1]) { const big = i === 9 || i === 5; fang(headHard, sd * lipX(0.14 + i * 0.036, 0.014), 0.14 + i * 0.036, 0.026 + rnd(i, 3) * 0.01 + (big ? 0.04 : 0), 1, big ? 0.012 : 0.0078); }

  const J = [0, mY(0.075), 0.075];
  const jaw = [
    ...hull(span(HT.map((q) => ({ ...q, w: q.w * 0.96 })), 0.53, 0.0), sk),
    sk(S.ellipsoid(0.055, 0.03, 0.13).at(0, -0.08, 0.24).blend(0.04), 'bottom'),
    under(0.62, -0.05, -0.07, -0.058, belly, 0.02, wet),
    slab(0.7, mY(0.7), -0.03, mY(-0.03), 1, 0, 0.5).cut(0.007).color(mouth),
    S.box(0.5, 0.5, 0.2, 0.01).at(0, 0, -0.07).cut(0.012).color(mouth),
    S.ellipsoid(0.046, 0.01, 0.17).at(0, -0.044, 0.31).cut(0.015).color(tone(mouth, 0, 0, -0.06)),
    S.capsule([0, -0.05, 0.12], [0, -0.045, 0.34], 0.022, 0.012).color(0xc9566a).pbr(0.3).blend(0.012),
    S.sphere(0.064).at(0, -0.038, 0.08).color(0x40141c).paint(0.04, 0),
  ];
  const jawHard = [];
  for (let i = 0; i < 10; i++) for (const sd of [-1, 1]) { const big = i === 8; fang(jawHard, sd * (lipX(0.13 + i * 0.036, -0.014) - 0.005), 0.13 + i * 0.036, 0.024 + rnd(i, 7) * 0.01 + (big ? 0.036 : 0), -1, big ? 0.011 : 0.0074); }
  jawHard.push(
    ...H.mirrorX([spike(0.05, 0.011, 0.2, 5).rot(150, 0, 12).at(0.05, -0.09, 0.2).color(bone).pbr(0.4).lod(1), spike(0.04, 0.01, 0.2, 5).rot(150, 0, 12).at(0.06, -0.092, 0.12).color(bone).pbr(0.4).lod(1)]),
    spike(0.06, 0.014, 0.3, 5).rot(160, 0, 0).at(0, -0.1, 0.37).color(bone).pbr(0.4).near(),
    H.tube([[0, -0.044, 0.3], [0, -0.04, 0.42], [0, -0.03, 0.53]], [0.011, 0.008, 0.005], 8, 6).color(0xc9566a).pbr(0.3).lod(1),
  );
  // cheek fins: webbed fans behind the jaw
  const frill = (sd) => fan([{ a: -20, len: 0.12 }, { a: 12, len: 0.22 }, { a: 44, len: 0.29 }, { a: 76, len: 0.28 }, { a: 108, len: 0.22 }, { a: 140, len: 0.13 }], webIn, web, boneDk, { dip: 0.24, cup: -0.07 * sd, spineR: 0.008 });
  // steam: a curl of vapour at the nostrils, puffed by the animator
  const mp = (q) => q.color(MIST).pbr(1).glow(0.25);
  const steamHard = [H.sphere(0.012, 6).at(0, -0.02, -0.03).color(skin)];
  const sm = mistPiece([
    mp(S.capsule([0.04, 0, 0], [0.07, 0.07, 0.06], 0.02, 0.034)).bump(0.014, 30), mp(S.capsule([-0.04, 0, 0], [-0.075, 0.075, 0.05], 0.02, 0.034)).bump(0.014, 30),
    mp(S.capsule([0.07, 0.07, 0.06], [0.03, 0.17, 0.03], 0.034, 0.05)).bump(0.02, 24).blend(0.03), mp(S.capsule([-0.075, 0.075, 0.05], [-0.02, 0.18, 0.0], 0.034, 0.05)).bump(0.02, 24).blend(0.03),
    mp(S.ellipsoid(0.06, 0.05, 0.055).at(0.01, 0.26, -0.04)).bump(0.022, 22).blend(0.04), mp(S.sphere(0.03).at(0.07, 0.32, -0.08)).bump(0.012, 30), mp(S.sphere(0.024).at(-0.06, 0.34, -0.1)).bump(0.012, 30),
  ], 0x9fbccc, 0xffffff, 0.34);
  if (sm) steamHard.push(sm.lod(1));

  return { kind: 'seaDragon', nodes: [
    ROOT, ...segs, ...extra,
    { name: 'head', parent: 'seg0', rig: 'head', pos: [0, 0, 0], rot: [16, 0, 0], prims: head, hard: headHard, detail: 1.3 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: J, rot: [16, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 1.3 },
    { name: 'frillL', parent: 'head', rig: 'frills', pos: [0.105, 0.0, 0.04], rot: [0, -38, -14], hard: frill(1) },
    { name: 'frillR', parent: 'head', rig: 'frills', pos: [-0.105, 0.0, 0.04], rot: [0, 38, 14], hard: frill(-1) },
    { name: 'steam', parent: 'head', rig: 'core', pos: [0, 0.05, 0.5], rot: [-16, 0, 0], hard: steamHard },
    { name: 'foam0', parent: 'root', rig: 'foam', pos: [0, 0, 0.33], hard: foamRing(0.2, 9, 0.045, 3, 1.3) },
    { name: 'foam1', parent: 'root', rig: 'foam', pos: [0, 0, -0.35], hard: foamRing(0.36, 14, 0.045, 7, 1.7) },
  ] };
}
function animSeaDragon(model, { t, phase }) {
  const rig = model.userData.rig, w = t * 1.1 + phase;
  poseChain(rig.segs, layChain((p, o) => drgCurve(p, t, phase, o), DRG.Ls, DRG.lay || (DRG.lay = newLay(DRG.n))));
  // it rears its head back, gapes, and snaps forward with a blast of steam
  const c = frac(t * 0.15 + phase * 0.21), roar = pulse(c, 0.0, 0.36), snap = pulse(c, 0.26, 0.42);
  R(rig.head, -roar * 0.36 + snap * 0.3 + Math.sin(w * 1.2) * 0.05, Math.sin(w * 0.7 + phase) * 0.18 * (1 - roar), 0);
  R(rig.jaw, 0.02 + Math.max(0, Math.sin(w * 1.5)) * 0.07 + roar * 0.6 - snap * 0.35);
  const fl = roar * 0.55 + Math.sin(w * 2.2) * 0.07;
  if (rig.frills) { R(rig.frills[0], 0, -fl, 0); R(rig.frills[1], 0, fl, 0); }
  (rig.fins || []).forEach((f, i) => { const sg = i ? -1 : 1, a = w * 1.3 + i * 0.6; R(f, Math.sin(a) * 0.3, 0, sg * (Math.sin(a + 1.1) * 0.22 + roar * 0.2)); });
  if (rig.core) {
    const puff = Math.max(pulse(c, 0.3, 0.62), pulse(frac(t * 0.37 + phase * 0.3), 0, 0.5) * 0.55);
    rig.core.visible = puff > 0.03;
    rig.core.scale.set(0.3 + puff * 0.4, Math.max(0.05, 0.25 + puff * 0.6), 0.3 + puff * 0.4);
  }
  (rig.foam || []).forEach((f, i) => { const k = 1 + Math.sin(t * 1.6 + phase + i * 2) * 0.08; f.scale.set(k, 1, k); });
}

// =====================================================================================
// MEGALODON: the old giant shark, barrel-chested and blunt, hide a map of old wounds, jaws like a portcullis
// =====================================================================================
function megalodonDesc(def) {
  const top = def.color ?? 0x56646e, back = tone(top, 0.01, 0.04, -0.1), belly = 0xdcd8cc, mouth = 0x8a2a34, gum = 0xc28088;
  const fin = tone(top, 0, 0, -0.08), tooth = 0xf0ead8, scar = mix(top, 0xe2cfc8, 0.62), blotch = mix(back, 0x14181c, 0.45), wet = 0.38;
  const sk = (p, part) => p.color(part === 'top' ? back : top).pbr(wet).tint(0.14, 7).bump(0.0035, 30);
  const TAB = [
    { z: 1.1, w: 0.035, h: 0.032, y: 0.0 }, { z: 1.0, w: 0.125, h: 0.105, y: -0.004 }, { z: 0.85, w: 0.205, h: 0.185, y: -0.014 }, { z: 0.62, w: 0.275, h: 0.265, y: -0.03 },
    { z: 0.35, w: 0.312, h: 0.315, y: -0.045 }, { z: 0.08, w: 0.318, h: 0.325, y: -0.05 }, { z: -0.16, w: 0.28, h: 0.288, y: -0.04 }, { z: -0.42, w: 0.2, h: 0.212, y: -0.025 },
    { z: -0.64, w: 0.132, h: 0.146, y: -0.012 }, { z: -0.83, w: 0.082, h: 0.092, y: -0.004 }, { z: -0.96, w: 0.052, h: 0.058, y: 0 }, { z: -1.0, w: 0.046, h: 0.05, y: 0 },
  ];
  const at = (z) => station(TAB, z);
  const skin = (z, th, lift = 0) => { const q = at(z), a = th * DEG, nx = Math.sin(a) / q.w, ny = Math.cos(a) / q.h, nl = Math.hypot(nx, ny); return { p: [Math.sin(a) * (q.w + lift), q.y + Math.cos(a) * (q.h + lift), z], n: [nx / nl, ny / nl, 0] }; };
  const bellyLine = (z) => { const s = at(z); return s.y - s.h * (z > 0.62 ? lerp(0.36, 0.1, (z - 0.62) / 0.48) : 0.36); };
  const O = [0, -0.05, 0.22];

  const body = [
    ...hull(span(TAB, 1.1, -0.3), sk),
    ...S.mirrorX([
      sk(S.ellipsoid(0.07, 0.17, 0.26).at(0.235, -0.04, 0.5).blend(0.08)),                                  // gill bulge
      sk(S.ellipsoid(0.05, 0.036, 0.09).at(0.15, 0.1, 0.84).blend(0.04), 'top'),                           // heavy brow
      sk(S.ellipsoid(0.09, 0.05, 0.14).at(0.26, -0.19, 0.42).blend(0.05)),                                  // pectoral root
      sk(S.ellipsoid(0.07, 0.07, 0.12).at(0.17, -0.02, 0.72).blend(0.05)),                                  // jaw muscle
    ]),
    sk(S.capsule([0, 0.27, 0.34], [0, 0.265, -0.04], 0.045, 0.03).blend(0.06), 'top'),                    // dorsal root
    sk(S.ellipsoid(0.1, 0.06, 0.1).at(0, 0.05, 1.0).blend(0.05)),                                          // blunt snout
  ];
  const outer = body.slice();
  body.push(under(1.15, bellyLine(1.1), 0.62, bellyLine(0.62), belly, 0.025), under(0.62, bellyLine(0.62), -0.4, bellyLine(-0.4), belly, 0.04));
  for (let i = 0; i < 8; i++) body.push(...S.mirrorX([S.ellipsoid(0.14, 0.04, 0.08).at(0.3, bellyLine(0.56 - i * 0.11) + 0.016, 0.56 - i * 0.11 + rnd(i, 3) * 0.04).color(belly).pbr(wet).paint(0.025, 0)]));
  // dark blotches over the back
  for (let i = 0; i < 26; i++) { const z = 0.95 - rnd(i, 11) * 1.2, q = skin(z, (rnd(i, 12) - 0.5) * 150); body.push(S.sphere(0.022 + rnd(i, 13) * 0.034).at(q.p[0], q.p[1], q.p[2]).color(blotch).paint(0.02, 0)); }
  // the mouth: the lower jaw is a plug cut out of the underside of the head
  const MC = [0, -0.14, 0.8];
  body.push(S.ellipsoid(0.186, 0.105, 0.25).at(MC[0], MC[1], MC[2]).cut(0.008).color(mouth), S.ellipsoid(0.13, 0.06, 0.17).at(0, -0.06, 0.8).cut(0.02).color(tone(mouth, 0, 0, -0.1)),
    S.sphere(0.13).at(0, -0.1, 0.6).color(0x2a080e).paint(0.08, 0));
  const eyeP = surf(outer, [0.5, 0.045, 0.86], [-1, 0, 0]);
  body.push(...S.mirrorX([S.sphere(0.03).at(eyeP[0] - 0.006, eyeP[1], eyeP[2]).cut(0.008).color(0x1c2228)]));
  for (let i = 0; i < 5; i++) body.push(...S.mirrorX([S.box(0.3, 0.2 - i * 0.015, 0.016, 0.005).rot(-10, 0, 0).at(0.28, -0.01, 0.62 - i * 0.055).color(tone(top, 0, 0.02, -0.26)).paint(0.005, -0.012)]));
  body.push(...S.mirrorX([
    S.sphere(0.016).at(0.085, -0.02, 1.04).color(0x15171a).paint(0.005, -0.006),
    S.capsule([0.3, -0.02, 0.36], [0.24, -0.02, -0.3], 0.005).color(tone(top, 0, 0, -0.08)).paint(0.005, -0.002),
  ]));
  // a lifetime of scars: rakes down the flanks, a crescent bite, pocks round the snout
  for (const [z, th, len, ang, w] of [[0.3, -62, 0.34, 18, 0.014], [0.26, -70, 0.42, 15, 0.018], [0.22, -79, 0.3, 13, 0.013], [-0.05, 58, 0.26, -30, 0.014], [-0.1, 66, 0.2, -28, 0.012], [0.55, 40, 0.2, 40, 0.012], [0.74, -30, 0.16, -50, 0.012], [0.0, -30, 0.3, 8, 0.012], [0.45, 76, 0.24, 22, 0.014]]) {
    const q = skin(z, th);
    body.push(S.ellipsoid(w, 0.12, len / 2).rot(ang, 0, -th).at(q.p[0], q.p[1], q.p[2]).color(scar).pbr(0.6).paint(0.006, -0.007));
  }
  for (let i = 0; i < 7; i++) { const a = (-60 + i * 20) * DEG, q = skin(0.12 + Math.cos(a) * 0.13, 52 + Math.sin(a) * 16); body.push(S.sphere(0.018).at(q.p[0], q.p[1], q.p[2]).color(scar).pbr(0.6).paint(0.008, -0.006)); }
  for (let i = 0; i < 9; i++) { const q = surf(outer, [(rnd(i, 21) - 0.5) * 0.3, 0.5, 0.86 + rnd(i, 22) * 0.2], [0, -1, 0]); body.push(S.sphere(0.008 + rnd(i, 23) * 0.008).at(q[0], q[1], q[2]).color(0x1a1e22).paint(0.004, -0.004)); }
  const DS = 0.56;
  const bodyHard = [
    ...H.mirrorX([eye(0.024, { iris: 0x0a0c10, rim: 0x5a1a1c, white: 0x12161c, pupilDeg: 30, irisDeg: 50, rough: 0.05 }).rot(0, 80, 0).at(eyeP[0] - 0.022, eyeP[1], eyeP[2])]),
    // the great dorsal: tall, notched by old bites, a tatter out of its tip
    blade({ span: DS, chord: 0.5, tip: 0.2, sweep: 0.5, thick: 0.11, falcate: 0.45, rows: 13, notch: [0.5, 0.2, 0.07] }).shade((x, y, z) => (noise3(y * 60, z * 16, 3) > 0.8 && y > 0.1 ? mix(fin, scar, 0.5) : mix(fin, back, clamp(y / DS, 0, 1) * 0.6))).pbr(wet).at(0, 0.265, 0.16),
    ...H.mirrorX([blade({ span: 0.6, chord: 0.34, tip: 0.24, sweep: 0.5, thick: 0.1, falcate: 0.35, rows: 11, notch: [0.7, 0.1, 0.05] }).shade((x, y) => (x > 0 ? belly : mix(fin, 0x24282e, clamp(y / 0.6, 0, 1) * 0.5))).pbr(wet).rot(0, 0, -110).rot(-8, -10, 0).at(0.25, -0.19, 0.44)]),
  ];
  // upper teeth: three ranks of broad serrated triangles
  for (let row = 0; row < 3; row++) for (let i = 0; i < 15 - row * 2; i++) {
    const a = (-82 + (i + row * 0.5) * (164 / (14 - row * 2))) * DEG, k = 0.9 - row * 0.13, len = (0.075 - row * 0.016) * (0.75 + rnd(i, row + 3) * 0.4) * (rnd(i, row + 30) > 0.9 ? 0.4 : 1);
    bodyHard.push(spike(len, 0.024 - row * 0.003, 0, 4, 0.42).rot(180, 0, 0).rot(0, a / DEG - 90, 0).at(Math.sin(a) * 0.186 * k, MC[1] + 0.045 + row * 0.01, MC[2] + Math.cos(a) * 0.25 * k).color(tooth).pbr(0.25).lod(row ? 0 : 2));
  }
  for (const [z, th, r] of [[0.18, 14, 0.026], [0.13, 22, 0.018], [0.2, 26, 0.014], [0.1, 10, 0.014], [0.7, -26, 0.02], [0.66, -34, 0.014], [-0.14, -16, 0.02], [-0.19, -24, 0.014]]) { const q = skin(z, th, 0.003); bodyHard.push(barnacle(r, [q.p[0] - q.n[0] * r * 0.15, q.p[1] - q.n[1] * r * 0.15, z], q.n).lod(r > 0.018 ? 2 : 1)); }
  { const q = skin(0.0, -22); bodyHard.push(harpoon(q.p, [-0.3, 0.8, -0.5], 0.14, [-0.06, -0.12, -0.16], 1.5)); }
  { const q = skin(0.4, 30); bodyHard.push(harpoon(q.p, [0.4, 0.7, -0.6], 0.11, [0.08, -0.12, -0.12], 1.4)); }

  // ---- lower jaw ----
  const J = [0, -0.17, 0.58];
  const jaw = [
    S.ellipsoid(0.18, 0.098, 0.245).at(MC[0], MC[1], MC[2]).color(belly).pbr(wet + 0.04),
    S.box(0.6, 0.3, 0.8, 0.01).rot(-4, 0, 0).at(0, MC[1] + 0.155, 0.82).cut(0.008).color(mouth),
    S.ellipsoid(0.125, 0.03, 0.18).at(0, MC[1], 0.8).cut(0.016).color(tone(mouth, 0, 0, -0.08)),
    S.ellipsoid(0.075, 0.02, 0.12).at(0, MC[1] - 0.022, 0.75).color(gum).pbr(0.3).blend(0.014),
  ];
  const jawHard = [];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 13 - row * 2; i++) {
    const a = (-78 + (i + row * 0.5) * (156 / (12 - row * 2))) * DEG, k = 0.84 - row * 0.13, z = MC[2] + Math.cos(a) * 0.245 * k, len = (0.066 - row * 0.014) * (0.75 + rnd(i, row + 13) * 0.4);
    jawHard.push(spike(len, 0.022 - row * 0.003, 0, 4, 0.42).rot(0, a / DEG - 90, 0).at(Math.sin(a) * 0.18 * k, MC[1] - 0.012 - (z - 0.8) * 0.07, z).color(tooth).pbr(0.25).lod(row ? 0 : 2));
  }

  // ---- tail ----
  const TZ = [-0.3, -0.53, -0.73, -0.9, -1.0], tail = [];
  for (let i = 0; i < 4; i++) {
    const jz = TZ[i], jy = at(jz).y, r0 = at(jz).h;
    const p = [...hull(span(TAB, TZ[i], TZ[i + 1]), sk), under(TZ[i] + 0.09, bellyLine(TZ[i] + 0.09), TZ[i + 1] - 0.09, bellyLine(TZ[i + 1] - 0.09), belly, 0.03)];
    const hard = [];
    if (i === 0) {
      hard.push(...H.mirrorX([blade({ span: 0.17, chord: 0.18, tip: 0.3, sweep: 0.8, thick: 0.1 }).color(mix(belly, top, 0.45)).pbr(wet).rot(0, 0, -118).rot(-32, 0, 0).at(0.11, jy - r0 * 0.72, jz - 0.1)]));
      const q = skin(-0.4, 50); p.push(S.ellipsoid(0.014, 0.12, 0.12).rot(-20, 0, -50).at(q.p[0], q.p[1], q.p[2]).color(scar).pbr(0.6).paint(0.007, -0.006));
    }
    if (i === 1) hard.push(
      blade({ span: 0.14, chord: 0.15, tip: 0.3, sweep: 0.75, thick: 0.1, falcate: 0.3 }).color(fin).pbr(wet).at(0, jy + r0 * 0.86, jz - 0.08),
      blade({ span: 0.11, chord: 0.12, tip: 0.3, sweep: 0.75, thick: 0.1 }).color(mix(belly, top, 0.45)).pbr(wet).rot(0, 0, 180).at(0, jy - r0 * 0.8, jz - 0.12));
    if (i === 3) {
      p.push(...S.mirrorX([sk(S.ellipsoid(0.03, 0.016, 0.09).at(0.054, 0, -0.94).blend(0.025))]));
      const lobe = (sp, chord, ang, down, nt) => blade({ span: sp, chord, tip: 0.16, sweep: 0.42, thick: 0.1, falcate: 0.6, rows: 12, notch: nt }).shade((x, y) => mix(fin, 0x262b32, clamp(y / sp, 0, 1) * 0.55)).pbr(wet).rot(0, 0, down ? 180 : 0).rot(ang, 0, 0).at(0, 0, -0.985);
      hard.push(lobe(0.62, 0.28, -36, false, [0.6, 0.12, 0.05]), lobe(0.42, 0.24, 38, true, null));
      p.push(sk(S.capsule([0, 0.07, -1.0], [0, -0.06, -1.01], 0.04, 0.034).blend(0.035)));
    }
    hard.push(H.geo(coreGeo(at(TZ[i]).w, at(TZ[i + 1]).w, TZ[i] - TZ[i + 1], 0.7)).rot(0, 180, 0).at(0, jy, jz).color(top).pbr(wet));
    const o = [0, jy, jz], prev = i ? [0, at(TZ[i - 1]).y, TZ[i - 1]] : O;
    tail.push({ name: `tail${i}`, parent: i ? `tail${i - 1}` : 'body', rig: 'tail', pos: [0, o[1] - prev[1], o[2] - prev[2]], prims: into(o, p), hard: into(o, hard), detail: 0.8 });
  }
  const wake = [...foamRing(0.1, 7, 0.03, 3, 3.2)];
  return { kind: 'megalodon', nodes: [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: [O[0], O[1] - 0.07, O[2]], rot: [-8, 0, 0], prims: into(O, body), hard: into(O, bodyHard), detail: 0.85 },
    { name: 'jaw', parent: 'body', rig: 'jaw', pos: sub(J, O), rot: [24, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 0.9 },
    ...tail,
    { name: 'wake', parent: 'root', rig: 'foam', pos: [0, 0, 0.2], hard: wake },
  ] };
}
function animMegalodon(model, { t, phase }) {
  const rig = model.userData.rig, w = t * 2.6 + phase;
  // a slow patrol; then the head heaves out of the sea, the jaws open to their full gape and slam shut
  const c = frac(t * 0.16 + phase * 0.137), bite = pulse(c, 0.0, 0.36), snap = pulse(c, 0.27, 0.4);
  R(rig.body, -bite * 0.3 + Math.sin(w * 0.5) * 0.02, -Math.sin(w + 0.9) * 0.06, Math.sin(w) * 0.04);
  P(rig.body, 0, bite * 0.11 + Math.sin(w * 0.5 + 1) * 0.012, 0);
  R(rig.jaw, 0.04 + Math.max(0, Math.sin(t * 0.8 + phase)) * 0.12 + bite * 0.5 - snap * 0.45);
  (rig.tail || []).forEach((n, i) => R(n, bite * 0.08, Math.sin(w - i * 0.7) * (0.12 + i * 0.075), 0));
  (rig.foam || []).forEach((f, i) => { const k = 1 + Math.sin(t * 2 + phase + i * 2) * 0.1 + bite * 0.5; f.scale.set(k, 1, k); });
}

// =====================================================================================
// IRONSHELL: a crab like a drowned fortress. A plated dome crusted with barnacle and coral, two shearing claws
// =====================================================================================
function ironshellDesc(def) {
  const shell = def.color ?? 0x7a4a3a, iron = mix(shell, 0x2c3036, 0.5), dark = mix(shell, 0x16181c, 0.6), lite = tone(shell, 0.02, 0.04, 0.1), rust = mix(shell, 0xb8602a, 0.45);
  const cream = 0xdccba4, tip = 0x1c1614, ivory = 0xe9dcc0, weed = 0x4d6a36, coral = 0xd96a52, coralLt = 0xf2b89a;
  const sh = (p, c = shell) => p.color(c).pbr(0.5, 0.12).bump(0.01, 26, 'rock').tint(0.22, 9);
  const plate = (p, c) => p.color(c).pbr(0.46, 0.2).bump(0.007, 34, 'ridges').tint(0.25, 12);
  const CY = -0.04;

  // ---- carapace: a dome of keeled scutes ringed by spiked marginal plates ----
  const dome = [sh(S.ellipsoid(0.72, 0.31, 0.58).at(0, CY, -0.04), iron), sh(S.ellipsoid(0.5, 0.2, 0.4).at(0, CY + 0.15, -0.06).blend(0.1), iron)];
  const body = dome.slice();
  const top = (x, z) => surf(dome, [x, 1, z], [0, -1, 0])[1];
  const pcol = (i) => [iron, mix(shell, iron, 0.6), shell, mix(rust, iron, 0.35)][Math.floor(rnd(i, 71) * 4) % 4];
  [0.33, 0.1, -0.15, -0.4].forEach((z, i) => {
    const y = top(0, z), k = i === 3 ? 0.8 : 1;
    body.push(plate(S.ellipsoid(0.18 * k, 0.07, 0.125 * k).at(0, y - 0.015, z).blend(0.014), pcol(i)), sh(S.cone(0.075 * k, 0.02, 0.13 * k, 0.012).rot(-12, 0, 0).at(0, y + 0.07 * k, z - 0.01).blend(0.03), lite));
  });
  for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) {
    const z = 0.27 - i * 0.215, x = sd * (0.36 - Math.abs(i - 1.2) * 0.035), y = top(x, z);
    body.push(plate(S.ellipsoid(0.165, 0.065, 0.115).rot(0, 0, sd * -20).at(x, y - 0.02, z).blend(0.014), pcol(i * 2 + 10 + sd)), sh(S.cone(0.05, 0.016, 0.075, 0.01).rot(-10, 0, sd * -22).at(x, y + 0.04, z).blend(0.025), lite));
  }
  const NM = 18;
  for (let i = 0; i < NM; i++) {
    const a = (i + 0.5) / NM * PI * 2, sx = Math.sin(a), cz = Math.cos(a), x = sx * 0.66, z = -0.04 + cz * 0.53, y = top(x * 0.93, -0.04 + (z + 0.04) * 0.93);
    if (cz > 0.86) continue;   // the brow has its own plate
    body.push(plate(S.ellipsoid(0.115, 0.06, 0.085).rot(0, a / DEG, 0).at(x, Math.min(y, CY + 0.07), z).blend(0.014), pcol(i + 30)));
    if (i % 2) body.push(sh(S.cone(0.05, 0.012, 0.13, 0.01).at(0, 0.065, 0).rot(78, 0, 0).rot(0, a / DEG, 0).at(sx * 0.73, CY + 0.03, -0.04 + cz * 0.6).blend(0.02), lite));
  }
  // the brow: a toothed overhang above the face
  body.push(plate(S.ellipsoid(0.3, 0.07, 0.1).at(0, CY + 0.08, 0.5).blend(0.02), rust));
  for (const x of [-0.2, -0.12, -0.04, 0.04, 0.12, 0.2]) body.push(sh(S.cone(0.032, 0.008, 0.08, 0.006).at(0, 0.04, 0).rot(82, 0, 0).at(x, CY + 0.07, 0.585 - Math.abs(x) * 0.25).blend(0.014), lite));
  // seams, weed, pale pocks
  for (let i = 0; i < 7; i++) { const a = rnd(i, 81) * PI * 2, r = 0.2 + rnd(i, 82) * 0.4, x = Math.sin(a) * r, z = -0.04 + Math.cos(a) * r * 0.8; body.push(S.sphere(0.06 + rnd(i, 83) * 0.05).at(x, top(x, z), z).color(weed).pbr(0.9).paint(0.04, 0)); }
  for (let i = 0; i < 26; i++) { const a = rnd(i, 91) * PI * 2, r = rnd(i, 92) * 0.62, x = Math.sin(a) * r, z = -0.04 + Math.cos(a) * r * 0.8; body.push(S.sphere(0.008 + rnd(i, 93) * 0.008).at(x, top(x, z), z).color(mix(lite, cream, 0.4)).paint(0.004, 0.002)); }
  // underside and face
  body.push(
    S.ellipsoid(0.6, 0.12, 0.48).at(0, CY - 0.17, -0.02).color(cream).pbr(0.55).blend(0.04),
    under(0.8, CY - 0.13, -0.8, CY - 0.13, cream, 0.03, 0.55),
    S.ellipsoid(0.22, 0.07, 0.06).at(0, CY - 0.04, 0.53).cut(0.02).color(0x2a1612),
    ...S.mirrorX([S.sphere(0.05).at(0.17, CY + 0.03, 0.535).cut(0.014).color(dark)]),
  );
  const bodyHard = [
    ...H.mirrorX([H.box(0.085, 0.08, 0.02, 0.008).rot(8, 0, 0).at(0.05, CY - 0.06, 0.5).color(mix(cream, shell, 0.6)).pbr(0.5).lod(1)]),
    ...H.mirrorX([H.tube([[0.07, CY + 0.02, 0.54], [0.1, CY + 0.1, 0.63], [0.15, CY + 0.12, 0.74]], [0.008, 0.006, 0.002], 8, 5).color(dark).pbr(0.5).lod(1)]),
  ];
  // barnacle colonies and stands of coral
  const colony = (x, z, count, r, seed) => { for (let i = 0; i < count; i++) { const xx = x + (rnd(i, seed) - 0.5) * r * 9, zz = z + (rnd(i, seed + 20) - 0.5) * r * 9, rr = r * (0.55 + rnd(i, seed + 40) * 0.9); bodyHard.push(barnacle(rr, [xx, top(xx, zz) - rr * 0.15, zz], [xx * 0.6, 1, zz * 0.6]).lod(rr > 0.032 ? 9 : rr > 0.022 ? 2 : 1)); } };
  colony(-0.3, -0.2, 9, 0.03, 1); colony(0.25, 0.2, 7, 0.026, 2); colony(0.42, -0.25, 6, 0.024, 3); colony(-0.15, 0.3, 5, 0.022, 4); colony(-0.5, 0.1, 5, 0.022, 5); colony(0.1, -0.42, 6, 0.024, 6);
  const stand = (x, z, k, seed) => {
    const y = top(x, z) - 0.01;
    for (let i = 0; i < 5; i++) {
      const a = rnd(i, seed) * PI * 2, lean = 0.03 + rnd(i, seed + 1) * 0.06, h = (0.1 + rnd(i, seed + 2) * 0.1) * k, bx = x + Math.sin(a) * 0.02 * k, bz = z + Math.cos(a) * 0.02 * k, tx = bx + Math.sin(a) * lean * k, tz = bz + Math.cos(a) * lean * k;
      bodyHard.push(horn([[bx, y, bz], [lerp(bx, tx, 0.4), y + h * 0.5, lerp(bz, tz, 0.4)], [tx, y + h, tz]], 0.017 * k, 0.007 * k, coral, coralLt, 3, 6).lod(i < 2 ? 9 : 2));
      if (i < 3) bodyHard.push(horn([[lerp(bx, tx, 0.4), y + h * 0.45, lerp(bz, tz, 0.4)], [tx + Math.cos(a) * 0.04 * k, y + h * 0.7, tz - Math.sin(a) * 0.04 * k], [tx + Math.cos(a) * 0.05 * k, y + h * 0.98, tz - Math.sin(a) * 0.05 * k]], 0.011 * k, 0.005 * k, coral, coralLt, 2, 5).lod(1));
    }
  };
  stand(0.3, -0.12, 1.3, 51); stand(-0.24, 0.12, 1.0, 61); stand(-0.38, -0.3, 0.9, 71);
  // an old anchor fouled across the shell, its chain trailing
  { const y = top(0.12, -0.3);
    bodyHard.push(
      H.cyl(0.016, 0.016, 0.3, 7).rot(0, 0, 74).rot(0, 30, 0).at(0.14, y + 0.03, -0.3).color(0x2a2c30).pbr(0.6, 0.8),
      H.torus(0.1, 0.016, 14, 6, PI).rot(90, 0, 0).rot(0, 30, 16).at(0.27, y + 0.0, -0.37).color(0x2a2c30).pbr(0.6, 0.8),
      H.torus(0.03, 0.009, 10, 5).rot(0, 30, 0).at(0.0, y + 0.075, -0.22).color(0x2a2c30).pbr(0.6, 0.8).near(),
    ); }

  const nodes = [ROOT, { name: 'body', parent: 'root', rig: 'body', pos: [0, 0, 0], prims: body, hard: bodyHard, detail: 0.6 }];

  // ---- eye stalks ----
  for (const sd of [1, -1]) nodes.push({ name: `eye${sd}`, parent: 'body', rig: 'eyes', pos: [sd * 0.17, CY + 0.04, 0.53], rot: [14, sd * 12, sd * -12],
    prims: [S.capsule([0, 0, 0], [0, 0.15, 0], 0.03, 0.026).color(lite).pbr(0.45).bump(0.004, 40), S.sphere(0.04).at(0, 0.16, 0).color(dark).pbr(0.4).blend(0.008)],
    hard: [H.sphere(0.036, 14).at(0, 0.172, 0.01).color(0x0c0a0c).pbr(0.06).shade((x, y, z) => (z > 0.022 && y > 0.008 ? 0x8a5a2a : null)), H.geo(coreGeo(0.026, 0.022, 0.15, 0.7)).rot(-90, 0, 0).color(lite)], detail: 1.1 });

  // ---- claws: the right is the great crusher ----
  const claw = (sd, big) => {
    const k = big ? 1.55 : 1.12, La = 0.36, pr = [0.14 * k, 0.13 * k, 0.21 * k], fl = big ? 0.36 : 0.4, pz = 0.08 + pr[2], n = sd > 0 ? 'L' : 'R';
    nodes.push({ name: `clawBase${n}`, parent: 'body', pos: [sd * 0.52, CY - 0.02, 0.36], rot: [0, sd * 34, 0] });
    const arm = [
      sh(S.capsule([0, 0, 0], [0, 0.006, La], 0.1 * k, 0.09 * k)),
      plate(S.ellipsoid(0.085 * k, 0.07 * k, 0.12).at(0, 0.05 * k, La * 0.5).blend(0.02), rust),
      sh(S.sphere(0.1 * k).at(0, 0, La).blend(0.02), lite),
      S.box(0.5, 0.3, 0.7, 0.01).at(0, -0.15 - 0.03 * k, La / 2).color(cream).pbr(0.5).paint(0.016, 0),
    ];
    const armHard = [H.geo(coreGeo(0.09 * k, 0.08 * k, La)).color(shell)];
    for (let i = 0; i < 3; i++) armHard.push(spike(0.07 * k, 0.022 * k, 0.3, 5).rot(-15, 0, 0).at(0, 0.085 * k, La * (0.25 + i * 0.25)).color(lite).pbr(0.45).near());
    nodes.push({ name: `arm${n}`, parent: `clawBase${n}`, rig: 'arms', pos: [0, 0, 0], rot: [-74, 0, 0], prims: arm, hard: armHard, detail: 0.72 });
    const fixed = [[0, -pr[1] * 0.42, pz + pr[2] * 0.55], [0, -pr[1] * 0.46, pz + pr[2] * 0.55 + fl * 0.5], [0, -pr[1] * 0.12, pz + pr[2] * 0.55 + fl]];
    const fr = big ? [0.08, 0.06, 0.026] : [0.05, 0.036, 0.016];
    const palm = [
      sh(S.sphere(0.1 * k).at(0, 0, 0.015)),
      sh(S.ellipsoid(pr[0], pr[1], pr[2]).at(0, 0, pz).blend(0.03), iron),
      plate(S.ellipsoid(pr[0] * 0.8, pr[1] * 0.5, pr[2] * 0.6).at(0, pr[1] * 0.62, pz - pr[2] * 0.25).blend(0.016), rust),          // knuckle plates
      plate(S.ellipsoid(pr[0] * 0.7, pr[1] * 0.45, pr[2] * 0.45).at(0, pr[1] * 0.6, pz + pr[2] * 0.4).blend(0.016), shell),
      S.box(0.6, 0.3, 0.9, 0.01).at(0, -0.15 - pr[1] * 0.5, pz).color(cream).pbr(0.5).paint(0.02, 0),
      sh(S.capsule(fixed[0], fixed[1], fr[0], fr[1]).blend(0.03), mix(shell, cream, 0.4)),
      S.capsule(fixed[1], fixed[2], fr[1], fr[2]).color(ivory).pbr(0.4).blend(0.02),
      S.sphere(fr[2] * 1.15).at(fixed[2][0], fixed[2][1], fixed[2][2]).color(tip).pbr(0.35).blend(0.01),
    ];
    const palmHard = [H.geo(coreGeo(pr[0] * 0.8, fr[1], pz + pr[2] * 0.55 + fl * 0.5)).color(iron)];
    for (let i = 0; i < (big ? 5 : 8); i++) {
      const f = (i + 0.6) / (big ? 5.4 : 8.6), z = lerp(fixed[0][2] + 0.03, fixed[2][2] - 0.02, f), y = lerp(fixed[0][1], fixed[2][1], f * f) + lerp(fr[0], fr[2], f) * 0.86;
      palmHard.push(H.sphere(big ? 0.026 - i * 0.002 : 0.011, 8).scale(1, 0.8, 1).at(0, y, z).color(ivory).pbr(0.35).lod(big ? 2 : 1));
    }
    for (let i = 0; i < 6; i++) palmHard.push(spike(0.06 * k, 0.02 * k, 0.2, 5).at((i % 2 ? 1 : -1) * pr[0] * 0.34, pr[1] * 0.98, pz - pr[2] * 0.6 + i * pr[2] * 0.24).color(lite).pbr(0.45).near());
    if (big) for (const [x, z, r] of [[-0.6, 0.1, 0.024], [-0.72, -0.1, 0.018], [-0.55, -0.25, 0.016], [-0.75, 0.3, 0.014]]) palmHard.push(barnacle(r, [x * pr[0] * 1.3, pr[1] * 0.3, pz + z * pr[2]], [-1, 0.5, 0]).lod(1));
    nodes.push({ name: `fore${n}`, parent: `arm${n}`, rig: 'forearms', pos: [0, 0.006, La], rot: [46, sd * -30, sd * -24], prims: palm, hard: palmHard, detail: 0.72 });
    const dz = fl + pr[2] * 0.18, dr = big ? [0.075, 0.056, 0.024] : [0.048, 0.034, 0.015];
    const dPts = [[0, 0, 0], [0, 0.05, dz * 0.5], [0, -0.05, dz]];
    const dact = [
      sh(S.capsule(dPts[0], dPts[1], dr[0], dr[1]), mix(shell, dark, 0.4)),
      S.capsule(dPts[1], dPts[2], dr[1], dr[2]).color(ivory).pbr(0.4).blend(0.02),
      S.sphere(dr[2] * 1.15).at(dPts[2][0], dPts[2][1], dPts[2][2]).color(tip).pbr(0.35).blend(0.01),
    ];
    const dHard = [H.geo(coreGeo(dr[0], dr[1], dz * 0.5)).rot(-5, 0, 0).color(shell)];
    for (let i = 0; i < (big ? 4 : 7); i++) {
      const f = (i + 0.7) / (big ? 4.6 : 7.8), z = lerp(0.05, dz - 0.024, f), y = (f < 0.5 ? lerp(0, 0.05, f * 2) : lerp(0.05, -0.05, (f - 0.5) * 2)) - lerp(dr[0], dr[2], f) * 0.86;
      dHard.push(H.sphere(big ? 0.022 - i * 0.002 : 0.01, 8).scale(1, 0.8, 1).at(0, y, z).color(ivory).pbr(0.35).lod(big ? 2 : 1));
    }
    dHard.push(spike(0.05 * k, 0.018 * k, 0.2, 5).at(0, dr[0] * 0.9, dz * 0.2).color(lite).pbr(0.45).near(), spike(0.04 * k, 0.016 * k, 0.2, 5).at(0, dr[0] * 0.9 + 0.012, dz * 0.38).color(lite).pbr(0.45).near());
    nodes.push({ name: `dact${n}`, parent: `fore${n}`, rig: 'claws', pos: [0, pr[1] * 0.3, pz + pr[2] * 0.42], rot: [-30, 0, 0], prims: dact, hard: dHard, detail: 0.72 });
  };
  claw(1, false); claw(-1, true);

  // ---- legs: four pairs, the knees breaking the surface round the shell ----
  const LEG = [{ z: 0.22, fwd: 34 }, { z: 0.04, fwd: 8 }, { z: -0.16, fwd: -20 }, { z: -0.34, fwd: -48 }];
  for (const sd of [1, -1]) LEG.forEach((lg, i) => {
    const n = `${sd > 0 ? 'L' : 'R'}${i}`, L1 = 0.36, L2 = 0.44, r = 0.065;
    nodes.push({ name: `legBase${n}`, parent: 'body', pos: [sd * (0.56 - i * 0.03), CY - 0.12, lg.z], rot: [0, sd * (90 - lg.fwd), 0] });
    const upper = [
      sh(S.capsule([0, 0, 0], [0, 0, L1], r * 1.05, r * 0.9)),
      plate(S.ellipsoid(r * 0.8, r * 1.2, L1 * 0.36).at(0, 0.012, L1 * 0.5).blend(0.02), rust),
      sh(S.sphere(r * 1.05).at(0, 0, L1).blend(0.016), lite),
    ];
    const upperHard = [H.geo(coreGeo(r, r * 0.85, L1)).color(shell)];
    for (let k = 0; k < 2; k++) upperHard.push(spike(0.045, 0.014, 0.3, 5).rot(-20, 0, 0).at(0, r * 1.25, L1 * (0.4 + k * 0.3)).color(lite).pbr(0.45).lod(1));
    nodes.push({ name: `leg${n}`, parent: `legBase${n}`, rig: 'legs', pos: [0, 0, 0], rot: [-38, 0, 0], prims: upper, hard: upperHard, detail: 0.6 });
    const lower = [sh(S.capsule([0, 0, 0], [0, 0, L2 * 0.6], r * 0.86, r * 0.6)), S.capsule([0, 0, L2 * 0.6], [0, -0.02, L2], r * 0.6, r * 0.2).color(mix(shell, dark, 0.6)).pbr(0.4).blend(0.012)];
    nodes.push({ name: `shin${n}`, parent: `leg${n}`, rig: 'shins', pos: [0, 0, L1], rot: [88, 0, 0], prims: lower, hard: [H.geo(coreGeo(r * 0.86, r * 0.3, L2)).color(shell)], detail: 0.6 });
  });
  nodes.push({ name: 'foam0', parent: 'root', rig: 'foam', pos: [0, 0, -0.04], hard: [...foamRing(0.74, 26, 0.055, 3, 0.82), ...foamRing(0.88, 16, 0.04, 8, 0.85)] });
  return { kind: 'ironshell', nodes };
}
function animIronshell(model, { t, phase }) {
  const rig = model.userData.rig;
  R(rig.body, Math.sin(t * 0.9 + phase) * 0.03, 0, Math.sin(t * 0.7 + phase * 1.7) * 0.035);
  P(rig.body, 0, Math.sin(t * 1.1 + phase) * 0.018, 0);
  const L = rig.legs || [], S2 = rig.shins || [];
  for (let i = 0; i < L.length; i++) {
    const k = i % 4, sg = i < 4 ? 1 : -1, w = t * 2.6 + phase + k * 1.5 + (i < 4 ? 0 : PI);
    R(L[i], -Math.max(0, Math.sin(w)) * 0.22, sg * Math.cos(w) * 0.2, 0);
    R(S2[i], Math.max(0, Math.sin(w + 0.5)) * 0.25);
  }
  const A = rig.arms || [], F = rig.forearms || [], C = rig.claws || [];
  for (let i = 0; i < A.length; i++) {
    // each claw in turn rears, gapes and shears shut; the crusher is the slower
    const sg = i ? -1 : 1, c = frac(t * (i ? 0.13 : 0.19) + i * 0.45 + phase * 0.13), rear = pulse(c, 0, 0.5), snap = pulse(c, 0.3, 0.44), chop = pulse(c, 0.36, 0.56);
    R(A[i], -rear * 0.3 + chop * 0.45 + Math.sin(t * 1.1 + i * 2 + phase) * 0.05, sg * Math.sin(t * 0.8 + i + phase) * 0.08, 0);
    R(F[i], -rear * 0.2 + chop * 0.3, sg * (rear * 0.25 + Math.sin(t * 0.9 + i * 3 + phase) * 0.07), 0);
    R(C[i], -0.1 - rear * 0.4 - Math.sin(t * 1.6 + i * 1.7 + phase) * 0.08 + snap * 0.6);
  }
  (rig.eyes || []).forEach((e, i) => R(e, Math.sin(t * 2.3 + i * 2 + phase) * 0.12, 0, Math.sin(t * 1.7 + i + phase) * 0.14));
  (rig.foam || []).forEach((f, i) => { const k = 1 + Math.sin(t * 1.4 + phase + i * 2) * 0.04; f.scale.set(k, 1, k); });
}

// =====================================================================================
// ABYSSAL MAW: an angler from the black deeps. A head that is mostly jaw, glass needles for teeth, a cold lamp on a stalk
// =====================================================================================
function abyssalMawDesc(def) {
  const base = def.color ?? 0x2a1c3a, hide = mix(base, 0x0c0a12, 0.12), back = mix(base, 0x06060a, 0.36), belly = mix(base, 0x8a7a92, 0.38), lip = mix(base, 0x5a2a44, 0.5);
  const mouth = 0x8a1c38, throat = 0x1c060e, glass = 0xdfe9d6, lamp = 0x38f0a8, spot = 0x30c8f0, finA = mix(base, 0x0a0810, 0.3), finB = mix(base, 0x7a4a8a, 0.45), bone = 0x6a5a6a, wet = 0.24;
  const sk = (p, part) => p.color(part === 'top' ? back : part === 'bottom' ? belly : hide).pbr(part === 'bottom' ? 0.4 : 0.3).bump(0.014, 15, 'rock').tint(0.4, 5);
  const TAB = [
    { z: 0.88, w: 0.3, h: 0.22, y: 0.14 }, { z: 0.62, w: 0.45, h: 0.42, y: 0.01 }, { z: 0.3, w: 0.52, h: 0.5, y: -0.01 }, { z: 0.0, w: 0.46, h: 0.46, y: 0.0 },
    { z: -0.3, w: 0.31, h: 0.34, y: 0.02 }, { z: -0.58, w: 0.17, h: 0.2, y: 0.04 }, { z: -0.82, w: 0.085, h: 0.11, y: 0.05 }, { z: -0.98, w: 0.055, h: 0.07, y: 0.055 },
  ];
  const at = (z) => station(TAB, z);
  const skin = (z, th, lift = 0) => { const q = at(z), a = th * DEG, nx = Math.sin(a) / q.w, ny = Math.cos(a) / q.h, nl = Math.hypot(nx, ny); return { p: [Math.sin(a) * (q.w + lift), q.y + Math.cos(a) * (q.h + lift), z], n: [nx / nl, ny / nl, 0] }; };
  const O = [0, -0.2, 0.1], TZ = [-0.34, -0.62, -0.98];

  // ---- head and body ----
  const body = [
    ...hull(span(TAB, 0.86, TZ[0]), sk, 0.06),
    ...S.mirrorX([
      sk(S.ellipsoid(0.1, 0.09, 0.13).at(0.27, 0.33, 0.52).blend(0.05), 'top'),                              // bony brows
      sk(S.ellipsoid(0.12, 0.2, 0.2).at(0.42, -0.12, 0.42).blend(0.07)),                                      // cheeks
      sk(S.ellipsoid(0.09, 0.1, 0.12).at(0.4, -0.05, -0.02).blend(0.05)),                                     // fin root
    ]),
    sk(S.capsule([0, 0.42, 0.55], [0, 0.44, -0.2], 0.07, 0.05).blend(0.06), 'top'),                         // crest of the skull
  ];
  const outer = body.slice();
  body.push(under(1.0, -0.2, TZ[0] - 0.1, -0.16, belly, 0.06, wet + 0.06));
  // upper lip and the cavern behind it
  const UL = (a) => [Math.sin(a) * 0.36, 0.2 - Math.abs(Math.sin(a)) ** 2 * 0.2, 0.58 + Math.cos(a) * 0.33];
  body.push(
    S.ellipsoid(0.34, 0.36, 0.54).at(0, -0.15, 0.76).cut(0.012).color(mouth),
    S.ellipsoid(0.24, 0.14, 0.3).at(0, 0.0, 0.5).cut(0.03).color(tone(mouth, 0, 0, -0.06)),
    S.sphere(0.2).at(0, -0.12, 0.25).color(throat).paint(0.12, 0),
  );
  for (let i = 0; i < 8; i++) { const a = (-88 + i * 22) * DEG, b = (-88 + (i + 1) * 22) * DEG; body.push(S.capsule(UL(a), UL(b), 0.05, 0.05).color(lip).pbr(wet).bump(0.006, 24, 'rock').blend(0.03)); }
  // warts, and a scatter of cold lights along the flank
  for (let i = 0; i < 22; i++) { const z = 0.7 - rnd(i, 11) * 1.0, q = skin(z, (rnd(i, 12) - 0.5) * 200); body.push(sk(S.sphere(0.022 + rnd(i, 13) * 0.03).at(q.p[0], q.p[1], q.p[2]).blend(0.02), 'top')); }
  const eyeP = surf(outer, [0.9, 0.27, 0.6], [-1, 0, 0]);
  body.push(...S.mirrorX([S.sphere(0.05).at(eyeP[0] - 0.012, eyeP[1], eyeP[2]).cut(0.01).color(0x08060a)]));
  const bodyHard = [...H.mirrorX([eye(0.043, { iris: 0xc4dcd2, rim: 0x7a9a94, white: 0x9ab4ac, shape: 'none', irisDeg: 48, rough: 0.25, glow: 0.5 }).rot(-12, 70, 0).at(eyeP[0] - 0.03, eyeP[1], eyeP[2])])];
  const lights = (list, zs, th, r, l = 1) => { for (const z of zs) for (const sd of [-1, 1]) { const q = skin(z, sd * th, 0.002); list.push(H.sphere(r, 7).at(q.p[0], q.p[1], q.p[2]).color(spot).pbr(0.3).glow(1.1).lod(l)); } };
  lights(bodyHard, [0.56, 0.42, 0.28, 0.14, 0.0, -0.14, -0.27], 78, 0.018, 2); lights(bodyHard, [0.5, 0.3, 0.1, -0.1], 112, 0.013); lights(bodyHard, [0.62, 0.5], 40, 0.012); lights(bodyHard, [0.36, 0.2, 0.04, -0.12, -0.26], 44, 0.02, 2); lights(bodyHard, [0.3, 0.1, -0.1], 20, 0.014);
  for (const z of [0.56, 0.28, 0.0, -0.27]) for (const sd of [-1, 1]) { const q = skin(z, sd * 78); body.push(S.sphere(0.05).at(q.p[0], q.p[1], q.p[2]).color(mix(hide, spot, 0.3)).glow(0.25).paint(0.035, 0)); }
  // upper teeth: needles of glass hanging from the lip, uneven, some long as oars
  const needle = (len, r, p, d, l) => aim(spike(len, r, 0.12, 5), p, d).color(glass).pbr(0.12).shade((x, y) => (y < 0.12 ? lip : y > 0.75 ? 0xffffff : null)).lod(l);
  for (let i = 0; i < 15; i++) {
    const a = (-84 + i * 12) * DEG, q = UL(a), long = i % 3 === 1, len = (long ? 0.22 : 0.1) + rnd(i, 31) * 0.07;
    bodyHard.push(needle(len, long ? 0.02 : 0.014, [q[0] * 0.95, q[1] - 0.03, 0.6 + (q[2] - 0.6) * 0.95], [Math.sin(a) * 0.12, -1, Math.cos(a) * 0.12 + 0.1], long ? 9 : 2));
  }
  // dorsal: three free spines with rags of web, then a tattered fin
  for (let i = 0; i < 3; i++) bodyHard.push(aim(spike(0.26 - i * 0.04, 0.016, 0.3, 5), [0, 0.47, 0.22 - i * 0.14], [0, 1, -0.35 - i * 0.1]).color(bone).pbr(0.4).near());
  bodyHard.push(place(fan([{ a: 8, len: 0.2 }, { a: 26, len: 0.3 }, { a: 44, len: 0.22 }, { a: 60, len: 0.32 }, { a: 78, len: 0.2 }, { a: 96, len: 0.24 }], finA, finB, bone, { dip: 0.55, spineR: 0.011, rays: 4 }), 0, 0, 0, 0, 0.42, -0.22));
  // chin barbels
  for (let i = 0; i < 4; i++) { const x = (i - 1.5) * 0.14; bodyHard.push(H.tube([[x, -0.47, 0.3 - Math.abs(i - 1.5) * 0.05], [x * 1.1, -0.58, 0.26], [x * 1.2 + 0.02, -0.7 - rnd(i, 41) * 0.08, 0.2]], [0.016, 0.011, 0.004], 8, 5).color(belly).pbr(wet).lod(1)); }

  // ---- lower jaw: a scoop that juts past the upper lip, ringed with the longest teeth ----
  const J = [0, -0.2, 0.26], JC = [0, -0.27, 0.6];
  const LL = (a) => [Math.sin(a) * 0.39, -0.2 + Math.cos(a) * 0.035, 0.56 + Math.cos(a) * 0.5];
  const jaw = [
    sk(S.ellipsoid(0.42, 0.26, 0.52).at(JC[0], JC[1], JC[2] - 0.02), 'bottom'),
    sk(S.ellipsoid(0.2, 0.12, 0.2).at(0, -0.4, 0.86).blend(0.06), 'bottom'),                                 // chin
    S.box(1.2, 0.5, 1.6, 0.01).rot(-4, 0, 0).at(0, 0.06, 0.62).cut(0.01).color(mouth),
    S.ellipsoid(0.33, 0.16, 0.42).at(0, -0.2, 0.58).cut(0.02).color(tone(mouth, 0, 0, -0.04)),
    S.ellipsoid(0.16, 0.06, 0.24).at(0, -0.33, 0.52).color(0x6a2438).pbr(0.3).bump(0.006, 24).blend(0.03),   // tongue
    S.sphere(0.2).at(0, -0.14, 0.24).color(throat).paint(0.12, 0),
  ];
  for (let i = 0; i < 8; i++) { const a = (-86 + i * 21.5) * DEG, b = (-86 + (i + 1) * 21.5) * DEG; jaw.push(S.capsule(LL(a), LL(b), 0.045, 0.045).color(lip).pbr(wet).bump(0.006, 24, 'rock').blend(0.03)); }
  const jawHard = [];
  for (let i = 0; i < 15; i++) {
    const a = (-82 + i * 11.7) * DEG, q = LL(a), long = i % 2 === 0, len = (long ? 0.3 : 0.13) + rnd(i, 51) * 0.09 - Math.abs(i - 7) * 0.008;
    jawHard.push(needle(len, long ? 0.024 : 0.015, [q[0] * 0.96, q[1] + 0.02, 0.56 + (q[2] - 0.56) * 0.96], [Math.sin(a) * 0.2, 1, Math.cos(a) * 0.2 - 0.12], long ? 9 : 2));
  }
  for (let i = 0; i < 9; i++) { const a = (-70 + i * 17.5) * DEG, q = LL(a); jawHard.push(needle(0.09 + rnd(i, 61) * 0.05, 0.011, [q[0] * 0.8, q[1] - 0.01, 0.56 + (q[2] - 0.56) * 0.8], [0, 1, -0.3], 0)); }
  lights(jawHard, [0.8, 0.62], 150, 0.013);

  // ---- tail: two joints and a ragged fan ----
  const tail = [];
  for (let i = 0; i < 2; i++) {
    const o = [0, at(TZ[i]).y, TZ[i]], prev = i ? [0, at(TZ[0]).y, TZ[0]] : O;
    const p = [...hull(span(TAB, TZ[i], TZ[i + 1]), sk)], hard = [H.geo(coreGeo(at(TZ[i]).w, at(TZ[i + 1]).w, TZ[i] - TZ[i + 1], 0.7)).rot(0, 180, 0).at(0, o[1], o[2]).color(hide).pbr(wet)];
    if (i === 0) lights(hard, [-0.42, -0.54], 80, 0.014);
    if (i === 1) hard.push(place(fan([{ a: 24, len: 0.16 }, { a: 42, len: 0.34 }, { a: 58, len: 0.26 }, { a: 74, len: 0.42 }, { a: 90, len: 0.3 }, { a: 106, len: 0.42 }, { a: 122, len: 0.24 }, { a: 138, len: 0.33 }, { a: 156, len: 0.15 }], finA, finB, bone, { dip: 0.5, spineR: 0.01, rays: 4 }), 0, 0, 0, 0, 0.055, -0.9),
      place(fan([{ a: 10, len: 0.1 }, { a: 34, len: 0.18 }, { a: 60, len: 0.13 }, { a: 84, len: 0.16 }], finA, finB, bone, { dip: 0.5, spineR: 0.008 }), 0, 0, 180, 0, -0.03, -0.66));
    tail.push({ name: `tail${i}`, parent: i ? 'tail0' : 'body', rig: 'tail', pos: sub(o, prev), prims: into(o, p), hard: into(o, hard), detail: 0.7 });
  }
  // ---- pectoral fins: ragged paddles ----
  const pect = (sd) => place(fan([{ a: -40, len: 0.2 }, { a: -18, len: 0.36 }, { a: 4, len: 0.3 }, { a: 24, len: 0.42 }, { a: 46, len: 0.28 }, { a: 66, len: 0.3 }], finA, finB, bone, { dip: 0.5, spineR: 0.011, cup: 0.06 * sd, rays: 4 }), 90, 0, 0, 0, 0, 0);

  // ---- the lure: a jointed rod sprung from the brow, a lamp at its tip ----
  const LN = 4, LL2 = 0.23, lure = [];
  for (let i = 0; i < LN; i++) {
    const hard = [H.tube([[0, 0, 0], [0, LL2 * 0.5, 0], [0, LL2, 0]], [0.026 - i * 0.004, 0.024 - i * 0.004, 0.022 - i * 0.004], 6, 6).color(mix(hide, bone, 0.3 + i * 0.12)).pbr(0.3), H.sphere(0.028 - i * 0.004, 8).at(0, LL2, 0).color(mix(hide, bone, 0.5)).pbr(0.3).near()];
    if (i === LN - 1) {
      hard.push(
        H.sphere(0.085, 16).at(0, LL2 + 0.07, 0).color(lamp).pbr(0.25).glow(1.25).shade((x, y, z) => (noise3(x * 40, y * 40, z * 40) > 0.7 ? 0xc8ffe8 : null)),
        H.sphere(0.05, 10).scale(1, 0.7, 1).at(0, LL2 + 0.005, 0).color(mix(hide, lamp, 0.3)).pbr(0.3).glow(0.4),
      );
      for (let k = 0; k < 5; k++) { const a = (k / 5) * PI * 2; hard.push(H.tube([[Math.sin(a) * 0.05, LL2 + 0.11, Math.cos(a) * 0.05], [Math.sin(a) * 0.1, LL2 + 0.17, Math.cos(a) * 0.1], [Math.sin(a + 0.6) * 0.13, LL2 + 0.14 + rnd(k, 71) * 0.1, Math.cos(a + 0.6) * 0.13]], [0.012, 0.008, 0.003], 8, 5).color(lamp).pbr(0.3).glow(0.9).lod(1)); }
    }
    lure.push({ name: `lure${i}`, parent: i ? `lure${i - 1}` : 'body', rig: 'lure', pos: i ? [0, LL2, 0] : sub([0, 0.46, 0.5], O), rot: [i ? 32 : 30, 0, 0], hard });
  }

  return { kind: 'abyssalMaw', nodes: [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: [O[0], O[1] - 0.1, O[2] - 0.1], rot: [-48, 0, 0], prims: into(O, body), hard: into(O, bodyHard), detail: 0.58 },
    { name: 'jaw', parent: 'body', rig: 'jaw', pos: sub(J, O), rot: [22, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 0.62 },
    ...tail, ...lure,
    { name: 'finL', parent: 'body', rig: 'fins', pos: sub([0.46, -0.08, -0.04], O), rot: [0, 30, -20], hard: pect(1) },
    { name: 'finR', parent: 'body', rig: 'fins', pos: sub([-0.46, -0.08, -0.04], O), rot: [0, -30, 20], hard: pect(-1) },

  ] };
}
function animAbyssalMaw(model, { t, phase }) {
  const rig = model.userData.rig, w = t * 1.3 + phase;
  // the jaws work slowly at the surface; then the whole head surges up and they clap shut
  const c = frac(t * 0.14 + phase * 0.151), gape = pulse(c, 0.0, 0.4), snap = pulse(c, 0.3, 0.44);
  R(rig.body, -gape * 0.16 + snap * 0.12 + Math.sin(w * 0.6) * 0.03, Math.sin(w * 0.8) * 0.05, Math.sin(w * 0.5 + 1) * 0.03);
  P(rig.body, 0, gape * 0.1 + Math.sin(w * 0.7) * 0.02, 0);
  R(rig.jaw, 0.06 + Math.sin(w * 0.9) * 0.12 + gape * 0.4 - snap * 0.7);
  (rig.tail || []).forEach((n, i) => R(n, 0, Math.sin(w * 1.6 - i * 0.9) * (0.2 + i * 0.16), 0));
  (rig.fins || []).forEach((f, i) => { const sg = i ? -1 : 1; R(f, Math.sin(w * 1.8 + i) * 0.2, sg * Math.sin(w * 1.8 + i + 1) * 0.3, sg * Math.sin(w * 1.2 + i) * 0.15); });
  (rig.lure || []).forEach((n, i) => R(n, Math.sin(w * 1.1 - i * 0.7) * (0.07 + i * 0.03) - gape * 0.12 + snap * 0.2, 0, Math.sin(w * 0.8 - i * 0.9 + 1) * (0.08 + i * 0.04)));
  (rig.foam || []).forEach((f) => { const k = 1 + Math.sin(t * 1.5 + phase) * 0.06 + snap * 0.2; f.scale.set(k, 1, k); });
}

// =====================================================================================
// COIL SERPENT: the great constrictor of the sea, hooded like a cobra, its banded body corkscrewing out of the swell
// =====================================================================================
const COIL = { Ls: [0.2, 0.2, 0.22, 0.24, 0.26, 0.26, 0.26, 0.26, 0.26, 0.26, 0.26, 0.26, 0.26, 0.26, 0.26, 0.26, 0.26, 0.25, 0.24, 0.23, 0.22], lay: null };
COIL.n = COIL.Ls.length; COIL.len = COIL.Ls.reduce((a, b) => a + b, 0);
// u runs roughly with distance astern of the head; layChain steps along it by true length
function coilCurve(u, t, phase, o) {
  const w = t * 0.9 + phase, body = smooth((u - 0.5) / 0.55), neck = 1 - smooth(u / 0.9), squeeze = 0.5 + 0.5 * Math.sin(w * 0.45);
  const lam = 1.0, a = (u - 0.8) / lam * PI * 2 - w * 1.5, end = 1 - smooth((u - 2.25) / 0.5) * 0.55;
  const ay = (0.42 + squeeze * 0.07) * end, ax = (0.25 - squeeze * 0.09) * end;
  const ny = 0.82 - 0.55 * smooth(u / 0.95) - u * 0.3;                               // the reared neck
  o[0] = Math.sin(w * 0.6) * 0.09 * neck + body * ax * Math.cos(a);
  o[1] = lerp(ny * (1 + Math.sin(w * 0.8) * 0.04), -0.1 + ay * Math.sin(a), body);
  o[2] = 0.98 - u * (0.9 - body * 0.02) + Math.sin(w * 0.8 + 1) * 0.04 * neck;
}
function coilSerpentDesc(def) {
  const base = def.color ?? 0x3a6a4a, skin = tone(base, 0, 0.02, 0.02), back = tone(base, 0.02, 0.05, -0.1), band = mix(base, 0x0c1410, 0.62), belly = 0xdcd2a2;
  const web = 0xd24a34, webIn = mix(base, 0x1a0c10, 0.45), bone = 0xe8dfc6, boneDk = 0x3c3028, mouth = 0xa02c3c, tooth = 0xf6f1e0, wet = 0.36;
  const sk = (p, part) => (part === 'bottom'
    ? p.color(belly).pbr(wet + 0.06).bump(0.008, 11, 'ridges').tint(0.08, 30)
    : p.color(part === 'top' ? back : skin).pbr(wet).bump(0.008, 24, 'scales').tint(0.15, 9));
  const TAB = [
    { z: 0.03, w: 0.1, h: 0.105, y: 0 }, { z: -0.45, w: 0.118, h: 0.125, y: 0 }, { z: -0.95, w: 0.148, h: 0.155, y: 0 }, { z: -3.5, w: 0.148, h: 0.155, y: 0 },
    { z: -4.3, w: 0.105, h: 0.112, y: 0 }, { z: -4.8, w: 0.055, h: 0.06, y: 0 }, { z: -COIL.len, w: 0.02, h: 0.024, y: 0 },
  ];
  const at = (z) => station(TAB, z);
  COIL.lay = COIL.lay || newLay(COIL.n);
  const lay = layChain((p, o) => coilCurve(p, 0, 0, o), COIL.Ls, COIL.lay);
  const segs = [];
  let z0 = 0;
  for (let i = 0; i < COIL.n; i++) {
    const L = COIL.Ls[i], z1 = z0 - L, o = [0, 0, z0], zm = (z0 + z1) / 2, mid = at(zm);
    const p = [...hull(span(TAB, z0, z1), sk)];
    // bands: a broad dark ring and a thin pale one on every length
    p.push(S.cyl(0.4, L * 0.36, 0.01).rot(90, 0, 0).at(0, mid.h * 0.55, zm + L * 0.1).color(band).paint(0.02, 0), S.cyl(0.4, L * 0.07, 0.005).rot(90, 0, 0).at(0, mid.h * 0.55, zm - L * 0.2).color(mix(skin, belly, 0.6)).paint(0.012, 0));
    p.push(under(z0 + 0.05, -mid.h * 0.5, z1 - 0.05, -mid.h * 0.5, belly, 0.03, wet + 0.06));
    const hard = [H.geo(coreGeo(at(z0).w, at(z1).w, L, 0.7)).rot(0, 180, 0).at(0, 0, z0).shade((x, y) => (y < -mid.h * 0.35 ? belly : skin)).pbr(wet)];
    // dorsal ridge: hooked spines, two to a length
    if (i < COIL.n - 2) for (let k = 0; k < 2; k++) {
      const zz = lerp(z0, z1, 0.25 + k * 0.5), q = at(zz), len = (0.12 + (k ? 0 : 0.04)) * clamp(q.w / 0.148, 0.4, 1) * (i === 0 ? 0.6 : 1);
      hard.push(spike(len, 0.03 * clamp(q.w / 0.148, 0.4, 1), 0.5, 6, 0.5).rot(-34, 0, 0).at(0, q.h - 0.012, zz).shade((x, y) => (y > 0.55 ? bone : boneDk)).pbr(0.4).lod(k ? 2 : 9));
    }
    p.push(sk(S.capsule([0, mid.h - 0.012, z0 - L * 0.15], [0, mid.h - 0.012, z1 + L * 0.15], 0.03, 0.03).blend(0.03), 'top'));
    if (i >= COIL.n - 2) {
      const k = i === COIL.n - 1 ? 1 : 0.6;
      hard.push(place(fan([{ a: 34, len: 0.1 * k }, { a: 56, len: 0.22 * k }, { a: 74, len: 0.3 * k }, { a: 90, len: 0.33 * k }, { a: 106, len: 0.3 * k }, { a: 124, len: 0.22 * k }, { a: 146, len: 0.1 * k }], webIn, web, boneDk, { dip: 0.22, spineR: 0.008 }), 0, 0, 0, 0, 0, z0 - L * 0.15));
    }
    segs.push({ name: `seg${i}`, parent: i ? `seg${i - 1}` : 'root', rig: 'segs', pos: i ? [0, 0, -COIL.Ls[i - 1]] : lay.pos.slice(), rot: eulerDeg(lay.quats[i]), prims: into(o, p), hard: into(o, hard), detail: 0.74 });
    z0 = z1;
  }

  // ---- head: broad and flat, pitted, two sabre fangs ----
  const HT = [
    { z: 0.5, w: 0.03, h: 0.022, y: -0.014 }, { z: 0.46, w: 0.07, h: 0.04, y: -0.012 }, { z: 0.36, w: 0.105, h: 0.058, y: -0.008 }, { z: 0.24, w: 0.135, h: 0.076, y: -0.002 },
    { z: 0.12, w: 0.155, h: 0.094, y: 0.002 }, { z: 0.02, w: 0.14, h: 0.105, y: 0.002 }, { z: -0.07, w: 0.1, h: 0.1, y: 0 },
  ];
  const mY = (z) => lerp(-0.034, -0.03, (z - 0.05) / 0.45);
  const skull = [
    ...hull(HT, sk),
    ...S.mirrorX([
      sk(S.ellipsoid(0.05, 0.05, 0.1).at(0.125, 0.0, 0.05).blend(0.045)),                                   // venom glands
      sk(S.capsule([0.05, 0.066, 0.36], [0.12, 0.092, 0.14], 0.022, 0.034).blend(0.03), 'top'),            // brow shelf
    ]),
    sk(S.ellipsoid(0.05, 0.03, 0.08).at(0, 0.05, 0.4).blend(0.03), 'top'),
  ];
  const head = [...skull, under(0.56, -0.05, -0.08, -0.06, belly, 0.02, wet)];
  head.push(
    S.capsule([0, 0.11, 0.3], [0, 0.11, -0.04], 0.5).color(band).paint(0.0, 0).scale(0.06),
    slab(0.64, mY(0.64), 0.05, mY(0.05), -1, 0, 0.5).cut(0.007).color(mouth),
    S.ellipsoid(0.07, 0.03, 0.18).at(0, -0.024, 0.27).cut(0.02).color(tone(mouth, 0, 0, -0.08)),
    S.sphere(0.07).at(0, -0.034, 0.06).color(0x40141c).paint(0.04, 0),
  );
  const eyeP = surf(skull, [0.5, 0.05, 0.25], [-1, 0, 0]);
  head.push(...S.mirrorX([
    S.sphere(0.028).at(eyeP[0] - 0.006, eyeP[1], eyeP[2]).cut(0.008).color(0x0c1410),
    S.sphere(0.012).at(0.05, 0.03, 0.46).color(0x0a0c0c).paint(0.005, -0.007),
    S.ellipsoid(0.014, 0.01, 0.022).at(0.085, 0.022, 0.37).color(0x0a0c0c).paint(0.005, -0.006),             // heat pits
  ]));
  const headHard = [
    ...H.mirrorX([
      eye(0.025, { iris: 0xd8f04a, rim: 0x5a6a10, white: 0xe8f060, shape: 'slit', pupilDeg: 12, irisDeg: 60, rough: 0.1, glow: 0.5 }).rot(-4, 66, 0).at(eyeP[0] - 0.016, eyeP[1], eyeP[2]).near(),
      spike(0.07, 0.016, 0.4, 5).rot(-40, 0, -24).at(0.1, 0.095, 0.16).shade((x, y) => (y > 0.5 ? bone : boneDk)).pbr(0.4).near(),
      spike(0.055, 0.014, 0.4, 5).rot(-40, 0, -24).at(0.085, 0.085, 0.25).shade((x, y) => (y > 0.5 ? bone : boneDk)).pbr(0.4).lod(1),
    ]),
  ];
  const fang = (hard, x, z, len, up, r = 0.008, l = 1) => hard.push(spike(len, r, 0.45, 5).rot(up > 0 ? 180 : 0, 0, 0).rot(up > 0 ? -8 : 8, 0, 0).at(x, mY(z) + up * 0.006, z).color(tooth).pbr(0.2).lod(l));
  const lipX = (z, dy) => surf(skull, [0.5, mY(z) + dy, z], [-1, 0, 0])[0] - 0.012;
  for (let i = 0; i < 9; i++) for (const sd of [-1, 1]) fang(headHard, sd * lipX(0.1 + i * 0.038, 0.014), 0.1 + i * 0.038, 0.024 + rnd(i, 3) * 0.01, 1);
  for (const sd of [-1, 1]) fang(headHard, sd * 0.05, 0.43, 0.16, 1, 0.02, 9);                              // the sabres
  const J = [0, mY(0.05), 0.05];
  const jaw = [
    ...hull(span(HT.map((q) => ({ ...q, w: q.w * 0.96 })), 0.47, -0.02), sk),
    under(0.56, -0.046, -0.08, -0.056, belly, 0.02, wet),
    slab(0.64, mY(0.64), -0.04, mY(-0.04), 1, 0, 0.5).cut(0.007).color(mouth),
    S.box(0.6, 0.5, 0.2, 0.01).at(0, 0, -0.1).cut(0.012).color(mouth),
    S.ellipsoid(0.07, 0.01, 0.16).at(0, -0.04, 0.27).cut(0.014).color(tone(mouth, 0, 0, -0.06)),
    S.sphere(0.07).at(0, -0.034, 0.06).color(0x40141c).paint(0.04, 0),
  ];
  const jawHard = [];
  for (let i = 0; i < 9; i++) for (const sd of [-1, 1]) fang(jawHard, sd * (lipX(0.1 + i * 0.038, -0.014) - 0.006), 0.1 + i * 0.038, 0.02 + rnd(i, 7) * 0.008, -1);
  jawHard.push(
    H.tube([[0, -0.04, 0.2], [0, -0.036, 0.36], [0, -0.03, 0.5]], [0.012, 0.009, 0.006], 8, 6).color(0x2a1418).pbr(0.3).lod(1),
    ...H.mirrorX([H.tube([[0, -0.03, 0.5], [0.012, -0.022, 0.56], [0.04, -0.01, 0.62]], [0.006, 0.004, 0.0015], 6, 5).color(0x2a1418).pbr(0.3).lod(1)]),
  );
  // the hood: a great ribbed fan either side of the neck, flared by the animator, eye-spots on its back
  const hood = (sd) => fan([{ a: -30, len: 0.16 }, { a: -6, len: 0.3 }, { a: 20, len: 0.4 }, { a: 46, len: 0.45 }, { a: 72, len: 0.45 }, { a: 98, len: 0.4 }, { a: 124, len: 0.3 }, { a: 150, len: 0.17 }], webIn, web, boneDk, { dip: 0.16, cup: -0.09 * sd, spineR: 0.011, rays: 3.4, fade: 1.2 });
  return { kind: 'coilSerpent', nodes: [
    ROOT, ...segs,
    { name: 'head', parent: 'seg0', rig: 'head', pos: [0, 0, 0], rot: [22, 0, 0], prims: head, hard: headHard, detail: 1.2 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: J, rot: [20, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 1.2 },
    { name: 'hoodL', parent: 'seg0', rig: 'frills', pos: [0.085, 0.0, -0.02], rot: [0, -62, -8], hard: hood(1) },
    { name: 'hoodR', parent: 'seg0', rig: 'frills', pos: [-0.085, 0.0, -0.02], rot: [0, 62, 8], hard: hood(-1) },
  ] };
}
function animCoilSerpent(model, { t, phase }) {
  const rig = model.userData.rig, w = t * 0.9 + phase;
  poseChain(rig.segs, layChain((p, o) => coilCurve(p, t, phase, o), COIL.Ls, COIL.lay || (COIL.lay = newLay(COIL.n))));
  // it sways, hood half spread; then draws back, spreads the hood wide and strikes
  const c = frac(t * 0.13 + phase * 0.23), draw = pulse(c, 0.0, 0.36), strike = pulse(c, 0.28, 0.42);
  R(rig.head, -draw * 0.45 + strike * 0.6 + Math.sin(w * 1.3) * 0.05, Math.sin(w * 0.8 + 1) * 0.2 * (1 - draw), 0);
  R(rig.jaw, 0.02 + Math.max(0, Math.sin(w * 1.7)) * 0.06 + draw * 0.55 - strike * 0.2);
  const fl = 0.1 + draw * 0.42 + Math.sin(w * 2.1) * 0.05;
  if (rig.frills) { R(rig.frills[0], 0, -fl, 0); R(rig.frills[1], 0, fl, 0); }
}

// =====================================================================================
// BEHEMOTH: the horned whale. A brow like a cliff, one spiralled tusk, a grin of razors, flukes that blot out the sky
// =====================================================================================
/** a spiralled tusk along +Y: base radius r, length len, fluted with `turns` twists */
function tuskGeo(len, r, turns = 5, flutes = 3) {
  return cached(`tusk:${len}:${r}:${turns}:${flutes}`, () => {
    const rings = [], N = 44, M = 14;
    for (let i = 0; i <= N; i++) {
      const s = i / N, rr = r * (Math.pow(1 - s, 0.8) * 0.97 + 0.03), ring = [];
      for (let k = 0; k < M; k++) { const a = (k / M) * PI * 2, f = 1 + 0.16 * Math.sin(a * flutes + s * turns * PI * 2) * (1 - s * 0.5); ring.push([Math.cos(a) * rr * f, s * len, Math.sin(a) * rr * f]); }
      rings.push(ring);
    }
    return loft(rings, true, true);
  });
}
function behemothDesc(def) {
  const base = def.color ?? 0x2c3440, hide = mix(base, 0x14181c, 0.2), back = mix(base, 0x0a0c10, 0.45), belly = 0xa9b0b0, groove = 0x6a747a;
  const mouth = 0x7a1f2c, tooth = 0xefe8d2, scar = mix(hide, 0xd4c8c8, 0.55), pale = mix(hide, 0x9aa4a8, 0.4), ivory = 0xece2c4, ivoryDk = 0x8a7a58, wet = 0.4;
  const CY = -0.045;
  const sk = (p, part) => (part === 'top'
    ? p.color(back).pbr(wet).bump(0.008, 15, 'rock').tint(0.22, 5)
    : p.color(part === 'bottom' ? mix(hide, belly, 0.55) : hide).pbr(wet).bump(0.005, 18).tint(0.16, 6));
  const TAB = [
    { z: 1.02, w: 0.17, h: 0.18, y: CY + 0.04 }, { z: 0.93, w: 0.28, h: 0.28, y: CY + 0.035 }, { z: 0.7, w: 0.355, h: 0.335, y: CY + 0.02 }, { z: 0.35, w: 0.4, h: 0.36, y: CY },
    { z: -0.02, w: 0.39, h: 0.352, y: CY }, { z: -0.38, w: 0.3, h: 0.285, y: CY + 0.01 }, { z: -0.68, w: 0.19, h: 0.195, y: CY + 0.02 }, { z: -0.93, w: 0.112, h: 0.122, y: CY + 0.03 },
    { z: -1.13, w: 0.066, h: 0.072, y: CY + 0.035 }, { z: -1.28, w: 0.042, h: 0.046, y: CY + 0.04 },
  ];
  const at = (z) => station(TAB, z);
  const skin = (z, th, lift = 0) => { const q = at(z), a = th * DEG, nx = Math.sin(a) / q.w, ny = Math.cos(a) / q.h, nl = Math.hypot(nx, ny); return { p: [Math.sin(a) * (q.w + lift), q.y + Math.cos(a) * (q.h + lift), z], n: [nx / nl, ny / nl, 0] }; };
  const topY = (z) => at(z).y + at(z).h, bellyLine = (z) => { const q = at(z); return q.y - q.h * 0.4; };
  const NZ = 0.48, MZ = 0.0, TZ = [-0.5, -0.76, -0.99, -1.17, -1.28];
  const nodeOf = (z) => { if (z >= NZ) return 'head'; if (z >= MZ) return 'body'; if (z >= TZ[0]) return 'rear'; for (let i = 0; i < 4; i++) if (z >= TZ[i + 1]) return `tail${i}`; return 'tail3'; };
  const names = ['head', 'body', 'rear', 'tail0', 'tail1', 'tail2', 'tail3'], prims = {}, hard = {};
  for (const n of names) { prims[n] = []; hard[n] = []; }
  const ORG = { head: [0, CY, NZ], body: [0, CY, 0.05] };
  for (let i = 0; i < 4; i++) ORG[`tail${i}`] = [0, at(TZ[i]).y, TZ[i]];

  prims.head.push(...hull(span(TAB, 1.02, NZ), sk));
  prims.body.push(...hull(span(TAB, NZ, MZ), sk));
  prims.rear.push(...hull(span(TAB, MZ, TZ[0]), sk));
  for (let i = 0; i < 4; i++) prims[`tail${i}`].push(...hull(span(TAB, TZ[i], TZ[i + 1]), sk));
  // the brow: a squared cliff of a forehead, a boss where the tusk is rooted
  prims.head.push(
    sk(S.ellipsoid(0.26, 0.2, 0.22).at(0, CY + 0.15, 0.86).blend(0.09), 'top'),
    sk(S.ellipsoid(0.13, 0.1, 0.13).at(0, CY + 0.34, 0.86).blend(0.05), 'top'),
    ...S.mirrorX([sk(S.capsule([0.2, CY + 0.2, 0.96], [0.33, CY + 0.12, 0.6], 0.05, 0.06).blend(0.05), 'top')]),
  );
  const headHull = prims.head.slice();
  prims.head.push(under(1.2, bellyLine(1.0) + 0.03, NZ - 0.06, bellyLine(NZ), belly, 0.03, wet));
  prims.body.push(S.box(1.6, 1.4, 0.6, 0.02).at(0, CY, NZ + 0.15 + 0.3).color(0x2a0a10).pbr(0.5).paint(0.03, 0));
  prims.body.push(under(NZ + 0.06, bellyLine(NZ), MZ - 0.1, bellyLine(MZ - 0.1), belly, 0.04, wet));
  prims.rear.push(under(MZ + 0.1, bellyLine(MZ + 0.1), TZ[0] - 0.06, bellyLine(TZ[0]), belly, 0.04, wet));
  for (let i = 0; i < 4; i++) prims[`tail${i}`].push(under(TZ[i] + 0.06, bellyLine(TZ[i] + 0.06), TZ[i + 1] - 0.06, bellyLine(TZ[i + 1] - 0.06), belly, 0.03, wet));
  for (let k = -4; k <= 4; k++) for (const [n, z0, z1] of [['body', NZ + 0.03, MZ - 0.04], ['rear', MZ + 0.04, -0.14 - Math.abs(k) * 0.03]]) {
    const a = skin(z0, 180 + k * 11), b = skin(z1, 180 + k * 11);
    prims[n].push(S.capsule(a.p, b.p, 0.013, 0.009).color(groove).paint(0.006, -0.009));
  }
  // a low hump and a line of knuckles down the spine to the flukes
  prims.rear.push(sk(S.ellipsoid(0.07, 0.07, 0.17).at(0, topY(-0.2) - 0.02, -0.2).blend(0.06), 'top'));
  for (let i = 0; i < 8; i++) { const z = -0.42 - i * 0.1, k = clamp(at(z).w / 0.3, 0.25, 1); prims[nodeOf(z)].push(sk(S.ellipsoid(0.05 * k, 0.045 * k, 0.045).at(0, topY(z) - 0.012 * k, z).blend(0.03), 'top')); }
  // pale blotches, old rakes, pocks left by suckers
  for (let i = 0; i < 20; i++) { const z = 0.95 - rnd(i, 11) * 1.9, q = skin(z, (rnd(i, 12) - 0.5) * 230); prims[nodeOf(z)].push(S.sphere(0.035 + rnd(i, 13) * 0.05).at(q.p[0], q.p[1], q.p[2]).color(pale).paint(0.03, 0)); }
  for (const [z, th, len, ang, w] of [[0.3, 62, 0.4, 16, 0.013], [0.26, 71, 0.5, 13, 0.016], [0.22, 80, 0.36, 11, 0.012], [-0.15, -58, 0.34, -20, 0.014], [-0.2, -67, 0.26, -18, 0.012], [0.8, -40, 0.22, 34, 0.012], [0.76, -50, 0.16, 30, 0.01], [0.1, 20, 0.3, -40, 0.012], [-0.5, 40, 0.2, 10, 0.01], [0.6, 30, 0.2, -60, 0.011]]) {
    const q = skin(z, th);
    prims[nodeOf(z)].push(S.ellipsoid(w, 0.14, len / 2).rot(ang, 0, -th).at(q.p[0], q.p[1], q.p[2]).color(scar).pbr(0.6).paint(0.006, -0.008));
  }
  for (let i = 0; i < 9; i++) { const a = (i / 9) * PI * 2, q = skin(0.2 + Math.cos(a) * 0.1, -78 + Math.sin(a) * 13); prims.body.push(S.sphere(0.016).at(q.p[0], q.p[1], q.p[2]).color(scar).pbr(0.6).paint(0.007, -0.006)); }
  prims.body.push(
    sk(S.ellipsoid(0.07, 0.03, 0.08).at(0, topY(0.4) - 0.006, 0.4).blend(0.03), 'top'),
    S.ellipsoid(0.02, 0.03, 0.04).at(0, topY(0.4) + 0.022, 0.4).cut(0.006).color(0x08090c),
  );
  const colony = (z, th, count, r, seed) => {
    for (let i = 0; i < count; i++) {
      const zz = z + (rnd(i, seed) - 0.5) * r * 9, tt = th + (rnd(i, seed + 20) - 0.5) * r * 1300, q = skin(zz, tt, 0.004), rr = r * (0.55 + rnd(i, seed + 40) * 0.9);
      hard[nodeOf(zz)].push(barnacle(rr, [q.p[0] - q.n[0] * rr * 0.1, q.p[1] - q.n[1] * rr * 0.1, zz], q.n).lod(rr > 0.03 ? 2 : 1));
    }
  };
  colony(0.9, 30, 8, 0.024, 1); colony(0.7, -52, 8, 0.022, 2); colony(0.32, 30, 7, 0.024, 3); colony(0.05, -40, 8, 0.024, 4); colony(-0.3, 26, 6, 0.02, 5);
  colony(0.5, 86, 7, 0.022, 6); colony(-0.1, -92, 6, 0.022, 7); colony(-0.62, -30, 5, 0.016, 8); colony(-0.9, 30, 4, 0.012, 9);
  { const q = skin(0.14, 24); hard.body.push(harpoon(q.p, [0.3, 0.8, -0.5], 0.1, [0.06, -0.1, -0.12])); }
  { const q = skin(-0.24, -28); hard.rear.push(harpoon(q.p, [-0.35, 0.8, -0.4], 0.085, [-0.06, -0.09, -0.1])); }

  // ---- the tusk ----
  const TL = 1.0, tb = [0, CY + 0.36, 0.9], td = [0.03, 0.46, 0.89];
  hard.head.push(
    aim(H.geo(tuskGeo(TL, 0.085)).shade((x, y, z) => { const a = Math.atan2(z, x), s = y / TL; return mix(Math.sin(a * 3 + s * 5 * PI * 2) < -0.35 ? ivoryDk : ivory, 0xfff8e6, s > 0.8 ? (s - 0.8) * 3 : 0); }).pbr(0.28), [tb[0], tb[1] - 0.05, tb[2] - 0.06], td),
  );
  prims.head.push(S.torus(0.1, 0.038).rot(62, 0, 0).at(tb[0], tb[1] + 0.01, tb[2] + 0.01).color(mix(hide, scar, 0.4)).pbr(0.6).bump(0.006, 30).blend(0.025));

  // ---- eye and mouth ----
  const mY = (z) => at(z).y - at(z).h * lerp(0.1, 0.34, clamp((z - NZ) / 0.5, 0, 1));
  const hingeZ = NZ + 0.05, slope = (mY(1.0) - mY(hingeZ)) * 0.25;
  prims.head.push(
    slab(1.3, mY(1.0) + slope, hingeZ, mY(hingeZ), -1, 0, 0.6).cut(0.008).color(mouth),
    S.ellipsoid(0.2, 0.09, 0.26).at(0, mY(0.8) + 0.01, 0.78).cut(0.03).color(tone(mouth, 0, 0, -0.08)),
    S.sphere(0.22).at(0, mY(hingeZ), hingeZ + 0.03).color(0x1a060a).paint(0.12, 0),
  );
  const eyeP = surf(headHull, [0.7, mY(0.6) + 0.085, 0.6], [-1, 0, 0]);
  prims.head.push(...S.mirrorX([
    S.ellipsoid(0.03, 0.04, 0.05).at(eyeP[0] + 0.004, eyeP[1], eyeP[2]).color(mix(hide, belly, 0.2)).pbr(0.6).blend(0.02),
    S.sphere(0.024).at(eyeP[0] + 0.01, eyeP[1], eyeP[2]).cut(0.006).color(0x0c0e12),
  ]));
  hard.head.push(...H.mirrorX([eye(0.021, { iris: 0xff8a2a, rim: 0x7a2a08, white: 0xffb04a, pupilDeg: 12, irisDeg: 56, rough: 0.12, glow: 0.5 }).rot(0, 84, 0).at(eyeP[0] - 0.003, eyeP[1], eyeP[2])]));
  const lipX = (z, dy) => surf(headHull, [0.7, mY(z) + dy, z], [-1, 0, 0])[0];
  const razor = (list, x, y, z, len, up, r, yaw, l) => list.push(spike(len, r, 0.12, 4, 0.36).rot(up > 0 ? 180 : 0, 0, 0).rot(0, yaw, 0).at(x, y, z).color(tooth).pbr(0.25).shade((xx, yy) => (yy < 0.18 ? 0xb8a888 : null)).lod(l));
  for (let i = 0; i < 12; i++) for (const sd of [-1, 1]) { const z = 0.56 + i * 0.038, len = 0.05 + rnd(i, sd + 3) * 0.02; razor(hard.head, sd * (lipX(z, 0.02) - 0.024), mY(z) + 0.008, z, len, 1, 0.017, 0, i % 2 ? 1 : 2); }
  for (let i = 0; i < 7; i++) { const a = (i - 3) / 3 * 62 * DEG; razor(hard.head, Math.sin(a) * 0.19, mY(1.0) + 0.012, 0.86 + Math.cos(a) * 0.14, 0.055, 1, 0.017, a / DEG + 90, i % 2 ? 1 : 2); }

  // ---- lower jaw ----
  const J = [0, mY(hingeZ), hingeZ];
  const jaw = [
    ...hull(span(TAB.map((q) => ({ ...q, w: q.w * 0.985 })), 1.0, NZ - 0.04), sk),
    under(1.2, bellyLine(1.0) + 0.03, NZ - 0.1, bellyLine(NZ), belly, 0.03, wet),
    slab(1.3, mY(1.0) + slope, NZ - 0.12, mY(hingeZ) - slope, 1, 0, 0.7).cut(0.008).color(mouth),
    S.box(1.1, 1.1, 0.3, 0.01).at(0, CY, NZ - 0.17).cut(0.01).color(mouth),
    S.ellipsoid(0.19, 0.035, 0.24).at(0, mY(0.8) - 0.012, 0.78).cut(0.03).color(tone(mouth, 0, 0, -0.06)),
    S.ellipsoid(0.11, 0.035, 0.18).at(0, mY(0.75) - 0.05, 0.75).color(0x8a3442).pbr(0.35).bump(0.004, 30).blend(0.02),
    S.sphere(0.22).at(0, mY(hingeZ), hingeZ + 0.03).color(0x1a060a).paint(0.12, 0),
  ];
  for (let k = -3; k <= 3; k++) { const a = skin(0.92 - Math.abs(k) * 0.03, 180 + k * 12), b = skin(NZ + 0.02, 180 + k * 11); jaw.push(S.capsule(a.p, b.p, 0.009, 0.013).color(groove).paint(0.006, -0.009)); }
  const jawHard = [];
  for (let i = 0; i < 11; i++) for (const sd of [-1, 1]) { const z = 0.58 + i * 0.038, len = 0.075 + rnd(i, sd + 13) * 0.03 + (i === 8 ? 0.04 : 0); razor(jawHard, sd * (lipX(z, -0.02) * 0.985 - 0.034), mY(z) - 0.01, z, len, -1, 0.021, 0, i % 2 ? 1 : 2); }
  for (let i = 0; i < 7; i++) { const a = (i - 3) / 3 * 60 * DEG; razor(jawHard, Math.sin(a) * 0.17, mY(1.0) - 0.008, 0.84 + Math.cos(a) * 0.13, 0.08 + (i === 3 ? 0 : 0.02), -1, 0.021, a / DEG + 90, i % 2 ? 1 : 2); }

  // ---- flippers and flukes ----
  const flipper = (sd) => [blade({ span: 0.6, chord: 0.24, tip: 0.45, sweep: 0.34, thick: 0.13, rows: 12, seg: 8, notch: sd > 0 ? [0.6, 0.1, 0.05] : null }).shade((x, y) => (x * sd > 0 ? mix(hide, belly, 0.5) : mix(back, pale, noise3(y * 14, x * 14, sd) > 0.6 ? 0.6 : 0))).pbr(wet + 0.05)];
  const FS = 0.56;
  for (const sd of [-1, 1]) hard.tail3.push(blade({ span: FS, chord: 0.36, tip: 0.18, sweep: 0.52, thick: 0.1, falcate: 0.5, rows: 13, notch: sd > 0 ? [0.45, 0.14, 0.05] : [0.75, 0.1, 0.04] }).shade((x, y, z) => mix(back, noise3(y * 12, z * 12, sd * 3) > 0.66 ? scar : 0x0c0f16, noise3(y * 12, z * 12, sd * 3) > 0.66 ? 0.5 : clamp(y / FS, 0, 1) * 0.5)).pbr(wet).rot(0, 0, -90 * sd).at(sd * 0.01, at(-1.27).y, -1.25));
  prims.tail3.push(sk(S.ellipsoid(0.1, 0.028, 0.075).at(0, at(-1.27).y, -1.27).blend(0.03), 'top'));
  hard.tail3.push(barnacle(0.014, [0.2, at(-1.27).y + 0.008, -1.3], [0, 1, 0]).lod(1), barnacle(0.011, [0.26, at(-1.27).y + 0.006, -1.34], [0, 1, 0]).lod(1), barnacle(0.012, [-0.3, at(-1.27).y + 0.006, -1.36], [0, 1, 0]).lod(1));
  for (let i = 0; i < 4; i++) hard[`tail${i}`].push(H.geo(coreGeo(at(TZ[i]).w, at(TZ[i + 1]).w, TZ[i] - TZ[i + 1], 0.7)).rot(0, 180, 0).at(0, at(TZ[i]).y, TZ[i]).color(hide).pbr(wet));

  // ---- spout ----
  const mp = (q) => q.color(MIST).pbr(1).glow(0.28), spoutHard = [H.cyl(0.04, 0.04, 0.012, 6).at(0, -0.06, 0).color(back).pbr(0.6)];
  const mist = mistPiece([
    mp(S.cone(0.014, 0.036, 0.3, 0.01).at(0, 0.15, -0.01)).bump(0.012, 26),
    mp(S.capsule([0, 0.28, -0.02], [0.03, 0.5, -0.1], 0.04, 0.07)).bump(0.026, 20).blend(0.04),
    mp(S.ellipsoid(0.1, 0.07, 0.09).at(0.02, 0.56, -0.16)).bump(0.026, 19).blend(0.05),
    mp(S.ellipsoid(0.06, 0.05, 0.06).at(-0.07, 0.5, -0.08)).bump(0.02, 23).blend(0.04),
    mp(S.sphere(0.03).at(0.12, 0.62, -0.2)).bump(0.012, 30).blend(0.02), mp(S.sphere(0.024).at(-0.1, 0.6, -0.22)).bump(0.012, 30).blend(0.02),
  ], 0x8fb2c8, 0xffffff, 0.6, 60);
  if (mist) spoutHard.push(mist.lod(1));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * PI * 2 + rnd(i, 61), out = 0.07 + rnd(i, 62) * 0.13, up = 0.44 + rnd(i, 63) * 0.24, bx = Math.cos(a) * out, bz = Math.sin(a) * out * 0.7 - 0.1;
    spoutHard.push(H.tube([[bx * 0.2, 0.24, bz * 0.2], [bx * 0.6, up * 0.8, bz * 0.6], [bx * 0.9, up, bz * 0.9], [bx * 1.15, up * 0.94, bz * 1.15]], [0.006, 0.0045, 0.003, 0.001], 8, 4).color(MIST).pbr(1).glow(0.28).lod(1));
    spoutHard.push(H.sphere(0.005 + rnd(i, 64) * 0.005, 6).at(bx * 1.25, up * 0.9, bz * 1.25).color(MIST).pbr(1).glow(0.28).lod(0));
  }

  const nodes = [
    ROOT,
    { name: 'body', parent: 'root', rig: 'body', pos: ORG.body, prims: into(ORG.body, prims.body), hard: into(ORG.body, hard.body), detail: 0.66 },
    { name: 'rear', parent: 'body', pos: [0, 0, 0], prims: into(ORG.body, prims.rear), hard: into(ORG.body, hard.rear), detail: 0.66 },
    { name: 'head', parent: 'body', rig: 'head', pos: sub(ORG.head, ORG.body), rot: [-4, 0, 0], prims: into(ORG.head, prims.head), hard: into(ORG.head, hard.head), detail: 0.74 },
    { name: 'jaw', parent: 'head', rig: 'jaw', pos: sub(J, ORG.head), rot: [12, 0, 0], prims: into(J, jaw), hard: into(J, jawHard), detail: 0.66 },
    { name: 'finL', parent: 'body', rig: 'fins', pos: sub([0.34, CY - 0.2, 0.34], ORG.body), rot: [-24, -12, -114], hard: flipper(1) },
    { name: 'finR', parent: 'body', rig: 'fins', pos: sub([-0.34, CY - 0.2, 0.34], ORG.body), rot: [-24, 12, 114], hard: flipper(-1) },
    { name: 'spout', parent: 'body', rig: 'core', pos: sub([0, topY(0.4) + 0.01, 0.4], ORG.body), rot: [-12, 0, 0], hard: spoutHard },
  ];
  for (let i = 0; i < 4; i++) nodes.push({ name: `tail${i}`, parent: i ? `tail${i - 1}` : 'body', rig: 'tail', pos: sub(ORG[`tail${i}`], i ? ORG[`tail${i - 1}`] : ORG.body), prims: into(ORG[`tail${i}`], prims[`tail${i}`]), hard: into(ORG[`tail${i}`], hard[`tail${i}`]), detail: 0.66 });
  return { kind: 'behemoth', nodes };
}
function animBehemoth(model, { t, phase }) {
  const rig = model.userData.rig, w = t * 1.3 + phase;
  // one long cycle: the horned head heaves up and lunges, the spout goes, then the flukes lift clear and slap down
  const c = frac(t * 0.1 + phase * 0.173), rise = pulse(c, 0.0, 0.36), lunge = pulse(c, 0.2, 0.42), blow = pulse(c, 0.36, 0.6), fluke = pulse(c, 0.58, 0.96), slap = pulse(c, 0.84, 0.98);
  R(rig.body, Math.sin(w * 0.5) * 0.015 - rise * 0.2 + lunge * 0.08 + fluke * 0.07, 0, Math.sin(w * 0.37) * 0.02);
  P(rig.body, 0, rise * 0.07 - fluke * 0.02, lunge * 0.12);
  R(rig.head, -rise * 0.12 + lunge * 0.1 + Math.sin(w * 0.5 + 1) * 0.012);
  R(rig.jaw, 0.0 + Math.sin(t * 0.8 + phase) * 0.04 + rise * 0.5 - lunge * 0.3);
  (rig.tail || []).forEach((n, i) => R(n, Math.sin(w - i * 0.62) * (0.06 + i * 0.04) * (1 - fluke) + fluke * (0.2 + i * 0.07) - slap * 0.16 - rise * 0.05, 0, 0));
  (rig.fins || []).forEach((n, i) => { const sg = i ? -1 : 1; R(n, Math.sin(w * 0.8 + i * 2.1) * 0.12, 0, sg * (Math.sin(w * 0.8 + i * 2.1 + 0.8) * 0.16 + rise * 0.3)); });
  if (rig.core) {
    rig.core.visible = blow > 0.02;
    rig.core.scale.set(0.5 + blow * 0.6, Math.max(0.02, Math.sin(Math.min(1, Math.max(0, c - 0.36) / 0.1) * PI * 0.5) * (0.4 + blow * 0.7)), 0.5 + blow * 0.6);
  }
}

const ALL = [
  ['triton', tritonDesc, animTriton],
  ['seaElemental', seaElementalDesc, animSeaElemental],
  ['seaDragon', seaDragonDesc, animSeaDragon],
  ['megalodon', megalodonDesc, animMegalodon],
  ['ironshell', ironshellDesc, animIronshell],
  ['abyssalMaw', abyssalMawDesc, animAbyssalMaw],
  ['coilSerpent', coilSerpentDesc, animCoilSerpent],
  ['behemoth', behemothDesc, animBehemoth],
];

// =====================================================================================
const creatures = {}, animators = {};
/** pieces flagged for the three nearest levels drop out of the farthest level instead, whatever the preset's level count */
function tidy(desc) {
  for (const n of desc.nodes) if (n.hard) for (const h of n.hard.flat(Infinity)) if (h && h.maxLod === 2) { h.maxLod = 99; h.span = 1; }
  return desc;
}
function reg(key, desc, anim, k = 1) {
  creatures[key] = (def) => {
    let d = def && typeof def === 'object' ? def : {};
    if (!(d.id || d.model) || !(d.size > 0) || (d.color != null && !Number.isFinite(+d.color))) d = { ...d, model: d.model || key, size: d.size > 0 ? +d.size : 1, color: Number.isFinite(+d.color) && d.color != null ? +d.color : undefined };
    return rigged(d, (dd) => tidy(desc(dd)), k);
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
