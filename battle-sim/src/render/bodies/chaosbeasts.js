// Chaos beasts: the war-beasts of the Kharnak brass-hordes and the swamp-things of Morbus.
//
//   bodies.brassRhino(def, o)      brass-barded war rhinoceros; o.rider = a humanoid descriptor   'chaos.rhino'
//   bodies.bloodReaper(def, o)     winged crimson fiend with a two-handed reaping axe              'chaos.fiend'
//   bodies.slaughterBrute(def, o)  furnace-bellied fire-breathing brute with cleaver arms         'chaos.brute'
//   bodies.plagueToad(def, o)      bloated mossy swamp-toad with boils, mushrooms and bells        'chaos.toad'
//   bodies.carrionFly(def, o)      a fly the size of a warhorse carrying a rider                   'chaos.fly'
//
// Authoring convention (the same one titans.js uses): a model is laid out in ONE space, its rest pose (Y up,
// facing +Z, feet on y = 0, an adult man stands 1.0 tall). Every node records the point it pivots about (`o`);
// finish() moves each node's pieces into the node's own space. Ridden beasts keep their own trunk, neck, head and
// jaw on the mount keys (body, mneck, mhead, mjaw) so the rider keeps the stock upper-body keys (torso, head, arms,
// forearms, hands, weapon) that animate.js upperBody and humanoid's poseCarried drive.
// Rig keys beyond the stock ones: vents (rhino furnace flames), core (brute furnace), throat (toad), tongue (toad),
// bells (toad), abdomen (fly), wings / wingtips (fiend), legs / shins of six for the fly.
import * as THREE from 'three';
import { S, H, rgb, noise3 } from '../sculpt.js';
import { weapon as makeWeapon } from './weapons.js';
import { humanoid, poseCarried } from './humanoid.js';
import { proportions } from './anatomy.js';

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
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const sideX = (sx) => (p) => [p[0] * sx, p[1], p[2]];

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
function hueOf(hex) { _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace); return _hsl.h; }
function lumOf(hex) { _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace); return _hsl.l; }
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const col = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

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
/** tapered capsule from a to b whose local Y follows the bone */
function bone(a, b, ra, rb = ra, zHint) { return orient(S.capsule([0, 0, 0], [0, len3(sub3(b, a)), 0], ra, rb), a, sub3(b, a), zHint); }
function curve(pts, n) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const out = [];
  for (let i = 0; i <= n; i++) { const v = c.getPoint(i / n); out.push([v.x, v.y, v.z]); }
  return out;
}
const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

// ---------- nodes ----------
function node(name, parent, o, extra = {}) { return { name, parent, o, prims: [], hard: [], ...extra }; }
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
/** a collector: N(name, parent, pivot, extra) adds and returns a node */
function rigOf() {
  const nodes = [];
  const N = (name, parent, o, extra) => { const n = node(name, parent, o, extra); nodes.push(n); return n; };
  N.nodes = nodes;
  return N;
}

/** scale a finished-in-world-space node list about the origin */
function scaleNodes(nodes, u) {
  for (const n of nodes) {
    n.o = mul3(n.o, u); if (n.pos) n.pos = mul3(n.pos, u);
    for (const p of flat(n.prims)) p.scale(u);
    for (const h of flat(n.hard)) h.scale(u);
    n.detail = (n.detail ?? 1) / u; if (n.minRes) n.minRes /= u;
  }
}


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

/** a horn: tapering tube with growth rings, plus a plain core that survives at distance */
function horn(pts, r0, cols, opt = {}) {
  const n = opt.rings ?? 18, radii = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, taper = Math.pow(1 - t, opt.pow ?? 0.8) * 0.96 + 0.04;
    radii.push(r0 * taper * (1 + (opt.ripple ?? 0.12) * (i % 2 ? -1 : 0.6) * (1 - t * 0.75)));
  }
  const a = rgb(cols[0]), b = rgb(cols[1] ?? cols[0]), c = rgb(cols[2] ?? cols[1] ?? cols[0]);
  const base = pts[0], end = pts[pts.length - 1], L = len3(sub3(end, base)) || 1;
  const shade = (x, y, z) => { const t = clamp(len3(sub3([x, y, z], base)) / L); return t < 0.5 ? mixRgb(a, b, t * 2) : mixRgb(b, c, (t - 0.5) * 2); };
  const fine = H.tube(pts, radii, n * 2, 7).shade(shade).color(cols[1] ?? cols[0]).pbr(opt.rough ?? 0.42, 0).lod(1);
  const core = H.tube(pts, [r0 * 0.85, r0 * 0.6, r0 * 0.3, r0 * 0.06], 5, 5).shade(shade).color(cols[1] ?? cols[0]).pbr(opt.rough ?? 0.42, 0).from(2);
  return [fine, core];
}

/** eyeball looking along +Z. look: { iris, rim, pupil, white, glow, slit } */
function eyeball(r, look = {}) {
  const iris = rgb(look.iris ?? 0xffc21a), rim = rgb(look.rim ?? 0x5a2a08), pupil = rgb(look.pupil ?? 0x080606), white = rgb(look.white ?? 0x2a1a10);
  const slit = look.slit !== false;
  const h = H.sphere(1, 16).shade((x, y, z) => {
    if (z < 0.2) return white;
    const d = Math.hypot(x, y);
    if (slit ? (Math.abs(x) < 0.1 * (1.15 - Math.abs(y) * 0.9) && Math.abs(y) < 0.56) : d < 0.3) return pupil;
    if (d < 0.68) return mixRgb(iris, rim, clamp((d - 0.3) / 0.38));
    return white;
  }).color(look.white ?? 0x2a1a10).pbr(0.12, 0).scale(r);
  if (look.glow) h.glow(look.glow);
  return h;
}
/** an eye set in the head at p, looking along dir */
const eyeAt = (p, dir, r, look) => orient(eyeball(r, look).rot(-90, 0, 0), p, dir);   // sphere's +Z pole -> local +Y -> dir
const glowEye = (p, r, color, g = 1.6) => H.sphere(r, 10).at(p[0], p[1], p[2]).color(color).glow(g).pbr(0.3);

/** a skin stretched between two edge curves A(u), B(u); scalloped far edge, billowing middle */
function membrane(A, B, opt = {}) {
  const nu = opt.nu ?? 8, nv = opt.nv ?? 6, sc = opt.scallop ?? 0.2, bil = opt.billow ?? 0.03, up = opt.up ?? [0, 1, 0];
  const pos = [], idx = [], cols = [];
  const surf = (u0, v) => {
    const arch = Math.pow(4 * v * (1 - v), opt.archPow ?? 0.8);
    const u = u0 * (1 - sc * arch - (opt.edge ? opt.edge(v) : 0));
    const a = A(u), b = B(u);
    const lift = bil * arch * Math.sin(Math.PI * (0.12 + 0.8 * u0));
    return [lerp(a[0], b[0], v) + up[0] * lift, lerp(a[1], b[1], v) + up[1] * lift, lerp(a[2], b[2], v) + up[2] * lift];
  };
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const v = j / nv, u0 = i / nu, p = surf(u0, v);
    pos.push(p[0], p[1], p[2]);
    if (opt.col) cols.push(opt.col(u0, v, p));
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (opt.hole && opt.hole((i + 0.5) / nu, (j + 0.5) / nv)) continue;
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const h = H.geo(g).pbr(opt.rough ?? 0.62, 0);
  if (opt.col) h.shade((x, y, z, nx, ny, nz, i) => cols[i] ?? null);
  h.surf = surf;
  return h;
}
const lineFn = (a, b, bow) => (u) => { const p = lerp3(a, b, u); if (bow) { const k = 4 * u * (1 - u); p[0] += bow[0] * k; p[1] += bow[1] * k; p[2] += bow[2] * k; } return p; };
const pathFn = (pts) => { const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))); return (u) => { const v = c.getPoint(clamp(u)); return [v.x, v.y, v.z]; }; };

/** leathery wing (left, +X): arm Sh -> E -> W, fingers from W to tips, skin back to `hip`. Returns { arm, tip } parts. */
function batWing(G, C, opt = {}) {
  const { Sh, E, W, tips, hip } = G, k = opt.k ?? 1;
  const cA = rgb(C.wingA), cB = rgb(C.wingB);
  const arm = { prims: [], hard: [] }, tip = { prims: [], hard: [] };
  const bk = (q) => q.color(C.bone).pbr(0.5).tint(0.12, 14);
  arm.prims.push(bk(S.capsule(Sh, E, 0.055 * k, 0.038 * k)));
  arm.prims.push(bk(S.ellipsoid(0.055 * k, 0.05 * k, 0.08 * k).at(...lerp3(Sh, E, 0.3)).blend(0.03)));
  arm.prims.push(bk(S.sphere(0.042 * k).at(...E).blend(0.02)));
  arm.prims.push(bk(S.capsule(E, W, 0.038 * k, 0.027 * k).blend(0.02)));
  arm.prims.push(bk(S.sphere(0.033 * k).at(...W).blend(0.015)));
  tip.prims.push(bk(S.sphere(0.033 * k).at(...W)));
  const bows = tips.map((t, i) => mul3([0.02, 0.03, i === 0 ? 0.04 : 0.01], k));
  const finger = tips.map((t, i) => lineFn(W, t, bows[i]));
  finger.forEach((f, fi) => {
    if (opt.ghost && opt.ghost.includes(fi)) return;        // an edge of skin with no bone in it
    const pts = [0, 0.25, 0.55, 1].map((u) => f(u));
    tip.hard.push(H.tube(pts, [0.02, 0.015, 0.011, 0.003].map((r) => r * k), 9, 5).color(C.bone).pbr(0.5));
    tip.hard.push(spike(f(1), norm3(sub3(f(1), f(0.9))), 0.045 * k, 0.007, C.claw, [0, -1, 0], 0.3).lod(1));
  });
  const colFn = (panel) => (u, v) => {
    const between = 1 - Math.pow(Math.abs(v - 0.5) * 2, 1.7);
    let c3 = mixRgb(cA, cB, clamp(0.1 + 0.9 * between * (0.3 + 0.7 * smooth(u * 1.25))));
    const n = noise3(u * 4.2 + panel * 5.3, v * 3.3 + panel, 0.7);
    c3 = mixRgb(c3, cA, clamp((n - 0.52) * 2.4) * 0.5);
    if (u > 0.84) c3 = mixRgb(c3, cA, ((u - 0.84) / 0.16) * 0.8);
    return c3;
  };
  for (let i = 0; i < finger.length - 1; i++) {
    const torn = opt.torn && i === 1;
    tip.hard.push(membrane(finger[i], finger[i + 1], { nu: 8, nv: 6, scallop: 0.2 + (torn ? 0.1 : 0), billow: 0.04 * k, col: colFn(i),
      edge: torn ? (v) => 0.3 * Math.exp(-Math.pow((v - 0.55) / 0.13, 2)) : null }));
  }
  const body = lineFn(add3(Sh, [-0.01, -0.03, 0.02]), hip);
  arm.hard.push(membrane(finger[finger.length - 1], body, { nu: 8, nv: 7, scallop: 0.16, billow: 0.035 * k, col: (u, v) => colFn(3)(0.2 + u * 0.8, v * 0.62 + 0.3) }));
  arm.hard.push(membrane(lineFn(Sh, E), lineFn(Sh, W, [0, 0, 0.05]), { nu: 4, nv: 2, scallop: 0, billow: 0.006, col: () => mixRgb(cA, rgb(C.bone), 0.4) }));
  arm.hard.push(spike(add3(W, [0, 0.012, 0.018]), [0.25, 0.5, 1], 0.09 * k, 0.016 * k, C.claw, [0, -1, 0], 0.5).lod(1));
  return { arm, tip };
}

// ---------- feathers ----------

/** copy a part for one side: sx = 1 clones, -1 mirrors */
const sidePart = (list, sx) => flat(list).map((q) => (sx > 0 ? q.clone() : q.mirrorX()));

/** hang a two-part wing pair on `parent`: build(sx) -> { arm, tip } authored for the left */
function addWings(N, parent, G, build, detail = 0.8) {
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx), src = build(sx);
    const w = N(`wing${nm}`, parent, X(G.Sh), { rig: 'wings', detail });
    const t = N(`wingtip${nm}`, `wing${nm}`, X(G.W), { rig: 'wingtips', detail });
    w.prims = sidePart(src.arm.prims, sx); w.hard = sidePart(src.arm.hard, sx);
    t.prims = sidePart(src.tip.prims, sx); t.hard = sidePart(src.tip.hard, sx);
  }
}

/**
 * A two-bone leg. pts = [hip, knee, ankle, ground] on the +X side; sx mirrors. radii = [hip, knee, ankle].
 * foot: { kind: 'claw' | 'paw' | 'pillar' | 'talon' | 'root', len, w, toes, claw, clawLen, col }.
 */
