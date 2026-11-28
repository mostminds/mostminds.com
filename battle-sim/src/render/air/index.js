// Flying units: the models of every faction's aircraft (src/data/air), built from unit model specs.
//
//   isAirSpec(def)       true when buildUnitModel should hand this unit to buildAirModel
//   buildAirModel(def)   -> a rigged, LOD'd, animatable model (or null to fall back), for
//       { body: 'rider', mountType, outfit, weapon, ...palette }   a rider on a flying mount (air/mounts.js)
//       { body: 'flier' | 'dragon', kind, mount, ... }              a great beast flying alone (crew if o.rider / o.crew)
//       { body: 'aircraft', kind, style, ...palette }               a machine or conveyance (air/craft.js), crewed by
//                                                                   the faction's own soldiers, baked (air/kit.js)
//     Optional role props on any spec: { bombs: n, torpedo, harpoon, rockets: n, cargo: true | 'ladder' | 'cage' | 'crate' }.
//
// The model follows the unit contract (userData.rig / inner / lod, animateUnit, setLod, bakePose) and adds:
//   userData.actions[name](k, model), k 0..1 through the move (idempotent for a k; k >= 1 resets):
//     bomb      the bombs fall from the rack one by one and the nose dips
//     torpedo   the torpedo drops from its crutches
//     harpoon   the harpoon leaves the gun (the gun kicks)
//     strafe    a diving run: guns recoil, rockets leave their pods one by one
//     drop      the rope ladder / cage / crate is let down and hauled up again
//     breath    a beast rears and breathes (its jaws open, the neck whips forward)
//   userData.anchors { bombBay, torpedo, harpoon, rockets, cargo, muzzle, mouth, seat } in the model's own space
//   (unscaled, facing +Z) for the effects code.
// Templates are built once per spec (and detail preset) and cloned; crew figures are baked once per faction look.
import * as THREE from 'three';
import { assemble, cloneRigged, getDetail } from '../rigkit.js';
import { sculptMaterial } from '../sculpt.js';
import { registerAnimators } from '../animate.js';
import { BODIES } from '../registry.js';
import { animators } from './anim.js';
import { mountDesc, isMountType, riderSpec, MOUNT_TYPES } from './mounts.js';
import { CRAFT, balloonSpec } from './craft.js';
import { lookOf, crewFigure, crewUnit, roleProps, worldOf, byName, drop, recolor, mix, tone, num, add3, mul3, flat, node, useUnitBuilder } from './kit.js';

registerAnimators(animators);
export { useUnitBuilder, MOUNT_TYPES };
export const AIRCRAFT_KINDS = ['gyro', 'gyrobomber', 'glider', 'ornithopter', 'kite', 'balloon', 'dirigible', 'lantern', 'skiff', 'chariot', 'cage', 'pod', 'carpet', 'disc', 'construct', 'spirit', 'swarm'];
const OWN = new Set(['griffon', 'hippogriff', 'halfgriffon', 'pegasus', 'longma']);
const PROP_KEYS = ['bombs', 'torpedo', 'harpoon', 'rockets', 'cargo'];
const hasProps = (o) => PROP_KEYS.some((k) => o[k]);

/** should buildUnitModel route this unit here? */
export function isAirSpec(def) {
  const o = def && def.model;
  if (!o) return false;
  const airUnit = !!def.airRole || /_air_/.test(def.id || '') || hasProps(o);
  if (o.body === 'aircraft' || o.body === 'flier') return true;
  if (o.body === 'rider') return isMountType(o.mountType) && (!OWN.has(o.mountType) || airUnit);
  if (o.body === 'dragon') return (!!o.kind && o.kind !== 'dragon') || airUnit;
  return false;
}
const styleOfDef = (def, o) => o.style || def.faction || (def.id || '').split('_')[0] || 'kingdom';

// ------------------------------------------------------------------------------------------------- templates
const TPL = new Map();
const EMPTY_SLOTS = [];

