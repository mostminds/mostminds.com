// Beasts that tow a designed ship: swimming ahead of her bow, harnessed to it by chains.
//   tow:mosasaur  tow:serpent  tow:gator  tow:orca  tow:whale  (long swimmers: the body undulates)
//   tow:turtle    tow:boar     tow:mammoth tow:hippo tow:rhino   (paddlers: head up, legs or flippers stroking)
// Every beast is SCULPTED like the game's sea monsters (sculpt.js prims blended like clay, with scale, fur, hide and
// shell relief, painted bellies and patterns, hard pieces for teeth, eyes, horns, fins and claws), authored in units
// of its own width and scaled to the ship, so each kind and proportion is meshed once and shared. Swimmers are one
// skinned body on a chain of spine bones; heads carry a lower jaw of their own that gapes on the ram and grapple
// actions. The harness is a collar strap, a yoke and two chains of links back to her bow, with a saddle-cloth in the
// realm's colours where there is a back. Damage (c.damageFns): wounds at 2, the beast spent and rolling at 3.
import * as THREE from 'three';
import { Kit, G, C, shade, blend, clamp, lerp, hash, clothPanel, sculptL, lazyMap, lazyMesh, SB, SKH, S, H, noise3 } from './kit.js';
import { emblemOn } from './realmStyle.js';
import { sculptMaterial } from '../sculpt.js';

const PI = Math.PI;
const q4 = (v) => (Math.round(v * 4) / 4).toFixed(2);
const bump = (k) => Math.sin(PI * clamp(k, 0, 1));
const rgbOf = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const SPEC = {
  mosasaur: { len: 0.72, col: 0x3a5a5a, belly: 0xc8c0a0, segs: 6, lat: 0.35, vert: 0.05, speed: 2.2, r: [0.42, 0.5, 0.48, 0.4, 0.3, 0.2, 0.1], flat: 0.85, skin: [0.006, 26, 'scales'] },
  serpent: { len: 0.95, col: 0x2a6a5a, belly: 0xd8c88a, segs: 10, lat: 0.45, vert: 0.35, speed: 2.6, r: [0.34, 0.36, 0.35, 0.33, 0.3, 0.26, 0.22, 0.17, 0.12, 0.07], flat: 0.95, skin: [0.006, 30, 'scales'] },
  gator: { len: 0.6, col: 0x4a5a2a, belly: 0xb8b080, segs: 6, lat: 0.3, vert: 0.02, speed: 2, r: [0.36, 0.46, 0.44, 0.34, 0.22, 0.12, 0.06], flat: 0.6, skin: [0.01, 16, 'scales'] },
  orca: { len: 0.55, col: 0x121418, belly: 0xf0f0f0, segs: 4, lat: 0.04, vert: 0.22, speed: 2, r: [0.5, 0.52, 0.42, 0.24, 0.1], flat: 0.95, skin: [0.002, 8, 'noise'] },
  whale: { len: 0.85, col: 0x3a4a5a, belly: 0xb8c0c0, segs: 5, lat: 0.03, vert: 0.25, speed: 1.2, r: [0.55, 0.56, 0.48, 0.34, 0.2, 0.08], flat: 0.9, skin: [0.008, 7, 'noise'] },
  turtle: { len: 0.42, col: 0x4a6a3a, belly: 0xc8b87a, quad: true, speed: 1.6 },
  boar: { len: 0.4, col: 0x4a3426, belly: 0x6a4a36, quad: true, speed: 2.6 },
  mammoth: { len: 0.48, col: 0x5a3a22, belly: 0x4a3020, quad: true, speed: 1.8 },
  hippo: { len: 0.42, col: 0x7a6a72, belly: 0xc89a9a, quad: true, speed: 2 },
  rhino: { len: 0.42, col: 0x6a6a66, belly: 0x8a8a84, quad: true, speed: 2.2 },
};
// sculpt resolution, cells per unit of the beast's width at the closest level
const RES = { body: 40, head: 60, leg: 44 };

/** belly and back shading for a sculpted body: pale where the surface faces down, darker along the spine */
function bellyPaint(col, belly, o = {}) {
  const c0 = rgbOf(col), b0 = rgbOf(belly), back = rgbOf(shade(col, o.back ?? 0.8));
  return (x, y, z, nx, ny, nz, c) => {
    if (Math.abs(c[0] - c0[0]) + Math.abs(c[1] - c0[1]) + Math.abs(c[2] - c0[2]) > 0.25) return null; // not hide (teeth, eyes, horn)
    const k = clamp((-ny - (o.at ?? 0.15)) * 2.2, 0, 1);
    let r = mixRgb(c, b0, k);
    if (ny > 0.75) r = mixRgb(r, back, (ny - 0.75) * 3);
    if (o.pat) { const p = o.pat(x, y, z, nx, ny, nz); if (p) r = p; }
    return r;
  };
}

