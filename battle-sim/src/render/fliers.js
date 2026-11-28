// The fliers a carrier launches, one builder per style, each with its rider in the side's colour and the realm's
// harness, helm and arms. Every flier faces +x with its wings along z and its lowest point near y = 0, so it can
// also sit parked on a flight deck.
//
// Each rigid piece (body, each wing panel, rotor, rider, ...) is one merged sculpt mesh (parts/kit.js) with six
// detail levels; a flier picks its own level from its distance to the camera every frame it is drawn
// (flierLod), dropping feathers, rivets, tack and the rider's gear first. Moving parts carry plain tags in
// userData.fx (so clones keep them):
//   wing  flaps about x        { k: 'wing', s, amp, speed, base, off, fold }   (fold: how far it sweeps back in a dive)
//   spin  turns on one axis    { k: 'spin', axis, speed }
//   sway  rocks on one axis    { k: 'sway', axis, amp, speed, off }
//   glow  pulses its emissive  { k: 'glow', base, amp, speed }
//   rider leans into a dive    { k: 'rider' }
//   lance dips in a dive       { k: 'lance' }
// animateFlier(f, t, p, dive) reads those tags; dive (0..1) folds the wings, pitches the nose down and crouches the
// rider over the neck; a negative dive (-1..0) is the pull-up after it (wings spread, hard beats).
import * as THREE from 'three';
import { Kit, G, C, shade, blend, loftL, taper, clothPanel, EMPTY_GEO } from './parts/kit.js';
import { emblem } from './parts/realmStyle.js';
import { sculptMaterial } from './sculpt.js';
import { realmLook } from './crews.js';

const PI = Math.PI;
const f3 = (v) => (typeof v === 'number' ? v.toFixed(3) : String(v));
/** a flat plate from [x, z] points (z mirrored when s = -1), lying in the xz plane (cached) */
const flat = (key, pts, s = 1) => G.custom(`Ffl${key}${s}`, () => {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z * s)));
  const g = new THREE.ShapeGeometry(shape).rotateX(PI / 2);
  g.computeVertexNormals();
  return g;
});
let glassMat = null, discMat = null;
function glass() {
  if (!glassMat) { glassMat = sculptMaterial().clone(); glassMat.transparent = true; glassMat.opacity = 0.42; glassMat.depthWrite = false; }
  return glassMat;
}
function rotorDiscMat() { return discMat || (discMat = new THREE.MeshBasicMaterial({ color: 0xd8d0c0, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })); }

// ------------------------------------------------------------------ building blocks
/** a part: a group at (x, y, z) with one merged kit mesh, registered on the flier for its LOD */
class Build {
  constructor(key, side, color, look) { this.key = key; this.side = side; this.color = color; this.look = look; this.lods = []; this.root = new THREE.Group(); }
  /** fn(K) draws into a fresh kit; the mesh goes into parent (a group) and is cached by name */
  part(parent, name, fn, material = sculptMaterial()) {
    const K = new Kit();
    fn(K);
    if (K.empty) return null;
    const mesh = K.mesh(material, `flier|${this.key}|${name}`);
    mesh.castShadow = material === sculptMaterial();
    parent.add(mesh);
    this.lods.push({ mesh, geos: mesh.userData.lodGeos });
    return mesh;
  }
  group(parent, x = 0, y = 0, z = 0, fx = null) { const g = new THREE.Group(); g.position.set(x, y, z); if (fx) g.userData.fx = fx; parent.add(g); return g; }
}

/** a feathered wing panel in its pivot's space: the inner (arm) panel or the outer (hand) panel with its primaries */
function featherPanel(K, key, s, o) {
  const { span, chord, col, dark, tipCol = shade(dark, 0.7), outer } = o;
  const lead = chord * 0.42, trail = -chord * 0.58;
  // the covert panel (coloured like the body) and the flight feathers under it
  if (!outer) {
    K.add(flat(`${key}cov`, [[lead, 0], [lead * 0.95, span], [trail * 0.45, span], [trail * 0.5, 0]], s), col, 0, 0.012, 0, { r: 0.85 });
    K.add(flat(`${key}sil`, [[lead, 0], [lead * 0.95, span], [trail * 1.15, span], [trail * 1.2, 0]], s), dark, 0, 0, 0, { r: 0.9, from: 2 });
    K.detail(1, () => {
      const n = Math.max(5, Math.round(span / 0.06));
      for (let i = 0; i < n; i++) {
        const z = (i + 0.5) / n * span, len = chord * (0.62 + 0.08 * Math.sin(i * 1.7));
        K.add(flat(`${key}sec${f3(len)}`, [[0, 0], [0.035, len * 0.1], [0.032, len * 0.85], [0, len], [-0.03, len * 0.9], [-0.034, len * 0.1]], s), i % 2 ? dark : shade(dark, 0.9), trail * 0.25, 0.006 - i * 0.0004, s * z, { ry: -s * (PI / 2 + 0.05), r: 0.9 });
      }
      // a row of lesser coverts, scalloped
      for (let i = 0; i < n; i++) K.add(G.sph(chord * 0.11, 5, 3), col, trail * 0.42, 0.012, s * (i + 0.5) / n * span, { sx: 1, sy: 0.2, sz: 1.2, r: 0.85 });
    });
    return;
  }
  // the hand: a tapering covert, primaries fanned from the wrist and the alula
  K.add(flat(`${key}hand`, [[lead, 0], [lead * 0.5, span * 0.6], [0, span * 0.72], [trail * 0.4, span * 0.4], [trail * 0.5, 0]], s), col, 0, 0.012, 0, { r: 0.85 });
  K.add(flat(`${key}hsil`, [[lead, 0], [lead * 0.3, span * 0.7], [-chord * 0.1, span * 1.0], [-chord * 0.4, span * 0.95], [trail * 1.1, span * 0.5], [trail * 1.15, 0]], s), dark, 0, 0, 0, { r: 0.9, from: 2 });
  K.detail(1, () => {
    const n = o.n ?? 7;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), b = 0.15 + u * 1.05, len = span * (1.0 - u * 0.42), wd = 0.034 + u * 0.01;
      const geo = flat(`${key}pri${f3(len)}${f3(wd)}`, [[0, 0], [wd, len * 0.12], [wd * 0.9, len * 0.78], [wd * 0.25, len], [-wd * 0.6, len * 0.92], [-wd, len * 0.12]], s);
      const ox = lead * 0.2 - u * chord * 0.55, oz = s * span * (0.35 - u * 0.12);
      K.add(geo, u < 0.5 ? dark : shade(dark, 0.92), ox, 0.007 - i * 0.0006, oz, { ry: -s * b, r: 0.9 });
      K.add(flat(`${key}tip${f3(len)}${f3(wd)}`, [[wd * 0.6, len * 0.8], [wd * 0.25, len], [-wd * 0.6, len * 0.92], [-wd * 0.8, len * 0.8]], s), tipCol, ox, 0.0075 - i * 0.0006, oz, { ry: -s * b, r: 0.9 });
    }
    K.add(flat(`${key}alula`, [[0, 0], [0.03, span * 0.2], [0, span * 0.36], [-0.03, span * 0.2]], s), col, lead * 0.9, 0.014, s * 0.01, { ry: -s * 0.2 });
  });
}

/** a membrane wing panel: bones (arm or fingers) along the leading edge and fingertips, membrane scalloped between */
function membranePanel(K, key, s, o) {
  const { pts, bones, memb, bone, r = 0.014 } = o;
  K.add(flat(`${key}m`, pts, s), memb, 0, 0, 0, { r: 0.75 });
  for (const [a, b] of bones) {
    const A = [a[0], 0.008, s * a[1]], B = [b[0], 0.008, s * b[1]], M = [(a[0] + b[0]) / 2 + 0.01, 0.014, s * (a[1] + b[1]) / 2];
    K.add(taper(`F${key}b${a}${b}${s}`, [A, M, B], [r, r * 0.35], 6, 5), bone, 0, 0, 0, { r: 0.6, lv: 3 });
  }
  K.detail(1, () => { // a few creases in the skin
    for (const [a, b] of bones.slice(1)) K.add(taper(`F${key}c${a}${b}${s}`, [[a[0], 0.004, s * a[1]], [(a[0] * 0.3 + b[0] * 0.7), 0.004, s * (a[1] * 0.3 + b[1] * 0.7)]], [r * 0.25, r * 0.1], 3, 3), shade(memb, 0.75));
  });
}

/** two wings, each an inner panel and an outer panel on their own pivots */
function wings(B, g, name, { at, joint, amp = 0.55, speed = 6, base = -0.1, lag = 0.7, fold = 1, inner, outer }) {
  for (const s of [-1, 1]) {
    const pv = B.group(g, at[0], at[1], s * at[2], { k: 'wing', s, amp, speed, base, fold });
    B.part(pv, `${name}i${s}`, (K) => inner(K, s));
    const pv2 = B.group(pv, joint[0], 0, s * joint[1], { k: 'wing', s, amp: amp * 0.7, speed, base: base * 0.5, off: -lag, fold: fold * 0.9, outer: true });
    B.part(pv2, `${name}o${s}`, (K) => outer(K, s));
    pv.rotation.x = s * base;
  }
}

/** a leg as a bent tube through pts with a foot or hoof; claws: n toes */
function limb(K, key, pts, r0, r1, col, foot) {
  K.add(taper(`Flimb${key}`, pts, [r0, r0 * 0.75, r1], 10, 6), col, 0, 0, 0, { r: 0.75 });
  const e = pts[pts.length - 1];
  if (!foot) return;
  if (foot.hoof) K.add(G.cyl(r1 * 1.1, r1 * 1.4, r1 * 1.6, 7), foot.hoof, e[0], e[1] - r1 * 0.6, e[2], { r: 0.5 });
  else {
    const n = foot.toes ?? 3;
    K.detail(2, () => { for (let i = 0; i < n; i++) { const a = (i - (n - 1) / 2) * 0.45; K.add(taper(`Ftoe${key}${i}`, [[e[0], e[1], e[2]], [e[0] + Math.cos(a) * r1 * 2.6, e[1] - r1 * 0.8, e[2] + Math.sin(a) * r1 * 2.6], [e[0] + Math.cos(a) * r1 * 3.4, e[1] - r1 * 1.6, e[2] + Math.sin(a) * r1 * 3.2]], [r1 * 0.45, r1 * 0.1], 5, 4), foot.claw ?? C.bone, 0, 0, 0, { r: 0.5 }); } });
  }
}

