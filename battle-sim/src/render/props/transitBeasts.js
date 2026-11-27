// Pack beasts for the savage peoples' supply caravans: one sculpted animal per faction, each with its own tack,
// panniers and stores.
//   buildPackBeast(look, sideColor, index) -> Object3D   (+x forward, feet on y = 0, origin under its middle)
//     userData.body  everything that bobs          userData.legs  [{ piv, ph }, ...] hip pivots that swing about z
//     userData.len   nose-to-tail spacing          userData.beast true
// Each faction's geometry is sculpted once (sculpt.js blended volumes plus low-poly hard pieces) and cached; later
// beasts reuse it. A beast is 7-9 meshes: body, side-coloured cloth, the load (three variants) and one per leg.
import * as THREE from 'three';
import { S, H, buildPartGeometry, sculptMaterial, distanceField } from '../sculpt.js';

const PI = Math.PI;
const MZ = new THREE.Matrix4().makeScale(1, 1, -1);
const _ca = new THREE.Color(), _cb = new THREE.Color();
const shade = (c, k) => { _ca.set(c).multiplyScalar(k); _ca.r = Math.min(1, _ca.r); _ca.g = Math.min(1, _ca.g); _ca.b = Math.min(1, _ca.b); return _ca.getHex(); };
const mix = (a, b, t) => _ca.set(a).lerp(_cb.set(b), t).getHex();
const flat = (l) => l.flat(Infinity).filter(Boolean);
const mir = (q) => { const c = q.clone(); c.m.premultiply(MZ); return c; };
/** the list plus its mirror image across the beast's mid-plane (z = 0) */
const both = (...l) => { const a = flat(l); return [...a, ...a.map(mir)]; };
/** move a whole list: scale, then rotate (degrees), then translate */
const T = (l, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => flat([l]).map((q) => { if (s !== 1) q.scale(s); if (rx || ry || rz) q.rot(rx, ry, rz); return q.at(x, y, z); });
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---- sculpt shorthands ---------------------------------------------------------------------
const el = (rx, ry, rz, x, y, z, c, k = 0.08) => S.ellipsoid(rx, ry, rz).at(x, y, z).color(c).blend(k);
const cap = (a, b, ra, rb, c, k = 0.08) => S.capsule(a, b, ra, rb).color(c).blend(k);
const sph = (r, x, y, z, c, k = 0.06) => S.sphere(r).at(x, y, z).color(c).blend(k);
const limb = (pts, radii, c, k = 0.06) => S.limb(pts, radii).map((p) => p.color(c).blend(k));

// ---- low-poly hard pieces ------------------------------------------------------------------
const facet = (g) => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; };
const G = {
  ball: (r, w = 7, h = 5) => H.geo(new THREE.SphereGeometry(r, w, h)),
  cone: (r, h, n = 5) => H.geo(new THREE.ConeGeometry(r, h, n)),
  cyl: (a, b, h, n = 8) => H.geo(new THREE.CylinderGeometry(a, b, h, n)),
  box: (w, h, d) => H.geo(new THREE.BoxGeometry(w, h, d)),
  tor: (R, r, seg = 12, tube = 5) => H.geo(new THREE.TorusGeometry(R, r, tube, seg)),
  tube: (pts, rad, tub = 10, radial = 5, closed = false) => H.tube(pts, rad, tub, radial, closed),
  gem: (r, h, n = 5) => H.geo(facet(new THREE.ConeGeometry(r, h, n))),
  rock: (r, d = 0) => H.geo(facet(new THREE.DodecahedronGeometry(r, d))),
  octa: (r) => H.geo(facet(new THREE.OctahedronGeometry(r))),
};
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _m4 = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);
/** stand a piece (built along +y from its origin) at p pointing along d */
const aim = (h, p, d) => { _q.setFromUnitVectors(_up, _v.set(d[0], d[1], d[2]).normalize()); h.m.premultiply(_m4.compose(new THREE.Vector3(p[0], p[1], p[2]), _q, _one)); return h; };
const spike = (p, d, r, len, c, n = 5) => aim(G.cone(r, len, n).at(0, len / 2, 0), p, d).color(c).pbr(0.55);
const crystal = (p, d, r, len, c, glow = 0.9) => aim(G.gem(r, len, 5).at(0, len / 2, 0), p, d).color(c).pbr(0.2).glow(glow);
/** an elliptical hoop lying flat (axis y) */
const hoop = (rx, rz, r, y = 0, seg = 18) => { const pts = []; for (let i = 0; i < 10; i++) { const t = (i / 10) * PI * 2; pts.push([Math.cos(t) * rx, y, Math.sin(t) * rz]); } return G.tube(pts, r, seg, 5, true); };
const BONE = 0xe8e0c8, ROPE = 0xa98f5c, WOOD = 0x7a5a36, WOODD = 0x4e3820, LEATHER = 0x5a3a22, IRON = 0x5a5a62, SACK = 0xb8a888, CRATE = 0xa07a4a;
const eye = (r, x, y, z, c = 0x120c08, glow = 0) => both(G.ball(r, 8, 6).at(x, y, z).color(c).pbr(0.15).glow(glow));
const feather = (len, c, tip = null, w = 0.16) => { const g = G.cone(len * w, len, 4).scale(0.3, 1, 1).at(0, len / 2, 0).color(c).pbr(0.7); if (tip !== null) g.shade((x, y) => (y > 0 ? tip : null)); return g; };
const leaf = (r, c) => G.octa(r).scale(1, 0.25, 0.6).color(c).pbr(0.7);
const skull = (s = 1, horns = false, c = BONE) => T([
  G.ball(0.1, 8, 6).scale(1.05, 0.9, 0.86).color(c).pbr(0.6), G.cyl(0.036, 0.06, 0.15, 6).rot(0, 0, -90).scale(1, 0.8, 1).at(0.12, -0.035, 0).color(shade(c, 0.92)).pbr(0.6),
  both(G.ball(0.03, 5, 4).at(0.065, 0.0, 0.062).color(0x1a1410)), G.box(0.02, 0.03, 0.03).at(0.17, -0.03, 0).color(0x1a1410),
  horns ? both(G.tube([[-0.02, 0.05, 0.06], [-0.05, 0.12, 0.2], [0.04, 0.24, 0.27]], [0.032, 0.022, 0.004], 6, 5).color(shade(c, 0.85))) : [],
], 0, 0, 0, 0, 0, 0, s);

// ---- stores (each sits on y = 0 at its own origin) -------------------------------------------
const sack = (r, c = SACK) => [G.ball(r, 9, 6).scale(1, 0.8, 1).at(0, r * 0.72, 0).color(c).pbr(0.95), G.cone(r * 0.34, r * 0.4, 6).rot(180, 0, 0).at(0, r * 1.62, 0).color(shade(c, 0.85)).pbr(0.95), G.tor(r * 0.16, r * 0.05, 8, 4).rot(90, 0, 0).at(0, r * 1.46, 0).color(ROPE)];
const crate = (w, h = w * 0.8, c = CRATE) => [G.box(w, h, w).at(0, h / 2, 0).color(c).pbr(0.9), G.box(w * 1.04, h * 0.14, w * 1.04).at(0, h * 0.2, 0).color(shade(c, 0.7)), G.box(w * 1.04, h * 0.14, w * 1.04).at(0, h * 0.8, 0).color(shade(c, 0.7))];
const jar = (r, h, c = 0xb86a3a, lid = 0x6a4a2e) => [H.lathe([[r * 0.55, 0], [r, h * 0.3], [r * 0.95, h * 0.6], [r * 0.5, h * 0.85], [r * 0.6, h]], 9).color(c).pbr(0.6), G.cyl(r * 0.62, r * 0.62, h * 0.08, 8).at(0, h * 1.02, 0).color(lid)];
const roll = (r, len, c, tie = ROPE) => T([G.cyl(r, r, len, 9).color(c).pbr(0.95), G.tor(r * 1.03, r * 0.1, 9, 4).rot(90, 0, 0).at(0, len * 0.28, 0).color(tie), G.tor(r * 1.03, r * 0.1, 9, 4).rot(90, 0, 0).at(0, -len * 0.28, 0).color(tie)], 0, r, 0, 0, 0, 90);
const barrel = (r, h, c = 0x8a623a, band = IRON) => [H.lathe([[r * 0.8, 0], [r, h * 0.3], [r, h * 0.7], [r * 0.8, h]], 10).shade((x, y) => (Math.abs(y - h * 0.22) < h * 0.07 || Math.abs(y - h * 0.78) < h * 0.07 ? band : null)).color(c).pbr(0.8), G.cyl(r * 0.8, r * 0.8, 0.02, 10).at(0, h, 0).color(shade(c, 0.8))];
const egg = (r, c, spot = null) => { const g = G.ball(r, 9, 7).scale(1, 1.3, 1).at(0, r * 1.2, 0).color(c).pbr(0.45); if (spot !== null) g.shade((x, y, z, nx, ny, nz, i) => ((i * 7) % 5 === 0 ? spot : null)); return g; };
const haunch = (s = 1) => T([G.ball(0.13, 8, 6).scale(1.5, 0.9, 0.9).at(0, 0.11, 0).color(0x8a2a22).pbr(0.6), G.cyl(0.025, 0.025, 0.24, 5).rot(0, 0, 90).at(0.26, 0.11, 0).color(BONE), G.ball(0.04, 5, 4).at(0.39, 0.11, 0).color(BONE)], 0, 0, 0, 0, 0, 0, s);
const rope = (pts, r = 0.012, c = ROPE, tub = 10) => G.tube(pts, r, tub, 4).color(c).pbr(0.95);

