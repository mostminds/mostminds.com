// Sky-behemoths: every faction's colossal flagship of the air (AIRSHIPS entries with `behemoth: true`, designs in
// src/data/air/*.js), modelled from its design: the `form` lays down the body (airship, citadel, island, hulk,
// pyramid, cathedral, spire, palace, beast, crag), the `parts` dress it, the `look` and the realm's style colour it,
// and each of its eight abilities gets a fixture with an anchor and an action.
//
//   buildBehemoth(def, sideColor) -> THREE.Group with the sky airships' userData (see sky/ships.js): muzzles, bombBay,
//       hangar, pods, ladders, top, radius, crewSlots, lod (six levels), anchors, actions, setSide, setDamage(level,
//       info), breakParts; plus behemoth: true, sets: { kind: [[x, y, z], ...] } (every fixture of a kind), smoke.
//   animateBehemoth(m, t)   rings and astrolabes turning, waterfalls and mist flowing, bells swaying, banners
//       waving, roosting beasts shifting, wings and flippers beating, glows flickering. animateSky (skyParts.js) calls
//       it too, through the model's anim record, so a view that drives the sky airships drives these as well.
//
// Model space as the airships: +x the bow, +z starboard, y up; the main deck near y = 0, the underside reaching about
// 0.17 x len below it. Geometry is cached by design: a second behemoth of the same faction costs almost nothing, and
// each detail level is meshed only when first drawn (level 2 at build time).
import * as THREE from 'three';
import { AIRWINGS } from '../../data/air/index.js';
import { context, flushInstances, glowMat, lin, clamp, h1, PI, TAU, hexMix } from './build.js';
import { EMPTY, surfTime } from './surf.js';
import { FORMS } from './forms.js';
import { dressParts, fixtures } from './dress.js';
import * as PC from './pieces.js';
import { sculptTime } from '../parts/kit.js';

/** the design: the AIRSHIPS def's own fields, else the air wing's behemoth entry */
function designOf(def) {
  const fid = def.faction || (def.id || '').replace(/Behemoth$/, '');
  const W = (AIRWINGS[fid] && AIRWINGS[fid].behemoth) || {};
  return { name: def.name || W.name, note: def.note || W.note || '', form: def.form || W.form || 'airship', parts: def.parts || W.parts || [], look: def.look || W.look || {}, abilities: def.abilities || W.abilities || [] };
}