/** a saddle with a realm-trimmed cantle and pommel, a saddle cloth bearing the realm's device on both flanks, girth and stirrups */
function saddle(K, B, x, y, o = {}) {
  const st = B.look.st, len = o.len ?? 0.22, w = o.w ?? 0.15, drop = o.drop ?? 0.14, leather = o.leather ?? 0x5a3a22;
  K.push(x, y, 0);
  K.add(G.rbox(len, 0.03, w, 0.012, 2), leather, 0, 0.01, 0, { r: 0.6 });
  K.add(G.cyl(w * 0.45, w * 0.5, 0.06, 8, false), leather, -len * 0.45, 0.045, 0, { rz: PI / 2, sx: 0.5, sz: 1, r: 0.6 }); // the cantle
  K.add(G.sph(0.022, 6, 4), st.metal, len * 0.48, 0.05, 0, { m: st.metalM, r: 0.35 }); // the pommel
  // the saddle cloth hangs down each flank in the realm's colours, trimmed, with its device
  for (const s of [-1, 1]) {
    K.push(0, -drop * 0.45, s * (w * 0.5 + (o.flank ?? 0.02)), o.tilt ? s * o.tilt : 0, 0, 0);
    K.add(G.box(len * 1.05, drop, 0.008), st.cloth, 0, 0, 0, { r: 0.85 });
    K.detail(1, () => {
      K.add(G.box(len * 1.08, 0.016, 0.012), st.cloth2, 0, -drop * 0.5, 0, { r: 0.8 });
      K.push(0, -drop * 0.05, s * 0.006, 0, s < 0 ? PI : 0, 0); emblem(K, st, drop * 0.62, { depth: 0.05, col: [st.cloth2, st.metal] }); K.pop();
    });
    K.pop();
    K.detail(1, () => { // stirrup leather and iron
      K.bar([0.0, 0, s * w * 0.5], [0.02, -drop * 0.9, s * (w * 0.5 + 0.03)], 0.005, leather);
      K.add(G.tor(0.016, 0.004, 3, 8), st.metal, 0.02, -drop * 0.95, s * (w * 0.5 + 0.03), { m: st.metalM, r: 0.35 });
    });
  }
  K.pop();
}

// ------------------------------------------------------------------ the rider
const WEAPON = {
  graal: 'lance', aurelia: 'musket', aethel: 'bow', kaelneth: 'spear', verdant: 'bow', grom: 'musket', xibalba: 'spear', velikaya: 'lance',
  tianlong: 'glaive', ironbound: 'axe', screaming: 'glaive', cloven: 'axe', fimbul: 'axe', ashur: 'musket', greenhide: 'spear', skar: 'musket',
  crimson: 'sword', khemet: 'spear', drowned: 'trident', gorge: 'axe', westmark: 'musket', principalities: 'musket', sunkings: 'lance', caliphate: 'sword',
  shogunate: 'bow', mistisles: 'spear', thousandgods: 'glaive', kharnak: 'axe', morbus: 'glaive', labyrinth: 'spear', velvet: 'sword', malvash: 'musket',
  ashhorde: 'axe', balor: 'spear', kurgan: 'bow', hearthmoot: 'bow', baobab: 'spear', nagavar: 'trident', pearlfleet: 'trident', glimmer: 'musket',
  khanate: 'bow', emerald: 'spear', deeproot: 'spear', goldsands: 'sword',
  kingdom: 'lance', goblin: 'spear', undead: 'glaive', infernal: 'axe', beasts: 'axe', elemental: 'staff', dragons: 'spear',
};

/** a helm or hat on a head of radius r at the origin, facing +x */
function helm(K, kind, r, a, b, st) {
  const gm = { m: 0.45, r: 0.35 }, cm = { r: 0.85 };
  switch (kind) {
    case 'kettle': K.add(G.hemi(r * 1.12, 9, 3), a, 0, r * 0.05, 0, gm).add(G.cyl(r * 1.12, r * 1.75, r * 0.2, 10, true), a, 0, r * 0.02, 0, gm).add(G.cyl(r * 1.14, r * 1.14, r * 0.14, 9, true), b, 0, r * 0.2, 0, gm); break;
    case 'crested': K.add(G.hemi(r * 1.12, 9, 4), a, 0, r * 0.05, 0, gm); K.add(G.cyl(r, r, r * 0.3, 10, false), b, 0, r * 1.05, 0, { rx: PI / 2, sz: 1, r: 0.8 }); for (const s of [-1, 1]) K.add(G.box(r * 0.6, r * 0.7, r * 0.1), a, r * 0.25, -r * 0.3, s * r * 0.98, gm); break;
    case 'circlet': K.add(G.tor(r * 1.04, r * 0.08, 3, 12), a, 0, r * 0.25, 0, { rx: PI / 2, rz: 0.15, ...gm }).add(G.oct(r * 0.2), st.glow, r * 1.02, r * 0.4, 0, { sy: 1.5, g: 1.2, r: 0.2 }); break;
    case 'hood': K.add(G.sph(r * 1.3, 8, 4), a, -r * 0.12, -r * 0.05, 0, { ...cm }).add(G.cone(r * 0.5, r * 1.1, 5), a, -r * 1.2, r * 0.3, 0, { rz: PI / 2 + 0.5, ...cm }); break;
    case 'feathered': K.add(G.cyl(r * 1.08, r * 1.08, r * 0.3, 9, true), a, 0, r * 0.3, 0, cm); for (let k = -2; k <= 2; k++) K.add(G.cone(r * 0.28, r * 2.0, 4), k % 2 ? a : b, -r * 0.25, r * 1.35, k * r * 0.25, { rx: k * 0.32, sx: 0.35, r: 0.8 }); break;
    case 'spiked': K.add(G.hemi(r * 1.13, 9, 4), a, 0, r * 0.05, 0, gm).add(G.cone(r * 0.8, r * 0.9, 9), a, 0, r * 1.25, 0, gm).add(G.cone(r * 0.14, r * 0.8, 5), b, 0, r * 1.95, 0, gm); break;
    case 'conical': K.add(G.cone(r * 2.1, r * 0.95, 12), a, 0, r * 0.55, 0, cm).add(G.sph(r * 0.18, 5, 4), b, 0, r * 1.05, 0); break;
    case 'horned': K.add(G.hemi(r * 1.12, 9, 4), a, 0, r * 0.05, 0, gm).add(G.box(r * 0.12, r * 0.8, r * 0.18), a, r * 1.08, -r * 0.1, 0, gm); for (const s of [-1, 1]) K.add(taper(`Ffhorn${s}`, [[0, 0.5, s * 0.9], [0.1, 0.9, s * 1.6], [0.2, 1.7, s * 1.8]], [0.2, 0.02], 8, 5), b === a ? C.bone : b, 0, 0, 0, { s: r, r: 0.6 }); break;
    case 'tall': K.add(G.cyl(r * 0.55, r * 1.12, r * 1.9, 9, true), a, 0, r * 0.85, 0, gm).add(G.cyl(r * 1.14, r * 1.14, r * 0.22, 9, true), b, 0, r * 0.1, 0, gm); break;
    case 'tricorn': K.add(G.cyl(r * 1.9, r * 1.75, r * 0.45, 3, true), a, 0, r * 0.45, 0, { ry: PI / 3, ...cm }).add(G.cyl(r * 1.05, r * 1.1, r * 0.75, 8), a, 0, r * 0.55, 0, cm).add(G.cyl(r * 1.92, r * 1.92, r * 0.08, 3, true), b, 0, r * 0.68, 0, { ry: PI / 3, ...gm }); break;
    case 'nemes': K.add(G.hemi(r * 1.12, 9, 4), a, 0, r * 0.02, 0, cm); for (const s of [-1, 1]) K.add(G.box(r * 0.18, r * 1.6, r * 0.45), a, r * 0.45, -r * 0.55, s * r * 0.95, cm); K.add(G.cyl(r * 1.14, r * 1.14, r * 0.2, 9, true), b, 0, r * 0.2, 0, gm).add(G.cone(r * 0.18, r * 0.5, 5), b, r * 1.12, r * 0.6, 0, gm); break;
    case 'skullcap': K.add(G.hemi(r * 1.1, 9, 4), a, 0, r * 0.05, 0, gm).add(G.box(r * 0.12, r * 0.8, r * 0.18), b, r * 1.08, -r * 0.15, 0, gm); break;
    case 'brimmed': K.add(G.cyl(r * 2.1, r * 2.1, r * 0.08, 12), a, 0, r * 0.35, 0, cm).add(G.cyl(r * 0.95, r * 1.08, r * 0.8, 9), a, 0, r * 0.75, 0, cm).add(G.cone(r * 0.25, r * 2.2, 4), b, -r * 0.4, r * 1.2, r * 0.9, { rx: -0.7, sz: 0.3 }); break;
    case 'beret': K.add(G.sph(r * 1.2, 9, 4), a, -r * 0.2, r * 0.62, 0, { sy: 0.42, ...cm }).add(G.cone(r * 0.22, r * 2.0, 4), b, -r * 0.3, r * 1.1, r * 0.8, { rx: -0.8, sz: 0.3 }); break;
    case 'morion': K.add(G.hemi(r * 1.1, 9, 4), a, 0, r * 0.15, 0, gm).add(G.cyl(r * 1.7, r * 1.7, r * 0.08, 12), a, 0, r * 0.15, 0, { sx: 1.25, sz: 0.75, ...gm }).add(G.cyl(r * 0.9, r * 0.9, r * 0.14, 10, false), b, 0, r * 1.0, 0, { rx: PI / 2, ...gm }); break;
    case 'turban': K.add(G.tor(r * 0.95, r * 0.38, 5, 10), a, 0, r * 0.45, 0, { rx: PI / 2, ...cm }).add(G.sph(r, 9, 5), a, 0, r * 0.62, 0, { sy: 0.75, ...cm }).add(G.oct(r * 0.22), b, r * 1.3, r * 0.6, 0, { sz: 1.3, ...gm }).add(G.cone(r * 0.2, r * 1.4, 4), b, r * 1.05, r * 1.2, 0, { rz: -0.4 }); break;
    case 'kabuto': K.add(G.hemi(r * 1.15, 9, 4), a, 0, r * 0.08, 0, gm).add(G.cyl(r * 1.2, r * 1.8, r * 0.7, 10, true), a, -r * 0.05, -r * 0.2, 0, gm).add(G.tor(r * 0.85, r * 0.09, 3, 10, PI), b, r * 0.75, r * 0.85, 0, { ry: PI / 2, ...gm }); break;
    case 'fur': K.add(G.cyl(r * 1.2, r * 1.15, r * 1.0, 9), a, 0, r * 0.45, 0, { r: 1 }).add(G.sph(r * 0.8, 8, 3), b, 0, r * 0.95, 0, { sy: 0.45 }); break;
    case 'cap': K.add(G.hemi(r * 1.12, 9, 3), a, 0, r * 0.1, 0, cm).add(G.cone(r * 0.5, r * 0.9, 6), a, r * 0.3, r * 1.0, 0, { rz: -0.6, ...cm }); break;
    case 'mushroom': K.add(G.hemi(r * 1.9, 10, 4), a, 0, r * 0.45, 0, { sy: 0.6 }); for (let k = 0; k < 5; k++) K.add(G.sph(r * 0.28, 5, 3), b, Math.cos(k * 1.26) * r, r * 1.4 - (k % 2) * r * 0.25, Math.sin(k * 1.26) * r, { sy: 0.5 }); break;
    default: break;
  }
}

/**
 * the rider, seated (sit), cross-legged (cross), standing (stand), lying prone (prone) or hanging in a sling (hang);
 * built facing +x with the seat at the origin. Folk, helm, cloak and arms come from the realm; tabard in the side colour.
 */
