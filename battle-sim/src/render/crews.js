// Hands on deck: small sailors standing on every ship's and airship's deck, as many as she has crew left
// (up to what her deck holds). The hands are the folk of the realm that sails her: each kind of body
// (a "kit": human, elf, dwarf, brute, goblin, skeleton, rat, lizard, ...) is a few instanced meshes, one per
// colour role, built the first time a ship of that folk shows up. Tabards are in the side's colour with the
// realm's badge on the chest; skin, armour, trim and headgear (kettle helms, kabuto, turbans, tricorns, fur caps,
// feathered bands ... one per realm, see HAT) come from the realm's palette and style (parts/realmStyle.js).
//
// Every figure has its two arms on their own instances so it can work: hands haul on lines, gunners stand at
// the rail, lookouts shade their eyes, the rest go about the deck. The effects code tells a ship's hands what
// is happening to her with pulse():
//
//   const crews = new Crews(scene)
//   crews.track(model, key, { airship })   finds the deck (raycast from above) and its standing places, once per hull type
//   crews.update(list, t)                  list: [{ model, frac (0..1 of crew aboard), color, alive, def?, faction?, size? }]
//   crews.pulse(model, kind, opts?)        kind:
//       'fire'   her guns go off: the gunners at the rail crouch behind it, the rest flinch          (~1.2 s)
//       'brace'  she is about to be hit or rammed: every hand crouches and grabs hold               (~1.4 s)
//       'board'  grapnels are over: most hands rush the rail facing the enemy with weapons up,
//                then (if they hold) cheer. opts.toward: a world point (THREE.Vector3 or {x, z})
//                to rush toward; by default the nearest other ship in the last update list           (~3.5 s)
//       'cheer'  arms up and jumping                                                                (~2 s)
//     Calling it again while the reaction runs extends it. Safe to call for models it does not track.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { REALMS } from '../data/realms.js';
import { REALM_STYLE, styleOf } from './parts/realmStyle.js';

const slotCache = new Map();
const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();

/** where on this model hands can stand: [x, y, z] in the model's own space */
function deckSlots(model, key, airship) {
  if (slotCache.has(key)) return slotCache.get(key);
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const box = new THREE.Box3().setFromObject(model);
  const meshes = [];
  model.traverse((o) => { if (o.isMesh && o.visible !== false && !o.userData.noCrew) meshes.push(o); });
  const top = (model.userData.top ?? box.max.y) - model.position.y;
  // the hull runs along the model's x; sample a grid over it
  const sx = (box.max.x - box.min.x), sz = (box.max.z - box.min.z), cx = (box.max.x + box.min.x) / 2, cz = (box.max.z + box.min.z) / 2;
  const L = Math.max(sx, sz), alongX = sx >= sz, B = Math.min(sx, sz);
  const hits = [];
  for (let i = 0; i < 14; i++) for (let j = 0; j < 5; j++) {
    const u = -0.4 + (0.8 * i) / 13, v = -0.32 + (0.64 * j) / 4;
    from.set(cx + (alongX ? u * L : v * B), box.max.y + 2, cz + (alongX ? v * B : u * L));
    ray.set(from, down); ray.far = box.max.y - box.min.y + 4;
    const all = ray.intersectObjects(meshes, false).filter((h) => h.face && h.face.normal && new THREE.Vector3().copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.6);
    if (!all.length) continue;
    // a ship's deck is the highest level surface well below her mastheads; an airship's is the lowest (the gondola under the bag)
    const ok = airship ? all.slice().sort((a, c) => a.point.y - c.point.y) : all.filter((h) => h.point.y - model.position.y < top * 0.45 && h.point.y - model.position.y > -0.2);
    const h = ok[0];
    if (!h) continue;
    const p = h.point.clone().applyMatrix4(inv);
    hits.push([p.x, p.y, p.z]);
  }
  // keep the main deck level (drop cabin roofs and odd high points)
  const ys = hits.map((p) => p[1]).sort((a, c) => a - c), mid = ys[Math.floor(ys.length * 0.4)] ?? 0;
  const slots = hits.filter((p) => Math.abs(p[1] - mid) < 0.7);
  // a stable, spread-out order so the first few hands are not all in one corner
  slots.sort((a, c) => ((a[0] * 7.13 + a[2] * 3.7) % 1) - ((c[0] * 7.13 + c[2] * 3.7) % 1));
  slotCache.set(key, slots);
  return slots;
}

// ---------------------------------------------------------------------------------------------
// Body kits. Each part is [geometry, role, piece]; a figure faces +z and stands on y = 0.
// piece: 'body' (default), 'armL' / 'armR' (built hanging from the shoulder at the origin, posed every frame).
// Roles: side (tabard, in the side's colour), cloth (tunic, sleeves), skin, armor, trim, metal, hair, legs,
// boots, bone, badge (the realm's device colour on the chest), dark (hafts, gear)
// Budget: about 200-300 triangles a figure with its hat.
// ---------------------------------------------------------------------------------------------
const e = new THREE.Euler(), mq = new THREE.Quaternion(), mm = new THREE.Matrix4(), mp = new THREE.Vector3(), ms = new THREE.Vector3();
const put = (g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  mm.compose(mp.set(x, y, z), mq.setFromEuler(e.set(rx, ry, rz)), ms.set(sx, sy, sz));
  g.applyMatrix4(mm);
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
};
const cyl = (rt, rb, h, x, y, z, o = {}) => put(new THREE.CylinderGeometry(rt, rb, h, o.seg || 6, 1, !!o.open), x, y, z, o.rx, o.ry, o.rz, o.sx, 1, o.sz);
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1, o = {}) => put(new THREE.SphereGeometry(r, o.w || 5, o.h || 3, 0, Math.PI * 2, 0, o.th ?? Math.PI), x, y, z, o.rx, o.ry, o.rz, sx, sy, sz);
const cone = (r, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 4) => put(new THREE.ConeGeometry(r, h, seg), x, y, z, rx, ry, rz);
const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => put(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
const lathe = (pts, seg, x, y, z, sx = 1, sz = 1) => put(new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), seg), x, y, z, 0, 0, 0, sx, 1, sz);
/** a flat outline [[x, y]...] in the xy plane, thickened a little (a tabard panel) */
const plate = (pts, x, y, z, ry = 0) => put(new THREE.ShapeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)))), x, y, z, 0, ry, 0);
const pair = (f) => [f(1), f(-1)];

/**
 * the base of most kits: legs and boots, belt, a shaped torso under a tabard with the badge, pauldrons, head,
 * and two arms (each a sleeve and a hand; the right one carries the tool or weapon)
 * Returns { parts, shoulder: [x, y, z], arm: length, head: [x, y, z], headR }
 */
