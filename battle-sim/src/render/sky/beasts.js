// Great flying beasts that fight in an airship's place: wings first (they make the silhouette from the
// battle camera), then head and tail, then a saddle or howdah on the back where the riders sit.
// Model space: +x forward, +y up, +z starboard; origin at the flying centre; wingspan about def.len.
import { THREE, mat, PI, SPH, CONE, mesh, ell, blk, add, group, rod, spike, plate, tintSet, shade, mixc, featherWing, batWing, bake, noCrew } from './kit.js';

const DS = { side: THREE.DoubleSide };
const lerp = (a, b, k) => a + (b - a) * k;

export function buildSkyBeast(def, sideColor) {
  const D = def.sky, L = D.look || {}, T = tintSet();
  const body = L.body ?? 0x6a5a40, wingC = L.wing ?? 0x4a3a2a, bellyC = L.belly ?? 0xc8b890;
  const sideM = mat(sideColor).clone(), sideDark = mat(sideColor).clone();
  const C = {
    body: T.t(body), belly: T.t(bellyC), dark: T.t(shade(body, 0.6)),
    wing: T.t(wingC, DS), wingDark: T.t(shade(wingC, 0.62), DS), wingLight: T.t(mixc(wingC, bellyC, 0.5), DS), bodyDS: T.t(body, DS), bellyDS: T.t(bellyC, DS),
    horn: mat(0xe6dcc4), claw: mat(0x2a2420), beak: mat(0xe0a830), eye: mat(0x120c08), skin: mat(0xd2a07a), hair: mat(0x2a1c14),
    eyeGlow: T.glow(0xffc840, 1.6), leather: mat(0x6a4426), brass: mat(0xc9a04a, { metalness: 0.6, roughness: 0.4 }), wood: mat(0x6b4a2e),
    iron: mat(0x45454c, { metalness: 0.6, roughness: 0.5 }), side: sideM, sideDark, blood: mat(0x5a0c0a), bald: T.t(0xb86a5a),
  };
  const root = new THREE.Group(), B = group(root);
  const A = { wings: [], tails: [], heads: [], spin: [], glows: [], body: B, speed: 3.4, droop: 0, hide2: [], movers: [] };
  const fn = CREATURES[D.creature] || CREATURES.wyvern;
  const info = fn(B, C, A, D);
  const riders = Math.max(1, D.riders || 2);
  const { slots, len } = saddle(B, C, A, info.back, riders, info.backW ?? 0.55, info.howdah);
  if (info.pilot !== false) pilot(B, C, info.pilot || [info.back[0] + len / 2 + 0.25, info.back[1] + 0.02, 0], info.reins);
  wounds(B, C, A, info);
  for (const w of A.wings) A.movers.push(w.sh, w.el);
  for (const t of A.tails) A.movers.push(...t.segs);
  A.movers.push(...A.heads.map((h) => h.p), ...A.spin.map((s) => s.o), ...A.hide2, B);
  // where the guns are: the mouth (a beast breathes or bites instead of firing a broadside)
  root.updateMatrixWorld(true);
  const mouth = new THREE.Vector3(...(info.mouth || [0, 0, 0]));
  if (info.headPivot) info.headPivot.localToWorld(mouth);
  bake(root, A.movers);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const box = new THREE.Box3().setFromObject(root);
  const half = def.len / 2;
  root.userData = {
    skyAnim: true, anim: A, beast: D.creature,
    muzzles: [[mouth.x, mouth.y, Math.max(0.25, Math.abs(mouth.z))]],
    bombBay: [info.back[0] - 0.4, -0.7, 0], hangar: [info.back[0] - info.backLen * 0.6, info.back[1], 0],
    pods: [[0.6, -0.6, 0.5], [0.6, -0.6, -0.5], [-0.6, -0.6, 0.5], [-0.6, -0.6, -0.5]], ladders: [[info.back[0], info.back[1] - 0.2, -0.5], [info.back[0], info.back[1] - 0.2, 0.5]],
    top: Math.max(box.max.y, info.back[1] + 0.9) + 0.15, radius: half, props: [], crewSlots: slots,
    setSide(hex) { sideM.color.set(hex); sideDark.color.set(hex).multiplyScalar(0.6); },
    setDamage(lv) {
      T.damage(lv);
      for (const o of A.hide2) o.visible = lv >= 2;
      A.droop = lv >= 3 ? 1 : 0;
    },
  };
  root.userData.setSide(sideColor);
  return root;
}

