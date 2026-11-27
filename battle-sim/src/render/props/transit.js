// Trains, pack caravans, cable gondolas and balloons, each in its faction's own manner.
//   transitLook(faction)            -> { fam, savage, beast, cloth, cloth2, metal, wood, trim, glow, envelope }
//   buildConsist(look, sideColor)   -> [Object3D, ...] the cars of a train in order from the head of the line
//                                      (each: +x is forward, origin on the rails, userData.len = its length,
//                                       userData.legs for a beast, userData.beam for a handcar's pump)
//   buildGondola(look, sideColor)   -> a cable car, origin at the cable
//   buildBalloonFor(look, sideColor)-> a balloon, origin at the basket floor
//   trackLook(look)                 -> colours of its track, or { trail: true } for a beaten path
import * as THREE from 'three';
import { REALMS } from '../../data/realms.js';

// Finer sculpts, when they are there: each of these files may be absent or broken without stopping the game,
// and then the plain builders below stand in.
const optional = async (file) => { try { return await import(file); } catch (err) { if (!/Failed to fetch|Cannot find module|404/i.test(String(err))) console.warn(`transit: ${file} did not load`, err); return {}; } };
const CARS = await optional('./transitCars.js');     // buildHandcar(look, sideColor, index)
const BEASTS = await optional('./transitBeasts.js'); // buildPackBeast(look, sideColor, index)
const AIR = await optional('./transitAir.js');       // buildGondola(look, sideColor), buildBalloon(look, sideColor)
const BOATS = await optional('./transitBoats.js');  // buildBoat(look, sideColor, kind)
const tryBuild = (fn, alt, ...a) => { if (fn) { try { const o = fn(...a); if (o) return o; } catch (err) { console.warn('transit: a sculpt failed, using the plain one', err); } } return alt(...a); };

const FAMILY = {
  kingdom: 'kingdom', graal: 'kingdom', aurelia: 'kingdom', westmark: 'kingdom', principalities: 'kingdom', sunkings: 'kingdom',
  aethel: 'elven', kaelneth: 'elven',
  grom: 'dwarf',
  tianlong: 'eastern', shogunate: 'eastern', thousandgods: 'eastern',
  caliphate: 'desert', khemet: 'desert',
  velikaya: 'north',
  undead: 'undead', crimson: 'undead', drowned: 'undead',
  infernal: 'infernal', ironbound: 'infernal', ashur: 'infernal',
  goblin: 'goblin', skar: 'goblin',
  beasts: 'savage', dragons: 'savage', cloven: 'savage', fimbul: 'savage', gorge: 'savage', verdant: 'savage', screaming: 'savage',
  xibalba: 'savage', greenhide: 'savage', mistisles: 'savage', elemental: 'savage',
};
// the pack beast each savage people drives
const BEAST = { beasts: 'ox', dragons: 'drake', cloven: 'aurochs', fimbul: 'mammoth', gorge: 'yak', verdant: 'stag', screaming: 'horror', xibalba: 'lizard', greenhide: 'boar', mistisles: 'lizard', elemental: 'golem' };
const BASE = {
  kingdom: { cloth: 0x2a5aa8, cloth2: 0xd8b04a, metal: 0x2e2e34, wood: 0x7a5a36, trim: 0xc8a040, glow: 0xffa030 },
  elven: { cloth: 0xf0ece0, cloth2: 0x3a7a68, metal: 0xd8d4c8, wood: 0xe8e0cc, trim: 0xd8b860, glow: 0x9ae8ff },
  dwarf: { cloth: 0x7a3a2a, cloth2: 0xc8a040, metal: 0x4a4a52, wood: 0x5a4630, trim: 0xd0a040, glow: 0xff8a30 },
  eastern: { cloth: 0xb02a22, cloth2: 0xd8b04a, metal: 0x2a2a2e, wood: 0x6a2a1e, trim: 0xd8b04a, glow: 0xffc860 },
  desert: { cloth: 0xd8c08a, cloth2: 0x2a8a9a, metal: 0x8a6a3a, wood: 0xb89a62, trim: 0xe0b840, glow: 0xffd070 },
  north: { cloth: 0x8a2a2a, cloth2: 0xe8e0d0, metal: 0x3a3a40, wood: 0x6a4a2e, trim: 0xd8b04a, glow: 0xffa040 },
  undead: { cloth: 0x3a3a44, cloth2: 0xd8d0b8, metal: 0x24242a, wood: 0x2e2a2a, trim: 0xd8d0b8, glow: 0x6aff8a },
  infernal: { cloth: 0x5a1612, cloth2: 0x1a1a1c, metal: 0x1c1c20, wood: 0x2a1a18, trim: 0x8a2a1a, glow: 0xff4a1a },
  goblin: { cloth: 0x6a7a3a, cloth2: 0x8a5a2a, metal: 0x6a5a48, wood: 0x6a5234, trim: 0x9a6a2a, glow: 0xffb040 },
  savage: { cloth: 0x8a6a4a, cloth2: 0xd8c8a0, metal: 0x5a4a3a, wood: 0x6a4e30, trim: 0xe0d8c0, glow: 0xffa040 },
};
const HIDE = { ox: 0x6a4a32, aurochs: 0x3a2a22, yak: 0x4a3a2c, mammoth: 0x7a5a40, stag: 0x9a7a4a, boar: 0x4a4238, lizard: 0x4a8a5a, drake: 0x8a3a2a, horror: 0x6a2a6a, golem: 0x7a7a82 };

