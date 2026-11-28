// Fringe beasts: the war-animals of the jungle, savannah and hill realms.
//
//   bodies.pangolin(def, o)    { scales }                         giant war-pangolin             kind 'beast.quad' (gait bear, rears to strike)
//   bodies.porcupine(def, o)   { fur, quills }                    crested porcupine              kind 'beast.quad' (gait bear)
//   bodies.badger(def, o)      { fur, stripe, clockwork? }        badger / honey-badger /        kind 'beast.quad' (gait bear), or
//                                                                 clockwork badger               'fringe.clockquad' (the same walk, plus its key and gears turning)
//   bodies.riverOtter(def, o)  { fur, armor }                     armoured giant river-otter     kind 'beast.quad' (gait cat, pounces)
//   bodies.waspSwarm(def, o)   { body2, stripe }                  a cloud of jungle wasps        kind 'fringe.swarm'
//   bodies.dartFrog(def, o)    { skin, spots }                    poison-dart tree-frog          kind 'fringe.frog'
//
// Authoring convention (the same one beasts.js and titans.js use): a model is laid out in ONE space, its rest pose
// (Y up, facing +Z, feet on y = 0). Every node records the point it pivots about (`o`); finish() moves each node's
// pieces into the node's own space. Nodes given `pos` / `rot` are authored in their own frame instead (the wasps).
// Four-legged bodies follow beasts.js's quadruped rig: torso, neck, head, jaw, legs / shins / paws as
// [front-left, front-right, back-left, back-right], tail[] and the foot values plantFeet reads.
// Extra rig keys:  gears[], key        clockwork badger: spun by 'fringe.clockquad' about their own X axis / Y axis
//                  orbits[], wasps[], wings[], nest     swarm: each orbit pivots at the cloud's heart and carries one wasp
//                  tongue, throat      frog
import * as THREE from 'three';
import { S, H, rgb, distanceField } from '../sculpt.js';
import { animators as beastAnimators } from './beasts.js';

const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => mul3(a, 1 / (len3(a) || 1e-9));
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const flat = (x) => [x].flat(Infinity).filter(Boolean);
const mirX = (v) => [-v[0], v[1], v[2]];
const col = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function hashStr(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- colour ----------
const _c = new THREE.Color(), _c2 = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };
function tone(hex, dh = 0, ds = 0, dl = 0) {
  _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace);
  _c.setHSL(((_hsl.h + dh) % 1 + 1) % 1, clamp(_hsl.s + ds), clamp(_hsl.l + dl), THREE.SRGBColorSpace);
  return _c.getHex();
}
function mix(a, b, t) { return _c.set(a).lerp(_c2.set(b), t).getHex(); }
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------- placement ----------
const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler(), _vx = new THREE.Vector3(), _vy = new THREE.Vector3(), _vz = new THREE.Vector3();
function frameEuler(yDir, zHint = [0, 0, 1]) {
  _vy.set(yDir[0], yDir[1], yDir[2]).normalize();
  _vz.set(zHint[0], zHint[1], zHint[2]);
  _vx.crossVectors(_vy, _vz);
  if (_vx.lengthSq() < 1e-8) _vx.crossVectors(_vy, _vz.set(1, 0, 0));
  if (_vx.lengthSq() < 1e-8) _vx.crossVectors(_vy, _vz.set(0, 0, 1));
  _vx.normalize();
  _vz.crossVectors(_vx, _vy);
  _eu.setFromRotationMatrix(_m4.makeBasis(_vx, _vy, _vz), 'XYZ');
  return [_eu.x / DEG, _eu.y / DEG, _eu.z / DEG];
}
/** turn a piece built along +Y so +Y points along yDir (and +Z toward zHint), then move it to origin */
function orient(piece, origin, yDir, zHint) {
  const e = frameEuler(yDir, zHint);
  return piece.rot(e[0], e[1], e[2]).at(origin[0], origin[1], origin[2]);
}
/** tapered capsule from a to b */
function bone(a, b, ra, rb = ra) { return S.capsule(a, b, ra, rb); }
const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

/** march from c + dir * R back toward c until the surface of a distance field; returns the surface point */
function hitFrom(df, c, dir, R = 1.2) {
  const u = norm3(dir);
  let t = R, p = add3(c, mul3(u, t));
  for (let i = 0; i < 80; i++) {
    p = add3(c, mul3(u, t));
    const d = df(p[0], p[1], p[2]);
    if (Math.abs(d) < 0.0008) break;
    t -= d > 0 ? Math.max(d, 0.0015) : d;
    if (t < 0) { t = 0; break; }
  }
  return p;
}
function gradAt(df, p, e = 0.002) {
  return norm3([df(p[0] + e, p[1], p[2]) - df(p[0] - e, p[1], p[2]), df(p[0], p[1] + e, p[2]) - df(p[0], p[1] - e, p[2]), df(p[0], p[1], p[2] + e) - df(p[0], p[1], p[2] - e)]);
}

// ---------- nodes ----------
function node(name, parent, o, extra = {}) { return { name, parent, o, prims: [], hard: [], ...extra }; }
const isHard = (q) => !!(q && q.geo);
/** add a mixed list of prims and hard pieces to a node */
function put(n, list) { for (const q of flat(list)) (isHard(q) ? n.hard : n.prims).push(q); return n; }
function finish(nodes) {
  const by = new Map(nodes.map((n) => [n.name, n]));
  return nodes.map((n) => {
    const par = n.parent ? by.get(n.parent) : null;
    const pos = n.pos ?? (par ? sub3(n.o, par.o) : n.o);
    const prims = flat(n.prims), hard = flat(n.hard);
    if (n.o[0] || n.o[1] || n.o[2]) { for (const p of prims) p.at(-n.o[0], -n.o[1], -n.o[2]); for (const h of hard) h.at(-n.o[0], -n.o[1], -n.o[2]); }
    const out = { name: n.name, pos, prims, hard };
    if (n.parent) out.parent = n.parent;
    if (n.rig) out.rig = n.rig;
    if (n.rot) out.rot = n.rot;
    if (n.detail) out.detail = n.detail;
    if (n.minRes) out.minRes = n.minRes;
    return out;
  });
}
function rigOf() {
  const nodes = [];
  const N = (name, parent, o, extra) => { const n = node(name, parent, o, extra); nodes.push(n); return n; };
  N.nodes = nodes;
  return N;
}
/**
 * a pair of three-segment legs (upper, lower, paw) authored for the LEFT side (+X); the right is mirrored.
 * J = [shoulder or hip, elbow or knee, wrist or ankle]; parts = { up, lo, paw } lists of prims / hard pieces.
 */
function legPair(N, tag, J, parts, det = [0.8, 0.9, 1]) {
  for (const side of [1, -1]) {
    const nm = tag + (side > 0 ? 'L' : 'R');
    const m = (v) => (side > 0 ? v : mirX(v));
    const cp = (list) => flat(list).map((q) => (side > 0 ? q.clone() : q.mirrorX()));
    put(N(`leg${nm}`, 'torso', m(J[0]), { rig: 'legs', detail: det[0], minRes: 18 }), cp(parts.up));
    put(N(`shin${nm}`, `leg${nm}`, m(J[1]), { rig: 'shins', detail: det[1], minRes: 20 }), cp(parts.lo));
    put(N(`paw${nm}`, `shin${nm}`, m(J[2]), { rig: 'paws', detail: det[2], minRes: 22 }), cp(parts.paw));
  }
}
/** the foot values beasts.js's plantFeet reads: the ground contact point in each paw's own space */
const footVals = (JF, zF, JB, zB, s = 1) => ({ footFy: -JF[1], footFz: zF - JF[2], footBy: -JB[1], footBz: zB - JB[2], footS: s });

// ---------- crisp pieces ----------
function clawGeo(hook, aspect, flatX = 1) {
  return cached(`claw${hook}:${aspect}:${flatX}`, () => {
    const g = new THREE.ConeGeometry(aspect, 1, 7, 4);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setXYZ(i, p.getX(i) * flatX, y, p.getZ(i) + hook * y * y); }
    g.computeVertexNormals();
    return g;
  });
}
function claw(len, r, color, hook = 0.3, flatX = 1) { return H.geo(clawGeo(hook, Math.max(0.05, Math.round((r / len) * 20) / 20), flatX)).scale(len).color(color).pbr(0.32, 0); }
/** claw from base pointing along dir, hooking toward `toward` */
const spike = (base, dir, len, r, color, toward = [0, 0, 1], hook = 0.3, flatX = 1) => orient(claw(len, r, color, hook, flatX), base, dir, toward);

function eyeGeo() {
  return cached('eye', () => {
    const angles = [112, 92, 76, 60, 46, 34.4, 33.6, 25, 16.4, 15.6, 9, 0];
    const prof = angles.map((a) => { const r = 1 + 0.05 * Math.max(0, Math.cos(Math.min(90, a * 2.4) * DEG)); return new THREE.Vector2(Math.max(1e-5, Math.sin(a * DEG) * r), Math.cos(a * DEG) * r); });
    return new THREE.LatheGeometry(prof, 16);
  });
}
/** an eyeball whose pupil faces +Y. look: { iris, pupil, white, rim, slit, glow, irisSize, pupilSize } */
function eyeY(r, look = {}) {
  const iris = look.iris ?? 0x3a2410, white = look.white ?? 0x14100c, pupil = look.pupil ?? 0x050404, rim = look.rim ?? tone(iris, 0, 0, -0.12);
  const pA = Math.sin(16 * DEG) * (look.pupilSize ?? 1), iA = Math.sin(34 * DEG) * (look.irisSize ?? 1);
  const h = H.geo(eyeGeo()).shade((x, y, z) => {
    if (y < 0.2) return null;
    const d = Math.hypot(x, z);
    if (look.slit) { if (Math.abs(x) < pA * 0.42 && Math.abs(z) < iA * 0.86) return pupil; } else if (d < pA * 1.01) return pupil;
    if (d < iA * 0.84) return iris;
    if (d < iA) return rim;
    return null;
  }).color(white).pbr(0.1, 0);
  if (look.glow) h.glow(look.glow);
  return h.scale(r);
}
const eyeAt = (p, dir, r, look) => orient(eyeY(r, look), p, dir, [0, 1, 0]);

