// The fliers a carrier launches, one builder per style, each with its rider in the side's colour.
// Every flier faces +x with its wings along z and its lowest point near y = 0, so it can also sit
// parked on a flight deck. Moving parts carry plain tags in userData.fx (so clones keep them):
//   wing  flaps about x        { k: 'wing', s, amp, speed, base, off }
//   spin  turns on one axis    { k: 'spin', axis, speed }
//   sway  rocks on one axis    { k: 'sway', axis, amp, speed, off }
//   glow  pulses its emissive  { k: 'glow', base, amp, speed }
// animateFlier() reads those tags; the material of a glowing part is the flier's own clone.
import * as THREE from 'three';
import { mat } from './models.js';

const GEO = new Map();
const gc = (k, make) => { if (!GEO.has(k)) GEO.set(k, make()); return GEO.get(k); };
const sph = (r, w = 7, h = 5) => gc(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const cone = (r, h, n = 5) => gc(`k${r},${h},${n}`, () => new THREE.ConeGeometry(r, h, n));
const cyl = (a, b, h, n = 5) => gc(`c${a},${b},${h},${n}`, () => new THREE.CylinderGeometry(a, b, h, n));
const cap = (r, len, n = 6) => gc(`p${r},${len},${n}`, () => new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 2, n));
const box = (w, h, d) => gc(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
/** a flat plate from [x, z] points (z mirrored when s = -1), lying in the xz plane */
const flat = (key, pts, s = 1) => gc(`f${key}${s}`, () => {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z * s)));
  const g = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
});

const SKIN = 0xe0b48a;
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
const mix = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();
const M = (c, o) => mat(c, { flatShading: true, ...o });
const MD = (c, o) => mat(c, { flatShading: true, side: THREE.DoubleSide, ...o });

function add(p, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz);
  o.castShadow = true; p.add(o);
  return o;
}
/** a thin rod from a to b (points [x, y, z]) */
function rod(p, a, b, r, m, n = 4) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const o = new THREE.Mesh(cyl(r, r, 1, n), m);
  o.scale.set(1, len, 1); o.position.copy(A).addScaledVector(d, 0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  o.castShadow = true; p.add(o);
  return o;
}
function group(p, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; }

/** the rider, in the side's colour: sit (astride), cross (cross-legged), stand, prone or hang */
function rider(p, side, x, y, pose = 'sit') {
  const g = group(p, x, y, 0), cloth = M(side), dark = M(shade(side, 0.55)), skin = M(SKIN);
  if (pose === 'prone') {
    add(g, cap(0.055, 0.3), cloth, 0, 0, 0, 0, 0, Math.PI / 2);
    add(g, sph(0.05, 6, 4), skin, 0.2, 0.02, 0);
    add(g, box(0.18, 0.035, 0.1), dark, -0.22, 0, 0);
    return g;
  }
  const torso = add(g, cap(0.058, 0.22, 5), cloth, 0, 0.13, 0);
  add(g, sph(0.052, 6, 4), skin, 0.01, 0.28, 0);
  add(g, cone(0.055, 0.07, 5), dark, 0, 0.335, 0); // helmet
  if (pose === 'sit') { torso.rotation.z = -0.25; for (const s of [-1, 1]) add(g, box(0.16, 0.05, 0.05), dark, 0.05, 0.03, s * 0.07, s * 0.5, 0, -0.5); }
  else if (pose === 'cross') { for (const s of [-1, 1]) add(g, box(0.07, 0.05, 0.17), dark, 0.04, 0.02, s * 0.05, 0, s * 0.6, 0); }
  else { // stand / hang: legs below
    g.position.y += 0.16;
    for (const s of [-1, 1]) add(g, cyl(0.03, 0.025, 0.2, 4), dark, 0, -0.06, s * 0.035);
    for (const s of [-1, 1]) add(g, cyl(0.022, 0.02, 0.16, 4), cloth, 0.02, 0.15, s * 0.075, s * 0.35, 0, 0);
  }
  return g;
}
const tag = (o, fx) => { o.userData.fx = fx; return o; };

