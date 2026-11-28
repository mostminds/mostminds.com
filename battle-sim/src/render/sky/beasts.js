// Great flying beasts that fight in an airship's place: sculpted bodies (swept, muscled torsos and necks), proper
// heads with opening jaws, teeth, eyes, horns and beaks, feathered wings with primaries and coverts or membrane
// wings on finger bones, legs on pivots that reach and clutch, tails that sway, and a saddle or howdah in the
// realm's style (caparison with its emblem, banners, trophies, the pilot's helm) where the riders sit.
// Model space: +x forward, +y up, +z starboard; origin at the flying centre; wingspan about def.len.
import { THREE, PI, TAU, SPH, HEMI, CYL, CONE, TORUS, ICO, OCTA, mesh, ell, blk, add, group, rod, spike, plate, slab, lathe, sweep, rope, horn, emblem, patch, fam, tier, tintSet, shade, mixc, bake, noCrew, clamp, lerp, hash, pulse } from './kit.js';
import { styleOf } from './style.js';
import { decoMats, finial, banner, trophies, motif, helm, roof } from './deco.js';
import { animateSky } from '../skyParts.js';
import { creatureSpec, creatureTemplate, seatedPilot } from './creatures.js';
import { buildRigBeast } from './rigbeast.js';
export { saddle, throat, beastActions, BREATH };

const BREATH = { fire: 0xff7a1a, acid: 0x9aff3a, frost: 0xa8e8ff, warp: 0xd060ff, plague: 0xa8c83a, light: 0xfff0a0, sound: 0xffb0e0 };

export function buildSkyBeast(def, sideColor) {
  const spec = creatureSpec(def, styleOf(def));
  if (spec) {
    let tpl = null;
    try { tpl = creatureTemplate(spec); } catch (err) { console.warn(`[sky] ${def.id}: sculpted ${def.sky.creature} failed, drawing the plain one`, err); }
    if (tpl) return buildRigBeast(def, sideColor, spec, tpl);
  }
  return buildPlainBeast(def, sideColor);
}

function buildPlainBeast(def, sideColor) {
  const D = def.sky, L = D.look || {}, T = tintSet(), S = styleOf(def);
  const body = L.body ?? 0x6a5a40, wingC = L.wing ?? 0x4a3a2a, bellyC = L.belly ?? 0xc8b890;
  const sideM = mat0(sideColor), sideDark = mat0(shade(sideColor, 0.6));
  const dm = decoMats(T, S, sideM, sideDark);
  const breath = D.arts?.breath;
  const C = {
    ...dm,
    body: T.t(body, { roughness: 0.75 }), belly: T.t(bellyC, { roughness: 0.8 }), dark: T.t(shade(body, 0.6)), back: T.t(shade(body, 0.82)),
    wing: T.t(wingC), wingDark: T.t(shade(wingC, 0.62)), wingLight: T.t(mixc(wingC, bellyC, 0.5)), membrane: T.t(mixc(wingC, 0x000000, 0.1), { roughness: 0.6 }),
    horn: T.t(0xe6dcc4, { roughness: 0.55 }), hornDark: T.t(0x4a3c2c, { roughness: 0.5 }), claw: T.t(0x2a2420, { roughness: 0.4 }), beak: T.t(0xe0a830, { roughness: 0.45 }),
    eye: T.lit(breath ? BREATH[breath] : 0xffc840, 1.3), pupil: T.t(0x0a0806, { roughness: 0.2 }), mouth: T.t(0x5a1a1e), tongue: T.t(0xc0505a), tooth: T.t(0xf0e7cc, { roughness: 0.4 }),
    skin: T.t(0xd2a07a), hair: T.t(0x2a1c14), bald: T.t(0xb86a5a), blood: T.t(0x5a0c0a), stone: T.t(0x8a8680),
  };
  const root = new THREE.Group(), B = group(root);
  const A = { wings: [], tails: [], heads: [], spin: [], glows: [], body: B, speed: 3.4, droop: 0, hide2: [], movers: [], act: {}, legs: [] };
  const X = { B, C, A, T, S, D, def, jaws: [], throat: null, glowOf: (c, k, o = {}) => { const { flick, ...mo } = o; const m = T.glow(c, k, mo); A.glows.push({ m, k: flick ?? 0.15, ph: A.glows.length * 1.7, op: mo.transparent ? mo.opacity : undefined }); return m; } };
  const fn = CREATURES[D.creature] || CREATURES.wyvern;
  const info = fn(X);
  const riders = Math.max(1, D.riders || 2);
  const { slots, len, sides } = saddle(X, info, riders);
  if (info.pilot !== false) pilot(X, info.pilot || [info.back[0] + len / 2 + 0.22, info.back[1] + 0.02, 0], info);
  wounds(X, info);
  for (const w of A.wings) A.movers.push(w.sh, w.el);
  for (const t of A.tails) A.movers.push(...t.segs);
  for (const l of A.legs) A.movers.push(l.p, ...(l.toes ? [l.toes] : []));
  A.movers.push(...A.heads.map((h) => h.p), ...A.spin.map((s) => s.o), ...A.hide2, ...X.jaws.map((j) => j.p), ...(X.throat ? [X.throat] : []), ...(X.moving || []), B);
  root.updateMatrixWorld(true);
  const wp = (o, v) => { const p = new THREE.Vector3(...v); o.localToWorld(p); root.worldToLocal(p); return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]; };
  const mouth = info.headPivot ? wp(info.headPivot, info.mouth || [0.6, -0.05, 0]) : [1.5, 0, 0];
  const talons = A.legs.length ? A.legs.map((l) => wp(l.toes || l.p, [0, 0, 0])) : [[0, -0.6, 0]];
  const tailTip = A.tails.length ? wp(A.tails[0].segs[A.tails[0].segs.length - 1], [0, 0, 0]) : [-1.5, 0, 0];
  const lodMeshes = bake(root, A.movers, T);
  root.traverse((o) => { if (o.isMesh) o.castShadow = !o.material.transparent; });
  const box = new THREE.Box3().setFromObject(root);
  const half = def.len / 2, mid = talons.reduce((a, t) => [a[0] + t[0] / talons.length, a[1] + t[1] / talons.length, a[2] + t[2] / talons.length], [0, 0, 0]);
  root.userData = {
    skyAnim: true, anim: A, beast: D.creature,
    muzzles: [[mouth[0], mouth[1], Math.max(0.25, Math.abs(mouth[2]))]],
    bombBay: [info.back[0] - 0.4, -0.7, 0], hangar: [info.back[0] - info.backLen * 0.6, info.back[1], 0],
    pods: [[0.6, -0.6, 0.5], [0.6, -0.6, -0.5], [-0.6, -0.6, 0.5], [-0.6, -0.6, -0.5]], ladders: [[info.back[0], info.back[1] - 0.2, -0.5], [info.back[0], info.back[1] - 0.2, 0.5]],
    top: Math.max(box.max.y, info.back[1] + 0.9) + 0.15, radius: half, props: [], crewSlots: slots,
    lod: { meshes: lodMeshes, far: null, level: 0, levels: 6, toJSON: () => undefined },
    anchors: {
      mouth, bow: mouth, stern: tailTip, talons: mid, talonList: talons, bombBay: [info.back[0] - 0.4, -0.7, 0],
      port: sides[1], starboard: sides[0], deckL: sides[1], deckR: sides[0], gondolaL: sides[1], gondolaR: sides[0], back: [info.back[0], info.back[1] + 0.2, 0], top: [0, box.max.y, 0],
    },
    actions: beastActions(X, root),
    setSide(hex) { sideM.color.set(hex); sideDark.color.set(hex).multiplyScalar(0.6); },
    breakParts: A.wings.map((w) => ({ mesh: w.sh, at: [0, 0, 0], kind: 'wing' })),
    setDamage(lv) {
      T.damage(lv);
      for (const o of A.hide2) o.visible = lv >= 2;
      A.droop = lv >= 3 ? 1 : 0;
    },
  };
  root.userData.setSide(sideColor);
  return root;
}
function mat0(c) { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }); m.userData.keep = true; return m; }