function biped(o = {}) {
  const h = o.h ?? 1, w = o.w ?? 1, lean = o.lean ?? 0, head = o.head ?? 0.085;
  const L = 0.2 * h, T = 0.3 * h;
  const cz = Math.sin(lean) * T * 0.5;
  const hy = o.headY ?? L + T + head * 0.85, hz = o.headZ ?? cz * 2.2;
  const legs = o.legs || 'legs', torso = o.torso || 'cloth', arms = o.arms || 'cloth';
  const TZ = 0.11 * 0.85 + 0.006; // the chest's front, where the tabard lies
  const upper = [ // everything above the hips leans with the figure
    [cyl(0.088 * w, 0.09 * w, 0.045, 0, L + 0.02, 0, { seg: 7, open: true }), 'trim'], // the belt
    [lathe([[0.08, 0], [0.1, 0.12], [0.11, 0.24], [0.085, T * 0.98], [0.035, T * 1.02]], 6, 0, L + 0.01, 0, w * (o.chest ?? 1), 0.85), torso],
    // the tabard over the chest and back, pointed below the belt, and the realm's badge
    [plate([[-0.072 * w, 0.02], [0, -0.06], [0.072 * w, 0.02], [0.068 * w, 0.25], [-0.068 * w, 0.25]], 0, L, TZ), 'side'],
    [plate([[-0.072 * w, 0.02], [0, -0.05], [0.072 * w, 0.02], [0.068 * w, 0.25], [-0.068 * w, 0.25]], 0, L, -TZ, Math.PI), 'side'],
    [put(new THREE.OctahedronGeometry(0.03, 0), 0, L + T * 0.6, TZ + 0.006, 0, 0, Math.PI / 4, 1, 1.2, 0.3), 'badge'],
  ];
  if (o.pauldrons !== false) upper.push(...pair((s) => [ball(0.045 * w, s * 0.105 * w, L + T * 0.92, 0, 1.15, 0.75, 1.1, { w: 5, h: 2, th: Math.PI * 0.6 }), 'armor']));
  if (lean) { mm.makeTranslation(0, -L, 0).premultiply(new THREE.Matrix4().makeRotationX(lean)).premultiply(new THREE.Matrix4().makeTranslation(0, L, 0)); for (const [g] of upper) g.applyMatrix4(mm); }
  const P = [
    ...pair((s) => [cyl(0.036 * w, 0.028 * w, L, s * 0.048 * w, L / 2 + 0.02, 0, { seg: 5, open: true }), legs]),
    ...(o.feet === 'hoof' ? pair((s) => [cyl(0.03 * w, 0.038 * w, 0.05, s * 0.048 * w, 0.025, 0.005, { seg: 5 }), 'bone'])
      : o.feet === 'claw' ? pair((s) => [cone(0.035 * w, 0.1, s * 0.05 * w, 0.02, 0.04, Math.PI / 2, 0, 0, 4), legs])
        : pair((s) => [box(0.06 * w, 0.05, 0.1, s * 0.048 * w, 0.025, 0.015), 'boots'])),
    ...upper,
    [ball(head, 0, hy, hz, 1, 1.06, 1, { w: 6, h: 4 }), 'skin'],
    [cone(head * 0.18, head * 0.4, 0, hy - head * 0.1, hz + head * 0.95, Math.PI / 2, 0, 0, 3), 'skin'], // the nose
  ];
  // arms: a sleeve hanging from the shoulder and a hand; the right hand holds the realm's tool
  const al = T * 0.95, ar = 0.03 * w;
  const arm = (s) => [
    [cyl(ar, ar * 0.8, al, 0, -al / 2, 0, { seg: 5, open: true }), o.arms || arms, s > 0 ? 'armL' : 'armR'],
    [ball(ar * 1.05, 0, -al - ar * 0.4, 0.004, 1, 1, 1, { w: 4, h: 2 }), o.hands || (o.arms === 'skin' ? 'skin' : 'skin'), s > 0 ? 'armL' : 'armR'],
  ];
  P.push(...arm(1), ...arm(-1));
  const tool = o.tool ?? 'pike';
  const ty = -al - ar * 0.4;
  if (tool === 'pike') P.push([cyl(0.009, 0.009, 0.62, 0, ty + 0.02, 0.03, { seg: 3, rx: Math.PI / 2 - 0.25 }), 'dark', 'armR'], [cone(0.018, 0.08, 0, ty + 0.1, 0.33, Math.PI / 2 - 0.25, 0, 0, 3), 'metal', 'armR']);
  else if (tool === 'axe') P.push([cyl(0.01, 0.01, 0.3, 0, ty, 0.02, { seg: 3, rx: Math.PI / 2 - 0.4 }), 'dark', 'armR'], [box(0.012, 0.07, 0.06, 0, ty + 0.06, 0.15, -0.4), 'metal', 'armR']);
  else if (tool === 'blade') P.push([box(0.012, 0.03, 0.28, 0, ty, 0.14, -0.35), 'metal', 'armR'], [box(0.06, 0.012, 0.014, 0, ty, 0.01), 'trim', 'armR']);
  else if (tool === 'club') P.push([cyl(0.028, 0.012, 0.32, 0, ty, 0.12, { seg: 5, rx: Math.PI / 2 - 0.35 }), 'dark', 'armR']);
  const shY = T * 0.88; // the shoulder, carried forward by the lean
  return { parts: P, shoulder: [0.13 * w, L + shY * Math.cos(lean), shY * Math.sin(lean) + 0.01], arm: al, head: [0, hy, hz], headR: head };
}
const withParts = (k, ...more) => { k.parts.push(...more); return k; };

