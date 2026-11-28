// The bow of a designed ship: rams, drills, jaws, blades, armour, ramps, bow guns and figureheads.
// Figureheads are lofted (necks, skulls, muzzles swept through rings) with horns, teeth, eyes and manes added on;
// parts that act (drill, jaws, blade, ramps, bow gun) are small meshes of their own and register action hooks
// (c.action(name, (k) => ...), k 0 -> 1, at rest at k = 1) and anchors (c.anchor(name, [x, y, z])).
import * as THREE from 'three';
import { Kit, G, C, shade, blend, clamp, lerp, hash, loftL, taper, sculptL, SB, SKH, S, H, noise3 } from './kit.js';
import { emblemOn } from './realmStyle.js';

const PI = Math.PI;
const f2 = (v) => v.toFixed(2);
const bump = (k) => Math.sin(PI * clamp(k, 0, 1));

/** where the stem is: x of the bow, deck height just behind it */
const stem = (c) => ({ x: c.bowX, y: Math.max(0.4, c.deckAt(c.bowX - c.L * 0.05)), hy: Math.max(0.35, c.dy * 0.55) });

// ---------------------------------------------------------------------------------
//  sculpting helpers (all in the kit's current frame)
// ---------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------
//  figureheads: SCULPTED (sculpt.js prims blended like clay, hard pieces for teeth, eyes, horns, feathers),
//  base at the origin, facing +x, about 1.6 tall; one sculpt per kind and realm colouring, shared by every ship
// ---------------------------------------------------------------------------------
const rgbOf = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const near = (a, b, e = 0.03) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < e * 3;
const mulRgb = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/** a carved bracket under every figure, tying it into the stem, with gilt scrolls and leaves */
function bracket(B, st) {
  const gilt = st.metal, cv = st.carve, gm = cv === gilt ? 0.85 : 0;
  SKH.limb(B, [[-0.4, -0.3, 0], [-0.14, -0.07, 0], [0.05, 0.08, 0], [0.12, 0.24, 0]], [0.17, 0.155, 0.125, 0.08], cv, { k: 0.05, r: 0.5, m: gm, bump: [0.004, 18, 'ridges'] });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) B.p(S.ellipsoid(0.12 - i * 0.02, 0.045, 0.03).rot(0, s * 10, 30 + i * 22).at(-0.26 + i * 0.12, -0.15 + i * 0.1, s * (0.14 - i * 0.012)).color(shade(cv, 0.92)).pbr(0.5, gm).blend(0.025));
    B.h(H.torus(0.075, 0.017, 22, 8, PI * 1.35).color(gilt).pbr(0.32, 0.85).rot(0, 0, -40).at(-0.16, -0.05, s * 0.15));
    B.h(H.sphere(0.022, 10).color(gilt).pbr(0.3, 0.85).at(-0.05, 0.0, s * 0.13));
  }
  B.h(H.torus(0.1, 0.022, 28, 8).color(gilt).pbr(0.32, 0.85).rot(90, 0, 0).scale(1, 1, 1).at(0.07, 0.14, 0));
}
/** an open mouth cut between the jaws: dark gullet, red tongue */
function maw(B, x0, x1, y, w, h) {
  B.p(S.capsule([x0, y, 0], [x1, y - h * 0.3, 0], h, h * 0.6).cut(0.015).color(0x3a0c0c));
  B.p(S.ellipsoid((x1 - x0) * 0.42, h * 0.35, w * 0.6).at((x0 + x1) / 2, y - h * 0.75, 0).color(0xa83a3a).pbr(0.35, 0).blend(0.01));
}