/** two wings, each an inner panel and an outer panel on their own pivots; returns the inner pivots */
function wings(g, key, { at, inner, outer, joint, m, amp = 0.55, speed = 6, base = -0.1, lag = 0.7, bones, boneM }) {
  for (const s of [-1, 1]) {
    const pv = tag(group(g, at[0], at[1], s * at[2]), { k: 'wing', s, amp, speed, base });
    add(pv, flat(`${key}i`, inner, s), m);
    const pv2 = tag(group(pv, joint[0], 0, s * joint[1]), { k: 'wing', s, amp: amp * 0.7, speed, base: base * 0.5, off: -lag });
    add(pv2, flat(`${key}o`, outer, s), m);
    if (bones) for (const [a, b] of bones) rod(pv2, [a[0], 0.01, s * a[1]], [b[0], 0.01, s * b[1]], 0.012, boneM);
    pv.rotation.x = s * base;
  }
}

// ---------------------------------------------------------------- the styles

function glider(c, side) { // a canvas hang-glider with flexing ornithopter tips; the pilot hangs prone under it
  const g = new THREE.Group(), sail = MD(c), stripe = MD(side), wood = M(0x5a3e24);
  const y = 0.55;
  for (const s of [-1, 1]) {
    const pv = tag(group(g, 0, y, 0), { k: 'wing', s, amp: 0.18, speed: 3.2, base: -0.08 });
    add(pv, flat('gl', [[0.5, 0], [-0.1, 0.55], [-0.2, 0.5], [-0.25, 0]], s), sail);
    rod(pv, [0.5, 0.01, 0], [-0.1, 0.01, s * 0.55], 0.014, wood);
    const tip = tag(group(pv, -0.1, 0, s * 0.55), { k: 'wing', s, amp: 0.35, speed: 3.2, base: 0, off: -0.8 });
    add(tip, flat('glt', [[0, 0], [-0.32, 0.36], [-0.4, 0.3], [-0.1, -0.05]], s), sail);
    add(tip, flat('gls', [[-0.04, 0.03], [-0.3, 0.33], [-0.34, 0.3], [-0.09, 0]], s), stripe).position.y = 0.012;
    rod(tip, [0, 0.01, 0], [-0.32, 0.01, s * 0.36], 0.012, wood);
    pv.rotation.x = s * -0.08;
  }
  rod(g, [0.52, y, 0], [-0.3, y, 0], 0.016, wood); // keel
  add(g, box(0.12, 0.05, 0.02), stripe, -0.22, y + 0.05, 0); // a tail pennant
  for (const s of [-1, 1]) rod(g, [0.08, y, 0], [0.14, 0.14, s * 0.18], 0.01, wood); // the control frame
  rod(g, [0.14, 0.14, -0.18], [0.14, 0.14, 0.18], 0.011, wood);
  rod(g, [0.0, y, 0], [0.0, 0.28, 0], 0.006, wood);
  rider(g, side, 0.0, 0.22, 'prone');
  return g;
}

