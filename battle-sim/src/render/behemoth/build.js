// The behemoth builder's context and tools: palette and surface patterns from the design and the realm's style, a
// placer that turns repeated pieces into instanced meshes, the LOD table, the animated materials (flowing water, mist,
// light and fire; waving banners) and the structure kit every form is assembled from (towers, halls, walls, domes,
// spires, rocks, envelopes, waterfalls, mist, vortices, chains, rigging, banners).
import * as THREE from 'three';
import { sculptMaterial } from '../sculpt.js';
import { styleOf } from '../sky/style.js';
import { envelopeGeo } from '../sky/skin.js';
import { airFaction } from '../../data/realms.js';
import {
  PI, TAU, EMPTY, LV, levels, cutAfter, lin, mixc, mulc, toHex, clamp, lerp, h1, fract,
  prismGeo, rockGeo, rockRim, ringGeo, tubeGeo, tubesGeo, bannerGeo, flowSheet, flowShell, cap, band, eave, wall,
} from './surf.js';
import * as PC from './pieces.js';

export { PI, TAU, EMPTY, lin, clamp, lerp, h1 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export const hexMix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
export const hexShade = (a, k) => new THREE.Color(a).multiplyScalar(k).getHex();
const lum = (hex) => { const c = new THREE.Color(hex); return 0.3 * c.r + 0.55 * c.g + 0.15 * c.b; };
function hashKey(o) { const s = JSON.stringify(o); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length; }

const FAC = new Map();
const facOf = (id) => { if (!FAC.has(id)) { let f = null; try { f = airFaction(id); } catch { f = null; } FAC.set(id, f); } return FAC.get(id); };

// ---------------------------------------------------------------------------------------------
// the context
// ---------------------------------------------------------------------------------------------
export function context(def, D, sideColor) {
  const fid = def.faction || (def.id || '').replace(/Behemoth$/, '');
  const S = styleOf({ faction: fid, id: def.id });
  const f = facOf(fid), P = (f && f.P) || {};
  const look = D.look || {};
  const note = `${D.note || ''} ${D.name || ''}`.toLowerCase();
  const kw = (...w) => w.some((x) => note.includes(x));
  const hull = look.hull ?? def.color ?? 0x6a5a48, trim = look.trim ?? def.trim ?? S.metal, glow = look.glow ?? def.glow ?? 0xffc870;
  const env = look.envelope ?? def.envelope ?? P.cloth ?? 0xc8b890;
  const parts = new Map();
  for (const p of D.parts || []) { const [n, c] = String(p).split(':'); parts.set(n.trim(), c ? Math.max(1, +c || 1) : 0); }
  const L = def.len || 26;
  const root = new THREE.Group(); root.name = `behemoth:${fid}`;
  const I = new THREE.Group(); root.add(I);
  const paint = sculptMaterial().clone(); paint.color.set(0xffffff);
  const X = {
    def, D, fid, S, P, L, root, I, note, kw, form: D.form || 'airship',
    seed: Math.floor(h1(fid.length * 977 + fid.charCodeAt(0) * 31 + (fid.charCodeAt(1) || 0)) * 1000) + 1,
    parts, has: (n) => parts.has(n), n: (n, d = 1) => (parts.has(n) ? parts.get(n) || d : 0), used: new Set(),
    mats: { paint }, U: { uT: { value: 0 } }, lod: [], inst: new Map(), skins: [],
    anim: { spin: [], sway: [], bob: [], glows: [], flicker: [], wave: [], beasts: [], slide: [], subs: [] },
    anchors: {}, sets: {}, actions: {}, breakParts: [], fires: [], dmgShow: [[], [], [], []], dmgHide: [[], [], [], []],
    muzzles: [], pods: [], crewSlots: [], pads: [], rim: [], ab: new Map(), fx: {},
  };
  for (const a of D.abilities || []) if (a && a.kind && !X.ab.has(a.kind)) X.ab.set(a.kind, a);
  X.pal = palette(X, { hull, trim, glow, env, side: sideColor });
  X.pat = patterns(X);
  X.sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.8, side: THREE.DoubleSide });
  return X;
}
function palette(X, c) {
  const { S, P, kw } = X;
  const dark = lum(c.hull) < 0.12;
  // stone: the hull colour for built forms (it is the design's main surface)
  let stone = c.hull, stone2 = hexMix(c.hull, dark ? 0x3a3440 : 0x8a7a68, 0.35);
  const wood = S.wood ?? 0x6b4a2e;
  return {
    ...c, stone, stone2, wood, metal: S.metal ?? c.trim, accent: S.accent ?? 0xe8e0d0,
    cloth: P.cloth ?? c.env, cloth2: P.cloth2 ?? c.trim, bone: kw('bone', 'skull') ? 0xd8cfb4 : 0xd8cfb4,
    leaf: kw('rot', 'plague', 'slime') ? 0x5a6a2a : kw('jade', 'jungle') ? 0x2a6a2a : 0x3f6a26, leaf2: kw('rot') ? 0x6a5a2a : 0x557a2e,
    bark: kw('iron-oak') ? 0x3a3430 : 0x4a3626, grass: kw('ice', 'glacier', 'iceberg') ? 0xdde8f0 : kw('sand', 'desert') ? 0xc8a868 : kw('rot', 'plague', 'necro', 'barrow', 'grave') ? 0x4a4a2a : 0x4f7a2c,
    rock: kw('obsidian', 'black glass', 'black rock') ? 0x18161c : kw('basalt') ? 0x2a2a2e : kw('ice', 'iceberg', 'glacier') ? 0xb8d8ec : kw('sandstone', 'desert') ? 0xb89a6a : kw('coral') ? 0xd89aa0 : kw('black') ? 0x2a2626 : 0x6a6258,
    roofCol: roofColour(X, c), dark,
  };
}
function roofColour(X, c) {
  const { S, kw } = X;
  if (kw('gilded', 'golden', 'gold-capped') && !kw('golden light')) return c.trim;
  if (S.roof === 'pagoda') return X.fid === 'shogunate' ? 0x2a2a30 : hexShade(S.metal, 0.8);
  if (kw('violet')) return 0x6a2a9a;
  if (kw('black', 'obsidian', 'dark')) return 0x24222a;
  if (S.metalKind === 'copper' || kw('copper')) return 0x3a8a6a;
  return hexMix(c.hull, 0x5a2a20, 0.5);
}
/** the surface patterns this behemoth is built of (P objects for surf.pattern) */
function patterns(X) {
  const { pal, kw, S, seed } = X;
  const fid = X.fid;
  const P = (pat, col, col2, o = {}) => ({ pat, col: lin(col), col2: lin(col2 ?? hexShade(col, 0.78)), seed, ...o });
  let wallPat = 'ashlar';
  const W = {
    marble: ['aethel', 'velvet', 'caliphate', 'goldsands', 'sunkings', 'principalities'],
    brick: ['westmark'], plank: ['skar', 'goblin', 'greenhide', 'gorge', 'cloven'], plate: ['grom', 'ironbound', 'malvash', 'screaming'],
    obsidian: ['kaelneth', 'infernal', 'crimson'], sand: ['khemet', 'xibalba', 'emerald', 'ashur'], lacquer: ['tianlong', 'nagavar', 'shogunate'],
    felt: ['khanate', 'kurgan'], plaster: ['hearthmoot'], crystal: ['labyrinth'], ice: ['fimbul'], bone: ['drowned'], coral: ['pearlfleet'],
  };
  for (const [k, list] of Object.entries(W)) if (list.includes(fid)) wallPat = k;
  if (kw('brick')) wallPat = 'brick'; if (kw('black glass')) wallPat = 'obsidian'; if (kw('planks')) wallPat = 'plank';
  if (fid === 'ashur') wallPat = 'ashlar';
  const wallCol = pal.stone;
  const glowL = lin(pal.glow);
  const win = { sp: 1.3, dy: 2.4, w: 0.42, h: 0.95, y0: 1.0, glow: mixc(glowL, [1, 0.75, 0.35], 0.5), lit: 0.6 };
  const roofPat = S.roof === 'canopy' || kw('thatch') ? 'thatch' : (kw('gilded', 'golden', 'gold') && S.metalKind === 'gilt') ? 'tile' : 'tile';
  const metalPat = { gilt: 'gold', brass: 'brass', bronze: 'bronze', copper: 'copper', iron: 'plate', silver: 'silver', bone: 'bone', jade: 'jade', obsidian: 'obsidian', crystal: 'crystal', wood: 'vplank' }[S.metalKind] || 'brass';
  return {
    wall: P(wallPat, wallCol, pal.stone2, { win, rust: 0.4 }),
    wallPlain: P(wallPat, wallCol, pal.stone2, { rust: 0.4 }),
    roof: P(roofPat, pal.roofCol, hexShade(pal.roofCol, 0.7), { moss: kw('rot', 'moss', 'ancient') ? 0.7 : 0.2 }),
    trim: P(metalPat, pal.trim, hexShade(pal.trim, 0.7)),
    gold: P('gold', pal.trim, pal.trim),
    stone: P('ashlar', pal.rock, hexShade(pal.rock, 0.75)),
    floor: P(wallPat === 'plank' ? 'plank' : 'ashlar', hexMix(wallCol, 0x8a7a68, 0.3), hexShade(wallCol, 0.7)),
    wood: P('plank', pal.wood, hexShade(pal.wood, 0.75)),
    plate: P('plate', hexMix(pal.hull, 0x3a3a40, 0.3), hexShade(pal.hull, 0.7), { rust: 0.5 }),
    glass: P('glass', pal.glow, pal.glow, { glass: [lin(pal.glow), lin(hexMix(pal.glow, 0x2040c0, 0.6)), lin(hexMix(pal.glow, 0xc02020, 0.6)), lin(0xe8c040)] }),
    glowP: P('flat', pal.glow, pal.glow, { gl: 1.4, ro: 0.3 }),
    felt: P('felt', pal.cloth, hexShade(pal.cloth, 0.8)),
    hide: P('hide', hexMix(pal.env, 0x8a6a4a, 0.4), hexShade(pal.env, 0.7)),
  };
}

