// Finer sculpts of the supply-line pump handcars, one design per faction (see props/transit.js for the contract).
//   buildHandcar(look, sideColor, index) -> Object3D
//     +x forward, origin at track centre on the rail tops, deck top at y = 0.58, crew stand at x = +-0.62,
//     userData.beam is the walking beam (pivot at 0, 1.3, 0) the game rocks, userData.len/deck/phase as the plain car.
// Every car is merged by material into a handful of meshes (vertex-coloured); geometry is cached per faction and index,
// so only the first car of a kind costs anything to build.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const D = 0.58, H = Math.PI / 2, PI = Math.PI, TAU = Math.PI * 2;
const GOLD = 0xd8a838, BONE = 0xe6dec6, ROPE = 0xb89c66, CRATE = 0xa07a4a, SACK = 0xb8a888, STRAW = 0xc8b070, STONE = 0x8a8a84, BRASS = 0xb8923a, COPPER = 0xb8683a, DARK = 0x141416;

// ---- materials (shared by every car) ----------------------------------------------------------
const MAT = {
  w: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }),
  m: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.5 }),
  g: new THREE.MeshBasicMaterial({ vertexColors: true }),
  c: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
};
const sideMats = new Map();
const sideMat = (c) => { if (!sideMats.has(c)) sideMats.set(c, new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, emissive: c, emissiveIntensity: 0.22 })); return sideMats.get(c); };

// ---- the kit: everything is emitted into per-material buckets and merged at the end -----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
let K = null, L = null; // the kit and the look of the car being built
function emit(bucket, geo, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const g = geo.clone();
  if (rx && rx.isQuaternion) _q.copy(rx); else _q.setFromEuler(_e.set(rx, ry, rz));
  _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)).premultiply(K.top);
  g.applyMatrix4(_m);
  const n = g.attributes.position.count, a = new Float32Array(n * 3); _c.setHex(col);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  (K.g[K.pre + bucket] ||= []).push(g);
}
const Wd = (...a) => emit('w', ...a), Mt = (...a) => emit('m', ...a), Gl = (...a) => emit('g', ...a), Cl = (...a) => emit('c', ...a), Sd = (geo, ...a) => emit('s', geo, 0xffffff, ...a);
function at(x, y, z, rx, ry, rz, s, fn) {
  const old = K.top; K.top = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s)).premultiply(old);
  fn(); K.top = old;
}
function inBeam(fn) { const old = K.top; K.top = new THREE.Matrix4(); K.pre = 'b'; fn(); K.pre = ''; K.top = old; }
const frac = (x) => x - Math.floor(x);
const rnd = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);
const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
const blend = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// ---- primitive geometries (memoised, non-indexed, position + normal only) ----------------------
const memo = new Map();
function mk(key, f) {
  let g = memo.get(key);
  if (!g) { g = f(); if (g.index) g = g.toNonIndexed(); for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n); memo.set(key, g); }
  return g;
}
const box = (w, h, d) => mk(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const rb = (w, h, d, r = 0.02, s = 1) => mk(`r${w},${h},${d},${r},${s}`, () => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)));
const cyl = (a, b, h, n = 14, open = false) => mk(`c${a},${b},${h},${n},${open}`, () => new THREE.CylinderGeometry(a, b, h, n, 1, open));
const cone = (r, h, n = 10) => mk(`k${r},${h},${n}`, () => new THREE.ConeGeometry(r, h, n));
const ball = (r, w = 12, h = 8) => mk(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const hemi = (r, w = 12, h = 4) => mk(`h${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h, 0, TAU, 0, H));
const tor = (R, r, rs = 6, ts = 18, arc = TAU) => mk(`t${R},${r},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const lathe = (pts, n = 14) => mk(`l${n}${pts}`, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), n));
const tube = (pts, r, seg = 12, rs = 6, closed = false) => mk(`u${r},${seg},${rs},${closed}${pts}`, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed), seg, r, rs, closed));
const oct = (r) => mk(`o${r}`, () => new THREE.OctahedronGeometry(r));
const ico = (r) => mk(`i${r}`, () => new THREE.IcosahedronGeometry(r, 0));
const pyr = () => mk('pyr', () => new THREE.ConeGeometry(0.7071, 1, 4).rotateY(PI / 4)); // unit square pyramid, base 1x1, height 1 (centred)
const frus = (t) => mk(`fr${t}`, () => new THREE.CylinderGeometry(0.7071 * t, 0.7071, 1, 4).rotateY(PI / 4)); // unit square frustum, top = t
const prism = (key, pts, depth) => mk(`p${key}${depth}`, () => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2); });
const shieldGeo = (w, h) => mk(`sh${w},${h}`, () => { const s = new THREE.Shape(); s.moveTo(-w / 2, h / 2); s.lineTo(w / 2, h / 2); s.lineTo(w / 2, 0); s.quadraticCurveTo(w / 2, -h * 0.32, 0, -h / 2); s.quadraticCurveTo(-w / 2, -h * 0.32, -w / 2, 0); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false, curveSegments: 5 }); });
/** a flag flying from a hoist at x = 0, trailing toward -x */
const flagGeo = (w, h, kind = 'swallow') => mk(`f${w},${h},${kind}`, () => {
  const g = new THREE.PlaneGeometry(w, h, 8, 4), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) + w / 2, y = p.getY(i); const t = x / w, v = y / (h / 2);
    if (kind === 'point') y *= 1 - t * 0.96;
    else if (kind === 'swallow') { y *= 1 - t * 0.2; if (t > 0.55) x -= ((t - 0.55) / 0.45) * w * 0.34 * (1 - Math.abs(v)); }
    else if (kind === 'rag') { if (t > 0.7) x -= w * 0.3 * frac(Math.sin((v + 2) * 37.7) * 91.3) * ((t - 0.7) / 0.3); y -= t * t * h * 0.2; }
    p.setXYZ(i, -x, y, Math.sin(t * 5.5) * 0.09 * t * w);
  }
  g.computeVertexNormals(); return g;
});
/** a banner hanging from a bar: top edge at y = 0, in the x-y plane */
const hangGeo = (w, h, kind = 'rect') => mk(`g${w},${h},${kind}`, () => {
  const g = new THREE.PlaneGeometry(w, h, 6, 6), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); let y = p.getY(i) - h / 2; const u = x / (w / 2), t = -y / h;
    if (t > 0.99) { if (kind === 'point') y += Math.abs(u) * h * 0.22; else if (kind === 'swallow') y += (1 - Math.abs(u)) * h * 0.22; else if (kind === 'rag') y += frac(Math.sin((u + 2) * 53.1) * 77.7) * h * 0.3; }
    p.setXYZ(i, x, y, Math.sin(t * 4 + u) * 0.025 * t);
  }
  g.computeVertexNormals(); return g;
});
const RIV = () => cyl(0.013, 0.013, 0.014, 6);

// ---- running gear and frame ------------------------------------------------------------------
function frame(o = {}) {
  const sb = o.sillB || 'm', sc = o.sill ?? L.metal, hc = o.head ?? sc, rc = o.rivet ?? L.trim;
  if (!o.noSill) for (const z of [-0.41, 0.41]) {
    emit(sb, rb(2.62, 0.12, 0.07, 0.015), sc, 0, 0.46, z);
    if (o.rivets !== false) for (let k = 0; k < 14; k++) Mt(RIV(), rc, -1.2 + k * (2.4 / 13), 0.425, z * 1.098, H);
  }
  for (const x of [-1.31, 1.31]) {
    emit(sb, rb(0.09, 0.16, 0.96, 0.02), hc, x, 0.46, 0);
    for (const z of [-0.28, 0.28]) { Mt(cyl(0.022, 0.022, 0.07, 8), shade(L.metal, 0.8), x * 1.04, 0.44, z, 0, 0, H); Mt(cyl(0.05, 0.05, 0.025, 12), o.buffer ?? L.metal, x * 1.075, 0.44, z, 0, 0, H); }
    Mt(rb(0.1, 0.05, 0.09, 0.015), shade(L.metal, 0.8), x * 1.05, 0.4, 0); Mt(tor(0.03, 0.01, 5, 10), shade(L.metal, 0.7), x * 1.085, 0.4, 0, H);
  }
  for (const x of [-0.5, 0, 0.5]) Wd(box(0.07, 0.08, 0.76), shade(o.under ?? L.wood, 0.6), x, 0.47, 0);
  Wd(box(2.54, 0.02, 0.78), 0x16120e, 0, 0.522, 0);
}
function planks(o = {}) {
  const n = o.n || 13, w = 2.54 / n, b = o.b || 'w', c = o.col ?? L.wood, dw = o.w || 0.93;
  for (let k = 0; k < n; k++) {
    const j = rnd(k * 3 + 1 + (o.seed || 0)), x = -1.27 + w * (k + 0.5);
    emit(b, box(w - 0.012, 0.05, +(dw - (o.rag ? Math.round(j * 4) * 0.025 : 0)).toFixed(3)), o.cols ? o.cols[k % o.cols.length] : shade(c, 0.86 + j * 0.28), x, 0.555 - (o.rag ? (k % 3) * 0.004 : 0), o.rag ? (rnd(k) - 0.5) * 0.05 : 0, 0, o.rag ? (j - 0.5) * 0.1 : 0, 0);
    if (o.nails) for (const z of [-0.4, 0.4]) Mt(cyl(0.008, 0.008, 0.006, 5), o.nails, x, 0.581, z);
  }
}
function wheel(x, z, r, o, idx) {
  const s = z > 0 ? 1 : -1, kind = o.kinds ? o.kinds[idx] : o.kind || 'spoke', rim = o.rim ?? L.metal, sp = o.spoke ?? rim, hub = o.hub ?? L.trim, n = o.n || 8, sb = o.spokeB || 'm';
  at(x, r, z, 0, s > 0 ? 0 : PI, idx * 0.37, 1, () => { // local +z points outward
    const R = +r.toFixed(3);
    Mt(lathe([[R - 0.045, 0.035], [R, 0.035], [R, -0.02], [R + 0.03, -0.026], [R + 0.03, -0.04], [R - 0.045, -0.04], [R - 0.045, 0.035]], 24), rim, 0, 0, 0, H);
    const l = +(R - 0.08).toFixed(3), mid = 0.04 + l / 2;
    const ring = (fn) => { for (let k = 0; k < n; k++) { const a = (k / n) * TAU; fn(a, Math.cos(a), Math.sin(a)); } };
    if (kind === 'spoke') ring((a, c, sn) => emit(sb, cyl(0.012, 0.018, l, 6, true), sp, c * mid, sn * mid, 0, 0, 0, a - H));
    else if (kind === 'disc' || kind === 'holes' || kind === 'gear') {
      Mt(cyl(R - 0.04, R - 0.04, 0.03, 20), sp, 0, 0, 0, H);
      if (kind === 'disc') { Mt(tor(R * 0.56, 0.012, 4, 16), hub, 0, 0, 0.016); ring((a, c, sn) => Mt(RIV(), hub, c * R * 0.74, sn * R * 0.74, 0.018, H)); }
      if (kind === 'holes') ring((a, c, sn) => Mt(cyl(0.032, 0.032, 0.034, 8), DARK, c * R * 0.52, sn * R * 0.52, 0, H));
      if (kind === 'gear') { Mt(cyl(R * 0.6, R * 0.6, 0.03, 12), hub, 0, 0, 0.03, H); for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; Mt(box(0.04, 0.035, 0.03), hub, Math.cos(a) * R * 0.63, Math.sin(a) * R * 0.63, 0.03, 0, 0, a); } }
    } else if (kind === 'sun') { ring((a, c, sn) => Mt(cone(0.024, l, 5), sp, c * mid, sn * mid, 0, 0, 0, a - H)); Mt(cyl(0.085, 0.085, 0.05, 14), hub, 0, 0, 0, H); }
    else if (kind === 'swirl') { const pts = []; for (let t = 0; t <= 4; t++) { const rr = 0.04 + (t / 4) * l, a = (t / 4) * 0.9; pts.push([+(Math.cos(a) * rr).toFixed(4), +(Math.sin(a) * rr).toFixed(4), 0]); } ring((a) => emit(sb, tube(pts, 0.012, 6, 5), sp, 0, 0, 0, 0, 0, a)); }
    else if (kind === 'bone') ring((a, c, sn) => { Wd(cyl(0.011, 0.011, l, 5, true), sp, c * mid, sn * mid, 0, 0, 0, a - H); Wd(ball(0.022, 6, 4), sp, c * (R - 0.05), sn * (R - 0.05), 0); });
    else if (kind === 'blade') ring((a, c, sn) => Mt(box(0.04, l, 0.012), sp, c * mid, sn * mid, 0, 0, 0, a - H + 0.3));
    else if (kind === 'spike') { ring((a, c, sn) => { Mt(rb(0.034, l, 0.03, 0.008), sp, c * mid, sn * mid, 0, 0, 0, a - H); Mt(cone(0.018, 0.05, 5), hub, c * (R - 0.022), sn * (R - 0.022), 0.05, H); }); Mt(cone(0.035, 0.12, 6), hub, 0, 0, 0.1, H); }
    Mt(cyl(0.05, 0.056, 0.11, 10), hub, 0, 0, 0, H); Mt(hemi(0.036, 8, 3), o.cap ?? hub, 0, 0, 0.055, H);
  });
}
function wheels(o = {}) {
  let n = 0; const r0 = o.r || 0.23;
  for (const x of [-0.9, 0.9]) {
    Mt(cyl(0.026, 0.026, 0.74, 8), shade(L.metal, 0.85), x, o.radii ? (o.radii[n] + o.radii[n + 1]) / 2 : r0, 0, H);
    for (const z of [-0.3, 0.3]) {
      const r = o.radii ? o.radii[n] : r0, zz = z * 1.27, s = z > 0 ? 1 : -1;
      wheel(x, z, r, o, n); n++;
      if (o.noBox) continue;
      Mt(rb(0.13, 0.12, 0.06, 0.02), o.box ?? L.metal, x, r, zz); Mt(cyl(0.028, 0.028, 0.02, 8), o.boxCap ?? L.trim, x, r, zz + s * 0.035, H);
      for (let k = 0; k < 3; k++) Mt(box(+(0.36 - k * 0.09).toFixed(2), 0.018, 0.045), shade(L.metal, 0.75), x, r + 0.078 + k * 0.021, zz);
      Mt(box(0.07, 0.06, 0.05), o.box ?? L.metal, x, 0.375, zz);
    }
  }
}

// ---- the pump -------------------------------------------------------------------------------
function pivot(c = L.trim) { Mt(cyl(0.03, 0.03, 0.5, 10), c, 0, 1.3, 0, H); for (const s of [-1, 1]) Mt(hemi(0.04, 8, 3), c, 0, 1.3, s * 0.25, s * H); }
function aframe(o = {}) {
  const b = o.b || 'w', c = o.col ?? L.wood, st = o.strap ?? L.metal;
  for (const z of [-0.18, 0.18]) {
    for (const s of [-1, 1]) {
      emit(b, rb(0.075, 0.76, 0.06, 0.015), c, s * 0.125, 0.945, z, 0, 0, s * 0.245);
      Mt(rb(0.15, 0.03, 0.1, 0.01), st, s * 0.215, 0.595, z); Mt(RIV(), o.bolt ?? L.trim, s * 0.26, 0.615, z, 0, 0, 0); Mt(RIV(), o.bolt ?? L.trim, s * 0.17, 0.615, z + (z > 0 ? 0.03 : -0.03));
    }
    emit(b, rb(0.3, 0.055, 0.05, 0.012), c, 0, 0.9, z);
    if (o.x) for (const s of [-1, 1]) Mt(box(0.02, 0.34, 0.012), st, 0, 0.74, z * 1.2, 0, 0, s * 0.72);
    Mt(rb(0.15, 0.13, 0.075, 0.02), st, 0, 1.3, z);
    for (const s of [-1, 1]) Mt(RIV(), o.bolt ?? L.trim, s * 0.05, 1.25, z * 1.22, H);
  }
  for (const s of [-1, 1]) emit(b, rb(0.05, 0.05, 0.4, 0.012), c, s * 0.165, 0.8, 0);
  pivot(o.pin);
}
/** twin uprights either side of the beam: fn(sideSign) draws one, in a frame whose origin is on the deck under the pivot */
function posts(fn) { for (const s of [-1, 1]) at(0, D, s * 0.18, 0, 0, 0, 1, () => fn(s)); }
function beam(o = {}) {
  inBeam(() => {
    const b = o.b || 'w', c = o.col ?? L.wood, st = o.strap ?? L.metal, hc = o.handle ?? shade(L.wood, 0.7), kn = o.knob ?? L.trim;
    if (o.shape === 'arc') emit(b, tube([[-0.74, 0.05, 0], [-0.4, -0.02, 0], [0, 0, 0], [0.4, -0.02, 0], [0.74, 0.05, 0]], 0.034, 16, 7), c);
    else if (o.shape === 'girder') { for (const s of [-1, 1]) emit(b, box(1.46, 0.016, 0.085), c, 0, s * 0.04, 0); emit(b, box(1.46, 0.07, 0.022), shade(c, 0.85), 0, 0, 0); for (let k = 0; k < 12; k++) for (const s of [-1, 1]) Mt(RIV(), kn, -0.66 + k * 0.12, 0.05, s * 0.028); }
    else if (o.shape === 'bone') for (const s of [-1, 1]) { emit('w', cyl(0.026, 0.034, 0.68, 8), c, s * 0.38, 0, 0, 0, 0, -s * H); for (const z of [-0.025, 0.025]) emit('w', ball(0.04, 8, 6), c, s * 0.71, 0, z); }
    else if (o.shape === 'bent') { for (const s of [-1, 1]) emit(b, box(0.76, 0.07, 0.075), s > 0 ? c : shade(c, 0.8), s * 0.37, s > 0 ? 0.03 : -0.01, 0, 0, 0, s > 0 ? -0.08 : -0.03); }
    else emit(b, rb(1.46, 0.075, 0.07, 0.02), c, 0, 0, 0);
    if (!o.noHub) { Mt(rb(0.26, 0.12, 0.09, 0.02), st, 0, 0, 0); Mt(cyl(0.05, 0.05, 0.1, 10), kn, 0, 0, 0, H); }
    const hy = o.shape === 'arc' ? 0.05 : 0;
    for (const s of [-1, 1]) {
      if (!o.noCaps) Mt(rb(0.09, 0.095, 0.095, 0.02), st, s * 0.715, hy, 0);
      if (!o.noStraps) Mt(box(0.03, 0.085, 0.08), st, s * 0.37, o.shape === 'arc' ? -0.015 : 0, 0);
      emit(o.hb || 'w', cyl(0.022, 0.022, 0.64, 8), hc, s * 0.75, hy, 0, H);
      for (const z of [-0.32, 0.32]) Mt(ball(0.03, 8, 6), kn, s * 0.75, hy, z);
    }
    if (o.extra) o.extra();
  });
}

