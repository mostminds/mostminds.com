// Realm airships: a hanging hull or gondola (deck at y = 0, where the crew stand) under one of eight kinds
// of lift (see skyschema.js), dressed with the design's AIR_PARTS. Model space: +x forward, +z starboard.
import { THREE, mat, PI, TAU, SPH, BOX, CONE, TORUS, OCTA, mesh, ell, blk, add, group, rod, spike, plate, lathe, tintSet, shade, mixc, batWing, bake, noCrew } from './kit.js';

const DS = { side: THREE.DoubleSide };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// hull sizes per lift: [length x len, beam, depth]
const HULL = { dirigible: [0.55, 1.5, 0.75], ribbed: [0.58, 1.6, 0.8], balloon: [0.62, 1.7, 0.95], lantern: [0.6, 1.7, 0.9], patched: [0.5, 1.6, 0.8], none: [0.78, 1.75, 0.95], crystal: [0.66, 1.7, 0.9], wings: [0.72, 1.6, 0.85] };

export function buildSkyShip(def, sideColor) {
  const D = def.sky, look = D.look || {}, L = def.len || 10;
  const kind = HULL[D.envelope] ? D.envelope : 'dirigible';
  const dress = new Set(D.dress || []);
  const T = tintSet();
  const hullC = look.hull ?? def.color ?? 0x6a4a2e, envC = look.envelope ?? def.envelope ?? 0xc8b890, trimC = look.trim ?? 0xc9a04a;
  const sideM = mat(sideColor).clone();
  const C = {
    hull: T.t(hullC), hullDS: T.t(hullC, DS), deck: T.t(mixc(hullC, 0xc8a878, 0.45)), dark: T.t(shade(hullC, 0.55)),
    env: T.t(envC), env2: T.t(mixc(envC, trimC, 0.3)), envDS: T.t(envC, DS), trim: T.t(trimC, { metalness: 0.45, roughness: 0.45 }), trimDS: T.t(trimC, DS),
    iron: T.t(0x3e3e44, { metalness: 0.6, roughness: 0.5 }), brass: mat(0xc9a04a, { metalness: 0.6, roughness: 0.4 }), rope: mat(0xb39a68), wood: T.t(0x6b4a2e),
    canvas: T.t(mixc(envC, 0xe8dcc0, 0.25), DS), bone: mat(0xddd2b6), stone: T.t(0x8a8680, DS), soot: mat(0x1e1a18), side: sideM,
  };
  const g = new THREE.Group();
  const A = { wings: [], tails: [], heads: [], spin: [], glows: [], bobs: [], speed: 2.2, droop: 0 };
  const movers = [], hide2 = [], props = [];
  const [hk, HB, HD] = HULL[kind], HL = L * hk;
  const X = { g, C, A, T, L, HL, HB, HD, kind, dress, movers, hide2, props, blocked: [], def, sideM, glowMats: [] };
  X.b = (x) => halfBeam((x + HL / 2) / HL, HB);
  X.glow = (c, k = 1.3, o = {}) => { const { flick, ...mo } = o; void flick; const m = T.glow(c, k, mo); A.glows.push({ m, k: o.flick ?? 0.15, ph: X.glowMats.length * 1.7, op: o.transparent ? o.opacity : undefined }); X.glowMats.push(m); return m; };

  hull(X);
  const E = LIFT[kind](X);
  X.E = E;
  for (const part of dress) PARTS[part]?.(X);
  if (!dress.has('turrets')) gunports(X);
  if (E.props !== false) engines(X, E);
  rents(X);

  movers.push(...props, ...hide2, ...A.spin.map((s) => s.o), ...A.bobs.map((b) => b.o));
  for (const w of A.wings) movers.push(w.sh, ...(w.el ? [w.el] : []));
  if (E.group) movers.push(E.group);
  bake(g, movers);
  g.traverse((o) => { if (o.isMesh) o.castShadow = !o.material.transparent; });
  const box = new THREE.Box3().setFromObject(g);

  const per = Math.max(1, def.cannons?.perSide || 3);
  const muz = X.muzzles || Array.from({ length: per }, (_, i) => { const x = (per === 1 ? 0 : (i / (per - 1) - 0.5)) * HL * 0.5; return [x, -0.25, X.b(x) + 0.35]; });
  g.userData = {
    skyAnim: true, anim: A, sculpted: false,
    props, muzzles: muz,
    bombBay: [0, -HD - 0.1, 0], hangar: [-HL / 2 + 0.3, 0.05, 0],
    pods: [[HL * 0.2, -HD * 0.6, HB * 0.4], [HL * 0.2, -HD * 0.6, -HB * 0.4], [-HL * 0.2, -HD * 0.6, HB * 0.4], [-HL * 0.2, -HD * 0.6, -HB * 0.4]],
    ladders: [[0, 0, -X.b(0)], [0, 0, X.b(0)]],
    top: box.max.y + 0.1, radius: L / 2,
    crewSlots: deckSlots(X),
    setSide(hex) { sideM.color.set(hex); },
    setDamage(lv) {
      T.damage(lv);
      for (const o of hide2) o.visible = lv >= 2;
      A.droop = lv >= 3 ? 1 : 0;
      if (E.group) { E.group.scale.y = lv >= 3 ? E.sag ?? 0.8 : 1; E.group.rotation.x = lv >= 3 ? 0.06 : 0; E.group.rotation.z = lv >= 3 ? -0.05 : 0; }
    },
  };
  return g;
}