// ---------------------------------------------------------------------------------------------
// placing meshes
// ---------------------------------------------------------------------------------------------
const mtx = (pos = [0, 0, 0], rot = [0, 0, 0], s = 1) => {
  _e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, 'YXZ'); _q.setFromEuler(_e);
  if (Array.isArray(s)) _s.set(s[0], s[1], s[2]); else _s.set(s, s, s);
  return new THREE.Matrix4().compose(_p.set(pos[0], pos[1], pos[2]), _q, _s);
};
export { mtx };
/** a mesh of its own (it moves, breaks or changes with damage) drawn with geos (six levels); returns the mesh */
export function piece(X, geos, parent, pos, rot, s = 1, mat = null) {
  if (!geos) return null;
  const m = new THREE.Mesh(EMPTY, mat || X.mats.paint);
  m.matrixAutoUpdate = true;
  mtx(pos, rot, s).decompose(m.position, m.quaternion, m.scale);
  m.castShadow = !(mat && mat.transparent); m.receiveShadow = true; m.userData.noCrew = true;
  (parent || X.I).add(m);
  lodEntry(X, m, geos);
  return m;
}
/** a static placement: pieces with the same geometry under the same parent become one instanced mesh */
export function place(X, geos, pos, rot, s = 1, parent = null) {
  if (!geos) return;
  const p = parent || X.I, key = geos;
  let e = X.inst.get(key);
  if (!e) { e = new Map(); X.inst.set(key, e); }
  if (!e.has(p)) e.set(p, []);
  e.get(p).push(mtx(pos, rot, s));
}
function lodEntry(X, m, geos) {
  const ent = { mesh: m, geos };
  X.lod.push(ent);
  m.userData.lodEntry = ent;
  let l0 = 2; while (l0 > 0 && geos[l0] === EMPTY) l0--;
  m.geometry = geos[l0];
  if (m.geometry === EMPTY) m.visible = false;
  m.onBeforeRender = () => {
    m.onBeforeRender = () => {};
    const lv = X.root.userData.lod ? X.root.userData.lod.level : 0;
    const g = ent.geos[lv]; if (g !== m.geometry) { m.geometry = g; m.visible = g !== EMPTY; }
  };
  return ent;
}
/** build the instanced meshes (call once, after everything is placed) */
export function flushInstances(X) {
  for (const [geos, byParent] of X.inst) for (const [p, list] of byParent) {
    if (list.length === 1) { const m = new THREE.Mesh(EMPTY, X.mats.paint); list[0].decompose(m.position, m.quaternion, m.scale); m.castShadow = true; m.receiveShadow = true; m.userData.noCrew = true; p.add(m); lodEntry(X, m, geos); continue; }
    let l0 = 2; while (l0 > 0 && geos[l0] === EMPTY) l0--;
    const m = new THREE.InstancedMesh(geos[l0], X.mats.paint, list.length);
    list.forEach((M, i) => m.setMatrixAt(i, M));
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = true; m.receiveShadow = true; m.userData.noCrew = true;
    m.computeBoundingSphere(); m.computeBoundingBox();
    p.add(m);
    lodEntry(X, m, geos);
    m.userData.count = list.length;
  }
  X.inst.clear();
}

