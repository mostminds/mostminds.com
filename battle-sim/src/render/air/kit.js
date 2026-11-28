// Shared pieces for the flying units (src/render/air): small vector helpers, desc surgery (graft, drop, scale),
// each faction's look in the air, the faction's own soldiers baked as crew figures, and the role props (bomb racks,
// torpedoes, harpoon guns, rocket pods, rope ladders and cages) every air model can carry.
//
// Conventions (the same as src/render/bodies): a description is { kind, attack, nodes: [...] } in ONE authoring
// space, Y up, facing +Z, on y = 0; each node's prims / hard are in that node's own space (pos is the offset from its
// parent). A human soldier stands 1.0 tall.
import * as THREE from 'three';
import { S, H, rgb, distanceField } from '../sculpt.js';
import { bakePose, getDetail, DETAIL } from '../rigkit.js';
import { REALM_STYLE as SKY_STYLE } from '../sky/style.js';
import { REALMS } from '../../data/realms.js';
import { UNITS } from '../../data/units.js';

export const DEG = Math.PI / 180;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm3 = (a) => mul3(a, 1 / (len3(a) || 1e-9));
export const flat = (x) => [x].flat(Infinity).filter(Boolean);
export const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _c = new THREE.Color(), _c2 = new THREE.Color();
/** hex mixed toward another */
export const mix = (a, b, t) => _c.set(a).lerp(_c2.set(b), t).getHex();
/** hex with its lightness (and optionally saturation) shifted */
export function tone(hex, dl, ds = 0) { _c.set(hex); const h = {}; _c.getHSL(h); _c.setHSL(h.h, clamp(h.s + ds), clamp(h.l + dl)); return _c.getHex(); }
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** a fresh node */
export const node = (name, parent, pos, extra = {}) => ({ name, parent, pos, prims: [], hard: [], ...extra });

// ------------------------------------------------------------------------------------------------- desc surgery
export const byName = (nodes, name) => nodes.find((n) => n.name === name);
/** the authoring-space origin of a node (rotations ignored: the bodies used here do not rotate their trunks) */
export function worldOf(nodes, name) {
  let p = [0, 0, 0];
  for (let n = byName(nodes, name); n; n = n.parent ? byName(nodes, n.parent) : null) p = add3(p, n.pos || [0, 0, 0]);
  return p;
}
/** scale one node's pieces about its own origin by k (positions are handled by the caller); detail keeps the cell size */
export function scaleNode(n, k, detailK = k) {
  n.prims = flat(n.prims).map((p) => p.clone().scale(k));
  n.hard = flat(n.hard).map((h) => h.clone().scale(k));
  n.detail = (n.detail ?? 1) * detailK; if (n.minRes) n.minRes *= detailK;
}
/** the subtree rooted at `name` (that node first, parents before children) */
export function subtree(nodes, name) {
  const keep = new Set([name]), out = [];
  for (const n of nodes) if (n.name === name || keep.has(n.parent)) { keep.add(n.name); out.push(n); }
  return out;
}
/** drop nodes by name or predicate, with everything hanging from them */
export function drop(nodes, test) {
  const f = typeof test === 'function' ? test : (n) => test.includes(n.name);
  const gone = new Set();
  return nodes.filter((n) => { if (f(n) || gone.has(n.parent)) { gone.add(n.name); return false; } return true; });
}
/**
 * copy donor nodes onto target: the donor's root-level node `rootName` (and its subtree) is re-hung under `parent`
 * so its origin lands at `at` (target authoring space), scaled by k. prefix renames the copies; rigMap renames keys.
 */