// ---------- the hull ----------
function halfBeam(t, HB) {
  if (t > 0.62) return (HB / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.38) ** 2)) + 0.02;
  if (t < 0.1) return (HB / 2) * (0.84 + 0.16 * (t / 0.1));
  return HB / 2;
}
const depthAt = (t, HD) => HD * (t > 0.68 ? 1 - 0.6 * ((t - 0.68) / 0.32) ** 1.4 : t < 0.12 ? 0.72 + 0.28 * (t / 0.12) : 1);
function hullGeo(HL, HB, HD) {
  const N = 16, M = 10, pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = -HL / 2 + t * HL, b = halfBeam(t, HB), d = depthAt(t, HD);
    for (let j = 0; j <= M; j++) {
      const f = (j / M) * PI, c = Math.cos(f), s = Math.sin(f);
      pos.push(x, -d * Math.pow(s, 0.85), b * Math.sign(c) * Math.pow(Math.abs(c), 0.55));
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * (M + 1) + j, b = a + M + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // the transom
  const c0 = pos.length / 3; pos.push(-HL / 2, -depthAt(0, HD) * 0.4, 0);
  for (let j = 0; j < M; j++) idx.push(c0, j + 1, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function hull(X) {
  const { g, C, HL, HB, HD, kind } = X;
  const H = group(g); X.H = H;
  const hm = add(H, new THREE.Mesh(hullGeo(HL, HB, HD), kind === 'patched' ? C.wood : C.hull));
  hm.userData.noCrew = true;
  // the deck: a flat plank floor at y = 0
  const N = 16, pts = [];
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push(new THREE.Vector2(-HL / 2 + t * HL, halfBeam(t, HB) - 0.03)); }
  for (let i = N; i >= 0; i--) { const t = i / N; pts.push(new THREE.Vector2(-HL / 2 + t * HL, -(halfBeam(t, HB) - 0.03))); }
  add(H, new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateX(-PI / 2), C.deck)).position.y = 0.005;
  // planking lines and a wale in the trim colour
  for (let i = 0; i < 4; i++) blk(H, C.dark, -HL * 0.05, 0.012, (i - 1.5) * HB * 0.22, HL * 0.82, 0.01, 0.025);
  // bulwarks and cap-rail
  const rh = kind === 'patched' ? 0.38 : 0.26;
  for (const sd of [1, -1]) for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N, x0 = -HL / 2 + t0 * HL, x1 = -HL / 2 + t1 * HL;
    const z0 = sd * halfBeam(t0, HB), z1 = sd * halfBeam(t1, HB);
    const w = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
    const p = blk(H, kind === 'patched' ? C.wood : C.hull, (x0 + x1) / 2, rh / 2, (z0 + z1) / 2, w + 0.02, rh, 0.06); p.rotation.y = -ang;
    const r = blk(H, C.trim, (x0 + x1) / 2, rh + 0.02, (z0 + z1) / 2, w + 0.03, 0.05, 0.1); r.rotation.y = -ang;
    if (i % 3 === 1) { const wl = blk(H, C.trim, (x0 + x1) / 2, -HD * 0.3, (z0 + z1) * 1.0 / 2 * 1.0 + sd * 0.0, w + 0.03, 0.07, 0.04); wl.rotation.y = -ang; wl.position.z = sd * halfBeam((t0 + t1) / 2, HB) * 0.98; }
  }
  // transom rail
  blk(H, C.hull, -HL / 2 + 0.02, rh / 2, 0, 0.06, rh, halfBeam(0, HB) * 2);
  if (kind === 'patched') for (let i = 0; i < 14; i++) blk(H, C.dark, -HL / 2 + 0.2 + i * HL / 15, -0.25, 0, 0.03, 0.02, HB * 1.02).userData.noCrew = true; // wicker weave
  // stern ensign on a staff
  rod(H, C.wood, [-HL / 2 + 0.05, 0.2, 0], [-HL / 2 - 0.35, 1.3, 0], 0.03, 0.025, 4);
  const fl = blk(H, C.side, -HL / 2 - 0.65, 1.15, 0, 0.6, 0.38, 0.03); fl.rotation.z = 0.15;
  // a prow ornament
  spike(H, C.trim, [HL / 2 - 0.15, 0.05, 0], [HL / 2 + 0.6, 0.25, 0], 0.07, 5);
  // a cabin aft (kept off the open deck)
  if (!X.dress.has('pagoda')) {
    const cw = HL * 0.16;
    blk(H, C.hull, -HL / 2 + cw / 2 + 0.15, 0.32, 0, cw, 0.64, HB * 0.62);
    blk(H, C.trim, -HL / 2 + cw / 2 + 0.15, 0.67, 0, cw + 0.12, 0.07, HB * 0.7);
    for (const sd of [1, -1]) blk(H, C.soot, -HL / 2 + cw / 2 + 0.15, 0.38, sd * HB * 0.31, cw * 0.5, 0.18, 0.02);
    X.blocked.push([-HL / 2, -HL / 2 + cw + 0.3, -HB, HB]);
  }
}