/**
 * one keeled, imbricated scale plate: root at local z = -0.5, tip at +0.5, its face toward +Y, size 1.
 * Shaded dark at the root, pale along the keel and the worn rim.
 */
function plateGeo() {
  return cached('plate', () => {
    const nu = 4, nv = 3, pos = [], idx = [], uv = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const v = j / nv, u = (i / nu) * 2 - 1;
      const hw = 0.5 * Math.sqrt(Math.max(0, 1 - Math.pow(v, 5))) * (0.88 + 0.5 * v * (1 - v)) + (v === 1 ? 0.13 : 0);
      const y = 0.09 * (1 - u * u) * (0.55 + 0.45 * v) + 0.05 * Math.max(0, 1 - Math.abs(u) * 2.2) * v - 0.05 * u * u * v;
      pos.push(u * hw, y, v - 0.5); uv.push(u, v);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.userData.uv = uv;
    return g;
  });
}
function plate(w, l, cols, rough = 0.5, metal = 0) {
  const g = plateGeo(), uv = g.userData.uv;
  const base = rgb(cols.base), dark = rgb(cols.dark ?? tone(cols.base, 0, 0, -0.16)), pale = rgb(cols.pale ?? tone(cols.base, 0, -0.05, 0.14));
  return H.geo(g).shade((x, y, z, nx, ny, nz, i) => {
    const u = uv[i * 2], v = uv[i * 2 + 1];
    let c = mixRgb(dark, base, smooth(v * 1.7));
    if (Math.abs(u) < 0.3 && v > 0.3) c = mixRgb(c, pale, 0.45);
    if (Math.abs(u) > 0.74 || v > 0.86) c = mixRgb(c, pale, 0.55);
    return c;
  }).color(cols.base).pbr(rough, metal).scale(w, (w + l) / 2, l);
}
/**
 * lay plates over a surface. rows: list of { c: axis point, dirs: [dir...], flow: (dir) => tail-ward direction, w, l }.
 * Each plate is dropped onto df along -dir from outside, tipped up at the tip so the row behind tucks under it.
 */
function layPlates(df, out, specs, cols, opt = {}) {
  const r = opt.rnd || (() => 0.5);
  for (const s of specs) {
    const p = hitFrom(df, s.c, s.dir, s.R ?? 1);
    const n = gradAt(df, p);
    const v = 0.9 + r() * 0.2;
    const shade = { base: tone(cols.base, 0, 0, (r() - 0.5) * (opt.vary ?? 0.06)), dark: cols.dark, pale: cols.pale };
    const pl = plate(s.w * v, s.l * v, shade, opt.rough ?? 0.5, opt.metal ?? 0).rot(-(s.tilt ?? 12), 0, 0).at(0, s.lift ?? 0.004, s.l * 0.18);
    const h = orient(pl, p, n, s.flow);
    out.push(opt.keep ? h : h.near());
  }
  return out;
}
/** quill / spine geometry: a tapering shaft along +Y from 0 to 1 */
function quillGeo(radial = 4, segs = 5) {
  return cached(`quill${radial}:${segs}`, () => {
    const prof = [];
    for (let i = 0; i <= segs; i++) { const t = i / segs; prof.push(new THREE.Vector2(Math.max(0.0001, (t < 0.12 ? 0.6 + t * 3.3 : Math.pow(1 - (t - 0.12) / 0.88, 0.85))), t)); }
    const g = new THREE.LatheGeometry(prof, radial);
    g.computeVertexNormals();
    return g;
  });
}
function quill(base, dir, len, r, bands, toward = [0, 1, 0]) {
  const cs = bands.map((b) => [b[0], rgb(b[1])]);
  const g = H.geo(quillGeo()).shade((x, y) => { for (const [t, c] of cs) if (y <= t) return c; return cs[cs.length - 1][1]; }).color(bands[0][1]).pbr(0.38, 0);
  g.scale(r, len, r);
  return orient(g, base, dir, toward);
}
/** a toothed gear lying in the YZ plane (axis along X) */
function gearGeo(teeth, rOut, rIn, hole) {
  return cached(`gear${teeth}:${rOut}:${rIn}:${hole}`, () => {
    const pts = [];
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2, da = (Math.PI * 2) / teeth;
      for (const [f, r] of [[0, rIn], [0.18, rOut], [0.5, rOut], [0.68, rIn]]) pts.push([Math.cos(a0 + f * da) * r, Math.sin(a0 + f * da) * r]);
    }
    const holes = [];
    if (hole) for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4, ring = [];
      for (let j = 0; j < 8; j++) { const b = (j / 8) * Math.PI * 2; ring.push([Math.cos(a) * rIn * 0.52 + Math.cos(b) * rIn * 0.2, Math.sin(a) * rIn * 0.52 + Math.sin(b) * rIn * 0.2]); }
      holes.push(ring.reverse());
    }
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1, curveSegments: 4 });
    g.translate(0, 0, -0.01);
    g.rotateY(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
}

/** points around a limb axis a -> b: rows at fractions fs, plates at angles phis (0 = up, + toward +X) */
function ringSpecs(a, b, fs, phis, w, l, opt = {}) {
  const t = norm3(sub3(b, a)), up = norm3([0, -t[2], t[1]]), side = norm3(cross3(up, t));
  const out = [];
  fs.forEach((f, ri) => {
    const c = lerp3(a, b, f);
    for (const ph0 of phis) {
      const ph = (ph0 + (ri % 2 ? (opt.stagger ?? 0) : 0)) * DEG;
      const dir = add3(mul3(up, Math.cos(ph)), mul3(side, -Math.sin(ph)));
      out.push({ c, dir, flow: add3(t, mul3(dir, -0.15)), w, l, tilt: opt.tilt, R: opt.R ?? 0.6 });
    }
  });
  return out;
}

