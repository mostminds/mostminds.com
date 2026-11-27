// Procedural low-poly models built from primitives. Every model is a Group
// with userData.rig describing its moving parts, animated by animateUnit().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { instantiateCustom, animateCustom } from './customModels.js';
import { tmat } from './textures.js';
import { assemble, cloneRigged as cloneSculpted, getDetail, setLod } from './rigkit.js';
import { animateRig } from './animate.js';
import * as REG from './registry.js';
import { STRUCTURES } from '../data/structures.js';
import { CREATURES as NAVAL_CREATURES } from '../data/naval.js';

// Sculpted models come from the family modules gathered in registry.js. Each
// lookup falls back to the older primitive-built model below if a family has
// nothing registered for it, or if its builder throws.
const sculptTpl = new Map(), sculptFailed = new Set();
function guarded(label, fn) {
  if (sculptFailed.has(label)) return null;
  try { return fn() || null; } catch (err) { console.warn(`[models] ${label} failed, using the fallback model`, err); sculptFailed.add(label); return null; }
}
/** drop cached sculpts (call after the detail preset changes) */
export function resetModelCache() { sculptTpl.clear(); sculptFailed.clear(); }
export { setLod };
export const LEVEL_H = 0.8; // world height of one walkable level

const matCache = new Map();
const METAL = { metalness: 0.75, roughness: 0.35 };
export function mat(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o }));
  return matCache.get(k);
}
const geoCache = new Map();
function geo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
// UVs are scaled by size so textures keep one density on every wall and beam
function scaleUv(g, fn) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const [u, v] = fn(i, uv.getX(i), uv.getY(i)); uv.setXY(i, u, v); } return g; }
const TEX = 2; // world units per texture repeat
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => scaleUv(new THREE.BoxGeometry(w, h, d), (i, u, v) => {
  const f = Math.floor(i / 4); // px nx py ny pz nz
  const [a, c] = f < 2 ? [d, h] : f < 4 ? [w, d] : [w, h];
  return [u * a / TEX, v * c / TEX];
}));
const rbox = (w, h, d, r = 0.04) => geo(`r${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2, h / 2, d / 2)));
const cyl = (rt, rb, h, s = 6) => geo(`c${rt},${rb},${h},${s}`, () => scaleUv(new THREE.CylinderGeometry(rt, rb, h, s <= 5 ? s : Math.max(s, 10)), (i, u, v) => [u * Math.max(1, Math.round(Math.PI * (rt + rb) / TEX)), v * h / TEX]));
const sph = (r, s = 6) => geo(`s${r},${s}`, () => new THREE.SphereGeometry(r, s <= 5 ? 6 : 10, s <= 5 ? 4 : 7));
const cone = (r, h, s = 6) => geo(`k${r},${h},${s}`, () => scaleUv(new THREE.ConeGeometry(r, h, s <= 5 ? s : 10), (i, u, v) => [u * Math.max(1, Math.round(Math.PI * r / TEX * 2)), v * Math.hypot(r, h) / TEX]));
const ico = (r) => geo(`i${r}`, () => new THREE.IcosahedronGeometry(r, 1));
const cap = (r, len) => geo(`p${r},${len}`, () => new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 2, 7));

function mesh(g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}
function pivot(x, y, z, ...children) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  for (const c of children) p.add(c);
  return p;
}

// ---------- weapons ----------
function weapon(kind, m) {
  const g = new THREE.Group();
  const wood = mat(0x6b4a2e), steel = mat(0xc9d1d9, METAL), dark = mat(0x4a4a4a, METAL);
  switch (kind) {
    case 'sword': g.add(mesh(box(0.05, 0.45, 0.02), steel, 0, -0.3, 0.12)); g.add(mesh(box(0.15, 0.03, 0.04), dark, 0, -0.08, 0.12)); break;
    case 'longsword': case 'greatsword': {
      const L = kind === 'greatsword' ? 0.75 : 0.55;
      g.add(mesh(box(0.06, L, 0.02), steel, 0, -0.1 - L / 2, 0.12)); g.add(mesh(box(0.2, 0.03, 0.05), dark, 0, -0.1, 0.12)); break;
    }
    case 'dagger': case 'claws': g.add(mesh(box(0.04, 0.2, 0.02), kind === 'claws' ? mat(0xe8e2d0) : steel, 0, -0.2, 0.08)); break;
    case 'spear': case 'lance': {
      const L = kind === 'lance' ? 1.5 : 1.1;
      const s = mesh(cyl(0.02, 0.02, L), wood, 0, -0.12, 0.2); s.rotation.x = Math.PI / 2; g.add(s);
      const tip = mesh(cone(0.04, 0.14), steel, 0, -0.12, 0.2 + L / 2); tip.rotation.x = Math.PI / 2; g.add(tip); break;
    }
    case 'halberd': {
      g.add(mesh(cyl(0.02, 0.02, 1.2), wood, 0, 0.1, 0.1));
      g.add(mesh(box(0.02, 0.18, 0.16), steel, 0, 0.6, 0.16)); break;
    }
    case 'axe': case 'greataxe': {
      const big = kind === 'greataxe';
      g.add(mesh(cyl(0.025, 0.025, big ? 0.9 : 0.5), wood, 0, -0.2, 0.1));
      g.add(mesh(box(0.03, big ? 0.3 : 0.18, big ? 0.28 : 0.16), steel, 0, big ? -0.6 : -0.42, 0.18)); break;
    }
    case 'club': g.add(mesh(cyl(0.07, 0.035, 0.6), wood, 0, -0.35, 0.1)); break;
    case 'warhammer': g.add(mesh(cyl(0.025, 0.025, 0.6), wood, 0, -0.3, 0.1)); g.add(mesh(box(0.12, 0.12, 0.22), steel, 0, -0.6, 0.1)); break;
    case 'staff': {
      g.add(mesh(cyl(0.025, 0.025, 1.0), wood, 0, 0.0, 0.1));
      g.add(mesh(ico(0.07), mat(0x9fd8ff, { emissive: 0x3a6a9a }), 0, 0.52, 0.1)); break;
    }
    case 'longbow': case 'sling': case 'crossbow': {
      if (kind === 'crossbow') { g.add(mesh(box(0.05, 0.05, 0.4), wood, 0, -0.25, 0.15)); g.add(mesh(box(0.4, 0.03, 0.04), dark, 0, -0.25, 0.3)); }
      else if (kind === 'sling') g.add(mesh(cyl(0.01, 0.01, 0.3), wood, 0, -0.3, 0.05));
      else { const bw = mesh(geo('bow', () => new THREE.TorusGeometry(0.4, 0.015, 4, 10, Math.PI)), wood, 0, -0.25, 0.08); bw.rotation.z = Math.PI / 2; g.add(bw); }
      break;
    }
  }
  return g;
}

// ---------- humanoid ----------
function humanoid(o) {
  const g = new THREE.Group();
  const skin = mat(o.skin ?? 0xd9a77c), cloth = mat(o.cloth ?? 0x777766);
  const armor = o.armor ? mat(o.armor, METAL) : cloth;
  const leather = mat(0x4a3220), dark = mat(0x1c1c1c);
  const bone = o.body === 'skeleton';
  const lr = bone ? 0.03 : 0.062; // limb radius
  const hipY = 0.42;
  const rig = { legs: [], arms: [], torso: null, kind: 'biped' };

  if (o.robe) {
    g.add(mesh(cone(0.27, 0.52, 12), cloth, 0, 0.26, 0));
    g.add(mesh(cyl(0.275, 0.275, 0.03, 12), mat(0x2a2a2a), 0, 0.015, 0));
  } else {
    for (const s of [-1, 1]) {
      const leg = pivot(s * 0.09, hipY, 0,
        mesh(cap(lr * 1.08, 0.24), bone ? skin : cloth, 0, -0.11, 0),
        mesh(cap(lr * 0.92, 0.22), bone ? skin : (o.armor ? armor : cloth), 0, -0.29, 0));
      if (!bone) leg.add(mesh(rbox(0.11, 0.07, 0.19, 0.03), leather, 0, -0.39, 0.03));
      else leg.add(mesh(box(0.06, 0.02, 0.12), skin, 0, -0.41, 0.03), mesh(sph(0.04, 5), skin, 0, -0.2, 0));
      g.add(leg); rig.legs.push(leg);
    }
  }
  const torso = new THREE.Group();
  torso.position.y = hipY;
  g.add(torso); rig.torso = torso;
  if (bone) {
    torso.add(mesh(cap(0.025, 0.4), skin, 0, 0.2, -0.02));
    for (let i = 0; i < 4; i++) { const rb = mesh(geo(`rib${i}`, () => new THREE.TorusGeometry(0.1 - i * 0.008, 0.014, 4, 8)), skin, 0, 0.12 + i * 0.065, 0); rb.rotation.x = Math.PI / 2; torso.add(rb); }
    torso.add(mesh(rbox(0.2, 0.07, 0.11, 0.03), skin, 0, 0.02, 0));
  } else {
    torso.add(mesh(rbox(0.33, 0.24, 0.21, 0.07), armor, 0, 0.27, 0));       // chest
    torso.add(mesh(rbox(0.28, 0.18, 0.18, 0.06), o.armor ? armor : cloth, 0, 0.09, 0)); // waist
    torso.add(mesh(rbox(0.3, 0.05, 0.2, 0.02), leather, 0, 0.03, 0));          // belt
    torso.add(mesh(box(0.05, 0.05, 0.02), mat(0xd6a646, METAL), 0, 0.03, 0.105));
    if (o.armor) for (const s of [-1, 1]) torso.add(mesh(sph(0.085), armor, s * 0.2, 0.37, 0)); // pauldrons
    if (o.armor && (o.helm === 'full' || o.shield)) {
      const cape = mesh(box(0.3, 0.5, 0.02), mat(o.cloth ?? 0x7a2a2a, { side: THREE.DoubleSide }), 0, 0.12, -0.13);
      cape.rotation.x = 0.12; torso.add(cape);
    }
  }
  torso.add(mesh(cyl(0.05, 0.055, 0.06, 8), skin, 0, 0.41, 0)); // neck
  const head = new THREE.Group();
  head.position.y = 0.5;
  torso.add(head);
  if (o.cyclops) {
    head.add(mesh(sph(0.14), skin, 0, 0, 0));
    head.add(mesh(sph(0.055, 6), mat(0xffffff), 0, 0.02, 0.105), mesh(sph(0.028, 6), mat(0x3a2a1a), 0, 0.02, 0.15));
    head.add(mesh(rbox(0.12, 0.025, 0.04, 0.01), dark, 0, 0.085, 0.11));
  } else if (bone) {
    head.add(mesh(sph(0.105), skin, 0, 0.02, 0), mesh(rbox(0.12, 0.07, 0.11, 0.02), skin, 0, -0.07, 0.02));
    for (const s of [-1, 1]) head.add(mesh(sph(0.028, 6), dark, s * 0.04, 0.02, 0.085));
    head.add(mesh(box(0.02, 0.03, 0.02), dark, 0, -0.025, 0.1));
  } else {
    head.add(mesh(rbox(0.2, 0.22, 0.2, 0.07), skin, 0, 0, 0));
    for (const s of [-1, 1]) {
      head.add(mesh(sph(0.02, 6), mat(0xf2f2f2), s * 0.045, 0.025, 0.094), mesh(sph(0.011, 5), dark, s * 0.045, 0.025, 0.11));
      head.add(mesh(sph(0.03, 5), skin, s * 0.102, 0, 0)); // ears
    }
    head.add(mesh(rbox(0.035, 0.05, 0.04, 0.012), skin, 0, -0.01, 0.105));  // nose
    head.add(mesh(box(0.07, 0.012, 0.01), mat(0x7a3a34), 0, -0.06, 0.1));  // mouth
    if (!o.helm && !o.hood && !o.horns && (o.scale ?? 1) >= 0.9) head.add(mesh(rbox(0.21, 0.09, 0.21, 0.04), mat(0x3a2a1c), 0, 0.085, -0.01)); // hair
  }
  if (o.helm === 'full') {
    head.add(mesh(rbox(0.25, 0.27, 0.25, 0.08), armor, 0, 0.02, 0), mesh(box(0.17, 0.025, 0.02), dark, 0, 0.03, 0.125), mesh(box(0.02, 0.1, 0.02), dark, 0, -0.03, 0.125));
    head.add(mesh(rbox(0.03, 0.12, 0.2, 0.01), mat(o.cloth ?? 0x8a2c2c), 0, 0.2, -0.02)); // crest
  } else if (o.helm === 'horned') {
    head.add(mesh(sph(0.125), armor, 0, 0.05, 0));
    for (const s of [-1, 1]) { const h = mesh(cone(0.04, 0.22, 8), mat(0xe8e2d0), s * 0.15, 0.17, 0); h.rotation.z = -s * 0.8; head.add(h); }
  } else if (o.helm) {
    const dome = mesh(sph(0.118), armor, 0, 0.055, 0); dome.scale.y = 0.85; head.add(dome);
    head.add(mesh(cyl(0.125, 0.13, 0.03, 12), armor, 0, 0.04, 0), mesh(box(0.025, 0.09, 0.02), armor, 0, 0.0, 0.11));
  }
  if (o.hood) { head.add(mesh(sph(0.135), cloth, 0, 0.03, -0.025), mesh(cone(0.1, 0.16, 10), cloth, 0, 0.16, -0.06)); }
  if (o.horns) for (const s of [-1, 1]) { const h = mesh(cone(0.04, 0.2, 8), mat(0x2a2a2a), s * 0.1, 0.16, 0); h.rotation.z = -s * 0.4; head.add(h); }
  if (o.wings) for (const s of [-1, 1]) {
    const w = pivot(s * 0.1, 0.34, -0.12);
    const wm = mat(o.wingColor ?? 0x3a1a1a, { side: THREE.DoubleSide });
    w.add(mesh(cap(0.018, 0.55), mat(0x2a1414), s * 0.26, 0.05, 0));
    w.children[0].rotation.z = Math.PI / 2;
    for (let k = 0; k < 3; k++) { const m = mesh(box(0.17, 0.34 - k * 0.07, 0.012), wm, s * (0.1 + k * 0.17), -0.1 + k * 0.02, 0); w.add(m); }
    w.rotation.y = s * 0.5; torso.add(w); (rig.wings ||= []).push(w);
  }
  for (const s of [-1, 1]) {
    const sleeve = bone ? skin : (o.armor ? armor : cloth);
    const arm = pivot(s * (bone ? 0.15 : 0.215), 0.36, 0,
      mesh(cap(lr * 0.95, 0.2), sleeve, 0, -0.09, 0),
      mesh(cap(lr * 0.82, 0.19), bone ? skin : (o.armor ? armor : skin), 0, -0.24, 0),
      mesh(sph(bone ? 0.03 : 0.05), skin, 0, -0.35, 0));
    torso.add(arm); rig.arms.push(arm);
    if (s === 1 && o.weapon && o.weapon !== 'none') { const w = weapon(o.weapon); w.position.y = -0.18; arm.add(w); }
    if (s === -1 && o.shield) {
      const sc = o.cloth ?? 0x6b4a2e;
      arm.add(mesh(rbox(0.045, 0.34, 0.28, 0.02), mat(sc), -0.07, -0.25, 0.08), mesh(rbox(0.05, 0.36, 0.3, 0.02), mat(0xb8bcc2, METAL), -0.062, -0.25, 0.08), mesh(sph(0.045), mat(0xd6a646, METAL), -0.1, -0.25, 0.08));
    }
  }
  if (o.hunch) torso.rotation.x = 0.35;
  rig.head = head;
  g.userData.rig = rig;
  return g;
}

function quadruped(o) {
  const g = new THREE.Group();
  const fur = mat(o.fur ?? o.mount ?? 0x5b5b5b);
  const rig = { legs: [], arms: [], kind: 'quad' };
  g.add(mesh(box(0.3, 0.26, 0.7), fur, 0, 0.42, 0));
  const head = pivot(0, 0.55, 0.42, mesh(box(0.22, 0.2, 0.3), fur, 0, 0, 0.05), mesh(box(0.12, 0.1, 0.16), fur, 0, -0.04, 0.24));
  if (o.wolf !== false) head.add(mesh(cone(0.04, 0.1, 4), fur, -0.07, 0.13, 0), mesh(cone(0.04, 0.1, 4), fur, 0.07, 0.13, 0));
  g.add(head); rig.head = head;
  for (const [x, z] of [[-0.11, 0.25], [0.11, 0.25], [-0.11, -0.25], [0.11, -0.25]]) {
    const leg = pivot(x, 0.32, z, mesh(box(0.08, 0.32, 0.08), fur, 0, -0.16, 0));
    g.add(leg); rig.legs.push(leg);
  }
  const tail = mesh(box(0.06, 0.06, 0.3), fur, 0, 0.5, -0.45); tail.rotation.x = -0.6; g.add(tail);
  if (o.wings) {
    rig.wings = [];
    for (const sd of [-1, 1]) {
      const w = pivot(sd * 0.16, 0.55, 0.05, mesh(box(0.8, 0.03, 0.45), mat(o.wingColor ?? 0xe8dcc0, { side: THREE.DoubleSide }), sd * 0.4, 0, 0));
      g.add(w); rig.wings.push(w);
    }
  }
  g.userData.rig = rig;
  return g;
}

function rider(o) {
  const g = new THREE.Group();
  const mount = quadruped({ fur: o.mount, wolf: !!o.wolf, wings: o.wings });
  const man = humanoid({ ...o, body: 'humanoid' });
  for (const l of man.userData.rig.legs) { l.rotation.z = l.position.x > 0 ? -0.9 : 0.9; }
  man.position.set(0, 0.3, 0);
  g.add(mount, man);
  g.userData.rig = { ...mount.userData.rig, arms: man.userData.rig.arms, torso: man.userData.rig.torso, kind: 'quad' };
  return g;
}

function spider(o) {
  const g = new THREE.Group();
  const m = mat(o.fur ?? 0x2a2420);
  g.add(mesh(sph(0.26), m, 0, 0.35, -0.2), mesh(sph(0.16), m, 0, 0.3, 0.15));
  g.add(mesh(sph(0.03, 4), mat(0xff3030, { emissive: 0x801010 }), -0.05, 0.36, 0.3), mesh(sph(0.03, 4), mat(0xff3030, { emissive: 0x801010 }), 0.05, 0.36, 0.3));
  const rig = { legs: [], arms: [], kind: 'spider' };
  for (let i = 0; i < 8; i++) {
    const s = i < 4 ? -1 : 1, k = i % 4;
    const leg = pivot(s * 0.1, 0.32, 0.18 - k * 0.12, mesh(box(0.5, 0.04, 0.04), m, s * 0.25, 0, 0));
    leg.rotation.z = s * -0.5; leg.rotation.y = (k - 1.5) * 0.3 * s;
    g.add(leg); rig.legs.push(leg);
  }
  g.userData.rig = rig;
  return g;
}

function golem(o) {
  const g = humanoid({ skin: o.stone, cloth: o.stone, armor: o.stone, weapon: 'none', wings: o.wings });
  g.traverse((c) => { if (c.isMesh) c.scale.multiplyScalar(1.25); });
  g.userData.rig.head.add(mesh(box(0.12, 0.03, 0.02), mat(0xffb030, { emissive: 0xff7a00 }), 0, 0.02, 0.13));
  return g;
}

function elemental(o) {
  const g = new THREE.Group();
  const glow = mat(o.glow, { emissive: o.glow, emissiveIntensity: 0.7 });
  const core = mesh(ico(0.3), glow, 0, 0.7, 0);
  g.add(core);
  const shards = new THREE.Group();
  for (let i = 0; i < 5; i++) shards.add(mesh(ico(0.08), glow, Math.cos(i * 1.26) * 0.42, 0, Math.sin(i * 1.26) * 0.42));
  shards.position.y = 0.6;
  g.add(shards);
  g.userData.rig = { legs: [], arms: [], kind: 'float', core, shards };
  return g;
}

function dragon(o) {
  const g = new THREE.Group();
  const m = mat(o.scales ?? 0x3a8a3a), belly = mat(0xd8c07a);
  g.add(mesh(box(0.5, 0.42, 1.0), m, 0, 0.6, 0), mesh(box(0.4, 0.1, 0.9), belly, 0, 0.38, 0));
  const neck = pivot(0, 0.75, 0.45, mesh(box(0.2, 0.2, 0.5), m, 0, 0.15, 0.2));
  neck.rotation.x = -0.6;
  const head = pivot(0, 0.3, 0.45, mesh(box(0.26, 0.22, 0.4), m, 0, 0, 0.1));
  for (const s of [-1, 1]) { const h = mesh(cone(0.04, 0.2), mat(0xe8e2d0), s * 0.08, 0.15, -0.05); h.rotation.x = -0.8; head.add(h); }
  neck.add(head);
  g.add(neck);
  const tail = mesh(cone(0.18, 1.0, 5), m, 0, 0.55, -0.9); tail.rotation.x = -Math.PI / 2 - 0.2; g.add(tail);
  const rig = { legs: [], arms: [], kind: 'quad', wings: [], head: neck };
  for (const [x, z] of [[-0.2, 0.35], [0.2, 0.35], [-0.2, -0.35], [0.2, -0.35]]) {
    const leg = pivot(x, 0.45, z, mesh(box(0.13, 0.45, 0.13), m, 0, -0.22, 0));
    g.add(leg); rig.legs.push(leg);
  }
  for (const s of [-1, 1]) {
    const w = pivot(s * 0.22, 0.8, 0.05, mesh(box(0.9, 0.03, 0.6), mat(o.scales ?? 0x3a8a3a, { side: THREE.DoubleSide }), s * 0.45, 0, -0.1));
    g.add(w); rig.wings.push(w);
  }
  g.userData.rig = rig;
  return g;
}

function bat(o) {
  const g = new THREE.Group();
  const m = mat(o.fur ?? 0x2a1f24);
  g.add(mesh(sph(0.16, 6), m, 0, 0.5, 0), mesh(sph(0.1, 5), m, 0, 0.56, 0.16));
  for (const sd of [-1, 1]) g.add(mesh(cone(0.04, 0.1, 4), m, sd * 0.06, 0.68, 0.16));
  const rig = { legs: [], arms: [], kind: 'float', wings: [] };
  for (const sd of [-1, 1]) {
    const w = pivot(sd * 0.12, 0.52, 0, mesh(box(0.55, 0.02, 0.3), mat(0x3a2a30, { side: THREE.DoubleSide }), sd * 0.28, 0, 0));
    g.add(w); rig.wings.push(w);
  }
  rig.core = g.children[0]; rig.shards = new THREE.Group();
  g.userData.rig = rig;
  return g;
}
function ram(o) {
  const g = new THREE.Group();
  const wood = mat(o.color ?? 0x6b4a2e), roofM = mat(0x5a4a3a), iron = mat(0x3a3a3c);
  g.add(mesh(box(0.9, 0.12, 1.6), wood, 0, 0.3, 0));
  for (const z of [-0.6, 0, 0.6]) for (const x of [-0.5, 0.5]) { const wh = mesh(cyl(0.2, 0.2, 0.08, 8), wood, x, 0.2, z); wh.rotation.z = Math.PI / 2; g.add(wh); }
  const roof = mesh(cone(0.75, 0.7, 4), roofM, 0, 0.85, 0); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 1.7); g.add(roof);
  const log = pivot(0, 0.55, 0, mesh(cyl(0.12, 0.12, 1.9, 7), wood, 0, 0, 0.2), mesh(sph(0.16, 6), iron, 0, 0, 1.15));
  log.children[0].rotation.x = Math.PI / 2;
  g.add(log);
  g.userData.rig = { legs: [], arms: [], kind: 'ram', log };
  return g;
}

// ---- baking: one mesh per moving part, so detail costs almost nothing at 300 units ----
const bakeMats = {
  matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
};
function bake(root, rig) {
  const pivots = new Set([root]);
  for (const [k, v] of Object.entries(rig)) {
    if (k === 'head' && rig.arms?.length) continue; // only armless bodies nod their heads
    for (const o of Array.isArray(v) ? v : [v]) if (o && o.isObject3D) pivots.add(o);
  }
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !pivots.has(o)) meshes.push(o); });
  const buckets = new Map();
  const inv = new THREE.Matrix4();
  for (const m of meshes) {
    let p = m.parent;
    while (!pivots.has(p)) p = p.parent;
    let gm = m.geometry.clone().applyMatrix4(inv.copy(p.matrixWorld).invert().multiply(m.matrixWorld));
    if (gm.index) gm = gm.toNonIndexed();
    for (const k of Object.keys(gm.attributes)) if (k !== 'position' && k !== 'normal') gm.deleteAttribute(k);
    if (!gm.attributes.normal) gm.computeVertexNormals();
    const mt = m.material, glow = mt.emissive && (mt.emissive.r + mt.emissive.g + mt.emissive.b) > 0.01;
    const cls = glow ? 'glow' : 'matte';
    const shine = !glow && mt.metalness > 0.3 ? 1.25 : 1; // metal reads as a brighter tint
    const c = glow ? mt.emissive : mt.color, n = gm.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r * shine; col[i * 3 + 1] = c.g * shine; col[i * 3 + 2] = c.b * shine; }
    gm.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!buckets.has(p)) buckets.set(p, {});
    (buckets.get(p)[cls] ||= []).push(gm);
    m.parent.remove(m);
  }
  for (const [p, classes] of buckets) for (const [cls, list] of Object.entries(classes)) {
    const merged = new THREE.Mesh(mergeGeometries(list, false), bakeMats[cls]);
    merged.castShadow = cls !== 'glow';
    p.add(merged);
  }
}
// rigs survive cloning by naming each moving part
function tagRig(rig) {
  for (const [k, v] of Object.entries(rig)) {
    if (Array.isArray(v)) v.forEach((o, i) => { if (o?.isObject3D) o.name = `rig:${k}:${i}`; });
    else if (v?.isObject3D) v.name = `rig:${k}`;
  }
}
function cloneRigged(tpl) {
  const c = tpl.clone(true);
  const src = rigOf.get(tpl), rig = {};
  for (const [k, v] of Object.entries(src)) rig[k] = Array.isArray(v) ? [] : v?.isObject3D ? null : v;
  c.traverse((o) => {
    if (!o.name.startsWith('rig:')) return;
    const [, k, i] = o.name.split(':');
    if (i !== undefined) rig[k][+i] = o; else rig[k] = o;
  });
  c.userData = { rig, inner: c.children[0] };
  return c;
}
const templates = new Map();
const rigOf = new WeakMap();

// ---------- airships, aircraft and drop pods ----------
const slab = (w, h, d, c, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); return m; };
export function buildAirship(def, sideColor) {
  const sm = REG.AIR.airship && guarded(`airship:${def.id}`, () => REG.AIR.airship(def, sideColor));
  if (sm) { sm.userData.sculpted = true; return sm; }
  // simple stand-in: gas bag, gondola, a flag
  const g = new THREE.Group(), L = def.len;
  const bag = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat(def.envelope)); bag.scale.set(L / 2, L * 0.16, L * 0.16); bag.position.y = 2.6; g.add(bag);
  g.add(slab(L * 0.55, 0.9, 1.4, def.color, 0, -0.45, 0));
  const flag = slab(0.9, 0.5, 0.05, sideColor, -L * 0.3, 1.1, 0); g.add(flag);
  const prop = new THREE.Group(); prop.add(slab(0.06, 1.2, 0.16, 0x333333)); prop.position.set(-L * 0.3, -0.3, 0); g.add(prop);
  g.userData = { props: [prop], muzzles: Array.from({ length: def.cannons.perSide }, (_, i) => [(i / Math.max(1, def.cannons.perSide - 1) - 0.5) * L * 0.4, -0.3, 0.75]),
    bombBay: [0, -0.9, 0], hangar: [-L * 0.3, -0.2, 0], pods: [[1, -0.5, 0.8], [1, -0.5, -0.8], [-1, -0.5, 0.8], [-1, -0.5, -0.8]], ladders: [[0, 0, -0.7], [0, 0, 0.7]], top: 4.2, radius: L / 2,
    setSide: (hex) => flag.material.color.set(hex), setDamage: (lv) => { bag.material.color.set(def.envelope).multiplyScalar(1 - lv * 0.22); bag.scale.y = L * 0.16 * (lv === 3 ? 0.5 : 1); } };
  return g;
}
export function buildAircraft(kind, sideColor, style) {
  const sm = REG.AIR.aircraft && guarded(`aircraft:${kind}:${style}`, () => REG.AIR.aircraft(kind, sideColor, style));
  if (sm) return sm;
  const g = new THREE.Group();
  g.add(slab(1.1, 0.14, 0.22, 0x6b4a2e));
  if (kind === 'glider') g.add(slab(0.5, 0.04, 1.6, sideColor, 0.05, 0.2, 0));
  else { const rotor = new THREE.Group(); rotor.add(slab(1.5, 0.03, 0.1, 0x333333)); rotor.position.y = 0.4; g.add(rotor); g.userData.rotor = rotor; }
  return g;
}
export function buildCableCar(sideColor) {
  const sm = REG.CIVIC.cableCar && guarded('cableCar', () => REG.CIVIC.cableCar(sideColor));
  if (sm) return sm;
  const g = new THREE.Group(); g.add(slab(0.8, 0.55, 0.55, 0x7a5a36, 0, -0.6, 0)); g.add(slab(0.84, 0.1, 0.59, sideColor, 0, -0.4, 0)); g.add(slab(0.05, 0.4, 0.05, 0x333333, 0, -0.2, 0));
  return g;
}
export function buildDropPod(style, sideColor) {
  const sm = REG.AIR.dropPod && guarded(`pod:${style}`, () => REG.AIR.dropPod(style, sideColor));
  if (sm) return sm;
  const g = new THREE.Group(); g.add(slab(0.7, 1.0, 0.7, 0x55504a, 0, 0.5, 0)); g.add(slab(0.74, 0.12, 0.74, sideColor, 0, 0.8, 0));
  return g;
}

// Weapons and bodies a unit may name before they are sculpted, and what stands in for them.
const WEAPONS = new Set(['sword', 'longsword', 'greatsword', 'dagger', 'claws', 'spear', 'lance', 'halberd', 'axe', 'greataxe', 'club', 'warhammer', 'staff', 'longbow', 'sling', 'crossbow']);
const WEAPON_ALT = { pike: 'spear', javelin: 'spear', trident: 'spear', glaive: 'halberd', naginata: 'halberd', katana: 'longsword', rapier: 'sword', cutlass: 'sword', scimitar: 'sword', khopesh: 'sword',
  cleaver: 'axe', maul: 'warhammer', flail: 'club', handgun: 'crossbow', blunderbuss: 'crossbow', repeater: 'crossbow', axeGun: 'crossbow', chakram: 'sling', blowpipe: 'sling', bow: 'longbow' };
import { hasWeapon } from './bodies/weapons.js'; // a weapon the weapons module can build is never swapped for a stand-in
let weaponKnown = null; // set by the weapons module when it knows more kinds
export function knownWeapons(fn) { weaponKnown = fn; }
function standIn(def) {
  let o = def.model;
  if (!o) return def;
  if (o.alt && o.body !== 'aircraft' && !REG.BODIES[o.body]) o = o.alt;
  const w = o.weapon;
  if (w && !WEAPONS.has(w) && !hasWeapon(w) && !(weaponKnown && weaponKnown(w))) o = { ...o, weapon: WEAPON_ALT[w] || 'sword' };
  if (o.rider && typeof o.rider === 'object') o = { ...o, rider: undefined };
  return o === def.model ? def : { ...def, model: o };
}

export function buildUnitModel(def) {
  def = standIn(def);
  if (def.model?.body === 'aircraft' && !instantiateCustom(def.id, 1, 'unit')) {
    // one-man flying machines: built nose toward +X, turned to face +Z like every other unit
    const craft = buildAircraft(def.model.kind, 0xcfc9bb, def.model.style);
    const g = new THREE.Group(), inner = new THREE.Group();
    craft.rotation.y = -Math.PI / 2; inner.add(craft); g.add(inner);
    g.userData = { rig: { kind: 'aircraft', height: 0.9 }, inner, rotor: craft.userData.rotor };
    return g;
  }
  const o = def.model || { body: 'humanoid' };
  const custom = instantiateCustom(def.id, 0.95 * (o.scale || 1) * Math.max(1, def.size * 0.8), 'unit');
  if (custom) return custom;
  const key = `${def.id}:${JSON.stringify(o)}`;
  const body = REG.BODIES[o.body || 'humanoid'];
  if (body) {
    const k2 = `${key}:${getDetail()}`;
    const tpl = guarded(`unit:${k2}`, () => {
      if (!sculptTpl.has(k2)) { const desc = body(def, o); sculptTpl.set(k2, desc ? assemble(desc, o.scale || 1) : null); }
      return sculptTpl.get(k2);
    });
    if (tpl) return cloneSculpted(tpl);
  }
  if (!templates.has(key)) templates.set(key, buildTemplate(def, o));
  return cloneRigged(templates.get(key));
}
function buildTemplate(def, o) {
  let g;
  switch (o.body) {
    case 'quadruped': g = quadruped(o); break;
    case 'rider': g = rider(o); break;
    case 'spider': g = spider(o); break;
    case 'golem': g = golem(o); break;
    case 'elemental': g = elemental(o); break;
    case 'dragon': g = dragon(o); break;
    case 'bat': g = bat(o); break;
    case 'ram': g = ram(o); break;
    default: g = humanoid(o);
  }
  const outer = new THREE.Group();
  const s = (o.scale || 1) * (def.size > 1 ? 1 : 1);
  g.scale.setScalar(s);
  tagRig(g.userData.rig);
  bake(g, g.userData.rig);
  outer.add(g);
  // keep the rig out of userData: cloning serialises userData
  rigOf.set(outer, g.userData.rig);
  outer.traverse((x) => { x.userData = {}; });
  return outer;
}

// t: seconds, moving: bool, atk: 0..1 progress of an attack swing (or -1), dead: 0..1
export function animateUnit(model, t, moving, atk, dead, phase = 0, flying = false, fx = null) {
  const r = model.userData.rig;
  if (!r) return;
  if (r.kind === 'aircraft') {
    const inner = model.userData.inner;
    if (model.userData.rotor && dead <= 0) model.userData.rotor.rotation.y = t * 30;
    if (dead > 0) { inner.rotation.z = Math.min(1, dead) * 1.9; inner.rotation.x = Math.min(1, dead) * 0.7; } // spins in and lies broken
    else { inner.rotation.z = Math.sin(t * 1.7 + phase) * 0.12; inner.rotation.x = atk >= 0 ? Math.sin(atk * Math.PI) * 0.35 : 0; }
    return;
  }
  if (r.v2) { animateRig(model, { t, moving, atk, dead, phase, flying, fx }); return; }
  if (r.kind === 'gltf') { animateCustom(model, t, moving, atk, dead); return; }
  const inner = model.userData.inner;
  const sw = moving ? Math.sin(t * 10 + phase) * 0.6 : 0;
  r.legs.forEach((l, i) => {
    if (r.kind === 'spider') l.rotation.x = moving ? Math.sin(t * 14 + i * 1.3) * 0.3 : 0;
    else l.rotation.x = (i % 2 === 0 ? sw : -sw) * (r.kind === 'quad' && i >= 2 ? -1 : 1);
  });
  if (r.arms.length) {
    r.arms[0].rotation.x = -sw * 0.5;
    let a = -sw * 0.5;
    if (atk >= 0) a = atk < 0.4 ? -2.2 * (atk / 0.4) : -2.2 + 2.6 * ((atk - 0.4) / 0.6);
    r.arms[1].rotation.x = a;
  }
  if (r.wings) r.wings.forEach((w, i) => { w.rotation.z = Math.sin(t * 6 + phase) * 0.3 * (i ? -1 : 1); });
  if (r.kind === 'ram') {
    r.log.position.z = atk >= 0 ? Math.sin(atk * Math.PI) * 0.35 : 0;
    inner.position.y = 0;
    if (dead > 0) { inner.rotation.z = Math.min(1, dead) * 0.5; inner.position.y = -Math.max(0, dead - 0.5) * 0.4; }
    return;
  }
  if (r.kind === 'float' && r.shards) {
    r.core.position.y = 0.7 + Math.sin(t * 3 + phase) * 0.08;
    r.shards.rotation.y = t * 2 + phase;
    if (atk >= 0) r.core.scale.setScalar(1 + Math.sin(atk * Math.PI) * 0.4);
  }
  if (r.head && atk >= 0 && !r.arms.length) r.head.rotation.x = -Math.sin(atk * Math.PI) * 0.6;
  inner.position.y = moving ? Math.abs(Math.sin(t * 10 + phase)) * 0.04 : 0;
  if (dead > 0) {
    inner.rotation.x = -Math.min(1, dead * 2) * Math.PI / 2;
    inner.position.y = -Math.max(0, dead - 0.5) * 0.8;
  } else inner.rotation.x = 0;
}

// ---------- structures ----------
// place = { x, y, side } says where the piece stands, so scenery can vary and banners can take a side colour
export function buildStructure(def, w, h, place = null) {
  const custom = def.id && instantiateCustom(`struct:${def.id}`, Math.max(w, h), 'struct');
  if (custom) return custom;
  if (def.weapon) { const sg = buildWeapon(def.model, w, h, def); if (sg.userData.sculpted) return sg; }
  else if (REG.STRUCT[def.model]) { const sm = guarded(`struct:${def.model}:${w}x${h}`, () => REG.STRUCT[def.model](def, w, h, place));
    if (sm) {
      // a faction other than the kingdom gives the building its own look
      const st = place && place.style;
      if (st && st !== 'kingdom' && REG.FACTION.restyle && !(REG.FACTION.structures || {})[def.model]) {
        const rs = guarded(`restyle:${st}:${def.model}`, () => REG.FACTION.restyle(sm, st, `${def.model}:${w}x${h}:${def.color}:${getDetail()}`));
        if (rs && rs !== sm) { rs.userData = { ...sm.userData, ...rs.userData }; return rs; }
        // a realm whose own style is not sculpted yet borrows the nearest of the older ones
        const lk = place.look;
        if (lk && lk !== st && lk !== 'kingdom') {
          const r2 = guarded(`restyle:${lk}:${def.model}`, () => REG.FACTION.restyle(sm, lk, `${def.model}:${w}x${h}:${def.color}:${getDetail()}`));
          if (r2 && r2 !== sm) { r2.userData = { ...sm.userData, ...r2.userData }; return r2; }
        }
      }
      return sm;
    }
  }
  const g = new THREE.Group();
  const TEXKIND = { wall: 'stone', castleWall: 'stone', castleTower: 'stone', keep: 'stone', bastion: 'stone', gate: 'stone', pillar: 'stone', statue: 'stone', stairs: 'stone',
    palisade: 'bark', barricade: 'wood', tower: 'wood', deck: 'wood', crates: 'wood', hut: 'wood', castleGate: 'wood', house: 'plaster', tent: 'canvas', sandbags: 'canvas' };
  const kind = TEXKIND[def.model];
  const lift = (hex, k = 1.25) => new THREE.Color(hex).multiplyScalar(k).getHex(); // textures darken, so brighten the tint
  const c = kind ? tmat(kind, lift(def.color)) : mat(def.color, def.model === 'rock' ? { flatShading: true } : {});
  const dark = tmat('wood', 0x7a5c3c), roof = tmat('tiles', 0xb04a32), stone = tmat('stone', lift(0x8a8a86));
  switch (def.model) {
    case 'rail': { // two iron rails on timber sleepers, running the long way
      const n = Math.max(w, h), ax = w >= h, iron = mat(0x4a4a50, { metalness: 0.6, roughness: 0.45 });
      g.add(mesh(box(ax ? n : 0.9, 0.05, ax ? 0.9 : n), tmat('stone', lift(0x6f6a60)), 0, 0.025, 0)); // ballast
      for (let i = 0; i < n * 2; i++) { const t = -n / 2 + (i + 0.5) / 2; g.add(mesh(box(ax ? 0.16 : 0.8, 0.06, ax ? 0.8 : 0.16), dark, ax ? t : 0, 0.07, ax ? 0 : t)); }
      for (const o of [-0.26, 0.26]) g.add(mesh(box(ax ? n : 0.06, 0.07, ax ? 0.06 : n), iron, ax ? 0 : o, 0.13, ax ? o : 0));
      break;
    }
    case 'railCar': { // an open goods wagon loaded with stores
      const n = Math.max(w, h), ax = w >= h, iron = mat(0x3c3c42, { metalness: 0.6, roughness: 0.5 }), L = n * 0.92, B = 0.74;
      const bx = (l, t, d, m, x, y, z) => g.add(mesh(box(ax ? l : d, t, ax ? d : l), m, ax ? x : z, y, ax ? z : x));
      for (const o of [-0.26, 0.26]) bx(n, 0.06, 0.06, iron, 0, 0.1, o);
      for (const x of [-L * 0.32, L * 0.32]) for (const z of [-0.3, 0.3]) { const wl = mesh(cyl(0.2, 0.2, 0.08, 12), iron, ax ? x : z, 0.3, ax ? z : x); wl.rotation[ax ? 'x' : 'z'] = Math.PI / 2; g.add(wl); }
      bx(L, 0.1, B, dark, 0, 0.5, 0);
      for (const z of [-B / 2, B / 2]) { bx(L, 0.34, 0.06, c, 0, 0.72, z); bx(L, 0.04, 0.08, iron, 0, 0.9, z); }
      for (const x of [-L / 2, L / 2]) bx(0.06, 0.34, B, c, x, 0.72, 0);
      for (let i = 0; i < 7; i++) { const x = -L * 0.4 + i * L * 0.133; bx(0.05, 0.36, 0.03, dark, x, 0.72, -B / 2 - 0.03); bx(0.05, 0.36, 0.03, dark, x, 0.72, B / 2 + 0.03); }
      const crate = tmat('wood', lift(0xa07a4a)), sack = tmat('canvas', lift(0xb8a888));
      bx(0.5, 0.42, 0.5, crate, -L * 0.28, 0.8, 0.05); bx(0.44, 0.36, 0.44, crate, L * 0.02, 0.77, -0.08); bx(0.36, 0.3, 0.36, crate, -L * 0.14, 1.12, 0);
      const bar = mesh(cyl(0.2, 0.2, 0.46, 10), crate, ax ? L * 0.3 : 0.1, 0.8, ax ? 0.1 : L * 0.3); g.add(bar);
      bx(0.4, 0.2, 0.5, sack, L * 0.3, 0.68, -0.14);
      bx(0.12, 0.08, 0.12, iron, -L / 2 - 0.08, 0.46, 0); bx(0.12, 0.08, 0.12, iron, L / 2 + 0.08, 0.46, 0); // couplings
      break;
    }
    case 'wall': {
      g.add(mesh(box(w, 1.1, h), c, 0, 0.55, 0));
      const n = Math.max(w, h);
      for (let i = 0; i < n; i += 1) {
        const along = -n / 2 + i + 0.5;
        g.add(mesh(box(w > h ? 0.5 : h, 0.25, w > h ? h : 0.5), c, w > h ? along : 0, 1.22, w > h ? 0 : along));
      }
      break;
    }
    case 'palisade': {
      const n = Math.max(w, h) * 3;
      for (let i = 0; i < n; i++) {
        const along = -Math.max(w, h) / 2 + (i + 0.5) / 3;
        const p = mesh(cyl(0.14, 0.14, 1.3, 5), c, w > h ? along : 0, 0.65, w > h ? 0 : along);
        g.add(p, mesh(cone(0.14, 0.25, 5), c, p.position.x, 1.42, p.position.z));
      }
      break;
    }
    case 'barricade': {
      g.add(mesh(box(w * 0.95, 0.45, h * 0.5), c, 0, 0.22, 0));
      for (let i = 0; i < Math.max(w, h) * 2; i++) { const s = mesh(box(0.06, 0.6, 0.06), dark, (w > h ? (i / 2 - w / 2 + 0.25) : 0), 0.4, (w > h ? 0 : i / 2 - h / 2 + 0.25)); s.rotation.x = 0.6; g.add(s); }
      break;
    }
    case 'sandbags': for (let i = 0; i < 3; i++) g.add(mesh(box(w * 0.9 - i * 0.2, 0.18, h * 0.6), c, 0, 0.09 + i * 0.18, 0)); break;
    case 'tower': {
      const top = LEVEL_H * 2;
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(mesh(box(0.15, top + 1, 0.15), c, x * (w / 2 - 0.15), (top + 1) / 2, z * (h / 2 - 0.15)));
      g.add(mesh(box(w, 0.12, h), c, 0, top - 0.06, 0));
      g.add(mesh(box(w, 0.3, 0.06), c, 0, top + 0.15, h / 2), mesh(box(w, 0.3, 0.06), c, 0, top + 0.15, -h / 2));
      const ladder = mesh(box(0.3, top, 0.04), dark, 0, top / 2, h / 2 + 0.05); g.add(ladder);
      const tr = mesh(cone(w * 0.8, 0.7, 4), roof, 0, top + 1.05, 0);
      tr.rotation.y = Math.PI / 4; g.add(tr);
      break;
    }
    case 'keep': {
      g.add(mesh(box(w * 0.85, 2.4, h * 0.85), c, 0, 1.2, 0));
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.add(mesh(cyl(0.6, 0.65, 3.2, 8), c, x * (w / 2 - 0.5), 1.6, z * (h / 2 - 0.5)));
        g.add(mesh(cone(0.75, 0.9, 8), roof, x * (w / 2 - 0.5), 3.65, z * (h / 2 - 0.5)));
      }
      g.add(mesh(box(0.8, 1.1, 0.05), dark, 0, 0.55, h * 0.43));
      break;
    }
    case 'house': case 'hut': {
      const hh = def.model === 'house' ? 1.3 : 0.9;
      g.add(mesh(box(w * 0.9, hh, h * 0.9), c, 0, hh / 2, 0));
      const r = mesh(cone(Math.max(w, h) * 0.75, hh * 0.8, 4), def.model === 'hut' ? tmat('thatch', 0xd8b870) : roof, 0, hh + hh * 0.4, 0);
      r.rotation.y = Math.PI / 4; g.add(r);
      g.add(mesh(box(0.35, 0.6, 0.04), dark, 0, 0.3, h * 0.45));
      break;
    }
    case 'tent': { const t = mesh(cone(0.95, 1.2, 4), c, 0, 0.6, 0); t.rotation.y = Math.PI / 4; g.add(t); break; }
    case 'gate': {
      g.add(mesh(box(1, 1.8, h), c, -w / 2 + 0.5, 0.9, 0), mesh(box(1, 1.8, h), c, w / 2 - 0.5, 0.9, 0));
      g.add(mesh(box(w, 0.4, h), c, 0, 1.6, 0));
      break;
    }
    case 'tree': {
      g.add(mesh(cyl(0.09, 0.14, 0.9, 8), tmat('bark', 0x8a6a48), 0, 0.45, 0));
      const leaf = mat(def.color, { flatShading: true }), leaf2 = mat(new THREE.Color(def.color).multiplyScalar(1.2).getHex(), { flatShading: true });
      g.add(mesh(ico(0.48), leaf, 0, 1.15, 0), mesh(ico(0.34), leaf2, 0.28, 1.0, 0.12), mesh(ico(0.32), leaf, -0.24, 1.05, -0.18), mesh(ico(0.3), leaf2, 0.02, 1.48, 0.05));
      break;
    }
    case 'pine': {
      g.add(mesh(cyl(0.07, 0.1, 0.55, 8), tmat('bark', 0x7a5a3c), 0, 0.27, 0));
      const leaf = mat(def.color, { flatShading: true });
      for (let k = 0; k < 4; k++) g.add(mesh(cone(0.48 - k * 0.1, 0.55, 9), leaf, 0, 0.7 + k * 0.32, 0));
      break;
    }
    case 'rock': { const r = mesh(ico(0.85), c, 0, 0.4, 0); r.scale.set(1, 0.6, 0.9); g.add(r); break; }
    case 'crates': g.add(mesh(box(0.7, 0.5, 0.7), c, 0, 0.25, 0), mesh(box(0.45, 0.4, 0.45), c, 0.05, 0.7, 0.05)); break;
    case 'statue': g.add(mesh(box(0.8, 0.4, 0.8), stone, 0, 0.2, 0)); { const s = humanoid({ skin: def.color, cloth: def.color, weapon: 'sword', shield: true }); s.position.y = 0.4; s.scale.setScalar(1.3); g.add(s); } break;
    case 'pillar': g.add(mesh(cyl(0.3, 0.32, 1.8, 8), c, 0, 0.9, 0), mesh(box(0.8, 0.15, 0.8), c, 0, 1.85, 0)); break;
    case 'bastion': {
      g.add(mesh(box(w, LEVEL_H, h), c, 0, LEVEL_H / 2, 0));
      for (const [x, z, ww, hh] of [[0, -h / 2 + 0.1, w, 0.2], [0, h / 2 - 0.1, w, 0.2], [-w / 2 + 0.1, 0, 0.2, h], [w / 2 - 0.1, 0, 0.2, h]]) g.add(mesh(box(ww, 0.3, hh), c, x, LEVEL_H + 0.15, z));
      break;
    }
    case 'castleWall': {
      const top = LEVEL_H * 2, along = w >= h;
      g.add(mesh(box(w, top, h), c, 0, top / 2, 0));
      const n = Math.max(w, h);
      // crenellations on both faces of the wall-walk
      for (let i = 0; i < n; i++) for (const sd of [-1, 1]) {
        const a = -n / 2 + i + 0.5;
        g.add(mesh(box(along ? 0.45 : 0.14, 0.3, along ? 0.14 : 0.45), c, along ? a : sd * 0.43, top + 0.15, along ? sd * 0.43 : a));
      }
      break;
    }
    case 'castleTower': {
      const top = LEVEL_H * 3;
      g.add(mesh(box(w, top, h), c, 0, top / 2, 0));
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) {
        const a = -w / 2 + 0.5 + k, sd = i < 2 ? -1 : 1, onX = i % 2 === 0;
        g.add(mesh(box(onX ? 0.6 : 0.2, 0.4, onX ? 0.2 : 0.6), c, onX ? a : sd * (w / 2 - 0.1), top + 0.2, onX ? sd * (h / 2 - 0.1) : a));
      }
      g.add(mesh(box(0.05, 0.9, 0.05), mat(0x3a2a1a), 0, top + 0.45, 0));
      break;
    }
    case 'stairs': {
      const along = w >= h, n = 4;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n, hgt = LEVEL_H * 2 * k;
        const pos = -Math.max(w, h) / 2 + (i + 0.5) * (Math.max(w, h) / n);
        g.add(mesh(box(along ? Math.max(w, h) / n : 0.9, hgt, along ? 0.9 : Math.max(w, h) / n), c, along ? pos : 0, hgt / 2, along ? 0 : pos));
      }
      break;
    }
    case 'castleGate': {
      const top = LEVEL_H * 2, along = w >= h;
      g.add(mesh(box(along ? w : h, 0.5, 1), mat(0x9a958b), 0, top + 0.05, 0));
      for (const sd of [-1, 1]) g.add(mesh(box(along ? 0.35 : 1, top, along ? 1 : 0.35), mat(0x9a958b), along ? sd * (w / 2 - 0.17) : 0, top / 2, along ? 0 : sd * (h / 2 - 0.17)));
      g.add(mesh(box(along ? w - 0.7 : 0.15, top - 0.1, along ? 0.15 : h - 0.7), c, 0, (top - 0.1) / 2, 0));
      for (let i = 0; i < 4; i++) g.add(mesh(box(along ? 0.05 : 0.2, top - 0.2, along ? 0.2 : 0.05), mat(0x2a2a2c), along ? -w / 2 + 0.6 + i * (w - 1.2) / 3 : 0, (top - 0.2) / 2, along ? 0 : -h / 2 + 0.6 + i * (h - 1.2) / 3));
      if (!along) g.children.forEach((ch) => { void ch; });
      break;
    }
    case 'cannon': case 'ballista': case 'mortar': case 'battery': case 'harpoon': return buildWeapon(def.model, w, h);
    case 'deck': {
      g.add(mesh(box(w, 0.12, h), c, 0, LEVEL_H - 0.06, 0));
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(mesh(box(0.15, LEVEL_H, 0.15), dark, x * (w / 2 - 0.1), LEVEL_H / 2, z * (h / 2 - 0.1)));
      break;
    }
  }
  if (!g.children.length) {
    // no model yet for this kind: a plain block of the right size stands in (flat-topped where it is walked on)
    if (def.level) g.add(mesh(box(w, def.level * LEVEL_H, h), c, 0, (def.level * LEVEL_H) / 2, 0));
    else if (def.blocksMove) { const hh = Math.min(5, (def.losHeight || 2) * 0.7); g.add(mesh(box(w * 0.9, hh, h * 0.9), c, 0, hh / 2, 0)); g.add(mesh(box(w, 0.25, h), dark, 0, hh + 0.12, 0)); }
    else g.add(mesh(box(w * 0.94, 0.12, h * 0.94), c, 0, 0.06, 0));
  }
  return g;
}

// ---------- crewed weapons and forts ----------
// Each returns a group; userData.turret rotates to aim (forward is +x).
function carriage(g, wood) {
  g.add(mesh(box(0.7, 0.18, 0.5), wood, 0, 0.18, 0));
  for (const z of [-0.28, 0.28]) for (const x of [-0.22, 0.22]) {
    const w = mesh(cyl(0.14, 0.14, 0.06, 8), mat(0x3a2a1a), x, 0.14, z); w.rotation.x = Math.PI / 2; g.add(w);
  }
}
export function buildWeapon(model, w = 1, h = 1, def = null) {
  if (REG.SIEGE[model]) {
    const sm = guarded(`siege:${model}:${w}x${h}`, () => REG.SIEGE[model](w, h, def));
    if (sm) { sm.userData.sculpted = true; return sm; }
  }
  const g = new THREE.Group();
  const turret = new THREE.Group();
  const iron = mat(0x2a2a2c), wood = mat(0x6b4a2e), stone = mat(0x8a8a86), rope = mat(0xb8a070);
  switch (model) {
    case 'cannon': {
      carriage(g, wood);
      const barrel = mesh(cyl(0.09, 0.13, 0.95, 8), iron, 0.15, 0, 0); barrel.rotation.z = -Math.PI / 2 + 0.12;
      turret.position.y = 0.38; turret.add(barrel); break;
    }
    case 'ballista': {
      g.add(mesh(cyl(0.06, 0.08, 0.45, 5), wood, 0, 0.22, 0));
      turret.position.y = 0.5;
      turret.add(mesh(box(0.9, 0.08, 0.1), wood, 0.1, 0, 0));
      for (const z of [-1, 1]) { const arm = mesh(box(0.06, 0.06, 0.55), wood, 0.35, 0, z * 0.27); arm.rotation.y = z * 0.5; turret.add(arm); }
      turret.add(mesh(box(0.7, 0.03, 0.03), rope, 0.25, 0.04, 0));
      const bolt = mesh(cone(0.04, 0.2, 4), iron, 0.62, 0.04, 0); bolt.rotation.z = -Math.PI / 2; turret.add(bolt);
      break;
    }
    case 'mortar': {
      g.add(mesh(box(0.7, 0.2, 0.7), wood, 0, 0.1, 0));
      const tube = mesh(cyl(0.2, 0.24, 0.5, 8), iron, 0.06, 0.1, 0); tube.rotation.z = -0.7;
      turret.position.y = 0.3; turret.add(tube); break;
    }
    case 'battery': {
      // stone emplacement with a parapet and a heavy gun
      g.add(mesh(box(w, 0.35, h), stone, 0, 0.17, 0));
      for (const [x, z, ww, hh] of [[w / 2 - 0.12, 0, 0.24, h], [0, -h / 2 + 0.12, w, 0.24], [0, h / 2 - 0.12, w, 0.24]]) g.add(mesh(box(ww, 0.35, hh), stone, x, 0.52, z));
      carriage(turret, wood);
      const barrel = mesh(cyl(0.14, 0.2, 1.4, 8), iron, 0.35, 0.3, 0); barrel.rotation.z = -Math.PI / 2 + 0.08;
      turret.add(barrel); turret.position.y = 0.35; turret.scale.setScalar(1.15); break;
    }
    case 'harpoon': {
      g.add(mesh(cyl(0.3, 0.38, 0.4, 8), stone, 0, 0.2, 0));
      turret.position.y = 0.55;
      turret.add(mesh(box(0.8, 0.12, 0.14), wood, 0.15, 0, 0));
      const spear = mesh(cyl(0.025, 0.025, 1.1, 4), iron, 0.4, 0.1, 0); spear.rotation.z = -Math.PI / 2; turret.add(spear);
      const tip = mesh(cone(0.07, 0.2, 4), iron, 0.98, 0.1, 0); tip.rotation.z = -Math.PI / 2; turret.add(tip);
      turret.add(mesh(cyl(0.12, 0.12, 0.16, 8), rope, -0.15, 0.1, 0));
      break;
    }
    case 'seaFort': {
      const r = w;
      g.add(mesh(cyl(r, r * 1.08, 1.6, 14), stone, 0, 0.8, 0));
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; g.add(mesh(box(0.4, 0.35, 0.4), stone, Math.cos(a) * r * 0.92, 1.75, Math.sin(a) * r * 0.92)); }
      g.add(mesh(cyl(r * 0.45, r * 0.5, 2.6, 10), stone, 0, 1.3, 0));
      g.add(mesh(cone(r * 0.55, 1, 10), mat(0x6a3a2a), 0, 3.1, 0));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, c = mesh(cyl(0.12, 0.16, 0.8, 6), iron, Math.cos(a) * r, 1.1, Math.sin(a) * r);
        c.rotation.z = Math.PI / 2; c.rotation.y = -a; g.add(c);
      }
      break;
    }
  }
  g.add(turret);
  g.userData.turret = turret;
  return g;
}

// ---------- landing craft ----------
// A fort as the sea view shows it: the gun (or keep) seated on its footing, turret exposed for aiming.
export function buildFortModel(def) {
  const g = new THREE.Group();
  const r = def.size;
  const w = buildWeapon(def.model, def.model === 'seaFort' ? r * 0.9 : Math.max(1, r * 0.9), Math.max(1, r * 0.9));
  if (!w.userData.sculpted) { // sculpted forts bring their own rock
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.25, 1, 9), mat(0x7a756c));
    rock.position.y = 0.1; g.add(rock);
  }
  if (def.model !== 'seaFort' && def.model !== 'battery') w.scale.setScalar(r * 0.9);
  w.position.y = 0.6;
  g.add(w);
  g.userData.turret = w.userData.turret;
  g.userData.top = (new THREE.Box3().setFromObject(w).max.y || 2) ;
  return g;
}

// Where a ship's i-th gun on the side facing a target sits, in world space. Falls back to null when the
// model does not say where its guns are (userData.muzzles: starboard muzzles [x, y, z] in ship space).
const _mz = new THREE.Vector3();
export function shipMuzzle(model, tx, tz, i, out) {
  const list = model?.userData?.muzzles;
  if (!list || !list.length) return null;
  model.updateMatrixWorld();
  const side = model.worldToLocal(_mz.set(tx, 0, tz)).z >= 0 ? 1 : -1;
  const m = list[((i % list.length) + list.length) % list.length];
  return model.localToWorld(out.set(m[0], m[1], m[2] * side));
}

export function buildCraft(color) {
  const sc = guarded('craft', () => REG.craft(color));
  if (sc) return sc;
  const g = new THREE.Group();
  const wood = mat(0x6b4a2e), side = mat(color);
  g.add(mesh(box(2.2, 0.35, 1.5), wood, 0, 0.05, 0));
  g.add(mesh(box(2.2, 0.35, 0.08), side, 0, 0.35, 0.72), mesh(box(2.2, 0.35, 0.08), side, 0, 0.35, -0.72));
  g.add(mesh(box(0.08, 0.35, 1.5), wood, -1.08, 0.35, 0));
  const ramp = pivot(1.1, 0.2, 0, mesh(box(0.08, 0.6, 1.4), wood, 0, 0.3, 0));
  g.add(ramp);
  g.userData.ramp = ramp;
  return g;
}

// ---------- ships ----------
// A war beast: the sea creature itself, with a timber fighting tower lashed to its back and a side pennant.
function buildWarBeast(def, sideColor) {
  const g = new THREE.Group();
  const cdef = { ...NAVAL_CREATURES[def.beast], size: def.beastSize, id: `${def.id}:beast` };
  const beast = buildCreature(cdef);
  g.add(beast);
  const tower = buildStructure(STRUCTURES.tower, 2, 2, null);
  const k = Math.max(0.5, Math.min(1.1, def.len / 9));
  const back = Math.max(0.5, (beast.userData.rig?.height || def.beastSize * 0.5) * 0.55);
  tower.scale.setScalar(k); tower.position.set(-def.len * 0.05, back, 0);
  g.add(tower);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6).translate(0, 0.6, 0), mat(0x4a3a26));
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshStandardMaterial({ color: sideColor, side: THREE.DoubleSide, roughness: 0.9 }));
  flag.position.set(0.42, 0.95, 0);
  const mast = new THREE.Group(); mast.add(pole, flag); mast.position.set(tower.position.x, back + 2.6 * k, 0); g.add(mast);
  const deck = back + 1.6 * k + 0.3;
  g.userData = { beast, top: back + 3.6 * k, muzzles: Array.from({ length: Math.max(1, def.cannons.perSide) }, (_, i) => [tower.position.x + (i - (def.cannons.perSide - 1) / 2) * 0.5, deck, 0.9 * k]),
    setSide: (hex) => flag.material.color.set(hex) };
  return g;
}

export function buildShip(def, sideColor) {
  if (def.beast && !def.kind && NAVAL_CREATURES[def.beast] && !instantiateCustom(def.id, def.len, 'ship')) return buildWarBeast(def, sideColor);
  if (!instantiateCustom(def.id, def.len, 'ship')) { const ss = guarded(`ship:${def.id}`, () => REG.ship(def, sideColor)); if (ss) return ss; }
  const custom = instantiateCustom(def.id, def.len, 'ship');
  if (custom) {
    custom.add(mesh(box(0.02, 0.3, 0.5), mat(sideColor, { side: THREE.DoubleSide }), 0, 1.4 + def.len * 0.35, 0));
    return custom;
  }
  const g = new THREE.Group();
  const L = def.len, B = def.beam;
  const hull = mat(def.color), deck = mat(0xb08a5a), sail = mat(def.sail, { side: THREE.DoubleSide });
  // hull: tapered with a pointed bow
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, -B / 2); shape.lineTo(L / 2 - B * 0.6, -B / 2); shape.lineTo(L / 2, 0);
  shape.lineTo(L / 2 - B * 0.6, B / 2); shape.lineTo(-L / 2, B / 2); shape.lineTo(-L / 2, -B / 2);
  const hg = new THREE.ExtrudeGeometry(shape, { depth: B * 0.45, bevelEnabled: false });
  hg.rotateX(-Math.PI / 2); hg.translate(0, -B * 0.2, 0);
  const hm = new THREE.Mesh(hg, hull); hm.castShadow = true; g.add(hm);
  const dg = new THREE.ShapeGeometry(shape); dg.rotateX(-Math.PI / 2);
  const dm = new THREE.Mesh(dg, deck); dm.position.y = B * 0.25 + 0.01; dm.scale.set(0.95, 1, 0.9); g.add(dm);
  const masts = def.sails || 1;
  for (let i = 0; i < masts; i++) {
    const x = masts === 1 ? 0 : -L * 0.3 + (i * L * 0.6) / (masts - 1);
    const mh = 1.2 + L * 0.35;
    g.add(mesh(cyl(0.06, 0.08, mh), mat(0x4a3220), x, mh / 2, 0));
    const s = mesh(box(0.04, mh * 0.55, B * 1.1), sail, x + 0.08, mh * 0.55, 0);
    g.add(s);
    (g.userData.sails ||= []).push(s);
  }
  const flag = mesh(box(0.02, 0.3, 0.5), mat(sideColor, { side: THREE.DoubleSide }), 0, 1.4 + L * 0.35, 0.25);
  g.add(flag);
  // cannon ports
  const per = def.cannons.perSide;
  for (let i = 0; i < per; i++) for (const s of [-1, 1]) {
    const x = -L * 0.35 + ((i + 0.5) * L * 0.6) / per;
    const c = mesh(cyl(0.06, 0.06, 0.3, 5), mat(0x222222), x, B * 0.15, s * (B / 2));
    c.rotation.x = Math.PI / 2; g.add(c);
  }
  return g;
}

export function buildCreature(def) {
  if (!instantiateCustom(def.id, 1, 'creature') && REG.CREATURES[def.model]) { const sc = guarded(`creature:${def.id}`, () => REG.CREATURES[def.model](def)); if (sc) return sc; }
  const custom = instantiateCustom(def.id, (def.size || 1) * 1.6, 'creature');
  if (custom) { custom.userData.rig.segs = []; return custom; }
  const g = new THREE.Group();
  const m = mat(def.color), pale = mat(0xd8d0c0);
  const s = def.size || 1;
  const rig = { kind: def.model, segs: [] };
  switch (def.model) {
    case 'serpent': case 'eel': {
      const n = def.model === 'serpent' ? 9 : 7;
      for (let i = 0; i < n; i++) {
        const r = s * 0.35 * (1 - i / (n * 1.4));
        const seg = mesh(sph(r, 7), m, -i * s * 0.5, 0, 0);
        g.add(seg); rig.segs.push(seg);
      }
      rig.segs[0].add(mesh(sph(0.08 * s, 4), mat(0xffd030, { emissive: 0x806000 }), 0.25 * s, 0.15 * s, 0.15 * s));
      break;
    }
    case 'kraken': {
      g.add(mesh(sph(s * 0.45, 8), m, 0, s * 0.2, 0));
      g.add(mesh(sph(0.14 * s, 5), mat(0xffd030, { emissive: 0x806000 }), s * 0.35, s * 0.3, s * 0.18));
      for (let i = 0; i < 8; i++) {
        const tent = new THREE.Group();
        const a = (i / 8) * Math.PI * 2;
        tent.position.set(Math.cos(a) * s * 0.4, 0, Math.sin(a) * s * 0.4);
        tent.rotation.y = -a;
        for (let k = 0; k < 5; k++) tent.add(mesh(cyl(0.1 * s * (1 - k / 6), 0.12 * s * (1 - k / 6), s * 0.35), m, k * s * 0.3, 0.1 * s + Math.sin(k) * 0.1, 0));
        tent.children.forEach((c) => (c.rotation.z = Math.PI / 2));
        g.add(tent); rig.segs.push(tent);
      }
      break;
    }
    case 'shark': {
      const body = mesh(sph(s * 0.4, 7), m, 0, 0, 0); body.scale.set(2.2, 0.8, 0.8); g.add(body);
      g.add(mesh(cone(0.25 * s, 0.6 * s, 4), m, 0, 0.45 * s, 0));
      const tail = mesh(cone(0.25 * s, 0.5 * s, 4), m, -1.0 * s, 0, 0); tail.rotation.z = Math.PI / 2; g.add(tail); rig.segs.push(tail);
      break;
    }
    case 'crab': {
      const body = mesh(sph(s * 0.45, 6), m, 0, 0.15, 0); body.scale.set(1.2, 0.5, 1); g.add(body);
      for (const z of [-1, 1]) g.add(mesh(box(0.35 * s, 0.2 * s, 0.2 * s), m, 0.55 * s, 0.2, z * 0.35 * s));
      break;
    }
    case 'siren': {
      const h = humanoid({ skin: 0x9ad8c8, cloth: def.color, weapon: 'none' });
      h.rig = h.userData.rig; h.rig.legs.forEach((l) => (l.visible = false));
      h.position.y = -0.2; g.add(h);
      const tail = mesh(cone(0.15, 0.8, 5), m, 0, 0.1, -0.3); tail.rotation.x = -Math.PI / 2; g.add(tail);
      rig.arms = h.userData.rig.arms;
      break;
    }
    case 'leviathan': {
      const body = mesh(sph(s * 0.5, 9), m, 0, 0, 0); body.scale.set(2.4, 0.7, 1); g.add(body);
      g.add(mesh(box(s * 0.6, 0.05, s * 0.4), pale, s * 0.6, -s * 0.2, 0));
      const tail = mesh(box(0.3, 0.05, s * 0.9), m, -s * 1.3, 0, 0); g.add(tail); rig.segs.push(tail);
      g.add(mesh(sph(0.1 * s, 5), mat(0xffd030, { emissive: 0x806000 }), s * 1.0, s * 0.15, s * 0.25));
      break;
    }
  }
  g.userData.rig = rig;
  return g;
}

export function animateCreature(g, t, phase) {
  const r = g.userData.rig;
  if (r && r.v2) { const fn = REG.CREATURE_ANIM[r.kind]; if (fn) fn(g, { t, phase }); return; }
  if (r.kind === 'gltf') { animateCustom(g, t, true, -1, 0); return; }
  if (r.kind === 'serpent' || r.kind === 'eel') r.segs.forEach((s, i) => { s.position.z = Math.sin(t * 3 - i * 0.7 + phase) * 0.25 * (i / 3); s.position.y = Math.sin(t * 2 - i * 0.9 + phase) * 0.25; });
  else if (r.kind === 'kraken') r.segs.forEach((s, i) => { s.rotation.z = Math.sin(t * 1.5 + i + phase) * 0.35 + 0.1; });
  else r.segs.forEach((s) => { s.rotation.y = Math.sin(t * 5 + phase) * 0.4; });
  if (r.arms) r.arms[1].rotation.x = -1.5 + Math.sin(t * 2 + phase) * 0.4;
}

// Heap of broken stone and timber left where a structure fell
export function buildRubble(w, h, color, model = null) {
  const sr = guarded('rubble', () => REG.rubble(w, h, color, model));
  if (sr) return sr;
  const g = new THREE.Group();
  const m = mat(color), d = mat(0x4a4540);
  const n = Math.min(24, 3 + w * h * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.15 + ((i * 37) % 10) / 40;
    const piece = mesh(ico(r), i % 3 ? m : d, ((i * 53) % 100) / 100 * w - w / 2, r * 0.5, ((i * 71) % 100) / 100 * h - h / 2);
    piece.rotation.set(i, i * 2, i * 3);
    g.add(piece);
  }
  return g;
}