// =====================================================================================
//  long swimmers
// =====================================================================================
/** the head of a long swimmer, neck at x = 0, snout toward +x (width units); { head, jaw, jawAt, mouth } parts */
function swimHeadParts(kind, Sp) {
  const H_ = new SB(), J = new SB(), col = Sp.col, belly = Sp.belly, skin = Sp.skin;
  let mouth = [1, 0], jawAt = [0, 0];
  const hide = (p, k = 0.05) => p.color(col).pbr(0.5, kind === 'orca' ? 0.15 : 0).blend(k).bump(...skin);
  if (kind === 'mosasaur' || kind === 'gator') {
    const gl = kind === 'gator', hl = gl ? 1.5 : 1.35, hw = gl ? 0.42 : 0.4, hh = gl ? 0.18 : 0.24;
    H_.p(hide(S.ellipsoid(0.42, hh * 1.25, hw * 0.95).at(0.12, hh * 0.35, 0), 0.08));
    H_.p(hide(S.capsule([0.25, hh * 0.3, 0], [hl * 0.95, hh * 0.12, 0], hh * 1.0, hh * 0.45), 0.12));
    H_.p(hide(S.ellipsoid(hl * 0.38, hh * 0.7, hw * (gl ? 0.6 : 0.5)).at(hl * 0.6, hh * 0.2, 0), 0.1));
    for (const s of [-1, 1]) {
      H_.p(hide(S.ellipsoid(0.12, 0.08, 0.1).at(hl * 0.2, hh * 1.25, s * hw * 0.6), 0.04)); // eye turrets
      H_.p(S.sphere(0.035).at(hl * 0.96, hh * 0.4, s * hw * 0.12).cut(0.01).color(0x1a1410));
      H_.p(S.ellipsoid(0.05, 0.04, 0.06).at(hl * 0.94, hh * 0.38, s * hw * 0.12).color(shade(col, 0.85)).blend(0.03));
    }
    for (let i = 0; i < (gl ? 9 : 5); i++) for (const s of [-1, 0, 1]) H_.p(S.ellipsoid(0.05, 0.03, 0.04).at(hl * (0.05 + i * (gl ? 0.08 : 0.12)), hh * 1.15 - i * 0.008, s * hw * 0.28).color(shade(col, 0.78)).blend(0.015));
    SKH.teeth(H_, hl * 0.2, hl * 0.93, hh * 0.02, hw * 0.72, 0.13, gl ? 9 : 7, false, 0xeee6cc, hw * 0.3);
    SKH.eyes(H_, [hl * 0.2, hh * 1.3, hw * 0.64], 0.05, 0xffd23a, shade(col, 0.8), { glow: 1.4 });
    J.p(S.capsule([0, 0, 0], [hl * 0.9, 0.02, 0], hh * 0.55, hh * 0.25).color(belly).pbr(0.55).blend(0.06).bump(skin[0] * 0.7, skin[1], skin[2]));
    J.p(S.ellipsoid(hl * 0.38, 0.05, hw * 0.55).at(hl * 0.42, hh * 0.38, 0).cut(0.02).color(0x8a2a2a));
    J.p(S.ellipsoid(hl * 0.3, 0.035, hw * 0.35).at(hl * 0.4, hh * 0.2, 0).color(0xb84a4a).pbr(0.3).blend(0.01));
    SKH.teeth(J, hl * 0.2, hl * 0.86, hh * 0.32, hw * 0.62, 0.11, gl ? 8 : 6, true, 0xeee6cc, hw * 0.25);
    jawAt = [0.02, hh * 0.0]; mouth = [hl * 0.8, hh * 0.1];
  } else if (kind === 'serpent') {
    const hl = 1.1, hw = 0.38, hh = 0.28, fr = blend(col, 0xd84a2a, 0.5);
    H_.p(hide(S.ellipsoid(0.36, hh, hw).at(0.15, 0.12, 0), 0.08));
    H_.p(hide(S.capsule([0.25, 0.1, 0], [hl * 0.95, 0.04, 0], hh * 0.85, hh * 0.35), 0.12));
    for (const s of [-1, 1]) {
      H_.p(S.capsule([0.05, hh * 1.0, s * hw * 0.45], [0.55, hh * 0.75, s * hw * 0.35], 0.07, 0.04).color(shade(col, 0.85)).blend(0.04));
      SKH.horn(H_, [[hl * 0.15, hh * 1.2, s * hw * 0.5], [-hl * 0.12, hh * 1.9, s * hw * 0.9], [-hl * 0.4, hh * 2.3, s * hw * 0.95], [-hl * 0.6, hh * 2.25, s * hw * 0.75]], 0.06, C.bone, { rings: 8 });
      SKH.fin(H_, [[0, 0], [-0.25, 0.35], [-0.5, 0.42], [-0.42, 0.18], [-0.62, 0.1], [-0.3, -0.05]], 0.02, fr, [0.0, hh * 0.5, s * hw * 0.95], [0, s * 35, 10], { ribs: 6, edge: shade(fr, 1.2), edgeAt: 0.5 });
      H_.p(S.sphere(0.03).at(hl * 0.96, 0.07, s * 0.06).cut(0.008));
    }
    SKH.teeth(H_, hl * 0.3, hl * 0.92, -0.04, hw * 0.55, 0.2, 5, false, 0xf0ead0, hw * 0.2);
    SKH.eyes(H_, [hl * 0.35, hh * 1.05, hw * 0.62], 0.055, 0xffd23a, shade(col, 0.8), { glow: 2 });
    J.p(S.capsule([0, 0, 0], [hl * 0.88, 0.0, 0], hh * 0.45, hh * 0.18).color(belly).pbr(0.5).blend(0.06));
    J.p(S.ellipsoid(hl * 0.35, 0.04, hw * 0.4).at(hl * 0.45, hh * 0.3, 0).cut(0.02).color(0x7a1a2a));
    SKH.teeth(J, hl * 0.3, hl * 0.82, hh * 0.25, hw * 0.45, 0.16, 4, true, 0xf0ead0, hw * 0.18);
    J.h(H.tube([[hl * 0.3, 0.06, 0], [hl * 1.05, 0.08, 0], [hl * 1.25, 0.12, 0.06], [hl * 1.32, 0.12, 0.1]], [0.03, 0.022, 0.01, 0.003], 16, 8).color(0xc82a2a).pbr(0.3));
    jawAt = [0, 0.02]; mouth = [hl * 0.9, 0.05];
  } else if (kind === 'orca') {
    const hl = 0.9;
    H_.p(hide(S.ellipsoid(0.55, 0.46, 0.48).at(0.15, 0.02, 0), 0.1));
    H_.p(hide(S.ellipsoid(0.42, 0.24, 0.3).at(hl * 0.65, -0.02, 0), 0.15));
    SKH.eyes(H_, [hl * 0.55, 0.06, 0.32], 0.035, 0x0a0a0a, null, { glow: 0, round: true });
    SKH.teeth(H_, hl * 0.4, hl * 0.95, -0.12, 0.22, 0.07, 7, false, 0xf4f0e4, 0.1);
    J.p(S.capsule([0, 0, 0], [hl * 0.82, -0.02, 0], 0.16, 0.06).color(belly).pbr(0.3, 0.1).blend(0.06));
    SKH.teeth(J, hl * 0.3, hl * 0.82, 0.1, 0.18, 0.06, 6, true, 0xf4f0e4, 0.08);
    jawAt = [hl * 0.1, -0.1]; mouth = [hl * 0.9, -0.08];
  } else {
    // whale: a great blunt head, grooved throat, barnacles, a blowhole
    const hl = 1.35;
    H_.p(hide(S.ellipsoid(0.8, 0.5, 0.55).at(0.45, 0.02, 0), 0.12));
    H_.p(hide(S.ellipsoid(0.6, 0.42, 0.48).at(hl * 0.68, 0.08, 0), 0.25));
    H_.p(S.ellipsoid(0.06, 0.03, 0.1).at(0.2, 0.5, 0).cut(0.02).color(0x101418));
    SKH.eyes(H_, [hl * 0.25, -0.08, 0.52], 0.04, 0x0a0a0a, null, { glow: 0, round: true });
    for (let i = 0; i < 16; i++) H_.p(S.sphere(0.03 + hash(i) * 0.035).at(hl * (0.4 + hash(i + 3) * 0.55), 0.3 + hash(i + 7) * 0.2, (hash(i + 11) - 0.5) * 0.6).color(0xd8d8c8).pbr(0.9).blend(0.02).bump(0.01, 30, 'rock'));
    J.p(S.capsule([0, 0, 0], [hl * 0.92, 0.02, 0], 0.22, 0.12).color(belly).pbr(0.6).blend(0.08));
    jawAt = [hl * 0.05, -0.22]; mouth = [hl * 0.95, -0.1];
  }
  const throat = kind === 'whale' ? (() => { const gr = rgbOf(shade(belly, 0.7)); return (x, y, z, nx, ny, nz) => (ny < -0.2 && Math.abs(Math.sin(z * 34)) < 0.2 ? gr : null); })() : null;
  const orcaPatch = kind === 'orca' ? (() => { const wh = rgbOf(0xf0f0f0); return (x, y, z) => (x > 0.35 && x < 0.62 && y > 0.12 && y < 0.3 && Math.abs(z) > 0.25 ? wh : null); })() : null;
  return { head: H_.part(), jaw: J.part(), jawAt, mouth, headPaint: bellyPaint(col, belly, { pat: orcaPatch }), jawPaint: throat };
}