const KITS = {
  human: () => biped({ tool: 'pike' }),
  elf: () => withParts(biped({ h: 1.1, w: 0.85, head: 0.078, tool: 'blade', chest: 0.9 }),
    ...pair((s) => [cone(0.02, 0.12, s * 0.085, 0.665, -0.01, 0, 0, -s * 1.2, 3), 'skin']),
    [ball(0.083, 0, 0.672, -0.02, 1.02, 1.05, 1, { w: 6, h: 3, th: Math.PI * 0.55 }), 'hair'], [box(0.07, 0.22, 0.02, 0, 0.55, -0.075), 'hair']),
  dwarf: () => withParts(biped({ h: 0.62, w: 1.45, head: 0.088, tool: 'axe', chest: 1.1 }),
    [cone(0.09, 0.22, 0, 0.27, 0.085, Math.PI + 0.25, 0, 0, 5), 'hair'], [ball(0.05, 0, 0.36, 0.08, 1.4, 0.8, 0.7, { w: 5, h: 3 }), 'hair']),
  brute: (horns) => withParts(biped({ h: 1, w: 1.45, lean: 0.35, head: 0.088, headY: 0.5, headZ: 0.12, arms: 'skin', tool: 'club', chest: 1.15 }),
    ...pair((s) => [cone(0.014, 0.05, s * 0.035, 0.475, 0.2, -0.3, 0, 0, 3), 'bone']), // tusks
    ...(horns ? pair((s) => [cone(0.03, 0.17, s * 0.1, 0.6, 0.1, 0, 0, -s * 1.0), 'bone']) : [[ball(0.05, 0, 0.56, 0.08, 1, 0.5, 1.2, { w: 5, h: 3 }), 'hair']])),
  goblin: () => withParts(biped({ h: 0.62, w: 0.85, head: 0.09, lean: 0.2, tool: 'blade' }),
    ...pair((s) => [cone(0.035, 0.17, s * 0.13, 0.4, 0, 0, 0, -s * 1.3), 'skin']),
    [cone(0.022, 0.08, 0, 0.36, 0.13, Math.PI / 2, 0, 0, 3), 'skin'], [cone(0.07, 0.1, 0, 0.48, 0.03, -0.2, 0, 0, 5), 'trim']),
  halfling: () => withParts(biped({ h: 0.64, w: 0.95, head: 0.088, tool: 'blade', feet: 'bare' }), [ball(0.094, 0, 0.44, -0.015, 1, 0.9, 1, { w: 6, h: 4, th: Math.PI * 0.6 }), 'hair']),
  gnome: () => withParts(biped({ h: 0.62, w: 0.95, head: 0.085, tool: 'axe' }), [cone(0.075, 0.24, 0, 0.55, 0, -0.15, 0, 0, 6), 'trim'],
    [cone(0.06, 0.12, 0, 0.36, 0.06, Math.PI + 0.3, 0, 0, 5), 'hair']),
  skeleton: () => {
    const P = [
      ...pair((s) => [cyl(0.02, 0.018, 0.21, s * 0.05, 0.125, 0, { seg: 4 }), 'skin']),
      ...pair((s) => [box(0.04, 0.025, 0.08, s * 0.05, 0.012, 0.015), 'skin']),
      [box(0.13, 0.05, 0.07, 0, 0.23, 0), 'skin'], [cyl(0.018, 0.018, 0.1, 0, 0.29, -0.01, { seg: 4 }), 'skin'],
      // the ribcage, ribs as rings
      ...[0, 1].map((k) => [put(new THREE.TorusGeometry(0.07 - k * 0.008, 0.01, 3, 6), 0, 0.38 + k * 0.06, 0, Math.PI / 2, 0, 0, 1, 0.8, 1), 'skin']),
      [box(0.1, 0.22, 0.012, 0, 0.38, 0.078), 'side'], [box(0.1, 0.2, 0.012, 0, 0.4, -0.075), 'side'],
      [put(new THREE.OctahedronGeometry(0.026, 0), 0, 0.42, 0.088, 0, 0, Math.PI / 4, 1, 1.2, 0.3), 'badge'],
      ...pair((s) => [ball(0.04, s * 0.1, 0.49, 0, 1.2, 0.7, 1.1, { w: 5, h: 3, th: Math.PI * 0.6 }), 'armor']),
      [ball(0.07, 0, 0.6, 0, 0.95, 1.05, 1, { w: 6, h: 4 }), 'skin'], [box(0.07, 0.04, 0.05, 0, 0.535, 0.03), 'skin'],
      ...pair((s) => [ball(0.017, s * 0.027, 0.6, 0.06, 1, 1, 0.5, { w: 4, h: 3 }), 'dark']),
    ];
    const arm = (s) => [[cyl(0.017, 0.015, 0.26, 0, -0.13, 0, { seg: 4 }), 'skin', s > 0 ? 'armL' : 'armR'], [box(0.03, 0.04, 0.02, 0, -0.27, 0), 'skin', s > 0 ? 'armL' : 'armR']];
    P.push(...arm(1), ...arm(-1), [box(0.012, 0.03, 0.26, 0, -0.27, 0.13, -0.35), 'metal', 'armR']);
    return { parts: P, shoulder: [0.11, 0.48, 0.0], arm: 0.27, head: [0, 0.6, 0], headR: 0.072 };
  },
  ghoul: () => withParts(biped({ h: 0.95, w: 0.8, lean: 0.5, head: 0.08, headY: 0.47, headZ: 0.16, legs: 'skin', arms: 'skin', torso: 'skin', tool: 'none', pauldrons: false }),
    ...pair((s) => [cone(0.012, 0.06, s * 0.03, 0.43, 0.24, 0.4, 0, 0, 3), 'bone']), [box(0.16, 0.12, 0.14, 0, 0.17, 0.02), 'legs']),
  rat: () => withParts(biped({ h: 0.8, w: 0.95, lean: 0.5, head: 0.07, headY: 0.44, headZ: 0.17, arms: 'skin', tool: 'blade', feet: 'claw' }),
    [cone(0.055, 0.15, 0, 0.42, 0.27, Math.PI / 2, 0, 0, 5), 'skin'], [ball(0.014, 0, 0.42, 0.345), 'dark'],
    ...pair((s) => [ball(0.04, s * 0.055, 0.52, 0.13, 1, 1, 0.35), 'skin']),
    [put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.18, -0.06), new THREE.Vector3(0, 0.1, -0.2), new THREE.Vector3(0, 0.08, -0.38), new THREE.Vector3(0, 0.16, -0.5)]), 5, 0.01, 3), 0, 0, 0), 'skin']),
  lizard: () => withParts(biped({ h: 1.05, w: 1, head: 0.072, lean: 0.12, arms: 'skin', legs: 'skin', tool: 'pike', feet: 'claw', torso: 'cloth' }),
    [box(0.075, 0.055, 0.14, 0, 0.61, 0.1), 'skin'], [box(0.06, 0.02, 0.12, 0, 0.58, 0.1), 'skin'],
    [put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.24, -0.06), new THREE.Vector3(0, 0.15, -0.22), new THREE.Vector3(0, 0.05, -0.42)]), 4, 0.035, 4), 0, 0, 0), 'skin'],
    ...[0, 1, 2].map((k) => [cone(0.02, 0.07, 0, 0.68 - k * 0.025, 0.02 - k * 0.05, -0.3, 0, 0, 3), 'trim'])),
  demon: () => withParts(biped({ h: 1.05, w: 1.25, head: 0.085, arms: 'skin', tool: 'axe', feet: 'hoof', chest: 1.1 }),
    ...pair((s) => [cone(0.028, 0.16, s * 0.08, 0.7, 0.01, 0, 0, -s * 0.5), 'bone']),
    [put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.22, -0.06), new THREE.Vector3(0, 0.1, -0.2), new THREE.Vector3(0, 0.12, -0.34)]), 4, 0.012, 3), 0, 0, 0), 'skin'],
    [cone(0.02, 0.05, 0, 0.12, -0.35, -Math.PI / 2, 0, 0, 3), 'skin']),
  goat: () => withParts(biped({ h: 1, w: 1.1, head: 0.08, legs: 'hair', arms: 'skin', tool: 'axe', feet: 'hoof' }),
    [box(0.06, 0.08, 0.12, 0, 0.56, 0.08), 'skin'],
    ...pair((s) => [cone(0.03, 0.18, s * 0.08, 0.68, -0.05, -0.9, 0, -s * 0.4), 'bone'])),
  harpy: () => withParts(biped({ h: 1, w: 0.8, head: 0.075, arms: 'hair', tool: 'pike', feet: 'claw', legs: 'skin' }), [ball(0.08, 0, 0.6, -0.03, 1, 1.1, 1, { w: 6, h: 4, th: Math.PI * 0.6 }), 'hair'],
    ...pair((s) => [box(0.3, 0.025, 0.14, s * 0.19, 0.5, -0.09, 0, s * 0.5, s * -0.4), 'hair'])),
};