function addLeg(N, nm, parent, sx, pts, radii, sk, opt = {}) {
  const X = sideX(sx), [J, K, A, F] = pts.map(X);
  const up = N(`leg${nm}`, parent, J, { rig: opt.rigU ?? 'legs', detail: opt.detail ?? 0.8, minRes: opt.minRes });
  const lo = N(`shin${nm}`, `leg${nm}`, K, { rig: opt.rigL ?? 'shins', detail: opt.detail ?? 0.8, minRes: opt.minRes });
  const m = opt.muscle ?? 1.25;
  up.prims.push(sk(S.capsule(J, K, radii[0], radii[1])));
  up.prims.push(sk(S.ellipsoid(radii[0] * m, radii[0] * m * 1.25, radii[0] * m * 1.2).at(...lerp3(J, K, 0.3)).blend(0.04)));
  up.prims.push(sk(S.sphere(radii[1] * 1.05).at(...K).blend(0.02)));
  lo.prims.push(sk(S.sphere(radii[1] * 1.02).at(...K)));
  lo.prims.push(sk(S.capsule(K, A, radii[1], radii[2]).blend(0.02)));
  lo.prims.push(sk(S.ellipsoid(radii[1] * 0.95, radii[1] * 1.3, radii[1] * 1.05).at(...add3(lerp3(K, A, 0.28), [0, 0, -radii[1] * 0.25])).blend(0.03)));
  const ft = opt.foot ?? {}, fl = ft.len ?? radii[2] * 2.6, fw = ft.w ?? radii[2] * 1.5, fc = ft.col ?? null;
  const skf = (q) => (fc != null ? sk(q).color(fc) : sk(q));
  if (ft.kind === 'pillar') {
    lo.prims.push(skf(S.capsule(A, F, radii[2], fw).blend(0.02)));
    lo.prims.push(skf(S.cyl(fw * 1.02, fw * 0.9, fw * 0.3).at(F[0], fw * 0.45, F[2]).blend(0.03)));
    const nt = ft.toes ?? 3;
    for (let i = 0; i < nt; i++) { const a = (i - (nt - 1) / 2) * 0.62; lo.prims.push(S.ellipsoid(fw * 0.3, fw * 0.34, fw * 0.3).at(F[0] + Math.sin(a) * fw * 0.86, fw * 0.3, F[2] + Math.cos(a) * fw * 0.86).color(ft.claw ?? 0x2a2620).pbr(0.4).blend(0.006)); }
  } else if (ft.kind === 'root') {
    lo.prims.push(skf(S.capsule(A, F, radii[2], fw).blend(0.03)));
  } else {
    lo.prims.push(skf(S.capsule(A, add3(F, [0, fw * 0.55, 0]), radii[2], fw * 0.75).blend(0.02)));
    lo.prims.push(skf(S.ellipsoid(fw, fw * 0.55, fl * 0.5).at(F[0], fw * 0.5, F[2] + fl * 0.3).blend(0.025)));
    const nt = ft.toes ?? 3, cl = ft.clawLen ?? fl * 0.5;
    for (let i = 0; i < nt; i++) {
      const a = (i - (nt - 1) / 2) * (ft.spread ?? 0.42), d = [Math.sin(a), 0, Math.cos(a)];
      const tb = [F[0] + d[0] * fl * 0.5, fw * 0.36, F[2] + fl * 0.3 + d[2] * fl * 0.5];
      lo.prims.push(skf(S.capsule([F[0] + d[0] * fl * 0.1, fw * 0.4, F[2] + fl * 0.25], tb, fw * 0.36, fw * 0.3).blend(0.012)));
      if (ft.kind !== 'paw' || cl > 0) lo.hard.push(spike(add3(tb, [0, fw * 0.05, fw * 0.1]), [d[0], -0.25, d[2]], cl, cl * 0.24, ft.claw ?? 0x1c1814, [0, -1, 0], 0.35).lod(opt.clawLod ?? 2));
    }
    if (ft.kind === 'talon') lo.hard.push(spike([F[0], fw * 0.45, F[2] - fl * 0.05], [0, -0.3, -1], cl, cl * 0.24, ft.claw ?? 0x1c1814, [0, -1, 0], 0.35).lod(2));
  }
  return { up, lo, J, K, A, F };
}

/**
 * A chain of segment nodes through pts (necks, tails, coils). radii per point. rig(i) names the rig key.
 * deco(n, a, b, ra, rb, i, frame) adds extras. Returns the nodes.
 */
function addChain(N, name, parent, pts, radii, sk, opt = {}) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const n = N(`${name}${i}`, i === 0 ? parent : `${name}${i - 1}`, pts[i], { rig: typeof opt.rig === 'function' ? opt.rig(i) : opt.rig, detail: opt.detail ?? 0.8, minRes: opt.minRes });
    const a = pts[i], b = pts[i + 1], ra = radii[i], rb = radii[i + 1];
    n.prims.push(sk(S.sphere(ra * 1.0).at(...a)));
    n.prims.push(sk(bone(a, b, ra, rb, opt.zHint).blend(0.01)));
    if (i === pts.length - 2 && opt.cap !== false) n.prims.push(sk(S.sphere(rb).at(...b).blend(0.01)));
    if (opt.deco) {
      const t = norm3(sub3(b, a));
      let side = cross3(t, opt.up ?? [0, 1, 0]); if (len3(side) < 1e-4) side = [1, 0, 0]; side = norm3(side);
      const dor = norm3(cross3(side, t));
      opt.deco(n, a, b, ra, rb, i, { t, side, dor });
    }
    out.push(n);
  }
  return out;
}


/** chain of links from a to b */
function chain(a, b, r = 0.02, color = 0x3a3c40, lod = 3) {
  const L = len3(sub3(b, a)), n = Math.max(2, Math.round(L / (r * 2.4))), out = [];
  for (let i = 0; i < n; i++) {
    const c = lerp3(a, b, (i + 0.5) / n);
    out.push(orient(H.torus(r, r * 0.32, 8, 5).scale(0.75, 1.25, 1).rot(0, i % 2 ? 90 : 0, 0), c, sub3(b, a)).color(color).pbr(0.5, 0.8).lod(lod));
  }
  return out;
}


// ---------- animation helpers ----------
const sgn = (w, i) => ((w.userData.rest?.[3] ?? (i ? -1 : 1)) >= 0 ? 1 : -1);
const bellK = (k) => Math.sin(clamp(k) * Math.PI);
/** a rig key outside animate's single set is filed as a list: its first node */
const one = (x) => (Array.isArray(x) ? x[0] : x);
/** four-legged walk; returns the gait phase. amp = stride, bend = knee lift */
function walk4(rig, c, base, rate = 7.5, amp = 0.42, bend = 0.6, front = -0.5) {
  const { R } = base, L = rig.legs || [], Sh = rig.shins || [], k = c.moving && !c.flying ? 1 : 0, gait = c.t * rate + (c.phase || 0);
  for (let i = 0; i < L.length; i++) {
    const fr = i < 2, sg = i === 0 || i === 3 ? 1 : -1;
    const sw = Math.sin(gait) * sg, lift = Math.max(0, Math.cos(gait) * sg);
    R(L[i], -sw * amp * k);
    R(Sh[i], k * lift * (fr ? front : bend) + k * sw * 0.1);
  }
  return gait;
}
/** fold or beat a wing pair authored spread. fold = [wingYaw, wingRoll, tipYaw, tipRoll, wingPitch] */
function wingsPose(rig, c, base, s, opt = {}) {
  const { R } = base, W = rig.wings || [], WT = rig.wingtips || [], t = c.t, ph = c.phase || 0;
  const rate = (opt.rate ?? 8.4) / Math.sqrt(Math.max(0.3, s)), beat = t * rate + ph, amp = opt.amp ?? 0.58;
  const fold = opt.fold ?? [0.62, 0.62, 1.15, -0.5, 0.12], open = opt.open ?? 0, br = Math.sin(t * 1.4 + ph) * 0.03;
  W.forEach((w, i) => {
    const sg = sgn(w, i);
    if (c.flying && !(c.dead > 0)) {
      const f = Math.sin(beat);
      R(w, 0, sg * (0.06 + 0.1 * Math.cos(beat)), sg * (0.1 + f * amp));
      R(WT[i], 0, sg * (0.12 - 0.16 * Math.cos(beat - 0.5)), sg * (Math.sin(beat - 1.0) * amp * 0.85 - 0.05));
    } else {
      const k = 1 - open * 0.65;
      R(w, fold[4] * k, sg * fold[0] * k, sg * (fold[1] * k + br + 0.12 * open));
      R(WT[i], 0, sg * fold[2] * k, sg * (fold[3] * k - br));
    }
  });
  return beat;
}
function tailWave(rig, c, base, amp = 0.12, rate = 1.7, lift = 0) {
  (rig.tail || []).forEach((seg, i) => base.R(seg, lift + Math.sin(c.t * 1.3 + (c.phase || 0) - i * 0.6) * 0.03, Math.sin(c.t * (c.moving ? rate * 2.4 : rate) + (c.phase || 0) - i * 0.75) * amp, 0));
}
/** topple onto a flank and rest a little above the ground so the bulk does not sink through it */
function dieSide(inner, c, base, lift = 0.2) {
  const dead = base.die(inner, c, true);
  if (dead) inner.position.y += Math.min(1, c.dead * 2) * lift * (inner.scale.y || 1);
  return dead;
}

// =====================================================================================
//  shared pieces
// =====================================================================================
const IRON = 0x2a2624, IRON_L = 0x4a4440, BONE = 0xd8cdb0, BONE_D = 0x9a8c6c, LEATHER = 0x3a2418, EMBER = 0xff6a1a, EMBER_HOT = 0xffc050;

/** prims for a small skull facing `dir` at p (radius r): cranium, face, sockets, nose, teeth line */
function skull(p, r, dir = [0, 0, 1], up = [0, 1, 0], color = BONE) {
  const e = frameEuler(up, dir), place = (q) => q.rot(e[0], e[1], e[2]).at(p[0], p[1], p[2]);
  const b = (q) => place(q.color(color).pbr(0.55).tint(0.12, 40));
  const out = [
    b(S.sphere(r).at(0, r * 0.15, -r * 0.1).blend(0.004)),
    b(S.ellipsoid(r * 0.72, r * 0.6, r * 0.62).at(0, -r * 0.35, r * 0.3).blend(r * 0.4)),
    b(S.ellipsoid(r * 0.55, r * 0.22, r * 0.4).at(0, -r * 0.85, r * 0.35).blend(r * 0.2)).color(tone(color, 0, 0, -0.06)),
  ];
  for (const sx of [1, -1]) out.push(place(S.sphere(r * 0.27).at(sx * r * 0.36, -r * 0.08, r * 0.78).color(0x120a08).cut(r * 0.1)));
  out.push(place(S.ellipsoid(r * 0.1, r * 0.16, r * 0.1).at(0, -r * 0.42, r * 0.92).color(0x120a08).cut(r * 0.06)));
  out.push(place(S.box(r * 0.75, r * 0.07, r * 0.4, r * 0.02).at(0, -r * 0.7, r * 0.72).color(0x2a1c14).paint(r * 0.04, -r * 0.03)));
  return out;
}
/** a ring of jagged brass teeth: spikes along a path of points, each pointing along `dir(i)` */
function spikeRow(pts, dirs, len, r, color, lod = 2) {
  return pts.map((p, i) => spike(p, dirs[i] ?? dirs[0], len * (0.8 + 0.4 * ((i * 7) % 3) / 2), r, color, [0, 0, 1], 0.15, 0.55).lod(i % 2 ? lod : lod - 1));
}
/** a round furnace vent: iron collar, glowing throat, grate bars. Facing `dir` at p. */
function vent(p, dir, r, glow = EMBER, rim = IRON) {
  const e = frameEuler(dir), place = (q) => q.rot(e[0], e[1], e[2]).at(p[0], p[1], p[2]);
  const out = [
    place(H.lathe([[r * 0.7, -r * 0.6], [r * 1.05, -r * 0.3], [r * 1.1, r * 0.2], [r * 0.95, r * 0.35], [r * 0.72, r * 0.3], [r * 0.7, -r * 0.4]], 14).color(rim).pbr(0.45, 0.8)),
    place(H.cyl(r * 0.72, r * 0.72, r * 0.1, 12).at(0, r * 0.05, 0).color(glow).glow(1.8).pbr(0.4)),
  ];
  for (let i = -1; i <= 1; i++) out.push(place(H.box(r * 0.12, r * 0.12, r * 1.4, r * 0.02).at(i * r * 0.4, r * 0.26, 0).color(IRON).pbr(0.5, 0.7)).lod(1));
  return out;
}
/** an open shell band (a lame of barding) curving over a back: axis along local Y, crown toward local +Z */
function lame(r, w, span, color, rim) {
  const g = new THREE.CylinderGeometry(r, r * 0.97, w, 22, 4, true, -span / 2, span);
  const c = rgb(color), e = rgb(rim);
  return H.geo(g).shade((x, y, z) => (Math.abs(y) > w * 0.3 || Math.abs(Math.atan2(x, z)) > span / 2 - 0.12 ? e : c)).color(color).pbr(0.34, 0.85);
}
/** a flat plate w x h, its hem toothed (teeth > 0), as an iron backing and a brass face: local Y up, face +Z */
function jagPlate(w, h, teeth, sx, brass) {
  const o = [];
  o.push([-w / 2, h / 2], [w / 2, h / 2]);
  if (teeth > 0) {
    const n = teeth * 2;
    for (let i = 0; i <= n; i++) { const x = w / 2 - (i / n) * w; o.push([x, i % 2 ? -h / 2 - 0.06 : -h / 2 + 0.005]); }
  } else o.push([w / 2 - 0.02, -h / 2], [-w / 2 + 0.02, -h / 2]);
  const inner = o.map(([x, y]) => [x * 0.86, y * 0.84 + 0.004]);
  return {
    iron: H.extrude(o, 0.014, 0.004).color(IRON).pbr(0.5, 0.7),
    brass: H.extrude(inner, 0.01, 0.004).color(brass).pbr(0.3, 0.9).shade((x, y) => (Math.abs(x) < 0.012 ? rgb(tone(brass, 0, 0, -0.15)) : null)),
  };
}
/** a hanging bell (open end down) at p */
function bell(p, r, color) {
  return [
    H.lathe([[0.001, r * 1.25], [r * 0.35, r * 1.2], [r * 0.6, r * 0.9], [r * 0.7, r * 0.3], [r, -r * 0.05], [r * 0.92, -r * 0.1], [r * 0.6, r * 0.25], [r * 0.5, r * 0.85], [0.001, r * 1.05]], 12)
      .at(p[0], p[1] - r * 1.25, p[2]).color(color).pbr(0.75, 0.55).shade((x, y, z) => (noise3(x * 90, y * 90, z * 90) > 0.6 ? 0x5a3a1c : null)),
    H.torus(r * 0.2, r * 0.06, 8, 5).at(p[0], p[1], p[2]).color(IRON_L).pbr(0.5, 0.7).lod(1),
    H.sphere(r * 0.22, 8).at(p[0], p[1] - r * 1.25, p[2]).color(0x3a2a1a).pbr(0.6, 0.5).lod(1),
  ];
}

// ---------- riders ----------
/** build a humanoid rider in its riding pose. f scales it inside the model. */
function makeRider(def, ro, f = 1) {
  const rdesc = { ...ro, body: 'humanoid', pose: 'riding', alt: undefined, scale: undefined };
  const desc = humanoid({ ...(def || {}), id: `${(def && def.id) || 'chaos'}:rider` }, rdesc);
  return { desc, P: proportions(rdesc), f };
}
/**
 * Seat the rider: its root becomes `rider` under bodyName (pivot bodyO), hip joint at seatA (authoring space).
 * legRot optionally overrides the rest rotation (degrees) of legL / legR / shinL / shinR to straddle a broad back.
 */