// ======================================================================================
// anatomy kit
// ======================================================================================
/** a feather: unit length along -x, width along z (slab = thick primaries, else a flat plate) */
const FEA = [[0, 0], [-0.08, 0.42], [-0.55, 0.5], [-0.9, 0.32], [-1, 0.05], [-0.95, -0.25], [-0.6, -0.45], [-0.08, -0.4]];
function feather(P, m, x, y, z, len, w, ang, o = {}) {
  const f = o.flat ? mesh(fam('fea:flat', () => new THREE.ShapeGeometry(new THREE.Shape(FEA.map(([a, b]) => new THREE.Vector2(a, b)))).rotateX(PI / 2)), m)
    : mesh(fam('fea:slab', (q) => new THREE.ExtrudeGeometry(new THREE.Shape(FEA.map(([a, b]) => new THREE.Vector2(a, b))), { depth: 0.04, bevelEnabled: false, curveSegments: 2 }).translate(0, 0, -0.02).rotateX(PI / 2)), m);
  f.position.set(x, y, z); f.rotation.set(o.rx ?? 0, ang, o.rz ?? 0, 'YXZ'); f.scale.set(len, o.flat ? 1 : 0.45, w);
  return add(P, f);
}
/** feathered wing: arm with secondaries and coverts (sh), hand with fanned primaries (el) */
function featherWing(X, sh, w, o) {
  const { C } = X, c0 = o.c0 ?? 1.5, s1 = o.s1 ?? 1.6, s2 = o.s2 ?? 2.1, n = o.fingers ?? 6, M = o.mat || C.wing, Mt = o.tipMat || C.wingDark, Mc = o.covert || C.wingLight;
  // leading-edge arm and the web behind it
  sweep(sh, o.boneMat || Mc, [[c0 * 0.3, 0, -0.05], [c0 * 0.34, 0.03, s1 * 0.45], [c0 * 0.24, 0, s1 + 0.04]], [0.11, 0.07], { n: 10, m: 7 });
  patch(sh, M, (u, v) => [lerp(c0 * 0.3, -c0 * 0.35, v) - u * 0.05, 0.02 * Math.sin(v * PI), u * s1], 4, 2);
  // secondaries: long feathers along the trailing edge
  const ns = o.secondaries ?? 10;
  for (let i = 0; i < ns; i++) {
    const u = (i + 0.5) / ns, z = u * s1, len = c0 * (0.86 - 0.12 * u) * (o.secK ?? 1);
    feather(sh, i % 2 ? M : Mt, -c0 * 0.05, -0.01 + i * 0.002, z, len, len * 0.24, -0.04 - u * 0.1, { rz: 0.05 });
  }
  // coverts in two rows
  tier(2, () => { for (let i = 0; i < 8; i++) { const u = (i + 0.5) / 8; feather(sh, Mc, c0 * 0.22, 0.04, u * s1, c0 * 0.42, c0 * 0.16, -0.12, { flat: true }); } });
  tier(1, () => { for (let i = 0; i < 9; i++) { const u = (i + 0.3) / 9; feather(sh, Mc, c0 * 0.32, 0.06, u * s1, c0 * 0.24, c0 * 0.1, -0.2, { flat: true }); } });
  // the hand
  const el = group(sh, 0, 0, s1); el.rotation.y = o.sweep ?? -0.25; w.el = el;
  sweep(el, o.boneMat || Mc, [[c0 * 0.24, 0, 0], [c0 * 0.12, 0.02, s2 * 0.35], [-c0 * 0.05, 0, s2 * 0.62]], [0.07, 0.035], { n: 8, m: 6 });
  patch(el, M, (u, v) => [lerp(c0 * 0.22 - u * c0 * 0.25, -c0 * 0.25, v), 0.02 * Math.sin(v * PI), u * s2 * 0.58], 4, 2);
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(1, n - 1), z = lerp(0.05, s2 * 0.6, k), ang = lerp(0.25, 1.45, k) + (o.spread ?? 0);
    const len = c0 * lerp(0.95, 1.15, k) * (o.primK ?? 1) * (o.blunt ? 0.85 : 1);
    feather(el, k > 0.45 ? Mt : M, -c0 * 0.02 - k * 0.05, -0.01 + k * 0.01, z, len, len * (o.blunt ? 0.22 : 0.17), ang, { rz: 0.06 * k });
  }
  tier(2, () => { for (let i = 0; i < 6; i++) { const u = (i + 0.5) / 6; feather(el, Mc, c0 * 0.15 - u * 0.2, 0.04, u * s2 * 0.5, c0 * 0.4, c0 * 0.14, 0.2 + u * 0.6, { flat: true }); } });
  tier(1, () => feather(el, Mc, c0 * 0.22, 0.05, 0.05, c0 * 0.3, 0.08, -0.6, { flat: true })); // the alula
  w.foldY = 0.95; w.foldEl = 1.4;
  if (o.paint) tier(3, () => { const e = emblem(sh, o.paint, X.S.emblem, s1 * 0.5, 0.02); e.rotation.x = -PI / 2; e.position.set(-c0 * 0.15, 0.06, s1 * 0.6); });
}
/** membrane wing on arm and finger bones (sh = arm, el = hand) */
function batWing(X, sh, w, o) {
  const { C } = X, c0 = o.c0 ?? 1.4, s1 = o.s1 ?? 1.4, s2 = o.s2 ?? 2.3, nf = o.fingers ?? 3, back = o.back ?? 0.85, bone = o.boneMat || C.dark, M = o.mat || C.membrane;
  const arm = (u) => [lerp(0.12, 0.05, u) + 0.18 * Math.sin(u * PI), 0.05 * Math.sin(u * PI), u * s1];
  sweep(sh, bone, [arm(0), arm(0.5), arm(1)], [0.12, 0.08], { n: 10, m: 7 });
  tier(2, () => ell(sh, bone, ...arm(0.5), 0.12, 0.1, 0.12));
  // the inner membrane, billowing, scalloped at the trailing edge
  patch(sh, M, (u, v) => { const a = arm(u), tr = [lerp(-c0 * back, -c0 * 0.18, u) + 0.22 * Math.sin(u * PI) * v ** 3, 0, lerp(0, s1, u)]; return [lerp(a[0], tr[0], v), lerp(a[1], tr[1], v) + 0.1 * Math.sin(v * PI) * Math.sin(u * PI), lerp(a[2], tr[2], v)]; }, 7, 5);
  const el = group(sh, 0.05, 0, s1); el.rotation.y = o.sweep ?? -0.15; w.el = el;
  ell(el, bone, 0, 0, 0, 0.1);
  horn(el, C.claw, [[0.05, 0.02, 0.02], [0.2, 0.06, 0.05], [0.3, 0.02, 0.02]], 0.04); // the thumb claw
  // fingers fanning from the wrist: the first runs along the leading edge to the tip
  const tips = [];
  for (let i = 0; i < nf; i++) { const k = i / Math.max(1, nf - 1); tips.push([-0.2 - k * c0 * 1.05 - (o.sweepT ?? 0.3) * (1 - k), 0, s2 * (1 - k * 0.45)]); }
  if (nf === 1) tips[0] = [-0.3, 0, s2];
  const fing = tips.map((tp, i) => { const mid = i === 0 ? [0.08, 0.03, s2 * 0.55] : [tp[0] * 0.5 + 0.05, 0.04, tp[2] * 0.5]; return (u) => (u < 0.5 ? lerpV([0, 0, 0], mid, u * 2) : lerpV(mid, tp, (u - 0.5) * 2)); });
  fing.forEach((f, i) => { sweep(el, bone, [f(0), f(0.5), f(1)], [i ? 0.06 : 0.075, 0.015], { n: 10, m: 5 }); tier(2, () => ell(el, bone, ...f(0.5), 0.065)); });
  const panel = (fa, fb, sc) => patch(el, M, (u, v) => { const a = fa(u), b = fb(u), p = lerpV(a, b, v); const pull = sc * Math.sin(v * PI) * u ** 3; return [p[0] * (1 - pull) , p[1] + 0.07 * Math.sin(v * PI) * Math.sin(u * PI), p[2] * (1 - pull)]; }, 7, 4);
  for (let i = 0; i < nf - 1; i++) panel(fing[i], fing[i + 1], 0.22);
  // the last panel closes back to the arm's trailing edge
  panel(fing[nf - 1], (u) => [lerp(0, -c0 * 0.2, u) - 0.05, 0, lerp(0, -0.02, u)], 0.12);
  if (o.pteroFinger) tier(3, () => sweep(el, M, [[0.06, 0.02, 0.1], [-0.4, 0.02, s2 * 0.5]], 0.02, { n: 3, m: 3 }));
  w.foldY = 0.7; w.foldEl = 1.6;
}
const lerpV = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** two wings mirrored at `at` = [x, y, z0] */
function wings(X, at, kind, o = {}) {
  const { B, C, A } = X, [x, y, z0] = at, amp = o.amp ?? 0.55, base = o.base ?? 0.12;
  for (const sd of [1, -1]) {
    const mir = group(B, x, y, sd * z0); mir.scale.z = sd;
    const sh = group(mir); sh.rotation.y = o.sweep0 ?? 0;
    const w = { sh, el: null, amp, base, phase: o.phase ?? 0, outerK: o.outerK ?? 0.75, speedK: o.speedK ?? 1 };
    if (kind === 'feather') featherWing(X, sh, w, o);
    else if (kind === 'bat') batWing(X, sh, w, o);
    else if (kind === 'insect') {
      const len = o.len ?? 2.6, wd = o.wd ?? 0.55;
      sh.rotation.y = o.sw ?? -0.35;
      patch(sh, o.mat, (u, v) => { const z = u * len, half = wd * Math.sqrt(Math.max(0, Math.sin(u * PI * 0.92 + 0.1))) * (1 + 0.15 * (1 - u)); return [lerp(half * 0.7, -half, v), 0.02 * Math.sin(v * PI), z]; }, 8, 3);
      for (const k of [0.2, 0.5, 0.8]) tier(2, () => sweep(sh, C.dark, [[0.05, 0.01, 0.05], [lerp(0.1, -wd * 0.4, k), 0.015, len * 0.5], [lerp(0.05, -wd * 0.7, k), 0.01, len * (0.92 - k * 0.2)]], 0.012, { n: 8, m: 3, minM: 3, round: 0 }));
      sweep(sh, C.dark, [[0.05, 0, 0], [wd * 0.6, 0.01, len * 0.5], [wd * 0.1, 0, len * 0.98]], [0.03, 0.01], { n: 10, m: 4, round: 0 });
      w.foldY = 0.9; w.foldEl = 0;
    } else if (kind === 'moth') {
      const fore = (u, v) => { const a = lerp(-0.6, 1.1, v), r = 3.2 * u; return [Math.sin(a) * r * 0.35 * (1 - u * 0.2) - 0.1 * u, 0.02 * Math.sin(u * PI), Math.cos(a) * r * 0.95]; };
      patch(sh, o.mat || C.wing, (u, v) => { const zz = u * 3.1, fr = 0.35 + 0.3 * Math.sin(u * PI * 0.75) - 0.35 * u ** 3, bk = -(0.3 + 1.0 * Math.sin(u * PI * 0.78)) - 0.2 * u; return [lerp(fr, bk, v), 0.04 * Math.sin(v * PI), zz * (1 - v * v * 0.18)]; }, 10, 5);
      patch(sh, o.mat2 || C.wingLight, (u, v) => { const a = lerp(-1.25, -2.9, v), r = 0.3 + 1.9 * Math.sin(u * PI * 0.5) * (0.85 + 0.15 * Math.sin(v * PI)); return [Math.cos(a) * r * 0.75 - 0.3, -0.02 + 0.03 * Math.sin(v * PI), Math.sin(-a) * r * 0.9]; }, 7, 6);
      void fore;
      for (const [ex, es, r, m] of [[-0.35, 2.2, 0.42, C.belly], [-0.35, 2.2, 0.24, C.wingDark], [-0.35, 2.2, 0.08, C.belly], [-1.35, 1.15, 0.34, C.belly], [-1.35, 1.15, 0.16, C.wingDark]]) add(sh, mesh(CYL(20), m, ex, m === C.belly && r < 0.1 ? 0.07 : m === C.wingDark ? 0.06 : 0.05, es, r, 0.01, r));
      tier(2, () => { for (let i = 0; i < 7; i++) { const u = 0.2 + i * 0.11; feather(sh, C.wingDark, 0.2, 0.06, u * 3.1, 0.6, 0.06, 0.1, { flat: true }); } });
      ell(sh, C.body, -0.2, 0.02, 0.4, 0.5, 0.06, 0.4); // fur at the root
      w.foldY = 1.1; w.foldEl = 0;
    }
    A.wings.push(w);
  }
}
/** a swaying chain of smooth tapered segments: returns the pivots (the last is the tip mount) */
function chain(X, P, start, n, len, r0, r1, m, o = {}) {
  const { A } = X;
  let p = group(P, ...start);
  const segs = [], ang = o.ang ?? PI;
  p.rotation.z = ang - PI;
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(1, n - 1), ra = lerp(r0, r1, k), rb = lerp(r0, r1, Math.min(1, (i + 1) / Math.max(1, n - 1)));
    sweep(p, m, [[0.02, 0, 0], [-len * 1.04, 0, 0]], [ra, rb], { n: 2, m: o.m ?? 10, ry: o.flat ?? 1, round: 0.6 });
    if (o.under) tier(2, () => ell(p, o.under, -len * 0.5, -ra * 0.55, 0, len * 0.5, ra * 0.5, ra * 0.8));
    if (o.each) o.each(p, i, ra, k);
    segs.push(p);
    const q = group(p, -len, 0, 0);
    q.rotation.z = (o.bend ?? 0) + (o.bends ? o.bends[i] || 0 : 0);
    q.userData.baseY = o.baseY ? o.baseY[i] || 0 : 0;
    p = q;
  }
  segs.push(p);
  A.tails.push({ segs, amp: o.amp ?? 0.12, speed: o.speed ?? 1.6, lag: o.lag ?? 0.7, ramp: o.ramp ?? 0, pitch: o.pitch ?? 0 });
  return segs;
}
function headPivot(X, P, x, y, z = 0) { const p = group(P, x, y, z); X.A.heads.push({ p, k: 1 }); return p; }
function eyes(h, C, x, y, z, r = 0.06, brow = null) {
  for (const sd of [1, -1]) {
    ell(h, C.eye, x, y, z * sd, r, r, r * 0.8);
    tier(1, () => ell(h, C.pupil, x + r * 0.35, y, z * sd + sd * r * 0.55, r * 0.2, r * 0.75, r * 0.2));
    if (brow) sweep(h, brow, [[x - r * 1.6, y + r * 0.8, z * sd], [x, y + r * 1.25, z * sd + sd * r * 0.4], [x + r * 1.3, y + r * 0.6, z * sd + sd * r * 0.2]], r * 0.45, { n: 5, m: 5 });
  }
}
/** a jaw on its own pivot (opens about z); returns the pivot */
function jawPivot(X, h, x, y, open = 0.6) { const p = group(h, x, y, 0); X.jaws.push({ p, open }); return p; }
/** the throat glow for breath, hidden until it breathes */
function throat(X, h, x, y, len = 0.5) {
  const br = X.D.arts?.breath; if (!br) return;
  const m = X.glowOf(BREATH[br], 1.4, { flick: 0.35 }); m.userData.boost = 0; X.throatMat = m;
  const p = group(h, x, y, 0); p.visible = false; X.throat = p;
  ell(p, m, 0, 0, 0, len * 0.55, 0.08, 0.1);
  spike(p, m, [len * 0.3, 0, 0], [len * 1.1, 0, 0], 0.09, 8);
}
function teeth(P, C, x0, x1, y, z, n, h, up = false) { tier(2, () => { for (let i = 0; i < n; i++) { const x = lerp(x0, x1, i / Math.max(1, n - 1)); for (const sd of [1, -1]) spike(P, C.tooth, [x, y, z * sd * lerp(1, 0.55, i / n)], [x + 0.01, y + (up ? h : -h) * (i % 3 === 0 ? 1.4 : 1), z * sd * lerp(1, 0.55, i / n)], h * 0.3, 4); } }); }
/** a leg on a hip pivot (mirrored by sd): pts relative to the hip down to the foot; foot 'talon' | 'paw' | 'hoof' | 'claw' */
function leg(X, hip, sd, pts, r, foot, o = {}) {
  const { B, C, A } = X;
  const mir = group(B, hip[0], hip[1], hip[2] * sd); mir.scale.z = sd;
  const p = group(mir);
  const m = o.mat || C.body;
  if (o.thigh) ell(p, o.thighMat || m, pts[1][0] * 0.4, pts[1][1] * 0.4, 0, o.thigh[0], o.thigh[1], o.thigh[2]);
  sweep(p, m, pts, r, { n: 10, m: 8 });
  if (o.scaleMat) tier(1, () => { for (let i = 1; i < 5; i++) { const t = 0.5 + i * 0.1, a = lerpV(pts[pts.length - 2], pts[pts.length - 1], (t - 0.5) * 2); add(p, mesh(TORUS(0.25, 10, 3), o.scaleMat, a[0], a[1], a[2], (Array.isArray(r) ? r[r.length - 1] : r) * 1.15)).rotation.x = PI / 2; } });
  const f = pts[pts.length - 1], toes = group(p, f[0], f[1], f[2]);
  const cm = o.clawMat || C.claw, tm = o.toeMat || m;
  if (foot === 'talon') {
    for (const [a, l] of [[-0.45, 0.22], [0, 0.26], [0.45, 0.22]]) { const d = [Math.cos(a), 0, Math.sin(a)]; sweep(toes, tm, [[0, 0, 0], [d[0] * l * 0.6, -0.04, d[2] * l * 0.6], [d[0] * l, -0.02, d[2] * l]], [0.045, 0.03], { n: 5, m: 5 }); horn(toes, cm, [[d[0] * l, -0.02, d[2] * l], [d[0] * (l + 0.08), -0.05, d[2] * (l + 0.08)], [d[0] * (l + 0.1), -0.13, d[2] * (l + 0.1)]], 0.03); }
    sweep(toes, tm, [[0, 0, 0], [-0.12, -0.03, 0]], [0.04, 0.03], { n: 2, m: 5 }); horn(toes, cm, [[-0.12, -0.03, 0], [-0.2, -0.06, 0], [-0.22, -0.14, 0]], 0.03);
  } else if (foot === 'paw') {
    ell(toes, m, 0.08, -0.02, 0, 0.17, 0.08, 0.13);
    for (let i = 0; i < 4; i++) { const z = (i - 1.5) * 0.06; ell(toes, m, 0.22, -0.03, z, 0.05, 0.045, 0.035); tier(1, () => horn(toes, cm, [[0.25, -0.02, z], [0.3, -0.04, z], [0.31, -0.09, z]], 0.018)); }
  } else if (foot === 'hoof') {
    lathe(toes, cm, [[0.06, 0.04], [0.08, -0.04], [0.09, -0.08], [0.001, -0.08]], 10, 'hoof').position.y = 0;
  } else if (foot === 'claw') {
    for (let i = 0; i < 3; i++) { const z = (i - 1) * 0.05; horn(toes, cm, [[0, 0, z], [0.08, -0.02, z * 1.3], [0.12, -0.1, z * 1.4]], 0.025); }
  }
  A.legs.push({ p, toes, rest: p.rotation.z, reach: o.reach ?? 0.9, curl: o.curl ?? 0.7 });
  return { p, toes };
}
/** a ridge of horny spikes along a path */
function ridge(P, m, pts, h = 0.22, r = 0.07) { tier(3, () => { for (const [x, y, z = 0, k = 1] of pts) horn(P, m, [[x + 0.04 * k, y - 0.04, z], [x - 0.04 * k, y + h * 0.6 * k, z], [x - 0.14 * k, y + h * k, z]], r * k, 0.004, { n: 5, m: 5 }); }); }
/** feather tufts laid over a surface: points [x, y, z, len, angY, tilt] */
function tufts(P, m, pts) { tier(1, () => { for (const [x, y, z, l, ay = 0, rx = 0] of pts) feather(P, m, x, y, z, l, l * 0.45, ay, { flat: true, rx }); }); }
/** fur locks: small curved cones */
function locks(P, m, pts, r = 0.06) { for (const [a, b] of pts) horn(P, m, [a, lerpV(a, b, 0.6).map((v, i) => (i === 1 ? v + 0.03 : v)), b], r, 0.005, { n: 4, m: 5 }); }
/** belly plates along a path */
function scutes(P, m, pts) { tier(2, () => { for (const [x, y, rx, rz] of pts) ell(P, m, x, y, 0, rx, rx * 0.35, rz); }); }