// which kit, how big and in what colours, by the folk that sails her
const SPECIES = {
  human: { kit: 'human' }, elf: { kit: 'elf' }, dwarf: { kit: 'dwarf' },
  orc: { kit: 'brute', scale: 1.05 }, hobgoblin: { kit: 'brute', scale: 0.95 }, troll: { kit: 'brute', scale: 1.25 },
  ogre: { kit: 'brute', scale: 1.35 }, cyclops: { kit: 'brute', scale: 1.4 }, minotaur: { kit: 'bruteHorned', scale: 1.3 }, tiger: { kit: 'brute', scale: 1.05 },
  goblin: { kit: 'goblin' }, imp: { kit: 'goblin' }, halfling: { kit: 'halfling' }, gnome: { kit: 'gnome' },
  skeleton: { kit: 'skeleton' }, mummy: { kit: 'skeleton' }, ghoul: { kit: 'ghoul' }, rat: { kit: 'rat' }, lizard: { kit: 'lizard' },
  demon: { kit: 'demon' }, goat: { kit: 'goat' }, harpy: { kit: 'harpy' },
};
const HAIR = {
  human: [0x3a2618, 0x6a4a2a, 0x1a1410, 0xa8783a], elf: [0xe8d8a0, 0xd8c8b8, 0x3a2a1a, 0xc89a4a], dwarf: [0x8a3a1a, 0x5a3a20, 0xb8b0a8, 0xc8762a],
  halfling: [0x6a4020, 0x3a2414, 0xa86a2a], gnome: [0xe8e4dc, 0xc8c0b8, 0x8a5a2a], harpy: [0x6a4a2a, 0x2a2420, 0xa8a090], goat: [0x4a3020, 0x6a4a30, 0x2a2018],
};
// the original factions, which have no realm entry
const OLD = {
  kingdom: { species: 'human', skin: 0xd9a77c, cloth: 0x2a4fa8, cloth2: 0x6a5a48, armor: 0xb8c0c8, trim: 0xc9a23a },
  goblin: { species: 'goblin', skin: 0x6a9a3a, cloth: 0x6a4a2a, cloth2: 0x4a3a28, armor: 0x6a6a62, trim: 0x8a6a3a },
  undead: { species: 'skeleton', skin: 0xe2dac4, cloth: 0x3a3440, cloth2: 0x2a2630, armor: 0x5a5a5e, trim: 0x8a8a78 },
  infernal: { species: 'demon', skin: 0xa83a2a, cloth: 0x2a1a1a, cloth2: 0x1a1212, armor: 0x2a2224, trim: 0xd8762a },
  beasts: { species: 'goat', skin: 0x8a6a4a, cloth: 0x6b4a2e, cloth2: 0x4a3420, armor: 0x7a6a5a, trim: 0xb89a6a },
  elemental: { species: 'dwarf', skin: 0xc8a080, cloth: 0x4a6a8a, cloth2: 0x3a3a40, armor: 0x7a7a82, trim: 0x6a8aa8 },
  dragons: { species: 'lizard', skin: 0x7a4a2a, cloth: 0x5a2a22, cloth2: 0x3a1a14, armor: 0x8a3a2a, trim: 0xd8a03a },
};
const OLD_METAL = { kingdom: 0xd4a83a, goblin: 0x6a5a48, undead: 0x8a8a78, infernal: 0xd8762a, beasts: 0xd8cfb4, elemental: 0x9ad8ff, dragons: 0xd8a03a };
// realms whose own folk are a kind the palette does not name
const FOLK = { hearthmoot: 'halfling', glimmer: 'gnome' };
const REALM = new Map(REALMS.map((r) => [r.id, { ...r.P, species: FOLK[r.id] || r.P.species }]));
const OLD_IDS = Object.keys(OLD);