// ---------- the eight lifts ----------
// horizontal envelope from a cigar profile: returns rAt(x) for placing things on it
function cigar(P, m, Le, R, cy, segs = 14, prof = null) {
  const pts = [], n = 14;
  for (let k = 0; k <= n; k++) {
    const u = k / n, y = -Le / 2 + u * Le;
    const r = prof ? prof(u) * R : R * (u < 0.55 ? Math.pow(Math.sin((u / 0.55) * PI / 2), 0.62) : Math.pow(Math.cos(((u - 0.55) / 0.45) * PI / 2), 0.42));
    pts.push([Math.max(0.001, r), y]);
  }
  pts[0][0] = 0.001; pts[n][0] = 0.001;
  const env = lathe(P, m, pts, segs); env.rotation.z = -PI / 2; env.position.y = cy;
  const rAt = (x) => { const u = clamp((x + Le / 2) / Le, 0, 1) * n, i = Math.min(n - 1, Math.floor(u)), f = u - i; return pts[i][0] * (1 - f) + pts[i + 1][0] * f; };
  return { pts, rAt };
}
function fins(P, C, x, y, r, sz, m = C.envDS, edge = C.trim) {
  for (let i = 0; i < 4; i++) {
    const f = group(P, x, y, 0); f.rotation.x = (i * PI) / 2;
    const o = [[0.3, r * 0.6], [-sz * 1.1, r * 0.6], [-sz * 1.25, r + sz * 0.85], [-sz * 0.35, r + sz * 0.7]];
    plate(f, m, o);
    rod(f, edge, [-sz * 1.25, 0, r + sz * 0.85], [-sz * 0.35, 0, r + sz * 0.7], 0.04, 0.04, 4);
  }
}
function struts(X, cy, rAt, xs) {
  const { H, C, HL } = X;
  for (const x of xs) for (const sd of [1, -1]) {
    const bx = x * HL, hb = X.b(bx) * 0.85;
    rod(H, C.rope, [bx, 0.28, sd * hb], [bx * 1.15, cy - rAt(bx * 1.15) * 0.92, sd * rAt(bx * 1.15) * 0.35], 0.018, 0.018, 3).userData.noCrew = true;
    rod(H, C.rope, [bx, 0.28, sd * hb], [bx * 0.8 + 0.6, cy - rAt(bx * 0.8) * 0.92, sd * rAt(bx * 0.8) * 0.35], 0.014, 0.014, 3).userData.noCrew = true;
  }
}
const LIFT = {
  dirigible(X) {
    const { g, C, L } = X, Le = L * 0.92, R = L * 0.155, cy = 0.95 + R + 0.35;
    const E = group(g);
    const { rAt } = cigar(E, C.env, Le, R, cy, 16);
    for (const u of [-0.32, 0.05, 0.36]) { const r = rAt(u * Le); const t = add(E, mesh(TORUS(0.04, 20), C.trim, u * Le, cy, 0, r * 1.01)); t.rotation.y = PI / 2; }
    // side emblem in the realm's colour
    for (const sd of [1, -1]) add(E, mesh(SPH(), C.side, Le * 0.12, cy + 0.1, sd * (rAt(Le * 0.12) * 0.96 + 0.04), 0.55, 0.55, 0.06));
    fins(E, C, -Le / 2 + 0.9, cy, rAt(-Le / 2 + 0.9) * 0.5, 0.9);
    // a keel-catwalk under the bag
    blk(E, C.hull, 0, cy - R * 0.97, 0, Le * 0.55, 0.12, 0.3);
    struts(X, cy, rAt, [-0.36, -0.1, 0.18, 0.38]);
    return { group: E, cy, R, Le, rAt, top: cy + R, horizontal: true };
  },
  ribbed(X) {
    const { g, C, L } = X, Le = L * 0.94, R = L * 0.16, cy = 1.0 + R + 0.35;
    const E = group(g);
    const { pts, rAt } = cigar(E, C.env, Le, R, cy, 16);
    // steel rings and stringers over the skin
    for (let k = 2; k <= 12; k += 1) { const x = pts[k][1], r = pts[k][0]; const t = add(E, mesh(TORUS(k % 2 ? 0.025 : 0.045, 18), C.iron, x, cy, 0, r * 1.015)); t.rotation.y = PI / 2; }
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * TAU + PI / 8;
      for (let k = 1; k < 14; k++) {
        const [r0, y0] = pts[k], [r1, y1] = pts[k + 1];
        rod(E, C.iron, [y0, cy + Math.cos(ang) * r0 * 1.01, Math.sin(ang) * r0 * 1.01], [y1, cy + Math.cos(ang) * r1 * 1.01, Math.sin(ang) * r1 * 1.01], 0.035, 0.035, 4);
      }
    }
    spike(E, C.trim, [Le / 2 - 0.5, cy, 0], [Le / 2 + 0.35, cy, 0], R * 0.35, 8);
    fins(E, C, -Le / 2 + 1.0, cy, rAt(-Le / 2 + 1.0) * 0.5, 1.0, C.trimDS, C.iron);
    for (const sd of [1, -1]) add(E, mesh(SPH(), C.side, Le * 0.15, cy + 0.15, sd * (rAt(Le * 0.15) * 0.97 + 0.07), 0.55, 0.55, 0.05));
    blk(E, C.iron, 0, cy - R * 0.98, 0, Le * 0.6, 0.14, 0.34);
    // girder struts down to the gondola
    for (const u of [-0.3, 0.3]) for (const sd of [1, -1]) rod(X.H, C.iron, [u * X.HL, 0.25, sd * X.b(u * X.HL) * 0.8], [u * X.HL * 1.1, cy - rAt(u * X.HL) * 0.95, sd * 0.15], 0.05, 0.05, 4).userData.noCrew = true;
    struts(X, cy, rAt, [-0.15, 0.12]);
    return { group: E, cy, R, Le, rAt, top: cy + R, horizontal: true, sag: 0.85 };
  },
  balloon(X) {
    const { g, C, L } = X, k = L / 10, cy = 3.6 * k;
    const E = group(g);
    const prof = [[0.45, -2.0], [1.3, -1.6], [2.0, -0.95], [2.3, -0.1], [2.25, 0.7], [1.9, 1.4], [1.25, 1.95], [0.5, 2.25], [0.001, 2.3]].map(([r, y]) => [r * k, y * k]);
    const gores = 12;
    for (let i = 0; i < gores; i++) { const s = lathe(E, i % 2 ? C.env : C.env2, prof, 2, null, (i / gores) * TAU, TAU / gores); s.position.y = cy; }
    // a blazon band at the widest girth, a crown ring, the mouth hoop
    const band = add(E, mesh(TORUS(0.06, 24), C.trim, 0, cy - 0.1 * k, 0, 2.31 * k)); band.rotation.x = PI / 2;
    const hoop = add(E, mesh(TORUS(0.06, 14), C.iron, 0, cy - 2.0 * k, 0, 0.45 * k)); hoop.rotation.x = PI / 2;
    for (const sd of [1, -1]) add(E, mesh(SPH(), C.side, 0, cy + 0.35 * k, sd * 2.26 * k, 0.5, 0.5, 0.06));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; rod(E, C.trim, [Math.cos(a) * 2.3 * k, cy - 0.1 * k, Math.sin(a) * 2.3 * k], [Math.cos(a) * 1.25 * k, cy + 1.95 * k, Math.sin(a) * 1.25 * k], 0.02, 0.02, 3); }
    E.scale.x = 1.3;
    // a net of ropes from the girth to the rails
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU, ex = Math.cos(a) * 2.2 * k * 1.3, ez = Math.sin(a) * 2.2 * k;
      const dx = clamp(ex * 0.9, -X.HL * 0.42, X.HL * 0.42), dz = Math.sign(ez || 1) * X.b(dx) * 0.95;
      rod(X.H, C.rope, [dx, 0.28, dz], [ex, cy - 0.6 * k, ez], 0.016, 0.016, 3).userData.noCrew = true;
    }
    return { group: E, cy, R: 2.3 * k, top: cy + 2.3 * k, horizontal: false, sag: 0.75 };
  },
  lantern(X) {
    const { g, C, L } = X, k = L / 10, cy = 3.3 * k;
    const E = group(g);
    const m = X.glow(X.C.env.color.getHex(), 0.55, { flick: 0.12, roughness: 0.9 }); m.emissive.lerp(new THREE.Color(0xffa040), 0.15);
    const prof = [[0.9, -1.7], [1.6, -1.4], [1.95, -0.75], [2.05, 0], [1.95, 0.75], [1.6, 1.4], [0.9, 1.7]].map(([r, y]) => [r * k, y * k]);
    lathe(E, m, prof, 16).position.y = cy;
    for (const y of [-1.4, -0.75, 0, 0.75, 1.4]) { const r = prof.find((p) => Math.abs(p[1] - y * k) < 1e-6)[0]; const t = add(E, mesh(TORUS(0.03, 18), C.dark, 0, cy + y * k, 0, r * 1.01)); t.rotation.x = PI / 2; }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; for (let j = 0; j < prof.length - 1; j++) { const [r0, y0] = prof[j], [r1, y1] = prof[j + 1]; rod(E, C.dark, [Math.cos(a) * r0 * 1.01, cy + y0, Math.sin(a) * r0 * 1.01], [Math.cos(a) * r1 * 1.01, cy + y1, Math.sin(a) * r1 * 1.01], 0.025, 0.025, 3); } }
    // caps, a little roof, tassels
    add(E, mesh(new THREE.CylinderGeometry(1, 1.05, 1, 12), C.hull, 0, cy + 1.78 * k, 0, 0.95 * k, 0.18, 0.95 * k));
    add(E, mesh(new THREE.CylinderGeometry(1.05, 1, 1, 12), C.hull, 0, cy - 1.78 * k, 0, 0.95 * k, 0.18, 0.95 * k));
    add(E, mesh(CONE(8), C.trim, 0, cy + 2.15 * k, 0, 1.2 * k, 0.6, 1.2 * k));
    spike(E, C.trim, [0, cy + 2.4 * k, 0], [0, cy + 2.9 * k, 0], 0.08, 5);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; rod(E, C.trim, [Math.cos(a) * 0.9 * k, cy - 1.85 * k, Math.sin(a) * 0.9 * k], [Math.cos(a) * 0.9 * k, cy - 2.35 * k, Math.sin(a) * 0.9 * k], 0.05, 0.02, 4); }
    E.scale.x = 1.4;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, ex = Math.cos(a) * 1.0 * k * 1.4, ez = Math.sin(a) * 1.0 * k;
      const dx = clamp(ex * 1.8, -X.HL * 0.42, X.HL * 0.42), dz = Math.sign(ez || 1) * X.b(dx) * 0.95;
      rod(X.H, C.rope, [dx, 0.28, dz], [ex, cy - 1.8 * k, ez], 0.016, 0.016, 3).userData.noCrew = true;
    }
    return { group: E, cy, R: 2.0 * k, top: cy + 2.9 * k, horizontal: false, sag: 0.8 };
  },
  patched(X) {
    const { g, C, L } = X, Le = L * 0.78, R = L * 0.2, cy = 0.95 + R + 0.4;
    const E = group(g);
    const { rAt } = cigar(E, C.env, Le, R, cy, 14, (u) => Math.pow(Math.sin(u * PI), 0.55) * (1 + 0.06 * Math.sin(u * 23)));
    // patches of every cloth, crudely stitched
    const pal = [C.env2, C.trim, T2(X, 0x8a6a4a), T2(X, 0xa8987a), T2(X, 0x6a4a5a), T2(X, shade(X.C.env.color.getHex(), 0.7)), T2(X, 0xc8b070)];
    for (let i = 0; i < 26; i++) {
      const u = 0.12 + 0.76 * hash(i + 3), x = -Le / 2 + u * Le, a = hash(i * 7 + 1) * TAU, r = rAt(x);
      const p = group(E, x, cy, 0); p.rotation.x = a;
      blk(p, pal[i % pal.length], 0, r * 0.985, 0, 0.6 + hash(i) * 0.7, 0.06, 0.45 + hash(i + 9) * 0.5);
    }
    for (const u of [-0.25, 0.1, 0.32]) { const t = add(E, mesh(TORUS(0.035, 16), C.rope, u * Le, cy, 0, rAt(u * Le) * 1.01)); t.rotation.y = PI / 2; }
    for (let a = 0; a < 6; a++) { const ang = (a / 6) * TAU; rod(E, C.rope, [-Le * 0.4, cy + Math.cos(ang) * rAt(-Le * 0.4), Math.sin(ang) * rAt(-Le * 0.4)], [Le * 0.4, cy + Math.cos(ang) * rAt(Le * 0.4), Math.sin(ang) * rAt(Le * 0.4)], 0.02, 0.02, 3); }
    // a rag tail-fin
    const f = group(E, -Le / 2 + 0.3, cy, 0); plate(f, C.canvas, [[0.4, 0], [-0.9, 0], [-1.2, 1.1], [-0.2, 0.8]]).rotation.x = -PI / 2;
    struts(X, cy, rAt, [-0.32, -0.05, 0.2, 0.38]);
    return { group: E, cy, R, Le, rAt, top: cy + R, horizontal: true, sag: 0.7 };
  },
  none(X) {
    // no gasbag: sails of air on light masts, and spinning rune-rings about the hull
    const { H, C, HL, HB } = X;
    const sail = X.glow(X.C.env.color.getHex(), 0.55, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, flick: 0.08 });
    for (const [u, h] of [[0.18, 2.9], [-0.12, 3.3], [-0.38, 2.4]]) {
      const x = u * HL;
      rod(H, C.trim, [x, 0, 0], [x, h + 0.25, 0], 0.045, 0.03, 5);
      spike(H, C.trim, [x, h + 0.25, 0], [x, h + 0.5, 0], 0.06, 4);
      const s = group(H, x, 0.6, 0);
      const o = [[0.12, 0], [0.12, h - 0.45], [-h * 0.42, 0.15]];
      plate(s, sail, o).rotation.x = -PI / 2;
      plate(s, sail, [[0.12, h - 0.45], [0.95, h * 0.35], [0.12, 0.1]]).rotation.x = -PI / 2; // a jib forward
      blk(H, C.trim, x - h * 0.2, 0.62, 0, h * 0.42, 0.04, 0.04);
      X.blocked.push([x - 0.25, x + 0.25, -0.25, 0.25]);
    }
    // crescent: upswept prow and stern
    rod(H, C.hull, [HL / 2 - 0.2, 0.1, 0], [HL / 2 + 0.35, 1.0, 0], 0.16, 0.06, 6);
    rod(H, C.hull, [-HL / 2 + 0.2, 0.1, 0], [-HL / 2 - 0.25, 1.25, 0], 0.18, 0.06, 6);
    spike(H, C.trim, [HL / 2 + 0.35, 1.0, 0], [HL / 2 + 0.55, 1.35, 0], 0.07, 4);
    // the rune-rings
    const ringM = X.glow(X.C.trim.color.getHex(), 1.1, { flick: 0.2 });
    const n = X.dress.has('runeRings') ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const x = (n === 3 ? (i - 1) * 0.32 : (i - 0.5) * 0.5) * HL;
      const r = group(X.g, x, 0.1, 0); r.rotation.y = PI / 2;
      add(r, mesh(TORUS(0.045, 28), ringM, 0, 0, 0, HB * 0.95 + 0.4));
      for (let j = 0; j < 6; j++) { const a = (j / 6) * TAU; const gl = add(r, mesh(BOX(), ringM, Math.cos(a) * (HB * 0.95 + 0.4), Math.sin(a) * (HB * 0.95 + 0.4), 0, 0.16, 0.16, 0.06)); gl.rotation.z = a; }
      noCrew(r);
      X.A.spin.push({ o: r, axis: 'x', speed: (i % 2 ? -0.9 : 0.7) });
    }
    return { cy: 2, top: 3.9, horizontal: false, props: false, sailMat: sail };
  },
  crystal(X) {
    const { g, C, H, HL } = X, cy = 3.2;
    const E = group(g);
    const spin = group(E, 0, cy, 0);
    const cm = X.glow(X.C.env.color.getHex(), 0.7, { transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1, flick: 0.1 });
    const core = X.glow(mixc(X.C.env.color.getHex(), 0xffffff, 0.5), 1.6, { flick: 0.3 });
    add(spin, mesh(OCTA(), cm, 0, 0.3, 0, 1.25, 2.7, 1.25));
    add(spin, mesh(OCTA(), core, 0, 0.3, 0, 0.45, 1.3, 0.45));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; const s = add(spin, mesh(OCTA(), cm, Math.cos(a) * 1.05, -0.5 + hash(i) * 0.6, Math.sin(a) * 1.05, 0.38, 1.1 + hash(i + 2) * 0.5, 0.38)); s.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); }
    X.A.spin.push({ o: spin, axis: 'y', speed: 0.45 });
    X.A.bobs.push({ o: E, amp: 0.15, speed: 1.1, phase: 0 });
    // the crystal's cradle: a brass collar on four chains
    const coll = add(E, mesh(TORUS(0.06, 20), C.trim, 0, cy - 1.0, 0, 1.0)); coll.rotation.x = PI / 2;
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + PI / 4; const dx = Math.cos(a) * HL * 0.25; rod(H, C.iron, [dx, 0.28, Math.sign(Math.sin(a)) * X.b(dx) * 0.9], [Math.cos(a) * 0.95, cy - 1.0, Math.sin(a) * 0.95], 0.025, 0.025, 3).userData.noCrew = true; }
    // a keel crystal below
    add(H, mesh(OCTA(), cm, 0, -X.HD - 0.6, 0, 0.45, 1.0, 0.45)).userData.noCrew = true;
    X.blocked.push([-0.6, 0.6, -0.6, 0.6]);
    return { cy, top: cy + 3.1, horizontal: false, props: false, group: null };
  },
  wings(X) {
    // an ornithopter: two great canvas wings on spars from a mid-ships frame, rotors above
    const { H, C, HL, A } = X;
    const wy = 1.35, wx = 0.05 * HL;
    for (const sd of [1, -1]) {
      rod(H, C.wood, [wx, 0, sd * X.b(wx) * 0.8], [wx, wy, sd * 0.45], 0.07, 0.06, 5);
      rod(H, C.wood, [wx + 0.9, 0, sd * X.b(wx + 0.9) * 0.8], [wx, wy, sd * 0.45], 0.05, 0.05, 5);
    }
    blk(H, C.trim, wx, wy, 0, 0.5, 0.18, 1.0);
    for (const sd of [1, -1]) {
      const mir = group(H, wx, wy, sd * 0.5); mir.scale.z = sd;
      const sh = group(mir);
      const c0 = 2.1, s1 = 2.1, s2 = 3.0;
      const { inner, outer, tips } = batWing(c0, s1, s2, 4, { back: 0.85, sweep: 0.2 });
      plate(sh, C.canvas, inner);
      const el = group(sh, 0, 0, s1); el.rotation.y = -0.12;
      plate(el, C.canvas, outer);
      rod(sh, C.wood, [0.15, 0, 0], [0.05, 0, s1], 0.08, 0.06, 5);
      for (const f of [0.35, 0.7]) rod(sh, C.wood, [0.1, 0.02, s1 * f], [-c0 * 0.6, 0.02, s1 * f * 0.9], 0.03, 0.02, 3);
      rod(el, C.wood, [0, 0, 0], [0.06, 0, s2 * 0.55], 0.06, 0.05, 4);
      for (const tp of tips) rod(el, C.wood, [0, 0.02, 0], [tp[0], 0.02, tp[1]], 0.035, 0.02, 3);
      plate(el, C.side, [[-0.2, s2 * 0.35], [-0.9, s2 * 0.35], [-0.9, s2 * 0.65], [-0.2, s2 * 0.65]], 0.03);
      A.wings.push({ sh, el, amp: 0.32, base: 0.05, phase: 0, outerK: 0.6, speedK: 1 });
      noCrew(sh);
    }
    A.speed = 2.4;
    X.blocked.push([wx - 0.4, wx + 1.0, -0.6, 0.6]);
    // two rotor masts (the 'rotors' part adds more)
    rotor(X, [HL * 0.33, 0, 0], 2.3, 1.5);
    rotor(X, [-HL * 0.33, 0, 0], 2.3, 1.5, -1);
    // a fan tail
    const tl = group(H, -HL / 2 - 0.1, 0.6, 0);
    plate(tl, C.canvas, [[0, -0.15], [-1.3, -0.9], [-1.5, 0], [-1.3, 0.9], [0, 0.15]]);
    return { cy: 1.5, top: 3, horizontal: false };
  },
};
function T2(X, c) { return X.T.t(c); }