// ---------- shared anatomy ----------
/** two wings at `at` = [x, y, z0]; kind 'feather' | 'bat' | 'insect' | 'moth' */
function wings(B, C, A, at, kind, o = {}) {
  const [x, y, z0] = at, amp = o.amp ?? 0.55, base = o.base ?? 0.12;
  for (const sd of [1, -1]) {
    const mir = group(B, x, y, sd * z0); mir.scale.z = sd;
    const sh = group(mir); sh.rotation.y = o.sweep0 ?? 0;
    const w = { sh, el: null, amp, base, phase: o.phase ?? 0, outerK: o.outerK ?? 0.75, speedK: o.speedK ?? 1, dih: o.dih ?? 0 };
    if (kind === 'feather') {
      const { inner, outer } = featherWing(o.c0 ?? 1.5, o.s1 ?? 1.6, o.s2 ?? 2.1, o.fingers ?? 5, o);
      plate(sh, o.mat || C.wing, inner);
      const c0 = o.c0 ?? 1.5, s1 = o.s1 ?? 1.6, lead = o.lead ?? 0.3;
      // coverts: a lighter band along the leading edge
      plate(sh, o.covert || C.wingLight, [[c0 * lead, 0], [c0 * lead * 0.85, s1], [-c0 * 0.18, s1], [-c0 * 0.22, 0]], 0.03);
      const el = group(sh, 0, 0, s1); el.rotation.y = o.sweep ?? -0.25; w.el = el;
      plate(el, o.mat || C.wing, outer);
      plate(el, o.tipMat || C.wingDark, outer.filter(([, s]) => s > (o.s2 ?? 2.1) * 0.45).concat([[-(c0 * 0.85) * 0.6, (o.s2 ?? 2.1) * 0.45], [(c0 * 0.85) * lead * 0.5, (o.s2 ?? 2.1) * 0.5]]), 0.02);
      plate(el, o.covert || C.wingLight, [[c0 * 0.85 * lead, 0], [0.05, (o.s2 ?? 2.1) * 0.55], [-0.25, (o.s2 ?? 2.1) * 0.5], [-c0 * 0.2, 0]], 0.03);
      rod(sh, o.boneMat || o.covert || C.wingLight, [c0 * lead - 0.08, 0, 0], [c0 * lead * 0.85 - 0.06, 0, s1], 0.09, 0.06, 5);
    } else if (kind === 'bat') {
      const c0 = o.c0 ?? 1.4, s1 = o.s1 ?? 1.4, s2 = o.s2 ?? 2.3;
      const { inner, outer, tips } = batWing(c0, s1, s2, o.fingers ?? 3, o);
      plate(sh, o.mat || C.wing, inner);
      const el = group(sh, 0, 0, s1); el.rotation.y = o.sweep ?? -0.15; w.el = el;
      plate(el, o.mat || C.wing, outer);
      const bone = o.boneMat || C.dark;
      rod(sh, bone, [0.1, 0, 0], [0.05, 0, s1], 0.1, 0.07, 5);
      ell(el, bone, 0, 0, 0, 0.1);
      rod(el, bone, [0, 0, 0], [0.06, 0, s2 * 0.55], 0.07, 0.05, 5);
      spike(el, C.horn, [0.06, 0, s2 * 0.55], [0.3, 0.05, s2 * 0.52], 0.04, 4);
      for (const tp of tips) rod(el, bone, [0, 0, 0], [tp[0], 0, tp[1]], 0.05, 0.02, 4);
      if (o.pteroFinger) rod(el, bone, [0.06, 0, s2 * 0.55], [tips[0][0] + 0.35, 0, s2], 0.05, 0.02, 4);
    } else if (kind === 'insect') {
      // one long translucent blade, veined; no elbow
      const len = o.len ?? 2.6, wd = o.wd ?? 0.55, sweep = o.sw ?? -0.35;
      const pts = [];
      for (let i = 0; i < 16; i++) { const a = (i / 16) * PI * 2; pts.push([Math.sin(a) * wd * (Math.sin(a) > 0 ? 0.8 : 1), len / 2 - Math.cos(a) * len / 2]); }
      sh.rotation.y = sweep;
      plate(sh, o.mat, pts);
      for (const k of [0.45, 0.8]) rod(sh, C.dark, [0, 0, 0.05], [wd * (k - 0.6) * 0.8, 0, len * k], 0.02, 0.01, 3);
    } else if (kind === 'moth') {
      const fore = [[0.3, 0], [0.55, 1.2], [0.5, 2.6], [0.05, 3.15], [-0.6, 2.9], [-1.0, 1.6], [-0.5, 0.3]];
      plate(sh, o.mat || C.wing, fore);
      const hind = [[-0.4, 0], [-0.6, 1.0], [-1.0, 1.9], [-1.7, 2.0], [-2.1, 1.4], [-1.9, 0.6], [-1.2, 0]];
      plate(sh, o.mat2 || C.wingLight, hind, -0.02);
      // eye-spots and a pale band
      for (const [ex, es, r, m] of [[-0.25, 2.1, 0.42, C.bellyDS], [-0.25, 2.1, 0.22, C.wingDark], [-1.35, 1.25, 0.32, C.bellyDS], [-1.35, 1.25, 0.15, C.wingDark]]) {
        const pts = []; for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; pts.push([ex + Math.cos(a) * r, es + Math.sin(a) * r]); }
        plate(sh, m, pts, m === C.wingDark ? 0.045 : 0.035);
      }
      plate(sh, C.bellyDS, [[0.45, 2.75], [0.5, 2.95], [-0.3, 3.0], [-0.7, 2.75]], 0.03);
      ell(sh, C.bodyDS, -0.2, 0.02, 0.45, 0.45, 0.04, 0.35); // fur at the root
    }
    A.wings.push(w);
  }
}