// ======================================================================================
// heads
// ======================================================================================
function drakeHead(X, h, o = {}) {
  const { C } = X, s = o.s ?? 1, Mb = o.mat || C.body;
  const g = group(h); g.scale.setScalar(s);
  sweep(g, Mb, [[-0.18, 0.02, 0], [0.08, 0.06, 0], [0.32, 0.03, 0]], [0.22, 0.24, 0.17], { n: 6, m: 12, ry: 0.85 });
  sweep(g, Mb, [[0.22, 0.0, 0], [0.48, -0.02, 0], [0.76, -0.06, 0]], [0.17, 0.13, 0.08], { n: 8, m: 10, ry: 0.72, prof: (t, a) => (Math.cos(a) < 0 ? 0.85 : 1) });
  eyes(g, C, 0.2, 0.1, 0.15, 0.055, Mb);
  tier(1, () => { for (const sd of [1, -1]) ell(g, C.pupil, 0.73, -0.02, 0.045 * sd, 0.02, 0.015, 0.02); });
  teeth(g, C, 0.28, 0.7, -0.08, 0.1, 6, 0.07);
  for (const sd of [1, -1]) {
    if (o.horns !== false) horn(g, o.hornMat || C.horn, [[-0.04, 0.14, 0.11 * sd], [-0.3, 0.3, 0.2 * sd], [-0.62, 0.36, 0.26 * sd], [-0.8, 0.28, 0.27 * sd]], 0.075);
    tier(2, () => { horn(g, o.hornMat || C.horn, [[-0.08, 0.02, 0.2 * sd], [-0.3, 0.0, 0.32 * sd], [-0.46, -0.04, 0.4 * sd]], 0.045); horn(g, o.hornMat || C.horn, [[0.5, 0.06, 0.06 * sd], [0.52, 0.15, 0.08 * sd]], 0.025); });
    if (o.frill) tier(2, () => { const f = slab(g, o.frill, [[0, 0], [-0.35, 0.1], [-0.5, 0.35], [-0.2, 0.22], [-0.15, 0.4], [0.05, 0.15]], 0.02, 0); f.rotation.set(-PI / 2 + sd * 1.1, 0, 0); f.position.set(-0.05, 0.0, 0.18 * sd); });
  }
  ridge(g, C.dark, [[-0.12, 0.25, 0, 0.6], [-0.35, 0.18, 0, 0.5]], 0.2, 0.05);
  const j = jawPivot(X, g, 0.12, -0.12, o.open ?? 0.55);
  sweep(j, o.jawMat || C.belly, [[-0.05, 0, 0], [0.3, -0.03, 0], [0.6, -0.01, 0]], [0.14, 0.1, 0.05], { n: 8, m: 9, ry: 0.55 });
  tier(1, () => ell(j, C.tongue, 0.25, 0.02, 0, 0.22, 0.03, 0.06));
  teeth(j, C, 0.15, 0.55, 0.03, 0.08, 5, 0.06, true);
  if (o.tusks) for (const sd of [1, -1]) horn(j, C.horn, [[0.45, 0.0, 0.07 * sd], [0.55, 0.12, 0.1 * sd], [0.5, 0.25, 0.13 * sd]], 0.04);
  throat(X, g, 0.2, -0.08, 0.6);
  return { mouth: [0.8 * s, -0.1 * s, 0] };
}
function birdHead(X, h, o = {}) {
  const { C } = X, s = o.s ?? 1, Mh = o.mat || C.body, Mb = o.beakMat || C.beak;
  const g = group(h); g.scale.setScalar(s);
  ell(g, Mh, 0, 0, 0, 0.3, 0.27, 0.25);
  ell(g, Mh, 0.12, -0.04, 0, 0.18, 0.18, 0.2);
  const bl = o.beak?.len ?? 0.5, hook = o.beak?.hook ?? true, br = o.beak?.r ?? 0.12;
  if (o.cere !== false) ell(g, o.cereMat || C.beak, 0.2, 0.02, 0, 0.08, 0.1, 0.12);
  sweep(g, Mb, hook ? [[0.18, 0.02, 0], [0.18 + bl * 0.45, 0.02, 0], [0.18 + bl * 0.85, -0.05, 0], [0.18 + bl * 0.95, -0.17, 0]] : [[0.18, 0.02, 0], [0.18 + bl * 0.6, -0.01, 0], [0.18 + bl, -0.05, 0]], (t) => br * (1 - t * 0.9) + 0.006, { n: 10, m: 9, ry: 1.05, round: 0.3 });
  tier(1, () => { for (const sd of [1, -1]) ell(g, C.pupil, 0.27, 0.03, 0.06 * sd, 0.02, 0.012, 0.012); });
  eyes(g, C, 0.12, 0.08, 0.19, 0.055, o.brow ? Mh : null);
  const j = jawPivot(X, g, 0.18, -0.05, 0.5);
  sweep(j, Mb, [[0, 0, 0], [bl * 0.5, -0.02, 0], [bl * 0.72, -0.03, 0]], (t) => br * 0.7 * (1 - t * 0.9) + 0.005, { n: 6, m: 7, ry: 0.55, round: 0.3 });
  tier(1, () => ell(j, C.tongue, bl * 0.25, 0.01, 0, bl * 0.2, 0.02, 0.04));
  if (o.crest) tufts(g, o.crestMat || C.wing, [[-0.1, 0.22, 0, 0.5, PI * 0.05, -0.4], [-0.12, 0.18, 0.08, 0.45, PI * 0.15, -0.3], [-0.12, 0.18, -0.08, 0.45, -PI * 0.05, -0.3], [-0.05, 0.25, 0, 0.35, 0, -0.6]]);
  if (o.hackles !== false) tufts(g, o.hackleMat || Mh, Array.from({ length: 8 }, (_, i) => { const a = (i / 7 - 0.5) * 2.6; return [-0.18, Math.cos(a) * 0.18, Math.sin(a) * 0.2, 0.32, Math.sin(a) * 0.4, -0.2]; }));
  throat(X, g, 0.15, -0.03, 0.5);
  return { mouth: [(0.18 + bl) * s, -0.06 * s, 0] };
}
function lionFace(X, h, o = {}) {
  const { C } = X, Mf = o.mat || C.belly;
  ell(h, Mf, 0.05, 0, 0, 0.26, 0.3, 0.24);
  ell(h, Mf, 0.25, -0.1, 0, 0.12, 0.1, 0.12);
  ell(h, C.dark, 0.36, -0.07, 0, 0.04, 0.03, 0.05);
  eyes(h, C, 0.24, 0.07, 0.1, 0.04, Mf);
  for (const sd of [1, -1]) ell(h, Mf, 0.0, 0.25, 0.15 * sd, 0.05, 0.07, 0.03);
  const j = jawPivot(X, h, 0.14, -0.18, 0.55);
  ell(j, Mf, 0.08, -0.02, 0, 0.13, 0.05, 0.1);
  tier(1, () => ell(j, C.mouth, 0.1, 0.02, 0, 0.1, 0.02, 0.07));
  teeth(j, C, 0.12, 0.18, 0.02, 0.05, 2, 0.05, true);
  teeth(h, C, 0.26, 0.32, -0.15, 0.05, 2, 0.06);
  throat(X, h, 0.25, -0.17, 0.4);
  return { mouth: [0.36, -0.2, 0] };
}