// ---------------------------------------------------------------------------------------------
// Headgear: one instanced set per kind, in head units (a head of radius 1 centred at the origin, facing +z).
// Each kind has a main part (a) and an accent (b); HATCOL says which palette colours they take.
// ---------------------------------------------------------------------------------------------
const HAT = {
  graal: 'kettle', aurelia: 'crested', aethel: 'circlet', kaelneth: 'hood', verdant: 'hood', grom: 'horned', xibalba: 'feathered',
  velikaya: 'spiked', tianlong: 'conical', ironbound: 'horned', screaming: 'none', cloven: 'none', fimbul: 'horned', ashur: 'tall',
  greenhide: 'spiked', skar: 'hood', crimson: 'tricorn', khemet: 'nemes', drowned: 'tricorn', gorge: 'skullcap', westmark: 'brimmed',
  principalities: 'beret', sunkings: 'morion', caliphate: 'turban', shogunate: 'kabuto', mistisles: 'circlet', thousandgods: 'turban',
  kharnak: 'horned', morbus: 'hood', labyrinth: 'crested', velvet: 'brimmed', malvash: 'spiked', ashhorde: 'horned', balor: 'hood',
  kurgan: 'fur', hearthmoot: 'cap', baobab: 'feathered', nagavar: 'turban', pearlfleet: 'circlet', glimmer: 'none', khanate: 'fur',
  emerald: 'feathered', deeproot: 'mushroom', goldsands: 'turban',
  kingdom: 'kettle', goblin: 'none', undead: 'none', infernal: 'none', beasts: 'none', elemental: 'horned', dragons: 'crested',
};
// [a, b] from: armor, trim, cloth, cloth2, metal, bone, fur, straw, red, white, dark
const HATCOL = {
  kettle: ['armor', 'trim'], crested: ['armor', 'cloth'], circlet: ['metal', 'glow'], hood: ['cloth2', 'trim'], feathered: ['cloth2', 'cloth'],
  spiked: ['armor', 'metal'], conical: ['straw', 'cloth'], horned: ['armor', 'bone'], tall: ['armor', 'metal'], tricorn: ['dark', 'metal'],
  nemes: ['white', 'cloth2'], skullcap: ['armor', 'trim'], brimmed: ['dark', 'cloth'], beret: ['cloth', 'white'], morion: ['armor', 'metal'],
  turban: ['white', 'cloth'], kabuto: ['armor', 'metal'], fur: ['fur', 'cloth'], cap: ['cloth', 'trim'], mushroom: ['red', 'white'],
};
const half = (r, w = 7, h = 2) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2);
const HATS = {
  kettle: () => [[put(half(1.12, 7, 2), 0, 0.05, 0), 'a'], [put(new THREE.CylinderGeometry(1.12, 1.8, 0.2, 8, 1, true), 0, 0.02, 0), 'a'], [cyl(1.14, 1.14, 0.16, 0, 0.2, 0, { seg: 7, open: true }), 'b']],
  crested: () => [[put(half(1.12), 0, 0.05, 0), 'a'], ...pair((s) => [box(0.12, 0.7, 0.55, s * 0.95, -0.25, 0.3), 'a']), [put(new THREE.CylinderGeometry(1.0, 1.0, 0.26, 8, 1, false, -Math.PI / 2, Math.PI), 0, 1.1, 0, 0, 0, Math.PI / 2, 1, 1, 1), 'b']],
  circlet: () => [[put(new THREE.TorusGeometry(1.05, 0.08, 3, 8), 0, 0.25, 0, Math.PI / 2 - 0.15, 0, 0), 'a'], [put(new THREE.OctahedronGeometry(0.2, 0), 0, 0.45, 1.0, 0, 0, 0, 1, 1.5, 0.5), 'b']],
  hood: () => [[put(new THREE.SphereGeometry(1.3, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.62), 0, -0.05, -0.12), 'a'], [cone(0.55, 1.1, 0, 0.35, -1.2, -Math.PI / 2 - 0.5, 0, 0, 3), 'a'], [put(new THREE.TorusGeometry(1.1, 0.1, 3, 6, Math.PI), 0, -0.3, 0.05, 0.4, 0, 0), 'b']],
  feathered: () => [[cyl(1.08, 1.08, 0.3, 0, 0.3, 0, { seg: 7, open: true }), 'a'], ...[-2, -1, 0, 1, 2].map((k) => [put(new THREE.ConeGeometry(0.3, 1.9, 3), k * 0.25, 1.3, -0.25, -0.2, 0, -k * 0.32, 1, 1, 0.3), k % 2 ? 'a' : 'b'])],
  spiked: () => [[put(half(1.13), 0, 0.05, 0), 'a'], [cone(0.8, 0.9, 0, 1.25, 0, 0, 0, 0, 7), 'a'], [cone(0.14, 0.8, 0, 1.95, 0, 0, 0, 0, 4), 'b'], [cyl(1.15, 1.15, 0.18, 0, 0.1, 0, { seg: 7, open: true }), 'b']],
  conical: () => [[put(new THREE.ConeGeometry(2.2, 0.95, 10, 1, true), 0, 0.55, 0), 'a'], [put(new THREE.ConeGeometry(2.2, 0.06, 10), 0, 0.06, 0, Math.PI, 0, 0), 'a'], [ball(0.18, 0, 1.05, 0), 'b']],
  horned: () => [[put(half(1.12), 0, 0.05, 0), 'a'], [box(0.18, 0.8, 0.12, 0, -0.1, 1.08), 'a'],
    ...pair((s) => [put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.9, 0.5, 0), new THREE.Vector3(s * 1.6, 0.9, 0.1), new THREE.Vector3(s * 1.8, 1.7, 0.2)]), 3, 0.18, 3), 0, 0, 0), 'b']),
    ...pair((s) => [cone(0.15, 0.4, s * 1.82, 1.9, 0.22, 0, 0, 0, 4), 'b'])],
  tall: () => [[put(new THREE.CylinderGeometry(0.55, 1.12, 1.9, 8, 1, true), 0, 0.85, 0), 'a'], [cyl(1.14, 1.14, 0.22, 0, 0.1, 0, { seg: 8, open: true }), 'b'], [ball(0.5, 0, 1.8, 0, 1, 0.5, 1, { w: 6, h: 3 }), 'b']],
  tricorn: () => [[put(new THREE.CylinderGeometry(1.9, 1.75, 0.45, 3, 1, true), 0, 0.45, 0, 0, Math.PI, 0), 'a'], [cyl(1.05, 1.1, 0.75, 0, 0.55, 0, { seg: 7 }), 'a'], [put(new THREE.CylinderGeometry(1.92, 1.92, 0.08, 3, 1, true), 0, 0.68, 0, 0, Math.PI, 0), 'b']],
  nemes: () => [[put(half(1.12), 0, 0.02, -0.03), 'a'], ...pair((s) => [box(0.45, 1.6, 0.18, s * 0.95, -0.55, 0.45, 0, 0, s * 0.12), 'a']), [box(1.1, 1.5, 0.2, 0, -0.5, -0.9), 'a'], [cyl(1.14, 1.14, 0.22, 0, 0.2, 0, { seg: 8, open: true }), 'b'], [cone(0.18, 0.5, 0, 0.6, 1.12, 0.3, 0, 0, 4), 'b']],
  skullcap: () => [[put(half(1.1), 0, 0.05, 0), 'a'], [box(0.18, 0.8, 0.12, 0, -0.15, 1.08), 'b']],
  brimmed: () => [[cyl(2.1, 2.1, 0.08, 0, 0.35, 0, { seg: 10 }), 'a'], [cyl(0.95, 1.08, 0.8, 0, 0.75, 0, { seg: 8 }), 'a'], [put(new THREE.SphereGeometry(0.4, 4, 3), -0.9, 1.25, -0.3, 0.3, 0, 0.7, 0.35, 2.6, 0.12), 'b']],
  beret: () => [[ball(1.25, 0.25, 0.65, 0, 1.1, 0.42, 1.05, { w: 8, h: 4 }), 'a'], [put(new THREE.SphereGeometry(0.4, 4, 3), -0.8, 1.2, -0.2, 0.2, 0, 0.9, 0.3, 2.4, 0.12), 'b']],
  morion: () => [[put(half(1.1), 0, 0.15, 0), 'a'], [put(new THREE.CylinderGeometry(1.7, 1.7, 0.08, 10), 0, 0.15, 0, 0, 0, 0, 0.75, 1, 1.25), 'a'], [put(new THREE.CylinderGeometry(1.0, 1.0, 0.16, 8, 1, false, -Math.PI / 2, Math.PI), 0, 1.0, 0, 0, Math.PI / 2, Math.PI / 2, 1, 1, 0.75), 'b']],
  turban: () => [[put(new THREE.TorusGeometry(0.95, 0.38, 4, 9), 0, 0.45, 0, Math.PI / 2, 0, 0), 'a'], [ball(1.0, 0, 0.62, 0, 1, 0.75, 1, { w: 7, h: 4 }), 'a'], [put(new THREE.OctahedronGeometry(0.22, 0), 0, 0.6, 1.3, 0, 0, 0, 1, 1.3, 0.5), 'b'], [put(new THREE.SphereGeometry(0.3, 4, 3), 0, 1.25, 1.0, -0.4, 0, 0, 0.3, 2, 0.12), 'b']],
  kabuto: () => [[put(half(1.15), 0, 0.08, 0), 'a'], [put(new THREE.CylinderGeometry(1.2, 1.8, 0.7, 8, 1, true, Math.PI * 0.75, Math.PI * 1.5), 0, -0.2, -0.05), 'a'], [put(new THREE.TorusGeometry(0.85, 0.09, 3, 8, Math.PI), 0, 0.85, 0.75, 0, 0, 0), 'b'], [ball(0.16, 0, 0.6, 1.05), 'b']],
  fur: () => [[cyl(1.2, 1.15, 1.0, 0, 0.45, 0, { seg: 8 }), 'a'], [ball(0.8, 0, 0.95, 0, 1, 0.45, 1, { w: 6, h: 3 }), 'b'], ...pair((s) => [box(0.25, 0.8, 0.6, s * 1.05, -0.3, 0), 'a'])],
  cap: () => [[ball(1.12, 0, 0.1, 0, 1, 1, 1, { w: 7, h: 3, th: Math.PI * 0.5 }), 'a'], [cone(0.5, 0.9, 0, 1.0, 0.3, 0.6, 0, 0, 5), 'a'], [cyl(1.13, 1.13, 0.2, 0, 0.1, 0, { seg: 8, open: true }), 'b']],
  mushroom: () => [[ball(1.9, 0, 0.45, 0, 1, 0.6, 1, { w: 9, h: 3, th: Math.PI * 0.5 }), 'a'], ...[0, 1, 2, 3, 4].map((k) => [ball(0.28, Math.cos(k * 1.26) * 1.0, 1.4 - (k % 2) * 0.25, Math.sin(k * 1.26) * 1.0, 1, 0.5, 1, { w: 4, h: 3 }), 'b'])],
};