/** a chain of ellipsoid segments that can sway: returns the pivots (the last is the tip mount) */
function chain(P, A, start, n, len, r0, r1, m, o = {}) {
  let p = group(P, ...start);
  const segs = [], ang = o.ang ?? PI; // direction in the x-y plane (PI = straight back)
  p.rotation.z = ang - PI;
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(1, n - 1), r = lerp(r0, r1, k);
    const s = ell(p, m, -len * 0.5, 0, 0, len * 0.62, r * (o.flat ?? 1), r, true);
    if (o.under && i < n - 1) ell(p, o.under, -len * 0.5, -r * 0.35, 0, len * 0.55, r * 0.7, r * 0.8, true);
    if (o.each) o.each(p, i, r, k);
    void s;
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

function headPivot(B, A, x, y, z = 0) { const p = group(B, x, y, z); A.heads.push({ p, k: 1 }); return p; }
const eyes = (h, C, x, y, z, r = 0.07, m = C.eye) => { ell(h, m, x, y, z, r); ell(h, m, x, y, -z, r); };
function legPair(B, C, m, hip, knee, foot, r, claw = C.claw, paw = false) {
  for (const sd of [1, -1]) {
    const f = (p) => [p[0], p[1], p[2] * sd];
    rod(B, m, f(hip), f(knee), r, r * 0.8, 6);
    rod(B, m, f(knee), f(foot), r * 0.75, r * 0.5, 6);
    if (paw) ell(B, m, foot[0] + 0.06, foot[1], foot[2] * sd, r * 0.9, r * 0.55, r * 0.75, true);
    for (const dz of [-0.07, 0, 0.07]) spike(B, claw, [foot[0] + 0.04, foot[1], foot[2] * sd + dz], [foot[0] + 0.2, foot[1] - 0.08, foot[2] * sd + dz * 1.5], 0.035, 4);
  }
}
function ridge(P, m, pts, h = 0.22, r = 0.08) { for (const [x, y, z = 0, k = 1] of pts) spike(P, m, [x, y, z], [x - 0.12 * k, y + h * k, z], r * k, 4); }

// ---------- creatures ----------
const bird = (o) => (B, C, A, D) => {
  const k = o.k ?? 1;
  // torso, chest, belly
  ell(B, C.body, 0, 0, 0, 1.15 * k, 0.5 * k, 0.58 * k);
  ell(B, C.belly, 0.45 * k, -0.12 * k, 0, 0.85 * k, 0.4 * k, 0.5 * k);
  ell(B, C.belly, 0.8 * k, 0.05, 0, 0.5 * k, 0.45 * k, 0.46 * k);
  // neck and head
  const neck = o.neck || [[1.05, 0.25], [1.35, 0.45]];
  const hm = C[o.headKey] || C.body;
  for (const [nx, ny] of neck) ell(B, C[o.neckKey] || hm, nx * k, ny * k, 0, 0.34 * k, 0.34 * k, 0.32 * k);
  const [hx, hy] = o.head || [1.6, 0.55];
  const h = headPivot(B, A, hx * k, hy * k);
  if (o.humanHead) {
    ell(h, C.skin, 0.08, 0, 0, 0.26, 0.32, 0.25);
    ell(h, C.hair, -0.08, 0.08, 0, 0.3, 0.34, 0.3);
    rod(h, C.hair, [-0.1, 0.0, 0], [-0.75, -0.25, 0], 0.22, 0.05);
    ell(h, C.skin, 0.26, -0.1, 0, 0.08, 0.1, 0.08);
    eyes(h, C, 0.3, 0.05, 0.1, 0.045, C.eyeGlow);
    // a crude face: open, shrieking mouth
    ell(h, C.blood, 0.28, -0.17, 0, 0.04, 0.05, 0.08);
  } else {
    ell(h, hm, 0, 0, 0, 0.36 * k, 0.32 * k, 0.3 * k);
    const bk = o.beak || { len: 0.5, r: 0.13, hook: true };
    spike(h, o.beakMat || C.beak, [0.22 * k, -0.02, 0], [(0.22 + bk.len) * k, -0.06 * k, 0], bk.r * k, 6);
    if (bk.hook) spike(h, o.beakMat || C.beak, [(0.12 + bk.len) * k, -0.02, 0], [(0.24 + bk.len) * k, -0.2 * k, 0], bk.r * 0.6 * k, 4);
    if (bk.knob) ell(h, C.eye, 0.26 * k, 0.02, 0, 0.09, 0.08, 0.07);
    eyes(h, C, 0.15 * k, 0.1 * k, 0.21 * k, 0.06 * k);
    if (o.brow) for (const sd of [1, -1]) spike(h, hm, [0.1 * k, 0.12 * k, 0.17 * sd * k], [0.3 * k, 0.14 * k, 0.2 * sd * k], 0.07 * k, 4);
    if (o.crest) for (let i = 0; i < 4; i++) spike(h, o.crestMat || C.wing, [-0.05 - i * 0.05, 0.18 * k, 0], [-0.75 - i * 0.12, 0.55 - i * 0.18, 0], 0.08, 4);
  }
  if (o.ruff) for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2; ell(B, C[o.ruffKey] || C.belly, 1.12 * k, 0.28 * k + Math.sin(a) * 0.3, Math.cos(a) * 0.32, 0.18, 0.2, 0.2, true); }
  // tail fan
  const tl = o.tail ?? 1.2, tw = o.tailW ?? 0.75;
  const tp = group(B, -1.0 * k, 0.08, 0); A.tails.push({ segs: [tp], amp: 0.06, speed: 1.1, lag: 0, pitch: 0.06 });
  const tail = o.wedge
    ? [[0.2, -0.25], [-tl * 0.7, -tw * 0.7], [-tl, 0], [-tl * 0.7, tw * 0.7], [0.2, 0.25]]
    : [[0.2, -0.25], [-tl * 0.85, -tw], [-tl, -tw * 0.5], [-tl * 0.92, 0], [-tl, tw * 0.5], [-tl * 0.85, tw], [0.2, 0.25]];
  const fan = plate(tp, o.tailMat || C.wing, tail.map(([a, b]) => [a * k, b * k]));
  fan.rotation.x = 0; void fan;
  plate(tp, C.wingDark, [[-tl * 0.8 * k, -tw * 0.85 * k], [-tl * k, -tw * 0.45 * k], [-tl * 0.92 * k, 0], [-tl * k, tw * 0.45 * k], [-tl * 0.8 * k, tw * 0.85 * k], [-tl * 0.85 * k, 0]], 0.02);
  // talons tucked under
  legPair(B, o.legMat || C.beak, o.legMat || C.beak, [-0.15 * k, -0.35 * k, 0.28 * k], [-0.4 * k, -0.62 * k, 0.28 * k], [-0.7 * k, -0.72 * k, 0.26 * k], 0.09 * k);
  wings(B, C, A, [0.3 * k, 0.22 * k, 0.42 * k], 'feather', { c0: 1.55 * k, s1: 1.55 * (o.span ?? 1), s2: 2.05 * (o.span ?? 1), fingers: o.fingers ?? 5, ...o.wing });
  A.speed = o.speed ?? 3.0;
  return { back: [-0.15 * k, 0.48 * k, 0], backLen: 1.1 * k, headPivot: h, mouth: [0.7 * k, -0.05, 0], ...o.info };
};

