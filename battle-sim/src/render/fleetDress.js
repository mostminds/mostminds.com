// What a fleet's working ships carry on deck, so each role reads at a glance (the plain role hulls of the original
// factions, and any role ship without a design of its own; designed ships are dressed by shipParts.dressDesign):
//   siege     squat mortars on turntable beds amidships, shells stacked and a powder keg beside them
//   carrier   a flight deck over the stern on braced trestles, a catapult rail and sled, fliers parked on it
//   flak      twin shielded mounts of rotary many-barrelled guns pointing at the sky, ammunition chests
//   hunter    a harpoon gun on a swivel in the bow with its loaded harpoon and coil of line, fire barrels astern
//   troop     stores amidships under lashings, a tall command banner, a lantern on a post for the aura
//   landing   a hinged bow ramp on chains from a gallows, pavises along the rails
//   line      a ram at the waterline when she has one
// Everything is in the style of her faction or realm (parts/realmStyle.js styles via crews.realmLook; FLAVOR below
// for gun metal, timber, ornament and the shape of the ram): emblems on shields and barrels, finials on posts, the
// realm's lantern and banner. Static work is merged per piece into sculpt meshes with six detail levels and added to
// model.userData.lod; moving pieces sit in their own groups and answer model.userData.actions:
//   mortar (recoil of both barrels), launch (the catapult sled throws a flier off), flak (barrels spin and kick,
//   mounts jerk), harpoon (gun recoil, harpoon gone, line pays out, reload), aura (lantern halo and banner),
//   beach / board (the ramp drops and comes up again), ram (the ram surges), hit (fittings shudder)
// and model.userData.anchors (bow, stern, deckL, deckR, plus mortar / flak / harpoon muzzles where she has them).
// A plain role ship does not know whose she is when she is built: the crew system calls
// model.userData.styleFaction(faction) once it learns the side's faction, and she is dressed again in its style.
//
// And squadrons: three small fliers flying together, each with its rider (see fliers.js for the styles).
import * as THREE from 'three';
import { Kit, G, C, shade, taper, EMPTY_GEO } from './parts/kit.js';
import { emblem, finial, lantern, banner, motif } from './parts/realmStyle.js';
import { sculptMaterial } from './sculpt.js';
import { REALMS } from '../data/realms.js';
import { makeFlier, animateFlier } from './fliers.js';
import { realmLook } from './crews.js';

const PI = Math.PI;
// materials and ornament by the look of a faction (realms borrow their look's flavour, with their own colours)
const FLAVOR = {
  kingdom: { gun: 0xb08a3a, gunM: 0.55, wood: 0x6b4a2e, iron: 0x3a3a40, deco: 'gilt', ram: 'beak' },
  goblin: { gun: 0x5a5048, gunM: 0.35, wood: 0x5a4a36, iron: 0x4a4038, deco: 'scrap', ram: 'spikelog' },
  undead: { gun: 0x2e2e34, gunM: 0.45, wood: 0x2a2630, iron: 0x26262c, deco: 'bone', ram: 'skull' },
  infernal: { gun: 0x26222a, gunM: 0.5, wood: 0x2a1a1a, iron: 0x1e1a1e, deco: 'spikes', ram: 'horns', fire: true },
  beasts: { gun: 0x6a5a48, gunM: 0.25, wood: 0x6b4a2e, iron: 0x4a4038, deco: 'totem', ram: 'tusk' },
  elemental: { gun: 0x8a8f9a, gunM: 0.2, wood: 0x5a5a62, iron: 0x4a4e58, deco: 'crystal', ram: 'wedge' },
  dragons: { gun: 0xb08a3a, gunM: 0.55, wood: 0x5a2a22, iron: 0x3a2a24, deco: 'scale', ram: 'dragon' },
};
const LOOK = new Map(REALMS.map((r) => [r.id, r.look]));
function flavorOf(id) {
  let k = id, guard = 0;
  while (k && !FLAVOR[k] && guard++ < 6) k = LOOK.get(k);
  return FLAVOR[k] || FLAVOR.kingdom;
}

/** a piece: one merged sculpt mesh from fn(K), added to parent and to the ship's detail table */
class Dress {
  constructor(m, key, st, fl, side) { this.m = m; this.key = key; this.st = st; this.fl = fl; this.side = side; this.lods = []; this.glows = []; }
  piece(parent, name, fn) {
    const K = new Kit();
    fn(K);
    if (K.empty) return null;
    const mesh = K.mesh(sculptMaterial(), `dress|${this.key}|${name}`);
    parent.add(mesh);
    this.lods.push({ mesh, geos: mesh.userData.lodGeos });
    return mesh;
  }
  group(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); g.userData.noCrew = true; parent.add(g); return g; }
}

/** small ornaments in the flavour of her faction, standing on the origin, about size tall */
function deco(K, D, size) {
  const st = D.st, s = size;
  switch (D.fl.deco) {
    case 'gilt': finial(K, st, s); break;
    case 'scrap': K.add(G.cone(s * 0.08, s * 0.5, 5), 0x6a6a62, 0, s * 0.25, 0, { m: 0.4, r: 0.6 }).add(G.box(s * 0.3, s * 0.08, s * 0.3), 0x8a5a2a, 0, s * 0.04, 0, { ry: 0.4, m: 0.3 }); break;
    case 'bone': K.add(G.sph(s * 0.16, 8, 6), C.bone, 0, s * 0.3, 0).add(G.box(s * 0.12, s * 0.08, s * 0.16), C.bone, s * 0.05, s * 0.18, 0); for (const z of [-1, 1]) K.add(G.sph(s * 0.04, 5, 4), D.st.glow, s * 0.13, s * 0.32, z * s * 0.06, { g: 1.6 }); break;
    case 'spikes': for (let i = 0; i < 3; i++) K.add(G.cone(s * 0.06, s * 0.5, 5), 0x1e1a1e, (i - 1) * s * 0.12, s * 0.25, 0, { rz: (i - 1) * 0.3, m: 0.45, r: 0.4 }); K.add(G.sph(s * 0.05, 5, 4), C.fire, 0, s * 0.06, 0, { g: 2 }); break;
    case 'totem': K.add(G.cyl(s * 0.03, s * 0.04, s * 0.5, 6), C.wood, 0, s * 0.25, 0); for (const z of [-1, 1]) K.add(taper(`Dhorn${z}`, [[0, 0, 0], [0, 0.2, z * 0.2], [0.08, 0.36, z * 0.26]], [0.05, 0.006], 8, 5), C.bone, 0, s * 0.45, 0, { s }); K.add(G.cone(s * 0.05, s * 0.3, 4), 0xc83a2a, 0, s * 0.3, s * 0.05, { rx: 0.6 }); break;
    case 'crystal': K.add(G.oct(s * 0.14), st.glow, 0, s * 0.35, 0, { sy: 2.2, g: 1.6, r: 0.2 }); K.add(G.oct(s * 0.08), st.glow, s * 0.1, s * 0.18, 0, { sy: 2, rz: -0.5, g: 1.4 }); break;
    case 'scale': K.add(G.cone(s * 0.12, s * 0.4, 6), st.metal, 0, s * 0.2, 0, { m: st.metalM, r: 0.35 }); for (let i = 0; i < 3; i++) K.add(G.sph(s * 0.08, 6, 4), shade(st.metal, 0.8), 0, s * (0.06 + i * 0.1), s * 0.1, { sz: 0.3, m: 0.4 }); break;
  }
}