const lookCache = new Map();
/** the folk aboard a ship or airship def: { kit, scale, P, hat, hatCol, metal, badge } */
function folkOf(def, faction) {
  const key = `${(def && (def.realm || def.faction || def.id)) || ''}|${faction || ''}`;
  if (lookCache.has(key)) return lookCache.get(key);
  let P = null, rid = null;
  const ids = [def && def.realm, def && def.faction, faction].filter(Boolean);
  for (const id of ids) if ((P = REALM.get(id) || OLD[id])) { rid = id; break; }
  if (!P && def && def.id) {
    const pre = String(def.id).split(/_|(?=[A-Z])/)[0];
    rid = REALM.has(pre) || OLD[pre] ? pre : OLD_IDS.find((k) => def.id.startsWith(k));
    P = REALM.get(rid) || OLD[rid];
  }
  if (!P) { P = OLD.kingdom; rid = 'kingdom'; }
  const sp = SPECIES[P.species] || SPECIES.human;
  const hair = HAIR[P.species] || HAIR[sp.kit] || HAIR.human;
  const st = REALM_STYLE[rid] || {};
  const metal = st.metal ?? OLD_METAL[rid] ?? P.trim;
  let hat = HAT[rid] || 'none';
  if (sp.kit === 'goblin' || sp.kit === 'gnome' || (sp.kit === 'skeleton' && hat === 'none')) hat = 'none'; // their own hats are in the kit
  if (sp.kit === 'bruteHorned' && (hat === 'horned' || hat === 'kettle')) hat = 'skullcap';
  const pick = (k) => ({ armor: P.armor, trim: P.trim, cloth: P.cloth, cloth2: P.cloth2, metal, glow: st.glow ?? 0xffe08a, bone: 0xe2d8c0, fur: 0x5a3e28, straw: 0xd8c08a, red: 0xc82a1a, white: 0xeee8da, dark: 0x24201c }[k] ?? P.trim);
  const hc = HATCOL[hat] || ['armor', 'trim'];
  const look = {
    kit: sp.kit, scale: sp.scale || 1, P, hair, hat, hatCol: [pick(hc[0]), pick(hc[1])], metal,
    badge: new THREE.Color(metal).getHSL({}).l > 0.25 ? metal : P.trim,
    legs: new THREE.Color(P.cloth2 ?? 0x3a3028).lerp(new THREE.Color(0x201a16), 0.45).getHex(),
  };
  lookCache.set(key, look);
  return look;
}

// The seven original factions dress their plain ships in their own style too (fields as parts/realmStyle.js styles)
const OLD_STYLE = {
  kingdom: { metal: 0xd4a83a, metalM: 0.55, carve: 0xd4a83a, motif: 'scroll', emblem: 'lion', figure: 'horse', lantern: 'lantern', finial: 'ball', banner: 'swallow', trim: 'stripes', wood: 0x7a5a36, glow: 0xffd88a, tone: 0 },
  goblin: { metal: 0x6a5a48, metalM: 0.35, carve: 0x8a1a14, motif: 'teeth', emblem: 'tusks', figure: 'boar', lantern: 'brazier', finial: 'tusk', banner: 'totem', trim: 'chevron', wood: 0x5a4a36, glow: 0xff9a3a, tone: 0.6 },
  undead: { metal: 0x5a5a5e, metalM: 0.4, carve: 0xd8cfb4, motif: 'bone', emblem: 'skull', figure: 'skull', lantern: 'witchlight', finial: 'spike', banner: 'pennon', trim: 'teeth', wood: 0x2a2630, glow: 0x5affa0, tone: 0.9 },
  infernal: { metal: 0x2a2224, metalM: 0.5, carve: 0xd8762a, motif: 'spikes', emblem: 'horns', figure: 'skull', lantern: 'brazier', finial: 'horn', banner: 'square', trim: 'teeth', wood: 0x2a1a1a, glow: 0xff5a1a, tone: 0.9 },
  beasts: { metal: 0x8a7a5a, metalM: 0.2, carve: 0xd8cfb4, motif: 'bone', emblem: 'wolfhead', figure: 'boar', lantern: 'skull', finial: 'antler', banner: 'totem', trim: 'dots', wood: 0x6b4a2e, glow: 0xffa040, tone: 0.6 },
  elemental: { metal: 0x9aa8b8, metalM: 0.45, carve: 0x6a8aa8, motif: 'step', emblem: 'star', figure: 'eye', lantern: 'crystal', finial: 'crystal', banner: 'pennon', trim: 'band', wood: 0x5a5a62, glow: 0x6ad8ff, tone: 0.3 },
  dragons: { metal: 0xd8a03a, metalM: 0.55, carve: 0xd8a03a, motif: 'scale', emblem: 'dragon', figure: 'dragon', lantern: 'brazier', finial: 'flame', banner: 'gonfalon', trim: 'teeth', wood: 0x5a2a22, glow: 0xff7a22, tone: 0.5 },
};
const NEUTRAL = { species: 'human', skin: 0xd9a77c, cloth: 0x6a5a48, cloth2: 0x4a3a2a, armor: 0x9aa2aa, trim: 0xb08a3a };
const realmLooks = new Map();
/**
 * the folk and style of a realm or original faction (null: a plain crew): { id, P (palette), kit (body kit),
 * species, hat (headgear kind), hatCol: [main, accent], metal, st (a parts/realmStyle.js style) }
 */
export function realmLook(id) {
  const key = id || '';
  if (realmLooks.has(key)) return realmLooks.get(key);
  const P = REALM.get(id) || OLD[id] || NEUTRAL;
  const base = folkOf({ realm: REALM.has(id) ? id : undefined, faction: OLD[id] ? id : undefined }, null);
  const look = REALM.has(id) || OLD[id] ? base : { ...folkOf({ id: 'kingdom' }), P: NEUTRAL, hat: 'kettle', hatCol: [NEUTRAL.armor, NEUTRAL.trim], metal: 0xb08a3a, badge: 0xb08a3a };
  let st;
  if (REALM.has(id)) st = styleOf({ realm: id });
  else {
    const o = OLD_STYLE[id] || { metal: 0xb08a3a, metalM: 0.5, carve: 0xb08a3a, motif: 'scroll', emblem: 'star', figure: 'horse', lantern: 'lantern', finial: 'ball', banner: 'square', trim: 'band', wood: 0x6b4a2e, glow: 0xffc070, tone: 0.2 };
    st = { id: id || 'plain', ...o, cloth: P.cloth, cloth2: P.cloth2, armor: P.armor, band: [P.cloth, P.cloth2] };
  }
  const known = REALM.has(id) || !!OLD[id];
  const out = { id: known ? id : null, P, species: P.species, kit: look.kit, hat: look.hat, hatCol: look.hatCol, metal: look.metal, st };
  realmLooks.set(key, out);
  return out;
}

const ROLE_MAT = { skin: 0.75, side: 0.85, cloth: 0.85, armor: 0.42, trim: 0.55, metal: 0.35, badge: 0.4, hair: 0.95, legs: 0.9, boots: 0.8, bone: 0.7, dark: 0.85, a: 0.6, b: 0.5 };
const ROLE_METAL = { armor: 0.45, metal: 0.55, badge: 0.4, trim: 0.15 };