export function graft(target, donor, rootName, parent, at, k = 1, prefix = '', rigMap = null, detailK = 1) {
  const pw = worldOf(target, parent);
  const out = [];
  for (const n of subtree(donor, rootName)) {
    const c = { ...n, name: prefix + n.name };
    scaleNode(c, k, detailK);
    if (n.name === rootName) { c.parent = parent; c.pos = sub3(at, pw); } else { c.parent = prefix + n.parent; c.pos = mul3(n.pos || [0, 0, 0], k); }
    if (rigMap && c.rig) c.rig = rigMap(c.rig);
    out.push(c);
  }
  target.push(...out);
  return out;
}
/** walk from `from` along `dir` to the surface of a prim list (in that list's space) */
export function surfHit(prims, from, dir, steps = 60) {
  const df = distanceField(flat(prims));
  const u = norm3(dir);
  let p = from.slice(), best = p, bd = 1e9;
  for (let i = 0; i < steps; i++) { const d = df(p[0], p[1], p[2]); if (d < bd) { bd = d; best = p; } if (d < 0.0008) break; p = add3(p, mul3(u, Math.max(0.002, d))); }
  return best;
}
/** recolour / relight every piece of the given nodes: fn(rgb) -> rgb, plus optional glow */
export function recolor(nodes, fn, glow = null) {
  for (const n of nodes) {
    for (const p of flat(n.prims)) { if (p.hasCol || p.op !== 1) p.col = fn(p.col); if (glow !== null) p.glowV = Math.max(p.glowV, glow); }
    for (const h of flat(n.hard)) { h.col = fn(h.col); const f0 = h.fn; if (f0) h.fn = (...a) => { const r = f0(...a); return r == null ? null : fn(Array.isArray(r) ? r : rgb(r)); }; if (glow !== null) h.glowV = Math.max(h.glowV, glow); }
  }
}

// ------------------------------------------------------------------------------------------------- faction look
const ORIGINALS = {
  kingdom: { emblem: 'lion', metal: 0xc9a23e, metalKind: 'brass', wood: 0x6b4a2e, roof: 'gable', accent: 0xd9b23a, cloth: 0x2f5aa8, cloth2: 0xd9b23a, crew: 'footman' },
  goblin: { emblem: 'tusks', metal: 0x6a5a48, metalKind: 'iron', wood: 0x4a3626, roof: 'flat', accent: 0x8a1a14, cloth: 0x6a4a2a, cloth2: 0x8a1a14, crew: 'goblin', rough: true },
  undead: { emblem: 'skull', metal: 0x8a8a80, metalKind: 'iron', wood: 0x2a2628, roof: 'spire', accent: 0x5affa0, cloth: 0x2c2a34, cloth2: 0x5a4a6a, crew: 'skeleton', glow: 0x5affa0, grim: true },
  infernal: { emblem: 'horns', metal: 0x9a3a20, metalKind: 'iron', wood: 0x1a1414, roof: 'spire', accent: 0xff6a1a, cloth: 0x4a1414, cloth2: 0xff6a1a, crew: 'cultist', glow: 0xff7a1c, grim: true },
  beasts: { emblem: 'paw', metal: 0x8a7050, metalKind: 'bone', wood: 0x5a4030, roof: 'tent', accent: 0xa88a5a, cloth: 0x6a4a2e, cloth2: 0xa88a5a, crew: 'goblin', rough: true },
  elemental: { emblem: 'rune', metal: 0x8a9aa8, metalKind: 'silver', wood: 0x5a5e6c, roof: 'spire', accent: 0x7ad8ff, cloth: 0x4a5a7a, cloth2: 0x7ad8ff, crew: 'battlemage', glow: 0x7ad8ff },
  dragons: { emblem: 'dragon', metal: 0xc9a23e, metalKind: 'gilt', wood: 0x5a2a22, roof: 'pagoda', accent: 0xd8642a, cloth: 0x7a2a22, cloth2: 0xd8b03a, crew: 'kobold' },
};
const SHINE = { gilt: 0.8, brass: 0.75, bronze: 0.7, copper: 0.75, iron: 0.6, silver: 0.85, bone: 0, jade: 0.1, obsidian: 0.3, crystal: 0.1, wood: 0 };
const GRIM = new Set(['kaelneth', 'ironbound', 'screaming', 'ashur', 'malvash', 'ashhorde', 'kharnak', 'morbus', 'skar', 'crimson', 'khemet', 'drowned', 'greenhide', 'cloven', 'balor', 'gorge', 'undead', 'infernal']);
const ROUGH = new Set(['greenhide', 'skar', 'gorge', 'cloven', 'goblin', 'beasts', 'balor', 'kurgan', 'morbus', 'fimbul', 'baobab']);
const GLOWS = { aethel: 0x9ad8ff, kaelneth: 0xb03aff, xibalba: 0x3affd0, labyrinth: 0x8ad8f0, screaming: 0xe83aff, morbus: 0x9ae03a, skar: 0x6aff3a, crimson: 0xff3a3a, drowned: 0x5affa0, khemet: 0x3ad8ff, ashhorde: 0xff5a1a, kharnak: 0xff3a1a, malvash: 0xff7a1c, velvet: 0xff8ad8, verdant: 0xb8ff7a, deeproot: 0xd8ff5a, glimmer: 0x3ae0ff, tianlong: 0x8affd0, elemental: 0x7ad8ff };
const realmP = (id) => { const r = REALMS.find((x) => x.id === id); return r ? r.P || {} : {}; };

