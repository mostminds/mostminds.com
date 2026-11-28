// Deck weapons, buildings, stores and the dressing along her rails and flanks (see ../shipParts.js for `c`).
// Each part is { size, fn }: big things (size 3) are placed first and take the middle of the deck.
//
// Detail tiers. Static shapes go into one of four kits, all merged per ship:
//   c.kit  always drawn (the silhouette)        mid   LOD levels 0-2 (mouldings, brackets, railings, glyphs)
//   fine   LOD levels 0-1 (rivets, tiles, bark) lo    LOD levels 3-5 only (cheap stand-ins for what mid draws)
// Moving parts are a coarse mesh of their own with mid/fine children registered in the same LOD table
// (model.userData.lod, see ../rigkit.js setLod). Each part is drawn in its realm's manner (STY below: metal,
// timber, stone, roof form, finial, emblem motif, glow) on top of the design's own hull/sail/trim colours.
//
// Action hooks (see the shared contract): parts add to model.userData.actions[name] = (k, model) => void,
// chained after whatever was there; k runs 0..1 and every hook leaves its part at rest at k = 1.
//   fire     turrets / repeater / bombard / pumpCannon recoil, ballista loose, lens and crystal discharge
//   mortar   trebuchet and catapult throw, mortar recoil, rockets flare out, lens / crystal / mirror beam charge
//   harpoon  harpoon gun recoil and reload, winch drum pays out
//   launch   cranes swing, flight-deck shuttle runs, pad lights   flak  turrets and repeaters elevate and fire
//   aura     cauldron surge, obelisk / monolith / stones glow, portal flare, organ pipes, mirrors, drums, braziers,
//            lanterns, astrolabe spin-up, bells swing             board portal flare, crane gangway swing
//   hit      bells clang, cages swing, turrets jolt
// Anchors: model.userData.anchors gets mortar / harpoon / launch / aura points where a part makes one.
import * as THREE from 'three';
import { Kit, G, C, shade, blend, clamp, lerp, EMPTY_GEO } from './kit.js';
import { styleOf, emblem as rsEmblem, finial as rsFinial, lantern as rsLantern, banner as rsBanner } from './realmStyle.js';
import { buildFlier } from '../fleetDress.js';
import { REALMS } from '../../data/realms.js';
import { UNITS } from '../../data/units.js';
import { buildUnitModel, animateUnit } from '../models.js';
import { DKit, groundShade, figureGeo, useUnits, attachDamage, hooks, entryOf, entryMesh } from './deckKit.js';
import { HI } from './deckHi.js';

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const PI = Math.PI;
const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);

// ====================================================================================================
// realm style
// ====================================================================================================
const MET = {
  gilt: [0xd4a83a, 0.85, 0.3], gold: [0xe0b84a, 0.9, 0.25], bronze: [0xb07a3a, 0.8, 0.35], brass: [0xc89a48, 0.8, 0.3],
  iron: [0x3e3e46, 0.6, 0.45], black: [0x202028, 0.65, 0.4], silver: [0xd0d4dc, 0.85, 0.22], rust: [0x6a3a22, 0.35, 0.85],
  bone: [0xd8cfb4, 0, 0.7], jade: [0x3a9a6a, 0.15, 0.3], pearl: [0xf0e8e0, 0.3, 0.2],
};
const WOOD = { oak: 0x6b4a2e, dark: 0x3a2618, pale: 0x9a7a54, red: 0x8a1a14, black: 0x1c1616, rot: 0x4a4a38, living: 0x5a4628, bog: 0x3a3626, hide: 0x8a6a4a, ash: 0x4a4644, teak: 0x7a4a26 };
const STONE = { white: 0xe8e0d0, sand: 0xd8c08a, grey: 0x8f8a7c, dark: 0x3a3836, red: 0xa05a40, green: 0x5a7a5a, ash: 0x6a6460, clay: 0xb07a50, coral: 0xe8b0a0 };
// realm: [metal, timber, stone, roof, finial, motif, glow, crude]
const STY = {
  graal: ['gilt', 'oak', 'white', 'spire', 'cup', 'lily', 0xffd88a],
  aurelia: ['brass', 'oak', 'grey', 'gable', 'orb', 'star', 0xffc86a],
  aethel: ['silver', 'pale', 'white', 'spire', 'crystal', 'rune', 0x8ad8ff],
  kaelneth: ['black', 'black', 'dark', 'spire', 'spike', 'spike', 0xb04aff],
  verdant: ['bronze', 'living', 'green', 'leaf', 'leaf', 'leaf', 0x9aff6a],
  grom: ['gold', 'dark', 'grey', 'flat', 'orb', 'rune', 0xffa040],
  xibalba: ['jade', 'teak', 'sand', 'flat', 'sun', 'sun', 0x6affb0],
  velikaya: ['gold', 'oak', 'white', 'onion', 'orb', 'star', 0xffd27a],
  tianlong: ['gold', 'red', 'grey', 'curved', 'pearl', 'dragon', 0xffb04a],
  ironbound: ['black', 'dark', 'dark', 'flat', 'spike', 'horn', 0xff6a1a],
  screaming: ['brass', 'dark', 'red', 'spire', 'horn', 'eye', 0xff3a2a],
  cloven: ['bone', 'hide', 'grey', 'hide', 'horn', 'horn', 0xff8a3a, 1],
  fimbul: ['iron', 'pale', 'grey', 'gable', 'horn', 'rune', 0x8ad8ff, 1],
  ashur: ['bronze', 'dark', 'sand', 'flat', 'flame', 'flame', 0xff7a2a],
  greenhide: ['rust', 'oak', 'grey', 'hide', 'spike', 'tusk', 0xff8a2a, 1],
  skar: ['rust', 'rot', 'dark', 'hide', 'spike', 'claw', 0x8aff3a, 1],
  crimson: ['black', 'black', 'dark', 'spire', 'spike', 'wing', 0xff2a3a],
  khemet: ['gold', 'teak', 'sand', 'flat', 'sun', 'scarab', 0x4affd8],
  drowned: ['rust', 'rot', 'green', 'gable', 'skull', 'wave', 0x6affb0],
  gorge: ['bone', 'hide', 'grey', 'hide', 'horn', 'horn', 0xff8a3a, 1],
  westmark: ['iron', 'oak', 'grey', 'gable', 'orb', 'star', 0xffc86a],
  principalities: ['gilt', 'teak', 'white', 'gable', 'orb', 'lily', 0xffd88a],
  sunkings: ['gold', 'pale', 'sand', 'dome', 'sun', 'sun', 0xffd84a],
  caliphate: ['gold', 'teak', 'white', 'dome', 'crescent', 'star', 0x6ad8ff],
  shogunate: ['black', 'black', 'white', 'curved', 'pearl', 'mon', 0xffb04a],
  mistisles: ['bronze', 'bog', 'grey', 'thatch', 'spiral', 'spiral', 0x9affd8],
  thousandgods: ['gold', 'teak', 'red', 'tiered', 'lotus', 'lotus', 0xffb04a],
  kharnak: ['brass', 'dark', 'red', 'flat', 'skull', 'skull', 0xff3a1a],
  morbus: ['rust', 'rot', 'green', 'gable', 'pustule', 'eye', 0x9aff3a],
  labyrinth: ['silver', 'pale', 'white', 'spire', 'crystal', 'eye', 0xff6ad8],
  velvet: ['gilt', 'dark', 'white', 'dome', 'pearl', 'lotus', 0xff6ab0],
  malvash: ['black', 'black', 'dark', 'flat', 'spike', 'gear', 0xff6a1a],
  ashhorde: ['iron', 'ash', 'ash', 'spire', 'horn', 'flame', 0xff5a2a],
  balor: ['bronze', 'bog', 'green', 'thatch', 'eye', 'eye', 0x9aff6a, 1],
  kurgan: ['bronze', 'hide', 'grey', 'hide', 'horn', 'horn', 0xffa040, 1],
  hearthmoot: ['brass', 'oak', 'grey', 'thatch', 'orb', 'leaf', 0xffd27a],
  baobab: ['bronze', 'teak', 'clay', 'thatch', 'sun', 'sun', 0xffb04a, 1],
  nagavar: ['gold', 'red', 'red', 'curved', 'flame', 'lotus', 0xff3a3a],
  pearlfleet: ['pearl', 'pale', 'coral', 'dome', 'pearl', 'shell', 0x8af0ff],
  glimmer: ['brass', 'oak', 'grey', 'gable', 'gear', 'gear', 0xffc86a],
  khanate: ['bronze', 'red', 'grey', 'hide', 'trident', 'sun', 0xffa040, 1],
  emerald: ['jade', 'teak', 'green', 'curved', 'lotus', 'lotus', 0x6affb0],
  deeproot: ['bronze', 'living', 'green', 'leaf', 'leaf', 'leaf', 0xffc84a],
  goldsands: ['gold', 'pale', 'sand', 'dome', 'sun', 'sun', 0xffd84a],
  _: ['iron', 'oak', 'grey', 'gable', 'orb', 'star', null],
};
const REALM = Object.fromEntries(REALMS.map((r) => [r.id, r]));

function glowColor(c, fallback) { const col = new THREE.Color(c.trimC); const hsl = {}; col.getHSL(hsl); return hsl.s > 0.3 ? new THREE.Color().setHSL(hsl.h, 0.9, 0.62).getHex() : fallback; }

/** the realm's look for this ship (cached on the ctx): the shared realm style (metal, glow, device, finial, lantern,
 *  banner cut, see ./realmStyle.js) plus this file's building table (timber, stone, roof form, motif, crude) */
function sty(c) {
  if (c.__sty) return c.__sty;
  const rs = c.st || styleOf(c.def), id = rs.id || c.def.realm, s = STY[id] || STY._, P = REALM[id]?.P || {};
  const [mk, wk, sk, roof, fin, motif, glow, crude] = s;
  c.__sty = {
    id, rs, met: rs.metal ?? MET[mk][0], metal: mk, M: { m: rs.metalM ?? MET[mk][1], r: 0.35 }, wood: WOOD[wk], woodK: wk, stone: STONE[sk], roof, fin, motif, crude: !!crude,
    glow: rs.glow ?? glow ?? glowColor(c, 0xffc86a), cloth: P.cloth ?? c.sailC, cloth2: P.cloth2 ?? c.trimC, armor: P.armor ?? C.steel,
    trim: c.trimC, hull: c.hullC, dark: shade(WOOD[wk], 0.6), rot: wk === 'rot' || wk === 'bog',
  };
  return c.__sty;
}

// ====================================================================================================
// detail tiers, moving parts, actions
// ====================================================================================================
/** a view of a kit that tags what it adds with a detail range: lv = farthest level drawn, lo = nearest level drawn */
class View {
  constructor(K, lv = 9, lo) { this.K = K; this.lv = lv; this.lo = lo; }
  tag(n) { const it = this.K.items; for (let i = n; i < it.length; i++) { it[i].lv = Math.min(it[i].lv, this.lv); if (this.lo !== undefined) it[i].lo = this.lo; } return this; }
  add(geo, col, x, y, z, o) { const n = this.K.items.length; this.K.add(geo, col, x, y, z, o); return this.tag(n); }
  bar(a, b, r, col, o, nn) { const n = this.K.items.length; this.K.bar(a, b, r, col, o, nn); return this.tag(n); }
  rope(a, b, sag, r, col, o) { const n = this.K.items.length; this.K.rope(a, b, sag, r, col, o); return this.tag(n); }
  detail(lv, fn) { this.K.detail(lv, fn); return this; }
  push(...a) { this.K.push(...a); return this; }
  pop() { this.K.pop(); return this; }
  get empty() { return this.K.empty; }
  get items() { return this.K.items; }
}
/** the detail tiers of one kit: t.b always, t.m levels 0-2 (mouldings, brackets, glyphs), t.f levels 0-1 (rivets,
 *  tiles, bark), t.l levels 3-5 only (cheap stand-ins for what t.m draws) */
class Tri {
  constructor(K) { this.K = K; this.b = new View(K); this.m = new View(K, 2); this.f = new View(K, 1); this.l = new View(K, 9, 3); }
  push(...a) { this.K.push(...a); return this; }
  pop() { this.K.pop(); return this; }
}
const T = (c) => (c.__tri ||= new Tri(c.kit));
const mover = () => new Tri(new DKit());
/** a moving part from its kit: one mesh with a geometry per detail level (registered when it is added) */
function moverMesh(c, t) {
  const m = t.K.mesh(); m.userData.ghostly = true;
  return m;
}
/** a mesh with detail levels added somewhere addMoving does not see */
function lodReg(c, mesh) {
  if (c.lodMeshes) { c.lodMeshes.push(mesh); return; }
  const lod = (c.m.userData.lod ||= { meshes: [], far: null, level: 0, levels: 6 });
  lod.meshes.push({ mesh, geos: mesh.userData.lodGeos });
}
/** a group to show or hide a moving mesh by (setLod rewrites the visibility of the meshes it knows) */
function holder(mesh) { const g = new THREE.Group(); g.add(mesh); return g; }
const part = (size, fn) => ({ size, fn });

/** an action hook, run after any already there */
function act(c, name, fn) {
  if (c.action) { c.action(name, fn); return; }
  const A = (c.m.userData.actions ||= {}), prev = A[name];
  A[name] = prev ? (k, m) => { prev(k, m); fn(k, m); } : fn;
}
function anchor(c, name, p) { if (c.anchor) { if (!c.anchors?.[name]) c.anchor(name, p); return; } const A = (c.m.userData.anchors ||= {}); if (!A[name]) A[name] = p; }
// envelopes: all are 0 at k <= 0 and k >= 1
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const kick = (k, a = 0.1) => (k <= 0 || k >= 1 ? 0 : k < a ? k / a : Math.pow(1 - (k - a) / (1 - a), 2));
const bump = (k) => (k <= 0 || k >= 1 ? 0 : Math.sin(PI * k));
const spinK = (k, n) => (k <= 0 || k >= 1 ? 0 : ease(k) * n * 2 * PI);
const pulses = (k, n, a = 0.25) => (k <= 0 || k >= 1 ? 0 : kick((k * n) % 1, a) * (1 - k * 0.3));

const mats = {};
function glowMat(col, op) { const k = `g${col},${op}`; return (mats[k] ||= new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })).clone(); }
function smoke() { return (mats.smoke ||= new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 1, transparent: true, opacity: 0.5, depthWrite: false })); }
/** an additive glow mesh from a kit (colours come from the kit; opacity is the material's) */
function glowMesh(K, op = 0.6) {
  const geo = K.build(), m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.userData.noCrew = true; m.userData.base = op;
  return m;
}

// ====================================================================================================
// geometry helpers
// ====================================================================================================
const f3 = (v) => (+v).toFixed(3);
const tube = (pts, r, seg = 12, rs = 4, closed = false) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(V), closed), seg, r, rs, closed);
/** a tube whose radius tapers from r0 to r1 */
function taper(pts, r0, r1, seg = 10, rs = 5) {
  const g = tube(pts, 1, seg, rs), P = g.attributes.position, curve = new THREE.CatmullRomCurve3(pts.map(V)), v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, cpt = curve.getPointAt(t), r = lerp(r0, r1, t);
    for (let j = 0; j <= rs; j++) { const idx = i * (rs + 1) + j; v.fromBufferAttribute(P, idx); q.subVectors(v, cpt).multiplyScalar(r); P.setXYZ(idx, cpt.x + q.x, cpt.y + q.y, cpt.z + q.z); }
  }
  g.computeVertexNormals();
  return g;
}
/** a smooth grid surface from f(u, v) -> [x, y, z], u, v in 0..1 */
function grid(key, nu, nv, f) {
  return G.custom(key, () => {
    const pos = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pos.push(...f(i / nu, j / nv));
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, d = a + nu + 1, e = d + 1; idx.push(a, b, e, a, e, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}
/** a point on a hip roof with concave faces and upturned corners: side 0..3 (+z, +x, -z, -x), u -1..1 along the eave, v 0..1 up */
function roofPt(W, D, h, lift, s, u, v, r0 = 0.03) {
  const half = s % 2 ? D : W, dist = s % 2 ? W : D, a = u * lerp(half, r0, v), o = lerp(dist, r0, v);
  const y = h * Math.pow(v, 1.7) + lift * Math.pow(Math.abs(u), 4) * Math.pow(1 - v, 2);
  return s === 0 ? [a, y, o] : s === 1 ? [o, y, -a] : s === 2 ? [-a, y, -o] : [-o, y, a];
}
function roofGeo(W, D, h, lift, nu = 8, nv = 5) {
  return G.custom(`roof${f3(W)},${f3(D)},${f3(h)},${f3(lift)},${nu},${nv}`, () => {
    const parts = [0, 1, 2, 3].map((s) => grid(`roofside${f3(W)},${f3(D)},${f3(h)},${f3(lift)},${nu},${nv},${s}`, nu, nv, (u, v) => roofPt(W, D, h, lift, s, u * 2 - 1, v)));
    return mergeGeos(parts);
  });
}
function mergeGeos(geos) {
  const K = new Kit();
  for (const g of geos) K.add(g, 0xffffff);
  const out = K.build(); out.deleteAttribute('color'); out.deleteAttribute('aPbr');
  return out;
}
/** a hanging cloth: width w, drop h (hangs down from y = 0), waved, the foot cut to a swallowtail when tail > 0 */
function clothGeo(w, h, wave, tail = 0, ph = 0) {
  return grid(`cloth${f3(w)},${f3(h)},${f3(wave)},${f3(tail)},${f3(ph)}`, 6, 8, (u, v) => {
    const x = (u - 0.5) * w, cut = tail * (1 - Math.abs(u - 0.5) * 2), y = -v * (h - cut);
    return [x, y, Math.sin(u * PI * 1.6 + v * 2.2 + ph) * wave * (0.25 + v)];
  });
}
const clothZ = (w, h, wave, ph, u, v) => Math.sin(u * PI * 1.6 + v * 2.2 + ph) * wave * (0.25 + v);
function starPts(n, R, r) { const p = []; for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * PI * 2 + PI / 2, q = i % 2 ? r : R; p.push([Math.cos(a) * q, Math.sin(a) * q]); } return p; }
/** a frame facing out of side a (radians around y): local +z points outward */
const faceRy = (a) => PI / 2 - a;

// ====================================================================================================
// ornaments (in the kit's current frame)
// ====================================================================================================
const SKULL_C = 0x141010;
function skull(K, s = 1, col = C.bone) {
  far(K, () => skull0(K, s, col));
  hiAdd(K, () => HI.skull({}), 0, 0, 0, { s }, col);
}
function skull0(K, s, col) {
  K.add(G.sph(0.13 * s, 9, 6), col, 0, 0.14 * s, 0, { sx: 1.1, sz: 0.92 });
  K.add(G.box(0.1 * s, 0.075 * s, 0.13 * s), col, 0.07 * s, 0.055 * s, 0);
  K.add(G.box(0.085 * s, 0.035 * s, 0.11 * s), col, 0.065 * s, 0.0, 0);
  for (const z of [-1, 1]) K.add(G.sph(0.034 * s, 5, 4), SKULL_C, 0.115 * s, 0.12 * s, z * 0.045 * s);
  K.add(G.cone(0.02 * s, 0.045 * s, 3), SKULL_C, 0.125 * s, 0.07 * s, 0, { rz: PI });
  K.add(G.box(0.012 * s, 0.022 * s, 0.075 * s), 0xece4cc, 0.115 * s, 0.03 * s, 0);
}
function flame(K, x, y, z, s, col = C.fire) {
  K.add(G.cone(0.13 * s, 0.42 * s, 7), col, x, y + 0.2 * s, z, { g: 2.5 }).add(G.cone(0.08 * s, 0.3 * s, 6), 0xffe08a, x, y + 0.16 * s, z, { g: 3 });
  for (let i = 0; i < 3; i++) { const a = i * 2.1; K.add(G.cone(0.05 * s, 0.22 * s, 5), col, x + Math.cos(a) * 0.07 * s, y + 0.12 * s, z + Math.sin(a) * 0.07 * s, { g: 2.5, rz: Math.cos(a) * -0.3, rx: Math.sin(a) * 0.3 }); }
}
const BARREL = [[0, 0], [0.3, 0], [0.33, 0.02], [0.37, 0.25], [0.39, 0.5], [0.37, 0.75], [0.33, 0.98], [0.3, 1], [0, 1]];
const barrelR = (y) => 0.335 + 0.055 * Math.sin(PI * y);
function barrel(t, col = C.wood, h = 0.42, band = C.iron, mark = null) {
  t.b.add(G.lathe('barrel', BARREL, 12), col, 0, 0, 0, { s: h, r: 0.85 });
  for (const y of [0.1, 0.9]) t.m.add(G.tor(1, 0.03, 3, 14), band, 0, h * y, 0, { rx: PI / 2, s: h * (barrelR(y) + 0.008), m: 0.5 });
  for (const y of [0.28, 0.72]) t.f.add(G.tor(1, 0.025, 3, 14), band, 0, h * y, 0, { rx: PI / 2, s: h * (barrelR(y) + 0.008), m: 0.5 });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; t.f.add(G.box(0.006, h * 0.8, 0.006), shade(col, 0.6), Math.cos(a) * h * 0.385, h * 0.5, Math.sin(a) * h * 0.385, { ry: -a }); }
  t.m.add(G.circle(h * 0.29, 10), shade(col, 0.75), 0, h * 1.001, 0, { rx: -PI / 2 });
  if (mark) t.m.add(G.cyl(h * 0.13, h * 0.13, 0.01, 8), mark, h * 0.39, h * 0.5, 0, { rz: PI / 2, g: 0.2 });
}
const plankLines = (K, w, h, d, n, col, y0 = 0) => { for (let i = 1; i < n; i++) K.add(G.box(w * 1.004, 0.012, d * 1.004), col, 0, y0 + (h * i) / n, 0); };

/** a pole finial in the realm's manner, base at the origin, s ~ 1 for a 3 m pole */
function finial(K, S, s = 1, kind) {
  if (!kind) { rsFinial(K, S.rs, s * 0.95); return; }
  const met = S.met, o = { ...S.M };
  K.add(G.cyl(0.03 * s, 0.045 * s, 0.22 * s, 8), met, 0, 0.11 * s, 0, o).add(G.sph(0.055 * s, 8, 6), met, 0, 0.24 * s, 0, o);
  K.push(0, 0.28 * s, 0);
  switch (kind) {
    case 'cup': K.add(G.lathe('cupfin', [[0, 0], [0.06, 0.01], [0.018, 0.05], [0.018, 0.12], [0.08, 0.15], [0.1, 0.25], [0.09, 0.26], [0, 0.2]], 12), met, 0, 0, 0, { ...o, s }); break;
    case 'crystal': K.add(G.oct(0.09 * s), S.glow, 0, 0.16 * s, 0, { sy: 2.2, g: 1.8, r: 0.15 }); for (let i = 0; i < 3; i++) K.add(G.oct(0.04 * s), S.glow, Math.cos(i * 2.1) * 0.07 * s, 0.06 * s, Math.sin(i * 2.1) * 0.07 * s, { sy: 2, g: 1.5, rz: Math.cos(i * 2.1) * -0.5, rx: Math.sin(i * 2.1) * 0.5 }); break;
    case 'spike': K.add(G.cone(0.045 * s, 0.5 * s, 6), met, 0, 0.25 * s, 0, o); for (let i = 0; i < 4; i++) { const a = (i / 4) * PI * 2; K.add(G.cone(0.025 * s, 0.18 * s, 4), met, Math.cos(a) * 0.05 * s, 0.04 * s, Math.sin(a) * 0.05 * s, { ...o, rz: -Math.cos(a) * 0.9, rx: Math.sin(a) * 0.9 }); } break;
    case 'leaf': for (let i = 0; i < 3; i++) K.add(G.sph(0.1 * s, 8, 6), C.leaf, Math.cos(i * 2.1) * 0.05 * s, 0.1 * s, Math.sin(i * 2.1) * 0.05 * s, { sx: 0.35, sz: 0.9, ry: -i * 2.1, rz: 0.4 }); K.add(G.sph(0.04 * s, 6, 4), S.glow, 0, 0.17 * s, 0, { g: 1.2 }); break;
    case 'sun': K.add(G.cyl(0.08 * s, 0.08 * s, 0.025 * s, 14), met, 0, 0.14 * s, 0, { ...o, rx: PI / 2 }); for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; K.add(G.cone(0.022 * s, 0.09 * s, 3), met, Math.cos(a) * 0.12 * s, 0.14 * s + Math.sin(a) * 0.12 * s, 0, { ...o, rz: a - PI / 2, sz: 0.4 }); } break;
    case 'pearl': for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; K.add(G.sph(0.06 * s, 6, 4), met, Math.cos(a) * 0.05 * s, 0.04 * s, Math.sin(a) * 0.05 * s, { ...o, sy: 0.4, sx: 1.3, ry: -a, rz: 0.5 }); } K.add(G.sph(0.075 * s, 12, 8), 0xf4eee6, 0, 0.1 * s, 0, { m: 0.3, r: 0.15 }).add(G.cone(0.03 * s, 0.09 * s, 8), 0xf4eee6, 0, 0.19 * s, 0, { m: 0.3, r: 0.15 }); break;
    case 'horn': for (const z of [-1, 1]) K.add(taper([[0, 0, z * 0.03 * s], [0, 0.08 * s, z * 0.12 * s], [0, 0.22 * s, z * 0.16 * s], [0, 0.32 * s, z * 0.1 * s]], 0.035 * s, 0.004 * s, 8, 5), C.bone, 0, 0, 0, { r: 0.6 }); K.add(G.sph(0.05 * s, 8, 6), met, 0, 0.02 * s, 0, o); break;
    case 'flame': K.add(G.lathe('bowlfin', [[0, 0], [0.04, 0], [0.09, 0.06], [0.1, 0.09]], 10), met, 0, 0, 0, { ...o, s }); flame(K, 0, 0.06 * s, 0, 0.55 * s); break;
    case 'skull': K.push(0, 0, 0, 0, 0, 0, s * 0.8); skull(K, 1); K.pop(); for (const z of [-1, 1]) K.add(taper([[0, 0.2 * s, z * 0.08 * s], [0, 0.3 * s, z * 0.16 * s], [0, 0.42 * s, z * 0.14 * s]], 0.025 * s, 0.003, 6, 4), 0x3a2a20, 0, 0, 0); break;
    case 'crescent': K.add(G.tor(0.1 * s, 0.02 * s, 5, 16, PI * 1.4), met, 0, 0.14 * s, 0, { ...o, rz: -1.2 * PI }); K.add(G.sph(0.03 * s, 6, 4), met, 0, 0.04 * s, 0, o); break;
    case 'spiral': K.add(tube(Array.from({ length: 14 }, (_, i) => { const a = i * 0.9, r = 0.015 + i * 0.0085; return [Math.cos(a) * r * s, (0.14 + Math.sin(a) * r) * s, 0]; }), 0.012 * s, 20, 4), met, 0, 0, 0, o); break;
    case 'lotus': for (let j = 0; j < 2; j++) for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2 + j * 0.4; K.add(G.sph(0.06 * s, 6, 4), j ? 0xf0b0c0 : met, Math.cos(a) * 0.05 * s, (0.05 + j * 0.03) * s, Math.sin(a) * 0.05 * s, { ...o, sx: 0.4, sy: 1.2, ry: -a, rz: -0.5 + j * 0.25 }); } K.add(G.sph(0.035 * s, 6, 4), S.glow, 0, 0.1 * s, 0, { g: 1.5 }); break;
    case 'pustule': for (let i = 0; i < 5; i++) K.add(G.sph((0.05 + hash(i) * 0.04) * s, 8, 6), C.slime, (hash(i + 3) - 0.5) * 0.1 * s, (0.05 + i * 0.03) * s, (hash(i + 7) - 0.5) * 0.1 * s, { g: 1.2, r: 0.2 }); break;
    case 'eye': K.add(G.sph(0.09 * s, 12, 8), 0xe8e0c8, 0, 0.1 * s, 0, { r: 0.25 }).add(G.cyl(0.04 * s, 0.04 * s, 0.02 * s, 10), S.glow, 0.085 * s, 0.1 * s, 0, { rz: PI / 2, g: 2 }); for (const sgn of [-1, 1]) K.add(G.tor(0.095 * s, 0.015 * s, 3, 12, PI), met, 0, 0.1 * s, 0, { ...o, ry: PI / 2, rx: sgn > 0 ? 0 : PI, sx: 1 }); break;
    case 'gear': K.push(0, 0.13 * s, 0); K.add(G.tor(0.08 * s, 0.022 * s, 4, 14), met, 0, 0, 0, o).add(G.cyl(0.03 * s, 0.03 * s, 0.03 * s, 8), met, 0, 0, 0, { ...o, rx: PI / 2 }); for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; K.add(G.box(0.035 * s, 0.035 * s, 0.03 * s), met, Math.cos(a) * 0.11 * s, Math.sin(a) * 0.11 * s, 0, { ...o, rz: a }); } for (let i = 0; i < 3; i++) K.add(G.box(0.15 * s, 0.012 * s, 0.012 * s), met, 0, 0, 0, { ...o, rz: (i * PI) / 3 }); K.pop(); break;
    case 'trident': K.add(G.cyl(0.012 * s, 0.012 * s, 0.3 * s, 5), met, 0, 0.12 * s, 0, o).add(G.tor(0.07 * s, 0.012 * s, 3, 10, PI), met, 0, 0.12 * s, 0, { ...o, rz: PI }); for (const x of [-0.07, 0, 0.07]) K.add(G.cone(0.02 * s, 0.1 * s, 4), met, x * s, (x ? 0.17 : 0.3) * s, 0, o); K.add(G.cyl(0.05 * s, 0.03 * s, 0.12 * s, 6), 0xd8d0c0, 0, -0.02 * s, 0); break;
    default: K.add(G.sph(0.09 * s, 12, 8), met, 0, 0.08 * s, 0, o).add(G.tor(0.09 * s, 0.012 * s, 4, 16), met, 0, 0.08 * s, 0, { ...o, rx: PI / 2 }).add(G.cone(0.02 * s, 0.14 * s, 6), met, 0, 0.22 * s, 0, o);
  }
  K.pop();
}

