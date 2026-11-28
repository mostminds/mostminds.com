// The sky-beasts' bodies, sculpted: each creature is the realm's own ground-unit monster (the sculpted dragon,
// eagle, raven, bat, manticore, sphinx, blood-fiend, carrion-fly and griffon of src/render/bodies) built through the
// sculpt pipeline and scaled up to sky size, or, where no such beast walks the field (the feathered sky-serpent and
// the dusk-moth), a body authored here in the same prim vocabulary with parts grafted from those monsters (the
// dragon's head, the eagle's wings). Wings missing on a monster (the sphinx) are grafted from the eagle.
//
//   creatureSpec(def)  -> null | { key, desc: () => description, seatU, pilot, ... }
//   creatureTemplate(spec) -> the assembled template (cached by key; clones share geometry)
//   seatedPilot(realm) -> per-level geometries of the realm's ground soldier, seated astride (cached)
//
// Ground monsters face +Z with feet on y = 0; beasts.js turns them to face +X and scales them up.
import * as THREE from 'three';
import { S, H, rgb } from '../sculpt.js';
import { assemble, bakePose, getDetail, setDetail } from '../rigkit.js';
import { BODIES } from '../registry.js';
import { buildUnitModel } from '../models.js';
import { UNITS } from '../../data/units.js';

const lerp = (a, b, t) => a + (b - a) * t;
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => mul3(a, 1 / (len3(a) || 1e-9));
const flat = (x) => [x].flat(Infinity).filter(Boolean);
const _c = new THREE.Color(), _c2 = new THREE.Color();
const mix = (a, b, t) => _c.set(a).lerp(_c2.set(b), t).getHex();
const tone = (hex, dl) => { _c.set(hex); const hsl = {}; _c.getHSL(hsl); _c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + dl))); return _c.getHex(); };

// ---------------------------------------------------------------------------------------------
// the realm's people: the first foot soldier of its roster (a man, an elf, a rat, a skeleton ...)
// ---------------------------------------------------------------------------------------------
const FOOT = new Set(['humanoid', 'skeleton', 'naga']);
export function realmUnit(realm) {
  let best = null;
  for (const [id, u] of Object.entries(UNITS)) {
    if (!(u.faction === realm || id.startsWith(realm + '_'))) continue;
    if (!u.model || !FOOT.has(u.model.body || 'humanoid')) continue;
    if ((u.size || 1) > 1 || (u.model.scale || 1) > 1.15) continue;
    best = { id, ...u, size: u.size || 1 };
    break;
  }
  return best || { id: 'footman', ...UNITS.footman, size: 1 };
}

// ---------------------------------------------------------------------------------------------
// grafting: move finished nodes of one description onto another
// ---------------------------------------------------------------------------------------------
function worldOf(nodes, name) {
  let p = [0, 0, 0];
  for (let n = nodes.find((x) => x.name === name); n; n = n.parent ? nodes.find((x) => x.name === n.parent) : null) p = add3(p, n.pos || [0, 0, 0]);
  return p;
}
function scaleNode(n, k) {
  for (const p of flat(n.prims)) p.scale(k);
  for (const h of flat(n.hard)) h.scale(k);
  n.detail = (n.detail ?? 1) / k; if (n.minRes) n.minRes /= k;
}
/** take donor's nodes `names` (a root of that subtree first), re-hang the first under `parent` at `at` (target world), scale k */
function graft(target, donor, names, parent, at, k, prefix = '') {
  const pw = worldOf(target, parent);
  const out = [];
  names.forEach((nm, i) => {
    const n = donor.find((x) => x.name === nm);
    if (!n) return;
    const c = { ...n, name: prefix + n.name };
    scaleNode(c, k);
    if (i === 0) { c.parent = parent; c.pos = sub3(at, pw); } else { c.parent = prefix + n.parent; c.pos = mul3(n.pos || [0, 0, 0], k); }
    out.push(c);
  });
  target.push(...out);
  return out;
}
const drop = (nodes, names) => { const gone = new Set(names); return nodes.filter((n) => !gone.has(n.name) && !gone.has(n.parent)); };