/** a lathed gun barrel along +y (breech at the origin), length h, bore radius r, with bands and the faction's muzzle */
function barrel(K, D, key, r, h, o = {}) {
  const fl = D.fl, st = D.st, gm = { m: fl.gunM, r: 0.35 };
  K.add(G.lathe(`Dbar${key}${h}${r}`, [[0, -r * 0.4], [r * 0.9, -r * 0.35], [r * 1.25, 0], [r * 1.2, h * 0.3], [r * 1.05, h * 0.8], [r * 1.2, h * 0.92], [r * 1.25, h], [r * 0.7, h], [r * 0.65, h * 0.6]], o.seg ?? 14), fl.gun, 0, 0, 0, gm);
  K.add(G.cyl(r * 0.6, r * 0.6, 0.01, o.seg ?? 14), 0x0a0a0a, 0, h * 0.62, 0); // the bore, dark
  K.detail(1, () => { for (const f of [0.12, 0.45, 0.78]) K.add(G.tor(r * 1.2, r * 0.09, 4, o.seg ?? 14), shade(fl.gun, 0.8), 0, h * f, 0, { rx: PI / 2, ...gm }); });
  K.detail(2, () => {
    if (fl.ram === 'dragon') for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; K.add(G.cone(r * 0.18, r * 0.7, 4), C.bone, Math.cos(a) * r * 1.2, h + r * 0.2, Math.sin(a) * r * 1.2, { rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 }); }
    if (fl.fire) K.add(G.circle(r * 0.62, 12), C.fire, 0, h * 0.99, 0, { rx: -PI / 2, g: 2.5 });
    if (fl.deco === 'crystal') K.add(G.tor(r * 1.3, r * 0.1, 4, 14), st.glow, 0, h * 0.95, 0, { rx: PI / 2, g: 1.8 });
    if (fl.deco === 'bone') K.add(G.sph(r * 0.5, 8, 6), C.bone, 0, h * 0.35, r * 1.15, { sz: 0.5 });
  });
}

/** a heap of round shot in a frame, on the origin */
function shotPile(K, r, n, col = 0x1e1e20) {
  K.add(G.rbox(r * 2 * 3.4, r * 0.8, r * 2 * 2.4, r * 0.2), C.wood, 0, r * 0.4, 0);
  let k = 0;
  for (let layer = 0; layer < 3 && k < n; layer++) for (let i = 0; i < 3 - layer && k < n; i++) for (let j = 0; j < 2 - Math.min(1, layer) && k < n; j++, k++)
    K.add(G.sph(r, 8, 6), col, (i - (2 - layer) / 2) * r * 2.05, r * 1.7 + layer * r * 1.6, (j - (1 - Math.min(1, layer)) / 2) * r * 2.05, { m: 0.45, r: 0.45 });
}
/** a barrel with hoops, standing on the origin */
function cask(K, r, h, col = C.wood, hoop = C.iron) {
  K.add(G.lathe(`Dcask`, [[0, 0], [0.82, 0], [1, 0.5], [0.82, 1], [0, 1]], 12), col, 0, 0, 0, { sx: r, sy: h, sz: r, r: 0.8 });
  K.detail(1, () => { for (const f of [0.12, 0.88]) K.add(G.tor(r * 0.88, r * 0.05, 3, 12), hoop, 0, h * f, 0, { rx: PI / 2, m: 0.4 }); });
}
/** a crate lashed with rope */
function crate(K, w, h, d, col) {
  K.add(G.rbox(w, h, d, Math.min(w, h) * 0.06), col, 0, h / 2, 0, { r: 0.85 });
  K.detail(1, () => { K.add(G.box(w * 1.02, h * 0.1, d * 1.02), shade(col, 0.75), 0, h * 0.2, 0).add(G.box(w * 1.02, h * 0.1, d * 1.02), shade(col, 0.75), 0, h * 0.8, 0); K.add(G.box(0.02, h * 1.02, d * 1.04), C.rope, 0, h / 2, 0); });
}

// ------------------------------------------------------------------ the roles
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/** a kick that peaks at once and dies away, 0 at k = 0 and k = 1 */
const kick = (k, at = 0.08, back = 0.7) => (k <= 0 || k >= 1 ? 0 : k < at ? k / at : Math.max(0, 1 - (k - at) / back) ** 2);