const FIGURES = new Set(['dragon', 'wolf', 'tiger', 'boar', 'cobra', 'horse', 'scarab', 'swan', 'eagle', 'skull', 'eye', 'frog', 'comet', 'fish', 'lion', 'ram', 'bull', 'owl', 'gargoyle', 'rat', 'face']);
function figureSculpt(kind, st, hullC, sideC) {
  const B = new SB(), gilt = st.metal, G_ = { r: 0.32, m: 0.85 };
  let paint = null;
  bracket(B, st);
  switch (kind) {
    case 'dragon': {
      const col = blend(gilt, st.id === 'tianlong' ? 0x2a9a5a : 0x3a7a4a, 0.55), belly = blend(gilt, 0xe8d8a0, 0.4);
      const P = [[0, 0, 0], [0.22, 0.4, 0], [0.12, 0.85, 0], [0.32, 1.22, 0], [0.55, 1.36, 0]], R = [0.135, 0.125, 0.105, 0.098, 0.09];
      SKH.limb(B, P, R, col, { k: 0.05, r: 0.45, m: 0.25, bump: [0.0045, 34, 'scales'] });
      // belly plates down the front of the neck
      for (let i = 0; i < P.length - 1; i++) B.p(S.capsule([P[i][0] + R[i] * 0.55, P[i][1], 0], [P[i + 1][0] + R[i + 1] * 0.55, P[i + 1][1], 0], R[i] * 0.62, R[i + 1] * 0.62).paint(0.008, 0.004).color(belly).bump(0.006, 9, 'ridges'));
      B.push([0.52, 1.38, 0], [0, 0, -9]);
      B.p(S.ellipsoid(0.15, 0.115, 0.13).at(0.04, 0.04, 0).color(col).pbr(0.45, 0.25).blend(0.05).bump(0.004, 34, 'scales'));
      B.p(S.capsule([0.08, 0.04, 0], [0.5, 0.01, 0], 0.095, 0.058).color(col).pbr(0.45, 0.25).blend(0.05));
      for (const s of [-1, 1]) {
        B.p(S.capsule([0.0, 0.12, s * 0.07], [0.24, 0.09, s * 0.05], 0.045, 0.022).color(shade(col, 0.85)).blend(0.03));
        B.p(S.sphere(0.022).at(0.53, 0.04, s * 0.03).cut(0.008).color(0x1a0a0a));
        B.p(S.ellipsoid(0.07, 0.03, 0.02).at(0.4, 0.07, s * 0.06).color(shade(col, 0.8)).blend(0.02)); // snout ridges
      }
      // the lower jaw, open
      B.push([0.08, -0.05, 0], [0, 0, -24]);
      B.p(S.capsule([0, 0, 0], [0.44, -0.01, 0], 0.07, 0.035).color(belly).pbr(0.5, 0.1).blend(0.03));
      B.p(S.ellipsoid(0.2, 0.025, 0.05).at(0.22, 0.045, 0).color(0xb04848).pbr(0.3, 0).blend(0.01));
      SKH.teeth(B, 0.12, 0.42, 0.05, 0.05, 0.05, 4, true);
      B.h(H.tube([[0.08, 0.05, 0], [0.32, 0.08, 0], [0.55, 0.04, 0], [0.66, 0.08, 0.03]], [0.025, 0.02, 0.012, 0.004], 18, 8).color(0xc83a3a).pbr(0.3, 0));
      B.pop();
      maw(B, 0.12, 0.48, -0.04, 0.07, 0.03);
      SKH.teeth(B, 0.16, 0.5, -0.05, 0.07, 0.055, 5, false);
      SKH.eyes(B, [0.2, 0.1, 0.095], 0.032, 0xffd23a, shade(col, 0.8), { glow: 1.6 });
      for (const s of [-1, 1]) {
        SKH.horn(B, [[0.0, 0.12, s * 0.08], [-0.22, 0.25, s * 0.14], [-0.42, 0.33, s * 0.16], [-0.6, 0.31, s * 0.13]], 0.05, C.bone, { rings: 9 });
        B.h(H.tube([[0.5, -0.01, s * 0.05], [0.62, -0.1, s * 0.2], [0.58, -0.28, s * 0.32], [0.66, -0.4, s * 0.36]], [0.014, 0.011, 0.007, 0.002], 20, 6).color(gilt).pbr(0.32, 0.85));
        SKH.fin(B, [[0, 0], [-0.18, 0.12], [-0.32, 0.06], [-0.24, -0.02], [-0.34, -0.12], [-0.12, -0.08]], 0.012, shade(col, 0.9), [-0.05, 0.02, s * 0.13], [0, s * 30, 15], { ribs: 5, edge: gilt, edgeAt: 0.26 });
      }
      B.pop();
      // dorsal spines down the neck, gilt
      [[0.02, 0.22], [0.1, 0.5], [0.04, 0.8], [0.16, 1.1], [0.34, 1.42]].forEach(([x, y], i) => B.h(H.cone(0.04, 0.2 - i * 0.014, 10).color(gilt).pbr(0.32, 0.85).rot(0, 0, 50).at(x - 0.11, y + 0.07, 0)));
      break;
    }
    case 'wolf': case 'tiger': case 'boar': {
      const col = kind === 'tiger' ? 0xd8842a : kind === 'boar' ? 0x5a3a2a : blend(gilt, 0x8a8a8a, 0.55);
      const belly = kind === 'tiger' ? 0xf0e8d8 : shade(col, 1.25), fur = kind === 'boar' ? 'fur' : 'fur';
      const furB = [0.007, 14, fur];
      SKH.limb(B, [[0, 0, 0], [0.15, 0.4, 0], [0.28, 0.75, 0], [0.42, 1.0, 0]], [0.18, 0.165, 0.15, 0.145], col, { k: 0.06, r: 0.75, bump: furB });
      if (kind === 'wolf') B.p(S.ellipsoid(0.26, 0.2, 0.3).at(0.26, 0.72, 0).rot(0, 0, -30).color(shade(col, 0.9)).blend(0.07).bump(0.016, 11, 'fur'));
      if (kind === 'boar') for (let i = 0; i < 8; i++) B.h(H.cone(0.035, 0.22 - i * 0.008, 6).color(0x1a1410).pbr(0.9, 0).rot(0, 0, 35).at(-0.13 + i * 0.075, 0.3 + i * 0.1, 0));
      if (kind === 'tiger') B.h(H.torus(0.18, 0.03, 30, 10).color(gilt).pbr(0.3, 0.85).rot(90, 0, 25).at(0.28, 0.74, 0));
      const sn = kind === 'boar' ? 0.46 : kind === 'wolf' ? 0.5 : 0.3;
      B.push([0.44, 1.06, 0], [0, 0, kind === 'boar' ? -16 : -6], 1.12);
      B.p(S.ellipsoid(0.2, 0.19, 0.19).at(-0.02, 0.06, 0).color(col).pbr(0.75, 0).blend(0.06).bump(furB[0], furB[1], 'fur'));
      for (const s of [-1, 1]) B.p(S.ellipsoid(0.08, 0.07, 0.06).at(0.06, -0.01, s * 0.1).color(kind === 'tiger' ? belly : col).blend(0.06).bump(0.005, 14, 'fur'));
      B.p(S.capsule([0.08, 0.02, 0], [0.16 + sn, -0.03, 0], 0.12, kind === 'boar' ? 0.1 : 0.062).color(col).pbr(0.7, 0).blend(0.07));
      for (const s of [-1, 1]) B.p(S.capsule([-0.02, 0.17, s * 0.075], [0.14, 0.12, s * 0.055], 0.05, 0.03).color(shade(col, 0.9)).blend(0.04)); // brows
      if (kind === 'boar') {
        B.p(S.cyl(0.1, 0.05, 0.01).rot(0, 0, 90).at(0.2 + sn, -0.04, 0).color(0x9a6060).blend(0.02));
        for (const s of [-1, 1]) B.p(S.sphere(0.026).at(0.235 + sn, -0.035, s * 0.035).cut(0.006).color(0x2a1010));
      } else {
        B.p(S.ellipsoid(0.05, 0.04, 0.06).at(0.17 + sn, 0.0, 0).color(0x121010).pbr(0.25, 0).blend(0.02));
        for (const s of [-1, 1]) B.p(S.sphere(0.015).at(0.205 + sn, -0.01, s * 0.025).cut(0.004));
      }
      B.push([0.08, -0.09, 0], [0, 0, -26]);
      B.p(S.capsule([0, 0, 0], [sn * 0.92, -0.02, 0], 0.075, 0.04).color(belly).pbr(0.75, 0).blend(0.03).bump(0.004, 14, 'fur'));
      B.p(S.ellipsoid(sn * 0.4, 0.02, 0.05).at(sn * 0.45, 0.04, 0).color(0xb04a52).pbr(0.3, 0).blend(0.01));
      SKH.teeth(B, sn * 0.3, sn * 0.88, 0.04, 0.055, 0.05, 3, true);
      B.pop();
      maw(B, 0.12, 0.12 + sn * 0.85, -0.06, 0.08, 0.035);
      SKH.teeth(B, 0.16 + sn * 0.3, 0.12 + sn * 0.88, -0.07, 0.07, 0.06, 3, false);
      SKH.eyes(B, [0.11, 0.12, 0.12], 0.034, kind === 'wolf' ? 0xffd23a : 0xff8a1a, shade(col, 0.85), { glow: 1.4 });
      for (const s of [-1, 1]) {
        if (kind === 'wolf') SKH.fin(B, [[0, 0], [0.09, 0.0], [0.02, 0.24]], 0.03, col, [-0.12, 0.2, s * 0.11], [s * -15, 0, 10], { ribs: 0, edge: shade(col, 0.6), edgeAt: 0.15 });
        if (kind === 'tiger') B.p(S.ellipsoid(0.05, 0.07, 0.03).at(-0.07, 0.22, s * 0.14).color(col).blend(0.03));
        if (kind === 'tiger') for (let w = 0; w < 3; w++) B.h(H.tube([[0.16 + sn * 0.7, -0.02, s * 0.07], [0.26 + sn, -0.01 + (w - 1) * 0.035, s * 0.22], [0.34 + sn, -0.03 + (w - 1) * 0.06, s * 0.32]], [0.004, 0.0015], 8, 4).color(0xf4f0e4).lod(1));
        if (kind === 'boar') {
          SKH.horn(B, [[0.16 + sn * 0.75, -0.08, s * 0.08], [0.24 + sn * 0.8, 0.02, s * 0.14], [0.26 + sn * 0.72, 0.16, s * 0.17], [0.18 + sn * 0.62, 0.24, s * 0.15]], 0.032, 0xf0e8d0, { rings: 0, tip: 0.85 });
          SKH.fin(B, [[0, 0], [0.08, 0.0], [0.03, 0.18]], 0.025, col, [-0.1, 0.2, s * 0.13], [s * -30, 0, 30], { ribs: 0 });
        }
      }
      B.pop();
      if (kind === 'tiger') {
        const cR = rgbOf(col), dk = rgbOf(0x1a1410);
        paint = (x, y, z, nx, ny, nz, c) => (near(c, cR, 0.12) && Math.sin(x * 26 + y * 9 + Math.abs(z) * 14 + Math.sin(y * 7) * 2) > 0.62 ? dk : null);
      }
      break;
    }
    case 'cobra': {
      const col = blend(gilt, 0x2a6a3a, 0.35), hood = blend(col, 0x1a3a7a, 0.3), belly = 0xe8d8a0;
      const P = [[-0.24, 0.05, 0.1], [0.2, 0.1, 0.14], [0.34, 0.42, 0], [0.14, 0.82, 0], [0.22, 1.14, 0]], R = [0.15, 0.15, 0.14, 0.13, 0.12];
      SKH.limb(B, P, R, col, { k: 0.05, r: 0.4, m: 0.2, bump: [0.004, 32, 'scales'] });
      for (let i = 0; i < P.length - 1; i++) B.p(S.capsule([P[i][0] + R[i] * 0.6, P[i][1], P[i][2]], [P[i + 1][0] + R[i + 1] * 0.6, P[i + 1][1], P[i + 1][2]], R[i] * 0.6, R[i + 1] * 0.6).paint(0.008, 0.004).color(belly).bump(0.006, 10, 'ridges'));
      // the hood: a broad thin shield flaring behind the head
      B.p(S.ellipsoid(0.07, 0.3, 0.34).at(0.22, 1.24, 0).rot(0, 0, -12).color(hood).pbr(0.4, 0.2).blend(0.06).bump(0.003, 30, 'scales'));
      for (const s of [-1, 1]) {
        B.p(S.ellipsoid(0.03, 0.06, 0.06).at(0.27, 1.27, s * 0.15).paint(0.01, 0.002).color(0xf0e4b0));
        B.p(S.sphere(0.028).at(0.28, 1.27, s * 0.15).paint(0.006, 0.002).color(0x101010));
      }
      B.push([0.32, 1.48, 0], [0, 0, -12]);
      B.p(S.ellipsoid(0.12, 0.07, 0.1).at(0.04, 0.0, 0).color(col).pbr(0.4, 0.2).blend(0.05).bump(0.003, 30, 'scales'));
      B.p(S.capsule([0.06, 0.0, 0], [0.22, -0.01, 0], 0.07, 0.04).color(col).blend(0.05));
      B.push([0.04, -0.04, 0], [0, 0, -30]);
      B.p(S.capsule([0, 0, 0], [0.2, 0, 0], 0.055, 0.03).color(0xd0c090).blend(0.03));
      B.p(S.ellipsoid(0.08, 0.015, 0.035).at(0.1, 0.035, 0).color(0xc85a6a).blend(0.01));
      B.pop();
      maw(B, 0.06, 0.2, -0.03, 0.05, 0.02);
      for (const s of [-1, 1]) B.h(H.cone(0.012, 0.09, 8).color(0xf4f0e0).pbr(0.3).rot(0, 0, 190).at(0.18, -0.07, s * 0.03));
      B.h(H.tube([[0.18, -0.04, 0], [0.32, -0.08, 0], [0.4, -0.05, 0.02], [0.42, -0.04, 0.04]], [0.008, 0.006, 0.004, 0.001], 12, 5).color(0xc82a2a));
      SKH.eyes(B, [0.1, 0.045, 0.072], 0.02, 0xff3a1a, shade(col, 0.85), { glow: 2 });
      B.pop();
      B.h(H.torus(0.15, 0.028, 30, 10).color(gilt).pbr(0.3, 0.85).rot(90, 0, 10).at(0.3, 0.44, 0));
      B.h(H.torus(0.13, 0.02, 30, 8).color(gilt).pbr(0.3, 0.85).rot(90, 0, 25).at(0.24, 0.72, 0));
      break;
    }
    case 'horse': {
      const col = blend(gilt, 0xf0ead8, 0.4), mane = sideC ?? st.cloth, gm = st.metalM * 0.6;
      SKH.limb(B, [[0, 0, 0], [0.04, 0.42, 0], [0.18, 0.82, 0], [0.4, 1.14, 0]], [0.16, 0.15, 0.13, 0.11], col, { k: 0.06, r: 0.45, m: gm });
      B.p(S.ellipsoid(0.22, 0.2, 0.17).at(0.1, 0.18, 0).color(col).pbr(0.45, gm).blend(0.08)); // chest
      B.push([0.44, 1.18, 0], [0, 0, -52]);
      B.p(S.ellipsoid(0.14, 0.12, 0.11).at(-0.02, 0.04, 0).color(col).pbr(0.45, gm).blend(0.06));
      B.p(S.capsule([0.04, 0.02, 0], [0.56, -0.04, 0], 0.11, 0.075).color(col).pbr(0.45, gm).blend(0.07));
      B.p(S.ellipsoid(0.07, 0.06, 0.07).at(0.58, -0.07, 0).color(col).blend(0.04));
      for (const s of [-1, 1]) {
        B.p(S.ellipsoid(0.1, 0.07, 0.04).at(0.08, -0.02, s * 0.08).color(col).blend(0.05)); // cheek
        B.p(S.sphere(0.018).at(0.64, -0.03, s * 0.035).cut(0.006).color(0x201010));
        SKH.fin(B, [[0, 0], [0.05, 0.0], [0.015, 0.16]], 0.025, col, [-0.08, 0.13, s * 0.06], [s * -10, 0, -30], { ribs: 0 });
        B.h(H.sphere(0.02, 10).color(gilt).pbr(0.3, 0.85).at(0.4, -0.03, s * 0.1));
      }
      B.p(S.capsule([0.62, -0.1, -0.03], [0.62, -0.1, 0.03], 0.012, 0.012).cut(0.006));
      SKH.eyes(B, [0.1, 0.06, 0.1], 0.026, 0x2a1a10, col, { glow: 0.2, round: true });
      // the bridle: a noseband, cheek straps and a gilt plume holder
      B.h(H.torus(0.1, 0.013, 28, 6).color(0x5a2418).pbr(0.6).rot(0, 90, 0).scale(1, 0.85, 1).at(0.4, -0.03, 0));
      for (const s of [-1, 1]) B.h(H.tube([[0.4, -0.03, s * 0.1], [0.2, 0.0, s * 0.11], [0.0, 0.05, s * 0.115]], 0.011, 10, 5).color(0x5a2418).pbr(0.6));
      B.h(H.cone(0.045, 0.3, 10).color(mane).pbr(0.85).rot(0, 0, 25).at(-0.1, 0.26, 0));
      B.pop();
      // the mane in locks along the crest
      for (let i = 0; i < 10; i++) { const t = i / 9; B.p(S.ellipsoid(0.04, 0.13, 0.05).rot(0, 0, 50 - t * 20).at(lerp(-0.1, 0.33, t), lerp(0.22, 1.28, t), (i % 2 ? 1 : -1) * 0.02).color(shade(mane, 0.85 + (i % 3) * 0.1)).pbr(0.85).blend(0.03).bump(0.006, 18, 'fur')); }
      // forelegs pawing the air, with gilt hooves
      for (const s of [-1, 1]) {
        SKH.limb(B, [[0.14, 0.24, s * 0.1], [0.34, 0.32, s * 0.12], [0.48, 0.16, s * 0.13]], [0.06, 0.045, 0.038], col, { k: 0.03, m: gm });
        B.h(H.cyl(0.04, 0.048, 0.07, 14).color(gilt).pbr(0.3, 0.85).rot(0, 0, 40).at(0.5, 0.12, s * 0.13));
      }
      break;
    }
    case 'scarab': {
      const shell = 0x1a4a5a;
      B.p(S.ellipsoid(0.48, 0.24, 0.42).at(0.05, 0.36, 0).color(shell).pbr(0.2, 0.7).blend(0.03));
      B.p(S.box(0.95, 0.06, 0.012, 0.004).at(0.05, 0.6, 0).cut(0.006).color(gilt));
      B.p(S.ellipsoid(0.16, 0.12, 0.22).at(0.52, 0.34, 0).color(shell).pbr(0.25, 0.7).blend(0.03)); // thorax
      B.p(S.ellipsoid(0.1, 0.08, 0.14).at(0.7, 0.32, 0).color(shell).pbr(0.25, 0.7).blend(0.03));
      for (let i = 0; i < 5; i++) B.h(H.cone(0.03, 0.08, 6).color(gilt).pbr(0.3, 0.85).rot(0, 0, -70).at(0.78, 0.33, (i - 2) * 0.045)); // the toothed clypeus
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) B.h(H.tube([[0.35 - i * 0.28, 0.26, s * 0.3], [0.42 - i * 0.33, 0.24, s * 0.55], [0.5 - i * 0.36, 0.02, s * 0.66]], [0.032, 0.022, 0.012], 14, 7).color(gilt).pbr(0.3, 0.85));
        B.h(H.sphere(0.035, 12).color(0x3affd8).glow(1.8).at(0.73, 0.36, s * 0.09));
        B.h(H.tube([[0.74, 0.3, s * 0.1], [0.9, 0.6, s * 0.15], [0.92, 0.94, s * 0.1]], [0.034, 0.025, 0.018], 14, 7).color(gilt).pbr(0.3, 0.85));
        for (let k = 0; k < 4; k++) B.h(H.torus(0.42 - k * 0.09, 0.007, 30, 5, PI * 0.6).color(gilt).pbr(0.3, 0.85).rot(90, 0, 0).rot(0, s > 0 ? -20 : 200, 0).at(0.05, 0.43 + k * 0.035, 0).lod(1));
      }
      // the sun-disc it rolls before it
      B.p(S.sphere(0.3).at(0.96, 1.2, 0).color(0xffb02a).pbr(0.3, 0.5).glow(1.2).bump(0.008, 12, 'noise'));
      B.h(H.torus(0.34, 0.03, 40, 10).color(gilt).pbr(0.3, 0.85).rot(0, 90, 0).at(0.96, 1.2, 0));
      for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; B.h(H.cone(0.035, 0.16, 8).color(gilt).pbr(0.3, 0.85).rot(-(a * 180) / PI + 90, 0, 0).at(0.96, 1.2 + Math.sin(a) * 0.44, Math.cos(a) * 0.44)); }
      const sR = rgbOf(shell), hi = rgbOf(blend(shell, 0x3aa8c8, 0.5));
      paint = (x, y, z, nx, ny, nz, c) => (near(c, sR, 0.08) && ny > 0.3 && Math.sin(Math.hypot(x - 0.05, z) * 30) > 0.7 ? hi : null);
      break;
    }
    case 'swan': {
      const w = 0xf4f0e8;
      SKH.limb(B, [[0, 0.1, 0], [0.3, 0.38, 0], [0.32, 0.74, 0], [0.12, 1.04, 0], [0.2, 1.34, 0], [0.38, 1.48, 0]], [0.2, 0.12, 0.09, 0.08, 0.075, 0.068], w, { k: 0.06, r: 0.55, bump: [0.003, 30, 'fur'] });
      B.p(S.ellipsoid(0.42, 0.26, 0.32).at(-0.08, 0.24, 0).color(w).pbr(0.6).blend(0.1).bump(0.006, 16, 'scales'));
      B.push([0.38, 1.5, 0], [0, 0, -14]);
      B.p(S.ellipsoid(0.1, 0.075, 0.075).at(0, 0, 0).color(w).blend(0.04));
      B.p(S.capsule([0.08, -0.01, 0], [0.3, -0.05, 0], 0.045, 0.014).color(0xe87a1a).pbr(0.35).blend(0.02));
      B.p(S.ellipsoid(0.04, 0.035, 0.03).at(0.1, 0.02, 0).color(0x121010).blend(0.015));
      SKH.eyes(B, [0.04, 0.02, 0.055], 0.013, 0x121010, null, { glow: 0, round: true });
      B.h(H.cyl(0.072, 0.072, 0.04, 20).color(gilt).pbr(0.3, 0.85).rot(90, 0, 0).at(-0.03, 0.05, 0));
      for (let i = 0; i < 5; i++) B.h(H.cone(0.012, 0.05, 6).color(gilt).pbr(0.3, 0.85).at(-0.03 + Math.cos((i / 5) * PI * 2) * 0.06, 0.09, Math.sin((i / 5) * PI * 2) * 0.06));
      B.pop();
      // two raised wings of layered feathers
      for (const s of [-1, 1]) {
        B.p(S.ellipsoid(0.3, 0.08, 0.1).rot(0, s * -20, 35).at(-0.15, 0.48, s * 0.3).color(w).blend(0.06).bump(0.006, 18, 'scales'));
        for (let row = 0; row < 3; row++) {
          const n = 8 - row * 2;
          for (let i = 0; i < n; i++) {
            const t = i / (n - 1), ang = 60 + t * 60 - row * 12;
            SKH.feather(B, 0.5 - row * 0.12 + Math.sin(t * PI) * 0.1, 0.12 - row * 0.015, row === 0 ? blend(w, gilt, 0.15) : w, [-0.08 - row * 0.07 - t * 0.3, 0.45 + row * 0.08 + t * 0.15, s * (0.32 + row * 0.04)], [s * 70, s * (-28 + row * 8), ang], { tip: row === 0 ? gilt : undefined });
          }
        }
      }
      break;
    }
    case 'eagle': {
      const wcol = blend(gilt, 0x6a4a2a, 0.35), white = 0xf4f0e8;
      SKH.limb(B, [[-0.1, 0.0, 0], [0.05, 0.35, 0], [0.22, 0.7, 0], [0.34, 0.95, 0]], [0.16, 0.21, 0.17, 0.12], wcol, { k: 0.07, r: 0.7, bump: [0.007, 16, 'scales'] });
      B.p(S.ellipsoid(0.15, 0.12, 0.13).at(0.33, 0.95, 0).paint(0.04).color(white));
      B.push([0.36, 1.02, 0], [0, 0, -10]);
      B.p(S.ellipsoid(0.15, 0.13, 0.13).at(0, 0.02, 0).color(white).pbr(0.7).blend(0.05).bump(0.004, 24, 'fur'));
      B.h(H.tube([[0.1, 0.03, 0], [0.24, 0.02, 0], [0.31, -0.04, 0], [0.3, -0.13, 0]], [0.06, 0.045, 0.025, 0.004], 20, 12).color(0xe8b02a).pbr(0.3, 0.2));
      B.p(S.capsule([0.1, -0.04, 0], [0.22, -0.06, 0], 0.04, 0.02).color(0xd8a02a).blend(0.02));
      for (const s of [-1, 1]) B.p(S.ellipsoid(0.07, 0.025, 0.035).rot(0, 0, -10).at(0.07, 0.09, s * 0.075).color(shade(white, 0.9)).blend(0.02));
      SKH.eyes(B, [0.08, 0.05, 0.085], 0.024, 0xffc21a, null, { glow: 1.2, round: true });
      B.pop();
      for (const s of [-1, 1]) {
        B.p(S.ellipsoid(0.36, 0.09, 0.12).rot(0, s * 20, 40).at(-0.1, 0.72, s * 0.24).color(wcol).blend(0.07).bump(0.006, 16, 'scales'));
        for (let row = 0; row < 3; row++) {
          const n = 9 - row * 2;
          for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            SKH.feather(B, 0.62 - row * 0.16 + Math.sin(t * PI) * 0.12, 0.13 - row * 0.02, row === 2 ? gilt : shade(wcol, 1 + row * 0.12), [0.0 - row * 0.1 - t * 0.42, 0.66 + row * 0.08 + t * 0.32, s * (0.28 + row * 0.02)], [s * 80, s * (-22 + row * 6), 95 + t * 50 - row * 10], { tip: row === 0 ? 0x2a1a10 : undefined });
          }
        }
        for (let k = 0; k < 3; k++) B.h(H.tube([[0.2, 0.06, s * 0.1 + (k - 1) * 0.04], [0.34, 0.0, s * 0.12 + (k - 1) * 0.06], [0.38, -0.08, s * 0.12 + (k - 1) * 0.06]], [0.025, 0.015, 0.003], 12, 6).color(0x1a1410).pbr(0.3));
      }
      break;
    }
    case 'skull': {
      const bone = C.bone;
      B.p(S.ellipsoid(0.36, 0.34, 0.36).at(0.12, 0.96, 0).color(bone).pbr(0.75).bump(0.006, 10, 'rock'));
      B.p(S.ellipsoid(0.26, 0.2, 0.28).at(0.42, 0.62, 0).color(bone).blend(0.12).bump(0.005, 12, 'rock'));
      for (const s of [-1, 1]) {
        B.p(S.ellipsoid(0.1, 0.11, 0.1).at(0.58, 0.76, s * 0.16).cut(0.04).color(0x0a0806));
        B.p(S.ellipsoid(0.1, 0.06, 0.06).at(0.46, 0.6, s * 0.28).color(bone).blend(0.05)); // cheekbones
        B.h(H.sphere(0.04, 12).color(st.glow).glow(2.6).at(0.56, 0.76, s * 0.16));
        SKH.horn(B, [[0.12, 1.15, s * 0.26], [0.18, 1.42, s * 0.48], [0.06, 1.66, s * 0.62], [-0.14, 1.72, s * 0.56], [-0.26, 1.6, s * 0.48]], 0.085, shade(bone, 0.82), { rings: 14 });
      }
      B.p(S.cone(0.06, 0.0, 0.14).rot(0, 0, -100).at(0.66, 0.6, 0).cut(0.02).color(0x0a0806));
      B.push([0.36, 0.38, 0], [0, 0, -10]);
      B.p(S.capsule([0, 0, -0.2], [0.3, -0.02, 0], 0.055, 0.05).color(bone).blend(0.04));
      B.p(S.capsule([0, 0, 0.2], [0.3, -0.02, 0], 0.055, 0.05).color(bone).blend(0.04));
      B.pop();
      for (let i = 0; i < 8; i++) { const z = -0.16 + i * 0.045; B.h(H.box(0.045, 0.085, 0.04, 0.01).color(0xf0ead8).pbr(0.6).at(0.65, 0.47, z)); B.h(H.box(0.045, 0.075, 0.04, 0.01).color(0xf0ead8).pbr(0.6).at(0.63, 0.37, z)); }
      for (const s of [-1, 1]) { SKH.limb(B, [[0.0, 0.05, s * 0.42], [0.3, 0.24, 0], [0.62, 0.45, -s * 0.42]], [0.045, 0.04, 0.045], bone, { k: 0.01 }); for (const e of [[0.0, 0.05, s * 0.42], [0.62, 0.45, -s * 0.42]]) for (const d of [-1, 1]) B.p(S.sphere(0.05).at(e[0], e[1] + d * 0.035, e[2]).color(bone).blend(0.02)); }
      const bR = rgbOf(bone), cr = rgbOf(shade(bone, 0.55));
      paint = (x, y, z, nx, ny, nz, c) => (near(c, bR, 0.1) && Math.abs(Math.sin(z * 40 + Math.sin(y * 12) * 1.5)) < 0.05 && y > 0.9 ? cr : null);
      break;
    }
    case 'eye': {
      const flesh = blend(hullC, C.flesh, 0.6), iris = st.glow;
      SKH.limb(B, [[0, 0, 0], [0.18, 0.35, 0], [0.3, 0.7, 0]], [0.24, 0.2, 0.32], flesh, { k: 0.08, r: 0.45, bump: [0.012, 9, 'noise'] });
      B.p(S.sphere(0.58).at(0.45, 1.05, 0).color(flesh).pbr(0.45).blend(0.1).bump(0.01, 8, 'noise'));
      B.p(S.sphere(0.5).at(0.64, 1.05, 0).cut(0.02).color(0x5a1a1a));
      B.p(S.sphere(0.47).at(0.6, 1.05, 0).color(0xf4eedc).pbr(0.15).blend(0.02));
      B.p(S.sphere(0.25).at(0.92, 1.05, 0).paint(0.02, 0.01).color(iris).glow(1.8));
      B.p(S.ellipsoid(0.1, 0.16, 0.06).at(1.06, 1.05, 0).paint(0.012, 0.004).color(0x050505).glow(0));
      B.p(S.torus(0.45, 0.085).rot(0, 0, 90).at(0.74, 1.05, 0).color(flesh).blend(0.05).bump(0.01, 10, 'noise'));
      B.p(S.ellipsoid(0.16, 0.12, 0.42).at(0.74, 1.4, 0).color(flesh).blend(0.06).bump(0.008, 10, 'noise')); // the heavy upper lid
      for (let i = 0; i < 6; i++) { const a = -0.8 + i * 0.32; SKH.limb(B, [[0.3, 0.5, 0], [0.5 + Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.6], [0.8 + Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.85], [0.95, 0.06, Math.sin(a) * 0.95]], [0.07, 0.05, 0.03, 0.012], shade(flesh, 0.85), { k: 0.04, bump: [0.006, 14, 'ridges'] }); }
      for (let i = 0; i < 3; i++) B.h(H.sphere(0.05, 10).scale(1, 1.4, 1).color(C.slime).glow(1).pbr(0.1).at(0.95, 0.6 - i * 0.18, (i - 1) * 0.12));
      const wR = rgbOf(0xf4eedc), vein = rgbOf(0xb81a1a);
      paint = (x, y, z, nx, ny, nz, c) => (near(c, wR, 0.06) && Math.abs(Math.sin(Math.atan2(y - 1.05, z) * 9 + noise3(x * 6, y * 6, z * 6) * 3)) < 0.08 ? vein : null);
      break;
    }
    case 'frog': {
      const col = 0x5a8a3a, belly = 0xd8d08a;
      B.p(S.ellipsoid(0.55, 0.3, 0.55).at(0.1, 0.55, 0).color(col).pbr(0.3).bump(0.012, 10, 'scales'));
      B.p(S.ellipsoid(0.45, 0.2, 0.45).at(0.18, 0.4, 0).paint(0.06).color(belly));
      B.p(S.capsule([0.62, 0.5, -0.45], [0.62, 0.5, 0.45], 0.025, 0.025).rot(0, 0, 0).cut(0.01).color(0x2a1a1a));
      for (const s of [-1, 1]) {
        B.p(S.sphere(0.17).at(0.32, 0.86, s * 0.3).color(col).blend(0.06));
        B.h(H.sphere(0.13, 18).color(0xffd23a).glow(0.9).pbr(0.15).at(0.38, 0.9, s * 0.32));
        B.h(H.box(0.03, 0.13, 0.05, 0.01).color(0x0a0a0a).at(0.5, 0.91, s * 0.35));
        SKH.limb(B, [[0.3, 0.45, s * 0.4], [0.52, 0.25, s * 0.55], [0.6, 0.02, s * 0.5]], [0.08, 0.06, 0.04], col, { k: 0.03 });
        for (let k = 0; k < 3; k++) B.p(S.sphere(0.04).at(0.64 + k * 0.04, 0.02, s * (0.42 + k * 0.08)).color(col).blend(0.02));
        SKH.limb(B, [[-0.3, 0.45, s * 0.45], [-0.15, 0.2, s * 0.7], [0.15, 0.08, s * 0.72]], [0.12, 0.08, 0.05], col, { k: 0.05, bump: [0.008, 10, 'scales'] });
      }
      B.h(H.tube([[0.66, 0.46, 0], [0.9, 0.4, 0], [1.1, 0.5, 0.05]], [0.04, 0.032, 0.028], 16, 10).color(0xd85a6a).pbr(0.25));
      B.h(H.sphere(0.065, 14).color(0xd85a6a).pbr(0.25).at(1.12, 0.5, 0.05));
      for (let i = 0; i < 7; i++) B.h(H.sphere(0.05, 10).color(C.slime).glow(0.5).pbr(0.15).at(0.0 + (i % 3) * 0.14, 0.82, -0.3 + i * 0.1));
      const gR = rgbOf(col), dk = rgbOf(0x2a4a1a);
      paint = (x, y, z, nx, ny, nz, c) => (near(c, gR, 0.12) && ny > 0 && noise3(x * 9, y * 9, z * 9) > 0.68 ? dk : null);
      break;
    }
    case 'comet': {
      SKH.limb(B, [[0, 0, 0], [0.2, 0.5, 0], [0.38, 0.95, 0]], [0.1, 0.075, 0.06], gilt, { k: 0.03, r: 0.3, m: 0.85, bump: [0.004, 12, 'ridges'] });
      B.p(S.sphere(0.34).at(0.42, 1.2, 0).color(0xffc040).glow(1.3).pbr(0.3).bump(0.025, 7, 'rock'));
      for (let i = 0; i < 6; i++) {
        const a = (i - 2.5) * 0.24, len = 1.4 + (i % 2) * 0.4;
        SKH.limb(B, [[0.3, 1.2 + a * 0.2, a * 0.2], [-0.3, 1.25 + a * 0.6, a * 0.7], [-0.6 - len * 0.3, 1.3 + a, a * 1.1]], [0.15, 0.08, 0.01], i % 2 ? 0xe8902a : 0xf0c050, { k: 0.08, glow: 0.8, r: 0.4 });
      }
      for (let i = 0; i < 7; i++) B.h(H.sphere(0.05, 8).scale(1, 1.8, 1).color(0xfff0c0).glow(2).at(-0.3 - hash(i) * 1.0, 1.1 + (hash(i + 5) - 0.5) * 0.8, (hash(i + 9) - 0.5) * 0.8));
      break;
    }
    case 'fish': {
      const col = blend(gilt, 0x3a8aaa, 0.45), belly = 0xe8e8d8;
      B.push([0.15, 0.75, 0], [0, 0, 34]);
      B.p(S.ellipsoid(0.5, 0.33, 0.19).at(-0.05, 0, 0).color(col).pbr(0.3, 0.55).bump(0.004, 26, 'scales'));
      B.p(S.capsule([-0.4, 0, 0], [-0.72, 0, 0], 0.13, 0.035).color(col).pbr(0.3, 0.55).blend(0.08).bump(0.003, 26, 'scales'));
      B.p(S.ellipsoid(0.42, 0.18, 0.16).at(0.0, -0.16, 0).paint(0.05).color(belly));
      B.p(S.ellipsoid(0.08, 0.06, 0.06).at(0.45, -0.04, 0).cut(0.02).color(0x5a1a1a));
      SKH.eyes(B, [0.32, 0.06, 0.12], 0.04, 0xf0f0f0, null, { glow: 0.2, round: true });
      SKH.fin(B, [[0, 0], [-0.5, 0.45], [-0.38, 0.05], [-0.38, -0.05], [-0.5, -0.45]], 0.025, gilt, [-0.7, 0, 0], [0, 0, 0], { m: 0.85, r: 0.3, ribs: 9 });
      SKH.fin(B, [[0.3, 0], [-0.1, 0.32], [-0.38, 0.28], [-0.3, 0]], 0.02, gilt, [0.05, 0.28, 0], [0, 0, 0], { m: 0.85, r: 0.3, ribs: 8 });
      for (const s of [-1, 1]) SKH.fin(B, [[0, 0], [-0.3, 0.12], [-0.25, -0.1]], 0.015, gilt, [0.25, -0.12, s * 0.16], [0, s * 30, 0], { m: 0.85, r: 0.3, ribs: 5 });
      B.h(H.torus(0.05, 0.014, 18, 6).color(0x8a3a3a).rot(0, 90, 0).at(0.5, -0.04, 0));
      B.pop();
      SKH.limb(B, [[-0.34, 0.02, 0], [0.0, 0.32, 0], [0.25, 0.3, 0], [0.32, 0.14, 0]], [0.17, 0.13, 0.08, 0.03], blend(gilt, 0x6ac8e8, 0.6), { k: 0.06, r: 0.25, bump: [0.012, 9, 'noise'] });
      for (let i = 0; i < 4; i++) B.p(S.sphere(0.06 - i * 0.01).at(0.3 + i * 0.04, 0.12 - i * 0.04, (i - 1.5) * 0.06).color(0xf4fbff).blend(0.03));
      const fR = rgbOf(col), stripe = rgbOf(shade(col, 0.72));
      paint = (x, y, z, nx, ny, nz, c) => (near(c, fR, 0.1) && Math.sin(x * 30 + y * 18) > 0.75 ? stripe : null);
      break;
    }
    case 'lion': {
      const col = blend(gilt, 0xc89a4a, 0.4), mane = shade(col, 0.72);
      SKH.limb(B, [[0, 0, 0], [0.12, 0.42, 0], [0.26, 0.8, 0], [0.38, 1.02, 0]], [0.17, 0.16, 0.15, 0.14], col, { k: 0.06, r: 0.5, m: st.metalM * 0.8, bump: [0.006, 14, 'fur'] });
      // the mane: locks radiating round the head and down the neck
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * PI * 2, ring = i % 2 ? 0.27 : 0.22;
        B.p(S.capsule([0.34, 1.06, 0], [0.26 + Math.cos(a) * 0.02, 1.06 + Math.sin(a) * ring, Math.cos(a) * ring], 0.07, 0.03).color(shade(mane, 0.9 + (i % 3) * 0.08)).pbr(0.6, st.metalM * 0.7).blend(0.04).bump(0.008, 18, 'fur'));
      }
      for (let i = 0; i < 6; i++) B.p(S.ellipsoid(0.06, 0.16, 0.08).rot(0, 0, 40).at(0.12 + i * 0.04, 0.4 + i * 0.1, (i % 2 ? 1 : -1) * 0.05).color(mane).pbr(0.6).blend(0.04).bump(0.008, 18, 'fur'));
      B.push([0.44, 1.06, 0], [0, 0, -8]);
      B.p(S.ellipsoid(0.17, 0.16, 0.16).color(col).pbr(0.5, st.metalM * 0.8).blend(0.05).bump(0.004, 16, 'fur'));
      B.p(S.capsule([0.08, -0.02, 0], [0.24, -0.05, 0], 0.1, 0.075).color(col).blend(0.05));
      B.p(S.ellipsoid(0.04, 0.03, 0.05).at(0.29, -0.01, 0).color(0x3a2418).pbr(0.4).blend(0.02));
      for (const s of [-1, 1]) { B.p(S.ellipsoid(0.07, 0.05, 0.05).at(0.2, -0.07, s * 0.055).color(col).blend(0.03)); B.p(S.ellipsoid(0.04, 0.05, 0.03).at(-0.05, 0.15, s * 0.12).color(col).blend(0.03)); }
      B.push([0.08, -0.1, 0], [0, 0, -20]);
      B.p(S.capsule([0, 0, 0], [0.2, -0.01, 0], 0.06, 0.04).color(col).blend(0.03));
      SKH.teeth(B, 0.1, 0.2, 0.04, 0.035, 0.04, 2, true);
      B.pop();
      maw(B, 0.12, 0.26, -0.09, 0.05, 0.025);
      SKH.teeth(B, 0.17, 0.26, -0.1, 0.04, 0.05, 2, false);
      SKH.eyes(B, [0.13, 0.05, 0.09], 0.025, 0xffb81a, shade(col, 0.8), { glow: 1.2 });
      B.pop();
      // a paw raised on the bracket
      SKH.limb(B, [[0.18, 0.4, 0.12], [0.36, 0.42, 0.14], [0.46, 0.3, 0.14]], [0.07, 0.055, 0.05], col, { k: 0.03 });
      for (let k = 0; k < 3; k++) B.h(H.cone(0.012, 0.05, 6).color(0xe8e0c8).rot(0, 0, -100).at(0.51, 0.29, 0.11 + k * 0.03));
      break;
    }
    case 'ram': case 'bull': {
      const bull = kind === 'bull', col = bull ? blend(gilt, 0x5a3a2a, 0.55) : blend(gilt, 0xe8e0d0, 0.5), hornC = bull ? 0xe8dcc0 : shade(gilt, 0.85);
      SKH.limb(B, [[0, 0, 0], [0.12, 0.42, 0], [0.26, 0.82, 0], [0.36, 1.0, 0]], bull ? [0.2, 0.2, 0.19, 0.17] : [0.16, 0.15, 0.13, 0.12], col, { k: 0.07, r: 0.55, m: st.metalM * 0.6, bump: [bull ? 0.004 : 0.012, bull ? 12 : 10, bull ? 'noise' : 'rock'] });
      B.push([0.42, 1.04, 0], [0, 0, bull ? -18 : -40]);
      B.p(S.ellipsoid(0.2, 0.17, 0.17).color(col).pbr(0.55, st.metalM * 0.6).blend(0.05).bump(bull ? 0.004 : 0.01, 10, bull ? 'noise' : 'rock'));
      B.p(S.capsule([0.08, -0.02, 0], [0.3, -0.06, 0], bull ? 0.14 : 0.1, bull ? 0.11 : 0.06).color(col).blend(0.06));
      for (const s of [-1, 1]) {
        B.p(S.sphere(0.022).at(bull ? 0.4 : 0.35, -0.06, s * 0.045).cut(0.006).color(0x1a0a0a));
        if (bull) SKH.horn(B, [[0.0, 0.12, s * 0.14], [0.02, 0.16, s * 0.32], [0.16, 0.3, s * 0.42], [0.3, 0.38, s * 0.36]], 0.055, hornC, { rings: 6, tip: 0.7 });
        else { const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12, a = t * 5.2, r = 0.17 * (1 - t * 0.5); pts.push([-0.02 + Math.cos(a) * r - 0.05, 0.12 + Math.sin(a) * r, s * (0.15 + t * 0.14)]); } SKH.horn(B, pts, 0.06, hornC, { rings: 18, tip: 0.8 }); }
        SKH.fin(B, [[0, 0], [0.07, 0.0], [0.02, -0.1]], 0.02, col, [-0.02, 0.0, s * 0.17], [s * 30, 0, -20], { ribs: 0 });
      }
      SKH.eyes(B, [0.12, 0.06, 0.13], 0.024, bull ? 0xff6a1a : 0xffd23a, shade(col, 0.85), { glow: bull ? 1.6 : 0.8 });
      if (bull) B.h(H.torus(0.05, 0.01, 18, 6).color(gilt).pbr(0.3, 0.85).rot(0, 90, 0).at(0.42, -0.14, 0));
      B.pop();
      break;
    }
    case 'owl': {
      const col = blend(gilt, 0x8a6a4a, 0.45), face = blend(gilt, 0xe8dcc0, 0.5);
      B.p(S.ellipsoid(0.32, 0.46, 0.3).at(0.08, 0.6, 0).color(col).pbr(0.6, st.metalM * 0.5).blend(0.08).bump(0.008, 16, 'scales'));
      B.p(S.ellipsoid(0.2, 0.34, 0.22).at(0.22, 0.52, 0).paint(0.03).color(face));
      B.push([0.14, 1.12, 0]);
      B.p(S.ellipsoid(0.22, 0.2, 0.24).color(col).pbr(0.6).blend(0.06).bump(0.006, 18, 'scales'));
      for (const s of [-1, 1]) {
        B.p(S.ellipsoid(0.06, 0.13, 0.12).at(0.16, 0.0, s * 0.1).color(face).blend(0.04)); // the facial discs
        B.h(H.sphere(0.06, 18).color(0xffb81a).glow(1.2).pbr(0.15).at(0.2, 0.01, s * 0.1));
        B.h(H.sphere(0.03, 12).color(0x0a0806).at(0.25, 0.01, s * 0.1));
        B.p(S.cone(0.04, 0.0, 0.14).rot(s * 20, 0, -10).at(0.0, 0.2, s * 0.12).color(col).blend(0.02)); // ear tufts
      }
      B.h(H.cone(0.03, 0.1, 8).color(0x3a3020).pbr(0.3).rot(0, 0, -150).at(0.24, -0.06, 0));
      B.pop();
      for (const s of [-1, 1]) {
        B.p(S.ellipsoid(0.3, 0.1, 0.12).rot(0, s * 10, -60).at(-0.05, 0.62, s * 0.26).color(shade(col, 0.9)).blend(0.05).bump(0.006, 16, 'scales'));
        for (let i = 0; i < 6; i++) SKH.feather(B, 0.32 + i * 0.02, 0.08, i % 2 ? col : shade(col, 1.12), [-0.05 - i * 0.03, 0.7 - i * 0.07, s * (0.3 - i * 0.01)], [s * 80, 0, -110 - i * 6], {});
        for (let k = 0; k < 3; k++) B.h(H.tube([[0.2, 0.16, s * 0.08 + (k - 1) * 0.04], [0.3, 0.12, s * 0.09 + (k - 1) * 0.05], [0.33, 0.04, s * 0.09 + (k - 1) * 0.05]], [0.02, 0.012, 0.003], 10, 6).color(0x1a1410).pbr(0.3));
      }
      break;
    }
    case 'gargoyle': {
      const col = 0x7a7670, dk = shade(col, 0.7), R = [0.008, 9, 'rock'];
      SKH.limb(B, [[0, 0.1, 0], [0.1, 0.45, 0], [0.22, 0.75, 0]], [0.2, 0.22, 0.18], col, { k: 0.07, r: 0.8, bump: R });
      B.push([0.32, 0.98, 0], [0, 0, -14]);
      B.p(S.ellipsoid(0.17, 0.15, 0.16).color(col).pbr(0.8).blend(0.05).bump(...R));
      B.p(S.capsule([0.06, -0.04, 0], [0.24, -0.08, 0], 0.11, 0.08).color(col).blend(0.05).bump(...R));
      for (const s of [-1, 1]) {
        B.p(S.capsule([0.0, 0.1, s * 0.07], [0.16, 0.06, s * 0.06], 0.05, 0.03).color(dk).blend(0.03)); // the heavy brow
        SKH.horn(B, [[-0.02, 0.12, s * 0.09], [-0.12, 0.26, s * 0.14], [-0.28, 0.32, s * 0.12], [-0.4, 0.26, s * 0.1]], 0.045, shade(col, 0.6), { rings: 7 });
        SKH.fin(B, [[0, 0], [0.12, 0.02], [0.04, 0.12]], 0.02, col, [-0.06, 0.06, s * 0.15], [s * -20, 0, 20], { ribs: 0 });
      }
      maw(B, 0.08, 0.28, -0.12, 0.07, 0.03);
      SKH.teeth(B, 0.12, 0.28, -0.12, 0.06, 0.05, 3, false, 0xd8d0c0);
      SKH.teeth(B, 0.14, 0.26, -0.17, 0.05, 0.04, 3, true, 0xd8d0c0);
      SKH.eyes(B, [0.13, 0.05, 0.085], 0.025, st.glow, dk, { glow: 2 });
      B.pop();
      // crouched arms gripping the bracket, and stone bat wings folded back
      for (const s of [-1, 1]) {
        SKH.limb(B, [[0.22, 0.75, s * 0.16], [0.36, 0.5, s * 0.22], [0.42, 0.25, s * 0.16]], [0.07, 0.055, 0.045], col, { k: 0.03, bump: R });
        for (let k = 0; k < 3; k++) B.h(H.cone(0.014, 0.07, 6).color(0x2a2622).rot(0, 0, -150).at(0.46, 0.22, s * (0.12 + k * 0.035)));
        SKH.fin(B, [[0, 0], [-0.5, 0.35], [-0.45, 0.12], [-0.6, 0.06], [-0.42, -0.05], [-0.5, -0.2], [-0.15, -0.1]], 0.025, shade(col, 0.9), [0.0, 0.85, s * 0.2], [s * 70, s * -10, 25], { ribs: 5, edge: dk, edgeAt: 0.45 });
      }
      break;
    }
    case 'rat': {
      const col = 0x6a5a48, pink = 0xc88a80;
      SKH.limb(B, [[0, 0.0, 0], [0.12, 0.38, 0], [0.3, 0.7, 0], [0.4, 0.86, 0]], [0.18, 0.17, 0.13, 0.1], col, { k: 0.06, r: 0.85, bump: [0.008, 18, 'fur'] });
      B.push([0.44, 0.9, 0], [0, 0, -22]);
      B.p(S.ellipsoid(0.14, 0.12, 0.12).color(col).pbr(0.85).blend(0.05).bump(0.006, 18, 'fur'));
      B.p(S.capsule([0.06, -0.02, 0], [0.32, -0.06, 0], 0.09, 0.03).color(col).blend(0.05).bump(0.004, 20, 'fur'));
      B.p(S.sphere(0.025).at(0.34, -0.06, 0).color(pink).blend(0.01));
      for (const s of [-1, 1]) {
        B.p(S.ellipsoid(0.03, 0.09, 0.08).rot(s * 20, 0, -20).at(-0.02, 0.12, s * 0.1).color(pink).pbr(0.5).blend(0.02));
        for (let w = 0; w < 3; w++) B.h(H.tube([[0.28, -0.05, s * 0.03], [0.36, -0.04 + (w - 1) * 0.02, s * 0.12], [0.42, -0.06 + (w - 1) * 0.04, s * 0.18]], [0.003, 0.001], 8, 4).color(0x1a1410).lod(1));
      }
      B.h(H.box(0.02, 0.05, 0.016, 0.004).color(0xe8c84a).pbr(0.4).at(0.3, -0.11, 0.01)); B.h(H.box(0.02, 0.05, 0.016, 0.004).color(0xe8c84a).pbr(0.4).at(0.3, -0.11, -0.01));
      SKH.eyes(B, [0.12, 0.04, 0.07], 0.022, st.glow ?? 0xff3a1a, null, { glow: 2.2, round: true });
      B.pop();
      SKH.limb(B, [[-0.1, 0.05, 0], [-0.4, -0.05, 0.1], [-0.6, 0.08, 0.2], [-0.75, 0.0, 0.18]], [0.05, 0.035, 0.022, 0.006], pink, { k: 0.02, bump: [0.004, 30, 'ridges'] });
      for (const s of [-1, 1]) SKH.limb(B, [[0.3, 0.7, s * 0.1], [0.44, 0.55, s * 0.13], [0.5, 0.4, s * 0.1]], [0.04, 0.03, 0.025], pink, { k: 0.02 });
      break;
    }
    case 'face': {
      // a carved, bearded ancestor's face: a heavy brow, runes on the helm band, a beard in braids
      const col = blend(gilt, 0x8a7a6a, 0.35), beard = shade(col, 0.82);
      B.p(S.ellipsoid(0.2, 0.36, 0.3).at(0.05, 0.6, 0).color(col).pbr(0.5, st.metalM * 0.7).blend(0.06));
      B.p(S.ellipsoid(0.26, 0.3, 0.33).at(0.0, 0.95, 0).color(col).pbr(0.5, st.metalM * 0.7).blend(0.06));
      B.p(S.capsule([0.24, 1.02, -0.2], [0.24, 1.02, 0.2], 0.06, 0.06).color(shade(col, 0.95)).blend(0.04)); // brow
      B.p(S.capsule([0.24, 0.98, 0], [0.33, 0.78, 0], 0.05, 0.07).color(col).blend(0.04)); // nose
      for (const s of [-1, 1]) {
        B.p(S.ellipsoid(0.03, 0.03, 0.06).at(0.25, 0.92, s * 0.11).cut(0.01).color(0x1a1410));
        B.h(H.sphere(0.022, 10).color(st.glow).glow(1.8).at(0.24, 0.92, s * 0.11));
        B.p(S.ellipsoid(0.12, 0.05, 0.1).rot(s * 20, 0, -20).at(0.28, 0.74, s * 0.1).color(beard).blend(0.03).bump(0.006, 18, 'fur')); // moustache
      }
      for (let i = 0; i < 5; i++) { const z = (i - 2) * 0.08; SKH.limb(B, [[0.22, 0.7, z], [0.3, 0.45, z * 1.1], [0.28, 0.18, z * 1.2]], [0.05, 0.045, 0.03], beard, { k: 0.03, bump: [0.006, 26, 'ridges'] }); B.h(H.torus(0.035, 0.01, 14, 6).color(gilt).pbr(0.3, 0.85).rot(90, 0, 0).at(0.29, 0.3, z * 1.15)); }
      B.p(S.torus(0.3, 0.05).rot(0, 0, 10).at(0.02, 1.12, 0).color(gilt).pbr(0.3, 0.85).blend(0.02)); // the helm band
      for (let i = 0; i < 5; i++) { const a = -0.6 + i * 0.3; B.p(S.box(0.05, 0.06, 0.02).rot(0, (a * 180) / PI - 90, 0).at(0.04 + Math.cos(a) * 0.33, 1.13, Math.sin(a) * 0.33).paint(0.004, -0.004).color(shade(gilt, 0.5))); }
      B.p(S.ellipsoid(0.27, 0.22, 0.3).at(-0.02, 1.2, 0).color(0x6a6a72).pbr(0.4, 0.8).blend(0.03)); // the helm
      break;
    }
    default: return null;
  }
  return { part: B.part(), paint };
}