// ---------------------------------------------------------------------------------------------
// creatures without a ground twin: the feathered sky-serpent and the dusk-moth, authored here
// ---------------------------------------------------------------------------------------------
function featherQuill(base, dir, len, w, colA, colB, up = [0, 1, 0]) {
  // a flat vane with a raised shaft, coloured root to tip
  const half = [[0, 0], [w * 0.55, len * 0.12], [w, len * 0.45], [w * 0.8, len * 0.8], [0, len]];
  const out = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x * 0.9, y])];
  const a = rgb(colA), b = rgb(colB);
  const vane = H.extrude(out, w * 0.08, 0).shade((x, y) => { const t = Math.max(0, Math.min(1, y / len)); const bar = Math.sin(t * 22) > 0.7 ? 0.82 : 1; return [lerp(a[0], b[0], t) * bar, lerp(a[1], b[1], t) * bar, lerp(a[2], b[2], t) * bar]; });
  // orient: +Y of the outline along dir, +Z (its face) toward `up`
  const d = norm3(dir), m = new THREE.Matrix4();
  const Y = new THREE.Vector3(...d), Zh = new THREE.Vector3(...up);
  const X = new THREE.Vector3().crossVectors(Y, Zh).normalize(), Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  m.makeBasis(X, Y, Z);
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  return vane.rot(e.x * 180 / Math.PI, e.y * 180 / Math.PI, e.z * 180 / Math.PI).at(...base).pbr(0.6);
}

