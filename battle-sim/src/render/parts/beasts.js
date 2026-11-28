// Beasts that tow a designed ship: swimming ahead of her bow, harnessed to it by chains.
//   tow:mosasaur  tow:serpent  tow:gator  tow:orca  tow:whale  (long swimmers: the body undulates)
//   tow:turtle    tow:boar     tow:mammoth tow:hippo tow:rhino   (paddlers: head up, legs or flippers stroking)
import * as THREE from 'three';
import { Kit, G, C, shade, blend, clamp, lerp } from './kit.js';

const PI = Math.PI;
const SPEC = {
  mosasaur: { len: 0.72, col: 0x3a5a5a, belly: 0xc8c0a0, segs: 6, lat: 0.35, vert: 0.05, speed: 2.2 },
  serpent: { len: 0.95, col: 0x2a6a5a, belly: 0xd8c88a, segs: 10, lat: 0.45, vert: 0.35, speed: 2.6 },
  gator: { len: 0.6, col: 0x4a5a2a, belly: 0xb8b080, segs: 6, lat: 0.3, vert: 0.02, speed: 2 },
  orca: { len: 0.55, col: 0x121418, belly: 0xf0f0f0, segs: 4, lat: 0.04, vert: 0.22, speed: 2 },
  whale: { len: 0.85, col: 0x3a4a5a, belly: 0xb8c0c0, segs: 5, lat: 0.03, vert: 0.25, speed: 1.2 },
  turtle: { len: 0.42, col: 0x4a6a3a, belly: 0xc8b87a, quad: true, speed: 1.6 },
  boar: { len: 0.4, col: 0x4a3426, belly: 0x6a4a36, quad: true, speed: 2.6 },
  mammoth: { len: 0.48, col: 0x5a3a22, belly: 0x4a3020, quad: true, speed: 1.8 },
  hippo: { len: 0.42, col: 0x7a6a72, belly: 0xc89a9a, quad: true, speed: 2 },
  rhino: { len: 0.42, col: 0x6a6a66, belly: 0x8a8a84, quad: true, speed: 2.2 },
};

