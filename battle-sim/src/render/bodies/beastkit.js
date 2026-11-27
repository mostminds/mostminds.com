// Shared animal-building code for beasts.js: a parametric four-legged animal (torso from stations, three kinds of
// leg, two families of head, tails, coats and trappings), the quadruped kinds built from it, and the extra mounts.
//
//   makeKit(K) -> { quad(def, o) | null, mount(def, o) | null, rotify(...) }
//
// K is the set of helpers beasts.js already owns (node / finish / bone / lay / fur locks / feathers / riders / the
// horse and griffon builders), handed over once so this file needs nothing back from beasts.js at import time.
// Conventions are the ones beasts.js documents: one authoring space per animal (Y up, facing +Z, feet on y = 0),
// heads and jaws in their own frame (skull joint at the origin, muzzle along +Z), legs = [FL, FR, BL, BR].
// Every animal is authored at a convenient size and scaled by finish() to the height asked for.
import * as THREE from 'three';
import { S, H, distanceField } from '../sculpt.js';

const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const norm3 = (a) => mul3(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1e-9));
const mirX = (v) => [-v[0], v[1], v[2]];
const put = (arr, ...qs) => { for (const q of qs.flat(Infinity)) if (q) arr.push(q); return arr; };
const hexOf = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const LEATHER = 0x5a3a22, LEATHER_DARK = 0x3a2616, IRON = 0x6c7078, BRASS = 0xc9a23e, BONE = 0xe4d9bc, ROPE = 0xa98f5c, WOOD = 0x7a5a36, WOOD_DARK = 0x4e3820;

