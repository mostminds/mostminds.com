// Hull forms, rigs and drives for a designed ship (see ../shipParts.js for the context `c` every builder gets).
// Detail tiers (Kit.detail): 1 = rivets, lashings, rigging lines, seams; 2 = mid-distance trim; the rest always.
import * as THREE from 'three';
import { Kit, G, C, shade, blend, clamp, lerp, hash, loftL, taper, clothPanel, boatHull, noise3 } from './kit.js';
import { sculptMaterial } from '../sculpt.js';
import { motif, finial, emblemOn } from './realmStyle.js';

const PI = Math.PI;
export const SAIL_STYLES = ['squareSail', 'lateen', 'junkSails', 'leafSails', 'silkSails', 'tatteredSails'];
// the cloth each class is drawn with already: asking for it keeps the class's own rig
const NATIVE = {
  cog: ['squareSail'], paddleGalleon: ['squareSail'], swanGalley: ['silkSails', 'lateen'], razorGalley: ['lateen'], livingSkiff: ['leafSails'],
  icebreaker: ['squareSail'], junk: ['junkSails'], dreadGalley: ['tatteredSails'], hideRaft: ['squareSail'], longship: ['squareSail'],
  scrapHulk: ['tatteredSails'], shroudGalleon: ['tatteredSails'], solarBarque: ['squareSail'], oxBarge: ['squareSail'], fluyt: ['squareSail'],
  warGalley: ['lateen'], treasureGalleon: ['squareSail'], dhow: ['lateen'], atakebune: ['squareSail'], curragh: ['squareSail'], swanBarge: ['lateen', 'silkSails'],
};
export const nativeSail = (kind) => NATIVE[kind] || [];
// classes whose sculpted hull rows her own oars when asked (fleets.js oarCount)
export const OAR_KINDS = ['longship', 'curragh', 'solarBarque', 'warGalley', 'razorGalley', 'dreadGalley', 'swanBarge', 'swanGalley', 'atakebune', 'oxBarge', 'hideRaft'];

const f2 = (v) => v.toFixed(2);
/** a straight barked log along x, centred */
const logL = (l, r) => loftL(`blog${f2(l)},${f2(r)}`, [[-l / 2, 0, 0, r * 0.97, r * 0.97], [0, 0, 0, r, r], [l / 2, 0, 0, r * 0.95, r * 0.95]], { radial: 36, sub: 10, col: 0xffffff, disp: bark(l, r) });
/** bark relief for a lofted log: long furrows broken by knots */
const bark = (l, r) => (t, a) => 1 + 0.07 * (noise3(t * l * 2.2, Math.cos(a) * 2.5, Math.sin(a) * 2.5) - 0.5) * 2 - 0.09 * Math.pow(Math.max(0, Math.sin(a * 7 + noise3(t * l * 0.7, Math.cos(a), 1) * 4)), 3) + 0.1 * Math.max(0, noise3(t * l * 0.9 + 9, Math.cos(a) * 1.2, Math.sin(a) * 1.2) - 0.78) * 4;

/** a float hull at z (bow +x), keel at y0: a planked boat with rail, wales, a painted band and the realm's carving */
function floatHull(c, z, l, w, h, y0, o = {}) {
  const K = c.kit, st = c.st, x0 = o.x0 ?? (c.bowX + c.sternX) / 2 - c.L * 0.02;
  const key = `${f2(l)},${f2(w)},${f2(h)},${o.stern || 't'},${c.hullC},${st.band[0]},${o.sheer ?? 0.3}`;
  const hullGeo = (nu, nv) => boatHull(`${key},${nu}`, l, w, h, { stern: o.stern || 'transom', sheer: o.sheer ?? 0.3, rocker: 0.18, col: c.hullC, deckCol: C.plank, band: [st.band[0], 0.62, 0.78], strakes: nu > 12 ? 6 : 0, nu, nv });
  const g0 = hullGeo(48, 30), g1 = hullGeo(20, 10), g2 = hullGeo(10, 6);
  K.add([g0, g0, g1, g2, g2, g2], 0xffffff, x0, y0, z, { r: 0.75 });
  const top = g0.userData.top, halfW = g0.userData.halfW;
  // the rail (a cap along the sheer, both sides) and a wale lower down
  const rail = (s, yk, r, col, lv, name) => {
    const pts = []; for (let i = 1; i < 18; i++) { const u = i / 18; pts.push([(u - 0.5) * l, top(u) * yk, s * (halfW(u) * (yk > 0.95 ? 1 : 0.985) + r * 0.4)]); }
    K.detail(lv, () => K.add(taper(`${name}${key}${s}${yk}`, pts, [r, r], 26, 4), col, x0, y0, z, { r: 0.6, m: col === st.metal ? st.metalM : 0 }));
  };
  for (const s of [-1, 1]) { rail(s, 1.0, Math.max(0.035, h * 0.06), shade(c.hullC, 0.6), 5, 'rail'); rail(s, 0.55, Math.max(0.025, h * 0.04), st.metal, 2, 'wale'); }
  // carvings along the outboard side under the rail
  const side = Math.sign(z) || 1, n = Math.max(3, Math.round(l / (h * 1.1)));
  K.detail(2, () => {
    for (let i = 0; i < n; i++) {
      const u = 0.16 + (0.7 * (i + 0.5)) / n, x = (u - 0.5) * l, y = top(u) * 0.84, zz = side * (halfW(u) * 0.99 + 0.01);
      K.push(x0 + x, y0 + y, z + zz, 0, side > 0 ? 0 : PI, 0); motif(K, st, h * 0.55); K.pop();
    }
  });
  // stem-post finial
  K.push(x0 + l / 2 - w * 0.06, y0 + top(1) - 0.02, z); finial(K, st, clamp(h * 0.6, 0.25, 0.6)); K.pop();
  return { x0, top: (u) => y0 + top(u), deckY: (u) => y0 + top(u) - h * 0.1, halfW };
}

/** crossbeams from the main hull's side out to a float at z; arched if arch */
function crossBeams(c, xs, z, yIn, yOut, r, arch = 0) {
  const K = c.kit;
  for (const x of xs) {
    const zi = Math.sign(z) * Math.max(0.1, c.hw(x) - 0.25), mid = (zi + z) / 2;
    const yTop = Math.max(yIn, yOut) + arch;
    const pts = [[x, yIn, zi], [x, lerp(yIn, yTop, 0.85), lerp(zi, mid, 0.55)], [x, yTop, mid], [x, lerp(yOut, yTop, 0.7), lerp(z, mid, 0.5)], [x, yOut, z]];
    K.add(taper(`aka${f2(x)}${f2(z)}${f2(yIn)}${f2(yOut)}${f2(arch)}`, pts, [r, r * 0.9, r * 0.85, r * 0.9, r], 14, 7), shade(C.wood, 1.1), 0, 0, 0, { r: 0.7 });
    K.detail(1, () => { for (const p of [pts[0], pts[2]]) for (let k = -1; k <= 1; k++) K.add(G.tor(r * 1.25, r * 0.22, 3, 8), C.rope, p[0] + k * r * 0.5, p[1], p[2], { ry: PI / 2 }); });
  }
}