// =====================================================================================
//  Giant war-pangolin: arched back under rows of keeled plates, small conical head, great digging claws
// =====================================================================================
function pangolin(def, o = {}) {
  const base = col(o.scales, 0x8a6a4a);
  const rnd = rng(hashStr((def?.id || 'pangolin') + ':pangolin'));
  const C = {
    skin: mix(tone(base, 0, -0.1, -0.04), 0x6a5a56, 0.45), claw: 0x2a221c, nose: 0x241a16,
  };
  const pc = { base: tone(base, 0, 0.04, -0.06), dark: tone(base, 0, 0, -0.26), pale: tone(base, -0.01, -0.06, 0.1) };
  const skin = (q) => q.color(C.skin).pbr(0.85).tint(0.08, 14);
  const armd = (q) => q.color(pc.base).pbr(0.6).tint(0.1, 18);
  const N = rigOf();
  N('root', null, [0, 0, 0]);

  // ---- body ----
  const torso = N('torso', 'root', [0, 0.45, 0], { rig: 'torso', detail: 0.18, minRes: 9 });
  const tp = [
    armd(S.ellipsoid(0.25, 0.235, 0.38).at(0, 0.46, -0.08)),
    armd(S.ellipsoid(0.2, 0.18, 0.2).at(0, 0.39, 0.2).blend(0.1)),
    armd(S.ellipsoid(0.23, 0.22, 0.2).at(0, 0.44, -0.34).blend(0.1)),
    armd(bone([0, 0.45, -0.42], [0, 0.43, -0.55], 0.17, 0.15).blend(0.08)),
    armd(bone([0, 0.41, 0.2], [0, 0.39, 0.32], 0.15, 0.13).blend(0.06)),
    skin(S.ellipsoid(0.2, 0.12, 0.42).at(0, 0.25, -0.06).paint(0.05)),
  ];
  put(torso, tp);
  const dfT = distanceField(tp);
  const specs = [];
  const rows = 12, per = 11;
  for (let i = 0; i < rows; i++) {
    const z = lerp(0.3, -0.5, i / (rows - 1)), off = (i % 2) * 0.5;
    for (let j = 0; j < per - (i % 2); j++) {
      const ph = (-112 + (224 * (j + off)) / (per - 1)) * DEG, s = Math.sin(ph);
      const big = 1 + 0.25 * Math.cos(ph) * Math.sin(Math.PI * (i + 1) / (rows + 1));
      specs.push({ c: [0, 0.42, z], dir: [s, Math.cos(ph), 0], flow: [s * 0.35, -0.08 - 0.3 * Math.abs(s), -1], w: 0.125 * big, l: 0.14 * big, tilt: 8 });
    }
  }
  layPlates(dfT, torso.hard, specs, pc, { rnd });

  // ---- neck and head ----
  const neck = N('neck', 'torso', [0, 0.4, 0.3], { rig: 'neck', detail: 0.28, minRes: 12 });
  const np = [armd(bone([0, 0.4, 0.27], [0, 0.355, 0.46], 0.135, 0.095))];
  put(neck, np);
  layPlates(distanceField(np), neck.hard, ringSpecs([0, 0.41, 0.44], [0, 0.4, 0.28], [0.15, 0.6], [-75, -38, 0, 38, 75], 0.1, 0.11, { stagger: 19, tilt: 12 })
    .map((s) => ({ ...s, flow: mul3(s.flow, 1) })), pc, { rnd });
  const head = N('head', 'neck', [0, 0.355, 0.46], { rig: 'head', detail: 0.48, minRes: 16 });
  const hp = [
    skin(S.ellipsoid(0.085, 0.08, 0.11).at(0, 0.355, 0.52)),
    skin(bone([0, 0.34, 0.57], [0, 0.272, 0.725], 0.06, 0.028).blend(0.05)),
    S.sphere(0.03).at(0, 0.27, 0.735).color(C.nose).pbr(0.4).blend(0.02),
    S.ellipsoid(0.03, 0.006, 0.05).at(0, 0.282, 0.66).cut(0.006),
    ...S.mirrorX([skin(S.ellipsoid(0.022, 0.026, 0.012).rot(0, 30, 0).at(0.074, 0.39, 0.49).blend(0.02))]),
  ];
  put(head, hp);
  put(head, H.mirrorX([eyeAt([0.057, 0.372, 0.572], [0.75, 0.25, 0.6], 0.013)]));
  layPlates(distanceField(hp), head.hard, [
    { c: [0, 0.36, 0.56], dir: [0, 1, 0.15], flow: [0, -0.2, -1], w: 0.06, l: 0.07, tilt: 10 },
    ...[-1, 1].map((sx) => ({ c: [0, 0.36, 0.53], dir: [sx * 0.6, 1, 0], flow: [sx * 0.2, -0.2, -1], w: 0.065, l: 0.075, tilt: 10 })),
    { c: [0, 0.36, 0.48], dir: [0, 1, 0], flow: [0, -0.2, -1], w: 0.08, l: 0.085, tilt: 10 },
  ], pc, { rnd });

  // ---- legs: short forelimbs with three great curved claws, plantigrade hind feet ----
  const JF = [[0.16, 0.38, 0.22], [0.2, 0.22, 0.27], [0.2, 0.085, 0.28]];
  const JB = [[0.17, 0.42, -0.3], [0.21, 0.23, -0.2], [0.2, 0.1, -0.34]];
  const plated = (prims, a, b, phis, w) => { const out = []; layPlates(distanceField(prims), out, ringSpecs(a, b, [0.2, 0.55], phis, w, w * 1.1, { stagger: 15, tilt: 8 }), pc, { rnd }); return out; };
  const fUp = [skin(bone(JF[0], JF[1], 0.1, 0.07)), skin(S.sphere(0.1).at(...JF[0]))];
  const fLo = [skin(bone(JF[1], JF[2], 0.068, 0.052)), skin(S.sphere(0.068).at(...JF[1]))];
  const fPaw = [skin(S.sphere(0.054).at(...JF[2])), skin(S.ellipsoid(0.066, 0.045, 0.07).at(0.2, 0.05, 0.31).blend(0.03))];
  for (const k of [-1, 0, 1]) fPaw.push(spike([0.2 + k * 0.032, 0.06, 0.345], [k * 0.15, -0.5, 1], k ? 0.13 : 0.16, 0.024, C.claw, [0, -1, 0], 0.55, 0.7));
  const bUp = [skin(bone(JB[0], JB[1], 0.12, 0.075)), skin(S.sphere(0.12).at(...JB[0]))];
  const bLo = [skin(bone(JB[1], JB[2], 0.07, 0.054)), skin(S.sphere(0.07).at(...JB[1]))];
  const bPaw = [skin(S.sphere(0.054).at(...JB[2])), skin(S.ellipsoid(0.066, 0.034, 0.11).at(0.2, 0.034, -0.27).blend(0.03))];
  for (let k = -2; k <= 2; k++) bPaw.push(spike([0.2 + k * 0.022, 0.03, -0.17 - Math.abs(k) * 0.012], [k * 0.2, -0.35, 1], 0.06, 0.012, C.claw, [0, -1, 0], 0.4));
  legPair(N, 'F', JF, { up: [...fUp, ...plated(fUp, JF[0], JF[1], [40, 80, 120], 0.085)], lo: fLo, paw: fPaw }, [0.26, 0.3, 0.42]);
  legPair(N, 'B', JB, { up: [...bUp, ...plated(bUp, JB[0], JB[1], [40, 80, 120], 0.095)], lo: bLo, paw: bPaw }, [0.26, 0.3, 0.42]);

  // ---- tail: thick, armoured all round, the edge plates standing proud ----
  const TL = [[0, 0.45, -0.5], [0, 0.38, -0.71], [0, 0.27, -0.88], [0, 0.155, -1.01], [0, 0.07, -1.11]];
  const TR = [0.15, 0.125, 0.095, 0.065, 0.03];
  for (let i = 0; i < 4; i++) {
    const a = TL[i], b = TL[i + 1];
    const n = N(`tail${i}`, i ? `tail${i - 1}` : 'torso', a, { rig: 'tail', detail: 0.3, minRes: 16 });
    const p = [armd(bone(a, b, TR[i], TR[i + 1])), armd(S.sphere(TR[i]).at(...a).blend(0.02))];
    put(n, p);
    const w = TR[i] * 0.9 + 0.035;
    layPlates(distanceField(p), n.hard, ringSpecs(a, b, [0.15, 0.65], [-150, -100, -50, 0, 50, 100, 150], w * 1.1, w * 1.5, { stagger: 25, tilt: 9 }), pc, { rnd });
  }
  return { kind: 'beast.quad', attack: 'bite', gait: 'bear', strike: 'rear', girth: 2.2, ...footVals(JF[2], 0.31, JB[2], -0.27, 1.2), nodes: finish(N.nodes) };
}


/** banded quill colours: dark root, alternating dark and pale, pale tip */
const quillBands = (pale, dark, n = 5) => { const out = []; for (let i = 0; i < n; i++) out.push([(i + 1) / n - (i === n - 1 ? 0 : 0.02), i % 2 ? pale : dark]); out[out.length - 1][1] = pale; return out; };
/** jittered direction */
const jit = (d, r, a) => norm3([d[0] + (r() - 0.5) * a, d[1] + (r() - 0.5) * a, d[2] + (r() - 0.5) * a]);

