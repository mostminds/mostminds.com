// Faction dressing shared by airships and beasts: finials, figureheads, banners, trophies, carved motifs, helms
// and roofs, each drawn in the realm's style (style.js). Every builder works in its parent's space.
import { THREE, PI, TAU, SPH, CYL, CONE, TORUS, OCTA, HEMI, mesh, ell, blk, add, group, rod, spike, slab, lathe, sweep, horn, emblem, cloth, clothZ, tier, hash, lerp, rope } from './kit.js';
import { metalOpts } from './style.js';

/** the dressing materials of one model: C gets metal, accent, side (+ sideDark), wood, iron, rope, bone, leather, cloth, eye, lit, dark */
export function decoMats(T, S, sideM, sideDark, o = {}) {
  return {
    metal: T.t(S.metal, metalOpts(S.metalKind)), metalDark: T.t(new THREE.Color(S.metal).multiplyScalar(0.6).getHex(), metalOpts(S.metalKind)),
    accent: T.t(S.accent), wood: T.t(o.wood ?? S.wood), woodDark: T.t(new THREE.Color(o.wood ?? S.wood).multiplyScalar(0.62).getHex()),
    iron: T.t(0x3e3e44, { metalness: 0.6, roughness: 0.5 }), rope: T.t(0xb39a68), bone: T.t(0xddd2b6, { roughness: 0.7 }), leather: T.t(0x5a3a22),
    cloth: T.t(0xe8dcc0), eye: T.t(0x120c08, { roughness: 0.3 }), lit: T.lit(0xffc070, 1.1), dark: T.t(0x1c1816), side: sideM, sideDark,
    gem: T.lit(S.accent, 0.5),
  };
}
const toN = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
function at(P, x, y, z, n) { const g = group(P, x, y, z); if (n) g.quaternion.setFromUnitVectors(Z, toN.set(...n).normalize()); return g; }

// ---------- finials: on top of poles, envelope noses and roofs (pointing +y) ----------
export function finial(P, C, kind, x, y, z, s = 1) {
  const g = group(P, x, y, z); g.scale.setScalar(s);
  const M = C.metal;
  switch (kind) {
    case 'cross': ell(g, M, 0, 0.06, 0, 0.07); blk(g, M, 0, 0.32, 0, 0.06, 0.45, 0.06); blk(g, M, 0, 0.4, 0, 0.3, 0.06, 0.06); for (const [a, b] of [[0, 0.55], [0.15, 0.4], [-0.15, 0.4]]) ell(g, M, a, b, 0, 0.04); break;
    case 'star': ell(g, M, 0, 0.06, 0, 0.07); rod(g, M, [0, 0, 0], [0, 0.3, 0], 0.025); for (const r of [0, PI / 2]) { const e = emblem(g, M, 'star', 0.34, 0.04); e.position.y = 0.42; e.rotation.y = r; } break;
    case 'spire': lathe(g, M, [[0.08, 0], [0.1, 0.06], [0.05, 0.12], [0.07, 0.18], [0.03, 0.25], [0.004, 0.7]], 10, 'fin:spire'); break;
    case 'onion': lathe(g, M, [[0.04, 0], [0.12, 0.08], [0.17, 0.2], [0.14, 0.32], [0.06, 0.42], [0.02, 0.5], [0.004, 0.62]], 14, 'fin:onion'); break;
    case 'orb': rod(g, M, [0, 0, 0], [0, 0.18, 0], 0.03); ell(g, M, 0, 0.27, 0, 0.11); add(g, mesh(TORUS(0.12, 18), M, 0, 0.27, 0, 0.12)).rotation.x = PI / 2; spike(g, M, [0, 0.37, 0], [0, 0.55, 0], 0.025, 5); break;
    case 'pearl': lathe(g, M, [[0.03, 0], [0.12, 0.1], [0.14, 0.16]], 10, 'fin:cup'); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; spike(g, M, [Math.cos(a) * 0.08, 0.1, Math.sin(a) * 0.08], [Math.cos(a) * 0.18, 0.28, Math.sin(a) * 0.18], 0.035, 4); } ell(g, C.lit, 0, 0.26, 0, 0.12); break;
    case 'spike': lathe(g, M, [[0.08, 0], [0.09, 0.05], [0.05, 0.08], [0.06, 0.12], [0.004, 0.55]], 8, 'fin:spike'); break;
    case 'flame': ell(g, M, 0, 0.08, 0, 0.09, 0.07, 0.09); for (const r of [0, PI / 2]) { const e = emblem(g, M, 'flame', 0.42, 0.05); e.position.y = 0.32; e.rotation.y = r; } break;
    case 'crescent': rod(g, M, [0, 0, 0], [0, 0.18, 0], 0.025); ell(g, M, 0, 0.18, 0, 0.06); { const e = emblem(g, M, 'crescent', 0.42, 0.05); e.position.y = 0.42; e.rotation.z = PI / 2; } break;
    case 'lotus': for (let i = 0; i < 8; i++) { const q = group(g); q.rotation.y = -(i / 8) * TAU; ell(q, M, 0.09, 0.12, 0, 0.035, 0.13, 0.05).rotation.z = -0.5; } ell(g, C.gem, 0, 0.17, 0, 0.06); spike(g, M, [0, 0.2, 0], [0, 0.45, 0], 0.03, 5); break;
    case 'crystal': add(g, mesh(OCTA(), C.gem, 0, 0.3, 0, 0.1, 0.3, 0.1)); for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; const c = add(g, mesh(OCTA(), C.gem, Math.cos(a) * 0.08, 0.15, Math.sin(a) * 0.08, 0.05, 0.16, 0.05)); c.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); } break;
    case 'acorn': ell(g, C.wood, 0, 0.2, 0, 0.11, 0.15, 0.11); add(g, mesh(HEMI(), M, 0, 0.24, 0, 0.125, 0.09, 0.125)); rod(g, M, [0, 0.32, 0], [0.02, 0.4, 0], 0.015); break;
    case 'horn': horn(g, C.bone, [[0, 0, 0], [0.05, 0.2, 0], [0.18, 0.35, 0], [0.32, 0.36, 0]], 0.07); break;
    case 'blade': rod(g, M, [0, 0, 0], [0, 0.15, 0], 0.03); blk(g, M, 0, 0.15, 0, 0.2, 0.03, 0.05); { const b = slab(g, M, [[-0.04, 0], [0.04, 0], [0.015, 0.45], [0, 0.55], [-0.015, 0.45]], 0.02, 0.005, 'fin:blade'); b.rotation.x = -PI / 2; b.position.y = 0.16; } break;
    case 'trident': rod(g, M, [0, 0, 0], [0, 0.3, 0], 0.025); blk(g, M, 0, 0.3, 0, 0.3, 0.04, 0.04); for (const dx of [-0.14, 0, 0.14]) spike(g, M, [dx, 0.3, 0], [dx, dx ? 0.5 : 0.6, 0], 0.025, 4); break;
    default: ell(g, M, 0, 0.1, 0, 0.09);
  }
  return g;
}