function serpentDesc(def, L) {
  const body = L.body ?? 0x2a8a5a, wing = L.wing ?? 0xd8b03a, belly = L.belly ?? 0xe8d8a0;
  const back = tone(body, -0.08), mark = tone(body, -0.16);
  const sk = (q, c = body) => q.color(c).bump(0.0075, 26, 'scales').tint(0.14, 9).pbr(0.4, 0.05);
  const nodes = [{ name: 'root', pos: [0, 0, 0], prims: [], hard: [] }];
  // the forward trunk where the riders sit, then a chain of coils sweeping back in an S
  const pts = [[0, 0.62, 0.55], [0, 0.6, 0.0], [0, 0.6, -0.55]];
  const torso = { name: 'torso', parent: 'root', pos: [0, 0.6, 0], rig: 'torso', detail: 0.8, prims: [], hard: [] };
  const rel = (p) => sub3(p, [0, 0.6, 0]);
  torso.prims.push(...S.limb(pts.map(rel), [0.15, 0.17, 0.155]).map((q) => sk(q).blend(0.05)));
  nodes.push(torso);
  const dress = (n, a, b, ra, rb, i0) => {
    // belly scutes, dorsal saddle, cross-bands and a crest of quills along the spine
    const t = norm3(sub3(b, a));
    n.prims.push(S.capsule(add3(a, [0, ra * 0.45, 0]), add3(b, [0, rb * 0.45, 0]), ra * 0.66, rb * 0.66).color(back).paint(0.03));
    const ns = 4;
    for (let k = 0; k < ns; k++) {
      const f = (k + 0.5) / ns, c = add3(a, mul3(sub3(b, a), f)), r = lerp(ra, rb, f);
      n.prims.push(S.ellipsoid(r * 0.72, r * 0.32, len3(sub3(b, a)) / ns * 0.7).at(c[0], c[1] - r * 0.78, c[2]).color(k % 2 ? belly : mix(belly, body, 0.2)).pbr(0.55).tint(0.1, 30).blend(0.006));
      n.prims.push(S.torus(r * 0.93, 0.011).rot(90, 0, 0).at(...add3(c, [0, r * 0.25, 0])).color(mark).paint(0.012));
      if ((k + i0) % 2 === 0) {
        const up = [0, 1, -t[2] * 0.0];
        n.hard.push(featherQuill(add3(c, [0, r * 0.85, 0]), add3(up, mul3(t, -1.3)), r * 2.6, r * 0.45, wing, tone(wing, 0.12)).lod(2));
      }
    }
  };
  dress(torso, ...[pts[0], pts[2]].map(rel), 0.15, 0.155, 0);
  // neck rising to the head
  const N0 = [0, 0.62, 0.55], N1 = [0, 0.78, 0.82], N2 = [0, 0.92, 1.02];
  const neck = { name: 'neck', parent: 'torso', pos: sub3(N0, [0, 0.6, 0]), rig: 'neck', detail: 0.9, prims: [], hard: [] };
  neck.prims.push(...S.limb([[0, 0, 0], sub3(N1, N0), sub3(N2, N0)], [0.15, 0.125, 0.105]).map((q) => sk(q).blend(0.04)));
  dress(neck, [0, 0, 0], sub3(N2, N0), 0.14, 0.105, 1);
  nodes.push(neck);
  // the plumed ruff about the throat
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, d = [Math.cos(a), Math.sin(a) * 0.9 + 0.25, -0.55];
    neck.hard.push(featherQuill(add3(sub3(N2, N0), [Math.cos(a) * 0.08, Math.sin(a) * 0.08, -0.04]), d, 0.3, 0.06, i % 2 ? wing : belly, tone(wing, -0.1), [0, 0, 1]).lod(1));
  }
  // tail coils: an S in plan view, tapering to a fan of plumes
  const segs = 9, TL = [[0, 0.6, -0.55]];
  for (let i = 1; i <= segs; i++) TL.push([Math.sin(i * 0.75) * 0.22 * Math.min(1, i / 3), 0.6 - i * 0.012, -0.55 - i * 0.24]);
  let par = 'torso', parW = [0, 0.6, 0];
  for (let i = 0; i < segs; i++) {
    const a = TL[i], b = TL[i + 1], ra = lerp(0.155, 0.03, i / segs), rb = lerp(0.155, 0.03, (i + 1) / segs);
    const n = { name: `tail${i}`, parent: par, pos: sub3(a, parW), rig: 'tail', detail: 0.85, prims: [], hard: [] };
    const A = [0, 0, 0], Bp = sub3(b, a);
    n.prims.push(sk(S.capsule(A, Bp, ra, rb)));
    dress(n, A, Bp, ra, rb, i);
    if (i === segs - 1) for (let k = -3; k <= 3; k++) n.hard.push(featherQuill(Bp, [k * 0.25, 0.05, -1], 0.55 - Math.abs(k) * 0.05, 0.075, k % 2 ? wing : belly, tone(wing, 0.15), [0, 1, 0]));
    nodes.push(n); par = n.name; parW = a;
  }
  // the dragon's head and jaw, and the eagle's wings
  const dr = BODIES.dragon({ id: 'skyserpent' }, { scales: body, scale: 1.3 }).nodes;
  graft(nodes, dr, ['head', 'jaw'], 'neck', [0, 0.94, 1.05], 0.95);
  const bd = BODIES.bird({ id: 'skyserpentwing' }, { kind: 'eagle', color: wing }).nodes;
  graft(nodes, bd, ['wingL', 'wingtipL'], 'torso', [0.12, 0.74, 0.3], 1.35);
  graft(nodes, bd, ['wingR', 'wingtipR'], 'torso', [-0.12, 0.74, 0.3], 1.35);
  return { kind: 'dragon', attack: 'bite', nodes };
}