function siege(D, g, L, B, y, acts, anchors, keep) {
  const st = D.st, fl = D.fl, r = B * 0.12, h = B * 0.34;
  const barrels = [];
  for (const s of [-1, 1]) {
    const x = s * L * 0.13;
    const bed = D.group(g, x, y, 0);
    D.piece(bed, `mbed${s}`, (K) => {
      K.add(G.lathe('Dturn', [[0, 0], [1, 0], [1, 0.25], [0.92, 0.35], [0, 0.35]], 18), fl.wood, 0, 0, 0, { sx: B * 0.24, sy: 0.3, sz: B * 0.24, r: 0.8 });
      K.add(G.tor(B * 0.235, 0.025, 4, 22), fl.iron, 0, 0.06, 0, { rx: PI / 2, m: 0.45 });
      for (const z of [-1, 1]) { // the cheeks that hold the trunnions
        K.add(G.shape('Dcheek', [[-0.5, 0], [0.5, 0], [0.42, 0.55], [0.12, 0.85], [-0.12, 0.85], [-0.42, 0.55]], 1, 0.05), fl.wood, 0, 0.1, z * r * 1.55, { sx: r * 2.6, sy: r * 2.2, sz: r * 0.45, r: 0.8 });
        K.add(G.cyl(r * 0.32, r * 0.32, r * 0.5, 10), fl.iron, 0, 0.1 + r * 1.75, z * r * 1.55, { rx: PI / 2, m: 0.45 }); // trunnion caps
        K.detail(1, () => { for (const xx of [-1, 1]) K.add(G.cyl(0.02, 0.02, r * 0.5, 6), fl.iron, xx * r * 0.7, 0.1 + r * 0.4, z * r * 1.55, { rx: PI / 2, m: 0.5 }); });
        K.detail(2, () => { K.push(0, 0.1 + r * 0.9, z * (r * 1.55 + r * 0.24), 0, z > 0 ? 0 : PI, 0); emblem(K, st, r * 1.1, { depth: 0.06 }); K.pop(); });
      }
      K.detail(1, () => { K.add(G.box(r * 1.2, r * 0.3, r * 1.4), shade(fl.wood, 0.8), -s * r * 0.9, 0.18, 0, { rz: s * 0.2 }); }); // the quoin
      K.push(s * B * 0.2, 0.3, B * 0.17); deco(K, D, B * 0.18); K.pop();
      // shells and a powder keg beside her
      K.push(-s * B * 0.05, 0, B * 0.36); shotPile(K, r * 0.55, 7); K.pop();
      K.detail(2, () => { K.push(s * B * 0.12, 0, -B * 0.33); cask(K, r * 0.6, r * 1.3, 0x5a3a22); K.pop(); K.bar([-s * r, 0.05, -B * 0.25], [s * r * 2.5, 0.05, -B * 0.25], 0.025, C.wood); K.add(G.cyl(0.05, 0.05, 0.1, 8), 0x2a2a2a, s * r * 2.5, 0.05, -B * 0.25, { rz: PI / 2 }); });
    });
    const piv = D.group(bed, 0, 0.1 + r * 1.75, 0);
    piv.rotation.z = -0.35 * s;
    D.piece(piv, `mbar${s}`, (K) => { barrel(K, D, 'mortar', r, h, { seg: 16 }); K.add(G.cyl(r * 0.32, r * 0.32, r * 3.4, 10), fl.gun, 0, 0, 0, { rx: PI / 2, m: fl.gunM, r: 0.4 }); });
    barrels.push({ piv, s, z0: piv.rotation.z, y0: piv.position.y });
    keep.push([x, 0, B * 0.3]);
    if (s > 0) anchors.mortar = [x + Math.sin(0.35) * h, y + 0.1 + r * 1.75 + Math.cos(0.35) * h, 0];
  }
  acts.mortar = (k) => { const a = kick(k, 0.06, 0.6); for (const b of barrels) { b.piv.rotation.z = b.z0 + b.s * 0.12 * a; b.piv.position.y = b.y0 - 0.08 * a; } };
}

function carrier(D, g, L, B, y, acts, anchors, keep, def) {
  const st = D.st, fl = D.fl, side = D.side;
  const fx = -L * 0.18, flen = L * 0.5, fw = B * 0.95, fy = y + 1.25, top = fy + 0.05;
  const deck = D.group(g, fx, 0, 0);
  D.piece(deck, 'fdeck', (K) => {
    K.add(G.rbox(flen, 0.1, fw, 0.03), fl.wood, 0, fy, 0, { r: 0.85 });
    K.detail(1, () => { for (let i = 1; i < 9; i++) K.add(G.box(flen * 0.99, 0.004, 0.012), shade(fl.wood, 0.7), 0, fy + 0.052, -fw / 2 + (fw * i) / 9); });
    for (const sz of [-1, 1]) { K.add(G.box(flen, 0.06, 0.06), side, 0, fy + 0.06, sz * fw * 0.49, { r: 0.8 }); K.add(G.box(flen * 0.98, 0.03, 0.08), C.cloth, 0, fy + 0.02, sz * fw * 0.49); }
    // the trestles: four legs a side, braced
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.add(G.rbox(0.12, fy - y, 0.12, 0.02), fl.wood, sx * flen * 0.42, (fy + y) / 2, sz * fw * 0.4);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.bar([sx * flen * 0.42, y + 0.1, sz * fw * 0.4], [sx * flen * 0.08, fy - 0.08, sz * fw * 0.4], 0.035, shade(fl.wood, 0.85));
    for (const sz of [-1, 1]) K.add(G.box(flen * 0.86, 0.08, 0.08), shade(fl.wood, 0.85), 0, y + 0.45, sz * fw * 0.4);
    K.detail(1, () => { // a ladder, the catapult winch and rope nets under the edges
      for (const z of [-0.12, 0.12]) K.bar([-flen * 0.52, y, z], [-flen * 0.45, fy, z], 0.02, fl.wood);
      for (let i = 1; i < 8; i++) { const u = i / 8; K.bar([-flen * (0.52 - 0.07 * u), y + (fy - y) * u, -0.12], [-flen * (0.52 - 0.07 * u), y + (fy - y) * u, 0.12], 0.012, fl.wood); }
      K.add(G.cyl(0.1, 0.1, 0.4, 10), fl.wood, -flen * 0.42, top + 0.12, 0, { rx: PI / 2 }).add(G.tor(0.1, 0.03, 4, 10), C.rope, -flen * 0.42, top + 0.12, 0, { s: 1, sz: 3 });
      for (const sz of [-1, 1]) for (let i = 0; i < 7; i++) K.rope([-flen / 2 + (flen * i) / 6, fy, sz * fw * 0.5], [-flen / 2 + (flen * (i + 1)) / 6, fy, sz * fw * 0.5], 0.08, 0.008, C.rope);
    });
    // the catapult rails down the middle
    for (const z of [-0.1, 0.1]) K.add(G.box(flen * 0.9, 0.04, 0.04), fl.iron, 0, top + 0.02, z, { m: 0.45, r: 0.45 });
    K.add(G.box(0.1, 0.18, 0.4), fl.iron, flen * 0.45, top + 0.08, 0, { m: 0.45 }); // the stop at the bow end
    // lanterns at the corners and a pennant
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) { K.push(sx * flen * 0.47, top, sz * fw * 0.44); lantern(K, st, 0.36); K.pop(); }
    K.push(-flen * 0.46, top, -fw * 0.44 + 0.0); K.add(G.cyl(0.02, 0.025, 0.05, 6), C.dark, 0, 0, 0); K.pop();
    K.detail(2, () => { K.push(-flen * 0.4, top, fw * 0.3); banner(K, st, 0.6, 0.34, side); K.pop(); });
    K.detail(2, () => { K.push(0, top + 0.003, -fw * 0.28, -PI / 2, 0, 0); emblem(K, st, Math.min(fw, flen) * 0.3, { depth: 0.01, col: [C.cloth, st.metal] }); K.pop(); });
  });
  const sled = D.group(deck, -flen * 0.38, top + 0.05, 0);
  D.piece(sled, 'fsled', (K) => { K.add(G.rbox(0.36, 0.06, 0.32, 0.015), fl.iron, 0, 0, 0, { m: 0.45, r: 0.45 }).add(G.box(0.06, 0.12, 0.32), fl.iron, -0.16, 0.06, 0, { m: 0.45 }); K.detail(1, () => K.rope([-0.18, 0, 0], [-flen * 0.04 - 0.2, 0.06, 0], 0.0, 0.012, C.rope)); });
  const style = def.squadrons?.flier || 'glider', realm = D.realm;
  const parked = [];
  for (let k = 0; k < 2; k++) {
    const a = buildFlier(style, side, def.squadrons?.color, realm);
    a.scale.setScalar(1.5);
    if (k === 0) a.position.set(0, 0.04, 0); else a.position.set(flen * 0.22, top + 0.04, -fw * 0.22);
    a.traverse((o) => { o.userData.noCrew = true; });
    (k === 0 ? sled : deck).add(a); parked.push(a);
  }
  const f0 = parked[0], sx0 = sled.position.x;
  acts.launch = (k) => {
    // the sled runs to the bow end with the flier, which lifts off; the sled is winched back and another flier rolled on
    const run = ease(Math.min(1, k / 0.3)), back = ease((k - 0.45) / 0.4);
    sled.position.x = sx0 + (flen * 0.8) * (run - back * run);
    const off = Math.max(0, (k - 0.25) / 0.35);
    f0.position.set(off * 2.5, 0.04 + off * off * 2.2, 0);
    f0.rotation.z = Math.min(0.5, off * 0.8);
    f0.visible = k < 0.6 || k > 0.88 || k >= 1;
    if (k > 0.88 && k < 1) { const u = (k - 0.88) / 0.12; f0.position.set(-0.6 * (1 - u), 0.04, 0); f0.rotation.z = 0; }
    if (k >= 1) { f0.position.set(0, 0.04, 0); f0.rotation.z = 0; f0.visible = true; sled.position.x = sx0; }
    animateFlier(f0, k * 4, 0, 0);
  };
  anchors.launch = [fx + flen * 0.45, top + 0.2, 0];
}

