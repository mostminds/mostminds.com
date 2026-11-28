// What a behemoth carries: the design's parts (bells, lanterns, cages, chains, waterfalls, roots, statues, roosts ...)
// placed where its form left room, and a fixture for each of its abilities, with an anchor the effects place their
// beams, drops and domes from and an action (k: 0 -> 1) that works it: gun decks recoil, keel doors open, pods drop,
// winch cages lower, bells swing, lenses and rings flare and spin.
import * as THREE from 'three';
import { noise3 } from '../sculpt.js';
import { propGeo } from '../sky/carved.js';
import {
  PI, TAU, lin, clamp, lerp, h1, hexMix, hexShade, piece, place, building, take, reserve, waterfall, mist, vortex,
  lightPillar, bannerAt, astrolabe, glowMat, flowMat, chainGeo, rigging,
} from './build.js';
import { prismGeo, ringGeo, tubeGeo, flowShell, cutAfter, cap } from './surf.js';
import * as PC from './pieces.js';
import * as PK from '../parts/kit.js';

const pulse = (k, peak = 0.25) => (k <= 0 || k >= 1 ? 0 : k < peak ? Math.sin((k / peak) * PI / 2) : Math.cos(((k - peak) / (1 - peak)) * PI / 2) ** 2);
const hold = (k, a = 0.18, b = 0.78) => (k <= 0 || k >= 1 ? 0 : k < a ? Math.sin((k / a) * PI / 2) : k < b ? 1 : Math.cos(((k - b) / (1 - b)) * PI / 2) ** 2);
const grp = (X, p, parent = null) => { const g = new THREE.Group(); g.position.set(p[0], p[1], p[2]); (parent || X.I).add(g); return g; };
const rimSide = (X, s, n) => { const pts = X.rim.filter((r) => Math.sign(r[4]) === s && Math.abs(r[4]) > 0.55).sort((a, b) => a[0] - b[0]); if (pts.length <= n) return pts; const out = []; for (let i = 0; i < n; i++) out.push(pts[Math.round((i / (n - 1)) * (pts.length - 1) * 0.8 + (pts.length - 1) * 0.1)]); return out; };
const rimAt = (X, a) => { let best = X.rim[0], bd = 9; for (const r of X.rim) { let d = Math.abs(r[5] - a); d = Math.min(d, TAU - d); if (d < bd) { bd = d; best = r; } } return best; };
const under = (X, x, z) => (X.underY ? X.underY(x, z) : -3);
const deckY = (X, x, z) => (X.yAt ? X.yAt(x, z) : 0);

