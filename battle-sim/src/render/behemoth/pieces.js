// Sculpted pieces for the sky-behemoths, through the ground units' sculpt pipeline (sculpt.js prims blended into one
// smooth mesh with baked occlusion, plus crisp hard pieces), each meshed once per detail level on first need and
// cached by key (shape + colours), so every faction that shares a piece shares its geometry.
// Each returns a six-level array for the LOD table. Pieces stand on their origin (y up) and face +x.
import * as THREE from 'three';
import { S, H, sculptL, SB, SKH } from '../parts/kit.js';
import { weather } from '../parts/bow.js';
import { standingHand, creatureTemplate, creatureSpec } from '../sky/creatures.js';
import { bakePose } from '../rigkit.js';
import { EMPTY, LV, levels, lin, h1 } from './surf.js';

const q2 = (v) => (+v).toFixed(2);
const sh = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const DEG = 180 / Math.PI;
/** a sculpted piece: make() -> { prims, hard }; res cells per unit at level 0 */
export function sculpt(key, make, res = 48, o = {}) { return sculptL(`bh|${key}`, make, { res, min: o.min ?? 8, ao: o.ao ?? 0.72, paint: o.paint }); }

// ---------------------------------------------------------------------------------------------
// guns
// ---------------------------------------------------------------------------------------------
/** a great gun on its carriage, muzzle at +x (1.5 long); c: { metal, wood, trim, kind: 'cannon'|'dragon'|'skull'|'bombard' } */
export function cannon(c) {
  return sculpt(`cannon|${c.metal}|${c.wood}|${c.trim}|${c.kind || 'cannon'}`, () => {
    const B = new SB(), M = (p) => p.color(c.metal).pbr(0.38, 0.85);
    const prof = [[-0.62, 0.17], [-0.5, 0.2], [-0.1, 0.16], [0.4, 0.125], [0.78, 0.11]];
    for (let i = 0; i < prof.length - 1; i++) B.p(M(S.capsule([prof[i][0], 0.32, 0], [prof[i + 1][0], 0.32, 0], prof[i][1], prof[i + 1][1])).blend(0.04));
    for (const x of [-0.42, -0.1, 0.3, 0.7]) B.p(S.torus(0.17 - x * 0.06, 0.022).rot(0, 0, 90).at(x, 0.32, 0).color(c.trim).pbr(0.3, 0.9).blend(0.01));
    B.p(S.sphere(0.09).at(-0.7, 0.32, 0).color(c.metal).pbr(0.4, 0.85).blend(0.03));   // the cascabel
    if (c.kind === 'dragon') {
      // the muzzle cast as a dragon's head, jaws open
      B.p(S.ellipsoid(0.22, 0.17, 0.17).at(0.86, 0.36, 0).color(c.trim).pbr(0.3, 0.9).blend(0.05).bump(0.006, 18, 'scales'));
      B.p(S.ellipsoid(0.16, 0.05, 0.12).at(1.0, 0.28, 0).color(c.trim).pbr(0.3, 0.9).blend(0.04));
      for (const s of [-1, 1]) { B.p(S.capsule([0.8, 0.48, s * 0.08], [0.6, 0.62, s * 0.14], 0.035, 0.012).color(c.trim).blend(0.02)); B.p(S.sphere(0.03).at(0.95, 0.44, s * 0.1).color(0xffd040).glow(1.2)); }
      B.p(S.sphere(0.09).at(1.04, 0.34, 0).cut(0.01).color(0x100806));
    } else if (c.kind === 'skull') {
      B.p(S.sphere(0.2).at(0.88, 0.34, 0).color(0xd8cfb4).pbr(0.6).blend(0.04));
      for (const s of [-1, 1]) B.p(S.sphere(0.06).at(1.02, 0.38, s * 0.08).cut(0.01).color(0x0a0806));
      B.p(S.sphere(0.08).at(1.06, 0.3, 0).cut(0.01).color(0x0a0806));
    } else {
      B.p(S.torus(0.13, 0.04).rot(0, 0, 90).at(0.8, 0.32, 0).color(c.metal).pbr(0.35, 0.85).blend(0.015));
      B.p(S.cyl(0.075, 0.2).rot(0, 0, 90).at(0.84, 0.32, 0).cut(0.006).color(0x060504));
    }
    // the carriage: cheeks, axles, trucks
    for (const s of [-1, 1]) {
      B.h(H.extrude([[-0.6, 0], [0.35, 0], [0.35, 0.18], [0.05, 0.28], [-0.15, 0.36], [-0.6, 0.3]], 0.06, 0.008).at(0, 0, s * 0.2).color(c.wood).pbr(0.85));
      for (const x of [-0.42, 0.22]) B.p(S.cyl(0.1, 0.05, 0.01).rot(90, 0, 0).at(x, 0.08, s * 0.26).color(sh(c.wood, 0.8)).pbr(0.8).blend(0.01));
      B.h(H.sphere(0.018, 6).at(0.15, 0.2, s * 0.235).color(c.trim).pbr(0.4, 0.8).lod(1));
      B.h(H.sphere(0.018, 6).at(-0.3, 0.22, s * 0.235).color(c.trim).pbr(0.4, 0.8).lod(1));
    }
    B.p(S.box(0.9, 0.06, 0.36, 0.01).at(-0.12, 0.08, 0).color(c.wood).pbr(0.85).blend(0.01));
    return B.part();
  }, 44, { paint: weather(c.metal, { kind: 'bronze', amt: 0.5 }) });
}
/** an armoured turret (point defence / flak): a riveted dome on a ring, twin barrels at +x; 1 across */
export function turret(c) {
  return sculpt(`turret|${c.metal}|${c.trim}|${c.glow || 0}`, () => {
    const B = new SB();
    B.p(S.cyl(0.5, 0.14, 0.03).at(0, 0.07, 0).color(sh(c.metal, 0.75)).pbr(0.45, 0.8));
    B.p(S.ellipsoid(0.44, 0.34, 0.44).at(0, 0.16, 0).color(c.metal).pbr(0.38, 0.85).blend(0.04).bump(0.002, 30, 'noise'));
    B.p(S.box(0.2, 0.1, 0.5, 0.03).at(0.36, 0.3, 0).color(c.metal).pbr(0.38, 0.85).blend(0.05));
    for (const s of [-1, 1]) {
      B.p(S.capsule([0.35, 0.3, s * 0.12], [1.05, 0.3, s * 0.12], 0.055, 0.04).color(sh(c.metal, 0.6)).pbr(0.4, 0.85).blend(0.01));
      B.p(S.torus(0.05, 0.016).rot(0, 0, 90).at(1.0, 0.3, s * 0.12).color(c.trim).pbr(0.3, 0.9).blend(0.005));
      B.p(S.sphere(0.035).at(1.06, 0.3, s * 0.12).cut(0.004).color(0x050403));
    }
    B.p(S.box(0.06, 0.05, 0.3, 0.01).at(0.24, 0.42, 0).cut(0.004).color(0x080706));    // the vision slit
    if (c.glow) B.p(S.box(0.04, 0.03, 0.26, 0.01).at(0.255, 0.42, 0).color(c.glow).glow(1.1));
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; B.h(H.sphere(0.016, 6).at(Math.cos(a) * 0.43, 0.22, Math.sin(a) * 0.43).color(c.trim).pbr(0.35, 0.9).lod(1)); }
    B.p(S.torus(0.44, 0.025).at(0, 0.15, 0).color(c.trim).pbr(0.3, 0.9).blend(0.01));
    return B.part();
  }, 46, { paint: weather(c.metal, { kind: 'iron', amt: 0.6 }) });
}
/** a rack of war-rockets, tilted up toward +x; 1.4 long */
export function rocketRack(c) {
  return sculpt(`rockets|${c.metal}|${c.wood}|${c.trim}|${c.glow || 0}`, () => {
    const B = new SB();
    B.p(S.box(1.0, 0.1, 0.9, 0.02).at(0, 0.05, 0).color(c.wood).pbr(0.85));
    for (const s of [-1, 1]) B.p(S.capsule([-0.3, 0.1, s * 0.42], [0.1, 0.62, s * 0.42], 0.04).color(c.metal).pbr(0.45, 0.8).blend(0.01));
    B.push([0, 0.55, 0], [0, 0, 32]);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const z = (i - 1.5) * 0.2, y = (j - 1) * 0.18;
      B.p(S.capsule([-0.6, y, z], [0.45, y, z], 0.07).color(sh(c.metal, 0.7)).pbr(0.45, 0.8).blend(0.005));
      B.p(S.cone(0.075, 0.0, 0.22).rot(0, 0, -90).at(0.58, y, z).color(c.trim).pbr(0.3, 0.85).blend(0.01));
      B.p(S.sphere(0.05).at(-0.64, y, z).cut(0.004).color(0x140c08));
    }
    B.p(S.box(0.06, 0.66, 0.88, 0.01).at(-0.1, 0, 0).color(c.wood).pbr(0.8).blend(0.005));
    B.p(S.box(0.06, 0.66, 0.88, 0.01).at(0.3, 0, 0).color(c.wood).pbr(0.8).blend(0.005));
    B.pop();
    return B.part();
  }, 42);
}
/** a harpoon gun: a heavy crossbow with a barbed iron bolt and a chain drum; 2 long, aims +x */
export function harpoonGun(c) {
  return sculpt(`harpoon|${c.metal}|${c.wood}|${c.trim}`, () => {
    const B = new SB();
    B.p(S.cyl(0.3, 0.3, 0.04).at(0, 0.15, 0).color(c.wood).pbr(0.85));
    B.p(S.box(1.3, 0.16, 0.22, 0.03).at(0.2, 0.45, 0).color(c.wood).pbr(0.85).blend(0.02));
    for (const s of [-1, 1]) SKH.limb(B, [[0.6, 0.48, 0], [0.75, 0.5, s * 0.5], [0.55, 0.5, s * 0.95]], [0.06, 0.05, 0.03], c.metal, { k: 0.02, r: 0.4, m: 0.8 });
    B.p(S.capsule([-0.3, 0.6, 0], [1.2, 0.6, 0], 0.035).color(sh(c.metal, 0.6)).pbr(0.4, 0.85));
    B.p(S.cone(0.1, 0, 0.3).rot(0, 0, -90).at(1.3, 0.6, 0).color(c.metal).pbr(0.35, 0.9));
    for (const s of [-1, 1]) B.p(S.capsule([1.2, 0.6, 0], [1.08, 0.6, s * 0.12], 0.018).color(c.metal).pbr(0.35, 0.9));
    B.p(S.cyl(0.18, 0.3, 0.02).rot(90, 0, 0).at(-0.3, 0.35, 0).color(c.metal).pbr(0.4, 0.85).bump(0.01, 20, 'ridges'));
    return B.part();
  }, 40);
}