// ---------------------------------------------------------------------------------------------
// animated materials
// ---------------------------------------------------------------------------------------------
const FLOW_GLSL = {
  water: 'float fl = vFlow.x * 2.2 - uT * 3.2; float st = 0.5 + 0.5 * sin(fl + sin(vFlow.y * 19.0) * 1.6) * (0.6 + 0.4 * sin(fl * 0.43 + vFlow.y * 11.0)); float a = (0.35 + 0.65 * st) * smoothstep(0.0, 0.22, vFlow.y) * smoothstep(1.0, 0.78, vFlow.y) * smoothstep(1.0, 0.55, vFlow.z); diffuseColor.rgb *= 0.8 + 0.45 * st; diffuseColor.a *= a;',
  mist: 'float fl = vFlow.x * 0.35 - uT * 0.25; float st = 0.5 + 0.25 * sin(fl * 2.0 + vFlow.y * 5.0) + 0.25 * sin(fl * 3.7 - vFlow.y * 7.0 + uT * 0.3); float a = st * sin(3.14159 * vFlow.y); diffuseColor.a *= a * a;',
  light: 'float fl = vFlow.x * 1.4 + uT * 0.6; float st = 0.6 + 0.4 * sin(fl) * sin(fl * 0.31 + 1.7); float a = st * smoothstep(1.0, 0.1, vFlow.y) * smoothstep(0.0, 0.08, vFlow.y); diffuseColor.a *= a;',
  fire: 'float fl = vFlow.y * 6.0 - uT * 5.0; float st = 0.5 + 0.5 * sin(fl + sin(vFlow.x * 3.0 + uT) * 2.0) * sin(vFlow.x * 1.7 - uT * 1.3); float a = st * smoothstep(1.0, 0.3, vFlow.y) * smoothstep(0.0, 0.1, vFlow.y); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.9, 0.5), st * (1.0 - vFlow.y) * 0.6); diffuseColor.a *= a;',
  vortex: 'float fl = vFlow.x * 0.9 - uT * 4.0 + vFlow.y * 6.0; float st = 0.5 + 0.5 * sin(fl) * sin(fl * 0.27 + vFlow.y * 4.0); float a = st * sin(3.14159 * vFlow.y); diffuseColor.rgb *= 0.75 + 0.5 * st; diffuseColor.a *= a;',
};
export function flowMat(X, kind, color, opacity = 0.7, additive = false) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = X.U.uT;
    sh.vertexShader = 'attribute vec3 aFlow;\nvarying vec3 vFlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlow = aFlow;');
    sh.fragmentShader = 'uniform float uT;\nvarying vec3 vFlow;\n' + sh.fragmentShader.replace('#include <alphamap_fragment>', `#include <alphamap_fragment>\n{ ${FLOW_GLSL[kind]} }`);
  };
  m.customProgramCacheKey = () => `bhflow-${kind}`;
  m.userData.keep = true; m.userData.op0 = opacity;
  (X.flowMats ||= []).push(m);
  return m;
}
/** the waving cloth material (banners): sculpt shading, side colour, a travelling wave toward the fly */
export function waveMat(X, color) {
  const m = sculptMaterial().clone();
  m.color.set(color);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.uT = X.U.uT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aWave;\nuniform float uT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += aWave * (0.22 * sin(position.x * 2.6 - uT * 5.0 + position.y * 0.8) + 0.08 * sin(position.x * 6.1 - uT * 8.3));\ntransformed.y += aWave * 0.05 * sin(position.x * 3.0 - uT * 4.0);');
  };
  m.customProgramCacheKey = () => 'sculpt-pbr-wave';
  return m;
}
/** a self-lit material that can flicker and flare (actions boost it) */
export function glowMat(X, color, k = 1.4, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.5, ...o });
  m.userData.glowBase = k; m.userData.boost = 0;
  X.anim.glows.push({ m, k: o.flick ?? 0.12, ph: X.anim.glows.length * 1.7 });
  return m;
}