export function buildBehemoth(def, sideColor = 0x3d7bd9) {
  const t0 = performance.now(), s0 = sculptTime(), f0 = surfTime();
  const D = designOf(def);
  const X = context(def, D, sideColor);
  X.listX = 0; X.listZ = 0;
  (FORMS[X.form] || FORMS.airship)(X);
  X.top = X.top || 8;
  X.extent = X.extent || [X.L * 0.4, X.L * 0.3];
  dressParts(X);
  fixtures(X);
  wreckage(X);
  flushInstances(X);
  const root = X.root;
  root.updateMatrixWorld(true);
  // the animation record animateSky understands: its one 'bob' is a hook that runs this module's animator
  const A = { wings: [], tails: [], heads: [], spin: [], glows: [], bobs: [], speed: 1, droop: 0, act: {}, t: 0 };
  A.bobs.push({ o: { userData: { y0: 0 }, position: { set y(v) { void v; animateBehemoth(root, A.t); } } }, amp: 0, speed: 0, phase: 0 });
  const R = X.L / 2;
  const deckTop = X.yAt ? X.yAt(0, 0) : 0;
  const bow = X.bowAt || [X.extent[0] + 0.5, deckTop + 0.5, 0], stern = X.sternAt || [-X.extent[0] - 0.3, deckTop + 1, 0];
  const bomb = X.anchors.bombBay || [0, (X.underY ? X.underY(0, 0) : -3) - 0.3, 0], hang = X.anchors.hangar || [-X.extent[0] + 1, deckTop + 0.3, 0];
  const env = X.envs && X.envs.length ? [X.envs[0].g.position.x, X.envs[0].g.position.y, X.envs[0].g.position.z] : [0, X.top * 0.75, 0];
  const slots = X.crewSlots.filter((p) => Number.isFinite(p[1]));
  slots.sort((a, c) => ((a[0] * 7.13 + a[2] * 3.7) % 1 + 1) % 1 - (((c[0] * 7.13 + c[2] * 3.7) % 1 + 1) % 1));
  const anchors = {
    bow, stern, port: [0, deckTop + 0.3, -X.extent[1] - 0.2], starboard: [0, deckTop + 0.3, X.extent[1] + 0.2], deckL: [0, deckTop + 0.3, -X.extent[1] * 0.8], deckR: [0, deckTop + 0.3, X.extent[1] * 0.8],
    gondolaL: [0, deckTop - 1, -X.extent[1]], gondolaR: [0, deckTop - 1, X.extent[1]], keel: [0, (X.underY ? X.underY(0, 0) : -3), 0],
    bombBay: bomb, hangar: hang, envelope: env, top: [0, X.top, 0], deck: [0, deckTop + 0.2, 0],
    ...(X.mouthAt ? { mouth: X.mouthAt } : {}), ...X.anchors,
  };
  if (X.smoke && X.smoke.length) anchors.smoke = X.smoke[0];
  X.lodRec = { meshes: X.lod, far: null, level: 0, levels: 6, toJSON: () => undefined };
  root.userData = {
    skyAnim: true, behemoth: true, sculpted: true, anim: A, bh: X, form: X.form,
    props: [], muzzles: X.muzzles.length ? X.muzzles : [[0, deckTop, X.extent[1]], [0, deckTop, -X.extent[1]]],
    bombBay: bomb, hangar: hang, pods: X.pods.length ? X.pods : [[X.extent[0] * 0.2, bomb[1], 1.5], [X.extent[0] * 0.2, bomb[1], -1.5], [-X.extent[0] * 0.2, bomb[1], 1.5], [-X.extent[0] * 0.2, bomb[1], -1.5]],
    ladders: [[0, deckTop, -X.extent[1] * 0.9], [0, deckTop, X.extent[1] * 0.9]],
    top: X.top + 0.2, radius: R,
    crewSlots: slots.slice(0, 220),
    lod: X.lodRec,
    anchors, sets: X.sets, smoke: X.smoke || [],
    actions: X.actions,
    abilities: [...X.ab.keys()],
    breakParts: X.breakParts.map((b) => ({ mesh: b.mesh, at: b.at, kind: b.kind })),
    setSide(hex) { X.sideMat.color.set(hex); if (X.bannerMat) X.bannerMat.color.set(hex); X.pal.side = hex; },
    setDamage(lv, info = {}) { setDamage(X, lv, info); },
    triangles: (level = 0) => tris(X, level),
    buildMs: 0,
  };
  root.userData.buildMs = Math.round(performance.now() - t0);
  root.userData.buildStats = { ms: root.userData.buildMs, sculptMs: Math.round(sculptTime() - s0), surfMs: Math.round(surfTime() - f0), meshes: X.lod.length };
  animateBehemoth(root, 0);
  return root;
}

