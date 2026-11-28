// The bow of a designed ship: rams, drills, jaws, blades, armour, ramps, bow guns and figureheads.
// Figureheads are lofted (necks, skulls, muzzles swept through rings) with horns, teeth, eyes and manes added on;
// parts that act (drill, jaws, blade, ramps, bow gun) are small meshes of their own and register action hooks
// (c.action(name, (k) => ...), k 0 -> 1, at rest at k = 1) and anchors (c.anchor(name, [x, y, z])).
import * as THREE from 'three';
import { Kit, G, C, shade, blend, clamp, lerp, hash, loftL, taper } from './kit.js';
import { emblemOn } from './realmStyle.js';

const PI = Math.PI;
const f2 = (v) => v.toFixed(2);
const bump = (k) => Math.sin(PI * clamp(k, 0, 1));

/** where the stem is: x of the bow, deck height just behind it */
const stem = (c) => ({ x: c.bowX, y: Math.max(0.4, c.deckAt(c.bowX - c.L * 0.05)), hy: Math.max(0.35, c.dy * 0.55) });

// ---------------------------------------------------------------------------------
//  sculpting helpers (all in the kit's current frame)
// ---------------------------------------------------------------------------------
/** a lofted tube along pts with radius per point (rw = rh unless ry given): necks, bodies, tails */
function body(K, key, pts, rads, col, o = {}) {
  const st = pts.map((p, i) => [p[0], p[1], p[2] ?? 0, rads[i] * (o.sx ?? 1), rads[i] * (o.sy ?? 1), o.st?.[i]]);
  K.add(loftL(key, st, { radial: o.radial ?? 12, sub: o.sub ?? 3, col: o.col ?? col, belly: o.belly, ridge: o.ridge, paint: o.paint, cap: o.cap }), o.tint ?? 0xffffff, 0, 0, 0, { r: o.r ?? 0.6, m: o.m ?? 0 });
}
/** a head: stations from the back of the skull (x = 0) to the tip of the muzzle (x = len); [x, y, rw, rh] each */
function head(K, key, rings, col, o = {}) {
  K.add(loftL(key, rings.map(([x, y, rw, rh, so]) => [x, y, 0, rw, rh, so]), { radial: o.radial ?? 14, sub: 3, col, belly: o.belly, ridge: o.ridge, paint: o.paint }), 0xffffff, 0, 0, 0, { r: o.r ?? 0.55, m: o.m ?? 0 });
}
function eyes(K, x, y, z, r, col, glow = 2.2) {
  for (const s of [-1, 1]) {
    K.add(G.sph(r * 1.25, 8, 6), C.black, x - r * 0.2, y, s * z, { sx: 0.8 });
    K.add(G.sph(r, 10, 8), col, x, y, s * (z + r * 0.15), { g: glow });
    K.detail(1, () => K.add(G.sph(r * 0.45, 6, 4), C.black, x + r * 0.55, y, s * (z + r * 0.4), { sx: 0.4 }));
  }
}
function teethRow(K, x0, x1, y, z, h, n, up, col = C.bone) {
  K.detail(2, () => {
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1), hh = h * (i === n - 1 || i === Math.floor(n * 0.3) ? 1.6 : 1);
      K.add(G.cone(hh * 0.3, hh, 5), col, lerp(x0, x1, t), y + (up ? -hh / 2 : hh / 2), s * z * (1 - t * 0.35), { rz: up ? PI : 0, r: 0.4 });
    }
  });
}
function horn(K, key, base, dir, len, r, col = C.bone, curl = 0.4) {
  const [x, y, z] = base, [dx, dy, dz] = dir;
  const pts = [[x, y, z], [x + dx * len * 0.4, y + dy * len * 0.4, z + dz * len * 0.4], [x + dx * len * 0.8 - curl * len * 0.2, y + dy * len * 0.8 + curl * len * 0.1, z + dz * len * 0.8], [x + dx * len - curl * len * 0.45, y + dy * len + curl * len * 0.35, z + dz * len * 0.9]];
  K.add(taper(key, pts, [r, r * 0.75, r * 0.4, r * 0.05], 12, 6), col, 0, 0, 0, { r: 0.45 });
}
/** a row of flat feathers / fins fanned along a line */
function fan(K, n, p0, p1, len, w, col, tilt, side = 0) {
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1), x = lerp(p0[0], p1[0], t), y = lerp(p0[1], p1[1], t), z = lerp(p0[2], p1[2], t);
    K.add(G.sph(0.5, 8, 4), shade(col, 0.9 + (i % 2) * 0.14), x, y, z, { sx: len, sy: w, sz: 0.03 + Math.abs(side) * 0.0, rz: tilt + t * 0.3, ry: side, r: 0.7 });
  }
}