// ---------------------------------------------------------------------------------------------
// bells, lanterns, braziers, drums
// ---------------------------------------------------------------------------------------------
/** a great bell hanging from its crown at the origin (1 tall, mouth down at y = -1), clapper inside */
export function bell(c) {
  return sculpt(`bell|${c.metal}|${c.trim}|${c.glow || 0}`, () => {
    const B = new SB(), M = (p) => p.color(c.metal).pbr(0.3, 0.9);
    const prof = [[0.16, -0.06], [0.3, -0.12], [0.36, -0.35], [0.38, -0.6], [0.46, -0.85], [0.54, -0.97]];
    for (let i = 0; i < prof.length - 1; i++) B.p(M(S.cone(prof[i + 1][0], prof[i][0], prof[i][1] - prof[i + 1][1], 0.01)).at(0, (prof[i][1] + prof[i + 1][1]) / 2, 0).blend(0.06));
    B.p(M(S.torus(0.5, 0.05)).at(0, -0.95, 0).blend(0.04));
    B.p(S.cone(0.47, 0.25, 0.85).at(0, -0.56, 0).cut(0.02).color(0x1a1410));            // hollow inside
    for (const y of [-0.3, -0.72]) B.p(S.torus(0.37 + (y < -0.5 ? 0.06 : 0), 0.018).at(0, y, 0).color(c.trim).pbr(0.28, 0.9).blend(0.008));
    // inscription band and the crown loops
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; B.p(S.box(0.05, 0.08, 0.02, 0.005).rot(0, -a * DEG + 90, 0).at(Math.cos(a) * 0.38, -0.5, Math.sin(a) * 0.38).paint(0.008, -0.006).color(sh(c.metal, 0.6))); }
    for (const a of [0, 90]) B.p(S.torus(0.09, 0.028).rot(90, a, 0).at(0, 0.03, 0).color(c.metal).pbr(0.35, 0.9).blend(0.02));
    B.p(S.capsule([0, -0.1, 0], [0, -0.82, 0], 0.03).color(sh(c.metal, 0.5)));
    B.p(S.sphere(0.1).at(0, -0.88, 0).color(c.glow || sh(c.metal, 0.5)).pbr(0.4, 0.8).glow(c.glow ? 1 : 0));
    return B.part();
  }, 52, { paint: weather(c.metal, { kind: 'bronze', amt: 0.7 }) });
}
/** a lantern: 'paper' (a great ribbed paper war-lantern), 'iron' (a caged lamp), 'brazier' (a fire bowl); stands on its origin */
export function lantern(kind, c) {
  return sculpt(`lantern|${kind}|${c.metal}|${c.cloth}|${c.glow}`, () => {
    const B = new SB();
    if (kind === 'paper') {
      B.p(S.ellipsoid(0.5, 0.62, 0.5).at(0, 0.7, 0).color(c.cloth).pbr(0.85).glow(0.55).bump(0.012, 8, 'ridges'));
      for (let i = 0; i < 10; i++) { const a = (i / 10) * 180; B.p(S.torus(0.5, 0.012).rot(90, a, 0).scale(1).at(0, 0.7, 0).color(sh(c.cloth, 0.5)).blend(0.004)); }
      for (const y of [0.1, 1.3]) B.p(S.cyl(0.24, 0.1, 0.02).at(0, y, 0).color(c.metal).pbr(0.4, 0.8));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; B.p(S.capsule([Math.cos(a) * 0.2, 0.05, Math.sin(a) * 0.2], [Math.cos(a) * 0.22, -0.35, Math.sin(a) * 0.22], 0.02, 0.01).color(c.trim || c.metal)); }
    } else if (kind === 'brazier') {
      B.p(S.cone(0.12, 0.28, 0.7, 0.02).at(0, 0.35, 0).color(c.metal).pbr(0.45, 0.8));
      B.p(S.ellipsoid(0.48, 0.2, 0.48).at(0, 0.78, 0).color(c.metal).pbr(0.4, 0.85).blend(0.04));
      B.p(S.ellipsoid(0.42, 0.12, 0.42).at(0, 0.9, 0).cut(0.02));
      for (let i = 0; i < 9; i++) { const a = h1(i) * 6.28, r = h1(i + 3) * 0.3; B.p(S.sphere(0.09 + h1(i + 7) * 0.05).at(Math.cos(a) * r, 0.86, Math.sin(a) * r).color(i % 3 ? 0xff7a1a : 0xffd060).glow(1.6).blend(0.03)); }
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; B.p(S.cone(0.04, 0, 0.18).at(Math.cos(a) * 0.46, 0.92, Math.sin(a) * 0.46).color(c.metal)); }
    } else {
      B.p(S.cyl(0.2, 0.08, 0.02).at(0, 0.04, 0).color(c.metal).pbr(0.4, 0.8));
      B.p(S.ellipsoid(0.16, 0.26, 0.16).at(0, 0.36, 0).color(c.glow).glow(1.4));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; B.p(S.capsule([Math.cos(a) * 0.19, 0.06, Math.sin(a) * 0.19], [Math.cos(a) * 0.19, 0.62, Math.sin(a) * 0.19], 0.018).color(c.metal).pbr(0.4, 0.8)); }
      B.p(S.cone(0.26, 0.04, 0.22, 0.01).at(0, 0.72, 0).color(c.metal).pbr(0.4, 0.8));
      B.p(S.torus(0.07, 0.02).rot(90, 0, 0).at(0, 0.9, 0).color(c.metal));
    }
    return B.part();
  }, 44);
}
/** a great war drum on its stand, skin facing up; 1.2 across */
export function drum(c) {
  return sculpt(`drum|${c.wood}|${c.hide}|${c.trim}`, () => {
    const B = new SB();
    B.p(S.cyl(0.55, 0.8, 0.03).at(0, 0.75, 0).color(c.wood).pbr(0.75).bump(0.004, 30, 'fur').blend(0.02));
    B.p(S.ellipsoid(0.6, 0.12, 0.6).at(0, 0.55, 0).color(c.wood).blend(0.2));
    B.p(S.cyl(0.56, 0.03, 0.01).at(0, 1.16, 0).color(c.hide).pbr(0.9).blend(0.005));
    for (const y of [0.4, 1.12]) B.p(S.torus(0.57, 0.035).at(0, y, 0).color(c.trim).pbr(0.4, 0.8).blend(0.01));
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, b = a + 0.22; B.p(S.capsule([Math.cos(a) * 0.58, 0.42, Math.sin(a) * 0.58], [Math.cos(b) * 0.58, 1.1, Math.sin(b) * 0.58], 0.012).color(sh(c.hide, 0.7)).blend(0.004)); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; B.p(S.capsule([Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4], [Math.cos(a) * 0.55, 0.5, Math.sin(a) * 0.55], 0.05).color(sh(c.wood, 0.8)).blend(0.02)); }
    return B.part();
  }, 44);
}