export function transitLook(faction) {
  const fam = FAMILY[faction] || 'kingdom', realm = REALMS.find((r) => r.id === faction), L = { fam, savage: fam === 'savage', faction, ...BASE[fam] };
  if (realm) {
    L.cloth = realm.P.cloth; L.cloth2 = realm.P.cloth2 ?? L.cloth2; L.trim = realm.P.trim ?? L.trim;
    L.envelope = realm.air && realm.air.envelope;
    if (faction === 'kaelneth') { L.metal = 0x24202c; L.wood = 0x2a2434; L.glow = 0xb86aff; }
    if (faction === 'khemet') { L.glow = 0x6affd0; L.wood = 0xcfc4a0; }
    if (faction === 'ashur') { L.metal = 0x3a2a22; L.trim = 0xc88a30; }
    if (faction === 'drowned') { L.wood = 0x2a3a34; L.glow = 0x6affd0; }
  }
  L.envelope ??= L.cloth;
  if (L.savage) { L.beast = BEAST[faction] || 'ox'; L.hide = HIDE[L.beast]; if (faction === 'mistisles') L.hide = 0x5a8a9a; if (faction === 'fimbul') L.hide = 0xb8b0a0; }
  return L;
}

// ---- small helpers -------------------------------------------------------------------------
const mats = new Map();
function M(color, o = {}) {
  const k = `${color}:${o.metal || 0}:${o.rough ?? 0.75}:${o.glow || 0}:${o.double || 0}:${o.flat || 0}`;
  if (!mats.has(k)) mats.set(k, o.glow ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshStandardMaterial({ color, metalness: o.metal || 0, roughness: o.rough ?? 0.75, side: o.double ? THREE.DoubleSide : THREE.FrontSide, flatShading: !!o.flat }));
  return mats.get(k);
}
const put = (g, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; g.add(o); return o; };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (a, b, h, n = 12) => new THREE.CylinderGeometry(a, b, h, n);
const ball = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const cone = (r, h, n = 8) => new THREE.ConeGeometry(r, h, n);
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
const blend = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

/** wheels under a car: n axles along a wheelbase */
function wheels(g, n, base, r, m, wonky = false) {
  for (let i = 0; i < n; i++) for (const z of [-0.3, 0.3]) {
    const x = n === 1 ? 0 : -base / 2 + (base * i) / (n - 1), rr = wonky ? r * (0.8 + ((i * 7 + (z > 0 ? 3 : 0)) % 5) * 0.09) : r;
    put(g, cyl(rr, rr, 0.08, 12), m, x, rr + 0.02, z, Math.PI / 2);
  }
}
/** a roof in the faction's manner over a box of this footprint, at height y */
function roof(g, L, w, d, y) {
  const c = M(L.fam === 'elven' ? L.cloth2 : L.fam === 'dwarf' ? L.metal : L.cloth, { rough: 0.7 }), t = M(L.trim, { metal: 0.7, rough: 0.35 });
  switch (L.fam) {
    case 'eastern': { // a swept pagoda roof with upturned corners
      put(g, box(w + 0.3, 0.06, d + 0.3), c, 0, y + 0.03, 0);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.707, 0.34, 4).rotateY(Math.PI / 4), c); top.position.set(0, y + 0.23, 0); top.scale.set(w + 0.1, 1, d + 0.1); top.castShadow = true; g.add(top);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(g, cone(0.05, 0.2, 5), t, sx * (w / 2 + 0.14), y + 0.12, sz * (d / 2 + 0.14), sz * -0.5, 0, sx * 0.5);
      put(g, ball(0.06), t, 0, y + 0.44, 0);
      break;
    }
    case 'north': { put(g, box(w + 0.12, 0.06, d + 0.12), c, 0, y + 0.03, 0); const o = put(g, ball(Math.min(w, d) * 0.36, 10, 10), M(L.trim, { metal: 0.6, rough: 0.4 }), 0, y + 0.3, 0); o.scale.y = 1.25; put(g, cone(0.07, 0.28, 8), t, 0, y + 0.72, 0); break; }
    case 'desert': { put(g, box(w + 0.1, 0.06, d + 0.1), M(L.wood), 0, y + 0.03, 0); const o = put(g, ball(Math.min(w, d) * 0.42, 12, 8), M(L.trim, { metal: 0.7, rough: 0.35 }), 0, y + 0.06, 0); o.scale.y = 0.8; put(g, cone(0.04, 0.2, 6), t, 0, y + 0.48, 0); break; }
    case 'elven': { for (const s of [-1, 1]) { const leaf = put(g, ball(0.5, 8, 6), c, 0, y + 0.04, s * d * 0.2, 0, 0, 0); leaf.scale.set(w * 1.15, 0.16, d * 0.62); } put(g, cone(0.05, 0.3, 6), t, w / 2 + 0.1, y + 0.1, 0, 0, 0, -1.2); break; }
    case 'undead': { put(g, box(w + 0.06, 0.05, d + 0.06), M(L.metal), 0, y + 0.03, 0); for (let i = 0; i < 5; i++) { const x = -w / 2 + 0.12 + ((w - 0.24) * i) / 4; put(g, new THREE.TorusGeometry(d / 2, 0.025, 5, 10, Math.PI), M(L.trim), x, y, 0, 0, Math.PI / 2, 0); } break; }
    case 'infernal': { put(g, box(w + 0.08, 0.08, d + 0.08), M(L.metal, { metal: 0.6, rough: 0.5 }), 0, y + 0.04, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(g, cone(0.06, 0.34, 5), M(L.metal, { metal: 0.6 }), sx * (w / 2 - 0.02), y + 0.24, sz * (d / 2 - 0.02)); break; }
    case 'goblin': { put(g, box(w + 0.2, 0.05, d * 0.7), M(L.cloth2), -0.04, y + 0.06, -0.1, 0.14, 0, 0.05); put(g, box(w * 0.6, 0.05, d * 0.6), M(L.trim), 0.1, y + 0.05, 0.2, -0.2, 0.3, 0); break; }
    case 'dwarf': { const o = put(g, cyl(d / 2 + 0.04, d / 2 + 0.04, w + 0.1, 10), c, 0, y - 0.02, 0, 0, 0, Math.PI / 2); o.scale.y = 1; o.scale.z = 1; o.scale.x = 0.45; for (const sx of [-1, 0, 1]) put(g, box(0.06, 0.06, d + 0.14), t, sx * w * 0.4, y + 0.2 - Math.abs(sx) * 0.0, 0); break; }
    default: { put(g, box(w + 0.16, 0.07, d + 0.12), M(shade(L.metal, 1.1)), 0, y + 0.035, 0); }
  }
}