// ---------- parts ----------
function rotor(X, at, h, R, dir = 1) {
  const { H, C } = X, [x, y, z] = at;
  rod(H, C.iron, [x, y, z], [x, y + h, z], 0.06, 0.05, 5);
  ell(H, C.trim, x, y + h, z, 0.14, 0.1, 0.14);
  const r = group(H, x, y + h + 0.05, z);
  for (let i = 0; i < 3; i++) { const b = blk(r, C.wood, 0, 0, 0, R * 2, 0.03, 0.16); b.rotation.y = (i / 3) * PI; b.rotation.x = 0.08; }
  noCrew(r);
  X.A.spin.push({ o: r, axis: 'y', speed: 9 * dir });
  X.blocked.push([x - 0.2, x + 0.2, z - 0.2, z + 0.2]);
}
function propeller(X, P, x, y, z, R = 0.65) {
  const p = group(P, x, y, z);
  for (let i = 0; i < 4; i++) { const b = blk(p, X.C.wood, 0, R / 2, 0, 0.05, R, 0.14); const q = group(p); q.rotation.x = (i / 4) * TAU; q.add(b); }
  ell(p, X.C.trim, 0.05, 0, 0, 0.1);
  noCrew(p);
  X.props.push(p);
  return p;
}
function engines(X, E) {
  const { H, C, HL, HB } = X;
  if (E.horizontal) {
    // two engine nacelles on outriggers aft
    for (const sd of [1, -1]) {
      const x = -HL * 0.25, z = sd * (HB / 2 + 0.75);
      rod(H, C.iron, [x, 0.1, sd * HB * 0.45], [x, 0.3, z], 0.05, 0.05, 4);
      add(H, mesh(new THREE.CapsuleGeometry(0.2, 0.6, 2, 8), C.trim, x, 0.3, z)).rotation.z = PI / 2;
      propeller(X, H, x - 0.55, 0.3, z, 0.55);
    }
  } else {
    // one pusher screw at the stern
    rod(H, C.iron, [-HL / 2 + 0.1, -0.2, 0], [-HL / 2 - 0.35, -0.3, 0], 0.07, 0.07, 5).userData.noCrew = true;
    propeller(X, H, -HL / 2 - 0.4, -0.3, 0, 0.6);
  }
}
function gunports(X) {
  const { H, C, HL } = X, per = Math.max(1, X.def.cannons?.perSide || 3);
  X.muzzles = [];
  for (let i = 0; i < per; i++) {
    const x = (per === 1 ? 0 : (i / (per - 1) - 0.5)) * HL * 0.5, z = X.b(x);
    for (const sd of [1, -1]) {
      blk(H, C.soot, x, -0.2, sd * z * 0.99, 0.26, 0.22, 0.04).userData.noCrew = true;
      rod(H, C.iron, [x, -0.2, sd * z * 0.95], [x, -0.2, sd * (z + 0.3)], 0.06, 0.06, 6).userData.noCrew = true;
    }
    X.muzzles.push([x, -0.2, z + 0.32]);
  }
}
const deckY = 0;
function pagodaTower(P, C, x, w, d, tiers, side = null) {
  let y = deckY;
  for (let i = 0; i < tiers; i++) {
    const k = 1 - i * 0.22, hh = 0.55 * k;
    blk(P, i % 2 ? C.hull : C.dark, x, y + hh / 2, 0, w * k, hh, d * k);
    y += hh;
    const roof = add(P, mesh(CONE(4), C.trim, x, y + 0.18, 0, w * k * 0.85, 0.36, d * k * 0.85)); roof.rotation.y = PI / 4;
    for (const sx of [1, -1]) for (const sz of [1, -1]) spike(P, C.trim, [x + sx * w * k * 0.45, y + 0.02, sz * d * k * 0.45], [x + sx * w * k * 0.68, y + 0.2, sz * d * k * 0.68], 0.05, 4);
    y += 0.22;
  }
  spike(P, C.trim, [x, y, 0], [x, y + 0.6, 0], 0.07, 5);
  if (side) blk(P, side, x - 0.25, y + 0.45, 0, 0.45, 0.22, 0.03);
  return y;
}
const PARTS = {
  turrets(X) {
    const { H, C, HL } = X, per = Math.max(1, X.def.cannons?.perSide || 3), n = Math.min(per, 3);
    X.muzzles = [];
    for (let i = 0; i < n; i++) {
      const x = (n === 1 ? 0 : (i / (n - 1) - 0.5)) * HL * 0.45 + HL * 0.05, z = X.b(x) - 0.28;
      for (const sd of [1, -1]) {
        add(H, mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.24, 10), C.trim, x, 0.12, sd * z));
        add(H, mesh(new THREE.SphereGeometry(0.3, 10, 5, 0, TAU, 0, PI / 2), C.trim, x, 0.24, sd * z));
        rod(H, C.iron, [x, 0.33, sd * z], [x + 0.1, 0.38, sd * (z + 0.75)], 0.06, 0.05, 6);
        X.blocked.push([x - 0.35, x + 0.35, sd * z - 0.35, sd * z + 0.35]);
      }
      X.muzzles.push([x + 0.1, 0.38, z + 0.78]);
    }
    if (per > n) for (let i = n; i < per; i++) X.muzzles.push(X.muzzles[i % n]);
  },
  stacks(X) {
    const { H, C, HL } = X;
    for (const [dx, dz] of [[-0.08, 0.22], [-0.08, -0.22]]) {
      const x = dx * HL;
      add(H, mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.4, 8), C.iron, x, 0.7, dz));
      add(H, mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.12, 8), C.trim, x, 1.35, dz));
      add(H, mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 8), C.trim, x, 0.5, dz));
      X.blocked.push([x - 0.3, x + 0.3, dz - 0.3, dz + 0.3]);
    }
    const sm = group(H, -0.08 * HL, 1.55, 0); X.hide2.push(sm); sm.visible = false;
    void sm;
  },
  rocketRack(X) {
    const { H, C, HL } = X, x = HL * 0.3;
    const r = group(H, x, 0.25, 0); r.rotation.z = 0.5;
    blk(r, C.wood, 0, 0, 0, 0.9, 0.08, 0.9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      add(r, mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6), C.trim, 0, 0.12 + 0.0, (j - 1) * 0.26)).rotation.z = -PI / 2;
      const rk = add(r, mesh(CONE(5), mat(0xb02a1a), 0.45 + (i * 0.02), 0.12 + i * 0.0, (j - 1) * 0.26, 0.07, 0.18, 0.07)); rk.rotation.z = -PI / 2;
    }
    for (const sd of [1, -1]) rod(H, C.wood, [x, 0, sd * 0.4], [x + 0.2, 0.4, sd * 0.4], 0.04, 0.04, 4);
    X.blocked.push([x - 0.6, x + 0.6, -0.6, 0.6]);
  },
  bombard(X) {
    const { H, C, HL } = X, x = HL * 0.36;
    add(H, mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.2, 10), C.wood, x, 0.1, 0));
    const b = add(H, mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.9, 10), C.iron, x + 0.1, 0.5, 0)); b.rotation.z = -0.5;
    const mz = add(H, mesh(TORUS(0.07, 12), C.trim, x + 0.32, 0.9, 0, 0.26)); mz.rotation.x = PI / 2; mz.rotation.y = 0.5;
    X.blocked.push([x - 0.5, x + 0.6, -0.5, 0.5]);
  },
  lamp(X) {
    const { H, C, HL } = X, x = HL / 2 - 0.55;
    rod(H, C.iron, [x, 0, 0], [x, 0.6, 0], 0.05, 0.05, 5);
    const lp = group(H, x, 0.75, 0); lp.rotation.z = -0.35;
    add(lp, mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.4, 10), C.brass, 0, 0, 0)).rotation.z = -PI / 2;
    const lens = add(lp, mesh(new THREE.CircleGeometry(0.21, 10), X.glow(0xfff2c0, 2.2, { flick: 0.05 }), 0.205, 0, 0)); lens.rotation.y = PI / 2;
    X.blocked.push([x - 0.25, x + 0.25, -0.25, 0.25]);
  },
  runeRings(X) {
    if (X.kind === 'none') return; // the lift already turns three
    const E = X.E, m = X.glow(X.C.trim.color.getHex(), 1.1, { flick: 0.2 });
    if (E.horizontal) {
      for (const [u, s] of [[-0.18, 0.7], [0.22, -0.9]]) {
        const x = u * E.Le, r = group(X.g, x, E.cy, 0); r.rotation.y = PI / 2;
        add(r, mesh(TORUS(0.04, 28), m, 0, 0, 0, E.rAt(x) + 0.45));
        for (let j = 0; j < 6; j++) { const a = (j / 6) * TAU; add(r, mesh(BOX(), m, Math.cos(a) * (E.rAt(x) + 0.45), Math.sin(a) * (E.rAt(x) + 0.45), 0, 0.18, 0.18, 0.06)).rotation.z = a; }
        X.A.spin.push({ o: r, axis: 'x', speed: s });
      }
    } else {
      const r = group(X.g, 0, (E.cy || 2) + (E.R ? -E.R * 0.4 : 0), 0); r.rotation.x = PI / 2;
      add(r, mesh(TORUS(0.04, 32), m, 0, 0, 0, Math.max(2.2, (E.R || 2) + 0.3)));
      for (let j = 0; j < 8; j++) { const a = (j / 8) * TAU; add(r, mesh(BOX(), m, Math.cos(a) * Math.max(2.2, (E.R || 2) + 0.3), Math.sin(a) * Math.max(2.2, (E.R || 2) + 0.3), 0, 0.2, 0.2, 0.06)).rotation.z = a; }
      X.A.spin.push({ o: r, axis: 'z', speed: 0.5 });
    }
  },
  wings(X) {
    // small flapping canvas wings on the quarters (or tail-wings on an ornithopter)
    const { H, C, HL, A } = X;
    const big = X.kind !== 'wings', x = big ? -HL * 0.05 : -HL * 0.38;
    for (const sd of [1, -1]) {
      const mir = group(H, x, big ? 0.15 : 0.35, sd * X.b(x) * 0.95); mir.scale.z = sd;
      const sh = group(mir);
      const s = big ? 2.0 : 1.2, c = big ? 1.4 : 0.9;
      const o = [[c * 0.3, 0], [c * 0.15, s * 0.95], [-c * 0.05, s], [-c * 0.35, s * 0.75], [-c * 0.5, s * 0.5], [-c * 0.65, s * 0.25], [-c * 0.75, 0]];
      plate(sh, X.kind === 'none' ? C.trimDS : C.canvas, o);
      rod(sh, C.trim, [c * 0.3, 0, 0], [c * 0.05, 0, s], 0.04, 0.025, 4);
      for (const f of [0.35, 0.7]) rod(sh, C.trim, [c * 0.25, 0.01, s * f], [-c * 0.6, 0.01, s * f * 0.85], 0.02, 0.015, 3);
      A.wings.push({ sh, el: null, amp: 0.22, base: 0.1, phase: sd > 0 ? 0 : 0, outerK: 0, speedK: big ? 0.8 : 1.3 });
      noCrew(sh);
    }
  },
  rotors(X) {
    const { HL, HB } = X;
    if (X.kind === 'wings') { rotor(X, [0.05 * HL, 1.45, 0], 1.2, 1.1); return; }
    if (X.E.horizontal) {
      // rotor pods on outriggers amidships
      for (const sd of [1, -1]) {
        const x = HL * 0.18, z = sd * (HB / 2 + 0.7);
        rod(X.H, X.C.iron, [x, 0.1, sd * HB * 0.45], [x, 0.2, z], 0.05, 0.05, 4);
        rotor(X, [x, 0.2, z], 0.5, 0.8, sd);
      }
    } else { rotor(X, [HL * 0.38, 0, 0], 1.7, 0.9); rotor(X, [-HL * 0.32, 0, 0], 1.7, 0.9, -1); }
  },
  pagoda(X) {
    const { H, C, HL, HB } = X, x = -HL * 0.28;
    pagodaTower(H, C, x, HL * 0.24, HB * 0.62, X.E.horizontal ? 1 : 3, C.side);
    X.blocked.push([x - HL * 0.14, x + HL * 0.14, -HB * 0.35, HB * 0.35]);
  },
  lanterns(X) {
    const { H, C, HL } = X, m = X.glow(0xff7a2a, 1.4, { flick: 0.25 });
    const spots = [];
    for (let i = 0; i < 6; i++) { const x = (i / 5 - 0.5) * HL * 0.8; for (const sd of [1, -1]) spots.push([x, sd * X.b(x)]); }
    for (const [x, z] of spots) {
      rod(H, C.dark, [x, 0.28, z], [x, 0.0, z * 1.12 + Math.sign(z) * 0.12], 0.012, 0.012, 3).userData.noCrew = true;
      const l = add(H, mesh(SPH(), m, x, -0.12, z * 1.12 + Math.sign(z) * 0.12, 0.13, 0.17, 0.13)); l.userData.noCrew = true;
      blk(H, C.dark, x, 0.04, z * 1.12 + Math.sign(z) * 0.12, 0.14, 0.04, 0.14).userData.noCrew = true;
    }
    // strings of lanterns up to the envelope
    if (X.E.cy > 2) for (const sd of [1, -1]) for (let i = 1; i <= 3; i++) {
      const f = i / 4, x = HL * 0.45 * (1 - f * 0.4), y = 0.3 + f * (X.E.cy - 1.6), z = sd * (X.b(HL * 0.45) + f * 0.4);
      add(H, mesh(SPH(), m, x, y, z, 0.11, 0.14, 0.11)).userData.noCrew = true;
    }
  },
  spikes(X) {
    const { H, C, HL } = X, E = X.E;
    for (let i = 0; i < 7; i++) { const x = (i / 6 - 0.5) * HL * 0.85; for (const sd of [1, -1]) spike(H, C.iron, [x, -0.3, sd * X.b(x) * 0.95], [x - 0.1, -0.35, sd * (X.b(x) + 0.45)], 0.07, 4).userData.noCrew = true; }
    spike(H, C.iron, [HL / 2, -0.2, 0], [HL / 2 + 1.2, -0.35, 0], 0.16, 5).userData.noCrew = true; // a ram
    if (E.horizontal) for (let i = 0; i < 8; i++) { const x = (i / 7 - 0.5) * E.Le * 0.75; spike(E.group, C.iron, [x, E.cy + E.rAt(x) * 0.95, 0], [x - 0.15, E.cy + E.rAt(x) + 0.55, 0], 0.1, 4); }
    else if (X.kind === 'crystal') for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; spike(X.g, C.trim, [Math.cos(a) * 0.4, -X.HD + 0.1, Math.sin(a) * 0.4], [Math.cos(a) * 0.9, -X.HD - 0.6, Math.sin(a) * 0.9], 0.08, 4).userData.noCrew = true; }
  },
  plates(X) {
    const { H, C, HL } = X;
    for (let i = 0; i < 7; i++) {
      const x = (i / 6 - 0.5) * HL * 0.8;
      for (const sd of [1, -1]) {
        const p = blk(H, C.iron, x, -0.28, sd * (X.b(x) + 0.03), HL * 0.12, 0.42, 0.06); p.rotation.x = sd * 0.22; p.userData.noCrew = true;
        for (const dy of [-0.13, 0.13]) ell(H, C.trim, x, -0.28 + dy, sd * (X.b(x) + 0.08), 0.03).userData.noCrew = true;
      }
    }
  },
  braziers(X) {
    const { H, C, HL } = X, fire = X.glow(0xff6a1a, 2.0, { flick: 0.45 });
    for (const [u, sd] of [[0.38, 1], [0.38, -1], [-0.16, 1], [-0.16, -1]]) {
      const x = u * HL, z = sd * (X.b(x) - 0.3);
      rod(H, C.iron, [x, 0, z], [x, 0.35, z], 0.04, 0.04, 4);
      add(H, mesh(new THREE.CylinderGeometry(0.2, 0.1, 0.16, 8), C.iron, x, 0.42, z));
      spike(H, fire, [x, 0.45, z], [x, 0.85, z], 0.14, 5);
      X.blocked.push([x - 0.25, x + 0.25, z - 0.25, z + 0.25]);
    }
  },
  banners(X) {
    const { H, C, HL } = X, E = X.E;
    if (E.horizontal) for (const sd of [1, -1]) for (const u of [-0.15, 0.15]) {
      const x = u * E.Le, y = E.cy - E.rAt(x) * 0.55;
      const b = blk(E.group, C.side, x, y - 0.6, sd * E.rAt(x) * 0.88, 0.5, 1.3, 0.03); b.rotation.x = sd * 0.25;
      blk(E.group, C.trim, x, y + 0.02, sd * E.rAt(x) * 0.84, 0.6, 0.06, 0.05).rotation.x = sd * 0.25;
    }
    else for (const sd of [1, -1]) {
      const x = HL * 0.1, z = sd * X.b(x);
      const b = blk(H, C.side, x, -0.55, z + sd * 0.04, 0.55, 1.0, 0.03); b.userData.noCrew = true;
      blk(H, C.trim, x, -0.05, z + sd * 0.04, 0.65, 0.06, 0.05).userData.noCrew = true;
      spike(H, C.side, [x - 0.27, -1.05, z + sd * 0.04], [x, -1.35, z + sd * 0.04], 0.15, 3).userData.noCrew = true;
    }
    // masthead pennants
    rod(H, C.wood, [HL * 0.45, 0.2, 0], [HL * 0.45, 1.6, 0], 0.03, 0.025, 4);
    const p = blk(H, C.side, HL * 0.45 - 0.45, 1.45, 0, 0.9, 0.22, 0.02); p.rotation.z = 0.08;
    X.blocked.push([HL * 0.45 - 0.15, HL * 0.45 + 0.15, -0.15, 0.15]);
  },
  crystalRing(X) {
    const E = X.E, m = X.glow(mixc(X.C.env.color.getHex(), 0xffffff, 0.35), 1.0, { transparent: true, opacity: 0.85, flick: 0.15 });
    const y = E.horizontal ? E.cy : X.kind === 'crystal' ? E.cy - 0.4 : 1.2, R = E.horizontal ? 1.2 : X.kind === 'crystal' ? 2.3 : X.HL * 0.42;
    const r = group(X.g, 0, y, 0);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; const c = add(r, mesh(OCTA(), m, Math.cos(a) * R * (E.horizontal ? 3 : 1), (i % 2) * 0.25, Math.sin(a) * R * (E.horizontal ? 1.4 : 1), 0.18, 0.45, 0.18)); c.rotation.z = 0.3; }
    noCrew(r);
    X.A.spin.push({ o: r, axis: 'y', speed: -0.35 });
  },
  cages(X) {
    const { H, C, HL } = X;
    for (const u of [-0.2, 0.05, 0.28]) {
      const x = u * HL, y = -X.HD - 0.9;
      const cg = group(H, x, y, 0);
      rod(cg, C.iron, [0, 0.8, 0], [0, 0.35, 0], 0.015, 0.015, 3);
      add(cg, mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 8), C.iron, 0, 0.3, 0));
      add(cg, mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 8), C.iron, 0, -0.3, 0));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; rod(cg, C.iron, [Math.cos(a) * 0.29, -0.3, Math.sin(a) * 0.29], [Math.cos(a) * 0.29, 0.3, Math.sin(a) * 0.29], 0.015, 0.015, 3); }
      ell(cg, mat(0x8a7a6a), 0, -0.1, 0, 0.1, 0.2, 0.1); // a captive
      noCrew(cg);
      X.A.bobs.push({ o: cg, amp: 0.05, speed: 1.3, phase: u * 9 });
    }
  },
  skulls(X) {
    const { H, C, HL } = X;
    for (let i = 0; i < 8; i++) {
      const x = (i / 7 - 0.5) * HL * 0.8;
      for (const sd of [1, -1]) {
        const z = sd * (X.b(x) + 0.04);
        ell(H, C.bone, x, 0.05, z, 0.11, 0.12, 0.1).userData.noCrew = true;
        for (const dx of [-0.04, 0.04]) ell(H, C.soot, x + dx, 0.07, z + sd * 0.08, 0.03).userData.noCrew = true;
      }
    }
    for (const sd of [1, -1]) { spike(H, C.bone, [HL / 2 - 0.2, 0.3, sd * 0.1], [HL / 2 + 0.3, 0.9, sd * 0.35], 0.06, 4); }
    ell(H, C.bone, HL / 2 + 0.05, 0.45, 0, 0.22, 0.24, 0.2);
  },
  nest(X) {
    const { H, C } = X, E = X.E, y = E.horizontal ? E.cy + E.R : 1.8;
    const n = add(E.horizontal ? E.group : H, mesh(TORUS(0.35, 10), C.wood, 0, y - 0.1, 0, 0.7)); n.rotation.x = PI / 2;
    for (let i = 0; i < 3; i++) ell(E.horizontal ? E.group : H, C.bone, (i - 1) * 0.2, y, (i % 2) * 0.15, 0.16, 0.2, 0.16);
  },
  crowsNest(X) {
    const { H, C, HL } = X, E = X.E;
    if (E.horizontal) {
      // a railed gun-platform on the spine of the envelope
      const x = E.Le * 0.15, y = E.cy + E.rAt(x) * 0.97;
      add(E.group, mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 10), C.wood, x, y + 0.04, 0));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; rod(E.group, C.trim, [x + Math.cos(a) * 0.45, y, Math.sin(a) * 0.45], [x + Math.cos(a) * 0.45, y + 0.35, Math.sin(a) * 0.45], 0.02, 0.02, 3); }
      add(E.group, mesh(TORUS(0.025, 12), C.trim, x, y + 0.35, 0, 0.45)).rotation.x = PI / 2;
      rod(E.group, C.wood, [x, y, 0], [x, y + 1.1, 0], 0.03, 0.03, 4);
      blk(E.group, C.side, x - 0.25, y + 0.95, 0, 0.45, 0.25, 0.02);
    } else {
      const x = HL * 0.36, h = X.kind === 'balloon' || X.kind === 'lantern' ? 3.0 : 2.6;
      rod(H, C.wood, [x, 0, 0], [x, h + 0.6, 0], 0.07, 0.05, 6);
      add(H, mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.3, 10), C.wood, x, h, 0));
      add(H, mesh(TORUS(0.03, 12), C.trim, x, h + 0.18, 0, 0.42)).rotation.x = PI / 2;
      blk(H, C.side, x - 0.35, h + 0.45, 0, 0.6, 0.3, 0.02);
      for (const sd of [1, -1]) rod(H, C.rope, [x, h, 0], [x - 0.8, 0.28, sd * X.b(x - 0.8) * 0.9], 0.012, 0.012, 3).userData.noCrew = true;
      X.blocked.push([x - 0.2, x + 0.2, -0.2, 0.2]);
    }
  },
  gargoyles(X) {
    const { H, C, HL } = X;
    for (const [u, sd] of [[0.42, 1], [0.42, -1], [-0.42, 1], [-0.42, -1]]) {
      const x = u * HL, z = sd * (X.b(x) - 0.05), gg = group(H, x, 0.3, z); gg.rotation.y = sd > 0 ? -PI / 2 + (u > 0 ? 0.5 : -0.5) : PI / 2 - (u > 0 ? 0.5 : -0.5);
      ell(gg, C.stone, 0, 0.2, 0, 0.2, 0.26, 0.18);
      ell(gg, C.stone, 0.15, 0.45, 0, 0.13);
      for (const s of [1, -1]) { spike(gg, C.stone, [0.15, 0.55, s * 0.07], [0.05, 0.75, s * 0.1], 0.04, 4); plate(gg, C.stone, [[0, 0], [-0.35, 0.05], [-0.25, 0.45]], 0.3).rotation.x = s * 1.0; }
      X.blocked.push([x - 0.3, x + 0.3, z - 0.3, z + 0.3]);
    }
  },
  chains(X) {
    const { H, C, HL } = X;
    for (const u of [-0.35, -0.1, 0.15, 0.35]) for (const sd of [1, -1]) {
      const x = u * HL, z = sd * X.b(x);
      for (let i = 0; i < 5; i++) { const l = add(H, mesh(TORUS(0.25, 6), C.iron, x, -0.25 - i * 0.16, z, 0.08)); l.rotation.y = i % 2 ? PI / 2 : 0; l.userData.noCrew = true; }
      add(H, mesh(SPH(), C.iron, x, -1.1, z, 0.12)).userData.noCrew = true;
    }
  },
  glow(X) {
    const { H, HL, HB } = X, m = X.glow(mixc(X.C.trim.color.getHex(), 0xffffff, 0.3), 1.4, { flick: 0.2 });
    const halo = X.glow(X.C.trim.color.getHex(), 1.0, { transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, flick: 0.25 });
    for (const sd of [1, -1]) for (let i = 0; i < 6; i++) { const x = (i / 5 - 0.5) * HL * 0.75; blk(H, m, x, -X.HD * 0.55, sd * X.b(x) * 0.93, HL * 0.12, 0.06, 0.04).userData.noCrew = true; }
    const d = add(H, mesh(new THREE.CircleGeometry(1, 20), halo, 0, -X.HD - 0.25, 0, HL * 0.42, HB * 0.7, 1)); d.rotation.x = PI / 2; d.userData.noCrew = true;
  },
};