/**
 * The look of a faction in the air: metal and how it shines, wood, its colours (overridden by the spec's palette),
 * glow, emblem, roof, and whether it builds clean (order), grim (dark powers) or rough (savage) machines.
 */
export function lookOf(style, o = {}) {
  const id = style || 'kingdom', orig = ORIGINALS[id], st = { ...(SKY_STYLE[id] || {}), ...(orig || {}) }, P = realmP(id);
  const L = {
    id,
    metal: st.metal ?? 0xc9a04a, metalKind: st.metalKind || 'brass', wood: st.wood ?? 0x6b4a2e, accent: st.accent ?? 0xe8e0d0,
    emblem: st.emblem || 'star', roof: st.roof || 'gable', motif: st.motif || 'studs',
    skin: num(o.skin, P.skin ?? 0xd9a77c), cloth: num(o.cloth, P.cloth ?? st.cloth ?? 0x2f5aa8), cloth2: num(o.cloth2, P.cloth2 ?? st.cloth2 ?? 0xd9b23a),
    armor: num(o.armor, P.armor ?? 0x9aa3ad), trim: num(o.trim, P.trim ?? st.metal ?? 0xc9a23e), mount: num(o.mount, 0x8a6a40),
    glow: num(o.glow, GLOWS[id] ?? st.glow ?? 0xffb84a),
    grim: GRIM.has(id) || !!st.grim, rough: ROUGH.has(id) || !!st.rough,
  };
  L.shine = SHINE[L.metalKind] ?? 0.7;
  // a wood-coloured "metal" (verdant, deeproot) reads as carved timber with gilt pins
  if (L.metalKind === 'wood') { L.metal = mix(L.metal, 0x8a6a3a, 0.3); L.shine = 0.2; }
  if (L.wood === L.cloth) L.wood = tone(L.wood, -0.1);
  return L;
}
/** a wood grain for hard pieces: streaks along the longest axis */
function grain(c) {
  const b = rgb(c);
  return (x, y, z) => { const g = 0.82 + 0.18 * Math.sin((x + y * 0.3 + z) * 90 + Math.sin((x - z) * 23) * 3); return [b[0] * g, b[1] * g, b[2] * g]; };
}
/** prim / hard finishers for a look */
export function finishes(L) {
  return {
    metal: (q, c = L.metal) => q.color(c).pbr(0.34, L.shine),
    iron: (q) => q.color(L.grim ? 0x3a3438 : 0x55585e).pbr(0.48, 0.7),
    wood: (q, c = L.wood) => (q.bump ? q.color(c).bump(0.0025, 26, 'fur').tint(0.12, 18).pbr(0.82) : q.color(c).pbr(0.82).shade(grain(c))),
    cloth: (q, c = L.cloth) => (q.bump ? q.color(c).bump(0.0018, 40, 'weave').tint(0.08, 12).pbr(0.88) : q.color(c).pbr(0.88)),
    leather: (q, c = 0x5a3a22) => (q.tint ? q.color(c).tint(0.15, 30).pbr(0.66) : q.color(c).pbr(0.66)),
  };
}