function flak(D, g, L, B, y, acts, anchors, keep) {
  const st = D.st, fl = D.fl, mounts = [];
  for (const s of [-1, 1]) {
    const x = s * L * 0.2;
    const base = D.group(g, x, y, 0);
    D.piece(base, `fbase${s}`, (K) => {
      K.add(G.lathe('Dflakb', [[0, 0], [1, 0], [1, 0.18], [0.85, 0.3], [0.8, 0.42], [0, 0.42]], 18), fl.iron, 0, 0, 0, { sx: B * 0.2, sy: 0.5, sz: B * 0.2, m: 0.4, r: 0.5 });
      K.detail(1, () => { for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; K.add(G.sph(0.018, 4, 3), shade(fl.iron, 1.4), Math.cos(a) * B * 0.19, 0.08, Math.sin(a) * B * 0.19, { m: 0.5 }); } });
      // ammunition chests
      for (const z of [-1, 1]) { K.push(-s * B * 0.12, 0, z * B * 0.3); crate(K, B * 0.16, B * 0.1, B * 0.12, shade(fl.wood, 0.9)); K.pop(); }
      K.detail(2, () => { K.push(s * B * 0.24, 0.0, B * 0.24); deco(K, D, B * 0.16); K.pop(); });
    });
    const tur = D.group(base, 0, 0.22, 0);
    D.piece(tur, `fturret${s}`, (K) => {
      K.add(G.cyl(B * 0.15, B * 0.16, 0.12, 14), fl.gun, 0, 0.06, 0, { m: fl.gunM, r: 0.4 });
      // the curved gun shield with the device
      K.add(G.custom(`Dshield${B}${s}`, () => new THREE.CylinderGeometry(B * 0.19, B * 0.19, 0.42, 10, 1, true, (s > 0 ? PI / 2 : -PI / 2) - 0.95, 1.9)), fl.gun, 0, 0.3, 0, { m: fl.gunM, r: 0.45 });
      K.detail(2, () => { K.push(s * B * 0.19, 0.3, 0, 0, s > 0 ? PI / 2 : -PI / 2, 0); emblem(K, st, 0.26, { depth: 0.05 }); K.pop(); });
      for (const z of [-1, 1]) K.add(G.rbox(0.1, 0.32, 0.05, 0.015), fl.iron, 0, 0.26, z * 0.14, { m: 0.45 }); // the cradle's cheeks
      K.detail(1, () => { K.add(G.cyl(0.035, 0.035, 0.1, 6), C.dark, -s * 0.18, 0.2, 0, { rz: PI / 2 }); K.add(G.tor(0.06, 0.01, 3, 10), fl.iron, -s * 0.24, 0.2, 0, { ry: PI / 2, m: 0.5 }); }); // the crank
    });
    const cradle = D.group(tur, 0, 0.32, 0);
    cradle.rotation.z = -0.5 * s;
    const spin = D.group(cradle, 0, 0, 0);
    D.piece(spin, `fguns${s}`, (K) => {
      for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; K.push(Math.cos(a) * 0.075, -0.1, Math.sin(a) * 0.075); barrel(K, D, 'flak', 0.025, 0.85, { seg: 7 }); K.pop(); }
      K.add(G.cyl(0.11, 0.11, 0.05, 12), fl.iron, 0, 0.05, 0, { m: 0.45 }).add(G.cyl(0.11, 0.11, 0.05, 12), fl.iron, 0, 0.5, 0, { m: 0.45 }).add(G.cyl(0.12, 0.1, 0.18, 12), fl.gun, 0, -0.12, 0, { m: fl.gunM });
    });
    mounts.push({ tur, cradle, spin, s, z0: cradle.rotation.z });
    keep.push([x, 0, B * 0.28]);
    if (s > 0) anchors.flak = [x + Math.sin(0.5) * 0.9, y + 0.54 + Math.cos(0.5) * 0.9, 0];
  }
  acts.flak = (k) => {
    for (const M of mounts) {
      M.spin.rotation.y = k * PI * 2 * 3;
      const j = k < 1 ? Math.sin(k * 70) * 0.04 * (1 - k) : 0;
      M.cradle.rotation.z = M.z0 + M.s * j;
      M.tur.rotation.y = Math.sin(k * PI) * 0.18 * M.s;
    }
  };
}