/**
 * a figure for any prow (the airships' too): the sculpt as six per-level geometries, or null for an unknown kind.
 * st: { id, metal, carve, glow, cloth, metalM } (a realm style); hullC and side only matter to 'eye' and 'horse'.
 */
export function figureSculptGeo(kind, st, hullC = 0x6b4a2e, side = 0x3d7bd9, res = 72) {
  if (!FIGURES.has(kind)) return null;
  let paint = null;
  const key = `fig|${kind}|${st.id}|${st.metal}|${st.carve}|${st.glow}|${kind === 'eye' ? hullC : ''}|${kind === 'horse' ? side : ''}|${res}`;
  return sculptL(key, () => { const r = figureSculpt(kind, st, hullC, side); paint = r.paint; return r.part; }, { res, min: 12, paint: (...a) => (paint ? paint(...a) : null) });
}
/** the figure as a sculpted piece for a kit (null for an unknown kind) */
function figureGeo(kind, c) {
  const st = c.st, key = `fig|${kind}|${st.id}|${st.metal}|${st.carve}|${st.glow}|${kind === 'eye' ? c.hullC : ''}|${kind === 'horse' ? c.side : ''}`;
  if (!FIGURES.has(kind)) return null;
  let paint = null;
  return sculptL(key, () => { const r = figureSculpt(kind, st, c.hullC, c.side); paint = r.paint; return r.part; }, { res: 72, min: 14, paint: (...a) => (paint ? paint(...a) : null) });
}