/** a pump handcar: a flat truck with a walking beam its two hands work, and stores lashed at either end */
function handcar(L, side, i) {
  const g = new THREE.Group(), iron = M(L.metal, { metal: 0.6, rough: 0.5 }), wood = M(L.wood, { rough: 0.85 }), trim = M(L.trim, { metal: 0.8, rough: 0.35 }), crate = M(0xa07a4a), sack = M(0xb8a888), glow = M(L.glow, { glow: 1 });
  const frame = L.fam === 'dwarf' || L.fam === 'infernal' ? M(shade(L.metal, 1.5), { metal: 0.5, rough: 0.5 }) : L.fam === 'undead' ? M(0x2a2420) : wood;
  put(g, box(2.7, 0.12, 0.9), frame, 0, 0.5, 0);
  for (const z of [-0.42, 0.42]) put(g, box(2.7, 0.08, 0.06), L.fam === 'eastern' || L.fam === 'north' ? M(L.cloth) : iron, 0, 0.5, z);
  wheels(g, 2, 1.8, 0.22, L.fam === 'elven' ? trim : iron, L.fam === 'goblin');
  // the pump: an A-frame amidships and the beam that rocks on it
  for (const z of [-0.16, 0.16]) { put(g, box(0.08, 0.75, 0.06), iron, -0.12, 0.92, z, 0, 0, -0.18); put(g, box(0.08, 0.75, 0.06), iron, 0.12, 0.92, z, 0, 0, 0.18); }
  put(g, cyl(0.05, 0.05, 0.44, 8), trim, 0, 1.27, 0, Math.PI / 2);
  const beam = new THREE.Group(); beam.position.set(0, 1.3, 0); g.add(beam);
  put(beam, box(1.5, 0.07, 0.09), L.fam === 'undead' ? M(L.trim) : wood, 0, 0, 0);
  for (const x of [-0.75, 0.75]) put(beam, cyl(0.03, 0.03, 0.62, 6), L.fam === 'undead' ? M(L.trim) : wood, x, 0, 0, Math.PI / 2);
  // stores at both ends, in the faction's own packing
  for (const sx of [-1, 1]) {
    const x = sx * 1.0;
    if (L.fam === 'dwarf') { const t = put(g, cyl(0.3, 0.24, 0.36, 8), M(shade(L.metal, 1.4), { metal: 0.5 }), x, 0.75, 0); t.scale.z = 1.1; const ore = put(g, ball(0.26, 6, 4), M(sx > 0 ? 0xc8a040 : 0x5a5a66, { flat: 1, metal: 0.4 }), x, 0.95, 0); ore.scale.y = 0.5; }
    else if (L.fam === 'undead') { put(g, box(0.5, 0.26, 0.8), M(0x2a2420), x, 0.7, 0); put(g, box(0.52, 0.04, 0.82), M(L.trim), x, 0.85, 0); put(g, box(0.06, 0.02, 0.3), glow, x, 0.875, 0); }
    else if (L.fam === 'infernal') { put(g, box(0.5, 0.4, 0.7), crate, x, 0.77, 0); for (const z of [-0.36, 0, 0.36]) put(g, box(0.54, 0.44, 0.04), iron, x, 0.78, z); put(g, cone(0.05, 0.26, 5), iron, x + sx * 0.3, 0.7, 0.4); put(g, cone(0.05, 0.26, 5), iron, x + sx * 0.3, 0.7, -0.4); }
    else if (L.fam === 'elven') { const pod = put(g, ball(0.3, 10, 8), M(L.cloth2), x, 0.76, 0); pod.scale.set(0.9, 0.7, 1.2); put(g, box(0.1, 0.03, 0.5), trim, x, 0.98, 0); }
    else { put(g, box(0.46, 0.38, 0.46), crate, x, 0.75, sx * 0.14, 0, sx * 0.2); const s2 = put(g, ball(0.2, 8, 6), sack, x - sx * 0.05, 0.7, -sx * 0.26); s2.scale.set(1.1, 0.7, 0.9); if (L.fam === 'goblin') put(g, box(0.3, 0.3, 0.04), M(L.trim), x, 0.8, 0.46, 0, 0, 0.2); }
  }
  // a lamp on a post at the leading end, and the faction's own flourish
  put(g, cyl(0.025, 0.025, 0.9, 5), iron, 1.3, 1.0, 0.36); put(g, box(0.14, 0.16, 0.14), glow, 1.3, 1.5, 0.36);
  if (L.fam === 'eastern') { const r = new THREE.Group(); roof(r, L, 0.3, 0.3, 0); r.position.set(1.3, 1.58, 0.36); g.add(r); }
  if (L.fam === 'north' || L.fam === 'desert') { const o = put(g, ball(0.12, 8, 8), trim, 1.3, 1.7, 0.36); o.scale.y = 1.3; }
  if (L.fam === 'infernal') for (const z of [-0.3, 0, 0.3]) put(g, cone(0.06, 0.4, 5), iron, 1.5, 0.5, z, 0, 0, -Math.PI / 2);
  if (L.fam === 'undead') { const sk = put(g, ball(0.16, 8, 6), M(L.trim), 1.42, 0.62, 0); sk.scale.set(0.8, 1, 0.9); }
  if (L.fam === 'kingdom' || L.fam === 'elven') put(g, box(0.02, 0.3, 0.44), M(side, { double: 1 }), -1.3, 1.25, -0.3);
  for (const z of [-0.47, 0.47]) put(g, box(0.5, 0.14, 0.02), M(side, { double: 1 }), 0, 0.5, z);
  g.userData.beam = beam; g.userData.len = 2.9; g.userData.deck = 0.58; g.userData.phase = i * 1.3;
  return g;
}

