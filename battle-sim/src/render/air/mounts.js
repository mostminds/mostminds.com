// Flying mounts: every mountType a rider can take into the air, and the same beasts flying alone.
//
//   mountDesc(def, o, L, { riderless, crew }) -> { desc, k, seat: { node, at }, belly: { node, at }, width } | null
//
// Each beast is one of the game's sculpted monsters (src/render/bodies: the eagle, raven and phoenix, the bat, the
// dragon, the manticore, the sphinx, the pterosaur, the carrion-fly, the gargoyle, the clockwork owl, the swan) or a
// sky-beast of src/render/sky/creatures.js (the feathered serpent, the dusk-moth), adjusted where the kind needs it
// (forelegs dropped for the wyvern, eagle wings on the sphinx, a bald head on the vulture, a woman's head on the harpy,
// stripes on the wasp, wing-cases on the beetle), saddled, and with the rider seated on it. The rider is the unit
// itself: a humanoid() in its riding pose, its nodes grafted onto the beast's trunk with their rig keys renamed
// (torso -> rtorso, arms -> rarms ...) so the beast keeps its own keys and its own animator, and air/anim.js poses
// the rider on top. Beasts that bring their own seat (fly, swan, carpet, the griffon family and pegasus) are handed
// the rider descriptor instead.
//
// Every description is authored at the beast's own size with the rider shrunk by 1/k; the model is assembled at
// scale k, so the rider is a soldier's size and the beast's animator (which scales its moves by inner.scale) still fits.
import { S, H, rgb } from '../sculpt.js';
import { BODIES } from '../registry.js';
import { humanoid } from '../bodies/humanoid.js';
import { proportions } from '../bodies/anatomy.js';
import { creatureSpec } from '../sky/creatures.js';
import {
  add3, sub3, mul3, lerp, clamp, flat, num, mix, tone, node, byName, worldOf, scaleNode, subtree, drop, graft, surfHit, recolor, finishes,
} from './kit.js';

// mountType -> how it is made. body: a BODIES key; o(L, spec): its options; k: assembled scale; seatZ: saddle along the
// trunk (trunk space); native: the body seats the rider itself (o gets `rider`); howdah: a little castle instead of a saddle.
const T = {
  eagle: { body: 'bird', o: (L) => ({ kind: 'eagle', color: L.mount }), k: 1.55, seatZ: 0.06 },
  roc: { body: 'bird', o: (L) => ({ kind: 'eagle', color: tone(L.mount, -0.06) }), k: 2.3, seatZ: 0.04, howdah: true },
  vulture: { body: 'bird', o: (L) => ({ kind: 'eagle', color: mix(L.mount, 0x3a3028, 0.6) }), k: 1.6, seatZ: 0.04, bald: true },
  crow: { body: 'bird', o: (L) => ({ kind: 'raven', color: mix(L.mount, 0x14141a, 0.75) }), k: 1.6, seatZ: 0.06 },
  phoenix: { body: 'bird', o: (L) => ({ kind: 'phoenix', color: L.mount, glow: L.glow }), k: 1.55, seatZ: 0.06 },
  harpy: { body: 'bird', o: (L) => ({ kind: 'eagle', color: mix(L.mount, 0x4a3a40, 0.5) }), k: 1.5, seatZ: 0.04, harpy: true },
  swan: { body: 'swanRider', o: (L) => ({ plumage: mix(L.mount, 0xf0f0ec, 0.7) }), native: true, k: 1.2 },
  bat: { body: 'bat', o: (L) => ({ fur: L.mount }), k: 1.6, seatZ: 0.0 },
  wyvern: { body: 'dragon', o: (L) => ({ scales: L.mount, scale: 1.3 }), k: 1.05, seatZ: 0.0, hindOnly: true, idK: 'drake' },
  drake: { body: 'dragon', o: (L) => ({ scales: L.mount, scale: 1.3 }), k: 1.0, seatZ: 0.0, idK: 'drake' },
  pterosaur: { body: 'saurian', o: (L) => ({ kind: 'pterosaur', skin: L.mount, trim: L.accent }), k: 1.6, seatZ: 0.04 },
  manticore: { body: 'manticore', o: (L) => ({ fur: L.mount, trim: L.trim }), k: 1.0, seatZ: 0.0 },
  sphinx: { body: 'sphinx', o: (L) => ({ stone: mix(L.mount, 0xe8d8b0, 0.4), trim: L.trim, accent: L.accent }), k: 1.05, seatZ: -0.12, wings: true },
  gargoyle: { body: 'golem', o: (L) => ({ wings: true, stone: mix(L.mount, 0x8a8a88, 0.6) }), k: 1.55, seatZ: -0.06, seatAt: [0, 0.3, -0.24] },
  fly: { body: 'carrionFly', o: (L) => ({ body2: L.mount, wing: 0xb8c0a0 }), native: true, k: 1.25 },
  wasp: { body: 'carrionFly', o: (L) => ({ body2: mix(L.mount, 0xe8c030, 0.7), wing: 0xd8c890 }), native: true, k: 1.25, wasp: true },
  beetle: { body: 'carrionFly', o: (L) => ({ body2: mix(L.mount, 0x1a4a3a, 0.6), wing: 0xa8a080 }), native: true, k: 1.25, beetle: true },
  moth: { sky: 'moth', k: 1.5, seatZ: 0.0 },
  serpent: { sky: 'serpent', k: 1.15, seatZ: 0.1 },
  carpet: { body: 'carpet', o: (L) => ({ color: L.cloth, trim: L.trim }), native: true, k: 1.0 },
  disc: { disc: true, k: 1.0 },
  griffon: { body: 'rider', native: true, own: true, k: 1 },
  hippogriff: { body: 'rider', native: true, own: true, k: 1 },
  halfgriffon: { body: 'rider', native: true, own: true, k: 1 },
  pegasus: { body: 'rider', native: true, own: true, k: 1 },
  longma: { body: 'rider', native: true, own: true, k: 1 },
};
export const MOUNT_TYPES = Object.keys(T);
export const isMountType = (m) => !!T[m];