function riderKit(K, B, pose = 'sit') {
  const L = B.look, P = L.P, st = L.st, side = B.side, skin = P.skin, cloth = P.cloth2 ?? P.cloth, armor = P.armor;
  const sp = L.kit, small = sp === 'goblin' || sp === 'halfling' || sp === 'gnome' || sp === 'dwarf', big = sp === 'brute' || sp === 'bruteHorned';
  const k = small ? 0.82 : big ? 1.15 : 1;
  K.push(0, 0, 0, 0, 0, 0, k);
  const prone = pose === 'prone';
  if (prone) K.push(0, 0.06, 0, 0, 0, -PI / 2 + 0.05);
  const stand = pose === 'stand' || pose === 'hang';
  const hip = stand ? 0.16 : 0.0;
  // legs: astride, crossed or standing
  if (pose === 'sit') for (const s of [-1, 1]) { K.add(taper(`Frthigh${s}`, [[-0.02, 0.02, s * 0.04], [0.08, 0.0, s * 0.09], [0.1, -0.03, s * 0.1]], [0.03, 0.026], 5, 6), cloth, 0, 0, 0, { r: 0.8 }); K.add(taper(`Frshin${s}`, [[0.1, -0.03, s * 0.1], [0.08, -0.1, s * 0.11], [0.06, -0.15, s * 0.11]], [0.024, 0.02], 5, 6), 0x3a2a1e, 0, 0, 0, { r: 0.7 }); K.add(G.rbox(0.06, 0.03, 0.035, 0.008), 0x2a1e16, 0.08, -0.165, s * 0.11, { r: 0.6 }); }
  else if (pose === 'cross') for (const s of [-1, 1]) K.add(taper(`Frcross${s}`, [[0, 0.02, s * 0.04], [0.08, 0.02, s * 0.1], [0.11, 0.015, -s * 0.03]], [0.03, 0.022], 6, 6), cloth, 0, 0, 0, { r: 0.8 });
  else if (stand || prone) for (const s of [-1, 1]) { K.add(G.cyl(0.026, 0.02, 0.17, 6), cloth, 0, 0.085 - (prone ? 0.02 : 0), s * 0.035); K.add(G.rbox(0.05, 0.025, 0.035, 0.008), 0x2a1e16, 0.012, 0.0, s * 0.035); }
  K.push(0, hip, 0, 0, 0, pose === 'sit' ? -0.18 : 0);
  // the torso under a tabard, the belt and pauldrons
  K.add(loftL(`Frtorso${sp}`, [[0, 0.02, 0, 0.055, 0.045], [0, 0.1, 0, 0.065, 0.05], [0, 0.18, 0, 0.068, 0.048], [0, 0.23, 0, 0.05, 0.04], [0, 0.25, 0, 0.025, 0.025]], { radial: 10, sub: 2, col: cloth, lat: [0, 0, 1] }), 0xffffff, 0, 0, 0, { r: 0.8 });
  K.add(G.box(0.012, 0.17, 0.09), side, 0.05, 0.11, 0, { r: 0.85 }); // the tabard, front
  K.add(G.box(0.012, 0.16, 0.09), side, -0.05, 0.12, 0, { r: 0.85 });
  K.add(G.cyl(0.062, 0.062, 0.02, 10, true), P.trim, 0, 0.04, 0, { m: 0.3, r: 0.6 });
  K.detail(1, () => { K.push(0.057, 0.14, 0, 0, PI / 2, 0); emblem(K, st, 0.055, { depth: 0.1, col: [st.cloth2 === side ? st.metal : st.cloth2, st.metal] }); K.pop(); });
  for (const s of [-1, 1]) K.add(G.hemi(0.032, 7, 3), armor, 0, 0.215, s * 0.06, { rz: 0, sx: 1.2, sy: 0.8, m: 0.45, r: 0.4 });
  // the cloak, bellied back from the shoulders
  K.add(clothPanel(`Frcloak${pose}`, (u, v) => [-0.035 - v * 0.04 - (pose === 'sit' ? v * 0.08 : 0), 0.23 - v * (prone ? 0.22 : 0.26), 0.0, (u - 0.5) * (0.13 + v * 0.06)], 0, 4, 4), P.cloth, 0, 0, 0, { r: 0.9 });
  // arms reaching for the reins (or the weapon)
  for (const s of [-1, 1]) {
    const hand = pose === 'sit' ? [0.14, 0.1, s * 0.05] : pose === 'cross' ? [0.1, 0.1, s * 0.07] : pose === 'hang' ? [0.04, 0.42, s * 0.12] : [0.06, 0.06, s * 0.1];
    K.add(taper(`Frarm${pose}${s}`, [[0, 0.21, s * 0.07], [0.04, 0.14, s * 0.085], hand], [0.022, 0.018], 6, 5), cloth, 0, 0, 0, { r: 0.8 });
    K.add(G.sph(0.02, 6, 4), big || sp === 'skeleton' ? skin : 0x5a3a22, hand[0], hand[1], hand[2], { r: 0.7 }); // gauntlets
  }
  // the head of its folk
  K.push(0.015, 0.3, 0);
  const r = 0.052;
  K.add(G.sph(r, 10, 8), skin, 0, 0, 0, { sy: 1.06, r: 0.75 });
  K.detail(1, () => {
    if (sp !== 'skeleton') K.add(G.cone(r * 0.2, r * 0.45, 4), skin, r * 0.98, -r * 0.08, 0, { rz: -PI / 2 });
    for (const s of [-1, 1]) K.add(G.sph(r * 0.13, 5, 4), sp === 'skeleton' ? 0x1a1a1a : 0x1a1410, r * 0.86, r * 0.18, s * r * 0.34);
    if (sp === 'elf') for (const s of [-1, 1]) K.add(G.cone(r * 0.22, r * 1.4, 4), skin, -r * 0.1, r * 0.1, s * r * 1.05, { rx: s * 1.2 });
    if (sp === 'goblin') for (const s of [-1, 1]) K.add(G.cone(r * 0.4, r * 1.8, 4), skin, -r * 0.1, r * 0.1, s * r * 1.2, { rx: s * 1.35 });
    if (sp === 'dwarf') K.add(G.cone(r * 0.75, r * 2.0, 6), 0x8a3a1a, r * 0.6, -r * 1.0, 0, { rz: -0.2 + PI });
    if (sp === 'lizard' || sp === 'rat') K.add(G.cone(r * 0.6, r * 1.6, 6), skin, r * 1.4, -r * 0.2, 0, { rz: -PI / 2 });
    if (sp === 'rat') for (const s of [-1, 1]) K.add(G.sph(r * 0.5, 6, 4), skin, -r * 0.1, r * 0.9, s * r * 0.6, { sz: 0.3, sx: 1 });
    if (sp === 'demon' || sp === 'goat') for (const s of [-1, 1]) K.add(taper(`Frdhorn${s}`, [[0, 0.6, s * 0.5], [-0.3, 1.2, s * 0.8], [-0.7, 1.3, s * 0.7]], [0.22, 0.03], 6, 5), C.bone, 0, 0, 0, { s: r });
    if (big) for (const s of [-1, 1]) K.add(G.cone(r * 0.12, r * 0.5, 3), C.bone, r * 0.9, -r * 0.5, s * r * 0.35);
    if (sp === 'skeleton') K.add(G.box(r * 0.8, r * 0.4, r * 1.1), skin, r * 0.4, -r * 0.8, 0);
  });
  const hk = L.hat !== 'none' ? L.hat : sp === 'goblin' || sp === 'gnome' ? 'cap' : sp === 'skeleton' || sp === 'demon' ? 'skullcap' : 'none';
  K.detail(3, () => helm(K, hk, r, L.hatCol?.[0] ?? armor, L.hatCol?.[1] ?? P.trim, st));
  K.pop();
  K.pop();
  if (prone) K.pop();
  K.pop();
}

/** the rider's weapon, on its own so it can dip in a dive: held in the right hand (z+) */
function weaponKit(K, B) {
  const st = B.look.st, kind = WEAPON[B.look.id] || 'lance', wood = 0x5a3e24, steel = 0xb8c0c8, mt = { m: st.metalM, r: 0.35 };
  const hz = 0.06;
  switch (kind) {
    case 'lance': case 'spear': case 'glaive': case 'trident': {
      const len = kind === 'lance' ? 0.9 : 0.7;
      K.bar([-0.2, 0, hz], [len - 0.2, 0, hz], kind === 'lance' ? 0.011 : 0.008, wood, { r2: kind === 'lance' ? 0.006 : 0.008 });
      if (kind === 'lance') { K.add(G.cone(0.03, 0.05, 8), st.metal, -0.02, 0, hz, { rz: -PI / 2, ...mt }); K.add(G.cone(0.012, 0.08, 5), steel, len - 0.16, 0, hz, { rz: -PI / 2, m: 0.5, r: 0.3 }); K.detail(2, () => K.add(G.shape('Flpennon', [[0, 0], [-0.16, 0.035], [0, 0.07]]), B.side, len - 0.25, 0.005, hz, { r: 0.9 })); }
      else if (kind === 'spear') K.add(G.oct(0.025), steel, len - 0.18, 0, hz, { sx: 2.6, sz: 0.3, m: 0.5, r: 0.3 });
      else if (kind === 'glaive') K.add(G.shape('Fglaive', [[0, -0.01], [0.12, 0.0], [0.15, 0.05], [0.05, 0.035], [0, 0.02]]), steel, len - 0.22, -0.005, hz, { m: 0.5, r: 0.3 });
      else { K.add(G.box(0.012, 0.012, 0.07), st.metal, len - 0.2, 0, hz, mt); for (const z of [-1, 0, 1]) K.add(G.cone(0.008, 0.06, 4), st.metal, len - 0.16, 0, hz + z * 0.03, { rz: -PI / 2, ...mt }); }
      break;
    }
    case 'axe': K.bar([-0.02, -0.06, hz], [0.08, 0.2, hz], 0.008, wood); K.add(G.shape('Fraxe', [[0, 0], [0.07, -0.04], [0.09, 0.03], [0.07, 0.08], [0, 0.04]]), steel, 0.07, 0.13, hz, { ry: 0, m: 0.5, r: 0.3 }); break;
    case 'sword': K.add(G.box(0.24, 0.016, 0.004), steel, 0.12, 0.02, hz, { rz: 0.5, m: 0.5, r: 0.25 }).add(G.box(0.012, 0.05, 0.012), st.metal, 0.01, -0.04, hz, mt); break;
    case 'musket': K.bar([-0.12, -0.03, hz], [0.32, 0.03, hz], 0.008, 0x2a2a2e, { m: 0.5 }); K.add(G.box(0.12, 0.03, 0.016), wood, -0.1, -0.035, hz, { rz: 0.14 }); break;
    case 'bow': K.add(G.tor(0.12, 0.006, 3, 10, PI * 0.9), wood, -0.06, 0.08, -0.06, { ry: PI / 2, rz: PI / 2 + 0.15 }); K.add(G.cyl(0.02, 0.02, 0.12, 6), 0x6a4a2a, -0.08, 0.16, -0.05, { rz: 0.4 }); break;
    case 'staff': K.bar([-0.05, -0.12, hz], [0.05, 0.45, hz], 0.008, wood); K.add(G.oct(0.03), st.glow, 0.06, 0.48, hz, { sy: 1.6, g: 1.6, r: 0.2 }); break;
  }
}