// ------------------------------------------------------------------------------------------------- crew figures
const FOOT = new Set(['humanoid', 'skeleton', 'naga']);
const crewUnitCache = new Map();
/** the faction's first foot soldier of normal size (a man, a dwarf, a rat-man, a skeleton...) */
export function crewUnit(style) {
  if (crewUnitCache.has(style)) return crewUnitCache.get(style);
  let best = null;
  const want = ORIGINALS[style]?.crew;
  if (want && UNITS[want]) best = { id: want, ...UNITS[want] };
  if (!best) for (const [id, u] of Object.entries(UNITS)) {
    if (!(u.faction === style || id.startsWith(style + '_'))) continue;
    if (!u.model || !FOOT.has(u.model.body || 'humanoid')) continue;
    if ((u.size || 1) > 1 || (u.model.scale || 1) > 1.15 || u.fly) continue;
    best = { id, ...u }; break;
  }
  best = best || { id: 'footman', ...UNITS.footman };
  best = { ...best, size: 1 };
  crewUnitCache.set(style, best);
  return best;
}
let buildUnitModelFn = null, animateUnitFn = null;
/** models.js hands its unit builder over (avoids an import cycle at load time) */
export function useUnitBuilder(build, animate) { buildUnitModelFn = build; animateUnitFn = animate; }

const CREW = new Map();
const EMPTY = new THREE.BufferGeometry();
EMPTY.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
/** per-pose joint offsets (radians, on top of the rest pose) */
const POSES = {
  seat: { legs: [-1.4, 0, 0.12], shins: [1.45], arms: [-0.85, 0, -0.08], forearms: [-0.75] },
  stand: { legs: [0.04, 0, 0.06], shins: [0.06], arms: [-0.35, 0, -0.06], forearms: [-0.55] },
  brace: { legs: [-0.35, 0, 0.12], shins: [0.7], arms: [-1.25, 0, -0.1], forearms: [-0.35], torso: [0.18] },
  kneel: { legs: [-1.2, 0, 0.1], shins: [2.0], arms: [-1.0, 0, -0.08], forearms: [-0.6], torso: [0.1] },
  wave: { legs: [0.04, 0, 0.06], shins: [0.06], arms: [-2.6, 0, -0.25], forearms: [-0.3] },
};
const crewKey = (style, o) => `${style}|${['skin', 'cloth', 'cloth2', 'armor', 'trim'].map((k) => (typeof o[k] === 'number' ? o[k].toString(16) : '-')).join(',')}`;
/**
 * A crew figure: the faction's foot soldier (in the spec's colours), posed and baked into one static geometry per
 * detail level of the host model. pose: seat | stand | brace | kneel | wave | aim (his own attack, mid-swing / loosing).
 * Returns { geos: [level 0..n-1], height } or null. Cached per faction, palette, pose and detail preset.
 */
