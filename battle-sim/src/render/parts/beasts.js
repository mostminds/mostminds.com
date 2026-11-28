// Beasts that tow a designed ship: swimming ahead of her bow, harnessed to it by chains.
//   tow:mosasaur  tow:serpent  tow:gator  tow:orca  tow:whale  (long swimmers: the body undulates)
//   tow:turtle    tow:boar     tow:mammoth tow:hippo tow:rhino   (paddlers: head up, legs or flippers stroking)
// Bodies are lofted (rings swept along the spine, pale bellies, ridges and patterns baked into the vertex colours);
// heads carry a lower jaw of their own that gapes on the ram and grapple actions. The harness is a collar strap, a
// yoke and two chains of links back to her bow, with a saddle-cloth in the realm's colours where there is a back.
import * as THREE from 'three';
import { Kit, G, C, shade, blend, clamp, lerp, hash, loftL, taper, clothPanel } from './kit.js';
import { emblemOn } from './realmStyle.js';
import { sculptMaterial } from '../sculpt.js';

const PI = Math.PI;
const f2 = (v) => v.toFixed(2);
const bump = (k) => Math.sin(PI * clamp(k, 0, 1));
const SPEC = {
  mosasaur: { len: 0.72, col: 0x3a5a5a, belly: 0xc8c0a0, segs: 6, lat: 0.35, vert: 0.05, speed: 2.2, r: [0.42, 0.5, 0.48, 0.4, 0.3, 0.2, 0.1], flat: 0.85 },
  serpent: { len: 0.95, col: 0x2a6a5a, belly: 0xd8c88a, segs: 10, lat: 0.45, vert: 0.35, speed: 2.6, r: [0.34, 0.36, 0.35, 0.33, 0.3, 0.26, 0.22, 0.17, 0.12, 0.07], flat: 0.95 },
  gator: { len: 0.6, col: 0x4a5a2a, belly: 0xb8b080, segs: 6, lat: 0.3, vert: 0.02, speed: 2, r: [0.36, 0.46, 0.44, 0.34, 0.22, 0.12, 0.06], flat: 0.6 },
  orca: { len: 0.55, col: 0x121418, belly: 0xf0f0f0, segs: 4, lat: 0.04, vert: 0.22, speed: 2, r: [0.5, 0.52, 0.42, 0.24, 0.1], flat: 0.95 },
  whale: { len: 0.85, col: 0x3a4a5a, belly: 0xb8c0c0, segs: 5, lat: 0.03, vert: 0.25, speed: 1.2, r: [0.55, 0.56, 0.48, 0.34, 0.2, 0.08], flat: 0.9 },
  turtle: { len: 0.42, col: 0x4a6a3a, belly: 0xc8b87a, quad: true, speed: 1.6 },
  boar: { len: 0.4, col: 0x4a3426, belly: 0x6a4a36, quad: true, speed: 2.6 },
  mammoth: { len: 0.48, col: 0x5a3a22, belly: 0x4a3020, quad: true, speed: 1.8 },
  hippo: { len: 0.42, col: 0x7a6a72, belly: 0xc89a9a, quad: true, speed: 2 },
  rhino: { len: 0.42, col: 0x6a6a66, belly: 0x8a8a84, quad: true, speed: 2.2 },
};

function eyes(K, x, y, z, r, col, glow = 2.2) {
  for (const s of [-1, 1]) {
    K.add(G.sph(r * 1.3, 8, 6), shade(col === 0xffd23a ? 0x3a2a1a : 0x1a1a1a, 1), x - r * 0.2, y, s * z, { sx: 0.8 });
    K.add(G.sph(r, 10, 8), col, x, y, s * (z + r * 0.2), { g: glow });
    K.detail(1, () => K.add(G.sph(r * 0.4, 6, 4), C.black, x + r * 0.5, y, s * (z + r * 0.55), { sx: 0.5, sy: 1.6 }));
  }
}
function teeth(K, x0, x1, y, z, h, n, up) {
  K.detail(2, () => { for (const s of [-1, 1]) for (let i = 0; i < n; i++) { const t = i / Math.max(1, n - 1), hh = h * (i % 3 === 1 ? 1.5 : 1); K.add(G.cone(hh * 0.3, hh, 5), C.bone, lerp(x0, x1, t), y + (up ? -hh / 2 : hh / 2), s * z * (1 - t * 0.4), { rz: up ? PI : 0, r: 0.4 }); } });
}