// ======================================================================================
// creatures
// ======================================================================================
const bird = (o) => (X) => {
  const { B, C, A } = X, k = o.k ?? 1;
  const hm = C[o.headKey] || C.body;
  // torso: a swept body, a deep breast, feathers laid over the back
  sweep(B, C.body, [[-1.05 * k, 0.06, 0], [-0.5 * k, 0.04, 0], [0.25 * k, 0.0, 0], [0.85 * k, 0.15 * k, 0]], [0.22 * k, 0.48 * k, 0.56 * k, 0.4 * k], { n: 10, m: 14, ry: 0.92, prof: (t, a) => (Math.cos(a) < 0 ? 1.08 : 1) });
  ell(B, C.belly, 0.45 * k, -0.14 * k, 0, 0.7 * k, 0.4 * k, 0.48 * k);
  tufts(B, C.back, Array.from({ length: 14 }, (_, i) => { const u = i / 13; return [lerp(0.6, -0.9, u) * k, (0.4 - 0.12 * u) * k + 0.04 * (i % 2), (i % 2 ? 0.16 : -0.16) * k, 0.38 * k, (i % 2 ? 1 : -1) * 0.25, 0.25]; }));
  tufts(B, C.belly, Array.from({ length: 10 }, (_, i) => { const u = i / 9; return [lerp(0.9, 0.0, u) * k, -0.3 * k - 0.05 * Math.sin(u * PI) * k, (i % 2 ? 0.2 : -0.2) * k, 0.32 * k, PI, -0.3]; }));
  // neck and head
  const neck = o.neck || [[0.7, 0.18], [1.1, 0.32], [1.42, 0.48]];
  sweep(B, C[o.neckKey] || hm, neck.map(([x, y]) => [x * k, y * k, 0]), (o.neckR || [0.38, 0.3, 0.24]).map((r) => r * k), { n: 10, m: 12 });
  if (o.ruff) for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; feather(B, C[o.ruffKey] || C.belly, 0.95 * k, 0.26 * k + Math.sin(a) * 0.28, Math.cos(a) * 0.3, 0.35, 0.16, PI + Math.cos(a) * 0.5, { rx: Math.sin(a) * 0.6 }); }
  const [hx, hy] = o.head || [1.6, 0.55];
  const h = headPivot(X, B, hx * k, hy * k);
  let hd;
  if (o.humanHead) {
    ell(h, C.skin, 0.08, 0, 0, 0.24, 0.3, 0.23);
    sweep(h, C.hair, [[-0.05, 0.18, 0], [-0.3, 0.05, 0], [-0.75, -0.25, 0]], [0.28, 0.2, 0.05], { n: 8 });
    ell(h, C.hair, -0.04, 0.08, 0, 0.27, 0.3, 0.27);
    ell(h, C.skin, 0.26, -0.06, 0, 0.06, 0.08, 0.06);
    eyes(h, C, 0.26, 0.06, 0.09, 0.035);
    const j = jawPivot(X, h, 0.2, -0.16, 0.5); ell(j, C.skin, 0.04, -0.02, 0, 0.1, 0.05, 0.12); ell(j, C.blood, 0.08, 0.02, 0, 0.05, 0.03, 0.07);
    throat(X, h, 0.2, -0.15, 0.3);
    hd = { mouth: [0.3, -0.17, 0] };
  } else hd = birdHead(X, h, { s: k, mat: hm, beakMat: o.beakMat, beak: o.beak, brow: o.brow, crest: o.crest, crestMat: o.crestMat, cereMat: o.cereMat, cere: o.cere, hackleMat: hm, hackles: o.hackles });
  // tail fan: real tail feathers fanning from a pivot
  const tl = o.tail ?? 1.2, tw = o.tailW ?? 0.75;
  const tp = group(B, -1.0 * k, 0.08, 0); A.tails.push({ segs: [tp], amp: 0.06, speed: 1.1, lag: 0, pitch: 0.06 });
  const nt = 9;
  for (let i = 0; i < nt; i++) { const a = (i / (nt - 1) - 0.5) * (o.wedge ? 0.6 : 1.0) * (tw / 0.75); const len = tl * k * (o.wedge ? 1 - Math.abs(i / (nt - 1) - 0.5) * 0.6 : 1 - Math.abs(i / (nt - 1) - 0.5) * 0.15); feather(tp, i % 2 ? (o.tailMat || C.wing) : C.wingDark, 0.15, 0.01 * (i % 3), 0, len, len * 0.22, -a); }
  tier(2, () => { for (let i = 0; i < 6; i++) { const a = (i / 5 - 0.5) * 0.8; feather(tp, C.wingLight, 0.25, 0.04, 0, tl * 0.5 * k, 0.12, -a, { flat: true }); } });
  // talons on hip pivots, tucked under
  const lm = o.legMat || C.beak;
  for (const sd of [1, -1]) leg(X, [-0.15 * k, -0.28 * k, 0.26 * k], sd, [[0, 0, 0], [-0.25 * k, -0.3 * k, 0.02], [-0.55 * k, -0.42 * k, 0.0]], [0.12 * k, 0.08 * k, 0.06 * k], 'talon', { mat: lm, toeMat: lm, thigh: [0.24 * k, 0.26 * k, 0.18 * k], thighMat: o.thighMat || C.belly, scaleMat: lm, reach: 1.0 });
  wings(X, [0.3 * k, 0.22 * k, 0.42 * k], 'feather', { c0: 1.55 * k, s1: 1.55 * (o.span ?? 1), s2: 2.05 * (o.span ?? 1), fingers: o.fingers ?? 6, ...o.wing });
  A.speed = o.speed ?? 3.0;
  return { back: [-0.15 * k, 0.5 * k, 0], backLen: 1.1 * k, backW: 0.5 * k, bodyR: 0.5 * k, headPivot: h, mouth: hd.mouth, reins: [hx * k, hy * k], ...o.info };
};

