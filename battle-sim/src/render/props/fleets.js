// Fleets of the wider world: twenty-six hull designs beyond the eight stock classes of ships.js.
//
// A class asks for one with `kind` (see FLEET_KINDS); ships.js then hands the build to buildFleet() together with
// its kit (the pen, the lofted hull, planking, decks, guns, sails, cordage), so every design here is drawn with the
// same tools, into the same single geometry, at the same three tiers, and returns the same things: flags for the side
// colour, starboard gun muzzles, bow toward +X, waterline at y = 0.
//
// A class may set: kind, len, beam, sails (masts; 0 = none), cannons.perSide, color (hull), sail, sail2 (second cloth
// colour), trim (ornament, default gold), emblem ('cross' | 'sun' | 'lion' | 'skull' | 'dragon' | 'none'), ghost, oars.
//
// Three families:
//   - sailing ships on the stock shipwright's pipeline, restyled and dressed (cog, treasureGalleon, fluyt, icebreaker,
//     shroudGalleon, paddleGalleon);
//   - hulls lofted and planked by the kit but rigged and fitted here (galleys, longship, junk, dhow, barges, ironclads);
//   - things that are hardly ships (citadelBeast, submersible, hideRaft, fleshBarge).
import { S, H as HP, rgb, noise3, fbm3 } from '../sculpt.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function hash1(n) { let h = Math.imul((n | 0) ^ 0x9e3779b9, 374761393); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const hash2 = (a, b) => hash1(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
const hex = (h) => rgb(h);
const lumOf = (c) => c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1;

export const FLEET_KINDS = ['cog', 'paddleGalleon', 'swanGalley', 'razorGalley', 'citadelBeast', 'livingSkiff', 'dreadnought', 'serpentBarge', 'icebreaker', 'junk', 'dreadGalley', 'longship', 'scrapHulk',
  'submersible', 'shroudGalleon', 'solarBarque', 'oxBarge', 'fluyt', 'warGalley', 'treasureGalleon', 'dhow', 'atakebune', 'curragh', 'swanBarge', 'hideRaft', 'fleshBarge'];
/** the fleet design a class asks for, or null (then ships.js builds one of its own by def.id) */
export const fleetKind = (def) => (def && FLEET_KINDS.includes(def.kind) ? def.kind : null);

/** more devices for a mainsail (ships.js paints them in the side colour): outlines about the origin, radius about 1, anticlockwise, star-shaped; `at` moves a layer */
export function FLEET_DEVICES({ ringPts, starPts, densify }) {
  const tri = (r, turn = 0) => [0, 1, 2].map((i) => { const a = turn + Math.PI / 2 + (i / 3) * TAU; return [Math.cos(a) * r, Math.sin(a) * r]; });
  const oval = (n, rx, ry) => Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; return [Math.cos(a) * rx, Math.sin(a) * ry]; });
  return {
    // a lion's face in its mane
    lion: () => [{ pts: starPts(13, 1.12, 0.84) }, { pts: ringPts(20, 0.6, 0.12), pale: true, at: [0, -0.04] }, { pts: tri(0.2), at: [-0.52, 0.56], pale: true }, { pts: tri(0.2), at: [0.52, 0.56], pale: true },
      { pts: oval(8, 0.1, 0.07), at: [-0.24, 0.1] }, { pts: oval(8, 0.1, 0.07), at: [0.24, 0.1] }, { pts: tri(0.16, Math.PI), at: [0, -0.2] }, { pts: oval(8, 0.2, 0.045), at: [0, -0.42] }],
    // a skull: cranium and jaw, hollow eyes
    skull: () => [{ pts: densify([[0.5, -0.92], [0.5, -0.5], [0.86, -0.28], [0.98, 0.2], [0.8, 0.72], [0.4, 1.0], [-0.4, 1.0], [-0.8, 0.72], [-0.98, 0.2], [-0.86, -0.28], [-0.5, -0.5], [-0.5, -0.92]], 0.4) },
      { pts: oval(10, 0.27, 0.24), at: [-0.4, 0.14], pale: true }, { pts: oval(10, 0.27, 0.24), at: [0.4, 0.14], pale: true }, { pts: tri(0.17), at: [0, -0.3], pale: true },
      ...[-0.3, -0.1, 0.1, 0.3].map((x) => ({ pts: oval(4, 0.035, 0.17), at: [x, -0.74], pale: true }))],
    // a horned dragon's head, seen from the front
    dragon: () => [{ pts: densify([[0, -1.1], [0.3, -0.72], [0.34, -0.3], [0.72, -0.34], [0.5, 0.0], [0.98, 0.14], [0.56, 0.36], [0.92, 1.12], [0.3, 0.62], [0, 0.78], [-0.3, 0.62], [-0.92, 1.12], [-0.56, 0.36], [-0.98, 0.14], [-0.5, 0.0], [-0.72, -0.34], [-0.34, -0.3], [-0.3, -0.72]], 0.4) },
      { pts: [[-0.17, 0.02], [0.17, -0.1], [0.12, 0.1]], at: [0.27, 0.12], pale: true }, { pts: [[0.17, 0.02], [-0.12, 0.1], [-0.17, -0.1]], at: [-0.27, 0.12], pale: true },
      { pts: oval(6, 0.05, 0.08), at: [0.11, -0.74], pale: true }, { pts: oval(6, 0.05, 0.08), at: [-0.11, -0.74], pale: true }],
  };
}

// ---------- the build in hand (builds never nest, so this is module state) ----------
let K, p, def, tier, far, lite, eco, L, B, per, nm, flags, H, st;
let CH, CS, CS2, CT, CTp, emblem;                 // hull, sail, second sail colour, trim (and its roughness / metalness), device
let TAR, HEMP, IRON, GILT, BRASS, DECK, SPAR, OAK, PITCH, GLASS, WHITE, OCHRE, RED, LAMP, X, frame;
const BONE = hex(0xd8cfb4), HIDE = hex(0x7a5a3c), STONE = hex(0x8f8a7c), FIRE = hex(0xff6a1e), ICE = hex(0xa8dcff), LEAF = hex(0x4f8a34);
const metal = (c, ro = 0.4, me = 0.85) => p.shade(null).ink(c, ro, me);
const trimInk = () => p.shade(null).ink(CT, CTp[0], CTp[1]);
/** set the roughness / metalness / glow of everything drawn since vertex `from` */
function setPbr(from, ro, me, gl = null) { for (let i = from; i < p.n; i++) { p.M[i * 3] = ro; p.M[i * 3 + 1] = me; if (gl !== null) p.M[i * 3 + 2] = gl; } }
/** recolour everything since `from`: fn(x, y, z, nx, ny, nz, [r, g, b]) -> colour | null */
function repaint(from, fn) {
  for (let i = from; i < p.n; i++) { const q = i * 3, r = fn(p.P[q], p.P[q + 1], p.P[q + 2], p.N[q], p.N[q + 1], p.N[q + 2], [p.C[q], p.C[q + 1], p.C[q + 2]]); if (r) { p.C[q] = r[0]; p.C[q + 1] = r[1]; p.C[q + 2] = r[2]; } }
}
const bothSides = (fn) => K.bothSides(p, fn);
const sizeK = (ref) => clamp(Math.sqrt(L / ref), 0.6, 1.3);   // how tall things stand for a hull of this length (ref = the length the numbers were drawn for)

/** a hull from the kit's loft on one of the stock bases, shaped by `pre(st, o, C, v)`; returns the style */
function style(base, pre, more = {}) {
  return K.styleFor(more.def || def, tier, { base,
    pre: (s, o, C, v) => { C.trim = CT; C.sail = CS; pre(s, o, C, v); },
    mid: (s, o, C) => { s.device = emblem; if (more.mid) more.mid(s, o, C); },
    rig: more.rig, post: more.post });
}
/** run the kit's pipeline for a style, leaving out the stages in `skip`; sets H; returns the rigger's flags */
function launch(s, skip = null) { st = s; const fl = K.buildSailingShip(s.def, s, p, skip); H = s.H; return fl; }
const railPt = (s, out = 0, up = 0) => { const q = H.pt(s, H.railY(s) + up, out); return q; };
const deckPt = (s, zf = 0, up = 0) => H.on(s, zf, H.seg(s), up);
/** a placement standing on deck at station s: local X forward, Y up, Z to starboard */
const onDeck = (s, zf = 0, up = 0, yaw = 0) => { const q = deckPt(s, zf, up); return X(q[0], q[1], q[2], 0, yaw, 0); };

// ---------- cloth ----------
/** a patch of cloth over P(u, v) (v runs down from the head), cut into regions us x vs, each of one colour; rag tatters the foot */
function cloth(P, o = {}) {
  const us = o.us || [0, 1], vs = o.vs || [0, 1], cell = (o.cell || 0.17) * eco, seed = o.seed || 0, rn = o.ragN || 7;
  const Q = o.rag ? (u, v) => { const t = u * rn, k = Math.floor(t - 1e-6), tooth = Math.abs((t - k) * 2 - 1); return P(u, v * (1 - o.rag * (1 - tooth) * (0.35 + 0.65 * hash2(k, seed + 3)) - o.rag * 0.25 * hash2(k, seed + 9))); } : P;
  for (let a = 0; a < us.length - 1; a++) for (let b = 0; b < vs.length - 1; b++) {
    const u0 = us[a], u1 = us[a + 1], v0 = vs[b], v1 = vs[b + 1], c = o.colOf ? o.colOf(a, b) : (o.col || CS);
    if (!c) continue;
    const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
    let nu = Math.max(o.fine ? 4 : 1, Math.round(dist3(Q(u0, vm), Q(u1, vm)) / cell)), nv = Math.max(o.fine ? 4 : far ? 1 : 2, Math.round(dist3(Q(um, v0), Q(um, v1)) / cell));
    if (o.rag) nu = Math.max(nu, Math.ceil((u1 - u0) * rn) * 2);
    p.shade(null).ink(c, o.ro ?? 0.94, o.me ?? 0, o.glow ?? 0.14);
    p.grid(nu, nv, (i, j, out) => { const q = Q(lerp(u0, u1, i / nu), lerp(v0, v1, j / nv)); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
      (i, j) => { const u = lerp(u0, u1, i / nu), v = lerp(v0, v1, j / nv), q = Q(u, v), edge = u < 1e-4 || u > 1 - 1e-4 || v < 1e-4 || v > 1 - 1e-4 ? 1 : 0; return K.clothTone(c, seed * 31 + a * 7 + b * 3, i === 0 || i === nu, edge, q[0], q[1], q[2]); });
  }
}
/** where a point x across and y up from P(uc, vc) lies on the cloth, however the cloth is cut (a few Newton steps on P) */
function onCloth(P, N, uc, vc) {
  const o0 = P(uc, vc), ex = norm3(cross([0, 1, 0], [N[0], 0, N[2]])), ey0 = cross([N[0], N[1] || 0, N[2]], ex), ey = ey0[1] < 0 ? mul(ey0, -1) : ey0;
  return (x, y) => {
    const T = add3(add3(o0, ex, x), ey, y);
    let u = uc, v = vc;
    for (let it = 0; it < 5; it++) {
      const q = P(u, v), du = sub3(P(u + 0.01, v), q), dv = sub3(P(u, v + 0.01), q), d = sub3(T, q);
      const a = du[0] * du[0] + du[1] * du[1] + du[2] * du[2], b = du[0] * dv[0] + du[1] * dv[1] + du[2] * dv[2], c = dv[0] * dv[0] + dv[1] * dv[1] + dv[2] * dv[2];
      const e = du[0] * d[0] + du[1] * d[1] + du[2] * d[2], f = dv[0] * d[0] + dv[1] * d[1] + dv[2] * d[2], det = a * c - b * b || 1e-9;
      u = clamp(u + 0.01 * (e * c - f * b) / det, 0.03, 0.97); v = clamp(v + 0.01 * (a * f - b * e) / det, 0.03, 0.97);
    }
    return P(u, v);
  };
}
/** the surface of a square sail (the stock sail's shape): o = { c, beta, wHead, wFoot, drop, belly, roach, hollow } */
function squareP(o) {
  const A = [Math.sin(o.beta), 0, Math.cos(o.beta)], N = [Math.cos(o.beta), 0, -Math.sin(o.beta)];
  const wAt = (v) => lerp(o.wHead, o.wFoot, v) - (o.hollow ?? 0.04) * Math.sin(Math.PI * v) * o.wHead;
  const P = (u, v) => {
    const w = wAt(v), su = Math.max(0, Math.sin(Math.PI * u));
    const bell = o.belly * Math.pow(su, 0.72) * (Math.sin(Math.PI * Math.pow(v, 0.8) * 0.82) + 0.12 * v) + 0.03 * o.belly * Math.sin(Math.PI * v);
    const a = (u - 0.5) * w, dn = v * o.drop - (o.roach ?? 0.08) * o.drop * su * v * v;
    return [o.c[0] + A[0] * a + N[0] * bell, o.c[1] - dn, o.c[2] + A[2] * a + N[2] * bell];
  };
  const on = (x, y, vc = 0.5) => { const v = clamp(vc - y / o.drop, 0.03, 0.97); return P(clamp(0.5 + x / wAt(v), 0.03, 0.97), v); };
  return { P, N, on, size: Math.min(wAt(0.5), o.drop), clews: [P(0, 1), P(1, 1)], heads: [P(0, 0), P(1, 0)] };
}
/** a three-cornered sail under a slanting yard: u runs up the yard from tack to peak, v from the yard down to the foot */
function triP(o) {
  const { tack, peak, clew } = o;
  let N = norm3(cross(sub3(peak, tack), sub3(clew, tack)));
  if (N[2] > 0) N = mul(N, -1);
  const P = (u, v) => { const q = lerp3(lerp3(tack, peak, u), lerp3(tack, clew, u), v), bell = o.belly * Math.sin(Math.PI * Math.pow(u, 0.7)) * Math.sin(Math.PI * Math.pow(v, 0.85)); return add3(q, N, bell); };
  const uc = o.uc ?? 0.66, vc = o.vc ?? 0.5;
  return { P, N, on: onCloth(P, N, uc, vc), size: Math.min(dist3(P(0.4, vc), P(0.92, vc)), dist3(P(uc, 0.08), P(uc, 0.92))) };
}
/** the device of the class on a sail, in the side colour */
function device(sl, k = 0.3, shape = emblem) { if (shape) flags.push({ kind: 'device', shape, on: (x, y) => sl.on(x, y), N: sl.N, r: k * sl.size }); }
/** a square sail for the stock rigger (st.sqSail), dressed by `dress(o)` -> cloth options */
const sailBy = (dress) => (pen, o) => { const sl = squareP(o); cloth(sl.P, { seed: o.seed, fine: o.fine, ...dress(o) }); return sl; };
const quarters = () => ({ us: [0, 0.5, 1], vs: [0, 0.5, 1], colOf: (a, b) => ((a + b) % 2 ? CS2 : CS) });
const stripes = (n, c0 = CS, c1 = CS2) => ({ us: Array.from({ length: n + 1 }, (_, i) => i / n), colOf: (a) => (a % 2 ? c1 : c0) });
const bands = (n, c0 = CS, c1 = CS2) => ({ vs: Array.from({ length: n + 1 }, (_, i) => i / n), colOf: (a, b) => (b % 2 ? c1 : c0) });

// ---------- masts and rigs of our own ----------
const pennantLen = () => clamp(0.3 * L, 0.7, 3), flagH = () => clamp(0.115 * L, 0.36, 1.15);
function addFlag(kind, at, k = 1) {
  const f = { kind, at, seed: flags.length + 1 };
  if (kind === 'pennant') { f.len = pennantLen() * k; f.hgt = (0.17 + 0.012 * L) * Math.sqrt(k); } else if (kind === 'ensign') { f.hgt = flagH() * k; f.len = f.hgt * 1.6; } else { f.hgt = (0.24 + 0.014 * L) * k; f.len = f.hgt * 1.7; }
  flags.push(f);
  return f;
}
/** a staff with a flag at its head */
function staff(a, h, kind = 'ensign', k = 1, lean = -0.2) {
  const b = [a[0] + h * lean, a[1] + h, a[2]];
  p.shade(K.grainY(0.1)).ink(SPAR, 0.72).bar(a, b, 0.016, 0.01, 6, 1);
  trimInk().T(b[0], b[1] + 0.01, b[2]).sphere(0.02, 6, 4);
  return addFlag(kind, [b[0], b[1] - 0.01, b[2]], k);
}
/** a pole mast stepped at station s (or at o.base), hgt tall; returns its geometry for the rigs below */
function mast(s, hgt, r, o = {}) {
  const b = o.base || deckPt(s), tan = Math.tan((o.rake || 0) * DEG), top = [b[0] - tan * hgt, b[1] + hgt, b[2]], tp = o.taper ?? 0.5;
  p.shade(K.grainY(0.14)).ink(o.col || SPAR, 0.72).bar([b[0], b[1] - 0.05, b[2]], top, r, r * tp, far ? 6 : 10, 1);
  p.shade(null);
  const M = { s, b, top, r, hgt, at: (f) => lerp3(b, top, f), rad: (f) => r * lerp(1, tp, f) };
  if (!far && !o.plain) {
    p.ink(mul(WHITE, 0.8), 0.9).TM(X(b[0], b[1], b[2])).lathe([[r * 1.7, 0], [r * 1.25, 0.05], [r * 1.04, 0.075]], 10);
    for (let f = 0.14; f < 0.8; f += 0.42 / hgt) { const c = M.at(f), rr = M.rad(f) + 0.003; p.ink(o.hoop || IRON, 0.5, 0.8).TM(X(c[0], c[1], c[2], 0, 0, o.rake || 0)).lathe([[rr, -0.014], [rr + 0.005, 0], [rr, 0.014]], 8); }
  }
  if (o.flag !== false) {
    trimInk().T(top[0], top[1] + 0.012, top[2], 0, 0, 0, 1, 0.6, 1).sphere(r * tp * 1.7, 7, 4);
    p.ink(SPAR, 0.75).bar(top, [top[0], top[1] + 0.3, top[2]], 0.009, 0.006, 5, 1);
    addFlag(o.flag || 'pennant', [top[0], top[1] + 0.3, top[2]], o.flagK ?? 1);
  }
  return M;
}
/** standing rigging of a pole mast: forestay, backstay and n shrouds a side */
function stays(M, o = {}) {
  const hd = M.at(o.f ?? 0.86), n = o.n ?? 2;
  if (o.fore !== false) K.rope(p, hd, o.foreTo || [H.x(1, H.railY(1)) - 0.03, H.railY(1) + 0.05, 0], 0.011, TAR, 0, 4);
  if (o.back !== false) K.rope(p, hd, o.backTo || [H.x(0, H.railY(0)) + 0.08, H.railY(0) + 0.05, 0], 0.01, TAR, 0, 4);
  bothSides(() => { for (let k = 0; k < n; k++) { const ss = clamp(M.s - (0.12 + k * 0.24) / L, 0.02, 0.98), q = railPt(ss, 0.012, -0.02); K.rope(p, q, [hd[0], hd[1], 0.02], 0.01, TAR, 0, 4); } });
}
/** one square sail on a pole mast: o = { f (yard height as a fraction), w, clear, device, ...cloth options } */
function squareRig(M, o = {}) {
  const f = o.f ?? 0.9, yc = M.at(f), ry = M.r * 0.5, beta = (o.beta ?? 8) * DEG, dirY = [Math.sin(beta), 0, Math.cos(beta)], w = o.w;
  const c = [yc[0] + M.rad(f) + ry + 0.012, yc[1], yc[2]];
  K.yard(p, c, w, ry, dirY, o.yardCol || SPAR);
  const drop = o.drop ?? Math.max(0.3, c[1] - ry - (M.b[1] + (o.clear ?? 0.55)));
  const sl = squareP({ c: [c[0], c[1] - ry - 0.012, c[2]], beta, wHead: w * 0.9, wFoot: w * (o.footK ?? 0.92), drop, belly: (o.bellyK ?? 1) * (0.17 * drop + 0.045 * w), roach: o.roach ?? 0.1, hollow: o.hollow });
  cloth(sl.P, { ...o, fine: !!o.device });
  if (o.device) device(sl, o.devR ?? 0.32);
  const up = M.at(Math.min(0.99, f + 0.1));
  for (const e of [-1, 1]) {
    const arm = add3(c, dirY, e * w * 0.47), q = o.tie ? o.tie(e) : railPt(clamp(M.s - Math.max(0.2, 1.2 / L), 0.03, 0.97), 0.02);
    K.rope(p, arm, up, 0.0055, HEMP, 0, 3);
    K.rope(p, arm, [q[0], q[1], e * Math.abs(q[2])], 0.0055, HEMP, 0.03 * dist3(arm, q), 3);
    if (!o.rag && !o.tie) { const cl = sl.clews[e > 0 ? 1 : 0], a = railPt(clamp(M.s - 0.7 / L, 0.02, 0.98), 0.02); K.rope(p, cl, [a[0], a[1], e * a[2]], 0.007, HEMP, 0.05, 3); }
  }
  return sl;
}
/** a lateen: a long yard slung aslant the mast with a three-cornered sail; o = { lenY, slope, f, fore, clew, device, ...cloth options } */
function lateenRig(M, o = {}) {
  const gam = (o.gam ?? 14) * DEG, sl = (o.slope ?? 50) * DEG, lenY = o.lenY ?? M.hgt * 1.12, f = o.f ?? 0.74, c = M.at(f), fore = o.fore ?? 0.46;
  const dY = [-Math.cos(sl) * Math.cos(gam), Math.sin(sl), -Math.sin(gam) * Math.cos(sl)];
  const yc = [c[0], c[1], c[2] - (M.rad(f) + 0.03)], a = add3(yc, dY, -lenY * fore), b = add3(yc, dY, lenY * (1 - fore)), ry = M.r * 0.5;
  p.shade(K.grainX(0.12)).ink(o.yardCol || SPAR, 0.72).bar(yc, a, ry, ry * 0.68, 8, 1); p.bar(yc, b, ry, ry * 0.5, 8, 1);
  p.shade(null);
  const clew = o.clew || [Math.max(H.x(0, M.b[1]) + 0.25, M.b[0] - lenY * 0.62), M.b[1] + (o.clear ?? 0.7), M.b[2] - 0.34];
  const tp = triP({ tack: add3(a, [0, -0.02, 0]), peak: add3(b, [0, -0.03, 0]), clew, belly: (o.bellyK ?? 1) * 0.1 * lenY });
  cloth(tp.P, { ...o, fine: !!o.device });
  if (o.device) device(tp, o.devR ?? 0.3);
  K.rope(p, clew, [clew[0] - 0.2, M.b[1] + 0.1, -0.1], 0.007, HEMP, 0.02, 3); K.rope(p, a, [a[0] + 0.1, M.b[1] + 0.1, 0.2], 0.007, HEMP, 0, 3);
  K.rope(p, yc, M.at(0.98), 0.007, HEMP, 0, 3); K.rope(p, b, M.at(0.99), 0.005, HEMP, 0, 3);
  return { ...tp, a, b };
}
/** a junk's lug: flat cloth stiffened by bamboo battens, hung to one side of the mast; o = { w, clear, col, batten, device } */
function junkRig(M, o = {}) {
  const w = o.w, y0 = M.b[1] + (o.clear ?? 0.5), y1 = M.at(0.93)[1], h = y1 - y0, z = M.b[2] - (M.r + 0.035), xm = M.at(0.5)[0];
  const TL = [xm + w * 0.3, y1 - h * 0.1, z], TR = [xm - w * 0.72, y1 + h * 0.04, z], BL = [xm + w * 0.34, y0, z], BR = [xm - w * 0.7, y0 + h * 0.03, z];
  const nb = Math.max(3, Math.round(h / 0.34)), belly = 0.035 * w;
  const P = (u, v) => { const q = lerp3(lerp3(TL, TR, u), lerp3(BL, BR, u), v); q[0] -= 0.09 * w * Math.sin(Math.PI * v) * u * u; q[2] -= belly * Math.sin(Math.PI * u) * (0.55 + 0.45 * Math.abs(Math.sin(Math.PI * v * nb))); return q; };
  const N = [0, 0, -1], col = o.col || CS;
  cloth(P, { vs: Array.from({ length: nb + 1 }, (_, i) => i / nb), colOf: (a, b) => (o.colOf ? o.colOf(a, b) : mul(col, b % 2 ? 0.93 : 1)), seed: o.seed, fine: !!o.device, cell: 0.2 });
  const bc = o.batten || mul(col, 0.42);
  for (let k = 0; k <= nb; k++) {
    const pts = []; for (let i = 0; i <= 4; i++) { const q = P(lerp(-0.02, 1.02, i / 4), k / nb); pts.push([q[0], q[1], q[2] - 0.012]); }
    p.shade(null).ink(bc, 0.8).tube(pts, k === 0 || k === nb ? 0.022 : 0.015, far ? 3 : 5, 1);
    if (!lite && k > 0) K.rope(p, P(1, k / nb), [BR[0] - w * 0.16, M.b[1] + 0.25, 0], 0.004, HEMP, 0, 3);   // the sheetlets gathered from every batten
  }
  K.rope(p, lerp3(TL, TR, 0.4), M.at(0.985), 0.007, HEMP, 0, 3); K.rope(p, [BR[0] - w * 0.16, M.b[1] + 0.25, 0], [BR[0] - w * 0.2, M.b[1] + 0.02, 0], 0.008, HEMP, 0, 3);
  const sl = { P, N, on: onCloth(P, N, 0.48, 0.42), size: Math.min(w, h) };
  if (o.device) device(sl, o.devR ?? 0.26);
  return sl;
}

// ---------- oars, shields, wheels, funnels ----------
/** a bank of n oars a side between stations s0 and s1, blades in the water; o = { len, y(s), sweep, col, dip } */
function oars(n, s0, s1, o = {}) {
  if (n < 1) return;
  const len = o.len ?? B * 0.95, r = o.r ?? 0.016, col = o.col || mul(SPAR, 1.08), dip = o.dip ?? -0.05;
  (o.one ? (fn) => fn() : bothSides)(() => {
    for (let i = 0; i < n; i++) {
      const s = n === 1 ? (s0 + s1) / 2 : lerp(s0, s1, i / (n - 1)), y = o.y ? o.y(s) : H.railY(s) + 0.02, a = H.pt(s, y, o.out ?? 0), nh = H.nh(s, y);
      const reach = Math.sqrt(Math.max(0.04, len * len * 0.6 - (y - dip) * (y - dip))), dir = norm3([nh[0] + (o.sweep ?? -0.2) + 0.06 * Math.sin(i * 1.7), 0, nh[1]]);
      const b = [a[0] + dir[0] * reach, dip, a[2] + dir[2] * reach], inb = lerp3(a, b, -0.25);
      p.shade(null).ink(col, 0.8).bar(inb, b, r, r * 0.8, far ? 3 : 5, 0);
      p.ink(o.blade || col, 0.8).TM(frame(lerp3(a, b, 0.94), sub3(b, a), [0, 1, 0])).box(len * 0.2, o.bladeW ?? 0.085, 0.014);
    }
  });
}
/** round shields hung outside the gunwale between s0 and s1 (starboard and port), painted colOf(i) */
function shields(n, s0, s1, R, colOf, o = {}) {
  bothSides(() => {
    for (let i = 0; i < n; i++) {
      const s = lerp(s0, s1, (i + 0.5) / n), y = (o.y ? o.y(s) : H.railY(s)) - R * 0.55;
      p.push(H.frame(s, y, 0.012));
      p.shade(null).ink(colOf(i), 0.75).T(0, 0, 0, 90, 0, 0).lathe([[0, 0.034], [R * 0.3, 0.03], [R * 0.96, 0.01], [R, 0], [0, 0]], far ? 7 : 12);
      p.ink(IRON, 0.45, 0.85).T(0, 0, 0.03, 90, 0, 0).lathe([[0, 0.03], [R * 0.2, 0.018], [R * 0.26, 0]], 7);
      if (!lite) p.ink(mul(colOf(i + 1), 0.9), 0.75).T(0, 0, 0.012, 90, 0, 0).lathe([[R * 0.82, 0.012], [R * 0.98, 0.004]], 12);
      p.pop();
    }
  });
}
/** a paddle wheel turning about an athwartship axle at (x, yc, zc): radius R, w wide */
function paddleWheel(x, yc, zc, R, w, o = {}) {
  const n = o.n || (far ? 8 : 12);
  p.push(X(x, yc, zc));
  for (const dz of [-w * 0.42, w * 0.42]) {
    p.shade(null).ink(o.rim || IRON, 0.6, o.rim ? 0 : 0.7).T(0, 0, dz, 90, 0, 0).lathe([[R * 0.86, -0.025], [R * 0.95, -0.025], [R * 0.95, 0.025], [R * 0.86, 0.025], [R * 0.86, -0.025]], far ? 10 : 18);
    if (!far) for (let i = 0; i < n; i++) { const a = (i / n) * TAU; p.bar([0, 0, dz], [Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88, dz], 0.024, 0.018, 4, 0); }
  }
  p.shade(K.grainX(0.14)).ink(o.col || OAK, 0.85);
  for (let i = 0; i < n; i++) { const a = ((i + 0.5) / n) * TAU; p.T(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9, 0, 0, 0, a / DEG).box(R * 0.24, 0.035, w * 0.94); }
  p.shade(null).ink(IRON, 0.5, 0.8).T(0, 0, 0, 90, 0, 0).cyl(R * 0.13, R * 0.13, w * 1.02, 8);
  p.pop();
}
/** the box over a paddle wheel: a half drum closed at both ends, with a trim band round its rim and a sunburst of slats */
function paddleBox(x, yc, zc, R, w, col, o = {}) {
  const R1 = R * 1.13, out = [], n = far ? 8 : 16, y0 = o.skirt ?? -R * 0.12;
  out.push([R1, y0]);
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; out.push([Math.cos(a) * R1, Math.sin(a) * R1]); }
  out.push([-R1, y0]);
  p.push(X(x, yc, zc));
  p.shade(o.shade || null).ink(col, o.ro ?? 0.8, o.me ?? 0).extrude(out, w * 1.16, true);
  const rim = out.slice(1, -1).map(([a, b]) => [a, b, w * 0.58]);
  (o.trim ? p.shade(null).ink(o.trim, 0.4, 0.85) : trimInk()).tube(rim, 0.03, 4);
  if (!far) { for (let i = 1; i < 6; i++) { const a = (i / 6) * Math.PI; p.bar([Math.cos(a) * R1 * 0.3, Math.sin(a) * R1 * 0.3, w * 0.585], [Math.cos(a) * R1 * 0.94, Math.sin(a) * R1 * 0.94, w * 0.585], 0.016, 0.016, 4, 0); } p.T(0, 0.02, w * 0.585, 90, 0, 0).lathe([[0, 0.02], [R1 * 0.3, 0.012], [R1 * 0.32, 0]], 10, Math.PI, Math.PI); }
  p.pop();
}
/** a lump: an ellipsoid with a noisy skin (smoke, rock, hide, flesh); colOf(nx, ny, nz, n) -> colour */
function blob(c, rx, ry, rz, seed, col, o = {}) {
  const nu = Math.max(6, Math.round((o.nu || 12) * (far ? 0.6 : lite ? 0.8 : 1))), nv = Math.max(4, Math.round((o.nv || 7) * (far ? 0.6 : lite ? 0.8 : 1))), amp = o.amp ?? 0.18, fq = o.freq ?? 1.6;
  const D = (i, j) => { const u = (i / nu) * TAU, v = -Math.PI / 2 + (j / nv) * Math.PI, d = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)]; if (j === 0) d[0] = d[2] = 0; if (j === nv) d[0] = d[2] = 0; return d; };
  const R = (d) => 1 + amp * (fbm3(d[0] * fq + seed, d[1] * fq + seed * 0.7, d[2] * fq, 2) - 0.5) * 2;
  p.ink(col, o.ro ?? 0.95, o.me ?? 0, o.glow ?? 0);
  p.grid(nu, nv, (i, j, out) => { const d = D(i % nu, j), k = R(d); out[0] = c[0] + d[0] * rx * k; out[1] = c[1] + d[1] * ry * k; out[2] = c[2] + d[2] * rz * k; },
    (i, j) => { const d = D(i % nu, j), n = fbm3(d[0] * fq * 2.2 + seed, d[1] * fq * 2.2, d[2] * fq * 2.2 + seed, 2); return o.colOf ? o.colOf(d[0], d[1], d[2], n) : mul(col, 0.7 + 0.6 * n); }, true);
}
/** a funnel standing on (x, y, z): h tall, radius r; returns the middle of its mouth */
function funnel(x, y, z, h, r, o = {}) {
  p.push(X(x, y, z, 0, 0, o.rake ?? 4));
  p.shade(K.mottle(0.25, 14)).ink(o.col || IRON, 0.6, 0.6).lathe([[r * 1.25, 0], [r * 1.25, 0.05], [r, 0.08], [r * 0.96, h * 0.9], [r * 1.14, h * 0.92], [r * 1.14, h * 0.97], [r, h], [r * 0.8, h], [r * 0.8, h - 0.12]], far ? 8 : 14);
  (o.band ? metal(o.band, 0.4, 0.85) : trimInk());
  for (const f of o.bands || [0.34, 0.66]) p.T(0, h * f, 0).lathe([[r + 0.004, -0.03], [r + 0.02, 0], [r + 0.004, 0.03]], far ? 8 : 14);
  p.shade(null).ink(PITCH, 1).T(0, h - 0.1, 0).cyl(r * 0.8, r * 0.8, 0.01, 8, 1);
  p.pop();
  const t = Math.tan((o.rake ?? 4) * DEG);
  return [x - t * h, y + h, z];
}
/** smoke rolling from a point: a string of sooty lumps climbing and thinning down the wind */
function smoke(at, k = 1, seed = 1, col = hex(0x2a2a2e), n = 6) {
  p.shade(null);
  for (let i = 0; i < (far ? Math.ceil(n * 0.67) : n); i++) {
    const t = i / (n - 1), r = k * (0.12 + 0.3 * t) * (0.85 + 0.3 * hash2(i, seed));
    const c = [at[0] + k * (0.1 + 0.9 * t * t) * 1.1 + (hash2(i, seed + 5) - 0.5) * 0.12 * k, at[1] + k * (0.1 + 1.25 * t) + r * 0.3, at[2] - k * 0.35 * t * t + (hash2(i, seed + 8) - 0.5) * 0.14 * k];
    blob(c, r * 1.15, r * 0.92, r, seed * 13 + i * 7, mix(col, hex(0x8a8a8e), t * 0.75), { amp: 0.3, freq: 1.9, nu: 9, nv: 6, ro: 1 });
  }
}
/** an iron brazier standing on the origin of the placement m, with a fire in it */
function brazier(m, h = 0.34, col = FIRE) {
  p.push(m);
  p.shade(null).ink(IRON, 0.6, 0.7);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; p.bar([Math.cos(a) * h * 0.3, 0, Math.sin(a) * h * 0.3], [Math.cos(a) * h * 0.1, h * 0.62, Math.sin(a) * h * 0.1], 0.014, 0.014, 4, 0); }
  p.T(0, h * 0.58, 0).lathe([[0, 0], [h * 0.16, 0.01], [h * 0.34, h * 0.2], [h * 0.36, h * 0.3], [h * 0.3, h * 0.3], [h * 0.26, h * 0.16], [0, h * 0.1]], far ? 6 : 9);
  p.ink(col, 0.8, 0, 1.6).T(0, h * 0.86, 0, 0, 0, 0, h * 0.27, h * 0.1, h * 0.27).sphere(1, 7, 4);
  const hot = mix(col, hex(0xffe08a), 0.5);
  for (let i = 0; i < (far ? 1 : 3); i++) { const a = i * 2.1; p.ink(i ? col : hot, 0.8, 0, 1.8).T(Math.cos(a) * h * 0.09 * (i ? 1 : 0), h * 0.88, Math.sin(a) * h * 0.09 * (i ? 1 : 0), (i ? 9 : 0) * Math.cos(a), 0, (i ? 9 : 0) * Math.sin(a)).lathe([[h * 0.17, 0], [h * 0.13, h * 0.18], [h * 0.05, h * 0.4], [0, h * (0.62 - 0.1 * i)]], 6); }
  p.pop();
}
/** a spike standing along local +Y of placement m */
function spike(m, h, r, col = IRON) { p.shade(null).ink(col, 0.5, 0.8).TM(m).lathe([[r, 0], [r * 0.7, h * 0.4], [0, h]], far ? 4 : 6); }
/** spikes standing off the outside of the hull along a line y(s) */
function spikeRow(n, s0, s1, yAt, h, r, col = IRON, tilt = 0) {
  bothSides(() => { for (let i = 0; i < n; i++) { const s = lerp(s0, s1, n === 1 ? 0.5 : i / (n - 1)); p.push(H.frame(s, yAt(s), 0)); spike(X(0, 0, 0, 90 - tilt, 0, 0), h, r, col); p.pop(); } });
}
/** a chain hanging between two points */
function chain(a, b, sag, r = 0.018, col = IRON) {
  const n = far ? 4 : Math.max(5, Math.round(dist3(a, b) / 0.07)), pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, q = lerp3(a, b, t); q[1] -= sag * 4 * t * (1 - t); pts.push(q); }
  p.shade(null).ink(col, 0.5, 0.8);
  if (lite) { p.tube(pts, r * 0.8, 3); return; }
  for (let i = 0; i < n; i++) p.TM(frame(lerp3(pts[i], pts[i + 1], 0.5), sub3(pts[i + 1], pts[i]), i % 2 ? [0, 1, 0] : [0, 0, 1])).box(dist3(pts[i], pts[i + 1]) * 1.25, r * 2.2, r * 0.8);
}
/** a faceted crystal standing along +Y of placement m, lit from within */
function crystal(m, h, r, col, glow = 1.1) {
  p.shade(null).ink(col, 0.2, 0.1, glow).TM(m).lathe([[0, 0], [r, h * 0.18], [r * 0.82, h * 0.7], [0, h]], 5);
}
/** cloth, fur or weed hanging from a line of points: drops `drop`, leaning out along `out`; kind shades it */
function drape(pts, drop, col, o = {}) {
  const n = pts.length - 1, nv = far ? 2 : o.nv || 4, out = o.out || [0, 0, 0], rag = o.rag ?? 0.3, sd = o.seed || 0;
  const shade = o.fur ? (x, y, z, nx, ny, nz, c) => mul(c, 0.55 + 0.75 * noise3(x * 31, y * 9, z * 31)) : null;
  p.shade(shade).ink(col, o.ro ?? 0.95, 0, o.glow ?? 0);
  p.grid(n, nv, (i, j, outp) => {
    const v = j / nv, d = drop * (1 - rag * hash2(i, sd + 11)) * (typeof o.len === 'function' ? o.len(i / n) : 1), q = pts[i], sway = (o.sway ?? 0.03) * Math.sin(i * 2.3 + sd) * v;
    const k = (o.bulge ?? 0.04) * Math.sin(Math.PI * Math.min(1, v * 1.4));
    outp[0] = q[0] + out[0] * (k + v * (o.lean ?? 0.02)) + sway; outp[1] = q[1] - d * v + (o.lift ?? 0); outp[2] = q[2] + out[2] * (k + v * (o.lean ?? 0.02));
  }, (i, j) => mul(col, (0.78 + 0.34 * hash2(i, sd + j)) * (1 - 0.25 * j / nv) * (j === nv ? 0.75 : 1)));
  p.shade(null);
}
/** a square tower on (cx, y0, cz): w along X, d along Z, h high; o = { col, merlon, roof, roofH, glow, courses } */
function tower(cx, y0, cz, w, d, h, o = {}) {
  const col = o.col || STONE, cs = o.courses ?? 0.12;
  const shade = (x, y, z, nx, ny, nz, c) => { const row = Math.floor(y / cs), br = Math.floor((Math.abs(nx) > 0.5 ? z : x) / (cs * 2.2) + (row % 2) * 0.5); return mul(c, (0.82 + 0.3 * hash2(row, br)) * (0.9 + 0.2 * noise3(x * 7, y * 7, z * 7))); };
  p.shade(shade).ink(col, o.ro ?? 0.9, o.me ?? 0).T(cx, y0 + h / 2, cz).box(w, h, d, 0.012);
  if (o.batter) p.T(cx, y0 + o.batter / 2, cz).box(w * 1.12, o.batter, d * 1.12, 0.02);
  const mh = o.merlon ?? 0.12;
  if (mh > 0) {
    p.T(cx, y0 + h + 0.02, cz).box(w * 1.1, 0.05, d * 1.1, 0.008);
    const mw = mh * 0.9, nx_ = Math.max(2, Math.round(w / (mw * 2))), nz_ = Math.max(2, Math.round(d / (mw * 2)));
    for (let i = 0; i < nx_; i++) for (const sg of [-1, 1]) p.T(cx - w * 0.55 + (i + 0.5) * (w * 1.1 / nx_), y0 + h + 0.045 + mh / 2, cz + sg * (d * 0.55 - mw * 0.3)).box(w * 1.1 / nx_ * 0.56, mh, mw * 0.6);
    for (let i = 1; i < nz_ - 1; i++) for (const sg of [-1, 1]) p.T(cx + sg * (w * 0.55 - mw * 0.3), y0 + h + 0.045 + mh / 2, cz - d * 0.55 + (i + 0.5) * (d * 1.1 / nz_)).box(mw * 0.6, mh, d * 1.1 / nz_ * 0.56);
  }
  if (o.roof) p.shade(K.mottle(0.2, 9)).ink(o.roof, 0.7, o.roofMe ?? 0).T(cx, y0 + h + (o.roofUp ?? 0.03), cz, 0, 45, 0).lathe([[Math.max(w, d) * 0.78, 0], [Math.max(w, d) * 0.3, (o.roofH ?? w) * 0.55], [0, o.roofH ?? w]], 4);
  if (o.glow) { p.shade(null).ink(o.glow, 0.3, 0, 1.3); const nw = o.wins ?? Math.max(1, Math.round(h / 0.5)); for (let k = 0; k < nw; k++) { const y = y0 + h * (k + 0.6) / (nw + 0.4); for (const sg of [-1, 1]) { p.T(cx, y, cz + sg * (d / 2 + 0.004)).box(w * 0.16, Math.min(0.2, h * 0.16), 0.012); if (!far) p.T(cx + sg * (w / 2 + 0.004), y, cz).box(0.012, Math.min(0.2, h * 0.16), d * 0.16); } } }
  p.shade(null);
}
/** a round tower on (cx, y0, cz) */
function roundTower(cx, y0, cz, r, h, o = {}) {
  const col = o.col || STONE, cs = o.courses ?? 0.12, seg = far ? 7 : lite ? 9 : 12;
  const shade = (x, y, z, nx, ny, nz, c) => { const row = Math.floor(y / cs), br = Math.floor(Math.atan2(z - cz, x - cx) * 5 + (row % 2) * 0.5); return mul(c, (0.82 + 0.3 * hash2(row, br)) * (0.9 + 0.2 * noise3(x * 7, y * 7, z * 7))); };
  p.shade(shade).ink(col, o.ro ?? 0.9, o.me ?? 0).T(cx, y0, cz).lathe([[r * 1.12, 0], [r * 1.02, h * 0.12], [r, h * 0.8], [r * 1.14, h * 0.86], [r * 1.14, h], [r * 0.9, h], [r * 0.9, h - 0.05], [0, h - 0.05]], seg);
  const mh = o.merlon ?? 0.12, nm_ = far ? 5 : 8;
  if (mh > 0) for (let i = 0; i < nm_; i++) { const a = (i / nm_) * TAU; p.T(cx + Math.cos(a) * r * 1.02, y0 + h + mh / 2, cz + Math.sin(a) * r * 1.02, 0, -a / DEG, 0).box(r * 0.24, mh, r * 0.42); }
  if (o.roof) p.shade(K.mottle(0.2, 9)).ink(o.roof, 0.65, o.roofMe ?? 0).T(cx, y0 + h + (mh > 0 ? mh * 0.4 : 0), cz).lathe([[r * (mh > 0 ? 0.86 : 1.2), 0], [r * 0.34, (o.roofH ?? r * 2) * 0.6], [0, o.roofH ?? r * 2]], seg);
  if (o.glow) { p.shade(null).ink(o.glow, 0.3, 0, 1.3); const nw = o.wins ?? Math.max(1, Math.round(h / 0.55)); for (let k = 0; k < nw; k++) for (let i = 0; i < (far ? 2 : 4); i++) { const a = (i / (far ? 2 : 4)) * TAU + k * 0.8 + Math.PI / 2; p.T(cx + Math.cos(a) * r * 1.0, y0 + h * (k + 0.55) / (nw + 0.5), cz + Math.sin(a) * r * 1.0, 0, -a / DEG, 0).box(0.03, Math.min(0.2, h * 0.13), r * 0.2); } }
  p.shade(null);
}
/** an awning on four posts over a rectangle on deck: stations sA..sB, half-width zf of the deck; cloth striped c0 / c1 */
function awning(sA, sB, zf, h, c0, c1, o = {}) {
  const a = deckPt(sA, zf), b = deckPt(sB, zf), y = Math.max(a[1], b[1]) + h, z = Math.max(a[2], b[2]);
  p.shade(null).ink(o.post || SPAR, 0.75);
  for (const q of [a, b]) for (const sg of [-1, 1]) { p.bar([q[0], q[1], sg * q[2]], [q[0], y, sg * z], 0.022, 0.018, 5, 0); if (!far) trimInk().T(q[0], y + 0.03, sg * z).sphere(0.03, 6, 4), p.ink(o.post || SPAR, 0.75); }
  const n = o.n ?? Math.max(4, Math.round((2 * z) / 0.2)), x0 = a[0] - 0.08, x1 = b[0] + 0.08;
  const P = (u, v) => [lerp(x0, x1, v), y + (o.crown ?? 0.12) * Math.sin(Math.PI * u) - 0.035 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u), (u - 0.5) * 2 * (z + 0.07)];
  cloth(P, { us: Array.from({ length: n + 1 }, (_, i) => i / n), colOf: (i) => (i % 2 ? c1 : c0), cell: 0.3, seed: 5, glow: 0.05 });
  if (!far) for (const sg of [-1, 1]) drape(Array.from({ length: 9 }, (_, i) => [lerp(x0, x1, i / 8), y, sg * (z + 0.07)]), 0.09, c1, { rag: 0.1, nv: 1, bulge: 0, sway: 0 });
  return { y, z, x0, x1 };
}
/** a wisp: a thin glowing ribbon curling round an axis from a to b */
function wisp(a, b, R, turns, col, seed = 0, r = 0.02, glow = 0.7) {
  const n = far ? 8 : 20, pts = [], rad = [], ax = norm3(sub3(b, a)), ex = norm3(cross(ax, [0.3, 1, 0.2])), ez = cross(ax, ex);
  for (let i = 0; i <= n; i++) { const t = i / n, ang = seed + t * turns * TAU, rr = R * Math.sin(Math.PI * Math.pow(t, 0.8)) * (0.7 + 0.3 * Math.sin(t * 9 + seed)), q = lerp3(a, b, t); pts.push(add3(add3(q, ex, Math.cos(ang) * rr), ez, Math.sin(ang) * rr)); rad.push(r * Math.sin(Math.PI * t) + 0.002); }
  p.shade(null).ink(col, 0.6, 0, glow).tube(pts, rad, 4);
}
/** a small gun on a swivel standing on placement m (barrel along local +Z) */
function deckGun(m, len, o = {}) {
  p.push(m);
  if (o.carriage !== false) { p.shade(K.grainX(0.12)).ink(o.wood || mul(OAK, 0.9), 0.8).T(0, len * 0.13, -len * 0.1).box(len * 0.34, len * 0.2, len * 0.62, 0.01); if (!far) { p.shade(null).ink(mul(OAK, 0.5), 0.8); for (const sg of [-1, 1]) for (const dz of [-0.32, 0.12]) p.T(sg * len * 0.2, len * 0.09, len * dz, 0, 0, 90).cyl(len * 0.09, len * 0.09, 0.03, 7); } }
  const from = p.n;
  p.push(X(0, len * (o.up ?? 0.32), 0)); K.gunBarrel(p, len, len * (o.fat ?? 0.09)); p.pop();
  if (o.col) { const k0 = 1 / lumOf(IRON); repaint(from, (x, y, z, nx, ny, nz, c) => mul(o.col, lumOf(c) * k0)); setPbr(from, 0.35, 0.9); }
  p.pop();
}
/** carved timber running through pts (a prow, a tail, a horn): thick tube with a grain */
function carve(pts, radii, col, o = {}) { p.shade(o.shade ?? K.mottle(0.2, 8)).ink(col, o.ro ?? 0.8, o.me ?? 0, o.glow ?? 0).tube(pts, radii, far ? 5 : o.sides || 8, 1); p.shade(null); }
/** a smooth curve through control points (Catmull-Rom), n pieces per span */
function curve(ctl, n = 4) {
  const out = [], g = (i) => ctl[clamp(i, 0, ctl.length - 1)];
  for (let i = 0; i < ctl.length - 1; i++) for (let k = 0; k < n; k++) {
    const t = k / n, a = g(i - 1), b = g(i), c = g(i + 1), d = g(i + 2), t2 = t * t, t3 = t2 * t;
    out.push([0, 1, 2].map((m) => 0.5 * (2 * b[m] + (c[m] - a[m]) * t + (2 * a[m] - 5 * b[m] + 4 * c[m] - d[m]) * t2 + (3 * b[m] - a[m] - 3 * c[m] + d[m]) * t3)));
  }
  out.push(ctl[ctl.length - 1].slice());
  return out;
}
/** muzzle positions along the gunwale for a boat with no gun deck (light pieces on the rail) */
function railGuns(s0, s1, o = {}) {
  const out = [];
  for (let i = 0; i < per; i++) {
    const s = per === 1 ? (s0 + s1) / 2 : lerp(s0, s1, i / (per - 1)), y = (o.y ? o.y(s) : H.railY(s)) + 0.02, q = H.pt(s, y, -0.02), n = H.nh(s, y), gl = o.len ?? clamp(0.06 * L, 0.26, 0.42);
    bothSides(() => { p.push(frame([q[0], q[1], q[2]], [n[1], 0, -n[0]], [0, 1, 0])); p.shade(null).ink(IRON, 0.5, 0.8).T(0, 0.04, 0).cyl(0.014, 0.018, 0.08, 5); p.push(X(0, 0.1, gl * 0.12)); K.gunBarrel(p, gl, gl * 0.085); p.pop(); p.pop(); });
    out.push([q[0] + n[0] * gl * 0.62, q[1] + 0.1, q[2] + n[1] * gl * 0.62]);
  }
  return out;
}