function seatRider(out, R, bodyName, bodyO, seatA, legRot = null) {
  const f = R.f, P = R.P;
  for (const n of R.desc.nodes) {
    const m = { ...n, name: n.name === 'root' ? 'rider' : `r_${n.name}` };
    if (n.name === 'root') { m.parent = bodyName; m.pos = [seatA[0] - bodyO[0], seatA[1] - bodyO[1] - P.hipY * f, seatA[2] - bodyO[2]]; }
    else { m.parent = n.parent === 'root' ? 'rider' : `r_${n.parent}`; m.pos = mul3(n.pos || [0, 0, 0], f); }
    if (legRot && legRot[n.name]) m.rot = legRot[n.name];
    if (f !== 1) { m.prims = flat(n.prims).map((q) => q.clone().scale(f)); m.hard = flat(n.hard).map((q) => q.clone().scale(f)); }
    out.push(m);
  }
  const extra = {};
  for (const [k, v] of Object.entries(R.desc)) if (k !== 'nodes' && k !== 'kind' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) extra[k] = v;
  extra.hold = R.desc.hold || 'none';
  extra.attack = R.desc.attack || 'swing';
  return extra;
}
const _cu = {};
/** the rider: stock upper body, weapon carried one-handed, the other hand on the rein */
function poseRider(rig, c, base, dead, lean = 0.12) {
  if (!rig.torso || !rig.arms) return;
  const { R } = base, A = rig.arms || [], F = rig.forearms || [];
  _cu.t = c.t; _cu.phase = c.phase || 0; _cu.dead = c.dead; _cu.flying = false; _cu.moving = false; _cu.atk = dead ? -1 : c.atk;
  base.upperBody(rig, _cu);
  const k = c.moving || c.flying ? 1 : 0, bounce = Math.sin(c.t * 5 + (c.phase || 0)) * k;
  if (!dead) rig.torso.rotation.x += lean * k + 0.03 + bounce * 0.03;
  poseCarried(rig, _cu, base, rig.hold || 'none', true);
  if (dead) return;
  if (!(rig.shield && rig.shield[0])) { R(A[0], -0.6 + bounce * 0.05, 0, 0.18); R(F[0], -0.95 - bounce * 0.05); }
}

// =====================================================================================
//  BRASS RHINO: a colossal war-rhinoceros grown into brass and black-iron barding
// =====================================================================================
// rig: body, mneck(none), mhead, mjaw, legs[4], shins[4], tail[], vents[] (flame tongues that flicker);
// with a rider, the rider's stock keys too.
function brassRhino(def, o = {}) {
  const hide = col(o.hide, 0x5a3a32), brass = col(o.armor, 0xb07a2a), brassD = tone(brass, -0.01, 0, -0.14), brassL = tone(brass, 0.01, -0.05, 0.12);
  const hideD = tone(hide, 0, 0, -0.08), hideL = tone(hide, 0.01, -0.04, 0.08), ridden = !!(o.rider && typeof o.rider === 'object');
  const sk = (q) => q.color(hide).bump(0.011, 10, 'rock').tint(0.16, 7).pbr(0.85, 0);
  const br = (q) => q.color(brass).pbr(0.32, 0.9).tint(0.08, 14);
  const ir = (q) => q.color(IRON).pbr(0.55, 0.7).tint(0.1, 20);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const BO = [0, 0.66, 0];
  const body = N('body', 'root', BO, { rig: 'body', detail: 0.62 });
  {
    const p = body.prims;
    p.push(sk(S.ellipsoid(0.36, 0.33, 0.6).at(0, 0.68, -0.04)));
    p.push(sk(S.ellipsoid(0.35, 0.37, 0.3).at(0, 0.77, 0.3).blend(0.09)));               // the shoulder hump
    p.push(sk(S.ellipsoid(0.33, 0.33, 0.3).at(0, 0.71, -0.4).blend(0.09)));               // haunches
    p.push(sk(S.ellipsoid(0.3, 0.22, 0.46).at(0, 0.5, -0.02).blend(0.09)));               // slung belly
    p.push(sk(S.capsule([0, 0.8, 0.46], [0, 0.72, 0.7], 0.25, 0.2).blend(0.08)));         // short thick neck
    p.push(sk(S.capsule([0, 0.66, -0.6], [0, 0.6, -0.68], 0.2, 0.14).blend(0.08)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.12, 0.2, 0.18).at(0.25, 0.6, 0.34).blend(0.06)), sk(S.ellipsoid(0.14, 0.2, 0.2).at(0.24, 0.62, -0.42).blend(0.06))]));
    // the folds of the hide: a ridge at the shoulder and at the hip, a darker back and paler belly
    for (let i = 0; i < 3; i++) p.push(orient(S.ellipsoid(0.25 - i * 0.015, 0.022, 0.25 - i * 0.015), [0, 0.79 - i * 0.03, 0.56 + i * 0.06], [0, 0.4, 1]).color(hideD).paint(0.012, 0.014));
    for (const z of [0.1, -0.2]) p.push(S.ellipsoid(0.4, 0.4, 0.028).at(0, 0.68, z).color(hideD).paint(0.014, 0.012));
    p.push(S.ellipsoid(0.24, 0.12, 0.7).at(0, 1.0, -0.04).color(hideD).paint(0.06));
    p.push(S.ellipsoid(0.24, 0.1, 0.42).at(0, 0.32, -0.02).color(hideL).paint(0.05));
    // barding: articulated lames over the shoulders and haunches; jagged two-layer plates down the flanks
    const lamesAt = (z0, z1, n, cy, r, span) => {
      for (let i = 0; i < n; i++) {
        const z = lerp(z0, z1, i / (n - 1));
        body.hard.push(orient(lame(r + i * 0.004, 0.14, span, i % 2 ? IRON : brass, i % 2 ? brassD : IRON_L), [0, cy, z], [0, 0.15, -1], [0, 1, 0]));
        body.hard.push(spike([0, cy + r + 0.01, z - 0.02], [0, 1, -0.5], 0.11 + 0.03 * (i % 2), 0.034, brassL, [0, 0, -1], 0.25, 0.5).lod(2));
      }
    };
    lamesAt(0.5, 0.17, 4, 0.78, 0.365, 2.2);
    lamesAt(-0.25, -0.58, 4, 0.71, 0.345, 2.3);
    for (const sx of [1, -1]) {
      const X = sideX(sx);
      [[0.3, 0.27], [0.06, 0.25], [-0.18, 0.25], [-0.42, 0.25]].forEach(([z, w], i) => {
        const end = i === 0 || i === 3, yUp = end ? 0.86 : 0.85, xUp = end ? 0.335 : 0.315;
        const up = jagPlate(w, 0.19, 0, sx, brass), lo = jagPlate(w * 1.04, 0.22, 4, sx, brass);
        body.hard.push(orient(up.iron, X([xUp, yUp, z]), X([-0.6, 1, 0]), X([1, 0.6, 0])), orient(up.brass, X([xUp + 0.012, yUp + 0.007, z]), X([-0.6, 1, 0]), X([1, 0.6, 0])));
        body.hard.push(orient(lo.iron, X([0.385, 0.63, z + 0.01]), X([-0.12, 1, 0]), X([1, 0.12, 0])), orient(lo.brass, X([0.398, 0.632, z + 0.01]), X([-0.12, 1, 0]), X([1, 0.12, 0])));
        for (const dz of [-0.08, 0.08]) body.hard.push(H.sphere(0.014, 6).at(...X([0.415, 0.72, z + dz])).color(brassL).pbr(0.3, 0.9).lod(0));
      });
    }
    // peytral: the brass breastplate with an iron boss
    p.push(br(S.ellipsoid(0.3, 0.25, 0.14).rot(-8, 0, 0).at(0, 0.6, 0.62).blend(0.004)));
    p.push(S.ellipsoid(0.305, 0.255, 0.142).rot(-8, 0, 0).at(0, 0.598, 0.618).color(IRON).pbr(0.5, 0.7).paint(0.006, 0.004));
    p.push(ir(S.ellipsoid(0.1, 0.1, 0.06).at(0, 0.62, 0.74).blend(0.004)));
    body.hard.push(spike([0, 0.62, 0.78], [0, 0, 1], 0.12, 0.04, IRON_L, [0, 1, 0], 0).lod(2));
    for (const sx of [1, -1]) body.hard.push(spike([sx * 0.2, 0.56, 0.7], [sx * 0.5, -0.1, 1], 0.1, 0.03, brassL, [0, 1, 0], 0.1).lod(2));
    for (const sx of [1, -1]) {
      // furnace vents behind the shoulders, glowing
      body.hard.push(...vent([sx * 0.31, 0.88, 0.16], [sx * 0.8, 0.5, -0.3], 0.045, EMBER, IRON));
      body.hard.push(...vent([sx * 0.33, 0.82, -0.02], [sx * 0.85, 0.45, -0.3], 0.038, EMBER, IRON));
      // chains swagged along the flank with skull trophies
      const a = [sx * 0.33, 0.52, 0.5], m = [sx * 0.42, 0.42, 0.18], b = [sx * 0.41, 0.48, -0.16];
      body.hard.push(...chain(a, m, 0.016, IRON_L, 2), ...chain(m, b, 0.016, IRON_L, 2));
      p.push(...skull([sx * 0.44, 0.37, 0.16], 0.045, [sx, -0.2, 0.3]));
      p.push(...skull([sx * 0.43, 0.4, -0.15], 0.038, [sx, -0.1, -0.2]));
    }
    // smokestacks: two brass furnace-chimneys rising from the back (behind the rider's seat when ridden)
    for (const sx of [1, -1]) {
      const z0 = ridden ? -0.36 : -0.18, x0 = sx * (ridden ? 0.14 : 0.13);
      body.hard.push(H.lathe([[0.05, 0], [0.055, 0.04], [0.045, 0.06], [0.04, 0.22], [0.055, 0.25], [0.06, 0.3], [0.045, 0.3], [0.04, 0.27]], 12).rot(-18, 0, sx * -10).at(x0, 0.94, z0).color(brassD).pbr(0.35, 0.9));
      body.hard.push(H.cyl(0.042, 0.042, 0.02, 10).rot(-18, 0, sx * -10).at(x0 + sx * 0.05, 1.22, z0 - 0.09).color(EMBER).glow(1.8));
      const fl = N(`flame${sx > 0 ? 'L' : 'R'}`, 'body', [x0 + sx * 0.05, 1.23, z0 - 0.09], { rig: 'vents', detail: 0.6 });
      fl.hard.push(H.cone(0.035, 0.12, 7).rot(-18, 0, sx * -10).at(x0 + sx * 0.055, 1.29, z0 - 0.11).color(EMBER_HOT).glow(2).lod(2));
    }
    if (ridden) {
      // the war-saddle: a dark leather seat on a brass frame, a high skull-crowned pommel and cantle
      p.push(S.ellipsoid(0.2, 0.07, 0.24).at(0, 1.0, -0.02).color(LEATHER).pbr(0.7).tint(0.1, 20).blend(0.01));
      p.push(S.ellipsoid(0.26, 0.04, 0.3).at(0, 0.97, -0.02).color(tone(brass, 0.98, 0.2, -0.25)).pbr(0.75).blend(0.006));
      body.hard.push(H.lathe([[0.001, 0], [0.12, 0.0], [0.14, 0.05], [0.12, 0.13], [0.08, 0.16], [0.001, 0.16]], 12).scale(1.2, 1, 0.35).at(0, 1.0, -0.22).color(brassD).pbr(0.35, 0.9));
      body.hard.push(H.lathe([[0.001, 0], [0.06, 0.0], [0.07, 0.04], [0.04, 0.1], [0.001, 0.12]], 10).scale(1, 1, 0.6).at(0, 1.02, 0.18).color(brassD).pbr(0.35, 0.9));
      p.push(...skull([0, 1.17, 0.2], 0.04, [0, 0.2, 1]));
      for (const sx of [1, -1]) body.hard.push(spike([sx * 0.12, 1.1, -0.22], [sx * 0.4, 1, -0.2], 0.12, 0.03, brassL, [0, 0, -1], 0.2).lod(2));
    }
  }
  // the head: long, low and heavy, the horn sheathed in brass
  const HO = [0, 0.74, 0.7];
  const head = N('mhead', 'body', HO, { rig: 'mhead', detail: 0.85 });
  {
    const p = head.prims, bare = (q) => q.color(hide).bump(0.005, 18, 'rock').tint(0.1, 14).pbr(0.78);
    p.push(bare(S.ellipsoid(0.17, 0.18, 0.2).at(0, 0.74, 0.8)));
    p.push(bare(S.capsule([0, 0.71, 0.88], [0, 0.57, 1.12], 0.155, 0.105).blend(0.06)));
    p.push(bare(S.ellipsoid(0.085, 0.06, 0.06).at(0, 0.5, 1.15).blend(0.04)));                       // the hooked upper lip
    p.push(...S.mirrorX([
      bare(S.ellipsoid(0.07, 0.09, 0.12).at(0.12, 0.62, 0.92).blend(0.04)),                           // cheek
      bare(S.capsule([0.1, 0.84, 0.74], [0.15, 0.98, 0.7], 0.045, 0.02).blend(0.03)),                 // ear
      S.sphere(0.03).at(0.14, 0.97, 0.72).color(hideD).cut(0.01),
      S.sphere(0.016).at(0.06, 0.53, 1.19).color(0x1a0c08).cut(0.006),                                // nostril
      S.sphere(0.03).at(0.15, 0.73, 0.93).color(0x1a0a06).cut(0.012),                                 // eye socket
    ]));
    p.push(S.box(0.22, 0.02, 0.2, 0.01).at(0, 0.48, 1.05).color(0x2a1410).paint(0.008, -0.006));    // mouth line
    // chanfron: brass face-plate down the brow, iron rims, a skull boss
    head.hard.push(orient(H.extrude([[-0.1, 0.12], [0.1, 0.12], [0.11, 0.0], [0.06, -0.14], [0, -0.2], [-0.06, -0.14], [-0.11, 0.0]], 0.016, 0.005).color(brass).pbr(0.3, 0.9)
      .shade((x, y) => (Math.abs(x) < 0.012 || y > 0.1 ? rgb(brassD) : null)), [0, 0.86, 0.9], [0, 0.55, -1], [0, 1, 0.5]));
    p.push(ir(S.ellipsoid(0.16, 0.06, 0.09).rot(-10, 0, 0).at(0, 0.9, 0.76).blend(0.004)));
    p.push(...skull([0, 0.895, 0.86], 0.034, [0, 0.5, 1], [0, 1, -0.4], brassL));
    for (const sx of [1, -1]) {
      head.hard.push(glowEye([0.155 * sx, 0.735, 0.935], 0.018, EMBER, 1.8));
      head.hard.push(H.torus(0.03, 0.009, 10, 5).rot(0, 0, 90).at(0.16 * sx, 0.93, 0.71).color(brassL).pbr(0.3, 0.9).lod(1));   // ear rings
      head.hard.push(spike([0.12 * sx, 0.9, 0.78], [sx * 0.8, 0.5, -0.4], 0.14, 0.03, brassL, [0, 1, 0], 0.25).lod(2));       // jagged plate horns
    }
    // the great horn: a brass sheath over the horn, a ring of teeth at its root, and a lesser iron horn behind
    head.hard.push(...horn([[0, 0.6, 1.08], [0, 0.74, 1.18], [0, 0.92, 1.22], [0, 1.08, 1.16]], 0.085, [brassD, brass, brassL], { rings: 14, ripple: 0.08, rough: 0.3 }));
    head.hard.forEach((h) => { if (h.metal === 0 && h.rough === 0.3) h.pbr(0.3, 0.9); });
    head.hard.push(H.torus(0.085, 0.016, 14, 6).rot(80, 0, 0).at(0, 0.64, 1.08).color(IRON_L).pbr(0.45, 0.8));
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; head.hard.push(spike([Math.cos(a) * 0.09, 0.64 + Math.sin(a) * 0.016, 1.08 + Math.sin(a) * 0.06], [Math.cos(a), 0.1, Math.sin(a) * 0.3], 0.035, 0.012, brassL, [0, 1, 0], 0).lod(1)); }
    head.hard.push(...horn([[0, 0.82, 0.98], [0, 0.9, 1.02], [0, 0.98, 1.0]], 0.05, [IRON, IRON_L, 0x7a6a5a], { rings: 8 }));
  }
  const JO = [0, 0.56, 0.86];
  const jaw = N('mjaw', 'mhead', JO, { rig: 'mjaw', detail: 0.85 });
  jaw.prims.push(S.ellipsoid(0.12, 0.07, 0.2).at(0, 0.47, 1.0).color(hide).bump(0.004, 18, 'rock').pbr(0.78));
  jaw.prims.push(S.ellipsoid(0.08, 0.02, 0.12).at(0, 0.51, 1.05).color(0x6a2a24).pbr(0.4).blend(0.01));
  // four pillar legs in iron greaves with brass knee-cops
  const ft = { kind: 'pillar', w: 0.12, toes: 3, claw: 0x2a2420 };
  const legs = [
    ['FL', 1, [[0.24, 0.62, 0.38], [0.27, 0.34, 0.42], [0.26, 0.12, 0.4], [0.26, 0, 0.42]], [0.15, 0.105, 0.1]],
    ['FR', -1, [[0.24, 0.62, 0.38], [0.27, 0.34, 0.42], [0.26, 0.12, 0.4], [0.26, 0, 0.42]], [0.15, 0.105, 0.1]],
    ['BL', 1, [[0.24, 0.64, -0.42], [0.28, 0.36, -0.34], [0.27, 0.12, -0.44], [0.27, 0, -0.42]], [0.17, 0.11, 0.1]],
    ['BR', -1, [[0.24, 0.64, -0.42], [0.28, 0.36, -0.34], [0.27, 0.12, -0.44], [0.27, 0, -0.42]], [0.17, 0.11, 0.1]],
  ];
  for (const [nm, sx, pts, radii] of legs) {
    const lg = addLeg(N, nm, 'body', sx, pts, radii, sk, { detail: 0.62, foot: ft, muscle: 1.2 });
    const K = lg.K, A = lg.A;
    lg.lo.prims.push(ir(S.capsule(lerp3(K, A, 0.25), lerp3(K, A, 0.85), radii[1] * 1.08, radii[2] * 1.08).blend(0.004)));
    lg.lo.prims.push(S.torus(radii[2] * 1.05, 0.012).at(A[0], lerp(K[1], A[1], 0.85), A[2]).color(brass).pbr(0.3, 0.9).paint(0.004, 0.005));
    lg.up.prims.push(br(S.ellipsoid(radii[1] * 1.0, radii[1] * 0.9, radii[1] * 0.7).at(K[0] + sx * 0.02, K[1] + 0.02, K[2] + 0.05).blend(0.004)));
    lg.up.hard.push(spike([K[0] + sx * 0.03, K[1] + 0.03, K[2] + 0.12], [sx * 0.3, 0, 1], 0.08, 0.025, brassL, [0, 1, 0], 0.1).lod(2));
  }
  // a short tail ending in a spiked iron weight
  addChain(N, 'tail', 'body', [[0, 0.68, -0.66], [0, 0.6, -0.8], [0, 0.48, -0.88], [0, 0.38, -0.9]], [0.07, 0.05, 0.035, 0.03], sk, { rig: 'tail', detail: 0.7,
    deco: (n, a, b, ra, rb, i) => { if (i === 2) { n.prims.push(ir(S.sphere(0.06).at(...b).blend(0.01))); for (let k = 0; k < 6; k++) { const q = (k / 6) * Math.PI * 2; n.hard.push(spike(b, [Math.cos(q), Math.sin(q) * 0.6, Math.sin(q)], 0.06, 0.02, brassL, [0, 1, 0], 0).lod(2)); } } } });
  const nodes = finish(N.nodes);
  let extra = { attack: 'bite' };
  if (ridden) {
    const R = makeRider(def, o.rider, 0.92);
    extra = seatRider(nodes, R, 'body', BO, [0, 1.07, -0.02], { legL: [-40, 0, 56], legR: [-40, 0, -56], shinL: [56, 0, -30], shinR: [56, 0, 30] });
  }
  return { ...extra, kind: 'chaos.rhino', mounted: ridden, nodes };
}