const CREATURES = {
  eagle: bird({ headKey: 'belly', neckKey: 'belly', brow: true, k: 1.05 }),
  roc: bird({ k: 1.12, crest: true, brow: true, span: 1.0, fingers: 7, beak: { len: 0.62, r: 0.15, hook: true }, speed: 2.4 }),
  crow: bird({ k: 1.0, wedge: true, beak: { len: 0.6, r: 0.15, hook: false }, cere: false, fingers: 6, speed: 2.8 }),
  vulture: bird({ k: 1.0, neck: [[0.75, 0.2], [1.1, 0.32], [1.42, 0.4], [1.68, 0.36]], neckR: [0.36, 0.22, 0.15, 0.13], neckKey: 'bald', headKey: 'bald', head: [1.92, 0.36], ruff: true, fingers: 8, span: 1.05,
    beak: { len: 0.36, r: 0.1, hook: true }, beakMat: null, hackles: false, wing: { blunt: true }, speed: 2.4, tail: 0.9 }),
  harpy: bird({ humanHead: true, k: 1.0, head: [1.55, 0.62] }),
  swan: bird({ k: 1.0, neck: [[0.75, 0.2], [1.05, 0.5], [1.2, 0.95], [1.45, 1.3], [1.85, 1.42]], neckR: [0.34, 0.2, 0.16, 0.14, 0.13], head: [2.05, 1.4], hackles: false,
    beak: { len: 0.42, r: 0.1, hook: false }, cereMat: null, tail: 0.7, fingers: 8, span: 1.05, wing: { blunt: true }, speed: 2.6 }),

  griffon(X) {
    const { B, C, A } = X;
    // lion hindquarters, eagle chest
    sweep(B, C.body, [[-1.35, 0.1, 0], [-0.8, 0.05, 0], [0.0, 0.0, 0], [0.7, 0.12, 0]], [0.3, 0.5, 0.48, 0.45], { n: 10, m: 14, ry: 0.95 });
    ell(B, C.body, -0.85, 0.08, 0, 0.55, 0.45, 0.48); // haunch
    ell(B, C.belly, 0.65, 0.02, 0, 0.6, 0.5, 0.5);
    tufts(B, C.belly, Array.from({ length: 12 }, (_, i) => { const u = i / 11; return [lerp(1.05, 0.25, u), -0.25 + 0.4 * Math.sin(u * 2), (i % 2 ? 0.22 : -0.22), 0.3, PI, -0.4]; }));
    sweep(B, C.wingLight, [[0.7, 0.25, 0], [1.0, 0.42, 0], [1.25, 0.58, 0]], [0.4, 0.32, 0.25], { n: 8, m: 12 });
    tufts(B, C.wing, Array.from({ length: 10 }, (_, i) => { const a = (i / 9 - 0.5) * 2.4; return [0.98, 0.45 + Math.cos(a) * 0.28, Math.sin(a) * 0.3, 0.38, PI + Math.sin(a) * 0.4, -0.3]; }));
    const h = headPivot(X, B, 1.4, 0.65);
    const hd = birdHead(X, h, { mat: C.belly, brow: true, beak: { len: 0.52, r: 0.13, hook: true }, crest: true, crestMat: C.wing });
    // taloned forelegs, lion hind legs with paws
    for (const sd of [1, -1]) leg(X, [0.7, -0.2, 0.3], sd, [[0, 0, 0], [0.25, -0.3, 0.02], [0.5, -0.4, 0]], [0.13, 0.09, 0.06], 'talon', { mat: C.beak, toeMat: C.beak, thigh: [0.2, 0.22, 0.16], thighMat: C.belly, scaleMat: C.beak, reach: 0.7 });
    for (const sd of [1, -1]) leg(X, [-0.95, -0.12, 0.33], sd, [[0, 0, 0], [-0.25, -0.35, 0.03], [-0.6, -0.35, 0], [-0.85, -0.45, 0]], [0.24, 0.15, 0.1, 0.09], 'paw', { thigh: [0.36, 0.34, 0.2], reach: 0.5 });
    const segs = chain(X, B, [-1.35, 0.12, 0], 6, 0.32, 0.08, 0.05, C.body, { bend: -0.12, amp: 0.25 });
    locks(segs[segs.length - 1], C.dark, [[[0, 0, 0], [-0.35, 0.05, 0.05]], [[0, 0, 0], [-0.3, -0.05, -0.08]], [[0, 0, 0], [-0.32, 0.08, -0.05]]], 0.08);
    wings(X, [0.35, 0.32, 0.42], 'feather', { c0: 1.5, s1: 1.55, s2: 2.05, fingers: 6, paint: X.C.side });
    A.speed = 3.0;
    return { back: [-0.3, 0.48, 0], backLen: 1.1, headPivot: h, mouth: hd.mouth, backW: 0.55, bodyR: 0.5, reins: [1.4, 0.65], caparison: true, chanfron: true };
  },

  pegasus(X) {
    const { B, C, A } = X;
    sweep(B, C.body, [[-1.2, 0.08, 0], [-0.6, 0.02, 0], [0.4, 0.0, 0], [0.9, 0.12, 0]], [0.35, 0.47, 0.46, 0.38], { n: 10, m: 14 });
    sweep(B, C.body, [[0.8, 0.15, 0], [1.15, 0.5, 0], [1.42, 0.88, 0]], [0.36, 0.26, 0.2], { n: 8, m: 12, ry: 1.2 });
    const h = headPivot(X, B, 1.5, 0.95);
    const hd = group(h); hd.rotation.z = -0.75;
    sweep(hd, C.body, [[-0.05, 0, 0], [0.3, 0, 0], [0.65, -0.03, 0]], [0.18, 0.15, 0.12], { n: 8, m: 10, ry: 1.25 });
    eyes(hd, C, 0.12, 0.08, 0.14, 0.045);
    for (const sd of [1, -1]) horn(hd, C.body, [[-0.05, 0.15, 0.07 * sd], [-0.04, 0.32, 0.09 * sd]], 0.05);
    const j = jawPivot(X, hd, 0.25, -0.12, 0.35); sweep(j, C.body, [[0, 0, 0], [0.35, 0.02, 0]], [0.1, 0.07], { n: 4, m: 8 });
    locks(B, C.wingLight, Array.from({ length: 9 }, (_, i) => { const u = i / 8, x = lerp(0.85, 1.45, u), y = lerp(0.45, 1.12, u); return [[x, y, 0], [x - 0.42, y + 0.02, (i % 2 ? 0.08 : -0.08)]]; }), 0.09);
    chain(X, B, [-1.2, 0.15, 0], 5, 0.34, 0.14, 0.06, C.wingLight, { ang: PI + 0.35, bend: -0.12, amp: 0.3, speed: 2 });
    for (const sd of [1, -1]) {
      leg(X, [0.7, -0.22, 0.24], sd, [[0, 0, 0], [0.32, -0.3, 0], [0.12, -0.6, 0]], [0.13, 0.08, 0.06], 'hoof', { reach: 0.6 });
      leg(X, [-0.85, -0.12, 0.25], sd, [[0, 0, 0], [-0.4, -0.45, 0], [-0.85, -0.55, 0]], [0.2, 0.09, 0.06], 'hoof', { thigh: [0.32, 0.3, 0.2], reach: 0.4 });
    }
    wings(X, [0.35, 0.3, 0.38], 'feather', { c0: 1.45, s1: 1.6, s2: 2.1, fingers: 6, covert: C.belly, tipMat: C.wing });
    A.speed = 3.0;
    return { back: [-0.25, 0.46, 0], backLen: 1.1, headPivot: hd, mouth: [0.7, -0.1, 0], reins: [1.5, 0.9], bodyR: 0.46, caparison: true };
  },

  sphinx(X) {
    const { B, C, A, S } = X;
    // a lion's body under a pharaoh's head, on wings of gilded stone
    sweep(B, C.body, [[-1.35, 0.1, 0], [-0.7, 0.03, 0], [0.3, 0.02, 0], [0.9, 0.18, 0]], [0.32, 0.52, 0.52, 0.45], { n: 10, m: 14 });
    ell(B, C.body, 0.7, 0.1, 0, 0.55, 0.55, 0.52); ell(B, C.body, -0.85, 0.1, 0, 0.55, 0.45, 0.5);
    // gold bands and a broad collar
    for (const x of [-0.4, 0.1]) add(B, mesh(TORUS(0.05, 28, 5), C.metal, x, 0.04, 0, 0.53)).rotation.y = PI / 2;
    add(B, mesh(TORUS(0.18, 28, 6), C.metal, 1.0, 0.35, 0, 0.42, 0.42, 0.3)).rotation.y = PI / 2 + 0.3;
    const h = headPivot(X, B, 1.3, 0.75);
    ell(h, C.metal, 0.05, 0, 0, 0.26, 0.32, 0.25); // a golden death-mask of a face
    ell(h, C.metal, 0.27, -0.06, 0, 0.06, 0.08, 0.06);
    eyes(h, C, 0.24, 0.07, 0.1, 0.04, C.metalDark);
    for (const sd of [1, -1]) sweep(h, C.accent, [[0.3, 0.07, 0.1 * sd], [0.33, 0.06, 0.16 * sd], [0.3, 0.02, 0.22 * sd]], 0.012, { n: 4, m: 4 });
    { const nm = group(h, -0.02, 0.0, 0); nm.scale.setScalar(2.6); helm(nm, { ...C, metal: C.metal, accent: C.wing }, 'nemes', S); }
    sweep(h, C.metal, [[0.24, -0.24, 0], [0.26, -0.45, 0], [0.32, -0.62, 0]], [0.06, 0.04], { n: 5, m: 6 });
    const j = jawPivot(X, h, 0.18, -0.2, 0.4); ell(j, C.body, 0.04, -0.02, 0, 0.1, 0.05, 0.1);
    for (const sd of [1, -1]) {
      leg(X, [0.8, -0.28, 0.33], sd, [[0, 0, 0], [0.35, -0.25, 0.02], [0.7, -0.3, 0]], [0.18, 0.13, 0.1], 'paw', { reach: 0.6, clawMat: C.metal });
      leg(X, [-0.95, -0.18, 0.36], sd, [[0, 0, 0], [-0.3, -0.38, 0.02], [-0.7, -0.38, 0], [-0.9, -0.48, 0]], [0.26, 0.16, 0.11, 0.09], 'paw', { thigh: [0.36, 0.35, 0.2], clawMat: C.metal, reach: 0.4 });
    }
    const segs = chain(X, B, [-1.35, 0.15, 0], 6, 0.34, 0.08, 0.05, C.body, { bend: 0.15, ang: PI - 0.2, amp: 0.2 });
    ell(segs[segs.length - 1], C.metal, -0.12, 0, 0, 0.16, 0.1, 0.1);
    wings(X, [0.35, 0.34, 0.45], 'feather', { c0: 1.5, s1: 1.55, s2: 2.0, fingers: 6, blunt: true, mat: C.wing, covert: C.belly, tipMat: C.wingDark, boneMat: C.metal, amp: 0.38 });
    A.speed = 2.2;
    return { back: [-0.3, 0.5, 0], backLen: 1.1, headPivot: h, mouth: [0.32, -0.15, 0], backW: 0.58, bodyR: 0.52, howdah: true };
  },

  manticore(X) {
    const { B, C, A } = X;
    sweep(B, C.body, [[-1.3, 0.1, 0], [-0.7, 0.03, 0], [0.3, 0.0, 0], [0.85, 0.12, 0]], [0.3, 0.5, 0.5, 0.42], { n: 10, m: 14 });
    ell(B, C.body, -0.85, 0.08, 0, 0.55, 0.45, 0.48);
    // a great mane about a man-like face
    ell(B, C.wing, 0.95, 0.32, 0, 0.5, 0.55, 0.55);
    locks(B, C.wing, Array.from({ length: 22 }, (_, i) => { const a = (i / 22) * TAU; return [[0.95, 0.32 + Math.sin(a) * 0.4, Math.cos(a) * 0.42], [0.72, 0.32 + Math.sin(a) * 0.75, Math.cos(a) * 0.78]]; }), 0.13);
    const h = headPivot(X, B, 1.35, 0.42);
    const hd = lionFace(X, h, { mat: C.belly });
    for (const sd of [1, -1]) horn(h, C.horn, [[0, 0.22, 0.13 * sd], [-0.15, 0.42, 0.25 * sd], [-0.4, 0.55, 0.3 * sd]], 0.06);
    for (const sd of [1, -1]) {
      leg(X, [0.75, -0.25, 0.33], sd, [[0, 0, 0], [0.32, -0.25, 0.02], [0.68, -0.3, 0]], [0.17, 0.12, 0.09], 'paw', { reach: 0.6 });
      leg(X, [-0.9, -0.15, 0.34], sd, [[0, 0, 0], [-0.3, -0.38, 0.02], [-0.7, -0.38, 0], [-0.9, -0.48, 0]], [0.25, 0.16, 0.11, 0.09], 'paw', { thigh: [0.34, 0.34, 0.2], reach: 0.4 });
    }
    // scorpion tail: arches up and over, the sting poised above the back
    const segs = chain(X, B, [-1.25, 0.25, 0], 8, 0.4, 0.17, 0.1, C.dark, { ang: PI - 1.1, bend: -0.16, amp: 0.08, speed: 1.2, pitch: 0.06, m: 8,
      each: (p, i, r) => { tier(2, () => add(p, mesh(TORUS(0.2, 12, 4), C.hornDark, -0.02, 0, 0, r * 1.05)).rotation.y = PI / 2); if (i % 2 === 0) horn(p, C.horn, [[-0.15, r * 0.8, 0], [-0.2, r + 0.12, 0]], 0.04); } });
    const tip = segs[segs.length - 1];
    ell(tip, C.dark, -0.12, 0, 0, 0.24, 0.18, 0.18); horn(tip, C.horn, [[-0.25, 0, 0], [-0.5, -0.1, 0], [-0.6, -0.3, 0]], 0.08);
    wings(X, [0.3, 0.38, 0.42], 'bat', { c0: 1.4, s1: 1.4, s2: 2.3, fingers: 4, amp: 0.55 });
    A.speed = 2.8;
    return { back: [-0.25, 0.48, 0], backLen: 1.0, headPivot: h, mouth: hd.mouth, bodyR: 0.5 };
  },

  bat(X) {
    const { B, C, A } = X;
    sweep(B, C.body, [[-0.8, 0.0, 0], [-0.2, 0.0, 0], [0.4, 0.05, 0], [0.75, 0.15, 0]], [0.3, 0.55, 0.55, 0.42], { n: 10, m: 14 });
    ell(B, C.belly, 0.2, -0.15, 0, 0.75, 0.4, 0.48);
    locks(B, C.dark, Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * TAU; return [[0.6, 0.18 + Math.sin(a) * 0.38, Math.cos(a) * 0.45], [0.42, 0.18 + Math.sin(a) * 0.6, Math.cos(a) * 0.68]]; }), 0.1);
    // the bones show through: ribs over the flanks
    tier(2, () => { for (let i = 0; i < 5; i++) { const x = -0.45 + i * 0.18; const r = add(B, mesh(TORUS(0.06, 18, 4, PI * 0.8), C.horn, x, 0.02, 0, 0.5, 0.5, 0.52)); r.rotation.set(0, PI / 2, PI * 0.1); const r2 = add(B, mesh(TORUS(0.06, 18, 4, PI * 0.8), C.horn, x, 0.02, 0, 0.5, 0.5, 0.52)); r2.rotation.set(0, -PI / 2, PI * 0.1); } });
    const h = headPivot(X, B, 1.0, 0.25);
    ell(h, C.body, 0, 0, 0, 0.36, 0.33, 0.36);
    sweep(h, C.dark, [[0.15, -0.04, 0], [0.38, -0.08, 0], [0.5, -0.06, 0]], [0.18, 0.13, 0.08], { n: 6, m: 10 });
    tier(2, () => { const nl = slab(h, C.belly, [[0, -0.07], [0.12, 0], [0, 0.07], [-0.05, 0]], 0.02, 0); nl.rotation.z = PI / 2; nl.position.set(0.52, 0.0, 0); });
    for (const sd of [1, -1]) { const ear = group(h, -0.05, 0.25, 0.2 * sd); ear.rotation.set(sd * -0.35, 0, -0.15); slab(ear, C.wing, [[0.15, 0], [-0.15, 0], [-0.05, 0.75], [0.12, 0.45]], 0.03, 0.005).rotation.x = -PI / 2; tier(1, () => sweep(ear, C.dark, [[0.1, 0, 0], [0.0, 0.4, 0], [-0.04, 0.7, 0]], 0.025, { n: 5, m: 4 })); }
    eyes(h, C, 0.28, 0.08, 0.18, 0.06, C.body);
    teeth(h, C, 0.38, 0.46, -0.13, 0.07, 2, 0.12);
    const j = jawPivot(X, h, 0.2, -0.17, 0.7);
    sweep(j, C.dark, [[0, 0, 0], [0.3, -0.02, 0]], [0.12, 0.07], { n: 4, m: 8, ry: 0.5 });
    teeth(j, C, 0.15, 0.28, 0.02, 0.06, 3, 0.06, true);
    throat(X, h, 0.25, -0.12, 0.4);
    for (const sd of [1, -1]) leg(X, [-0.55, -0.2, 0.25], sd, [[0, 0, 0], [-0.35, -0.12, 0.05], [-0.72, -0.18, 0.05]], [0.08, 0.05, 0.04], 'claw', { mat: C.dark, reach: 1.1 });
    patch(B, C.membrane, (u, v) => [lerp(-0.6, -1.4, v), -0.25 + 0.1 * Math.sin(u * PI) * v, lerp(-0.3, 0.3, u) * (1 + v * 0.4)], 5, 3);
    wings(X, [0.35, 0.22, 0.45], 'bat', { c0: 1.6, s1: 1.4, s2: 2.4, fingers: 4, amp: 0.7, back: 0.95, sweep: -0.05 });
    A.speed = 4.4;
    return { back: [-0.2, 0.52, 0], backLen: 0.9, headPivot: h, mouth: [0.5, -0.2, 0], bodyR: 0.52 };
  },

  wyvern: (X) => drake(X, { legs: 2, tusks: true }),
  dragon: (X) => drake(X, { legs: 4, k: 1.08 }),
  pterosaur(X) {
    const { B, C, A } = X;
    sweep(B, C.body, [[-0.8, 0.02, 0], [-0.1, 0.0, 0], [0.55, 0.1, 0]], [0.25, 0.42, 0.32], { n: 8, m: 12 });
    sweep(B, C.body, [[0.5, 0.1, 0], [0.9, 0.35, 0], [1.3, 0.55, 0]], [0.24, 0.17, 0.14], { n: 8, m: 10 });
    const h = headPivot(X, B, 1.4, 0.6);
    ell(h, C.body, 0, 0, 0, 0.28, 0.2, 0.18);
    sweep(h, C.belly, [[0.12, -0.02, 0], [0.7, -0.08, 0], [1.4, -0.2, 0]], [0.12, 0.07, 0.01], { n: 8, m: 8, ry: 1.2 });
    slab(h, C.wing, [[0.1, 0], [-0.25, 0.75], [-1.1, 0.95], [-0.35, 0.15]], 0.03, 0.01).rotation.x = -PI / 2;
    eyes(h, C, 0.08, 0.08, 0.14, 0.045);
    const j = jawPivot(X, h, 0.15, -0.1, 0.45); sweep(j, C.belly, [[0, 0, 0], [0.6, -0.05, 0], [1.1, -0.08, 0]], [0.08, 0.04, 0.01], { n: 6, m: 6, ry: 0.6 });
    throat(X, h, 0.3, -0.08, 0.6);
    for (const sd of [1, -1]) leg(X, [-0.5, -0.18, 0.22], sd, [[0, 0, 0], [-0.45, -0.1, 0.06], [-0.85, -0.12, 0.1]], [0.08, 0.05, 0.04], 'claw', { mat: C.dark });
    chain(X, B, [-0.8, 0.02, 0], 3, 0.28, 0.1, 0.04, C.body, { amp: 0.15 });
    wings(X, [0.35, 0.2, 0.38], 'bat', { c0: 1.5, s1: 1.35, s2: 2.5, fingers: 1, amp: 0.5, back: 1.3, sweep: -0.1, pteroFinger: true });
    A.speed = 2.6;
    return { back: [-0.15, 0.42, 0], backLen: 0.8, headPivot: h, mouth: [1.3, -0.18, 0], bodyR: 0.4 };
  },

  serpent(X) {
    const { B, C, A } = X;
    // a long plumed serpent; the riders sit on its forward coils, which barely sway
    const h = headPivot(X, B, 2.3, 0.25);
    const hd = drakeHead(X, h, { s: 1.0, horns: false, frill: C.wing });
    // the feathered ruff fanned about the head
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; feather(h, i % 2 ? C.wing : C.wingLight, -0.15, Math.sin(a) * 0.15, Math.cos(a) * 0.15, 0.85, 0.2, PI + Math.cos(a) * 1.1, { rx: Math.sin(a) * 1.0 }); }
    const n = 13, baseY = [];
    for (let i = 0; i < n; i++) baseY.push(i < 4 ? 0 : Math.sin(i * 0.8) * 0.28);
    const segs = chain(X, B, [2.05, 0.2, 0], n, 0.6, 0.42, 0.1, C.body, {
      amp: 0.22, speed: 1.8, lag: 0.75, ramp: 4, baseY, under: C.belly, m: 12,
      each: (p, i, r) => { if (i % 2 === 0) feather(p, C.wing, -0.1, r * 0.75, 0, 0.6 * (1 - i / n * 0.5), 0.14, 0, { rx: 0, rz: -0.5 }); tier(2, () => { for (const sd of [1, -1]) feather(p, C.wingLight, -0.2, r * 0.3, r * 0.8 * sd, 0.35, 0.1, sd * 0.4, { flat: true, rx: sd * 0.6 }); }); },
    });
    const tip = segs[segs.length - 1];
    for (let i = -3; i <= 3; i++) feather(tip, i % 2 ? C.wing : C.wingLight, 0.1, 0, 0, 1.0 - Math.abs(i) * 0.1, 0.18, i * 0.25);
    wings(X, [1.3, 0.32, 0.32], 'feather', { c0: 1.2, s1: 1.25, s2: 1.8, fingers: 6, amp: 0.5, covert: C.belly });
    A.speed = 2.6;
    return { back: [0.55, 0.38, 0], backLen: 1.6, headPivot: h, mouth: hd.mouth, backW: 0.5, bodyR: 0.42, along: true, pilot: [1.75, 0.4, 0] };
  },

  fly(X) {
    const { B, C, A } = X;
    // a bloated rot-fly: striped swollen abdomen, a hairy thorax, great red eyes, four buzzing wings
    sweep(B, C.body, [[-0.1, 0.0, 0], [0.35, 0.08, 0], [0.8, 0.05, 0]], [0.45, 0.62, 0.45], { n: 8, m: 14 });
    const ab = group(B, -0.4, -0.05, 0);
    sweep(ab, C.belly, [[0.2, 0, 0], [-0.5, -0.05, 0], [-1.3, -0.1, 0], [-2.1, -0.05, 0]], [0.5, 0.88, 0.85, 0.2], { n: 12, m: 16 });
    for (let i = 0; i < 4; i++) add(ab, mesh(TORUS(0.1, 24, 5), C.dark, -0.35 - i * 0.42, -0.05, 0, 0.85 - Math.abs(i - 1.2) * 0.12)).rotation.y = PI / 2;
    for (let i = 0; i < 9; i++) ell(ab, i % 3 ? C.blood : C.accent, -0.4 - (i * 0.41) % 1.5, 0.45 + (i % 2) * 0.25, ((i * 0.37) % 0.9) - 0.45, 0.12, 0.07, 0.12, true); // sores
    const h = headPivot(X, B, 1.15, 0.0);
    ell(h, C.dark, 0, 0, 0, 0.32, 0.36, 0.42);
    const red = X.T.t(0x9a1a10, { roughness: 0.3 });
    for (const sd of [1, -1]) add(h, mesh(ICO(2), red, 0.12, 0.08, 0.3 * sd, 0.28, 0.34, 0.24));
    const j = jawPivot(X, h, 0.25, -0.2, 0.5);
    sweep(j, C.dark, [[0, 0, 0], [0.2, -0.3, 0], [0.32, -0.45, 0]], [0.08, 0.05, 0.1], { n: 6, m: 7 });
    throat(X, h, 0.3, -0.3, 0.4);
    for (const sd of [1, -1]) for (let i = 0; i < 3; i++) { const x = 0.7 - i * 0.4; leg(X, [x, -0.32, 0.3], sd, [[0, 0, 0], [0.3 - i * 0.3, -0.4, 0.45], [0.2 - i * 0.4, -0.9, 0.5]], [0.05, 0.04, 0.025], 'claw', { mat: C.dark, reach: i === 0 ? 0.9 : 0.4 }); }
    tier(1, () => { for (let i = 0; i < 14; i++) spike(B, C.dark, [0.7 - i * 0.08, 0.55, ((i * 0.53) % 0.8) - 0.4], [0.62 - i * 0.08, 0.85, ((i * 0.53) % 0.8) - 0.4], 0.025, 3); });
    const film = new THREE.MeshStandardMaterial({ color: C.wing.color.clone().lerp(new THREE.Color(0xffffff), 0.3), transparent: true, opacity: 0.5, side: THREE.DoubleSide, roughness: 0.3, depthWrite: false });
    wings(X, [0.35, 0.58, 0.2], 'insect', { len: 3.4, wd: 0.7, sw: -0.45, mat: film, amp: 0.45, base: 0.15, speedK: 1 });
    wings(X, [0.05, 0.55, 0.2], 'insect', { len: 2.9, wd: 0.6, sw: -0.9, mat: film, amp: 0.45, base: 0.05, phase: 1.3 });
    A.speed = 38; A.buzz = true;
    return { back: [0.25, 0.64, 0], backLen: 0.9, headPivot: h, mouth: [0.55, -0.6, 0], backW: 0.5, bodyR: 0.6 };
  },

  moth(X) {
    const { B, C, A } = X;
    // a furry dusk-moth: plush body, feathered antennae, broad patterned wings in two pairs
    sweep(B, C.body, [[-0.1, 0, 0], [0.4, 0.02, 0], [0.85, 0.05, 0]], [0.42, 0.5, 0.4], { n: 8, m: 14 });
    locks(B, C.belly, Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * TAU; return [[0.75, 0.05 + Math.sin(a) * 0.3, Math.cos(a) * 0.35], [0.65, 0.05 + Math.sin(a) * 0.55, Math.cos(a) * 0.6]]; }), 0.1);
    for (let i = 0; i < 6; i++) sweep(B, i % 2 ? C.body : C.belly, [[-0.35 - i * 0.32, -0.05 - i * 0.03, 0], [-0.68 - i * 0.32, -0.08 - i * 0.03, 0]], [0.4 - i * 0.05, 0.36 - i * 0.05], { n: 2, m: 12, round: 0.5 });
    const h = headPivot(X, B, 1.05, 0.05);
    ell(h, C.body, 0, 0, 0, 0.28, 0.28, 0.3);
    for (const sd of [1, -1]) add(h, mesh(ICO(2), C.pupil, 0.13, 0.05, 0.22 * sd, 0.15, 0.17, 0.13));
    for (const sd of [1, -1]) {
      const a0 = [0.15, 0.2, 0.12 * sd], a1 = [0.6, 0.75, 0.42 * sd], a2 = [0.95, 1.15, 0.68 * sd];
      sweep(h, C.dark, [a0, a1, a2], 0.025, { n: 8, m: 4 });
      tier(2, () => { for (let i = 1; i < 10; i++) { const t = i / 10, p = t < 0.5 ? lerpV(a0, a1, t * 2) : lerpV(a1, a2, t * 2 - 1); for (const e of [1, -1]) rod(h, C.wingLight, p, [p[0] - 0.12, p[1] + 0.05 * e, p[2] + 0.1 * e * sd], 0.012, 0.004, 3); } });
    }
    const j = jawPivot(X, h, 0.25, -0.15, 0.5);
    horn(j, C.dark, [[0, 0, 0], [0.1, -0.15, 0], [0.05, -0.3, 0], [-0.05, -0.32, 0]], 0.03);
    throat(X, h, 0.2, -0.1, 0.4);
    for (const sd of [1, -1]) for (let i = 0; i < 3; i++) leg(X, [0.5 - i * 0.28, -0.3, 0.2], sd, [[0, 0, 0], [0.1 - i * 0.1, -0.3, 0.3], [0.05 - i * 0.2, -0.6, 0.38]], [0.045, 0.035, 0.02], 'claw', { mat: C.dark, reach: i === 0 ? 0.9 : 0.4 });
    wings(X, [0.35, 0.32, 0.3], 'moth', { amp: 0.5, base: 0.15, mat: C.wing, mat2: C.wingLight });
    A.speed = 4.2;
    return { back: [0.25, 0.5, 0], backLen: 0.8, headPivot: h, mouth: [0.3, -0.25, 0], backW: 0.45, bodyR: 0.48, pilot: [0.85, 0.44, 0] };
  },

  daemon(X) {
    const { B, C, A } = X;
    // a horned fiend flying low and forward, its riders clinging between its shoulders
    const tor = group(B, 0, 0, 0); tor.rotation.z = -1.1;
    sweep(tor, C.body, [[0, -0.45, 0], [0, 0.1, 0], [0, 0.75, 0]], [0.45, 0.6, 0.62], { n: 8, m: 14, up: [1, 0, 0], ry: 0.8 });
    ell(tor, C.belly, 0.25, 0.25, 0, 0.3, 0.55, 0.45);
    tier(2, () => { for (let i = 0; i < 3; i++) for (const sd of [1, -1]) ell(tor, C.belly, 0.38, -0.15 + i * 0.2, 0.12 * sd, 0.08, 0.08, 0.1); });
    for (const sd of [1, -1]) ell(tor, C.body, 0, 0.85, 0.55 * sd, 0.32, 0.3, 0.32);
    add(tor, mesh(TORUS(0.22, 24, 6), C.metal, 0.05, 1.0, 0, 0.5, 0.5, 0.5)).rotation.x = PI / 2; // the brass collar
    tier(1, () => { for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; horn(tor, C.metal, [[0.05 + Math.cos(a) * 0.5, 1.0, Math.sin(a) * 0.5], [0.05 + Math.cos(a) * 0.68, 1.05, Math.sin(a) * 0.68]], 0.05); } });
    // legs trailing back; arms reaching forward with claws (the arms are the 'talons' that snatch)
    for (const sd of [1, -1]) {
      sweep(tor, C.body, [[0, -0.5, 0.3 * sd], [0.25, -1.3, 0.35 * sd], [-0.05, -2.0, 0.35 * sd]], [0.24, 0.15, 0.09], { n: 10, m: 9 });
      for (let i = 0; i < 3; i++) horn(tor, C.claw, [[-0.05, -2.0, 0.35 * sd + (i - 1) * 0.05], [0.1, -2.15, 0.35 * sd + (i - 1) * 0.06], [0.15, -2.3, 0.35 * sd + (i - 1) * 0.06]], 0.04);
    }
    for (const sd of [1, -1]) {
      const { toes } = leg(X, [0.9, 0.35, 0.62], sd, [[0, 0, 0], [0.45, -0.25, 0.2], [0.85, -0.6, 0.05]], [0.18, 0.13, 0.09], 'claw', { reach: 0.8 });
      if (sd > 0) { const ax = group(toes, 0, 0, 0); ax.rotation.z = -1.0; rod(ax, C.wood, [0, 0.6, 0], [0, -0.9, 0], 0.035); slab(ax, C.metal, [[0, 0.4], [0.5, 0.65], [0.65, 0.4], [0.5, 0.15], [0, 0.25]], 0.04, 0.01).rotation.x = -PI / 2; tier(2, () => emblem(ax, C.accent, X.S.emblem, 0.25, 0.05).position.set(0.3, 0.38, 0)); }
    }
    const h = headPivot(X, B, 1.05, 0.7);
    ell(h, C.body, 0, 0, 0, 0.3, 0.32, 0.28);
    eyes(h, C, 0.24, 0.06, 0.12, 0.05, C.dark);
    for (const sd of [1, -1]) horn(h, C.horn, [[-0.05, 0.22, 0.14 * sd], [-0.3, 0.55, 0.3 * sd], [-0.2, 0.85, 0.45 * sd], [0.05, 1.0, 0.45 * sd]], 0.1);
    teeth(h, C, 0.25, 0.33, -0.15, 0.06, 3, 0.08);
    const j = jawPivot(X, h, 0.12, -0.17, 0.6);
    sweep(j, C.dark, [[0, 0, 0], [0.3, -0.06, 0]], [0.16, 0.1], { n: 4, m: 9, ry: 0.6 });
    teeth(j, C, 0.15, 0.3, 0.03, 0.06, 3, 0.07, true);
    throat(X, h, 0.25, -0.12, 0.5);
    chain(X, B, [-1.4, -0.8, 0], 7, 0.32, 0.1, 0.04, C.dark, { ang: PI + 0.15, amp: 0.35, speed: 2.2 });
    const segs = A.tails[A.tails.length - 1].segs; slab(segs[segs.length - 1], C.dark, [[0.1, 0], [-0.2, 0.18], [-0.45, 0], [-0.2, -0.18]], 0.03, 0.01);
    ridge(B, C.horn, [[0.2, 0.65], [-0.15, 0.52], [-0.5, 0.35]], 0.22, 0.07);
    wings(X, [0.15, 0.52, 0.55], 'bat', { c0: 1.5, s1: 1.45, s2: 2.4, fingers: 4, amp: 0.55, back: 1.0 });
    A.speed = 2.6;
    return { back: [-0.35, 0.66, 0], backLen: 0.8, headPivot: h, mouth: [0.42, -0.25, 0], pilot: [0.45, 0.66, 0], backW: 0.5, bodyR: 0.6 };
  },
};