// ---------------------------------------------------------------------------------------------
// the structure kit
// ---------------------------------------------------------------------------------------------
const roofShape = (S) => ({ pagoda: 'pagoda', dome: 'dome', onion: 'onion', tent: 'cone', gable: 'hip', flat: 'flat', spire: 'spire', ziggurat: 'stepped', canopy: 'dome', stepped: 'stepped' }[S.roof] || 'hip');
/** the profile of a building: walls to h, a cornice, and a roof of the given shape */
export function buildingProf(o) {
  const h = o.h, rs = o.roof, rh = o.rh ?? (rs === 'spire' ? o.w * 1.8 : rs === 'cone' ? o.w * 0.7 : rs === 'onion' ? o.w * 1.1 : rs === 'dome' ? o.w * 0.5 : rs === 'pagoda' ? o.w * 0.45 : o.w * 0.4);
  const out = [[o.foot ?? 1.06, 0, o.y0 ?? -0.3, 'wallPlain'], [1, 0, 0.15, 'wallPlain'], [o.taper ? 1 : 1, 0, 0.16, 'wall'], [o.taper ?? 1, 0, h * 0.62, 'wall'], ...band(o.taper ?? 1, h * 0.62, 0.06, 0.1, 'trim').slice(1), [o.taper ?? 1, 0, h, 'wall']];
  const k = o.taper ?? 1;
  if (rs === 'flat') out.push(...band(k, h, 0.12, 0.18, 'trim').slice(1), [k, 0.12, h + 0.55, 'wallPlain'], [k * 0.9, 0, h + 0.55, 'wallPlain'], [k * 0.9, 0, h + 0.3, 'wallPlain'], [0, 0, h + 0.3, 'floor']);
  else if (rs === 'hip' || rs === 'pagoda') { out.push(...eave(k, h, rs === 'pagoda' ? 0.7 : 0.35, 'roof')); out.push(...cap(k, h + 0.06, rh, rs === 'pagoda' ? 'pagoda' : 'cone', 'roof', { eave: rs === 'pagoda' })); }
  else if (rs === 'stepped') { let y = h, kk = k; out.push(...band(k, h, 0.1, 0.14, 'trim').slice(1)); for (let i = 0; i < 3; i++) { kk *= 0.78; out.push([kk, 0, y + 0.14, 'roof'], [kk, 0, y + 0.6, 'wallPlain']); y += 0.6; } out.push([0, 0, y, 'floor']); }
  else if (rs === 'spire') { out.push(...band(k, h, 0.1, 0.18, 'trim').slice(1)); out.push([k * 0.98, 0, h + 0.18, 'roof'], [0, 0, h + 0.18 + rh, 'roof']); }
  else { out.push(...band(k, h, 0.1, 0.18, 'trim').slice(1)); out.push(...cap(k, h + 0.18, rh, rs === 'cone' ? 'cone' : rs, rs === 'onion' || rs === 'dome' ? 'dome' : 'roof')); }
  return { prof: out, top: h + (rs === 'flat' ? 0.3 : rs === 'stepped' ? 1.8 : rh + 0.18) };
}
/** a building: plan circle | rect | poly, w x d, walls to h, roof (shape name or the realm's), windows; returns { mesh, top, geos } */
export function building(X, at, o) {
  const rs = o.roof || roofShape(X.S);
  const w = o.w, d = o.d ?? o.w;
  const { prof, top } = buildingProf({ ...o, w: Math.min(w, d), roof: rs });
  const mats = { wall: o.wallP || X.pat.wall, wallPlain: o.wallPlainP || X.pat.wallPlain, roof: o.roofP || (rs === 'dome' || rs === 'onion' ? X.pat.domeP || X.pat.gold : X.pat.roof), dome: o.domeP || X.pat.domeP || X.pat.gold, trim: X.pat.trim, floor: X.pat.floor };
  if (o.win === false) mats.wall = mats.wallPlain;
  const spec = { plan: o.plan || 'rect', w, d, n: o.n, corner: o.corner ?? (o.plan === 'rect' || !o.plan ? 0.08 : 0.06), prof, mats, upturn: rs === 'pagoda' ? (o.upturn ?? Math.min(w, d) * 0.12) : 0, dens: o.dens ?? 9, seed: X.seed + (o.seed || 0), ridge: o.plan !== 'circle' };
  const key = hashKey({ s: spec, f: X.fid });
  const geos = prismGeo(key, spec, 0);
  let mesh = null;
  if (o.solo || o.breakable) {
    mesh = piece(X, geos, o.parent, at, [0, o.ry || 0, 0], 1);
    if (o.breakable) {
      const ent = mesh.userData.lodEntry;
      X.skins.push({ ent, make: (lv) => (lv >= 2 && (o.breakAt ?? 2) <= lv ? prismGeo(key, { ...spec, broken: lv >= 3 ? 0.35 : 0.6 }, lv) : prismGeo(key, spec, lv)) });
      X.breakParts.push({ mesh, at: [at[0], at[1] + top * 0.7, at[2]], kind: 'tower' });
    }
  } else place(X, geos, at, [0, o.ry || 0, 0], 1, o.parent);
  // a finial on a pointed top
  if (o.finial !== false && (rs === 'spire' || rs === 'cone' || rs === 'onion' || rs === 'dome' || rs === 'pagoda')) finialAt(X, [at[0], at[1] + top - 0.05, at[2]], Math.max(0.6, Math.min(w, d) * 0.35), o.parent);
  return { mesh, top: at[1] + top, geos, key, spec };
}
/** the realm's finial: a gilt ornament on a spike */
export function finialAt(X, p, s = 1, parent = null) {
  const kind = X.S.finial || 'orb';
  const geos = PC.sculpt(`finial|${kind}|${X.pal.trim}`, () => {
    const { S: SS } = PCS;
    const B = new PCS.SB(), M = (q) => q.color(X.pal.trim).pbr(0.3, 0.9).blend(0.02);
    B.p(M(SS.cone(0.06, 0.02, 0.9)).at(0, 0.45, 0));
    if (kind === 'cross') { B.p(M(SS.box(0.06, 0.5, 0.06, 0.01)).at(0, 1.1, 0)); B.p(M(SS.box(0.32, 0.06, 0.06, 0.01)).at(0, 1.2, 0)); }
    else if (kind === 'crescent') { B.p(M(SS.torus(0.2, 0.04)).rot(90, 0, 0).at(0, 1.15, 0)); B.p(SS.sphere(0.17).at(0.1, 1.2, 0).cut(0.005)); }
    else if (kind === 'star') for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; B.p(M(SS.cone(0.05, 0, 0.3)).rot(0, 0, (a * 180) / Math.PI).at(Math.sin(a) * -0.12, 1.1 + Math.cos(a) * 0.12, 0)); }
    else if (kind === 'spike' || kind === 'blade' || kind === 'horn' || kind === 'spire') B.p(M(SS.cone(0.07, 0, 0.7)).at(0, 1.1, 0));
    else if (kind === 'onion') { B.p(M(SS.sphere(0.15)).at(0, 1.0, 0)); B.p(M(SS.cone(0.08, 0, 0.3)).at(0, 1.25, 0)); }
    else if (kind === 'lotus' || kind === 'flame') for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; B.p(M(SS.ellipsoid(0.05, 0.16, 0.08)).rot(0, -a * 57.3, 20).at(Math.cos(a) * 0.08, 1.05, Math.sin(a) * 0.08)); }
    else if (kind === 'trident') { B.p(M(SS.cone(0.05, 0, 0.4)).at(0, 1.15, 0)); for (const s of [-1, 1]) B.p(M(SS.capsule([0, 0.9, 0], [s * 0.15, 1.25, 0], 0.03))); }
    else if (kind === 'crystal') B.h(PCS.H.cone(0.12, 0.5, 6).at(0, 1.15, 0).color(X.pal.glow).glow(0.8));
    else { B.p(M(SS.sphere(0.14)).at(0, 1.0, 0)); B.p(M(SS.cone(0.04, 0, 0.25)).at(0, 1.22, 0)); }
    return B.part();
  }, 40);
  place(X, cutAfter(geos, 3), p, [0, 0, 0], s, parent);
}
import * as PCS from '../parts/kit.js';