// ---------- figureheads (airship prows, facing +x) ----------
export function figurehead(P, C, kind, x, y, z, s = 1) {
  if (!kind || kind === 'none') return null;
  const g = group(P, x, y, z); g.scale.setScalar(s);
  const M = C.metal, D = C.metalDark;
  const eyes = (h, ex, ey, ez, r = 0.035) => { for (const sd of [1, -1]) ell(h, C.eye, ex, ey, ez * sd, r); };
  switch (kind) {
    case 'lion': {
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; spike(g, D, [-0.05, Math.sin(a) * 0.12, Math.cos(a) * 0.12], [-0.2, Math.sin(a) * 0.36, Math.cos(a) * 0.36], 0.08, 5); }
      ell(g, M, 0.05, 0, 0, 0.2, 0.2, 0.18); ell(g, M, 0.22, -0.05, 0, 0.13, 0.1, 0.11); ell(g, D, 0.33, -0.03, 0, 0.04);
      ell(g, M, 0.18, -0.15, 0, 0.1, 0.05, 0.08); eyes(g, 0.2, 0.07, 0.09); for (const sd of [1, -1]) ell(g, M, -0.02, 0.17, 0.12 * sd, 0.05, 0.06, 0.03);
      break;
    }
    case 'eagle': {
      ell(g, M, 0, 0, 0, 0.16, 0.18, 0.15); spike(g, D, [0.12, 0.02, 0], [0.38, -0.04, 0], 0.07, 6); spike(g, D, [0.34, 0, 0], [0.4, -0.13, 0], 0.035, 4); eyes(g, 0.1, 0.06, 0.11);
      for (const sd of [1, -1]) { const w = slab(g, M, [[0, 0], [-0.35, 0.05], [-0.7, 0.15], [-0.5, 0.25], [-0.65, 0.35], [-0.35, 0.3], [-0.1, 0.15]], 0.03, 0.01); w.rotation.x = sd * 0.5 - PI / 2 * 0; w.position.set(-0.05, -0.05, 0.1 * sd); w.scale.z = sd; }
      break;
    }
    case 'swan': sweep(g, M, [[-0.3, -0.3, 0], [0.05, -0.1, 0], [0.0, 0.2, 0], [0.12, 0.38, 0]], [0.09, 0.045], { n: 12, m: 8 }); ell(g, M, 0.17, 0.4, 0, 0.09, 0.07, 0.07); spike(g, C.accent, [0.24, 0.39, 0], [0.4, 0.34, 0], 0.035, 5); eyes(g, 0.2, 0.43, 0.05, 0.02); break;
    case 'ram': ell(g, M, 0.05, 0, 0, 0.18, 0.16, 0.14); ell(g, M, 0.22, -0.06, 0, 0.12, 0.09, 0.09); eyes(g, 0.15, 0.04, 0.1);
      for (const sd of [1, -1]) { const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10, a = t * 4.6, r = 0.16 * (1 - t * 0.55); pts.push([-0.02 + Math.cos(a) * r - 0.03, 0.08 + Math.sin(a) * r, sd * (0.14 + t * 0.12)]); } horn(g, D, pts, 0.06, 0.015, { n: 20 }); }
      break;
    case 'horse': sweep(g, M, [[-0.3, -0.3, 0], [-0.05, 0.0, 0], [0.05, 0.25, 0]], [0.12, 0.08], { n: 10 }); ell(g, M, 0.2, 0.25, 0, 0.2, 0.08, 0.08).rotation.z = -0.5; eyes(g, 0.12, 0.33, 0.07, 0.02);
      for (const sd of [1, -1]) spike(g, M, [0.02, 0.33, 0.04 * sd], [0.0, 0.45, 0.05 * sd], 0.025, 4); for (let i = 0; i < 6; i++) spike(g, D, [-0.25 + i * 0.05, -0.2 + i * 0.08, 0], [-0.38 + i * 0.05, -0.1 + i * 0.08, 0], 0.035, 4);
      break;
    case 'dragon': {
      sweep(g, M, [[-0.35, -0.25, 0], [-0.05, -0.05, 0], [0.05, 0.2, 0]], [0.12, 0.08], { n: 10 });
      const h = group(g, 0.08, 0.25, 0); ell(h, M, 0, 0, 0, 0.14, 0.1, 0.11); ell(h, M, 0.18, -0.02, 0, 0.14, 0.06, 0.08); ell(h, D, 0.15, -0.09, 0, 0.13, 0.03, 0.07);
      for (let i = 0; i < 4; i++) for (const sd of [1, -1]) spike(h, C.bone, [0.08 + i * 0.05, -0.06, 0.06 * sd], [0.08 + i * 0.05, -0.11, 0.06 * sd], 0.012, 3);
      eyes(h, 0.08, 0.05, 0.08, 0.022); for (const sd of [1, -1]) horn(h, C.bone, [[-0.04, 0.06, 0.06 * sd], [-0.15, 0.15, 0.1 * sd], [-0.3, 0.17, 0.12 * sd]], 0.03);
      for (let i = 0; i < 5; i++) spike(g, D, [-0.3 + i * 0.08, -0.15 + i * 0.09, 0], [-0.36 + i * 0.08, -0.05 + i * 0.09, 0], 0.03, 4);
      break;
    }
    case 'serpent': sweep(g, M, [[-0.3, -0.25, 0], [0, -0.15, 0.1], [0.05, 0.05, -0.08], [0.15, 0.22, 0]], [0.08, 0.06], { n: 14 }); ell(g, M, 0.22, 0.24, 0, 0.12, 0.07, 0.08); { const hd = slab(g, D, [[0, -0.15], [0.1, -0.12], [0.12, 0], [0.1, 0.12], [0, 0.15], [-0.08, 0]], 0.02); hd.rotation.z = PI / 2 - 0.3; hd.position.set(0.1, 0.24, 0); } eyes(g, 0.28, 0.27, 0.05, 0.018); break;
    case 'skull': ell(g, C.bone, 0, 0.02, 0, 0.2, 0.2, 0.18); ell(g, C.bone, 0.13, -0.12, 0, 0.11, 0.07, 0.12); for (const sd of [1, -1]) ell(g, C.dark, 0.15, 0.03, 0.08 * sd, 0.05, 0.05, 0.04); spike(g, C.dark, [0.19, -0.05, 0], [0.22, 0.0, 0], 0.025, 3);
      for (let i = 0; i < 6; i++) blk(g, C.bone, 0.2, -0.14, (i - 2.5) * 0.03, 0.02, 0.04, 0.02);
      for (const sd of [1, -1]) horn(g, D, [[0, 0.12, 0.13 * sd], [-0.05, 0.3, 0.25 * sd], [0.1, 0.45, 0.3 * sd]], 0.05);
      break;
    case 'bull': ell(g, M, 0.05, 0, 0, 0.18, 0.16, 0.15); ell(g, M, 0.22, -0.06, 0, 0.1, 0.09, 0.1); add(g, mesh(TORUS(0.2, 12), D, 0.3, -0.06, 0, 0.04)).rotation.y = PI / 2; eyes(g, 0.15, 0.05, 0.11);
      for (const sd of [1, -1]) horn(g, C.bone, [[0, 0.1, 0.12 * sd], [0.02, 0.15, 0.3 * sd], [0.15, 0.3, 0.38 * sd]], 0.05);
      // a braided beard, as on a winged bull of the gates
      sweep(g, D, [[0.12, -0.12, 0], [0.08, -0.3, 0], [0.02, -0.42, 0]], [0.08, 0.04], { n: 6 });
      break;
    case 'owl': ell(g, M, 0, 0, 0, 0.18, 0.22, 0.17); for (const sd of [1, -1]) { add(g, mesh(CYL(14), D, 0.14, 0.06, 0.08 * sd, 0.07, 0.03, 0.07)).rotation.z = PI / 2; ell(g, C.gem, 0.165, 0.06, 0.08 * sd, 0.03); spike(g, M, [0, 0.18, 0.1 * sd], [-0.04, 0.32, 0.13 * sd], 0.04, 4); } spike(g, D, [0.15, -0.02, 0], [0.22, -0.08, 0], 0.03, 4); break;
    case 'gargoyle': ell(g, C.bone, 0, 0, 0, 0.18, 0.15, 0.14); ell(g, C.bone, 0.18, 0.05, 0, 0.11, 0.1, 0.1); ell(g, C.dark, 0.27, 0.0, 0, 0.06, 0.03, 0.07); eyes(g, 0.25, 0.09, 0.06, 0.02);
      for (const sd of [1, -1]) { horn(g, C.bone, [[0.15, 0.13, 0.05 * sd], [0.1, 0.25, 0.1 * sd], [0.0, 0.3, 0.1 * sd]], 0.03); const w = slab(g, C.bone, [[0, 0], [-0.3, 0.1], [-0.45, 0.35], [-0.25, 0.25], [-0.15, 0.32]], 0.02); w.rotation.x = -PI / 2 + sd * 0.4; w.position.set(-0.05, 0.08, 0.08 * sd); }
      break;
    case 'rat': ell(g, M, 0, 0, 0, 0.2, 0.13, 0.13); spike(g, M, [0.15, -0.01, 0], [0.42, -0.04, 0], 0.08, 7); ell(g, C.dark, 0.42, -0.04, 0, 0.02); eyes(g, 0.18, 0.06, 0.08, 0.02);
      for (const sd of [1, -1]) { add(g, mesh(CYL(10), M, 0.05, 0.14, 0.1 * sd, 0.07, 0.01, 0.07)).rotation.x = PI / 2; spike(g, C.bone, [0.36, -0.08, 0.02 * sd], [0.4, -0.16, 0.02 * sd], 0.012, 3); }
      break;
    case 'fish': ell(g, M, 0, 0, 0, 0.26, 0.13, 0.1); { const t = slab(g, D, [[0, 0], [-0.2, -0.15], [-0.15, 0], [-0.2, 0.15]], 0.02); t.rotation.x = -PI / 2; t.position.x = -0.22; } eyes(g, 0.16, 0.03, 0.07, 0.02); ell(g, C.gem, 0.27, 0.0, 0, 0.03); break;
    case 'face': ell(g, M, 0, 0.05, 0, 0.16, 0.18, 0.16); ell(g, M, 0.15, 0.03, 0, 0.04, 0.05, 0.04); eyes(g, 0.13, 0.1, 0.06, 0.02); add(g, mesh(HEMI(), C.iron, 0, 0.12, 0, 0.18, 0.14, 0.17));
      sweep(g, D, [[0.1, -0.05, 0], [0.1, -0.25, 0], [0.04, -0.45, 0]], [0.13, 0.03], { n: 6, ry: 1, prof: (t, a) => (Math.cos(a) < 0 ? 0.5 : 1) }); for (const sd of [1, -1]) horn(g, C.iron, [[0, 0.18, 0.15 * sd], [0, 0.3, 0.25 * sd]], 0.04);
      break;
    default: return g;
  }
  return g;
}