function hunter(D, g, L, B, y, acts, anchors, keep) {
  const st = D.st, fl = D.fl, x = L * 0.36;
  const base = D.group(g, x, y, 0);
  D.piece(base, 'hbase', (K) => {
    K.add(G.lathe('Dhped', [[0, 0], [0.2, 0], [0.18, 0.05], [0.11, 0.1], [0.09, 0.28], [0.12, 0.32], [0, 0.32]], 12), fl.wood, 0, 0, 0, { r: 0.8 });
    K.add(G.tor(0.12, 0.018, 4, 12), fl.iron, 0, 0.3, 0, { rx: PI / 2, m: 0.45 });
    K.detail(1, () => { for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; K.add(G.box(0.05, 0.12, 0.02), fl.iron, Math.cos(a) * 0.14, 0.05, Math.sin(a) * 0.14, { ry: -a, m: 0.4 }); } });
  });
  const yoke = D.group(base, 0, 0.32, 0);
  D.piece(yoke, 'hyoke', (K) => { for (const z of [-1, 1]) K.add(G.shape('Dyoke', [[-0.06, 0], [0.06, 0], [0.04, 0.16], [-0.04, 0.16]], 0.03), fl.iron, 0, 0, z * 0.1, { m: 0.45 }); K.add(G.box(0.12, 0.03, 0.24), fl.iron, 0, 0.0, 0, { m: 0.45 }); });
  const gun = D.group(yoke, 0, 0.14, 0);
  gun.rotation.z = 0.25;
  D.piece(gun, 'hgun', (K) => {
    K.push(-0.25, 0, 0, 0, 0, -PI / 2); barrel(K, D, 'harp', 0.055, 0.85, { seg: 12 }); K.pop();
    K.add(G.cyl(0.03, 0.03, 0.26, 8), fl.gun, 0, 0, 0, { rx: PI / 2, m: fl.gunM });
    K.add(G.rbox(0.28, 0.06, 0.08, 0.02), fl.wood, -0.38, -0.03, 0); // the stock
    K.detail(1, () => { for (const z of [-1, 1]) K.bar([-0.42, 0, z * 0.04], [-0.5, 0.02, z * 0.14], 0.012, fl.wood); K.add(G.tor(0.02, 0.006, 3, 8), fl.iron, -0.3, -0.07, 0, { m: 0.5 }); });
    K.detail(2, () => { K.push(0.15, 0, 0.068, 0, 0, 0); emblem(K, st, 0.09, { depth: 0.08 }); K.pop(); K.push(0.15, 0, -0.068, 0, PI, 0); emblem(K, st, 0.09, { depth: 0.08 }); K.pop(); });
  });
  const harp = D.group(gun, 0.6, 0, 0);
  D.piece(harp, 'hharp', (K) => {
    K.bar([-0.2, 0, 0], [0.12, 0, 0], 0.014, 0x8a7a5a);
    K.add(G.cone(0.035, 0.14, 8), 0x9aa2aa, 0.18, 0, 0, { rz: -PI / 2, m: 0.55, r: 0.3 });
    for (const a of [0, PI]) K.add(G.cone(0.012, 0.09, 4), 0x9aa2aa, 0.13, Math.cos(a) * 0.035, 0, { rz: (a ? -1 : 1) * 2.4, m: 0.55 }); // barbs
  });
  // the coil of line on its drum, which pays out when she fires
  const coil = D.group(base, -0.45, 0.02, 0);
  D.piece(coil, 'hcoil', (K) => {
    for (let i = 0; i < 4; i++) K.add(G.tor(0.18 - i * 0.008, 0.035, 5, 16), C.rope, 0, 0.035 + i * 0.06, 0, { rx: PI / 2, r: 0.95 });
    K.add(G.cyl(0.13, 0.13, 0.28, 12), shade(fl.wood, 0.8), 0, 0.14, 0);
    K.detail(1, () => K.rope([0.1, 0.25, 0], [0.45, 0.46, 0], 0.08, 0.008, C.rope));
  });
  keep.push([x, 0, 0.5], [x - 0.45, 0, 0.3]);
  // fire barrels and a rack of flensing lances astern
  D.piece(g, 'hstern', (K) => {
    for (let k = 0; k < 2; k++) { K.push(-L * 0.36, y, (k - 0.5) * 0.4); cask(K, 0.17, 0.36, k ? 0x6b4a2e : 0x5a3a22); K.detail(1, () => K.add(G.cyl(0.006, 0.006, 0.12, 4), C.rope, 0.05, 0.4, 0.04, { rz: 0.4 })); K.add(G.cyl(0.03, 0.03, 0.02, 6), C.fire, 0, 0.37, 0, { g: 1.2, lv: 1 }); K.pop(); }
    K.detail(1, () => { K.push(-L * 0.25, y, -B * 0.3); for (let i = 0; i < 4; i++) K.bar([i * 0.08, 0.02, 0], [i * 0.08 + 0.05, 0.9, 0.02], 0.012, fl.wood); K.add(G.box(0.4, 0.04, 0.06), fl.wood, 0.12, 0.6, 0.02); K.pop(); });
    K.push(L * 0.36 + 0.3, y, B * 0.18); deco(K, D, 0.3); K.pop();
  });
  const g0 = gun.rotation.z, gx = gun.position.x;
  acts.harpoon = (k) => {
    const a = kick(k, 0.05, 0.5);
    gun.rotation.z = g0 + 0.12 * a; gun.position.x = gx - 0.06 * a;
    harp.visible = k <= 0.02 || k >= 0.8;
    harp.position.x = k > 0.8 && k < 1 ? 0.6 - 0.3 * (1 - (k - 0.8) / 0.2) : 0.6;
    coil.rotation.y = k < 1 ? -k * PI * 6 : 0;
  };
  anchors.harpoon = [x + Math.cos(0.25) * 0.8, y + 0.46 + Math.sin(0.25) * 0.8, 0];
}