// ---------------------------------------------------------------------------------
//  jaws: a beast's skull built around the bow; the lower jaw moves
// ---------------------------------------------------------------------------------
/** a beast's skull built around her stem (sculpted): brow ridges, horns, a fringe of teeth, glowing eyes; +x forward */
function jawUpper(K, len, w, col, tooth, glow) {
  const q = (v) => v.toFixed(1);
  K.add(sculptL(`jawup|${q(len)}|${q(w)}|${col}|${glow}`, () => {
    const B = new SB(), hide = (p, k = 0.08) => p.color(col).pbr(0.5).blend(k).bump(0.012, 7, 'scales');
    B.p(hide(S.ellipsoid(len * 0.42, len * 0.26, w * 0.5).at(len * 0.25, len * 0.12, 0), 0.12));
    B.p(hide(S.capsule([len * 0.3, len * 0.1, 0], [len * 0.95, len * 0.03, 0], len * 0.2, len * 0.08), 0.15));
    for (const s of [-1, 1]) {
      B.p(hide(S.capsule([len * 0.05, len * 0.3, s * w * 0.3], [len * 0.55, len * 0.2, s * w * 0.22], len * 0.09, len * 0.05), 0.06));
      B.p(S.sphere(len * 0.035).at(len * 0.97, len * 0.07, s * w * 0.06).cut(0.01).color(0x1a0a0a));
      for (let i = 0; i < 4; i++) B.p(S.cone(len * 0.035, 0, len * 0.12).rot(0, 0, -30).at(len * (0.2 + i * 0.16), len * (0.33 - i * 0.04), s * w * 0.12).color(shade(col, 0.72)).blend(0.02));
      SKH.horn(B, [[len * 0.12, len * 0.3, s * w * 0.32], [-len * 0.12, len * 0.55, s * w * 0.45], [-len * 0.35, len * 0.62, s * w * 0.42], [-len * 0.5, len * 0.5, s * w * 0.3]], len * 0.07, tooth, { rings: 10 });
    }
    B.p(S.ellipsoid(len * 0.42, len * 0.05, w * 0.36).at(len * 0.5, 0.0, 0).cut(0.03).color(0x4a0a0a));
    SKH.teeth(B, len * 0.12, len * 0.95, 0.0, w * 0.4, len * 0.13, Math.max(5, Math.round(len / 0.2)), false, tooth, w * 0.12);
    SKH.eyes(B, [len * 0.36, len * 0.24, w * 0.4], len * 0.06, glow, shade(col, 0.75), { glow: 2.2 });
    return B.part();
  }, { res: clamp(48 / len, 14, 40), min: 6 }), 0xffffff, 0, 0, 0);
}
function jawLower(K, len, w, col, tooth) {
  const q = (v) => v.toFixed(1);
  K.add(sculptL(`jawlo|${q(len)}|${q(w)}|${col}`, () => {
    const B = new SB();
    B.p(S.capsule([0, -0.05, 0], [len * 0.92, -0.01, 0], len * 0.16, len * 0.06).color(col).pbr(0.5).blend(0.1).bump(0.01, 7, 'scales'));
    for (const s of [-1, 1]) B.p(S.capsule([0, -0.06, s * w * 0.32], [len * 0.7, -0.03, s * w * 0.2], len * 0.08, len * 0.05).color(col).blend(0.12));
    B.p(S.ellipsoid(len * 0.4, len * 0.05, w * 0.3).at(len * 0.45, len * 0.1, 0).cut(0.03).color(0x5a0e0e));
    B.p(S.ellipsoid(len * 0.3, len * 0.03, w * 0.18).at(len * 0.45, len * 0.06, 0).color(0xa83a3a).pbr(0.3).blend(0.02));
    SKH.teeth(B, len * 0.12, len * 0.88, len * 0.08, w * 0.38, len * 0.11, Math.max(5, Math.round(len / 0.22)), true, tooth, w * 0.12);
    return B.part();
  }, { res: clamp(48 / len, 14, 40), min: 6 }), 0xffffff, 0, 0, 0);
}