// ---- stores and fittings -----------------------------------------------------------------------
function crate(x, z, w, h, d, ry = 0, col = CRATE, y = D) {
  at(x, y, z, 0, ry, 0, 1, () => {
    Wd(box(w, h, d), col, 0, h / 2, 0); const e = 0.035, c2 = shade(col, 0.7);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) Wd(box(e, h + 0.01, e), c2, sx * (w / 2), h / 2, sz * (d / 2));
    for (const sy of [0.02, h - 0.02]) { for (const sz of [-1, 1]) Wd(box(w + 0.02, e, 0.02), c2, 0, sy, sz * (d / 2 + 0.005)); for (const sx of [-1, 1]) Wd(box(0.02, e, d + 0.02), c2, sx * (w / 2 + 0.005), sy, 0); }
    for (const sx of [-1, 1]) Wd(box(0.015, +(Math.hypot(h, d) * 0.9).toFixed(3), e), c2, sx * (w / 2 + 0.004), h / 2, 0, sx * Math.atan2(d, h), 0, 0);
    for (const sz of [-1, 1]) Wd(box(e, +(Math.hypot(h, w) * 0.9).toFixed(3), 0.015), c2, 0, h / 2, sz * (d / 2 + 0.004), 0, 0, sz * Math.atan2(w, h));
  });
}
function barrel(x, z, r, h, col = 0x8a6238, hoop = L.metal, y = D, lie = null) {
  const draw = () => {
    Wd(lathe([[r * 0.8, 0], [r * 0.94, h * 0.2], [r, h * 0.5], [r * 0.94, h * 0.8], [r * 0.8, h], [r * 0.72, h - 0.015], [0, h - 0.015]], 14), col);
    Wd(cyl(r * 0.8, r * 0.8, 0.01, 14), shade(col, 0.8), 0, 0.005, 0);
    for (const [k, rr] of [[0.12, 0.9], [0.5, 1.005], [0.88, 0.9]]) Mt(cyl(r * rr + 0.004, r * rr + 0.004, 0.028, 14, true), hoop, 0, h * k, 0);
  };
  if (lie === null) at(x, y, z, 0, 0, 0, 1, draw); else at(x, y + r, z, 0, lie, 0, 1, () => at(-h / 2, 0, 0, 0, 0, -H, 1, draw));
}
function sack(x, z, s = 1, col = SACK, y = D, ry = 0) {
  at(x, y, z, 0, ry, 0, s, () => { Wd(ball(0.2, 10, 7), col, 0, 0.13, 0, 0, 0, 0, 1.05, 0.7, 0.88); Wd(cone(0.05, 0.1, 6), shade(col, 0.8), 0.16, 0.2, 0, 0, 0, -1.0); Wd(tor(0.03, 0.008, 4, 8), ROPE, 0.14, 0.185, 0, 0, H, 0.55); });
}
const URN = [[0.05, 0], [0.11, 0.05], [0.16, 0.17], [0.14, 0.29], [0.07, 0.37], [0.06, 0.43], [0.09, 0.47], [0.075, 0.475], [0, 0.44]];
function urn(x, z, s = 1, col = 0xb86a42, band = null, y = D) { Wd(lathe(URN, 12), col, x, y, z, 0, 0, 0, s); if (band !== null) Mt(cyl(0.162 * s, 0.162 * s, 0.03 * s, 12, true), band, x, y + 0.18 * s, z); }
function post(x, z, h, col = L.metal, r = 0.02, b = 'm', y0 = D) { emit(b, cyl(r, r, h, 8), col, x, y0 + h / 2, z); }
function lantern(x, y, z, s = 1, fc = L.metal, gc = L.glow, cap = 'cone') {
  at(x, y, z, 0, 0, 0, s, () => {
    Mt(cyl(0.07, 0.055, 0.025, 8), fc, 0, 0.012, 0); Gl(cyl(0.046, 0.05, 0.14, 8), gc, 0, 0.095, 0);
    for (let k = 0; k < 4; k++) { const a = k * H + PI / 4; Mt(box(0.012, 0.15, 0.012), fc, Math.cos(a) * 0.058, 0.095, Math.sin(a) * 0.058); }
    Mt(cyl(0.075, 0.075, 0.018, 8), fc, 0, 0.175, 0);
    if (cap === 'dome') Mt(hemi(0.07, 10, 4), fc, 0, 0.18, 0); else if (cap === 'flat') Mt(cyl(0.05, 0.08, 0.03, 8), fc, 0, 0.2, 0); else Mt(cone(0.085, 0.09, 8), fc, 0, 0.228, 0);
    Mt(tor(0.02, 0.006, 4, 8), fc, 0, cap === 'cone' ? 0.285 : 0.26, 0);
  });
}
function flame(x, y, z, s = 1, col = L.glow) { Gl(cone(0.07, 0.24, 7), col, x, y + 0.12 * s, z, 0, 0, 0, s); Gl(cone(0.04, 0.15, 6), blend(col, 0xffffff, 0.55), x + 0.012 * s, y + 0.085 * s, z + 0.01 * s, 0, 0, 0, s); }
function skull(x, y, z, s = 1, ry = 0, col = BONE, eye = DARK, cheap = false) {
  at(x, y, z, 0, ry, 0, s, () => {
    Wd(ball(0.1, cheap ? 7 : 10, cheap ? 5 : 8), col, -0.01, 0.04, 0, 0, 0, 0, 1.05, 0.95, 0.9); Wd(cheap ? box(0.09, 0.07, 0.1) : rb(0.1, 0.08, 0.11, 0.025), shade(col, 0.92), 0.045, -0.05, 0);
    for (const sz of [-1, 1]) emit(eye === DARK ? 'w' : 'g', ball(0.026, 6, 4), eye, 0.082, 0.025, sz * 0.04);
    if (!cheap) { Wd(box(0.012, 0.025, 0.085), 0xfaf4e0, 0.097, -0.075, 0); Wd(cone(0.012, 0.03, 4), DARK, 0.096, -0.015, 0); }
  });
}
function shield(x, y, sz, w, h, c1, c2, boss = L.trim, kind = 0) { // hung on a side sill, sz = +-1
  at(x, y, sz * 0.446, 0, sz > 0 ? 0 : PI, 0, 1, () => {
    Wd(shieldGeo(w, h), c1); Mt(shieldGeo(w + 0.03, h + 0.03), boss, 0, 0, -0.012);
    if (kind === 0) Wd(box(w * 0.22, h * 0.8, 0.006), c2, 0, 0.03, 0.027); else if (kind === 1) Wd(box(w * 0.92, h * 0.2, 0.006), c2, 0, h * 0.2, 0.027); else { Wd(box(w * 0.6, h * 0.14, 0.006), c2, -w * 0.14, 0.02, 0.027, 0, 0, 0.75); Wd(box(w * 0.6, h * 0.14, 0.006), c2, w * 0.14, 0.02, 0.027, 0, 0, -0.75); }
    Mt(hemi(0.026, 8, 3), boss, 0, h * 0.12, 0.028, H);
  });
}
function chain(p0, p1, n, col = L.metal, sag = 0.1, r = 0.022) {
  const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize(), q0 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d), tw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), H);
  for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, q = q0.clone(); if (k % 2) q.multiply(tw); Mt(tor(r, r * 0.32, 4, 8), col, p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - sag * 4 * t * (1 - t), p0[2] + (p1[2] - p0[2]) * t, q); }
}
/** a rope over a load at one end: an arch across the car */
function lash(x, h, zw = 0.4, col = ROPE) { Wd(tube([[x, D, -zw], [x, +(D + h * 0.95).toFixed(3), +(-zw * 0.85).toFixed(3)], [x, D + h + 0.012, 0], [x, +(D + h * 0.95).toFixed(3), +(zw * 0.85).toFixed(3)], [x, D, zw]], 0.012, 12, 4), col); }
function coil(x, z, col = ROPE, y = D) { for (let k = 0; k < 3; k++) Wd(tor(0.1 - k * 0.012, 0.02, 5, 14), col, x, y + 0.02 + k * 0.036, z, H); }
function endRail(sx, o = {}) {
  const h = o.h || 0.3, c = o.col ?? L.wood, b = o.b || 'w', x = sx * 1.3;
  for (const z of [-0.42, 0.42]) { emit(b, rb(0.05, h + 0.04, 0.05, 0.012), c, x, D + h / 2, z); if (o.cap !== undefined) Mt(ball(0.034, 8, 6), o.cap, x, D + h + 0.045, z); }
  emit(b, rb(0.035, 0.045, 0.86, 0.01), c, x, D + h - 0.03, 0); if (!o.single) emit(b, rb(0.03, 0.04, 0.86, 0.01), c, x, D + h * 0.45, 0);
}
function plates(y = 0.46, x = 0, zz = 0.453) { for (const z of [-1, 1]) { Sd(rb(0.36, 0.1, 0.016, 0.006), x, y, z * zz); for (const s of [-1, 1]) Mt(RIV(), L.trim, x + s * 0.15, y, z * (zz + 0.009), H); } }
function pennant(x, z, h, kind = 'swallow', w = 0.44, hh = 0.22, pc = L.metal, fin = L.trim) {
  post(x, z, h, pc, 0.016); Mt(ball(0.032, 8, 6), fin, x, D + h + 0.02, z); Sd(flagGeo(w, hh, kind), x - 0.016, D + h - hh / 2 - 0.03, z);
}
function gear(x, y, z, R, teeth, th, col, rx = 0, ry = 0, hub = null) {
  at(x, y, z, rx, ry, 0, 1, () => { Mt(cyl(R, R, th, 16), col, 0, 0, 0, H); for (let k = 0; k < teeth; k++) { const a = (k / teeth) * TAU; Mt(box(+(R * 0.3).toFixed(3), +(R * 0.24).toFixed(3), th), col, Math.cos(a) * R * 1.05, Math.sin(a) * R * 1.05, 0, 0, 0, a); } Mt(cyl(R * 0.3, R * 0.3, th + 0.02, 8), hub ?? shade(col, 0.6), 0, 0, 0, H); });
}
/** a small swept roof with upturned corners (centred, eave at y) */
function sweptRoof(x, y, z, w, d, h, col, tip) {
  Wd(rb(w, 0.03, d, 0.01), shade(col, 0.8), x, y, z); Wd(pyr(), col, x, y + 0.015 + h / 2, z, 0, 0, 0, w * 0.92, h, d * 0.92);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) Mt(cone(0.022, 0.13, 5), tip, x + sx * (w / 2 + 0.02), y + 0.04, z + sz * (d / 2 + 0.02), sz * 0.9, 0, -sx * 0.9);
  Mt(ball(0.035, 8, 6), tip, x, y + h + 0.03, z);
}
const ONION = [[0.06, 0], [0.105, 0.035], [0.125, 0.09], [0.115, 0.15], [0.07, 0.215], [0.03, 0.27], [0.012, 0.33], [0, 0.37]];
const BELL = [[0.1, 0], [0.088, 0.025], [0.062, 0.09], [0.048, 0.145], [0.022, 0.178], [0, 0.185]];

// ---- the factions ------------------------------------------------------------------------------
const F = {};

export function buildHandcar(look, sideColor, index) {
  const fac = F[look.faction] ? look.faction : 'kingdom', i = index ? 1 : 0;
  const key = `${fac}:${i}:${look.cloth}:${look.cloth2}:${look.metal}:${look.wood}:${look.trim}:${look.glow}`;
  let geos = cache.get(key);
  if (!geos) {
    K = { g: {}, top: new THREE.Matrix4(), pre: '' }; L = look;
    F[fac](i);
    geos = {}; for (const k of Object.keys(K.g)) geos[k] = mergeGeometries(K.g[k], false);
    cache.set(key, geos); K = null; L = null;
  }
  const obj = new THREE.Group(), bm = new THREE.Group(); bm.position.set(0, 1.3, 0); obj.add(bm);
  for (const k of Object.keys(geos)) {
    const beam = k.length === 2, b = k[k.length - 1], mesh = new THREE.Mesh(geos[k], b === 's' ? sideMat(sideColor) : MAT[b]);
    mesh.castShadow = true; (beam ? bm : obj).add(mesh);
  }
  obj.userData.beam = bm; obj.userData.len = 2.9; obj.userData.deck = D; obj.userData.phase = index * 1.3;
  return obj;
}
const cache = new Map();

// ---- more shared fittings ---------------------------------------------------------------------
const VAL = () => prism('val', [[-0.5, 0], [0.5, 0], [0.5, -0.55], [0, -1], [-0.5, -0.55]], 0.012); // a pointed valance tab, unit size
const TRI = () => prism('tri', [[-0.5, 0], [0.5, 0], [0, -1]], 0.012);
function chest(x, z, w, h, d, col, band = L.trim, ry = 0, y = D, open = false) {
  at(x, y, z, 0, ry, 0, 1, () => {
    Wd(rb(w, h, d, 0.012), col, 0, h / 2, 0);
    const lid = () => { Wd(cyl(d / 2, d / 2, w, 12), shade(col, 1.1), 0, 0, 0, 0, 0, H); for (const s of [-0.3, 0.3]) Mt(cyl(d / 2 + 0.006, d / 2 + 0.006, 0.035, 12, true), band, s * w, 0, 0, 0, 0, H); };
    if (open) at(0, h + 0.02, -d / 2, -1.1, 0, 0, 1, () => at(0, 0, d / 2, 0, 0, 0, 1, lid)); else at(0, h, 0, 0, 0, 0, 1, lid);
    for (const s of [-0.3, 0.3]) Mt(box(0.035, h + 0.004, d + 0.012), band, s * w, h / 2, 0);
    Mt(rb(0.05, 0.07, 0.02, 0.008), band, 0, h * 0.8, d / 2 + 0.008);
  });
}
function stripedPole(x, z, h, c1, c2, top = L.trim, r = 0.024) { const n = Math.round(h / 0.14), hh = +(h / n).toFixed(4); for (let k = 0; k < n; k++) Wd(cyl(r, r, hh, 8, true), k % 2 ? c1 : c2, x, D + hh * (k + 0.5), z); Mt(ball(r * 1.8, 8, 6), top, x, D + h + r, z); }
/** a hanging banner in the side's colour on a pole with a crossbar (the bar runs along x) */
function gonfalon(x, z, h, w = 0.34, hh = 0.42, kind = 'swallow', pc = L.metal, fin = L.trim, across = false) {
  post(x, z, h, pc, 0.016); Mt(ball(0.03, 8, 6), fin, x, D + h + 0.02, z);
  at(x, D + h - 0.06, z, 0, across ? H : 0, 0, 1, () => { Mt(cyl(0.012, 0.012, w + 0.08, 6), pc, 0, 0, 0, 0, 0, H); for (const s of [-1, 1]) Mt(ball(0.02, 6, 4), fin, s * (w / 2 + 0.04), 0, 0); Sd(hangGeo(w, hh, kind), 0, -0.01, 0.016); });
}
function books(x, z, y = D) { [[0x7a2a22, 0.2], [0x2a4a6a, 0.18], [0x3a5a32, 0.16]].forEach(([c, w], k) => { Wd(rb(w, 0.045, 0.14, 0.008), c, x, y + 0.025 + k * 0.047, z, 0, k * 0.4 - 0.3, 0); Wd(box(w - 0.02, 0.03, 0.142), 0xe8e0c8, x, y + 0.025 + k * 0.047, z, 0, k * 0.4 - 0.3, 0); }); }
function balls(x, z, r = 0.05, col = 0x2a2a2e, y = D) { for (const [dx, dz] of [[-1, -0.6], [1, -0.6], [0, 1.1]]) Mt(ball(r, 8, 6), col, x + dx * r, y + r, z + dz * r); Mt(ball(r, 8, 6), col, x, y + r * 2.55, z); }

// ---- the realms of men -------------------------------------------------------------------------
F.kingdom = (i) => {
  frame({}); planks({ nails: 0x2a2a2e }); wheels({ n: 8 }); aframe({ x: 1 }); beam({});
  for (const z of [-1, 1]) {
    Wd(rb(2.2, 0.04, 0.014, 0.005), L.cloth, 0, 0.497, z * 0.452);
    for (const x of [-0.78, 0.78]) shield(x, 0.46, z, 0.2, 0.25, x * z > 0 ? L.cloth : L.cloth2, x * z > 0 ? L.cloth2 : L.cloth, L.trim, x > 0 ? 0 : 2);
  }
  plates(); endRail(1, { cap: L.trim }); endRail(-1, { cap: L.trim });
  post(1.3, 0.42, 0.95, L.metal, 0.018); lantern(1.3, D + 0.95, 0.42, 1.15); Mt(tor(0.05, 0.012, 5, 12), L.trim, 1.3, D + 0.6, 0.42, H);
  pennant(1.3, -0.42, 1.4, 'swallow');
  if (i === 0) {
    crate(1.1, -0.17, 0.34, 0.32, 0.4, 0.06); barrel(1.1, 0.24, 0.15, 0.4); Wd(tor(0.153, 0.012, 4, 14), ROPE, 1.1, D + 0.3, 0.24, H);
    sack(-1.13, -0.2, 0.9); sack(-1.13, 0.2, 0.9, 0xa89878, D, 1.3); sack(-1.13, 0, 0.85, 0xc0b090, D + 0.2, 0.5); lash(-1.13, 0.46, 0.4);
  } else {
    barrel(1.1, -0.2, 0.16, 0.42); barrel(1.1, 0.16, 0.14, 0.36, 0x7a5230); barrel(1.1, -0.02, 0.09, 0.26, 0x9a7240, L.trim, D + 0.42, H);
    crate(-1.12, 0.05, 0.36, 0.38, 0.56, 0.04); lash(-1.12, 0.39, 0.4); sack(-1.13, -0.02, 0.7, SACK, D + 0.38, 0.4); coil(-1.1, -0.34);
  }
};

F.graal = (i) => {
  const A = L.cloth, B = L.cloth2, W = 0xece6d6, ST = 0xb8bcc4;
  frame({ sill: A, sillB: 'w', head: A, rivet: L.trim }); planks({ col: 0x9a7a4e }); wheels({ n: 10, rim: 0x3a3a40, spoke: W, spokeB: 'w', hub: L.trim });
  aframe({ col: W, strap: L.trim, pin: L.trim }); beam({ col: W, strap: L.trim });
  // a caparison down both flanks, and the shields of the knights of the train
  for (const z of [-1, 1]) {
    for (let k = 0; k < 10; k++) Cl(VAL(), k % 2 ? A : B, -1.125 + k * 0.25, 0.41, z * 0.456, 0, 0, 0, 0.25, 0.22, 1);
    Mt(rb(2.56, 0.025, 0.02, 0.008), L.trim, 0, 0.412, z * 0.458);
    [-0.85, -0.3, 0.3, 0.85].forEach((x, k) => shield(x, 0.47, z, 0.2, 0.24, k % 2 ? B : A, k % 2 ? A : B, L.trim, k % 3));
  }
  // the cup the realm is named for, borne above the pump
  for (const z of [-0.18, 0.18]) Mt(box(0.05, 0.1, 0.05), L.trim, 0, 1.41, z);
  Wd(rb(0.12, 0.04, 0.46, 0.012), W, 0, 1.475, 0);
  Mt(lathe([[0.05, 0], [0.015, 0.02], [0.012, 0.08], [0.05, 0.11], [0.062, 0.17], [0.054, 0.17], [0, 0.12]], 12), GOLD, 0, 1.495, 0, 0, 0, 0, 1.4); Gl(ball(0.04, 8, 6), L.glow, 0, 1.75, 0);
  // lances racked at the rear, pennons flying
  Wd(rb(0.06, 0.05, 0.84, 0.012), W, 1.28, D + 0.34, 0); for (const z of [-0.42, 0.42]) Wd(rb(0.05, 0.36, 0.05, 0.012), W, 1.28, D + 0.17, z);
  [-0.3, 0, 0.3].forEach((z, k) => {
    for (let q = 0; q < 6; q++) Wd(cyl(0.017, 0.017, 0.27, 6, true), q % 2 ? A : W, 1.31, D + 0.135 + q * 0.27, z);
    Mt(cone(0.05, 0.1, 8), L.trim, 1.31, D + 0.42, z, PI); Mt(cone(0.02, 0.12, 6), ST, 1.31, D + 1.68, z);
    if (k === 1) Sd(flagGeo(0.36, 0.2, 'swallow'), 1.29, D + 1.5, z); else Cl(flagGeo(0.26, 0.12, 'swallow'), k ? B : A, 1.29, D + 1.54, z);
  });
  endRail(-1, { col: W, cap: L.trim }); post(-1.3, 0.42, 0.85, L.trim, 0.016); lantern(-1.3, D + 0.85, 0.42, 1.05, L.trim, L.glow); plates();
  // a great helm on its stand, and spare shields
  const helm = (x, z) => { post(x, z, 0.2, 0x6a4a2e, 0.02, 'w'); Mt(cyl(0.085, 0.09, 0.17, 12), ST, x, D + 0.29, z); Mt(cyl(0.07, 0.085, 0.03, 12), ST, x, D + 0.39, z); Mt(box(0.012, 0.15, 0.03), L.trim, x + 0.088, D + 0.3, z); Mt(box(0.012, 0.02, 0.13), DARK, x + 0.09, D + 0.32, z); Cl(cone(0.04, 0.2, 6), A, x - 0.03, D + 0.5, z, 0, 0, 0.4); };
  const spare = (x, z, c, lean) => at(x, D + 0.21, z, 0, H, 0, 1, () => { Wd(shieldGeo(0.3, 0.38), c, 0, 0, 0, lean); Mt(shieldGeo(0.33, 0.41), L.trim, 0, 0, -0.012, lean); Mt(hemi(0.03, 8, 3), L.trim, 0, 0.04, 0.03, H + lean); });
  if (i === 0) {
    helm(-1.14, -0.26); spare(-1.24, 0.12, A, 0.3); spare(-1.12, 0.16, B, 0.5);
    chest(1.08, 0, 0.5, 0.18, 0.26, A, L.trim, H);
  } else {
    helm(-1.14, 0.26); chest(-1.13, -0.14, 0.4, 0.2, 0.28, 0x5a3a26, L.trim, H);
    for (let q = 0; q < 6; q++) Wd(cyl(0.09, 0.09, 0.11, 10), q % 2 ? A : B, 1.06, D + 0.09, -0.275 + q * 0.11, H); // a rolled pavilion
    for (const z of [-0.16, 0.16]) Wd(tor(0.092, 0.01, 4, 10), ROPE, 1.06, D + 0.09, z);
  }
};