/** a paddle wheel turning about z, built at the origin */
function wheel(r, w, n, col, hubCol, trim) {
  const K = new Kit();
  K.add(G.cyl(r * 0.16, r * 0.16, w * 1.2, 12), hubCol, 0, 0, 0, { rx: PI / 2, m: 0.55, r: 0.4 });
  for (const s of [-1, 1]) {
    K.add(G.tor(r * 0.92, r * 0.045, 5, 28), hubCol, 0, 0, s * w * 0.45, { m: 0.5, r: 0.45 });
    K.add(G.tor(r * 0.55, r * 0.03, 4, 20), hubCol, 0, 0, s * w * 0.45, { m: 0.5, r: 0.45 });
    K.add(G.cyl(r * 0.24, r * 0.24, w * 0.06, 12), trim, 0, 0, s * w * 0.6, { rx: PI / 2, m: 0.55, r: 0.35 });
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2;
    K.add(G.rbox(r * 0.46, r * 0.07, w * 0.96, r * 0.02), col, Math.cos(a) * r * 0.76, Math.sin(a) * r * 0.76, 0, { rz: a, r: 0.85 });
    for (const s of [-1, 1]) K.bar([0, 0, s * w * 0.45], [Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, s * w * 0.45], r * 0.024, hubCol, { m: 0.5 });
    K.detail(1, () => { for (const s of [-1, 1]) K.add(G.sph(r * 0.025, 4, 3), trim, Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, s * w * 0.48, { m: 0.6 }); });
  }
  return K.mesh(undefined, `wheel${f2(r)},${f2(w)},${n},${col},${hubCol},${trim}`);
}

/** an oar or sweep pointing along +z from its thole: a tapered loom and a shaped blade */
function oarGeo(len, col) {
  return G.custom(`oar${f2(len)},${col}`, () => {
    const K = new Kit();
    K.add(taper(`oarloom${f2(len)}`, [[0, 0, -0.25], [0, 0, len * 0.4], [0, 0, len * 0.8]], [0.032, 0.028, 0.022], 6, 5), col);
    K.add(G.sph(0.4, 8, 4), shade(col, 0.88), 0, 0, len * 0.9, { sx: 0.05, sy: 0.32, sz: (0.11 * len) / 0.4 });
    K.add(G.cyl(0.04, 0.04, 0.12, 6), C.dark, 0, 0, -0.2, { rx: PI / 2 });
    return K.build();
  });
}