/** a long swimmer: head at +x, segments trailing toward -x; returns { group, segs, collar } */
function swimmer(kind, S, len, w) {
  const g = new THREE.Group(), segs = [], n = S.segs, sl = len / (n + 1.2);
  // the head
  const H = new Kit();
  if (kind === 'mosasaur' || kind === 'gator') {
    const hl = sl * (kind === 'gator' ? 1.5 : 1.35), hw = w * (kind === 'gator' ? 0.45 : 0.5);
    H.add(G.box(hl, hw * 0.45, hw), S.col, hl * 0.4, hw * 0.12, 0, { r: 0.6 });
    H.add(G.box(hl * 0.95, hw * 0.22, hw * 0.85), S.belly, hl * 0.42, -hw * 0.2, 0, { rz: -0.12 });
    H.add(G.cone(hw * 0.5, hl * 0.35, 6), S.col, hl * 0.98, hw * 0.08, 0, { rz: -PI / 2, sz: 0.6 });
    const nt = 6;
    for (const z of [-1, 1]) {
      for (let i = 0; i < nt; i++) H.add(G.cone(hw * 0.05, hw * 0.18, 4), C.bone, hl * (0.15 + (0.75 * i) / nt), -hw * 0.06, z * hw * 0.42, { rz: PI });
      H.add(G.sph(hw * 0.11, 6, 4), 0xffd23a, hl * 0.1, hw * 0.4, z * hw * 0.35, { g: 2.2 });
    }
  } else if (kind === 'serpent') {
    const hl = sl * 1.2;
    H.add(G.sph(w * 0.42, 8, 6), S.col, 0.1, 0.1, 0, { sx: 1.6, sy: 0.8 }).add(G.cone(w * 0.3, hl * 0.6, 6), S.col, hl * 0.6, 0.05, 0, { rz: -PI / 2, sz: 0.7 });
    for (const z of [-1, 1]) { H.add(G.sph(w * 0.08, 6, 4), 0xffd23a, hl * 0.25, w * 0.25, z * w * 0.25, { g: 2.5 }); H.add(G.shape('frill', [[0, 0], [-0.6, 0.9], [-0.9, 0.2]], 0.04), blend(S.col, 0xd84a2a, 0.5), -0.1, 0.15, z * w * 0.3, { s: w * 0.9, ry: z * 0.6 }); }
    for (let i = 0; i < 3; i++) H.add(G.cone(w * 0.08, w * 0.4, 4), C.bone, -i * 0.2, w * 0.4, 0, { rz: 0.7 });
  } else if (kind === 'orca') {
    H.add(G.sph(w * 0.5, 10, 6), S.col, 0, 0, 0, { sx: 1.8, sy: 0.85 });
    H.add(G.sph(w * 0.34, 8, 6), S.belly, w * 0.35, -w * 0.18, 0, { sx: 1.8, sy: 0.6 });
    for (const z of [-1, 1]) H.add(G.sph(w * 0.12, 6, 4), S.belly, w * 0.3, w * 0.18, z * w * 0.36, { sx: 1.8, sy: 0.6 });
  } else if (kind === 'whale') {
    H.add(G.box(sl * 1.5, w * 0.9, w * 1.0), S.col, sl * 0.2, 0, 0, { r: 0.6 }).add(G.sph(w * 0.5, 8, 6), S.col, sl * 0.95, 0, 0, { sx: 0.5, sy: 0.9 });
    for (let i = 0; i < 5; i++) H.add(G.box(sl * 1.2, 0.03, w * 0.9), S.belly, sl * 0.15, -w * 0.42 + i * 0.04, 0);
    for (const z of [-1, 1]) H.add(G.sph(w * 0.07, 6, 4), C.black, sl * 0.6, w * 0.05, z * w * 0.5);
  }
  const head = H.mesh(); head.position.x = len / 2 - sl * 0.6; g.add(head); segs.push(head);
  // the body, tapering to the tail
  for (let i = 0; i < n; i++) {
    const K = new Kit(), t = i / (n - 1), r = w * 0.5 * (kind === 'whale' || kind === 'orca' ? lerp(1.05, 0.35, t * t) : lerp(0.9, 0.28, t));
    K.add(G.sph(r, 10, 7), S.col, 0, 0, 0, { sx: (sl / r) * 1.05, sy: kind === 'gator' ? 0.55 : 0.85 });
    K.add(G.sph(r * 0.85, 8, 5), S.belly, 0, -r * 0.3, 0, { sx: (sl / r) * 1.0, sy: 0.5 });
    if (kind === 'gator' || kind === 'mosasaur') for (const z of [-0.4, 0.4, 0]) K.add(G.cone(r * 0.14, r * 0.35, 4), shade(S.col, 0.7), 0, r * (kind === 'gator' ? 0.48 : 0.75), z * r * (kind === 'gator' ? 1 : 0.2), { s: z ? 1 : 1.3 });
    if (kind === 'serpent' && i % 2 === 0) K.add(G.cone(r * 0.2, r * 0.8, 4), blend(S.col, 0xd84a2a, 0.5), 0, r * 0.95, 0, { rz: 0.4 });
    if (kind === 'orca' && i === 0) K.add(G.shape('orcafin', [[-0.6, 0], [0.2, 0], [-0.4, 1]], 0.06), S.col, 0, r * 0.75, 0, { s: w * 1.1 });
    if (kind === 'orca' && i === 1) K.add(G.sph(r * 0.5, 6, 4), S.belly, r * 0.3, r * 0.5, 0, { sx: 1.8, sy: 0.4 });
    if (kind === 'whale' && i < 2) for (let k = 0; k < 3; k++) K.add(G.sph(r * 0.08, 4, 3), 0xd8d8c8, (k - 1) * r * 0.4, r * 0.8, (k % 2 - 0.5) * r * 0.6);
    // limbs and fins
    if ((kind === 'mosasaur' || kind === 'whale' || kind === 'orca') && (i === 0 || (kind === 'mosasaur' && i === 2))) for (const z of [-1, 1]) K.add(G.sph(r * 0.7, 6, 4), shade(S.col, 0.85), -r * 0.2, -r * 0.35, z * r * 1.15, { sx: 1.3, sy: 0.15, sz: 0.6, ry: z * 0.5 });
    if (kind === 'gator' && (i === 0 || i === 2)) for (const z of [-1, 1]) K.add(G.cyl(r * 0.18, r * 0.14, r * 1.0, 5), S.col, 0, -r * 0.3, z * r * 1.05, { rx: z * 1.0 });
    if (i === n - 1) {
      if (kind === 'mosasaur' || kind === 'gator') K.add(G.shape('tailfin', [[0, 0], [-1, 0.5], [-0.8, 0], [-1, -0.3]], 0.05), S.col, -r, 0, 0, { s: w * (kind === 'gator' ? 0.5 : 0.9) });
      if (kind === 'whale' || kind === 'orca') K.add(G.shape('fluke', [[0, 0], [-0.6, 1], [-0.35, 0], [-0.6, -1]], 0.05), S.col, -r * 0.8, 0, 0, { s: w * (kind === 'whale' ? 0.9 : 0.7), rx: PI / 2 });
      if (kind === 'serpent') K.add(G.cone(r * 0.6, sl * 1.2, 5), S.col, -sl * 0.6, 0, 0, { rz: PI / 2 });
    }
    const m = K.mesh(); m.position.x = len / 2 - sl * (i + 1.4); g.add(m); segs.push(m);
  }
  return { group: g, segs, collar: [len / 2 - sl * 1.4, w * 0.35] };
}