/** a pack beast with panniers: four legs that walk, and whatever its kind wears on its head */
function beast(L, side, i) {
  const g = new THREE.Group(), kind = L.beast, k = { mammoth: 1.55, golem: 1.3, drake: 1.2, yak: 1.15, aurochs: 1.15, ox: 1.05, lizard: 1.0, horror: 1.1, stag: 0.95, boar: 0.9 }[kind] || 1;
  const hide = M(L.hide, { rough: 0.95, flat: kind === 'golem' ? 1 : 0 }), dark = M(shade(L.hide, 0.6), { rough: 0.95 }), bone = M(0xe8e0c8, { rough: 0.6 }), wick = M(0xb0884a, { rough: 0.95 }), glow = M(L.glow, { glow: 1 });
  const body = new THREE.Group(); g.add(body);
  const low = kind === 'lizard' || kind === 'drake', legH = low ? 0.42 : kind === 'stag' ? 0.85 : 0.68, bl = kind === 'lizard' ? 1.25 : 1.0;
  const trunk = put(body, kind === 'golem' ? new THREE.DodecahedronGeometry(0.55) : ball(0.5, 12, 10), hide, 0, legH + 0.36, 0); trunk.scale.set(bl * 1.35, kind === 'yak' || kind === 'mammoth' ? 0.95 : 0.8, 0.82);
  if (kind === 'yak' || kind === 'mammoth' || kind === 'aurochs') { const hump = put(body, ball(0.38, 10, 8), kind === 'yak' ? dark : hide, 0.38, legH + 0.68, 0); hump.scale.set(1.1, 0.8, 0.9); }
  if (kind === 'yak' || kind === 'mammoth') for (const z of [-0.4, 0.4]) { const sk = put(body, box(1.2, 0.34, 0.04), dark, 0, legH + 0.1, z); sk.rotation.x = z > 0 ? -0.12 : 0.12; } // shaggy skirts
  // head and neck
  const head = new THREE.Group(); head.position.set(bl * 0.72, legH + (kind === 'stag' ? 0.85 : low ? 0.38 : 0.5), 0); body.add(head);
  const skull = put(head, kind === 'golem' ? new THREE.DodecahedronGeometry(0.26) : ball(0.26, 10, 8), hide, 0.14, 0, 0); skull.scale.set(kind === 'lizard' || kind === 'drake' || kind === 'boar' ? 1.6 : 1.25, 0.85, 0.85);
  if (kind === 'stag') put(body, cyl(0.12, 0.16, 0.6, 8), hide, bl * 0.62, legH + 0.62, 0, 0, 0, -0.6);
  const eye = kind === 'horror' || kind === 'golem' ? glow : M(0x1a1410);
  for (const z of [-0.17, 0.17]) put(head, ball(0.04), eye, 0.3, 0.07, z);
  switch (kind) {
    case 'ox': case 'aurochs': case 'yak': for (const z of [-1, 1]) { put(head, cone(0.05, kind === 'aurochs' ? 0.55 : 0.4, 6), bone, 0.1, 0.2, z * 0.26, z * 1.1, 0, 0.3); } break;
    case 'mammoth': { put(head, cyl(0.09, 0.05, 0.7, 8), hide, 0.42, -0.34, 0, 0, 0, 0.25); for (const z of [-1, 1]) { const tusk = put(head, new THREE.TorusGeometry(0.34, 0.045, 6, 10, Math.PI * 0.7), bone, 0.36, -0.2, z * 0.2); tusk.rotation.set(0, z * 0.25, -2.2); } for (const z of [-1, 1]) { const ear = put(head, ball(0.2, 8, 6), dark, -0.02, 0.05, z * 0.26); ear.scale.set(0.3, 1, 0.8); } break; }
    case 'stag': for (const z of [-1, 1]) { put(head, cyl(0.02, 0.03, 0.55, 5), bone, 0, 0.36, z * 0.14, z * 0.35, 0, -0.2); for (let t = 0; t < 3; t++) put(head, cyl(0.012, 0.02, 0.24, 4), bone, 0.05 + t * 0.03, 0.34 + t * 0.12, z * (0.2 + t * 0.05), z * 0.9, 0, 0.6); } break;
    case 'boar': for (const z of [-1, 1]) put(head, cone(0.035, 0.22, 5), bone, 0.42, -0.02, z * 0.13, 0, 0, 0.4); for (let t = 0; t < 6; t++) put(body, cone(0.05, 0.22, 4), dark, -0.5 + t * 0.2, legH + 0.82, 0); break;
    case 'lizard': { const fr = put(head, cyl(0.34, 0.2, 0.05, 9, 1), M(blend(L.hide, 0xffa040, 0.5), { double: 1 }), -0.1, 0.1, 0, 0, 0, 1.2); fr.scale.z = 1.1; for (let t = 0; t < 7; t++) put(body, cone(0.05, 0.2, 4), M(blend(L.hide, 0xffa040, 0.5)), -0.7 + t * 0.22, legH + 0.78, 0); break; }
    case 'drake': { for (const z of [-1, 1]) { put(head, cone(0.04, 0.34, 5), bone, -0.05, 0.2, z * 0.14, 0, 0, 0.9); const w = put(body, new THREE.ConeGeometry(0.5, 0.9, 3), M(shade(L.hide, 0.8), { double: 1 }), -0.1, legH + 0.72, z * 0.42, z * 1.25, 0, 0.2); w.scale.z = 0.12; } for (let t = 0; t < 6; t++) put(body, cone(0.05, 0.22, 4), dark, -0.6 + t * 0.22, legH + 0.8, 0); break; }
    case 'horror': { for (let t = 0; t < 5; t++) put(head, ball(0.035), glow, 0.28 + (t % 2) * 0.05, -0.08 + t * 0.06, (t - 2) * 0.07); for (let t = 0; t < 4; t++) put(head, cyl(0.03, 0.01, 0.45, 5), dark, 0.4, -0.22, (t - 1.5) * 0.1, 0, 0, 0.4 + t * 0.1); for (let t = 0; t < 5; t++) put(body, cone(0.06, 0.36, 4), dark, -0.6 + t * 0.3, legH + 0.8, (t % 2 - 0.5) * 0.3, (t % 2 - 0.5) * 0.6); break; }
    case 'golem': { put(body, new THREE.OctahedronGeometry(0.2), glow, 0, legH + 0.86, 0); for (let t = 0; t < 4; t++) put(body, new THREE.DodecahedronGeometry(0.16), M(shade(L.hide, 0.8 + t * 0.1), { flat: 1 }), -0.5 + t * 0.34, legH + 0.74, (t % 2 - 0.5) * 0.5); break; }
    default: break;
  }
  // tail
  if (low || kind === 'horror') { const tail = put(body, cone(0.2, 1.3, 7), hide, -bl * 0.95, legH + 0.26, 0, 0, 0, Math.PI / 2); tail.scale.z = 0.8; } else put(body, cyl(0.025, 0.02, 0.6, 5), dark, -bl * 0.7, legH + 0.3, 0, 0, 0, 0.35);
  // legs: each hangs from a pivot so it can swing
  const legs = [];
  for (const [x, z, ph] of [[bl * 0.45, -0.3, 0], [bl * 0.45, 0.3, Math.PI], [-bl * 0.45, -0.3, Math.PI], [-bl * 0.45, 0.3, 0]]) {
    const piv = new THREE.Group(); piv.position.set(x, legH + 0.1, low ? z * 1.35 : z);
    const r = kind === 'mammoth' || kind === 'golem' ? 0.15 : kind === 'stag' ? 0.07 : 0.11;
    put(piv, kind === 'golem' ? box(r * 2, legH + 0.1, r * 2) : cyl(r, r * 0.8, legH + 0.1, 7), kind === 'golem' ? hide : dark, 0, -(legH + 0.1) / 2, 0);
    body.add(piv); legs.push({ piv, ph });
  }
  // the load: a blanket in the side's colour, a wicker pannier each flank, and stores lashed on top
  const sc = M(side, { rough: 0.9, double: 1 });
  put(body, box(0.85, 0.05, 0.92), sc, -0.05, legH + 0.78, 0).scale.y = 1;
  for (const z of [-0.5, 0.5]) { put(body, box(0.82, 0.3, 0.05), sc, -0.05, legH + 0.62, z * 0.92); const b = put(body, cyl(0.26, 0.2, 0.44, 10), wick, -0.05, legH + 0.46, z * 1.12); b.scale.x = 1.25; put(body, new THREE.TorusGeometry(0.27, 0.03, 5, 12), M(0x8a6a3a), -0.05, legH + 0.68, z * 1.12, Math.PI / 2).scale.x = 1.25; const s = put(body, ball(0.2, 8, 6), M(i % 2 ? 0xb8a888 : 0xa07a4a), -0.05, legH + 0.7, z * 1.12); s.scale.y = 0.6; }
  put(body, box(0.42, 0.3, 0.42), M(0xa07a4a), -0.12, legH + 0.96, 0, 0, 0.3); put(body, cyl(0.03, 0.03, 0.95, 5), M(0x5a4026), -0.05, legH + 0.82, 0, Math.PI / 2);
  if (kind === 'mammoth' || kind === 'golem') { put(body, box(0.5, 0.34, 0.5), M(0xa07a4a), -0.5, legH + 0.95, 0); }
  body.scale.setScalar(k);
  g.userData.legs = legs; g.userData.body = body; g.userData.len = (low ? 3.0 : 2.3) * k; g.userData.beast = true;
  return g;
}