// ---------------------------------------------------------------------------------------------
// bone, stone and crystal
// ---------------------------------------------------------------------------------------------
/** a skull facing +x, 1 across (crown at y = 0.5); glow: eye-light colour */
export function skull(c) {
  return sculpt(`skull|${c.bone}|${c.glow || 0}|${c.horns ? 1 : 0}`, () => {
    const B = new SB(), bone = (p, k = 0.06) => p.color(c.bone).pbr(0.62).blend(k).bump(0.004, 22, 'noise');
    B.p(bone(S.ellipsoid(0.45, 0.42, 0.4).at(-0.05, 0.5, 0), 0.1));
    B.p(bone(S.ellipsoid(0.26, 0.2, 0.3).at(0.28, 0.3, 0), 0.12));
    B.p(bone(S.box(0.2, 0.16, 0.34, 0.05).at(0.36, 0.16, 0), 0.08));
    for (const s of [-1, 1]) {
      B.p(S.sphere(0.12).at(0.36, 0.48, s * 0.15).cut(0.03).color(0x0c0806));
      if (c.glow) B.p(S.sphere(0.05).at(0.33, 0.48, s * 0.15).color(c.glow).glow(1.6));
      B.p(bone(S.ellipsoid(0.12, 0.08, 0.06).at(0.2, 0.33, s * 0.33), 0.06));
      if (c.horns) SKH.horn(B, [[-0.05, 0.75, s * 0.25], [-0.15, 1.05, s * 0.55], [-0.45, 1.15, s * 0.7], [-0.6, 0.95, s * 0.75]], 0.1, sh(c.bone, 0.75), { rings: 8 });
    }
    B.p(S.cone(0.06, 0.0, 0.12).rot(0, 0, -90).at(0.48, 0.34, 0).cut(0.02).color(0x0c0806));
    for (let i = 0; i < 7; i++) { const z = (i - 3) * 0.045; B.p(S.box(0.035, 0.08, 0.035, 0.008).at(0.46 - Math.abs(z) * 0.4, 0.12, z).color(sh(c.bone, 1.05)).blend(0.004)); }
    B.p(S.box(0.3, 0.02, 0.36, 0.01).at(0.33, 0.07, 0).cut(0.006).color(0x0c0806));
    return B.part();
  }, 46);
}
/** a cluster of crystals growing up from the origin (1.6 tall), lit from within */
export function crystals(c, seed = 1) {
  return sculpt(`crystals|${c.glow}|${c.base || 0}|${seed}`, () => {
    const B = new SB();
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + h1(seed + i) * 0.6, lean = i === 0 ? 0 : 18 + h1(seed + i * 3) * 22, len = i === 0 ? 1.6 : 0.6 + h1(seed + i * 5) * 0.7, r = i === 0 ? 0.2 : 0.1 + h1(seed + i * 7) * 0.08;
      const col = i % 2 ? c.glow : mix(c.glow, 0xffffff, 0.35);
      B.push([Math.cos(a) * (i ? 0.18 : 0), 0, Math.sin(a) * (i ? 0.18 : 0)], [Math.sin(a) * lean, 0, -Math.cos(a) * lean]);
      B.h(H.cyl(r, r * 1.05, len, 6).at(0, len / 2, 0).color(col).pbr(0.12, 0.1).glow(0.55));
      B.h(H.cone(r, r * 1.6, 6).at(0, len + r * 0.8, 0).color(mix(col, 0xffffff, 0.3)).pbr(0.1, 0.1).glow(0.8));
      B.pop();
    }
    B.p(S.ellipsoid(0.45, 0.16, 0.45).at(0, 0.02, 0).color(c.base || 0x4a4450).pbr(0.9).bump(0.03, 6, 'rock').blend(0.1));
    return B.part();
  }, 40);
}
/** a stone gargoyle crouched on a plinth facing +x, wings half spread; 1.2 tall */
export function gargoyle(c) {
  return sculpt(`garg|${c.stone}|${c.glow || 0}`, () => {
    const B = new SB(), st = (p, k = 0.06) => p.color(c.stone).pbr(0.88).blend(k).bump(0.008, 14, 'rock');
    B.p(st(S.box(0.6, 0.3, 0.5, 0.04).at(0, 0.15, 0), 0.01));
    B.p(st(S.ellipsoid(0.3, 0.28, 0.24).at(0, 0.55, 0), 0.08));
    B.p(st(S.ellipsoid(0.2, 0.22, 0.2).at(0.12, 0.82, 0), 0.1));
    B.p(st(S.ellipsoid(0.17, 0.14, 0.15).at(0.3, 0.98, 0), 0.08));
    B.p(st(S.ellipsoid(0.13, 0.07, 0.1).at(0.44, 0.94, 0), 0.05));
    B.p(S.ellipsoid(0.11, 0.025, 0.08).at(0.48, 0.92, 0).cut(0.01).color(0x1a1612));
    for (const s of [-1, 1]) {
      SKH.horn(B, [[0.28, 1.08, s * 0.08], [0.2, 1.25, s * 0.14], [0.06, 1.32, s * 0.16]], 0.04, sh(c.stone, 0.85), { rings: 6 });
      B.p(S.sphere(0.03).at(0.43, 1.02, s * 0.07).color(c.glow || 0x2a2420).glow(c.glow ? 1.4 : 0));
      SKH.limb(B, [[0.15, 0.7, s * 0.16], [0.3, 0.45, s * 0.2], [0.28, 0.3, s * 0.18]], [0.07, 0.05, 0.05], c.stone, { k: 0.04, r: 0.88 });
      SKH.limb(B, [[-0.12, 0.5, s * 0.18], [0.0, 0.35, s * 0.26], [-0.12, 0.3, s * 0.22]], [0.1, 0.07, 0.06], c.stone, { k: 0.04, r: 0.88 });
      // a wing of stone, ribbed
      B.push([-0.05, 0.85, s * 0.18], [s * -20, 0, 35]);
      for (let k = 0; k < 4; k++) B.p(st(S.capsule([0, 0, 0], [-0.25 - k * 0.08, 0.45 - k * 0.1, s * (0.25 + k * 0.08)], 0.03, 0.015), 0.02));
      B.p(st(S.ellipsoid(0.24, 0.24, 0.03).rot(0, s * 35, 0).at(-0.18, 0.22, s * 0.2), 0.02));
      B.pop();
    }
    SKH.limb(B, [[-0.25, 0.4, 0], [-0.45, 0.3, 0.1], [-0.55, 0.32, 0.2]], [0.06, 0.04, 0.02], c.stone, { k: 0.03 });
    return B.part();
  }, 44);
}
/** a carved totem pole (3 tall): stacked faces, painted, wings at the top */
export function totem(c) {
  return sculpt(`totem|${c.wood}|${c.paint}|${c.paint2}`, () => {
    const B = new SB();
    B.p(S.cyl(0.26, 3.0, 0.04).at(0, 1.5, 0).color(c.wood).pbr(0.8).bump(0.008, 14, 'fur'));
    for (let i = 0; i < 4; i++) {
      const y = 0.5 + i * 0.66, col = i % 2 ? c.paint : c.paint2;
      B.p(S.ellipsoid(0.15, 0.1, 0.22).at(0.24, y + 0.12, 0).color(col).pbr(0.7).blend(0.04));
      for (const s of [-1, 1]) { B.p(S.sphere(0.07).at(0.25, y + 0.15, s * 0.1).color(0xf0e8d0).blend(0.02)); B.p(S.sphere(0.035).at(0.3, y + 0.15, s * 0.1).color(0x0a0806)); }
      B.p(S.ellipsoid(0.1, 0.05, 0.15).at(0.27, y - 0.08, 0).color(0x1a0a06).blend(0.01));
      B.p(S.torus(0.27, 0.03).at(0, y - 0.26, 0).color(col).blend(0.01));
    }
    for (const s of [-1, 1]) B.p(S.ellipsoid(0.08, 0.3, 0.6).rot(s * 20, 0, 0).at(0, 2.9, s * 0.55).color(c.paint).pbr(0.7).blend(0.05).bump(0.01, 10, 'ridges'));
    B.p(S.cone(0.2, 0, 0.4).rot(0, 0, -90).at(0.35, 3.0, 0).color(c.paint2).blend(0.03));
    return B.part();
  }, 36);
}
/** a solar mirror: a polished dish (its face lit) in a fork on a post, facing +x; 1.6 across */
export function mirror(c) {
  return sculpt(`mirror|${c.metal}|${c.glow}`, () => {
    const B = new SB();
    B.p(S.cyl(0.08, 1.0, 0.02).at(0, 0.5, 0).color(c.metal).pbr(0.35, 0.85));
    B.p(S.box(0.1, 0.1, 1.7, 0.03).at(0, 1.0, 0).color(c.metal).pbr(0.35, 0.85));
    for (const s of [-1, 1]) B.p(S.capsule([0, 1.0, s * 0.85], [0, 1.6, s * 0.85], 0.04).color(c.metal).pbr(0.35, 0.85));
    B.push([0, 1.6, 0], [0, 0, 0]);
    B.p(S.cyl(0.82, 0.08, 0.03).rot(0, 0, 90).color(c.metal).pbr(0.3, 0.9));
    B.p(S.ellipsoid(0.06, 0.75, 0.75).at(0.07, 0, 0).cut(0.01));
    B.p(S.cyl(0.74, 0.012, 0.004).rot(0, 0, 90).at(0.03, 0, 0).color(c.glow).pbr(0.05, 1).glow(0.9));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; B.p(S.sphere(0.035).at(0.05, Math.cos(a) * 0.8, Math.sin(a) * 0.8).color(c.trim || c.metal).pbr(0.3, 0.9)); }
    B.pop();
    return B.part();
  }, 40);
}
/** a hanging iron cage (1.3 tall) hung from its ring at the origin; a prisoner or bones inside */
export function cage(c) {
  return sculpt(`cage|${c.metal}|${c.bone}`, () => {
    const B = new SB(), M = (p) => p.color(c.metal).pbr(0.5, 0.75);
    B.p(M(S.torus(0.1, 0.025)).rot(90, 0, 0).at(0, 0, 0));
    B.p(M(S.cone(0.45, 0.06, 0.25, 0.01)).at(0, -0.2, 0));
    B.p(M(S.cyl(0.46, 0.06, 0.01)).at(0, -1.25, 0));
    for (const y of [-0.33, -0.8]) B.p(M(S.torus(0.45, 0.02)).at(0, y, 0).blend(0.004));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; B.p(M(S.capsule([Math.cos(a) * 0.44, -0.3, Math.sin(a) * 0.44], [Math.cos(a) * 0.45, -1.24, Math.sin(a) * 0.45], 0.018)).blend(0.004)); }
    // a slumped figure of bones within
    B.p(S.ellipsoid(0.12, 0.16, 0.1).at(0, -0.95, 0.05).color(c.bone).pbr(0.6).blend(0.05));
    B.p(S.sphere(0.09).at(0.04, -0.75, 0.08).color(c.bone).pbr(0.6).blend(0.04));
    SKH.limb(B, [[0.02, -0.85, 0.12], [0.15, -1.0, 0.25], [0.2, -1.18, 0.2]], [0.03, 0.025, 0.02], c.bone, { k: 0.02 });
    return B.part();
  }, 46);
}
/** a gear wheel lying in the xz plane: rim, teeth, spokes; 2 across */
export function gear(c) {
  return sculpt(`gear|${c.metal}|${c.trim}`, () => {
    const B = new SB();
    B.p(S.torus(0.85, 0.08).color(c.metal).pbr(0.35, 0.88).blend(0.01));
    B.p(S.cyl(0.18, 0.2, 0.02).color(c.trim).pbr(0.3, 0.9));
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; B.p(S.box(0.14, 0.12, 0.12, 0.015).rot(0, -a * DEG, 0).at(Math.cos(a) * 0.98, 0, Math.sin(a) * 0.98).color(c.metal).pbr(0.35, 0.88).blend(0.008)); }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; B.p(S.capsule([Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15], [Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8], 0.05).color(c.metal).pbr(0.35, 0.88).blend(0.02)); }
    return B.part();
  }, 36);
}
/** a brass telescope on a fork mount, tube pointing up and out along +x; 2 long */
export function telescope(c) {
  return sculpt(`scope|${c.metal}|${c.trim}`, () => {
    const B = new SB();
    B.p(S.cyl(0.25, 0.3, 0.03).at(0, 0.15, 0).color(c.metal).pbr(0.35, 0.88));
    B.p(S.capsule([0, 0.3, 0], [0, 0.8, 0], 0.08).color(c.metal).pbr(0.35, 0.88));
    B.push([0, 0.9, 0], [0, 0, 35]);
    const prof = [[-0.7, 0.14], [0.1, 0.12], [0.8, 0.1], [1.3, 0.08]];
    for (let i = 0; i < prof.length - 1; i++) B.p(S.capsule([prof[i][0], 0, 0], [prof[i + 1][0], 0, 0], prof[i][1], prof[i + 1][1]).color(i % 2 ? c.trim : c.metal).pbr(0.3, 0.9).blend(0.005));
    for (const x of [-0.65, 0.1, 0.8]) B.p(S.torus(prof[0][1] + 0.02, 0.02).rot(0, 0, 90).at(x, 0, 0).color(c.trim).pbr(0.3, 0.9).blend(0.004));
    B.p(S.cyl(0.07, 0.04, 0.005).rot(0, 0, 90).at(1.32, 0, 0).color(0x8ac0e0).glow(0.6));
    B.pop();
    return B.part();
  }, 44);
}

