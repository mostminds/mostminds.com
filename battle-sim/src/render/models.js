// Procedural low-poly models built from primitives. Every model is a Group
// with userData.rig describing its moving parts, animated by animateUnit().
import * as THREE from 'three';
import { instantiateCustom, animateCustom } from './customModels.js';
export const LEVEL_H = 0.8; // world height of one walkable level

const matCache = new Map();
export function mat(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!matCache.has(k)) {
    matCache.set(k, new THREE.MeshLambertMaterial({ color, flatShading: true, ...o }));
  }
  return matCache.get(k);
}
const geoCache = new Map();
function geo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s = 6) => geo(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const sph = (r, s = 6) => geo(`s${r},${s}`, () => new THREE.SphereGeometry(r, s, Math.max(3, s - 2)));
const cone = (r, h, s = 6) => geo(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
const ico = (r) => geo(`i${r}`, () => new THREE.IcosahedronGeometry(r, 0));

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
  const wood = mat(0x6b4a2e), steel = mat(0xc9d1d9), dark = mat(0x4a4a4a);
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
  const skin = mat(o.skin ?? 0xd9a77c), cloth = mat(o.cloth ?? 0x777766), armor = o.armor ? mat(o.armor) : cloth;
  const bone = o.body === 'skeleton';
  const limbW = bone ? 0.06 : 0.12;
  const hipY = 0.42;
  const rig = { legs: [], arms: [], torso: null, kind: 'biped' };

  if (o.robe) {
    g.add(mesh(cone(0.26, 0.5, 6), cloth, 0, 0.25, 0));
  } else {
    for (const s of [-1, 1]) {
      const leg = pivot(s * 0.09, hipY, 0, mesh(box(limbW, 0.42, limbW), bone ? skin : cloth, 0, -0.21, 0));
      g.add(leg); rig.legs.push(leg);
    }
  }
  const torso = new THREE.Group();
  torso.position.y = hipY;
  g.add(torso); rig.torso = torso;
  torso.add(mesh(box(bone ? 0.2 : 0.32, 0.38, bone ? 0.12 : 0.2), bone ? skin : armor, 0, 0.19, 0));
  if (bone) for (let i = 0; i < 3; i++) torso.add(mesh(box(0.28, 0.03, 0.16), skin, 0, 0.1 + i * 0.09, 0));
  const head = new THREE.Group();
  head.position.y = 0.5;
  torso.add(head);
  head.add(mesh(o.cyclops ? sph(0.14) : box(0.2, 0.22, 0.2), skin, 0, 0, 0));
  if (o.cyclops) head.add(mesh(sph(0.055, 6), mat(0xffffff), 0, 0.02, 0.12), mesh(sph(0.03, 5), mat(0x1a1a1a), 0, 0.02, 0.165));
  else if (bone) head.add(mesh(box(0.05, 0.04, 0.02), mat(0x111111), -0.05, 0.02, 0.1), mesh(box(0.05, 0.04, 0.02), mat(0x111111), 0.05, 0.02, 0.1));
  else head.add(mesh(box(0.04, 0.03, 0.02), mat(0x222222), -0.05, 0.02, 0.1), mesh(box(0.04, 0.03, 0.02), mat(0x222222), 0.05, 0.02, 0.1));
  if (o.helm === 'full') head.add(mesh(box(0.24, 0.26, 0.24), armor, 0, 0.02, 0), mesh(box(0.16, 0.025, 0.02), mat(0x111111), 0, 0.03, 0.125));
  else if (o.helm === 'horned') { head.add(mesh(box(0.23, 0.12, 0.23), armor, 0, 0.08, 0)); for (const s of [-1, 1]) { const h = mesh(cone(0.04, 0.2), mat(0xe8e2d0), s * 0.15, 0.17, 0); h.rotation.z = -s * 0.8; head.add(h); } }
  else if (o.helm) head.add(mesh(cyl(0.12, 0.13, 0.12, 6), armor, 0, 0.1, 0));
  if (o.hood) head.add(mesh(cone(0.16, 0.3, 6), cloth, 0, 0.14, -0.02));
  if (o.horns) for (const s of [-1, 1]) { const h = mesh(cone(0.04, 0.18), mat(0x2a2a2a), s * 0.1, 0.16, 0); h.rotation.z = -s * 0.4; head.add(h); }
  if (o.wings) for (const s of [-1, 1]) {
    const w = mesh(box(0.5, 0.35, 0.02), mat(0x3a1a1a, { side: THREE.DoubleSide }), s * 0.3, 0.3, -0.14);
    w.rotation.y = s * 0.5; torso.add(w); (rig.wings ||= []).push(w);
  }
  for (const s of [-1, 1]) {
    const arm = pivot(s * (bone ? 0.15 : 0.22), 0.36, 0, mesh(box(limbW * 0.85, 0.38, limbW * 0.85), bone ? skin : (o.armor ? armor : skin), 0, -0.18, 0));
    torso.add(arm); rig.arms.push(arm);
    if (s === 1 && o.weapon && o.weapon !== 'none') { const w = weapon(o.weapon); w.position.y = -0.18; arm.add(w); }
    if (s === -1 && o.shield) { const sh = mesh(box(0.04, 0.3, 0.26), mat(o.cloth ?? 0x6b4a2e), -0.06, -0.25, 0.08); arm.add(sh); }
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

export function buildUnitModel(def) {
  const o = def.model || { body: 'humanoid' };
  const custom = instantiateCustom(def.id, 0.95 * (o.scale || 1) * Math.max(1, def.size * 0.8), 'unit');
  if (custom) return custom;
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
  outer.add(g);
  outer.userData.rig = g.userData.rig;
  outer.userData.inner = g;
  return outer;
}

// t: seconds, moving: bool, atk: 0..1 progress of an attack swing (or -1), dead: 0..1
export function animateUnit(model, t, moving, atk, dead, phase = 0) {
  const r = model.userData.rig;
  if (!r) return;
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
export function buildStructure(def, w, h) {
  const custom = def.id && instantiateCustom(`struct:${def.id}`, Math.max(w, h), 'struct');
  if (custom) return custom;
  const g = new THREE.Group();
  const c = mat(def.color), dark = mat(0x4a3a2a), roof = mat(0x8a3a2a), stone = mat(0x8a8a86);
  switch (def.model) {
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
      const r = mesh(cone(Math.max(w, h) * 0.75, hh * 0.8, 4), def.model === 'hut' ? mat(0xb89a5a) : roof, 0, hh + hh * 0.4, 0);
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
    case 'tree': g.add(mesh(cyl(0.08, 0.12, 0.7, 5), dark, 0, 0.35, 0), mesh(ico(0.5), c, 0, 1.0, 0)); break;
    case 'pine': g.add(mesh(cyl(0.07, 0.1, 0.5, 5), dark, 0, 0.25, 0), mesh(cone(0.45, 0.8, 6), c, 0, 0.8, 0), mesh(cone(0.32, 0.6, 6), c, 0, 1.25, 0)); break;
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
export function buildWeapon(model, w = 1, h = 1) {
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
export function buildCraft(color) {
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
export function buildShip(def, sideColor) {
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
  if (r.kind === 'gltf') { animateCustom(g, t, true, -1, 0); return; }
  if (r.kind === 'serpent' || r.kind === 'eel') r.segs.forEach((s, i) => { s.position.z = Math.sin(t * 3 - i * 0.7 + phase) * 0.25 * (i / 3); s.position.y = Math.sin(t * 2 - i * 0.9 + phase) * 0.25; });
  else if (r.kind === 'kraken') r.segs.forEach((s, i) => { s.rotation.z = Math.sin(t * 1.5 + i + phase) * 0.35 + 0.1; });
  else r.segs.forEach((s) => { s.rotation.y = Math.sin(t * 5 + phase) * 0.4; });
  if (r.arms) r.arms[1].rotation.x = -1.5 + Math.sin(t * 2 + phase) * 0.4;
}

// Heap of broken stone and timber left where a structure fell
export function buildRubble(w, h, color) {
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