function gyro(c, side) { // a little rotor-craft: a hull with an open cockpit, a two-bladed rotor and a pusher prop
  const g = new THREE.Group(), hull = M(c, { roughness: 0.6 }), brass = mat(0xc8a040, { metalness: 0.7, roughness: 0.35, flatShading: true }), iron = M(0x2e2e32);
  add(g, cap(0.13, 0.62, 7), hull, 0, 0.24, 0, 0, 0, Math.PI / 2, 1, 1, 0.85);
  add(g, cone(0.09, 0.16, 7), brass, 0.37, 0.24, 0, 0, 0, -Math.PI / 2);
  add(g, cyl(0.035, 0.045, 0.16, 6), iron, -0.12, 0.42, 0.06); // boiler stack
  rod(g, [-0.25, 0.27, 0], [-0.72, 0.32, 0], 0.025, hull);
  add(g, flat('gyf', [[0, 0], [-0.16, 0], [-0.2, 0.2], [-0.08, 0.18]]), MD(side), -0.62, 0.32, 0, -Math.PI / 2, 0, 0);
  add(g, flat('gyh', [[0, -0.14], [0, 0.14], [-0.12, 0.12], [-0.12, -0.12]]), MD(shade(c, 0.8)), -0.62, 0.31, 0);
  const prop = tag(group(g, -0.76, 0.32, 0), { k: 'spin', axis: 'x', speed: 40 });
  add(prop, box(0.02, 0.32, 0.04), iron);
  for (const s of [-1, 1]) { add(g, box(0.62, 0.025, 0.03), iron, 0.02, 0.015, s * 0.14); rod(g, [0.15, 0.02, s * 0.14], [0.1, 0.16, s * 0.06], 0.01, iron); rod(g, [-0.15, 0.02, s * 0.14], [-0.1, 0.16, s * 0.06], 0.01, iron); }
  rod(g, [0.0, 0.32, 0], [0.0, 0.66, 0], 0.022, iron); // the mast
  const rotor = tag(group(g, 0, 0.67, 0), { k: 'spin', axis: 'y', speed: 26 });
  add(rotor, box(1.5, 0.014, 0.08), M(0x3a3226));
  add(rotor, box(0.08, 0.014, 1.5), M(0x3a3226));
  add(rotor, cyl(0.05, 0.05, 0.05, 6), brass);
  add(rotor, gc('gydisc', () => new THREE.CircleGeometry(0.74, 16).rotateX(-Math.PI / 2)), mat(0xd8d0c0, { transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  g.userData.rotor = rotor; // legacy hook
  rider(g, side, 0.08, 0.26, 'sit');
  return g;
}

function bird(c, side) { // a great raptor with broad fingered wings and a fanned tail
  const g = new THREE.Group(), body = M(c), pale = M(mix(c, 0xf4ecd8, 0.45)), wingM = MD(shade(c, 0.85)), beak = M(0xe0b030);
  add(g, sph(0.2, 8, 6), body, 0, 0.24, 0, 0, 0, 0, 1.7, 0.75, 0.8);
  add(g, sph(0.12, 7, 5), pale, 0.3, 0.29, 0, 0, 0, 0, 1.2, 1, 0.9);
  add(g, sph(0.085, 7, 5), pale, 0.44, 0.34, 0, 0, 0, 0, 1.25, 1, 0.9);
  add(g, cone(0.04, 0.14, 4), beak, 0.56, 0.31, 0, 0, 0, -Math.PI / 2 - 0.45);
  add(g, flat('bt', [[-0.22, 0], [-0.6, -0.2], [-0.66, -0.06], [-0.68, 0.06], [-0.6, 0.2]]), wingM, 0, 0.25, 0);
  for (const s of [-1, 1]) add(g, cone(0.03, 0.14, 4), beak, -0.08, 0.1, s * 0.07, 0, 0, Math.PI / 2 + 0.6);
  wings(g, 'bw', {
    at: [0.08, 0.3, 0.09], m: wingM, amp: 0.55, speed: 5, base: -0.12,
    inner: [[0.13, 0], [0.1, 0.5], [-0.17, 0.5], [-0.2, 0]],
    joint: [0, 0.5],
    outer: [[0.1, 0], [0.05, 0.3], [0.0, 0.52], [-0.05, 0.45], [-0.08, 0.54], [-0.12, 0.45], [-0.16, 0.5], [-0.18, 0.38], [-0.17, 0]],
  });
  rider(g, side, 0.12, 0.36, 'sit');
  return g;
}

function bat(c, side) { // a leathery giant bat: tall ears, scalloped membranes stretched on finger bones
  const g = new THREE.Group(), fur = M(c), skin = MD(mix(c, 0x7a4a40, 0.3)), bone = M(shade(c, 0.6));
  add(g, sph(0.16, 7, 5), fur, 0, 0.22, 0, 0, 0, 0, 1.6, 0.85, 0.85);
  add(g, sph(0.1, 7, 5), fur, 0.27, 0.25, 0);
  add(g, cone(0.045, 0.1, 4), fur, 0.37, 0.23, 0, 0, 0, -Math.PI / 2);
  for (const s of [-1, 1]) add(g, cone(0.04, 0.16, 4), fur, 0.27, 0.38, s * 0.055, s * 0.3, 0, 0.2);
  for (const s of [-1, 1]) add(g, cone(0.025, 0.2, 4), bone, -0.3, 0.2, s * 0.06, 0, 0, Math.PI / 2 + 0.2);
  wings(g, 'aw', {
    at: [0.06, 0.26, 0.1], m: skin, amp: 0.7, speed: 8, base: -0.05, lag: 0.9, boneM: bone,
    inner: [[0.1, 0], [0.06, 0.5], [-0.2, 0.42], [-0.13, 0.22], [-0.2, 0]],
    joint: [0.06, 0.5],
    outer: [[0, 0], [-0.04, 0.62], [-0.15, 0.4], [-0.3, 0.5], [-0.28, 0.24], [-0.42, 0.2], [-0.26, -0.08]],
    bones: [[[0, 0], [-0.04, 0.62]], [[0, 0], [-0.3, 0.5]], [[0, 0], [-0.42, 0.2]]],
  });
  rider(g, side, 0.05, 0.33, 'sit');
  return g;
}

function pegasus(c, side) { // a winged horse with raised feathered wings
  const g = new THREE.Group(), hide = M(c), mane = M(mix(c, 0x8a7a6a, 0.5)), hoof = M(0x3a3028), feather = MD(mix(c, 0xffffff, 0.35));
  add(g, cap(0.14, 0.56, 7), hide, 0, 0.42, 0, 0, 0, Math.PI / 2, 1, 1, 0.85);
  add(g, cyl(0.06, 0.09, 0.32, 6), hide, 0.28, 0.58, 0, 0, 0, -0.7);
  add(g, box(0.24, 0.1, 0.09), hide, 0.44, 0.68, 0, 0, 0, -0.55);
  for (const s of [-1, 1]) add(g, cone(0.022, 0.07, 4), hide, 0.36, 0.8, s * 0.03);
  add(g, box(0.24, 0.05, 0.03), mane, 0.24, 0.66, 0, 0, 0, -0.75);
  add(g, cone(0.06, 0.34, 4), mane, -0.38, 0.36, 0, 0, 0, -0.9 + Math.PI);
  for (const [x, rz] of [[0.2, -0.35], [-0.22, 0.4]]) for (const s of [-1, 1]) {
    add(g, cyl(0.035, 0.025, 0.34, 5), hide, x, 0.2, s * 0.08, 0, 0, rz);
    add(g, box(0.05, 0.04, 0.05), hoof, x + 0.15 * Math.sin(rz), 0.2 - 0.15 * Math.cos(rz), s * 0.08);
  }
  wings(g, 'pw', {
    at: [0.12, 0.54, 0.09], m: feather, amp: 0.5, speed: 4.2, base: -0.4,
    inner: [[0.1, 0], [0.07, 0.42], [-0.13, 0.42], [-0.15, 0]],
    joint: [0, 0.42],
    outer: [[0.07, 0], [-0.04, 0.32], [-0.2, 0.52], [-0.22, 0.44], [-0.27, 0.46], [-0.24, 0.34], [-0.28, 0.32], [-0.13, 0]],
  });
  rider(g, side, 0.02, 0.55, 'sit');
  rod(g, [-0.02, 0.6, 0.09], [0.55, 1.0, 0.12], 0.012, M(0x5a4430));
  add(g, flat('pl', [[0, 0], [-0.14, -0.04], [-0.14, 0.06]]), MD(side), 0.48, 0.95, 0.12, -Math.PI / 2, 0, 0.6);
  return g;
}

function griffon(c, side) { // an eagle in front, a lion behind: hooked beak, talons, haunches and a tufted tail
  const g = new THREE.Group(), lion = M(c), eagle = M(mix(c, 0xf2ead8, 0.6)), beak = M(0xe0b030), feather = MD(mix(c, 0x5a4028, 0.35));
  add(g, cap(0.14, 0.42, 7), lion, -0.13, 0.36, 0, 0, 0, Math.PI / 2, 1, 1, 0.9);
  add(g, sph(0.15, 7, 5), eagle, 0.13, 0.42, 0, 0, 0, 0, 1.1, 1, 0.9);
  add(g, sph(0.095, 7, 5), eagle, 0.3, 0.55, 0);
  add(g, cone(0.04, 0.13, 4), beak, 0.41, 0.52, 0, 0, 0, -Math.PI / 2 - 0.5);
  for (const s of [-1, 1]) add(g, cone(0.025, 0.09, 4), eagle, 0.26, 0.65, s * 0.04, 0, 0, 0.5);
  for (const s of [-1, 1]) { add(g, cyl(0.035, 0.02, 0.3, 4), beak, 0.18, 0.17, s * 0.07, 0, 0, -0.2); add(g, cyl(0.055, 0.03, 0.32, 5), lion, -0.26, 0.17, s * 0.08, 0, 0, 0.3); }
  rod(g, [-0.4, 0.4, 0], [-0.78, 0.48, 0], 0.018, lion);
  add(g, sph(0.05, 5, 4), M(shade(c, 0.55)), -0.8, 0.49, 0, 0, 0, 0, 1.4, 1, 1);
  wings(g, 'gw', {
    at: [0.12, 0.5, 0.09], m: feather, amp: 0.55, speed: 4.6, base: -0.2,
    inner: [[0.12, 0], [0.09, 0.46], [-0.17, 0.46], [-0.2, 0]],
    joint: [0, 0.46],
    outer: [[0.09, 0], [0.03, 0.3], [-0.01, 0.48], [-0.06, 0.42], [-0.09, 0.5], [-0.13, 0.42], [-0.17, 0.46], [-0.18, 0.34], [-0.17, 0]],
  });
  rider(g, side, -0.04, 0.5, 'sit');
  return g;
}

function dragon(c, side) { // a slender drake: long rising neck, horned head, long spade tail, spined back
  const g = new THREE.Group(), scale = M(c), belly = M(mix(c, 0xe8c890, 0.4)), horn = M(0xe8dcc0), memb = MD(mix(c, 0xd8803a, 0.35)), boneM = M(shade(c, 0.7));
  add(g, sph(0.16, 7, 5), scale, 0, 0.32, 0, 0, 0, 0, 1.9, 0.85, 0.85);
  add(g, sph(0.12, 7, 4), belly, 0.02, 0.27, 0, 0, 0, 0, 2.0, 0.6, 0.8);
  rod(g, [0.24, 0.36, 0], [0.52, 0.56, 0], 0.06, scale, 5);
  rod(g, [0.5, 0.55, 0], [0.64, 0.6, 0], 0.05, scale, 5);
  add(g, cone(0.065, 0.24, 5), scale, 0.75, 0.59, 0, 0, 0, -Math.PI / 2 - 0.15);
  add(g, cone(0.04, 0.16, 4), belly, 0.74, 0.55, 0, 0, 0, -Math.PI / 2 - 0.35); // jaw
  for (const s of [-1, 1]) add(g, cone(0.018, 0.14, 4), horn, 0.62, 0.66, s * 0.04, s * -0.3, 0, 1.9);
  for (const s of [-1, 1]) add(g, sph(0.014, 4, 3), mat(0xffd040), 0.72, 0.63, s * 0.04);
  rod(g, [-0.25, 0.32, 0], [-0.62, 0.3, 0], 0.06, scale, 5);
  add(g, cone(0.045, 0.42, 5), scale, -0.83, 0.3, 0, 0, 0, Math.PI / 2 + 0.05);
  add(g, flat('ds', [[0, 0], [-0.1, -0.08], [-0.2, 0], [-0.1, 0.08]]), MD(shade(c, 0.7)), -1.0, 0.29, 0);
  for (let k = 0; k < 5; k++) add(g, cone(0.03, 0.09, 4), horn, 0.2 - k * 0.16, 0.45 - Math.abs(k - 1) * 0.012, 0);
  for (const [x, rz] of [[0.16, -0.6], [-0.18, 0.7]]) for (const s of [-1, 1]) add(g, cone(0.035, 0.2, 4), scale, x, 0.15, s * 0.08, 0, 0, Math.PI + rz);
  wings(g, 'dw', {
    at: [0.1, 0.4, 0.09], m: memb, amp: 0.55, speed: 3.6, base: -0.18, lag: 0.9, boneM,
    inner: [[0.08, 0], [0.12, 0.5], [-0.16, 0.38], [-0.12, 0.18], [-0.25, 0]],
    joint: [0.12, 0.5],
    outer: [[0, 0], [-0.18, 0.64], [-0.24, 0.4], [-0.4, 0.46], [-0.36, 0.2], [-0.5, 0.12], [-0.3, -0.12]],
    bones: [[[0, 0], [-0.18, 0.64]], [[0, 0], [-0.4, 0.46]], [[0, 0], [-0.5, 0.12]]],
  });
  rider(g, side, -0.06, 0.44, 'sit');
  return g;
}

function beast(c, side) { // a heavy scaly wyvern: bulky body, short neck, blunt horned head, hind legs and a spiked club tail
  const g = new THREE.Group(), scale = M(c), dark = M(shade(c, 0.6)), belly = M(mix(c, 0xd8c8a0, 0.35)), horn = M(0xd8ccb0), memb = MD(mix(c, 0x4a2a20, 0.3));
  add(g, sph(0.2, 7, 5), scale, 0, 0.3, 0, 0, 0, 0, 1.5, 0.9, 0.95);
  add(g, sph(0.15, 6, 3), belly, 0.03, 0.24, 0, 0, 0, 0, 1.6, 0.7, 0.9);
  rod(g, [0.22, 0.34, 0], [0.38, 0.42, 0], 0.09, scale, 5);
  add(g, box(0.22, 0.12, 0.14), scale, 0.48, 0.44, 0, 0, 0, -0.15);
  add(g, box(0.16, 0.05, 0.11), belly, 0.5, 0.37, 0, 0, 0, -0.3);
  for (const s of [-1, 1]) add(g, cone(0.025, 0.14, 4), horn, 0.42, 0.53, s * 0.05, s * -0.4, 0, 1.7);
  for (let k = 0; k < 6; k++) add(g, cone(0.035, 0.08, 3), dark, 0.25 - k * 0.15, 0.48 - Math.abs(k - 1) * 0.03, 0);
  rod(g, [-0.25, 0.3, 0], [-0.58, 0.27, 0], 0.07, scale, 5);
  add(g, cone(0.06, 0.24, 5), scale, -0.68, 0.27, 0, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) add(g, cone(0.02, 0.09, 3), horn, -0.75, 0.27, s * 0.04, s * 1.3, 0, 0);
  for (const s of [-1, 1]) { add(g, cyl(0.06, 0.035, 0.26, 5), scale, -0.1, 0.14, s * 0.11, 0, 0, 0.4); add(g, cone(0.04, 0.08, 4), horn, -0.04, 0.03, s * 0.11, 0, 0, -Math.PI / 2); }
  wings(g, 'ww', {
    at: [0.08, 0.4, 0.12], m: memb, amp: 0.55, speed: 4, base: -0.1, lag: 0.8, boneM: dark,
    inner: [[0.12, 0], [0.1, 0.45], [-0.2, 0.4], [-0.15, 0.2], [-0.25, 0]],
    joint: [0.1, 0.45],
    outer: [[0, 0], [-0.08, 0.56], [-0.18, 0.36], [-0.32, 0.44], [-0.3, 0.2], [-0.44, 0.14], [-0.3, -0.05]],
    bones: [[[0, 0], [-0.08, 0.56]], [[0, 0], [-0.32, 0.44]], [[0, 0], [-0.44, 0.14]]],
  });
  rider(g, side, -0.02, 0.46, 'sit');
  return g;
}

function carpet(c, side) { // a flying rug in jointed strips that ripple, gold-bordered and fringed, with a cross-legged rider
  const g = new THREE.Group(), rug = MD(c), gold = M(0xd8b048), inner = M(mix(c, 0x2a1a3a, 0.45)), fringe = M(0xf0e0b8);
  const N = 6, L = 1.3, W = 0.66, dx = L / N;
  let parent = group(g, -L / 2, 0.08, 0), mid = null;
  for (let i = 0; i < N; i++) {
    const seg = i ? group(parent, dx, 0, 0) : parent;
    if (i) tag(seg, { k: 'sway', axis: 'z', amp: 0.09, speed: 5, off: -i * 0.9 });
    add(seg, box(dx, 0.022, W), gold, dx / 2, 0, 0);
    add(seg, box(i === 0 || i === N - 1 ? dx - 0.05 : dx, 0.024, W - 0.08), rug, i === 0 ? dx / 2 + 0.025 : i === N - 1 ? dx / 2 - 0.025 : dx / 2, 0.003, 0);
    if (i > 0 && i < N - 1) add(seg, box(dx * 0.8, 0.026, W * 0.45), i % 2 ? inner : gold, dx / 2, 0.004, 0);
    if (i === 0 || i === N - 1) for (let k = 0; k < 4; k++) add(seg, box(0.08, 0.012, 0.03), fringe, i ? dx + 0.04 : -0.04, 0, (k - 1.5) * W * 0.27);
    if (i === 2) mid = seg;
    parent = seg;
  }
  add(mid, box(0.22, 0.05, 0.24), M(side), dx * 0.6, 0.035, 0);
  rider(mid, side, dx * 0.6, 0.06, 'cross');
  add(mid, cyl(0.06, 0.05, 0.1, 6), M(0x9a6a3a), dx * 0.6 + 0.3, 0.06, 0.16); // a naphtha pot
  return g;
}

function disc(c, side) { // a silver disc with a glowing crystal rim and keel, spinning, with a rider standing on it
  const g = new THREE.Group(), silver = mat(mix(0xd8dce4, c, 0.3), { metalness: 0.45, roughness: 0.35, flatShading: true });
  const glow = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1, roughness: 0.3, metalness: 0.2, flatShading: true, transparent: true, opacity: 0.9 });
  const spin = tag(group(g, 0, 0.2, 0), { k: 'spin', axis: 'y', speed: 2.5 });
  add(spin, cyl(0.5, 0.56, 0.05, 12), silver, 0, 0.03, 0);
  add(spin, cyl(0.56, 0.18, 0.12, 12), glow, 0, -0.055, 0);
  tag(add(spin, gc('drim', () => new THREE.TorusGeometry(0.56, 0.03, 3, 14).rotateX(Math.PI / 2)), glow, 0, 0.01, 0), { k: 'glow', base: 1.0, amp: 0.6, speed: 4 });
  add(spin, gc('dcry', () => new THREE.OctahedronGeometry(0.09)), glow, 0, -0.16, 0, 0, 0, 0, 1, 1.8, 1);
  for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; add(spin, box(0.12, 0.02, 0.05), glow, Math.cos(a) * 0.38, 0.065, Math.sin(a) * 0.38, 0, -a, 0); }
  add(g, cyl(0.12, 0.14, 0.04, 8), M(side), 0, 0.27, 0);
  rider(g, side, 0, 0.27, 'stand');
  rod(g, [0.06, 0.3, -0.11], [0.12, 0.82, -0.12], 0.012, silver);
  add(g, sph(0.04, 5, 4), glow, 0.12, 0.84, -0.12);
  g.userData.glowMat = glow;
  return g;
}

