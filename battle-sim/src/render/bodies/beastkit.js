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
  const { node, finish, bone, lay, tone, mix, spike, lock, eye, feather, gradAt, strap, rivets, ringAt, drape, gridLines, rng, hashStr, mirrorAll, orient, flat, feet,
    makeRider, seatRider, riderToMount, buildHorse, horseTack, buildGriffon, griffonWing, griffonTack, proportions, MOUNT_KEYS } = K;

  /** walk from `from` along `dir` to the surface of df; a ray that misses stops where it passed closest */
  function surfHit(df, from, dir, maxSteps = 40) {
    const u = norm3(dir);
    let p = from.slice(), best = p, bd = 1e9;
    for (let i = 0; i < maxSteps; i++) { const d = df(p[0], p[1], p[2]); if (d < bd) { bd = d; best = p; } if (d < 0.0008 || d > bd + 0.3) break; p = add3(p, mul3(u, d)); }
    return best;
  }
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
    const s = opt.s ?? 1, dk = opt.kind || 'fur';
    const M = (col, amp = 0.006, f = 30, kind = dk, rough = opt.rough ?? 0.88) => (statue ? (q) => q.color(col).tint(0.06, 5).pbr(0.2, 0)
      : rocky ? (q) => q.color(col).tint(0.32, 7).bump(Math.max(amp, 0.018), 9, 'rock').pbr(0.96)
        : (q) => q.color(col).tint(0.2, 18).bump(amp, f, kind).pbr(rough));
    return {
      def, o, id, s, C, M, rnd: rng(hashStr((def?.id || id) + ':' + id)), nodes: [node('root', null, [0, 0, 0])], statue, rocky, rot, glow,
      Kk: opt.keys || { body: 'torso', neck: 'neck', head: 'head', jaw: 'jaw' }, mounted: !!opt.keys,
      D: (opt.detail ?? 0.8) * Math.min(1, Math.pow(1 / s, 0.75)),
      /** colour laid over the coat (no shape): skipped on a statue, which is one polished stone */
      ink: (q, col, soft = 0.02, raise = 0) => (statue ? null : q.color(col).pbr(rocky ? 0.96 : 0.88).paint(soft, raise)),
      lk: (...a) => (statue ? null : lock(...a)),
      get: (name) => null,
    };
  }
  const horn = (pts, r0, r1, col, n = 10, radial = 8) => H.tube(pts, [r0, lerp(r0, r1, 0.45), lerp(r0, r1, 0.8), r1], n, radial).color(col).pbr(0.4, 0);
  const SM = (list) => S.mirrorX(list.filter(Boolean));
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
    put(p, SM([
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
      SM([
        fur(lay(cr[0] * 0.45 * (q.cheek ?? 1), cr[1] * 0.62, cr[2] * 0.61).at(cr[0] * 0.75, cc[0] - cr[1] * 0.41, cc[1] + cr[2] * 0.09).blend(0.03)),
        pale(S.ellipsoid(mr[1] * 0.65, mr[1] * 0.7, mr[1] * 1.24).at(mr[1] * 0.82, m1[0] - mr[1] * 0.24, m1[1] - mr[1] * 0.88).blend(0.014)),
        fur(S.ellipsoid(cr[0] * 0.375, cr[1] * 0.19, cr[2] * 0.25).rot(0, -22, -24).at(ex * 0.95, ey + er * 1.6, ez - 0.004).blend(0.014)),
      ]),
      S.box(mr[0] * 1.72, 0.05, tipZ - m0[1] + 0.045, 0.012).at(0, gum - 0.025, (tipZ + m0[1] - 0.045) / 2).cut(0.006).color(C.mouth));
    const ns = (q.nose ?? 1) * mr[1], nz = m1[1] + mr[1] * 0.82, ny = m1[0] + mr[1] * 0.3;
    put(p, S.ellipsoid(ns * 0.74, ns * 0.62, ns * 0.62).at(0, ny, nz).color(q.noseCol ?? C.nose).pbr(0.3).blend(0.007),
      SM([S.ellipsoid(ns * 0.19, ns * 0.16, ns * 0.26).rot(0, 20, 0).at(ns * 0.35, ny - ns * 0.03, nz + ns * 0.5).cut(0.003).color(0x050404)]),
      S.box(0.003 * ms, ns * 0.6, ns * 0.35, 0.001).at(0, ny - ns * 0.42, nz + ns * 0.44).cut(0.002).color(0x050404));
    eyes(ctx, p, hard, ex, ey, ez, er, q.eyaw ?? 32, q.look);
    put(p, SM([ctx.ink(S.ellipsoid(mr[1] * 0.24, mr[1] * 0.47, len * 0.6), C.lip, 0.004)?.at(mr[0] * 0.98, gum + 0.002, lerp(m0[1], m1[1], 0.5))]));
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
    put(jp, SM([jf(bone([cr[0] * 0.475, hinge[1] - 0.006, hinge[2]], [mr[1] * 0.62, gum - 0.02, m1[1] - 0.062 * ms], mr[1] * 0.6, mr[1] * 0.48))]),
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
      SM([
        coat(S.ellipsoid(0.034 * w, 0.078 * d, 0.086).at(0.037 * w, -0.07 * d, 0.072).blend(0.025)),
        coat(S.ellipsoid(0.02, 0.016, 0.03).rot(0, 0, -20).at(0.05 * w, 0.022 * d, 0.1).blend(0.012)),
        coat(S.ellipsoid(0.012, 0.01, 0.07 * f).at(0.04 * w, -0.008, 0.2 * f).blend(0.012)),
      ]),
      mz(lay(0.046 * w * mw, 0.05 * d * mw, 0.052).at(0, -0.016 * d, L + 0.028).blend(0.03)),
      mz(S.ellipsoid(0.03 * w * mw, 0.024 * d, 0.032).at(0, -0.06 * d, L + 0.032).blend(0.016)),
      SM([
        mz(S.ellipsoid(0.018, 0.022, 0.02).rot(0, 20, 0).at(0.03 * w * mw, 0, L + 0.052).blend(0.01)),
        S.ellipsoid(0.009, 0.014, 0.012).rot(0, 20, 20).at(0.036 * w * mw, 0.002, L + 0.064).cut(0.004).color(0x0a0707),
      ]),
      ctx.ink(S.ellipsoid(0.06 * w * mw, 0.0045, 0.06), 0x120c0b, 0.003, -0.003)?.at(0, -0.04 * d, L + 0.025));
    const ex = 0.0535 * w, ey = 0.004, ez = 0.108, er = q.eyeR ?? 0.0165;
    const E = ctx.rot || ctx.glow !== null || ctx.statue ? ctx.C.eye : { iris: 0x4a2a14, rim: 0x1a0d06, white: 0x1a0f0a, glow: 0, ...(q.look || {}) };
    put(p, SM([S.ellipsoid(er * 0.85, er * 0.82, er * 1.15).at(ex + er * 0.5, ey, ez).cut(0.005).color(ctx.statue ? E.white : 0x120b08), S.sphere(er * 0.94).at(ex, ey, ez).color(E.iris).glow((E.glow || 0) * 0.8).pbr(0.15).blend(0)]));
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
    const bk = clamp(Math.max(...g.st.map((s) => s[2])) / 0.14, 1, 2.4);
    g.st.forEach((s, i) => p.push(M(s[5] ?? C.fur, amp, f)(lay(s[2], s[3], s[4]).rot(s[6] ?? 0, 0, 0).at(0, s[1], s[0]).blend(i ? 0.055 * bk : 0.025))));
    if (g.nk) p.push(fur(bone(g.nk[0], g.nk[1], g.nk[2], g.nk[3]).blend(0.05)));
    if (g.tl) p.push(fur(bone(g.tl[0], g.tl[1], g.tl[2], g.tl[3]).blend(0.04)));
    const sh = g.sh, hp = g.hp;
    if (sh) put(p, SM([fur(S.ellipsoid(0.054 * sh[3], 0.104 * sh[3], 0.082 * sh[3]).rot(-14, 0, -8).at(sh[0], sh[1], sh[2]).blend(0.03 * bk))]));
    if (hp) put(p, SM([fur(S.ellipsoid(0.05 * hp[3], 0.1 * hp[3], 0.1 * hp[3]).rot(20, 0, -6).at(hp[0], hp[1], hp[2]).blend(0.035 * bk))]));
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
      const mr = (b) => Math.max(6, Math.round(b / Math.max(1, (L.thick || 1) * (ctx.s || 1))));
      const up = node(`leg${nm}`, par, m(js[0]), { rig: 'legs', detail: 0.8 * det * ctx.D, minRes: mr(16) });
      const lo = node(`shin${nm}`, `leg${nm}`, m(js[1]), { rig: 'shins', detail: 0.88 * det * ctx.D, minRes: mr(19) });
      const pw = node(`paw${nm}`, `shin${nm}`, m(js[2]), { rig: 'paws', detail: 0.95 * det * ctx.D, minRes: mr(18) });
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
    return { fl, bl, JF: [SH, EL, CA], JB: [HP, ST, HK], feet: [-CA[1], 0.05 * u, -HK[1], 0.056 * u], u, thick: u * kl };
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
    return { fl, bl, JF: [[lx + 0.002 * u, Hh, zf], KN, FF], JB: [HP, HK, FH], feet: [-FF[1], 0.03 * u, -FH[1], 0.03 * u], u, KN, HK, ST, thick: u * k };
  }

  /** columns for the giants: g = { H, zf, zb, lx, r, nails } */
  function pillarLegs(ctx, g) {
    const { C, M } = ctx, { H: Hh, zf, zb, lx, r } = g, skin = M(g.col ?? C.fur, g.amp ?? 0.006, g.f ?? 22, g.kind ?? 'noise');
    const one = (z, kn, an, kz) => {
      const P0 = [lx, Hh, z], P1 = [lx, kn * Hh, z + kz], P2 = [lx, an * Hh, z], L = legParts();
      put(L.up.prims, skin(bone(add3(P0, [0, r * 0.3, 0]), P1, r * 1.3, r * 1.04)), skin(S.sphere(r * 1.07).at(P1[0], P1[1], P1[2]).blend(0.02)));
      put(L.lo.prims, skin(S.sphere(r * 1.04).at(P1[0], P1[1], P1[2])), skin(bone(P1, P2, r * 1.02, r * 0.96).blend(0.02)), skin(S.sphere(r * 0.98).at(P2[0], P2[1], P2[2]).blend(0.015)));
      put(L.paw.prims, skin(S.sphere(r * 0.97).at(P2[0], P2[1], P2[2])), skin(S.cone(r * 1.2, r * 0.98, P2[1], 0.02).at(lx, P2[1] / 2, z + r * 0.08).blend(0.02)));
      for (const seg of [[L.up, P0, P1], [L.lo, P1, P2]]) for (let i = 1; i < 3; i++) { const q = lerp3(seg[1], seg[2], i / 3 + 0.05); put(seg[0].prims, ctx.ink(S.torus(r * 1.08, 0.005), C.back, 0.006, -0.003)?.at(q[0], q[1], q[2])); }
      for (let i = 0; i < (g.nails ?? 3); i++) { const a = (i - ((g.nails ?? 3) - 1) / 2) * 0.55; L.paw.hard.push(H.sphere(r * 0.26, 10).scale(1, 0.8, 0.6).at(lx + Math.sin(a) * r * 1.12, r * 0.22, z + r * 0.08 + Math.cos(a) * r * 1.12).color(C.horn).pbr(0.4).lod(1)); }
      return [L, [P0, P1, P2]];
    };
    const [fl, JF] = one(zf, 0.5, 0.15, r * 0.1), [bl, JB] = one(zb, 0.52, 0.16, r * 0.3);
    return { fl, bl, JF, JB, feet: [-JF[2][1], r * 0.08, -JB[2][1], r * 0.08], u: 1, thick: r / 0.036 };
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

  // =====================================================================================
  //  the animals
  // =====================================================================================
  function frame(ctx, g) {
    const torso = torsoOf(ctx, g);
    const L = (g.legs.type === 'hoof' ? hoofLegs : g.legs.type === 'pillar' ? pillarLegs : pawLegs)(ctx, g.legs);
    const neck = neckOf(ctx, g.NB, g.HJ, g.nr[0], g.nr[1], g.neck);
    return { ctx, torso, neck, L, NB: g.NB, HJ: g.HJ, feet: L.feet };
  }
  const headW = (pitch) => { const c = Math.cos(pitch * DEG), s = Math.sin(pitch * DEG); return (v) => [v[0], v[1] * c + v[2] * s, -v[1] * s + v[2] * c]; };   // a world-oriented offset in a pitched head's frame
  /** rings round a limb or tail node, drawn across the bone a -> b */
  const bands = (ctx, prims, a, b, r, col, n, w = 0.012) => { const t = norm3(sub3(b, a)); for (let i = 0; i < n; i++) put(prims, ctx.ink(orient(S.ellipsoid(r * 1.7, w, r * 1.7), lerp3(a, b, (i + 0.6) / (n + 0.2)), t), col, 0.005)); };
  /** a closed band of capsules through pts (a girth, a collar) */
  const loop = (pts, r, col, rough = 0.6, met = 0) => pts.map((a, i) => S.capsule(a, pts[(i + 1) % pts.length], r).color(col).pbr(rough, met).blend(0.004));
  const ellipse = (c, rx, ry, n = 16) => { const o = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; o.push([c[0] + Math.sin(a) * rx, c[1] + Math.cos(a) * ry, c[2]]); } return o; };
  /** plate barding common to bear, bull and hound: breastplate, shoulder and croup plates, a ridge of lames down the spine */
  function barding(ctx, A, col, sc = 1) {
    const t = A.torso, p = t.prims, b = t.box, df = distanceField(p), ln = b.z1 - b.z0, cy = (b.top + b.bot) / 2, h = b.top - b.bot;
    put(p, plate(lay(b.wd * 1.05, h * 0.36, ln * 0.13).at(0, cy - h * 0.04, b.z1 - ln * 0.1), col),
      SM([plate(S.ellipsoid(b.wd * 0.5, h * 0.3, ln * 0.17).at(b.wd * 0.9, cy + h * 0.14, b.z1 - ln * 0.27), col), plate(S.ellipsoid(b.wd * 0.5, h * 0.27, ln * 0.17).at(b.wd * 0.9, cy + h * 0.12, b.z0 + ln * 0.2), col)]));
    for (let i = 0; i < 6; i++) { const z = b.z1 - ln * (0.2 + i * 0.125), r = surfHit(df, [0, b.top + 0.5, z], [0, -1, 0]); put(p, plate(lay(b.wd * 0.42, 0.05, ln * 0.07).rot(-8, 0, 0).at(0, r[1], z), i % 2 ? tone(col, 0, 0, -0.06) : col, 0.014)); }
    { const zz = b.z1 - ln * 0.42, pts = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, d = [Math.sin(a), Math.cos(a), 0]; pts.push(surfHit(df, [d[0] * 2, cy + d[1] * 2, zz], mul3(d, -1), 40)); } put(p, loop(pts, 0.016 * sc, LEATHER_DARK)); }
    for (const sx of [1, -1]) for (const fz of [0.27, 0.8]) {
      const c = surfHit(df, [sx * 2, cy + h * 0.14, b.z0 + ln * fz], [-sx, 0, 0]);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; t.hard.push(H.sphere(0.012 * sc, 8).at(c[0] + sx * 0.012, c[1] + Math.cos(a) * h * 0.17, c[2] + Math.sin(a) * ln * 0.1).color(BRASS).pbr(0.35, 1).lod(1)); }
      if (fz > 0.5) t.hard.push(orient(H.cone(0.028 * sc, 0.11 * sc, 8), add3(c, [sx * 0.04 * sc, 0, 0]), [sx, 0.35, 0]).color(tone(col, 0, 0, 0.08)).pbr(0.3, 1).lod(2));
    }
  }
  /** a collar round a neck: a band, studs or spikes, an optional pendant */
  function collar(A, col, f = 0.5, r = 0.012, spikes = 0, gem = null) {
    const c = lerp3(A.NB, A.HJ, f), ax = A.neck.ax, nd = A.neck, df = distanceField(nd.prims);
    
    const ring = [], outs = [];
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, out = norm3([Math.sin(a), Math.cos(a) * ax[2], -Math.cos(a) * ax[1]]); outs.push(out); ring.push(surfHit(df, add3(c, mul3(out, 1.5)), mul3(out, -1), 40)); }
    nd.prims.push(...loop(ring, r, col, spikes ? 0.6 : 0.35, spikes ? 0 : 1));
    const n = spikes || 9;
    for (let k = 0; k < n; k++) {
      const i = Math.round((k / n) * 18) % 18, out = outs[i], q = add3(ring[i], mul3(out, r * 0.6));
      nd.hard.push(spikes ? orient(H.cone(r * 0.9, r * 4.2, 6), add3(q, mul3(out, r * 1.6)), out).color(0xb8bec6).pbr(0.3, 1).lod(2) : H.sphere(r * 0.5, 8).at(q[0], q[1], q[2]).color(tone(col, 0, 0, 0.12)).pbr(0.3, 1).lod(1));
    }
    if (gem !== null) { const q = add3(ring[9], mul3(outs[9], r)); nd.hard.push(H.sphere(r * 1.5, 10).scale(1, 1.3, 0.8).at(q[0], q[1] - r * 1.5, q[2]).color(gem).glow(0.3).pbr(0.15).lod(1), H.cyl(r * 1.9, r * 1.9, r * 0.6, 12).rot(90, 0, 0).at(q[0], q[1] - r * 1.5, q[2] - r * 0.5).color(col).pbr(0.35, 1).lod(1)); }
  }

  // ---------------- cats ----------------
  function cat(def, o, base, opt, v) {
    const lion = v === 'lion', tiger = v === 'tiger', leo = v === 'leopard';
    const ctx = mk(def, o, v, base, { ...opt, C: (f) => (tiger ? { belly: 0xf2ead8, pale: 0xf4eee0, stripe: 0x1a1512, muzzle: 0xf0e8d8 } : leo ? { belly: mix(f, 0xf4eee0, 0.6), pale: mix(f, 0xf6f0e4, 0.7), stripe: mix(f, 0x14100e, 0.86), muzzle: mix(f, 0xf6f0e4, 0.5) } : { mane: mix(tone(f, -0.015, 0.02, -0.24), 0x3a2414, 0.25), muzzle: mix(f, 0xf0e6d0, 0.35) }) });
    const { C, M, rnd } = ctx, w = leo ? 0.88 : tiger ? 1.06 : 1;
    const A = frame(ctx, {
      o: [0, 0.5, 0], amp: 0.004, f: 40,
      st: [[0.17, 0.5, 0.15 * w, 0.17, 0.22], [0.2, 0.6, 0.09 * w, 0.085, 0.13], [-0.1, 0.52, 0.118 * w, 0.12, 0.2], [-0.31, 0.52, 0.125 * w, 0.13, 0.15, undefined, 8], [0.33, 0.47, 0.11 * w, 0.11, 0.1]],
      nk: [[0, 0.53, 0.28], [0, 0.61, 0.4], 0.125 * w, 0.11 * w], tl: [[0, 0.55, -0.38], [0, 0.55, -0.46], 0.06, 0.042], sh: [0.118 * w, 0.53, 0.23, 1.3], hp: [0.1 * w, 0.51, -0.3, 1.35],
      NB: [0, 0.57, 0.32], HJ: [0, 0.69, 0.5], nr: [0.118 * w, 0.095 * w],
      legs: { type: 'paw', H: 0.5, zf: 0.25, zb: -0.32, lx: 0.115 * w, k: 1.22 * w, kl: 1.35 * w, toe: 1.25, claw: 0.9 },
    });
    const { torso, neck, L } = A, p = torso.prims, df = distanceField(p), sCol = C.stripe;
    if (tiger) {
      for (let i = 0; i < 11; i++) for (const sx of [1, -1]) { const z = 0.34 - i * 0.07 + sx * 0.014 + (rnd() - 0.5) * 0.02; put(p, ctx.ink(S.ellipsoid(0.06, 0.1 + rnd() * 0.05, 0.011 + rnd() * 0.004).rot(rnd() * 26 - 13, 0, 0), sCol, 0.005)?.at(sx * 0.125 * w, 0.57 + rnd() * 0.04, z)); if (i % 2) put(p, ctx.ink(S.ellipsoid(0.05, 0.05, 0.009).rot(rnd() * 30 - 15, 0, 0), sCol, 0.005)?.at(sx * 0.11 * w, 0.4, z + 0.03)); }
      for (const part of [L.fl, L.bl]) { const J = part === L.fl ? L.JF : L.JB; bands(ctx, part.up.prims, J[0], J[1], 0.07 * w, sCol, 3, 0.01); bands(ctx, part.lo.prims, J[1], J[2], 0.05 * w, sCol, 3, 0.009); }
    }
    if (leo) {
      for (let i = 0; i < 110; i++) { const sx = i % 2 ? 1 : -1, c = i < 86 ? surfHit(df, [sx * 2, 0.4 + rnd() * 0.24, -0.42 + rnd() * 0.8], [-sx, 0, 0]) : surfHit(df, [(rnd() - 0.5) * 0.16, 2, -0.4 + rnd() * 0.7], [0, -1, 0]), r = 0.015 + rnd() * 0.01; put(p, ctx.ink(S.ellipsoid(r, r * (0.8 + rnd() * 0.5), r * (0.9 + rnd() * 0.5)), sCol, 0.004)?.at(c[0], c[1], c[2])); }
      for (const part of [L.fl, L.bl]) { const J = part === L.fl ? L.JF : L.JB; for (let i = 0; i < 7; i++) { const seg = i < 4 ? [part.up, J[0], J[1], 0.07] : [part.lo, J[1], J[2], 0.045], q = lerp3(seg[1], seg[2], 0.15 + rnd() * 0.7), a = rnd() * 2.4 - 1.2; put(seg[0].prims, ctx.ink(S.sphere(0.015), sCol, 0.004)?.at(q[0] + Math.cos(a) * seg[3] * w, q[1], q[2] + Math.sin(a) * seg[3] * w)); } }
    }
    // seen from afar the painted coat blurs away, so the two coarsest levels carry their own bold markings
    if (tiger && !ctx.statue) for (let i = 0; i < 7; i++) for (const sx of [1, -1]) {
      const z = 0.32 - i * 0.105 + sx * 0.02, pts = [];
      for (let j = 0; j <= 4; j++) { const h = surfHit(df, [sx * 2, 0.4 + j * 0.058, z - j * 0.012], [-sx, 0, 0]); pts.push([h[0] + sx * 0.004, h[1], h[2]]); }
      torso.hard.push(H.tube(pts, [0.006, 0.016, 0.017, 0.012, 0.004], 5, 3).color(sCol).pbr(0.9).from(2));
    }
    if (leo && !ctx.statue) for (let i = 0; i < 26; i++) {
      const sx = i % 2 ? 1 : -1, h = surfHit(df, [sx * 2, 0.43 + ((i * 7) % 5) * 0.05, 0.34 - (i >> 1) * 0.058], [-sx, 0, 0]);
      torso.hard.push(H.cyl(0.022, 0.022, 0.012, 5).rot(0, 0, 90).at(h[0] + sx * 0.004, h[1], h[2]).color(sCol).pbr(0.9).from(2));
    }
    // head
    const hs = lion ? 1.26 : tiger ? 1.3 : 1.12;
    const hd = carnHead(ctx, {
      cr: [0.086, 0.074, 0.086], cc: [0.03, 0.045], m0: [0, 0.105], m1: [-0.014, 0.19], mr: [0.058, 0.047], ex: 0.048, ey: 0.05, ez: 0.1, er: 0.0155, eyaw: 24,
      ears: { type: 'round', s: leo ? 0.95 : 1.05, rot: [-8, 25, -30], at: [0.062, 0.088, -0.005] }, fang: 0.052, nose: 0.85, noseCol: leo || ctx.statue ? undefined : 0x6a3a36, mzCol: C.muzzle, cheek: 1.2, s: hs,
      look: lion ? { iris: 0xe8a020 } : tiger ? { iris: 0xe8c040 } : { iris: 0xb8d86a },
      extra: (h) => {
        if (tiger) {
          for (const x of [-0.028, 0, 0.028]) put(h.p, ctx.ink(S.ellipsoid(0.006, 0.03, 0.026), sCol, 0.003)?.at(x, 0.1, 0.05 - Math.abs(x) * 0.4));
          for (const sx of [1, -1]) { for (let i = 0; i < 3; i++) put(h.p, ctx.ink(S.ellipsoid(0.03, 0.006, 0.012).rot(0, 0, sx * (20 + i * 18)), sCol, 0.003)?.at(sx * 0.075, 0.05 - i * 0.028, 0.045)); for (let i = 0; i < 4; i++) h.p.push(M(C.pale, 0.006, 40)(bone([sx * 0.07, 0.01 - i * 0.022, 0.04], [sx * (0.115 - i * 0.008), -0.015 - i * 0.03, -0.005], 0.022, 0.006).blend(0.02))); }
        }
        if (leo) for (let i = 0; i < 7; i++) put(h.p, ctx.ink(S.sphere(0.008), sCol, 0.003)?.at((i % 3 - 1) * 0.03 + (i > 3 ? 0.015 : 0), 0.1 - (i % 2) * 0.008, 0.02 + Math.floor(i / 3) * 0.03));
        if (lion) for (let j = 0; j < 11; j++) {   // the ruff that frames the face
          const a = (j / 11) * Math.PI * 2 + 0.28, sx = Math.sin(a), cy = Math.cos(a), under = cy < -0.5;
          h.p.push(M(under ? mix(C.mane, C.fur, 0.3) : C.mane, 0.01, 18)(bone([sx * 0.072, 0.03 + cy * 0.07, 0.005], [sx * 0.15, 0.03 + cy * 0.15 - (under ? 0.02 : 0), -0.06], 0.05, 0.016).blend(0.03)));
        }
      },
    });
    headNode(ctx, neck, A.NB, A.HJ, 14, hd, 1.35);
    if (lion) {
      const mane = M(C.mane, 0.012, 16), ax = neck.ax, mp = neck.prims;
      mp.push(mane(bone(add3(A.NB, [0, 0.0, -0.07]), add3(A.HJ, [0, 0.03, -0.03]), 0.185, 0.16).blend(0.03)), mane(S.ellipsoid(0.15, 0.17, 0.13).at(0, 0.5, 0.36).blend(0.05)));
      for (let r = 0; r < 3; r++) for (let j = 0; j < 9; j++) {
        const a = ((j + (r % 2) * 0.5) / 9) * Math.PI * 2, out = norm3([Math.sin(a), Math.cos(a) * ax[2], -Math.cos(a) * ax[1]]), c = add3(lerp3(A.NB, A.HJ, 0.85 - r * 0.42), mul3(out, 0.15)), Lk = 0.12 + rnd() * 0.04 + (Math.cos(a) < -0.3 ? 0.05 : 0);
        mp.push(M(r === 2 ? mix(C.mane, C.fur, 0.35) : tone(C.mane, 0, 0, (rnd() - 0.5) * 0.06), 0.01, 20)(bone(c, add3(c, add3(mul3(ax, -Lk * 0.8), add3(mul3(out, Lk * 0.42), [0, -Lk * 0.35, 0]))), 0.055, 0.012).blend(0.03)));
      }
      for (let j = 0; j < 5; j++) p.push(mane(bone([(j - 2) * 0.05, 0.47, 0.37 - Math.abs(j - 2) * 0.02], [(j - 2) * 0.06, 0.33 + Math.abs(j - 2) * 0.02, 0.36], 0.05, 0.012).blend(0.03)));   // the mane runs down the chest
      p.push(mane(lay(0.07, 0.05, 0.16).at(0, 0.67, 0.2).blend(0.04)));
    }
    if (hexOf(o.collar, null) !== null) collar(A, o.collar, lion ? 0.2 : 0.5, 0.014, 0, 0xc8203a);
    // tail
    const TL = leo ? [[0, 0.55, -0.44], [0, 0.46, -0.58], [0, 0.34, -0.72], [0, 0.27, -0.88], [0, 0.33, -1.02]] : [[0, 0.55, -0.44], [0, 0.47, -0.57], [0, 0.36, -0.68], [0, 0.27, -0.8], [0, 0.3, -0.92]];
    const tr = leo ? [0.04, 0.037, 0.035, 0.034, 0.03] : [0.036, 0.03, 0.026, 0.023, 0.021];
    const tn = tailChain(ctx, TL, tr, { amp: 0.004, f: 44, col: (i) => (!lion && i === 3 ? (tiger ? C.fur : C.pale) : C.fur) });
    if (lion) tuft(ctx, tn[3], TL[3], TL[4], 0.04, C.mane);
    else tn.forEach((n, i) => bands(ctx, n.prims, TL[i], TL[i + 1], tr[i], sCol, i === 3 ? 3 : 2, i === 3 ? 0.016 : 0.011));
    if (ctx.glow !== null) frost(ctx, torso, df, 9, 0.9);
    return A;
  }

  // ---------------- bear ----------------
  function bear(def, o, base, opt) {
    const ctx = mk(def, o, 'bear', base, { ...opt, C: (f) => ({ muzzle: mix(f, 0xc8a878, 0.42), pale: mix(f, 0xc8a878, 0.3), belly: tone(f, 0, 0, -0.04), back: tone(f, 0, 0, -0.06) }) });
    const { C, rnd } = ctx;
    const A = frame(ctx, {
      o: [0, 0.52, 0], amp: 0.011, f: 20,
      st: [[0.2, 0.52, 0.2, 0.2, 0.24], [0.17, 0.68, 0.14, 0.105, 0.18], [-0.08, 0.54, 0.19, 0.19, 0.22], [-0.3, 0.52, 0.2, 0.2, 0.18, undefined, 6], [0.36, 0.48, 0.14, 0.14, 0.1]],
      nk: [[0, 0.56, 0.32], [0, 0.6, 0.46], 0.17, 0.15], sh: [0.16, 0.56, 0.25, 1.9], hp: [0.14, 0.53, -0.3, 1.9],
      NB: [0, 0.6, 0.38], HJ: [0, 0.58, 0.6], nr: [0.155, 0.125], neck: { amp: 0.011, f: 20 },
      legs: { type: 'paw', H: 0.5, zf: 0.26, zb: -0.3, lx: 0.15, k: 1.75, kl: 1.95, toe: 1.3, claw: 1.3 },
    });
    const { torso, neck } = A, armor = hexOf(o.armor, null), df = distanceField(torso.prims);
    const hd = carnHead(ctx, {
      cr: [0.098, 0.086, 0.095], cc: [0.03, 0.04], m0: [-0.005, 0.11], m1: [-0.022, 0.225], mr: [0.052, 0.04], ex: 0.05, ey: 0.048, ez: 0.112, er: 0.015, eyaw: 26,
      ears: { type: 'round', s: 1.05, rot: [-8, 25, -30], at: [0.075, 0.095, -0.01] }, fang: 0.04, nose: 1.15, jawCol: C.muzzle, cheek: 1.25, s: 1.4, look: { iris: 0x8a5a20, glow: 0.1 },
      extra: (h) => { if (armor !== null) { put(h.p, plate(lay(0.075, 0.05, 0.1).at(0, 0.09, 0.05), armor, 0.008), plate(bone([0, 0.03, 0.1], [0, 0.0, 0.2], 0.035, 0.028), armor, 0.007)); h.hard.push(spike([0, 0.125, 0.07], [0, 1, 0.3], 0.07, 0.016, tone(armor, 0, 0, 0.1), [0, 0, 1], 0.15).pbr(0.3, 1).lod(2)); } },
    });
    headNode(ctx, neck, A.NB, A.HJ, 16, hd, 1.2);
    fringe(ctx, torso, df, 9, (i, f) => [[(i % 3 - 1) * 0.06, 2, 0.3 - f * 0.26], [0, -1, 0], [(i % 3 - 1) * 0.5, 0.25, -1]], { L: 0.12, colA: C.back, colB: C.fur, lod: 1 });
    for (const sx of [1, -1]) fringe(ctx, torso, df, 7, (i, f) => [[sx * 0.09, -1, 0.26 - f * 0.5], [0, 1, 0], [sx * 0.3, -0.8, -0.5]], { L: 0.1, colA: C.fur, colB: C.pale, lod: 1 });
    const tn = node('tail0', 'torso', [0, 0.6, -0.46], { rig: 'tail', detail: 0.7 * ctx.D }); tn.prims.push(ctx.M(C.fur, 0.01, 22)(S.ellipsoid(0.05, 0.045, 0.06).at(0, 0.58, -0.49))); ctx.nodes.push(tn);
    if (armor !== null) barding(ctx, A, armor, 1.2);
    void rnd;
    return A;
  }

  // ---------------- hound, fox, rat ----------------
  function hound(def, o, base, opt) {
    const ctx = mk(def, o, 'hound', base, { ...opt, belly: 0.2, C: (f) => ({ muzzle: tone(f, 0, -0.05, -0.13), pale: mix(f, 0xc9b08a, 0.35), back: tone(f, 0, 0, -0.07) }) });
    const { C } = ctx, armor = hexOf(o.armor, null);
    const A = frame(ctx, {
      o: [0, 0.52, 0], amp: 0.0025, f: 40,
      st: [[0.16, 0.5, 0.118, 0.165, 0.2], [0.19, 0.6, 0.075, 0.07, 0.12], [-0.1, 0.56, 0.086, 0.088, 0.19], [-0.3, 0.53, 0.1, 0.105, 0.13, undefined, 8], [0.31, 0.49, 0.09, 0.1, 0.09]],
      nk: [[0, 0.55, 0.26], [0, 0.62, 0.36], 0.1, 0.085], tl: [[0, 0.56, -0.37], [0, 0.55, -0.43], 0.04, 0.03], sh: [0.1, 0.53, 0.22, 1.05], hp: [0.085, 0.52, -0.29, 1.1],
      NB: [0, 0.58, 0.29], HJ: [0, 0.72, 0.46], nr: [0.09, 0.072], neck: { amp: 0.0025, f: 40 },
      legs: { type: 'paw', H: 0.52, zf: 0.23, zb: -0.3, lx: 0.095, k: 0.95, kl: 0.95 },
    });
    const hd = carnHead(ctx, {
      cr: [0.078, 0.068, 0.085], m0: [0.004, 0.11], m1: [-0.008, 0.225], mr: [0.054, 0.046], ears: { type: 'drop', s: 1.05, rot: [0, -10, -16], at: [0.076, 0.072, 0.02] }, fang: 0.04, cheek: 1.15, s: 1.12, look: { iris: 0xc87a1e },
      extra: (h) => { put(h.p, SM([ctx.M(C.muzzle, 0.002, 60)(S.ellipsoid(0.02, 0.034, 0.055).at(h.mr[1] * 0.95, h.gum - 0.012, h.m1[1] - 0.07).blend(0.02))])); if (armor !== null) put(h.p, plate(lay(0.06, 0.04, 0.08).at(0, 0.085, 0.05), armor, 0.006)); },
    });
    headNode(ctx, A.neck, A.NB, A.HJ, 14, hd, 1.3);
    tailChain(ctx, [[0, 0.56, -0.42], [0, 0.5, -0.52], [0, 0.4, -0.6], [0, 0.32, -0.7], [0, 0.3, -0.8]], [0.028, 0.022, 0.017, 0.012, 0.006], { amp: 0.002, f: 50, minRes: 30 });
    if (armor !== null) { collar(A, 0x2a2420, 0.45, 0.016, 9); barding(ctx, A, armor, 0.75); }
    return A;
  }
  function fox(def, o, base, opt) {
    const dk = 0x2a2220, wh = 0xf4efe6;
    const ctx = mk(def, o, 'fox', base, { ...opt, C: () => ({ belly: wh, pale: wh, leg: dk, sock: dk, earIn: 0x3a2a26 }) });
    const { C, M } = ctx, n = clamp(Math.round(+o.tails) || 1, 1, 9);
    const A = frame(ctx, {
      o: [0, 0.4, 0], amp: 0.008, f: 36,
      st: [[0.13, 0.39, 0.09, 0.105, 0.17], [0.15, 0.47, 0.06, 0.055, 0.1], [-0.08, 0.41, 0.075, 0.075, 0.16], [-0.25, 0.4, 0.08, 0.085, 0.11, undefined, 8], [0.25, 0.37, 0.075, 0.08, 0.075, C.pale]],
      nk: [[0, 0.42, 0.2], [0, 0.48, 0.3], 0.085, 0.075], sh: [0.08, 0.41, 0.185, 0.85], hp: [0.068, 0.4, -0.24, 0.9],
      NB: [0, 0.45, 0.24], HJ: [0, 0.57, 0.38], nr: [0.075, 0.06],
      legs: { type: 'paw', H: 0.4, zf: 0.19, zb: -0.25, lx: 0.075, k: 0.85, kl: 0.8, toe: 0.95 },
    });
    const hd = carnHead(ctx, {
      cr: [0.078, 0.066, 0.085], m1: [-0.008, 0.265], mr: [0.04, 0.024], ears: { type: 'prick', s: 1.45, at: [0.05, 0.08, 0.01], inCol: 0x2a2220 }, mzCol: C.fur, cheek: 1.3, s: 0.92, fang: 0.03, look: { iris: 0xf0b030 },
      extra: (h) => { for (const sx of [1, -1]) for (let i = 0; i < 4; i++) h.p.push(M(C.pale, 0.006, 40)(bone([sx * 0.06, 0.005 - i * 0.02, 0.05], [sx * (0.115 - i * 0.008), -0.012 - i * 0.03, 0.0], 0.024, 0.005).blend(0.02))); put(h.p, SM([ctx.ink(S.ellipsoid(0.02, 0.03, 0.05), C.dark, 0.006)?.at(0.05, 0.14, 0.0)])); },
    });
    headNode(ctx, A.neck, A.NB, A.HJ, 14, hd, 1.3);
    const tip = ctx.glow !== null ? mix(wh, ctx.glow, 0.5) : wh, base0 = [0, 0.42, -0.33], rad = [0.034, 0.064, 0.07, 0.014];
    for (let j = 0; j < n; j++) {
      const a = n === 1 ? 0 : (j - (n - 1) / 2) * (2.3 / (n - 1)), el = n === 1 ? -0.12 : 0.55 + 0.3 * Math.cos(a * 1.2), d = [Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)], dn = n === 1 ? [0, -0.05, 0] : [0, 0.03, 0];
      const pts = [base0, add3(base0, mul3(d, 0.15)), add3(add3(base0, mul3(d, 0.33)), dn), add3(add3(base0, mul3(d, 0.5)), mul3(dn, n === 1 ? 0.3 : 3.4))];
      const made = tailChain(ctx, pts, rad, { name: n === 1 ? 'tail' : `tl${j}_`, rig: n === 1 ? 'tail' : 'tails', amp: 0.011, f: 26, col: (i) => (i === 2 ? tip : i === 1 ? C.fur : C.back), detail: n > 4 ? 0.6 : 0.8, minRes: n > 1 ? 9 : 18 });
      if (ctx.glow !== null) made[2].prims.push(S.sphere(0.03).at(...pts[3]).color(ctx.glow).glow(0.9).pbr(0.3).blend(0.02));
    }
    if (ctx.glow !== null) frost(ctx, A.torso, distanceField(A.torso.prims), 6, 0.7);
    return A;
  }
  function rat(def, o, base, opt) {
    const pk = 0xc9958c;
    const ctx = mk(def, o, 'rat', base, { ...opt, C: (f) => ({ belly: mix(f, 0xc9b8a0, 0.3), leg: pk, sock: pk, earIn: 0xa86a66, muzzle: tone(f, 0, 0, -0.04), pale: mix(f, 0xc9b8a0, 0.4), eye: { iris: 0xd82418, rim: 0x5a0a06, white: 0x1a0504, glow: 0.6 } }) });
    const { C, rnd } = ctx;
    const A = frame(ctx, {
      o: [0, 0.34, 0], amp: 0.009, f: 30,
      st: [[0.15, 0.33, 0.12, 0.13, 0.17], [-0.08, 0.4, 0.15, 0.17, 0.23], [-0.27, 0.36, 0.15, 0.16, 0.15, undefined, 10], [0.27, 0.3, 0.09, 0.09, 0.08]],
      nk: [[0, 0.34, 0.22], [0, 0.36, 0.32], 0.11, 0.095], sh: [0.11, 0.33, 0.19, 1.0], hp: [0.13, 0.33, -0.24, 1.4],
      NB: [0, 0.36, 0.27], HJ: [0, 0.37, 0.42], nr: [0.1, 0.08],
      legs: { type: 'paw', H: 0.3, zf: 0.2, zb: -0.24, lx: 0.1, k: 1.2, kl: 1.0, toe: 1.5, claw: 1.3 },
    });
    const p = A.torso.prims, df = distanceField(p);
    if (!ctx.statue) for (let i = 0; i < 6; i++) { const sx = i % 2 ? 1 : -1, c = surfHit(df, [sx * (0.03 + rnd() * 0.1), 2, -0.3 + rnd() * 0.5], [0, -1, 0]), r = 0.03 + rnd() * 0.02; p.push(S.ellipsoid(r, r, r * 1.3).at(c[0], c[1], c[2]).color(i % 3 ? 0x9a6a62 : 0x6a6a42).pbr(0.7).tint(0.3, 40).paint(0.01, -0.003)); }   // mange and sores
    fringe(ctx, A.torso, df, 10, (i, f) => [[(i % 2 ? 0.03 : -0.03), 2, 0.2 - f * 0.5], [0, -1, 0], [(i % 2 ? 0.4 : -0.4), 0.5, -1]], { L: 0.07, colA: C.back, colB: C.dark, lod: 1 });
    const hd = carnHead(ctx, {
      cr: [0.072, 0.062, 0.085], m0: [0, 0.11], m1: [-0.016, 0.29], mr: [0.044, 0.022], ex: 0.04, ey: 0.045, ez: 0.11, er: 0.012, eyaw: 50,
      ears: { type: 'round', s: 1.5, rot: [-5, 30, -30], at: [0.06, 0.075, 0], col: pk }, incisors: false, fang: 0.012, noseCol: pk, s: 1.05,
      extra: (h) => {
        for (const sx of [1, -1]) {
          h.hard.push(H.box(0.011, 0.04, 0.008, 0.002).rot(-8, 0, 0).at(sx * 0.0065, h.gum - 0.016, h.m1[1] + 0.006).color(0xe8c860).pbr(0.3));
          h.jhard.push(H.box(0.009, 0.03, 0.007, 0.002).rot(12, 0, 0).at(sx * 0.0055, h.gum - 0.012, h.m1[1] - 0.012).color(0xe8c860).pbr(0.3).lod(1));
          for (let i = 0; i < 4; i++) h.hard.push(H.tube([[sx * 0.016, -0.02 - i * 0.004, h.m1[1] - 0.01], [sx * (0.07 + i * 0.01), -0.01 - i * 0.016 + 0.02, h.m1[1] - 0.03 - i * 0.012]], 0.0012, 2, 3).color(0xd8d0c0).pbr(0.6).lod(0));
        }
      },
    });
    headNode(ctx, A.neck, A.NB, A.HJ, 10, hd, 1.3);
    tailChain(ctx, [[0, 0.36, -0.4], [0, 0.22, -0.58], [0, 0.1, -0.78], [0, 0.06, -1.0], [0, 0.1, -1.2]], [0.042, 0.032, 0.023, 0.015, 0.006], { minRes: 26, style: (col) => (ctx.statue ? ctx.M(col) : (q) => q.color(pk).tint(0.15, 30).bump(0.004, 46, 'ridges').pbr(0.6)) });
    return A;
  }

  // ---------------- hoofed: stag, bull, boar ----------------
  function stag(def, o, base, opt) {
    const ctx = mk(def, o, 'stag', base, { ...opt, belly: 0.5, C: (f) => ({ leg: tone(f, 0, 0, -0.1), mane: tone(f, 0, -0.03, -0.15), muzzle: tone(f, 0, 0, -0.06) }) });
    const { C, M } = ctx;
    const A = frame(ctx, {
      o: [0, 0.72, 0], amp: 0.003, f: 30,
      st: [[0.2, 0.72, 0.13, 0.17, 0.2], [0.2, 0.86, 0.06, 0.06, 0.12], [-0.05, 0.76, 0.12, 0.13, 0.2], [-0.3, 0.76, 0.13, 0.15, 0.14], [0.36, 0.7, 0.09, 0.11, 0.08]],
      nk: [[0, 0.76, 0.3], [0, 0.86, 0.4], 0.12, 0.1], sh: [0.11, 0.74, 0.26, 1.25], hp: [0.1, 0.76, -0.3, 1.4],
      NB: [0, 0.82, 0.33], HJ: [0, 1.14, 0.46], nr: [0.092, 0.062], neck: { amp: 0.004, f: 30 },
      legs: { type: 'hoof', H: 0.62, zf: 0.25, zb: -0.3, lx: 0.085, k: 0.62, cloven: true },
    });
    const { torso, neck } = A, W = headW(42), hc = ctx.statue ? C.fur : C.horn;
    put(torso.prims, ctx.ink(S.ellipsoid(0.11, 0.12, 0.06), 0xf2ead8, 0.03)?.at(0, 0.74, -0.44));                    // the pale rump
    for (let i = 0; i < 6; i++) neck.prims.push(M(C.mane, 0.009, 22)(bone([(i % 2 ? 0.025 : -0.025), 1.02 - i * 0.07, 0.47 - i * 0.012], [(i % 2 ? 0.035 : -0.035), 0.92 - i * 0.07, 0.5 - i * 0.03], 0.045, 0.01).blend(0.03)));   // the shaggy throat
    const hd = ungHead(ctx, {
      len: 0.24, w: 0.86, d: 0.9, mw: 0.8, mzCol: ctx.statue ? C.fur : 0x2a2220, ears: { type: 'leaf', s: 1.25, rot: [-80, 10, -58], at: [0.045, 0.03, -0.02] },
      extra: (h) => {
        const T = (pts, r0, r1) => { const q = pts.map(W); h.hard.push(horn(q, r0, r1, hc, 10, 7), horn(q.map(mirX), r0, r1, hc, 10, 7)); };
        T([[0.035, 0.03, -0.01], [0.1, 0.2, -0.08], [0.2, 0.4, -0.12], [0.26, 0.58, -0.02], [0.24, 0.72, 0.08]], 0.021, 0.007);    // beam
        T([[0.05, 0.07, -0.025], [0.075, 0.1, 0.09], [0.09, 0.19, 0.16]], 0.014, 0.004);                                           // brow tine
        T([[0.1, 0.2, -0.08], [0.17, 0.26, 0.05], [0.2, 0.37, 0.1]], 0.014, 0.004);
        T([[0.2, 0.4, -0.12], [0.3, 0.46, -0.03], [0.34, 0.59, 0.02]], 0.013, 0.004);
        T([[0.26, 0.58, -0.02], [0.34, 0.66, -0.07], [0.38, 0.79, -0.05]], 0.012, 0.004);
        T([[0.25, 0.56, -0.04], [0.22, 0.66, -0.13], [0.2, 0.79, -0.17]], 0.012, 0.004);
        put(h.p, SM([M(hc, 0.002, 40, 'noise', 0.5)(S.sphere(0.024).at(...W([0.036, 0.03, -0.01])))]));
      },
    });
    headNode(ctx, neck, A.NB, A.HJ, 42, hd, 1.2);
    const tn = node('tail0', 'torso', [0, 0.84, -0.44], { rig: 'tail', detail: 0.7 * ctx.D }); tn.prims.push(M(C.fur, 0.005, 30)(bone([0, 0.84, -0.44], [0, 0.76, -0.5], 0.03, 0.014))); ctx.nodes.push(tn);
    return A;
  }
  function bull(def, o, base, opt) {
    const ctx = mk(def, o, 'bull', base, { ...opt, belly: 0.12, C: (f) => ({ muzzle: mix(f, 0xb89a8a, 0.45), back: tone(f, 0, 0, -0.05), mane: tone(f, 0, 0, -0.1) }) });
    const { C, M } = ctx, armor = hexOf(o.armor, null);
    const A = frame(ctx, {
      o: [0, 0.66, 0], amp: 0.0035, f: 30,
      st: [[0.24, 0.66, 0.23, 0.25, 0.27], [-0.04, 0.69, 0.2, 0.205, 0.4], [0.22, 0.87, 0.14, 0.13, 0.24], [-0.36, 0.68, 0.19, 0.2, 0.15], [0.44, 0.56, 0.1, 0.15, 0.1]],
      nk: [[0, 0.72, 0.38], [0, 0.76, 0.5], 0.2, 0.17], sh: [0.18, 0.68, 0.3, 1.5], hp: [0.15, 0.68, -0.36, 1.5],
      NB: [0, 0.78, 0.44], HJ: [0, 0.75, 0.68], nr: [0.175, 0.135], neck: { amp: 0.004, f: 30, throat: false },
      legs: { type: 'hoof', H: 0.5, zf: 0.3, zb: -0.36, lx: 0.14, k: 1.1, cloven: true },
    });
    const { neck } = A, W = headW(48), hc = ctx.statue ? C.fur : C.horn;
    neck.prims.push(M(C.fur, 0.004, 30)(S.ellipsoid(0.03, 0.1, 0.12).at(0, 0.6, 0.56).blend(0.05)));                   // dewlap
    const hd = ungHead(ctx, {
      len: 0.21, w: 1.55, d: 1.3, mw: 1.35, ears: { type: 'leaf', s: 1.1, rot: [-85, 0, -82], at: [0.085, 0.02, -0.015] },
      extra: (h) => {
        const q = [[0.075, 0.055, -0.01], [0.2, 0.09, 0.0], [0.31, 0.19, 0.08], [0.31, 0.33, 0.2]].map(W);
        h.hard.push(horn(q, 0.042, 0.005, hc, 12, 8), horn(q.map(mirX), 0.042, 0.005, hc, 12, 8));
        for (const sx of [1, -1]) h.hard.push(orient(H.cone(0.02, 0.09, 8), W([sx * 0.31, 0.3, 0.17]), sub3(q[3], q[2])).color(ctx.statue ? C.fur : C.hornDark).pbr(0.35).lod(2));
        for (let i = 0; i < 5; i++) h.p.push(M(C.mane, 0.008, 26)(S.sphere(0.03).at((i - 2) * 0.035, 0.065 * 1.3 - Math.abs(i - 2) * 0.01, 0.01 + (i % 2) * 0.02).blend(0.02)));   // curls on the poll
        h.hard.push(ringAt([0, -0.075 * 1.3, h.L + 0.06], [1, 0, 0], 0.03, 0.006, ctx.statue ? C.fur : BRASS).lod(1));
        if (armor !== null) { put(h.p, plate(bone([0, 0.04, 0.0], [0, 0.02, h.L * 0.85], 0.075, 0.055), armor, 0.008)); const cap = orient(H.cyl(0.046, 0.05, 0.05, 10), lerp3(q[0], q[1], 0.25), sub3(q[1], q[0])).color(BRASS).pbr(0.35, 1).lod(1); h.hard.push(cap, cap.mirrorX()); }
      },
    });
    headNode(ctx, neck, A.NB, A.HJ, 48, hd, 1.1);
    const TL = [[0, 0.82, -0.5], [0, 0.7, -0.56], [0, 0.5, -0.58], [0, 0.3, -0.57]], tn = tailChain(ctx, TL, [0.03, 0.022, 0.018, 0.016], { amp: 0.003, minRes: 26 });
    tuft(ctx, tn[2], TL[2], TL[3], 0.03, C.mane);
    if (armor !== null) barding(ctx, A, armor, 1.25);
    return A;
  }
  function boar(def, o, base, opt) {
    const ctx = mk(def, o, 'boar', base, { ...opt, belly: 0.12, C: (f) => ({ mane: tone(f, 0, -0.02, -0.16), leg: tone(f, 0, 0, -0.12), muzzle: tone(f, 0, -0.02, -0.06), snout: mix(f, 0x9a6a62, 0.6) }) });
    const { C, M, rnd } = ctx;
    const A = frame(ctx, {
      o: [0, 0.48, 0], amp: 0.009, f: 26,
      st: [[0.18, 0.5, 0.17, 0.2, 0.22], [0.17, 0.66, 0.09, 0.09, 0.17], [-0.08, 0.5, 0.14, 0.15, 0.2], [-0.26, 0.47, 0.13, 0.14, 0.12], [0.33, 0.45, 0.12, 0.13, 0.1]],
      nk: [[0, 0.5, 0.3], [0, 0.5, 0.4], 0.17, 0.15], sh: [0.14, 0.5, 0.22, 1.5], hp: [0.11, 0.47, -0.26, 1.3],
      NB: [0, 0.52, 0.34], HJ: [0, 0.5, 0.52], nr: [0.15, 0.12], neck: { amp: 0.009, f: 26, throat: false },
      legs: { type: 'hoof', H: 0.36, zf: 0.22, zb: -0.26, lx: 0.105, k: 0.95, cloven: true },
    });
    const { torso, neck } = A, br = M(C.mane, 0.012, 20), tk = ctx.statue ? C.fur : C.tooth;
    // the bristle ridge: a crest of stiff hair from the poll to the loin
    for (let i = 0; i < 9; i++) { const f = i / 8, z = 0.34 - f * 0.5, y = 0.7 + 0.06 * Math.sin(f * Math.PI) - f * 0.1; torso.prims.push(br(bone([0, y - 0.07, z + 0.02], [0, y + 0.05 + rnd() * 0.02, z - 0.045], 0.036, 0.008).blend(0.02))); put(torso.hard, ctx.lk([(rnd() - 0.5) * 0.02, y, z], [0, 1, -0.55], 0.11, 0.02, 0.012, C.mane, C.dark, [0, 0, -1], 0.2)?.lod(1)); }
    for (let i = 0; i < 3; i++) neck.prims.push(br(bone([0, 0.6, 0.38 + i * 0.05], [0, 0.72 - i * 0.02, 0.35 + i * 0.05], 0.036, 0.008).blend(0.02)));
    const hd = ungHead(ctx, {
      len: 0.27, w: 1.25, d: 1.2, mw: 0.85, amp: 0.006, f: 30, eyeR: 0.012, ears: { type: 'leaf', s: 1.15, rot: [-25, 10, -35], at: [0.062, 0.062, -0.02] }, s: 1.05,
      extra: (h) => {
        const L = h.L;
        put(h.p, M(C.snout, 0.002, 40, 'noise', 0.6)(S.cyl(0.046, 0.022, 0.006).rot(90, 0, 0).at(0, -0.022, L + 0.078).blend(0.012)), SM([S.ellipsoid(0.009, 0.013, 0.012).at(0.017, -0.02, L + 0.09).cut(0.003).color(0x0a0707)]));
        for (const sx of [1, -1]) {
          h.hard.push(spike([sx * 0.045, -0.085, L - 0.03], [sx * 0.75, 1, 0.15], 0.16, 0.023, tk, [-sx * 0.6, 0, -1], 0.45).pbr(0.3));       // the razors
          h.hard.push(spike([sx * 0.05, -0.04, L - 0.01], [sx * 1, 0.5, 0.1], 0.06, 0.014, tk, [0, 1, -0.4], 0.5).pbr(0.3).lod(2));
          put(h.hard, ctx.lk([sx * 0.04, -0.12, 0.12], [sx * 0.2, -1, -0.2], 0.07, 0.016, 0.01, C.mane, C.dark, [0, 0, -1], 0.2)?.lod(1));
        }
        for (let i = 0; i < 3; i++) h.p.push(br(bone([0, 0.04, 0.04 - i * 0.035], [0, 0.11, 0.0 - i * 0.04], 0.03, 0.007).blend(0.02)));
      },
    });
    headNode(ctx, neck, A.NB, A.HJ, 24, hd, 1.25);
    const TL = [[0, 0.56, -0.37], [0, 0.5, -0.44], [0, 0.4, -0.47]], tn = tailChain(ctx, TL, [0.022, 0.016, 0.012], { amp: 0.003, minRes: 30 });
    tuft(ctx, tn[1], TL[1], TL[2], 0.02, C.mane, 4);
    return A;
  }

  // ---------------- the giants: woolly rhinoceros, mammoth, elephant ----------------
  function rhino(def, o, base, opt) {
    const ctx = mk(def, o, 'rhino', base, { ...opt, rocky: true, belly: 0.1, C: (f) => ({ back: tone(f, 0, 0, -0.07), mane: tone(f, 0, 0, -0.12), muzzle: tone(f, 0, 0, -0.04) }) });
    const { C, M, rocky } = ctx, wool = !rocky;
    const A = frame(ctx, {
      o: [0, 0.62, 0], amp: 0.012, f: 15,
      st: [[0.25, 0.62, 0.26, 0.27, 0.3], [-0.02, 0.65, 0.255, 0.26, 0.46], [0.26, 0.86, 0.17, 0.14, 0.24], [-0.36, 0.62, 0.24, 0.25, 0.18], [0.46, 0.56, 0.17, 0.19, 0.12]],
      nk: [[0, 0.66, 0.44], [0, 0.64, 0.58], 0.22, 0.19], sh: [0.2, 0.62, 0.3, 1.6], hp: [0.18, 0.62, -0.36, 1.6],
      NB: [0, 0.68, 0.5], HJ: [0, 0.58, 0.74], nr: [0.19, 0.15], neck: { amp: 0.012, f: 15, throat: false },
      legs: { type: 'pillar', H: 0.45, zf: 0.3, zb: -0.36, lx: 0.175, r: 0.1, amp: 0.01, f: 16, kind: 'fur' },
    });
    const { torso, neck } = A, df = distanceField(torso.prims), hc = rocky ? tone(C.fur, 0, 0, 0.12) : C.horn;
    if (rocky) for (let i = 0; i < 7; i++) { const z = 0.4 - i * 0.12, r = surfHit(df, [0, 2, z], [0, -1, 0]); torso.prims.push(M(i % 2 ? C.back : C.fur)(S.box(0.2 - Math.abs(i - 3) * 0.02, 0.09, 0.1, 0.02).rot(-14, i * 23, 0).at(0, r[1] - 0.005, z).blend(0.02))); }   // slabs of rock along the spine
    if (wool) {
      fringe(ctx, torso, df, 9, (i, f) => [[(i % 3 - 1) * 0.07, 2, 0.42 - f * 0.36], [0, -1, 0], [(i % 3 - 1) * 0.5, 0.2, -1]], { L: 0.15, colA: C.mane, colB: C.fur });
      for (const sx of [1, -1]) { fringe(ctx, torso, df, 9, (i, f) => [[sx * 0.14, -1, 0.42 - f * 0.78], [0, 1, 0], [sx * 0.35, -0.85, -0.3]], { L: 0.16, colA: C.fur, colB: C.back }); fringe(ctx, torso, df, 12, (i, f) => [[sx * 2, 0.66 - (i % 3) * 0.1, 0.5 - f * 0.95], [-sx, 0, 0], [sx * 0.3, -1, -0.25]], { L: 0.17, w: 0.24, colA: C.back, colB: C.fur, lod: 1 }); }
    }
    const hd = ungHead(ctx, {
      len: 0.34, w: 1.6, d: 1.5, mw: 1.2, amp: 0.008, f: 20, eyeR: 0.012, ears: { type: 'leaf', s: 1.0, rot: [-20, 20, -30], at: [0.075, 0.085, -0.03] },
      extra: (h) => {
        const L = h.L;
        h.hard.push(spike([0, 0.02, L - 0.03], [0, 1, 0.42], 0.36, 0.062, hc, [0, 0, -1], 0.3, 0.72).pbr(rocky ? 0.9 : 0.42), spike([0, 0.045, L - 0.18], [0, 1, 0.2], 0.16, 0.045, hc, [0, 0, -1], 0.2, 0.72).pbr(rocky ? 0.9 : 0.42).lod(3));
        put(h.p, M(tone(C.fur, 0, 0, -0.05), 0.004, 30)(S.ellipsoid(0.06, 0.03, 0.07).at(0, 0.035, L - 0.03).blend(0.02)), M(tone(C.fur, 0, 0, -0.05), 0.004, 30)(S.ellipsoid(0.05, 0.03, 0.05).at(0, 0.06, L - 0.18).blend(0.02)));
        if (wool) for (let i = 0; i < 4; i++) put(h.hard, ctx.lk([(i - 1.5) * 0.04, 0.09, 0.02], [(i - 1.5) * 0.3, 0.6, -1], 0.1, 0.022, 0.014, C.mane, C.fur, [0, -1, 0], 0.25)?.lod(1));
      },
    });
    headNode(ctx, neck, A.NB, A.HJ, 26, hd, 1.0);
    const TL = [[0, 0.74, -0.52], [0, 0.6, -0.58], [0, 0.44, -0.58]], tn = tailChain(ctx, TL, [0.03, 0.02, 0.016], { amp: 0.004, minRes: 24 });
    tuft(ctx, tn[1], TL[1], TL[2], 0.026, C.mane, 4);
    return A;
  }

  function jumbo(def, o, base, opt, mam) {
    const sabre = mam && !!o.sabre, o2 = sabre && hexOf(o.glow, null) === null ? { ...o, glow: 0x9ad8ff } : o;
    const ctx = mk(def, o2, mam ? 'mammoth' : 'elephant', base, { ...opt, belly: 0.1, pale: 0.2, C: (f) => ({ back: tone(f, 0, 0, mam ? -0.08 : -0.03), mane: tone(f, 0, 0.02, -0.14), skin: mix(f, 0x6a625c, mam ? 0.6 : 0), earIn: mix(f, 0xb08a84, 0.35) }) });
    const { C, M, rnd } = ctx, amp = mam ? 0.014 : 0.0035, ff = mam ? 13 : 30, kind = mam ? 'fur' : 'noise';
    const skin = M(C.fur, amp, ff, kind), bare = M(mam ? C.skin : C.fur, 0.0035, 30, 'noise', 0.8);
    const g = mam ? {
      o: [0, 1.05, 0], st: [[0.25, 1.08, 0.3, 0.36, 0.33], [-0.06, 1.03, 0.29, 0.3, 0.46, undefined, -10], [0.22, 1.4, 0.17, 0.15, 0.24], [-0.4, 0.92, 0.26, 0.28, 0.2]],
      nk: [[0, 1.14, 0.42], [0, 1.2, 0.56], 0.27, 0.25], NB: [0, 1.2, 0.5], HJ: [0, 1.26, 0.66], nr: [0.25, 0.23], H: 0.8,
    } : {
      o: [0, 1.0, 0], st: [[0.25, 1.0, 0.3, 0.33, 0.33], [-0.05, 1.07, 0.3, 0.31, 0.34], [-0.38, 0.98, 0.28, 0.32, 0.22]],
      nk: [[0, 1.04, 0.42], [0, 1.1, 0.56], 0.26, 0.24], NB: [0, 1.1, 0.5], HJ: [0, 1.12, 0.66], nr: [0.24, 0.22], H: 0.76,
    };
    const A = frame(ctx, { ...g, amp, f: ff, sh: [0.23, g.H + 0.2, 0.33, 1.7], hp: [0.21, g.H + 0.12, -0.4, 1.7], belly: false, neck: { amp, f: ff, throat: false, nape: false }, detail: 0.72,
      legs: { type: 'pillar', H: g.H, zf: 0.33, zb: -0.4, lx: 0.19, r: 0.105, nails: 4, amp: mam ? 0.012 : 0.0035, f: mam ? 15 : 30, kind } });
    if (!mam) for (const n of [A.torso]) n.prims.forEach((q) => q.bump(amp, ff, kind));
    const { torso, neck } = A, df = distanceField(torso.prims), iv = ctx.statue ? C.fur : 0xf0e6c8;
    if (mam) {
      for (const sx of [1, -1]) { fringe(ctx, torso, df, 12, (i, f) => [[sx * 0.2, -1, 0.5 - f * 1.0], [0, 1, 0], [sx * 0.3, -0.9, -0.25]], { L: 0.24, w: 0.2, colA: C.fur, colB: C.back, lod: 2 }); fringe(ctx, torso, df, 8, (i, f) => [[sx * 2, 1.0 - (i % 2) * 0.12, 0.45 - f * 0.85], [-sx, 0, 0], [sx * 0.25, -1, -0.2]], { L: 0.22, w: 0.2, colA: C.back, colB: C.fur, lod: 1 }); }
      fringe(ctx, torso, df, 8, (i, f) => [[(i % 3 - 1) * 0.07, 3, 0.4 - f * 0.4], [0, -1, 0], [(i % 3 - 1) * 0.5, 0.3, -1]], { L: 0.18, colA: C.mane, colB: C.fur, lod: 1 });
    }
    // ---- head (its own frame, level): dome, cheeks, the root of the trunk, ears, tusks ----
    const hp = [], hh = [];
    put(hp, skin(S.sphere(0.2).at(0, 0.05, 0.1)), skin(S.sphere(0.2).at(0, 0.02, -0.04).blend(0.05)),
      mam ? skin(S.ellipsoid(0.15, 0.18, 0.15).at(0, 0.24, 0.07).blend(0.06)) : SM([skin(S.sphere(0.115).at(0.075, 0.2, 0.1).blend(0.05))]),
      skin(S.ellipsoid(0.14, 0.13, 0.15).at(0, -0.09, 0.13).blend(0.05)), bare(bone([0, 0.02, 0.24], [0, -0.1, 0.36], 0.115, 0.095).blend(0.05)),
      bare(bone([0, -0.17, 0.14], [0, -0.26, 0.23], 0.06, 0.03).blend(0.03)),
      SM([bare(S.ellipsoid(0.05, 0.07, 0.08).rot(30, 0, 0).at(0.1, -0.1, 0.25).blend(0.04))]));                                    // tusk sockets
    const E = ctx.C.eye.glow > 0.5 || ctx.statue ? ctx.C.eye : { iris: 0x5a3414, rim: 0x1a0d06, white: 0x1a0f0a, glow: 0 };
    put(hp, SM([S.ellipsoid(0.026, 0.024, 0.03).at(0.168, 0.04, 0.2).cut(0.006).color(ctx.statue ? E.white : 0x120b08), S.sphere(0.022).at(0.152, 0.04, 0.2).color(E.iris).glow((E.glow || 0) * 0.8).pbr(0.2).blend(0)]));
    put(hh, H.mirrorX([eye(0.022, { pupilSize: 1.3, irisSize: 1.5, ...E }).rot(0, 62, 0).at(0.153, 0.04, 0.2).lod(1)]));
    if (E.glow) put(hh, H.mirrorX([H.sphere(0.02, 10).at(0.16, 0.04, 0.2).color(E.iris).glow(E.glow).pbr(0.3).from(2)]));
    const er = mam ? [0.022, 0.12, 0.1] : [0.024, 0.28, 0.23];
    const ear = [skin(S.ellipsoid(er[0], er[1], er[2]).at(0, -er[1] * 0.25, -er[2] * 0.75)), ctx.ink(S.ellipsoid(er[0] * 2, er[1] * 0.7, er[2] * 0.6), C.earIn, 0.02)?.at(-er[0], -er[1] * 0.3, -er[2] * 0.7), ctx.ink(S.ellipsoid(er[0] * 2, er[1] * 0.3, er[2] * 0.25), C.earIn, 0.02)?.at(0, -er[1] * 1.0, -er[2] * 0.8)].filter(Boolean).map((q) => q.rot(0, mam ? -20 : -34, 6).at(0.185, 0.1, 0.04));
    put(hp, ear, mirrorAll(ear));
    const tk = mam ? [[0.1, -0.1, 0.25], [0.21, -0.44, 0.44], [0.29, -0.6, 0.74], [0.2, -0.5, 1.02], [0.04, -0.26, 1.1]] : [[0.1, -0.1, 0.25], [0.14, -0.31, 0.4], [0.16, -0.38, 0.62], [0.13, -0.33, 0.82]];
    const tr0 = mam ? 0.05 : 0.036;
    hh.push(horn(tk, tr0, 0.008, iv, mam ? 16 : 12, 8), horn(tk.map(mirX), tr0, 0.008, iv, mam ? 16 : 12, 8));
    if (sabre) for (const sx of [1, -1]) hh.push(spike([sx * 0.06, -0.2, 0.2], [sx * 0.05, -1, 0.2], 0.3, 0.03, 0xf4f0e4, [0, 0, -1], 0.25, 0.7).pbr(0.25), H.sphere(0.02, 8).at(sx * 0.06, -0.49, 0.25).color(ctx.glow).glow(0.9).lod(1));
    if (mam) for (let i = 0; i < 7; i++) put(hh, ctx.lk([(i % 3 - 1) * 0.06, 0.4, 0.1 - Math.floor(i / 3) * 0.07], [(i % 3 - 1) * 0.6, 0.35, i < 3 ? 1 : -1], 0.16, 0.035, 0.022, C.mane, C.fur, [0, -1, 0], 0.5)?.lod(1));
    const armor = hexOf(o.armor, null), trim = hexOf(o.trim, 0xa8282a), gold = 0xd8b23a;
    if (armor !== null && !mam) {
      put(hp, plate(S.ellipsoid(0.17, 0.2, 0.1).at(0, 0.12, 0.21), armor, 0.012), plate(bone([0, 0.0, 0.3], [0, -0.1, 0.4], 0.09, 0.08), armor, 0.01));
      hh.push(H.lathe([[0, 0], [0.05, 0], [0.055, 0.01], [0.03, 0.022], [0.012, 0.03], [0.009, 0.1], [0, 0.14]], 14).rot(70, 0, 0).at(0, 0.16, 0.3).color(gold).pbr(0.3, 1).lod(2));
      { const band = orient(H.cyl(0.036, 0.04, 0.05, 12), lerp3(tk[1], tk[2], 0.5), sub3(tk[2], tk[1])).color(gold).pbr(0.3, 1).lod(2); hh.push(band, band.mirrorX()); }
    }
    const head = node('head', 'neck', [0, 0, 0], { rig: ctx.Kk.head, pos: sub3(g.HJ, g.NB), rot: [0, 0, 0], detail: 0.85 * ctx.D });
    head.prims = hp; head.hard = hh; ctx.nodes.push(head);
    // trunk
    const TP = [[0, -0.1, 0.36], [0, -0.3, 0.45], [0, -0.52, 0.47], [0, -0.72, 0.44], [0, -0.9, 0.4], [0, -(mam ? 1.08 : 0.98), 0.44]], trr = [0.095, 0.08, 0.068, 0.056, 0.046, 0.04];
    const tnodes = tailChain(ctx, TP, trr, { name: 'trunk', rig: 'trunk', parent: 'head', detail: 0.75, style: () => (q) => bare(q).bump(ctx.statue ? 0 : 0.005, 30, 'ridges') });
    tnodes[4].prims.push(S.sphere(0.022).at(TP[5][0], TP[5][1] - 0.03, TP[5][2] + 0.01).cut(0.006).color(0x2a1a1a));
    // tail
    const ty = mam ? 1.04 : 1.14, TL = [[0, ty, -0.58], [0, ty - 0.2, -0.66], [0, ty - 0.45, -0.67], [0, ty - 0.66, -0.65]], tn = tailChain(ctx, TL, [0.04, 0.028, 0.02, 0.016], { amp: 0.004, minRes: 20, style: () => bare });
    tuft(ctx, tn[2], TL[2], TL[3], 0.03, C.mane, 5);
    // ---- howdah ----
    if (o.howdah) {
      const hw = node('howdah', 'torso', g.o, { detail: 0.6 * ctx.D }); ctx.nodes.push(hw);
      const hpP = hw.prims, hhH = hw.hard, z0 = mam ? -0.12 : -0.06, top = surfHit(df, [0, 3, z0], [0, -1, 0])[1], fy = top + 0.03;
      const bw = 0.62, bl = 0.74, wd = (w, h, d, col = WOOD) => H.geo(new THREE.BoxGeometry(w, h, d)).color(col).pbr(0.85);
      for (const zz of [0.2, -0.26]) { const pts = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, d = [Math.sin(a), Math.cos(a), 0]; pts.push(surfHit(df, [d[0] * 3, 1.03 + d[1] * 3, z0 + zz], mul3(d, -1), 40)); } put(hpP, loop(pts, 0.02, mam ? ROPE : tone(trim, 0, 0, -0.15), 0.9)); }    // girths under the belly
      if (mam) {
        hhH.push(wd(bw, 0.05, bl).at(0, fy, z0));
        for (let i = 0; i < 5; i++) hhH.push(wd(0.11, 0.012, bl + 0.02, i % 2 ? WOOD_DARK : tone(WOOD, 0, 0, 0.04)).at((i - 2) * 0.125, fy + 0.03, z0).lod(1));
        for (const sx of [1, -1]) for (const sz of [1, -1]) hhH.push(wd(0.05, 0.3, 0.05, WOOD_DARK).at(sx * (bw / 2 - 0.02), fy + 0.15, z0 + sz * (bl / 2 - 0.02)));
        for (const sx of [1, -1]) { hhH.push(wd(0.035, 0.05, bl, WOOD_DARK).at(sx * (bw / 2 - 0.02), fy + 0.29, z0), wd(0.03, 0.035, bl, WOOD).at(sx * (bw / 2 - 0.02), fy + 0.16, z0).lod(2)); for (const zz of [0.18, -0.18]) hhH.push(H.cyl(0.11, 0.11, 0.022, 14).rot(0, 0, 90).at(sx * (bw / 2 + 0.02), fy + 0.17, z0 + zz).color(zz > 0 ? trim : tone(trim, 0.08, 0, -0.1)).pbr(0.7), H.sphere(0.03, 10).scale(0.6, 1, 1).at(sx * (bw / 2 + 0.035), fy + 0.17, z0 + zz).color(IRON).pbr(0.4, 1).lod(2)); }
        for (const sz of [1, -1]) hhH.push(wd(bw, 0.05, 0.035, WOOD_DARK).at(0, fy + 0.29, z0 + sz * (bl / 2 - 0.02)), wd(bw, 0.035, 0.03).at(0, fy + 0.16, z0 + sz * (bl / 2 - 0.02)).lod(2));
        // two of the crew: a spearman forward, a javelin-thrower behind
        for (const [cz, cx, tw] of [[0.16, 0.08, 1], [-0.18, -0.1, -1]]) {
          const b = [cx, fy + 0.03, z0 + cz], sk = 0xc99670, hide = tw > 0 ? 0x6a4a30 : 0x5a5038;
          put(hpP, S.capsule(add3(b, [0, 0.04, 0]), add3(b, [0, 0.27, 0]), 0.085, 0.075).color(hide).pbr(0.9).bump(0.006, 30, 'fur'), S.sphere(0.058).at(b[0], b[1] + 0.4, b[2]).color(sk).pbr(0.7).blend(0.01),
            S.ellipsoid(0.066, 0.05, 0.068).at(b[0], b[1] + 0.435, b[2] - 0.006).color(tone(hide, 0, 0, -0.1)).pbr(0.9).bump(0.008, 30, 'fur').blend(0.006),
            S.capsule(add3(b, [tw * 0.09, 0.26, 0]), add3(b, [tw * 0.17, 0.2, 0.1]), 0.03, 0.026).color(sk).pbr(0.7).blend(0.01), S.capsule(add3(b, [-tw * 0.09, 0.26, 0]), add3(b, [-tw * 0.15, 0.14, 0.06]), 0.03, 0.026).color(sk).pbr(0.7).blend(0.01));
          hhH.push(H.cyl(0.009, 0.009, 0.78, 6).rot(tw > 0 ? 14 : -28, 0, tw * 6).at(b[0] + tw * 0.17, b[1] + 0.38, b[2] + 0.1).color(WOOD_DARK).pbr(0.8), H.cone(0.02, 0.09, 6).rot(tw > 0 ? 14 : -28, 0, tw * 6).at(b[0] + tw * 0.17 - tw * 0.045, b[1] + 0.38 + 0.41, b[2] + 0.1 + (tw > 0 ? 0.1 : -0.2)).color(0xb8bec6).pbr(0.3, 1).lod(2));
        }
      } else {
        const cl = (u, a) => (a > 0.9 || u < 0.05 || u > 0.95 ? gold : a > 0.8 && a < 0.84 ? gold : trim);
        const mkc = (n, m, far) => drape(df, { z0: z0 + 0.42, z1: z0 - 0.42, yc: 1.02, hug: 80, vh: 0.5, off: 0.012, flare: 0.02, ripple: far ? 0 : 0.006, folds: 7, us: gridLines(n, far ? [] : [0.05, 0.946]), vs: gridLines(m, far ? [] : [0.8, 0.836, 0.9], true), drop: () => 0.3, dag: null, col: cl });
        hhH.push(mkc(20, 36, false).near(), mkc(5, 8, true).far());
        hhH.push(wd(bw, 0.06, bl, tone(trim, 0, 0, -0.12)).at(0, fy + 0.005, z0), wd(bw + 0.03, 0.025, bl + 0.03, gold).pbr(0.35, 1).at(0, fy + 0.04, z0));
        for (const sx of [1, -1]) { hhH.push(wd(0.03, 0.2, bl - 0.04, trim).at(sx * (bw / 2 - 0.015), fy + 0.14, z0), wd(0.04, 0.03, bl, gold).pbr(0.35, 1).at(sx * (bw / 2 - 0.015), fy + 0.25, z0)); for (const sz of [1, -1]) hhH.push(H.cyl(0.02, 0.024, 0.62, 10).at(sx * (bw / 2 - 0.02), fy + 0.33, z0 + sz * (bl / 2 - 0.02)).color(gold).pbr(0.35, 1), H.sphere(0.03, 10).at(sx * (bw / 2 - 0.02), fy + 0.27, z0 + sz * (bl / 2 - 0.02)).color(gold).pbr(0.3, 1).lod(2)); for (const zz of [0.17, -0.17]) hhH.push(H.cyl(0.07, 0.07, 0.012, 16).rot(0, 0, 90).at(sx * (bw / 2 + 0.004), fy + 0.14, z0 + zz).color(gold).pbr(0.35, 1).lod(2)); }
        for (const sz of [1, -1]) hhH.push(wd(bw - 0.04, 0.2, 0.03, trim).at(0, fy + 0.14, z0 + sz * (bl / 2 - 0.015)), wd(bw, 0.03, 0.04, gold).pbr(0.35, 1).at(0, fy + 0.25, z0 + sz * (bl / 2 - 0.015)));
        hhH.push(H.cone(0.6, 0.26, 4).rot(0, 45, 0).scale(1, 1, bl / bw * 1.02).at(0, fy + 0.77, z0).color(trim).pbr(0.8), H.cyl(0.6, 0.62, 0.03, 4).rot(0, 45, 0).scale(1, 1, bl / bw * 1.02).at(0, fy + 0.635, z0).color(gold).pbr(0.35, 1),
          H.lathe([[0, 0], [0.035, 0], [0.04, 0.02], [0.015, 0.04], [0.03, 0.07], [0, 0.13]], 12).at(0, fy + 0.89, z0).color(gold).pbr(0.3, 1));
        put(hpP, S.box(0.3, 0.07, 0.3, 0.03).at(0, fy + 0.07, z0).color(tone(trim, 0.05, 0, 0.1)).pbr(0.9));                                // a cushion
      }
    }
    if (ctx.glow !== null) frost(ctx, torso, df, 9, 0.5);
    void rnd; void neck;
    return A;
  }

  // =====================================================================================
  //  quadruped kinds
  // =====================================================================================
  const SPEC = {
    lion: { make: (d, o, b, x) => cat(d, o, b, x, 'lion'), top: 0.69, size: 0.76, hw: 0.15, gait: 'cat', strike: 'pounce', fur: 0xc8963a, mount: 0.98 },
    tiger: { make: (d, o, b, x) => cat(d, o, b, x, 'tiger'), top: 0.69, size: 0.78, hw: 0.16, gait: 'cat', strike: 'pounce', fur: 0xe08a2a },
    leopard: { make: (d, o, b, x) => cat(d, o, b, x, 'leopard'), top: 0.69, size: 0.64, hw: 0.13, gait: 'cat', strike: 'pounce', fur: 0xd8a850 },
    bear: { make: bear, top: 0.79, size: 0.86, hw: 0.2, gait: 'bear', strike: 'rear', fur: 0x5a4030, mount: 1.06 },
    hound: { make: hound, top: 0.67, size: 0.64, hw: 0.12, gait: 'hound', strike: 'bite', fur: 0x6a5040 },
    fox: { make: fox, top: 0.525, size: 0.5, hw: 0.09, gait: 'fox', strike: 'pounce', fur: 0xe8823a },
    rat: { make: rat, top: 0.57, size: 0.5, hw: 0.15, gait: 'rat', strike: 'bite', fur: 0x5a4a3a },
    stag: { make: stag, top: 0.92, size: 0.9, hw: 0.13, gait: 'deer', strike: 'gore', fur: 0x7a5a3a, mount: 1.04 },
    bull: { make: bull, top: 1.0, size: 0.92, hw: 0.23, gait: 'bull', strike: 'gore', fur: 0x3a2a22, mount: 1.08 },
    boar: { make: boar, top: 0.75, size: 0.66, hw: 0.17, gait: 'boar', strike: 'gore', fur: 0x4a3a2a, mount: 0.88 },
    rhino: { make: rhino, top: 1.01, size: 0.9, hw: 0.26, gait: 'rhino', strike: 'gore', fur: 0x7a6a58, mount: 1.2 },
    mammoth: { make: (d, o, b, x) => jumbo(d, o, b, x, true), top: 1.55, size: 1.18, hw: 0.3, gait: 'heavy', strike: 'stomp', fur: 0x5a4030 },
    elephant: { make: (d, o, b, x) => jumbo(d, o, b, x, false), top: 1.38, size: 1.1, hw: 0.3, gait: 'heavy', strike: 'stomp', fur: 0x7a7068 },
  };
  function complete(A) {
    const ctx = A.ctx, t = A.torso;
    if (ctx.rot) rotify(ctx.rnd, t.prims, t.hard, distanceField(t.prims), t.box, (t.box.top - t.box.bot) / 0.34);
    addLegs(ctx, A.L, A.legDet ?? 1);
    return A;
  }
  function quad(def, o = {}) {
    const sp = SPEC[o.kind];
    if (!sp) return o.kind === 'horse' ? wildHorse(def, o) : null;
    const s = sp.size / sp.top, A = complete(sp.make(def, o, hexOf(o.fur ?? o.mount, sp.fur), { s }));
    return { kind: 'beast.quad', attack: 'bite', gait: sp.gait, strike: sp.strike, girth: (sp.hw * s) / 0.115, ...feet(A.feet, s), nodes: finish(A.ctx.nodes, s) };
  }
  function wildHorse(def, o) {
    const s = 1.0, rot = !!o.rot, stone = !!o.stone, base = hexOf(o.fur ?? o.mount, 0x6b4a2e);
    const hs = buildHorse(def, { ...o, mount: rot ? mix(tone(base, 0, -0.2, -0.03), 0x58604a, 0.32) : base }, {
      bare: true, keys: { body: 'torso', neck: 'neck', head: 'head' },
      skin: stone ? (col) => (q) => q.color(mix(base, col, 0.1)).tint(0.06, 5).pbr(0.2, 0) : undefined, hair: stone ? (q) => q.color(tone(base, 0, 0, -0.04)).pbr(0.2, 0) : undefined,
      eye: rot ? { iris: 0xdff2d8, rim: 0x8aa890, white: 0x30382e, glow: 0.8 } : undefined,
    });
    if (rot) { const t = hs.nodes.find((n) => n.name === 'torso'); rotify(hs.rnd, t.prims, t.hard, distanceField(t.prims), { top: 0.9, bot: 0.47, z0: -0.47, z1: 0.42 }, 1.2); }
    return { kind: 'beast.quad', attack: 'bite', gait: 'horse', strike: 'rear', ...feet([-0.11, 0.03, -0.11, 0.03], s), nodes: finish(hs.nodes, s) };
  }
  // =====================================================================================
  //  mounts
  // =====================================================================================
  /** how big an animal a rider needs: 1 for a human, more for an orc or an ogre */
  function riderFactor(o) {
    const P = proportions({ species: o.species }), P0 = proportions({});
    return clamp(Math.sqrt((P.chestW * P.height) / (P0.chestW * P0.height)), 0.9, 1.42);
  }
  const ringOn = (df, cy, z, n = 16) => { const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, d = [Math.sin(a), Math.cos(a), 0]; pts.push(surfHit(df, [d[0] * 3, cy + d[1] * 3, z], mul3(d, -1), 40)); } return pts; };
  /**
   * Saddle a built animal for the rider R: cloth, a seat raised until the rider's knees clear the barrel, girth,
   * stirrups where his feet are, a neck strap and reins. Returns the seat (where the rider's hip joint goes).
   */
  function tackUp(A, R, s, o, z0, st = {}) {
    const ctx = A.ctx, torso = A.torso, df = distanceField(torso.prims), b = torso.box, P = R.P, u = R.f / s;
    const cloth = hexOf(o.cloth, 0x2f5aa8), gold = hexOf(st.trim, 0xd8b23a), cy = (b.top + b.bot) / 2;
    const top = surfHit(df, [0, b.top + 1, z0], [0, -1, 0])[1], rT = P.rThigh * u;
    let lift = 0.025 + rT * 0.9, seatA = [0, top + lift, z0];
    for (let i = 0; i < 14; i++) { seatA = [0, top + lift, z0]; const kn = riderToMount(R, seatA, s, R.knee(1)); if (df(kn[0], kn[1], kn[2]) > rT * 0.3) break; lift += 0.012; }
    const tack = node('tack', 'torso', torso.o, { detail: 0.8 * ctx.D }); ctx.nodes.push(tack);
    const p = tack.prims, h = tack.hard, sl = 0.17 * u * Math.pow(Math.max(1, P.hipW / 0.225), 0.7), sw = clamp(P.hipX * u + rT * 1.25, 0.07, b.wd * 0.9), seatY = seatA[1] - rT * 0.95;
    if (st.cloth !== false) {
      const mkc = (n, m, far) => drape(df, {
        z0: z0 + sl * 1.25, z1: z0 - sl * 1.3, yc: cy, hug: 92, vh: 0.62, off: 0.009, flare: 0.012, ripple: far ? 0 : 0.004, folds: 5,
        us: gridLines(n, far ? [] : [0.06, 0.935]), vs: gridLines(m, far ? [] : [0.88], true), drop: (uu) => (st.drop ?? 0.09) * (1 - 0.3 * Math.abs(uu - 0.5) * 2), dag: null,
        col: (uu, a) => (a > 0.882 || uu < 0.062 || uu > 0.937 ? gold : st.ragged ? tone(cloth, 0, -0.1, -0.08) : cloth),
      });
      h.push(mkc(16, 30, false).near(), mkc(4, 8, true).far());
    }
    const lea = (q, col = LEATHER) => q.color(col).tint(0.12, 40).pbr(0.55);
    put(p, lea(lay(sw, (seatY - top) / 2 + 0.03, sl * 0.9).at(0, (seatY + top) / 2 - 0.012, z0)),
      lea(lay(sw * 0.8, 0.06 * u + lift * 0.3, 0.03 * u).rot(-16, 0, 0).at(0, seatY + 0.035 * u, z0 + sl * 0.82), LEATHER_DARK).blend(0.014),
      lea(lay(sw * 0.98, 0.07 * u + lift * 0.3, 0.032 * u).rot(16, 0, 0).at(0, seatY + 0.04 * u, z0 - sl * 0.85), LEATHER_DARK).blend(0.014),
      loop(ringOn(df, cy, z0 + sl * 0.25), 0.013, LEATHER_DARK), loop(ringOn(df, cy, z0 - sl * 0.5), 0.011, LEATHER_DARK));
    put(h, rivets([[sw * 0.6, seatY + 0.06 * u, z0 + sl * 0.9], [0, seatY + 0.1 * u, z0 + sl * 0.92], [-sw * 0.6, seatY + 0.06 * u, z0 + sl * 0.9]], 5, 0.0055));
    for (const side of [1, -1]) {
      const ft = riderToMount(R, seatA, s, R.foot(side)), tp = [side * sw * 0.95, seatY - 0.02, z0 + 0.03 * u], e0 = [ft[0], ft[1] + 0.075 * u, ft[2] - 0.004];
      put(p, strap([tp, lerp3(tp, e0, 0.5), e0], 0.0075, LEATHER, { n: 4 }));
      h.push(ringAt([ft[0], ft[1] + 0.032 * u, ft[2]], [0, 0.1, 1], 0.04 * u, 0.007, IRON).near(), H.box(0.076 * u, 0.009, 0.04 * u, 0.003).at(ft[0], ft[1] - 0.005, ft[2]).color(IRON).pbr(0.45, 1).near());
    }
    if (st.reins !== false && A.neck) {
      collar(A, st.ragged ? ROPE : cloth, st.collarAt ?? 0.3, 0.012, 0);
      const c = lerp3(A.NB, A.HJ, st.collarAt ?? 0.3), nd = distanceField(A.neck.prims);
      for (const sg of [1, -1]) { const a = surfHit(nd, add3(c, [sg * 2, 0.03, 0]), [-sg, 0, 0]); h.push(H.tube([a, [sg * sw * 0.7, lerp(a[1], seatY, 0.5) + 0.05, lerp(a[2], z0, 0.55)], [0.045 * u + sg * 0.012, seatY + 0.14 * u, z0 + sl * 0.95]], 0.005, 8, 5).color(st.ragged ? ROPE : cloth).pbr(0.8).near()); }
    }
    return { seatA, tack, top, sl, sw, seatY };
  }
  const SEAT = { lion: 0.03, bear: -0.04, stag: 0.0, bull: -0.06, boar: -0.05, rhino: -0.08 };
  function beastMount(def, o, kind) {
    const sp = SPEC[kind], rf = riderFactor(o), s = (sp.mount * rf) / sp.top, R = makeRider(def, o, 1);
    const A = sp.make(def, { rot: o.rot, armor: hexOf(o.mountArmor, undefined), collar: undefined }, hexOf(o.mount, sp.fur), { s, keys: MOUNT_KEYS, detail: 0.74 });
    const T = tackUp(A, R, s, o, SEAT[kind] ?? 0, { ragged: kind === 'boar' || kind === 'rhino', drop: kind === 'stag' ? 0.07 : 0.1 });
    complete(A);
    const nodes = finish(A.ctx.nodes, s);
    seatRider(nodes, R, 'torso', A.torso.o, T.seatA, s);
    return { kind: 'beast.rider', attack: R.desc.attack, hold: R.desc.hold || 'none', gait: sp.gait, mount: kind, strike: sp.strike, girth: (sp.hw * s) / 0.115, ...feet(A.feet, s), nodes };
  }

  // ---------------- the raptor: a two-legged saurian ----------------
  function raptorMount(def, o) {
    const rf = riderFactor(o), s = 1.04 * rf, R = makeRider(def, o, 1), base = hexOf(o.mount, 0x3a6a4a);
    const ctx = mk(def, { rot: o.rot }, 'raptor', base, { s, keys: MOUNT_KEYS, detail: 0.76, kind: 'scales', rough: 0.6, belly: 0.5, C: (f) => ({ back: tone(f, 0, 0, -0.1), stripe: tone(f, 0.02, 0, -0.2), muzzle: tone(f, 0, 0, -0.04), pale: mix(f, 0xe8dcb0, 0.55), claw: 0x1a1512, eye: { iris: 0xf2c21a, rim: 0x8a4a06, white: 0x1a1008, glow: 0.4, slit: true } }) });
    const { C, M, rnd } = ctx, sk = M(C.fur, 0.006, 26), pl = [tone(C.fur, 0.45, 0.1, -0.05), 0xd8902a, 0xb8281e, 0x3a2416];
    const torso = torsoOf(ctx, { o: [0, 0.8, 0], amp: 0.006, f: 26, st: [[0.02, 0.8, 0.15, 0.17, 0.3], [0.26, 0.84, 0.12, 0.14, 0.16], [-0.26, 0.8, 0.12, 0.125, 0.2]], nk: [[0, 0.84, 0.3], [0, 0.94, 0.4], 0.12, 0.1], tl: [[0, 0.8, -0.3], [0, 0.8, -0.46], 0.115, 0.1] });
    const tp = torso.prims;
    for (let i = 0; i < 7; i++) put(tp, ctx.ink(S.ellipsoid(0.12, 0.05, 0.016).rot(0, 0, 0), C.stripe, 0.008)?.at(0, 0.95, 0.3 - i * 0.1));
    const NB = [0, 0.92, 0.36], HJ = [0, 1.24, 0.5], neck = neckOf(ctx, NB, HJ, 0.092, 0.062, { amp: 0.006, f: 26 });
    for (let i = 0; i < 8; i++) { const c = lerp3(NB, HJ, 0.15 + i * 0.11), L = 0.13 + 0.05 * Math.sin(i * 0.5); neck.hard.push(feather(add3(c, [(i % 2 ? 0.015 : -0.015), 0.05, -0.05]), norm3([(i % 2 ? 0.25 : -0.25), 0.55, -1]), L, 0.05, [0, 1, 0.3], pl, 0.6, 2.4).lod(i % 2 ? 1 : 3)); }
    const hd = carnHead(ctx, {
      cr: [0.068, 0.058, 0.08], cc: [0.025, 0.04], m0: [0.0, 0.09], m1: [-0.012, 0.3], mr: [0.052, 0.036], ex: 0.046, ey: 0.05, ez: 0.085, er: 0.015, eyaw: 60, ears: false, fang: 0.028, nose: 0.4, noseCol: C.back, mzCol: C.fur, jawCol: C.pale, padCol: C.fur, s: 1.15,
      extra: (h) => {
        for (const sx of [1, -1]) for (let i = 0; i < 6; i++) { h.hard.push(spike([sx * (0.03 + i * 0.002), h.gum, 0.27 - i * 0.03], [sx * 0.1, -1, 0], 0.018, 0.006, C.tooth, [0, 0, -1], 0.2).lod(1)); h.jhard.push(spike([sx * (0.022 + i * 0.002), h.gum - 0.01, 0.255 - i * 0.03], [sx * 0.05, 1, 0], 0.014, 0.005, C.tooth, [0, 0, -1], 0.1).lod(1)); }
        put(h.p, SM([sk(S.ellipsoid(0.014, 0.012, 0.05).rot(0, -8, 0).at(0.04, 0.075, 0.1).blend(0.012))]));                    // brow ridges
        for (let i = 0; i < 5; i++) h.hard.push(feather([(i - 2) * 0.016, 0.075, 0.0], norm3([(i - 2) * 0.3, 0.75, -1]), 0.13 - Math.abs(i - 2) * 0.015, 0.04, [0, 1, 0.3], pl, 0.6, 2.4).lod(1));
      },
    });
    headNode(ctx, neck, NB, HJ, 20, hd, 1.3, 6);
    // legs: thigh forward to the knee, shin back to the ankle, a long foot down to three toes and a killing claw
    const HP = [0.13, 0.8, -0.04], KN = [0.16, 0.52, 0.12], AK = [0.15, 0.27, -0.1], FT = [0.15, 0.05, -0.01], L = legParts();
    put(L.up.prims, sk(bone(HP, KN, 0.1, 0.07)), sk(S.ellipsoid(0.085, 0.17, 0.14).rot(-25, 0, -4).at(0.15, 0.7, 0.03).blend(0.04)), sk(S.sphere(0.068).at(...KN).blend(0.02)));
    put(L.lo.prims, sk(S.sphere(0.066).at(...KN)), sk(bone(KN, AK, 0.062, 0.036).blend(0.03)), sk(S.ellipsoid(0.04, 0.09, 0.055).rot(40, 0, 0).at(0.155, 0.43, 0.02).blend(0.02)), sk(S.sphere(0.04).at(...AK).blend(0.012)));
    put(L.paw.prims, sk(S.sphere(0.039).at(...AK)), sk(bone(AK, FT, 0.034, 0.04).blend(0.02)), sk(S.ellipsoid(0.05, 0.035, 0.055).at(0.15, 0.04, 0.0).blend(0.02)));
    for (const [a, len] of [[-0.45, 0.11], [0, 0.13], [0.45, 0.11]]) {
      const dx = Math.sin(a), dz = Math.cos(a), k1 = [0.15 + dx * len * 0.5, 0.045, 0.02 + dz * len * 0.5], k2 = [0.15 + dx * len, 0.028, 0.02 + dz * len];
      put(L.paw.prims, sk(bone([0.15, 0.04, 0.02], k1, 0.024, 0.021).blend(0.012)), sk(bone(k1, k2, 0.021, 0.017).blend(0.01)));
      L.paw.hard.push(spike([k2[0], 0.034, k2[2]], [dx, -0.25, dz], 0.06, 0.013, C.claw, [0, -1, 0], 0.5).lod(2));
    }
    L.paw.hard.push(spike([0.115, 0.1, 0.03], [-0.3, 0.6, 1], 0.1, 0.018, C.claw, [0, -1, 0], 0.7).lod(2));        // the sickle claw, held clear of the ground
    for (const side of [1, -1]) {
      const cp = (list) => (side > 0 ? flat(list).map((q) => q.clone()) : mirrorAll(list)), m = (v) => (side > 0 ? v : mirX(v)), nm = side > 0 ? 'FL' : 'FR';
      const up = node(`leg${nm}`, 'torso', m(HP), { rig: 'legs', detail: 0.8 * ctx.D, minRes: 16 }), lo = node(`shin${nm}`, `leg${nm}`, m(KN), { rig: 'shins', detail: 0.88 * ctx.D, minRes: 19 }), pw = node(`paw${nm}`, `shin${nm}`, m(AK), { rig: 'paws', detail: 0.95 * ctx.D, minRes: 18 });
      up.prims = cp(L.up.prims); lo.prims = cp(L.lo.prims); pw.prims = cp(L.paw.prims); pw.hard = cp(L.paw.hard);
      // the little arms, feathered like a wing that never grew
      const SH = [0.115, 0.78, 0.31], EL = [0.14, 0.66, 0.27], HN = [0.13, 0.58, 0.37], arm = node(`marm${nm}`, 'torso', m(SH), { detail: 0.8 * ctx.D, minRes: 22 }), ap = [sk(bone(SH, EL, 0.036, 0.028)), sk(bone(EL, HN, 0.028, 0.02).blend(0.01)), sk(S.sphere(0.024).at(...HN).blend(0.01))], ah = [];
      for (let i = 0; i < 3; i++) ah.push(spike([HN[0] + (i - 1) * 0.014, HN[1] - 0.01, HN[2] + 0.015], [(i - 1) * 0.3, -0.5, 1], 0.045, 0.008, C.claw, [0, -1, 0], 0.5).lod(1));
      for (let i = 0; i < 6; i++) { const b = lerp3(EL, HN, i / 5); ah.push(feather(add3(b, [0.012, 0.0, -0.01]), norm3([0.5, -0.25 - i * 0.05, -1]), 0.17 - i * 0.012, 0.055, [1, 0.3, 0], pl, 0.6, 2.6).lod(i % 2 ? 1 : 3)); }
      arm.prims = cp(ap); arm.hard = cp(ah);
      ctx.nodes.push(up, lo, pw, arm);
    }
    const TL = [[0, 0.8, -0.42], [0, 0.79, -0.64], [0, 0.77, -0.86], [0, 0.75, -1.08], [0, 0.75, -1.3]], tr = [0.1, 0.075, 0.052, 0.032, 0.012];
    const tn = tailChain(ctx, TL, tr, { amp: 0.006, f: 26, col: (i) => (i % 2 ? C.fur : C.back) });
    for (let i = 0; i < 5; i++) tn[3].hard.push(feather([0, 0.76, -1.12 - i * 0.03], norm3([(i - 2) * 0.5, 0.25, -1]), 0.2, 0.06, [0, 1, 0], pl, 0.55, 2.6).lod(i % 2 ? 1 : 3));
    const A = { ctx, torso, neck, NB, HJ };
    if (ctx.rot) rotify(rnd, tp, torso.hard, distanceField(tp), torso.box, 0.9);
    const T = tackUp(A, R, s, o, 0.04, { drop: 0.07 });
    const nodes = finish(ctx.nodes, s);
    seatRider(nodes, R, 'torso', torso.o, T.seatA, s);
    return { kind: 'beast.rider', attack: R.desc.attack, hold: R.desc.hold || 'none', gait: 'raptor', mount: 'raptor', strike: 'bite', girth: (0.15 * s) / 0.115, ...feet([-0.27, 0.1, -0.27, 0.1], s), footHeel: -0.02, footToe: 0.1, nodes };
  }

  // ---------------- horses of other kinds ----------------
  function addWings(nodes, WC, root, k, det = 0.64) {
    for (const side of [1, -1]) {
      const wg = griffonWing(WC, rng(hashStr('griffon-wing'))), mv = (list) => { const l = flat(list); for (const q of l) q.at(-wg.S[0], -wg.S[1], -wg.S[2]).scale(k).at(root[0], root[1], root[2]); return side > 0 ? l : mirrorAll(l); };
      const W2 = add3(root, mul3(sub3(wg.W, wg.S), k)), nm = side > 0 ? 'L' : 'R';
      const w = node(`wing${nm}`, 'torso', side > 0 ? root : mirX(root), { rig: 'wings', detail: det }), tp = node(`wingtip${nm}`, `wing${nm}`, side > 0 ? W2 : mirX(W2), { rig: 'wingtips', detail: det, minRes: 18 });
      w.prims = mv(wg.arm.prims); w.hard = mv(wg.arm.hard); tp.prims = mv(wg.tip.prims); tp.hard = mv(wg.tip.hard);
      nodes.push(w, tp);
    }
  }
  const wingPal = (b, dark) => ({ chestDark: tone(b, 0, -0.02, -0.1), chest: tone(b, 0, 0, -0.03), cream: mix(b, 0xffffff, 0.45), bar: tone(b, 0, -0.03, -0.14), umber: dark ?? tone(b, 0, -0.05, -0.3) });
  /** a toothed wheel in the XY plane */
  function gearGeo(teeth) {
    const pts = [], n = teeth * 4;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = i % 4 < 2 ? 1 : 0.78; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const hole = []; for (let i = 0; i < 10; i++) { const a = -(i / 10) * Math.PI * 2; hole.push([Math.cos(a) * 0.3, Math.sin(a) * 0.3]); }
    return H.extrude(pts, 0.18, 0.02, [hole]);
  }
  const gear = (c, r, teeth, col, sx = 1) => gearGeo(teeth).scale(r).rot(0, 90, 0).at(c[0] - sx * r * 0.09, c[1], c[2]).color(col).pbr(0.35, 1);
  const leftRight = (nodes, name, pieces) => { for (const [nm, sd] of [[name + 'L', 1], [name + 'R', -1]]) { const n = nodes.find((x) => x.name === nm); if (n) n.hard.push(...(sd > 0 ? pieces.map((q) => q.clone()) : mirrorAll(pieces))); } };

  function horseMount(def, o, v) {
    const rf = riderFactor(o), big = rf > 1.02 ? 1 + (rf - 1) * 0.6 : 1, s = 1.14 * big, R = makeRider(def, o, 1), seatA = [0, 0.945, 0];
    const base = hexOf(o.mount, v === 'clockHorse' ? 0xb08a4a : v === 'longma' ? 0x2a8a6a : 0x6b4a2e), W = headW(58), cloth = hexOf(o.cloth, 0x2f5aa8);
    let hs, desc = { gait: 'horse', mount: v };
    if (v === 'longma') {
      const gold = 0xe0b040, mane = mix(base, 0xf2e6b0, 0.75);
      hs = buildHorse(def, o, {
        bare: true, skin: (col) => (q) => q.color(col).tint(0.22, 12).bump(0.0055, 30, 'scales').pbr(0.5),
        palette: (C) => { Object.assign(C, { point: tone(C.coat, 0, 0, -0.14), mane, maneTip: tone(mane, 0.02, 0.1, -0.12), sock: tone(C.coat, 0, 0, -0.14), muzzle: tone(C.coat, 0, 0, -0.1), belly: mix(C.coat, gold, 0.6), hoof: 0x3a2a14, hoofPale: 0x3a2a14, light: mix(C.coat, gold, 0.3), pink: tone(C.coat, 0, 0, -0.1) }); },
        hair: (q, col) => q.color(col ?? mane).tint(0.2, 30).bump(0.006, 28, 'fur').pbr(0.6), eye: { iris: 0xf2c21a, rim: 0x8a4a06, glow: 0.6, slit: true },
      });
      const head = hs.nodes.find((n) => n.name === 'head'), torso = hs.nodes.find((n) => n.name === 'torso');
      const T = (pts, r0, r1, col = gold) => { const q = pts.map(W); head.hard.push(horn(q, r0, r1, col, 10, 7), horn(q.map(mirX), r0, r1, col, 10, 7)); };
      T([[0.035, 0.04, -0.02], [0.07, 0.2, -0.12], [0.1, 0.36, -0.24], [0.1, 0.46, -0.4]], 0.02, 0.005);                 // antlers, swept back
      T([[0.07, 0.2, -0.12], [0.14, 0.28, -0.1], [0.17, 0.4, -0.14]], 0.013, 0.004);
      T([[0.1, 0.36, -0.24], [0.16, 0.42, -0.3], [0.18, 0.52, -0.42]], 0.012, 0.004);
      for (const [pts, r] of [[[[0.04, -0.03, 0.34], [0.13, -0.01, 0.38], [0.22, -0.08, 0.3], [0.26, -0.2, 0.2]], 0.007], [[[0.035, -0.05, 0.35], [0.1, -0.1, 0.4], [0.13, -0.22, 0.36]], 0.005]]) head.hard.push(horn(pts, r, 0.002, 0xc8382a, 12, 5).lod(2), horn(pts.map(mirX), r, 0.002, 0xc8382a, 12, 5).lod(2));   // whiskers
      for (let i = 0; i < 4; i++) head.prims.push(S.capsule([0, -0.11, 0.2 - i * 0.03], [0, -0.2 - (i % 2) * 0.03, 0.17 - i * 0.04], 0.014, 0.003).color(mane).pbr(0.6).blend(0.01));   // a beard
      for (let i = 0; i < 9; i++) torso.hard.push(orient(H.cone(0.022, 0.07, 4), [0, 0.905 - Math.abs(i - 4) * 0.004, -0.14 - i * 0.034], [0, 1, -0.6]).color(gold).pbr(0.4, 0.6).lod(2));   // a ridge of fins over the croup
      put(torso.prims, S.ellipsoid(0.12, 0.05, 0.4).at(0, 0.5, 0).color(mix(base, gold, 0.7)).pbr(0.5).bump(0.006, 24, 'ridges').paint(0.03));
      addWings(hs.nodes, { chestDark: tone(base, 0, 0, -0.1), chest: base, cream: mix(base, 0xf2e6b0, 0.6), bar: gold, umber: 0xc8382a }, [0.13, 0.85, 0.26], 0.62);
      Object.assign(desc, { gait: 'pegasus', feathered: true });
    } else if (v === 'clockHorse') {
      const cu = 0x9a5a34, st = 0xb8bec6, dk = 0x4a3a2a;
      hs = buildHorse(def, o, {
        bare: true, skin: (col) => (q) => q.color(col).tint(0.1, 14).pbr(0.34, 1),
        palette: (C) => { Object.assign(C, { coat: base, shade: tone(base, 0, 0, -0.12), light: tone(base, 0, 0, 0.08), belly: tone(base, 0, 0, -0.08), point: dk, mane: cu, maneTip: tone(cu, 0, 0, 0.1), muzzle: st, sock: st, hoof: 0x2a2a30, hoofPale: 0x2a2a30, pink: st, blaze: st }); },
        hair: (q, col) => q.color(col ?? cu).tint(0.1, 30).pbr(0.38, 1), eye: { iris: 0xffa030, rim: 0x8a3a06, white: 0x2a1a0a, glow: 1 },
      });
      const torso = hs.nodes.find((n) => n.name === 'torso'), neck = hs.nodes.find((n) => n.name === 'neck'), head = hs.nodes.find((n) => n.name === 'head'), tp = torso.prims, th = torso.hard, df = distanceField(tp);
      const seam = (q) => q.color(0x2a2018).pbr(0.6, 0.5).paint(0.003, -0.006);
      for (const z of [0.3, 0.14, -0.14, -0.3]) tp.push(seam(S.box(0.6, 0.6, 0.012, 0.002).at(0, 0.68, z)));                    // plate seams round the barrel
      tp.push(seam(S.box(0.6, 0.012, 0.9, 0.002).at(0, 0.6, 0)), seam(S.box(0.012, 0.3, 0.9, 0.002).at(0, 0.95, 0)));
      for (const sx of [1, -1]) {
        for (const z of [0.3, 0.14, -0.14, -0.3]) for (let i = 0; i < 5; i++) { const c = surfHit(df, [sx * 2, 0.52 + i * 0.075, z + 0.022], [-sx, 0, 0]); th.push(H.sphere(0.008, 6).at(c[0], c[1], c[2]).color(st).pbr(0.3, 1).lod(1)); }
        for (const [y, z, r, t, col] of [[0.72, 0.27, 0.085, 10, cu], [0.62, 0.36, 0.05, 8, st], [0.74, -0.3, 0.1, 12, cu], [0.6, -0.2, 0.055, 8, st], [0.66, 0.0, 0.07, 10, dk]]) { const c = surfHit(df, [sx * 2, y, z], [-sx, 0, 0]); th.push(gear([c[0] + sx * 0.012, c[1], c[2]], r, t, col, sx).lod(r > 0.08 ? 3 : 2), H.cyl(r * 0.2, r * 0.2, 0.03, 8).rot(0, 0, 90).at(c[0] + sx * 0.02, c[1], c[2]).color(st).pbr(0.3, 1).lod(2)); }
        th.push(H.tube([[sx * 0.1, 0.84, -0.3], [sx * 0.13, 0.95, -0.36], [sx * 0.13, 1.0, -0.44]], 0.02, 6, 8).color(dk).pbr(0.4, 1).lod(3));   // exhausts
      }
      th.push(H.cyl(0.012, 0.012, 0.16, 8).at(0, 0.97, -0.3).color(st).pbr(0.3, 1), H.torus(0.045, 0.012, 12, 6).rot(0, 90, 0).at(0, 1.07, -0.26).color(cu).pbr(0.35, 1), H.torus(0.045, 0.012, 12, 6).rot(0, 90, 0).at(0, 1.07, -0.34).color(cu).pbr(0.35, 1));   // the winding key
      for (let i = 0; i < 5; i++) { const c = lerp3([0, 0.84, 0.4], [0, 1.14, 0.5], i / 4); neck.prims.push(seam(S.box(0.5, 0.012, 0.5, 0.002).rot(-62, 0, 0).at(c[0], c[1], c[2]))); }
      head.prims.push(seam(S.box(0.3, 0.3, 0.01, 0.002).at(0, 0, 0.2)), seam(S.box(0.3, 0.008, 0.5, 0.002).at(0, -0.045, 0.2)));
      leftRight(hs.nodes, 'shinF', [gear([0.165, 0.3, 0.25], 0.05, 8, cu).lod(2)]); leftRight(hs.nodes, 'shinB', [gear([0.17, 0.318, -0.375], 0.05, 8, cu).lod(2)]);
      leftRight(hs.nodes, 'pawF', [H.cyl(0.03, 0.03, 0.11, 8).rot(0, 0, 90).at(0.12, 0.11, 0.252).color(st).pbr(0.3, 1).lod(2)]); leftRight(hs.nodes, 'pawB', [H.cyl(0.03, 0.03, 0.11, 8).rot(0, 0, 90).at(0.126, 0.11, -0.35).color(st).pbr(0.3, 1).lod(2)]);
    } else {
      hs = buildHorse(def, o);
      if (v === 'pegasus') { addWings(hs.nodes, wingPal(tone(o.mount ?? 0x6b4a2e, 0.005, 0.1, 0.02)), [0.13, 0.85, 0.27], 1.12); Object.assign(desc, { gait: 'pegasus', feathered: true }); }
    }
    horseTack(hs, R, seatA, o, big);
    if (o.barding && v === 'horse') bardHorse(hs, o);
    if (o.rot) { const t = hs.nodes.find((n) => n.name === 'torso'); rotify(hs.rnd, t.prims, t.hard, distanceField(t.prims), { top: 0.9, bot: 0.47, z0: -0.47, z1: 0.42 }, 1.2); }
    const nodes = finish(hs.nodes, s);
    seatRider(nodes, R, 'torso', hs.BO, seatA, s);
    return { kind: 'beast.rider', attack: R.desc.attack, hold: R.desc.hold || 'none', ...desc, ...feet([-0.11, 0.03, -0.11, 0.03], s), nodes };
  }
  /** full barding: a cloth trapper to the knees in the rider's colours, a steel peytral, crinet and crupper */
  function bardHorse(hs, o) {
    const cloth = hexOf(o.cloth, 0x2f5aa8), c2 = hexOf(o.cloth2, hexOf(o.trim, tone(cloth, 0.5, -0.1, 0.25))), steel = hexOf(o.armor, 0x9aa3ad), gold = 0xd8b23a;
    const torso = hs.nodes.find((n) => n.name === 'torso'), neck = hs.nodes.find((n) => n.name === 'neck'), df = distanceField(torso.prims);
    const bard = node('bard', 'torso', hs.BO, { detail: 0.7 }); hs.nodes.push(bard);
    const col = (u, a, v) => { if (a > 0.955 || u < 0.012 || u > 0.988) return gold; if (a > 0.84) return c2; return a > 0.77 && a < 0.8 ? gold : cloth; };
    const mkc = (n, m, far) => drape(df, { z0: 0.44, z1: -0.46, yc: 0.67, hug: 96, vh: 0.5, off: 0.005, flare: 0.035, ripple: far ? 0 : 0.008, folds: 11, us: gridLines(n, far ? [] : [0.012, 0.984]), vs: gridLines(m, far ? [] : [0.77, 0.8, 0.84, 0.955], true), drop: (u) => 0.27 - 0.05 * Math.sin(u * Math.PI), dag: far ? null : (u) => 0.03 * Math.abs(Math.sin(u * 9 * Math.PI)), col });
    bard.hard.push(mkc(40, 44, false).near(), mkc(8, 10, true).far());
    // the cloth closes across the breast and runs up the neck
    put(torso.prims, lay(0.2, 0.21, 0.12).at(0, 0.66, 0.4).color(cloth).pbr(0.85).paint(0.02, 0.006), lay(0.16, 0.15, 0.1).at(0, 0.68, -0.44).color(cloth).pbr(0.85).paint(0.02, 0.006));
    put(neck.prims, bone([0, 0.74, 0.36], [0, 1.02, 0.5], 0.2, 0.12).color(cloth).pbr(0.85).paint(0.006, 0.006), bone([0, 1.01, 0.5], [0, 1.04, 0.51], 0.13, 0.13).color(c2).pbr(0.85).paint(0.004, 0.008));
    // steel: peytral across the chest, lames down the crest of the neck, a crupper plate with a boss
    put(torso.prims, plate(lay(0.19, 0.075, 0.1).at(0, 0.74, 0.43), steel, 0.014), plate(lay(0.14, 0.05, 0.16).at(0, 0.9, -0.3), steel, 0.014));
    for (let i = 0; i < 6; i++) { const c = lerp3([0, 0.93, 0.27], [0, 1.2, 0.44], i / 5); neck.prims.push(plate(S.ellipsoid(0.05, 0.035, 0.04).rot(-58, 0, 0).at(c[0], c[1], c[2]), i % 2 ? tone(steel, 0, 0, -0.06) : steel, 0.014)); }
    bard.hard.push(H.lathe([[0, 0], [0.04, 0], [0.045, 0.008], [0.02, 0.02], [0, 0.05]], 12).rot(90, 0, 0).at(0, 0.76, 0.535).color(gold).pbr(0.3, 1).lod(2), H.sphere(0.022, 10).scale(1, 0.6, 1).at(0, 0.955, -0.3).color(gold).pbr(0.3, 1).lod(2));
  }

  // ---------------- skeletal horse ----------------
  function boneHorse(def, o) {
    const s = 1.14, R = makeRider(def, o, 1), seatA = [0, 0.945, 0], base = hexOf(o.mount, 0xe8e0c8), glow = hexOf(o.glow, 0x7af0c8), cloth = hexOf(o.cloth, 0x5a4a6a);
    const bn = (q, c = base) => q.color(c).tint(0.14, 30).bump(0.002, 40, 'noise').pbr(0.7), dkb = tone(base, 0, -0.05, -0.16);
    const nodes = [node('root', null, [0, 0, 0])], BO = [0, 0.68, 0];
    const torso = node('torso', 'root', BO, { rig: 'body', detail: 0.8 }); nodes.push(torso);
    const tp = torso.prims, th = torso.hard;
    const SP = [[0, 0.87, 0.3], [0, 0.86, 0.1], [0, 0.85, -0.1], [0, 0.88, -0.3], [0, 0.84, -0.45]];
    for (let i = 0; i < 4; i++) tp.push(bn(bone(SP[i], SP[i + 1], 0.028, 0.028).blend(0.01)));
    for (let i = 0; i < 13; i++) { const z = 0.3 - i * 0.058, y = 0.865 + (i > 9 ? 0.02 : 0); tp.push(bn(S.capsule([0, y, z], [0, y + 0.05 + (i < 3 ? 0.04 : 0), z - 0.012], 0.016, 0.008).blend(0.008))); }   // the spines of the vertebrae
    for (let i = 0; i < 9; i++) { const z = 0.3 - i * 0.052, w = 0.17 - Math.abs(i - 3) * 0.008, d = 0.3 - Math.abs(i - 3.5) * 0.018; const pts = [[0.02, 0.85, z], [w * 0.8, 0.8, z - 0.01], [w, 0.84 - d * 0.5, z - 0.03], [w * 0.7, 0.84 - d * 0.88, z - 0.04], [0.03, 0.84 - d, z - 0.02 + (i > 5 ? 0.06 : 0)]]; const rib = H.tube(i > 6 ? pts.slice(0, 4) : pts, 0.011, 10, 5).color(base).pbr(0.7); th.push(rib.lod(3), rib.mirrorX().lod(3)); }
    tp.push(bn(bone([0, 0.55, 0.3], [0, 0.56, 0.05], 0.022, 0.016)));                                                  // breastbone
    put(tp, SM([bn(S.ellipsoid(0.03, 0.12, 0.07).rot(-25, 0, -8).at(0.13, 0.76, 0.3)), bn(S.ellipsoid(0.035, 0.09, 0.1).rot(25, 0, -20).at(0.09, 0.82, -0.33)), bn(bone([0.03, 0.86, -0.3], [0.13, 0.74, -0.3], 0.03, 0.035).blend(0.02))]));   // shoulder blades, pelvis
    const NB = [0, 0.82, 0.33], PJ = [0, 1.19, 0.515], neck = node('neck', 'torso', NB, { rig: 'mneck', detail: 0.9 }); nodes.push(neck);
    for (let i = 0; i < 7; i++) { const a = lerp3([0, 0.86, 0.32], PJ, i / 7), b = lerp3([0, 0.86, 0.32], PJ, (i + 0.8) / 7); neck.prims.push(bn(bone(a, b, 0.034, 0.03)), bn(S.capsule(add3(a, [0, 0.0, -0.02]), add3(a, [0, 0.03, -0.06]), 0.014, 0.006).blend(0.006))); }
    const ctx = mk(def, {}, 'bones', base, { C: () => ({ muzzle: base, eye: { iris: glow, rim: tone(glow, 0, 0, -0.3), white: 0x08100e, glow: 1 } }) });
    ctx.M = (c2) => (q) => bn(q, c2 ?? base); ctx.ink = () => null; ctx.glow = glow;
    const hd = ungHead(ctx, { col: base, mzCol: base, eyeR: 0.02, ears: false, extra: (h) => {
      put(h.p, SM([S.ellipsoid(0.03, 0.03, 0.036).at(0.05, 0.004, 0.108).cut(0.006).color(0x0c0a0a), S.ellipsoid(0.014, 0.02, 0.04).at(0.02, 0.02, 0.33).cut(0.004).color(0x0c0a0a), S.ellipsoid(0.03, 0.05, 0.06).at(0.07, -0.07, 0.14).cut(0.008).color(dkb)]), S.box(0.2, 0.012, 0.2, 0.002).at(0, -0.04, 0.26).cut(0.003).color(0x1a1512));
      for (const sx of [1, -1]) { h.hard.push(H.sphere(0.011, 8).at(sx * 0.044, 0.004, 0.108).color(glow).glow(1.2).pbr(0.3)); for (let i = 0; i < 6; i++) h.hard.push(H.box(0.008, 0.016, 0.012, 0.002).at(sx * 0.034, -0.045, 0.2 + i * 0.016).color(base).pbr(0.5).lod(1)); }
    } });
    const head = node('head', 'neck', [0, 0, 0], { rig: 'mhead', pos: sub3(PJ, NB), rot: [58, 0, 0], detail: 1.25 }); head.prims = hd.p; head.hard = hd.hard; nodes.push(head);
    const KN = [0.12, 0.3, 0.25], FF = [0.12, 0.11, 0.252], HP = [0.108, 0.7, -0.3], ST = [0.14, 0.5, -0.215], HK = [0.126, 0.318, -0.375], FH = [0.126, 0.11, -0.35];
    const knob = (c, r) => bn(S.sphere(r).at(c[0], c[1], c[2]).blend(0.012)), hoofB = (x, z) => S.cone(0.056, 0.042, 0.065, 0.008).rot(10, 0, 0).at(x, 0.032, z).color(dkb).pbr(0.5).blend(0.006);
    const fl = legParts(), bl = legParts();
    put(fl.up.prims, bn(bone([0.125, 0.62, 0.27], [0.126, 0.535, 0.235], 0.03, 0.026)), knob([0.126, 0.535, 0.235], 0.036), bn(bone([0.126, 0.535, 0.235], KN, 0.026, 0.022).blend(0.01)), knob(KN, 0.036));
    put(fl.lo.prims, knob(KN, 0.034), bn(bone(KN, FF, 0.02, 0.018).blend(0.01)), knob(FF, 0.03)); put(fl.paw.prims, knob(FF, 0.029), bn(bone(FF, [0.12, 0.06, 0.27], 0.02, 0.026).blend(0.01)), hoofB(0.12, 0.282));
    put(bl.up.prims, knob(HP, 0.04), bn(bone(HP, ST, 0.03, 0.028).blend(0.01)), knob(ST, 0.04), bn(bone(ST, HK, 0.026, 0.02).blend(0.01)), knob(HK, 0.034));
    put(bl.lo.prims, knob(HK, 0.033), bn(S.capsule(HK, [0.126, 0.36, -0.42], 0.018, 0.012).blend(0.01)), bn(bone(HK, FH, 0.02, 0.018).blend(0.01)), knob(FH, 0.03)); put(bl.paw.prims, knob(FH, 0.029), bn(bone(FH, [0.126, 0.06, -0.332], 0.02, 0.026).blend(0.01)), hoofB(0.126, -0.32));
    for (const [nm, part, side, js] of [['FL', fl, 1, [[0.122, 0.6, 0.25], KN, FF]], ['FR', fl, -1, [[0.122, 0.6, 0.25], KN, FF]], ['BL', bl, 1, [HP, HK, FH]], ['BR', bl, -1, [HP, HK, FH]]]) {
      const cp = (list) => (side > 0 ? flat(list).map((q) => q.clone()) : mirrorAll(list)), m = (v) => (side > 0 ? v : mirX(v));
      const up = node(`leg${nm}`, 'torso', m(js[0]), { rig: 'legs', detail: 0.9, minRes: 26 }), lo = node(`shin${nm}`, `leg${nm}`, m(js[1]), { rig: 'shins', detail: 0.95, minRes: 28 }), pw = node(`paw${nm}`, `shin${nm}`, m(js[2]), { rig: 'paws', detail: 0.95, minRes: 24 });
      up.prims = cp(part.up.prims); lo.prims = cp(part.lo.prims); pw.prims = cp(part.paw.prims); nodes.push(up, lo, pw);
    }
    const TL = [[0, 0.84, -0.45], [0, 0.78, -0.56], [0, 0.66, -0.64], [0, 0.52, -0.68]];
    for (let i = 0; i < 3; i++) { const n = node(`tail${i}`, i === 0 ? 'torso' : `tail${i - 1}`, TL[i], { rig: 'tail', detail: 0.9, minRes: 28 }); n.prims.push(bn(S.sphere(0.02).at(...TL[i])), bn(bone(TL[i], TL[i + 1], 0.018, 0.012).blend(0.008))); for (let j = 0; j < 3; j++) n.hard.push(lock(lerp3(TL[i], TL[i + 1], 0.3 + j * 0.25), [(j - 1) * 0.3, -1, -0.3], 0.16 + i * 0.05, 0.016, 0.01, 0x2a2622, 0x4a443c, [0, 0, -1], 0.15).lod(1)); nodes.push(n); }
    // a rotted saddle: pad, girth, stirrup leathers, tatters of the old caparison
    const tack = node('tack', 'torso', BO, { detail: 0.8 }); nodes.push(tack);
    const lea = (q) => q.color(LEATHER_DARK).tint(0.2, 40).pbr(0.7);
    put(tack.prims, lea(lay(0.1, 0.03, 0.14).at(0, 0.895, 0)), lea(lay(0.08, 0.06, 0.028).rot(-16, 0, 0).at(0, 0.93, 0.13)).blend(0.014), lea(lay(0.1, 0.066, 0.03).rot(16, 0, 0).at(0, 0.935, -0.13)).blend(0.014), loop(ellipse([0, 0.7, 0.08], 0.18, 0.19), 0.012, LEATHER_DARK, 0.7));
    for (const sg of [1, -1]) {
      const ft = riderToMount(R, seatA, 1, R.foot(sg)), tpt = [sg * 0.1, 0.88, 0.04], e0 = [ft[0], ft[1] + 0.085, ft[2] - 0.005];
      put(tack.prims, strap([tpt, lerp3(tpt, e0, 0.5), e0], 0.008, LEATHER, { n: 4 })); tack.hard.push(ringAt([ft[0], ft[1] + 0.036, ft[2]], [0, 0.1, 1], 0.045, 0.0075, IRON).near());
      tack.hard.push(H.sheet(0.3, 0.26, 6, 5, (uu, vv) => [0, 0, Math.sin(uu * 9) * 0.012 * (1 - vv) + (vv < 0.25 ? Math.abs(Math.sin(uu * 14)) * -0.0 : 0)]).rot(0, sg * 90, 0).rot(0, 0, -sg * 8).at(sg * 0.2, 0.74, 0).color(cloth).pbr(0.9).shade((x, y) => (y < -0.09 + 0.04 * Math.sin(x * 40) ? tone(cloth, 0, -0.1, -0.12) : null)).lod(3));
    }
    const out = finish(nodes, s);
    seatRider(out, R, 'torso', BO, seatA, s);
    return { kind: 'beast.rider', attack: R.desc.attack, hold: R.desc.hold || 'none', gait: 'horse', mount: 'horse', bones: true, ...feet([-0.11, 0.03, -0.11, 0.03], s), nodes: out };
  }

  // ---------------- griffon kin: the hippogriff and the wingless half-griffon ----------------
  function griffonKin(def, o, v) {
    const hip = v === 'hippogriff', rf = riderFactor(o), s = 1.1 * Math.max(1, rf), R = makeRider(def, o, 1);
    let ff = [-0.072, 0.03], hf = [-0.235, 0.06];
    const mini = (C) => mk(def, {}, v, C.fur, { s, detail: 0.72, C: () => ({ leg: C.fur, sock: C.furPale, claw: C.talon }) });
    const gs = buildGriffon(def, o, {
      wingless: !hip,
      fore: hip ? undefined : (C) => { const L = pawLegs(mini(C), { H: 0.66, zf: 0.24, zb: -0.33, lx: 0.13, k: 1.3, kl: 1.4, toe: 1.2 }); ff = [L.feet[0], L.feet[1]]; return { part: L.fl, js: L.JF }; },
      hind: hip ? (C) => { const L = hoofLegs(mini(C), { H: 0.566, zf: 0, zb: -0.33, lx: 0.125, k: 1.0, low: C.furDark }); hf = [L.feet[2], L.feet[3]]; return { part: L.bl, js: L.JB }; } : undefined,
      tail: hip ? (nodes, C) => { const TLh = [[0, 0.72, -0.47], [0, 0.67, -0.58], [0, 0.47, -0.66], [0, 0.22, -0.65]], ctx = mini(C), start = ctx.nodes.length; tailChain(ctx, TLh, [0.04, 0.06, 0.068, 0.014], { col: C.tuft, amp: 0.012, f: 22 }); nodes.push(...ctx.nodes.slice(start)); } : undefined,
    });
    const torso = gs.nodes.find((n) => n.name === 'torso'), z0 = hip ? -0.16 : -0.04, top = surfHit(distanceField(torso.prims), [0, 1.4, z0], [0, -1, 0])[1], seatA = [0, top + 0.085, z0];
    griffonTack(gs, R, seatA, o, s);
    const nodes = finish(gs.nodes, s);
    seatRider(nodes, R, 'torso', gs.BO, seatA, s);
    return { kind: 'beast.rider', attack: R.desc.attack, hold: R.desc.hold || 'none', gait: hip ? 'hippogriff' : 'griffon', mount: v, feathered: hip, strike: 'bite', ...feet([ff[0], ff[1], hf[0], hf[1]], s), footToe: hip ? 0.12 : 0.055, nodes };
  }

  function mount(def, o = {}) {
    const mt = o.mountType;
    if (mt === 'pegasus' || mt === 'longma' || mt === 'clockHorse') return horseMount(def, o, mt);
    if (mt === 'hippogriff' || mt === 'halfgriffon') return griffonKin(def, o, mt);
    if (mt === 'raptor') return raptorMount(def, o);
    if (SEAT[mt] !== undefined) return beastMount(def, o, mt);
    if (mt === undefined || mt === 'horse' || !mt) {
      if (o.bones) return boneHorse(def, o);
      if (o.barding || o.rot || riderFactor(o) > 1.02) return horseMount(def, o, 'horse');
    }
    return null;
  }
  return { quad, mount, rotify };
}