const CREATURES = {
  eagle: bird({ headKey: 'belly', neckKey: 'belly', brow: true, k: 1.05 }),
  roc: bird({ k: 1.12, crest: true, brow: true, span: 1.0, fingers: 6, beak: { len: 0.62, r: 0.16, hook: true }, speed: 2.4 }),
  crow: bird({ k: 1.0, wedge: true, beak: { len: 0.55, r: 0.15, hook: false }, beakMat: mat(0x2a2a30), legMat: mat(0x1e1e22), fingers: 5 }),
  vulture: bird({ k: 1.0, neck: [[1.1, 0.3], [1.4, 0.4], [1.62, 0.36]], head: [1.92, 0.36], ruff: true, headKey: 'bald', neckKey: 'bald', fingers: 7, span: 1.05,
    beak: { len: 0.36, r: 0.1, hook: true }, beakMat: mat(0xd8cbb0), wing: { blunt: true }, speed: 2.4, tail: 0.9 }),
  harpy: bird({ humanHead: true, k: 1.0, head: [1.55, 0.62], info: { mouth: [0.3, -0.15, 0] } }),
  swan: bird({ k: 1.0, neck: [[1.0, 0.35], [1.25, 0.75], [1.45, 1.15], [1.7, 1.4], [1.95, 1.45]], head: [2.15, 1.4],
    beak: { len: 0.4, r: 0.1, knob: true }, beakMat: mat(0xe8782a), legMat: mat(0x2a2420), tail: 0.7, fingers: 7, span: 1.05, wing: { blunt: true, covert: null }, speed: 2.6,
    info: { mouth: [0.55, -0.05, 0] } }),

  griffon(B, C, A) {
    // eagle fore-quarters on a lion's body
    ell(B, C.body, -0.15, -0.02, 0, 1.25, 0.5, 0.55);
    ell(B, C.belly, 0.7, 0.08, 0, 0.6, 0.52, 0.5);
    ell(B, C.wing, 0.95, 0.3, 0, 0.42, 0.4, 0.4); // feathered neck
    const h = headPivot(B, A, 1.35, 0.6);
    ell(h, C.belly, 0, 0, 0, 0.36, 0.32, 0.3);
    spike(h, C.beak, [0.22, -0.02, 0], [0.72, -0.08, 0], 0.13, 6); spike(h, C.beak, [0.62, -0.02, 0], [0.74, -0.22, 0], 0.08, 4);
    eyes(h, C, 0.15, 0.1, 0.21); for (const sd of [1, -1]) spike(h, C.belly, [-0.1, 0.15, 0.15 * sd], [-0.5, 0.35, 0.22 * sd], 0.07, 4);
    // taloned forelegs reaching forward, lion hind legs trailing
    legPair(B, C.beak, C.beak, [0.75, -0.25, 0.3], [1.05, -0.55, 0.32], [1.35, -0.62, 0.3], 0.09);
    legPair(B, C.body, C.claw, [-0.9, -0.15, 0.35], [-1.25, -0.5, 0.35], [-1.75, -0.55, 0.32], 0.17, C.claw, true);
    // caparison in the side's colour
    const segs = chain(B, A, [-1.3, 0.05, 0], 5, 0.38, 0.09, 0.06, C.body, { bend: -0.12, amp: 0.25 });
    ell(segs[segs.length - 1], C.dark, -0.1, 0, 0, 0.2, 0.14, 0.14, true);
    wings(B, C, A, [0.35, 0.3, 0.42], 'feather', { c0: 1.5, s1: 1.55, s2: 2.05, fingers: 5 });
    A.speed = 3.0;
    return { back: [-0.25, 0.45, 0], backLen: 1.1, headPivot: h, mouth: [0.7, -0.05, 0], backW: 0.6 };
  },

  pegasus(B, C, A) {
    ell(B, C.body, 0, 0, 0, 1.2, 0.48, 0.46);
    ell(B, C.belly, 0.1, -0.16, 0, 1.0, 0.36, 0.4);
    rod(B, C.body, [0.85, 0.15, 0], [1.45, 0.85, 0], 0.36, 0.22, 7);
    const h = headPivot(B, A, 1.55, 0.95);
    const hd = group(h); hd.rotation.z = -0.75;
    ell(hd, C.body, 0.25, 0, 0, 0.5, 0.2, 0.18); ell(hd, C.dark, 0.68, -0.04, 0, 0.16, 0.15, 0.15);
    for (const sd of [1, -1]) spike(hd, C.body, [-0.1, 0.12, 0.08 * sd], [-0.02, 0.4, 0.1 * sd], 0.05, 4);
    eyes(hd, C, 0.12, 0.06, 0.15, 0.05);
    // mane along the neck and a flowing tail, in the wing colour
    for (let i = 0; i < 6; i++) { const k = i / 5; spike(B, C.wingLight, [lerp(0.85, 1.45, k) - 0.05, lerp(0.42, 1.12, k), 0], [lerp(0.85, 1.45, k) - 0.45, lerp(0.42, 1.12, k) + 0.05, 0], 0.09, 4); }
    const tail = chain(B, A, [-1.15, 0.15, 0], 5, 0.36, 0.14, 0.06, C.wingLight, { ang: PI + 0.35, bend: -0.12, amp: 0.3, speed: 2 });
    void tail;
    // legs: forelegs folded up, hind legs stretched back
    for (const sd of [1, -1]) {
      rod(B, C.body, [0.75, -0.25, 0.25 * sd], [1.1, -0.55, 0.25 * sd], 0.13, 0.08); rod(B, C.body, [1.1, -0.55, 0.25 * sd], [0.85, -0.85, 0.25 * sd], 0.08, 0.06);
      ell(B, C.claw, 0.82, -0.9, 0.25 * sd, 0.08, 0.06, 0.07);
      rod(B, C.body, [-0.8, -0.15, 0.25 * sd], [-1.25, -0.6, 0.25 * sd], 0.18, 0.09); rod(B, C.body, [-1.25, -0.6, 0.25 * sd], [-1.75, -0.7, 0.25 * sd], 0.08, 0.06);
      ell(B, C.claw, -1.8, -0.72, 0.25 * sd, 0.08, 0.06, 0.07);
    }
    wings(B, C, A, [0.35, 0.3, 0.38], 'feather', { c0: 1.45, s1: 1.6, s2: 2.1, fingers: 5, covert: C.bellyDS, tipMat: C.wing });
    A.speed = 3.0;
    return { back: [-0.25, 0.44, 0], backLen: 1.1, headPivot: hd, mouth: [0.85, -0.05, 0], reins: [1.5, 0.9] };
  },

  sphinx(B, C, A) {
    // a lion's body under a pharaoh's head, on wings of gilded stone
    ell(B, C.body, -0.05, 0, 0, 1.3, 0.5, 0.55); ell(B, C.body, 0.75, 0.08, 0, 0.6, 0.55, 0.55);
    ell(B, C.belly, 0, -0.18, 0, 1.1, 0.35, 0.45);
    const h = headPivot(B, A, 1.25, 0.65);
    ell(h, C.body, 0.05, 0, 0, 0.3, 0.36, 0.28);
    // nemes headdress: a striped hood flaring to the shoulders, a beard below
    const nem = group(h, -0.05, 0.05, 0);
    for (let i = 0; i < 5; i++) blk(nem, i % 2 ? C.belly : C.wing, -0.06, 0.28 - i * 0.12, 0, 0.42, 0.11, 0.62 + i * 0.1);
    blk(nem, C.wing, -0.18, -0.35, 0, 0.3, 0.45, 0.85);
    spike(h, C.wing, [0.25, -0.3, 0], [0.3, -0.62, 0], 0.07, 4);
    spike(h, C.wing, [0.1, 0.38, 0], [0.38, 0.55, 0], 0.07, 4); // uraeus
    eyes(h, C, 0.28, 0.06, 0.12, 0.045, C.eyeGlow);
    // lion legs, paws forward and back
    legPair(B, C.body, C.claw, [0.8, -0.3, 0.33], [1.2, -0.5, 0.33], [1.55, -0.5, 0.33], 0.16, C.claw, true);
    legPair(B, C.body, C.claw, [-0.9, -0.2, 0.36], [-1.3, -0.55, 0.36], [-1.85, -0.6, 0.33], 0.18, C.claw, true);
    const segs = chain(B, A, [-1.3, 0.1, 0], 6, 0.36, 0.08, 0.06, C.body, { bend: 0.15, ang: PI - 0.2, amp: 0.2 });
    ell(segs[segs.length - 1], C.wing, -0.12, 0, 0, 0.2, 0.14, 0.14, true);
    const stone = C.wing; // stone wings in the wing colour, feathers carved and thick
    wings(B, C, A, [0.35, 0.32, 0.45], 'feather', { c0: 1.5, s1: 1.55, s2: 2.0, fingers: 5, blunt: true, mat: stone, covert: C.bellyDS, tipMat: C.wingDark, boneMat: C.belly, amp: 0.38 });
    A.speed = 2.2;
    return { back: [-0.3, 0.45, 0], backLen: 1.1, headPivot: h, mouth: [0.35, -0.12, 0], backW: 0.65, howdah: true };
  },

  manticore(B, C, A) {
    ell(B, C.body, -0.1, 0, 0, 1.25, 0.5, 0.52); ell(B, C.belly, 0, -0.18, 0, 1.05, 0.36, 0.44);
    // a great mane about a man-like face
    ell(B, C.wing, 0.95, 0.35, 0, 0.55, 0.6, 0.62);
    const h = headPivot(B, A, 1.35, 0.45);
    ell(h, C.belly, 0.05, 0, 0, 0.28, 0.32, 0.26);
    eyes(h, C, 0.26, 0.08, 0.11, 0.045, C.eyeGlow);
    for (let i = 0; i < 3; i++) spike(h, C.horn, [0.28, -0.14, (i - 1) * 0.07], [0.34, -0.3, (i - 1) * 0.08], 0.03, 4);
    for (const sd of [1, -1]) spike(h, C.horn, [0, 0.25, 0.14 * sd], [-0.25, 0.55, 0.28 * sd], 0.07, 5);
    legPair(B, C.body, C.claw, [0.75, -0.3, 0.33], [1.15, -0.55, 0.33], [1.5, -0.55, 0.33], 0.15, C.claw, true);
    legPair(B, C.body, C.claw, [-0.9, -0.2, 0.34], [-1.3, -0.55, 0.34], [-1.85, -0.6, 0.32], 0.18, C.claw, true);
    // scorpion tail: arches up and over, the sting poised above the back
    const segs = chain(B, A, [-1.25, 0.25, 0], 8, 0.36, 0.17, 0.12, C.dark, { ang: PI - 0.9, bend: -0.42, amp: 0.08, speed: 1.2, pitch: 0.06,
      each: (p, i) => { if (i % 2 === 0) spike(p, C.horn, [-0.18, 0.12, 0], [-0.22, 0.3, 0], 0.05, 4); } });
    const tip = segs[segs.length - 1];
    ell(tip, C.dark, -0.12, 0, 0, 0.24, 0.18, 0.18); spike(tip, C.horn, [-0.25, 0, 0], [-0.6, -0.25, 0], 0.08, 5);
    wings(B, C, A, [0.3, 0.35, 0.42], 'bat', { c0: 1.4, s1: 1.4, s2: 2.3, fingers: 3, amp: 0.55 });
    A.speed = 2.8;
    return { back: [-0.2, 0.46, 0], backLen: 1.0, headPivot: h, mouth: [0.3, -0.15, 0] };
  },

  bat(B, C, A) {
    ell(B, C.body, 0, 0, 0, 0.95, 0.55, 0.6); ell(B, C.belly, 0.2, -0.15, 0, 0.8, 0.42, 0.5);
    ell(B, C.dark, 0.55, 0.2, 0, 0.45, 0.4, 0.55); // shaggy ruff
    const h = headPivot(B, A, 1.05, 0.25);
    ell(h, C.body, 0, 0, 0, 0.42, 0.38, 0.4);
    ell(h, C.dark, 0.35, -0.08, 0, 0.18, 0.16, 0.2); ell(h, C.belly, 0.48, -0.06, 0, 0.06, 0.06, 0.1);
    for (const sd of [1, -1]) { spike(h, C.wing, [-0.05, 0.25, 0.22 * sd], [-0.15, 0.95, 0.4 * sd], 0.17, 4); }
    eyes(h, C, 0.32, 0.08, 0.18, 0.06, C.eyeGlow);
    for (const sd of [1, -1]) spike(h, C.horn, [0.4, -0.2, 0.08 * sd], [0.42, -0.35, 0.08 * sd], 0.03, 4);
    legPair(B, C.dark, C.claw, [-0.6, -0.2, 0.25], [-1.0, -0.35, 0.3], [-1.3, -0.35, 0.3], 0.08);
    // a short tail membrane between the legs
    plate(B, C.wing, [[-0.7, -0.3], [-1.3, -0.32], [-1.45, 0], [-1.3, 0.32], [-0.7, 0.3]], -0.32);
    wings(B, C, A, [0.35, 0.22, 0.45], 'bat', { c0: 1.6, s1: 1.4, s2: 2.4, fingers: 4, amp: 0.7, back: 0.95, sweep: -0.05 });
    A.speed = 4.4;
    return { back: [-0.2, 0.5, 0], backLen: 0.9, headPivot: h, mouth: [0.48, -0.2, 0] };
  },

  wyvern: (B, C, A) => drake(B, C, A, { legs: 2, tusks: true }),
  dragon: (B, C, A) => drake(B, C, A, { legs: 4, k: 1.08 }),
  pterosaur(B, C, A) {
    ell(B, C.body, 0, 0, 0, 0.85, 0.4, 0.42); ell(B, C.belly, 0.1, -0.12, 0, 0.7, 0.3, 0.36);
    rod(B, C.body, [0.6, 0.15, 0], [1.3, 0.55, 0], 0.22, 0.14, 6);
    const h = headPivot(B, A, 1.4, 0.6);
    ell(h, C.body, 0, 0, 0, 0.3, 0.2, 0.18);
    spike(h, C.belly, [0.15, -0.04, 0], [1.4, -0.2, 0], 0.13, 5); // the long beak
    // swept crest
    plate(h, C.wing, [[0.1, 0], [-0.25, 0.75], [-1.1, 0.95], [-0.35, 0.15]], 0).rotation.x = -PI / 2;
    eyes(h, C, 0.08, 0.08, 0.15, 0.05);
    legPair(B, C.dark, C.claw, [-0.5, -0.2, 0.25], [-0.95, -0.3, 0.32], [-1.35, -0.32, 0.38], 0.07);
    chain(B, A, [-0.8, 0.02, 0], 3, 0.3, 0.1, 0.04, C.body, { amp: 0.15 });
    wings(B, C, A, [0.35, 0.2, 0.38], 'bat', { c0: 1.5, s1: 1.35, s2: 2.5, fingers: 1, amp: 0.5, back: 1.3, sweep: -0.1, pteroFinger: true });
    A.speed = 2.6;
    return { back: [-0.15, 0.4, 0], backLen: 0.8, headPivot: h, mouth: [1.2, -0.15, 0] };
  },

  serpent(B, C, A, D) {
    // a long plumed serpent; the riders sit on its forward coils, which barely sway
    const h = headPivot(B, A, 2.35, 0.25);
    ell(h, C.body, 0, 0, 0, 0.5, 0.3, 0.34); ell(h, C.belly, 0.35, -0.12, 0, 0.32, 0.12, 0.24);
    spike(h, C.body, [0.3, 0.05, 0], [0.8, -0.05, 0], 0.2, 6);
    eyes(h, C, 0.22, 0.16, 0.2, 0.06, C.eyeGlow);
    for (const sd of [1, -1]) spike(h, C.horn, [0.65, -0.12, 0.08 * sd], [0.7, -0.3, 0.08 * sd], 0.035, 4);
    // the feathered ruff fanned about the head
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2, r = 0.95;
      spike(h, i % 2 ? C.wing : C.belly, [-0.2, Math.sin(a) * 0.2, Math.cos(a) * 0.2], [-0.45, Math.sin(a) * r, Math.cos(a) * r], 0.13, 4);
    }
    const n = 13, baseY = [];
    for (let i = 0; i < n; i++) baseY.push(i < 4 ? 0 : Math.sin(i * 0.8) * 0.28);
    const segs = chain(B, A, [2.05, 0.2, 0], n, 0.62, 0.42, 0.12, C.body, {
      amp: 0.22, speed: 1.8, lag: 0.75, ramp: 4, baseY, bends: [0, 0, 0.02, 0.02, 0, 0, 0, 0, 0, 0, 0],
      under: C.belly, each: (p, i, r) => { if (i % 2 === 0) spike(p, C.wing, [-0.3, r * 0.7, 0], [-0.6, r * 0.7 + 0.32, 0], 0.08, 4); },
    });
    const tip = segs[segs.length - 1];
    for (let i = -2; i <= 2; i++) spike(tip, i % 2 ? C.wing : C.belly, [0, 0, 0], [-1.0, 0, i * 0.28], 0.12, 4);
    wings(B, C, A, [1.3, 0.3, 0.32], 'feather', { c0: 1.2, s1: 1.25, s2: 1.8, fingers: 5, amp: 0.5, covert: C.bellyDS });
    A.speed = 2.6;
    void D;
    return { back: [0.55, 0.36, 0], backLen: 1.6, headPivot: h, mouth: [0.8, -0.05, 0], backW: 0.6, along: true, pilot: [1.75, 0.38, 0] };
  },

  fly(B, C, A) {
    // a bloated rot-fly: striped swollen abdomen, a hairy thorax, great red eyes, four buzzing wings
    ell(B, C.body, 0.35, 0.05, 0, 0.75, 0.6, 0.62);
    const ab = group(B, -0.4, -0.05, 0);
    ell(ab, C.belly, -0.8, 0, 0, 1.35, 0.85, 0.95);
    for (let i = 0; i < 4; i++) ell(ab, C.dark, -0.3 - i * 0.5, 0, 0, 0.12, 0.88 - Math.abs(i - 1.2) * 0.12, 0.96 - Math.abs(i - 1.2) * 0.12, true);
    for (let i = 0; i < 5; i++) ell(ab, C.blood, -0.5 - (i * 0.41) % 1.5, 0.4 + (i % 2) * 0.25, ((i * 0.37) % 0.9) - 0.45, 0.14, 0.08, 0.14, true); // sores
    const h = headPivot(B, A, 1.2, 0.0);
    ell(h, C.dark, 0, 0, 0, 0.35, 0.38, 0.42);
    const red = C.eyeRed || (C.eyeRed = mat(0x9a1a10, { roughness: 0.35 }));
    for (const sd of [1, -1]) ell(h, red, 0.12, 0.08, 0.3 * sd, 0.3, 0.35, 0.25);
    rod(h, C.dark, [0.3, -0.2, 0], [0.55, -0.6, 0], 0.07, 0.04, 5);
    for (const sd of [1, -1]) for (let i = 0; i < 3; i++) {
      const x = 0.7 - i * 0.4;
      rod(B, C.dark, [x, -0.35, 0.3 * sd], [x + 0.3 - i * 0.3, -0.75, 0.75 * sd], 0.05, 0.04, 4);
      rod(B, C.dark, [x + 0.3 - i * 0.3, -0.75, 0.75 * sd], [x + 0.2 - i * 0.4, -1.25, 0.8 * sd], 0.04, 0.02, 4);
    }
    // bristles
    for (let i = 0; i < 8; i++) spike(B, C.dark, [0.6 - i * 0.12, 0.55, ((i * 0.53) % 0.8) - 0.4], [0.5 - i * 0.12, 0.85, ((i * 0.53) % 0.8) - 0.4], 0.03, 3);
    const film = new THREE.MeshStandardMaterial({ color: C.wing.color.clone().lerp(new THREE.Color(0xffffff), 0.3), transparent: true, opacity: 0.5, side: THREE.DoubleSide, roughness: 0.3, depthWrite: false });
    wings(B, C, A, [0.35, 0.58, 0.2], 'insect', { len: 3.4, wd: 0.7, sw: -0.45, mat: film, amp: 0.45, base: 0.15, speedK: 1 });
    wings(B, C, A, [0.05, 0.55, 0.2], 'insect', { len: 2.9, wd: 0.6, sw: -0.9, mat: film, amp: 0.45, base: 0.05, phase: 1.3 });
    A.speed = 38; A.buzz = true;
    return { back: [0.25, 0.62, 0], backLen: 0.9, headPivot: h, mouth: [0.55, -0.6, 0], backW: 0.55 };
  },

  moth(B, C, A) {
    // a furry dusk-moth: plush body, feathered antennae, broad patterned wings in two pairs
    ell(B, C.body, 0.3, 0, 0, 0.7, 0.5, 0.5);
    ell(B, C.belly, 0.75, 0.05, 0, 0.42, 0.45, 0.52); // fur collar
    for (let i = 0; i < 5; i++) ell(B, i % 2 ? C.body : C.belly, -0.5 - i * 0.38, -0.08 - i * 0.03, 0, 0.32, 0.4 - i * 0.05, 0.42 - i * 0.06, true);
    const h = headPivot(B, A, 1.1, 0.05);
    ell(h, C.body, 0, 0, 0, 0.3, 0.3, 0.32);
    for (const sd of [1, -1]) ell(h, C.eye, 0.15, 0.05, 0.22 * sd, 0.14);
    for (const sd of [1, -1]) {
      const a0 = [0.15, 0.2, 0.12 * sd], a1 = [0.95, 1.15, 0.65 * sd];
      rod(h, C.dark, a0, a1, 0.03, 0.02, 4);
      plate(h, C.wingLight, [[0.15, 0.12 * sd], [0.95, 0.65 * sd], [0.8, 0.8 * sd], [0.45, 0.62 * sd]], 0.55).rotation.z = 0.8;
    }
    for (const sd of [1, -1]) for (let i = 0; i < 3; i++) rod(B, C.dark, [0.4 - i * 0.3, -0.35, 0.2 * sd], [0.5 - i * 0.4, -0.85, 0.5 * sd], 0.04, 0.03, 4);
    wings(B, C, A, [0.35, 0.3, 0.3], 'moth', { amp: 0.5, base: 0.15, mat: C.wing, mat2: C.wingLight });
    A.speed = 4.2;
    return { back: [0.25, 0.48, 0], backLen: 0.8, headPivot: h, mouth: [0.3, -0.1, 0], backW: 0.5, pilot: [0.85, 0.42, 0] };
  },

  daemon(B, C, A) {
    // a horned fiend flying low and forward, its riders clinging between its shoulders
    const tor = group(B, 0, 0, 0); tor.rotation.z = -1.1; // pitched forward
    ell(tor, C.body, 0, 0.2, 0, 0.55, 0.85, 0.7);
    ell(tor, C.belly, 0.25, 0.25, 0, 0.35, 0.65, 0.55);
    ell(tor, C.body, 0, 0.85, 0.55, 0.32); ell(tor, C.body, 0, 0.85, -0.55, 0.32); // shoulders
    ell(tor, C.body, 0, -0.45, 0, 0.45, 0.4, 0.5); // hips
    // legs trailing back, arms reaching forward with claws
    for (const sd of [1, -1]) {
      rod(tor, C.body, [0, -0.5, 0.3 * sd], [0.25, -1.3, 0.35 * sd], 0.22, 0.14);
      rod(tor, C.dark, [0.25, -1.3, 0.35 * sd], [-0.05, -2.0, 0.35 * sd], 0.13, 0.08);
      spike(tor, C.claw, [-0.05, -2.0, 0.35 * sd], [0.15, -2.25, 0.35 * sd], 0.1, 4);
      rod(tor, C.body, [0, 0.9, 0.62 * sd], [0.45, 1.3, 0.8 * sd], 0.18, 0.12);
      rod(tor, C.body, [0.45, 1.3, 0.8 * sd], [0.35, 1.95, 0.6 * sd], 0.12, 0.09);
      for (let i = 0; i < 3; i++) spike(tor, C.claw, [0.35, 1.95, 0.6 * sd + (i - 1) * 0.06], [0.45, 2.25, 0.6 * sd + (i - 1) * 0.1], 0.04, 4);
    }
    const h = headPivot(B, A, 1.05, 0.65);
    ell(h, C.body, 0, 0, 0, 0.32, 0.34, 0.3);
    spike(h, C.dark, [0.15, -0.15, 0], [0.42, -0.32, 0], 0.15, 5); // jaw
    eyes(h, C, 0.26, 0.05, 0.12, 0.05, C.eyeGlow);
    for (const sd of [1, -1]) {
      rod(h, C.horn, [-0.05, 0.25, 0.15 * sd], [-0.35, 0.65, 0.35 * sd], 0.1, 0.07);
      spike(h, C.horn, [-0.35, 0.65, 0.35 * sd], [-0.15, 1.05, 0.45 * sd], 0.07, 4);
    }
    chain(B, A, [-1.4, -0.8, 0], 6, 0.35, 0.1, 0.05, C.dark, { ang: PI + 0.15, amp: 0.35, speed: 2.2 });
    const segs = A.tails[A.tails.length - 1].segs; spike(segs[segs.length - 1], C.dark, [0.1, 0, 0], [-0.35, 0, 0], 0.15, 3);
    ridge(B, C.horn, [[0.2, 0.62], [-0.15, 0.48], [-0.5, 0.3]], 0.2, 0.07);
    wings(B, C, A, [0.15, 0.5, 0.55], 'bat', { c0: 1.5, s1: 1.45, s2: 2.4, fingers: 4, amp: 0.55, back: 1.0 });
    A.speed = 2.6;
    return { back: [-0.35, 0.62, 0], backLen: 0.8, headPivot: h, mouth: [0.4, -0.25, 0], pilot: [0.45, 0.62, 0], backW: 0.5 };
  },
};