function rhinoAnim(rig, inner, c, base) {
  const { R, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk;
  const k = c.moving ? 1 : 0, idle = Math.sin(t * 1.1 + ph), idle2 = Math.sin(t * 0.6 + ph * 1.7);
  const gait = walk4(rig, c, base, 4.8, 0.3, 0.45, -0.35);
  let hx = idle * 0.03 + k * Math.sin(gait * 2) * 0.04, hy = idle2 * 0.12 * (1 - k), jaw = 0.02 + 0.03 * Math.max(0, idle2), pz = 0, bx = 0;
  const atk = a >= 0 && !rig.mounted ? a : -1;            // a ridden beast lets its rider strike
  if (atk >= 0) {
    hx = keys(atk, [[0, 0], [0.32, 0.35], [0.5, -0.55], [0.7, -0.3], [1, 0]]);
    pz = keys(atk, [[0, 0], [0.32, -0.05], [0.5, 0.18], [1, 0]]);
    bx = keys(atk, [[0, 0], [0.32, 0.06], [0.5, -0.06], [1, 0]]);
    jaw = keys(atk, [[0, 0.02], [0.4, 0.25], [0.6, 0.05], [1, 0.02]]);
    hy = 0;
  }
  R(rig.body, bx + idle * 0.006, Math.sin(gait) * 0.03 * k, Math.sin(gait) * 0.02 * k);
  R(one((rig.mhead)), hx, hy); R(one((rig.mjaw)), jaw);
  tailWave(rig, c, base, 0.25, 2.2, -0.1);
  (rig.vents || []).forEach((v, i) => { const f = 1 + 0.35 * Math.sin(t * 13 + i * 2.1 + ph) + 0.2 * Math.sin(t * 23 + i); v.scale.set(1, f, 1); });
  const dead = dieSide(inner, c, base, 0.3);
  poseRider(rig, c, base, dead, 0.14);
  inner.position.z = pz * s;
  if (dead) { const f = Math.min(1, c.dead * 2); R(one((rig.mhead)), 0.3 * f); R(one((rig.mjaw)), 0.35 * f); return; }
  inner.position.y = k * Math.abs(Math.sin(gait)) * 0.02 * s;
}


// =====================================================================================
//  BLOOD-REAPER: a towering winged crimson fiend in brass and black iron, a reaping axe in both hands
// =====================================================================================
// rig: torso, head, jaw, legs[2], shins[2], arms[2], forearms[2], weapon[], wings[2], wingtips[2], tail[]

/** the reaping axe, in the weapons.js frame: grip at the origin, haft along +Y, edge toward +Z */
function reapingAxe(brass, steel = 0x6a6660) {
  const out = [], bD = tone(brass, -0.01, 0, -0.15);
  out.push(H.tube([[0, -0.36, 0], [0, 0.2, 0.004], [0, 0.82, 0]], [0.022, 0.02, 0.019], 12, 7).color(0x1e1614).pbr(0.6, 0.3)
    .shade((x, y) => (Math.sin(y * 70) > 0.55 && y < 0.15 && y > -0.25 ? rgb(bD) : null)));
  for (const y of [-0.3, 0.2, 0.42]) out.push(H.cyl(0.03, 0.03, 0.035, 10).at(0, y, 0).color(brass).pbr(0.3, 0.9).lod(1));
  out.push(H.cone(0.03, 0.12, 6).rot(180, 0, 0).at(0, -0.42, 0).color(IRON_L).pbr(0.4, 0.8));                // butt spike
  // the blade: a great crescent, steel edge over a black-iron body with a brass spine
  const outline = [[0.0, 0.5], [0.06, 0.44], [0.12, 0.35], [0.15, 0.26], [0.23, 0.31], [0.31, 0.41], [0.36, 0.55], [0.36, 0.69], [0.31, 0.82], [0.23, 0.92], [0.15, 0.99], [0.13, 0.9], [0.08, 0.8], [0.0, 0.74]];
  const cx = 0.12, cy = 0.62, inner = outline.map(([x, y]) => [cx + (x - cx) * 0.8, cy + (y - cy) * 0.84]);
  out.push(H.extrude(outline, 0.008, 0.004).rot(0, -90, 0).color(0xc8c4bc).pbr(0.25, 0.95));
  out.push(H.extrude(inner, 0.02, 0.004).rot(0, -90, 0).color(IRON).pbr(0.4, 0.8).shade((x, y) => (x < 0.06 ? rgb(brass) : null)));
  // a hooked beak behind and a spike on top
  out.push(H.extrude([[0, 0.5], [-0.1, 0.52], [-0.22, 0.46], [-0.12, 0.56], [0, 0.66]], 0.018, 0.004).rot(0, -90, 0).color(IRON).pbr(0.4, 0.8));
  out.push(H.cone(0.022, 0.16, 6).at(0, 0.9, 0).color(steel).pbr(0.3, 0.9));
  out.push(H.lathe([[0.001, 0.44], [0.034, 0.46], [0.04, 0.6], [0.034, 0.74], [0.001, 0.76]], 10).color(brass).pbr(0.3, 0.9));      // brass socket
  out.push(H.sphere(0.03, 10).at(0, 0.6, 0.04).color(0xff3a1a).glow(1.4).lod(1));                            // a burning gem
  return out;
}

function bloodReaper(def, o = {}) {
  const skin = col(o.skin, 0xa8281e), brass = col(o.armor, 0xb07a2a), brassL = tone(brass, 0.01, -0.05, 0.12), brassD = tone(brass, -0.01, 0, -0.15);
  const skinD = tone(skin, 0, 0, -0.12), skinL = tone(skin, 0.02, -0.05, 0.08);
  const sk = (q) => q.color(skin).bump(0.003, 30, 'noise').tint(0.12, 14).pbr(0.55, 0.02);
  const br = (q) => q.color(brass).pbr(0.3, 0.9).tint(0.06, 14);
  const ir = (q) => q.color(IRON).pbr(0.5, 0.75).tint(0.08, 20);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  // legs: long and sinewy, iron greaves, clawed feet
  for (const sx of [1, -1]) {
    const lg = addLeg(N, sx > 0 ? 'L' : 'R', 'root', sx, [[0.085, 0.5, 0], [0.1, 0.27, 0.04], [0.1, 0.06, -0.03], [0.1, 0, 0.0]], [0.068, 0.05, 0.034], sk,
      { detail: 1.0, minRes: 50, muscle: 1.25, foot: { kind: 'claw', len: 0.12, w: 0.042, toes: 3, clawLen: 0.05, claw: 0x161210, spread: 0.45 } });
    const K = lg.K, A = lg.A;
    lg.lo.prims.push(ir(S.capsule(lerp3(K, A, 0.15), lerp3(K, A, 0.8), 0.056, 0.042).blend(0.004)));
    lg.lo.prims.push(S.torus(0.044, 0.006).at(A[0], lerp(K[1], A[1], 0.78), A[2] + 0.005).color(brass).pbr(0.3, 0.9).paint(0.003, 0.004));
    lg.up.prims.push(br(S.ellipsoid(0.052, 0.05, 0.045).at(K[0], K[1] + 0.01, K[2] + 0.03).blend(0.004)));
    lg.up.hard.push(spike([K[0], K[1] + 0.01, K[2] + 0.07], [sx * 0.2, 0.2, 1], 0.06, 0.016, brassL, [0, 1, 0], 0.1).lod(1));
    lg.up.prims.push(ir(S.ellipsoid(0.075, 0.1, 0.06).rot(0, 0, sx * 8).at(sx * 0.1, 0.42, 0.03).blend(0.004)));     // cuisse
  }
  const torso = N('torso', 'root', [0, 0.5, 0], { rig: 'torso', detail: 1.0 });
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.12, 0.08, 0.085).at(0, 0.53, 0)));
    p.push(sk(S.ellipsoid(0.1, 0.1, 0.08).at(0, 0.63, 0.005).blend(0.05)));
    p.push(sk(S.ellipsoid(0.19, 0.13, 0.12).rot(8, 0, 0).at(0, 0.77, 0.0).blend(0.05)));
    p.push(sk(S.ellipsoid(0.23, 0.07, 0.1).at(0, 0.86, -0.01).blend(0.05)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.08, 0.06, 0.05).rot(-10, 15, 0).at(0.07, 0.8, 0.08).blend(0.03)), sk(S.ellipsoid(0.07, 0.11, 0.07).at(0.12, 0.74, -0.04).blend(0.04))]));
    for (let i = 0; i < 3; i++) p.push(S.box(0.1, 0.006, 0.02, 0.003).at(0, 0.6 + i * 0.035, 0.08).color(skinD).paint(0.004, -0.003));
    // armour: brass breastplate with an iron ridge and a horned skull boss; iron belt and tassets
    p.push(br(S.ellipsoid(0.185, 0.11, 0.125).rot(8, 0, 0).at(0, 0.8, 0.02).blend(0.004)));
    p.push(ir(S.box(0.025, 0.2, 0.03, 0.01).rot(8, 0, 0).at(0, 0.79, 0.135).blend(0.004)));
    p.push(...skull([0, 0.79, 0.15], 0.035, [0, 0, 1], [0, 1, 0], brassL));
    p.push(ir(S.torus(0.112, 0.016).scale(1).at(0, 0.56, 0.0).blend(0.004)));
    p.push(S.box(0.06, 0.05, 0.03, 0.008).at(0, 0.56, 0.115).color(brass).pbr(0.3, 0.9).blend(0.004));
    for (let i = 0; i < 6; i++) { const a = (i - 2.5) * 0.55; if (Math.abs(a) < 0.3) continue; p.push(ir(S.box(0.07, 0.11, 0.014, 0.006).rot(-10, 0, 0).rot(0, a / DEG, 0).at(Math.sin(a) * 0.12, 0.47, Math.cos(a) * 0.09).blend(0.003))); }
    p.push(ir(S.ellipsoid(0.17, 0.05, 0.1).at(0, 0.88, -0.03).blend(0.004)));      // iron gorget over the shoulders
    // a ragged loin-cloth front and back
    for (const sz of [1, -1]) torso.hard.push(H.sheet(0.1, 0.24, 3, 6, (u, v) => [Math.sin(v * 9 + u) * 0.006, 0, (1 - v) * 0.02 * sz + Math.sin(u * 7) * 0.004]).rot(0, sz > 0 ? 0 : 180, 0).at(0, 0.42, 0.09 * sz).color(tone(skin, 0, -0.1, -0.22)).pbr(0.85).shade((x, y) => (y < -0.09 && Math.sin(x * 90) > 0.3 ? rgb(tone(skin, 0, -0.1, -0.3)) : null)));
    // spines down the back between the wings
    for (let i = 0; i < 5; i++) torso.hard.push(spike([0, 0.84 - i * 0.06, -0.09 + i * 0.008], [0, 0.3, -1], 0.05 - i * 0.005, 0.014, 0x1a1210, [0, 1, 0], 0.3).lod(1));
  }
  // head: a horned skull-helm of black iron, a bone face-mask, burning eyes, the fanged jaw bare
  const head = N('head', 'torso', [0, 0.9, 0.01], { rig: 'head', detail: 1.6, minRes: 70 });
  {
    const p = head.prims, hy = 0.975, hz = 0.03;
    p.push(sk(S.capsule([0, 0.88, 0.0], [0, 0.94, 0.02], 0.05, 0.045)));
    p.push(ir(S.ellipsoid(0.07, 0.07, 0.078).at(0, hy + 0.01, hz - 0.005)));
    p.push(ir(S.box(0.012, 0.03, 0.12, 0.006).at(0, hy + 0.075, hz - 0.01).blend(0.01)));                    // crest
    p.push(S.ellipsoid(0.05, 0.046, 0.03).at(0, hy - 0.005, hz + 0.055).color(BONE).pbr(0.5).tint(0.1, 40).blend(0.006));   // bone mask
    p.push(S.capsule([-0.055, hy + 0.02, hz + 0.06], [0.055, hy + 0.02, hz + 0.06], 0.012, 0.012).color(IRON).pbr(0.5, 0.7).blend(0.006));  // brow
    for (const sx of [1, -1]) p.push(S.sphere(0.014).at(sx * 0.022, hy + 0.004, hz + 0.08).color(0x0a0505).cut(0.004), ir(S.ellipsoid(0.02, 0.04, 0.04).at(sx * 0.055, hy - 0.025, hz + 0.04).blend(0.004)));
    p.push(S.box(0.05, 0.008, 0.03, 0.002).at(0, hy - 0.04, hz + 0.08).color(0x2a1a10).paint(0.003, -0.003));
    p.push(S.ellipsoid(0.008, 0.014, 0.01).at(0, hy - 0.02, hz + 0.085).color(0x0a0505).cut(0.003));
    for (const sx of [1, -1]) {
      head.hard.push(glowEye([sx * 0.022, hy + 0.004, hz + 0.072], 0.0075, 0xff3010, 2));
      head.hard.push(...horn([[sx * 0.06, hy + 0.04, hz - 0.01], [sx * 0.13, hy + 0.06, hz - 0.03], [sx * 0.18, hy + 0.12, hz + 0.0], [sx * 0.17, hy + 0.2, hz + 0.06]], 0.024, [0x2a1c14, 0x6a5038, BONE], { rings: 12 }));
      head.hard.push(...horn([[sx * 0.04, hy + 0.06, hz - 0.04], [sx * 0.06, hy + 0.11, hz - 0.08], [sx * 0.06, hy + 0.15, hz - 0.13]], 0.012, [0x2a1c14, 0x6a5038, BONE], { rings: 6 }));
    }
  }
  const jaw = N('jaw', 'head', [0, 0.955, 0.04], { rig: 'jaw', detail: 1.6, minRes: 70 });
  jaw.prims.push(sk(S.ellipsoid(0.045, 0.025, 0.045).at(0, 0.94, 0.075)));
  for (const sx of [1, -1]) jaw.hard.push(spike([sx * 0.025, 0.95, 0.105], [sx * 0.1, 1, 0.15], 0.025, 0.006, 0xf0e8d0, [0, 0, 1], 0.2).lod(1));
  // arms with layered brass pauldrons; the axe in the right hand
  let wpn = null;
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.2, 0.85, -0.01]), El = X([0.25, 0.63, 0.0]), Wr = X([0.26, 0.43, 0.05]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 1.1, minRes: 60 });
    up.prims.push(sk(S.capsule(Sp, El, 0.056, 0.045)), sk(S.sphere(0.06).at(...Sp).blend(0.03)), sk(S.ellipsoid(0.05, 0.07, 0.055).at(...lerp3(Sp, El, 0.45)).blend(0.03)));
    up.prims.push(br(S.ellipsoid(0.095, 0.07, 0.09).rot(0, 0, sx * -24).at(...add3(Sp, X([0.02, 0.03, 0]))).blend(0.004)));
    up.prims.push(ir(S.ellipsoid(0.085, 0.05, 0.085).rot(0, 0, sx * -38).at(...add3(Sp, X([0.06, -0.03, 0]))).blend(0.004)));
    up.prims.push(S.ellipsoid(0.098, 0.072, 0.093).rot(0, 0, sx * -24).at(...add3(Sp, X([0.02, 0.028, 0]))).color(brassD).paint(0.004, 0.004));
    for (let i = 0; i < 3; i++) up.hard.push(spike(add3(Sp, X([0.0 + i * 0.03, 0.08 - i * 0.01, -0.03 + i * 0.03])), X([0.3, 1, -0.1]), 0.08 - i * 0.015, 0.018, brassL, [0, 0, 1], 0.25).lod(1));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 1.2, minRes: 60 });
    fo.prims.push(sk(S.sphere(0.046).at(...El)), sk(S.capsule(El, Wr, 0.046, 0.034).blend(0.015)));
    fo.prims.push(ir(S.capsule(lerp3(El, Wr, 0.25), lerp3(El, Wr, 0.92), 0.05, 0.04).blend(0.003)));
    fo.prims.push(S.torus(0.042, 0.006).at(...lerp3(El, Wr, 0.88)).color(brass).pbr(0.3, 0.9).paint(0.003, 0.004));
    fo.hard.push(spike(lerp3(El, Wr, 0.4), X([1, 0.1, -0.3]), 0.06, 0.014, brassL, [0, 1, 0], 0.2).lod(1));
    fo.prims.push(sk(S.ellipsoid(0.04, 0.05, 0.045).at(Wr[0], Wr[1] - 0.04, Wr[2] + 0.01).blend(0.012)));
    for (let i = 0; i < 3; i++) fo.hard.push(spike([Wr[0] + (i - 1) * 0.02, Wr[1] - 0.08, Wr[2] + 0.03], [0, -1, 0.5], 0.03, 0.007, 0x161210, [0, 0, 1], 0.3).lod(1));
    if (sx < 0) {
      const g = [Wr[0], Wr[1] - 0.045, Wr[2] + 0.02];
      const wn = N('weapon', `fore${nm}`, g, { rig: 'weapon', detail: 1 });
      wn.hard = reapingAxe(brass).map((q) => q.rot(38, 0, 0).at(g[0], g[1], g[2]));
      wpn = wn;
    }
  }
  // wings: bat-like membranes on long finger-bones
  const C = { wingA: tone(skin, 0.0, -0.1, -0.24), wingB: tone(skin, 0.01, 0.02, -0.06), bone: skinD, claw: 0x161210 };
  const G = { Sh: [0.07, 0.84, -0.1], E: [0.33, 1.06, -0.18], W: [0.54, 0.98, -0.22], tips: [[0.92, 1.24, -0.28], [1.02, 0.86, -0.32], [0.84, 0.56, -0.32], [0.56, 0.42, -0.26]], hip: [0.07, 0.56, -0.1] };
  addWings(N, 'torso', G, () => batWing(G, C, { k: 0.85, torn: true }), 0.9);
  // a barbed tail
  addChain(N, 'tail', 'torso', [[0, 0.5, -0.07], [0, 0.4, -0.2], [0, 0.26, -0.32], [0, 0.14, -0.42], [0, 0.08, -0.54]], [0.035, 0.028, 0.02, 0.013, 0.006], sk, { rig: 'tail', detail: 1.2, minRes: 60,
    deco: (n, a, b, ra, rb, i) => { if (i === 3) n.hard.push(spike(b, [0, -0.2, -1], 0.07, 0.025, 0x1a1210, [0, 1, 0], 0, 0.4).lod(2)); } });
  return { kind: 'chaos.fiend', attack: 'slam', hold: 'two', nodes: finish(N.nodes) };
}