/** where a role prop hangs and how big, from a mount description */
function mountPropsAt(m) { return m.trunk ? { parent: m.trunk, at: [0, m.belly[1] + 0.02, m.belly[2]], s: Math.max(0.6, (m.hw || 0.2) * 4.2), hw: m.hw || 0.2, bow: [0, m.seat ? m.seat[1] - 0.05 : 0, (m.belly[2] || 0) + (m.hw || 0.2) * 1.6] } : null; }

/** the crew a spec's faction sends: its soldier's descriptor in the spec's colours (a rider for carpets, discs, ghosts) */
function crewRider(style, o) {
  const u = crewUnit(style), m = { ...(u.model || { body: 'humanoid' }) };
  for (const k of ['skin', 'cloth', 'cloth2', 'armor', 'trim']) if (typeof o[k] === 'number' && m.body !== 'skeleton') m[k] = o[k];
  if (m.body === 'skeleton') { m.body = 'humanoid'; m.species = m.species || 'human'; m.skin = 0xd8cfb4; m.outfit = m.outfit || 'tatters'; }
  m.body = 'humanoid';
  return riderSpec(m);
}

/** add crew-slot nodes and role props to a description; returns the slots and the props' anchors */
function dress(desc, crew, props, o, L, k) {
  const slots = [];
  crew.forEach((c, i) => {
    if (!byName(desc.nodes, c.parent)) return;
    desc.nodes.push(node(`crewSlot${i}`, c.parent, c.at, { rig: 'crewSlots', rot: [0, c.yaw || 0, 0] }));
    slots.push({ pose: c.pose, s: (c.s || 1) / k });
  });
  let anchors = {};
  if (props && hasProps(o) && byName(desc.nodes, props.parent)) {
    const rp = roleProps(o, L, props.parent, props.at, props.s, { halfWidth: props.hw, bow: props.bow });
    desc.nodes.push(...rp.nodes);
    const pw = worldOf(desc.nodes, props.parent);
    for (const [key, v] of Object.entries(rp.anchors)) anchors[key] = mul3(add3(pw, v), k);
  }
  return { slots, anchors };
}
/** anchors any body offers: mouth (head), muzzle (gun), seat */
function bodyAnchors(desc, k, extra = {}) {
  const a = { ...extra };
  if (byName(desc.nodes, 'head')) a.mouth = mul3(add3(worldOf(desc.nodes, 'head'), [0, 0, 0.12]), k);
  else if (byName(desc.nodes, 'mhead')) a.mouth = mul3(add3(worldOf(desc.nodes, 'mhead'), [0, 0, 0.12]), k);
  if (byName(desc.nodes, 'gun')) a.muzzle = mul3(add3(worldOf(desc.nodes, 'gun'), [0, 0, 0.4]), k);
  return a;
}

/** a single assembled body (mount, beast or machine) with its crew slots: { tpl, slots, anchors, style, o } */
function single(desc, k, slots, anchors, L, o) {
  return { kind: 'single', tpl: assemble(desc, k), slots, anchors, style: L.id, o };
}

function riderTemplate(def, o, L) {
  const m = mountDesc(def, o, L);
  if (!m) return null;
  const { slots, anchors } = dress(m.desc, [], mountPropsAt(m), o, L, m.k);
  return single(m.desc, m.k, slots, bodyAnchors(m.desc, m.k, anchors), L, o);
}