function drake(X, o) {
  const { B, C, A } = X, k = o.k || 1;
  sweep(B, C.body, [[-1.2 * k, 0.05, 0], [-0.55 * k, 0.04, 0], [0.25 * k, 0.04, 0], [0.85 * k, 0.15, 0], [1.15 * k, 0.28, 0]], [0.3 * k, 0.52 * k, 0.56 * k, 0.48 * k, 0.32 * k], { n: 12, m: 14, ry: 0.92, prof: (t, a) => (Math.cos(a) < 0 ? 0.92 : 1) });
  ell(B, C.body, 0.7 * k, 0.25, 0, 0.45 * k, 0.38 * k, 0.55 * k); // shoulders under the wings
  // the neck curving up to the head, belly plates under it all
  sweep(B, C.body, [[0.95 * k, 0.25, 0], [1.4 * k, 0.45, 0], [1.75 * k, 0.62, 0], [2.08 * k, 0.72 * k, 0]], [0.32 * k, 0.26 * k, 0.21 * k, 0.17 * k], { n: 12, m: 12 });
  scutes(B, C.belly, [...Array.from({ length: 8 }, (_, i) => { const x = (0.9 - i * 0.28) * k; return [x, -0.42 * k + Math.abs(x) * 0.04, 0.16, 0.36 * k]; }), ...Array.from({ length: 4 }, (_, i) => [(1.15 + i * 0.27) * k, (0.12 + i * 0.15) * k, 0.12, 0.2 * k])]);
  tier(0, () => { for (let i = 0; i < 24; i++) { const x = (0.8 - (i % 12) * 0.16) * k, a = 0.9 + (i >= 12 ? 0.5 : 0), sd = i % 2 ? 1 : -1; add(B, mesh(HEMI(), C.back, x, 0.04 + Math.cos(a) * 0.5 * k, sd * Math.sin(a) * 0.54 * k, 0.06, 0.03, 0.06)).rotation.set(sd * a, 0, 0); } });
  const h = headPivot(X, B, 2.22 * k, 0.76 * k);
  const hd = drakeHead(X, h, { tusks: o.tusks, frill: o.tusks ? null : C.wing });
  ridge(B, C.dark, [[1.85 * k, 0.85 * k, 0, 0.5], [1.55 * k, 0.75 * k, 0, 0.6], [1.25 * k, 0.6 * k, 0, 0.7], [0.4 * k, 0.6 * k, 0, 0.9], [0.05 * k, 0.58 * k, 0, 0.9], [-0.7 * k, 0.55 * k], [-1.0 * k, 0.45 * k]], 0.3, 0.08);
  const segs = chain(X, B, [-1.15 * k, 0.06, 0], 8, 0.44 * k, 0.3 * k, 0.06, C.body, { amp: 0.14, speed: 1.4, ang: PI + 0.08, under: C.belly, m: 10,
    each: (p, i) => { if (i % 2 === 0) horn(p, C.dark, [[-0.15, 0.2 - i * 0.018, 0], [-0.24, 0.36 - i * 0.03, 0], [-0.34, 0.42 - i * 0.035, 0]], 0.06 - i * 0.004, 0.004, { n: 4, m: 4 }); } });
  const tip = segs[segs.length - 1];
  if (o.tusks) { ell(tip, C.dark, -0.1, 0, 0, 0.2, 0.14, 0.14); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; horn(tip, C.horn, [[-0.1, Math.sin(a) * 0.1, Math.cos(a) * 0.1], [-0.15, Math.sin(a) * 0.28, Math.cos(a) * 0.28]], 0.04); } }
  else slab(tip, C.wing, [[0.1, 0], [-0.2, 0.35], [-0.75, 0], [-0.2, -0.35]], 0.04, 0.01);
  // legs: hind legs tucked, forelegs (dragons) clutching forward
  for (const sd of [1, -1]) leg(X, [-0.7 * k, -0.2, 0.4 * k], sd, [[0, 0, 0], [-0.1 * k, -0.4, 0.04], [-0.42 * k, -0.48, 0.02], [-0.65 * k, -0.62, 0]], [0.24 * k, 0.16 * k, 0.1 * k, 0.08 * k], 'talon', { thigh: [0.32 * k, 0.3 * k, 0.18 * k], toeMat: C.dark, scaleMat: C.dark, reach: 0.9 });
  if (o.legs === 4) for (const sd of [1, -1]) leg(X, [0.85 * k, -0.22, 0.35 * k], sd, [[0, 0, 0], [0.25 * k, -0.32, 0.02], [0.52 * k, -0.42, 0]], [0.16 * k, 0.11 * k, 0.08 * k], 'talon', { toeMat: C.dark, reach: 0.7 });
  wings(X, [0.4 * k, 0.4 * k, 0.45 * k], 'bat', { c0: 1.55 * k, s1: 1.4, s2: 2.35, fingers: 4, amp: 0.5, back: 0.95 });
  A.speed = 2.4;
  return { back: [-0.2, 0.55 * k, 0], backLen: 1.1, headPivot: h, mouth: hd.mouth, bodyR: 0.55 * k, reins: [2.2 * k, 0.75 * k] };
}