/** a run of crenellations (merlons) from a to b along a wall top at height y */
export function merlons(X, a, b, y, size = 0.42, parent = null) {
  const geos = cutAfter(prismGeo(`merlon|${X.fid}|${size}`, { plan: 'rect', w: size, d: size * 0.6, corner: 0.03, prof: [[1, 0, -0.1, 'wallPlain'], [1, 0, size * 0.9, 'wallPlain'], [0.8, 0, size, 'wallPlain'], [0, 0, size, 'wallPlain']], mats: { wallPlain: X.pat.wallPlain }, dens: 14, seed: 3 }, 0), 3);
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz), n = Math.max(1, Math.floor(len / (size * 2))), ry = -Math.atan2(dz, dx);
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; place(X, geos, [a[0] + dx * t, y, a[2] + dz * t], [0, ry, 0], 1, parent); }
}
/** a curtain wall from a to b (thickness th, height h), merlons along it; returns its top y */
export function wallRun(X, a, b, h, th = 0.9, o = {}) {
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz), ry = -Math.atan2(dz, dx);
  const L = Math.max(0.5, Math.round(len * 4) / 4);
  const spec = { plan: 'rect', w: L, d: th, corner: 0.05, prof: [[1.04, 0, (o.y0 ?? -0.6) - a[1] + 0, 'wallPlain'], [1, 0, h * 0.85, 'wallPlain'], ...band(1, h * 0.85, 0.08, 0.14, 'trim').slice(1), [1, 0, h, 'wallPlain'], [0, 0, h, 'floor']], mats: { wallPlain: o.P || X.pat.wallPlain, trim: X.pat.trim, floor: X.pat.floor }, dens: 8, seed: X.seed };
  const geos = prismGeo(hashKey({ spec, f: X.fid }), spec, 0);
  const mid = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]), (a[2] + b[2]) / 2];
  place(X, geos, mid, [0, ry, 0], 1, o.parent);
  if (o.cren !== false) for (const s of [-1, 1]) { const nx = Math.sin(ry) * th * 0.4 * s, nz = Math.cos(ry) * th * 0.4 * s; merlons(X, [a[0] + nx, 0, a[2] + nz], [b[0] + nx, 0, b[2] + nz], mid[1] + h, 0.42, o.parent); }
  // walk along the top
  for (let t = 0.1; t < 0.95; t += 1.2 / len) X.crewSlots.push([mid[0] + (t - 0.5) * dx, mid[1] + h + 0.01, mid[2] + (t - 0.5) * dz]);
  return mid[1] + h;
}