// ---------------------------------------------------------------------------------------------
// damage
// ---------------------------------------------------------------------------------------------
/** fires, smoke-blackened rubble and hanging wreckage, hidden until the level that shows them */
function wreckage(X) {
  const outer = glowMat(X, 0xff5a0a, 2.2, { flick: 0.5, transparent: true, opacity: 0.85, depthWrite: false }), inner = glowMat(X, 0xffe08a, 2.8, { flick: 0.55 });
  const cone = new THREE.ConeGeometry(1, 1, 7, 1, true).translate(0, 0.5, 0), coreG = new THREE.ConeGeometry(0.55, 0.7, 6).translate(0, 0.35, 0);
  const spots = [];
  for (const p of X.towerTops || []) spots.push([p[0], p[1] - 2.5, p[2]]);
  for (let i = 0; i < 8; i++) { const r = X.rim[(i * 7 + 3) % X.rim.length]; spots.push([r[0] - r[3] * 0.8, r[1] + 0.1, r[2] - r[4] * 0.8]); }
  if (X.envs) for (const E of X.envs) spots.push([E.g.position.x + 1, E.g.position.y - (E.R || 2) * 0.6, E.g.position.z + (E.R || 2) * 0.5]);
  X.fires = [];
  spots.slice(0, 12).forEach((p, i) => {
    const g = new THREE.Group(); g.position.set(...p); g.visible = false; X.I.add(g);
    for (let k = 0; k < 3; k++) {
      const s = (0.7 + h1(i * 5 + k) * 0.8) * (X.L / 26) * 1.4;
      const o = new THREE.Mesh(cone, outer); o.position.set((h1(i + k * 3) - 0.5) * 1.2, 0, (h1(i + k * 7) - 0.5) * 1.2); o.scale.set(s * 0.5, s * 1.8, s * 0.5); g.add(o);
      const c = new THREE.Mesh(coreG, inner); c.position.copy(o.position); c.scale.setScalar(s * 0.7); g.add(c);
    }
    X.fires.push({ g, lv: i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 3 });
  });
  // rubble heaps and charred beams on the decks (level 2 up)
  const rg = new THREE.Group(); rg.visible = false; X.I.add(rg); X.dmgShow[2].push(rg);
  const rub = PC.rubble({ stone: X.pal.stone, wood: X.pal.wood }, 1), rub2 = PC.rubble({ stone: X.pal.stone, wood: X.pal.wood }, 2);
  for (let i = 0; i < 6; i++) { const p = X.pads[(i * 7 + 2) % Math.max(1, X.pads.length)]; if (!p) break; const m = new THREE.Mesh(EMPTY, X.mats.paint); m.position.set(p.x, p.y - 0.1, p.z); m.scale.setScalar(1.6 + h1(i) * 0.8); rg.add(m); X.lod.push({ mesh: m, geos: i % 2 ? rub : rub2 }); m.geometry = (i % 2 ? rub : rub2)[2]; }
  // the level-3 list: she rolls toward the beam that took it and noses down
}
function setDamage(X, lv, info) {
  lv = clamp(Math.round(+lv || 0), 0, 3);
  const fire = !!(info && info.fire) || lv >= 3;
  if (lv === X.dmgLv && fire === X.dmgFire && (info.side || 1) === X.dmgSide) return;
  X.dmgLv = lv; X.dmgFire = fire; X.dmgSide = info.side || 1;
  const level = X.lodRec.level;
  X.mats.paint.color.setRGB(1, 1, 1).lerp(new THREE.Color(0x2a2420), lv * 0.13);
  for (const s of X.skins) {
    s.ent.geos = s.make(lv);
    const g = s.ent.geos[Math.min(level, 5)];
    s.ent.mesh.geometry = g; s.ent.mesh.visible = g !== EMPTY;
  }
  for (let l = 1; l <= 3; l++) for (const g of X.dmgShow[l]) g.visible = lv >= l;
  for (const f of X.fires) f.g.visible = lv >= f.lv && (fire || lv >= 2);
  X.droop = lv >= 3 ? 1 : lv >= 2 ? 0.3 : 0;
  X.listX = lv >= 2 ? (info.side || 1) * (lv >= 3 ? 0.06 : 0.025) : 0;
  X.listZ = lv >= 3 ? -0.05 : lv >= 2 ? -0.015 : 0;
  X.I.rotation.x = X.listX; X.I.rotation.z = X.listZ;
  // a sagging bag and a dimmer light in everything that glows
  for (const E of X.envs || []) { E.g.scale.y = lv >= 3 ? 0.88 : 1; E.g.position.y = E.y0 ?? (E.y0 = E.g.position.y); if (lv >= 3) E.g.position.y = E.y0 - 0.6; }
  for (const m of X.flowMats || []) m.opacity = m.userData.op0 * (lv >= 3 ? 0.55 : 1);
}
function tris(X, level) {
  let n = 0;
  for (const { mesh, geos } of X.lod) { const g = geos[Math.min(level, 5)]; if (!g || g === EMPTY) continue; n += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (mesh.isInstancedMesh ? mesh.count : 1); }
  return Math.round(n);
}