/** a long swimmer (width units): head at +x, one skinned body trailing toward -x on a chain of spine bones */
function swimmer(kind, Sp, len, st) {
  const g = new THREE.Group(), n = Sp.segs, sl = len / (n + 1.2), key = `${kind}|${q4(len)}`;
  const hp = swimHeadParts(kind, Sp);
  const headGeo = sculptL(`towhead|${kind}`, () => hp.head, { res: RES.head, min: 10, paint: hp.headPaint });
  const jawGeo = sculptL(`towjaw|${kind}`, () => hp.jaw, { res: RES.head, min: 10, paint: hp.jawPaint });
  const head = lazyMesh(new THREE.Mesh(undefined, sculptMaterial()), new Kit().add(headGeo, 0xffffff).levels(`towheadK|${kind}`));
  const jaw = lazyMesh(new THREE.Mesh(undefined, sculptMaterial()), new Kit().add(jawGeo, 0xffffff).levels(`towjawK|${kind}`));
  jaw.position.set(hp.jawAt[0], hp.jawAt[1], 0); head.add(jaw);
  const hx = len / 2 - sl * 0.6;
  // spine: bone 0 carries the head, the rest run down to the tail
  const bx = [hx, ...Array.from({ length: n }, (_, i) => len / 2 - sl * (i + 1.4))];
  const R = (t) => { const f = t * (Sp.r.length - 1), i = Math.min(Sp.r.length - 2, Math.floor(f)); return lerp(Sp.r[i], Sp.r[i + 1], f - i); };
  const tailX = bx[n] - sl * 0.7;
  const tOf = (x) => clamp((hx - x) / (hx - tailX), 0, 1);
  const body = () => {
    const B = new SB(), col = Sp.col;
    const N = n * 2 + 4, step = (hx + sl * 0.1 - tailX) / N;
    for (let k = 0; k <= N; k++) {
      const x = hx + sl * 0.1 - step * k, r = Math.max(R(tOf(x)), 0.03);
      B.p(S.ellipsoid(step * 1.7 + r * 0.3, r * Sp.flat, r).at(x, 0, 0).color(col).pbr(kind === 'orca' ? 0.3 : 0.55, kind === 'orca' ? 0.15 : 0).blend(r * 0.5).bump(...Sp.skin));
    }
    // a ridge of scutes (gator, mosasaur), a frill (serpent), and fins, flippers and flukes
    for (let i = 0; i < n; i++) {
      const x = bx[i + 1], r = R(tOf(x));
      if (kind === 'gator' || kind === 'mosasaur') for (const zz of [-0.42, 0, 0.42]) for (const dx of [-0.25, 0.25]) B.h(H.cone(r * 0.11, r * (zz ? 0.26 : 0.36), 7).color(shade(col, 0.7)).pbr(0.6).at(x + dx * sl, r * Sp.flat * (zz ? 0.86 : 0.98), zz * r).lod(2));
      if (kind === 'serpent' && i < n - 1) SKH.fin(B, [[0.12, 0], [0.04, 0.08], [-0.02, 0.24], [-0.06, 0.1], [-0.14, 0.16], [-0.16, 0]].map(([a, h]) => [a * r * 3, h * r * 3]), 0.02, blend(col, 0xd84a2a, 0.5), [x + sl * 0.2, r * 0.88, 0], [0, 0, 0], { ribs: 4 });
      if (kind === 'orca' && i === 0) SKH.fin(B, [[-0.45, 0], [0.2, 0], [0.04, 0.3], [-0.22, 0.72]], 0.07, col, [x, r * 0.82, 0], [0, 0, 0], { ribs: 0, r: 0.3 });
      if (kind === 'whale' && i === 2) B.p(S.ellipsoid(0.3, 0.12, 0.08).at(x, r * 0.85, 0).color(col).blend(0.08));
      const fin = (kind === 'mosasaur' && (i === 0 || i === 2)) || ((kind === 'whale' || kind === 'orca') && i === 0);
      if (fin) for (const s of [-1, 1]) B.p(S.ellipsoid(r * 0.55, r * 0.07, r * 0.9).rot(s * 25, s * 30, 0).at(x - r * 0.25, -r * 0.45, s * r * 1.2).color(shade(col, 0.85)).blend(0.05));
      if (kind === 'gator' && (i === 0 || i === 2)) for (const s of [-1, 1]) {
        SKH.limb(B, [[x, -r * 0.1, s * r * 0.75], [x + r * 0.1, -r * 0.45, s * r * 1.25], [x + r * 0.35, -r * 0.65, s * r * 1.4]], [r * 0.22, r * 0.14, r * 0.11], col, { k: 0.04, bump: Sp.skin });
        for (let k = 0; k < 4; k++) B.h(H.cone(r * 0.03, r * 0.14, 6).color(0x2a2418).rot(0, 0, -80).at(x + r * 0.45, -r * 0.68, s * r * (1.32 + k * 0.06)).lod(1));
      }
    }
    const tr = R(1);
    if (kind === 'mosasaur' || kind === 'gator') SKH.fin(B, [[0, 0], [-1, 0.55], [-0.75, 0], [-1, -0.35]].map(([a, b]) => [a * (kind === 'gator' ? 0.5 : 0.9), b * (kind === 'gator' ? 0.5 : 0.9)]), 0.05, col, [tailX + sl * 0.15, 0, 0], [0, 0, 0], { ribs: 6 });
    if (kind === 'whale' || kind === 'orca') { const s = kind === 'whale' ? 0.9 : 0.7; SKH.fin(B, [[0, 0.1], [-0.35, 0.55], [-0.7, 1.05], [-0.45, 0.2], [-0.45, -0.2], [-0.7, -1.05], [-0.35, -0.55], [0, -0.1]].map(([a, b]) => [a * s, b * s]), 0.06, col, [tailX + sl * 0.1, 0, 0], [90, 0, 0], { ribs: 0, r: 0.4 }); }
    if (kind === 'serpent') SKH.limb(B, [[tailX + sl * 0.2, 0, 0], [tailX - sl * 0.4, 0.05, 0], [tailX - sl * 0.9, 0.2, 0]], [Math.max(tr, 0.05), 0.03, 0.008], col, { k: 0.03 });
    return B.part();
  };
  const pat = kind === 'serpent' ? ((dk) => (x, y, z, nx, ny) => (ny > -0.1 && Math.sin(x * 7 + Math.atan2(z, y) * 3) > 0.62 ? dk : null))(rgbOf(shade(Sp.col, 0.6)))
    : kind === 'gator' || kind === 'mosasaur' ? ((dk) => (x, y, z, nx, ny) => (ny > 0.25 && Math.sin(x * 9) > 0.7 ? dk : null))(rgbOf(shade(Sp.col, 0.72)))
      : kind === 'orca' ? ((wh) => (x, y, z, nx, ny) => (ny < -0.1 && x > bx[2] ? wh : x < bx[1] && x > bx[2] && ny > 0.4 && Math.abs(z) < 0.12 ? rgbOf(0x8a8a90) : null))(rgbOf(0xf0f0f0)) : null;
  const bodyGeo = sculptL(`towbody|${key}`, body, { res: RES.body, min: 8, paint: bellyPaint(Sp.col, Sp.belly, { pat, at: kind === 'orca' ? 0.0 : 0.15 }) });
  const plain = new Kit().add(bodyGeo, 0xffffff).levels(`towbodyK|${key}`);
  const bxAll = bx.concat([tailX - sl * 2]);
  const mesh = lazyMesh(new THREE.SkinnedMesh(undefined, sculptMaterial()), lazyMap(plain, (gg) => skinGeo(gg, bxAll)));
  mesh.frustumCulled = false;
  const bones = bxAll.map((x) => { const b = new THREE.Bone(); b.position.x = x; return b; });
  for (const b of bones) mesh.add(b);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  g.add(mesh);
  bones[0].add(head);
  return { group: g, segs: bones, jaw, head, meshes: [mesh, head, jaw], collar: [len / 2 - sl * 1.4, R(0.1) * Sp.flat * 0.9], collarR: R(0.1), mouth: [hx + hp.mouth[0], hp.mouth[1]], woundAt: [bx[1], bx[2]], r: R(0.2) };
}