F.aurelia = (i) => {
  const A = L.cloth, MB = 0xe8e2d2, G = L.trim, DW = 0x4a3222;
  frame({ sill: DW, sillB: 'w', head: DW, rivet: G }); planks({ col: 0x8a6a42 }); wheels({ n: 12, rim: 0x33333a, spoke: G, hub: G });
  for (const z of [-1, 1]) { // gilt laurel panels
    Wd(rb(2.3, 0.07, 0.014, 0.005), A, 0, 0.485, z * 0.452); for (const y of [0.447, 0.523]) Mt(rb(2.4, 0.012, 0.018, 0.005), G, 0, y, z * 0.453);
    for (const x of [-0.9, -0.3, 0.3, 0.9]) Mt(tor(0.034, 0.011, 5, 12), G, x, 0.485, z * 0.462);
  }
  posts(() => { // fluted columns
    Wd(rb(0.17, 0.05, 0.13, 0.01), MB, 0, 0.025, 0); Mt(tor(0.05, 0.014, 5, 10), G, 0, 0.065, 0, H); Wd(cyl(0.038, 0.048, 0.56, 10), MB, 0, 0.345, 0);
    Mt(cyl(0.066, 0.042, 0.05, 10), G, 0, 0.64, 0); Mt(rb(0.15, 0.12, 0.075, 0.02), G, 0, 0.72, 0); Wd(box(0.07, 0.12, 0.06), MB, 0, 0.84, 0);
  });
  pivot(G);
  Wd(rb(0.2, 0.05, 0.52, 0.01), MB, 0, 1.5, 0); Wd(prism('ped', [[-0.27, 0], [0.27, 0], [0, 0.13]], 0.17), MB, 0, 1.525, 0, 0, H, 0); Mt(ball(0.04, 8, 6), G, 0, 1.69, 0);
  for (const s of [-1, 1]) Mt(tor(0.035, 0.011, 4, 10), G, s * 0.09, 1.57, 0, 0, H, 0);
  beam({ col: 0x5a3a26, strap: G });
  const BAL = [[0.03, 0], [0.036, 0.03], [0.018, 0.07], [0.042, 0.15], [0.02, 0.23], [0.03, 0.27]];
  for (const sx of [-1, 1]) { for (let k = 0; k < 5; k++) Wd(lathe(BAL, 8), MB, sx * 1.3, D, -0.36 + k * 0.18); Wd(rb(0.075, 0.035, 0.92, 0.01), MB, sx * 1.3, D + 0.285, 0); Wd(rb(0.075, 0.02, 0.92, 0.008), MB, sx * 1.3, D + 0.01, 0); }
  gonfalon(-1.24, -0.42, 1.5, 0.32, 0.42, 'rect', G, G); Mt(tor(0.06, 0.014, 5, 12), G, -1.24, D + 1.6, -0.42); Mt(box(0.32, 0.02, 0.012), G, -1.24, D + 1.01, -0.4);
  post(1.3, 0.42, 0.9, G, 0.018); lantern(1.3, D + 0.9, 0.42, 1.15, G, L.glow, 'dome'); plates();
  const armil = (x, z) => { Wd(lathe([[0.09, 0], [0.07, 0.04], [0.035, 0.08], [0.03, 0.2], [0.05, 0.24]], 10), MB, x, D, z); Mt(tor(0.15, 0.009, 4, 20), G, x, D + 0.42, z); Mt(tor(0.15, 0.009, 4, 20), G, x, D + 0.42, z, H); Mt(tor(0.13, 0.009, 4, 20), G, x, D + 0.42, z, 0.6, 0.7, 0); Wd(ball(0.06, 10, 8), 0x2a5a9a, x, D + 0.42, z); Mt(cyl(0.006, 0.006, 0.36, 4), G, x, D + 0.42, z, 0, 0, 0.4); };
  if (i === 0) { // a bronze bombard and its shot; an armillary sphere and books
    at(1.14, D, -0.14, 0, 0, 0, 1, () => { Wd(rb(0.36, 0.1, 0.26, 0.015), DW, 0, 0.06, 0); Mt(lathe([[0.07, 0], [0.088, 0.02], [0.078, 0.1], [0.06, 0.36], [0.078, 0.38], [0.072, 0.42], [0.046, 0.42], [0.046, 0.3]], 12), BRASS, -0.2, 0.15, 0, 0, 0, -H + 0.3); for (const s of [-1, 1]) Mt(cyl(0.02, 0.02, 0.05, 6), BRASS, -0.03, 0.2, s * 0.1, H); });
    balls(1.1, 0.26); armil(-1.1, 0.18); books(-1.1, -0.26);
  } else {
    armil(1.1, -0.2); books(1.1, 0.22); chest(-1.12, 0.16, 0.34, 0.2, 0.28, DW, G, H);
    Wd(lathe([[0.08, 0], [0.06, 0.04], [0.05, 0.22], [0.075, 0.25]], 8), MB, -1.1, D, -0.24); Wd(ball(0.07, 10, 8), MB, -1.1, D + 0.42, -0.24, 0, 0, 0, 0.9, 1.1, 0.9); Wd(rb(0.1, 0.1, 0.2, 0.04), MB, -1.1, D + 0.3, -0.24); Mt(tor(0.065, 0.012, 4, 10, PI * 1.3), G, -1.1, D + 0.45, -0.24, 0, H, -0.5);
  }
};

F.westmark = (i) => {
  const A = L.cloth, B = L.cloth2, TW = 0x5a4630, ST = 0xc0c4cc, WH = 0xf0ece0;
  frame({ sill: 0x3a2e24, sillB: 'w', rivet: 0x9a9aa0 }); planks({ col: 0x7a6040, nails: 0x2a2a2e }); wheels({ n: 8, spoke: TW, spokeB: 'w', hub: 0x55555c });
  aframe({ col: TW, x: 1 }); beam({ col: 0x6a5234 });
  for (const z of [-1, 1]) for (const x of [-0.8, 0.8]) { Wd(cyl(0.085, 0.085, 0.012, 14), A, x, 0.46, z * 0.452, H); Wd(cyl(0.056, 0.056, 0.018, 12), WH, x, 0.46, z * 0.452, H); Wd(cyl(0.028, 0.028, 0.024, 10), B, x, 0.46, z * 0.452, H); }
  plates();
  // a stand of pikes at the head, the republic's colours on the tallest
  Wd(rb(0.05, 0.04, 0.84, 0.01), TW, 1.25, D + 0.5, 0); Wd(rb(0.05, 0.04, 0.84, 0.01), TW, 1.25, D + 0.14, 0); for (const z of [-0.42, 0.42]) Wd(rb(0.05, 0.54, 0.05, 0.012), TW, 1.25, D + 0.27, z);
  for (let k = 0; k < 7; k++) { const z = -0.3 + k * 0.1, x = 1.3 + (k % 2) * 0.04, h = 2.0 + rnd(k + i * 5) * 0.2; Wd(cyl(0.011, 0.013, h, 5, true), 0x8a6a42, x, D + h / 2, z); Mt(cone(0.018, 0.13, 5), ST, x, D + h + 0.06, z); }
  Wd(tor(0.04, 0.012, 4, 10), ROPE, 1.3, D + 0.5, 0, H, 0, 0, 1, 1, 7.5);
  [A, WH, B].forEach((c, k) => Cl(flagGeo(0.36, 0.085, 'rect'), c, 1.3, D + 1.96 - k * 0.085, 0)); Sd(flagGeo(0.36, 0.17, 'swallow'), 1.29, D + 1.6, -0.3);
  // muskets stacked, powder, a gabion
  const stack = (x, z) => at(x, D, z, 0, 0, 0, 1, () => { for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + 0.4, c = Math.cos(a), s = Math.sin(a); at(c * 0.15, 0, s * 0.15, -s * 0.2, 0, c * 0.2, 1, () => { Wd(box(0.03, 0.22, 0.05), 0x5a3a22, 0, 0.11, 0, 0, -a, 0); Wd(cyl(0.013, 0.017, 0.5, 5), 0x5a3a22, 0, 0.45, 0); Mt(cyl(0.008, 0.008, 0.64, 5), 0x3a3a40, 0.014 * c, 0.56, 0.014 * s); }); } Mt(tor(0.03, 0.008, 4, 8), 0x3a3a40, 0, 0.7, 0, H); });
  const keg = (x, z) => { barrel(x, z, 0.11, 0.26, 0x6a5236, 0x2a2a2e); Wd(cyl(0.106, 0.106, 0.05, 12, true), A, x, D + 0.185, z); };
  post(-1.3, 0.42, 0.8, 0x2a2a2e, 0.016); Mt(tube([[-1.3, D + 0.8, 0.42], [-1.29, D + 0.9, 0.42], [-1.22, D + 0.92, 0.42], [-1.18, D + 0.86, 0.42]], 0.012, 8, 4), 0x2a2a2e); lantern(-1.18, D + 0.56, 0.42, 1, 0x2a2a2e, L.glow, 'flat');
  endRail(-1, { col: TW, single: 1 });
  const hat = (x, z) => { Wd(cyl(0.14, 0.14, 0.012, 14), 0x2a2420, x, D + 0.25, z); Wd(cyl(0.07, 0.08, 0.09, 12), 0x2a2420, x, D + 0.3, z); Cl(cone(0.03, 0.24, 5), A, x - 0.03, D + 0.4, z + 0.08, 0.5, 0, 0.5); Wd(cyl(0.082, 0.082, 0.025, 12, true), B, x, D + 0.27, z); };
  if (i === 0) {
    stack(-1.12, -0.2); keg(-1.12, 0.2);
    crate(1.1, 0.12, 0.26, 0.24, 0.36, 0.05); hat(1.1, 0.12); keg(1.1, -0.26);
  } else {
    stack(-1.12, 0.2); balls(-1.1, -0.26, 0.055);
    Wd(cyl(0.17, 0.16, 0.36, 12), 0x9a8050, 1.1, D + 0.18, 0.2); for (let k = 0; k < 4; k++) Wd(tor(0.172, 0.014, 4, 12), 0x7a6238, 1.1, D + 0.05 + k * 0.09, 0.2, H); Wd(hemi(0.15, 10, 3), 0x5a4a32, 1.1, D + 0.33, 0.2, 0, 0, 0, 1, 0.5, 1);
    keg(1.1, -0.24);
  }
};

F.principalities = (i) => {
  const A = L.cloth, B = L.cloth2, G = L.trim, DW = 0x4a2a1e;
  frame({ sill: 0x5a2e22, sillB: 'w', head: 0x5a2e22, rivet: G }); planks({ col: 0x8a5e3a }); wheels({ n: 10, rim: 0x33333a, spoke: A, spokeB: 'w', hub: G });
  for (const z of [-1, 1]) { Mt(rb(2.5, 0.02, 0.016, 0.006), G, 0, 0.505, z * 0.452); for (let k = 0; k < 9; k++) Mt(cyl(0.034, 0.034, 0.014, 10), G, -1.0 + k * 0.25, 0.455, z * 0.45, H); }
  aframe({ col: DW, strap: G, pin: G }); beam({ col: DW, strap: G });
  // the merchant's scales stand over the pump
  for (const z of [-0.18, 0.18]) Mt(box(0.05, 0.1, 0.05), G, 0, 1.41, z);
  Mt(rb(0.1, 0.035, 0.44, 0.01), G, 0, 1.47, 0); Mt(cyl(0.014, 0.02, 0.26, 6), G, 0, 1.61, 0); Mt(cyl(0.009, 0.009, 0.5, 5), G, 0, 1.73, 0, H); Mt(ball(0.025, 6, 4), G, 0, 1.75, 0);
  for (const z of [-0.23, 0.23]) { Mt(hemi(0.06, 10, 3), G, 0, 1.58, z, PI); for (const s of [-1, 1]) Mt(cyl(0.004, 0.004, 0.16, 3), G, s * 0.03, 1.655, z, 0, 0, s * 0.2); }
  // a striped awning over the strongboxes at the rear
  for (const x of [-0.96, -1.34]) for (const z of [-0.43, 0.43]) stripedPole(x, z, 0.86, A, B, G, 0.018);
  for (let k = 0; k < 8; k++) { const z = -0.42 + k * 0.12, y = D + 0.9 + 0.1 * Math.cos((z / 0.5) * H); Cl(box(0.45, 0.012, 0.125), k % 2 ? A : B, -1.16, y, z, (z / 0.5) * 0.3, 0, 0); for (const x of [-0.935, -1.385]) Cl(TRI(), k % 2 ? B : A, x, y - 0.005, z, 0, H, 0, 0.12, 0.09, 1); }
  for (const z of [-1, 1]) for (let k = 0; k < 4; k++) Cl(TRI(), k % 2 ? A : B, -0.985 - k * 0.115, D + 0.895, z * 0.485, 0, 0, 0, 0.115, 0.09, 1);
  // painted mooring poles at the head
  stripedPole(1.3, 0.42, 1.0, A, B, G); stripedPole(1.3, -0.42, 1.25, A, B, G); Sd(flagGeo(0.44, 0.2, 'swallow'), 1.275, D + 1.12, -0.42);
  Mt(tube([[1.3, D + 0.92, 0.42], [1.22, D + 0.98, 0.42], [1.14, D + 0.92, 0.42]], 0.01, 6, 4), G);
  plates();
  const silk = (x, z0) => [[A, 0, 0], [0x2a8a8a, 0.13, 0], [0x7a3a8a, 0.065, 0.11]].forEach(([c, dz, dy]) => { Wd(cyl(0.062, 0.062, 0.36, 10), c, x, D + 0.062 + dy, z0 + dz, 0, 0, H); Wd(cyl(0.02, 0.02, 0.4, 6), 0xd8c8a0, x, D + 0.062 + dy, z0 + dz, 0, 0, H); });
  const purse = (x, z, s) => { sack(x, z, s, 0x8a6a4a); Mt(cyl(0.03 * s / 0.5, 0.03 * s / 0.5, 0.01, 8), G, x, D + 0.14 * s, z + 0.18 * s, H); };
  if (i === 0) {
    chest(-1.13, 0.14, 0.34, 0.2, 0.3, 0x6a2a22, G, 0, D, true); Mt(hemi(0.13, 10, 3), 0xf0c040, -1.13, D + 0.17, 0.14, 0, 0, 0, 1, 0.5, 0.9); for (let k = 0; k < 5; k++) Mt(cyl(0.022, 0.022, 0.008, 8), 0xf0c040, -1.0 + rnd(k) * 0.06, D + 0.006, 0.34 - k * 0.03, 0, k, 0);
    silk(-1.13, -0.32); lantern(1.14, D + 0.64, 0.42, 1, G, L.glow, 'dome');
    urn(1.1, -0.2, 0.75, 0x2a6a8a, G); urn(1.1, 0.12, 0.6, 0xb86a42, G); purse(1.08, 0.3, 0.5);
  } else {
    chest(-1.13, -0.16, 0.34, 0.22, 0.3, 0x2a2a30, G); purse(-1.13, 0.2, 0.6); purse(-1.1, 0.34, 0.45); purse(-1.13, 0.24, 0.45); 
    // a songbird in a gilt cage
    at(1.14, D + 0.62, 0.42, 0, 0, 0, 1, () => { Mt(cyl(0.075, 0.075, 0.012, 10), G, 0, 0, 0); for (let k = 0; k < 8; k++) { const a = k * TAU / 8; Mt(cyl(0.004, 0.004, 0.17, 3), G, Math.cos(a) * 0.07, 0.085, Math.sin(a) * 0.07); } Mt(cone(0.078, 0.07, 10), G, 0, 0.205, 0); Mt(tor(0.02, 0.005, 4, 8), G, 0, 0.26, 0); Wd(ball(0.03, 8, 6), 0x3aa85a, 0, 0.06, 0, 0, 0, 0, 1, 1.2, 1); Wd(ball(0.02, 6, 4), 0xd8c83a, 0.01, 0.105, 0); Wd(cone(0.008, 0.025, 4), 0xe8782a, 0.035, 0.105, 0, 0, 0, -H); });
    barrel(1.1, -0.2, 0.15, 0.38, 0x7a4a2e, G); crate(1.1, 0.14, 0.26, 0.2, 0.26, 0.05, 0x9a6a42);
  }
};

F.sunkings = (i) => {
  const A = L.cloth, B = L.cloth2, G = 0xe0b030, TEAL = 0x2a9a8a;
  frame({ sill: A, sillB: 'w', head: A, rivet: G }); planks({ col: 0xb08a52 }); wheels({ kind: 'sun', n: 12, rim: G, spoke: G, hub: G, cap: B });
  for (const z of [-1, 1]) { Wd(rb(2.5, 0.022, 0.014, 0.005), B, 0, 0.512, z * 0.452); for (let k = 0; k < 9; k++) Mt(hemi(0.034, 8, 3), G, -1.0 + k * 0.25, 0.46, z * 0.444, z * H); }
  posts(() => { Mt(frus(0.6), G, 0, 0.34, 0, 0, 0, 0, 0.17, 0.68, 0.1); Wd(box(0.15, 0.05, 0.105), A, 0, 0.14, 0); Wd(box(0.13, 0.04, 0.1), TEAL, 0, 0.42, 0); Mt(rb(0.15, 0.13, 0.08, 0.02), G, 0, 0.72, 0); Mt(box(0.05, 0.12, 0.05), G, 0, 0.83, 0); });
  pivot(G);
  // the sun itself rides above the pump
  Mt(rb(0.07, 0.04, 0.44, 0.012), G, 0, 1.47, 0); Mt(cyl(0.025, 0.035, 0.08, 8), G, 0, 1.52, 0);
  Mt(cyl(0.2, 0.2, 0.03, 20), G, 0, 1.76, 0, 0, 0, H); Gl(cyl(0.125, 0.125, 0.04, 16), L.glow, 0, 1.76, 0, 0, 0, H); Mt(tor(0.13, 0.014, 4, 18), G, 0, 1.76, 0, 0, H, 0);
  for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; if (Math.cos(a) < -0.75) continue; const len = k % 2 ? 0.13 : 0.22, r = 0.2 + len / 2; Mt(cone(0.03, len, 4), G, 0, 1.76 + Math.cos(a) * r, Math.sin(a) * r, a, 0, 0, 0.5, 1, 1); }
  beam({ col: 0x8a5a2e, strap: G, knob: G });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { Wd(frus(0.7), A, sx * 1.3, D + 0.19, sz * 0.42, 0, 0, 0, 0.075, 0.38, 0.075); Mt(ball(0.045, 8, 6), G, sx * 1.3, D + 0.42, sz * 0.42); }
  // a feather standard and the side's pennant
  post(-1.3, 0, 1.15, G, 0.016); for (let k = 0; k < 7; k++) { const a = (k - 3) * 0.3; Cl(cone(0.05, 0.3, 5), [A, B, TEAL][k % 3], -1.3, D + 1.15 + Math.cos(a) * 0.16, Math.sin(a) * 0.16, a, 0, 0, 0.25, 1, 1); } Mt(hemi(0.05, 8, 3), G, -1.3, D + 1.13, 0);
  pennant(1.3, -0.42, 1.25, 'point', 0.46, 0.2, G, G); plates();
  const brazier = (x, z) => { for (let k = 0; k < 3; k++) { const a = k * TAU / 3; Mt(cyl(0.01, 0.01, 0.34, 4), G, x + Math.cos(a) * 0.06, D + 0.16, z + Math.sin(a) * 0.06, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); } Mt(lathe([[0.02, 0], [0.09, 0.03], [0.12, 0.09], [0.11, 0.09], [0, 0.04]], 10), G, x, D + 0.3, z); flame(x, D + 0.36, z, 0.9); };
  if (i === 0) {
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3 - r; k++) Mt(frus(0.72), 0xf0c040, -1.1, D + 0.03 + r * 0.06, -0.14 + (k + r * 0.5) * 0.19 - 0.05, 0, 0, 0, 0.26, 0.055, 0.16);
    brazier(1.14, 0); urn(1.1, -0.3, 0.6, G, TEAL); urn(1.1, 0.3, 0.6, G, A);
  } else {
    for (const z of [-0.2, 0.2]) { Wd(cyl(0.14, 0.11, 0.18, 12), 0xa88850, -1.1, D + 0.09, z); Wd(tor(0.14, 0.014, 4, 12), 0x8a6a3a, -1.1, D + 0.18, z, H); for (let k = 0; k < 6; k++) Wd(ball(0.045, 6, 5), z > 0 ? 0xe8b830 : 0xc8482a, -1.1 + Math.cos(k * 1.05) * 0.07, D + 0.2 + (k === 5 ? 0.04 : 0), z + Math.sin(k * 1.05) * 0.07); }
    for (let k = 0; k < 3; k++) Wd(rb(0.4 - k * 0.1, 0.1, 0.56 - k * 0.14, 0.012), 0xc8b88a, 1.12, D + 0.05 + k * 0.1, 0); Gl(cyl(0.1, 0.1, 0.012, 14), L.glow, 1.12, D + 0.306, 0); Mt(tor(0.105, 0.014, 4, 14), G, 1.12, D + 0.305, 0, H);
  }
};