// =============================================================================================
// parts
// =============================================================================================
export function dressParts(X) {
  const { form } = X, L = X.L;
  const C = { metal: X.pal.trim, wood: X.pal.wood, trim: X.pal.trim, glow: X.pal.glow, bone: 0xd8cfb4, cloth: X.pal.cloth, stone: X.pal.stone };
  // towers, spires and domes the form did not build itself
  if (X.has('towers') && !['citadel', 'cathedral', 'spire', 'palace', 'beast'].includes(form) && X.fid !== 'pearlfleet') for (let i = 0; i < Math.min(4, X.n('towers', 3)); i++) { const p = take(X, 2.2, 'edge'); if (p) { const t = building(X, [p[0], p[1] - 0.5, p[2]], { plan: 'circle', w: 2.6, h: L * 0.14, solo: i === 0, breakable: i === 0, seed: 70 + i, dens: 8, y0: -1 }); X.towerTops = [...(X.towerTops || []), [p[0], t.top, p[2]]]; } }
  if (X.has('spires') && !['citadel', 'cathedral', 'spire', 'airship'].includes(form)) for (let i = 0; i < Math.min(5, X.n('spires', 3)); i++) { const p = take(X, 1.6, i === 0 ? 'centre' : 'edge'); if (p) { const t = building(X, [p[0], p[1] - 0.4, p[2]], { plan: 'poly', n: 6, w: 1.6, h: L * 0.1 + i, roof: 'spire', rh: L * 0.12, seed: 80 + i, dens: 9, y0: -1 }); X.top = Math.max(X.top, t.top); X.towerTops = [...(X.towerTops || []), [p[0], t.top, p[2]]]; } }
  if (X.has('domes') && !['palace', 'cathedral', 'citadel'].includes(form) && X.fid !== 'pearlfleet') for (let i = 0; i < Math.min(4, X.n('domes', 2)); i++) { const p = take(X, 2.2, 'centre'); if (p) building(X, [p[0], p[1] - 0.3, p[2]], { plan: 'poly', n: 8, w: 3, h: 1.8, roof: X.S.roof === 'onion' ? 'onion' : 'dome', rh: 2.4, domeP: X.pat.gold, dens: 9, seed: 90 + i }); }
  // smokestacks and chimneys
  const nS = X.n('smokestacks', 2) + X.n('chimneys', 0);
  X.smoke = X.smoke || [];
  for (let i = 0; i < Math.min(6, nS); i++) {
    const p = take(X, 1.2, form === 'airship' ? (i % 2 ? 'bow' : 'stern') : 'centre'); if (!p) break;
    const h = L * 0.13 + (i % 3);
    const spec = { plan: 'circle', w: 1.3, prof: [[1.1, 0, -0.6, 'p'], [1, 0, h * 0.9, 'p'], [1.25, 0, h, 't'], [1.25, 0, h + 0.3, 't'], [1.0, 0, h + 0.3, 'd'], [1.0, 0, h - 0.6, 'd'], [0, 0, h - 0.6, 'd']], mats: { p: X.pat.plate, t: X.pat.trim, d: { pat: 'flat', col: [0.03, 0.025, 0.02], col2: [0.03, 0.02, 0.02], gl: X.kw('fire', 'furnace', 'boiler', 'forge') ? 0.8 : 0 } }, dens: 9, seed: i };
    const crook = X.kw('crude', 'lopsided', 'scrap') ? (h1(i) - 0.5) * 0.25 : 0;
    piece(X, prismGeo(`stack|${X.fid}|${i % 2}`, spec, 0), X.I, p, [crook, 0, crook * 0.5], 1);
    X.smoke.push([p[0] + Math.sin(crook) * h, p[1] + h + 0.3, p[2]]);
  }
  // bells: in the belfries, at the eaves of a pagoda, or one great bell under the keel
  X.bells = [];
  const nB = X.n('bells', 0);
  if (X.has('bells')) {
    const bc = { metal: X.kw('green-glowing') ? 0x5a6a3a : X.pal.trim, trim: hexShade(X.pal.trim, 0.8), glow: X.kw('glowing') ? X.pal.glow : 0 };
    const spots = [];
    if (X.corners) spots.push(...X.corners.map((p) => ({ p: [p[0], p[1] - 0.2, p[2]], s: 0.9 })));
    if (X.belfries) spots.push(...X.belfries.map((p) => ({ p, s: 1.3 })));
    if ((nB === 1 && X.kw('beneath its keel', 'beneath', 'colossal bell', 'great bell')) || !spots.length) spots.unshift({ p: [0, under(X, 0, 0) - 0.4, 0], s: nB === 1 ? L * 0.12 : 2, keel: true });
    for (const sp of spots.slice(0, Math.max(1, nB || 3))) {
      const g = grp(X, sp.p);
      piece(X, PC.bell(bc), g, [0, 0, 0], [0, 0, 0], sp.s);
      if (sp.keel) { piece(X, tubeGeo(`bellhang|${sp.s.toFixed(1)}`, [[0, 0, 0], [0, 1.2, 0]], 0.12 * sp.s / 2, lin(0x3a3634), { sides: 6 }), g, [0, 0, 0], [0, 0, 0], 1); X.anchors.bell = [sp.p[0], sp.p[1] - sp.s, sp.p[2]]; }
      X.anim.sway.push({ o: g, axis: 'z', amp: sp.keel ? 0.04 : 0.08, speed: sp.keel ? 0.6 : 1.1, phase: X.bells.length, bell: true });
      X.anim.sway.push({ o: g, axis: 'x', amp: 0.03, speed: 0.8, phase: X.bells.length * 2 });
      X.bells.push({ g, p: sp.p, s: sp.s });
    }
  }
  // lanterns: great tethered war-lanterns, or lamps round the rim
  if (X.has('lanterns')) {
    const n = X.n('lanterns', 4), big = X.S.roof === 'pagoda' || X.kw('war-lantern', 'tethered');
    for (let i = 0; i < n; i++) {
      if (big) {
        const a = (i / n) * TAU + PI / 4, r = Math.max(...X.extent) + 3.5, p = [Math.cos(a) * r, L * 0.18, Math.sin(a) * r * 0.8];
        const g = grp(X, p);
        piece(X, PC.lantern('paper', { metal: X.pal.trim, cloth: 0xc82a1a, trim: 0xd8b03a, glow: 0xffa040 }), g, [0, 0, 0], [0, 0, 0], 2.6);
        X.anim.bob.push({ o: g, amp: 0.4, speed: 0.6, phase: i * 1.6 });
        rigging(X, [[[p[0], p[1], p[2]], [p[0] * 0.55, deckY(X, p[0] * 0.55, p[2] * 0.55) + 1, p[2] * 0.55]]], 0x2a2018, 0.04);
      } else {
        const r = X.rim[(i * Math.floor(X.rim.length / n) + 3) % X.rim.length];
        place(X, PC.lantern(X.S.trophy === 'lanterns' ? 'paper' : 'iron', { metal: X.pal.trim, cloth: 0xe8c080, glow: X.pal.glow }), [r[0] - r[3] * 0.5, r[1], r[2] - r[4] * 0.5], [0, 0, 0], 1.3);
      }
    }
  }
  // obelisks: standing round the deck, or floating round the whole thing
  if (X.has('obelisks') && !(X.form === 'island' && X.n('obelisks') >= 6) && X.fid !== 'mistisles') {
    const n = X.n('obelisks', 4), float = X.kw('floating obelisks', 'circle it');
    const geo = obelisk(X);
    const orbit = float ? grp(X, [0, X.L * 0.12, 0]) : null;
    if (orbit) X.anim.spin.push({ o: orbit, axis: 'y', speed: 0.12 });
    for (let i = 0; i < n; i++) {
      if (float) { const a = (i / n) * TAU, r = Math.max(...X.extent) + 3; const g = grp(X, [Math.cos(a) * r, 0, Math.sin(a) * r], orbit); piece(X, geo, g, [0, 0, 0], [0, -a, 0], 1.8); X.anim.bob.push({ o: g, amp: 0.6, speed: 0.5, phase: i }); }
      else { const p = take(X, 1.2, 'edge'); if (p) place(X, geo, [p[0], p[1] - 0.3, p[2]], [0, h1(i) * 3, 0], 1.3); }
    }
  }
  // solar mirrors at the corners
  if (X.has('mirrors')) {
    const n = X.n('mirrors', 4), spots = X.cornerTops || X.towerTops || [];
    const geo = PC.mirror({ metal: X.pal.trim, glow: X.pal.glow, trim: X.pal.trim });
    for (let i = 0; i < n; i++) { const p = spots[i] || take(X, 1.4, 'edge'); if (!p) continue; const g = grp(X, [p[0], p[1], p[2]]); g.rotation.y = -Math.atan2(p[2], p[0]); piece(X, geo, g, [0, 0, 0], [0, 0, 0], 1.6); X.mirrors = [...(X.mirrors || []), g]; X.anim.sway.push({ o: g, axis: 'y', amp: 0.2, speed: 0.15, phase: i, base: g.rotation.y }); }
  }
  // waterfalls (or slime, or lava, or fountains) pouring over the rim
  if (X.has('waterfalls') || X.has('fountains')) {
    const n = Math.min(5, X.n('waterfalls', 3) || 2), kind = X.kw('slime') ? 'slime' : X.kw('lava') ? 'lava' : 'water';
    const col = kind === 'slime' ? 0x8ab83a : kind === 'lava' ? 0xff6a1a : X.kw('river', 'gold') ? 0xb8d8d0 : 0xa8d8ec;
    for (let i = 0; i < n; i++) {
      const r = rimAt(X, (i / n) * TAU + 0.6 + h1(X.seed + i) * 0.4);
      waterfall(X, [r[0] - r[3] * 0.4, r[1] - 0.1, r[2] - r[4] * 0.4], [r[3], r[4]], L * 0.32, 0.7 + h1(i) * 0.4, col, kind === 'lava' ? 'fire' : 'water');
    }
  }
  // roots and crystals hanging under
  if (X.has('roots')) {
    const n = X.form === 'island' ? 6 : 4, glow = X.kw('glowing roots', 'ley') ? X.pal.glow : 0;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + 0.3, ex = X.extent[0] * 0.4, ez = X.extent[1] * 0.4, x = Math.cos(a) * ex, z = Math.sin(a) * ez; place(X, PC.roots({ bark: X.pal.bark, glow }, i % 3), [x, under(X, x, z) + 0.8, z], [0, a, 0], 1.6 + h1(i) * 0.6); }
  }
  if (X.has('crystals') && X.form !== 'spire') {
    const geo = PC.crystals({ glow: X.pal.glow, base: X.pal.rock }, 2);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.8, x = Math.cos(a) * X.extent[0] * 0.3, z = Math.sin(a) * X.extent[1] * 0.3; place(X, geo, [x, under(X, x, z) + 0.6, z], [PI, a, 0], 1.6 + i * 0.2); }
    for (let i = 0; i < 3; i++) { const p = take(X, 1.2, 'edge'); if (p) place(X, geo, [p[0], p[1] - 0.2, p[2]], [0, i, 0], 1.2); }
  }
  if (X.form === 'spire' && X.has('crystals')) { const geo = PC.crystals({ glow: X.pal.glow, base: X.pal.rock }, 4); place(X, geo, [0, under(X, 0, 0) + 1, 0], [PI, 0, 0], 3.2); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; place(X, geo, [Math.cos(a) * X.extent[0] * 0.55, under(X, Math.cos(a) * X.extent[0] * 0.55, Math.sin(a) * X.extent[1] * 0.55) + 0.6, Math.sin(a) * X.extent[1] * 0.55], [PI, a, 0.3], 1.4); } }
  // cages swinging on chains from the rim, chains trailing with their trophies
  if (X.has('cages')) {
    const n = Math.min(6, X.n('cages', 4)), cg = PC.cage({ metal: 0x3a3634, bone: 0xd8cfb4 });
    for (let i = 0; i < n; i++) { const r = X.rim[(i * Math.floor(X.rim.length / n) + 5) % X.rim.length], len = 2.5 + h1(i + 3) * 2.5; const g = grp(X, [r[0] + r[3] * 0.3, r[1] - 0.2, r[2] + r[4] * 0.3]); piece(X, chainGeo(X, len), g, [0, 0, 0], [0, 0, 0], 1); piece(X, cg, g, [0, -len, 0], [0, i, 0], 1.6); X.anim.sway.push({ o: g, axis: 'z', amp: 0.12, speed: 0.7 + h1(i) * 0.3, phase: i * 1.3 }); X.anim.sway.push({ o: g, axis: 'x', amp: 0.08, speed: 0.6, phase: i * 2.1 }); }
  }
  if (X.has('chains')) {
    for (let i = 0; i < 6; i++) { const r = X.rim[(i * 8 + 2) % X.rim.length], len = 3 + h1(i + 9) * 4; const g = grp(X, [r[0], r[1] - 0.3, r[2]]); piece(X, chainGeo(X, len, 0.11), g, [0, 0, 0], [0, 0, 0], 1); if (X.has('skulls') && i % 2 === 0) place(X, PC.skull({ bone: 0xd8cfb4 }), [0, -len - 0.5, 0], [0, i, 0], 0.9, g); X.anim.sway.push({ o: g, axis: 'z', amp: 0.06, speed: 0.5 + h1(i) * 0.3, phase: i }); }
  }
  // skulls piled along the rim and on the towers
  if (X.has('skulls')) {
    const geo = PC.skull({ bone: 0xd8cfb4, glow: X.kw('glow', 'mist', 'necro') ? X.pal.glow : 0, horns: X.kw('horn', 'beast') });
    for (let i = 0; i < 18; i++) { const r = X.rim[(i * 3 + 1) % X.rim.length]; place(X, geo, [r[0] - r[3] * 0.6, r[1] - 0.1 + (i % 3) * 0.2, r[2] - r[4] * 0.6], [0, -r[5], 0], 0.7 + h1(i) * 0.3); }
    for (let i = 0; i < 3; i++) { const p = take(X, 1.2, 'centre'); if (!p) break; for (let k = 0; k < 7; k++) place(X, geo, [p[0] + (h1(k) - 0.5) * 1.2, p[1] + (k > 4 ? 0.6 : 0), p[2] + (h1(k + 5) - 0.5) * 1.2], [0, k * 0.9, 0], 0.8); }
  }
  // statues: the realm's own champion in stone, sphinxes, serpents or gargoyles
  if (X.has('statues') || X.form === 'cathedral') {
    const n = X.n('statues', 4);
    if (X.piers) { const gg = PC.gargoyle({ stone: hexShade(X.pal.stone, 0.85), glow: X.fid === 'ashhorde' ? X.pal.glow : 0 }); X.piers.forEach((p, i) => place(X, gg, p, [0, Math.sign(p[2]) > 0 ? -PI / 2 : PI / 2, 0], 1.3)); }
    if (X.has('statues')) for (let i = 0; i < n; i++) {
      const p = take(X, 1.4, 'edge'); if (!p) break;
      if (X.fid === 'nagavar') place(X, PC.serpent({ col: 0x8a8070, glow: X.pal.glow }), p, [0, -Math.atan2(p[2], p[0]), 0], 1.6);
      else if (X.fid === 'khemet') place(X, sphinx(X), p, [0, -Math.atan2(p[2], p[0]), 0], 1.6);
      else { const st = PC.statue(X.fid, hexMix(X.pal.stone, 0xb8b0a0, 0.4)); if (st) { place(X, st.geos, [p[0], p[1] + 0.6, p[2]], [0, -Math.atan2(p[2], p[0]) + PI / 2, 0], 2.6 / st.height); place(X, plinth(X), [p[0], p[1] - 0.2, p[2]], [0, 0, 0], 1); } }
    }
  }
  // what stands on the deck
  const deckThing = (noun, geo, s, n0, pref = null) => { if (!X.has(noun)) return; for (let i = 0; i < Math.min(6, X.n(noun, n0)); i++) { const p = take(X, 1.2, pref); if (p) place(X, geo, [p[0], p[1] - 0.1, p[2]], [0, h1(i + 3) * 6, 0], s); } };
  deckThing('totems', PC.totem({ wood: X.pal.wood, paint: X.pal.cloth, paint2: X.pal.trim }), 1.4, 2, 'edge');
  deckThing('drums', PC.drum({ wood: X.pal.wood, hide: 0xd8c8a0, trim: X.pal.trim }), 1.4, 2, 'centre');
  deckThing('braziers', PC.lantern('brazier', { metal: X.pal.trim, glow: 0xff8a2a }), 1.3, 4, 'edge');
  deckThing('telescopes', PC.telescope({ metal: X.pal.trim, trim: X.pal.metal }), 1.5, 2, 'edge');
  deckThing('coral', PC.coral({ col: 0xe87a8a, col2: 0xf8e0d0 }), 1.8, 4);
  if (X.has('gears')) for (let i = 0; i < 3; i++) { const p = [0, (X.spireTop ? X.spireTop[1] * (0.3 + i * 0.2) : 3), 0]; const g = grp(X, p); const s2 = new THREE.Group(); s2.rotation.z = PI / 2; s2.rotation.y = i * 1.2; g.add(s2); const sp = new THREE.Group(); s2.add(sp); piece(X, PC.gear({ metal: X.pal.trim, trim: X.pal.metal }), sp, [0, 0, 0], [0, 0, 0], 2.2 + i * 0.6); X.anim.spin.push({ o: sp, axis: 'y', speed: 0.6 * (i % 2 ? -1 : 1) }); }
  if (X.has('vines')) for (let i = 0; i < 10; i++) { const r = X.rim[(i * 5) % X.rim.length], len = 3 + h1(i) * 5; piece(X, tubeGeo(`vine|${i}`, [[r[0], r[1], r[2]], [r[0] + r[3] * 0.5, r[1] - len * 0.5, r[2] + r[4] * 0.5], [r[0] + r[3] * 0.3, r[1] - len, r[2] + r[4] * 0.3]], (t) => 0.1 * (1 - t * 0.6), lin(0x3a5a2a), { sides: 5, dens: 4, bark: true }), X.I, [0, 0, 0], [0, 0, 0], 1); }
  if (X.has('tree') && !['island'].includes(X.form)) for (let i = 0; i < Math.min(3, X.n('tree', 2)); i++) { const p = take(X, 2.6, 'centre'); if (p) { const s = X.form === 'beast' ? 2.6 : 2.0; const t = piece(X, PC.tree(X.kw('rot') ? 'rot' : 'oak', { bark: X.pal.bark, leaf: X.pal.leaf, leaf2: X.pal.leaf2 }, i), X.I, [p[0], p[1] - 0.2, p[2]], [0, i * 2, 0], s); X.breakParts.push({ mesh: t, at: [p[0], p[1] + 3, p[2]], kind: 'tree' }); } }
  if (X.has('carpets')) for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.7, r = Math.max(...X.extent) + 2, g = grp(X, [Math.cos(a) * r, L * 0.06 + i * 0.6, Math.sin(a) * r * 0.8]); piece(X, carpet(X, i), g, [0, 0, 0], [0, -a, 0], 1.6); X.anim.bob.push({ o: g, amp: 0.35, speed: 0.8, phase: i * 1.3 }); }
  if (X.has('stones')) { const orb = grp(X, [0, X.L * 0.05, 0]); X.anim.spin.push({ o: orb, axis: 'y', speed: 0.18 }); for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU, r = Math.max(...X.extent) + 2.5; const g = grp(X, [Math.cos(a) * r, (h1(i) - 0.5) * 3, Math.sin(a) * r], orb); piece(X, floatStone(X, i % 3), g, [0, 0, 0], [h1(i) * 3, h1(i + 1) * 3, 0], 1.2 + h1(i + 2)); X.anim.bob.push({ o: g, amp: 0.5, speed: 0.6, phase: i }); } }
  if (X.has('runes') && !['island', 'crag'].includes(form)) { const R = Math.max(...X.extent) * 0.75, g = grp(X, [0, under(X, 0, 0) * 0.45, 0]); const sp = new THREE.Group(); g.add(sp); piece(X, ringGeo(`runering|${X.fid}|${R.toFixed(1)}`, R, 0.16, X.pat.trim, { rune: lin(X.pal.glow), ry: 0.35, rz: 1.6 }), sp, [0, 0, 0], [0, 0, 0], 1); X.anim.spin.push({ o: sp, axis: 'y', speed: 0.2 }); X.runeRing = g; }
  if (X.has('wings') && !X.wings && form !== 'beast') for (const s of [-1, 1]) { const g = grp(X, [X.extent[0] * 0.1, deckY(X, 0, 0) + 1, s * X.extent[1] * 0.9]); g.scale.z = s; piece(X, PC.wing(X.kw('bat', 'daemon', 'dragon') ? 'membrane' : 'feather', { col: X.pal.cloth, col2: hexMix(X.pal.cloth, 0xffffff, 0.3), bone: X.pal.hull }), g, [0, 0, 0], [0, 0, 0], 1.7); X.anim.sway.push({ o: g, axis: 'x', amp: 0.3 * s, speed: 0.8, phase: 0, base: 0.05 * s }); X.wings = [...(X.wings || []), g]; X.breakParts.push({ mesh: g, at: [0, 2, s * X.extent[1] * 2], kind: 'wing' }); }
  if (X.has('kites') && form !== 'citadel') { /* the citadel flies its own */ }
  if (X.has('rotors') && form !== 'cathedral') for (const s of [-1, 1]) { const g = grp(X, [0, deckY(X, 0, 0) + 2, s * (X.extent[1] + 2)]); piece(X, propGeo(2.0, 4, X.pal.wood, X.pal.trim, false), g, [0, 0, 0], [0, 0, PI / 2], 1.2); X.anim.spin.push({ o: g, axis: 'y', speed: 5 * s, prop: true }); }
  if (X.has('cranes') && !X.ab.has('supplyDrop')) crane(X, 1);
  // banners on the tower tops and along the rim
  if (X.has('banners')) {
    const spots = (X.towerTops || []).slice(0, 4).map((p) => [p[0], p[1] - 0.2, p[2]]);
    for (let i = 0; spots.length < 6 && i < 6; i++) { const r = X.rim[(i * 8 + 4) % X.rim.length]; spots.push([r[0] - r[3] * 0.6, r[1], r[2] - r[4] * 0.6]); }
    spots.forEach((p, i) => bannerAt(X, p, 2.6, 1.2, X.S.banner === 'nobori' || X.S.banner === 'gonfalon' ? 2.4 : 1.6, h1(i) * TAU));
  }
  // roosting beasts on ledges, terraces and tower tops
  if (X.has('roosts')) roosts(X);
  // mist and vortex under it
  if (X.has('mist') && !X.misted) { const R = Math.max(...X.extent); mist(X, [0, under(X, 0, 0) + 1.5, 0], R * 0.9, L * 0.14, X.kw('green') ? 0x8ae8a0 : X.kw('shadow', 'grave', 'necro') ? 0x6a7a70 : 0xe0e8ec, X.kw('green', 'shroud') ? 0.55 : 0.4, 3); }
  if (X.has('vortex') && form !== 'palace' && !(form === 'pyramid' && X.kw('sand'))) { const R = Math.max(...X.extent) * 0.75; const fire = X.kw('flame', 'fire'); vortex(X, [0, under(X, 0, 0) + 1.2, 0], R, L * 0.22, fire ? (X.kw('many-coloured', 'coloured') ? 0xd060ff : 0xff6a1a) : X.kw('sand') ? 0xd8b878 : 0xd8e0e8, fire ? 'fire' : 'vortex', 0.6); }
}
function obelisk(X) {
  return prismGeo(`obelisk|${X.fid}`, { plan: 'rect', w: 0.9, d: 0.9, corner: 0.04, prof: [[1.3, 0, -0.4, 'b'], [1.3, 0, 0.4, 'b'], [1, 0, 0.45, 'w'], [0.7, 0, 4.6, 'w'], [0.7, 0, 4.65, 'g'], [0, 0, 5.3, 'g']], mats: { b: X.pat.wallPlain, w: { ...X.pat.wallPlain, rune: { t: 2.2, h: 1.6, col: lin(X.pal.glow), k: 1.1 } }, g: X.pat.gold }, dens: 10, seed: 4 }, 0);
}
function plinth(X) { return cutAfter(prismGeo(`plinth|${X.fid}`, { plan: 'rect', w: 1.3, d: 1.3, corner: 0.05, prof: [[1.1, 0, -0.3, 'w'], [1.1, 0, 0.15, 'w'], [1, 0, 0.2, 'w'], [1, 0, 0.7, 'w'], [1.1, 0, 0.75, 'w'], [0, 0, 0.8, 'w']], mats: { w: X.pat.wallPlain }, dens: 12 }, 0), 4); }
function sphinx(X) {
  return PC.sculpt(`sphinx|${X.pal.stone}|${X.pal.trim}`, () => {
    const B = new PK.SB(), st = (p, k = 0.06) => p.color(X.pal.stone).pbr(0.88).blend(k).bump(0.006, 12, 'rock');
    B.p(st(PK.S.box(2.2, 0.4, 1.0, 0.05).at(0, 0.2, 0), 0.01));
    B.p(st(PK.S.ellipsoid(0.85, 0.42, 0.42).at(-0.1, 0.8, 0), 0.15));
    for (const s of [-1, 1]) { PK.SKH.limb(B, [[0.45, 0.7, s * 0.25], [0.9, 0.45, s * 0.25], [1.05, 0.45, s * 0.25]], [0.14, 0.1, 0.1], X.pal.stone, { k: 0.05 }); PK.SKH.limb(B, [[-0.6, 0.65, s * 0.3], [-0.5, 0.45, s * 0.35], [-0.2, 0.45, s * 0.35]], [0.2, 0.13, 0.1], X.pal.stone, { k: 0.05 }); }
    B.p(st(PK.S.ellipsoid(0.24, 0.3, 0.24).at(0.6, 1.25, 0), 0.08));
    B.p(PK.S.box(0.12, 0.5, 0.62, 0.05).at(0.52, 1.18, 0).color(X.pal.trim).pbr(0.3, 0.85).blend(0.04));
    B.p(PK.S.cone(0.2, 0.18, 0.25).at(0.6, 1.58, 0).color(X.pal.trim).pbr(0.3, 0.85).blend(0.02));
    for (const s of [-1, 1]) B.p(PK.S.sphere(0.03).at(0.82, 1.3, s * 0.08).color(0x2a2420));
    return B.part();
  }, 40);
}
function carpet(X, k) { return PC.sculpt(`carpet|${k}|${X.pal.cloth}|${X.pal.trim}`, () => { const B = new PK.SB(); const c1 = [X.pal.cloth, 0x8a1a2a, 0x2a3a8a, 0x2a6a3a][k % 4]; B.h(PK.H.sheet(2.4, 1.3, 14, 8, (u, v) => [0, 0, 0.08 * Math.sin(u * 9 + k) + 0.06 * Math.sin(v * 3.14)]).rot(-90, 0, 0).color(c1).pbr(0.9).shade((x, y, z) => (Math.abs(x) > 1.05 || Math.abs(z) > 0.5 ? lin(X.pal.trim) : (Math.abs(Math.sin(x * 6) * Math.sin(z * 8)) > 0.7 ? lin(X.pal.trim) : null)))); return B.part(); }, 30); }
function floatStone(X, k) { return PC.sculpt(`fstone|${X.pal.rock}|${k}|${X.pal.glow}`, () => { const B = new PK.SB(); B.p(PK.S.ellipsoid(0.8, 0.6 + k * 0.2, 0.7).color(X.pal.rock).pbr(0.9).bump(0.06, 3, 'rock')); B.p(PK.S.box(0.1, 0.5, 0.3, 0.01).at(0.78, 0, 0).paint(0.02).color(X.pal.glow).glow(1.4)); return B.part(); }, 24); }
function crane(X, s) {
  const r = rimSide(X, s, 3)[1] || X.rim[12];
  const g = grp(X, [r[0], r[1], r[2]]);
  const arm = new THREE.Group(); g.add(arm);
  piece(X, tubeGeo(`cranepost`, [[0, 0, 0], [0, 4, 0]], 0.22, lin(X.pal.wood), { sides: 8, bark: true }), g, [0, 0, 0], [0, 0, 0], 1);
  piece(X, tubeGeo(`cranearm`, [[0, 4, 0], [0, 4.6, 3.6 * s]], 0.16, lin(X.pal.wood), { sides: 8, bark: true }), arm, [0, 0, 0], [0, 0, 0], 1);
  const hookG = grp(X, [0, 4.5, 3.6 * s], arm);
  const rope = piece(X, tubeGeo(`cranerope`, [[0, 0, 0], [0, -1, 0]], 0.03, lin(0x3a3028), { sides: 5 }), hookG, [0, 0, 0], [0, 0, 0], 1);
  const net = piece(X, crates(X), hookG, [0, -1.2, 0], [0, 0, 0], 1.2);
  return { g, arm, hookG, rope, net, at: [r[0], r[1] + 3, r[2] + 3.6 * s] };
}
function crates(X) { return PC.sculpt(`crates|${X.pal.wood}`, () => { const B = new PK.SB(); for (let i = 0; i < 5; i++) B.p(PK.S.box(0.5, 0.4, 0.5, 0.02).rot(0, i * 25, 0).at((i % 3 - 1) * 0.45, Math.floor(i / 3) * 0.42 - 0.6, (i % 2) * 0.3 - 0.15).color(X.pal.wood).pbr(0.85).bump(0.004, 20, 'fur')); B.p(PK.S.sphere(0.85).at(0, -0.55, 0).paint(0.1).color(0x6a5a3a)); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; B.h(PK.H.tube([[0, 0, 0], [Math.cos(a) * 0.7, -0.5, Math.sin(a) * 0.6], [Math.cos(a) * 0.5, -0.95, Math.sin(a) * 0.4]], 0.02).color(0x5a4a30)); } return B.part(); }, 36); }