/** puts a rider (and its weapon) on a flier at (x, y) in the parent's space */
function mount(B, parent, x, y, pose = 'sit') {
  const g = B.group(parent, x, y, 0, { k: 'rider' });
  B.part(g, `rider${pose}`, (K) => riderKit(K, B, pose));
  if (pose === 'sit' || pose === 'cross') {
    const w = B.group(g, pose === 'sit' ? 0.13 : 0.06, pose === 'sit' ? 0.1 : pose === 'stand' ? 0.24 : 0.1, 0, { k: 'lance' });
    w.rotation.z = 0.25;
    B.part(w, `weapon${pose}`, (K) => weaponKit(K, B));
  }
  return g;
}

// ------------------------------------------------------------------ the styles
function glider(B, c) { // a canvas hang-glider with flexing ornithopter tips; the pilot hangs prone under it
  const g = B.root, side = B.side, st = B.look.st, wood = 0x5a3e24, y = 0.55;
  for (const s of [-1, 1]) {
    const pv = B.group(g, 0, y, 0, { k: 'wing', s, amp: 0.18, speed: 3.2, base: -0.08, fold: 0.5 });
    B.part(pv, `gwi${s}`, (K) => {
      K.add(clothPanel(`Fglsail${s}`, (u, v) => { const x = 0.5 - u * 0.75 + v * (u < 0.5 ? -0.6 * (0.5 - u) : 0); return [x - v * 0.1, Math.sin(PI * u) * 0.035 * (1 - v * 0.5), 0, s * v * 0.55]; }, 0, 6, 5, { u: 3 }), c, 0, 0, 0, { r: 0.85 });
      K.add(clothPanel(`Fglsail2${s}`, (u, v) => { const x = 0.5 - u * 0.75; return [x - v * 0.1, 0.004, 0, s * v * 0.55]; }, 0, 2, 2), c, 0, 0, 0, { r: 0.85, from: 3 });
      K.bar([0.5, 0.01, 0], [-0.1, 0.01, s * 0.55], 0.013, wood);
      K.detail(1, () => { for (let i = 1; i < 4; i++) K.bar([0.3 - i * 0.1, 0.015, s * i * 0.05], [-0.1 - i * 0.05, 0.015, s * (0.2 + i * 0.1)], 0.005, wood); K.push(0.05, 0.02, s * 0.28, -PI / 2, 0, 0); emblem(K, st, 0.2, { depth: 0.02, col: [side, st.metal] }); K.pop(); });
    });
    const tip = B.group(pv, -0.1, 0, s * 0.55, { k: 'wing', s, amp: 0.35, speed: 3.2, base: 0, off: -0.8, fold: 0.6, outer: true });
    B.part(tip, `gwo${s}`, (K) => {
      K.add(flat('glt', [[0, 0], [-0.32, 0.36], [-0.4, 0.3], [-0.1, -0.05]], s), c, 0, 0, 0, { r: 0.85 });
      K.add(flat('gls', [[-0.04, 0.03], [-0.3, 0.33], [-0.34, 0.3], [-0.09, 0]], s), side, 0, 0.006, 0);
      K.bar([0, 0.01, 0], [-0.32, 0.01, s * 0.36], 0.011, wood);
      K.detail(1, () => { for (let i = 1; i < 4; i++) K.bar([-0.03 * i, 0.012, s * 0.02 * i], [-0.32 + i * 0.03, 0.012, s * (0.36 - i * 0.07)], 0.004, wood); });
    });
    pv.rotation.x = s * -0.08;
  }
  B.part(g, 'gframe', (K) => {
    K.bar([0.52, y, 0], [-0.32, y, 0], 0.016, wood);
    K.add(G.cone(0.03, 0.08, 6), st.metal, 0.55, y, 0, { rz: -PI / 2, m: st.metalM, r: 0.35 });
    K.add(G.shape('Fgfin', [[0, 0], [-0.18, 0.02], [-0.2, 0.16], [-0.1, 0.12]]), side, -0.2, y, 0, { r: 0.85 });
    for (const s of [-1, 1]) K.bar([0.08, y, 0], [0.14, 0.14, s * 0.18], 0.009, wood);
    K.bar([0.14, 0.14, -0.18], [0.14, 0.14, 0.18], 0.011, wood);
    K.bar([0.0, y, 0], [0.0, 0.3, 0], 0.005, C.rope);
    K.detail(1, () => { K.rope([0.12, y, 0], [0.14, 0.14, 0.18], 0.0, 0.003, C.rope); K.rope([0.12, y, 0], [0.14, 0.14, -0.18], 0.0, 0.003, C.rope); K.add(G.cyl(0.035, 0.035, 0.12, 8), st.metal, -0.05, y - 0.04, 0, { rz: PI / 2, m: st.metalM, r: 0.4 }); });
  });
  mount(B, g, 0.0, 0.22, 'prone');
}

function gyro(B, c) { // a little rotor-craft: a riveted hull with an open cockpit, a boiler, a two-bladed rotor and a pusher prop
  const g = B.root, st = B.look.st, side = B.side, brass = st.metal, iron = 0x2e2e32, mt = { m: st.metalM, r: 0.35 };
  B.part(g, 'ghull', (K) => {
    K.add(loftL(`Fgyhull${c}`, [[-0.34, 0.24, 0, 0.06, 0.07], [-0.2, 0.24, 0, 0.11, 0.12, { n: 2.3 }], [0.05, 0.24, 0, 0.13, 0.13, { n: 2.4, fl: 0.2 }], [0.25, 0.24, 0, 0.11, 0.11], [0.34, 0.24, 0, 0.07, 0.07]], { radial: 14, sub: 3, col: c, belly: shade(c, 0.7), ridge: shade(c, 1.15) }), 0xffffff, 0, 0, 0, { r: 0.55, m: 0.2 });
    K.add(G.cone(0.075, 0.16, 12), brass, 0.41, 0.24, 0, { rz: -PI / 2, ...mt });
    K.add(G.cyl(0.035, 0.045, 0.18, 10), iron, -0.12, 0.42, 0.06, { m: 0.5, r: 0.5 }); // boiler stack
    K.add(G.cyl(0.05, 0.035, 0.04, 10), brass, -0.12, 0.52, 0.06, mt);
    K.add(G.tor(0.1, 0.012, 4, 12), brass, 0.12, 0.36, 0, { rx: PI / 2, ...mt }); // the cockpit coaming
    K.bar([-0.28, 0.27, 0], [-0.72, 0.32, 0], 0.025, c, { r2: 0.035 });
    K.add(G.shape('Fgyfin', [[0, 0], [-0.16, 0], [-0.2, 0.2], [-0.08, 0.18]]), side, -0.62, 0.32, 0);
    K.add(G.shape('Fgyhs', [[0, -0.14], [0, 0.14], [-0.12, 0.12], [-0.12, -0.14]]), shade(c, 0.8), -0.62, 0.31, 0, { rx: -PI / 2 });
    for (const s of [-1, 1]) { K.add(G.rbox(0.62, 0.025, 0.03, 0.01), iron, 0.02, 0.015, s * 0.14, { m: 0.4 }); K.bar([0.15, 0.02, s * 0.14], [0.1, 0.16, s * 0.06], 0.01, iron); K.bar([-0.15, 0.02, s * 0.14], [-0.1, 0.16, s * 0.06], 0.01, iron); }
    K.bar([0.0, 0.32, 0], [0.0, 0.66, 0], 0.022, iron, { m: 0.4 });
    K.detail(1, () => {
      for (const x of [-0.22, -0.05, 0.12, 0.28]) K.add(G.tor(x > 0.2 ? 0.105 : 0.128, 0.006, 3, 14), brass, x, 0.24, 0, { ry: PI / 2, ...mt }); // riveted bands
      for (const s of [-1, 1]) { K.push(0.0, 0.25, s * 0.13, 0, s > 0 ? 0 : PI, 0); emblem(K, st, 0.1, { depth: 0.05 }); K.pop(); }
      K.add(G.cyl(0.04, 0.04, 0.06, 8), 0xc8e8ff, 0.2, 0.34, 0, { rz: 0.6, r: 0.1, m: 0.3 }); // the windscreen
      for (const s of [-1, 1]) K.add(G.cyl(0.012, 0.016, 0.08, 6), iron, -0.3, 0.3, s * 0.07, { rz: PI / 2 + 0.3 }); // exhausts
    });
  });
  const prop = B.group(g, -0.76, 0.32, 0, { k: 'spin', axis: 'x', speed: 40 });
  B.part(prop, 'gprop', (K) => { for (let i = 0; i < 3; i++) K.add(G.box(0.012, 0.17, 0.04), 0x3a3226, 0, 0, 0, { rx: (i * 2 * PI) / 3, r: 0.6 }).add(G.sph(0.025, 6, 4), brass, 0, 0, 0, mt); });
  const rotor = B.group(g, 0, 0.67, 0, { k: 'spin', axis: 'y', speed: 26 });
  B.part(rotor, 'grotor', (K) => {
    for (const a of [0, PI]) { K.push(0, 0, 0, 0, a, 0); K.add(G.shape('Fgblade', [[0.04, -0.035], [0.75, -0.03], [0.76, 0.03], [0.04, 0.045]]), 0x3a3226, 0, 0, 0, { rx: -PI / 2 + 0.08, r: 0.6 }); K.pop(); }
    K.add(G.cyl(0.05, 0.05, 0.05, 10), brass, 0, 0, 0, mt).add(G.sph(0.03, 6, 4), brass, 0, 0.035, 0, mt);
  });
  const disc = new THREE.Mesh(G.circle(0.76, 20), rotorDiscMat()); disc.rotation.x = -PI / 2; rotor.add(disc);
  g.userData.rotor = rotor; // legacy hook
  mount(B, g, 0.1, 0.3, 'sit');
}

/** a beast body: stations along x, a belly colour, a ridge */
function body(K, key, stations, col, belly, o = {}) { K.add(loftL(`F${key}${col}${belly}`, stations, { radial: o.radial ?? 14, sub: 3, col, belly, ridge: o.ridge }), 0xffffff, 0, 0, 0, { r: o.r ?? 0.75, m: o.m ?? 0 }); }