/** a relief of the realm's motif in the xy plane, facing +z, radius r */
function relief(K, S, r, col, kind = null, o = {}) {
  if (!kind) { rsEmblem(K, S.rs, r * 1.6, { col: [col, col], depth: 0.07, ...(o.m !== undefined ? { m: o.m } : {}) }); return; }
  const t = r * 0.1, g = { m: 0.6, r: 0.35, ...o };
  switch (kind) {
    case 'sun': K.add(G.cyl(r * 0.36, r * 0.36, t, 14), col, 0, 0, t / 2, { ...g, rx: PI / 2 }); for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; K.add(G.cone(r * 0.1, r * 0.4, 4), col, Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, t / 2, { ...g, rz: a - PI / 2, sz: 0.35 }); } break;
    case 'star': K.add(G.shape('star8', starPts(8, 1, 0.45), 0.12), col, 0, 0, t / 2, { ...g, s: r * 0.85 }); break;
    case 'gear': K.add(G.tor(r * 0.58, r * 0.12, 4, 16), col, 0, 0, t / 2, g); for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; K.add(G.box(r * 0.2, r * 0.2, t), col, Math.cos(a) * r * 0.76, Math.sin(a) * r * 0.76, t / 2, { ...g, rz: a }); } K.add(G.cyl(r * 0.16, r * 0.16, t * 1.5, 8), col, 0, 0, t / 2, { ...g, rx: PI / 2 }); break;
    case 'rune': K.add(G.tor(r * 0.8, r * 0.06, 3, 18), col, 0, 0, t / 2, g).add(G.box(r * 0.1, r * 1.1, t), col, 0, 0, t / 2, g); for (const s of [-1, 1]) { K.add(G.box(r * 0.08, r * 0.55, t), col, s * r * 0.18, r * 0.28, t / 2, { ...g, rz: s * 0.7 }); K.add(G.box(r * 0.08, r * 0.45, t), col, s * r * 0.16, -r * 0.3, t / 2, { ...g, rz: -s * 0.7 }); } break;
    case 'eye': K.add(G.sph(r * 0.75, 14, 8), 0xe8e0c8, 0, 0, 0, { sy: 0.45, sz: 0.12, r: 0.3 }).add(G.cyl(r * 0.26, r * 0.26, t * 1.2, 12), S.glow, 0, 0, t * 0.6, { rx: PI / 2, g: 2 }).add(G.cyl(r * 0.1, r * 0.1, t * 1.4, 8), SKULL_C, 0, 0, t * 0.8, { rx: PI / 2 }); K.add(G.tor(r * 0.78, r * 0.05, 3, 16, PI * 0.7), col, 0, -r * 0.42, t / 2, { ...g, rz: PI * 0.15 }).add(G.tor(r * 0.78, r * 0.05, 3, 16, PI * 0.7), col, 0, r * 0.42, t / 2, { ...g, rz: PI * 1.15 }); break;
    case 'skull': K.push(0, -r * 0.35, 0, 0, -PI / 2, 0, r * 3.2); skull(K, 1, col === C.bone ? C.bone : blend(col, C.bone, 0.5)); K.pop(); break;
    case 'flame': K.add(G.shape('flamerel', [[0, -1], [0.55, -0.6], [0.5, 0], [0.25, 0.4], [0.3, 0.05], [0.05, 0.5], [0, 1], [-0.15, 0.35], [-0.35, 0.55], [-0.4, 0.05], [-0.55, -0.5]], 0.15), col, 0, 0, t / 2, { ...g, s: r * 0.9 }); break;
    case 'horn': case 'tusk': case 'claw': for (const s of [-1, 1]) K.add(taper([[s * r * 0.15, -r * 0.6, 0], [s * r * 0.55, -r * 0.2, 0], [s * r * 0.6, r * 0.35, 0], [s * r * 0.3, r * 0.75, 0]], r * 0.16, r * 0.01, 8, 5), kind === 'horn' || kind === 'tusk' ? C.bone : col, 0, 0, t, { r: 0.6 }); K.add(G.sph(r * 0.22, 8, 6), col, 0, -r * 0.3, t / 2, { ...g, sz: 0.4 }); break;
    case 'wing': for (const s of [-1, 1]) K.add(G.shape('wingrel', [[0, 0], [0.3, 0.45], [0.75, 0.6], [1, 0.35], [0.8, 0.2], [0.75, 0], [0.55, 0.08], [0.45, -0.15], [0.25, -0.05]], 0.1), col, 0, 0, t / 2, { ...g, s: r, sx: s * r }); K.add(G.sph(r * 0.15, 8, 6), col, 0, 0.05 * r, t / 2, g); break;
    case 'scarab': K.add(G.sph(r * 0.4, 10, 8), col, 0, -r * 0.1, 0, { ...g, sy: 1.2, sz: 0.35 }).add(G.sph(r * 0.18, 8, 6), col, 0, r * 0.4, 0, { ...g, sz: 0.4 }).add(G.cyl(r * 0.25, r * 0.25, t, 12), 0xc83a2a, 0, r * 0.72, 0, { rx: PI / 2, g: 0.3 }); for (const s of [-1, 1]) for (let i = 0; i < 3; i++) K.add(G.box(r * 0.45, r * 0.06, t), col, s * r * 0.45, -r * 0.3 + i * r * 0.25, 0, { ...g, rz: s * (0.4 - i * 0.4) }); break;
    case 'wave': for (let i = 0; i < 3; i++) K.add(G.tor(r * 0.3, r * 0.07, 3, 12, PI * 1.3), col, (i - 1) * r * 0.5, -r * 0.1 + (i % 2) * r * 0.15, t / 2, { ...g, rz: PI * 0.1 }); K.add(G.box(r * 1.6, r * 0.08, t), col, 0, -r * 0.5, t / 2, g); break;
    case 'mon': K.add(G.tor(r * 0.82, r * 0.07, 3, 20), col, 0, 0, t / 2, g); for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2; K.add(G.sph(r * 0.2, 8, 6), col, Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32, t / 2, { ...g, sz: 0.4 }).add(G.tor(r * 0.32, r * 0.08, 3, 10, PI * 0.8), col, Math.cos(a + 0.9) * r * 0.2, Math.sin(a + 0.9) * r * 0.2, t / 2, { ...g, rz: a + 0.3 }); } break;
    case 'spiral': K.add(tube(Array.from({ length: 18 }, (_, i) => { const a = i * 0.85, q = r * (0.05 + i * 0.045); return [Math.cos(a) * q, Math.sin(a) * q, t / 2]; }), r * 0.06, 26, 4), col, 0, 0, 0, g); break;
    case 'lotus': case 'leaf': case 'lily': {
      const n = kind === 'lotus' ? 7 : kind === 'lily' ? 3 : 5;
      for (let i = 0; i < n; i++) { const a = PI / 2 + ((i - (n - 1) / 2) / Math.max(1, n - 1)) * (kind === 'lily' ? 1.4 : 2.2); K.add(G.sph(r * (kind === 'lily' && i === 1 ? 0.5 : 0.38), 8, 6), kind === 'leaf' ? C.leaf : col, Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4 - r * 0.1, t / 2, { ...g, sx: 0.35, sz: 0.25, rz: a - PI / 2 }); }
      K.add(G.box(r * 0.9, r * 0.1, t), col, 0, -r * 0.35, t / 2, g); break;
    }
    case 'dragon': K.add(tube([[-r * 0.8, -r * 0.4, 0], [-r * 0.4, r * 0.2, 0], [0, -r * 0.2, 0], [r * 0.4, r * 0.25, 0], [r * 0.65, r * 0.1, 0]], r * 0.09, 18, 5), col, 0, 0, t / 2, g).add(G.sph(r * 0.18, 8, 6), col, r * 0.72, r * 0.15, t / 2, { ...g, sx: 1.4, sz: 0.5 }); for (const s of [-1, 1]) K.add(G.cone(r * 0.04, r * 0.25, 4), col, r * 0.7, r * 0.35, t / 2 + s * r * 0.03, { ...g, rz: 0.6 }); K.add(G.sph(r * 0.12, 8, 6), 0xf4eee6, r * 0.95, r * 0.05, t, { m: 0.3, r: 0.15 }); break;
    case 'shell': K.add(G.cyl(r * 0.8, r * 0.8, t, 14, false), col, 0, 0, t / 2, { ...g, rx: PI / 2, sy: 1 }); for (let i = 0; i < 7; i++) { const a = PI * 0.15 + (i / 6) * PI * 0.7; K.bar([0, -r * 0.6, t], [Math.cos(a) * r * 0.8, -r * 0.6 + Math.sin(a) * r * 1.2, t], r * 0.05, blend(col, 0xffffff, 0.3), g); } break;
    case 'spike': K.add(G.tor(r * 0.5, r * 0.08, 3, 14), col, 0, 0, t / 2, g); for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; K.add(G.cone(r * 0.1, r * 0.45, 4), col, Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72, t / 2, { ...g, rz: a - PI / 2 }); } break;
    default: K.add(G.tor(r * 0.6, r * 0.1, 3, 16), col, 0, 0, t / 2, g);
  }
}
/** a round plate with the motif on it, facing +z */
function emblem(K, S, r, plate = S.cloth, col = S.met) {
  K.add(G.cyl(r, r, r * 0.08, 18), plate, 0, 0, 0, { rx: PI / 2, r: 0.5 }).add(G.tor(r, r * 0.07, 4, 20), col, 0, 0, r * 0.04, { ...S.M });
  K.push(0, 0, r * 0.05); rsEmblem(K, S.rs, r * 1.3, { col: [plate === S.cloth2 ? S.cloth : S.cloth2, col], depth: 0.07 }); K.pop();
}
/** a roof in the realm's manner over a w x d footprint, eave at y = 0 */
function roofOf(t, S, w, d, col, kind = S.roof, k = 1) {
  const o = { r: 0.6 };
  switch (kind) {
    case 'curved': {
      const W = w * 0.62, D = d * 0.62, h = Math.min(w, d) * 0.45, lift = h * 0.45;
      t.b.add(roofGeo(W, D, h, lift), col, 0, 0, 0, o);
      for (let s = 0; s < 4; s++) {
        t.m.add(tube(Array.from({ length: 5 }, (_, i) => roofPt(W, D, h, lift, s, 1, i / 4)), 0.03 * k, 8, 4), shade(col, 0.7), 0, 0.01, 0, o);
        const e = roofPt(W, D, h, lift, s, 1, 0); t.m.add(G.cone(0.04 * k, 0.16 * k, 5), S.met, e[0], e[1] + 0.06, e[2], { ...S.M, rx: e[2] > 0 ? 0.5 : -0.5, rz: e[0] > 0 ? -0.5 : 0.5 });
        t.m.add(tube(Array.from({ length: 7 }, (_, i) => roofPt(W, D, h, lift, s, -1 + i / 3, 0)), 0.022 * k, 12, 3), S.trim, 0, -0.01, 0, { m: 0.4 });
        for (let u = -0.6; u <= 0.61; u += 0.4) t.f.add(tube([0, 0.33, 0.66, 1].map((v) => roofPt(W, D, h, lift, s, u, v * 0.92)), 0.012 * k, 5, 3), shade(col, 0.82), 0, 0.012, 0, o);
      }
      return h;
    }
    case 'spire': case 'tiered': {
      const h = Math.max(w, d) * (kind === 'spire' ? 1.1 : 0.7);
      if (kind === 'spire') {
        t.b.add(G.cone(Math.max(w, d) * 0.62, h, 8), col, 0, h / 2, 0, { ry: PI / 8, r: 0.55 });
        for (let i = 0; i < 4; i++) { const a = (i / 4) * PI * 2 + PI / 4; t.m.add(G.cone(0.05 * k, 0.4 * k, 4), S.met, Math.cos(a) * w * 0.5, 0.2 * k, Math.sin(a) * d * 0.5, S.M); }
        for (let i = 1; i < 5; i++) t.f.add(G.tor(Math.max(w, d) * 0.62 * (1 - i / 5), 0.012 * k, 3, 8), shade(col, 0.75), 0, (h * i) / 5, 0, { rx: PI / 2, ry: PI / 8 });
      } else for (let i = 0; i < 4; i++) { const s = 1 - i * 0.22; t.b.add(G.cyl(w * 0.5 * s * 0.8, w * 0.52 * s, h * 0.22, 12), i % 2 ? shade(col, 0.85) : col, 0, h * 0.11 + i * h * 0.22, 0); t.m.add(G.tor(w * 0.52 * s, 0.025 * k, 3, 16), S.met, 0, i * h * 0.22, 0, { ...S.M, rx: PI / 2 }); }
      return h;
    }
    case 'onion': case 'dome': {
      const r = Math.min(w, d) * 0.5;
      if (kind === 'onion') t.b.add(G.lathe('onion', [[0, 0], [0.9, 0], [1.05, 0.25], [1.1, 0.55], [0.85, 0.95], [0.45, 1.25], [0.12, 1.5], [0, 1.7]], 14), col, 0, 0, 0, { s: r, m: 0.7, r: 0.3 });
      else t.b.add(G.hemi(r, 16, 7), col, 0, 0, 0, { r: 0.4, m: 0.3 });
      const top = kind === 'onion' ? r * 1.7 : r;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; t.m.add(tube(Array.from({ length: 6 }, (_, j) => { const v = j / 5, rr = kind === 'onion' ? r * [0.9, 1.08, 1.06, 0.8, 0.4, 0.05][j] : r * Math.cos((v * PI) / 2) * 1.01, y = kind === 'onion' ? r * [0.02, 0.35, 0.6, 0.98, 1.3, 1.62][j] : r * Math.sin((v * PI) / 2) * 1.01; return [Math.cos(a) * rr, y, Math.sin(a) * rr]; }), 0.02 * k, 10, 3), S.met, 0, 0, 0, S.M); }
      t.m.add(G.tor(r * 0.92, 0.03 * k, 4, 20), S.met, 0, 0.02, 0, { ...S.M, rx: PI / 2 });
      return top;
    }
    case 'flat': {
      t.b.add(G.box(w * 1.08, 0.12 * k, d * 1.08), col, 0, 0.06 * k, 0);
      const n = Math.max(2, Math.round(w / (0.3 * k)));
      for (const sd of [-1, 1]) for (let i = 0; i < n; i++) { t.m.add(G.box(0.14 * k, 0.16 * k, 0.1 * k), col, -w * 0.5 + (w * (i + 0.5)) / n, 0.2 * k, sd * d * 0.5); t.m.add(G.box(0.1 * k, 0.16 * k, 0.14 * k), col, sd * w * 0.5, 0.2 * k, -d * 0.5 + (d * (i + 0.5)) / n); }
      return 0.28 * k;
    }
    case 'hide': case 'thatch': case 'leaf': {
      const r = Math.max(w, d) * 0.64, h = r * (kind === 'hide' ? 0.9 : 0.75);
      t.b.add(G.lathe(`thatch${kind}`, kind === 'hide' ? [[0, 1], [0.3, 0.6], [0.7, 0.2], [1, 0], [1.02, -0.04]] : [[0, 1], [0.35, 0.85], [0.75, 0.45], [1, 0.08], [1.05, -0.02]], 14), kind === 'leaf' ? blend(C.leaf, col, 0.3) : col, 0, 0, 0, { s: r, sy: h, r: 0.95 });
      if (kind === 'hide') for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2; t.m.add(G.cyl(0.02 * k, 0.025 * k, 0.5 * k, 4), C.dark, Math.cos(a) * 0.06, h + 0.18 * k, Math.sin(a) * 0.06, { rz: Math.cos(a) * 0.4, rx: -Math.sin(a) * 0.4 }); }
      else for (let i = 1; i < 4; i++) t.f.add(G.tor(r * (1 - i * 0.22) * 1.01, 0.025 * k, 3, 14), shade(col, 0.75), 0, h * (kind === 'leaf' ? [0, 0.3, 0.6, 0.82][i] : [0, 0.3, 0.6, 0.82][i]), 0, { rx: PI / 2 });
      return h;
    }
    default: { // gable
      const h = Math.min(w, d) * 0.5, l = w * 1.12;
      t.b.add(G.shape('gableroof', [[-0.62, 0], [0.62, 0], [0, 0.5]], 1), col, 0, 0, 0, { sx: d, sy: h * 2, sz: l, ry: PI / 2, r: 0.6 });
      t.m.add(G.box(l * 1.02, 0.06 * k, 0.08 * k), S.trim, 0, h, 0, { m: 0.4 });
      for (const s of [-1, 1]) { t.m.add(G.box(0.05 * k, Math.hypot(h, d * 0.62) * 1.02, 0.06 * k), S.trim, s * l * 0.5, h / 2, -d * 0.31, { rx: -Math.atan2(d * 0.62, h) }).add(G.box(0.05 * k, Math.hypot(h, d * 0.62) * 1.02, 0.06 * k), S.trim, s * l * 0.5, h / 2, d * 0.31, { rx: Math.atan2(d * 0.62, h) }); }
      for (let i = 1; i < 5; i++) for (const s of [-1, 1]) t.f.add(G.box(l, 0.015, 0.02), shade(col, 0.75), 0, (h * i) / 5, s * d * 0.62 * (1 - i / 5));
      return h;
    }
  }
}
/** a railing round a w x d rectangle at height y (posts, top rail) */
function railing(K, w, d, y, h, col, n = 4, r = 0.02) {
  for (const s of [-1, 1]) { K.add(G.box(w, r * 1.6, r * 1.6), col, 0, y + h, s * d / 2).add(G.box(r * 1.6, r * 1.6, d), col, s * w / 2, y + h, 0); }
  for (let i = 0; i <= n; i++) for (const s of [-1, 1]) { K.add(G.cyl(r, r, h, 4), col, -w / 2 + (w * i) / n, y + h / 2, s * d / 2).add(G.cyl(r, r, h, 4), col, s * w / 2, y + h / 2, -d / 2 + (d * i) / n); }
}
function lanternBox(K, S, s = 1, glow = S.glow) {
  K.add(G.cyl(0.07 * s, 0.09 * s, 0.03 * s, 6), S.met, 0, 0, 0, S.M).add(G.cyl(0.07 * s, 0.07 * s, 0.16 * s, 6), glow, 0, 0.1 * s, 0, { g: 2, r: 0.3 }).add(G.cone(0.1 * s, 0.08 * s, 6), S.met, 0, 0.22 * s, 0, S.M).add(G.tor(0.025 * s, 0.008 * s, 3, 6), S.met, 0, 0.28 * s, 0, S.M);
}

/** one of her own squadron's fliers, parked (the same mount and rider the carrier launches) */
function parkFlier(c, x, y, z, ry = 0, s = 1) {
  const f = buildFlier(c.def.squadrons?.flier || 'glider', c.side, c.def.squadrons?.color, c.def.realm);
  f.scale.setScalar(s); f.position.set(x, y, z); f.rotation.y = ry;
  c.addMoving(f);
  return f;
}
/** evenly spaced stations along her length (fractions of the deck between stern and bow) */
function along(c, n, a = 0.1, b = 0.86) { return Array.from({ length: n }, (_, i) => lerp(c.sternX, c.bowX, lerp(a, b, n === 1 ? 0.5 : i / (n - 1)))); }
// a light part whose place is under a forecastle or deckhouse goes up onto its roof instead of inside it
const _ray = new THREE.Raycaster(), _down = new THREE.Vector3(0, -1, 0), _from = new THREE.Vector3();
function roofOver(c, x, z, y0) {
  const geo = c.m.userData.lod?.meshes?.[0]?.geos?.[0] || c.m.getObjectByName('ship')?.geometry;
  if (!geo || !geo.attributes.position?.count) return null;
  if (!c.__ray || c.__ray.geometry !== geo) { c.__ray = new THREE.Mesh(geo); c.__ray.updateMatrixWorld(true); }
  _ray.set(_from.set(x, c.top + 2, z), _down); _ray.far = c.top + 6;
  let best = null;
  for (const h of _ray.intersectObject(c.__ray, false)) if (h.face && Math.abs(h.face.normal.y) > 0.6 && h.point.y > y0 + 0.45 && h.point.y < Math.max(c.top * 0.5, y0 + 2.5)) best = best === null ? h.point.y : Math.min(best, h.point.y);
  return best;
}
function spot(c, r, pref = 0, mode = 'c', keep = true) {
  const at = c.place(r, pref, mode, keep);
  try { const y = roofOver(c, at.x, at.z, at.y); if (y !== null) { const y2 = roofOver(c, at.x + r * 0.7, at.z, at.y), y3 = roofOver(c, at.x - r * 0.7, at.z, at.y); at.y = Math.max(y, y2 ?? y, y3 ?? y); } } catch (e) { /* keep the deck spot */ }
  return at;
}
const railY = (c, x, s) => c.deckAt(x, s * c.B * 0.28) + 0.22;
const railZ = (c, x, s) => s * (c.hw(x) + 0.02);
const hullH = (c, x) => Math.min(c.dy, c.deckAt(x, c.B * 0.28));

// ---- a crewman, prisoner or corpse (in the kit's frame), facing +x: the realm's own soldier (or a common man)
// sculpted and baked small for the near levels, a stick figure far away ----
function figure(K, cloth, skin = 0xc89a7a, s = 1, pose = 'stand') {
  const sit = pose === 'sit', dead = pose === 'dead', y0 = sit ? 0 : 0.3 * s;
  far(K, () => {
    if (dead) K.push(0, 0.08 * s, 0, 0, 0, PI / 2);
    if (!sit) for (const z of [-1, 1]) K.add(G.cyl(0.035 * s, 0.03 * s, 0.32 * s, 5), shade(cloth, 0.6), 0, 0.16 * s, z * 0.05 * s);
    else for (const z of [-1, 1]) K.add(G.cyl(0.035 * s, 0.03 * s, 0.26 * s, 5), shade(cloth, 0.6), 0.1 * s, 0.06 * s, z * 0.06 * s, { rz: -1.3 });
    K.add(G.custom('torso', () => new THREE.CapsuleGeometry(0.07, 0.16, 2, 6)), cloth, sit ? -0.02 * s : 0, y0 + 0.14 * s, 0, { s, rz: sit ? 0.35 : 0.05 });
    K.add(G.sph(0.06 * s, 8, 6), skin, sit ? 0.05 * s : 0.02 * s, y0 + 0.33 * s, 0);
    if (dead) K.pop();
  });
  const who = pose === 'crew' ? crewUnit(CUR?.c) : 'militia';
  hiAdd(K, () => figureGeo(who, sit ? 'kneel' : dead ? 'dead' : 'stand', 0.46 * s), 0, 0, 0);
  return y0;
}
/** the realm's own foot soldier (for drummers and the like) */
const CREW_UNIT = {};
function crewUnit(c) {
  const r = c?.def?.realm || c?.st?.id || '_';
  if (CREW_UNIT[r]) return CREW_UNIT[r];
  const id = Object.keys(UNITS).find((k) => k.startsWith(`${r}_`) && (UNITS[k].model?.body || 'humanoid') === 'humanoid' && !UNITS[k].fly) || 'footman';
  return (CREW_UNIT[r] = id);
}
/** what fn adds to a kit (or view) is the far stand-in only: the part draws finished work in its place near by */
function far(K, fn) { const n0 = K.items.length; fn(); const it = K.items; for (let i = n0; i < it.length; i++) it[i].farOnly = true; }
/** finished work (three near levels: a sculpt, a baked figure) into a kit or view, drawn at levels 0..2 */
function hiAdd(K, make, x, y, z, o = {}, col = 0xffffff) { K.add(EMPTY6, col, x, y, z, o); const it = K.items[K.items.length - 1]; it.ref = true; it.make = make; it.lv = Math.min(it.lv, 2); return K; }
const EMPTY6 = [0, 1, 2, 3, 4, 5].map(() => EMPTY_GEO);