/** a woven pannier: an oval tub of basketwork (local origin at its middle, +z is the outer face) */
function woven(rx, rz, h, o = {}) {
  const { seg = 22, rows = 9, taper = 0.76, bulge = 0.06, weave = 0.012, a = 0xb8904e, b = 0x8a6a3a, pat = null, rim = 0x6a4a2e, rimR = 0.028 } = o;
  const pos = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows, k = taper + (1 - taper) * v + bulge * Math.sin(PI * v);
    for (let i = 0; i <= seg; i++) { const t = ((i % seg) / seg) * PI * 2, w = 1 + (((i + j) & 1 ? weave : -weave) / Math.min(rx, rz)); pos.push(Math.cos(t) * rx * k * w, (v - 0.5) * h, Math.sin(t) * rz * k * w); }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) { const p = j * (seg + 1) + i, q = p + seg + 1; idx.push(p, q, p + 1, q, q + 1, p + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return [
    H.geo(g).shade((x, y, z, nx, ny, nz, i) => { const j = Math.floor(i / (seg + 1)), ii = (i % (seg + 1)) % seg; return pat ? pat(ii, j, seg, rows) : (ii + j) & 1 ? a : b; }).pbr(0.95),
    hoop(rx, rz, rimR, h / 2, 20).color(rim).pbr(0.85),
    G.cyl(1, 1, 0.02, 12).scale(rx * taper, 1, rz * taper).at(0, -h / 2, 0).color(shade(b, 0.7)),
    G.cyl(1, 1, 0.02, 12).scale(rx * 0.96, 1, rz * 0.96).at(0, h / 2 - 0.07, 0).color(0x241a12),
  ];
}

// ---- reading the sculpted body so tack can lie on it ----------------------------------------------
function mkK(df, yc) {
  /** distance from the body axis (x, yc, 0) out to the hide, at ang radians round from straight up toward +z */
  const surf = (x, ang, y0 = yc) => { const dy = Math.cos(ang), dz = Math.sin(ang); let t = 2.6; for (let i = 0; i < 40; i++) { const d = df(x, y0 + dy * t, dz * t); if (d < 0.003) break; t -= d * 0.9; if (t <= 0) return 0; } return t; };
  const K = {
    df, yc, surf,
    top: (x) => yc + surf(x, 0),
    half: (x, y) => { let t = 1.8; for (let i = 0; i < 40; i++) { const d = df(x, y, t); if (d < 0.003) break; t -= d * 0.9; if (t <= 0) return 0; } return t; },
    /** a strip of cloth or leather lying on the hide between x0..x1 and angles a0..a1 (radians from the top) */
    wrap(o) {
      const { x0, x1, a0, a1, nx = 8, na = 16, off = 0.022, hem = null, y0 = yc } = o;
      const pos = [], idx = [];
      for (let i = 0; i <= nx; i++) {
        const u = i / nx, x = x0 + (x1 - x0) * u;
        for (let j = 0; j <= na; j++) { let a = a0 + ((a1 - a0) * j) / na; if (hem) a *= hem(u); const t = surf(x, a, y0) + off; pos.push(x, y0 + Math.cos(a) * t, Math.sin(a) * t); }
      }
      for (let i = 0; i < nx; i++) for (let j = 0; j < na; j++) { const p = i * (na + 1) + j, q = p + na + 1; idx.push(p, p + 1, q, q, p + 1, q + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    },
    /** the saddle blanket, in white so the side's colour shows true; darker border, a bright inner stripe */
    blanket(x0, x1, halfDeg, o = {}) {
      const nx = o.nx || 10, na = o.na || 20, style = o.style || 0;
      const g = K.wrap({ x0, x1, a0: (-halfDeg * PI) / 180, a1: (halfDeg * PI) / 180, nx, na, off: o.off ?? 0.022, hem: o.hem });
      return H.geo(g).shade((x, y, z, nX, nY, nZ, i) => {
        const iu = Math.floor(i / (na + 1)), ia = i % (na + 1), e = Math.min(iu, nx - iu), h = Math.min(ia, na - ia), m = Math.min(e, h);
        let k = 1;
        if (m === 0) k = 0.45; else if (m === 1) k = 1.5; else if (style === 1 && (iu + ia) % 4 === 0) k = 0.62; else if (style === 2 && ia % 4 === 2) k = 0.6; else if (style === 3 && (iu % 3 === 0 || ia % 5 === 0)) k = 0.66;
        return [k, k, k];
      }).pbr(0.9);
    },
    /** a girth strap right round the body at x */
    girth: (x, w = 0.07, c = LEATHER, off = 0.034) => H.geo(K.wrap({ x0: x - w / 2, x1: x + w / 2, a0: -PI, a1: PI, nx: 1, na: 30, off })).color(c).pbr(0.8),
  };
  return K;
}

/** the pack rig: two girths, two crossbars over the back and slings to the pannier rims. Returns the anchors. */
function rig(K, o) {
  const { xc, brx, brz, bh, drop = 0.1, strap = LEATHER, bar = WOOD, max = 0.95, sling = ROPE, noBar = false } = o;
  const ytop = K.top(xc), yrim = ytop - drop, yb = yrim - bh / 2, zb = Math.min(max - brz, K.half(xc, yb) + brz * 0.8);
  const hard = [];
  for (const dx of [-brx * 0.62, brx * 0.62]) {
    const x = xc + dx, yt = K.top(x) + 0.05;
    hard.push(K.girth(x, 0.07, strap));
    if (!noBar) hard.push(G.cyl(0.028, 0.028, zb * 2 + 0.12, 6).rot(90, 0, 0).at(x, yt, 0).color(bar).pbr(0.85));
    for (const s of [-1, 1]) hard.push(rope([[x, yt, s * (zb - brz * 0.7)], [x, yrim + 0.01, s * (zb - brz * 0.92)]], 0.012, sling, 2), rope([[x, yt, s * zb], [x, yrim + 0.01, s * (zb + brz * 0.9)]], 0.012, sling, 2));
  }
  return { hard, A: { xc, ytop, yrim, yb, zb, brx, brz, bh, ybar: ytop + 0.08 } };
}
/** put a pannier (or its contents) on each flank; fn(s) builds one in pannier space, +z outward */
const flanks = (A, y, fn) => [T(fn(1), A.xc, y, A.zb), T(fn(-1), A.xc, y, -A.zb, 0, 180, 0)];
/** rope lashings over whatever rides on top */
const lash = (A, xs, h, c = ROPE) => xs.map((dx) => rope([[A.xc + dx, A.yrim, -A.zb + A.brz * 0.5], [A.xc + dx, A.ybar + h * 0.8, -0.2], [A.xc + dx, A.ybar + h, 0], [A.xc + dx, A.ybar + h * 0.8, 0.2], [A.xc + dx, A.yrim, A.zb - A.brz * 0.5]], 0.013, c, 12));

// ---- legs (local: pivot at the origin, the leg hangs to y = -Hh; built for the +z side) -------------------
function hoofLeg(Hh, r, C, o = {}) {
  const hind = !!o.hind, kx = hind ? -0.09 * (o.bend ?? 1) : 0.03, hoofH = o.hoofH ?? 0.11, ky = -Hh * (hind ? 0.5 : 0.54), fy = -Hh + hoofH;
  const up = o.up ?? 1.5;
  const p = [
    cap([0, 0.14, 0], [kx * 0.4, -Hh * 0.28, 0], r * up, r * 1.08, C.hide, 0.04),
    hind ? el(r * 1.9, Hh * 0.26, r * 1.25, -0.03, -Hh * 0.1, 0, C.hide, 0.06) : el(r * 1.5, Hh * 0.22, r * 1.2, 0.02, -Hh * 0.1, 0, C.hide, 0.06),
    cap([kx * 0.4, -Hh * 0.28, 0], [kx, ky, 0], r * 1.08, r * 0.8, C.hide, 0.04),
    sph(r * 0.88, kx + (hind ? -0.01 : 0.015), ky, 0, C.leg, 0.03),
    cap([kx, ky, 0], [0.0, fy + 0.05, 0], r * 0.72, r * 0.62, C.leg, 0.03),
    sph(r * 0.8, 0.0, fy + 0.05, 0, C.leg, 0.03),
    S.cone(r * 1.08, r * 0.8, hoofH, 0.012).at(0.025, -Hh + hoofH / 2, 0).color(C.hoof).pbr(0.45).blend(0.012),
  ];
  if (o.shag) p.push(el(r * 1.25, hoofH * 1.1, r * 1.25, 0, fy + 0.08, 0, C.shag ?? C.dark, 0.03).bump(0.02, 9, 'fur'));
  if (o.fur) for (const q of p.slice(0, 3)) q.bump(o.fur, 9, 'fur');
  return { prims: p, hard: o.hard || [] };
}
function clawLeg(Hh, r, C, o = {}) {
  const hind = !!o.hind, out = o.out ?? 0.24, kx = hind ? 0.14 : -0.1, fz = out + 0.04, n = o.claws ?? 3;
  const p = [
    cap([0, 0.04, -0.06], [kx, -Hh * 0.28, out * 0.8], r * 1.5, r * 1.1, C.hide, 0.05),
    sph(r * 1.05, kx, -Hh * 0.28, out * 0.8, C.hide, 0.04),
    cap([kx, -Hh * 0.28, out * 0.8], [0.02, -Hh + r * 0.9, fz], r * 0.95, r * 0.7, C.leg ?? C.hide, 0.04),
    el(r * 1.5, r * 0.62, r * 1.15, 0.09, -Hh + r * 0.55, fz, C.leg ?? C.hide, 0.04),
  ];
  if (o.scales) for (const q of p) q.bump(o.scales, 7, 'scales');
  const h = [];
  for (let i = 0; i < n; i++) { const a = (i - (n - 1) / 2) * 0.5; h.push(spike([0.16 + Math.cos(a) * r * 0.9, -Hh + r * 0.5, fz + Math.sin(a) * r * 1.1], [Math.cos(a), -0.45, Math.sin(a)], r * 0.3, r * 1.3, C.claw ?? 0x241c16)); }
  return { prims: p, hard: [h, o.hard || []] };
}

// ---- shared anatomy ------------------------------------------------------------------------------
/** a hoofed animal's trunk: barrel, chest, rump, and the shoulder and haunch muscles standing off it */
function torso(C, o) {
  const { xs, xh, y, ch, ba, ru } = o;
  const p = flat([
    el(ba[0], ba[1], ba[2], (xs + xh) / 2 + (ba[4] || 0), y + (ba[3] || 0), 0, C.hide, 0),
    el(ch[0], ch[1], ch[2], xs, y + (ch[3] || 0), 0, C.hide, 0.12),
    el(ru[0], ru[1], ru[2], xh, y + (ru[3] || 0), 0, C.hide, 0.12),
    both(el(ch[0] * 0.52, ch[1] * 0.72, ch[2] * 0.42, xs + 0.03, y + (ch[3] || 0) - ch[1] * 0.2, ch[2] * 0.74, C.hide, 0.07)),
    both(el(ru[0] * 0.7, ru[1] * 0.8, ru[2] * 0.42, xh - 0.02, y + (ru[3] || 0) - ru[1] * 0.12, ru[2] * 0.74, C.hide, 0.07)),
  ]);
  if (o.fur) for (const q of p) q.bump(o.fur, o.furF || 8, 'fur');
  if (o.tint) for (const q of p) q.tint(o.tint, 5);
  return p;
}
/** a cattle head in its own frame (poll at the origin, muzzle along +x); returns { p, h } */
function bovHead(C, o = {}) {
  const s = o.s ?? 1, horn = o.horn, hr = o.hornR ?? [0.055, 0.045, 0.03, 0.008];
  const p = [
    el(0.2, 0.2, 0.19, 0, 0, 0, C.hide, 0.08),
    cap([0.06, -0.03, 0], [0.37, -0.13, 0], 0.165, 0.118, C.hide, 0.06),
    cap([0.0, -0.15, 0], [0.3, -0.21, 0], 0.1, 0.075, C.hide, 0.05),
    el(0.085, 0.085, 0.125, 0.44, -0.15, 0, C.muzzle, 0.04),
    both(el(0.075, 0.045, 0.06, 0.1, 0.11, 0.12, C.hide, 0.03)),
    el(0.1, 0.075, 0.2, -0.05, 0.17, 0, C.dark, 0.05),
  ];
  const h = [
    eye(0.03, 0.15, 0.06, 0.165, o.eye ?? 0x120c08, o.eyeGlow || 0),
    both(G.ball(0.022, 5, 4).scale(1, 0.7, 1).at(0.515, -0.12, 0.05).color(0x1a1210)),
    both(G.ball(0.1, 7, 5).scale(0.5, 0.3, 1).rot(-20, 20, 0).at(-0.08, 0.07, 0.26).color(C.dark).pbr(0.9)),
    horn ? both(G.tube(horn, hr, 14, 7).shade((x, y, z, nx, ny, nz, i) => (i > 15 * 8 * 0.62 ? C.hornTip : null)).color(C.horn).pbr(0.45)) : [],
  ];
  return { p: T(p, 0, 0, 0, 0, 0, 0, s), h: T(h, 0, 0, 0, 0, 0, 0, s) };
}
/** a lizard or drake head in its own frame (muzzle along +x) */
function reptHead(C, o = {}) {
  const s = o.s ?? 1, len = o.len ?? 0.5;
  const p = flat([
    el(0.2, 0.15, 0.19, 0, 0, 0, C.hide, 0.08),
    cap([0.1, -0.02, 0], [len, -0.05, 0], 0.14, 0.085, C.hide, 0.06),
    cap([0.0, -0.11, 0], [len - 0.06, -0.13, 0], 0.1, 0.06, C.belly, 0.04),
    both(el(0.1, 0.045, 0.055, 0.1, 0.12, 0.115, C.dark, 0.03)),
  ]);
  if (o.scales) for (const q of p) q.bump(o.scales, 9, 'scales');
  const h = [
    eye(0.032, 0.14, 0.085, 0.15, o.eye ?? 0xe8b020, o.eyeGlow ?? 0.5),
    both(G.ball(0.014, 5, 4).scale(0.5, 1.4, 1).at(0.165, 0.085, 0.168).color(0x0a0806)),
    both(G.ball(0.016, 5, 4).at(len + 0.05, 0.0, 0.045).color(0x140e0c)),
  ];
  const nt = o.teeth ?? 5;
  for (let i = 0; i < nt; i++) h.push(both(spike([len - 0.02 - i * 0.07, -0.085, 0.06 + i * 0.012], [0.1, -1, 0.15], 0.012, 0.05, 0xf0e8d0, 4)));
  return { p: T(p, 0, 0, 0, 0, 0, 0, s), h: T(h, 0, 0, 0, 0, 0, 0, s) };
}
/** a row of hanging locks along a shaggy hem */
const locks = (x0, x1, y, z, n, len, c, r = 0.05) => { const out = []; for (let i = 0; i < n; i++) { const u = i / (n - 1), w = 0.8 + ((i * 37) % 10) / 20; out.push(G.cone(r, len * w, 4).rot(180, 0, 0).at(x0 + (x1 - x0) * u, y - (len * w) / 2, z + (i % 2) * 0.02).color(i % 3 ? c : shade(c, 0.8)).pbr(0.95)); } return out; };
/** small things strung along a line */
const strung = (a, b, n, fn, sag = 0.06) => { const out = [rope([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag, (a[2] + b[2]) / 2], b], 0.008, 0x3a2a1c, 6)]; for (let i = 0; i < n; i++) { const u = (i + 0.5) / n, s = sag * 4 * u * (1 - u); out.push(T(fn(i), a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - s, a[2] + (b[2] - a[2]) * u)); } return out; };

const DEFS = {};
const fourLegs = (front, hind, xs, xh, y, z, yh = y, zh = z) => [
  { x: xs, y, z: -z, ph: 0, part: front, flip: true }, { x: xs, y, z, ph: PI, part: front },
  { x: xh, y: yh, z: -zh, ph: PI, part: hind, flip: true }, { x: xh, y: yh, z: zh, ph: 0, part: hind }];
/** ordinary stores for one pannier, three mixes */
function stores(v, o = {}) {
  const sc = o.sack ?? SACK, cr = o.crate ?? CRATE, jr = o.jar ?? 0xb86a3a, k = o.k ?? 1;
  switch (((v % 3) + 3) % 3) {
    case 0: return T([T(sack(0.17, sc), -0.17, 0, 0.0), T(sack(0.14, shade(sc, 0.85)), 0.17, 0, 0.03), T(jar(0.07, 0.2, jr), 0.02, 0.02, -0.1)], 0, 0, 0, 0, 0, 0, k);
    case 1: return T([T(crate(0.25, 0.2, cr), -0.15, 0, 0, 0, 14, 0), T(sack(0.14, sc), 0.18, 0, -0.02), T(roll(0.06, 0.3, o.roll ?? 0x8a5a3a), 0.16, 0.2, 0.0, 0, 70, 0)], 0, 0, 0, 0, 0, 0, k);
    default: return T([T(jar(0.085, 0.24, jr), -0.2, 0, 0.02), T(jar(0.075, 0.21, shade(jr, 0.8)), 0.0, 0, -0.06), T(jar(0.08, 0.22, mix(jr, 0xd8c8a0, 0.4)), 0.2, 0, 0.03), T(sack(0.1, sc), 0.02, 0, 0.1)], 0, 0, 0, 0, 0, 0, k);
  }
}
const pennant = (w, h, k = 1) => H.sheet(w, h, 4, 3, (u, v) => [0, -u * h * 0.12, Math.sin(u * 5) * w * 0.08]).shade((x, y) => { const t = Math.abs(y) > h * 0.36 ? 0.5 : 1; return [t * k, t * k, t * k]; }).pbr(0.9);

// ============================================================================================
//  the wild tribes' ox: shaggy-shouldered, lyre-horned, daubed with ochre, hung with bone and feather
// ============================================================================================
DEFS.beasts = (L) => {
  const hide = L.hide ?? 0x6a4a32;
  const C = { hide, dark: shade(hide, 0.6), belly: mix(hide, 0xd8c8a8, 0.4), muzzle: mix(hide, 0xe6d8c0, 0.65), leg: shade(hide, 0.75), hoof: 0x2a221c, horn: 0xe6dcc0, hornTip: 0x3a3026 };
  const yc = 1.08, paint = 0xc23c1e, pale = 0xece4d2, HX = 1.2, HY = yc + 0.2, HP = -28;
  const hd = bovHead(C, { horn: [[-0.06, 0.13, 0.12], [-0.09, 0.2, 0.34], [0.0, 0.36, 0.5], [0.14, 0.58, 0.5]] });
  hd.p.push(S.box(0.05, 0.3, 0.6).at(0.27, -0.02, 0).color(pale).paint(0.01), S.box(0.04, 0.3, 0.6).at(0.19, 0.0, 0).color(paint).paint(0.01));
  let A;
  return {
    yc, res: 22, len: 2.45,
    prims: [
      torso(C, { xs: 0.52, xh: -0.6, y: yc, ch: [0.42, 0.46, 0.37, 0.02], ba: [0.64, 0.42, 0.4, -0.02], ru: [0.4, 0.42, 0.37, 0.04], tint: 0.18 }),
      el(0.3, 0.17, 0.2, 0.46, yc + 0.37, 0, C.dark, 0.12).bump(0.025, 9, 'fur'),
      cap([0.72, yc + 0.12, 0], [1.08, yc + 0.2, 0], 0.31, 0.22, C.hide, 0.1),
      el(0.2, 0.16, 0.06, 0.88, yc - 0.2, 0, C.hide, 0.1),
      T(hd.p, HX, HY, 0, 0, 0, HP),
      S.ellipsoid(0.85, 0.2, 0.36).at(-0.05, yc - 0.42, 0).color(C.belly).paint(0.1),
      [-0.86, -0.74, -0.62].map((x) => S.box(0.05, 0.42, 1.4).rot(0, 0, 20).at(x, yc - 0.02, 0).color(paint).paint(0.012)),
      both(S.sphere(0.13).at(0.62, yc + 0.02, 0.4).color(pale).paint(0.012), S.sphere(0.075).at(0.63, yc + 0.02, 0.44).color(paint).paint(0.01)),
    ],
    legs: fourLegs(hoofLeg(0.92, 0.115, C), hoofLeg(0.92, 0.112, C, { hind: true }), 0.52, -0.6, 0.92, 0.25),
    hard(K) {
      const r = rig(K, { xc: -0.05, brx: 0.4, brz: 0.24, bh: 0.46 }); A = r.A;
      const out = [r.hard, T(hd.h, HX, HY, 0, 0, 0, HP)];
      // nose ring, feathers on the horns, a collar of bone charms
      out.push(T([G.tor(0.05, 0.011, 10, 4).rot(0, 90, 0).at(0.5, -0.2, 0).color(BONE), both(T([feather(0.26, 0xd8d0c0, 0x2a2018), T(feather(0.22, paint, 0x2a2018), 0, 0, 0, 0, 0, 25)], 0.0, 0.36, 0.5, 150, 0, 0))], HX, HY, 0, 0, 0, HP));
      out.push(K.girth(0.9, 0.07, LEATHER));
      for (const a of [-2.2, -1.75, -1.3, 1.3, 1.75, 2.2]) { const t = K.surf(0.9, a) + 0.04; out.push(spike([0.9, yc + Math.cos(a) * t, Math.sin(a) * t], [0, -1, Math.sin(a) * 0.3], 0.022, 0.13, BONE, 4)); }
      // tail with a dark tuft
      out.push(G.tube([[-0.96, yc + 0.3, 0], [-1.1, yc + 0.1, 0], [-1.13, yc - 0.4, 0], [-1.09, yc - 0.66, 0]], [0.05, 0.035, 0.025, 0.02], 8, 5).color(C.hide), G.cone(0.07, 0.3, 6).rot(180, 0, 0).at(-1.08, yc - 0.8, 0).color(C.dark).pbr(0.95));
      // wicker panniers rimmed with hide, bone toggles down the outer face
      out.push(flanks(A, A.yb, () => [woven(A.brx, A.brz, A.bh, { rim: 0x5a3a22, rimR: 0.034 }), [-0.2, 0, 0.2].map((x) => spike([x, 0.06, A.brz + 0.03], [0, -1, 0.15], 0.02, 0.14, BONE, 4)), G.tube([[-0.3, 0.08, A.brz * 0.86], [0, 0.07, A.brz + 0.03], [0.3, 0.08, A.brz * 0.86]], 0.012, 8, 4).color(0x3a2a1c)]));
      // a horned skull on the front bar and a feathered pole behind
      out.push(T(skull(1.25, true), A.xc + A.brx * 0.62 + 0.1, A.ybar + 0.1, 0, 0, 0, -12));
      out.push(G.cyl(0.02, 0.025, 1.0, 5).rot(0, 0, 12).at(A.xc - A.brx * 0.62 - 0.12, A.ybar + 0.45, 0).color(WOODD), T([feather(0.3, paint, 0x1a1410), T(feather(0.26, 0xe8e0d0, 0x1a1410), 0, 0, 0, 0, 0, 30), T(feather(0.24, 0x3a6a8a, 0x1a1410), 0, 0, 0, 30, 0, -20)], A.xc - A.brx * 0.62 - 0.2, A.ybar + 0.9, 0, 0, 0, 100));
      return out;
    },
    side(K) { return [K.blanket(-0.56, 0.44, 104, { style: 1 }), T(pennant(0.34, 0.2), A.xc - A.brx * 0.62 - 0.36, A.ybar + 0.72, 0)]; },
    load(K, i) {
      const y = A.yrim - 0.07, out = [flanks(A, y, (s) => stores(i + (s > 0 ? 0 : 1), { roll: 0x8a5a3a }))];
      const yb = A.ybar + 0.03;
      if (i === 0) out.push(T(roll(0.11, 0.62, 0x7a5a3c), A.xc - 0.02, yb, 0.13, 90, 0, 0), T(roll(0.1, 0.56, 0xa08a66), A.xc - 0.04, yb, -0.12, 90, 0, 0), T(roll(0.09, 0.5, 0x5a4030), A.xc, yb + 0.17, 0.0, 90, 0, 0), lash(A, [-0.14, 0.12], 0.4));
      else if (i === 1) out.push(T(crate(0.3, 0.24), A.xc - 0.1, yb, 0, 0, 12, 0), T(sack(0.16), A.xc + 0.17, yb, 0.08), T(sack(0.13, 0x9a8a6a), A.xc + 0.15, yb, -0.14), lash(A, [-0.1], 0.28));
      else out.push(T(sack(0.19), A.xc - 0.12, yb, 0.02), T(sack(0.16, 0xa89878), A.xc + 0.18, yb, -0.04), T(roll(0.07, 0.7, 0x6a4a30), A.xc, yb + 0.1, 0.24, 90, 0, 0), T(haunch(1), A.xc - 0.1, yb + 0.02, -0.24, 0, 20, 0), lash(A, [0.02], 0.36));
      return out;
    },
  };
};

// ============================================================================================
//  the cloven herds' aurochs: black, hump-shouldered, horns swept forward, a skull totem at its back
// ============================================================================================
const axe = (len = 0.7, c = IRON) => T([G.cyl(0.018, 0.02, len, 5).color(WOODD), G.box(0.17, 0.2, 0.025).at(0.09, len * 0.4, 0).color(c).pbr(0.55, 0.4), G.box(0.05, 0.26, 0.012).at(0.19, len * 0.4, 0).color(shade(c, 1.5)).pbr(0.4, 0.5)], 0, 0, 0, 0, 0, 90);
DEFS.cloven = (L) => {
  const hide = L.hide ?? 0x3a2a22, red = 0xb01e12;
  const C = { hide, dark: shade(hide, 0.55), belly: shade(hide, 0.85), muzzle: mix(hide, 0x8a7a6a, 0.5), leg: shade(hide, 0.7), hoof: 0x15110e, horn: 0xcfc4a4, hornTip: 0x1a1612, shag: shade(hide, 0.5) };
  const yc = 1.1, HX = 1.24, HY = yc + 0.1, HP = -36;
  const hd = bovHead(C, { s: 1.12, eye: 0xff4a1a, eyeGlow: 1, hornR: [0.085, 0.075, 0.06, 0.035, 0.008], horn: [[-0.08, 0.13, 0.13], [-0.1, 0.24, 0.36], [0.1, 0.3, 0.5], [0.38, 0.34, 0.45], [0.6, 0.5, 0.33]] });
  hd.p.push(S.box(0.3, 0.05, 0.6).at(0.2, 0.06, 0).color(red).paint(0.012), el(0.12, 0.14, 0.09, 0.14, -0.3, 0, C.dark, 0.05).bump(0.02, 10, 'fur'));
  let A;
  return {
    yc, res: 20, len: 2.55,
    prims: [
      torso(C, { xs: 0.55, xh: -0.62, y: yc, ch: [0.46, 0.52, 0.4, 0.06], ba: [0.66, 0.42, 0.39, -0.02], ru: [0.37, 0.39, 0.34, 0.0], tint: 0.15 }),
      el(0.38, 0.28, 0.27, 0.5, yc + 0.5, 0, C.dark, 0.14).bump(0.035, 8, 'fur'),
      cap([0.75, yc + 0.2, 0], [1.1, yc + 0.14, 0], 0.36, 0.26, C.dark, 0.1).bump(0.03, 8, 'fur'),
      T(hd.p, HX, HY, 0, 0, 0, HP),
      // blood runes daubed down the flanks
      [[-0.66, 24], [-0.54, -24], [-0.42, 24]].map(([x, a]) => S.box(0.055, 0.34, 1.4).rot(0, 0, a).at(x - 0.14, yc + 0.02, 0).color(red).paint(0.012)),
      both(S.torus(0.15, 0.03).rot(90, 0, 0).at(0.62, yc + 0.04, 0.4).color(red).paint(0.012), S.box(0.04, 0.4, 0.2).at(0.62, yc + 0.04, 0.4).color(red).paint(0.012)),
    ],
    legs: fourLegs(hoofLeg(0.94, 0.11, C, { shag: true }), hoofLeg(0.94, 0.105, C, { hind: true, shag: true }), 0.55, -0.62, 0.94, 0.25),
    hard(K) {
      const r = rig(K, { xc: -0.08, brx: 0.4, brz: 0.23, bh: 0.48, strap: 0x2a1c14, bar: WOODD, sling: 0x2a1c14, max: 0.88 }); A = r.A;
      const out = [r.hard, T(hd.h, HX, HY, 0, 0, 0, HP)];
      out.push(T([G.tor(0.06, 0.014, 10, 5).rot(0, 90, 0).at(0.56, -0.24, 0).color(0xb08a3a).pbr(0.35, 0.9)], HX, HY, 0, 0, 0, HP));
      out.push(locks(0.72, 1.12, yc - 0.12, 0, 6, 0.34, C.shag), locks(0.76, 1.08, yc - 0.06, 0.13, 5, 0.28, C.shag), locks(0.76, 1.08, yc - 0.06, -0.13, 5, 0.28, C.shag));
      out.push(G.tube([[-0.95, yc + 0.22, 0], [-1.08, yc + 0.05, 0], [-1.1, yc - 0.4, 0], [-1.06, yc - 0.62, 0]], [0.05, 0.035, 0.025, 0.02], 8, 5).color(C.hide), G.cone(0.08, 0.34, 6).rot(180, 0, 0).at(-1.05, yc - 0.78, 0).color(C.shag).pbr(0.95));
      // panniers of raw hide stretched on stakes, a skull on each
      const hidePat = (i, j) => { const k = ((i >> 2) * 7 + (j >> 2) * 13) % 4; return [0x6a4a34, 0x5a3c2a, 0x7a5a40, 0x4a3224][k]; };
      out.push(flanks(A, A.yb, () => [woven(A.brx, A.brz, A.bh, { weave: 0.004, pat: hidePat, rim: 0x2a1c14, rimR: 0.03 }),
        [[-0.36, 0.1], [0.36, 0.1], [-0.2, 0.22], [0.2, 0.22]].map(([x, z]) => [G.cyl(0.02, 0.024, A.bh + 0.24, 5).at(x, 0.08, z).color(WOODD), spike([x, A.bh / 2 + 0.18, z], [0, 1, 0], 0.022, 0.09, BONE, 4)]),
        T(skull(0.7), 0, 0.02, A.brz + 0.02, 0, -90, 0), rope([[-0.34, 0.12, A.brz * 0.8], [0, 0.1, A.brz + 0.02], [0.34, 0.12, A.brz * 0.8]], 0.012, 0x2a1c14, 8)]));
      // the herd totem: a stake crowned with a horned skull, lesser skulls and rags swinging from its yard
      const tx = A.xc - A.brx * 0.62 - 0.02, ty = A.ybar;
      out.push(G.cyl(0.028, 0.036, 1.25, 6).at(tx, ty + 0.55, 0).color(WOODD), T(skull(1.5, true), tx + 0.03, ty + 1.24, 0), G.cyl(0.02, 0.02, 0.9, 5).rot(90, 0, 0).at(tx, ty + 0.92, 0).color(WOODD));
      for (const s of [-1, 1]) out.push(rope([[tx, ty + 0.92, s * 0.4], [tx, ty + 0.74, s * 0.4]], 0.008, 0x2a1c14, 2), T(skull(0.6), tx, ty + 0.68, s * 0.4, 0, s * 30, 0), T(feather(0.22, red, 0x1a1410), tx, ty + 0.92, s * 0.26, 180, 0, s * 10), T(feather(0.2, 0x2a2420, 0x8a8070), tx, ty + 0.92, s * 0.14, 180, 0, -s * 14));
      for (const dx of [-0.06, 0.04]) out.push(spike([A.xc + A.brx * 0.62 + dx, A.ybar, 0.2], [0.2, 1, 0.3], 0.025, 0.2, BONE, 4), spike([A.xc + A.brx * 0.62 + dx, A.ybar, -0.2], [0.2, 1, -0.3], 0.025, 0.2, BONE, 4));
      return out;
    },
    side(K) {
      const tx = A.xc - A.brx * 0.62 - 0.02;
      return [K.blanket(-0.6, 0.44, 100, { style: 3, hem: (u) => 0.9 + 0.1 * Math.abs(Math.sin(u * 14)) }),
        H.sheet(0.44, 0.5, 6, 5, (u, v) => [0, v < 0.25 ? -Math.abs(Math.sin(u * 16)) * 0.1 : 0, Math.sin(u * 4 + v * 3) * 0.03]).shade((x, y) => { const k = y > 0.17 ? 0.5 : 1; return [k, k, k]; }).rot(0, 90, 0).at(tx - 0.03, A.ybar + 0.62, 0).pbr(0.95)];
    },
    load(K, i) {
      const y = A.yrim - 0.07, yb = A.ybar + 0.03, xc = A.xc + 0.06;
      const bones = (s) => [T(skull(0.8), -0.16, 0.1, 0, 0, 40 * s, 0), T(skull(0.7, true), 0.14, 0.09, 0.03, 0, -70, 20), T(haunch(0.9), 0.0, 0.0, -0.08, 0, 20, 0)];
      const out = [flanks(A, y, (s) => ((i + (s > 0 ? 0 : 1)) % 3 === 0 ? bones(s) : stores(i + (s > 0 ? 1 : 0), { sack: 0x8a7a5a, crate: 0x6a4a30, jar: 0x5a3a2a, roll: 0x4a3224 })))];
      if (i === 0) out.push(T(roll(0.12, 0.6, 0x5a3c2a, 0x2a1c14), xc, yb, 0.13, 90, 0, 0), T(roll(0.11, 0.56, 0x7a5a40, 0x2a1c14), xc, yb, -0.12, 90, 0, 0), T(axe(0.74), xc - 0.3, yb + 0.24, 0.02, 0, 8, 0), T(axe(0.7), xc - 0.28, yb + 0.26, -0.08, 0, -10, 0), lash(A, [0.02, 0.24], 0.3, 0x2a1c14));
      else if (i === 1) out.push(T(haunch(1.5), xc - 0.06, yb, 0.1, 0, 15, 0), T(haunch(1.3), xc - 0.02, yb, -0.14, 0, 200, 0), T(skull(1.1), xc + 0.2, yb + 0.3, 0, 0, 0, -10), T(sack(0.15, 0x8a7a5a), xc + 0.26, yb, 0.02), lash(A, [0.0], 0.3, 0x2a1c14));
      else out.push(T(crate(0.3, 0.24, 0x6a4a30), xc + 0.1, yb, 0, 0, -10, 0), T(roll(0.1, 0.5, 0x5a3c2a, 0x2a1c14), xc + 0.1, yb + 0.25, 0, 90, 0, 0), T(axe(0.8), xc - 0.36, yb + 0.05, 0.2, 0, 4, 0), T(axe(0.76), xc - 0.34, yb + 0.05, -0.2, 0, -4, 0), lash(A, [0.1], 0.46, 0x2a1c14));
      return out;
    },
  };
};

// ============================================================================================
//  the gorge-tribes' yak: a wall of shag under a cook-pot, hung with the tribe's dinner
// ============================================================================================
DEFS.gorge = (L) => {
  const hide = L.hide ?? 0x4a3a2c, red = 0x9a2a1a;
  const C = { hide, dark: shade(hide, 0.62), belly: shade(hide, 0.8), muzzle: mix(hide, 0xd8c8b0, 0.6), leg: shade(hide, 0.75), hoof: 0x1c1612, horn: 0xd8ceb0, hornTip: 0x2a2018, shag: shade(hide, 0.7) };
  const yc = 1.06, HX = 1.16, HY = yc + 0.02, HP = -40;
  const hd = bovHead(C, { s: 1.05, hornR: [0.06, 0.05, 0.035, 0.008], horn: [[-0.05, 0.14, 0.12], [-0.06, 0.16, 0.4], [-0.02, 0.36, 0.56], [-0.12, 0.6, 0.48]] });
  hd.p.push(el(0.16, 0.12, 0.2, 0.06, 0.16, 0, C.shag, 0.05).bump(0.03, 9, 'fur'));
  let A;
  return {
    yc, res: 18, len: 2.5,
    prims: [
      torso(C, { xs: 0.5, xh: -0.6, y: yc, ch: [0.44, 0.48, 0.38, 0.04], ba: [0.66, 0.44, 0.4, 0], ru: [0.4, 0.42, 0.37, 0.0], fur: 0.025, furF: 7, tint: 0.2 }),
      el(0.36, 0.26, 0.26, 0.42, yc + 0.46, 0, C.dark, 0.14).bump(0.035, 7, 'fur'),
      cap([0.7, yc + 0.1, 0], [1.05, yc + 0.02, 0], 0.34, 0.26, C.hide, 0.1).bump(0.03, 7, 'fur'),
      both(S.box(1.36, 0.6, 0.14, 0.06).at(-0.05, yc - 0.34, 0.36).color(C.shag).blend(0.1).bump(0.04, 7, 'fur')),
      S.box(0.5, 0.42, 0.5, 0.1).at(0.72, yc - 0.34, 0).color(C.shag).blend(0.1).bump(0.04, 7, 'fur'),
      el(0.16, 0.34, 0.16, -1.02, yc - 0.12, 0, C.dark, 0.08).bump(0.04, 7, 'fur'),
      T(hd.p, HX, HY, 0, 0, 0, HP),
    ],
    legs: fourLegs(hoofLeg(0.9, 0.115, C, { shag: true, fur: 0.02 }), hoofLeg(0.9, 0.11, C, { hind: true, shag: true, fur: 0.02 }), 0.5, -0.6, 0.9, 0.25),
    hard(K) {
      const r = rig(K, { xc: -0.05, brx: 0.4, brz: 0.23, bh: 0.5, strap: 0x33261c, bar: WOODD, sling: 0x4a4a52 }); A = r.A;
      const out = [r.hard, T(hd.h, HX, HY, 0, 0, 0, HP)];
      // an iron face-plate with a tusk either side
      out.push(T([G.cyl(0.13, 0.13, 0.025, 10).rot(0, 0, 62).at(0.2, 0.13, 0).color(IRON).pbr(0.6, 0.35), G.ball(0.035, 6, 4).at(0.215, 0.15, 0).color(0x8a8a92).pbr(0.45, 0.5), both(spike([0.3, -0.16, 0.13], [0.5, 0.6, 0.5], 0.03, 0.2, BONE))], HX, HY, 0, 0, 0, HP));
      for (const s of [-1, 1]) out.push(locks(-0.68, 0.58, yc - 0.6, s * 0.42, 12, 0.3, C.shag, 0.06));
      out.push(locks(0.52, 0.92, yc - 0.52, 0.12, 4, 0.3, C.shag, 0.06), locks(0.52, 0.92, yc - 0.52, -0.12, 4, 0.3, C.shag, 0.06), locks(-1.08, -0.98, yc - 0.4, 0, 3, 0.36, C.dark, 0.07));
      // iron-bound tubs with a gut-plate hung on the outside
      const stave = (i) => (i % 3 === 0 ? 0x4a3422 : i % 3 === 1 ? 0x6a4a2e : 0x5a4028);
      out.push(flanks(A, A.yb, () => [woven(A.brx, A.brz, A.bh, { weave: 0.003, taper: 0.86, bulge: 0.04, pat: (i, j, n, m) => (j === 2 || j === m - 2 ? IRON : stave(i >> 1)), rim: IRON, rimR: 0.03 }),
        G.cyl(0.17, 0.17, 0.03, 10).rot(90, 0, 0).at(0, -0.02, A.brz + 0.035).color(0x4a4a52).pbr(0.6, 0.35), G.ball(0.05, 6, 4).scale(1, 1, 0.5).at(0, -0.02, A.brz + 0.06).color(0x8a8a92).pbr(0.45, 0.5),
        [-1, 1].map((s) => spike([s * 0.27, -0.1, A.brz * 0.86], [s * 0.3, 0.9, 0.5], 0.035, 0.26, BONE))]));
      // the cook-pot rides behind, a pair of great tusks lashed upright before it
      const px = A.xc - A.brx * 0.62 - 0.02, py = A.ybar + 0.02;
      out.push(H.lathe([[0.1, 0], [0.24, 0.06], [0.28, 0.2], [0.24, 0.34], [0.27, 0.37]], 12).at(px, py, 0).color(0x2a2a2e).pbr(0.6, 0.35), G.cyl(0.235, 0.235, 0.02, 12).at(px, py + 0.31, 0).color(0x6a4a2a).pbr(0.4), G.tube([[px, py + 0.3, 0.1], [px - 0.1, py + 0.5, 0.2], [px - 0.16, py + 0.62, 0.26]], 0.014, 4, 4).color(WOODD), spike([px + 0.05, py + 0.28, -0.1], [0.2, 1, -0.3], 0.03, 0.3, BONE));
      for (const s of [-1, 1]) out.push(G.tube([[A.xc + A.brx * 0.62, A.ybar - 0.04, s * 0.2], [A.xc + A.brx * 0.62 + 0.05, A.ybar + 0.3, s * 0.3], [A.xc + A.brx * 0.62 + 0.0, A.ybar + 0.62, s * 0.2], [A.xc + A.brx * 0.62 - 0.1, A.ybar + 0.8, s * 0.06]], [0.06, 0.05, 0.035, 0.008], 10, 6).color(BONE).pbr(0.5));
      return out;
    },
    side(K) {
      return [K.blanket(-0.58, 0.42, 96, { style: 2 }), [-1, 1].map((s) => H.sheet(0.16, 0.44, 2, 4, (u, v) => [0, 0, Math.sin(v * 3) * 0.03]).rot(0, 90, 0).at(A.xc + A.brx * 0.62, A.ybar + 0.3, s * 0.34).pbr(0.95))];
    },
    load(K, i) {
      const y = A.yrim - 0.07, yb = A.ybar + 0.03, xc = A.xc + 0.1;
      const meat = (s) => [T(haunch(1.25), -0.1, 0, 0.0, 0, 25, -20), T(haunch(1.1), 0.1, 0.03, -0.03, 0, 150, -15), T(sack(0.12, 0x9a8a6a), 0.22, 0, 0.06)];
      const out = [flanks(A, y, (s) => ((i + (s > 0 ? 0 : 1)) % 2 === 0 ? meat(s) : stores(i + (s > 0 ? 1 : 2), { sack: 0x9a8a6a, crate: 0x5a4028, jar: 0x4a4a52 })))];
      if (i === 0) out.push(T(barrel(0.15, 0.36), xc, yb + 0.15, 0, 90, 0, 0), T(haunch(1.5), xc - 0.02, yb + 0.3, 0.02, 0, 80, 0), lash(A, [0.1], 0.36, 0x3a3a40));
      else if (i === 1) out.push(T(sack(0.2, 0x9a8a6a), xc - 0.04, yb, 0.08), T(sack(0.17, 0x8a7a5a), xc + 0.1, yb, -0.14), T(haunch(1.3), xc, yb + 0.3, 0, 0, 30, 10), lash(A, [0.02], 0.34, 0x3a3a40));
      else out.push(T(crate(0.32, 0.26, 0x5a4028), xc, yb, 0, 0, 8, 0), T(barrel(0.11, 0.26), xc - 0.02, yb + 0.27, 0.0), lash(A, [0.12], 0.3, 0x3a3a40));
      return out;
    },
  };
};

// ============================================================================================
//  the northern raiders' mammoth: pale and frost-hung, banded tusks, shields along its stave tubs
// ============================================================================================
function pillarLeg(Hh, r, C, o = {}) {
  const kx = o.hind ? -0.06 : 0.03;
  const p = [cap([0, 0.2, 0], [kx, -Hh * 0.5, 0], r * 1.3, r * 1.02, C.hide, 0.05), cap([kx, -Hh * 0.5, 0], [0, -Hh + r * 1.05, 0], r * 1.02, r * 0.95, C.hide, 0.05), S.cone(r * 1.22, r * 0.98, r * 1.1, 0.04).at(0.02, -Hh + r * 0.55, 0).color(C.leg).blend(0.04)];
  if (o.fur) for (const q of p.slice(0, 2)) q.bump(o.fur, 6, 'fur');
  const h = [-0.6, 0, 0.6].map((a) => G.ball(r * 0.3, 5, 3).scale(1, 0.9, 1).at(0.02 + Math.cos(a) * r * 1.12, -Hh + r * 0.28, Math.sin(a) * r * 1.12).color(C.nail ?? 0xd8d0b8).pbr(0.5));
  if (o.shag) for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.283; h.push(G.cone(r * 0.55, Hh * 0.3, 4).rot(180, 0, 0).at(kx * 0.6 + Math.cos(a) * r * 0.95, -Hh * 0.36 - (i % 2) * 0.05, Math.sin(a) * r * 0.95).color(i % 2 ? o.shag : shade(o.shag, 0.85)).pbr(0.95)); }
  return { prims: p, hard: [h, o.hard || []] };
}
const shield = (r) => [G.cyl(r, r, 0.03, 10).rot(90, 0, 0).color(0x6a4a2e).pbr(0.8), G.tor(r, 0.018, 10, 3).color(IRON).pbr(0.6, 0.35), G.ball(r * 0.28, 6, 3).scale(1, 1, 0.6).at(0, 0, 0.02).color(0x8a8a92).pbr(0.45, 0.5)];
DEFS.fimbul = (L) => {
  const hide = L.hide ?? 0xb8b0a0, ice = 0xbfe6ff, rune = 0x3a6a9a;
  const C = { hide, dark: mix(hide, 0x5a4636, 0.55), belly: shade(hide, 0.85), leg: mix(hide, 0x5a4636, 0.4), shag: mix(hide, 0x6a5440, 0.5), nail: 0xe8e0c8 };
  const yc = 1.78, X = -0.18;
  const tusk = [[1.36 + X, yc - 0.1, 0.2], [1.62 + X, yc - 0.8, 0.3], [2.0 + X, yc - 1.02, 0.36], [2.38 + X, yc - 0.7, 0.3], [2.46 + X, yc - 0.28, 0.18]];
  let A;
  return {
    yc, res: 13, legRes: 12.5, len: 3.6,
    prims: [
      torso(C, { xs: 0.62 + X, xh: -0.72 + X, y: yc, ch: [0.6, 0.72, 0.55, 0.1], ba: [0.88, 0.62, 0.58, 0.0], ru: [0.55, 0.6, 0.52, -0.06], fur: 0.06, furF: 4, tint: 0.35 }),
      el(0.5, 0.3, 0.42, 0.42 + X, yc + 0.62, 0, C.dark, 0.2).bump(0.06, 4, 'fur'),
      el(0.42, 0.44, 0.42, 1.2 + X, yc + 0.42, 0, C.hide, 0.16).bump(0.03, 5, 'fur'),
      el(0.27, 0.22, 0.26, 1.2 + X, yc + 0.8, 0, C.dark, 0.14).bump(0.04, 6, 'fur'),
      el(0.3, 0.3, 0.3, 1.45 + X, yc + 0.2, 0, C.hide, 0.12),
      S.limb([[1.5 + X, yc + 0.15, 0], [1.74 + X, yc - 0.4, 0], [1.8 + X, yc - 0.95, 0], [1.9 + X, yc - 1.36, 0], [2.08 + X, yc - 1.42, 0]], [0.22, 0.17, 0.13, 0.1, 0.075]).map((p) => p.color(C.dark).blend(0.07).bump(0.014, 11, 'ridges')),
      both(el(0.14, 0.16, 0.12, 1.4 + X, yc - 0.06, 0.2, C.hide, 0.06)),
      both(S.box(1.7, 0.75, 0.16, 0.07).at(-0.05 + X, yc - 0.45, 0.5).color(C.shag).blend(0.14).bump(0.05, 5, 'fur')),
      S.box(0.5, 0.5, 0.7, 0.14).at(0.95 + X, yc - 0.45, 0).color(C.shag).blend(0.14).bump(0.05, 5, 'fur'),
      S.ellipsoid(1.7, 0.8, 0.9).at(-0.1 + X, yc + 0.6, 0).color(C.dark).paint(0.3), S.ellipsoid(0.3, 0.5, 0.8).at(0.62 + X, yc - 0.1, 0).color(C.shag).paint(0.2),
      // snow lying on the crown and rump
      S.ellipsoid(0.3, 0.14, 0.3).at(1.2 + X, yc + 0.98, 0).color(0xf4f8ff).paint(0.08), S.ellipsoid(0.4, 0.2, 0.4).at(-1.0 + X, yc + 0.5, 0).color(0xf4f8ff).paint(0.1),
    ],
    legs: fourLegs(pillarLeg(1.3, 0.2, C, { fur: 0.04, shag: C.shag }), pillarLeg(1.26, 0.19, C, { hind: true, fur: 0.04, shag: C.shag }), 0.62 + X, -0.72 + X, 1.3, 0.32, 1.26, 0.3),
    hard(K) {
      const r = rig(K, { xc: -0.1 + X, brx: 0.5, brz: 0.2, bh: 0.62, drop: 0.3, strap: 0x3a2a1e, bar: 0x5a4028, sling: 0x4a4a52, max: 0.9 }); A = r.A;
      const out = [r.hard];
      out.push(eye(0.04, 1.5 + X, yc + 0.36, 0.3), both(G.ball(0.3, 9, 6).scale(0.5, 1, 0.22).rot(0, -28, 0).at(0.96 + X, yc + 0.34, 0.46).color(C.dark).pbr(0.9)));
      // banded tusks with iron tips and icicles
      out.push(both(G.tube(tusk, [0.105, 0.1, 0.08, 0.05, 0.012], 16, 7).color(0xf0e8d0).pbr(0.4)));
      const cv = new THREE.CatmullRomCurve3(tusk.map((p) => new THREE.Vector3(...p)));
      for (const [t, rr] of [[0.3, 0.1], [0.55, 0.082], [0.78, 0.058]]) { const p = cv.getPointAt(t), d = cv.getTangentAt(t); out.push(both(aim(G.cyl(rr + 0.008, rr + 0.012, 0.07, 8), [p.x, p.y, p.z], [d.x, d.y, d.z]).color(rune).pbr(0.4, 0.8))); }
      for (const t of [0.42, 0.5, 0.64, 0.7]) { const p = cv.getPointAt(t); out.push(both(crystal([p.x, p.y - 0.05, p.z], [0, -1, 0], 0.025, 0.16 + (t * 10 % 1) * 0.1, ice, 0.25))); }
      out.push(locks(-0.9 + X, 0.8 + X, yc - 0.78, 0.62, 13, 0.4, C.shag, 0.08), locks(-0.9 + X, 0.8 + X, yc - 0.78, -0.62, 13, 0.4, C.shag, 0.08), locks(0.75 + X, 1.15 + X, yc - 0.66, 0.2, 3, 0.34, C.shag, 0.08), locks(0.75 + X, 1.15 + X, yc - 0.66, -0.2, 3, 0.34, C.shag, 0.08));
      for (const s of [-1, 1]) for (const [row, y, n] of [[0, yc + 0.12, 8], [1, yc - 0.22, 9]]) for (let i = 0; i < n; i++) { const x = -1.0 + X + (i + (row ? 0.5 : 0)) * (row ? 0.2 : 0.22) + (i > 3 && !row ? 0.0 : 0); if (!row && x > -0.72 + X && x < 0.5 + X) continue; const z = K.half(x, y); out.push(G.cone(0.1, 0.42, 4).scale(1, 1, 0.5).rot(180, 0, 0).rot(s * -14, 0, 0).at(x, y - 0.16, s * (z + 0.03)).color((i + row) % 2 ? C.shag : shade(hide, 0.9)).pbr(0.95)); }
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const x = 0.98 + X + i * 0.11, y = yc + 0.28 - i * 0.05, z = K.half(x, y); out.push(G.cone(0.085, 0.36, 4).scale(1, 1, 0.5).rot(180, 0, 0).rot(s * -12, 0, 0).at(x, y - 0.14, s * (z + 0.02)).color(i % 2 ? C.shag : C.dark).pbr(0.95)); }
      for (let i = 0; i < 6; i++) out.push(spike([1.08 + X + (i % 3) * 0.1, yc + 0.94 - (i % 2) * 0.04, (i < 3 ? -1 : 1) * 0.08], [-0.6 + (i % 3) * 0.3, 1, (i < 3 ? -1 : 1) * 0.4], 0.07, 0.22, C.dark, 4));
      out.push(G.tube([[-1.22 + X, yc + 0.3, 0], [-1.36 + X, yc + 0.05, 0], [-1.38 + X, yc - 0.5, 0]], [0.06, 0.04, 0.03], 6, 5).color(C.dark), G.cone(0.08, 0.3, 5).rot(180, 0, 0).at(-1.38 + X, yc - 0.64, 0).color(C.dark));
      // stave tubs bound in rune-blue iron, hung with icicles
      const stave = (i) => (i % 2 ? 0x7a5a38 : 0x5e4428);
      out.push(flanks(A, A.yb, () => [woven(A.brx, A.brz, A.bh, { weave: 0.003, taper: 0.9, bulge: 0.03, seg: 20, rows: 7, pat: (i, j, n, m) => (j === 2 || j === m - 1 ? rune : stave(i >> 1)), rim: 0x4a4a52, rimR: 0.032 }),
        [-0.36, -0.12, 0.14, 0.38].map((x, k) => crystal([x, -A.bh / 2, A.brz * 0.6], [0, -1, 0], 0.03, 0.16 + (k % 2) * 0.1, ice, 0.25))]));
      // a carved prow-beast post at the rear, a war horn slung beside it
      const px = A.xc - A.brx * 0.62 - 0.12, py = A.ybar;
      out.push(G.tube([[px, py - 0.05, 0], [px - 0.06, py + 0.5, 0], [px + 0.02, py + 0.86, 0], [px + 0.2, py + 0.98, 0]], [0.05, 0.045, 0.045, 0.06], 10, 6).color(0x5a4028).pbr(0.8), G.ball(0.08, 7, 5).scale(1.5, 0.9, 0.9).at(px + 0.26, py + 0.99, 0).color(0x5a4028), both(spike([px + 0.2, py + 1.03, 0.04], [-0.5, 1, 0.3], 0.02, 0.14, BONE, 4)), both(G.ball(0.018, 5, 4).at(px + 0.3, py + 1.02, 0.06).color(ice).glow(0.8)));
      out.push(G.tube([[px + 0.1, py + 0.24, 0.3], [px + 0.2, py + 0.12, 0.36], [px + 0.36, py + 0.14, 0.38]], [0.02, 0.045, 0.07], 6, 6).color(0xe0d6b8), rope([[px, py + 0.5, 0.02], [px + 0.1, py + 0.24, 0.3]], 0.01, 0x3a2a1e, 3));
      for (const dx of [-0.2, 0.26]) out.push(crystal([A.xc + A.brx * 0.62 + 0.14, K.top(A.xc + A.brx * 0.62 + 0.14) - 0.02, dx], [0.3, 1, dx], 0.05, 0.3, ice, 0.3), crystal([A.xc + A.brx * 0.62 + 0.2, K.top(A.xc + A.brx * 0.62 + 0.2) - 0.02, dx * 0.5], [0.5, 1, -dx], 0.035, 0.2, ice, 0.3));
      return out;
    },
    side(K) {
      const sh = (s) => [-0.3, 0.04, 0.38].map((x, k) => T(shield(0.17), x, 0.04 - (k % 2) * 0.03, A.brz + 0.05, 0, 0, 0));
      const out = [K.blanket(-0.82 + X, 0.62 + X, 80, { style: 2, nx: 12, na: 22 })];
      // the shield faces are painted in the side's colour
      for (const s of [1, -1]) for (const [k, x] of [-0.3, 0.04, 0.38].entries()) out.push(G.cyl(0.15, 0.15, 0.012, 12).rot(90, 0, 0).shade((px, py, pz) => (px * pz > 0 ? [1, 1, 1] : [1.7, 1.7, 1.7])).at(A.xc + s * x, A.yb + 0.04 - (k % 2) * 0.03, s * (A.zb + A.brz + 0.068)));
      void sh;
      return out;
    },
    load(K, i) {
      const y = A.yrim - 0.07, yb = A.ybar + 0.03, xc = A.xc + 0.1;
      const out = [flanks(A, y, (s) => [T(shield(0.17), -0.3, -A.bh / 2 + 0.11, A.brz + 0.05), T(shield(0.17), 0.04, -A.bh / 2 + 0.08, A.brz + 0.05), T(shield(0.17), 0.38, -A.bh / 2 + 0.11, A.brz + 0.05),
        T(stores(i + (s > 0 ? 0 : 1), { sack: 0xc8c0b0, crate: 0x6a4a2e, jar: 0x5a6a7a, roll: 0xd8d0c0 }), 0, 0, 0, 0, 0, 0, 1.15)])];
      if (i === 0) out.push(T(barrel(0.2, 0.5), xc - 0.02, yb + 0.2, 0.22, 90, 0, 0), T(barrel(0.2, 0.5), xc - 0.02, yb + 0.2, -0.22, 90, 0, 0), T(roll(0.14, 0.7, 0xd8d0c0, 0x3a2a1e), xc, yb + 0.38, 0, 90, 0, 0), lash(A, [-0.08, 0.3], 0.66, 0x3a2a1e));
      else if (i === 1) out.push(T(crate(0.44, 0.34, 0x6a4a2e), xc + 0.1, yb, 0, 0, 6, 0), T(roll(0.14, 0.64, 0x8a7a6a, 0x3a2a1e), xc + 0.1, yb + 0.34, 0.1, 90, 0, 0), T(roll(0.12, 0.6, 0xe0d8c8, 0x3a2a1e), xc + 0.1, yb + 0.34, -0.14, 90, 0, 0), T(barrel(0.14, 0.34), xc - 0.3, yb, 0.0), lash(A, [0.1], 0.6, 0x3a2a1e));
      else out.push(T(barrel(0.2, 0.46), xc + 0.2, yb, 0.02), T(sack(0.24, 0xc8c0b0), xc - 0.2, yb, 0.16), T(sack(0.2, 0xb0a898), xc - 0.18, yb, -0.2), T(roll(0.11, 0.8, 0x7a6a5a, 0x3a2a1e), xc, yb + 0.02, 0.44, 90, 0, 0), lash(A, [-0.18], 0.44, 0x3a2a1e));
      return out;
    },
  };
};