function troop(D, g, L, B, y, acts, anchors, keep) {
  const st = D.st, fl = D.fl, side = D.side;
  D.piece(g, 'tstores', (K) => {
    for (let k = 0; k < 6; k++) { K.push(-L * 0.05 + (k % 3 - 1) * 0.42, y + (k > 2 ? 0.34 : 0), B * 0.22); crate(K, 0.38, 0.32, 0.38, k % 2 ? 0x8a6a44 : 0x6b4a2e); K.pop(); }
    for (let k = 0; k < 3; k++) { K.push(-L * 0.05 + (k - 1) * 0.36, y, -B * 0.24); cask(K, 0.17, 0.36, 0x5a3a24); K.pop(); }
    K.detail(1, () => { // sacks on the crates, and the lashing over the stack
      for (let k = 0; k < 4; k++) K.add(G.sph(0.13, 8, 6), 0xc8b088, -L * 0.05 + (k - 1.5) * 0.28, y + 0.72, B * 0.22 + (k % 2 - 0.5) * 0.1, { sy: 0.6, r: 1 });
      for (const dx of [-0.42, 0.42]) K.rope([-L * 0.05 + dx, y, B * 0.22 - 0.25], [-L * 0.05 + dx, y, B * 0.22 + 0.25], -0.75, 0.012, C.rope);
    });
    K.push(-L * 0.05, y + 0.72, -B * 0.24); deco(K, D, 0.35); K.pop();
  });
  // the command banner on its staff, swaying
  const ban = D.group(g, -L * 0.42, y, 0);
  const bh = 0.9 + L * 0.12;
  D.piece(ban, 'tbanner', (K) => { banner(K, st, bh, bh * 0.55, side); });
  // the aura lantern on its post at the stern, with a halo that pulses
  const lx = -L * 0.38 + 0.0, lz = B * 0.18;
  D.piece(g, 'tlamp', (K) => {
    K.add(G.cyl(0.04, 0.05, 0.7, 8), fl.wood, lx, y + 0.35, lz);
    K.push(lx, y + 0.7, lz); lantern(K, st, 0.55); K.pop();
    K.detail(1, () => { K.push(lx, y, lz); motif(K, st, 0.3); K.pop(); });
  });
  const halo = new THREE.Mesh(G.sph(0.32, 12, 8), new THREE.MeshBasicMaterial({ color: st.glow, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.set(lx, y + 0.98, lz); halo.userData.noCrew = true; g.add(halo);
  keep.push([-L * 0.05, B * 0.22, 0.7], [-L * 0.05, -B * 0.24, 0.6], [lx, lz, 0.25]);
  acts.aura = (k) => {
    const p = Math.sin(k * PI);
    halo.scale.setScalar(1 + p * 2.2); halo.material.opacity = 0.22 + p * 0.35;
    ban.rotation.y = Math.sin(k * PI * 3) * 0.25 * p;
  };
  anchors.aura = [lx, y + 0.98, lz];
}

function landing(D, g, L, B, y, acts, anchors, keep) {
  const st = D.st, fl = D.fl, side = D.side, rl = B * 0.62, rw = B * 0.62, px = L * 0.42;
  const piv = D.group(g, px, y + 0.05, 0);
  const rest = -0.3;
  piv.rotation.z = rest;
  D.piece(piv, 'lramp', (K) => {
    K.add(G.rbox(0.07, rl, rw, 0.02), fl.wood, 0.0, rl / 2, 0, { r: 0.85 });
    K.detail(1, () => { for (let i = 1; i < 7; i++) K.add(G.box(0.05, 0.03, rw * 0.92), shade(fl.wood, 0.75), 0.045, (rl * i) / 7, 0); }); // cleats
    for (const z of [-1, 1]) K.add(G.box(0.12, rl, 0.05), shade(fl.wood, 0.85), 0.02, rl / 2, z * rw * 0.5); // side rails
    K.add(G.box(0.09, 0.08, rw * 1.02), fl.iron, 0.0, rl, 0, { m: 0.45 }); // the iron lip
    K.detail(1, () => { for (const z of [-1, 1]) K.add(G.tor(0.04, 0.01, 3, 8), fl.iron, -0.04, rl * 0.95, z * rw * 0.42, { m: 0.5 }); });
    // her faction's device painted on the face that shows while the ramp is up
    K.detail(2, () => { K.push(0.04, rl * 0.55, 0, 0, PI / 2, 0); emblem(K, st, rw * 0.5, { depth: 0.03, col: [side, st.metal] }); K.pop(); });
    K.push(0.03, rl, 0, 0, 0, 0); deco(K, D, 0.22); K.pop();
  });
  D.piece(g, 'lgallows', (K) => {
    for (const z of [-1, 1]) K.add(G.rbox(0.09, 1.2, 0.09, 0.02), fl.wood, px - 0.35, y + 0.6, z * rw * 0.55);
    K.add(G.box(0.1, 0.1, rw * 1.2), fl.wood, px - 0.35, y + 1.2, 0);
    for (const z of [-1, 1]) { K.add(G.cyl(0.05, 0.05, 0.04, 10), fl.iron, px - 0.35, y + 1.2, z * rw * 0.42, { rx: PI / 2, m: 0.45 }); K.push(px - 0.35, y + 1.28, z * rw * 0.55); finial(K, st, 0.25); K.pop(); }
    // pavises along the rails
    K.detail(2, () => { for (let i = 0; i < 4; i++) for (const z of [-1, 1]) { K.push(-L * 0.3 + i * L * 0.16, y + 0.2, z * B * 0.43, 0, z > 0 ? 0 : PI, 0); K.add(G.shape('Dpavise', [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.4], [0, 0.55], [-0.5, 0.4]], 0.06), i % 2 ? side : st.cloth, 0, 0, 0, { s: 0.36, r: 0.85 }); K.push(0, 0, 0.012); emblem(K, st, 0.2, { depth: 0.05, col: [st.cloth2, st.metal] }); K.pop(); K.pop(); } });
  });
  // the chains from the gallows to the ramp's lip (redrawn as it moves)
  const chainM = new THREE.LineBasicMaterial({ color: 0x2a2a2e });
  const chains = [-1, 1].map((z) => { const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]); const l = new THREE.Line(geo, chainM); l.userData.noCrew = true; l.userData.z = z * rw * 0.42; g.add(l); return l; });
  const lipW = new THREE.Vector3();
  const setChains = () => {
    for (const l of chains) {
      lipW.set(-0.04, rl * 0.95, 0).applyEuler(piv.rotation).add(piv.position); lipW.z = l.userData.z;
      const P = l.geometry.attributes.position; P.setXYZ(0, px - 0.35, y + 1.2, l.userData.z); P.setXYZ(1, lipW.x, lipW.y, lipW.z); P.needsUpdate = true; l.geometry.computeBoundingSphere();
    }
  };
  setChains();
  keep.push([px - 0.2, 0, rw * 0.6]);
  const drop = (k) => {
    const down = ease(k / 0.22) * (1 - ease((k - 0.78) / 0.22));
    piv.rotation.z = rest + (-(PI / 2 + 0.35) - rest) * down;
    setChains();
  };
  acts.beach = drop;
  acts.board = drop;
  anchors.ramp = [px + rl * 0.9, y, 0];
}