// ---------- banners on poles ----------
/** a pole rising from `base`, topped by the realm finial, flying the realm banner with its emblem (cloth flies toward -x) */
export function banner(P, C, S, base, h = 1.4, w = 0.6, o = {}) {
  const [x, y, z] = base, kind = o.kind || S.banner, g = group(P, x, y, z);
  rod(g, o.poleMat || C.wood, [0, 0, 0], [0, h, 0], 0.03, 0.022, 6);
  finial(g, C, o.finial || S.finial, 0, h, 0, o.finS ?? 0.55);
  const top = h - 0.04, seed = hash(x * 3 + z * 7) * 6;
  tier(3, () => {
    if (kind === 'tug') {
      add(g, mesh(TORUS(0.35, 14), C.metal, 0, top - 0.06, 0, 0.09)).rotation.x = PI / 2;
      for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; sweep(g, C.dark, [[Math.cos(a) * 0.08, top - 0.08, Math.sin(a) * 0.08], [Math.cos(a) * 0.12 - 0.04, top - 0.35, Math.sin(a) * 0.12], [Math.cos(a) * 0.1 - 0.12, top - 0.7, Math.sin(a) * 0.1]], [0.035, 0.008], { n: 6, m: 4, round: 0 }); }
      return;
    }
    if (kind === 'bunting') {
      for (let i = 0; i < 4; i++) { const c = cloth(g, i % 2 ? C.accent : C.side, 'triangle', w * 0.32, w * 0.3, seed + i, 0.4); c.position.set(-0.04 - i * w * 0.3, top - 0.05 - i * 0.07, 0); }
      rope(g, C.rope, [0, top - 0.05, 0], [-w * 1.25, top - 0.3, 0], 0.01, 0.02);
      return;
    }
    const vertical = kind === 'gonfalon' || kind === 'nobori' || kind === 'tatter' || kind === 'standard';
    let ch, cw, cx, cy, bu, bv;
    if (vertical) {
      cw = w; ch = h * (kind === 'standard' ? 0.38 : 0.6);
      cy = kind === 'nobori' ? top - 0.08 : top - 0.18; cx = kind === 'nobori' ? 0 : w * 0.5;
      // a crossbar to hang from (the nobori also has its pole down the hoist)
      rod(g, o.poleMat || C.wood, [cx, cy, 0], [cx - w, cy, 0], 0.016, 0.016, 5);
      for (const ex of [cx, cx - w]) ell(g, C.metal, ex, cy, 0, 0.03);
      ch = kind === 'nobori' ? Math.min(ch, h * 0.75) : ch;
      bu = 0.5; bv = 0.42;
    } else { cw = w; ch = w * (kind === 'streamer' ? 0.42 : kind === 'pennon' || kind === 'triangle' ? 0.5 : 0.62); cx = 0; cy = top - 0.05; bu = kind === 'pennon' || kind === 'triangle' || kind === 'streamer' ? 0.28 : 0.42; bv = 0.5; }
    const c = cloth(g, C.side, kind, cw, ch, seed, 1); c.position.set(cx - (vertical ? 0 : 0.02), cy, 0);
    // a hem in the accent along the hoist or top
    if (vertical) blk(g, C.accent, cx - cw / 2, cy - 0.025, 0, cw, 0.05, 0.03); else rod(g, C.accent, [-0.02, cy, 0], [-0.02, cy - ch * (kind === 'pennon' || kind === 'streamer' || kind === 'triangle' ? 1 : 1), 0], 0.018, 0.018, 4);
    // the emblem on both faces
    tier(2, () => {
      const ex = cx - bu * cw * (vertical ? 1 : 1), ey = cy - bv * ch * (vertical ? 1 : (kind === 'pennon' || kind === 'triangle' || kind === 'streamer' ? 0 : 1)) - (vertical ? 0 : (kind === 'pennon' || kind === 'triangle' || kind === 'streamer' ? ch * 0.5 : 0));
      const zz = clothZ(kind, cw, ch, bu, bv, seed, 1), size = Math.min(cw, ch) * (kind === 'pennon' || kind === 'triangle' || kind === 'streamer' ? 0.45 : 0.6);
      for (const sd of [1, -1]) { const e = emblem(g, C.metal, S.emblem, size, 0.02); e.position.set(ex, ey, zz + sd * 0.022); if (sd < 0) e.rotation.y = PI; }
    });
  });
  return g;
}