function flierTemplate(def, o, L) {
  const kind = o.body === 'dragon' ? (o.kind && o.kind !== 'dragon' ? o.kind : 'dragon') : o.kind;
  const crewed = !!(o.rider || o.crew);
  let m;
  if (kind === 'dragon') {
    const desc = BODIES.dragon(def, { ...o, scales: o.scales ?? o.mount ?? L.mount });
    m = wrapBody(desc, num(o.scale, 1));
  } else {
    if (!isMountType(kind)) return null;
    m = mountDesc(def, { ...o, mountType: kind }, L, { riderless: true, saddle: crewed, scale: num(o.scale, 1) });
  }
  if (!m) return null;
  const crew = crewed && m.seat ? [{ parent: m.trunk, at: [0, m.seat[1] + 0.05 / m.k, m.seat[2]], pose: 'seat', s: 1 }] : [];
  if (crewed && m.seat && kind === 'dragon' && !byName(m.desc.nodes, 'saddle')) m.desc.nodes.push(...saddleFor(m, L));
  const { slots, anchors } = dress(m.desc, crew, mountPropsAt(m), o, L, m.k);
  return single(m.desc, m.k, slots, bodyAnchors(m.desc, m.k, anchors), L, o);
}
/** treat any body description as a mount (trunk, seat, belly) under the air.mount animator */
function wrapBody(desc, k) {
  const trunk = byName(desc.nodes, 'torso') || desc.nodes.find((n) => n.rig === 'body') || desc.nodes[1];
  const out = { desc, k, trunk: trunk?.name, seat: null, belly: [0, -0.1, 0], hw: 0.2 };
  if (trunk && flat(trunk.prims).length) {
    const sh = surfHitTop(trunk);
    out.seat = sh.seat; out.belly = sh.belly; out.hw = sh.hw;
  }
  desc.mountKind = desc.kind; desc.kind = 'air.mount';
  return out;
}
import { surfHit } from './kit.js';
function surfHitTop(trunk, z = 0) {
  const top = surfHit(trunk.prims, [0, 2, z], [0, -1, 0]), bot = surfHit(trunk.prims, [0, -2, z], [0, 1, 0]), side = surfHit(trunk.prims, [2, (top[1] + bot[1]) / 2, z], [-1, 0, 0]);
  return { seat: [0, top[1], z], belly: [0, bot[1], z], hw: Math.abs(side[0]) };
}
/** a plain saddle pad and girth for a crewed beast that has no rider of its own */
function saddleFor(m, L) {
  const f = 1 / m.k, n = node('saddle', m.trunk, m.seat, { detail: 1 / f * 0.8 });
  const { S } = SC;
  n.prims.push(S.ellipsoid(0.2 * f, 0.035 * f, 0.26 * f).color(L.cloth).bump(0.0018, 40, 'weave').pbr(0.88), S.ellipsoid(0.12 * f, 0.045 * f, 0.15 * f).at(0, 0.025 * f, 0).color(0x5a3a22).pbr(0.66).blend(0.01));
  return [n];
}
import * as SC from '../sculpt.js';

// ---------- machines and conveyances ----------
const PULLER = { aethel: 'pegasus', graal: 'pegasus', aurelia: 'griffon', tianlong: 'longma', khemet: 'sphinx', infernal: 'drake', dragons: 'drake', ashur: 'drake', malvash: 'drake', crimson: 'bat', undead: 'bat', kaelneth: 'bat', drowned: 'bat', velvet: 'pegasus', labyrinth: 'eagle', thousandgods: 'swan', nagavar: 'eagle', emerald: 'pterosaur', xibalba: 'pterosaur', caliphate: 'roc', goldsands: 'roc' };
const SWARM_OF = { crimson: 'bat', undead: 'bat', drowned: 'bat', kaelneth: 'bat', khemet: 'bat', morbus: 'wasp', skar: 'wasp', deeproot: 'wasp', verdant: 'wasp', baobab: 'wasp', screaming: 'harpy', beasts: 'harpy', labyrinth: 'harpy', ashhorde: 'crow', ironbound: 'crow', cloven: 'crow', kharnak: 'crow', mistisles: 'crow' };