// ============================================================================================
//  the verdant host's stag: tall and fine-legged, antlers in leaf and blossom, willow panniers
// ============================================================================================
const fruit = (n, cols, r = 0.055, spread = 0.13) => { const out = [], R = rng(n * 31 + cols[0]); for (let i = 0; i < n; i++) { const a = R() * 6.283, d = Math.sqrt(R()) * spread; out.push(G.ball(r * (0.85 + R() * 0.3), 6, 4).at(Math.cos(a) * d * 1.5, r * 0.8 + (spread - d) * 0.9, Math.sin(a) * d).color(cols[i % cols.length]).pbr(0.45)); } return out; };
const arrows = (n = 5, fl = 0xd84a3a) => { const out = [G.cyl(0.07, 0.06, 0.34, 7).at(0, 0.17, 0).color(0x5a4630).pbr(0.9), G.tor(0.072, 0.012, 8, 4).rot(90, 0, 0).at(0, 0.3, 0).color(0xd8a03a).pbr(0.4, 0.8)]; for (let i = 0; i < n; i++) { const a = i * 2.4, x = Math.cos(a) * 0.035, z = Math.sin(a) * 0.035; out.push(G.cyl(0.006, 0.006, 0.26, 4).at(x, 0.42, z).color(0xc8b888), feather(0.1, i % 2 ? fl : 0xf0e8d8, null, 0.3).rot(0, a * 57, 0).at(x, 0.46, z)); } return out; };
DEFS.verdant = (L) => {
  const hide = L.hide ?? 0x9a7a4a, lf = 0x4f8a2a, lf2 = 0x8aae3a, amber = L.trim ?? 0xd8a03a, bloom = 0xf6e0ee, moss = 0x5a7a34, vine = 0x47682a, eyeC = 0xb8ff70;
  const C = { hide, dark: shade(hide, 0.6), belly: mix(hide, 0xf4ecdc, 0.65), leg: shade(hide, 0.62), hoof: 0x2a2018, antler: 0x6e553a };
  const yc = 1.36, HX = 1.0, HY = yc + 0.84, HP = -16, AS = 0.82;
  const hp = [
    el(0.14, 0.14, 0.13, 0, 0, 0, C.hide, 0.06), cap([0.05, -0.02, 0], [0.31, -0.1, 0], 0.105, 0.062, C.hide, 0.05), cap([0.0, -0.09, 0], [0.25, -0.145, 0], 0.062, 0.042, C.belly, 0.04),
    el(0.045, 0.04, 0.055, 0.345, -0.1, 0, 0x1a1410, 0.02), both(el(0.05, 0.035, 0.04, 0.07, 0.08, 0.085, C.hide, 0.03)), S.sphere(0.07).at(0.1, 0.02, 0).color(C.belly).paint(0.05),
  ];
  const beam = [[-0.04, 0.11, 0.07], [-0.12, 0.36, 0.2], [-0.22, 0.62, 0.36], [-0.1, 0.88, 0.45], [0.1, 1.02, 0.4]];
  const tines = [[[-0.08, 0.24, 0.13], [0.06, 0.34, 0.16], [0.16, 0.48, 0.2]], [[-0.17, 0.5, 0.29], [-0.02, 0.62, 0.38], [0.04, 0.78, 0.46]], [[-0.22, 0.62, 0.36], [-0.36, 0.76, 0.4], [-0.42, 0.94, 0.42]], [[-0.1, 0.88, 0.45], [-0.14, 1.04, 0.52], [-0.1, 1.16, 0.54]]];
  const R = rng(77), tips = [beam[4], ...tines.map((t) => t[2]), tines[1][1], tines[2][1], beam[3]];
  const hh = [
    eye(0.027, 0.1, 0.05, 0.118, eyeC, 1.2),
    both(G.ball(0.12, 7, 5).scale(1, 0.28, 0.45).rot(-30, 35, 20).at(-0.1, 0.07, 0.2).color(C.hide).pbr(0.9)),
    T(both(G.tube(beam, [0.042, 0.036, 0.03, 0.022, 0.008], 12, 6).color(C.antler).pbr(0.7), tines.map((t) => G.tube(t, [0.026, 0.018, 0.006], 5, 5).color(C.antler).pbr(0.7)),
      tips.map((t, i) => [T(leaf(0.07, i % 2 ? lf : lf2), t[0], t[1] + 0.02, t[2], R() * 90, R() * 180, 20), T(leaf(0.06, i % 2 ? lf2 : lf), t[0] + 0.05, t[1] - 0.03, t[2] + 0.03, R() * 90, R() * 180, -30), i % 2 ? G.ball(0.032, 6, 4).at(t[0] - 0.03, t[1] + 0.03, t[2] - 0.02).color(bloom).pbr(0.5) : null]),
      [0.3, 0.5, 0.72].map((u, i) => G.cone(0.02, 0.2 + i * 0.05, 4).rot(180, 0, 0).at(-0.1 - u * 0.12, 0.25 + u * 0.5, 0.16 + u * 0.24).color(0x7a9a5a).pbr(0.95))), 0, 0, 0, 0, 0, 0, AS),
  ];
  const spots = []; { const Q = rng(5); for (let i = 0; i < 9; i++) spots.push(S.sphere(0.035 + Q() * 0.02).at(-0.7 + i * 0.13 + Q() * 0.05, yc + 0.16 - (i % 3) * 0.1, 0.25).color(0xf4ecdc).paint(0.015)); }
  let A;
  return {
    yc, res: 25, legRes: 26, len: 2.3,
    prims: [
      torso(C, { xs: 0.42, xh: -0.5, y: yc, ch: [0.3, 0.35, 0.25, 0.02], ba: [0.52, 0.3, 0.27, 0], ru: [0.33, 0.34, 0.27, 0.03], tint: 0.12 }),
      cap([0.5, yc + 0.12, 0], [0.92, yc + 0.72, 0], 0.22, 0.125, C.hide, 0.1),
      el(0.15, 0.26, 0.15, 0.66, yc + 0.08, 0, C.belly, 0.07).bump(0.02, 11, 'fur'),
      el(0.07, 0.11, 0.06, -0.84, yc + 0.2, 0, C.belly, 0.04),
      T(hp, HX, HY, 0, 0, 0, HP),
      S.ellipsoid(0.7, 0.14, 0.24).at(-0.05, yc - 0.3, 0).color(C.belly).paint(0.08),
      both(spots),
      S.ellipsoid(0.26, 0.12, 0.2).at(-0.6, yc + 0.33, 0).color(moss).paint(0.06, 0.012), S.ellipsoid(0.16, 0.1, 0.14).at(0.52, yc + 0.4, 0).color(moss).paint(0.05, 0.012),
    ],
    legs: fourLegs(hoofLeg(1.1, 0.064, C, { up: 1.7, hoofH: 0.09 }), hoofLeg(1.1, 0.064, C, { hind: true, up: 1.8, hoofH: 0.09, bend: 1.3 }), 0.42, -0.5, 1.1, 0.16),
    hard(K) {
      const r = rig(K, { xc: -0.05, brx: 0.34, brz: 0.2, bh: 0.4, drop: 0.06, strap: vine, bar: 0x5a4630, sling: vine }); A = r.A;
      const out = [r.hard, T(hh, HX, HY, 0, 0, 0, HP)];
      // a garland of leaf and blossom round the chest
      for (let i = 0; i < 14; i++) { const a = -2.5 + (i / 13) * 5, t = K.surf(0.5, a) + 0.03, y = yc + Math.cos(a) * t, z = Math.sin(a) * t; out.push(i % 2 ? G.ball(0.04, 6, 4).at(0.5, y, z).color(i % 4 === 1 ? bloom : amber).pbr(0.5) : T(leaf(0.075, i % 4 ? lf : lf2), 0.5, y, z, a * 57, 40, 0)); }
      // panniers of living willow, leaves round the rim and flowers on the face
      out.push(flanks(A, A.yb, () => [woven(A.brx, A.brz, A.bh, { a: 0x9a8a52, b: 0x566b2c, rim: vine, rimR: 0.026, weave: 0.014 }),
        Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * 6.283; return T(leaf(0.07, i % 3 ? lf : lf2), Math.cos(a) * (A.brx + 0.03), A.bh / 2 - 0.02, Math.sin(a) * (A.brz + 0.03), 30, -a * 57, -25); }),
        [[-0.16, 0.04], [0.02, -0.06], [0.18, 0.05]].map(([x, y], i) => [G.ball(0.04, 6, 4).at(x, y, A.brz + 0.02).color(i === 1 ? amber : bloom).pbr(0.5), T(leaf(0.06, lf), x + 0.05, y - 0.03, A.brz + 0.01, 90, 0, 30)])]));
      // a flowering bough arched over the load, a seed-lantern swinging from its tip
      const bx = A.xc - A.brx * 0.62, by = A.ybar, bough = [[bx, by - 0.04, 0.05], [bx - 0.14, by + 0.4, 0.0], [bx + 0.1, by + 0.72, -0.03], [bx + 0.5, by + 0.74, 0.0], [bx + 0.78, by + 0.56, 0.02]];
      out.push(G.tube(bough, [0.03, 0.026, 0.022, 0.016, 0.008], 12, 5).color(0x5a4630).pbr(0.9));
      const cv = new THREE.CatmullRomCurve3(bough.map((p) => new THREE.Vector3(...p))), Q = rng(9);
      for (let i = 0; i < 12; i++) { const p = cv.getPointAt(0.25 + (i / 12) * 0.75); out.push(T(leaf(0.075, i % 2 ? lf : lf2), p.x, p.y + 0.03, p.z + (Q() - 0.5) * 0.1, Q() * 90, Q() * 180, 20), i % 3 === 0 ? G.ball(0.035, 6, 4).at(p.x + 0.03, p.y - 0.02, p.z + (Q() - 0.5) * 0.12).color(bloom).pbr(0.5) : null); }
      out.push(rope([[bx + 0.78, by + 0.56, 0.02], [bx + 0.78, by + 0.36, 0.02]], 0.006, vine, 2), G.ball(0.06, 8, 6).scale(1, 1.3, 1).at(bx + 0.78, by + 0.29, 0.02).color(amber).glow(1.1).pbr(0.3), T(leaf(0.05, lf), bx + 0.78, by + 0.37, 0.02, 0, 0, 90));
      return out;
    },
    side(K) {
      const bx = A.xc - A.brx * 0.62;
      return [K.blanket(-0.46, 0.34, 100, { style: 0, hem: (u) => 0.84 + 0.16 * Math.abs(Math.sin(u * PI * 5)) }),
        [-1, 1].map((s) => H.sheet(0.07, 0.5, 1, 5, (u, v) => [Math.sin(v * 4) * 0.03, 0, Math.sin(v * 3 + s) * 0.05]).rot(0, 90, 0).at(bx - 0.1, A.ybar + 0.24, s * 0.06).pbr(0.9))];
    },
    load(K, i) {
      const y = A.yrim - 0.07, yb = A.ybar + 0.03, xc = A.xc + 0.06;
      const mixes = [(s) => fruit(13, [0xc8382a, 0xe0a030, 0xb8c83a], 0.055, 0.14), (s) => [T(arrows(6), -0.14, 0, 0, 0, 0, 8), T(arrows(5, 0x3a8a5a), 0.14, 0, 0.02, 0, 60, -6), T(sack(0.1, 0x8a9a5a), 0.0, 0, -0.1)], (s) => [T(jar(0.08, 0.24, 0x8a9a6a, vine), -0.17, 0, 0), T(jar(0.07, 0.2, 0xc8b888, vine), 0.02, 0, -0.05), fruit(6, [0x7a3a8a, 0xb04a9a], 0.045, 0.07).map((q) => q.at(0.2, 0, 0.03))]];
      const out = [flanks(A, y, (s) => mixes[(i + (s > 0 ? 0 : 1)) % 3](s))];
      if (i === 0) out.push(T(roll(0.09, 0.5, 0x6a8a3a, vine), xc, yb, 0.1, 90, 0, 0), T(roll(0.08, 0.46, 0xa8562a, vine), xc, yb, -0.09, 90, 0, 0), G.ball(0.12, 8, 6).scale(1, 0.8, 1).at(xc + 0.02, yb + 0.22, 0).color(0xd89a2a).pbr(0.5), lash(A, [0.0], 0.24, vine));
      else if (i === 1) out.push(T(sack(0.15, 0x8a9a5a), xc - 0.1, yb, 0.03), T(sack(0.13, 0xa8a878), xc + 0.14, yb, -0.03), T(arrows(7, 0xe0a030), xc + 0.02, yb + 0.1, 0.12, 0, 0, -70), lash(A, [0.02], 0.26, vine));
      else out.push(T(roll(0.1, 0.52, 0xa8562a, vine), xc, yb, 0, 90, 0, 0), fruit(9, [0xe0a030, 0xc8382a], 0.05, 0.1).map((q) => q.at(xc, yb + 0.16, 0)), lash(A, [-0.16, 0.18], 0.2, vine));
      return out;
    },
  };
};

