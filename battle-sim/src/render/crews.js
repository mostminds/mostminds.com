// Hands on deck: sailors standing on every ship's and airship's deck, as many as she has crew left (up to what
// her deck holds). The hands are the realm's own soldiers: each realm (and each of the original factions) sends
// two or three of the sculpted ground units of its roster to sea (see CREW below: deck hands, gunners and an
// officer), so a figure on deck is the very model that fights on land, scaled to the deck.
//
// How it stays cheap: a unit is built once (at a crew detail, see CREW_DETAIL), posed with the units' own
// animators (animate.js via animateUnit) plus a few deck poses on top (hauling, kneeling at the gun, bracing,
// cheering ...), and each pose is baked (rigkit.bakePose) into one static geometry per distance level. Every
// figure is then one instance in the instanced mesh of its (unit, pose, level) bucket; bakes happen lazily the
// first time a bucket is wanted, are cached for the whole session and shared by every ship. "Animation" is
// swapping a figure between pose buckets over time plus the bob, turn, lean and slide of its instance matrix.
// The level is picked per ship from the camera's distance, with caps on the close levels (LEVEL_CAP).
// Side colours: the cloth of each baked figure is marked per vertex (aSide) and takes the side's colour from the
// instance colour in the shader, keeping its shading (so a Graalish blue tabard turns red on the red side).
//
// The effects code tells a ship's hands what is happening to her with pulse():
//
//   const crews = new Crews(scene)
//   crews.track(model, key, { airship })   finds the deck (raycast from above) and its standing places, once per hull type
//   crews.update(list, t)                  list: [{ model, frac (0..1 of crew aboard), color, alive, def?, faction?, size? }]
//   crews.pulse(model, kind, opts?)        kind:
//       'fire'   her guns go off: the gunners at the rail kneel and aim, the rest flinch               (~1.2 s)
//       'brace'  she is about to be hit or rammed: every hand crouches and grabs hold               (~1.4 s)
//       'board'  grapnels are over: most hands rush the rail facing the enemy and lay about them,
//                then (if they hold) cheer. opts.toward: a world point (THREE.Vector3 or {x, z})
//                to rush toward; by default the nearest other ship in the last update list           (~3.5 s)
//       'cheer'  arms up and jumping                                                                (~2 s)
//     Calling it again while the reaction runs extends it. Safe to call for models it does not track.
import * as THREE from 'three';
import { REALMS } from '../data/realms.js';
import { UNITS } from '../data/units.js';
import { REALM_STYLE, styleOf } from './parts/realmStyle.js';
import { buildUnitModel, animateUnit } from './models.js';
import { DETAIL, getDetail, setDetail, bakePose } from './rigkit.js';
import { sculptMaterial } from './sculpt.js';

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
// The folk of each realm: palette, headgear and style (realmLook, used by the ship and flier fittings)
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// Who crews her: two or three sculpted ground units of the realm's own roster.
//   deck     the hands: a cheap melee trooper (marines, deckhands, corsairs first)
//   gun      at the guns: the realm's shot or bowmen (else a second kind of deck hand)
//   officer  one per ship: a captain, the realm's champion or its best foot soldier
// ---------------------------------------------------------------------------------------------
const OLD_CAT = { kingdom: 'Kingdom', goblin: 'Goblin Horde', undead: 'Undead', beasts: 'Beasts', elemental: 'Elemental', infernal: 'Infernal', dragons: 'Dragons' };
const FOOT = new Set(['humanoid', 'skeleton', 'naga']);
const SEA = /marine|deckhand|mariner|corsair|sailor|gunnery|harpoon/i;
const DECK_ARMS = new Set(['cutlass', 'sword', 'spear', 'axe', 'club', 'dagger', 'scimitar', 'cleaver', 'trident', 'javelin', 'khopesh', 'rapier', 'katana', 'warhammer', 'macuahuitl', 'claws']);
const GUNS = { handgun: 4, crossbow: 3.5, repeater: 3.5, blunderbuss: 4, axeGun: 4, longbow: 2, bow: 2, sling: 1.5, blowpipe: 1.5, javelin: 1, chakram: 1 };
const PREFER = { // where the roster's own choice is plain
  drowned: ['drowned_deckhand', 'drowned_gunnery', 'drowned_captain'], westmark: ['westmark_marine', 'westmark_shotW', 'westmark_leader'],
  pearlfleet: ['pearlfleet_mariner', 'pearlfleet_harpooner', 'pearlfleet_tridentGuard'], kaelneth: ['kaelneth_corsair', 'kaelneth_repeater', 'kaelneth_executioner'],
  skar: ['skar_clanrat', 'skar_jezzail', 'skar_stormrat'], grom: ['grom_warrior', 'grom_thunderer', 'grom_ironbreaker'],
  kingdom: ['militia', 'crossbow', 'footman'], goblin: ['goblin', 'goblinArcher', 'hobgoblin'], undead: ['skeleton', 'skeletonArcher', 'wight'],
  infernal: ['cultist', 'hellknight', 'infernal_leader'], dragons: ['kobold', 'dragonKnight', 'dragons_leader'], beasts: ['minotaur', 'troll', 'beasts_leader'],
  elemental: ['golem', 'fireElemental', 'stormElemental'], crimson: ['crimson_zombie', 'crimson_rustSkel', 'crimson_vampire'],
  khemet: ['khemet_skelSpear', 'khemet_skelBow', 'khemet_tombGuard'], shogunate: ['shogunate_ashigaru', 'shogunate_teppo', 'shogunate_samurai'],
};
const crewPick = new Map();
/** [{ id, role }] for a realm or original faction id */
function crewOf(rid) {
  if (crewPick.has(rid)) return crewPick.get(rid);
  const all = Object.entries(UNITS).filter(([, u]) => (OLD_CAT[rid] ? u.category === OLD_CAT[rid] && !u.realm : u.realm === rid));
  const ok = ([, u]) => !u.fly && FOOT.has(u.model?.body || 'humanoid') && (u.size || 1) <= 2;
  let foot = all.filter(ok);
  if (!foot.length) foot = all.filter(([, u]) => !u.fly && (u.size || 1) <= 2 && u.model?.body !== 'rider' && u.model?.body !== 'quadruped');
  if (!foot.length) { const k = crewOf('kingdom'); crewPick.set(rid, k); return k; }
  const small = (u) => ((u.size || 1) > 1 ? -3 : 0);
  const w = (u) => u.model?.weapon || '';
  const best = (score, not = []) => { let b = null, bs = -1e9; for (const [id, u] of foot) { if (not.includes(id)) continue; const s = score(id, u); if (s > bs) { bs = s; b = id; } } return b; };
  const pref = (PREFER[rid] || []).filter((id) => UNITS[id] && foot.some(([f]) => f === id));
  const deck = pref[0] || best((id, u) => (SEA.test(id) ? 6 : 0) + (DECK_ARMS.has(w(u)) ? 2 : 0) + (u.style === 'melee' ? 2 : -4) + small(u) - u.hp / 60 - (/leader/.test(id) ? 5 : 0));
  const gun = pref[1] || best((id, u) => (u.style === 'ranged' ? 4 + (GUNS[w(u)] || 0) : -9) + (SEA.test(id) ? 3 : 0) + small(u), [deck]);
  const officer = pref[2] || best((id, u) => (/captain/i.test(id) ? 8 : /leader/.test(id) ? 4 : 0) + (u.style === 'melee' ? 2 : -2) + u.hp / 40 + small(u) * 2 - (w(u) === 'staff' ? 3 : 0), [deck, gun]);
  const out = [{ id: deck, role: 'deck' }];
  if (gun && UNITS[gun].style === 'ranged') out.push({ id: gun, role: 'gun' });
  if (officer && officer !== deck) out.push({ id: officer, role: 'officer' });
  crewPick.set(rid, out);
  return out;
}
/** the realm (or original faction) id a crew list entry belongs to */
const ridCache = new Map();
function ridOf(def, faction) {
  const key = `${(def && (def.realm || def.faction || def.id)) || ''}|${faction || ''}`;
  let r = ridCache.get(key);
  if (r) return r;
  for (const id of [def && def.realm, def && def.faction, faction]) if (id && (REALM.has(id) || OLD[id])) { r = id; break; }
  if (!r && def && def.id) { const pre = String(def.id).split(/_|(?=[A-Z])/)[0]; r = REALM.has(pre) || OLD[pre] ? pre : OLD_IDS.find((k) => def.id.startsWith(k)); }
  r ||= 'kingdom';
  ridCache.set(key, r);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Building and baking. A crew figure is built at its own detail (cells per unit for the three levels) and
// stands DECK_H tall (a man; dwarves and goblins shorter, ogres capped at TALL times that).
// ---------------------------------------------------------------------------------------------
DETAIL.crew = [56, 22, 9];
const CREW_DETAIL = 'crew', LEVELS = 3;
const DECK_H = 0.64, TALL = 1.3;
const NEAR = 16, MID = 46;                 // camera distance (world units) below which a ship's hands use level 0 / 1
const LEVEL_CAP = [40, 200];              // most figures drawn at level 0 / level 1 in one frame (the rest drop a level)
const BAKES_PER_FRAME = 6;
const POSES = ['stand', 'stand2', 'walk1', 'walk2', 'haul1', 'haul2', 'gun', 'brace', 'atk1', 'atk2', 'cheer1', 'cheer2', 'look', 'work'];
// what a pose falls back to on the cheaper levels (so far ships use few buckets)
const DOWN = [{}, { look: 'stand2', work: 'haul2' }, { stand2: 'stand', walk2: 'walk1', haul2: 'haul1', atk1: 'atk2', cheer2: 'cheer1', look: 'stand', work: 'haul1' }];

const units = new Map();   // unit id -> { def, state: 'new' | 'ready' | 'failed', model, scale, cloth, ranged }
const baked = new Map();   // `${id}|${pose}|${level}` -> geometry (or null when it could not be baked)
const add = (o, x = 0, y = 0, z = 0) => { if (o) { o.rotation.x += x; o.rotation.y += y; o.rotation.z += z; } };
const LR = (L, i) => L && L[i];

function buildCrewUnit(id) {
  const def = UNITS[id];
  const prev = getDetail();
  setDetail(CREW_DETAIL);
  let m = null;
  try { m = buildUnitModel(def); } finally { setDetail(prev); }
  if (!m || !m.userData.lod || !m.userData.rig) return null;
  const rig = m.userData.rig;
  // stature: the top of the head over the feet (the weapon does not count)
  animateUnit(m, 0.4, false, -1, 0, 0, false);
  m.updateMatrixWorld(true);
  const hv = new THREE.Vector3();
  let top = rig.height || 1;
  if (rig.head) { rig.head.getWorldPosition(hv); top = hv.y * 1.1 + 0.04; }
  const human = 1.05; // a man's head top in model units
  let scale = (DECK_H / human);
  if (top * scale > DECK_H * TALL) scale = (DECK_H * TALL) / top;
  const cloth = new THREE.Color(def.model?.cloth ?? 0x7a6a4f);
  return { def, state: 'ready', model: m, scale, cloth, ranged: def.style === 'ranged', rest: restOf(m) };
}
function restOf(m) {
  const list = [];
  m.traverse((o) => { const r = o.userData && o.userData.rest; if (r) list.push([o, r]); });
  return list;
}

/** pose the unit's model for one named deck pose */
function setPose(U, name) {
  const m = U.model, rig = m.userData.rig, inner = m.userData.inner;
  for (const [o, r] of U.rest) { o.rotation.set(r[0], r[1], r[2]); o.position.set(r[3], r[4], r[5]); }
  if (inner) { inner.position.set(0, 0, 0); inner.rotation.set(0, 0, 0); }
  const A = rig.arms, F = rig.forearms, L = rig.legs, S = rig.shins, T = rig.torso, Hd = rig.head;
  const W1 = (2 * Math.PI) / 9.5;
  switch (name) {
    case 'walk1': animateUnit(m, W1 * 0.25, true, -1, 0); break;
    case 'walk2': animateUnit(m, W1 * 0.75, true, -1, 0); break;
    case 'atk1': animateUnit(m, 0.4, false, 0.36, 0); break;
    case 'atk2': animateUnit(m, 0.4, false, 0.56, 0); add(T, 0.1); break;
    case 'gun': animateUnit(m, 0.4, false, U.ranged ? 0.5 : -1, 0); break;
    default: animateUnit(m, name === 'stand2' ? 2.3 : 0.4, false, -1, 0);
  }
  switch (name) {
    case 'stand2': add(Hd, 0, 0.55); add(T, 0, 0.18); break;
    case 'haul1': for (const i of [0, 1]) { add(LR(A, i), -2.6, 0, i ? -0.1 : 0.1); add(LR(F, i), -0.25); } add(T, -0.12); add(LR(L, 0), -0.35); add(LR(L, 1), 0.25); add(Hd, -0.25); break;
    case 'haul2': for (const i of [0, 1]) { add(LR(A, i), -1.35, 0, i ? 0.15 : -0.15); add(LR(F, i), -1.1); } add(T, -0.38); add(LR(L, 0), -0.55); add(LR(S, 0), 0.3); add(LR(L, 1), 0.35); break;
    case 'gun': // down on one knee at the rail
      add(LR(L, 0), -1.35); add(LR(S, 0), 1.4); add(LR(L, 1), 0.2); add(LR(S, 1), 1.75); add(T, U.ranged ? 0.05 : 0.2);
      if (!U.ranged) { add(LR(A, 1), -0.5); add(LR(A, 0), -0.4); }
      break;
    case 'brace':
      for (const i of [0, 1]) { add(LR(L, i), -0.95); add(LR(S, i), 1.55); add(LR(A, i), -0.95, 0, i ? -0.45 : 0.45); add(LR(F, i), -0.6); }
      add(T, 0.45); add(Hd, -0.3); break;
    case 'cheer1': for (const i of [0, 1]) { add(LR(A, i), -2.85, 0, i ? -0.32 : 0.32); add(LR(F, i), -0.15); } add(T, -0.12); add(Hd, -0.35); break;
    case 'cheer2': add(LR(A, 1), -3.0, 0, -0.15); add(LR(A, 0), -1.7, 0, 0.6); add(LR(F, 0), -1.2); add(LR(L, 0), -0.6); add(LR(S, 0), 1.0); add(Hd, -0.25); break;
    case 'look': add(LR(A, 0), -2.0, 0, 0.45); add(LR(F, 0), -2.0); add(Hd, -0.12, 0.35); add(T, 0, 0.2); break;
    case 'work': add(T, 0.7); for (const i of [0, 1]) { add(LR(A, i), -0.85, 0, i ? 0.1 : -0.1); add(LR(F, i), -0.5); add(LR(L, i), -0.3); add(LR(S, i), 0.55); } break;
    // riders (fliers.js): astride, cross-legged, slung from lines
    case 'sit': for (const i of [0, 1]) { add(LR(L, i), -1.45, 0, i ? -0.42 : 0.42); add(LR(S, i), 1.35); add(LR(A, i), -0.75, 0, i ? 0.12 : -0.12); add(LR(F, i), -0.7); } add(T, 0.12); break;
    case 'cross': for (const i of [0, 1]) { add(LR(L, i), -1.5, 0, i ? -1.0 : 1.0); add(LR(S, i), 2.3); add(LR(A, i), -0.5, 0, i ? 0.1 : -0.1); add(LR(F, i), -0.9); } break;
  }
  m.updateMatrixWorld(true);
}

/** the side mask of a baked figure: 1 on its cloth, 0 elsewhere (from the vertex colours) */
function sideMask(geo, cloth) {
  const col = geo.attributes.color, n = col.count, out = new Float32Array(n);
  const cs = cloth.r + cloth.g + cloth.b + 1e-4, cr = cloth.r / cs, cg = cloth.g / cs, cb = cloth.b / cs;
  const sat = Math.max(cloth.r, cloth.g, cloth.b) - Math.min(cloth.r, cloth.g, cloth.b);
  const tol = sat > 0.08 ? 0.075 : 0.03, lo = sat > 0.08 ? 0.3 : 0.6, hi = sat > 0.08 ? 2.2 : 1.5;
  for (let i = 0; i < n; i++) {
    const r = col.getX(i), g = col.getY(i), b = col.getZ(i), s = r + g + b + 1e-4;
    const d = Math.abs(r / s - cr) + Math.abs(g / s - cg) + Math.abs(b / s - cb), k = s / cs;
    if (k < lo || k > hi || d > tol) continue;
    out[i] = Math.min(1, (tol - d) / (tol * 0.5)) * 0.85;
  }
  geo.setAttribute('aSide', new THREE.BufferAttribute(out, 1));
}

/**
 * A rider for fliers.js: one of the realm's crew units (its deck hand) baked in a riding pose, as geometries for
 * the three crew levels, facing +z. pose: sit | cross (seat at the origin), stand | hang (feet at the origin), prone.
 * The cloth takes the side colour. Returns { geos: [near, mid, far], height } (height: the head's top above the
 * origin) or null when the realm's crew cannot be built. Built synchronously on first use and cached.
 */
const riders = new Map();
export function riderFigure(realm, pose = 'sit', sideColor = 0xcccccc) {
  const rid = REALM.has(realm) || OLD[realm] ? realm : 'kingdom';
  const key = `${rid}|${pose}|${sideColor}`;
  if (riders.has(key)) return riders.get(key);
  let out = null;
  try {
    const crew = crewOf(rid), id = (crew.find((c) => c.role === 'deck') || crew[0]).id;
    let U = units.get(id);
    if (!U) { U = buildCrewUnit(id) || { state: 'failed' }; units.set(id, U); }
    if (U.state === 'ready') {
      const P = { sit: 'sit', cross: 'cross', stand: 'stand', hang: 'haul1', prone: 'stand' }[pose] || 'stand';
      setPose(U, P);
      const rig = U.model.userData.rig, hip = new THREE.Vector3(), v = new THREE.Vector3();
      if (rig.legs && rig.legs.length) { for (const l of rig.legs) hip.add(l.getWorldPosition(v)); hip.multiplyScalar(1 / rig.legs.length); } else if (rig.torso) rig.torso.getWorldPosition(hip);
      const seat = P === 'sit' || P === 'cross';
      const tint = new THREE.Color(sideColor);
      const geos = [];
      for (let lv = 0; lv < LEVELS; lv++) {
        const g = bakePose(U.model, lv);
        if (!g) { geos.push(geos[lv - 1] || null); continue; }
        g.computeBoundingBox();
        g.translate(-hip.x, seat ? -hip.y : -g.boundingBox.min.y, -hip.z);
        if (pose === 'prone') g.rotateX(Math.PI / 2 - 0.1).translate(0, 0.05, 0);
        g.scale(U.scale, U.scale, U.scale);
        sideMask(g, U.cloth);
        const col = g.attributes.color, m = g.attributes.aSide;
        for (let i = 0; i < col.count; i++) {
          const k = m.getX(i);
          if (!k) continue;
          const r = col.getX(i), gg = col.getY(i), b = col.getZ(i), lum = r * 0.3 + gg * 0.59 + b * 0.11, tl = Math.max(0.05, tint.r * 0.3 + tint.g * 0.59 + tint.b * 0.11) / lum;
          col.setXYZ(i, r + (Math.min(1.2, tint.r / tl * 1.15) - r) * k, gg + (Math.min(1.2, tint.g / tl * 1.15) - gg) * k, b + (Math.min(1.2, tint.b / tl * 1.15) - b) * k);
        }
        g.deleteAttribute('aSide');
        g.computeBoundingBox(); g.computeBoundingSphere();
        geos.push(g);
      }
      if (geos[0]) out = { geos, height: geos[0].boundingBox.max.y };
    }
  } catch (err) { console.warn(`crews: no rider for ${realm}`, err); out = null; }
  riders.set(key, out);
  return out;
}
/** the humanoid model description of a realm's deck hand (for bodies that seat their own rider: carpets, flies, pegasi) */
export function riderDress(realm) {
  const rid = REALM.has(realm) || OLD[realm] ? realm : 'kingdom';
  const crew = crewOf(rid), d = UNITS[(crew.find((c) => c.role === 'deck') || crew[0]).id];
  const m = d.model && d.model.body === 'humanoid' ? d.model : UNITS.militia.model;
  return { ...m, body: 'humanoid' };
}

function bakeBucket(id, pose, level) {
  const key = `${id}|${pose}|${level}`;
  if (baked.has(key)) return baked.get(key);
  const U = units.get(id);
  let g = null;
  try {
    setPose(U, pose);
    g = bakePose(U.model, level);
    if (g) {
      g.computeBoundingBox();
      g.translate(0, -g.boundingBox.min.y, 0); // stand on the deck whatever the pose
      sideMask(g, U.cloth);
      g.computeBoundingSphere();
    }
  } catch (err) { console.warn(`crews: could not bake ${key}`, err); g = null; }
  baked.set(key, g);
  return g;
}

let crewMat = null;
/** the sculpt material, with the instance colour painted over the cloth (aSide) instead of over everything */
function crewMaterial() {
  if (crewMat) return crewMat;
  const m = sculptMaterial().clone();
  const pbr = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    pbr.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSide;')
      .replace('#include <color_vertex>', `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  {
    float lum = dot( vColor, vec3( 0.3, 0.59, 0.11 ) );
    vec3 tint = instanceColor.xyz * ( lum / max( 0.05, dot( instanceColor.xyz, vec3( 0.3, 0.59, 0.11 ) ) ) );
    vColor = mix( vColor, min( tint * 1.15, vec3( 1.2 ) ), aSide );
  }
#endif`);
  };
  m.customProgramCacheKey = () => 'sculpt-crew';
  crewMat = m;
  return m;
}

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