export function buildConsist(L, side) {
  if (L.savage) return Array.from({ length: L.faction === 'fimbul' ? 2 : 3 }, (_, i) => tryBuild(BEASTS.buildPackBeast, beast, L, side, i));
  return [tryBuild(CARS.buildHandcar, handcar, L, side, 0), tryBuild(CARS.buildHandcar, handcar, L, side, 1)];
}

export function buildGondola(L, side) { return tryBuild(AIR.buildGondola, plainGondola, L, side); }
function plainGondola(L, side) {
  const g = new THREE.Group(), wood = M(L.wood, { rough: 0.85 }), iron = M(L.metal, { metal: 0.6, rough: 0.5 }), sc = M(side, { double: 1 });
  put(g, cyl(0.07, 0.07, 0.1, 10), iron, 0, 0, 0, Math.PI / 2); // the wheel on the cable
  if (L.savage) {
    // a hide-and-wicker cradle on a bone hook
    put(g, new THREE.TorusGeometry(0.16, 0.025, 5, 10, Math.PI * 1.3), M(0xe8e0c8), 0, -0.14, 0, 0, 0, 2.2);
    for (const [x, z] of [[-0.3, -0.22], [0.3, -0.22], [-0.3, 0.22], [0.3, 0.22]]) put(g, cyl(0.012, 0.012, 0.5, 4), M(0x3a2a1c), x * 0.6, -0.5, z * 0.6, z * 0.6, 0, -x * 0.9);
    const b = put(g, cyl(0.36, 0.28, 0.4, 10), M(0xb0884a, { rough: 0.95 }), 0, -0.9, 0); b.scale.x = 1.3;
    put(g, new THREE.TorusGeometry(0.37, 0.035, 5, 12), M(L.hide ?? 0x6a4a32), 0, -0.7, 0, Math.PI / 2).scale.x = 1.3;
    put(g, box(0.5, 0.2, 0.03), sc, 0, -0.9, 0.3);
    const s = put(g, ball(0.22, 8, 6), M(0xb8a888), 0.05, -0.68, 0); s.scale.y = 0.6;
    for (const x of [-0.42, 0.42]) put(g, cone(0.03, 0.24, 5), M(0xe8e0c8), x, -0.62, 0, 0, 0, x > 0 ? -0.5 : 0.5);
    return g;
  }
  put(g, box(0.05, 0.4, 0.05), iron, 0, -0.22, 0);
  const cab = L.fam === 'dwarf' || L.fam === 'infernal' ? M(shade(L.metal, 1.5), { metal: 0.5, rough: 0.5 }) : L.fam === 'undead' ? M(0x2a2420) : L.fam === 'eastern' || L.fam === 'north' ? M(L.cloth) : wood;
  if (L.fam === 'elven') { const pod = put(g, ball(0.4, 12, 10), M(L.wood), 0, -0.85, 0); pod.scale.set(1.3, 0.9, 0.75); put(g, box(0.7, 0.2, 0.02), M(L.glow, { glow: 1 }), 0, -0.8, 0.3); put(g, box(0.7, 0.2, 0.02), M(L.glow, { glow: 1 }), 0, -0.8, -0.3); }
  else if (L.fam === 'infernal') { for (let k = 0; k < 6; k++) for (const z of [-0.28, 0.28]) put(g, cyl(0.015, 0.015, 0.6, 4), iron, -0.38 + k * 0.15, -0.8, z); put(g, box(0.84, 0.08, 0.6), iron, 0, -1.12, 0); put(g, box(0.4, 0.3, 0.4), M(0xa07a4a), 0, -0.93, 0); put(g, ball(0.08), M(L.glow, { glow: 1 }), 0, -0.56, 0); }
  else if (L.fam === 'undead') { put(g, box(0.9, 0.5, 0.5), cab, 0, -0.86, 0); for (let k = 0; k < 4; k++) put(g, new THREE.TorusGeometry(0.28, 0.02, 5, 10, Math.PI), M(L.trim), -0.33 + k * 0.22, -0.62, 0, 0, Math.PI / 2); put(g, box(0.3, 0.12, 0.02), M(L.glow, { glow: 1 }), 0, -0.82, 0.26); }
  else { put(g, box(0.84, 0.58, 0.56), cab, 0, -0.88, 0); put(g, box(0.6, 0.2, 0.58), M(0x26303a), 0, -0.76, 0); if (L.fam === 'goblin') put(g, box(0.4, 0.3, 0.04), M(L.trim), 0.1, -0.95, 0.3, 0, 0, 0.15); }
  if (L.fam !== 'elven' && L.fam !== 'infernal' && L.fam !== 'undead') { const r = new THREE.Group(); roof(r, L, 0.84, 0.56, 0); r.position.y = -0.58; g.add(r); }
  put(g, box(0.86, 0.1, 0.58), sc, 0, -1.02, 0);
  return g;
}

