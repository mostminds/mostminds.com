// The bow of a designed ship: rams, drills, jaws, blades, armour, ramps, bow guns and figureheads.
import * as THREE from 'three';
import { Kit, G, C, shade, blend, clamp } from './kit.js';

/** where the stem is: x of the bow, deck height just behind it */
const stem = (c) => ({ x: c.bowX, y: Math.max(0.4, c.deckAt(c.bowX - c.L * 0.05)), hy: Math.max(0.35, c.dy * 0.55) });

/** an upper or lower jaw seen from the side (profile in xy, extruded across z) with teeth along its edge */
function jaw(K, len, w, up, col, tooth) {
  const pts = up ? [[0, 0], [1, 0], [0.86, 0.2], [0.25, 0.34], [0, 0.32]] : [[0, 0], [0.94, 0], [0.8, -0.13], [0, -0.24]];
  K.add(G.shape(`jaw${up}`, pts, 1), col, 0, 0, 0, { sx: len, sy: len, sz: w, r: 0.6 });
  K.add(G.box(len * 0.9, 0.02, w * 0.8), 0x6a1010, len * 0.45, up ? -0.012 : 0.012, 0, { g: 0.3 });
  const n = Math.max(4, Math.round(len / 0.22));
  for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
    const x = len * (0.15 + (0.8 * i) / n), h = len * (0.09 + 0.05 * ((i % 2) + (i === n - 1 ? 1 : 0)));
    K.add(G.cone(h * 0.32, h, 4), tooth, x, up ? -h / 2 : h / 2, s * w * 0.4, { rz: up ? Math.PI : 0 });
  }
  if (up) for (const s of [-1, 1]) {
    K.add(G.sph(len * 0.07, 8, 6), 0xffd23a, len * 0.4, len * 0.26, s * w * 0.42, { g: 2.2 });
    K.add(G.cone(len * 0.07, len * 0.3, 5), tooth, len * 0.25, len * 0.38, s * w * 0.35, { rz: 0.9, rx: -s * 0.3 });
  }
}