/** skin weights by length: each vertex follows the two spine bones either side of it (bones sorted head to tail) */
const skinned = new WeakMap();
function skinGeo(geo, bx) {
  if (skinned.has(geo)) return skinned.get(geo);
  const P = geo.attributes.position, n = P.count, I = new Uint16Array(n * 4), W = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const x = P.getX(v);
    let i = 0;
    while (i < bx.length - 1 && x < bx[i + 1]) i++;
    if (i >= bx.length - 1) { I[v * 4] = bx.length - 1; W[v * 4] = 1; continue; }
    const t = clamp((bx[i] - x) / (bx[i] - bx[i + 1]), 0, 1);
    I[v * 4] = i; I[v * 4 + 1] = i + 1; W[v * 4] = 1 - t; W[v * 4 + 1] = t;
  }
  const g = geo.clone();
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(I, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(W, 4));
  skinned.set(geo, g);
  return g;
}

// =====================================================================================
//  paddlers
// =====================================================================================
function paddlerParts(kind, Sp, bl) {
  const col = Sp.col, belly = Sp.belly;
  const B = new SB();
  let back = 0.5;
  if (kind === 'turtle') {
    // a domed carapace of raised scutes over a rim of marginal plates, the plastron underneath
    B.p(S.ellipsoid(bl * 0.6, 0.36, 0.66).at(0, 0.04, 0).color(col).pbr(0.45).bump(0.008, 10, 'rock'));
    B.p(S.ellipsoid(bl * 0.56, 0.12, 0.6).at(0, -0.1, 0).color(belly).pbr(0.6).blend(0.04));
    for (let i = 0; i < 5; i++) B.p(S.ellipsoid(0.17, 0.06, 0.17).at((i - 2) * bl * 0.22, 0.36 - Math.abs(i - 2) * 0.05, 0).color(shade(col, 0.85)).blend(0.03).bump(0.006, 14, 'rock'));
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) B.p(S.ellipsoid(0.15, 0.06, 0.13).rot(s * 25, 0, 0).at((i - 1.5) * bl * 0.27, 0.28, s * 0.34).color(shade(col, 0.88)).blend(0.03).bump(0.006, 14, 'rock'));
    for (let i = 0; i < 20; i++) { const a = (i / 20) * PI * 2; B.p(S.ellipsoid(0.09, 0.035, 0.07).rot(0, (-a * 180) / PI, 0).at(Math.cos(a) * bl * 0.58, 0.02, Math.sin(a) * 0.64).color(shade(col, 0.75)).blend(0.02)); }
    back = 0.42;
  } else {
    const hump = kind === 'mammoth' ? 1.15 : kind === 'hippo' ? 0.82 : 0.9;
    const skinB = kind === 'mammoth' || kind === 'boar' ? [0.016, 9, 'fur'] : kind === 'rhino' ? [0.01, 12, 'rock'] : [0.005, 10, 'noise'];
    const hide = (p, k = 0.18) => p.color(col).pbr(kind === 'hippo' ? 0.45 : 0.8).blend(k).bump(...skinB);
    B.p(hide(S.ellipsoid(bl * 0.32, 0.44 * hump, 0.46).at(-bl * 0.22, 0, 0)));
    B.p(hide(S.ellipsoid(bl * 0.34, 0.5 * hump, 0.5).at(bl * 0.12, 0.03, 0)));
    B.p(hide(S.ellipsoid(bl * 0.2, 0.36, 0.32).at(bl * 0.42, 0.05 + (kind === 'mammoth' ? 0.12 : 0), 0)));
    if (kind === 'mammoth') { B.p(hide(S.ellipsoid(bl * 0.22, 0.28, 0.3).at(bl * 0.22, 0.42, 0))); for (let i = 0; i < 18; i++) { const x = ((i % 9) - 4) * bl * 0.1, s = i < 9 ? 1 : -1; B.h(H.cone(0.06, 0.5, 6).color(shade(col, 0.72 + hash(i) * 0.2)).pbr(0.95).rot(s * 165, 0, 0).at(x, -0.16, s * 0.47).lod(2)); } }
    if (kind === 'boar') for (let i = 0; i < 10; i++) B.h(H.cone(0.04, 0.3, 6).color(0x1a1410).pbr(0.95).rot(0, 0, 35).at(bl * 0.42 - i * bl * 0.09, 0.5 * hump - 0.02, 0).lod(2));
    if (kind === 'rhino') for (let i = 0; i < 3; i++) B.p(S.torus(0.48, 0.03).rot(0, 0, 90).at(bl * (0.25 - i * 0.24), 0.02, 0).color(shade(col, 0.72)).blend(0.03));
    if (kind === 'hippo') for (let i = 0; i < 8; i++) B.p(S.ellipsoid(0.05, 0.02, 0.05).at((hash(i) - 0.5) * bl * 0.8, 0.5 * hump * 0.95, (hash(i + 4) - 0.5) * 0.5).color(shade(col, 0.78)).blend(0.01));
    back = 0.5 * hump;
  }
  return { part: B.part(), back };
}

