// War machines of the realms: engines of timber, iron and brass, and two that fly.
//
//   bodies.steamTank(def, o)     steam-driven armoured war engine          kind 'steamTank'     o: color, trim
//   bodies.wheelEngine(def, o)   two great spiked treadwheels and a cab    kind 'wheelEngine'   o: color, glow, trim
//   bodies.warWagon(def, o)      clockwork armoured wagon under a cone     kind 'warWagon'      o: color, trim
//   bodies.ironBull(def, o)      furnace-bellied bull; o.wings = a living  kind 'ironBull'      o: color, glow, trim, wings
//                                winged fire-bull
//   bodies.daemonEngine(def, o)  walking forge; o.legs 4 / 6 = a crawler   kind 'daemonEngine'  o: color, glow, trim, legs, arm ('cannon' | 'mortar')
//   bodies.balloon(def, o)       hot-air war balloon                       kind 'balloon'       o: color, trim, glow
//   bodies.carpet(def, o)        flying carpet with a seated rider         kind 'carpet'        o: color, trim, rider (a humanoid descriptor)
//
// Every builder also honours o.scale through rigkit.assemble (build in unscaled space) and ignores what it does not know.
//
// Rig keys beyond the stock ones (all lists): gun (recoiling barrels), funnel, smoke (puffs that rise and fade), turret is the
// stock single node, crew, cab, arcs (lightning that flickers), orbs, gears, crank, flames, vents, plates, envelope, gondola,
// racks, ropes, strips (the carpet's panels), tassels, seat.
//
// Authoring convention (as in monsters.js): a model is laid out in one space, its rest pose, Y up, facing +Z, on y = 0.
// Each node records the point it pivots about (`o`); finish() moves the node's pieces into its own space.
//
// Detail tiers: pieces marked L0 / L1 (rivets, fittings) show on the closest levels only; N() pieces on every level but
// the last; Fr() pieces are the plain stand-ins that make up the last level and the merged far mesh.
import * as THREE from 'three';
import { S, H, rgb, noise3 } from '../sculpt.js';
import { humanoid, poseCarried } from './humanoid.js';
import { proportions } from './anatomy.js';

const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const flat = (x) => [x].flat(Infinity).filter(Boolean);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const _c = new THREE.Color(), _c2 = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };
function tone(hex, dh = 0, ds = 0, dl = 0) {
  _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace);
  _c.setHSL(((_hsl.h + dh) % 1 + 1) % 1, clamp(_hsl.s + ds), clamp(_hsl.l + dl), THREE.SRGBColorSpace);
  return _c.getHex();
}
const mixHex = (a, b, t) => _c.set(a).lerp(_c2.set(b), t).getHex();

// ---------- placement ----------
const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler(), _vx = new THREE.Vector3(), _vy = new THREE.Vector3(), _vz = new THREE.Vector3();
function frameEuler(yDir, zHint = [0, 0, 1]) {
  _vy.set(yDir[0], yDir[1], yDir[2]).normalize();
  _vz.set(zHint[0], zHint[1], zHint[2]);
  _vx.crossVectors(_vy, _vz);
  if (_vx.lengthSq() < 1e-8) _vx.crossVectors(_vy, _vz.set(1, 0, 0));
  if (_vx.lengthSq() < 1e-8) _vx.crossVectors(_vy, _vz.set(0, 0, 1));
  _vx.normalize();
  _vz.crossVectors(_vx, _vy);
  _eu.setFromRotationMatrix(_m4.makeBasis(_vx, _vy, _vz), 'XYZ');
  return [_eu.x / DEG, _eu.y / DEG, _eu.z / DEG];
}
/** turn a piece built along +Y so +Y points along yDir (and +Z toward zHint), then move it to origin */
function orient(piece, origin, yDir, zHint) {
  const e = frameEuler(yDir, zHint);
  return piece.rot(e[0], e[1], e[2]).at(origin[0], origin[1], origin[2]);
}
const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