// ============================================================================================
//  the greenhide hordes' boar: bristle-backed and tusked, in scrap iron, loot boxed in spiked crates
// ============================================================================================
DEFS.greenhide = (L) => {
  const hide = L.hide ?? 0x4a4238, red = 0xb4221a, rust = 0x7a4a32, iron = 0x4a4a50;
  const C = { hide, dark: shade(hide, 0.55), belly: mix(hide, 0x8a7a6a, 0.4), leg: shade(hide, 0.7), hoof: 0x16120e };
  const yc = 0.8;
  let A;
  const scrapBox = (w, h, d) => [
    G.box(w, h, d).shade((x) => [0x6a4e32, 0x54402a, 0x7a5a3a, 0x4a3826][Math.min(3, Math.max(0, Math.floor((x / w + 0.5) * 4)))]).pbr(0.9),
    G.box(w * 1.04, 0.05, d * 1.06).at(0, h / 2 - 0.03, 0).color(iron).pbr(0.6, 0.35), G.box(w * 1.04, 0.05, d * 1.06).at(0, -h / 2 + 0.04, 0).color(iron).pbr(0.6, 0.35),
    G.box(w * 0.9, 0.02, d * 0.86).at(0, h / 2 + 0.001, 0).color(0x1e1712),
    G.box(0.24, 0.2, 0.025).rot(0, 0, 8).at(-0.14, -0.01, d / 2 + 0.012).color(rust).pbr(0.7, 0.3), G.box(0.16, 0.025, 0.03).rot(0, 0, 50).at(-0.14, -0.01, d / 2 + 0.026).color(red), G.box(0.16, 0.025, 0.03).rot(0, 0, -50).at(-0.14, -0.01, d / 2 + 0.026).color(red),
    G.box(0.2, 0.14, 0.02).rot(0, 0, -12).at(0.2, 0.04, d / 2 + 0.01).color(0x5a5a62).pbr(0.6, 0.35),
    [-0.3, -0.15, 0, 0.15, 0.3].map((x, k) => spike([x * (w / 0.7), h / 2 - 0.02, d / 2 + 0.01], [0, 0.5, 1], 0.03, 0.13 + (k % 2) * 0.05, 0x8a8a92, 4)),
    [-1, 1].map((s) => spike([s * w / 2, 0, 0], [s, 0.2, 0], 0.03, 0.14, 0x8a8a92, 4)),
  ];
  return {
    yc, res: 24, legRes: 24, len: 2.1,
    prims: [
      torso(C, { xs: 0.42, xh: -0.46, y: yc, ch: [0.42, 0.46, 0.36, 0.06], ba: [0.56, 0.38, 0.36, 0], ru: [0.35, 0.36, 0.32, -0.02], fur: 0.018, furF: 10, tint: 0.2 }),
      el(0.5, 0.13, 0.11, 0.3, yc + 0.5, 0, C.dark, 0.08).bump(0.04, 10, 'fur'),
      cap([0.62, yc + 0.1, 0], [1.16, yc - 0.2, 0], 0.33, 0.14, C.hide, 0.1),
      cap([0.7, yc - 0.2, 0], [1.1, yc - 0.33, 0], 0.17, 0.09, C.belly, 0.06),
      S.cyl(0.118, 0.07, 0.02).rot(0, 0, -118).at(1.27, yc - 0.255, 0).color(0x8a6660).blend(0.03),
      both(el(0.14, 0.17, 0.1, 0.78, yc - 0.1, 0.24, C.hide, 0.06), el(0.09, 0.05, 0.07, 0.88, yc + 0.17, 0.15, C.dark, 0.04)),
      both(S.box(0.05, 0.4, 0.3).rot(0, 0, 30).at(0.4, yc + 0.1, 0.34).color(red).paint(0.012), S.box(0.05, 0.36, 0.3).rot(0, 0, 30).at(0.52, yc + 0.06, 0.34).color(red).paint(0.012), S.box(0.05, 0.3, 0.3).rot(0, 0, 30).at(0.28, yc + 0.12, 0.34).color(red).paint(0.012)),
      S.ellipsoid(0.6, 0.16, 0.3).at(-0.05, yc - 0.36, 0).color(C.belly).paint(0.08),
    ],
    legs: fourLegs(hoofLeg(0.54, 0.09, C, { up: 1.7, hoofH: 0.085 }), hoofLeg(0.54, 0.088, C, { hind: true, up: 1.8, hoofH: 0.085, bend: 0.7 }), 0.42, -0.46, 0.54, 0.22),
    hard(K) {
      const r = rig(K, { xc: -0.06, brx: 0.36, brz: 0.2, bh: 0.4, drop: 0.07, strap: 0x2a221c, bar: WOODD, sling: 0x3a3a40, max: 0.92 }); A = r.A;
      const out = [r.hard];
      out.push(eye(0.026, 0.95, yc + 0.1, 0.19, 0xff3020, 1.1), both(G.ball(0.02, 5, 4).at(1.3, yc - 0.24, 0.045).color(0x1a1210)));
      out.push(both(G.cone(0.1, 0.26, 4).scale(1, 1, 0.3).rot(20, 0, 20).at(0.64, yc + 0.42, 0.2).color(C.dark).pbr(0.9)));
      // tusks: a great lower pair curling up past the snout, a lesser pair above
      out.push(both(G.tube([[1.0, yc - 0.3, 0.12], [1.13, yc - 0.24, 0.2], [1.18, yc - 0.04, 0.24], [1.1, yc + 0.14, 0.22]], [0.05, 0.045, 0.03, 0.006], 10, 6).color(0xe8dcb8).pbr(0.45), G.tube([[1.08, yc - 0.18, 0.1], [1.2, yc - 0.16, 0.15], [1.26, yc - 0.06, 0.16]], [0.03, 0.022, 0.005], 5, 5).color(0xe8dcb8).pbr(0.45)));
      // bristles down the neck, a riveted skull-plate, a spiked iron collar
      for (let i = 0; i < 9; i++) out.push(spike([0.82 - i * 0.085, K.top(0.82 - i * 0.085) - 0.03, 0], [-0.4, 1, 0], 0.035, 0.2 + (i % 3) * 0.06, i % 2 ? C.dark : 0x1c1814, 4));
      for (let i = 0; i < 4; i++) out.push(spike([-0.6 - i * 0.07, K.top(-0.6 - i * 0.07) - 0.03, 0], [-0.6, 1, 0], 0.03, 0.14, C.dark, 4));
      out.push(G.box(0.22, 0.03, 0.26).rot(0, 0, -30).at(0.86, yc + 0.27, 0).color(iron).pbr(0.6, 0.35), spike([0.86, yc + 0.28, 0.08], [0.4, 1, 0.2], 0.03, 0.14, 0x8a8a92, 4), spike([0.86, yc + 0.28, -0.08], [0.4, 1, -0.2], 0.03, 0.14, 0x8a8a92, 4), G.tor(0.05, 0.012, 8, 4).rot(0, 90, 0).at(1.3, yc - 0.32, 0).color(0x8a8a92).pbr(0.45, 0.5));
      out.push(K.girth(0.6, 0.08, iron, 0.03));
      for (const a of [-1.9, -1.3, -0.7, 0.7, 1.3, 1.9]) { const t = K.surf(0.6, a) + 0.03; out.push(spike([0.6, yc + Math.cos(a) * t, Math.sin(a) * t], [0, Math.cos(a), Math.sin(a)], 0.03, 0.13, 0x8a8a92, 4)); }
      out.push(G.tube([[-0.8, yc + 0.14, 0], [-0.92, yc + 0.26, 0.03], [-1.0, yc + 0.16, 0.06], [-0.93, yc + 0.07, 0.03], [-0.88, yc + 0.15, -0.01]], 0.02, 10, 4).color(C.hide), G.ball(0.04, 5, 4).at(-0.88, yc + 0.15, -0.01).color(C.dark));
      out.push(flanks(A, A.yb, () => scrapBox(A.brx * 2, A.bh, A.brz * 2)));
      // a skull on a pike at the back
      const px = A.xc - A.brx * 0.62 - 0.04;
      out.push(G.cyl(0.02, 0.026, 1.0, 5).rot(0, 0, 8).at(px, A.ybar + 0.44, 0).color(WOODD), T(skull(1.1), px - 0.06, A.ybar + 0.96, 0, 0, 0, 10), spike([px - 0.07, A.ybar + 1.02, 0], [-0.1, 1, 0], 0.02, 0.14, 0x8a8a92, 4));
      return out;
    },
    side(K) {
      const px = A.xc - A.brx * 0.62 - 0.04;
      return [K.blanket(-0.5, 0.36, 98, { style: 0, hem: (u) => 0.86 + 0.14 * ((Math.floor(u * 9) * 7) % 3) / 2 }),
        H.sheet(0.4, 0.3, 5, 3, (u, v) => [0, u > 0.7 ? (v - 0.5) * -0.16 * Math.sin(v * 9) : 0, Math.sin(u * 5) * 0.04]).shade((x, y) => { const k = Math.abs(y) < 0.05 ? 0.45 : 1; return [k, k, k]; }).at(px - 0.3, A.ybar + 0.68, 0).pbr(0.95)];
    },
    load(K, i) {
      const y = A.yrim + 0.01, yb = A.ybar + 0.03, xc = A.xc + 0.08;
      const cleaver = () => T([G.cyl(0.018, 0.018, 0.3, 5).color(WOODD), G.box(0.14, 0.3, 0.02).at(0.05, 0.3, 0).color(0x7a7a82).pbr(0.45, 0.5)], 0, 0, 0, 0, 0, 0);
      const mixes = [(s) => [T(barrel(0.12, 0.26, 0x6a4e32, iron), -0.18, 0, 0), T(sack(0.13, 0x8a7a58), 0.08, 0, 0.02), T(cleaver(), 0.26, 0.02, -0.04, 0, 30, -20)], (s) => [T(sack(0.15, 0x7a6a4a), -0.16, 0, 0), T(sack(0.12, 0x9a8a62), 0.1, 0, 0.04), T(skull(0.7), 0.24, 0.07, -0.04, 0, 50, 0)], (s) => [T(crate(0.24, 0.2, 0x54402a), -0.17, 0, 0, 0, 10, 0), T(jar(0.07, 0.2, 0x3a4a3a, rust), 0.08, 0, 0.04), T(jar(0.06, 0.17, 0x6a3a2a, rust), 0.22, 0, -0.03)]];
      const out = [flanks(A, y, (s) => mixes[(i + (s > 0 ? 0 : 2)) % 3](s))];
      if (i === 0) out.push(T(barrel(0.16, 0.4, 0x6a4e32, iron), xc, yb + 0.16, 0, 90, 0, 0), T(sack(0.13, 0x8a7a58), xc + 0.02, yb + 0.3, 0.0), lash(A, [0.1], 0.36, 0x3a3a40));
      else if (i === 1) out.push(T(crate(0.32, 0.24, 0x54402a), xc, yb, 0, 0, -8, 0), G.box(0.34, 0.03, 0.05).at(xc, yb + 0.25, 0).color(0xc8a040).pbr(0.35, 0.9), T(cleaver(), xc - 0.04, yb + 0.26, 0.1, 80, 0, 0), lash(A, [0.14], 0.3, 0x3a3a40));
      else out.push(T(sack(0.18, 0x7a6a4a), xc - 0.1, yb, 0.05), T(sack(0.15, 0x9a8a62), xc + 0.14, yb, -0.06), T(G.cyl(0.2, 0.2, 0.03, 9).color(rust).pbr(0.7, 0.3), xc + 0.02, yb + 0.26, 0, 20, 0, 10), lash(A, [0.0], 0.28, 0x3a3a40));
      return out;
    },
  };
};