// =====================================================================================
//  Crested porcupine: low dark body under a raised fan of long banded quills, a white crest over the head
// =====================================================================================
function porcupine(def, o = {}) {
  const furC = col(o.fur, 0x4a3a2a), qc = col(o.quills, 0xe8e0d0);
  const rnd = rng(hashStr((def?.id || 'porcupine') + ':porcupine'));
  const C = { fur: furC, dark: mix(furC, 0x0c0a08, 0.55), nose: 0x1a1412, pale: qc, qdark: mix(furC, 0x0a0806, 0.75), tooth: 0xd8802a, claw: 0x2a221c };
  const fur = (q, c = C.fur) => q.color(c).pbr(0.92).tint(0.12, 22).bump(0.006, 40, 'fur');
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.28, 0], { rig: 'torso', detail: 0.26, minRes: 10 });
  const tp = [
    fur(S.ellipsoid(0.2, 0.17, 0.3).at(0, 0.28, -0.05)),
    fur(S.ellipsoid(0.2, 0.18, 0.17).at(0, 0.28, -0.25).blend(0.08)),
    fur(S.ellipsoid(0.15, 0.14, 0.15).at(0, 0.25, 0.16).blend(0.08)),
    fur(S.ellipsoid(0.14, 0.08, 0.3).at(0, 0.17, -0.06).blend(0.06), C.dark),
  ];
  put(torso, tp);
  const dfT = distanceField(tp);
  const bands = quillBands(C.pale, C.qdark, 6), bandsShort = quillBands(C.pale, C.qdark, 3);
  // the great quills: rows over the back, fanned up and back
  for (let i = 0; i < 9; i++) {
    const z = lerp(0.1, -0.36, i / 8), per = 9 - (i % 2);
    for (let j = 0; j < per; j++) {
      const ph = (-78 + (156 * (j + (i % 2) * 0.5)) / 8) * DEG;
      const p = hitFrom(dfT, [0, 0.26, z], [Math.sin(ph), Math.cos(ph), 0]);
      const n = gradAt(dfT, p);
      const d = jit(add3(mul3(n, 0.6), [0, 0.5, -0.75 - i * 0.04]), rnd, 0.35);
      const L = (0.3 + 0.16 * Math.cos(ph) * Math.sin(Math.PI * (i + 1) / 10) + rnd() * 0.06);
      torso.hard.push(quill(add3(p, mul3(n, -0.01)), d, L, 0.0085, bands).near());
    }
  }
  // short flank quills lying back along the sides
  for (let i = 0; i < 6; i++) for (const sx of [1, -1]) for (const yy of [0, 1]) {
    const z = lerp(0.14, -0.3, i / 5), ph = sx * (95 + yy * 22) * DEG;
    const p = hitFrom(dfT, [0, 0.25, z], [Math.sin(ph), Math.cos(ph), 0]);
    const n = gradAt(dfT, p);
    torso.hard.push(quill(add3(p, mul3(n, -0.006)), jit(add3(mul3(n, 0.4), [0, 0.15, -1]), rnd, 0.2), 0.13 + rnd() * 0.04, 0.006, bandsShort).near());
  }
  // far stand-in: a few heavy spines that keep the bristling outline
  for (let j = 0; j < 7; j++) {
    const ph = (-60 + j * 20) * DEG, z = -0.12 + (j % 2) * 0.1;
    const p = hitFrom(dfT, [0, 0.26, z], [Math.sin(ph), Math.cos(ph), 0]);
    torso.hard.push(quill(p, norm3([Math.sin(ph) * 0.6, 0.8, -0.6]), 0.36, 0.03, quillBands(C.pale, C.qdark, 3)).far());
  }

  // ---- neck, head and the crest ----
  const neck = N('neck', 'torso', [0, 0.27, 0.2], { rig: 'neck', detail: 0.45, minRes: 14 });
  const np = [fur(bone([0, 0.27, 0.16], [0, 0.285, 0.33], 0.13, 0.095))];
  put(neck, np);
  const dfN = distanceField(np);
  for (let k = 0; k < 15; k++) {
    const f = k / 14, z = lerp(0.33, 0.12, f), sx = (k % 3) - 1;
    const p = hitFrom(dfN, [sx * 0.02, 0.28, z], [sx * 0.25, 1, 0]);
    const L = 0.17 + 0.13 * Math.sin(Math.PI * (0.25 + f * 0.75));
    neck.hard.push(quill(add3(p, [0, -0.008, 0]), jit([sx * 0.35, 1, -0.35 - f * 0.4], rnd, 0.25), L, 0.0048, [[0.22, C.qdark], [1, C.pale]]).near());
  }
  neck.hard.push(quill([0, 0.37, 0.24], [0, 1, -0.5], 0.26, 0.04, [[0.2, C.qdark], [1, C.pale]]).far());
  const head = N('head', 'neck', [0, 0.28, 0.32], { rig: 'head', detail: 0.85, minRes: 18 });
  const hp = [
    fur(S.ellipsoid(0.085, 0.085, 0.1).at(0, 0.28, 0.37)),
    fur(S.ellipsoid(0.062, 0.062, 0.07).at(0, 0.255, 0.44).blend(0.05), C.dark),
    S.sphere(0.034).at(0, 0.255, 0.497).color(C.nose).pbr(0.45).blend(0.025),
    S.ellipsoid(0.012, 0.016, 0.01).at(0, 0.235, 0.522).cut(0.004),
    ...S.mirrorX([fur(S.ellipsoid(0.024, 0.02, 0.01).rot(0, 25, 0).at(0.07, 0.33, 0.33).blend(0.02), C.dark)]),
  ];
  put(head, hp);
  put(head, H.mirrorX([eyeAt([0.056, 0.3, 0.418], [0.75, 0.2, 0.62], 0.011)]));
  head.hard.push(...H.mirrorX([H.box(0.012, 0.026, 0.008, 0.003).at(0.007, 0.218, 0.5).color(C.tooth).pbr(0.35)]));
  for (const sx of [1, -1]) for (let w = 0; w < 3; w++) head.hard.push(H.tube([[sx * 0.035, 0.255 - w * 0.008, 0.48], [sx * 0.1, 0.27 - w * 0.03, 0.47], [sx * 0.15, 0.27 - w * 0.05, 0.44]], 0.0018, 6, 3).color(0x2a2420).pbr(0.6).lod(1));
  const jaw = N('jaw', 'head', [0, 0.228, 0.4], { rig: 'jaw', detail: 0.85, minRes: 18 });
  put(jaw, [fur(S.ellipsoid(0.045, 0.024, 0.06).at(0, 0.215, 0.445), C.dark), H.box(0.016, 0.022, 0.008, 0.003).at(0, 0.228, 0.495).color(C.tooth).pbr(0.35)]);

  // ---- legs ----
  const JF = [[0.12, 0.25, 0.15], [0.13, 0.13, 0.18], [0.13, 0.045, 0.19]];
  const JB = [[0.12, 0.27, -0.24], [0.145, 0.15, -0.17], [0.13, 0.05, -0.26]];
  const leg = (q) => fur(q, C.dark);
  const toes = (cx, cz, n, sp, len) => { const out = []; for (let k = 0; k < n; k++) { const x = cx + (k - (n - 1) / 2) * sp; out.push(spike([x, 0.02, cz], [(k - (n - 1) / 2) * 0.15, -0.3, 1], len, 0.008, C.claw, [0, -1, 0], 0.45)); } return out; };
  legPair(N, 'F', JF, {
    up: [leg(bone(JF[0], JF[1], 0.07, 0.05)), leg(S.sphere(0.07).at(...JF[0]))],
    lo: [leg(bone(JF[1], JF[2], 0.048, 0.036)), leg(S.sphere(0.048).at(...JF[1]))],
    paw: [leg(S.sphere(0.036).at(...JF[2])), leg(S.ellipsoid(0.042, 0.024, 0.055).at(0.13, 0.024, 0.215).blend(0.02)), ...toes(0.13, 0.255, 4, 0.016, 0.035)],
  }, [0.45, 0.55, 0.7]);
  legPair(N, 'B', JB, {
    up: [leg(bone(JB[0], JB[1], 0.085, 0.055)), leg(S.sphere(0.085).at(...JB[0]))],
    lo: [leg(bone(JB[1], JB[2], 0.05, 0.036)), leg(S.sphere(0.05).at(...JB[1]))],
    paw: [leg(S.sphere(0.036).at(...JB[2])), leg(S.ellipsoid(0.045, 0.022, 0.075).at(0.13, 0.022, -0.215).blend(0.02)), ...toes(0.13, -0.15, 5, 0.014, 0.03)],
  }, [0.45, 0.55, 0.7]);

  // ---- tail: a stub carrying the hollow rattle quills ----
  const tail = N('tail0', 'torso', [0, 0.27, -0.38], { rig: 'tail', detail: 0.6, minRes: 16 });
  put(tail, [fur(bone([0, 0.27, -0.38], [0, 0.25, -0.46], 0.05, 0.035), C.dark)]);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const d = norm3([Math.cos(a) * 0.5, Math.sin(a) * 0.5 + 0.15, -1]);
    tail.hard.push(orient(H.cyl(0.012, 0.005, 0.085, 6).at(0, 0.0425, 0).color(k % 3 ? C.pale : mix(C.pale, C.qdark, 0.4)).pbr(0.4), [Math.cos(a) * 0.02, 0.255 + Math.sin(a) * 0.02, -0.44], d, [0, 1, 0]));
  }
  return { kind: 'beast.quad', attack: 'bite', gait: 'bear', girth: 1.4, ...footVals(JF[2], 0.215, JB[2], -0.215, 0.7), nodes: finish(N.nodes) };
}