// ---------- trophies hung below points ----------
export function trophies(P, C, kind, pts, s = 1) {
  pts.forEach((p, i) => {
    const g = group(P, ...p); g.scale.setScalar(s);
    const cord = (len) => rod(g, C.rope, [0, 0, 0], [0, -len, 0], 0.008, 0.008, 3);
    switch (kind) {
      case 'skulls': cord(0.12); ell(g, C.bone, 0, -0.2, 0, 0.08, 0.085, 0.075); ell(g, C.bone, 0.04, -0.26, 0, 0.05, 0.03, 0.05); for (const sd of [1, -1]) ell(g, C.dark, 0.06, -0.19, 0.03 * sd, 0.022); break;
      case 'bells': cord(0.08); lathe(g, C.metal, [[0.004, 0], [0.03, -0.01], [0.045, -0.06], [0.07, -0.14], [0.075, -0.15]], 10, 'tro:bell').position.y = -0.07; ell(g, C.metalDark, 0, -0.21, 0, 0.022); break;
      case 'tassels': cord(0.06); ell(g, C.metal, 0, -0.08, 0, 0.035); lathe(g, i % 2 ? C.accent : C.side, [[0.03, 0], [0.05, -0.05], [0.06, -0.2], [0.001, -0.2]], 8, 'tro:tassel').position.y = -0.1; break;
      case 'feathers': cord(0.05); for (let k = -1; k <= 1; k++) { const f = slab(g, k ? C.accent : C.side, [[0, 0], [0.03, -0.06], [0.035, -0.24], [0, -0.3], [-0.03, -0.22], [-0.025, -0.06]], 0.006, 0, 'tro:feather'); f.rotation.x = -PI / 2; f.rotation.y = k * 0.5; f.rotation.z = k * 0.15; f.position.y = -0.05; } break;
      case 'chains': for (let k = 0; k < 4; k++) { const l = add(g, mesh(TORUS(0.28, 8, 4), C.iron, 0, -0.04 - k * 0.065, 0, 0.045)); l.rotation.y = k % 2 ? PI / 2 : 0; } ell(g, C.iron, 0, -0.32, 0, 0.05); break;
      case 'lanterns': cord(0.06); blk(g, C.dark, 0, -0.07, 0, 0.1, 0.02, 0.1); add(g, mesh(CYL(8), C.lit, 0, -0.15, 0, 0.055, 0.14, 0.055)); for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + PI / 4; rod(g, C.dark, [Math.cos(a) * 0.06, -0.08, Math.sin(a) * 0.06], [Math.cos(a) * 0.06, -0.22, Math.sin(a) * 0.06], 0.007, 0.007, 3); } blk(g, C.dark, 0, -0.23, 0, 0.09, 0.02, 0.09); lathe(g, C.accent, [[0.02, 0], [0.025, -0.08], [0.001, -0.09]], 6, 'tro:tas2').position.y = -0.24; break;
      case 'pennants': { const c = cloth(g, i % 2 ? C.accent : C.side, 'triangle', 0.16, 0.16, i, 0.3); c.rotation.y = PI / 2; c.position.z = 0.08; break; }
      case 'beads': cord(0.04); for (let k = 0; k < 5; k++) ell(g, k % 2 ? C.accent : C.metal, 0, -0.06 - k * 0.045, 0, 0.022, 0.022, 0.022, true); break;
      case 'shells': cord(0.06); { const e = emblem(g, C.bone, 'shell', 0.16, 0.025); e.position.y = -0.14; } break;
      case 'gears': cord(0.05); { const e = emblem(g, C.metal, 'gear', 0.16, 0.03); e.position.y = -0.13; e.rotation.y = i; } break;
      case 'bones': cord(0.06); for (const sd of [1, -1]) { rod(g, C.bone, [-0.08, -0.08, 0], [0.08, -0.22, 0], 0.016).rotation.y += sd * 0.6; } ell(g, C.bone, 0, -0.15, 0, 0.03); break;
      case 'flowers': for (let k = 0; k < 3; k++) { ell(g, [C.accent, C.side, C.metal][k], (k - 1) * 0.05, -0.03 - (k % 2) * 0.03, 0, 0.04, 0.03, 0.04, true); spike(g, C.wood, [(k - 1) * 0.05, -0.05, 0], [(k - 1) * 0.06, -0.15, 0], 0.012, 3); } break;
      case 'charms': cord(0.05); add(g, mesh(CYL(10), C.bone, 0, -0.1, 0, 0.05, 0.015, 0.05)).rotation.x = PI / 2; ell(g, C.accent, 0, -0.1, 0.012, 0.02); spike(g, C.accent, [0, -0.15, 0], [0, -0.28, 0], 0.02, 3); break;
      case 'crystals': cord(0.04); add(g, mesh(OCTA(), C.gem, 0, -0.14, 0, 0.04, 0.1, 0.04)); break;
      case 'furs': ell(g, C.dark, 0, -0.08, 0, 0.06, 0.12, 0.04, true); ell(g, C.cloth, 0, -0.2, 0, 0.03, 0.05, 0.02, true); break;
      default: cord(0.1);
    }
  });
}