// ---------- carved figures (sculpted once per colouring, shared by every ship that wears them) ----------
// They face +Z with the neck rising from the origin, and are turned to face the bow when placed.
const plateZY = (outline, thick) => HP.extrude(outline, thick, 0.003).rot(0, -90, 0);
const hx = (c) => { const f = (v) => Math.round(255 * Math.pow(clamp(v, 0, 1), 1 / 2.2)); return (f(c[0]) << 16) | (f(c[1]) << 8) | f(c[2]); };   // linear colour -> 0xrrggbb, near enough for paint
/** a horned serpent / dragon head on an arched neck: o = { col, hi, eye, ro, me, scales, plumes: [hex...], horns } */
function dragonFig(o) {
  return () => {
    const g = (pr) => pr.color(o.col).pbr(o.ro ?? 0.6, o.me ?? 0), h = (pc) => pc.color(o.hi).pbr(o.ro ?? 0.5, o.me ?? 0);
    const prims = [
      ...S.limb([[0, -0.26, -0.36], [0, -0.03, -0.09], [0, 0.22, 0.08], [0, 0.44, 0.06], [0, 0.6, 0.15]], [0.135, 0.118, 0.096, 0.08, 0.075]).map((c) => (o.scales ? g(c).bump(0.012, 13, 'scales') : g(c)).blend(0.05).tint(0.2, 20)),
      g(S.ellipsoid(0.095, 0.085, 0.13)).at(0, 0.65, 0.25).blend(0.035),
      g(S.capsule([0, 0.66, 0.32], [0, 0.62, 0.57], 0.064, 0.044)).blend(0.03),
      g(S.capsule([0, 0.575, 0.27], [0, 0.47, 0.5], 0.042, 0.026)).blend(0.012),
      S.ellipsoid(0.03, 0.012, 0.085).rot(22, 0, 0).at(0, 0.54, 0.41).color(o.tongue ?? 0x9c2f22).pbr(0.6).blend(0.004),
      ...S.mirrorX([
        g(S.capsule([0.036, 0.725, 0.29], [0.056, 0.71, 0.43], 0.027, 0.016)).blend(0.015),
        S.sphere(0.034).at(0.072, 0.685, 0.375).cut(0.01),
        S.sphere(0.012).at(0.03, 0.648, 0.585).cut(0.006),
        g(S.ellipsoid(0.032, 0.046, 0.062)).at(0.072, 0.61, 0.24).blend(0.03),
      ]),
      ...[[0.0, 0.1], [0.1, 0.14], [0.2, 0.175], [0.3, 0.165], [0.4, 0.15]].map(([y, z]) => S.ellipsoid(0.078, 0.034, 0.042).at(0, y, z).color(o.hi).pbr(o.ro ?? 0.5, o.me ?? 0).paint(0.012, 0.012)),
    ];
    const hard = [];
    hard.push(...HP.mirrorX([
      HP.sphere(0.019, 10).color(o.eye ?? 0xff5a2a).pbr(0.25).glow(o.eyeGlow ?? 0.8).at(0.066, 0.685, 0.378),
      ...(o.horns === false ? [] : [HP.tube([[0.045, 0.7, 0.2], [0.09, 0.8, 0.1], [0.11, 0.88, -0.04], [0.095, 0.91, -0.17]], [0.028, 0.02, 0.012, 0.003], 10, 6).color(o.horn ?? 0xe8dcb4).pbr(0.4, 0.2)]),
      plateZY([[0, 0], [-0.12, 0.09], [-0.085, 0.02], [-0.15, 0.0], [-0.08, -0.03], [-0.11, -0.09], [0, -0.05]], 0.012).rot(0, 28, 0).at(0.086, 0.63, 0.2).color(o.hi).pbr(o.ro ?? 0.5, o.me ?? 0),
    ]));
    for (let i = 0; i < 5; i++) for (const up of [1, -1]) hard.push(HP.cone(0.008, 0.03, 5).color(0xf4eedc).pbr(0.3).rot(up > 0 ? 180 : 0, 0, 0).at((i - 2) * 0.016, up > 0 ? 0.605 : 0.5, 0.45 + (2 - Math.abs(i - 2)) * 0.024 - (up > 0 ? 0 : 0.02)).lod(1));
    if (o.plumes) {
      // a ruff of long feathers standing round the back of the skull
      const feather = [[0, 0], [0.035, 0.08], [0.04, 0.24], [0, 0.4], [-0.04, 0.24], [-0.035, 0.08]];
      for (let i = 0; i < 9; i++) { const a = -100 + i * 25, col = o.plumes[i % o.plumes.length]; hard.push(HP.extrude(feather, 0.012, 0.003).scale(1, 0.85 + 0.3 * Math.abs(Math.cos(i * 1.3)), 1).rot(-38, 0, 0).rot(0, 0, a).at(0, 0.65, 0.2).color(col).pbr(0.7)); }
    } else {
      const base = [[0.16, 0.75], [0.08, 0.68], [0.01, 0.57], [-0.02, 0.44], [-0.02, 0.32], [-0.07, 0.2], [-0.17, 0.07], [-0.29, -0.04]], out = [];
      for (let i = 0; i < base.length - 1; i++) { const a2 = base[i], b2 = base[i + 1], nx = -(b2[1] - a2[1]), ny = b2[0] - a2[0], l = Math.hypot(nx, ny), hh = 0.075 - i * 0.004; out.push(a2, [(a2[0] + b2[0]) / 2 - (nx / l) * hh + 0.02, (a2[1] + b2[1]) / 2 - (ny / l) * hh + 0.03]); }
      out.push(base[base.length - 1]);
      for (let i = base.length - 1; i >= 0; i--) out.push([base[i][0] + 0.03, base[i][1] - 0.012]);
      hard.push(h(plateZY(out, 0.014)));
    }
    return { prims, hard };
  };
}
/** a swan: breast, a long curved neck, a small head bowed over the water, wings laid back */
function swanFig(o) {
  return () => {
    const g = (pr) => pr.color(o.col).pbr(o.ro ?? 0.55, o.me ?? 0);
    const prims = [
      g(S.ellipsoid(0.17, 0.2, 0.24)).at(0, -0.06, -0.14).blend(0.05),
      ...S.limb([[0, -0.1, -0.1], [0, 0.12, 0.08], [0, 0.4, 0.17], [0, 0.66, 0.1], [0, 0.82, -0.02], [0, 0.9, 0.06]], [0.12, 0.09, 0.062, 0.05, 0.046, 0.046]).map((c) => g(c).blend(0.05)),
      g(S.ellipsoid(0.052, 0.05, 0.075)).at(0, 0.89, 0.12).blend(0.03),
      S.capsule([0, 0.875, 0.18], [0, 0.8, 0.32], 0.032, 0.014).color(o.beak).pbr(0.4, o.beakMe ?? 0.6).blend(0.012),
      S.sphere(0.022).at(0, 0.905, 0.19).color(0x18181c).pbr(0.4).blend(0.008),
    ];
    const wing = [[0.05, -0.18], [0.06, 0.12], [-0.12, 0.3], [-0.16, 0.2], [-0.3, 0.3], [-0.31, 0.18], [-0.46, 0.24], [-0.44, 0.12], [-0.6, 0.12], [-0.5, 0.0], [-0.62, -0.06], [-0.4, -0.12], [-0.2, -0.2]];
    const hard = HP.mirrorX([
      HP.sphere(0.011, 8).color(0x101014).pbr(0.2).at(0.04, 0.9, 0.15),
      plateZY(wing, 0.022).rot(0, 14, 0).at(0.165, 0.0, -0.1).color(o.wing ?? o.col).pbr(o.ro ?? 0.55, o.me ?? 0),
      ...[[-0.3, 0.3], [-0.46, 0.24], [-0.6, 0.12], [-0.62, -0.06]].map(([z, y]) => HP.tube([[0, 0.0, 0.02], [0, y * 0.55, z * 0.55], [0, y, z]], [0.016, 0.011, 0.004], 6, 5).rot(0, 14, 0).at(0.18, 0.0, -0.1).color(o.hi ?? o.beak).pbr(0.35, 0.85)),
    ]);
    hard.push(HP.torus(0.062, 0.012, 14, 6).rot(72, 0, 0).at(0, 0.3, 0.14).color(o.hi ?? o.beak).pbr(0.3, 0.9));
    return { prims, hard };
  };
}
/** a roaring lion's head in a heavy mane */
function lionFig(o) {
  return () => {
    const g = (pr) => pr.color(o.col).pbr(o.ro ?? 0.4, o.me ?? 0.85), m = (pr) => pr.color(o.mane ?? o.col).pbr((o.ro ?? 0.4) + 0.1, o.me ?? 0.85).bump(0.028, 9, 'fur').tint(0.2, 14);
    const prims = [
      m(S.capsule([0, -0.18, -0.36], [0, 0.04, -0.02], 0.16, 0.19)).blend(0.05),
      m(S.ellipsoid(0.2, 0.22, 0.17)).at(0, 0.16, 0.0).blend(0.05),
      g(S.ellipsoid(0.105, 0.11, 0.12)).at(0, 0.17, 0.15).blend(0.03),
      g(S.capsule([0, 0.16, 0.2], [0, 0.13, 0.33], 0.07, 0.058)).blend(0.03),
      g(S.capsule([0, 0.07, 0.17], [0, 0.03, 0.3], 0.045, 0.032)).blend(0.012),
      S.ellipsoid(0.034, 0.02, 0.026).at(0, 0.165, 0.385).color(0x2a1c14).pbr(0.6).paint(0.006),
      S.ellipsoid(0.03, 0.012, 0.06).rot(14, 0, 0).at(0, 0.075, 0.26).color(0x9c2f22).pbr(0.6).blend(0.004),
      g(S.capsule([0, 0.25, 0.14], [0, 0.2, 0.3], 0.036, 0.024)).blend(0.03),
      ...S.mirrorX([
        g(S.capsule([0.04, 0.245, 0.2], [0.085, 0.235, 0.24], 0.024, 0.016)).blend(0.015),
        S.sphere(0.024).at(0.06, 0.205, 0.245).cut(0.008),
        g(S.ellipsoid(0.03, 0.036, 0.016)).at(0.125, 0.3, 0.1).blend(0.012),
        g(S.ellipsoid(0.04, 0.034, 0.05)).at(0.05, 0.125, 0.32).blend(0.02),
      ]),
    ];
    const hard = HP.mirrorX([HP.sphere(0.014, 8).color(o.eye ?? 0x2a1a10).pbr(0.2).glow(o.eyeGlow ?? 0).at(0.058, 0.206, 0.25)]);
    for (const [x, up] of [[-0.026, 1], [0.026, 1], [-0.022, -1], [0.022, -1]]) hard.push(HP.cone(0.009, 0.036, 5).color(0xf4eedc).pbr(0.3).rot(up > 0 ? 180 : 0, 0, 0).at(x, up > 0 ? 0.115 : 0.07, up > 0 ? 0.345 : 0.3).lod(1));
    return { prims, hard };
  };
}
/** set a sculpted figure at (x, y, 0) facing the bow (or turned by yaw), scaled */
function figure(name, make, x, y, scale, o = {}) {
  p.shade(null).TM(X(x, y, o.z || 0, o.pitch || 0, 90 + (o.yaw || 0), 0, scale)).geo(K.sculpted(`fleet:${name}`, make, o.res ?? 44, tier));
}

// ---------- dressing shared by the sailing ships ----------
/** re-cut the gun ports after their stations have been changed */
function recutPorts(s) {
  for (const k of Object.keys(s.holes)) delete s.holes[k];
  s.openPorts = [];
  for (const q of s.ports) {
    if (q.band === 'D') { const g = s.hull.segs.find((x) => q.s <= x.s1) || s.hull.segs[s.hull.segs.length - 1]; q.open = q.h0 >= g.lift + 0.08 && q.h1 <= g.lift + g.bul + 0.01; if (q.open) s.openPorts.push(q); }
    for (let j = q.rows[0]; j <= q.rows[1]; j++) (s.holes[`${q.band}${j}`] ||= []).push([q.s - q.hw, q.s + q.hw]);
  }
  for (const k of Object.keys(s.holes)) s.holes[k].sort((x, y) => x[0] - y[0]);
}
/** crowd the gun ports fore and aft of a paddle wheel at station sW (gap: half the room it needs, as a fraction of the length) */
function portsClearOf(s, sW, gap) {
  if (!s.ports.length) return;
  const a = Math.min(...s.ports.map((q) => q.s - q.hw)) - 0.01, b = Math.max(...s.ports.map((q) => q.s + q.hw)) + 0.01;
  if (a > sW + gap || b < sW - gap) return;
  const fA = Math.max(0.15, (sW - gap - a) / Math.max(1e-6, sW - a)), fB = Math.max(0.15, (b - sW - gap) / Math.max(1e-6, b - sW));
  for (const q of s.ports) { const fwd = q.s >= sW, f = fwd ? fB : fA; q.s = fwd ? b - (b - q.s) * f : a + (q.s - a) * f; q.hw *= Math.min(1, f * 1.5); q.w *= Math.min(1, f * 1.5); }
  recutPorts(s);
}
/** a rotten hole through the planking of the lower hull about station sc: rows a..b of the st.nC strakes */
function hullHole(s, sc, a, b, len) {
  for (let j = a; j <= b; j++) { const t = (j - a) / Math.max(1, b - a), hw = (len / 2 / s.L) * (0.35 + 0.65 * Math.sin(Math.PI * (0.15 + 0.7 * t))) * (0.8 + 0.4 * hash2(j, Math.round(sc * 100))), off = (hash2(j + 7, Math.round(sc * 100)) - 0.5) * len * 0.3 / s.L; (s.holes[`C${j}`] ||= []).push([sc + off - hw, sc + off + hw]); s.holes[`C${j}`].sort((x, y) => x[0] - y[0]); }
  (s.rot ||= []).push({ sc, a, b, len });
}
/** what shows through the holes: darkness, and the ribs of the ship */
function ribsBehind() {
  for (const r of st.rot || []) bothSides(() => {
    const y0 = lerp(H.yS, H.yGun(r.sc), (r.a - 0.3) / st.nC), y1 = lerp(H.yS, H.yGun(r.sc), (r.b + 1.3) / st.nC), s0 = r.sc - r.len * 0.75 / L, s1 = r.sc + r.len * 0.75 / L;
    p.shade(null).ink(PITCH, 1).grid(4, 2, (i, j, out) => { const q = H.pt(lerp(s0, s1, i / 4), lerp(y0, y1, j / 2), -0.16); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; });
    const n = Math.max(2, Math.round((r.len * 1.3) / 0.17));
    p.shade(K.mottle(0.3, 20)).ink(mul(mix(CH, BONE, 0.6), 0.9), 0.9);
    for (let i = 0; i < n; i++) { const s = lerp(s0, s1, (i + 0.5) / n); p.bar(H.pt(s, y0 - 0.03, -0.085), H.pt(s, y1 + 0.03, -0.085), 0.03, 0.03, 4, 0); }
    p.shade(null);
  });
}
/** crenellations along the rail of a castle deck (and across the stern if it reaches it) */
function merlons(g, mh, col) {
  const t = H.o.thick, n = Math.max(2, Math.round(((g.s1 - g.s0) * L) / 0.27)), pitch = ((g.s1 - g.s0) * L) / n;
  p.shade(K.grainY(0.1)).ink(col, 0.8);
  bothSides(() => { for (let i = 0; i < n; i++) { const s = lerp(g.s0, g.s1, (i + 0.5) / n); if (s > 0.975) continue; p.push(H.frame(s, H.railY(s, g) + st.capH - 0.004, -t / 2)); p.T(0, mh / 2, 0).box(pitch * 0.56, mh, t + 0.05, 0.008); p.pop(); } });
  if (g.s0 < 0.01) { const y = H.railY(0, g) + st.capH - 0.004, zt = H.z(0, y), n2 = Math.max(2, Math.round((2 * zt) / 0.27)); for (let i = 0; i < n2; i++) p.T(H.x(0, y) + t / 2, y + mh / 2, -zt + (i + 0.5) * (2 * zt / n2)).box(t + 0.05, mh, (2 * zt / n2) * 0.56, 0.008); }
  p.shade(null);
}
/** hoar frost and snow on everything that faces the sky */
function frost(from, y0 = 0.25, k = 0.8) {
  const snow = hex(0xeef4fa);
  repaint(from, (x, y, z, nx, ny, nz, c) => { if (y < y0 || ny < 0.35) return null; const f = smooth(0.35, 0.85, ny) * k * (0.45 + 0.75 * fbm3(x * 4, y * 4, z * 4, 2)); return f > 0.02 ? mix(c, snow, clamp(f, 0, 0.92)) : null; });
}
/** icicles hanging under a line of points */
function icicles(pts, h = 0.14, every = 1) {
  if (far) return;
  p.shade(null).ink(ICE, 0.15, 0.1, 0.35);
  pts.forEach((q, i) => { if (i % every) return; const hh = h * (0.35 + 0.9 * hash2(i, 5)); p.T(q[0], q[1], q[2]).lathe([[0.014 + 0.012 * hash2(i, 9), 0], [0.008, -hh * 0.5], [0, -hh]], 4); });
}
const railLine = (g, n, out = 0.03, up = 0) => Array.from({ length: n + 1 }, (_, i) => { const s = clamp(lerp(g.s0, g.s1, i / n), 0.003, 0.985); return H.pt(s, H.railY(s, g) + up, out); });
const mirrorPts = (pts) => pts.map((q) => [q[0], q[1], -q[2]]);
/** brass frames round every gun port */
function portFrames(col = BRASS) {
  if (far) return;
  bothSides(() => { for (const port of st.ports) { const { lo, hi } = K.portGeom(H, st, port), s = port.s, y0 = lo(s), y1 = hi(s), w = port.w; p.push(H.frame(s, (y0 + y1) / 2, 0.004)); metal(col, 0.35, 0.9); const h = y1 - y0; for (const sg of [-1, 1]) { p.T(sg * (w / 2 + 0.012), 0, 0.01).box(0.03, h + 0.05, 0.03); p.T(0, sg * (h / 2 + 0.012), 0.01).box(w + 0.05, 0.03, 0.03); } p.pop(); } });
}
/** rivets along a line on the side at height yAt(s) */
function rivets(s0, s1, yAt, pitch = 0.16, col = IRON, r = 0.014) {
  if (lite) return;
  bothSides(() => { p.shade(null).ink(col, 0.45, 0.85); const n = Math.round(((s1 - s0) * L) / pitch); for (let i = 0; i <= n; i++) { const s = lerp(s0, s1, i / n), q = H.pt(s, yAt(s), 0.004); p.T(q[0], q[1], q[2]).sphere(r, 5, 3); } });
}
/** iron (or bronze) straps down the side at stations, from height y0(s) to y1(s) */
function straps(list, y0, y1, w = 0.07, col = IRON, pbr = [0.5, 0.8]) {
  bothSides(() => { p.shade(K.mottle(0.25, 22)).ink(col, ...pbr); for (const s of list) { const n = 4; p.grid(1, n, (i, j, out) => { const y = lerp(y0(s), y1(s), j / n), q = H.pt(s + (i - 0.5) * w / L, y, 0.014); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; }); } p.shade(null); });
}
/** the stock rig plan for n masts of a round ship: [fore, main, mizzen...] */
const roundMasts = (n, o = {}) => (n <= 0 ? [] : n === 1 ? [{ s: 0.52, hf: 1, rake: 1, type: 'square', parts: 2, sq: o.sq ?? 2 }]
  : n === 2 ? [{ s: 0.8, hf: 0.84, rake: 0, type: 'square', parts: 2, sq: o.sq ?? 2 }, { s: 0.46, hf: 1, rake: 1, type: 'square', parts: 2, sq: o.sq ?? 2 }]
    : [{ s: 0.85, hf: 0.86, rake: -1, type: 'square', parts: 2, sq: o.sq ?? 2 }, { s: 0.54, hf: 1, rake: 1, type: 'square', parts: 2, sq: o.sq ?? 2 }, ...Array.from({ length: n - 2 }, (_, i) => ({ s: lerp(0.28, 0.1, n === 3 ? 0 : i / (n - 3)), hf: 0.74 - 0.1 * i, rake: 3, type: 'lateen', parts: 1 }))]);