// ---------------------------------------------------------------------------------
//  figureheads: base at the origin, facing +x, about 1.6 tall
// ---------------------------------------------------------------------------------
function figure(K, kind, c) {
  const st = c.st, gilt = st.metal, g = { m: st.metalM, r: 0.4 };
  // a carved bracket under every figure, tying it into the stem
  K.add(loftL(`bracket${st.carve}`, [[-0.35, -0.25, 0, 0.12, 0.18], [-0.1, -0.05, 0, 0.14, 0.16], [0.08, 0.08, 0, 0.12, 0.12], [0.12, 0.2, 0, 0.06, 0.06]], { radial: 10, col: st.carve, ridge: gilt }), 0xffffff, 0, 0, 0, { r: 0.55, m: st.carve === gilt ? st.metalM : 0 });
  K.detail(2, () => { for (const s of [-1, 1]) K.add(G.tor(0.09, 0.022, 4, 10, PI * 1.3), gilt, -0.12, -0.04, s * 0.13, g); });
  switch (kind) {
    case 'dragon': {
      const col = blend(gilt, st.id === 'tianlong' ? 0x2a9a5a : 0x3a7a4a, 0.55), belly = blend(gilt, 0xe8d8a0, 0.4);
      body(K, `drgneck${col}`, [[0, 0], [0.22, 0.4], [0.12, 0.85], [0.32, 1.22], [0.55, 1.36]], [0.13, 0.12, 0.1, 0.095, 0.09], col, { belly, ridge: shade(col, 0.7), m: 0.3 });
      K.push(0.5, 1.36, 0, 0, 0, -0.15);
      head(K, `drghead${col}`, [[-0.08, 0.02, 0.1, 0.1], [0.02, 0.04, 0.15, 0.14], [0.2, 0.06, 0.14, 0.12], [0.38, 0.02, 0.1, 0.08], [0.55, 0.0, 0.08, 0.06], [0.62, 0, 0.04, 0.035]], col, { belly, m: 0.3 });
      K.push(0.06, -0.06, 0, 0, 0, -0.32);
      head(K, `drgjaw${col}`, [[0, 0, 0.1, 0.04], [0.25, -0.02, 0.09, 0.04], [0.48, 0, 0.06, 0.03], [0.54, 0, 0.02, 0.015]], belly, { m: 0.2 });
      teethRow(K, 0.15, 0.46, 0.03, 0.06, 0.06, 4, false);
      K.add(taper('drgtongue', [[0.1, 0.01, 0], [0.4, 0.04, 0], [0.62, -0.02, 0], [0.7, 0.02, 0.03]], [0.025, 0.012], 8, 4), 0xc83a3a);
      K.pop();
      teethRow(K, 0.18, 0.52, -0.06, 0.09, 0.06, 5, true);
      eyes(K, 0.2, 0.12, 0.11, 0.035, 0xffd23a);
      for (const s of [-1, 1]) {
        horn(K, `drghorn${s}`, [0.0, 0.12, s * 0.08], [-0.9, 0.45, s * 0.3], 0.55, 0.05, C.bone, 0.35);
        K.detail(2, () => { horn(K, `drgwhisk${s}`, [0.55, -0.02, s * 0.06], [0.3, -0.5, s * 0.8], 0.5, 0.014, gilt, -0.6); K.add(G.sph(0.016, 5, 3), C.black, 0.6, 0.03, s * 0.04); });
        K.add(G.sph(0.08, 8, 4), shade(col, 0.85), -0.06, 0.02, s * 0.14, { sx: 1.6, sy: 0.6, sz: 0.25, ry: s * 0.4, rz: 0.4 }); // ear-frill
      }
      K.pop();
      // dorsal spines down the neck, and a back fin
      K.detail(2, () => { const sp = [[0.02, 0.22], [0.08, 0.5], [0.06, 0.8], [0.18, 1.1], [0.34, 1.42]]; sp.forEach(([x, y], i) => K.add(G.cone(0.045, 0.2 - i * 0.015, 5), gilt, x - 0.1, y + 0.08, 0, { rz: 0.7, ...g })); });
      break;
    }
    case 'wolf': case 'tiger': case 'boar': {
      const col = kind === 'tiger' ? 0xd8842a : kind === 'boar' ? 0x5a3a2a : blend(gilt, 0x8a8a8a, 0.55);
      const belly = kind === 'tiger' ? 0xf0e8d8 : shade(col, 1.25);
      const stripes = kind === 'tiger' ? (t, a, ca) => (Math.sin(t * 22 + Math.abs(ca) * 2) > 0.55 && Math.sin(a) > -0.3 ? 0x1a1410 : null) : null;
      body(K, `${kind}neck${col}`, [[0, 0], [0.15, 0.4], [0.28, 0.75], [0.42, 1.0]], [0.17, 0.155, 0.145, 0.14], col, { belly, paint: stripes, sy: 1.1 });
      K.push(0.42, 1.05, 0, 0, 0, kind === 'boar' ? -0.3 : -0.1, 1.15);
      const sn = kind === 'boar' ? 0.48 : kind === 'wolf' ? 0.52 : 0.32;
      head(K, `${kind}head${col}`, [[-0.18, 0.05, 0.16, 0.17], [-0.05, 0.08, 0.25, 0.24], [0.12, 0.06, 0.22, 0.2], [0.18 + sn * 0.4, -0.02, 0.13, 0.12], [0.18 + sn, -0.04, kind === 'boar' ? 0.11 : 0.07, kind === 'boar' ? 0.1 : 0.065], [0.2 + sn, -0.04, 0.02, 0.02]], col, { belly, paint: stripes });
      // the open lower jaw
      K.push(0.1, -0.12, 0, 0, 0, -0.35);
      head(K, `${kind}jaw${col}`, [[0, 0, 0.14, 0.05], [sn * 0.6, -0.01, 0.09, 0.04], [sn * 0.95, 0, 0.05, 0.03]], belly);
      K.add(G.sph(0.06, 6, 4), 0x8a2a2a, sn * 0.4, 0.04, 0, { sx: 2.6, sy: 0.4, sz: 1.2 });
      teethRow(K, sn * 0.3, sn * 0.9, 0.03, 0.06, 0.05, 3, false);
      K.pop();
      teethRow(K, 0.15 + sn * 0.3, 0.15 + sn * 0.9, -0.1, 0.08, 0.06, 3, true);
      K.add(G.sph(0.05, 8, 6), C.black, 0.2 + sn, -0.01, 0, { sx: 0.6, sy: 0.9, sz: 1.3 }); // nose
      eyes(K, 0.12, 0.14, 0.13, 0.04, kind === 'wolf' ? 0xffd23a : 0xff7a1a);
      for (const s of [-1, 1]) {
        if (kind === 'wolf') K.add(G.cone(0.09, 0.3, 5), col, -0.08, 0.32, s * 0.13, { rx: -s * 0.25, rz: 0.25, sx: 0.5 });
        if (kind === 'tiger') { K.add(G.sph(0.08, 8, 6), col, -0.06, 0.26, s * 0.17, { sx: 0.35 }); K.detail(1, () => { for (let w = 0; w < 3; w++) K.bar([0.2 + sn * 0.7, -0.04, s * 0.08], [0.32 + sn, -0.02 + (w - 1) * 0.04, s * 0.32], 0.004, 0xf0f0f0); }); }
        if (kind === 'boar') { horn(K, `boartusk${s}`, [0.2 + sn * 0.75, -0.08, s * 0.1], [0.3, 0.9, s * 0.45], 0.34, 0.035, C.bone, 0.5); K.add(G.cone(0.08, 0.2, 5), col, -0.08, 0.3, s * 0.16, { rz: 0.6, sx: 0.5 }); }
      }
      if (kind === 'boar') K.add(G.cyl(0.11, 0.11, 0.03, 12), 0x8a5a5a, 0.21 + sn, -0.04, 0, { rz: PI / 2 });
      K.pop();
      // a fur ruff (wolf), a bristle crest (boar)
      K.detail(2, () => {
        if (kind === 'wolf') for (let i = 0; i < 14; i++) { const a = (i / 14) * PI * 2; K.add(G.cone(0.07, 0.22, 4), shade(col, 0.85 + (i % 3) * 0.1), 0.28 + Math.cos(a) * 0.04, 0.72 + Math.sin(a) * 0.05, Math.sin(a) * 0.27, { rz: -0.9 + Math.cos(a) * 0.4, rx: Math.sin(a) * 0.8 }); }
        if (kind === 'boar') for (let i = 0; i < 9; i++) K.add(G.cone(0.04, 0.24, 4), 0x1a1410, -0.12 + i * 0.07, 0.3 + i * 0.09, 0, { rz: 0.6 });
        if (kind === 'tiger') K.add(G.tor(0.27, 0.035, 5, 16), gilt, 0.27, 0.72, 0, { rx: PI / 2, ry: 0.5, ...g });
      });
      break;
    }
    case 'cobra': {
      const col = blend(gilt, 0x2a6a3a, 0.35), hood = blend(col, 0x1a3a7a, 0.3), belly = 0xe8d8a0;
      body(K, `cobrabody${col}`, [[-0.2, 0.05], [0.25, 0.15], [0.3, 0.5], [0.12, 0.85], [0.22, 1.15]], [0.15, 0.15, 0.14, 0.13, 0.12], col, { belly, ridge: shade(col, 0.7), paint: (t, a, ca) => (Math.sin(t * 40) > 0.7 && Math.sin(a) > 0 ? shade(col, 0.65) : null) });
      // the hood: a broad flattened loft standing behind the head
      K.add(loftL(`cobrahood${hood}`, [[0.18, 0.95, 0, 0.12, 0.03], [0.22, 1.12, 0, 0.36, 0.05], [0.26, 1.32, 0, 0.32, 0.05], [0.3, 1.46, 0, 0.12, 0.04]], { radial: 14, sub: 3, col: hood, belly: belly, lat: [0, 0, 1], paint: (t, a, ca) => (t > 0.35 && t < 0.6 && Math.abs(Math.abs(ca) - 0.55) < 0.12 && Math.cos(a) !== 0 ? 0xe8d8a0 : null) }), 0xffffff, 0, 0, 0, { r: 0.45, m: 0.2 });
      K.detail(2, () => { for (const s of [-1, 1]) { K.add(G.tor(0.05, 0.012, 4, 10), 0xe8d8a0, 0.24, 1.25, s * 0.16, { ry: PI / 2 }); K.add(G.sph(0.03, 6, 4), C.black, 0.24, 1.25, s * 0.16); } });
      K.push(0.32, 1.48, 0, 0, 0, -0.2);
      head(K, `cobrahead${col}`, [[-0.06, 0, 0.08, 0.06], [0.04, 0.01, 0.11, 0.07], [0.18, 0, 0.09, 0.05], [0.26, -0.01, 0.04, 0.03]], col, { belly });
      K.push(0.05, -0.04, 0, 0, 0, -0.5); head(K, `cobrajaw${col}`, [[0, 0, 0.08, 0.025], [0.18, 0, 0.06, 0.02], [0.22, 0, 0.02, 0.01]], 0xc85a5a); K.pop();
      for (const s of [-1, 1]) K.add(G.cone(0.014, 0.1, 4), C.bone, 0.2, -0.07, s * 0.035, { rz: PI + 0.2 });
      K.add(taper('cobratongue', [[0.22, -0.03, 0], [0.34, -0.06, 0], [0.4, -0.04, 0.02]], [0.008, 0.003], 6, 3), 0xc82a2a);
      eyes(K, 0.1, 0.05, 0.08, 0.022, 0xff3a1a, 2.5);
      K.pop();
      // a gilt crown band
      K.detail(2, () => K.add(G.tor(0.14, 0.03, 4, 14), gilt, 0.27, 0.42, 0, { rx: PI / 2, ...g }));
      break;
    }
    case 'horse': {
      const col = blend(gilt, 0xf0ead8, 0.4), mane = c.side ?? st.cloth;
      body(K, `horseneck${col}`, [[0, 0], [0.05, 0.45], [0.2, 0.85], [0.42, 1.15]], [0.15, 0.14, 0.12, 0.1], col, { sy: 1.25, ...g });
      K.push(0.44, 1.18, 0, 0, 0, -0.95);
      head(K, `horsehead${col}`, [[-0.12, 0.02, 0.1, 0.13], [0.0, 0.04, 0.13, 0.15], [0.25, 0.0, 0.09, 0.1], [0.5, -0.03, 0.085, 0.1], [0.62, -0.05, 0.08, 0.09], [0.67, -0.06, 0.04, 0.05]], col, { m: st.metalM * 0.6 });
      for (const s of [-1, 1]) {
        K.add(G.cone(0.045, 0.18, 5), col, -0.06, 0.2, s * 0.07, { rz: 0.3, sx: 0.6 });
        K.add(G.sph(0.04, 6, 4), C.black, 0.12, 0.08, s * 0.12);
        K.add(G.sph(0.025, 5, 3), C.black, 0.64, -0.03, s * 0.05);
        K.detail(1, () => { K.add(G.tor(0.11, 0.012, 3, 12), 0x6a2a1a, 0.42, -0.03, 0, { ry: PI / 2, sy: 0.9 }); K.add(G.sph(0.025, 5, 3), gilt, 0.42, -0.04, s * 0.11, g); });
      }
      K.detail(2, () => K.add(G.cone(0.05, 0.28, 6), mane, -0.08, 0.28, 0, { rz: 0.5 })); // a plume
      K.pop();
      // the mane: flowing locks along the crest of the neck
      K.detail(2, () => { for (let i = 0; i < 9; i++) { const t = i / 8; K.add(G.sph(0.12, 6, 4), shade(mane, 0.85 + (i % 2) * 0.2), lerp(-0.12, 0.3, t), lerp(0.2, 1.3, t), 0, { sx: 0.35, sy: 1.4, sz: 0.25, rz: 0.9 }); } });
      // forelegs pawing the air
      K.detail(2, () => { for (const s of [-1, 1]) K.add(taper(`horseleg${s}`, [[0.12, 0.3, s * 0.12], [0.38, 0.38, s * 0.14], [0.5, 0.2, s * 0.14]], [0.06, 0.04], 6, 5), col, 0, 0, 0, g); });
      break;
    }
    case 'scarab': {
      const shell = 0x1a4a5a;
      K.add(loftL('scarabshell', [[-0.45, 0.3, 0, 0.05, 0.05], [-0.35, 0.36, 0, 0.36, 0.26], [0.1, 0.4, 0, 0.48, 0.32], [0.45, 0.36, 0, 0.34, 0.24], [0.55, 0.32, 0, 0.05, 0.05]], { radial: 18, sub: 3, col: shell, ridge: gilt, paint: (t, a, ca) => (Math.abs(ca) < 0.06 && Math.sin(a) > 0 ? gilt : null) }), 0xffffff, 0, 0, 0, { m: 0.55, r: 0.25 });
      K.add(loftL('scarabhead', [[0.5, 0.3, 0, 0.18, 0.12], [0.7, 0.32, 0, 0.16, 0.1], [0.82, 0.3, 0, 0.05, 0.04]], { radial: 12, col: shell }), 0xffffff, 0, 0, 0, { m: 0.55, r: 0.25 });
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) K.add(taper(`scarleg${i}${s}`, [[0.3 - i * 0.3, 0.25, s * 0.3], [0.4 - i * 0.35, 0.22, s * 0.6], [0.5 - i * 0.38, 0.0, s * 0.7]], [0.035, 0.015], 6, 4), gilt, 0, 0, 0, g);
        K.add(G.sph(0.04, 6, 4), 0x3affd8, 0.75, 0.36, s * 0.1, { g: 2 });
      }
      // the sun-disc it rolls before it, on two raised forelegs
      for (const s of [-1, 1]) K.add(taper(`scarfore${s}`, [[0.75, 0.3, s * 0.1], [0.9, 0.6, s * 0.15], [0.92, 0.95, s * 0.1]], [0.035, 0.02], 6, 4), gilt, 0, 0, 0, g);
      K.add(G.sph(0.32, 16, 12), 0xffb02a, 0.95, 1.2, 0, { g: 1.4, m: 0.5 });
      K.add(G.tor(0.36, 0.03, 5, 24), gilt, 0.95, 1.2, 0, { ry: PI / 2, ...g });
      K.detail(2, () => { for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; K.add(G.cone(0.03, 0.14, 4), gilt, 0.95, 1.2 + Math.sin(a) * 0.46, Math.cos(a) * 0.46, { rx: -a + PI / 2, ...g }); } });
      break;
    }
    case 'swan': {
      const w = 0xf4f0e8;
      body(K, 'swanneck', [[0, 0.1], [0.32, 0.4], [0.3, 0.75], [0.1, 1.05], [0.2, 1.35], [0.38, 1.48]], [0.22, 0.12, 0.09, 0.08, 0.075, 0.07], w, { r: 0.5 });
      K.push(0.38, 1.5, 0, 0, 0, -0.25);
      head(K, 'swanhead', [[-0.08, 0, 0.06, 0.07], [0.04, 0.01, 0.08, 0.08], [0.12, 0, 0.06, 0.06]], w, { r: 0.5 });
      K.add(loftL('swanbeak', [[0.1, 0, 0, 0.05, 0.045], [0.22, -0.02, 0, 0.035, 0.03], [0.32, -0.04, 0, 0.015, 0.012]], { radial: 10, col: 0xe87a1a }), 0xffffff, 0, 0, 0, { r: 0.4 });
      K.add(G.sph(0.035, 6, 4), C.black, 0.12, 0.03, 0, { sz: 1.3 });
      for (const s of [-1, 1]) K.add(G.sph(0.014, 5, 3), C.black, 0.06, 0.03, s * 0.06);
      K.add(G.cyl(0.07, 0.07, 0.04, 10), gilt, -0.02, 0.04, 0, { rx: PI / 2, ...g }); // a crown band
      K.pop();
      // the breast and two raised wings of layered feathers
      K.add(G.sph(0.32, 12, 8), w, -0.05, 0.25, 0, { sx: 1.3, sy: 0.8, sz: 1.0, r: 0.5 });
      for (const s of [-1, 1]) {
        for (let row = 0; row < 3; row++) fan(K, 6 - row, [-0.1 - row * 0.05, 0.4 + row * 0.08, s * 0.3], [-0.75 + row * 0.1, 0.95 - row * 0.15, s * (0.45 + row * 0.05)], 0.42 - row * 0.08, 0.12, row ? w : blend(w, gilt, 0.2), -0.6 - row * 0.2, s * 0.35);
      }
      break;
    }
    case 'eagle': {
      const wcol = blend(gilt, 0x6a4a2a, 0.35), white = 0xf4f0e8;
      body(K, 'eaglebody', [[-0.1, 0.0], [0.05, 0.35], [0.22, 0.7], [0.34, 0.95]], [0.15, 0.2, 0.16, 0.12], wcol, { ...g });
      K.push(0.36, 1.02, 0, 0, 0, -0.2);
      head(K, 'eaglehead', [[-0.12, 0, 0.12, 0.13], [0.02, 0.02, 0.15, 0.14], [0.14, 0.0, 0.1, 0.1]], white, { r: 0.5 });
      K.add(taper('eaglebeak', [[0.12, 0.02, 0], [0.26, 0.0, 0], [0.33, -0.06, 0], [0.31, -0.13, 0]], [0.065, 0.05, 0.03, 0.005], 10, 8), 0xe8b02a, 0, 0, 0, { r: 0.35 });
      eyes(K, 0.07, 0.06, 0.1, 0.026, 0xffc21a, 2);
      for (const s of [-1, 1]) K.add(G.sph(0.05, 6, 4), shade(white, 0.85), 0.0, 0.08, s * 0.1, { sx: 1.8, sy: 0.4, sz: 0.4, rz: 0.2 }); // brow
      K.pop();
      for (const s of [-1, 1]) for (let row = 0; row < 3; row++) fan(K, 7 - row, [0.05, 0.6 + row * 0.04, s * (0.2 + row * 0.02)], [-1.0 + row * 0.22, 1.2 - row * 0.12, s * (0.75 - row * 0.1)], 0.5 - row * 0.1, 0.12, row === 2 ? gilt : shade(wcol, 1 + row * 0.1), -0.4 - row * 0.25, s * 0.25);
      K.detail(2, () => { for (const s of [-1, 1]) for (let k = 0; k < 3; k++) K.add(taper(`talon${k}${s}`, [[0.25, 0.08, s * 0.1 + (k - 1) * 0.04], [0.38, 0.0, s * 0.12 + (k - 1) * 0.06], [0.4, -0.08, s * 0.12 + (k - 1) * 0.06]], [0.025, 0.004], 6, 4), C.black); });
      break;
    }
    case 'skull': {
      const bone = C.bone;
      K.add(loftL('skullcran', [[-0.2, 0.9, 0, 0.1, 0.1], [-0.08, 0.95, 0, 0.36, 0.38], [0.2, 0.98, 0, 0.4, 0.42], [0.42, 0.9, 0, 0.32, 0.34], [0.55, 0.78, 0, 0.18, 0.2]], { radial: 16, sub: 3, col: bone }), 0xffffff, 0, 0, 0, { r: 0.7 });
      K.add(loftL('skullface', [[0.3, 0.58, 0, 0.3, 0.2], [0.55, 0.55, 0, 0.26, 0.18], [0.66, 0.5, 0, 0.18, 0.1]], { radial: 12, col: bone }), 0xffffff, 0, 0, 0, { r: 0.7 });
      for (const s of [-1, 1]) {
        K.add(G.sph(0.13, 10, 8), 0x0a0a0a, 0.56, 0.74, s * 0.17, { sx: 0.6 });
        K.add(G.sph(0.045, 8, 6), st.glow, 0.6, 0.74, s * 0.17, { g: 3 });
        K.add(G.sph(0.08, 6, 4), bone, 0.45, 0.6, s * 0.3, { sx: 1.5, sy: 0.6 }); // cheekbone
        horn(K, `skullhorn${s}`, [0.15, 1.15, s * 0.26], [0.2, 0.6, s * 0.8], 0.6, 0.08, shade(bone, 0.8), 0.8);
      }
      K.add(G.cone(0.06, 0.12, 3), 0x0a0a0a, 0.68, 0.6, 0, { rz: PI / 2 + PI, sz: 0.7 });
      K.push(0.35, 0.36, 0, 0, 0, -0.15);
      K.add(loftL('skulljaw', [[0, 0, 0, 0.26, 0.06], [0.25, -0.02, 0, 0.22, 0.06], [0.33, 0, 0, 0.14, 0.05]], { radial: 10, col: bone }), 0xffffff, 0, 0, 0, { r: 0.7 });
      K.pop();
      K.detail(2, () => { for (let i = 0; i < 8; i++) { const z = -0.16 + i * 0.045; K.add(G.rbox(0.05, 0.09, 0.04, 0.01), 0xf0ead8, 0.66, 0.46, z); K.add(G.rbox(0.05, 0.08, 0.04, 0.01), 0xf0ead8, 0.64, 0.35, z); } });
      // crossed bones beneath
      for (const s of [-1, 1]) { K.add(taper(`xbone${s}`, [[0.0, 0.05, s * 0.4], [0.3, 0.25, 0], [0.6, 0.45, -s * 0.4]], [0.045, 0.045], 6, 5), bone); for (const e of [[0.0, 0.05, s * 0.4], [0.6, 0.45, -s * 0.4]]) K.add(G.sph(0.07, 6, 4), bone, ...e); }
      break;
    }
    case 'eye': {
      const flesh = blend(c.hullC, C.flesh, 0.6), iris = st.glow;
      body(K, `eyestalk${flesh}`, [[0, 0], [0.18, 0.35], [0.28, 0.7]], [0.24, 0.2, 0.3], flesh, { r: 0.45 });
      K.add(G.sph(0.6, 18, 14), flesh, 0.45, 1.05, 0, { r: 0.45 });
      K.add(G.sph(0.53, 18, 14), 0xf4eedc, 0.6, 1.05, 0, { r: 0.2 });
      K.add(G.sph(0.24, 16, 10), iris, 1.0, 1.05, 0, { sx: 0.35, g: 2.5 });
      K.add(G.sph(0.11, 10, 8), C.black, 1.07, 1.05, 0, { sx: 0.3, sy: 1.6 });
      // lids and veins
      for (const s of [-1, 1]) K.add(G.tor(0.56, 0.09, 6, 18, PI), flesh, 0.66, 1.05, 0, { ry: PI / 2, rx: s > 0 ? 0.35 : PI - 0.35, r: 0.45 });
      K.detail(1, () => { for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; K.add(taper(`vein${i}`, [[0.75, 1.05 + Math.sin(a) * 0.45, Math.cos(a) * 0.45], [0.9, 1.05 + Math.sin(a) * 0.3, Math.cos(a) * 0.3], [0.95, 1.05 + Math.sin(a + 0.3) * 0.25, Math.cos(a + 0.3) * 0.25]], [0.012, 0.004], 6, 3), 0xb81a1a); } });
      // feelers round it
      K.detail(2, () => { for (let i = 0; i < 5; i++) { const a = -0.6 + i * 0.3; K.add(taper(`feeler${i}`, [[0.3, 0.5, 0], [0.5 + Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.6], [0.8 + Math.cos(a) * 0.2, 0.15, Math.sin(a) * 0.85]], [0.06, 0.01], 8, 5), shade(flesh, 0.85)); } });
      for (let i = 0; i < 3; i++) K.add(G.sph(0.05, 6, 4), C.slime, 0.95, 0.6 - i * 0.18, (i - 1) * 0.12, { g: 1.2 });
      break;
    }
    case 'frog': {
      const col = 0x5a8a3a, belly = 0xd8d08a;
      K.add(loftL('frogbody', [[-0.45, 0.4, 0, 0.1, 0.08], [-0.3, 0.5, 0, 0.5, 0.32], [0.15, 0.58, 0, 0.6, 0.34], [0.5, 0.55, 0, 0.46, 0.22], [0.66, 0.5, 0, 0.1, 0.05]], { radial: 18, sub: 3, col, belly, paint: (t, a) => (Math.sin(t * 17 + a * 5) > 0.9 && Math.sin(a) > 0 ? 0x2a4a1a : null) }), 0xffffff, 0, 0, 0, { r: 0.4 });
      for (const s of [-1, 1]) {
        K.add(G.sph(0.18, 12, 8), col, 0.3, 0.88, s * 0.32);
        K.add(G.sph(0.14, 12, 8), 0xffd23a, 0.37, 0.92, s * 0.34, { g: 1.0 });
        K.add(G.box(0.03, 0.14, 0.06), C.black, 0.5, 0.93, s * 0.36);
        K.add(taper(`frogleg${s}`, [[0.3, 0.45, s * 0.4], [0.52, 0.25, s * 0.55], [0.6, 0.0, s * 0.5]], [0.08, 0.04], 6, 5), col);
        for (let k = 0; k < 3; k++) K.add(G.sph(0.045, 5, 4), col, 0.64 + k * 0.04, 0.0, s * (0.42 + k * 0.08));
      }
      K.add(taper('frogmouth', [[0.62, 0.5, -0.45], [0.69, 0.47, 0], [0.62, 0.5, 0.45]], [0.02, 0.02], 10, 4), 0x2a1a1a);
      K.add(taper('frogtongue', [[0.68, 0.46, 0], [0.9, 0.4, 0], [1.1, 0.5, 0.05]], [0.04, 0.03], 8, 5), 0xd85a6a);
      K.add(G.sph(0.06, 6, 4), 0xd85a6a, 1.12, 0.5, 0.05);
      K.detail(2, () => { for (let i = 0; i < 7; i++) K.add(G.sph(0.06, 6, 4), C.slime, 0.0 + (i % 3) * 0.14, 0.82, -0.3 + i * 0.1, { g: 0.5 }); });
      break;
    }
    case 'comet': {
      K.add(G.ico(0.34, 2), 0xffc040, 0.42, 1.2, 0, { g: 1.2 });
      K.add(G.ico(0.42, 1), 0xffe8a0, 0.42, 1.2, 0, { g: 0.5, r: 0.2 });
      for (let i = 0; i < 6; i++) {
        const a = (i - 2.5) * 0.24, len = 1.4 + (i % 2) * 0.4;
        K.add(taper(`comtail${i}`, [[0.3, 1.2 + a * 0.2, a * 0.2], [-0.3, 1.25 + a * 0.6, a * 0.7], [-0.6 - len * 0.3, 1.3 + a, a * 1.1]], [0.16, 0.08, 0.005], 10, 6), i % 2 ? 0xe8902a : 0xf0c050, 0, 0, 0, { g: 0.8 });
      }
      K.add(taper('cometpost', [[0, 0, 0], [0.2, 0.5, 0], [0.38, 0.95, 0]], [0.1, 0.07], 8, 6), gilt, 0, 0, 0, g);
      for (let i = 0; i < 6; i++) K.add(G.oct(0.05), 0xfff0c0, -0.3 - hash(i) * 1.0, 1.1 + (hash(i + 5) - 0.5) * 0.8, (hash(i + 9) - 0.5) * 0.8, { g: 2 });
      break;
    }
    case 'fish': {
      const col = blend(gilt, 0x3a8aaa, 0.45), belly = 0xe8e8d8;
      K.push(0.15, 0.75, 0, 0, 0, 0.6);
      K.add(loftL(`fishbody${col}`, [[-0.7, 0, 0, 0.02, 0.06], [-0.5, 0, 0, 0.08, 0.18], [-0.1, 0, 0, 0.2, 0.36], [0.3, 0, 0, 0.2, 0.32], [0.55, -0.02, 0, 0.12, 0.18], [0.66, -0.03, 0, 0.04, 0.05]], { radial: 16, sub: 3, col, belly, paint: (t, a, ca) => (Math.sin(t * 50 + Math.sin(a) * 8) > 0.6 ? shade(col, 0.8) : null) }), 0xffffff, 0, 0, 0, { m: 0.45, r: 0.3 });
      K.add(G.shape('fishtail2', [[0, 0], [-0.5, 0.45], [-0.36, 0.05], [-0.36, -0.05], [-0.5, -0.45]], 0.03), gilt, -0.68, 0, 0, g);
      K.add(G.shape('fishfin2', [[0.3, 0], [-0.1, 0.32], [-0.38, 0.28], [-0.3, 0]], 0.025), gilt, 0.05, 0.32, 0, g);
      for (const s of [-1, 1]) { K.add(G.shape('pect', [[0, 0], [-0.3, 0.12], [-0.25, -0.1]], 0.02), gilt, 0.3, -0.1, s * 0.18, { ry: s * 0.5, ...g }); eyes(K, 0.46, 0.06, 0.1, 0.035, 0xf0f0f0, 0.3); }
      K.add(G.tor(0.05, 0.015, 4, 10), 0x8a3a3a, 0.65, -0.04, 0, { ry: PI / 2 });
      K.pop();
      // the wave it leaps from
      K.add(taper('fishwave', [[-0.3, 0.05, 0], [0.0, 0.32, 0], [0.25, 0.3, 0], [0.32, 0.15, 0]], [0.16, 0.12, 0.08, 0.03], 10, 7), blend(gilt, 0x6ac8e8, 0.6), 0, 0, 0, { r: 0.3 });
      break;
    }
    default: return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------