function bird(B, c) { // a great raptor with broad fingered wings and a fanned tail
  const g = B.root, pale = blend(c, 0xf4ecd8, 0.5), dark = shade(c, 0.6), beak = 0xe0b030;
  B.part(g, 'bbody', (K) => {
    body(K, 'bird', [[-0.3, 0.24, 0, 0.08, 0.07], [-0.15, 0.24, 0, 0.15, 0.13], [0.05, 0.25, 0, 0.17, 0.15], [0.22, 0.29, 0, 0.13, 0.12], [0.35, 0.33, 0, 0.09, 0.09], [0.44, 0.35, 0, 0.08, 0.08], [0.52, 0.34, 0, 0.05, 0.05]], c, pale, { ridge: shade(c, 0.85) });
    K.add(taper('Fbbeak', [[0.52, 0.35, 0], [0.6, 0.34, 0], [0.63, 0.29, 0]], [0.035, 0.004], 8, 6), beak, 0, 0, 0, { r: 0.4 });
    K.add(G.sph(0.04, 6, 4), beak, 0.53, 0.33, 0, { sx: 1.2, sy: 0.7, r: 0.5 }); // the cere
    for (const s of [-1, 1]) { K.add(G.sph(0.016, 8, 6), 0xe8b020, 0.5, 0.375, s * 0.042, { g: 0.2, r: 0.2 }); K.add(G.sph(0.009, 6, 4), 0x101010, 0.51, 0.377, s * 0.05, { r: 0.1 }); K.add(G.box(0.05, 0.01, 0.015), dark, 0.49, 0.395, s * 0.04, { rz: -0.2 }); }
    // the fanned tail
    for (let i = -4; i <= 4; i++) K.add(flat(`btail`, [[0, -0.03], [-0.28, -0.04], [-0.31, 0], [-0.28, 0.04], [0, 0.03]]), i % 2 ? c : dark, -0.24, 0.25 + Math.abs(i) * 0.002, i * 0.02, { ry: i * 0.12, r: 0.85, lv: i % 2 ? 1 : 9 });
    // legs tucked under, with talons
    for (const s of [-1, 1]) limb(K, `bleg${s}`, [[0.02, 0.18, s * 0.07], [-0.06, 0.1, s * 0.08], [-0.1, 0.07, s * 0.07]], 0.03, 0.014, 0xe0b030, { toes: 3, claw: 0x2a2420 });
    K.detail(1, () => { for (let i = 0; i < 8; i++) K.add(G.sph(0.05, 5, 3), pale, 0.3 - i * 0.04, 0.2 + (i % 2) * 0.01, ((i % 3) - 1) * 0.05, { sy: 0.3, r: 0.9 }); }); // breast feathers
    saddle(K, B, 0.12, 0.38, { len: 0.2, w: 0.2, drop: 0.13 });
    K.detail(2, () => { K.rope([0.2, 0.39, 0.06], [0.48, 0.37, 0.05], 0.03, 0.004, 0x3a2a1a); K.rope([0.2, 0.39, -0.06], [0.48, 0.37, -0.05], 0.03, 0.004, 0x3a2a1a); K.add(G.tor(0.08, 0.008, 3, 12), 0x3a2a1a, 0.44, 0.35, 0, { ry: PI / 2 }); });
  });
  wings(B, g, 'bw', {
    at: [0.08, 0.32, 0.12], joint: [0, 0.5], amp: 0.55, speed: 5, base: -0.12,
    inner: (K, s) => featherPanel(K, 'bwi', s, { span: 0.5, chord: 0.3, col: c, dark }),
    outer: (K, s) => featherPanel(K, 'bwo', s, { span: 0.55, chord: 0.28, col: c, dark, outer: true, n: 7 }),
  });
  mount(B, g, 0.12, 0.4, 'sit');
}

function bat(B, c) { // a leathery giant bat: tall ears, pug snout, scalloped membranes stretched on finger bones
  const g = B.root, skin = blend(c, 0x7a4a40, 0.3), bone = shade(c, 0.6);
  B.part(g, 'abody', (K) => {
    body(K, 'bat', [[-0.32, 0.22, 0, 0.04, 0.04], [-0.22, 0.22, 0, 0.12, 0.11], [0.0, 0.23, 0, 0.15, 0.14], [0.18, 0.25, 0, 0.12, 0.11], [0.27, 0.26, 0, 0.1, 0.1], [0.36, 0.25, 0, 0.07, 0.06], [0.41, 0.23, 0, 0.035, 0.035]], c, shade(c, 0.75), { r: 0.95 });
    K.add(G.sph(0.03, 8, 6), shade(c, 0.5), 0.41, 0.23, 0, { sy: 0.7 }); // the snout
    for (const s of [-1, 1]) {
      K.add(G.cone(0.055, 0.2, 8), c, 0.27, 0.4, s * 0.06, { rx: s * 0.35, rz: 0.15, sz: 0.4, r: 0.95 }); // ears
      K.add(G.cone(0.035, 0.15, 6), skin, 0.275, 0.39, s * 0.064, { rx: s * 0.35, rz: 0.15, sz: 0.25 });
      K.add(G.sph(0.014, 6, 4), 0xff4020, 0.37, 0.28, s * 0.045, { g: 0.6, r: 0.2 });
      K.add(G.cone(0.006, 0.03, 4), C.bone, 0.39, 0.21, s * 0.02, { rz: PI });
      limb(K, `batleg${s}`, [[-0.2, 0.2, s * 0.06], [-0.3, 0.15, s * 0.08], [-0.38, 0.17, s * 0.07]], 0.02, 0.01, bone, { toes: 4, claw: 0x1a1a1a });
    }
    K.detail(1, () => { for (let i = 0; i < 12; i++) K.add(G.cone(0.02, 0.05, 4), shade(c, 1.15), 0.2 - i * 0.04, 0.33 - Math.abs(i - 4) * 0.004, ((i % 3) - 1) * 0.04, { rz: PI / 2 + 0.4, r: 1 }); }); // the ruff
    saddle(K, B, 0.05, 0.34, { len: 0.2, w: 0.2, drop: 0.12 });
  });
  const memb = (K, key, s, pts, bones) => membranePanel(K, key, s, { pts, bones, memb: skin, bone });
  wings(B, g, 'aw', {
    at: [0.06, 0.27, 0.12], joint: [0.06, 0.5], amp: 0.7, speed: 8, base: -0.05, lag: 0.9,
    inner: (K, s) => memb(K, 'awi', s, [[0.1, 0], [0.06, 0.5], [-0.12, 0.44], [-0.2, 0.42], [-0.13, 0.22], [-0.2, 0]], [[[0.08, 0], [0.06, 0.5]]]),
    outer: (K, s) => memb(K, 'awo', s, [[0, 0], [-0.04, 0.62], [-0.1, 0.48], [-0.15, 0.4], [-0.3, 0.5], [-0.26, 0.34], [-0.28, 0.24], [-0.42, 0.2], [-0.3, 0.08], [-0.26, -0.08]],
      [[[0, 0], [-0.04, 0.62]], [[0, 0], [-0.3, 0.5]], [[0, 0], [-0.42, 0.2]], [[0, 0], [-0.26, -0.08]]]),
  });
  mount(B, g, 0.05, 0.37, 'sit');
}

function pegasus(B, c) { // a winged horse with raised feathered wings, barded in the realm's colours
  const g = B.root, st = B.look.st, mane = blend(c, 0x8a7a6a, 0.5), hoof = 0x3a3028, feather = blend(c, 0xffffff, 0.35), dark = blend(c, 0x8a8a9a, 0.3);
  B.part(g, 'pbody', (K) => {
    body(K, 'horse', [[-0.36, 0.42, 0, 0.09, 0.1], [-0.25, 0.43, 0, 0.13, 0.14], [0.0, 0.42, 0, 0.12, 0.13], [0.22, 0.44, 0, 0.12, 0.14], [0.3, 0.5, 0, 0.09, 0.1]], c, shade(c, 0.85));
    K.add(loftL(`Fpneck${c}`, [[0.24, 0.48, 0, 0.08, 0.1], [0.34, 0.6, 0, 0.06, 0.08], [0.4, 0.7, 0, 0.05, 0.06], [0.42, 0.74, 0, 0.05, 0.05]], { radial: 12, sub: 2, col: c }), 0xffffff);
    K.add(loftL(`Fphead${c}`, [[0.4, 0.75, 0, 0.05, 0.055], [0.48, 0.72, 0, 0.042, 0.045], [0.56, 0.66, 0, 0.032, 0.034], [0.6, 0.63, 0, 0.03, 0.028]], { radial: 12, sub: 2, col: c, belly: shade(c, 0.8) }), 0xffffff);
    for (const s of [-1, 1]) { K.add(G.cone(0.018, 0.07, 6), c, 0.41, 0.82, s * 0.03, { rx: s * 0.2 }); K.add(G.sph(0.01, 6, 4), 0x1a1410, 0.5, 0.74, s * 0.042); K.add(G.sph(0.006, 4, 3), 0x1a1410, 0.6, 0.64, s * 0.018); }
    // the mane in tufts down the neck, and the tail
    for (let i = 0; i < 7; i++) K.add(G.cone(0.035, 0.1, 5), mane, 0.27 + i * 0.024, 0.58 + i * 0.03, 0, { rz: 0.9 - i * 0.05, sz: 0.4, r: 0.95, lv: i % 2 ? 1 : 9 });
    for (let i = 0; i < 4; i++) K.add(taper(`Fptail${i}`, [[-0.36, 0.45, 0], [-0.46, 0.42, (i - 1.5) * 0.02], [-0.56, 0.3, (i - 1.5) * 0.04], [-0.58, 0.2, (i - 1.5) * 0.05]], [0.025, 0.006], 8, 5), mane, 0, 0, 0, { r: 0.95, lv: i < 2 ? 9 : 1 });
    // legs folded in flight: forelegs tucked, hind legs trailing
    for (const s of [-1, 1]) {
      limb(K, `pfore${s}`, [[0.2, 0.36, s * 0.07], [0.27, 0.24, s * 0.08], [0.2, 0.17, s * 0.08], [0.24, 0.1, s * 0.08]], 0.035, 0.022, c, { hoof });
      limb(K, `phind${s}`, [[-0.24, 0.36, s * 0.08], [-0.3, 0.24, s * 0.09], [-0.42, 0.2, s * 0.09], [-0.48, 0.12, s * 0.09]], 0.045, 0.022, c, { hoof });
    }
    saddle(K, B, 0.0, 0.55, { len: 0.24, w: 0.24, drop: 0.2, flank: 0.0 });
    // the bridle, reins and a chanfron of the realm's metal
    K.detail(1, () => {
      K.add(G.tor(0.042, 0.005, 3, 12), 0x3a2a1a, 0.5, 0.7, 0, { ry: PI / 2, rx: 0.6 });
      K.add(G.tor(0.034, 0.005, 3, 12), 0x3a2a1a, 0.57, 0.65, 0, { ry: PI / 2, rx: 0.9 });
      for (const s of [-1, 1]) K.rope([0.12, 0.62, s * 0.05], [0.56, 0.64, s * 0.035], 0.04, 0.004, 0x3a2a1a);
      K.add(G.shape('Fchanfron', [[0, 0.03], [0.1, 0.018], [0.12, 0], [0.1, -0.018], [0, -0.03]]), st.metal, 0.46, 0.77, 0, { rx: PI / 2, rz: -0.55, m: st.metalM, r: 0.35 });
      K.add(G.cone(0.01, 0.06, 5), st.metal, 0.47, 0.8, 0, { rz: -0.5, m: st.metalM });
    });
  });
  wings(B, g, 'pw', {
    at: [0.12, 0.54, 0.1], joint: [0, 0.42], amp: 0.5, speed: 4.2, base: -0.4,
    inner: (K, s) => featherPanel(K, 'pwi', s, { span: 0.42, chord: 0.26, col: feather, dark, tipCol: 0xffffff }),
    outer: (K, s) => featherPanel(K, 'pwo', s, { span: 0.5, chord: 0.24, col: feather, dark, tipCol: 0xffffff, outer: true, n: 8 }),
  });
  mount(B, g, 0.0, 0.57, 'sit');
}