/** the head of a long swimmer, neck at x = 0, snout toward +x; returns { head, jaw (mesh), mouth: [x, y] } */
function swimHead(kind, S, w) {
  const H = new Kit(), J = new Kit(), col = S.col, belly = S.belly;
  let mouth = [w, 0], jawAt = [0, 0];
  if (kind === 'mosasaur' || kind === 'gator') {
    const gl = kind === 'gator', hl = w * (gl ? 1.5 : 1.35), hw = w * (gl ? 0.42 : 0.4), hh = w * (gl ? 0.18 : 0.24);
    H.add(loftL(`${kind}skull${f2(w)}`, [[-0.1 * w, hh * 0.3, 0, hw * 0.95, hh * 1.2, { fl: 0.8 }], [hl * 0.2, hh * 0.4, 0, hw, hh * 1.1, { fl: 0.85 }], [hl * 0.55, hh * 0.25, 0, hw * (gl ? 0.7 : 0.55), hh * 0.7, { fl: 0.9 }], [hl * 0.92, hh * 0.15, 0, hw * (gl ? 0.5 : 0.3), hh * 0.45, { fl: 0.9 }], [hl, hh * 0.1, 0, hw * 0.12, hh * 0.18]], { radial: 16, sub: 3, col, belly, ridge: shade(col, 0.7) }), 0xffffff, 0, 0, 0, { r: 0.55 });
    teeth(H, hl * 0.2, hl * 0.95, hh * 0.05, hw * 0.75, hw * 0.16, 7, true);
    eyes(H, hl * 0.18, hh * 1.3, hw * 0.62, hw * 0.1, 0xffd23a);
    for (const s of [-1, 1]) { H.add(G.sph(hw * 0.08, 6, 4), C.black, hl * 0.95, hh * 0.45, s * hw * 0.12); H.add(G.sph(hw * 0.16, 6, 4), shade(col, 0.75), hl * 0.2, hh * 1.4, s * hw * 0.55, { sx: 1.8, sy: 0.4 }); }
    H.detail(2, () => { for (let i = 0; i < (gl ? 10 : 5); i++) for (const s of [-1, 0, 1]) H.add(G.sph(hw * 0.07, 5, 3), shade(col, 0.8), hl * (0.1 + i * (gl ? 0.08 : 0.12)), hh * 1.25, s * hw * 0.3, { sy: 0.6 }); });
    J.add(loftL(`${kind}jaw${f2(w)}`, [[0, 0, 0, hw * 0.88, hh * 0.5, { up: -0.5 }], [hl * 0.5, 0, 0, hw * (gl ? 0.6 : 0.5), hh * 0.4, { up: -0.5 }], [hl * 0.92, 0, 0, hw * 0.25, hh * 0.25, { up: -0.5 }]], { radial: 12, col: belly }), 0xffffff, 0, 0, 0, { r: 0.6 });
    J.add(G.box(hl * 0.8, 0.02, hw * 1.0), 0x7a2020, hl * 0.45, 0.01, 0, { g: 0.2 });
    teeth(J, hl * 0.2, hl * 0.88, 0.0, hw * 0.65, hw * 0.13, 6, false);
    jawAt = [0, hh * 0.05]; mouth = [hl * 0.8, hh * 0.1];
  } else if (kind === 'serpent') {
    const hl = w * 1.1, hw = w * 0.38, hh = w * 0.28;
    H.add(loftL(`serphead${f2(w)}`, [[-0.05 * w, 0.1 * w, 0, hw * 0.9, hh, { fl: 0.6 }], [hl * 0.3, 0.12 * w, 0, hw, hh * 1.05, { fl: 0.7 }], [hl * 0.7, 0.06 * w, 0, hw * 0.6, hh * 0.6, { fl: 0.8 }], [hl, 0.02 * w, 0, hw * 0.2, hh * 0.25]], { radial: 16, sub: 3, col, belly, ridge: blend(col, 0xd84a2a, 0.5) }), 0xffffff, 0, 0, 0, { r: 0.5, m: 0.15 });
    teeth(H, hl * 0.3, hl * 0.92, 0.0, hw * 0.6, hw * 0.2, 5, true);
    eyes(H, hl * 0.35, hh * 1.2, hw * 0.6, hw * 0.12, 0xffd23a, 2.5);
    const fr = blend(col, 0xd84a2a, 0.5);
    for (const s of [-1, 1]) {
      H.add(taper(`serphorn${s}${f2(w)}`, [[hl * 0.15, hh * 1.3, s * hw * 0.5], [-hl * 0.2, hh * 2.0, s * hw * 0.9], [-hl * 0.55, hh * 2.3, s * hw * 0.8]], [hw * 0.12, hw * 0.01], 8, 5), C.bone);
      H.detail(2, () => { for (let k = 0; k < 4; k++) H.add(G.sph(w * 0.3, 6, 4), shade(fr, 0.9 + k * 0.05), -w * 0.05 - k * w * 0.08, hh * (0.4 + k * 0.15), s * hw * (1.0 + k * 0.1), { sx: 0.5, sy: 0.9, sz: 0.04, ry: s * 0.8, rz: 0.5 }); });
    }
    J.add(loftL(`serpjaw${f2(w)}`, [[0, 0, 0, hw * 0.8, hh * 0.35, { up: -0.5 }], [hl * 0.6, 0, 0, hw * 0.5, hh * 0.28, { up: -0.5 }], [hl * 0.92, 0, 0, hw * 0.18, hh * 0.15]], { radial: 12, col: belly }), 0xffffff, 0, 0, 0, { r: 0.55 });
    teeth(J, hl * 0.3, hl * 0.85, 0, hw * 0.5, hw * 0.16, 4, false);
    J.add(taper(`serptongue${f2(w)}`, [[hl * 0.3, 0.02, 0], [hl * 1.1, 0.03, 0], [hl * 1.3, 0.06, w * 0.06]], [w * 0.025, w * 0.008], 8, 4), 0xc82a2a);
    jawAt = [0, 0.02 * w]; mouth = [hl * 0.9, 0.05 * w];
  } else if (kind === 'orca') {
    const hl = w * 0.9;
    H.add(loftL(`orcahead${f2(w)}`, [[-0.1 * w, 0, 0, w * 0.48, w * 0.44], [hl * 0.4, 0.02 * w, 0, w * 0.42, w * 0.38], [hl * 0.85, 0.0, 0, w * 0.24, w * 0.2], [hl, -0.04 * w, 0, w * 0.06, w * 0.06]], { radial: 16, sub: 3, col, belly, paint: (t, a, ca) => (t > 0.3 && t < 0.55 && Math.sin(a) > 0.15 && Math.sin(a) < 0.55 && Math.abs(ca) > 0.6 ? 0xf0f0f0 : null) }), 0xffffff, 0, 0, 0, { r: 0.3, m: 0.15 });
    eyes(H, hl * 0.6, w * 0.05, w * 0.3, w * 0.04, 0x1a1a1a, 0);
    teeth(H, hl * 0.4, hl * 0.95, -w * 0.08, w * 0.2, w * 0.06, 6, true);
    J.add(loftL(`orcajaw${f2(w)}`, [[0, 0, 0, w * 0.38, w * 0.14, { up: -0.5 }], [hl * 0.6, 0, 0, w * 0.26, w * 0.1, { up: -0.5 }], [hl * 0.95, 0, 0, w * 0.06, w * 0.04]], { radial: 12, col: belly }), 0xffffff, 0, 0, 0, { r: 0.35 });
    jawAt = [hl * 0.1, -w * 0.1]; mouth = [hl * 0.9, -w * 0.08];
  } else {
    // whale: a great blunt head, grooved throat, barnacles
    const hl = w * 1.35;
    H.add(loftL(`whalehead${f2(w)}`, [[-0.1 * w, 0, 0, w * 0.55, w * 0.5, { n: 2.6 }], [hl * 0.5, 0.05 * w, 0, w * 0.52, w * 0.46, { n: 2.8 }], [hl * 0.9, 0.08 * w, 0, w * 0.42, w * 0.38, { n: 2.6 }], [hl, 0.06 * w, 0, w * 0.22, w * 0.2]], { radial: 16, sub: 3, col, belly }), 0xffffff, 0, 0, 0, { r: 0.65 });
    eyes(H, hl * 0.25, -w * 0.05, w * 0.5, w * 0.045, 0x1a1a1a, 0);
    H.detail(2, () => { for (let i = 0; i < 9; i++) H.add(G.sph(w * (0.04 + hash(i) * 0.03), 5, 4), 0xd8d8c8, hl * (0.4 + hash(i + 3) * 0.55), w * (0.3 + hash(i + 7) * 0.15), (hash(i + 11) - 0.5) * w * 0.6, { sy: 0.5 }); H.add(G.sph(w * 0.05, 6, 4), C.black, hl * 0.25, w * 0.48, 0, { sx: 2 }); });
    J.add(loftL(`whalejaw${f2(w)}`, [[0, 0, 0, w * 0.5, w * 0.2, { up: -0.5 }], [hl * 0.6, 0, 0, w * 0.44, w * 0.18, { up: -0.5, c: belly }], [hl * 0.95, 0, 0, w * 0.2, w * 0.1]], { radial: 12, col: belly, paint: (t, a) => (Math.sin(a) < -0.2 && Math.abs(Math.sin(a * 9)) < 0.25 ? shade(belly, 0.75) : null) }), 0xffffff, 0, 0, 0, { r: 0.65 });
    jawAt = [hl * 0.05, -w * 0.22]; mouth = [hl * 0.95, -w * 0.1];
  }
  return { H, J, jawAt, mouth };
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

/** a long swimmer: head at +x, one skinned body trailing toward -x on a chain of spine bones; returns { group, segs (bones), jaw, collar, mouth } */
function swimmer(kind, S, len, w, st) {
  const g = new THREE.Group(), n = S.segs, sl = len / (n + 1.2);
  const { H, J, jawAt, mouth } = swimHead(kind, S, w);
  const head = H.mesh(undefined, `tow${kind}head${f2(w)}`);
  const jaw = J.mesh(undefined, `tow${kind}jaw${f2(w)}`); jaw.position.set(jawAt[0], jawAt[1], 0); head.add(jaw);
  const hx = len / 2 - sl * 0.6;
  // spine: bone 0 carries the head, the rest run down to the tail
  const bx = [hx, ...Array.from({ length: n }, (_, i) => len / 2 - sl * (i + 1.4))];
  const R = (t) => { const f = t * (S.r.length - 1), i = Math.min(S.r.length - 2, Math.floor(f)); return w * lerp(S.r[i], S.r[i + 1], f - i); };
  const tailX = bx[n] - sl * 0.7;
  const tOf = (x) => clamp((hx - x) / (hx - tailX), 0, 1);
  const pattern = kind === 'serpent' ? (t, a) => (Math.sin(a) > 0 && Math.sin(t * 14 * n / 10 + Math.cos(a) * 3) > 0.6 ? shade(S.col, 0.6) : null)
    : kind === 'gator' || kind === 'mosasaur' ? (t, a) => (Math.sin(a) > 0.3 && Math.sin(t * 30) > 0.7 ? shade(S.col, 0.75) : null) : null;
  const K = new Kit();
  const rings = [];
  for (let k = 0; k <= n + 1; k++) { const x = lerp(hx + sl * 0.1, tailX, k / (n + 1)), t = tOf(x), r = R(t); rings.push([x, 0, 0, Math.max(r, w * 0.02), Math.max(r, w * 0.02) * S.flat]); }
  K.add(loftL(`tow${kind}body${f2(w)}${f2(sl)}`, rings, { radial: 18, sub: 3, col: S.col, belly: S.belly, ridge: kind === 'orca' ? undefined : shade(S.col, 0.75), paint: pattern }), 0xffffff, 0, 0, 0, { r: kind === 'orca' ? 0.3 : 0.6, m: kind === 'orca' ? 0.15 : 0 });
  for (let i = 0; i < n; i++) {
    const x = bx[i + 1], r = R(tOf(x));
    K.detail(2, () => {
      if (kind === 'gator' || kind === 'mosasaur') for (const zz of [-0.45, 0, 0.45]) for (const dx of [-0.25, 0.25]) K.add(G.cone(r * 0.12, r * 0.32, 5), shade(S.col, 0.7), x + dx * sl, r * S.flat * (zz ? 0.85 : 1.0), zz * r, { s: zz ? 1 : 1.3 });
      if (kind === 'serpent' && i < n - 1) K.add(G.sph(r * 0.5, 6, 4), blend(S.col, 0xd84a2a, 0.5), x, r * 0.95, 0, { sx: 0.8, sy: 1.1, sz: 0.06, rz: 0.4 });
    });
    if (kind === 'orca' && i === 0) K.add(G.shape('orcafin2', [[-0.6, 0], [0.2, 0], [0.05, 0.4], [-0.35, 1]], 0.06, 0.02), S.col, x, r * 0.85, 0, { s: w * 1.2, r: 0.3 });
    if (kind === 'whale' && i === 2) K.add(G.shape('whalehump', [[-0.5, 0], [0.4, 0], [0.0, 0.25]], 0.1, 0.03), S.col, x, r * 0.85, 0, { s: w });
    const fin = (kind === 'mosasaur' && (i === 0 || i === 2)) || ((kind === 'whale' || kind === 'orca') && i === 0);
    if (fin) for (const z of [-1, 1]) K.add(loftL(`flip${kind}${f2(r)}${z}`, [[0, 0, 0, r * 0.12, r * 0.25], [-r * 0.2, -r * 0.2, z * r * 0.8, r * 0.07, r * 0.3], [-r * 0.6, -r * 0.35, z * r * 1.5, r * 0.03, r * 0.12]], { radial: 8, col: shade(S.col, 0.85), lat: [0, 1, 0] }), 0xffffff, x, -r * 0.3, z * r * 0.75);
    if (kind === 'gator' && (i === 0 || i === 2)) for (const z of [-1, 1]) K.add(taper(`gleg${f2(r)}${z}`, [[0, -r * 0.2, z * r * 0.8], [r * 0.1, -r * 0.5, z * r * 1.3], [r * 0.4, -r * 0.7, z * r * 1.4]], [r * 0.2, r * 0.1], 6, 5), S.col, x, 0, 0);
  }
  const tr = R(1);
  if (kind === 'mosasaur' || kind === 'gator') K.add(G.shape('tailfin2', [[0, 0], [-1, 0.55], [-0.75, 0], [-1, -0.35]], 0.05, 0.015), S.col, tailX + sl * 0.15, 0, 0, { s: w * (kind === 'gator' ? 0.5 : 0.9) });
  if (kind === 'whale' || kind === 'orca') K.add(G.shape('fluke2', [[0, 0.1], [-0.35, 0.55], [-0.7, 1.05], [-0.45, 0.2], [-0.45, -0.2], [-0.7, -1.05], [-0.35, -0.55], [0, -0.1]], 0.05, 0.02), S.col, tailX + sl * 0.1, 0, 0, { s: w * (kind === 'whale' ? 0.9 : 0.7), rx: PI / 2 });
  if (kind === 'serpent') K.add(taper(`serptail${f2(w)}`, [[tailX + sl * 0.2, 0, 0], [tailX - sl * 0.4, 0.05 * w, 0], [tailX - sl * 0.9, 0.2 * w, 0]], [Math.max(tr, w * 0.04), 0.005], 8, 6), S.col);
  const plain = K.levels(`tow${kind}skin${f2(w)}${f2(sl)}`);
  const bxAll = bx.concat([tailX - sl * 2]);
  const geos = plain.map((gg) => skinGeo(gg, bxAll));
  const mesh = new THREE.SkinnedMesh(geos[0], sculptMaterial());
  mesh.userData.lodGeos = geos; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  const bones = bxAll.map((x) => { const b = new THREE.Bone(); b.position.x = x; return b; });
  for (const b of bones) mesh.add(b);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  g.add(mesh);
  head.position.set(0, 0, 0); bones[0].add(head);
  const segs = bones;
  return { group: g, segs, jaw, collar: [len / 2 - sl * 1.4, R(0.1) * S.flat * 0.9], collarR: R(0.1), mouth: [hx + mouth[0], mouth[1]] };
}

/** a paddler: body with its back out of the water, head up, legs stroking below; returns { group, head, legs, jaw, collar, mouth } */
function paddler(kind, S, len, w, st, c) {
  const g = new THREE.Group(), K = new Kit(), legs = [];
  const bl = len * 0.62, col = S.col, belly = S.belly;
  let back = w * 0.5;
  if (kind === 'turtle') {
    // a domed carapace of scutes with a rim, the plastron underneath
    K.add(loftL(`turtshell${f2(bl)}${f2(w)}`, [[-bl * 0.6, 0, 0, w * 0.05, w * 0.02], [-bl * 0.45, 0.02, 0, w * 0.48, w * 0.22, { fl: 0.9 }], [0, 0.05, 0, w * 0.66, w * 0.38, { fl: 0.92 }], [bl * 0.45, 0.02, 0, w * 0.5, w * 0.24, { fl: 0.9 }], [bl * 0.58, 0, 0, w * 0.05, w * 0.02]], { radial: 20, sub: 3, col, belly, paint: (t, a, ca) => (Math.abs(Math.sin(t * 15)) < 0.12 || Math.abs(Math.sin(a * 4)) < 0.1 ? shade(col, 0.6) : null) }), 0xffffff, 0, 0, 0, { r: 0.55 });
    K.detail(2, () => { for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; K.add(G.sph(w * 0.15, 8, 4), shade(col, 0.82), Math.cos(a) * bl * 0.28, w * 0.31, Math.sin(a) * w * 0.32, { sy: 0.3 }); } K.add(G.sph(w * 0.18, 8, 4), shade(col, 0.82), 0, w * 0.4, 0, { sy: 0.3 }); for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; K.add(G.cone(w * 0.06, w * 0.14, 4), shade(col, 0.7), Math.cos(a) * bl * 0.55, 0.03, Math.sin(a) * w * 0.66, { rz: -Math.cos(a) * 1.4, rx: Math.sin(a) * 1.4 }); } });
    back = w * 0.42;
  } else {
    const hump = kind === 'mammoth' ? 1.15 : kind === 'hippo' ? 0.82 : 0.9;
    K.add(loftL(`${kind}torso${f2(bl)}${f2(w)}`, [[-bl * 0.55, 0, 0, w * 0.2, w * 0.2], [-bl * 0.4, 0, 0, w * 0.46, w * 0.46 * hump], [0, 0.02 * w, 0, w * 0.52, w * 0.5 * hump], [bl * 0.32, 0.05 * w, 0, w * 0.5, w * 0.52 * hump, { up: kind === 'mammoth' ? 0.2 : 0 }], [bl * 0.52, 0.02 * w, 0, w * 0.3, w * 0.34]], { radial: 16, sub: 3, col, belly, ridge: kind === 'boar' ? 0x1a1410 : undefined }), 0xffffff, 0, 0, 0, { r: kind === 'mammoth' ? 1 : 0.7 });
    back = w * 0.5 * hump;
    K.detail(2, () => {
      if (kind === 'mammoth') for (let i = 0; i < 16; i++) { const x = (i % 8 - 3.5) * bl * 0.12, s = i < 8 ? 1 : -1; K.add(G.cone(w * 0.08, w * 0.45, 4), shade(col, 0.75 + hash(i) * 0.2), x, -w * 0.15, s * w * 0.5, { rx: s * 2.8 }); }
      if (kind === 'boar') for (let i = 0; i < 9; i++) K.add(G.cone(w * 0.05, w * 0.32, 4), 0x1a1410, bl * 0.4 - i * bl * 0.1, back, 0, { rz: 0.6 });
      if (kind === 'rhino') for (let i = 0; i < 3; i++) K.add(G.tor(w * 0.5, w * 0.035, 4, 16), shade(col, 0.75), bl * (0.22 - i * 0.22), 0.02 * w, 0, { ry: PI / 2, sy: 0.95 });
      if (kind === 'hippo') for (let i = 0; i < 6; i++) K.add(G.sph(w * 0.05, 5, 3), shade(col, 0.8), (hash(i) - 0.5) * bl * 0.8, back * 0.98, (hash(i + 4) - 0.5) * w * 0.5, { sy: 0.4 });
    });
    // a saddle-cloth in the realm's colours with its device
    const drape = clothPanel(`drape${f2(bl)}${f2(w)}`, (u, v) => { const a = (v - 0.5) * PI * 0.9; return [(u - 0.5) * bl * 0.42, Math.cos(a) * back * 1.06 - back * 0.02, 1, Math.sin(a) * w * 0.56]; }, 0, 6, 8);
    K.add(drape, st.cloth, 0, 0, 0, { r: 0.9 });
    K.detail(2, () => { for (const s of [-1, 1]) { K.push(0, back * 0.55, s * w * 0.47, 0, s > 0 ? -0.3 : PI + 0.3, 0); emblemOn(K, st, w * 0.3, { depth: 0.04 }); K.pop(); } });
  }
  const body = K.mesh(undefined, `tow${kind}body${f2(bl)}${f2(w)}${st.id}`); g.add(body);
  // the head
  const H = new Kit(), J = new Kit(), hx = bl * 0.5 + w * 0.1;
  let mouth = [hx + w * 0.6, 0], jawAt = [w * 0.35, -w * 0.08];
  if (kind === 'turtle') {
    H.add(loftL('turtneck', [[-w * 0.3, 0, 0, w * 0.18, w * 0.16], [w * 0.0, 0.03 * w, 0, w * 0.17, w * 0.15], [w * 0.25, 0.05 * w, 0, w * 0.2, w * 0.17], [w * 0.5, 0.03 * w, 0, w * 0.15, w * 0.12], [w * 0.6, 0.0, 0, w * 0.06, w * 0.06]], { radial: 12, col: belly, paint: (t, a) => (Math.sin(t * 30 + a * 4) > 0.8 ? shade(belly, 0.7) : null) }), 0xffffff, 0, 0, 0, { r: 0.6 });
    H.add(taper('turtbeak', [[w * 0.5, 0.02 * w, 0], [w * 0.64, -0.03 * w, 0], [w * 0.62, -0.1 * w, 0]], [w * 0.08, w * 0.01], 6, 6), shade(belly, 0.55));
    eyes(H, w * 0.38, w * 0.1, w * 0.13, w * 0.03, 0xffd23a);
    jawAt = [w * 0.3, -w * 0.05]; mouth = [hx + w * 0.62, w * 0.2];
    J.add(loftL('turtjaw', [[0, 0, 0, w * 0.12, w * 0.04, { up: -0.5 }], [w * 0.28, -0.02 * w, 0, w * 0.06, w * 0.03]], { radial: 8, col: shade(belly, 0.8) }), 0xffffff);
  } else if (kind === 'mammoth') {
    H.add(loftL('mamhead', [[-w * 0.2, 0, 0, w * 0.3, w * 0.34], [w * 0.1, 0.1 * w, 0, w * 0.36, w * 0.42], [w * 0.32, 0.0, 0, w * 0.26, w * 0.3], [w * 0.45, -0.1 * w, 0, w * 0.14, w * 0.14]], { radial: 14, col }), 0xffffff, 0, 0, 0, { r: 1 });
    H.add(taper('trunk2', [[w * 0.4, -0.1 * w, 0], [w * 0.65, -0.3 * w, 0], [w * 0.9, -0.15 * w, 0], [w * 1.05, 0.2 * w, 0], [w * 1.0, 0.5 * w, 0.05 * w]], [w * 0.13, w * 0.11, w * 0.09, w * 0.07, w * 0.05], 16, 8), col, 0, 0, 0, { r: 1 });
    for (const z of [-1, 1]) {
      H.add(taper(`tusk2${z}`, [[w * 0.32, -0.15 * w, z * w * 0.15], [w * 0.65, -0.35 * w, z * w * 0.32], [w * 1.0, -0.12 * w, z * w * 0.38], [w * 1.08, 0.25 * w, z * w * 0.22]], [w * 0.06, w * 0.055, w * 0.04, w * 0.008], 14, 7), C.bone, 0, 0, 0, { r: 0.35 });
      H.detail(1, () => H.add(G.tor(w * 0.065, w * 0.012, 3, 10), st.metal, w * 0.6, -0.33 * w, z * w * 0.3, { ry: PI / 2 + z * 0.4, rz: 0.4, m: st.metalM })); // tusk rings
      H.add(G.sph(w * 0.3, 10, 8), shade(col, 0.85), -w * 0.05, w * 0.15, z * w * 0.34, { sx: 0.25, sy: 1.1 });
    }
    eyes(H, w * 0.25, w * 0.1, w * 0.26, w * 0.03, 0x2a1a10, 0.3);
    J.add(G.sph(w * 0.14, 8, 6), shade(col, 0.9), w * 0.05, 0, 0, { sx: 1.3, sy: 0.5 });
    jawAt = [w * 0.25, -w * 0.25]; mouth = [hx + w * 1.0, w * 0.15];
  } else if (kind === 'hippo') {
    H.add(loftL('hiphead', [[-w * 0.2, 0.05 * w, 0, w * 0.3, w * 0.26], [w * 0.15, 0.12 * w, 0, w * 0.3, w * 0.22], [w * 0.4, 0.08 * w, 0, w * 0.26, w * 0.16, { n: 2.6 }], [w * 0.62, 0.05 * w, 0, w * 0.32, w * 0.16, { n: 2.8 }], [w * 0.72, 0.03 * w, 0, w * 0.2, w * 0.1]], { radial: 14, col, belly }), 0xffffff, 0, 0, 0, { r: 0.6 });
    for (const z of [-1, 1]) { H.add(G.sph(w * 0.07, 8, 6), col, w * 0.05, w * 0.34, z * w * 0.2); H.add(G.sph(w * 0.06, 8, 6), col, w * 0.15, w * 0.32, z * w * 0.15, { sx: 1.2 }); H.add(G.sph(w * 0.03, 6, 4), C.black, w * 0.66, w * 0.18, z * w * 0.12); }
    eyes(H, w * 0.17, w * 0.33, w * 0.15, w * 0.03, 0x3a1a1a, 0.3);
    J.add(loftL('hipjaw', [[0, 0, 0, w * 0.26, w * 0.08, { up: -0.6 }], [w * 0.35, 0, 0, w * 0.3, w * 0.09, { up: -0.6 }], [w * 0.45, 0, 0, w * 0.2, w * 0.05]], { radial: 12, col: belly }), 0xffffff, 0, 0, 0, { r: 0.6 });
    for (const z of [-1, 1]) { J.add(G.cone(w * 0.05, w * 0.22, 5), C.bone, w * 0.36, w * 0.1, z * w * 0.2); J.add(G.cone(w * 0.035, w * 0.12, 5), C.bone, w * 0.42, w * 0.06, z * w * 0.08); }
    J.add(G.box(w * 0.35, 0.02, w * 0.4), 0xb04a5a, w * 0.22, w * 0.02, 0);
    jawAt = [w * 0.3, -w * 0.02]; mouth = [hx + w * 0.7, 0];
  } else {
    const sn = kind === 'boar' ? 0.65 : 0.5;
    H.add(loftL(`${kind}head2`, [[-w * 0.15, 0.05 * w, 0, w * 0.26, w * 0.28], [w * 0.15, 0.1 * w, 0, w * 0.28, w * 0.3], [w * (0.3 + sn * 0.5), 0.02 * w, 0, w * 0.18, w * 0.2], [w * (0.3 + sn), -0.02 * w, 0, w * 0.15, w * 0.14], [w * (0.32 + sn), -0.02 * w, 0, w * 0.04, w * 0.04]], { radial: 14, col, belly }), 0xffffff, 0, 0, 0, { r: 0.7 });
    for (const z of [-1, 1]) {
      eyes(H, w * 0.25, w * 0.22, w * 0.2, w * 0.035, kind === 'boar' ? 0xff4a1a : 0x2a1a10, kind === 'boar' ? 2 : 0.3);
      H.add(G.cone(w * 0.08, w * 0.24, 5), col, w * 0.0, w * 0.38, z * w * 0.15, { rx: -z * 0.4, sx: 0.5 });
      if (kind === 'boar') H.add(taper(`btusk${z}`, [[w * (0.2 + sn * 0.8), -0.08 * w, z * w * 0.12], [w * (0.3 + sn * 0.9), 0.05 * w, z * w * 0.22], [w * (0.25 + sn * 0.8), 0.25 * w, z * w * 0.2]], [w * 0.045, w * 0.005], 8, 5), C.bone, 0, 0, 0, { r: 0.35 });
    }
    if (kind === 'rhino') { H.add(taper('rhorn1', [[w * (0.25 + sn * 0.9), 0.12 * w, 0], [w * (0.3 + sn * 0.95), 0.4 * w, 0], [w * (0.15 + sn * 0.9), 0.68 * w, 0]], [w * 0.11, w * 0.005], 10, 7), C.bone, 0, 0, 0, { r: 0.4 }); H.add(taper('rhorn2', [[w * (0.2 + sn * 0.55), 0.22 * w, 0], [w * (0.18 + sn * 0.55), 0.42 * w, 0]], [w * 0.07, w * 0.005], 6, 6), C.bone); }
    if (kind === 'boar') H.add(G.cyl(w * 0.13, w * 0.13, w * 0.04, 12), 0x8a5a5a, w * (0.33 + sn), -0.02 * w, 0, { rz: PI / 2 });
    J.add(loftL(`${kind}jaw2`, [[0, 0, 0, w * 0.16, w * 0.06, { up: -0.5 }], [w * sn * 0.85, 0, 0, w * 0.1, w * 0.05]], { radial: 10, col: belly }), 0xffffff);
    jawAt = [w * 0.2, -w * 0.1]; mouth = [hx + w * (0.3 + sn), 0];
  }
  // a collar strap round the neck, in harness leather with the realm's metal studs
  H.add(G.tor(w * 0.3, w * 0.035, 5, 16), 0x4a2e1a, -w * 0.12, 0.02 * w, 0, { ry: PI / 2, sy: 1.05 });
  H.detail(1, () => { for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; H.add(G.sph(w * 0.025, 4, 3), st.metal, -w * 0.12, 0.02 * w + Math.sin(a) * w * 0.31, Math.cos(a) * w * 0.31, { m: st.metalM }); } });
  const head = H.mesh(undefined, `tow${kind}head2${f2(w)}${st.id}`); head.position.set(hx, w * 0.22, 0); g.add(head);
  const jaw = J.mesh(undefined, `tow${kind}jaw2${f2(w)}`); jaw.position.set(jawAt[0], jawAt[1], 0); head.add(jaw);
  // legs (or flippers), stroking under the surface
  for (const [fx, z] of [[0.32, 1], [0.32, -1], [-0.32, 1], [-0.32, -1]]) {
    const L = new Kit();
    if (kind === 'turtle') L.add(loftL(`turtflip${fx > 0}`, [[0, 0, 0, w * 0.1, w * 0.06], [w * 0.1, -0.02 * w, z * w * 0.25, w * 0.14, w * 0.04], [w * (fx > 0 ? 0.0 : -0.1), -0.04 * w, z * w * (fx > 0 ? 0.7 : 0.4), w * 0.05, w * 0.02]], { radial: 8, col: belly, lat: [1, 0, 0] }), 0xffffff, 0, 0, 0);
    else {
      L.add(taper(`${kind}leg`, [[0, 0, 0], [0.02 * w, -0.3 * w, 0], [0.06 * w, -0.6 * w, 0]], [w * 0.16, w * 0.12, w * 0.12], 6, 8), col, 0, 0, 0, { r: 0.8 });
      L.add(G.cyl(w * 0.13, w * 0.14, w * 0.1, 10), kind === 'boar' ? C.black : 0x2a221c, 0.06 * w, -0.62 * w, 0);
    }
    const leg = L.mesh(undefined, `tow${kind}leg${fx > 0}${z}${f2(w)}`); leg.position.set(fx * bl, -w * 0.1, z * w * (kind === 'turtle' ? 0.35 : 0.32)); leg.userData.z = z; g.add(leg); legs.push(leg);
  }
  return { group: g, head, body, legs, jaw, collar: [bl * 0.15, back * 0.92], collarR: w * 0.5, mouth: [mouth[0], w * 0.22 + mouth[1]] };
}