// ---------------------------------------------------------------------------------------------
// What each hand is doing. Jobs are given by place; reactions come from pulse().
// ---------------------------------------------------------------------------------------------
const FIRE = 1.2, BRACE = 1.4, BOARD = 3.5, CHEER = 2.0;
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** per slot list: the job of each place and where its rail is */
const jobCache = new WeakMap();
function jobsOf(slots) {
  let J = jobCache.get(slots);
  if (J) return J;
  let hb = 0.01;
  for (const p of slots) hb = Math.max(hb, Math.abs(p[2]));
  J = slots.map((p, i) => {
    let rail = 0.01;
    for (const q of slots) if (Math.abs(q[0] - p[0]) < 0.9) rail = Math.max(rail, Math.abs(q[2]));
    const out = Math.abs(p[2]) / Math.max(0.05, rail);
    const r = hash(i * 3.1 + p[0]);
    const job = out > 0.62 ? (r < 0.75 ? 'gun' : 'idle') : r < 0.38 ? 'haul' : r < 0.52 ? 'work' : r < 0.62 ? 'look' : 'idle';
    return { job, rail: rail * 0.9, out: p[2] >= 0 ? 1 : -1, r, face: Math.atan2(-p[0] * 0.2 + (r - 0.5), -p[2] + (r - 0.5) * 0.5) };
  });
  jobCache.set(slots, J);
  return J;
}

const _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _a = new THREE.Matrix4(), _h = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