// ---------------------------------------------------------------------------------
//  forged and cast pieces of the bow: SCULPTED like the figureheads (blended prims, hard rivets and edges), meshed
//  once per size bucket and realm colouring; each has a damaged twin that her setDamage swaps in (partDamage)
// ---------------------------------------------------------------------------------
const bkt = (v, s = 0.1) => Math.max(s, Math.round(v / s) * s);
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/**
 * a paint for sculpted metal and timber: verdigris blooms in bronze, rust streaks running down from iron, grime low
 * down, soot above sootY. o: { kind: 'iron' | 'bronze' | 'wood', amt, flow: 'y' | 'x' (the way rain runs), soot, sootY, char }
 */
export function weather(base, o = {}) {
  const b = rgbOf(base), kind = o.kind || 'iron', amt = o.amt ?? 1, flow = o.flow || 'y';
  const stain = rgbOf(kind === 'bronze' ? 0x3d8a6c : kind === 'wood' ? 0x2e2418 : 0x7a3816), soot = rgbOf(0x15110e), dark = rgbOf(0x2a1a10);
  const sootK = o.soot ?? 0, sootY = o.sootY ?? 1e9, charK = o.char ?? 0;
  return (x, y, z, nx, ny, nz, c) => {
    if (Math.abs(c[0] - b[0]) + Math.abs(c[1] - b[1]) + Math.abs(c[2] - b[2]) > 0.42) return null; // only the base surface
    const u = flow === 'x' ? y : x, v = flow === 'x' ? x : y;
    let out = c;
    const blot = noise3(x * 5.3 + 7, y * 5.3, z * 5.3);
    let t = kind === 'bronze' ? clamp((blot - 0.6) * 2.4, 0, 0.45) * (0.6 + 0.4 * Math.max(0, ny))
      : clamp((noise3(u * 11 + z * 7, v * 1.2, z * 3 + u) - 0.62) * 2.6, 0, 0.38) + clamp((blot - 0.72) * 1.6, 0, 0.2);
    t *= amt;
    if (t > 0.01) out = mixRgb(out, stain, t);
    if (kind !== 'bronze') { const g = clamp((noise3(x * 2, y * 2, z * 2) - 0.45) * 1.4, 0, 0.35) * amt; if (g > 0.01) out = mixRgb(out, dark, g * 0.6); }
    if (sootK && v > sootY) out = mixRgb(out, soot, clamp((v - sootY) * sootK * (0.7 + 0.5 * noise3(x * 6, y * 3, z * 6)), 0, 0.92));
    if (charK) { const n = noise3(x * 3 + 2, y * 3, z * 3); if (n > 0.55) out = mixRgb(out, soot, clamp((n - 0.55) * 4, 0, 0.9) * charK); }
    return out === c ? null : out;
  };
}
/** a domed rivet head (fine detail: drawn at the nearest two levels) */
const rivet = (B, x, y, z, r, col, m = 0.85) => B.h(H.sphere(r, 8).scale(1, 1, 1).color(col).pbr(0.42, m).at(x, y, z).lod(1));
/** a jagged tear cut into what is there: a chain of small cut blobs along pts */
function tear(B, pts, r, seed = 1) {
  for (let i = 0; i < pts.length - 1; i++) B.p(S.capsule(pts[i], pts[i + 1], r * (0.6 + hash(seed + i) * 0.7), r * (0.5 + hash(seed + i + 9) * 0.6)).cut(0.004));
}