export function buildTow(c, kind) {
  const S = SPEC[kind];
  if (!S) return;
  const st = c.st, len = clamp(c.L * S.len, 3, 9), w = clamp(c.B * 0.5, 1.2, 2.4), gap = clamp(c.L * 0.16, 1.4, 2.6);
  const x0 = c.bowX + gap + len / 2, y0 = S.quad ? 0.1 : 0.05;
  const b = S.quad ? paddler(kind, S, len, w, st, c) : swimmer(kind, S, len, w, st);
  b.group.position.set(x0, y0, 0);
  // harness: a padded yoke over the shoulders, a girth strap, and chains of links back to her bow
  const yx = x0 + b.collar[0], yy = y0 + b.collar[1];
  const K = c.kit;
  K.add(G.rbox(0.22, 0.14, w * 1.25, 0.04), C.dark, yx, yy + 0.04, 0);
  K.add(G.tor(b.collarR * 1.02, 0.045, 5, 18, PI), 0x4a2e1a, yx, y0 + 0.02, 0, { ry: PI / 2, sy: (b.collar[1] + 0.04) / b.collarR });
  K.detail(1, () => { for (const z of [-1, 1]) { K.add(G.tor(0.07, 0.018, 4, 10), C.iron, yx, yy + 0.04, z * w * 0.62, { m: 0.55 }); K.add(G.sph(0.05, 6, 4), st.metal, yx, yy + 0.12, z * w * 0.4, { m: st.metalM }); } });
  const by = Math.max(0.5, c.deckAt(c.bowX - 0.4) - 0.2);
  for (const z of [-1, 1]) {
    const a = [yx, yy + 0.04, z * w * 0.62], e = [c.bowX - 0.2, by, z * Math.max(0.25, c.hw(c.bowX - 0.4) * 0.8)];
    K.chain(a, e, 0.25, clamp(c.k * 0.16, 0.12, 0.2), C.iron);
    K.add(G.tor(0.09, 0.025, 4, 10), C.iron, ...e, { m: 0.55 }); // the ring-bolt on her bow
  }
  // a banner on the yoke in the realm's colours
  K.add(G.cyl(0.03, 0.03, 0.8, 5), C.dark, yx, yy + 0.45, 0);
  K.add(clothPanel('yokeflag', (u, v) => [-u * 0.7, (v - 0.5) * 0.45 * (1 - u * 0.3), 1], 0.06, 5, 3), st.cloth, yx, yy + 0.65, 0, { r: 0.85 });
  K.add(G.shape('pennant', [[0, -0.12], [-1, 0], [0, 0.12]]), c.side, yx, yy + 0.92, 0, { sx: 0.7, sy: 1.2 });
  const segs = b.segs, legs = b.legs, jaw = b.jaw, jaw0 = jaw.rotation.z;
  const act = { lunge: 0, gape: 0, flinch: 0 };
  c.addMoving(b.group, (t, ph) => {
    const a = t * S.speed + ph;
    if (segs) segs.forEach((s, i) => {
      const k = i / (segs.length - 1);
      s.position.z = Math.sin(a - i * 0.8) * S.lat * w * k * k * 1.6 + act.flinch * Math.sin(t * 40 + i) * 0.08;
      s.position.y = Math.sin(a * 0.8 - i * 0.7) * S.vert * w * k;
      s.rotation.y = -Math.cos(a - i * 0.8) * S.lat * k * 0.9;
      s.rotation.z = Math.cos(a * 0.8 - i * 0.7) * S.vert * 0.25 * k + (i === 0 ? act.gape * 0.25 : 0);
    });
    if (legs) {
      legs.forEach((l, i) => { l.rotation.z = Math.sin(a * 2 + (i % 2 ? PI : 0) + (i > 1 ? PI / 2 : 0)) * 0.7; if (kind === 'turtle') l.rotation.x = l.userData.z * Math.sin(a * 1.5 + i) * 0.4; });
      b.body.position.y = Math.sin(a * 2) * 0.06 + act.flinch * Math.sin(t * 40) * 0.05;
      b.head.rotation.z = Math.sin(a * 1.3) * 0.08 + act.gape * 0.3;
      b.head.rotation.y = Math.sin(a * 0.7) * 0.12;
    }
    jaw.rotation.z = jaw0 - 0.08 - 0.08 * Math.max(0, Math.sin(a * 0.6)) - act.gape;
    b.group.position.x = x0 + act.lunge;
    act.lunge *= 0.85; act.gape *= 0.85; act.flinch *= 0.85;
  });
  // ram: the beast surges ahead (taking up the chains) jaws wide, and snaps them shut; grapple: a bite; hit: it flinches
  const bite = (k) => { act.gape = k < 0.5 ? (k / 0.5) * 0.6 : Math.max(0, 0.6 - ((k - 0.5) / 0.15) * 0.6); jaw.rotation.z = jaw0 - 0.08 - act.gape; };
  c.action('ram', (k) => { act.lunge = bump(k) * len * 0.12; b.group.position.x = x0 + act.lunge; bite(k); if (k >= 1) act.lunge = act.gape = 0; });
  c.action('grapple', (k) => { bite(k); if (k >= 1) act.gape = 0; });
  c.action('hit', (k) => { act.flinch = bump(k); if (k >= 1) act.flinch = 0; });
  c.anchor('mouth', [x0 + b.mouth[0], y0 + b.mouth[1], 0], 'tow');
  c.anchor('beast', [x0, y0 + w * 0.4, 0], 'tow');
  c.topAt = Math.max(c.topAt || 0, y0 + w * 1.2);
}