// ---- elves and dwarfs ----------------------------------------------------------------------------
F.aethel = (i) => {
  const W = L.wood, G = L.trim, T = L.cloth2, PW = 0xf4f0e4;
  frame({ noSill: 1, head: W, sillB: 'w', buffer: G }); planks({ col: 0xf2ecdc, n: 11 });
  wheels({ kind: 'swirl', n: 7, rim: 0xe6e2d6, spoke: G, hub: G, box: 0xdedacc, boxCap: G });
  // sweeping rails that rise into a swan prow and a curled tail
  for (const z of [-1, 1]) {
    Wd(tube([[-1.36, 0.98, z * 0.06], [-1.42, 0.8, z * 0.14], [-1.36, 0.58, z * 0.32], [-1.05, 0.47, z * 0.43], [0, 0.45, z * 0.45], [1.0, 0.47, z * 0.43], [1.3, 0.6, z * 0.28], [1.39, 0.9, z * 0.1], [1.31, 1.16, z * 0.03], [1.33, 1.27, 0]], 0.044, 30, 7), W);
    Mt(tube([[-1.36, 0.5, z * 0.36], [-1.05, 0.4, z * 0.462], [0, 0.385, z * 0.482], [1.0, 0.4, z * 0.462], [1.3, 0.52, z * 0.32]], 0.013, 18, 4), G);
    for (const x of [-0.78, -0.26, 0.26, 0.78]) { Wd(ball(0.07, 8, 5), T, x, 0.45, z * 0.492, 0, 0, 0.45, 1.7, 0.55, 0.22); Mt(ball(0.018, 6, 4), G, x - 0.1, 0.4, z * 0.497); }
  }
  Mt(tor(0.05, 0.016, 5, 10, PI * 1.5), G, -1.33, 1.0, 0, 0, 0, 1.2); // the tail's curl
  Wd(ball(0.058, 10, 8), W, 1.36, 1.3, 0, 0, 0, -0.3, 1.5, 1, 0.95); Mt(cone(0.022, 0.08, 6), G, 1.42, 1.27, 0, 0, 0, -H - 0.4); for (const z of [-1, 1]) Gl(ball(0.012, 5, 4), L.glow, 1.39, 1.315, z * 0.045);
  Mt(cyl(0.004, 0.004, 0.2, 3), G, 1.26, 1.06, 0); Mt(cone(0.03, 0.05, 6), G, 1.26, 0.975, 0); Gl(oct(0.06), L.glow, 1.26, 0.87, 0, 0, 0.6, 0, 0.8, 1.6, 0.8); Mt(cone(0.02, 0.05, 6), G, 1.26, 0.76, 0, PI);
  // the pump stands in a lyre of two bent boughs
  posts(() => {
    for (const sx of [-1, 1]) Wd(tube([[sx * 0.24, 0, 0], [sx * 0.21, 0.3, 0], [sx * 0.08, 0.58, 0], [0, 0.72, 0], [-sx * 0.05, 0.9, 0]], 0.028, 12, 6), W);
    Mt(ball(0.058, 10, 8), G, 0, 0.72, 0); Mt(tor(0.045, 0.012, 4, 10), G, 0, 0.3, 0, H, 0, 0, 4.6, 1, 1.2); for (const sx of [-1, 1]) Wd(ball(0.05, 8, 5), T, -sx * 0.06, 0.96, 0, 0, 0, sx * 0.2, 0.5, 1.5, 0.3);
  });
  pivot(G);
  beam({ shape: 'arc', col: W, strap: G, handle: G, hb: 'm', noCaps: 1, knob: G, extra: () => { for (const s of [-1, 1]) Wd(ball(0.05, 8, 5), T, s * 0.6, 0.06, 0, 0, 0, s * 0.3, 1.6, 0.4, 0.8); } });
  gonfalon(-1.37, 0, 1.3, 0.26, 0.6, 'point', G, G, true); plates(0.45, 0, 0.5);
  const pod = (x, z) => { Wd(ball(0.13, 10, 7), T, x, D + 0.1, z, 0, 0, 0, 1, 0.75, 1.25); Mt(tor(0.127, 0.01, 4, 12), G, x, D + 0.1, z, 0, H, 0); Mt(cone(0.02, 0.06, 5), G, x, D + 0.21, z); };
  if (i === 0) {
    urn(1.04, -0.27, 0.7, PW, G); urn(1.04, 0.27, 0.6, PW, T);
    chest(-1.1, 0, 0.42, 0.14, 0.24, PW, G, H); for (let k = 0; k < 3; k++) Gl(oct(0.035), L.glow, -1.1, D + 0.3 + (k === 1 ? 0.03 : 0), -0.1 + k * 0.1, 0, k, 0, 0.8, 1.7, 0.8);
  } else {
    pod(1.04, -0.24); pod(1.04, 0.24);
    // a harp
    Mt(tube([[-1.1, D + 0.02, -0.14], [-1.1, D + 0.56, -0.2], [-1.1, D + 0.6, 0.02], [-1.1, D + 0.42, 0.2], [-1.1, D + 0.04, 0.02]], 0.02, 18, 5), G); Wd(rb(0.07, 0.04, 0.26, 0.012), W, -1.1, D + 0.02, -0.05);
    for (let k = 0; k < 6; k++) { const z = -0.12 + k * 0.045, h = 0.5 - k * 0.055; Mt(cyl(0.003, 0.003, h, 3), 0xf8f4e8, -1.1, D + 0.05 + h / 2, z); }
    urn(-1.1, 0.33, 0.45, PW, G);
  }
};