// ======================================================================================
// tack and riders
// ======================================================================================
/** a saddle (2 riders) or howdah (3+) on the back with a caparison, girths, banner and trophies */
function saddle(X, info, n) {
  const { B, C, S } = X, [x, y] = info.back, slots = [];
  const big = info.howdah || n >= 3, w = info.backW ?? 0.55, R = info.bodyR ?? 0.5;
  const len = big ? 0.5 + Math.ceil(n / 2) * 0.42 : 0.5 + n * 0.42;
  const cloth = group(B, x, y, 0), cy = -R; // the body's axis under the saddle
  // the caparison: a cloth draped down both flanks, hemmed in the metal colour, with the emblem and tassels
  const L = len + (info.caparison ? 0.9 : 0.2), AH = info.caparison ? 1.75 : 0.95;
  if (info.drape) info.drape(cloth, L, AH, len);
  else for (const sd of [1, -1]) {
    patch(cloth, C.side, (u, v) => { const a = lerp(0.05, AH, v), xx = (u - 0.5) * L * (1 + v * 0.08), rr = R * 1.06 + 0.02; return [xx, cy + Math.cos(a) * rr, sd * Math.sin(a) * rr * (w / R * 0.9 + 0.1)]; }, 8, 5);
    const ah = AH, hem = (u) => [(u - 0.5) * L * 1.08, cy + Math.cos(ah) * (R * 1.06 + 0.02), sd * Math.sin(ah) * (R * 1.06 + 0.02) * (w / R * 0.9 + 0.1)];
    sweep(cloth, C.metal, [hem(0), hem(0.5), hem(1)], 0.025, { n: 12, m: 4, round: 0 });
    tier(1, () => trophies(cloth, C, S.trophy === 'skulls' || S.trophy === 'bells' || S.trophy === 'tassels' || S.trophy === 'beads' ? S.trophy : 'tassels', [0.15, 0.4, 0.6, 0.85].map((u) => hem(u)), 0.9));
    tier(1, () => motif(cloth, C, S.motif, [0.1, 0.3, 0.5, 0.7, 0.9].map((u) => { const p = hem(u); const a = ah - 0.18; return [p[0], cy + Math.cos(a) * (R * 1.08 + 0.03), sd * Math.sin(a) * (R * 1.08 + 0.03) * (w / R * 0.9 + 0.1), 0, Math.cos(a), sd * Math.sin(a)]; }), 0.9));
    tier(3, () => { const a = AH * 0.6, g = group(cloth, 0, cy + Math.cos(a) * (R * 1.09 + 0.03), sd * Math.sin(a) * (R * 1.09 + 0.03) * (w / R * 0.9 + 0.1)); g.rotation.x = -sd * (PI / 2 - a); if (sd < 0) g.rotation.y = PI; emblem(g, C.metal, S.emblem, info.caparison ? 0.42 : 0.3, 0.03); });
  }
  // girths round the belly
  if (!info.drape) for (const gx of [-len * 0.25, len * 0.25]) add(cloth, mesh(TORUS(0.05, 28, 4), C.leather, gx, cy, 0, R * 1.08, R * 1.08, R * 1.08)).rotation.y = PI / 2;
  const sides = [[x, y + 0.1, w + 0.15], [x, y + 0.1, -(w + 0.15)]];
  if (big) {
    // howdah: a railed platform with corner posts, side shields and a roof in the realm's style
    const W = Math.min(0.75, w + 0.12), dy = 0.16;
    blk(cloth, C.wood, 0, dy - 0.06, 0, len, 0.12, W * 2);
    tier(1, () => { for (let i = 0; i < 6; i++) blk(cloth, C.woodDark, (i / 5 - 0.5) * len * 0.95, dy + 0.005, 0, 0.02, 0.01, W * 1.9); });
    for (const sd of [1, -1]) {
      sweep(cloth, C.metal, [[-len / 2, dy + 0.24, sd * W], [len / 2, dy + 0.24, sd * W]], 0.025, { n: 2, m: 5, round: 0 });
      for (let i = 0; i <= 4; i++) add(cloth, mesh(CYL(8), C.wood, -len / 2 + (i / 4) * len, dy + 0.12, sd * W, 0.025, 0.24, 0.025));
      // shields along the rail
      tier(2, () => { for (let i = 0; i < Math.ceil(n / 2); i++) { const sx = -len / 2 + (i + 0.5) / Math.ceil(n / 2) * len; const sg = group(cloth, sx, dy + 0.13, sd * (W + 0.03)); if (sd < 0) sg.rotation.y = PI; add(sg, mesh(CYL(16), C.side, 0, 0, 0, 0.15, 0.03, 0.15)).rotation.x = PI / 2; add(sg, mesh(TORUS(0.12, 16, 4), C.metal, 0, 0, 0.015, 0.15)); tier(1, () => { const e = emblem(sg, C.metal, S.emblem, 0.17, 0.02); e.position.z = 0.025; }); } });
    }
    for (const sx of [-1, 1]) sweep(cloth, C.metal, [[sx * len / 2, dy + 0.24, -W], [sx * len / 2, dy + 0.24, W]], 0.025, { n: 2, m: 5, round: 0 });
    // roof on four poles
    const rf = ['pagoda', 'dome', 'tent', 'stepped', 'canopy', 'onion', 'spire'].includes(S.roof) ? S.roof : 'canopy', ry = dy + 0.95;
    for (const sx of [1, -1]) for (const sz of [1, -1]) add(cloth, mesh(CYL(8), C.wood, sx * len * 0.47, dy + 0.48, sz * W * 0.95, 0.03, 0.95, 0.03));
    if (rf === 'canopy') roof(cloth, C, 'canopy', 0, ry - 0.05, 0, len, W * 2, { mat: C.side });
    else roof(cloth, C, rf, 0, ry, 0, len * 1.05, W * 2.1, { mat: C.side, finial: S.finial, tiers: 2 });
    banner(cloth, C, S, [-len / 2, dy, -W], 1.5, 0.55);
    const cols = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) { const c = Math.floor(i / 2), r = n === 3 && i === 2 ? 0 : i % 2 ? -1 : 1; slots.push([x + (cols === 1 ? 0 : (c / (cols - 1) - 0.5) * (len - 0.4)), y + dy, r * W * 0.5]); }
    sides[0] = [x, y + dy + 0.2, W + 0.05]; sides[1] = [x, y + dy + 0.2, -W - 0.05];
  } else {
    for (let i = 0; i < n; i++) {
      const sx = (n === 1 ? 0 : (i / (n - 1) - 0.5) * (len - 0.45));
      // a war saddle: seat, high cantle, pommel, stirrups on straps
      sweep(cloth, C.leather, [[sx - 0.16, 0.06, 0], [sx, 0.03, 0], [sx + 0.16, 0.06, 0]], 0.17, { n: 6, m: 10, ry: 0.35 });
      slab(cloth, C.leather, [[-0.18, 0], [0.18, 0], [0.15, 0.2], [-0.15, 0.2]], 0.05, 0.015).position.set(sx - 0.17, 0.04, 0);
      cloth.children[cloth.children.length - 1].rotation.set(-PI / 2, -PI / 2, 0);
      ell(cloth, C.metal, sx + 0.18, 0.14, 0, 0.05, 0.08, 0.06);
      tier(2, () => { for (const sd of [1, -1]) { rod(cloth, C.leather, [sx, 0.04, sd * 0.16], [sx + 0.02, -0.32, sd * (w * 0.75 + 0.08)], 0.012, 0.012, 3); add(cloth, mesh(TORUS(0.2, 10, 3), C.metal, sx + 0.02, -0.36, sd * (w * 0.75 + 0.08), 0.045)); } });
      slots.push([x + sx, y + 0.11, 0]);
    }
    // the realm banner on the rear seat
    banner(cloth, C, S, [-len / 2 + 0.05, 0.05, 0.22], 1.35, 0.55);
    if (S.trophy === 'skulls' || S.trophy === 'furs' || S.trophy === 'bones' || S.trophy === 'charms' || S.trophy === 'feathers') tier(1, () => trophies(cloth, C, S.trophy, [[-len / 2 - 0.05, 0.05, w * 0.6], [-len / 2 - 0.05, 0.05, -w * 0.6]], 1.1));
  }
  // a grapnel line for boarding, coiled out of sight
  X.lines = [];
  for (const sd of [1, -1]) {
    const gp = group(cloth, 0, 0.15, sd * (w + 0.05)); gp.visible = false;
    const gl = group(gp); if (sd < 0) gl.rotation.y = PI;
    rod(gl, C.rope, [0, 0, 0], [0, 0, 1], 0.015, 0.015, 4);
    const hk = group(gl, 0, 0, 1);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; horn(hk, C.iron, [[0, 0, 0.08], [Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0.04], [Math.cos(a) * 0.12, Math.sin(a) * 0.12, -0.05]], 0.02); }
    X.lines.push({ gp, gl, hk, sd });
    X.moving = (X.moving || []).concat([gp, gl, hk]);
  }
  return { slots, len, sides };
}
/** the pilot, seated at the neck with the reins, in the realm's helm and colours */
function pilot(X, at, info) {
  const { B, C, S } = X, [x, y, z] = at, g = group(B, x, y, z);
  sweep(g, C.leather, [[-0.12, 0.05, 0], [0.12, 0.05, 0]], 0.13, { n: 2, m: 8, ry: 0.4 });
  lathe(g, C.side, [[0.12, 0.1], [0.14, 0.18], [0.13, 0.3], [0.1, 0.4], [0.06, 0.44]], 10, 'pil:body');
  tier(1, () => { add(g, mesh(TORUS(0.2, 12, 4), C.metal, 0, 0.28, 0, 0.135)).rotation.x = PI / 2; const e = emblem(g, C.metal, S.emblem, 0.12, 0.02); e.position.set(0.13, 0.28, 0); e.rotation.y = PI / 2; });
  for (const sd of [1, -1]) sweep(g, C.sideDark, [[0, 0.12, 0.1 * sd], [0.14, 0.05, 0.2 * sd], [0.16, -0.12, 0.22 * sd]], 0.05, { n: 5, m: 6 }); // legs astride
  for (const sd of [1, -1]) sweep(g, C.sideDark, [[0, 0.38, 0.12 * sd], [0.12, 0.3, 0.14 * sd], [0.24, 0.24, 0.1 * sd]], 0.035, { n: 5, m: 6 });
  const hd = group(g, 0, 0.53, 0);
  ell(hd, C.skin, 0, 0, 0, 0.085, 0.095, 0.085);
  helm(hd, C, S.helm, S);
  // a cloak in the side colour
  patch(g, C.sideDark, (u, v) => [-0.1 - v * 0.35, 0.42 - v * 0.35, (u - 0.5) * (0.26 + v * 0.18)], 3, 3);
  if (info.reins) { const r = info.reins; for (const sd of [1, -1]) tier(2, () => rope(B, C.leather, [x + 0.24, y + 0.24, 0.1 * sd], [r[0], r[1] - 0.05, 0.12 * sd], 0.01, 0.05)); }
  // a lance with a pennon, held upright
  tier(2, () => { rod(g, C.wood, [0.2, 0.0, -0.18], [0.3, 1.4, -0.2], 0.018, 0.012, 5); spike(g, C.metal, [0.3, 1.4, -0.2], [0.32, 1.6, -0.2], 0.03, 5); });
}
/** arrows, gashes and torn membrane that show once badly hurt */
function wounds(X, info) {
  const { B, C, A } = X;
  const g = group(B); g.visible = false; A.hide2.push(g);
  const [x, y] = info.back;
  for (let i = 0; i < 7; i++) {
    const px = x + 0.7 - i * 0.33, sd = i % 2 ? 1 : -1, py = y - 0.2 - (i % 3) * 0.12, pz = sd * 0.44;
    ell(g, C.blood, px, py, pz, 0.12, 0.08, 0.04, true);
    rod(g, C.wood, [px, py, pz], [px - 0.25, py + 0.3, pz + sd * 0.35], 0.015, 0.015, 3);
    tier(1, () => { for (const e of [-1, 1]) slab(g, C.cloth, [[0, 0], [-0.08, 0.03], [-0.08, -0.03]], 0.005, 0).position.set(px - 0.24, py + 0.29 + e * 0.01, pz + sd * 0.34); });
  }
  for (const w of A.wings.filter((_, i) => i < 2)) {
    const tg = group(w.el || w.sh); tg.visible = false; A.hide2.push(tg);
    for (let i = 0; i < 3; i++) ell(tg, C.blood, -0.3 - i * 0.3, 0.03, 0.4 + i * 0.5, 0.15, 0.015, 0.12);
  }
}