// ============================================================================================
//  reptiles: the temple-cities' feather-frilled lizard, the isles' sail-backed lizard, the broods' pack drake
// ============================================================================================
/** a ribbon of membrane between two rows of points (fins, sails, wing webs) */
function web(a, b) {
  const pos = [], idx = [];
  for (let i = 0; i < a.length; i++) pos.push(...a[i], ...b[i]);
  for (let i = 0; i < a.length - 1; i++) { const p = i * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return H.geo(g);
}
/** a long low trunk with shoulders, hips, neck and tail; o.neck / o.tail are [points, radii] */
function reptBody(C, o) {
  const { yc, xs, xh, tr, neck, tail, sc = 0.018, sf = 8 } = o;
  const p = flat([
    el(tr[0], tr[1], tr[2], (xs + xh) / 2, yc, 0, C.hide, 0),
    el(tr[0] * 0.5, tr[1] * (o.chest ?? 1.02), tr[2] * 0.96, xs, yc + (o.chestY ?? 0), 0, C.hide, 0.12),
    el(tr[0] * 0.48, tr[1] * 0.96, tr[2] * 0.94, xh, yc - 0.01, 0, C.hide, 0.12),
    both(el(0.2, 0.24, 0.15, xs, yc - 0.06, tr[2] * 0.74, C.hide, 0.07), el(0.22, 0.25, 0.16, xh, yc - 0.06, tr[2] * 0.74, C.hide, 0.07)),
    limb(neck[0], neck[1], C.hide, 0.1), limb(tail[0], tail[1], C.hide, 0.1),
  ]);
  for (const q of p) q.bump(sc, sf, 'scales').tint(o.mottle ?? 0.16, o.mottleF ?? 6);
  p.push(S.ellipsoid(tr[0] * 1.2, tr[1] * 0.5, tr[2] * 0.8).at((xs + xh) / 2, yc - tr[1] * 0.85, 0).color(C.belly).paint(0.09));
  p.push(S.capsule(neck[0][0], neck[0][neck[0].length - 1], neck[1][0] * 0.7, neck[1][neck[1].length - 1] * 0.7).at(0, -neck[1][0] * 0.62, 0).color(C.belly).paint(0.07));
  for (let i = 0; i < tail[0].length - 1; i++) p.push(S.capsule(tail[0][i], tail[0][i + 1], tail[1][i] * 0.7, tail[1][i + 1] * 0.7).at(0, -tail[1][i] * 0.6, 0).color(C.belly).paint(0.06));
  return p;
}
const anklet = (Hh, r, z, c) => G.tor(r * 1.05, r * 0.2, 10, 4).rot(90, 0, 0).at(0.03, -Hh + r * 1.6, z).color(c).pbr(0.35, 0.6);

DEFS.xibalba = (L) => {
  const hide = L.hide ?? 0x4a8a5a, gold = L.trim ?? 0xd8a82a, red = L.cloth ?? 0xc83a2a, turq = L.cloth2 ?? 0x2ab8c8, jade = 0x3aa870, cream = 0xe8dcb0;
  const C = { hide, dark: shade(hide, 0.6), belly: 0xe0d49a, leg: shade(hide, 0.85), claw: 0x2a2018 };
  const yc = 0.68, HX = 1.04, HY = yc + 0.26, HP = -8;
  const hd = reptHead(C, { s: 1.14, len: 0.46, scales: 0.012, eye: 0xffc020, eyeGlow: 0.7 });
  hd.p.push(el(0.12, 0.1, 0.16, -0.04, 0.12, 0, C.dark, 0.05), S.box(0.05, 0.3, 0.5).at(0.3, 0, 0).color(0xf0a030).paint(0.012), S.box(0.04, 0.3, 0.5).at(0.4, 0, 0).color(turq).paint(0.012));
  const neck = [[[0.66, yc + 0.06, 0], [0.98, yc + 0.2, 0]], [0.3, 0.22]];
  const tail = [[[-0.72, yc, 0], [-1.08, yc - 0.1, 0.04], [-1.38, yc - 0.3, 0.16], [-1.54, yc - 0.48, 0.36], [-1.46, yc - 0.58, 0.56]], [0.28, 0.2, 0.13, 0.08, 0.03]];
  let A;
  const legHard = (Hh, r, out) => [anklet(Hh, r * 0.9, out + 0.04, gold)];
  return {
    yc, res: 21, legRes: 22, len: 3.2,
    prims: [
      reptBody(C, { yc, xs: 0.45, xh: -0.5, tr: [0.7, 0.35, 0.42], neck, tail }),
      [-0.95, -1.2, -1.42].map((x) => S.box(0.07, 0.6, 0.9).rot(0, 20, 0).at(x, yc - 0.1, 0.1).color(C.dark).paint(0.02)),
      [0.3, -0.44].map((x) => S.box(0.06, 0.24, 1.2).at(x + 0.26, yc + 0.22, 0).color(C.dark).paint(0.02)),
      S.ellipsoid(0.14, 0.14, 0.2).at(0.9, yc - 0.05, 0).color(0xf0a030).paint(0.06),
      T(hd.p, HX, HY, 0, 0, 0, HP),
    ],
    legs: fourLegs(clawLeg(0.56, 0.1, C, { scales: 0.012, hard: legHard(0.56, 0.1, 0.24) }), clawLeg(0.56, 0.105, C, { hind: true, scales: 0.012, hard: legHard(0.56, 0.105, 0.24) }), 0.45, -0.5, 0.56, 0.3),
    hard(K) {
      const r = rig(K, { xc: -0.03, brx: 0.32, brz: 0.21, bh: 0.4, drop: 0.07, strap: 0x7a3a22, bar: 0x6a4a2a, sling: cream, max: 0.9 }); A = r.A;
      const out = [r.hard, T(hd.h, HX, HY, 0, 0, 0, HP)];
      // gold brow-disc set with jade, a gold nose plate
      out.push(T([G.cyl(0.085, 0.085, 0.02, 10).rot(0, 0, 70).at(0.06, 0.2, 0).color(gold).pbr(0.3, 0.7), G.ball(0.035, 6, 4).at(0.07, 0.215, 0).color(jade).pbr(0.25), G.box(0.12, 0.02, 0.14).rot(0, 0, -6).at(0.5, 0.06, 0).color(gold).pbr(0.3, 0.7), both(G.ball(0.03, 6, 4).at(-0.02, 0.0, 0.215).color(jade).pbr(0.25))], HX, HY, 0, 0, 0, HP));
      // the frill: a gold collar and two fans of plumes
      const fx = 0.9, fy = yc + 0.17;
      out.push(G.tor(0.27, 0.035, 14, 5).rot(0, 90, 0).at(fx, fy, 0).color(gold).pbr(0.3, 0.7));
      for (let i = 0; i < 13; i++) { const a = -118 + i * (236 / 12); out.push(feather(0.54 - Math.abs(i - 6) * 0.018, i % 2 ? red : 0xb0241c, 0xf4c030, 0.3).at(0, 0.2, 0).rot(a, 0, 30).at(fx - 0.02, fy, 0)); }
      for (let i = 0; i < 12; i++) { const a = -108 + i * (216 / 11); out.push(feather(0.34, i % 2 ? turq : jade, cream, 0.36).at(0, 0.2, 0).rot(a, 0, 14).at(fx + 0.03, fy, 0)); }
      // back plates from the hips down the tail, gold rings on the tail
      for (let i = 0; i < 7; i++) { const x = -0.6 - i * 0.13; out.push(G.cone(0.07, 0.17 - i * 0.012, 4).scale(1, 1, 0.3).at(x, K.top(x) + 0.05 - i * 0.004, K.half(x, K.top(x) - 0.03) * 0).color(i % 2 ? 0xf0a030 : red).pbr(0.6)); }
      out.push(aim(G.cyl(0.215, 0.2, 0.06, 10), [-1.04, yc - 0.09, 0.03], [-1, -0.3, 0.1]).color(gold).pbr(0.3, 0.7), aim(G.cyl(0.145, 0.13, 0.05, 10), [-1.36, yc - 0.28, 0.15], [-1, -0.7, 0.5]).color(gold).pbr(0.3, 0.7));
      // step-fret baskets rimmed in gold, a sun disc on each
      const fret = (i, j, n, m) => (j === m - 1 ? turq : j === 0 ? 0x8a2a1e : ((i + (j >> 1) * 2) % 6 < 3 ? red : cream));
      out.push(flanks(A, A.yb, () => [woven(A.brx, A.brz, A.bh, { pat: fret, rim: gold, rimR: 0.028, weave: 0.008, seg: 24, rows: 8 }),
        G.cyl(0.11, 0.11, 0.025, 12).rot(90, 0, 0).at(0, 0, A.brz + 0.03).color(gold).pbr(0.3, 0.7), G.ball(0.04, 6, 4).scale(1, 1, 0.5).at(0, 0, A.brz + 0.05).color(jade).pbr(0.25),
        Array.from({ length: 8 }, (_, i) => spike([Math.cos(i * 0.785) * 0.11, Math.sin(i * 0.785) * 0.11, A.brz + 0.025], [Math.cos(i * 0.785), Math.sin(i * 0.785), 0], 0.025, 0.07, gold, 3)),
        [-0.24, 0.24].map((x, k) => T([feather(0.2, k ? turq : red, cream, 0.26)], x, A.bh / 2 - 0.03, A.brz * 0.82, 170, 0, 0))]));
      // a sun idol stands at the back of the load
      const ix = A.xc - A.brx * 0.62 - 0.03, iy = A.ybar + 0.34;
      out.push(G.cyl(0.03, 0.04, 0.3, 6).at(ix, A.ybar + 0.1, 0).color(gold).pbr(0.3, 0.7), G.cyl(0.2, 0.2, 0.03, 14).rot(0, 0, 90).at(ix, iy + 0.06, 0).color(gold).pbr(0.3, 0.7), G.ball(0.09, 8, 5).scale(0.4, 1, 1).at(ix + 0.02, iy + 0.06, 0).color(jade).pbr(0.25), both(G.ball(0.02, 5, 4).at(ix + 0.06, iy + 0.09, 0.035).color(0x1a1410)));
      for (let i = 0; i < 10; i++) { const a = i * 0.628; out.push(spike([ix, iy + 0.06 + Math.cos(a) * 0.19, Math.sin(a) * 0.19], [0, Math.cos(a), Math.sin(a)], 0.035, 0.12, i % 2 ? gold : 0xf4c030, 3)); }
      return out;
    },
    side(K) { return [K.blanket(-0.42, 0.34, 104, { style: 3 }), [-1, 1].map((s) => H.sheet(0.1, 0.34, 1, 3).rot(0, 90, 0).at(A.xc + A.brx * 0.62, A.ybar - 0.2, s * (A.zb - A.brz - 0.02)).pbr(0.9))]; },
    load(K, i) {
      const y = A.yrim - 0.07, yb = A.ybar + 0.03, xc = A.xc + 0.08;
      const maize = () => Array.from({ length: 7 }, (_, k) => G.cyl(0.03, 0.022, 0.2, 6).rot(70, k * 50, 0).at(-0.12 + (k % 4) * 0.08, 0.06 + (k % 2) * 0.05, -0.04 + (k % 3) * 0.05).color(k % 3 ? 0xf0c030 : 0xe8e0a0).pbr(0.6));
      const mixes = [(s) => [T(jar(0.085, 0.24, red, gold), -0.16, 0, 0), T(jar(0.075, 0.2, cream, turq), 0.03, 0, -0.04), T(jar(0.07, 0.2, 0x8a4a2a, gold), 0.19, 0, 0.04)], (s) => [maize(), T(sack(0.11, cream), 0.2, 0, 0)], (s) => [fruit(8, [0x7a4a22, 0x9a5a2a, 0x5a3a1a], 0.06, 0.1).map((q) => q.at(-0.1, 0, 0)), G.box(0.14, 0.08, 0.1).rot(0, 20, 0).at(0.18, 0.05, 0).color(jade).pbr(0.25), G.box(0.12, 0.06, 0.08).rot(0, -30, 0).at(0.16, 0.12, 0.02).color(gold).pbr(0.3, 0.7)]];
      const out = [flanks(A, y, (s) => mixes[(i + (s > 0 ? 0 : 1)) % 3](s))];
      if (i === 0) out.push(T(roll(0.08, 0.44, red, gold), xc, yb, 0.1, 90, 0, 0), T(roll(0.08, 0.44, turq, gold), xc, yb, -0.08, 90, 0, 0), T(roll(0.075, 0.4, cream, red), xc, yb + 0.14, 0.01, 90, 0, 0), lash(A, [0.02], 0.3, cream));
      else if (i === 1) out.push(T(jar(0.13, 0.32, red, gold), xc + 0.04, yb, 0), G.tor(0.1, 0.015, 10, 4).rot(90, 0, 0).at(xc + 0.04, yb + 0.2, 0).color(turq), T(sack(0.11, cream), xc + 0.24, yb, 0.02), lash(A, [0.2], 0.2, cream));
      else out.push(T(crate(0.28, 0.2, 0x8a5a2a), xc + 0.04, yb, 0, 0, 10, 0), G.box(0.12, 0.05, 0.07).rot(0, 20, 0).at(xc, yb + 0.23, 0.05).color(gold).pbr(0.3, 0.7), G.box(0.12, 0.05, 0.07).rot(0, -15, 0).at(xc + 0.06, yb + 0.23, -0.06).color(gold).pbr(0.3, 0.7), G.box(0.12, 0.05, 0.07).at(xc + 0.03, yb + 0.28, 0).color(gold).pbr(0.3, 0.7), lash(A, [0.14], 0.22, cream));
      return out;
    },
  };
};

DEFS.mistisles = (L) => {
  const hide = L.hide ?? 0x5a8a9a, bronze = L.trim ?? 0xb08a4a, kelp = L.cloth ?? 0x3a6a4a, mist = 0xa8fff0, fin = 0x3fc8b8, pearl = 0xf0ece0;
  const C = { hide, dark: shade(hide, 0.55), belly: 0xd4e0d8, leg: shade(hide, 0.85), claw: 0x1a2428 };
  const yc = 0.7, HX = 1.2, HY = yc + 0.74, HP = -22;
  const hd = reptHead(C, { s: 0.92, len: 0.56, scales: 0.01, eye: mist, eyeGlow: 1.1, teeth: 4 });
  const neck = [[[0.58, yc + 0.05, 0], [0.92, yc + 0.3, 0], [1.14, yc + 0.64, 0]], [0.26, 0.18, 0.13]];
  const tail = [[[-0.68, yc, 0], [-1.06, yc - 0.06, -0.05], [-1.4, yc - 0.24, -0.2], [-1.58, yc - 0.42, -0.42], [-1.5, yc - 0.52, -0.62]], [0.25, 0.17, 0.1, 0.055, 0.02]];
  let A;
  // sail rays: [x, height] along the spine; the base follows the hide
  const sailF = [[1.02, 0.1], [0.92, 0.3], [0.78, 0.4], [0.62, 0.42], [0.48, 0.3], [0.38, 0.1]], sailB = [[-0.5, 0.08], [-0.66, 0.3], [-0.84, 0.34], [-1.02, 0.26], [-1.2, 0.14], [-1.34, 0.04]];
  return {
    yc, res: 22, legRes: 22, len: 3.2,
    prims: [
      reptBody(C, { yc, xs: 0.42, xh: -0.48, tr: [0.68, 0.31, 0.37], neck, tail, sc: 0.012, sf: 10 }),
      [0.3, 0.02, -0.26, -0.56, -0.86, -1.14].map((x, i) => S.box(0.09, 0.3, 0.9).rot(0, i % 2 ? 14 : -14, 0).at(x, yc + 0.24 - (i > 3 ? (i - 3) * 0.08 : 0), 0).color(C.dark).paint(0.03)),
      [0.74, 0.94, 1.08].map((x, i) => S.box(0.07, 0.3, 0.5).rot(0, 0, -40).at(x, yc + 0.32 + i * 0.2, 0).color(C.dark).paint(0.025)),
      T(hd.p, HX, HY, 0, 0, 0, HP),
    ],
    legs: fourLegs(clawLeg(0.6, 0.085, C, { scales: 0.01, out: 0.2, claws: 4 }), clawLeg(0.6, 0.09, C, { hind: true, scales: 0.01, out: 0.2, claws: 4 }), 0.42, -0.48, 0.6, 0.27),
    hard(K) {
      const r = rig(K, { xc: -0.03, brx: 0.32, brz: 0.21, bh: 0.42, drop: 0.07, strap: 0x2a4a3a, bar: 0x8a8a7a, sling: 0xc8c0a0, max: 0.9 }); A = r.A;
      const out = [r.hard, T(hd.h, HX, HY, 0, 0, 0, HP)];
      // cheek fins and chin barbels
      out.push(T([both([-20, 15, 50].map((a, i) => feather(0.26 - i * 0.03, fin, 0x1a6a70, 0.3).rot(a + 90, 0, -60).at(-0.06, 0.03 - i * 0.03, 0.17)), G.tube([[0.34, -0.15, 0.05], [0.4, -0.3, 0.09], [0.32, -0.44, 0.12]], [0.014, 0.01, 0.004], 6, 4).color(C.dark))], HX, HY, 0, 0, 0, HP));
      // the sail: rays of spine with membrane between, on the neck and again behind the load
      const neckTop = (x) => { const u = (x - 0.38) / (1.14 - 0.38); return yc + 0.3 + u * 0.5 + 0.02; };
      const sail = (rays, base, lean) => { const a = rays.map(([x]) => [x, base(x) - 0.03, 0]), b = rays.map(([x, h]) => [x - h * lean, base(x) + h, 0]); return [web(a, b).shade((x, y, z, nx, ny, nz, i) => (i % 2 ? fin : C.dark)).pbr(0.45).glow(0.12), rays.map(([x, h], i) => G.tube([a[i], b[i]], [0.014, 0.004], 2, 4).color(0x1a4a54))]; };
      out.push(sail(sailF, (x) => K.top(x), 0.5), sail(sailB, (x) => K.top(x), 0.6));
      void neckTop;
      // bronze serpent coils round the neck
      for (const [x, y, rr] of [[0.78, yc + 0.2, 0.235], [0.9, yc + 0.32, 0.2], [1.0, yc + 0.46, 0.175]]) out.push(aim(G.tor(rr, 0.022, 14, 5).rot(90, 0, 0), [x, y, 0], [0.7, 1, 0]).color(bronze).pbr(0.35, 0.7));
      // net-slung kelp baskets hung with glass floats and shells
      out.push(flanks(A, A.yb, () => [woven(A.brx, A.brz, A.bh, { a: 0x4a7a56, b: 0x274a38, rim: 0xc8c0a0, rimR: 0.024, weave: 0.016, seg: 20, rows: 7, bulge: 0.1, taper: 0.7 }),
        [-0.2, 0.0, 0.2].map((x, k) => [rope([[x, A.bh / 2, A.brz * 0.94], [x, A.bh / 2 - 0.16 - (k % 2) * 0.05, A.brz + 0.05]], 0.006, 0xc8c0a0, 2), G.ball(0.055, 8, 6).at(x, A.bh / 2 - 0.2 - (k % 2) * 0.05, A.brz + 0.06).color(k === 1 ? mist : 0x6ad8d0).glow(k === 1 ? 1 : 0.5).pbr(0.15)]),
        [-0.1, 0.11].map((x, k) => G.cone(0.04, 0.09, 6).rot(100, 0, k ? 30 : -30).at(x, -0.12, A.brz * 0.9 + 0.03).color(pearl).pbr(0.3))]));
      // a mist-lantern on a long curved pole, out ahead of the beast
      const lx = A.xc + A.brx * 0.62, ly = A.ybar, pole = [[lx, ly - 0.06, 0.06], [lx + 0.2, ly + 0.5, 0.16], [lx + 0.7, ly + 0.86, 0.2], [lx + 1.2, ly + 0.9, 0.16], [lx + 1.5, ly + 0.76, 0.1]];
      out.push(G.tube(pole, [0.026, 0.022, 0.018, 0.014, 0.01], 14, 5).color(0x8a8a7a).pbr(0.8), rope([[lx + 1.5, ly + 0.76, 0.1], [lx + 1.5, ly + 0.58, 0.1]], 0.006, bronze, 2),
        G.ball(0.075, 8, 6).scale(1, 1.25, 1).at(lx + 1.5, ly + 0.47, 0.1).color(mist).glow(1.3).pbr(0.2), G.cone(0.085, 0.07, 6).at(lx + 1.5, ly + 0.59, 0.1).color(bronze).pbr(0.35, 0.7), G.cyl(0.05, 0.03, 0.03, 6).at(lx + 1.5, ly + 0.37, 0.1).color(bronze).pbr(0.35, 0.7));
      // a serpent-headed bronze staff behind
      const sx = A.xc - A.brx * 0.62 - 0.02;
      out.push(G.tube([[sx, ly - 0.05, -0.05], [sx - 0.04, ly + 0.4, -0.05], [sx + 0.06, ly + 0.62, -0.05], [sx - 0.04, ly + 0.8, -0.05], [sx + 0.1, ly + 0.94, -0.05]], [0.022, 0.022, 0.024, 0.028, 0.034], 12, 5).color(bronze).pbr(0.35, 0.7), G.ball(0.05, 7, 5).scale(1.6, 0.8, 1).at(sx + 0.15, ly + 0.96, -0.05).color(bronze).pbr(0.35, 0.7), G.ball(0.014, 5, 4).at(sx + 0.18, ly + 0.985, -0.02).color(mist).glow(1));
      return out;
    },
    side(K) {
      const lx = A.xc + A.brx * 0.62;
      return [K.blanket(-0.42, 0.34, 102, { style: 2, hem: (u) => 0.9 + 0.1 * Math.sin(u * PI * 6) }), H.sheet(0.07, 0.6, 1, 6, (u, v) => [Math.sin(v * 5) * 0.04, 0, Math.sin(v * 4) * 0.05]).at(lx + 0.72, A.ybar + 0.56, 0.2).pbr(0.9)];
    },
    load(K, i) {
      const y = A.yrim - 0.07, yb = A.ybar + 0.03, xc = A.xc + 0.02;
      const amph = (h, c) => [H.lathe([[0.02, 0], [0.07, h * 0.25], [0.085, h * 0.6], [0.04, h * 0.82], [0.05, h]], 9).color(c).pbr(0.55), both(G.tor(0.035, 0.008, 6, 4).at(0, h * 0.82, 0.06).color(c))];
      const fish = (n) => Array.from({ length: n }, (_, k) => [G.ball(0.05, 7, 5).scale(2.2, 0.8, 0.5).rot(0, k * 40, 12).at(-0.12 + k * 0.08, 0.05 + (k % 2) * 0.05, (k % 3 - 1) * 0.06).color(k % 2 ? 0xa8b8c0 : 0x8aa0b0).pbr(0.3, 0.3)]);
      const mixes = [(s) => [T(amph(0.3, 0x9a5a3a), -0.17, 0, 0, 0, 0, 8), T(amph(0.28, 0x5a8a7a), 0.02, 0, -0.04, 0, 0, -6), T(amph(0.26, 0xc8b08a), 0.2, 0, 0.03, 10, 0, 0)], (s) => [fish(6), G.tor(0.1, 0.03, 10, 5).rot(90, 0, 0).at(0.2, 0.05, 0).color(0xc8c0a0)], (s) => [T(sack(0.13, 0x6a8a6a), -0.15, 0, 0), G.ball(0.1, 8, 5).scale(1, 0.5, 1).at(0.14, 0.04, 0).color(0x4a3a2a), fruit(7, [pearl, 0xe8e0f0], 0.035, 0.06).map((q) => q.at(0.14, 0.04, 0))]];
      const out = [flanks(A, y, (s) => mixes[(i + (s > 0 ? 0 : 1)) % 3](s))];
      if (i === 0) out.push(T(roll(0.09, 0.46, 0xd8d4c0, 0x2a4a3a), xc, yb, 0.08, 90, 0, 0), T(roll(0.08, 0.42, kelp, 0xc8c0a0), xc, yb, -0.09, 90, 0, 0), G.tor(0.11, 0.035, 10, 5).rot(90, 0, 0).at(xc, yb + 0.2, 0).color(0xc8c0a0), lash(A, [-0.12, 0.14], 0.2, 0xc8c0a0));
      else if (i === 1) out.push(T(crate(0.26, 0.2, 0x5a6a5a), xc, yb, 0, 0, 12, 0), T(amph(0.3, 0x9a5a3a), xc - 0.02, yb + 0.26, 0.1, 80, 0, 0), T(amph(0.28, 0x5a8a7a), xc + 0.02, yb + 0.26, -0.12, 100, 0, 0), lash(A, [0.0], 0.34, 0xc8c0a0));
      else out.push(T(sack(0.15, 0x6a8a6a), xc - 0.08, yb, 0.05), T(sack(0.13, 0xa8b0a0), xc + 0.12, yb, -0.05), G.ball(0.07, 8, 6).at(xc, yb + 0.28, 0).color(0x6ad8d0).glow(0.5).pbr(0.15), lash(A, [0.02], 0.22, 0xc8c0a0));
      return out;
    },
  };
};

DEFS.dragons = (L) => {
  const hide = L.hide ?? 0x8a3a2a, bronze = 0xb8862a, ember = L.glow ?? 0xffa040;
  const C = { hide, dark: shade(hide, 0.5), belly: 0xd8b070, leg: shade(hide, 0.85), claw: 0x1a1412, horn: 0x2a2220 };
  const yc = 0.95, HX = 1.24, HY = yc + 0.68, HP = -16;
  const hd = reptHead(C, { s: 1.2, len: 0.5, scales: 0.014, eye: 0xffc030, eyeGlow: 1.1, teeth: 6 });
  hd.p.push(el(0.16, 0.1, 0.2, -0.08, 0.1, 0, C.dark, 0.05), both(el(0.06, 0.05, 0.05, 0.44, 0.03, 0.06, C.hide, 0.03)));
  const neck = [[[0.66, yc + 0.14, 0], [1.0, yc + 0.42, 0], [1.2, yc + 0.6, 0]], [0.32, 0.23, 0.18]];
  const tail = [[[-0.74, yc - 0.02, 0], [-1.12, yc - 0.16, 0.05], [-1.46, yc - 0.42, 0.2], [-1.66, yc - 0.64, 0.42], [-1.62, yc - 0.76, 0.62]], [0.33, 0.23, 0.14, 0.08, 0.04]];
  let A;
  const wing = () => {
    const sh = [0.44, yc + 0.36, 0.3], elb = [0.34, yc + 0.84, 0.5], wr = [0.2, yc + 1.06, 0.66], tips = [[-0.02, yc + 1.2, 0.84], [-0.28, yc + 0.98, 0.86], [-0.4, yc + 0.7, 0.74]];
    const a = [elb, wr, wr, wr, elb], b = [[0.36, yc + 1.0, 0.6], tips[0], tips[1], tips[2], [0.0, yc + 0.6, 0.5]];
    return [G.tube([sh, elb, wr], [0.07, 0.05, 0.035], 8, 6).color(C.hide), tips.map((t) => G.tube([wr, [(wr[0] + t[0]) / 2, (wr[1] + t[1]) / 2 + 0.03, (wr[2] + t[2]) / 2], t], [0.03, 0.02, 0.006], 5, 4).color(C.hide)),
      web(a, b).shade((x, y, z, nx, ny, nz, i) => (i % 2 ? 0xc86a30 : 0x6a2418)).pbr(0.6), spike(wr, [0.6, 1, 0.2], 0.025, 0.14, C.horn, 4)];
  };
  return {
    yc, res: 19, legRes: 19, len: 3.25,
    prims: [
      reptBody(C, { yc, xs: 0.45, xh: -0.5, tr: [0.74, 0.42, 0.42], neck, tail, chest: 1.1, chestY: 0.03, sc: 0.022, sf: 7, mottle: 0.34, mottleF: 13 }),
      both(el(0.16, 0.2, 0.12, 0.44, yc + 0.3, 0.26, C.hide, 0.08)),
      T(hd.p, HX, HY, 0, 0, 0, HP),
      S.ellipsoid(0.16, 0.2, 0.16).at(0.82, yc + 0.02, 0).color(0xff8a30).glow(0.5).paint(0.07),
    ],
    legs: fourLegs(clawLeg(0.76, 0.12, C, { scales: 0.016, out: 0.14 }), clawLeg(0.76, 0.13, C, { hind: true, scales: 0.016, out: 0.14 }), 0.45, -0.5, 0.76, 0.3),
    hard(K) {
      const r = rig(K, { xc: -0.06, brx: 0.34, brz: 0.2, bh: 0.44, drop: 0.1, strap: 0x2a1a16, bar: 0x3a2a22, sling: 0x4a4038, max: 0.92 }); A = r.A;
      const out = [r.hard, T(hd.h, HX, HY, 0, 0, 0, HP)];
      // swept horns, cheek spines, a row of dorsal spines down neck and tail
      out.push(T([both(G.tube([[-0.08, 0.1, 0.11], [-0.3, 0.2, 0.2], [-0.5, 0.36, 0.22], [-0.6, 0.54, 0.18]], [0.055, 0.045, 0.028, 0.006], 10, 6).color(C.horn).pbr(0.4), G.tube([[-0.06, 0.0, 0.17], [-0.22, 0.0, 0.26], [-0.34, 0.06, 0.3]], [0.035, 0.024, 0.005], 5, 5).color(C.horn).pbr(0.4), spike([0.1, -0.12, 0.13], [-0.3, -0.6, 0.6], 0.025, 0.12, C.horn, 4)), spike([0.42, 0.06, 0], [0.3, 1, 0], 0.03, 0.1, C.horn, 4)], HX, HY, 0, 0, 0, HP));
      for (let i = 0; i < 6; i++) { const u = i / 5, x = 1.14 - u * 0.56, y = yc + 0.84 - u * 0.36; out.push(spike([x, y - 0.03, 0], [-0.7, 1, 0], 0.04, 0.2 - Math.abs(u - 0.4) * 0.1, C.dark, 4)); }
      for (let i = 0; i < 8; i++) { const x = -0.56 - i * 0.12; out.push(spike([x, K.top(x) - 0.03, i > 3 ? (i - 3) * 0.035 : 0], [-0.6, 1, 0], 0.045 - i * 0.003, 0.22 - i * 0.018, C.dark, 4)); }
      out.push(G.octa(0.12).scale(1.5, 0.3, 1).rot(0, -70, -20).at(-1.6, yc - 0.8, 0.72).color(C.dark).pbr(0.6));
      out.push(both(wing()));
      // black scale-hide tubs bound in bronze
      const scl = (i, j) => ((i + (j & 1)) % 2 ? 0x4a1c16 : 0x2a1410);
      out.push(flanks(A, A.yb, () => [woven(A.brx, A.brz, A.bh, { pat: scl, rim: bronze, rimR: 0.03, weave: 0.014, seg: 20, rows: 8, taper: 0.82 }),
        hoop(A.brx * 0.9, A.brz * 0.9, 0.02, -A.bh * 0.28, 18).color(bronze).pbr(0.35, 0.7),
        [-0.2, 0, 0.2].map((x) => G.ball(0.03, 6, 4).at(x, A.bh * 0.12, A.brz * 0.98 + 0.01).color(bronze).pbr(0.3, 0.7)), spike([0, -0.02, A.brz + 0.01], [0, 0, 1], 0.045, 0.12, C.horn, 4)]));
      // a bronze fire-bowl smouldering at the back
      const bx = A.xc - A.brx * 0.62 - 0.02, by = A.ybar;
      out.push(H.lathe([[0.04, 0], [0.05, 0.12], [0.2, 0.22], [0.22, 0.28]], 10).at(bx, by, 0).color(bronze).pbr(0.35, 0.7), G.ball(0.17, 8, 5).scale(1, 0.4, 1).at(bx, by + 0.27, 0).color(ember).glow(1.4), [0, 2.1, 4.2].map((a) => G.rock(0.05).at(bx + Math.cos(a) * 0.09, by + 0.31, Math.sin(a) * 0.09).color(0x1a1412)), crystal([bx, by + 0.3, 0], [0.1, 1, 0], 0.05, 0.2, 0xffc040, 1.5));
      return out;
    },
    side(K) { return [K.blanket(-0.5, 0.36, 100, { style: 1, hem: (u) => 0.88 + 0.12 * Math.abs(Math.sin(u * PI * 4)) }), [-1, 1].map((s) => H.sheet(0.14, 0.4, 2, 4, (u, v) => [0, v < 0.2 ? -Math.abs(u - 0.5) * 0.16 : 0, 0]).rot(0, 90, 0).at(A.xc + A.brx * 0.62, A.ybar - 0.22, s * (A.zb - A.brz - 0.02)).pbr(0.9))]; },
    load(K, i) {
      const y = A.yrim - 0.07, yb = A.ybar + 0.03, xc = A.xc + 0.1;
      const gold = (n) => [G.ball(0.15, 8, 5).scale(1.3, 0.45, 1).at(0, 0.03, 0).color(0xe0b030).pbr(0.3, 0.7), Array.from({ length: n }, (_, k) => G.cyl(0.03, 0.03, 0.012, 6).rot(k * 37, k * 50, 0).at(Math.cos(k * 2.4) * 0.1, 0.09 + (k % 3) * 0.012, Math.sin(k * 2.4) * 0.07).color(0xf4d050).pbr(0.25, 0.8))];
      const mixes = [(s) => [T(egg(0.1, 0x3a8a8a, 0xd8c060), -0.16, 0, 0, 0, 0, 12), T(egg(0.095, 0x8a3a6a, 0xe0b0c0), 0.04, 0, -0.03, 8, 0, -8), T(egg(0.09, 0xd8c8a0, 0x8a5a2a), 0.2, 0, 0.03)], (s) => [T(gold(9), -0.06, 0, 0), T(jar(0.07, 0.2, 0x2a1a16, bronze), 0.2, 0, 0.02)], (s) => [T(sack(0.14, 0x6a4a3a), -0.15, 0, 0), T(skull(0.8, true, 0x3a302a), 0.14, 0.08, 0, 0, 30, 0), G.tube([[0.0, 0.03, 0.1], [0.14, 0.1, 0.12], [0.26, 0.05, 0.08]], 0.02, 4, 5).color(0x3a302a)]];
      const out = [flanks(A, y, (s) => mixes[(i + (s > 0 ? 0 : 1)) % 3](s))];
      const chest = (c) => [G.box(0.36, 0.2, 0.26).at(0, 0.1, 0).color(c).pbr(0.85), G.cyl(0.13, 0.13, 0.36, 8, 1).rot(0, 0, 90).scale(1, 0.6, 1).at(0, 0.2, 0).color(shade(c, 0.85)), [-0.14, 0, 0.14].map((x) => G.box(0.03, 0.3, 0.28).at(x, 0.13, 0).color(bronze).pbr(0.35, 0.7))];
      if (i === 0) out.push(T(chest(0x3a2218), xc, yb, 0, 0, 8, 0), lash(A, [0.02], 0.34, 0x4a4038));
      else if (i === 1) out.push(T(roll(0.1, 0.5, 0x4a1c16, bronze), xc, yb, 0.1, 90, 0, 0), T(roll(0.09, 0.46, 0x2a1410, bronze), xc, yb, -0.1, 90, 0, 0), T(egg(0.13, 0xd87a20, 0xffe080), xc, yb + 0.14, 0).map((q) => q.glow(0.35)), lash(A, [-0.16, 0.18], 0.2, 0x4a4038));
      else out.push(T(sack(0.17, 0x6a4a3a), xc - 0.08, yb, 0.05), T(sack(0.14, 0x8a6a4a), xc + 0.14, yb, -0.06), T(gold(6), xc + 0.02, yb + 0.26, 0, 0, 0, 0, 0.7), lash(A, [0.02], 0.26, 0x4a4038));
      return out;
    },
  };
};

// ============================================================================================
//  the endless screaming's pack-horror: a bloated many-eyed thing on chitin stilts, piping as it goes
// ============================================================================================
DEFS.screaming = (L) => {
  const hide = L.hide ?? 0x6a2a6a, brass = L.trim ?? 0xb0782a, eyeC = 0xffe640, soul = 0x9aff70, chitin = 0x221426, flesh = 0xc86a8a;
  const C = { hide, dark: shade(hide, 0.5), belly: mix(hide, flesh, 0.6) };
  const yc = 1.0;
  let A;
  const stilt = (hind) => {
    const kx = hind ? -0.1 : 0.1, Hh = 0.82;
    return { prims: [cap([0, 0, -0.08], [kx, 0.34, 0.26], 0.11, 0.08, chitin, 0.03).pbr(0.35), sph(0.095, kx, 0.34, 0.26, chitin, 0.03).pbr(0.35), cap([kx, 0.34, 0.26], [kx * 0.6, -Hh * 0.5, 0.4], 0.08, 0.055, chitin, 0.03).pbr(0.35), cap([kx * 0.6, -Hh * 0.5, 0.4], [0.02, -Hh + 0.1, 0.46], 0.055, 0.035, 0x120a14, 0.03).pbr(0.3)],
      hard: [spike([0.02, -Hh + 0.13, 0.46], [0, -1, 0], 0.036, 0.13, 0x0c060e, 5), spike([kx, 0.4, 0.3], [kx * 2, 1, 0.6], 0.035, 0.18, 0x3a1c40, 4), spike([kx * 0.75, -Hh * 0.2, 0.4], [0.2, 0.3, 1], 0.025, 0.12, 0x3a1c40, 4), G.tor(0.07, 0.014, 8, 4).rot(90, 0, 0).at(kx * 0.62, -Hh * 0.46, 0.4).color(brass).pbr(0.35, 0.7)] };
  };
  const eyes = [[1.0, 0.36, 0.0, 0.085], [0.94, 0.22, 0.24, 0.06], [0.94, 0.22, -0.24, 0.06], [0.86, 0.4, 0.2, 0.045], [0.84, 0.42, -0.18, 0.05], [1.02, 0.12, 0.12, 0.04], [1.0, 0.14, -0.13, 0.035], [0.7, 0.44, 0.06, 0.04], [0.74, 0.2, 0.38, 0.045], [0.72, 0.16, -0.39, 0.04], [0.52, 0.38, 0.32, 0.035], [0.5, 0.36, -0.33, 0.04], [-0.72, 0.2, 0.3, 0.04], [-0.76, 0.16, -0.3, 0.035]];
  const prims = [
    el(0.74, 0.5, 0.46, 0, yc, 0, C.hide, 0).bump(0.03, 5, 'noise').tint(0.3, 4),
    el(0.44, 0.48, 0.43, 0.6, yc + 0.04, 0, C.hide, 0.14).bump(0.03, 5, 'noise').tint(0.3, 4),
    el(0.42, 0.38, 0.36, -0.62, yc - 0.04, 0, C.hide, 0.14).tint(0.3, 4),
    both(el(0.2, 0.2, 0.14, 0.5, yc - 0.1, 0.34, C.dark, 0.08), el(0.2, 0.2, 0.14, -0.5, yc - 0.12, 0.3, C.dark, 0.08)),
    limb([[-0.9, yc - 0.06, 0], [-1.2, yc + 0.04, 0.04], [-1.36, yc + 0.3, 0.1], [-1.26, yc + 0.52, 0.16]], [0.2, 0.14, 0.08, 0.03], C.dark, 0.08),
    // vertebral knobs, drooping belly sacs
    [0.86, 0.66].map((x) => sph(0.08, x, yc + 0.5, 0, C.dark, 0.04)), [-0.72, -0.88].map((x) => sph(0.07, x, yc + 0.34, 0, C.dark, 0.04)),
    [[0.3, 0.16], [-0.1, -0.14], [-0.4, 0.1]].map(([x, z]) => el(0.14, 0.16, 0.14, x, yc - 0.46, z, flesh, 0.06)),
    S.ellipsoid(0.8, 0.22, 0.34).at(0, yc - 0.42, 0).color(C.belly).paint(0.1),
    // the maw
    S.ellipsoid(0.16, 0.25, 0.15).at(1.0, yc - 0.1, 0).color(0x3a0a1a).cut(0.03),
    el(0.06, 0.14, 0.07, 0.9, yc - 0.14, 0, 0xd04a6a, 0.02),
    eyes.map(([x, y, z, r]) => S.torus(r * 1.02, r * 0.42).rot(0, 0, 90).rot(0, -Math.atan2(z, 0.3) * 57, 0).at(x - 0.02, yc + y, z).color(C.dark).blend(0.02)),
  ];
  return {
    yc, res: 19, legRes: 21, len: 2.7, prims,
    legs: fourLegs(stilt(false), stilt(true), 0.5, -0.5, 0.82, 0.3),
    hard(K) {
      const r = rig(K, { xc: -0.02, brx: 0.34, brz: 0.2, bh: 0.44, drop: 0.12, strap: 0x2a1020, sling: 0x3a3a40, max: 0.9, noBar: true }); A = r.A;
      const out = [r.hard];
      for (const [x, y, z, rr] of eyes) out.push(G.ball(rr, 8, 5).at(x, yc + y, z).color(eyeC).glow(1.1).pbr(0.15), G.ball(rr * 0.42, 5, 4).scale(0.6, 1.5, 1).at(x + rr * 0.72 * (x > 0 ? 1 : 0), yc + y, z + Math.sign(z) * rr * (x > 0.8 ? 0.45 : 0.72)).color(0x0a0408));
      // teeth round the maw, tentacles about it and trailing from the back
      for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; out.push(spike([1.02 + Math.abs(Math.cos(a)) * 0.03, yc - 0.1 + Math.cos(a) * 0.22, Math.sin(a) * 0.13], [0.5, -Math.cos(a), -Math.sin(a)], 0.022, 0.1, 0xf0e8d0, 4)); }
      const tent = (pts, r0, c = C.belly) => G.tube(pts, [r0, r0 * 0.8, r0 * 0.5, r0 * 0.15], 10, 5).shade((x, y, z, nx, ny, nz, i) => (Math.floor(i / 6) % 2 ? null : shade(c, 0.72))).color(c).pbr(0.4);
      out.push(both(tent([[0.9, yc - 0.3, 0.16], [1.2, yc - 0.5, 0.26], [1.38, yc - 0.34, 0.34], [1.5, yc - 0.52, 0.3]], 0.055), tent([[0.96, yc + 0.02, 0.26], [1.24, yc + 0.06, 0.4], [1.42, yc + 0.22, 0.42], [1.46, yc + 0.42, 0.3]], 0.045), tent([[0.8, yc - 0.36, 0.1], [0.98, yc - 0.66, 0.14], [1.14, yc - 0.72, 0.06], [1.22, yc - 0.6, 0.02]], 0.05)));
      out.push(tent([[0.3, yc + 0.46, 0.1], [0.42, yc + 0.8, 0.2], [0.6, yc + 0.98, 0.14], [0.66, yc + 1.12, 0.0]], 0.05, C.hide), G.ball(0.06, 8, 6).at(0.67, yc + 1.15, 0.0).color(eyeC).glow(1.1).pbr(0.15), G.ball(0.026, 6, 5).at(0.71, yc + 1.15, 0.0).color(0x0a0408));
      out.push(tent([[-0.74, yc + 0.3, -0.14], [-0.9, yc + 0.6, -0.28], [-1.1, yc + 0.66, -0.2], [-1.2, yc + 0.5, -0.3]], 0.045, C.hide));
      for (let i = 0; i < 5; i++) out.push(spike([-0.54 - i * 0.1, K.top(-0.54 - i * 0.1) - 0.03, 0], [-0.5, 1, 0], 0.04, 0.16, chitin, 4));
      // rib-cage panniers lined with stretched skin
      const skin = (i, j) => ((i >> 1) % 2 ? 0x7a3a5a : 0x5a2244);
      out.push(flanks(A, A.yb, () => [woven(A.brx * 0.94, A.brz * 0.9, A.bh, { pat: skin, rim: BONE, rimR: 0.03, weave: 0.006, seg: 20, rows: 7, bulge: 0.1 }),
        [-0.26, -0.13, 0, 0.13, 0.26].map((x) => G.tube([[x, A.bh / 2 + 0.03, A.brz * 0.5], [x * 1.1, A.bh * 0.2, A.brz + 0.05], [x * 1.05, -A.bh * 0.3, A.brz + 0.02], [x * 0.9, -A.bh / 2 - 0.02, A.brz * 0.5]], [0.022, 0.02, 0.018, 0.01], 8, 5).color(BONE).pbr(0.55)),
        G.ball(0.045, 8, 6).at(0.0, 0.03, A.brz + 0.06).color(eyeC).glow(1.1).pbr(0.15), G.ball(0.02, 5, 4).scale(0.6, 1.5, 1).at(0.0, 0.03, A.brz + 0.1).color(0x0a0408)]));
      // three brass screaming-pipes rise from its back
      const px = A.xc - A.brx * 0.62 - 0.04;
      for (const [k, z, h] of [[0, 0, 0.9], [1, 0.16, 0.7], [2, -0.15, 0.6]]) out.push(H.lathe([[0.035, 0], [0.03, h * 0.75], [0.05, h * 0.9], [0.1, h]], 8).rot(0, 0, 14 + k * 4).at(px - k * 0.03, A.ytop - 0.05, z).color(brass).pbr(0.35, 0.7), G.cyl(0.085, 0.03, 0.02, 8).rot(0, 0, 14 + k * 4).at(px - k * 0.03 - Math.sin((14 + k * 4) * 0.01745) * h * 0.97, A.ytop - 0.05 + Math.cos((14 + k * 4) * 0.01745) * h * 0.97, z).color(0x1a0a10));
      for (const dx of [-A.brx * 0.62, A.brx * 0.62]) out.push(G.tube([[A.xc + dx, A.yrim, -A.zb], [A.xc + dx, A.ytop + 0.06, -0.2], [A.xc + dx, A.ytop + 0.07, 0.2], [A.xc + dx, A.yrim, A.zb]], 0.022, 12, 5).color(BONE).pbr(0.55));
      return out;
    },
    side(K) {
      const px = A.xc - A.brx * 0.62 - 0.04;
      return [K.blanket(-0.44, 0.4, 96, { style: 0, hem: (u) => 0.78 + 0.22 * Math.abs(Math.sin(u * 23)) }),
        H.sheet(0.36, 0.44, 5, 5, (u, v) => [0, v < 0.3 ? -Math.abs(Math.sin(u * 13)) * 0.14 : 0, Math.sin(u * 4 + v * 2) * 0.04]).shade((x, y) => { const k = y > 0.14 ? 0.5 : 1; return [k, k, k]; }).rot(0, 90, 0).at(px - 0.2, A.ytop + 0.5, 0.0).pbr(0.95)];
    },
    load(K, i) {
      const y = A.yrim - 0.07, yb = A.ytop + 0.08, xc = A.xc + 0.08;
      const soulJar = (h) => [H.lathe([[0.05, 0], [0.085, h * 0.3], [0.08, h * 0.7], [0.04, h * 0.9], [0.05, h]], 8).color(soul).glow(0.9).pbr(0.2), G.cyl(0.055, 0.055, 0.03, 8).at(0, h, 0).color(brass).pbr(0.35, 0.7), G.tor(0.086, 0.01, 8, 4).rot(90, 0, 0).at(0, h * 0.5, 0).color(0x2a1020)];
      const sacs = () => [G.ball(0.13, 8, 6).scale(1, 0.85, 1).at(-0.14, 0.1, 0).color(flesh).pbr(0.35), G.ball(0.11, 8, 6).at(0.08, 0.09, 0.03).color(0xa84a7a).pbr(0.35), G.ball(0.09, 8, 6).at(0.22, 0.07, -0.03).color(flesh).pbr(0.35), G.ball(0.03, 6, 5).at(0.1, 0.19, 0.05).color(eyeC).glow(1.1)];
      const mixes = [(s) => [T(soulJar(0.24), -0.16, 0, 0), T(soulJar(0.2), 0.03, 0, -0.03), T(soulJar(0.22), 0.2, 0, 0.03)], (s) => sacs(), (s) => [T(skull(0.85), -0.14, 0.09, 0, 0, 40, 0), T(skull(0.75), 0.06, 0.08, 0.03, 0, -60, 10), T(skull(0.7), 0.2, 0.14, -0.02, 0, 10, -20), T(soulJar(0.16), 0.0, 0, -0.1)]];
      const out = [flanks(A, y, (s) => mixes[(i + (s > 0 ? 0 : 1)) % 3](s))];
      const cage = () => [G.box(0.34, 0.03, 0.3).at(0, 0.015, 0).color(0x2a2a30).pbr(0.6, 0.35), G.box(0.34, 0.03, 0.3).at(0, 0.3, 0).color(0x2a2a30).pbr(0.6, 0.35), [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].map(([a, b]) => G.cyl(0.012, 0.012, 0.28, 4).at(a * 0.155, 0.16, b * 0.135).color(0x2a2a30).pbr(0.6, 0.35)), G.ball(0.09, 8, 6).at(0, 0.15, 0).color(soul).glow(1.2).pbr(0.2)];
      if (i === 0) out.push(T(cage(), xc, yb, 0, 0, 10, 0), lash(A, [0.08], 0.36, 0x3a3a40));
      else if (i === 1) out.push(T(sack(0.17, 0x5a3a4a), xc - 0.04, yb, 0.06), T(sack(0.14, 0x7a4a5a), xc + 0.14, yb, -0.08), T(soulJar(0.22), xc + 0.02, yb + 0.22, 0), lash(A, [0.0], 0.26, 0x3a3a40));
      else out.push(T(crate(0.3, 0.22, 0x3a2430), xc, yb, 0, 0, -8, 0), T(skull(1.0, true), xc + 0.02, yb + 0.31, 0, 0, 0, -8), lash(A, [0.16], 0.24, 0x3a3a40));
      return out;
    },
  };
};