// =====================================================================================
//  Badger: companion (grey, white-faced with black eye-stripes), honey-badger (black with a pale mantle),
//  and the clockwork badger of riveted brass with gears in its flanks and a key in its back
// =====================================================================================
function badger(def, o = {}) {
  const clock = !!o.clockwork;
  const honey = !clock && /honey|ratel/i.test(`${def?.id || ''} ${def?.name || ''} ${o.variant || ''}`);
  const furC = col(o.fur, clock ? 0xc8a040 : 0x3a3a3a), stripe = col(o.stripe, clock ? 0x3a3a40 : 0xe8e8e8);
  const rnd = rng(hashStr((def?.id || 'badger') + (clock ? ':clock' : honey ? ':honey' : ':badger')));
  const black = honey ? mix(furC, 0x0a0a0a, 0.3) : mix(furC, 0x0c0c0e, 0.65);
  const C = {
    fur: honey ? black : furC, leg: black, face: honey ? black : stripe, mask: black, mantle: stripe,
    claw: 0x2a2420, nose: 0x141214, brass: furC, iron: stripe, glow: 0x5af0d8,
  };
  const furP = (q, c = C.fur, amp = 0.006) => (clock ? q.color(c).pbr(0.32, 1).tint(0.06, 9) : q.color(c).pbr(0.9).tint(0.14, 26).bump(amp, 40, 'fur'));
  const iron = (q) => q.color(C.iron).pbr(0.45, 0.85);
  const N = rigOf();
  N('root', null, [0, 0, 0]);

  // ---- body: low, broad, wedge-shaped ----
  const torso = N('torso', 'root', [0, 0.27, 0], { rig: 'torso', detail: clock ? 0.36 : 0.3, minRes: 10 });
  const tp = [
    furP(S.ellipsoid(0.19, 0.15, 0.3).at(0, 0.27, -0.05)),
    furP(S.ellipsoid(0.17, 0.14, 0.15).at(0, 0.265, 0.17).blend(0.08)),
    furP(S.ellipsoid(0.185, 0.155, 0.16).at(0, 0.275, -0.25).blend(0.08)),
    furP(S.ellipsoid(0.15, 0.08, 0.3).at(0, 0.17, -0.04).blend(0.06), C.leg),
  ];
  if (!clock && !honey) tp.push(furP(S.ellipsoid(0.17, 0.08, 0.36).at(0, 0.365, -0.06).paint(0.06), mix(C.fur, 0xb8b8b0, 0.35)));   // grizzled silver back
  if (honey) tp.push(S.capsule([0, 0.39, 0.22], [0, 0.4, -0.36], 0.15, 0.14).at(0, 0.0, 0).color(C.mantle).pbr(0.9).tint(0.1, 20).paint(0.035));
  const gearO = [0.178, 0.285, -0.06];
  if (clock) {
    for (const z of [0.16, 0.02, -0.12, -0.27]) tp.push(S.torus(0.17, 0.004).rot(90, 0, 0).scale(1).at(0, 0.27, z).cut(0.003));   // plate seams
    tp.push(S.box(0.006, 0.02, 0.62).at(0, 0.42, -0.05).cut(0.003));
    for (const sx of [1, -1]) tp.push(S.cyl(0.085, 0.12).rot(0, 0, 90).at(sx * 0.19, gearO[1], gearO[2]).cut(0.01));                  // the gear wells
    for (const sx of [1, -1]) tp.push(S.cyl(0.02, 0.2).rot(0, 0, 90).at(sx * 0.1, gearO[1], gearO[2]).color(C.iron).pbr(0.45, 0.8));  // axle hubs
  }
  put(torso, tp);
  if (clock) {
    // rivets along the seams, a key in the back, gears in each flank
    for (const z of [0.16, 0.02, -0.12, -0.27]) for (let k = 0; k < 9; k++) {
      const a = (-80 + k * 20) * DEG;
      const p = hitFrom(distanceField(tp), [0, 0.27, z + 0.014], [Math.sin(a), Math.cos(a), 0]);
      torso.hard.push(H.sphere(0.008, 6).at(...p).color(tone(C.brass, 0, 0, 0.08)).pbr(0.3, 1).lod(1));
    }
    const gears = [[0, 0.062, 12], [0.028, 0.036, 8], [-0.04, 0.03, 7]];
    for (const sx of [1, -1]) gears.forEach(([dz, r, teeth], gi) => {
      const c = [sx * (0.14 + gi * 0.006), gearO[1] + (gi === 1 ? 0.045 : gi === 2 ? -0.035 : 0), gearO[2] + dz * 1.3];
      const g = N(`gear${sx > 0 ? 'L' : 'R'}${gi}`, 'torso', c, { rig: 'gears', detail: 1 });
      g.hard.push(H.geo(gearGeo(teeth, r, r * 0.8, gi === 0)).at(...c).color(gi === 1 ? C.iron : tone(C.brass, 0, 0, gi ? -0.05 : 0.04)).pbr(0.3, 1));
      g.hard.push(H.cyl(r * 0.22, r * 0.22, 0.03, 10).rot(0, 0, 90).at(...c).color(C.iron).pbr(0.4, 0.9));
    });
    const key = N('key', 'torso', [0, 0.41, -0.1], { rig: 'key', detail: 1 });
    key.hard.push(
      H.cyl(0.012, 0.012, 0.1, 10).at(0, 0.45, -0.1).color(C.iron).pbr(0.4, 0.9),
      H.cyl(0.022, 0.022, 0.012, 12).at(0, 0.425, -0.1).color(tone(C.brass, 0, 0, 0.05)).pbr(0.3, 1),
      ...[1, -1].map((sx) => H.torus(0.032, 0.008, 18, 8).at(sx * 0.036, 0.52, -0.1).color(tone(C.brass, 0, 0, 0.06)).pbr(0.28, 1)),
      H.sphere(0.012, 10).at(0, 0.5, -0.1).color(C.brass).pbr(0.3, 1),
    );
  }

  // ---- neck, head ----
  const neck = N('neck', 'torso', [0, 0.27, 0.22], { rig: 'neck', detail: 0.55, minRes: 14 });
  put(neck, [furP(bone([0, 0.27, 0.2], [0, 0.275, 0.34], 0.12, 0.09))]);
  if (honey) put(neck, [S.capsule([0, 0.37, 0.2], [0, 0.35, 0.34], 0.1, 0.085).color(C.mantle).pbr(0.9).paint(0.03)]);
  if (!clock && !honey) {
    // the companion's collar: a leather band with a brass buckle and a tag
    neck.hard.push(orient(H.torus(0.11, 0.014, 24, 8).rot(90, 0, 0), [0, 0.275, 0.29], [0, 0, 1], [0, 1, 0]).color(0x6a3e22).pbr(0.7));
    neck.hard.push(H.box(0.034, 0.03, 0.012, 0.003).at(0, 0.168, 0.3).color(0xd8b040).pbr(0.3, 1));
    neck.hard.push(H.cyl(0.016, 0.016, 0.004, 12).rot(90, 0, 0).at(0, 0.14, 0.305).color(0xd8b040).pbr(0.3, 1));
  }
  if (clock) neck.hard.push(orient(H.torus(0.105, 0.012, 24, 8).rot(90, 0, 0), [0, 0.275, 0.3], [0, 0, 1], [0, 1, 0]).color(C.iron).pbr(0.4, 0.9));
  const head = N('head', 'neck', [0, 0.275, 0.34], { rig: 'head', detail: 0.85, minRes: 18 });
  const hp = [
    furP(S.ellipsoid(0.088, 0.078, 0.1).at(0, 0.28, 0.38), C.face),
    furP(bone([0, 0.262, 0.42], [0, 0.232, 0.53], 0.062, 0.03).blend(0.05), C.face),
    S.sphere(0.024).at(0, 0.234, 0.545).color(clock ? C.iron : C.nose).pbr(clock ? 0.4 : 0.45, clock ? 0.9 : 0).blend(0.02),
    furP(S.ellipsoid(0.06, 0.04, 0.07).at(0, 0.235, 0.43).blend(0.04), C.mask),                      // dark throat and chin
  ];
  if (honey) hp.push(S.ellipsoid(0.09, 0.05, 0.12).at(0, 0.335, 0.37).color(C.mantle).pbr(0.9).paint(0.025));
  else for (const sx of [1, -1]) hp.push((clock ? iron : (q) => q.color(C.mask).pbr(0.9))(S.capsule([sx * 0.03, 0.258, 0.51], [sx * 0.058, 0.318, 0.33], 0.016, 0.03)).paint(0.008, clock ? 0.004 : 0));
  hp.push(...S.mirrorX([furP(S.ellipsoid(0.026, 0.02, 0.012).rot(0, 20, 0).at(0.074, 0.33, 0.34).blend(0.02), honey ? C.mask : clock ? C.brass : C.mask)]));
  if (!clock && !honey) hp.push(...S.mirrorX([S.sphere(0.014).at(0.084, 0.348, 0.338).color(C.face).paint(0.006)]));
  put(head, hp);
  if (clock) {
    put(head, H.mirrorX([H.sphere(0.013, 12).at(0.052, 0.3, 0.452).color(C.glow).glow(1.8).pbr(0.3)]));
    head.hard.push(...H.mirrorX([H.sphere(0.006, 6).at(0.04, 0.33, 0.42).color(tone(C.brass, 0, 0, 0.08)).pbr(0.3, 1).lod(1)]));
  } else put(head, H.mirrorX([eyeAt([0.05, 0.296, 0.452], [0.6, 0.25, 0.75], 0.0105)]));
  const jaw = N('jaw', 'head', [0, 0.235, 0.4], { rig: 'jaw', detail: 0.85, minRes: 18 });
  put(jaw, [furP(S.ellipsoid(0.042, 0.022, 0.07).at(0, 0.215, 0.46), clock ? C.iron : C.mask)]);
  jaw.hard.push(...H.mirrorX([spike([0.022, 0.222, 0.505], [0, 1, 0.1], 0.016, 0.005, 0xf0ead8, [0, 0, 1], 0.1)]));

  // ---- legs: short, thick, with long digging claws in front ----
  const JF = [[0.13, 0.24, 0.17], [0.14, 0.13, 0.2], [0.14, 0.05, 0.21]];
  const JB = [[0.13, 0.26, -0.25], [0.15, 0.14, -0.18], [0.14, 0.05, -0.27]];
  const lc = clock ? C.brass : C.leg;
  const L = (q) => furP(q, lc);
  const J = (p, r) => (clock ? iron(S.sphere(r).at(...p)) : L(S.sphere(r).at(...p)));
  const toes = (cx, cz, n, sp, len, r) => { const out = []; for (let k = 0; k < n; k++) { const x = cx + (k - (n - 1) / 2) * sp; out.push(spike([x, 0.022, cz - Math.abs(k - (n - 1) / 2) * 0.008], [(k - (n - 1) / 2) * 0.12, -0.35, 1], len, r, clock ? C.iron : C.claw, [0, -1, 0], 0.4)); } return out; };
  legPair(N, 'F', JF, {
    up: [L(bone(JF[0], JF[1], 0.075, 0.055)), L(S.sphere(0.075).at(...JF[0]))],
    lo: [L(bone(JF[1], JF[2], 0.05, 0.04)), J(JF[1], 0.054)],
    paw: [J(JF[2], 0.04), L(S.ellipsoid(0.05, 0.026, 0.055).at(0.14, 0.026, 0.235).blend(0.02)), ...toes(0.14, 0.275, 5, 0.017, 0.055, 0.008)],
  }, [0.5, 0.6, 0.75]);
  legPair(N, 'B', JB, {
    up: [L(bone(JB[0], JB[1], 0.085, 0.058)), L(S.sphere(0.085).at(...JB[0]))],
    lo: [L(bone(JB[1], JB[2], 0.05, 0.04)), J(JB[1], 0.054)],
    paw: [J(JB[2], 0.04), L(S.ellipsoid(0.05, 0.024, 0.075).at(0.14, 0.024, -0.225).blend(0.02)), ...toes(0.14, -0.16, 5, 0.015, 0.03, 0.007)],
  }, [0.5, 0.6, 0.75]);
  if (clock) {
    // pistons up the back of each upper leg
    for (const n of N.nodes.filter((q) => /^leg/.test(q.name))) {
      const sx = n.o[0] > 0 ? 1 : -1, J0 = n.o, back = J0[2] > 0 ? 0.04 : -0.05;
      n.hard.push(H.tube([[J0[0] + sx * 0.05, J0[1] - 0.02, J0[2] + back], [J0[0] + sx * 0.05, J0[1] - 0.09, J0[2] + back * 1.4]], 0.01, 2, 8).color(C.iron).pbr(0.35, 1));
    }
  }

  // ---- tail: short and bristly ----
  const TL = [[0, 0.31, -0.39], [0, 0.3, -0.47], [0, 0.27, -0.55]];
  for (let i = 0; i < 2; i++) {
    const n = N(`tail${i}`, i ? 'tail0' : 'torso', TL[i], { rig: 'tail', detail: 0.6, minRes: 16 });
    put(n, [furP(bone(TL[i], TL[i + 1], i ? 0.038 : 0.05, i ? 0.018 : 0.038), honey ? C.mantle : clock ? C.brass : mix(C.fur, 0xc8c8c0, 0.3))]);
  }
  return { kind: clock ? 'fringe.clockquad' : 'beast.quad', attack: 'bite', gait: 'bear', girth: 1.3, ...footVals(JF[2], 0.235, JB[2], -0.225, 0.75), nodes: finish(N.nodes) };
}

/** a flight feather / plume: a flat leaf along +Y from 0 to 1, pale quill root, coloured vane */
function featherGeo() {
  return cached('feather', () => {
    const prof = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; prof.push(new THREE.Vector2(Math.max(0.0001, 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7) * (t < 0.1 ? t * 8 : 1)), t)); }
    return new THREE.LatheGeometry(prof, 6);
  });
}
function plume(base, dir, len, w, colA, colB, face = [0, 0, 1]) {
  const a = rgb(colA), b = rgb(colB);
  const h = H.geo(featherGeo()).shade((x, y) => (y < 0.22 ? [0.92, 0.9, 0.84] : y > 0.82 ? mixRgb(b, [0.05, 0.05, 0.06], 0.6) : mixRgb(a, b, smooth((y - 0.22) / 0.6)))).color(colA).pbr(0.6);
  h.scale(w, len, w * 0.18);
  return orient(h, base, dir, face);
}