/** a paddler: body with its back out of the water, head up, legs stroking below; returns { group, head, legs, collar } */
function paddler(kind, S, len, w) {
  const g = new THREE.Group(), K = new Kit(), legs = [];
  const bl = len * 0.62, bh = w * 0.5;
  if (kind === 'turtle') {
    K.add(G.hemi(w * 0.6, 12, 5), S.col, 0, -0.05, 0, { sx: (bl / w) * 1.2, sy: 0.65, r: 0.6 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; K.add(G.hemi(w * 0.17, 6, 3), shade(S.col, 0.75), Math.cos(a) * bl * 0.3, w * 0.28, Math.sin(a) * w * 0.3, { sy: 0.4 }); }
    K.add(G.hemi(w * 0.2, 6, 3), shade(S.col, 0.75), 0, w * 0.34, 0, { sy: 0.4 });
    K.add(G.cyl(w * 0.6, w * 0.6, 0.06, 14), S.belly, 0, -0.06, 0, { sx: (bl / w) * 1.2 });
  } else {
    K.add(G.sph(w * 0.5, 10, 7), S.col, 0, 0, 0, { sx: bl / w, sy: kind === 'hippo' ? 0.8 : 0.9, r: kind === 'mammoth' ? 1 : 0.7 });
    if (kind === 'mammoth') { K.add(G.sph(w * 0.42, 9, 6), shade(S.col, 1.15), bl * 0.18, w * 0.28, 0, { sx: 1.2, sy: 0.8, r: 1 }); for (let i = 0; i < 9; i++) K.add(G.cone(w * 0.08, w * 0.4, 4), shade(S.col, 0.8), (i - 4) * bl * 0.1, -w * 0.05, (i % 2 ? 1 : -1) * w * 0.48, { rx: (i % 2 ? -1 : 1) * 2.6 }); }
    if (kind === 'boar') for (let i = 0; i < 7; i++) K.add(G.cone(w * 0.06, w * 0.35, 4), C.black, bl * 0.32 - i * bl * 0.1, w * 0.45, 0, { rz: 0.6 });
    if (kind === 'rhino') for (let i = 0; i < 3; i++) K.add(G.tor(w * 0.48, w * 0.04, 4, 12), shade(S.col, 0.75), bl * (0.2 - i * 0.2), 0, 0, { ry: PI / 2, sy: 0.9 });
  }
  const body = K.mesh(); g.add(body);
  // the head
  const H = new Kit(), hx = bl * 0.5 + w * 0.1;
  if (kind === 'turtle') {
    H.add(G.sph(w * 0.24, 8, 6), S.belly, w * 0.2, 0, 0, { sx: 1.5 }).add(G.cone(w * 0.12, w * 0.22, 5), shade(S.belly, 0.6), w * 0.52, -0.02, 0, { rz: -PI / 2 - 0.4 });
    for (const z of [-1, 1]) H.add(G.sph(w * 0.05, 5, 4), 0xffd23a, w * 0.38, w * 0.1, z * w * 0.13, { g: 2 });
  } else if (kind === 'mammoth') {
    H.add(G.sph(w * 0.36, 9, 6), S.col, w * 0.15, w * 0.15, 0, { r: 1 });
    H.add(G.tube('trunk', [[0.4, 0.1, 0], [0.75, -0.05, 0], [1.0, 0.3, 0], [1.05, 0.75, 0]], 0.1, 12, 6), S.col, 0, 0, 0, { s: w, r: 1 });
    for (const z of [-1, 1]) { H.add(G.tube('tusk', [[0.3, -0.1, 0.15], [0.7, -0.25, 0.32], [1.0, 0.05, 0.38], [1.05, 0.35, 0.25]], 0.05, 10, 5), C.bone, 0, 0, 0, { s: w, sz: z * w }); H.add(G.sph(w * 0.3, 7, 5), shade(S.col, 0.8), -w * 0.05, w * 0.2, z * w * 0.33, { sx: 0.3 }); }
  } else if (kind === 'hippo') {
    H.add(G.box(w * 0.7, w * 0.45, w * 0.62), S.col, w * 0.3, w * 0.12, 0, { r: 0.6 }).add(G.box(w * 0.5, w * 0.12, w * 0.55), S.belly, w * 0.55, -w * 0.12, 0, { rz: -0.3 });
    for (const z of [-1, 1]) { H.add(G.sph(w * 0.08, 6, 4), S.col, w * 0.1, w * 0.4, z * w * 0.22); H.add(G.sph(w * 0.05, 5, 4), C.black, w * 0.35, w * 0.33, z * w * 0.2); H.add(G.cone(w * 0.05, w * 0.18, 4), C.bone, w * 0.58, w * 0.0, z * w * 0.22); }
  } else {
    const snout = kind === 'boar' ? 0.65 : 0.5;
    H.add(G.sph(w * 0.3, 8, 6), S.col, w * 0.15, w * 0.1, 0, { sx: 1.4 }).add(G.cyl(w * 0.16, w * 0.22, w * snout, 7), S.col, w * (0.35 + snout / 2), w * 0.02, 0, { rz: PI / 2 + 0.15 });
    for (const z of [-1, 1]) {
      H.add(G.sph(w * 0.05, 5, 4), kind === 'boar' ? 0xff4a1a : 0x1a1a1a, w * 0.3, w * 0.25, z * w * 0.18, { g: kind === 'boar' ? 2 : 0 });
      H.add(G.cone(w * 0.08, w * 0.22, 4), S.col, w * 0.02, w * 0.38, z * w * 0.15, { rx: -z * 0.3 });
      if (kind === 'boar') H.add(G.cone(w * 0.04, w * 0.35, 5), C.bone, w * (0.4 + snout * 0.7), w * 0.05, z * w * 0.16, { rz: 0.5, rx: -z * 0.5 });
    }
    if (kind === 'rhino') { H.add(G.cone(w * 0.1, w * 0.55, 6), C.bone, w * (0.4 + snout * 0.85), w * 0.3, 0, { rz: -0.35 }); H.add(G.cone(w * 0.07, w * 0.28, 6), C.bone, w * (0.4 + snout * 0.5), w * 0.3, 0, { rz: -0.2 }); }
    if (kind === 'boar') H.add(G.cyl(w * 0.1, w * 0.1, w * 0.04, 8), 0x8a5a5a, w * (0.35 + snout), w * 0.0, 0, { rz: PI / 2 });
  }
  const head = H.mesh(); head.position.set(hx, w * 0.22, 0); g.add(head);
  // legs (or flippers), stroking under the surface
  for (const [fx, z] of [[0.32, 1], [0.32, -1], [-0.32, 1], [-0.32, -1]]) {
    const L = new Kit();
    if (kind === 'turtle') L.add(G.sph(w * 0.4, 6, 4), S.belly, w * 0.1, 0, z * w * 0.4, { sx: 0.8, sy: 0.12, sz: 1.1 });
    else L.add(G.cyl(w * 0.13, w * 0.1, w * 0.6, 6), S.col, 0, -w * 0.3, 0).add(G.sph(w * 0.12, 5, 4), C.dark, 0, -w * 0.6, 0);
    const leg = L.mesh(); leg.position.set(fx * bl, -w * 0.1, z * w * (kind === 'turtle' ? 0.35 : 0.32)); leg.userData.z = z; g.add(leg); legs.push(leg);
  }
  return { group: g, head, body, legs, collar: [bl * 0.15, w * 0.45] };
}

export function buildTow(c, kind) {
  const S = SPEC[kind];
  if (!S) return;
  const len = clamp(c.L * S.len, 3, 9), w = clamp(c.B * 0.5, 1.2, 2.4), gap = clamp(c.L * 0.16, 1.4, 2.6);
  const x0 = c.bowX + gap + len / 2, y0 = S.quad ? 0.1 : 0.05;
  const b = S.quad ? paddler(kind, S, len, w) : swimmer(kind, S, len, w);
  b.group.position.set(x0, y0, 0);
  // harness: a yoke over the shoulders and chains back to her bow
  const yx = x0 + b.collar[0], yy = y0 + b.collar[1];
  c.kit.add(G.cyl(0.07, 0.07, w * 1.2, 6), C.dark, yx, yy, 0, { rx: PI / 2 });
  c.kit.add(G.tor(w * 0.5, 0.05, 4, 14, PI), C.iron, yx, yy - 0.1, 0, { ry: PI / 2, m: 0.7 });
  const by = Math.max(0.5, c.deckAt(c.bowX - 0.4) - 0.2);
  for (const z of [-1, 1]) c.kit.rope([yx, yy, z * w * 0.55], [c.bowX - 0.2, by, z * Math.max(0.25, c.hw(c.bowX - 0.4) * 0.8)], 0.25, 0.04, C.iron, { m: 0.75, r: 0.4 });
  c.kit.add(G.cyl(0.03, 0.03, 0.7, 4), C.dark, yx, yy + 0.35, 0).add(G.shape('pennant', [[0, -0.12], [-1, 0], [0, 0.12]]), c.side, yx, yy + 0.6, 0, { sx: 0.7, sy: 1.2 }); // a pennant on the yoke
  const segs = b.segs, legs = b.legs;
  c.addMoving(b.group, (t, ph) => {
    const a = t * S.speed + ph;
    if (segs) segs.forEach((s, i) => {
      const k = i / (segs.length - 1);
      s.position.z = Math.sin(a - i * 0.8) * S.lat * w * k * k * 1.6;
      s.position.y = Math.sin(a * 0.8 - i * 0.7) * S.vert * w * k;
      s.rotation.y = -Math.cos(a - i * 0.8) * S.lat * k * 0.9;
      s.rotation.z = Math.cos(a * 0.8 - i * 0.7) * S.vert * 0.25 * k;
    });
    if (legs) {
      legs.forEach((l, i) => { l.rotation.z = Math.sin(a * 2 + (i % 2 ? PI : 0) + (i > 1 ? PI / 2 : 0)) * 0.7; if (kind === 'turtle') l.rotation.x = l.userData.z * Math.sin(a * 1.5 + i) * 0.4; });
      b.body.position.y = Math.sin(a * 2) * 0.06;
      b.head.rotation.z = Math.sin(a * 1.3) * 0.08;
      b.head.rotation.y = Math.sin(a * 0.7) * 0.12;
    }
  });
}