// ---------------------------------------------------------------------------------------------
// trees and roots
// ---------------------------------------------------------------------------------------------
/**
 * a tree standing on its origin, about 3 tall: kind oak | conifer | baobab | jungle | dead | blossom | rot | iron | mushroom
 * c: { bark, leaf, leaf2, glow }
 */
export function tree(kind, c, seed = 1) {
  return sculpt(`tree|${kind}|${c.bark}|${c.leaf}|${c.leaf2}|${c.glow || 0}|${seed}`, () => {
    const B = new SB(), bark = { k: 0.06, r: 0.92, bump: [0.012, 9, 'fur'] };
    const R = (i) => h1(seed * 17 + i);
    if (kind === 'mushroom') {
      B.p(S.capsule([0, 0, 0], [0.1, 2.2, 0], 0.28, 0.2).color(c.bark).pbr(0.8).blend(0.1).bump(0.01, 8, 'ridges'));
      B.p(S.ellipsoid(1.3, 0.55, 1.3).at(0.1, 2.5, 0).color(c.leaf).pbr(0.6).blend(0.15).bump(0.01, 6, 'noise'));
      B.p(S.ellipsoid(1.2, 0.3, 1.2).at(0.1, 2.25, 0).cut(0.05).color(c.leaf2));
      for (let i = 0; i < 14; i++) { const a = R(i) * 6.28, r = 0.3 + R(i + 40) * 0.8; B.p(S.sphere(0.08 + R(i + 9) * 0.06).at(0.1 + Math.cos(a) * r, 2.6 + 0.4 * (1 - r), Math.sin(a) * r).color(c.glow || 0xf0f0e0).glow(c.glow ? 1 : 0).blend(0.02)); }
      return B.part();
    }
    if (kind === 'conifer') {
      SKH.limb(B, [[0, 0, 0], [0, 1.6, 0], [0, 3.2, 0]], [0.2, 0.14, 0.05], c.bark, bark);
      for (let i = 0; i < 6; i++) { const y = 0.7 + i * 0.42, r = 1.05 - i * 0.15; B.p(S.cone(r, r * 0.25, 0.6, 0.05).at(0, y, 0).color(i % 2 ? c.leaf : c.leaf2).pbr(0.95).blend(0.08).bump(0.03, 9, 'fur')); }
      return B.part();
    }
    if (kind === 'baobab') {
      B.p(S.capsule([0, 0, 0], [0, 2.2, 0], 0.85, 0.55).color(c.bark).pbr(0.9).blend(0.2).bump(0.02, 4, 'ridges'));
      for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28 + R(i), b = [Math.cos(a) * 1.4, 3.0 + R(i + 3) * 0.4, Math.sin(a) * 1.4]; SKH.limb(B, [[0, 2.1, 0], [b[0] * 0.5, 2.7, b[2] * 0.5], b], [0.28, 0.16, 0.08], c.bark, bark); B.p(S.ellipsoid(0.7, 0.35, 0.7).at(b[0], b[1] + 0.2, b[2]).color(i % 2 ? c.leaf : c.leaf2).pbr(0.95).blend(0.15).bump(0.04, 7, 'noise')); }
      return B.part();
    }
    // a broad tree: a trunk dividing into limbs, each holding a clump of leaves
    const tall = kind === 'jungle' ? 1.35 : 1, lean = (R(1) - 0.5) * 0.3;
    SKH.limb(B, [[0, -0.1, 0], [lean * 0.5, 1.0 * tall, 0], [lean, 1.8 * tall, 0.05]], [kind === 'jungle' ? 0.32 : 0.3, 0.22, 0.17], c.bark, bark);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + R(i); SKH.limb(B, [[0, 0.25, 0], [Math.cos(a) * 0.35, 0.05, Math.sin(a) * 0.35], [Math.cos(a) * 0.6, -0.15, Math.sin(a) * 0.6]], [0.16, 0.09, 0.04], c.bark, bark); }
    const nb = 5;
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * 6.28 + R(i + 10) * 0.8, r = 0.9 + R(i + 20) * 0.5, y = (2.2 + R(i + 30) * 0.7) * tall;
      const tip = [lean + Math.cos(a) * r, y, Math.sin(a) * r];
      SKH.limb(B, [[lean, 1.7 * tall, 0], [lean + Math.cos(a) * r * 0.5, y - 0.3, Math.sin(a) * r * 0.5], tip], [0.15, 0.1, 0.05], c.bark, bark);
      if (kind === 'dead' || kind === 'rot') { SKH.limb(B, [tip, [tip[0] + Math.cos(a) * 0.4, tip[1] + 0.3, tip[2] + Math.sin(a) * 0.4]], [0.05, 0.015], c.bark, bark); continue; }
      const col = i % 2 ? c.leaf : c.leaf2;
      B.p(S.ellipsoid(0.85, 0.6, 0.85).at(tip[0], tip[1] + 0.25, tip[2]).color(col).pbr(0.95).blend(0.25).bump(0.06, 5, 'noise').tint(0.15, 3));
    }
    if (kind !== 'dead' && kind !== 'rot') B.p(S.ellipsoid(1.1, 0.75, 1.1).at(lean, 2.9 * tall, 0).color(c.leaf).pbr(0.95).blend(0.3).bump(0.06, 5, 'noise').tint(0.15, 3));
    if (kind === 'blossom' || c.glow) for (let i = 0; i < 16; i++) { const a = R(i + 50) * 6.28, r = 0.6 + R(i + 60) * 1.0; B.p(S.sphere(0.07).at(lean + Math.cos(a) * r, 2.5 * tall + R(i + 70) * 1.0, Math.sin(a) * r).color(c.glow || 0xf0b0c8).glow(c.glow ? 1.2 : 0).blend(0.01)); }
    if (kind === 'rot') for (let i = 0; i < 6; i++) { const a = R(i + 80) * 6.28; SKH.limb(B, [[lean + Math.cos(a) * 0.9, 2.3, Math.sin(a) * 0.9], [lean + Math.cos(a) * 0.95, 1.6, Math.sin(a) * 0.95]], [0.04, 0.01], c.leaf2, { k: 0.01 }); }
    return B.part();
  }, kind === 'baobab' ? 24 : 28, { min: 7 });
}
/** a tangle of hanging roots from the origin down to about -3.2 (1.6 across); glow: veins of light */
export function roots(c, seed = 1) {
  return sculpt(`roots|${c.bark}|${c.glow || 0}|${seed}`, () => {
    const B = new SB(), R = (i) => h1(seed * 13 + i);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.28 + R(i), r0 = 0.3 + R(i + 1) * 0.5, len = 1.6 + R(i + 2) * 1.8;
      const pts = [[Math.cos(a) * r0, 0.1, Math.sin(a) * r0]];
      for (let k = 1; k <= 4; k++) { const t = k / 4; pts.push([Math.cos(a) * (r0 + t * 0.4) + (R(i * 7 + k) - 0.5) * 0.4, -t * len, Math.sin(a) * (r0 + t * 0.4) + (R(i * 5 + k) - 0.5) * 0.4]); }
      SKH.limb(B, pts, [0.2, 0.14, 0.09, 0.05, 0.015], c.bark, { k: 0.05, r: 0.92, bump: [0.012, 9, 'fur'] });
      if (c.glow && i % 2 === 0) for (let k = 1; k < 4; k++) B.p(S.capsule(pts[k], pts[k + 1], 0.04, 0.025).color(c.glow).glow(1.3).paint(0.03));
    }
    B.p(S.ellipsoid(0.9, 0.35, 0.9).at(0, 0, 0).color(c.bark).pbr(0.95).blend(0.15).bump(0.03, 6, 'rock'));
    return B.part();
  }, 24, { min: 7 });
}
/** a branching coral clump, 1.5 tall */
export function coral(c, seed = 1) {
  return sculpt(`coral|${c.col}|${c.col2}|${seed}`, () => {
    const B = new SB(), R = (i) => h1(seed * 19 + i);
    const branch = (p, d, r, depth, i) => {
      const e = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
      B.p(S.capsule(p, e, r, r * 0.7).color(depth % 2 ? c.col : c.col2).pbr(0.7).blend(0.05).bump(0.008, 18, 'scales'));
      if (depth >= 3) { B.p(S.sphere(r * 1.1).at(...e).color(c.col2).blend(0.03)); return; }
      for (let k = 0; k < 2; k++) { const a = R(i * 3 + k) * 6.28; branch(e, [Math.cos(a) * 0.3 * d[1], d[1] * 0.75, Math.sin(a) * 0.3 * d[1]], r * 0.7, depth + 1, i * 3 + k + 1); }
    };
    for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.28; branch([Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15], [Math.cos(a) * 0.15, 0.6, Math.sin(a) * 0.15], 0.1, 0, i + 1); }
    B.p(S.ellipsoid(0.4, 0.15, 0.4).color(c.col2).bump(0.02, 10, 'rock'));
    return B.part();
  }, 34);
}