// ---------- carved or applied motif at points [x, y, z, nx, ny, nz] (n = outward) ----------
export function motif(P, C, kind, items, s = 1) {
  items.forEach(([x, y, z, nx, ny, nz], i) => {
    const g = at(P, x, y, z, [nx, ny, nz]); g.scale.setScalar(s);
    const M = C.metal;
    switch (kind) {
      case 'filigree': for (const sd of [1, -1]) { const t = add(g, mesh(TORUS(0.18, 10, 4, PI * 1.3), M, sd * 0.06, 0, 0.01, 0.05)); t.rotation.z = sd > 0 ? -0.6 : PI - 0.6 + PI * 0; t.scale.z = 0.5; } ell(g, M, 0, 0, 0.012, 0.025); break;
      case 'spikes': spike(g, C.iron, [0, 0, 0], [0, 0, 0.16], 0.04, 5).rotation.x += 0; break;
      case 'runes': { const e = emblem(g, C.gem, i % 2 ? 'rune' : 'tamga', 0.1, 0.012); e.position.z = 0.006; } break;
      case 'scales': add(g, mesh(HEMI(), M, 0, 0, 0, 0.06, 0.06, 0.02)).rotation.x = PI / 2; break;
      case 'studs': add(g, mesh(HEMI(), M, 0, 0, 0, 0.03, 0.03, 0.022)).rotation.x = PI / 2; break;
      case 'knots': add(g, mesh(TORUS(0.3, 10, 4), M, 0, 0, 0.01, 0.04, 0.04, 0.025)); add(g, mesh(TORUS(0.3, 10, 4), M, 0.04, 0, 0.01, 0.04, 0.04, 0.025)); break;
      case 'waves': { const e = emblem(g, M, 'wave', 0.12, 0.015); e.position.z = 0.008; } break;
      case 'leaves': { const e = emblem(g, C.accent, 'leaf', 0.1, 0.012); e.position.z = 0.006; e.rotation.z = i % 2 ? 0.8 : -0.8; } break;
      case 'gears': { const e = emblem(g, M, 'gear', 0.1, 0.02); e.position.z = 0.01; } break;
      case 'thorns': horn(g, C.dark, [[0, 0, 0], [0, 0.02, 0.07], [0.04, 0.05, 0.11]], 0.025); break;
      case 'stitches': for (const sd of [1, -1]) rod(g, C.rope, [-0.04, -0.04 * sd, 0.008], [0.04, 0.04 * sd, 0.008], 0.007, 0.007, 3); break;
      case 'steps': { const e = emblem(g, M, 'ziggurat', 0.1, 0.02); e.position.z = 0.01; } break;
      case 'stars': { const e = emblem(g, M, 'star8', 0.09, 0.015); e.position.z = 0.008; } break;
      case 'lotus': { const e = emblem(g, M, 'lotus', 0.1, 0.015); e.position.z = 0.008; } break;
      case 'barnacles': for (let k = 0; k < 3; k++) spike(g, C.bone, [(hash(i * 3 + k) - 0.5) * 0.1, (hash(i * 5 + k) - 0.5) * 0.1, 0], [(hash(i * 3 + k) - 0.5) * 0.1, (hash(i * 5 + k) - 0.5) * 0.1, 0.04], 0.025, 5); break;
      case 'boils': ell(g, C.accent, 0, 0, 0, 0.04, 0.04, 0.03, true); break;
      case 'zigzag': { const e = slab(g, C.accent, [[-0.05, 0], [0, 0.07], [0.05, 0]], 0.012, 0, 'mot:tri'); e.rotation.x = -PI / 2; e.rotation.y = i % 2 ? PI : 0; } break;
      default: break;
    }
  });
}
/** points along a polyline (sampled every `step`), all with the same outward normal function */
export function along(pts, step, nfn) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) { const t = k / n, p = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; out.push([...p, ...nfn(p)]); }
  }
  return out;
}