/** deck furniture for a ship whose decks the stock fitter does not know: hatches, capstan, stores, a boat, a wheel */
function furnish(o = {}) {
  const wood = mul(st.col.rail, 1.05), waist = H.segs.reduce((a, g) => (Math.abs(g.lift) < 0.05 && g.s1 - g.s0 > (a ? a.s1 - a.s0 : 0) ? g : a), null) || H.segs[0];
  const at = (s, zf, fn, yaw = 0) => { p.push(onDeck(s, zf, 0, yaw)); fn(); p.pop(); };
  const ws = (f) => lerp(waist.s0, waist.s1, f), zw = H.zIn(ws(0.5), H.deckEdge(ws(0.5), waist)), hw = clamp(zw * 0.7, 0.2, 0.7);
  for (const f of o.hatches || [0.3, 0.72]) at(ws(f), 0, () => K.hatch(p, 0.36, hw, wood));
  if (o.capstan !== false) at(ws(o.capstan ?? 0.12), 0, () => K.capstan(p, 0.42, wood));
  if (o.boat && zw > 0.9) at(ws(0.5), 0, () => { K.chocks(p, 1.3, 0.5, wood); p.push(X(0, 0.1, 0)); K.shipsBoat(p, 1.3, 0.5, hex(0xd8d2c0), hex(0x9a8560), 40); p.pop(); });
  if (!far && zw > 0.5) { for (let i = 0; i < 2; i++) at(ws(0.2) + (i * 0.26) / L, -0.76, () => K.barrel(p, 0.105, 0.3, mul(OAK, 1.05), 3 + i)); at(ws(0.86), 0.76, () => K.crate(p, 0.28, 0.24, 0.26, mul(OAK, 1.15), 12), 8); at(ws(0.62), 0.74, () => K.coil(p, 0.11, 3, 0.013)); }
  const aft = H.segs[0], fc = H.segs[H.segs.length - 1];
  if (o.wheel && aft !== waist) at(lerp(aft.s0, aft.s1, 0.62), 0, () => K.shipWheel(p, 0.2, wood));
  if (fc !== waist && !far) at(lerp(fc.s0, fc.s1, 0.42), 0, () => K.bitts(p, 0.32, 0.32, wood));
  p.shade(null);
}

// ---------- 1. cog ----------
function buildCog() {
  const k = sizeK(6.5);
  const s = style('galleon', (s, o, C, v) => {
    Object.assign(o, { draft: 0.5 * k, fb: 0.62 * k, sheerF: 0.34 * k, sheerA: 0.3 * k, tumble: 0, rakeF: 0.07 * L, stemE: 1.1, rakeA: 0.06, deckE: 0.62, midE: 0.8, tWl: 0.25, tMid: 0.55, tDeck: 0.64, leanMin: -0.06, leanMax: 0.12,
      segs: [{ s0: 0, s1: 0.28, lift: 1.22 * k, bul: 0.42 }, { s0: 0.28, s1: 0.79, lift: 0, bul: 0.47 }, { s0: 0.79, s1: 1, lift: 1.06 * k, bul: 0.42 }] });
    s.lap = 0.013; s.plank = 3.4;
    v.walesC = []; v.portsC = null; v.portRows = [2, 3]; v.spread = [0.31, 0.77];
    C.accent = mix(CH, WHITE, 0.3); C.upper = CS2; C.top = mul(CH, 0.5); C.inner = mul(CH, 1.1); C.wale = mul(CH, 0.45); C.bottom = hex(0x3a2c22);
  }, {
    mid: (s, o, C) => { s.stern = { tiers: [[0.2 * k, 0.66 * k, 2]], frame: CT, pilaster: CS2, quarterPieces: [0, 1.2 * k], trim: C.accent }; s.head = null; s.chW = 0.1; },
    rig: (R) => { R.masts = nm <= 1 ? (nm ? [{ s: 0.5, hf: 1, rake: 0, type: 'square', parts: 2, sq: 1 }] : []) : nm === 2 ? [{ s: 0.5, hf: 1, rake: 0, type: 'square', parts: 2, sq: 1 }, { s: 0.14, hf: 0.62, rake: 3, type: 'lateen', parts: 1 }] : [{ s: 0.88, hf: 0.6, rake: -3, type: 'square', parts: 1, sq: 1 }, { s: 0.5, hf: 1, rake: 0, type: 'square', parts: 2, sq: 1 }, { s: 0.14, hf: 0.62, rake: 3, type: 'lateen', parts: 1 }];
      R.sprit = nm ? { len: 0.15 * L, steeve: 30, inboard: 0.1 * L } : null; R.jibs = 0; R.tops = 'basket'; R.shrouds = 4; R.truck *= 1.04; },
    post: (s, o, C) => {
      // the castles are painted in the lord's two colours, band over band
      s.rowD = (j, g, last) => (g.lift > 0.3 && j * s.sw >= g.lift - 0.03 ? { col: () => (last ? CT : (Math.floor((j * s.sw - g.lift) / 0.17) % 2 ? CS : CS2)), proud: last ? 0.006 : 0, vary: 0.05 } : last ? { col: () => C.top, proud: 0.006, vary: 0.05 } : { col: () => C.hull, proud: 0, vary: 0.07 });
      s.sqSail = sailBy((o2) => (o2.wFoot > B ? quarters() : stripes(4)));
      s.triSail = (pen, o2) => { const tp = triP({ tack: o2.tack, peak: o2.head, clew: o2.clew, belly: o2.belly }); cloth(tp.P, { seed: 3, ...stripes(5) }); return tp; };
      s.bulkCol = mul(CS2, 0.8); s.balCol = CT; s.fitAs = 'none';
    } });
  const fl = launch(s);
  furnish({ hatches: [0.72] });
  for (const g of H.segs) if (g.lift > 0.3) {
    merlons(g, 0.15, mul(CS2, 0.9));
    // a row of little painted shields under the battlements
    const n = Math.max(2, Math.round(((g.s1 - g.s0) * L) / 0.42));
    if (!far) shields(n, g.s0 + 0.02, Math.min(g.s1, 0.97), 0.11, (i) => (i % 2 ? CS : CT), { y: (ss) => H.yGun(ss) + g.lift + 0.26 });
  }
  return fl;
}

// ---------- 20. treasure galleon ----------
function buildTreasureGalleon() {
  const k = sizeK(9);
  const s = style('galleon', (s, o, C, v) => {
    Object.assign(o, { draft: 0.75 * k, fb: 0.92 * k, sheerF: 0.24, sheerA: 0.5, tumble: 0.12, rakeF: 0.1 * L, rakeA: 0.22, deckE: 0.5, midE: 0.72, tDeck: 0.62, leanMin: -0.36,
      segs: [{ s0: 0, s1: 0.11, lift: 2.2 * k, bul: 0.42 }, { s0: 0.11, s1: 0.24, lift: 1.56 * k, bul: 0.44 }, { s0: 0.24, s1: 0.44, lift: 0.9 * k, bul: 0.46 }, { s0: 0.44, s1: 0.8, lift: 0, bul: 0.51 }, { s0: 0.8, s1: 1, lift: 0.62 * k, bul: 0.42 }] });
    C.accent = mix(CT, WHITE, 0.15); C.upper = CS2; C.top = hex(0x1f1611); C.bottom = hex(0x3b2a20); C.inner = mul(CH, 1.1); C.wale = mul(CH, 0.4);
    v.walesC = [1, 2, 7]; v.portsC = [3, 5]; v.spread = [0.2, 0.8];
  }, {
    mid: (s, o, C) => {
      s.stern = { tiers: [[0.16, 0.74 * k, 4], [1.04 * k, 1.44 * k, 4], [1.7 * k, 2.08 * k, 3]], balcony: 0.9 * k, arch: 0.3, lanterns: 3, lanternH: 0.4, quarter: [0.08, 0.8 * k, 0.9, 0.2], quarterPieces: [0, 2.5 * k], pilaster: C.trim, balCol: C.trim, badge: 2.36 * k };
      s.head = { type: 'ram', len: 1.3 * k, tip: 0.06, e: 1.2, rails: 2, railY: 0.48, drop: 0.3, bow: -0.03, platform: true, railCol: C.upper, size: 1.3 * k, railS: 0.9, trail: 0.5 };
    },
    rig: (R) => { if (nm !== 3) R.masts = roundMasts(nm); },
    post: (s, o, C) => {
      s.rowD = (j, g, last) => (j > 5 ? { col: () => [C.upper, CT, C.upper, mul(CH, 0.5)][((j - 6) >> 1) % 4], proud: 0, vary: 0.05 } : last && g.lift + g.bul < 0.7 ? { col: () => C.top, proud: 0.006, vary: 0.05 } : j >= 2 && j <= 4 ? { col: () => C.accent, proud: 0, vary: 0.05 } : { col: () => (j < 2 ? C.hull : C.top), proud: 0, vary: 0.06 });
      s.balCol = CT; s.fitAs = 'none';
    } });
  const fl = launch(s);
  furnish({ boat: true, wheel: false });
  setTrimRows();
  return fl;
}
/** gilded strakes are gold, not paint */
function setTrimRows() {
  const t = CT;
  for (let i = 0; i < p.n; i++) { const q = i * 3; if (Math.abs(p.C[q] - t[0]) + Math.abs(p.C[q + 1] - t[1]) + Math.abs(p.C[q + 2] - t[2]) < 0.012 && p.M[q + 1] === 0) { p.M[q] = CTp[0] + 0.1; p.M[q + 1] = CTp[1] * 0.8; } }
}

// ---------- 18. fluyt ----------
function buildFluyt() {
  const k = sizeK(7.5);
  const s = style('galleon', (s, o, C, v) => {
    Object.assign(o, { draft: 0.62 * k, fb: 0.8 * k, sheerF: 0.2, sheerA: 0.52, tumble: 0.34, midK: 1.08, rakeF: 0.06 * L, stemE: 1.5, rakeA: 0.1, deckE: 0.5, midE: 0.7, tWl: 0.5, tMid: 0.86, tDeck: 0.5, leanMin: -0.62, leanMax: 0.02, kMid: 3.4,
      segs: [{ s0: 0, s1: 0.15, lift: 1.26 * k, bul: 0.4 }, { s0: 0.15, s1: 0.36, lift: 0.7 * k, bul: 0.42 }, { s0: 0.36, s1: 0.84, lift: 0, bul: 0.46 }, { s0: 0.84, s1: 1, lift: 0.36 * k, bul: 0.36 }] });
    C.accent = hex(0xd8c79a); C.upper = CS2; C.top = hex(0x1c1612); C.bottom = hex(0x3b2a20); C.inner = mul(CH, 1.1); C.wale = mul(CH, 0.42);
    v.walesC = [1, 2, 6]; v.portsC = [3, 5]; v.portRows = [2, 3]; v.spread = [0.17, 0.83];
  }, {
    mid: (s, o, C) => {
      s.stern = { tiers: [[0.14, 0.56 * k, 3], [0.84 * k, 1.16 * k, 3]], arch: 0.36, lanterns: 1, lanternH: 0.4, quarterPieces: [0, 1.62 * k], pilaster: C.trim, badge: 1.42 * k };
      s.head = { type: 'scroll', len: 0.55 * k, tip: 0.36, scroll: 0.09, trail: 0.5, rails: 2, railY: 0.46, drop: 0.26, platform: true };
    },
    rig: (R) => { if (nm !== 3) R.masts = roundMasts(nm); },
    post: (s, o, C) => { s.rowD = (j, g, last) => (j * s.sw > g.lift + 0.02 && g.lift > 0.3 ? { col: () => (last ? CT : j % 2 ? C.upper : mul(C.upper, 0.72)), proud: last ? 0.006 : 0, vary: 0.05 } : last ? { col: () => C.top, proud: 0.006, vary: 0.05 } : j >= 2 && j <= 3 ? { col: () => C.accent, proud: 0, vary: 0.05 } : { col: () => C.hull, proud: 0, vary: 0.06 }); } });
  const fl = launch(s);
  setTrimRows();
  // long bright pennants from every masthead and the ensign staff
  for (const f of fl) { if (f.kind === 'flag') { f.kind = 'pennant'; f.hgt *= 0.8; f.len = clamp(0.3 * L, 0.8, 3); } else if (f.kind === 'pennant') f.len *= 1.5; }
  return fl;
}