// ---------------------------------------------------------------------------------------------
// structural carvings
// ---------------------------------------------------------------------------------------------
/** a flying buttress from a pier at the origin (pinnacle on top) arching over to a wall at +x (span), up to height h */
export function buttress(c, span = 2.4, h = 3) {
  return sculpt(`buttress|${c.stone}|${q2(span)}|${q2(h)}`, () => {
    const B = new SB(), st = (p, k = 0.02) => p.color(c.stone).pbr(0.88).blend(k).bump(0.005, 10, 'rock');
    B.p(st(S.box(0.5, h, 0.5, 0.04).at(0, h / 2, 0)));
    B.p(st(S.cone(0.3, 0.0, 1.0, 0.02).at(0, h + 0.5, 0)));
    for (let i = 0; i < 4; i++) B.p(st(S.cone(0.05, 0, 0.25).at(0, h + 0.15 + i * 0.22, 0.25)));
    const N = 8;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N, p = (t) => [t * span, h * 0.85 + Math.sin(t * Math.PI * 0.5) * h * 0.1 - (1 - Math.sin(t * Math.PI * 0.5 + 0.2)) * 0 + (t * 0.25), 0];
      B.p(st(S.capsule(p(t0), p(t1), 0.14, 0.14), 0.04));
      B.p(st(S.capsule([t0 * span, h * 0.55 + Math.sin(t0 * Math.PI) * h * 0.15, 0], [t1 * span, h * 0.55 + Math.sin(t1 * Math.PI) * h * 0.15, 0], 0.09, 0.09), 0.05));
    }
    return B.part();
  }, 22);
}
/** a heap of rubble and charred beams (1.6 across), for the wrecked levels */
export function rubble(c, seed = 1) {
  return sculpt(`rubble|${c.stone}|${c.wood}|${seed}`, () => {
    const B = new SB(), R = (i) => h1(seed * 23 + i);
    for (let i = 0; i < 11; i++) { const a = R(i) * 6.28, r = R(i + 1) * 0.6, s = 0.12 + R(i + 2) * 0.18; B.p(S.box(s * 1.6, s, s * 1.2, 0.02).rot(R(i + 3) * 40, R(i + 4) * 180, R(i + 5) * 40).at(Math.cos(a) * r, s * 0.5 + (0.6 - r) * 0.25, Math.sin(a) * r).color(i % 3 ? c.stone : 0x2a2420).pbr(0.9).blend(0.01).bump(0.01, 10, 'rock')); }
    for (let i = 0; i < 3; i++) { const a = R(i + 30) * 6.28; B.p(S.box(1.2, 0.09, 0.12, 0.01).rot(0, a * DEG, 15 + R(i + 31) * 25).at(Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2).color(0x1a120c).pbr(0.95).blend(0.005)); }
    for (let i = 0; i < 4; i++) B.p(S.sphere(0.05).at((R(i + 40) - 0.5) * 0.8, 0.2, (R(i + 41) - 0.5) * 0.8).color(0xff5010).glow(1.6));
    return B.part();
  }, 34);
}
/** a war-kite: a great painted sail on a cross frame, face +x (3 tall) */
export function kite(c) {
  return sculpt(`kite|${c.cloth}|${c.cloth2}|${c.wood}`, () => {
    const B = new SB();
    B.p(S.capsule([0, -1.5, 0], [0, 1.5, 0], 0.05).color(c.wood).pbr(0.8));
    B.p(S.capsule([0, 0.6, -1.2], [0, 0.6, 1.2], 0.04).color(c.wood).pbr(0.8));
    const sail = H.sheet(2.6, 3.2, 10, 12, (u, v) => [0, 0, 0.18 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)]).rot(0, 90, 0).at(0.04, 0, 0);
    const c1 = lin(c.cloth), c2 = lin(c.cloth2);
    B.h(sail.color(c.cloth).pbr(0.9).shade((x, y, z) => (Math.abs(y) < 0.25 || (Math.hypot(y - 0.3, z) < 0.6 && Math.hypot(y - 0.3, z) > 0.45) ? c2 : (Math.abs(z) > 1.15 ? c2 : c1))));
    B.p(S.capsule([0, -1.5, 0], [0, -1.6, 0.0], 0.03).color(c.cloth2));
    return B.part();
  }, 26);
}
/** windmill sails on a hub (radius 2.2) turning about +x */
export function windSails(c) {
  return sculpt(`sails|${c.wood}|${c.cloth}`, () => {
    const B = new SB();
    B.p(S.sphere(0.2).color(c.wood).pbr(0.8));
    for (let i = 0; i < 4; i++) {
      B.push([0, 0, 0], [i * 90, 0, 0]);
      B.p(S.box(0.08, 2.2, 0.1, 0.01).at(0.05, 1.15, 0).color(c.wood).pbr(0.85));
      B.h(H.box(0.03, 1.6, 0.5, 0.004).at(0.05, 1.35, 0.3).color(c.cloth).pbr(0.95));
      for (let k = 0; k < 6; k++) B.h(H.box(0.04, 0.03, 0.55, 0.004).at(0.07, 0.65 + k * 0.3, 0.3).color(c.wood).pbr(0.85));
      B.pop();
    }
    return B.part();
  }, 30);
}
/** a great wing (span along +z, 1 = 6 units): feathered (birds, angels) or a bat/dragon membrane; root at the origin */
export function wing(kind, c) {
  return sculpt(`wing|${kind}|${c.col}|${c.col2}|${c.bone || 0}`, () => {
    const B = new SB();
    if (kind === 'feather') {
      SKH.limb(B, [[0, 0, 0], [0.2, 0.5, 2.0], [-0.3, 0.6, 4.0], [-0.9, 0.3, 5.8]], [0.32, 0.22, 0.15, 0.06], c.col, { k: 0.08, r: 0.8 });
      for (let i = 0; i < 16; i++) { const t = i / 15, z = 0.6 + t * 5.0, len = 1.2 + 1.6 * Math.sin(t * Math.PI * 0.8); B.p(S.ellipsoid(len, 0.1, 0.3).rot(0, -8 - t * 30, 0).at(-len * 0.8 - 0.2 * t, 0.35 + 0.2 * Math.sin(t * Math.PI), z).color(i % 2 ? c.col : c.col2).pbr(0.8).blend(0.04).bump(0.006, 30, 'fur')); }
      for (let i = 0; i < 10; i++) { const t = i / 9, z = 0.4 + t * 4.4; B.p(S.ellipsoid(0.7, 0.1, 0.3).rot(0, -10, 0).at(-0.4, 0.45 + 0.2 * Math.sin(t * Math.PI), z).color(c.col2).blend(0.05).bump(0.005, 30, 'fur')); }
    } else {
      const bones = [[[0, 0, 0], [0.3, 0.6, 2.2]], [[0.3, 0.6, 2.2], [0.1, 0.8, 4.4]], [[0.1, 0.8, 4.4], [0.2, 0.5, 6.2]], [[0.1, 0.8, 4.4], [-1.4, 0.3, 5.6]], [[0.1, 0.8, 4.4], [-2.4, 0.1, 4.2]], [[0.3, 0.6, 2.2], [-2.6, 0.0, 2.2]]];
      for (const [a, b] of bones) B.p(S.capsule(a, b, 0.16, 0.08).color(c.bone || c.col).pbr(0.7).blend(0.05).bump(0.008, 12, 'scales'));
      // the membrane: a sheet stretched between the fingers, scalloped
      const mem = H.sheet(1, 1, 18, 14, null);
      const pa = mem.geo.attributes.position;
      const quad = (u, v) => { // bilinear-ish patch: root (0,0,0), wrist (0.1,0.8,4.4), fingertip (0.2,0.5,6.2), trailing (-2.6,0,2.2)
        const fr = [lerp3([0, 0.1, 0.2], [0.3, 0.6, 2.2], u * 2), lerp3([0.3, 0.6, 2.2], [0.2, 0.5, 6.2], u * 2 - 1)][u < 0.5 ? 0 : 1];
        const tr = [lerp3([-0.4, 0, 0], [-2.6, 0, 2.2], u * 2), lerp3([-2.6, 0, 2.2], [-1.4, 0.3, 5.6], u * 2 - 1)][u < 0.5 ? 0 : 1];
        const sag = Math.sin(Math.PI * v) * 0.35;
        return [lerp(fr[0], tr[0], v), lerp(fr[1], tr[1], v) - sag, lerp(fr[2], tr[2], v)];
      };
      for (let i = 0; i < pa.count; i++) { const u = pa.getX(i) + 0.5, v = pa.getY(i) + 0.5; const p = quad(u, v); pa.setXYZ(i, p[0], p[1], p[2]); }
      mem.geo.computeVertexNormals();
      B.h(mem.color(c.col2).pbr(0.85).shade((x, y, z) => { const k = 0.8 + 0.25 * Math.sin(z * 3 + x * 2); return [lin(c.col2)[0] * k, lin(c.col2)[1] * k, lin(c.col2)[2] * k]; }));
    }
    return B.part();
  }, 20, { min: 6 });
}
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------------------------------------------------------------------------------------------
// figures borrowed from the ground units: the realm's own soldier (as crew, or as a statue in stone), and its
// flying beasts roosting
// ---------------------------------------------------------------------------------------------
const RECOL = new Map();
/** a level array whose geometries are src's recoloured: fn([r, g, b]) -> [r, g, b] (cached by key) */
export function recolour(key, src, fn) {
  if (RECOL.has(key)) return RECOL.get(key);
  const done = new Map();
  const arr = [];
  for (let lv = 0; lv < LV; lv++) Object.defineProperty(arr, lv, { enumerable: true, get: () => {
    const g = src[lv];
    if (!g || g === EMPTY) return EMPTY;
    if (!done.has(g)) { const c = g.clone(), C = c.attributes.color; if (C) { const a = [0, 0, 0]; for (let i = 0; i < C.count; i++) { a[0] = C.getX(i); a[1] = C.getY(i); a[2] = C.getZ(i); const r = fn(a, i); C.setXYZ(i, r[0], r[1], r[2]); } } if (c.attributes.aPbr) { const P = c.attributes.aPbr; for (let i = 0; i < P.count; i++) { P.setX(i, Math.max(P.getX(i), 0.75)); P.setY(i, 0.05); P.setZ(i, 0); } } done.set(g, c); }
    return done.get(g);
  } });
  arr.toJSON = () => undefined;
  RECOL.set(key, arr);
  return arr;
}
/** the realm's soldier standing (facing +z in his own space): { geos, height } or null */
export function soldier(realm) { return standingHand(realm); }
/** the realm's soldier carved in stone (or cast in metal): geos */
export function statue(realm, stoneHex, metal = false) {
  const P = standingHand(realm);
  if (!P) return null;
  const st = lin(stoneHex);
  return { geos: recolour(`statue|${realm}|${stoneHex}|${metal}`, P.geos, (c) => { const l = 0.35 + 0.9 * (0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2]); return [st[0] * l, st[1] * l, st[2] * l]; }), height: P.height };
}
const ROOST = new Map();
/** a flying beast at rest (wings folded by its rest pose): creature kind as the sky beasts name them; geos + size */
export function roostBeast(creature, realm, look = {}) {
  const key = `${creature}|${realm}|${look.body}|${look.wing}`;
  if (ROOST.has(key)) return ROOST.get(key);
  let out = null;
  try {
    const def = { id: `bh_${realm}_${creature}`, sky: { kind: 'beast', creature, look: { body: look.body ?? 0x6a5a40, wing: look.wing ?? 0x4a3a2a, belly: look.belly ?? 0xc8b890 } } };
    const spec = creatureSpec(def, { id: realm, metal: look.metal ?? 0xc9a04a, accent: look.accent ?? 0xe8e0d0 });
    const tpl = spec && creatureTemplate(spec);
    if (tpl && tpl.userData.lod) {
      const m = tpl.clone ? tpl : tpl;
      m.updateMatrixWorld(true);
      const n = m.userData.lod.meshes[0].geos.length;
      const g1 = bakePose(m, Math.min(1, n - 1)), g2 = bakePose(m, Math.min(2, n - 1)), g3 = bakePose(m, Math.min(3, n - 1));
      if (g1) { g1.computeBoundingBox(); const bb = g1.boundingBox; out = { geos: [g1, g1, g2 || g1, g3 || g2 || g1, EMPTY, EMPTY], size: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), height: bb.max.y - bb.min.y, min: bb.min.y }; }
    }
  } catch (err) { console.warn('[behemoth] roost beast failed', creature, err); }
  ROOST.set(key, out);
  return out;
}
/** a stand-in roosting bird sculpted here when no ground beast fits (wings folded, facing +x, 1 long) */
export function perchedBird(c) {
  return sculpt(`bird|${c.col}|${c.col2}|${c.beak}`, () => {
    const B = new SB(), F = (p, k = 0.06) => p.color(c.col).pbr(0.85).blend(k).bump(0.004, 30, 'fur');
    B.p(F(S.ellipsoid(0.42, 0.28, 0.26).rot(0, 0, 20).at(0, 0.45, 0), 0.1));
    B.p(F(S.ellipsoid(0.14, 0.16, 0.13).at(0.3, 0.74, 0), 0.08));
    B.p(S.cone(0.06, 0, 0.18).rot(0, 0, -100).at(0.45, 0.72, 0).color(c.beak).pbr(0.5).blend(0.02));
    for (const s of [-1, 1]) {
      B.p(F(S.ellipsoid(0.48, 0.12, 0.08).rot(0, 0, 18).at(-0.08, 0.5, s * 0.22), 0.04).color(c.col2));
      B.p(S.sphere(0.025).at(0.38, 0.78, s * 0.07).color(0x0a0806));
      SKH.limb(B, [[0.0, 0.25, s * 0.08], [0.02, 0.05, s * 0.09], [0.1, 0.0, s * 0.09]], [0.03, 0.02, 0.012], c.beak, { k: 0.01 });
    }
    B.p(F(S.ellipsoid(0.3, 0.05, 0.14).rot(0, 0, 25).at(-0.48, 0.32, 0), 0.04).color(c.col2));
    return B.part();
  }, 40);
}
/** a coiled stone serpent statue (2 tall), head reared facing +x */
export function serpent(c) {
  return sculpt(`serpent|${c.col}|${c.glow || 0}`, () => {
    const B = new SB(), pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24, a = t * Math.PI * 4.2, r = 0.7 * (1 - t * 0.5); pts.push([Math.cos(a) * r, 0.18 + t * 1.3, Math.sin(a) * r]); }
    pts.push([0.35, 1.75, 0.1], [0.6, 1.95, 0]);
    const radii = pts.map((_, i) => 0.2 * (1 - i / pts.length * 0.6));
    SKH.limb(B, pts, radii, c.col, { k: 0.06, r: 0.6, bump: [0.008, 18, 'scales'] });
    B.p(S.ellipsoid(0.32, 0.12, 0.42).at(0.55, 1.98, 0).color(c.col).pbr(0.6).blend(0.06).bump(0.006, 18, 'scales'));
    B.p(S.ellipsoid(0.22, 0.1, 0.16).at(0.82, 2.0, 0).color(c.col).blend(0.05));
    for (const s of [-1, 1]) B.p(S.sphere(0.035).at(0.86, 2.06, s * 0.08).color(c.glow || 0xd8a020).glow(c.glow ? 1.5 : 0.2));
    return B.part();
  }, 36);
}
void q2; void lin;
export { EMPTY, levels };