const RAMS = {
  beak: (K, D, r, l) => { K.add(G.lathe('Drbeak', [[0, 0], [1, 0.05], [0.9, 0.4], [0.5, 0.8], [0, 1]], 12), D.fl.gun, 0, 0, 0, { sx: r, sz: r, sy: l, rz: -PI / 2, m: D.fl.gunM, r: 0.35 }); K.detail(1, () => { for (const y of [-1, 0, 1]) K.add(G.box(l * 0.55, 0.03, r * 2.3), shade(D.fl.gun, 0.85), l * 0.45, y * r * 0.45, 0, { m: D.fl.gunM }); }); },
  spikelog: (K, D, r, l) => { K.add(G.cyl(r * 0.8, r, l, 10), 0x5a4a36, l / 2, 0, 0, { rz: PI / 2 }); K.add(G.cone(r * 0.8, r * 1.2, 8), 0x5a5048, l + r * 0.6, 0, 0, { rz: -PI / 2, m: 0.4 }); for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; K.add(G.cone(r * 0.12, r * 0.6, 4), 0x6a6a62, l * (0.4 + (i % 2) * 0.3), Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, { rx: a - PI / 2, m: 0.4 }); } K.add(G.tor(r * 0.85, r * 0.08, 3, 10), 0x4a4038, l * 0.2, 0, 0, { ry: PI / 2 }); },
  skull: (K, D, r, l) => { K.add(G.cone(r * 0.9, l, 8), 0x2e2e34, l / 2, 0, 0, { rz: -PI / 2, m: 0.45 }); K.add(G.sph(r * 1.0, 10, 8), C.bone, l * 0.2, r * 0.6, 0, { sy: 0.9 }); K.add(G.box(r * 0.9, r * 0.5, r * 1.1), C.bone, l * 0.32, r * 0.05, 0); for (const z of [-1, 1]) K.add(G.sph(r * 0.22, 6, 4), D.st.glow, l * 0.2 + r * 0.85, r * 0.7, z * r * 0.35, { g: 2 }); },
  horns: (K, D, r, l) => { K.add(G.cone(r * 0.9, l, 8), 0x1e1a1e, l / 2, 0, 0, { rz: -PI / 2, m: 0.5 }); for (const z of [-1, 1]) K.add(taper(`Drhorn${z}`, [[0, 0, 0], [0.4, 0.3, z * 0.5], [0.9, 0.2, z * 0.7], [1.2, 0.5, z * 0.6]], [0.18, 0.02], 10, 6), C.bone, 0, 0, 0, { s: r * 1.4 }); K.add(G.sph(r * 0.3, 6, 4), C.fire, l * 0.2, r * 0.5, 0, { g: 2.2 }); },
  tusk: (K, D, r, l) => { K.add(taper('Drtusk', [[0, 0, 0], [0.5, -0.05, 0], [1.0, 0.05, 0], [1.3, 0.3, 0]], [0.35, 0.02], 12, 8), C.bone, 0, 0, 0, { s: l * 0.8 }); K.add(G.tor(r * 0.7, r * 0.1, 3, 10), 0x5a3a22, l * 0.12, 0, 0, { ry: PI / 2 }); },
  wedge: (K, D, r, l) => { K.add(G.cone(r * 1.1, l, 4), D.fl.gun, l / 2, 0, 0, { rz: -PI / 2, ry: PI / 4, sy: 1, r: 0.5 }); K.add(G.oct(r * 0.5), D.st.glow, l * 0.75, 0, 0, { sx: 2.2, g: 1.8, r: 0.2 }); },
  dragon: (K, D, r, l) => {
    K.add(G.lathe('Drdrag', [[0, 0], [1, 0.05], [1.05, 0.45], [0.7, 0.75], [0.35, 1]], 12), D.fl.gun, 0, 0, 0, { sx: r, sz: r * 0.85, sy: l, rz: -PI / 2, m: D.fl.gunM, r: 0.35 });
    K.add(G.box(l * 0.55, r * 0.3, r * 1.3), shade(D.fl.gun, 0.8), l * 0.75, -r * 0.35, 0, { m: D.fl.gunM }); // the jaw
    for (const z of [-1, 1]) { K.add(G.sph(r * 0.16, 6, 4), D.st.glow, l * 0.55, r * 0.55, z * r * 0.45, { g: 2 }); K.add(taper(`Drdh${z}`, [[0, 0, 0], [-0.4, 0.3, z * 0.3], [-0.9, 0.45, z * 0.35]], [0.12, 0.01], 8, 5), C.bone, l * 0.45, r * 0.6, 0, { s: r * 1.3 }); }
    K.detail(1, () => { for (let i = 0; i < 5; i++) for (const z of [-1, 1]) K.add(G.cone(r * 0.06, r * 0.25, 4), C.bone, l * (0.6 + i * 0.07), -r * 0.15, z * r * 0.5, { rz: PI }); });
  },
};
function ram(D, g, L, B, y, acts, anchors) {
  const r = B * 0.14, l = L * 0.12, x0 = L * 0.5 - l * 0.15;
  const grp = D.group(g, x0, -B * 0.05, 0);
  D.piece(grp, `ram${D.fl.ram}`, (K) => {
    (RAMS[D.fl.ram] || RAMS.beak)(K, D, r, l);
    K.detail(1, () => { K.push(l * 0.05, r * 0.2, r * 1.05); emblem(K, D.st, r * 1.0, { depth: 0.05 }); K.pop(); K.push(l * 0.05, r * 0.2, -r * 1.05, 0, PI, 0); emblem(K, D.st, r * 1.0, { depth: 0.05 }); K.pop(); });
  });
  acts.ram = (k) => { grp.position.x = x0 + 0.25 * kick(k, 0.15, 0.7); };
  anchors.ram = [x0 + l, -B * 0.05, 0];
}

const ROLE = { siege, carrier, flak, hunter, troop, landing };

/**
 * fits a ship model out for her role; returns footprints [x, z, r] where no hand should stand.
 * faction (optional): the side's faction or realm, for a plain role hull whose def names none; when it is not known
 * yet she is dressed in a plain style and model.userData.styleFaction(faction) dresses her again (the crew system
 * calls it the first time a battle list names her side's faction)
 */