function craftTemplate(def, o, L) {
  const kind = o.kind;
  const ro = () => crewRider(L.id, o);
  if (kind === 'carpet' || kind === 'disc') {
    const m = mountDesc(def, { ...ro(), mountType: kind, mount: L.cloth }, L);
    if (!m) return null;
    const { slots, anchors } = dress(m.desc, [], mountPropsAt(m), o, L, m.k);
    return single(m.desc, m.k, slots, bodyAnchors(m.desc, m.k, anchors), L, o);
  }
  if (kind === 'construct') {
    const stone = o.stone || L.grim || ['khemet', 'elemental', 'ashur', 'undead', 'cloven', 'gorge'].includes(L.id);
    let m;
    if (stone) m = mountDesc(def, { mountType: 'gargoyle', mount: num(o.mount, o.stone ? 0x8a8a88 : mix(L.metal, 0x6a6a68, 0.5)) }, { ...L, mount: num(o.mount, 0x8a8a88) }, { riderless: true, scale: 1.1 });
    else m = wrapBody(BODIES.mechOwl(def, { brass: o.gold ? 0xd8b03a : L.metal, glow: L.glow }), 1.6);
    if (!m) return null;
    const { slots, anchors } = dress(m.desc, [], mountPropsAt(m), o, L, m.k);
    return single(m.desc, m.k, slots, bodyAnchors(m.desc, m.k, anchors), L, o);
  }
  if (kind === 'spirit') {
    const ghost = num(o.glow, L.grim ? 0x8affd0 : mix(L.glow, 0xd8f0ff, 0.5));
    const m = mountDesc(def, { ...ro(), mountType: 'pegasus', mount: 0xd8e8f0, wings: true }, { ...L, mount: 0xd8e8f0 });
    if (!m) return null;
    m.desc.nodes = drop(m.desc.nodes, (n) => n.rig === 'paws');
    const g = SC.rgb(ghost);
    recolor(m.desc.nodes, (c) => { const l = (c[0] + c[1] + c[2]) / 3; return [g[0] * (0.35 + l * 0.9), g[1] * (0.35 + l * 0.9), g[2] * (0.35 + l * 0.9)]; }, 0.35);
    for (const n of m.desc.nodes) if (n.name === 'torso' || n.name === 'neck') n.hard.push(...wisps(ghost, n.name === 'torso'));
    const { slots, anchors } = dress(m.desc, [], mountPropsAt(m), o, L, m.k);
    return single(m.desc, m.k, slots, bodyAnchors(m.desc, m.k, anchors), L, o);
  }
  if (kind === 'balloon') {
    const b = balloonSpec(L);
    const desc = BODIES.balloon(def, b.o);
    desc.nodes = drop(desc.nodes, b.dropNodes);
    desc.mountKind = desc.kind; desc.kind = 'air.mount';
    const { slots, anchors } = dress(desc, b.crew, b.props, o, L, b.k);
    return single(desc, b.k, slots, bodyAnchors(desc, b.k, anchors), L, o);
  }
  if (kind === 'swarm') return swarmTemplate(def, o, L);
  const make = CRAFT[kind];
  if (!make) return null;
  const c = make(L, o);
  const oo = { ...(c.defaults || {}), ...o };
  const { slots, anchors } = dress(c.desc, c.crew, c.props, oo, L, c.k);
  const base = single(c.desc, c.k, slots, bodyAnchors(c.desc, c.k, anchors), L, oo);
  if (kind === 'chariot') {
    const pk = o.puller || PULLER[L.id] || 'pegasus';
    const pm = memberTemplate(def, pk, { ...L, mount: num(o.mount, pk === 'pegasus' ? 0xf0ece4 : L.mount) }, 1);
    if (pm) base.members = [-1, 1].map((sx) => ({ tpl: pm, at: [sx * 0.5, 0.12, 1.75], rotY: 0, phase: sx * 0.7 }));
  }
  return base;
}
function wisps(col, torso) {
  const { H } = SC, out = [];
  for (let i = 0; i < (torso ? 5 : 3); i++) out.push(H.tube([[0, -0.05, -0.1 + i * 0.05], [Math.sin(i * 2) * 0.08, -0.25, -0.3 - i * 0.04], [Math.sin(i * 3) * 0.14, -0.35, -0.6 - i * 0.05]], [0.05, 0.03, 0.004], 12, 6).color(col).glow(0.9).pbr(0.6).lod(2));
  return out;
}
/** a riderless beast template (puller, flock member): cached separately */
function memberTemplate(def, kind, L, scale) {
  const key = `member|${kind}|${L.id}|${L.mount}|${scale}|${getDetail()}`;
  if (TPL.has(key)) return TPL.get(key);
  let t = null;
  const m = mountDesc(def, { mountType: kind, mount: L.mount }, L, { riderless: true, saddle: kind !== 'wasp', scale });
  if (m) t = assemble(m.desc, m.k);
  TPL.set(key, t);
  return t;
}
function swarmTemplate(def, o, L) {
  const kind = o.of || SWARM_OF[L.id] || 'crow';
  const col = num(o.mount, kind === 'bat' ? 0x2a2224 : kind === 'crow' ? 0x16161a : kind === 'wasp' ? 0xe8c030 : mix(L.mount, 0x5a4a40, 0.5));
  const tpl = memberTemplate(def, kind, { ...L, mount: col }, kind === 'wasp' ? 0.38 : 0.34);
  if (!tpl) return null;
  const n = 7, members = [];
  for (let i = 0; i < n; i++) members.push({ tpl, orbit: { r: 0.45 + (i % 3) * 0.28, a0: (i / n) * Math.PI * 2, speed: (i % 2 ? 1 : -1) * (0.7 + (i % 3) * 0.2), y: 0.7 + (i % 4) * 0.22, dy: 0.08, zk: 0.8 }, phase: i * 1.37, rate: 1 + (i % 3) * 0.08 });
  return { kind: 'multi', members, slots: EMPTY_SLOTS, anchors: { cargo: [0, 0.5, 0], muzzle: [0, 0.9, 0.5] }, style: L.id, o, height: 1.5 };
}