F.kaelneth = (i) => {
  const A = L.cloth, M = L.metal, Gw = L.glow, T = L.trim;
  frame({ sill: M, head: M, rivet: T, buffer: T }); planks({ col: L.wood, n: 11 }); wheels({ kind: 'blade', n: 7, rim: M, spoke: T, hub: shade(M, 1.6), cap: Gw, boxCap: Gw });
  for (const z of [-1, 1]) { // a serrated skirt of blades, a vein of witch-light along the sill
    Gl(box(2.4, 0.012, 0.006), Gw, 0, 0.485, z * 0.447);
    for (let k = 0; k < 12; k++) Mt(TRI(), k % 3 ? shade(M, 1.3) : T, -1.1 + k * 0.2, 0.41, z * 0.45, 0, 0, 0, 0.2, 0.13 + (k % 3 ? 0 : 0.07), 1);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { Mt(cone(0.03, 0.62, 4), M, sx * 1.32, D + 0.31, sz * 0.42); if (sx > 0) Gl(oct(0.035), Gw, 1.32, D + 0.68, sz * 0.42, 0, 0, 0, 0.8, 1.5, 0.8); }
  posts(() => { for (const sx of [-1, 1]) Mt(frus(0.12), M, sx * 0.095, 0.43, 0, 0, 0, sx * 0.245, 0.13, 0.9, 0.055); Mt(oct(0.075), T, 0, 0.72, 0, 0, 0, 0, 1, 1, 0.75); });
  pivot(T); Gl(oct(0.07), Gw, 0, 1.68, 0, 0, 0.5, 0, 0.75, 1.7, 0.75); Mt(tor(0.1, 0.008, 4, 14), T, 0, 1.68, 0, H); Mt(tor(0.12, 0.006, 4, 14), T, 0, 1.68, 0, H + 0.5, 0.4, 0);
  beam({ b: 'm', col: M, strap: T, hb: 'm', handle: T, knob: Gw, extra: () => { for (const s of [-1, 1]) Mt(cone(0.026, 0.13, 4), T, s * 0.82, 0, 0, 0, 0, -s * H); } });
  // a crescent of blades for a prow
  Mt(tor(0.34, 0.024, 4, 16, PI), M, 1.37, D + 0.44, 0, 0, H, PI, 1, 1, 0.4); for (const z of [-1, 1]) Mt(cone(0.024, 0.2, 4), T, 1.37, D + 0.53, z * 0.34); Gl(oct(0.04), Gw, 1.37, D + 0.1, 0);
  gonfalon(-1.38, 0, 1.4, 0.28, 0.55, 'rag', M, Gw, true); for (const z of [-0.28, 0.28]) Cl(hangGeo(0.22, 0.22, 'rag'), A, -1.365, 0.5, z, 0, H, 0);
  plates();
  Mt(rb(0.34, 0.05, 0.62, 0.012), M, 1.1, D + 0.025, 0);
  for (let k = 0; k < 7; k++) { const r = rnd(k + 3 + i * 9), r2 = rnd(k * 5 + 1); Gl(oct(0.06), blend(Gw, 0xffffff, r * 0.35), 1.04 + r2 * 0.12, D + 0.14 + r * 0.06, -0.26 + k * 0.087, (r - 0.5) * 0.9, k, (r2 - 0.5) * 0.9, 0.7, 1.7 + r, 0.7); }
  if (i === 0) { // a caged wisp
    Mt(rb(0.34, 0.03, 0.5, 0.01), M, -1.12, D + 0.015, 0); Mt(rb(0.34, 0.03, 0.5, 0.01), M, -1.12, D + 0.44, 0); Mt(cone(0.05, 0.12, 4), T, -1.12, D + 0.51, 0);
    for (let k = 0; k < 7; k++) for (const sx of [-1, 1]) Mt(cyl(0.008, 0.008, 0.42, 4), T, -1.12 + sx * 0.155, D + 0.23, -0.225 + k * 0.075);
    for (let k = 1; k < 4; k++) for (const sz of [-1, 1]) Mt(cyl(0.008, 0.008, 0.42, 4), T, -1.275 + k * 0.0775, D + 0.23, sz * 0.235);
    Gl(ball(0.075, 10, 8), Gw, -1.12, D + 0.22, 0); Gl(cone(0.05, 0.16, 6), blend(Gw, 0xffffff, 0.4), -1.12, D + 0.32, 0.02);
  } else {
    chest(-1.12, 0, 0.5, 0.18, 0.28, 0x1c1820, T, H); chest(-1.12, 0.06, 0.26, 0.1, 0.18, A, T, H, D + 0.32);
    chain([-1.12, D + 0.34, -0.3], [-1.12, D + 0.02, -0.4], 5, T, 0.02, 0.02); chain([-1.3, D + 0.6, 0.42], [-1.3, D + 0.6, -0.42], 16, T, 0.2, 0.02);
  }
};

F.grom = (i) => {
  const M = L.metal, BR = L.trim, A = L.cloth, DK = 0x2e2e34;
  frame({ sill: M, head: M, rivet: BR, buffer: BR }); planks({ b: 'm', n: 6, col: 0x5a5a64 }); wheels({ kind: 'disc', rim: DK, spoke: M, hub: BR, box: M });
  for (let k = 0; k < 7; k++) for (const z of [-0.38, 0, 0.38]) Mt(RIV(), BR, -1.24 + k * 0.413, 0.582, z);
  for (const z of [-1, 1]) { Wd(rb(2.3, 0.045, 0.012, 0.004), A, 0, 0.485, z * 0.45); for (let k = 0; k < 11; k++) Mt(box(0.045, 0.045, 0.014), BR, -1.0 + k * 0.2, 0.485, z * 0.452, 0, 0, PI / 4); }
  posts((s) => { // stout rune-cut pillars with the rocking gear outside
    Mt(rb(0.2, 0.66, 0.1, 0.02), M, 0, 0.33, 0); Mt(rb(0.25, 0.06, 0.14, 0.015), BR, 0, 0.03, 0); Mt(rb(0.23, 0.045, 0.12, 0.012), BR, 0, 0.5, 0); Mt(rb(0.18, 0.17, 0.11, 0.03), BR, 0, 0.72, 0);
    Gl(box(0.014, 0.22, 0.006), L.glow, 0, 0.26, s * 0.052); Gl(box(0.014, 0.1, 0.006), L.glow, 0.032, 0.31, s * 0.052, 0, 0, 0.8); Gl(box(0.014, 0.1, 0.006), L.glow, -0.032, 0.21, s * 0.052, 0, 0, 0.8);
    gear(0, 0.72, s * 0.085, 0.125, 10, 0.03, DK, 0, 0, BR);
  });
  pivot(DK);
  beam({ shape: 'girder', b: 'm', col: M, strap: BR, hb: 'm', handle: DK, knob: BR, noCaps: 1, extra: () => { for (const s of [-1, 1]) Mt(rb(0.1, 0.13, 0.12, 0.025), DK, s * 0.715, 0, 0); } });
  // an ancestor's brazen face on the headstock
  at(1.365, 0.5, 0, 0, 0, 0, 1, () => {
    Mt(hemi(0.11, 10, 4), BR, 0, 0, 0, 0, 0, -H, 1, 0.6, 1.1); Mt(box(0.03, 0.15, 0.03), DK, 0.065, 0.02, 0); for (const z of [-1, 1]) { Gl(ball(0.016, 5, 4), L.glow, 0.058, 0.03, z * 0.045); Wd(cone(0.028, 0.17, 6), BONE, 0, 0.12, z * 0.1, z * 0.7, 0, 0); }
    for (let k = -1; k <= 1; k++) Mt(cone(0.036, 0.2, 5), BR, 0.04, -0.13, k * 0.06, PI);
  });
  post(1.3, 0.42, 0.55, M, 0.03); lantern(1.3, D + 0.55, 0.42, 1.4, BR, L.glow, 'dome'); gonfalon(-1.37, 0, 1.2, 0.3, 0.4, 'point', DK, BR, true); plates(0.415);
  // an ore tub at the head
  Mt(frus(0.72), M, 1.1, D + 0.15, 0, PI, 0, 0, 0.4, 0.3, 0.7); Mt(rb(0.42, 0.035, 0.72, 0.012), BR, 1.1, D + 0.3, 0); for (const z of [-0.2, 0.2]) Mt(box(0.3, 0.26, 0.02), BR, 1.1, D + 0.15, z);
  for (let k = 0; k < 9; k++) { const r = rnd(k + 2 + i * 7); emit('m', ico(0.07), (k + i) % 3 ? (i ? 0x7a7a88 : GOLD) : (i ? 0x9ad0e8 : 0x6a6a76), 1.04 + rnd(k * 3) * 0.12, D + 0.32 + (k % 2) * 0.04, -0.26 + k * 0.065, r * 3, r * 5, 0, 0.8 + r * 0.5); }
  if (i === 0) { // ale
    for (const z of [-0.19, 0.19]) barrel(-1.12, z, 0.13, 0.36, 0x7a4a2a, BR, D, H); barrel(-1.12, 0, 0.12, 0.34, 0x8a5a32, BR, D + 0.215, H);
    Mt(cyl(0.012, 0.012, 0.06, 5), BR, -1.12, D + 0.335, 0.2, H); lash(-1.12, 0.47, 0.36);
  } else { // an anvil, a hammer, bar stock
    Mt(rb(0.2, 0.07, 0.24, 0.015), DK, -1.12, D + 0.035, -0.14); Mt(rb(0.11, 0.12, 0.14, 0.02), DK, -1.12, D + 0.12, -0.14); Mt(rb(0.15, 0.08, 0.36, 0.015), 0x4a4a52, -1.12, D + 0.22, -0.12); Mt(cone(0.04, 0.14, 8), 0x4a4a52, -1.12, D + 0.225, -0.36, -H);
    Wd(cyl(0.014, 0.014, 0.26, 6), 0x6a4a2e, -1.12, D + 0.275, -0.08, H, 0, 0.3); Mt(rb(0.07, 0.06, 0.1, 0.012), DK, -1.16, D + 0.29, -0.2, 0, 0.3, 0);
    for (let r = 0; r < 2; r++) for (let k = 0; k < 3 - r; k++) Mt(frus(0.75), r ? BR : 0x8a8a94, -1.12, D + 0.03 + r * 0.06, 0.16 + (k + r * 0.5) * 0.1, 0, 0, 0, 0.3, 0.055, 0.09);
  }
};

// ---- the east -------------------------------------------------------------------------------------
F.tianlong = (i) => {
  const R = L.cloth, J = L.cloth2, G = L.trim, LQ = 0x7a1a14;
  frame({ sill: R, sillB: 'w', head: R, rivet: G, buffer: G }); planks({ col: 0x7a4a30 }); wheels({ n: 12, rim: 0x2a2a2e, spoke: R, spokeB: 'w', hub: G });
  for (const z of [-1, 1]) { Mt(rb(2.5, 0.016, 0.016, 0.005), G, 0, 0.512, z * 0.452); for (let k = 0; k < 10; k++) { Mt(box(0.07, 0.045, 0.012), G, -1.08 + k * 0.24, 0.462, z * 0.449); Wd(box(0.036, 0.02, 0.016), R, -1.08 + k * 0.24, 0.462, z * 0.449); } }
  posts(() => { Mt(lathe([[0.075, 0], [0.078, 0.03], [0.05, 0.06]], 10), G); Wd(cyl(0.04, 0.046, 0.62, 10), R, 0, 0.36, 0); Mt(cyl(0.05, 0.05, 0.03, 10, true), G, 0, 0.5, 0); Mt(rb(0.15, 0.12, 0.08, 0.02), G, 0, 0.72, 0); Wd(cyl(0.034, 0.034, 0.2, 8), R, 0, 0.86, 0); });
  pivot(G); Wd(rb(0.1, 0.04, 0.5, 0.01), R, 0, 1.535, 0); sweptRoof(0, 1.57, 0, 0.5, 0.66, 0.2, J, G);
  for (const z of [-0.34, 0.34]) { Mt(cyl(0.004, 0.004, 0.08, 3), G, 0, 1.52, z); Mt(cyl(0.03, 0.03, 0.016, 8), G, 0, 1.475, z); Gl(ball(0.062, 10, 8), blend(R, L.glow, 0.45), 0, 1.41, z, 0, 0, 0, 1, 1.1, 1); Mt(cyl(0.03, 0.03, 0.016, 8), G, 0, 1.345, z); Wd(cone(0.014, 0.08, 4), G, 0, 1.3, z, PI); }
  beam({ col: LQ, strap: G, knob: G });
  // the dragon: head high at the prow, tail curling over the stern
  Mt(tube([[1.18, D - 0.02, 0], [1.31, D + 0.24, 0], [1.24, D + 0.5, 0], [1.3, D + 0.7, 0]], 0.055, 14, 7), G);
  for (let k = 0; k < 4; k++) Wd(cone(0.03, 0.12, 4), J, 1.21 + (k % 2) * 0.04 - (k === 3 ? 0.02 : 0), D + 0.2 + k * 0.15, 0, 0, 0, 0.9, 1, 1, 0.5);
  at(1.32, D + 0.76, 0, 0, 0, -0.15, 1, () => {
    Mt(rb(0.2, 0.1, 0.13, 0.03), G, 0.02, 0, 0); Mt(rb(0.14, 0.035, 0.1, 0.012), R, 0.04, -0.075, 0, 0, 0, -0.3); Mt(rb(0.08, 0.06, 0.14, 0.02), G, -0.05, 0.04, 0);
    for (const z of [-1, 1]) { Gl(ball(0.018, 6, 4), L.glow, 0.03, 0.045, z * 0.062); Wd(cone(0.016, 0.17, 5), J, -0.1, 0.13, z * 0.045, 0, 0, 0.8); Mt(tube([[0.1, 0, z * 0.05], [0.14, 0.04, z * 0.1], [0.1, 0.1, z * 0.15]], 0.007, 6, 3), G); Wd(cone(0.012, 0.035, 4), 0xf8f4e8, 0.09, -0.045, z * 0.04, PI); }
    Gl(ball(0.03, 8, 6), L.glow, 0.085, -0.04, 0);
  });
  Mt(tube([[-1.2, D - 0.02, 0], [-1.37, D + 0.2, 0], [-1.28, D + 0.42, 0], [-1.38, D + 0.56, 0]], 0.04, 12, 6), G); for (let k = 0; k < 3; k++) Wd(cone(0.03, 0.16, 4), J, -1.4, D + 0.62, (k - 1) * 0.04, (k - 1) * 0.5, 0, 0.5, 1, 1, 0.5);
  gonfalon(-1.3, -0.42, 1.5, 0.22, 0.7, 'swallow', R, G); plates();
  urn(1.05, -0.3, 0.62, 0xf0f0ea, 0x2a4a9a); urn(1.05, 0.3, 0.62, 0xf0f0ea, 0x2a4a9a);
  if (i === 0) {
    crate(-1.1, -0.2, 0.3, 0.26, 0.32, 0, 0x4a2a20); crate(-1.1, 0.19, 0.3, 0.22, 0.34, 0.05, 0x6a3a26); crate(-1.1, -0.02, 0.24, 0.18, 0.26, 0.2, 0x8a2a1e, D + 0.27);
    for (const z of [-0.2, 0.19]) Mt(rb(0.012, 0.1, 0.1, 0.004), G, -0.945, D + 0.13, z);
  } else { // a war drum
    for (const z of [-0.2, 0.2]) for (const s of [-1, 1]) Wd(rb(0.04, 0.34, 0.04, 0.01), LQ, -1.13, D + 0.15, z, 0, 0, s * 0.6);
    barrel(-1.13, 0, 0.19, 0.46, R, G, D + 0.1, H); for (const z of [-1, 1]) { Wd(cyl(0.155, 0.155, 0.012, 14), 0xe8dcc0, -1.13, D + 0.29, z * 0.228, H); for (let k = 0; k < 10; k++) Mt(RIV(), G, -1.13 + Math.cos(k * 0.628) * 0.165, D + 0.29 + Math.sin(k * 0.628) * 0.165, z * 0.2, H); }
  }
};

F.shogunate = (i) => {
  const R = L.cloth, W = L.cloth2, BK = 0x1c1c20, G = L.trim, HN = 0xc8a878, BAM = 0x9a9a52;
  frame({ sill: BK, sillB: 'w', head: BK, rivet: G, buffer: R }); planks({ col: HN, n: 15 }); wheels({ n: 10, rim: 0x26262a, spoke: BK, spokeB: 'w', hub: R, cap: G });
  for (const z of [-1, 1]) { // the sun in splendour on both flanks
    Wd(rb(2.5, 0.014, 0.014, 0.004), R, 0, 0.512, z * 0.452);
    for (const x of [-0.8, 0.8]) { Wd(cyl(0.1, 0.1, 0.012, 16), W, x, 0.455, z * 0.452, H); Wd(cyl(0.042, 0.042, 0.02, 12), R, x, 0.455, z * 0.452, H); for (let k = 0; k < 8; k++) { const a = k * TAU / 8; Wd(box(0.014, 0.04, 0.018), R, x + Math.cos(a) * 0.072, 0.455 + Math.sin(a) * 0.072, z * 0.452, 0, 0, a - H); } }
  }
  // the pump stands in a gate
  for (const s of [-1, 1]) { Wd(cyl(0.038, 0.048, 1.06, 10), R, 0, D + 0.53, s * 0.2); Wd(cyl(0.062, 0.066, 0.08, 10), BK, 0, D + 0.04, s * 0.2); Mt(cyl(0.05, 0.05, 0.05, 10, true), G, 0, 1.3, s * 0.2); }
  pivot(G); Wd(rb(0.06, 0.07, 0.64, 0.012), R, 0, 1.5, 0); Wd(rb(0.1, 0.06, 0.76, 0.015), R, 0, 1.645, 0); Wd(rb(0.13, 0.035, 0.6, 0.012), BK, 0, 1.69, 0);
  for (const s of [-1, 1]) Wd(rb(0.13, 0.035, 0.2, 0.012), BK, 0, 1.706, s * 0.385, -s * 0.18, 0, 0); Mt(rb(0.03, 0.09, 0.08, 0.008), G, 0, 1.575, 0);
  Wd(tube([[0.05, 1.47, -0.2], [0.055, 1.43, 0], [0.05, 1.47, 0.2]], 0.02, 8, 6), STRAW); for (const z of [-0.11, 0.11]) Cl(box(0.004, 0.06, 0.035), 0xffffff, 0.06, 1.4, z, 0.3);
  beam({ col: 0x8a6238, strap: BK, knob: G });
  // tall banners at the rear
  for (const s of [-1, 1]) {
    post(-1.3, s * 0.42, 1.75, BAM, 0.016, 'w'); Wd(cyl(0.011, 0.011, 0.3, 5), BAM, -1.17, D + 1.71, s * 0.42, 0, 0, H);
    if (s < 0) Sd(hangGeo(0.24, 1.05, 'rect'), -1.16, D + 1.7, s * 0.42);
    else { Cl(hangGeo(0.24, 1.05, 'rect'), W, -1.16, D + 1.7, s * 0.42); Cl(cyl(0.075, 0.075, 0.03, 14), R, -1.16, D + 1.3, s * 0.42, H); for (const y of [1.62, 1.56]) Cl(box(0.24, 0.03, 0.02), BK, -1.16, D + y, s * 0.42); }
  }
  plates();
  // a stone lantern at the head
  at(1.14, D, 0.24, 0, 0, 0, 1, () => { Wd(lathe([[0.1, 0], [0.1, 0.03], [0.04, 0.06], [0.035, 0.24], [0.09, 0.27], [0.09, 0.3]], 8), STONE); Gl(box(0.1, 0.09, 0.1), L.glow, 0, 0.345, 0); for (let k = 0; k < 4; k++) Wd(box(0.028, 0.1, 0.028), STONE, (k % 2 ? 1 : -1) * 0.05, 0.345, (k < 2 ? 1 : -1) * 0.05); Wd(cone(0.17, 0.1, 6), shade(STONE, 0.85), 0, 0.445, 0); Wd(ball(0.03, 6, 5), STONE, 0, 0.51, 0); });
  const bale = (x, y, z) => { Wd(cyl(0.11, 0.11, 0.36, 10), STRAW, x, y, z, 0, 0, H); for (const d of [-0.12, 0, 0.12]) Wd(cyl(0.114, 0.114, 0.02, 10, true), 0x8a7440, x + d, y, z, 0, 0, H); Wd(cyl(0.05, 0.05, 0.364, 8), shade(STRAW, 0.8), x, y, z, 0, 0, H); };
  if (i === 0) {
    for (const z of [-0.23, 0, 0.23]) bale(-1.14, D + 0.11, z * 0.98); bale(-1.14, D + 0.3, -0.115); bale(-1.14, D + 0.3, 0.115);
    for (const z of [-0.3, -0.4]) { Wd(cyl(0.012, 0.012, 1.3, 5), BK, 1.3, D + 0.65, z); Mt(box(0.008, 0.3, 0.035), 0xc8ccd4, 1.3, D + 1.44, z, 0, 0, 0.06); Cl(cone(0.025, 0.08, 5), R, 1.3, D + 1.26, z, PI); }
    Wd(rb(0.04, 0.04, 0.3, 0.01), BK, 1.3, D + 0.3, -0.35);
  } else {
    for (const z of [-0.23, 0, 0.23]) bale(-1.14, D + 0.11, z * 0.98);
    for (const [y, r] of [[0, 0.16], [0.31, 0.13]]) { Wd(cyl(r, r, 0.3, 14), 0xe0d4a8, 1.1, D + y + 0.15, -0.2); for (const d of [0.07, 0.23]) Wd(tor(r + 0.002, 0.012, 4, 14), ROPE, 1.1, D + y + d, -0.2, H); Wd(cyl(r * 0.45, r * 0.45, r * 2 + 0.012, 10), R, 1.1, D + y + 0.15, -0.2, 0, 0, H); Wd(cyl(r * 0.88, r * 0.88, 0.02, 12), HN, 1.1, D + y + 0.3, -0.2); }
  }
};

F.thousandgods = (i) => {
  const S = L.cloth, Mg = L.cloth2, G = L.trim, STN = 0xb8a890, PINK = 0xe87a9a;
  frame({ sill: Mg, sillB: 'w', head: Mg, rivet: G, buffer: G }); planks({ col: 0x8a5e3a }); wheels({ n: 16, rim: G, spoke: G, hub: S, cap: G });
  for (const z of [-1, 1]) for (let sw = 0; sw < 4; sw++) { // garlands of marigolds
    const x0 = -1.2 + sw * 0.6; Mt(hemi(0.03, 8, 3), G, x0, 0.5, z * 0.446, z * H); if (sw === 3) Mt(hemi(0.03, 8, 3), G, 1.2, 0.5, z * 0.446, z * H);
    for (let k = 0; k < 5; k++) { const t = (k + 0.5) / 5; Wd(ball(0.032, 5, 4), [0xf09a1a, 0xf0d02a, 0xf4f0e0][(k + sw) % 3], x0 + t * 0.6, 0.5 - 0.44 * t * (1 - t), z * 0.462); }
  }
  posts(() => { Wd(lathe([[0.075, 0], [0.075, 0.04], [0.05, 0.06], [0.06, 0.12], [0.045, 0.16], [0.05, 0.3], [0.066, 0.34], [0.045, 0.38], [0.045, 0.56], [0.08, 0.62], [0.08, 0.66]], 8), STN); Mt(rb(0.15, 0.12, 0.085, 0.02), G, 0, 0.72, 0); Wd(box(0.07, 0.14, 0.07), STN, 0, 0.83, 0); });
  pivot(G);
  for (let k = 0; k < 4; k++) Wd(rb(+(0.22 - k * 0.04).toFixed(2), 0.07, +(0.56 - k * 0.12).toFixed(2), 0.012), k % 2 ? S : Mg, 0, 1.5 + k * 0.07, 0); // a temple tower over the pump
  const kal = (x, y, z, s) => Mt(lathe([[0.02, 0], [0.045, 0.03], [0.02, 0.07], [0.03, 0.09], [0, 0.14]], 8), G, x, y, z, 0, 0, 0, s);
  kal(0, 1.745, 0, 1.1); for (const z of [-0.24, 0.24]) kal(0, 1.535, z, 0.6);
  beam({ col: 0x6a3a22, strap: G, knob: G });
  // the many-armed god rides at the head on a lotus
  at(1.15, D, 0, 0, 0, 0, 1, () => {
    Wd(lathe([[0.1, 0], [0.16, 0.04], [0.18, 0.09], [0.12, 0.1]], 10), PINK); for (let k = 0; k < 10; k++) { const a = k * TAU / 10; Wd(cone(0.04, 0.1, 4), 0xf4a0b8, Math.cos(a) * 0.17, 0.09, Math.sin(a) * 0.17, Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7, 1, 1, 0.5); }
    Mt(lathe([[0.11, 0], [0.13, 0.04], [0.085, 0.1], [0.095, 0.2], [0.085, 0.28], [0.03, 0.3]], 10), G, 0, 0.1, 0, 0, 0, 0, 1, 1, 1.15); Mt(ball(0.055, 10, 8), G, 0, 0.45, 0); Mt(cone(0.042, 0.14, 8), G, 0, 0.56, 0); Mt(tor(0.045, 0.01, 4, 10), S, 0, 0.495, 0, H); Gl(ball(0.012, 5, 4), L.glow, 0.052, 0.47, 0);
    for (const s of [-1, 1]) [[0.18, 0.62], [0.26, 0.42], [0.22, 0.22]].forEach(([e, hnd], k) => { Mt(tube([[0, 0.36, s * 0.09], [0.02, 0.2 + e * 0.6, s * 0.2], [0.04, hnd, s * 0.3]], 0.016, 6, 5), G); if (k === 0) Gl(ball(0.025, 6, 4), L.glow, 0.04, hnd + 0.03, s * 0.3); else if (k === 1) Mt(tor(0.03, 0.008, 4, 8), S, 0.04, hnd, s * 0.32, 0, H, 0); else Wd(cone(0.022, 0.06, 5), PINK, 0.04, hnd + 0.03, s * 0.3); });
    Mt(tor(0.21, 0.012, 4, 20), G, -0.06, 0.4, 0, 0, H, 0); for (let k = 0; k < 9; k++) { const a = (k - 4) * 0.36; Mt(cone(0.02, 0.07, 4), S, -0.06, 0.4 + Math.cos(a) * 0.245, Math.sin(a) * 0.245, a, 0, 0); }
    Mt(cyl(0.008, 0.008, 0.2, 4), G, -0.06, 0.72, 0); Cl(cone(0.15, 0.06, 12), Mg, -0.03, 0.85, 0); Mt(tor(0.15, 0.008, 4, 12), G, -0.03, 0.82, 0, H); Cl(cone(0.08, 0.05, 10), S, -0.03, 0.91, 0); Mt(ball(0.015, 5, 4), G, -0.03, 0.945, 0);
  });
  pennant(1.33, -0.43, 1.2, 'point', 0.4, 0.2, G, G);
  post(1.33, 0.43, 0.85, G, 0.014); Cl(flagGeo(0.26, 0.14, 'point'), S, 1.315, D + 0.76, 0.43); Mt(ball(0.025, 6, 4), G, 1.33, D + 0.87, 0.43);
  plates();
  const bowl = (x, z, c) => { Mt(lathe([[0.03, 0], [0.07, 0.03], [0.08, 0.06]], 8), BRASS, x, D, z); for (let k = 0; k < 4; k++) Wd(ball(0.028, 5, 4), c, x + Math.cos(k * 2.1) * 0.03, D + 0.07 + (k === 3 ? 0.03 : 0), z + Math.sin(k * 2.1) * 0.03); };
  if (i === 0) { // a temple bell
    for (const z of [-0.33, 0.33]) Wd(rb(0.06, 0.7, 0.06, 0.012), Mg, -1.18, D + 0.35, z); Wd(rb(0.08, 0.06, 0.8, 0.012), S, -1.18, D + 0.71, 0); for (const z of [-0.42, 0.42]) kal(-1.18, D + 0.74, z * 0.8, 0.55);
    Mt(lathe(BELL, 12), BRASS, -1.18, D + 0.26, 0, 0, 0, 0, 2.1); Mt(cyl(0.01, 0.01, 0.08, 4), BRASS, -1.18, D + 0.66, 0); Mt(ball(0.035, 6, 5), DARK, -1.18, D + 0.25, 0); bowl(-1.0, 0.36, 0xe8782a); bowl(-1.0, -0.36, 0xd8c83a);
  } else { // a shrine
    Wd(lathe([[0.17, 0], [0.17, 0.06], [0.14, 0.08], [0.15, 0.2], [0.12, 0.38], [0.07, 0.52], [0.035, 0.58]], 8), STN, -1.14, D, 0); Mt(tor(0.045, 0.024, 5, 10), G, -1.14, D + 0.6, 0, H); kal(-1.14, D + 0.62, 0, 0.9);
    Gl(box(0.012, 0.11, 0.07), L.glow, -0.985, D + 0.13, 0); Wd(box(0.016, 0.15, 0.1), Mg, -0.99, D + 0.13, 0); bowl(-1.08, 0.33, 0xe8782a); bowl(-1.08, -0.33, 0xc8482a);
  }
};

// ---- the sands ------------------------------------------------------------------------------------
const crescent = (x, y, z, s = 1, col = GOLD) => Mt(tor(0.035, 0.01, 4, 10, PI * 1.4), col, x, y, z, 0, 0, PI * 0.8, s);
F.caliphate = (i) => {
  const C = L.cloth, T = L.cloth2, G = L.trim, SW = L.wood;
  frame({ sill: T, sillB: 'w', head: SW, rivet: G, buffer: G }); planks({ col: SW }); wheels({ n: 8, rim: 0x5a4a32, spoke: G, hub: G, box: 0x6a5a3a });
  for (const z of [-1, 1]) { Wd(rb(2.5, 0.02, 0.014, 0.005), C, 0, 0.512, z * 0.452); for (let k = 0; k < 9; k++) for (const r of [0, PI / 4]) Mt(box(0.05, 0.05, 0.012), G, -1.0 + k * 0.25, 0.458, z * 0.449, 0, 0, r); }
  posts(() => { Wd(rb(0.13, 0.04, 0.1, 0.01), C, 0, 0.02, 0); Wd(cyl(0.028, 0.034, 0.6, 8), C, 0, 0.34, 0); Wd(cyl(0.037, 0.037, 0.05, 8, true), T, 0, 0.2, 0); Mt(cyl(0.05, 0.03, 0.05, 8), G, 0, 0.645, 0); Mt(rb(0.14, 0.11, 0.075, 0.02), G, 0, 0.72, 0); });
  pivot(G);
  // a pointed arch over the pump, a brass dome and the crescent
  Wd(tube([[0, 1.36, -0.18], [0, 1.5, -0.215], [0, 1.63, -0.13], [0, 1.74, 0], [0, 1.63, 0.13], [0, 1.5, 0.215], [0, 1.36, 0.18]], 0.03, 16, 6), C);
  for (const z of [-0.2, 0.2]) Wd(cyl(0.034, 0.034, 0.04, 8, true), T, 0, 1.5, z * 1.06);
  Mt(lathe([[0.075, 0], [0.088, 0.04], [0.072, 0.09], [0.03, 0.13], [0.01, 0.16], [0, 0.2]], 12), G, 0, 1.76, 0); crescent(0, 2.0, 0, 1.1, G);
  beam({ col: 0x7a5a36, strap: G, knob: G });
  // a tent over the rear stores
  for (const x of [-0.97, -1.36]) for (const z of [-0.43, 0.43]) post(x, z, 0.72, G, 0.012);
  Cl(pyr(), C, -1.165, D + 0.86, 0, 0, 0, 0, 0.45, 0.28, 0.94); for (const z of [-1, 1]) { Cl(box(0.45, 0.07, 0.012), T, -1.165, D + 0.7, z * 0.47); for (let k = 0; k < 4; k++) Cl(TRI(), G, -1.0 - k * 0.11, D + 0.665, z * 0.47, 0, 0, 0, 0.11, 0.07, 1); }
  for (const x of [-0.94, -1.39]) { Cl(box(0.012, 0.07, 0.94), T, x, D + 0.7, 0); for (let k = 0; k < 8; k++) Cl(TRI(), G, x, D + 0.665, -0.41 + k * 0.117, 0, H, 0, 0.117, 0.07, 1); }
  for (let k = 0; k < 4; k++) Cl(box(0.012, 0.012, 0.6), T, -1.165, D + 0.87, 0, 0, k * H + PI / 4 + (k % 2 ? 0.34 : -0.34), 0, 1, 1, 0.9); Mt(ball(0.03, 8, 6), G, -1.165, D + 1.02, 0); crescent(-1.165, D + 1.1, 0, 0.8, G);
  // a lattice screen, a hanging lamp and the pennant at the head
  for (const z of [-0.42, 0.42]) Wd(rb(0.045, 0.4, 0.045, 0.01), SW, 1.31, D + 0.2, z); Wd(rb(0.04, 0.04, 0.86, 0.01), SW, 1.31, D + 0.38, 0); Wd(rb(0.04, 0.03, 0.86, 0.01), SW, 1.31, D + 0.02, 0);
  for (let k = 0; k < 7; k++) for (const s of [-1, 1]) Wd(box(0.012, 0.46, 0.018), shade(SW, 0.75), 1.31, D + 0.2, -0.36 + k * 0.12, s * 0.75, 0, 0);
  post(1.31, 0.42, 1.0, G, 0.014); Mt(tube([[1.31, D + 1.0, 0.42], [1.28, D + 1.08, 0.42], [1.2, D + 1.08, 0.42], [1.16, D + 1.02, 0.42]], 0.01, 8, 4), G);
  Mt(cyl(0.003, 0.003, 0.1, 3), G, 1.16, D + 0.97, 0.42); Mt(cone(0.04, 0.05, 8), G, 1.16, D + 0.91, 0.42); Gl(lathe([[0.02, 0], [0.06, 0.04], [0.07, 0.1], [0.04, 0.15], [0.05, 0.18]], 10), L.glow, 1.16, D + 0.71, 0.42); Mt(cone(0.03, 0.04, 8), G, 1.16, D + 0.69, 0.42, PI);
  pennant(1.31, -0.42, 1.3, 'point', 0.38, 0.2, G, G); crescent(1.31, D + 1.4, -0.42, 0.8, G); plates();
  const carpet = (x, y, z, c) => { Wd(cyl(0.065, 0.065, 0.62, 10), c, x, y, z, H); Wd(cyl(0.03, 0.03, 0.66, 6), 0xe8dcc0, x, y, z, H); for (const d of [-0.2, 0.2]) Wd(cyl(0.067, 0.067, 0.03, 10, true), G, x, y, z + d, H); };
  if (i === 0) {
    carpet(-1.1, D + 0.065, 0, 0x9a2a2a); carpet(-1.235, D + 0.065, 0, T); carpet(-1.17, D + 0.18, 0, 0x2a3a8a);
    urn(1.08, -0.22, 0.8, 0xb86a42, T); urn(1.08, 0.14, 0.65, 0xc8824a, G);
  } else {
    for (const [z, c] of [[-0.25, 0x9a2a2a], [0.02, T], [0.27, 0x7a3a8a]]) Wd(ball(0.13, 10, 6), c, -1.16, D + 0.05, z, 0, 0, 0, 1.2, 0.45, 0.95); Wd(ball(0.12, 10, 6), G, -1.16, D + 0.13, -0.1, 0, 0.3, 0, 1.2, 0.45, 0.95);
    // a coffee pot on its tray, and dates
    Mt(cyl(0.16, 0.16, 0.012, 14), BRASS, 1.1, D + 0.006, -0.18); Mt(lathe([[0.07, 0], [0.09, 0.03], [0.05, 0.12], [0.04, 0.17], [0.06, 0.2], [0.03, 0.26], [0.005, 0.31]], 10), BRASS, 1.1, D + 0.012, -0.2); Mt(cone(0.03, 0.13, 5), BRASS, 1.17, D + 0.2, -0.2, 0, 0, -1.0); Mt(tor(0.05, 0.008, 4, 8, PI), BRASS, 1.04, D + 0.14, -0.2, 0, 0, H);
    for (let k = 0; k < 3; k++) Wd(cyl(0.022, 0.016, 0.03, 6), 0xf0ece0, 1.0 + k * 0.05, D + 0.03, -0.06 - k * 0.02);
    Wd(cyl(0.13, 0.1, 0.12, 12), 0xa88850, 1.1, D + 0.06, 0.22); for (let k = 0; k < 7; k++) Wd(ball(0.03, 5, 4), 0x5a2a1a, 1.1 + Math.cos(k) * 0.07, D + 0.13 + (k === 6 ? 0.03 : 0), 0.22 + Math.sin(k) * 0.07, 0, 0, 0, 1, 0.8, 1.4);
  }
};

const COFFIN = (d) => prism('coffin', [[-0.12, -0.4], [0.12, -0.4], [0.19, 0.18], [0.1, 0.4], [-0.1, 0.4], [-0.19, 0.18]], d);
F.khemet = (i) => {
  const SS = L.wood, LAP = 0x2a4a9a, G = L.trim, Gw = L.glow, LIN = 0xe8e0c8;
  frame({ sill: SS, sillB: 'w', head: SS, rivet: G, buffer: G, under: 0x8a7a5a }); planks({ col: 0xd8ccaa, n: 7 }); wheels({ kind: 'disc', rim: G, spoke: 0xc8b88a, hub: LAP, cap: Gw, boxCap: Gw });
  for (const z of [-1, 1]) { Wd(rb(2.5, 0.03, 0.014, 0.005), LAP, 0, 0.505, z * 0.452); Mt(rb(2.5, 0.01, 0.016, 0.004), G, 0, 0.482, z * 0.452); for (let k = 0; k < 12; k++) Gl(box(+(0.03 + (k % 3) * 0.015).toFixed(3), 0.03, 0.006), Gw, -1.1 + k * 0.2, 0.44, z * 0.447); }
  posts((s) => { // twin pylons, glyphs alight
    Wd(frus(0.72), SS, 0, 0.36, 0, 0, 0, 0, 0.4, 0.72, 0.1); Mt(box(0.32, 0.035, 0.11), G, 0, 0.735, 0); Mt(cyl(0.055, 0.055, 0.11, 10), G, 0, 0.72, 0, H);
    for (let k = 0; k < 4; k++) Gl(box(+(0.04 + (k % 2) * 0.03).toFixed(2), 0.03, 0.006), Gw, (k % 2 ? 0.02 : -0.02), 0.14 + k * 0.12, s * (0.05 - k * 0.003));
    Wd(box(0.2, 0.14, 0.085), SS, 0, 0.82, 0);
  });
  pivot(G); Wd(rb(0.24, 0.06, 0.5, 0.01), SS, 0, 1.5, 0); Mt(box(0.26, 0.02, 0.52), G, 0, 1.54, 0);
  // the winged sun
  Gl(cyl(0.075, 0.075, 0.035, 14), Gw, 0, 1.65, 0, 0, 0, H); Mt(tor(0.08, 0.013, 4, 14), G, 0, 1.65, 0, 0, H, 0);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const w = 0.26 - k * 0.06; Mt(box(0.014, 0.045, w), [G, LAP, G][k], 0, 1.67 - k * 0.042, s * (0.09 + w / 2)); }
  beam({ col: 0x9a8a5a, strap: G, knob: Gw, extra: () => { for (const x of [-0.58, -0.52, -0.24, 0.2, 0.5, 0.57]) Wd(cyl(0.046, 0.046, 0.035, 8, true), LIN, x, 0, 0, 0.25, 0, H); } });
  const jar = (x, z, k) => { urn(x, z, 0.42, LIN, G); if (k === 0) Wd(ball(0.045, 8, 6), 0x2a2a2e, x, D + 0.23, z); else { Wd(ball(0.04, 8, 6), k === 1 ? G : 0x2a2a2e, x, D + 0.23, z); for (const s of [-1, 1]) Wd(cone(0.014, 0.06, 4), k === 1 ? G : 0x2a2a2e, x, D + 0.28, z + s * 0.02); } };
  if (i === 0) { // an obelisk
    Wd(frus(0.55), SS, 1.2, D + 0.45, -0.27, 0, 0, 0, 0.16, 0.9, 0.16); Mt(pyr(), G, 1.2, D + 0.955, -0.27, 0, 0, 0, 0.088, 0.11, 0.088);
    for (let k = 0; k < 5; k++) for (const s of [-1, 1]) Gl(box(0.008, 0.04, +(0.03 + (k % 2) * 0.03).toFixed(2)), Gw, 1.2 + s * (0.076 - k * 0.006), D + 0.16 + k * 0.14, -0.27);
    jar(1.1, 0.06, 0); jar(1.1, 0.22, 1); jar(1.1, 0.38, 2);
  } else { // a jackal couchant
    Wd(rb(0.4, 0.1, 0.22, 0.012), SS, 1.12, D + 0.05, -0.26); Mt(box(0.41, 0.02, 0.23), G, 1.12, D + 0.08, -0.26);
    Wd(rb(0.3, 0.1, 0.11, 0.04), DARK, 1.1, D + 0.16, -0.26); Wd(rb(0.07, 0.16, 0.08, 0.03), DARK, 1.22, D + 0.25, -0.26, 0, 0, -0.3); Wd(ball(0.05, 8, 6), DARK, 1.25, D + 0.34, -0.26); Wd(cone(0.03, 0.1, 6), DARK, 1.31, D + 0.33, -0.26, 0, 0, -H);
    for (const s of [-1, 1]) { Wd(cone(0.018, 0.1, 4), DARK, 1.23, D + 0.42, -0.26 + s * 0.03); Gl(ball(0.01, 4, 3), Gw, 1.275, D + 0.355, -0.26 + s * 0.035); Wd(rb(0.14, 0.035, 0.035, 0.012), DARK, 1.26, D + 0.12, -0.26 + s * 0.04); }
    Mt(tor(0.04, 0.012, 4, 10), G, 1.225, D + 0.28, -0.26, 0, H, 0.3);
    jar(1.1, 0.1, 1); jar(1.1, 0.3, 2);
  }
  // a king in his case at the rear
  at(-1.14, D, 0, 0, 0, 0, 1, () => {
    Wd(rb(0.36, 0.06, 0.86, 0.012), SS, 0, 0.03, 0); Mt(rb(0.27, 0.17, 0.78, 0.07, 2), G, 0, 0.145, 0); Gl(box(0.275, 0.008, 0.785), Gw, 0, 0.12, 0);
    for (let k = 0; k < 6; k++) Wd(box(0.2, 0.012, 0.035), LAP, 0, 0.226, -0.33 + k * 0.085);
    Wd(rb(0.25, 0.1, 0.2, 0.04), LAP, 0, 0.21, 0.29); Mt(ball(0.06, 10, 8), G, 0, 0.25, 0.3, 0, 0, 0, 1, 0.6, 1.15); for (const s of [-1, 1]) { Gl(ball(0.01, 4, 3), Gw, s * 0.025, 0.285, 0.29); Mt(box(0.2, 0.014, 0.028), G, 0, 0.238, 0.14, 0, s * 0.5, 0); }
    Mt(cone(0.018, 0.07, 5), LAP, 0, 0.24, 0.37, H);
  });
  // a feather fan in the side's colour
  const fanPts = [[-0.24, 0]]; for (let k = 0; k <= 8; k++) fanPts.push([+(-Math.cos(k * PI / 8) * 0.24).toFixed(4), +(Math.sin(k * PI / 8) * 0.24 + 0.02).toFixed(4)]); fanPts.push([0.24, 0]);
  post(1.2, 0.43, 1.05, G, 0.014); Sd(prism('fan', fanPts, 0.012), 1.2, D + 1.05, 0.43); for (let k = 0; k < 5; k++) Mt(box(0.008, 0.24, 0.016), G, 1.2 + Math.sin((k - 2) * 0.6) * 0.12, D + 1.05 + Math.cos((k - 2) * 0.6) * 0.12, 0.43, 0, 0, -(k - 2) * 0.6); Mt(hemi(0.04, 8, 3), G, 1.2, D + 1.04, 0.43);
  plates();
};