const RIDER_KEYS = new Set(['body', 'mountType', 'mount', 'wings', 'scale', 'alt', 'kind', 'style', 'bombs', 'torpedo', 'harpoon', 'rockets', 'cargo', 'crew', 'count']);
/** the rider's own humanoid descriptor out of the unit's model spec */
export function riderSpec(o) {
  const r = { body: 'humanoid' };
  for (const [k, v] of Object.entries(o)) if (!RIDER_KEYS.has(k)) r[k] = v;
  return r;
}

/** the trunk node of a body: the node named torso / body, or the one keyed body / torso */
function trunkOf(nodes) {
  return byName(nodes, 'torso') && !byName(nodes, 'torso').name.startsWith('r_') && (byName(nodes, 'torso').rig === 'torso' || byName(nodes, 'torso').rig === 'body') ? byName(nodes, 'torso')
    : nodes.find((n) => n.rig === 'body') || nodes.find((n) => n.rig === 'torso') || nodes[1] || nodes[0];
}

// ------------------------------------------------------------------------------------------------- the beasts
function skyDesc(kind, L) {
  const spec = creatureSpec({ sky: { creature: kind, look: { body: L.mount, wing: kind === 'moth' ? mix(L.cloth2, 0xe8b8d0, 0.4) : L.trim, belly: L.cloth2 } } }, { id: L.id, metal: L.metal, accent: L.accent });
  return spec ? spec.make() : null;
}
function discDesc(L) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const d = node('body', 'root', [0, 0.32, 0], { rig: 'body', detail: 1.1 });
  const R = 0.52, rim = L.grim ? 0x2a2a30 : L.metal;
  d.prims.push(F.metal(S.cyl(R, 0.07, 0.03), rim).bump(0.0015, 30, 'noise'));
  d.prims.push(S.ellipsoid(R * 0.86, 0.13, R * 0.86).at(0, -0.06, 0).color(L.grim ? 0x3a3038 : mix(L.metal, 0x5a4a3a, 0.4)).pbr(0.4, L.shine * 0.7).blend(0.04));
  d.prims.push(S.cone(0.16, 0.04, 0.16, 0.02).at(0, -0.2, 0).color(L.glow).glow(1.3).pbr(0.3).blend(0.03));
  d.prims.push(S.cyl(R * 0.9, 0.02, 0.005).at(0, 0.035, 0).color(L.accent).paint(0.004, 0.002));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    d.prims.push(S.box(0.06, 0.03, 0.03, 0.005).rot(0, -a * 57.3, 0).at(Math.cos(a) * R * 0.72, 0.036, Math.sin(a) * R * 0.72).color(L.glow).glow(0.9).paint(0.003, 0.003));
    d.hard.push(H.sphere(0.014, 8).at(Math.cos(a + 0.26) * R * 0.97, 0, Math.sin(a + 0.26) * R * 0.97).color(L.accent).pbr(0.3, 0.8).lod(1));
  }
  d.hard.push(H.torus(R, 0.022, 48, 8).rot(90, 0, 0).color(rim).pbr(0.3, L.shine));
  nodes.push(d);
  const g = node('glowRing', 'body', [0, -0.12, 0], { rig: 'spin', detail: 0.9 });
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; g.hard.push(H.sphere(0.04, 10).at(Math.cos(a) * 0.3, -0.06, Math.sin(a) * 0.3).color(L.glow).glow(1.6)); }
  g.hard.push(H.torus(0.3, 0.008, 36, 4).rot(90, 0, 0).at(0, -0.06, 0).color(L.glow).glow(1.2));
  nodes.push(g);
  return { kind: 'air.disc', attack: 'swing', nodes };
}