/** roosting beasts: drakes, birds and bats on ledges, terraces and towers, shifting now and then */
function roosts(X) {
  const kind = X.kw('dragon', 'drake', 'wyvern', 'wyrm') ? 'drake' : X.kw('bat') ? 'bat' : 'bird';
  const fac = { graal: [0xf0f0f0, 0xd8d0c0], aethel: [0xf0ece4, 0x9ab8e0], thousandgods: [0xd8a030, 0xc83a1a], kaelneth: [0x4a3a4a, 0x2a2030], gorge: [0x4a3a2a, 0xd8c8b0], kurgan: [0x4a3a2a, 0xd8c8b0], greenhide: [0x5a6a3a, 0x3a4a2a] }[X.fid] || [hexMix(X.pal.hull, 0x6a5a40, 0.5), hexMix(X.pal.hull, 0x3a3020, 0.5)];
  const geo = kind === 'drake' ? drake(X, fac) : PC.perchedBird({ col: fac[0], col2: fac[1], beak: 0xd8a030 });
  const spots = [];
  if (X.ledges) spots.push(...X.ledges.map((l) => ({ p: [l[0], l[1], l[2]], a: l[3] })));
  if (X.towerTops) spots.push(...X.towerTops.map((p) => ({ p: [p[0] + 0.6, p[1] - 2.2, p[2]], a: Math.atan2(p[2], p[0]) })));
  for (let i = 0; i < 6; i++) { const p = take(X, 1.6, 'edge'); if (p) spots.push({ p, a: Math.atan2(p[2], p[0]) }); }
  const s = kind === 'drake' ? 2.2 : 1.6;
  spots.slice(0, 10).forEach((sp, i) => {
    const g = grp(X, sp.p); g.rotation.y = -sp.a + (h1(i) - 0.5) * 1.2;
    piece(X, geo, g, [0, 0, 0], [0, 0, 0], s);
    X.anim.beasts.push({ o: g, base: g.rotation.y, phase: i * 1.9, rate: 0.13 + h1(i) * 0.1 });
  });
}
function drake(X, fac) {
  return PC.sculpt(`drake|${fac[0]}|${fac[1]}`, () => {
    const B = new PK.SB(), hide = (p, k = 0.08) => p.color(fac[0]).pbr(0.55).blend(k).bump(0.006, 18, 'scales');
    B.p(hide(PK.S.ellipsoid(0.55, 0.3, 0.3).at(0, 0.55, 0), 0.12));
    PK.SKH.limb(B, [[0.4, 0.6, 0], [0.7, 0.95, 0], [0.85, 1.2, 0]], [0.16, 0.12, 0.1], fac[0], { k: 0.06, bump: [0.006, 18, 'scales'] });
    B.p(hide(PK.S.ellipsoid(0.22, 0.12, 0.12).at(1.0, 1.24, 0), 0.06));
    for (const s of [-1, 1]) {
      B.p(PK.S.sphere(0.03).at(1.1, 1.3, s * 0.07).color(0xffc030).glow(1.2));
      PK.SKH.horn(B, [[0.95, 1.33, s * 0.06], [0.8, 1.48, s * 0.1], [0.66, 1.52, s * 0.1]], 0.035, 0xd8c8a0, { rings: 5 });
      PK.SKH.limb(B, [[0.25, 0.45, s * 0.18], [0.35, 0.15, s * 0.22], [0.45, 0.0, s * 0.22]], [0.08, 0.06, 0.05], fac[0], { k: 0.03 });
      PK.SKH.limb(B, [[-0.3, 0.45, s * 0.2], [-0.2, 0.15, s * 0.26], [-0.05, 0.0, s * 0.26]], [0.11, 0.07, 0.05], fac[0], { k: 0.03 });
      // folded wing
      B.p(PK.S.ellipsoid(0.6, 0.25, 0.05).rot(s * 10, 0, 25).at(-0.1, 0.85, s * 0.28).color(fac[1]).pbr(0.6).blend(0.04));
      PK.SKH.limb(B, [[0.15, 0.75, s * 0.25], [0.05, 1.15, s * 0.32], [-0.6, 0.95, s * 0.3]], [0.05, 0.04, 0.02], fac[0], { k: 0.02 });
    }
    PK.SKH.limb(B, [[-0.5, 0.5, 0], [-0.9, 0.35, 0.15], [-1.3, 0.2, 0.05], [-1.6, 0.15, -0.15]], [0.14, 0.09, 0.06, 0.02], fac[0], { k: 0.05, bump: [0.006, 18, 'scales'] });
    return B.part();
  }, 40);
}