// ---------- the pilot's helm (head at the origin, radius about 0.09) ----------
export function helm(P, C, kind, S) {
  const M = C.metal;
  switch (kind) {
    case 'great': add(P, mesh(CYL(12), C.iron, 0, 0.01, 0, 0.1, 0.2, 0.1)); add(P, mesh(HEMI(), C.iron, 0, 0.11, 0, 0.1, 0.05, 0.1)); blk(P, C.dark, 0.09, 0.03, 0, 0.03, 0.015, 0.12); blk(P, M, 0.098, 0.0, 0, 0.012, 0.12, 0.02); break;
    case 'kabuto': add(P, mesh(HEMI(), C.dark, 0, 0.02, 0, 0.1, 0.09, 0.1)); lathe(P, C.dark, [[0.1, 0.02], [0.15, -0.04], [0.16, -0.05]], 12, 'helm:shikoro'); for (const sd of [1, -1]) horn(P, M, [[0.07, 0.07, 0.02 * sd], [0.1, 0.16, 0.08 * sd], [0.08, 0.24, 0.12 * sd]], 0.015); break;
    case 'turban': add(P, mesh(TORUS(0.45, 14, 6), C.cloth, 0, 0.06, 0, 0.09, 0.09, 0.07)).rotation.x = PI / 2; ell(P, C.cloth, 0, 0.09, 0, 0.08, 0.06, 0.08); ell(P, C.gem, 0.09, 0.07, 0, 0.018); spike(P, C.accent, [0.08, 0.09, 0], [0.04, 0.22, 0], 0.012, 3); break;
    case 'horned': add(P, mesh(HEMI(), C.iron, 0, 0.02, 0, 0.1, 0.09, 0.1)); for (const sd of [1, -1]) horn(P, C.bone, [[0, 0.06, 0.08 * sd], [0.02, 0.12, 0.17 * sd], [0.08, 0.2, 0.2 * sd]], 0.03); break;
    case 'crown': add(P, mesh(HEMI(), C.side, 0, 0.03, 0, 0.09, 0.06, 0.09)); add(P, mesh(CYL(12, true), M, 0, 0.07, 0, 0.1, 0.05, 0.1)); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; spike(P, M, [Math.cos(a) * 0.1, 0.09, Math.sin(a) * 0.1], [Math.cos(a) * 0.1, 0.15, Math.sin(a) * 0.1], 0.02, 4); } break;
    case 'hood': ell(P, C.sideDark || C.side, -0.01, 0.02, 0, 0.11, 0.12, 0.11); spike(P, C.sideDark || C.side, [-0.03, 0.08, 0], [-0.12, 0.16, 0], 0.06, 6); break;
    case 'feather': add(P, mesh(CYL(10, true), M, 0, 0.05, 0, 0.095, 0.04, 0.095)); for (let i = 0; i < 7; i++) { const a = -0.9 + (i / 6) * 1.8; const f = slab(P, i % 2 ? C.accent : C.side, [[0, 0], [0.02, 0.08], [0.015, 0.26], [0, 0.3], [-0.015, 0.26], [-0.02, 0.08]], 0.006, 0, 'helm:feather'); f.rotation.set(-PI / 2, 0, 0); const q = group(P, -0.04, 0.07, 0); q.rotation.x = a; q.rotation.z = 0.4; q.add(f); } break;
    case 'nemes': ell(P, C.metal, 0, 0.02, 0, 0.1, 0.1, 0.1); for (const sd of [1, -1]) slab(P, C.accent, [[0.02, 0], [-0.05, 0], [-0.04, -0.2], [0.03, -0.2]], 0.015).position.set(0, 0.02, 0.1 * sd); spike(P, M, [0.09, 0.08, 0], [0.12, 0.14, 0], 0.015, 4); break;
    case 'pointed': lathe(P, C.iron, [[0.1, 0], [0.1, 0.04], [0.07, 0.12], [0.02, 0.2], [0.004, 0.25]], 10, 'helm:point'); add(P, mesh(TORUS(0.3, 12, 5), C.dark, 0, 0.0, 0, 0.105)).rotation.x = PI / 2; break;
    case 'plume': add(P, mesh(HEMI(), M, 0, 0.02, 0, 0.1, 0.09, 0.1)); sweep(P, C.side, [[0, 0.1, 0], [-0.05, 0.2, 0], [-0.18, 0.22, 0], [-0.3, 0.12, 0]], [0.035, 0.012], { n: 8, m: 5 }); break;
    case 'nasal': add(P, mesh(HEMI(), C.iron, 0, 0.02, 0, 0.1, 0.1, 0.1)); blk(P, C.iron, 0.095, -0.02, 0, 0.012, 0.08, 0.02); add(P, mesh(TORUS(0.25, 12, 4), M, 0, 0.02, 0, 0.1)).rotation.x = PI / 2; break;
    case 'skull': ell(P, C.bone, 0.01, 0.02, 0, 0.1); for (const sd of [1, -1]) ell(P, C.dark, 0.08, 0.03, 0.04 * sd, 0.022); horn(P, C.bone, [[0, 0.08, 0], [-0.05, 0.18, 0], [-0.15, 0.2, 0]], 0.025); break;
    default: break;
  }
  void S;
}