function mothDesc(def, L) {
  const body = L.body ?? 0x6a2a9a, wingC = L.wing ?? 0xe8b8d0, belly = L.belly ?? 0xd8b03a;
  const fur = (q, c = body) => q.color(c).bump(0.012, 30, 'fur').tint(0.2, 12).pbr(0.9);
  const nodes = [{ name: 'root', pos: [0, 0, 0], prims: [], hard: [] }];
  const T0 = [0, 0.6, 0];
  const torso = { name: 'torso', parent: 'root', pos: T0, rig: 'torso', detail: 0.9, prims: [], hard: [] };
  torso.prims.push(fur(S.ellipsoid(0.17, 0.17, 0.24).at(0, 0, 0.05)));
  torso.prims.push(fur(S.ellipsoid(0.2, 0.18, 0.12).at(0, 0.02, 0.24).blend(0.05), belly));           // the furred collar
  for (let i = 0; i < 6; i++) { // legs folded under, thin and jointed
    const sx = i % 2 ? -1 : 1, z = 0.18 - Math.floor(i / 2) * 0.12;
    torso.hard.push(H.tube([[sx * 0.08, -0.1, z], [sx * 0.2, -0.2, z + 0.03], [sx * 0.24, -0.36, z - 0.02], [sx * 0.22, -0.46, z + 0.04]], [0.022, 0.018, 0.012, 0.006], 12, 6).color(tone(body, -0.15)).pbr(0.5));
  }
  nodes.push(torso);
  // the abdomen: a ringed, furred cone (one tail node, so it sways)
  const ab = { name: 'tail0', parent: 'torso', pos: [0, -0.02, -0.15], rig: 'tail', detail: 0.9, prims: [], hard: [] };
  for (let i = 0; i < 6; i++) ab.prims.push(fur(S.ellipsoid(0.17 - i * 0.02, 0.16 - i * 0.02, 0.1).at(0, -i * 0.015, -0.05 - i * 0.12).blend(0.04), i % 2 ? body : tone(body, 0.06)));
  nodes.push(ab);
  // head: great dark eyes, plumed antennae, a coiled tongue
  const hd = { name: 'head', parent: 'torso', pos: [0, 0.03, 0.34], rig: 'head', detail: 1.3, prims: [], hard: [] };
  hd.prims.push(fur(S.ellipsoid(0.1, 0.1, 0.1)));
  for (const sx of [1, -1]) {
    hd.prims.push(S.ellipsoid(0.065, 0.075, 0.06).at(sx * 0.075, 0.02, 0.04).color(0x161018).pbr(0.15).bump(0.004, 60, 'scales').blend(0.01));
    const a0 = [sx * 0.04, 0.08, 0.06], a1 = [sx * 0.16, 0.3, 0.2], a2 = [sx * 0.3, 0.42, 0.28];
    hd.hard.push(H.tube([a0, a1, a2], [0.008, 0.006, 0.003], 10, 5).color(tone(body, -0.2)).pbr(0.6));
    for (let k = 1; k < 9; k++) {
      const t = k / 9, p = t < 0.5 ? add3(a0, mul3(sub3(a1, a0), t * 2)) : add3(a1, mul3(sub3(a2, a1), t * 2 - 1));
      for (const e of [1, -1]) hd.hard.push(H.tube([p, add3(p, [sx * 0.02, e * 0.035, -0.05 * (1 - t)])], [0.004, 0.0015], 2, 3).color(belly).pbr(0.7).lod(1));
    }
  }
  hd.hard.push(H.tube([[0, -0.08, 0.06], [0, -0.16, 0.1], [0, -0.18, 0.04], [0, -0.13, 0.02]], 0.008, 10, 5).color(tone(body, -0.2)).pbr(0.5));
  nodes.push(hd);
  nodes.push({ name: 'jaw', parent: 'head', pos: [0, -0.06, 0.06], rig: 'jaw', prims: [], hard: [] });
  // wings: fore and hind on their own joints, scaled sheets with eyespots and veins
  const cw = rgb(wingC), cb = rgb(belly), cd = rgb(tone(body, -0.1)), ce = rgb(0x120c10);
  // a sheet mapped into a wing outline: u along the span (+X), v chord (front +Z .. back -Z)
  const wingGeo = (span, front, backC, hind) => {
    const g = new THREE.PlaneGeometry(1, 1, 44, 20), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5;
      // the outline: narrow at the root, broadest past mid-span, a rounded tip
      const rnd = u < 0.68 ? 1 : Math.sqrt(Math.max(0.02, 1 - ((u - 0.68) / 0.33) ** 2));
      const sh = (hind ? 0.25 + 0.75 * Math.pow(Math.sin(Math.min(1, u) * Math.PI * 0.75), 0.6) : 0.3 + 0.7 * Math.pow(Math.sin(Math.min(1, u) * Math.PI * 0.62), 0.8)) * rnd;
      const fz = front * sh - (hind ? 0.1 : 0.02) * u, bz = -backC * sh - (hind ? 0.3 : 0.12) * u + 0.025 * Math.abs(Math.sin(u * 15)) * rnd;   // scalloped trailing edge
      p.setXYZ(i, u * span, 0.04 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI), lerp(bz, fz, v));
    }
    g.computeVertexNormals();
    return g;
  };
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const w = { name: `wing${nm}`, parent: 'torso', pos: [sx * 0.14, 0.08, 0.1], rig: 'wings', detail: 1, prims: [], hard: [] };
    const t = { name: `wingtip${nm}`, parent: `wing${nm}`, pos: [0, -0.02, -0.12], rig: 'wingtips', detail: 1, prims: [], hard: [] };
    const spot = (c, d, r, ring) => (d < r * 0.3 ? [0.05, 0.03, 0.04] : d < r * 0.42 ? [0.95, 0.92, 0.85] : d < r * 0.7 ? ring : d < r ? [c[0] * 0.25, c[1] * 0.2, c[2] * 0.25] : c);
    const lerpC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const fore = H.geo(wingGeo(1.25, 0.18, 0.35, false)).shade((x, y, z) => {
      const u = x / 1.25;
      let c = lerpC(cd, cw, Math.min(1, u * 2.2));
      c = lerpC(c, cb, 0.35 * Math.max(0, Math.sin(u * 9 + z * 6)) * (u > 0.25 ? 1 : 0));          // wavy cross-bands
      if (u > 0.86 || z < -0.33 * Math.sin(Math.min(1, u * 1.05) * Math.PI * 0.55) - 0.06) c = lerpC(c, cd, 0.7); // dark margin
      if (u > 0.88 && Math.abs(Math.sin(z * 40)) > 0.85) c = cb;                                     // pale dots along the margin
      c = spot(c, Math.hypot(u - 0.6, (z + 0.06) * 2.6), 0.17, cb);
      if (Math.abs(Math.sin(u * 16 + z * 5)) < 0.05 && u > 0.12) c = lerpC(c, cd, 0.4);            // veins
      return c;
    }).color(wingC).pbr(0.82);
    const hind = H.geo(wingGeo(0.9, 0.1, 0.4, true)).shade((x, y, z) => {
      const u = x / 0.9;
      let c = lerpC(cd, cb, Math.min(1, u * 1.8));
      if (u > 0.82) c = lerpC(c, cd, 0.6);
      return spot(c, Math.hypot(u - 0.52, (z + 0.26) * 2.4), 0.15, cw);
    }).color(belly).pbr(0.82);
    w.hard.push(sx > 0 ? fore : fore.mirrorX());
    t.hard.push(sx > 0 ? hind : hind.mirrorX());
    w.prims.push(fur(S.ellipsoid(0.12, 0.05, 0.12).at(sx * 0.06, 0, 0)));                         // fur at the wing root
    nodes.push(w, t);
  }
  return { kind: 'dragon', attack: 'bite', nodes };
}