export function makeKit(K) {
  const { node, finish, bone, lay, tone, mix, spike, lock, eye, feather, surfHit, gradAt, strap, rivets, ringAt, drape, gridLines, rng, hashStr, mirrorAll, orient, flat, feet,
    makeRider, seatRider, riderToMount, buildHorse, horseTack, buildGriffon, griffonWing, proportions } = K;

  // =====================================================================================
  //  context: palette, surface styles, flags
  // =====================================================================================
  function mk(def, o, id, base, opt = {}) {
    const statue = !!o.stone && !opt.rocky, rocky = !!o.stone && !!opt.rocky, rot = !!o.rot;
    let fur = base;
    if (rot) fur = mix(tone(base, 0, -0.2, -0.03), 0x58604a, 0.32);
    const glow = hexOf(o.glow, null);
    const C = {
      fur, back: tone(fur, 0, -0.02, -0.1), dark: tone(fur, 0, -0.04, -0.2), flank: tone(fur, 0, 0, 0.05),
      belly: mix(tone(fur, 0, -0.03, 0.13), 0xd9ccb4, opt.belly ?? 0.35), pale: mix(tone(fur, 0, -0.04, 0.18), 0xe2d8c2, opt.pale ?? 0.45),
      leg: fur, sock: fur, muzzle: tone(fur, 0, -0.03, -0.08), mane: tone(fur, -0.01, 0, -0.2), point: tone(fur, 0, -0.05, -0.28),
      nose: 0x16110f, lip: 0x1e1616, mouth: 0x5c1a22, tongue: 0xd0606c, tooth: 0xf0e7cc, claw: 0x1e1a17, hoof: 0x2a221c, horn: 0xdccfae, hornDark: 0x4a3c2c,
      earIn: mix(fur, 0x8a5a58, 0.5), pad: 0x2a2220, skin: 0xc79a90,
      eye: { iris: 0xffb62a, rim: 0x8a5208, glow: 0.3 },
      ...(opt.C ? opt.C(fur) : {}),
    };
    if (rot) { C.eye = { iris: 0xdff2d8, rim: 0x8aa890, white: 0x30382e, glow: 0.8, pupilSize: 0.35 }; C.belly = mix(C.belly, 0x6a7058, 0.5); C.pale = mix(C.pale, 0x7a8068, 0.4); C.tongue = 0x6a5a6a; }
    if (glow !== null) C.eye = { iris: glow, rim: tone(glow, 0, 0, -0.25), white: 0x0c1418, glow: 1 };
    if (statue) {
      for (const k of Object.keys(C)) if (typeof C[k] === 'number') C[k] = mix(base, C[k], 0.1);
      C.eye = { iris: tone(base, 0, 0.05, 0.14), rim: tone(base, 0, 0, -0.12), white: tone(base, 0, 0, -0.2), pupil: tone(base, 0, 0, -0.3), glow: 0 };
    }
    const M = (col, amp = 0.006, f = 30, kind = 'fur', rough = 0.88) => (statue ? (q) => q.color(col).tint(0.06, 5).pbr(0.2, 0)
      : rocky ? (q) => q.color(col).tint(0.26, 9).bump(Math.max(amp, 0.01), 11, 'rock').pbr(0.96)
        : (q) => q.color(col).tint(0.2, 18).bump(amp, f, kind).pbr(rough));
    const s = opt.s ?? 1;
    return {
      def, o, id, C, M, rnd: rng(hashStr((def?.id || id) + ':' + id)), nodes: [node('root', null, [0, 0, 0])], statue, rocky, rot, glow,
      Kk: opt.keys || { body: 'torso', neck: 'neck', head: 'head', jaw: 'jaw' }, mounted: !!opt.keys,
      D: (opt.detail ?? 0.8) * Math.min(1, Math.pow(1 / s, 0.75)),
      /** colour laid over the coat (no shape): skipped on a statue, which is one polished stone */
      ink: (q, col, soft = 0.02, raise = 0) => (statue ? null : q.color(col).pbr(rocky ? 0.96 : 0.88).paint(soft, raise)),
      lk: (...a) => (statue ? null : lock(...a)),
      get: (name) => null,
    };
  }
  const horn = (pts, r0, r1, col, n = 10, radial = 8) => H.tube(pts, [r0, lerp(r0, r1, 0.45), lerp(r0, r1, 0.8), r1], n, radial).color(col).pbr(0.4, 0);
  const metal = (col, rough = 0.36) => (q) => q.color(col).tint(0.08, 30).pbr(rough, 1);

  // =====================================================================================
  //  heads
  // =====================================================================================
  /** an ear in its own frame (base at the origin, tip along +Y, opening toward +Z) */
  function earOf(ctx, type, col, inCol) {
    const f = ctx.M(col, 0.004, 56);
    if (type === 'round') return [f(S.ellipsoid(0.034, 0.036, 0.017).at(0, 0.012, 0)), S.ellipsoid(0.022, 0.024, 0.012).at(0, 0.014, 0.014).cut(0.004).color(inCol)];
    if (type === 'drop') return [f(S.ellipsoid(0.036, 0.062, 0.013).at(0, -0.048, 0)), f(S.ellipsoid(0.03, 0.018, 0.016).blend(0.012))];
    if (type === 'leaf') return [f(S.ellipsoid(0.03, 0.062, 0.012).at(0, 0.05, 0)), S.ellipsoid(0.018, 0.046, 0.012).at(0, 0.05, 0.012).cut(0.004).color(inCol)];
    return [   // 'prick'
      f(S.capsule([0, 0, 0], [0, 0.082, -0.004], 0.034, 0.006)), f(S.ellipsoid(0.032, 0.026, 0.024).at(0, -0.004, -0.006).blend(0.012)),
      S.ellipsoid(0.026, 0.06, 0.026).at(0, 0.03, 0.03).cut(0.005).color(inCol), S.ellipsoid(0.03, 0.07, 0.03).at(0, 0.03, -0.043).cut(0.004),
    ];
  }
  function placeEars(ctx, p, e, col, inCol) {
    if (!e) return;
    const one = earOf(ctx, e.type, e.col ?? col, e.inCol ?? inCol).map((q) => q.scale(e.s ?? 1).rot(...(e.rot ?? [-10, 22, -24])).at(...e.at));
    put(p, one, mirrorAll(one));
  }
  function eyes(ctx, p, hard, ex, ey, ez, er, yaw, look = {}) {
    const E = { ...ctx.C.eye, ...look };
    put(p, S.mirrorX([
      S.ellipsoid(er * 1.25, er * 0.9, er * 0.93).rot(0, yaw * 0.9, -14).at(ex + er * 0.23, ey, ez + er * 0.5).cut(0.005).color(ctx.statue ? E.white : 0x0b0908),
      S.sphere(er * 0.95).at(ex, ey, ez).color(E.iris).glow((E.glow || 0) * 0.8).pbr(0.3).blend(0),
    ]));
    put(hard, H.mirrorX([eye(er, { pupilSize: 0.75, irisSize: 1.45, ...E }).rot(-4, yaw, 0).at(ex, ey, ez).lod(1)]),
      H.mirrorX([H.sphere(er * 0.98, 10).at(ex + er * 0.1, ey, ez + er * 0.1).color(E.iris).glow(E.glow || 0).pbr(0.3).from(2)]));
  }

  /**
   * A flesh-eater's head and lower jaw (wolf-like by default; the numbers are the wolf's). q overrides:
   *   cr [rx, ry, rz] cranium, cc [y, z] its centre, m0 / m1 [y, z] the muzzle's root and tip, mr [r0, r1],
   *   ex ey ez er eyaw, ears { type, s, rot, at }, fang, col / mzCol / jawCol, cheek, nose, s (overall scale), extra(parts)
   */
  function carnHead(ctx, q = {}) {
    const { C, M } = ctx, p = [], hard = [], jp = [], jhard = [];
    const cr = q.cr ?? [0.08, 0.068, 0.088], cc = q.cc ?? [0.03, 0.05], m0 = q.m0 ?? [0.006, 0.115], m1 = q.m1 ?? [-0.004, 0.262], mr = q.mr ?? [0.049, 0.034];
    const col = q.col ?? C.fur, fur = M(col, 0.0055, 52), mz = M(q.mzCol ?? C.muzzle, 0.003, 60), pale = M(q.padCol ?? C.pale, 0.004, 56);
    const ex = q.ex ?? 0.0465, ey = q.ey ?? 0.046, ez = q.ez ?? 0.107, er = q.er ?? 0.0172, ms = mr[1] / 0.034, len = m1[1] - m0[1];
    const gum = q.gum ?? m1[0] - mr[1] * 0.72, tipZ = m1[1] + mr[1] * 0.8;
    put(p, fur(lay(cr[0], cr[1], cr[2]).at(0, cc[0], cc[1])),
      fur(S.sphere(Math.min(cr[0], cr[1] * 1.15) * 0.97).at(0, cc[0] - cr[1] * 0.3, cc[1] - cr[2] * 0.7).blend(0.03)),
      fur(lay(cr[0] * 0.68, cr[1] * 0.56, cr[2] * 0.8).rot(12, 0, 0).at(0, cc[0] + cr[1] * 0.15, cc[1] + cr[2] * 0.74).blend(0.03)),
      mz(bone([0, m0[0], m0[1]], [0, m1[0], m1[1]], mr[0], mr[1]).blend(0.03)),
      mz(lay(mr[1] * 0.9, mr[1] * 0.6, len * 0.5).at(0, lerp(m0[0], m1[0], 0.6) + mr[1] * 0.62, lerp(m0[1], m1[1], 0.58)).blend(0.02)),
      S.mirrorX([
        fur(lay(cr[0] * 0.45 * (q.cheek ?? 1), cr[1] * 0.62, cr[2] * 0.61).at(cr[0] * 0.75, cc[0] - cr[1] * 0.41, cc[1] + cr[2] * 0.09).blend(0.03)),
        pale(S.ellipsoid(mr[1] * 0.65, mr[1] * 0.7, mr[1] * 1.24).at(mr[1] * 0.82, m1[0] - mr[1] * 0.24, m1[1] - mr[1] * 0.88).blend(0.014)),
        fur(S.ellipsoid(cr[0] * 0.375, cr[1] * 0.19, cr[2] * 0.25).rot(0, -22, -24).at(ex * 0.95, ey + er * 1.6, ez - 0.004).blend(0.014)),
      ]),
      S.box(mr[0] * 1.72, 0.05, tipZ - m0[1] + 0.045, 0.012).at(0, gum - 0.025, (tipZ + m0[1] - 0.045) / 2).cut(0.006).color(C.mouth));
    const ns = (q.nose ?? 1) * mr[1], nz = m1[1] + mr[1] * 0.82, ny = m1[0] + mr[1] * 0.3;
    put(p, S.ellipsoid(ns * 0.74, ns * 0.62, ns * 0.62).at(0, ny, nz).color(q.noseCol ?? C.nose).pbr(0.3).blend(0.007),
      S.mirrorX([S.ellipsoid(ns * 0.19, ns * 0.16, ns * 0.26).rot(0, 20, 0).at(ns * 0.35, ny - ns * 0.03, nz + ns * 0.5).cut(0.003).color(0x050404)]),
      S.box(0.003 * ms, ns * 0.6, ns * 0.35, 0.001).at(0, ny - ns * 0.42, nz + ns * 0.44).cut(0.002).color(0x050404));
    eyes(ctx, p, hard, ex, ey, ez, er, q.eyaw ?? 32, q.look);
    put(p, S.mirrorX([ctx.ink(S.ellipsoid(mr[1] * 0.24, mr[1] * 0.47, len * 0.6), C.lip, 0.004)?.at(mr[0] * 0.98, gum + 0.002, lerp(m0[1], m1[1], 0.5))]));
    placeEars(ctx, p, q.ears ?? { type: 'prick', at: [0.05, 0.082, 0.014] }, col, C.earIn);
    // upper teeth
    const T = C.tooth, fang = q.fang ?? 0.048 * ms;
    for (const sx of [1, -1]) {
      hard.push(spike([sx * mr[1] * 0.81, gum, m1[1] - 0.03 * ms], [sx * 0.08, -1, 0.1], fang, Math.max(0.009 * ms, fang * 0.17), T, [0, 0, -1], 0.3));
      if (q.incisors !== false) for (let i = 0; i < 3; i++) hard.push(spike([sx * (0.006 + i * 0.0075) * ms, gum, m1[1] + (0.002 - i * 0.004) * ms], [0, -1, 0.1], 0.012 * ms, 0.0036 * ms, T, [0, 0, -1], 0.1).lod(1));
      for (let i = 0; i < 3; i++) hard.push(spike([sx * (0.031 + i * 0.0022) * ms, gum, m1[1] - 0.03 * ms - (i + 1) * len * 0.17], [sx * 0.08, -1, 0], 0.016 * ms, 0.0065 * ms, T, [0, 0, -1], 0.15, 0.6).lod(1));
    }
    // lower jaw
    const hinge = q.hinge ?? [0, cc[0] - 0.044, cc[1]], jf = M(q.jawCol ?? C.pale, 0.004, 56);
    put(jp, S.mirrorX([jf(bone([cr[0] * 0.475, hinge[1] - 0.006, hinge[2]], [mr[1] * 0.62, gum - 0.02, m1[1] - 0.062 * ms], mr[1] * 0.6, mr[1] * 0.48))]),
      jf(lay(mr[1] * 0.74, mr[1] * 0.44, mr[1] * 0.88).at(0, gum - 0.0215, m1[1] - 0.036 * ms).blend(0.012)),
      jf(lay(mr[1] * 0.94, mr[1] * 0.38, len * 0.545).at(0, gum - 0.0255, m0[1] + len * 0.17).blend(0.012)),
      S.box(mr[1] * 1.12, 0.02, len * 1.15, 0.006).at(0, gum - 0.0015, m0[1] + len * 0.27).cut(0.005).color(C.mouth),
      S.ellipsoid(mr[1] * 0.46, 0.007, len * 0.45).rot(-4, 0, 0).at(0, gum - 0.0095, m0[1] + len * 0.36).color(C.tongue).pbr(0.4).blend(0.003));
    for (const sx of [1, -1]) {
      jhard.push(spike([sx * mr[1] * 0.62, gum - 0.0115, m1[1] - 0.018 * ms], [sx * 0.1, 1, 0.06], fang * 0.75, Math.max(0.0075 * ms, fang * 0.14), T, [0, 0, -1], 0.25));
      for (let i = 0; i < 3; i++) jhard.push(spike([sx * (0.024 + i * 0.0026) * ms, gum - 0.0095, m1[1] - 0.05 * ms - i * len * 0.18], [sx * 0.05, 1, 0], 0.012 * ms, 0.005 * ms, T, [0, 0, -1], 0.1, 0.6).lod(1));
    }
    const parts = { p, hard, jp, jhard, hinge, gum, m0, m1, mr, cr, cc, ex, ey, ez, er, ms, len };
    if (q.extra) q.extra(parts);
    return scaleHead(parts, q.s ?? 1);
  }
  function scaleHead(parts, s) {
    if (s !== 1) {
      for (const k of ['p', 'hard', 'jp', 'jhard']) if (parts[k]) { parts[k] = flat(parts[k]); for (const x of parts[k]) x.scale(s); }
      if (parts.hinge) parts.hinge = mul3(parts.hinge, s);
    }
    return parts;
  }

  /**
   * A grazer's long head (the horse's, generalised): poll at the origin, face along +Z, jaw on the -Y side. q:
   *   len (face length), w / d (width, depth), mw (muzzle), ears { type, s, rot, at }, col, mzCol, eyeR, s, extra(parts)
   */
  function ungHead(ctx, q = {}) {
    const { C, M } = ctx, p = [], hard = [];
    const L = q.len ?? 0.3, w = q.w ?? 1, d = q.d ?? 1, mw = q.mw ?? 1, f = L / 0.3;
    const col = q.col ?? C.fur, coat = M(col, q.amp ?? 0.002, q.f ?? 30), mz = M(q.mzCol ?? C.muzzle, 0.0015, 30);
    put(p, coat(lay(0.064 * w, 0.062 * d, 0.078).at(0, 0, 0.035)), coat(S.sphere(0.058 * Math.min(w, d)).at(0, -0.01, -0.01).blend(0.03)),
      coat(bone([0, 0.012 * d, 0.06], [0, 0.004 * d, L], 0.053 * w, 0.037 * w * mw).blend(0.03)),
      coat(bone([0, -0.085 * d, 0.07], [0, -0.05 * d, L], 0.045 * w, 0.03 * w * mw).blend(0.03)),
      S.mirrorX([
        coat(S.ellipsoid(0.034 * w, 0.078 * d, 0.086).at(0.037 * w, -0.07 * d, 0.072).blend(0.025)),
        coat(S.ellipsoid(0.02, 0.016, 0.03).rot(0, 0, -20).at(0.05 * w, 0.022 * d, 0.1).blend(0.012)),
        coat(S.ellipsoid(0.012, 0.01, 0.07 * f).at(0.04 * w, -0.008, 0.2 * f).blend(0.012)),
      ]),
      mz(lay(0.046 * w * mw, 0.05 * d * mw, 0.052).at(0, -0.016 * d, L + 0.028).blend(0.03)),
      mz(S.ellipsoid(0.03 * w * mw, 0.024 * d, 0.032).at(0, -0.06 * d, L + 0.032).blend(0.016)),
      S.mirrorX([
        mz(S.ellipsoid(0.018, 0.022, 0.02).rot(0, 20, 0).at(0.03 * w * mw, 0, L + 0.052).blend(0.01)),
        S.ellipsoid(0.009, 0.014, 0.012).rot(0, 20, 20).at(0.036 * w * mw, 0.002, L + 0.064).cut(0.004).color(0x0a0707),
      ]),
      ctx.ink(S.ellipsoid(0.06 * w * mw, 0.0045, 0.06), 0x120c0b, 0.003, -0.003)?.at(0, -0.04 * d, L + 0.025));
    const ex = 0.0535 * w, ey = 0.004, ez = 0.108, er = q.eyeR ?? 0.0165;
    const E = ctx.rot || ctx.glow !== null || ctx.statue ? ctx.C.eye : { iris: 0x4a2a14, rim: 0x1a0d06, white: 0x1a0f0a, glow: 0, ...(q.look || {}) };
    put(p, S.mirrorX([S.ellipsoid(er * 0.85, er * 0.82, er * 1.15).at(ex + er * 0.5, ey, ez).cut(0.005).color(ctx.statue ? E.white : 0x120b08), S.sphere(er * 0.94).at(ex, ey, ez).color(E.iris).glow((E.glow || 0) * 0.8).pbr(0.15).blend(0)]));
    put(hard, H.mirrorX([eye(er, { pupilSize: 1.6, irisSize: 1.5, ...E }).rot(0, 78, 0).at(ex, ey, ez).lod(1)]));
    if (E.glow) put(hard, H.mirrorX([H.sphere(er, 10).at(ex + er * 0.15, ey, ez).color(E.iris).glow(E.glow).pbr(0.3).from(2)]));
    placeEars(ctx, p, q.ears ?? { type: 'leaf', rot: [-62, 14, -16], at: [0.04 * w, 0.04 * d, -0.012] }, col, tone(col, 0, -0.05, -0.16));
    const parts = { p, hard, L, w, d, mw, ex, ey, ez };
    if (q.extra) q.extra(parts);
    return scaleHead(parts, q.s ?? 1);
  }

  // =====================================================================================
  //  torso, neck, legs, tail
  // =====================================================================================
  /**
   * g.o pivot, g.st = [[z, y, rx, ry, rz, col?, tilt?], ...] ellipsoid stations (the first is the rib cage),
   * g.nk / g.tl = [a, b, r0, r1] roots of neck and tail, g.sh / g.hp = [x, y, z, size] shoulder and haunch muscles.
   */
  function torsoOf(ctx, g) {
    const { C, M } = ctx, amp = g.amp ?? 0.007, f = g.f ?? 34, fur = M(C.fur, amp, f);
    const torso = node('torso', 'root', g.o, { rig: ctx.Kk.body, detail: (g.detail ?? 0.8) * ctx.D });
    ctx.nodes.push(torso);
    const p = torso.prims;
    g.st.forEach((s, i) => p.push(M(s[5] ?? C.fur, amp, f)(lay(s[2], s[3], s[4]).rot(s[6] ?? 0, 0, 0).at(0, s[1], s[0]).blend(i ? 0.055 : 0.025))));
    if (g.nk) p.push(fur(bone(g.nk[0], g.nk[1], g.nk[2], g.nk[3]).blend(0.05)));
    if (g.tl) p.push(fur(bone(g.tl[0], g.tl[1], g.tl[2], g.tl[3]).blend(0.04)));
    const sh = g.sh, hp = g.hp;
    if (sh) put(p, S.mirrorX([fur(S.ellipsoid(0.054 * sh[3], 0.104 * sh[3], 0.082 * sh[3]).rot(-14, 0, -8).at(sh[0], sh[1], sh[2]).blend(0.03))]));
    if (hp) put(p, S.mirrorX([fur(S.ellipsoid(0.05 * hp[3], 0.1 * hp[3], 0.1 * hp[3]).rot(20, 0, -6).at(hp[0], hp[1], hp[2]).blend(0.035))]));
    let top = -1e9, bot = 1e9, z0 = 1e9, z1 = -1e9, wd = 0;
    for (const s of g.st) { top = Math.max(top, s[1] + s[3]); bot = Math.min(bot, s[1] - s[3]); z0 = Math.min(z0, s[0] - s[4]); z1 = Math.max(z1, s[0] + s[4]); wd = Math.max(wd, s[2]); }
    const hgt = top - bot, zm = (z0 + z1) / 2, ln = z1 - z0;
    if (g.back !== false) put(p, ctx.ink(lay(wd * 0.62, hgt * 0.3, ln * 0.56), g.backCol ?? C.back, 0.05)?.tint(0.2, 16).at(0, top - hgt * 0.04, zm - ln * 0.03));
    if (g.belly !== false) put(p, ctx.ink(lay(wd * 0.72, hgt * 0.26, ln * 0.46), C.belly, 0.05)?.tint(0.15, 20).at(0, bot + hgt * 0.02, zm));
    torso.box = { top, bot, z0, z1, wd };
    return torso;
  }
  function neckOf(ctx, NB, HJ, r0, r1, g = {}) {
    const { C, M } = ctx, fur = M(g.col ?? C.fur, g.amp ?? 0.007, g.f ?? 34), ax = norm3(sub3(HJ, NB));
    const neck = node('neck', 'torso', NB, { rig: ctx.Kk.neck, detail: (g.detail ?? 0.8) * ctx.D });
    ctx.nodes.push(neck);
    put(neck.prims, fur(bone(add3(NB, mul3(ax, -r0 * 0.25)), HJ, r0, r1)), fur(S.sphere(r0 * 0.96).at(NB[0], NB[1] - r0 * 0.1, NB[2] - r0 * 0.08).blend(0.04)));
    if (g.throat !== false) put(neck.prims, ctx.ink(bone(add3(NB, [0, -r0 * 0.8, r0 * 0.5]), add3(HJ, [0, -r1 * 0.9, r1 * 0.3]), r0 * 0.6, r1 * 0.65), g.throatCol ?? C.pale, 0.04)?.tint(0.16, 26));
    if (g.nape !== false) put(neck.prims, ctx.ink(bone(add3(NB, [0, r0 * 0.75, -r0 * 0.2]), add3(HJ, [0, r1 * 0.85, -r1 * 0.3]), r0 * 0.55, r1 * 0.6), g.napeCol ?? C.back, 0.035)?.tint(0.2, 26));
    neck.ax = ax;
    return neck;
  }
  function headNode(ctx, neck, NB, HJ, pitch, hd, det = 1.3, jawRot = 7) {
    const head = node('head', 'neck', [0, 0, 0], { rig: ctx.Kk.head, pos: sub3(HJ, NB), rot: [pitch, 0, 0], detail: det * ctx.D });
    head.prims = hd.p; head.hard = hd.hard; ctx.nodes.push(head);
    if (hd.jp && hd.jp.length) {
      const jaw = node('jaw', 'head', hd.hinge, { rig: ctx.Kk.jaw, pos: hd.hinge, rot: [jawRot, 0, 0], detail: det * 0.95 * ctx.D });
      jaw.prims = hd.jp; jaw.hard = hd.jhard; ctx.nodes.push(jaw);
    }
    return head;
  }
  function addLegs(ctx, L, det = 1, par = 'torso') {
    for (const [nm, part, side, js] of [['FL', L.fl, 1, L.JF], ['FR', L.fl, -1, L.JF], ['BL', L.bl, 1, L.JB], ['BR', L.bl, -1, L.JB]]) {
      if (!part) continue;
      const cp = (list) => (side > 0 ? flat(list).map((q) => q.clone()) : mirrorAll(list)), m = (v) => (side > 0 ? v : mirX(v));
      const up = node(`leg${nm}`, par, m(js[0]), { rig: 'legs', detail: 0.8 * det * ctx.D, minRes: 16 });
      const lo = node(`shin${nm}`, `leg${nm}`, m(js[1]), { rig: 'shins', detail: 0.88 * det * ctx.D, minRes: 19 });
      const pw = node(`paw${nm}`, `shin${nm}`, m(js[2]), { rig: 'paws', detail: 0.95 * det * ctx.D, minRes: 18 });
      up.prims = cp(part.up.prims); up.hard = cp(part.up.hard); lo.prims = cp(part.lo.prims); lo.hard = cp(part.lo.hard); pw.prims = cp(part.paw.prims); pw.hard = cp(part.paw.hard);
      ctx.nodes.push(up, lo, pw);
    }
  }
  const legParts = () => ({ up: { prims: [], hard: [] }, lo: { prims: [], hard: [] }, paw: { prims: [], hard: [] } });

  /** clawed, toe-walking legs (the wolf's, scaled): g = { H shoulder joint height, zf, zb, lx, k upper / kl lower thickness, toe, claw } */
  function pawLegs(ctx, g) {
    const { C, M } = ctx, { H: Hh, zf, zb, lx, k = 1, kl = k, toe = 1 } = g, u = Hh / 0.5;
    const fur = M(g.col ?? C.fur, 0.006, 40), leg = M(g.legCol ?? C.leg, 0.005, 54), sock = M(g.sockCol ?? C.sock, 0.004, 58);
    const SH = [lx, Hh, zf], EL = [lx + 0.015 * u, 0.686 * Hh, zf - 0.053 * u], CA = [lx + 0.015 * u, 0.28 * Hh, zf - 0.025 * u];
    const HP = [lx - 0.01 * u, Hh, zb], ST = [lx + 0.02 * u, 0.67 * Hh, zb + 0.095 * u], HK = [lx + 0.015 * u, 0.344 * Hh, zb - 0.075 * u];
    const r = (v) => v * u * k, rl = (v) => v * u * kl, pr = u * kl * toe, cl = g.claw ?? 1;
    const toes = (part, c) => {
      for (let i = 0; i < 4; i++) {
        const a = (i - 1.5) * 0.3, dx = Math.sin(a), dz = Math.cos(a), mid = i === 1 || i === 2;
        const t = [c[0] + (dx * 0.02 + (i - 1.5) * 0.016) * pr, 0.022 * pr, c[2] + dz * (mid ? 0.052 : 0.038) * pr];
        part.prims.push(sock(S.ellipsoid(0.0165 * pr, 0.02 * pr, 0.027 * pr).rot(0, a / DEG, 0).at(t[0], t[1], t[2]).blend(0.007)));
        part.hard.push(spike([t[0] + dx * 0.016 * pr, 0.025 * pr, t[2] + dz * 0.019 * pr], [dx * 0.8, -0.5, dz], 0.021 * pr * cl, 0.0075 * pr * Math.sqrt(cl), C.claw, [0, -1, 0], 0.4).lod(1));
      }
    };
    const fl = legParts(), bl = legParts();
    {
      const px = CA[0], pz = CA[2];
      put(fl.up.prims, fur(bone([lx + 0.005 * u, Hh, zf + 0.01 * u], EL, r(0.072), r(0.056))),
        fur(S.ellipsoid(r(0.06), 0.094 * u, r(0.078)).rot(-18, 0, -4).at(lx + 0.013 * u, 0.9 * Hh, zf - 0.012 * u).blend(0.03)),
        fur(S.ellipsoid(r(0.048), 0.066 * u, r(0.058)).rot(25, 0, 0).at(lx + 0.017 * u, 0.81 * Hh, zf - 0.06 * u).blend(0.02)),
        fur(S.sphere(r(0.053)).at(EL[0], EL[1], EL[2]).blend(0.02)));
      put(fl.lo.prims, fur(S.sphere(r(0.051)).at(EL[0], EL[1], EL[2])), leg(bone(EL, CA, rl(0.05), rl(0.036)).blend(0.03)),
        leg(S.ellipsoid(rl(0.039), 0.066 * u, rl(0.045)).at(EL[0], lerp(EL[1], CA[1], 0.28), EL[2] - 0.004 * u).blend(0.02)),
        leg(S.sphere(rl(0.038)).at(CA[0], CA[1] + 0.004 * u, CA[2]).blend(0.012)));
      put(fl.paw.prims, leg(S.sphere(rl(0.037)).at(CA[0], CA[1], CA[2])), sock(bone(CA, [px, 0.055 * pr, pz + 0.017 * u], rl(0.035), rl(0.034)).blend(0.02)),
        sock(S.ellipsoid(0.046 * pr, 0.031 * pr, 0.05 * pr).at(px, 0.033 * pr, pz + 0.035 * u).blend(0.018)));
      toes(fl.paw, [px, 0, pz + 0.035 * u + 0.016 * pr]);
    }
    {
      const px = HK[0], pz = HK[2];
      put(bl.up.prims, fur(bone(HP, ST, r(0.082), r(0.058))), fur(S.ellipsoid(r(0.059), 0.12 * u, r(0.106)).rot(26, 0, -5).at(lx + 0.005 * u, 0.86 * Hh, zb + 0.03 * u).blend(0.03)),
        fur(S.sphere(r(0.055)).at(ST[0], ST[1], ST[2]).blend(0.02)));
      put(bl.lo.prims, fur(S.sphere(r(0.053)).at(ST[0], ST[1], ST[2])), leg(bone(ST, HK, rl(0.053), rl(0.032)).blend(0.03)),
        leg(S.ellipsoid(rl(0.03), 0.056 * u, rl(0.038)).rot(-40, 0, 0).at(ST[0], lerp(ST[1], HK[1], 0.3), lerp(ST[2], HK[2], 0.3) - 0.014 * u).blend(0.02)),
        leg(S.sphere(rl(0.034)).at(HK[0], HK[1], HK[2]).blend(0.012)), leg(S.ellipsoid(rl(0.019), rl(0.028), rl(0.022)).at(HK[0], HK[1] + 0.012 * u, HK[2] - 0.022 * u).blend(0.01)));
      put(bl.paw.prims, leg(S.sphere(rl(0.034)).at(HK[0], HK[1], HK[2])), sock(bone(HK, [px, 0.055 * pr, pz + 0.023 * u], rl(0.032), rl(0.033)).blend(0.02)),
        sock(S.ellipsoid(0.044 * pr, 0.031 * pr, 0.05 * pr).at(px, 0.033 * pr, pz + 0.04 * u).blend(0.018)));
      toes(bl.paw, [px, 0, pz + 0.04 * u + 0.016 * pr]);
    }
    return { fl, bl, JF: [SH, EL, CA], JB: [HP, ST, HK], feet: [-CA[1], 0.05 * u, -HK[1], 0.056 * u], u };
  }

  /** hoofed legs (the horse's, scaled): g = { H front joint height, zf, zb, lx, k thickness, cloven, low (colour below knee and hock) } */
  function hoofLegs(ctx, g) {
    const { C, M } = ctx, { H: Hh, zf, zb, lx, k = 1 } = g, u = Hh / 0.6, r = (v) => v * u * k;
    const coat = M(g.col ?? C.fur, 0.0025, 24), low = M(g.low ?? C.leg, 0.002, 26), hc = g.hoof ?? C.hoof;
    const EL = [lx + 0.004 * u, 0.89 * Hh, zf - 0.015 * u], KN = [lx, 0.5 * Hh, zf], FF = [lx, 0.183 * Hh, zf + 0.002 * u];
    const hx = lx + 0.006 * u, HP = [hx - 0.018 * u, 1.167 * Hh, zb], ST = [hx + 0.014 * u, 0.833 * Hh, zb + 0.085 * u], HK = [hx, 0.53 * Hh, zb - 0.075 * u], FH = [hx, 0.183 * Hh, zb - 0.05 * u];
    const hoof = (part, x, z) => {
      put(part.prims, S.cone(r(0.062), r(0.047), 0.07 * u, 0.008).rot(10, 0, 0).at(x, 0.034 * u, z).color(hc).tint(0.2, 30).pbr(ctx.statue ? 0.2 : 0.38).blend(0.008));
      if (g.cloven) put(part.prims, S.box(0.012 * u * k, 0.08 * u, 0.07 * u * k, 0.003).at(x, 0.03 * u, z + r(0.05)).cut(0.004).color(0x120e0c));
    };
    const fl = legParts(), bl = legParts();
    put(fl.up.prims, coat(bone(EL, KN, r(0.075), r(0.05))), coat(S.ellipsoid(r(0.062), 0.1 * u, r(0.092)).rot(-30, 0, 0).at(lx + 0.01 * u, 0.958 * Hh, zf - 0.007 * u).blend(0.03)),
      coat(S.ellipsoid(r(0.046), 0.095 * u, r(0.056)).at(lx + 0.016 * u, 0.758 * Hh, zf + 0.004 * u).blend(0.02)), coat(S.sphere(r(0.048)).at(KN[0], KN[1], KN[2]).blend(0.02)));
    put(fl.lo.prims, low(S.ellipsoid(r(0.05), r(0.054), r(0.051)).at(KN[0], KN[1], KN[2])), low(bone(KN, FF, r(0.041), r(0.037)).blend(0.02)), low(S.sphere(r(0.047)).at(FF[0], FF[1], FF[2]).blend(0.014)));
    put(fl.paw.prims, low(S.sphere(r(0.046)).at(FF[0], FF[1], FF[2])), low(bone(FF, [lx, 0.062 * u, zf + 0.02 * u], r(0.04), r(0.046)).blend(0.014)));
    hoof(fl.paw, lx, zf + 0.032 * u);
    put(bl.up.prims, coat(S.ellipsoid(r(0.084), 0.178 * u, r(0.14)).rot(18, 0, -4).at(hx - 0.004 * u, 1.0 * Hh, zb + 0.015 * u)), coat(bone(ST, HK, r(0.078), r(0.042)).blend(0.035)),
      coat(S.sphere(r(0.064)).at(ST[0], ST[1], ST[2]).blend(0.03)), coat(S.sphere(r(0.045)).at(HK[0], HK[1], HK[2]).blend(0.02)));
    put(bl.lo.prims, low(S.ellipsoid(r(0.046), r(0.058), r(0.054)).at(HK[0], HK[1], HK[2])), low(S.ellipsoid(r(0.024), r(0.04), r(0.027)).at(HK[0], HK[1] + 0.024 * u, HK[2] - 0.038 * u).blend(0.012)),
      low(bone(HK, FH, r(0.042), r(0.038)).blend(0.02)), low(S.sphere(r(0.048)).at(FH[0], FH[1], FH[2]).blend(0.014)));
    put(bl.paw.prims, low(S.sphere(r(0.047)).at(FH[0], FH[1], FH[2])), low(bone(FH, [hx, 0.062 * u, zb - 0.032 * u], r(0.041), r(0.047)).blend(0.014)));
    hoof(bl.paw, hx, zb - 0.02 * u);
    return { fl, bl, JF: [[lx + 0.002 * u, Hh, zf], KN, FF], JB: [HP, HK, FH], feet: [-FF[1], 0.03 * u, -FH[1], 0.03 * u], u, KN, HK, ST };
  }

  /** columns for the giants: g = { H, zf, zb, lx, r, nails } */
  function pillarLegs(ctx, g) {
    const { C, M } = ctx, { H: Hh, zf, zb, lx, r } = g, skin = M(g.col ?? C.fur, g.amp ?? 0.006, g.f ?? 22, g.kind ?? 'noise');
    const one = (z, kn, an, kz) => {
      const P0 = [lx, Hh, z], P1 = [lx, kn * Hh, z + kz], P2 = [lx, an * Hh, z], L = legParts();
      put(L.up.prims, skin(bone(add3(P0, [0, r * 0.3, 0]), P1, r * 1.3, r * 1.04)), skin(S.sphere(r * 1.07).at(P1[0], P1[1], P1[2]).blend(0.02)));
      put(L.lo.prims, skin(S.sphere(r * 1.04).at(P1[0], P1[1], P1[2])), skin(bone(P1, P2, r * 1.02, r * 0.96).blend(0.02)), skin(S.sphere(r * 0.98).at(P2[0], P2[1], P2[2]).blend(0.015)));
      put(L.paw.prims, skin(S.sphere(r * 0.97).at(P2[0], P2[1], P2[2])), skin(S.cone(r * 1.2, r * 0.98, P2[1], 0.02).at(lx, P2[1] / 2, z + r * 0.08).blend(0.02)));
      for (const seg of [[L.up, P0, P1], [L.lo, P1, P2]]) for (let i = 1; i < 3; i++) { const q = lerp3(seg[1], seg[2], i / 3 + 0.05); put(seg[0].prims, ctx.ink(S.torus(r * 1.08, 0.008), C.dark, 0.008, -0.004)?.at(q[0], q[1], q[2])); }
      for (let i = 0; i < (g.nails ?? 3); i++) { const a = (i - ((g.nails ?? 3) - 1) / 2) * 0.55; L.paw.hard.push(H.sphere(r * 0.26, 10).scale(1, 0.8, 0.6).at(lx + Math.sin(a) * r * 1.12, r * 0.22, z + r * 0.08 + Math.cos(a) * r * 1.12).color(C.horn).pbr(0.4).lod(1)); }
      return [L, [P0, P1, P2]];
    };
    const [fl, JF] = one(zf, 0.5, 0.15, r * 0.1), [bl, JB] = one(zb, 0.52, 0.16, r * 0.3);
    return { fl, bl, JF, JB, feet: [-JF[2][1], r * 0.08, -JB[2][1], r * 0.08], u: 1 };
  }

  /** a chain of tail nodes through pts with a radius per point; opt: { col | col(i, n), style(col, i), rig, name, parent, amp, f } */
  function tailChain(ctx, pts, rad, opt = {}) {
    const { M, C } = ctx, n = pts.length - 1, pre = opt.name ?? 'tail', made = [];
    for (let i = 0; i < n; i++) {
      const nd = node(`${pre}${i}`, i === 0 ? (opt.parent ?? 'torso') : `${pre}${i - 1}`, pts[i], { rig: opt.rig ?? 'tail', detail: (opt.detail ?? 0.8) * ctx.D, minRes: opt.minRes ?? 18 });
      const a = pts[i], b = pts[i + 1], col = typeof opt.col === 'function' ? opt.col(i, n) : (opt.col ?? C.fur);
      const st = opt.style ? opt.style(col, i) : M(col, opt.amp ?? 0.007, opt.f ?? 36);
      nd.prims.push(st(S.sphere(rad[i] * 0.98).at(a[0], a[1], a[2])), st(bone(a, b, rad[i], rad[i + 1]).blend(0.015)));
      ctx.nodes.push(nd); made.push(nd);
    }
    return made;
  }
  /** a tassel of hair at the end of a tail node */
  function tuft(ctx, nd, a, b, r, col, n = 6) {
    const t = norm3(sub3(b, a));
    nd.prims.push(ctx.M(col, 0.008, 24)(orient(S.ellipsoid(r, r * 1.9, r), add3(b, mul3(t, r * 0.6)), t).blend(0.015)));
    for (let j = 0; j < n; j++) { const ang = (j / n) * Math.PI * 2, out = [Math.cos(ang), Math.sin(ang) * t[2], -Math.sin(ang) * t[1]]; put(nd.hard, ctx.lk(add3(b, add3(mul3(t, r * 1.2), mul3(out, r * 0.5))), norm3(add3(t, mul3(out, 0.22))), r * 2.6, r * 0.65, r * 0.45, col, tone(col, 0, 0, 0.1), mul3(out, -1), 0.14)?.lod(1)); }
  }

  // =====================================================================================
  //  coats and conditions
  // =====================================================================================
  /** hanging locks along a line on the surface df: a shaggy skirt, a bristle ridge */
  function fringe(ctx, nd, df, n, at, o) {
    for (let i = 0; i < n; i++) {
      const [from, ray, dir] = at(i, i / Math.max(1, n - 1)), root = surfHit(df, from, ray), L = o.L * (0.8 + ctx.rnd() * 0.4);
      put(nd.hard, ctx.lk(add3(root, mul3(norm3(ray), o.sink ?? 0.006)), norm3(dir), L, L * (o.w ?? 0.22), L * (o.t ?? 0.14), o.colA, o.colB ?? o.colA, o.toward ?? mul3(norm3(ray), 1), o.curl ?? 0.2)?.lod(o.lod ?? 1));
    }
  }
  /** undead: wounds that open on the ribs, mouldering patches. p = the torso's prims, hd = its hard list; box from torsoOf (or given) */
  function rotify(rnd, p, hd, df, box, sc = 1) {
    const { top, bot, z0, z1 } = box, cy = (top + bot) / 2, hgt = top - bot, ln = z1 - z0;
    for (const [sx, fz, fy, sz] of [[1, 0.56, 0.5, 1], [-1, 0.36, 0.56, 0.8]]) {
      const z = z0 + ln * fz, y = bot + hgt * fy, s = sz * hgt * 0.34;
      const c = surfHit(df, [sx * 2, y, z], [-sx, 0, 0]);
      p.push(S.ellipsoid(s * 0.42, s * 0.72, s * 0.95).at(c[0] - sx * s * 0.08, c[1], c[2]).cut(0.012).color(0x3a0f14));
      for (let i = 0; i < 4; i++) {
        const zz = c[2] + (i - 1.5) * s * 0.42, pts = [];
        for (let j = 0; j <= 4; j++) { const yy = c[1] + (j / 4 - 0.5) * s * 1.7, h = surfHit(df, [sx * 2, yy, zz - (j / 4 - 0.5) * s * 0.3], [-sx, 0, 0]); pts.push([h[0] - sx * s * 0.07, h[1], h[2]]); }
        hd.push(H.tube(pts, 0.011 * sc * (0.8 + sz * 0.3), 8, 6).color(BONE).pbr(0.6).lod(2));
      }
    }
    for (let i = 0; i < 7; i++) {
      const sx = i % 2 ? 1 : -1, c = surfHit(df, [sx * 2, bot + hgt * (0.3 + rnd() * 0.6), z0 + ln * (0.08 + rnd() * 0.84)], [-sx, 0, 0]), r = hgt * (0.1 + rnd() * 0.09);
      p.push(S.ellipsoid(r, r * 1.2, r * 1.4).at(c[0], c[1], c[2]).color(i % 3 ? 0x4a5440 : 0x6a2a2a).pbr(0.95).tint(0.3, 30).paint(r * 0.5, i % 3 ? 0 : -0.004));
    }
    void cy;
  }
  /** an elemental aura: crystals along the spine, glowing veins on shoulder and haunch */
  function frost(ctx, torso, df, n = 9, size = 1) {
    const g = ctx.glow, b = torso.box, ln = b.z1 - b.z0;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1), z = b.z1 - ln * (0.12 + f * 0.76), x = (ctx.rnd() - 0.5) * b.wd * 0.4, r = surfHit(df, [x, b.top + 0.5, z], [0, -1, 0]);
      const L = (0.07 + 0.07 * Math.sin(f * Math.PI) + ctx.rnd() * 0.03) * size * (b.top - b.bot) * 3;
      torso.hard.push(orient(H.cone(L * 0.2, L, 5), add3(r, [0, L * 0.3, -L * 0.1]), [x * 2, 1, -0.45 - ctx.rnd() * 0.3]).color(mix(g, 0xffffff, 0.35)).glow(0.75).pbr(0.15).lod(i % 2 ? 1 : 3));
    }
    for (const sx of [1, -1]) for (const fz of [0.74, 0.22]) {
      const c = surfHit(df, [sx * 2, lerp(b.bot, b.top, 0.62), b.z0 + ln * fz], [-sx, 0, 0]), h = (b.top - b.bot) * 0.2;
      for (let i = 0; i < 3; i++) torso.prims.push(S.ellipsoid(h * 0.5, h * (1.1 - i * 0.2), h * 0.14).rot(20 - i * 28, 0, 0).at(c[0], c[1], c[2] + (i - 1) * h * 0.55).color(g).glow(0.8).pbr(0.3).paint(0.008));
    }
  }
  /** plate armour raised off a body: each plate is a volume whose overlap with the surface becomes steel */
  const plate = (shape, col, raise = 0.012) => shape.color(col).tint(0.08, 30).pbr(0.34, 1).paint(0.004, raise);
  const studs = (hd, pts, r, col = BRASS, lodN = 1) => { for (const q of pts) hd.push(H.sphere(r, 8).at(q[0], q[1], q[2]).color(col).pbr(0.35, 1).lod(lodN)); };

//__PART2__
}