export class Crews {
  constructor(scene, max = 1600) {
    this.max = max; this.scene = scene;
    this.kits = new Map(); this.hats = new Map();
    this.tmp = new THREE.Matrix4(); this.loc = new THREE.Matrix4(); this.col = new THREE.Color(); this.c2 = new THREE.Color(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1);
    this.scale = 1; this.t = 0; this.state = new WeakMap(); this.last = null;
  }
  _inst(geo, role, flat = false) {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: ROLE_MAT[role] ?? 0.85, metalness: ROLE_METAL[role] ?? 0, flatShading: flat }), this.max);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = role === 'side' || role === 'skin' || role === 'cloth' || role === 'a';
    mesh.setColorAt(0, this.col.set(0xffffff));
    mesh.userData.noCrew = true;
    this.scene.add(mesh);
    return mesh;
  }
  /** the instanced meshes of one body kit, made on first use: { body: [{ role, mesh }], armL, armR, shoulder, head, headR } */
  kit(name) {
    let k = this.kits.get(name);
    if (k) return k;
    const spec = name === 'bruteHorned' ? KITS.brute(true) : (KITS[name] || KITS.human)();
    const groups = { body: new Map(), armL: new Map(), armR: new Map() };
    for (const [g, role, piece = 'body'] of spec.parts) { const m = groups[piece]; if (!m.has(role)) m.set(role, []); m.get(role).push(g); }
    k = { n: 0, shoulder: spec.shoulder, head: spec.head, headR: spec.headR, arm: spec.arm };
    for (const piece of ['body', 'armL', 'armR']) {
      k[piece] = [];
      for (const [role, gs] of groups[piece]) {
        const geo = mergeGeometries(gs, false);
        for (const g of gs) g.dispose();
        k[piece].push({ role, mesh: this._inst(geo, role, role === 'armor' || role === 'metal' || role === 'badge') });
      }
    }
    this.kits.set(name, k);
    return k;
  }
  hat(kind) {
    let h = this.hats.get(kind);
    if (h) return h;
    const parts = (HATS[kind] || (() => []))();
    const by = new Map();
    for (const [g, role] of parts) { if (!by.has(role)) by.set(role, []); by.get(role).push(g); }
    h = { n: 0, meshes: [] };
    for (const [role, gs] of by) { const geo = mergeGeometries(gs, false); for (const g of gs) g.dispose(); h.meshes.push({ role, mesh: this._inst(geo, role, true) }); }
    this.hats.set(kind, h);
    return h;
  }
  dispose() {
    for (const k of this.kits.values()) for (const p of ['body', 'armL', 'armR']) for (const { mesh } of k[p]) this._drop(mesh);
    for (const h of this.hats.values()) for (const { mesh } of h.meshes) this._drop(mesh);
    this.kits.clear(); this.hats.clear();
  }
  _drop(mesh) { mesh.parent && mesh.parent.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }
  /** finds and remembers the deck of a hull type; returns the number of standing places */
  track(model, key, opts = {}) {
    const slots = deckSlots(model, key, opts.airship);
    model.userData.crewSlots = slots;
    return slots.length;
  }
  /** tell a ship's hands what is happening to her: 'fire' | 'brace' | 'board' | 'cheer' (see the top of this file) */
  pulse(model, kind, opts = {}) {
    if (!model) return;
    let S = this.state.get(model);
    if (!S) { S = { fire: -99, brace: -99, board: -99, boardFrom: -99, cheer: -99, side: 1 }; this.state.set(model, S); }
    const t = this.t;
    if (kind === 'fire') S.fire = t;
    else if (kind === 'brace') S.brace = t;
    else if (kind === 'cheer') S.cheer = t;
    else if (kind === 'board') {
      if (t - S.board > BOARD) S.boardFrom = t; // a fresh rush (else the hands already at the rail stay there)
      S.board = t;
      const w = opts.toward || this.nearest(model);
      if (w) {
        model.updateMatrixWorld();
        if (w.isVector3) _v.copy(w); else _v.set(w.x, model.position.y, w.z ?? w.y);
        _v.applyMatrix4(_m.copy(model.matrixWorld).invert());
        S.side = _v.z >= 0 ? 1 : -1;
      }
    }
  }
  /** the nearest other hull in the last update list */
  nearest(model) {
    let best = null, bd = Infinity;
    for (const it of this.last || []) { const m = it.model; if (!m || m === model || !it.alive) continue; const d = m.position.distanceToSquared(model.position); if (d < bd) { bd = d; best = m.position; } }
    return best;
  }
  /** the colour of one role on figure i */
  roleColor(role, look, side, i) {
    const P = look.P, c = this.col, j = ((i * 37) % 11) / 11 - 0.5; // a steady per-figure jitter
    switch (role) {
      case 'side': c.set(side).lerp(this.c2.set(P.cloth), 0.12); if (i % 5 === 0) c.lerp(this.c2.set(0xe8e0d0), 0.35); return c;
      case 'cloth': return c.set(i % 3 === 1 ? P.cloth : P.cloth2 ?? P.cloth).multiplyScalar(0.85 + j * 0.1);
      case 'skin': return c.set(P.skin).multiplyScalar(1 + j * 0.14);
      case 'armor': return c.set(i % 3 === 2 ? P.trim : P.armor);
      case 'trim': return c.set(i % 3 === 1 ? P.armor : P.trim).multiplyScalar(i % 2 ? 0.8 : 1);
      case 'metal': return c.set(look.metal);
      case 'badge': return c.set(look.badge);
      case 'hair': return c.set(look.hair[i % look.hair.length]);
      case 'legs': return c.set(look.legs);
      case 'boots': return c.set(0x2a221c);
      case 'bone': return c.set(0xe2d8c0);
      case 'a': return c.set(look.hatCol[0]).multiplyScalar(1 + j * 0.08);
      case 'b': return c.set(look.hatCol[1]);
      default: return c.set(0x2a2420);
    }
  }
  update(list, t) {
    this.t = t; this.last = list;
    for (const k of this.kits.values()) k.n = 0;
    for (const h of this.hats.values()) h.n = 0;
    let total = 0;
    for (const it of list) {
      const m = it.model, slots = m && m.userData.crewSlots;
      if (!slots || !slots.length || !it.alive || m.visible === false) continue;
      // a plain role ship learns her faction from the first list that names it (see fleetDress.dressRole)
      if (it.faction && m.userData.styleFaction) { const f = m.userData.styleFaction; m.userData.styleFaction = null; f(it.faction); }
      const look = folkOf(it.def, it.faction);
      const kit = this.kit(look.kit), hat = look.hat !== 'none' ? this.hat(look.hat) : null;
      const k = Math.min(slots.length, Math.ceil(slots.length * Math.max(0, Math.min(1, it.frac))));
      const J = jobsOf(slots), S = this.state.get(m);
      const fireK = S ? 1 - ease((t - S.fire) / FIRE) : 0, braceK = S ? 1 - ease((t - S.brace - BRACE * 0.6) / (BRACE * 0.4)) * (t - S.brace > 0 ? 1 : 0) : 0;
      const bAge = S ? t - S.board : 99, rush = S && bAge < BOARD ? ease((t - S.boardFrom) / 0.5) * (1 - ease((bAge - BOARD + 0.6) / 0.6)) : 0;
      const cheerAge = S ? Math.min(t - S.cheer, bAge - BOARD + 0.3) : 99;
      m.updateMatrixWorld();
      const sc = this.scale * (it.size || 1) * look.scale;
      for (let i = 0; i < k && total < this.max; i++) {
        const p = slots[i], jb = J[i], r = jb.r, ph = t * 2.4 + i * 1.7;
        // the pose: where it stands, which way it faces, how it leans and crouches, and its two arms
        let x = p[0], z = p[2], face = jb.face + Math.sin(t * 0.3 + i) * 0.25, lean = 0, crouch = 0, bob = 0;
        let aL = [-0.1 + Math.sin(ph * 0.5) * 0.06, 0.12], aR = [-0.1 - Math.sin(ph * 0.5) * 0.06, -0.12];
        switch (jb.job) {
          case 'haul': { const w = Math.sin(t * 2.2 + r * 6); face = Math.PI * 0.5 * (r < 0.19 ? 1 : -1); lean = -0.18 - w * 0.12; aL = [-2.2 - w * 0.5, 0.1]; aR = [-2.2 + w * 0.5, -0.1]; bob = Math.abs(w) * 0.008; break; }
          case 'work': { const w = Math.sin(t * 1.7 + r * 6); lean = 0.45 + w * 0.1; aL = [-0.9 - w * 0.3, 0.1]; aR = [-0.9 + w * 0.3, -0.1]; break; }
          case 'look': { face = jb.out > 0 ? r * 2 : Math.PI + r * 2; aR = [-2.3, 0.55]; break; }
          case 'gun': { face = jb.out > 0 ? 0 : Math.PI; face += (r - 0.5) * 0.6; aL = [-1.1 + Math.sin(ph) * 0.1, 0.15]; aR = [-1.25, -0.15]; crouch = fireK * 0.9; lean = fireK * 0.3; break; }
          default: bob = Math.abs(Math.sin(t * 3 + i * 1.7)) * 0.012;
        }
        if (jb.job !== 'gun' && fireK > 0.6) lean += (fireK - 0.6) * 0.4; // the others flinch at the guns
        if (braceK > 0) { crouch = Math.max(crouch, braceK); lean += braceK * 0.35; aL = lerp2(aL, [-0.7, 0.55], braceK); aR = lerp2(aR, [-0.7, -0.55], braceK); }
        // a boarding rush: most hands run to the rail that faces the enemy, weapons up
        if (rush > 0 && r < 0.8) {
          const side = S.side, u = rush;
          const tz = side * jb.rail, tx = p[0] + (r - 0.5) * 0.4;
          x = p[0] + (tx - p[0]) * u; z = p[2] + (tz - p[2]) * u;
          const run = u > 0.02 && u < 0.98;
          face = side > 0 ? 0 : Math.PI; face += (r - 0.4) * 0.5;
          lean = run ? 0.3 : 0.12; crouch = Math.max(crouch * 0.5, run ? 0.15 : 0);
          aR = [-2.6 + Math.sin(t * 9 + i) * 0.4, -0.2]; aL = [-1.2, 0.3];
          bob = run ? Math.abs(Math.sin(t * 14 + i)) * 0.04 : Math.abs(Math.sin(t * 6 + i)) * 0.015;
        }
        if (cheerAge > 0 && cheerAge < CHEER && r > 0.3) {
          const w = Math.sin(t * 11 + i * 2);
          aL = [-2.8, 0.35 + w * 0.25]; aR = [-2.8, -0.35 - w * 0.25]; lean = -0.1; crouch = 0;
          bob = Math.max(0, Math.sin(t * 9 + i * 1.3)) * 0.06;
        }
        // compose: deck place -> facing -> lean about the feet -> crouch (squash)
        const s = sc * (1 + (((i * 53) % 7) / 7 - 0.5) * 0.08);
        _e.set(lean, face, 0, 'YXZ'); _q.setFromEuler(_e);
        _b.compose(_v.set(x, p[1] + bob - crouch * 0.02, z), _q, _s.set(s, s * (1 - crouch * 0.28), s));
        this.tmp.multiplyMatrices(m.matrixWorld, _b);
        const n = kit.n++;
        for (const { role, mesh } of kit.body) { mesh.setMatrixAt(n, this.tmp); mesh.setColorAt(n, this.roleColor(role, look, it.color, i)); }
        const sh = kit.shoulder;
        for (const [arm, ang, sx] of [[kit.armL, aL, 1], [kit.armR, aR, -1]]) {
          _q.setFromEuler(_e.set(ang[0], 0, ang[1], 'XYZ'));
          _a.compose(_v.set(sx * sh[0], sh[1], sh[2]), _q, _s.set(1, 1, 1));
          _h.multiplyMatrices(this.tmp, _a);
          for (const { role, mesh } of arm) { mesh.setMatrixAt(n, _h); mesh.setColorAt(n, this.roleColor(role, look, it.color, i)); }
        }
        if (hat) {
          const hn = hat.n++, hp = kit.head;
          _a.compose(_v.set(hp[0], hp[1], hp[2]), _q.identity(), _s.setScalar(kit.headR));
          _h.multiplyMatrices(this.tmp, _a);
          for (const { role, mesh } of hat.meshes) { mesh.setMatrixAt(hn, _h); mesh.setColorAt(hn, this.roleColor(role, look, it.color, i)); }
        }
        total++;
      }
    }
    for (const k of this.kits.values()) for (const p of ['body', 'armL', 'armR']) for (const { mesh } of k[p]) this._flush(mesh, k.n);
    for (const h of this.hats.values()) for (const { mesh } of h.meshes) this._flush(mesh, h.n);
  }
  _flush(mesh, n) {
    mesh.count = n; mesh.visible = n > 0;
    if (!n) return;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