function drake(B, C, A, o) {
  const k = o.k || 1;
  ell(B, C.body, 0, 0, 0, 1.25 * k, 0.52 * k, 0.58 * k);
  ell(B, C.belly, 0.15, -0.2 * k, 0, 1.05 * k, 0.35 * k, 0.45 * k);
  ell(B, C.body, 0.8 * k, 0.08, 0, 0.55 * k, 0.5 * k, 0.5 * k);
  // the neck: a curve of scaled segments up to the head
  const neck = [[1.15, 0.25], [1.45, 0.45], [1.75, 0.62], [2.0, 0.7]];
  neck.forEach(([x, y], i) => { ell(B, C.body, x * k, y * k, 0, 0.3 * k, 0.28 * k - i * 0.02, 0.26 * k - i * 0.02); ell(B, C.belly, x * k + 0.05, y * k - 0.14, 0, 0.24 * k, 0.16, 0.18); });
  const h = headPivot(B, A, 2.3 * k, 0.75 * k);
  ell(h, C.body, 0, 0, 0, 0.36, 0.26, 0.3);
  blk(h, C.body, 0.42, -0.06, 0, 0.55, 0.2, 0.3); // snout
  blk(h, C.belly, 0.35, -0.2, 0, 0.55, 0.08, 0.24); // jaw
  eyes(h, C, 0.15, 0.1, 0.2, 0.055, C.eyeGlow);
  for (const sd of [1, -1]) {
    rod(h, C.horn, [-0.1, 0.12, 0.15 * sd], [-0.55, 0.35, 0.25 * sd], 0.07, 0.03, 5);
    spike(h, C.horn, [0.0, -0.05, 0.25 * sd], [-0.3, -0.05, 0.42 * sd], 0.05, 4);
    if (o.tusks) rod(h, C.horn, [0.5, -0.22, 0.14 * sd], [0.72, 0.02, 0.2 * sd], 0.05, 0.02, 4);
  }
  ridge(B, C.dark, [[1.75 * k, 0.88 * k, 0, 0.6], [1.45 * k, 0.72 * k, 0, 0.7], [0.75 * k, 0.55 * k, 0, 0.9], [-0.95 * k, 0.45 * k], [-1.25 * k, 0.4 * k]], 0.28, 0.08);
  // tail: a long tapering chain with a spade
  const segs = chain(B, A, [-1.15 * k, 0.05, 0], 7, 0.48 * k, 0.3 * k, 0.07, C.body, { amp: 0.14, speed: 1.4, ang: PI + 0.08, under: C.belly,
    each: (p, i) => { if (i % 2) spike(p, C.dark, [-0.2, 0.18 - i * 0.015, 0], [-0.32, 0.38 - i * 0.03, 0], 0.06, 4); } });
  plate(segs[segs.length - 1], C.wing, [[0.1, 0], [-0.2, 0.35], [-0.7, 0], [-0.2, -0.35]]);
  // legs: hind legs tucked, forelegs (dragons) clutching forward
  legPair(B, C.body, C.claw, [-0.75 * k, -0.25, 0.4 * k], [-0.95 * k, -0.65, 0.42 * k], [-1.35 * k, -0.75, 0.4 * k], 0.17 * k, C.claw, true);
  if (o.legs === 4) legPair(B, C.body, C.claw, [0.85 * k, -0.25, 0.35 * k], [1.15 * k, -0.6, 0.35 * k], [1.4 * k, -0.62, 0.3 * k], 0.12 * k, C.claw, true);
  wings(B, C, A, [0.35 * k, 0.35 * k, 0.45 * k], 'bat', { c0: 1.55 * k, s1: 1.4, s2: 2.35, fingers: 4, amp: 0.5, back: 0.95 });
  A.speed = 2.4;
  return { back: [-0.2, 0.5 * k, 0], backLen: 1.1, headPivot: h, mouth: [0.72, -0.12, 0] };
}