// tatters and burns that show once badly hurt
function rents(X) {
  const E = X.E, g = group(X.g); g.visible = false; X.hide2.push(g);
  const m = X.C.soot;
  if (E.horizontal) for (let i = 0; i < 5; i++) {
    const x = (hash(i + 40) - 0.5) * E.Le * 0.7, a = hash(i + 50) * PI - PI / 2, r = E.rAt(x);
    const p = group(g, x, E.cy, 0); p.rotation.x = a;
    blk(p, m, 0, r * 1.0, 0, 0.5 + hash(i) * 0.5, 0.04, 0.35);
  } else if (E.cy > 2 && E.R) for (let i = 0; i < 4; i++) { const a = hash(i + 7) * TAU; ell(g, m, Math.cos(a) * E.R * 1.25, E.cy + (hash(i) - 0.5) * E.R, Math.sin(a) * E.R * 0.98, 0.35, 0.3, 0.35); }
  for (let i = 0; i < 4; i++) { const x = (hash(i + 70) - 0.5) * X.HL * 0.8; blk(g, m, x, -0.3, Math.sign(hash(i + 3) - 0.5) * X.b(x) * 1.0, 0.4, 0.3, 0.05).userData.noCrew = true; }
}

// where the hands stand: a grid over the open deck
function deckSlots(X) {
  const { HL, blocked } = X, out = [];
  for (let x = -HL / 2 + 0.45; x <= HL / 2 - 0.6; x += 0.42) {
    const b = X.b(x) - 0.3;
    if (b < 0.15) continue;
    for (const z of [-b, -b / 3, b / 3, b]) {
      if (blocked.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) continue;
      out.push([+x.toFixed(3), deckY + 0.01, +z.toFixed(3)]);
    }
  }
  out.sort((a, c) => ((a[0] * 7.13 + a[2] * 3.7) % 1 + 1) % 1 - (((c[0] * 7.13 + c[2] * 3.7) % 1 + 1) % 1));
  return out;
}
void SPH; void BOX; void ell; void shade;