// ---------- roofs (on a cabin w along x, d along z, eaves at y) ----------
export function roof(P, C, kind, x, y, z, w, d, o = {}) {
  const g = group(P, x, y, z), R = o.mat || C.side, M = C.metal, T = o.trim || C.metal;
  switch (kind) {
    case 'pagoda': {
      for (let i = 0; i < (o.tiers || 2); i++) {
        const k = 1 - i * 0.3, yy = i * 0.32 * Math.min(w, d), ww = w * k * 1.15, dd = d * k * 1.15;
        const r = add(g, mesh(CONE(4), R, 0, yy + 0.12, 0, ww * 0.74, 0.28, dd * 0.74)); r.rotation.y = PI / 4;
        blk(g, T, 0, yy + 0.0, 0, ww * 1.02, 0.035, dd * 1.02);
        for (const sx of [1, -1]) for (const sz of [1, -1]) horn(g, T, [[sx * ww * 0.45, yy, sz * dd * 0.45], [sx * ww * 0.58, yy + 0.04, sz * dd * 0.58], [sx * ww * 0.62, yy + 0.16, sz * dd * 0.62]], 0.03);
        if (i < (o.tiers || 2) - 1) blk(g, C.woodDark, 0, yy + 0.25, 0, ww * 0.55, 0.22, dd * 0.55);
      }
      finial(g, C, o.finial || 'pearl', 0, (o.tiers || 2) * 0.32 * Math.min(w, d) + 0.05, 0, 0.6);
      break;
    }
    case 'dome': add(g, mesh(HEMI(), R, 0, 0, 0, w * 0.5, Math.min(w, d) * 0.45, d * 0.5)); { const t = add(g, mesh(TORUS(0.08, 24), T, 0, 0.01, 0, w * 0.5, w * 0.5, w * 0.5)); t.rotation.x = PI / 2; t.scale.y = d * 0.5; } finial(g, C, o.finial || 'orb', 0, Math.min(w, d) * 0.44, 0, 0.6); break;
    case 'onion': { const s = Math.min(w, d); lathe(g, R, [[s * 0.35, 0], [s * 0.52, s * 0.25], [s * 0.45, s * 0.5], [s * 0.18, s * 0.75], [s * 0.04, s * 0.9]], 16).position.y = 0.02; blk(g, T, 0, 0, 0, w, 0.05, d); finial(g, C, 'cross', 0, s * 0.88, 0, 0.5); break; }
    case 'tent': {
      const s = Math.max(w, d), hh = s * 0.55;
      for (let i = 0; i < 8; i++) lathe(g, i % 2 ? C.accent : R, [[s * 0.6, 0], [s * 0.3, hh * 0.6], [0.01, hh]], 8, null, (i / 8) * TAU, TAU / 8);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; ell(g, T, Math.cos(a) * s * 0.6, -0.03, Math.sin(a) * s * 0.6, 0.06, 0.05, 0.04, true); }
      finial(g, C, o.finial || 'orb', 0, hh, 0, 0.5);
      break;
    }
    case 'gable': { const hh = Math.min(w, d) * 0.45; 
      for (const sd of [1, -1]) { const p = group(g, 0, 0, sd * d * 0.55); p.rotation.x = sd * Math.atan2(hh, d * 0.55); slab(p, R, [[-w * 0.56, 0], [w * 0.56, 0], [w * 0.56, -sd * d * 0.62], [-w * 0.56, -sd * d * 0.62]], 0.04, 0.01); }
      rod(g, T, [-w * 0.58, hh, 0], [w * 0.58, hh, 0], 0.03, 0.03, 6); finial(g, C, o.finial || 'orb', w * 0.58, hh, 0, 0.35); break; }
    case 'flat': blk(g, C.iron, 0, 0.03, 0, w * 1.05, 0.06, d * 1.05); for (let i = 0; i < 4; i++) for (const sd of [1, -1]) { blk(g, C.iron, (i / 3 - 0.5) * w, 0.12, sd * d * 0.5, 0.1, 0.14, 0.06); blk(g, C.iron, sd * w * 0.5, 0.12, (i / 3 - 0.5) * d, 0.06, 0.14, 0.1); } break;
    case 'spire': { const s = Math.min(w, d); add(g, mesh(CONE(8), R, 0, s * 0.6, 0, s * 0.55, s * 1.2, s * 0.55)); for (const sx of [1, -1]) for (const sz of [1, -1]) add(g, mesh(CONE(6), R, sx * w * 0.42, s * 0.25, sz * d * 0.42, s * 0.14, s * 0.5, s * 0.14)); finial(g, C, o.finial || 'spike', 0, s * 1.2, 0, 0.45); break; }
    case 'ziggurat': for (let i = 0; i < 3; i++) blk(g, i % 2 ? C.woodDark : R, 0, 0.06 + i * 0.12, 0, w * (1 - i * 0.25), 0.12, d * (1 - i * 0.25)); finial(g, C, 'flame', 0, 0.36, 0, 0.5); break;
    case 'stepped': for (let i = 0; i < 3; i++) blk(g, i % 2 ? T : R, 0, 0.05 + i * 0.1, 0, w * (1 - i * 0.22), 0.1, d * (1 - i * 0.22)); blk(g, R, 0, 0.42, 0, w * 0.3, 0.18, d * 0.3); finial(g, C, o.finial || 'flame', 0, 0.5, 0, 0.45); break;
    case 'canopy': {
      for (const sx of [1, -1]) for (const sz of [1, -1]) rod(g, C.wood, [sx * w * 0.45, -0.4, sz * d * 0.45], [sx * w * 0.45, 0.05, sz * d * 0.45], 0.02, 0.02, 4);
      add(g, mesh(SPH(), R, 0, 0.05, 0, w * 0.56, 0.12, d * 0.56)).scale.y = 0.14;
      break;
    }
    default: break;
  }
  void M;
  return g;
}