/** a woman's head, hair and jaw-less, in place of the eagle's head (the harpy) */
function harpyHead(nodes, L) {
  const hd = humanoid({ id: 'harpyhead' }, { species: 'harpy', outfit: 'none', skin: mix(L.skin, 0xc8b0a8, 0.4), cloth: L.cloth, hair: 0x2a1a1a, female: true }).nodes;
  const head = byName(nodes, 'head');
  if (!head) return nodes;
  const at = add3(worldOf(nodes, 'head'), [0, -0.05, -0.02]);
  const out = drop(nodes, ['head']);
  graft(out, hd, 'head', 'neck', add3(at, [0, 0.03, 0.02]), 0.9, 'h_', (r) => (r === 'head' ? 'head' : 'h' + r), 1.1);
  return out;
}

/** the beast's own description and how to make it: { desc, k, native, cfg } */
function beastDesc(def, mt, o, L, rider) {
  const cfg = T[mt];
  if (!cfg) return null;
  let desc = null;
  const did = { id: `air_${mt}_${cfg.idK || ''}` };
  if (cfg.idK) did.id = cfg.idK;
  if (cfg.disc) desc = discDesc(L);
  else if (cfg.sky) desc = skyDesc(cfg.sky, L);
  else if (cfg.own) desc = BODIES.rider(def, { ...(rider || {}), ...o, mountType: mt, mount: L.mount, wings: mt !== 'halfgriffon' });
  else if (BODIES[cfg.body]) desc = BODIES[cfg.body](did, { ...cfg.o(L), ...(cfg.native && rider ? { rider } : {}) });
  if (!desc) return null;
  let nodes = desc.nodes;
  if (cfg.hindOnly) {
    nodes = drop(nodes, ['legFL', 'legFR']);
    for (const n of nodes) if (n.rig === 'legs' || n.rig === 'shins') n.rig = 'h' + n.rig;   // the hind legs trail, not clutch forward
  }
  if (cfg.wings && !nodes.some((n) => n.rig === 'wings')) {
    const bd = BODIES.bird({ id: 'airwing' }, { kind: 'eagle', color: mix(L.mount, 0x8a6a40, 0.3) }).nodes;
    const tw = worldOf(nodes, trunkOf(nodes).name);
    graft(nodes, bd, 'wingL', trunkOf(nodes).name, add3(tw, [0.15, 0.3, 0.1]), 1.4);
    graft(nodes, bd, 'wingR', trunkOf(nodes).name, add3(tw, [-0.15, 0.3, 0.1]), 1.4);
    desc.foldWings = true;
  }
  if (cfg.bald) {
    const skin = rgb(0xc89a8a);
    for (const n of nodes) if (n.name === 'head' || n.name === 'neck') for (const p of flat(n.prims)) if (p.hasCol && p.col[0] > 0.5 && p.col[1] > 0.5 && p.col[2] > 0.5) { p.col = skin.slice(); p.bAmp = 0.004; p.bKind = 4; }
  }
  if (cfg.harpy) nodes = harpyHead(nodes, L);
  if (cfg.wasp || cfg.beetle) {
    const ab = byName(nodes, 'abdomen');
    if (ab) {
      const box = ab.prims.length ? ab.prims : null;
      if (cfg.wasp && box) for (let i = 0; i < 5; i++) ab.prims.push(S.box(0.8, 0.8, 0.035, 0.004).at(0, 0, -0.1 - i * 0.075).color(0x141210).paint(0.008, 0.001));
      if (cfg.beetle) for (const sx of [1, -1]) ab.prims.push(S.ellipsoid(0.13, 0.08, 0.3).rot(-8, sx * 6, sx * -10).at(sx * 0.08, 0.1, -0.16).color(mix(L.mount, 0x1a5a4a, 0.5)).pbr(0.18, 0.55).bump(0.0015, 40, 'noise').blend(0.012));
    }
  }
  desc.nodes = nodes;
  return { desc, cfg };
}