export function buildBalloonFor(L, side) { return tryBuild(AIR.buildBalloon, plainBalloon, L, side); }
function plainBalloon(L, side) {
  const g = new THREE.Group(), env = new THREE.Group(), main = L.envelope, pale = blend(main, 0xf2e6c8, 0.6), EY = 4.1, R = 1.7;
  const gores = (n, a, b, r = R, sy = 1.18) => { for (let i = 0; i < n; i++) put(env, new THREE.SphereGeometry(r, 5, 12, (i / n) * Math.PI * 2, (Math.PI * 2) / n, 0, Math.PI * 0.86), M(i % 2 ? a : b, { rough: 0.9, double: 1 })); env.scale.set(1, sy, 1); };
  const rope = M(0x2a2620), wick = M(0x8a6a3a, { rough: 0.95 });
  let basket = 'wicker', fire = L.glow;
  switch (L.fam) {
    case 'eastern': { // a great paper lantern, ribbed, with tassels
      put(env, cyl(1.2, 1.2, 2.4, 16), M(main, { rough: 0.8 }), 0, 0, 0).scale.set(1.15, 1, 1.15);
      for (const y of [-1.2, 1.2]) { const cap = put(env, ball(1.38, 16, 8), M(main, { rough: 0.8 }), 0, y * 0.98, 0); cap.scale.y = 0.35; put(env, cyl(0.6, 0.6, 0.16, 12), M(L.trim, { metal: 0.6, rough: 0.4 }), 0, y * 1.4, 0); }
      for (let i = 0; i < 6; i++) put(env, new THREE.TorusGeometry(1.4, 0.035, 5, 20), M(L.trim, { metal: 0.6 }), 0, -1.0 + i * 0.4, 0, Math.PI / 2);
      for (let i = 0; i < 4; i++) put(env, cyl(0.04, 0.01, 0.7, 5), M(L.trim), Math.cos(i * 1.57) * 1.3, -1.7, Math.sin(i * 1.57) * 1.3);
      break;
    }
    case 'elven': { gores(10, main, blend(main, L.trim, 0.5), 1.35, 1.75); for (let i = 0; i < 3; i++) { const fin = put(env, ball(0.6, 8, 6), M(L.cloth2, { double: 1 }), Math.cos(i * 2.09) * 1.2, -0.9, Math.sin(i * 2.09) * 1.2, 0, -i * 2.09, 0); fin.scale.set(0.9, 1.6, 0.08); } put(env, new THREE.OctahedronGeometry(0.22), M(L.glow, { glow: 1 }), 0, 2.5, 0); basket = 'swan'; break; }
    case 'dwarf': { gores(8, shade(main, 0.9), shade(main, 0.7), 1.75, 0.95); for (const y of [-0.6, 0, 0.6]) put(env, new THREE.TorusGeometry(Math.sqrt(1.75 * 1.75 - (y / 0.95) ** 2) + 0.02, 0.06, 6, 24), M(L.trim, { metal: 0.8, rough: 0.35 }), 0, y, 0, Math.PI / 2); basket = 'iron'; break; }
    case 'north': { gores(12, main, L.cloth2, 1.5, 1.2); const tip = put(env, cone(0.9, 1.6, 12), M(L.trim, { metal: 0.6, rough: 0.4 }), 0, 2.0, 0); tip.scale.set(1, 1, 1); put(env, ball(0.12), M(L.trim, { metal: 0.8 }), 0, 2.9, 0); break; }
    case 'desert': { gores(12, main, L.cloth2); put(env, new THREE.TorusGeometry(1.72, 0.07, 6, 24), M(L.trim, { metal: 0.8, rough: 0.35 }), 0, 0, 0, Math.PI / 2); for (let i = 0; i < 8; i++) put(env, cone(0.12, 0.4, 4), M(L.trim), Math.cos(i * 0.785) * 1.7, -0.3, Math.sin(i * 0.785) * 1.7, Math.PI); break; }
    case 'undead': { gores(9, 0x4a4a52, 0x33333a); for (let i = 0; i < 7; i++) { const rag = put(env, box(0.3, 0.9, 0.02), M(0x2a2a30, { double: 1 }), Math.cos(i * 0.9) * 1.1, -1.7, Math.sin(i * 0.9) * 1.1, 0, -i * 0.9, 0.15); rag.scale.y = 0.6 + (i % 3) * 0.3; } const sk = put(env, ball(0.5, 10, 8), M(L.trim), 0, 0.2, 1.55); sk.scale.set(0.9, 1.05, 0.5); for (const x of [-0.18, 0.18]) put(env, ball(0.1), M(L.glow, { glow: 1 }), x, 0.3, 1.78); basket = 'coffin'; break; }
    case 'infernal': { gores(8, 0x1c1c20, shade(main, 0.9)); for (let i = 0; i < 8; i++) put(env, cone(0.12, 0.6, 5), M(0x1c1c20, { metal: 0.6 }), Math.cos(i * 0.785) * 1.85, 0.1, Math.sin(i * 0.785) * 1.85, 0, 0, 0).lookAt(Math.cos(i * 0.785) * 9, 0.1, Math.sin(i * 0.785) * 9); put(env, new THREE.TorusGeometry(1.72, 0.06, 6, 24), M(L.glow, { glow: 1 }), 0, 0.1, 0, Math.PI / 2); basket = 'iron'; break; }
    case 'goblin': { const cols = [main, L.cloth2, L.trim, 0x8a3a2a, 0x4a6a6a, 0xb8a060]; for (let i = 0; i < 9; i++) put(env, new THREE.SphereGeometry(R, 5, 12, (i / 9) * Math.PI * 2, (Math.PI * 2) / 9, 0, Math.PI * 0.86), M(cols[(i * 5) % 6], { rough: 0.95, double: 1 })); env.scale.set(1.08, 1.05, 0.92); const lump = put(env, ball(0.7, 8, 6), M(cols[1], { rough: 0.95 }), 0.9, 1.0, 0.5); lump.scale.y = 0.8; for (let i = 0; i < 5; i++) put(env, box(0.4, 0.4, 0.02), M(cols[(i * 2 + 1) % 6], { double: 1 }), Math.cos(i * 1.3) * 1.74, -0.4 + (i % 3) * 0.5, Math.sin(i * 1.3) * 1.6, 0, -i * 1.3 + Math.PI / 2, 0.3); break; }
    case 'savage': { // a stitched hide bladder in a net of sinew, ribbed with bone
      const hc = L.hide ?? 0x8a6a4a; gores(7, shade(hc, 1.15), shade(hc, 0.9), 1.6, 1.1); env.scale.z = 0.92;
      for (let i = 0; i < 6; i++) put(env, new THREE.TorusGeometry(1.63, 0.03, 4, 18), M(0x3a2a1c), 0, 0, 0, 0, (i / 6) * Math.PI, 0);
      for (let i = 0; i < 6; i++) put(env, cone(0.07, 0.5, 5), M(0xe8e0c8), Math.cos(i * 1.05) * 1.5, -0.95, Math.sin(i * 1.05) * 1.5, Math.PI);
      put(env, box(0.9, 0.6, 0.02), M(side, { double: 1 }), 0, -0.2, 1.62);
      break;
    }
    default: gores(12, side, pale);
  }
  env.position.y = EY; g.add(env);
  if (L.fam !== 'eastern') { const skirt = new THREE.Mesh(cyl(0.75, 0.42, 0.7, 12).clone(), M(L.fam === 'default' ? side : shade(main, 0.8), { double: 1, rough: 0.9 })); skirt.geometry = new THREE.CylinderGeometry(0.75, 0.42, 0.7, 12, 1, true); skirt.position.y = 2.25; g.add(skirt); }
  // a band in the side's colour so nobody mistakes whose it is
  put(g, new THREE.TorusGeometry(L.fam === 'eastern' ? 1.42 : L.fam === 'elven' ? 1.1 : 1.6, 0.07, 6, 24), M(side), 0, EY - (L.fam === 'elven' ? 1.6 : 0.75), 0, Math.PI / 2);
  for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) put(g, cyl(0.015, 0.015, 1.5, 4), rope, x * 0.95, 1.2, z * 0.95);
  if (basket === 'iron') { put(g, box(1.05, 0.5, 1.05), M(shade(L.metal, 1.4), { metal: 0.5, rough: 0.5 }), 0, 0.25, 0); put(g, box(1.1, 0.07, 1.1), M(L.trim, { metal: 0.8, rough: 0.35 }), 0, 0.52, 0); }
  else if (basket === 'coffin') { put(g, box(1.3, 0.4, 0.7), M(0x2a2420), 0, 0.22, 0); put(g, box(1.34, 0.05, 0.74), M(L.trim), 0, 0.44, 0); }
  else if (basket === 'swan') { const hull = put(g, ball(0.6, 12, 8), M(L.wood), 0, 0.3, 0); hull.scale.set(1.2, 0.55, 0.8); put(g, cyl(0.05, 0.07, 0.7, 6), M(L.wood), 0.75, 0.6, 0, 0, 0, -0.5); put(g, ball(0.1), M(L.trim), 0.95, 0.95, 0); }
  else { put(g, box(1.0, 0.5, 1.0), wick, 0, 0.25, 0); put(g, box(1.06, 0.07, 1.06), M(0x5a4226), 0, 0.52, 0); }
  const f = put(g, cone(0.16, 0.5, 6), M(fire, { glow: 1 }), 0, 1.75, 0); f.castShadow = false;
  for (const z of [-0.56, 0.56]) put(g, box(0.22, 0.3, 0.16), M(0xb8a888), 0.2, 0.2, z);
  g.userData.fire = f;
  return g;
}