/** a figurehead, built in the kit's current frame: base at the origin, facing +x, about 1.6 tall */
function figure(K, kind, c) {
  const gilt = c.trimC, g = { m: 0.55, r: 0.4 };
  switch (kind) {
    case 'dragon': {
      const col = blend(gilt, 0x2a8a4a, 0.4);
      K.add(G.tube('dragneck', [[0, 0, 0], [0.25, 0.5, 0], [0.2, 1.0, 0], [0.45, 1.35, 0]], 0.16, 12, 6), col, 0, 0, 0, g);
      K.push(0.55, 1.4, 0, 0, 0, -0.25);
      K.add(G.box(0.55, 0.26, 0.32), col, 0.1, 0, 0, g).add(G.box(0.45, 0.1, 0.26), col, 0.15, -0.18, 0, { ...g, rz: -0.25 });
      for (const s of [-1, 1]) { K.add(G.cone(0.06, 0.5, 5), C.bone, -0.2, 0.25, s * 0.1, { rz: 1.1 }); K.add(G.sph(0.045, 6, 4), 0xff3a1a, 0.18, 0.08, s * 0.16, { g: 2.5 }); }
      for (let i = 0; i < 4; i++) K.add(G.cone(0.05, 0.12, 4), C.bone, 0.3 - i * 0.04, -0.08, 0.1 - (i % 2) * 0.2, { rz: Math.PI });
      K.pop();
      for (let i = 0; i < 4; i++) K.add(G.cone(0.08, 0.3, 4), shade(col, 0.7), 0.05 + i * 0.08, 0.3 + i * 0.28, 0, { rz: 0.6 });
      break;
    }
    case 'wolf': case 'tiger': case 'boar': {
      const col = kind === 'tiger' ? 0xd8842a : kind === 'boar' ? 0x5a3a2a : blend(gilt, 0x8a8a8a, 0.4);
      K.add(G.tube(`${kind}neck`, [[0, 0, 0], [0.2, 0.5, 0], [0.4, 0.95, 0]], 0.22, 8, 6), col, 0, 0, 0, { r: 0.6 });
      K.push(0.45, 1.05, 0);
      K.add(G.sph(0.32, 8, 6), col, 0, 0, 0, { sx: 1.1, sy: 0.9, r: 0.6 });
      const sn = kind === 'boar' ? 0.42 : kind === 'wolf' ? 0.48 : 0.28;
      K.add(G.box(sn, 0.2, 0.24), col, 0.25 + sn / 2, -0.06, 0, { r: 0.6 });
      K.add(G.box(sn * 0.9, 0.08, 0.2), shade(col, 0.8), 0.22 + sn / 2, -0.22, 0, { rz: -0.3 });
      K.add(G.sph(0.06, 6, 4), C.black, 0.25 + sn, -0.02, 0);
      for (const s of [-1, 1]) {
        K.add(G.sph(0.05, 6, 4), kind === 'wolf' ? 0xffd23a : 0xff5a1a, 0.26, 0.1, s * 0.17, { g: 2.2 });
        if (kind !== 'boar') K.add(G.cone(0.09, 0.26, 4), col, -0.05, 0.32, s * 0.16, { rx: -s * 0.2 });
        else { K.add(G.cone(0.04, 0.3, 5), C.bone, 0.4 + sn * 0.5, -0.1, s * 0.14, { rz: 0.4, rx: -s * 0.5 }); K.add(G.cone(0.08, 0.16, 4), col, -0.1, 0.28, s * 0.18, { rz: 0.5 }); }
        if (kind === 'wolf') for (let i = 0; i < 2; i++) K.add(G.cone(0.035, 0.12, 4), C.bone, 0.3 + sn * 0.7 + i * 0.06, -0.16, s * 0.08, { rz: Math.PI });
      }
      if (kind === 'tiger') for (let i = 0; i < 4; i++) K.add(G.box(0.05, 0.05, 0.62), C.black, -0.18 + i * 0.13, 0.12 + (i % 2) * 0.06, 0, { rz: 0.5 });
      if (kind === 'boar') for (let i = 0; i < 5; i++) K.add(G.cone(0.05, 0.22, 4), C.black, -0.2 + i * 0.06, 0.3 - i * 0.02, 0, { rz: 0.7 });
      K.pop();
      break;
    }
    case 'cobra': {
      const col = blend(gilt, 0x2a6a3a, 0.2);
      K.add(G.tube('cobraneck', [[0, 0, 0], [0.3, 0.35, 0], [0.15, 0.9, 0], [0.3, 1.3, 0]], 0.13, 12, 6), col, 0, 0, 0, g);
      K.add(G.sph(0.5, 10, 6), col, 0.2, 1.15, 0, { sx: 0.25, sy: 1.0, sz: 1.0, ...g });
      K.add(G.sph(0.42, 8, 6), 0x1a3a7a, 0.25, 1.15, 0, { sx: 0.2, sy: 0.8, sz: 0.75, m: 0.3, r: 0.5 });
      K.push(0.42, 1.48, 0);
      K.add(G.sph(0.17, 8, 6), col, 0, 0, 0, { sx: 1.5, sy: 0.7, ...g });
      for (const s of [-1, 1]) { K.add(G.sph(0.04, 6, 4), 0xff2a1a, 0.12, 0.07, s * 0.1, { g: 2.5 }); K.add(G.cone(0.025, 0.16, 4), C.bone, 0.2, -0.12, s * 0.05, { rz: Math.PI }); }
      K.pop();
      break;
    }
    case 'horse': {
      const col = blend(gilt, 0xf0ead8, 0.15);
      K.add(G.tube('horseneck', [[0, 0, 0], [0.1, 0.6, 0], [0.35, 1.1, 0]], 0.2, 10, 6), col, 0, 0, 0, g);
      K.push(0.45, 1.2, 0, 0, 0, -0.75);
      K.add(G.box(0.7, 0.24, 0.24), col, 0.3, 0, 0, g).add(G.box(0.25, 0.28, 0.22), col, 0.62, -0.02, 0, g);
      for (const s of [-1, 1]) { K.add(G.cone(0.05, 0.2, 4), col, -0.02, 0.2, s * 0.08, { rz: 0.4 }); K.add(G.sph(0.035, 6, 4), C.black, 0.2, 0.06, s * 0.12); }
      K.pop();
      for (let i = 0; i < 6; i++) K.add(G.box(0.12, 0.2, 0.06), c.side, -0.08 + i * 0.07, 0.2 + i * 0.17, 0, { rz: 0.4 });
      break;
    }
    case 'scarab': {
      K.add(G.hemi(0.5, 10, 5), 0x1a4a5a, 0.1, 0.25, 0, { sx: 1.3, sy: 0.7, m: 0.8, r: 0.25 });
      K.add(G.box(1.2, 0.04, 0.04), gilt, 0.1, 0.42, 0, { m: 0.8 });
      K.add(G.sph(0.2, 8, 6), 0x1a4a5a, 0.72, 0.3, 0, { m: 0.8, r: 0.25 });
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) K.bar([0.3 - i * 0.3, 0.3, s * 0.3], [0.45 - i * 0.35, 0.05, s * 0.7], 0.035, gilt, { m: 0.8 });
      K.bar([0.8, 0.4, 0], [0.9, 0.9, 0], 0.05, gilt, { m: 0.8 });
      K.add(G.sph(0.32, 12, 8), 0xffb02a, 0.9, 1.15, 0, { g: 1.6, m: 0.5 });
      break;
    }
    case 'swan': {
      const w = 0xf4f0e8;
      K.add(G.tube('swanneck', [[0, 0, 0], [0.4, 0.4, 0], [0.1, 1.0, 0], [0.35, 1.45, 0]], 0.12, 14, 6), w, 0, 0, 0, { r: 0.5 });
      K.add(G.sph(0.16, 8, 6), w, 0.4, 1.5, 0, { sx: 1.4 });
      K.add(G.cone(0.07, 0.3, 6), 0xe87a1a, 0.66, 1.46, 0, { rz: -Math.PI / 2 - 0.3 });
      for (const s of [-1, 1]) K.add(G.sph(0.6, 8, 6), w, -0.5, 0.15, s * 0.32, { sx: 1.2, sy: 0.3, sz: 0.35, ry: s * 0.25, rz: 0.35, r: 0.5 });
      break;
    }
    case 'eagle': {
      K.add(G.tube('eagleneck', [[0, 0, 0], [0.2, 0.5, 0], [0.35, 0.95, 0]], 0.2, 8, 6), gilt, 0, 0, 0, g);
      K.add(G.sph(0.26, 8, 6), 0xf4f0e8, 0.42, 1.05, 0, { sx: 1.2 });
      K.add(G.cone(0.1, 0.34, 6), 0xe8b02a, 0.72, 0.98, 0, { rz: -Math.PI / 2 - 0.6 });
      for (const s of [-1, 1]) {
        K.add(G.sph(0.04, 6, 4), 0xffc21a, 0.58, 1.12, s * 0.15, { g: 2 });
        K.add(G.shape('wing', [[0, 0], [-1.3, 0.9], [-1.5, 0.5], [-1.4, 0.2], [-1.2, -0.1], [-0.4, -0.2]], 0.06), gilt, 0.1, 0.55, s * 0.28, { ...g, ry: s * 0.5 });
      }
      break;
    }
    case 'skull': {
      K.add(G.sph(0.55, 10, 8), C.bone, 0.2, 0.8, 0, { sy: 0.9, r: 0.7 });
      K.add(G.box(0.45, 0.25, 0.5), C.bone, 0.38, 0.35, 0, { r: 0.7 });
      for (const s of [-1, 1]) { K.add(G.sph(0.15, 8, 6), C.black, 0.6, 0.85, s * 0.2); K.add(G.sph(0.05, 6, 4), 0x6aff8a, 0.7, 0.85, s * 0.2, { g: 3 }); }
      K.add(G.cone(0.08, 0.16, 3), C.black, 0.72, 0.62, 0, { rz: Math.PI });
      for (let i = 0; i < 5; i++) K.add(G.box(0.05, 0.12, 0.06), 0xf0ead8, 0.62, 0.5, -0.16 + i * 0.08);
      break;
    }
    case 'eye': {
      const flesh = blend(c.hullC, C.flesh, 0.5);
      K.add(G.tube('eyestalk', [[0, 0, 0], [0.2, 0.45, 0], [0.35, 0.8, 0]], 0.25, 8, 6), flesh, 0, 0, 0, { r: 0.5 });
      K.add(G.sph(0.62, 10, 8), flesh, 0.45, 1.05, 0, { r: 0.5 });
      K.add(G.sph(0.52, 12, 8), 0xf4eedc, 0.62, 1.05, 0, { r: 0.25 });
      K.add(G.circle(0.26, 16), 0x3aff6a, 1.14, 1.05, 0, { ry: Math.PI / 2, g: 2.5 });
      K.add(G.circle(0.12, 12), C.black, 1.15, 1.05, 0, { ry: Math.PI / 2 });
      K.add(G.tor(0.56, 0.08, 5, 14, Math.PI), flesh, 0.62, 1.05, 0, { ry: Math.PI / 2, rx: 0.3 });
      for (let i = 0; i < 3; i++) K.add(G.sph(0.05, 5, 4), C.slime, 0.95, 0.6 - i * 0.18, (i - 1) * 0.12, { g: 1.5 });
      break;
    }
    case 'frog': {
      const col = 0x5a8a3a;
      K.add(G.sph(0.6, 10, 6), col, 0.25, 0.55, 0, { sx: 1.1, sy: 0.55, sz: 1.2, r: 0.5 });
      for (const s of [-1, 1]) { K.add(G.sph(0.2, 8, 6), col, 0.25, 0.9, s * 0.4); K.add(G.sph(0.14, 8, 6), 0xffd23a, 0.36, 0.95, s * 0.42, { g: 1.2 }); K.add(G.box(0.04, 0.12, 0.05), C.black, 0.5, 0.95, s * 0.42); }
      K.add(G.box(0.05, 0.04, 1.1), 0x2a1a1a, 0.88, 0.5, 0, { rz: -0.2 });
      for (let i = 0; i < 6; i++) K.add(G.sph(0.06, 5, 4), C.slime, 0.4 + (i % 3) * 0.1, 0.75, -0.3 + i * 0.12, { g: 0.5 });
      break;
    }
    case 'comet': {
      K.add(G.ico(0.38, 1), 0xffe08a, 0.4, 1.2, 0, { g: 2.5 });
      for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.22; K.add(G.cone(0.2 - Math.abs(i - 2) * 0.04, 1.6, 6), i % 2 ? 0xffb02a : 0xffe08a, -0.35, 1.2 + a * 1.4, a * 0.8, { rz: Math.PI / 2 + a * 0.4, g: 1.4 }); }
      K.bar([0, 0, 0], [0.4, 1.0, 0], 0.1, gilt, { m: 0.8 });
      break;
    }
    case 'fish': {
      const col = blend(gilt, 0x3a8aaa, 0.4);
      K.push(0.2, 0.7, 0, 0, 0, 0.7);
      K.add(G.sph(0.4, 10, 6), col, 0, 0, 0, { sx: 1.6, sy: 0.75, sz: 0.5, m: 0.6, r: 0.35 });
      K.add(G.shape('fishtail', [[0, 0], [-0.5, 0.4], [-0.4, 0], [-0.5, -0.4]], 0.05), col, -0.55, 0, 0, { m: 0.6 });
      K.add(G.shape('fishfin', [[0.3, 0], [-0.2, 0.35], [-0.3, 0]], 0.04), shade(col, 0.8), 0, 0.25, 0);
      for (const s of [-1, 1]) K.add(G.sph(0.06, 6, 4), C.black, 0.45, 0.08, s * 0.16);
      K.pop();
      break;
    }
    default: return false;
  }
  return true;
}