function griffon(B, c) { // an eagle in front, a lion behind: hooked beak, ear tufts, talons, haunches and a tufted tail
  const g = B.root, eagle = blend(c, 0xf2ead8, 0.6), beak = 0xe0b030, feather = blend(c, 0x5a4028, 0.35), dark = shade(feather, 0.7);
  B.part(g, 'gbody', (K) => {
    body(K, 'lion', [[-0.42, 0.38, 0, 0.08, 0.09], [-0.3, 0.37, 0, 0.13, 0.13], [-0.1, 0.38, 0, 0.12, 0.12], [0.05, 0.42, 0, 0.13, 0.14]], c, shade(c, 0.85));
    body(K, 'gchest', [[0.0, 0.42, 0, 0.13, 0.14], [0.14, 0.45, 0, 0.14, 0.15], [0.26, 0.52, 0, 0.1, 0.11], [0.31, 0.57, 0, 0.09, 0.09], [0.38, 0.58, 0, 0.065, 0.065]], eagle, blend(eagle, 0xffffff, 0.3));
    K.add(taper('Fgbeak', [[0.38, 0.59, 0], [0.46, 0.58, 0], [0.49, 0.53, 0]], [0.035, 0.004], 8, 6), beak, 0, 0, 0, { r: 0.4 });
    for (const s of [-1, 1]) { K.add(G.cone(0.02, 0.09, 5), eagle, 0.3, 0.66, s * 0.04, { rz: 0.5, rx: s * 0.2 }); K.add(G.sph(0.014, 8, 6), 0xe8a020, 0.37, 0.61, s * 0.04, { g: 0.2 }); K.add(G.sph(0.008, 5, 4), 0x101010, 0.378, 0.612, s * 0.047); }
    for (const s of [-1, 1]) {
      limb(K, `gfore${s}`, [[0.16, 0.34, s * 0.07], [0.22, 0.24, s * 0.08], [0.18, 0.17, s * 0.08]], 0.03, 0.016, beak, { toes: 3, claw: 0x2a2420 });
      limb(K, `ghind${s}`, [[-0.3, 0.32, s * 0.09], [-0.36, 0.22, s * 0.1], [-0.46, 0.18, s * 0.09], [-0.5, 0.1, s * 0.09]], 0.05, 0.02, c, { toes: 4, claw: 0x2a2420 });
    }
    K.add(taper('Fgtail', [[-0.42, 0.4, 0], [-0.6, 0.44, 0], [-0.74, 0.5, 0], [-0.82, 0.48, 0]], [0.02, 0.012], 10, 5), c);
    K.add(G.sph(0.045, 8, 6), shade(c, 0.55), -0.84, 0.48, 0, { sx: 1.5, r: 1 });
    K.detail(1, () => { for (let i = 0; i < 9; i++) K.add(G.sph(0.045, 5, 3), eagle, 0.22 - i * 0.03, 0.34 + (i % 2) * 0.01, ((i % 3) - 1) * 0.06, { sy: 0.3 }); });
    saddle(K, B, -0.04, 0.53, { len: 0.22, w: 0.22, drop: 0.15 });
    K.detail(2, () => { for (const s of [-1, 1]) K.rope([0.04, 0.58, s * 0.05], [0.42, 0.58, s * 0.03], 0.04, 0.004, 0x3a2a1a); K.add(G.tor(0.06, 0.008, 3, 12), 0x3a2a1a, 0.31, 0.57, 0, { ry: PI / 2 }); });
  });
  wings(B, g, 'gw', {
    at: [0.12, 0.52, 0.11], joint: [0, 0.46], amp: 0.55, speed: 4.6, base: -0.2,
    inner: (K, s) => featherPanel(K, 'gwi', s, { span: 0.46, chord: 0.3, col: feather, dark }),
    outer: (K, s) => featherPanel(K, 'gwo', s, { span: 0.5, chord: 0.28, col: feather, dark, outer: true, n: 7 }),
  });
  mount(B, g, -0.04, 0.55, 'sit');
}

/** a horned reptile head at the end of the neck: snout, jaw, brow ridges, horns and glowing eyes */
function drakeHead(K, key, x, y, col, belly, horn, eye, o = {}) {
  const w = o.w ?? 1;
  K.push(x, y, 0, 0, 0, o.pitch ?? -0.1);
  K.add(loftL(`F${key}skull${col}`, [[-0.04 * w, 0.015 * w, 0, 0.055 * w, 0.05 * w], [0.05 * w, 0.02 * w, 0, 0.05 * w, 0.045 * w, { fl: 0.4 }], [0.13 * w, 0.0, 0, 0.032 * w, 0.03 * w, { fl: 0.6 }], [0.18 * w, -0.008 * w, 0, 0.018 * w, 0.018 * w]], { radial: 12, sub: 2, col, belly }), 0xffffff, 0, 0, 0, { r: 0.6 });
  K.add(loftL(`F${key}jaw${belly}`, [[-0.02 * w, -0.03 * w, 0, 0.045 * w, 0.02 * w], [0.08 * w, -0.035 * w, 0, 0.035 * w, 0.016 * w], [0.16 * w, -0.03 * w, 0, 0.015 * w, 0.01 * w]], { radial: 10, sub: 2, col: belly }), 0xffffff, 0, 0, 0, { r: 0.65 });
  for (const s of [-1, 1]) {
    K.add(taper(`F${key}horn${s}`, [[0, 0.04, s * 0.03], [-0.07, 0.08, s * 0.05], [-0.15, 0.09, s * 0.04]], [0.016, 0.002], 8, 5), horn, 0, 0, 0, { s: w, r: 0.5 });
    K.add(G.sph(0.011 * w, 8, 6), eye, 0.06 * w, 0.03 * w, s * 0.038 * w, { g: 1.4, r: 0.2 });
    K.add(G.box(0.05 * w, 0.01 * w, 0.02 * w), shade(col, 0.7), 0.06 * w, 0.045 * w, s * 0.035 * w, { rz: -0.15 });
    K.detail(1, () => { for (let i = 0; i < 4; i++) K.add(G.cone(0.004 * w, 0.014 * w, 3), C.bone, 0.06 * w + i * 0.025 * w, -0.016 * w, s * (0.035 - i * 0.005) * w, { rz: PI }); }); // teeth
  }
  if (o.nose) K.add(G.cone(0.008 * w, 0.03 * w, 4), horn, 0.15 * w, 0.025 * w, 0, { rz: -0.4 });
  K.pop();
}

function dragon(B, c) { // a slender drake: long rising neck, horned head, long spade tail, spined back
  const g = B.root, belly = blend(c, 0xe8c890, 0.4), horn = 0xe8dcc0, memb = blend(c, 0xd8803a, 0.35), boneM = shade(c, 0.7);
  B.part(g, 'dbody', (K) => {
    body(K, 'drake', [[-0.3, 0.31, 0, 0.08, 0.07], [-0.15, 0.32, 0, 0.13, 0.12], [0.05, 0.33, 0, 0.15, 0.13], [0.2, 0.36, 0, 0.11, 0.1], [0.3, 0.4, 0, 0.07, 0.07]], c, belly, { ridge: shade(c, 0.75), r: 0.55, m: 0.12 });
    K.add(loftL(`Fdneck${c}`, [[0.28, 0.39, 0, 0.07, 0.07], [0.42, 0.5, 0, 0.055, 0.055], [0.54, 0.58, 0, 0.045, 0.045], [0.62, 0.6, 0, 0.042, 0.04]], { radial: 12, sub: 3, col: c, belly, ridge: shade(c, 0.75) }), 0xffffff, 0, 0, 0, { r: 0.55, m: 0.12 });
    drakeHead(K, 'dh', 0.64, 0.6, c, belly, horn, 0xffd040, { nose: true });
    K.add(loftL(`Fdtail${c}`, [[-0.28, 0.31, 0, 0.07, 0.06], [-0.5, 0.3, 0, 0.045, 0.04], [-0.75, 0.3, 0, 0.025, 0.022], [-0.95, 0.29, 0, 0.01, 0.01]], { radial: 10, sub: 3, col: c, belly }), 0xffffff, 0, 0, 0, { r: 0.55, m: 0.12 });
    K.add(flat('dspade', [[0, 0], [-0.1, -0.08], [-0.2, 0], [-0.1, 0.08]]), shade(c, 0.7), -0.93, 0.29, 0);
    for (let k = 0; k < 14; k++) { const x = 0.55 - k * 0.1, y = x > 0.28 ? 0.39 + (x - 0.28) * 0.75 : x > -0.28 ? 0.44 - Math.abs(x) * 0.12 : 0.35; K.add(G.cone(0.022 - k * 0.0008, 0.07 - k * 0.002, 4), horn, x, y + 0.02, 0, { sz: 0.4, r: 0.5, lv: k % 2 ? 1 : 9 }); }
    for (const s of [-1, 1]) {
      limb(K, `dfore${s}`, [[0.15, 0.27, s * 0.08], [0.2, 0.18, s * 0.09], [0.14, 0.12, s * 0.09]], 0.03, 0.016, c, { toes: 3, claw: horn });
      limb(K, `dhind${s}`, [[-0.16, 0.26, s * 0.09], [-0.22, 0.17, s * 0.1], [-0.32, 0.14, s * 0.1], [-0.36, 0.08, s * 0.09]], 0.042, 0.018, c, { toes: 3, claw: horn });
    }
    K.detail(1, () => { for (let i = 0; i < 10; i++) K.add(G.box(0.05, 0.004, 0.08), shade(belly, 0.85), 0.25 - i * 0.05, 0.215 + Math.abs(i - 4) * 0.003, 0, { r: 0.6 }); }); // belly plates
    saddle(K, B, -0.06, 0.43, { len: 0.2, w: 0.2, drop: 0.12 });
    K.detail(2, () => { for (const s of [-1, 1]) K.rope([0.02, 0.47, s * 0.05], [0.6, 0.6, s * 0.035], 0.06, 0.004, 0x3a2a1a); K.add(G.tor(0.05, 0.008, 3, 10), 0x3a2a1a, 0.6, 0.6, 0, { ry: PI / 2 }); });
  });
  const mp = (K, key, s, pts, bones) => membranePanel(K, key, s, { pts, bones, memb, bone: boneM });
  wings(B, g, 'dw', {
    at: [0.1, 0.41, 0.1], joint: [0.12, 0.5], amp: 0.55, speed: 3.6, base: -0.18, lag: 0.9,
    inner: (K, s) => mp(K, 'dwi', s, [[0.08, 0], [0.12, 0.5], [-0.08, 0.42], [-0.16, 0.38], [-0.12, 0.18], [-0.25, 0]], [[[0.08, 0], [0.12, 0.5]]]),
    outer: (K, s) => mp(K, 'dwo', s, [[0, 0], [-0.18, 0.64], [-0.2, 0.5], [-0.24, 0.4], [-0.4, 0.46], [-0.36, 0.3], [-0.36, 0.2], [-0.5, 0.12], [-0.36, 0.0], [-0.3, -0.12]],
      [[[0, 0], [-0.18, 0.64]], [[0, 0], [-0.4, 0.46]], [[0, 0], [-0.5, 0.12]], [[0, 0], [-0.3, -0.12]]]),
  });
  mount(B, g, -0.06, 0.45, 'sit');
}