function paddleHead(kind, Sp, st) {
  const H_ = new SB(), J = new SB(), col = Sp.col, belly = Sp.belly;
  let mouth = [0.6, 0], jawAt = [0.35, -0.08];
  if (kind === 'turtle') {
    SKH.limb(H_, [[-0.3, 0, 0], [0.0, 0.03, 0], [0.25, 0.05, 0]], [0.18, 0.17, 0.19], belly, { k: 0.05, bump: [0.006, 14, 'scales'] });
    H_.p(S.ellipsoid(0.2, 0.15, 0.17).at(0.38, 0.06, 0).color(blend(belly, col, 0.5)).blend(0.06).bump(0.005, 16, 'scales'));
    H_.h(H.tube([[0.5, 0.06, 0], [0.62, 0.02, 0], [0.62, -0.08, 0]], [0.08, 0.04, 0.005], 12, 10).color(shade(belly, 0.5)).pbr(0.4));
    SKH.eyes(H_, [0.4, 0.12, 0.14], 0.03, 0xffd23a, shade(belly, 0.8), { glow: 0.8 });
    J.p(S.capsule([0, 0, 0], [0.26, -0.02, 0], 0.08, 0.03).color(shade(belly, 0.8)).blend(0.03));
    jawAt = [0.3, -0.05]; mouth = [0.62, 0.2];
  } else if (kind === 'mammoth') {
    H_.p(S.ellipsoid(0.34, 0.4, 0.34).at(0.05, 0.08, 0).color(col).pbr(0.9).bump(0.016, 9, 'fur'));
    H_.p(S.ellipsoid(0.15, 0.18, 0.12).at(0.0, 0.36, 0).color(col).blend(0.1).bump(0.016, 9, 'fur'));
    SKH.limb(H_, [[0.32, -0.05, 0], [0.5, -0.3, 0], [0.62, -0.55, 0], [0.82, -0.62, 0], [0.95, -0.35, 0], [0.98, -0.1, 0.05]], [0.14, 0.12, 0.1, 0.085, 0.065, 0.05], col, { k: 0.04, r: 0.9, bump: [0.006, 20, 'ridges'] });
    for (const z of [-1, 1]) {
      SKH.horn(H_, [[0.3, -0.15, z * 0.15], [0.62, -0.38, z * 0.32], [0.98, -0.14, z * 0.4], [1.06, 0.25, z * 0.24]], 0.06, 0xf0e8d4, { rings: 0, tip: 0.9, r: 0.3 });
      H_.h(H.torus(0.065, 0.012, 20, 6).color(st.metal).pbr(0.3, 0.85).rot(0, 90 + z * 23, 23).at(0.6, -0.33, z * 0.3));
      H_.p(S.ellipsoid(0.07, 0.3, 0.28).at(-0.05, 0.12, z * 0.36).color(shade(col, 0.85)).blend(0.03).bump(0.01, 10, 'fur')); // ears
    }
    SKH.eyes(H_, [0.25, 0.12, 0.28], 0.03, 0x2a1a10, shade(col, 0.8), { glow: 0.2, round: true });
    J.p(S.ellipsoid(0.18, 0.07, 0.14).at(0.05, 0, 0).color(shade(col, 0.9)).blend(0.03));
    jawAt = [0.25, -0.25]; mouth = [1.0, 0.15];
  } else if (kind === 'hippo') {
    H_.p(S.ellipsoid(0.32, 0.26, 0.3).at(0.0, 0.08, 0).color(col).pbr(0.45).bump(0.004, 10, 'noise'));
    H_.p(S.ellipsoid(0.26, 0.17, 0.34).at(0.5, 0.06, 0).color(col).pbr(0.45).blend(0.1));
    for (const z of [-1, 1]) {
      H_.p(S.sphere(0.07).at(0.05, 0.32, z * 0.18).color(col).blend(0.04));
      H_.p(S.ellipsoid(0.04, 0.05, 0.03).at(-0.08, 0.36, z * 0.16).color(shade(col, 0.8)).blend(0.02));
      H_.p(S.ellipsoid(0.06, 0.05, 0.05).at(0.62, 0.18, z * 0.12).color(col).blend(0.03));
      H_.p(S.sphere(0.022).at(0.67, 0.21, z * 0.12).cut(0.006).color(0x1a0a0a));
    }
    SKH.eyes(H_, [0.1, 0.34, 0.18], 0.03, 0x3a1a1a, null, { glow: 0.2, round: true });
    J.p(S.ellipsoid(0.3, 0.09, 0.3).at(0.25, -0.02, 0).color(belly).pbr(0.5).blend(0.05));
    J.p(S.ellipsoid(0.24, 0.03, 0.24).at(0.28, 0.06, 0).cut(0.01).color(0xb04a5a));
    for (const z of [-1, 1]) { J.h(H.cone(0.045, 0.22, 10).color(0xf0e8d0).pbr(0.35).at(0.42, 0.13, z * 0.2)); J.h(H.cone(0.03, 0.12, 8).color(0xf0e8d0).pbr(0.35).at(0.5, 0.08, z * 0.08)); }
    jawAt = [0.3, -0.04]; mouth = [0.7, 0];
  } else {
    const sn = kind === 'boar' ? 0.65 : 0.5, skinB = kind === 'boar' ? [0.012, 11, 'fur'] : [0.008, 12, 'rock'];
    H_.p(S.ellipsoid(0.27, 0.29, 0.27).at(0.0, 0.08, 0).color(col).pbr(0.8).bump(...skinB));
    H_.p(S.capsule([0.1, 0.06, 0], [0.3 + sn, -0.02, 0], 0.22, 0.14).color(col).pbr(0.8).blend(0.1).bump(...skinB));
    for (const z of [-1, 1]) {
      SKH.fin(H_, [[0, 0], [0.12, 0], [0.04, 0.26]], 0.035, col, [-0.05, 0.3, z * 0.15], [z * -25, 0, -15], { ribs: 0 });
      H_.p(S.capsule([-0.06, 0.24, z * 0.1], [0.2, 0.2, z * 0.09], 0.06, 0.045).color(shade(col, 0.9)).blend(0.05));
      if (kind === 'boar') SKH.horn(H_, [[0.2 + sn * 0.8, -0.1, z * 0.12], [0.3 + sn * 0.9, 0.04, z * 0.22], [0.26 + sn * 0.8, 0.24, z * 0.22], [0.16 + sn * 0.7, 0.32, z * 0.18]], 0.05, 0xf0e8d0, { rings: 0, tip: 0.85, r: 0.3 });
    }
    SKH.eyes(H_, [0.22, 0.2, 0.2], 0.035, kind === 'boar' ? 0xff4a1a : 0x2a1a10, shade(col, 0.85), { glow: kind === 'boar' ? 1.6 : 0.2, round: kind !== 'boar' });
    if (kind === 'rhino') { SKH.horn(H_, [[0.2 + sn * 0.9, 0.1, 0], [0.28 + sn * 0.95, 0.4, 0], [0.18 + sn * 0.9, 0.68, 0]], 0.12, 0xcfc4a8, { rings: 6, r: 0.6 }); SKH.horn(H_, [[0.18 + sn * 0.5, 0.2, 0], [0.2 + sn * 0.52, 0.42, 0]], 0.07, 0xcfc4a8, { rings: 4, r: 0.6 }); }
    if (kind === 'boar') { H_.p(S.cyl(0.13, 0.06, 0.02).rot(0, 0, 90).at(0.33 + sn, -0.02, 0).color(0x8a5a5a).blend(0.02)); for (const z of [-1, 1]) H_.p(S.sphere(0.03).at(0.37 + sn, -0.02, z * 0.045).cut(0.008)); }
    J.p(S.capsule([0, 0, 0], [sn * 0.85, -0.01, 0], 0.13, 0.07).color(belly).pbr(0.75).blend(0.05));
    jawAt = [0.2, -0.12]; mouth = [0.3 + sn, 0];
  }
  // a collar strap round the neck, in harness leather with the realm's metal studs
  H_.h(H.torus(0.3, 0.035, 36, 8).color(0x4a2e1a).pbr(0.7).rot(0, 90, 0).scale(1, 1.05, 1).at(-0.12, 0.02, 0));
  for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; H_.h(H.sphere(0.024, 8).color(st.metal).pbr(0.3, 0.85).at(-0.12, 0.02 + Math.sin(a) * 0.315, Math.cos(a) * 0.315).lod(1)); }
  return { head: H_.part(), jaw: J.part(), jawAt, mouth, headPaint: bellyPaint(col, belly) };
}

