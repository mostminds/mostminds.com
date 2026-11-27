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
const BRONZE = hex(0x9a6a2c), SILVER = hex(0xc9ced6), BONE = hex(0xd8cfb4), HIDE = hex(0x7a5a3c), STONE = hex(0x8f8a7c), OBSID = hex(0x17141c), FIRE = hex(0xff6a1e), GHOST = hex(0x6cff9a), ICE = hex(0xa8dcff), LEAF = hex(0x4f8a34);
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
  return K.styleFor(def, tier, { base,
    pre: (s, o, C, v) => { C.trim = CT; C.sail = CS; pre(s, o, C, v); },
    mid: (s, o, C) => { s.device = emblem; if (more.mid) more.mid(s, o, C); },
    rig: more.rig, post: more.post });
}
/** run the kit's pipeline for a style, leaving out the stages in `skip`; sets H; returns the rigger's flags */
function launch(s, skip = null) { st = s; const fl = K.buildSailingShip(def, s, p, skip); H = s.H; return fl; }
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
    const arm = add3(c, dirY, e * w * 0.47), q = railPt(clamp(M.s - Math.max(0.2, 1.2 / L), 0.03, 0.97), 0.02);
    K.rope(p, arm, up, 0.0055, HEMP, 0, 3);
    K.rope(p, arm, [q[0], q[1], e * q[2]], 0.0055, HEMP, 0.03 * dist3(arm, q), 3);
    if (!o.rag) { const cl = sl.clews[e > 0 ? 1 : 0], a = railPt(clamp(M.s - 0.7 / L, 0.02, 0.98), 0.02); K.rope(p, cl, [a[0], a[1], e * a[2]], 0.007, HEMP, 0.05, 3); }
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
  bothSides(() => {
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
function wisp(a, b, R, turns, col, seed = 0, r = 0.02) {
  const n = far ? 8 : 20, pts = [], rad = [], ax = norm3(sub3(b, a)), ex = norm3(cross(ax, [0.3, 1, 0.2])), ez = cross(ax, ex);
  for (let i = 0; i <= n; i++) { const t = i / n, ang = seed + t * turns * TAU, rr = R * Math.sin(Math.PI * Math.pow(t, 0.8)) * (0.7 + 0.3 * Math.sin(t * 9 + seed)), q = lerp3(a, b, t); pts.push(add3(add3(q, ex, Math.cos(ang) * rr), ez, Math.sin(ang) * rr)); rad.push(r * Math.sin(Math.PI * t) + 0.002); }
  p.shade(null).ink(col, 0.6, 0, 1.0).tube(pts, rad, 4);
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

// ---------- dressing shared by the sailing ships ----------
/** forget the gun ports that `drop(port)` says are in the way (of a paddle wheel, say) */
function dropPorts(s, drop) {
  s.ports = s.ports.filter((q) => !drop(q)); s.openPorts = s.openPorts.filter((q) => !drop(q));
  for (const k of Object.keys(s.holes)) delete s.holes[k];
  for (const q of s.ports) for (let j = q.rows[0]; j <= q.rows[1]; j++) (s.holes[`${q.band}${j}`] ||= []).push([q.s - q.hw, q.s + q.hw]);
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
    p.shade(K.mottle(0.3, 20)).ink(mul(mix(CH, BONE, 0.35), 0.75), 0.9);
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

// ---------- 1. cog ----------
function buildCog() {
  const k = sizeK(6.5);
  const s = style('galleon', (s, o, C, v) => {
    Object.assign(o, { draft: 0.5 * k, fb: 0.62 * k, sheerF: 0.34 * k, sheerA: 0.3 * k, tumble: 0, rakeF: 0.07 * L, stemE: 1.1, rakeA: 0.06, deckE: 0.62, midE: 0.8, tWl: 0.25, tMid: 0.55, tDeck: 0.64, leanMin: -0.06, leanMax: 0.12,
      segs: [{ s0: 0, s1: 0.28, lift: 1.0 * k, bul: 0.4 }, { s0: 0.28, s1: 0.79, lift: 0, bul: 0.47 }, { s0: 0.79, s1: 1, lift: 0.9 * k, bul: 0.4 }] });
    s.lap = 0.013; s.plank = 3.4;
    v.walesC = []; v.portsC = null; v.portRows = [2, 3]; v.spread = [0.31, 0.77];
    C.accent = mix(CH, WHITE, 0.3); C.upper = CS2; C.top = mul(CH, 0.5); C.inner = mul(CH, 1.1); C.wale = mul(CH, 0.45); C.bottom = hex(0x3a2c22);
  }, {
    mid: (s, o, C) => { s.stern = { quarterPieces: [0, 0.9 * k], trim: C.accent }; s.head = null; s.chW = 0.1; },
    rig: (R) => { R.masts = nm <= 1 ? (nm ? [{ s: 0.5, hf: 1, rake: 0, type: 'square', parts: 2, sq: 1 }] : []) : nm === 2 ? [{ s: 0.5, hf: 1, rake: 0, type: 'square', parts: 2, sq: 1 }, { s: 0.14, hf: 0.62, rake: 3, type: 'lateen', parts: 1 }] : [{ s: 0.88, hf: 0.6, rake: -3, type: 'square', parts: 1, sq: 1 }, { s: 0.5, hf: 1, rake: 0, type: 'square', parts: 2, sq: 1 }, { s: 0.14, hf: 0.62, rake: 3, type: 'lateen', parts: 1 }];
      R.sprit = nm ? { len: 0.15 * L, steeve: 30, inboard: 0.1 * L } : null; R.jibs = 0; R.tops = 'basket'; R.shrouds = 4; R.truck *= 1.04; },
    post: (s, o, C) => {
      // the castles are painted in the lord's two colours, band over band
      s.rowD = (j, g, last) => (g.lift > 0.3 && j * s.sw >= g.lift - 0.03 ? { col: () => (last ? CT : (Math.floor((j * s.sw - g.lift) / 0.17) % 2 ? CS : CS2)), proud: last ? 0.006 : 0, vary: 0.05 } : last ? { col: () => C.top, proud: 0.006, vary: 0.05 } : { col: () => C.hull, proud: 0, vary: 0.07 });
      s.sqSail = sailBy((o2) => (o2.wFoot > B ? quarters() : stripes(4)));
      s.triSail = (pen, o2) => { const tp = triP({ tack: o2.tack, peak: o2.head, clew: o2.clew, belly: o2.belly }); cloth(tp.P, { seed: 3, ...stripes(5) }); return tp; };
      s.bulkCol = mul(CS2, 0.8); s.balCol = CT;
    } });
  const fl = launch(s);
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
      s.balCol = CT;
    } });
  const fl = launch(s);
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
    const cols = H.between(0.74, 1), nr = far ? 3 : 6, f0 = p.n;
    p.shade(K.mottle(0.3, 16)).ink(plateC, 0.5, 0.75);
    p.grid(cols.length - 1, nr, (i, j, out) => { const ss = cols[i], edge = 0.02 * L * hash2(j, 3) / L, s2 = i === 0 ? ss + edge : ss, q = H.pt(s2, lerp(-d * 0.96, y1(s2), j / nr), 0.024); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
      (i, j) => mul(plateC, (0.8 + 0.4 * hash2(i >> 1, j)) * (j === 0 ? 0.6 : 1)));
    p.shade(null);
    void f0;
  });
  straps([0.78, 0.84, 0.9, 0.95], () => -d * 0.9, (ss) => y1(ss) + 0.02, 0.06, hex(0x202227));
  rivets(0.75, 0.985, (ss) => y1(ss) - 0.03, 0.13, hex(0x8a8f98)); rivets(0.75, 0.985, () => H.yS + 0.04, 0.13, hex(0x8a8f98));
  // the ram: a ploughshare of iron bolted over the stem, saw-edged above the water
  const xs = (y) => H.x(1, y), rl = clamp(0.085 * L, 0.4, 1.0), yt = H.yGun(1) + 0.3;
  const ram = [[xs(-d) - 0.3, -d - 0.06], [xs(-d * 0.5) + rl * 0.6, -d * 0.55], [xs(0) + rl, -0.05], [xs(0.1) + rl * 0.96, 0.12]];
  const teeth = 5; for (let i = 0; i < teeth; i++) { const t0 = i / teeth, t1 = (i + 0.55) / teeth, ya = lerp(0.12, yt, t0), yb = lerp(0.12, yt, t1), yc = lerp(0.12, yt, (i + 1) / teeth); ram.push([xs(yb) + lerp(rl * 0.86, 0.2, t1) + 0.1, yb], [xs(yc) + lerp(rl * 0.9, 0.16, (i + 1) / teeth), yc]); void ya; }
  ram.push([xs(yt) - 0.1, yt + 0.05], [xs(0) - 0.1, 0]);
  p.shade(K.mottle(0.3, 12)).ink(hex(0x30333a), 0.45, 0.8).extrude(ram, clamp(0.02 * L, 0.1, 0.2), false);
  p.shade(null).ink(hex(0x8a8f98), 0.4, 0.85);
  if (!lite) for (let i = 0; i < 6; i++) { const y = lerp(-d * 0.4, yt - 0.1, i / 5); for (const sg of [-1, 1]) p.T(xs(y) + 0.08, y, sg * clamp(0.01 * L, 0.05, 0.1) * 1.02).sphere(0.022, 5, 3); }
  // figurehead: a burst of frost crystal over the ram
  const fx = xs(yt) + 0.12, fy = yt + 0.1, ck = clamp(L / 8.5, 0.6, 1.3);
  for (const [rx, rz, h, r] of [[-62, 0, 0.62, 0.085], [-40, 22, 0.4, 0.06], [-40, -22, 0.4, 0.06], [-84, 14, 0.36, 0.05], [-84, -14, 0.36, 0.05], [-18, 0, 0.3, 0.05], [-58, 40, 0.26, 0.04], [-58, -40, 0.26, 0.04]].slice(0, far ? 3 : 8))
    crystal(X(fx, fy, 0, rz, 0, rx, ck), h, r, ICE, 1.0);
  // furs slung over the stern and the quarters
  const g0 = H.segs[0], fur = hex(0x5a4330), top = H.railY(0, g0) + st.capH, zt = H.z(0, top);
  drape(Array.from({ length: 9 }, (_, i) => [H.x(0, top) - 0.03, top + 0.03, lerp(-zt, zt, i / 8)]), 0.7 * k, fur, { fur: true, out: [-1, 0, 0], rag: 0.35, seed: 3, bulge: 0.05, lean: 0.14 });
  for (const sg of [1, -1]) { const pts = railLine(g0, 6, 0.035, st.capH + 0.02).map((q) => [q[0], q[1], sg * q[2]]); drape(pts, 0.5 * k, sg > 0 ? fur : hex(0x8a8274), { fur: true, out: [0, 0, sg], rag: 0.4, seed: sg + 5, bulge: 0.05, lean: 0.03 }); }
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
      hullHole(s, 0.33, 2, Math.min(5, s.nC - 2), 0.75 * k); hullHole(s, 0.635, 1, Math.min(4, s.nC - 2), 0.6 * k); if (L > 6) hullHole(s, 0.84, 3, Math.min(5, s.nC - 2), 0.4 * k);
      const cl = (o2) => (ghost ? { col: CS, rag: 0.42, ragN: 9, glow: 0.5, ro: 0.8 } : { col: CS, rag: 0.5, ragN: 9, glow: 0.02 });
      s.sqSail = sailBy(cl);
      s.triSail = (pen, o2) => { const tp = triP({ tack: o2.tack, peak: o2.head, clew: o2.clew, belly: o2.belly }); cloth(tp.P, { seed: 4, ...cl(o2), rag: 0.3 }); return tp; };
    } });
  const fl = launch(s);
  ribsBehind();
  const lamp = (q, h = 0.2) => { p.shade(null).ink(IRON, 0.6, 0.7).bar(q, [q[0], q[1] + h * 0.5, q[2]], 0.01, 0.01, 4, 0); p.ink(GHOST, 0.3, 0, 1.6).T(q[0], q[1] - h * 0.3, q[2], 0, 0, 0, 1, 1.25, 1).sphere(h * 0.36, 7, 5); p.ink(IRON, 0.6, 0.7).T(q[0], q[1] + h * 0.06, q[2]).lathe([[h * 0.4, 0], [h * 0.12, h * 0.2], [0, h * 0.24]], 6); };
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
      dropPorts(s, (q) => Math.abs(q.s - sW) < (R * 1.2) / s.L);
    } });
  const fl = launch(s), yw = R * 0.3, zw = H.z(sW, 0.3) + R * 0.2 + 0.02, w = clamp(0.34 * R + 0.1, 0.3, 0.7), xw = H.x(sW, 0.3);
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
  if (!far) for (const sg of [-1, 1]) { const m = funnel(dq[0] + fr * 3.4, dq[1], sg * fr * 1.5, fh * 0.36, fr * 0.3, { band: BRASS, rake: 0, bands: [0.9] }); void m; }
  return fl;
}