// ---------- 9. icebreaker ----------
function buildIcebreaker() {
  const k = sizeK(8.5);
  const s = style('galleon', (s, o, C, v) => {
    Object.assign(o, { draft: 0.78 * k, fb: 0.9 * k, sheerF: 0.34, sheerA: 0.36, tumble: 0.07, rakeF: 0.13 * L, stemE: 1.05, rakeA: 0.16, deckE: 0.62, midE: 0.8, wlE: 1.25, tDeck: 0.72,
      segs: [{ s0: 0, s1: 0.2, lift: 1.4 * k, bul: 0.45 }, { s0: 0.2, s1: 0.42, lift: 0.8 * k, bul: 0.45 }, { s0: 0.42, s1: 0.8, lift: 0, bul: 0.51 }, { s0: 0.8, s1: 1, lift: 0.56 * k, bul: 0.42 }] });
    C.accent = mix(CH, ICE, 0.45); C.upper = mix(CS2, hex(0x26323c), 0.4); C.top = hex(0x16181c); C.bottom = hex(0x23282e); C.inner = mul(CH, 1.1); C.wale = hex(0x1e2126); C.stripe = hex(0xc8d4dc);
    v.walesC = [1, 2, 7]; v.portsC = [3, 5]; v.spread = [0.2, 0.76];
  }, {
    mid: (s, o, C) => { s.stern = { tiers: [[0.16, 0.7 * k, 4], [0.96 * k, 1.32 * k, 4]], arch: 0.2, lanterns: 1, lanternH: 0.4, quarterPieces: [0, 1.8 * k], pilaster: C.accent, frame: hex(0xc8d4dc), trim: mix(IRON, ICE, 0.3), badge: 1.56 * k }; s.head = null; s.stemHead = 0.3; },
    rig: (R) => { if (nm !== 3) R.masts = roundMasts(nm); if (R.sprit) { R.sprit.len *= 0.8; R.sprit.steeve = 34; } },
    post: (s, o, C) => { s.rowD = (j, g, last) => (j > 5 ? { col: () => (j % 2 ? C.upper : mul(C.upper, 0.75)), proud: 0, vary: 0.05 } : last && g.lift + g.bul < 0.7 ? { col: () => C.top, proud: 0.006, vary: 0.05 } : j >= 2 && j <= 4 ? { col: () => C.accent, proud: 0, vary: 0.05 } : { col: () => (j < 2 ? C.hull : C.top), proud: 0, vary: 0.06 }); } });
  const from = p.n, fl = launch(s), d = H.d;
  // the bow sheathed in iron plate, strapped and riveted
  const plateC = hex(0x3a3d44), y1 = (ss) => H.yGun(ss) + 0.12;
  bothSides(() => {
    const cols = H.between(0.74, 1), nr = far ? 3 : 6;
    p.shade(K.mottle(0.3, 16)).ink(plateC, 0.5, 0.75);
    p.grid(cols.length - 1, nr, (i, j, out) => { const ss = cols[i], edge = 0.02 * L * hash2(j, 3) / L, s2 = i === 0 ? ss + edge : ss, q = H.pt(s2, lerp(-d * 0.96, y1(s2), j / nr), 0.024); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
      (i, j) => mul(plateC, (0.8 + 0.4 * hash2(i >> 1, j)) * (j === 0 ? 0.6 : 1)));
    p.shade(null);
  });
  straps([0.78, 0.84, 0.9, 0.95], () => -d * 0.9, (ss) => y1(ss) + 0.02, 0.06, hex(0x202227));
  rivets(0.75, 0.985, (ss) => y1(ss) - 0.03, 0.13, hex(0x8a8f98)); rivets(0.75, 0.985, () => H.yS + 0.04, 0.13, hex(0x8a8f98));
  // the ram: a ploughshare of iron bolted over the stem, saw-edged above the water
  const xs = (y) => H.x(1, y), rl = clamp(0.12 * L, 0.5, 1.4), yt = H.yGun(1) + 0.3;
  const ram = [[xs(-d) - 0.3, -d - 0.06], [xs(-d * 0.5) + rl * 0.6, -d * 0.55], [xs(0) + rl, -0.05], [xs(0.1) + rl * 0.96, 0.12]];
  const teeth = 5; for (let i = 0; i < teeth; i++) { const t1 = (i + 0.55) / teeth, yb = lerp(0.12, yt, t1), yc = lerp(0.12, yt, (i + 1) / teeth); ram.push([xs(yb) + lerp(rl * 0.86, 0.2, t1) + 0.1, yb], [xs(yc) + lerp(rl * 0.9, 0.16, (i + 1) / teeth), yc]); }
  ram.push([xs(yt) - 0.1, yt + 0.05], [xs(0) - 0.1, 0]);
  p.shade(K.mottle(0.3, 12)).ink(hex(0x30333a), 0.45, 0.8).extrude(ram, clamp(0.02 * L, 0.1, 0.2), false);
  p.shade(null).ink(hex(0x8a8f98), 0.4, 0.85);
  if (!lite) for (let i = 0; i < 6; i++) { const y = lerp(-d * 0.4, yt - 0.1, i / 5); for (const sg of [-1, 1]) p.T(xs(y) + 0.08, y, sg * clamp(0.01 * L, 0.05, 0.1) * 1.02).sphere(0.022, 5, 3); }
  // figurehead: a burst of frost crystal over the ram
  const fx = xs(yt) + 0.12, fy = yt + 0.16, ck = clamp(L / 8.5, 0.6, 1.3) * 1.9;
  for (const [rx, rz, h, r] of [[-62, 0, 0.62, 0.085], [-40, 22, 0.4, 0.06], [-40, -22, 0.4, 0.06], [-84, 14, 0.36, 0.05], [-84, -14, 0.36, 0.05], [-18, 0, 0.3, 0.05], [-58, 40, 0.26, 0.04], [-58, -40, 0.26, 0.04]].slice(0, far ? 3 : 8))
    crystal(X(fx, fy, 0, rz, 0, rx, ck), h, r, hex(0x4aa8f0), 0.8);
  // furs slung over the stern and the quarters
  const g0 = H.segs[0], fur = hex(0x8a6a48), top = H.railY(0, g0) + st.capH, zt = H.z(0, top);
  drape(Array.from({ length: 9 }, (_, i) => [H.x(0, top) - 0.03, top + 0.03, lerp(-zt, zt, i / 8)]), 0.7 * k, fur, { fur: true, out: [-1, 0, 0], rag: 0.35, seed: 3, bulge: 0.05, lean: 0.14 });
  for (const sg of [1, -1]) { const pts = railLine(g0, 6, 0.035, st.capH + 0.02).map((q) => [q[0], q[1], sg * q[2]]); drape(pts, 0.62 * k, sg > 0 ? fur : hex(0xb0a898), { fur: true, out: [0, 0, sg], rag: 0.4, seed: sg + 5, bulge: 0.07, lean: 0.05 }); }
  // frost on everything, icicles under the rails and the wales
  frost(from, 0.3, 0.85);
  for (const g of H.segs) { const pts = railLine(g, Math.round(((g.s1 - g.s0) * L) / 0.12), 0.03, -0.01); icicles(pts, 0.17, lite ? 2 : 1); icicles(mirrorPts(pts), 0.17, lite ? 2 : 1); }
  { const n = Math.round(L / 0.16), pts = Array.from({ length: n }, (_, i) => { const ss = lerp(0.05, 0.74, i / (n - 1)); return H.pt(ss, lerp(H.yS, H.yGun(ss), 1.5 / st.nC), 0.03); }); icicles(pts, 0.12, 2); icicles(mirrorPts(pts), 0.12, 2); }
  return fl;
}

// ---------- 15. shroud galleon (and its drowned sister) ----------
function buildShroudGalleon() {
  const k = sizeK(8.5), ghost = !!def.ghost, weed = hex(0x2f5a34), pall = hex(0x0e0d10);
  const s = style('galleon', (s, o, C, v) => {
    Object.assign(o, { draft: 0.72 * k, fb: 0.88 * k, sheerF: 0.3, sheerA: 0.46, tumble: 0.1, rakeF: 0.08 * L, rakeA: 0.2, deckE: 0.5, midE: 0.72, tDeck: 0.7, leanMin: -0.34,
      segs: [{ s0: 0, s1: 0.2, lift: 1.5 * k, bul: 0.45 }, { s0: 0.2, s1: 0.43, lift: 0.85 * k, bul: 0.45 }, { s0: 0.43, s1: 0.79, lift: 0, bul: 0.51 }, { s0: 0.79, s1: 1, lift: 0.7 * k, bul: 0.42 }] });
    const rot = ghost ? mix(CH, hex(0x3c5a52), 0.45) : mix(CH, hex(0x2a2826), 0.45);
    C.hull = rot; C.accent = mul(mix(rot, BONE, 0.35), 0.9); C.upper = ghost ? mix(rot, weed, 0.3) : mul(rot, 0.55); C.top = mul(rot, 0.4); C.bottom = ghost ? hex(0x24382e) : hex(0x1c1a19); C.inner = mul(rot, 0.9); C.wale = mul(rot, 0.4);
    C.stripe = ghost ? hex(0x9ab8a0) : hex(0x6a6660); C.deck = mix(DECK, rot, 0.6); C.rail = mul(rot, 0.7); C.transom = rot; C.spar = ghost ? hex(0x5a6a5c) : hex(0x3a322c); C.trim = ghost ? hex(0x7aa88a) : mul(CT, 0.5);
    v.walesC = [1, 2, 7]; v.portsC = [3, 5]; v.spread = [0.2, 0.8];
  }, {
    mid: (s, o, C) => { s.stern = { tiers: [[0.16, 0.72 * k, 4], [1.02 * k, 1.42 * k, 4]], balcony: 0.86 * k, arch: 0.24, lanterns: 0, quarter: [0.08, 0.76 * k, 0.8, 0.2], quarterPieces: [0, 1.95 * k], pilaster: C.upper, balCol: C.accent, frame: C.accent, trim: C.accent, roof: C.top };
      s.head = { type: 'scroll', len: 0.9 * k, tip: 0.1, e: 1.25, scroll: 0.1, rails: 2, railY: 0.5, drop: 0.3, bow: -0.03, platform: true, railCol: C.upper, railS: 0.9 }; },
    rig: (R) => { if (nm !== 3) R.masts = roundMasts(nm); },
    post: (s, o, C) => {
      s.rowD = (j, g, last) => ({ col: (kk) => (hash2(j, kk) > 0.8 ? mul(C.hull, 0.6) : j > 5 ? C.upper : last ? C.top : C.hull), proud: 0, vary: 0.16 });
      s.rowC = (j) => ({ col: (kk) => (hash2(j + 40, kk) > 0.82 ? mul(C.hull, 0.55) : C.hull), proud: j === 1 || j === 2 ? 0.02 : 0, vary: 0.16 });
      hullHole(s, 0.335, Math.max(2, s.nC - 6), s.nC - 2, 0.95 * k); hullHole(s, 0.64, Math.max(1, s.nC - 8), s.nC - 4, 0.8 * k); if (L > 6) hullHole(s, 0.86, Math.max(2, s.nC - 5), s.nC - 2, 0.5 * k);
      const cl = (o2) => (ghost ? { col: CS, rag: 0.42, ragN: 9, glow: 0.5, ro: 0.8 } : { col: CS, rag: 0.5, ragN: 9, glow: 0.02 });
      s.sqSail = sailBy(cl);
      s.triSail = (pen, o2) => { const tp = triP({ tack: o2.tack, peak: o2.head, clew: o2.clew, belly: o2.belly }); cloth(tp.P, { seed: 4, ...cl(o2), rag: 0.3 }); return tp; };
    } });
  const fl = launch(s);
  ribsBehind();
  const lamp = (q, h = 0.2) => { p.shade(null).ink(IRON, 0.6, 0.7).bar(q, [q[0], q[1] + h * 0.5, q[2]], 0.01, 0.01, 4, 0); p.ink(ghost ? hex(0x18e060) : hex(0xb8c8ff), 0.3, 0, 1.0).T(q[0], q[1] - h * 0.3, q[2], 0, 0, 0, 1, 1.25, 1).sphere(h * 0.36, 7, 5); p.ink(IRON, 0.6, 0.7).T(q[0], q[1] + h * 0.06, q[2]).lathe([[h * 0.4, 0], [h * 0.12, h * 0.2], [0, h * 0.24]], 6); };
  H.segs.forEach((g, gi) => {
    const n = Math.max(3, Math.round(((g.s1 - g.s0) * L) / 0.16));
    for (const sg of [1, -1]) {
      const pts = railLine(g, n, 0.03, st.capH + 0.012).map((q) => [q[0], q[1], sg * q[2]]);
      if (ghost) drape(pts, 0.42 * k, weed, { out: [0, 0, sg], rag: 0.85, seed: gi * 3 + sg, bulge: 0.03, sway: 0.05, len: (t) => 0.4 + 1.2 * Math.abs(Math.sin(t * 9 + gi)) });
      else if (g.lift > 0.3 || gi % 2 === 0) drape(pts, (g.lift > 0.3 ? 0.9 : 0.5) * k, pall, { out: [0, 0, sg], rag: 0.45, seed: gi * 3 + sg, bulge: 0.06, sway: 0.03, len: (t) => 0.55 + 0.45 * Math.sin(Math.PI * t) });
    }
  });
  { const g0 = H.segs[0], top = H.railY(0, g0) + st.capH, zt = H.z(0, top) + 0.02;
    drape(Array.from({ length: 11 }, (_, i) => [H.x(0, top) - 0.04, top + 0.02, lerp(-zt, zt, i / 10)]), (ghost ? 0.8 : 1.5) * k, ghost ? weed : pall, { out: [-1, 0, 0], rag: ghost ? 0.8 : 0.4, seed: 9, bulge: 0.05, lean: 0.2 });
    for (const sg of [-1, 1]) lamp([H.x(0, top) - 0.12, top + 0.3, sg * zt * 0.7], 0.26 * k);
    if (!ghost) p.shade(null).ink(IRON, 0.6, 0.7), [-1, 1].forEach((sg) => p.bar([H.x(0, top), top, sg * zt * 0.7], [H.x(0, top) - 0.12, top + 0.42, sg * zt * 0.7], 0.012, 0.012, 4, 0)); }
  if (ghost) {
    // barnacles crusting the hull to the wales, weed trailing from the wales, corpse-lights at the rails
    const nB = far ? 0 : lite ? 30 : 90;
    bothSides(() => { for (let i = 0; i < nB; i++) { const ss = 0.04 + 0.92 * hash2(i, 1), y = lerp(-0.1, H.yGun(ss) * 0.75, Math.pow(hash2(i, 2), 1.6)), q = H.pt(ss, y, 0.005), r = 0.02 + 0.035 * hash2(i, 3); p.shade(null).ink(mul(BONE, 0.7 + 0.3 * hash2(i, 4)), 0.95).T(q[0], q[1], q[2], 0, 0, 0, r, r * 0.8, r).sphere(1, 5, 3); } });
    const n = Math.round(L / 0.2);
    for (const sg of [1, -1]) drape(Array.from({ length: n }, (_, i) => { const ss = lerp(0.04, 0.95, i / (n - 1)), q = H.pt(ss, lerp(H.yS, H.yGun(ss), 2.2 / st.nC), 0.03); return [q[0], q[1], sg * q[2]]; }), 0.4 * k, mul(weed, 0.8), { out: [0, 0, sg], rag: 0.9, seed: 20 + sg, bulge: 0.02, len: (t) => 0.3 + Math.abs(Math.sin(t * 23)) });
    for (const ss of [0.3, 0.6, 0.9]) for (const sg of [-1, 1]) { const q = railPt(ss, -0.03, st.capH + 0.26 * k); lamp([q[0], q[1], sg * q[2]], 0.2 * k); }
  }
  return fl;
}

// ---------- 2. paddle galleon ----------
function buildPaddleGalleon() {
  const k = sizeK(8), R = clamp(0.2 * B + 0.34 * k, 0.5, 1.5), sW = 0.5, plate = mix(hex(0x34363c), CH, 0.18);
  const s = style('galleon', (s, o, C, v) => {
    Object.assign(o, { draft: 0.66 * k, fb: 0.86 * k, sheerF: 0.24, sheerA: 0.22, tumble: 0.06, rakeF: 0.07 * L, stemE: 1.5, rakeA: 0.16, deckE: 0.56, midE: 0.76, tDeck: 0.72,
      segs: [{ s0: 0, s1: 0.25, lift: 0.82 * k, bul: 0.44 }, { s0: 0.25, s1: 0.84, lift: 0, bul: 0.5 }, { s0: 0.84, s1: 1, lift: 0.4 * k, bul: 0.4 }] });
    C.accent = BRASS; C.upper = CS2; C.top = hex(0x18161a); C.bottom = hex(0x3a2420); C.inner = mul(CH, 1.1); C.wale = hex(0x1c1c20);
    v.walesC = [1, 6]; v.portsC = [3, 5]; v.portRows = [2, 3]; v.spread = [0.15, 0.86];
  }, {
    mid: (s, o, C) => { s.stern = { tiers: [[0.14, 0.62 * k, 4]], arch: 0.2, lanterns: 1, lanternH: 0.36, quarterPieces: [0, 1.2 * k], pilaster: BRASS, badge: 0.95 * k };
      s.head = { type: 'scroll', len: 0.5 * k, tip: 0.44, scroll: 0.09, trail: 0.5, rails: 2, railY: 0.56, drop: 0.28, platform: true }; },
    rig: (R_) => { R_.masts = nm <= 0 ? [] : nm === 1 ? [{ s: 0.78, hf: 1, rake: 2, type: 'square', parts: 2, sq: 1 }] : nm === 2 ? [{ s: 0.8, hf: 0.92, rake: 2, type: 'square', parts: 2, sq: 1 }, { s: 0.2, hf: 0.9, rake: 4, type: 'gaff', parts: 2 }] : [{ s: 0.84, hf: 0.86, rake: 2, type: 'square', parts: 2, sq: 1 }, { s: 0.66, hf: 0.94, rake: 2, type: 'square', parts: 2, sq: 1 }, ...Array.from({ length: nm - 2 }, (_, i) => ({ s: 0.2 - 0.09 * i, hf: 0.88 - 0.1 * i, rake: 4, type: 'gaff', parts: 2 }))];
      R_.truck *= 0.86; if (R_.sprit) R_.sprit = { len: 0.17 * L, steeve: 18, jib: 0.1 * L }; R_.jibs = nm ? 1 : 0; R_.tops = 'flat'; },
    post: (s, o, C) => {
      s.rowC = (j) => (j >= 2 && j <= 6 ? { col: (kk) => mul(plate, 0.85 + 0.3 * hash2(j, kk)), proud: j === 6 || j === 2 ? 0.02 : 0.012, groove: 0.01, vary: 0.04 } : { col: () => C.hull, proud: 0 });
      s.plank = 1.1;
      portsClearOf(s, sW, (R * 1.22) / s.L); s.fitAs = 'none';
    } });
  const fl = launch(s), yw = R * 0.3, zw = H.z(sW, 0.3) + R * 0.2 + 0.02, w = clamp(0.34 * R + 0.1, 0.3, 0.7), xw = H.x(sW, 0.3);
  furnish({ hatches: [0.2, 0.84], capstan: 0.93, wheel: true });
  // iron belt: rivets top and bottom, brass round the ports
  const rowY = (j) => (ss) => lerp(H.yS, H.yGun(ss), j / st.nC);
  rivets(0.03, 0.97, (ss) => rowY(6.6)(ss), 0.15, hex(0x9a9ca4)); rivets(0.03, 0.97, (ss) => rowY(2.3)(ss), 0.15, hex(0x9a9ca4));
  portFrames(BRASS);
  bothSides(() => {
    paddleWheel(xw, yw, zw, R, w, { col: mul(OAK, 0.9) });
    paddleBox(xw, yw, zw, R, w, mul(CH, 0.85), { skirt: -R * 0.08 });
    // sponson beams from the hull to the outer bearing
    p.shade(K.grainX(0.12)).ink(mul(CH, 0.6), 0.85);
    for (const dx of [-R * 1.13, R * 1.13]) p.T(xw + dx, yw - R * 0.02, zw - w * 0.3).box(0.09, 0.11, w * 1.9, 0.01);
    p.shade(null);
  });
  // the engine: a tall funnel between the masts, smoke rolling off it
  const dq = deckPt(0.42), fh = clamp(1.5 + 0.2 * L, 1.6, 3.6), fr = clamp(0.03 * L, 0.12, 0.3);
  p.shade(null).ink(plate, 0.6, 0.6).T(dq[0], dq[1] + 0.14, 0).box(fr * 4.2, 0.28, fr * 3.6, 0.02);
  const mouth = funnel(dq[0], dq[1] + 0.26, 0, fh, fr, { band: BRASS });
  smoke(mouth, clamp(0.11 * L, 0.5, 1.2), 3);
  if (!far) for (const sg of [-1, 1]) funnel(dq[0] + fr * 3.4, dq[1], sg * fr * 1.5, fh * 0.36, fr * 0.3, { band: BRASS, rake: 0, bands: [0.9] });
  return fl;
}

// ---------- open boats and galleys ----------
const BOAT_SKIP = { fitOut: true, stern: true, head: true, sideWorks: true, rig: true };
/** an open boat on the skiff's loft (clinker, no deck, a floor a little above the water) */
function boatStyle(hull, more = {}) {
  return style('skiff', (s, o, C, v) => {
    Object.assign(o, hull);
    const fl = hull.floor ?? 0.06;
    o.segs = [{ s0: 0, s1: 1, lift: -(o.fb - fl), bul: o.fb - fl }];
    C.hull = CH; C.accent = mix(CH, WHITE, 0.5); C.inner = mul(CH, 0.9); C.rail = mul(CH, 0.75); C.wale = mul(CH, 0.5);
    if (more.pre) more.pre(s, o, C, v);
  }, more);
}
/** a decked galley on the brigantine's loft: flush deck with an optional poop: hull numbers plus segs */
function galleyStyle(hull, more = {}) {
  return style('brigantine', (s, o, C, v) => {
    Object.assign(o, hull);
    C.hull = CH; C.accent = mix(CH, WHITE, 0.35); C.upper = mul(CH, 0.7); C.top = mul(CH, 0.45); C.inner = mul(CH, 1.05); C.rail = mul(CH, 0.8); C.wale = mul(CH, 0.45); C.bottom = hex(0x2c231c);
    v.walesC = hull.wales || [2]; v.portRows = hull.portRows || [1, 2]; v.spread = hull.spread || [0.25, 0.75]; v.portsC = null;
    if (more.pre) more.pre(s, o, C, v);
  }, { ...more, mid: (s, o, C) => { s.stern = null; s.head = null; s.chW = 0; if (more.mid) more.mid(s, o, C); }, rig: (R) => { R.masts = []; R.sprit = null; R.jibs = 0; } });
}
const GALLEY_SKIP = { fitOut: true, sideWorks: true, rig: true };
/** thwarts across an open boat at stations */
function thwarts(list, up = 0.22, col = null) {
  p.shade(K.grainX(0.14)).ink(col || mul(mix(CH, DECK, 0.6), 1.05), 0.85);
  for (const s of list) { const g = H.seg(s), y = H.deckEdge(s, g) + up, zi = H.zIn(s, y); if (zi > 0.08) p.T(H.x(s, y), y, 0).box(clamp(0.03 * L, 0.1, 0.18), 0.03, 2 * zi + 0.01, 0.006); }
  p.shade(null);
}
/** ribs inside an open boat */
function ribs(n, col, r = 0.016) {
  if (far) return;
  bothSides(() => { p.shade(null).ink(col, 0.85); for (let i = 1; i < n; i++) { const s = i / n, g = H.seg(s), pts = []; for (let j = 0; j <= 3; j++) { const y = lerp(H.deckEdge(s, g) + 0.005, H.railY(s, g) - 0.01, j / 3); pts.push([H.x(s, y), y, H.zIn(s, y) - r * 0.6]); } p.tube(pts, r, 4); } });
}
/** a steering oar slung on the quarter (starboard), with its tiller */
function steeringOar(s, len, col, sg = 1) {
  const y = H.railY(s) + 0.02, a = H.pt(s, y, 0.05), top = [a[0] + len * 0.18, a[1] + len * 0.34, sg * (a[2] + 0.02)], bot = [a[0] - len * 0.22, -len * 0.42, sg * (a[2] + 0.1)];
  p.shade(K.grainX(0.12)).ink(col, 0.8).bar(top, bot, 0.024, 0.02, 6, 3);
  p.TM(frame(lerp3(top, bot, 0.82), sub3(bot, top), [1, 0, 0])).box(len * 0.34, clamp(len * 0.14, 0.1, 0.22), 0.02, 0.006);
  p.bar(top, [top[0] + len * 0.22, top[1] - 0.02, sg * (a[2] - 0.25)], 0.014, 0.012, 5, 3);
  p.shade(null).ink(HEMP, 0.95).T(a[0], a[1], sg * a[2]).sphere(0.04, 6, 4);
}
/** n stations evenly from a to b */
const spreadS = (n, a, b) => Array.from({ length: Math.max(1, n) }, (_, i) => (n <= 1 ? (a + b) / 2 : lerp(a, b, i / (n - 1))));
/** how many oars a side */
const oarCount = (dflt, ifAsked = dflt) => Math.max(0, Math.round(typeof def.oars === 'number' ? def.oars : def.oars === false ? 0 : def.oars === true ? Math.max(dflt, ifAsked) : dflt));   // def.oars: a number a side, true (yes), false (none)

// ---------- 12. longship ----------
function buildLongship() {
  const k = sizeK(6), fb = 0.4 * k;
  const s = boatStyle({ draft: 0.2 * k, fb, sheerF: 0.5 * k, sheerA: 0.46 * k, wlMid: 0.8, midK: 0.96, deckE: 0.74, wlE: 1.15, midE: 0.9, tWl: 0.02, tMid: 0.03, tDeck: 0.04, kMid: 2.4, rakeF: 0.1 * L, stemE: 1.5, rakeA: 0.5, aftTo: 0.22, floor: 0.07 },
    { pre: (s, o, C) => { s.plank = 12; C.accent = mul(CH, 0.6); }, post: (s) => { s.rowC = (j) => ({ col: () => (j === s.nC - 1 ? CS2 : j % 2 ? CH : mul(CH, 0.86)), proud: 0 }); } });
  launch(s, BOAT_SKIP);
  const dark = mul(CH, 0.6), x1 = H.x(1, H.railY(1)), y1 = H.railY(1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  // serpent at the stem, its tail curling over the stern
  figure(`serpent:${hx(dark)}:${hx(CT)}`, dragonFig({ col: hx(dark), hi: hx(CT), scales: true, eye: 0xffb030 }), x1 - 0.1 * k, y1 + 0.02, 0.92 * k);
  const tail = []; for (let i = 0; i <= 14; i++) { const t = i / 14, a = -0.6 + t * 4.6, r = 0.26 * k * (1 - 0.72 * t); tail.push([x0 - 0.1 * k + 0.02 - Math.sin(a) * r - 0.06 * k * t, y0 + 0.5 * k * Math.min(1, t * 2.4) + 0.2 * k - Math.cos(a) * r * (t > 0.2 ? 1 : t * 5), 0]); }
  carve([[x0 + 0.14, y0 - 0.2 * k, 0], [x0 + 0.02, y0 + 0.02, 0], ...tail], [0.07 * k, 0.07 * k, ...tail.map((q, i) => 0.065 * k * (1 - 0.8 * i / 14))], dark, { shade: K.mottle(0.25, 14) });
  thwarts(spreadS(Math.max(3, Math.round(L * 1.4)), 0.14, 0.86));
  ribs(Math.round(L * 2), mul(CH, 0.7));
  const nS = Math.max(4, Math.round(L * 2.1)), pal = [CS2, CT, CS, mul(CH, 0.5)];
  shields(nS, 0.14, 0.88, clamp(0.15 * k, 0.1, 0.19), (i) => pal[i % pal.length]);
  oars(oarCount(L * 1.5), 0.2, 0.8, { len: B * 1.25 + 0.4, y: (ss) => H.railY(ss) - 0.05, sweep: -0.25 });
  steeringOar(0.1, 1.5 * k, mul(SPAR, 0.9));
  for (let i = 0; i < nm; i++) {
    const sm = nm === 1 ? 0.5 : lerp(0.66, 0.34, i / (nm - 1)), hgt = clamp(0.5 * L + 0.4, 1.6, 5.2) * (i ? 0.84 : 1), M = mast(sm, hgt, 0.012 * L + 0.02);
    stays(M, { n: 2 });
    squareRig(M, { f: 0.9, w: clamp(1.15 * B + 0.7, 1.4, 4.6) * (i ? 0.84 : 1), clear: 0.62 * k, device: i === 0, seed: 2 + i, ...stripes(Math.max(5, Math.round(B * 3.4))) });
  }
  staff([x0 + 0.1, y0 + 0.02, 0.0], 0.9 * k + 0.2, 'ensign', 0.9, -0.5);
  extraMuzzles = railGuns(0.24, 0.76);
}

// ---------- 23. curragh ----------
function buildCurragh() {
  const k = sizeK(3.5), fb = 0.4 * k, hide = CH, rune = CT;
  const s = boatStyle({ draft: 0.16 * k, fb, sheerF: 0.34 * k, sheerA: 0.2 * k, wlMid: 0.82, midK: 1.0, deckE: 0.9, wlE: 1.3, midE: 1.0, tWl: 0.2, tMid: 0.42, tDeck: 0.5, kMid: 2.0, rakeF: 0.09 * L, stemE: 1.3, rakeA: 0.3, floor: 0.06 },
    { pre: (s, o, C) => { s.lap = 0; s.plank = 1.3; s.sw = 0.11; C.accent = mul(hide, 0.6); C.inner = mul(mix(hide, HIDE, 0.5), 1.15); C.stripe = mul(hide, 0.7); C.bottom = mul(hide, 0.5); C.rail = mix(hide, OAK, 0.6); },
      post: (s) => { s.rowC = (j) => ({ col: (kk) => mul(hide, 0.8 + 0.35 * hash2(j, kk)), proud: 0, groove: 0.004, vary: 0.12 }); } });
  launch(s, BOAT_SKIP);
  // wicker: withies bent inside the hide, and a gunwale bound with cord
  ribs(Math.round(L * 4), mul(BONE, 0.75), 0.011);
  if (!lite) bothSides(() => { for (const f of [0.35, 0.7]) { const pts = H.between(0.03, 0.97).map((ss) => { const y = lerp(H.deckEdge(ss), H.railY(ss), f); return [H.x(ss, y), y, H.zIn(ss, y) - 0.014]; }); p.shade(null).ink(mul(BONE, 0.65), 0.9).tube(pts, 0.01, 3); } });
  thwarts([0.3, 0.52, 0.74], 0.2 * k);
  // spiral runes painted down both sides, faintly alight
  const nR = Math.max(2, Math.round(L * 1.1));
  bothSides(() => { for (let i = 0; i < nR; i++) { const ss = lerp(0.2, 0.82, (i + 0.5) / nR), y = lerp(H.yS, H.railY(ss), 0.56), R = 0.3 * (H.railY(ss) - H.yS); p.push(H.frame(ss, y, 0.008)); p.push(X(0, 0, 0, 0, 0, i * 70, i % 2 ? -1 : 1, 1, 1)); const pts = [], n = far ? 8 : 16; for (let j = 0; j <= n; j++) { const t = j / n, a = t * 2.2 * TAU, rr = R * (1 - 0.86 * t); pts.push([Math.cos(a) * rr, Math.sin(a) * rr, 0]); } p.shade(null).ink(rune, 0.6, 0, 0.75).tube(pts, 0.011, 3); p.pop(); p.pop(); } });
  oars(oarCount(Math.max(2, Math.round(L * 0.8))), 0.34, 0.72, { len: B * 1.2 + 0.3, sweep: -0.22, r: 0.013 });
  if (nm > 0) { const M = mast(0.56, clamp(0.55 * L + 0.3, 1.4, 4.5), 0.01 * L + 0.016); stays(M, { n: 1 }); squareRig(M, { f: 0.9, w: clamp(1.1 * B + 0.4, 1.0, 4), clear: 0.5 * k, device: true, col: CS, seed: 3 });
    for (let i = 1; i < nm; i++) { const M2 = mast(0.56 - 0.2 * i, clamp(0.4 * L + 0.3, 1.2, 3.6), 0.01 * L + 0.014); squareRig(M2, { f: 0.9, w: clamp(0.9 * B + 0.3, 0.8, 3), clear: 0.5 * k, col: CS, seed: 3 + i }); } }
  else staff([H.x(0, H.railY(0)) + 0.08, H.railY(0), 0], 0.7, 'ensign', 0.8);
  // mist clinging to the water round her
  const mist = hex(0xa8c4cc);
  for (let i = 0; i < (far ? 2 : 5); i++) { const a = i * 1.9, x = (hash2(i, 3) - 0.5) * L * 0.9, sg = i % 2 ? 1 : -1; wisp([x - 0.3 * L, 0.04 + 0.03 * i, sg * (B * 0.55 + 0.1 * i)], [x + 0.3 * L, 0.1 + 0.05 * i, sg * (B * 0.66 + 0.1 * Math.sin(a))], 0.09 + 0.03 * i, 1.1 + 0.2 * i, mist, i * 2.1, 0.016, 0.35); }
  extraMuzzles = railGuns(0.36, 0.7, { len: 0.24 });
}

// ---------- 6. living skiff ----------
function buildLivingSkiff() {
  const k = sizeK(4.5), fb = 0.42 * k, bark = CH, moss = hex(0x4a6a2c), bloom = CS2;
  const s = boatStyle({ draft: 0.2 * k, fb, sheerF: 0.5 * k, sheerA: 0.4 * k, wlMid: 0.8, midK: 0.98, deckE: 0.8, wlE: 1.2, midE: 0.95, tWl: 0.03, tMid: 0.05, tDeck: 0.06, kMid: 2.2, rakeF: 0.1 * L, stemE: 1.4, rakeA: 0.45, aftTo: 0.24, floor: 0.07 },
    { pre: (s, o, C) => { s.lap = 0; s.plank = 5; C.accent = mix(bark, moss, 0.5); C.inner = mul(mix(bark, hex(0xb89a6a), 0.45), 1.05); C.stripe = mul(bark, 0.7); C.bottom = mul(bark, 0.5); C.rail = mix(bark, moss, 0.35); },
      post: (s) => { s.rowC = (j) => ({ col: (kk) => mix(mul(bark, 0.8 + 0.35 * hash2(j, kk)), moss, hash2(j + 9, kk) > 0.72 ? 0.5 : 0.05), proud: 0.004 * (j % 2), groove: 0.004, vary: 0.14 }); } });
  launch(s, BOAT_SKIP);
  const leafAt = (q, yaw, sz, col) => { p.shade(null).ink(col, 0.8, 0, 0.06).TM(X(q[0], q[1], q[2], 30 * Math.sin(yaw * 3), yaw / DEG, 20)).grid(2, 2, (i, j, out) => { const u = i / 2, v = j / 2; out[0] = (u - 0.5) * sz * (v === 0.5 ? 0.9 : 0.12) ; out[1] = 0.25 * sz * Math.sin(Math.PI * v) * (u === 0.5 ? 1 : 0.4); out[2] = (v - 0.5) * sz * 1.6; }); };
  const flower = (q, sz) => { p.shade(null).ink(bloom, 0.7, 0, 0.3); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; p.T(q[0] + Math.cos(a) * sz * 0.6, q[1], q[2] + Math.sin(a) * sz * 0.6, 0, 0, 0, sz * 0.5, sz * 0.22, sz * 0.5).sphere(1, 5, 3); } p.ink(hex(0xffd84a), 0.6, 0, 0.5).T(q[0], q[1] + sz * 0.12, q[2]).sphere(sz * 0.3, 5, 3); };
  // roots: the hull is grown, not built. Great roots clasp it from keel to gunwale and twist into the prow and the stern
  const nR = Math.max(4, Math.round(L * 1.3));
  bothSides(() => { for (let i = 0; i < nR; i++) { const sa = lerp(0.08, 0.86, i / (nR - 1)) + 0.02 * Math.sin(i * 5), pts = [], rad = [], n = 6; for (let j = 0; j <= n; j++) { const t = j / n, ss = clamp(sa + 0.07 * Math.sin(t * 2.6 + i) * t, 0.02, 0.985), y = lerp(-H.d * 0.7, H.railY(ss) + 0.05, t); pts.push(H.pt(ss, y, 0.012)); rad.push(clamp(0.012 * L, 0.035, 0.07) * (1 - 0.62 * t)); } carve(pts, rad, mul(bark, 0.72 + 0.2 * hash2(i, 2)), { sides: 5, shade: K.mottle(0.3, 18) }); } });
  const x1 = H.x(1, H.railY(1)), y1 = H.railY(1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  const curl = (x, y, dir, R, turns) => { const pts = [[x - dir * 0.12, y - 0.24 * k, 0], [x, y, 0]], rad = [0.085 * k, 0.08 * k], n = far ? 10 : 20; for (let i = 1; i <= n; i++) { const t = i / n, a = t * turns * TAU, r = R * (1 - 0.8 * t); pts.push([x + dir * (0.1 * k + R * 0.2 - Math.cos(a) * r + R * 0.8 * Math.min(1, t * 3) * 0), y + R * 1.25 * Math.min(1, t * 1.6) + Math.sin(a) * r * (t > 0.1 ? 1 : t * 10) * 0.9, 0]); rad.push(0.075 * k * (1 - 0.82 * t)); } carve(pts, rad, mul(bark, 0.8), { shade: K.mottle(0.3, 16) }); return pts; };
  const prow = curl(x1 - 0.03, y1, 1, 0.36 * k, 1.5), stern = curl(x0 + 0.04, y0, -1, 0.3 * k, 1.3);
  // leaves and blossom along the gunwales and in the curls
  if (!far) {
    const n = Math.round(L * (lite ? 2.2 : 5));
    for (let i = 0; i < n; i++) for (const sg of [1, -1]) { const ss = 0.05 + 0.9 * hash2(i, sg + 4), q = railPt(ss, 0.02, 0.03 + 0.05 * hash2(i, 7)); q[2] *= sg; if (hash2(i, sg + 12) > 0.8) flower(q, 0.05 * k + 0.02); else leafAt(q, hash2(i, 9) * 6.3, (0.12 + 0.1 * hash2(i, 5)) * k, mix(LEAF, CS, 0.3 + 0.5 * hash2(i, 6))); }
    for (const pts of [prow, stern]) for (let i = 4; i < pts.length; i += lite ? 4 : 2) { const q = pts[i]; if (i % 4 === 0) flower([q[0], q[1] + 0.05, q[2] + 0.05 * (i % 8 ? 1 : -1)], 0.06 * k); else leafAt([q[0], q[1] + 0.04, q[2]], i * 1.1, 0.18 * k, mix(LEAF, CS, 0.4)); }
  }
  thwarts([0.34, 0.6], 0.2 * k, mul(bark, 1.15));
  // one outrigger float, to port, on two bent boughs
  { const zf = -(B * 0.5 + clamp(0.5 * B, 0.5, 1.6)), fl = L * 0.52, pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([lerp(-fl / 2, fl / 2, t) + 0.04 * L, 0.02 + 0.14 * k * Math.pow(Math.abs(t * 2 - 1), 2.2), zf]); }
    carve(pts, pts.map((q, i) => 0.085 * k * (0.35 + 0.65 * Math.sin(Math.PI * (0.08 + 0.84 * i / 8)))), mul(bark, 0.85), { shade: K.mottle(0.3, 14) });
    for (const ss of [0.34, 0.66]) { const a = railPt(ss, 0, 0.02); a[2] = -a[2]; const b = [a[0], 0.1 * k, zf]; carve(curve([[a[0], a[1], 0.1], a, [a[0], a[1] + 0.2 * k, (a[2] + zf) / 2], b], 3), 0.034 * k + 0.008, mul(bark, 0.7), { sides: 5 }); }
    if (!far) for (let i = 1; i < 8; i += 2) leafAt([pts[i][0], pts[i][1] + 0.09 * k, zf], i, 0.16 * k, mix(LEAF, CS, 0.5)); }
  // sails: great leaves on living boughs; with none, the wind itself is harnessed
  const spirit = hex(0xbff0e0);
  for (let i = 0; i < nm; i++) {
    const sm = nm === 1 ? 0.56 : lerp(0.7, 0.3, i / (nm - 1)), b = deckPt(sm), hgt = clamp(0.62 * L + 0.4, 1.6, 5.4) * (i ? 0.8 : 1), lean = 0.12 * hgt;
    const bough = curve([[b[0], b[1] - 0.05, 0], [b[0] + lean * 0.4, b[1] + hgt * 0.35, 0], [b[0] + lean * 0.3, b[1] + hgt * 0.7, 0], [b[0] - lean * 0.5, b[1] + hgt, 0]], 4);
    carve(bough, bough.map((q, j) => (0.011 * L + 0.02) * (1 - 0.7 * j / (bough.length - 1))), mul(bark, 0.8));
    const top = bough[bough.length - 1], w = clamp(0.5 * B + 0.5, 0.7, 2.4) * (i ? 0.85 : 1), h = hgt * 0.84, base = [b[0] - 0.02, b[1] + hgt * 0.12, -0.05];
    // the blade: v from the tip (top) to the stalk, u across; a midrib and veins
    const P = (u, v) => { const wv = w * Math.pow(Math.sin(Math.PI * clamp(0.04 + 0.92 * v, 0, 1)), 0.75) * (0.55 + 0.45 * v), a = lerp3(top, base, v), x = (u - 0.5) * wv; return [a[0] - x * 0.98 - 0.12 * h * Math.sin(Math.PI * v), a[1] + Math.abs(u - 0.5) * 0.12 * wv, a[2] - x * 0.2 - 0.16 * w * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)]; };
    cloth(P, { us: [0, 0.5, 1], colOf: (a) => mul(CS, a ? 1 : 0.86), cell: 0.2, seed: 7 + i, ro: 0.75, glow: 0.1, fine: i === 0 && !!emblem });
    const sl = { P, N: [0.2, 0, -1], on: onCloth(P, [0.2, 0, -1], 0.5, 0.55), size: Math.min(w, h) * 0.8 };
    if (i === 0) device(sl, 0.26);
    p.shade(null).ink(mul(CS, 0.6), 0.8).tube(Array.from({ length: 7 }, (_, j) => { const q = P(0.5, j / 6); return [q[0], q[1], q[2] - 0.012]; }), 0.016, 4);
    if (!lite) for (let j = 1; j < 6; j++) for (const e of [0.04, 0.96]) p.tube([P(0.5, j / 6 + 0.06), P(lerp(0.5, e, 0.5), j / 6 + 0.01), P(e, j / 6 - 0.05)].map((q) => [q[0], q[1], q[2] - 0.008]), 0.007, 3);
    addFlag('pennant', [top[0], top[1] + 0.02, 0], 0.7);
  }
  const nW = nm ? 2 : far ? 3 : 5;
  for (let i = 0; i < nW; i++) { const c = deckPt(lerp(0.3, 0.7, nW === 1 ? 0.5 : i / (nW - 1))), hh = (nm ? 0.5 : 1) * clamp(0.5 * L, 1.4, 4) * (0.6 + 0.4 * hash2(i, 4)); wisp([c[0] - 0.5, c[1] + 0.3, (i % 2 ? 0.2 : -0.2)], [c[0] + 0.5 + 0.2 * i, c[1] + 0.3 + hh, (i % 2 ? -0.3 : 0.3)], 0.4 * B * (nm ? 0.5 : 1), 2.2 + 0.4 * i, spirit, i * 1.7, nm ? 0.016 : 0.024, 0.5); }
  if (!nm) { blob([deckPt(0.5)[0], deckPt(0.5)[1] + clamp(0.3 * L, 1, 2.6), 0], 0.16 * k, 0.2 * k, 0.16 * k, 5, spirit, { glow: 1.1, amp: 0.25, colOf: () => spirit }); staff([x0 + 0.2, y0 + 0.3 * k, 0], 0.7, 'ensign', 0.8); }
  extraMuzzles = railGuns(0.3, 0.7, { len: 0.26 });
}

// ---------- 16. solar barque ----------
function buildSolarBarque() {
  const k = sizeK(7), fb = 0.4 * k, reed = CH, bind = mul(CH, 0.5);
  const s = boatStyle({ draft: 0.18 * k, fb, sheerF: 0.75 * k, sheerA: 0.7 * k, wlMid: 0.78, midK: 0.98, deckE: 0.82, wlE: 1.25, midE: 0.95, tWl: 0.02, tMid: 0.03, tDeck: 0.04, kMid: 2.0, rakeF: 0.13 * L, stemE: 1.2, rakeA: 0.6, aftTo: 0.26, floor: fb - 0.12 },
    { pre: (s, o, C) => { s.lap = 0; s.plank = 14; s.sw = 0.06; C.accent = CT; C.inner = mul(reed, 0.95); C.stripe = mul(reed, 0.8); C.bottom = mul(reed, 0.6); C.rail = mix(reed, OAK, 0.4); C.deck = mix(hex(0xa07a4a), reed, 0.3); },
      post: (s) => { s.rowC = (j) => ({ col: () => mul(reed, j % 2 ? 1.06 : 0.9), proud: 0.004, groove: 0.006, vary: 0.05 }); } });
  launch(s, BOAT_SKIP);
  // bindings round the reed bundles, gilded at the ends
  straps(spreadS(Math.round(L * 1.2), 0.1, 0.9), () => H.yP, (ss) => H.railY(ss) + 0.01, 0.045, bind, [0.9, 0]);
  straps([0.045, 0.07, 0.93, 0.955], () => H.yP + 0.05, (ss) => H.railY(ss) + 0.01, 0.07, CT, CTp);
  // the high ends: stem and stern rise, curl inboard and open into lotus flowers
  const lotus = (m, r) => { p.push(m); trimInk(); p.lathe([[r * 0.3, 0], [r * 0.5, r * 0.5], [r * 1.0, r * 1.5], [r * 1.25, r * 2.1], [r * 1.05, r * 2.1], [r * 0.7, r * 1.4], [0, r * 0.9]], far ? 6 : 10); p.ink(mix(CT, hex(0x3a8a6a), 0.6), 0.5, 0.3); if (!far) for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; p.T(Math.cos(a) * r * 0.9, r * 1.2, Math.sin(a) * r * 0.9, 0, -a / DEG, -24).lathe([[r * 0.24, 0], [r * 0.3, r * 0.7], [0, r * 1.5]], 4); } p.pop(); };
  const end = (x, y, dir, hgt, back) => { const ctl = [[x - dir * 0.3 * k, y - 0.34 * k, 0], [x, y - 0.02, 0], [x + dir * 0.16 * k, y + hgt * 0.45, 0], [x + dir * 0.1 * k, y + hgt * 0.85, 0], [x - dir * back * 0.4, y + hgt * 1.05, 0], [x - dir * back, y + hgt * 0.86, 0]], pts = curve(ctl, far ? 2 : 4);
    carve(pts, pts.map((q, i) => 0.085 * k * (1 - 0.45 * i / (pts.length - 1))), CT, { ro: CTp[0], me: CTp[1], shade: null });
    const a = pts[pts.length - 2], b = pts[pts.length - 1]; lotus(frame(b, cross([0, 0, 1], norm3(sub3(b, a))), sub3(b, a)), 0.07 * k); };
  const x1 = H.x(1, H.railY(1)), y1 = H.railY(1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  end(x1, y1, 1, 0.75 * k, 0.3 * k); end(x0, y0, -1, 1.0 * k, 0.45 * k);
  // the shrine: a gilded canopy over a small chest, abaft the mast
  const aw = awning(0.26, 0.44, 0.7, 0.62 * k, CS, CS2, { post: CT, crown: 0.07, n: 6 });
  { const q = deckPt(0.35); p.shade(null).ink(mul(CT, 0.9), CTp[0], CTp[1]).T(q[0], q[1] + 0.13 * k, 0).box(0.42 * k, 0.26 * k, Math.min(0.5 * k, aw.z * 1.2), 0.012); p.T(q[0], q[1] + 0.28 * k, 0).box(0.5 * k, 0.04, Math.min(0.58 * k, aw.z * 1.4), 0.01); p.ink(hex(0x2a5a8a), 0.5, 0.2).T(q[0], q[1] + 0.13 * k, 0).box(0.43 * k, 0.1 * k, Math.min(0.5 * k, aw.z * 1.2) * 0.7, 0.004); }
  // the sun: a gilt disc carried on a stand at the bow
  { const q = deckPt(0.82); trimInk().bar(q, [q[0], q[1] + 0.34 * k, 0], 0.02, 0.016, 5, 0); p.ink(hex(0xffc24a), 0.3, 0.6, 0.6).T(q[0], q[1] + 0.52 * k, 0, 0, 0, 90).lathe([[0, -0.012], [0.2 * k, -0.012], [0.2 * k, 0.012], [0, 0.012]], far ? 8 : 16); }
  for (const sg of [1, -1]) steeringOar(0.085, 1.5 * k, mul(SPAR, 0.95), sg);
  oars(oarCount(0, L * 0.9), 0.46, 0.8, { len: B * 1.3 + 0.3, sweep: -0.22 });
  for (let i = 0; i < nm; i++) {
    const sm = nm === 1 ? 0.6 : lerp(0.7, 0.5, i / (nm - 1)), hgt = clamp(0.5 * L, 1.6, 5) * (i ? 0.8 : 1), M = mast(sm, hgt, 0.011 * L + 0.018), w = clamp(1.5 * B + 0.5, 1.4, 5) * (i ? 0.8 : 1);
    stays(M, { n: 1, f: 0.95 });
    // a wide, shallow sail between two yards
    const drop = hgt * 0.5, sl = squareRig(M, { f: 0.93, w, drop, bellyK: 0.5, footK: 0.9, roach: 0, device: i === 0, devR: 0.36, col: CS, seed: 4 + i, vs: [0, 0.08, 0.92, 1], colOf: (a, b) => (b === 1 ? CS : mix(CS, CT, 0.7)), glow: 0.2, rag: 0 });
    const f0 = sl.clews[0], f1 = sl.clews[1]; p.shade(K.grainX(0.12)).ink(SPAR, 0.72).bar(lerp3(f0, f1, -0.04), lerp3(f0, f1, 1.04), 0.02, 0.02, 6, 3); p.shade(null);
  }
  if (!nm) staff([x0 + 0.5 * k, deckPt(0.12)[1], 0], 0.9, 'ensign', 0.8);
  extraMuzzles = railGuns(0.5, 0.74, { len: 0.3 });
}

/** a blade standing in the centre plane: outline [[x, y], ...], thick; a bright wire along the edge points */
function bladePlate(outline, thick, col, edge = null, pbr = [0.4, 0.85]) {
  p.shade(K.mottle(0.25, 12)).ink(col, ...pbr).extrude(outline, thick, false);
  if (edge) p.shade(null).ink(edge.col, 0.25, 0.9).tube(edge.pts.map((q) => [q[0], q[1], 0]), thick * 0.62, 4, 1);
  p.shade(null);
}
/** a box section lofted through stations [{ x, y0, y1, hw }] along X (a jaw, a spur, a beam), closed at the far end */
function loftBox(secs, col, pbr = [0.8, 0], shade = null) {
  const n = secs.length - 1, f = (yk, zk) => (i, j, out) => { const q = secs[i]; out[0] = q.x; out[1] = yk === null ? (j ? q.y1 : q.y0) : q[yk]; out[2] = zk === null ? (j ? q.hw : -q.hw) : zk * q.hw; };
  p.shade(shade).ink(col, ...pbr);
  p.grid(n, 1, f('y1', null), null, true); p.grid(n, 1, f('y0', null)); p.grid(n, 1, f(null, 1)); p.grid(n, 1, f(null, -1), null, true);
  const e = secs[n]; p.poly([[e.x, e.y0, -e.hw], [e.x, e.y0, e.hw], [e.x, e.y1, e.hw], [e.x, e.y1, -e.hw]]);
  p.shade(null);
}
/** tail feathers fanned high over the stern */
function tailFan(x0, y0, k, cA, cB, pbr = [0.8, 0]) {
  const n = far ? 3 : 7;
  for (let i = 0; i < n; i++) { const a = (i - (n - 1) / 2) / ((n - 1) / 2), h = (1.25 - 0.3 * a * a) * k, pts = curve([[x0 + 0.2, y0 - 0.1, a * 0.1 * k], [x0 - 0.16 * k, y0 + h * 0.5, a * 0.28 * k], [x0 - 0.5 * k, y0 + h, a * 0.6 * k]], 3);
    p.shade(null).ink(i % 2 ? cA : cB, ...pbr); p.grid(pts.length - 1, 1, (ii, j, out) => { const q = pts[ii], w = 0.11 * k * Math.sin(Math.PI * (0.12 + 0.8 * ii / (pts.length - 1))); out[0] = q[0]; out[1] = q[1]; out[2] = q[2] + (j ? w : -w); });
    p.ink(cA, ...pbr).tube(pts, 0.012 * k, 3); }
}
/** rowing benches either side of a gangway down a galley's deck */
function benches(n, s0, s1, col) {
  if (far) return;
  p.shade(K.grainX(0.12)).ink(col, 0.85);
  for (let i = 0; i < n; i++) { const s = lerp(s0, s1, n === 1 ? 0.5 : i / (n - 1)), q = deckPt(s, 0), zi = H.zIn(s, q[1] + 0.05); if (zi < 0.3) continue; for (const sg of [-1, 1]) p.T(q[0], q[1] + 0.09, sg * (zi * 0.58)).box(0.1, 0.03, zi * 0.66, 0.005); }
  const a = deckPt(s0, 0), b = deckPt(s1, 0);
  p.ink(mul(col, 0.8), 0.85).TM(frame(lerp3(a, b, 0.5), sub3(b, a), [0, 1, 0])).T2(0, 0.06, 0).box(dist3(a, b) + 0.2, 0.12, 0.2, 0.01);
  p.shade(null);
}