// ====================================================================================================
// parts
// ====================================================================================================
const RAW = {
  // ================= buildings =================
  pagoda: part(3, (c) => {
    const S = sty(c), w = clamp(Math.min(c.hw(0) * 1.6, c.L * 0.28), 1.4, 3.4), tiers = c.L > 10 ? 4 : 3, at = c.place(w * 0.62, -0.08), t = T(c), k = c.k;
    const wall = S.id === 'shogunate' ? 0xece6da : S.id === 'aethel' ? 0xe8eef4 : S.id === 'kharnak' ? 0x5a1a14 : blend(c.trimC, 0xb0201a, 0.5);
    const post = S.woodK === 'black' ? WOOD.black : S.id === 'aethel' ? 0xc8d0d8 : S.id === 'kharnak' ? 0x2a1a14 : 0x8a1a14;
    const roof = { tianlong: 0xc89a2a, shogunate: 0x3a3a46, aethel: 0x5a7a9a, kharnak: 0x8a6a30, nagavar: 0x6a1a14 }[S.id] ?? (shade(c.hullC, 0.6) || 0x2a2a3a);
    t.push(at.x, at.y, 0);
    t.b.add(G.box(w * 0.86, 0.2, w * 0.86), S.stone, 0, 0.1, 0);
    for (const sx of [-1, 1]) t.m.add(G.box(0.18 * k, 0.1, w * 0.3), shade(S.stone, 0.85), sx * w * 0.47, 0.05, 0).add(G.box(0.1 * k, 0.05, w * 0.3), shade(S.stone, 0.8), sx * w * 0.52, 0.025, 0);
    let y = 0.2, ww = w;
    for (let i = 0; i < tiers; i++) {
      const h = 0.7 * k * (i ? 0.82 : 1), cw = ww * 0.64;
      t.b.add(G.box(cw, h, cw), wall, 0, y + h / 2, 0);
      for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) if (sx || sz) t.b.add(G.cyl(0.045 * k, 0.05 * k, h, 6), post, sx * cw * 0.52, y + h / 2, sz * cw * 0.52, { r: 0.35 });
      t.m.add(G.box(cw * 1.08, 0.06 * k, cw * 1.08), post, 0, y + h - 0.03 * k, 0, { r: 0.35 }).add(G.box(cw * 1.06, 0.05 * k, cw * 1.06), post, 0, y + 0.03, 0, { r: 0.35 });
      for (let s = 0; s < 4; s++) {
        const a = (s * PI) / 2, ry = faceRy(a), ox = Math.cos(a) * cw * 0.502, oz = Math.sin(a) * cw * 0.502;
        t.push(ox, y + h * 0.52, oz, 0, ry, 0);
        for (const px of [-1, 1]) {
          t.m.add(G.box(cw * 0.36, h * 0.52, 0.02), 0xffd88a, px * cw * 0.24, 0, 0, { g: 0.9 });
          for (let q = 0; q < 4; q++) t.f.add(G.box(0.012, h * 0.52, 0.02), post, px * cw * 0.24 + (q - 1.5) * cw * 0.085, 0, 0.012);
          for (let q = 0; q < 3; q++) t.f.add(G.box(cw * 0.36, 0.012, 0.02), post, px * cw * 0.24, (q - 1) * h * 0.16, 0.012);
        }
        // bracket sets under the eave
        for (let q = -2; q <= 2; q++) for (let j = 0; j < 3; j++) (j === 1 ? t.f : t.m).add(G.box(0.06 * k, 0.04 * k, 0.06 * k + j * 0.07 * k), j === 1 ? S.trim : post, (q * cw) / 4.4, h * 0.48 + 0.02 + j * 0.04 * k, 0.03 + j * 0.035 * k);
        t.pop();
        // a balcony round the upper storeys
        if (i > 0) { t.push(ox * 1.12, y + 0.02, oz * 1.12, 0, ry, 0); t.m.add(G.box(cw * 1.1, 0.03, 0.18 * k), post, 0, 0, -0.06); for (let q = 0; q <= 6; q++) t.f.add(G.cyl(0.01, 0.01, 0.2 * k, 4), post, -cw * 0.55 + (cw * 1.1 * q) / 6, 0.1 * k, 0.02); t.m.add(G.box(cw * 1.1, 0.02, 0.025), post, 0, 0.2 * k, 0.02); t.pop(); }
      }
      t.push(0, y + h + 0.03 * k, 0);
      const rh = roofOf(t, S, ww * 0.95, ww * 0.95, roof, 'curved', k);
      // wind-bell lanterns at the corners of the lowest roof
      if (i === 0) for (let s = 0; s < 4; s++) { const e = roofPt(ww * 0.95 * 0.62, ww * 0.95 * 0.62, rh, rh * 0.45, s, 1, 0); t.m.bar([e[0] * 0.97, e[1] - 0.02, e[2] * 0.97], [e[0] * 0.97, e[1] - 0.18 * k, e[2] * 0.97], 0.008, C.dark); t.push(e[0] * 0.97, e[1] - 0.42 * k, e[2] * 0.97); lanternBox(t.m, S, k * 1.1, 0xff5a3a); t.pop(); }
      t.pop();
      y += h + rh * 0.5; ww *= 0.76;
    }
    // the spire: rings on a mast and the realm's finial
    t.b.add(G.cyl(0.035 * k, 0.07 * k, 1.0 * k, 6), S.met, 0, y + 0.5 * k, 0, S.M);
    for (let i = 0; i < 6; i++) t.m.add(G.tor(0.13 * k - i * 0.015 * k, 0.022 * k, 4, 12), S.met, 0, y + 0.15 * k + i * 0.12 * k, 0, { ...S.M, rx: PI / 2 });
    t.l.add(G.cone(0.14 * k, 0.8 * k, 6), S.met, 0, y + 0.45 * k, 0, S.M);
    t.push(0, y + 0.95 * k, 0); finial(t.m, S, 1.2 * k); t.pop();
    t.pop();
    c.nestAt = [at.x, at.y + y + 0.3, 0]; c.topAt = Math.max(c.topAt || 0, at.y + y + 1.4 * k);
  }),
  tower: part(3, (c) => {
    const S = sty(c), w = clamp(c.B * 0.36, 1.0, 2.0), h = clamp(c.L * 0.34, 2.6, 5), at = c.place(w * 0.75, -0.18), t = T(c), k = c.k;
    const wooden = S.crude || /scrap|greenhide|gorge|cloven/.test(c.def.realm + c.def.kind);
    t.push(at.x, at.y, 0);
    if (wooden) {
      // a lashed log watchtower: four raked legs, cross-bracing, a fighting platform and a hide roof
      const lg = S.wood, tw = w * 0.5;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { t.b.add(taper([[sx * w * 0.55, 0, sz * w * 0.55], [sx * tw, h, sz * tw]], 0.09 * k, 0.07 * k, 2, 6), lg, 0, 0, 0, { r: 0.95 }); }
      for (let j = 0; j < 3; j++) { const y0 = (h * j) / 3 + 0.2, y1 = (h * (j + 1)) / 3, r0 = lerp(w * 0.55, tw, y0 / h), r1 = lerp(w * 0.55, tw, y1 / h); for (const s of [-1, 1]) { t.m.bar([-r0, y0, s * r0], [r1, y1, s * r1], 0.035 * k, shade(lg, 0.85)).bar([s * r0, y0, -r0], [s * r1, y1, r1], 0.035 * k, shade(lg, 0.85)); } for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.f.add(G.tor(0.08 * k, 0.018 * k, 3, 8), C.rope, sx * r1, y1, sz * r1, { rx: PI / 2 }); }
      t.l.add(G.box(w * 0.7, h * 0.9, w * 0.7), lg, 0, h * 0.45, 0);
      t.b.add(G.box(w * 1.35, 0.1, w * 1.35), shade(lg, 1.1), 0, h, 0);
      for (let i = 0; i < 4; i++) { const a = (i * PI) / 2; t.push(Math.cos(a) * w * 0.66, h + 0.3 * k, Math.sin(a) * w * 0.66, 0, faceRy(a), 0); t.b.add(G.box(w * 1.3, 0.55 * k, 0.05), S.id === 'skar' ? 0x5a5048 : 0x8a6a4a, 0, 0, 0); for (let q = 0; q < 5; q++) t.m.add(G.cyl(0.035 * k, 0.04 * k, 0.75 * k, 5), lg, -w * 0.6 + q * w * 0.3, 0.05, 0.03); t.m.add(G.cone(0.05 * k, 0.2 * k, 5), S.crude ? C.bone : S.met, 0, 0.5 * k, 0.04, S.M); t.pop(); }
      t.push(0, h + 0.65 * k, 0); roofOf(t, S, w * 1.2, w * 1.2, S.roof === 'hide' ? 0x8a6a4a : shade(lg, 1.2), S.roof, k); t.pop();
      t.push(0, h + 0.62 * k + w * 0.7, 0); finial(t.m, S, k); t.pop();
      t.pop();
      c.nestAt = [at.x, at.y + h + 0.15, 0]; c.topAt = Math.max(c.topAt || 0, at.y + h + 1.6);
      return;
    }
    const stone = blend(c.hullC, S.stone, 0.65), dark = shade(stone, 0.65);
    // battered base, shaft with ashlar courses, string courses
    t.b.add(G.cyl(w * 0.62, w * 0.75, h * 0.18, 8), shade(stone, 0.9), 0, h * 0.09, 0, { ry: PI / 8, r: 0.9 });
    t.b.add(G.cyl(w * 0.58, w * 0.6, h, 8), stone, 0, h / 2, 0, { ry: PI / 8, r: 0.9 });
    for (let j = 1; j < 9; j++) t.f.add(G.cyl(w * 0.6 + 0.004, w * 0.6 + 0.004, 0.012, 8), shade(stone, 0.8), 0, h * 0.18 + (h * 0.8 * j) / 9, 0, { ry: PI / 8 });
    for (const y of [h * 0.18, h * 0.6]) t.m.add(G.cyl(w * 0.62, w * 0.62, 0.07, 8), dark, 0, y, 0, { ry: PI / 8 });
    // arrow slits that glow, a door, a little banner of the realm
    for (let i = 0; i < 4; i++) { const a = (i * PI) / 2 + PI / 4; for (const yy of [0.45, 0.75]) { t.push(Math.cos(a) * w * 0.56, h * yy, Math.sin(a) * w * 0.56, 0, faceRy(a), 0); t.m.add(G.box(0.06, 0.32 * k, 0.04), 0xffc86a, 0, 0, 0, { g: 1.2 }).add(G.box(0.18, 0.05, 0.05), dark, 0, -0.18 * k, 0.01); t.pop(); } }
    t.push(w * 0.56, 0.45 * k, 0, 0, faceRy(0), 0); t.m.add(G.box(0.4 * k, 0.75 * k, 0.05), S.dark, 0, 0, 0).add(G.cyl(0.2 * k, 0.2 * k, 0.05, 10, false), S.dark, 0, 0.37 * k, 0, { rx: PI / 2 }); for (let q = 0; q < 3; q++) t.f.add(G.box(0.42 * k, 0.025, 0.02), S.met, 0, -0.25 * k + q * 0.25 * k, 0.03, S.M); t.pop();
    t.push(w * 0.6, h * 0.62, 0, 0, faceRy(0), 0); emblem(t.m, S, 0.22 * k, S.cloth, S.met); t.pop();
    // machicolations and merlons
    t.b.add(G.cyl(w * 0.74, w * 0.62, 0.18, 8), shade(stone, 0.8), 0, h + 0.05, 0, { ry: PI / 8 });
    for (let i = 0; i < 16; i++) { const a = (i / 16) * PI * 2; t.m.add(G.box(0.1, 0.24, 0.1), dark, Math.cos(a) * w * 0.66, h - 0.12, Math.sin(a) * w * 0.66, { ry: -a }); }
    t.b.add(G.cyl(w * 0.76, w * 0.76, 0.12, 8), stone, 0, h + 0.2, 0, { ry: PI / 8 });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; t.b.add(G.box(0.2 * k, 0.28, 0.14 * k), stone, Math.cos(a) * w * 0.7, h + 0.4, Math.sin(a) * w * 0.7, { ry: -a }); }
    if (S.roof === 'spire' || S.roof === 'onion' || S.roof === 'curved' || S.roof === 'dome') {
      for (let i = 0; i < 4; i++) { const a = (i * PI) / 2; t.m.add(G.cyl(0.04 * k, 0.04 * k, 0.5, 5), S.dark, Math.cos(a) * w * 0.38, h + 0.5, Math.sin(a) * w * 0.38); }
      t.push(0, h + 0.75, 0); const rh = roofOf(t, S, w * 0.95, w * 0.95, S.roof === 'curved' ? shade(c.hullC, 0.6) : blend(0x3a4a6a, c.sailC, 0.3), S.roof, k); t.pop();
      t.push(0, h + 0.75 + rh, 0); finial(t.m, S, k); t.pop();
      c.topAt = Math.max(c.topAt || 0, at.y + h + 1 + rh);
    }
    t.b.add(G.cyl(0.04, 0.04, 1.5, 5), C.dark, 0, h + 0.95, 0);
    t.push(0, h + 1.6, 0.03); t.m.add(clothGeo(0.75, 0.5, 0.06, 0.12, 0.6), c.side, 0.38, 0, 0, { ry: 0, r: 0.9 }); t.pop();
    t.push(0, h + 1.7, 0); finial(t.m, S, 0.5 * k); t.pop();
    t.pop();
    c.nestAt = [at.x, at.y + h + 0.3, 0]; c.topAt = Math.max(c.topAt || 0, at.y + h + 1.9);
  }),
  pyramid: part(3, (c) => {
    if (c.def.kind === 'serpentBarge') return; // her class is built round a stepped pyramid already
    const S = sty(c), w = clamp(Math.min(c.hw(0) * 1.7, c.L * 0.3), 1.6, 3.6), at = c.place(w * 0.62, -0.05), t = T(c), col = blend(c.hullC, S.stone, 0.6), n = 5, sh = 0.32 * c.k, k = c.k;
    t.push(at.x, at.y, 0);
    for (let i = 0; i < n; i++) {
      const ww = w * (1 - i / (n + 0.6));
      t.b.add(G.box(ww, sh, ww), i % 2 ? shade(col, 0.88) : col, 0, sh * (i + 0.5), 0, { r: 0.85 });
      t.m.add(G.box(ww * 1.01, 0.035, ww * 1.01), S.trim, 0, sh * (i + 1) - 0.02, 0, { m: 0.4 });
      for (let s = 0; s < 4; s++) for (let q = 0; q < 5; q++) { const a = (s * PI) / 2; t.push(Math.cos(a) * ww * 0.501, sh * (i + 0.5), Math.sin(a) * ww * 0.501, 0, faceRy(a), 0); t.f.add(G.box(ww * 0.12, sh * 0.5, 0.015), shade(col, 0.75), (q - 2) * ww * 0.18, 0, 0); t.pop(); }
    }
    // the stair up the bow face, with balustrades
    const run = w * 0.5, rise = sh * n;
    for (let i = 0; i < n * 3; i++) t.m.add(G.box(run / (n * 3) + 0.02, 0.05, w * 0.24), shade(col, 1.08), w * 0.5 - (run * (i + 0.5)) / (n * 3), (rise * (i + 0.5)) / (n * 3), 0);
    for (const s of [-1, 1]) t.b.add(G.box(Math.hypot(run, rise), 0.1, 0.08), shade(col, 0.7), w * 0.25, rise / 2, s * w * 0.13, { rz: -Math.atan2(rise, run) });
    t.l.add(G.box(Math.hypot(run, rise), 0.06, w * 0.24), shade(col, 1.08), w * 0.25, rise / 2, 0, { rz: -Math.atan2(rise, run) });
    // shrine on top: gilt capstone and braziers
    t.b.add(G.box(w * 0.26, sh * 1.2, w * 0.26), shade(col, 0.95), 0, rise + sh * 0.6, 0);
    t.m.add(G.box(0.12, sh * 0.8, 0.02), 0x1a1410, w * 0.131, rise + sh * 0.5, 0, { ry: PI / 2 });
    t.b.add(G.cone(w * 0.2, sh * 1.6, 4), C.gold, 0, rise + sh * 2, 0, { ry: PI / 4, m: 0.85, r: 0.25 });
    for (const s of [-1, 1]) { t.push(0, rise, s * w * 0.18); t.m.add(G.cyl(0.07, 0.05, 0.18, 6), S.met, 0, 0.09, 0, S.M); flame(t.m, 0, 0.18, 0, 0.5 * k); t.pop(); }
    t.push(w * 0.4, rise * 0.55, 0, 0, faceRy(0), 0); emblem(t.m, S, 0.2 * k, S.cloth, C.gold); t.pop();
    t.pop();
    c.nestAt = [at.x, at.y + sh * n + 0.6, 0]; c.topAt = Math.max(c.topAt || 0, at.y + sh * (n + 3));
  }),
  ziggurat: part(3, (c) => {
    const S = sty(c);
    if (c.def.kind === 'serpentBarge') { const x = -c.L * 0.08; flame(c.kit, x, c.deckAt(x) + 0.05, 0, 1.6 * c.k); return; } // her class's own stepped pyramid; crown it with fire
    const w = clamp(Math.min(c.hw(0) * 1.75, c.L * 0.34), 1.8, 3.8), at = c.place(w * 0.62, -0.08), t = T(c), col = blend(c.hullC, S.id === 'ashur' ? 0x8a6a4a : 0xa07a50, 0.5), n = 3, sh = 0.55 * c.k, k = c.k;
    t.push(at.x, at.y, 0);
    for (let i = 0; i < n; i++) {
      const ww = w * (1 - i * 0.28), dd = ww * 0.9;
      t.b.add(G.box(ww, sh, dd), i % 2 ? shade(col, 0.85) : col, 0, sh * (i + 0.5), 0, { r: 0.9 });
      t.b.add(G.box(ww * 1.02, 0.06, dd * 1.02), c.trimC, 0, sh * (i + 1), 0, { m: 0.4 });
      // buttress pilasters on every face
      for (const s of [-1, 1]) for (let q = 0; q < 5; q++) { t.m.add(G.box(0.08, sh * 0.9, 0.06), shade(col, 0.75), -ww * 0.4 + (ww * 0.8 * q) / 4, sh * (i + 0.47), s * dd * 0.51); t.m.add(G.box(0.06, sh * 0.9, 0.08), shade(col, 0.75), s * ww * 0.51, sh * (i + 0.47), -dd * 0.4 + (dd * 0.8 * q) / 4); }
      for (let q = 0; q < 10; q++) for (const s of [-1, 1]) t.f.add(G.box(ww * 0.06, 0.04, 0.012), S.trim, -ww * 0.45 + (ww * 0.9 * q) / 9, sh * (i + 0.85), s * dd * 0.52, { m: 0.3 });
    }
    // three stairs up the bow face meeting at the top gate
    const rise = sh * n, run = w * 0.5;
    for (let i = 0; i < 12; i++) t.m.add(G.box(run / 12 + 0.02, 0.06, w * 0.2), shade(col, 1.1), w * 0.5 - (run * (i + 0.5)) / 12, (rise * (i + 0.5)) / 12, 0);
    for (const s of [-1, 1]) t.b.add(G.box(Math.hypot(run, rise), 0.12, 0.07), shade(col, 0.6), w * 0.25, rise / 2, s * w * 0.12, { rz: -Math.atan2(rise, run) });
    t.l.add(G.box(Math.hypot(run, rise), 0.08, w * 0.2), shade(col, 1.1), w * 0.25, rise / 2, 0, { rz: -Math.atan2(rise, run) });
    // the fire-house on top
    t.b.add(G.box(w * 0.3, sh * 0.8, w * 0.3), shade(col, 0.9), 0, rise + sh * 0.4, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.m.add(G.cone(0.08 * k, 0.3 * k, 4), S.met, sx * w * 0.15, rise + sh * 0.8 + 0.15 * k, sz * w * 0.15, S.M);
    t.m.add(G.box(0.02, sh * 0.5, w * 0.12), 0x1a1210, w * 0.151, rise + sh * 0.3, 0);
    t.m.add(G.lathe('zigbowl', [[0, 0], [0.2, 0], [0.28, 0.1], [0.3, 0.16]], 12), S.met, 0, rise + sh * 0.8, 0, { ...S.M, s: k * 1.4 });
    t.pop();
    const fl = new DKit(); flame(fl, 0, 0, 0, 1.6 * k); const fm = fl.mesh(); fm.position.set(at.x, at.y + rise + sh * 0.8 + 0.15 * k, 0);
    c.addMoving(fm, (tt, ph) => { const q = 1 + 0.12 * Math.sin(tt * 9 + ph) + 0.06 * Math.sin(tt * 23); fm.scale.set(1, q * (1 + (fm.userData.boost || 0)), 1); });
    act(c, 'aura', (kk) => { fm.userData.boost = bump(kk) * 0.8; });
    anchor(c, 'aura', [at.x, at.y + rise + sh, 0]);
    c.topAt = Math.max(c.topAt || 0, at.y + rise + sh * 0.8 + 1.6);
  }),
  temple: part(3, (c) => {
    const S = sty(c), w = clamp(Math.min(c.hw(0) * 1.6, c.L * 0.3), 1.6, 3.2), d = w * 0.7, h = 1.4 * c.k, at = c.place(w * 0.6, -0.12), t = T(c), k = c.k;
    const col = blend(c.trimC, S.stone, 0.65), shaft = blend(col, 0xffffff, 0.15);
    t.push(at.x, at.y, 0);
    // stylobate in three steps
    for (let i = 0; i < 3; i++) t.b.add(G.box(w * (1 - i * 0.04), 0.09, d * (1 - i * 0.05)), shade(col, 0.85 + i * 0.05), 0, 0.045 + i * 0.09, 0);
    const y0 = 0.27, cols = [];
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) cols.push([-w * 0.42 + (w * 0.84 * i) / 4, s * d * 0.38]);
    for (const s of [-1, 1]) cols.push([s * w * 0.42, 0]);
    for (const [x, z] of cols) {
      t.b.add(G.cyl(0.075 * k, 0.09 * k, h, 10), shaft, x, y0 + h / 2, z, { r: 0.6 });
      t.l.add(G.cyl(0.08 * k, 0.09 * k, h, 5), shaft, x, y0 + h / 2, z);
      t.m.add(G.cyl(0.12 * k, 0.12 * k, 0.06, 10), col, x, y0 + 0.03, z).add(G.cyl(0.13 * k, 0.09 * k, 0.07, 10), col, x, y0 + h - 0.03, z);
      t.m.add(G.box(0.26 * k, 0.04, 0.26 * k), col, x, y0 + h + 0.02, z);
      for (let q = 0; q < 8; q++) { const a = (q / 8) * PI * 2; t.f.add(G.box(0.012, h * 0.9, 0.012), shade(shaft, 0.75), x + Math.cos(a) * 0.083 * k, y0 + h / 2, z + Math.sin(a) * 0.083 * k); }
    }
    // the cella with its idol
    t.b.add(G.box(w * 0.58, h * 0.85, d * 0.42), shade(col, 0.95), 0, y0 + h * 0.425, 0);
    t.m.add(G.box(0.02, h * 0.55, d * 0.2), 0x1a120a, w * 0.291, y0 + h * 0.28, 0);
    t.push(w * 0.31, y0 + 0.02, 0); t.m.add(G.box(0.12, 0.3, 0.12), col, 0, 0.15, 0); t.pop();
    t.m.add(G.sph(0.17, 10, 8), S.glow, w * 0.27, y0 + h * 0.5, 0, { g: 2 });
    // entablature, frieze, pediment with the realm's sign
    t.b.add(G.box(w * 0.96, 0.18, d * 0.94), c.trimC, 0, y0 + h + 0.13, 0, { m: 0.5 });
    for (let i = 0; i < 14; i++) for (const s of [-1, 1]) t.f.add(G.box(0.03, 0.1, 0.012), shade(c.trimC, 0.7), -w * 0.45 + (w * 0.9 * i) / 13, y0 + h + 0.13, s * d * 0.472);
    t.m.add(G.box(w, 0.05, d * 0.98), col, 0, y0 + h + 0.245, 0);
    t.push(0, y0 + h + 0.27, 0);
    if (S.roof === 'dome' || S.roof === 'onion') { roofOf(t, S, d * 0.9, d * 0.9, blend(S.met, col, 0.3), S.roof, k); }
    else if (S.roof === 'curved' || S.roof === 'tiered') { roofOf(t, S, w * 0.9, d * 0.95, shade(c.hullC, 0.6), S.roof, k); }
    else {
      t.b.add(G.shape('pediment', [[-0.5, 0], [0.5, 0], [0, 0.32]], 1), col, 0, 0, 0, { sx: d, sy: d, sz: w * 0.98, ry: PI / 2 });
      for (const s of [-1, 1]) { t.push(s * w * 0.495, d * 0.11, 0, 0, s > 0 ? PI / 2 : -PI / 2, 0); relief(t.m, S, d * 0.13, S.met); t.pop(); t.m.add(G.cone(0.05 * k, 0.2 * k, 5), S.met, s * w * 0.49, 0.06, s * 0, S.M); }
      t.push(w * 0.49, d * 0.32, 0); finial(t.m, S, 0.7 * k); t.pop();
    }
    t.pop();
    t.pop();
    c.topAt = Math.max(c.topAt || 0, at.y + h + 1.1);
  }),
  obelisk: part(2.5, (c) => {
    const S = sty(c), h = clamp(c.L * 0.32, 2.4, 4.2), w = 0.32 * c.k, at = spot(c, 0.55, -0.22), t = T(c), col = blend(c.hullC, S.id === 'khemet' || S.id === 'goldsands' ? 0xc8a878 : C.darkStone, 0.5), k = c.k;
    const gc = S.glow;
    t.push(at.x, at.y, 0);
    for (let i = 0; i < 3; i++) t.b.add(G.box(w * (3.2 - i * 0.6), 0.12, w * (3.2 - i * 0.6)), shade(col, 0.75 + i * 0.07), 0, 0.06 + i * 0.12, 0);
    t.b.add(G.cyl(w * 0.5, w * 0.78, h, 4), col, 0, 0.36 + h / 2, 0, { ry: PI / 4, r: 0.45 });
    t.b.add(G.cone(w * 0.52, w * 1.3, 4), C.gold, 0, 0.36 + h + w * 0.65, 0, { ry: PI / 4, m: 0.9, r: 0.25 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { t.push(sx * w * 1.25, 0.36, sz * w * 1.25); t.m.add(G.cyl(0.06 * k, 0.08 * k, 0.3 * k, 6), S.met, 0, 0.15 * k, 0, S.M); flame(t.m, 0, 0.3 * k, 0, 0.35 * k); t.pop(); }
    // carved glyph columns (and their glow, which pulses)
    const gl = new DKit();
    for (let s = 0; s < 4; s++) {
      const a = (s * PI) / 2 + PI / 4, sl = Math.atan2(w * 0.28, h);
      for (let i = 0; i < 7; i++) {
        const f = (i + 0.5) / 7.5, rr = lerp(w * 0.78, w * 0.5, f) * 0.708 + 0.004, y = 0.36 + h * f;
        t.push(Math.cos(a) * rr, y, Math.sin(a) * rr, 0, faceRy(a), 0);
        t.f.add(G.box(w * 0.42, 0.012, 0.01), shade(col, 0.6), 0, h * 0.06, 0, { rx: sl });
        gl.push(Math.cos(a) * (rr + 0.006), y, Math.sin(a) * (rr + 0.006), 0, faceRy(a), 0);
        gl.add(G.box(w * (0.12 + hash(i + s * 7) * 0.18), h * 0.05, 0.004), gc, (hash(i * 3 + s) - 0.5) * w * 0.3, 0, 0, { rx: sl }).add(G.box(w * 0.06, h * 0.07, 0.004), gc, (hash(i + 11 + s) - 0.5) * w * 0.4, -h * 0.01, 0, { rx: sl });
        gl.pop(); t.pop();
      }
    }
    t.push(w * 0.79, 0.24, 0, 0, faceRy(0), 0); emblem(t.m, S, 0.16 * k, col, C.gold); t.pop();
    t.pop();
    const gm = glowMesh(gl, 0.55); gm.position.set(at.x, at.y, 0);
    c.addMoving(gm, (tt, ph) => { gm.material.opacity = gm.userData.base * (0.75 + 0.25 * Math.sin(tt * 1.6 + ph)) + (gm.userData.boost || 0); });
    act(c, 'aura', (kk) => { gm.userData.boost = bump(kk) * 0.9; });
    anchor(c, 'aura', [at.x, at.y + h + 0.6, 0]);
    c.topAt = Math.max(c.topAt || 0, at.y + h + 0.8);
  }),
  monolith: part(2.5, (c) => {
    const S = sty(c), h = clamp(c.L * 0.26, 2, 3.6), w = clamp(c.B * 0.26, 0.7, 1.3), at = spot(c, w * 0.6, 0.0), t = T(c), gc = S.glow, k = c.k;
    t.push(at.x, at.y, 0);
    t.b.add(G.cyl(w * 0.9, w * 1.0, 0.2, 7), shade(S.stone, 0.6), 0, 0.1, 0, { r: 0.9 });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * PI * 2; t.m.add(G.dod(0.12 * k), shade(S.stone, 0.5 + hash(i) * 0.2), Math.cos(a) * w, 0.12, Math.sin(a) * w, { sy: 0.6, r: 0.95 }); }
    t.push(0, 0.2, 0, 0, 0.3, 0.05);
    t.b.add(G.box(w, h, w * 0.35), 0x141418, 0, h / 2, 0, { r: 0.25, m: 0.25 });
    t.m.add(G.box(w * 1.02, 0.04, w * 0.37), 0x202028, 0, h - 0.02, 0, { r: 0.2, m: 0.3 });
    for (let i = 0; i < 6; i++) t.f.add(G.box(w * 0.9, 0.006, 0.004), 0x2a2a34, 0, h * (0.1 + i * 0.15), w * 0.176);
    t.pop();
    t.pop();
    // the runes glow, and three shards drift round it
    const gl = new DKit(); gl.push(at.x, at.y + 0.2, 0, 0, 0.3, 0.05);
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]) { gl.add(G.box(w * (0.15 + hash(i) * 0.35), 0.04, 0.006), gc, (hash(i + 4) - 0.5) * w * 0.4, h * (0.1 + i * 0.09), s * w * 0.178); gl.add(G.box(0.03, 0.1 + hash(i + 9) * 0.1, 0.006), gc, (hash(i + 7) - 0.5) * w * 0.6, h * (0.12 + i * 0.09), s * w * 0.178); }
    gl.pop();
    const gm = glowMesh(gl, 0.7);
    c.addMoving(gm, (tt, ph) => { gm.material.opacity = gm.userData.base * (0.7 + 0.3 * Math.sin(tt * 1.3 + ph)) + (gm.userData.boost || 0); });
    const sk = mover();
    for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2; sk.b.add(G.oct(0.12 * k), 0x141418, Math.cos(a) * w * 0.95, h * (0.55 + i * 0.12), Math.sin(a) * w * 0.95, { sy: 2, m: 0.3, r: 0.2 }); sk.m.add(G.oct(0.07 * k), gc, Math.cos(a) * w * 0.95, h * (0.55 + i * 0.12), Math.sin(a) * w * 0.95, { sy: 2.6, g: 2 }); }
    const sm = moverMesh(c, sk); sm.position.set(at.x, at.y, 0);
    c.addMoving(sm, (tt, ph) => { sm.rotation.y = tt * 0.4 + ph + (sm.userData.extra || 0); sm.position.y = at.y + Math.sin(tt * 1.1 + ph) * 0.08; });
    act(c, 'aura', (kk) => { gm.userData.boost = bump(kk) * 0.8; sm.userData.extra = spinK(kk, 1); });
    anchor(c, 'aura', [at.x, at.y + h * 0.8, 0]);
    c.topAt = Math.max(c.topAt || 0, at.y + h);
  }),
  stones: part(2.8, (c) => {
    const S = sty(c), R = clamp(c.hw(0) * 0.72, 0.9, 1.8), at = c.place(R + 0.2, -0.15), t = T(c), n = 6, k = c.k, gc = S.glow;
    const gl = new DKit();
    t.push(at.x, at.y, 0);
    const tops = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + 0.3, h = (1.1 + hash(i) * 0.8) * k, x = Math.cos(a) * R, z = Math.sin(a) * R * 0.85, col = blend(C.darkStone, 0x4a4450, hash(i + 1));
      t.push(x, 0, z, 0, -a, (hash(i + 2) - 0.5) * 0.15);
      hiAdd(t.b, () => HI.rock({ w: 0.34 * k, h, d: 0.22 * k, col, seed: i }), 0, 0, 0);
      far(t.K, () => t.b.add(G.custom('menhir', () => { const g = new THREE.CylinderGeometry(0.5, 0.62, 1, 6, 3); const P = g.attributes.position; for (let j = 0; j < P.count; j++) { const yy = P.getY(j); P.setX(j, P.getX(j) * (1 + 0.15 * Math.sin(j * 3.1)) * (yy > 0.4 ? 0.8 : 1)); P.setZ(j, P.getZ(j) * 0.6 * (1 + 0.1 * Math.cos(j * 2.3))); } g.computeVertexNormals(); return g; }), col, 0, h / 2, 0, { sx: 0.34 * k, sy: h, sz: 0.36 * k, r: 0.95 }));
      t.l.add(G.box(0.3 * k, h, 0.2 * k), col, 0, h / 2, 0);
      for (let q = 0; q < 3; q++) t.f.add(G.sph(0.06 * k, 5, 4), 0x4a6a3a, (hash(q + i) - 0.5) * 0.2 * k, h * (0.1 + q * 0.12), 0.1 * k, { sy: 0.5, r: 1 });
      t.pop();
      gl.push(at.x + Math.cos(a) * (R - 0.12 * k), at.y, Math.sin(a) * (R - 0.12 * k) * 0.85, 0, -a + PI / 2, 0);
      for (let q = 0; q < 3; q++) gl.add(G.box(0.03, 0.18 + hash(q + i * 5) * 0.12, 0.08), gc, 0, h * (0.3 + q * 0.18), (hash(q * 7 + i) - 0.5) * 0.1);
      gl.pop();
      tops.push([x, h, z]);
    }
    // lintels across two pairs
    for (const [i, j] of [[0, 1], [3, 4]]) { const p = tops[i], q = tops[j], y = Math.min(p[1], q[1]) + 0.08, L = Math.hypot(p[0] - q[0], p[2] - q[2]) + 0.4 * k; hiAdd(t.b, () => HI.rock({ w: L, h: 0.2 * k, d: 0.28 * k, col: shade(C.darkStone, 1.1), taper: 0, seed: i + 9 }), (p[0] + q[0]) / 2, y - 0.1 * k, (p[2] + q[2]) / 2, { ry: -Math.atan2(q[2] - p[2], q[0] - p[0]) }); far(t.K, () => t.b.add(G.box(Math.hypot(p[0] - q[0], p[2] - q[2]) + 0.4 * k, 0.2 * k, 0.28 * k), shade(C.darkStone, 1.1), (p[0] + q[0]) / 2, y, (p[2] + q[2]) / 2, { ry: -Math.atan2(q[2] - p[2], q[0] - p[0]), r: 0.95 })); }
    // the altar stone
    t.b.add(G.cyl(R * 0.4, R * 0.45, 0.25, 8), 0x2a2430, 0, 0.12, 0, { r: 0.9 });
    t.m.add(G.box(R * 0.5, 0.12, R * 0.3), 0x3a3440, 0, 0.3, 0, { r: 0.8 });
    t.pop();
    gl.add(G.tor(R * 0.3, 0.02, 3, 16), gc, at.x, at.y + 0.37, 0, { rx: PI / 2 }); gl.add(G.oct(0.12 * k), gc, at.x, at.y + 0.55, 0, { sy: 1.8 });
    const gm = glowMesh(gl, 0.7);
    c.addMoving(gm, (tt, ph) => { gm.material.opacity = gm.userData.base * (0.7 + 0.3 * Math.sin(tt * 0.9 + ph)) + (gm.userData.boost || 0); });
    act(c, 'aura', (kk) => { gm.userData.boost = bump(kk) * 0.8; });
    act(c, 'mortar', (kk) => { gm.userData.boost = kick(kk, 0.3) * 0.7; });
    anchor(c, 'aura', [at.x, at.y + 0.6, 0]);
    c.stonesAt = [at.x, at.y];
  }),
  tree: part(3, (c) => {
    const S = sty(c), h = clamp(c.L * 0.42, 3, 6), at = c.place(clamp(c.B * 0.3, 0.8, 1.4), -0.05), t = T(c), k = c.k;
    const bark = S.id === 'baobab' ? 0x8a7a68 : S.id === 'morbus' ? 0x4a4a32 : S.id === 'nagavar' ? 0x5a3a2a : 0x5a4030;
    const leaf = S.id === 'morbus' ? 0x7a8a3a : S.id === 'nagavar' ? 0x3a6a2a : S.id === 'cloven' ? 0x5a6a2a : blend(C.leaf, c.sailC, 0.15);
    const fat = S.id === 'baobab' ? 1.7 : 1;
    t.push(at.x, at.y, 0);
    hiAdd(t.b, () => HI.trunk({ h, k, fat, bark }), 0, 0, 0);
    const n0 = t.K.items.length;
    // trunk in tapering lengths, root flares into the deck
    const trunk = [[0, 0, 0], [0.06, 0.25, 0.03], [-0.04, 0.5, -0.02], [0.03, 0.72, 0.02]].map(([x, y, z]) => [x * k, y * h, z * k]);
    t.b.add(taper(trunk, 0.42 * k * fat, 0.17 * k * (fat > 1 ? 1.4 : 1), 8, 9), bark, 0, 0, 0, { r: 0.95 });
    t.l.add(G.cyl(0.18 * k, 0.4 * k * fat, h * 0.72, 6), bark, 0, h * 0.36, 0);
    for (let i = 0; i < 7; i++) { const a = (i / 7) * PI * 2 + hash(i) * 0.4; t.m.add(taper([[Math.cos(a) * 0.15 * k, h * 0.12, Math.sin(a) * 0.15 * k], [Math.cos(a) * 0.45 * k * fat, h * 0.03, Math.sin(a) * 0.4 * k * fat], [Math.cos(a) * 0.95 * k * fat, -0.02, Math.sin(a) * 0.8 * k * fat]], 0.13 * k * fat, 0.02, 6, 5), bark, 0, 0, 0, { r: 0.95 }); }
    // bark ridges
    for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; t.f.add(taper([0, 0.25, 0.5, 0.7].map((f) => [Math.cos(a + f * 0.6) * (0.4 - f * 0.32) * k * fat, f * h, Math.sin(a + f * 0.6) * (0.4 - f * 0.32) * k * fat]), 0.03 * k, 0.012 * k, 6, 3), shade(bark, 0.75), 0, 0, 0, { r: 1 }); }
    // boughs
    const tips = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2 + 0.5, y0 = h * (0.45 + (i % 3) * 0.08), e = [Math.cos(a) * 1.05 * k, h * (0.72 + hash(i) * 0.12), Math.sin(a) * 0.85 * k];
      t.b.add(taper([[0, y0, 0], [e[0] * 0.5, (y0 + e[1]) / 2 + 0.1, e[2] * 0.5], e], 0.11 * k, 0.04 * k, 6, 5), bark, 0, 0, 0, { r: 0.95 });
      tips.push(e);
    }
    for (let i = n0; i < t.K.items.length; i++) t.K.items[i].farOnly = true;
    t.pop();
    // the canopy sways a little: clusters of leaf masses, with fruit/lanterns of the realm
    const cn = mover(), blobs = [[0, 0.92, 0, 1.0], [0.8, 0.8, 0.35, 0.75], [-0.72, 0.82, -0.3, 0.8], [0.25, 0.78, -0.75, 0.72], [-0.3, 0.8, 0.72, 0.72], [0, 1.12, 0, 0.7], [0.5, 1.0, -0.3, 0.55], [-0.45, 1.02, 0.25, 0.55]];
    hiAdd(cn.K, () => HI.canopy({ k, h, leaf }), 0, 0, 0);
    far(cn.K, () => blobs.forEach(([x, y, z, r], i) => {
      const col = shade(leaf, 0.82 + hash(i) * 0.3), px = x * k, py = y * h - h * 0.7, pz = z * k;
      cn.b.add(G.ico(r * k, 1), col, px, py, pz, { r: 0.85, sy: 0.8 });
      cn.l.add(G.ico(r * k * 0.9, 0), col, px, py, pz, { sy: 0.8 });
      for (let q = 0; q < 5; q++) { const a = q * 1.3 + i, b = (q / 5) * 1.2 - 0.3; cn.m.add(G.ico(r * k * 0.42, 1), shade(col, 0.9 + hash(q + i) * 0.25), px + Math.cos(a) * Math.cos(b) * r * k * 0.85, py + Math.sin(b) * r * k * 0.7, pz + Math.sin(a) * Math.cos(b) * r * k * 0.85, { r: 0.85, sy: 0.8 }); }
      for (let q = 0; q < 6; q++) { const a = q * 2.1 + i * 0.7; cn.f.add(G.sph(r * k * 0.16, 5, 4), shade(col, 1.15), px + Math.cos(a) * r * k * 0.9, py + (hash(q + i * 3) - 0.3) * r * k, pz + Math.sin(a) * r * k * 0.9, { sx: 1.3, sy: 0.4, rz: a }); }
    }));
    const fruit = S.id === 'morbus' ? C.slime : S.id === 'baobab' ? 0xc8b890 : S.id === 'nagavar' ? 0xff3a3a : S.id === 'verdant' || S.id === 'deeproot' ? S.glow : 0xff9a3a;
    for (let i = 0; i < 9; i++) { const a = i * 0.7, r = 0.9 * k, y = h * (0.7 + hash(i) * 0.15) - h * 0.7; cn.m.bar([Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(a) * r, y - 0.3, Math.sin(a) * r], 0.008, 0x3a2a1a); cn.m.add(G.sph(0.07 * k, 6, 5), fruit, Math.cos(a) * r, y - 0.36, Math.sin(a) * r, { g: S.id === 'verdant' || S.id === 'deeproot' || S.id === 'nagavar' ? 1.6 : 0.1, sy: S.id === 'baobab' ? 1.8 : 1 }); }
    const cm = moverMesh(c, cn); cm.position.set(at.x, at.y + h * 0.7, 0);
    c.addMoving(cm, (tt, ph) => { cm.rotation.z = Math.sin(tt * 0.7 + ph) * 0.025; cm.rotation.x = Math.sin(tt * 0.53 + ph * 1.3) * 0.02; });
    c.nestAt = [at.x, at.y + h * 1.2, 0]; c.topAt = Math.max(c.topAt || 0, at.y + h * 1.3);
  }),
  deadTree: part(2.5, (c) => {
    const S = sty(c), h = clamp(c.L * 0.36, 2.6, 5), at = c.place(0.6, 0.05), t = T(c), k = c.k, bark = S.rot ? 0x3a3a2e : 0x4a4038;
    t.push(at.x, at.y, 0);
    const trunk = [[0, 0, 0], [0.12, 0.3, 0.05], [-0.08, 0.6, 0], [0.05, 0.85, 0.06], [0, 1, 0]].map(([x, y, z]) => [x * k, y * h, z * k]);
    const br0 = [[0.4, 0.5, 0.35], [0.55, -0.6, 0.15], [0.7, 0.3, -0.5], [0.62, -0.4, 0.6], [0.85, 0.2, 0.4], [0.8, -0.3, -0.35]];
    hiAdd(t.b, () => HI.deadTrunk({ h, k, bark, boughs: br0.map(([f, dx, dz]) => [[0, f * h, 0], [dx * 1.8 * k, f * h + 0.55 * h * 0.35, dz * 1.8 * k], [dx * 2.6 * k, f * h + 0.7, dz * 2.4 * k + 0.2]]) }), 0, 0, 0);
    far(t.K, () => {
    t.b.add(taper(trunk, 0.3 * k, 0.05 * k, 12, 8), bark, 0, 0, 0, { r: 1 });
    t.m.add(G.sph(0.11 * k, 8, 6), 0x0a0806, 0.1 * k, h * 0.42, 0.17 * k, { sy: 1.6, sz: 0.4 });
    for (let i = 0; i < 5; i++) { const a = i * 1.3; t.m.add(taper([[0, 0.25, 0], [Math.cos(a) * 0.4 * k, 0.05, Math.sin(a) * 0.35 * k], [Math.cos(a) * 0.75 * k, -0.02, Math.sin(a) * 0.65 * k]], 0.11 * k, 0.015, 6, 4), bark, 0, 0, 0, { r: 1 }); }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; t.f.add(taper([0, 0.3, 0.6, 0.85].map((f) => [Math.cos(a + f) * (0.3 - f * 0.25) * k + trunk[Math.round(f * 3)][0], f * h, Math.sin(a + f) * (0.3 - f * 0.25) * k]), 0.025 * k, 0.008, 6, 3), shade(bark, 0.7), 0, 0, 0); }
    });
    const br = [[0.4, 0.5, 0.35], [0.55, -0.6, 0.15], [0.7, 0.3, -0.5], [0.62, -0.4, 0.6], [0.85, 0.2, 0.4], [0.8, -0.3, -0.35]];
    br.forEach(([f, dx, dz], i) => {
      const a = [0, f * h, 0], b = [dx * 1.8 * k, f * h + 0.55 * h * 0.35, dz * 1.8 * k], e = [dx * 2.6 * k, f * h + 0.7, dz * 2.4 * k + 0.2];
      far(t.K, () => {
      t.b.add(taper([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.15, (a[2] + b[2]) / 2], b, e], 0.09 * k, 0.012, 10, 5), bark, 0, 0, 0, { r: 1 });
      t.m.add(taper([b, [b[0] + 0.15, b[1] + 0.3, b[2] - 0.1], [b[0] + 0.3, b[1] + 0.45, b[2] - 0.2]], 0.035 * k, 0.006, 5, 3), bark, 0, 0, 0);
      });
      for (let q = 0; q < 3; q++) t.f.add(taper([e, [e[0] + (hash(q + i) - 0.5) * 0.4, e[1] + 0.2 + hash(q) * 0.2, e[2] + (hash(q * 3 + i) - 0.5) * 0.4]], 0.012, 0.003, 2, 3), bark, 0, 0, 0);
      if (i < 3) {
        // something hangs from it: a noose and a body, a crow-cage, a lantern
        t.m.bar(e, [e[0], e[1] - 0.6, e[2]], 0.01, C.rope);
        if (i === 0) { t.push(e[0], e[1] - 1.3, e[2], 0, 0, 0.05); figure(t.m, 0x5a5040, 0x8a8a70, 1.4 * k); t.pop(); }
        else if (i === 1) { t.push(e[0], e[1] - 1.05, e[2]); t.m.add(G.cyl(0.14, 0.14, 0.03, 8), C.iron, 0, 0, 0, { m: 0.6 }).add(G.hemi(0.14, 8, 4), C.iron, 0, 0.35, 0, { m: 0.6 }); for (let q = 0; q < 7; q++) { const a = (q / 7) * PI * 2; t.m.add(G.cyl(0.008, 0.008, 0.35, 3), C.iron, Math.cos(a) * 0.14, 0.17, Math.sin(a) * 0.14, { m: 0.6 }); } skull(t.m, 0.6); t.pop(); }
        else { t.push(e[0], e[1] - 0.9, e[2]); lanternBox(t.m, S, k, S.glow); t.pop(); }
      }
    });
    // crows on the boughs
    for (let i = 0; i < 3; i++) { const [f, dx, dz] = br[i + 2], p = [dx * 1.8 * k, f * h + 0.55 * h * 0.35 + 0.08, dz * 1.8 * k]; t.push(p[0], p[1], p[2], 0, i * 2, 0); t.m.add(G.sph(0.07, 6, 5), 0x141418, 0, 0.06, 0, { sx: 1.4 }).add(G.sph(0.04, 6, 4), 0x141418, 0.08, 0.11, 0).add(G.cone(0.015, 0.06, 4), 0x2a2a20, 0.13, 0.11, 0, { rz: -PI / 2 }).add(G.box(0.1, 0.01, 0.04), 0x141418, -0.1, 0.06, 0, { rz: 0.3 }); t.pop(); }
    t.pop();
    if (!c.nestAt) c.nestAt = [at.x, at.y + h, 0];
    c.topAt = Math.max(c.topAt || 0, at.y + h + 0.6);
  }),
  portal: part(3, (c) => {
    const S = sty(c), R = clamp(c.B * 0.34, 0.9, 1.8), at = c.place(R * 0.7, -0.05), t = T(c), gc = S.glow, y = R + 0.35, k = c.k;
    const st = S.id === 'skar' ? 0x3a3a30 : S.id === 'labyrinth' ? 0xd8d0e8 : C.darkStone;
    t.push(at.x, at.y, 0);
    for (let i = 0; i < 3; i++) t.b.add(G.box(R * (1.4 - i * 0.15), 0.12, R * (0.9 - i * 0.12)), shade(st, 0.8 + i * 0.08), 0, 0.06 + i * 0.12, 0);
    // voussoir ring of carved blocks, keystone, rune band
    const nb = 16;
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * PI * 2, cx = Math.cos(a) * R * 1.08, cy = y + Math.sin(a) * R * 1.08;
      t.b.add(G.box(R * 0.42, R * 0.3, R * 0.34), i === 4 ? S.met : shade(st, 0.9 + (i % 2) * 0.15), cx, cy, 0, { rz: a, r: i === 4 ? S.M.r : 0.85, m: i === 4 ? S.M.m : 0 });
      t.f.add(G.box(0.012, R * 0.31, R * 0.35), shade(st, 0.5), Math.cos(a + PI / nb) * R * 1.08, y + Math.sin(a + PI / nb) * R * 1.08, 0, { rz: a + PI / nb });
    }
    t.l.add(G.tor(R * 1.08, R * 0.17, 4, 12), st, 0, y, 0);
    t.m.add(G.tor(R * 0.9, R * 0.04, 4, 32), S.met, 0, y, R * 0.12, S.M).add(G.tor(R * 0.9, R * 0.04, 4, 32), S.met, 0, y, -R * 0.12, S.M);
    // flanking piers with horns or spikes, and braziers
    for (const s of [-1, 1]) {
      t.b.add(G.box(R * 0.36, R * 1.2, R * 0.5), st, s * R * 1.15, 0.36 + R * 0.6, 0);
      t.push(s * R * 1.15, 0.36 + R * 1.2, 0); t.m.add(G.cyl(0.1 * k, 0.07 * k, 0.15 * k, 6), S.met, 0, 0.075 * k, 0, S.M); flame(t.m, 0, 0.15 * k, 0, 0.45 * k, S.glow); t.pop();
      t.m.add(taper([[s * R * 1.5, y + R * 0.5, 0], [s * R * 1.8, y + R * 0.9, 0], [s * R * 1.65, y + R * 1.35, 0]], 0.1 * k, 0.01, 8, 5), S.crude || S.fin === 'horn' ? C.bone : S.met, 0, 0, 0, S.M);
    }
    t.push(0, y + R * 1.3, 0); finial(t.m, S, 0.8 * k); t.pop();
    t.pop();
    // the swirling disc
    const g = new THREE.Group(); g.position.set(at.x, at.y + y, 0);
    const disc = new THREE.Mesh(G.circle(R * 0.92, 32), glowMat(gc, 0.5)); disc.rotation.y = PI / 2;
    const sw = new DKit();
    for (let i = 0; i < 4; i++) { const pts = Array.from({ length: 12 }, (_, j) => { const f = j / 11, a = (i / 4) * PI * 2 + f * 3.4, r = R * (0.05 + f * 0.85); return [0, Math.sin(a) * r, Math.cos(a) * r]; }); sw.add(tube(pts, R * 0.035, 24, 3), blend(gc, 0xffffff, 0.35 + (i % 2) * 0.2), 0, 0, 0); }
    for (let i = 0; i < 3; i++) sw.add(G.tor(R * (0.3 + i * 0.22), 0.02, 3, 24, PI * 1.2), 0xffffff, 0, 0, 0, { ry: PI / 2, rx: i * 2 });
    const swirl = new THREE.Mesh(sw.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const core = new THREE.Mesh(G.cone(R * 0.5, R * 0.9, 18, true), glowMat(blend(gc, 0xffffff, 0.5), 0.35)); core.rotation.z = PI / 2; core.position.x = -R * 0.1;
    g.add(disc, swirl, core);
    let boost = 0;
    c.addMoving(g, (tt, ph) => { swirl.rotation.x = -tt * 2.2; core.rotation.y = tt * 3; disc.material.opacity = 0.42 + 0.12 * Math.sin(tt * 3 + ph) + boost * 0.4; const s = 1 + boost * 0.12; g.scale.set(1, s, s); });
    const flare = (kk) => { boost = bump(kk); };
    act(c, 'aura', (kk) => { boost = bump(kk); });
    act(c, 'board', flare);
    act(c, 'beach', flare);
    anchor(c, 'aura', [at.x, at.y + y, 0]);
    c.topAt = Math.max(c.topAt || 0, at.y + y + R * 1.6);
  }),
  flightDeck: part(3.5, (c) => {
    const S = sty(c), fl = clamp(c.L * 0.42, 3, 6), fw = clamp(2 * c.hw(-c.L * 0.2) + 0.5, 2, 5), fx = c.sternX + fl / 2 + 0.1, fy = c.deckAt(fx) + 1.3, t = T(c), k = c.k;
    c.taken.push([fx, 0, fl * 0.45]); c.keep.push([fx, 0, fl * 0.3], [fx - fl * 0.3, 0, fw * 0.4], [fx + fl * 0.3, 0, fw * 0.4]);
    const deck = shade(c.hullC, 0.95);
    t.push(fx, fy, 0);
    t.b.add(G.box(fl, 0.12, fw), deck, 0, 0, 0);
    // planking seams, edge coaming, centre line and the catapult track
    for (let i = 1; i < 12; i++) t.f.add(G.box(fl, 0.004, 0.012), shade(deck, 0.7), 0, 0.062, -fw / 2 + (fw * i) / 12);
    for (let i = 1; i < 6; i++) t.f.add(G.box(0.012, 0.004, fw), shade(deck, 0.75), -fl / 2 + (fl * i) / 6, 0.062, 0);
    for (const s of [-1, 1]) { t.m.add(G.box(fl, 0.08, 0.05), S.trim, 0, 0.08, s * fw * 0.5, { m: 0.4 }); t.b.add(G.box(fl, 0.03, 0.08), 0xe8e0c8, 0, 0.065, s * fw * 0.44); }
    for (let i = 0; i < 6; i++) t.m.add(G.box(fl * 0.07, 0.01, 0.1), 0xe8e0c8, -fl * 0.4 + (fl * 0.8 * i) / 5, 0.066, 0);
    t.b.add(G.box(fl * 0.85, 0.03, 0.1), S.met, 0, 0.07, -fw * 0.18, S.M);
    for (let i = 0; i < 4; i++) t.m.add(G.cyl(0.012, 0.012, fw * 0.8, 4), C.rope, -fl * 0.35 + i * 0.12, 0.08, 0, { rx: PI / 2 });
    // trestles under it
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) {
      const x = sx * fl * 0.42, hh = fy - c.deckAt(fx + x);
      t.b.add(G.box(0.14, hh, 0.14), C.dark, x, -hh / 2, sz * fw * 0.38);
      t.m.bar([x, -hh, sz * fw * 0.38], [x + (sx ? -sx : 1) * 0.5, -0.06, sz * fw * 0.38], 0.04, C.dark).bar([x, -hh * 0.6, sz * fw * 0.38], [x, -hh * 0.6, -sz * fw * 0.1], 0.03, C.dark);
    }
    // edge lights
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) t.m.add(G.sph(0.05, 6, 4), i % 2 ? 0xff4a2a : 0x4aff6a, -fl / 2 + (fl * i) / 7, 0.13, s * fw * 0.5, { g: 3 });
    // a little island with the realm's flag
    t.push(-fl * 0.15, 0.06, fw * 0.42);
    t.b.add(G.box(0.6 * k, 0.55 * k, 0.32 * k), shade(c.hullC, 0.75), 0, 0.27 * k, 0);
    t.m.add(G.box(0.62 * k, 0.1 * k, 0.05), 0xffd88a, 0, 0.4 * k, -0.15 * k, { g: 1 });
    t.b.add(G.cyl(0.025, 0.025, 1.1 * k, 4), C.dark, 0, 0.55 * k + 0.55 * k, 0);
    t.push(0, 1.6 * k, 0.02); t.m.add(clothGeo(0.5, 0.32, 0.04, 0.08, 1), c.side, 0.25, 0, 0); t.pop();
    t.push(0, 1.65 * k, 0); finial(t.m, S, 0.45 * k); t.pop();
    t.pop();
    t.pop();
    // the catapult shuttle runs the track when she launches
    const sh = new DKit(); sh.add(G.box(0.3, 0.08, 0.16), S.met, 0, 0.04, 0, S.M).add(G.box(0.05, 0.14, 0.2), C.iron, 0.12, 0.1, 0, { m: 0.6, rz: -0.4 });
    const shm = sh.mesh(), x0 = fx - fl * 0.38; shm.position.set(x0, fy + 0.07, -fw * 0.18);
    c.addMoving(shm);
    act(c, 'launch', (kk) => { const f = kk < 0.25 ? ease(kk / 0.25) : 1 - ease((kk - 0.25) / 0.75); shm.position.x = x0 + f * fl * 0.78; });
    anchor(c, 'launch', [fx + fl * 0.4, fy + 0.3, -fw * 0.18]);
    parkFlier(c, fx - fl * 0.22, fy + 0.08, fw * 0.18, 0, 1.1);
    parkFlier(c, fx + fl * 0.2, fy + 0.08, -fw * 0.02, 0.3, 1.1);
    c.topAt = Math.max(c.topAt || 0, fy + 0.5);
  }),
  pad: part(2.5, (c) => {
    const S = sty(c), r = clamp(c.B * 0.33, 0.9, 1.6), at = c.place(r * 0.8, -0.26), y = 0.9, t = T(c), k = c.k;
    t.push(at.x, at.y, 0);
    // a lattice of legs and braces
    for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2 + PI / 6, a2 = ((i + 1) / 6) * PI * 2 + PI / 6; t.b.add(G.cyl(0.05, 0.07, y, 6), C.iron, Math.cos(a) * r * 0.72, y / 2, Math.sin(a) * r * 0.72, { m: 0.5 }); t.m.bar([Math.cos(a) * r * 0.72, 0.05, Math.sin(a) * r * 0.72], [Math.cos(a2) * r * 0.72, y - 0.1, Math.sin(a2) * r * 0.72], 0.02, C.iron, { m: 0.5 }); }
    t.b.add(G.cyl(r, r * 0.95, 0.12, 24), 0x3a3a3e, 0, y, 0, { m: 0.5 });
    t.m.add(G.tor(r, 0.04, 4, 32), S.met, 0, y + 0.05, 0, { ...S.M, rx: PI / 2 });
    for (let i = 0; i < 8; i++) t.m.add(G.box(r * 0.22, 0.02, 0.1), i % 2 ? c.side : 0xf0e8d0, Math.cos((i / 8) * PI * 2) * r * 0.8, y + 0.065, Math.sin((i / 8) * PI * 2) * r * 0.8, { ry: -(i / 8) * PI * 2 + PI / 2 });
    t.m.add(G.tor(r * 0.45, 0.04, 3, 24), 0xf0e8d0, 0, y + 0.065, 0, { rx: PI / 2 });
    t.push(0, y + 0.07, 0, -PI / 2, 0, 0); relief(t.m, S, r * 0.3, 0xf0e8d0, null, { m: 0 }); t.pop();
    for (let i = 0; i < 24; i++) t.f.add(G.box(0.012, 0.004, r * 0.95), shade(0x3a3a3e, 0.7), 0, y + 0.062, 0, { ry: (i / 24) * PI });
    t.push(r * 0.9, 0, 0); for (let i = 0; i < 6; i++) t.m.add(G.box(0.25, 0.04, 0.3), C.iron, -0.05 - i * 0.02, (y * (i + 0.5)) / 6, 0, { m: 0.5 }); t.pop();
    t.pop();
    // the rim lights flash when she launches
    const lk = new DKit(); for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; lk.add(G.sph(0.06, 6, 4), i % 3 ? S.glow : 0xffffff, Math.cos(a) * r, 0.1, Math.sin(a) * r); }
    const lm = glowMesh(lk, 0.6); lm.position.set(at.x, at.y + y, 0);
    c.addMoving(lm, (tt, ph) => { lm.material.opacity = lm.userData.base * (0.6 + 0.4 * (Math.sin(tt * 3 + ph) > 0.6 ? 1 : 0.3)) + (lm.userData.boost || 0); });
    act(c, 'launch', (kk) => { lm.userData.boost = pulses(kk, 4) * 0.8; });
    anchor(c, 'launch', [at.x, at.y + y + 0.3, 0]);
    parkFlier(c, at.x, at.y + y + 0.08, 0, 0.6, 0.95);
    c.topAt = Math.max(c.topAt || 0, at.y + y + 0.3);
  }),
  yurt: part(2.6, (c) => {
    const S = sty(c), r = clamp(c.hw(0) * 0.7, 0.8, 1.5), at = c.place(r, -0.12), t = T(c), h = 0.9 * c.k, k = c.k, felt = S.id === 'baobab' ? 0xc8a070 : C.felt;
    t.push(at.x, at.y, 0);
    t.b.add(G.cyl(r, r, h, 20), felt, 0, h / 2, 0, { r: 1 });
    t.b.add(G.lathe('yurtroof', [[0.16, 0.62], [0.5, 0.42], [1.0, 0.06], [1.06, 0]], 20), shade(felt, 0.88), 0, h, 0, { s: r, sy: r * 1.0, r: 1 });
    // painted bands and the lattice showing at the hem; roof poles and the smoke ring
    for (const [y, col] of [[h * 0.78, c.side], [h * 0.22, c.trimC]]) t.m.add(G.tor(r * 1.004, 0.045, 3, 28), col, 0, y, 0, { rx: PI / 2 });
    for (let i = 0; i < 28; i++) { const a = (i / 28) * PI * 2; t.f.add(G.box(0.012, 0.2, 0.012), S.wood, Math.cos(a) * r * 1.005, h * 0.1, Math.sin(a) * r * 1.005, { ry: -a, rz: i % 2 ? 0.5 : -0.5 }); }
    for (let i = 0; i < 16; i++) { const a = (i / 16) * PI * 2; t.m.bar([Math.cos(a) * r * 1.02, h + 0.02, Math.sin(a) * r * 1.02], [Math.cos(a) * r * 0.18, h + r * 0.6, Math.sin(a) * r * 0.18], 0.012, c.trimC); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * PI * 2 + PI / 4; t.m.add(tube([[Math.cos(a) * r * 1.02, h, Math.sin(a) * r * 1.02], [Math.cos(a) * r * 0.9, h * 0.5, Math.sin(a) * r * 0.9 + 0.01], [Math.cos(a) * r * 1.04, 0.05, Math.sin(a) * r * 1.04]], 0.012, 6, 3), C.rope, 0, 0, 0); }
    t.b.add(G.cyl(0.18 * r, 0.16 * r, 0.12, 10), S.dark, 0, h + r * 0.62, 0).add(G.tor(0.16 * r, 0.025, 3, 12), S.met, 0, h + r * 0.68, 0, { ...S.M, rx: PI / 2 });
    // painted door with a pattern
    t.push(r * 1.0, h * 0.42, 0, 0, faceRy(0), 0);
    t.b.add(G.box(r * 0.48, h * 0.8, 0.06), S.id === 'kurgan' ? 0x5a3a24 : 0xb02a1a, 0, 0, 0);
    t.m.add(G.box(r * 0.52, 0.05, 0.08), S.met, 0, h * 0.42, 0, S.M);
    relief(t.m, S, r * 0.13, S.met, S.motif === 'horn' ? 'horn' : 'sun');
    t.pop();
    t.push(0, h + r * 0.68, 0); for (let i = 0; i < 3; i++) t.m.add(G.cyl(0.015, 0.015, 0.6, 3), C.dark, (i - 1) * 0.05, 0.3, 0, { rz: (i - 1) * 0.25 }); t.m.add(G.cyl(0.05, 0.02, 0.4, 5), 0xd8c8a0, 0.1, 0.55, 0, { rz: -0.6 }); t.pop(); // horse-tail standard
    t.pop();
  }),
  dome: part(2.8, (c) => {
    const S = sty(c), r = clamp(c.hw(0) * 0.72, 0.8, 1.6), at = c.place(r, -0.1), t = T(c), k = c.k, col = S.roof === 'onion' ? blend(c.trimC, S.met, 0.5) : blend(c.trimC, 0xe8d8b0, 0.3), dh = 0.6 * k;
    const wall = blend(c.hullC, S.stone, 0.6);
    t.push(at.x, at.y, 0);
    t.b.add(G.cyl(r * 1.02, r * 1.08, 0.12, 20), shade(wall, 0.8), 0, 0.06, 0);
    t.b.add(G.cyl(r * 0.95, r, dh, 20), wall, 0, 0.12 + dh / 2, 0);
    // arched windows round the drum, pilasters between
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2;
      t.push(Math.cos(a) * r * 0.97, 0.12 + dh * 0.45, Math.sin(a) * r * 0.97, 0, faceRy(a), 0);
      t.m.add(G.box(0.18 * k, 0.3 * k, 0.03), 0xffd88a, 0, 0, 0, { g: 1.1 }).add(G.cyl(0.09 * k, 0.09 * k, 0.03, 10, false), 0xffd88a, 0, 0.15 * k, 0, { rx: PI / 2, g: 1.1 });
      t.f.add(G.tor(0.1 * k, 0.015, 3, 10, PI), S.met, 0, 0.15 * k, 0.02, S.M).add(G.box(0.012, 0.42 * k, 0.03), S.met, 0, 0.03, 0.02, S.M);
      t.pop();
      t.m.add(G.box(0.06, dh, 0.06), shade(wall, 0.85), Math.cos(a + PI / 8) * r * 0.97, 0.12 + dh / 2, Math.sin(a + PI / 8) * r * 0.97);
    }
    t.m.add(G.tor(r * 0.99, 0.04, 4, 28), S.met, 0, 0.12 + dh, 0, { ...S.M, rx: PI / 2 });
    t.push(0, 0.12 + dh, 0); const top = roofOf(t, S, r * 1.9, r * 1.9, col, S.roof === 'onion' ? 'onion' : 'dome', k); t.pop();
    // lantern cupola and finial
    const y = 0.12 + dh + top;
    t.b.add(G.cyl(0.12 * k, 0.14 * k, 0.25 * k, 8), wall, 0, y + 0.1 * k, 0);
    t.m.add(G.cyl(0.13 * k, 0.13 * k, 0.12 * k, 8), 0xffd88a, 0, y + 0.12 * k, 0, { g: 1.2 });
    t.b.add(G.cone(0.17 * k, 0.22 * k, 8), col, 0, y + 0.33 * k, 0, { m: 0.5 });
    t.push(0, y + 0.42 * k, 0); finial(t.m, S, 0.8 * k); t.pop();
    t.l.add(G.cyl(0.03, 0.05, 0.6, 5), S.met, 0, y + 0.5 * k, 0, S.M);
    t.pop();
    c.topAt = Math.max(c.topAt || 0, at.y + y + 0.9 * k);
  }),
  shrine: part(2, (c) => {
    const S = sty(c), w = clamp(c.B * 0.24, 0.7, 1.1), at = spot(c, w * 0.7, -0.3), t = T(c), k = c.k, wall = blend(c.trimC, S.roof === 'curved' ? 0xb02a1a : S.stone, 0.4);
    t.push(at.x, at.y, 0);
    t.b.add(G.box(w * 1.1, 0.12, w * 1.1), S.stone, 0, 0.06, 0).add(G.box(w * 0.9, 0.06, w * 0.9), shade(S.stone, 0.9), 0, 0.15, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { t.b.add(G.cyl(0.045, 0.05, w * 0.9, 8), wall, sx * w * 0.4, 0.18 + w * 0.45, sz * w * 0.4); t.m.add(G.cyl(0.07, 0.07, 0.05, 8), S.met, sx * w * 0.4, 0.2, sz * w * 0.4, S.M); }
    t.b.add(G.box(w * 0.6, w * 0.5, w * 0.5), shade(wall, 0.7), 0, 0.18 + w * 0.25, 0);
    // the image in its niche, offerings, a lamp
    t.m.add(G.box(0.02, w * 0.34, w * 0.3), 0x1a120a, w * 0.301, 0.18 + w * 0.27, 0);
    t.m.add(G.sph(0.08, 8, 6), S.glow, w * 0.29, 0.18 + w * 0.3, 0, { g: 2.5 });
    t.push(w * 0.33, 0.18 + w * 0.12, 0); t.m.add(G.custom('torso', () => new THREE.CapsuleGeometry(0.07, 0.16, 2, 6)), S.met, 0, 0.1, 0, { ...S.M, s: 0.6 * k }).add(G.sph(0.04 * k, 8, 6), S.met, 0, 0.2 * k, 0, S.M); t.pop();
    for (let i = 0; i < 3; i++) t.f.add(G.cyl(0.015, 0.015, 0.06, 5), 0xf0e8d8, w * 0.45, 0.2, (i - 1) * 0.08).add(G.sph(0.012, 4, 3), C.fire, w * 0.45, 0.24, (i - 1) * 0.08, { g: 3 });
    t.m.add(G.sph(0.04, 6, 4), 0xc83a2a, w * 0.42, 0.2, w * 0.25).add(G.sph(0.035, 6, 4), 0xe8c84a, w * 0.42, 0.2, -w * 0.25);
    t.push(0, 0.18 + w * 0.9, 0);
    t.b.add(G.box(w * 1.0, 0.06, w * 1.0), c.trimC, 0, 0.03, 0, { m: 0.4 });
    roofOf(t, S, w * 1.15, w * 1.15, shade(c.hullC, 0.6) || 0x3a3a3a, S.roof === 'flat' || S.roof === 'onion' ? 'dome' : S.roof, k * 0.6);
    t.pop();
    // a gate-arch before it for the curved-roof realms, a lamp post for the rest
    if (S.roof === 'curved') { t.push(w * 0.85, 0, 0); for (const s of [-1, 1]) t.b.add(G.cyl(0.04, 0.045, w * 1.1, 6), 0xc0201a, 0, 0.12 + w * 0.55, s * w * 0.35); t.b.add(G.box(0.08, 0.06, w * 1.0), 0xc0201a, 0, 0.12 + w * 1.05, 0).add(G.box(0.1, 0.06, w * 1.2), WOOD.black, 0, 0.12 + w * 1.14, 0); t.pop(); }
    else { t.push(w * 0.75, 0, w * 0.4); t.b.add(G.cyl(0.025, 0.03, 0.7, 5), S.dark, 0, 0.35, 0); t.push(0, 0.7, 0); lanternBox(t.m, S, 0.9); t.pop(); t.pop(); }
    t.pop();
  }),
  pulpit: part(1.8, (c) => {
    const S = sty(c), at = spot(c, 0.55, 0.12), t = T(c), col = blend(c.hullC, S.wood, 0.5), k = c.k;
    t.push(at.x, at.y, 0);
    t.b.add(G.lathe('pulpit', [[0, 0], [0.32, 0], [0.36, 0.1], [0.3, 0.25], [0.32, 0.85], [0.44, 1.05], [0.48, 1.12], [0.47, 1.16]], 12), col, 0, 0, 0, { r: 0.8 });
    // carved rune bands and knot-work, the realm's horns
    for (const y of [0.3, 0.6, 0.9]) t.m.add(G.tor(0.315 + y * 0.03, 0.025, 3, 16), S.met, 0, y, 0, { ...S.M, rx: PI / 2 });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; t.f.add(G.box(0.012, 0.2, 0.04), shade(col, 0.6), Math.cos(a) * 0.33, 0.45, Math.sin(a) * 0.33, { ry: -a, rz: i % 2 ? 0.4 : -0.4 }); }
    for (const z of [-1, 1]) t.m.add(taper([[0.15, 1.1, z * 0.38], [0.2, 1.3, z * 0.6], [0.05, 1.5, z * 0.62], [-0.05, 1.55, z * 0.5]], 0.06, 0.005, 8, 5), C.bone, 0, 0, 0, { r: 0.6 });
    t.b.add(G.box(0.25, 0.3, 0.35), col, 0.32, 1.25, 0, { rz: -0.4 }).add(G.box(0.2, 0.04, 0.32), 0xe8dcc0, 0.38, 1.38, 0, { rz: -0.4 });
    t.m.add(G.box(0.2, 0.012, 0.15), 0x5a1a14, 0.39, 1.405, 0.08, { rz: -0.4 });
    for (let i = 0; i < 4; i++) { t.b.add(G.box(0.25, 0.08, 0.4), col, -0.45 - i * 0.18, 0.9 - i * 0.24, 0); t.m.add(G.cyl(0.02, 0.02, 0.4, 4), S.dark, -0.55 - i * 0.18, 1.05 - i * 0.24, 0.2); }
    t.m.bar([-0.55, 1.25, 0.2], [-1.09, 0.53, 0.2], 0.02, S.dark);
    t.b.add(G.cyl(0.03, 0.03, 1.6, 4), C.dark, -0.3, 1.9, 0);
    t.push(-0.3, 2.6, 0.03); t.m.add(clothGeo(0.45, 0.7, 0.05, 0.15, 2), c.side, 0.24, 0, 0); t.pop();
    t.push(-0.27, 2.25, 0.08, 0, 0, 0); relief(t.m, S, 0.1, S.met); t.pop();
    t.push(-0.3, 2.7, 0); finial(t.m, S, 0.6 * k); t.pop();
    t.pop();
  }),
  sarcophagus: part(1.9, (c) => {
    const S = sty(c), l = clamp(c.B * 0.42, 1.2, 2), at = spot(c, l * 0.55, -0.05), t = T(c), k = c.k;
    const gothic = S.id === 'crimson', st = gothic ? 0x2a2428 : blend(C.stone, 0xd8c08a, 0.4), band = gothic ? 0x8a1a1a : 0x1a4a8a, met = gothic ? C.iron : C.gold;
    t.push(at.x, at.y, 0);
    t.b.add(G.box(l * 1.25, 0.2, l * 0.65), shade(st, 0.8), 0, 0.1, 0).add(G.box(l, 0.45, l * 0.42), st, 0, 0.42, 0);
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) t.m.add(G.box(l * 0.18, 0.28, 0.02), shade(st, 0.7), -l * 0.36 + i * l * 0.24, 0.42, s * l * 0.212);
    for (const s of [-1, 1]) for (let i = 0; i < 12; i++) t.f.add(G.box(0.04, 0.05, 0.012), gothic ? 0x8a1a1a : (i % 3 ? 0x1a4a8a : C.gold), -l * 0.42 + (l * 0.84 * i) / 11, 0.6, s * l * 0.215);
    // the lid: a carved figure lying in state
    t.b.add(G.box(l * 1.02, 0.12, l * 0.45), met, 0, 0.71, 0, { m: 0.85, r: 0.3 });
    t.push(0, 0.77, 0);
    t.m.add(G.custom('lidbody', () => new THREE.CapsuleGeometry(0.13, 0.7, 3, 8)), gothic ? 0x3a3438 : C.gold, -0.05 * l, 0.03, 0, { rz: PI / 2, sz: 0.8, sx: 0.5, m: 0.8, r: 0.3, s: l * 0.9 });
    t.m.add(G.sph(0.11 * l, 10, 8), gothic ? 0xd8d0c8 : C.gold, l * 0.4, 0.08, 0, { m: gothic ? 0 : 0.85, r: 0.3 });
    if (!gothic) { t.m.add(G.box(0.1 * l, 0.06, 0.32 * l), band, l * 0.38, 0.06, 0, { m: 0.3 }); for (const s of [-1, 1]) t.m.add(G.box(0.18 * l, 0.03, 0.06 * l), band, l * 0.34, 0.03, s * 0.15 * l, { ry: s * 0.3 }); t.m.add(G.box(0.25 * l, 0.03, 0.05), 0x1a4a8a, l * 0.05, 0.1, 0, { ry: 0.6 }).add(G.box(0.25 * l, 0.03, 0.05), C.gold, l * 0.05, 0.1, 0, { ry: -0.6, m: 0.8 }); }
    else for (let i = 0; i < 6; i++) t.m.add(G.cone(0.03, 0.12, 4), C.iron, -l * 0.4 + i * l * 0.16, 0.1, l * 0.18 * (i % 2 ? 1 : -1), { m: 0.7 });
    t.pop();
    // canopic jars or candles at the corners
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { t.push(sx * l * 0.58, 0.2, sz * l * 0.28); if (gothic) { t.m.add(G.cyl(0.03, 0.04, 0.25, 6), 0xe8e0d0, 0, 0.12, 0); t.m.add(G.sph(0.02, 4, 3), C.fire, 0, 0.27, 0, { g: 3 }); } else { t.m.add(G.lathe('canopic', [[0, 0], [0.05, 0], [0.07, 0.08], [0.055, 0.17], [0.03, 0.18]], 8), 0xd8c8a0, 0, 0, 0, { s: 1.3 }); t.m.add(G.sph(0.045, 8, 6), C.gold, 0, 0.26, 0, { m: 0.8 }); } t.pop(); }
    t.pop();
  }),
  // ================= weapons =================
  turrets: part(2.2, (c) => {
    const S = sty(c), r = clamp(c.B * 0.17, 0.45, 0.9), k = c.k;
    const units = [];
    [0.26, -0.26].forEach((pref, i) => {
      const at = c.place(r, pref, 'c'), t = T(c);
      t.push(at.x, at.y, 0);
      t.b.add(G.cyl(r * 1.05, r * 1.18, 0.2, 18), C.iron, 0, 0.1, 0, { m: 0.6 });
      t.m.add(G.tor(r * 1.1, 0.03, 3, 24), S.met, 0, 0.2, 0, { ...S.M, rx: PI / 2 });
      for (let q = 0; q < 16; q++) { const a = (q / 16) * PI * 2; t.f.add(G.sph(0.022, 4, 3), S.met, Math.cos(a) * r * 1.13, 0.1, Math.sin(a) * r * 1.13, S.M); }
      t.pop();
      const body = blend(c.hullC, S.metal === 'gold' || S.metal === 'brass' ? C.bronze : C.iron, 0.5);
      const bt = mover();
      bt.b.add(G.lathe('turret', [[0, 0], [0.98, 0], [1, 0.08], [0.98, 0.5], [0.82, 0.68], [0.5, 0.78], [0, 0.8]], 18), body, 0, 0, 0, { s: r, m: 0.65, r: 0.42 });
      bt.l.add(G.box(r * 0.6, r * 0.22, r * 0.8), shade(body, 0.85), r * 0.5, r * 0.4, 0);
      bt.b.add(G.box(r * 0.55, r * 0.5, r * 0.9), shade(body, 0.85), r * 0.62, r * 0.34, 0, { m: 0.6, r: 0.4 }); // mantlet
      bt.m.add(G.box(r * 0.5, r * 0.18, r * 0.5), shade(body, 0.7), -r * 0.25, r * 0.82, 0, { m: 0.6 });
      bt.m.add(G.cyl(r * 0.2, r * 0.2, r * 0.06, 12), shade(body, 0.8), -r * 0.25, r * 0.93, 0, { m: 0.6 });
      bt.f.add(G.tor(r * 0.08, r * 0.015, 3, 8), C.steel, -r * 0.25, r * 0.97, 0, { m: 0.8 });
      for (const z of [-1, 1]) bt.m.add(G.box(r * 0.25, r * 0.05, 0.02), 0x0a0a0a, r * 0.35, r * 0.6, z * r * 0.62, { ry: z * 0.6 });
      for (let q = 0; q < 24; q++) { const a = (q / 24) * PI * 2; for (const yy of [0.1, 0.45]) bt.f.add(G.sph(0.018 * k, 4, 3), S.met, Math.cos(a) * r * (yy < 0.2 ? 1.0 : 0.98), r * yy, Math.sin(a) * r * (yy < 0.2 ? 1.0 : 0.98), S.M); }
      for (const z of [-1, 1]) { bt.push(-r * 0.1, r * 0.34, z * r * 0.99, 0, z > 0 ? 0 : PI, 0); emblem(bt.m, S, r * 0.22, c.side, S.met); bt.pop(); }
      bt.push(-r * 0.25, r * 1.0, 0); finial(bt.m, S, r * 0.8); bt.pop();
      const pivot = moverMesh(c, bt); pivot.position.set(at.x, at.y + 0.2, 0);
      // the guns: on trunnions in the mantlet; they recoil and elevate
      const gt = mover();
      for (const z of [-1, 1]) {
        gt.push(0, 0, z * r * 0.26, 0, 0, -PI / 2);
        gt.b.add(G.lathe('tgun', [[0, -0.1], [0.14, -0.1], [0.15, 0.1], [0.12, 0.2], [0.095, 0.3], [0.08, 1.3], [0.1, 1.36], [0.1, 1.48], [0.065, 1.48], [0.065, 1.2]], 10), C.iron, 0, 0, 0, { s: r, m: 0.8, r: 0.35 });
        gt.l.add(G.cyl(r * 0.09, r * 0.1, r * 1.4, 5), C.iron, 0, r * 0.65, 0);
        gt.m.add(G.cyl(r * 0.12, r * 0.12, r * 0.1, 10), S.met, 0, r * 1.42, 0, S.M);
        for (const y of [0.35, 0.7, 1.0]) gt.f.add(G.tor(r * 0.09, r * 0.012, 3, 10), S.met, 0, r * y, 0, { ...S.M, rx: PI / 2 });
        gt.pop();
      }
      const recoil = moverMesh(c, gt), elev = new THREE.Group(); elev.position.set(r * 0.72, r * 0.36, 0); elev.add(recoil); pivot.add(elev);
      const home = i ? PI : 0;
      pivot.rotation.y = home;
      c.addMoving(pivot, (tt, ph) => { pivot.rotation.y = home + Math.sin(tt * 0.25 + ph + i * 2) * 1.1 + (pivot.userData.jolt || 0); });
      units.push({ pivot, elev, recoil, i });
    });
    act(c, 'fire', (kk) => { for (const u of units) { const kk2 = clamp(kk * 1.15 - u.i * 0.12, 0, 1); u.recoil.position.x = -kick(kk2, 0.06) * r * 0.4; u.elev.rotation.z = bump(kk2) * 0.08; } });
    act(c, 'flak', (kk) => { for (const u of units) { const up = kk < 0.2 ? ease(kk / 0.2) : kk > 0.8 ? 1 - ease((kk - 0.8) / 0.2) : 1; u.elev.rotation.z = up * 0.95; u.recoil.position.x = kk > 0.2 && kk < 0.8 ? -kick(((kk - 0.2) / 0.6 * 3 + u.i * 0.5) % 1, 0.15) * r * 0.3 : 0; } });
    act(c, 'hit', (kk) => { for (const u of units) u.pivot.userData.jolt = Math.sin(kk * 30) * 0.06 * (1 - kk) * (kk < 1 ? 1 : 0); });
  }),
  ballista: part(2, (c) => {
    const S = sty(c), at = spot(c, 0.6, 0.3, 'c'), s = clamp(c.B * 0.3, 0.9, 1.5), t = T(c), wood = S.crude ? 0x7a5a3a : S.wood;
    // tripod mount, static
    t.push(at.x, at.y, 0, 0, 0, 0, s);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2; t.b.add(taper([[Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35], [0, 0.45, 0]], 0.05, 0.04, 2, 5), wood, 0, 0, 0); t.m.add(G.box(0.1, 0.03, 0.08), S.met, Math.cos(a) * 0.35, 0.015, Math.sin(a) * 0.35, { ...S.M, ry: -a }); }
    t.b.add(G.cyl(0.12, 0.14, 0.12, 10), S.met, 0, 0.48, 0, S.M);
    t.pop();
    // the engine turns on its pivot
    const b = mover();
    b.push(0, 0, 0, 0, 0, 0, s);
    b.b.add(G.box(1.15, 0.1, 0.16), wood, 0.12, 0.08, 0, { rz: 0.05 });
    b.m.add(G.box(0.9, 0.025, 0.04), shade(wood, 0.6), 0.15, 0.14, 0, { rz: 0.05 }); // the groove
    b.b.add(G.box(0.18, 0.22, 0.42), shade(wood, 0.85), 0.55, 0.1, 0); // the head (bow-frame)
    for (const z of [-1, 1]) { b.m.add(G.cyl(0.07, 0.07, 0.2, 10), S.crude ? C.rope : S.met, 0.55, 0.1, z * 0.13, S.crude ? {} : S.M); b.f.add(G.tor(0.07, 0.012, 3, 10), S.met, 0.55, 0.2, z * 0.13, { ...S.M, rx: PI / 2 }); }
    // the arms, sweeping back, capped in the realm's metal
    const arm = (z) => taper([[0.55, 0.12, z * 0.18], [0.5, 0.14, z * 0.42], [0.38, 0.15, z * 0.68], [0.3, 0.16, z * 0.8]], 0.065, 0.03, 8, 6);
    for (const z of [-1, 1]) { b.b.add(arm(z), shade(wood, 0.8), 0, 0, 0); b.m.add(G.cone(0.03, 0.09, 6), S.met, 0.3, 0.16, z * 0.8, { ...S.M, rx: z * PI / 2 }); }
    // winch and its handles at the tail; the trigger
    b.m.add(G.cyl(0.04, 0.04, 0.3, 8), wood, -0.38, 0.12, 0, { rx: PI / 2 });
    for (const z of [-1, 1]) { b.m.add(G.cyl(0.08, 0.08, 0.025, 10), S.met, -0.38, 0.12, z * 0.16, { ...S.M, rx: PI / 2 }); for (let q = 0; q < 4; q++) b.f.add(G.box(0.012, 0.18, 0.012), S.met, -0.38, 0.12, z * 0.17, { ...S.M, rx: 0, rz: (q * PI) / 4 }); }
    b.m.add(G.box(0.03, 0.08, 0.02), S.met, -0.2, 0.03, 0, S.M);
    // a curved mantlet below the bolt-groove, with the realm's device
    b.b.add(G.box(0.05, 0.24, 0.62), S.crude ? shade(wood, 0.8) : S.cloth, 0.72, -0.04, 0, { rz: -0.15 });
    b.m.add(G.box(0.06, 0.03, 0.64), S.crude ? C.rope : S.met, 0.73, 0.08, 0, { ...S.M, rz: -0.15 }).add(G.box(0.06, 0.03, 0.64), S.crude ? C.rope : S.met, 0.71, -0.16, 0, { ...S.M, rz: -0.15 });
    b.push(0.755, -0.04, 0, 0, PI / 2, -0.15); emblem(b.m, S, 0.1, S.cloth, S.met); b.pop();
    b.pop();
    const bm = moverMesh(c, b); bm.position.set(at.x, at.y + 0.5 * s, 0);
    // string and bolt: drawn back, they slide forward and the bolt flies on loosing
    const sb = new DKit();
    sb.push(0, 0, 0, 0, 0, 0, s);
    sb.bar([0.3, 0.16, -0.78], [-0.25, 0.16, 0], 0.008, C.rope).bar([0.3, 0.16, 0.78], [-0.25, 0.16, 0], 0.008, C.rope);
    sb.pop();
    const str = sb.mesh();
    const bk = new DKit(); bk.push(0, 0, 0, 0, 0, 0, s);
    bk.add(G.cyl(0.022, 0.022, 0.9, 6), C.wood, 0.2, 0.18, 0, { rz: PI / 2 }).add(G.cone(0.045, 0.16, 4), C.steel, 0.72, 0.18, 0, { rz: -PI / 2, m: 0.8 });
    for (let q = 0; q < 3; q++) bk.add(G.box(0.1, 0.002, 0.05), c.side, -0.18, 0.18, 0, { rx: (q * PI) / 3 });
    bk.pop();
    const bolt = holder(bk.mesh());
    bm.add(str, bolt);
    c.addMoving(bm, (tt, ph) => { bm.rotation.y = Math.sin(tt * 0.3 + ph) * 0.6; });
    const loose = (kk) => { const f = kick(kk, 0.06); str.position.x = (kk > 0 && kk < 1 ? (kk < 0.08 ? kk / 0.08 : 1 - ease((kk - 0.08) / 0.8)) : 0) * 0.45 * s; bolt.visible = !(kk > 0.06 && kk < 0.85); bolt.position.x = kk >= 0.85 && kk < 1 ? -(1 - ease((kk - 0.85) / 0.15)) * 0.3 * s : 0; bm.position.y = at.y + 0.5 * s + f * 0.02; };
    act(c, 'fire', loose); act(c, 'flak', loose); act(c, 'harpoon', loose);
    anchor(c, 'harpoon', [at.x + 0.7 * s, at.y + 0.7 * s, 0]);
  }),
  repeater: part(1.6, (c) => {
    const S = sty(c), units = [];
    for (const pref of [0.2, -0.22]) {
      const at = spot(c, 0.45, pref, 's'), s = c.k, out = Math.sign(at.z || 1), t = T(c), body = S.metal === 'iron' || S.metal === 'black' || S.metal === 'rust' ? C.bronze : S.met;
      t.push(at.x, at.y, at.z, 0, out > 0 ? -PI / 2 : PI / 2, 0, s);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2; t.b.add(taper([[Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28], [0, 0.55, 0]], 0.03, 0.025, 2, 5), C.iron, 0, 0, 0, { m: 0.5 }); }
      t.b.add(G.cyl(0.07, 0.09, 0.1, 8), C.iron, 0, 0.58, 0, { m: 0.6 });
      t.pop();
      // the gun: frame, hopper, crank; and the barrel cluster that spins
      const g = mover();
      g.b.add(G.box(0.45, 0.2, 0.28), body, -0.05, 0.08, 0, { m: 0.7, r: 0.35 });
      g.m.add(G.box(0.22, 0.2, 0.18), C.wood, -0.05, 0.28, 0).add(G.box(0.24, 0.03, 0.2), body, -0.05, 0.39, 0, { m: 0.7 });
      for (let q = 0; q < 5; q++) g.f.add(G.cyl(0.015, 0.015, 0.17, 5), 0xc8a050, -0.12 + q * 0.035, 0.42, 0, { rx: PI / 2, m: 0.8 });
      g.m.add(G.cyl(0.08, 0.08, 0.03, 10), body, -0.1, 0.08, 0.16, { rx: PI / 2, m: 0.7 }).bar([-0.1, 0.08, 0.18], [-0.18, 0.0, 0.2], 0.012, C.iron).add(G.cyl(0.015, 0.015, 0.08, 4), C.wood, -0.18, 0.0, 0.24, { rx: PI / 2 });
      for (const z of [-1, 1]) g.m.add(G.box(0.18, 0.05, 0.02), S.met, 0.08, 0.17, z * 0.14, S.M);
      g.push(-0.05, 0.1, 0.145); relief(g.f, S, 0.07, S.met); g.pop();
      const gm = moverMesh(c, g);
      const cl = mover();
      cl.push(0, 0, 0, 0, 0, -PI / 2);
      for (let q = 0; q < 6; q++) { const a = (q / 6) * PI * 2; cl.b.add(G.cyl(0.026, 0.026, 0.62, 6), C.iron, Math.cos(a) * 0.065, 0.31, Math.sin(a) * 0.065, { m: 0.8, r: 0.3 }); cl.f.add(G.cyl(0.016, 0.016, 0.01, 6), 0x050505, Math.cos(a) * 0.065, 0.625, Math.sin(a) * 0.065); }
      for (const y of [0.05, 0.4, 0.6]) cl.m.add(G.cyl(0.1, 0.1, 0.035, 12), body, 0, y, 0, { m: 0.7 });
      cl.pop();
      const cm = moverMesh(c, cl); cm.position.set(0.18, 0.08, 0);
      gm.add(cm);
      const mount = new THREE.Group(); mount.position.set(at.x, at.y + 0.6 * s, at.z); mount.rotation.y = out > 0 ? -PI / 2 : PI / 2; mount.scale.setScalar(s);
      mount.add(gm);
      c.addMoving(mount, (tt, ph) => { gm.rotation.y = Math.sin(tt * 0.4 + ph + pref * 5) * 0.5; });
      units.push({ gm, cm });
    }
    const burst = (kk) => { for (const u of units) { u.cm.rotation.x = spinK(kk, 3); u.cm.position.x = 0.18 - pulses(kk, 6, 0.3) * 0.025; } };
    act(c, 'fire', burst);
    act(c, 'flak', (kk) => { burst(kk); for (const u of units) u.gm.rotation.z = bump(kk) * 0.7; });
  }),
  harpoonGun: part(1.8, (c) => {
    const S = sty(c), at = spot(c, 0.5, 0.36, 'c'), t = T(c), k = c.k;
    t.push(at.x, at.y, 0, 0, 0, 0, k);
    t.b.add(G.lathe('hgped', [[0, 0], [0.24, 0], [0.24, 0.06], [0.14, 0.12], [0.12, 0.45], [0.16, 0.5], [0, 0.5]], 10), C.dark, 0, 0, 0, { r: 0.7 });
    for (let q = 0; q < 8; q++) { const a = (q / 8) * PI * 2; t.f.add(G.sph(0.016, 4, 3), S.met, Math.cos(a) * 0.2, 0.04, Math.sin(a) * 0.2, S.M); }
    // the line tub, coiled
    t.push(-0.55, 0, 0.15);
    t.b.add(G.cyl(0.24, 0.22, 0.22, 12, true), S.wood, 0, 0.11, 0);
    for (const y of [0.04, 0.18]) t.m.add(G.tor(0.235, 0.015, 3, 14), S.met, 0, y, 0, { ...S.M, rx: PI / 2 });
    for (let q = 0; q < 4; q++) t.m.add(G.tor(0.17 - q * 0.03, 0.035, 4, 14), C.rope, 0, 0.17 + q * 0.012, 0, { rx: PI / 2 });
    t.pop();
    t.m.add(tube([[-0.5, 0.25, 0.15], [-0.2, 0.45, 0.1], [0.1, 0.62, 0.02], [0.3, 0.7, 0]], 0.012, 10, 3), C.rope, 0, 0, 0);
    t.pop();
    // gun on its yoke: recoils, the harpoon leaves and is reloaded
    const g = mover();
    g.push(0, 0, 0, 0, 0, 0, k);
    for (const z of [-1, 1]) g.b.add(G.box(0.08, 0.22, 0.04), S.met, 0, 0.1, z * 0.13, S.M);
    g.m.add(G.cyl(0.04, 0.04, 0.3, 8), C.iron, 0, 0.18, 0, { rx: PI / 2, m: 0.7 });
    g.pop();
    const gm = moverMesh(c, g); gm.position.set(at.x, at.y + 0.5 * k, 0);
    const br = mover();
    br.push(0, 0, 0, 0, 0, 0, k);
    br.push(0, 0.18, 0, 0, 0, -PI / 2 + 0.2);
    br.b.add(G.lathe('hgun', [[0, -0.35], [0.1, -0.35], [0.11, -0.2], [0.09, -0.1], [0.075, 0.6], [0.09, 0.64], [0.09, 0.72], [0.06, 0.72]], 10), C.iron, 0, 0, 0, { m: 0.75, r: 0.35 });
    br.m.add(G.box(0.04, 0.3, 0.08), S.wood, 0.1, -0.4, 0).add(G.cyl(0.015, 0.015, 0.16, 4), C.wood, -0.12, -0.3, 0, { rz: PI / 2 });
    for (const y of [-0.15, 0.2, 0.5]) br.f.add(G.tor(0.08, 0.01, 3, 10), S.met, 0, y, 0, { ...S.M, rx: PI / 2 });
    br.m.add(G.box(0.03, 0.08, 0.02), S.met, 0.08, 0.35, 0, S.M); // sight
    br.pop();
    br.pop();
    const bm = moverMesh(c, br); gm.add(bm);
    const hk = new DKit(); hk.push(0, 0, 0, 0, 0, 0, k); hk.push(0, 0.18, 0, 0, 0, -PI / 2 + 0.2);
    hk.add(G.cyl(0.022, 0.022, 0.5, 5), C.wood, 0, 0.88, 0).add(G.cone(0.065, 0.24, 6), C.steel, 0, 1.24, 0, { m: 0.85, r: 0.3 });
    for (const z of [-1, 1]) for (const x of [-1, 1]) hk.add(G.cone(0.018, 0.15, 3), C.steel, x * 0.04, 1.11, z * 0.04, { rz: x * 2.7, rx: z * 0.3, m: 0.85 });
    hk.add(G.tor(0.03, 0.008, 3, 8), C.iron, 0, 0.65, 0, { m: 0.7 });
    hk.pop(); hk.pop();
    const head = holder(hk.mesh()); gm.add(head);
    c.addMoving(gm, (tt, ph) => { gm.rotation.y = Math.sin(tt * 0.35 + ph) * 0.35; });
    act(c, 'harpoon', (kk) => { const f = kick(kk, 0.05); bm.position.x = -f * 0.18 * k; bm.rotation.z = f * 0.12; head.position.x = bm.position.x; head.rotation.z = bm.rotation.z; head.visible = !(kk > 0.04 && kk < 0.75); if (kk >= 0.75 && kk < 1) head.position.x = -(1 - ease((kk - 0.75) / 0.25)) * 0.4 * k; });
    anchor(c, 'harpoon', [at.x + 1.3 * k, at.y + 0.95 * k, 0]);
  }),
  winch: part(1.8, (c) => {
    const S = sty(c), at = spot(c, 0.6, 0.14, 'c'), t = T(c), w = clamp(c.B * 0.32, 0.9, 1.5), wood = S.wood;
    t.push(at.x, at.y, 0);
    for (const z of [-1, 1]) {
      t.b.add(taper([[-0.38, 0, z * w / 2], [0, 0.75, z * w / 2]], 0.07, 0.055, 2, 6), wood, 0, 0, 0).add(taper([[0.38, 0, z * w / 2], [0, 0.75, z * w / 2]], 0.07, 0.055, 2, 6), wood, 0, 0, 0);
      t.m.add(G.box(0.8, 0.07, 0.1), wood, 0, 0.05, z * w / 2).add(G.box(0.4, 0.06, 0.08), wood, 0, 0.35, z * w / 2);
      t.m.add(G.cyl(0.08, 0.08, 0.06, 10), S.met, 0, 0.62, z * (w / 2 + 0.04), { ...S.M, rx: PI / 2 });
      for (let q = 0; q < 4; q++) t.f.add(G.sph(0.018, 4, 3), S.met, -0.3 + q * 0.2, 0.05, z * (w / 2 + 0.05), S.M);
    }
    // pawl and ratchet, crank handles
    t.m.add(G.box(0.25, 0.04, 0.04), C.iron, 0.2, 0.92, w / 2 + 0.12, { rz: -0.5, m: 0.6 });
    for (const z of [-1, 1]) t.m.bar([0, 0.62, z * (w / 2 + 0.1)], [0, 0.95, z * (w / 2 + 0.14)], 0.02, C.iron, { m: 0.6 }).add(G.cyl(0.02, 0.02, 0.18, 5), C.wood, 0, 0.95, z * (w / 2 + 0.22), { rx: PI / 2 });
    t.pop();
    // the drum turns when the line pays out
    const d = mover();
    d.b.add(G.cyl(0.26, 0.26, w * 0.85, 14), wood, 0, 0, 0, { rx: PI / 2 });
    for (const z of [-1, 1]) { d.b.add(G.cyl(0.4, 0.4, 0.05, 18), S.met, 0, 0, z * (w * 0.43), { ...S.M, rx: PI / 2 }); for (let q = 0; q < 18; q++) { const a = (q / 18) * PI * 2; d.m.add(G.box(0.05, 0.05, 0.05), S.met, Math.cos(a) * 0.42, Math.sin(a) * 0.42, z * w * 0.43, { ...S.M, rz: a }); } for (let q = 0; q < 4; q++) d.f.add(G.box(0.7, 0.04, 0.02), shade(S.met, 0.8), 0, 0, z * (w * 0.43 + 0.03 * z), { rz: (q * PI) / 4 }); }
    for (let i = 0; i < 9; i++) d.m.add(G.tor(0.285, 0.03, 4, 14), S.crude ? C.rope : C.iron, 0, 0, -w * 0.38 + (w * 0.76 * i) / 8, { m: S.crude ? 0 : 0.6 });
    for (let q = 0; q < 12; q++) { const a = (q / 12) * PI * 2; d.f.add(G.box(0.01, 0.01, w * 0.85), shade(wood, 0.6), Math.cos(a) * 0.262, Math.sin(a) * 0.262, 0); }
    const dm = moverMesh(c, d); dm.position.set(at.x, at.y + 0.62, 0);
    c.addMoving(dm);
    act(c, 'harpoon', (kk) => { dm.rotation.z = -spinK(kk, 3); });
    act(c, 'grapple', (kk) => { dm.rotation.z = spinK(kk, 2); });
    c.kit.rope([at.x + 0.25, at.y + 0.85, 0], [c.bowX - 0.2, c.deckAt(c.bowX - 0.4) + 0.3, 0], 0.08, 0.03, C.iron);
  }),
  kegs: part(1, (c) => {
    const S = sty(c);
    for (const pref of [0.12, -0.3]) {
      const at = spot(c, 0.45, pref, 's'), t = T(c);
      for (let i = 0; i < 4; i++) { t.push(at.x + (i % 2) * 0.3 - 0.15, at.y + (i > 1 ? 0.36 : 0), at.z + (i % 2 ? 0.08 : -0.08), 0, i * 0.9, 0); barrel(t, 0x5a3a24, 0.36, 0xb02a1a, i % 2 ? 0xe8c83a : 0x1a1a1a); t.pop(); }
      // the fuse-bundle, a lit match in a tub, the rope lashing them down
      t.m.add(G.cyl(0.01, 0.01, 0.25, 3), C.rope, at.x, at.y + 0.85, at.z).add(G.sph(0.03, 4, 3), C.fire, at.x, at.y + 0.98, at.z, { g: 3 });
      t.m.add(tube([[at.x - 0.35, at.y + 0.02, at.z - 0.3], [at.x - 0.3, at.y + 0.6, at.z], [at.x + 0.35, at.y + 0.6, at.z], [at.x + 0.4, at.y + 0.02, at.z + 0.3]], 0.015, 12, 3), C.rope, 0, 0, 0);
      t.push(at.x + 0.42, at.y, at.z); t.m.add(G.cyl(0.08, 0.07, 0.12, 8), S.wood, 0, 0.06, 0).add(G.cyl(0.006, 0.006, 0.2, 3), C.rope, 0, 0.18, 0, { rz: 0.3 }).add(G.sph(0.015, 4, 3), C.fire, -0.03, 0.28, 0, { g: 3 }); t.pop();
      t.f.add(G.box(0.08, 0.002, 0.06), 0xe8e0c8, at.x - 0.15, at.y + 0.72, at.z - 0.08);
    }
  }),
  trebuchet: part(3, (c) => {
    const S = sty(c), h = clamp(c.L * 0.3, 2.4, 4), at = c.place(clamp(c.B * 0.3, 0.9, 1.4), 0, 'c'), t = T(c), w = clamp(c.B * 0.34, 0.9, 1.4), wood = S.wood, k = c.k;
    const ha = h * 0.62, Ll = h * 0.78, Ls = h * 0.24;
    t.push(at.x, at.y, 0);
    // base: sills, cross-beams, wheels in chocks
    for (const z of [-1, 1]) { t.b.add(G.box(h * 0.85, 0.14, 0.14), shade(wood, 0.9), 0, 0.07, z * w * 0.42); for (const x of [-1, 1]) { t.m.add(G.cyl(0.16, 0.16, 0.06, 12), shade(wood, 0.8), x * h * 0.32, 0.16, z * w * 0.52, { rx: PI / 2 }); t.f.add(G.tor(0.16, 0.015, 3, 12), S.met, x * h * 0.32, 0.16, z * w * 0.55, S.M); } }
    for (const x of [-0.35, 0, 0.35]) t.b.add(G.box(0.12, 0.1, w * 0.95), shade(wood, 0.85), x * h, 0.14, 0);
    // A-frames, braces, axle bearings
    for (const z of [-1, 1]) {
      t.b.add(taper([[-h * 0.32, 0.12, z * w * 0.42], [0, ha, z * w * 0.42]], 0.07, 0.055, 2, 6), wood, 0, 0, 0).add(taper([[h * 0.32, 0.12, z * w * 0.42], [0, ha, z * w * 0.42]], 0.07, 0.055, 2, 6), wood, 0, 0, 0);
      t.m.add(G.box(h * 0.36, 0.06, 0.08), wood, 0, ha * 0.45, z * w * 0.42).bar([0, 0.14, z * w * 0.42], [0, ha - 0.1, z * w * 0.42], 0.045, wood);
      t.m.add(G.box(0.2, 0.16, 0.12), S.met, 0, ha, z * w * 0.42, S.M);
      for (let q = 0; q < 4; q++) t.f.add(G.sph(0.02, 4, 3), S.met, (q % 2 ? 1 : -1) * 0.06, ha + (q > 1 ? 0.05 : -0.05), z * (w * 0.42 + 0.065), S.M);
    }
    t.m.add(G.box(0.1, 0.1, w * 0.95), wood, 0, ha * 0.45, 0);
    // the realm's shield on the frame, and a stone or two ready
    for (const z of [-1, 1]) { t.push(h * 0.12, ha * 0.62, z * (w * 0.42 + 0.05), 0, z > 0 ? 0 : PI, 0); emblem(t.m, S, 0.18 * k, c.side, S.met); t.pop(); }
    for (let q = 0; q < 3; q++) t.m.add(G.dod(0.13 * k), C.stone, -h * 0.15 + q * 0.2, 0.22, w * 0.15 * (q % 2 ? 1 : -1), { r: 0.9 });
    t.l.add(G.box(0.1, 0.1, w * 0.9), wood, 0, ha, 0);
    t.pop();
    // the arm, counterweight and sling move together; rest = cocked (long end down aft)
    const arm = mover();
    arm.b.add(taper([[-Ls, 0, 0], [0, 0, 0], [Ll, 0, 0]], 0.1 * k, 0.045 * k, 4, 6), wood, 0, 0, 0);
    arm.m.add(G.cyl(0.06, 0.06, w * 0.95, 10), C.iron, 0, 0, 0, { rx: PI / 2, m: 0.7 });
    for (const x of [-Ls * 0.6, Ll * 0.2, Ll * 0.5, Ll * 0.8]) arm.f.add(G.tor(0.08 * k * (1 - x / (Ll * 1.6)), 0.015, 3, 10), S.met, x, 0, 0, { ...S.M, ry: PI / 2 });
    arm.m.add(G.tor(0.05, 0.012, 3, 8), C.iron, Ll, 0, 0, { m: 0.7 });
    const am = moverMesh(c, arm);
    // the counterweight box swings from the short end and stays plumb
    const cw = mover(), cwz = w * 0.5;
    for (const z of [-1, 1]) cw.b.add(G.box(0.05, 0.4 * k, 0.05), C.iron, 0, -0.2 * k, z * 0.12, { m: 0.6 });
    const cwCol = S.crude ? 0x6a6a60 : S.id === 'glimmer' ? C.bronze : shade(wood, 0.8);
    cw.b.add(G.box(0.55 * k, 0.5 * k, cwz), cwCol, 0, -0.62 * k, 0, { r: S.id === 'glimmer' ? 0.4 : 0.85, m: S.id === 'glimmer' ? 0.7 : 0 });
    for (const y of [-0.42, -0.62, -0.82]) cw.m.add(G.box(0.57 * k, 0.04, cwz * 1.02), S.met, 0, y * k, 0, S.M);
    if (S.crude) for (let q = 0; q < 4; q++) cw.m.add(G.dod(0.12 * k), C.stone, (q - 1.5) * 0.13 * k, -0.33 * k, 0, { r: 0.9 });
    for (const z of [-1, 1]) { cw.push(0, -0.62 * k, z * (cwz / 2 + 0.005), 0, z > 0 ? 0 : PI, 0); relief(cw.f, S, 0.14 * k, S.met); cw.pop(); }
    const cwm = moverMesh(c, cw); cwm.position.set(-Ls, 0, 0); am.add(cwm);
    // the sling: two cords and a pouch with its stone, hanging from the long end
    const sl = new DKit();
    sl.bar([0, 0, 0.03], [0.02, -0.55 * k, 0.07], 0.01, C.rope).bar([0, 0, -0.03], [0.02, -0.55 * k, -0.07], 0.01, C.rope);
    sl.add(G.hemi(0.12 * k, 8, 4), 0x6a5236, 0.02, -0.55 * k, 0, { rx: PI, r: 1 });
    const slm = sl.mesh(); slm.position.set(Ll, 0, 0); am.add(slm);
    const stK = new DKit(); stK.add(G.dod(0.11 * k), C.stone, 0, 0, 0, { r: 0.9 }); const stone = holder(stK.mesh()); stone.position.set(0.02, -0.6 * k, 0); slm.add(stone);
    const pivot = new THREE.Group(); pivot.position.set(at.x, at.y + ha, 0); pivot.add(am);
    const rest = PI + 0.42;
    const pose = (th) => { am.rotation.z = th; cwm.rotation.z = -th; slm.rotation.z = -th; };
    pose(rest);
    c.addMoving(pivot);
    act(c, 'mortar', (kk) => {
      const throwK = kk < 0.22 ? ease(kk / 0.22) : 1 - ease((kk - 0.3) / 0.7) * (kk > 0.3 ? 1 : 0);
      const th = rest - throwK * 2.5;
      pose(th);
      // the sling whips past the arm as it goes over
      slm.rotation.z = -th + (kk > 0 && kk < 0.4 ? Math.sin(clamp(kk / 0.3, 0, 1) * PI) * 1.6 : 0);
      stone.visible = !(kk > 0.18 && kk < 0.9);
    });
    anchor(c, 'mortar', [at.x, at.y + ha + Ll, 0]);
    c.topAt = Math.max(c.topAt || 0, at.y + ha + Ll * 0.6);
  }),
  catapult: part(2, (c) => {
    const S = sty(c), at = spot(c, 0.7, 0.12, 'c'), s = clamp(c.B * 0.3, 0.9, 1.5), t = T(c), wood = S.crude ? 0x7a5a3a : S.wood;
    t.push(at.x, at.y, 0, 0, 0, 0, s);
    t.b.add(G.box(1.25, 0.12, 0.62), wood, 0, 0.1, 0);
    for (const z of [-1, 1]) {
      t.b.add(G.box(1.2, 0.12, 0.1), shade(wood, 0.85), 0, 0.2, z * 0.3);
      for (const x of [-0.45, 0.45]) { t.m.add(G.cyl(0.13, 0.13, 0.06, 12), shade(wood, 0.75), x, 0.13, z * 0.36, { rx: PI / 2 }); for (let q = 0; q < 3; q++) t.f.add(G.box(0.24, 0.02, 0.02), shade(wood, 0.6), x, 0.13, z * 0.39, { rz: (q * PI) / 3 }); }
      t.b.add(taper([[0.2, 0.2, z * 0.28], [0.25, 0.95, z * 0.28]], 0.06, 0.05, 2, 5), wood, 0, 0, 0);
      t.m.bar([-0.1, 0.22, z * 0.28], [0.24, 0.8, z * 0.28], 0.04, wood).bar([0.55, 0.22, z * 0.28], [0.26, 0.8, z * 0.28], 0.04, wood);
    }
    t.b.add(G.box(0.12, 0.12, 0.68), shade(wood, 0.8), 0.26, 0.95, 0);
    t.m.add(G.cyl(0.08, 0.08, 0.5, 8), S.crude ? 0x8a7a5a : 0xb02a1a, 0.2, 0.95, 0, { rx: PI / 2 }); // padding
    // the torsion skein and the windlass
    t.m.add(G.cyl(0.11, 0.11, 0.5, 10), C.rope, -0.35, 0.26, 0, { rx: PI / 2 });
    for (const z of [-1, 1]) t.m.add(G.cyl(0.14, 0.14, 0.05, 10), S.met, -0.35, 0.26, z * 0.3, { ...S.M, rx: PI / 2 });
    t.m.add(G.cyl(0.05, 0.05, 0.55, 8), wood, -0.58, 0.3, 0, { rx: PI / 2 });
    for (let q = 0; q < 2; q++) t.m.add(G.box(0.3, 0.025, 0.025), wood, -0.58, 0.3, (q ? 1 : -1) * 0.22, { rz: q * PI / 2 });
    if (S.crude) for (const z of [-1, 1]) { t.push(0.26, 1.02, z * 0.32); skull(t.m, 0.8); t.pop(); }
    else { t.push(0.32, 0.95, 0, 0, PI / 2, 0); emblem(t.m, S, 0.08, S.cloth, S.met); t.pop(); }
    t.pop();
    // the arm swings from the skein up to the cross-bar
    const a = mover();
    a.push(0, 0, 0, 0, 0, 0, s);
    a.b.add(taper([[0, 0, 0], [0, 0.95, 0]], 0.055, 0.04, 2, 6), wood, 0, 0, 0);
    for (const y of [0.25, 0.55]) a.f.add(G.tor(0.05, 0.01, 3, 8), S.met, 0, y, 0, { ...S.M, rx: PI / 2 });
    a.b.add(G.lathe('catbucket', [[0, 0], [0.12, 0.01], [0.18, 0.08], [0.2, 0.14]], 10), S.crude ? 0x5a4a32 : C.dark, 0, 1.0, 0, { r: 0.8 });
    a.pop();
    const am = moverMesh(c, a);
    const sk = new DKit(); sk.push(0, 0, 0, 0, 0, 0, s);
    if (S.crude || S.motif === 'skull') { sk.push(0, 1.04, 0, 0, 0, 0, 0.9); skull(sk, 1); sk.pop(); } else sk.add(G.dod(0.13), C.stone, 0, 1.12, 0, { r: 0.9 });
    sk.pop();
    const shot = holder(sk.mesh()); am.add(shot);
    const pivot = new THREE.Group(); pivot.position.set(at.x - 0.35 * s, at.y + 0.26 * s, 0); pivot.add(am);
    const rest = 1.2; am.rotation.z = rest;
    c.addMoving(pivot);
    act(c, 'mortar', (kk) => { const f = kk < 0.12 ? ease(kk / 0.12) : 1 - ease((kk - 0.2) / 0.8) * (kk > 0.2 ? 1 : 0); am.rotation.z = rest - f * 1.35; shot.visible = !(kk > 0.1 && kk < 0.92); });
    anchor(c, 'mortar', [at.x + 0.2 * s, at.y + 1.3 * s, 0]);
  }),
  mortarPit: part(2, (c) => {
    const S = sty(c), r = clamp(c.B * 0.22, 0.6, 1.0), at = spot(c, r, 0.05, 'c'), t = T(c), k = c.k;
    t.push(at.x, at.y, 0);
    // two courses of sandbags (lumpy), the turntable race
    for (let j = 0; j < 2; j++) for (let i = 0; i < 14; i++) { const a = (i / 14) * PI * 2 + j * 0.22; t.b.add(G.sph(0.16, 8, 5), j ? 0x8a7a5a : 0x9a8a6a, Math.cos(a) * r * 1.02, 0.1 + j * 0.16, Math.sin(a) * r * 1.02, { sx: 1.35, sy: 0.62, ry: -a + PI / 2, r: 1 }); t.f.add(G.tor(0.08, 0.008, 3, 6), C.rope, Math.cos(a) * r * 1.02 + Math.cos(a + PI / 2) * 0.15, 0.1 + j * 0.16, Math.sin(a) * r * 1.02 + Math.sin(a + PI / 2) * 0.15, { ry: -a }); }
    t.l.add(G.cyl(r * 1.1, r * 1.15, 0.35, 10, true), 0x8a7a5a, 0, 0.17, 0);
    t.b.add(G.cyl(r * 0.7, r * 0.72, 0.08, 18), C.iron, 0, 0.04, 0, { m: 0.6 });
    t.m.add(G.tor(r * 0.66, 0.025, 3, 24), S.met, 0, 0.09, 0, { ...S.M, rx: PI / 2 });
    // shells in a rack and powder
    for (let i = 0; i < 6; i++) t.m.add(G.sph(0.1, 8, 6), C.black, -r * 0.55 + (i % 3) * 0.2, 0.12 + (i > 2 ? 0.17 : 0), r * 0.55, { m: 0.5, r: 0.5 });
    t.m.add(G.box(0.7, 0.04, 0.24), S.wood, -r * 0.35, 0.03, r * 0.55);
    t.push(-r * 0.6, 0, -r * 0.5); barrel(t, 0x5a3a24, 0.3, C.iron, 0x1a1a1a); t.pop();
    t.pop();
    // the bed turns; the mortar sits on trunnions in its cheeks
    const bed = mover();
    bed.b.add(G.cyl(r * 0.55, r * 0.6, 0.18, 14), shade(S.wood, 0.8), 0, 0.09, 0);
    for (const z of [-1, 1]) { bed.b.add(G.box(r * 0.7, 0.32, 0.08), shade(S.wood, 0.7), 0, 0.3, z * r * 0.32); bed.m.add(G.box(r * 0.72, 0.03, 0.09), S.met, 0, 0.45, z * r * 0.32, S.M); for (let q = 0; q < 3; q++) bed.f.add(G.sph(0.02, 4, 3), S.met, -r * 0.25 + q * r * 0.25, 0.25, z * (r * 0.32 + 0.045), S.M); }
    const bm = moverMesh(c, bed); bm.position.set(at.x, at.y + 0.08, 0);
    const mt = mover();
    mt.push(0, 0, 0, 0, 0, -0.55);
    mt.b.add(G.lathe('mortar', [[0, -0.35], [0.32, -0.35], [0.4, -0.2], [0.42, 0], [0.36, 0.3], [0.38, 0.55], [0.42, 0.62], [0.42, 0.7], [0.3, 0.7], [0.28, 0.2]], 14), S.metal === 'bronze' || S.metal === 'gold' || S.metal === 'brass' ? C.bronze : C.iron, 0, 0, 0, { s: r * 0.75, m: 0.78, r: 0.38 });
    for (const y of [0.0, 0.3]) mt.m.add(G.tor(r * 0.75 * 0.4, 0.03, 4, 14), S.met, 0, y * r * 0.75, 0, { ...S.M, rx: PI / 2 });
    mt.push(0, 0.2 * r, r * 0.3, 0, 0, 0); relief(mt.f, S, r * 0.12, S.met); mt.pop();
    mt.pop();
    mt.m.add(G.cyl(0.07, 0.07, r * 0.66, 8), C.iron, 0, 0, 0, { rx: PI / 2, m: 0.7 });
    const mm = moverMesh(c, mt); mm.position.set(0, 0.35, 0); bm.add(mm);
    c.addMoving(bm, (tt, ph) => { bm.rotation.y = Math.sin(tt * 0.18 + ph) * 0.8; });
    act(c, 'mortar', (kk) => { const f = kick(kk, 0.05); mm.position.set(Math.sin(0.55) * f * 0.12, 0.35 - Math.cos(0.55) * f * 0.12, 0); bm.position.y = at.y + 0.08 - f * 0.04; mm.rotation.z = f * 0.06; });
    act(c, 'fire', (kk) => { const f = kick(kk, 0.05) * 0.5; bm.position.y = at.y + 0.08 - f * 0.04; });
    anchor(c, 'mortar', [at.x + r * 0.3, at.y + 0.35 + r * 0.5, 0]);
  }),
  bombard: part(2.2, (c) => {
    const S = sty(c), at = spot(c, 0.8, 0.22, 'c'), t = T(c), r = clamp(c.B * 0.11, 0.3, 0.6), l = r * 4.2, k = c.k;
    const bronze = S.metal === 'gold' || S.metal === 'gilt' || S.metal === 'brass' || S.metal === 'bronze' || c.trimC === 0xd4a83a;
    t.push(at.x, at.y, 0);
    // the sled: beams, cheeks with iron straps, breeching ropes to ring-bolts
    t.b.add(G.box(l * 1.1, 0.18, r * 2.6), S.dark, 0, 0.09, 0);
    for (const z of [-1, 1]) { t.b.add(G.box(l * 0.75, r * 1.0, 0.12), shade(S.wood, 0.8), -l * 0.05, 0.18 + r * 0.5, z * r * 1.15); for (let q = 0; q < 3; q++) t.m.add(G.box(0.05, r * 1.02, 0.13), S.met, -l * 0.3 + q * l * 0.25, 0.18 + r * 0.5, z * r * 1.15, S.M); t.m.add(G.tor(0.06, 0.015, 3, 8), C.iron, -l * 0.55, 0.2, z * r * 1.3, { m: 0.6 }); t.m.add(tube([[-l * 0.55, 0.2, z * r * 1.3], [-l * 0.6, 0.35, z * r * 0.6], [-l * 0.52, 0.18 + r, 0]], 0.02, 8, 3), C.rope, 0, 0, 0); }
    for (let q = 0; q < 4; q++) t.f.add(G.box(0.012, 0.005, r * 2.6), shade(S.dark, 0.7), -l * 0.4 + q * l * 0.27, 0.181, 0);
    // stone shot stacked, a rammer
    for (let i = 0; i < 3; i++) t.m.add(G.sph(r * 0.62, 10, 8), C.stone, -l * 0.35 + i * r * 1.25, 0.18 + r * 0.62, r * 2.0, { r: 0.9 });
    t.m.add(G.sph(r * 0.62, 10, 8), C.stone, -l * 0.35 + r * 0.62, 0.18 + r * 1.6, r * 2.0, { r: 0.9 });
    t.m.add(G.cyl(0.025, 0.025, l * 0.9, 5), C.wood, 0, 0.22, -r * 1.7, { rz: PI / 2 }).add(G.cyl(r * 0.5, r * 0.5, 0.15, 10), shade(C.wood, 0.7), l * 0.45, 0.22, -r * 1.7, { rz: PI / 2 });
    t.pop();
    // the gun recoils in its sled
    const g = mover();
    g.push(0, 0, 0, 0, 0, -PI / 2 + 0.22);
    g.b.add(G.lathe('bombard', [[0, -0.5], [0.85, -0.5], [0.95, -0.42], [1.0, -0.2], [0.92, 0.0], [0.88, 0.5], [0.95, 0.56], [0.92, 0.62], [1.05, 0.9], [1.12, 1.0], [0.75, 1.0], [0.72, 0.9]], 14), bronze ? C.bronze : 0x3a3a40, 0, 0, 0, { sx: r, sz: r, sy: l * 0.5, m: 0.78, r: 0.35 });
    g.l.add(G.cyl(r, r * 1.05, l, 6), bronze ? C.bronze : 0x3a3a40, 0, l * 0.25, 0);
    for (let i = 0; i < 6; i++) g.m.add(G.tor(r * 1.0, r * 0.07, 4, 14), bronze ? shade(C.bronze, 0.85) : C.iron, 0, -l * 0.18 + (l * 0.55 * i) / 5, 0, { rx: PI / 2, m: 0.7 });
    g.m.add(G.circle(r * 0.72, 14), 0x050505, 0, l * 0.5 + 0.005, 0, { rx: -PI / 2 });
    g.push(0, l * 0.1, r * 0.95, 0, 0, 0); relief(g.f, S, r * 0.4, S.met); g.pop();
    g.push(0, l * 0.1, -r * 0.95, 0, PI, 0); relief(g.f, S, r * 0.4, S.met); g.pop();
    g.m.add(G.tor(r * 0.2, r * 0.05, 3, 8), S.met, 0, -l * 0.27, 0, S.M);
    g.pop();
    const gm = moverMesh(c, g); gm.position.set(at.x, at.y + 0.25 + r, 0);
    c.addMoving(gm);
    const rec = (kk) => { const f = kick(kk, 0.05); gm.position.x = at.x - f * r * 0.9; gm.rotation.z = f * 0.05; };
    act(c, 'fire', rec); act(c, 'mortar', rec);
    anchor(c, 'mortar', [at.x + l * 0.5, at.y + 0.25 + r + l * 0.1, 0]);
  }),
  rocketRack: part(1.8, (c) => {
    const S = sty(c), racks = [];
    for (const pref of [0.15, -0.2]) {
      const at = spot(c, 0.55, pref, 's'), out = Math.sign(at.z || 1), t = T(c), k = c.k, frame = S.id === 'tianlong' ? 0x8a1a14 : S.wood;
      t.push(at.x, at.y, at.z, 0, 0, 0, k);
      for (const z of [-1, 1]) { t.b.add(taper([[-0.35, 0, z * 0.22], [0, 0.55, z * 0.22]], 0.04, 0.035, 2, 5), frame, 0, 0, 0).add(taper([[0.35, 0, z * 0.22], [0, 0.55, z * 0.22]], 0.04, 0.035, 2, 5), frame, 0, 0, 0); t.m.add(G.box(0.5, 0.04, 0.05), frame, 0, 0.22, z * 0.22); }
      t.m.add(G.cyl(0.03, 0.03, 0.5, 6), C.iron, 0, 0.55, 0, { rx: PI / 2, m: 0.6 });
      // a quadrant to set the elevation, spare rockets in a crate
      t.m.add(G.tor(0.25, 0.012, 3, 10, PI / 2), S.met, 0, 0.55, 0.26, { ...S.M, rz: PI / 2 });
      t.push(-0.5, 0, 0); t.m.add(G.box(0.3, 0.18, 0.4), S.wood, 0, 0.09, 0); for (let q = 0; q < 4; q++) t.m.add(G.cyl(0.035, 0.035, 0.42, 6), q % 2 ? 0xb02a1a : 0xd4a83a, -0.08 + (q % 2) * 0.1, 0.21, -0.1 + q * 0.06, { rx: PI / 2 }); t.pop();
      t.pop();
      // the rack: a hive of tubes that tilts outboard; the rockets in it flare out together
      const rk = mover(), rocket = new DKit(), fl = new DKit();
      const n = 4, m2 = 3;
      rk.b.add(G.box(0.95, 0.08, 0.62), frame, 0, -0.05, 0);
      for (let i = 0; i < n; i++) for (let j = 0; j < m2; j++) {
        const x = -0.27 + i * 0.18, y = 0.05 + j * 0.11;
        rk.b.add(G.cyl(0.05, 0.05, 0.62, 8, true), shade(frame, 0.75), x, y, 0, { rx: PI / 2 });
        rk.f.add(G.tor(0.05, 0.008, 3, 8), S.met, x, y, 0.3, S.M);
        rocket.add(G.cyl(0.035, 0.035, 0.5, 8), j % 2 ? 0xb02a1a : 0xd4a83a, x, y, 0.08, { rx: PI / 2 }).add(G.cone(0.04, 0.14, 8), C.iron, x, y, 0.38, { rx: PI / 2, m: 0.7 });
        for (let q = 0; q < 3; q++) rocket.add(G.box(0.002, 0.06, 0.09), 0xe8e0c8, x, y, -0.2, { rz: (q * PI) / 3 });
        fl.add(G.cone(0.05, 0.35, 6), 0xffc86a, x, y, -0.45, { rx: -PI / 2 });
      }
      for (const z of [-1, 1]) rk.m.add(G.box(0.95, 0.38, 0.03), frame, 0, 0.16, z * 0.32);
      rk.push(0, 0.16, 0.34); relief(rk.f, S, 0.12, S.met); rk.pop();
      const mount = new THREE.Group(); mount.position.set(at.x, at.y + 0.55 * k, at.z); mount.scale.setScalar(k);
      const tilt = new THREE.Group(); mount.add(tilt);
      const rm = moverMesh(c, rk), ro = holder(rocket.mesh()), fm = glowMesh(fl, 0.9);
      rm.add(ro, fm); fm.visible = false; tilt.add(rm);
      tilt.rotation.x = out * -0.6;
      c.addMoving(mount);
      racks.push({ tilt, ro, fm, out });
    }
    act(c, 'mortar', (kk) => { for (const r of racks) { r.tilt.rotation.x = r.out * -(0.6 + bump(kk) * 0.25); r.fm.visible = kk > 0.08 && kk < 0.35; r.fm.scale.set(1, 1, r.fm.visible ? 1 + Math.sin(kk * 60) * 0.3 : 1); r.ro.visible = !(kk > 0.12 && kk < 0.85); } });
    act(c, 'flak', (kk) => { for (const r of racks) { r.fm.visible = kk > 0.1 && kk < 0.3; r.ro.visible = !(kk > 0.12 && kk < 0.85); r.tilt.rotation.x = r.out * -(0.6 + bump(kk) * 0.5); } });
  }),
  crystalRing: part(2, (c) => {
    const S = sty(c), R = clamp(c.B * 0.26, 0.7, 1.3), at = spot(c, R * 0.9, 0.05, 'c'), gc = S.glow, k = c.k, y = at.y + 1.1 * k, t = T(c);
    t.push(at.x, at.y, 0);
    t.b.add(G.lathe('crysped', [[0, 0], [0.5, 0], [0.5, 0.08], [0.32, 0.18], [0.26, 0.45], [0.36, 0.55], [0.3, 0.6], [0, 0.6]], 8), S.id === 'pearlfleet' ? STONE.coral : S.id === 'emerald' || S.id === 'xibalba' ? 0x3a6a4a : C.darkStone, 0, 0, 0, { s: k, r: 0.6 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; t.m.add(G.box(0.03, 0.2, 0.05), gc, Math.cos(a) * 0.27 * k, 0.32 * k, Math.sin(a) * 0.27 * k, { ry: -a, g: 1.5 }); }
    t.m.add(G.tor(0.36 * k, 0.025, 3, 16), S.met, 0, 0.56 * k, 0, { ...S.M, rx: PI / 2 });
    // a cluster of crystals in claws of metal
    t.b.add(G.oct(0.4 * k), gc, 0, 1.3 * k, 0, { sy: 1.9, g: 1.6, r: 0.15 });
    for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2; t.m.add(G.oct(0.16 * k), blend(gc, 0xffffff, 0.2), Math.cos(a) * 0.2 * k, 0.85 * k, Math.sin(a) * 0.2 * k, { sy: 2, g: 1.4, rz: -Math.cos(a) * 0.5, rx: Math.sin(a) * 0.5, r: 0.15 }); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * PI * 2 + PI / 4; t.m.add(taper([[Math.cos(a) * 0.3 * k, 0.58 * k, Math.sin(a) * 0.3 * k], [Math.cos(a) * 0.38 * k, 1.0 * k, Math.sin(a) * 0.38 * k], [Math.cos(a) * 0.18 * k, 1.35 * k, Math.sin(a) * 0.18 * k]], 0.04 * k, 0.01, 6, 4), S.met, 0, 0, 0, S.M); }
    t.pop();
    // the core's glow, and the ring of lesser crystals that turns about it
    const gk = new DKit(); gk.add(G.oct(0.52 * k), gc, 0, 0, 0, { sy: 1.9 });
    const glow = glowMesh(gk, 0.25); glow.position.set(at.x, at.y + 1.3 * k, 0);
    const rg = mover();
    rg.b.add(G.tor(R, 0.05, 6, 36), S.met, 0, 0, 0, { rx: PI / 2, ...S.M });
    rg.m.add(G.tor(R * 0.92, 0.02, 3, 36), S.met, 0, 0, 0, { rx: PI / 2, ...S.M });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; rg.b.add(G.oct(0.15 * k), gc, Math.cos(a) * R, 0.16, Math.sin(a) * R, { sy: 1.8, g: 2.2, r: 0.15 }); rg.m.add(G.cone(0.05, 0.14, 4), S.met, Math.cos(a) * R, 0.0, Math.sin(a) * R, { ...S.M, rx: PI }); rg.f.add(G.oct(0.06 * k), gc, Math.cos(a + 0.4) * R, 0.05, Math.sin(a + 0.4) * R, { sy: 1.6, g: 2 }); }
    const ring = moverMesh(c, rg); ring.position.set(at.x, y, 0);
    let charge = 0, spin = 0;
    c.addMoving(ring, (tt, ph) => { ring.rotation.y = tt * 0.6 + spin; ring.rotation.z = Math.sin(tt * 0.7 + ph) * 0.15; ring.position.y = y + Math.sin(tt * 1.4 + ph) * 0.1 + charge * 0.15; glow.material.opacity = 0.22 + 0.08 * Math.sin(tt * 2 + ph) + charge * 0.75; glow.scale.setScalar(1 + charge * 0.35); });
    c.addMoving(glow);
    const beam = (kk) => { charge = kk < 0.6 ? ease(kk / 0.6) : 1 - ease((kk - 0.6) / 0.4); spin = spinK(kk, 2); if (kk >= 1) { charge = 0; spin = 0; } };
    act(c, 'mortar', beam); act(c, 'fire', beam); act(c, 'aura', beam); act(c, 'flak', beam);
    anchor(c, 'mortar', [at.x, at.y + 1.3 * k, 0]); anchor(c, 'aura', [at.x, at.y + 1.3 * k, 0]);
  }),
  lens: part(2, (c) => {
    const S = sty(c), R = clamp(c.B * 0.2, 0.55, 1.0), at = spot(c, R, 0.25, 'c'), t = T(c), gc = S.glow, y = R + 0.55, k = c.k;
    t.push(at.x, at.y, 0);
    t.b.add(G.lathe('lensped', [[0, 0], [0.36, 0], [0.38, 0.06], [0.26, 0.14], [0.2, 0.5], [0.26, 0.56], [0, 0.56]], 10), S.met, 0, 0, 0, { ...S.M });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; t.f.add(G.box(0.02, 0.3, 0.03), shade(S.met, 0.75), Math.cos(a) * 0.215, 0.32, Math.sin(a) * 0.215, { ry: -a }); }
    t.pop();
    // the yoke turns; the lens nods in it
    const yk = mover();
    for (const z of [-1, 1]) { yk.b.add(taper([[0, 0, z * 0.15], [0, y * 0.5, z * (R + 0.12)], [0, y - 0.56, z * (R + 0.14)]], 0.05, 0.035, 4, 6), S.met, 0, 0, 0, S.M); yk.m.add(G.sph(0.08, 8, 6), S.met, 0, y - 0.56, z * (R + 0.14), S.M); }
    yk.b.add(G.cyl(0.18, 0.2, 0.08, 10), S.met, 0, 0, 0, S.M);
    const ym = moverMesh(c, yk); ym.position.set(at.x, at.y + 0.56, 0);
    const ln = mover();
    ln.b.add(G.tor(R, 0.08, 6, 32), S.met, 0, 0, 0, { ry: PI / 2, ...S.M });
    ln.m.add(G.tor(R * 0.86, 0.025, 3, 32), shade(S.met, 0.85), 0.04, 0, 0, { ry: PI / 2, ...S.M }).add(G.tor(R * 0.86, 0.025, 3, 32), shade(S.met, 0.85), -0.04, 0, 0, { ry: PI / 2, ...S.M });
    ln.b.add(G.sph(R * 0.95, 18, 12), blend(gc, 0xffffff, 0.3), 0, 0, 0, { sx: 0.16, g: 0.9, r: 0.05, m: 0.4 });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; ln.m.add(G.cone(0.04, 0.16, 4), S.met, 0, Math.sin(a) * (R + 0.1), Math.cos(a) * (R + 0.1), { ...S.M, rx: -a + PI / 2 }); }
    for (let i = 0; i < 24; i++) { const a = (i / 24) * PI * 2; ln.f.add(G.sph(0.018, 4, 3), S.met, 0.07, Math.sin(a) * R, Math.cos(a) * R, S.M); }
    ln.push(0, R + 0.18, 0); finial(ln.m, S, 0.4 * k); ln.pop();
    const lm = moverMesh(c, ln); lm.position.set(0, y - 0.56, 0); lm.rotation.z = -0.45; ym.add(lm);
    const gk = new DKit(); gk.add(G.circle(R * 0.9, 24), gc, 0.02, 0, 0, { ry: PI / 2 }); gk.add(G.circle(R * 0.9, 24), gc, -0.02, 0, 0, { ry: PI / 2 });
    const gm = glowMesh(gk, 0.15); lm.add(gm);
    c.addMoving(ym, (tt, ph) => { ym.rotation.y = Math.sin(tt * 0.22 + ph) * 0.5; lm.rotation.z = -0.45 + Math.sin(tt * 0.4 + ph) * 0.08; gm.material.opacity = 0.12 + (gm.userData.boost || 0); });
    const charge = (kk) => { gm.userData.boost = kk < 0.65 ? ease(kk / 0.65) * 0.9 : (1 - ease((kk - 0.65) / 0.35)) * 0.9; };
    act(c, 'mortar', charge); act(c, 'fire', charge); act(c, 'flak', charge);
    anchor(c, 'mortar', [at.x + 0.3, at.y + y + 0.2, 0]);
  }),
  organPipes: part(2.2, (c) => {
    const S = sty(c), w = clamp(c.B * 0.5, 1.2, 2.2), at = c.place(0.7, -0.15, 'c'), t = T(c), n = 9, k = c.k, case_ = S.id === 'grom' ? 0x3a2a1a : S.id === 'skar' ? 0x3a3428 : S.id === 'velvet' ? 0x3a1a2a : shade(c.hullC, 0.8);
    const pipeC = S.metal === 'rust' ? 0x8a6a3a : S.metal === 'black' ? C.bronze : S.met;
    t.push(at.x, at.y, 0);
    // console and wind-chest, keys, the bellows behind
    t.b.add(G.box(0.62, 0.42, w), case_, 0, 0.21, 0);
    t.m.add(G.box(0.64, 0.05, w * 1.02), S.trim, 0, 0.42, 0, { m: 0.5 });
    for (let i = 0; i < 18; i++) t.f.add(G.box(0.09, 0.015, w * 0.03), i % 3 === 2 ? 0x101010 : 0xf0e8d8, 0.33, 0.36, -w * 0.4 + (w * 0.8 * i) / 17);
    t.m.add(G.box(0.12, 0.06, w * 0.85), case_, 0.33, 0.34, 0);
    t.push(-0.5, 0, 0); for (let i = 0; i < 4; i++) t.m.add(G.box(0.3 - i * 0.02, 0.06, w * 0.5), i % 2 ? 0x6a3a2a : S.wood, 0, 0.08 + i * 0.07, 0); t.m.bar([0.1, 0.4, 0], [-0.2, 0.7, 0], 0.025, S.wood); t.pop();
    t.pop();
    // the pipes: a rank with mouths, flared crowns, and a carved crest over them
    const pp = mover(), gl = new DKit();
    for (const rank of [0, 1]) for (let i = 0; i < n; i++) {
      const f = 1 - Math.abs(i - (n - 1) / 2) / ((n - 1) / 2), h = (0.9 + f * 1.5 - rank * 0.35) * k, z = -w / 2 + (w * (i + 0.5)) / n, x = rank ? -0.18 : 0.08, r = (0.07 + f * 0.03) * (rank ? 0.8 : 1);
      pp.b.add(G.lathe('pipe', [[0, 0], [0.4, 0.0], [1, 0.12], [1, 0.95], [1.15, 1.0], [0.85, 1.0]], 10), pipeC, x, 0, z, { sx: r, sz: r, sy: h, m: 0.9, r: 0.22 });
      pp.l.add(G.cyl(r, r, h, 5), pipeC, x, h / 2, z);
      if (!rank) {
        pp.m.add(G.box(0.02, 0.12 * k, r * 1.1), 0x0a0808, x + r * 0.93, 0.22 * k, z).add(G.box(0.03, 0.02, r * 1.2), pipeC, x + r * 0.98, 0.16 * k, z, { m: 0.9 });
        pp.f.add(G.shape('pipemouth', [[-0.5, 0], [0.5, 0], [0, 0.6]], 0.02), pipeC, x + r * 0.95, 0.28 * k, z, { ry: PI / 2, s: r * 1.1, m: 0.9 });
        gl.add(G.box(0.01, 0.1 * k, r * 0.8), S.glow, x + r + 0.01, 0.22 * k, z);
      }
      pp.f.add(G.tor(r * 1.02, 0.008, 3, 10), shade(pipeC, 0.8), x, h * 0.3, z, { rx: PI / 2, m: 0.9 });
    }
    pp.b.add(G.box(0.08, 0.5 * k, w * 0.9), case_, -0.28, 0.25 * k, 0);
    pp.push(0.12, 2.45 * k, 0); finial(pp.m, S, 0.9 * k); pp.pop();
    pp.push(0.2, 0.55 * k, 0, 0, PI / 2, 0); emblem(pp.m, S, 0.2 * k, case_, S.met); pp.pop();
    const pm = moverMesh(c, pp); pm.position.set(at.x, at.y + 0.42, 0);
    const gm = glowMesh(gl, 0.15); pm.add(gm);
    let beat = 0;
    c.addMoving(pm, (tt, ph) => { pm.scale.y = 1 + beat * 0.05; gm.material.opacity = 0.12 + beat * 0.85; });
    const play = (kk) => { beat = pulses(kk, 5, 0.3); };
    act(c, 'aura', play); act(c, 'mortar', (kk) => { beat = kick(kk, 0.15); }); act(c, 'flak', play); act(c, 'fire', (kk) => { beat = kick(kk, 0.1) * 0.6; });
    anchor(c, 'aura', [at.x, at.y + 2.2 * k, 0]);
    c.topAt = Math.max(c.topAt || 0, at.y + 3);
  }),
  mirrors: part(2, (c) => {
    const S = sty(c), at = spot(c, 0.8, -0.05, 'c'), t = T(c), gc = S.glow, k = c.k, frame = S.metal === 'iron' || S.metal === 'rust' || S.metal === 'black' ? C.bronze : S.met;
    t.push(at.x, at.y, 0);
    t.b.add(G.cyl(0.32, 0.38, 0.3, 10), shade(c.hullC, 0.8), 0, 0.15, 0);
    t.m.add(G.tor(0.34, 0.025, 3, 14), frame, 0, 0.3, 0, { m: 0.85, r: 0.3, rx: PI / 2 });
    t.b.add(G.cyl(0.04, 0.06, 0.65, 6), frame, 0, 0.62, 0, { m: 0.85 });
    t.b.add(G.oct(0.22), gc, 0, 1.05, 0, { g: 2.5, sy: 1.6 });
    for (let i = 0; i < 3; i++) t.m.add(G.tor(0.12, 0.01, 3, 10), frame, 0, 1.05, 0, { m: 0.85, rx: i * 1.05, ry: i * 0.7 });
    t.pop();
    // four mirrors on gimbals; they track the sun and swing to focus
    const mm = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + PI / 4, x = at.x + Math.cos(a) * 0.6, z = Math.sin(a) * 0.6;
      t.b.add(G.cyl(0.04, 0.06, 0.95, 6), frame, x, at.y + 0.47, z, { m: 0.8 });
      t.m.add(G.cyl(0.09, 0.11, 0.05, 8), frame, x, at.y + 0.03, z, { m: 0.8 });
      const g = mover();
      g.b.add(G.box(0.05, 0.72 * k, 0.58 * k), frame, 0, 0, 0, { m: 0.85, r: 0.3 });
      g.b.add(G.box(0.02, 0.62 * k, 0.48 * k), blend(gc, 0xffffff, 0.6), 0.03, 0, 0, { m: 1, r: 0.04, g: 0.5 });
      for (const s of [-1, 1]) { g.m.add(G.box(0.07, 0.04, 0.6 * k), frame, 0.01, s * 0.36 * k, 0, { m: 0.85 }); g.m.add(G.cone(0.03, 0.12, 4), frame, 0, s * 0.42 * k, 0, { m: 0.85, rz: s > 0 ? 0 : PI }); }
      g.f.add(G.tor(0.06, 0.012, 3, 8), frame, -0.04, 0, 0, { m: 0.85, ry: PI / 2 });
      const m = moverMesh(c, g); m.position.set(x, at.y + 1.1 * k, z);
      const hold = new THREE.Group(); hold.position.copy(m.position); m.position.set(0, 0, 0); hold.add(m); hold.rotation.y = -a + PI;
      c.addMoving(hold);
      mm.push({ hold, m, a });
    }
    const fk = new DKit(); fk.add(G.sph(0.35, 12, 8), gc, 0, 0, 0); for (let i = 0; i < 4; i++) fk.add(G.cone(0.05, 1.2, 6), 0xffffff, 0, 0, 0, { rz: PI / 2, ry: (i / 4) * PI * 2 + PI / 4 });
    const flash = glowMesh(fk, 0); flash.position.set(at.x, at.y + 1.05, 0); flash.visible = false;
    let focus = 0;
    c.addMoving(flash, (tt, ph) => { for (const q of mm) { q.hold.rotation.y = -q.a + PI + Math.sin(tt * 0.2 + ph) * 0.25 * (1 - focus); q.m.rotation.z = 0.4 + focus * 0.35; } });
    const shine = (kk) => { focus = kk < 0.4 ? ease(kk / 0.4) : 1 - ease((kk - 0.6) / 0.4) * (kk > 0.6 ? 1 : 0); flash.visible = kk > 0.35 && kk < 0.75; flash.material.opacity = flash.visible ? bump((kk - 0.35) / 0.4) * 0.9 : 0; flash.scale.setScalar(flash.visible ? 0.6 + bump((kk - 0.35) / 0.4) * 0.8 : 1); if (kk >= 1) focus = 0; };
    act(c, 'aura', shine); act(c, 'mortar', shine); act(c, 'fire', shine);
    anchor(c, 'aura', [at.x, at.y + 1.05, 0]);
  }),
  pumpCannon: part(2, (c) => {
    const S = sty(c), at = spot(c, 0.7, 0.25, 'c'), t = T(c), goo = S.id === 'caliphate' ? 0xff8a2a : S.id === 'screaming' ? 0xff3a2a : C.slime, k = c.k, flesh = S.id === 'morbus' || S.id === 'balor';
    const tank = flesh ? blend(c.hullC, C.flesh, 0.4) : shade(c.hullC, 0.8);
    t.push(at.x, at.y, 0);
    // the tank, hooped; a sight-glass of the brew; valves and gauges
    t.b.add(G.sph(0.5 * k, 16, 12), tank, -0.2, 0.5 * k, 0, { sy: 0.85, r: flesh ? 0.4 : 0.6 });
    for (let i = 0; i < 4; i++) t.m.add(G.tor(0.5 * k, 0.035, 4, 20), S.met, -0.2, 0.22 * k + i * 0.18 * k, 0, { rx: PI / 2, s: 1 - Math.abs(i - 1.5) * 0.16, ...S.M });
    t.m.add(G.cyl(0.06, 0.06, 0.4 * k, 8), goo, -0.2 + 0.5 * k * 0.96, 0.5 * k, 0, { g: 1.5 });
    for (let q = 0; q < 3; q++) t.f.add(G.cyl(0.03, 0.03, 0.05, 8), S.met, -0.2 + Math.cos(q * 1.2 - 0.6) * 0.45 * k, 0.75 * k, Math.sin(q * 1.2 - 0.6) * 0.45 * k, S.M);
    t.m.add(G.cyl(0.08, 0.08, 0.03, 12), 0xe8e0c8, -0.2, 0.92 * k, 0.2, { rx: -0.6 });
    if (flesh) for (let i = 0; i < 6; i++) t.m.add(G.sph(0.06 + hash(i) * 0.05, 8, 6), goo, -0.2 + Math.cos(i * 1.1) * 0.45 * k, 0.4 * k + hash(i + 3) * 0.3, Math.sin(i * 1.1) * 0.42 * k, { g: 1.2, sy: 0.7 });
    t.m.add(tube([[0.2, 0.5, 0], [0.5, 0.75, 0], [0.8, 0.6, 0], [1.05, 0.62, 0]], 0.08, 14, 8), flesh ? blend(C.flesh, 0x6a4a3a, 0.4) : C.iron, 0, 0, 0, { m: flesh ? 0 : 0.5 });
    for (let i = 0; i < 4; i++) t.f.add(G.tor(0.085, 0.012, 3, 10), S.met, 0.35 + i * 0.18, 0.67 - Math.abs(i - 1) * 0.03, 0, { ry: PI / 2, ...S.M });
    t.pop();
    // bellows (squeeze) and nozzle (kicks); goo drips from the mouth
    const bl = mover();
    bl.b.add(G.box(0.4, 0.06, 0.32), S.wood, 0, 0.06, 0).add(G.box(0.4, 0.06, 0.32), S.wood, 0, 0.32, 0);
    bl.b.add(G.custom('bellows', () => { const g = new THREE.CylinderGeometry(0.16, 0.16, 0.26, 12, 4); const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const f = 1 + 0.18 * Math.cos(P.getY(i) * 48); P.setX(i, P.getX(i) * f * 1.25); P.setZ(i, P.getZ(i) * f); } g.computeVertexNormals(); return g; }), 0x5a3a2a, 0, 0.19, 0, { r: 0.9 });
    bl.m.add(G.cyl(0.02, 0.02, 0.4, 4), S.wood, -0.3, 0.32, 0, { rz: PI / 2 });
    const bm = moverMesh(c, bl); bm.position.set(at.x - 0.85, at.y, 0);
    c.addMoving(bm);
    const nz = mover();
    nz.b.add(G.lathe('nozzle', [[0.07, 0], [0.1, 0], [0.12, 0.08], [0.08, 0.2], [0.06, 0.32], [0.09, 0.36], [0.06, 0.36]], 10), S.metal === 'rust' ? C.bronze : S.met, 0, 0, 0, { rz: -PI / 2, ...S.M });
    for (let i = 0; i < 3; i++) nz.m.add(G.sph(0.055 - i * 0.012, 6, 5), goo, 0.36 + i * 0.03, -0.06 - i * 0.12, 0, { g: 1.6 });
    nz.f.add(G.cone(0.02, 0.08, 4), S.met, 0.25, 0.1, 0, S.M);
    const nm = moverMesh(c, nz); nm.position.set(at.x + 1.05, at.y + 0.62, 0);
    c.addMoving(nm);
    const squirt = (kk) => { const sq = kk < 0.3 ? ease(kk / 0.3) : 1 - ease((kk - 0.3) / 0.7); bm.scale.y = 1 - sq * 0.4; nm.position.x = at.x + 1.05 - kick(clamp((kk - 0.25) / 0.75, 0, 1), 0.06) * 0.12; nm.rotation.z = kick(clamp((kk - 0.25) / 0.75, 0, 1), 0.06) * 0.1; };
    act(c, 'fire', squirt); act(c, 'mortar', squirt); act(c, 'harpoon', squirt);
    anchor(c, 'mortar', [at.x + 1.4, at.y + 0.62, 0]);
  }),
  skullPile: part(1.2, (c) => {
    const S = sty(c), at = spot(c, 0.55, -0.1, 'c'), t = T(c), k = c.k, bone = S.id === 'kharnak' ? 0xd8c8a8 : C.bone;
    t.push(at.x, at.y, 0);
    for (let i = 0; i < 22; i++) {
      const lvl = i < 9 ? 0 : i < 15 ? 1 : i < 19 ? 2 : i < 21 ? 3 : 4, a = i * 2.4, r = (4 - lvl) * 0.12;
      t.push(Math.cos(a) * r, lvl * 0.19, Math.sin(a) * r, (hash(i) - 0.5) * 0.4, a, (hash(i + 2) - 0.5) * 0.4, 1.15); skull(i < 12 ? t.b : t.m, 1, shade(bone, 0.85 + hash(i + 5) * 0.2)); t.pop();
    }
    t.l.add(G.cone(0.55, 0.9, 8), bone, 0, 0.45, 0);
    for (let i = 0; i < 6; i++) { const a = i * 1.05; t.f.add(G.cyl(0.02, 0.025, 0.35, 5), bone, Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55, { rz: PI / 2 - 0.2, ry: -a }); }
    // pikes with skulls, the brazier of skull-oil
    for (const s of [-1, 1]) { t.b.add(G.cyl(0.02, 0.025, 1.4 * k, 5), S.dark, 0.1, 0.7 * k, s * 0.6); t.push(0.1, 1.4 * k, s * 0.6, 0, s * 0.4, 0, 1.2); skull(t.m, 1, bone); t.pop(); t.m.add(G.cone(0.025, 0.15, 4), S.met, 0.1, 1.48 * k + 0.3, s * 0.6, S.M); }
    t.push(-0.6, 0, 0);
    t.b.add(G.lathe('skullbraz', [[0, 0], [0.32, 0], [0.38, 0.4], [0.3, 0.55], [0.34, 0.62]], 10), S.met, 0, 0, 0, S.M);
    for (let i = 0; i < 5; i++) { t.push(Math.cos(i * 1.26) * 0.32, 0.25, Math.sin(i * 1.26) * 0.32, 0, -i * 1.26, 0, 0.55); skull(t.f, 1, bone); t.pop(); }
    t.pop();
    t.pop();
    const fk = new DKit(); flame(fk, 0, 0, 0, 1.2 * k, S.id === 'khemet' ? 0x6affd8 : C.fire);
    const fm = fk.mesh(); fm.position.set(at.x - 0.6, at.y + 0.6, 0);
    c.addMoving(fm, (tt, ph) => { fm.scale.set(1, (1 + 0.15 * Math.sin(tt * 8 + ph)) * (1 + (fm.userData.boost || 0)), 1); });
    const flare = (kk) => { fm.userData.boost = kick(kk, 0.15) * 1.2; };
    act(c, 'mortar', flare); act(c, 'aura', flare);
  }),
  // ================= stores and furniture =================
  nest: part(0.5, (c) => {
    let p = c.nestAt; const S = sty(c);
    if (!p) {
      const at = c.place(0.4, -0.38, 'c'), h = clamp(c.L * 0.3, 2.4, 4), t0 = T(c);
      t0.b.add(taper([[at.x, at.y, 0], [at.x, at.y + h, 0]], 0.1, 0.07, 2, 7), S.wood, 0, 0, 0);
      for (let i = 0; i < 4; i++) t0.m.bar([at.x, at.y + h * (0.3 + i * 0.15), 0], [at.x + (i % 2 ? 0.25 : -0.25), at.y + h * (0.3 + i * 0.15), (i > 1 ? 0.25 : -0.25)], 0.025, S.wood);
      p = [at.x, at.y + h, 0];
    }
    const t = T(c), r = clamp(c.B * 0.22, 0.6, 1.1);
    t.push(p[0], p[1], p[2]);
    hiAdd(t.b, () => HI.nest({ r: r * 1.25, col: 0x6a5236 }), 0, -r * 0.05, 0);
    const n0 = t.K.items.length;
    t.b.add(G.tor(r, r * 0.35, 8, 18), 0x6a5236, 0, r * 0.2, 0, { rx: PI / 2, r: 1 });
    t.b.add(G.cyl(r * 0.9, r * 0.4, r * 0.4, 12), 0x5a4228, 0, 0, 0, { r: 1 });
    // woven sticks, a few long ones poking out; feathers; eggs or a skull
    for (let i = 0; i < 26; i++) { const a = i * 0.55, b = a + 1.1 + hash(i) * 0.6, y = r * (0.05 + hash(i + 1) * 0.35); t.m.bar([Math.cos(a) * r * 1.2, y, Math.sin(a) * r * 1.2], [Math.cos(b) * r * 1.3, y + (hash(i + 2) - 0.5) * 0.15, Math.sin(b) * r * 1.3], 0.022, i % 3 ? 0x8a6a46 : 0x5a4228); }
    for (let i = 0; i < 6; i++) { const a = i * 1.1; t.m.bar([Math.cos(a) * r, r * 0.3, Math.sin(a) * r], [Math.cos(a) * r * 1.8, r * 0.5, Math.sin(a) * r * 1.8], 0.018, 0x6a5236); }
    for (let i = 0; i < 18; i++) { const a = i * 0.35; t.f.bar([Math.cos(a) * r * 0.9, r * 0.45, Math.sin(a) * r * 0.9], [Math.cos(a + 0.5) * r * 1.25, r * 0.38, Math.sin(a + 0.5) * r * 1.25], 0.012, 0x9a7a52); }
    for (let i = 0; i < 4; i++) t.f.add(G.sph(0.06, 5, 4), i % 2 ? 0xe8e0d0 : 0x3a3a40, Math.cos(i * 1.6) * r * 0.9, r * 0.5, Math.sin(i * 1.6) * r * 0.9, { sx: 0.4, sy: 2, rz: 0.6, ry: i });
    for (let i = 0; i < 3; i++) t.m.add(G.sph(0.14, 9, 7), S.id === 'fimbul' ? 0xd8e8f0 : S.id === 'verdant' ? 0xb8d8a0 : 0xe8dcc0, (i - 1) * 0.2, 0.18, (i % 2) * 0.12, { sy: 1.3 });
    for (let i = n0; i < t.K.items.length; i++) t.K.items[i].farOnly = true;
    t.pop();
    c.topAt = Math.max(c.topAt || 0, p[1] + r);
  }),
  perches: part(0, (c) => {
    const S = sty(c), t = T(c), k = c.k;
    for (const s of [-1, 1]) for (const x of along(c, 3, 0.2, 0.75)) {
      const y = railY(c, x, s), z = railZ(c, x, s), h = 1.2 * k, tip = [x, y + h, z + s * 0.6];
      t.b.add(taper([[x, y - 0.2, z], [x, y + h * 0.6, z + s * 0.15], tip], 0.06, 0.045, 6, 5), S.dark, 0, 0, 0);
      t.m.bar([x, y + 0.05, z], [x, y + h * 0.5, z + s * 0.12], 0.025, S.dark);
      t.b.add(G.cyl(0.05, 0.05, 0.9, 6), S.wood, tip[0], tip[1], tip[2], { rz: PI / 2 });
      t.m.add(G.cyl(0.055, 0.055, 0.6, 6), C.rope, tip[0], tip[1], tip[2], { rz: PI / 2 }); // wrapped grip
      for (const dx of [-0.45, 0.45]) t.m.add(G.sph(0.06, 6, 5), S.met, tip[0] + dx, tip[1], tip[2], S.M);
      for (let q = 0; q < 6; q++) t.f.add(G.tor(0.056, 0.008, 3, 8), shade(C.rope, 0.8), tip[0] - 0.25 + q * 0.1, tip[1], tip[2], { ry: PI / 2 });
      t.m.add(G.tor(0.05, 0.01, 3, 8), C.iron, tip[0], tip[1] - 0.08, tip[2], { m: 0.6 }).bar([tip[0], tip[1] - 0.12, tip[2]], [tip[0] + 0.05, tip[1] - 0.5, tip[2]], 0.006, 0x8a6a46);
      t.push(tip[0], tip[1] + 0.04, tip[2] - s * 0.02, 0, s > 0 ? 0 : PI, 0); t.f.add(G.box(0.15, 0.08, 0.002), c.side, 0, -0.18, 0.06); t.pop();
    }
  }),
  cages: part(1.2, (c) => {
    const S = sty(c), hooks = c.hookObjs || [], sw = [];
    const build = (K, r, h, col) => {
      const t = { b: K, m: K, f: K };
      t.b.add(G.cyl(r, r, 0.05, 12), col, 0, 0.025, 0, { m: 0.6 }).add(G.tor(r, 0.025, 3, 16), col, 0, h, 0, { m: 0.6, rx: PI / 2 }).add(G.tor(r, 0.02, 3, 16), col, 0, h * 0.5, 0, { m: 0.6, rx: PI / 2 });
      t.b.add(G.hemi(r * 1.02, 12, 4), col, 0, h, 0, { m: 0.6, sy: 0.5, r: 0.5 });
      for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; t.b.add(G.cyl(0.014, 0.014, h, 4), col, Math.cos(a) * r, h / 2, Math.sin(a) * r, { m: 0.6 }); }
      t.b.add(G.tor(0.05, 0.012, 3, 8), col, 0, h + r * 0.52, 0, { m: 0.6 });
      // the wretch inside, gripping the bars
      K.push(0, 0.04, 0, 0, hash(r * 9) * 6, 0);
      figure(K, S.crude ? 0x7a6a5a : 0x8a7a6a, 0xb89a7a, h * 1.1, 'sit');
      far(K, () => { for (const z of [-1, 1]) K.bar([0.0, h * 0.45, z * 0.07], [r * 0.95, h * 0.62, z * 0.1], 0.02, 0xb89a7a); });
      K.pop();
      if (S.crude || S.motif === 'skull') K.add(G.sph(0.05, 6, 4), C.bone, -r * 0.5, 0.08, r * 0.3);
    };
    for (let i = 0; i < 2; i++) {
      if (hooks[i]) { const K = new DKit(); K.push(0, -0.85, 0); build(K, 0.3, 0.62, C.iron); K.pop(); K.bar([0, 0, 0], [0, -0.85 + 0.62 + 0.18, 0], 0.012, C.iron); const m = K.mesh(); m.userData.noCrew = true; hooks[i].add(m); lodReg(c, m); sw.push(m); continue; }
      const at = spot(c, 0.42, i ? -0.25 : 0.05, 's'), t = T(c);
      t.push(at.x, at.y, at.z);
      build(t.b, 0.34, 0.75, S.metal === 'bone' ? C.bone : C.iron);
      t.pop();
    }
    if (sw.length) {
      c.addMoving(new THREE.Group(), (tt, ph) => { sw.forEach((m, i) => { m.rotation.z = Math.sin(tt * 1.3 + ph + i) * 0.06 + (m.userData.jolt || 0); m.rotation.x = Math.sin(tt * 1.1 + ph + i * 2) * 0.05; }); });
      act(c, 'hit', (kk) => { for (const m of sw) m.userData.jolt = Math.sin(kk * 18) * 0.3 * (1 - kk) * (kk < 1 ? 1 : 0); });
    }
  }),
  corpses: part(0.5, (c) => {
    const S = sty(c), t = T(c), body = S.id === 'morbus' ? 0x7a8a5a : 0x7a7060, wrap = S.id === 'khemet' ? 0xd8c8a0 : 0x5a5040;
    for (const s of [-1, 1]) for (const x of along(c, 2, 0.25, 0.7)) {
      const y = railY(c, x, s), z = railZ(c, x, s);
      // a gibbet: post, arm, brace, chain and the hanged man
      t.b.add(G.box(0.1, 1.7, 0.1), C.dark, x, y + 0.65, z).add(G.box(0.08, 0.08, 0.6), C.dark, x, y + 1.45, z + s * 0.25);
      t.m.bar([x, y + 1.15, z], [x, y + 1.45, z + s * 0.3], 0.03, C.dark);
      t.m.bar([x, y + 1.45, z + s * 0.5], [x, y + 1.2, z + s * 0.5], 0.012, C.rope);
      t.push(x, y + 0.45, z + s * 0.5, 0, s * 0.6, 0.06);
      figure(t.m, wrap, body, 1.45, 'stand');
      far(t.m, () => { t.m.add(G.sph(0.05, 5, 4), body, 0, 0.78, 0.0, { sz: 0.8 }); for (const zz of [-1, 1]) t.m.bar([0, 0.65, zz * 0.08], [0.02, 0.38, zz * 0.1], 0.025, body); });
      t.pop();
      t.l.add(G.custom('corpse', () => new THREE.CapsuleGeometry(0.11, 0.5, 2, 6)), body, x, y + 0.8, z + s * 0.5);
    }
    const at = c.place(0.5, -0.15, 's');
    t.push(at.x, at.y, at.z);
    for (let i = 0; i < 2; i++) { t.push(i * 0.1, 0, i * 0.25, 0, 0.4 * i, 0); figure(t.b, wrap, body, 1.3, 'dead'); t.pop(); }
    t.f.add(G.sph(0.03, 4, 3), 0x101010, 0.2, 0.25, 0.1).add(G.sph(0.03, 4, 3), 0x101010, -0.2, 0.22, 0.3);
    t.pop();
  }),
  barrels: part(1, (c) => {
    const S = sty(c), bands = S.metal === 'rust' ? 0x6a3a22 : S.metal === 'gold' || S.metal === 'gilt' || S.metal === 'brass' ? C.bronze : C.iron;
    for (const pref of [0.25, -0.32]) {
      const at = spot(c, 0.45, pref, 's'), t = T(c), oz = -Math.sign(at.z || 1);
      for (let i = 0; i < 4; i++) { t.push(at.x + (i % 2) * 0.34 - 0.17, at.y + (i === 3 ? 0.44 : 0), at.z + (i === 2 ? 0.3 * oz : 0) + (i === 3 ? 0.1 * oz : 0), 0, i * 1.3, 0); barrel(t, i % 2 ? C.wood : shade(C.wood, 1.15), 0.42, bands, i === 1 ? c.side : null); t.pop(); }
      t.push(at.x + 0.45, at.y + 0.18, at.z + 0.2 * oz, 0, 0.3, PI / 2); barrel(t, shade(C.wood, 0.9), 0.38, bands); t.pop();
      t.m.add(G.box(0.22, 0.06, 0.08), S.wood, at.x + 0.45, at.y + 0.03, at.z + 0.2 * oz);
      t.m.add(tube([[at.x - 0.35, at.y + 0.02, at.z], [at.x - 0.2, at.y + 0.5, at.z + 0.05], [at.x + 0.2, at.y + 0.5, at.z + 0.05], [at.x + 0.35, at.y + 0.02, at.z]], 0.012, 10, 3), C.rope, 0, 0, 0);
    }
  }),
  crates: part(1, (c) => {
    const S = sty(c), stamp = S.met;
    for (const pref of [0.08, -0.38]) {
      const at = spot(c, 0.45, pref, 's'), t = T(c);
      const st = [[0, 0, 0, 0.4], [0.42, 0, 0.05, 0.36], [0.2, 0.4, 0, 0.34], [-0.05, 0, -0.35 * Math.sign(at.z || 1), 0.3]];
      st.forEach(([dx, dy, dz, s], i) => {
        const col = i % 2 ? C.plank : 0x9a7a4a;
        t.push(at.x + dx - 0.2, at.y + dy, at.z + dz, 0, hash(i) * 0.5, 0);
        t.b.add(G.box(s, s, s), col, 0, s / 2, 0);
        // frame battens, diagonal brace, planks, the merchant's stamp
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.m.add(G.box(0.04, s * 1.01, 0.04), shade(col, 0.7), sx * s * 0.49, s / 2, sz * s * 0.49);
        for (const sz of [-1, 1]) { t.m.add(G.box(s * 1.01, 0.04, 0.04), shade(col, 0.7), 0, s * 0.98, sz * s * 0.49).add(G.box(s * 1.01, 0.04, 0.04), shade(col, 0.7), 0, 0.02, sz * s * 0.49); t.m.add(G.box(Math.hypot(s, s) * 0.9, 0.035, 0.02), shade(col, 0.75), 0, s / 2, sz * s * 0.505, { rz: sz * PI / 4 }); }
        for (let q = 1; q < 4; q++) t.f.add(G.box(0.006, s * 0.96, s * 1.005), shade(col, 0.6), -s / 2 + (s * q) / 4, s / 2, 0);
        t.push(s * 0.505, s * 0.55, 0, 0, PI / 2, 0); relief(t.f, S, s * 0.14, i % 2 ? 0x1a1a1a : stamp, null, { m: 0 }); t.pop();
        t.pop();
      });
      t.m.add(G.custom('sack', () => { const g = new THREE.SphereGeometry(0.2, 8, 6); const P = g.attributes.position; for (let i = 0; i < P.count; i++) P.setY(i, P.getY(i) * (P.getY(i) > 0 ? 1.4 : 0.8)); g.computeVertexNormals(); return g; }), 0xc8b88a, at.x + 0.35, at.y + 0.16, at.z - 0.3 * Math.sign(at.z || 1), { r: 1 });
    }
  }),
  tables: part(1.4, (c) => {
    const S = sty(c);
    for (const pref of [0.1, -0.2]) {
      const at = spot(c, 0.55, pref, 'c'), t = T(c);
      t.push(at.x, at.y, 0);
      t.b.add(G.box(1.1, 0.06, 0.5), C.plank, 0, 0.5, 0);
      for (let q = 1; q < 4; q++) t.f.add(G.box(1.1, 0.004, 0.006), shade(C.plank, 0.65), 0, 0.531, -0.25 + q * 0.125);
      for (const sx of [-1, 1]) { t.m.add(G.box(0.06, 0.48, 0.06), C.dark, sx * 0.45, 0.24, -0.18).add(G.box(0.06, 0.48, 0.06), C.dark, sx * 0.45, 0.24, 0.18); t.m.bar([sx * 0.45, 0.06, -0.18], [sx * 0.45, 0.06, 0.18], 0.02, C.dark); }
      t.l.add(G.box(0.9, 0.48, 0.3), C.dark, 0, 0.24, 0);
      for (const sz of [-1, 1]) { t.b.add(G.box(1.0, 0.05, 0.18), C.dark, 0, 0.28, sz * 0.42); for (const sx of [-1, 1]) t.m.add(G.box(0.04, 0.27, 0.12), C.dark, sx * 0.4, 0.13, sz * 0.42); }
      // the meal: tankards, a roast, bread, a jug, a cloth runner, candle
      t.m.add(G.box(0.9, 0.006, 0.22), S.id === 'hearthmoot' ? 0x6a8a4a : S.cloth, 0, 0.533, 0);
      for (let q = 0; q < 4; q++) { t.m.add(G.cyl(0.04, 0.035, 0.1, 8), S.met, -0.4 + q * 0.27, 0.58, (q % 2 ? 1 : -1) * 0.16, S.M); t.f.add(G.tor(0.025, 0.008, 3, 6), S.met, -0.36 + q * 0.27, 0.58, (q % 2 ? 1 : -1) * 0.16, S.M); }
      t.m.add(G.cyl(0.14, 0.12, 0.02, 12), S.met, 0.05, 0.54, 0, S.M).add(G.sph(0.09, 8, 6), 0x9a4a2a, 0.05, 0.6, 0, { sx: 1.4, sy: 0.7, r: 0.5 });
      t.m.add(G.sph(0.06, 6, 4), 0xc8984a, -0.2, 0.57, 0.04, { sx: 1.6, sy: 0.6 }).add(G.lathe('jug', [[0, 0], [0.05, 0], [0.065, 0.06], [0.04, 0.13], [0.03, 0.16]], 8), 0x8a5a3a, 0.3, 0.53, -0.05);
      t.m.add(G.cyl(0.015, 0.015, 0.1, 5), 0xf0e8d0, -0.05, 0.58, -0.08).add(G.sph(0.015, 4, 3), C.fire, -0.05, 0.645, -0.08, { g: 3 });
      t.pop();
    }
  }),
  chimneys: part(1.4, (c) => {
    const S = sty(c), n = c.L > 10 ? 3 : 2, grp = new THREE.Group(), stackC = S.metal === 'black' || S.metal === 'iron' || S.id === 'glimmer' ? (S.id === 'glimmer' ? C.bronze : 0x2a2a30) : C.brick;
    const brick = stackC === C.brick;
    for (let i = 0; i < n; i++) {
      const at = c.place(0.35, -0.1 + (i - (n - 1) / 2) * 0.16, 's'), h = (1.6 + hash(i) * 0.6) * c.k, t = T(c);
      t.push(at.x, at.y, at.z);
      if (brick) {
        t.b.add(G.box(0.42, h, 0.42), C.brick, 0, h / 2, 0, { r: 0.95 });
        for (let k = 1; k < Math.round(h / 0.1); k++) for (const s of [-1, 1]) { t.f.add(G.box(0.425, 0.008, 0.01), 0x5a2a1a, 0, k * 0.1, s * 0.211).add(G.box(0.01, 0.008, 0.425), 0x5a2a1a, s * 0.211, k * 0.1, 0); }
        t.m.add(G.box(0.52, 0.14, 0.52), shade(C.brick, 0.7), 0, h, 0).add(G.box(0.46, 0.06, 0.46), shade(C.brick, 0.6), 0, h * 0.35, 0);
      } else {
        t.b.add(G.lathe('stack', [[0, 0], [0.24, 0], [0.24, 0.05], [0.18, 0.12], [0.17, 0.92], [0.22, 1.0], [0.18, 1.0]], 12), stackC, 0, 0, 0, { sy: h, m: 0.65, r: 0.4 });
        for (let k = 0; k < 4; k++) t.m.add(G.tor(0.175, 0.02, 3, 12), S.met, 0, h * (0.25 + k * 0.2), 0, { ...S.M, rx: PI / 2 });
        for (let k = 0; k < 12; k++) t.f.add(G.sph(0.012, 4, 3), S.met, Math.cos(k * 0.52) * 0.18, h * 0.45, Math.sin(k * 0.52) * 0.18, S.M);
      }
      // spark-cage and the glow inside the mouth
      t.m.add(G.box(0.3, 0.02, 0.3), C.fire, 0, h + 0.07, 0, { g: 2 });
      for (let k = 0; k < 6; k++) t.f.add(G.cyl(0.008, 0.008, 0.2, 3), C.iron, Math.cos(k * 1.05) * 0.17, h + 0.17, Math.sin(k * 1.05) * 0.17, { m: 0.6 });
      t.m.add(G.cone(0.2, 0.12, 6), C.iron, 0, h + 0.33, 0, { m: 0.6 });
      t.pop();
      for (let k = 0; k < 3; k++) { const o = new THREE.Mesh(G.ico(1, 1), smoke()); o.userData.p = { x: at.x, y: at.y + h, z: at.z, k }; grp.add(o); }
    }
    c.addMoving(grp, (t, ph) => grp.children.forEach((o) => { const p = o.userData.p, f = (t * 0.3 + p.k / 3 + ph * 0.1) % 1; o.position.set(p.x - f * 1.3, p.y + 0.35 + f * 1.5, p.z); o.scale.setScalar(0.18 * (1 + f * 2.2)); }));
  }),
  drums: part(1.6, (c) => {
    const S = sty(c), at = spot(c, 0.8, 0.0, 'c'), t = T(c), skin = 0xd8c8a0, sticks = [];
    [[0, 0, 0.5], [-0.55, 0.35, 0.35], [-0.5, -0.4, 0.38]].forEach(([dx, dz, r], i) => {
      const h = r * 1.3, bx = at.x + dx, bz = dz, shell = i ? c.side : (S.crude ? 0x6a4a2a : 0x8a2a1a);
      t.push(bx, at.y, bz);
      t.b.add(G.lathe('drum', [[0, 0], [0.9, 0], [1, 0.1], [1.02, 0.5], [1, 0.9], [0.95, 1], [0, 1]], 16), shell, 0, 0.2, 0, { sx: r, sz: r, sy: h });
      t.m.add(G.circle(r * 0.97, 16), skin, 0, h + 0.205, 0, { rx: -PI / 2, r: 0.7 });
      for (const y of [0.25, h + 0.17]) t.m.add(G.tor(r * 1.0, 0.03, 4, 18), S.crude ? C.bone : S.met, 0, y, 0, { rx: PI / 2, ...(S.crude ? {} : S.M) });
      // zig-zag lacing, the realm's mark, the legs
      for (let q = 0; q < 12; q++) { const a = (q / 12) * PI * 2, a2 = ((q + 0.5) / 12) * PI * 2; t.f.add(tube([[Math.cos(a) * r * 1.02, 0.28, Math.sin(a) * r * 1.02], [Math.cos(a2) * r * 1.04, h * 0.6, Math.sin(a2) * r * 1.04], [Math.cos(a + PI / 6) * r * 1.02, h + 0.14, Math.sin(a + PI / 6) * r * 1.02]], 0.008, 4, 3), C.rope, 0, 0, 0); }
      t.push(r * 1.02, 0.2 + h * 0.5, 0, 0, PI / 2, 0); relief(t.m, S, r * 0.3, S.crude ? C.bone : S.met); t.pop();
      for (let k = 0; k < 3; k++) t.m.add(G.box(0.05, 0.22, 0.05), C.dark, Math.cos(k * 2.1) * r * 0.8, 0.1, Math.sin(k * 2.1) * r * 0.8);
      t.pop();
      // a pair of beaters over each skin, which strike in turn
      const sk = new DKit();
      for (const s of [-1, 1]) { sk.bar([0, 0, s * 0.1], [r * 0.7, -0.05, s * 0.08], 0.022, S.crude ? C.bone : S.wood); sk.add(G.sph(0.05, 8, 6), S.crude ? C.bone : 0xe8dcc0, r * 0.72, -0.05, s * 0.08); }
      if (i === 0) { t.push(bx - r - 0.12, at.y, bz - r * 0.75, 0, 0.5, 0); figure(t.b, c.side, 0xc89a7a, 2.1 * c.k, 'crew'); t.pop(); }
      const sm = sk.mesh(); sm.position.set(bx - r * 0.65, at.y + h + 0.45, bz); sm.rotation.z = 0.35;
      c.addMoving(sm);
      sticks.push({ sm, i });
    });
    act(c, 'aura', (kk) => { for (const s of sticks) { const b = kk <= 0 || kk >= 1 ? 0 : pulses(clamp(kk - s.i * 0.05, 0, 1), 6, 0.35); s.sm.rotation.z = 0.35 - b * 0.45; } });
    act(c, 'board', (kk) => { for (const s of sticks) s.sm.rotation.z = 0.35 - pulses(kk, 8, 0.3) * 0.4; });
    anchor(c, 'aura', [at.x, at.y + 1, 0]);
  }),
  totem: part(1.4, (c) => {
    const S = sty(c), at = spot(c, 0.4, -0.32, 'c'), t = T(c), h = clamp(c.L * 0.28, 2.2, 3.6), k = c.k;
    const cols = [0x8a2a1a, 0x2a5a8a, 0xd4a83a, 0x2a6a3a, S.cloth, S.cloth2];
    const wood = S.id === 'balor' || S.id === 'mistisles' ? 0x5a5a48 : S.id === 'xibalba' ? 0x9a8a6a : C.wood;
    t.push(at.x, at.y, 0);
    const n = 4, sh = h / (n + 0.5);
    t.b.add(G.cyl(0.36, 0.4, 0.12, 10), S.stone, 0, 0.06, 0);
    for (let i = 0; i < n; i++) {
      const y = sh * i + 0.1;
      hiAdd(t.b, () => HI.totemFace({ h: sh, r: 0.29, wood, col: cols[i % cols.length], kind: i }), 0, y, 0, {}, shade(0xffffff, 0.9 + (i % 2) * 0.1));
      const n0 = t.K.items.length;
      t.b.add(G.lathe('totseg', [[0.24, 0], [0.29, 0.05], [0.3, 0.5], [0.27, 0.95], [0.25, 1]], 10), shade(wood, 0.9 + (i % 2) * 0.2), 0, y, 0, { sy: sh, r: 0.9 });
      // a face: brows, eyes, nose or beak, mouth with teeth, ears
      t.push(0.27, y + sh * 0.5, 0);
      t.m.add(G.box(0.08, sh * 0.08, 0.42), cols[i % cols.length], 0.01, sh * 0.25, 0, { rz: 0.1 });
      for (const z of [-1, 1]) { t.m.add(G.sph(0.07, 8, 6), 0xf0e8d8, 0.02, sh * 0.12, z * 0.1, { sx: 0.5 }).add(G.sph(0.035, 6, 4), 0x101010, 0.05, sh * 0.12, z * 0.1, { sx: 0.5 }); t.m.add(G.sph(0.08, 6, 4), cols[(i + 2) % cols.length], -0.08, 0, z * 0.29, { sx: 0.4, sy: 1.6 }); }
      if (i % 2) t.m.add(G.cone(0.07, 0.3, 4), cols[(i + 1) % cols.length], 0.12, -sh * 0.05, 0, { rz: -PI / 2 - 0.4 }); else t.m.add(G.box(0.12, 0.1, 0.08), shade(wood, 0.8), 0.06, 0, 0);
      t.m.add(G.box(0.05, sh * 0.12, 0.3), 0x2a1010, 0.02, -sh * 0.25, 0);
      for (let q = 0; q < 5; q++) t.f.add(G.box(0.03, sh * 0.05, 0.03), 0xf0e8d8, 0.04, -sh * 0.2, (q - 2) * 0.055);
      t.pop();
      for (let q = n0; q < t.K.items.length; q++) t.K.items[q].farOnly = true;
      for (let q = 0; q < 12; q++) { const a = (q / 12) * PI * 2; t.f.add(G.box(0.01, sh * 0.06, 0.06), cols[(i + q) % cols.length], Math.cos(a) * 0.3, y + sh * 0.97, Math.sin(a) * 0.3, { ry: -a }); }
    }
    // spread wings at the crown, and the realm's finial
    for (const s of [-1, 1]) {
      t.push(0, h - sh * 0.6, s * 0.25, s * -1.15, 0, 0);
      t.b.add(G.shape('totwing2', [[0, 0], [0.25, 0.15], [0.35, 0.6], [0.2, 1.0], [0.05, 0.75], [-0.08, 0.4]], 0.05), cols[0], 0, 0, 0);
      for (let q = 0; q < 4; q++) t.m.add(G.box(0.18, 0.08, 0.06), cols[(q + 1) % 4], 0.12, 0.2 + q * 0.2, 0, { rz: 0.3 });
      t.pop();
    }
    t.push(0, h + 0.1, 0); finial(t.m, S, 0.8 * k); t.pop();
    t.pop();
    c.topAt = Math.max(c.topAt || 0, at.y + h + 0.6);
  }),
  braziers: part(0, (c) => {
    const S = sty(c), grp = new THREE.Group(), fc = S.id === 'khemet' || S.id === 'drowned' ? S.glow : S.id === 'kaelneth' || S.id === 'labyrinth' ? S.glow : 0xffa040;
    const fm = new THREE.MeshBasicMaterial({ color: fc, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const t = T(c);
    for (const s of [-1, 1]) for (const x of along(c, 2, 0.22, 0.78)) {
      const y = c.deckAt(x, s * c.B * 0.28), z = s * (c.hw(x) - 0.3);
      t.push(x, y, z);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * PI * 2; t.b.add(taper([[Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24], [Math.cos(a) * 0.1, 0.4, Math.sin(a) * 0.1], [0, 0.72, 0]], 0.028, 0.02, 4, 4), S.crude ? C.dark : S.met, 0, 0, 0, S.crude ? {} : S.M); t.m.add(G.sph(0.035, 5, 4), S.met, Math.cos(a) * 0.24, 0.02, Math.sin(a) * 0.24, S.M); }
      t.m.add(G.tor(0.14, 0.015, 3, 10), S.met, 0, 0.35, 0, { ...S.M, rx: PI / 2 });
      t.b.add(G.lathe('brazbowl', [[0, 0], [0.12, 0], [0.24, 0.1], [0.28, 0.2], [0.25, 0.21]], 12), S.crude ? C.iron : S.met, 0, 0.7, 0, S.M);
      for (let q = 0; q < 8; q++) { const a = (q / 8) * PI * 2; t.f.add(G.cone(0.02, 0.08, 4), S.met, Math.cos(a) * 0.27, 0.93, Math.sin(a) * 0.27, S.M); }
      t.m.add(G.sph(0.17, 8, 6), C.fire, 0, 0.88, 0, { g: 3, sy: 0.4 });
      for (let q = 0; q < 4; q++) t.f.add(G.box(0.2, 0.04, 0.04), 0x2a1a10, 0, 0.92, 0, { ry: q * 0.8 });
      t.pop();
      const f = new THREE.Mesh(G.cone(0.17, 0.5, 8), fm); f.position.set(x, y + 1.12, z); f.userData.y = y + 1.12; grp.add(f);
      const f2 = new THREE.Mesh(G.cone(0.09, 0.34, 6), glowMat(0xffe08a, 0.8)); f2.position.set(x, y + 1.05, z); f2.userData.y = y + 1.05; grp.add(f2);
      c.keep.push([x, z, 0.35]);
    }
    let boost = 0;
    c.addMoving(grp, (tt, ph) => grp.children.forEach((f, i) => { const q = (0.8 + 0.3 * Math.sin(tt * 9 + i * 1.7 + ph) + 0.15 * Math.sin(tt * 17 + i)) * (1 + boost * 1.4); f.scale.set(1 + boost * 0.4, q, 1 + boost * 0.4); f.position.y = f.userData.y + (q - 1) * 0.2; }));
    act(c, 'aura', (kk) => { boost = bump(kk); });
    act(c, 'fire', (kk) => { boost = kick(kk, 0.1) * 0.5; });
  }),
  lanterns: part(0, (c) => {
    const S = sty(c), t = T(c), gl = new DKit(), k = c.k, gc = S.rs.lantern === 'paper' ? 0xff6a3a : S.glow;
    for (const s of [-1, 1]) for (const x of along(c, 3, 0.12, 0.85)) {
      const y = railY(c, x, s), z = railZ(c, x, s) - s * 0.05;
      // a bracket on the rail and the realm's own lamp on it
      t.push(x, y - 0.12, z);
      t.b.add(G.cyl(0.035, 0.045, 0.3, 6), S.dark, 0, 0.12, 0);
      t.m.add(G.cyl(0.06, 0.05, 0.04, 8), S.met, 0, 0.28, 0, S.M);
      t.m.bar([0, 0.05, 0], [0, 0.2, -s * 0.12], 0.015, S.met, S.M);
      t.push(0, 0.28, 0); rsLantern(t.b, S.rs, 0.8 * k); t.pop();
      t.pop();
      gl.add(G.sph(0.22 * k, 8, 6), gc, x, y + 0.16 + 0.45 * k, z);
    }
    const gm = glowMesh(gl, 0.16);
    let boost = 0;
    c.addMoving(gm, (tt, ph) => { gm.material.opacity = 0.13 + 0.05 * Math.sin(tt * 5 + ph) + 0.03 * Math.sin(tt * 13) + boost * 0.65; gm.scale.setScalar(1); });
    act(c, 'aura', (kk) => { boost = bump(kk); });
  }),
  banners: part(0, (c) => {
    const S = sty(c), t = T(c), n = c.L > 10 ? 3 : 2, k = c.k;
    for (const s of [-1, 1]) for (const x of along(c, n, 0.12, 0.8)) {
      const y = railY(c, x, s) - 0.15, z = railZ(c, x, s) - s * 0.08;
      // a socket on the rail and the realm's banner in its own cut, flying aft
      t.push(x, y, z);
      t.m.add(G.cyl(0.06, 0.07, 0.18, 8), S.met, 0, 0.09, 0, S.M).add(G.tor(0.065, 0.012, 3, 10), S.met, 0, 0.2, 0, { ...S.M, rx: PI / 2 });
      t.push(0, 0, 0, 0, s * 0.18, 0);
      const top = rsBanner(t.b, S.rs, 0.62 * k, 0.5 * k, c.side);
      t.pop();
      t.push(0, top, 0); finial(t.m, S, 0.3 * k); t.pop();
      t.pop();
    }
  }),
  shields: part(0, (c) => {
    const S = sty(c), t = T(c), heater = S.motif === 'lily' || S.motif === 'star' || S.id === 'crimson', oblong = S.roof === 'curved';
    for (const s of [-1, 1]) {
      const xs = along(c, Math.max(5, Math.round(c.L * 0.8)), 0.12, 0.84);
      xs.forEach((x, i) => {
        const y = railY(c, x, s) - 0.25, z = railZ(c, x, s) + s * 0.06, r = 0.26 * c.k, col = i % 2 ? c.side : c.trimC, col2 = i % 2 ? c.trimC : c.side;
        t.push(x, y, z, 0, s > 0 ? 0 : PI, 0);
        if (heater) {
          t.b.add(G.shape('heater', [[-1, 1], [1, 1], [1, 0.2], [0.6, -0.6], [0, -1.1], [-0.6, -0.6], [-1, 0.2]], 0.1), col, 0, 0, 0, { s: r * 0.9 });
          t.m.add(G.box(r * 0.25, r * 1.8, 0.02), col2, 0, -0.05 * r, r * 0.05).add(G.box(r * 1.7, r * 0.25, 0.02), col2, 0, r * 0.45, r * 0.05);
          t.push(0, r * 0.1, r * 0.07); relief(t.f, S, r * 0.3, S.met); t.pop();
        } else if (oblong) {
          t.b.add(G.box(r * 1.3, r * 2, 0.05), col, 0, 0, 0);
          t.m.add(G.box(r * 1.34, 0.03, 0.06), S.met, 0, r * 0.95, 0, S.M).add(G.box(r * 1.34, 0.03, 0.06), S.met, 0, -r * 0.95, 0, S.M);
          t.push(0, 0, 0.03); relief(t.m, S, r * 0.45, col2, null, { m: 0 }); t.pop();
        } else {
          t.b.add(G.cyl(r, r, 0.05, 16), col, 0, 0, 0, { rx: PI / 2 });
          t.m.add(G.box(r * 2, r * 0.35, 0.01), col2, 0, 0, 0.026, { rz: i * 0.7 });
          t.m.add(G.tor(r, 0.025, 4, 18), S.crude ? C.rope : C.iron, 0, 0, 0.01, { m: 0.6 }).add(G.sph(r * 0.25, 8, 6), S.met, 0, 0, 0.03, { ...S.M, sz: 0.6 });
          for (let q = 0; q < 8; q++) t.f.add(G.sph(0.012, 4, 3), C.iron, Math.cos(q * 0.785) * r * 0.85, Math.sin(q * 0.785) * r * 0.85, 0.028, { m: 0.6 });
          if (S.crude) t.f.add(G.cone(0.02, 0.1, 4), C.bone, 0, 0, r * 0.12, { rx: PI / 2 });
        }
        t.pop();
      });
    }
  }),
  spikes: part(0, (c) => {
    const S = sty(c), t = T(c), col = S.metal === 'bone' ? C.bone : S.metal === 'rust' ? 0x5a3a2a : S.metal === 'gold' || S.metal === 'brass' ? S.met : C.iron, mo = S.metal === 'bone' ? { r: 0.6 } : { m: 0.7, r: 0.4 };
    for (const s of [-1, 1]) for (const [i, x] of along(c, Math.max(6, Math.round(c.L)), 0.06, 0.92).entries()) {
      const y = railY(c, x, s) - 0.15, z = railZ(c, x, s), L = (0.5 + hash(i) * 0.15) * c.k;
      t.push(x, y + 0.15, z + s * 0.12, s * 0.9, 0, 0);
      t.b.add(taper([[0, 0, 0], [0, L * 0.5, 0.02 * s], [0, L, 0.08 * s]], 0.07, 0.004, 5, 6), col, 0, 0, 0, mo);
      t.m.add(G.cyl(0.09, 0.1, 0.06, 8), S.met, 0, 0, 0, S.M);
      t.f.add(G.tor(0.072, 0.01, 3, 8), S.met, 0, L * 0.15, 0, { ...S.M, rx: PI / 2 });
      t.pop();
    }
    for (let i = 0; i < 3; i++) { const bx = c.bowX - 0.3 - i * 0.3; t.push(bx, c.deckAt(c.bowX - 0.5) + 0.3, 0, 0, 0, -1.2); t.b.add(taper([[0, 0, 0], [0, 0.3, 0], [0, 0.65, 0]], 0.09, 0.004, 4, 6), col, 0, 0, 0, mo); t.m.add(G.cyl(0.11, 0.12, 0.06, 8), S.met, 0, 0, 0, S.M); t.pop(); }
  }),
  plates: part(0, (c) => {
    const S = sty(c), t = T(c), col = blend(c.hullC, S.metal === 'gold' || S.metal === 'gilt' || S.metal === 'brass' ? C.bronze : C.steel, 0.55), rivet = S.metal === 'gold' || S.metal === 'gilt' ? C.gold : C.iron;
    for (const s of [-1, 1]) {
      const xs = along(c, Math.max(4, Math.round(c.L * 0.5)), 0.1, 0.84);
      xs.forEach((x, i) => {
        const y1 = hullH(c, x) * 0.88, y0 = 0.08, zl = c.hwLo(x) + 0.04, zh = c.hw(x) + 0.04, tilt = Math.atan2(zh - zl, y1 - y0);
        const z = s * (zl + zh) / 2, w = (c.bowX - c.sternX) * 0.74 / xs.length + 0.08, h = Math.hypot(y1 - y0, zh - zl);
        t.push(x, (y0 + y1) / 2, z, s * tilt, 0, 0);
        t.b.add(G.box(w, h, 0.06), shade(col, 0.85 + (i % 2) * 0.15), 0, 0, 0, { m: 0.7, r: 0.45 });
        // bevelled rim and a raised boss with the realm's mark on every other plate
        for (const e of [-1, 1]) { t.m.add(G.box(w, 0.04, 0.03), shade(col, 1.15), 0, e * h * 0.48, s * 0.035, { m: 0.75, r: 0.35 }); t.m.add(G.box(0.04, h, 0.03), shade(col, 0.7), e * w * 0.48, 0, s * 0.035, { m: 0.7, r: 0.4 }); }
        for (const yy of [-0.38, 0, 0.38]) for (const xx of [-0.42, 0.42]) t.f.add(G.sph(0.03, 5, 4), rivet, xx * w, yy * h, s * 0.04, { m: 0.8 });
        for (const xx of [-0.2, 0, 0.2]) for (const yy of [-0.42, 0.42]) t.f.add(G.sph(0.03, 5, 4), rivet, xx * w, yy * h, s * 0.04, { m: 0.8 });
        t.l.add(G.box(w * 0.95, 0.04, 0.03), shade(col, 1.1), 0, h * 0.45, s * 0.04);
        if (i % 2 === 0 && h > 0.35) { t.push(0, 0, s * 0.035, 0, s > 0 ? 0 : PI, 0); relief(t.f, S, Math.min(w, h) * 0.2, S.met); t.pop(); }
        t.pop();
      });
    }
  }),
  chains: part(0, (c) => {
    const S = sty(c), t = T(c), link = S.metal === 'rust' ? 0x5a3a2a : S.metal === 'gold' || S.metal === 'gilt' ? C.bronze : C.iron;
    for (const s of [-1, 1]) {
      const xs = along(c, 4, 0.12, 0.85);
      for (let i = 0; i < xs.length - 1; i++) {
        const a = [xs[i], railY(c, xs[i], s) - 0.15, railZ(c, xs[i], s) + s * 0.05], b = [xs[i + 1], railY(c, xs[i + 1], s) - 0.15, railZ(c, xs[i + 1], s) + s * 0.05];
        new View(c.kit, 9, 2).rope(a, b, 0.45, 0.045, link, { m: 0.7, r: 0.45 });
        // proper links along the catenary
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]) * 1.15, n = Math.max(6, Math.round(len / 0.1));
        let prev = null;
        for (let q = 0; q <= n; q++) {
          const f = q / n, p = [lerp(a[0], b[0], f), lerp(a[1], b[1], f) - Math.sin(f * PI) * 0.45, lerp(a[2], b[2], f)];
          if (prev) { const dx = p[0] - prev[0], dy = p[1] - prev[1], ang = Math.atan2(dy, dx); t.f.add(G.tor(0.05, 0.016, 3, 6), link, (p[0] + prev[0]) / 2, (p[1] + prev[1]) / 2, (p[2] + prev[2]) / 2, { rz: ang, rx: q % 2 ? PI / 2 : 0, sx: 1.4, m: 0.7, r: 0.45 }); }
          prev = p;
        }
      }
      for (const x of xs) { t.b.add(G.tor(0.09, 0.03, 4, 10), link, x, railY(c, x, s) - 0.2, railZ(c, x, s) + s * 0.06, { m: 0.7 }); t.m.add(G.box(0.12, 0.12, 0.03), S.met, x, railY(c, x, s) - 0.1, railZ(c, x, s) + s * 0.04, S.M); }
    }
    // an anchor at the bow: shank, stock, flukes
    const bx = c.bowX - c.L * 0.08, z = c.hw(bx) + 0.1, y = c.deckAt(bx) - 0.2;
    t.b.add(taper([[bx, y, z], [bx - 0.1, y - 0.95, z + 0.05]], 0.05, 0.045, 2, 6), link, 0, 0, 0, { m: 0.7 });
    t.b.add(G.tor(0.3, 0.05, 5, 12, PI), link, bx - 0.1, y - 0.9, z + 0.05, { rz: PI, m: 0.7 });
    for (const e of [-1, 1]) t.m.add(G.cone(0.08, 0.2, 4), link, bx - 0.1 + e * 0.3, y - 0.85, z + 0.05, { rz: e * 0.4, m: 0.7, sz: 0.3 });
    t.m.add(G.cyl(0.03, 0.03, 0.5, 5), S.wood, bx - 0.02, y - 0.15, z + 0.05, { rz: PI / 2 }).add(G.tor(0.06, 0.015, 3, 8), link, bx, y + 0.05, z, { m: 0.7 });
  }),
  skulls: part(0, (c) => {
    const S = sty(c), t = T(c), bone = S.id === 'kharnak' ? 0xd8c8a8 : S.id === 'drowned' ? 0xb8b8a0 : C.bone;
    for (const s of [-1, 1]) for (const x of along(c, 3, 0.15, 0.85)) {
      const y = railY(c, x, s), z = railZ(c, x, s);
      t.b.add(G.cyl(0.02, 0.025, 0.75, 5), C.dark, x, y + 0.2, z);
      t.m.add(G.cone(0.02, 0.1, 4), S.met, x, y + 0.82, z, S.M);
      t.push(x, y + 0.55, z, 0, s > 0 ? -PI / 2 : PI / 2, 0, 1.3); skull(t.b, 1, bone); t.pop();
      for (let q = 0; q < 2; q++) t.f.add(G.cyl(0.006, 0.006, 0.25, 3), C.rope, x + (q - 0.5) * 0.08, y + 0.4, z + s * 0.03, { rz: 0.1 }).add(G.sph(0.02, 4, 3), q ? C.bone : S.met, x + (q - 0.5) * 0.08, y + 0.27, z + s * 0.03);
    }
    t.push(c.bowX - 0.2, c.deckAt(c.bowX - 0.4) + 0.3, 0, 0, 0, 0, 2.2); skull(t.b, 1, bone); t.pop();
    for (const e of [-1, 1]) t.m.add(taper([[c.bowX - 0.25, c.deckAt(c.bowX - 0.4) + 0.75, e * 0.2], [c.bowX - 0.3, c.deckAt(c.bowX - 0.4) + 1.05, e * 0.45], [c.bowX - 0.1, c.deckAt(c.bowX - 0.4) + 1.3, e * 0.5]], 0.06, 0.005, 6, 5), bone, 0, 0, 0);
  }),
  gargoyles: part(0, (c) => {
    const S = sty(c), t = T(c), st = blend(C.darkStone, c.hullC, 0.2), eye = S.id === 'crimson' ? 0xff2a3a : 0xff6a1a;
    for (const s of [-1, 1]) for (const x of [lerp(c.sternX, c.bowX, 0.12), lerp(c.sternX, c.bowX, 0.85)]) {
      const y = railY(c, x, s), z = railZ(c, x, s);
      t.push(x, y, z, 0, s > 0 ? -PI / 2 : PI / 2, 0, c.k);
      hiAdd(t.b, () => HI.gargoyle({ s: 1.05, stone: st, eye }), 0, 0, 0);
      const n0 = t.K.items.length;
      // crouched body, haunches, forelimbs gripping the rail
      t.b.add(G.sph(0.22, 10, 8), st, 0, 0.25, 0, { sx: 1.2, r: 0.85 });
      for (const w of [-1, 1]) { t.b.add(G.sph(0.11, 8, 6), st, -0.12, 0.15, w * 0.15, { sx: 1.3 }); t.m.add(taper([[0.12, 0.25, w * 0.12], [0.22, 0.12, w * 0.12], [0.26, 0.0, w * 0.1]], 0.05, 0.035, 4, 5), st, 0, 0, 0); for (let q = 0; q < 3; q++) t.f.add(G.cone(0.012, 0.06, 3), st, 0.29, 0.0, w * 0.1 + (q - 1) * 0.025, { rz: -PI / 2 - 0.6 }); }
      // the head: brow, horns, jaw open, glowing eyes, ears
      t.push(0.22, 0.45, 0);
      t.b.add(G.sph(0.13, 10, 8), st, 0, 0, 0, { sx: 1.1 });
      t.m.add(G.box(0.14, 0.04, 0.2), st, 0.08, 0.06, 0).add(G.box(0.16, 0.05, 0.12), st, 0.12, -0.04, 0).add(G.box(0.14, 0.03, 0.1), st, 0.1, -0.1, 0, { rz: -0.35 });
      for (let q = 0; q < 4; q++) t.f.add(G.cone(0.01, 0.04, 3), 0xd8d0c0, 0.16 + q * 0.015, -0.07, (q - 1.5) * 0.025, { rz: PI });
      for (const w of [-1, 1]) { t.m.add(taper([[-0.02, 0.08, w * 0.06], [-0.1, 0.2, w * 0.12], [-0.2, 0.22, w * 0.1]], 0.035, 0.004, 6, 4), st, 0, 0, 0); t.m.add(G.cone(0.03, 0.1, 4), st, -0.04, 0.06, w * 0.12, { rx: w * 1.2 }); t.b.add(G.sph(0.028, 6, 4), eye, 0.11, 0.03, w * 0.055, { g: 3 }); }
      t.pop();
      // wings with finger-bones
      for (const w of [-1, 1]) {
        t.push(-0.05, 0.32, w * 0.15, 0, w * 0.6, 0);
        t.b.add(G.shape('gwing2', [[0, 0], [-0.15, 0.3], [-0.45, 0.55], [-0.55, 0.3], [-0.42, 0.25], [-0.45, 0.05], [-0.3, 0.1], [-0.2, -0.05]], 0.02), st, 0, 0, 0);
        for (const [ex, ey] of [[-0.45, 0.55], [-0.55, 0.3], [-0.45, 0.05]]) t.m.bar([-0.1, 0.15, 0], [ex, ey, 0], 0.012, shade(st, 0.8));
        t.pop();
      }
      for (let i = n0; i < t.K.items.length; i++) t.K.items[i].farOnly = true;
      t.l.add(G.box(0.4, 0.5, 0.3), st, 0, 0.25, 0);
      t.pop();
    }
  }),
  astrolabe: part(1.6, (c) => {
    const S = sty(c), at = spot(c, 0.6, -0.3, 'c'), R = 0.55 * c.k, y = at.y + 0.95 + R, t = T(c), ring = S.metal === 'iron' || S.metal === 'rust' || S.metal === 'black' ? C.bronze : S.met, gc = S.glow;
    t.push(at.x, at.y, 0);
    t.b.add(G.lathe('astroped', [[0, 0], [0.32, 0], [0.34, 0.06], [0.2, 0.15], [0.12, 0.8], [0.18, 0.9], [0.1, 0.95], [0, 0.95]], 10), ring, 0, 0, 0, { m: 0.8, r: 0.3 });
    for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2; t.m.add(taper([[Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3], [Math.cos(a) * 0.35, 0.3, Math.sin(a) * 0.35], [Math.cos(a) * 0.14, 0.7, Math.sin(a) * 0.14]], 0.025, 0.015, 5, 4), ring, 0, 0, 0, { m: 0.8 }); }
    t.b.add(G.sph(0.14, 12, 10), gc, 0, y - at.y, 0, { g: 1.5, r: 0.2 });
    // the meridian frame, fixed: half-ring and its zodiac teeth
    t.m.add(G.tor(R * 1.12, 0.03, 4, 28, PI), ring, 0, y - at.y, 0, { m: 0.85, r: 0.25 });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * PI; t.f.add(G.box(0.02, 0.06, 0.04), ring, Math.cos(a) * R * 1.17, y - at.y + Math.sin(a) * R * 1.17, 0, { rz: a, m: 0.85 }); }
    t.pop();
    // the armillary turns: rings within rings and little planets
    const a = mover();
    a.b.add(G.tor(R, 0.035, 5, 32), ring, 0, 0, 0, { m: 0.9, r: 0.25 }).add(G.tor(R * 0.86, 0.03, 5, 28), ring, 0, 0, 0, { rx: PI / 2, m: 0.9, r: 0.25 }).add(G.tor(R * 0.72, 0.03, 5, 26), C.bronze, 0, 0, 0, { ry: PI / 2, m: 0.9, r: 0.25 });
    a.m.add(G.tor(R * 1.05, 0.02, 4, 32), ring, 0, 0, 0, { rx: PI / 2 - 0.4, m: 0.9 });
    for (let i = 0; i < 24; i++) { const q = (i / 24) * PI * 2; a.f.add(G.box(0.012, 0.04, 0.012), shade(ring, 0.7), Math.cos(q) * R, Math.sin(q) * R, 0, { rz: q }); }
    [[R, 0, 0x8ac0ff], [0, R * 0.86, 0xff8a4a], [R * 0.72 * 0.7, R * 0.72 * 0.7, 0xe8e0c0]].forEach(([px, py, col]) => a.m.add(G.sph(0.05, 8, 6), col, px, py, 0, { g: 1 }));
    a.push(0, R * 1.1, 0); finial(a.m, S, 0.4, S.fin === 'spike' ? 'orb' : S.fin); a.pop();
    const m = moverMesh(c, a); m.position.set(at.x, y, 0);
    let extra = 0;
    c.addMoving(m, (tt) => { m.rotation.y = tt * 0.5 + extra; m.rotation.x = Math.sin(tt * 0.3) * 0.3; });
    act(c, 'aura', (kk) => { extra = spinK(kk, 3); });
    anchor(c, 'aura', [at.x, y, 0]);
  }),
  bells: part(1.6, (c) => {
    const S = sty(c), at = spot(c, 0.6, -0.12, 'c'), t = T(c), w = clamp(c.B * 0.4, 1.0, 1.8), h = 1.7 * c.k, k = c.k, bellC = S.metal === 'silver' ? C.bronze : S.metal === 'rust' ? 0x7a5a3a : C.bronze;
    t.push(at.x, at.y, 0);
    for (const z of [-1, 1]) { t.b.add(G.box(0.14, h, 0.14), S.dark, 0, h / 2, z * w / 2); t.m.bar([0, 0.05, z * (w / 2 + 0.3)], [0, h * 0.6, z * w / 2], 0.05, S.dark).bar([0.3, 0.05, z * w / 2], [0, h * 0.5, z * w / 2], 0.05, S.dark); t.m.add(G.box(0.2, 0.08, 0.2), S.met, 0, h, z * w / 2, S.M); }
    t.b.add(G.box(0.16, 0.16, w + 0.25), S.dark, 0, h, 0);
    t.m.add(G.box(0.18, 0.04, w + 0.3), S.met, 0, h + 0.1, 0, S.M);
    if (S.roof === 'curved' || S.roof === 'onion' || S.roof === 'spire') { t.push(0, h + 0.12, 0); roofOf(t, S, 0.6, w + 0.6, shade(c.hullC, 0.6), S.roof === 'curved' ? 'curved' : 'gable', k * 0.7); t.pop(); }
    t.push(0, h + 0.2, 0); finial(t.m, S, 0.5 * k); t.pop();
    t.pop();
    // the bells swing on their own pins
    const bells = [];
    const prof = S.roof === 'curved' ? [[0, 0.5], [0.15, 0.49], [0.24, 0.4], [0.27, 0.1], [0.28, 0], [0.26, -0.02]] : [[0, 0.5], [0.12, 0.48], [0.2, 0.36], [0.22, 0.12], [0.32, 0], [0.3, -0.03]];
    [-0.3, 0, 0.3].forEach((f, i) => {
      const s = (i === 1 ? 1.1 : 0.8) * k, b = mover();
      b.push(0, -0.6 * s, 0);
      b.b.add(G.lathe(`bell${S.roof === 'curved'}`, prof, 16), bellC, 0, 0, 0, { s, m: 0.85, r: 0.3 });
      b.m.add(G.tor(0.215 * s, 0.012 * s, 3, 16), shade(bellC, 1.15), 0, 0.12 * s, 0, { rx: PI / 2, m: 0.85 }).add(G.tor(0.3 * s, 0.012 * s, 3, 16), shade(bellC, 1.15), 0, 0.01 * s, 0, { rx: PI / 2, m: 0.85 });
      for (let q = 0; q < 4; q++) b.f.add(G.box(0.03 * s, 0.03 * s, 0.01), shade(bellC, 0.7), Math.cos(q * PI / 2) * 0.215 * s, 0.25 * s, Math.sin(q * PI / 2) * 0.215 * s, { ry: -q * PI / 2 + PI / 2 });
      b.m.add(G.tor(0.06 * s, 0.015 * s, 3, 8), C.iron, 0, 0.53 * s, 0, { m: 0.6 }).bar([0, 0.45 * s, 0], [0, -0.05 * s, 0], 0.01, C.iron).add(G.sph(0.045 * s, 6, 4), C.iron, 0, -0.07 * s, 0, { m: 0.6 });
      b.pop();
      b.m.add(G.box(0.05, 0.2 * s, 0.05), C.iron, 0, -0.05 * s, 0, { m: 0.6 });
      const bm = moverMesh(c, b); bm.position.set(at.x, at.y + h - 0.05, f * w);
      c.addMoving(bm); bells.push({ bm, i });
    });
    act(c, 'aura', (kk) => { for (const b of bells) b.bm.rotation.x = Math.sin(kk * PI * 6 + b.i * 0.8) * 0.6 * (1 - kk) * bump(Math.min(1, kk * 4)) * (kk < 1 ? 1 : 0); });
    act(c, 'hit', (kk) => { for (const b of bells) b.bm.rotation.x = Math.sin(kk * PI * 4 + b.i) * 0.25 * (1 - kk) * (kk > 0 && kk < 1 ? 1 : 0); });
    anchor(c, 'aura', [at.x, at.y + h, 0]);
  }),
  pustules: part(0, (c) => {
    const S = sty(c), K = mover(), goo = blend(C.slime, 0xd8e05a, 0.3), flesh = blend(c.hullC, C.flesh, 0.5);
    for (const s of [-1, 1]) for (let i = 0; i < 7; i++) {
      const x = lerp(c.sternX, c.bowX, 0.1 + i * 0.12 + hash(i + s) * 0.05), top = hullH(c, x), y = top * (0.35 + hash(i * 3 + s) * 0.4), z = s * (c.hw(x) + 0.05), r = (0.18 + hash(i + 2) * 0.16) * c.k;
      hiAdd(K.K, () => HI.pustule({ r: 0.25, flesh, goo }), x, y, z, { s: r / 0.25, ry: s > 0 ? 0 : PI });
      const n0 = K.K.items.length;
      K.b.add(G.sph(r * 1.25, 8, 6), flesh, x, y, z, { sz: 0.6, r: 0.5 }).add(G.sph(r, 8, 6), goo, x, y, z + s * r * 0.4, { g: 1.1, r: 0.2 });
      K.m.add(G.sph(r * 0.25, 6, 5), 0xffffc0, x + r * 0.2, y + r * 0.35, z + s * r * 1.15, { g: 1.5 });
      // veins running from it
      for (let q = 0; q < 2; q++) { const a = q * 2.1 + i; K.f.add(tube([[x, y, z + s * r * 0.3], [x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 1.4, z + s * r * 0.1], [x + Math.cos(a + 0.4) * r * 2.6, y + Math.sin(a + 0.4) * r * 2.2, z]], 0.018, 6, 3), 0x5a3a4a, 0, 0, 0, { r: 0.4 }); }
      for (let q = 0; q < 2; q++) K.f.add(G.sph(r * 0.3, 6, 5), goo, x + (hash(q + i) - 0.5) * r * 3, y + (hash(q * 2 + i) - 0.5) * r * 2, z + s * r * 0.2, { g: 1, sz: 0.6 });
      for (let q = n0; q < K.K.items.length; q++) if (q < n0 + 3 || K.K.items[q].geo?.type === 'TubeGeometry') K.K.items[q].farOnly = true;
    }
    for (let i = 0; i < 5; i++) { const at = c.place(0.25, (hash(i) - 0.5) * 0.7, 's', false); K.b.add(G.sph(0.22 * c.k, 10, 8), goo, at.x, at.y + 0.1, at.z, { g: 1.1, r: 0.2, sy: 0.7 }); K.m.add(G.sph(0.1 * c.k, 6, 5), goo, at.x + 0.2, at.y + 0.05, at.z + 0.1, { g: 1.1, sy: 0.6 }); K.f.add(G.circle(0.35 * c.k, 10), 0x6a8a2a, at.x, at.y + 0.01, at.z, { rx: -PI / 2, g: 0.4 }); }
    const m = moverMesh(c, K);
    c.addMoving(m, (t, ph) => { const k = 1 + 0.03 * Math.sin(t * 2.2 + ph); m.scale.set(1, k, 1); });
  }),
  vines: part(0, (c) => {
    const S = sty(c), t = T(c), vine = 0x3a6a2a, leaf = S.id === 'morbus' ? 0x6a7a2a : C.leaf, flower = S.id === 'velvet' ? 0xff6ab0 : S.id === 'emerald' ? 0xf0f0ff : S.id === 'deeproot' ? 0xffc84a : 0xe85a8a;
    for (const s of [-1, 1]) {
      const xs = along(c, 7, 0.05, 0.95);
      for (let i = 0; i < xs.length - 1; i++) {
        const a = [xs[i], railY(c, xs[i], s) - 0.1, railZ(c, xs[i], s) + s * 0.06], b = [xs[i + 1], railY(c, xs[i + 1], s) - 0.1, railZ(c, xs[i + 1], s) + s * 0.06], sag = 0.25 + hash(i) * 0.3;
        t.b.rope(a, b, sag, 0.05, vine, { m: 0, r: 0.9 });
        t.m.rope([a[0], a[1] + 0.03, a[2] + s * 0.02], [b[0], b[1] - 0.02, b[2]], sag * 0.7, 0.025, shade(vine, 1.2), { m: 0, r: 0.9 });
        for (let q = 0; q < 5; q++) {
          const f = (q + 0.5) / 5, p = [lerp(a[0], b[0], f), lerp(a[1], b[1], f) - Math.sin(f * PI) * sag, lerp(a[2], b[2], f) + s * 0.04];
          t.m.add(G.sph(0.09, 6, 4), shade(leaf, 0.8 + hash(q + i * 5) * 0.4), p[0], p[1], p[2], { sx: 1.4, sy: 0.25, sz: 0.8, rx: hash(q) * 2, ry: q * 1.7 });
          if ((q + i) % 3 === 0) t.f.add(G.sph(0.04, 6, 4), flower, p[0], p[1] - 0.05, p[2] + s * 0.03, { g: 0.3 }).add(G.sph(0.015, 4, 3), 0xffe04a, p[0], p[1] - 0.04, p[2] + s * 0.06);
        }
        t.b.add(G.ico(0.16, 1), shade(leaf, 0.8 + hash(i) * 0.4), (a[0] + b[0]) / 2, a[1] - 0.3, a[2], { sy: 0.5 });
        t.m.add(taper([[a[0], a[1], a[2]], [a[0] + 0.05, a[1] - 0.4, a[2] + s * 0.04], [a[0] + 0.1, a[1] - 0.7 - hash(i + 3) * 0.6, a[2] + s * 0.05]], 0.025, 0.006, 6, 4), vine, 0, 0, 0);
        for (let q = 0; q < 3; q++) t.f.add(G.sph(0.05, 5, 3), leaf, a[0] + 0.05, a[1] - 0.25 - q * 0.2, a[2] + s * 0.06, { sx: 1.3, sy: 0.25, ry: q });
      }
    }
    for (const x of along(c, 2, 0.3, 0.7)) { t.b.add(G.ico(0.3, 1), leaf, x, c.deckAt(x) + 0.2, 0, { sy: 0.5 }); for (let q = 0; q < 4; q++) t.m.add(G.sph(0.1, 6, 4), shade(leaf, 1.1), x + Math.cos(q * 1.6) * 0.3, c.deckAt(x) + 0.15, Math.sin(q * 1.6) * 0.3, { sx: 1.4, sy: 0.3 }); }
  }),
  bones: part(1, (c) => {
    const S = sty(c), t = T(c), bone = S.id === 'drowned' ? 0xc8c8b0 : C.bone;
    for (const x of along(c, 4, 0.2, 0.8)) {
      const w = c.hw(x), y = c.deckAt(x, c.B * 0.28);
      t.b.add(G.tor(w * 0.95, 0.07 * c.k, 6, 18, PI), bone, x, y + 0.15, 0, { ry: PI / 2, sy: 1.5, r: 0.7 });
      for (const s of [-1, 1]) { t.b.add(taper([[x, y + 0.2, s * w * 0.9], [x, y + 0.35, s * (w + 0.1)], [x, y + 0.45, s * (w + 0.4)]], 0.07, 0.004, 5, 5), bone, 0, 0, 0, { r: 0.6 }); t.m.add(G.sph(0.09 * c.k, 8, 6), bone, x, y + 0.12, s * w * 0.95, { r: 0.6 }); }
      for (let q = 0; q < 6; q++) { const a = (q / 5) * PI; t.f.add(G.sph(0.03, 5, 4), shade(bone, 0.85), x, y + 0.15 + Math.sin(a) * w * 0.95 * 1.5, Math.cos(a) * w * 0.95, { sx: 1.6 }); }
    }
    // the spine overhead, vertebra by vertebra
    const L = (c.bowX - c.sternX) * 0.6, cx = (c.bowX + c.sternX) / 2, sy = c.dy + c.hw(0) * 1.4 + 0.15;
    t.l.add(G.cyl(0.08, 0.06, L, 6), bone, cx, sy, 0, { rz: PI / 2 });
    const nv = Math.round(L / 0.16);
    for (let i = 0; i < nv; i++) { const x = cx - L / 2 + (L * (i + 0.5)) / nv, r = 0.08 - (i / nv) * 0.02; t.b.add(G.cyl(r, r, L / nv * 0.7, 8), bone, x, sy, 0, { rz: PI / 2, r: 0.6 }); t.m.add(G.cone(0.025, 0.12, 4), bone, x, sy + r + 0.05, 0, { rz: 0.4 }); for (const s of [-1, 1]) t.f.add(G.cone(0.018, 0.1, 3), bone, x, sy, s * (r + 0.04), { rx: s * PI / 2 }); }
    const at = c.place(0.4, 0.3, 's', false); t.push(at.x, at.y, at.z, 0, 0.5, 0, 1.4); skull(t.b, 1, bone); t.pop();
    t.push(at.x - 0.3, at.y, at.z, 0, 1.2, 0); for (let q = 0; q < 3; q++) t.m.add(G.cyl(0.025, 0.02, 0.45, 5), bone, q * 0.06, 0.03, q * 0.05, { rz: PI / 2, ry: q * 0.6 }).add(G.sph(0.035, 5, 4), bone, 0.22 + q * 0.06, 0.03, q * 0.05); t.pop();
  }),
  cranes: part(1.4, (c) => {
    const S = sty(c);
    c.hooks = []; c.hookObjs = [];
    const booms = [];
    for (const [pref, s] of [[0.15, 1], [-0.2, -1]]) {
      const at = c.place(0.35, pref, 's'), z0 = at.z, sg = Math.sign(z0) || s, t = T(c), h = 2 * c.k, reach = c.hw(at.x) + 0.9, k = c.k;
      t.push(at.x, at.y, z0);
      t.b.add(G.cyl(0.2, 0.24, 0.15, 10), C.iron, 0, 0.08, 0, { m: 0.6 });
      for (let q = 0; q < 8; q++) t.f.add(G.sph(0.02, 4, 3), S.met, Math.cos(q * 0.785) * 0.21, 0.15, Math.sin(q * 0.785) * 0.21, S.M);
      t.pop();
      // mast, boom, stays, winch — the whole crane slews on its base
      const cr = mover();
      cr.b.add(G.box(0.18, h, 0.18), S.dark, 0, h / 2, 0);
      for (let q = 1; q < 5; q++) cr.f.add(G.box(0.19, 0.02, 0.19), S.met, 0, (h * q) / 5, 0, S.M);
      cr.m.add(G.box(0.24, 0.06, 0.24), S.met, 0, h, 0, S.M);
      const tip = [0, h + 0.5, sg * (reach - Math.abs(z0) + Math.abs(z0) * 0)];
      tip[2] = sg * (reach - Math.abs(z0));
      cr.b.add(taper([[0, h * 0.4, 0], tip], 0.07, 0.05, 2, 6), S.wood, 0, 0, 0);
      cr.m.add(taper([[0, h * 0.4, 0.04 * sg], [tip[0], tip[1], tip[2] - 0.04 * sg]], 0.03, 0.03, 2, 4), shade(S.wood, 0.8), 0.06, 0, 0);
      cr.m.bar([0, h, 0], tip, 0.012, C.rope).bar([0, h, 0], [0, 0.15, -sg * 0.5], 0.012, C.rope);
      cr.m.add(G.cyl(0.12, 0.12, 0.22, 10), C.iron, 0, h * 0.5, -sg * 0.15, { rx: PI / 2, m: 0.6 });
      cr.f.add(G.cyl(0.13, 0.13, 0.03, 10), S.met, 0, h * 0.5, -sg * 0.27, { ...S.M, rx: PI / 2 }).bar([0, h * 0.5, -sg * 0.29], [0.12, h * 0.45, -sg * 0.32], 0.012, C.iron);
      cr.m.add(G.cyl(0.05, 0.05, 0.06, 8), S.met, tip[0], tip[1], tip[2], { ...S.M, rx: PI / 2 });
      cr.push(0, h + 0.05, 0); finial(cr.m, S, 0.4 * k); cr.pop();
      const cm = moverMesh(c, cr); cm.position.set(at.x, at.y + 0.15, z0);
      // the fall and hook hang from the boom tip on their own
      const hk = new THREE.Group(); hk.position.set(tip[0], tip[1], tip[2]); cm.add(hk);
      const hkK = new DKit(); hkK.bar([0, 0, 0], [0, -0.6, 0], 0.012, C.rope).add(G.cyl(0.05, 0.06, 0.1, 8), S.met, 0, -0.62, 0, S.M).add(G.tor(0.07, 0.02, 3, 8, PI * 1.5), C.iron, 0, -0.74, 0, { m: 0.7 });
      const fall = hkK.mesh(); hk.add(fall);
      const hookAt = new THREE.Group(); hookAt.position.set(0, -0.3, 0); hk.add(hookAt);
      c.addMoving(cm);
      c.hooks.push([at.x + tip[0], at.y + 0.15 + tip[1] - 0.3, z0 + tip[2]]); c.hookObjs.push(hookAt);
      booms.push({ cm, hk, sg, fall });
    }
    c.addMoving(new THREE.Group(), (tt, ph) => { for (const b of booms) { b.hk.rotation.x = Math.sin(tt * 1.2 + ph) * 0.05; b.cm.rotation.y = (b.cm.userData.slew || 0) + Math.sin(tt * 0.2 + ph) * 0.05; } });
    const swing = (kk) => { for (const b of booms) { b.cm.userData.slew = b.sg * bump(kk) * 0.9; b.fall.scale.y = 1 + bump(kk) * 0.8; } };
    act(c, 'launch', swing); act(c, 'board', swing);
    anchor(c, 'launch', c.hooks[0]);
  }),
  anvil: part(1, (c) => {
    const S = sty(c), at = spot(c, 0.5, 0.0, 's'), t = T(c), k = c.k;
    t.push(at.x, at.y, at.z, 0, 0, 0, k);
    // the stump, the horned anvil
    t.b.add(G.cyl(0.25, 0.3, 0.45, 10), C.wood, 0, 0.22, 0, { r: 0.95 });
    for (const y of [0.08, 0.38]) t.m.add(G.tor(0.29 - y * 0.08, 0.015, 3, 12), C.iron, 0, y, 0, { rx: PI / 2, m: 0.6 });
    t.b.add(G.shape('anvil', [[-0.3, 0], [0.18, 0], [0.18, 0.04], [0.35, 0.08], [0.52, 0.1], [0.3, 0.14], [0.2, 0.16], [-0.3, 0.16], [-0.32, 0.12], [-0.2, 0.09], [-0.15, 0.0]], 0.2), C.iron, -0.05, 0.5, 0, { m: 0.75, r: 0.35 });
    t.b.add(G.box(0.18, 0.12, 0.14), C.iron, -0.05, 0.47, 0, { m: 0.7 });
    t.m.add(G.box(0.25, 0.06, 0.08), 0xff6a1a, -0.05, 0.68, 0, { g: 3, rz: 0.05 });
    // hammer and tongs, the quench tub
    t.m.add(G.box(0.12, 0.08, 0.08), C.iron, 0.1, 0.7, 0.2, { m: 0.7 }).bar([0.1, 0.68, 0.2], [0.1, 0.62, 0.55], 0.02, C.wood);
    t.m.bar([-0.3, 0.68, -0.1], [0.05, 0.69, -0.12], 0.012, C.iron).bar([-0.3, 0.68, -0.14], [0.05, 0.69, -0.12], 0.012, C.iron);
    t.push(0.5, 0, -0.1); t.m.add(G.cyl(0.18, 0.16, 0.3, 10, true), S.wood, 0, 0.15, 0).add(G.circle(0.16, 10), 0x2a3a4a, 0, 0.26, 0, { rx: -PI / 2, m: 0.3, r: 0.1 }); t.pop();
    // the forge: hearth, hood and flue, bellows
    t.push(-0.7, 0, 0);
    t.b.add(G.box(0.55, 0.55, 0.5), C.brick, 0, 0.28, 0, { r: 0.95 });
    for (let q = 1; q < 5; q++) t.f.add(G.box(0.555, 0.008, 0.505), 0x5a2a1a, 0, q * 0.11, 0);
    t.m.add(G.box(0.4, 0.05, 0.38), 0x1a1a1a, 0, 0.56, 0).add(G.box(0.3, 0.04, 0.28), C.fire, 0, 0.58, 0, { g: 2.5 });
    for (let q = 0; q < 5; q++) t.f.add(G.dod(0.04), 0x2a1a10, (hash(q) - 0.5) * 0.25, 0.61, (hash(q + 3) - 0.5) * 0.2, { g: 0.3 });
    t.b.add(G.cone(0.38, 0.4, 4), S.metal === 'brass' || S.metal === 'gold' ? C.bronze : C.iron, 0, 0.95, 0, { ry: PI / 4, m: 0.6 });
    t.b.add(G.cyl(0.07, 0.08, 0.9, 8), C.iron, 0, 1.55, 0, { m: 0.6 });
    t.m.add(G.box(0.3, 0.2, 0.05), C.fire, 0.15, 0.3, 0.26, { g: 2.5 });
    t.push(0, 0.3, -0.38); t.m.add(G.box(0.35, 0.05, 0.22), S.wood, 0, 0.15, 0, { rx: 0.25 }).add(G.box(0.35, 0.05, 0.22), S.wood, 0, 0, 0).add(G.custom('anvbel', () => new THREE.CylinderGeometry(0.12, 0.12, 0.12, 8)), 0x5a3a2a, 0, 0.07, 0, { sx: 1.3 }); t.pop();
    t.pop();
    t.pop();
  }),
  cauldron: part(1.4, (c) => {
    const S = sty(c), at = spot(c, 0.6, -0.05, 'c'), t = T(c), r = 0.5 * c.k, k = c.k;
    const goo = /morbus|skar|balor/.test(S.id) ? C.slime : S.id === 'nagavar' ? 0xff3a3a : S.id === 'hearthmoot' ? 0xd8a04a : S.id === 'principalities' ? 0xff8a2a : S.id === 'gorge' ? 0xc89a5a : 0x6aff5a;
    const glowy = !/hearthmoot|gorge/.test(S.id);
    t.push(at.x, at.y, 0);
    // tripod over the fire
    for (let q = 0; q < 3; q++) { const a = (q / 3) * PI * 2 + PI / 6; t.b.add(taper([[Math.cos(a) * r * 1.3, 0, Math.sin(a) * r * 1.3], [0, r * 2.7, 0]], 0.04, 0.03, 2, 5), C.iron, 0, 0, 0, { m: 0.6 }); }
    t.m.add(G.tor(0.06, 0.015, 3, 8), C.iron, 0, r * 2.7, 0, { m: 0.6 }).bar([0, r * 2.65, 0], [0, r * 2.0 + 0.2, 0], 0.012, C.iron);
    // the pot on its feet, with lugs and a bail
    t.b.add(G.lathe('cauldron2', [[0, 0], [0.55, 0.04], [0.88, 0.25], [1, 0.55], [0.95, 0.85], [0.86, 0.96], [0.94, 1.0], [0.96, 1.04], [0.86, 1.04]], 16), C.iron, 0, 0.22, 0, { s: r, m: 0.6, r: 0.5 });
    for (let q = 0; q < 3; q++) { const a = (q / 3) * PI * 2; t.m.add(taper([[Math.cos(a) * r * 0.5, 0.28, Math.sin(a) * r * 0.5], [Math.cos(a) * r * 0.65, 0.12, Math.sin(a) * r * 0.65], [Math.cos(a) * r * 0.7, 0, Math.sin(a) * r * 0.7]], 0.04, 0.05, 4, 5), C.iron, 0, 0, 0, { m: 0.6 }); }
    for (const s of [-1, 1]) t.m.add(G.tor(0.06, 0.018, 3, 8), C.iron, 0, 0.22 + r * 0.95, s * r * 0.97, { m: 0.6, ry: PI / 2 });
    t.m.add(G.tor(r * 0.97, 0.014, 3, 16, PI), C.iron, 0, 0.22 + r * 0.95, 0, { m: 0.6, ry: PI / 2 });
    for (let q = 0; q < 16; q++) { const a = (q / 16) * PI * 2; t.f.add(G.sph(0.018, 4, 3), C.iron, Math.cos(a) * r * 0.99, 0.22 + r * 0.55, Math.sin(a) * r * 0.99, { m: 0.6 }); }
    t.push(r, 0.22 + r * 0.5, 0, 0, PI / 2, 0); relief(t.m, S, r * 0.3, S.met); t.pop();
    // fire beneath: logs and flames
    for (let q = 0; q < 4; q++) t.m.add(G.cyl(0.04, 0.045, r * 1.3, 6), 0x3a2414, 0, 0.05, 0, { rz: PI / 2, ry: q * 0.8 });
    flame(t.m, 0, 0.02, 0, 0.9 * k);
    // ladle and a heap of ingredients
    t.m.add(G.cyl(0.015, 0.015, r * 1.6, 4), S.wood, r * 0.4, 0.22 + r * 1.3, 0, { rz: -0.5 }).add(G.sph(0.07, 6, 4), S.wood, r * 0.08, 0.22 + r * 0.8, 0);
    if (S.id === 'morbus' || S.id === 'nagavar' || S.id === 'gorge') { t.push(-r * 1.3, 0, r * 0.6); skull(t.m, 0.8); t.pop(); }
    else for (let q = 0; q < 4; q++) t.m.add(G.sph(0.06, 6, 4), [0xa0c050, 0xc87a3a, 0xe8d8a0, 0x8a3a5a][q], -r * 1.2 + q * 0.08, 0.06, r * 0.7, { sy: 0.8 });
    t.pop();
    // the brew: a heaving surface with bubbles; it surges on an aura
    const bw = new DKit();
    bw.add(G.circle(r * 0.88, 18), goo, 0, 0, 0, { rx: -PI / 2, g: glowy ? 2 : 0.3, r: 0.2 });
    for (let q = 0; q < 6; q++) bw.add(G.hemi(0.05 + hash(q) * 0.05, 8, 4), blend(goo, 0xffffff, 0.2), (hash(q + 1) - 0.5) * r * 1.2, 0, (hash(q + 4) - 0.5) * r * 1.2, { g: glowy ? 2 : 0.3, r: 0.2 });
    const brew = bw.mesh(); brew.position.set(at.x, at.y + 0.22 + r * 0.92, 0);
    let surge = 0;
    c.addMoving(brew, (tt, ph) => { brew.position.y = at.y + 0.22 + r * (0.92 + surge * 0.14) + Math.sin(tt * 3 + ph) * 0.012; brew.rotation.y = tt * 0.3; brew.scale.set(1 + surge * 0.06, 1 + Math.sin(tt * 7 + ph) * 0.4 + surge * 2, 1 + surge * 0.06); });
    const steam = new THREE.Group();
    for (let q = 0; q < 3; q++) { const o = new THREE.Mesh(G.ico(1, 1), glowy ? glowMat(goo, 0.25) : smoke()); o.userData.q = q; steam.add(o); }
    c.addMoving(steam, (tt, ph) => steam.children.forEach((o) => { const f = (tt * 0.35 + o.userData.q / 3 + ph * 0.1) % 1; o.position.set(at.x + Math.sin(f * 6 + o.userData.q) * 0.1, at.y + 0.3 + r + f * (1.2 + surge), Math.cos(f * 5) * 0.1); o.scale.setScalar(0.1 + f * 0.25 + surge * 0.1); }));
    act(c, 'aura', (kk) => { surge = bump(kk); });
    act(c, 'mortar', (kk) => { surge = kick(kk, 0.2) * 0.8; });
    anchor(c, 'aura', [at.x, at.y + 0.3 + r, 0]);
  }),
  vats: part(1.8, (c) => {
    const S = sty(c), at = c.place(0.75, -0.1, 'c'), t = T(c), goo = S.id === 'skar' ? 0xa0ff3a : S.id === 'morbus' ? C.slime : 0xa0ff3a, k = c.k, surf = [];
    const spots = [[0, 0.32], [-0.62, -0.25], [0.55, -0.35]];
    spots.forEach(([dx, dz], i) => {
      const r = (0.38 - i * 0.04) * k, h = r * 2.1;
      t.push(at.x + dx, at.y, dz);
      t.b.add(G.lathe('vat', [[0, 0], [1, 0], [1.05, 0.5], [1, 1], [0.94, 1]], 14), S.rot ? 0x4a4a38 : C.wood, 0, 0, 0, { sx: r, sz: r, sy: h });
      for (const y of [0.15, 0.5, 0.85]) t.m.add(G.tor(r * (y === 0.5 ? 1.05 : 1.02), 0.03, 3, 16), S.metal === 'rust' ? 0x6a3a22 : C.iron, 0, h * y, 0, { rx: PI / 2, m: 0.6 });
      for (let q = 0; q < 14; q++) { const a = (q / 14) * PI * 2; t.f.add(G.box(0.008, h * 0.96, 0.008), 0x2a1a10, Math.cos(a) * r * 1.03, h / 2, Math.sin(a) * r * 1.03); }
      t.m.add(G.cyl(0.04, 0.04, 0.08, 6), C.bronze, r * 1.02, h * 0.15, 0, { rz: PI / 2, m: 0.7 });
      for (let q = 0; q < 3; q++) t.f.add(tube([[Math.cos(q * 2) * r, h, Math.sin(q * 2) * r], [Math.cos(q * 2) * r * 1.05, h * (0.7 - q * 0.1), Math.sin(q * 2) * r * 1.05]], 0.02, 3, 3), goo, 0, 0, 0, { g: 1.2 });
      t.pop();
      const sk = new DKit(); sk.add(G.circle(r * 0.96, 14), goo, 0, 0, 0, { rx: -PI / 2, g: 1.8, r: 0.2 }); for (let q = 0; q < 3; q++) sk.add(G.hemi(0.04 + hash(q + i) * 0.04, 6, 3), blend(goo, 0xffffff, 0.3), (hash(q * 3 + i) - 0.5) * r, 0, (hash(q * 5 + i) - 0.5) * r, { g: 1.8 });
      const sm = sk.mesh(); sm.position.set(at.x + dx, at.y + h * 0.9, dz); c.addMoving(sm); surf.push({ sm, y: at.y + h * 0.9, i });
    });
    t.m.add(tube([[at.x, at.y + 0.85, 0.32], [at.x + 0.3, at.y + 0.95, 0], [at.x + 0.55, at.y + 0.75, -0.35]], 0.05, 10, 6), C.bronze, 0, 0, 0, { m: 0.7 });
    t.m.add(tube([[at.x, at.y + 0.85, 0.32], [at.x - 0.3, at.y + 0.95, 0], [at.x - 0.62, at.y + 0.72, -0.25]], 0.05, 10, 6), C.bronze, 0, 0, 0, { m: 0.7 });
    t.push(at.x - 0.25, at.y, 0.45); for (let q = 0; q < 2; q++) t.m.add(G.cyl(0.02, 0.02, 1.0, 4), S.wood, 0, 0.5, q ? 0.15 : -0.15, { rx: q ? 0.1 : -0.1 }); for (let q = 0; q < 5; q++) t.m.add(G.cyl(0.015, 0.015, 0.3, 4), S.wood, 0, 0.15 + q * 0.18, 0, { rx: PI / 2 }); t.pop();
    let surge = 0;
    c.addMoving(new THREE.Group(), (tt, ph) => { for (const s of surf) { s.sm.position.y = s.y + Math.sin(tt * 2 + s.i + ph) * 0.015 + surge * 0.05; s.sm.rotation.y = tt * 0.2 * (s.i + 1); } });
    act(c, 'aura', (kk) => { surge = bump(kk); });
    act(c, 'mortar', (kk) => { surge = kick(kk, 0.2); });
  }),
};