// ---------------------------------------------------------------------------------------------
// motion
// ---------------------------------------------------------------------------------------------
export function animateBehemoth(m, t) {
  const X = m.userData.bh;
  if (!X) return;
  X.U.uT.value = t;
  const an = X.anim, act = X.act || {}, dr = X.droop || 0;
  for (const s of an.spin) {
    const u = s.o.userData; if (u.r0 === undefined) u.r0 = s.o.rotation[s.axis];
    const boost = s.beam ? 1 + 6 * (act.beam || 0) : s.meteor ? 1 + 5 * (act.meteor || 0) : 1;
    if (boost > 1) { u.acc = (u.acc || 0) + (t - (u.lastT ?? t)) * s.speed * (boost - 1); }
    u.lastT = t;
    s.o.rotation[s.axis] = u.r0 + t * s.speed * (s.prop ? 1 - 0.85 * dr : 1 - 0.6 * dr) + (u.acc || 0);
  }
  for (const s of an.sway) {
    const u = s.o.userData; if (u['b' + s.axis] === undefined) u['b' + s.axis] = s.base ?? s.o.rotation[s.axis];
    let amp = s.amp * (1 - 0.5 * dr);
    if (s.bell) amp *= 1 + 6 * (act.sonic || 0);
    s.o.rotation[s.axis] = u['b' + s.axis] + amp * Math.sin(t * s.speed * (s.bell ? 1 + (act.sonic || 0) * 2 : 1) + s.phase);
  }
  for (const b of an.bob) { const u = b.o.userData; if (u.y0 === undefined) u.y0 = b.o.position.y; b.o.position.y = u.y0 + b.amp * Math.sin(t * b.speed + b.phase); }
  for (const s of an.slide) { const u = s.o.userData; if (u.r0 === undefined) u.r0 = s.o.rotation.y; s.o.rotation.y = u.r0 + s.amp * Math.sin(t * s.speed + s.phase) * (1 + 2 * (act.phase || 0)); }
  // roosting beasts look about and settle now and then
  for (const b of an.beasts) { const k = Math.sin(t * b.rate + b.phase); b.o.rotation.y = b.base + 0.45 * k * k * k; b.o.position.y = b.o.userData.y0 ?? (b.o.userData.y0 = b.o.position.y); }
  for (const g of an.glows) {
    const f = 1 + g.k * (Math.sin(t * 11.3 + g.ph) * 0.5 + Math.sin(t * 6.7 + g.ph * 2) * 0.5);
    g.m.emissiveIntensity = g.m.userData.glowBase * f * (1 - 0.6 * dr) + (g.m.userData.boost || 0) * (1 + 0.3 * Math.sin(t * 40));
  }
  // flames lick and gutter
  for (const f of X.fires || []) if (f.g.visible) f.g.children.forEach((c, i) => { const k = 1 + 0.18 * Math.sin(t * (9 + i) + i * 2.1) + 0.1 * Math.sin(t * 23 + i); c.scale.y = (c.userData.sy ?? (c.userData.sy = c.scale.y)) * k; });
  if (X.auraG) { const k = act.aura || 0; X.auraG.scale.set(1, 1 + 0.06 * k * Math.abs(Math.sin(t * 9)), 1); }
  if (X.gateRing) X.gateRing.rotation.z = t * (0.3 + 3 * (act.gate || 0));
  if (X.fans) for (const g of X.fans) g.rotation.x = (act.gale || 0) * Math.sin(t * 30) * 0.05;
}

void lin; void PI; void TAU; void hexMix;