// ============================================================================================
//  the elemental courts' pack golem: hewn boulders on four pillars, rune-lit, sprouting crystal
// ============================================================================================
DEFS.elemental = (L) => {
  const stone = L.hide ?? 0x7a7a82, glow = L.glow ?? 0xffa040, cry = 0x6ae8ff, cry2 = 0xb88aff, mossC = 0x5a7a3a, bronze = 0x9a7a3a;
  const C = { hide: stone, dark: shade(stone, 0.6), lite: shade(stone, 1.2) };
  const yc = 1.12;
  let A;
  const rk = (p, a = 0.05) => p.bump(a, 2.2, 'rock').tint(0.3, 3);
  const block = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, c = stone, k = 0.035) => rk(S.box(w, h, d, 0.07).rot(rx, ry, rz).at(x, y, z).color(c).blend(k));
  const pillar = (hind) => {
    const Hh = 0.9;
    return { prims: [block(0.36, 0.46, 0.38, 0, -0.12, 0, 0, 8, hind ? -5 : 5), block(0.3, 0.42, 0.32, hind ? -0.02 : 0.02, -0.52, 0, 0, -6, 0, C.dark), block(0.42, 0.2, 0.44, 0.03, -Hh + 0.1, 0, 0, 4, 0, C.lite),
      S.box(0.5, 0.035, 0.5).rot(4, 0, 6).at(0.0, -0.33, 0).color(glow).glow(1.2).paint(0.012, -0.012), S.box(0.02, 0.5, 0.6).rot(0, 30, 16).at(0.04, -0.6, 0).color(glow).glow(1.2).paint(0.012, -0.008)],
      hard: [crystal([hind ? -0.12 : 0.12, 0.02, 0.17], [hind ? -0.3 : 0.3, 0.6, 1], 0.05, 0.2, cry), crystal([hind ? -0.06 : 0.04, -0.06, 0.19], [0, 0.2, 1], 0.035, 0.13, cry2)] };
  };
  const cluster = (p, n, s, seed, d0 = [0, 1, 0]) => { const R = rng(seed), out = []; for (let i = 0; i < n; i++) { const dx = (R() - 0.5) * 1.3, dz = (R() - 0.5) * 1.3; out.push(crystal([p[0] + dx * 0.08 * s, p[1] - 0.03, p[2] + dz * 0.08 * s], [d0[0] + dx, d0[1], d0[2] + dz], (0.035 + R() * 0.03) * s, (0.16 + R() * 0.22) * s, i % 3 === 2 ? cry2 : cry, 0.9)); } return out; };
  const tub = (w, h, d) => [G.rock(0.5, 0).scale(w * 1.12, h * 1.25, d * 1.12).shade((x, y) => (y > 0.3 ? null : null)).color(C.dark).pbr(0.9), G.box(w * 0.92, h * 0.4, d * 0.9).at(0, h * 0.34, 0).color(shade(stone, 0.85)).pbr(0.9), G.box(w * 0.8, 0.02, d * 0.74).at(0, h * 0.545, 0).color(0x1c1c20),
    G.box(w * 0.99, 0.05, d * 0.99).at(0, h * 0.44, 0).color(bronze).pbr(0.4, 0.6),
    [G.box(0.03, 0.18, 0.02), G.box(0.12, 0.03, 0.02).at(0, 0.05, 0), G.box(0.03, 0.1, 0.02).rot(0, 0, 40).at(0.05, -0.04, 0)].map((q) => q.at(0, -0.02, d * 0.55).color(glow).glow(1.3))];
  return {
    yc, res: 20, legRes: 18, len: 2.6,
    prims: [
      block(1.5, 0.66, 0.84, -0.02, yc, 0, 0, 0, 2),
      block(0.66, 0.84, 0.94, 0.5, yc + 0.1, 0, 4, 6, -6, C.lite),
      block(0.6, 0.7, 0.88, -0.56, yc + 0.0, 0, -3, -5, 5, C.dark),
      block(0.4, 0.3, 0.6, 0.0, yc + 0.36, 0, 0, 12, 0),
      // the head: a wedge of boulder with a slab jaw and a brow
      block(0.5, 0.42, 0.52, 1.06, yc + 0.24, 0, 0, 0, -12, stone, 0.05),
      block(0.4, 0.15, 0.42, 1.14, yc - 0.03, 0, 0, 0, -6, C.dark, 0.02),
      block(0.2, 0.12, 0.58, 1.2, yc + 0.42, 0, 0, 0, -14, C.lite, 0.02),
      S.box(0.14, 0.07, 0.7).at(1.28, yc + 0.3, 0).color(0x1a1a20).cut(0.01),
      // moss on the high places, glowing seams where the blocks meet
      S.ellipsoid(0.34, 0.1, 0.4).at(0.5, yc + 0.54, 0).color(mossC).paint(0.07), S.ellipsoid(0.3, 0.1, 0.36).at(-0.6, yc + 0.37, 0).color(mossC).paint(0.07), S.ellipsoid(0.2, 0.08, 0.2).at(1.0, yc + 0.47, 0).color(mossC).paint(0.06),
      [[0.16, 0, 0, 8], [-0.26, 0, 0, -10]].map(([x, , , a]) => S.box(0.024, 1.2, 1.4).rot(0, 0, a).at(x, yc, 0).color(glow).glow(1.3).paint(0.012, -0.012)),
      both(S.box(0.5, 0.024, 0.3).rot(0, 0, 24).at(0.56, yc + 0.02, 0.44).color(glow).glow(1.3).paint(0.012, -0.012), S.box(0.024, 0.34, 0.3).rot(0, 0, -30).at(0.5, yc + 0.12, 0.44).color(glow).glow(1.3).paint(0.012, -0.012), S.torus(0.13, 0.016).rot(90, 0, 0).at(-0.58, yc + 0.02, 0.42).color(glow).glow(1.3).paint(0.012, -0.012)),
    ],
    legs: fourLegs(pillar(false), pillar(true), 0.52, -0.56, 0.9, 0.3),
    hard(K) {
      const r = rig(K, { xc: -0.04, brx: 0.36, brz: 0.2, bh: 0.4, drop: 0.14, strap: bronze, bar: 0x4a4a52, sling: 0x3a3a40, max: 0.94 }); A = r.A;
      const out = [r.hard];
      out.push(both(G.box(0.03, 0.05, 0.11).at(1.3, yc + 0.3, 0.14).color(glow).glow(1.6)));
      out.push(cluster([0.56, K.top(0.56), 0.3], 5, 1.2, 3, [0.3, 1, 0.5]), cluster([0.6, K.top(0.6), -0.32], 4, 1.0, 4, [0.3, 1, -0.5]), cluster([-0.74, K.top(-0.74), 0.0], 6, 1.3, 5, [-0.6, 1, 0]), cluster([0.94, yc + 0.48, 0.0], 3, 0.8, 6, [-0.5, 1, 0]));
      out.push(flanks(A, A.yb, () => tub(A.brx * 2, A.bh, A.brz * 2)));
      { const R = rng(17); for (const [x, y, z, r] of [[0.78, yc + 0.46, 0.34, 0.16], [0.74, yc + 0.44, -0.36, 0.14], [0.3, yc - 0.22, 0.42, 0.13], [-0.82, yc + 0.26, 0.36, 0.15], [-0.84, yc + 0.22, -0.34, 0.13], [-0.3, yc - 0.26, -0.42, 0.12], [1.02, yc + 0.5, 0.2, 0.1], [1.26, yc + 0.12, -0.2, 0.08], [-0.9, yc - 0.2, 0.0, 0.16], [0.86, yc - 0.28, 0.0, 0.14]]) out.push(G.rock(r).rot(R() * 90, R() * 90, R() * 90).scale(1.2, 0.9, 1).at(x, y, z).color(R() > 0.5 ? C.lite : C.dark).pbr(0.9)); }
      // a standing rune-stone at the back of the load
      const mx = A.xc - A.brx * 0.62 - 0.02, my = A.ybar - 0.04;
      out.push(G.rock(0.5, 0).scale(0.24, 1.0, 0.36).at(mx, my + 0.4, 0).color(C.lite).pbr(0.9), [[0.62, 0], [0.46, 20], [0.3, -30]].map(([y, a]) => [G.box(0.02, 0.1, 0.03).rot(a, 0, 0).at(mx + 0.11, my + y, 0).color(glow).glow(1.4), G.box(0.02, 0.03, 0.1).rot(a, 0, 0).at(mx + 0.11, my + y + 0.02, 0).color(glow).glow(1.4)]));
      return out;
    },
    side(K) { return [K.blanket(-0.44, 0.36, 86, { style: 3, off: 0.03 }), [-1, 1].map((s) => G.octa(0.07).scale(0.5, 1.2, 1).shade(() => [1.3, 1.3, 1.3]).at(A.xc + A.brx * 0.62 + 0.05, A.yb + 0.06, s * (A.zb + A.brz + 0.04)))]; },
    load(K, i) {
      const y = A.yrim - 0.02, yb = A.ybar + 0.03, xc = A.xc + 0.1;
      const ore = (c, n, seed, s = 1) => { const R = rng(seed), out = []; for (let k = 0; k < n; k++) out.push(G.rock(0.06 + R() * 0.04).rot(R() * 90, R() * 90, 0).at((R() - 0.5) * 0.44 * s, 0.05 + R() * 0.08, (R() - 0.5) * 0.2 * s).color(k % 3 ? c : shade(c, 0.7)).pbr(0.5, k % 3 ? 0.3 : 0)); return out; };
      const mixes = [(s) => ore(0xc8a040, 8, 11), (s) => [cluster([-0.12, 0.02, 0], 5, 1.0, 21), cluster([0.14, 0.02, 0.02], 4, 0.8, 22), ore(0x4a4a56, 3, 23, 0.6)], (s) => [ore(0x3a8a6a, 5, 31), ore(0x8a4a3a, 4, 32)]];
      const out = [flanks(A, y, (s) => mixes[(i + (s > 0 ? 0 : 1)) % 3](s))];
      if (i === 0) out.push(cluster([xc, yb + 0.02, 0], 7, 1.8, 41), G.rock(0.14).scale(1.4, 0.6, 1.2).at(xc, yb + 0.05, 0).color(C.dark), lash(A, [0.2], 0.1, 0x3a3a40));
      else if (i === 1) out.push([0, 1, 2].map((k) => G.box(0.4, 0.07, 0.3).rot(0, k * 9 - 6, 0).at(xc, yb + 0.04 + k * 0.075, 0).color(k % 2 ? C.lite : stone).pbr(0.9)), G.box(0.2, 0.012, 0.03).rot(0, 12, 0).at(xc, yb + 0.232, 0).color(glow).glow(1.4), G.box(0.03, 0.012, 0.16).rot(0, 12, 0).at(xc, yb + 0.232, 0).color(glow).glow(1.4), lash(A, [0.1], 0.26, 0x3a3a40));
      else out.push(ore(0x4a4a56, 7, 51, 1.1).map((q) => q.at(xc, yb, 0)), ore(0xc8a040, 4, 52, 0.7).map((q) => q.at(xc, yb + 0.1, 0)), cluster([xc + 0.1, yb + 0.14, 0.05], 3, 1.0, 53), lash(A, [0.0], 0.24, 0x3a3a40));
      return out;
    },
  };
};