// =============================================================================================
// ability fixtures: anchors and actions
// =============================================================================================
export function fixtures(X) {
  const L = X.L, A = X.actions, act = (X.act = {});
  const has = (k) => X.ab.has(k);
  const midY = (x, z) => (under(X, x, z) + deckY(X, x, z)) / 2;
  const Rmax = Math.max(...X.extent);
  // ---- broadside: gun decks down both flanks ----
  X.guns = [];
  if (has('broadside') || X.has('cannons')) {
    const kind = X.S.figure === 'dragon' || X.fid === 'tianlong' ? 'dragon' : X.kw('skull') ? 'skull' : 'cannon';
    const geo = PC.cannon({ metal: X.kw('brass', 'bronze') ? 0xb8862a : 0x3a3a40, wood: X.pal.wood, trim: X.pal.trim, kind });
    for (const s of [-1, 1]) {
      const g = grp(X, [0, 0, 0]);
      let spots;
      if (X.hullSpec) { const sp = X.hullSpec, rows = sp.ports.length || 1, per = Math.floor((sp.HL * 0.72) / 1.35); spots = []; for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) { const x = -sp.HL / 2 + sp.HL * 0.12 + (i + 0.5) * 1.35, t = (x + sp.HL / 2) / sp.HL, y = -(sp.ports[r]?.y ?? 0.3) * sp.HD, b = X.hullBeamAt ? X.hullBeamAt(t) : sp.HB / 2 * (t > 0.6 ? Math.sqrt(Math.max(0, 1 - ((t - 0.6) / 0.4) ** 2)) : 1); spots.push([x, y, s * (b - 0.25), s]); } }
      else if (X.muzzleHint) spots = X.muzzleHint.filter((p) => Math.sign(p[2]) === s).map((p) => [p[0], p[1], p[2] - s * 0.3, s]);
      else spots = rimSide(X, s, 7).map((r) => [r[0] - r[3] * 0.35, r[1] - 0.6, r[2] - r[4] * 0.35, s]);
      for (const p of spots) { place(X, geo, [p[0], p[1] - 0.3, p[2]], [0, s > 0 ? -PI / 2 : PI / 2, 0], 1.35, g); X.muzzles.push([+p[0].toFixed(2), +(p[1] + 0.12).toFixed(2), +(p[2] + s * 1.3).toFixed(2)]); }
      X.guns.push({ g, s });
    }
    X.anchors.broadside = [0, X.muzzles.length ? X.muzzles[0][1] : 0, 0];
    X.sets.broadside = X.muzzles.slice();
  }
  const recoil = (k) => { for (const G of X.guns) { const r = pulse(clamp(k * 1.3 - (G.s > 0 ? 0 : 0.15), 0, 1), 0.08) * 0.35; G.g.position.z = -G.s * r; } };
  if (X.guns.length) { A.broadside = (k) => { recoil(k >= 1 ? 1 : k); flare(X.fx.gunGlow, k, 1); }; A.fire = A.broadside; }
  // ---- point defence: turrets round the rim ----
  X.turrets = [];
  if (has('pointDefense') || X.has('turrets')) {
    const geo = PC.turret({ metal: hexMix(X.pal.hull, 0x4a4a50, 0.5), trim: X.pal.trim, glow: X.pal.glow });
    const n = clamp(X.n('turrets', 6), 4, 8);
    for (let i = 0; i < n; i++) {
      const r = X.rim[Math.floor(((i + 0.5) / n) * X.rim.length) % X.rim.length];
      const g = grp(X, [r[0] - r[3] * 0.8, r[1] + 0.1, r[2] - r[4] * 0.8]);
      const yaw = -Math.atan2(r[4], r[3]); g.rotation.y = yaw;
      piece(X, geo, g, [0, 0, 0], [0, 0, 0], 1.5);
      X.turrets.push({ g, yaw, i });
    }
    X.sets.pointDefense = X.turrets.map((t) => [+t.g.position.x.toFixed(2), +(t.g.position.y + 0.5).toFixed(2), +t.g.position.z.toFixed(2)]);
    X.anchors.pointDefense = X.sets.pointDefense[0];
    A.pointDefense = (k) => { for (const t of X.turrets) { t.g.rotation.y = t.yaw + (k >= 1 ? 0 : Math.sin(k * 9 + t.i) * 0.5 * hold(k)); t.g.position.y = t.g.position.y; } };
    A.flak = A.pointDefense; if (!A.fire) A.fire = A.pointDefense;
  }
  // ---- beam: a lens of crystal in turning gimbal rings ----
  if (has('beam')) {
    const at = X.capAt ? [X.capAt[0], X.capAt[1] + 1.4, X.capAt[2]] : X.spireTop ? [0, X.spireTop[1] + 1.2, 0] : X.eyeAt ? X.eyeAt : X.mouthAt ? X.mouthAt : [X.extent[0] * 0.75, midY(X.extent[0] * 0.6, 0), 0];
    const free = !X.eyeAt && !X.mouthAt;
    const g = grp(X, at);
    if (free) {
      const rings = [];
      for (let i = 0; i < 2; i++) { const sub = new THREE.Group(); sub.rotation.set(i ? PI / 2 : 0, 0, i ? 0 : PI / 2); g.add(sub); const sp = new THREE.Group(); sub.add(sp); piece(X, ringGeo(`lens|${X.fid}|${i}`, 1.5 - i * 0.3, 0.1, X.pat.trim, { rune: lin(X.pal.glow), ry: 0.6, rz: 1.4 }), sp, [0, 0, 0], [0, 0, 0], 1); rings.push(sp); X.anim.spin.push({ o: sp, axis: 'y', speed: 0.5 * (i ? -1 : 1), beam: true }); }
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), glowMat(X, X.pal.glow, 1.6, { flick: 0.2, roughness: 0.2 }));
      g.add(core); X.fx.beam = core.material;
      place(X, PC.crystals({ glow: X.pal.glow, base: X.pal.trim }, 7), [0, -0.6, 0], [0, 0, 0], 0.8, g);
    } else { const halo = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), glowMat(X, X.pal.glow, 1.8, { flick: 0.25, transparent: true, opacity: 0.5, depthWrite: false })); g.add(halo); X.fx.beam = halo.material; }
    X.anchors.beam = at;
    A.beam = (k) => { flare(X.fx.beam, k, 3); act.beam = k >= 1 ? 0 : hold(k, 0.15, 0.85); };
  }
  // ---- barrage: racks of rockets (or skull mortars) on the deck ----
  if (has('barrage') || X.has('rocketRacks')) {
    const n = clamp(X.n('rocketRacks', 4), 2, 6), skulls = X.kw('skull') && !X.kw('rocket');
    const geo = skulls ? PC.cannon({ metal: 0x3a3a40, wood: X.pal.wood, trim: X.pal.trim, kind: 'skull' }) : PC.rocketRack({ metal: 0x4a4a50, wood: X.pal.wood, trim: X.pal.trim });
    X.racks = [];
    for (let i = 0; i < n; i++) { const p = take(X, 1.4, i % 2 ? 'stern' : 'bow') || [X.rim[i * 9 % 48][0] * 0.8, deckY(X, 0, 0), X.rim[i * 9 % 48][2] * 0.8]; const g = grp(X, p); g.rotation.y = h1(i) * 0.8 - 0.4 + (i % 2 ? PI : 0); const tilt = new THREE.Group(); g.add(tilt); piece(X, geo, tilt, [0, 0, 0], skulls ? [0, 0, 0.8] : [0, 0, 0], 1.4); X.racks.push({ g, tilt, p }); }
    X.sets.barrage = X.racks.map((r) => [+r.p[0].toFixed(2), +(r.p[1] + 1.4).toFixed(2), +r.p[2].toFixed(2)]);
    X.anchors.barrage = X.sets.barrage[0];
    X.fx.rockets = glowMat(X, 0xff8a2a, 0.0, { flick: 0.3 });
    A.barrage = (k) => { for (const r of X.racks) r.tilt.rotation.z = (k >= 1 ? 0 : 0.25 * hold(k, 0.15, 0.7)); flare(X.fx.rockets, k, 1); };
    A.mortar = A.barrage;
  }
  // ---- bomb bay: keel doors under the belly ----
  if (has('bombBay') || X.form === 'airship') {
    const x0 = X.keelLine ? X.keelLine[0][0] * 0.3 : 0, y0 = under(X, x0, 0) + (X.hullSpec ? 0.15 : 0.4), w = Math.min(5, X.extent[0] * 0.4), d = 1.4;
    X.doors = [];
    const doorP = X.hullSpec ? X.pat.plate : X.pat.wallPlain;
    const dg = prismGeo(`door|${X.fid}`, { plan: 'rect', w, d, corner: 0.05, prof: [[1, 0, -0.12, 'p'], [1, 0, 0.12, 'p'], [0, 0, 0.12, 'p']], mats: { p: { ...doorP, pat: 'plate' } }, dens: 8 }, 0);
    for (const s of [-1, 1]) { const g = grp(X, [x0, y0, s * d]); piece(X, dg, g, [0, 0, -s * d / 2], [0, 0, 0], 1); X.doors.push({ g, s }); }
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.95, d * 1.9).rotateX(PI / 2), new THREE.MeshBasicMaterial({ color: 0x080604 })); mouth.position.set(x0, y0 + 0.2, 0); X.I.add(mouth);
    X.anchors.bombBay = [x0, y0 - 0.3, 0];
    const bay = (k) => { const o = hold(k, 0.15, 0.75); for (const D of X.doors) D.g.rotation.x = D.s * 1.3 * o; };
    if (has('bombBay')) A.bombBay = bay;
    A.bomb = bay;
  }
  // ---- hangar: bay doors in the stern and a landing deck ----
  if (has('hangar')) {
    const r = rimAt(X, PI), at = [r[0] + 0.4, r[1], r[2]];
    const g = grp(X, at);
    const deck = prismGeo(`hdeck|${X.fid}`, { plan: 'rect', w: 5, d: 4.2, corner: 0.1, prof: [[1, 0, -0.5, 'p'], [1, 0, 0, 'p'], [0, 0, 0, 'f']], mats: { p: X.pat.plate, f: { ...X.pat.floor, pat: 'plank' } }, dens: 9 }, 0);
    piece(X, deck, g, [-2.2, -0.05, 0], [0, 0, 0], 1);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) place(X, PC.lantern('iron', { metal: X.pal.trim, glow: X.pal.glow }), [-0.4 - i * 1.2, 0, s * 1.9], [0, 0, 0], 0.7, g);
    X.hatch = [];
    for (const s of [-1, 1]) { const hg = grp(X, [0.6, 0, s * 1.6], g); piece(X, prismGeo(`hdoor|${X.fid}`, { plan: 'rect', w: 0.2, d: 1.6, corner: 0.03, prof: [[1, 0, 0, 'p'], [1, 0, 3.2, 'p'], [0, 0, 3.2, 'p']], mats: { p: X.pat.plate }, dens: 9 }, 0), hg, [0, 0, -s * 0.8], [0, 0, 0], 1); X.hatch.push({ g: hg, s }); }
    X.anchors.hangar = [at[0] - 3, at[1] + 0.5, at[2]];
    X.hangarAt = X.anchors.hangar;
    A.hangar = (k) => { const o = hold(k, 0.15, 0.7); for (const h of X.hatch) h.g.rotation.y = h.s * 1.4 * o; };
    A.launch = A.hangar;
  }
  // ---- drop pods: racks of pods under the keel ----
  X.podsG = [];
  if (has('dropPods')) {
    const geo = podGeo(X);
    for (let i = 0; i < 6; i++) { const x = (i % 3 - 1) * X.extent[0] * 0.25, z = (i < 3 ? -1 : 1) * Math.min(2.4, X.extent[1] * 0.4), y = under(X, x, z) + 0.2; const g = grp(X, [x, y, z]); piece(X, geo, g, [0, 0, 0], [0, 0, 0], 1.3); X.podsG.push({ g, y0: y }); X.pods.push([+x.toFixed(2), +(y - 1.2).toFixed(2), +z.toFixed(2)]); }
    X.anchors.dropPods = [0, Math.min(...X.podsG.map((p) => p.y0)) - 1.2, 0];
    X.sets.dropPods = X.pods.slice();
    A.dropPods = (k) => { X.podsG.forEach((p, i) => { const kk = clamp(k * 1.4 - i * 0.07, 0, 1); p.g.position.y = p.y0 - (kk >= 1 || k >= 1 ? 0 : kk * kk * 9); p.g.visible = k >= 1 || kk < 0.95; }); };
  }
  // ---- extraction: winch cages that lower on chains and lift folk aboard ----
  if (has('extraction')) {
    X.winches = [];
    for (const s of [-1, 1]) {
      const r = rimSide(X, s, 3)[1] || X.rim[s > 0 ? 12 : 36];
      const g = grp(X, [r[0] + r[3] * 0.6, r[1] + 1.4, r[2] + r[4] * 0.6]);
      piece(X, tubeGeo(`gantry|${s}`, [[-r[3] * 1.4, -1.4, -r[4] * 1.4], [0, 0, 0]], 0.14, lin(X.pal.trim), { sides: 8, me: 0.8 }), g, [0, 0, 0], [0, 0, 0], 1);
      const drop = grp(X, [0, 0, 0], g);
      const chain = piece(X, chainGeo(X, 1, 0.08), drop, [0, 0, 0], [0, 0, 0], [1, 2.5, 1]);
      const cg = grp(X, [0, -2.5, 0], drop);
      piece(X, PC.cage({ metal: X.pal.trim, bone: 0xd8cfb4 }), cg, [0, 0, 0], [0, 0, 0], 1.8);
      X.winches.push({ chain, cg, base: 2.5 });
      X.anim.sway.push({ o: drop, axis: 'z', amp: 0.05, speed: 0.6, phase: s });
    }
    X.anchors.extraction = [X.winches[0].cg.parent.parent.position.x, X.winches[0].cg.parent.parent.position.y - 2.5, X.winches[0].cg.parent.parent.position.z];
    X.sets.extraction = X.winches.map((w) => { const p = w.cg.parent.parent.position; return [+p.x.toFixed(2), +(p.y - 2.5).toFixed(2), +p.z.toFixed(2)]; });
    A.extraction = (k) => { const o = hold(k, 0.3, 0.7), len = 2.5 + o * 9; for (const w of X.winches) { w.chain.scale.y = len; w.cg.position.y = -len; } };
    A.board = A.extraction; A.grapple = A.grapple || A.extraction;
  }
  // ---- supply drop: a crane swinging a net of crates out over the side ----
  if (has('supplyDrop')) {
    const c = crane(X, -1);
    X.anchors.supplyDrop = c.at;
    A.supplyDrop = (k) => { const o = hold(k, 0.25, 0.75); c.arm.rotation.y = -0.5 * o; c.hookG.position.y = 4.5 - o * 3; c.net.visible = k >= 1 || k < 0.7; };
  }
  // ---- snipers: galleries of the realm's marksmen at the rim and on the heights ----
  if (has('snipers')) {
    const P = PC.soldier(X.fid);
    X.sets.snipers = [];
    for (let i = 0; i < 6; i++) {
      const r = X.rim[(i * 8 + 2) % X.rim.length], p = [r[0] - r[3] * 0.5, r[1], r[2] - r[4] * 0.5];
      if (P) piece(X, P.geos, X.I, p, [0, -Math.atan2(r[4], r[3]) + PI / 2, 0], 1.25 / P.height);
      X.sets.snipers.push(p.map((v) => +v.toFixed(2)));
    }
    X.anchors.snipers = X.sets.snipers[0];
  }
  // ---- aura: a great standard and war-drums (or the realm's banners) ----
  if (has('aura')) {
    const p = take(X, 1.5, 'centre') || [0, deckY(X, 0, 0), 0];
    const g = grp(X, p);
    if (X.has('drums')) piece(X, PC.drum({ wood: X.pal.wood, hide: 0xd8c8a0, trim: X.pal.trim }), g, [0, 0, 0], [0, 0, 0], 1.8);
    else piece(X, PC.totem({ wood: X.pal.wood, paint: X.pal.cloth, paint2: X.pal.trim }), g, [0, 0, 0], [0, 0, 0], 1.6);
    bannerAt(X, [p[0] + 1.4, p[1], p[2]], 5, 1.6, 2.6, 0);
    X.auraG = g;
    X.anchors.aura = [p[0], p[1] + 3, p[2]];
    X.fx.aura = glowMat(X, X.pal.glow, 0, { flick: 0.2 });
    A.aura = (k) => { act.aura = k >= 1 ? 0 : hold(k); flare(X.fx.aura, k, 1); };
  }
  // ---- sonic: the great bell (or a horn) ----
  if (has('sonic')) {
    if (!X.bells || !X.bells.length) { const g = grp(X, [0, under(X, 0, 0) - 0.2, 0]); piece(X, PC.bell({ metal: X.pal.trim, trim: hexShade(X.pal.trim, 0.8), glow: X.pal.glow }), g, [0, 0, 0], [0, 0, 0], 3.2); X.anim.sway.push({ o: g, axis: 'z', amp: 0.05, speed: 0.7, phase: 0, bell: true }); X.bells = [{ g, p: [0, under(X, 0, 0), 0], s: 3.2 }]; }
    const b = X.bells[0];
    X.anchors.sonic = [b.p[0], b.p[1] - b.s * 0.8, b.p[2]];
    A.sonic = (k) => { act.sonic = k >= 1 ? 0 : hold(k, 0.1, 0.8); };
  }
  // ---- lightning: a rod of coils and orbs on the highest point ----
  if (has('lightning')) {
    const top = (X.towerTops && X.towerTops.length ? X.towerTops.reduce((a, b) => (b[1] > a[1] ? b : a)) : [0, X.top - 2, 0]);
    const g = grp(X, [top[0], top[1] - 0.2, top[2]]);
    piece(X, coilGeo(X), g, [0, 0, 0], [0, 0, 0], 1.4);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), glowMat(X, 0xa8d8ff, 1.2, { flick: 0.6 })); orb.position.y = 3.6; g.add(orb);
    X.fx.lightning = orb.material;
    X.anchors.lightning = [top[0], top[1] + 4.6, top[2]];
    A.lightning = (k) => flare(X.fx.lightning, k, 6);
  }
  // ---- ward: an orb on a mast with rings, the dome is centred under the keel ----
  if (has('ward')) {
    const p = X.spireTop ? [0, X.spireTop[1] - 3, 0] : [0, (X.keepTop || X.palaceTop || X.top * 0.6), 0];
    const g = grp(X, p);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 2), glowMat(X, hexMix(X.pal.glow, 0xa0c8ff, 0.4), 1.2, { flick: 0.15, transparent: true, opacity: 0.85 }));
    g.add(orb); X.fx.ward = orb.material;
    const sp = new THREE.Group(); g.add(sp); piece(X, ringGeo(`ward|${X.fid}`, 1.3, 0.07, X.pat.trim, { rune: lin(X.pal.glow) }), sp, [0, 0, 0], [0.6, 0, 0], 1); X.anim.spin.push({ o: sp, axis: 'y', speed: 0.8 });
    X.anchors.ward = [0, under(X, 0, 0), 0]; X.anchors.wardOrb = p;
    A.ward = (k) => flare(X.fx.ward, k, 3);
  }
  // ---- teleport: a gate ring under the hull, a sheet of light in it ----
  if (has('teleport')) {
    const x = -X.extent[0] * 0.2, y = under(X, x, 0) - 1.2;
    const g = grp(X, [x, y, 0]);
    const sp = new THREE.Group(); sp.rotation.x = PI / 2; g.add(sp);
    piece(X, ringGeo(`gate|${X.fid}`, 2.2, 0.22, X.pat.trim, { rune: lin(X.pal.glow), ry: 0.8, rz: 1.2 }), sp, [0, 0, 0], [0, 0, 0], 1);
    const disc = piece(X, flowShell(`gatedisc`, [[0.05, 0], [2.1, 0.01]], { nu: 32, nv: 4 }), g, [0, 0, 0], [0, 0, 0], 1, flowMat(X, 'vortex', X.pal.glow, 0.0, true));
    X.fx.gate = disc.material;
    rigging(X, [[[x, y + 2.2 * 0, 2.2], [x, under(X, x, 1.5) + 0.2, 1.5]], [[x, y, -2.2], [x, under(X, x, -1.5) + 0.2, -1.5]]], 0x3a3634, 0.08);
    X.anchors.teleport = [x, y - 0.4, 0];
    X.gateRing = sp;
    A.teleport = (k) => { const o = hold(k, 0.2, 0.8); X.fx.gate.opacity = 0.75 * o; act.gate = o; };
  }
  // ---- cloud, raise, heal, flares, camouflage, swarm, meteor, phase, gale, harpoon ----
  const vent = (kind, col, n, where = 'under') => {
    const mat = glowMat(X, col, 0.4, { flick: 0.3 });
    const pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + 0.5, x = Math.cos(a) * X.extent[0] * 0.5, z = Math.sin(a) * X.extent[1] * 0.5, y = where === 'under' ? under(X, x, z) + 0.6 : deckY(X, x, z); const g = grp(X, [x, y, z]); place(X, censer(X), [0, 0, 0], where === 'under' ? [PI, 0, 0] : [0, 0, 0], 1.2, g); const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), mat); m.position.y = where === 'under' ? -0.9 : 0.9; g.add(m); pts.push([+x.toFixed(2), +(y + (where === 'under' ? -1 : 1)).toFixed(2), +z.toFixed(2)]); }
    X.sets[kind] = pts; X.anchors[kind] = pts[0];
    return mat;
  };
  if (has('cloud')) { const m = vent('cloud', X.kw('plague', 'rot', 'slime', 'green') ? 0x9ad83a : X.kw('warp', 'fire') ? 0xff6a2a : X.pal.glow, 4); X.anchors.cloud = [0, under(X, 0, 0) - 1, 0]; A.cloud = (k) => flare(m, k, 4); }
  if (has('raise')) { const m = vent('raise', X.pal.glow, 3); X.anchors.raise = [0, under(X, 0, 0) - 1, 0]; A.raise = (k) => flare(m, k, 5); }
  if (has('camouflage')) { const m = vent('camouflage', 0xa0a8b0, 3, 'top'); A.camouflage = (k) => flare(m, k, 2); }
  if (has('heal')) {
    const p = take(X, 1.4, 'centre') || [0, deckY(X, 0, 0), 0];
    const g = grp(X, p); place(X, fontGeo(X), [0, 0, 0], [0, 0, 0], 1.4, g);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), glowMat(X, hexMix(X.pal.glow, 0xa0ffb0, 0.4), 0.6, { flick: 0.15 })); m.position.y = 1.6; g.add(m);
    X.anchors.heal = [p[0], under(X, p[0], p[2]) - 0.5, p[2]]; X.anchors.healFont = [p[0], p[1] + 1.6, p[2]];
    A.heal = (k) => flare(m.material, k, 4);
  }
  if (has('flares')) { const m = vent('flares', 0xff4a2a, 2, 'top'); A.flares = (k) => flare(m, k, 6); }
  if (has('swarm')) {
    const geo = hiveGeo(X), pts = [];
    for (let i = 0; i < 3; i++) { const r = X.rim[(i * 16 + 10) % X.rim.length], p = [r[0] - r[3] * 0.2, r[1] - 0.4, r[2] - r[4] * 0.2]; const g = grp(X, p); place(X, geo, [0, 0, 0], [0, i, 0], 1.5, g); X.anim.sway.push({ o: g, axis: 'z', amp: 0.06, speed: 0.9, phase: i }); pts.push(p.map((v) => +v.toFixed(2))); }
    X.sets.swarm = pts; X.anchors.swarm = pts[0];
    const m = glowMat(X, 0xffd040, 0, { flick: 0.5 });
    A.swarm = (k) => flare(m, k, 2);
  }
  if (has('meteor')) {
    const p = X.peak ? [X.peak[0], X.peak[1] + 0.3, X.peak[2]] : X.spireTop ? [0, X.spireTop[1] - 2, 0] : (take(X, 2.4, 'centre') || [0, deckY(X, 0, 0), 0]);
    const g = grp(X, p);
    const sp = new THREE.Group(); g.add(sp);
    piece(X, ringGeo(`ritual|${X.fid}`, 2.4, 0.12, X.pat.trim, { rune: lin(X.pal.glow), ry: 0.4, rz: 1.6 }), sp, [0, 0.2, 0], [0, 0, 0], 1);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; place(X, PC.crystals({ glow: X.pal.glow, base: X.pal.rock }, 5), [Math.cos(a) * 2.4, 0, Math.sin(a) * 2.4], [0, a, 0], 0.6, g); }
    X.anim.spin.push({ o: sp, axis: 'y', speed: 0.25, meteor: true });
    const m = glowMat(X, X.pal.glow, 0, { flick: 0.3 });
    X.anchors.meteor = [p[0], p[1] + 30, p[2]]; X.anchors.ritual = p;
    X.meteorRing = sp;
    A.meteor = (k) => { flare(m, k, 4); act.meteor = k >= 1 ? 0 : hold(k); };
  }
  if (has('phase')) { const m = glowMat(X, X.pal.glow, 0, { flick: 0.8 }); X.anchors.phase = [0, (deckY(X, 0, 0) + under(X, 0, 0)) / 2, 0]; A.phase = (k) => { act.phase = k >= 1 ? 0 : hold(k); flare(m, k, 2); }; }
  if (has('gale')) {
    X.fans = [];
    for (const s of [-1, 1]) { const r = rimSide(X, s, 3)[0] || X.rim[s > 0 ? 12 : 36], g = grp(X, [r[0] - 1, r[1] - 0.6, r[2] + r[4] * 0.8]); piece(X, hornGeo(X), g, [0, 0, 0], [0, s > 0 ? -PI / 2 : PI / 2, 0], 1.6); X.fans.push(g); }
    X.anchors.gale = [X.fans[0].position.x, X.fans[0].position.y, X.fans[0].position.z]; X.sets.gale = X.fans.map((g) => [+g.position.x.toFixed(2), +g.position.y.toFixed(2), +g.position.z.toFixed(2)]);
    A.gale = (k) => { act.gale = k >= 1 ? 0 : hold(k); for (const g of X.fans) g.scale.setScalar(1 + 0.15 * pulse(k, 0.3)); };
  }
  if (has('harpoon')) {
    const at = X.bowAt || [X.extent[0] * 0.95, deckY(X, X.extent[0] * 0.9, 0), 0];
    const g = grp(X, at); const rec = new THREE.Group(); g.add(rec);
    piece(X, PC.harpoonGun({ metal: 0x4a4a50, wood: X.pal.wood, trim: X.pal.trim }), rec, [0, 0, 0], [0, 0, 0], 1.8);
    X.anchors.harpoon = [at[0] + 2.6, at[1] + 1.1, at[2]];
    A.harpoon = (k) => { rec.position.x = -0.5 * pulse(k, 0.06); };
    A.grapple = A.harpoon;
  }
  // generic hooks every airship has
  A.hit = (k) => { const s = k >= 1 ? 0 : Math.sin(k * 30) * (1 - k) * (1 - k); X.I.rotation.x = X.listX + 0.02 * s; X.I.rotation.z = X.listZ + 0.012 * Math.sin(k * 21 + 1) * (1 - k); X.I.position.y = -0.08 * s * s; if (k >= 1) { X.I.rotation.x = X.listX; X.I.rotation.z = X.listZ; X.I.position.y = 0; } };
  for (const [k, v] of Object.entries({ fire: A.broadside || A.pointDefense, mortar: A.barrage, bomb: A.bombBay || A.bomb, launch: A.hangar, board: A.extraction, grapple: A.harpoon || A.extraction })) if (v && !A[k]) A[k] = v;
  for (const k of X.ab.keys()) if (!A[k]) A[k] = (kk) => { act[k] = kk >= 1 ? 0 : hold(kk); };
}
function flare(m, k, peak) { if (!m) return; m.userData.boost = k >= 1 ? 0 : peak * pulse(k, 0.15); }
function podGeo(X) { return PC.sculpt(`pod|${X.pal.trim}|${X.pal.hull}`, () => { const B = new PK.SB(); B.p(PK.S.capsule([0, -0.1, 0], [0, -1.4, 0], 0.42, 0.28).color(hexMix(X.pal.hull, 0x5a5a60, 0.5)).pbr(0.45, 0.7).bump(0.003, 30, 'noise')); B.p(PK.S.cone(0.3, 0.0, 0.5).rot(180, 0, 0).at(0, -1.75, 0).color(X.pal.trim).pbr(0.35, 0.85)); for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; B.p(PK.S.box(0.04, 0.5, 0.3, 0.01).rot(0, -a * 57.3, 0).at(Math.cos(a) * 0.4, -0.5, Math.sin(a) * 0.4).color(X.pal.trim).pbr(0.35, 0.85)); } B.p(PK.S.torus(0.42, 0.05).at(0, -0.3, 0).color(X.pal.trim).pbr(0.35, 0.85)); B.p(PK.S.box(0.15, 0.4, 0.04, 0.01).at(0, -0.8, 0.4).color(X.pal.glow).glow(1)); B.p(PK.S.torus(0.12, 0.04).rot(90, 0, 0).at(0, 0, 0).color(0x3a3634).pbr(0.5, 0.7)); return B.part(); }, 44); }
function censer(X) { return PC.sculpt(`censer|${X.pal.trim}`, () => { const B = new PK.SB(), M = (p) => p.color(X.pal.trim).pbr(0.35, 0.85).blend(0.02); B.p(M(PK.S.ellipsoid(0.45, 0.35, 0.45)).at(0, 0.45, 0)); B.p(M(PK.S.cone(0.3, 0.05, 0.5)).at(0, 0.95, 0)); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; B.p(PK.S.sphere(0.07).at(Math.cos(a) * 0.42, 0.5, Math.sin(a) * 0.42).cut(0.005)); } B.p(M(PK.S.cyl(0.25, 0.15)).at(0, 0.08, 0)); return B.part(); }, 44); }
function fontGeo(X) { return PC.sculpt(`font|${X.pal.trim}|${X.pal.stone}`, () => { const B = new PK.SB(); B.p(PK.S.cone(0.25, 0.4, 0.8, 0.02).at(0, 0.4, 0).color(X.pal.stone).pbr(0.8)); B.p(PK.S.ellipsoid(0.8, 0.3, 0.8).at(0, 0.95, 0).color(X.pal.trim).pbr(0.3, 0.9).blend(0.05)); B.p(PK.S.ellipsoid(0.7, 0.2, 0.7).at(0, 1.1, 0).cut(0.02)); B.p(PK.S.cyl(0.66, 0.02).at(0, 1.05, 0).color(hexMix(X.pal.glow, 0x80c0ff, 0.5)).glow(1.2)); return B.part(); }, 40); }
function hiveGeo(X) { return PC.sculpt(`hive|${X.fid}`, () => { const B = new PK.SB(); B.p(PK.S.capsule([0, -0.2, 0], [0, -1.6, 0], 0.55, 0.35).color(0x8a6a3a).pbr(0.85).bump(0.02, 8, 'ridges')); for (let i = 0; i < 6; i++) B.p(PK.S.sphere(0.07).at(Math.cos(i) * 0.5, -0.6 - i * 0.15, Math.sin(i) * 0.5).cut(0.01).color(0x1a1006)); B.p(PK.S.capsule([0, 0, 0], [0, -0.3, 0], 0.06).color(0x4a3a2a)); return B.part(); }, 36); }
function hornGeo(X) { return PC.sculpt(`windhorn|${X.pal.trim}`, () => { const B = new PK.SB(), M = (p) => p.color(X.pal.trim).pbr(0.3, 0.9).blend(0.04); for (let i = 0; i < 6; i++) { const t = i / 5; B.p(M(PK.S.cyl(0.15 + t * t * 0.9, 0.35, 0.02)).rot(0, 0, 90).at(t * 2.2, 0, 0)); } B.p(PK.S.cyl(0.95, 0.4, 0.02).rot(0, 0, 90).at(2.35, 0, 0).cut(0.02)); B.p(M(PK.S.torus(1.0, 0.06)).rot(0, 0, 90).at(2.25, 0, 0)); return B.part(); }, 36); }
function coilGeo(X) { return PC.sculpt(`coil|${X.pal.trim}`, () => { const B = new PK.SB(), M = (p) => p.color(X.pal.trim).pbr(0.3, 0.9).blend(0.01); B.p(M(PK.S.cyl(0.12, 3.4)).at(0, 1.7, 0)); for (let i = 0; i < 9; i++) B.p(M(PK.S.torus(0.32 - i * 0.02, 0.05)).at(0, 0.6 + i * 0.3, 0)); for (let i = 0; i < 3; i++) B.p(M(PK.S.sphere(0.16 - i * 0.03)).at(0, 1.4 + i * 0.7, 0).color(0x8ac0e8).glow(0.8)); return B.part(); }, 44); }
void noise3; void lerp; void cap; void lightPillar; void astrolabe; void reserve; void mist; void vortex; void bannerAt;