// ------------------------------------------------------------------------------------------------- saddle, rider
/** the saddle (or howdah) on the trunk at `seat` (trunk space), sized for a rider of scale f, girth round the barrel */
function saddleNodes(trunk, seat, f, L, cfg, hw, belly) {
  const F = finishes(L), out = [];
  const sd = node('saddle', trunk.name, seat, { detail: 1.05 / Math.max(0.4, f) * 0.85 });
  const q = (v) => v * f;
  if (cfg.howdah) {
    // a little castle: a planked floor, rails, corner posts and a roof in the realm's manner
    const w = q(0.36), d = q(0.44);
    sd.prims.push(F.cloth(S.ellipsoid(w * 1.2, q(0.05), d * 1.15)).at(0, q(-0.02), 0));
    sd.hard.push(F.wood(H.box(w * 2, q(0.05), d * 2, 0.008)).at(0, q(0.04), 0));
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      sd.hard.push(F.wood(H.cyl(q(0.022), q(0.026), q(0.62), 10)).at(x * w, q(0.34), z * d));
      sd.hard.push(F.metal(H.sphere(q(0.03), 10)).at(x * w, q(0.66), z * d));
    }
    for (const y of [0.18, 0.32]) {
      for (const sx of [1, -1]) sd.hard.push(F.wood(H.box(q(0.025), q(0.03), d * 2, 0.004)).at(sx * w, q(y), 0));
      for (const sz of [1, -1]) sd.hard.push(F.wood(H.box(w * 2, q(0.03), q(0.025), 0.004)).at(0, q(y), sz * d));
    }
    const roofY = q(0.66);
    if (L.roof === 'pagoda' || L.roof === 'tent' || L.roof === 'spire') sd.hard.push(H.cone(Math.max(w, d) * 1.45, q(L.roof === 'spire' ? 0.5 : 0.3), 4).rot(0, 45, 0).at(0, roofY + q(L.roof === 'spire' ? 0.25 : 0.15), 0).color(L.cloth).pbr(0.85));
    else if (L.roof === 'dome' || L.roof === 'onion') sd.prims.push(S.ellipsoid(w * 1.1, q(0.22), d * 1.05).at(0, roofY + q(0.04), 0).color(L.cloth).pbr(0.6).bump(0.002, 30, 'ridges'));
    else sd.hard.push(H.sheet(w * 2.4, d * 2.3, 6, 6, (u, v) => [0, 0, -Math.sin(u * Math.PI) * q(0.06)]).rot(-90, 0, 0).at(0, roofY + q(0.04), 0).color(L.cloth).pbr(0.85).shade((x, y) => (Math.abs(x) > w * 1.05 ? rgb(L.trim) : null)));
    sd.hard.push(F.metal(H.cone(q(0.04), q(0.16), 8)).at(0, roofY + q(0.38), 0));
  } else {
    // pad, seat, pommel and cantle, studs, a breast collar and the stirrups
    sd.prims.push(F.cloth(S.ellipsoid(q(0.2), q(0.03), q(0.26))).at(0, q(-0.005), q(-0.01)));
    sd.prims.push(S.ellipsoid(q(0.205), q(0.012), q(0.265)).at(0, q(-0.004), q(-0.01)).color(L.trim).pbr(0.4, 0.6).paint(0.004, 0.002));
    sd.prims.push(F.cloth(S.ellipsoid(q(0.19), q(0.032), q(0.25)), L.cloth).at(0, q(0.0), q(-0.01)).blend(0.005));
    sd.prims.push(F.leather(S.ellipsoid(q(0.12), q(0.04), q(0.16))).at(0, q(0.03), 0).blend(0.01));
    sd.prims.push(F.leather(S.capsule([0, q(0.04), q(0.13)], [0, q(0.1), q(0.15)], q(0.035), q(0.025))).blend(0.02));
    sd.prims.push(F.leather(S.ellipsoid(q(0.11), q(0.05), q(0.035))).rot(-20, 0, 0).at(0, q(0.08), q(-0.14)).blend(0.02));
    sd.hard.push(F.metal(H.sphere(q(0.022), 12)).at(0, q(0.11), q(0.155)));
    for (let i = 0; i < 6; i++) { const a = -0.9 + (i / 5) * 1.8; sd.hard.push(F.metal(H.sphere(q(0.008), 6)).at(Math.sin(a) * q(0.11), q(0.05), Math.cos(a) * q(0.15)).lod(1)); }
    for (const sx of [1, -1]) {
      const st = [sx * q(0.17), q(-0.33), q(0.05)];
      sd.hard.push(H.tube([[sx * q(0.1), q(0.03), q(0.0)], [sx * q(0.16), q(-0.15), q(0.03)], st], q(0.008), 10, 4).color(0x3a2616).pbr(0.7));
      sd.hard.push(H.torus(q(0.04), q(0.007), 16, 6).at(st[0], st[1] - q(0.03), st[2]).color(L.metal).pbr(0.35, L.shine));
    }
    // caparison: a cloth either flank in the realm's colours, trimmed, swallow-cut
    for (const sx of [1, -1]) {
      sd.hard.push(H.sheet(q(0.36), q(0.2), 10, 6, (u, v) => [0, 0, Math.sin(u * 7) * q(0.006)]).rot(0, sx * 90, 0).rot(0, 0, sx * -12).at(sx * (hw + q(0.01)), q(-0.1), q(-0.02))
        .color(L.cloth).pbr(0.85).shade((x, y) => (y < q(-0.065) ? rgb(L.trim) : Math.abs(x) < q(0.04) && Math.abs(y) < q(0.04) ? rgb(L.cloth2) : null)).lod(2));
    }
  }
  // the girth: a strap round the barrel under the seat
  if (hw > 0 && belly) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push([Math.sin(a) * (hw + q(0.015)), lerp(0, belly - seat[1], (1 - Math.cos(a)) / 2) + q(0.01), 0]); }
    sd.hard.push(H.tube(pts, q(0.012), 36, 5, true).color(0x3a2616).pbr(0.7).near());
  }
  out.push(sd);
  return out;
}