function insect(c, side) { // a giant dragonfly: bulging eyes, long tail and four glassy wings that buzz
  const g = new THREE.Group(), shell = M(c, { roughness: 0.4, metalness: 0.3 }), dark = M(shade(c, 0.55)), eye = mat(mix(c, 0xa02a1a, 0.6), { roughness: 0.2, metalness: 0.4, flatShading: true });
  const glass = mat(mix(c, 0xe8f4f0, 0.75), { transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, roughness: 0.2, metalness: 0.3 });
  add(g, sph(0.11, 7, 5), shell, 0.14, 0.26, 0, 0, 0, 0, 1.4, 1, 0.9);
  for (const s of [-1, 1]) add(g, sph(0.075, 6, 5), eye, 0.3, 0.29, s * 0.055);
  add(g, cone(0.045, 0.7, 5), shell, -0.32, 0.26, 0, 0, 0, Math.PI / 2);
  for (let k = 0; k < 4; k++) add(g, cyl(0.042 - k * 0.008, 0.042 - k * 0.008, 0.02, 5), dark, -0.05 - k * 0.14, 0.26, 0, 0, 0, Math.PI / 2);
  for (let k = 0; k < 3; k++) for (const s of [-1, 1]) rod(g, [0.18 - k * 0.07, 0.2, s * 0.04], [0.22 - k * 0.12, 0.04, s * 0.14], 0.01, dark, 3);
  for (const [x, rake, len, wide, off] of [[0.2, 0.12, 0.72, 0.13, 0], [0.08, -0.2, 0.66, 0.16, Math.PI]]) for (const s of [-1, 1]) {
    const pv = tag(group(g, x, 0.33, s * 0.04), { k: 'wing', s, amp: 0.45, speed: 55, base: -0.05, off });
    const w = group(pv); w.rotation.y = s * rake;
    add(w, flat(`iw${len}`, [[0.04, 0], [0.06, len * 0.5], [0.02, len], [-wide * 0.6, len * 0.95], [-wide, len * 0.5], [-0.05, 0]], s), glass);
    rod(w, [0.04, 0.005, 0], [0.04, 0.005, s * len * 0.92], 0.008, dark, 3);
  }
  rider(g, side, 0.12, 0.33, 'sit');
  return g;
}