// ---------- the yard ----------
const BUILDERS = { cog: buildCog, treasureGalleon: buildTreasureGalleon, fluyt: buildFluyt, icebreaker: buildIcebreaker, shroudGalleon: buildShroudGalleon, paddleGalleon: buildPaddleGalleon };
const DEFAULTS = {   // sail, second sail colour, trim, device when the class does not say
  cog: [0xe6dcc0, 0xa8221c, 0xd9a83a, 'lion'], treasureGalleon: [0xeadfc4, 0x8a1f1c, 0xd9a83a, 'cross'], fluyt: [0xe8e0cc, 0x2a4a6a, 0xd9a83a, 'none'], icebreaker: [0xd4dde4, 0x34506a, 0x9aa4b0, 'none'],
  shroudGalleon: [0x121114, 0x2a2a2e, 0x8a7a4a, 'skull'], paddleGalleon: [0xd8cfb8, 0x6a2a22, 0xc9a04a, 'none'],
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
  const sat = Math.max(...CT) - Math.min(...CT);
  CTp = sat < 0.06 && lumOf(CT) < 0.12 ? [0.5, 0.8] : [0.38, 0.85];   // trim is metal: gold, silver, bronze, black iron
  const em = d.emblem ?? D[3]; emblem = em === 'none' || !em ? null : em;
  const fl = BUILDERS[d.kind]() || [];
  const out = { flags: fl === flags ? flags : [...fl, ...flags.filter((f) => !fl.includes(f))], muzzles: st && st.muzzles ? st.muzzles : [] };
  if (out._m) out.muzzles = out._m;
  if (extraMuzzles) { out.muzzles = extraMuzzles; extraMuzzles = null; }
  if (topY !== null) { out.top = topY; topY = null; }
  K = p = def = H = st = null;
  return out;
}
let extraMuzzles = null, topY = null;