// ---------- tack and riders ----------
/** a saddle (2 riders) or howdah (3+) on the back; returns the crew standing places */
function saddle(B, C, A, back, n, w, howdah) {
  const [x, y] = back, slots = [];
  const big = howdah || n >= 3;
  const len = big ? 0.5 + Math.ceil(n / 2) * 0.42 : 0.5 + n * 0.42;
  // saddle-cloth in the side's colour, hanging down both flanks
  const cloth = group(B, x, y, 0);
  blk(cloth, C.side, 0, -0.02, 0, len + 0.2, 0.06, w * 2 + 0.25);
  for (const sd of [1, -1]) { const f = blk(cloth, C.side, 0, -0.25, sd * (w + 0.12), len + 0.1, 0.5, 0.05); f.rotation.x = -0.25 * sd; blk(cloth, C.brass, 0, -0.5, sd * (w + 0.18), len + 0.1, 0.05, 0.06).rotation.x = -0.25 * sd; }
  for (const sd of [1, -1]) rod(cloth, C.leather, [0.1, 0, sd * (w + 0.1)], [0.1, -0.75, sd * (w * 0.6)], 0.035, 0.035, 4); // girth
  if (big) {
    // howdah: a railed wooden platform
    const W = Math.min(1.0, w + 0.25), deckY = 0.16;
    blk(cloth, C.wood, 0, deckY - 0.06, 0, len, 0.12, W * 2);
    for (const sd of [1, -1]) {
      blk(cloth, C.wood, 0, deckY + 0.22, sd * W, len, 0.06, 0.06);
      for (let i = 0; i <= 3; i++) blk(cloth, C.wood, -len / 2 + (i / 3) * len, deckY + 0.1, sd * W, 0.06, 0.24, 0.06);
      blk(cloth, C.side, 0, deckY + 0.05, sd * (W + 0.02), len - 0.05, 0.18, 0.03);
    }
    for (const sx of [-1, 1]) blk(cloth, C.wood, sx * len / 2, deckY + 0.22, 0, 0.06, 0.06, W * 2);
    // a pennant at the back
    rod(cloth, C.wood, [-len / 2, deckY, -W], [-len / 2, deckY + 1.1, -W], 0.03, 0.03, 4);
    blk(cloth, C.side, -len / 2 - 0.25, deckY + 0.95, -W, 0.5, 0.28, 0.02);
    const cols = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const c = Math.floor(i / 2), r = n === 3 && i === 2 ? 0 : i % 2 ? -1 : 1;
      slots.push([x + (cols === 1 ? 0 : (c / (cols - 1) - 0.5) * (len - 0.4)), y + deckY, r * W * 0.5]);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const sx = (n === 1 ? 0 : (i / (n - 1) - 0.5) * (len - 0.45));
      blk(cloth, C.leather, sx, 0.06, 0, 0.36, 0.1, 0.4);
      blk(cloth, C.leather, sx - 0.17, 0.16, 0, 0.06, 0.2, 0.36);
      blk(cloth, C.brass, sx + 0.17, 0.14, 0, 0.05, 0.14, 0.08);
      slots.push([x + sx, y + 0.11, 0]);
    }
    // a lance-pennon on the rear seat
    rod(cloth, C.wood, [-len / 2 + 0.1, 0.1, 0.25], [-len / 2 - 0.2, 1.25, 0.3], 0.025, 0.025, 4);
    blk(cloth, C.side, -len / 2 - 0.45, 1.12, 0.31, 0.4, 0.22, 0.02).rotation.z = 0.25;
  }
  void A;
  return { slots, len };
}
/** the pilot, seated at the neck with the reins */
function pilot(B, C, at, reins) {
  const [x, y, z] = at, g = group(B, x, y, z);
  blk(g, C.leather, 0, 0.04, 0, 0.3, 0.08, 0.36);
  blk(g, C.side, -0.02, 0.25, 0, 0.2, 0.3, 0.26); // tabard
  for (const sd of [1, -1]) rod(g, C.sideDark, [0, 0.12, 0.1 * sd], [0.16, -0.02, 0.2 * sd], 0.05, 0.04, 4); // legs astride
  ell(g, C.skin, 0, 0.48, 0, 0.09);
  ell(g, C.iron, -0.01, 0.53, 0, 0.1, 0.07, 0.1);
  for (const sd of [1, -1]) rod(g, C.sideDark, [0, 0.33, 0.12 * sd], [0.2, 0.2, 0.12 * sd], 0.035, 0.03, 4);
  if (reins) for (const sd of [1, -1]) rod(B, C.leather, [x + 0.2, y + 0.2, 0.12 * sd], [reins[0], reins[1], 0.1 * sd], 0.012, 0.012, 3);
}
/** arrows and gashes that show once badly hurt */
function wounds(B, C, A, info) {
  const g = group(B); g.visible = false; A.hide2.push(g);
  const [x, y] = info.back;
  for (let i = 0; i < 6; i++) {
    const px = x + 0.6 - i * 0.35, sd = i % 2 ? 1 : -1, py = y - 0.15 - (i % 3) * 0.12, pz = sd * 0.42;
    ell(g, C.blood, px, py, pz, 0.12, 0.08, 0.04, true);
    rod(g, C.wood, [px, py, pz], [px - 0.25, py + 0.3, pz + sd * 0.35], 0.015, 0.015, 3);
  }
}
void SPH; void CONE; void mesh; void add; void noCrew;