// ---- the north ------------------------------------------------------------------------------------
F.velikaya = (i) => {
  const R = L.cloth, W = L.cloth2, G = L.trim, LOG = 0x8a6238, BL = 0x2a5a9a, GN = 0x2a7a52;
  frame({ noSill: 1, head: LOG, sillB: 'w', buffer: G, under: LOG }); planks({ col: 0x9a7448 }); wheels({ n: 10, rim: 0x3a3a40, spoke: R, spokeB: 'w', hub: G });
  for (const z of [-1, 1]) { // log walls, notched at the corners, with a carved and painted board
    for (const [y, r, c] of [[0.475, 0.055, 1], [0.385, 0.047, 0.85]]) { Wd(cyl(r, r, 2.76, 10), shade(LOG, c), 0, y, z * 0.43, 0, 0, H); Wd(cyl(r * 0.6, r * 0.6, 2.765, 8), 0xd8c090, 0, y, z * 0.43, 0, 0, H); }
    Wd(rb(2.2, 0.035, 0.012, 0.004), R, 0, 0.475, z * 0.487); for (let k = 0; k < 8; k++) Wd(box(0.03, 0.03, 0.016), W, -0.98 + k * 0.28, 0.475, z * 0.487, 0, 0, PI / 4);
  }
  for (const x of [-1.2, 1.2]) { Wd(cyl(0.05, 0.05, 1.06, 10), shade(LOG, 0.92), x, 0.43, 0, H); Wd(cyl(0.03, 0.03, 1.065, 8), 0xd8c090, x, 0.43, 0, H); }
  aframe({ col: R, strap: G, pin: G });
  // a tent roof and the onion dome over the pump, lesser domes at the four corners
  for (const z of [-0.18, 0.18]) Wd(box(0.06, 0.12, 0.06), LOG, 0, 1.42, z);
  Wd(rb(0.32, 0.04, 0.52, 0.01), LOG, 0, 1.5, 0); Wd(pyr(), GN, 0, 1.63, 0, 0, 0, 0, 0.3, 0.22, 0.5); Wd(cyl(0.05, 0.055, 0.07, 10), W, 0, 1.76, 0);
  Mt(lathe(ONION, 12), G, 0, 1.79, 0); Mt(cyl(0.006, 0.006, 0.12, 4), G, 0, 2.2, 0); Mt(ball(0.018, 6, 4), G, 0, 2.27, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    Wd(cyl(0.03, 0.036, 0.5, 8), W, sx * 1.31, D + 0.25, sz * 0.43); Wd(cyl(0.042, 0.042, 0.03, 8), R, sx * 1.31, D + 0.5, sz * 0.43);
    Wd(lathe(ONION, 10), sx * sz > 0 ? BL : GN, sx * 1.31, D + 0.515, sz * 0.43, 0, 0, 0, 0.62); Mt(ball(0.016, 6, 4), G, sx * 1.31, D + 0.755, sz * 0.43);
  }
  // the bow of the harness with its bells, over the head of the car
  Wd(tube([[1.31, D + 0.05, -0.4], [1.31, D + 0.52, -0.37], [1.31, D + 0.82, 0], [1.31, D + 0.52, 0.37], [1.31, D + 0.05, 0.4]], 0.028, 16, 6), R);
  for (const [y, z] of [[0.5, -0.375], [0.5, 0.375], [0.76, -0.18], [0.76, 0.18]]) Mt(tor(0.03, 0.01, 4, 8), G, 1.31, D + y, z, H, 0, z * 1.4);
  for (const z of [-0.15, 0, 0.15]) { Mt(lathe(BELL, 8), BRASS, 1.31, D + 0.63 - Math.abs(z) * 0.3, z, 0, 0, 0, 0.55); Mt(cyl(0.004, 0.004, 0.08, 3), BRASS, 1.31, D + 0.77 - Math.abs(z) * 0.3, z); }
  beam({ col: LOG, strap: G, knob: G });
  gonfalon(-1.33, 0, 1.25, 0.3, 0.42, 'swallow', LOG, G, true); plates(0.43, 0, 0.495);
  const firewood = (x, z) => { for (let k = 0; k < 5; k++) { const top = k > 2; Wd(cyl(0.048, 0.048, 0.36, 7), k % 2 ? 0xe8e0d0 : 0x6a4a2e, x, D + 0.048 + (top ? 0.085 : 0), z + (top ? (k - 3.5) * 0.1 : (k - 1) * 0.1), 0, 0, H); Wd(cyl(0.036, 0.036, 0.364, 7), 0xd8c090, x, D + 0.048 + (top ? 0.085 : 0), z + (top ? (k - 3.5) * 0.1 : (k - 1) * 0.1), 0, 0, H); } };
  if (i === 0) {
    // a samovar
    Mt(lathe([[0.07, 0], [0.05, 0.03], [0.04, 0.06], [0.09, 0.1], [0.11, 0.2], [0.09, 0.3], [0.05, 0.33], [0.04, 0.38], [0.06, 0.4]], 12), BRASS, 1.08, D, -0.22);
    for (const s of [-1, 1]) Mt(tor(0.035, 0.008, 4, 8), BRASS, 1.08, D + 0.24, -0.22 + s * 0.13, 0, H, 0); Mt(cyl(0.01, 0.01, 0.07, 5), BRASS, 1.0, D + 0.14, -0.22, 0, 0, H); Wd(ball(0.05, 8, 6), W, 1.08, D + 0.44, -0.22, 0, 0, 0, 1, 0.8, 1); Wd(cyl(0.052, 0.052, 0.015, 8, true), R, 1.08, D + 0.44, -0.22);
    firewood(1.1, 0.2);
    for (const [z, c] of [[-0.2, 0x4a3424], [0.2, 0x5a4230]]) { Wd(ball(0.17, 10, 7), c, -1.1, D + 0.12, z, 0, 0, 0, 1, 0.75, 1.1); Wd(tor(0.165, 0.012, 4, 10), ROPE, -1.1, D + 0.12, z, 0, 0, 0, 1, 0.76, 1); } Wd(ball(0.15, 10, 7), 0x7a6248, -1.1, D + 0.3, 0, 0, 0.4, 0, 1, 0.7, 1.1);
  } else {
    chest(1.1, -0.2, 0.36, 0.2, 0.28, R, G, H); firewood(1.1, 0.22);
    [[1.25, -0.26], [0.95, -0.02], [0.68, 0.17]].forEach(([s, z]) => { Wd(lathe([[0.06, 0], [0.075, 0.05], [0.07, 0.12], [0.045, 0.17], [0.05, 0.22], [0.03, 0.26], [0, 0.27]], 10), R, -1.1, D, z, 0, 0, 0, s); Wd(ball(0.03, 6, 5), 0xf0d8c0, -1.1 + 0.03 * s, D + 0.215 * s, z, 0, 0, 0, s); Wd(cyl(0.074, 0.074, 0.02, 10, true), G, -1.1, D + 0.08 * s, z, 0, 0, 0, s); });
    barrel(-1.12, 0.33, 0.1, 0.24, 0x7a5230, G);
  }
};

// ---- the dead -------------------------------------------------------------------------------------
F.undead = (i) => {
  const B = L.trim, Gw = L.glow, RW = 0x2a2420, DI = 0x2a2a30, STF = 0x3a2e24;
  frame({ sill: RW, sillB: 'w', head: RW, rivet: B, buffer: B }); planks({ col: 0x3a322c, rag: 1, n: 12 }); wheels({ kind: 'bone', n: 8, rim: DI, spoke: B, hub: B, box: 0x24242a, boxCap: Gw });
  for (const z of [-1, 1]) { // a spine along each flank and ribs clasping the sills
    for (let k = 0; k < 16; k++) Wd(ball(0.034, 6, 4), B, -1.2 + k * 0.16, 0.53, z * 0.455, 0, 0, 0, 1, 0.8, 1);
    for (let k = 0; k < 7; k++) Wd(tube([[0, 0.52, z * 0.46], [0, 0.44, z * 0.5], [0, 0.3, z * 0.49], [0, 0.2, z * 0.44]], 0.014, 6, 4), B, -1.08 + k * 0.36, 0, 0);
  }
  for (const z of [-0.18, 0.18]) { // thigh bones for an A-frame
    for (const s of [-1, 1]) { Wd(cyl(0.026, 0.036, 0.74, 8), B, s * 0.125, 0.945, z, 0, 0, s * 0.245); for (const d of [-0.025, 0.025]) Wd(ball(0.036, 6, 5), B, s * 0.215 + d, 0.6, z); }
    Wd(ball(0.062, 8, 6), B, 0, 1.3, z); Wd(cyl(0.014, 0.014, 0.3, 5), B, 0, 0.9, z, 0, 0, H); Wd(tor(0.03, 0.01, 4, 8), ROPE, 0.085, 0.9, z, 0, H, 0); Wd(tor(0.03, 0.01, 4, 8), ROPE, -0.085, 0.9, z, 0, H, 0);
    Wd(cyl(0.012, 0.012, 0.16, 5), B, 0, 1.4, z * 0.8, -z * 1.2, 0, 0);
  }
  pivot(DI);
  skull(0, 1.52, 0, 1.3, 0, B, Gw); for (const s of [-1, 1]) Wd(cone(0.03, 0.22, 5), B, -0.02, 1.66, s * 0.13, s * 0.7, 0, 0);
  beam({ shape: 'bone', col: B, strap: DI, handle: B, knob: B, noCaps: 1, noStraps: 1 });
  // a coffin at the head
  Wd(COFFIN(0.2), 0x3a2a22, 1.13, D + 0.1, 0, -H); Gl(COFFIN(0.012), Gw, 1.13, D + 0.2, 0, -H, 0, 0, 1.01); Wd(COFFIN(0.035), 0x2a1e1a, 1.13, D + 0.225, 0, -H, 0, 0, 1.04);
  skull(1.13, D + 0.29, -0.12, 0.55, 0, B, DARK, true); for (const z of [-0.33, 0.3]) { Wd(cyl(0.012, 0.014, 0.1, 5), 0xe8e0c8, 1.13, D + 0.29, z); Gl(cone(0.014, 0.05, 5), Gw, 1.13, D + 0.365, z); }
  // a skull lantern on a crooked staff, a scythe flying the side's rag
  Wd(tube([[1.33, D, 0.42], [1.31, D + 0.5, 0.44], [1.35, D + 0.95, 0.4], [1.28, D + 1.06, 0.4], [1.2, D + 0.99, 0.4]], 0.018, 12, 5), STF); Mt(cyl(0.004, 0.004, 0.1, 3), DI, 1.2, D + 0.94, 0.4);
  skull(1.2, D + 0.82, 0.4, 0.75, 0, B, Gw); Gl(ball(0.04, 6, 4), Gw, 1.2, D + 0.83, 0.4);
  Wd(cyl(0.016, 0.018, 1.5, 6), STF, 1.33, D + 0.75, -0.42); Mt(tor(0.3, 0.02, 4, 10, PI * 0.45), 0x8a8a94, 1.33, D + 1.2, -0.42, 0, 0, H, 1, 1, 0.3); Sd(flagGeo(0.38, 0.24, 'rag'), 1.31, D + 1.02, -0.42);
  plates();
  const tomb = (x, z) => { Wd(rb(0.08, 0.34, 0.26, 0.03), STONE, x, D + 0.17, z, 0, 0, 0.08); Wd(cyl(0.13, 0.13, 0.08, 12), STONE, x - 0.014, D + 0.33, z, 0, 0, H); for (let k = 0; k < 3; k++) Gl(box(0.008, 0.02, 0.14 - k * 0.03), Gw, x + 0.036 - k * 0.005, D + 0.3 - k * 0.06, z, 0, 0, 0.08); };
  if (i === 0) {
    tomb(-1.3, 0.22);
    [[-1.08, 0.04, -0.3, 0.4], [-1.1, 0.04, -0.08, -0.5], [-1.24, 0.04, -0.2, 2.6], [-1.26, 0.04, -0.38, 3.4], [-1.15, 0.18, -0.2, 0.1], [-1.06, 0.04, 0.34, -0.9]].forEach(([x, y, z, r]) => skull(x, D + y + 0.05, z, 0.8, r, shade(B, 0.9 + rnd(z * 9) * 0.1), DARK, true));
  } else { // a soul caught in a cage of ribs
    Wd(cyl(0.03, 0.03, 0.5, 6), B, -1.13, D + 0.4, 0, H); for (let k = 0; k < 5; k++) Wd(tor(0.18, 0.014, 4, 12, PI * 1.5), B, -1.13, D + 0.21, -0.2 + k * 0.1, 0, 0, -PI * 0.25);
    flame(-1.13, D + 0.02, 0, 1.3, Gw); Gl(ball(0.06, 8, 6), blend(Gw, 0xffffff, 0.4), -1.13, D + 0.1, 0); tomb(-1.3, 0.36);
  }
};

F.crimson = (i) => {
  const C = L.cloth, BK = 0x18161a, G = L.trim, RG = 0xff3040, FL = 0xff7038;
  frame({ sill: BK, head: BK, rivet: G, buffer: G, rivets: false }); planks({ col: 0x2a2024 }); wheels({ n: 14, rim: BK, spoke: 0x2a2428, hub: G, cap: C, box: BK });
  for (const z of [-1, 1]) { // velvet swags between gilt roses
    Mt(rb(2.5, 0.012, 0.016, 0.004), G, 0, 0.513, z * 0.452);
    for (let sw = 0; sw < 5; sw++) { const x0 = +(-1.2 + sw * 0.48).toFixed(2); Cl(tube([[0, 0.5, z * 0.462], [0.24, 0.37, z * 0.472], [0.48, 0.5, z * 0.462]], 0.034, 8, 5), C, x0, 0, 0); }
    for (let k = 0; k < 6; k++) { const x = -1.2 + k * 0.48; if (k !== 2 && k !== 3) Mt(hemi(0.036, 8, 3), G, x, 0.5, z * 0.49, z * H); Cl(cone(0.02, 0.11, 5), G, x, 0.41, z * 0.5); }
  }
  posts(() => { Mt(cyl(0.03, 0.04, 0.7, 8), BK, 0, 0.35, 0); for (const y of [0.08, 0.5]) Mt(cyl(0.046, 0.046, 0.03, 8), G, 0, y, 0); Mt(rb(0.14, 0.11, 0.075, 0.02), G, 0, 0.72, 0); Mt(cyl(0.024, 0.024, 0.16, 6), BK, 0, 0.85, 0); Mt(cone(0.032, 0.2, 6), BK, 0, 1.03, 0); Mt(ball(0.016, 5, 4), G, 0, 1.13, 0); });
  pivot(G);
  // a lancet arch, a blood-red stone, and the bat of the house
  Mt(tube([[0, 1.42, -0.18], [0, 1.58, -0.16], [0, 1.72, -0.08], [0, 1.82, 0], [0, 1.72, 0.08], [0, 1.58, 0.16], [0, 1.42, 0.18]], 0.022, 16, 5), BK); Gl(oct(0.04), RG, 0, 1.6, 0, 0, 0, 0, 0.7, 1.4, 0.7);
  const wing = [[0, 0], [0.08, 0.1], [0.2, 0.14], [0.31, 0.04], [0.24, 0.03], [0.2, -0.04], [0.15, 0.01], [0.1, -0.06], [0.05, -0.01], [0, -0.05]];
  Mt(prism('batR', wing, 0.012), BK, 0, 1.88, 0.02, 0, -H, 0); Mt(prism('batL', wing.map(([x, y]) => [-x, y]).reverse(), 0.012), BK, 0, 1.88, -0.02, 0, -H, 0);
  Mt(ball(0.035, 8, 6), BK, 0, 1.88, 0, 0, 0, 0, 1, 1.4, 1); for (const s of [-1, 1]) { Mt(cone(0.012, 0.045, 4), BK, 0, 1.95, s * 0.018); Gl(ball(0.008, 4, 3), RG, 0.03, 1.9, s * 0.014); Gl(ball(0.008, 4, 3), RG, -0.03, 1.9, s * 0.014); }
  beam({ b: 'm', col: BK, strap: G, hb: 'm', handle: G, knob: G });
  for (const sx of [-1, 1]) { // wrought railings
    for (let k = 0; k < 8; k++) { const z = -0.42 + k * 0.12; Mt(cyl(0.009, 0.009, 0.34, 4), BK, sx * 1.32, D + 0.17, z); Mt(cone(0.016, 0.055, 4), G, sx * 1.32, D + 0.367, z); }
    for (const y of [0.06, 0.28]) Mt(box(0.014, 0.014, 0.88), BK, sx * 1.32, D + y, 0);
  }
  // the master's coffin, draped, with candles burning on the lid
  Mt(COFFIN(0.2), BK, 1.12, D + 0.11, 0, -H); Mt(COFFIN(0.012), G, 1.12, D + 0.2, 0, -H, 0, 0, 1.02); Mt(COFFIN(0.035), 0x221c22, 1.12, D + 0.23, 0, -H, 0, 0, 1.03); Mt(COFFIN(0.012), G, 1.12, D + 0.25, 0, -H, 0, 0, 0.55);
  Cl(rb(0.41, 0.02, 0.26, 0.008), C, 1.12, D + 0.255, 0.04); for (const s of [-1, 1]) { Cl(box(0.012, 0.15, 0.26), C, 1.12 + s * 0.2, D + 0.185, 0.04); Cl(box(0.012, 0.02, 0.26), G, 1.12 + s * 0.201, D + 0.11, 0.04); }
  for (const z of [-0.3, 0.33]) at(1.12, D + 0.25, z, 0, 0, 0, 1, () => {
    Mt(lathe([[0.045, 0], [0.014, 0.03], [0.011, 0.26], [0.025, 0.29]], 8), G); Mt(tor(0.065, 0.008, 4, 8, PI), G, 0, 0.29, 0, 0, H, PI);
    for (const d of [-0.065, 0, 0.065]) { Wd(cyl(0.011, 0.011, 0.08, 5), 0xf0e8d8, 0, 0.335, d); Gl(cone(0.013, 0.045, 5), FL, 0, 0.4, d); }
  });
  gonfalon(-1.37, 0, 1.35, 0.3, 0.5, 'swallow', BK, G, true); plates(0.43, -0.24, 0.5); plates(0.43, 0.24, 0.5);
  if (i === 0) { // casks of the red vintage, and goblets
    for (const z of [-0.2, 0.2]) { barrel(-1.1, z, 0.13, 0.36, 0x2a1418, G, D, H); Wd(cyl(0.01, 0.01, 0.05, 5), 0xc01828, -1.1, D + 0.06, z * 2.0, H); }
    Mt(cyl(0.11, 0.11, 0.01, 12), G, -1.1, D + 0.265, 0); for (const z of [-0.05, 0.05]) Mt(lathe([[0.025, 0], [0.006, 0.01], [0.006, 0.05], [0.025, 0.07], [0.028, 0.1]], 8), G, -1.1, D + 0.27, z);
  } else { // a trunk and a looking-glass that shows nobody
    chest(-1.1, -0.14, 0.46, 0.2, 0.28, 0x2a1a1e, G, H);
    Mt(tor(0.13, 0.018, 5, 16), G, -1.2, D + 0.3, 0.28, 0, H, 0.12, 1, 1.5, 1); Mt(cyl(0.125, 0.125, 0.012, 16), 0x10141c, -1.2, D + 0.3, 0.28, 0, 0, H + 0.12, 1, 1, 1.5); Mt(rb(0.1, 0.03, 0.14, 0.008), G, -1.2, D + 0.015, 0.28);
    Wd(ball(0.03, 6, 5), 0xc01828, -1.1, D + 0.36, -0.1); Wd(cyl(0.004, 0.004, 0.14, 3), 0x2a5a2a, -1.1, D + 0.345, -0.03, H);
  }
};