//  jaws: a beast's skull built around the bow; the lower jaw moves
// ---------------------------------------------------------------------------------
function jawUpper(K, len, w, col, tooth, glow) {
  K.add(loftL(`jawup${f2(len)}${f2(w)}${col}`, [[0, 0.12, 0, w * 0.5, len * 0.24, { fl: 0.8 }], [len * 0.35, 0.1, 0, w * 0.46, len * 0.2, { fl: 0.85 }], [len * 0.75, 0.06, 0, w * 0.34, len * 0.12, { fl: 0.9 }], [len, 0.02, 0, w * 0.16, len * 0.05, { fl: 0.9 }]], { radial: 16, sub: 3, col, ridge: shade(col, 0.7) }), 0xffffff, 0, 0, 0, { r: 0.55 });
  K.add(G.box(len * 0.9, 0.02, w * 0.8), 0x6a1010, len * 0.45, 0.04, 0, { g: 0.3 });
  teethRow(K, len * 0.1, len * 0.95, 0.06, w * 0.42, len * 0.12, Math.max(4, Math.round(len / 0.22)), true, tooth);
  for (const s of [-1, 1]) {
    K.add(G.sph(len * 0.08, 10, 8), shade(col, 0.6), len * 0.35, len * 0.2, s * w * 0.4, { sx: 1.3 });
    K.add(G.sph(len * 0.06, 10, 8), glow, len * 0.38, len * 0.21, s * w * 0.42, { g: 2.4 });
    horn(K, `jawhorn${f2(len)}${s}`, [len * 0.15, len * 0.22, s * w * 0.34], [-0.6, 0.6, s * 0.4], len * 0.55, len * 0.06, tooth, 0.4);
    K.detail(2, () => { for (let i = 0; i < 4; i++) K.add(G.cone(len * 0.03, len * 0.1, 4), shade(col, 0.7), len * (0.2 + i * 0.15), len * (0.22 - i * 0.03), s * w * 0.15, { rz: -0.5 }); });
  }
}
function jawLower(K, len, w, col, tooth) {
  K.add(loftL(`jawlo${f2(len)}${f2(w)}${col}`, [[0, -0.05, 0, w * 0.46, len * 0.14, { up: -0.6 }], [len * 0.4, -0.04, 0, w * 0.42, len * 0.11, { up: -0.6 }], [len * 0.8, -0.02, 0, w * 0.3, len * 0.07, { up: -0.6 }], [len * 0.96, 0, 0, w * 0.14, len * 0.03]], { radial: 14, sub: 3, col }), 0xffffff, 0, 0, 0, { r: 0.55 });
  K.add(G.box(len * 0.85, 0.02, w * 0.75), 0x6a1010, len * 0.42, -0.02, 0, { g: 0.3 });
  teethRow(K, len * 0.1, len * 0.9, -0.02, w * 0.4, len * 0.1, Math.max(4, Math.round(len / 0.22)), false, tooth);
}