// ---------- 19. war galley ----------
function buildWarGalley() {
  const k = sizeK(8);
  const s = galleyStyle({ draft: 0.3 * k, fb: 0.44 * k, sheerF: 0.2 * k, sheerA: 0.42 * k, tumble: 0, wlMid: 0.86, deckE: 0.74, wlE: 1.35, midE: 0.9, tWl: 0.1, tMid: 0.34, tDeck: 0.46, rakeF: 0.03 * L, stemE: 1.0, rakeA: 0.5, aftTo: 0.22,
    segs: [{ s0: 0, s1: 0.17, lift: 0.34 * k, bul: 0.3 }, { s0: 0.17, s1: 1, lift: 0, bul: 0.3 }], portRows: [1, 2], spread: [0.72, 0.94], wales: [3] },
  { pre: (s, o, C) => { C.accent = CS2; C.top = CT; }, post: (s) => { s.rowD = (j, g, last) => ({ col: () => (last ? mul(CH, 0.45) : j % 2 ? CS2 : mix(CS, WHITE, 0.2)), proud: last ? 0.006 : 0, vary: 0.05 }); } });
  launch(s, GALLEY_SKIP);
  const d = H.d, x1 = H.x(1, 0), y1 = H.railY(1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0), rl = clamp(0.1 * L, 0.5, 1.2);
  // the ram: a three-finned bronze spur at the waterline
  bladePlate([[x1 - 0.4, -d * 0.95], [x1 + rl * 0.5, -d * 0.4], [x1 + rl, -0.05], [x1 + rl, 0.07], [x1 + rl * 0.5, 0.14], [x1 + 0.04, 0.3], [x1 - 0.3, 0.3]], 0.13 * k, CT, null, CTp);
  trimInk(); for (const y of [-0.09, 0.01, 0.11]) p.T(x1 + rl * 0.74, y, 0).box(rl * 0.55, 0.035, 0.2 * k, 0.008);
  // a lion roars over it
  figure(`lion:${hx(CT)}`, lionFig({ col: hx(CT), ro: CTp[0], me: CTp[1] }), H.x(1, y1) + 0.1 * k, y1 + 0.02, 0.8 * k, { pitch: -12 });
  // the stern sweeps up and fans forward over the helmsman
  for (let i = 0; i < (far ? 3 : 5); i++) { const a = (i - 2) * 0.24, pts = curve([[x0 + 0.1, y0 - 0.15, 0], [x0 - 0.12 * k, y0 + 0.5 * k, a * 0.2], [x0 + 0.1 * k, y0 + 1.15 * k, a * 0.9 * k], [x0 + (0.62 - 0.12 * Math.abs(i - 2)) * k, y0 + (1.3 - 0.1 * Math.abs(i - 2)) * k, a * 1.5 * k]], 3); carve(pts, pts.map((q, j) => 0.05 * k * (1 - 0.6 * j / (pts.length - 1))), i === 2 ? CT : CH, i === 2 ? { ro: CTp[0], me: CTp[1], shade: null, sides: 5 } : { sides: 5 }); }
  { const q = [x0 + 0.02, y0 + 0.28 * k, 0]; p.push(X(q[0] - 0.12, q[1], 0)); K.lantern(p, 0.3 * k); p.pop(); }
  awning(0.025, 0.15, 0.82, 0.56 * k, CS2, mix(CS, WHITE, 0.3), { post: CT });
  benches(Math.round(L * 1.6), 0.22, 0.84, mul(mix(CH, DECK, 0.6), 0.9));
  // the outrigger beam the oars work on
  bothSides(() => { const cols = H.between(0.2, 0.86); p.shade(K.grainX(0.12)).ink(mul(CH, 0.5), 0.85); K.sweepHard(p, H, cols, (ss) => H.railY(ss) - 0.1, [[0.1, -0.03], [0.1, 0.03], [0, 0.03], [0, -0.03]]); p.shade(null); });
  oars(oarCount(L * 2.5), 0.22, 0.84, { len: B * 1.35 + 0.5, y: (ss) => H.railY(ss) - 0.1, out: 0.1, sweep: -0.22 });
  const pos = [[0.66], [0.7, 0.36], [0.74, 0.46, 0.25]][clamp(nm, 1, 3) - 1];
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const hgt = clamp(0.46 * L + 0.3, 1.5, 5) * [1, 0.86, 0.7][i], M = mast(pos[i], hgt, 0.011 * L + 0.02, { rake: -4 });
    stays(M, { n: 2, fore: i === 0 });
    lateenRig(M, { lenY: hgt * 1.3, slope: 46, device: i === 0, seed: 3 + i, ...stripes(Math.max(5, Math.round(hgt * 2.2))) });
  }
  if (!nm) staff([x0 + 0.5, deckPt(0.1)[1], 0], 1.0, 'ensign', 0.9);
}

// ---------- 4. razor galley ----------
function buildRazorGalley() {
  const k = sizeK(7), steel = hex(0x2c2e36), edgeC = hex(0xc8ccd6);
  const s = galleyStyle({ draft: 0.28 * k, fb: 0.4 * k, sheerF: 0.42 * k, sheerA: 0.3 * k, tumble: 0, wlMid: 0.84, deckE: 0.92, wlE: 1.7, midE: 1.05, tWl: 0.08, tMid: 0.26, tDeck: 0.36, rakeF: 0.17 * L, stemE: 0.75, rakeA: 0.5, aftTo: 0.2,
    segs: [{ s0: 0, s1: 0.15, lift: 0.3 * k, bul: 0.28 }, { s0: 0.15, s1: 1, lift: 0, bul: 0.28 }], portRows: [1, 2], spread: [0.3, 0.8], wales: [3] },
  { pre: (s, o, C) => { C.accent = CS; C.deck = mix(DECK, CH, 0.55); C.bottom = hex(0x141216); C.stripe = mul(CS, 0.7); },
    post: (s) => { s.rowD = (j, g, last) => ({ col: () => (last ? mul(CS, 0.6) : CH), proud: last ? 0.006 : 0, vary: 0.08 }); } });
  launch(s, GALLEY_SKIP);
  const d = H.d, xw = H.x(1, 0), y1 = H.railY(1), xt = H.x(1, y1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0), rl = clamp(0.12 * L, 0.6, 1.4);
  // the prow: one great knife from keel to crest, hooked at the waterline, saw-backed above
  const lead = [[xw + rl * 0.1, -d * 0.9], [xw + rl * 0.7, -d * 0.35], [xw + rl, 0.04], [xw + rl * 0.62, 0.3 * k], [xt + rl * 0.42, y1 + 0.2 * k], [xt + rl * 0.34, y1 + 0.75 * k], [xt + rl * 0.1, y1 + 1.2 * k]];
  const back = []; for (let i = 0; i < 5; i++) { const t = i / 5; back.push([xt - 0.08 - 0.05 * i, y1 + lerp(1.02, 0.1, t) * k], [xt - 0.2 - 0.03 * i, y1 + lerp(1.0, 0.1, t + 0.1) * k]); }
  bladePlate([[xw - 0.4, -d * 0.95], ...lead, ...back, [xt - 0.1, y1 - 0.2], [xw - 0.2, 0]], 0.07 * k, steel, { col: edgeC, pts: lead });
  // stern: a barbed sting curling forward
  { const pts = curve([[x0 + 0.14, y0 - 0.16, 0], [x0 - 0.2 * k, y0 + 0.45 * k, 0], [x0 - 0.05 * k, y0 + 1.0 * k, 0], [x0 + 0.42 * k, y0 + 1.18 * k, 0], [x0 + 0.7 * k, y0 + 0.88 * k, 0]], 4); carve(pts, pts.map((q, j) => 0.06 * k * (1 - 0.55 * j / (pts.length - 1))), steel, { ro: 0.4, me: 0.8, sides: 6 }); const a = pts[pts.length - 2], b = pts[pts.length - 1]; spike(frame(b, cross([0, 0, 1], norm3(sub3(b, a))), sub3(b, a)), 0.34 * k, 0.05 * k, edgeC); }
  // spikes along the rails with chains swagged between them
  const nSp = Math.max(4, Math.round(L * 1.2));
  spikeRow(nSp, 0.12, 0.9, (ss) => H.railY(ss) + 0.01, 0.2 * k, 0.03 * k, steel, 50);
  bothSides(() => { for (let i = 0; i < nSp - 1; i += 2) { const sa = lerp(0.12, 0.9, i / (nSp - 1)), sb = lerp(0.12, 0.9, (i + 1) / (nSp - 1)); chain(railPt(sa, 0.05, -0.02), railPt(sb, 0.05, -0.02), 0.13 * k, 0.014); } });
  benches(Math.round(L * 1.5), 0.2, 0.84, mul(mix(CH, DECK, 0.4), 0.9));
  // two banks of oars
  const nO = oarCount(L * 2.2), blade = mul(CS, 0.8);
  oars(Math.ceil(nO / 2), 0.2, 0.82, { len: B * 1.6 + 0.6, y: (ss) => H.railY(ss) - 0.04, sweep: -0.28, blade, col: hex(0x3a3028) });
  oars(Math.floor(nO / 2), 0.23, 0.85, { len: B * 1.25 + 0.45, y: (ss) => H.railY(ss) - 0.2, sweep: -0.28, blade, col: hex(0x3a3028) });
  const pos = [[0.58], [0.66, 0.32], [0.72, 0.46, 0.24]][clamp(nm, 1, 3) - 1];
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const hgt = clamp(0.5 * L + 0.3, 1.5, 5.2) * [1, 0.82, 0.68][i], M = mast(pos[i], hgt, 0.011 * L + 0.02, { rake: 6, col: hex(0x2a2420), hoop: steel });
    stays(M, { n: 2, fore: i === 0 });
    lateenRig(M, { lenY: hgt * 1.36, slope: 54, device: i === 0, seed: 5 + i, col: CS, rag: 0.34, ragN: 6, vs: [0, 1], yardCol: hex(0x2a2420) });
  }
  if (!nm) staff([x0 + 0.5, deckPt(0.08)[1], 0], 1.0, 'ensign', 0.9);
  { const q = deckPt(0.08); brazier(X(q[0], q[1], 0), 0.34 * k, hex(0xff3a1e)); }
}

// ---------- 11. dread galley ----------
function buildDreadGalley() {
  const k = sizeK(8.5), iron = mix(hex(0x30303a), CH, 0.5), bone = BONE;
  const s = galleyStyle({ draft: 0.5 * k, fb: 0.6 * k, sheerF: 0.3 * k, sheerA: 0.3 * k, tumble: 0.03, wlMid: 0.9, deckE: 0.62, wlE: 1.2, midE: 0.82, tWl: 0.3, tMid: 0.66, tDeck: 0.72, rakeF: 0.05 * L, stemE: 1.2, rakeA: 0.2,
    segs: [{ s0: 0, s1: 0.2, lift: 0.62 * k, bul: 0.4 }, { s0: 0.2, s1: 0.84, lift: 0, bul: 0.45 }, { s0: 0.84, s1: 1, lift: 0.34 * k, bul: 0.38 }], portRows: [2, 3], spread: [0.26, 0.8], wales: [1, 5] },
  { pre: (s, o, C) => { s.plank = 1.0; C.hull = iron; C.accent = mul(CS2, 0.8); C.upper = mul(iron, 0.8); C.top = hex(0x0e0e10); C.inner = mul(iron, 1.3); C.deck = mix(DECK, iron, 0.6); C.rail = hex(0x121214); C.wale = hex(0x0c0c0e); C.bottom = hex(0x101012); C.stripe = hex(0x5a1a14); C.transom = iron; },
    post: (s) => { s.rowC = (j) => ({ col: (kk) => mul(iron, 0.8 + 0.4 * hash2(j, kk)), proud: j === 1 || j === 5 ? 0.02 : 0.006, groove: 0.009, vary: 0.05, ro: 0.5 }); s.rowD = (j, g, last) => ({ col: (kk) => (last ? hex(0x0e0e10) : mul(iron, 0.75 + 0.4 * hash2(j + 20, kk))), proud: last ? 0.008 : 0.004, groove: 0.009, vary: 0.05 }); } });
  const from = p.n; launch(s, GALLEY_SKIP);
  for (let i = from; i < p.n; i++) if (p.C[i * 3] < 0.05 && p.C[i * 3 + 1] < 0.05 && p.M[i * 3 + 1] === 0) { p.M[i * 3] = 0.55; p.M[i * 3 + 1] = 0.6; }   // black iron, not black paint
  const d = H.d, xw = H.x(1, 0), yg = H.yGun(1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0), jl = clamp(0.14 * L, 0.6, 1.6), jw = clamp(0.3 * B, 0.3, 1.1);
  // the ram: iron jaws agape, fanged in bone, a furnace glow in the gullet
  const jx = (t) => xw - 0.35 + t * (jl + 0.35), jh = (t) => (jw / 2) * (1 - 0.62 * Math.pow(t, 1.5)), nJ = far ? 4 : 8, black = hex(0x1c1c22);
  const upY = (t) => [yg + k * (0.04 + 0.07 * Math.sin(Math.PI * t) - 0.05 * t), yg + k * (0.56 + 0.12 * Math.sin(Math.PI * t) - 0.5 * t * t)];
  const loY = (t) => [-d * 0.9 * Math.pow(1 - t, 0.7) - 0.03, k * (0.27 - 0.1 * t) - 0.05 * Math.sin(Math.PI * t) * k];
  for (const yy of [upY, loY]) loftBox(Array.from({ length: nJ + 1 }, (_, i) => { const t = i / nJ, y = yy(t); return { x: jx(t), y0: y[0], y1: y[1], hw: jh(t) }; }), black, [0.5, 0.75], K.mottle(0.3, 10));
  p.shade(null).ink(hex(0xff4a1a), 0.6, 0, 1.5).T(xw + 0.05, (upY(0.1)[0] + loY(0.1)[1]) / 2, 0).box(0.3, Math.max(0.05, upY(0.1)[0] - loY(0.1)[1]), jw * 0.7);
  const nT = far ? 3 : 6;
  for (let i = 0; i < nT; i++) for (const sg of [-1, 1]) { const t = lerp(0.3, 0.96, i / (nT - 1)), big = i === nT - 1 ? 1.6 : 1 + 0.25 * (i % 2);
    p.shade(null).ink(bone, 0.5).T(jx(t), upY(t)[0] + 0.01, sg * jh(t) * 0.82, 180, 0, 0).lathe([[0.045 * k * big, 0], [0.03 * k * big, 0.1 * k * big], [0, 0.25 * k * big]], 5);
    p.T(jx(t) - jl * 0.06, loY(t)[1] - 0.01, sg * jh(t) * 0.82).lathe([[0.04 * k * big, 0], [0.026 * k * big, 0.09 * k * big], [0, 0.21 * k * big]], 5); }
  for (const sg of [-1, 1]) { p.ink(hex(0xff5a1e), 0.4, 0, 1.6).T(jx(0.45), upY(0.45)[1] - 0.14 * k, sg * (jh(0.45) + 0.004), 0, 0, -18, 1.8, 1, 0.4).sphere(0.055 * k, 7, 4); spike(X(jx(0.3), upY(0.3)[1] - 0.02, sg * jh(0.3) * 0.6, 0, 0, 34), 0.34 * k, 0.055 * k, black); }
  // rivets, spikes, braziers
  rivets(0.04, 0.96, (ss) => lerp(H.yS, H.yGun(ss), 5.5 / st.nC), 0.17, hex(0x6a6a70)); rivets(0.04, 0.96, (ss) => lerp(H.yS, H.yGun(ss), 1.5 / st.nC), 0.17, hex(0x6a6a70));
  spikeRow(Math.max(5, Math.round(L * 1.3)), 0.04, 0.82, (ss) => H.railY(ss) + 0.02, 0.22 * k, 0.034 * k, hex(0x18181c), 35);
  spikeRow(Math.max(3, Math.round(L * 0.6)), 0.1, 0.9, (ss) => lerp(H.yS, H.yGun(ss), 0.5), 0.2 * k, 0.04 * k, hex(0x18181c), 0);
  for (const [ss, zf] of [[0.06, 0.6], [0.06, -0.6], [0.3, 0.7], [0.3, -0.7], [0.78, 0.66], [0.78, -0.66], [0.93, 0]].slice(0, far ? 4 : 7)) brazier(onDeck(ss, zf), 0.4 * k);
  { const q = deckPt(0.5); p.push(X(q[0], q[1], 0)); K.hatch(p, 0.4, clamp(B * 0.25, 0.3, 0.8), hex(0x18181c)); p.pop(); }
  oars(oarCount(L * 1.3), 0.26, 0.8, { len: B * 1.1 + 0.5, y: (ss) => lerp(H.yS, H.yGun(ss), 0.72), sweep: -0.24, r: 0.02, col: hex(0x2a2420), blade: hex(0x3a2a22) });
  // tattered sails, stitched from whatever would hold a seam
  const pos = [[0.52], [0.66, 0.32], [0.74, 0.5, 0.26]][clamp(nm, 1, 3) - 1];
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const hgt = clamp(0.5 * L + 0.4, 1.6, 5.6) * (nm === 3 ? [0.84, 1, 0.74][i] : [1, 0.8][i]), M = mast(pos[i], hgt, 0.012 * L + 0.022, { col: hex(0x241e1a), hoop: hex(0x5a5a60) });
    stays(M, { n: 3, fore: i === 0 });
    const us = [0, 0.22, 0.47, 0.7, 1], vs = [0, 0.3, 0.62, 1], w = clamp(1.2 * B + 0.5, 1.4, 4.6) * (hgt / (0.5 * L + 0.4)) ** 0.5;
    const sl = squareRig(M, { f: 0.9, w, clear: 0.62 * k, device: nm === 3 ? i === 1 : i === 0, devR: 0.24, seed: 6 + i, us, vs, rag: 0.5, ragN: 8, glow: 0.03, yardCol: hex(0x241e1a), colOf: (a, b) => { const h = hash2(a * 5 + i, b * 3 + 1); return h > 0.7 ? mix(CS, HIDE, 0.5) : h < 0.25 ? mul(CS, 0.6) : CS; } });
    if (!lite) { p.shade(null).ink(mul(bone, 0.8), 0.9); for (const u of us.slice(1, -1)) for (let j = 0; j < 9; j++) { const a = sl.P(u - 0.02, 0.08 + j * 0.08), b = sl.P(u + 0.02, 0.1 + j * 0.08); p.bar([a[0] + 0.01, a[1], a[2]], [b[0] + 0.01, b[1], b[2]], 0.006, 0.006, 3, 0); } }
  }
  staff([x0 + 0.1, y0, 0], 1.1 * k, 'ensign', 1, -0.25);
}

// ---------- 21. dhow ----------
function buildDhow() {
  const k = sizeK(6.5);
  const s = galleyStyle({ draft: 0.4 * k, fb: 0.55 * k, sheerF: 0.34 * k, sheerA: 0.5 * k, tumble: 0.02, wlMid: 0.86, deckE: 0.78, wlE: 1.45, midE: 0.92, tWl: 0.3, tMid: 0.72, tDeck: 0.8, rakeF: 0.24 * L, stemE: 0.95, rakeA: 0.26, fwdFrom: 0.5,
    segs: [{ s0: 0, s1: 0.3, lift: 0.56 * k, bul: 0.36 }, { s0: 0.3, s1: 1, lift: 0, bul: 0.4 }], portRows: [2, 3], spread: [0.36, 0.76], wales: [3, 4] },
  { pre: (s, o, C) => { C.accent = CT; C.upper = CS2; C.top = mul(CH, 0.4); },
    mid: (s, o, C) => { s.stern = { tiers: [[0.12, 0.46 * k, 3]], trim: null, frame: mix(CS, WHITE, 0.3), pilaster: CS2, lanterns: 1, lanternH: 0.3 * k, quarterPieces: [0, 0.95 * k], badge: 0.72 * k, arch: 0.2 * k }; delete s.stern.trim; },
    post: (s) => { s.rowD = (j, g, last) => (last ? { col: () => mul(CH, 0.4), proud: 0.006, vary: 0.05 } : j * s.sw > g.lift && g.lift > 0.2 ? { col: () => (j % 2 ? CS2 : CT), proud: 0, vary: 0.05 } : { col: () => (j >= 2 && j <= 3 ? mix(CH, WHITE, 0.25) : CH), proud: 0, vary: 0.06 }); s.bulkCol = mul(CS2, 0.8); } });
  launch(s, GALLEY_SKIP);
  setTrimRows();
  const y1 = H.railY(1), xt = H.x(1, y1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  // brass at the stemhead: a curl and a ball on the long overhanging bow
  { const pts = curve([[xt - 0.3, y1 - 0.26, 0], [xt + 0.02, y1 + 0.02, 0], [xt + 0.2 * k, y1 + 0.2 * k, 0], [xt + 0.22 * k, y1 + 0.42 * k, 0], [xt + 0.06 * k, y1 + 0.5 * k, 0], [xt + 0.02 * k, y1 + 0.36 * k, 0]], 4); carve(pts, pts.map((q, j) => 0.055 * k * (1 - 0.5 * j / (pts.length - 1))), CT, { ro: CTp[0], me: CTp[1], shade: null }); trimInk().T(xt + 0.04 * k, y1 + 0.33 * k, 0).sphere(0.07 * k, 8, 6); }
  { const q = deckPt(0.62); p.push(X(q[0], q[1], 0)); K.hatch(p, 0.4, clamp(B * 0.3, 0.3, 0.7), mul(CH, 0.9)); p.pop(); const t = deckPt(0.1); p.shade(K.grainX(0.12)).ink(mul(CH, 0.8), 0.8).bar([x0 + 0.05, t[1] + 0.3, 0], [t[0] + 0.5 * k, t[1] + 0.34, 0], 0.03, 0.02, 6, 3); p.shade(null); }
  if (!far) { for (const [ss, zf] of [[0.44, 0.7], [0.48, -0.7]]) { p.push(onDeck(ss, zf)); K.barrel(p, 0.1, 0.28, mul(OAK, 1.05), 4); p.pop(); } p.push(onDeck(0.8, 0)); K.coil(p, 0.12, 3, 0.014); p.pop(); }
  const pos = [[0.58], [0.62, 0.24], [0.68, 0.42, 0.18]][clamp(nm, 1, 3) - 1];
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const hgt = clamp(0.52 * L + 0.4, 1.6, 5.4) * [1, 0.72, 0.6][i], M = mast(pos[i], hgt, 0.012 * L + 0.02, { rake: -9 });
    stays(M, { n: 2, fore: false });
    lateenRig(M, { lenY: hgt * 1.5, slope: 44, fore: 0.44, f: 0.8, device: i === 0, seed: 3 + i, glow: 0.2, ...stripes(Math.max(5, Math.round(hgt * 2))) });
  }
  if (!nm || true) staff([x0 + 0.06, y0 + (st.stern.arch || 0), 0.25], 0.9 * k + 0.2, 'ensign', 0.9);
}

// ---------- 24. swan barge ----------
function buildSwanBarge() {
  const k = sizeK(7.5), fb = 0.5 * k, marigold = hex(0xf09a1e);
  const s = boatStyle({ draft: 0.24 * k, fb, sheerF: 0.5 * k, sheerA: 0.6 * k, wlMid: 0.84, midK: 1.0, deckE: 0.74, wlE: 1.2, midE: 0.9, tWl: 0.06, tMid: 0.2, tDeck: 0.3, kMid: 2.4, rakeF: 0.1 * L, stemE: 1.4, rakeA: 0.55, aftTo: 0.24, floor: fb - 0.2 },
    { pre: (s, o, C) => { s.lap = 0; s.plank = 4; C.accent = CT; C.inner = mul(CH, 0.95); C.rail = mul(CH, 0.7); C.deck = mix(hex(0xa07a4a), CH, 0.35); },
      post: (s) => { s.rowC = (j) => (j === s.nC - 1 || j === s.nC - 4 ? { col: () => CT, proud: 0.012, vary: 0.03 } : j === s.nC - 2 || j === s.nC - 3 ? { col: () => CS2, proud: 0, vary: 0.05 } : { col: () => CH, proud: 0, vary: 0.08 }); } });
  launch(s, BOAT_SKIP);
  setTrimRows();
  const y1 = H.railY(1), x1 = H.x(1, y1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  figure(`swan:${hx(CT)}`, swanFig({ col: hx(CT), beak: 0xd8442a, beakMe: 0.2, wing: hx(mix(CT, WHITE, 0.25)), hi: hx(CS2), ro: CTp[0], me: CTp[1] }), x1 - 0.3 * k, y1 + 0.1 * k, 1.6 * k);
  tailFan(x0, y0, k, CT, mix(CT, WHITE, 0.3), CTp);
  // the royal pavilion: a canopy of striped silk on gilded posts over a dais and a throne
  const aw = awning(0.2, 0.46, 0.74, 0.8 * k, CS, CS2, { post: CT, crown: 0.16 * k });
  { const q = deckPt(0.33); p.shade(K.grainX(0.1)).ink(mul(CH, 1.1), 0.8).T(q[0], q[1] + 0.05, 0).box(0.26 * L * 0.9, 0.1, aw.z * 1.6, 0.01); trimInk().T(q[0] - 0.2 * k, q[1] + 0.32 * k, 0).box(0.1 * k, 0.5 * k, 0.36 * k, 0.02); p.ink(CS2, 0.8).T(q[0] - 0.08 * k, q[1] + 0.16 * k, 0).box(0.3 * k, 0.12 * k, 0.34 * k, 0.03); trimInk().T((aw.x0 + aw.x1) / 2, aw.y + 0.2 * k, 0).lathe([[0.05 * k, 0], [0.09 * k, 0.07 * k], [0.02 * k, 0.16 * k], [0, 0.3 * k]], 6); }
  // marigold garlands swagged along both gunwales
  if (!far) bothSides(() => { const n = Math.max(4, Math.round(L * 1.1)); for (let i = 0; i < n; i++) { const a = railPt(lerp(0.08, 0.9, i / n), 0.03, 0.0), b = railPt(lerp(0.08, 0.9, (i + 1) / n), 0.03, 0.0), pts = []; for (let j = 0; j <= 5; j++) { const t = j / 5, q = lerp3(a, b, t); q[1] -= 0.12 * k * 4 * t * (1 - t); pts.push(q); } p.shade((x, y, z, nx, ny, nz, c) => mul(c, 0.7 + 0.6 * noise3(x * 40, y * 40, z * 40))).ink(marigold, 0.8, 0, 0.12).tube(pts, pts.map((q, j) => (j % 2 ? 0.034 : 0.026) * k), lite ? 3 : 5); p.shade(null).ink(CS2, 0.8).T(a[0], a[1] - 0.02, a[2]).sphere(0.04 * k, 5, 3); } });
  oars(oarCount(L * 1.2), 0.48, 0.86, { len: B * 1.1 + 0.4, sweep: -0.22, blade: CS2 });
  for (const sg of [1, -1]) steeringOar(0.09, 1.4 * k, mul(SPAR, 0.95), sg);
  // bright pennants on staffs along the rails
  for (const ss of [0.5, 0.7, 0.88]) for (const sg of [1, -1]) { const q = railPt(ss, -0.03, 0); if (far && ss !== 0.7) continue; staff([q[0], q[1], sg * q[2]], 0.55 * k + 0.25, 'pennant', 0.36, -0.1); }
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const hgt = clamp(0.5 * L + 0.3, 1.5, 5) * [1, 0.76, 0.62][i], M = mast([0.62, 0.8, 0.12][i], hgt, 0.011 * L + 0.02, { rake: -5, col: mul(CH, 0.8), hoop: CT });
    stays(M, { n: 1, fore: false, back: false });
    lateenRig(M, { lenY: hgt * 1.35, slope: 50, f: 0.8, device: i === 0, seed: 8 + i, glow: 0.2, ...stripes(Math.max(5, Math.round(hgt * 1.8))) });
  }
  staff([x0 + 0.3 * k, deckPt(0.06)[1] + 0.1, 0.3 * k], 1.0 * k, 'ensign', 0.8);
  extraMuzzles = railGuns(0.5, 0.84, { len: 0.34 });
}

// ---------- 3. swan galley ----------
/** a lance-thrower on placement m (shooting along local +Z): silver bow, a long lance tipped with crystal; returns the tip height and reach */
function ballista(m, sz, glowC) {
  p.push(m);
  p.shade(null).ink(CT, CTp[0], CTp[1]).bar([0, 0, 0], [0, sz * 0.42, 0], sz * 0.05, sz * 0.04, 6, 0);
  p.T(0, sz * 0.46, sz * 0.1).box(sz * 0.09, sz * 0.08, sz * 0.9, 0.008);
  for (const sg of [-1, 1]) p.tube([[0, sz * 0.48, sz * 0.42], [sg * sz * 0.3, sz * 0.5, sz * 0.36], [sg * sz * 0.52, sz * 0.5, sz * 0.12]], [sz * 0.04, sz * 0.03, sz * 0.014], 5);
  if (!lite) for (const sg of [-1, 1]) K.rope(p, [sg * sz * 0.52, sz * 0.5, sz * 0.12], [0, sz * 0.52, -sz * 0.3], 0.005, WHITE, 0, 3);
  p.shade(null).ink(mix(CT, WHITE, 0.4), 0.3, 0.8).bar([0, sz * 0.53, -sz * 0.3], [0, sz * 0.53, sz * 0.86], sz * 0.016, sz * 0.012, 5, 0);
  crystal(X(0, sz * 0.53, sz * 0.84, 90, 0, 0), sz * 0.3, sz * 0.05, glowC, 1.2);
  p.pop();
}
function buildSwanGalley() {
  const k = sizeK(7.5), zf = B * 0.41, white = CH, Lf = L * 0.56, glowC = mix(CS2, ICE, 0.4);
  const cols = (s, o, C) => { C.hull = white; C.accent = CT; C.upper = mix(white, CS2, 0.3); C.top = CT; C.inner = mul(white, 0.9); C.rail = mix(white, CT, 0.5); C.wale = CT; C.bottom = mix(white, hex(0x6a8aa0), 0.6); C.stripe = CT; C.deck = mix(DECK, WHITE, 0.4); C.transom = white; };
  const post = (s) => { s.rowD = (j, g, last) => ({ col: () => (last ? CT : white), proud: last ? 0.006 : 0, vary: 0.03 }); s.rowC = (j) => ({ col: () => (j === s.nC - 1 ? CT : white), proud: j === s.nC - 1 ? 0.014 : 0, vary: 0.03 }); };
  const fs = galleyStyle({ draft: 0.16 * k, fb: 0.26 * k, sheerF: 0.3 * k, sheerA: 0.22 * k, tumble: 0, wlMid: 0.8, deckE: 0.95, wlE: 1.5, midE: 1, tWl: 0.03, tMid: 0.05, tDeck: 0.06, rakeF: 0.1 * Lf, stemE: 1.2, rakeA: 0.5, aftTo: 0.25, thick: 0.03, camber: 0.01,
    segs: [{ s0: 0, s1: 1, lift: 0, bul: 0.05 }], wales: [] }, { def: { ...def, len: Lf, beam: B * 0.15, cannons: { perSide: 0 } }, pre: cols, post });
  bothSides(() => {
    p.push(X(-L * 0.03, 0, zf)); launch(fs, GALLEY_SKIP);
    oars(oarCount(L * 0.9), 0.2, 0.8, { one: true, len: B * 0.5 + 0.7, sweep: -0.24, col: mix(white, CT, 0.4), blade: CT });
    const xs = H.x(1, H.railY(1)), ys = H.railY(1); carve(curve([[xs - 0.2, ys - 0.08, 0], [xs + 0.05, ys + 0.05, 0], [xs + 0.16 * k, ys + 0.28 * k, 0], [xs + 0.04 * k, ys + 0.4 * k, 0]], 3), [0.04 * k, 0.04 * k, 0.03 * k, 0.03 * k, 0.025 * k, 0.02 * k, 0.016 * k, 0.012 * k, 0.01 * k, 0.008 * k], CT, { ro: CTp[0], me: CTp[1], shade: null, sides: 5 });
    p.pop();
  });
  const ms = galleyStyle({ draft: 0.3 * k, fb: 0.46 * k, sheerF: 0.5 * k, sheerA: 0.36 * k, tumble: 0, wlMid: 0.84, deckE: 0.86, wlE: 1.5, midE: 0.96, tWl: 0.05, tMid: 0.2, tDeck: 0.3, rakeF: 0.12 * L, stemE: 1.3, rakeA: 0.5, aftTo: 0.22,
    segs: [{ s0: 0, s1: 0.18, lift: 0.26 * k, bul: 0.24 }, { s0: 0.18, s1: 1, lift: 0, bul: 0.24 }], wales: [] }, { def: { ...def, beam: B * 0.36, cannons: { perSide: 0 } }, pre: cols, post });
  launch(ms, GALLEY_SKIP);
  setTrimRows();
  const y1 = H.railY(1), x1 = H.x(1, y1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  figure(`swan:${hx(white)}:${hx(CT)}`, swanFig({ col: hx(white), beak: hx(CT), beakMe: 0.85, wing: hx(mix(white, CS2, 0.25)), hi: hx(CT), ro: 0.45 }), x1 - 0.28 * k, y1 + 0.1 * k, 1.7 * k);
  tailFan(x0, y0, k * 0.9, mix(white, CS2, 0.3), white, [0.5, 0]);
  // arched beams of silver carry the floats
  for (const ss of [0.28, 0.5, 0.72]) bothSides(() => { const a = railPt(ss, -0.02, 0.02), b = [a[0] - L * 0.02, 0.3 * k, zf]; carve(curve([[a[0], a[1] - 0.05, a[2] - 0.2], a, [lerp(a[0], b[0], 0.5), a[1] + 0.26 * k, lerp(a[2], zf, 0.55)], b, [b[0], b[1] - 0.1, zf]], 3), 0.036 * k + 0.01, CT, { ro: CTp[0], me: CTp[1], shade: null, sides: 6 }); });
  // lance-throwers on the main deck, crystal heads alight
  const out = [];
  for (let i = 0; i < per; i++) { const ss = per === 1 ? 0.5 : lerp(0.3, 0.8, i / (per - 1)), q = deckPt(ss, 0.5), sz = clamp(0.1 * L, 0.5, 1.0); bothSides(() => ballista(X(q[0], q[1], q[2]), sz, glowC)); out.push([q[0], q[1] + sz * 0.53, q[2] + sz * 1.1]); }
  extraMuzzles = out;
  if (!far) for (const sg of [-1, 1]) { const q = deckPt(0.08, sg * 0.7); crystal(X(q[0], q[1] + 0.3 * k, q[2]), 0.3 * k, 0.05 * k, glowC, 1.2); trimInk().bar(q, [q[0], q[1] + 0.32 * k, q[2]], 0.02, 0.016, 5, 0); }
  // silk that shifts colour as it fills
  const pos = [[0.56], [0.62, 0.3], [0.7, 0.46, 0.24]][clamp(nm, 1, 3) - 1];
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const hgt = clamp(0.55 * L + 0.4, 1.6, 5.8) * [1, 0.8, 0.66][i], M = mast(pos[i], hgt, 0.011 * L + 0.02, { rake: 3, col: mix(white, CT, 0.3), hoop: CT });
    stays(M, { n: 1, fore: i === 0 });
    lateenRig(M, { lenY: hgt * 1.3, slope: 58, f: 0.76, device: i === 0, seed: 3 + i, glow: 0.28, ro: 0.5, yardCol: mix(white, CT, 0.5), ...bands(Math.max(6, Math.round(hgt * 2.2)), CS, CS2) });
  }
  staff([x0 + 0.2, deckPt(0.05)[1], 0], 1.0 * k, 'ensign', 0.85);
}