/** two-legged fiends: stock upper body (the strike), legs that tuck in flight, wings that fold on the ground */
function fiendAnim(rig, inner, c, base) {
  const { R } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0;
  const L = rig.legs || [], Sh = rig.shins || [], k = c.moving && !c.flying ? 1 : 0, gait = t * (rig.rate || 7.5) + ph;
  for (let i = 0; i < 2; i++) {
    const sg = i ? -1 : 1;
    if (c.flying) { R(L[i], 0.35 + Math.sin(t * 2 + i) * 0.06); R(Sh[i], 0.75); continue; }
    R(L[i], -Math.sin(gait) * sg * 0.55 * k); R(Sh[i], k * (0.1 + Math.max(0, Math.cos(gait) * sg) * 0.9));
  }
  base.upperBody(rig, c);
  const open = c.atk >= 0 ? bellK(c.atk) : 0;
  if (rig.wings) wingsPose(rig, c, base, s, { rate: 7, amp: 0.6, open, fold: rig.fold ? [0.95, 0.35, 1.5, -0.55, 0.1] : undefined });
  R(rig.jaw, 0.05 + (c.atk >= 0 ? 0.4 * open : 0.04 * Math.max(0, Math.sin(t * 0.8 + ph))));
  tailWave(rig, c, base, 0.2, 2, 0);
  const dead = base.die(inner, c);
  if (dead) return;
  if (c.flying) { inner.rotation.x = 0.32; inner.position.y = Math.sin(t * 7 / Math.sqrt(Math.max(0.3, s)) + ph) * 0.03 * s; }
  else inner.position.y = k * Math.abs(Math.sin(gait)) * 0.025 * s;
  if (rig.core) rig.core.scale.setScalar(1 + Math.sin(t * 3 + ph) * 0.06 + open * 0.3);
}


