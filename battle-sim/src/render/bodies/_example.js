// Worked example of the sculpting kit: a scarecrow-like training dummy.
// It is registered as body "example" purely to show the techniques; it is not a game unit.
import { S, H } from '../sculpt.js';
import { proportions } from './anatomy.js';

export function exampleBody(def, o = {}) {
  const P = proportions(o);
  const skin = 0xd9a77c, cloth = 0x3f5d8a, leather = 0x5a3a22;

  // --- torso: overlapping volumes blend into one surface ---
  const torso = [
    S.ellipsoid(P.chestW / 2, 0.13, P.chestD / 2).at(0, P.torso - 0.1, 0).color(cloth).tint(0.12, 40),         // rib cage
    S.ellipsoid(P.waistW / 2, 0.11, P.waistD / 2).at(0, 0.11, 0).color(cloth).blend(0.06),                       // belly
    S.ellipsoid(P.hipW / 2, 0.075, P.waistD / 2).at(0, 0.01, 0).color(0x4a3a2a).blend(0.05),                     // hips
    ...S.mirrorX([S.sphere(0.055).at(P.shoulderX - 0.02, P.torso - 0.03, 0).color(cloth).blend(0.04)]),          // shoulders
    S.capsule([0, P.torso - 0.02, 0], [0, P.torso + P.neck, 0.005], P.rNeck * 1.15, P.rNeck).color(skin).blend(0.03),
    // paint recolours without changing shape; raise > 0 embosses it (a belt)
    S.torus(P.waistW / 2 - 0.01, 0.022).at(0, 0.055, 0).color(leather).pbr(0.6).paint(0.006, 0.006),
    S.box(0.045, 0.045, 0.03, 0.006).at(0, 0.055, P.waistD / 2 + 0.005).color(0xd6a646).pbr(0.35, 1).blend(0),    // buckle: crisp, metallic
  ];

  // --- head: features blended on, sockets cut in, eyes painted ---
  const R = P.headR;
  const head = [
    S.ellipsoid(R * 0.92, R * P.headLen, R).color(skin),
    S.ellipsoid(R * 0.7, R * 0.5, R * 0.6).at(0, -R * 0.62, R * 0.28).color(skin).blend(0.05),                    // jaw
    S.capsule([0, R * 0.12, R * 0.92], [0, -R * 0.2, R * 1.08], R * 0.1, R * 0.14).color(skin).blend(0.025),       // nose
    ...S.mirrorX([
      S.sphere(R * 0.2).at(R * 0.38, R * 0.14, R * 0.86).cut(0.012),                                              // eye socket
      S.ellipsoid(R * 0.16, R * 0.3, R * 0.07).at(R * 0.95, 0, 0).rot(0, 0, -8).color(skin).blend(0.02),           // ear
    ]),
    S.ellipsoid(R * 0.3, R * 0.045, R * 0.1).at(0, -R * 0.52, R * 0.83).color(0x8a4a44).paint(0.004),              // lips
    S.ellipsoid(R * 0.98, R * 0.75, R * 1.03).at(0, R * 0.5, -R * 0.12).color(0x3a2a1c).bump(0.012, 60, 'fur').blend(0.01), // hair
  ];

  // Eyes are small and need crisp edges, so they are hard pieces. shade() colours each vertex:
  // here by how far it is from the eye's forward (+Z) pole, giving pupil, iris and white.
  const eyes = H.mirrorX([
    H.sphere(R * 0.15, 20).shade((x, y, z) => { const d = Math.hypot(x, y) / (R * 0.15); return z < 0 ? null : d < 0.28 ? 0x0c0c10 : d < 0.58 ? 0x3a5f8a : null; })
      .color(0xf4f1ea).pbr(0.2).at(R * 0.38, R * 0.14, R * 0.8),
  ]);

  // --- limbs: a tapered capsule per bone, a ball at each joint to hide the seam ---
  const arm = () => [S.capsule([0, 0, 0], [0, -P.upper, 0], P.rUpper * 1.15, P.rUpper * 0.9).color(cloth), S.sphere(P.rUpper * 1.2).color(cloth).blend(0.03)];
  const fore = () => [
    S.capsule([0, 0, 0], [0, -P.fore, 0], P.rFore, P.rWrist).color(skin),
    S.ellipsoid(P.handR * 0.8, P.handR * 1.25, P.handR * 0.55).at(0, -P.fore - P.handR * 0.9, 0).color(skin).blend(0.02),
  ];
  const leg = () => [S.capsule([0, 0, 0], [0, -P.thigh, 0], P.rThigh, P.rCalf * 1.05).color(0x4a3a2a).bump(0.004, 50, 'weave')];
  const shin = () => [
    S.capsule([0, 0, 0], [0, -P.shin, 0], P.rCalf, P.rAnkle).color(0x4a3a2a),
    S.ellipsoid(0.045, 0.035, P.footLen / 2).at(0, -P.shin - 0.01, P.footLen * 0.3).color(leather).blend(0.02), // boot
  ];

  // --- hard pieces keep sharp edges: a wooden practice sword in the weapon hand ---
  const sword = [
    H.box(0.035, 0.5, 0.012, 0.004).at(0, 0.3, 0).color(0x8a6a44).pbr(0.8),
    H.box(0.14, 0.022, 0.03).at(0, 0.04, 0).color(0x5a4630),
    H.cyl(0.014, 0.016, 0.1, 12).at(0, -0.02, 0).color(leather),
  ].map((h) => h.rot(-80, 0, 0).at(0, -P.fore - P.handR, 0.01));

  return {
    kind: 'biped', attack: 'swing',
    nodes: [
      { name: 'root', pos: [0, 0, 0] },
      { name: 'legL', parent: 'root', rig: 'legs', pos: [P.hipX, P.hipY, 0], prims: leg() },
      { name: 'shinL', parent: 'legL', rig: 'shins', pos: [0, -P.thigh, 0], prims: shin() },
      { name: 'legR', parent: 'root', rig: 'legs', pos: [-P.hipX, P.hipY, 0], prims: leg() },
      { name: 'shinR', parent: 'legR', rig: 'shins', pos: [0, -P.thigh, 0], prims: shin() },
      { name: 'torso', parent: 'root', rig: 'torso', pos: [0, P.hipY, 0], prims: torso },
      { name: 'head', parent: 'torso', rig: 'head', pos: [0, P.torso + P.neck + R * P.headLen * 0.9, 0], prims: head, hard: eyes, detail: 1.6 },
      { name: 'armL', parent: 'torso', rig: 'arms', pos: [P.shoulderX, P.torso - 0.02, 0], prims: arm() },
      { name: 'foreL', parent: 'armL', rig: 'forearms', pos: [0, -P.upper, 0], prims: fore() },
      { name: 'armR', parent: 'torso', rig: 'arms', pos: [-P.shoulderX, P.torso - 0.02, 0], prims: arm() },
      { name: 'foreR', parent: 'armR', rig: 'forearms', pos: [0, -P.upper, 0], prims: fore(), hard: sword },
    ],
  };
}