F.drowned = (i) => {
  const HW = L.wood, SL = L.cloth2, Gw = L.glow, RUST = 0x6a4a32, WEED = 0x2a5a3a, TIM = 0x3a4238;
  frame({ noSill: 1, head: HW, sillB: 'w', buffer: RUST, under: HW }); planks({ col: 0x4a5248, rag: 1, n: 12 }); wheels({ n: 8, rim: RUST, spoke: 0x5a4a38, hub: 0x7a6a4a, box: RUST, boxCap: Gw });
  for (const z of [-1, 1]) { // the strakes of a hull, grown with barnacles and weed
    [[0.5, 0.45], [0.41, 0.465], [0.32, 0.45]].forEach(([y, zw], k) => Wd(tube([[-1.41, y + 0.08, z * 0.1], [-1.15, y, +(z * zw * 0.9).toFixed(3)], [0, y - 0.01, z * (zw + 0.02)], [1.1, y, +(z * zw * 0.85).toFixed(3)], [1.41, y + 0.14, z * 0.06]], 0.048, 20, 6), shade(HW, 1 + k * 0.18)));
    for (let k = 0; k < 14; k++) Wd(cone(0.022, 0.04, 5), SL, -0.95 + rnd(k + (z > 0 ? 40 : 0)) * 1.9, 0.3 + rnd(k * 7 + 3) * 0.2, z * 0.525, z * H);
    for (let k = 0; k < 6; k++) { const h = +(0.16 + (k % 3) * 0.06).toFixed(2); Cl(box(0.035, h, 0.006), k % 2 ? WEED : shade(WEED, 0.7), -0.9 + k * 0.36 + rnd(k) * 0.1, 0.36 - h / 2, z * 0.53, 0, 0, (rnd(k + 5) - 0.5) * 0.3); }
    for (const x of [-0.55, 0.55]) { Mt(tor(0.04, 0.012, 4, 10), RUST, x, 0.42, z * 0.518); Gl(cyl(0.034, 0.034, 0.012, 10), Gw, x, 0.42, z * 0.516, H); }
  }
  Wd(tube([[1.36, 0.3, 0], [1.43, 0.6, 0], [1.4, 0.95, 0], [1.3, 1.16, 0]], 0.04, 10, 6), HW); Wd(rb(0.07, 0.55, 0.07, 0.02), HW, -1.4, 0.58, 0);
  Mt(cyl(0.004, 0.004, 0.12, 3), RUST, 1.26, 1.1, 0); lantern(1.26, 0.76, 0, 1.15, RUST, Gw, 'cone');
  posts((s) => { Wd(rb(0.1, 0.74, 0.07, 0.02), TIM, 0, 0.37, 0, 0, 0, s * 0.04); Mt(rb(0.15, 0.12, 0.08, 0.02), RUST, 0, 0.72, 0); });
  pivot(RUST);
  at(0, 0.98, 0.25, 0, 0, 0.2, 1, () => { // the ship's wheel still hangs on the pump
    Wd(tor(0.17, 0.016, 5, 16), 0x5a4a38); for (let k = 0; k < 4; k++) Wd(cyl(0.01, 0.01, 0.48, 5), 0x5a4a38, 0, 0, 0, 0, 0, k * PI / 4); Mt(cyl(0.04, 0.04, 0.05, 8), 0x8a7a3a, 0, 0, 0, H);
  });
  beam({ col: 0x4a4a3a, strap: RUST, knob: 0x7a6a4a, handle: 0x3a3a30, extra: () => { for (const x of [-0.5, -0.2, 0.28]) Cl(box(0.025, 0.14, 0.004), WEED, x, -0.1, 0.037); } });
  // a broken mast and the rag of a sail
  Wd(cyl(0.032, 0.045, 1.7, 8), 0x3a3a30, -1.2, D + 0.85, 0, 0, 0, 0.04); Wd(cone(0.032, 0.14, 4), 0x4a4a3a, -1.235, D + 1.76, 0, 0, 0, 0.2); Wd(cyl(0.02, 0.022, 0.92, 6), 0x3a3a30, -1.25, D + 1.42, 0, H, 0, 0.06);
  Cl(hangGeo(0.82, 0.78, 'rag'), SL, -1.235, D + 1.41, 0, 0, H, 0); Sd(hangGeo(0.82, 0.17, 'rect'), -1.225, D + 1.22, 0, 0, H, 0);
  for (const z of [-1, 1]) { Wd(tube([[-1.23, D + 1.62, 0], [-1.38, D + 0.02, z * 0.4]], 0.006, 1, 3), ROPE); Wd(tor(0.03, 0.01, 4, 8), ROPE, -1.26, D + 1.42, z * 0.3, 0, 0, 0); }
  plates(0.41, 0, 0.525);
  barrel(-1.08, -0.3, 0.11, 0.28, 0x3a3a30, RUST); barrel(-1.08, 0.3, 0.11, 0.28, 0x34382e, RUST); for (let k = 0; k < 5; k++) Wd(cone(0.02, 0.035, 5), SL, -0.975, D + 0.06 + k * 0.045, 0.3 + (k % 2 ? 0.04 : -0.03), 0, 0, -H);
  if (i === 0) { // an anchor, and a chest of ghost-gold
    at(1.1, D + 0.03, -0.12, 0, 0.25, 0, 1, () => { Mt(cyl(0.02, 0.02, 0.56, 6), RUST, 0, 0, 0, H); Mt(tor(0.16, 0.022, 5, 10, PI), RUST, 0, 0, -0.14, H, 0, 0); for (const s of [-1, 1]) Mt(cone(0.04, 0.09, 4), RUST, s * 0.16, 0, -0.16, -H); Mt(cyl(0.015, 0.015, 0.3, 5), RUST, 0, 0, 0.24, 0, 0, H); Mt(tor(0.04, 0.01, 4, 8), RUST, 0, 0, 0.31, H); });
    chain([1.12, D + 0.03, 0.2], [1.3, D + 0.03, 0.44], 5, RUST, 0, 0.022);
    chest(1.14, 0.28, 0.3, 0.14, 0.2, 0x3a3228, 0x8a7a3a, 0, D, true); Gl(hemi(0.09, 8, 3), Gw, 1.14, D + 0.13, 0.28, 0, 0, 0, 1.3, 0.5, 0.9);
  } else { // a gun run out to the side, and its shot
    Wd(rb(0.3, 0.1, 0.34, 0.015), TIM, 1.12, D + 0.07, 0.06); for (const sx of [-1, 1]) for (const dz of [-0.1, 0.1]) Wd(cyl(0.05, 0.05, 0.03, 8), HW, 1.12 + sx * 0.16, D + 0.05, 0.06 + dz, 0, 0, H);
    Mt(lathe([[0.065, 0], [0.08, 0.02], [0.072, 0.1], [0.055, 0.44], [0.07, 0.46], [0.065, 0.5], [0.04, 0.5], [0.04, 0.4]], 12), 0x4a7a6a, 1.12, D + 0.19, -0.14, H); Mt(ball(0.03, 6, 5), 0x4a7a6a, 1.12, D + 0.19, -0.16);
    balls(1.1, -0.3, 0.05, 0x2a3230);
  }
};

// ---- fire and iron --------------------------------------------------------------------------------
function brazier(x, z, col, fl = L.glow, s = 1) {
  for (let k = 0; k < 3; k++) { const a = k * TAU / 3; Mt(cyl(0.01, 0.01, 0.34 * s, 4), col, x + Math.cos(a) * 0.06 * s, D + 0.16 * s, z + Math.sin(a) * 0.06 * s, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); }
  Mt(lathe([[0.02, 0], [0.09, 0.03], [0.12, 0.09], [0.11, 0.09], [0, 0.04]], 10), col, x, D + 0.3 * s, z, 0, 0, 0, s); flame(x, D + 0.36 * s, z, 0.9 * s, fl);
}
F.infernal = (i) => {
  const M = L.metal, Gw = L.glow, T = L.trim, BS = 0x2a2226, HORN = 0x4a3a34, PALE = 0xb8a888;
  frame({ sill: M, head: M, rivet: T, buffer: T }); planks({ b: 'm', col: 0x2e2a2c, n: 9 }); wheels({ kind: 'spike', n: 6, rim: M, spoke: 0x2a2428, hub: T, box: M, boxCap: Gw });
  for (const z of [-1, 1]) { // fire in the cracks, and spikes
    for (let k = 0; k < 12; k++) Gl(box(0.21, 0.012, 0.006), Gw, -1.1 + k * 0.2, 0.47, z * 0.447, 0, 0, (k % 2 ? 1 : -1) * 0.22);
    for (let k = 0; k < 6; k++) Mt(cone(0.03, 0.11, 4), M, -1.0 + k * 0.4, 0.5, z * 0.47, z * H);
  }
  for (let k = 0; k < 6; k++) Gl(box(0.26, 0.004, 0.014), Gw, -1.1 + k * 0.44, 0.581, (rnd(k) - 0.5) * 0.6, 0, rnd(k + 4) * 3, 0);
  posts((s) => { // the pump hangs in four claws
    for (const sx of [-1, 1]) { Mt(tube([[sx * 0.24, 0, 0], [sx * 0.23, 0.3, 0], [sx * 0.12, 0.58, 0], [0, 0.72, 0]], 0.036, 10, 6), BS); Wd(cone(0.03, 0.26, 6), PALE, sx * 0.075, 0.92, 0, 0, 0, -sx * 0.4); Mt(rb(0.13, 0.03, 0.1, 0.01), M, sx * 0.24, 0.015, 0); }
    Mt(ball(0.066, 8, 6), M, 0, 0.72, 0); Gl(ball(0.03, 6, 4), Gw, 0, 0.72, s * 0.055);
  });
  pivot(T);
  beam({ b: 'm', col: 0x2a2428, strap: T, hb: 'm', handle: M, knob: T, extra: () => { for (const x of [-0.58, -0.47, -0.25, 0.25, 0.47, 0.58]) Mt(cone(0.02, 0.07, 4), M, x, 0.07, 0); } });
  // a horned skull for a ram
  at(1.22, 0.64, 0, 0, 0, 0, 1, () => {
    Wd(ball(0.14, 10, 8), PALE, 0, 0.03, 0, 0, 0, 0, 1.05, 0.9, 1); Wd(rb(0.2, 0.1, 0.15, 0.035), shade(PALE, 0.92), 0.11, -0.05, 0);
    for (const s of [-1, 1]) { Gl(ball(0.034, 6, 5), Gw, 0.1, 0.05, s * 0.07); Mt(tube([[-0.02, 0.08, s * 0.1], [-0.06, 0.26, s * 0.22], [0.02, 0.42, s * 0.3], [0.12, 0.5, s * 0.28]], 0.034, 10, 6), HORN); Wd(cone(0.034, 0.12, 6), PALE, 0.165, 0.525, s * 0.265, 0, 0, -1.1);
      for (const dx of [0.07, 0.17]) Wd(cone(0.014, 0.06, 4), 0xf4ecd8, dx, -0.12, s * 0.045, PI); }
    Wd(cone(0.014, 0.04, 4), DARK, 0.212, -0.02, 0);
  });
  brazier(1.08, -0.35, M); brazier(1.08, 0.35, M);
  // tridents racked at the rear, the side's rag between them
  for (const z of [-0.32, 0, 0.32]) { Mt(cyl(0.012, 0.012, 1.3, 5), M, -1.36, D + 0.65, z); Mt(box(0.014, 0.014, 0.14), M, -1.36, D + 1.3, z); for (const d of [-0.06, 0, 0.06]) Mt(cone(0.012, 0.17, 4), T, -1.36, D + 1.39, z + d); }
  Mt(cyl(0.01, 0.01, 0.68, 5), M, -1.36, D + 1.17, 0, H); Sd(hangGeo(0.3, 0.46, 'rag'), -1.345, D + 1.16, 0, 0, H, 0); Mt(box(0.03, 0.03, 0.8), M, -1.36, D + 0.2, 0);
  plates(0.415);
  if (i === 0) { // a cauldron on the boil
    Mt(lathe([[0.08, 0], [0.17, 0.05], [0.2, 0.16], [0.17, 0.26], [0.19, 0.28]], 12), M, -1.13, D + 0.06, 0); for (let k = 0; k < 3; k++) Mt(cone(0.03, 0.1, 4), M, -1.13 + Math.cos(k * 2.1) * 0.13, D + 0.04, Math.sin(k * 2.1) * 0.13, PI);
    Gl(cyl(0.165, 0.165, 0.012, 12), Gw, -1.13, D + 0.31, 0); for (let k = 0; k < 4; k++) Gl(ball(0.03, 6, 4), blend(Gw, 0xffe080, 0.5), -1.13 + Math.cos(k * 1.7) * 0.08, D + 0.32, Math.sin(k * 1.7) * 0.08); Mt(tor(0.19, 0.014, 4, 14), T, -1.13, D + 0.34, 0, H);
  } else { // a cage of the damned
    Mt(rb(0.34, 0.03, 0.56, 0.01), M, -1.1, D + 0.015, 0); Mt(rb(0.34, 0.03, 0.56, 0.01), M, -1.1, D + 0.4, 0);
    for (let k = 0; k < 8; k++) for (const sx of [-1, 1]) Mt(cyl(0.009, 0.009, 0.38, 4), T, -1.1 + sx * 0.155, D + 0.21, -0.255 + k * 0.073); for (const sz of [-1, 1]) for (let k = 1; k < 4; k++) Mt(cyl(0.009, 0.009, 0.38, 4), T, -1.255 + k * 0.0775, D + 0.21, sz * 0.265);
    [[-0.16, 0.5], [0.02, -0.4], [0.17, 0.2]].forEach(([z, r]) => skull(-1.1, D + 0.12, z, 0.75, r, PALE, Gw, true)); for (const z of [-0.2, 0.2]) Mt(cone(0.03, 0.12, 4), M, -1.1, D + 0.47, z);
  }
};

F.ironbound = (i) => {
  const M = L.metal, DI = 0x34343c, T = L.trim, C = L.cloth, Gw = L.glow, ST = 0x7a7a84;
  frame({ sill: DI, head: DI, rivet: ST, buffer: DI, rivets: false }); planks({ b: 'm', n: 8, col: 0x3a3a42 }); wheels({ kind: 'holes', n: 6, rim: M, spoke: DI, hub: T, box: M });
  for (const z of [-1, 1]) for (let k = 0; k < 5; k++) { // armour skirts over the wheels
    const x = -1.04 + k * 0.52, zz = z * (0.475 + (k % 2) * 0.014);
    Mt(box(0.53, 0.34, 0.025), k % 2 ? DI : shade(DI, 0.82), x, 0.42, zz); for (const s of [-1, 1]) Mt(RIV(), ST, x + s * 0.21, 0.55, zz + z * 0.014, H);
    if (k !== 2) for (const s of [-1, 1]) Mt(box(0.16, 0.028, 0.008), T, x + s * 0.062, 0.4, zz + z * 0.014, 0, 0, s * z * 0.6);
  }
  plates(0.42, 0, 0.492);
  // a plough of plate at the head
  for (const s of [-1, 1]) Mt(rb(0.5, 0.36, 0.03, 0.01), DI, 1.345, 0.36, s * 0.23, 0, -s * 1.98, 0); Mt(box(0.035, 0.42, 0.035), T, 1.44, 0.36, 0, 0, PI / 4, 0);
  aframe({ b: 'm', col: DI, strap: M, bolt: ST, x: 1, pin: T });
  // the legion's ring over the pump
  for (const z of [-0.18, 0.18]) Mt(box(0.05, 0.1, 0.05), M, 0, 1.41, z); Mt(rb(0.08, 0.04, 0.44, 0.01), DI, 0, 1.47, 0);
  Mt(rb(0.03, 0.28, 0.28, 0.01), M, 0, 1.64, 0); for (const s of [-1, 1]) Mt(tor(0.085, 0.022, 5, 14), T, s * 0.016, 1.64, 0, 0, H, 0); for (const z of [-0.1, 0, 0.1]) Mt(cone(0.022, 0.1, 4), M, 0, 1.83, z);
  beam({ shape: 'girder', b: 'm', col: DI, strap: M, hb: 'm', handle: M, knob: T });
  for (const sx of [-1, 1]) { Mt(rb(0.05, 0.16, 0.92, 0.01), DI, sx * 1.3, D + 0.08, 0); for (let k = 0; k < 4; k++) Mt(box(0.055, 0.1, 0.13), DI, sx * 1.3, D + 0.21, -0.39 + k * 0.26); } // battlements
  post(-1.3, 0.43, 0.95, M, 0.02); lantern(-1.3, D + 0.95, 0.43, 1.2, M, Gw, 'cone'); gonfalon(-1.27, -0.43, 1.35, 0.26, 0.42, 'rect', M, T);
  const strong = (x, z, y = D, s = 1) => { Mt(rb(0.3 * s, 0.2 * s, 0.32 * s, 0.012), 0x2a2a30, x, y + 0.1 * s, z); for (const d of [-0.09, 0.09]) Mt(box(0.31 * s, 0.205 * s, 0.035), DI, x, y + 0.1 * s, z + d * s); Mt(rb(0.02, 0.07, 0.06, 0.006), T, x - 0.155 * s, y + 0.12 * s, z); for (const d of [-0.12, 0.12]) Mt(RIV(), ST, x - 0.152 * s, y + 0.16 * s, z + d * s, 0, 0, H); };
  const towerShield = (x, z, lean) => at(x, D, z, 0, 0, lean, 1, () => { Mt(rb(0.03, 0.52, 0.27, 0.01), DI, 0, 0.26, 0); Mt(box(0.012, 0.52, 0.05), T, 0.02, 0.26, 0); Mt(box(0.012, 0.05, 0.27), T, 0.02, 0.3, 0); Mt(hemi(0.04, 8, 3), ST, 0.02, 0.3, 0, 0, 0, -H); });
  const halberd = (x, z) => { Wd(cyl(0.013, 0.013, 1.45, 5), 0x3a2e24, x, D + 0.725, z); Mt(cone(0.016, 0.16, 4), ST, x, D + 1.53, z); Mt(prism('axe', [[0, -0.07], [0.1, -0.1], [0.13, 0], [0.1, 0.1], [0, 0.07]], 0.01), ST, x, D + 1.36, z, 0, PI, 0); };
  if (i === 0) {
    strong(1.08, -0.19); strong(1.08, 0.19); strong(1.08, 0, D + 0.2, 0.8);
    for (let k = 0; k < 3; k++) towerShield(-1.17, (k - 1) * 0.285, -0.2); halberd(-1.33, -0.2); halberd(-1.33, 0.14);
  } else { // bolts for the engines, and chain
    for (let k = 0; k < 7; k++) { const y = D + 0.03 + (k > 3 ? 0.055 : 0), x = 1.0 + (k > 3 ? (k - 4) * 0.06 + 0.03 : k * 0.06); Wd(cyl(0.022, 0.022, 0.6, 6), 0x5a4630, x, y, 0, H); Mt(cone(0.03, 0.1, 4), ST, x, y, 0.35, H); } Mt(box(0.3, 0.012, 0.03), T, 1.1, D + 0.12, -0.1);
    for (let k = 0; k < 4; k++) Mt(tor(0.1 - k * 0.01, 0.022, 5, 12), ST, 1.24, D + 0.02 + k * 0.035, -0.32, H);
    for (let k = 0; k < 2; k++) towerShield(-1.17, (k - 0.5) * 0.3 - 0.12, -0.2); halberd(-1.33, 0.2); strong(-1.1, 0.3, D, 0.7);
  }
};