/** a floating rock under the deck; sets X.yAt, X.rim, X.underY, X.pads from it */
export function rockBase(X, o) {
  const rimF = rockRim(o);
  const spec = { ...o, seed: o.seed ?? X.seed };
  const key = hashKey({ spec: { ...spec, top: String(o.top) }, f: X.fid, n: X.note.length });
  const ent = piece(X, rockGeo(key, spec, 0), o.parent || X.I, o.at || [0, 0, 0], [0, 0, 0], 1).userData.lodEntry;
  X.skins.push({ ent, make: (lv) => rockGeo(key, spec, lv) });
  X.rock = { ...o, rimF };
  const off = o.at || [0, 0, 0];
  X.yAt = (x, z) => (o.top ? o.top(x - off[0], z - off[2]) : 0) + off[1];
  X.underY = (x, z) => {
    const ax = x - off[0], az = z - off[2], a = Math.atan2(az, ax), [ex, ez] = rimF(a), rho = clamp(Math.hypot(ax, az) / (Math.hypot(ex, ez) || 1), 0, 1);
    const w = 1 - Math.pow(rho, 1 / (o.pow ?? 0.75));
    return off[1] + X.yAt(x, z) - off[1] - 0.35 - o.depth * Math.pow(w, o.ypow ?? 1.15) * 0.9;
  };
  X.rim = [];
  for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU, [ex, ez] = rimF(a), l = Math.hypot(ex, ez); X.rim.push([off[0] + ex * 0.97, X.yAt(off[0] + ex * 0.9, off[2] + ez * 0.9), off[2] + ez * 0.97, ex / l, ez / l, a]); }
  X.extent = [o.rx, o.rz];
  return X.rim;
}
/** free spots on the deck for features: a grid inside the rim (k of the radius), flat enough to stand on */
export function padsFrom(X, k = 0.78, step = 1.6, flat = 0.6) {
  const [rx, rz] = X.extent, off = X.rock?.at || [0, 0, 0];
  for (let x = -rx; x <= rx; x += step) for (let z = -rz; z <= rz; z += step) {
    if ((x / rx) ** 2 + (z / rz) ** 2 > k * k) continue;
    const px = off[0] + x + (h1(x * 13 + z * 7 + X.seed) - 0.5) * step * 0.4, pz = off[2] + z + (h1(x * 5 - z * 11 + X.seed) - 0.5) * step * 0.4;
    const y = X.yAt(px, pz), sl = Math.abs(X.yAt(px + 0.6, pz) - X.yAt(px - 0.6, pz)) + Math.abs(X.yAt(px, pz + 0.6) - X.yAt(px, pz - 0.6));
    if (sl < flat * 1.2) X.pads.push({ x: px, z: pz, y, r: step / 2, used: false });
  }
}
/** claim a free spot with clearance r; pref: 'edge' | 'centre' | 'bow' | 'stern' | 'port' | 'starboard' | fn(pad) -> score */
export function take(X, r = 1, pref = null) {
  let best = null, bs = -1e9;
  const [rx, rz] = X.extent || [X.L / 2, X.L / 3];
  for (const p of X.pads) {
    if (p.used) continue;
    if (X.pads.some((q) => q.used && Math.hypot(q.x - p.x, q.z - p.z) < r + q.cr)) continue;
    const e = Math.hypot(p.x / rx, p.z / rz);
    let s = h1(p.x * 3.1 + p.z * 7.7 + X.seed + X.pads.length) * 0.3;
    if (pref === 'edge') s += e; else if (pref === 'centre') s -= e; else if (pref === 'bow') s += p.x / rx; else if (pref === 'stern') s -= p.x / rx;
    else if (pref === 'port') s -= p.z / rz; else if (pref === 'starboard') s += p.z / rz; else if (typeof pref === 'function') s += pref(p);
    if (s > bs) { bs = s; best = p; }
  }
  if (!best) return null;
  best.used = true; best.cr = r;
  return [best.x, best.y, best.z];
}
/** reserve a circle on the deck (a building stands there) */
export function reserve(X, x, z, r) { X.pads.push({ x, z, y: 0, r, used: true, cr: r }); }