function kite(c, side) { // a great framed war-kite leaning into the wind, the rider slung beneath it, tails streaming
  const g = new THREE.Group(), sail = MD(c), wood = M(0x4a3420), cord = M(0xd8ccb0);
  const k = group(g, 0, 0.78, 0); tag(k, { k: 'sway', axis: 'x', amp: 0.08, speed: 1.7 });
  const face = group(k); face.rotation.z = Math.PI / 2 + 1.1; // the sail's plane, its top leaning back
  add(face, flat('ks', [[0.55, 0], [0.32, 0.78], [-0.05, 0.72], [-0.3, 0], [-0.05, -0.72], [0.32, -0.78]]), sail);
  for (const y of [-0.012, 0.012]) add(face, gc('kemb', () => new THREE.CircleGeometry(0.2, 10).rotateX(Math.PI / 2)), MD(side), 0.15, y, 0);
  rod(face, [0.55, 0.02, 0], [-0.3, 0.02, 0], 0.016, wood);
  rod(face, [0.32, 0.02, -0.78], [0.32, 0.02, 0.78], 0.016, wood);
  rod(face, [-0.05, 0.02, -0.72], [-0.05, 0.02, 0.72], 0.013, wood);
  for (const s of [-1, 1]) add(face, box(0.06, 0.02, 0.05), M(side), 0.32, 0.02, s * 0.78);
  // streamers from the top corner, in a chain that flutters behind
  let p = group(k, -0.5, 0.25, 0);
  for (let i = 0; i < 3; i++) {
    const t = tag(group(p, i ? -0.2 : 0, 0, 0), { k: 'sway', axis: 'y', amp: 0.4, speed: 6, off: -i * 1.1 });
    add(t, flat('kt', [[0, 0.03], [-0.2, 0.05], [-0.2, -0.05], [0, -0.03]]), MD(i % 2 ? side : 0xe8dcc0));
    p = t;
  }
  // the rider swings on his lines below
  const sling = group(k, 0.12, 0, 0); tag(sling, { k: 'sway', axis: 'z', amp: 0.12, speed: 2.1, off: 1 });
  for (const s of [-1, 1]) rod(sling, [0, 0, s * 0.3], [0.08, -0.4, s * 0.1], 0.006, cord, 3);
  rod(sling, [-0.1, 0.1, 0], [0.08, -0.4, 0], 0.006, cord, 3);
  rod(sling, [0.08, -0.4, -0.13], [0.08, -0.4, 0.13], 0.012, wood);
  rider(sling, side, 0, -0.8, 'hang');
  return g;
}