export function dressRole(m, def, sideColor, deckY, faction) {
  const keep = [];
  const realm = realmOf(def, faction);
  build(m, def, sideColor, deckY, realm, keep);
  if (!realm) m.userData.styleFaction = (f) => { if (realmLook(f).id) build(m, def, sideColor, deckY, f, []); };
  return keep;
}

function build(m, def, sideColor, deckY, realm, keep) {
  const ud = m.userData;
  // undress whatever an earlier call put on her
  const old = ud.roleDress;
  if (old) {
    m.remove(old.g);
    if (ud.lod) ud.lod.meshes = ud.lod.meshes.filter((e) => !old.lods.includes(e));
    if (ud.actions) for (const k of old.acts) if (ud.actions[k] === old.fns[k]) delete ud.actions[k];
  }
  const L = def.len, B = def.beam, y = deckY, g = new THREE.Group();
  g.userData.noCrew = true;
  const look = realmLook(realm), st = look.st, fl = flavorOf(look.id);
  const D = new Dress(m, `${def.id}|${def.role}|${look.id}|${sideColor}|${L}|${B}|${y.toFixed(2)}`, st, fl, sideColor);
  D.realm = look.id;
  const acts = {}, anchors = {};
  const fn = ROLE[def.role];
  if (fn) fn(D, g, L, B, y, acts, anchors, keep, def);
  else if (def.ram) ram(D, g, L, B, y, acts, anchors);
  // every fitting shudders when she is hit
  const hit = (k) => { g.position.y = Math.sin(k * 40) * 0.03 * (1 - k); };
  m.add(g);
  // detail levels: join her own table (made here if her hull has none)
  const lod = ud.lod || (ud.lod = { meshes: [], far: null, level: 0, levels: 6 });
  for (const e of D.lods) {
    lod.meshes.push(e);
    const far = lod.far && lod.level === lod.levels - 1, geo = e.geos[Math.min(lod.level, e.geos.length - 1)];
    e.mesh.visible = !far && geo !== EMPTY_GEO; if (e.mesh.visible) e.mesh.geometry = geo;
  }
  // actions: hers are kept, and called too for the ones we share
  const A = ud.actions || (ud.actions = {});
  const fns = {};
  for (const [k, f] of Object.entries({ ...acts, hit })) {
    const prev = A[k] && !(old && old.fns[k] === A[k]) ? A[k] : null;
    fns[k] = prev ? (kk, mm) => { prev(kk, mm); f(kk, mm); } : f;
    A[k] = fns[k];
  }
  const an = ud.anchors || (ud.anchors = {});
  const base = { bow: [L * 0.5, y, 0], stern: [-L * 0.5, y, 0], deckL: [0, y, -B * 0.42], deckR: [0, y, B * 0.42] };
  for (const [k, v] of Object.entries({ ...base, ...anchors })) if (!an[k] || anchors[k]) an[k] = v;
  ud.roleDress = { g, lods: D.lods, acts: Object.keys(fns), fns };
}

// ------------------------------------------------------------------ fliers and squadrons
/** the realm a ship or squadron def belongs to: its realm field, its faction, or the prefix of its id (`graal_carrier_squadron`) */
export function realmOf(def, faction) {
  if (!def) return faction || null;
  if (def.realm) return def.realm;
  if (def.faction) return def.faction;
  const pre = String(def.id || '').split('_')[0];
  return realmLook(pre).id ? pre : faction || null;
}

/** one flier of a carrier's style (glider gyro beast bird bat pegasus griffon dragon carpet disc insect kite),
 *  ridden by a figure in the side's colour; color tints its body and wings when given; realm (optional) dresses
 *  the rider, helm, weapon and tack in that realm's (or original faction's) style */
export function buildFlier(style, sideColor, color, realm) {
  return makeFlier(style, sideColor, color, realm);
}

/** a squadron in the air: three fliers in a loose vee. faction: the side's faction, for carriers whose def does not name a realm */
export function buildSquadron(def, sideColor, faction) {
  const g = new THREE.Group(), style = def.flier || 'glider', realm = realmOf(def, faction);
  const slots = [[0.8, 0], [-0.7, 1.55], [-0.7, -1.55]];
  g.userData.fliers = slots.map(([x, z], i) => {
    const f = buildFlier(style, sideColor, def.color, realm);
    f.scale.setScalar(1.5); f.position.set(x, i * 0.15, z); g.add(f);
    return f;
  });
  g.userData.top = 1.2;
  // the attack run: the effects code may drive it (fx.act(m, 'dive' | 'strafe', dur)); animateSquadron also sees a fast
  // descent of the squadron itself and folds the fliers into it
  const sq = g.userData;
  sq.actions = {
    dive: (k) => { sq.diveAct = k >= 1 ? 0 : k < 0.55 ? Math.min(1, k / 0.2) : -Math.sin(((k - 0.55) / 0.45) * PI) * 0.8; }, // stoop, then pull up
    strafe: (k) => { sq.diveAct = k >= 1 ? 0 : Math.sin(k * PI) * 0.8; },
  };
  sq.anchors = { bow: [1.6, 0.4, 0], stern: [-1.4, 0.4, 0], talons: [0.8, -0.1, 0], mouth: [1.6, 0.6, 0] };
  return g;
}

/** flies a squadron: each flier bobs and rocks on its own; a dive (fast descent, or the dive/strafe action) folds wings and pitches noses down */
export function animateSquadron(m, t, phase, alive = 3) {
  const sq = m.userData;
  // how fast the squadron itself is falling or climbing (the view moves it down on a strafing run)
  const y = m.position.y;
  if (sq.prevT !== undefined && t > sq.prevT) {
    const vy = (y - sq.prevY) / (t - sq.prevT), k = Math.min(1, (t - sq.prevT) * 6);
    sq.vy = (sq.vy ?? 0) + (vy - (sq.vy ?? 0)) * k;
  }
  sq.prevY = y; sq.prevT = t;
  const fall = Math.max(-1, Math.min(1, -(sq.vy ?? 0) / 4));
  const dive = Math.abs(sq.diveAct || 0) > Math.abs(fall) ? sq.diveAct : fall;
  sq.fliers.forEach((f, i) => {
    f.visible = i < alive;
    if (!f.visible) return;
    f.position.y = i * 0.15 + Math.sin(t * 2.2 + phase + i) * 0.12 * (1 - Math.max(0, dive));
    f.rotation.x = Math.sin(t * 1.3 + phase + i * 2) * 0.06; // each rocks a little on its own
    animateFlier(f, t, phase + i * 1.9, Math.max(-1, Math.min(1, dive * (1 - i * 0.08))));
  });
}