// ======================================================================================
// actions
// ======================================================================================
const hold = (k, a = 0.18, b = 0.78) => (k <= 0 || k >= 1 ? 0 : k < a ? Math.sin((k / a) * PI / 2) : k < b ? 1 : Math.cos(((k - b) / (1 - b)) * PI / 2) ** 2);
function beastActions(X, root) {
  const { A, jaws } = X, act = A.act;
  const apply = () => animateSky(root, A.t ?? 0);
  const jaw = (o) => { act.jaw = o; for (const j of jaws) j.p.rotation.z = -j.open * o; };
  const throatOn = (o) => { if (!X.throat) return; X.throat.visible = o > 0.02; X.throat.scale.set(o > 0.02 ? 0.6 + 0.6 * o : 1, 1, 1); if (X.throatMat) { X.throatMat.userData.boost = 1.5 * o; X.throatMat.emissiveIntensity = X.throatMat.userData.glowBase * (1 + 1.5 * o); } };
  const legs = (reach, curl) => { act.reach = reach; act.curl = curl; for (const l of A.legs) { l.p.rotation.z = l.rest + l.reach * reach; if (l.toes) l.toes.rotation.z = -l.curl * curl; } };
  const clear = (...keys) => { for (const k of keys) act[k] = 0; };
  const acts = {
    breath(k) {
      const o = hold(k, 0.2, 0.8);
      jaw(o); throatOn(o); act.thrust = 0.22 * o; act.headUp = -0.18 * o; act.thrustY = -0.05 * o; act.still = o;
      if (k >= 1) { jaw(0); throatOn(0); clear('thrust', 'headUp', 'thrustY', 'still'); }
      apply();
    },
    fire(k) { const o = pulse(k, 0.3); jaw(o); act.thrust = 0.28 * o; act.still = o; if (k >= 1) { jaw(0); clear('thrust', 'still'); } apply(); },
    ram(k) { const o = pulse(k, 0.35); jaw(o); act.thrust = 0.3 * o; act.lunge = 0.4 * o; if (k >= 1) { jaw(0); clear('thrust', 'lunge'); } apply(); },
    shriek(k) {
      const o = hold(k, 0.15, 0.8);
      jaw(o * 1.2); act.headUp = 0.55 * o; act.flare = o; act.still = o; act.rear = 0.15 * o; act.lash = o;
      if (k >= 1) { jaw(0); clear('headUp', 'flare', 'still', 'rear', 'lash'); }
      apply();
    },
    dive(k) {
      const o = hold(k, 0.2, 0.75);
      act.fold = o; act.pitch = 0.45 * o; act.headUp = -0.2 * o; legs(-0.2 * o, 0);
      if (k >= 1) { clear('fold', 'pitch', 'headUp'); legs(0, 0); }
      apply();
    },
    snatch(k) {
      const reach = hold(k, 0.3, 0.75), curl = k < 0.35 ? -0.6 * Math.sin((k / 0.35) * PI / 2) : k < 0.5 ? lerp(-0.6, 1, (k - 0.35) / 0.15) : k < 0.85 ? 1 : 1 - (k - 0.85) / 0.15;
      legs(reach, k >= 1 ? 0 : curl); act.pitch = -0.12 * reach; act.beat = 0.6 * reach;
      if (k >= 1) { legs(0, 0); clear('pitch', 'beat'); }
      apply();
    },
    grapple(k) { acts.snatch(k); },
    bomb(k) { const o = pulse(k, 0.3); legs(0.3 * o, -0.6 * o); act.rear = 0.08 * o; if (k >= 1) { legs(0, 0); clear('rear'); } apply(); },
    mortar(k) { acts.bomb(k); },
    launch(k) { const o = pulse(k, 0.3); act.beat = 1.2 * o; act.rear = 0.12 * o; if (k >= 1) clear('beat', 'rear'); apply(); },
    hit(k) {
      const d = k >= 1 ? 0 : (1 - k) * (1 - k);
      act.roll = 0.22 * Math.sin(k * 26) * d; act.pitch = -0.1 * Math.sin(k * 19 + 0.5) * d; act.headUp = 0.3 * d * Math.sin(k * 14); act.flare = 0.35 * d;
      jaw(0.5 * d);
      if (k >= 1) { jaw(0); clear('roll', 'pitch', 'headUp', 'flare'); }
      apply();
    },
    board(k) {
      const t = k >= 1 ? 0 : k < 0.35 ? k / 0.35 : k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      for (const r of X.lines || []) { r.gp.visible = k > 0 && k < 1 && t > 0.02; r.gl.scale.set(1, 1, Math.max(0.01, 2.6 * t)); r.hk.scale.set(1, 1, 1 / Math.max(0.01, 2.6 * t)); r.gl.rotation.x = 0.5 * t * r.sd; if (k >= 1) { r.gl.scale.set(1, 1, 1); r.hk.scale.set(1, 1, 1); r.gl.rotation.x = 0; } }
    },
  };
  return acts;
}
void SPH; void OCTA; void seatedPilot; void blk; void plate; void clamp; void hash; void noCrew; void finial; void CONE;