// ---------- 10. treasure junk ----------
function rocketRack(m, sz, col) {
  p.push(m);
  p.shade(K.grainX(0.12)).ink(mul(OAK, 0.9), 0.8).T(0, sz * 0.2, -sz * 0.1).box(sz * 0.8, sz * 0.06, sz * 0.5, 0.006);
  for (const sg of [-1, 1]) { p.bar([sg * sz * 0.36, 0, sz * 0.1], [sg * sz * 0.36, sz * 0.5, sz * 0.1], sz * 0.035, sz * 0.035, 4, 0); p.bar([sg * sz * 0.36, 0, -sz * 0.3], [sg * sz * 0.36, sz * 0.24, -sz * 0.3], sz * 0.035, sz * 0.035, 4, 0); }
  p.shade(null);
  for (let r = 0; r < 2; r++) for (let i = 0; i < (far ? 2 : 4); i++) { const n = far ? 2 : 4, x = (i - (n - 1) / 2) * sz * 0.2 * (far ? 2 : 1), a = [x, sz * (0.22 + 0.13 * r), -sz * (0.3 - 0.06 * r)], b = [x, sz * (0.52 + 0.13 * r), sz * (0.2 + 0.06 * r)];
    p.ink(col, 0.7).bar(a, b, sz * 0.045, sz * 0.045, 5, 2); trimInk().bar(b, add3(b, norm3(sub3(b, a)), sz * 0.14), sz * 0.05, 0.002, 5, 0); p.ink(mul(SPAR, 0.8), 0.8).bar(add3(a, norm3(sub3(a, b)), sz * 0.3), a, sz * 0.012, sz * 0.012, 3, 0); }
  p.pop();
}
function buildJunk() {
  const k = sizeK(10), red = mix(CS2, hex(0x8a1f1c), 0.0);
  const s = style('galleon', (s, o, C, v) => {
    Object.assign(o, { draft: 0.6 * k, fb: 0.76 * k, sheerF: 0.52 * k, sheerA: 0.56 * k, tumble: 0.04, rakeF: 0.1 * L, stemE: 0.95, rakeA: 0.1, deckE: 0.4, deckP: 3.0, midE: 0.6, wlE: 0.95, tWl: 0.55, tMid: 0.86, tDeck: 0.94, leanMin: -0.1, leanMax: 0.12,
      segs: [{ s0: 0, s1: 0.2, lift: 1.3 * k, bul: 0.44 }, { s0: 0.2, s1: 0.38, lift: 0.68 * k, bul: 0.44 }, { s0: 0.38, s1: 0.84, lift: 0, bul: 0.48 }, { s0: 0.84, s1: 1, lift: 0.44 * k, bul: 0.4 }] });
    C.accent = CT; C.upper = red; C.top = mul(CH, 0.4); C.bottom = hex(0x3a2a22); C.inner = mul(CH, 1.1); C.wale = mul(CH, 0.4); C.stripe = hex(0xe8dcc0);
    v.walesC = [2, 6]; v.portsC = [3, 5]; v.portRows = [2, 3]; v.spread = [0.2, 0.8];
  }, {
    mid: (s, o, C) => { s.stern = { tiers: [[0.16, 0.56 * k, 3], [0.86 * k, 1.2 * k, 4]], frame: red, pilaster: CT, lanterns: 0, quarterPieces: [0, 1.7 * k], badge: 1.46 * k }; s.head = null; },
    rig: (R) => { R.masts = []; R.sprit = null; R.jibs = 0; },
    post: (s, o, C) => { s.fitAs = 'none'; s.bulkCol = mul(red, 0.85); s.balCol = red;
      s.rowD = (j, g, last) => (last ? { col: () => CT, proud: 0.008, vary: 0.04 } : j * s.sw > g.lift + 0.01 && g.lift > 0.3 ? { col: () => ((j >> 1) % 2 ? red : mul(red, 0.72)), proud: 0, vary: 0.05 } : j >= 2 && j <= 3 ? { col: () => C.stripe, proud: 0, vary: 0.05 } : { col: () => C.hull, proud: 0, vary: 0.06 }); } });
  launch(s, { rig: true });
  setTrimRows();
  furnish({ hatches: [0.3, 0.66], capstan: 0.9 });
  const y1 = H.railY(1), x1 = H.x(1, y1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  // a dragon rears at the stem; the bow wears painted eyes to find the way
  figure(`dragon:${hx(red)}:${hx(CT)}`, dragonFig({ col: hx(red), hi: hx(CT), scales: true, eye: 0xffd040, me: 0, ro: 0.55 }), x1 - 0.12 * k, y1 - 0.02, 1.25 * k);
  bothSides(() => { const ss = 0.93, y = H.yGun(ss) + 0.1; p.push(H.frame(ss, y, 0.01)); p.shade(null).ink(WHITE, 0.7).T(0, 0, 0, 90, 0, 0).lathe([[0, 0.012], [0.15 * k, 0.012], [0.16 * k, 0]], 12); p.ink(hex(0x101014), 0.5).T(0.03 * k, 0, 0.008, 90, 0, 0).lathe([[0, 0.012], [0.07 * k, 0.012], [0.075 * k, 0]], 10); p.pop(); });
  // rocket racks on the waist and the forecastle, canted over the rails
  const nR = far ? 1 : 2;
  for (let i = 0; i < nR; i++) bothSides(() => { const q = deckPt(lerp(0.5, 0.74, nR === 1 ? 0.5 : i), 0.62); rocketRack(X(q[0], q[1], q[2], -18, 0, 0), 0.6 * k, red); });
  { const q = deckPt(0.93, 0); rocketRack(X(q[0], q[1], 0, -24, 90, 0), 0.6 * k, red); }
  // red lanterns and the big rudder post at the stern
  for (const sg of [-1, 1]) { const z = sg * H.z(0, y0) * 0.7; p.shade(null).ink(IRON, 0.5, 0.8).bar([x0, y0, z], [x0 - 0.2, y0 + 0.5 * k, z], 0.014, 0.014, 4, 0); p.ink(hex(0xff3a1e), 0.5, 0, 1.0).T(x0 - 0.2, y0 + 0.34 * k, z, 0, 0, 0, 1, 1.3, 1).sphere(0.1 * k, 8, 5); trimInk().T(x0 - 0.2, y0 + 0.47 * k, z).cyl(0.05 * k, 0.07 * k, 0.03, 6); p.T(x0 - 0.2, y0 + 0.21 * k, z).cyl(0.07 * k, 0.05 * k, 0.03, 6); }
  const pos = [[0.56], [0.72, 0.36], [0.82, 0.55, 0.2], [0.86, 0.62, 0.36, 0.12]][clamp(nm, 1, 4) - 1], hk = [[1], [0.8, 1], [0.7, 1, 0.62], [0.62, 1, 0.84, 0.5]][clamp(nm, 1, 4) - 1], rk = [[0], [-5, 2], [-7, 0, 5], [-8, -1, 3, 6]][clamp(nm, 1, 4) - 1];
  for (let i = 0; i < Math.min(nm, 4); i++) {
    const hgt = clamp(0.5 * L + 0.6, 1.8, 6.4) * hk[i], M = mast(pos[i], hgt, (0.012 * L + 0.024) * (0.7 + 0.3 * hk[i]), { rake: rk[i], taper: 0.6 });
    junkRig(M, { w: clamp(0.36 * L, 1.2, 4.2) * (0.5 + 0.5 * hk[i]), clear: 0.6 * k, col: CS, device: hk[i] === 1, seed: 4 + i });
  }
  staff([x0 + 0.06, y0, 0], 1.2 * k, 'ensign', 1, -0.25);
}

// ---------- 22. atakebune ----------
function buildAtakebune() {
  const k = sizeK(8), timber = mix(CH, hex(0x6a5038), 0.5), plate = mix(hex(0x5a5c66), CH, 0.25);
  const s = galleyStyle({ draft: 0.42 * k, fb: 0.5 * k, sheerF: 0.16 * k, sheerA: 0.08 * k, tumble: 0, wlMid: 0.96, deckE: 0.34, deckP: 3.4, wlE: 0.8, midE: 0.46, midP: 3, tWl: 0.7, tMid: 0.9, tDeck: 0.94, kMid: 4, kEnd: 1.4, rakeF: 0.07 * L, stemE: 1.0, rakeA: 0.1,
    segs: [{ s0: 0, s1: 1, lift: 0, bul: 0.1 }], wales: [1, 4] }, { def: { ...def, cannons: { perSide: 0 } }, pre: (s, o, C) => { C.top = mul(CH, 0.5); C.deck = mix(DECK, CH, 0.4); } });
  launch(s, GALLEY_SKIP);
  // the box: slab walls of heavy timber sheathed in iron, pierced for guns and arrows
  const sA = 0.07, sB = 0.9, hB = 0.92 * k, yD = (ss) => H.deckEdge(ss) + 0.02, zW = (ss) => Math.max(0.1, H.z(ss, H.yGun(ss)) - 0.04), cols = H.between(sA, sB), nr = far ? 2 : 4, yTop = Math.max(yD(sA), yD(sB), yD(0.5)) + hB;
  const wallCol = (i, j) => mul(j === nr ? mul(timber, 0.6) : (i + j) % 2 ? plate : mul(plate, 0.82), 0.85 + 0.3 * hash2(i, j));
  bothSides(() => {
    p.shade(K.mottle(0.2, 12)).ink(plate, 0.6, 0.5).grid(cols.length - 1, nr, (i, j, out) => { const ss = cols[i]; out[0] = H.x(ss, yD(ss)); out[1] = lerp(yD(ss), yTop, j / nr); out[2] = zW(ss); }, wallCol);
    p.shade(null).ink(mul(timber, 0.5), 0.85); for (const f of [0.0, 1.0]) { const pts = cols.map((ss) => [H.x(ss, yD(ss)), lerp(yD(ss), yTop, f) + (f ? 0.02 : 0.03), zW(ss) + 0.012]); p.tube(pts, 0.035, 4); }
    const nPost = Math.max(3, Math.round(((sB - sA) * L) / 0.8));
    for (let i = 0; i <= nPost; i++) { const ss = lerp(sA, sB, i / nPost); p.T(H.x(ss, yD(ss)), (yD(ss) + yTop) / 2, zW(ss) + 0.012).box(0.07, yTop - yD(ss), 0.04); }
    // loopholes
    if (!far) { p.ink(PITCH, 1); const nL = Math.round(((sB - sA) * L) / 0.34); for (let i = 0; i < nL; i++) { const ss = lerp(sA, sB, (i + 0.5) / nL); p.T(H.x(ss, yD(ss)), lerp(yD(ss), yTop, 0.72), zW(ss) + 0.006, 0, Math.atan2(zW(ss + 0.01) - zW(ss - 0.01), 0.02 * L) / DEG * -1, 0).box(0.05, 0.16 * k, 0.012); } }
  });
  for (const [ss, dir] of [[sA, -1], [sB, 1]]) { const x = H.x(ss, yD(ss)), z = zW(ss), y = yD(ss); p.shade(K.mottle(0.2, 12)).ink(plate, 0.6, 0.5).poly(dir > 0 ? [[x, y, -z], [x, yTop, -z], [x, yTop, z], [x, y, z]] : [[x, y, z], [x, yTop, z], [x, yTop, -z], [x, y, -z]]); p.shade(null).ink(mul(timber, 0.5), 0.85).T(x + dir * 0.01, yTop, 0).box(0.07, 0.07, 2 * z + 0.06); if (!far) { p.ink(PITCH, 1); for (let i = -1; i <= 1; i++) p.T(x + dir * 0.006, lerp(y, yTop, 0.72), i * z * 0.5).box(0.012, 0.16 * k, 0.05); } }
  // its roof: a fighting deck with a low parapet
  p.shade(K.grainX(0.14)).ink(mix(DECK, CH, 0.3), 0.88).grid(cols.length - 1, 4, (i, j, out) => { const ss = cols[i]; out[0] = H.x(ss, yD(ss)); out[1] = yTop + 0.03 * (1 - Math.pow(j / 2 - 1, 2)); out[2] = (j / 2 - 1) * zW(ss); }, (i, j) => mul(mix(DECK, CH, 0.3), 0.8 + 0.2 * ((i + j) % 2)), true);
  p.shade(null);
  // guns run out through square ports low in the wall
  const out = [], gl = clamp(0.065 * L, 0.34, 0.6);
  for (let i = 0; i < per; i++) { const ss = lerp(sA, sB, (i + 0.5) / per), y = lerp(yD(ss), yTop, 0.36), x = H.x(ss, yD(ss)), z = zW(ss), pw = Math.min(0.26, ((sB - sA) * L / per) * 0.5);
    bothSides(() => { p.shade(null).ink(PITCH, 1).T(x, y, z + 0.008).box(pw, pw, 0.016); p.ink(mul(timber, 0.5), 0.85); for (const sg of [-1, 1]) { p.T(x + sg * (pw / 2 + 0.015), y, z + 0.016).box(0.03, pw + 0.06, 0.03); p.T(x, y + sg * (pw / 2 + 0.015), z + 0.016).box(pw + 0.06, 0.03, 0.03); } p.push(X(x, y - pw * 0.06, z - gl * 0.14)); K.gunBarrel(p, gl, gl * 0.088, -0.1); p.pop(); });
    out.push([x, y - pw * 0.06, z + gl * 0.36]); }
  extraMuzzles = out;
  // the keep: two storeys of white plaster under sweeping tiled roofs
  const xm = (ss) => H.x(ss, yD(ss)), kx = xm(0.34), kw = clamp(0.27 * L, 0.9, 3.0), kd = Math.min(kw * 0.8, zW(0.34) * 1.6), tile = hex(0x3a4048);
  const roof = (y, w, d2, h) => { p.shade(K.mottle(0.2, 9)).ink(tile, 0.6, 0.2).T(kx, y, 0, 0, 45, 0, 1, 1, d2 / w).lathe([[w * 0.92, -0.02], [w * 0.9, 0.03], [w * 0.5, h * 0.3], [w * 0.22, h * 0.72], [0, h]], 4); p.shade(null); trimInk().T(kx, y + h, 0).lathe([[0.03 * k, 0], [0.05 * k, 0.05 * k], [0, 0.16 * k]], 5); };
  tower(kx, yTop, 0, kw, kd, 0.62 * k, { col: hex(0xe8e2d4), merlon: 0, courses: 9, glow: hex(0xffb040), wins: 1, batter: 0.16 * k });
  p.shade(null).ink(mul(timber, 0.5), 0.85).T(kx, yTop + 0.08 * k, 0).box(kw * 1.14, 0.16 * k, kd * 1.14, 0.01);
  tower(kx, yTop + 0.72 * k, 0, kw * 0.66, kd * 0.66, 0.5 * k, { col: hex(0xe8e2d4), merlon: 0, courses: 9, glow: hex(0xffb040), wins: 1 });
  roof(yTop + 0.62 * k, kw * 0.82, kd * 0.82, 0.3 * k); roof(yTop + 1.22 * k, kw * 0.6, kd * 0.6, 0.55 * k);
  // curtains of the clan along the top of both walls, in the colour of the side
  { const nu = far ? 8 : 16, top = Array.from({ length: nu + 1 }, (_, i) => { const ss = lerp(sA + 0.01, sB - 0.01, i / nu); return [H.x(ss, yD(ss)), yTop + 0.05, zW(ss) + 0.035]; }), dropC = 0.36 * k;
    for (const sg of [1, -1]) flags.push({ kind: 'panel', nu, nv: 2, flip: sg < 0, P: (u, v) => { const q = top[Math.round(u * nu)]; return [q[0], q[1] - v * dropC, sg * (q[2] + 0.02 * Math.sin(u * 40) * v)]; }, col: (u, v, side, pale, dk) => (Math.floor(u * 9) % 3 === 1 && v > 0.2 && v < 0.8 ? pale : v > 0.95 ? dk : side) }); }
  oars(oarCount(L * 1.5), sA + 0.04, sB - 0.04, { len: B * 0.75 + 0.5, y: (ss) => yD(ss) - 0.03, sweep: -0.2 });
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const ss = [0.62, 0.8, 0.14][i], hgt = clamp(0.42 * L + 0.4, 1.6, 4.8) * [1, 0.7, 0.6][i], M = mast(ss, hgt, 0.012 * L + 0.022, { base: [xm(ss), yTop + 0.02, 0] });
    stays(M, { n: 0, foreTo: [xm(sB), yTop + 0.05, 0], backTo: [xm(sA), yTop + 0.05, 0] });
    squareRig(M, { f: 0.92, w: clamp(1.0 * B + 0.4, 1.2, 4.6) * [1, 0.7, 0.6][i], clear: 0.4 * k, device: i === 0, devR: 0.3, seed: 5 + i, vs: [0, 0.12, 1], colOf: (a, b) => (b ? CS : CS2) });
  }
  staff([xm(sA) + 0.1, yTop, 0], 1.0 * k, 'ensign', 0.9, -0.15);
  
}

// ---------- 17. ox barge ----------
function buildOxBarge() {
  const k = sizeK(8), iron = hex(0x34343a);
  const s = galleyStyle({ draft: 0.4 * k, fb: 0.74 * k, sheerF: 0.26 * k, sheerA: 0.2 * k, tumble: 0, wlMid: 0.97, deckE: 0.3, deckP: 3.6, wlE: 0.62, midE: 0.4, midP: 3.2, tWl: 0.78, tMid: 0.92, tDeck: 0.96, kMid: 5, kEnd: 2.2, rakeF: 0.1 * L, stemE: 0.8, rakeA: 0.3, aftTo: 0.2,
    segs: [{ s0: 0, s1: 1, lift: 0, bul: 0.3 }], wales: [0, 3, 6] },
  { def: { ...def, cannons: { perSide: 0 } }, pre: (s, o, C) => { s.plank = 1.6; s.sw = 0.1; C.hull = CH; C.top = mul(CH, 0.5); C.deck = mix(DECK, CH, 0.5); C.rail = mul(CH, 0.65); C.bottom = hex(0x241c16); C.stripe = mul(CH, 0.7); },
    post: (s) => { s.rowC = (j) => ({ col: (kk) => (hash2(j, kk) > 0.74 ? mul(iron, 0.9 + 0.3 * hash2(kk, j)) : mul(CH, 0.8 + 0.35 * hash2(j + 3, kk))), proud: j === 0 || j === 3 ? 0.02 : 0.004 * (j % 2), groove: 0.009, vary: 0.12 }); } });
  launch(s, GALLEY_SKIP);
  straps(spreadS(Math.max(4, Math.round(L * 0.9)), 0.08, 0.92), () => H.yP, (ss) => H.railY(ss) + 0.02, 0.1, iron);
  rivets(0.05, 0.95, (ss) => H.yGun(ss) - 0.05, 0.2, hex(0x7a7a80), 0.02);
  const x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  // great sweeps, three men to a loom
  oars(oarCount(Math.max(3, L * 0.6)), 0.2, 0.8, { len: B * 0.9 + 1.2, sweep: -0.2, r: 0.034, bladeW: 0.2, col: mul(SPAR, 0.8) });
  bothSides(() => { for (const ss of spreadS(oarCount(Math.max(3, L * 0.6)), 0.2, 0.8)) { const q = railPt(ss, -0.03, 0.02); p.shade(null).ink(iron, 0.5, 0.8); for (const dx of [-0.05, 0.05]) p.bar([q[0] + dx, q[1], q[2]], [q[0] + dx, q[1] + 0.14, q[2]], 0.016, 0.012, 4, 0); } });
  // salvaged guns far too big for her, chained down on sledges
  const out = [], gl = clamp(0.16 * L, 0.7, 1.7);
  for (let i = 0; i < per; i++) { const ss = per === 1 ? 0.5 : lerp(0.26, 0.76, i / (per - 1)), q = deckPt(ss, 0.5);
    bothSides(() => { deckGun(X(q[0], q[1], q[2]), gl, { fat: 0.1, wood: mul(CH, 0.7) }); if (!far) chain([q[0] - gl * 0.2, q[1] + gl * 0.34, q[2] - gl * 0.1], [q[0] - gl * 0.3, q[1] + 0.02, q[2] - gl * 0.5], 0.03, 0.014); });
    out.push([q[0], q[1] + gl * 0.32, q[2] + gl * 0.5]); }
  extraMuzzles = out;
  // hide awnings fore and aft, sagging on crooked poles
  const hideA = HIDE, hideB = mul(HIDE, 0.7);
  awning(0.05, 0.26, 0.82, 0.8 * k, hideA, hideB, { post: mul(SPAR, 0.7), crown: -0.07, n: 5 });
  awning(0.8, 0.93, 0.7, 0.62 * k, hideB, hideA, { post: mul(SPAR, 0.7), crown: -0.05, n: 4 });
  // trophies: skulls on poles, a rack of horns and tusks at the bow
  const skull = (q, r) => { p.shade(null).ink(BONE, 0.7).T(q[0], q[1], q[2], 0, 0, 0, 1, 0.9, 0.85).sphere(r, 7, 5); p.T(q[0] + r * 0.7, q[1] - r * 0.45, q[2]).box(r * 0.8, r * 0.6, r * 0.9, 0.01); p.ink(PITCH, 1); for (const sg of [-1, 1]) p.T(q[0] + r * 0.82, q[1] + r * 0.05, q[2] + sg * r * 0.36).sphere(r * 0.26, 5, 3); };
  for (const [ss, zf, h] of [[0.5, 0.92, 0.9], [0.5, -0.92, 0.9], [0.3, 0.92, 0.7], [0.72, -0.92, 0.75], [0.97, 0, 1.1]].slice(0, far ? 3 : 5)) { const q = deckPt(ss, zf); p.shade(K.grainY(0.14)).ink(mul(SPAR, 0.7), 0.85).bar(q, [q[0] + 0.04, q[1] + h * k, q[2]], 0.022, 0.016, 5, 0); skull([q[0] + 0.04, q[1] + h * k + 0.07 * k, q[2]], 0.09 * k); }
  { const q = deckPt(0.97, 0); for (const sg of [-1, 1]) { p.shade(null).ink(BONE, 0.6).tube(curve([[q[0], q[1] + 0.86 * k, sg * 0.08], [q[0] + 0.1, q[1] + 0.9 * k, sg * 0.4 * k], [q[0] + 0.26 * k, q[1] + 1.2 * k, sg * 0.62 * k]], 3), [0.06 * k, 0.055 * k, 0.05 * k, 0.04 * k, 0.03 * k, 0.018 * k, 0.004], 6, 1); } }
  if (!far) { for (const [ss, zf, sd] of [[0.4, 0.2, 1], [0.44, -0.3, 2], [0.62, 0.1, 3]]) { p.push(onDeck(ss, zf, 0, sd * 20)); K.crate(p, 0.4, 0.34, 0.38, mul(OAK, 1.1), sd); p.pop(); } for (let i = 0; i < 3; i++) { p.push(onDeck(0.56 + i * 0.04, -0.5)); K.barrel(p, 0.13, 0.36, mul(OAK, 1.0), 20 + i); p.pop(); } }
  { const q = deckPt(0.5, 0); p.push(X(q[0], q[1], 0)); K.hatch(p, 0.6, clamp(B * 0.2, 0.4, 1.0), mul(CH, 0.8)); p.pop(); }
  // the war-pole: a tree trunk hung with hides, horns and the skulls of the beaten
  if (!nm) { const q = deckPt(0.38, 0), h = clamp(0.3 * L + 0.6, 1.6, 3.6); p.push(X(q[0], q[1] + h / 2 - 0.1, 0, 0, 0, 90 - 3)); K.logTimber(p, h, 0.07 * k + 0.02, 77, mul(CH, 0.8), { sides: 8 }); p.pop();
    p.shade(K.grainX(0.12)).ink(mul(SPAR, 0.7), 0.85).bar([q[0], q[1] + h * 0.78, -B * 0.22], [q[0], q[1] + h * 0.78, B * 0.22], 0.04, 0.035, 5, 3); p.shade(null);
    for (const sg of [-1, 1]) { drape(Array.from({ length: 5 }, (_, i) => [q[0] + 0.03, q[1] + h * 0.77, sg * lerp(0.05, 0.21, i / 4) * B]), h * 0.42, sg > 0 ? HIDE : mul(HIDE, 0.7), { out: [1, 0, 0], rag: 0.4, seed: 3 + sg, bulge: 0.04, fur: true }); skull([q[0], q[1] + h * 0.78 + 0.1 * k, sg * B * 0.22], 0.09 * k); }
    skull([q[0] + 0.05, q[1] + h + 0.06 * k, 0], 0.14 * k);
    for (const sg of [-1, 1]) p.shade(null).ink(BONE, 0.6).tube(curve([[q[0], q[1] + h + 0.08 * k, sg * 0.08 * k], [q[0] - 0.05, q[1] + h + 0.2 * k, sg * 0.3 * k], [q[0] + 0.12 * k, q[1] + h + 0.46 * k, sg * 0.4 * k]], 3), [0.05, 0.046, 0.04, 0.034, 0.026, 0.016, 0.004].map((v) => v * k), 5, 1);
    addFlag('pennant', [q[0], q[1] + h * 0.95, 0], 0.7); }
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const hgt = clamp(0.36 * L + 0.4, 1.4, 4.4) * [1, 0.8, 0.7][i], M = mast([0.6, 0.34, 0.8][i], hgt, 0.014 * L + 0.02, { rake: [2, -3, 4][i], col: mul(SPAR, 0.75) });
    stays(M, { n: 1 });
    squareRig(M, { f: 0.9, w: clamp(0.7 * B + 0.4, 1.2, 4), clear: 0.7 * k, device: i === 0, seed: 8 + i, col: CS, rag: 0.2, ragN: 5, us: [0, 0.3, 0.64, 1], vs: [0, 0.45, 1], colOf: (a, b) => mul(mix(CS, HIDE, 0.5 * hash2(a + i, b)), 0.85 + 0.3 * hash2(a, b + 4)) });
  }
  steeringOar(0.06, 1.9 * k, mul(SPAR, 0.8));
  staff([x0 + 0.1, y0, -H.z(0, y0) * 0.5], 1.1 * k, 'ensign', 1, -0.2);
}

// ---------- 7. dreadnought ----------
/** glowing runes cut into a band along the side at height yAt(s) */
function runeBand(s0, s1, yAt, h, band, glowC) {
  bothSides(() => {
    const cols = H.between(s0, s1);
    p.shade(null).ink(band, 0.38, 0.85); K.sweep(p, H, cols, yAt, [[0.012, -h / 2], [0.03, -h / 2 + 0.01], [0.03, h / 2 - 0.01], [0.012, h / 2]]);
    if (far) return;
    const n = Math.round(((s1 - s0) * L) / (h * 1.5));
    p.ink(glowC, 0.4, 0, 1.2);
    for (let i = 0; i < n; i++) { const s = lerp(s0, s1, (i + 0.5) / n), g = Math.floor(hash2(i, 7) * 4); p.push(H.frame(s, yAt(s), 0.032));
      if (g === 0) { p.T(0, 0, 0).box(h * 0.1, h * 0.62, 0.008); p.T(h * 0.12, h * 0.12, 0, 0, 0, 40).box(h * 0.1, h * 0.36, 0.008); } else if (g === 1) { p.T(0, 0, 0, 0, 0, 35).box(h * 0.1, h * 0.66, 0.008); p.T(0, 0, 0, 0, 0, -35).box(h * 0.1, h * 0.66, 0.008); } else if (g === 2) { p.T(-h * 0.14, 0, 0).box(h * 0.1, h * 0.62, 0.008); p.T(h * 0.14, 0, 0).box(h * 0.1, h * 0.62, 0.008); p.T(0, 0, 0, 0, 0, 50).box(h * 0.1, h * 0.4, 0.008); } else { p.T(0, h * 0.1, 0, 0, 0, 45).box(h * 0.3, h * 0.3, 0.008); p.T(0, -h * 0.2, 0).box(h * 0.1, h * 0.3, 0.008); }
      p.pop(); }
  });
}
/** a gun turret on (x, y, 0): an iron drum with two guns laid along yaw (degrees; 0 = ahead) */
function turret(x, y, R, yaw, band, plate) {
  p.push(X(x, y, 0, 0, yaw, 0));
  p.shade(K.mottle(0.22, 12)).ink(plate, 0.5, 0.7).lathe([[R * 1.1, 0], [R * 1.1, R * 0.12], [R, R * 0.14], [R * 0.98, R * 0.78], [R * 0.84, R * 0.95], [0, R]], far ? 8 : 14);
  p.shade(null).ink(band, 0.38, 0.85).T(0, R * 0.46, 0).lathe([[R + 0.004, -R * 0.07], [R + 0.022, 0], [R + 0.004, R * 0.07]], far ? 8 : 14);
  if (!lite) { p.ink(hex(0x8a8f98), 0.4, 0.85); for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; p.T(Math.cos(a) * R * 1.0, R * 0.7, Math.sin(a) * R * 1.0).sphere(R * 0.035, 5, 3); } }
  for (const sg of [-1, 1]) { p.push(X(R * 0.8, R * 0.5, sg * R * 0.36, 0, 90, 0)); K.gunBarrel(p, R * 2.5, R * 0.2, -0.3); p.pop(); p.shade(null).ink(PITCH, 1).T(R * 0.98, R * 0.5, sg * R * 0.36).box(0.03, R * 0.3, R * 0.3); }
  p.ink(plate, 0.5, 0.7).T(-R * 0.3, R * 1.0, 0).lathe([[R * 0.2, 0], [R * 0.2, R * 0.14], [0, R * 0.2]], 6);
  p.pop();
}
function buildDreadnought() {
  const k = sizeK(9.5), plate = mix(hex(0x3c3f46), CH, 0.5), dark = mul(plate, 0.6), glowC = mix(CS2, hex(0xff9a3a), 0.0), R = clamp(0.2 * B + 0.3 * k, 0.5, 1.5), sW = 0.5;
  const s = galleyStyle({ draft: 0.6 * k, fb: 0.52 * k, sheerF: 0.1 * k, sheerA: 0.06 * k, tumble: 0.1, wlMid: 0.95, deckE: 0.56, wlE: 1.1, midE: 0.72, tWl: 0.45, tMid: 0.8, tDeck: 0.82, kMid: 3.6, rakeF: -0.045 * L, stemE: 1.3, rakeA: 0.08, leanMin: -0.2, leanMax: 0,
    segs: [{ s0: 0, s1: 1, lift: 0.46 * k, bul: 0.2 }], portRows: [1, 3], spread: [0.16, 0.86], wales: [0, 4] },
  { pre: (s, o, C) => { s.plank = 0.85; C.hull = plate; C.accent = CT; C.upper = plate; C.top = dark; C.inner = mul(plate, 1.1); C.deck = mix(plate, DECK, 0.25); C.rail = dark; C.wale = dark; C.bottom = hex(0x4a2420); C.stripe = hex(0x8a8f98); C.transom = plate; },
    post: (s) => { const row = (off) => (j) => ({ col: (kk) => mul(plate, 0.82 + 0.34 * hash2(j + off, kk)), proud: j % 3 === 0 ? 0.016 : 0.006, groove: 0.01, vary: 0.04 }); s.rowC = row(0); const rd = row(30); s.rowD = (j, g, last) => (last ? { col: () => dark, proud: 0.01, vary: 0.04 } : rd(j)); portsClearOf(s, sW, (R * 1.25) / s.L); } });
  const from = p.n; launch(s, GALLEY_SKIP);
  for (let i = from; i < p.n; i++) { const q = i * 3, mx = Math.max(p.C[q], p.C[q + 1], p.C[q + 2]), mn = Math.min(p.C[q], p.C[q + 1], p.C[q + 2]); if (mx - mn < 0.035 && p.M[q + 1] === 0 && p.P[q + 1] > H.yP) { p.M[q] = 0.5; p.M[q + 1] = 0.65; } }
  const yRow = (j) => (ss) => H.yGun(ss) + j * st.sw;
  rivets(0.02, 0.98, (ss) => yRow(-0.25)(ss), 0.16, hex(0x9a9ca4)); rivets(0.02, 0.98, (ss) => lerp(H.yS, H.yGun(ss), 0.3), 0.16, hex(0x9a9ca4));
  runeBand(0.03, 0.97, (ss) => yRow(4.6)(ss), 0.13 * k, CT, glowC);
  portFrames(CT);
  // armoured paddle boxes
  const yw = R * 0.28, zw = H.z(sW, 0.3) + R * 0.2 + 0.02, w = clamp(0.36 * R + 0.1, 0.3, 0.75), xw = H.x(sW, 0.3);
  bothSides(() => {
    paddleWheel(xw, yw, zw, R, w, { col: dark, rim: null });
    paddleBox(xw, yw, zw, R, w, plate, { skirt: -R * 0.3, shade: K.mottle(0.2, 10), ro: 0.5, me: 0.65, trim: CT });
    if (!lite) { p.shade(null).ink(hex(0x9a9ca4), 0.4, 0.85); for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; p.T(xw + Math.cos(a) * R * 0.98, yw + Math.sin(a) * R * 0.98, zw + w * 0.59).sphere(0.022, 5, 3); } }
  });
  // casemate amidships, two funnels on it
  const dq = deckPt(0.5), cl = 0.26 * L, cw = Math.min(H.zIn(0.5, dq[1]) * 1.3, B * 0.5), ch = 0.5 * k;
  tower(dq[0], dq[1] - 0.02, 0, cl, cw, ch, { col: plate, me: 0.15, ro: 0.6, merlon: 0, courses: 0.25, glow: hex(0xffb050), wins: 1 });
  trimInk().T(dq[0], dq[1] + ch * 0.9, 0).box(cl + 0.03, 0.06 * k, cw + 0.03, 0.01);
  const fh = clamp(1.3 + 0.17 * L, 1.5, 3.4), fr = clamp(0.03 * L, 0.12, 0.3);
  for (const [dx, sd] of [[cl * 0.2, 3], [-cl * 0.22, 5]]) smoke(funnel(dq[0] + dx, dq[1] + ch, 0, fh * (dx > 0 ? 1 : 0.9), fr, { band: CT, rake: 3 }), clamp(0.1 * L, 0.5, 1.15), sd);
  // turrets on the centreline, fore and aft
  const tR = clamp(0.055 * L, 0.3, 0.72);
  { const a = deckPt(0.8), b = deckPt(0.17); turret(a[0], a[1], tR, 0, CT, plate); turret(b[0], b[1], tR, 180, CT, plate); }
  // bridge wings, a signal mast, boats' davits
  { const m = mast(0.5, clamp(0.26 * L, 1.2, 3) + ch, 0.008 * L + 0.02, { base: [dq[0] + cl * 0.42, dq[1] + ch, 0], col: dark, hoop: CT, flagK: 0.8 }); K.yard(p, m.at(0.7), 0.16 * L, m.r * 0.4, [0, 0, 1], dark); for (const e of [-1, 1]) K.rope(p, add3(m.at(0.7), [0, 0, e * 0.075 * L]), [dq[0] + cl * 0.42, dq[1] + ch, e * cw * 0.4], 0.006, TAR, 0, 3); }
  for (let i = 1; i < Math.min(nm, 3); i++) mast(0.5, clamp(0.2 * L, 1, 2.4), 0.008 * L + 0.018, { base: deckPt(i === 1 ? 0.3 : 0.68), col: dark, hoop: CT, flag: 'flag', flagK: 0.8 });
  // a bronze-shod ram under the bow
  bothSides(() => { const cols2 = H.between(0.93, 1); p.shade(null).ink(CT, CTp[0], CTp[1]).grid(cols2.length - 1, 3, (i, j, out) => { const q = H.pt(cols2[i], lerp(-H.d * 0.95, H.yS + 0.06, j / 3), 0.02); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; }); });
  const x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  staff([x0 + 0.08, y0, 0], 0.9 * k + 0.3, 'ensign', 1, -0.2);
}