// ============================================================================================
//  assembly and cache
// ============================================================================================
const KITS = new Map(), SIDE = new Map();
const sideMat = (c) => { let m = SIDE.get(c); if (!m) SIDE.set(c, m = new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide })); return m; };
function kitFor(L) {
  const fac = DEFS[L.faction] ? L.faction : 'beasts', key = fac === L.faction ? fac : `beasts:${L.hide ?? 0}`;
  let kit = KITS.get(key);
  if (kit) return kit;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const D = DEFS[fac](L), prims = flat([D.prims]), K = mkK(distanceField(prims), D.yc);
  const body = buildPartGeometry({ prims, hard: flat([D.hard(K)]) }, { res: D.res || 26, ao: 0.7 });
  const side = buildPartGeometry({ hard: flat([D.side(K)]) }, { ao: 0 });
  const done = new Map();
  const legs = D.legs.map((l) => { let g = done.get(l.part); if (!g) done.set(l.part, g = buildPartGeometry({ prims: flat([l.part.prims]), hard: flat([l.part.hard || []]) }, { res: D.legRes || 20, ao: 0.6 })); return { ...l, geo: g }; });
  kit = { D, K, body, side, legs, loads: [], ms: 0 };
  kit.loads[0] = buildPartGeometry({ hard: flat([D.load(K, 0)]) }, { ao: 0 });
  kit.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  KITS.set(key, kit);
  return kit;
}
const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };

export function buildPackBeast(look, sideColor, index = 0) {
  const L = look || {}, kit = kitFor(L), i = ((index | 0) % 3 + 3) % 3, mat = sculptMaterial();
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  body.add(mesh(kit.body, mat));
  if (kit.side) body.add(mesh(kit.side, sideMat(sideColor ?? 0x888888)));
  const load = kit.loads[i] || (kit.loads[i] = buildPartGeometry({ hard: flat([kit.D.load(kit.K, i)]) }, { ao: 0 }));
  if (load) body.add(mesh(load, mat));
  const legs = [];
  for (const l of kit.legs) {
    const piv = new THREE.Group(); piv.position.set(l.x, l.y, l.z);
    const m = mesh(l.geo, mat); if (l.flip) m.scale.z = -1;
    piv.add(m); body.add(piv); legs.push({ piv, ph: l.ph });
  }
  g.userData.body = body; g.userData.legs = legs; g.userData.len = kit.D.len; g.userData.beast = true; g.userData.buildMs = kit.ms;
  return g;
}