// ---- the ram: a cast bronze beak, fluted, three cutting fins, a collar bolted to the stem ----
function ramGeo(l, r, col, ashur, bent) {
  return sculptL(`ram2|${f2(l)}|${f2(r)}|${col}|${ashur ? 1 : 0}|${bent ? 1 : 0}`, () => {
    const B = new SB(), dk = shade(col, 0.7);
    const M = (p, k = 0.05) => p.color(col).pbr(0.3, 0.85).blend(k).bump(0.0025, 28, 'noise');
    // the collar plate and its bolts
    B.p(M(S.cyl(r * 1.4, 0.14, 0.035).rot(0, 0, 90).at(0.0, 0, 0), 0.012));
    B.p(M(S.torus(r * 1.26, 0.045).rot(0, 0, 90).at(0.08, 0, 0), 0.015));
    for (let i = 0; i < 14; i++) { const a = (i / 14) * PI * 2; rivet(B, 0.08, Math.cos(a) * r * 1.14, Math.sin(a) * r * 1.14, 0.03, dk); }
    // the socket, with a cast moulding round it
    B.p(M(S.capsule([-0.04, 0, 0], [l * 0.38, 0, 0], r * 1.12, r * 0.9), 0.08));
    B.p(M(S.torus(r * 0.98, 0.04).rot(0, 0, 90).at(l * 0.25, 0, 0), 0.02));
    B.p(M(S.torus(r * 0.93, 0.03).rot(0, 0, 90).at(l * 0.33, 0, 0), 0.02));
    // the beak, bent askew from the socket when she has rammed home once too often
    B.push([l * 0.36, 0, 0], bent ? [10, 16, -22] : [0, 0, 0]);
    const lb = l * 0.64;
    B.p(M(S.capsule([0, 0, 0], [lb * 0.78, 0, 0], r * 0.9, r * 0.3), 0.07));
    B.p(M(S.capsule([lb * 0.78, 0, 0], [lb, 0, 0], r * 0.3, r * 0.05), 0.04));
    for (const yy of [-1, 0, 1]) {
      const hw = r * (yy ? 0.72 : 0.95);
      B.p(M(S.ellipsoid(lb * 0.42, 0.035 + r * 0.025, hw).at(lb * 0.48, yy * r * 0.48, 0), 0.015));
      B.p(M(S.capsule([lb * 0.12, yy * r * 0.52, 0], [lb * 0.98, yy * r * 0.16, 0], 0.035, 0.012), 0.02)); // the thickened leading edge
    }
    B.p(M(S.ellipsoid(lb * 0.42, r * 0.85, 0.04).at(lb * 0.56, 0, 0), 0.03)); // the upright cutting fin
    // flutes down the cheeks between the fins
    for (const a of [16, 164, 196, 344, 70, 110, 250, 290]) {
      const ca = Math.cos((a * PI) / 180), sa = Math.sin((a * PI) / 180);
      B.p(S.capsule([lb * 0.02, sa * r * 0.92, ca * r * 0.92], [lb * 0.74, sa * r * 0.36, ca * r * 0.36], 0.03, 0.015).cut(0.012));
    }
    if (bent) {
      // a split along the beak's side, the metal scorched and torn, a fin sheared off
      tear(B, [[lb * 0.04, r * 0.3, r * 0.92], [lb * 0.2, r * 0.1, r * 0.84], [lb * 0.32, r * 0.22, r * 0.7], [lb * 0.48, 0.0, r * 0.55]], 0.05, 3);
      B.p(S.sphere(r * 0.9).at(lb * 0.15, 0, r * 0.4).paint(0.06).color(0x2a2420));
      B.p(S.box(lb * 0.6, 0.2, r * 1.2).at(lb * 0.7, r * 0.5, r * 0.8).cut(0.01));
    }
    B.pop();
    if (bent) B.p(S.ellipsoid(r * 0.4, r * 0.7, r * 0.7).at(l * 0.36, 0, 0).paint(0.04).color(0x3a2e24)); // scorched where it buckled
    if (ashur) {
      // a bull's head cast on the socket, horns sweeping out
      B.push([0.2, r * 1.45, 0], [0, 0, -12]);
      B.p(M(S.ellipsoid(r * 0.62, r * 0.5, r * 0.52).at(0, 0, 0), 0.06).bump(0.006, 14, 'fur'));
      B.p(M(S.capsule([r * 0.2, -r * 0.08, 0], [r * 0.85, -r * 0.3, 0], r * 0.38, r * 0.3), 0.06));
      for (const s of [-1, 1]) {
        B.p(S.sphere(r * 0.07).at(r * 1.1, -r * 0.3, s * r * 0.13).cut(0.01));
        SKH.horn(B, [[0, r * 0.3, s * r * 0.35], [-r * 0.05, r * 0.5, s * r * 0.9], [r * 0.25, r * 0.95, s * r * 1.25], [r * 0.5, r * 1.25, s * r * 1.2]], r * 0.16, C.bone, { rings: 8 });
      }
      SKH.eyes(B, [r * 0.42, r * 0.12, r * 0.33], r * 0.07, 0xff6a1a, shade(col, 0.8), { glow: 1.8 });
      B.h(H.torus(r * 0.17, r * 0.03, 20, 8).color(C.gold).pbr(0.3, 0.85).rot(0, 90, 0).at(r * 1.18, -r * 0.5, 0));
      B.pop();
    }
    return B.part();
  }, { res: clamp(64 / Math.max(1, l), 26, 48), min: 8, paint: weather(col, { kind: 'bronze' }) });
}

// ---- the drill: a forged cone with a welded spiral flight, weld seams and rivet rings; it may snap ----
function drillGeo(len, r, snapped) {
  return sculptL(`drill2|${f2(len)}|${f2(r)}|${snapped ? 1 : 0}`, () => {
    const B = new SB(), col = C.steel, dk = 0x6a6e74;
    const cr = (t) => r * (1 - t * 0.96);
    B.p(S.cone(r, r * 0.04, len * 0.97, 0.02).at(0, len * 0.485, 0).color(col).pbr(0.34, 0.85).bump(0.003, 22, 'noise'));
    B.p(S.sphere(r * 0.05).at(0, len * 0.97, 0).color(shade(col, 1.15)).pbr(0.2, 0.9).blend(0.02));
    // the flight: a forged blade wound three and a half times round, bright at its edge
    const N = 60, turns = 3.5;
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * 0.93, a = t * PI * 2 * turns, rr = cr(t) * 0.98 + r * 0.04 * (1 - t);
      const p = [Math.cos(a) * rr, t * len, Math.sin(a) * rr];
      if (prev) B.p(S.capsule(prev[0], p, prev[1], r * 0.13 * (1 - t * 0.75)).color(shade(col, 1.18)).pbr(0.22, 0.9).blend(0.012));
      prev = [p, r * 0.13 * (1 - t * 0.75)];
    }
    // weld seams where the forged rings meet, beaded, each with a row of rivets
    for (const t of [0.12, 0.38, 0.64]) {
      const R = cr(t);
      B.p(S.torus(R * 1.0, Math.max(0.012, r * 0.03)).at(0, t * len, 0).color(dk).pbr(0.6, 0.7).blend(0.01).bump(0.004, 70, 'scales'));
      const n = Math.max(8, Math.min(26, Math.round((R * PI * 2) / 0.14)));
      for (let k = 0; k < n; k++) { const a = (k / n) * PI * 2 + t; rivet(B, Math.cos(a) * R * 0.985, t * len + len * 0.035, Math.sin(a) * R * 0.985, Math.max(0.018, r * 0.03), dk); }
    }
    // the root flange that bolts to her shaft
    B.p(S.cyl(r * 1.02, len * 0.05, 0.02).at(0, len * 0.025, 0).color(dk).pbr(0.45, 0.8).blend(0.01));
    for (let k = 0; k < 16; k++) { const a = (k / 16) * PI * 2; rivet(B, Math.cos(a) * r * 0.97, len * 0.055, Math.sin(a) * r * 0.97, Math.max(0.022, r * 0.035), 0x3a3a40); }
    if (snapped) {
      // snapped off half way: a jagged break, the flight torn loose and the stub scorched
      const y = len * 0.5;
      B.p(S.box(r * 4, len, r * 4).rot(9, 0, 7).at(0, y + len * 0.5, 0).cut(0.01));
      for (let k = 0; k < 6; k++) { const a = (k / 6) * PI * 2; B.p(S.box(r * 0.5, r * 0.6, r * 0.5).rot(30 + k * 20, k * 40, 45).at(Math.cos(a) * cr(0.5) * 0.7, y - r * 0.05 + hash(k) * r * 0.2, Math.sin(a) * cr(0.5) * 0.7).cut(0.008)); }
      B.p(S.sphere(cr(0.5) * 1.3).at(0, y, 0).paint(0.05).color(0x221c18));
    }
    return B.part();
  }, { res: clamp(48 / Math.max(r * 2, len * 0.5), 18, 40), min: 7, paint: weather(C.steel, { amt: 0.5 }) });
}
/** the collar, toothed gear ring and bolts that hold the drill, along +x (unit at r) */
function drillCollarGeo(r, trim) {
  return sculptL(`drillcollar|${f2(r)}|${trim}`, () => {
    const B = new SB(), iron = 0x4a4a52;
    B.p(S.cone(r * 0.92, r * 0.8, 0.5, 0.03).rot(0, 0, 90).at(-0.25, 0, 0).color(C.steel).pbr(0.4, 0.8).bump(0.003, 20, 'noise'));
    B.p(S.torus(r * 0.86, 0.07).rot(0, 0, 90).at(0, 0, 0).color(trim).pbr(0.3, 0.85).blend(0.02));
    const n = Math.round(r * 22);
    for (let i = 0; i < n; i++) { const a = (i / n) * PI * 2; B.p(S.box(0.09, 0.1, 0.07, 0.012).rot((a * 180) / PI, 0, 0).at(-0.08, Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97).color(iron).pbr(0.45, 0.8).blend(0.008)); }
    for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2 + 0.2; rivet(B, -0.42, Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, 0.03, iron); }
    B.p(S.torus(r * 0.82, 0.035).rot(0, 0, 90).at(-0.46, 0, 0).color(iron).pbr(0.45, 0.8).blend(0.01));
    return B.part();
  }, { res: clamp(40 / r, 24, 48), min: 8, paint: weather(C.steel, { amt: 0.7 }) });
}

// ---- the prow blade: a curved forged blade with a spine, a honed edge, riveted to the stem ----
function bladeGeo(l, h, metal) {
  return sculptL(`blade2|${f2(l)}|${f2(h)}|${metal}`, () => {
    const B = new SB(), steel = C.steel;
    const outline = [[0, 0], [l * 0.55, h * 0.1], [l, h * 0.55], [l * 0.75, h * 0.35], [l * 0.3, h * 0.5], [0, h * 0.75]];
    const hammer = (x, y) => { const n = noise3(x * 9, y * 9, 1.7); return n > 0.62 ? [0.42, 0.44, 0.47] : n < 0.3 ? [0.62, 0.65, 0.69] : null; };
    B.h(H.extrude(outline, 0.07, 0.022).color(steel).pbr(0.28, 0.85).shade(hammer));
    // the bright honed bevel along the cutting edge and the tip
    B.h(H.tube([[l * 0.5, h * 0.085, 0], [l * 0.78, h * 0.26, 0], [l * 0.99, h * 0.545, 0]], 0.028, 24, 8).scale(1, 1, 0.55).color(0xe8eef4).pbr(0.12, 0.95));
    // a forged spine down the blade's middle, and the bolster where it is socketed to her stem
    const spine = [[l * 0.08, h * 0.32], [l * 0.4, h * 0.3], [l * 0.65, h * 0.38], [l * 0.84, h * 0.47]];
    for (let i = 0; i < spine.length - 1; i++) for (const s of [-1, 1]) B.p(S.capsule([spine[i][0], spine[i][1], s * 0.04], [spine[i + 1][0], spine[i + 1][1], s * 0.04], 0.05 - i * 0.008, 0.042 - i * 0.008).color(shade(steel, 0.88)).pbr(0.3, 0.85).blend(0.02).bump(0.003, 30, 'noise'));
    for (const s of [-1, 1]) {
      B.p(S.ellipsoid(l * 0.16, h * 0.34, 0.05).at(l * 0.06, h * 0.36, s * 0.04).color(0x4a4a52).pbr(0.45, 0.8).blend(0.03).bump(0.004, 18, 'noise'));
      for (let i = 0; i < 5; i++) rivet(B, l * 0.04 + (i % 2) * l * 0.06, h * (0.14 + i * 0.12), s * 0.09, 0.03, metal);
      // an engraved line of gilt following the spine
      B.h(H.tube([[l * 0.2, h * 0.24, s * 0.037], [l * 0.5, h * 0.26, s * 0.037], [l * 0.76, h * 0.42, s * 0.037]], 0.009, 18, 5).color(metal).pbr(0.3, 0.85).lod(1));
    }
    return B.part();
  }, { res: clamp(64 / Math.max(l, h), 26, 48), min: 8 });
}
/** a scythe swept back along her flank (x back from 0 to -1 of len, y up to 0.18) */
function scytheGeo(len, w, metal) {
  return sculptL(`scythe|${f2(len)}|${f2(w)}|${metal}`, () => {
    const B = new SB(), pts = [[0, 0], [-len, w * 0.06], [-len * 0.7, w * 0.18], [-len * 0.1, w * 0.12]];
    B.h(H.extrude(pts, 0.05, 0.012).color(C.steel).pbr(0.28, 0.85).shade((x, y) => (noise3(x * 8, y * 8, 4) > 0.64 ? [0.42, 0.44, 0.47] : null)));
    B.h(H.tube([[-len * 0.05, -0.005, 0], [-len * 0.6, w * 0.02, 0], [-len * 0.99, w * 0.058, 0]], 0.018, 20, 6).scale(1, 1, 0.6).color(0xe8eef4).pbr(0.12, 0.95));
    for (const s of [-1, 1]) { B.p(S.ellipsoid(len * 0.08, w * 0.09, 0.035).at(-len * 0.06, w * 0.08, s * 0.025).color(0x4a4a52).pbr(0.45, 0.8)); for (let i = 0; i < 3; i++) rivet(B, -len * 0.03 - i * len * 0.04, w * 0.08, s * 0.05, 0.025, metal); }
    return B.part();
  }, { res: clamp(40 / len, 18, 44), min: 8 });
}