// ====================================================================================================
// every part: its own still mesh (finished near, the drawn shapes far), damage states and loose pieces
// ====================================================================================================
// how a part goes when she is badly hurt: tall work topples, machines and stores are smashed, the rest burns
const TOPPLE = new Set(['pagoda', 'tower', 'temple', 'obelisk', 'monolith', 'tree', 'deadTree', 'portal', 'dome', 'shrine', 'pulpit', 'totem', 'chimneys', 'organPipes', 'mirrors', 'cranes', 'astrolabe', 'bells', 'crystalRing', 'lens', 'yurt', 'stones']);
const CHAR_ONLY = new Set(['pyramid', 'ziggurat', 'flightDeck', 'pad', 'perches', 'banners', 'shields', 'spikes', 'plates', 'chains', 'skulls', 'gargoyles', 'pustules', 'vines', 'braziers', 'lanterns', 'nest', 'corpses', 'bones', 'skullPile', 'sarcophagus']);
const GUNS = new Set(['turrets', 'ballista', 'repeater', 'harpoonGun', 'winch', 'trebuchet', 'catapult', 'mortarPit', 'bombard', 'rocketRack', 'crystalRing', 'lens', 'organPipes', 'mirrors', 'pumpCannon', 'cranes']);
const KIND = (name, size) => (GUNS.has(name) ? 'gun' : name === 'tree' || name === 'deadTree' ? 'tree' : size >= 2 ? 'house' : size === 0 ? 'plate' : 'crate');
let CUR = null;
hooks.key = () => (CUR ? `${CUR.key}|m${CUR.n++}` : null);
hooks.model = () => CUR?.c.m ?? null;
useUnits({ UNITS, prepareDef: (d) => ({ size: 1, ...d }), buildUnitModel, animateUnit });