/** an envelope (gas bag) along +x at (x, cy, z): length Le, radius R; o: { round (a balloon), ribs, spikes, patches } */
export function envelope(X, at, Le, R, o = {}) {
  const g = new THREE.Group(); g.position.set(...at); X.I.add(g);
  const round = !!o.round;
  const prof = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    if (round) { const a = t * PI; prof.push([Math.max(0.02, Math.sin(a) * R * (1 + 0.08 * Math.sin(a * 2))), -Math.cos(a) * R * 1.05]); }
    else { const y = -Le / 2 + t * Le, k = t < 0.35 ? Math.sin((t / 0.35) * PI / 2) ** 0.7 : Math.cos(((t - 0.35) / 0.65) * PI / 2) ** 0.55; prof.push([Math.max(0.03, R * k), y]); }
  }
  const colA = o.col ?? X.pal.env, colB = o.col2 ?? hexMix(colA, 0xffffff, 0.12);
  const key = `bh|${X.fid}|${q(Le)}|${q(R)}|${round}|${colA}`;
  const eo = { gores: round ? 16 : 14, colA, colB, seam: hexShade(colA, 0.55), up: round ? [0, 1, 0] : [-1, 0, 0], panel: 1.4, patches: o.patches ?? (X.kw('patch', 'stitched', 'stolen', 'scrap') ? 8 : 2), seed: X.seed + Math.round(at[2] * 10) };
  const geos = levels(null, (lv) => envelopeGeo(key, prof, eo, [0, 1, 1, 2, 3, 3][lv], 0));
  const mk = (dl) => levels(null, (lv) => envelopeGeo(key, prof, eo, [0, 1, 1, 2, 3, 3][lv], dl));
  const m = piece(X, geos, g, [0, 0, 0], round ? [0, 0, 0] : [0, 0, -PI / 2], 1);
  X.skins.push({ ent: m.userData.lodEntry, make: (lv) => mk(lv) });
  X.breakParts.push({ mesh: g, at, kind: 'bag' });
  // bands of metal round the bag (ribbed, spiked, or the realm's rings), a ridge spine, fins aft
  if (!round) {
    const nr = o.ribs ?? 4;
    for (let i = 0; i < nr; i++) {
      const t = (i + 1) / (nr + 1), x = -Le / 2 + t * Le, k = t < 0.35 ? Math.sin((t / 0.35) * PI / 2) ** 0.7 : Math.cos(((t - 0.35) / 0.65) * PI / 2) ** 0.55;
      const rr = R * k + 0.06, geo = ringGeo(`envband|${X.fid}|${q(rr)}`, rr, 0.09, X.pat.trim, {});
      const rm = piece(X, geo, g, [x, 0, 0], [0, 0, PI / 2], 1);
      void rm;
      if (o.spikes) for (let j = 0; j < 10; j++) { const a = (j / 10) * TAU; place(X, cutAfter(spikeGeo(X), 3), [x, Math.cos(a) * rr, Math.sin(a) * rr], [a, 0, 0], 1.4, g); }
    }
    // fins at the tail
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + PI / 4;
      const fin = prismGeo(`fin|${X.fid}`, { plan: 'rect', w: 2.4, d: 0.12, corner: 0.04, prof: [[1, 0, 0, 'trim'], [1, 0, 1.4, 'trim'], [0.3, 0, 1.6, 'trim'], [0, 0, 1.6, 'trim']], mats: { trim: X.pat.trim }, dens: 8 }, 0);
      place(X, fin, [-Le / 2 + 1.5, R * 0.28, 0], [0, 0, 0], [1, Math.max(1, R * 0.55), 1], groupRot(X, g, [0, 0, 0], [a, 0, 0]));
    }
  }
  return { g, prof, Le, R, round };
}
const q = (v) => (+v).toFixed(2);
const RG = new Map();
function groupRot(X, parent, pos, rot) { const g = new THREE.Group(); g.position.set(...pos); g.rotation.set(rot[0], rot[1], rot[2]); parent.add(g); return g; }
function spikeGeo(X) { return PC.sculpt(`spike|${X.pal.trim}`, () => { const B = new PCS.SB(); B.p(PCS.S.cone(0.12, 0, 0.5).color(X.pal.trim).pbr(0.35, 0.85).at(0, 0.25, 0)); return B.part(); }, 40); }
void RG;

/** ropes (rigging) from each of a list of [a, b] pairs */
export function rigging(X, pairs, col = 0x3a3028, r = 0.035) {
  const list = pairs.map(([a, b]) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.03, (a[2] + b[2]) / 2]; return { pts: [a, m, b], r }; });
  const geos = tubesGeo(`rig|${X.fid}|${hashKey(pairs)}`, list, lin(col), { sides: 5, dens: 3, twist: true, ro: 0.9, last: 3 });
  piece(X, geos, X.I, [0, 0, 0], [0, 0, 0], 1);
}
/** a hanging chain from p down len (sags out by dx); in parent */
export function chainGeo(X, len, r = 0.09) { return tubeGeo(`chain|${q(len)}|${q(r)}`, [[0, 0, 0], [0.02, -len * 0.5, 0.01], [0, -len, 0]], r, lin(0x3a3634), { chain: true, dens: 10, sides: 6, me: 0.7, ro: 0.5, last: 3 }); }