function template(def) {
  const o = def.model;
  const style = styleOfDef(def, o);
  const key = `${JSON.stringify(o)}|${style}|${getDetail()}`;
  if (TPL.has(key)) return TPL.get(key);
  const L = lookOf(style, o);
  let t = null;
  if (o.body === 'rider') t = riderTemplate(def, o, L);
  else if (o.body === 'flier' || o.body === 'dragon') t = flierTemplate(def, o, L);
  else if (o.body === 'aircraft') t = craftTemplate(def, o, L);
  if (t) {
    // the crew figures, baked now so the first battle frame does not stall
    t.crew = t.slots.map((s) => crewFigure(L.id, o, s.pose === 'prone' ? 'stand' : s.pose));
  }
  TPL.set(key, t);
  return t;
}

// ------------------------------------------------------------------------------------------------- instances
const _v = new THREE.Vector3();
function attachCrew(model, t) {
  const rig = model.userData.rig, lod = model.userData.lod;
  (rig.crewSlots || []).forEach((g, i) => {
    const fig = t.crew && t.crew[i], slot = t.slots[i];
    if (!fig || !g) return;
    const mesh = new THREE.Mesh(fig.geos[Math.min(lod.level, fig.geos.length - 1)], sculptMaterial());
    mesh.castShadow = true; mesh.name = 'crew';
    const s = slot.s;
    mesh.scale.setScalar(s);
    if (slot.pose === 'seat') mesh.position.set(-fig.hip[0] * s, -fig.hip[1] * s, -fig.hip[2] * s);
    else if (slot.pose === 'prone') { mesh.rotation.x = Math.PI / 2; mesh.position.set(0, 0, -fig.hip[1] * s); }
    g.add(mesh);
    lod.meshes.push({ mesh, geos: fig.geos });
  });
}
function instance(t) {
  if (t.kind === 'multi' || t.members) return composite(t);
  const m = cloneRigged(t.tpl);
  attachCrew(m, t);
  return m;
}
/** a model made of several (a car and its team, a flock): one LOD table, the members animated by air.multi */
function composite(t) {
  const outer = new THREE.Group(), inner = new THREE.Group();
  outer.add(inner);
  const rig = { kind: 'air.multi', v2: true, attack: 'shoot', members: [] };
  const lod = { meshes: [], far: null, level: 0, levels: 2 };
  let height = t.height || 1;
  const adopt = (m) => {
    for (const e of m.userData.lod.meshes) lod.meshes.push(e);
    if (m.userData.lod.far) m.userData.lod.far.visible = false;
    lod.levels = Math.max(lod.levels, m.userData.lod.levels);
  };
  if (t.tpl) {
    const base = cloneRigged(t.tpl);
    attachCrew(base, t);
    inner.add(base); adopt(base);
    rig.members.push({ model: base, phase: 0, strikes: true });
    height = Math.max(height, base.userData.rig.height || 1);
    rig.act = base.userData.rig.act = {};
    rig.base = base;
  }
  for (const mm of t.members || []) {
    const c = cloneRigged(mm.tpl);
    if (mm.at) c.position.set(...mm.at);
    if (mm.rotY) c.rotation.y = mm.rotY;
    inner.add(c); adopt(c);
    rig.members.push({ model: c, phase: mm.phase || 0, rate: mm.rate, orbit: mm.orbit ? { ...mm.orbit } : null, strikes: !mm.orbit || true, flying: true });
  }
  rig.height = height;
  outer.userData = { rig, inner, lod };
  return outer;
}