/** humanoid rider nodes seated with its hip at `seat` (trunk space), scaled by f, rig keys renamed r<key> */
function riderNodes(def, ro, trunkName, seat, f, standing = false) {
  const desc = humanoid(def, { ...ro, pose: standing ? undefined : 'riding' });
  const P = proportions(ro);
  const out = [];
  for (const n of desc.nodes) {
    const c = { ...n, name: n.name === 'root' ? 'rider' : `r_${n.name}` };
    if (n.name === 'root') { c.parent = trunkName; c.pos = sub3(seat, [0, standing ? 0 : P.hipY * f, 0]); c.rig = 'riderRoot'; }
    else { c.parent = n.parent === 'root' ? 'rider' : `r_${n.parent}`; c.pos = mul3(n.pos || [0, 0, 0], f); if (c.rig) c.rig = 'r' + c.rig; }
    scaleNode(c, f, 1 / f);
    out.push(c);
  }
  return { nodes: out, attack: desc.attack, hold: desc.hold || 'none', height: P.height };
}

/**
 * The full description of a flying mount (with its rider unless riderless), the role props, and where crew sit.
 * Returns { desc, k, trunk, seat, belly, hw } or null when the mountType is unknown.
 */
export function mountDesc(def, o, L, opts = {}) {
  const mt = o.mountType || o.kind;
  const cfg0 = T[mt];
  if (!cfg0) return null;
  const riderless = !!opts.riderless;
  const ro = riderless ? null : riderSpec(o);
  const made = beastDesc(def, mt, o, L, cfg0.native ? ro : null);
  if (!made) return null;
  const { desc, cfg } = made;
  let nodes = desc.nodes;
  const k = cfg.k * (opts.scale || 1);
  // a riderless own-seat beast (pegasus, griffon...): its rider dropped
  if (riderless && cfg.native) nodes = drop(nodes, (n) => n.name === 'rider' || n.name.startsWith('r_') || n.rig === 'seat');
  // the beast a notch coarser than a soldier per unit of size (it is big, and seen from the air): keeps a ridden
  // flier near two ground units' triangle budget
  for (const n of nodes) n.detail = (n.detail ?? 1) * (cfg.dk ?? (cfg.idK === 'drake' ? 0.68 : 0.8));
  const trunk = trunkOf(nodes);
  const zs = cfg.seatZ ?? 0;
  let seat = null, belly = null, hw = 0;
  if (trunk && flat(trunk.prims).length) {
    const top = surfHit(trunk.prims, [0, 2, zs], [0, -1, 0]);
    const bot = surfHit(trunk.prims, [0, -2, zs], [0, 1, 0]);
    const side = surfHit(trunk.prims, [2, (top[1] + bot[1]) / 2, zs], [-1, 0, 0]);
    seat = [0, top[1], zs]; belly = bot[1]; hw = Math.abs(side[0]);
    if (cfg.seatAt) seat = cfg.seatAt.slice();
  } else if (trunk) { seat = [0, 0.1, 0]; belly = -0.1; hw = 0.2; }
  const out = { desc, k, trunk: trunk?.name, seat, belly: [0, belly ?? 0, zs], hw, native: !!cfg.native, cfg };
  out.mountKind = desc.kind;
  desc.mountKind = desc.kind; desc.kind = 'air.mount';
  if (!cfg.native && trunk && seat) {
    const f = 1 / k;
    if (!riderless || opts.saddle) nodes.push(...saddleNodes(trunk, [seat[0], seat[1] + (cfg.seatUp || 0), seat[2]], f, L, cfg, hw, belly));
    if (!riderless) {
      const standing = !!cfg.disc;
      const hipAt = cfg.howdah ? [0, seat[1] + 0.06 * f + 0.5 * f * 0.5, seat[2]] : [0, seat[1] + (cfg.seatUp || 0) + 0.045 * f, seat[2]];
      if (standing) hipAt[1] = seat[1] + 0.035;
      const R = riderNodes(def, ro, trunk.name, hipAt, f, standing || cfg.howdah);
      if (cfg.howdah) R.nodes[0].pos = [0, seat[1] + 0.065 * f, seat[2]];
      nodes.push(...R.nodes);
      desc.rattack = R.attack; desc.rhold = R.hold; desc.attack = R.attack;
      if (standing || cfg.howdah) desc.rstand = true;
    }
  }
  desc.nodes = nodes;
  out.desc = desc;
  return out;
}