// ---------------------------------------------------------------------------------------------
// which monster each sky creature is, coloured from the design's look
// ---------------------------------------------------------------------------------------------
function riderOf(realm, extra = {}) {
  const u = realmUnit(realm), m = u.model || {};
  return { body: 'humanoid', species: m.species, skin: m.skin, cloth: m.cloth, cloth2: m.cloth2, armor: m.armor, trim: m.trim, outfit: m.outfit, weapon: 'lance', ...extra };
}
/**
 * a ground body, or a description builder, for this design: { key, make() -> desc, seatU (0 tail .. 1 head along the
 * trunk), pilot (true: a pilot is seated here; false: the monster carries its own rider), wingsOwn (its animator
 * beats the wings), hindOnly (wyvern) }
 */
export function creatureSpec(def, ST) {
  const D = def.sky, L = D.look || {}, c = D.creature, realm = ST.id;
  const body = L.body ?? 0x6a5a40, wing = L.wing ?? 0x4a3a2a, belly = L.belly ?? 0xc8b890;
  const key = (o) => `${c}:${realm}:${JSON.stringify(o)}`;
  const B = (name, o, extra = {}) => ({ key: key({ name, o, ...extra.k }), make: () => BODIES[name] ? BODIES[name]({ id: `sky_${realm}_${c}` }, o) : null, seatU: 0.45, pilot: true, wingsOwn: true, ...extra });
  switch (c) {
    case 'dragon': return B('dragon', { scales: body, scale: 1.3 }, { seatU: 0.5, caparison: true });
    case 'wyvern': return B('dragon', { scales: body, scale: 1.3 }, { seatU: 0.5, hindOnly: true, caparison: true, k: { w: 1 } });
    case 'eagle': return B('bird', { kind: 'eagle', color: body }, { seatU: 0.42 });
    case 'roc': return B('bird', { kind: 'eagle', color: body }, { seatU: 0.42, k: { roc: 1 } });
    case 'crow': return B('bird', { kind: 'raven', color: body }, { seatU: 0.42 });
    case 'vulture': return B('bird', { kind: 'eagle', color: body }, { seatU: 0.42, bald: belly });
    case 'swan': case 'harpy': case 'pegasus': return B('bird', { kind: 'eagle', color: body }, { seatU: 0.42 });
    case 'bat': return B('bat', { fur: body, scale: 1 }, { seatU: 0.45 });
    case 'manticore': return B('manticore', { fur: body }, { seatU: 0.42, caparison: true });
    case 'sphinx': return B('sphinx', { stone: body, trim: ST.metal, accent: ST.accent }, { seatU: 0.4, wingsOwn: false, caparison: true, graftWings: { color: wing, at: [0.13, 0.86, 0.22], k: 1.35 } });
    case 'daemon': return B('bloodReaper', { skin: body, armor: ST.metal }, { seatU: 0.55, pitch: 1.15, unarmed: true });
    case 'fly': return B('carrionFly', { body2: body, wing, rider: riderOf(realm, { weapon: 'spear' }) }, { seatU: 0.35, pilot: false });
    case 'griffon': return B('rider', { ...riderOf(realm), mountType: 'griffon', mount: body, wings: true, outfit: 'skyKnight' }, { seatU: 0.3, pilot: false });
    case 'serpent': return { key: key({ s: 1, body, wing, belly }), make: () => serpentDesc(def, L), seatU: 0.55, pilot: true, wingsOwn: true, serpent: true };
    case 'moth': return { key: key({ m: 1, body, wing, belly }), make: () => mothDesc(def, L), seatU: 0.5, pilot: true, wingsOwn: true };
    default: return null;
  }
}