// =====================================================================================
//  SLAUGHTER-BRUTE: a hunched furnace-bellied brute; cleaver arm and talon arm, a grilled maw that breathes fire
// =====================================================================================
// rig: torso, head, jaw, core (the furnace glow, pulses), legs[2], shins[2], arms[2], forearms[2], vents[]
function slaughterBrute(def, o = {}) {
  const skin = col(o.skin, 0x8a1a14), plate = col(o.armor, IRON), glow = col(o.glow, EMBER), glowHot = mix(glow, 0xfff0a0, 0.45);
  const skinD = tone(skin, 0, 0, -0.1), brass = 0xb07a2a;
  const sk = (q) => q.color(skin).bump(0.005, 16, 'rock').tint(0.14, 10).pbr(0.62, 0.02);
  const ir = (q) => q.color(plate).pbr(0.5, 0.75).tint(0.1, 16);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  for (const sx of [1, -1]) {
    const lg = addLeg(N, sx > 0 ? 'L' : 'R', 'root', sx, [[0.14, 0.4, -0.06], [0.18, 0.22, 0.03], [0.16, 0.07, -0.04], [0.16, 0, -0.01]], [0.1, 0.075, 0.058], sk,
      { detail: 0.85, muscle: 1.3, foot: { kind: 'claw', len: 0.15, w: 0.07, toes: 3, clawLen: 0.06, claw: 0x161210, spread: 0.5 } });
    lg.lo.prims.push(ir(S.capsule(lerp3(lg.K, lg.A, 0.2), lerp3(lg.K, lg.A, 0.85), 0.08, 0.064).blend(0.004)));
    lg.up.prims.push(ir(S.ellipsoid(0.07, 0.06, 0.06).at(lg.K[0], lg.K[1] + 0.01, lg.K[2] + 0.04).blend(0.004)));
    lg.up.hard.push(spike([lg.K[0], lg.K[1] + 0.01, lg.K[2] + 0.1], [sx * 0.2, 0.2, 1], 0.06, 0.02, IRON_L, [0, 1, 0], 0).lod(1));
  }
  const torso = N('torso', 'root', [0, 0.42, -0.05], { rig: 'torso', detail: 0.8 });
  const BC = [0, 0.56, 0.08];       // the belly furnace
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.2, 0.12, 0.15).at(0, 0.45, -0.05)));
    p.push(sk(S.ellipsoid(0.24, 0.22, 0.22).at(0, 0.57, 0.04).blend(0.06)));                               // gut
    p.push(sk(S.ellipsoid(0.3, 0.19, 0.2).rot(24, 0, 0).at(0, 0.75, 0.0).blend(0.06)));                    // chest
    p.push(sk(S.ellipsoid(0.36, 0.13, 0.2).at(0, 0.84, -0.06).blend(0.06)));                               // yoke
    p.push(sk(S.ellipsoid(0.2, 0.14, 0.14).at(0, 0.9, -0.12).blend(0.06)));                                // the hump
    p.push(...S.mirrorX([sk(S.ellipsoid(0.12, 0.08, 0.08).rot(-20, 20, 0).at(0.12, 0.78, 0.14).blend(0.04)), sk(S.ellipsoid(0.09, 0.15, 0.1).at(0.2, 0.68, -0.06).blend(0.05))]));
    p.push(S.ellipsoid(0.2, 0.12, 0.2).at(0, 0.92, -0.12).color(skinD).paint(0.05));
    // the furnace: an iron ring set into the gut, its door a grate of bars
    p.push(ir(S.torus(0.14, 0.03).rot(90, 0, 0).at(BC[0], BC[1], BC[2] + 0.2).blend(0.004)));
    p.push(S.cyl(0.13, 0.2).rot(90, 0, 0).at(BC[0], BC[1], BC[2] + 0.22).color(0x2a0a04).cut(0.006));
    for (let i = -2; i <= 2; i++) torso.hard.push(H.box(0.016, 0.24 - Math.abs(i) * 0.03, 0.02, 0.004).at(i * 0.045, BC[1], BC[2] + 0.215).color(IRON_L).pbr(0.5, 0.75));
    torso.hard.push(H.box(0.27, 0.018, 0.02, 0.004).at(0, BC[1], BC[2] + 0.22).color(IRON_L).pbr(0.5, 0.75));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; torso.hard.push(H.sphere(0.012, 6).at(Math.cos(a) * 0.14, BC[1] + Math.sin(a) * 0.14, BC[2] + 0.235).color(brass).pbr(0.3, 0.9).lod(0)); }
    // iron plates: a collar of spikes, belt and chains across the chest
    p.push(ir(S.torus(0.13, 0.035).rot(-30, 0, 0).at(0, 0.86, 0.07).blend(0.004)));
    p.push(ir(S.torus(0.2, 0.04).at(0, 0.45, -0.05).blend(0.004)));
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI - Math.PI / 2 + 0.2; torso.hard.push(spike([Math.sin(a) * 0.13, 0.89, 0.07 + Math.cos(a) * 0.08 - 0.06], [Math.sin(a), 0.6, Math.cos(a) * 0.4], 0.07, 0.02, IRON_L, [0, 1, 0], 0).lod(1)); }
    for (const sx of [1, -1]) torso.hard.push(...chain([sx * 0.27, 0.84, 0.12], [sx * 0.2, 0.72, 0.24], 0.018, IRON_L, 2), ...chain([sx * 0.2, 0.72, 0.24], [sx * 0.19, 0.55, 0.29], 0.018, IRON_L, 2),
      ...chain([sx * 0.28, 0.86, -0.08], [sx * 0.05, 0.62, -0.26], 0.018, IRON_L, 2), H.torus(0.03, 0.01, 10, 5).at(sx * 0.2, 0.72, 0.245).color(brass).pbr(0.3, 0.9));
    for (let i = 0; i < 4; i++) p.push(ir(S.ellipsoid(0.11 - i * 0.012, 0.05, 0.05).rot(30, 0, 0).at(0, 0.88 - i * 0.09, -0.24 + i * 0.035).blend(0.004)));
    for (let i = 0; i < 4; i++) torso.hard.push(spike([0, 0.92 - i * 0.09, -0.28 + i * 0.035], [0, 0.4, -1], 0.08, 0.022, IRON_L, [0, 1, 0], 0.2).lod(1));
    // two smokestacks from the hump, glowing at the mouth
    for (const sx of [1, -1]) {
      torso.hard.push(H.lathe([[0.04, 0], [0.04, 0.17], [0.055, 0.2], [0.05, 0.24], [0.035, 0.22]], 10).rot(-25, 0, sx * -18).at(sx * 0.1, 0.92, -0.16).color(plate).pbr(0.5, 0.75));
      torso.hard.push(H.cyl(0.036, 0.036, 0.02, 10).rot(-25, 0, sx * -18).at(sx * 0.17, 1.13, -0.26).color(glow).glow(1.8));
      const fl = N(`smoke${sx > 0 ? 'L' : 'R'}`, 'torso', [sx * 0.17, 1.14, -0.26], { rig: 'vents', detail: 0.7 });
      fl.hard.push(H.cone(0.03, 0.12, 7).rot(-25, 0, sx * -18).at(sx * 0.19, 1.19, -0.29).color(glowHot).glow(2).lod(2));
    }
  }
  const core = N('core', 'torso', [BC[0], BC[1], BC[2] + 0.16], { rig: 'core', detail: 0.8 });
  core.hard.push(H.sphere(0.13, 14).scale(1, 1, 0.45).at(BC[0], BC[1], BC[2] + 0.16).color(glow).glow(1.9).pbr(0.5));
  core.hard.push(H.sphere(0.07, 10).scale(1, 1, 0.4).at(BC[0], BC[1] - 0.04, BC[2] + 0.19).color(glowHot).glow(2).pbr(0.5).lod(1));
  // head: low between the shoulders; heavy brow, short horns, an iron muzzle-grille over a glowing maw
  const HO = [0, 0.86, 0.14];
  const head = N('head', 'torso', HO, { rig: 'head', detail: 1.3, minRes: 60 });
  {
    const p = head.prims, hy = 0.9, hz = 0.22, bare = (q) => q.color(skin).bump(0.004, 22, 'rock').tint(0.12, 16).pbr(0.6);
    p.push(bare(S.ellipsoid(0.1, 0.09, 0.1).at(0, hy, hz)));
    p.push(bare(S.capsule([-0.07, hy + 0.04, hz + 0.08], [0.07, hy + 0.04, hz + 0.08], 0.03, 0.03).blend(0.02)).color(skinD));
    p.push(bare(S.ellipsoid(0.085, 0.06, 0.08).at(0, hy - 0.04, hz + 0.06).blend(0.03)));
    for (const sx of [1, -1]) {
      p.push(S.sphere(0.02).at(sx * 0.04, hy + 0.02, hz + 0.095).color(0x0a0404).cut(0.006));
      head.hard.push(glowEye([sx * 0.04, hy + 0.018, hz + 0.088], 0.009, glow, 2));
      head.hard.push(...horn([[sx * 0.07, hy + 0.05, hz + 0.0], [sx * 0.15, hy + 0.08, hz - 0.02], [sx * 0.21, hy + 0.14, hz + 0.04], [sx * 0.2, hy + 0.2, hz + 0.12]], 0.036, [0x1a1210, 0x4a3a2a, 0xb8a888], { rings: 8 }));
    }
    // the glowing maw behind a cage of iron bars strapped round the head
    p.push(S.box(0.11, 0.035, 0.06, 0.012).at(0, hy - 0.05, hz + 0.13).color(0x2a0804).cut(0.006));
    head.hard.push(H.sphere(0.05, 12).scale(1, 0.32, 0.5).at(0, hy - 0.05, hz + 0.12).color(glow).glow(1.8));
    head.hard.push(H.torus(0.11, 0.012, 16, 5, Math.PI).rot(90, 0, 0).rot(0, 0, 180).scale(1, 1, 0.95).at(0, hy - 0.01, hz + 0.05).color(plate).pbr(0.5, 0.75));
    head.hard.push(H.torus(0.105, 0.012, 16, 5, Math.PI).rot(90, 0, 0).rot(0, 0, 180).scale(1, 1, 0.95).at(0, hy - 0.1, hz + 0.05).color(plate).pbr(0.5, 0.75));
    for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.4; head.hard.push(H.cyl(0.008, 0.008, 0.11, 6).at(Math.sin(a) * 0.108, hy - 0.055, hz + 0.05 + Math.cos(a) * 0.102).color(IRON_L).pbr(0.45, 0.8)); }
    head.hard.push(H.box(0.18, 0.016, 0.012, 0.004).at(0, hy + 0.0, hz + 0.155).rot(0, 0, 0).color(brass).pbr(0.3, 0.9).lod(1));
  }
  const jaw = N('jaw', 'head', [0, 0.87, 0.2], { rig: 'jaw', detail: 1.3, minRes: 60 });
  jaw.prims.push(S.ellipsoid(0.075, 0.035, 0.07).at(0, 0.81, 0.27).color(skin).pbr(0.6));
  jaw.prims.push(S.ellipsoid(0.05, 0.012, 0.045).at(0, 0.84, 0.29).color(glow).glow(1.5).blend(0.004));
  for (const sx of [1, -1]) jaw.hard.push(spike([sx * 0.05, 0.83, 0.31], [sx * 0.2, 1, 0.2], 0.05, 0.012, 0xe8dcc0, [0, 0, 1], 0.25).lod(1));
  // arms: massive; the right ends in a cleaver grown through the fist, the left in three iron talons
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.33, 0.83, -0.02]), El = X([0.41, 0.58, 0.06]), Wr = X([0.39, 0.34, 0.16]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 0.9 });
    up.prims.push(sk(S.capsule(Sp, El, 0.1, 0.082)), sk(S.sphere(0.11).at(...Sp).blend(0.04)), sk(S.ellipsoid(0.09, 0.12, 0.1).at(...lerp3(Sp, El, 0.4)).blend(0.04)));
    up.prims.push(ir(S.ellipsoid(0.15, 0.1, 0.14).rot(0, 0, sx * -24).at(...add3(Sp, X([0.03, 0.05, 0]))).blend(0.004)));
    up.prims.push(ir(S.ellipsoid(0.13, 0.07, 0.13).rot(0, 0, sx * -40).at(...add3(Sp, X([0.08, -0.03, 0]))).blend(0.004)));
    up.prims.push(S.ellipsoid(0.153, 0.103, 0.143).rot(0, 0, sx * -24).at(...add3(Sp, X([0.03, 0.045, 0]))).color(brass).pbr(0.3, 0.9).paint(0.005, 0.005));
    for (let i = 0; i < 5; i++) { const a = (i / 4 - 0.5) * 2.2; up.hard.push(H.sphere(0.012, 6).at(...add3(Sp, X([0.03 + Math.cos(a) * 0.03 + 0.1, 0.02, Math.sin(a) * 0.12]))).color(brass).pbr(0.3, 0.9).lod(0)); }
    for (let i = 0; i < 3; i++) up.hard.push(spike(add3(Sp, X([0.02 + i * 0.04, 0.12 - i * 0.03, -0.05 + i * 0.04])), X([0.4, 1, -0.2]), 0.11 - i * 0.02, 0.03, IRON_L, [0, 0, 1], 0.2).lod(1));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 0.95 });
    fo.prims.push(sk(S.sphere(0.085).at(...El)), sk(S.capsule(El, Wr, 0.085, 0.07).blend(0.02)), sk(S.ellipsoid(0.1, 0.13, 0.1).at(...lerp3(El, Wr, 0.4)).blend(0.04)));
    fo.prims.push(ir(S.capsule(lerp3(El, Wr, 0.35), lerp3(El, Wr, 0.95), 0.1, 0.08).blend(0.004)));
    fo.prims.push(sk(S.ellipsoid(0.075, 0.07, 0.08).at(Wr[0], Wr[1] - 0.05, Wr[2] + 0.02).blend(0.02)));       // fist
    const dir = norm3(sub3(Wr, El));
    if (sx < 0) {
      // cleaver: a broad slab of black iron, steel-edged, running on from the forearm past the fist
      const cl = H.extrude([[0, -0.02], [0.33, -0.03], [0.36, 0.02], [0.34, 0.12], [0.06, 0.1], [0, 0.06]], 0.016, 0.004)
        .shade((x, y) => (y > 0.08 ? rgb(0xc0bab0) : x > 0.3 ? rgb(0x8a8680) : null)).color(IRON).pbr(0.35, 0.85);
      fo.hard.push(orient(cl.rot(0, 0, 90).rot(0, 90, 0), add3(lerp3(El, Wr, 0.55), [0, 0, 0.06]), dir, [0, 0, 1]));
      fo.hard.push(H.sphere(0.015, 6).at(...add3(lerp3(El, Wr, 0.7), [sx * -0.01, 0, 0.07])).color(brass).pbr(0.3, 0.9).lod(0));
    } else {
      for (let i = 0; i < 3; i++) fo.hard.push(spike([Wr[0] + (i - 1) * 0.035, Wr[1] - 0.09, Wr[2] + 0.04], [(i - 1) * 0.15, -1, 0.35], 0.16, 0.022, IRON_L, [0, 0, 1], 0.35).lod(3));
    }
  }
  return { kind: 'chaos.brute', attack: 'claw', rate: 6, nodes: finish(N.nodes) };
}

function bruteAnim(rig, inner, c, base) {
  fiendAnim(rig, inner, c, base);
  const { R } = base, t = c.t, ph = c.phase || 0;
  if (c.dead > 0) return;
  if (rig.torso) rig.torso.rotation.x += 0.04 + Math.sin(t * 1.2 + ph) * 0.02;
  R(rig.jaw, c.atk >= 0 ? 0.5 * bellK(c.atk) : 0.04 + 0.04 * Math.max(0, Math.sin(t * 0.9 + ph)));
  (rig.vents || []).forEach((v, i) => { const f = 1 + 0.35 * Math.sin(t * 13 + i * 2.1 + ph) + 0.2 * Math.sin(t * 23 + i); v.scale.set(1, f, 1); });
  if (rig.core) rig.core.scale.setScalar(1 + Math.sin(t * 3.1 + ph) * 0.07 + Math.sin(t * 11 + ph) * 0.03 + (c.atk >= 0 ? 0.25 * bellK(c.atk) : 0));
}