/** a paddler (width units): body with its back out of the water, head up, legs stroking below */
function paddler(kind, Sp, len, st) {
  const g = new THREE.Group(), legs = [];
  const bl = len * 0.62, key = `${kind}|${q4(bl)}`;
  const pp = paddlerParts(kind, Sp, bl), back = pp.back;
  const bodyGeo = sculptL(`towpad|${key}`, () => pp.part, { res: RES.body, min: 8, paint: bellyPaint(Sp.col, Sp.belly, { at: 0.3, pat: kind === 'turtle' ? ((dk) => (x, y, z, nx, ny) => (ny > 0.3 && Math.abs(Math.sin(x * 9)) < 0.1 ? dk : null))(rgbOf(shade(Sp.col, 0.55))) : null }) });
  const K = new Kit();
  K.add(bodyGeo, 0xffffff);
  if (kind !== 'turtle') {
    // a saddle-cloth in the realm's colours with its device, a fringe along its hem
    const drape = clothPanel(`drape${q4(bl)}${q4(back)}`, (u, v) => { const a = (v - 0.5) * PI * 0.9; return [(u - 0.5) * bl * 0.42, Math.cos(a) * back * 1.06 - back * 0.02 + Math.sin(u * PI * 6) * 0.004, 1, Math.sin(a) * 0.56]; }, 0, 14, 16, { u: 3, v: 0 });
    K.add(drape, st.cloth, 0, 0, 0, { r: 0.9 });
    K.detail(1, () => { for (const s of [-1, 1]) for (let i = 0; i < 9; i++) K.add(G.cone(0.02, 0.09, 5), st.cloth2, (i / 8 - 0.5) * bl * 0.4, back * 0.33 - 0.04, s * 0.53, { rx: s * 0.2, rz: PI }); });
    K.detail(2, () => { for (const s of [-1, 1]) { K.push(0, back * 0.55, s * 0.47, 0, s > 0 ? -0.3 : PI + 0.3, 0); emblemOn(K, st, 0.3, { depth: 0.04 }); K.pop(); } });
  }
  const body = K.mesh(undefined, `towpadK|${key}|${st.id}`); g.add(body);
  // the head
  const hp = paddleHead(kind, Sp, st), hx = bl * 0.5 + 0.1;
  const head = lazyMesh(new THREE.Mesh(undefined, sculptMaterial()), new Kit().add(sculptL(`towpadhead|${kind}|${st.metal}`, () => hp.head, { res: RES.head, min: 10, paint: hp.headPaint }), 0xffffff).levels(`towpadheadK|${kind}|${st.metal}`));
  head.position.set(hx, 0.22, 0); g.add(head);
  const jaw = lazyMesh(new THREE.Mesh(undefined, sculptMaterial()), new Kit().add(sculptL(`towpadjaw|${kind}`, () => hp.jaw, { res: RES.head, min: 10 }), 0xffffff).levels(`towpadjawK|${kind}`));
  jaw.position.set(hp.jawAt[0], hp.jawAt[1], 0); head.add(jaw);
  // legs (or flippers), stroking under the surface
  const meshes = [body, head, jaw];
  for (const [fx, z] of [[0.32, 1], [0.32, -1], [-0.32, 1], [-0.32, -1]]) {
    const lk = `towleg|${kind}|${fx > 0}|${z}`;
    const geo = sculptL(lk, () => {
      const B = new SB();
      if (kind === 'turtle') {
        B.p(S.ellipsoid(0.12, 0.05, fx > 0 ? 0.42 : 0.26).rot(0, fx > 0 ? -15 * z : 10 * z, 0).at(fx > 0 ? 0.02 : -0.04, -0.03, z * (fx > 0 ? 0.36 : 0.22)).color(Sp.belly).pbr(0.55).bump(0.006, 14, 'scales'));
        B.p(S.capsule([0, 0, 0], [0.02, -0.02, z * 0.12], 0.1, 0.07).color(Sp.belly).blend(0.04));
      } else {
        SKH.limb(B, [[0, 0, 0], [0.02, -0.3, 0], [0.06, -0.58, 0]], [0.17, 0.13, 0.12], Sp.col, { k: 0.05, r: 0.8, bump: kind === 'mammoth' || kind === 'boar' ? [0.012, 10, 'fur'] : [0.006, 12, 'rock'] });
        B.p(S.cyl(0.13, 0.1, 0.02).at(0.07, -0.64, 0).color(kind === 'boar' ? 0x161210 : 0x2a221c).pbr(0.6).blend(0.03));
        if (kind === 'boar') B.p(S.box(0.3, 0.12, 0.02, 0.005).at(0.12, -0.66, 0).cut(0.004));
      }
      return B.part();
    }, { res: RES.leg, min: 9 });
    const leg = lazyMesh(new THREE.Mesh(undefined, sculptMaterial()), new Kit().add(geo, 0xffffff).levels(`${lk}K`));
    leg.position.set(fx * bl, -0.1, z * (kind === 'turtle' ? 0.35 : 0.32)); leg.userData.z = z; g.add(leg); legs.push(leg); meshes.push(leg);
  }
  return { group: g, head, body, legs, jaw, meshes, collar: [bl * 0.15, back * 0.92], collarR: 0.5, mouth: [hx + hp.mouth[0], 0.22 + hp.mouth[1]], woundAt: [bl * 0.1, -bl * 0.2], r: 0.5 };
}