const TPL = new Map();
/** the assembled monster (cached), adjusted for the sky: forelegs dropped for the wyvern, wings grafted on the sphinx */
export function creatureTemplate(spec) {
  if (TPL.has(spec.key)) return TPL.get(spec.key);
  let tpl = null;
  const desc = spec.make();
  if (desc) {
    if (spec.unarmed) desc.nodes = drop(desc.nodes, desc.nodes.filter((n) => n.rig === 'weapon' || /shield|weapon/i.test(n.name)).map((n) => n.name));
    if (spec.hindOnly) {
      desc.nodes = drop(desc.nodes, ['legFL', 'legFR', 'shinFL', 'shinFR']);
      for (const n of desc.nodes) if (n.rig === 'legs' || n.rig === 'shins') n.rig = 'h' + n.rig;   // trail them behind, not clutch forward
    }
    if (spec.graftWings) {
      const g = spec.graftWings, bd = BODIES.bird({ id: 'skywing' }, { kind: 'eagle', color: g.color }).nodes;
      graft(desc.nodes, bd, ['wingL', 'wingtipL'], 'torso', g.at, g.k);
      graft(desc.nodes, bd, ['wingR', 'wingtipR'], 'torso', [-g.at[0], g.at[1], g.at[2]], g.k);
    }
    if (spec.bald) {
      // a vulture: the eagle's white head and neck turned to bare, wrinkled skin
      const skin = rgb(spec.bald);
      for (const n of desc.nodes) if (n.name === 'head' || n.name === 'neck') for (const p of flat(n.prims)) if (p.hasCol && p.col[0] > 0.6 && p.col[1] > 0.6 && p.col[2] > 0.6) { p.col = skin.slice(); p.bAmp = 0.004; p.bKind = 4; }
    }
    // a sky-beast is seen from further off than a soldier: one preset coarser keeps it near a ground unit's budget
    const was = getDetail(), coarser = { ultra: 'high', high: 'medium', medium: 'low', low: 'low' }[was] || was;
    setDetail(coarser);
    try { tpl = assemble(desc, 1); } finally { setDetail(was); }
  }
  TPL.set(spec.key, tpl);
  return tpl;
}