// =====================================================================================
//  PLAGUE-TOAD: a gigantic bloated swamp-toad, warty and boil-studded, its back a bed of moss and mushrooms
// =====================================================================================
// rig: torso, head (upper skull), jaw, throat, tongue, legs[4] (FL FR BL BR), shins[4], bells[]
function plagueToad(def, o = {}) {
  const skin = col(o.skin, 0x6a8a3a), belly = col(o.belly, 0xc8c070), rnd = rng(hashStr((def.id || 'toad') + ':toad'));
  const skinD = tone(skin, 0.02, -0.05, -0.12), skinL = tone(skin, -0.02, 0.05, 0.08), moss = tone(skin, 0.04, -0.08, -0.13), mud = 0x4a3a22, wart = tone(skin, -0.04, 0.1, -0.04);
  const rust = 0x8a4a22, boilC = 0xd8c048, boilR = 0x9a3a2a;
  const sk = (q) => q.color(skin).bump(0.006, 18, 'scales').tint(0.2, 9).pbr(0.55, 0);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const TO = [0, 0.36, 0];
  const torso = N('torso', 'root', TO, { rig: 'torso', detail: 0.7 });
  // points on the back surface: an ellipsoid shell approximating the body
  const onBack = (u, v, lift = 0) => {      // u: around (-1 left .. 1 right), v: along (-1 rear .. 1 front)
    const a = u * 1.25, cz = -0.06 + v * 0.38;
    const rr = Math.sqrt(Math.max(0.05, 1 - v * v * 0.75));
    return [Math.sin(a) * 0.42 * rr * (1 + lift), 0.42 + Math.cos(a) * 0.3 * rr * (1 + lift), cz];
  };
  const nrmAt = (u, v) => norm3([Math.sin(u * 1.25) / 0.42, Math.cos(u * 1.25) / 0.3, v * 0.6]);
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.42, 0.3, 0.44).at(0, 0.42, -0.06)));
    p.push(sk(S.ellipsoid(0.4, 0.22, 0.38).at(0, 0.28, 0.0).blend(0.08)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.17, 0.18, 0.22).at(0.28, 0.34, -0.3).blend(0.08))]));          // haunches
    p.push(S.ellipsoid(0.36, 0.16, 0.36).at(0, 0.16, 0.02).color(belly).tint(0.15, 12).paint(0.05));
    // moss over the back, and mud stains low on the flanks
    p.push(S.ellipsoid(0.36, 0.14, 0.38).at(0, 0.68, -0.1).color(moss).bump(0.012, 40, 'fur').tint(0.35, 18).pbr(0.95).paint(0.05, 0.01));
    p.push(S.ellipsoid(0.18, 0.1, 0.2).at(0.12, 0.66, 0.1).color(tone(moss, 0.04, 0.05, 0.06)).bump(0.01, 46, 'fur').pbr(0.95).paint(0.04, 0.008));
    for (const sx of [1, -1]) p.push(S.ellipsoid(0.1, 0.1, 0.3).at(sx * 0.42, 0.24, -0.08).color(mud).tint(0.3, 20).paint(0.06));
    // warts
    for (let i = 0; i < 46; i++) {
      const u = (rnd() * 2 - 1) * 0.95, v = rnd() * 1.6 - 0.85, q = onBack(u, v), r = 0.012 + rnd() * 0.022;
      p.push(S.sphere(r).at(...q).color(i % 3 ? wart : skinD).tint(0.2, 60).pbr(0.5).blend(0.012));
    }
    // boils: glossy, yellow, angry rims
    for (let i = 0; i < 9; i++) {
      const u = (rnd() * 2 - 1) * 0.9, v = rnd() * 1.4 - 0.8, q = onBack(u, v, 0.02), r = 0.025 + rnd() * 0.022, n = nrmAt(u, v);
      p.push(S.sphere(r * 1.5).at(...q).color(boilR).paint(r * 0.5));
      p.push(S.sphere(r).at(...add3(q, mul3(n, r * 0.4))).color(boilC).pbr(0.15).blend(0.01));
      torso.hard.push(H.sphere(r * 0.35, 6).at(...add3(q, mul3(n, r * 1.25))).color(0xf0e0a0).pbr(0.1).lod(0));
    }
    // a mouldering harness: a girth strap and a breast strap, rusted rings, bells hung from both sides
    p.push(S.torus(0.4, 0.022).rot(90, 0, 0).scale(1).at(0, 0.38, -0.04).color(LEATHER).pbr(0.75).paint(0.004, 0.012));
    p.push(S.torus(0.33, 0.02).rot(90, 0, 0).at(0, 0.38, 0.18).color(LEATHER).pbr(0.75).paint(0.004, 0.012));
    p.push(S.box(0.06, 0.5, 0.4, 0.01).at(0, 0.7, 0.07).color(LEATHER).pbr(0.75).paint(0.004, 0.012));
    torso.hard.push(H.torus(0.04, 0.01, 10, 5).rot(90, 0, 0).at(0, 0.73, 0.07).color(rust).pbr(0.7, 0.5));
  }
  // mushrooms sprouting from the moss
  for (let i = 0; i < 11; i++) {
    const u = (rnd() * 2 - 1) * 0.75, v = rnd() * 1.2 - 0.75, q = onBack(u, v, -0.04), n = nrmAt(u, v), h = 0.04 + rnd() * 0.08, cr = 0.025 + rnd() * 0.04;
    const capC = [0xb85a2a, 0xc8b8a0, 0x8a5a9a, 0xd8a040][i % 4], spot = i % 4 === 0 ? 0xf0e8d0 : null;
    const dirn = norm3(add3(n, [(rnd() - 0.5) * 0.4, 0.3, (rnd() - 0.5) * 0.4]));
    torso.hard.push(orient(H.cyl(cr * 0.28, cr * 0.36, h, 7).at(0, h / 2, 0).color(0xe0d8c0).pbr(0.8), q, dirn).lod(1));
    torso.hard.push(orient(H.lathe([[0.001, h + cr * 0.55], [cr * 0.5, h + cr * 0.5], [cr * 0.9, h + cr * 0.2], [cr, h - cr * 0.05], [cr * 0.3, h], [0.001, h]], 10).color(capC).pbr(0.6)
      .shade(spot ? (x, y, z) => (noise3(x * 120, y * 120, z * 120) > 0.68 ? spot : null) : null), q, dirn).lod(i % 3 ? 1 : 2));
  }
  // bells on the harness
  const bells = [];
  for (const sx of [1, -1]) for (const z of [-0.04, 0.18]) {
    const at = [sx * (z > 0 ? 0.4 : 0.47), 0.3, z];
    const b = N(`bell${bells.length}`, 'torso', at, { rig: 'bells', detail: 1 });
    b.hard.push(...bell(at, 0.035, rust));
    bells.push(b);
  }
  // the head: a broad flat skull, the eyes up on turrets, a wide mouth line
  const HO = [0, 0.42, 0.24];
  const head = N('head', 'torso', HO, { rig: 'head', detail: 0.85 });
  {
    const p = head.prims;
    p.push(sk(S.ellipsoid(0.36, 0.14, 0.24).at(0, 0.45, 0.36)));
    p.push(sk(S.ellipsoid(0.3, 0.1, 0.12).at(0, 0.44, 0.52).blend(0.06)));
    for (const sx of [1, -1]) {
      p.push(sk(S.ellipsoid(0.09, 0.08, 0.09).at(sx * 0.2, 0.56, 0.38).blend(0.05)));
      p.push(S.ellipsoid(0.06, 0.05, 0.03).at(sx * 0.27, 0.48, 0.28).color(skinD).paint(0.01, 0.006));            // eardrum
      head.hard.push(orient(eyeball(0.06, { iris: 0xd8a020, rim: 0x6a4a08, white: 0x2a2a0a, pupil: 0x060604 }).rot(-90, 0, 0).rot(0, 90, 0), [sx * 0.21, 0.6, 0.41], [sx * 0.6, 0.35, 0.75]));
      p.push(sk(S.torus(0.06, 0.014).rot(70, sx * 30, 0).at(sx * 0.21, 0.6, 0.41).blend(0.02)));             // lids
      p.push(S.sphere(0.012).at(sx * 0.05, 0.5, 0.6).color(0x1a1408).cut(0.005));                               // nostril
    }
    p.push(S.ellipsoid(0.36, 0.02, 0.26).at(0, 0.37, 0.4).color(0x3a2a14).paint(0.01, -0.006));                   // the lip line
  }
  const JO = [0, 0.36, 0.2];
  const jaw = N('jaw', 'head', JO, { rig: 'jaw', detail: 0.8 });
  {
    jaw.prims.push(sk(S.ellipsoid(0.34, 0.08, 0.26).at(0, 0.32, 0.38)));
    jaw.prims.push(S.ellipsoid(0.3, 0.06, 0.22).at(0, 0.28, 0.38).color(belly).paint(0.03));
    jaw.prims.push(S.ellipsoid(0.3, 0.02, 0.22).at(0, 0.37, 0.38).color(0x8a3a3a).pbr(0.3).blend(0.006));
    // drool strings
    for (const [x, d] of [[-0.22, 0.09], [-0.05, 0.05], [0.17, 0.11]]) { const z = 0.56 - Math.abs(x) * 0.5, y = 0.31; jaw.hard.push(H.tube([[x, y, z], [x + 0.006, y - d * 0.55, z + 0.01], [x, y - d, z + 0.006]], [0.006, 0.0035, 0.008], 6, 5).color(0xa8c070).pbr(0.08).lod(1)); }
  }
  const throat = N('throat', 'jaw', [0, 0.25, 0.32], { rig: 'throat', detail: 0.9 });
  throat.prims.push(S.ellipsoid(0.2, 0.08, 0.16).at(0, 0.25, 0.32).color(belly).tint(0.1, 20).pbr(0.35));
  const tongue = N('tongue', 'jaw', [0, 0.35, 0.3], { rig: 'tongue', detail: 1 });
  tongue.hard.push(H.capsule(0.035, 0.2, 10).rot(90, 0, 0).scale(1, 0.55, 1).at(0, 0.35, 0.38).color(0xc85a6a).pbr(0.25));
  tongue.hard.push(H.sphere(0.05, 10).scale(1, 0.6, 1).at(0, 0.35, 0.49).color(0xd86a7a).pbr(0.2));
  // legs: short splayed arms, huge folded hind legs with webbed feet
  const fFoot = { kind: 'claw', len: 0.13, w: 0.05, toes: 4, clawLen: 0.0001, claw: skinL, spread: 0.55 };
  const bFoot = { kind: 'claw', len: 0.24, w: 0.06, toes: 4, clawLen: 0.0001, claw: skinL, spread: 0.4 };
  const legs = [
    ['FL', 1, [[0.26, 0.3, 0.26], [0.36, 0.16, 0.32], [0.36, 0.06, 0.4], [0.38, 0, 0.42]], [0.08, 0.055, 0.04], fFoot],
    ['FR', -1, [[0.26, 0.3, 0.26], [0.36, 0.16, 0.32], [0.36, 0.06, 0.4], [0.38, 0, 0.42]], [0.08, 0.055, 0.04], fFoot],
    ['BL', 1, [[0.3, 0.34, -0.28], [0.5, 0.26, -0.02], [0.44, 0.08, -0.3], [0.46, 0, -0.18]], [0.14, 0.08, 0.05], bFoot],
    ['BR', -1, [[0.3, 0.34, -0.28], [0.5, 0.26, -0.02], [0.44, 0.08, -0.3], [0.46, 0, -0.18]], [0.14, 0.08, 0.05], bFoot],
  ];
  for (const [nm, sx, pts, radii, foot] of legs) {
    const lg = addLeg(N, nm, 'torso', sx, pts, radii, sk, { detail: 0.8, foot, muscle: 1.25, clawLod: 0 });
    lg.up.prims.push(S.ellipsoid(radii[0], radii[0] * 0.5, radii[0] * 1.4).at(...lerp3(lg.J, lg.K, 0.5)).color(skinD).paint(0.02));
  }
  return { kind: 'chaos.toad', attack: 'bite', nodes: finish(N.nodes) };
}