function beast(B, c) { // a heavy scaly wyvern: bulky body, short neck, blunt horned head, hind legs and a spiked club tail
  const g = B.root, dark = shade(c, 0.6), belly = blend(c, 0xd8c8a0, 0.35), horn = 0xd8ccb0, memb = blend(c, 0x4a2a20, 0.3);
  B.part(g, 'wbody', (K) => {
    body(K, 'wyvern', [[-0.3, 0.3, 0, 0.1, 0.1], [-0.15, 0.3, 0, 0.17, 0.17], [0.05, 0.31, 0, 0.19, 0.18], [0.2, 0.34, 0, 0.14, 0.14], [0.32, 0.4, 0, 0.1, 0.1], [0.4, 0.43, 0, 0.09, 0.085]], c, belly, { ridge: dark, r: 0.7 });
    drakeHead(K, 'wh', 0.42, 0.44, c, belly, horn, 0xff8020, { w: 1.4, pitch: -0.2 });
    for (let k = 0; k < 7; k++) K.add(G.cone(0.035, 0.08, 4), dark, 0.25 - k * 0.12, 0.48 - Math.abs(k - 1) * 0.03, 0, { sz: 0.5 });
    K.add(loftL(`Fwtail${c}`, [[-0.28, 0.3, 0, 0.08, 0.08], [-0.45, 0.28, 0, 0.055, 0.05], [-0.62, 0.27, 0, 0.04, 0.035], [-0.7, 0.27, 0, 0.06, 0.055], [-0.78, 0.27, 0, 0.02, 0.02]], { radial: 10, sub: 2, col: c, belly }), 0xffffff, 0, 0, 0, { r: 0.7 });
    for (let i = 0; i < 6; i++) { const a = i * PI / 3; K.add(G.cone(0.018, 0.08, 4), horn, -0.7, 0.27 + Math.sin(a) * 0.05, Math.cos(a) * 0.05, { rx: -a + PI / 2, r: 0.5 }); }
    for (const s of [-1, 1]) limb(K, `wleg${s}`, [[-0.08, 0.24, s * 0.12], [-0.06, 0.14, s * 0.13], [-0.14, 0.08, s * 0.12], [-0.08, 0.03, s * 0.12]], 0.06, 0.025, c, { toes: 3, claw: horn });
    K.detail(1, () => { for (let i = 0; i < 18; i++) { const x = 0.25 - (i % 9) * 0.06, s = i < 9 ? 1 : -1; K.add(G.sph(0.03, 4, 3), shade(c, 0.85), x, 0.36 - (i % 3) * 0.04, s * (0.15 + (i % 2) * 0.02), { sy: 0.4, sz: 0.3, r: 0.6 }); } }); // scales
    saddle(K, B, -0.02, 0.47, { len: 0.22, w: 0.26, drop: 0.15 });
    K.detail(2, () => { K.add(G.tor(0.09, 0.012, 3, 12), 0x3a2a1a, 0.38, 0.44, 0, { ry: PI / 2 }); for (const s of [-1, 1]) K.rope([0.06, 0.5, s * 0.06], [0.4, 0.46, s * 0.07], 0.03, 0.005, 0x3a2a1a); });
  });
  const mp = (K, key, s, pts, bones) => membranePanel(K, key, s, { pts, bones, memb, bone: dark, r: 0.018 });
  wings(B, g, 'ww', {
    at: [0.08, 0.42, 0.14], joint: [0.1, 0.45], amp: 0.55, speed: 4, base: -0.1, lag: 0.8,
    inner: (K, s) => mp(K, 'wwi', s, [[0.12, 0], [0.1, 0.45], [-0.12, 0.38], [-0.2, 0.4], [-0.15, 0.2], [-0.25, 0]], [[[0.11, 0], [0.1, 0.45]]]),
    outer: (K, s) => mp(K, 'wwo', s, [[0, 0], [-0.08, 0.56], [-0.12, 0.44], [-0.18, 0.36], [-0.32, 0.44], [-0.3, 0.28], [-0.3, 0.2], [-0.44, 0.14], [-0.32, 0.04], [-0.3, -0.05]],
      [[[0, 0], [-0.08, 0.56]], [[0, 0], [-0.32, 0.44]], [[0, 0], [-0.44, 0.14]], [[0, 0], [-0.3, -0.05]]]),
  });
  mount(B, g, -0.02, 0.49, 'sit');
}

function carpet(B, c) { // a flying rug in jointed strips that ripple, gold-bordered and fringed, with a cross-legged rider
  const g = B.root, st = B.look.st, gold = st.metal, inner = blend(c, 0x2a1a3a, 0.45), fringe = 0xf0e0b8;
  const N = 6, L = 1.3, W = 0.66, dx = L / N;
  let parent = B.group(g, -L / 2, 0.08, 0), mid = null;
  for (let i = 0; i < N; i++) {
    const seg = i ? B.group(parent, dx, 0, 0, { k: 'sway', axis: 'z', amp: 0.09, speed: 5, off: -i * 0.9 }) : parent;
    B.part(seg, `cseg${i}`, (K) => {
      K.add(G.box(dx, 0.022, W), gold, dx / 2, 0, 0, { m: st.metalM * 0.6, r: 0.5 });
      K.add(G.box(i === 0 || i === N - 1 ? dx - 0.05 : dx, 0.024, W - 0.08), c, i === 0 ? dx / 2 + 0.025 : i === N - 1 ? dx / 2 - 0.025 : dx / 2, 0.003, 0, { r: 0.95 });
      K.detail(1, () => {
        if (i > 0 && i < N - 1) K.add(G.box(dx * 0.8, 0.026, W * 0.45), i % 2 ? inner : gold, dx / 2, 0.004, 0, { r: 0.9 });
        for (let k = 0; k < 6; k++) K.add(G.oct(0.025), i % 2 ? gold : inner, dx / 2, 0.016, (k - 2.5) * W * 0.15, { sy: 0.2, r: 0.8 }); // little lozenges
        K.add(G.box(dx, 0.027, 0.012), inner, dx / 2, 0.003, W / 2 - 0.05).add(G.box(dx, 0.027, 0.012), inner, dx / 2, 0.003, -W / 2 + 0.05);
        if (i === 0 || i === N - 1) for (let k = 0; k < 9; k++) K.add(G.cyl(0.008, 0.004, 0.08, 4), fringe, i ? dx + 0.04 : -0.04, 0, (k - 4) * W * 0.11, { rz: PI / 2, r: 1 });
        if (i === 1 || i === N - 2) { K.push(dx / 2, 0.018, 0, -PI / 2, 0, i === 1 ? PI / 2 : -PI / 2); emblem(K, st, 0.16, { depth: 0.03, col: [gold, inner] }); K.pop(); }
      });
    });
    if (i === 2) mid = seg;
    parent = seg;
  }
  B.part(mid, 'ccushion', (K) => {
    K.add(G.rbox(0.24, 0.05, 0.26, 0.02, 2), B.side, dx * 0.6, 0.035, 0, { r: 0.9 });
    K.detail(1, () => { for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) K.add(G.cone(0.015, 0.05, 4), gold, dx * 0.6 + x * 0.12, 0.04, z * 0.13, { rz: x * 1.2 }); });
    K.add(G.lathe('Fnapot', [[0, 0], [0.05, 0.01], [0.065, 0.05], [0.04, 0.09], [0.02, 0.1], [0.025, 0.12]], 10), 0x9a6a3a, dx * 0.6 + 0.3, 0.02, 0.16, { r: 0.6 }); // a naphtha pot
    K.add(G.sph(0.012, 5, 4), C.fire, dx * 0.6 + 0.3, 0.15, 0.16, { g: 2 });
  });
  mount(B, mid, dx * 0.6, 0.06, 'cross');
}

function disc(B, c) { // a silver disc with a glowing crystal rim and keel, spinning, with a rider standing on it
  const g = B.root, st = B.look.st, silver = blend(0xd8dce4, c, 0.3);
  const glow = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.9 });
  const spin = B.group(g, 0, 0.2, 0, { k: 'spin', axis: 'y', speed: 2.5 });
  B.part(spin, 'ddisc', (K) => {
    K.add(G.lathe('Fdsc', [[0, -0.18], [0.12, -0.1], [0.42, -0.03], [0.56, 0.0], [0.55, 0.04], [0.45, 0.06], [0.15, 0.07], [0, 0.07]], 24), silver, 0, 0, 0, { m: 0.5, r: 0.3 });
    K.detail(1, () => { for (let k = 0; k < 12; k++) { const a = (k / 12) * PI * 2; K.add(G.box(0.06, 0.012, 0.02), shade(silver, 0.7), Math.cos(a) * 0.48, 0.06, Math.sin(a) * 0.48, { ry: -a, m: 0.5 }); } });
    K.add(G.tor(0.3, 0.01, 4, 24), st.metal, 0, 0.07, 0, { rx: PI / 2, m: st.metalM, r: 0.35 });
  });
  const rim = new THREE.Mesh(G.tor(0.56, 0.03, 5, 32), glow); rim.rotation.x = PI / 2; rim.position.y = 0.02; rim.userData.fx = { k: 'glow', base: 1.0, amp: 0.6, speed: 4 }; spin.add(rim);
  const keel = new THREE.Mesh(G.oct(0.09), glow); keel.position.y = -0.2; keel.scale.set(1, 1.8, 1); spin.add(keel);
  for (let k = 0; k < 3; k++) { const a = k * PI * 2 / 3, o = new THREE.Mesh(G.box(0.12, 0.02, 0.05), glow); o.position.set(Math.cos(a) * 0.38, 0.075, Math.sin(a) * 0.38); o.rotation.y = -a; spin.add(o); }
  B.part(g, 'dped', (K) => { K.add(G.cyl(0.12, 0.14, 0.04, 12), B.side, 0, 0.29, 0); K.add(G.tor(0.13, 0.008, 3, 14), st.metal, 0, 0.31, 0, { rx: PI / 2, m: st.metalM }); });
  mount(B, g, 0, 0.31, 'stand');
  B.part(g, 'dstaff', (K) => { K.bar([0.06, 0.32, -0.11], [0.12, 0.84, -0.12], 0.012, silver, { m: 0.5 }); K.add(G.tor(0.04, 0.006, 3, 10), st.metal, 0.12, 0.84, -0.12, { m: st.metalM }); });
  const orb = new THREE.Mesh(G.sph(0.04, 10, 8), glow); orb.position.set(0.12, 0.86, -0.12); g.add(orb);
  g.userData.glowMat = glow;
}

