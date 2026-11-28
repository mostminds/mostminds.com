// Hull forms, rigs and drives for a designed ship (see ../shipParts.js for the context `c` every builder gets).
import * as THREE from 'three';
import { Kit, G, C, shade, blend, clamp, lerp } from './kit.js';
import { sculptMaterial } from '../sculpt.js';

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

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** a cloth panel: a grid over u (across) and v (up) mapped by fn(u, v) -> [x, y], bellied along z */
function cloth(key, fn, belly, nu = 6, nv = 6) {
  return G.custom(`cloth${key}`, () => {
    const P = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, [x, y, bk] = fn(u, v);
      P.push(x, y, belly * Math.sin(Math.PI * u) * (bk ?? (0.35 + 0.65 * Math.sin(Math.PI * clamp(v, 0, 1)))));
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, d = a + nu + 1, e = d + 1; idx.push(a, b, e, a, e, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}

/** a slim boat hull, pointed at +x: length l, width w, height h, keel at y = 0 */
function pontoon(l, w, h) {
  return G.custom(`pont${l.toFixed(2)},${w.toFixed(2)},${h.toFixed(2)}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-l / 2, -w * 0.4); s.quadraticCurveTo(-l / 2 - w * 0.15, 0, -l / 2, w * 0.4);
    s.lineTo(l / 2 - w * 1.4, w / 2); s.quadraticCurveTo(l / 2 - w * 0.3, w * 0.35, l / 2, 0);
    s.quadraticCurveTo(l / 2 - w * 0.3, -w * 0.35, l / 2 - w * 1.4, -w / 2); s.lineTo(-l / 2, -w * 0.4);
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: h * 0.12, bevelSize: w * 0.12, bevelSegments: 2, curveSegments: 6 });
    g.rotateX(-Math.PI / 2); return g;
  });
}

function twinHull(c, z, l, w, h) {
  const K = c.kit, x0 = (c.bowX + c.sternX) / 2 - c.L * 0.03;
  K.add(pontoon(l, w, h), c.hullC, x0, -h * 0.35, z, { r: 0.75 });
  K.add(G.box(l * 0.82, 0.05, w * 0.8), C.plank, x0 - l * 0.04, h * 0.65 + 0.03, z);
  K.add(G.box(l * 0.8, 0.07, 0.06), c.trimC, x0 - l * 0.04, h * 0.66, z + w * 0.45, { m: 0.4 });
  K.add(G.box(l * 0.8, 0.07, 0.06), c.trimC, x0 - l * 0.04, h * 0.66, z - w * 0.45, { m: 0.4 });
  return x0;
}

/** beams from the main hull's rail out to a float at z */
function beams(c, xs, z, y0, y1, w = 0.16) {
  for (const x of xs) {
    const inner = Math.sign(z) * Math.max(0.1, c.hw(x) - 0.2), mid = (inner + z) / 2;
    c.kit.add(G.box(w, w * 0.8, Math.abs(z - inner) + 0.3), C.dark, x, (y0 + y1) / 2 + 0.06, mid, { rx: Math.atan2(y0 - y1, z - inner) * Math.sign(z) * 0 });
    c.kit.bar([x, y1, inner], [x, y0, z], w * 0.45, C.dark);
  }
}

/** a paddle wheel turning about z, built at the origin */
function wheel(r, w, n, col, hubCol) {
  const K = new Kit();
  K.add(G.cyl(r * 0.16, r * 0.16, w * 1.15, 8), hubCol, 0, 0, 0, { rx: Math.PI / 2, m: 0.6, r: 0.4 });
  for (const s of [-1, 1]) K.add(G.tor(r * 0.92, r * 0.05, 4, 18), hubCol, 0, 0, s * w * 0.45, { m: 0.5, r: 0.5 });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    K.add(G.box(r * 0.48, r * 0.06, w * 0.95), col, Math.cos(a) * r * 0.74, Math.sin(a) * r * 0.74, 0, { rz: a });
    for (const s of [-1, 1]) K.bar([0, 0, s * w * 0.45], [Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, s * w * 0.45], r * 0.025, hubCol, { m: 0.5 });
  }
  return K.mesh();
}

/** an oar or sweep pointing along +z from its thole, blade at the far end */
function oarGeo(len, col) {
  const K = new Kit();
  K.add(G.cyl(0.025, 0.03, len, 5), col, 0, 0, len / 2, { rx: Math.PI / 2 });
  K.add(G.box(0.03, 0.12, len * 0.18), shade(col, 0.85), 0, 0, len * 0.92);
  return K.build();
}

export const HULL_PARTS = {
  // ---- hull forms ----
  catamaran(c) {
    const w = c.B * 0.5, l = (c.bowX - c.sternX) * 0.86, h = Math.max(0.5, c.dy * 0.85);
    const z = -(c.hw(0) + 0.55 + w / 2);
    const x0 = twinHull(c, z, l, w, h);
    // a bridging deck and beams between the hulls
    const xs = [x0 - l * 0.3, x0, x0 + l * 0.28];
    for (const x of xs) c.kit.add(G.box(0.22, 0.16, Math.abs(z) + w * 0.3), C.dark, x, h * 0.7, z / 2);
    c.kit.add(G.box(l * 0.62, 0.06, Math.abs(z) - c.hw(0) - w * 0.4 + 0.3), C.plank, x0 - l * 0.02, h * 0.72, z / 2 - c.hw(0) / 2 + w * 0.05);
  },
  trimaran(c) {
    const w = c.B * 0.3, l = (c.bowX - c.sternX) * 0.62, h = Math.max(0.35, c.dy * 0.55);
    for (const s of [-1, 1]) {
      const z = s * (c.hw(0) + c.B * 0.42 + w / 2);
      const x0 = twinHull(c, z, l, w, h);
      beams(c, [x0 - l * 0.28, x0 + l * 0.25], z, h * 0.75, c.dy * 0.95, 0.16);
    }
  },
  outriggers(c) {
    const l = (c.bowX - c.sternX) * 0.48, r = clamp(c.B * 0.07, 0.12, 0.24);
    for (const s of [-1, 1]) {
      const z = s * (c.hw(0) + c.B * 0.75), x0 = c.L * 0.02;
      c.kit.add(G.cyl(r, r, l, 7), C.wood, x0, r * 0.4, z, { rz: Math.PI / 2 });
      c.kit.add(G.cone(r, r * 3, 7), C.wood, x0 + l / 2 + r * 1.5, r * 0.4, z, { rz: -Math.PI / 2 });
      c.kit.add(G.cone(r, r * 2, 7), C.wood, x0 - l / 2 - r, r * 0.4, z, { rz: Math.PI / 2 });
      for (const x of [x0 - l * 0.28, x0 + l * 0.28]) {
        const zi = s * (c.hw(x) - 0.15), ym = c.dy + 0.35;
        c.kit.bar([x, c.dy * 0.95, zi], [x, ym, (zi + z) / 2], 0.05, C.dark).bar([x, ym, (zi + z) / 2], [x, r * 1.2, z], 0.05, C.dark);
        c.kit.add(G.tor(r * 1.1, 0.025, 3, 8), C.rope, x, r * 0.4, z, { ry: Math.PI / 2 });
      }
    }
  },
  raft(c) {
    const W = c.B * 0.82, r = clamp(c.B * 0.065, 0.13, 0.24), n = Math.max(6, Math.round((2 * W) / (2 * r * 1.05)));
    for (let i = 0; i < n; i++) {
      const z = -W + ((2 * W) * (i + 0.5)) / n, l = c.L * (0.92 + hash(i) * 0.14), dx = (hash(i + 9) - 0.5) * c.L * 0.06;
      c.kit.add(G.cyl(r, r * 0.95, l, 6), shade(C.wood, 0.8 + hash(i + 3) * 0.35), dx - c.L * 0.02, r * 0.3, z, { rz: Math.PI / 2 });
    }
    for (const x of [-0.38, -0.12, 0.14, 0.36].map((f) => f * c.L)) {
      c.kit.add(G.box(0.16, 0.12, 2 * W + 0.2), C.dark, x, r * 1.3, 0);
      for (const s of [-1, 1]) c.kit.add(G.tor(r * 1.05, 0.03, 3, 8), C.rope, x, r * 0.3, s * W * 0.9, { ry: Math.PI / 2 });
    }
  },
  lowHull(c) {
    // a low, sleek line: an armoured spray skirt along the waterline and a knife-edged forefoot
    const l = (c.bowX - c.sternX) * 0.78, x0 = (c.bowX + c.sternX) / 2 - c.L * 0.04, col = shade(c.hullC, 0.55), h = Math.max(0.35, c.dy * 0.5);
    for (const s of [-1, 1]) {
      const z = s * (c.hw(x0) + 0.08);
      c.kit.add(G.box(l, h, 0.07), col, x0, h * 0.45, z, { rx: s * 0.45, m: 0.5, r: 0.45 });
      c.kit.add(G.box(l * 1.01, 0.06, 0.09), c.trimC, x0, h * 0.85, z - s * h * 0.18, { m: 0.6, r: 0.35 });
    }
    c.kit.add(G.shape('lowfoot', [[0, 0], [1, 0.15], [0, 1]], 0.1), col, c.bowX - 0.2, 0, 0, { sx: c.L * 0.12, sy: c.dy * 0.8, m: 0.5 });
  },
  boxHull(c) {
    // slab sides and a squared bow: a barge, not a ship
    const xs = c.sternX + 0.15, xb = c.bowX - c.L * 0.1, l = xb - xs, x0 = (xs + xb) / 2;
    let hwM = 0; for (let i = 0; i <= 8; i++) hwM = Math.max(hwM, c.hw(lerp(xs, xb, i / 8)));
    const h = c.dy + 0.15, col = c.hullC, z = hwM + 0.05;
    for (const s of [-1, 1]) {
      c.kit.add(G.box(l, h, 0.1), col, x0, h / 2 - 0.12, s * z);
      for (let k = 1; k < 4; k++) c.kit.add(G.box(l, 0.035, 0.12), shade(col, 0.7), x0, (h * k) / 4 - 0.12, s * z);
      for (let k = 0; k <= 5; k++) c.kit.add(G.box(0.12, h + 0.05, 0.14), C.dark, xs + (l * k) / 5, h / 2 - 0.1, s * z);
      c.kit.add(G.box(l, 0.1, 0.2), c.trimC, x0, h - 0.1, s * z, { m: 0.3 });
    }
    for (const [x, sx] of [[xb, 1], [xs, -1]]) {
      c.kit.add(G.box(0.12, h, 2 * z), col, x, h / 2 - 0.12, 0, { rz: sx * 0.32 });
      c.kit.add(G.box(0.18, 0.1, 2 * z + 0.1), c.trimC, x - sx * h * 0.15, h - 0.12, 0, { m: 0.3 });
    }
  },
  ghost(c) {
    c.ghost = true;
    // drifting corpse-lights round her
    const K = new Kit(), n = 7;
    for (let i = 0; i < n; i++) K.add(G.sph(0.12 + hash(i) * 0.08, 6, 4), 0x9affb0, 0, 0, 0, { g: 3 });
    const g = K.build(), motes = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const o = new THREE.Mesh(G.sph(0.11 + hash(i) * 0.08, 6, 4), wispMat()); o.userData.base = [lerp(c.sternX, c.bowX, hash(i + 5)), c.dy + 0.4 + hash(i + 2) * 1.6, (hash(i + 7) - 0.5) * c.B * 1.6];
      motes.add(o);
    }
    void g;
    c.addMoving(motes, (t, ph) => motes.children.forEach((o, i) => { const b = o.userData.base; o.position.set(b[0] + Math.sin(t * 0.7 + i) * 0.3, b[1] + Math.sin(t * 1.3 + i * 2 + ph) * 0.35, b[2] + Math.cos(t * 0.6 + i) * 0.3); }));
  },
  hover(c) {
    c.lift = clamp(c.B * 0.24, 0.7, 1.2);
    const col = blend(c.trimC, 0x9adfff, 0.35);
    const g = new THREE.Group();
    const disc = new THREE.Mesh(G.circle(1, 24), glowMat(col, 0.45)); disc.rotation.x = -Math.PI / 2; disc.scale.set(c.L * 0.42, c.B * 0.62, 1); disc.position.y = 0.07;
    const ring = new THREE.Mesh(G.ring(0.85, 1, 28), glowMat(col, 0.7)); ring.rotation.x = -Math.PI / 2; ring.scale.set(c.L * 0.48, c.B * 0.7, 1); ring.position.y = 0.09;
    g.add(disc, ring);
    // shafts of light from her keel to the water
    for (const x of [-0.25, 0.05, 0.3].map((f) => f * c.L)) {
      const j = new THREE.Mesh(G.cyl(0.08, c.B * 0.22, 1, 10, true), glowMat(col, 0.28)); j.scale.y = c.lift; j.position.set(x, c.lift / 2, 0); g.add(j);
    }
    c.hoverGlow = g;
    c.addMoving(g, (t, ph) => { const k = 0.75 + 0.25 * Math.sin(t * 2.4 + ph); disc.material.opacity = 0.45 * k; const s = 1 + 0.06 * Math.sin(t * 1.7 + ph); ring.scale.set(c.L * 0.48 * s, c.B * 0.7 * s, 1); });
  },
  // ---- drive ----
  paddles(c) {
    if (c.def.kind === 'paddleGalleon') return; // her class turns her own great wheels
    const r = clamp(c.dy * 0.9, 0.6, 1.4), w = clamp(c.B * 0.22, 0.4, 0.9), x = -c.L * 0.06;
    for (const s of [-1, 1]) {
      const z = s * (c.hw(x) + w / 2 + 0.06);
      const wh = wheel(r, w, 10, C.wood, C.iron); wh.position.set(x, r * 0.45, z);
      c.addMoving(wh, (t) => { wh.rotation.z = -t * 1.6; });
      c.kit.add(G.custom('box-housing', () => new THREE.CylinderGeometry(1, 1, 1, 12, 1, true, -Math.PI / 2, Math.PI)), c.hullC, x, r * 0.45, z, { rx: Math.PI / 2, ry: 0, sx: r * 1.12, sy: w * 1.2, sz: r * 1.12, order: 'XYZ' });
      c.kit.add(G.box(r * 2.2, 0.08, w * 1.25), c.trimC, x, r * 0.45 + 0.02, z, { m: 0.3 });
    }
  },
  sternWheel(c) {
    const r = clamp(c.dy * 1.05, 0.7, 1.6), w = c.B * 0.7, x = c.sternX - r * 0.75;
    const wh = wheel(r, w, 10, C.wood, C.iron); wh.position.set(x, r * 0.5, 0);
    c.addMoving(wh, (t) => { wh.rotation.z = -t * 1.4; });
    for (const s of [-1, 1]) {
      c.kit.bar([c.sternX + 0.4, c.dy, s * w * 0.48], [x, r * 0.5, s * w * 0.6], 0.07, C.dark);
      c.kit.bar([c.sternX + 0.2, c.dy + r * 0.9, s * w * 0.48], [x, r * 0.5, s * w * 0.6], 0.06, C.dark);
      c.kit.add(G.cyl(0.1, 0.1, 0.25, 8), C.iron, x, r * 0.5, s * w * 0.6, { rx: Math.PI / 2, m: 0.6 });
    }
    c.kit.add(G.box(r * 1.4, 0.1, w * 1.05), c.hullC, x + r * 0.2, r * 1.5, 0);
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
      c.kit.add(G.box(0.08, 0.1, 0.08), C.dark, x, y, z);
    }
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const set = (t, ph) => {
      const a = t * 2.4 + ph;
      pins.forEach(([x, y, z, s], i) => {
        const sw = Math.sin(a) * 0.38, dip = 0.38 + Math.cos(a) * 0.14;
        e.set(s * dip, s > 0 ? -sw : Math.PI + sw, 0, 'YXZ');
        inst.setMatrixAt(i, mtx.compose(p.set(x, y, z), q.setFromEuler(e), one));
      });
      inst.instanceMatrix.needsUpdate = true;
    };
    set(0, 0);
    inst.frustumCulled = false;
    c.addMoving(inst, set);
  },
  stacks(c) {
    const n = c.L > 9 ? 2 : 1, h = clamp(1.4 + c.L * 0.14, 1.6, 3.2), r = clamp(c.B * 0.07, 0.18, 0.36);
    const puffs = [];
    for (let i = 0; i < n; i++) {
      const at = c.place(r + 0.15, n === 1 ? -0.05 : 0.08 - i * 0.2, 'c');
      c.kit.add(G.cyl(r, r * 1.15, h, 10), C.iron, at.x, at.y + h / 2, at.z, { m: 0.5, r: 0.5 });
      c.kit.add(G.cyl(r * 1.18, r * 1.18, h * 0.08, 10), c.trimC, at.x, at.y + h * 0.82, at.z, { m: 0.6, r: 0.4 });
      c.kit.add(G.cyl(r * 1.25, r * 1.05, h * 0.1, 10), C.black, at.x, at.y + h, at.z, { m: 0.4 });
      c.kit.add(G.cyl(r * 0.8, r * 0.8, 0.02, 10), C.fire, at.x, at.y + h + 0.05, at.z, { g: 1.5 });
      for (let k = 0; k < 3; k++) puffs.push({ x: at.x, y: at.y + h, z: at.z, k, r });
    }
    const grp = new THREE.Group(), sm = smokeMat();
    for (const p of puffs) { const o = new THREE.Mesh(G.ico(1, 0), sm); o.userData.p = p; grp.add(o); }
    c.topAt = Math.max(c.topAt || 0, puffs[0].y + 1.5);
    c.addMoving(grp, (t, ph) => grp.children.forEach((o) => {
      const p = o.userData.p, f = (t * 0.35 + p.k / 3 + ph * 0.1) % 1;
      o.position.set(p.x - f * 1.4, p.y + 0.2 + f * 1.6, p.z); o.scale.setScalar(p.r * (1 + f * 2.2));
    }));
  },
  treadWheel(c) {
    const l = (c.bowX - c.sternX) * 0.58, h = clamp(c.dy * 0.95, 0.6, 1.4), w = clamp(c.B * 0.18, 0.35, 0.8), x0 = (c.bowX + c.sternX) / 2 - c.L * 0.05;
    for (const s of [-1, 1]) {
      const z = s * (c.hw(x0) + w / 2 + 0.04), yc = h * 0.42;
      c.kit.push(x0, yc, z);
      // the track: a stadium of iron shoes
      c.kit.add(G.box(l - h, 0.1, w), C.iron, 0, h / 2, 0, { m: 0.6, r: 0.5 }).add(G.box(l - h, 0.1, w), C.iron, 0, -h / 2, 0, { m: 0.6, r: 0.5 });
      for (const e of [-1, 1]) c.kit.add(G.custom('half-drum', () => new THREE.CylinderGeometry(1, 1, 1, 10, 1, true, 0, Math.PI)), C.iron, e * (l - h) / 2, 0, 0, { rx: Math.PI / 2, rz: e > 0 ? Math.PI : 0, sx: h / 2, sz: h / 2, sy: w, order: 'XZY', m: 0.6 });
      for (let k = 0; k < 14; k++) c.kit.add(G.box(0.08, 0.06, w * 1.05), C.steel, -(l - h) / 2 + ((l - h) * k) / 13, h / 2 + 0.06, 0, { m: 0.7, r: 0.4 });
      for (let k = 0; k < 5; k++) {
        const x = -(l - h) / 2 + ((l - h) * k) / 4;
        c.kit.add(G.cyl(h * 0.34, h * 0.34, w * 0.6, 10), C.darkStone, x, 0, s * w * 0.2, { rx: Math.PI / 2, m: 0.4 });
        c.kit.add(G.cyl(h * 0.12, h * 0.12, w * 0.7, 6), c.trimC, x, 0, s * w * 0.22, { rx: Math.PI / 2, m: 0.7, r: 0.4 });
      }
      c.kit.pop();
    }
  },
};

const mats = {};
function glowMat(col, op) { const k = `g${col},${op}`; return (mats[k] ||= new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })).clone(); }
function wispMat() { return (mats.wisp ||= new THREE.MeshBasicMaterial({ color: 0x8affa8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); }
function smokeMat() { return (mats.smoke ||= new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true })); }
export { glowMat };

// ---------- her own rig ----------
export function buildRig(c, style) {
  const K = c.kit, n = clamp((c.def.sails | 0) || (c.L > 9 ? 2 : 1), 1, 3);
  const XS = { 1: [0.04], 2: [0.17, -0.17], 3: [0.27, 0.02, -0.25] }[n];
  const base = clamp(1.4 + c.L * 0.5, 3.2, 8.4);
  const sail = c.sailC, mastC = C.dark;
  let top = 0;
  XS.forEach((f, i) => {
    const x = f * c.L, y0 = c.deckAt(x, 0), mh = base * (i === (n === 3 ? 1 : 0) ? 1 : 0.84);
    c.taken.push([x, 0, 0.3]); c.keep.push([x, 0, 0.3]);
    const hgt = style === 'lateen' ? mh * 0.72 : mh;
    K.add(G.cyl(0.055 * c.k, 0.085 * c.k, hgt, 7), mastC, x, y0 + hgt / 2, 0);
    top = Math.max(top, y0 + hgt);
    const id = `${c.def.id}|${i}`;
    if (style === 'squareSail' || style === 'tatteredSails') {
      const tat = style === 'tatteredSails', col = tat ? shade(sail, 0.78) : sail;
      const tiers = [[c.B * 1.05, mh * 0.3, mh * 0.24], [c.B * 0.82, mh * 0.24, mh * 0.58]];
      tiers.forEach(([w, h, yb], j) => {
        const geo = cloth(`${tat ? 't' : 's'}${w.toFixed(2)},${h.toFixed(2)},${j}`, (u, v) => {
          let y = v * h; const xx = (u - 0.5) * w * (1 - v * 0.08);
          if (tat && v === 0) y = h * (0.08 + 0.3 * hash(u * 13 + j));
          if (tat && (u === 0 || u === 1)) y = Math.max(y, h * 0.1 * hash(v * 7));
          return [xx, y];
        }, h * 0.22, 6, 4);
        K.add(geo, col, x + 0.1, y0 + yb, 0, { ry: Math.PI / 2, r: 0.95 });
        K.add(G.cyl(0.04, 0.04, w * 1.12, 5), mastC, x + 0.08, y0 + yb + h, 0, { rx: Math.PI / 2 });
        if (tat) for (let q = 0; q < 3; q++) { const zz = (hash(q + j * 3 + i) - 0.5) * w * 0.8; K.add(G.box(0.02, h * 0.35, 0.12), col, x + 0.14, y0 + yb - h * 0.1, zz, { rz: 0.15 }); }
      });
      if (!tat) K.add(G.cyl(0.04, 0.04, c.B * 1.15, 5), mastC, x + 0.08, y0 + mh * 0.24, 0, { rx: Math.PI / 2 });
    } else if (style === 'junkSails') {
      const w = clamp(c.L * 0.24, 1.6, 3.4), h = mh * 0.72, yb = y0 + mh * 0.16;
      const geo = cloth(`j${w.toFixed(2)},${h.toFixed(2)}`, (u, v) => [lerp(w * 0.3, -w * 0.7, u), v * h * (1 + 0.22 * u)], 0.12, 6, 6);
      K.add(geo, sail, x, yb, 0.08, { r: 0.9 });
      for (let b = 0; b <= 6; b++) { const v = b / 6; K.bar([x + w * 0.3, yb + v * h, 0.12], [x - w * 0.7, yb + v * h * 1.22, 0.12], 0.03, C.black); K.bar([x + w * 0.3, yb + v * h, -0.02], [x - w * 0.7, yb + v * h * 1.22, -0.02], 0.03, C.black); }
    } else if (style === 'lateen') {
      const span = clamp(c.L * 0.36, 2.4, 5.2);
      const A = [x + span * 0.42, y0 + hgt * 0.55], Bp = [x - span * 0.58, y0 + mh * 1.02], Cp = [x - span * 0.45, y0 + 0.45];
      const geo = cloth(`lat${id}`, (u, v) => [lerp(lerp(A[0], Bp[0], u), Cp[0], v), lerp(lerp(A[1], Bp[1], u), Cp[1], v), Math.sin(Math.PI * Math.min(1, v * 1.6)) * (1 - v)], 0.5, 6, 5);
      K.add(geo, sail, 0, 0, 0.1, { r: 0.9 });
      K.bar([A[0] + 0.15, A[1] - 0.06, 0.1], [Bp[0] - 0.1, Bp[1] + 0.05, 0.1], 0.045, mastC);
      top = Math.max(top, Bp[1]);
    } else if (style === 'leafSails') {
      const w = c.B * 1.0, h = mh * 0.68, yb = y0 + mh * 0.22, col = blend(sail, C.leaf, 0.25);
      const geo = cloth(`leaf${w.toFixed(2)},${h.toFixed(2)}`, (u, v) => [(u - 0.5) * w * Math.pow(Math.sin(Math.PI * clamp(v * 0.94 + 0.03, 0, 1)), 0.75), v * h], h * 0.12, 6, 8);
      K.add(geo, col, x + 0.1, yb, 0, { ry: Math.PI / 2, r: 0.7 });
      K.bar([x + 0.1 + h * 0.06, yb, 0], [x + 0.1 + h * 0.06, yb + h, 0], 0.035, shade(col, 0.55));
      for (let v = 1; v < 5; v++) for (const s of [-1, 1]) K.bar([x + 0.1 + h * 0.08, yb + (v * h) / 5.2, 0], [x + 0.1 + h * 0.06, yb + (v * h) / 5.2 + h * 0.1, s * w * 0.32 * Math.sin((Math.PI * v) / 5.2)], 0.018, shade(col, 0.6));
      K.add(G.tor(0.5, 0.05, 4, 8, Math.PI), C.leaf, x + 0.1, yb + h, 0, { ry: Math.PI / 2 });
    } else if (style === 'silkSails') {
      const w = c.B * 0.98, h = mh * 0.68, yb = y0 + mh * 0.2, bands = 4;
      for (let b = 0; b < bands; b++) {
        const hb = h / bands;
        const geo = cloth(`silk${w.toFixed(2)},${hb.toFixed(2)},${b}`, (u, v) => {
          let y = v * hb;
          if (b === 0 && v === 0) y = hb * 0.25 * Math.abs(Math.sin(u * Math.PI * 3));
          return [(u - 0.5) * w * (1 - (b + v) / bands * 0.12), y];
        }, h * 0.13, 6, 2);
        K.add(geo, b % 2 ? c.trimC : sail, x + 0.1, yb + b * hb, 0, { ry: Math.PI / 2, r: 0.35, m: 0.1 });
      }
      K.add(G.cyl(0.04, 0.04, w * 1.1, 5), C.gold, x + 0.08, yb + h, 0, { rx: Math.PI / 2, m: 0.7, r: 0.3 });
      for (const s of [-1, 1]) K.add(G.box(0.02, h * 0.55, 0.09), c.trimC, x + 0.08, yb + h * 0.72, s * w * 0.56, { rx: s * 0.1 });
    }
    // her own pennant at the masthead
    const ph = style === 'lateen' ? 0 : hgt;
    if (ph) K.add(G.shape('pennant', [[0, -0.12], [-1, 0], [0, 0.12]]), c.side, x, y0 + ph + 0.12, 0, { sx: 1.2 * c.k, sy: 1.4 * c.k });
  });
  c.topAt = Math.max(c.topAt || 0, top + 0.3);
}