function toadAnim(rig, inner, c, base) {
  const { R, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk;
  const k = c.moving ? 1 : 0, gait = walk4(rig, c, base, 4.2, 0.28, 0.4, -0.5);
  const breathe = Math.sin(t * 2.2 + ph);
  let jaw = 0.02 + 0.02 * Math.max(0, breathe), lash = 0, hx = 0, pz = 0, tx = 0;
  if (a >= 0) {
    jaw = keys(a, [[0, 0.02], [0.25, 0.45], [0.6, 0.45], [0.8, 0.05], [1, 0.02]]);
    lash = keys(a, [[0, 0], [0.25, 0], [0.42, 1], [0.6, 0.9], [0.8, 0], [1, 0]]);
    hx = keys(a, [[0, 0], [0.25, -0.2], [0.6, -0.15], [1, 0]]);
    pz = keys(a, [[0, 0], [0.25, -0.04], [0.42, 0.12], [1, 0]]);
    tx = keys(a, [[0, 0], [0.25, 0.08], [0.42, -0.06], [1, 0]]);
  }
  R(rig.torso, tx + breathe * 0.01, Math.sin(gait) * 0.05 * k, Math.sin(gait) * 0.07 * k);
  R(rig.head, hx); R(rig.jaw, jaw);
  if (one(rig.throat)) { const f = a >= 0 ? 1 : 1 + 0.35 * Math.max(0, Math.sin(t * 2.6 + ph)); one(rig.throat).scale.set(f, f * 1.1, f); }
  if (one(rig.tongue)) { R(one((rig.tongue)), -0.12 * lash); one(rig.tongue).scale.set(1, 1, 1 + lash * 6); }
  (rig.bells || []).forEach((b, i) => R(b, Math.sin(t * (k ? 8 : 2) + i * 1.3 + ph) * (0.08 + 0.18 * k), 0, Math.sin(t * (k ? 7 : 1.7) + i + ph) * (0.06 + 0.15 * k)));
  if (c.dead > 0) {                                      // rolls onto its back, legs in the air
    const f = Math.min(1, c.dead * 1.6), e = f * f * (3 - 2 * f);
    inner.rotation.z = e * Math.PI; inner.rotation.x = 0;
    inner.position.y = (e * 0.62 - Math.max(0, c.dead - 0.8) * 0.5) * s;
    (rig.legs || []).forEach((l, i) => R(l, 0, 0, (i % 2 ? -1 : 1) * 0.4 * e));
    R(rig.jaw, 0.3 * e);
    return;
  }
  inner.rotation.z = 0; inner.rotation.x = 0;
  inner.position.z = pz * s;
  inner.position.y = (k * Math.abs(Math.sin(gait)) * 0.03 + Math.max(0, breathe) * 0.004) * s;
}

// =====================================================================================
//  CARRION-FLY: a fly the size of a warhorse, ridden
// =====================================================================================
// rig: body (thorax), mhead, abdomen, wings[2], legs[6], shins[6]; the rider's stock keys
function veinWing(len, wid, colA, sx) {
  // leading edge along +X (sx mirrors), trailing edge behind; membrane with vein colours, crisp veins as tubes
  const A = (u) => [sx * len * u, 0.04 * Math.sin(u * Math.PI) - 0.02 * u, -0.02 * u * u];
  const B = (u) => [sx * len * (0.08 + 0.9 * u), -0.01 * u, -wid * Math.sin(Math.min(1, 0.15 + u) * Math.PI * 0.9) - 0.03];
  const cA = rgb(colA), cV = rgb(tone(colA, 0.02, 0.1, -0.35)), cT = rgb(tone(colA, 0.08, 0.15, 0.1));
  const out = [membrane(A, B, { nu: 14, nv: 6, scallop: 0.04, billow: 0.008, col: (u, v) => {
    const vein = Math.min(Math.abs(Math.sin(v * Math.PI * 2.5)), Math.abs(Math.sin(u * Math.PI * 3.2 + v)));
    let c3 = mixRgb(cA, cT, 0.4 * smooth(v) * (0.5 + 0.5 * Math.sin(u * 7)));
    if (vein < 0.22) c3 = mixRgb(c3, cV, 0.8 * (1 - vein / 0.22));
    if (u > 0.92) c3 = mixRgb(c3, cV, 0.5);
    return c3;
  } }).pbr(0.25, 0.1)];
  const lead = []; for (let i = 0; i <= 6; i++) lead.push(A(i / 6));
  out.push(H.tube(lead, [0.012, 0.009, 0.006, 0.004], 18, 5).color(0x2a2418).pbr(0.4));
  for (const vv of [0.35, 0.65]) { const pts = []; for (let i = 0; i <= 6; i++) { const u = i / 6, a = A(u), b = B(u); pts.push(lerp3(a, b, vv)); } out.push(H.tube(pts, 0.004, 14, 4).color(0x3a3020).pbr(0.4).lod(1)); }
  return out;
}

function carrionFly(def, o = {}) {
  const shell = col(o.body2, 0x3a4a2a), wingC = col(o.wing, 0xb8c0a0), rnd = rng(hashStr((def.id || 'fly') + ':fly'));
  const shellD = tone(shell, 0, 0, -0.1), stripe = mix(shell, 0x9a9a8a, 0.55), sheen = tone(shell, 0.08, 0.15, 0.05);
  const ch = (q, c = shell) => q.color(c).tint(0.18, 26).pbr(0.32, 0.25);
  const hairy = (q, c = shellD) => q.color(c).bump(0.006, 60, 'fur').tint(0.2, 30).pbr(0.8);
  const ridden = !!(o.rider && typeof o.rider === 'object');
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const BO = [0, 0.56, 0.04];
  const body = N('body', 'root', BO, { rig: 'body', detail: 0.85 });
  {
    const p = body.prims;
    p.push(ch(S.ellipsoid(0.21, 0.19, 0.25).at(0, 0.56, 0.06)));
    p.push(hairy(S.ellipsoid(0.17, 0.12, 0.2).at(0, 0.47, 0.05).blend(0.05)));
    for (const sx of [-1, 0, 1]) p.push(S.ellipsoid(0.03, 0.2, 0.24).at(sx * 0.08, 0.6, 0.06).color(sx ? stripe : shellD).paint(0.02));
    p.push(ch(S.capsule([0, 0.55, 0.26], [0, 0.55, 0.3], 0.08, 0.07).blend(0.03)));
    // bristles over the thorax
    for (let i = 0; i < 28; i++) {
      const a = (rnd() - 0.5) * 2.6, z = 0.06 + (rnd() - 0.5) * 0.36, q = [Math.sin(a) * 0.21, 0.56 + Math.cos(a) * 0.19, z];
      if (ridden && Math.abs(a) < 0.7 && z > -0.12 && z < 0.2) continue;
      body.hard.push(spike(q, [Math.sin(a), Math.cos(a), -0.6], 0.05 + rnd() * 0.04, 0.005, 0x161210, [0, 1, 0], 0.4).lod(1));
    }
    if (ridden) {
      // a rotten saddle strapped round the thorax, a rusted bell on a pole behind it
      p.push(S.ellipsoid(0.16, 0.05, 0.18).at(0, 0.75, 0.04).color(0x4a3a22).pbr(0.8).tint(0.2, 20).blend(0.01));
      p.push(S.torus(0.2, 0.016).rot(90, 0, 90).at(0, 0.56, 0.05).color(LEATHER).pbr(0.8).paint(0.004, 0.01));
      body.hard.push(H.lathe([[0.001, 0], [0.1, 0], [0.12, 0.04], [0.11, 0.1], [0.001, 0.1]], 10).scale(1.1, 1, 0.3).at(0, 0.76, -0.11).color(0x5a4a2a).pbr(0.7, 0.3));
      body.hard.push(H.tube([[0, 0.78, -0.13], [0, 0.98, -0.18], [0.03, 1.08, -0.15]], 0.01, 8, 5).color(0x5a3a22).pbr(0.8));
      body.hard.push(...bell([0.03, 1.07, -0.12], 0.03, 0x8a4a22));
    }
  }
  // head: huge red compound eyes, a sucking proboscis
  const head = N('mhead', 'body', [0, 0.55, 0.3], { rig: 'mhead', detail: 1.1 });
  {
    const p = head.prims;
    p.push(ch(S.ellipsoid(0.13, 0.12, 0.09).at(0, 0.55, 0.36)));
    for (const sx of [1, -1]) p.push(S.ellipsoid(0.1, 0.12, 0.1).rot(0, sx * 20, 0).at(sx * 0.085, 0.57, 0.38).color(0x8a1a10).bump(0.004, 70, 'scales').tint(0.12, 50).pbr(0.2, 0.1).blend(0.01));
    p.push(S.ellipsoid(0.05, 0.08, 0.04).at(0, 0.53, 0.45).color(stripe).pbr(0.5).blend(0.02));
    head.hard.push(H.tube([[0, 0.48, 0.42], [0, 0.4, 0.46], [0, 0.33, 0.47]], [0.03, 0.022, 0.02], 10, 7).color(shellD).pbr(0.5));
    head.hard.push(H.sphere(0.04, 10).scale(1.3, 0.5, 1).at(0, 0.32, 0.48).color(0x5a4a3a).pbr(0.4));
    head.hard.push(H.tube([[0, 0.31, 0.48], [0.01, 0.22, 0.49], [0, 0.14, 0.48]], [0.008, 0.005, 0.01], 6, 5).color(0xb8c888).pbr(0.1).lod(1));       // drool
    for (const sx of [1, -1]) head.hard.push(H.tube([[sx * 0.02, 0.6, 0.44], [sx * 0.04, 0.66, 0.48], [sx * 0.06, 0.68, 0.5]], [0.008, 0.006, 0.003], 6, 4).color(0x1a1610).pbr(0.5).lod(1));
  }
  // abdomen: bloated, banded, bristly, hanging behind
  const ab = N('abdomen', 'body', [0, 0.55, -0.16], { rig: 'abdomen', detail: 0.8 });
  {
    const p = ab.prims;
    p.push(ch(S.ellipsoid(0.24, 0.2, 0.34).rot(12, 0, 0).at(0, 0.5, -0.44), shell));
    p.push(ch(S.capsule([0, 0.54, -0.18], [0, 0.52, -0.3], 0.12, 0.18).blend(0.05)));
    for (let i = 0; i < 4; i++) p.push(S.ellipsoid(0.27, 0.23, 0.02).rot(12, 0, 0).at(0, 0.5 - i * 0.01, -0.28 - i * 0.12).color(shellD).paint(0.015, 0.006));
    for (let i = 0; i < 5; i++) for (const sx of [1, -1]) p.push(S.ellipsoid(0.07, 0.06, 0.05).at(sx * 0.1, 0.65 - i * 0.012, -0.3 - i * 0.1).color(i % 2 ? stripe : sheen).paint(0.03));
    p.push(S.ellipsoid(0.17, 0.1, 0.24).at(0, 0.35, -0.42).color(mix(shell, 0x8a8a4a, 0.5)).paint(0.04));        // pale distended belly
    for (let i = 0; i < 4; i++) { const q = [(rnd() - 0.5) * 0.3, 0.42 + rnd() * 0.2, -0.3 - rnd() * 0.3]; p.push(S.sphere(0.022).at(...q).color(0x9a6a3a).pbr(0.2).blend(0.006)); }
    for (let i = 0; i < 22; i++) {
      const a = (rnd() - 0.5) * 3.4, z = -0.24 - rnd() * 0.42, q = [Math.sin(a) * 0.22, 0.5 + Math.cos(a) * 0.19, z];
      ab.hard.push(spike(q, [Math.sin(a), Math.cos(a), -0.8], 0.04 + rnd() * 0.03, 0.004, 0x161210, [0, 1, 0], 0.3).lod(1));
    }
    ab.hard.push(H.cone(0.04, 0.08, 7).rot(-100, 0, 0).at(0, 0.44, -0.78).color(shellD).pbr(0.4));
  }
  // six legs: jointed, bristled, feet on the ground
  const LEGS = [[0.13, 0.17], [0.15, 0.04], [0.13, -0.08]];
  LEGS.forEach(([x0, z0], li) => {
    for (const sx of [1, -1]) {
      const X = sideX(sx), nm = `${li}${sx > 0 ? 'L' : 'R'}`;
      const J = X([x0, 0.42, z0]), K = X([x0 + 0.2, 0.52, z0 + (li - 1) * 0.12 + 0.02]), F = X([x0 + 0.3, 0.0, z0 + (li - 1) * 0.3 + 0.04]);
      const up = N(`leg${nm}`, 'body', J, { rig: 'legs', detail: 1 });
      const lo = N(`shin${nm}`, `leg${nm}`, K, { rig: 'shins', detail: 1 });
      up.hard.push(H.tube([J, lerp3(J, K, 0.5), K], [0.026, 0.024, 0.02], 8, 7).color(shellD).pbr(0.45, 0.15));
      up.hard.push(H.sphere(0.022, 8).at(...K).color(shellD).pbr(0.45));
      const M = add3(lerp3(K, F, 0.55), X([0.02, 0, 0]));
      lo.hard.push(H.tube([K, M, F], [0.019, 0.014, 0.008], 12, 6).color(0x1e1a14).pbr(0.5, 0.15));
      for (let i = 0; i < 4; i++) lo.hard.push(spike(lerp3(K, M, 0.2 + i * 0.25), X([0.3, 0.3, -1]), 0.03, 0.004, 0x0e0c0a, [0, 1, 0], 0.2).lod(0));
      lo.hard.push(spike(F, X([0.6, -0.1, 0.5]), 0.03, 0.006, 0x0e0c0a, [0, 1, 0], 0.4).lod(1), spike(F, X([-0.3, -0.1, 0.6]), 0.03, 0.006, 0x0e0c0a, [0, 1, 0], 0.4).lod(1));
    }
  });
  // wings, spread to the sides (the animator buzzes them in flight and lays them back on the ground)
  for (const sx of [1, -1]) {
    const W0 = [sx * 0.09, 0.7, 0.12];
    const w = N(`wing${sx > 0 ? 'L' : 'R'}`, 'body', W0, { rig: 'wings', detail: 1 });
    w.hard.push(...veinWing(0.72, 0.26, wingC, sx).map((q) => q.at(W0[0], W0[1], W0[2])));
    w.hard.push(H.sphere(0.025, 8).scale(1, 0.7, 1).at(...W0).color(shellD).pbr(0.4));
  }
  const nodes = finish(N.nodes);
  let extra = { attack: 'bite' };
  if (ridden) {
    const R = makeRider(def, o.rider, 0.85);
    extra = seatRider(nodes, R, 'body', BO, [0, 0.78, 0.04], { legL: [-55, 0, 40], legR: [-55, 0, -40], shinL: [70, 0, -10], shinR: [70, 0, 10] });
  }
  return { ...extra, kind: 'chaos.fly', mounted: ridden, nodes };
}

function flyAnim(rig, inner, c, base) {
  const { R, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk, dead = c.dead > 0;
  const fl = c.flying && !dead, k = c.moving ? 1 : 0;
  (rig.wings || []).forEach((w, i) => {
    const sg = sgn(w, i);
    if (fl) R(w, 0, sg * 0.15, sg * Math.sin(t * 38 + ph) * 0.55);
    else if (dead) R(w, 0, sg * 0.6, sg * 0.3);
    else R(w, 0.05, sg * 1.25, sg * -0.2 + sg * Math.sin(t * 1.3 + ph) * 0.02);      // laid back over the abdomen
  });
  (rig.legs || []).forEach((l, i) => {
    const sg = i % 2 ? -1 : 1;
    if (fl) { R(l, 0.15 * (Math.floor(i / 2) - 1), 0, sg * -0.35 + Math.sin(t * 2 + i) * 0.05); R(rig.shins[i], 0, 0, sg * 0.5); }
    else { const g = t * 9 + ph + (i % 2) * Math.PI + Math.floor(i / 2) * 2.1; R(l, k * Math.sin(g) * 0.25, 0, -sg * Math.max(0, Math.cos(g)) * 0.2 * k); R(rig.shins[i]); }
  });
  let hx = Math.sin(t * 1.7 + ph) * 0.05, pz = 0, bx = 0;
  if (a >= 0 && !rig.mounted) { hx = keys(a, [[0, 0], [0.4, -0.3], [0.6, 0.3], [1, 0]]); pz = keys(a, [[0, 0], [0.4, -0.06], [0.6, 0.15], [1, 0]]); }
  else if (a >= 0) { pz = keys(a, [[0, 0], [0.4, -0.04], [0.6, 0.1], [1, 0]]); bx = keys(a, [[0, 0], [0.4, -0.06], [0.6, 0.1], [1, 0]]); }
  R(rig.body, bx + (fl && k ? 0.12 : 0), 0, fl ? Math.sin(t * 1.4 + ph) * 0.05 : 0);
  R(one((rig.mhead)), hx, Math.sin(t * 0.9 + ph) * 0.15);
  R(one((rig.abdomen)), (fl ? 0.12 : 0) + Math.sin(t * 2.4 + ph) * 0.04, 0, 0);
  if (one(rig.abdomen)) one(rig.abdomen).scale.setScalar(1 + Math.sin(t * 2.4 + ph) * 0.03);
  poseRider(rig, c, base, dead, 0.1);
  if (dead) {                                          // drops and rolls onto its back
    const f = Math.min(1, c.dead * 1.6), e = f * f * (3 - 2 * f);
    inner.rotation.z = e * Math.PI; inner.position.y = (e * 0.9 - Math.max(0, c.dead - 0.8) * 0.5) * s;
    return;
  }
  inner.rotation.z = 0; inner.rotation.x = 0;
  inner.position.z = pz * s;
  inner.position.y = (fl ? Math.sin(t * 3 + ph) * 0.03 : 0) * s;
}

// =====================================================================================
const guard = (fn) => (def, o) => fn(def || {}, o && typeof o === 'object' ? o : {});
const ALL = { brassRhino, bloodReaper, slaughterBrute, plagueToad, carrionFly };
export const bodies = Object.fromEntries(Object.entries(ALL).map(([k, f]) => [k, guard(f)]));
export const animators = { 'chaos.rhino': rhinoAnim, 'chaos.fiend': fiendAnim, 'chaos.brute': bruteAnim, 'chaos.toad': toadAnim, 'chaos.fly': flyAnim };