// =====================================================================================
//  Giant river-otter of the jungle warbands: sleek, webbed, thick-tailed, in hammered gold and a feathered crown
// =====================================================================================
function riverOtter(def, o = {}) {
  const furC = col(o.fur, 0x5a4030), gold = col(o.armor, 0xd8b03a);
  const rnd = rng(hashStr((def?.id || 'otter') + ':otter'));
  const C = { fur: furC, belly: mix(furC, 0xd8c0a0, 0.42), dark: mix(furC, 0x140e0a, 0.45), nose: 0x1a1210, gold, claw: 0x2a2018, gem: 0x2ab8a8 };
  const fur = (q, c = C.fur) => q.color(c).pbr(0.5).tint(0.08, 18).bump(0.0025, 50, 'fur');
  const pg = { base: gold, dark: tone(gold, 0, 0, -0.18), pale: tone(gold, 0, -0.1, 0.14) };
  const goldH = (h) => h.color(gold).pbr(0.3, 1);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.24, 0], { rig: 'torso', detail: 0.42, minRes: 10 });
  const tp = [
    fur(S.ellipsoid(0.14, 0.13, 0.34).at(0, 0.25, -0.05)),
    fur(S.ellipsoid(0.13, 0.12, 0.14).at(0, 0.24, 0.2).blend(0.08)),
    fur(S.ellipsoid(0.145, 0.135, 0.15).at(0, 0.25, -0.3).blend(0.08)),
    S.ellipsoid(0.11, 0.07, 0.38).at(0, 0.15, -0.02).color(C.belly).pbr(0.6).paint(0.04),
  ];
  put(torso, tp);
  const dfT = distanceField(tp);
  // hammered gold: a ridge of overlapping back plates with side lappets, a breastplate
  const sp = [];
  for (const [i, z] of [0.17, 0.05, -0.07, -0.19, -0.31].entries()) {
    sp.push({ c: [0, 0.25, z], dir: [0, 1, 0], flow: [0, -0.1, -1], w: 0.2 - i * 0.01, l: 0.17, tilt: 5, lift: 0.008 });
    for (const sx of [1, -1]) sp.push({ c: [0, 0.25, z - 0.03], dir: [sx * 0.95, 0.55, 0], flow: [sx * 0.3, -0.6, -0.7], w: 0.12, l: 0.12, tilt: 4, lift: 0.006 });
  }
  layPlates(dfT, torso.hard, sp, pg, { rnd, rough: 0.3, metal: 1, vary: 0.1, keep: true });
  layPlates(dfT, torso.hard, [{ c: [0, 0.22, 0.2], dir: [0, -0.15, 1], flow: [0, -1, -0.1], w: 0.19, l: 0.18, tilt: 3, lift: 0.006 }], pg, { rough: 0.3, metal: 1, keep: true });
  for (const [i, z] of [0.17, 0.05, -0.07, -0.19].entries()) torso.hard.push(H.sphere(0.011, 8).at(0, hitFrom(dfT, [0, 0.25, z], [0, 1, 0])[1] + 0.03 + i * 0.0, z + 0.02).color(C.gem).pbr(0.15).lod(1));

  // ---- neck and head with the feathered crown ----
  const neck = N('neck', 'torso', [0, 0.26, 0.3], { rig: 'neck', detail: 0.55, minRes: 14 });
  put(neck, [fur(bone([0, 0.255, 0.27], [0, 0.29, 0.43], 0.1, 0.08)), S.ellipsoid(0.07, 0.05, 0.1).at(0, 0.22, 0.36).color(C.belly).pbr(0.6).paint(0.03)]);
  neck.hard.push(orient(H.torus(0.09, 0.012, 24, 8).rot(90, 0, 0), [0, 0.272, 0.35], [0, 0.35, 1], [0, 1, 0]).color(gold).pbr(0.28, 1));
  const head = N('head', 'neck', [0, 0.3, 0.43], { rig: 'head', detail: 0.85, minRes: 18 });
  const hp = [
    fur(S.ellipsoid(0.085, 0.062, 0.09).at(0, 0.31, 0.48)),
    fur(S.ellipsoid(0.066, 0.045, 0.06).at(0, 0.292, 0.55).blend(0.04)),
    ...S.mirrorX([S.sphere(0.03).at(0.03, 0.28, 0.578).color(C.belly).pbr(0.6).blend(0.02)]),
    S.ellipsoid(0.022, 0.015, 0.014).at(0, 0.305, 0.606).color(C.nose).pbr(0.4).blend(0.012),
    ...S.mirrorX([fur(S.ellipsoid(0.018, 0.016, 0.008).rot(0, 25, 0).at(0.074, 0.335, 0.45).blend(0.015), C.dark)]),
  ];
  put(head, hp);
  put(head, H.mirrorX([eyeAt([0.049, 0.33, 0.535], [0.6, 0.35, 0.72], 0.0115, { iris: 0x1a1008 })]));
  for (const sx of [1, -1]) for (let w = 0; w < 3; w++) head.hard.push(H.tube([[sx * 0.04, 0.285 - w * 0.008, 0.585], [sx * 0.1, 0.29 - w * 0.025, 0.58], [sx * 0.15, 0.285 - w * 0.045, 0.55]], 0.0016, 6, 3).color(0xe8e0d0).pbr(0.5).lod(1));
  // the crown: a gold band, a sun disc on the brow, a fan of jungle plumes
  head.hard.push(orient(H.torus(0.078, 0.01, 28, 8).rot(90, 0, 0), [0, 0.335, 0.465], [0, 1, 0.45], [0, 0, 1]).color(gold).pbr(0.28, 1));
  head.hard.push(orient(H.cyl(0.03, 0.03, 0.01, 18).color(gold).pbr(0.28, 1), [0, 0.365, 0.53], [0, 0.45, 1], [0, 1, 0]));
  head.hard.push(H.sphere(0.012, 10).at(0, 0.37, 0.538).color(C.gem).pbr(0.15));
  const plumeCols = [[0xd8302a, 0xf0a020], [0x2aa8a0, 0x1a5ad8], [0x3a9a3a, 0xd8d040], [0xf0c030, 0xd8302a]];
  for (let k = 0; k < 7; k++) {
    const a = (k - 3) * 15 * DEG, L = 0.2 - Math.abs(k - 3) * 0.022;
    const [ca, cb] = plumeCols[(k + 1) % 4];
    head.hard.push(plume([Math.sin(a) * 0.04, 0.37, 0.44 - Math.abs(k - 3) * 0.006], [Math.sin(a) * 0.9, Math.cos(a), -0.35], L, 0.045, ca, cb, [Math.sin(a) * 0.3, 0, 1]));
  }
  const jaw = N('jaw', 'head', [0, 0.275, 0.5], { rig: 'jaw', detail: 0.85, minRes: 18 });
  put(jaw, [S.ellipsoid(0.045, 0.02, 0.055).at(0, 0.262, 0.55).color(C.belly).pbr(0.6)]);

  // ---- legs: short, the paws broad and webbed ----
  const JF = [[0.1, 0.22, 0.2], [0.115, 0.12, 0.23], [0.115, 0.045, 0.24]];
  const JB = [[0.11, 0.24, -0.3], [0.13, 0.13, -0.23], [0.12, 0.045, -0.33]];
  const L = (q) => fur(q, C.dark);
  const webbed = (cx, cy, cz, n, sp, len) => {
    const out = [L(S.ellipsoid(sp * n * 0.55, 0.007, len * 0.55).at(cx, cy - 0.006, cz + len * 0.45).blend(0.01))];
    for (let k = 0; k < n; k++) {
      const off = k - (n - 1) / 2, tip = [cx + off * sp * 1.25, cy - 0.01, cz + len * (1 - Math.abs(off) * 0.12)];
      out.push(L(bone([cx + off * sp * 0.6, cy, cz], tip, 0.009, 0.007).blend(0.008)));
      out.push(spike(tip, [off * 0.2, -0.3, 1], 0.014, 0.004, C.claw, [0, -1, 0], 0.4));
    }
    return out;
  };
  const bracer = (a, b, r) => orient(H.cyl(r, r * 1.05, 0.035, 18, true), lerp3(a, b, 0.55), sub3(a, b), [0, 0, 1]).color(gold).pbr(0.28, 1);
  legPair(N, 'F', JF, {
    up: [L(bone(JF[0], JF[1], 0.06, 0.042)), L(S.sphere(0.06).at(...JF[0]))],
    lo: [L(bone(JF[1], JF[2], 0.042, 0.032)), L(S.sphere(0.042).at(...JF[1])), bracer(JF[1], JF[2], 0.042)],
    paw: [L(S.sphere(0.032).at(...JF[2])), L(S.ellipsoid(0.04, 0.02, 0.045).at(0.115, 0.02, 0.255).blend(0.02)), ...webbed(0.115, 0.018, 0.265, 5, 0.012, 0.04)],
  }, [0.5, 0.6, 0.8]);
  legPair(N, 'B', JB, {
    up: [L(bone(JB[0], JB[1], 0.075, 0.05)), L(S.sphere(0.075).at(...JB[0]))],
    lo: [L(bone(JB[1], JB[2], 0.048, 0.034)), L(S.sphere(0.048).at(...JB[1]))],
    paw: [L(S.sphere(0.034).at(...JB[2])), L(S.ellipsoid(0.042, 0.02, 0.06).at(0.12, 0.02, -0.29).blend(0.02)), ...webbed(0.12, 0.018, -0.27, 5, 0.014, 0.06)],
  }, [0.5, 0.6, 0.8]);

  // ---- tail: thick at the root, tapering like a rudder ----
  const TL = [[0, 0.26, -0.42], [0, 0.23, -0.58], [0, 0.17, -0.73], [0, 0.1, -0.86], [0, 0.05, -0.97]];
  const TR = [0.09, 0.072, 0.055, 0.036, 0.012];
  for (let i = 0; i < 4; i++) {
    const n = N(`tail${i}`, i ? `tail${i - 1}` : 'torso', TL[i], { rig: 'tail', detail: 0.55, minRes: 16 });
    put(n, [fur(bone(TL[i], TL[i + 1], TR[i], TR[i + 1])), fur(S.sphere(TR[i]).at(...TL[i]).blend(0.02))]);
    if (i === 0) n.hard.push(orient(H.cyl(0.082, 0.078, 0.03, 20, true), lerp3(TL[0], TL[1], 0.55), sub3(TL[0], TL[1]), [0, 1, 0]).color(gold).pbr(0.28, 1));
  }
  return { kind: 'beast.quad', attack: 'bite', gait: 'cat', strike: 'pounce', girth: 1.1, ...footVals(JF[2], 0.27, JB[2], -0.28, 0.7), nodes: finish(N.nodes) };
}