export const HULL_PARTS = {
  // ---- hull forms ----
  catamaran(c) {
    // a twin-hulled ship: a full second hull on each side and a planked bridge deck tying all three together
    const l = (c.bowX - c.sternX) * 0.88, w = clamp(c.B * 0.42, 0.7, 2.2), h = Math.max(0.55, c.dy * 0.9);
    const gap = clamp(c.B * 0.18, 0.25, 0.8);
    for (const s of [-1, 1]) {
      const z = s * (Math.max(c.hw(0), c.hw(c.L * 0.2)) + gap + w / 2);
      const f = floatHull(c, z, l, w, h, -h * 0.32, { sheer: 0.32 });
      const xs = [f.x0 - l * 0.3, f.x0 - l * 0.05, f.x0 + l * 0.22];
      const yd = Math.min(c.dy * 0.92, f.deckY(0.5) + 0.05);
      crossBeams(c, xs, z, yd, f.deckY(0.5) + 0.04, clamp(c.B * 0.045, 0.07, 0.14));
      // the bridge deck between her side and the float: planks laid across the beams
      const zi = s * (c.hw(f.x0) - 0.1), zo = z - s * w * 0.42, wz = Math.abs(zo - zi), np = Math.max(5, Math.round((xs[2] - xs[0]) / 0.22));
      c.kit.detail(2, () => { for (let i = 0; i <= np; i++) {
        const x = lerp(xs[0] - 0.12, xs[2] + 0.12, i / np);
        c.kit.add(G.rbox(0.2, 0.05, wz, 0.012), shade(C.plank, 0.88 + hash(i * 3 + s) * 0.24), x, yd + 0.1, (zi + zo) / 2, { r: 0.85 });
      } });
      c.kit.add(G.box(xs[2] - xs[0] + 0.44, 0.05, wz), C.plank, (xs[0] + xs[2]) / 2, yd + 0.1, (zi + zo) / 2, { r: 0.85, from: 3 });
      c.kit.detail(2, () => { for (const x of [xs[0] - 0.14, xs[2] + 0.14]) c.kit.add(G.box(0.08, 0.06, wz), C.dark, x, yd + 0.07, (zi + zo) / 2); });
      // a rail and stanchions on the bridge's outer edge
      c.kit.detail(2, () => {
        for (let i = 0; i <= 4; i++) { const x = lerp(xs[0], xs[2], i / 4); c.kit.add(G.cyl(0.025, 0.03, 0.4, 5), C.dark, x, yd + 0.32, zo + s * 0.05); }
        c.kit.bar([xs[0], yd + 0.5, zo + s * 0.05], [xs[2], yd + 0.5, zo + s * 0.05], 0.025, C.dark);
      });
    }
  },
  trimaran(c) {
    // two slim amas on curved akas (arched outrigger beams), lashed on
    const l = (c.bowX - c.sternX) * 0.66, w = clamp(c.B * 0.26, 0.4, 1.2), h = Math.max(0.4, c.dy * 0.6);
    for (const s of [-1, 1]) {
      const z = s * (c.hw(0) + c.B * 0.5 + w / 2);
      const f = floatHull(c, z, l, w, h, -h * 0.3, { stern: 'point', sheer: 0.45, x0: c.L * 0.02 });
      crossBeams(c, [f.x0 - l * 0.3, f.x0 + l * 0.26], z, c.dy * 0.95, f.deckY(0.5) + 0.06, clamp(c.B * 0.022, 0.04, 0.07), clamp(c.B * 0.05, 0.08, 0.22));
    }
  },
  outriggers(c) {
    // a carved log float each side with upswept ends, on bowed booms and forked stanchions
    const l = (c.bowX - c.sternX) * 0.5, r = clamp(c.B * 0.075, 0.13, 0.26), st = c.st;
    for (const s of [-1, 1]) {
      const z = s * (c.hw(0) + c.B * 0.75), x0 = c.L * 0.02;
      const stations = [[-l * 0.62, r * 1.3, 0, r * 0.15, r * 0.2], [-l * 0.5, r * 0.6, 0, r * 0.7, r * 0.75], [-l * 0.3, r * 0.4, 0, r, r], [l * 0.3, r * 0.4, 0, r, r], [l * 0.5, r * 0.6, 0, r * 0.7, r * 0.75], [l * 0.64, r * 1.6, 0, r * 0.12, r * 0.18]];
      c.kit.add(loftL(`outr${f2(l)},${f2(r)},${c.hullC}`, stations, { radial: 18, sub: 6, col: shade(C.wood, 1.05), ridge: shade(C.wood, 0.8), disp: (t, a) => 1 + 0.02 * (noise3(t * 30, Math.cos(a) * 3, Math.sin(a) * 3) - 0.5), paint: (t) => (t > 0.12 && t < 0.16) || (t > 0.84 && t < 0.88) ? st.band[0] : null }), 0xffffff, x0, -r * 0.1, z, { r: 0.8 });
      c.kit.push(x0 + l * 0.64, r * 1.5, z); finial(c.kit, st, r * 2.4); c.kit.pop();
      for (const x of [x0 - l * 0.28, x0 + l * 0.28]) {
        const zi = s * (c.hw(x) - 0.15), ym = c.dy + 0.4;
        c.kit.add(taper(`boom${f2(x)}${f2(z)}${f2(c.dy)}`, [[x, c.dy * 0.95, zi], [x, ym, (zi + z) * 0.5], [x, r * 2.6, z - s * 0.05]], [0.06, 0.055, 0.045], 10, 5), C.dark, 0, 0, 0, { r: 0.75 });
        // a forked stanchion from the float to the boom
        for (const dx of [-1, 1]) c.kit.bar([x + dx * r * 0.6, r * 0.9, z], [x, r * 2.6, z - s * 0.05], 0.03, C.dark);
        c.kit.detail(1, () => { for (let k = -1; k <= 1; k++) c.kit.add(G.tor(r * 1.05, 0.02, 3, 10), C.rope, x + k * 0.04, r * 0.45, z, { ry: PI / 2 }); });
      }
    }
  },
  raft(c) {
    // a bed of bark-skinned logs (cut ends pale), three cross-logs lashed over them, a fender log down each side
    const W = c.B * 0.82, r = clamp(c.B * 0.065, 0.13, 0.24), n = Math.max(6, Math.round((2 * W) / (2 * r * 1.02)));
    for (let i = 0; i < n; i++) {
      const z = -W + ((2 * W) * (i + 0.5)) / n, l = c.L * (0.92 + hash(i) * 0.14), dx = (hash(i + 9) - 0.5) * c.L * 0.06, col = shade(C.wood, 0.78 + hash(i + 3) * 0.35);
      const bend = (hash(i + 21) - 0.5) * r * 0.6;
      c.kit.add(loftL(`rlog2${f2(l)},${f2(r)},${f2(bend)}`, [[-l / 2, 0, 0, r * 0.96, r * 0.96], [-l / 6, bend * 0.6, 0, r, r], [l / 6, bend, 0, r * 0.97, r * 0.97], [l / 2, 0, 0, r * 0.92, r * 0.92]], { radial: 40, sub: 12, col: 0xffffff, disp: bark(l, r) }), col, dx - c.L * 0.02, r * 0.3, z, { r: 0.92, grain: 0 });
      c.kit.detail(2, () => { for (const e of [-1, 1]) { c.kit.add(G.cyl(r * 0.9, r * 0.9, 0.02, 10), 0xc8a878, dx - c.L * 0.02 + e * (l / 2 + 0.005), r * 0.3, z, { rz: PI / 2 }); c.kit.detail(1, () => c.kit.add(G.tor(r * 0.5, 0.008, 3, 10), 0x9a7a4a, dx - c.L * 0.02 + e * (l / 2 + 0.012), r * 0.3, z, { ry: PI / 2 })); } });
    }
    for (const x of [-0.36, -0.1, 0.14, 0.38].map((f) => f * c.L)) {
      c.kit.add(logL(2 * W + 0.35, r * 0.7), shade(C.wood, 0.7), x, r * 1.3, 0, { ry: PI / 2, r: 0.9, grain: 0 });
      c.kit.detail(1, () => { for (let i = 0; i < n; i += 2) { const z = -W + ((2 * W) * (i + 0.5)) / n; c.kit.add(G.tor(r * 0.95, 0.024, 3, 10), C.rope, x, r * 0.95, z, { rx: 0, ry: 0, rz: 0, sx: 0.7, sy: 1.3 }); } });
    }
    for (const s of [-1, 1]) c.kit.add(logL(c.L * 0.9, r * 0.8), shade(C.wood, 0.85), -c.L * 0.02, r * 0.7, s * (W + r * 0.5), { r: 0.9, grain: 0 });
  },
  lowHull(c) {
    // a low, sleek line: a sloped armour skirt hugging the waterline (riveted plates), a spray rail and a knife forefoot
    const col = shade(blend(c.hullC, C.iron, 0.4), 0.7), st = c.st, n = 12;
    const x0 = c.sternX + c.L * 0.06, x1 = c.bowX - c.L * 0.1;
    for (const s of [-1, 1]) {
      const pts = [], hi = [];
      for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n), y0 = Math.max(0.05, c.dy * 0.08), y1 = Math.max(0.35, c.dy * 0.62); pts.push([x, y0, s * (c.sideZ(x, y0) + 0.07)]); hi.push([x, y1, s * (c.sideZ(x, y1) + 0.05)]); }
      // the skirt: a strip from low to high
      const g = c.kit;
      const geo = skirt(`skirt${c.def.id}${s}`, pts, hi);
      g.add(geo, col, 0, 0, 0, { m: 0.5, r: 0.45 });
      g.add(taper(`spray${c.def.id}${s}`, hi.map(([x, y, z]) => [x, y + 0.02, z + s * 0.03]), [0.04, 0.04], 24, 4), st.metal, 0, 0, 0, { m: st.metalM, r: 0.4 });
      g.detail(1, () => { for (let i = 0; i <= n; i++) { const [x, y, z] = pts[i], [, y2, z2] = hi[i]; for (let k = 1; k < 4; k++) { const t = k / 4; g.add(G.sph(0.03, 4, 3), C.steel, x, lerp(y, y2, t), lerp(z, z2, t) + s * 0.02, { m: 0.6 }); } } });
      g.detail(2, () => { for (let i = 1; i < n; i++) { const [x, y, z] = pts[i], [, y2, z2] = hi[i]; g.bar([x, y, z + s * 0.012], [x, y2, z2 + s * 0.012], 0.014, shade(col, 0.7), { m: 0.5 }); } });
    }
    // the forefoot: a lofted knife running into the stem
    const fy = Math.max(0.25, c.dy * 0.5), fl = clamp(c.L * 0.14, 0.9, 2);
    c.kit.add(loftL(`foot${f2(fl)},${f2(fy)}`, [[-fl * 0.6, fy * 0.55, 0, 0.18, fy * 0.5], [0, fy * 0.45, 0, 0.1, fy * 0.45], [fl * 0.5, fy * 0.2, 0, 0.03, fy * 0.2], [fl * 0.62, 0.05, 0, 0.005, 0.02]], { radial: 8, sub: 2, col: 0xffffff }), col, c.bowX - fl * 0.25, 0, 0, { m: 0.55, r: 0.4 });
  },
  boxHull(c) {
    // slab sides of heavy planks on outside ribs, a sloped bow and stern plate, iron corner straps: a barge, not a ship
    const xs = c.sternX + 0.15, xb = c.bowX - c.L * 0.1, l = xb - xs, x0 = (xs + xb) / 2;
    const ws = []; for (let i = 0; i <= 8; i++) ws.push(c.hw(lerp(xs, xb, i / 8)));
    ws.sort((a, b) => a - b);
    const h = c.dy + 0.3, col = c.hullC, z = ws[4] + 0.06, st = c.st, np = Math.max(4, Math.round(h / 0.2));
    for (const s of [-1, 1]) {
      for (let k = 0; k < np; k++) c.kit.add(G.rbox(l, h / np - 0.012, 0.1, 0.02), shade(col, 0.88 + hash(k + s) * 0.22), x0, -0.12 + (h * (k + 0.5)) / np, s * z, { r: 0.85 });
      for (let k = 0; k <= 6; k++) c.kit.add(G.rbox(0.13, h + 0.05, 0.08, 0.02), C.dark, xs + (l * k) / 6, h / 2 - 0.1, s * (z + 0.07));
      c.kit.add(G.rbox(l + 0.1, 0.12, 0.2, 0.03), st.metal === st.carve ? shade(c.trimC, 1) : st.band[0], x0, h - 0.1, s * (z + 0.02), { m: 0.25 });
      c.kit.detail(1, () => { for (let k = 0; k <= 6; k++) for (let j = 0; j < np; j++) c.kit.add(G.sph(0.022, 4, 3), C.iron, xs + (l * k) / 6, -0.12 + (h * (j + 0.5)) / np, s * (z + 0.115), { m: 0.6 }); });
      // a painted band and the realm's carvings between the ribs
      c.kit.detail(2, () => { for (let k = 0; k < 6; k++) { c.kit.push(xs + (l * (k + 0.5)) / 6, h * 0.62, s * (z + 0.06), 0, s > 0 ? 0 : PI, 0); motif(c.kit, st, Math.min(l / 6 * 0.75, h * 0.5)); c.kit.pop(); } });
    }
    for (const [x, sx] of [[xb, 1], [xs, -1]]) {
      c.kit.add(G.rbox(0.12, h * 1.05, 2 * z + 0.1, 0.03), shade(col, 0.95), x + sx * h * 0.12, h / 2 - 0.12, 0, { rz: sx * 0.35 });
      c.kit.add(G.rbox(0.18, 0.12, 2 * z + 0.2, 0.03), c.trimC, x - sx * h * 0.05, h - 0.12, 0, { m: 0.3 });
      for (const s of [-1, 1]) c.kit.add(G.rbox(0.1, h, 0.14, 0.02), C.iron, x + sx * h * 0.06, h / 2 - 0.12, s * (z + 0.04), { rz: sx * 0.35, m: 0.55, r: 0.45 });
      c.kit.detail(1, () => { for (let j = 0; j < 5; j++) for (const s of [-0.6, 0, 0.6]) c.kit.add(G.sph(0.025, 4, 3), C.iron, x + sx * (h * 0.12 + 0.07) - sx * j * 0.04, -0.05 + (h * j) / 5, s * z, { m: 0.6 }); });
    }
  },
  ghost(c) {
    c.ghost = true;
    // drifting corpse-lights round her, and rags of grave-cloth trailing from her rails
    const n = 9, motes = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const o = new THREE.Mesh(G.sph(0.07 + hash(i) * 0.05, 8, 6), wispMat()); o.userData.base = [lerp(c.sternX, c.bowX, hash(i + 5)), c.dy + 0.4 + hash(i + 2) * 1.6, (hash(i + 7) - 0.5) * c.B * 1.6];
      motes.add(o);
    }
    c.addMoving(motes, (t, ph) => motes.children.forEach((o, i) => { const b = o.userData.base; o.position.set(b[0] + Math.sin(t * 0.7 + i) * 0.3, b[1] + Math.sin(t * 1.3 + i * 2 + ph) * 0.35, b[2] + Math.cos(t * 0.6 + i) * 0.3); }));
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
      const x = lerp(c.sternX + c.L * 0.15, c.bowX - c.L * 0.2, i / 4), y = c.dy + 0.1, z = s * (c.hw(x) + 0.03), ln = 0.5 + hash(i * 7 + s) * 0.6;
      const geo = clothPanel(`rag${f2(ln)}${i}`, (u, v) => [(u - 0.5) * 0.35, -v * ln + (u > 0.5 && v > 0.8 ? -0.1 * hash(u * 9) : 0), 1], 0.04, 4, 5);
      c.kit.add(geo, 0xc8f0d8, x, y, z, { ry: s > 0 ? 0 : PI, r: 0.9, g: 0.15 });
    }
  },
  hover(c) {
    c.lift = clamp(c.B * 0.24, 0.7, 1.2);
    const col = blend(c.trimC, c.st.glow ?? 0x9adfff, 0.5);
    const g = new THREE.Group();
    const disc = new THREE.Mesh(G.circle(1, 32), glowMat(col, 0.3)); disc.rotation.x = -PI / 2; disc.scale.set(c.L * 0.42, c.B * 0.62, 1); disc.position.y = 0.07;
    const ring = new THREE.Mesh(G.ring(0.85, 1, 40), glowMat(col, 0.7)); ring.rotation.x = -PI / 2; ring.scale.set(c.L * 0.48, c.B * 0.7, 1); ring.position.y = 0.09;
    // a band of glyphs turning inside the ring
    const RK = new Kit();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * PI * 2; RK.add(G.box(0.05, 0.01, i % 3 ? 0.14 : 0.22), 0xffffff, Math.cos(a) * 0.74, 0, Math.sin(a) * 0.74, { ry: -a + (i % 2) * 0.6 }); }
    const runes = new THREE.Mesh(RK.build(), glowMat(col, 0.8)); runes.scale.set(c.L * 0.48, 1, c.B * 0.7); runes.position.y = 0.1;
    g.add(disc, ring, runes);
    // shafts of light from her keel to the water
    for (const x of [-0.25, 0.05, 0.3].map((f) => f * c.L)) {
      const j = new THREE.Mesh(G.cyl(0.08, c.B * 0.22, 1, 16, true), glowMat(col, 0.28)); j.scale.y = c.lift; j.position.set(x, c.lift / 2, 0); g.add(j);
    }
    c.hoverGlow = g;
    c.addMoving(g, (t, ph) => { const k = 0.75 + 0.25 * Math.sin(t * 2.4 + ph); disc.material.opacity = 0.3 * k; const s = 1 + 0.06 * Math.sin(t * 1.7 + ph); ring.scale.set(c.L * 0.48 * s, c.B * 0.7 * s, 1); runes.rotation.y = t * 0.3; });
    // the keel stones that hold her up
    c.kit.detail(2, () => { for (const x of [-0.25, 0.05, 0.3].map((f) => f * c.L)) { c.kit.add(G.oct(0.16), col, x, 0.05, 0, { sy: 1.6, g: 1.6, r: 0.2 }); c.kit.add(G.tor(0.2, 0.03, 4, 12), c.st.metal, x, 0.12, 0, { rx: PI / 2, m: c.st.metalM }); } });
  },
  // ---- drive ----
  paddles(c) {
    if (c.def.kind === 'paddleGalleon') return; // her class turns her own great wheels
    const r = clamp(c.dy * 0.9, 0.6, 1.4), w = clamp(c.B * 0.22, 0.4, 0.9), x = -c.L * 0.06, st = c.st;
    for (const s of [-1, 1]) {
      const z = s * (c.hw(x) + w / 2 + 0.06);
      const wh = wheel(r, w, 12, C.wood, C.iron, st.metal); wh.position.set(x, r * 0.45, z);
      c.addMoving(wh, (t) => { wh.rotation.z = -t * 1.6; });
      // the housing: a half drum with a carved fan and the realm's device on its face
      c.kit.add(G.custom('box-housing', () => new THREE.CylinderGeometry(1, 1, 1, 20, 1, true, -PI / 2, PI)), c.hullC, x, r * 0.45, z, { rx: PI / 2, sx: r * 1.12, sy: w * 1.2, sz: r * 1.12 });
      c.kit.add(G.custom('half-disc', () => new THREE.CircleGeometry(1, 20, 0, PI)), shade(c.hullC, 0.9), x, r * 0.45, z + s * w * 0.6, { sx: r * 1.12, sy: r * 1.12, ry: s > 0 ? 0 : PI });
      c.kit.add(G.tor(r * 1.12, 0.05, 4, 20, PI), st.metal, x, r * 0.45, z + s * w * 0.6, { m: st.metalM, r: 0.4 });
      c.kit.detail(2, () => {
        for (let i = 1; i < 6; i++) { const a = (i / 6) * PI; c.kit.bar([x, r * 0.45, z + s * w * 0.61], [x + Math.cos(a) * r * 1.1, r * 0.45 + Math.sin(a) * r * 1.1, z + s * w * 0.61], 0.022, st.carve, { m: st.metalM * 0.5 }); }
        c.kit.push(x, r * 0.45 + r * 0.55, z + s * (w * 0.62 + 0.01), 0, s > 0 ? 0 : PI, 0); emblemOn(c.kit, st, r * 0.6, { depth: 0.05 }); c.kit.pop();
      });
      c.kit.add(G.rbox(r * 2.3, 0.08, w * 1.3, 0.02), c.trimC, x, r * 0.45 + 0.02, z, { m: 0.3 });
    }
  },
  sternWheel(c) {
    const r = clamp(c.dy * 1.05, 0.7, 1.6), w = c.B * 0.7, x = c.sternX - r * 0.75, st = c.st;
    const wh = wheel(r, w, 12, C.wood, C.iron, st.metal); wh.position.set(x, r * 0.5, 0);
    c.addMoving(wh, (t) => { wh.rotation.z = -t * 1.4; });
    for (const s of [-1, 1]) {
      c.kit.add(taper(`swarm${f2(r)}${f2(w)}${s}a`, [[c.sternX + 0.4, c.dy, s * w * 0.48], [x, r * 0.5, s * w * 0.62]], [0.08, 0.07], 4, 6), C.dark);
      c.kit.add(taper(`swarm${f2(r)}${f2(w)}${s}b`, [[c.sternX + 0.2, c.dy + r * 0.9, s * w * 0.48], [x, r * 0.5, s * w * 0.62]], [0.065, 0.06], 4, 6), C.dark);
      c.kit.add(G.cyl(0.12, 0.12, 0.25, 10), C.iron, x, r * 0.5, s * w * 0.62, { rx: PI / 2, m: 0.6 });
      c.kit.detail(1, () => c.kit.add(G.cyl(0.06, 0.06, 0.28, 6), st.metal, x, r * 0.5, s * w * 0.66, { rx: PI / 2, m: st.metalM }));
    }
    // a gabled hood over the wheel with the realm's device on its back
    c.kit.add(G.rbox(r * 1.5, 0.1, w * 1.08, 0.03), c.hullC, x + r * 0.15, r * 1.55, 0);
    c.kit.add(G.cyl(0.02, r * 0.75, w * 1.08, 3), shade(c.hullC, 0.8), x + r * 0.15, r * 1.6, 0, { rx: PI / 2, sx: 1, sz: 0.35 });
    c.kit.detail(2, () => { c.kit.push(x - r * 0.62, r * 1.75, 0, 0, -PI / 2, 0); emblemOn(c.kit, st, r * 0.5, { depth: 0.05 }); c.kit.pop(); });
  },
  oars(c) {
    if (c.nativeOars) return; // the sculpted class rows her own
    const n = clamp(Math.round(c.L * 0.7), 4, 11), len = c.B * 0.55 + 1.1;
    const geo = oarGeo(len, C.wood), inst = new THREE.InstancedMesh(geo, sculptMaterial(), n * 2);
    const xs = Array.from({ length: n }, (_, i) => lerp(c.sternX + c.L * 0.18, c.bowX - c.L * 0.22, n === 1 ? 0.5 : i / (n - 1)));
    const pins = [];
    for (const s of [-1, 1]) for (const x of xs) {
      const z = s * (c.hw(x) + 0.02), y = Math.min(c.deckAt(x, s * c.B * 0.28), c.dy + 0.3) - 0.05;
      pins.push([x, y, z, s]);
      // an oar port: a dark round hole in a carved boss
      c.kit.add(G.cyl(0.08, 0.09, 0.06, 10), c.st.metal, x, y, z, { rx: PI / 2, m: c.st.metalM, r: 0.4 });
      c.kit.add(G.cyl(0.05, 0.05, 0.07, 8), C.black, x, y, z + s * 0.005, { rx: PI / 2 });
    }
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const set = (t, ph) => {
      const a = t * 2.4 + ph;
      pins.forEach(([x, y, z, s], i) => {
        const sw = Math.sin(a) * 0.38, dip = 0.38 + Math.cos(a) * 0.14;
        e.set(dip, s > 0 ? -sw : PI + sw, 0, 'YXZ');
        inst.setMatrixAt(i, mtx.compose(p.set(x, y, z), q.setFromEuler(e), one));
      });
      inst.instanceMatrix.needsUpdate = true;
    };
    set(0, 0);
    inst.frustumCulled = false;
    c.addMoving(inst, set);
  },
  stacks(c) {
    const n = c.L > 9 ? 2 : 1, h = clamp(1.4 + c.L * 0.14, 1.6, 3.2), r = clamp(c.B * 0.07, 0.18, 0.36), st = c.st;
    const puffs = [];
    for (let i = 0; i < n; i++) {
      const at = c.place(r + 0.15, n === 1 ? -0.05 : 0.08 - i * 0.2, 'c');
      // a raked, tapered funnel with banding, a flared crown and a base collar
      c.kit.add(G.lathe(`funnel${f2(r)}${f2(h)}`, [[r * 1.45, 0], [r * 1.35, 0.12], [r * 1.12, 0.2], [r * 1.05, h * 0.5], [r, h * 0.86], [r * 1.25, h * 0.94], [r * 1.32, h], [r * 0.9, h * 0.99]], 16), C.iron, at.x, at.y, at.z, { m: 0.5, r: 0.5 });
      for (const y of [0.3, 0.7]) c.kit.add(G.cyl(r * 1.11, r * 1.11, h * 0.05, 16), st.band[0], at.x, at.y + h * y, at.z, { m: 0.2, r: 0.6 });
      c.kit.add(G.cyl(r * 1.1, r * 1.1, h * 0.06, 16), st.metal, at.x, at.y + h * 0.82, at.z, { m: st.metalM, r: 0.4 });
      c.kit.add(G.cyl(r * 0.85, r * 0.85, 0.02, 12), C.fire, at.x, at.y + h * 0.97, at.z, { g: 1.5 });
      c.kit.detail(1, () => { for (let k = 0; k < 12; k++) { const a = (k / 12) * PI * 2; c.kit.add(G.sph(0.02, 4, 3), C.iron, at.x + Math.cos(a) * r * 1.13, at.y + h * 0.5, at.z + Math.sin(a) * r * 1.13, { m: 0.6 }); } for (const s of [-1, 1]) c.kit.bar([at.x, at.y + h * 0.75, at.z], [at.x - 0.4, at.y + 0.02, at.z + s * (r + 0.5)], 0.012, C.iron, { m: 0.5 }); });
      for (let k = 0; k < 3; k++) puffs.push({ x: at.x, y: at.y + h, z: at.z, k, r });
    }
    const grp = new THREE.Group(), sm = smokeMat();
    for (const p of puffs) { const o = new THREE.Mesh(G.ico(1, 1), sm); o.userData.p = p; grp.add(o); }
    c.topAt = Math.max(c.topAt || 0, puffs[0].y + 1.5);
    c.addMoving(grp, (t, ph) => grp.children.forEach((o) => {
      const p = o.userData.p, f = (t * 0.35 + p.k / 3 + ph * 0.1) % 1;
      o.position.set(p.x - f * 1.2, p.y + 0.15 + f * 1.4, p.z); o.scale.setScalar(p.r * (0.6 + f * 1.3));
    }));
  },
  treadWheel(c) {
    const l = (c.bowX - c.sternX) * 0.58, h = clamp(c.dy * 0.95, 0.6, 1.4), w = clamp(c.B * 0.18, 0.35, 0.8), x0 = (c.bowX + c.sternX) / 2 - c.L * 0.05, st = c.st;
    for (const s of [-1, 1]) {
      const z = s * (c.hw(x0) + w / 2 + 0.04), yc = h * 0.42;
      c.kit.push(x0, yc, z);
      // the track: a stadium of iron shoes over road wheels, a skirt with the realm's device
      c.kit.add(G.box(l - h, 0.1, w), C.iron, 0, h / 2, 0, { m: 0.6, r: 0.5 }).add(G.box(l - h, 0.1, w), C.iron, 0, -h / 2, 0, { m: 0.6, r: 0.5 });
      for (const e of [-1, 1]) c.kit.add(G.custom('half-drum', () => new THREE.CylinderGeometry(1, 1, 1, 16, 1, true, 0, PI)), C.iron, e * (l - h) / 2, 0, 0, { rx: PI / 2, rz: e > 0 ? PI : 0, sx: h / 2, sz: h / 2, sy: w, order: 'XZY', m: 0.6 });
      const nShoe = Math.round((l - h) / 0.16);
      for (let k = 0; k <= nShoe; k++) for (const yy of [1, -1]) c.kit.add(G.rbox(0.08, 0.06, w * 1.05, 0.015), C.steel, -(l - h) / 2 + ((l - h) * k) / nShoe, yy * (h / 2 + 0.06), 0, { m: 0.7, r: 0.4 });
      for (let k = 0; k < 6; k++) {
        const x = -(l - h) / 2 + ((l - h) * k) / 5;
        c.kit.add(G.cyl(h * 0.34, h * 0.34, w * 0.6, 14), C.darkStone, x, 0, s * w * 0.2, { rx: PI / 2, m: 0.4 });
        c.kit.add(G.cyl(h * 0.12, h * 0.12, w * 0.7, 8), st.metal, x, 0, s * w * 0.22, { rx: PI / 2, m: st.metalM, r: 0.4 });
      }
      c.kit.add(G.rbox(l * 0.86, h * 0.36, 0.06, 0.02), shade(c.hullC, 0.8), 0, h * 0.3, s * w * 0.55);
      c.kit.detail(2, () => { c.kit.push(0, h * 0.3, s * w * 0.59, 0, s > 0 ? 0 : PI, 0); emblemOn(c.kit, st, h * 0.32, { depth: 0.08 }); c.kit.pop(); });
      c.kit.pop();
    }
  },
};