const BUILD = { glider, gyro, bird, bat, pegasus, griffon, dragon, beast, carpet, disc, insect, kite };
const DEFAULT = { glider: 0xe8dcc0, gyro: 0x8a6a3a, bird: 0x7a5a3a, bat: 0x3a3434, pegasus: 0xf0ece4, griffon: 0xc8a050, dragon: 0x8a2a1a,
  beast: 0x4a6a3a, carpet: 0xa82a2a, disc: 0x6ad8ff, insect: 0x2a8a8a, kite: 0xc83a2a };

/** one flier of the given style; color is the creature's or craft's own colour (optional) */
export function makeFlier(style, sideColor, color) {
  const st = BUILD[style] ? style : 'glider';
  const g = BUILD[st](color ?? DEFAULT[st], sideColor);
  g.userData.flier = st;
  g.traverse((o) => { if (o.isMesh) o.userData.noCrew = true; });
  return g;
}

/** moves a flier's tagged parts; p staggers one flier from the next */
export function animateFlier(f, t, p = 0) {
  if (!f.__fx) { f.__fx = []; f.traverse((o) => { if (o.userData.fx) f.__fx.push(o); }); }
  for (const o of f.__fx) {
    const x = o.userData.fx;
    switch (x.k) {
      case 'wing': o.rotation.x = x.s * (x.base + Math.sin(t * x.speed + (x.off || 0) + p) * x.amp); break;
      case 'spin': o.rotation[x.axis] = t * x.speed + p; break;
      case 'sway': o.rotation[x.axis] = Math.sin(t * x.speed + (x.off || 0) + p) * x.amp; break;
      case 'glow': o.material.emissiveIntensity = x.base + Math.sin(t * x.speed + p) * x.amp; break;
    }
  }
}