export function crewFigure(style, o = {}, pose = 'stand') {
  const key = `${crewKey(style, o)}|${pose}|${getDetail()}`;
  if (CREW.has(key)) return CREW.get(key);
  let out = null;
  try {
    if (!buildUnitModelFn) return null;
    const u = crewUnit(style), m0 = u.model || { body: 'humanoid' };
    const model = { ...m0 };
    for (const k of ['skin', 'cloth', 'cloth2', 'armor', 'trim']) if (typeof o[k] === 'number' && model.body !== 'skeleton') model[k] = o[k];
    if (pose === 'seat' || pose === 'brace') { delete model.shield; }
    const def = { ...u, id: `aircrew_${crewKey(style, o)}`, model };
    const m = buildUnitModelFn(def);
    const rig = m.userData.rig;
    if (rig && m.userData.lod && rig.v2) {
      if (pose === 'aim' && animateUnitFn) animateUnitFn(m, 0.4, false, 0.5, 0, 0, false);
      else {
        animateUnitFn?.(m, 0.4, false, -1, 0, 0, false);
        const P = POSES[pose] || POSES.stand;
        const Rr = (n, v, side = 1) => { if (!n || !v) return; const r = n.userData.rest; if (!r) return; n.rotation.set(r[0] + (v[0] || 0), r[1] + (v[1] || 0) * side, r[2] + (v[2] || 0) * side); };
        (rig.legs || []).forEach((l, i) => Rr(l, P.legs, i ? -1 : 1));
        (rig.shins || []).forEach((l, i) => Rr(l, P.shins, i ? -1 : 1));
        (rig.arms || []).forEach((l, i) => Rr(l, P.arms, i ? -1 : 1));
        (rig.forearms || []).forEach((l, i) => Rr(l, P.forearms, i ? -1 : 1));
        if (P.torso) Rr(rig.torso, P.torso);
        if (m.userData.inner) m.userData.inner.rotation.set(0, 0, 0);
      }
      m.updateMatrixWorld(true);
      const lv = m.userData.lod.meshes[0].geos.length, n = DETAIL[getDetail()].length;
      const bake = new Map(), B = (l) => { l = Math.min(l, lv - 1); if (!bake.has(l)) bake.set(l, bakePose(m, l) || EMPTY); return bake.get(l); };
      // close up he is a soldier one level coarser than on the field (he is small in the frame); far off a sketch
      const geos = [];
      for (let i = 0; i < n; i++) geos.push(B(Math.min(i + 1, lv - 1)));
      if (n > 3) geos[n - 1] = EMPTY;
      const hipW = new THREE.Vector3(), hipR = new THREE.Vector3();
      (rig.legs?.[0] || m).getWorldPosition(hipW); (rig.legs?.[1] || rig.legs?.[0] || m).getWorldPosition(hipR);
      hipW.add(hipR).multiplyScalar(0.5);
      out = { geos, height: rig.height || 1, hip: [hipW.x, hipW.y, hipW.z], species: model.species || 'human' };
    }
  } catch (err) { console.warn('[air] crew figure failed', style, pose, err); }
  CREW.set(key, out);
  return out;
}

// ------------------------------------------------------------------------------------------------- role props
/**
 * Props a role hangs on a flier, added as nodes under `parent` (a body node) at `at` (that node's space, the keel /
 * belly point), sized by s (1 = a horse-sized flier). o: the model spec { bombs, torpedo, harpoon, rockets, cargo }.
 * L: the look. Returns { nodes, anchors: { bombBay, torpedo, harpoon, rockets, cargo } } (anchors in the parent's space).
 */