/** what a faction's line looks like on the ground */
/** a supply boat for the rivers, canals and straits: 'gondola', 'riverboat' or 'raft' (+x is the bow, origin on the water) */
export function buildVessel(L, side, kind) { return tryBuild(BOATS.buildBoat, plainBoat, L, side, kind); }
function plainBoat(L, side, kind) {
  const g = new THREE.Group(), wood = M(L.savage ? 0x6a4e30 : L.wood, { rough: 0.85 }), len = kind === 'gondola' ? 3.4 : kind === 'raft' ? 3 : 4.2, wide = kind === 'gondola' ? 0.9 : kind === 'raft' ? 1.6 : 1.5;
  if (kind === 'raft') for (let i = 0; i < 7; i++) put(g, cyl(0.12, 0.12, len, 8), wood, 0, 0.05, -wide / 2 + 0.12 + i * (wide - 0.24) / 6, 0, 0, Math.PI / 2);
  else {
    const hull = put(g, ball(0.5, 14, 8), wood, 0, 0.05, 0); hull.scale.set(len, 0.55, wide);
    put(g, box(len * 0.82, 0.05, wide * 0.8), M(shade(L.savage ? 0x6a4e30 : L.wood, 1.2)), 0, 0.3, 0);
    if (kind === 'gondola') { put(g, cyl(0.04, 0.06, 0.8, 6), wood, len / 2 - 0.1, 0.6, 0, 0, 0, -0.4); put(g, cyl(0.04, 0.06, 0.8, 6), wood, -len / 2 + 0.1, 0.6, 0, 0, 0, 0.4); }
    else { put(g, cyl(0.05, 0.05, 2.4, 6), wood, 0.3, 1.4, 0); put(g, box(0.04, 1.4, 1.3), M(L.cloth, { double: 1 }), 0.32, 1.6, 0); }
  }
  put(g, box(0.5, 0.3, 0.02), M(side, { double: 1 }), -len / 2 + 0.3, 0.9, 0);
  put(g, box(0.4, 0.3, 0.4), M(0xa07a4a), len * 0.3, 0.45, 0); put(g, box(0.36, 0.28, 0.36), M(0xa07a4a), -len * 0.3, 0.45, 0.1);
  g.userData.len = len; g.userData.deck = 0.32;
  g.userData.seats = [[-len * 0.4, 0], [-0.4, -0.25], [-0.4, 0.25], [0.2, -0.25], [0.2, 0.25], [0.6, 0]].map(([x, z]) => new THREE.Vector3(x, 0.32, z));
  return g;
}

export function trackLook(L) {
  if (L.savage) return { trail: true, bed: 0x7a6248, stake: L.hide ?? 0x6a4a32 };
  return { bed: L.fam === 'desert' ? 0xb8a070 : L.fam === 'infernal' || L.fam === 'undead' ? 0x3a3634 : 0x6f6a60, sleeper: L.fam === 'elven' ? 0xd8d0bc : L.fam === 'undead' ? 0xd8d0b8 : L.wood,
    rail: L.fam === 'elven' ? 0xd8c070 : L.fam === 'dwarf' ? 0x8a6a30 : L.fam === 'goblin' ? 0x7a5a40 : 0x4a4a50, glow: L.fam === 'infernal' ? L.glow : 0 };
}