const _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export class Crews {
  constructor(scene, max = 1600) {
    this.max = max; this.scene = scene;
    this.buckets = new Map(); // `${id}|${pose}|${level}` -> { mesh, n }
    this.t = 0; this.state = new WeakMap(); this.last = null; this.scale = 1;
    // where the camera is: read from the renderer as it draws (a drawless probe), so update() can pick levels
    this.eye = new THREE.Vector3(0, 40, 40); this.sawEye = false;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.probe = new THREE.Mesh(pg, new THREE.MeshBasicMaterial());
    this.probe.frustumCulled = false; this.probe.castShadow = false; this.probe.userData.noCrew = true;
    this.probe.onBeforeRender = (r, s, cam) => { if (cam && cam.isPerspectiveCamera) { this.eye.setFromMatrixPosition(cam.matrixWorld); this.sawEye = true; } };
    scene.add(this.probe);
    this.stats = { figures: 0, buckets: 0, levels: [0, 0, 0] };
    this.forceLevel = null; // tests and previews: every figure at this level
  }
  dispose() {
    for (const b of this.buckets.values()) this._drop(b.mesh);
    this.buckets.clear();
    if (this.probe) { this.probe.parent && this.probe.parent.remove(this.probe); this.probe.geometry.dispose(); this.probe.material.dispose(); this.probe = null; }
  }
  _drop(mesh) { mesh.parent && mesh.parent.remove(mesh); mesh.dispose(); } // geometry is the shared bake: kept
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
  /** the crew units of a realm, built on demand (at most one new unit per frame) */
  _crew(rid, budget) {
    const out = [];
    for (const { id, role } of crewOf(rid)) {
      let U = units.get(id);
      if (!U) {
        if (budget.builds <= 0) continue;
        budget.builds--;
        let built = null;
        try { built = buildCrewUnit(id); } catch (err) { console.warn(`crews: could not build ${id}`, err); }
        U = built || { state: 'failed' };
        units.set(id, U);
      }
      if (U.state === 'ready') out.push({ id, role, U });
    }
    return out;
  }
  /** the instanced mesh of one bucket, baking it if the frame's budget allows; null if not ready */
  _bucket(id, pose, level, budget) {
    const key = `${id}|${pose}|${level}`;
    let b = this.buckets.get(key);
    if (b && b.n < b.cap) return b;
    if (!b) {
      if (!baked.has(key)) { if (budget.bakes <= 0) return null; budget.bakes--; }
      const geo = bakeBucket(id, pose, level);
      if (!geo) return null;
      b = { mesh: null, n: 0, cap: 0, geo, level };
      this.buckets.set(key, b);
    }
    if (b.n >= b.cap) {
      // grow: a fresh instanced mesh with room for twice as many (this frame's instances so far are copied over)
      const cap = Math.max(16, b.cap * 2), old = b.mesh;
      const mesh = new THREE.InstancedMesh(b.geo, crewMaterial(), cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, _c.set(0xffffff));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; mesh.castShadow = level < 2; mesh.receiveShadow = level === 0;
      mesh.userData.noCrew = true;
      if (old) { mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, b.n * 16)); mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, b.n * 3)); this._drop(old); }
      this.scene.add(mesh);
      b.mesh = mesh; b.cap = cap;
    }
    return b;
  }
  /** a figure into its pose bucket (falling back to a pose that is ready, then to a cheaper level) */
  _put(F, pose, level, mat, color, budget) {
    for (let lv = level; lv < LEVELS; lv++) {
      const p = DOWN[lv][pose] || pose;
      const b = this._bucket(F.id, p, lv, budget) || this._bucket(F.id, DOWN[lv].stand2 || 'stand', lv, budget) || this._bucket(F.id, 'stand', lv, budget);
      if (!b) continue;
      const n = b.n++;
      b.mesh.setMatrixAt(n, mat); b.mesh.setColorAt(n, color);
      this.stats.levels[lv]++;
      return true;
    }
    return false;
  }
  update(list, t) {
    this.t = t; this.last = list;
    for (const b of this.buckets.values()) b.n = 0;
    this.stats.levels = [0, 0, 0];
    const budget = { builds: 1, bakes: BAKES_PER_FRAME };
    // nearest ships first, so the close levels go to the hands the camera can see best
    const order = [];
    for (const it of list) {
      const m = it.model, slots = m && m.userData.crewSlots;
      if (!slots || !slots.length || !it.alive || m.visible === false) continue;
      // a plain role ship learns her faction from the first list that names it (see fleetDress.dressRole)
      if (it.faction && m.userData.styleFaction) { const f = m.userData.styleFaction; m.userData.styleFaction = null; f(it.faction); }
      m.getWorldPosition(_v);
      order.push({ it, d: _v.distanceTo(this.eye) });
    }
    order.sort((a, c) => a.d - c.d);
    let total = 0;
    const used = [0, 0];
    for (const { it, d } of order) {
      const m = it.model, slots = m.userData.crewSlots;
      const crew = this._crew(ridOf(it.def, it.faction), budget);
      if (!crew.length) continue;
      const deck = crew.find((c) => c.role === 'deck') || crew[0], gun = crew.find((c) => c.role === 'gun') || deck, officer = crew.find((c) => c.role === 'officer');
      const k = Math.min(slots.length, Math.ceil(slots.length * Math.max(0, Math.min(1, it.frac))));
      let level = this.forceLevel ?? (d < NEAR * (it.size || 1) ? 0 : d < MID * (it.size || 1) ? 1 : 2);
      while (level < 2 && this.forceLevel == null && used[level] + k > LEVEL_CAP[level]) level++;
      if (level < 2) used[level] += k;
      const J = jobsOf(slots), S = this.state.get(m);
      const fireK = S ? 1 - ease((t - S.fire) / FIRE) : 0, braceK = S ? 1 - ease((t - S.brace - BRACE * 0.6) / (BRACE * 0.4)) * (t - S.brace > 0 ? 1 : 0) : 0;
      const bAge = S ? t - S.board : 99, rush = S && bAge < BOARD ? ease((t - S.boardFrom) / 0.5) * (1 - ease((bAge - BOARD + 0.6) / 0.6)) : 0;
      const cheerAge = S ? Math.min(t - S.cheer, bAge - BOARD + 0.3) : 99;
      m.updateMatrixWorld();
      const color = _c.set(it.color ?? 0xcccccc);
      for (let i = 0; i < k && total < this.max; i++) {
        const p = slots[i], jb = J[i], r = jb.r;
        const F = i === 0 && officer && k >= 4 ? officer : jb.job === 'gun' ? gun : deck;
        // the pose: where it stands, which way it faces, how it leans, and which baked pose it is in
        let x = p[0], z = p[2], face = jb.face + Math.sin(t * 0.3 + i) * 0.25, lean = 0, bob = 0, pose = 'stand';
        const slow = Math.floor(t / 2.7 + r * 9);
        switch (jb.job) {
          case 'haul': { const w = Math.sin(t * 2.2 + r * 6); face = Math.PI * 0.5 * (r < 0.19 ? 1 : -1); pose = w > 0 ? 'haul1' : 'haul2'; bob = Math.abs(w) * 0.008; break; }
          case 'work': { const w = Math.sin(t * 1.7 + r * 6); pose = w > -0.3 ? 'work' : 'haul2'; lean = w * 0.04; break; }
          case 'look': { face = jb.out > 0 ? r * 2 : Math.PI + r * 2; pose = 'look'; break; }
          case 'gun': { face = (jb.out > 0 ? 0 : Math.PI) + (r - 0.5) * 0.6; pose = fireK > 0.05 ? 'gun' : slow % 4 === 0 ? 'stand2' : 'stand'; break; }
          default: pose = slow % 3 === 0 ? 'stand2' : (slow + i) % 7 === 0 ? 'look' : 'stand'; bob = Math.abs(Math.sin(t * 3 + i * 1.7)) * 0.006;
        }
        if (jb.job !== 'gun' && fireK > 0.6) lean += (fireK - 0.6) * 0.35; // the others flinch at the guns
        if (braceK > 0.25) { pose = 'brace'; lean = 0; }
        // a boarding rush: most hands run to the rail that faces the enemy, then lay about them there
        if (rush > 0 && r < 0.8) {
          const side = S.side, u = rush;
          const tz = side * jb.rail, tx = p[0] + (r - 0.5) * 0.4;
          x = p[0] + (tx - p[0]) * u; z = p[2] + (tz - p[2]) * u;
          const run = u > 0.02 && u < 0.98;
          face = (side > 0 ? 0 : Math.PI) + (r - 0.4) * 0.5;
          if (run) { pose = Math.sin(t * 14 + i) > 0 ? 'walk1' : 'walk2'; lean = 0.12; bob = Math.abs(Math.sin(t * 14 + i)) * 0.03; }
          else { pose = Math.sin(t * 5 + r * 9) > 0 ? 'atk1' : 'atk2'; lean = 0; bob = 0; }
        }
        if (cheerAge > 0 && cheerAge < CHEER && r > 0.3) {
          pose = Math.sin(t * 6 + i * 2) > 0 ? 'cheer1' : 'cheer2'; lean = 0;
          bob = Math.max(0, Math.sin(t * 9 + i * 1.3)) * 0.06;
        }
        // compose: deck place -> facing -> lean about the feet -> size
        const s = this.scale * (it.size || 1) * F.U.scale * (1 + (((i * 53) % 7) / 7 - 0.5) * 0.06);
        _e.set(lean, face, 0, 'YXZ'); _q.setFromEuler(_e);
        _b.compose(_v.set(x, p[1] + bob, z), _q, _s.set(s, s, s));
        _m.multiplyMatrices(m.matrixWorld, _b);
        if (this._put(F, pose, level, _m, color, budget)) total++;
      }
    }
    let nb = 0;
    for (const b of this.buckets.values()) {
      const mesh = b.mesh;
      mesh.count = b.n; mesh.visible = b.n > 0;
      if (!b.n) continue;
      nb++;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.stats.figures = total; this.stats.buckets = nb;
  }
}