F.ashur = (i) => {
  const BZ = L.trim, M = L.metal, BL = 0x2a4a8a, MUD = 0xb08a5a, Gw = L.glow, C = L.cloth;
  frame({ sill: BL, sillB: 'w', head: M, rivet: BZ, buffer: BZ, rivets: false }); planks({ col: 0x7a5a3a, n: 11 }); wheels({ n: 6, rim: BZ, spoke: BZ, hub: M, cap: BZ, box: M });
  for (const z of [-1, 1]) { // glazed brick and gilt rosettes
    for (const y of [0.408, 0.512]) Mt(rb(2.5, 0.012, 0.016, 0.004), BZ, 0, y, z * 0.452);
    for (let k = 0; k < 9; k++) { Mt(cyl(0.04, 0.04, 0.012, 8), BZ, -1.0 + k * 0.25, 0.46, z * 0.449, H); Wd(cyl(0.018, 0.018, 0.02, 6), 0xf0e8d0, -1.0 + k * 0.25, 0.46, z * 0.449, H); }
  }
  Wd(rb(0.56, 0.07, 0.58, 0.01), MUD, 0, D + 0.035, 0); Wd(rb(0.44, 0.07, 0.5, 0.01), shade(MUD, 0.88), 0, D + 0.105, 0); // the pump stands on a stepped mound
  posts(() => { Wd(rb(0.16, 0.5, 0.09, 0.012), MUD, 0, 0.39, 0); for (const y of [0.26, 0.56]) Wd(box(0.166, 0.045, 0.096), BL, 0, y, 0); Mt(rb(0.17, 0.13, 0.1, 0.02), BZ, 0, 0.72, 0); Mt(tor(0.085, 0.017, 5, 10, PI), BZ, 0, 0.87, 0, 0, 0, PI); for (const s of [-1, 1]) Mt(cone(0.017, 0.06, 5), BZ, s * 0.085, 0.9, 0); });
  pivot(BZ); beam({ col: 0x5a3a26, strap: BZ, knob: BZ });
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) for (let t = 0; t < 3; t++) Wd(box(0.06, 0.07, +(0.22 - t * 0.075).toFixed(3)), shade(MUD, 1 - t * 0.07), sx * 1.31, D + 0.035 + t * 0.07, -0.345 + k * 0.23); // stepped merlons
  // the fire-temple at the head
  at(1.125, D, 0, 0, 0, 0, 1, () => {
    for (let k = 0; k < 4; k++) Wd(rb(+(0.4 - k * 0.08).toFixed(2), 0.12, +(0.66 - k * 0.13).toFixed(2), 0.01), k % 2 ? shade(MUD, 0.85) : MUD, 0, 0.06 + k * 0.12, 0);
    Wd(box(0.325, 0.03, 0.535), BL, 0, 0.2, 0); Gl(box(0.41, 0.085, 0.1), Gw, 0, 0.045, 0); Gl(box(0.1, 0.085, 0.67), Gw, 0, 0.045, 0); Mt(cyl(0.07, 0.09, 0.04, 8), BZ, 0, 0.5, 0); flame(0, 0.5, 0, 1.15, Gw);
    for (const s of [-1, 1]) Wd(rb(0.1, 0.03, 0.2, 0.008), shade(MUD, 0.8), 0, 0.03, s * 0.37, s * 0.5, 0, 0);
  });
  gonfalon(-1.27, -0.43, 1.3, 0.26, 0.42, 'point', M, BZ); Mt(cyl(0.07, 0.07, 0.014, 12), BZ, -1.27, D + 1.4, -0.43, H); plates();
  if (i === 0) { // a crucible of bronze and the bellows
    Mt(lathe([[0.07, 0], [0.14, 0.04], [0.16, 0.14], [0.13, 0.22], [0.15, 0.24]], 12), M, -1.12, D + 0.07, -0.17); for (let k = 0; k < 3; k++) Mt(cyl(0.014, 0.014, 0.1, 4), M, -1.12 + Math.cos(k * 2.1) * 0.1, D + 0.05, -0.17 + Math.sin(k * 2.1) * 0.1);
    Gl(cyl(0.125, 0.125, 0.012, 12), 0xffa030, -1.12, D + 0.285, -0.17); Mt(cyl(0.008, 0.008, 0.4, 4), M, -1.05, D + 0.36, -0.1, 0.5, 0, 0.5);
    Wd(rb(0.2, 0.03, 0.26, 0.01), 0x6a4a2e, -1.12, D + 0.2, 0.27, -0.25); Wd(rb(0.2, 0.03, 0.26, 0.01), 0x6a4a2e, -1.12, D + 0.07, 0.27, 0.1); Wd(box(0.17, 0.1, 0.2), 0x3a261c, -1.12, D + 0.135, 0.29, -0.08); Mt(cone(0.025, 0.14, 5), BZ, -1.12, D + 0.12, 0.09, -H);
  } else { // ingots, and a great horn
    const ox = [[-0.5, -0.3], [-0.3, -0.2], [0.3, -0.2], [0.5, -0.3], [0.4, 0], [0.5, 0.3], [0.3, 0.2], [-0.3, 0.2], [-0.5, 0.3], [-0.4, 0]];
    for (let k = 0; k < 4; k++) Mt(prism('ox', ox, 0.1), k % 2 ? BZ : shade(BZ, 0.85), -1.12, D + 0.02 + k * 0.042, -0.18, H, 0, k * 0.15, 0.36, 0.42, 0.36);
    Mt(lathe([[0.012, 0], [0.02, 0.2], [0.035, 0.38], [0.09, 0.5], [0.085, 0.5]], 10), BZ, -1.12, D + 0.1, -0.04, H); for (const z of [0.1, 0.3]) Wd(rb(0.04, 0.1, 0.03, 0.008), 0x5a3a26, -1.12, D + 0.05, z);
  }
};

// ---- the small folk -------------------------------------------------------------------------------
F.goblin = (i) => {
  const M = L.metal, W = L.wood, R = 0x8a4a2a, PL = 0x7a5a36, DKW = 0x5a4226;
  frame({ sill: W, sillB: 'w', head: DKW, rivets: false, buffer: R }); planks({ rag: 1, n: 11, col: W, seed: 5 });
  wheels({ kinds: ['spoke', 'disc', 'gear', 'spoke'], radii: [0.23, 0.2, 0.25, 0.21], n: 7, rim: M, spoke: PL, spokeB: 'w', hub: R, box: 0x5a4a3a });
  for (const z of [-1, 1]) for (let k = 0; k < 6; k++) { // patches
    const r = rnd(k + (z > 0 ? 20 : 0)), x = -1.0 + k * 0.4 + r * 0.1, y = 0.45 + r * 0.03, a = (r - 0.5) * 0.4;
    if (k === 3) continue; Mt(box(+(0.2 + Math.round(r * 3) * 0.05).toFixed(2), +(0.1 + (k % 2) * 0.04).toFixed(2), 0.012), [M, R, 0x7a7a6a, L.trim][k % 4], x, y, z * 0.45, 0, 0, a); for (const s of [-1, 1]) Mt(RIV(), 0x2a2a2e, x + s * 0.08, y + 0.03, z * 0.458, H);
  }
  Mt(box(0.03, 0.15, 0.94), R, 1.365, 0.46, 0); for (let k = 0; k < 7; k++) Wd(cone(0.036, 0.14, 4), BONE, 1.39, 0.52 + (k % 2) * 0.02, -0.36 + k * 0.12, 0, 0, -H + 0.5); // a grin of teeth
  for (const z of [-0.18, 0.18]) { // a pump stand of crossed poles, lashed
    for (const s of [-1, 1]) { Wd(cyl(0.026, 0.034, 0.97, 6), s > 0 ? W : shade(W, 0.8), s * 0.085 * (z > 0 ? 1 : 1.15), 1.03, z, 0, 0, s * 0.296 * (z > 0 ? 1 : 1.12)); Mt(RIV(), 0x2a2a2e, s * 0.23, 0.6, z); }
    for (const r of [0, H]) Wd(tor(0.05, 0.016, 4, 8), ROPE, 0, 1.3, z * 1.15, 0, r, 0, 1, 1.1, 1); Wd(box(0.32, 0.04, 0.03), DKW, 0, 0.88, z, 0, 0, z > 0 ? 0.1 : -0.07);
  }
  pivot(R);
  beam({ shape: 'bent', col: PL, strap: R, knob: R, handle: DKW, noCaps: 1, noStraps: 1, extra: () => { Wd(tor(0.045, 0.014, 4, 8), ROPE, 0.3, 0.01, 0, 0, H, 0, 1, 1.1, 1); Wd(tor(0.045, 0.014, 4, 8), ROPE, -0.45, -0.01, 0, 0, H, 0, 1, 1.1, 1); Mt(box(0.14, 0.09, 0.012), R, -0.2, -0.01, 0.04, 0, 0, 0.2); } });
  // a skull on a stick with the side's rag, and a jar-lamp on a bent pole
  Wd(cyl(0.016, 0.02, 1.25, 5), W, 1.32, D + 0.62, -0.42, 0, 0, -0.05); skull(1.36, D + 1.3, -0.42, 0.75, 0, BONE, DARK); Sd(flagGeo(0.38, 0.24, 'rag'), 1.31, D + 1.02, -0.42); Cl(box(0.1, 0.08, 0.004), L.cloth, 1.14, D + 1.04, -0.412, 0, 0, 0.2);
  Wd(tube([[1.31, D, 0.42], [1.35, D + 0.5, 0.44], [1.27, D + 0.85, 0.4], [1.13, D + 0.9, 0.4]], 0.016, 10, 4), W); Mt(cyl(0.003, 0.003, 0.1, 3), M, 1.13, D + 0.85, 0.4); Gl(cyl(0.05, 0.045, 0.1, 8), L.glow, 1.13, D + 0.74, 0.4); Mt(cyl(0.035, 0.05, 0.02, 8), R, 1.13, D + 0.8, 0.4);
  // a pot-bellied stove and its crooked pipe
  Mt(lathe([[0.1, 0], [0.14, 0.06], [0.15, 0.2], [0.1, 0.3], [0.06, 0.32]], 10), 0x3a3430, -1.15, D, 0.24); Gl(box(0.02, 0.08, 0.09), L.glow, -1.01, D + 0.14, 0.24); for (const d of [-0.03, 0, 0.03]) Mt(box(0.024, 0.085, 0.008), 0x2a2420, -1.008, D + 0.14, 0.24 + d);
  Mt(cyl(0.04, 0.04, 0.42, 8), M, -1.17, D + 0.5, 0.24, 0, 0, 0.1); Mt(ball(0.048, 8, 6), R, -1.19, D + 0.71, 0.24); Mt(cyl(0.04, 0.046, 0.3, 8), R, -1.26, D + 0.83, 0.24, 0, 0, 0.5); Mt(cone(0.07, 0.06, 8), M, -1.35, D + 1.0, 0.24, 0, 0, 0.5); Gl(cyl(0.03, 0.03, 0.02, 6), L.glow, -1.325, D + 0.955, 0.24, 0, 0, 0.5);
  for (const [sx, sz, a] of [[-1, -1, 0.2], [1, 1, -0.15]]) Mt(cone(0.03, 0.24, 4), M, sx * 1.32, D + 0.12, sz * 0.43, 0, 0, a);
  plates(0.45);
  if (i === 0) { // junk
    gear(-1.14, D + 0.025, -0.2, 0.14, 8, 0.04, R, H); Mt(hemi(0.09, 10, 4), M, -1.14, D + 0.05, -0.2); Mt(cyl(0.09, 0.07, 0.14, 8, true), 0x7a7a6a, -1.02, D + 0.07, -0.38); Mt(tube([[-1.3, D + 0.03, -0.4], [-1.25, D + 0.03, -0.1], [-1.3, D + 0.2, 0.0], [-1.33, D + 0.4, -0.05]], 0.022, 10, 5), 0x5a6a5a);
    Mt(tor(0.16, 0.025, 5, 12), M, -1.34, D + 0.19, -0.22, 0, H, 0.15); for (const r of [0, H]) Mt(cyl(0.012, 0.012, 0.32, 4), M, -1.34, D + 0.19, -0.22, r + 0.4, 0, 0.15);
    crate(1.1, -0.2, 0.28, 0.26, 0.3, 0.12, PL); sack(1.13, 0.2, 0.85, 0x8a8a5a); Wd(cone(0.05, 0.05, 8), 0xc8482a, 1.1, D + 0.3, -0.2); Wd(cyl(0.018, 0.022, 0.05, 6), 0xe8e0c8, 1.1, D + 0.27, -0.2);
  } else { // supper
    Mt(lathe([[0.07, 0], [0.15, 0.05], [0.17, 0.15], [0.14, 0.22], [0.16, 0.24]], 10), 0x3a3430, -1.14, D + 0.02, -0.2); Wd(cyl(0.135, 0.135, 0.012, 10), 0x6a8a2a, -1.14, D + 0.23, -0.2); Wd(cyl(0.012, 0.012, 0.3, 5), BONE, -1.1, D + 0.3, -0.24, 0.3, 0, 0.5); Wd(ball(0.025, 6, 4), BONE, -1.03, D + 0.42, -0.28); Mt(cyl(0.008, 0.008, 0.34, 4), M, -1.2, D + 0.33, -0.14, -0.4, 0, -0.3);
    crate(1.1, -0.2, 0.26, 0.22, 0.28, -0.1, PL); crate(1.1, -0.18, 0.2, 0.16, 0.22, 0.3, 0x8a6a42, D + 0.23); barrel(1.1, 0.22, 0.14, 0.34, 0x6a5a3a, R); Mt(tor(0.16, 0.025, 5, 12), M, 1.3, D + 0.19, 0.0, 0, H, -0.15);
  }
};

F.skar = (i) => {
  const GR = L.trim, DK = 0x3a342c, M = L.metal, IV = 0xd8d0b8, PINK = 0xd89a9a;
  frame({ sill: 0x4a3a2a, sillB: 'w', head: DK, rivet: BRASS, buffer: BRASS, rivets: false }); planks({ col: 0x6a5234, n: 12, rag: 1, seed: 2 });
  wheels({ kinds: ['gear', 'spoke', 'spoke', 'gear'], n: 6, rim: 0x4a4038, spoke: BRASS, hub: COPPER, box: DK, boxCap: GR });
  for (const z of [-1, 1]) { // pipes down both flanks, with sight-glasses
    Mt(tube([[-1.2, 0.5, z * 0.47], [-0.45, 0.5, z * 0.47], [-0.32, 0.43, z * 0.475], [0.5, 0.43, z * 0.475], [0.63, 0.5, z * 0.47], [1.2, 0.5, z * 0.47]], 0.022, 24, 5), COPPER);
    for (const x of [-1.2, -0.85, 0.95, 1.2]) Mt(cyl(0.033, 0.033, 0.022, 8), BRASS, x, 0.5, z * 0.47, 0, 0, H);
    Gl(cyl(0.027, 0.027, 0.12, 8), GR, 0.1, 0.43, z * 0.476, 0, 0, H); for (const d of [-0.07, 0.07]) Mt(cyl(0.032, 0.032, 0.022, 8), BRASS, 0.1 + d, 0.43, z * 0.476, 0, 0, H);
  }
  posts((s) => { // brass columns, a flywheel and its train
    Mt(cyl(0.045, 0.055, 0.66, 10), BRASS, 0, 0.33, 0); for (const y of [0.02, 0.3, 0.6]) Mt(cyl(0.07, 0.07, 0.03, 10), COPPER, 0, y, 0); Mt(rb(0.15, 0.13, 0.085, 0.02), DK, 0, 0.72, 0);
    if (s > 0) { gear(0, 0.72, 0.09, 0.18, 14, 0.025, BRASS, 0, 0, COPPER); gear(0.03, 0.42, 0.09, 0.085, 8, 0.025, COPPER); }
    else { gear(0, 0.72, -0.09, 0.1, 9, 0.025, COPPER); Mt(cyl(0.07, 0.07, 0.03, 12), BRASS, 0, 0.42, -0.065, H); Wd(cyl(0.058, 0.058, 0.034, 12), 0xf0ead8, 0, 0.42, -0.065, H); Mt(box(0.008, 0.05, 0.038), 0xc02a2a, 0.01, 0.435, -0.065, 0, 0, -0.6); }
  });
  pivot(DK);
  beam({ b: 'm', col: DK, strap: BRASS, handle: 0x5a4226, knob: BRASS, extra: () => { for (let k = 0; k < 8; k++) { const x = (k < 4 ? -0.6 : 0.39) + (k % 4) * 0.07; Mt(tor(0.05, 0.008, 4, 8), COPPER, x, 0, 0, 0, H, 0); } for (const s of [-1, 1]) Gl(ball(0.03, 6, 5), GR, s * 0.66, 0.075, 0); } });
  // a spark-spire at the head
  at(1.13, D, 0, 0, 0, 0, 1, () => {
    Mt(cyl(0.1, 0.12, 0.06, 10), DK, 0, 0.03, 0); Wd(lathe([[0.06, 0], [0.076, 0.03], [0.05, 0.06], [0.076, 0.09], [0.05, 0.12], [0.076, 0.15], [0.05, 0.18], [0.04, 0.52]], 10), IV, 0, 0.06, 0);
    for (let k = 0; k < 5; k++) Mt(tor(0.1 - k * 0.012, 0.012, 4, 14), COPPER, 0, 0.3 + k * 0.07, 0, H); Gl(ball(0.075, 10, 8), GR, 0, 0.68, 0); Mt(cyl(0.006, 0.006, 0.2, 4), BRASS, 0, 0.84, 0); Mt(ball(0.016, 5, 4), BRASS, 0, 0.95, 0);
    for (let k = 0; k < 3; k++) Gl(box(0.008, 0.14, 0.008), blend(GR, 0xffffff, 0.5), Math.cos(k * 2.3) * 0.1, 0.72 + k * 0.03, Math.sin(k * 2.3) * 0.1, Math.sin(k * 2.3) * 0.9, 0, -Math.cos(k * 2.3) * 0.9);
  });
  Mt(tube([[1.32, D, -0.42], [1.3, D + 0.6, -0.44], [1.34, D + 1.2, -0.4]], 0.012, 8, 4), DK); Gl(ball(0.035, 6, 5), GR, 1.34, D + 1.23, -0.4); Sd(flagGeo(0.36, 0.22, 'rag'), 1.31, D + 1.0, -0.42);
  plates(0.415, -0.9); Wd(tube([[-1.3, 0.45, 0.1], [-1.42, 0.3, 0.15], [-1.4, 0.16, 0.3], [-1.3, 0.1, 0.38]], 0.018, 10, 5), PINK);
  // a treadwheel at the rear
  at(-1.155, D + 0.44, 0, 0, 0, 0, 1, () => {
    for (const sx of [-1, 1]) { Mt(tor(0.4, 0.016, 4, 24), M, sx * 0.14, 0, 0, 0, H, 0); for (const r of [0.4, 0.4 + H]) Mt(box(0.012, 0.8, 0.022), M, sx * 0.14, 0, 0, r, 0, 0); Wd(rb(0.03, 0.5, 0.045, 0.01), DK, sx * 0.19, -0.2, 0.1, -0.45, 0, 0); Wd(rb(0.03, 0.5, 0.045, 0.01), DK, sx * 0.19, -0.2, -0.1, 0.45, 0, 0); }
    for (let k = 0; k < 18; k++) { const a = k * TAU / 18; Wd(cyl(0.008, 0.008, 0.28, 4), 0x8a7a5a, 0, Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0, 0, H); } Mt(cyl(0.02, 0.02, 0.4, 6), BRASS, 0, 0, 0, 0, 0, H);
    if (i === 0) at(0, -0.33, 0.04, 0.1, 0, 0, 1, () => { // the runner
      Wd(ball(0.07, 8, 6), 0x6a5a4a, 0, 0, 0, 0, 0, 0, 0.8, 0.85, 1.5); Wd(ball(0.045, 8, 6), 0x6a5a4a, 0, 0.03, 0.12); Wd(cone(0.025, 0.07, 6), 0x7a6a5a, 0, 0.02, 0.18, H); for (const s of [-1, 1]) { Wd(cyl(0.026, 0.026, 0.008, 8), PINK, s * 0.035, 0.075, 0.1, H); Gl(ball(0.008, 4, 3), GR, s * 0.022, 0.045, 0.15); }
      Wd(tube([[0, 0, -0.1], [0, 0.02, -0.2], [0, 0.09, -0.26]], 0.008, 6, 3), PINK);
    });
  });
  if (i === 0) for (const z of [-0.33, 0.33]) { Mt(cyl(0.08, 0.08, 0.26, 10), COPPER, 1.12, D + 0.13, z); Mt(hemi(0.08, 10, 3), COPPER, 1.12, D + 0.26, z); Mt(cyl(0.083, 0.083, 0.02, 10, true), BRASS, 1.12, D + 0.1, z); Mt(tor(0.035, 0.008, 4, 8), 0xc02a2a, 1.12, D + 0.36, z, H); Mt(cyl(0.006, 0.006, 0.04, 4), BRASS, 1.12, D + 0.34, z); }
  else { // cheese for the runner, who is off shift
    for (let k = 0; k < 2; k++) Wd(cyl(0.11, 0.11, 0.07, 12), k ? 0xe8c040 : 0xd8a830, 1.12, D + 0.035 + k * 0.072, 0.31, 0, k * 0.5, 0); Wd(prism('wedge', [[0, 0], [0.11, -0.05], [0.11, 0.05]], 0.07), 0xf0d050, 1.1, D + 0.18, 0.3, H, 0, 0.3);
    Mt(cyl(0.08, 0.08, 0.26, 10), COPPER, 1.12, D + 0.13, -0.33); Mt(hemi(0.08, 10, 3), COPPER, 1.12, D + 0.26, -0.33); Mt(lathe(BELL, 8), BRASS, 1.3, D + 0.5, 0.36, 0, 0, 0, 0.8); post(1.3, 0.43, 0.7, DK, 0.012); Mt(cyl(0.008, 0.008, 0.1, 4), DK, 1.3, D + 0.68, 0.39, H);
  }
};