// ---- the glacis: overlapping riveted armour plates down the bow, weathered; cracked and holed when she is hurt ----
function glacisGeo(len, w, col, trim, cracked) {
  return sculptL(`glacis2|${f2(len)}|${f2(w)}|${col}|${trim}|${cracked ? 1 : 0}`, () => {
    const B = new SB(), nP = 4, pl = len / nP + 0.14;
    for (let i = 0; i < nP; i++) {
      const t = (i + 0.5) / nP, x = len * t, wi = w * (1 - t * 0.12), y = 0.05 - i * 0.004;
      // each plate lapped over the next one down, its lower lip rolled
      B.push([x, y, 0], [0, 0, -4 + (cracked && i === 1 ? -9 : 0)]);
      B.p(S.box(pl, 0.09, wi, 0.03).color(shade(col, 0.94 + (i % 2) * 0.1)).pbr(0.42, 0.8).blend(0.004).bump(0.003, 16, 'noise'));
      B.p(S.capsule([pl * 0.47, 0.0, -wi * 0.47], [pl * 0.47, 0.0, wi * 0.47], 0.05, 0.05).color(shade(col, 0.9)).pbr(0.42, 0.8).blend(0.01));
      B.p(S.box(pl * 0.9, 0.03, 0.12, 0.012).at(0, 0.055, 0).color(shade(col, 1.08)).pbr(0.4, 0.8).blend(0.01)); // the spine strap
      const nr = Math.max(5, Math.round(wi / 0.24));
      for (let k = 0; k < nr; k++) { const z = -wi * 0.44 + (wi * 0.88 * k) / (nr - 1); rivet(B, -pl * 0.4, 0.05, z, 0.035, trim); rivet(B, pl * 0.32, 0.05, z, 0.03, shade(col, 0.75)); }
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) rivet(B, -pl * 0.25 + k * pl * 0.25, 0.05, s * wi * 0.47, 0.03, shade(col, 0.75));
      if (cracked) {
        const sd = i % 2 ? 1 : -1;
        tear(B, [[-pl * 0.4, 0.06, sd * wi * 0.1], [-pl * 0.1, 0.06, sd * wi * 0.2], [pl * 0.05, 0.06, sd * wi * 0.14], [pl * 0.35, 0.06, sd * wi * 0.28]], 0.022, i * 5 + 1);
        if (i === 2) { B.p(S.sphere(0.2).at(0, 0.05, -sd * wi * 0.22).cut(0.02)); B.p(S.sphere(0.36).at(0, 0.05, -sd * wi * 0.22).paint(0.05).color(0x1a1512)); }
      }
      B.pop();
    }
    return B.part();
  }, { res: clamp(48 / Math.max(len, w * 0.6), 18, 36), min: 7, paint: weather(col, { flow: 'x', char: cracked ? 0.7 : 0 }) });
}

// ---- the bow gun: a cast barrel with reinforcing rings, muzzle swell, cascabel and trunnions; its carriage ----
function bowGunBarrelGeo(r, len, bronze, metal) {
  return sculptL(`bowgun2|${f2(r)}|${f2(len)}|${bronze}|${metal}`, () => {
    const B = new SB(), M = (p, k = 0.02) => p.color(bronze).pbr(0.3, 0.85).blend(k).bump(0.0015, 40, 'noise');
    B.p(M(S.cone(r * 1.55, r * 1.38, len * 0.24, 0.02).at(0, -len * 0.11, 0)));                 // the breech
    B.p(M(S.cone(r * 1.3, r * 1.08, len * 0.58, 0.01).at(0, len * 0.29, 0)));                  // the chase
    B.p(M(S.cone(r * 1.08, r * 1.3, len * 0.12, 0.01).at(0, len * 0.64, 0)));                  // the swell
    B.p(M(S.cyl(r * 1.38, len * 0.09, 0.02).at(0, len * 0.73, 0)));                            // the muzzle mouldings
    B.p(S.cyl(r * 0.62, len * 0.4, 0.01).at(0, len * 0.66, 0).cut(0.008).color(0x0e0c0a));     // the bore
    B.p(M(S.sphere(r * 0.42).at(0, -len * 0.3, 0), 0.04));                                     // the cascabel
    B.p(M(S.capsule([0, -len * 0.23, 0], [0, -len * 0.29, 0], r * 0.25, r * 0.2), 0.03));
    for (const y of [-0.21, 0.0, 0.26, 0.5, 0.69]) B.p(S.torus(r * (y < 0 ? 1.5 : y > 0.6 ? 1.24 : 1.28 - y * 0.25), r * 0.09).at(0, len * y, 0).color(metal).pbr(0.3, 0.85).blend(0.01));
    // engraved bands between the rings, trunnions, and lifting dolphins on top
    for (const y of [0.13, 0.38]) B.p(S.cyl(r * 1.35, len * 0.012).at(0, len * y, 0).paint(0.002, -0.004).color(shade(bronze, 0.6)));
    B.p(M(S.capsule([0, len * 0.08, -r * 1.7], [0, len * 0.08, r * 1.7], r * 0.3, r * 0.3), 0.02));
    for (const s of [-1, 1]) B.h(H.torus(r * 0.32, r * 0.08, 16, 8, PI).color(metal).pbr(0.3, 0.85).rot(0, 90, 90).at(s * r * 0.5, len * 0.15, 0).lod(1));
    return B.part();
  }, { res: clamp(20 / r, 40, 90), min: 9, paint: weather(bronze, { kind: bronze === C.bronze ? 'bronze' : 'iron', amt: 0.7, soot: 3, sootY: len * 0.68 }) });
}
function bowGunMountGeo(r, metal) {
  return sculptL(`bowgunmount|${f2(r)}|${metal}`, () => {
    const B = new SB(), iron = 0x3e3e46;
    B.p(S.cone(r * 3.3, r * 3.0, 0.3, 0.04).at(0, 0.15, 0).color(iron).pbr(0.45, 0.8).bump(0.003, 18, 'noise'));
    B.p(S.torus(r * 3.05, 0.04).at(0, 0.3, 0).color(metal).pbr(0.3, 0.85).blend(0.01));
    for (let i = 0; i < 16; i++) { const a = (i / 16) * PI * 2; rivet(B, Math.cos(a) * r * 2.7, 0.31, Math.sin(a) * r * 2.7, 0.035, 0x9aa2aa); }
    for (const s of [-1, 1]) {
      // the cheeks: stepped brackets with the trunnion seats cut in them
      B.p(S.box(r * 3.0, r * 1.6, 0.1, 0.025).at(-r * 0.2, 0.3 + r * 0.8, s * r * 1.55).color(iron).pbr(0.45, 0.8).blend(0.01));
      B.p(S.box(r * 1.6, r * 0.8, 0.1, 0.025).at(r * 0.4, 0.3 + r * 1.8, s * r * 1.55).color(iron).pbr(0.45, 0.8).blend(0.01));
      B.p(S.cyl(r * 0.36, 0.3).rot(90, 0, 0).at(r * 0.1, 0.3 + r * 2.2, s * r * 1.55).cut(0.005));
      B.p(S.torus(r * 0.42, 0.03).rot(90, 0, 0).at(r * 0.1, 0.3 + r * 2.2, s * r * 1.6).color(metal).pbr(0.3, 0.85));
      for (let k = 0; k < 4; k++) rivet(B, -r * 1.4 + k * r * 0.8, 0.3 + r * 0.35, s * r * 1.62, 0.028, metal);
    }
    B.p(S.box(r * 1.4, r * 0.5, r * 2.6, 0.03).rot(0, 0, 14).at(-r * 1.2, 0.3 + r * 0.6, 0).color(0x5a4028).pbr(0.85).blend(0.01).bump(0.004, 20, 'ridges')); // the quoin
    return B.part();
  }, { res: clamp(14 / r, 36, 70), min: 8, paint: weather(0x3e3e46, { amt: 0.8 }) });
}

/** show one of two meshes in their own groups (setLod drives mesh.visible, so the groups do the hiding) */
function twin(a, b) {
  const g = new THREE.Group(), ga = new THREE.Group(), gb = new THREE.Group();
  ga.add(a); gb.add(b); gb.visible = false; g.add(ga, gb);
  return { g, set: (second) => { ga.visible = !second; gb.visible = !!second; } };
}
const onDamage = (c, fn) => { (c.m.userData.partDamage ||= []).push(fn); };