// =====================================================================================
//  the harness, the motion and the hooks
// =====================================================================================
let woundGeo = null;
/** gashes and arrow-shafts in a beast's flank (width units), shown once she is badly hurt */
function wounds() {
  if (woundGeo) return woundGeo;
  const B = new SB();
  for (let i = 0; i < 5; i++) {
    const x = (hash(i) - 0.5) * 0.6, y = 0.1 + hash(i + 3) * 0.25, z = 0.5;
    for (const s of [-1, 1]) {
      B.h(H.capsule(0.03, 0.22, 10).color(0x5a0a0a).pbr(0.25).glow(0.15).rot(90, 0, 70 + hash(i + 5) * 40).scale(1, 1, 0.45).at(x, y, s * z));
      B.h(H.cyl(0.008, 0.008, 0.3, 6).color(0x4a3220).rot(s * (60 + hash(i + 7) * 30), 0, 20).at(x + 0.1, y + 0.05, s * (z + 0.08)).lod(2));
    }
  }
  return (woundGeo = new Kit().add(sculptL('towwounds', () => B.part(), { res: 50 }), 0xffffff).levels('towwoundsK'));
}

export function buildTow(c, kind) {
  const Sp = SPEC[kind];
  if (!Sp) return;
  const st = c.st, len = clamp(c.L * Sp.len, 3, 9), w = clamp(c.B * 0.5, 1.2, 2.4), gap = clamp(c.L * 0.16, 1.4, 2.6);
  const x0 = c.bowX + gap + len / 2, y0 = Sp.quad ? 0.1 : 0.05;
  // authored in units of her width, quantised so a kind is meshed for only a few proportions
  const lenN = Math.round((len / w) * 4) / 4;
  const b = Sp.quad ? paddler(kind, Sp, lenN, st) : swimmer(kind, Sp, lenN, st);
  b.group.position.set(x0, y0, 0); b.group.scale.setScalar(w);
  // harness: a padded yoke over the shoulders, a girth strap, and chains of links back to her bow
  const yx = x0 + b.collar[0] * w, yy = y0 + b.collar[1] * w, cR = b.collarR * w;
  const K = c.kit;
  K.add(G.rbox(0.22, 0.14, w * 1.25, 0.04, 2), C.dark, yx, yy + 0.04, 0);
  K.add(G.tor(cR * 1.02, 0.045, 8, 32, PI), 0x4a2e1a, yx, y0 + 0.02, 0, { ry: PI / 2, sy: (b.collar[1] * w + 0.04) / cR });
  K.detail(1, () => { for (const z of [-1, 1]) { K.add(G.tor(0.07, 0.018, 6, 14), C.iron, yx, yy + 0.04, z * w * 0.62, { m: 0.55 }); K.add(G.sph(0.05, 10, 8), st.metal, yx, yy + 0.12, z * w * 0.4, { m: st.metalM }); } });
  const by = Math.max(0.5, c.deckAt(c.bowX - 0.4) - 0.2);
  for (const z of [-1, 1]) {
    const a = [yx, yy + 0.04, z * w * 0.62], e = [c.bowX - 0.2, by, z * Math.max(0.25, c.hw(c.bowX - 0.4) * 0.8)];
    K.chain(a, e, 0.25, clamp(c.k * 0.16, 0.12, 0.2), C.iron);
    K.add(G.tor(0.09, 0.025, 6, 14), C.iron, ...e, { m: 0.55 }); // the ring-bolt on her bow
  }
  // a banner on the yoke in the realm's colours
  K.add(G.cyl(0.03, 0.03, 0.8, 8), C.dark, yx, yy + 0.45, 0);
  K.add(clothPanel('yokeflag2', (u, v) => [-u * 0.7, (v - 0.5) * 0.45 * (1 - u * 0.3), 1], 0.06, 10, 5, { u: 2 }), st.cloth, yx, yy + 0.65, 0, { r: 0.85 });
  K.add(G.shape('pennant', [[0, -0.12], [-1, 0], [0, 0.12]]), c.side, yx, yy + 0.92, 0, { sx: 0.7, sy: 1.2 });
  // her wounds: a mesh of gashes on the flank, riding the first spine bone (or the body)
  // (in a group of its own: the detail-level switch owns the mesh's own visibility)
  const wm = new THREE.Group();
  wm.add(lazyMesh(new THREE.Mesh(undefined, sculptMaterial()), wounds()));
  wm.visible = false;
  if (b.segs) { wm.position.set(b.woundAt[0] - b.segs[1].position.x, 0, 0); wm.scale.set(1, b.r * 2, b.r * 2); b.segs[1].add(wm); } else b.body.add(wm);
  const segs = b.segs, legs = b.legs, jaw = b.jaw, jaw0 = jaw.rotation.z;
  const act = { lunge: 0, gape: 0, flinch: 0, dmg: 0 };
  c.addMoving(b.group, (t, ph) => {
    const tired = act.dmg >= 3 ? 0.15 : act.dmg >= 2 ? 0.6 : 1;
    const a = t * Sp.speed * (0.4 + 0.6 * tired) + ph;
    if (segs) segs.forEach((s, i) => {
      const k = i / (segs.length - 1);
      s.position.z = Math.sin(a - i * 0.8) * Sp.lat * k * k * 1.6 * tired + act.flinch * Math.sin(t * 40 + i) * 0.08 / w;
      s.position.y = Math.sin(a * 0.8 - i * 0.7) * Sp.vert * k * tired;
      s.rotation.y = -Math.cos(a - i * 0.8) * Sp.lat * k * 0.9 * tired;
      s.rotation.z = Math.cos(a * 0.8 - i * 0.7) * Sp.vert * 0.25 * k * tired + (i === 0 ? act.gape * 0.25 - (act.dmg >= 3 ? 0.25 : 0) : 0);
    });
    if (legs) {
      legs.forEach((l, i) => { l.rotation.z = Math.sin(a * 2 + (i % 2 ? PI : 0) + (i > 1 ? PI / 2 : 0)) * 0.7 * tired; if (kind === 'turtle') l.rotation.x = l.userData.z * Math.sin(a * 1.5 + i) * 0.4 * tired; });
      b.body.position.y = Math.sin(a * 2) * 0.06 * tired + act.flinch * Math.sin(t * 40) * 0.05 - (act.dmg >= 3 ? 0.18 : 0);
      b.head.rotation.z = Math.sin(a * 1.3) * 0.08 * tired + act.gape * 0.3 - (act.dmg >= 3 ? 0.45 : act.dmg >= 2 ? 0.12 : 0);
      b.head.rotation.y = Math.sin(a * 0.7) * 0.12 * tired;
    }
    jaw.rotation.z = jaw0 - 0.08 - 0.08 * Math.max(0, Math.sin(a * 0.6)) - act.gape - (act.dmg >= 3 ? 0.25 : 0);
    // spent: she rolls on her side and settles
    b.group.rotation.x = act.dmg >= 3 ? 1.1 + Math.sin(t * 0.7 + ph) * 0.06 : act.dmg >= 2 ? 0.12 : 0;
    b.group.position.y = y0 - (act.dmg >= 3 ? 0.25 * w : 0);
    b.group.position.x = x0 + act.lunge;
    act.lunge *= 0.85; act.gape *= 0.85; act.flinch *= 0.85;
  });
  // ram: the beast surges ahead (taking up the chains) jaws wide, and snaps them shut; grapple: a bite; hit: it flinches
  const bite = (k) => { act.gape = k < 0.5 ? (k / 0.5) * 0.6 : Math.max(0, 0.6 - ((k - 0.5) / 0.15) * 0.6); jaw.rotation.z = jaw0 - 0.08 - act.gape; };
  c.action('ram', (k) => { act.lunge = bump(k) * len * 0.12; b.group.position.x = x0 + act.lunge; bite(k); if (k >= 1) act.lunge = act.gape = 0; });
  c.action('grapple', (k) => { bite(k); if (k >= 1) act.gape = 0; });
  c.action('hit', (k) => { act.flinch = bump(k); if (k >= 1) act.flinch = 0; });
  (c.damageFns ||= []).push((lv) => { act.dmg = lv; wm.visible = lv >= 2; });
  c.anchor('mouth', [x0 + b.mouth[0] * w, y0 + b.mouth[1] * w, 0], 'tow');
  c.anchor('beast', [x0, y0 + w * 0.4, 0], 'tow');
  c.topAt = Math.max(c.topAt || 0, y0 + w * 1.2);
}