/** a strip between two polylines (lo and hi, same length) */
function skirt(key, lo, hi) {
  return G.custom(`sk${key}`, () => {
    const P = [], idx = [];
    for (let i = 0; i < lo.length; i++) P.push(...lo[i], ...hi[i]);
    for (let i = 0; i < lo.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  });
}

const mats = {};
function glowMat(col, op) { const k = `g${col},${op}`; return (mats[k] ||= new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })).clone(); }
function wispMat() { return (mats.wisp ||= new THREE.MeshBasicMaterial({ color: 0x8affa8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); }
function smokeMat() { return (mats.smoke ||= new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 1, transparent: true, opacity: 0.5, depthWrite: false })); }
export { glowMat };

// ---------- her own rig ----------
/** a tapered mast with a doubling, a top and a truck; returns nothing (adds to K) */
function mast(K, c, x, y0, hgt, r) {
  K.add(G.lathe(`mast${f2(hgt)}${f2(r)}`, [[r * 1.25, 0], [r * 1.2, 0.12], [r, 0.2], [r * 0.85, hgt * 0.6], [r * 0.6, hgt * 0.98], [0, hgt]], 9), C.dark, x, y0, 0, { r: 0.75 });
  K.add(G.cyl(r * 2.6, r * 2.2, r * 0.9, 10), shade(C.dark, 0.9), x, y0 + hgt * 0.72, 0);
  K.add(G.sph(r * 1.0, 8, 6), c.st.metal, x, y0 + hgt + r * 0.6, 0, { m: c.st.metalM, r: 0.4 });
  K.detail(1, () => { for (const y of [0.25, 0.45]) K.add(G.tor(r * 1.0, r * 0.18, 3, 10), C.iron, x, y0 + hgt * y, 0, { rx: PI / 2, m: 0.5 }); });
}
/** standing rigging: shrouds to both rails, stays fore and aft (fine detail) */
function shrouds(K, c, x, yTop, nPer = 3) {
  K.detail(1, () => {
    for (const s of [-1, 1]) for (let k = 0; k < nPer; k++) {
      const xx = x - 0.2 - k * 0.22, z = s * (c.hw(xx) - 0.02), y = c.deckAt(xx, s * c.B * 0.3) + 0.15;
      K.bar([x, yTop, 0], [xx, y, z], 0.012, 0x2a2218);
      if (k === 0) for (let j = 1; j < 5; j++) { const t = j / 5; K.bar([lerp(x, xx, t), lerp(yTop, y, t), lerp(0, z, t)], [lerp(x, xx - 0.44, t), lerp(yTop, y, t), lerp(0, z, t)], 0.007, 0x2a2218); } // ratlines
    }
    const fy = c.deckAt(c.bowX - 0.3) + 0.3, ay = c.deckAt(c.sternX + 0.3) + 0.4;
    K.bar([x, yTop, 0], [c.bowX - 0.2, fy, 0], 0.013, 0x2a2218).bar([x, yTop * 0.98, 0], [c.sternX + 0.3, ay, 0], 0.011, 0x2a2218);
  });
}