export const BOW_PARTS = {
  figure(c, kind) {
    const s = stem(c), sc = clamp(c.B * 0.32, 0.8, 1.6);
    c.kit.push(s.x - 0.2 * sc, s.y + 0.1, 0, 0, 0, -0.25, sc);
    figure(c.kit, kind, c);
    c.kit.pop();
    c.topAt = Math.max(c.topAt || 0, s.y + 2 * sc);
  },
  ram(c) {
    const s = stem(c), l = clamp(c.L * 0.17, 1.2, 2.6), r = clamp(c.B * 0.1, 0.22, 0.5), col = c.def.kind === 'dreadnought' || c.hullC < 0x404040 ? c.trimC : C.bronze;
    c.kit.push(s.x - 0.25, Math.min(0.25, s.hy * 0.4), 0);
    c.kit.add(G.cone(r, l, 6), col, l / 2, 0, 0, { rz: -Math.PI / 2, sx: 1, sz: 0.7, m: 0.75, r: 0.35 });
    for (const yy of [-1, 0, 1]) c.kit.add(G.box(l * 0.55, 0.05, r * 1.6 - Math.abs(yy) * r * 0.5), col, l * 0.3, yy * r * 0.55, 0, { m: 0.75, r: 0.35 });
    c.kit.add(G.cyl(r * 1.3, r * 1.3, 0.12, 8), col, 0.05, 0, 0, { rz: Math.PI / 2, m: 0.75 });
    if (c.def.kind === 'dreadnought' || c.has('figure:horse')) void 0;
    // a bull's head on her ram if she is a fire-forge monitor
    if (c.def.realm === 'ashur') { c.kit.add(G.sph(r * 1.2, 8, 6), C.bronze, 0.1, r * 1.8, 0, { m: 0.8, r: 0.3 }); for (const z of [-1, 1]) c.kit.add(G.cone(r * 0.3, r * 2.2, 5), C.bone, 0.1, r * 2.6, z * r * 1.2, { rx: z * 1.0 }); }
    c.kit.pop();
  },
  drill(c) {
    const s = stem(c), len = clamp(c.L * 0.3, 2, 4.4), r = clamp(c.B * 0.2, 0.5, 1.05), y = Math.max(r * 0.8, s.hy);
    const K = new Kit(), col = C.steel;
    K.add(G.cone(r, len, 12), col, 0, len / 2, 0, { m: 0.85, r: 0.35 });
    const pts = [];
    for (let i = 0; i <= 48; i++) { const t = i / 48, a = t * Math.PI * 2 * 3.5, rr = r * (1 - t) + 0.04; pts.push([Math.cos(a) * rr, t * len, Math.sin(a) * rr]); }
    K.add(G.tube(`drill${r.toFixed(2)},${len.toFixed(2)}`, pts, r * 0.11, 64, 4), shade(col, 1.25), 0, 0, 0, { m: 0.9, r: 0.3 });
    const mesh = K.mesh(); const pivot = new THREE.Group(); pivot.add(mesh); mesh.rotation.z = -Math.PI / 2; pivot.position.set(s.x + 0.1, y, 0);
    c.addMoving(pivot, (t) => { mesh.rotation.y = t * 7; });
    // the collar and the boiler struts that hold her
    c.kit.add(G.cyl(r * 1.15, r * 1.15, 0.4, 12), C.iron, s.x - 0.1, y, 0, { rz: Math.PI / 2, m: 0.6 });
    c.kit.add(G.tor(r * 1.15, 0.08, 4, 14), c.trimC, s.x + 0.1, y, 0, { ry: Math.PI / 2, m: 0.7 });
    for (const z of [-1, 1]) c.kit.bar([s.x - 0.1, y, z * r * 0.9], [s.x - c.L * 0.12, s.y, z * c.hw(s.x - c.L * 0.12) * 0.7], 0.08, C.iron, { m: 0.6 });
  },
  jaws(c) {
    const s = stem(c), len = clamp(c.L * 0.24, 1.6, 3.2), w = clamp(c.B * 0.62, 1.2, 2.6), hx = s.x - len * 0.35, hy = Math.max(0.5, s.hy);
    const col = blend(c.hullC, 0x6a2a2a, 0.3), tooth = C.bone;
    c.kit.push(hx, hy, 0, 0, 0, 0.18); jaw(c.kit, len, w, true, col, tooth); c.kit.pop();
    const K = new Kit(); jaw(K, len, w * 0.92, false, col, tooth);
    const lower = K.mesh(); lower.position.set(hx, hy, 0);
    c.addMoving(lower, (t, ph) => { lower.rotation.z = -0.12 - 0.3 * Math.max(0, Math.sin(t * 1.3 + ph)); });
  },
  blade(c) {
    const s = stem(c), h = Math.max(1, s.y + 0.3), l = clamp(c.L * 0.2, 1.4, 3);
    const pts = [[0, 0], [l * 0.55, h * 0.1], [l, h * 0.55], [l * 0.75, h * 0.35], [l * 0.3, h * 0.5], [0, h * 0.75]];
    c.kit.add(G.shape('bowblade', pts.map(([x, y]) => [x / l, y / h]), 0.07), C.steel, s.x - l * 0.25, 0.05, 0, { sx: l, sy: h, m: 0.95, r: 0.2 });
    c.kit.add(G.box(l * 0.6, 0.04, 0.09), 0xe8eef4, s.x + l * 0.35, h * 0.38, 0, { rz: 0.75, m: 1, r: 0.1 });
    // and scythes swept back along her flanks
    for (const z of [-1, 1]) {
      const x = c.L * 0.05, hw = c.hw(x);
      c.kit.add(G.shape('sideblade', [[0, 0], [-1, 0.06], [-0.7, 0.18], [-0.1, 0.12]], 0.05), C.steel, x, Math.max(0.3, c.dy * 0.5), z * (hw + 0.15), { sx: c.L * 0.22, sy: c.B * 0.9, rx: -Math.PI / 2 * z, m: 0.95, r: 0.2 });
    }
  },
  glacis(c) {
    const s = stem(c), l = clamp(c.L * 0.2, 1.4, 3), x1 = s.x - 0.15, x0 = x1 - l, top = c.deckAt(x0) + 0.12, w = 2 * Math.max(c.hw(x0), c.hw(x0 + l * 0.3)) + 0.16;
    const slope = Math.atan2(top, l), len = Math.hypot(top, l);
    const col = shade(c.hullC === undefined ? C.iron : blend(c.hullC, C.iron, 0.6), 0.9);
    c.kit.add(G.box(len, 0.12, w), col, (x0 + x1) / 2, top / 2, 0, { rz: -slope, m: 0.7, r: 0.45 });
    for (let i = 1; i < 4; i++) c.kit.add(G.box(0.05, 0.14, w * 1.01), shade(col, 0.6), x0 + (l * i) / 4, top * (1 - i / 4) + 0.02, 0, { rz: -slope, m: 0.7 });
    for (let i = 0; i < 6; i++) for (const z of [-1, 1]) c.kit.add(G.sph(0.05, 5, 3), c.trimC, x0 + (l * (i + 0.5)) / 6, top * (1 - (i + 0.5) / 6) + 0.07, z * w * 0.44, { m: 0.8 });
  },
  ramp(c) { ramp(c, false); },
  jawRamp(c) { ramp(c, true); },
  bowGun(c) {
    const at = c.place(clamp(c.B * 0.22, 0.5, 0.9), 0.34, 'c'), r = clamp(c.B * 0.06, 0.14, 0.28), len = clamp(c.L * 0.2, 1.4, 2.8);
    c.kit.add(G.cyl(r * 3, r * 3.3, 0.3, 10), C.iron, at.x, at.y + 0.15, 0, { m: 0.6, r: 0.45 });
    c.kit.push(at.x, at.y + 0.3 + r * 1.4, 0, 0, 0, -Math.PI / 2 + 0.12);
    c.kit.add(G.cyl(r, r * 1.35, len, 10), c.trimC === 0xd4a83a ? C.bronze : C.iron, 0, len * 0.35, 0, { m: 0.8, r: 0.35 });
    c.kit.add(G.cyl(r * 1.35, r * 1.35, 0.14, 10), c.trimC, 0, len * 0.85, 0, { m: 0.8 });
    c.kit.add(G.sph(r * 1.5, 8, 6), C.iron, 0, -len * 0.15, 0, { m: 0.6 });
    c.kit.pop();
    for (const z of [-1, 1]) c.kit.add(G.box(r * 3, r * 2.6, 0.08), C.iron, at.x, at.y + 0.3 + r * 1.2, z * r * 1.5, { m: 0.6 });
  },
};

