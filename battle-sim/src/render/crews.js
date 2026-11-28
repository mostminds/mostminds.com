// Hands on deck: small sailors standing on every ship's and airship's deck, as many as she has crew left
// (up to what her deck holds). The hands are the folk of the realm that sails her: each kind of body
// (a "kit": human, elf, dwarf, brute, goblin, skeleton, rat, lizard, ...) is a few instanced meshes,
// one per colour role, built the first time a ship of that folk shows up. Tabards are in the side's
// colour so a ship's side stays plain; skin, armour and trim come from the realm's palette.
//
//   const crews = new Crews(scene)
//   crews.track(model, def, { airship })   finds the deck (raycast from above) and its standing places, once per hull type
//   crews.update(list, t)                  list: [{ model, frac (0..1 of crew aboard), color, alive, def?, faction? }]
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { REALMS } from '../data/realms.js';

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
// Body kits. Each part is [geometry, role]; a figure faces +z and stands on y = 0.
// Roles: side (tabard, in the side's colour), skin, armor, trim, hair, legs, bone, dark
// ---------------------------------------------------------------------------------------------
const e = new THREE.Euler(), mq = new THREE.Quaternion(), mm = new THREE.Matrix4(), mp = new THREE.Vector3(), ms = new THREE.Vector3();
const put = (g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  mm.compose(mp.set(x, y, z), mq.setFromEuler(e.set(rx, ry, rz)), ms.set(sx, sy, sz));
  g.applyMatrix4(mm);
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
};
const cyl = (rt, rb, h, x, y, z, o = {}) => put(new THREE.CylinderGeometry(rt, rb, h, o.seg || 6, 1, !!o.open), x, y, z, o.rx, o.ry, o.rz, o.sx, 1, o.sz);
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1, o = {}) => put(new THREE.SphereGeometry(r, o.w || 6, o.h || 4), x, y, z, o.rx, o.ry, o.rz, sx, sy, sz);
const cone = (r, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 4) => put(new THREE.ConeGeometry(r, h, seg), x, y, z, rx, ry, rz);
const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => put(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
const pair = (f) => [f(1), f(-1)];

/** two legs, a torso, two arms and a head, the base of most kits */
function biped({ h = 1, w = 1, lean = 0, head = 0.085, legs = 'legs', arms = 'side', torso = 'side', headY } = {}) {
  const L = 0.2 * h, T = 0.3 * h, hy = headY ?? L + T + head * 0.85;
  const cz = Math.sin(lean) * T * 0.5;
  return [
    ...pair((s) => [box(0.075 * w, L, 0.085, s * 0.05 * w, L / 2, 0), legs]),
    [cyl(0.085 * w, 0.115 * w, T, 0, L + T / 2, cz, { rx: lean }), torso],
    ...pair((s) => [cyl(0.032 * w, 0.03 * w, T * 0.9, s * 0.125 * w, L + T * 0.52, cz + 0.02, { seg: 4, rz: s * 0.18, rx: lean - 0.25 }), arms]),
    [ball(head, 0, hy, cz * 2.2), 'skin'],
  ];
}

const KITS = {
  human: () => [...biped(), [cyl(0.075, 0.1, 0.06, 0, 0.67, 0, { seg: 6 }), 'trim'], [cyl(0.13, 0.13, 0.012, 0, 0.64, 0, { seg: 8 }), 'dark']],
  elf: () => [...biped({ h: 1.1, w: 0.85, head: 0.078 }),
    ...pair((s) => [cone(0.022, 0.13, s * 0.09, 0.66, -0.01, 0, 0, -s * 1.2), 'skin']),
    [ball(0.085, 0, 0.64, -0.035, 1, 1.15, 0.9), 'hair'], [box(0.06, 0.2, 0.03, 0, 0.53, -0.07), 'hair'],
    [cyl(0.082, 0.082, 0.022, 0, 0.69, 0, { seg: 8, open: true }), 'trim']],
  dwarf: () => [...biped({ h: 0.62, w: 1.45, head: 0.088, legs: 'dark' }),
    [cone(0.085, 0.2, 0, 0.27, 0.06, Math.PI + 0.25, 0, 0, 6), 'hair'],
    [ball(0.095, 0, 0.42, 0, 1, 0.75, 1, { h: 3 }), 'armor'], [cone(0.025, 0.08, 0, 0.5, 0), 'trim'],
    [cyl(0.13, 0.13, 0.04, 0, 0.13, 0, { seg: 6, open: true }), 'trim']],
  brute: (horns) => [...biped({ h: 1, w: 1.45, lean: 0.35, head: 0.088, headY: 0.5, legs: 'dark', arms: 'skin' }),
    ...pair((s) => [ball(0.075, s * 0.14, 0.47, 0.06, 1.1, 0.7, 1), 'armor']),
    ...pair((s) => [cone(0.014, 0.05, s * 0.035, 0.49, 0.25, -0.3, 0, 0, 3), 'bone']),
    ...(horns ? pair((s) => [cone(0.03, 0.17, s * 0.1, 0.6, 0.08, 0, 0, -s * 1.0), 'bone']) : [])],
  goblin: () => [...biped({ h: 0.62, w: 0.85, head: 0.09, lean: 0.2, legs: 'dark' }),
    ...pair((s) => [cone(0.035, 0.17, s * 0.13, 0.4, 0, 0, 0, -s * 1.3), 'skin']),
    [cone(0.022, 0.08, 0, 0.36, 0.13, Math.PI / 2, 0, 0, 3), 'skin'], [cone(0.07, 0.08, 0, 0.47, 0.01, 0, 0, 0, 5), 'trim']],
  halfling: () => [...biped({ h: 0.64, w: 0.95, head: 0.088 }), [ball(0.094, 0, 0.44, -0.015, 1, 0.9, 1), 'hair'],
    [cyl(0.03, 0.03, 0.05, 0, 0.07, 0.02, { seg: 4 }), 'skin']],
  gnome: () => [...biped({ h: 0.62, w: 0.95, head: 0.085 }), [cone(0.075, 0.24, 0, 0.55, 0, -0.15, 0, 0, 6), 'trim'],
    [cone(0.06, 0.12, 0, 0.36, 0.06, Math.PI + 0.3, 0, 0, 5), 'hair']],
  skeleton: () => [
    ...pair((s) => [cyl(0.022, 0.022, 0.21, s * 0.05, 0.105, 0, { seg: 4 }), 'skin']),
    [box(0.13, 0.05, 0.07, 0, 0.22, 0), 'skin'], [cyl(0.02, 0.02, 0.1, 0, 0.28, -0.01, { seg: 4 }), 'skin'],
    [cyl(0.085, 0.06, 0.18, 0, 0.42, 0, { seg: 6, open: true }), 'skin'],
    ...pair((s) => [cyl(0.02, 0.018, 0.27, s * 0.11, 0.38, 0.02, { seg: 4, rz: s * 0.12, rx: -0.3 }), 'skin']),
    [box(0.1, 0.24, 0.012, 0, 0.36, 0.075), 'side'], [box(0.1, 0.18, 0.012, 0, 0.4, -0.075), 'side'],
    [ball(0.075, 0, 0.6, 0, 0.95, 1.05, 1), 'skin'], [box(0.07, 0.04, 0.05, 0, 0.54, 0.03), 'skin'],
    [ball(0.083, 0, 0.625, -0.005, 1, 0.75, 1, { h: 3 }), 'armor']],
  ghoul: () => [...biped({ h: 0.95, w: 0.8, lean: 0.5, head: 0.08, headY: 0.47, legs: 'skin', arms: 'skin' }),
    [box(0.14, 0.16, 0.13, 0, 0.17, 0.02), 'side'], ...pair((s) => [cone(0.012, 0.06, s * 0.17, 0.2, 0.18, 0.4, 0, 0, 3), 'bone'])],
  rat: () => [...biped({ h: 0.8, w: 0.95, lean: 0.5, head: 0.07, headY: 0.44, legs: 'dark', arms: 'skin' }),
    [cone(0.06, 0.16, 0, 0.42, 0.24, Math.PI / 2, 0, 0, 5), 'skin'], [ball(0.016, 0, 0.42, 0.32), 'dark'],
    ...pair((s) => [ball(0.04, s * 0.06, 0.53, 0.1, 1, 1, 0.35), 'skin']),
    [cone(0.012, 0.36, 0, 0.1, -0.2, -Math.PI / 2 - 0.45, 0, 0, 3), 'skin']],
  lizard: () => [...biped({ h: 1.05, w: 1, head: 0.075, lean: 0.12, arms: 'skin' }),
    [box(0.08, 0.06, 0.15, 0, 0.6, 0.1), 'skin'],
    [cone(0.045, 0.45, 0, 0.16, -0.22, -Math.PI / 2 - 0.35, 0, 0, 4), 'skin'],
    ...[0, 1, 2].map((k) => [cone(0.02, 0.07, 0, 0.67 - k * 0.025, 0.02 - k * 0.05, -0.3, 0, 0, 3), 'trim'])],
  demon: () => [...biped({ h: 1.05, w: 1.25, head: 0.085, arms: 'skin', legs: 'dark' }),
    ...pair((s) => [cone(0.028, 0.16, s * 0.08, 0.7, 0.01, 0, 0, -s * 0.5), 'bone']),
    ...pair((s) => [ball(0.065, s * 0.14, 0.53, 0, 1.1, 0.7, 1), 'armor'])],
  goat: () => [...biped({ h: 1, w: 1.1, head: 0.08, legs: 'hair', arms: 'skin' }),
    [box(0.06, 0.08, 0.12, 0, 0.56, 0.08), 'skin'],
    ...pair((s) => [cone(0.03, 0.18, s * 0.08, 0.68, -0.05, -0.9, 0, -s * 0.4), 'bone'])],
  harpy: () => [...biped({ h: 1, w: 0.8, head: 0.075, arms: 'hair' }), [ball(0.08, 0, 0.6, -0.03, 1, 1.1, 1), 'hair'],
    ...pair((s) => [box(0.32, 0.03, 0.14, s * 0.2, 0.5, -0.08, 0, s * 0.5, s * -0.4), 'hair'])],
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
// realms whose own folk are a kind the palette does not name
const FOLK = { hearthmoot: 'halfling', glimmer: 'gnome' };
const REALM = new Map(REALMS.map((r) => [r.id, { ...r.P, species: FOLK[r.id] || r.P.species }]));
const OLD_IDS = Object.keys(OLD);

const lookCache = new Map();
/** the folk aboard a ship or airship def: { kit, scale, P } */
function folkOf(def, faction) {
  const key = `${(def && (def.realm || def.faction || def.id)) || ''}|${faction || ''}`;
  if (lookCache.has(key)) return lookCache.get(key);
  let P = null;
  const ids = [def && def.realm, def && def.faction, faction].filter(Boolean);
  for (const id of ids) if ((P = REALM.get(id) || OLD[id])) break;
  if (!P && def && def.id) {
    const pre = String(def.id).split(/_|(?=[A-Z])/)[0];
    P = REALM.get(pre) || OLD[pre] || OLD[OLD_IDS.find((k) => def.id.startsWith(k))];
  }
  P = P || OLD.kingdom;
  const sp = SPECIES[P.species] || SPECIES.human;
  const hair = HAIR[P.species] || HAIR[sp.kit] || HAIR.human;
  const look = { kit: sp.kit, scale: sp.scale || 1, P, hair, legs: new THREE.Color(P.cloth2 ?? 0x3a3028).lerp(new THREE.Color(0x201a16), 0.45).getHex() };
  lookCache.set(key, look);
  return look;
}

const ROLE_MAT = { skin: 0.75, side: 0.85, armor: 0.45, trim: 0.55, hair: 0.95, legs: 0.9, bone: 0.7, dark: 0.9 };

export class Crews {
  constructor(scene, max = 1600) {
    this.max = max; this.scene = scene;
    this.kits = new Map();
    this.tmp = new THREE.Matrix4(); this.loc = new THREE.Matrix4(); this.col = new THREE.Color(); this.c2 = new THREE.Color(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1);
    this.scale = 1;
  }
  /** the instanced meshes of one body kit, made on first use: [{ role, mesh }] */
  kit(name) {
    let k = this.kits.get(name);
    if (k) return k;
    const parts = name === 'bruteHorned' ? KITS.brute(true) : (KITS[name] || KITS.human)();
    const byRole = new Map();
    for (const [g, role] of parts) { if (!byRole.has(role)) byRole.set(role, []); byRole.get(role).push(g); }
    k = { meshes: [], n: 0 };
    for (const [role, gs] of byRole) {
      const geo = mergeGeometries(gs, false);
      for (const g of gs) g.dispose();
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: ROLE_MAT[role] ?? 0.85, metalness: role === 'armor' ? 0.35 : 0, flatShading: true }), this.max);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = role === 'side' || role === 'skin';
      mesh.setColorAt(0, this.col.set(0xffffff));
      this.scene.add(mesh);
      k.meshes.push({ role, mesh });
    }
    this.kits.set(name, k);
    return k;
  }
  dispose() { for (const k of this.kits.values()) for (const { mesh } of k.meshes) { mesh.parent && mesh.parent.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); } this.kits.clear(); }
  /** finds and remembers the deck of a hull type; returns the number of standing places */
  track(model, key, opts = {}) {
    const slots = deckSlots(model, key, opts.airship);
    model.userData.crewSlots = slots;
    return slots.length;
  }
  /** the colour of one role on figure i */
  roleColor(role, look, side, i) {
    const P = look.P, c = this.col, j = ((i * 37) % 11) / 11 - 0.5; // a steady per-figure jitter
    switch (role) {
      case 'side': c.set(side).lerp(this.c2.set(P.cloth), 0.15); if (i % 4 === 0) c.lerp(this.c2.set(0xe8e0d0), 0.45); return c;
      case 'skin': return c.set(P.skin).multiplyScalar(1 + j * 0.14);
      case 'armor': return c.set(i % 3 === 2 ? P.trim : P.armor);
      case 'trim': return c.set(i % 3 === 1 ? P.armor : P.trim).multiplyScalar(i % 2 ? 0.8 : 1);
      case 'hair': return c.set(look.hair[i % look.hair.length]);
      case 'legs': return c.set(look.legs);
      case 'bone': return c.set(0xe2d8c0);
      default: return c.set(0x2a2420);
    }
  }
  update(list, t) {
    for (const k of this.kits.values()) k.n = 0;
    let total = 0;
    for (const it of list) {
      const m = it.model, slots = m && m.userData.crewSlots;
      if (!slots || !slots.length || !it.alive || m.visible === false) continue;
      const look = folkOf(it.def, it.faction);
      const kit = this.kit(look.kit);
      const k = Math.min(slots.length, Math.ceil(slots.length * Math.max(0, Math.min(1, it.frac))));
      m.updateMatrixWorld();
      for (let i = 0; i < k && total < this.max; i++) {
        const p = slots[i], bob = Math.abs(Math.sin(t * 3 + i * 1.7)) * 0.03, turn = (i * 2.4 + Math.sin(t * 0.5 + i)) % (Math.PI * 2);
        this.q.setFromAxisAngle(this.v.set(0, 1, 0), turn);
        // a figure's size in the world follows the hull's own scale only partly: hands stay hand-sized
        this.s.setScalar(this.scale * (it.size || 1) * look.scale * (1 + (((i * 53) % 7) / 7 - 0.5) * 0.08));
        this.loc.compose(this.v.set(p[0], p[1] + bob, p[2]), this.q, this.s);
        this.tmp.multiplyMatrices(m.matrixWorld, this.loc);
        const n = kit.n++;
        for (const { role, mesh } of kit.meshes) { mesh.setMatrixAt(n, this.tmp); mesh.setColorAt(n, this.roleColor(role, look, it.color, i)); }
        total++;
      }
    }
    for (const k of this.kits.values()) for (const { mesh } of k.meshes) {
      mesh.count = k.n; mesh.visible = k.n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