// =====================================================================================
//  Jungle wasp-swarm: a dozen great wasps circling a papery nest. Each wasp rides its own tilted orbit.
// =====================================================================================
const SWARM_Y = 0.62;
const swarmSpin = (i) => (i % 3 === 0 ? -1 : 1) * (1.7 + ((i * 7) % 5) * 0.22);
function waspParts(C, k) {
  const axis = [0, Math.sin(20 * DEG), Math.cos(20 * DEG)], ac = [0, -0.024, -0.08];
  const along = (s) => add3(ac, mul3(axis, s));
  const prims = [
    S.ellipsoid(0.022, 0.021, 0.028).color(C.black).pbr(0.35),
    S.ellipsoid(0.011, 0.006, 0.014).at(0, 0.018, -0.006).color(C.yellow).pbr(0.35).paint(0.004),
    S.ellipsoid(0.02, 0.018, 0.016).at(0, 0.003, 0.036).color(C.yellow).pbr(0.35).blend(0.008),
    ...S.mirrorX([S.ellipsoid(0.009, 0.014, 0.01).at(0.014, 0.006, 0.039).color(0x2a1608).pbr(0.2).blend(0.004)]),
    S.ellipsoid(0.014, 0.006, 0.006).at(0, -0.008, 0.05).color(C.black).pbr(0.4).blend(0.004),
    S.capsule([0, -0.004, -0.02], [0, -0.01, -0.038], 0.006, 0.007).color(C.black).pbr(0.35).blend(0.006),
    S.ellipsoid(0.024, 0.022, 0.05).rot(-20, 0, 0).at(...ac).color(C.yellow).pbr(0.35).blend(0.008),
    ...[0.022, -0.004, -0.03].map((s) => S.box(0.07, 0.07, 0.0085, 0.001).rot(-20, 0, 0).at(...along(s)).color(C.black).paint(0.003)),
    S.ellipsoid(0.03, 0.03, 0.012).rot(-20, 0, 0).at(...along(-0.05)).color(C.black).paint(0.003),
  ];
  const hard = [
    spike(along(-0.05), mul3(axis, -1), 0.022, 0.0035, C.black, [0, -1, 0], 0.1),
    ...H.mirrorX([H.tube([[0.006, 0.014, 0.048], [0.016, 0.036, 0.062], [0.026, 0.044, 0.084]], 0.0019, 6, 3).color(C.black).pbr(0.4).lod(1)]),
  ];
  for (const z of [0.012, -0.004, -0.018]) hard.push(...H.mirrorX([H.tube([[0.012, -0.014, z], [0.032, -0.035, z - 0.01], [0.03, -0.068, z - 0.03]], 0.0022, 6, 3).color(C.leg).pbr(0.45).lod(1)]));
  for (const p of prims) p.scale(k);
  for (const h of hard) h.scale(k);
  return { prims, hard };
}
function waspWing(C, k) {
  const sh = (x, y, z) => mixRgb(rgb(C.wing), rgb(C.vein), clamp(Math.abs(z) * 30));
  return [
    H.sphere(1, 10).scale(0.052, 0.0022, 0.013).at(0.05, 0, -0.004).rot(0, 16, 8).color(C.wing).shade(sh).pbr(0.18).glow(0.12),
    H.sphere(1, 8).scale(0.034, 0.002, 0.01).at(0.033, -0.002, -0.022).rot(0, 26, 4).color(C.wing).pbr(0.18).glow(0.12),
  ].map((h) => h.scale(k));
}
function waspSwarm(def, o = {}) {
  const yellow = col(o.body2, 0xe8c83a), black = col(o.stripe, 0x1a1a1a);
  const rnd = rng(hashStr((def?.id || 'wasps') + ':swarm'));
  const C = { yellow, black, leg: mix(yellow, 0x8a4a10, 0.35), wing: mix(0xa08050, yellow, 0.2), vein: 0x4a3418, paper: mix(0xc4b496, yellow, 0.08) };
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const HC = SWARM_Y, K = 1.3;
  const nest = N('nest', 'root', [0, HC, 0], { rig: 'core', detail: 0.8, minRes: 16 });
  put(nest, [
    S.ellipsoid(0.12, 0.16, 0.12).at(0, HC, 0).color(C.paper).pbr(0.95).bump(0.006, 26, 'ridges').tint(0.18, 14),
    S.ellipsoid(0.085, 0.09, 0.085).at(0, HC + 0.12, 0).color(tone(C.paper, 0, 0, -0.06)).pbr(0.95).bump(0.005, 30, 'ridges').blend(0.05),
    S.capsule([0, HC + 0.17, 0], [0, HC + 0.26, 0.01], 0.014, 0.01).color(0x5a4a34).pbr(0.9).blend(0.02),
    S.sphere(0.038).at(0, HC - 0.15, 0.01).cut(0.012),
    S.torus(0.11, 0.008).at(0, HC - 0.02, 0).color(tone(C.paper, 0, 0, -0.12)).paint(0.004, 0.004),
    S.torus(0.115, 0.007).at(0, HC + 0.06, 0).color(tone(C.paper, 0, 0, -0.12)).paint(0.004, 0.004),
  ]);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const r = 0.27 + rnd() * 0.22 + (i % 2) * 0.06, dy = (rnd() - 0.5) * 0.5, a0 = (i / n) * 360 + rnd() * 18, tilt = (rnd() - 0.5) * 44;
    const dir = Math.sign(swarmSpin(i));
    N(`orbit${i}`, 'root', [0, 0, 0], { pos: [0, HC, 0], rot: [tilt, a0, 0], rig: 'orbits' });
    const w = N(`wasp${i}`, `orbit${i}`, [0, 0, 0], { pos: [r, dy, 0], rot: [(rnd() - 0.5) * 16, dir > 0 ? 180 : 0, dir * 14], rig: 'wasps', detail: 1.15, minRes: 44 });
    const parts = waspParts(C, K);
    put(w, [parts.prims, parts.hard]);
    for (const sx of [1, -1]) {
      const wg = N(`wing${sx > 0 ? 'L' : 'R'}${i}`, `wasp${i}`, [0, 0, 0], { pos: [sx * 0.011 * K, 0.019 * K, 0.004 * K], rig: 'wings' });
      const parts2 = waspWing(C, K);
      wg.hard.push(...(sx > 0 ? parts2 : parts2.map((h) => h.mirrorX())));
    }
  }
  return { kind: 'fringe.swarm', attack: 'bite', cloudY: HC, nodes: finish(N.nodes) };
}

// =====================================================================================
//  Poison-dart tree-frog: dog-sized, glossy, bright, black-spotted, with great dark eyes and sticky toe pads
// =====================================================================================
function dartFrog(def, o = {}) {
  const skinC = col(o.skin, 0xe83a3a), spotC = col(o.spots, 0x1a1a2a);
  const rnd = rng(hashStr((def?.id || 'frog') + ':frog'));
  const C = { skin: skinC, spot: spotC, belly: mix(skinC, spotC, 0.45), pad: tone(skinC, 0, -0.1, 0.12), tongue: 0xe8789a };
  const sk = (q, c = C.skin) => q.color(c).pbr(0.2).tint(0.06, 16);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.12, 0], { rig: 'torso', detail: 1.15, minRes: 22 });
  const body = [
    sk(S.ellipsoid(0.11, 0.085, 0.14).rot(-14, 0, 0).at(0, 0.12, -0.04)),
    sk(S.ellipsoid(0.1, 0.066, 0.09).at(0, 0.15, 0.075).blend(0.05)),
    sk(S.ellipsoid(0.072, 0.046, 0.05).at(0, 0.142, 0.135).blend(0.04)),
    sk(S.ellipsoid(0.1, 0.075, 0.08).at(0, 0.11, -0.14).blend(0.05)),
    ...S.mirrorX([sk(S.sphere(0.036).at(0.062, 0.186, 0.085).blend(0.022))]),
  ];
  const dfB = distanceField(body);
  const paint = [
    S.ellipsoid(0.1, 0.05, 0.2).at(0, 0.06, -0.02).color(C.belly).pbr(0.3).paint(0.03),
    S.ellipsoid(0.08, 0.004, 0.06).at(0, 0.128, 0.13).cut(0.003),
  ];
  for (let k = 0; k < 26; k++) {
    const z = lerp(0.12, -0.2, rnd()), a = (rnd() - 0.5) * 200 * DEG;
    const p = hitFrom(dfB, [0, 0.12, z], [Math.sin(a), Math.cos(a), 0]);
    if (p[2] > 0.05 && Math.abs(p[0]) > 0.035 && p[1] > 0.16) continue;              // keep the eyes clear
    paint.push(S.sphere(0.011 + rnd() * 0.016).scale(1).at(...p).color(C.spot).pbr(0.2).paint(0.003));
  }
  put(torso, [...body, ...paint]);
  put(torso, H.mirrorX([eyeAt([0.07, 0.192, 0.095], [0.85, 0.35, 0.45], 0.03, { iris: 0x101014, white: 0x0a0a0c, pupil: 0x020204, rim: 0x2a2018, irisSize: 1.3 })]));
  // throat sac and tongue (the tongue rests inside the mouth; the animator shoots it out)
  const throat = N('throat', 'torso', [0, 0.09, 0.08], { rig: 'throat', detail: 1.2, minRes: 22 });
  put(throat, [S.ellipsoid(0.058, 0.032, 0.055).at(0, 0.09, 0.095).color(C.belly).pbr(0.3)]);
  const tongue = N('tongue', 'torso', [0, 0.13, 0.1], { rig: 'tongue', detail: 1.4, minRes: 24 });
  put(tongue, [S.capsule([0, 0.13, 0.1], [0, 0.13, 0.15], 0.01, 0.014).color(C.tongue).pbr(0.25), S.sphere(0.018).at(0, 0.13, 0.155).color(tone(C.tongue, 0, 0, -0.05)).pbr(0.2).blend(0.008)]);

  // ---- legs: slim arms with splayed fingers, folded haunches, long-toed feet; every digit ends in a pad ----
  const JF = [[0.07, 0.1, 0.08], [0.1, 0.066, 0.1], [0.1, 0.022, 0.125]];
  const JB = [[0.075, 0.1, -0.13], [0.14, 0.075, -0.03], [0.115, 0.03, -0.15]];
  const spots = (a, b, n) => { const out = []; for (let k = 0; k < n; k++) out.push(S.sphere(0.008 + (k % 2) * 0.004).at(...add3(lerp3(a, b, 0.25 + k * 0.4), [0.012, 0.008, 0])).color(C.spot).paint(0.002)); return out; };
  const digits = (from, dirs, len, r) => {
    const out = [];
    for (const d of dirs) {
      const tip = add3(from, mul3(norm3(d), len));
      out.push(sk(bone(from, tip, r, r * 0.8).blend(0.006)));
      out.push(sk(S.ellipsoid(r * 1.9, r * 1.1, r * 1.9).at(tip[0], tip[1] - r * 0.3, tip[2]).blend(0.004), C.pad));
    }
    return out;
  };
  legPair(N, 'F', JF, {
    up: [sk(bone(JF[0], JF[1], 0.022, 0.017)), sk(S.sphere(0.022).at(...JF[0])), ...spots(JF[0], JF[1], 1)],
    lo: [sk(bone(JF[1], JF[2], 0.017, 0.013)), sk(S.sphere(0.017).at(...JF[1]))],
    paw: [sk(S.sphere(0.014).at(...JF[2])), ...digits(add3(JF[2], [0, -0.008, 0.006]), [[-0.5, -0.35, 1], [-0.12, -0.3, 1], [0.25, -0.3, 1], [0.7, -0.3, 0.6]], 0.042, 0.0055)],
  }, [1.1, 1.3, 1.6]);
  legPair(N, 'B', JB, {
    up: [sk(bone(JB[0], JB[1], 0.036, 0.024)), sk(S.sphere(0.034).at(...JB[0])), ...spots(JB[0], JB[1], 2)],
    lo: [sk(bone(JB[1], JB[2], 0.024, 0.015)), sk(S.sphere(0.024).at(...JB[1])), ...spots(JB[1], JB[2], 1)],
    paw: [sk(S.sphere(0.015).at(...JB[2])), sk(bone(JB[2], [0.13, 0.014, -0.075], 0.013, 0.009)),
      ...digits([0.13, 0.014, -0.075], [[-0.35, -0.2, 1], [-0.05, -0.15, 1], [0.3, -0.15, 1], [0.65, -0.15, 0.8], [0.95, -0.1, 0.2]], 0.052, 0.0055)],
  }, [1.1, 1.3, 1.6]);
  return { kind: 'fringe.frog', attack: 'bite', nodes: finish(N.nodes) };
}