export function roleProps(o, L, parent, at, s = 1, opts = {}) {
  const F = finishes(L), nodes = [], an = {};
  const iron = 0x3e3c40, dark = L.grim ? 0x2a2224 : 0x4a3a2a;
  const side = opts.halfWidth ?? 0.18 * s;
  // bomb rack: a timber / iron beam under the belly with the bombs slung in a row, shackled
  const nb = clamp(Math.round(num(o.bombs, o.bombs ? 4 : 0)), 0, 8);
  if (nb) {
    const len = 0.16 * s * Math.max(2, Math.ceil(nb / 2)) + 0.12 * s, y = at[1], z0 = at[2];
    const rack = node('bombRack', parent, at, { detail: 0.9 });
    rack.hard.push(F.metal(H.box(0.06 * s, 0.04 * s, len, 0.006)).at(0, 0, 0));
    for (const sx of [1, -1]) rack.hard.push(H.tube([[sx * 0.03 * s, 0, len * 0.42], [sx * side * 0.7, 0.08 * s, len * 0.3], [sx * side, 0.12 * s, 0]], 0.008 * s, 10, 5).color(iron).pbr(0.5, 0.7));
    nodes.push(rack);
    const rows = nb > 3 ? 2 : 1, per = Math.ceil(nb / rows);
    for (let i = 0; i < nb; i++) {
      const r = i % rows, j = Math.floor(i / rows), x = rows > 1 ? (r ? -1 : 1) * 0.07 * s : 0, z = (j - (per - 1) / 2) * 0.16 * s;
      const b = node(`bomb${i}`, 'bombRack', [x, -0.09 * s, z], { rig: 'bombs', detail: 1.1 });
      const R = 0.055 * s;
      b.prims.push(F.metal(S.ellipsoid(R, R, R * 1.5).at(0, 0, 0), L.grim ? 0x2a2a2e : 0x3a3a40).pbr(0.45, 0.6));
      b.prims.push(S.torus(R * 0.95, R * 0.12).rot(90, 0, 0).at(0, 0, R * 0.4).color(L.metal).pbr(0.35, L.shine).blend(0.004));
      b.hard.push(H.cyl(R * 0.08, R * 0.08, R * 0.6, 8).at(0, R * 1.05, 0).color(iron).pbr(0.5, 0.7));
      for (let f = 0; f < 4; f++) b.hard.push(H.box(0.004 * s, R * 0.9, R * 0.9, 0.001).rot(0, 0, f * 45).at(0, 0, -R * 1.75).color(L.grim ? 0x1a1a1a : L.metal).pbr(0.4, 0.6));
      if (L.grim) b.hard.push(H.sphere(R * 0.18, 8).at(0, 0, R * 1.5).color(L.glow).glow(1.2));
      nodes.push(b);
    }
    an.bombBay = [at[0], y - 0.1 * s, z0];
  }
  // torpedo: a long iron fish slung under the keel in two crutches, a screw at its tail
  if (o.torpedo) {
    const tz = at[2], ty = at[1] - 0.04 * s;
    const t = node('torpedo', parent, [at[0], ty, tz], { rig: 'torpedo', detail: 1 });
    const R = 0.06 * s, Lh = 0.42 * s;
    t.prims.push(S.capsule([0, -0.1 * s, -Lh], [0, -0.1 * s, Lh * 0.8], R, R).color(L.grim ? 0x2e3236 : 0x55605a).pbr(0.4, 0.7).bump(0.001, 40, 'ridges'));
    t.prims.push(S.ellipsoid(R * 1.02, R * 1.02, R * 1.6).at(0, -0.1 * s, Lh * 0.82).color(L.metal).pbr(0.32, L.shine).blend(0.02));
    for (const zz of [-0.5, 0, 0.5]) t.prims.push(S.torus(R * 1.0, R * 0.08).rot(90, 0, 0).at(0, -0.1 * s, zz * Lh).color(L.metal).paint(0.004, 0.002));
    for (let f = 0; f < 4; f++) t.hard.push(H.box(0.006 * s, R * 2.2, R * 1.4, 0.002).rot(0, 0, f * 90 + 45).at(0, -0.1 * s, -Lh - R * 0.4).color(iron).pbr(0.45, 0.7));
    t.hard.push(H.cyl(R * 0.15, R * 0.15, 0.06 * s, 8).rot(90, 0, 0).at(0, -0.1 * s, -Lh - R * 1.1).color(iron));
    for (let b = 0; b < 3; b++) t.hard.push(H.box(R * 1.5, 0.008 * s, R * 0.4, 0.002).rot(0, 0, b * 60).at(0, -0.1 * s, -Lh - R * 1.4).color(L.metal).pbr(0.35, L.shine));
    nodes.push(t);
    const cr = node('torpedoCrutch', parent, [at[0], at[1], tz], { detail: 0.8 });
    for (const zz of [-0.4, 0.4]) cr.hard.push(H.tube([[-side * 0.5, 0.06 * s, zz * Lh], [-R * 1.2, -0.06 * s, zz * Lh], [0, -0.1 * s - R * 1.1, zz * Lh], [R * 1.2, -0.06 * s, zz * Lh], [side * 0.5, 0.06 * s, zz * Lh]], 0.01 * s, 16, 5).color(iron).pbr(0.5, 0.7));
    nodes.push(cr);
    an.torpedo = [at[0], ty - 0.1 * s, tz + Lh];
  }
  // harpoon gun: a heavy crossbow / swivel gun on the bow with a barbed harpoon and a coil of line
  if (o.harpoon) {
    const hp = opts.bow || [at[0], at[1] + 0.12 * s, at[2] + 0.3 * s];
    const g = node('harpoonGun', parent, hp, { rig: 'harpoon', detail: 1.1 });
    g.hard.push(F.wood(H.box(0.06 * s, 0.06 * s, 0.38 * s, 0.006)).at(0, 0, 0.05 * s));
    for (const sx of [1, -1]) g.hard.push(H.tube([[0, 0, 0.2 * s], [sx * 0.14 * s, 0.01 * s, 0.17 * s], [sx * 0.24 * s, 0, 0.08 * s]], [0.016 * s, 0.012 * s, 0.008 * s], 12, 6).color(L.wood).pbr(0.7));
    g.hard.push(H.tube([[-0.24 * s, 0, 0.08 * s], [0, 0, -0.05 * s], [0.24 * s, 0, 0.08 * s]], 0.003 * s, 10, 3).color(0xd8c8a0).pbr(0.8));
    g.hard.push(H.box(0.03 * s, 0.03 * s, 0.1 * s, 0.004).at(0, -0.05 * s, -0.08 * s).color(iron).pbr(0.5, 0.7));
    g.prims.push(S.torus(0.05 * s, 0.014 * s).rot(0, 0, 90).at(0.07 * s, -0.02 * s, -0.08 * s).color(0xb89a64).bump(0.002, 60, 'ridges').pbr(0.9));
    nodes.push(g);
    const hh = node('harpoonHead', 'harpoonGun', [0, 0.04 * s, 0.24 * s], { rig: 'harpoonHead', detail: 1.2 });
    hh.hard.push(H.cyl(0.008 * s, 0.008 * s, 0.4 * s, 8).rot(90, 0, 0).at(0, 0, -0.06 * s).color(L.wood).pbr(0.7));
    hh.hard.push(H.cone(0.022 * s, 0.07 * s, 8).rot(90, 0, 0).at(0, 0, 0.17 * s).color(L.metal).pbr(0.3, L.shine));
    for (const sx of [1, -1]) hh.hard.push(H.cone(0.008 * s, 0.05 * s, 6).rot(-130, 0, sx * 30).at(sx * 0.016 * s, 0, 0.13 * s).color(L.metal).pbr(0.3, L.shine));
    nodes.push(hh);
    an.harpoon = add3(hp, [0, 0.04 * s, 0.45 * s]);
  }
  // rocket pods: a tube cluster either side, each tube with a rocket nose showing
  const nr = clamp(Math.round(num(o.rockets, o.rockets ? 4 : 0)), 0, 12);
  if (nr) {
    const per = Math.ceil(nr / 2);
    for (const sx of [1, -1]) {
      const pod = node(`rocketPod${sx > 0 ? 'L' : 'R'}`, parent, [at[0] + sx * side * 1.15, at[1] + 0.02 * s, at[2] + 0.05 * s], { detail: 1 });
      pod.hard.push(H.tube([[-sx * side * 0.9, 0.1 * s, 0], [-sx * side * 0.4, 0.04 * s, 0], [0, 0, 0]], 0.012 * s, 10, 5).color(iron).pbr(0.5, 0.7));
      for (let i = 0; i < per; i++) {
        const a = (i / per) * Math.PI * 2, x = Math.cos(a) * 0.035 * s * (per > 1 ? 1 : 0), y = Math.sin(a) * 0.035 * s * (per > 1 ? 1 : 0);
        pod.hard.push(H.cyl(0.022 * s, 0.022 * s, 0.26 * s, 10, true).rot(90, 0, 0).at(x, y, 0).color(L.grim ? 0x3a2a2a : L.metal).pbr(0.4, L.shine * 0.8));
        const r = node(`rocket${sx > 0 ? 'L' : 'R'}${i}`, `rocketPod${sx > 0 ? 'L' : 'R'}`, [x, y, 0.13 * s], { rig: 'rockets', detail: 1.2 });
        r.hard.push(H.cone(0.019 * s, 0.06 * s, 10).rot(90, 0, 0).at(0, 0, 0.02 * s).color(L.grim ? L.glow : 0xa83a2a).pbr(0.5).glow(L.grim ? 0.6 : 0));
        nodes.push(r);
      }
      pod.hard.push(H.torus(0.065 * s, 0.006 * s, 18, 5).at(0, 0, 0.1 * s).color(L.metal).pbr(0.35, L.shine).lod(1));
      pod.hard.push(H.torus(0.065 * s, 0.006 * s, 18, 5).at(0, 0, -0.1 * s).color(L.metal).pbr(0.35, L.shine).lod(1));
      nodes.push(pod);
    }
    an.rockets = [at[0], at[1], at[2] + 0.2 * s];
  }
  // cargo: a rope ladder rolled under the belly (it drops on 'drop'), or a slung crate / troop cage
  if (o.cargo) {
    const kind = o.cargo === 'cage' || o.cargo === 'ladder' || o.cargo === 'crate' ? o.cargo : 'ladder';
    const c = node('cargo', parent, [at[0], at[1] - 0.02 * s, at[2] - 0.05 * s], { rig: 'cargo', detail: 1 });
    if (kind === 'ladder') {
      const n = 7, w = 0.11 * s, step = 0.075 * s;
      for (const sx of [1, -1]) c.hard.push(H.tube([[sx * w, 0, 0], [sx * w, -step * n * 0.5, 0.01 * s], [sx * w, -step * n, 0]], 0.006 * s, 16, 4).color(0xb89a64).pbr(0.9));
      for (let i = 1; i <= n; i++) c.hard.push(F.wood(H.cyl(0.007 * s, 0.007 * s, w * 2.1, 6)).rot(0, 0, 90).at(0, -i * step, 0));
      c.prims.push(S.cyl(0.035 * s, w * 2.4, 0.01).rot(0, 0, 90).at(0, 0.02 * s, 0).color(0xb89a64).bump(0.003, 50, 'ridges').pbr(0.9));
    } else {
      const w = 0.2 * s, h = kind === 'cage' ? 0.26 * s : 0.16 * s, y = -0.22 * s;
      for (const sx of [1, -1]) for (const sz of [1, -1]) c.hard.push(H.tube([[0, 0, 0], [sx * w * 0.9, y + h, sz * w * 0.9]], 0.004 * s, 4, 3).color(0xb89a64).pbr(0.9));
      if (kind === 'crate') c.hard.push(F.wood(H.box(w * 2, h, w * 2, 0.008)).at(0, y + h / 2 - h, 0), H.box(w * 2.04, 0.02 * s, w * 2.04, 0.004).at(0, y - h * 0.5, 0).color(iron).pbr(0.5, 0.6));
      else {
        c.hard.push(F.metal(H.box(w * 2, 0.02 * s, w * 2, 0.004)).at(0, y - h, 0), F.metal(H.box(w * 2, 0.02 * s, w * 2, 0.004)).at(0, y, 0));
        for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = w * 1.35, x = clamp(Math.cos(a) * r, -w, w), z = clamp(Math.sin(a) * r, -w, w); c.hard.push(H.cyl(0.006 * s, 0.006 * s, h, 6).at(x, y - h / 2, z).color(iron).pbr(0.5, 0.7)); }
      }
    }
    nodes.push(c);
    an.cargo = [at[0], at[1] - 0.3 * s, at[2]];
  }
  return { nodes, anchors: an };
}