// ---------- plain pieces (cheap geometry: the kit's bevelled box costs 300 triangles) ----------
const box = (w, h, d) => H.geo(cached('box', () => new THREE.BoxGeometry(1, 1, 1))).scale(w, h, d);
const stud = (r) => H.geo(cached('stud', () => new THREE.SphereGeometry(1, 6, 4))).scale(r);
const ball = (r, seg = 10) => H.geo(cached(`ball${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(4, Math.round(seg * 0.6))))).scale(r);
/** cylinder from a to b */
const rod = (a, b, r, seg = 8, r2 = r) => { const L = len3(sub3(b, a)); return orient(H.cyl(r2, r, L, seg).at(0, L / 2, 0), a, sub3(b, a)); };
/** square timber from a to b */
const bar = (a, b, w, d = w, zHint) => { const L = len3(sub3(b, a)); return orient(box(w, L, d).at(0, L / 2, 0), a, sub3(b, a), zHint); };
/** cone from a toward dir */
const spikeAt = (a, dir, len, r, seg = 5) => orient(H.cone(r, len, seg).at(0, len / 2, 0), a, dir);
// tiers
const L0 = (x) => flat(x).map((p) => p.lod(0));
const L1 = (x) => flat(x).map((p) => p.lod(1));
const N = (x) => flat(x).map((p) => p.near());
const Fr = (x) => flat(x).map((p) => p.far());
/** the same shape twice: fine for the near levels, coarse for the far one. make(hi) -> piece(s) */
const NF = (make) => [...N(make(true)), ...Fr(make(false))];
const iron = (p, c = 0x4a4d54) => p.color(c).pbr(0.5, 0.85);
const brassy = (p, c = 0xc9a23a) => p.color(c).pbr(0.38, 0.9);
const wooden = (p, c = 0x6b4a2e) => p.color(c).pbr(0.85, 0);

// ---------- nodes ----------
function node(name, parent, o, extra = {}) { return { name, parent, o, prims: [], hard: [], ...extra }; }
function finish(nodes) {
  const by = new Map(nodes.map((n) => [n.name, n]));
  return nodes.map((n) => {
    const par = n.parent ? by.get(n.parent) : null;
    const pos = n.pos ?? (par ? sub3(n.o, par.o) : n.o);
    const prims = flat(n.prims), hard = flat(n.hard);
    if (n.o[0] || n.o[1] || n.o[2]) { for (const p of prims) p.at(-n.o[0], -n.o[1], -n.o[2]); for (const h of hard) h.at(-n.o[0], -n.o[1], -n.o[2]); }
    const out = { name: n.name, pos, prims, hard };
    if (n.parent) out.parent = n.parent;
    for (const k of ['rig', 'rot', 'detail', 'minRes']) if (n[k] !== undefined) out[k] = n[k];
    return out;
  });
}

// ---------- shared parts ----------
/** timber colour with grain along the piece's own Y */
const grain = (hex, seed = 0) => { const a = rgb(tone(hex, 0, 0, -0.1)), b = rgb(tone(hex, 0, 0, 0.05)); return (x, y, z) => mixRgb(a, b, clamp(0.2 + noise3(x * 50 + seed, y * 6, z * 50) * 1.1)); };
/** worn metal: blotches of a darker tone */
const worn = (hex, f = 14, amt = 0.16) => { const a = rgb(hex), b = rgb(tone(hex, 0.01, -0.05, -amt)); return (x, y, z) => mixRgb(a, b, clamp(noise3(x * f + 3, y * f, z * f + 7) * 1.5 - 0.3)); };

/**
 * A spoked wheel on the origin, axle along X. o: R, w (tread width), wood, iron, spokes, studs (count on the tyre),
 * spikes (length of iron spikes on the tread, 0 = none), hub
 */
function wheel(o) {
  const { R, w = 0.08, wood = 0x6b4a2e, ironC = 0x4a4d54, spokes = 8, hub = R * 0.2 } = o, out = [], fel = Math.max(0.035, R * 0.16);
  const ringP = (r0, r1, hw) => [[r0, -hw], [r1, -hw], [r1, hw], [r0, hw], [r0, -hw]];
  out.push(NF((hi) => wooden(H.lathe(ringP(R - fel, R - 0.012, w / 2), hi ? 28 : 10).rot(0, 0, 90), wood).shade(hi ? (x, y, z) => { const a = Math.atan2(z, x), f = (((a + Math.PI) / (Math.PI * 2)) * 6) % 1; return f < 0.04 || f > 0.96 ? rgb(tone(wood, 0, 0, -0.16)) : null; } : null)));
  out.push(NF((hi) => iron(H.lathe(ringP(R - 0.014, R, w / 2 + 0.006), hi ? 28 : 10).rot(0, 0, 90), ironC)));
  const sl = R - fel - hub * 0.6;
  for (let k = 0; k < spokes; k++) out.push(N(wooden(H.cyl(R * 0.045, R * 0.06, sl, 6).at(0, hub * 0.6 + sl / 2, 0).rot((k / spokes) * 360 + 11, 0, 0), k % 2 ? wood : tone(wood, 0, 0, -0.05))));
  for (let k = 0; k < 2; k++) out.push(Fr(wooden(box(R * 0.07, (R - fel) * 2, R * 0.09).rot(k * 90 + 11, 0, 0), wood)));
  out.push(NF((hi) => wooden(H.lathe([[0.001, -w * 0.8], [hub * 0.7, -w * 0.8], [hub, -w * 0.3], [hub, w * 0.3], [hub * 0.7, w * 0.8], [0.001, w * 0.8]], hi ? 12 : 6).rot(0, 0, 90), tone(wood, 0, 0, -0.08))));
  out.push(L1(iron(H.torus(hub * 0.9, hub * 0.14, 12, 5).rot(0, 90, 0).at(w * 0.55, 0, 0), ironC)), L1(iron(H.cyl(hub * 0.35, hub * 0.35, w * 0.3, 8).rot(0, 0, 90).at(w * 0.9, 0, 0), ironC)));
  const n = o.studs ?? Math.round(R * 44);
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; out.push(L0(stud(0.011).at(0, Math.cos(a) * R, Math.sin(a) * R).color(tone(ironC, 0, 0, 0.08)).pbr(0.4, 0.9))); }
  if (o.spikes) {
    const m = o.spikeN ?? 14;
    for (let k = 0; k < m; k++) { const a = (k / m) * Math.PI * 2, d = [0, Math.cos(a), Math.sin(a)]; out.push(N(spikeAt([0, d[1] * (R - 0.01), d[2] * (R - 0.01)], d, o.spikes, o.spikes * 0.3, 4).color(0x8a8f96).pbr(0.4, 0.9))); }
  }
  return out;
}
/** move a list of wheel pieces to a hub position, flipped for the right-hand side */
const placeWheel = (pieces, at, sd, turn = 0) => flat(pieces).map((q) => { const c = q.clone(); if (sd < 0) c.rot(0, 180, 0); return c.rot(turn, 0, 0).at(at[0], at[1], at[2]); });

/** a row of riveted plates on a flat face: origin o (lower corner), u and v unit directions, n the outward normal */
function plates(o, u, v, n, cols, rows, pw, ph, color, seed = 1, th = 0.012) {
  const out = [], r = rng(seed * 7919 + 11);
  const at = (a, b, c) => [o[0] + u[0] * a + v[0] * b + n[0] * c, o[1] + u[1] * a + v[1] * b + n[1] * c, o[2] + u[2] * a + v[2] * b + n[2] * c];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const c = tone(color, (r() - 0.5) * 0.02, (r() - 0.5) * 0.04, (r() - 0.5) * 0.07), lift = th * (0.5 + ((i + j) % 2) * 0.35);
    const e = frameEuler(v, n);
    out.push(N(box(pw * 0.97, ph * 0.97, th).rot(e[0], e[1], e[2]).at(...at((i + 0.5) * pw, (j + 0.5) * ph, lift)).color(c).pbr(0.55, 0.45)));
    for (const [a, b] of [[0.1, 0.12], [0.9, 0.12], [0.1, 0.88], [0.9, 0.88], [0.5, 0.12], [0.5, 0.88]]) out.push(L0(stud(Math.min(0.011, pw * 0.05)).at(...at((i + a) * pw, (j + b) * ph, lift + th * 0.6)).color(tone(color, 0, -0.03, 0.1)).pbr(0.4, 0.9)));
  }
  return out;
}
/** a puff of smoke or flame: lumpy ball on the origin */
function puff(r, color, glow = 0, seed = 0) {
  const g = cached(`puff${seed}`, () => {
    const geo = new THREE.SphereGeometry(1, 8, 6), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 0.78 + 0.5 * noise3(p.getX(i) * 1.7 + seed * 3.1, p.getY(i) * 1.7, p.getZ(i) * 1.7 + 5); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
    geo.computeVertexNormals();
    return geo;
  });
  const h = H.geo(g).scale(r).color(color).pbr(0.95, 0);
  if (glow) h.glow(glow);
  return h;
}
/** a tongue of flame along +Y from the origin */
function flame(len, r, hot, cool) {
  const a = rgb(mixHex(hot, 0xffc040, 0.35)), b = rgb(tone(cool, -0.01, 0.05, -0.1));
  return H.lathe([[0.001, 0], [r * 0.8, len * 0.12], [r, len * 0.3], [r * 0.6, len * 0.62], [r * 0.2, len * 0.88], [0.001, len]], 7).shade((x, y) => mixRgb(a, b, clamp(y / len) ** 0.8)).color(hot).pbr(0.9, 0).glow(0.95);
}
/** a small crewman from the waist up (soft sculpt): returns prims for a node whose origin is the waist */
function crewBust(at, o = {}) {
  const [x, y, z] = at, coat = o.coat ?? 0x7a2a22, skin = o.skin ?? 0xd9a77c, s = o.s ?? 1, hat = o.hat ?? 0x2a2622;
  const p = [
    S.capsule([x, y, z], [x, y + 0.13 * s, z], 0.062 * s, 0.07 * s).color(coat).pbr(0.85),
    S.sphere(0.05 * s).at(x, y + 0.235 * s, z + 0.004 * s).color(skin).pbr(0.7).blend(0.01),
    S.capsule([x, y + 0.2 * s, z + 0.045 * s], [x, y + 0.215 * s, z + 0.058 * s], 0.012 * s).color(skin).blend(0.01),
    S.capsule([x - 0.075 * s, y + 0.14 * s, z], [x - 0.1 * s, y + 0.03 * s, z + 0.05 * s], 0.026 * s, 0.022 * s).color(coat).blend(0.012),
    S.capsule([x + 0.075 * s, y + 0.14 * s, z], [x + 0.1 * s, y + 0.03 * s, z + 0.05 * s], 0.026 * s, 0.022 * s).color(coat).blend(0.012),
  ];
  const h = [];
  if (o.hat !== false) {
    h.push(H.lathe([[0.001, 0.05], [0.05, 0.035], [0.056, 0], [0.105, -0.012], [0.105, -0.02], [0.001, -0.02]], 12).scale(s).at(x, y + 0.275 * s, z).color(hat).pbr(0.8));
    if (o.plume) h.push(L1(H.tube([[0.03, 0.02, -0.02], [0.05, 0.09, -0.06], [0.03, 0.12, -0.13]], [0.012, 0.02, 0.006], 8, 5).scale(s).at(x, y + 0.275 * s, z).color(o.plume).pbr(0.9)));
  }
  return { prims: p, hard: h };
}

// ---------- animation helpers ----------
const _q = new THREE.Quaternion(), _e2 = new THREE.Euler();
/** put every rigged node back in its rest pose (position, rotation, size, visibility) */
function resetAll(rig, inner) {
  for (const k in rig) {
    const v = rig[k];
    if (Array.isArray(v)) { for (const n of v) restNode(n); } else if (v && v.isObject3D) restNode(v);
  }
  inner.rotation.set(0, 0, 0); inner.position.set(0, 0, 0);
}
function restNode(n) {
  const r = n && n.userData && n.userData.rest;
  if (!r) return;
  n.rotation.set(r[0], r[1], r[2]); n.position.set(r[3], r[4], r[5]);
  if (n.scale.x !== 1 || n.scale.y !== 1 || n.scale.z !== 1) n.scale.set(1, 1, 1);
  n.visible = true;
}
/** move / turn a node from its rest pose */
function nudge(n, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const r = n && n.userData.rest;
  if (!r) return;
  n.position.set(r[3] + x, r[4] + y, r[5] + z);
  if (rx || ry || rz) n.rotation.set(r[0] + rx, r[1] + ry, r[2] + rz);
}
/** puffs rise from their rest point, swell and fade, one after another */
function smokeAnim(list, c, rate = 0.45, rise = 0.5, drift = -0.12, size = 1) {
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const n = list[i], r = n.userData.rest;
    if (!r) continue;
    const u = (((c.t * rate + i / list.length + (c.phase || 0) * 0.13) % 1) + 1) % 1;
    n.position.set(r[3] + Math.sin(u * 5 + i * 2.1) * 0.035 * rise, r[4] + u * rise, r[5] + u * drift);
    n.scale.setScalar(Math.max(0.001, size * Math.sin(Math.min(1, u * 1.25) * Math.PI) ** 0.7 * (0.45 + u * 0.9)));
    n.rotation.set(u * 2 + i, u * 3, i);
  }
}
/** flames flicker: each stretches and leans on its own beat. k = overall size */
function flameAnim(list, c, k = 1, rate = 17) {
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    const n = list[i], r = n.userData.rest;
    if (!r) continue;
    const a = Math.sin(c.t * rate + i * 2.4 + (c.phase || 0)), b = Math.sin(c.t * rate * 0.63 + i * 1.3);
    n.scale.set(Math.max(0.001, k * (0.9 + 0.12 * b)), Math.max(0.001, k * (1 + 0.28 * a)), Math.max(0.001, k * (0.9 + 0.12 * b)));
    n.rotation.set(r[0] + 0.12 * b, r[1], r[2] + 0.12 * a);
  }
}
/** a wrecked part comes away: slides by (x, y, z) and tumbles by (rx, ry, rz) as e goes 0..1, settling no lower than `floor` below its rest */
function shed(n, e, x, y, z, rx, ry, rz) {
  const r = n && n.userData.rest;
  if (!r) return;
  n.position.set(r[3] + x * e, r[4] + y * e * e + Math.sin(e * Math.PI) * Math.abs(y) * 0.25, r[5] + z * e);
  n.rotation.set(r[0] + rx * e, r[1] + ry * e, r[2] + rz * e);
}
const sink = (inner, c, from = 0.75, rate = 0.5) => { inner.position.y -= Math.max(0, c.dead - from) * rate * (inner.scale.y || 1); };

// =====================================================================================
//  STEAM TANK
// =====================================================================================
function steamTank(def, o = {}) {
  const COL = num(o.color, 0x6a7078), TRIM = num(o.trim, 0xc9a23a), WOOD = 0x5e4630, DARK = tone(COL, 0, -0.02, -0.14), SOOT = 0x25262a;
  const nodes = [], root = node('root', null, [0, 0, 0]); nodes.push(root);
  const hull = node('hull', 'root', [0, 0.36, 0], { rig: 'body' }); nodes.push(hull);
  const Hd = hull.hard, HW = 0.36, RR = 0.36, RF = 0.27, ZR = -0.38, ZF = 0.46, WX = 0.475;
  // --- hull core: the side profile run across the width; plates are laid over it
  const prof = [[-0.74, 0.3], [-0.8, 0.52], [-0.7, 0.82], [0.16, 0.82], [0.66, 0.56], [0.8, 0.42], [0.7, 0.3]];
  Hd.push(H.extrude(prof, HW * 2 - 0.03, 0).rot(0, -90, 0).color(DARK).pbr(0.6, 0.6));
  // timber underframe and axle trees
  for (const sd of [1, -1]) {
    Hd.push(N(wooden(bar([sd * 0.3, 0.27, -0.76], [sd * 0.3, 0.27, 0.72], 0.08, 0.08), WOOD).shade(grain(WOOD, sd))));
    Hd.push(L1(wooden(box(0.1, 0.12, 0.16).at(sd * 0.36, 0.33, ZR), tone(WOOD, 0, 0, -0.05))), L1(wooden(box(0.1, 0.1, 0.14).at(sd * 0.36, 0.27, ZF), tone(WOOD, 0, 0, -0.05))));
  }
  Hd.push(N(iron(H.cyl(0.035, 0.035, WX * 2 + 0.1, 8).rot(0, 0, 90).at(0, RR, ZR))), N(iron(H.cyl(0.03, 0.03, WX * 2 + 0.1, 8).rot(0, 0, 90).at(0, RF, ZF))));
  // --- armour: two strakes of riveted plate a side, deck plates, a great sloped glacis
  for (const sd of [1, -1]) {
    const n = [sd, 0, 0], u = [0, 0, 1], v = [0, 1, 0], x = sd * (HW - 0.012);
    Hd.push(plates([x, 0.31, -0.72], u, v, n, 7, 1, 0.2, 0.25, COL, 3 + sd));
    Hd.push(plates([x, 0.56, -0.7], u, v, n, 4, 1, 0.215, 0.25, COL, 5 + sd, 0.016));
    // the wedge of plate under the glacis
    Hd.push(N(H.extrude([[0.16, 0.56], [0.64, 0.56], [0.16, 0.8]], 0.014, 0).rot(0, -90, 0).at(x + sd * 0.012, 0, 0).color(tone(COL, 0, 0, -0.03)).pbr(0.48, 0.8)));
    // brass edging along sheer and glacis
    Hd.push(N(brassy(bar([sd * HW, 0.815, -0.7], [sd * HW, 0.815, 0.16], 0.03, 0.03), TRIM)), N(brassy(bar([sd * HW, 0.815, 0.16], [sd * HW, 0.555, 0.66], 0.03, 0.03), TRIM)), L1(brassy(bar([sd * HW, 0.555, 0.66], [sd * HW, 0.3, 0.71], 0.026, 0.026), TRIM)));
    Hd.push(N(brassy(bar([sd * (HW + 0.002), 0.558, -0.72], [sd * (HW + 0.002), 0.558, 0.64], 0.022, 0.02), TRIM)));
    // splash guard over the big wheel, a step, a lantern
    Hd.push(N(iron(H.torus(RR + 0.05, 0.018, 14, 4, Math.PI).rot(0, 90, 0).at(sd * (WX - 0.02), RR, ZR), DARK)), L1(iron(box(0.1, 0.012, 0.16).at(sd * (HW + 0.06), 0.3, 0.06), DARK)));
    Hd.push(L1(brassy(H.cyl(0.022, 0.028, 0.06, 6).at(sd * 0.3, 0.74, 0.3), TRIM)), L1(ball(0.02, 8).at(sd * 0.3, 0.74, 0.3).color(0xffc060).glow(1.1)));
    // a row of stout spikes along the skirt
    for (let k = 0; k < 4; k++) Hd.push(L1(spikeAt([sd * HW, 0.45, -0.08 + k * 0.12], [sd, -0.1, 0], 0.07, 0.022, 4).color(0x8a8f96).pbr(0.4, 0.9)));
  }
  Hd.push(plates([-0.33, 0.822, -0.68], [1, 0, 0], [0, 0, 1], [0, 1, 0], 3, 3, 0.22, 0.28, tone(COL, 0, 0, -0.02), 9));
  {
    const up = [0, -0.26, 0.5], L = Math.hypot(0.26, 0.5), v = [0, up[1] / L, up[2] / L], n = [0, v[2], -v[1]];
    Hd.push(plates([-0.33, 0.822, 0.165], [1, 0, 0], v, n, 3, 2, 0.22, L / 2, tone(COL, 0, 0, 0.02), 13, 0.016));
    Hd.push(plates([-0.33, 0.305, 0.705], [1, 0, 0], [0, 0.9, 0.36], [0, -0.36, 0.9], 3, 1, 0.22, 0.26, COL, 15));
    Hd.push(L1(box(0.16, 0.02, 0.012).rot(-62.5, 0, 0).at(0.19, 0.74, 0.335).color(0x08080a)), L1(box(0.16, 0.02, 0.012).rot(-62.5, 0, 0).at(-0.19, 0.74, 0.335).color(0x08080a)));   // driver's slits
    // mantlet round the gun
    Hd.push(NF((hi) => brassy(H.lathe([[0.085, 0], [0.15, 0.01], [0.17, 0.05], [0.13, 0.09], [0.085, 0.1]], hi ? 16 : 7).rot(62, 0, 0).at(0, 0.6, 0.555), TRIM)));
  }
  Hd.push(plates([-0.33, 0.31, -0.775], [1, 0, 0], [0, 1, -0.12], [0, -0.12, -1], 3, 2, 0.22, 0.25, COL, 17));
  // ram bar and tow hooks at the bow
  Hd.push(N(iron(bar([-0.4, 0.34, 0.78], [0.4, 0.34, 0.78], 0.07, 0.06), DARK)));
  for (const sd of [1, -1]) Hd.push(L1(iron(H.torus(0.03, 0.009, 8, 4).at(sd * 0.22, 0.3, 0.82))));
  // coal bunker and a shovel on the stern
  Hd.push(N(wooden(box(0.5, 0.2, 0.14).at(0, 0.47, -0.86), WOOD).shade(grain(WOOD, 4))), L1(iron(box(0.52, 0.02, 0.15).at(0, 0.4, -0.86))), N(puff(0.07, 0x141416, 0, 2).scale(3.2, 0.7, 0.9).at(0, 0.57, -0.86)));
  Hd.push(L1(wooden(rod([0.3, 0.42, -0.95], [0.3, 0.8, -0.86], 0.011, 5), 0x8a6a40)), L1(iron(box(0.07, 0.09, 0.008).rot(-13, 0, 0).at(0.3, 0.39, -0.955))));

  // --- boiler
  const BY = 0.93, BR = 0.2, BZ0 = -0.7, BZ1 = -0.16;
  Hd.push(NF((hi) => H.lathe([[0.001, 0], [BR * 0.7, 0.012], [BR, 0.06], [BR, BZ1 - BZ0 - 0.05], [BR * 0.8, BZ1 - BZ0], [0.001, BZ1 - BZ0]], hi ? 20 : 8).rot(90, 0, 0).at(0, BY, BZ0).shade(hi ? worn(SOOT, 9, 0.1) : null).color(SOOT).pbr(0.55, 0.7)));
  for (const z of [-0.62, -0.44, -0.26]) Hd.push(N(brassy(H.torus(BR + 0.004, 0.014, 20, 5).at(0, BY, z), TRIM)));
  for (const z of [-0.62, -0.44, -0.26]) for (let k = 0; k < 9; k++) { const a = (k / 8) * Math.PI - Math.PI / 2; Hd.push(L0(stud(0.009).at(Math.sin(a) * (BR + 0.018), BY + Math.cos(a) * (BR + 0.018), z).color(tone(TRIM, 0, 0, 0.08)).pbr(0.4, 0.9))); }
  // fire door on the boiler's back head, glowing round its edges
  Hd.push(L1(iron(H.cyl(0.085, 0.085, 0.016, 12).rot(90, 0, 0).at(0, BY - 0.02, BZ0 - 0.006), 0x2e2e33)), N(H.cyl(0.07, 0.07, 0.012, 10).rot(90, 0, 0).at(0, BY - 0.02, BZ0 - 0.002).color(0xff6a1c).glow(1.2)), L1(iron(box(0.1, 0.014, 0.01).at(0, BY - 0.02, BZ0 - 0.016), 0x1c1c20)), L1(iron(box(0.1, 0.014, 0.01).at(0, BY + 0.012, BZ0 - 0.016), 0x1c1c20)), L1(iron(box(0.1, 0.014, 0.01).at(0, BY - 0.052, BZ0 - 0.016), 0x1c1c20)));
  // steam dome, safety valve and a pipe run forward to the cylinders
  Hd.push(NF((hi) => brassy(H.lathe([[0.07, 0], [0.075, 0.05], [0.055, 0.1], [0.001, 0.115]], hi ? 12 : 6).at(0, BY + BR - 0.03, -0.25), TRIM)));
  Hd.push(L1(brassy(H.cyl(0.01, 0.014, 0.07, 6).at(0, BY + BR + 0.11, -0.25), TRIM)), L1(brassy(rod([0, BY + BR + 0.15, -0.25], [0, BY + BR + 0.13, -0.16], 0.006, 4), TRIM)), L1(iron(ball(0.016, 6).at(0, BY + BR + 0.125, -0.155))));
  for (const sd of [1, -1]) {
    Hd.push(N(H.tube([[sd * 0.1, BY + 0.14, -0.2], [sd * 0.2, BY + 0.1, -0.12], [sd * 0.3, 0.86, -0.02], [sd * 0.33, 0.845, 0.1]], 0.016, 10, 5).color(tone(TRIM, 0.02, -0.1, -0.1)).pbr(0.4, 0.9)));
    // piston housing and connecting rod down to the big wheel
    Hd.push(N(iron(H.cyl(0.04, 0.04, 0.22, 8).rot(90, 0, 0).at(sd * (HW + 0.045), 0.62, 0.0), 0x3a3c42)), L1(brassy(H.cyl(0.046, 0.046, 0.02, 8).rot(90, 0, 0).at(sd * (HW + 0.045), 0.62, -0.11), TRIM)), L1(brassy(H.cyl(0.046, 0.046, 0.02, 8).rot(90, 0, 0).at(sd * (HW + 0.045), 0.62, 0.11), TRIM)));
  }

  // --- funnel (its own node: it topples when the engine dies) and its smoke
  const FZ = -0.52, FY = BY + BR - 0.02;
  const fun = node('funnel', 'hull', [0, FY, FZ], { rig: 'funnel' }); nodes.push(fun);
  fun.hard.push(NF((hi) => H.lathe([[0.085, 0], [0.07, 0.03], [0.062, 0.4], [0.075, 0.44], [0.105, 0.5], [0.11, 0.53], [0.08, 0.53], [0.06, 0.47], [0.05, 0.4]], hi ? 16 : 7).at(0, FY, FZ).color(SOOT).pbr(0.6, 0.6)));
  fun.hard.push(N(brassy(H.torus(0.068, 0.012, 14, 5).rot(90, 0, 0).at(0, FY + 0.12, FZ), TRIM)), N(brassy(H.torus(0.108, 0.012, 14, 5).rot(90, 0, 0).at(0, FY + 0.52, FZ), TRIM)));
  for (let k = 0; k < 2; k++) fun.hard.push(L1(iron(rod([0, FY + 0.36, FZ], [(k ? -1 : 1) * 0.17, FY - 0.14, FZ + 0.16], 0.005, 4), 0x1c1c20)));
  for (let i = 0; i < 4; i++) { const s = node(`smoke${i}`, 'hull', [0, FY + 0.52, FZ], { rig: 'smoke' }); s.hard.push(puff(0.11, i % 2 ? 0x5a5a5e : 0x6e6e72, 0, i).at(0, FY + 0.52, FZ)); nodes.push(s); }

  // --- gun
  const GO = [0, 0.6, 0.56], gun = node('gun', 'hull', GO, { rig: 'gun' }); nodes.push(gun);
  gun.hard.push(NF((hi) => H.lathe([[0.001, -0.1], [0.075, -0.09], [0.082, 0], [0.074, 0.1], [0.062, 0.44], [0.066, 0.46], [0.08, 0.47], [0.084, 0.52], [0.072, 0.55], [0.045, 0.55], [0.045, 0.42], [0.001, 0.42]], hi ? 16 : 7).rot(90, 0, 0).at(...GO).shade((x, y, z) => (y > 0.5 && Math.hypot(x, z) < 0.05 ? [0.006, 0.006, 0.006] : null)).color(0x33353a).pbr(0.45, 0.85)));
  for (const y of [0.08, 0.3]) gun.hard.push(N(brassy(H.torus(0.078 - y * 0.03, 0.012, 14, 5).at(GO[0], GO[1], GO[2] + y), TRIM)));
  gun.hard.push(L1(brassy(H.torus(0.086, 0.01, 14, 5).at(GO[0], GO[1], GO[2] + 0.5), TRIM)));

  // --- turret hatch and the commander
  const TO = [0, 0.83, -0.0], tur = node('turret', 'hull', TO, { rig: 'turret' }); nodes.push(tur);
  tur.hard.push(NF((hi) => H.lathe([[0.2, 0], [0.19, 0.13], [0.2, 0.15], [0.17, 0.17], [0.13, 0.17], [0.13, 0.1], [0.001, 0.1]], hi ? 18 : 8).at(...TO).shade(hi ? worn(COL, 10) : null).color(COL).pbr(0.48, 0.8)));
  tur.hard.push(N(brassy(H.torus(0.197, 0.012, 18, 5).rot(90, 0, 0).at(0, TO[1] + 0.145, TO[2]), TRIM)));
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; tur.hard.push(L0(stud(0.01).at(Math.sin(a) * 0.2, TO[1] + 0.05, TO[2] + Math.cos(a) * 0.2).color(tone(COL, 0, 0, 0.1)).pbr(0.4, 0.9))); }
  for (const a of [0, 120, 240]) tur.hard.push(L1(box(0.07, 0.016, 0.02).at(0, TO[1] + 0.09, 0.193).rot(0, a, 0).at(0, 0, TO[2]).color(0x08080a)));
  tur.hard.push(N(iron(H.cyl(0.135, 0.135, 0.014, 12).rot(-68, 0, 0).at(0, TO[1] + 0.29, TO[2] - 0.17), tone(COL, 0, 0, -0.04))), L1(brassy(H.cyl(0.03, 0.03, 0.02, 8).rot(-68, 0, 0).at(0, TO[1] + 0.29, TO[2] - 0.185), TRIM)));
  const crew = node('crew', 'turret', [0, TO[1] + 0.14, TO[2]], { rig: 'crew', detail: 1.8, minRes: 30 }); nodes.push(crew);
  const cb = crewBust([0, TO[1] + 0.13, TO[2]], { coat: tone(TRIM, -0.08, 0.1, -0.2), hat: 0x2a2622, plume: 0xd8d2c0 });
  crew.prims.push(cb.prims); crew.hard.push(cb.hard);
  crew.hard.push(L1(brassy(rod([-0.1, TO[1] + 0.2, TO[2] + 0.06], [-0.02, TO[1] + 0.335, TO[2] + 0.13], 0.011, 6, 0.015), TRIM)));   // spyglass

  // --- wheels: two great drivers aft, a smaller pair forward
  const big = wheel({ R: RR, w: 0.1, wood: WOOD, spokes: 10 }), small = wheel({ R: RF, w: 0.09, wood: WOOD, spokes: 8 });
  [[1, ZR, RR, big], [-1, ZR, RR, big], [1, ZF, RF, small], [-1, ZF, RF, small]].forEach(([sd, z, r, pcs], i) => {
    const n = node(`wheel${i}`, 'hull', [sd * WX, r, z], { rig: 'wheels' });
    n.hard = placeWheel(pcs, [sd * WX, r, z], sd, i * 23);
    nodes.push(n);
  });
  return { kind: 'steamTank', attack: 'shoot', nodes: finish(nodes), rearR: RR, frontR: RF };
}

function tankAnim(rig, inner, c, base) {
  const { keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk;
  resetAll(rig, inner);
  const W = rig.wheels || [], gun = rig.gun && rig.gun[0], fun = rig.funnel && rig.funnel[0], dead = c.dead > 0;
  const roll = c.moving && !dead ? t * 2.2 : 0;
  W.forEach((w, i) => { w.rotation.x = (w.userData.rest ? w.userData.rest[0] : 0) + roll * 0.6 / (i < 2 ? rig.rearR || 0.36 : rig.frontR || 0.27); });
  if (!dead) {
    inner.position.y = Math.abs(Math.sin(t * (c.moving ? 13 : 7) + ph)) * (c.moving ? 0.006 : 0.003) * s;       // the engine shudders
    inner.rotation.z = c.moving ? Math.sin(t * 4.4 + ph) * 0.012 : 0;
    if (rig.turret) rig.turret.rotation.y = Math.sin(t * 0.5 + ph) * 0.6 * (a >= 0 ? 0.2 : 1);
    if (rig.crew && rig.crew[0]) nudge(rig.crew[0], 0, Math.sin(t * 2.2 + ph) * 0.006 - (a >= 0 ? keys(a, [[0, 0], [0.4, 0.1], [0.7, 0.1], [1, 0]]) : 0), 0);
    if (a >= 0) {
      const k = keys(a, [[0, 0], [0.42, 0.04], [0.47, -1], [0.75, -0.25], [1, 0]]);                                // run out, fire, recoil
      if (gun) nudge(gun, 0, 0, k * 0.2);
      inner.position.z = Math.min(0, k) * 0.07 * s; inner.rotation.x = Math.min(0, k) * 0.045;
    }
    smokeAnim(rig.smoke, c, c.moving ? 0.9 : 0.5, 0.55, c.moving ? -0.45 : -0.1, a >= 0 && a > 0.45 && a < 0.8 ? 1.5 : 1);
    return;
  }
  // the boiler bursts: the funnel goes over, the hatch is blown off, the wheels splay and the hull settles on its axles
  const e = ease(c.dead * 1.5), e2 = ease(c.dead * 1.1 - 0.15);
  if (fun) shed(fun, e, 0.05, -0.1, -0.2, -1.5, 0, 0.3);
  if (rig.turret) shed(rig.turret, e2, -0.25, -0.2, -0.1, 0.5, 0.8, -0.9);
  if (gun) gun.rotation.x += 0.3 * e;
  W.forEach((w, i) => { const sd = (w.userData.rest[3] || 0) >= 0 ? 1 : -1; shed(w, e2, sd * 0.1, -0.08, 0, 0, sd * 0.25, -sd * 0.42); });
  inner.position.y = -0.2 * e * s; inner.rotation.z = 0.09 * e; inner.rotation.x = -0.05 * e;
  smokeAnim(rig.smoke, c, 0.8, 0.9, -0.1, 1.7 * (1 - clamp(c.dead - 1) * 2));
  sink(inner, c, 0.9, 0.5);
}

// =====================================================================================
//  LIGHTNING WHEEL
// =====================================================================================
/** a zigzag bolt from a to b */
function bolt(a, b, color, seed, r = 0.012, jag = 0.06) {
  const rn = rng(seed * 977 + 5), pts = [], n = 6;
  for (let i = 0; i <= n; i++) { const u = i / n, k = i === 0 || i === n ? 0 : jag; pts.push([lerp(a[0], b[0], u) + (rn() - 0.5) * k, lerp(a[1], b[1], u) + (rn() - 0.5) * k, lerp(a[2], b[2], u) + (rn() - 0.5) * k]); }
  const out = [];
  for (let i = 0; i < n; i++) out.push(rod(pts[i], pts[i + 1], r, 4, r * 0.7).color(color).pbr(0.9, 0).glow(1.15));
  return out;
}
/** a rat of the crew, running: body along +Z, feet at y = 0, about 0.2 long */
function ratRunner(at, s = 1, fur = 0x4a4038) {
  const [x, y, z] = at;
  return [
    S.ellipsoid(0.05 * s, 0.05 * s, 0.085 * s).rot(-22, 0, 0).at(x, y + 0.085 * s, z).color(fur).pbr(0.9).bump(0.004, 60, 'fur'),
    S.capsule([x, y + 0.13 * s, z + 0.07 * s], [x, y + 0.14 * s, z + 0.135 * s], 0.034 * s, 0.014 * s).color(fur).blend(0.02),
    S.sphere(0.017 * s).at(x + 0.026 * s, y + 0.168 * s, z + 0.07 * s).color(0x8a6a66).blend(0.006), S.sphere(0.017 * s).at(x - 0.026 * s, y + 0.168 * s, z + 0.07 * s).color(0x8a6a66).blend(0.006),
    S.capsule([x + 0.03 * s, y + 0.07 * s, z + 0.04 * s], [x + 0.034 * s, y + 0.005 * s, z + 0.075 * s], 0.014 * s, 0.01 * s).color(fur).blend(0.01),
    S.capsule([x - 0.03 * s, y + 0.07 * s, z + 0.04 * s], [x - 0.034 * s, y + 0.005 * s, z + 0.02 * s], 0.014 * s, 0.01 * s).color(fur).blend(0.01),
    S.capsule([x + 0.03 * s, y + 0.06 * s, z - 0.05 * s], [x + 0.034 * s, y + 0.005 * s, z - 0.085 * s], 0.017 * s, 0.011 * s).color(fur).blend(0.01),
    S.capsule([x - 0.03 * s, y + 0.06 * s, z - 0.05 * s], [x - 0.034 * s, y + 0.005 * s, z - 0.03 * s], 0.017 * s, 0.011 * s).color(fur).blend(0.01),
    S.limb([[x, y + 0.06 * s, z - 0.08 * s], [x, y + 0.045 * s, z - 0.15 * s], [x, y + 0.075 * s, z - 0.21 * s]], [0.011 * s, 0.007 * s, 0.004 * s]).map((q) => q.color(0x9a7a72).blend(0.01)),
  ];
}

function wheelEngine(def, o = {}) {
  const WOOD = num(o.color, 0x6a4a2a), GLOW = tone(num(o.glow, 0x5aff5a), 0, 0.1, -0.2), TRIM = num(o.trim, 0xb07a3a), IRONC = 0x45484e, DARKW = tone(WOOD, 0, 0, -0.1);
  const nodes = [], root = node('root', null, [0, 0, 0]); nodes.push(root);
  const R = 0.8, CY = 0.82, WX = 0.36, TW = 0.2;       // rim radius, axle height, wheel centre, tread width
  // --- each wheel is a treadwheel: two rings joined by treads, spokes on the outside only, open toward the cab
  const mkWheel = (sd) => {
    const out = [], x0 = sd * (WX - TW / 2), x1 = sd * (WX + TW / 2);
    const ring = (x, r0, r1, th, seg) => H.lathe([[r0, -th / 2], [r1, -th / 2], [r1, th / 2], [r0, th / 2], [r0, -th / 2]], seg).rot(0, 0, 90).at(x, CY, 0);
    out.push(NF((hi) => wooden(ring(x1, R - 0.13, R, 0.05, hi ? 36 : 12), WOOD).shade(hi ? (x, y, z) => { const f = (((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 8) % 1; return f < 0.03 || f > 0.97 ? rgb(tone(WOOD, 0, 0, -0.18)) : mixRgb(rgb(DARKW), rgb(WOOD), clamp(noise3(x * 9, y * 9, z * 9) * 1.4 - 0.1)); } : null)));
    out.push(NF((hi) => wooden(ring(x0, R - 0.1, R, 0.04, hi ? 36 : 12), DARKW)));
    out.push(NF((hi) => iron(ring(sd * WX, R - 0.012, R + 0.012, TW + 0.02, hi ? 36 : 12), IRONC).shade(hi ? worn(IRONC, 8) : null)));
    // treads the crew run on
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; out.push(L1(wooden(box(TW - 0.02, 0.02, 0.07).rot(a / DEG + 90, 0, 0).at(sd * WX, CY + Math.cos(a) * (R - 0.035), Math.sin(a) * (R - 0.035)), k % 2 ? WOOD : DARKW))); }
    // spokes: eight heavy timbers and a boss
    for (let k = 0; k < 8; k++) { const a = (k / 8) * 360 + 22.5; out.push(N(wooden(box(0.05, R - 0.16, 0.085).at(0, (R - 0.16) / 2 + 0.07, 0).rot(a, 0, 0).at(x1, CY, 0), k % 2 ? WOOD : DARKW).shade(grain(k % 2 ? WOOD : DARKW, k)))); }
    for (let k = 0; k < 2; k++) out.push(Fr(wooden(box(0.05, (R - 0.1) * 2, 0.09).rot(k * 90 + 22.5, 0, 0).at(x1, CY, 0), WOOD)));
    out.push(NF((hi) => iron(H.lathe([[0.001, -0.05], [0.09, -0.05], [0.13, 0], [0.09, 0.07], [0.04, 0.1], [0.001, 0.1]], hi ? 12 : 6).rot(0, 0, -90 * sd).at(x1, CY, 0), IRONC)));
    out.push(L1(brassy(H.torus(0.1, 0.014, 12, 5).rot(0, 90, 0).at(x1 + sd * 0.03, CY, 0), TRIM)));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.39; out.push(L0(stud(0.016).at(x1 + sd * 0.03, CY + Math.cos(a) * (R - 0.065), Math.sin(a) * (R - 0.065)).color(0x7a7e86).pbr(0.4, 0.9))); }
    // spikes round the tread, and scything blades on the hub
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, d = [0, Math.cos(a), Math.sin(a)]; out.push(N(spikeAt([sd * (WX + (k % 2 ? 0.05 : -0.05)), CY + d[1] * R, d[2] * R], d, 0.11, 0.032, 4).color(0x8a8f96).pbr(0.4, 0.9))); }
    out.push(N(spikeAt([x1 + sd * 0.08, CY, 0], [sd, 0, 0], 0.2, 0.04, 5).color(0x8a8f96).pbr(0.4, 0.9)));
    // lightning rods: copper spars standing off the rim, each tipped with a glowing ball
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.6, d = [sd * 0.5, Math.cos(a), Math.sin(a)], p = [x1, CY + Math.cos(a) * (R - 0.06), Math.sin(a) * (R - 0.06)], q = [p[0] + d[0] * 0.2, p[1] + d[1] * 0.2, p[2] + d[2] * 0.2];
      out.push(N(brassy(rod(p, q, 0.014, 5, 0.008), 0xb8703a)), L1(brassy(H.torus(0.026, 0.007, 8, 4).rot(0, 0, 0).at(lerp(p[0], q[0], 0.5), lerp(p[1], q[1], 0.5), lerp(p[2], q[2], 0.5)), 0xb8703a)));
      out.push(ball(0.036, 8).at(...q).color(GLOW).glow(1.0));
    }
    return out;
  };
  [1, -1].forEach((sd, i) => { const n = node(`wheel${i}`, 'root', [sd * WX, CY, 0], { rig: 'wheels' }); n.hard = mkWheel(sd); nodes.push(n); });

  // --- the cab: hangs from the axle and stays upright while the wheels turn about it
  const cab = node('cab', 'root', [0, CY, 0], { rig: 'cab' }); nodes.push(cab);
  const Cd = cab.hard, CW = 0.2;
  Cd.push(N(iron(H.cyl(0.045, 0.045, WX * 2 + 0.2, 10).rot(0, 0, 90).at(0, CY, 0), IRONC)), Fr(iron(H.cyl(0.04, 0.04, WX * 2 + 0.2, 5).rot(0, 0, 90).at(0, CY, 0), IRONC)));
  // box of planks slung under the axle on iron straps, with a seat, a spiked prow and a roof of hide
  Cd.push(wooden(box(CW * 2, 0.04, 0.5).at(0, CY - 0.36, 0), DARKW));
  for (const sd of [1, -1]) {
    for (let k = 0; k < 3; k++) Cd.push(N(wooden(box(0.022, 0.085, 0.5).at(sd * CW, CY - 0.3 + k * 0.09, 0), k % 2 ? WOOD : DARKW).shade(grain(WOOD, k + sd))));
    Cd.push(Fr(wooden(box(0.022, 0.26, 0.5).at(sd * CW, CY - 0.21, 0), WOOD)));
    for (const z of [-0.2, 0.2]) Cd.push(N(iron(bar([sd * CW, CY - 0.36, z], [sd * (CW - 0.02), CY + 0.02, z * 0.3], 0.03, 0.012), IRONC)), L0(stud(0.012).at(sd * (CW + 0.014), CY - 0.3, z).color(0x7a7e86).pbr(0.4, 0.9)), L0(stud(0.012).at(sd * (CW + 0.014), CY - 0.14, z * 0.72).color(0x7a7e86).pbr(0.4, 0.9)));
  }
  Cd.push(N(wooden(box(CW * 2, 0.26, 0.022).at(0, CY - 0.21, -0.25), WOOD)), N(wooden(box(CW * 2, 0.16, 0.022).at(0, CY - 0.27, 0.25), WOOD)));
  Cd.push(N(iron(H.extrude([[-CW, 0], [CW, 0], [0, 0.26]], 0.03, 0).rot(90, 0, 0).at(0, CY - 0.3, 0.26), 0x8a8f96)), L1(iron(H.extrude([[-CW * 0.8, 0], [CW * 0.8, 0], [0, 0.2]], 0.02, 0).rot(90, 0, 0).at(0, CY - 0.22, 0.26), 0x8a8f96)));   // prow blades
  // the conductor: a copper mast through the roof, glass insulators, a great glowing ball
  const MY = CY + 0.06;
  Cd.push(NF((hi) => brassy(H.lathe([[0.03, 0], [0.024, 0.5], [0.04, 0.52], [0.04, 0.56], [0.001, 0.58]], hi ? 8 : 5).at(0, MY, -0.04), 0xb8703a)));
  for (const y of [0.16, 0.28, 0.4]) Cd.push(N(H.lathe([[0.03, -0.02], [0.065, -0.012], [0.07, 0], [0.03, 0.03]], 10).at(0, MY + y, -0.04).color(0xc8e8d8).pbr(0.2, 0)));
  Cd.push(NF((hi) => ball(0.1, hi ? 12 : 6).at(0, MY + 0.66, -0.04).color(GLOW).glow(1.0)));
  Cd.push(L1(brassy(H.torus(0.12, 0.01, 14, 4).rot(90, 0, 0).at(0, MY + 0.66, -0.04), 0xb8703a)), L1(brassy(H.torus(0.12, 0.01, 14, 4).rot(0, 0, 0).at(0, MY + 0.66, -0.04), 0xb8703a)));
  // warpstone-green jars wired to the mast
  for (const sd of [1, -1]) {
    Cd.push(N(H.cyl(0.045, 0.05, 0.11, 8).at(sd * 0.12, CY - 0.02, -0.17).color(GLOW).glow(0.9).pbr(0.2, 0)), L1(brassy(H.cyl(0.05, 0.05, 0.02, 8).at(sd * 0.12, CY + 0.045, -0.17), 0xb8703a)));
    Cd.push(L1(H.tube([[sd * 0.12, CY + 0.05, -0.17], [sd * 0.1, CY + 0.2, -0.12], [sd * 0.03, MY + 0.14, -0.05]], 0.007, 8, 4).color(0x2a2a2e).pbr(0.6, 0.4)));
  }
  // the driver, hunched at the levers
  const drv = node('driver', 'cab', [0, CY - 0.34, 0.02], { rig: 'crew', detail: 2, minRes: 30 }); nodes.push(drv);
  drv.prims.push(
    S.ellipsoid(0.07, 0.085, 0.07).at(0, CY - 0.22, 0.0).color(0x4a3a2a).pbr(0.9),
    S.capsule([0, CY - 0.13, 0.03], [0, CY - 0.1, 0.12], 0.045, 0.018).color(0x5a4c40).bump(0.004, 60, 'fur').blend(0.02),
    S.sphere(0.022).at(0.034, CY - 0.07, 0.03).color(0x8a6a66).blend(0.006), S.sphere(0.022).at(-0.034, CY - 0.07, 0.03).color(0x8a6a66).blend(0.006),
    S.capsule([0.07, CY - 0.19, 0.02], [0.1, CY - 0.2, 0.15], 0.02, 0.014).color(0x4a3a2a).blend(0.01), S.capsule([-0.07, CY - 0.19, 0.02], [-0.1, CY - 0.2, 0.15], 0.02, 0.014).color(0x4a3a2a).blend(0.01),
  );
  drv.hard.push(L1(ball(0.008, 5).at(0.02, CY - 0.1, 0.085).color(0xff4030).glow(1.2)), L1(ball(0.008, 5).at(-0.02, CY - 0.1, 0.085).color(0xff4030).glow(1.2)));
  for (const sd of [1, -1]) Cd.push(L1(iron(rod([sd * 0.1, CY - 0.34, 0.17], [sd * 0.1, CY - 0.17, 0.16], 0.008, 4))), L1(ball(0.016, 6).at(sd * 0.1, CY - 0.17, 0.16).color(0x8a2a22)));
  // --- rats running inside each wheel (they hold their place at the bottom while it turns)
  [1, -1].forEach((sd, i) => {
    for (let k = 0; k < 2; k++) {
      const z = k ? -0.26 : 0.16, y = CY - Math.sqrt(Math.max(0, (R - 0.05) ** 2 - z * z));
      const rn = node(`rat${i}${k}`, 'root', [sd * WX, y, z], { rig: 'crew', detail: 1.8, minRes: 26, rot: [-Math.asin(z / (R - 0.05)) / DEG, 0, 0] });
      rn.prims.push(ratRunner([0, 0, 0], 1.25, k ? 0x4a4038 : 0x5a4a3c)); rn.pos = [sd * WX, y, z]; rn.o = [0, 0, 0];
      nodes.push(rn);
    }
  });
  // --- arcs of lightning: between the rod tips of each wheel, and from the mast to each wheel
  let seed = 1;
  const arc = (name, parent, o3, a, b, r) => { const n = node(name, parent, o3, { rig: 'arcs' }); n.hard.push(bolt(a, b, GLOW, seed++, r)); nodes.push(n); };
  const top = [0, MY + 0.66, -0.04];
  for (const sd of [1, -1]) {
    arc(`arcM${sd}`, 'cab', top, top, [sd * (WX - 0.12), CY + 0.62, 0.3], 0.014);
    arc(`arcN${sd}`, 'cab', top, top, [sd * (WX - 0.12), CY + 0.7, -0.26], 0.012);
    arc(`arcR${sd}`, 'root', [sd * (WX + 0.2), CY, 0], [sd * (WX + 0.21), CY + 0.6, 0.42], [sd * (WX + 0.21), CY - 0.42, 0.6], 0.012);
  }
  return { kind: 'wheelEngine', attack: 'slam', nodes: finish(nodes), wheelR: R };
}

function wheelAnim(rig, inner, c, base) {
  const { keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk, dead = c.dead > 0;
  resetAll(rig, inner);
  const W = rig.wheels || [], cab = rig.cab && rig.cab[0], crew = rig.crew || [], arcs = rig.arcs || [];
  const spin = dead ? 0 : c.moving ? t * 6.5 : t * 0.5 + Math.sin(t * 0.9 + ph) * 0.25;                     // never quite still
  W.forEach((w) => { w.rotation.x = spin + (a >= 0 ? keys(a, [[0, 0], [0.4, -0.6], [0.62, 1.6], [1, 0]]) : 0); });
  // the crew run where they stand; the cab swings a little under the axle
  const run = c.moving || a >= 0 ? 1 : 0.35;
  crew.forEach((n, i) => { const r = n.userData.rest; n.position.y = r[4] + Math.abs(Math.sin(t * (9 + run * 9) + i * 1.9)) * 0.03 * run; n.rotation.x = r[0] + Math.sin(t * (9 + run * 9) + i * 1.9) * 0.16 * run; });
  if (cab) cab.rotation.x = dead ? 0 : (c.moving ? -0.12 : 0) + Math.sin(t * 2.3 + ph) * 0.05 + (a >= 0 ? keys(a, [[0, 0], [0.4, -0.28], [0.62, 0.34], [1, 0]]) : 0);
  // lightning: each arc shows for a few frames at a time, turned to a new angle
  const hot = a >= 0 ? 1 : c.moving ? 0.6 : 0.3;
  arcs.forEach((n, i) => {
    const tick = Math.floor(t * 14 + i * 3.7 + ph * 5), h = Math.sin(tick * 12.9898 + i * 78.233) * 43758.5453, f = h - Math.floor(h);
    n.visible = !dead && f < hot;
    n.rotation.set(n.userData.rest[0] + (i % 3 === 2 ? f * 6.283 : (f - 0.5) * 0.5), n.userData.rest[1] + (i % 3 === 2 ? 0 : (f - 0.5) * 0.7), n.userData.rest[2]);
    const k = 0.8 + f * 0.5; n.scale.set(k, k, k);
  });
  if (!dead) {
    inner.position.y = (c.moving ? Math.abs(Math.sin(t * 13 + ph)) * 0.012 : 0) * s;
    if (a >= 0) inner.position.z = keys(a, [[0, 0], [0.4, -0.12], [0.62, 0.3], [1, 0]]) * s;                 // rears back and rolls over its victim
    return;
  }
  // the axle breaks: the wheels fall outward and lie flat, the cab drops between them
  const e = ease(c.dead * 1.3), R0 = rig.wheelR || 0.8;
  W.forEach((w) => { const sd = (w.userData.rest[3] || 0) >= 0 ? 1 : -1; nudge(w, sd * 0.42 * e, -(R0 - 0.1) * e * e, sd * 0.1 * e, 0, 0, -sd * 1.5 * e); });
  if (cab) { nudge(cab, 0, -0.42 * e * e, 0, 0.35 * e, 0, 0.2 * e); }
  crew.forEach((n, i) => { if (i > 0) { n.position.y = n.userData.rest[4] + 0; n.scale.setScalar(Math.max(0.001, 1 - e)); } });   // the runners are gone with the wheels
  sink(inner, c, 0.9, 0.4);
}

// =====================================================================================
//  CLOCKWORK WAR-WAGON
// =====================================================================================
/** a spur gear on the origin, axle along Y, as an extruded outline */
function gear(R, teeth, th, hole = 0.25) {
  const pts = [], n = teeth * 4;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = i % 4 < 2 ? R : R * 0.82; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  const hp = []; for (let i = 0; i < 8; i++) { const a = -(i / 8) * Math.PI * 2; hp.push([Math.cos(a) * R * hole, Math.sin(a) * R * hole]); }
  return H.extrude(pts, th, 0, hole > 0 ? [hp] : []).rot(90, 0, 0);
}
function warWagon(def, o = {}) {
  const WOOD = num(o.color, 0x7a5a36), TRIM = num(o.trim, 0xb08a4a), DARKW = tone(WOOD, 0, 0, -0.1), IRONC = 0x4a4d54;
  const nodes = [], root = node('root', null, [0, 0, 0]); nodes.push(root);
  const shell = node('shell', 'root', [0, 0.3, 0], { rig: 'body' }); nodes.push(shell);
  const Sd = shell.hard, R0 = 0.84, Y0 = 0.14, Y1 = 0.44, RT = 0.25, Y2 = 1.04, NP = 24;
  // the shell: a planked skirt and a planked cone, every plank its own facet, bronze ribs over the joints
  const wa = rgb(WOOD), wb = rgb(DARKW), wc = rgb(tone(WOOD, 0.01, 0, 0.06));
  const plank = (x, y, z) => { const k = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * NP + 0.5) % NP; return mixRgb(k % 3 === 0 ? wb : k % 3 === 1 ? wa : wc, wb, clamp(noise3(x * 6, y * 22, z * 6) * 1.2 - 0.45)); };
  const cone = (hi) => H.lathe(hi ? [[R0 - 0.06, Y0], [R0, Y0 + 0.04], [R0 + 0.03, Y1 - 0.03], [R0 + 0.02, Y1], [R0 - 0.02, Y1 + 0.02], [0.66, 0.66], [0.46, 0.86], [RT + 0.02, Y2], [RT, Y2 + 0.02]] : [[R0, Y0], [R0 + 0.03, Y1], [0.56, 0.76], [RT, Y2 + 0.02]], hi ? NP : 10);
  Sd.push(N(wooden(cone(true), WOOD).shade(plank)), Fr(wooden(cone(false), WOOD)));
  Sd.push(L1(H.cyl(R0 - 0.07, R0 - 0.07, 0.02, 12).at(0, Y0 + 0.01, 0).color(0x0a0a0c)));                    // the dark under the skirt
  for (let k = 0; k < NP / 2; k++) {
    const a = ((k * 2 + 0.5) / NP) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
    const pt = (r, y) => [cs * r, y, sn * r];
    Sd.push(N(brassy(bar(pt(R0 + 0.025, Y1 + 0.005), pt(RT + 0.03, Y2 + 0.005), 0.035, 0.022, pt(1, 0.8)), TRIM)), L1(brassy(bar(pt(R0 + 0.012, Y0 + 0.03), pt(R0 + 0.04, Y1), 0.035, 0.02, pt(1, 0)), TRIM)));
    for (const u of [0.15, 0.4, 0.65, 0.9]) Sd.push(L0(stud(0.012).at(...pt(lerp(R0 + 0.04, RT + 0.045, u), lerp(Y1 + 0.02, Y2 + 0.02, u))).color(tone(TRIM, 0, 0, 0.1)).pbr(0.4, 0.9)));
  }
  Sd.push(NF((hi) => brassy(H.torus(R0 + 0.03, 0.022, hi ? NP : 10, 5).rot(90, 0, 0).at(0, Y1, 0), TRIM)), N(brassy(H.torus(R0 - 0.01, 0.02, NP, 5).rot(90, 0, 0).at(0, Y0 + 0.02, 0), TRIM)), N(brassy(H.torus(RT + 0.03, 0.018, 16, 5).rot(90, 0, 0).at(0, Y2 + 0.005, 0), TRIM)));
  // gun ports round the skirt
  for (let k = 0; k < NP / 2; k++) { const a = ((k * 2 + 1.5) / NP) * Math.PI * 2; Sd.push(L1(iron(H.torus(0.05, 0.012, 8, 4).rot(0, -a / DEG + 90, 0).at(Math.cos(a) * (R0 + 0.012), 0.3, Math.sin(a) * (R0 + 0.012)), 0x2e3034))); }
  // --- the guns: a ring of small breech-loaders, drawn in together when they fire
  const guns = node('guns', 'shell', [0, 0.3, 0], { rig: 'gun' }); nodes.push(guns);
  for (let k = 0; k < NP / 2; k++) {
    const a = ((k * 2 + 1.5) / NP) * Math.PI * 2, d = [Math.cos(a), 0, Math.sin(a)], p = [d[0] * (R0 - 0.14), 0.3, d[2] * (R0 - 0.14)];
    guns.hard.push(NF((hi) => orient(H.lathe([[0.03, 0], [0.036, 0.16], [0.03, 0.3], [0.04, 0.31], [0.04, 0.34], [0.02, 0.34]], hi ? 8 : 5), p, d).color(0x33353a).pbr(0.45, 0.85)));
    guns.hard.push(L1(orient(H.cyl(0.018, 0.018, 0.012, 6).at(0, 0.341, 0), p, d).color(0x050505)));
  }
  // --- lookout turret: slotted drum, conical cap, a pennon
  const TO = [0, Y2, 0], tur = node('turret', 'shell', TO, { rig: 'turret' }); nodes.push(tur);
  tur.hard.push(NF((hi) => wooden(H.lathe([[RT - 0.03, 0], [RT - 0.04, 0.17], [RT - 0.01, 0.19]], hi ? 12 : 6).at(...TO), DARKW)));
  tur.hard.push(NF((hi) => brassy(H.lathe([[RT + 0.02, 0.19], [RT - 0.02, 0.22], [0.1, 0.34], [0.03, 0.42], [0.02, 0.47], [0.001, 0.5]], hi ? 12 : 6).at(...TO).shade(hi ? worn(TRIM, 12, 0.12) : null), TRIM)));
  for (let k = 0; k < 6; k++) { const a = (k / 6) * 360; tur.hard.push(L1(box(0.09, 0.03, 0.02).at(0, Y2 + 0.11, RT - 0.036).rot(0, a, 0).color(0x08080a)), L1(brassy(box(0.02, 0.17, 0.02).at(0, Y2 + 0.09, RT - 0.03).rot(0, a + 30, 0), TRIM))); }
  tur.hard.push(L1(iron(rod([0, Y2 + 0.48, 0], [0, Y2 + 0.74, 0], 0.006, 4))), N(H.sheet(0.2, 0.09, 6, 2, (u, v) => [0, -0.02 * u * u, Math.sin(u * 7) * 0.014 * u]).at(0.1, Y2 + 0.68, 0).rot(0, 90, 0).color(tone(TRIM, -0.08, 0.2, -0.1)).pbr(0.9)));
  // --- clockwork at the stern: a great driving gear half out of the shell, a pinion, and the crank that winds it
  const GZ = -0.6, GY = 0.72;
  Sd.push(N(wooden(box(0.5, 0.36, 0.2).at(0, GY - 0.02, GZ + 0.06), DARKW)), L1(brassy(box(0.54, 0.03, 0.22).at(0, GY + 0.17, GZ + 0.06), TRIM)));
  const mkGear = (name, at, R, teeth, col, th = 0.035) => { const n = node(name, 'shell', at, { rig: 'gears' }); n.hard.push(N(gear(R, teeth, th).rot(0, 0, 90).at(...at).color(col).pbr(0.42, 0.9)), Fr(H.cyl(R * 0.92, R * 0.92, th, 8).rot(0, 0, 90).at(...at).color(col).pbr(0.42, 0.9)), L1(iron(H.cyl(R * 0.2, R * 0.2, th * 2.4, 8).rot(0, 0, 90).at(...at)))); nodes.push(n); return n; };
  mkGear('gearA', [0.12, GY, GZ - 0.08], 0.2, 14, TRIM);
  mkGear('gearB', [0.075, GY + 0.235, GZ - 0.035], 0.085, 6, 0x8a8f96);
  mkGear('gearC', [-0.1, GY - 0.02, GZ - 0.07], 0.13, 9, tone(TRIM, 0.02, -0.1, -0.12), 0.03);
  const crank = node('crank', 'shell', [-0.1, GY - 0.02, GZ - 0.07], { rig: 'crank' }); nodes.push(crank);
  crank.hard.push(iron(rod([-0.1, GY - 0.02, GZ - 0.07], [-0.3, GY - 0.02, GZ - 0.07], 0.014, 5)), iron(rod([-0.3, GY - 0.02, GZ - 0.07], [-0.3, GY + 0.12, GZ - 0.07], 0.013, 5)), wooden(rod([-0.3, GY + 0.12, GZ - 0.07], [-0.42, GY + 0.12, GZ - 0.07], 0.02, 6), 0x8a6a40));
  // a horizontal lantern gear under the turret
  const ring = node('gearT', 'shell', [0, Y2 - 0.035, 0], { rig: 'gears' }); nodes.push(ring);
  ring.hard.push(N(gear(RT + 0.085, 18, 0.03, 0.8).at(0, Y2 - 0.035, 0).color(TRIM).pbr(0.42, 0.9)));
  // --- wheels peeping from under the skirt
  const wh = wheel({ R: 0.17, w: 0.07, wood: DARKW, spokes: 6, studs: 0 });
  [[1, 0.42], [-1, 0.42], [1, -0.42], [-1, -0.42]].forEach(([sd, z], i) => { const n = node(`wheel${i}`, 'root', [sd * 0.5, 0.17, z], { rig: 'wheels' }); n.hard = placeWheel(wh, [sd * 0.5, 0.17, z], sd, i * 31); nodes.push(n); });
  root.hard.push(L1(iron(H.cyl(0.02, 0.02, 1.0, 6).rot(0, 0, 90).at(0, 0.17, 0.42))), L1(iron(H.cyl(0.02, 0.02, 1.0, 6).rot(0, 0, 90).at(0, 0.17, -0.42))));
  return { kind: 'warWagon', attack: 'shoot', nodes: finish(nodes) };
}

function wagonAnim(rig, inner, c, base) {
  const { keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk, dead = c.dead > 0;
  resetAll(rig, inner);
  const W = rig.wheels || [], G = rig.gears || [], guns = rig.gun && rig.gun[0], crank = rig.crank && rig.crank[0];
  const work = dead ? 0 : c.moving ? 1 : a >= 0 ? 0.6 : 0.12, turn = t * 3.2 * work + (dead ? 0 : Math.sin(t * 0.8 + ph) * 0.1);
  if (c.moving && !dead) W.forEach((w) => { w.rotation.x += t * 5; });
  // the train: each gear turns against its neighbour, faster the smaller it is
  if (G[0]) G[0].rotation.x += turn;
  if (G[1]) G[1].rotation.x += -turn * 2.35;
  if (G[2]) G[2].rotation.x += -turn * 1.55;
  if (G[3]) G[3].rotation.y += turn * 0.5;
  if (crank) crank.rotation.x += -turn * 1.55;
  if (!dead) {
    if (rig.turret) rig.turret.rotation.y += Math.sin(t * 0.45 + ph) * 0.9;
    inner.position.y = (c.moving ? Math.abs(Math.sin(t * 9 + ph)) * 0.006 : 0) * s;
    if (c.moving) inner.rotation.z = Math.sin(t * 4.5 + ph) * 0.01;
    if (a >= 0 && guns) {
      const k = keys(a, [[0, 0], [0.4, 0.03], [0.46, -1], [0.8, -0.2], [1, 0]]);                                 // the volley: every barrel kicks inward
      const sc = 1 + k * 0.1; guns.scale.set(sc, 1, sc);
      inner.position.y += Math.max(0, -k) * 0.012 * s;
    }
    return;
  }
  // the shell splits: the turret slides off, the cone lurches onto its rim and the guns hang
  const e = ease(c.dead * 1.4), e2 = ease(c.dead * 1.1 - 0.2);
  if (rig.turret) shed(rig.turret, e2, 0.5, -0.62, 0.25, 0.4, 0.5, -1.7);
  if (rig.body) { rig.body.rotation.z += 0.2 * e; rig.body.rotation.x += -0.1 * e; rig.body.position.y -= 0.09 * e; }
  if (guns) { const sc = 1 - 0.12 * e; guns.scale.set(sc, 1, sc); }
  W.forEach((w, i) => { const sd = (w.userData.rest[3] || 0) >= 0 ? 1 : -1; shed(w, e2, sd * (0.1 + (i % 2) * 0.08), -0.1, (i < 2 ? 0.12 : -0.12), 0, 0, -sd * 1.35); });
  G.forEach((g, i) => { if (i < 3) shed(g, e2, (i - 1) * 0.12, -0.45 - i * 0.08, -0.22 - i * 0.06, 1.2 + i, 0.4, 0.9); });
  if (crank) shed(crank, e2, -0.1, -0.5, -0.2, 1.4, 0, 0.6);
  sink(inner, c, 0.9, 0.45);
}

// =====================================================================================
//  IRON BULL  (o.wings: the living winged fire-bull)
// =====================================================================================
function ironBull(def, o = {}) {
  const alive = !!o.wings, COL = num(o.color, alive ? 0x4a1a14 : 0x2a2a30), GLOW = num(o.glow, 0xff5a14), TRIM = num(o.trim, 0xc9a23a);
  const HOT = mixHex(GLOW, 0xff9a2a, 0.35), DARK = tone(COL, 0, 0, -0.06), PALE = tone(COL, 0, -0.05, 0.08);
  const sk = alive
    ? (p) => p.color(COL).tint(0.22, 20).pbr(0.82, 0).bump(0.005, 44, 'fur')
    : (p) => p.color(tone(COL, 0, 0, 0.05)).tint(0.35, 14).pbr(0.55, 0.45);
  const seam = (p) => (alive ? null : p.color(GLOW).glow(1.1).paint(0.003, -0.004));
  const nodes = [], root = node('root', null, [0, 0, 0]); nodes.push(root);
  const BO = [0, 0.47, 0], body = node('body', 'root', BO, { rig: 'torso', detail: 1.1 }); nodes.push(body);
  const bp = body.prims, bh = body.hard;
  bp.push(
    sk(S.ellipsoid(0.2, 0.2, 0.27).at(0, 0.47, -0.04)),                                   // the furnace belly
    sk(S.ellipsoid(0.195, 0.215, 0.2).at(0, 0.52, 0.2)).blend(0.05),                      // chest
    sk(S.ellipsoid(0.15, 0.14, 0.16).at(0, 0.665, 0.16)).blend(0.06),                     // hump
    sk(S.ellipsoid(0.175, 0.185, 0.18).at(0, 0.5, -0.3)).blend(0.05),                     // rump
    sk(S.capsule([0, 0.56, 0.28], [0, 0.6, 0.44], 0.14, 0.115)).blend(0.05),              // root of the neck
  );
  if (!alive) {
    // plate seams: the fire shows through every joint
    for (const z of [-0.17, 0.04, 0.3]) bp.push(seam(S.torus(z > 0.2 ? 0.2 : 0.205, 0.011).rot(90, 0, 0).at(0, z > 0.2 ? 0.53 : 0.475, z)));
    bp.push(seam(S.capsule([0, 0.69, -0.42], [0, 0.72, 0.1], 0.01)), seam(S.capsule([0.13, 0.6, -0.42], [0.15, 0.62, 0.04], 0.009)), seam(S.capsule([-0.13, 0.6, -0.42], [-0.15, 0.62, 0.04], 0.009)));
    for (const sd of [1, -1]) {
      // furnace door on each flank: a grate with the fire behind it
      bh.push(N(H.cyl(0.082, 0.082, 0.02, 12).rot(0, 0, 90).at(sd * 0.188, 0.46, -0.05).color(HOT).glow(1.3)), Fr(H.cyl(0.08, 0.08, 0.02, 6).rot(0, 0, 90).at(sd * 0.19, 0.46, -0.05).color(HOT).glow(1.3)));
      bh.push(N(brassy(H.torus(0.086, 0.014, 14, 5).rot(0, 90, 0).at(sd * 0.198, 0.46, -0.05), TRIM)));
      for (let k = -2; k <= 2; k++) bh.push(L1(iron(box(0.014, 0.16 * Math.cos(k * 0.5), 0.012).at(sd * 0.203, 0.46, -0.05 + k * 0.03), 0x1c1c20)));
      for (const z of [-0.17, 0.04]) for (let k = 0; k < 7; k++) { const a = (k / 6) * 2.2 - 1.1; bh.push(L0(stud(0.009).at(sd * Math.cos(a) * 0.212, 0.475 + Math.sin(a) * 0.212, z + 0.02).color(PALE).pbr(0.4, 0.9))); }
    }
    bh.push(N(brassy(H.torus(0.2, 0.016, 16, 5, Math.PI * 1.1).rot(0, 0, -99).at(0, 0.53, 0.3), TRIM)));   // yoke of brass over the shoulders
  } else {
    bp.push(S.ellipsoid(0.1, 0.06, 0.3).at(0, 0.7, -0.08).color(DARK).paint(0.05), S.ellipsoid(0.15, 0.1, 0.22).at(0, 0.33, 0).color(PALE).paint(0.06));
    bh.push(N(brassy(H.torus(0.165, 0.022, 16, 6).rot(18, 0, 0).at(0, 0.585, 0.33), TRIM)));                // a collar of brass
    for (let k = 0; k < 7; k++) { const a = (k / 6) * Math.PI - Math.PI / 2; bh.push(L1(spikeAt([Math.sin(a) * 0.17, 0.585 + Math.cos(a) * 0.17, 0.33 - Math.cos(a) * 0.05], [Math.sin(a), Math.cos(a), 0.1], 0.05, 0.016, 4).color(TRIM).pbr(0.38, 0.9))); }
  }
  // vents along the spine, each with a flame standing in it
  const flames = [];
  [[-0.3, 0.675], [-0.12, 0.7], [0.03, 0.74]].forEach(([z, y], i) => {
    if (!alive) bh.push(NF((hi) => iron(H.lathe([[0.03, 0], [0.036, 0.05], [0.046, 0.07], [0.03, 0.07]], hi ? 8 : 5).at(0, y - 0.03, z), 0x1c1c20)));
    flames.push({ name: `vent${i}`, parent: 'body', o: [0, y + (alive ? -0.01 : 0.03), z], len: (alive ? 0.2 : 0.16) + i * 0.02, r: alive ? 0.06 : 0.04, dir: [0, 1, -0.25] });
  });

  // --- neck and head
  const NO = [0, 0.57, 0.3], neck = node('neck', 'body', NO, { rig: 'neck' }); nodes.push(neck);
  neck.prims.push(sk(S.capsule([0, 0.57, 0.31], [0, 0.6, 0.47], 0.125, 0.1)), sk(S.sphere(0.13).at(0, 0.57, 0.3)));
  if (alive) neck.prims.push(S.ellipsoid(0.05, 0.09, 0.1).at(0, 0.47, 0.4).color(PALE).pbr(0.85).blend(0.03));   // dewlap
  const HO = [0, 0.61, 0.49], head = node('head', 'neck', HO, { rig: 'head', detail: 1.6 }); nodes.push(head);
  const hp = head.prims, hh = head.hard;
  hp.push(
    sk(S.ellipsoid(0.098, 0.1, 0.11).at(0, 0.61, 0.52)),
    sk(S.capsule([0, 0.585, 0.56], [0, 0.515, 0.685], 0.075, 0.06)).blend(0.03),            // muzzle
    sk(S.ellipsoid(0.105, 0.035, 0.05).rot(-20, 0, 0).at(0, 0.665, 0.57)).blend(0.02),      // brow
    sk(S.ellipsoid(0.066, 0.04, 0.035).at(0, 0.505, 0.725)).blend(0.015),                   // nose pad
    ...S.mirrorX([
      S.sphere(0.022).at(0.062, 0.63, 0.6).cut(0.008).color(0x0c0808),
      S.ellipsoid(0.014, 0.012, 0.02).rot(0, 20, 0).at(0.028, 0.51, 0.752).cut(0.005).color(alive ? 0x1a0a08 : HOT),
    ]),
  );
  if (alive) hp.push(...S.mirrorX([sk(S.ellipsoid(0.05, 0.022, 0.03).rot(0, 0, -25).at(0.125, 0.63, 0.47)).blend(0.012)]));
  else hp.push(seam(S.capsule([0, 0.7, 0.5], [0, 0.56, 0.7], 0.005)), seam(S.torus(0.066, 0.005).rot(62, 0, 0).at(0, 0.55, 0.64)));
  for (const sd of [1, -1]) {
    hh.push(ball(0.017, 8).at(sd * 0.06, 0.63, 0.602).color(HOT).glow(1.4));
    // horns: sweep out, forward and up
    const pts = [[sd * 0.06, 0.675, 0.5], [sd * 0.17, 0.7, 0.49], [sd * 0.255, 0.76, 0.53], [sd * 0.265, 0.85, 0.62], [sd * 0.24, 0.9, 0.7]];
    const hc = alive ? 0xd8cdb0 : 0x8a8f96;
    hh.push(N(H.tube(pts, [0.04, 0.036, 0.028, 0.016, 0.003], 16, 8).color(hc).pbr(alive ? 0.4 : 0.35, alive ? 0 : 0.9).shade((x, y) => (y > 0.83 ? rgb(alive ? TRIM : 0xd8dce0) : null))), Fr(H.tube(pts, [0.038, 0.032, 0.024, 0.012, 0.003], 5, 4).color(hc).pbr(0.4, alive ? 0 : 0.9)));
    hh.push(L1(brassy(H.torus(0.04, 0.01, 10, 5).rot(0, 90, 15 * sd).at(sd * 0.085, 0.682, 0.498), TRIM)));
    flames.push({ name: `snort${sd > 0 ? 'L' : 'R'}`, parent: 'head', o: [sd * 0.028, 0.508, 0.755], len: 0.13, r: 0.026, dir: [sd * 0.25, -0.35, 1] });
  }
  hh.push(L1(brassy(H.torus(0.03, 0.007, 12, 5).rot(0, 0, 0).at(0, 0.482, 0.735), TRIM)));          // nose ring
  const JO = [0, 0.53, 0.55], jaw = node('jaw', 'head', JO, { rig: 'jaw' }); nodes.push(jaw);
  jaw.prims.push(sk(S.ellipsoid(0.052, 0.028, 0.075).at(0, 0.485, 0.63)), sk(S.sphere(0.03).at(0, 0.52, 0.56)));

  // --- legs
  const legs = [['FL', 1, 0.24, 0.44], ['FR', -1, 0.24, 0.44], ['BL', 1, -0.3, 0.46], ['BR', -1, -0.3, 0.46]];
  for (const [nm, sd, z, hy] of legs) {
    const front = z > 0, x = sd * 0.14, ky = 0.215, kz = z + (front ? 0.01 : -0.03);
    const L = node(`leg${nm}`, 'body', [x, hy, z], { rig: 'legs', minRes: 22 }); nodes.push(L);
    L.prims.push(sk(S.capsule([x, hy, z], [x, ky, kz], front ? 0.078 : 0.085, 0.05)), sk(S.sphere(front ? 0.085 : 0.095).at(x, hy + 0.02, z)));
    const Sn = node(`shin${nm}`, `leg${nm}`, [x, ky, kz], { rig: 'shins', minRes: 22 }); nodes.push(Sn);
    Sn.prims.push(sk(S.capsule([x, ky, kz], [x, 0.065, z + 0.005], 0.046, 0.04)), sk(S.sphere(0.052).at(x, ky, kz)));
    Sn.prims.push(S.cone(0.062, 0.046, 0.07, 0.008).at(x, 0.036, z + 0.012).color(alive ? TRIM : 0x1c1c20).pbr(alive ? 0.38 : 0.5, 0.9).blend(0.004));
    if (!alive) {
      Sn.prims.push(seam(S.torus(0.044, 0.005).at(x, 0.085, z + 0.006)));
      L.hard.push(L1(brassy(H.cyl(0.04, 0.04, 0.03, 10).rot(0, 0, 90).at(x + sd * 0.07, hy + 0.01, z), TRIM)));
      Sn.hard.push(L1(brassy(H.cyl(0.03, 0.03, 0.022, 8).rot(0, 0, 90).at(x + sd * 0.045, ky, kz), TRIM)));
    }
  }
  // --- tail: two joints and a tuft of fire
  const T0 = [0, 0.6, -0.45], T1 = [0, 0.5, -0.56];
  const t0 = node('tail0', 'body', T0, { rig: 'tail', minRes: 28 }), t1 = node('tail1', 'tail0', T1, { rig: 'tail', minRes: 28 }); nodes.push(t0, t1);
  t0.prims.push(sk(S.capsule(T0, T1, 0.03, 0.02)));
  t1.prims.push(sk(S.capsule(T1, [0, 0.3, -0.6], 0.02, 0.014)));
  flames.push({ name: 'tuft', parent: 'tail1', o: [0, 0.3, -0.6], len: 0.14, r: 0.04, dir: [0, -1, -0.3] });
  for (const f of flames) { const n = node(f.name, f.parent, f.o, { rig: 'flames' }); n.hard.push(orient(flame(f.len, f.r, HOT, GLOW), f.o, f.dir)); nodes.push(n); }

  // --- wings of the living bull: bat wings, an arm and three fingers of membrane
  if (alive) {
    const mem = rgb(tone(COL, 0.01, 0.1, 0.06)), memD = rgb(tone(COL, 0, 0, -0.08));
    for (const sd of [1, -1]) {
      const Sh = [sd * 0.12, 0.69, 0.12], E = [sd * 0.52, 0.71, 0.1];
      const w = node(`wing${sd > 0 ? 'L' : 'R'}`, 'body', Sh, { rig: 'wings', rot: [0, 0, sd * 24], minRes: 24 }); nodes.push(w);
      w.prims.push(sk(S.capsule(Sh, E, 0.036, 0.024)), sk(S.sphere(0.045).at(...Sh)));
      const inner = H.sheet(0.4, 0.5, 6, 5, (u, v) => { const z = 0.1 - v * (0.36 + 0.1 * u) + v * v * 0.05 * Math.abs(Math.sin(u * Math.PI)); return [0, -z - (v - 0.5) * 0.5, 0.025 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u)]; })
        .rot(-90, 0, 0).at(0.32, 0.71, 0).shade((x, y, z, nx, ny, nz, i) => mixRgb(mem, memD, clamp(noise3(x * 9, y * 9, 3) * 1.3 - 0.2))).color(COL).pbr(0.7, 0);
      w.hard.push(sd > 0 ? inner : inner.mirrorX());
      const tip = node(`wingtip${sd > 0 ? 'L' : 'R'}`, w.name, E, { rig: 'wingtips', rot: [0, 0, -sd * 30], minRes: 24 }); nodes.push(tip);
      const fingers = [[sd * 1.02, 0.71, 0.04], [sd * 0.95, 0.71, -0.22], [sd * 0.74, 0.71, -0.4]];
      for (const f of fingers) tip.prims.push(sk(S.capsule(E, f, 0.02, 0.008)));
      tip.hard.push(L1(spikeAt([E[0], E[1], E[2] + 0.01], [sd * 0.2, 0.3, 1], 0.08, 0.016, 5).color(0xd8cdb0).pbr(0.4)));
      const outer = H.sheet(0.5, 0.5, 8, 5, (u, v) => { const ch = 0.5 * (1 - 0.86 * u * u), z = 0.1 - 0.06 * u - v * ch + v * v * 0.08 * Math.abs(Math.sin(u * Math.PI * 2)); return [0, -z - (v - 0.5) * 0.5, 0.03 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u)]; })
        .rot(-90, 0, 0).at(0.77, 0.71, 0).shade((x, y) => mixRgb(mem, memD, clamp(noise3(x * 9, y * 9, 7) * 1.3 - 0.2))).color(COL).pbr(0.7, 0);
      tip.hard.push(sd > 0 ? outer : outer.mirrorX());
    }
  }
  return { kind: 'ironBull', attack: 'bite', nodes: finish(nodes), living: alive };
}

function bullAnim(rig, inner, c, base) {
  const t = c.t, ph = c.phase || 0, a = c.atk, dead = c.dead > 0;
  resetAll(rig, inner);
  base.quad(rig, inner, c);
  const L = rig.legs || [], Sn = rig.shins || [];
  if (!dead && !c.moving && !c.flying && a < 0 && L[1] && Sn[1]) {
    // paws the ground: three scrapes, then stands a while
    const u = ((t * 0.32 + ph * 0.3) % 1 + 1) % 1;
    if (u < 0.42) { const k = Math.sin((u / 0.42) * Math.PI * 3) ** 2; L[1].rotation.x += -0.55 * k; Sn[1].rotation.x += 1.0 * k; if (rig.head) rig.head.rotation.x += 0.18 * k; }
  }
  if (!dead && a >= 0) {
    // the charge: head down, horns hooked up through the target
    const k = base.keys(a, [[0, 0], [0.35, 0.55], [0.55, -0.6], [1, 0]]);
    if (rig.neck) rig.neck.rotation.x += k * 0.35;
    if (rig.torso) rig.torso.rotation.x += k * 0.06;
  }
  const size = dead ? Math.max(0, 1 - c.dead * 1.4) : a >= 0 ? 1.05 + 0.5 * Math.sin(clamp(a) * Math.PI) : c.moving || c.flying ? 1.15 : 0.85;
  flameAnim(rig.flames, c, size);
}

// =====================================================================================
//  DAEMON ENGINE  (o.legs 2: a walking engine; 4 or 6: a crawling forge)
// =====================================================================================
function daemonEngine(def, o = {}) {
  const COL = num(o.color, 0x26262c), GLOW = num(o.glow, 0xff5a14), TRIM = num(o.trim, 0xb88a3a), HOT = mixHex(GLOW, 0xff9a2a, 0.35);
  const nl = o.legs === 4 || o.legs === 6 ? o.legs : 2, crawler = nl > 2, mortar = o.arm === 'mortar' || (o.arm !== 'cannon' && crawler);
  const PL = tone(COL, 0, 0, 0.07), DK = tone(COL, 0, 0, -0.05), STEEL = 0x8a8f96;
  const blk = (p, c = COL) => p.color(tone(c, 0, 0, 0.04)).pbr(0.55, 0.45);
  const nodes = [], root = node('root', null, [0, 0, 0]); nodes.push(root);
  const dy = crawler ? -0.1 : 0, HY = 0.52 + dy;      // hip height
  const TOo = [0, HY, 0], torso = node('torso', 'root', TOo, { rig: 'torso' }); nodes.push(torso);
  const Td = torso.hard, Y = (y) => y + dy;
  // --- the boiler-chest: a riveted barrel, belted in brass, hunched a little forward
  const barrelP = (hi) => (hi ? [[0.001, 0.46], [0.2, 0.47], [0.27, 0.52], [0.31, 0.62], [0.325, 0.78], [0.31, 0.93], [0.25, 1.02], [0.16, 1.06], [0.001, 1.07]] : [[0.001, 0.46], [0.27, 0.52], [0.325, 0.78], [0.25, 1.02], [0.001, 1.07]]);
  Td.push(NF((hi) => blk(H.lathe(barrelP(hi), hi ? 20 : 8).at(0, dy, 0)).shade(hi ? worn(COL, 7, 0.07) : null)));
  for (const y of [0.56, 0.93]) Td.push(N(brassy(H.torus(y < 0.7 ? 0.295 : 0.312, 0.018, 20, 5).rot(90, 0, 0).at(0, Y(y), 0), TRIM)));
  for (const y of [0.56, 0.93]) for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, r = (y < 0.7 ? 0.295 : 0.312) + 0.02; Td.push(L0(stud(0.011).at(Math.cos(a) * r, Y(y), Math.sin(a) * r).color(tone(TRIM, 0, 0, 0.1)).pbr(0.4, 0.9))); }
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 + 0.3; if (Math.sin(a) > 0.75) continue; Td.push(L1(blk(bar([Math.cos(a) * 0.318, Y(0.6), Math.sin(a) * 0.318], [Math.cos(a) * 0.33, Y(0.9), Math.sin(a) * 0.33], 0.035, 0.014, [Math.cos(a), 0, Math.sin(a)]), PL))); }
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 + 0.3; if (Math.sin(a) > 0.75) continue; for (const y of [0.64, 0.75, 0.86]) Td.push(L0(stud(0.01).at(Math.cos(a) * 0.335, Y(y), Math.sin(a) * 0.335).color(tone(COL, 0, 0, 0.16)).pbr(0.4, 0.9))); }
  // feed pipes down the back, a pair of valve wheels
  for (const sd of [1, -1]) {
    Td.push(L1(H.tube([[sd * 0.1, Y(1.0), -0.22], [sd * 0.16, Y(0.86), -0.31], [sd * 0.14, Y(0.62), -0.31], [sd * 0.08, Y(0.5), -0.24]], 0.022, 12, 5).color(tone(TRIM, 0.02, -0.1, -0.12)).pbr(0.4, 0.9)));
    Td.push(L1(brassy(H.torus(0.04, 0.008, 10, 4).rot(0, 0, 0).at(sd * 0.16, Y(0.74), -0.345), TRIM)), L1(iron(H.cyl(0.008, 0.008, 0.05, 4).rot(90, 0, 0).at(sd * 0.16, Y(0.74), -0.33))));
  }
  // the furnace heart: a round door standing open on the fire, toothed like a mouth
  Td.push(NF((hi) => H.cyl(0.15, 0.15, 0.03, hi ? 16 : 7).rot(90, 0, 0).at(0, Y(0.75), 0.3).color(HOT).glow(1.4)));
  Td.push(NF((hi) => brassy(H.torus(0.158, 0.026, hi ? 18 : 7, 6).at(0, Y(0.75), 0.31), TRIM)));
  for (let k = -3; k <= 3; k++) Td.push(L1(iron(box(0.016, 0.29 * Math.cos(k * 0.33), 0.016).at(k * 0.04, Y(0.75), 0.325), 0x141418)));
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.39; Td.push(L1(spikeAt([Math.cos(a) * 0.16, Y(0.75) + Math.sin(a) * 0.16, 0.33], [Math.cos(a) * 0.5, Math.sin(a) * 0.5, 1], 0.07, 0.018, 4).color(STEEL).pbr(0.4, 0.9))); }
  // pelvis block and a skirt of hanging plates
  Td.push(NF((hi) => blk(H.lathe([[0.001, 0.4], [0.2, 0.4], [0.26, 0.44], [0.24, 0.52], [0.001, 0.52]], hi ? 10 : 6).at(0, dy, 0), DK)));
  if (!crawler) for (const a of [-40, 0, 40, 140, 180, 220]) Td.push(L1(blk(box(0.11, 0.15, 0.014).at(0, Y(0.4), 0.245).rot(0, a, 0), PL)), L1(brassy(box(0.11, 0.02, 0.018).at(0, Y(0.335), 0.246).rot(0, a, 0), TRIM)));
  // shoulder housings
  for (const sd of [1, -1]) {
    Td.push(NF((hi) => blk(ball(0.13, hi ? 12 : 6).scale(1, 0.9, 1).at(sd * 0.36, Y(0.95), 0), PL)), N(brassy(H.torus(0.115, 0.014, 14, 5).rot(0, 90, 0).at(sd * 0.4, Y(0.95), 0), TRIM)));
    for (let k = 0; k < 3; k++) Td.push(L1(spikeAt([sd * 0.4, Y(1.05), -0.06 + k * 0.06], [sd * 0.5, 1, 0], 0.09, 0.022, 4).color(STEEL).pbr(0.4, 0.9)));
    Td.push(L1(H.tube([[sd * 0.2, Y(1.02), -0.12], [sd * 0.3, Y(1.1), -0.1], [sd * 0.36, Y(1.02), -0.05]], 0.02, 8, 5).color(tone(TRIM, 0.02, -0.1, -0.12)).pbr(0.4, 0.9)));
  }
  // pressure gauge and a hanging chain
  Td.push(L1(brassy(H.cyl(0.045, 0.045, 0.02, 10).rot(90, 0, 28).at(0.19, Y(0.97), 0.2), TRIM)), L1(H.cyl(0.036, 0.036, 0.022, 10).rot(90, 0, 28).at(0.19, Y(0.97), 0.203).color(0xe8e0c8)));
  // --- chimney stacks on the back, and their smoke
  const stacks = [[-0.15, 1.0, -0.2, 0.3, 0.05], [0.02, 1.02, -0.26, 0.46, 0.06], [0.18, 0.98, -0.18, 0.24, 0.045]];
  stacks.forEach(([x, y, z, h, r], i) => {
    const n = node(`stack${i}`, 'torso', [x, Y(y), z], { rig: 'funnel' }); nodes.push(n);
    n.hard.push(NF((hi) => iron(H.lathe([[r * 1.2, -0.08], [r, 0], [r * 0.9, h * 0.85], [r * 1.25, h * 0.92], [r * 1.3, h], [r * 0.8, h], [r * 0.7, h * 0.8]], hi ? 10 : 5).rot(-8, 0, (x < 0 ? 1 : x > 0.1 ? -1 : 0) * 6).at(x, Y(y), z), 0x1a1a1e)));
    n.hard.push(L1(brassy(H.torus(r * 1.05, 0.009, 10, 4).rot(90 - 8, 0, 0).at(x, Y(y) + h * 0.5, z - h * 0.07), TRIM)));
    if (i < 2) for (let k = 0; k < 2; k++) { const s = node(`smoke${i}${k}`, 'torso', [x, Y(y) + h, z - h * 0.14], { rig: 'smoke' }); s.hard.push(puff(0.09, k ? 0x4a4a4e : 0x5e5e62, 0, i * 2 + k).at(x, Y(y) + h, z - h * 0.14)); nodes.push(s); }
    else { const f = node('stackFire', 'torso', [x, Y(y) + h * 0.95, z - h * 0.13], { rig: 'flames' }); f.hard.push(flame(0.16, 0.04, HOT, GLOW).at(x, Y(y) + h * 0.95, z - h * 0.13)); nodes.push(f); }
  });
  // --- head: a low iron cowl with a burning visor
  const HO = [0, Y(1.04), 0.12], head = node('head', 'torso', HO, { rig: 'head' }); nodes.push(head);
  head.hard.push(NF((hi) => blk(H.lathe([[0.13, -0.03], [0.125, 0.06], [0.09, 0.13], [0.03, 0.16], [0.001, 0.165]], hi ? 12 : 6).scale(1, 1, 1.15).at(...HO), PL)));
  head.hard.push(N(box(0.17, 0.028, 0.04).at(0, HO[1] + 0.055, HO[2] + 0.125).color(HOT).glow(1.4)), L1(blk(box(0.02, 0.05, 0.05).at(0, HO[1] + 0.055, HO[2] + 0.13), DK)), N(brassy(box(0.2, 0.02, 0.05).at(0, HO[1] + 0.085, HO[2] + 0.125), TRIM)));
  for (const sd of [1, -1]) head.hard.push(N(H.tube([[sd * 0.1, HO[1] + 0.09, HO[2]], [sd * 0.2, HO[1] + 0.14, HO[2] - 0.02], [sd * 0.24, HO[1] + 0.26, HO[2] + 0.04]], [0.035, 0.026, 0.004], 10, 6).color(STEEL).pbr(0.4, 0.9)));

  // --- arms: rig order is [left (+X), right (-X)]; the right arm strikes, so it carries the claw
  const arm = (sd, kind) => {
    const nm = sd > 0 ? 'L' : 'R', S0 = [sd * 0.44, Y(0.93), 0], E = [sd * 0.47, Y(0.64), 0.0], Wp = [sd * 0.47, Y(0.36), 0.02];
    const A = node(`arm${nm}`, 'torso', S0, { rig: 'arms' }); nodes.push(A);
    A.hard.push(NF((hi) => blk(rod(S0, E, 0.07, hi ? 10 : 5, 0.085), COL)), N(iron(rod([S0[0], S0[1] - 0.04, 0.06], [E[0], E[1] + 0.03, 0.06], 0.016, 5), STEEL)), L1(brassy(H.torus(0.078, 0.012, 12, 4).rot(90, 0, 0).at(S0[0] + sd * 0.012, Y(0.8), 0), TRIM)));
    A.hard.push(NF((hi) => brassy(H.cyl(0.085, 0.085, 0.13, hi ? 12 : 6).rot(0, 0, 90).at(...E), TRIM)));
    const Fn = node(`fore${nm}`, `arm${nm}`, E, { rig: 'forearms' }); nodes.push(Fn);
    if (kind === 'claw') {
      Fn.hard.push(NF((hi) => blk(rod(E, Wp, 0.08, hi ? 10 : 5, 0.06), PL)), N(brassy(H.torus(0.082, 0.014, 12, 4).rot(90, 0, 0).at(Wp[0], Wp[1] + 0.03, Wp[2]), TRIM)));
      Fn.hard.push(NF((hi) => blk(ball(0.085, hi ? 10 : 6).at(...Wp), DK)));
      // three hooked talons and a thumb
      for (const [ax, az, len] of [[-0.75, 1, 0.3], [0, 1.2, 0.34], [0.75, 1, 0.3], [0, -1, 0.22]]) {
        const p0 = [Wp[0] + ax * 0.05, Wp[1] - 0.04, Wp[2] + az * 0.045], p1 = [p0[0] + ax * 0.06, p0[1] - len * 0.45, p0[2] + az * 0.1], p2 = [p1[0] - ax * 0.02, p1[1] - len * 0.55, p1[2] - az * 0.06];
        Fn.hard.push(N(H.tube([p0, p1, p2], [0.034, 0.026, 0.003], 8, 5).color(STEEL).pbr(0.38, 0.9)), Fr(H.tube([p0, p1, p2], [0.03, 0.022, 0.003], 3, 3).color(STEEL).pbr(0.38, 0.9)));
      }
    } else {
      // the gun: a cannon (long) or a mortar (short and wide), muzzle down the arm
      const r = kind === 'mortar' ? 0.115 : 0.08, len = kind === 'mortar' ? 0.26 : 0.4;
      const prof = (hi) => (hi ? [[0.001, 0.05], [r * 0.8, 0.04], [r, 0], [r * 0.92, -len * 0.3], [r * 0.82, -len * 0.84], [r * 1.0, -len * 0.86], [r * 1.08, -len * 0.95], [r * 0.95, -len], [r * 0.62, -len], [r * 0.62, -len * 0.8], [0.001, -len * 0.8]] : [[0.001, 0.05], [r, 0], [r * 0.85, -len * 0.84], [r * 1.05, -len], [0.001, -len * 0.98]]);
      Fn.hard.push(NF((hi) => H.lathe(prof(hi), hi ? 14 : 6).at(E[0], E[1] - 0.06, E[2]).shade((x, y, z) => (y < -len * 0.97 && Math.hypot(x, z) < r * 0.7 ? [0.006, 0.006, 0.006] : null)).color(0x2e3036).pbr(0.45, 0.85)));
      for (const u of [0.25, 0.62]) Fn.hard.push(N(brassy(H.torus(r * 0.95, 0.014, 14, 5).rot(90, 0, 0).at(E[0], E[1] - 0.06 - len * u, E[2]), TRIM)));
      Fn.hard.push(L1(ball(r * 0.5, 8).at(E[0], E[1] - 0.06 - len * 0.82, E[2]).color(HOT).glow(1.1)));
    }
  };
  arm(1, mortar ? 'mortar' : 'cannon'); arm(-1, 'claw');

  // --- legs
  if (!crawler) {
    for (const sd of [1, -1]) {
      const nm = sd > 0 ? 'L' : 'R', Hp = [sd * 0.2, HY, 0], K = [sd * 0.21, 0.27, 0.02], Ft = [sd * 0.21, 0.06, 0.03];
      const Lg = node(`leg${nm}`, 'root', Hp, { rig: 'legs' }); nodes.push(Lg);
      Lg.hard.push(NF((hi) => blk(rod(Hp, K, 0.085, hi ? 10 : 5, 0.1), COL)), NF((hi) => brassy(H.cyl(0.1, 0.1, 0.16, hi ? 12 : 6).rot(0, 0, 90).at(...Hp), TRIM)), L1(brassy(H.torus(0.09, 0.013, 12, 4).rot(90, 0, 0).at(K[0], 0.36, K[2]), TRIM)));
      Lg.hard.push(L1(blk(box(0.13, 0.17, 0.02).at(K[0], 0.4, 0.1), PL)));
      const Sn = node(`shin${nm}`, `leg${nm}`, K, { rig: 'shins' }); nodes.push(Sn);
      Sn.hard.push(NF((hi) => iron(rod(K, Ft, 0.034, hi ? 8 : 4), STEEL)), N(blk(rod([K[0], 0.2, K[2]], Ft, 0.07, 8, 0.062), PL)), NF((hi) => brassy(H.cyl(0.075, 0.075, 0.15, hi ? 10 : 6).rot(0, 0, 90).at(...K), TRIM)));
      Sn.hard.push(N(iron(rod([K[0], 0.24, K[2] - 0.07], [Ft[0], 0.08, Ft[2] - 0.1], 0.014, 4), STEEL)));
      // foot: an iron shoe with three toes
      Sn.hard.push(NF((hi) => blk(H.lathe([[0.001, 0.09], [0.07, 0.08], [0.1, 0.03], [0.105, 0], [0.001, 0]], hi ? 8 : 5).scale(1, 1, 1.25).at(Ft[0], 0, Ft[2] + 0.01), DK)));
      for (const ax of [-0.06, 0, 0.06]) Sn.hard.push(N(spikeAt([Ft[0] + ax, 0.025, Ft[2] + 0.1], [ax * 3, -0.12, 1], 0.12, 0.03, 4).color(STEEL).pbr(0.4, 0.9)));
    }
  } else {
    // a round carriage, and the legs standing out from it like a spider's
    const CYy = 0.36;
    Td.push(NF((hi) => blk(H.lathe([[0.001, CYy - 0.1], [0.3, CYy - 0.1], [0.38, CYy - 0.04], [0.38, CYy + 0.05], [0.3, CYy + 0.1], [0.001, CYy + 0.1]], hi ? 16 : 8), DK)), N(brassy(H.torus(0.385, 0.018, 18, 5).rot(90, 0, 0).at(0, CYy, 0), TRIM)));
    const angs = nl === 6 ? [-52, 0, 52] : [-42, 42];
    let i = 0;
    for (const sd of [1, -1]) for (const ad of angs) {
      const a = ad * DEG, d = [sd * Math.cos(a), 0, Math.sin(a)], P0 = [d[0] * 0.34, CYy, d[2] * 0.34], K = [d[0] * 0.66, 0.66, d[2] * 0.66], Ft = [d[0] * 0.92, 0, d[2] * 0.92];
      const Lg = node(`leg${i++}`, 'root', P0, { rig: 'legs' }); nodes.push(Lg);
      Lg.hard.push(NF((hi) => blk(rod(P0, K, 0.06, hi ? 8 : 4, 0.045), COL)), NF((hi) => brassy(ball(0.075, hi ? 10 : 5).at(...P0), TRIM)), NF((hi) => brassy(ball(0.062, hi ? 10 : 5).at(...K), TRIM)));
      Lg.hard.push(NF((hi) => blk(rod(K, [Ft[0], 0.1, Ft[2]], 0.05, hi ? 8 : 4, 0.03), PL)), N(spikeAt([Ft[0], 0.14, Ft[2]], [d[0] * 0.2, -1, d[2] * 0.2], 0.15, 0.04, 5).color(STEEL).pbr(0.4, 0.9)), Fr(spikeAt([Ft[0], 0.14, Ft[2]], [d[0] * 0.2, -1, d[2] * 0.2], 0.15, 0.04, 3).color(STEEL).pbr(0.4, 0.9)));
      Lg.hard.push(N(iron(rod([P0[0] + d[0] * 0.05, CYy + 0.1, P0[2] + d[2] * 0.05], [lerp(P0[0], K[0], 0.7), lerp(P0[1], K[1], 0.7) + 0.06, lerp(P0[2], K[2], 0.7)], 0.016, 4), STEEL)));
    }
  }
  return { kind: 'daemonEngine', attack: 'swing', nodes: finish(nodes), crawler: crawler ? nl : 0 };
}

function engineAnim(rig, inner, c, base) {
  const s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk, dead = c.dead > 0;
  resetAll(rig, inner);
  const L = rig.legs || [], Sn = rig.shins || [], A = rig.arms || [], F = rig.forearms || [];
  const alive = { t, phase: ph, moving: c.moving && !dead, atk: dead ? -1 : a, dead: 0, flying: false };
  if (rig.crawler) { base.spider(rig, inner, alive); base.upperBody(rig, alive); } else base.biped(rig, inner, alive);
  // the gun arm stays levelled forward a little, and kicks when the claw strikes
  if (F[0]) F[0].rotation.x = (F[0].userData.rest[0] || 0) - 0.5 - (a >= 0 ? base.keys(a, [[0, 0], [0.3, 0.9], [0.45, 0.6], [1, 0]]) : 0);
  if (!dead) {
    if (!rig.crawler && c.moving) inner.position.y += Math.abs(Math.sin(t * 9.5 + ph)) * 0.02 * s;
    if (rig.torso) rig.torso.rotation.z += Math.sin(t * 1.3 + ph) * 0.012;
    smokeAnim(rig.smoke, c, c.moving ? 0.8 : 0.5, 0.5, -0.2, a >= 0 ? 1.4 : 1);
    flameAnim(rig.flames, c, a >= 0 ? 1.5 : 1);
    return;
  }
  // the fire goes out: knees fold, the trunk pitches forward over them, the stacks break off
  const e = ease(c.dead * 1.4), e2 = ease(c.dead * 1.2 - 0.25);
  if (rig.crawler) {
    L.forEach((l) => { const sd = (l.userData.rest[3] || 0) >= 0 ? 1 : -1; l.rotation.z = (l.userData.rest[2] || 0) + sd * 0.55 * e; });
    inner.position.y = -0.3 * e * s;
    if (rig.torso) rig.torso.rotation.x += 0.35 * e2;
  } else {
    for (let i = 0; i < L.length; i++) { L[i].rotation.set(-1.05 * e, 0, (i ? -1 : 1) * 0.12 * e); if (Sn[i]) Sn[i].rotation.set(1.95 * e, 0, 0); }
    inner.position.y = -0.3 * e * s;
    if (rig.torso) rig.torso.rotation.x += 0.75 * e2;
    inner.position.z = 0.1 * e * s;
  }
  A.forEach((ar, i) => { ar.rotation.set(-0.5 * e2, 0, (i ? -1 : 1) * 0.3 * e2); if (F[i]) F[i].rotation.set(-0.3 * e2, 0, 0); });
  if (rig.head) rig.head.rotation.x += 0.4 * e2;
  (rig.funnel || []).forEach((n, i) => shed(n, e2, (i - 1) * 0.3, -0.5, -0.35, -1.6, 0, (i - 1) * 0.8));
  smokeAnim(rig.smoke, c, 0.6, 0.5, -0.1, 1.3 * (1 - clamp(c.dead - 0.9) * 2.5));
  flameAnim(rig.flames, c, Math.max(0, 1 - c.dead * 1.6));
  sink(inner, c, 0.9, 0.5);
}

// =====================================================================================
//  WAR BALLOON
// =====================================================================================
function balloon(def, o = {}) {
  const COL = num(o.color, 0xb8201a), TRIM = num(o.trim, 0xd8b03a), GLOW = num(o.glow, 0xff7a1c), WICK = 0xa8824a, LAC = tone(COL, 0, -0.05, -0.12), ROPE = 0xb49a64;
  const nodes = [], root = node('root', null, [0, 0, 0]); nodes.push(root);
  // --- envelope: painted silk in gores, a broad band at the waist with tassels below it
  const NY = 0.98, env = node('envelope', 'root', [0, NY, 0], { rig: 'envelope' }); nodes.push(env);
  const ctrl = [[0.105, 0.95], [0.13, 0.99], [0.25, 1.07], [0.42, 1.22], [0.555, 1.42], [0.6, 1.6], [0.575, 1.8], [0.47, 1.99], [0.29, 2.13], [0.12, 2.19], [0.001, 2.2]];
  const prof = (n) => { const c = new THREE.SplineCurve(ctrl.map((q) => new THREE.Vector2(q[0], q[1]))), out = []; for (let i = 0; i <= n; i++) { const p = c.getPoint(i / n); out.push([Math.max(0.001, p.x), p.y]); } out[n] = [0.001, 2.2]; return out; };
  const ca = rgb(COL), cb = rgb(tone(COL, 0.01, -0.04, 0.07)), ct = rgb(TRIM), cd = rgb(tone(COL, 0, 0.02, -0.14)), cw = rgb(0xf0e6cc), G = 12;
  const silk = (x, y, z) => {
    const ang = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2), g = ang * G, f = g % 1, k = Math.floor(g) % 2;
    if (y > 2.1) return ct;                                               // the crown
    if (y < 1.0) return cd;
    if (y > 1.5 && y < 1.69) {                                            // the waist band: gold with a row of roundels
      const m = Math.hypot((f - 0.5) * 0.3, y - 1.595);
      return y > 1.665 || y < 1.525 ? cd : m < 0.05 ? (m < 0.026 ? cw : ca) : ct;
    }
    if (f < 0.07 || f > 0.93) return ct;                                  // seams piped in gold
    if (y > 1.74 && y < 2.02 && Math.abs(f - 0.5) < 0.2 * (1 - Math.abs(y - 1.88) / 0.14)) return k ? ct : cw;   // a lozenge on each gore
    if (y > 1.1 && y < 1.44 && Math.abs(f - 0.5) < 0.16 * (1 - Math.abs(y - 1.27) / 0.17)) return k ? cw : ct;
    return k ? ca : cb;
  };
  env.hard.push(N(H.lathe(prof(40), 48).shade(silk).color(COL).pbr(0.62, 0)), Fr(H.lathe(prof(9), 12).shade((x, y) => (y > 1.5 && y < 1.69 ? ct : null)).color(COL).pbr(0.62, 0)));
  env.hard.push(N(brassy(H.lathe([[0.03, 0], [0.04, 0.04], [0.015, 0.09], [0.001, 0.13]], 8).at(0, 2.2, 0), TRIM)));
  for (let k = 0; k < 24; k++) {
    const a = ((k + 0.5) / 24) * Math.PI * 2, r = 0.578;
    env.hard.push(L1(H.cone(0.022, 0.085, 5).rot(180, 0, 0).at(Math.cos(a) * r, 1.47, Math.sin(a) * r).color(k % 2 ? TRIM : 0xf0e6cc).pbr(0.85)), L0(ball(0.014, 5).at(Math.cos(a) * r, 1.515, Math.sin(a) * r).color(TRIM).pbr(0.4, 0.8)));
  }
  env.hard.push(N(wooden(H.torus(0.11, 0.014, 12, 5).rot(90, 0, 0).at(0, 0.955, 0), LAC)));
  // --- gondola: hangs from the load ring on eight ropes
  const GO = [0, 0.94, 0], gon = node('gondola', 'root', GO, { rig: 'gondola' }); nodes.push(gon);
  const Gd = gon.hard, BW = 0.25, BL = 0.36, BTop = 0.4;
  const wa = rgb(WICK), wb2 = rgb(tone(WICK, 0, 0, -0.14));
  const weave = (x, y, z) => { const ang = Math.atan2(z, x), band = Math.floor(y / 0.022), st = Math.floor((ang + Math.PI) * 9 + (band % 2) * 0.5); return st % 2 ? wa : wb2; };
  Gd.push(N(H.lathe([[0.001, 0.07], [0.78, 0.07], [0.92, 0.12], [1, 0.26], [1, BTop], [0.93, BTop], [0.93, 0.27], [0.85, 0.14], [0.001, 0.12]].map(([r, y]) => [r * BW, y]), 28).scale(1, 1, BL / BW).shade(weave).color(WICK).pbr(0.9)));
  Gd.push(Fr(H.lathe([[0.001, 0.07], [0.9 * BW, 0.1], [BW, BTop], [0.001, BTop - 0.1]], 8).scale(1, 1, BL / BW).color(WICK).pbr(0.9)));
  Gd.push(NF((hi) => wooden(H.torus(BW + 0.004, 0.02, hi ? 24 : 8, 5).rot(90, 0, 0).scale(1, 1, BL / BW).at(0, BTop, 0), LAC)), N(wooden(H.torus(BW * 0.96, 0.014, 24, 5).rot(90, 0, 0).scale(1, 1, BL / BW).at(0, 0.2, 0), LAC)));
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; Gd.push(L0(stud(0.012).at(Math.cos(a) * (BW + 0.02), BTop, Math.sin(a) * (BL + 0.02)).color(TRIM).pbr(0.4, 0.9))); }
  for (const sd of [1, -1]) Gd.push(N(wooden(bar([sd * 0.12, 0.02, -BL * 0.9], [sd * 0.12, 0.02, BL * 0.9], 0.03, 0.04), LAC)), L1(wooden(bar([sd * 0.12, 0.03, BL * 0.9], [sd * 0.12, 0.1, BL * 1.08], 0.03, 0.03), LAC)));   // skids
  // ropes up to the load ring, and from the ring to the envelope's waist
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
    Gd.push(N(rod([cs * BW, BTop, sn * BL], [cs * 0.11, 0.955, sn * 0.11], 0.006, 4).color(ROPE).pbr(0.95)));
    env.hard.push(N(rod([cs * 0.11, 0.955, sn * 0.11], [cs * 0.5, 1.33, sn * 0.5], 0.005, 4).color(ROPE).pbr(0.95)));
  }
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; Gd.push(Fr(rod([Math.cos(a) * BW, BTop, Math.sin(a) * BL], [Math.cos(a) * 0.11, 0.955, Math.sin(a) * 0.11], 0.008, 3).color(ROPE).pbr(0.95))); }
  // sandbags, an anchor
  for (const [x, z] of [[BW + 0.03, 0.12], [-BW - 0.03, -0.14], [0.08, -BL - 0.04]]) Gd.push(L1(puff(0.045, 0xb8a888, 0, 3).scale(1, 1.3, 1).at(x, 0.24, z)), L1(rod([x, 0.3, z], [x * 0.92, BTop, z * 0.92], 0.004, 3).color(ROPE)));
  // burner: an iron fire basket under the mouth
  Gd.push(N(iron(H.lathe([[0.02, 0], [0.06, 0.02], [0.075, 0.08], [0.06, 0.08], [0.05, 0.03], [0.001, 0.02]], 10).at(0, 0.78, 0), 0x2a2a2e)), N(ball(0.05, 8).scale(1, 0.5, 1).at(0, 0.85, 0).color(GLOW).glow(1.4)));
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; Gd.push(L1(iron(rod([Math.cos(a) * 0.06, 0.8, Math.sin(a) * 0.06], [Math.cos(a) * BW * 0.8, BTop, Math.sin(a) * BL * 0.8], 0.006, 3), 0x2a2a2e))); }
  const fl = node('burner', 'gondola', [0, 0.86, 0], { rig: 'flames' }); fl.hard.push(flame(0.16, 0.045, mixHex(GLOW, 0xff9a2a, 0.4), GLOW).at(0, 0.86, 0)); nodes.push(fl);
  // crew: a bombardier and a fire-tender in lacquered hats
  [[0.07, 0.13, 0x2a4a6a], [-0.08, -0.12, 0x3a5a3a]].forEach(([x, z, coat], i) => {
    const n = node(`crew${i}`, 'gondola', [x, 0.28, z], { rig: 'crew', detail: 1.8, minRes: 30 }); nodes.push(n);
    const cb3 = crewBust([x, 0.3, z], { coat, hat: false });
    n.prims.push(cb3.prims);
    n.hard.push(H.lathe([[0.001, 0.07], [0.1, 0], [0.1, -0.008], [0.001, 0.02]], 10).at(x, 0.57, z).color(i ? TRIM : LAC).pbr(0.5));
  });
  // rocket racks on either beam: a frame of six tubes, noses out over the bow
  for (const sd of [1, -1]) {
    const RO = [sd * (BW + 0.075), 0.36, 0.04], rk = node(`rack${sd > 0 ? 'L' : 'R'}`, 'gondola', RO, { rig: 'racks' }); nodes.push(rk);
    rk.hard.push(N(wooden(box(0.1, 0.02, 0.26).rot(-14, 0, 0).at(RO[0], RO[1] - 0.04, RO[2]), LAC)), N(wooden(box(0.1, 0.02, 0.26).rot(-14, 0, 0).at(RO[0], RO[1] + 0.045, RO[2]), LAC)), L1(wooden(box(0.02, 0.1, 0.02).at(RO[0], RO[1], RO[2] - 0.1), LAC)), L1(wooden(box(0.02, 0.1, 0.02).at(RO[0], RO[1] + 0.04, RO[2] + 0.1), LAC)));
    rk.hard.push(L1(wooden(bar([sd * BW, 0.3, 0.02], [RO[0], RO[1] - 0.04, RO[2]], 0.02, 0.02), LAC)));
    for (let r = 0; r < 2; r++) for (let q = 0; q < 3; q++) {
      const p = [RO[0] + (q - 1) * 0.03, RO[1] - 0.02 + r * 0.04, RO[2]], d = [0, 0.24, 0.97];
      rk.hard.push(N(orient(H.cyl(0.012, 0.012, 0.24, 5).at(0, 0, 0), p, d).color(0x8a6a40).pbr(0.8)), L1(orient(H.cone(0.017, 0.05, 5).at(0, 0.145, 0), p, d).color(COL).pbr(0.6)), L1(orient(H.cyl(0.002, 0.002, 0.12, 3).at(0, -0.18, 0), p, d).color(0x3a2a1c)));
    }
    rk.hard.push(Fr(box(0.09, 0.07, 0.26).rot(-14, 0, 0).at(...RO).color(0x8a6a40).pbr(0.8)));
  }
  return { kind: 'balloon', attack: 'shoot', nodes: finish(nodes) };
}

function balloonAnim(rig, inner, c, base) {
  const s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk, dead = c.dead > 0;
  resetAll(rig, inner);
  const env = rig.envelope && rig.envelope[0], gon = rig.gondola && rig.gondola[0];
  if (!dead) {
    const fly = c.flying ? 1 : 0.2, sway = Math.sin(t * 0.9 + ph) * 0.05 * fly, sway2 = Math.cos(t * 0.7 + ph * 1.3) * 0.04 * fly;
    inner.rotation.z = sway; inner.rotation.x = sway2 + (c.moving && c.flying ? 0.06 : 0);
    inner.position.y = (c.flying ? Math.sin(t * 1.1 + ph) * 0.05 : 0) * s;
    if (gon) { gon.rotation.z += -sway * 1.6; gon.rotation.x += -sway2 * 1.6; }                              // the basket hangs plumb under a leaning bag
    if (env) { const b = 1 + Math.sin(t * 1.7 + ph) * 0.012; env.scale.set(b, 2 - b, b); }
    (rig.crew || []).forEach((n, i) => { n.rotation.y += Math.sin(t * 0.8 + i * 2 + ph) * 0.5; n.position.y += Math.sin(t * 2 + i) * 0.004; });
    let burn = 0.9;
    if (a >= 0) {
      const k = base.keys(a, [[0, 0], [0.4, 0.05], [0.46, -1], [0.8, -0.2], [1, 0]]);                            // the rockets go: racks kick, basket swings back
      (rig.racks || []).forEach((n) => nudge(n, 0, 0, k * 0.07, -k * 0.12, 0, 0));
      if (gon) gon.rotation.x += k * 0.08;
      burn = 1.3;
    }
    flameAnim(rig.flames, c, burn);
    return;
  }
  // holed: the bag folds up and comes down over the basket
  const e = ease(c.dead * 1.2), e2 = ease(c.dead * 1.5 - 0.5);
  if (env) { env.scale.set(1 + 0.12 * e - 0.3 * e2, Math.max(0.3, 1 - 0.68 * e), 1 + 0.12 * e - 0.25 * e2); env.rotation.z += -1.25 * e; env.rotation.x += 0.25 * e; env.position.y -= 0.72 * e; env.position.x += 0.3 * e; }
  if (gon) { gon.rotation.z += -0.5 * e; gon.position.y -= 0.02 * e; }
  flameAnim(rig.flames, c, Math.max(0, 1 - c.dead * 2));
  sink(inner, c, 1.0, 0.45);
}

// =====================================================================================
//  FLYING CARPET
// =====================================================================================
const CARPET_N = 9, CARPET_L = 1.16, CARPET_W = 0.7;
function carpet(def, o = {}) {
  const COL = num(o.color, 0xa82a2a), TRIM = num(o.trim, 0xd8b03a), INK = 0x1c2a52, CREAM = 0xeadfc0, CY = 0.035;
  const nodes = [], root = node('root', null, [0, 0, 0]); nodes.push(root);
  const ca = rgb(COL), cd = rgb(tone(COL, 0, 0.03, -0.1)), ct = rgb(TRIM), ci = rgb(INK), cc = rgb(CREAM);
  // the design, in carpet coordinates: x across (-W/2..W/2), z along (-L/2..L/2)
  const design = (x, z) => {
    const ax = Math.abs(x), az = Math.abs(z), hx = CARPET_W / 2, hz = CARPET_L / 2, bx = hx - ax, bz = hz - az, b = Math.min(bx, bz);
    if (b < 0.022) return ct;                                           // outer band
    if (b < 0.04) return ci;
    if (b < 0.095) { const u = (bx < bz ? z : x) / 0.07, f = Math.abs((u % 1 + 1) % 1 - 0.5); return f < 0.2 ? cc : f < 0.34 ? ct : ci; }   // guard border of running lozenges
    if (b < 0.112) return ct;
    const m = ax / 0.2 + az / 0.3;                                      // central medallion
    if (m < 0.34) return cc;
    if (m < 0.62) return ci;
    if (m < 0.78) return ct;
    const cxn = (hx - 0.112 - ax) / 0.13 + (hz - 0.112 - az) / 0.13;    // corner pieces echo it
    if (cxn < 0.62) return ci;
    if (cxn < 0.8) return ct;
    const gx = ((x + 10) / 0.085) % 1 - 0.5, gz = ((z + 10) / 0.085) % 1 - 0.5;   // field of small flowers
    return Math.abs(gx) + Math.abs(gz) < 0.2 ? cc : Math.abs(gx) + Math.abs(gz) < 0.3 ? cd : ca;
  };
  const SL = CARPET_L / CARPET_N;
  for (let i = 0; i < CARPET_N; i++) {
    const zc = -CARPET_L / 2 + (i + 0.5) * SL, n = node(`strip${i}`, 'root', [0, CY, zc], { rig: 'strips' }); nodes.push(n);
    // each panel overlaps its neighbours a little so the pile never opens as it ripples
    n.hard.push(N(H.sheet(CARPET_W, SL * 1.12, 28, 6).shade((x, y) => design(x, zc - y)).rot(-90, 0, 0).at(0, CY + 0.007, zc).color(COL).pbr(0.92)));
    n.hard.push(Fr(H.sheet(CARPET_W, SL * 1.12, 6, 1).shade((x, y) => design(x, zc - y)).rot(-90, 0, 0).at(0, CY + 0.007, zc).color(COL).pbr(0.92)));
    n.hard.push(box(CARPET_W - 0.004, 0.012, SL * 1.1).at(0, CY, zc).color(tone(COL, 0, -0.1, -0.16)).pbr(0.95));
    if (i === 0 || i === CARPET_N - 1) {
      const sg = i ? 1 : -1, ze = zc + sg * SL * 0.56;
      for (let k = 0; k < 15; k++) { const x = -CARPET_W / 2 + 0.025 + k * (CARPET_W - 0.05) / 14; n.hard.push(L1(H.cone(0.011, 0.07, 4).rot(sg * 78, 0, 0).at(x, CY - 0.004, ze + sg * 0.03).color(k % 2 ? TRIM : CREAM).pbr(0.9))); }
      n.hard.push(Fr(box(CARPET_W, 0.006, 0.06).at(0, CY - 0.002, ze + sg * 0.03).color(TRIM).pbr(0.9)));
      // a heavy tassel at each corner
      for (const sd of [1, -1]) n.hard.push(N(H.lathe([[0.001, 0], [0.016, -0.012], [0.02, -0.03], [0.012, -0.04], [0.024, -0.1], [0.001, -0.105]], 6).rot(sg * 62, 0, sd * -20).at(sd * (CARPET_W / 2 - 0.008), CY, ze).color(TRIM).pbr(0.6, 0.3)));
    }
  }
  // --- the seat: a bolster and cushion for the rider, moving with the middle of the carpet
  const SO = [0, CY, -0.02], seat = node('seat', 'root', SO, { rig: 'seat' }); nodes.push(seat);
  seat.hard.push(N(H.lathe([[0.001, 0.05], [0.12, 0.048], [0.17, 0.03], [0.175, 0.012], [0.12, 0], [0.001, 0]], 14).scale(1, 1, 1.15).at(0, CY + 0.008, -0.04).color(INK).pbr(0.9).shade((x, y, z) => (Math.hypot(x, z) > 0.15 ? ct : null))));
  seat.hard.push(Fr(H.cyl(0.15, 0.17, 0.045, 6).at(0, CY + 0.03, -0.04).color(INK).pbr(0.9)));
  for (const a of [45, 135, 225, 315]) seat.hard.push(L1(ball(0.014, 5).at(Math.cos(a * DEG) * 0.17, CY + 0.02, -0.04 + Math.sin(a * DEG) * 0.195).color(TRIM).pbr(0.4, 0.8)));
  // a brass lamp and a water flask ride along
  seat.hard.push(L1(brassy(H.lathe([[0.001, 0], [0.03, 0.004], [0.036, 0.03], [0.014, 0.05], [0.012, 0.075], [0.02, 0.085], [0.001, 0.09]], 8).at(0.24, CY + 0.014, 0.3), TRIM)), L1(brassy(H.tube([[0.27, CY + 0.045, 0.3], [0.31, CY + 0.055, 0.3], [0.335, CY + 0.08, 0.3]], [0.01, 0.007, 0.004], 6, 4), TRIM)));
  seat.hard.push(L1(H.lathe([[0.001, 0], [0.035, 0.01], [0.04, 0.05], [0.014, 0.08], [0.014, 0.1], [0.001, 0.1]], 8).at(-0.24, CY + 0.014, 0.26).color(0x7a5a36).pbr(0.8)));

  // --- the rider
  const extra = {};
  let seated = false;
  try {
    const ro = o.rider && typeof o.rider === 'object' ? o.rider : { species: 'human', outfit: 'silkRobe', weapon: 'longbow', skin: 0xc68e5c, cloth: tone(COL, 0.5, -0.1, 0.05), cloth2: TRIM, trim: TRIM };
    const rdesc = { ...ro, body: 'humanoid', pose: 'riding', alt: undefined, scale: undefined };
    const P = proportions(rdesc), f = clamp(num(ro.scale, 1), 0.6, 1.3);
    const desc = humanoid({ ...(def || {}), id: `${(def && def.id) || 'carpet'}:rider` }, rdesc);
    const seatY = CY + 0.05 + P.rThigh * 0.9 * f;
    for (const n of desc.nodes) {
      const m = { ...n, name: n.name === 'root' ? 'rider' : `r_${n.name}` };
      if (n.name === 'root') { m.parent = 'seat'; m.pos = [0, seatY - CY - P.hipY * f, -0.04 - SO[2]]; m.rig = 'rider'; }
      else { m.parent = n.parent === 'root' ? 'rider' : `r_${n.parent}`; m.pos = [n.pos[0] * f, n.pos[1] * f, n.pos[2] * f]; }
      // legs folded tailor-fashion on the cushion
      if (n.name === 'legL') m.rot = [-84, 0, 52]; else if (n.name === 'legR') m.rot = [-90, 0, -52];
      else if (n.name === 'shinL') m.rot = [0, 0, -142]; else if (n.name === 'shinR') m.rot = [0, 0, 142];
      if (f !== 1) { m.prims = flat(n.prims); m.hard = flat(n.hard); for (const q of m.prims) q.scale(f); for (const q of m.hard) q.scale(f); }
      nodes.push({ ...m, raw: true });
    }
    for (const [k, v] of Object.entries(desc)) if (k !== 'nodes' && k !== 'kind' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) extra[k === 'attack' ? 'attack' : k] = v;
    extra.hipH = P.hipY * f;
    seated = true;
  } catch (err) {
    // a plain robed figure, kneeling
    const n = node('rider', 'seat', [0, CY + 0.05, -0.04], { rig: 'rider', detail: 1.6, minRes: 40 });
    const cb = crewBust([0, CY + 0.2, -0.04], { coat: tone(COL, 0.5, -0.1, 0.05), s: 1.7, hat: false });
    n.prims.push(cb.prims, S.cone(0.19, 0.11, 0.2, 0.03).at(0, CY + 0.15, -0.03).color(tone(COL, 0.5, -0.1, 0.05)).pbr(0.9).blend(0.03));
    n.hard.push(H.lathe([[0.001, 0.09], [0.07, 0.08], [0.1, 0.03], [0.09, -0.02], [0.001, -0.02]], 10).at(0, CY + 0.66, -0.04).color(CREAM).pbr(0.9));
    nodes.push(n);
  }
  const fin = finish(nodes.filter((n) => !n.raw));
  for (const n of nodes) if (n.raw) { const m = { ...n }; delete m.raw; fin.push(m); }
  return { ...extra, kind: 'carpet', attack: extra.attack || 'shoot', nodes: fin, seated };
}

const _cu = {};
function carpetAnim(rig, inner, c, base) {
  const s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, dead = c.dead > 0;
  resetAll(rig, inner);
  const St = rig.strips || [], seat = rig.seat && rig.seat[0], n = St.length || 1;
  // a wave runs down the carpet from front to back; on the ground it only stirs
  const amp = dead ? 0 : c.flying ? (c.moving ? 0.034 : 0.024) : 0.004, k = 6.2, w = c.moving ? 7.5 : 3.6;
  const yAt = (z) => amp * Math.sin(w * t + k * z + ph) * (0.55 + 0.9 * Math.abs(z)), slope = (z) => (yAt(z + 0.01) - yAt(z - 0.01)) / 0.02;
  const roll = (z) => amp * 0.9 * Math.cos(w * 0.6 * t + k * 0.5 * z + ph);
  St.forEach((p) => { const r = p.userData.rest, z = r[5]; p.position.y = r[4] + yAt(z); p.rotation.set(r[0] - Math.atan(slope(z)), 0, r[2] + roll(z)); });
  if (seat) { const r = seat.userData.rest; seat.position.y = r[4] + yAt(r[5]) * 0.8; seat.rotation.x = r[0] - Math.atan(slope(r[5])) * 0.5; }
  if (rig.seated && rig.torso && rig.arms) {
    _cu.t = t; _cu.phase = ph; _cu.dead = c.dead; _cu.flying = false; _cu.moving = false; _cu.atk = dead ? -1 : c.atk;
    base.upperBody(rig, _cu);
    poseCarried(rig, _cu, base, rig.hold || 'none', false);
    if (!dead && rig.torso) rig.torso.rotation.x += c.moving && c.flying ? 0.1 : 0.02;
  }
  if (!dead) {
    inner.position.y = (c.flying ? Math.sin(t * 1.5 + ph) * 0.03 : 0) * s;
    inner.rotation.z = c.flying ? Math.sin(t * 1.1 + ph) * 0.05 : 0;
    inner.rotation.x = c.flying && c.moving ? 0.07 : 0;
    return;
  }
  // the spell breaks: the carpet goes limp and rucks up, and the rider is thrown down across it
  const e = ease(c.dead * 1.6);
  St.forEach((p, i) => { const r = p.userData.rest, h = Math.sin(i * 12.9898 + ph * 3) * 43758.5453, f = h - Math.floor(h); p.rotation.set(r[0] + (f - 0.5) * 0.22 * e, 0, r[2] + (i % 2 ? 1 : -1) * 0.05 * e); p.position.y = r[4] + Math.abs(f - 0.5) * 0.02 * e; p.position.z = r[5] * (1 - 0.06 * e); });
  const rd = rig.rider && rig.rider[0];
  if (rd) { const r = rd.userData.rest, h = rig.hipH || 0, th = -1.4 * e; rd.rotation.set(r[0] + th, r[1], r[2]); rd.position.set(r[3], r[4] + h * (1 - Math.cos(th)) - 0.03 * e, r[5] - h * Math.sin(th) - 0.1 * e); }   // falls back about the hips
  if (rig.head) rig.head.rotation.y += 0.6 * e;
  (rig.arms || []).forEach((ar, i) => { ar.rotation.z += (i ? -1 : 1) * 0.9 * e; });
  sink(inner, c, 1.0, 0.35);
}

// =====================================================================================
export const bodies = { steamTank, wheelEngine, warWagon, ironBull, daemonEngine, balloon, carpet };
export const animators = { steamTank: tankAnim, wheelEngine: wheelAnim, warWagon: wagonAnim, ironBull: bullAnim, daemonEngine: engineAnim, balloon: balloonAnim, carpet: carpetAnim };