// =====================================================================================
//  Animators
// =====================================================================================
/** the clockwork badger: the badger's walk, and its key and gears turning */
function clockQuadAnim(rig, inner, c, base) {
  (beastAnimators['beast.quad'] || base.quad)(rig, inner, c, base);
  const { R } = base, dead = c.dead > 0;
  const t = dead ? c.t - c.dead : c.t;
  const spin = t * (c.moving ? 5 : 1.6) + (c.atk >= 0 ? c.atk * 5 : 0) + (c.phase || 0);
  R(rig.key?.[0], 0, t * 1.3 + (c.phase || 0));
  (rig.gears || []).forEach((g, i) => { const j = i % 3; R(g, (j === 0 ? 1 : -(j === 1 ? 1.7 : 2.1)) * spin); });
}

/** the swarm: every wasp circles on its own tilted orbit, wings a blur; it surges forward to sting; dead, they fall */
function swarmAnim(rig, inner, c, base) {
  const { R, P } = base, s = inner.scale.y || 1, ph = c.phase || 0;
  const f = c.dead > 0 ? smooth(Math.min(1, c.dead * 1.6)) : 0;
  const t = c.dead > 0 ? c.t - c.dead : c.t;
  const atk = c.atk >= 0 ? Math.sin(Math.PI * c.atk) : 0, mv = c.moving ? 1 : 0, HC = rig.cloudY || SWARM_Y;
  (rig.orbits || []).forEach((o, i) => {
    R(o, 0, swarmSpin(i) * (t + ph * 0.3), 0);
    P(o, 0, (Math.sin(c.t * 2.1 + i * 1.7 + ph) * 0.05 + Math.sin(c.t * 3.3 + i) * 0.02) * (1 - f) - f * HC * 0.15, 0);
  });
  (rig.wasps || []).forEach((w, i) => {
    const r = w.userData.rest || [0, 0, 0, 0, 0, 0];
    const fall = (HC + r[4]) * f * 0.9;
    P(w, -r[3] * (0.45 * atk + 0.12 * mv) + f * r[3] * 0.4, -fall + Math.sin(c.t * 9 + i * 2.3) * 0.008 * (1 - f), Math.sin(c.t * 7 + i) * 0.015 * (1 - f));
    R(w, Math.sin(c.t * 6 + i * 1.3) * 0.12 * (1 - f) + f * (1.2 + (i % 3) * 0.6), 0, Math.sin(c.t * 5 + i * 2) * 0.2 * (1 - f) + f * (i % 2 ? 2.4 : -2.4));
  });
  (rig.wings || []).forEach((g, i) => {
    const sg = (g.userData.rest?.[3] ?? 1) >= 0 ? 1 : -1;
    R(g, 0, 0, sg * ((1 - f) * (0.3 + 0.55 * Math.sin(c.t * 62 + i * 0.9)) - f * 0.3));
  });
  if (rig.core) { P(rig.core, 0, Math.sin(c.t * 1.3 + ph) * 0.015 - f * (HC - 0.15), 0); R(rig.core, 0, Math.sin(c.t * 0.6 + ph) * 0.15, f * 1.3); }
  inner.position.z = atk * 0.42 * s;
  inner.position.y = 0;
  inner.rotation.x = (mv * 0.08 + atk * 0.15) * (1 - f);
  inner.rotation.z = 0;
}

/** the frog: sits, throat pulsing; hops when it moves; strikes with its tongue; dies belly-up */
function frogAnim(rig, inner, c, base) {
  const { R, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0;
  const L = rig.legs || [], Sn = rig.shins || [], Pw = rig.paws || [];
  let py = 0, pitch = 0, pz = 0, hind = 0, front = 0, crouch = 0, tongue = 0;
  if (c.moving && !(c.dead > 0)) {
    const u = ((t * 1.7 + ph * 0.37) % 1 + 1) % 1;
    crouch = keys(u, [[0, 0.2], [0.1, 1], [0.18, 0], [0.72, 0], [0.84, 0.7], [1, 0.2]]);
    const air = u > 0.15 && u < 0.72 ? Math.sin(Math.PI * (u - 0.15) / 0.57) : 0;
    py = air * 0.14 - crouch * 0.01;
    hind = keys(u, [[0, 0], [0.13, 0], [0.24, 1], [0.42, 0.85], [0.68, 0.05], [1, 0]]);
    front = keys(u, [[0, 0], [0.2, -0.2], [0.5, 0.85], [0.74, 0.4], [1, 0]]);
    pitch = keys(u, [[0, 0], [0.12, 0.06], [0.24, -0.38], [0.48, -0.05], [0.68, 0.2], [0.82, 0.02], [1, 0]]);
  }
  if (c.atk >= 0 && !(c.dead > 0)) {
    const a = c.atk;
    tongue = keys(a, [[0, 0], [0.32, 0], [0.44, 1], [0.58, 1], [0.7, 0], [1, 0]]);
    pitch += keys(a, [[0, 0], [0.3, 0.08], [0.44, -0.12], [0.6, -0.05], [1, 0]]);
    pz = keys(a, [[0, 0], [0.3, -0.02], [0.44, 0.06], [0.7, 0.02], [1, 0]]);
    crouch = Math.max(crouch, keys(a, [[0, 0], [0.3, 0.8], [0.44, 0], [1, 0]]));
  }
  for (let i = 2; i < 4 && i < L.length; i++) { R(L[i], hind * 1.7 - crouch * 0.12); R(Sn[i], -hind * 2.3 + crouch * 0.2); R(Pw[i], hind * 1.1); }
  for (let i = 0; i < 2 && i < L.length; i++) { R(L[i], -front * 0.8 + crouch * 0.15); R(Sn[i], front * 0.2); R(Pw[i], front * 0.5); }
  const tg = rig.tongue?.[0], th = rig.throat?.[0];
  if (tg) tg.scale.set(1, 1, 1 + tongue * 7);
  if (th) { const b = c.dead > 0 ? 0 : Math.max(0, Math.sin(t * 4.2 + ph)); th.scale.set(1 + b * 0.12, 1 + b * 0.35, 1 + b * 0.1); }
  if (c.dead > 0) {
    const f = smooth(Math.min(1, c.dead * 2));
    inner.rotation.x = 0; inner.rotation.z = f * Math.PI * (Math.floor(ph * 10) % 2 ? 1 : -1);
    inner.position.y = f * 0.19 * s - Math.max(0, c.dead - 0.8) * 0.2 * s;
    inner.position.z = 0;
    for (let i = 0; i < L.length; i++) { R(L[i], (i < 2 ? -0.6 : 0.9) * f, 0, (i % 2 ? -0.5 : 0.5) * f); R(Sn[i], (i < 2 ? 0.3 : -1.2) * f); }
    return;
  }
  inner.rotation.z = 0;
  inner.rotation.x = pitch;
  inner.position.y = py * s;
  inner.position.z = pz * s;
}

export const bodies = { pangolin, porcupine, badger, riverOtter, waspSwarm, dartFrog };
export const animators = { 'fringe.clockquad': clockQuadAnim, 'fringe.swarm': swarmAnim, 'fringe.frog': frogAnim };