export function buildRig(c, style) {
  const K = c.kit, st = c.st, n = clamp((c.def.sails | 0) || (c.L > 9 ? 2 : 1), 1, 3);
  const XS = { 1: [0.04], 2: [0.17, -0.17], 3: [0.27, 0.02, -0.25] }[n];
  const base = clamp(1.4 + c.L * 0.5, 3.2, 8.4);
  const sail = c.sailC, mastC = C.dark, rr = 0.07 * c.k;
  let top = 0;
  XS.forEach((f, i) => {
    const x = f * c.L, y0 = c.deckAt(x, 0), main = i === (n === 3 ? 1 : 0), mh = base * (main ? 1 : 0.84);
    c.taken.push([x, 0, 0.3]); c.keep.push([x, 0, 0.3]);
    const hgt = style === 'lateen' ? mh * 0.72 : mh;
    mast(K, c, x, y0, hgt, rr);
    (c.masts ||= []).push({ x, span: style === 'lateen' ? clamp(c.L * 0.36, 2.4, 5.2) * 0.62 : style === 'junkSails' ? clamp(c.L * 0.24, 1.6, 3.4) * 0.8 : 0.7 });
    if (style !== 'lateen' && style !== 'junkSails') shrouds(K, c, x, y0 + hgt * 0.92);
    top = Math.max(top, y0 + hgt);
    if (style === 'squareSail' || style === 'tatteredSails') {
      const tat = style === 'tatteredSails', col = tat ? shade(sail, 0.78) : sail;
      const tiers = [[c.B * 1.05, mh * 0.3, mh * 0.24], [c.B * 0.82, mh * 0.24, mh * 0.58]];
      tiers.forEach(([w, h, yb], j) => {
        const fn = (u, v) => {
          let y = v * h; const xx = (u - 0.5) * w * (1 - v * 0.08);
          if (tat && v === 0) y = h * (0.08 + 0.3 * hash(u * 13 + j));
          if (tat && (u === 0 || u === 1)) y = Math.max(y, h * 0.1 * hash(v * 7));
          return [xx, y];
        };
        const belly = h * 0.22, key = `${tat ? 't' : 's'}${f2(w)},${f2(h)},${j}`;
        const g0 = clothPanel(`${key}a2`, fn, belly, 30, 18, { u: 6, v: 3, fold: belly * 0.12 }), g1 = clothPanel(`${key}b2`, fn, belly, 12, 8, { u: 6, v: 3 }), g2 = clothPanel(`${key}c`, fn, belly, 5, 3);
        K.add([g0, g0, g1, g2, g2, g2], col, x + 0.1, y0 + yb, 0, { ry: PI / 2, r: 0.95 });
        // the yard, with its lifts and footropes
        K.add(G.lathe(`yard${f2(w)}`, [[0, -w * 0.56], [0.03, -w * 0.5], [0.05, 0], [0.03, w * 0.5], [0, w * 0.56]], 7), mastC, x + 0.08, y0 + yb + h, 0, { rx: PI / 2 });
        K.detail(1, () => { for (const s of [-1, 1]) { K.bar([x + 0.08, y0 + hgt * 0.96, 0], [x + 0.08, y0 + yb + h, s * w * 0.52], 0.008, 0x2a2218); K.bar([x + 0.08 + belly, y0 + yb + 0.02, s * w * 0.3], [c.sternX * 0.3 + x * 0.7, c.deckAt(x - 0.6) + 0.2, s * c.hw(x - 0.6) * 0.9], 0.008, 0x2a2218); } });
        if (tat) K.detail(2, () => { for (let q = 0; q < 3; q++) { const zz = (hash(q + j * 3 + i) - 0.5) * w * 0.8; K.add(G.box(0.02, h * 0.35, 0.12), col, x + 0.14, y0 + yb - h * 0.1, zz, { rz: 0.15 }); } });
        // the realm's device on the main course, conformed to the belly
        if (j === 0 && main) K.detail(2, () => { K.push(x + 0.1, y0 + yb, 0, 0, PI / 2, 0); emblemOn(K, st, Math.min(w, h) * 0.62, { at: [0, h * 0.5], cloth: (px, py) => belly * Math.sin(PI * clamp(px / w + 0.5, 0, 1)) * (0.35 + 0.65 * Math.sin(PI * clamp(py / h, 0, 1))), faded: tat, key: `sq${key}` }); K.pop(); });
      });
      if (!tat) K.add(G.cyl(0.04, 0.04, c.B * 1.15, 6), mastC, x + 0.08, y0 + mh * 0.24, 0, { rx: PI / 2 });
    } else if (style === 'junkSails') {
      const w = clamp(c.L * 0.24, 1.6, 3.4), h = mh * 0.72, yb = y0 + mh * 0.16;
      const fn = (u, v) => [lerp(w * 0.3, -w * 0.7, u), v * h * (1 + 0.22 * u) + Math.sin(v * PI * 6) * 0.0];
      const key = `j${f2(w)},${f2(h)}`;
      const g0 = clothPanel(`${key}a2`, (u, v) => [...fn(u, v), 0.6 + 0.4 * Math.abs(Math.sin(v * PI * 6))], 0.14, 20, 36, { v: 6, dark: 0.7, fold: 0.012 }), g1 = clothPanel(`${key}b`, fn, 0.12, 6, 6);
      K.add([g0, g0, g1, g1, g1, g1], sail, x, yb, 0.08, { r: 0.9 });
      for (let b = 0; b <= 6; b++) { const v = b / 6; K.bar([x + w * 0.3, yb + v * h, 0.1], [x - w * 0.7, yb + v * h * 1.22, 0.1], 0.03, C.black); K.detail(2, () => K.bar([x + w * 0.3, yb + v * h, 0.06], [x - w * 0.7, yb + v * h * 1.22, 0.06], 0.03, C.black)); }
      // the sheetlets fanning from each batten end to one block
      K.detail(1, () => { const bx = x - w * 0.95, by = yb + h * 0.35; for (let b = 1; b <= 6; b++) K.bar([x - w * 0.7, yb + (b / 6) * h * 1.22, 0.08], [bx, by, 0.08], 0.007, 0x2a2218); });
      K.detail(2, () => { K.push(x - w * 0.2, yb, 0.08); emblemOn(K, st, Math.min(w, h) * 0.45, { at: [0, h * 0.62], cloth: () => 0.13, key: `jk${key}`, col: [st.cloth2, st.metal] }); K.pop(); });
    } else if (style === 'lateen') {
      const span = clamp(c.L * 0.36, 2.4, 5.2);
      const A = [x + span * 0.42, y0 + hgt * 0.55], Bp = [x - span * 0.58, y0 + mh * 1.02], Cp = [x - span * 0.45, y0 + 0.45];
      const fn = (u, v) => [lerp(lerp(A[0], Bp[0], u), Cp[0], v), lerp(lerp(A[1], Bp[1], u), Cp[1], v), Math.sin(PI * Math.min(1, v * 1.6)) * (1 - v)];
      const key = `lat${c.def.id}|${i}`;
      const g0 = clothPanel(`${key}a2`, fn, 0.5, 26, 16, { u: 5, fold: 0.05 }), g1 = clothPanel(`${key}b`, fn, 0.5, 10, 7, { u: 5 });
      K.add([g0, g0, g1, g1, g1, g1], sail, 0, 0, 0.1, { r: 0.9 });
      K.add(taper(`latyard${key}`, [[A[0] + 0.25, A[1] - 0.1, 0.1], [(A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2 + 0.05, 0.1], [Bp[0] - 0.15, Bp[1] + 0.08, 0.1]], [0.035, 0.06, 0.025], 10, 6), mastC);
      K.detail(1, () => { K.bar([A[0] + 0.2, A[1] - 0.08, 0.1], [c.bowX - 0.2, c.deckAt(c.bowX - 0.3) + 0.2, 0], 0.01, 0x2a2218); K.bar([Cp[0], Cp[1], 0.1], [c.sternX + 0.4, c.deckAt(c.sternX + 0.4) + 0.3, 0], 0.01, 0x2a2218); for (const s of [-1, 1]) K.bar([x, y0 + hgt * 0.95, 0], [x - 0.3, c.deckAt(x - 0.3) + 0.15, s * c.hw(x - 0.3) * 0.95], 0.011, 0x2a2218); });
      K.detail(2, () => { const cx = (A[0] + Bp[0] + Cp[0]) / 3, cy = (A[1] + Bp[1] + Cp[1]) / 3; K.push(cx, cy, 0.1); emblemOn(K, st, span * 0.26, { at: [0, 0], cloth: () => 0.32, key: `lk${key}` }); K.pop(); });
      top = Math.max(top, Bp[1]);
    } else if (style === 'leafSails') {
      const w = c.B * 1.0, h = mh * 0.68, yb = y0 + mh * 0.22, col = blend(sail, C.leaf, 0.25);
      const fn = (u, v) => [(u - 0.5) * w * Math.pow(Math.sin(PI * clamp(v * 0.94 + 0.03, 0, 1)), 0.75), v * h];
      const key = `leaf${f2(w)},${f2(h)}`;
      const g0 = clothPanel(`${key}a2`, fn, h * 0.12, 20, 24, { fold: h * 0.01 }), g1 = clothPanel(`${key}b`, fn, h * 0.12, 8, 10);
      K.add([g0, g0, g1, g1, g1, g1], col, x + 0.1, yb, 0, { ry: PI / 2, r: 0.7 });
      const ribX = x + 0.1 + h * 0.12;
      K.add(taper(`leafrib${key}`, [[ribX, yb, 0], [ribX + h * 0.02, yb + h * 0.5, 0], [ribX - h * 0.02, yb + h, 0]], [0.04, 0.012], 10, 5), shade(col, 0.55));
      K.detail(2, () => { for (let v = 1; v < 7; v++) for (const s of [-1, 1]) { const yy = yb + (v * h) / 7.2, half = w * 0.45 * Math.pow(Math.sin(PI * clamp((v / 7.2) * 0.94 + 0.03, 0, 1)), 0.75); K.add(taper(`vein${key}${v}${s}`, [[ribX, yy, 0], [ribX - h * 0.02, yy + h * 0.06, s * half * 0.5], [ribX - h * 0.08, yy + h * 0.1, s * half * 0.9]], [0.018, 0.005], 6, 3), shade(col, 0.62)); } });
      K.add(G.tor(0.5, 0.05, 4, 10, PI), C.leaf, x + 0.1, yb + h, 0, { ry: PI / 2 });
      K.detail(1, () => { for (let k = 0; k < 5; k++) K.add(G.sph(0.08, 6, 4), blend(C.leaf, 0xd8ff6a, 0.3), x + 0.1 + (hash(k) - 0.5) * 0.2, yb + h * (0.1 + k * 0.2), (hash(k + 3) - 0.5) * w * 0.2, { sx: 1.6, sy: 0.3, rz: hash(k) * 3 }); });
    } else if (style === 'silkSails') {
      const w = c.B * 0.98, h = mh * 0.68, yb = y0 + mh * 0.2, bands = 4;
      for (let b = 0; b < bands; b++) {
        const hb = h / bands;
        const fn = (u, v) => { let y = v * hb; if (b === 0 && v === 0) y = hb * 0.25 * Math.abs(Math.sin(u * PI * 3)); return [(u - 0.5) * w * (1 - ((b + v) / bands) * 0.12), y]; };
        const geo = [clothPanel(`silk2${f2(w)},${f2(hb)},${b}`, fn, h * 0.13, 24, 6, { u: 4, fold: hb * 0.05 }), clothPanel(`silk${f2(w)},${f2(hb)},${b}`, fn, h * 0.13, 12, 3)];
        const geoL = [geo[0], geo[0], geo[1], geo[1], geo[1], geo[1]];
        K.add(geoL, b % 2 ? c.trimC : sail, x + 0.1, yb + b * hb, 0, { ry: PI / 2, r: 0.35, m: 0.1 });
        K.detail(2, () => K.add(G.cyl(0.018, 0.018, w * (1 - (b / bands) * 0.12), 5), st.metal, x + 0.1 + h * 0.13 * 0.4, yb + b * hb, 0, { rx: PI / 2, m: st.metalM }));
      }
      K.add(G.cyl(0.04, 0.04, w * 1.1, 6), C.gold, x + 0.08, yb + h, 0, { rx: PI / 2, m: 0.7, r: 0.3 });
      for (const s of [-1, 1]) {
        K.add(clothPanel(`silkstreamer${f2(h)}`, (u, v) => [(u - 0.5) * 0.12, -v * h * 0.6, 1], 0.03, 2, 8), c.trimC, x + 0.08, yb + h, s * w * 0.56, { r: 0.35 });
        K.detail(2, () => K.add(G.sph(0.06, 6, 4), st.metal, x + 0.08, yb + h, s * w * 0.56, { m: st.metalM }));
      }
      K.detail(2, () => { K.push(x + 0.1, yb, 0, 0, PI / 2, 0); emblemOn(K, st, Math.min(w, h) * 0.5, { at: [0, h * 0.55], cloth: () => h * 0.13 * 0.95, key: `sk${f2(w)}${f2(h)}`, col: [st.cloth2, st.metal] }); K.pop(); });
    }
    // her own pennant at the masthead
    const ph = style === 'lateen' ? 0 : hgt;
    if (ph) K.add(clothPanel('pennant', (u, v) => [-u, (v - 0.5) * 0.24 * (1 - u), 1], 0.06, 6, 1), c.side, x, y0 + ph + 0.12, 0, { sx: 1.2 * c.k, sy: 1.4 * c.k });
  });
  c.topAt = Math.max(c.topAt || 0, top + 0.3);
}