// ---------- 8. serpent barge ----------
function buildSerpentBarge() {
  const k = sizeK(9), stone = CH, gold = CT, glowC = hex(0x10c8b0), jade = hex(0x2a8a5a), teal = hex(0x1f6a8a), rouge = hex(0xb8322a);
  const s = galleyStyle({ draft: 0.14 * k, fb: 0.52 * k, sheerF: 0.16 * k, sheerA: 0.2 * k, tumble: 0, wlMid: 0.95, deckE: 0.42, deckP: 3, wlE: 0.82, midE: 0.52, tWl: 0.55, tMid: 0.84, tDeck: 0.9, kMid: 4, kEnd: 2, rakeF: 0.12 * L, stemE: 0.85, rakeA: 0.35, aftTo: 0.2,
    segs: [{ s0: 0, s1: 1, lift: 0, bul: 0.33 }], portRows: [1, 2], spread: [0.22, 0.8], wales: [] },
  { pre: (s, o, C) => { s.plank = 0.62; s.sw = 0.105; C.hull = stone; C.accent = gold; C.top = gold; C.inner = mul(stone, 0.9); C.deck = mix(stone, hex(0xb8b09a), 0.5); C.rail = mul(stone, 0.8); C.wale = gold; C.bottom = mul(stone, 0.5); C.stripe = mul(stone, 0.7); C.transom = stone; },
    post: (s) => { s.rowC = (j) => (j === s.nC - 1 || j === 1 ? { col: () => gold, proud: 0.016, groove: 0.008, vary: 0.03 } : { col: (kk) => mul(stone, 0.82 + 0.32 * hash2(j, kk)), proud: 0.004 * ((j + 1) % 2), groove: 0.01, vary: 0.05 }); s.rowD = (j, g, last) => (last ? { col: () => gold, proud: 0.012, vary: 0.03 } : { col: (kk) => (j === 1 && kk % 2 ? rouge : mul(stone, 0.85 + 0.3 * hash2(j + 9, kk))), proud: 0, groove: 0.01, vary: 0.05 }); } });
  launch(s, GALLEY_SKIP);
  setTrimRows();
  const y1 = H.railY(1), x1 = H.x(1, y1), x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  // the head of the feathered serpent rears over the bow, plumed in jade, teal and red
  figure(`fserpent:${hx(stone)}:${hx(gold)}`, dragonFig({ col: hx(stone), hi: hx(gold), ro: 0.85, scales: true, eye: 0x4af0d8, eyeGlow: 1.2, horns: false, plumes: [hx(jade), hx(teal), hx(rouge)], tongue: 0xb8322a }), x1 - 0.5 * k, y1 + 0.1 * k, 2.8 * k, { res: 40 });
  // the tail: a fan of long plumes over the stern
  tailFan(x0 + 0.1, y0, 1.5 * k, jade, rouge); tailFan(x0 + 0.3, y0 - 0.1, 1.05 * k, teal, gold);
  // feather-scales carved along the bulwarks
  if (!far) bothSides(() => { const n = Math.round(L * 1.6); for (let i = 0; i < n; i++) { const ss = lerp(0.08, 0.9, i / (n - 1)); if (st.ports.some((q) => Math.abs(q.s - ss) < q.hw + 0.06 / L)) continue; p.push(H.frame(ss, H.yGun(ss) + 0.2, 0.004)); p.shade(null).ink(i % 2 ? jade : teal, 0.7).T(0, 0, 0, 90, 0, 0).lathe([[0, 0.02], [0.1 * k, 0.012], [0.11 * k, 0]], 6, Math.PI, 0); p.pop(); } });
  // the shrine: a stepped pyramid amidships with a small temple on top, a stair up its face, a crystal burning on the roof
  const dq = deckPt(0.47), zi = H.zIn(0.47, dq[1] + 0.05), w0 = Math.min(0.3 * L, 3.6), d0 = Math.min(zi * 1.6, w0), hs = 0.27 * k;
  for (let i = 0; i < 3; i++) tower(dq[0], dq[1] + i * hs, 0, w0 * (1 - 0.24 * i), d0 * (1 - 0.24 * i), hs, { col: mul(stone, 1.05 - 0.05 * i), merlon: 0, courses: hs / 2.01 });
  for (let i = 0; i < 3; i++) trimInk().T(dq[0], dq[1] + (i + 1) * hs - 0.02, 0).box(w0 * (1 - 0.24 * i) + 0.02, 0.04, d0 * (1 - 0.24 * i) + 0.02, 0.006);
  const ty = dq[1] + 3 * hs, tw = w0 * 0.36, td = d0 * 0.4;
  tower(dq[0], ty, 0, tw, td, 0.44 * k, { col: mul(stone, 1.1), merlon: 0, courses: 0.1 });
  p.shade(null).ink(PITCH, 1).T(dq[0] + tw / 2 + 0.004, ty + 0.13 * k, 0).box(0.01, 0.26 * k, td * 0.4);
  p.ink(rouge, 0.8).T(dq[0], ty + 0.5 * k, 0).box(tw * 1.12, 0.12 * k, td * 1.12, 0.01); trimInk().T(dq[0], ty + 0.59 * k, 0).box(tw * 0.9, 0.06 * k, td * 0.5, 0.01);
  crystal(X(dq[0], ty + 0.62 * k, 0), 0.5 * k, 0.09 * k, glowC, 1.1);
  p.shade(null).ink(mul(stone, 0.95), 0.9); for (let i = 0; i < 9; i++) p.T(dq[0] + w0 * 0.5 - (i / 9) * w0 * 0.33 + 0.02, dq[1] + (i + 0.5) * (3 * hs / 9), 0).box(w0 * 0.33 / 9 + 0.03, 3 * hs / 9, td * 0.5);
  for (const sg of [-1, 1]) for (const ss of [0.2, 0.76]) brazier(onDeck(ss, sg * 0.6), 0.36 * k, hex(0x3af0c0));
  // the crystals that carry her: a keel of them under the hull, more breaking the surface along her sides
  const nC = Math.max(3, Math.round(L * 0.55));
  for (let i = 0; i < nC; i++) { const ss = lerp(0.14, 0.86, i / (nC - 1)), x = H.x(ss, 0); crystal(X(x, -H.d + 0.05, 0, 180, i * 40, 0), 0.6 * k, 0.1 * k, glowC, 1.1);
    if (i % 2 === 0 || !far) bothSides(() => { const q = H.pt(ss + 0.03, -0.02, 0.02); crystal(X(q[0], q[1] + 0.02, q[2], 100 + 20 * hash2(i, 3), i * 50, 0), 0.4 * k, 0.075 * k, glowC, 1.1); crystal(X(q[0] - 0.12, q[1], q[2] - 0.02, 125, i * 70, 14), 0.28 * k, 0.055 * k, glowC, 1.1); }); }
  // feather banners instead of sails
  for (let i = 0; i < Math.max(1, Math.min(nm, 3)); i++) { const q = deckPt([0.12, 0.84, 0.3][i], 0); staff([q[0], q[1], 0], (1.5 - 0.2 * i) * k, i ? 'pennant' : 'ensign', i ? 0.6 : 1, -0.12); }
}

// ---------- 13. scrap hulk ----------
function catapult(m, sz, wood) {
  p.push(m);
  p.shade(K.grainX(0.14)).ink(wood, 0.85);
  for (const sg of [-1, 1]) { p.T(0, sz * 0.06, sg * sz * 0.3).box(sz * 1.3, sz * 0.1, sz * 0.1, 0.01); p.bar([-sz * 0.1, sz * 0.1, sg * sz * 0.3], [0.02, sz * 0.7, sg * sz * 0.22], sz * 0.05, sz * 0.045, 5, 0); p.bar([sz * 0.4, sz * 0.1, sg * sz * 0.3], [0.04, sz * 0.66, sg * sz * 0.22], sz * 0.04, sz * 0.04, 5, 0); }
  p.T(0.03, sz * 0.7, 0).box(sz * 0.1, sz * 0.1, sz * 0.56, 0.01);
  const a = [-sz * 0.62, sz * 0.2, 0], b = [sz * 0.34, sz * 1.05, 0];
  p.bar(a, b, sz * 0.05, sz * 0.035, 6, 3);
  p.shade(null).ink(IRON, 0.6, 0.7).T(a[0], a[1] - sz * 0.02, 0).lathe([[0, 0], [sz * 0.14, sz * 0.03], [sz * 0.17, sz * 0.14], [sz * 0.14, sz * 0.14], [0, sz * 0.06]], 7);
  p.shade(K.mottle(0.3, 9)).ink(hex(0x77736a), 0.95).T(a[0], a[1] + sz * 0.1, 0).sphere(sz * 0.11, 7, 5);
  p.shade(null); K.rope(p, b, [sz * 0.55, sz * 0.1, 0], 0.012, HEMP, 0, 4);
  p.pop();
}
function buildScrapHulk() {
  const k = sizeK(9), pal = [CH, hex(0x7a3a2a), hex(0x3a5a52), hex(0x6a6a66), hex(0xa89a78), hex(0x34343a)], cloths = [CS, CS2, HIDE, hex(0x6a6a66), hex(0x8a3a2a)];
  const R = clamp(0.3 * B + 0.4 * k, 0.6, 2.0), sW = 0.56;
  const s = style('galleon', (s, o, C, v) => {
    Object.assign(o, { draft: 0.6 * k, fb: 0.8 * k, sheerF: 0.4 * k, sheerA: 0.2 * k, tumble: 0.04, rakeF: 0.06 * L, stemE: 1.3, rakeA: 0.14, deckE: 0.44, midE: 0.62, wlE: 0.95, tWl: 0.45, tMid: 0.8, tDeck: 0.86,
      segs: [{ s0: 0, s1: 0.22, lift: 1.1 * k, bul: 0.5 }, { s0: 0.22, s1: 0.4, lift: 0.4 * k, bul: 0.3 }, { s0: 0.4, s1: 0.78, lift: 0, bul: 0.5 }, { s0: 0.78, s1: 1, lift: 0.74 * k, bul: 0.32 }] });
    s.plank = 1.25;
    C.hull = CH; C.accent = pal[4]; C.upper = pal[1]; C.top = mul(CH, 0.45); C.bottom = hex(0x241c18); C.inner = mul(CH, 1.05); C.wale = pal[5]; C.stripe = mul(pal[4], 0.7); C.deck = mix(DECK, CH, 0.45); C.rail = mul(CH, 0.7);
    v.walesC = [2, 6]; v.portsC = null; v.portRows = [2, 3]; v.spread = [0.2, 0.74];
  }, {
    mid: (s, o, C) => { s.stern = { tiers: [[0.24 * k, 0.7 * k, 2]], frame: pal[4], trim: pal[5], pilaster: pal[1], lanterns: 0, quarterPieces: [0, 1.5 * k] }; s.head = null; },
    rig: (R_) => { R_.masts = []; R_.sprit = null; R_.jibs = 0; },
    post: (s, o, C) => { s.fitAs = 'none'; s.bulkCol = pal[3];
      const pick = (j, k0, gi) => { const kk = k0 | 0, h = hash2(j * 7 + gi * 31, kk); return h > 0.9 ? pal[5] : h > 0.66 ? pal[(gi + 1 + (kk % 3)) % 5] : pal[gi % 5]; };
      s.rowC = (j) => ({ col: (kk) => mul(pick(j, kk + (j > 4 ? 3 : 0), j > 4 ? 2 : 0), 0.8 + 0.35 * hash2(j, kk + 50)), proud: 0.012 * hash2(j, 3), groove: 0.012, vary: 0.14 });
      s.rowD = (j, g, last) => { const gi = 1 + s.hull.segs.indexOf(g); return { col: (kk) => mul(pick(j, kk, gi), 0.8 + 0.35 * hash2(j + 13, kk)), proud: last ? 0.01 : 0.008 * hash2(j, gi), groove: 0.012, vary: 0.14 }; };
      portsClearOf(s, sW, (R * 1.0) / s.L); } });
  launch(s, { rig: true });
  furnish({ hatches: [0.2], capstan: false });
  // boards and plates nailed over the worst of it
  const nP = far ? Math.round(L * 0.7) : Math.round(L * 2.2);
  bothSides(() => { for (let i = 0; i < nP; i++) { const ss = 0.05 + 0.88 * hash2(i, 1), g = H.seg(ss), y = lerp(H.yS + 0.15, H.railY(ss, g) - 0.1, hash2(i, 2)), iron = hash2(i, 3) > 0.68; p.push(H.frame(ss, y, 0.012)); if (iron) { const w = 0.26 + 0.3 * hash2(i, 5); p.shade(K.mottle(0.3, 18)).ink(mul(pal[5], 0.9 + 0.5 * hash2(i, 4)), 0.6, 0.6).T(0, 0, 0.012, 0, 0, hash2(i, 6) * 30 - 15).box(w, w * (0.6 + 0.5 * hash2(i, 7)), 0.02); if (!lite) { p.shade(null).ink(hex(0x8a8a90), 0.4, 0.85); for (const [ax, ay] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.T(ax * w * 0.4, ay * w * 0.26, 0.026).sphere(0.016, 5, 3); } } else p.shade(K.grainX(0.2, 2)).ink(mul(pal[Math.floor(hash2(i, 8) * 5)], 0.9 + 0.4 * hash2(i, 9)), 0.9).T(0, 0, 0.014, 0, 0, hash2(i, 6) * 70 - 35).box(0.5 + 0.5 * hash2(i, 5), 0.1, 0.028, 0.004); p.pop(); } p.shade(null); });
  // crude glyphs daubed on her sides: an eye and a hand's worth of strokes
  bothSides(() => { const ss = 0.31, y = H.yGun(ss) + 0.02, r = 0.24 * k, daub = hex(0xe0d8c0); p.push(H.frame(ss, y, 0.03)); p.shade(null).ink(daub, 0.95); p.T(0, 0, 0, 90, 0, 0).lathe([[r * 0.72, 0.004], [r, 0.004], [r, 0], [r * 0.72, 0]], far ? 7 : 11); p.T(0, 0, 0, 90, 0, 0).lathe([[0, 0.004], [r * 0.3, 0.004], [r * 0.3, 0]], 6); for (let i = 0; i < 4; i++) p.T(r * (1.5 + i * 0.36), -r * 0.1 * (i % 2), 0.002, 0, 0, 12 - i * 8).box(r * 0.16, r * (1.3 - 0.2 * i), 0.006); p.pop(); });
  // the great wheels: timber and rope, on beams run out through her sides
  const yw = R * 0.26, zw = H.z(sW, 0.3) + R * 0.2 + 0.06, w = clamp(0.3 * R + 0.1, 0.3, 0.8), xw = H.x(sW, 0.3), wood = mul(pal[0], 0.9);
  bothSides(() => {
    paddleWheel(xw, yw, zw, R, w, { col: wood, rim: mul(wood, 0.7), n: far ? 8 : 10 });
    p.shade(K.grainX(0.14)).ink(mul(wood, 0.7), 0.9);
    for (const dx of [-R * 0.9, 0, R * 0.9]) p.T(xw + dx, yw + (dx ? R * 0.5 : 0), zw - w * 0.2).box(0.12, 0.14, w * 2.1, 0.012);
    for (const dx of [-R * 0.9, R * 0.9]) p.bar([xw + dx, yw + R * 0.5, zw + w * 0.72], [xw, yw, zw + w * 0.72], 0.06, 0.06, 5, 0);
    p.shade(null);
  });
  // a catapult on the stern castle, a crooked stovepipe, heaps of salvage
  { const g = H.segs[0], q = H.on(0.12, 0, g); catapult(X(q[0], q[1], 0), clamp(0.1 * L, 0.5, 1.1), mul(pal[0], 0.85)); }
  { const q = deckPt(0.32, 0.3); smoke(funnel(q[0], q[1], q[2], 1.0 * k, 0.07 * k + 0.02, { rake: -9, band: pal[5], bands: [0.5] }), 0.5 * k, 9, hex(0x3a3836), 4); }
  if (!far) for (const [ss, zf, sd] of [[0.46, 0.5, 1], [0.5, -0.5, 2], [0.7, 0.3, 3], [0.88, -0.2, 4]]) { p.push(onDeck(ss, zf, 0, sd * 25)); K.crate(p, 0.34, 0.3, 0.32, mul(pal[sd % 5], 1.1), sd); p.pop(); }
  // patchwork sails on masts that were never the same ship's
  const pos = [[0.62], [0.68, 0.3], [0.86, 0.62, 0.3]][clamp(nm, 1, 3) - 1], x0 = H.x(0, H.railY(0)), y0 = H.railY(0);
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const hgt = clamp(0.46 * L + 0.5, 1.6, 5.6) * [1, 0.8, 0.66][nm === 3 ? [1, 0, 2][i] : i], M = mast(pos[i], hgt, 0.013 * L + 0.022, { rake: [5, -4, 7][i], col: mul(pal[i % 5], 0.8) });
    stays(M, { n: 2, fore: i === 0 });
    squareRig(M, { f: 0.9, w: clamp(1.1 * B + 0.4, 1.4, 4.8) * (hgt / (0.46 * L + 0.5)), clear: 0.7 * k, beta: 8 + i * 5, device: nm === 3 ? i === 1 : i === 0, seed: 11 + i, rag: 0.3, ragN: 6, us: [0, 0.2, 0.52, 0.76, 1], vs: [0, 0.34, 0.6, 1], colOf: (a, b) => mul(cloths[Math.floor(hash2(a * 3 + i * 7, b * 5 + 1) * cloths.length)], 0.85 + 0.25 * hash2(a, b)) });
  }
  staff([x0 + 0.1, y0, 0.2], 1.2 * k, 'ensign', 1, -0.3);
}

// ---------- 14. submersible ----------
function buildSubmersible() {
  const R = B / 2, yc = -R * 0.42, brass = CH, wood = hex(0x6a4428), dark = mul(brass, 0.45), glowC = hex(0x18e060), hl = L * 0.5;
  const prof = [[0, -hl], [R * 0.2, -hl * 0.985], [R * 0.56, -hl * 0.9], [R * 0.86, -hl * 0.72], [R, -hl * 0.4], [R, hl * 0.3], [R * 0.9, hl * 0.6], [R * 0.62, hl * 0.84], [R * 0.3, hl * 0.96], [R * 0.16, hl]];
  const rAt = (x) => { for (let i = 0; i < prof.length - 1; i++) if (x <= prof[i + 1][1]) return lerp(prof[i][0], prof[i + 1][0], (x - prof[i][1]) / (prof[i + 1][1] - prof[i][1] || 1)); return 0; };
  const nBand = Math.max(6, Math.round(L * 1.6));
  // the hull: staves of dark wood between broad brass hoops
  const shade = (x, y, z, nx, ny, nz, c) => { const t = (x / L + 0.5) * nBand, f = Math.abs(t - Math.round(t)), a = Math.atan2(y - yc, z), st2 = Math.floor(a * 7); return f < 0.16 ? mul(brass, 0.85 + 0.25 * noise3(x * 9, y * 9, z * 9)) : mul(wood, (0.78 + 0.3 * hash1(st2 + Math.round(t) * 17)) * (0.9 + 0.2 * noise3(x * 3, y * 30, z * 30))); };
  const f0 = p.n;
  p.shade(shade).ink(brass, 0.45, 0.8).T(0, yc, 0, 0, 0, -90).lathe(prof.flatMap((q, i) => (i > 0 && i < prof.length - 1 && !far ? [q, lerp3([...q, 0], [...prof[i + 1], 0], 0.5).slice(0, 2)] : [q])), far ? 10 : 20);
  for (let i = f0; i < p.n; i++) { const q = i * 3, isBrass = p.C[q] > p.C[q + 2] * 1.8 && p.C[q] > 0.2; if (!isBrass) { p.M[q] = 0.8; p.M[q + 1] = 0; } }
  p.shade(null);
  // raised hoops with rivets where they break the surface
  for (let i = 1; i < nBand; i++) { const x = (i / nBand - 0.5) * L, r = rAt(x); if (r < R * 0.3) continue; metal(brass, 0.38, 0.85).T(x, yc, 0, 0, 0, -90).lathe([[r + 0.002, -0.05], [r + 0.022, -0.03], [r + 0.022, 0.03], [r + 0.002, 0.05]], far ? 10 : 20);
    if (!lite) { p.ink(mul(brass, 1.3), 0.3, 0.9); for (let j = 0; j <= 10; j++) { const a = (j / 10) * 2.2 - 1.1; p.T(x, yc + Math.cos(a) * (r + 0.024), Math.sin(a) * (r + 0.024)).sphere(0.018, 5, 3); } } }
  // a deck of planks along her back, awash
  const top = yc + R;
  p.shade(K.grainX(0.14)).ink(mul(wood, 1.2), 0.9).T(-L * 0.03, top - 0.01, 0).box(L * 0.56, 0.05, R * 0.72, 0.01);
  // conning tower: brass drum, a domed hatch, lit ports all round, a periscope
  const tx = L * 0.08, tr = clamp(R * 0.5, 0.2, 0.6), th = clamp(R * 1.1, 0.4, 1.1), seg = far ? 8 : 14;
  metal(brass, 0.4, 0.85).T(tx, top - 0.06, 0).lathe([[tr * 1.2, 0], [tr * 1.16, th * 0.14], [tr, th * 0.2], [tr, th * 0.8], [tr * 1.1, th * 0.84], [tr * 1.1, th * 0.92], [tr * 0.9, th * 0.94], [tr * 0.55, th * 1.1], [0, th * 1.16]], seg);
  p.ink(dark, 0.5, 0.8).T(tx, top - 0.06 + th * 0.5, 0).lathe([[tr + 0.004, -th * 0.2], [tr + 0.016, -th * 0.2], [tr + 0.016, th * 0.2], [tr + 0.004, th * 0.2]], seg);
  const port = (q, n, r) => { p.push(frame(q, cross([0, 1, 0], n), [0, 1, 0])); metal(brass, 0.35, 0.9).T(0, 0, 0, 90, 0, 0).lathe([[r, 0], [r * 1.35, 0.008], [r * 1.35, 0.03], [r, 0.036]], far ? 6 : 10); p.ink(glowC, 0.2, 0, 1.0).T(0, 0, 0.012, 0, 0, 0, 1, 1, 0.5).sphere(r * 0.98, 7, 4); p.pop(); };
  for (let i = 0; i < (far ? 4 : 6); i++) { const a = (i / (far ? 4 : 6)) * TAU + 0.5; port([tx + Math.cos(a) * (tr + 0.014), top - 0.06 + th * 0.5, Math.sin(a) * (tr + 0.014)], [Math.cos(a), 0, Math.sin(a)], tr * 0.2); }
  p.ink(dark, 0.5, 0.8).tube([[tx - tr * 0.4, top + th, 0], [tx - tr * 0.4, top + th * 1.7, 0], [tx - tr * 0.1, top + th * 1.78, 0]], 0.022 + 0.01 * R, 5, 1); p.ink(glowC, 0.2, 0, 1.4).T(tx - tr * 0.06, top + th * 1.78, 0).sphere(0.03 + 0.012 * R, 6, 4);
  // lit ports along both flanks, above the water
  const nPo = Math.max(3, Math.round(L * 0.9));
  bothSides(() => { for (let i = 0; i < nPo; i++) { const x = lerp(-L * 0.3, L * 0.32, i / (nPo - 1)); if (Math.abs(x - tx) < 0.01) continue; const r = rAt(x), a = 0.62; port([x + L * 0.5 / nBand, yc + Math.sin(a) * (r + 0.004), Math.cos(a) * (r + 0.004)], [0, Math.sin(a), Math.cos(a)], clamp(R * 0.11, 0.04, 0.1)); } });
  // exhaust pipes abaft the tower, breathing steam
  for (const [dx, dz, hh] of [[-0.14, 0.18, 0.8], [-0.2, -0.18, 0.95], [-0.27, 0.06, 0.65]]) { const x = L * dx, z = R * dz * 2; p.shade(null).ink(dark, 0.5, 0.8).tube([[x, top - 0.1, z], [x, top + th * hh, z], [x - th * 0.16, top + th * (hh + 0.14), z]], clamp(R * 0.07, 0.025, 0.07), 6, 0); metal(brass, 0.4, 0.85).T(x, top + th * hh * 0.5, z).cyl(clamp(R * 0.09, 0.03, 0.09), clamp(R * 0.09, 0.03, 0.09), 0.04, 6);
    if (hh > 0.7) smoke([x - th * 0.2, top + th * (hh + 0.12), z], clamp(R * 0.45, 0.16, 0.42), dx * 100, hex(0xb8c0c4), 3); }
  // the nose: a barbed harpoon ram
  const nx0 = hl * 0.97 + 0, rl = clamp(0.2 * L, 0.6, 1.8);
  metal(hex(0x8a8f98), 0.35, 0.9).T(nx0 - 0.04, yc, 0, 0, 0, -90).lathe([[R * 0.2, 0], [R * 0.24, 0.04], [R * 0.12, rl * 0.2], [R * 0.07, rl * 0.7], [R * 0.2, rl * 0.74], [0, rl]], far ? 5 : 8);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.78; p.TM(X(nx0 + rl * 0.66, yc + Math.sin(a) * R * 0.1, Math.cos(a) * R * 0.1, a / DEG, 0, 0)).extrude([[0, 0], [rl * 0.1, 0], [-rl * 0.22, R * 0.3], [-rl * 0.12, 0.02]], 0.02); }
  metal(brass, 0.4, 0.85).T(nx0 - 0.1, yc, 0, 0, 0, -90).lathe([[R * 0.34, 0], [R * 0.36, 0.05], [R * 0.26, 0.12]], far ? 6 : 10);
  // fins: a dorsal ridge, diving planes, a tall rudder, the screw
  p.shade(K.mottle(0.2, 10)).ink(dark, 0.5, 0.8);
  p.T(-L * 0.3, 0, 0).extrude([[L * 0.12, top - 0.04], [-L * 0.02, top + R * 0.5], [-L * 0.13, top + R * 0.62], [-L * 0.1, top - 0.3]], 0.03 + 0.01 * R);
  for (const sg of [-1, 1]) p.T(L * 0.3, yc + R * 0.3, sg * (rAt(L * 0.3) + R * 0.2), 90, 0, 0).extrude([[-L * 0.06, -R * 0.24 * sg], [L * 0.04, -R * 0.24 * sg], [L * 0.02, R * 0.22 * sg], [-L * 0.05, R * 0.3 * sg]], 0.03);
  p.T(-hl + L * 0.03, yc, 0).extrude([[0.06 * L, 0], [-0.04 * L, R * 0.9], [-0.07 * L, R * 0.86], [-0.05 * L, -R * 0.8], [-0.02 * L, -R * 0.8]], 0.03);
  metal(brass, 0.4, 0.85); for (let i = 0; i < 3; i++) p.T(-hl - 0.03, yc, 0, i * 120 + 20, 0, 0).T2(0, R * 0.26, 0, 0, 30, 0).box(0.03, R * 0.5, R * 0.2, 0.006);
  p.shade(null);
  // tubes in her flanks for the guns
  const out = [];
  for (let i = 0; i < per; i++) { const x = per === 1 ? -L * 0.08 : lerp(-L * 0.26, L * 0.26, i / (per - 1)) + L * 0.035, r = rAt(x), a = 0.32, gl = clamp(0.08 * L, 0.3, 0.6), q = [x, yc + Math.sin(a) * r, Math.cos(a) * r];
    bothSides(() => { metal(brass, 0.38, 0.85).TM(frame(q, [1, 0, 0], [0, Math.cos(a), -Math.sin(a)])).T2(0, 0, 0, 90, 0, 0).lathe([[gl * 0.16, -0.02], [gl * 0.2, 0], [gl * 0.2, 0.05], [gl * 0.13, 0.07], [gl * 0.12, gl * 0.3], [gl * 0.15, gl * 0.32], [gl * 0.15, gl * 0.4], [gl * 0.09, gl * 0.4], [gl * 0.09, 0.02]], far ? 6 : 9); });
    out.push([q[0], q[1] + Math.sin(a) * gl * 0.42, q[2] + Math.cos(a) * gl * 0.42]); }
  extraMuzzles = out;
  staff([tx - tr * 0.8, top + th * 0.9, 0], clamp(0.16 * L, 0.6, 1.4), 'ensign', 0.7, -0.15);
}

// ---------- 5. citadel beast ----------
function buildCitadelBeast() {
  const k = clamp(L / 12, 0.25, 1.5), hw = B * 0.5, obs = CH, glowC = CS2, skin = hex(0x26383a), belly = hex(0x7a8a78), dark = mul(obs, 0.7);
  const bx = 0.43 * L, bz = hw * 0.94, by = 1.5 * k, cy = -0.62 * k, cx = -0.02 * L;
  const backY = (x, z) => cy + by * Math.sqrt(Math.max(0, 1 - ((x - cx) / bx) ** 2 - (z / bz) ** 2));
  const hideCol = (dx, dy, dz, n) => { const sc = 0.6 + 0.4 * hash2(Math.floor(dx * 9 + 40), Math.floor(dz * 9 + 40)); return mix(mul(skin, (0.5 + 0.9 * n) * sc), belly, smooth(0.0, -0.6, dy) * 0.8); };
  // the back of the beast, awash; its flippers; its tail; its head lifted clear ahead
  p.shade(null); blob([cx, cy, 0], bx, by, bz, 3, skin, { amp: 0.05, freq: 3, nu: 30, nv: 14, colOf: hideCol, ro: 0.7 });
  for (const sx of [1, -1]) bothSides(() => { p.push(X(cx + sx * 0.27 * L, -0.06 * k, bz * 0.86, 0, sx > 0 ? -30 : 28, -8)); blob([0, 0, 0.16 * B], 0.085 * L, 0.13 * k, 0.24 * B, 9 + sx, skin, { amp: 0.1, freq: 2, nu: 12, nv: 6, colOf: hideCol, ro: 0.7 }); p.pop(); });
  { const pts = curve([[cx - bx * 0.86, -0.5 * k, 0], [cx - bx * 1.08, -0.25 * k, 0], [-0.57 * L, 0.35 * k, 0.04 * B], [-0.6 * L, 0.95 * k, 0.0], [-0.55 * L, 1.3 * k, -0.03 * B]], far ? 2 : 4);
    carve(pts, pts.map((q, i) => lerp(0.55, 0.07, Math.pow(i / (pts.length - 1), 0.8)) * k), mul(skin, 0.9), { shade: K.mottle(0.4, 5), ro: 0.7, sides: 8 });
    const tp = pts[pts.length - 1]; for (const [rz, rx] of [[20, 0], [-50, 30], [-50, -30]]) spike(X(tp[0], tp[1], tp[2], rx, 0, rz), 0.5 * k, 0.08 * k, BONE); }
  const hx0 = cx + bx * 0.86;
  blob([hx0 + 0.04 * L, -0.2 * k, 0], 0.11 * L, 0.6 * k, 0.2 * B, 21, skin, { amp: 0.08, freq: 2.4, nu: 14, nv: 8, colOf: hideCol, ro: 0.7 });
  blob([hx0 + 0.13 * L, 0.1 * k, 0], 0.085 * L, 0.46 * k, 0.17 * B, 23, skin, { amp: 0.08, freq: 2.6, nu: 16, nv: 9, colOf: hideCol, ro: 0.7 });
  blob([hx0 + 0.2 * L, -0.02 * k, 0], 0.06 * L, 0.26 * k, 0.12 * B, 25, skin, { amp: 0.06, freq: 2.6, nu: 12, nv: 7, colOf: hideCol, ro: 0.7 });
  bothSides(() => {
    const ex = hx0 + 0.15 * L, ez = 0.13 * B;
    p.shade(null).ink(hex(0xffb020), 0.3, 0, 1.3).T(ex, 0.36 * k, ez, 0, 0, 0, 1.3, 1, 0.7).sphere(0.085 * k, 8, 5); p.ink(PITCH, 0.4).T(ex + 0.01, 0.36 * k, ez + 0.05 * k, 0, 0, 0, 0.4, 1, 0.4).sphere(0.07 * k, 5, 4);
    spike(X(ex - 0.03 * L, 0.46 * k, ez * 0.9, 0, 0, 40), 0.6 * k, 0.09 * k, BONE); spike(X(ex - 0.055 * L, 0.36 * k, ez * 1.15, 30, 0, 55), 0.42 * k, 0.07 * k, BONE);
    const nT = far ? 3 : 6; for (let i = 0; i < nT; i++) { const t = i / (nT - 1); spike(X(hx0 + lerp(0.15, 0.255, t) * L, 0.02 * k, lerp(0.11, 0.035, t) * B, 180, 0, 0), 0.2 * k, 0.04 * k, BONE); }
    p.shade(null).ink(PITCH, 0.6).T(hx0 + 0.245 * L, 0.14 * k, 0.03 * B).sphere(0.03 * k, 5, 3);
  });
  // bony scutes down both flanks of the back, barnacles between
  const nSc = Math.max(4, Math.round(L * 0.9));
  bothSides(() => { for (let i = 0; i < nSc; i++) { const x = cx + lerp(-0.84, 0.84, i / (nSc - 1)) * bx, z = bz * 0.8 * Math.sqrt(Math.max(0.05, 1 - ((x - cx) / bx) ** 2)), y = backY(x, z); spike(X(x, y - 0.05 * k, z, 38, 0, 0), (0.34 + 0.16 * hash2(i, 2)) * k, 0.12 * k, mul(BONE, 0.7)); } });
  // the citadel: a plinth of black glass walled and crenellated, a tower at each corner, a keep within
  const fw = 0.5 * L, fd = Math.min(0.58 * B, 0.36 * L), yP = 0.95 * k, obsO = { col: obs, ro: 0.32, me: 0.3, glow: glowC };
  tower(cx, -0.25 * k, 0, fw, fd, yP + 0.25 * k, { ...obsO, merlon: 0.16 * k, courses: 0.16 * k, glow: null, batter: 0.5 * k });
  p.shade(null).ink(dark, 0.4, 0.2).T(cx, yP + 0.01, 0).box(fw * 0.98, 0.03, fd * 0.98);
  const rT = Math.min(0.5 * k, fd * 0.2);
  for (const sx of [1, -1]) for (const sz of [1, -1]) { roundTower(cx + sx * fw * 0.5, -0.2 * k, sz * fd * 0.5, rT, (2.5 + (sx > 0 ? 0 : 0.4)) * k, { ...obsO, merlon: 0.14 * k, roof: mul(mix(obs, glowC, 0.12), 1.2), roofH: 1.2 * k, roofMe: 0.4, courses: 0.16 * k }); const top = (2.5 + (sx > 0 ? 0 : 0.4) + 1.3) * k - 0.2 * k; if (!far || sz > 0) { p.shade(null).ink(dark, 0.5, 0.5).bar([cx + sx * fw * 0.5, top - 0.1 * k, sz * fd * 0.5], [cx + sx * fw * 0.5, top + 0.45 * k, sz * fd * 0.5], 0.02 * k + 0.006, 0.01, 4, 0); addFlag('pennant', [cx + sx * fw * 0.5, top + 0.45 * k, sz * fd * 0.5], 0.5); } }
  for (const sz of [1, -1]) tower(cx - fw * 0.06, yP, sz * fd * 0.5, 0.9 * k, 0.6 * k, 1.5 * k, { ...obsO, merlon: 0.12 * k, roof: mul(mix(obs, glowC, 0.12), 1.2), roofH: 0.8 * k, roofUp: 0.12 * k, courses: 0.16 * k });
  // gatehouse toward the head, its arch alight
  tower(cx + fw * 0.5, yP - 0.4 * k, 0, 0.7 * k, 1.3 * k, 1.5 * k, { ...obsO, merlon: 0.12 * k, courses: 0.16 * k, glow: null });
  p.shade(null).ink(glowC, 0.3, 0, 1.2).T(cx + fw * 0.5 + 0.352 * k, yP + 0.16 * k, 0).box(0.02, 0.62 * k, 0.5 * k); p.ink(dark, 0.5, 0.6); for (let i = -2; i <= 2; i++) p.T(cx + fw * 0.5 + 0.37 * k, yP + 0.16 * k, i * 0.1 * k).box(0.02, 0.62 * k, 0.03 * k);
  // the keep: three stages and a spire
  const kx = cx - fw * 0.08, kw = Math.min(1.9 * k, fw * 0.4), kd = Math.min(1.7 * k, fd * 0.56);
  tower(kx, yP, 0, kw, kd, 2.3 * k, { ...obsO, merlon: 0.16 * k, courses: 0.16 * k, wins: 3 });
  tower(kx, yP + 2.3 * k, 0, kw * 0.66, kd * 0.66, 1.3 * k, { ...obsO, merlon: 0.13 * k, courses: 0.16 * k, wins: 2 });
  for (const sx of [1, -1]) for (const sz of [1, -1]) if (!far) roundTower(kx + sx * kw * 0.5, yP + 1.5 * k, sz * kd * 0.5, 0.2 * k, 1.1 * k, { ...obsO, merlon: 0, roof: mul(mix(obs, glowC, 0.12), 1.2), roofH: 0.7 * k, glow: null, courses: 0.16 * k });
  p.shade(K.mottle(0.2, 6)).ink(mul(mix(obs, glowC, 0.12), 1.2), 0.4, 0.4).T(kx, yP + 3.6 * k, 0, 0, 45, 0).lathe([[kw * 0.42, 0], [kw * 0.2, 0.5 * k], [kw * 0.1, 1.3 * k], [0, 2.0 * k]], 4);
  p.shade(null).ink(glowC, 0.3, 0, 1.3).T(kx, yP + 4.5 * k, 0).sphere(0.1 * k, 6, 4);
  staff([kx, yP + 5.55 * k, 0], 0.7 * k, 'ensign', 1.1, -0.05);
  // chains from the plinth to the beast's shoulders, a great lantern at the gate
  if (!far) bothSides(() => { chain([cx + fw * 0.5, 0.5 * k, fd * 0.4], [hx0 + 0.02 * L, 0.3 * k, 0.12 * B], 0.2 * k, 0.03 * k); chain([cx - fw * 0.5, 0.5 * k, fd * 0.4], [cx - bx * 0.94, 0.05 * k, 0.06 * B], 0.15 * k, 0.03 * k); });
  // guns in the curtain wall
  const out = [], gl = clamp(0.6 * k, 0.3, 0.8), zw = fd * 0.5;
  for (let i = 0; i < per; i++) { const x = cx + lerp(-0.36, 0.36, per === 1 ? 0.5 : i / (per - 1)) * fw, y = 0.45 * k, pw = Math.min(0.26 * k + 0.1, (0.72 * fw / Math.max(1, per)) * 0.5);
    bothSides(() => { p.shade(null).ink(PITCH, 1).T(x, y, zw + 0.008).box(pw, pw, 0.02); p.ink(glowC, 0.4, 0, 0.6); for (const sg of [-1, 1]) { p.T(x + sg * (pw / 2 + 0.015), y, zw + 0.014).box(0.03, pw + 0.06, 0.03); p.T(x, y + sg * (pw / 2 + 0.015), zw + 0.014).box(pw + 0.06, 0.03, 0.03); } p.push(X(x, y - pw * 0.05, zw - gl * 0.14)); K.gunBarrel(p, gl, gl * 0.09, -0.1); p.pop(); });
    out.push([x, y - pw * 0.05, zw + gl * 0.36]); }
  extraMuzzles = out;
}