export const BOW_PARTS = {
  figure(c, kind, scale = 1) {
    const s = stem(c), sc = clamp(c.B * 0.28, 0.7, 1.4) * scale;
    c.kit.push(s.x - 0.2 * sc, s.y + 0.1, 0, 0, 0, -0.25, sc);
    figure(c.kit, kind, c);
    c.kit.pop();
    c.topAt = Math.max(c.topAt || 0, s.y + 2 * sc);
    c.anchor('bow', [s.x + 0.6 * sc, s.y + 1.2 * sc, 0], 'figure');
  },
  ram(c) {
    // a cast waterline ram: a fluted beak with three fins, a collar plate and the realm's device on its cheek
    const s = stem(c), l = clamp(c.L * 0.17, 1.2, 2.6), r = clamp(c.B * 0.1, 0.22, 0.5), st = c.st;
    const col = c.def.kind === 'dreadnought' || c.hullC < 0x404040 ? c.trimC : C.bronze;
    c.kit.push(s.x - 0.25, Math.min(0.25, s.hy * 0.4), 0);
    c.kit.add(loftL(`ram${f2(l)}${f2(r)}`, [[-0.1, 0, 0, r * 1.2, r * 1.3], [l * 0.3, 0, 0, r * 0.95, r * 1.0], [l * 0.75, 0, 0, r * 0.6, r * 0.55, { n: 3 }], [l, 0, 0, r * 0.25, r * 0.4, { n: 3 }], [l * 1.04, 0, 0, r * 0.05, r * 0.08]], { radial: 14, col: 0xffffff }), col, 0, 0, 0, { m: 0.55, r: 0.32 });
    for (const yy of [-1, 0, 1]) c.kit.add(G.shape(`ramfin2`, [[0, -0.5], [0.8, -0.2], [1.08, 0], [0.8, 0.2], [0, 0.5]], 1), shade(col, 1.08), l * 0.35, yy * r * 0.55, 0, { sx: l * 0.68, sy: r * 1.5 - Math.abs(yy) * r * 0.5, sz: 0.04, rx: PI / 2, m: 0.55, r: 0.3 });
    c.kit.add(G.cyl(r * 1.35, r * 1.35, 0.14, 14), col, 0.02, 0, 0, { rz: PI / 2, m: 0.55, r: 0.35 });
    c.kit.detail(1, () => { for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; c.kit.add(G.sph(0.03, 4, 3), shade(col, 0.7), 0.1, Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25, { m: 0.55 }); } });
    c.kit.detail(2, () => { for (const z of [-1, 1]) { c.kit.push(l * 0.3, r * 0.1, z * r * 1.0, 0, z > 0 ? 0 : PI, 0); emblemOn(c.kit, st, r * 1.1, { col: [shade(col, 0.75), shade(col, 1.2)], depth: 0.06 }); c.kit.pop(); } });
    // a bull's head on her ram if she is a fire-forge monitor
    if (c.def.realm === 'ashur') { c.kit.add(G.sph(r * 1.2, 10, 8), C.bronze, 0.1, r * 1.8, 0, { m: 0.55, r: 0.3 }); for (const z of [-1, 1]) horn(c.kit, `ashurhorn${f2(r)}${z}`, [0.1, r * 2.2, z * r * 0.8], [0.2, 0.5, z], r * 2.4, r * 0.3, C.bone, -0.3); }
    c.kit.pop();
    c.anchor('bow', [s.x - 0.25 + l * 1.05, Math.min(0.25, s.hy * 0.4), 0], 'ram');
  },
  drill(c) {
    const s = stem(c), len = clamp(c.L * 0.3, 2, 4.4), r = clamp(c.B * 0.2, 0.5, 1.05), y = Math.max(r * 0.8, s.hy);
    const K = new Kit(), col = C.steel;
    K.add(G.cone(r, len, 18), col, 0, len / 2, 0, { m: 0.55, r: 0.35 });
    const pts = [];
    for (let i = 0; i <= 64; i++) { const t = i / 64, a = t * PI * 2 * 3.5, rr = r * (1 - t) + 0.04; pts.push([Math.cos(a) * rr, t * len, Math.sin(a) * rr]); }
    K.add(taper(`drill${f2(r)},${f2(len)}`, pts, [r * 0.13, r * 0.03], 96, 5), shade(col, 1.25), 0, 0, 0, { m: 0.55, r: 0.3 });
    K.detail(1, () => { for (let i = 0; i < 3; i++) K.add(G.tor(r * (0.85 - i * 0.25), r * 0.03, 4, 18), C.iron, 0, len * (0.12 + i * 0.25), 0, { rx: PI / 2, m: 0.5 }); });
    const mesh = K.mesh(undefined, `drill${f2(r)}${f2(len)}`); const pivot = new THREE.Group(); pivot.add(mesh); mesh.rotation.order = 'ZYX'; mesh.rotation.z = -PI / 2; pivot.position.set(s.x + 0.1, y, 0);
    const act = { surge: 0, spin: 0 };
    c.addMoving(pivot, (t) => { act.spin += 0; mesh.rotation.y = t * 7 + act.spin; pivot.position.x = s.x + 0.1 + act.surge; act.surge *= 0.85; });
    c.action('ram', (k) => { const b = bump(k); act.surge = b * len * 0.22; act.boost = 0.6 * b; mesh.rotation.y += act.boost; pivot.position.x = s.x + 0.1 + act.surge; if (k >= 1) { act.surge = 0; act.boost = 0; pivot.position.x = s.x + 0.1; } });
    // the collar, gear ring and boiler struts that hold her
    c.kit.add(G.cyl(r * 0.8, r * 0.9, 0.5, 16), C.steel, s.x - 0.15, y, 0, { rz: PI / 2, m: 0.55, r: 0.4 });
    c.kit.add(G.tor(r * 0.85, 0.07, 5, 20), c.trimC, s.x + 0.1, y, 0, { ry: PI / 2, m: 0.55 });
    c.kit.detail(1, () => { for (let i = 0; i < 16; i++) { const a = (i / 16) * PI * 2; c.kit.add(G.box(0.08, 0.06, 0.06), C.iron, s.x - 0.1, y + Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, { rx: a, m: 0.55 }); } });
    for (const z of [-1, 1]) c.kit.add(taper(`drillstrut${f2(r)}${z}`, [[s.x - 0.1, y, z * r * 0.9], [s.x - c.L * 0.06, (y + s.y) / 2 + 0.1, z * r], [s.x - c.L * 0.12, s.y, z * c.hw(s.x - c.L * 0.12) * 0.7]], [0.09, 0.07], 8, 6), C.iron, 0, 0, 0, { m: 0.5 });
    c.anchor('bow', [s.x + 0.1 + len, y, 0], 'drill');
  },
  jaws(c) {
    const s = stem(c), len = clamp(c.L * 0.24, 1.6, 3.2), w = clamp(c.B * 0.62, 1.2, 2.6), hx = s.x - len * 0.35, hy = Math.max(0.5, s.hy);
    const col = blend(c.hullC, 0x6a2a2a, 0.3), tooth = C.bone;
    c.kit.push(hx, hy, 0, 0, 0, 0.18); jawUpper(c.kit, len, w, col, tooth, c.st.glow); c.kit.pop();
    const K = new Kit(); jawLower(K, len, w * 0.92, col, tooth);
    const lower = K.mesh(undefined, `jawlo${f2(len)}${f2(w)}${col}`); lower.position.set(hx, hy, 0);
    const act = { open: 0 };
    c.addMoving(lower, (t, ph) => { lower.rotation.z = -0.12 - 0.3 * Math.max(0, Math.sin(t * 1.3 + ph)) - act.open; act.open *= 0.85; });
    // grapple / ram: gape wide, then clamp shut hard
    const bite = (k) => { act.open = k < 0.55 ? (k / 0.55) * 0.55 : Math.max(-0.12, 0.55 - ((k - 0.55) / 0.2) * 0.67) * (1 - clamp((k - 0.85) / 0.15, 0, 1)); lower.rotation.z = -0.12 - act.open; if (k >= 1) act.open = 0; };
    c.action('grapple', bite); c.action('ram', bite);
    c.anchor('mouth', [hx + len * 0.7, hy, 0], 'jaws'); c.anchor('bow', [hx + len, hy, 0], 'jaws');
  },
  blade(c) {
    const s = stem(c), h = Math.max(1, s.y + 0.3), l = clamp(c.L * 0.2, 1.4, 3);
    const pts = [[0, 0], [l * 0.55, h * 0.1], [l, h * 0.55], [l * 0.75, h * 0.35], [l * 0.3, h * 0.5], [0, h * 0.75]];
    const outline = pts.map(([x, y]) => [x / l, y / h]);
    c.kit.add(G.shape('bowblade2', outline, 0.07, 0.02), C.steel, s.x - l * 0.25, 0.05, 0, { sx: l, sy: h, m: 0.55, r: 0.18 });
    c.kit.add(G.box(l * 0.6, 0.04, 0.09), 0xe8eef4, s.x + l * 0.35, h * 0.38, 0, { rz: 0.75, m: 0.55, r: 0.1 });
    c.kit.detail(1, () => { for (let i = 0; i < 6; i++) for (const z of [-1, 1]) c.kit.add(G.sph(0.03, 5, 3), c.st.metal, s.x - l * 0.15 + i * l * 0.09, h * (0.2 + i * 0.06), z * 0.06, { m: c.st.metalM }); });
    // the honed edge glows when she strikes
    const EK = new Kit();
    EK.add(taper(`bladeedge${f2(l)}${f2(h)}`, [[l * 0.55, h * 0.1, 0], [l * 0.85, h * 0.32, 0], [l, h * 0.55, 0], [l * 0.75, h * 0.35, 0]], [0.04, 0.05, 0.04, 0.02], 16, 5), 0xffffff);
    const edge = new THREE.Mesh(EK.build(), new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    edge.position.set(s.x - l * 0.25, 0.05, 0); edge.visible = false;
    c.addMoving(edge);
    c.action('ram', (k) => { const b = bump(k); edge.visible = b > 0.02; edge.material.opacity = 0.9 * b; edge.scale.setScalar(1 + 0.1 * b); });
    // and scythes swept back along her flanks
    for (const z of [-1, 1]) {
      const x = c.L * 0.05, hw = c.hw(x);
      c.kit.add(G.shape('sideblade', [[0, 0], [-1, 0.06], [-0.7, 0.18], [-0.1, 0.12]], 0.05, 0.01), C.steel, x, Math.max(0.3, c.dy * 0.5), z * (hw + 0.15), { sx: c.L * 0.22, sy: c.B * 0.9, rx: (-PI / 2) * z, m: 0.55, r: 0.2 });
    }
    c.anchor('bow', [s.x + l * 0.75, h * 0.55, 0], 'blade');
  },
  glacis(c) {
    const s = stem(c), l = clamp(c.L * 0.2, 1.4, 3), x1 = s.x - 0.15, x0 = x1 - l, top = c.deckAt(x0) + 0.12, w = 2 * Math.max(c.hw(x0), c.hw(x0 + l * 0.3)) + 0.16, st = c.st;
    const slope = Math.atan2(top, l), len = Math.hypot(top, l);
    const col = shade(c.hullC === undefined ? C.iron : blend(c.hullC, C.iron, 0.6), 0.9);
    // overlapping plates, like scales, each bevelled
    const nP = 4;
    for (let i = 0; i < nP; i++) {
      const t = (i + 0.5) / nP;
      c.kit.add(G.rbox(len / nP + 0.12, 0.1, w * (1 - t * 0.12), 0.03), shade(col, 0.92 + (i % 2) * 0.12), x0 + l * t, top * (1 - t) + 0.05 + i * 0.012, 0, { rz: -slope, m: 0.5, r: 0.45 });
    }
    c.kit.detail(1, () => { for (let i = 0; i < 8; i++) for (const z of [-1, -0.5, 0, 0.5, 1]) c.kit.add(G.sph(0.035, 5, 3), c.trimC, x0 + (l * (i + 0.5)) / 8, top * (1 - (i + 0.5) / 8) + 0.11, z * w * 0.42, { m: 0.55 }); });
    c.kit.detail(2, () => { c.kit.push(x0 + l * 0.42, top * 0.58 + 0.13, 0, 0, 0, -slope); c.kit.push(0, 0, 0, -PI / 2, 0, -PI / 2); emblemOn(c.kit, st, Math.min(w * 0.4, l * 0.5), { depth: 0.08 }); c.kit.pop(); c.kit.pop(); });
  },
  ramp(c) { ramp(c, false); },
  jawRamp(c) { ramp(c, true); },
  bowGun(c) {
    const at = c.place(clamp(c.B * 0.22, 0.5, 0.9), 0.34, 'c'), r = clamp(c.B * 0.06, 0.14, 0.28), len = clamp(c.L * 0.2, 1.4, 2.8), st = c.st;
    const bronze = c.trimC === 0xd4a83a ? C.bronze : C.iron;
    // a turntable with a ring of bolts, two cheeks, and the barrel (its own mesh: it recoils)
    c.kit.add(G.cyl(r * 3, r * 3.3, 0.3, 18), C.iron, at.x, at.y + 0.15, 0, { m: 0.5, r: 0.45 });
    c.kit.add(G.tor(r * 3.05, 0.04, 4, 24), st.metal, at.x, at.y + 0.3, 0, { rx: PI / 2, m: st.metalM });
    c.kit.detail(1, () => { for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; c.kit.add(G.sph(0.035, 4, 3), C.steel, at.x + Math.cos(a) * r * 2.7, at.y + 0.31, Math.sin(a) * r * 2.7, { m: 0.55 }); } });
    for (const z of [-1, 1]) c.kit.add(G.shape('guncheek', [[-1, 0], [1, 0], [0.7, 0.9], [-0.4, 1.1]], 1, 0.03), C.iron, at.x, at.y + 0.3, z * r * 1.55, { sx: r * 1.6, sy: r * 2.2, sz: 0.08, m: 0.5 });
    const K = new Kit();
    K.add(G.lathe(`bowgun${f2(r)}${f2(len)}`, [[0, -len * 0.25], [r * 1.5, -len * 0.22], [r * 1.55, -len * 0.1], [r * 1.35, 0], [r * 1.2, len * 0.55], [r * 1.05, len * 0.78], [r * 1.35, len * 0.82], [r * 1.35, len * 0.9], [r * 1.1, len * 0.92], [r * 0.7, len * 0.92], [r * 0.7, len * 0.5]], 16), bronze, 0, 0, 0, { m: 0.55, r: 0.32 });
    for (const y of [0.1, 0.35, 0.6]) K.add(G.tor(r * 1.32 - y * r * 0.3, r * 0.08, 4, 16), st.metal, 0, len * y, 0, { rx: PI / 2, m: st.metalM });
    K.add(G.sph(r * 1.5, 10, 8), C.iron, 0, -len * 0.25, 0, { m: 0.5 });
    K.add(G.cyl(r * 0.3, r * 0.3, r * 3.4, 8), C.iron, 0, 0, 0, { rx: PI / 2, m: 0.5 }); // trunnions
    const barrel = K.mesh(undefined, `bowgun${f2(r)}${f2(len)}${bronze}${st.metal}`), mount = new THREE.Group();
    barrel.rotation.z = -PI / 2 + 0.12; mount.add(barrel); mount.position.set(at.x, at.y + 0.3 + r * 1.4, 0);
    const flash = new THREE.Mesh(G.sph(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.visible = false; mount.add(flash);
    const dir = new THREE.Vector3(Math.cos(0.12), Math.sin(0.12), 0);
    flash.position.copy(dir).multiplyScalar(len * 0.95);
    c.addMoving(mount);
    c.action('fire', (k) => {
      const rec = k < 0.12 ? k / 0.12 : Math.max(0, 1 - (k - 0.12) / 0.6);
      barrel.position.copy(dir).multiplyScalar(-rec * len * 0.16);
      const f = clamp(1 - k / 0.25, 0, 1); flash.visible = f > 0.01; flash.material.opacity = f; flash.scale.setScalar(r * (2 + 4 * (1 - f)));
      if (k >= 1) { barrel.position.set(0, 0, 0); flash.visible = false; flash.scale.setScalar(1); }
    });
    c.anchor('gun', [at.x + dir.x * len * 0.95, at.y + 0.3 + r * 1.4 + dir.y * len * 0.95, 0], 'bowGun');
  },
};

/** the realm's own figurehead on a plain stem (smaller than one the design asks for) */
export function figureHead(c, kind, scale = 0.72) { BOW_PARTS.figure(c, kind, scale); }

function ramp(c, jawed) {
  const s = stem(c), len = clamp(c.L * 0.24, 1.5, 2.8), w = clamp(c.B * 0.5, 1.1, 2.2), hy = Math.max(s.y - 0.1, 0.5), st = c.st;
  const col = jawed ? blend(c.hullC, C.bronze, 0.3) : c.hullC === undefined ? C.wood : blend(c.hullC, C.wood, 0.5);
  // the ramp leaf, its own mesh hinged at the stem: stowed raised, dropped to board or beach
  const K = new Kit();
  const np = Math.max(5, Math.round(len / 0.22));
  for (let i = 0; i < np; i++) K.add(G.rbox(len / np - 0.015, 0.1, w, 0.015), shade(col, 0.9 + hash(i) * 0.2), (len * (i + 0.5)) / np, 0, 0, { r: 0.85 });
  for (let i = 1; i < 7; i++) K.add(G.box(0.05, 0.05, w * 0.92), C.dark, (len * i) / 7, 0.07, 0); // cleats
  for (const z of [-1, 1]) K.add(G.rbox(len, 0.18, 0.07, 0.02), shade(col, 0.7), len / 2, 0.08, (z * w) / 2);
  K.detail(1, () => { for (let i = 0; i < 6; i++) for (const z of [-1, 1]) K.add(G.sph(0.025, 4, 3), C.iron, (len * (i + 0.5)) / 6, 0.12, (z * w) / 2, { m: 0.55 }); });
  if (jawed) {
    const n = Math.round(w / 0.2);
    for (let i = 0; i < n; i++) K.add(G.cone(0.07, 0.32, 5), C.bone, len + 0.05, 0.12, -w / 2 + (w * (i + 0.5)) / n, { rz: 0.15 - PI / 2 * 0.2 });
    for (const z of [-1, 1]) for (let i = 0; i < 5; i++) K.add(G.cone(0.06, 0.26, 5), C.bone, len * (0.15 + i * 0.18), 0.16, z * w * 0.48);
    K.add(loftL(`jawrampchin${f2(w)}`, [[len * 0.8, -0.08, 0, w * 0.5, 0.1], [len * 1.02, -0.05, 0, w * 0.4, 0.08], [len * 1.08, 0, 0, w * 0.2, 0.04]], { radial: 12, col }), 0xffffff, 0, 0, 0, { r: 0.6 });
  } else {
    for (let i = 0; i < 4; i++) K.add(G.cone(0.05, 0.22, 5), C.steel, len + 0.04, 0.02, -w * 0.4 + (w * 0.8 * i) / 3, { rz: -PI / 2, m: 0.55 });
    K.detail(2, () => { K.push(len * 0.5, -0.06, 0, PI / 2, 0, 0); emblemOn(K, st, w * 0.4, { depth: 0.05 }); K.pop(); });
  }
  const leaf = K.mesh(undefined, `ramp${jawed}${f2(len)}${f2(w)}${col}${st.id}`);
  const hinge = new THREE.Group(); hinge.position.set(s.x - 0.3, hy, 0); hinge.add(leaf);
  const REST = 0.95, DOWN = -0.55;
  hinge.rotation.z = REST;
  // the chains that lower her: two posts on deck, the chains (scaled bars) follow the leaf
  const posts = [];
  for (const z of [-1, 1]) {
    c.kit.add(G.rbox(0.14, 1.2, 0.14, 0.02), C.dark, s.x - 0.4, hy + 0.55, z * w * 0.55);
    c.kit.add(G.cyl(0.08, 0.08, 0.1, 8), C.iron, s.x - 0.4, hy + 1.15, z * w * 0.55, { rx: PI / 2, m: 0.5 });
    posts.push([s.x - 0.4, hy + 1.1, z * w * 0.55]);
  }
  const chainGeo = G.cyl(0.03, 0.03, 1, 5), chains = posts.map(() => { const m = new THREE.Mesh(chainGeo, new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.6, roughness: 0.45 })); return m; });
  const grp = new THREE.Group(); grp.add(hinge, ...chains);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const setAng = (ang) => {
    hinge.rotation.z = ang;
    const ex = s.x - 0.3 + Math.cos(ang) * len, ey = hy + Math.sin(ang) * len;
    chains.forEach((m, i) => {
      a.set(...posts[i]); b.set(ex, ey + 0.1, posts[i][2] * 0.82);
      const d = b.clone().sub(a), L = d.length();
      m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(up, d.normalize());
    });
  };
  setAng(REST);
  c.addMoving(grp);
  // board / beach: the leaf swings down (with a bounce as it lands), holds, and is hauled up again
  const drop = (k) => {
    let t;
    if (k < 0.25) { const u = k / 0.25; t = u * u; } else if (k < 0.32) t = 1 - 0.08 * Math.sin(((k - 0.25) / 0.07) * PI); else if (k < 0.7) t = 1; else t = 1 - (k - 0.7) / 0.3;
    setAng(lerp(REST, DOWN, clamp(t, 0, 1)));
  };
  c.action('board', drop); c.action('beach', drop);
  if (jawed) {
    // the beast's upper beak over the ramp, and its eyes
    const KK = c.kit, bw = w * 1.1;
    KK.push(s.x - 0.6, hy + 0.6, 0, 0, 0, 0.35);
    KK.add(loftL(`beak${f2(len)}${f2(bw)}`, [[0, 0.3, 0, bw * 0.5, 0.35, { fl: 0.7 }], [len * 0.45, 0.2, 0, bw * 0.42, 0.25, { fl: 0.8 }], [len * 0.85, 0.02, 0, bw * 0.2, 0.1], [len * 0.95, -0.1, 0, bw * 0.05, 0.05]], { radial: 14, sub: 3, col: blend(c.hullC, 0x5a7a4a, 0.4), ridge: shade(blend(c.hullC, 0x5a7a4a, 0.4), 0.7) }), 0xffffff, 0, 0, 0, { r: 0.5 });
    eyes(KK, len * 0.3, 0.5, bw * 0.38, 0.1, c.st.glow);
    KK.pop();
    c.anchor('mouth', [s.x + len * 0.5, hy, 0], 'jawRamp');
  }
  c.anchor('ramp', [s.x - 0.3 + Math.cos(DOWN) * len, hy + Math.sin(DOWN) * len, 0], 'ramp');
}
