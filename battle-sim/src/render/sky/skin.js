// Vertex-coloured skins for the realm airships, drawn at sculpt-shader quality straight into one geometry each:
// the gas envelope (puffed gores between sunken seams, sewn cloth panels, stitched patches, sun-faded tops and
// grimy bellies) and the planked gondola hull (lapstrake strakes, per-plank tone, butt joints, treenails, tar).
// Each comes in four damage states built on first use and cached by design: shot holes with charred rims, then
// burning tears (the rims glow) that show the frame inside, then (envelope) the bag collapsed into wrinkles.
//
//   envelopeGeo(key, prof, o, q, lv) / hullSkinGeo(key, o, q, lv) -> BufferGeometry (position normal color aPbr)
//   skinMesh(X, parent, make)   a mesh drawn with the model's paint material, kept out of the baker, with its own
//                               level-of-detail entry; X.skins remembers it so setDamage can swap its state
import * as THREE from 'three';
import { EMPTY, RES } from './kit.js';

const TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (v) => v - Math.floor(v);
function h1(n) { let h = Math.imul((n | 0) ^ 0x9e3779b9, 374761393); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h1(xi * 73856093 ^ yi * 19349663), b = h1((xi + 1) * 73856093 ^ yi * 19349663), c = h1(xi * 73856093 ^ (yi + 1) * 19349663), d = h1((xi + 1) * 73856093 ^ (yi + 1) * 19349663);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
const _c = new THREE.Color();
export const lin = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
const mulc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const CHAR = [0.035, 0.025, 0.02], EMBER = [1.0, 0.36, 0.06], SOOT = [0.09, 0.075, 0.065];

const CACHE = new Map();
function cached(key, make) { if (!CACHE.has(key)) CACHE.set(key, make()); return CACHE.get(key); }

/** the grid: verts (nu+1) x (nv+1), each [x, y, z, r, g, b, rough, metal, glow]; drop(i, j) removes the cell */
function gridGeo(nu, nv, vert, drop = null) {
  const n = (nu + 1) * (nv + 1), P = new Float32Array(n * 3), C = new Float32Array(n * 3), M = new Float32Array(n * 3);
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const o = i * (nv + 1) + j, v = vert(i / nu, j / nv);
    P[o * 3] = v[0]; P[o * 3 + 1] = v[1]; P[o * 3 + 2] = v[2];
    C[o * 3] = v[3]; C[o * 3 + 1] = v[4]; C[o * 3 + 2] = v[5];
    M[o * 3] = v[6]; M[o * 3 + 1] = v[7]; M[o * 3 + 2] = v[8];
  }
  const idx = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    if (drop && drop((i + 0.5) / nu, (j + 0.5) / nv)) continue;
    const a = i * (nv + 1) + j, b = a + nv + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
  g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------
// damage: where the holes are (shared by every detail level, growing with the level)
// ---------------------------------------------------------------------------------------------
/** holes in (u along 0..1, a around 0..1) with radius in model units; level 1 two shot holes, 2 burning tears, 3 great rents */
function holesOf(seed, lv, scale, aRange = [0, 1]) {
  const out = [];
  const add = (n, r0, r1, s0) => { for (let i = 0; i < n; i++) { const s = seed * 31 + s0 + i * 7; out.push({ u: 0.15 + 0.7 * h1(s), a: lerp(aRange[0], aRange[1], h1(s + 3)), r: scale * lerp(r0, r1, h1(s + 5)), lv: s0 }); } };
  if (lv >= 1) add(3, 0.16, 0.3, 1);
  if (lv >= 2) add(3, 0.3, 0.55, 2);
  if (lv >= 3) add(4, 0.6, 1.0, 3);
  return out;
}

// ---------------------------------------------------------------------------------------------
// the envelope: a surface of revolution about local +y from prof [[r, y], ...]
// ---------------------------------------------------------------------------------------------
/**
 * o: { gores, colA, colB (hex), single, seam (hex), up: [x, y, z] local direction of the sky, panel (sewn panel length),
 *      patches (how many), patchCols: [hex], seed, glowA (a lit lantern skin: base glow) }
 */
export function envelopeGeo(key, prof, o, q, lv) {
  return cached(`env|${key}|${q}|${lv}`, () => {
    const G = o.gores || 12, seed = o.seed || 1;
    // arc length along the profile, for the panel seams and hole sizes
    const arc = [0];
    for (let i = 1; i < prof.length; i++) arc.push(arc[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
    const Ltot = arc[arc.length - 1], Rmax = Math.max(...prof.map((p) => p[0])), yLo = Math.min(...prof.map((p) => p[1])), yHi = Math.max(...prof.map((p) => p[1]));
    const at = (u) => {
      const s = u * Ltot; let i = 1; while (i < arc.length - 1 && arc[i] < s) i++;
      const f = clamp((s - arc[i - 1]) / Math.max(1e-6, arc[i] - arc[i - 1]), 0, 1);
      return [lerp(prof[i - 1][0], prof[i][0], f), lerp(prof[i - 1][1], prof[i][1], f)];
    };
    const qk = [1, 0.66, 0.42, 0.26][q];
    const nu = Math.max(10, Math.round(Ltot * 12 * qk)), nv = Math.max(G * 2, Math.round(Math.max(G * 9, TAU * Rmax * 11) * qk / G) * G);
    const A = lin(o.colA), B = o.single ? A : lin(o.colB ?? o.colA), seamC = lin(o.seam ?? 0x3a3028), up = new THREE.Vector3(...(o.up || [0, 1, 0])).normalize();
    const pCols = (o.patchCols || [0x8a6a4a, 0xa8987a, 0x6a4a5a, 0xc8b070]).map((c) => mixc(lin(c), mixc(lin(o.colA), [0.32, 0.26, 0.2], 0.5), 0.45));
    const patches = [];
    for (let k = 0; k < (o.patches ?? 3); k++) { const s = seed * 17 + k * 13; patches.push({ u0: 0.12 + 0.7 * h1(s), du: (0.5 + 0.9 * h1(s + 1)) / Ltot, a0: h1(s + 2), da: (0.5 + 0.7 * h1(s + 4)) / (TAU * Rmax), c: pCols[k % pCols.length] }); }
    const holes = holesOf(seed, lv, Math.max(1, Rmax * 0.7));
    // distance (model units) from (u, a) to a hole centre, wrapping around
    const hd = (u, a, r, hh) => { let da = Math.abs(a - hh.a); da = Math.min(da, 1 - da); return Math.hypot((u - hh.u) * Ltot, da * TAU * Math.max(0.2, r)); };
    const collapse = lv >= 3;
    const vert = (u, a) => {
      let [r, y] = at(u);
      const th = a * TAU, s = fract(a * G), gi = Math.floor(a * G);
      const puff = Math.pow(Math.sin(PI * s), 0.45), seamG = Math.max(0, 1 - Math.min(s, 1 - s) * G * TAU * Math.max(0.3, r) / 0.06);
      const pl = fract((u * Ltot) / (o.panel || 1.1)), panelG = Math.max(0, 1 - Math.min(pl, 1 - pl) * (o.panel || 1.1) / 0.035);
      let inPatch = null, pEdge = 0;
      for (const P of patches) {
        let da = a - P.a0; da -= Math.round(da);
        const du = u - P.u0;
        if (du > 0 && du < P.du && da > 0 && da < P.da) { inPatch = P; pEdge = Math.min(du / P.du, 1 - du / P.du, da / P.da, 1 - da / P.da); break; }
      }
      let rr = r * (1 + 0.016 * puff - 0.006 * seamG - 0.003 * panelG) + (inPatch ? 0.012 * Math.min(1, pEdge * 25) : 0);
      if (collapse) rr = r * (0.5 + 0.12 * Math.sin(th * 5 + y * 2.3) + 0.08 * Math.sin(th * 11 - y * 4.1) + 0.06 * vnoise(u * 9, a * 13));
      let x = Math.sin(th) * rr, z = Math.cos(th) * rr;
      // sun on top, grime underneath (in the ship's own up direction)
      const nUp = Math.sin(th) * up.x + Math.cos(th) * up.z + up.y * ((y - (yLo + yHi) / 2) / Math.max(0.1, (yHi - yLo) / 2));
      let c = (gi % 2 ? B : A);
      const mott = 1 + 0.07 * (vnoise(u * 40, a * 60) - 0.5) + 0.05 * (vnoise(u * 7, a * 9) - 0.5);
      c = mulc(c, mott * (1 + 0.1 * clamp(nUp, 0, 1) - 0.22 * clamp(-nUp, 0, 1)));
      if (inPatch) { c = mulc(inPatch.c, mott); if (pEdge < 0.07 && fract((u * Ltot + a * 40) * 9) < 0.55) c = mulc(seamC, 0.9); }
      c = mixc(c, seamC, 0.55 * seamG + 0.3 * panelG);
      if (seamG > 0.4 && fract(u * Ltot * 14) < 0.5) c = mixc(c, mulc(seamC, 0.7), 0.6);         // the stitching
      let ro = 0.8, gl = o.glowA || 0;
      if (collapse) { c = mulc(c, 0.75 + 0.25 * vnoise(u * 12, a * 20)); y -= r * 0.35 * clamp(nUp, 0, 1); x -= up.x * r * 0.35 * clamp(nUp, 0, 1); z -= up.z * r * 0.35 * clamp(nUp, 0, 1); }
      // scorching and the charred, burning rims of the holes
      for (const hh of holes) {
        const d = hd(u, a, r, hh), rim = hh.r * 1.55;
        if (d < rim) {
          const k = 1 - (d - hh.r) / (rim - hh.r);
          c = mixc(c, CHAR, clamp(k, 0, 1) * 0.92);
          if (hh.lv >= 2 && d < hh.r * 1.2 && lv < 3) { c = mixc(c, EMBER, 0.7); gl = Math.max(gl, 0.9); }
          ro = 0.95;
        } else if (d < hh.r * 3.2) c = mixc(c, SOOT, 0.35 * (1 - (d - rim) / (hh.r * 3.2 - rim)));
      }
      return [x, y, z, c[0], c[1], c[2], ro, 0, gl];
    };
    const drop = holes.length ? (u, a) => { const r = at(u)[0]; return holes.some((hh) => hd(u, a, r, hh) < hh.r * (0.8 + 0.4 * vnoise(u * 30 + hh.u * 9, a * 40))); } : null;
    return gridGeo(nu, nv, vert, drop);
  });
}

// ---------------------------------------------------------------------------------------------
// the gondola hull: a parametric skin pt(t along 0 stern..1 bow, f around 0 starboard rail .. PI port rail)
// ---------------------------------------------------------------------------------------------
/** o: { pt(t, f, k), HL, col (hex), strakes, wicker, seed } */
export function hullSkinGeo(key, o, q, lv) {
  return cached(`hull|${key}|${q}|${lv}`, () => {
    const qk = [1, 0.62, 0.4, 0.25][q], ns = o.strakes || 7;
    const nu = Math.max(12, Math.round(o.HL * 12 * qk)), nv = Math.max(ns * 2, Math.round(ns * 7 * qk));
    const base = lin(o.col), tar = mulc(base, 0.32), seed = o.seed || 1;
    const holes = holesOf(seed + 5, lv, 0.8, [0.12, 0.88]);
    const plank = 1.3;
    const fOf = (a) => a * PI;
    const vert = (t, a) => {
      const f = fOf(a), side = a < 0.5 ? 1 : -1;
      // which strake (counted from the rail down to the keel on each side) and how far across it
      const fs = side > 0 ? f / (PI / 2) : (PI - f) / (PI / 2), sk = fs * ns / 2, si = Math.floor(sk), sf = sk - si;
      const x0 = t * o.HL, off = h1(si * 7 + (side > 0 ? 0 : 3)) * plank, pi = Math.floor((x0 + off) / plank), pf = fract((x0 + off) / plank);
      const groove = (o.wicker ? 0.012 : 0.006) * (sf < 0.06 ? 1 - sf / 0.06 : 0) + 0.004 * (pf < 0.015 || pf > 0.985 ? 1 : 0);
      const clinker = o.wicker ? 0.01 * Math.sin(sf * PI) : 0.012 * sf;    // each strake laps over the one below
      const k = 1 + clinker / 0.8 - groove / 0.8;
      const p = o.pt(t, f, k);
      let c = mulc(base, 0.82 + 0.3 * h1(si * 131 + pi * 17 + seed) + 0.08 * (vnoise(x0 * 3 + si * 5, sf * 4) - 0.5));
      c = mulc(c, 1 + 0.1 * (vnoise(x0 * 22, sf * 2 + si * 9) - 0.5));              // the grain
      if (o.wicker) c = mulc(c, 0.85 + 0.3 * Math.abs(Math.sin(x0 * 40 + sf * 6)));
      if (sf < 0.06 || pf < 0.015 || pf > 0.985) c = mulc(c, 0.45);                   // the seams
      if ((pf < 0.05 || pf > 0.95) && Math.abs(sf - 0.5) < 0.12) c = mixc(c, [0.12, 0.1, 0.08], 0.7);   // treenails at the butts
      if (fs > 0.9) c = mixc(c, tar, 0.75);                                              // tarred keel band
      let ro = 0.78, gl = 0;
      for (const hh of holes) {
        let d = Math.hypot((t - hh.u) * o.HL, (a - hh.a) * PI * 0.9), rim = hh.r * 1.7;
        if (d < rim) { c = mixc(c, CHAR, clamp(1 - (d - hh.r) / (rim - hh.r), 0, 1) * 0.9); ro = 0.95; if (hh.lv >= 2 && d < hh.r * 1.15 && lv < 3) { c = mixc(c, EMBER, 0.6); gl = 0.7; } }
        else if (d < hh.r * 3.4) c = mixc(c, SOOT, 0.4 * (1 - (d - rim) / (hh.r * 3.4 - rim)));
      }
      return [p[0], p[1], p[2], c[0], c[1], c[2], ro, 0, gl];
    };
    const drop = holes.length ? (t, a) => holes.some((hh) => Math.hypot((t - hh.u) * o.HL, (a - hh.a) * PI * 0.9) < hh.r * (0.75 + 0.5 * vnoise(t * 50 + hh.u * 9, a * 30))) : null;
    const g = gridGeo(nu, nv, vert, drop);
    g.userData.holes = holes;
    return g;
  });
}

/** a point on an envelope (model units, the envelope's own frame) at (u along, a around) and its outward direction */
export function envPoint(prof, u, a) {
  const arc = [0];
  for (let i = 1; i < prof.length; i++) arc.push(arc[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const s = u * arc[arc.length - 1]; let i = 1; while (i < arc.length - 1 && arc[i] < s) i++;
  const f = clamp((s - arc[i - 1]) / Math.max(1e-6, arc[i] - arc[i - 1]), 0, 1), r = lerp(prof[i - 1][0], prof[i][0], f), y = lerp(prof[i - 1][1], prof[i][1], f), th = a * TAU;
  return { p: [Math.sin(th) * r, y, Math.cos(th) * r], n: [Math.sin(th), 0, Math.cos(th)], r };
}
export { holesOf };
/** a skin mesh with its own detail levels and damage states: make(q, lv) -> geometry */
export function skinMesh(X, parent, make, kind = 'bag') {
  const m = new THREE.Mesh(make(0, 0), X.T.paint);
  m.userData.keep = true; m.castShadow = true; m.name = kind;
  parent.add(m);
  (X.skins ||= []).push({ mesh: m, make, kind });
  return m;
}
/** lod entries for the skins (call after the bake) */
export function skinLod(X) {
  return (X.skins || []).map((s) => { s.entry = { mesh: s.mesh, geos: RES.map((q) => s.make(q, 0)) }; return s.entry; });
}
/** swap every skin to damage level lv, keeping the current detail level */
export function skinDamage(X, lv, level) {
  for (const s of X.skins || []) {
    s.entry.geos = RES.map((q) => s.make(q, lv));
    const g = s.entry.geos[Math.min(level, 5)];
    s.mesh.visible = g !== EMPTY; if (s.mesh.visible) s.mesh.geometry = g;
  }
}