/** a waterfall pouring off p (outward direction n), falling len; water colour */
export function waterfall(X, p, n, len, w = 0.8, col = 0x9ad0e8, kind = 'water') {
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8, out = 0.6 * Math.sqrt(t) + t * 0.4; pts.push([p[0] + n[0] * out, p[1] - t * len, p[2] + n[1] * out]); }
  const side = [-n[1], 0, n[0]];
  const mat = flowMat(X, kind, col, kind === 'water' ? 0.75 : 0.6, kind === 'fire' || kind === 'light');
  const geos = flowSheet(`wf|${hashKey([p, n, len, w])}`, pts, (t) => w * (1 + t * 0.8), { side });
  const m = piece(X, geos, X.I, [0, 0, 0], [0, 0, 0], 1, mat); m.castShadow = false;
  // spray where it leaves the lip and a mist at its foot
  const spray = flowShell(`spray|${q(w)}`, [[w * 0.5, -0.4], [w * 1.6, 0], [w * 2.6, 0.5]], { nu: 16, nv: 4, last: 3 });
  const s = piece(X, spray, X.I, [pts[8][0], pts[8][1] + 0.2, pts[8][2]], [0, 0, 0], 1, flowMat(X, 'mist', 0xffffff, 0.5)); s.castShadow = false;
  return m;
}
/** a slow mist about (x, y, z): a few shells of radius r and height h, drifting */
export function mist(X, at, r, h, col = 0xe8eef0, op = 0.45, layers = 3) {
  const g = new THREE.Group(); g.position.set(...at); X.I.add(g);
  for (let i = 0; i < layers; i++) {
    const rr = r * (0.75 + i * 0.22), hh = h * (0.7 + i * 0.25);
    const geos = flowShell(`mist|${q(rr)}|${q(hh)}`, [[rr * 0.55, -hh * 0.5], [rr, -hh * 0.1], [rr * 0.95, hh * 0.2], [rr * 0.6, hh * 0.5]], { nu: 36, nv: 8, twist: 0.6 });
    const m = piece(X, geos, g, [0, 0, 0], [0, i * 1.3, 0], 1, flowMat(X, 'mist', col, op * (1 - i * 0.18)));
    m.castShadow = false; m.renderOrder = 2;
    X.anim.spin.push({ o: m, axis: 'y', speed: 0.05 * (i % 2 ? -1 : 1) });
  }
  return g;
}
/** a whirling vortex funnel under the hull (top radius r at y = 0 of the group, down h) */
export function vortex(X, at, r, h, col, kind = 'vortex', op = 0.65) {
  const g = new THREE.Group(); g.position.set(...at); X.I.add(g);
  for (let i = 0; i < 3; i++) {
    const k = 1 - i * 0.22;
    const geos = flowShell(`vtx|${q(r * k)}|${q(h)}`, [[r * 0.14 * k, -h], [r * 0.3 * k, -h * 0.65], [r * 0.62 * k, -h * 0.3], [r * k, 0]], { nu: 40, nv: 10, twist: 2.4 });
    const m = piece(X, geos, g, [0, -i * 0.3, 0], [0, i, 0], 1, flowMat(X, kind, col, op, kind === 'fire'));
    m.castShadow = false; m.renderOrder = 2;
    X.anim.spin.push({ o: m, axis: 'y', speed: 1.4 + i * 0.6 });
  }
  return g;
}
/** a column or pillars of light/fire beneath (beams up to the hull) */
export function lightPillar(X, at, r, h, col, kind = 'light') {
  const geos = flowShell(`pil|${q(r)}|${q(h)}`, [[r, 0], [r * 1.05, h * 0.5], [r * 0.7, h]], { nu: 24, nv: 6 });
  const m = piece(X, geos, X.I, at, [0, 0, 0], 1, flowMat(X, kind, col, kind === 'fire' ? 0.85 : 0.5, true)); m.castShadow = false;
  X.anim.spin.push({ o: m, axis: 'y', speed: 0.3 });
  return m;
}
/** a banner on a pole at p (pole height ph), flying toward +x of rot; side colour */
export function bannerAt(X, p, ph = 2.2, w = 1.1, h = 1.6, ry = 0, parent = null) {
  const pg = new THREE.Group(); pg.position.set(...p); pg.rotation.y = ry; (parent || X.I).add(pg);
  const pole = tubeGeo(`pole|${q(ph)}`, [[0, 0, 0], [0, ph, 0]], 0.05, lin(X.pal.wood), { sides: 6, last: 3 });
  place(X, pole, [0, 0, 0], [0, 0, 0], 1, pg);
  finialAt(X, [0, ph, 0], 0.45, pg);
  X.bannerMat ||= waveMat(X, X.pal.side);
  const cut = { swallow: 'swallow', pennon: 'pennon', tatter: 'tatter', streamer: 'pennon', triangle: 'pennon' }[X.S.banner] || 'square';
  const m = piece(X, bannerGeo(`${cut}|${q(w)}|${q(h)}`, w, h, 0xffffff, 0xd8d8d8, cut), pg, [0.06, ph - 0.12, 0], [0, 0, 0], 1, X.bannerMat);
  m.castShadow = false;
  return m;
}
/** a ring of a few spinning rings (astrolabe) about p; R outer radius */
export function astrolabe(X, at, R, n = 3, o = {}) {
  const g = new THREE.Group(); g.position.set(...at); X.I.add(g);
  const P = o.P || X.pat.trim, rune = lin(X.pal.glow);
  for (let i = 0; i < n; i++) {
    const r = R * (1 - i * 0.14), sub = new THREE.Group(); g.add(sub);
    sub.rotation.set(i === 0 ? 0 : 0.5 + i * 0.6, i * 1.1, i === 0 ? 0 : 0.3 * i);
    const spin = new THREE.Group(); sub.add(spin);
    piece(X, ringGeo(`astro|${X.fid}|${q(r)}`, r, Math.max(0.12, R * 0.035), P, { rune, ry: 0.55, rz: 1.25 }), spin, [0, 0, 0], [0, 0, 0], 1);
    X.anim.spin.push({ o: spin, axis: 'y', speed: (o.speed ?? 0.35) * (i % 2 ? -1 : 1) * (1 + i * 0.4) });
  }
  return g;
}
export { roofShape };
void toHex; void mulc; void fract; void LV; void wall;