// ---------- 25. hide raft ----------
function buildHideRaft() {
  const k = sizeK(4.5), bone = BONE, hideC = CS, nL = Math.max(4, Math.round(B / 0.32)), r = B / nL / 2, top = r * 1.25, wood = mix(CH, hex(0x8a8474), 0.3);
  // driftwood, lashed
  for (let i = 0; i < nL; i++) { const z = -B / 2 + (i + 0.5) * (B / nL), len = L * (0.82 + 0.18 * hash1(i * 7 + 1)), x = (hash1(i * 5 + 2) - 0.5) * L * 0.1; p.push(X(x, r * 0.25, z, hash1(i) * 360, (hash1(i + 30) - 0.5) * 5, 0)); K.logTimber(p, len, r * (0.9 + 0.2 * hash1(i * 11)), i + 1, wood, { sides: 10 }); p.pop(); }
  for (const [n, f] of [-0.34, 0.02, 0.36].entries()) { p.push(X(f * L, top + r * 0.3, 0, 40 * n, 90 + (n - 1) * 4, 0)); K.logTimber(p, B * 1.06, r * 0.5, 20 + n, mul(wood, 0.85), { sides: 8 }); p.pop(); if (!far) for (let i = 0; i < nL; i += 2) { p.push(X(f * L, top + r * 0.2, -B / 2 + (i + 0.5) * (B / nL), 0, 45, 0)); K.lashing(p, r * 0.62, 2); p.pop(); } }
  const dY = top + r * 0.75;
  // hides pegged down for a deck
  for (let i = 0; i < (far ? 2 : 4); i++) { const x = lerp(-0.3, 0.3, i / 3) * L, w = L * 0.24, d = B * (0.6 + 0.2 * hash1(i + 3)); p.shade(null).ink(mul(mix(HIDE, hideC, 0.4), 0.8 + 0.3 * hash1(i)), 0.95).grid(3, 3, (a, b, out) => { out[0] = x + (a / 3 - 0.5) * w * (1 + 0.1 * Math.sin(b * 2 + i)); out[1] = dY + 0.01 + 0.012 * ((a + b) % 2); out[2] = (b / 3 - 0.5) * d * (1 + 0.08 * Math.sin(a * 3 + i)); }, null, true); }
  // a great ribcage over the after half, hides stitched across it for shelter
  const sx0 = -0.42 * L, sx1 = 0.04 * L, hR = clamp(0.3 * B + 0.5 * k, 0.8, 2.6), nR = Math.max(3, Math.round((sx1 - sx0) / 0.36)), spineY = (x) => dY + hR * (0.86 + 0.14 * Math.sin((x - sx0) / (sx1 - sx0) * Math.PI));
  const ribPt = (x, t, sg) => { const a = t * 1.5, sc = 0.8 + 0.2 * Math.sin((x - sx0) / (sx1 - sx0) * Math.PI); return [x + 0.06 * L * t * t, dY + (spineY(x) - dY) * Math.cos(a) + 0.02, sg * (0.03 + B * 0.5 * sc * Math.sin(a) * 0.96)]; };
  { const pts = Array.from({ length: 9 }, (_, i) => { const x = lerp(sx0 - 0.03 * L, sx1 + 0.05 * L, i / 8); return [x, spineY(x) + 0.03, 0]; }); carve(pts, pts.map((q, i) => (0.07 + 0.02 * (i % 2)) * k), bone, { shade: K.mottle(0.2, 14), ro: 0.7 }); }
  for (let i = 0; i <= nR; i++) { const x = lerp(sx0, sx1, i / nR); for (const sg of [-1, 1]) { const pts = Array.from({ length: far ? 4 : 7 }, (_, j, ) => ribPt(x, j / (far ? 3 : 6), sg)); carve(pts, pts.map((q, j) => lerp(0.055, 0.02, j / (pts.length - 1)) * k), mul(bone, 0.9 + 0.15 * hash1(i)), { shade: K.mottle(0.2, 14), ro: 0.7, sides: 6 }); } }
  for (let i = 0; i < nR; i++) for (const sg of [-1, 1]) { if (hash2(i, sg + 3) < 0.3 && i > 0) continue; const xa = lerp(sx0, sx1, i / nR), xb = lerp(sx0, sx1, (i + 1) / nR), t1 = 0.6 + 0.35 * hash2(i, sg + 7), col = mul(mix(HIDE, hideC, 0.5 * hash2(i, sg)), 0.8 + 0.4 * hash2(i, sg + 1));
    cloth((u, v) => { const q = ribPt(lerp(xa, xb, u), 0.04 + v * t1, sg); q[1] -= 0.06 * Math.sin(Math.PI * u) * k; q[2] += sg * 0.012; return q; }, { col, cell: 0.2, seed: i * 3 + sg, glow: 0.02 }); }
  // the skull of whatever the ribs came from, set up at the bow
  { const sxx = 0.44 * L, sy = dY + 0.5 * k; p.shade(K.grainY(0.14)).ink(mul(wood, 0.8), 0.9); for (const sg of [-1, 1]) p.bar([sxx - 0.12 * L, dY, sg * B * 0.24], [sxx + 0.02, sy, 0], 0.03 * k + 0.01, 0.03 * k, 5, 0);
    p.shade(null); blob([sxx, sy + 0.08 * k, 0], 0.3 * k, 0.2 * k, 0.22 * k, 5, bone, { amp: 0.1, nu: 10, nv: 6, ro: 0.7 }); blob([sxx + 0.3 * k, sy - 0.02 * k, 0], 0.22 * k, 0.11 * k, 0.13 * k, 6, bone, { amp: 0.08, nu: 8, nv: 5, ro: 0.7 });
    for (const sg of [-1, 1]) { p.shade(null).ink(PITCH, 1).T(sxx + 0.14 * k, sy + 0.12 * k, sg * 0.15 * k).sphere(0.07 * k, 6, 4); p.ink(bone, 0.6).tube(curve([[sxx - 0.1 * k, sy + 0.2 * k, sg * 0.16 * k], [sxx - 0.16 * k, sy + 0.42 * k, sg * 0.42 * k], [sxx + 0.1 * k, sy + 0.7 * k, sg * 0.56 * k], [sxx + 0.4 * k, sy + 0.72 * k, sg * 0.44 * k]], 3), [0.07, 0.066, 0.06, 0.055, 0.05, 0.042, 0.034, 0.024, 0.014, 0.004].map((v) => v * k), 6, 1); if (!far) for (let i = 0; i < 3; i++) p.T(sxx + (0.24 + 0.09 * i) * k, sy - 0.1 * k, sg * 0.09 * k, 180, 0, 0).lathe([[0.022 * k, 0], [0, 0.09 * k]], 4); } }
  // a hide for a sail, on a mast that was a tree last year
  const tie = (e) => [-0.3 * L, dY + 0.1, e * B * 0.44];
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const hgt = clamp(0.5 * L + 0.6, 1.6, 5) * [1, 0.76, 0.62][i], bx = [0.14, 0.34, -0.06][i] * L, M = mast(0.5, hgt, 0.012 * L + 0.024, { base: [bx, top, (i - 0.5) * 0.1 * (i ? 1 : 0)], rake: [7, -6, 10][i], col: mul(wood, 0.8), plain: true });
    for (const q of [[0.46 * L, top, 0], [-0.3 * L, top, B * 0.44], [-0.3 * L, top, -B * 0.44]]) K.rope(p, q, M.at(0.9), 0.009, mul(HEMP, 0.8), 0, 4);
    squareRig(M, { f: 0.9, w: clamp(0.8 * B + 0.3, 1.0, 4) * [1, 0.76, 0.62][i], clear: 0.5 * k + 0.4, beta: 9 + i * 6, tie, device: i === 0, seed: 13 + i, rag: 0.24, ragN: 5, us: [0, 0.36, 0.7, 1], vs: [0, 0.5, 1], yardCol: mul(wood, 0.8), colOf: (a, b) => mul(mix(hideC, HIDE, 0.6 * hash2(a + i, b)), 0.8 + 0.35 * hash2(a, b + 2)) });
  }
  // a steering sweep, a fire, stores; the colours on a rib
  { const piv = [-0.46 * L, dY + 0.4 * k, B * 0.12], od = norm3([1, 0.36, -0.08]); p.shade(K.grainX(0.12)).ink(mul(wood, 0.9), 0.85).bar(add3(piv, od, -0.9 * k - 0.3), add3(piv, od, 0.9 * k), 0.026, 0.022, 6, 3); p.TM(frame(add3(piv, od, -0.8 * k - 0.24), od, [0, 1, 0])).box(0.4 * k + 0.1, 0.16, 0.018, 0.005); p.bar([piv[0], top, piv[2]], [piv[0], piv[1], piv[2]], 0.03, 0.026, 5, 0); p.shade(null); }
  { const nO = oarCount(0, 2); for (let i = 0; i < nO; i++) for (const sg of [-1, 1]) { const x = lerp(0.3, 0.05, nO === 1 ? 0.5 : i / (nO - 1)) * L, a = [x, dY + 0.16, sg * B * 0.42], b = [x - 0.3, -0.05, sg * (B * 0.5 + 0.8 * k + 0.2)]; p.shade(null).ink(mul(wood, 0.9), 0.85).bar(lerp3(a, b, -0.3), b, 0.02, 0.016, 5, 0); p.TM(frame(lerp3(a, b, 0.93), sub3(b, a), [0, 1, 0])).box(0.3, 0.1, 0.014); } }
  brazier(X(0.26 * L, dY, -B * 0.2), 0.3 * k);
  if (!far) { p.push(X(0.2 * L, dY, B * 0.24)); K.barrel(p, 0.11, 0.3, mul(OAK, 0.95), 5); p.pop(); p.push(X(0.3 * L, dY, B * 0.1, 0, 20, 0)); K.crate(p, 0.3, 0.24, 0.28, mul(OAK, 1.1), 3); p.pop(); }
  staff([sx0, spineY(sx0) + 0.05, 0], 0.8 * k + 0.2, 'ensign', 0.85, -0.3);
  if (!nm) staff([0.14 * L, top, 0], 1.3 * k, 'pennant', 0.7, 0.06);
  const out = [], gl = clamp(0.08 * L, 0.3, 0.5);
  for (let i = 0; i < per; i++) { const x = per === 1 ? 0.14 * L : lerp(-0.1, 0.36, i / (per - 1)) * L, z = B * 0.42; bothSides(() => { p.shade(K.grainY(0.14)).ink(mul(wood, 0.8), 0.9).bar([x, top - 0.05, z], [x, dY + 0.26, z], 0.04, 0.035, 5, 1); p.shade(null); p.push(X(x, dY + 0.31, z + gl * 0.1)); K.gunBarrel(p, gl, gl * 0.09); p.pop(); }); out.push([x, dY + 0.31, z + gl * 0.6]); }
  extraMuzzles = out;
}

// ---------- 26. flesh barge ----------
function buildFleshBarge() {
  const k = sizeK(8), flesh = CH, brass = CT, sinew = hex(0xe0b8a8), bone = BONE, sick = CS, gore = hex(0x4a1218), rx = 0.5 * L, ry = 0.78 * k, rz = B * 0.47, cy = 0.04 * k, eyeC = hex(0xd8e020);
  const sc = (x) => Math.sqrt(Math.max(0.02, 1 - (x / rx) ** 2)), surf = (x, a) => [x, cy + ry * sc(x) * Math.cos(a), rz * sc(x) * Math.sin(a)];   // a: 0 at the spine, pi/2 at the waterline to starboard
  // the carcass: one great lump of raw meat, veined and wet
  p.shade(null); blob([0, cy, 0], rx, ry, rz, 7, flesh, { amp: 0.16, freq: 2.4, nu: 34, nv: 16, ro: 0.45, colOf: (dx, dy, dz, n) => { const v = fbm3(dx * 9 + 3, dy * 9, dz * 9, 2); return mix(mul(flesh, 0.5 + 0.9 * n), v > 0.62 ? gore : sinew, v > 0.62 ? 0.75 : smooth(0.3, 0.1, v) * 0.5); } });
  blob([-0.36 * L, cy + 0.3 * k, 0.22 * B], 0.14 * L, 0.5 * k, 0.24 * B, 11, mul(flesh, 0.9), { amp: 0.2, freq: 2, nu: 12, nv: 7, ro: 0.45 }); blob([0.3 * L, cy + 0.36 * k, -0.2 * B], 0.12 * L, 0.46 * k, 0.2 * B, 13, mul(flesh, 1.1), { amp: 0.2, freq: 2, nu: 12, nv: 7, ro: 0.45 });
  // ribs break the hide all along it; a knuckled spine
  const nR = Math.max(4, Math.round(L * 1.1)), ribX = (i) => lerp(-0.38, 0.34, i / (nR - 1)) * L;
  for (let i = 0; i < nR; i++) for (const sg of [-1, 1]) { const x = ribX(i) + (sg > 0 ? 0 : 0.02 * L), n = far ? 4 : 7, pts = []; for (let j = 0; j <= n; j++) { const t = j / n, q = surf(x + 0.03 * L * Math.sin(t * 2), 0.1 + t * 1.5); pts.push([q[0], q[1] + (0.14 - 0.1 * t) * k, sg * (q[2] + (0.1 + 0.06 * Math.sin(t * Math.PI)) * k)]); } carve(pts, pts.map((q, j) => lerp(0.07, 0.022, j / n) * k), mul(bone, 0.85 + 0.2 * hash1(i)), { shade: K.mottle(0.25, 14), ro: 0.6, sides: 6 }); }
  { const pts = Array.from({ length: 11 }, (_, i) => { const x = lerp(-0.44, 0.4, i / 10) * L; return [x, cy + ry * sc(x) + 0.12 * k, 0.02 * B * Math.sin(i)]; }); carve(pts, pts.map((q, i) => (0.085 + 0.035 * (i % 2)) * k), bone, { shade: K.mottle(0.25, 14), ro: 0.6 }); if (!far) for (let i = 1; i < 10; i += 2) spike(X(pts[i][0], pts[i][1] + 0.05 * k, pts[i][2], 0, 0, 14), 0.3 * k, 0.05 * k, bone); }
  // sinew strung from rib to rib
  if (!lite) for (let i = 0; i < nR - 1; i++) for (const sg of [-1, 1]) for (const a of [0.5, 1.0]) { const A = surf(ribX(i), a), Bq = surf(ribX(i + 1), a + 0.25 * (i % 2 ? 1 : -1)); p.shade(null).ink(sinew, 0.5).tube([[A[0], A[1] + 0.1 * k, sg * (A[2] + 0.14 * k)], [(A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2 + 0.03 * k, sg * ((A[2] + Bq[2]) / 2 + 0.09 * k)], [Bq[0], Bq[1] + 0.1 * k, sg * (Bq[2] + 0.14 * k)]], 0.014 * k, 3); }
  // brass plates bolted into the meat wherever it would take a bolt
  const nPl = far ? 5 : 11;
  for (let i = 0; i < nPl; i++) for (const sg of [-1, 1]) { const x = (hash2(i, sg + 2) - 0.5) * 0.74 * L, a = 0.55 + 0.8 * hash2(i, sg + 5), q = surf(x, a), nrm = norm3([q[0] / (rx * rx), (q[1] - cy) / (ry * ry), q[2] / (rz * rz)]), w = (0.34 + 0.3 * hash2(i, 9)) * k;
    p.push(frame([q[0] + nrm[0] * 0.06 * k, q[1] + nrm[1] * 0.06 * k, sg * (q[2] + nrm[2] * 0.06 * k)], [1, 0, 0], [0, nrm[2], -nrm[1] * sg])); p.shade(K.mottle(0.3, 16)).ink(mul(brass, 0.8 + 0.4 * hash2(i, 4)), 0.4, 0.85).T(0, 0, 0, 0, hash2(i, 6) * 40 - 20, 0).box(w, 0.04 * k, w * (0.6 + 0.4 * hash2(i, 7)), 0.01);
    if (!lite) { p.shade(null).ink(mul(brass, 1.3), 0.3, 0.9); for (const [ax, az] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.T(ax * w * 0.38, 0.03 * k, az * w * 0.24).sphere(0.03 * k, 5, 3); } p.pop(); }
  // a maw at the bow, ringed with teeth; eyes where no eyes should be
  { const mx = rx * 0.93, my = cy + 0.1 * k; p.shade(null).ink(hex(0xb81a1a), 0.5, 0, 0.9).T(mx - 0.03 * L, my, 0, 0, 0, 0, 0.5, 1, 1).sphere(0.42 * k, 9, 6); const nT = far ? 7 : 12; for (let i = 0; i < nT; i++) { const a = (i / nT) * TAU; spike(X(mx - 0.01 * L, my + Math.sin(a) * 0.4 * k, Math.cos(a) * 0.44 * k, 0, 0, -90 + 20 * Math.sin(a)), (0.26 + 0.12 * hash1(i)) * k, 0.06 * k, bone); } }
  for (const [x, a, sg, r] of [[0.3 * L, 0.7, 1, 0.16], [0.22 * L, 0.9, -1, 0.11], [-0.1 * L, 0.5, 1, 0.09], [-0.28 * L, 0.8, -1, 0.13]].slice(0, far ? 2 : 4)) { const q = surf(x, a), nrm = norm3([q[0] / (rx * rx), (q[1] - cy) / (ry * ry), q[2] / (rz * rz)]), c = [q[0] + nrm[0] * 0.03 * k, q[1] + nrm[1] * 0.03 * k, sg * (q[2] + nrm[2] * 0.03 * k)]; p.shade(null).ink(eyeC, 0.2, 0, 1.0).T(c[0], c[1], c[2]).sphere(r * k, 8, 6); p.ink(PITCH, 0.3).T(c[0] + nrm[0] * r * k * 0.7, c[1] + nrm[1] * r * k * 0.7, c[2] + sg * nrm[2] * r * k * 0.7, 0, 0, 0, 0.35, 1, 0.5).sphere(r * k * 0.6, 5, 4); p.ink(mul(flesh, 0.6), 0.5).T(c[0], c[1], c[2], 0, 0, 0).lathe([[r * k * 1.15, -0.02 * k], [r * k * 1.3, 0], [r * k * 1.15, 0.02 * k]], 8); }
  // a brass grating on its back for the crew, braziers at the corners, icons on poles
  const gy = cy + ry * 0.94, gw = 0.3 * L, gd = Math.min(0.42 * B, 2.4);
  p.shade(K.mottle(0.3, 12)).ink(mul(brass, 0.8), 0.45, 0.85).T(-0.04 * L, gy + 0.03 * k, 0).box(gw, 0.07 * k, gd, 0.01); p.shade(null);
  for (const sx of [1, -1]) for (const sz of [1, -1]) { brazier(X(-0.04 * L + sx * gw * 0.46, gy + 0.06 * k, sz * gd * 0.44), 0.38 * k, hex(0x8aff3a)); }
  const icon = (q, h, sd) => { metal(brass, 0.4, 0.85).bar(q, [q[0], q[1] + h, q[2]], 0.03 * k, 0.022 * k, 5, 0); p.push(X(q[0], q[1] + h + 0.16 * k, q[2], 0, sd * 30, 0)); p.T(0, 0, 0, 90, 0, 0).lathe([[0, 0.025 * k], [0.12 * k, 0.025 * k], [0.14 * k, 0], [0.12 * k, -0.025 * k], [0, -0.025 * k]], far ? 6 : 10); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; p.T(Math.cos(a) * 0.13 * k, Math.sin(a) * 0.13 * k, 0, 0, 0, a / DEG - 90).lathe([[0.03 * k, 0], [0, (i % 2 ? 0.16 : 0.26) * k]], 4); } p.ink(hex(0xb81a1a), 0.3, 0, 0.8).T(0, 0, 0.03 * k).sphere(0.05 * k, 6, 4); p.T(0, 0, -0.03 * k).sphere(0.05 * k, 6, 4); p.pop(); };
  icon([0.28 * L, cy + ry * sc(0.28 * L) - 0.05 * k, 0], 0.9 * k, 1); icon([-0.3 * L, cy + ry * sc(0.3 * L) - 0.05 * k, -0.1 * B], 1.2 * k, 2); if (!far) icon([-0.04 * L, gy, gd * 0.5], 0.7 * k, 3);
  // feelers trailing astern
  for (let i = 0; i < 3; i++) { const z = (i - 1) * 0.2 * B, pts = curve([[-rx * 0.9, cy - 0.1 * k, z * 0.6], [-rx * 1.12, -0.1 * k, z], [-rx * 1.3, 0.12 * k * (i % 2 ? 1 : -0.5), z * 1.3 + 0.1 * k], [-rx * 1.46, -0.06 * k, z * 1.1]], 3); carve(pts, pts.map((q, j) => lerp(0.16, 0.025, j / (pts.length - 1)) * k), mul(flesh, 0.8), { shade: K.mottle(0.4, 9), ro: 0.45, sides: 6 }); }
  // the sail: membrane stretched between two spars of horn, veined, lit from behind
  const pos = [[0.02], [0.14, -0.2], [0.2, -0.04, -0.26]][clamp(nm, 1, 3) - 1];
  for (let i = 0; i < Math.min(nm, 3); i++) {
    const x = pos[i] * L, hgt = clamp(0.46 * L + 0.4, 1.6, 5) * [1, 0.8, 0.66][i], y0 = cy + ry * sc(x), sp = clamp(0.5 * B, 0.8, 2.4) * [1, 0.85, 0.7][i];
    const spar = (sg) => curve([[x, y0 - 0.1 * k, sg * 0.1 * B], [x - 0.04 * hgt, y0 + hgt * 0.4, sg * sp * 0.5], [x + 0.02 * hgt, y0 + hgt * 0.8, sg * sp], [x + 0.14 * hgt, y0 + hgt, sg * sp * 0.86]], 4), S0 = spar(-1), S1 = spar(1), nS = S0.length - 1;
    for (const sp2 of [S0, S1]) carve(sp2, sp2.map((q, j) => lerp(0.085, 0.02, j / nS) * k), bone, { shade: K.mottle(0.25, 14), ro: 0.6, sides: 6 });
    const at = (arr, t) => { const f = clamp(t, 0, 1) * nS, a = Math.min(nS - 1, Math.floor(f)); return lerp3(arr[a], arr[a + 1], f - a); };
    const P = (u, v) => { const t = 0.12 + 0.86 * (1 - v), a = at(S0, t), b = at(S1, t), q = lerp3(a, b, u), sag = Math.sin(Math.PI * u); q[0] -= 0.1 * sp * sag * (0.4 + 0.6 * (1 - v)); q[1] -= 0.12 * hgt * sag * (v < 0.1 ? v * 10 : 1) * (1 - 0.5 * v); return q; };
    cloth(P, { us: [0, 0.34, 0.66, 1], colOf: (a) => mul(sick, a === 1 ? 1.05 : 0.9), cell: 0.2, seed: 17 + i, glow: 0.3, ro: 0.5, fine: i === 0 && !!emblem });
    if (!far) { p.shade(null).ink(mix(gore, sick, 0.3), 0.6); for (const u of [0.34, 0.66]) p.tube(Array.from({ length: 6 }, (_, j) => { const q = P(u, j / 5); return [q[0] - 0.012, q[1], q[2]]; }), 0.012 * k, 3); if (!lite) for (let j = 1; j < 5; j++) for (const [ua, ub] of [[0.34, 0.08], [0.66, 0.92], [0.34, 0.5]]) p.tube([P(ua, j / 5), P((ua + ub) / 2, j / 5 - 0.07), P(ub, j / 5 - 0.1)].map((q) => [q[0] - 0.01, q[1], q[2]]), 0.007 * k, 3); }
    if (i === 0) device({ P, N: [-1, 0, 0.001], on: onCloth(P, [-1, 0, 0.001], 0.5, 0.4), size: Math.min(sp * 1.4, hgt * 0.7) }, 0.24);
    addFlag('pennant', at(S1, 1), 0.6);
  }
  staff([-0.3 * L, cy + ry * sc(0.3 * L) + 1.5 * k, -0.1 * B], 0.5 * k, 'ensign', 0.9, -0.1);
  // brass guns grown into its flanks
  const out = [], gl = clamp(0.07 * L, 0.34, 0.62);
  for (let i = 0; i < per; i++) { const x = per === 1 ? 0 : lerp(-0.3, 0.3, i / (per - 1)) * L, q = surf(x, 1.22);
    bothSides(() => { p.shade(null).ink(mul(flesh, 0.55), 0.5).T(q[0], q[1], q[2] - 0.02, 90, 0, 0).lathe([[gl * 0.2, 0], [gl * 0.34, 0.04], [gl * 0.3, 0.12], [gl * 0.16, 0.1]], far ? 6 : 9); deckGun(X(q[0], q[1] - gl * 0.32, q[2] + gl * 0.05), gl, { carriage: false, col: brass, fat: 0.1 }); });
    out.push([q[0], q[1], q[2] + gl * 0.55]); }
  extraMuzzles = out;
}

// ---------- the yard ----------
const BUILDERS = { cog: buildCog, treasureGalleon: buildTreasureGalleon, fluyt: buildFluyt, icebreaker: buildIcebreaker, shroudGalleon: buildShroudGalleon, paddleGalleon: buildPaddleGalleon,
  longship: buildLongship, curragh: buildCurragh, livingSkiff: buildLivingSkiff, solarBarque: buildSolarBarque,
  warGalley: buildWarGalley, razorGalley: buildRazorGalley, dreadGalley: buildDreadGalley, dhow: buildDhow, swanBarge: buildSwanBarge,
  swanGalley: buildSwanGalley, junk: buildJunk, atakebune: buildAtakebune, oxBarge: buildOxBarge,
  dreadnought: buildDreadnought, serpentBarge: buildSerpentBarge, scrapHulk: buildScrapHulk, submersible: buildSubmersible,
  citadelBeast: buildCitadelBeast, hideRaft: buildHideRaft, fleshBarge: buildFleshBarge };
const DEFAULTS = {   // sail, second sail colour, trim, device when the class does not say
  cog: [0xe6dcc0, 0xa8221c, 0xd9a83a, 'lion'], treasureGalleon: [0xeadfc4, 0x8a1f1c, 0xd9a83a, 'cross'], fluyt: [0xe8e0cc, 0x2a4a6a, 0xd9a83a, 'none'], icebreaker: [0xd4dde4, 0x34506a, 0x9aa4b0, 'none'],
  shroudGalleon: [0x121114, 0x2a2a2e, 0x8a7a4a, 'skull'], paddleGalleon: [0xd8cfb8, 0x6a2a22, 0xc9a04a, 'none'],
  longship: [0xe0d8c0, 0xa82a22, 0xd9a83a, 'none'], curragh: [0xc8c0a8, 0x6a7a5a, 0x5ac8e0, 'none'], livingSkiff: [0x5f9a3a, 0xf0a8c8, 0xd9a83a, 'none'], solarBarque: [0xf0e2b0, 0x2a5a8a, 0xe0b040, 'sun'],
  warGalley: [0xe6dcc0, 0xb8362a, 0x9a6a2c, 'lion'], razorGalley: [0x9c1420, 0x1a1a1e, 0x8a8f98, 'none'], dreadGalley: [0x2a1a1a, 0x7a1a14, 0x6a6a70, 'skull'], dhow: [0xf0e8d0, 0xc0502a, 0xc9a04a, 'none'], swanBarge: [0xf0c040, 0xc03a2a, 0xe0b040, 'none'],
  swanGalley: [0xeef0f6, 0xa8c8f0, 0xc9ced6, 'none'], junk: [0xb8442a, 0x8a1f1c, 0xd9a83a, 'dragon'], atakebune: [0xe8e0d0, 0x2a2a30, 0xd9a83a, 'sun'], oxBarge: [0x8a7458, 0x5a4030, 0x6a6a70, 'none'],
  dreadnought: [0xd8d0c0, 0xffa040, 0x9a6a2c, 'none'], serpentBarge: [0xe8e0d0, 0x2a8a5a, 0xd9a83a, 'none'], scrapHulk: [0x8a7a5a, 0x6a3a2a, 0x6a6a70, 'none'], submersible: [0xe8e0d0, 0x2a8a5a, 0xc9a04a, 'none'],
  citadelBeast: [0xe8e0d0, 0xa050f0, 0x8a8f98, 'none'], hideRaft: [0x9a7a5a, 0x6a4a34, 0xd8cfb4, 'none'], fleshBarge: [0xd8b09a, 0x8a2a2a, 0xb08a3a, 'none'],
};
/**
 * buildFleet(kit, def, tier, pen) -> { flags, muzzles, top? }: draws the ship of def.kind into the pen.
 * kit is ships.js's own toolbox; tier 0 is the full model, 1 the middle distance, 2 far off.
 */
export function buildFleet(kit, d, t, pen) {
  K = kit; p = pen; def = d; tier = t; far = K.far; lite = K.lite; eco = K.eco; H = null; st = null; flags = [];
  ({ TAR, HEMP, IRON, GILT, BRASS, DECK, SPAR, OAK, PITCH, GLASS, WHITE, OCHRE, RED, LAMP } = K.PAL); X = K.X; frame = K.frame;
  L = d.len; B = d.beam; per = Math.max(0, d.cannons?.perSide | 0); nm = Math.max(0, d.sails | 0);
  const D = DEFAULTS[d.kind] || [0xe8e2d0, 0x9c2f22, 0xd9a83a, 'none'], ghost = d.kind === 'shroudGalleon' && d.ghost;
  CH = hex(d.color ?? 0x6b4a2e); CS = hex(d.sail ?? (ghost ? 0xc8e6d2 : D[0])); CS2 = hex(d.sail2 ?? D[1]); CT = hex(d.trim ?? D[2]);
  if (ghost && lumOf(CS) < 0.3) CS = mix(CS, hex(0xc8e6d2), 0.78);   // a ghost's canvas is pale whatever it was dyed in life
  const sat = Math.max(...CT) - Math.min(...CT);
  CTp = sat < 0.06 && lumOf(CT) < 0.12 ? [0.5, 0.8] : [0.38, 0.85];   // trim is metal: gold, silver, bronze, black iron
  const em = d.emblem ?? D[3]; emblem = em === 'none' || !em ? null : em;
  const fl = BUILDERS[d.kind]() || [];
  const out = { flags: fl === flags ? flags : [...fl, ...flags.filter((f) => !fl.includes(f))], muzzles: st && st.muzzles ? st.muzzles : [] };
  if (extraMuzzles) { out.muzzles = extraMuzzles; extraMuzzles = null; }
  if (topY !== null) { out.top = topY; topY = null; }
  K = p = def = H = st = null;
  return out;
}
let extraMuzzles = null, topY = null;