export const BOW_PARTS = {
  figure(c, kind, scale = 1) {
    const s = stem(c), sc = clamp(c.B * 0.28, 0.7, 1.4) * scale;
    const geo = figureGeo(kind, c);
    if (!geo) return;
    // her figurehead is a mesh of its own: it can be shot away and thrown clear when she breaks up
    const K = new Kit();
    K.add(geo, 0xffffff, 0, 0, 0);
    const mesh = K.mesh(undefined, `figmesh|${kind}|${c.st.id}|${c.hullC}|${c.side}`);
    mesh.position.set(s.x - 0.2 * sc, s.y + 0.1, 0); mesh.rotation.z = -0.25; mesh.scale.setScalar(sc);
    mesh.name = 'figurehead';
    c.addMoving(mesh);
    (c.breakable ||= []).push({ mesh, kind: 'figure' });
    c.topAt = Math.max(c.topAt || 0, s.y + 2 * sc);
    c.anchor('bow', [s.x + 0.6 * sc, s.y + 1.2 * sc, 0], 'figure');
  },
  ram(c) {
    // a cast waterline ram: a fluted beak with three fins, a collar plate and the realm's device on its cheek; bent askew from 2
    const s = stem(c), l = bkt(clamp(c.L * 0.17, 1.2, 2.6), 0.2), r = bkt(clamp(c.B * 0.1, 0.22, 0.5), 0.04), st = c.st;
    const col = c.def.kind === 'dreadnought' || c.hullC < 0x404040 ? c.trimC : C.bronze, ashur = c.def.realm === 'ashur';
    const mk = (bent) => {
      const K = new Kit();
      K.add(ramGeo(l, r, col, ashur, bent), 0xffffff, 0, 0, 0);
      K.detail(2, () => { for (const z of [-1, 1]) { K.push(l * 0.2, r * 0.05, z * r * 1.0, 0, z > 0 ? 0 : PI, 0); emblemOn(K, st, r * 1.05, { col: [shade(col, 0.75), shade(col, 1.2)], depth: 0.05 }); K.pop(); } });
      return K.mesh(undefined, `ram2|${f2(l)}|${f2(r)}|${col}|${ashur}|${bent}|${st.id}`);
    };
    const y = Math.min(0.25, s.hy * 0.4), tw = twin(mk(false), mk(true));
    tw.g.position.set(s.x - 0.25, y, 0); tw.g.name = 'ram';
    c.addMoving(tw.g);
    onDamage(c, (lv) => tw.set(lv >= 2));
    c.anchor('bow', [s.x - 0.25 + l * 1.05, y, 0], 'ram');
  },
  drill(c) {
    const s = stem(c), len = bkt(clamp(c.L * 0.3, 2, 4.4), 0.2), r = bkt(clamp(c.B * 0.2, 0.5, 1.05), 0.05), y = Math.max(r * 0.8, s.hy);
    const one = (snap) => new Kit().add(drillGeo(len, r, snap), 0xffffff).mesh(undefined, `drill2|${f2(r)}|${f2(len)}|${snap}`);
    const tw = twin(one(false), one(true)), spin = tw.g;
    const pivot = new THREE.Group(); pivot.add(spin); spin.rotation.order = 'ZYX'; spin.rotation.z = -PI / 2; pivot.position.set(s.x + 0.1, y, 0);
    const act = { surge: 0, boost: 0, dead: false, rest: 0 };
    c.addMoving(pivot, (t) => { if (!act.dead) act.rest = t * 7; spin.rotation.y = act.rest + act.boost; pivot.position.x = s.x + 0.1 + act.surge; act.surge *= 0.85; });
    c.action('ram', (k) => { const b = bump(k); act.surge = b * len * 0.22; act.boost = 0.6 * b; spin.rotation.y = act.rest + act.boost; pivot.position.x = s.x + 0.1 + act.surge; if (k >= 1) { act.surge = 0; act.boost = 0; pivot.position.x = s.x + 0.1; } });
    onDamage(c, (lv) => { tw.set(lv >= 2); act.dead = lv >= 3; });
    // the collar, gear ring and boiler struts that hold her
    c.kit.add(drillCollarGeo(r, c.trimC), 0xffffff, s.x + 0.1, y, 0);
    for (const z of [-1, 1]) c.kit.add(taper(`drillstrut${f2(r)}${z}`, [[s.x - 0.1, y, z * r * 0.9], [s.x - c.L * 0.06, (y + s.y) / 2 + 0.1, z * r], [s.x - c.L * 0.12, s.y, z * c.hw(s.x - c.L * 0.12) * 0.7]], [0.09, 0.07], 8, 6), C.iron, 0, 0, 0, { m: 0.5 });
    c.anchor('bow', [s.x + 0.1 + len, y, 0], 'drill');
  },
  jaws(c) {
    const s = stem(c), len = clamp(c.L * 0.24, 1.6, 3.2), w = clamp(c.B * 0.62, 1.2, 2.6), hx = s.x - len * 0.35, hy = Math.max(0.5, s.hy);
    const col = blend(c.hullC, 0x6a2a2a, 0.3), tooth = C.bone;
    c.kit.push(hx, hy, 0, 0, 0, 0.18); jawUpper(c.kit, len, w, col, tooth, c.st.glow); c.kit.pop();
    const K = new Kit(); jawLower(K, len, w * 0.92, col, tooth);
    const lower = K.mesh(undefined, `jawlo${f2(len)}${f2(w)}${col}`); lower.position.set(hx, hy, 0);
    const act = { open: 0 };
    c.addMoving(lower, (t, ph) => { lower.rotation.z = -0.12 - 0.3 * Math.max(0, Math.sin(t * 1.3 + ph)) - act.open; act.open *= 0.85; });
    // grapple / ram: gape wide, then clamp shut hard
    const bite = (k) => { act.open = k < 0.55 ? (k / 0.55) * 0.55 : Math.max(-0.12, 0.55 - ((k - 0.55) / 0.2) * 0.67) * (1 - clamp((k - 0.85) / 0.15, 0, 1)); lower.rotation.z = -0.12 - act.open; if (k >= 1) act.open = 0; };
    c.action('grapple', bite); c.action('ram', bite);
    c.anchor('mouth', [hx + len * 0.7, hy, 0], 'jaws'); c.anchor('bow', [hx + len, hy, 0], 'jaws');
  },
  blade(c) {
    const s = stem(c), h = bkt(Math.max(1, s.y + 0.3), 0.1), l = bkt(clamp(c.L * 0.2, 1.4, 3), 0.1);
    c.kit.add(bladeGeo(l, h, c.st.metal), 0xffffff, s.x - l * 0.25, 0.05, 0);
    // the honed edge glows when she strikes
    const EK = new Kit();
    EK.add(taper(`bladeedge${f2(l)}${f2(h)}`, [[l * 0.55, h * 0.1, 0], [l * 0.85, h * 0.32, 0], [l, h * 0.55, 0], [l * 0.75, h * 0.35, 0]], [0.04, 0.05, 0.04, 0.02], 16, 5), 0xffffff);
    const edge = new THREE.Mesh(EK.build(), new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    edge.position.set(s.x - l * 0.25, 0.05, 0); edge.visible = false;
    c.addMoving(edge);
    c.action('ram', (k) => { const b = bump(k); edge.visible = b > 0.02; edge.material.opacity = 0.9 * b; edge.scale.setScalar(1 + 0.1 * b); });
    // and scythes swept back along her flanks
    const sl = bkt(c.L * 0.22, 0.2), sw = bkt(c.B * 0.9, 0.2);
    for (const z of [-1, 1]) {
      const x = c.L * 0.05, hw = c.hw(x);
      c.kit.add(scytheGeo(sl, sw, c.st.metal), 0xffffff, x, Math.max(0.3, c.dy * 0.5), z * (hw + 0.15), { rx: (-PI / 2) * z });
    }
    c.anchor('bow', [s.x + l * 0.75, h * 0.55, 0], 'blade');
  },
  glacis(c) {
    const s = stem(c), l = clamp(c.L * 0.2, 1.4, 3), x1 = s.x - 0.15, x0 = x1 - l, top = c.deckAt(x0) + 0.12, st = c.st;
    const w = bkt(2 * Math.max(c.hw(x0), c.hw(x0 + l * 0.3)) + 0.16, 0.1);
    const slope = Math.atan2(top, l), len = bkt(Math.hypot(top, l), 0.1);
    const col = shade(c.hullC === undefined ? C.iron : blend(c.hullC, C.iron, 0.6), 0.9);
    // overlapping plates, like scales, each riveted and weathered; split and holed from level 2
    const mk = (cr) => {
      const K = new Kit();
      K.add(glacisGeo(len, w, col, c.trimC, cr), 0xffffff, 0, 0, 0);
      K.detail(2, () => { K.push(len * 0.42, 0.12, 0, -PI / 2, 0, -PI / 2); emblemOn(K, st, Math.min(w * 0.4, len * 0.5), { depth: 0.06, faded: cr }); K.pop(); });
      return K.mesh(undefined, `glacis2|${f2(len)}|${f2(w)}|${col}|${c.trimC}|${cr}|${st.id}`);
    };
    const tw = twin(mk(false), mk(true));
    tw.g.position.set(x0, top, 0); tw.g.rotation.z = -slope; tw.g.name = 'glacis';
    c.addMoving(tw.g);
    onDamage(c, (lv) => tw.set(lv >= 2));
  },
  ramp(c) { ramp(c, false); },
  jawRamp(c) { ramp(c, true); },
  bowGun(c) {
    const at = c.place(clamp(c.B * 0.22, 0.5, 0.9), 0.34, 'c'), r = bkt(clamp(c.B * 0.06, 0.14, 0.28), 0.02), len = bkt(clamp(c.L * 0.2, 1.4, 2.8), 0.1), st = c.st;
    const bronze = c.trimC === 0xd4a83a ? C.bronze : C.iron;
    // a turntable with a ring of bolts, two cheeks and a quoin, and the barrel (its own mesh: it recoils)
    c.kit.add(bowGunMountGeo(r, st.metal), 0xffffff, at.x, at.y, 0);
    const K = new Kit();
    K.add(bowGunBarrelGeo(r, len, bronze, st.metal), 0xffffff, 0, 0, 0);
    const barrel = K.mesh(undefined, `bowgun2${f2(r)}${f2(len)}${bronze}${st.metal}`), mount = new THREE.Group();
    barrel.rotation.z = -PI / 2 + 0.12; mount.add(barrel); mount.position.set(at.x + r * 0.1, at.y + 0.3 + r * 2.2, 0);
    const flash = new THREE.Mesh(G.sph(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.visible = false; mount.add(flash);
    const dir = new THREE.Vector3(Math.cos(0.12), Math.sin(0.12), 0);
    flash.position.copy(dir).multiplyScalar(len * 0.8);
    c.addMoving(mount);
    c.action('fire', (k) => {
      const rec = k < 0.12 ? k / 0.12 : Math.max(0, 1 - (k - 0.12) / 0.6);
      barrel.position.copy(dir).multiplyScalar(-rec * len * 0.16);
      const f = clamp(1 - k / 0.25, 0, 1); flash.visible = f > 0.01; flash.material.opacity = f; flash.scale.setScalar(r * (2 + 4 * (1 - f)));
      if (k >= 1) { barrel.position.set(0, 0, 0); flash.visible = false; flash.scale.setScalar(1); }
    });
    // knocked off its seat when she is wrecked: the barrel lolls muzzle-down in the cheeks
    onDamage(c, (lv) => { mount.rotation.z = lv >= 3 ? -0.32 : 0; mount.rotation.x = lv >= 3 ? 0.12 : 0; });
    c.anchor('gun', [at.x + dir.x * len * 0.8, at.y + 0.3 + r * 2.2 + dir.y * len * 0.8, 0], 'bowGun');
  },
};

/** the realm's own figurehead on a plain stem (smaller than one the design asks for) */
export function figureHead(c, kind, scale = 0.72) { BOW_PARTS.figure(c, kind, scale); }

function ramp(c, jawed) {
  const s = stem(c), len = clamp(c.L * 0.24, 1.5, 2.8), w = clamp(c.B * 0.5, 1.1, 2.2), hy = Math.max(s.y - 0.1, 0.5), st = c.st;
  const col = jawed ? blend(c.hullC, C.bronze, 0.3) : c.hullC === undefined ? C.wood : blend(c.hullC, C.wood, 0.5);
  // the ramp leaf, its own mesh hinged at the stem: stowed raised, dropped to board or beach
  const K = new Kit();
  const np = Math.max(5, Math.round(len / 0.22));
  for (let i = 0; i < np; i++) K.add(G.rbox(len / np - 0.015, 0.1, w, 0.015), shade(col, 0.9 + hash(i) * 0.2), (len * (i + 0.5)) / np, 0, 0, { r: 0.85 });
  for (let i = 1; i < 7; i++) K.add(G.box(0.05, 0.05, w * 0.92), C.dark, (len * i) / 7, 0.07, 0); // cleats
  for (const z of [-1, 1]) K.add(G.rbox(len, 0.18, 0.07, 0.02), shade(col, 0.7), len / 2, 0.08, (z * w) / 2);
  K.detail(1, () => { for (let i = 0; i < 6; i++) for (const z of [-1, 1]) K.add(G.sph(0.025, 4, 3), C.iron, (len * (i + 0.5)) / 6, 0.12, (z * w) / 2, { m: 0.55 }); });
  if (jawed) {
    const n = Math.round(w / 0.2);
    for (let i = 0; i < n; i++) K.add(G.cone(0.07, 0.32, 5), C.bone, len + 0.05, 0.12, -w / 2 + (w * (i + 0.5)) / n, { rz: 0.15 - PI / 2 * 0.2 });
    for (const z of [-1, 1]) for (let i = 0; i < 5; i++) K.add(G.cone(0.06, 0.26, 5), C.bone, len * (0.15 + i * 0.18), 0.16, z * w * 0.48);
    K.add(loftL(`jawrampchin${f2(w)}`, [[len * 0.8, -0.08, 0, w * 0.5, 0.1], [len * 1.02, -0.05, 0, w * 0.4, 0.08], [len * 1.08, 0, 0, w * 0.2, 0.04]], { radial: 12, col }), 0xffffff, 0, 0, 0, { r: 0.6 });
  } else {
    for (let i = 0; i < 4; i++) K.add(G.cone(0.05, 0.22, 5), C.steel, len + 0.04, 0.02, -w * 0.4 + (w * 0.8 * i) / 3, { rz: -PI / 2, m: 0.55 });
    K.detail(2, () => { K.push(len * 0.5, -0.06, 0, PI / 2, 0, 0); emblemOn(K, st, w * 0.4, { depth: 0.05 }); K.pop(); });
  }
  const leaf = K.mesh(undefined, `ramp${jawed}${f2(len)}${f2(w)}${col}${st.id}`);
  const hinge = new THREE.Group(); hinge.position.set(s.x - 0.3, hy, 0); hinge.add(leaf);
  const REST = 0.95, DOWN = -0.55;
  hinge.rotation.z = REST;
  // the chains that lower her: two posts on deck, the chains (scaled bars) follow the leaf
  const posts = [];
  for (const z of [-1, 1]) {
    c.kit.add(G.rbox(0.14, 1.2, 0.14, 0.02), C.dark, s.x - 0.4, hy + 0.55, z * w * 0.55);
    c.kit.add(G.cyl(0.08, 0.08, 0.1, 8), C.iron, s.x - 0.4, hy + 1.15, z * w * 0.55, { rx: PI / 2, m: 0.5 });
    posts.push([s.x - 0.4, hy + 1.1, z * w * 0.55]);
  }
  const chainGeo = G.cyl(0.03, 0.03, 1, 5), chains = posts.map(() => { const m = new THREE.Mesh(chainGeo, new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.6, roughness: 0.45 })); return m; });
  const grp = new THREE.Group(); grp.add(hinge, ...chains);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const setAng = (ang) => {
    hinge.rotation.z = ang;
    const ex = s.x - 0.3 + Math.cos(ang) * len, ey = hy + Math.sin(ang) * len;
    chains.forEach((m, i) => {
      a.set(...posts[i]); b.set(ex, ey + 0.1, posts[i][2] * 0.82);
      const d = b.clone().sub(a), L = d.length();
      m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(up, d.normalize());
    });
  };
  setAng(REST);
  c.addMoving(grp);
  // board / beach: the leaf swings down (with a bounce as it lands), holds, and is hauled up again
  const drop = (k) => {
    let t;
    if (k < 0.25) { const u = k / 0.25; t = u * u; } else if (k < 0.32) t = 1 - 0.08 * Math.sin(((k - 0.25) / 0.07) * PI); else if (k < 0.7) t = 1; else t = 1 - (k - 0.7) / 0.3;
    setAng(lerp(REST, DOWN, clamp(t, 0, 1)));
  };
  c.action('board', drop); c.action('beach', drop);
  if (jawed) {
    // the beast's upper beak over the ramp, and its eyes
    const KK = c.kit, bw = w * 1.1;
    KK.push(s.x - 0.6, hy + 0.6, 0, 0, 0, 0.35);
    const bc = blend(c.hullC, 0x5a7a4a, 0.4);
    KK.add(sculptL(`beak|${f2(len)}|${f2(bw)}|${bc}|${c.st.glow}`, () => {
      const B = new SB();
      B.p(S.ellipsoid(len * 0.5, 0.42, bw * 0.5).at(len * 0.2, 0.3, 0).color(bc).pbr(0.5).bump(0.012, 6, 'scales'));
      B.p(S.capsule([len * 0.3, 0.22, 0], [len * 0.9, -0.02, 0], 0.3, 0.06).color(shade(bc, 0.9)).pbr(0.35).blend(0.15).bump(0.006, 10, 'ridges'));
      B.h(H.tube([[len * 0.82, 0.05, 0], [len * 0.97, -0.08, 0], [len * 0.95, -0.22, 0]], [0.1, 0.06, 0.01], 12, 10).color(0xd8c89a).pbr(0.35));
      for (const s of [-1, 1]) B.p(S.capsule([0, 0.62, s * bw * 0.3], [len * 0.45, 0.45, s * bw * 0.28], 0.14, 0.08).color(shade(bc, 0.8)).blend(0.06));
      SKH.eyes(B, [len * 0.3, 0.5, bw * 0.38], 0.1, c.st.glow, shade(bc, 0.75), { glow: 2.2 });
      return B.part();
    }, { res: 20, min: 6 }), 0xffffff, 0, 0, 0);
    KK.pop();
    c.anchor('mouth', [s.x + len * 0.5, hy, 0], 'jawRamp');
  }
  c.anchor('ramp', [s.x - 0.3 + Math.cos(DOWN) * len, hy + Math.sin(DOWN) * len, 0], 'ramp');
}