function ramp(c, jawed) {
  const s = stem(c), len = clamp(c.L * 0.24, 1.5, 2.8), w = clamp(c.B * 0.5, 1.1, 2.2), hy = Math.max(s.y - 0.1, 0.5), ang = 0.5;
  const col = jawed ? blend(c.hullC, C.bronze, 0.3) : c.hullC === undefined ? C.wood : blend(c.hullC, C.wood, 0.5);
  c.kit.push(s.x - 0.3, hy, 0, 0, 0, -ang);
  c.kit.add(G.box(len, 0.1, w), col, len / 2, 0, 0, { r: 0.8 });
  for (let i = 1; i < 6; i++) c.kit.add(G.box(0.06, 0.06, w * 0.9), C.dark, (len * i) / 6, 0.07, 0);
  for (const z of [-1, 1]) c.kit.add(G.box(len, 0.16, 0.06), shade(col, 0.7), len / 2, 0.08, z * w / 2);
  if (jawed) {
    const n = Math.round(w / 0.25);
    for (let i = 0; i < n; i++) c.kit.add(G.cone(0.07, 0.3, 4), C.bone, len + 0.05, 0.12, -w / 2 + (w * (i + 0.5)) / n, { rz: 0.15 });
    for (const z of [-1, 1]) for (let i = 0; i < 4; i++) c.kit.add(G.cone(0.06, 0.24, 4), C.bone, len * (0.25 + i * 0.2), 0.14, z * w * 0.48);
  } else for (let i = 0; i < 4; i++) c.kit.add(G.cone(0.05, 0.22, 4), C.steel, len + 0.04, 0.02, -w * 0.4 + (w * 0.8 * i) / 3, { rz: -Math.PI / 2, m: 0.8 });
  c.kit.pop();
  // the chains that lower her
  const ex = s.x - 0.3 + Math.cos(ang) * len, ey = hy - Math.sin(ang) * len;
  for (const z of [-1, 1]) {
    c.kit.add(G.box(0.14, 1.2, 0.14), C.dark, s.x - 0.4, hy + 0.55, z * w * 0.55);
    c.kit.bar([s.x - 0.4, hy + 1.1, z * w * 0.55], [ex, ey + 0.1, z * w * 0.45], 0.025, C.iron, { m: 0.7 });
  }
  if (jawed) {
    // the beast's upper beak over the ramp
    const K = c.kit, bw = w * 1.1;
    K.push(s.x - 0.6, hy + 0.6, 0, 0, 0, 0.35);
    K.add(G.shape('beak', [[0, 0], [0.9, -0.1], [0.7, 0.4], [0, 0.7]], 1), blend(c.hullC, 0x5a7a4a, 0.4), 0, 0, 0, { sx: len, sz: bw, r: 0.5 });
    for (const z of [-1, 1]) K.add(G.sph(0.12, 8, 6), 0xffc21a, len * 0.35, 0.5, z * bw * 0.45, { g: 2 });
    K.pop();
  }
}