function insect(B, c) { // a giant dragonfly: bulging eyes, segmented tail, jointed legs and four veined glassy wings that buzz
  const g = B.root, dark = shade(c, 0.55), eye = blend(c, 0xa02a1a, 0.6), wingC = blend(c, 0xe8f4f0, 0.75);
  B.part(g, 'ibody', (K) => {
    body(K, 'thorax', [[0.02, 0.26, 0, 0.06, 0.07], [0.1, 0.27, 0, 0.1, 0.1], [0.2, 0.27, 0, 0.09, 0.09], [0.26, 0.27, 0, 0.06, 0.06]], c, dark, { r: 0.35, m: 0.3 });
    for (const s of [-1, 1]) K.add(G.sph(0.07, 12, 9), eye, 0.3, 0.29, s * 0.05, { r: 0.15, m: 0.45 });
    K.add(G.sph(0.03, 8, 6), dark, 0.35, 0.24, 0, { r: 0.4 });
    for (let k = 0; k < 9; k++) { const x = -0.0 - k * 0.075, r = 0.042 - k * 0.0028; K.add(G.cyl(r, r * 0.92, 0.072, 10), k % 2 ? c : shade(c, 0.85), x, 0.26, 0, { rz: PI / 2, r: 0.3, m: 0.3 }); K.add(G.tor(r * 0.95, 0.004, 3, 10), dark, x - 0.036, 0.26, 0, { ry: PI / 2, lv: 1 }); }
    K.add(G.cone(0.016, 0.07, 6), dark, -0.71, 0.26, 0, { rz: PI / 2 });
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) limb(K, `ileg${k}${s}`, [[0.18 - k * 0.07, 0.21, s * 0.04], [0.2 - k * 0.1, 0.13, s * 0.12], [0.22 - k * 0.13, 0.04, s * 0.15]], 0.01, 0.006, dark, { toes: 2, claw: dark });
    saddle(K, B, 0.12, 0.34, { len: 0.16, w: 0.15, drop: 0.08 });
  });
  for (const [x, rake, len, wide, off] of [[0.2, 0.12, 0.72, 0.13, 0], [0.08, -0.2, 0.66, 0.16, PI]]) for (const s of [-1, 1]) {
    const pv = B.group(g, x, 0.33, s * 0.04, { k: 'wing', s, amp: 0.45, speed: 55, base: -0.05, off, fold: 0.8 });
    const w = B.group(pv); w.rotation.y = s * rake;
    B.part(w, `iw${x}${s}`, (K) => {
      K.add(flat(`iwg${len}`, [[0.04, 0], [0.06, len * 0.5], [0.02, len], [-wide * 0.6, len * 0.95], [-wide, len * 0.5], [-0.05, 0]], s), wingC, 0, 0, 0, { r: 0.2, m: 0.3 });
      K.detail(1, () => { for (let v = 1; v < 4; v++) K.bar([0.02 - v * 0.015, 0.004, 0], [0.02 - v * wide * 0.28, 0.004, s * len * (0.92 - v * 0.08)], 0.003, dark); K.add(G.box(0.03, 0.003, 0.05), dark, -wide * 0.25, 0.005, s * len * 0.85); });
      K.bar([0.04, 0.005, 0], [0.04, 0.005, s * len * 0.92], 0.007, dark);
    }, glass());
  }
  mount(B, g, 0.12, 0.36, 'sit');
}

function kite(B, c) { // a great framed war-kite leaning into the wind, the rider slung beneath it, tails streaming
  const g = B.root, st = B.look.st, side = B.side, wood = 0x4a3420, cord = 0xd8ccb0;
  const k = B.group(g, 0, 0.78, 0, { k: 'sway', axis: 'x', amp: 0.08, speed: 1.7 });
  const face = B.group(k); face.rotation.z = PI / 2 + 1.1; // the sail's plane, its top leaning back
  B.part(face, 'ksail', (K) => {
    const out = [[0.55, 0], [0.32, 0.78], [-0.05, 0.72], [-0.3, 0], [-0.05, -0.72], [0.32, -0.78]];
    K.add(clothPanel('Fksailc', (u, v) => {
      // interpolate inside the hexagon: v across (z), u along (x)
      const z = (v - 0.5) * 1.5, zz = Math.abs(z), x0 = -0.3 + zz * 0.35, x1 = 0.55 - zz * 0.3;
      return [x0 + (x1 - x0) * u, Math.sin(PI * u) * Math.sin(PI * v) * 0.06, 0, z * (1 - Math.max(0, zz - 0.72) * 2)];
    }, 0, 6, 8, { u: 2, v: 3 }), c, 0, 0, 0, { r: 0.85, rx: 0 });
    K.add(flat('ks', out), c, 0, -0.002, 0, { r: 0.85, from: 3 });
    K.detail(2, () => { K.push(0.15, 0.012, 0, -PI / 2, 0, -PI / 2); emblem(K, st, 0.42, { depth: 0.02, col: [side, st.metal], back: true }); K.pop(); });
    K.bar([0.55, 0.02, 0], [-0.3, 0.02, 0], 0.016, wood);
    K.bar([0.32, 0.02, -0.78], [0.32, 0.02, 0.78], 0.016, wood);
    K.bar([-0.05, 0.02, -0.72], [-0.05, 0.02, 0.72], 0.013, wood);
    K.detail(1, () => { for (let i = 0; i < 6; i++) { const a = out[i], b = out[(i + 1) % 6]; K.bar([a[0], 0.01, a[1]], [b[0], 0.01, b[1]], 0.005, cord); } });
    for (const s of [-1, 1]) K.add(G.box(0.06, 0.02, 0.05), side, 0.32, 0.02, s * 0.78);
  });
  // streamers from the top corner, in a chain that flutters behind
  let p = B.group(k, -0.5, 0.25, 0);
  for (let i = 0; i < 3; i++) {
    const t = B.group(p, i ? -0.2 : 0, 0, 0, { k: 'sway', axis: 'y', amp: 0.4, speed: 6, off: -i * 1.1 });
    B.part(t, `kt${i}`, (K) => K.add(G.shape('Fkt', [[0, 0.03], [-0.2, 0.05], [-0.2, -0.05], [0, -0.03]]), i % 2 ? side : st.cloth2, 0, 0, 0, { rx: PI / 2, r: 0.9 }));
    p = t;
  }
  // the rider swings on his lines below
  const sling = B.group(k, 0.12, 0, 0, { k: 'sway', axis: 'z', amp: 0.12, speed: 2.1, off: 1 });
  B.part(sling, 'klines', (K) => {
    for (const s of [-1, 1]) K.bar([0, 0, s * 0.3], [0.08, -0.4, s * 0.1], 0.005, cord);
    K.bar([-0.1, 0.1, 0], [0.08, -0.4, 0], 0.005, cord);
    K.bar([0.08, -0.4, -0.13], [0.08, -0.4, 0.13], 0.012, wood);
  });
  mount(B, sling, 0, -0.8, 'hang');
}

const BUILD = { glider, gyro, bird, bat, pegasus, griffon, dragon, beast, carpet, disc, insect, kite };
const DEFAULT = { glider: 0xe8dcc0, gyro: 0x8a6a3a, bird: 0x7a5a3a, bat: 0x3a3434, pegasus: 0xf0ece4, griffon: 0xc8a050, dragon: 0x8a2a1a,
  beast: 0x4a6a3a, carpet: 0xa82a2a, disc: 0x6ad8ff, insect: 0x2a8a8a, kite: 0xc83a2a };

// ------------------------------------------------------------------ detail by distance
const LOD_AT = [9, 18, 32, 55, 95]; // world distance (per unit of the flier's own size) where each level begins
const _wp = new THREE.Vector3(), _ws = new THREE.Vector3();
/** switch a flier to detail level n (0 closest .. 5) */
export function flierLod(f, n) {
  const L = f.userData.flierLod;
  if (!L || L.level === n) return;
  L.level = n;
  for (const { mesh, geos } of L.meshes) { const geo = geos[Math.min(n, geos.length - 1)]; mesh.visible = geo !== EMPTY_GEO; if (mesh.visible) mesh.geometry = geo; }
  for (const o of L.extra) o.visible = n < 4; // the rotor's blur and such
}
function selfLod(f, hook) {
  // the body mesh is always drawn: before it is, measure how far the camera is and pick the level for the next frame
  hook.onBeforeRender = (r, s, cam) => {
    if (!cam || !cam.isPerspectiveCamera) return;
    hook.matrixWorld.decompose(_wp, _q0, _ws);
    const d = cam.position.distanceTo(_wp) / Math.max(0.3, _ws.x);
    let lv = 0; while (lv < 5 && d > LOD_AT[lv]) lv++;
    flierLod(f, lv);
  };
}
const _q0 = new THREE.Quaternion();

/** one flier of the given style; color is the creature's or craft's own colour (optional); realm dresses rider and tack */
export function makeFlier(style, sideColor, color, realm) {
  const st = BUILD[style] ? style : 'glider', col = color ?? DEFAULT[st];
  const look = realmLook(realm || null);
  const B = new Build(`${st}|${col}|${sideColor}|${look.id}`, sideColor, col, look);
  B.root.userData.flier = st;
  BUILD[st](B, col);
  const g = B.root;
  g.traverse((o) => { if (o.isMesh) o.userData.noCrew = true; });
  const extra = [];
  g.traverse((o) => { if (o.isMesh && !o.userData.lodGeos && o.material === discMat) extra.push(o); });
  g.userData.flierLod = { meshes: B.lods, extra, level: 0 };
  if (B.lods[0]) selfLod(g, B.lods[0].mesh);
  g.userData.realm = look.id;
  return g;
}

/** moves a flier's tagged parts; p staggers one flier from the next; dive 0..1 folds into a stoop, -1..0 pulls up */
export function animateFlier(f, t, p = 0, dive = 0) {
  if (!f.__fx) { f.__fx = []; f.traverse((o) => { if (o.userData.fx) f.__fx.push(o); }); }
  const d = Math.max(0, dive), up = Math.max(0, -dive), quick = 1 + up * 0.8;
  for (const o of f.__fx) {
    const x = o.userData.fx;
    switch (x.k) {
      case 'wing': {
        const flap = x.base + Math.sin(t * x.speed * quick + (x.off || 0) + p) * x.amp * (1 - d * 0.85) * (1 + up * 0.4);
        // a stoop: the inner panel sweeps back and up, the outer folds against it
        o.rotation.x = x.s * (flap * (1 - d) + d * (x.outer ? 0.25 : 0.35));
        o.rotation.y = -x.s * d * (x.fold ?? 1) * (x.outer ? 1.1 : 0.75);
        break;
      }
      case 'spin': o.rotation[x.axis] = t * x.speed + p; break;
      case 'sway': o.rotation[x.axis] = Math.sin(t * x.speed + (x.off || 0) + p) * x.amp * (1 + d); break;
      case 'glow': o.material.emissiveIntensity = x.base + Math.sin(t * x.speed + p) * x.amp + d * 1.2; break;
      case 'rider': o.rotation.z = -d * 0.55 + up * 0.15; o.position.x = (o.userData.x0 ??= o.position.x) + d * 0.03; break;
      case 'lance': o.rotation.z = 0.25 + d * 0.75; break; // couched level as the rider leans into the stoop
    }
  }
  // the nose goes down into the dive
  f.rotation.z = (f.userData.rz0 ?? 0) - d * 0.55 + up * 0.3;
}