/** a node of an instance by its rig key (single or list) */
const keyed = (rig, k) => (Array.isArray(rig[k]) ? rig[k] : rig[k] ? [rig[k]] : []);
function wireActions(model, t) {
  const rig = model.userData.rig, src = rig.base ? rig.base.userData.rig : rig;
  const act = rig.act || (rig.act = {});
  if (src !== rig) src.act = act;
  const bombs = keyed(src, 'bombs'), rockets = keyed(src, 'rockets'), torp = keyed(src, 'torpedo')[0], head = keyed(src, 'harpoonHead')[0], gun = keyed(src, 'harpoon')[0], cargo = keyed(src, 'cargo')[0];
  const live = (k) => k > 0 && k < 1;
  const A = {
    bomb: (k) => { act.bomb = live(k) ? k : 0; bombs.forEach((b, i) => { b.visible = !(live(k) && k > 0.12 + 0.6 * (i / Math.max(1, bombs.length))); }); },
    torpedo: (k) => { act.torpedo = live(k) ? k : 0; if (torp && torp.userData.rest) { torp.visible = !(live(k) && k > 0.35); torp.position.y = torp.userData.rest[4] - (live(k) ? Math.min(k, 0.35) * 0.3 : 0); } },
    harpoon: (k) => { act.harpoon = live(k) ? k : 0; if (head) head.visible = !(live(k) && k > 0.15); if (gun && gun.userData.rest) gun.rotation.x = gun.userData.rest[0] - (live(k) ? Math.sin(Math.min(1, k * 4) * Math.PI) * 0.25 : 0); },
    strafe: (k) => { act.strafe = live(k) ? k : 0; rockets.forEach((r, i) => { r.visible = !(live(k) && k > 0.2 + 0.5 * (i / Math.max(1, rockets.length))); }); },
    drop: (k) => { act.drop = live(k) ? k : 0; if (cargo && cargo.userData.rest) { const d = live(k) ? Math.sin(k * Math.PI) : 0; cargo.scale.y = 1 + d * (t.o.cargo === 'cage' || t.o.cargo === 'crate' ? 0 : 1.6); cargo.position.y = cargo.userData.rest[4] - d * (t.o.cargo === 'cage' || t.o.cargo === 'crate' ? 0.9 : 0); } },
    breath: (k) => { act.breath = live(k) ? k : 0; },
  };
  model.userData.actions = A;
  model.userData.anchors = { ...(t.anchors || {}) };
}

/** the flying unit's model, or null (buildUnitModel then falls back) */
export function buildAirModel(def) {
  const t = template(def);
  if (!t) return null;
  const m = instance(t);
  wireActions(m, t);
  m.userData.air = true;
  return m;
}
/** drop the cached templates (after the detail preset changes) */
export function resetAirCache() { TPL.clear(); }