function runPart(name, P, c) {
  const key = `dk|${c.def.id}|${c.side}|${name}`;
  const was = c.__tri, K = new Kit(), g0 = c.group.children.length, prev = CUR;
  c.__tri = new Tri(K); CUR = { c, name, key, n: 0 };
  try { P.fn(c); } finally { c.__tri = was; CUR = prev; }
  const movers = c.group.children.slice(g0).filter((o) => !(o.isGroup && !o.children.length));
  let mesh = null;
  const deckAt = (x, z) => c.deckAt(x, z);
  let kit = K;
  if (!K.empty) {
    const e = entryOf(key, K, (fin) => groundShade(fin, deckAt));
    kit = e.kit;
    mesh = entryMesh(e, c.m); mesh.name = `deck:${name}`;
    c.addMoving(mesh);
  }
  if (globalThis.__deckStat) globalThis.__deckStat(name, mesh, movers);
  const box = new THREE.Box3();
  if (mesh) { const g = mesh.userData.lodGeos.find((x) => x.attributes.position?.count); if (g) { if (!g.boundingBox) g.computeBoundingBox(); box.copy(g.boundingBox); } }
  for (const o of movers) box.expandByObject(o);
  const at = box.isEmpty() ? [0, c.dy, 0] : [(box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2];
  attachDamage({ model: c.m, mesh, kit, key, movers, deckAt, at, wreck: TOPPLE.has(name) ? 'topple' : CHAR_ONLY.has(name) ? 'char' : 'smash', kind: KIND(name, P.size), moverKind: GUNS.has(name) ? 'gun' : 'spar' });
}

export const DECK_PARTS = Object.fromEntries(Object.entries(RAW).map(([name, P]) => [name, { size: P.size, fn: (c) => runPart(name, P, c) }]));