// ---------------------------------------------------------------------------------------------
// the pilot: the realm's own soldier, sculpted, seated astride with his hands forward on the reins
// ---------------------------------------------------------------------------------------------
const PILOT = new Map();
const EMPTY = new THREE.BufferGeometry();
EMPTY.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
/** { geos: [6 levels], height, hip: [x, y, z] } in the soldier's own space (facing +Z, feet down) */
export function seatedPilot(realm) {
  if (PILOT.has(realm)) return PILOT.get(realm);
  let out = null;
  try {
    const u = realmUnit(realm);
    const m = buildUnitModel(u);
    const rig = m.userData.rig;
    if (rig && m.userData.lod) {
      const R = (o, x = 0, y = 0, z = 0) => { if (!o) return; const r = o.userData.rest; if (r) o.rotation.set(r[0] + x, r[1] + y, r[2] + z); };
      const L = rig.legs || [], Sh = rig.shins || [], Ar = rig.arms || [], F = rig.forearms || [];
      L.forEach((l, i) => R(l, -1.35, 0, (i ? -1 : 1) * 0.32));
      Sh.forEach((s) => R(s, 1.35));
      Ar.forEach((a, i) => R(a, -0.75, 0, (i ? -1 : 1) * -0.1));
      F.forEach((f) => R(f, -0.7));
      m.updateMatrixWorld(true);
      const lv = m.userData.lod.meshes[0].geos.length;
      const g1 = bakePose(m, Math.min(1, lv - 1)), g2 = bakePose(m, Math.min(2, lv - 1)), g3 = bakePose(m, Math.min(3, lv - 1));
      const hipW = new THREE.Vector3(); (L[0] || m).getWorldPosition(hipW);
      const hipR = new THREE.Vector3(); (L[1] || L[0] || m).getWorldPosition(hipR);
      hipW.add(hipR).multiplyScalar(0.5);
      out = { geos: [g1, g2, g2, g3, g3, EMPTY], height: rig.height || 1, hip: [hipW.x, hipW.y, hipW.z] };
    }
  } catch (err) { console.warn('[sky] pilot failed', err); }
  PILOT.set(realm, out);
  return out;
}

const HAND = new Map();
/** the realm's soldier standing with both hands forward (at a ship's wheel): { geos: [6 levels], height } */
export function standingHand(realm) {
  if (HAND.has(realm)) return HAND.get(realm);
  let out = null;
  try {
    const m = buildUnitModel(realmUnit(realm)), rig = m.userData.rig;
    if (rig && m.userData.lod) {
      const R = (o, x = 0, y = 0, z = 0) => { if (!o) return; const r = o.userData.rest; if (r) o.rotation.set(r[0] + x, r[1] + y, r[2] + z); };
      (rig.arms || []).forEach((a, i) => R(a, -1.0, 0, (i ? -1 : 1) * -0.12));
      (rig.forearms || []).forEach((f) => R(f, -0.45));
      (rig.legs || []).forEach((l, i) => R(l, (i ? 0.12 : -0.12), 0, (i ? -1 : 1) * 0.06));
      m.updateMatrixWorld(true);
      const lv = m.userData.lod.meshes[0].geos.length;
      const g1 = bakePose(m, Math.min(1, lv - 1)), g2 = bakePose(m, Math.min(2, lv - 1)), g3 = bakePose(m, Math.min(3, lv - 1));
      out = { geos: [g1, g2, g2, g3, EMPTY, EMPTY], height: rig.height || 1 };
    }
  } catch (err) { console.warn('[sky] helmsman failed', err); }
  HAND.set(realm, out);
  return out;
}
