// Realm airships: a planked gondola hull (deck at y = 0, where the crew stand) under one of eight kinds of lift
// (see skyschema.js), dressed with the design's AIR_PARTS and the realm's style (style.js / deco.js).
// Model space: +x forward, +z starboard. Everything hangs under an inner group so a hit can shake the whole ship.
import { THREE, PI, TAU, SPH, SPH_LO, HEMI, BOX, CYL, CONE, TORUS, OCTA, ICO, mesh, ell, blk, add, group, rod, spike, plate, slab, lathe, sweep, rope, horn, emblem, patch, fam, tier, tintSet, shade, mixc, bake, noCrew, clamp, lerp, hash, pulse, sidesAt } from './kit.js';
import { styleOf } from './style.js';
import { decoMats, finial, figurehead, banner, trophies, motif, along, roof } from './deco.js';

// hull sizes per lift: [length x len, beam, depth]
const HULL = { dirigible: [0.55, 1.5, 0.75], ribbed: [0.58, 1.6, 0.8], balloon: [0.62, 1.7, 0.95], lantern: [0.6, 1.7, 0.9], patched: [0.5, 1.6, 0.8], none: [0.78, 1.75, 0.95], crystal: [0.66, 1.7, 0.9], wings: [0.72, 1.6, 0.85] };

export function buildSkyShip(def, sideColor) {
  const D = def.sky, look = D.look || {}, L = def.len || 10;
  const kind = HULL[D.envelope] ? D.envelope : 'dirigible';
  const dress = new Set(D.dress || []);
  const S = styleOf(def);
  const T = tintSet();
  const hullC = look.hull ?? def.color ?? 0x6a4a2e, envC = look.envelope ?? def.envelope ?? 0xc8b890, trimC = look.trim ?? S.metal;
  const sideM = mat0(sideColor), sideDark = mat0(shade(sideColor, 0.6));
  const dm = decoMats(T, { ...S, metal: trimC }, sideM, sideDark, { wood: hullC });
  const C = {
    ...dm,
    hull: T.t(hullC, { roughness: 0.8 }), plank: T.t(shade(hullC, 0.8)), deck: T.t(mixc(hullC, 0xc8a878, 0.45)), deckLine: T.t(shade(mixc(hullC, 0xc8a878, 0.45), 0.7)), dark: T.t(shade(hullC, 0.55)),
    env: T.t(envC, { roughness: 0.75 }), env2: T.t(mixc(envC, 0xffffff, 0.12), { roughness: 0.75 }), envB: T.t(mixc(envC, trimC, 0.35), { roughness: 0.7 }), seam: T.t(shade(envC, 0.62)),
    trim: dm.metal, iron: T.t(0x3e3e44, { metalness: 0.6, roughness: 0.5 }), brass: T.t(0xc9a04a, { metalness: 0.7, roughness: 0.35 }),
    canvas: T.t(mixc(envC, 0xe8dcc0, 0.25)), stone: T.t(0x8a8680), soot: T.t(0x1e1a18), glass: T.lit(0xffc878, 0.9), glassDim: T.lit(0x8ab0c0, 0.3), red: T.t(0xb02a1a),
  };
  const root = new THREE.Group(), I = group(root);
  const A = { wings: [], tails: [], heads: [], spin: [], glows: [], bobs: [], speed: 2.2, droop: 0, act: {} };
  const movers = [I], hide2 = [], props = [];
  const [hk, HB, HD] = HULL[kind], HL = L * hk;
  const X = { g: I, root, C, S, A, T, L, HL, HB, HD, kind, dress, movers, hide2, props, blocked: [], def, sideM, guns: [], rockets: [], fx: {} };
  X.b = (x) => halfBeam((x + HL / 2) / HL, HB);
  X.glow = (c, k = 1.3, o = {}) => { const { flick, ...mo } = o; const m = T.glow(c, k, mo); A.glows.push({ m, k: flick ?? 0.15, ph: A.glows.length * 1.7, op: mo.transparent ? mo.opacity : undefined }); return m; };

  hull(X);
  const E = LIFT[kind](X);
  X.E = E;
  for (const part of dress) PARTS[part]?.(X);
  if (!dress.has('turrets')) gunports(X);
  if (E.props !== false) engines(X, E);
  realmDress(X);
  bombBay(X); boarding(X); hangar(X);
  rents(X);

  movers.push(...props, ...hide2, ...A.spin.map((s) => s.o), ...A.bobs.map((b) => b.o), ...X.guns.map((g) => g.p), ...(X.moving || []));
  for (const w of A.wings) movers.push(w.sh, ...(w.el ? [w.el] : []));
  if (E.group) movers.push(E.group);
  const lodMeshes = bake(root, movers, T);
  const box = new THREE.Box3().setFromObject(root);

  const per = Math.max(1, def.cannons?.perSide || 3);
  const muz = X.muzzles || Array.from({ length: per }, (_, i) => { const x = (per === 1 ? 0 : (i / (per - 1) - 0.5)) * HL * 0.5; return [x, -0.25, X.b(x) + 0.35]; });
  const bomb = [0, -HD - 0.1, 0], hang = X.hangarAt || [-HL / 2 + 0.3, 0.05, 0];
  root.userData = {
    skyAnim: true, anim: A, sculpted: false,
    props, muzzles: muz,
    bombBay: bomb, hangar: hang,
    pods: [[HL * 0.2, -HD * 0.6, HB * 0.4], [HL * 0.2, -HD * 0.6, -HB * 0.4], [-HL * 0.2, -HD * 0.6, HB * 0.4], [-HL * 0.2, -HD * 0.6, -HB * 0.4]],
    ladders: [[0, 0, -X.b(0)], [0, 0, X.b(0)]],
    top: box.max.y + 0.1, radius: L / 2,
    crewSlots: deckSlots(X),
    lod: { meshes: lodMeshes, far: null, level: 0, levels: 6, toJSON: () => undefined },
    anchors: {
      bow: [HL / 2 + 0.7, 0.15, 0], stern: [-HL / 2 - 0.3, 0.3, 0], deckL: [0, 0.3, -X.b(0)], deckR: [0, 0.3, X.b(0)],
      port: [0, 0.3, -X.b(0) - 0.05], starboard: [0, 0.3, X.b(0) + 0.05], gondolaL: [0, -HD * 0.4, -X.b(0)], gondolaR: [0, -HD * 0.4, X.b(0)],
      bombBay: bomb, hangar: hang, envelope: [0, E.cy ?? 2, 0], top: [0, box.max.y, 0],
      ...(X.mouth ? { mouth: X.mouth } : {}),
    },
    actions: shipActions(X),
    setSide(hex) { sideM.color.set(hex); sideDark.color.set(hex).multiplyScalar(0.6); },
    setDamage(lv) {
      T.damage(lv);
      for (const o of hide2) o.visible = lv >= 2;
      A.droop = lv >= 3 ? 1 : 0;
      if (E.group) { const s = lv >= 3 ? E.sag ?? 0.8 : 1; E.group.scale.y = s; E.group.position.y = (E.cy || 0) * (1 - s) * 0.6; E.group.rotation.z = lv >= 3 ? -0.04 : 0; }
      props.forEach((p, i) => { p.userData.dead = lv >= 3 || (lv >= 2 && i === 0); });
    },
  };
  return root;
}
function mat0(c) { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }); m.userData.keep = true; return m; }

// ---------- the hull ----------
function halfBeam(t, HB) {
  if (t > 0.62) return (HB / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.38) ** 2)) + 0.02;
  if (t < 0.1) return (HB / 2) * (0.84 + 0.16 * (t / 0.1));
  return HB / 2;
}
const depthAt = (t, HD) => HD * (t > 0.68 ? 1 - 0.6 * ((t - 0.68) / 0.32) ** 1.4 : t < 0.12 ? 0.72 + 0.28 * (t / 0.12) : 1);
/** a point on the hull skin: t along (0 stern .. 1 bow), f around (0 starboard rail .. PI port rail), k > 1 stands it off the skin */
function hullPt(HL, HB, HD, t, f, k = 1) {
  const b = halfBeam(t, HB), d = depthAt(t, HD), c = Math.cos(f), s = Math.sin(f);
  return [-HL / 2 + t * HL, -d * Math.pow(Math.max(0, s), 0.85) * k, b * Math.sign(c) * Math.pow(Math.abs(c), 0.55) * k];
}
function hullGeo(HL, HB, HD, q) {
  const N = Math.round(34 * [1, 0.7, 0.5, 0.35][q]), M = Math.round(20 * [1, 0.7, 0.5, 0.35][q]) & ~1, pos = [], idx = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) pos.push(...hullPt(HL, HB, HD, i / N, (j / M) * PI));
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + M + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const c0 = pos.length / 3; pos.push(-HL / 2, -depthAt(0, HD) * 0.4, 0);
  for (let j = 0; j < M; j++) idx.push(c0, j + 1, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function hull(X) {
  const { g, C, S, HL, HB, HD, kind } = X;
  const H = group(g); X.H = H;
  const P = (t, f, k) => hullPt(HL, HB, HD, t, f, k);
  const wicker = kind === 'patched';
  add(H, mesh(fam(null, (q) => hullGeo(HL, HB, HD, q)), wicker ? C.wood : C.hull)).userData.noCrew = true;
  // planking: raised strakes in a darker tone, a keel along the bottom, a wale in the trim
  tier(1, () => {
    const strakes = wicker ? [0.25, 0.45, 0.65, 0.85, 1.05, 1.25] : [0.3, 0.55, 0.8, 1.05, 1.3];
    for (const f0 of strakes) for (const sd of [1, -1]) {
      const fa = sd > 0 ? f0 : PI - f0 - 0.035, fb = fa + 0.035;
      noCrew(patch(H, wicker ? C.dark : C.plank, (u, v) => P(0.004 + u * 0.99, lerp(fa, fb, v), 1.008), 24, 1));
    }
    if (wicker) for (let i = 0; i < 22; i++) { const t = 0.03 + (i / 21) * 0.94; noCrew(patch(H, C.dark, (u, v) => P(t + (v - 0.5) * 0.008, 0.15 + u * (PI - 0.3), 1.012), 10, 1)); }
  });
  const keel = []; for (let i = 0; i <= 10; i++) keel.push(P(0.02 + i * 0.097, PI / 2, 1.0).map((v, k) => (k === 1 ? v - 0.04 : v)));
  noCrew(sweep(H, C.dark, keel, 0.06, { n: 20, m: 5, ry: 1.6 }));
  // stem post sweeping up at the bow
  const bow = P(1, PI / 2, 1);
  noCrew(sweep(H, C.dark, [[bow[0] - 0.4, bow[1] + 0.05, 0], [bow[0] + 0.05, bow[1] * 0.4, 0], [bow[0] + 0.15, 0.2, 0], [bow[0] + 0.05, 0.55, 0]], 0.07, { n: 10, m: 6 }));
  // the wale in the trim colour (a U round the bow)
  const ring = (f, k, n = 14) => { const pts = []; for (let i = 0; i <= n; i++) pts.push(P(0.01 + (i / n) * 0.98, f, k)); for (let i = n; i >= 0; i--) pts.push(P(0.01 + (i / n) * 0.98, PI - f, k)); return pts; };
  const walePts = ring(0.32, 1.02).filter((_, i, a) => i < a.length / 2 || true);
  tier(3, () => noCrew(sweep(H, C.trim, walePts, 0.035, { n: 70, m: 5, ry: 1.4, round: 0 })));
  // the carved or applied motif along the wale
  tier(1, () => motif(H, C, S.motif, along(ring(0.48, 1.0, 10), 0.42, (p) => [0, -0.25, Math.sign(p[2]) || 1]), 1.1));
  // the deck: a flat plank floor at y = 0, planks drawn
  const N = 20, pts = [];
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push(new THREE.Vector2(-HL / 2 + t * HL, halfBeam(t, HB) - 0.03)); }
  for (let i = N; i >= 0; i--) { const t = i / N; pts.push(new THREE.Vector2(-HL / 2 + t * HL, -(halfBeam(t, HB) - 0.03))); }
  add(H, new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateX(-PI / 2), C.deck)).position.y = 0.005;
  tier(1, () => { for (let i = 0; i < 7; i++) { const z = (i - 3) * HB * 0.13; blk(H, C.deckLine, -HL * 0.04, 0.009, z, HL * (0.86 - Math.abs(i - 3) * 0.05), 0.008, 0.018); } });
  // bulwarks, a cap-rail round them, stanchions inside
  const rh = wicker ? 0.38 : 0.26;
  for (const sd of [1, -1]) noCrew(patch(H, wicker ? C.wood : C.hull, (u, v) => { const t = 0.005 + u * 0.99; return [-HL / 2 + t * HL, v * rh, sd * (halfBeam(t, HB) - 0.005)]; }, 24, 1));
  const capPts = []; for (let i = 0; i <= 16; i++) { const t = 0.01 + (i / 16) * 0.985; capPts.push([-HL / 2 + t * HL, rh + 0.015, halfBeam(t, HB)]); } for (let i = 16; i >= 0; i--) { const t = 0.01 + (i / 16) * 0.985; capPts.push([-HL / 2 + t * HL, rh + 0.015, -halfBeam(t, HB)]); }
  sweep(H, C.trim, capPts, 0.04, { n: 80, m: 5, ry: 0.7, round: 0 });
  tier(1, () => { for (let i = 1; i < 18; i++) { const t = i / 18; for (const sd of [1, -1]) blk(H, C.dark, -HL / 2 + t * HL, rh / 2, sd * (halfBeam(t, HB) - 0.05), 0.05, rh, 0.05); } });
  // transom rail and a stern gallery of lit windows
  blk(H, wicker ? C.wood : C.hull, -HL / 2 + 0.02, rh / 2, 0, 0.06, rh, halfBeam(0, HB) * 2);
  if (!wicker) tier(2, () => {
    const tz = halfBeam(0, HB) * 0.7, n = 4;
    for (let i = 0; i < n; i++) { const z = (i / (n - 1) - 0.5) * tz * 1.6; blk(H, C.glass, -HL / 2 - 0.035, -HD * 0.25, z, 0.02, 0.2, 0.16); tier(1, () => { blk(H, C.trim, -HL / 2 - 0.045, -HD * 0.25, z, 0.02, 0.24, 0.025); blk(H, C.trim, -HL / 2 - 0.045, -HD * 0.25, z, 0.02, 0.025, 0.2); }); }
    blk(H, C.trim, -HL / 2 - 0.04, -HD * 0.08, 0, 0.04, 0.05, tz * 2.1);
    blk(H, C.trim, -HL / 2 - 0.04, -HD * 0.42, 0, 0.04, 0.05, tz * 2.1);
    // stern lanterns on brackets
    for (const sd of [1, -1]) { rod(H, C.iron, [-HL / 2, 0.2, sd * tz], [-HL / 2 - 0.25, 0.35, sd * tz], 0.015); add(H, mesh(CYL(8), C.glass, -HL / 2 - 0.27, 0.27, sd * tz, 0.06, 0.13, 0.06)); add(H, mesh(CONE(8), C.trim, -HL / 2 - 0.27, 0.38, sd * tz, 0.08, 0.08, 0.08)); }
  });
  // portholes between the strakes
  if (!wicker) tier(1, () => { for (let i = 0; i < 6; i++) { const t = 0.18 + i * 0.11; for (const sd of [1, -1]) { const p = P(t, sd > 0 ? 0.62 : PI - 0.62, 1.01); const o = add(H, mesh(TORUS(0.25, 12, 4), C.trim, p[0], p[1], p[2], 0.07)); o.rotation.x = 0; o.rotation.y = 0; noCrew(o); add(H, mesh(CYL(10), C.glassDim, p[0], p[1], p[2], 0.055, 0.02, 0.055)).rotation.x = PI / 2; } } });
  // bowsprit with the realm finial, and the figurehead under it
  const bx = HL / 2 + 0.05;
  rod(H, C.wood, [bx - 0.3, 0.3, 0], [bx + 0.9, 0.62, 0], 0.06, 0.035, 6);
  finial(H, C, S.finial, bx + 0.9, 0.62, 0, 0.5).rotation.z = -1.3;
  if (S.figure !== 'none') figurehead(H, C, S.figure, bx + 0.22, 0.05, 0, 0.95);
  else tier(3, () => { const e = emblem(H, C.trim, S.emblem, 0.45, 0.04); e.position.set(bx + 0.12, -0.05, 0); e.rotation.y = PI / 2; });
  // stern ensign on a staff
  rod(H, C.wood, [-HL / 2 + 0.05, 0.2, 0], [-HL / 2 - 0.35, 1.3, 0], 0.03, 0.025, 5);
  banner(H, C, S, [-HL / 2 - 0.35, 1.3, 0], 0.2, 0.65, { kind: S.banner === 'tug' ? 'tug' : S.banner === 'bunting' ? 'pennon' : S.banner === 'nobori' ? 'swallow' : S.banner, finS: 0.35 });
  // a cabin aft (kept off the open deck)
  if (!X.dress.has('pagoda')) cabin(X, -HL / 2 + HL * 0.08 + 0.15, HL * 0.16, HB * 0.62, 0.62, S.roof === 'pagoda' || S.roof === 'onion' || S.roof === 'ziggurat' || S.roof === 'stepped' ? S.roof : S.roof === 'spire' ? 'spire' : S.roof === 'dome' ? 'dome' : 'gable');
  // deck furniture: capstan, hatch, casks, coils of rope
  deckGear(X);
}
function cabin(X, x, w, d, h, rf) {
  const { H, C, S } = X;
  blk(H, C.hull, x, h / 2, 0, w, h, d);
  tier(2, () => {
    for (const sd of [1, -1]) for (let i = 0; i < 2; i++) { const wx = x + (i - 0.5) * w * 0.45; blk(H, C.glass, wx, h * 0.55, sd * (d / 2 + 0.005), w * 0.22, h * 0.32, 0.02); tier(1, () => { blk(H, C.trim, wx, h * 0.55, sd * (d / 2 + 0.012), w * 0.26, 0.025, 0.02); blk(H, C.trim, wx, h * 0.55, sd * (d / 2 + 0.012), 0.025, h * 0.36, 0.02); }); }
    blk(H, C.dark, x + w / 2 + 0.005, h * 0.42, 0, 0.02, h * 0.75, d * 0.3); // the door forward
    ell(H, C.trim, x + w / 2 + 0.02, h * 0.42, d * 0.1, 0.02);
  });
  blk(H, C.trim, x, h + 0.02, 0, w + 0.1, 0.05, d + 0.1);
  roof(H, C, rf, x, h + 0.04, 0, w + 0.08, d + 0.08, { mat: C.side, finial: S.finial });
  X.blocked.push([x - w / 2 - 0.15, x + w / 2 + 0.15, -d, d]);
}
function deckGear(X) {
  const { H, C, HL } = X;
  tier(2, () => {
    const cx = HL * 0.08;
    lathe(H, C.wood, [[0.18, 0], [0.18, 0.05], [0.12, 0.08], [0.12, 0.3], [0.16, 0.34], [0.16, 0.38], [0.001, 0.4]], 12, 'cap:capstan').position.set(cx, 0, 0);
    tier(1, () => { for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; rod(H, C.dark, [cx, 0.33, 0], [cx + Math.cos(a) * 0.4, 0.33, Math.sin(a) * 0.4], 0.018, 0.015, 4); } });
    X.blocked.push([cx - 0.45, cx + 0.45, -0.45, 0.45]);
    // a hatch grating
    const hx = -HL * 0.12;
    blk(H, C.dark, hx, 0.04, 0, 0.6, 0.08, 0.5);
    tier(1, () => { for (let i = 0; i < 5; i++) blk(H, C.hull, hx + (i - 2) * 0.11, 0.085, 0, 0.03, 0.02, 0.44); for (let i = 0; i < 4; i++) blk(H, C.hull, hx, 0.085, (i - 1.5) * 0.11, 0.54, 0.02, 0.03); });
    X.blocked.push([hx - 0.35, hx + 0.35, -0.3, 0.3]);
    // casks and a coil of rope by the rails
    for (const [u, sd] of [[0.3, 1], [0.34, 1], [-0.22, -1]]) { const x = u * HL, z = sd * (X.b(x) - 0.25); lathe(H, C.wood, [[0.1, 0], [0.12, 0.08], [0.125, 0.14], [0.12, 0.2], [0.1, 0.28]], 10, 'cap:cask').position.set(x, 0, z); tier(1, () => { for (const y of [0.05, 0.23]) add(H, mesh(TORUS(0.12, 12, 3), C.iron, x, y, z, 0.115)).rotation.x = PI / 2; }); X.blocked.push([x - 0.2, x + 0.2, z - 0.2, z + 0.2]); }
    const rx = -HL * 0.28, rz = -(X.b(-HL * 0.28) - 0.3);
    for (let i = 0; i < 3; i++) add(H, mesh(TORUS(0.22, 16, 5), C.rope, rx, 0.03 + i * 0.035, rz, 0.16 - i * 0.025)).rotation.x = PI / 2;
  });
}

// ---------- the eight lifts ----------
/** a horizontal envelope from a cigar profile, in gores of two colours with seams; returns rAt(x) */
function cigar(X, P, Le, R, cy, o = {}) {
  const { C } = X, pts = [], n = 22;
  for (let k = 0; k <= n; k++) {
    const u = k / n, y = -Le / 2 + u * Le;
    const r = o.prof ? o.prof(u) * R : R * (u < 0.55 ? Math.pow(Math.sin((u / 0.55) * PI / 2), 0.62) : Math.pow(Math.cos(((u - 0.55) / 0.45) * PI / 2), 0.42));
    pts.push([Math.max(0.001, r), y]);
  }
  pts[0][0] = 0.001; pts[n][0] = 0.001;
  const gores = o.gores ?? 12, E = group(P, 0, cy, 0); E.rotation.z = -PI / 2;
  for (let i = 0; i < gores; i++) lathe(E, o.single ? C.env : i % 2 ? C.env : C.env2, pts, 30, `cig:${Le},${R},${gores},${!!o.prof}:${i}`, (i / gores) * TAU, TAU / gores);
  // seams along the gores
  tier(1, () => { for (let i = 0; i < gores; i++) { const a = (i / gores) * TAU, sp = []; for (let k = 1; k < n; k += 2) sp.push([Math.sin(a) * pts[k][0] * 1.006, pts[k][1], Math.cos(a) * pts[k][0] * 1.006]); sweep(E, C.seam, sp, 0.012, { n: 24, m: 3, minM: 3, round: 0 }); } });
  const rAt = (x) => { const u = clamp((x + Le / 2) / Le, 0, 1) * n, i = Math.min(n - 1, Math.floor(u)), f = u - i; return pts[i][0] * (1 - f) + pts[i + 1][0] * f; };
  return { pts, rAt };
}
/** tail fins: four (or o.n) ribbed planes with a trim edge and a hinged rudder strip */
function fins(X, P, x, y, r, sz, o = {}) {
  const { C } = X, m = o.mat || C.envB, edge = o.edge || C.trim, n = o.n ?? 4;
  for (let i = 0; i < n; i++) {
    const f = group(P, x, y, 0); f.rotation.x = (i * TAU) / n + (o.rot ?? 0);
    const out = [[0.4, r * 0.55], [-sz * 1.0, r * 0.6], [-sz * 1.2, r + sz * 0.85], [-sz * 0.3, r + sz * 0.75]];
    slab(f, m, out, 0.05, 0.015);
    const rud = [[-sz * 1.0, r * 0.62], [-sz * 1.5, r * 0.62], [-sz * 1.55, r + sz * 0.82], [-sz * 1.2, r + sz * 0.85]];
    slab(f, C.side, rud, 0.04, 0.01);
    rod(f, edge, [-sz * 1.2, 0, r + sz * 0.86], [-sz * 0.3, 0, r + sz * 0.76], 0.035, 0.035, 5);
    rod(f, edge, [-sz * 1.22, 0, r + sz * 0.86], [-sz * 1.55, 0, r + sz * 0.84], 0.03, 0.03, 5);
    tier(1, () => { for (const k of [0.25, 0.5, 0.75]) rod(f, edge, [lerp(0.3, -sz * 0.35, k), 0, r * 0.6], [lerp(-sz * 1.0, -sz * 1.2, k), 0, lerp(r * 0.6, r + sz * 0.85, k)], 0.02, 0.02, 4); });
  }
}
/** rigging from the gondola rails up to the envelope's belly (a pair of lines per station, ratlines on the first) */
function rigging(X, cy, rAt, xs, k = 0.92) {
  const { H, C, HL } = X;
  for (const u of xs) for (const sd of [1, -1]) {
    const bx = u * HL, hb = X.b(bx) * 0.95;
    tier(2, () => {
      for (const dx of [-0.35, 0.35]) { const ex = bx * 1.1 + dx; noCrew(rope(H, C.rope, [bx, 0.28, sd * hb], [ex, cy - rAt(ex) * k, sd * rAt(ex) * 0.38], 0.014, 0.02)); }
    });
  }
}
/** a rope net over the envelope's lower half, gathered into load lines */
function envNet(X, E, Le, rAt, cy, spacing = 0.9) {
  const { C } = X;
  tier(0, () => {
    const n = Math.round(Le * 0.7 / spacing);
    for (let i = 0; i <= n; i++) {
      const x = -Le * 0.35 + (i / n) * Le * 0.7, r = rAt(x) * 1.01, pts = [];
      for (let a = 0; a <= 8; a++) { const ang = PI * 0.15 + (a / 8) * PI * 0.7; pts.push([x, cy - Math.sin(ang) * r, Math.cos(ang) * r]); }
      sweep(E, C.rope, pts, 0.01, { n: 16, m: 3, minM: 3, round: 0 });
    }
  });
}
/** the realm emblem on a roundel in the side colour, on both flanks at x */
function envBadge(X, E, x, cy, r, size) {
  const { C, S } = X;
  for (const sd of [1, -1]) {
    const g = group(E, x, cy + 0.08, sd * (r * 0.99)); if (sd < 0) g.rotation.y = PI;
    add(g, mesh(CYL(28), C.side, 0, 0, 0, size * 0.62, 0.05, size * 0.62)).rotation.x = PI / 2;
    tier(2, () => add(g, mesh(TORUS(0.07, 28), C.trim, 0, 0, 0.03, size * 0.62)));
    tier(3, () => { const e = emblem(g, C.trim, S.emblem, size * 0.95, 0.05); e.position.z = 0.04; });
  }
}
/** a keel catwalk under a horizontal envelope: a trussed girder with a walkway */
function catwalk(X, E, len, y, w = 0.32) {
  const { C } = X;
  blk(E, C.dark, 0, y, 0, len, 0.08, w);
  tier(2, () => { for (const sd of [1, -1]) rod(E, C.iron, [-len / 2, y - 0.2, sd * w / 2], [len / 2, y - 0.2, sd * w / 2], 0.025, 0.025, 4); });
  tier(1, () => { const n = Math.round(len / 0.45); for (let i = 0; i < n; i++) for (const sd of [1, -1]) { const x0 = -len / 2 + (i / n) * len, x1 = x0 + len / n; rod(E, C.iron, [x0, y - 0.04, sd * w / 2], [x1, y - 0.2, sd * w / 2], 0.012, 0.012, 3); rod(E, C.iron, [x0, y - 0.04, sd * w / 2], [x0, y - 0.2, sd * w / 2], 0.012, 0.012, 3); } });
}
const LIFT = {
  dirigible(X) {
    const { g, C, L, S } = X, Le = L * 0.92, R = L * 0.155, cy = 0.95 + R + 0.35;
    const E = group(g);
    const { rAt } = cigar(X, E, Le, R, cy, { gores: 14 });
    for (const u of [-0.32, 0.05, 0.36]) { const r = rAt(u * Le); add(E, mesh(TORUS(0.04, 28), C.trim, u * Le, cy, 0, r * 1.01)).rotation.y = PI / 2; }
    envBadge(X, E, Le * 0.12, cy, rAt(Le * 0.12), 1.15);
    // a metal nose cap with the realm finial
    const nose = lathe(E, C.trim, [[0.001, 0], [0.22, -0.04], [0.32, -0.16], [0.34, -0.22]], 16, 'dir:nose'); nose.position.set(Le / 2 - 0.02, cy, 0); nose.rotation.z = -PI / 2;
    finial(E, C, S.finial, Le / 2 + 0.02, cy, 0, 0.7).rotation.z = -PI / 2;
    fins(X, E, -Le / 2 + 1.0, cy, rAt(-Le / 2 + 1.0) * 0.55, 0.95);
    envNet(X, E, Le, rAt, cy);
    catwalk(X, E, Le * 0.55, cy - R * 0.97);
    rigging(X, cy, rAt, [-0.36, -0.1, 0.18, 0.38]);
    return { group: E, cy, R, Le, rAt, top: cy + R, horizontal: true };
  },
  ribbed(X) {
    const { g, C, L, S } = X, Le = L * 0.94, R = L * 0.16, cy = 1.0 + R + 0.35;
    const E = group(g);
    const { pts, rAt } = cigar(X, E, Le, R, cy, { gores: 16 });
    // steel rings and stringers over the skin, rivets on the rings
    for (let k = 2; k <= 20; k += 2) { const x = pts[k][1], r = pts[k][0]; add(E, mesh(TORUS(k % 4 ? 0.025 : 0.045, 30, 5), C.iron, x, cy, 0, r * 1.015)).rotation.y = PI / 2; }
    tier(2, () => { for (let a = 0; a < 10; a++) { const ang = (a / 10) * TAU + PI / 10, sp = []; for (let k = 1; k < 22; k++) sp.push([pts[k][1], cy + Math.cos(ang) * pts[k][0] * 1.012, Math.sin(ang) * pts[k][0] * 1.012]); sweep(E, C.iron, sp, 0.03, { n: 30, m: 4, round: 0 }); } });
    tier(0, () => { for (let k = 4; k <= 18; k += 4) { const x = pts[k][1], r = pts[k][0] * 1.04; for (let a = 0; a < 12; a++) { const ang = (a / 12) * TAU; ell(E, C.trim, x, cy + Math.cos(ang) * r, Math.sin(ang) * r, 0.03); } } });
    spike(E, C.trim, [Le / 2 - 0.5, cy, 0], [Le / 2 + 0.35, cy, 0], R * 0.35, 10);
    finial(E, C, S.finial, Le / 2 + 0.3, cy, 0, 0.6).rotation.z = -PI / 2;
    fins(X, E, -Le / 2 + 1.0, cy, rAt(-Le / 2 + 1.0) * 0.5, 1.0, { mat: C.trim, edge: C.iron });
    envBadge(X, E, Le * 0.15, cy, rAt(Le * 0.15) + 0.06, 1.15);
    catwalk(X, E, Le * 0.6, cy - R * 0.98, 0.36);
    // girder struts down to the gondola
    for (const u of [-0.3, 0.3]) for (const sd of [1, -1]) {
      const a = [u * X.HL, 0.25, sd * X.b(u * X.HL) * 0.8], b = [u * X.HL * 1.1, cy - rAt(u * X.HL) * 0.95, sd * 0.15];
      noCrew(rod(X.H, C.iron, a, b, 0.05, 0.05, 6));
      tier(1, () => { for (let k = 1; k < 4; k++) { const t = k / 4; ell(X.H, C.trim, lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), 0.07); } });
    }
    rigging(X, cy, rAt, [-0.15, 0.12]);
    return { group: E, cy, R, Le, rAt, top: cy + R, horizontal: true, sag: 0.85 };
  },
  balloon(X) {
    const { g, C, L, S } = X, k = L / 10, cy = 3.6 * k;
    const E = group(g);
    const prof = [[0.45, -2.0], [0.9, -1.85], [1.3, -1.6], [1.7, -1.3], [2.0, -0.95], [2.2, -0.5], [2.3, -0.1], [2.3, 0.3], [2.25, 0.7], [2.1, 1.05], [1.9, 1.4], [1.6, 1.7], [1.25, 1.95], [0.85, 2.15], [0.5, 2.25], [0.001, 2.3]].map(([r, y]) => [r * k, y * k]);
    const gores = 16;
    for (let i = 0; i < gores; i++) { const s = lathe(E, i % 2 ? C.env : C.env2, prof, 36, `bal:${k}:${i}`, (i / gores) * TAU, TAU / gores); s.position.y = cy; }
    tier(2, () => { for (let i = 0; i < gores; i++) { const a = (i / gores) * TAU, sp = prof.slice(1, -1).map(([r, y]) => [Math.sin(a) * r * 1.008, cy + y, Math.cos(a) * r * 1.008]); sweep(E, C.trim, sp, 0.018, { n: 26, m: 3, minM: 3, round: 0 }); } });
    const band = add(E, mesh(TORUS(0.05, 36), C.trim, 0, cy - 0.1 * k, 0, 2.31 * k)); band.rotation.x = PI / 2;
    add(E, mesh(TORUS(0.04, 36), C.envB, 0, cy + 0.5 * k, 0, 2.27 * k)).rotation.x = PI / 2;
    add(E, mesh(TORUS(0.06, 16), C.iron, 0, cy - 2.0 * k, 0, 0.45 * k)).rotation.x = PI / 2;
    // crown valve with the realm finial
    add(E, mesh(CYL(16), C.trim, 0, cy + 2.3 * k, 0, 0.35 * k, 0.08, 0.35 * k));
    finial(E, C, S.finial, 0, cy + 2.32 * k, 0, 0.9);
    envBadge(X, E, 0, cy + 0.2 * k, 2.28 * k, 1.25);
    // scalloped valance round the girth
    tier(2, () => { for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; const v = add(E, mesh(SPH_(), i % 2 ? C.side : C.trim, Math.cos(a) * 2.32 * k, cy - 0.22 * k, Math.sin(a) * 2.32 * k, 0.24 * k, 0.14 * k, 0.05)); v.rotation.y = -a + PI / 2; } });
    // the burner in the mouth
    const burn = X.glow(0xff9a3a, 1.6, { flick: 0.35 }); X.fx.burner = burn;
    add(E, mesh(CONE(10), burn, 0, cy - 1.85 * k, 0, 0.22 * k, 0.4 * k, 0.22 * k)).rotation.x = PI;
    E.scale.x = 1.3;
    // a net of ropes from the load ring and girth down to the rails
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU, ex = Math.cos(a) * 2.2 * k * 1.3, ez = Math.sin(a) * 2.2 * k;
      const dx = clamp(ex * 0.9, -X.HL * 0.42, X.HL * 0.42), dz = Math.sign(ez || 1) * X.b(dx) * 0.95;
      tier(2, () => noCrew(rope(X.H, C.rope, [dx, 0.28, dz], [ex, cy - 0.6 * k, ez], 0.016, 0.03)));
    }
    return { group: E, cy, R: 2.3 * k, top: cy + 2.3 * k + 0.6, horizontal: false, sag: 0.75 };
  },
  lantern(X) {
    const { g, C, L, S } = X, k = L / 10, cy = 3.3 * k;
    const E = group(g);
    const m = X.glow(X.C.env.color.getHex(), 0.55, { flick: 0.12, roughness: 0.9 }); m.emissive.lerp(new THREE.Color(0xffa040), 0.18);
    const prof = [[0.9, -1.7], [1.3, -1.6], [1.6, -1.4], [1.85, -1.1], [1.95, -0.75], [2.05, -0.35], [2.08, 0], [2.05, 0.35], [1.95, 0.75], [1.85, 1.1], [1.6, 1.4], [1.3, 1.6], [0.9, 1.7]].map(([r, y]) => [r * k, y * k]);
    lathe(E, m, prof, 24).position.y = cy;
    for (const y of [-1.4, -0.75, 0, 0.75, 1.4]) { const r = prof.find((p) => Math.abs(p[1] - y * k) < 1e-6)[0]; add(E, mesh(TORUS(0.03, 28), C.dark, 0, cy + y * k, 0, r * 1.01)).rotation.x = PI / 2; }
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; sweep(E, i % 3 ? C.dark : C.trim, prof.map(([r, y]) => [Math.cos(a) * r * 1.012, cy + y, Math.sin(a) * r * 1.012]), i % 3 ? 0.022 : 0.035, { n: 24, m: 4, round: 0 }); }
    // painted panels: the emblem on four faces
    tier(3, () => { for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + PI / 4; const e = emblem(E, C.dark, S.emblem, 1.0 * k, 0.03); e.position.set(Math.cos(a) * 2.1 * k, cy, Math.sin(a) * 2.1 * k); e.rotation.y = -a + PI / 2; } });
    // caps, a curved roof with upturned eaves, tassels
    lathe(E, C.hull, [[0.001, 0.2], [0.9 * k, 0.18], [1.0 * k, 0.05], [0.95 * k, -0.02]], 18).position.y = cy + 1.72 * k;
    lathe(E, C.hull, [[0.95 * k, 0.02], [1.0 * k, -0.05], [0.9 * k, -0.18], [0.001, -0.2]], 18).position.y = cy - 1.72 * k;
    lathe(E, C.trim, [[0.001, 0.9], [0.25 * k, 0.55], [0.7 * k, 0.25], [1.25 * k, 0.02], [1.35 * k, 0.1]], 20).position.y = cy + 1.85 * k;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; horn(E, C.trim, [[Math.cos(a) * 1.2 * k, cy + 1.88 * k, Math.sin(a) * 1.2 * k], [Math.cos(a) * 1.45 * k, cy + 2.0 * k, Math.sin(a) * 1.45 * k]], 0.05); }
    finial(E, C, S.finial, 0, cy + 2.7 * k, 0, 0.8);
    tier(2, () => { for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; const t = group(E, Math.cos(a) * 0.9 * k, cy - 1.9 * k, Math.sin(a) * 0.9 * k); rod(t, C.trim, [0, 0, 0], [0, -0.2, 0], 0.012); ell(t, C.trim, 0, -0.22, 0, 0.04); lathe(t, i % 2 ? C.side : C.accent, [[0.04, 0], [0.07, -0.1], [0.08, -0.4], [0.001, -0.42]], 8, 'lan:tas').position.y = -0.24; } });
    E.scale.x = 1.4;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, ex = Math.cos(a) * 1.0 * k * 1.4, ez = Math.sin(a) * 1.0 * k;
      const dx = clamp(ex * 1.8, -X.HL * 0.42, X.HL * 0.42), dz = Math.sign(ez || 1) * X.b(dx) * 0.95;
      tier(2, () => noCrew(rope(X.H, C.rope, [dx, 0.28, dz], [ex, cy - 1.8 * k, ez], 0.016, 0.03)));
    }
    return { group: E, cy, R: 2.0 * k, top: cy + 2.9 * k, horizontal: false, sag: 0.8 };
  },
  patched(X) {
    const { g, C, L, S } = X, Le = L * 0.78, R = L * 0.2, cy = 0.95 + R + 0.4;
    const E = group(g);
    const prof = (u) => Math.pow(Math.sin(u * PI), 0.55) * (1 + 0.06 * Math.sin(u * 23));
    const { rAt } = cigar(X, E, Le, R, cy, { prof, gores: 8, single: true });
    // patches of every cloth: curved pieces of the skin, stitched round
    const pal = [C.env2, C.trim, X.T.t(0x8a6a4a), X.T.t(0xa8987a), X.T.t(0x6a4a5a), X.T.t(shade(X.C.env.color.getHex(), 0.7)), X.T.t(0xc8b070), C.side, C.accent];
    for (let i = 0; i < 30; i++) {
      const u = 0.1 + 0.8 * hash(i + 3), x = -Le / 2 + u * Le, a = hash(i * 7 + 1) * TAU, w = 0.5 + hash(i) * 0.7, aw = (0.4 + hash(i + 9) * 0.5) / Math.max(0.5, rAt(x));
      const pp = patch(E, pal[i % pal.length], (s, t) => { const xx = x + (s - 0.5) * w, rr = rAt(xx) * 1.012, aa = a + (t - 0.5) * aw; return [xx, cy + Math.cos(aa) * rr, Math.sin(aa) * rr]; }, 4, 3);
      void pp;
      tier(0, () => { for (let k2 = 0; k2 < 4; k2++) { const xx = x + (k2 / 3 - 0.5) * w, rr = rAt(xx) * 1.02; for (const e of [-0.5, 0.5]) { const aa = a + e * aw; rod(E, C.dark, [xx - 0.03, cy + Math.cos(aa) * rr, Math.sin(aa) * rr], [xx + 0.03, cy + Math.cos(aa + 0.03) * rr, Math.sin(aa + 0.03) * rr], 0.008, 0.008, 3); } } });
    }
    for (const u of [-0.25, 0.1, 0.32]) add(E, mesh(TORUS(0.035, 24), C.rope, u * Le, cy, 0, rAt(u * Le) * 1.01)).rotation.y = PI / 2;
    tier(2, () => { for (let a = 0; a < 8; a++) { const ang = (a / 8) * TAU, sp = []; for (let i = 0; i <= 10; i++) { const x = -Le * 0.42 + (i / 10) * Le * 0.84; sp.push([x, cy + Math.cos(ang) * rAt(x) * 1.015, Math.sin(ang) * rAt(x) * 1.015]); } sweep(E, C.rope, sp, 0.02, { n: 20, m: 3, minM: 3, round: 0 }); } });
    // a rag tail-fin on a pole, the realm flag above
    const f = group(E, -Le / 2 + 0.3, cy, 0);
    rod(f, C.wood, [0.4, 0, 0], [-1.3, 0, 0], 0.04);
    slab(f, C.canvas, [[0.4, 0], [-0.9, 0], [-1.25, 1.1], [-0.2, 0.8]], 0.03, 0.01).rotation.x = -PI / 2;
    slab(f, C.canvas, [[0.4, 0], [-0.9, 0], [-1.25, 1.1], [-0.2, 0.8]], 0.03, 0.01).rotation.x = PI;
    banner(E, C, S, [Le * 0.05, cy + R * 0.95, 0], 1.1, 0.7);
    rigging(X, cy, rAt, [-0.32, -0.05, 0.2, 0.38]);
    return { group: E, cy, R, Le, rAt, top: cy + R + 1.2, horizontal: true, sag: 0.7 };
  },
  none(X) {
    // no gasbag: sails of air on light masts, and spinning rune-rings about the hull
    const { H, C, HL, HB, S } = X;
    const sail = X.glow(X.C.env.color.getHex(), 0.55, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, flick: 0.08 });
    for (const [u, h] of [[0.18, 2.9], [-0.12, 3.3], [-0.38, 2.4]]) {
      const x = u * HL;
      sweep(H, C.trim, [[x, 0, 0], [x, h * 0.5, 0], [x, h + 0.25, 0]], [0.05, 0.03], { n: 6, m: 7 });
      finial(H, C, S.finial, x, h + 0.25, 0, 0.45);
      // a curved sail of light between the mast and a boom
      const s = group(H, x, 0.6, 0);
      patch(s, sail, (a, b) => { const hh = (h - 0.45) * (1 - a * 0.0), xx = -b * h * 0.42 * (1 - a * 0.85); return [xx + 0.05, a * hh, Math.sin(b * PI) * 0.18 * (1 - a * 0.5)]; }, 6, 4);
      patch(s, sail, (a, b) => [0.12 + b * 0.8 * (1 - a), (h - 0.45) * (0.1 + a * 0.85), Math.sin(b * PI) * 0.1], 5, 3);
      rod(H, C.trim, [x, 0.62, 0], [x - h * 0.42, 0.62, 0], 0.025, 0.02, 5);
      tier(1, () => { rope(H, C.rope, [x, h + 0.2, 0], [HL / 2 + 0.4, 0.5, 0], 0.01, 0.15); for (const sd of [1, -1]) rope(H, C.rope, [x, h * 0.8, 0], [x - 0.2, 0.28, sd * X.b(x) * 0.95], 0.01, 0.05); });
      X.blocked.push([x - 0.25, x + 0.25, -0.25, 0.25]);
    }
    // crescent: upswept prow and stern, carved
    sweep(H, C.hull, [[HL / 2 - 0.4, 0.05, 0], [HL / 2 + 0.1, 0.3, 0], [HL / 2 + 0.35, 1.0, 0]], [0.18, 0.06], { n: 10, m: 8 });
    sweep(H, C.hull, [[-HL / 2 + 0.4, 0.05, 0], [-HL / 2 - 0.05, 0.4, 0], [-HL / 2 - 0.25, 1.25, 0]], [0.2, 0.06], { n: 10, m: 8 });
    finial(H, C, S.finial, HL / 2 + 0.35, 1.0, 0, 0.5).rotation.z = -0.4;
    // the rune-rings
    const ringM = X.glow(X.C.trim.color.getHex(), 1.1, { flick: 0.2 });
    const n = X.dress.has('runeRings') ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const x = (n === 3 ? (i - 1) * 0.32 : (i - 0.5) * 0.5) * HL, R = HB * 0.95 + 0.4;
      const r = group(X.g, x, 0.1, 0); r.rotation.y = PI / 2;
      add(r, mesh(TORUS(0.045, 40, 6), ringM, 0, 0, 0, R));
      add(r, mesh(TORUS(0.02, 40, 4), C.trim, 0, 0, 0, R * 1.06));
      for (let j = 0; j < 8; j++) { const a = (j / 8) * TAU; const gl = emblem(r, ringM, j % 2 ? 'rune' : S.emblem, 0.26, 0.04); gl.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); gl.rotation.z = a - PI / 2; }
      noCrew(r);
      X.A.spin.push({ o: r, axis: 'x', speed: (i % 2 ? -0.9 : 0.7) });
    }
    return { cy: 2, top: 3.9, horizontal: false, props: false, sailMat: sail };
  },
  crystal(X) {
    const { g, C, H } = X, cy = 3.2, HL = X.HL;
    const E = group(g);
    const spin = group(E, 0, cy, 0);
    const cm = X.glow(X.C.env.color.getHex(), 0.7, { transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1, flick: 0.1, flatShading: true });
    const core = X.glow(mixc(X.C.env.color.getHex(), 0xffffff, 0.5), 1.6, { flick: 0.3 }); X.fx.core = core;
    add(spin, mesh(OCTA(), cm, 0, 0.3, 0, 1.25, 2.7, 1.25));
    add(spin, mesh(ICO(1), core, 0, 0.3, 0, 0.45, 1.0, 0.45));
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU, rr = 0.95 + hash(i + 4) * 0.25; const s = add(spin, mesh(OCTA(), cm, Math.cos(a) * rr, -0.5 + hash(i) * 0.9, Math.sin(a) * rr, 0.3, 0.9 + hash(i + 2) * 0.7, 0.3)); s.rotation.set(Math.sin(a) * 0.4, a, -Math.cos(a) * 0.4); }
    X.A.spin.push({ o: spin, axis: 'y', speed: 0.45 });
    X.A.bobs.push({ o: E, amp: 0.15, speed: 1.1, phase: 0 });
    // the crystal's cradle: a filigree collar on four chains
    add(E, mesh(TORUS(0.06, 28), C.trim, 0, cy - 1.0, 0, 1.0)).rotation.x = PI / 2;
    add(E, mesh(TORUS(0.04, 28), C.trim, 0, cy - 0.8, 0, 1.15)).rotation.x = PI / 2;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; rod(E, C.trim, [Math.cos(a) * 1.0, cy - 1.0, Math.sin(a) * 1.0], [Math.cos(a) * 1.15, cy - 0.8, Math.sin(a) * 1.15], 0.02); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + PI / 4; const dx = Math.cos(a) * HL * 0.25; tier(2, () => { const p0 = [dx, 0.28, Math.sign(Math.sin(a)) * X.b(dx) * 0.9], p1 = [Math.cos(a) * 0.95, cy - 1.0, Math.sin(a) * 0.95]; for (let k = 0; k < 8; k++) { const t = (k + 0.5) / 8; const l = add(H, mesh(TORUS(0.28, 8, 4), C.iron, lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t), lerp(p0[2], p1[2], t), 0.07)); l.rotation.y = k % 2 ? PI / 2 : 0; l.userData.noCrew = true; } }); }
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
      rod(H, C.wood, [wx, 0, sd * X.b(wx) * 0.8], [wx, wy, sd * 0.45], 0.07, 0.06, 6);
      rod(H, C.wood, [wx + 0.9, 0, sd * X.b(wx + 0.9) * 0.8], [wx, wy, sd * 0.45], 0.05, 0.05, 6);
      tier(1, () => rod(H, C.iron, [wx - 0.6, 0, sd * X.b(wx - 0.6) * 0.8], [wx, wy, sd * 0.45], 0.03, 0.03, 4));
    }
    blk(H, C.trim, wx, wy, 0, 0.5, 0.18, 1.0);
    // a crank and gearing that work the wings
    tier(2, () => { const ge = emblem(H, C.trim, 'gear', 0.5, 0.06); ge.position.set(wx, wy - 0.28, 0.52); const ge2 = emblem(H, C.trim, 'gear', 0.5, 0.06); ge2.position.set(wx, wy - 0.28, -0.52); });
    for (const sd of [1, -1]) {
      const mir = group(H, wx, wy, sd * 0.5); mir.scale.z = sd;
      const sh = group(mir);
      const c0 = 2.1, s1 = 2.1, s2 = 3.0;
      // inner panel: canvas stretched over ribs
      const rib = (z, len) => rod(sh, C.wood, [0.15, 0.02, z], [-len, 0.02, z * 0.95], 0.035, 0.02, 5);
      patch(sh, C.canvas, (u, v) => { const z = u * s1, ch = lerp(c0, c0 * 0.85, u); return [lerp(0.15, -ch * 0.85, v), Math.sin(v * PI) * 0.08, z]; }, 6, 4);
      sweep(sh, C.wood, [[0.15, 0, 0], [0.12, 0.02, s1 * 0.5], [0.05, 0, s1]], [0.09, 0.06], { n: 8, m: 7 });
      tier(2, () => { for (const f of [0.25, 0.5, 0.75, 1.0]) rib(s1 * f, lerp(c0, c0 * 0.85, f) * 0.85); });
      const el = group(sh, 0, 0, s1); el.rotation.y = -0.12;
      patch(el, C.canvas, (u, v) => { const z = u * s2, ch = lerp(c0 * 0.85, 0.5, u * u); return [lerp(0.05, -ch, v) - u * 0.3, Math.sin(v * PI) * 0.06, z * (1 - v * 0.1)]; }, 7, 4);
      sweep(el, C.wood, [[0, 0, 0], [0, 0.02, s2 * 0.6], [-0.2, 0, s2]], [0.07, 0.035], { n: 8, m: 6 });
      tier(2, () => { for (const f of [0.3, 0.6, 0.85]) rod(el, C.wood, [0.02 - f * 0.25, 0.02, s2 * f], [-lerp(c0 * 0.85, 0.5, f * f) - f * 0.3, 0.02, s2 * f * 0.95], 0.03, 0.015, 4); });
      // the realm's colours painted on the outer panel
      tier(3, () => { const bd = group(el, -0.75, 0.05, s2 * 0.5); bd.rotation.x = -PI / 2; add(bd, mesh(CYL(24), C.side, 0, 0, 0, 0.42, 0.02, 0.42)).rotation.x = PI / 2; const e = emblem(bd, C.trim, X.S.emblem, 0.6, 0.03); e.position.z = 0.02; });
      A.wings.push({ sh, el, amp: 0.32, base: 0.05, phase: 0, outerK: 0.6, speedK: 1 });
      noCrew(sh);
    }
    A.speed = 2.4;
    X.blocked.push([wx - 0.4, wx + 1.0, -0.6, 0.6]);
    rotor(X, [HL * 0.33, 0, 0], 2.3, 1.5);
    rotor(X, [-HL * 0.33, 0, 0], 2.3, 1.5, -1);
    // a fan tail
    const tl = group(H, -HL / 2 - 0.1, 0.6, 0);
    for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 1.4; rod(tl, C.wood, [0, 0, 0], [-Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5], 0.025, 0.015, 4); }
    patch(tl, C.canvas, (u, v) => { const a = (u - 0.5) * 1.4, r = 0.15 + v * 1.35; return [-Math.cos(a) * r, Math.sin(u * PI * 6) * 0.02 * v, Math.sin(a) * r]; }, 12, 3);
    return { cy: 1.5, top: 3, horizontal: false };
  },
};
const SPH_ = () => SPH();

// ---------- parts ----------
function rotor(X, at, h, R, dir = 1) {
  const { H, C } = X, [x, y, z] = at;
  rod(H, C.iron, [x, y, z], [x, y + h, z], 0.06, 0.05, 6);
  lathe(H, C.trim, [[0.001, -0.1], [0.14, -0.06], [0.16, 0.02], [0.08, 0.1], [0.001, 0.12]], 12, 'rot:hub').position.set(x, y + h, z);
  const r = group(H, x, y + h + 0.05, z);
  for (let i = 0; i < 3; i++) { const q = group(r); q.rotation.y = (i / 3) * TAU; const b = slab(q, C.wood, [[0.08, -0.06], [R * 0.95, -0.12], [R, 0], [R * 0.95, 0.1], [0.08, 0.06]], 0.025, 0.006, `rot:blade${R}`); b.rotation.x = 0.12; tier(1, () => blk(q, C.trim, R * 0.9, 0, 0, 0.2, 0.035, 0.22)); }
  add(r, mesh(CONE(10), C.trim, 0, 0.12, 0, 0.1, 0.2, 0.1));
  noCrew(r);
  X.A.spin.push({ o: r, axis: 'y', speed: 9 * dir });
  X.blocked.push([x - 0.2, x + 0.2, z - 0.2, z + 0.2]);
}
/** a propeller spinning about local x: twisted blades on a hub with a spinner */
function propeller(X, P, x, y, z, R = 0.65, n = 4) {
  const p = group(P, x, y, z);
  for (let i = 0; i < n; i++) {
    const q = group(p); q.rotation.x = (i / n) * TAU;
    const bl = group(q); bl.rotation.y = PI / 2 - 0.45; // chord across the shaft, pitched
    slab(bl, X.C.wood, [[-0.05, 0.06], [-0.08, R * 0.5], [-0.05, R], [0.04, R * 0.98], [0.06, R * 0.45], [0.05, 0.06]], 0.025, 0.006, `prop:${R}`).rotation.x = -PI / 2;
    tier(1, () => { const tip = blk(bl, X.C.trim, 0, R * 0.92, 0, 0.11, 0.12, 0.03); void tip; });
  }
  lathe(p, X.C.trim, [[0.001, 0.22], [0.08, 0.14], [0.12, 0.0], [0.11, -0.06]], 12, 'prop:spin').rotation.z = PI / 2;
  noCrew(p);
  X.props.push(p);
  return p;
}
function nacelle(X, P, x, y, z, s = 1) {
  const { C } = X;
  const n = lathe(P, C.trim, [[0.001, 0.62], [0.12, 0.55], [0.2, 0.4], [0.23, 0.1], [0.22, -0.25], [0.17, -0.45], [0.1, -0.55], [0.06, -0.6]].map(([r, yy]) => [r * s, yy * s]), 16);
  n.position.set(x, y, z); n.rotation.z = -PI / 2;
  add(P, mesh(TORUS(0.12, 20, 5), C.iron, x + 0.4 * s, y, z, 0.215 * s)).rotation.y = PI / 2;
  tier(1, () => { for (let i = 0; i < 3; i++) { const a = PI * 0.3 + i * 0.25; rod(P, C.iron, [x - 0.1 * s, y + Math.sin(a) * 0.2 * s, z + Math.cos(a) * 0.2 * s], [x - 0.35 * s, y + Math.sin(a) * 0.27 * s, z + Math.cos(a) * 0.27 * s], 0.025, 0.03, 5); }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ell(P, C.brass, x + 0.15 * s, y + Math.sin(a) * 0.23 * s, z + Math.cos(a) * 0.23 * s, 0.018); } });
}
function engines(X, E) {
  const { H, C, HL, HB } = X;
  if (E.horizontal) {
    for (const sd of [1, -1]) {
      const x = -HL * 0.25, z = sd * (HB / 2 + 0.8);
      sweep(H, C.iron, [[x + 0.2, 0.1, sd * HB * 0.45], [x + 0.1, 0.25, sd * (HB / 2 + 0.4)], [x, 0.3, z]], 0.05, { n: 6, m: 6 });
      tier(1, () => rod(H, C.iron, [x - 0.3, 0.05, sd * HB * 0.45], [x - 0.05, 0.3, z * 0.98], 0.03, 0.03, 4));
      nacelle(X, H, x, 0.3, z);
      propeller(X, H, x - 0.68, 0.3, z, 0.6);
    }
  } else {
    rod(H, C.iron, [-HL / 2 + 0.1, -0.2, 0], [-HL / 2 - 0.35, -0.3, 0], 0.07, 0.07, 6).userData.noCrew = true;
    nacelle(X, H, -HL / 2 - 0.15, -0.3, 0, 0.7);
    propeller(X, H, -HL / 2 - 0.55, -0.3, 0, 0.6);
  }
}
/** a gun on a recoiling pivot: barrel along +z outward (sd), returns the muzzle point */
function gun(X, P, x, y, z, sd, len = 0.55, r = 0.065) {
  const p = group(P, x, y, z), { C } = X;
  const b = group(p); if (sd < 0) b.rotation.y = PI;
  lathe(b, C.iron, [[0.001, -0.08], [r * 1.5, -0.06], [r * 1.5, 0.05], [r * 1.25, 0.1], [r, len * 0.6], [r * 1.15, len * 0.92], [r * 1.25, len], [r * 0.6, len]].map(([a, c]) => [a, c]), 10, `gun:${len},${r}`).rotation.x = PI / 2;
  tier(1, () => { for (const t of [0.35, 0.65]) add(b, mesh(TORUS(0.35, 10, 4), C.trim, 0, 0, len * t, r * 1.08)); });
  X.guns.push({ p, dir: [0, 0, sd], rest: [x, y, z], i: X.guns.length });
  return [x, y, z + sd * len];
}
function gunports(X) {
  const { H, C, HL } = X, per = Math.max(1, X.def.cannons?.perSide || 3);
  X.muzzles = [];
  for (let i = 0; i < per; i++) {
    const x = (per === 1 ? 0 : (i / (per - 1) - 0.5)) * HL * 0.5, z = X.b(x);
    for (const sd of [1, -1]) {
      blk(H, C.soot, x, -0.2, sd * z * 0.99, 0.26, 0.22, 0.04).userData.noCrew = true;
      tier(1, () => { blk(H, C.trim, x, -0.07, sd * z * 1.0, 0.3, 0.03, 0.05).userData.noCrew = true; blk(H, C.trim, x, -0.33, sd * z * 1.0, 0.3, 0.03, 0.05).userData.noCrew = true; });
      // the port lid, swung up
      const lid = blk(H, C.hull, x, -0.02, sd * (z + 0.08), 0.26, 0.03, 0.2); lid.rotation.x = sd * 0.7; lid.userData.noCrew = true;
      gun(X, H, x, -0.2, sd * z * 0.9, sd, 0.42, 0.06);
    }
    X.muzzles.push([x, -0.2, z + 0.32]);
  }
}
const deckY = 0;
const PARTS = {
  turrets(X) {
    const { H, C, HL } = X, per = Math.max(1, X.def.cannons?.perSide || 3), n = Math.min(per, 3);
    X.muzzles = [];
    for (let i = 0; i < n; i++) {
      const x = (n === 1 ? 0 : (i / (n - 1) - 0.5)) * HL * 0.45 + HL * 0.05, z = X.b(x) - 0.28;
      let mz;
      for (const sd of [1, -1]) {
        lathe(H, C.trim, [[0.36, 0], [0.36, 0.06], [0.32, 0.08], [0.32, 0.24], [0.3, 0.3], [0.22, 0.4], [0.1, 0.45], [0.001, 0.46]], 16, 'tur:body').position.set(x, 0, sd * z);
        tier(1, () => { for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; ell(H, C.iron, x + Math.cos(a) * 0.33, 0.16, sd * z + Math.sin(a) * 0.33, 0.022); } blk(H, C.dark, x + 0.12, 0.3, sd * (z + 0.18), 0.12, 0.04, 0.03); });
        const m = gun(X, H, x + 0.1, 0.3, sd * (z + 0.22), sd, 0.62, 0.065);
        if (sd > 0) mz = m;
        X.blocked.push([x - 0.4, x + 0.4, sd * z - 0.4, sd * z + 0.4]);
      }
      X.muzzles.push([mz[0], mz[1], mz[2]]);
    }
    if (per > n) for (let i = n; i < per; i++) X.muzzles.push(X.muzzles[i % n]);
  },
  stacks(X) {
    const { H, C, HL } = X;
    for (const [dx, dz] of [[-0.08, 0.22], [-0.08, -0.22]]) {
      const x = dx * HL;
      lathe(H, C.iron, [[0.22, 0], [0.2, 0.1], [0.17, 0.2], [0.17, 1.2], [0.21, 1.3], [0.23, 1.42], [0.19, 1.45], [0.15, 1.44]], 12, 'stk:body').position.set(x, 0, dz);
      for (const y of [0.45, 0.85]) add(H, mesh(TORUS(0.15, 14, 4), C.trim, x, y, dz, 0.175)).rotation.x = PI / 2;
      tier(1, () => { for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; ell(H, C.trim, x + Math.cos(a) * 0.18, 1.3, dz + Math.sin(a) * 0.18, 0.025); } });
      X.blocked.push([x - 0.3, x + 0.3, dz - 0.3, dz + 0.3]);
    }
    // the furnace glow at the stack mouths (flares with a mortar or bomb)
    const fm = X.glow(0xff6a1a, 1.4, { flick: 0.5 }); X.fx.furnace = fm;
    for (const dz of [0.22, -0.22]) add(H, mesh(CYL(10), fm, -0.08 * HL, 1.43, dz, 0.15, 0.03, 0.15));
  },
  rocketRack(X) {
    const { H, C, HL } = X, x = HL * 0.3;
    const r = group(H, x, 0.25, 0); r.rotation.z = 0.5;
    blk(r, C.wood, 0, 0, 0, 0.9, 0.08, 0.9);
    const flare = X.glow(0xffb040, 0.0, { flick: 0.3 }); X.fx.rockets = flare; flare.userData.glowBase = 0.05;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const z = (j - 1) * 0.26, y = 0.12 + i * 0.0;
      add(r, mesh(CYL(8), C.trim, 0, y, z, 0.075, 0.82, 0.075)).rotation.z = -PI / 2;
      const rk = add(r, mesh(CONE(8), C.red, 0.5, y, z, 0.07, 0.2, 0.07)); rk.rotation.z = -PI / 2;
      tier(1, () => { for (const sd of [1, -1]) slab(r, C.red, [[-0.4, 0], [-0.25, 0], [-0.42, 0.1]], 0.01, 0, 'rk:fin').position.set(0, y, z + sd * 0.0); });
      add(r, mesh(CONE(6), flare, -0.5, y, z, 0.06, 0.25, 0.06)).rotation.z = PI / 2;
    }
    for (const sd of [1, -1]) rod(H, C.wood, [x, 0, sd * 0.4], [x + 0.2, 0.4, sd * 0.4], 0.04, 0.04, 5);
    X.blocked.push([x - 0.6, x + 0.6, -0.6, 0.6]);
  },
  bombard(X) {
    const { H, C, HL } = X, x = HL * 0.36;
    lathe(H, C.wood, [[0.45, 0], [0.45, 0.1], [0.38, 0.2], [0.001, 0.21]], 14, 'bmb:base').position.set(x, 0, 0);
    const p = group(H, x + 0.1, 0.5, 0); p.rotation.z = -0.5;
    const b = group(p);
    lathe(b, C.iron, [[0.001, -0.5], [0.3, -0.48], [0.34, -0.35], [0.3, 0.0], [0.27, 0.35], [0.31, 0.42], [0.33, 0.48], [0.22, 0.48], [0.2, 0.2]], 14, 'bmb:barrel');
    tier(1, () => { for (const y of [-0.3, -0.1, 0.15]) add(b, mesh(TORUS(0.15, 14, 4), C.trim, 0, y, 0, 0.31)).rotation.x = PI / 2; });
    X.guns.push({ p, dir: [0.48, 0.88, 0], rest: [x + 0.1, 0.5, 0], i: X.guns.length, mortar: true });
    X.mouth = [x + 0.32, 0.92, 0];
    X.blocked.push([x - 0.5, x + 0.6, -0.5, 0.5]);
  },
  lamp(X) {
    const { H, C, HL } = X, x = HL / 2 - 0.55;
    rod(H, C.iron, [x, 0, 0], [x, 0.6, 0], 0.05, 0.05, 6);
    const lp = group(H, x, 0.75, 0); lp.rotation.z = -0.35;
    lathe(lp, C.trim, [[0.12, -0.22], [0.2, -0.15], [0.25, 0.1], [0.25, 0.2], [0.22, 0.22]], 14, 'lamp:body').rotation.z = -PI / 2;
    tier(1, () => { for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; rod(lp, C.iron, [-0.2, Math.sin(a) * 0.22, Math.cos(a) * 0.22], [0.2, Math.sin(a) * 0.26, Math.cos(a) * 0.26], 0.012, 0.012, 3); } });
    const lens = add(lp, mesh(new THREE.CircleGeometry(0.23, 16), X.glow(0xfff2c0, 2.2, { flick: 0.05 }), 0.225, 0, 0)); lens.rotation.y = PI / 2;
    X.blocked.push([x - 0.25, x + 0.25, -0.25, 0.25]);
  },
  runeRings(X) {
    if (X.kind === 'none') return;
    const E = X.E, m = X.glow(X.C.trim.color.getHex(), 1.1, { flick: 0.2 });
    const ringOf = (r, R, n) => { add(r, mesh(TORUS(0.04, 44, 5), m, 0, 0, 0, R)); for (let j = 0; j < n; j++) { const a = (j / n) * TAU; const e = emblem(r, m, j % 2 ? 'rune' : 'tamga', 0.28, 0.04); e.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); e.rotation.z = a - PI / 2; } };
    if (E.horizontal) {
      for (const [u, s] of [[-0.18, 0.7], [0.22, -0.9]]) { const x = u * E.Le, r = group(X.g, x, E.cy, 0); r.rotation.y = PI / 2; ringOf(r, E.rAt(x) + 0.45, 8); X.A.spin.push({ o: r, axis: 'x', speed: s }); }
    } else {
      const R = Math.max(2.2, (E.R || 2) + 0.3), r = group(X.g, 0, (E.cy || 2) + (E.R ? -E.R * 0.4 : 0), 0); r.rotation.x = PI / 2;
      ringOf(r, R, 10);
      X.A.spin.push({ o: r, axis: 'z', speed: 0.5 });
    }
  },
  wings(X) {
    const { H, C, HL, A } = X;
    const big = X.kind !== 'wings', x = big ? -HL * 0.05 : -HL * 0.38;
    for (const sd of [1, -1]) {
      const mir = group(H, x, big ? 0.15 : 0.35, sd * X.b(x) * 0.95); mir.scale.z = sd;
      const sh = group(mir);
      const s = big ? 2.0 : 1.2, c = big ? 1.4 : 0.9;
      const m = X.kind === 'none' ? C.trim : C.canvas;
      patch(sh, m, (u, v) => { const z = u * s, ch = c * (1 - u * u * 0.6); return [lerp(c * 0.3, -ch * 0.75, v) - u * c * 0.1, Math.sin(v * PI) * 0.05, z * (1 - v * 0.12)]; }, 6, 3);
      sweep(sh, C.trim, [[c * 0.3, 0, 0], [c * 0.25, 0.02, s * 0.5], [c * 0.05, 0, s]], [0.045, 0.025], { n: 8, m: 5 });
      tier(2, () => { for (const f of [0.3, 0.6, 0.85]) rod(sh, C.trim, [c * 0.28 - f * 0.1, 0.01, s * f], [-c * (1 - f * f * 0.6) * 0.75 - f * c * 0.1, 0.01, s * f * 0.88], 0.02, 0.012, 4); });
      A.wings.push({ sh, el: null, amp: 0.22, base: 0.1, phase: 0, outerK: 0, speedK: big ? 0.8 : 1.3 });
      noCrew(sh);
    }
  },
  rotors(X) {
    const { HL, HB } = X;
    if (X.kind === 'wings') { rotor(X, [0.05 * HL, 1.45, 0], 1.2, 1.1); return; }
    if (X.E.horizontal) {
      for (const sd of [1, -1]) {
        const x = HL * 0.18, z = sd * (HB / 2 + 0.7);
        sweep(X.H, X.C.iron, [[x, 0.1, sd * HB * 0.45], [x, 0.18, sd * (HB / 2 + 0.35)], [x, 0.2, z]], 0.05, { n: 5, m: 6 });
        rotor(X, [x, 0.2, z], 0.5, 0.8, sd);
      }
    } else { rotor(X, [HL * 0.38, 0, 0], 1.7, 0.9); rotor(X, [-HL * 0.32, 0, 0], 1.7, 0.9, -1); }
  },
  pagoda(X) {
    const { H, C, HL, HB, S } = X, x = -HL * 0.28, tiers = X.E.horizontal ? 1 : 3;
    const rf = ['pagoda', 'onion', 'dome', 'stepped', 'spire'].includes(S.roof) ? S.roof : 'pagoda';
    let y = deckY, w = HL * 0.24, d = HB * 0.62;
    for (let i = 0; i < tiers; i++) {
      const k = 1 - i * 0.22, hh = 0.55 * k, ww = w * k, dd = d * k;
      blk(H, i % 2 ? C.hull : C.dark, x, y + hh / 2, 0, ww, hh, dd);
      // pillars, lattice windows and a lit lantern-light on each tier
      tier(2, () => { for (const sx of [1, -1]) for (const sz of [1, -1]) add(H, mesh(CYL(8), C.side, x + sx * ww * 0.5, y + hh / 2, sz * dd * 0.5, 0.04, hh, 0.04)); for (const sd of [1, -1]) { blk(H, C.glass, x, y + hh * 0.55, sd * (dd / 2 + 0.005), ww * 0.6, hh * 0.45, 0.01); tier(1, () => { for (let j = 0; j < 4; j++) blk(H, C.dark, x + (j / 3 - 0.5) * ww * 0.6, y + hh * 0.55, sd * (dd / 2 + 0.012), 0.02, hh * 0.45, 0.015); }); } });
      y += hh;
      if (i < tiers - 1 || rf === 'pagoda') {
        const rr = add(H, mesh(CONE(4), C.trim, x, y + 0.16, 0, ww * 0.85, 0.32, dd * 0.85)); rr.rotation.y = PI / 4;
        blk(H, C.side, x, y + 0.01, 0, ww * 1.15, 0.04, dd * 1.15);
        for (const sx of [1, -1]) for (const sz of [1, -1]) horn(H, C.trim, [[x + sx * ww * 0.5, y, sz * dd * 0.5], [x + sx * ww * 0.66, y + 0.06, sz * dd * 0.66], [x + sx * ww * 0.7, y + 0.2, sz * dd * 0.7]], 0.04);
        tier(1, () => { for (const sx of [1, -1]) for (const sz of [1, -1]) trophies(H, C, 'bells', [[x + sx * ww * 0.68, y + 0.1, sz * dd * 0.68]], 0.7); });
        y += 0.22;
      }
    }
    if (rf === 'pagoda') finial(H, C, S.finial, x, y, 0, 0.7);
    else roof(H, C, rf, x, y, 0, w * 0.6, d * 0.6, { mat: C.side, finial: S.finial });
    X.blocked.push([x - HL * 0.14, x + HL * 0.14, -HB * 0.35, HB * 0.35]);
  },
  lanterns(X) {
    const { H, C, HL } = X;
    const m = X.glow(0xff7a2a, 1.4, { flick: 0.25 });
    const spots = [];
    for (let i = 0; i < 6; i++) { const x = (i / 5 - 0.5) * HL * 0.8; for (const sd of [1, -1]) spots.push([x, sd * X.b(x)]); }
    for (const [x, z] of spots) {
      const zz = z * 1.12 + Math.sign(z) * 0.12;
      tier(2, () => rod(H, C.dark, [x, 0.28, z], [x, 0.02, zz], 0.012, 0.012, 3).userData.noCrew = true);
      add(H, mesh(SPH_LO(), m, x, -0.12, zz, 0.13, 0.17, 0.13)).userData.noCrew = true;
      tier(1, () => { for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU; add(H, mesh(TORUS(0.08, 12, 3, PI), C.dark, x, -0.12, zz, 0.14, 0.18, 0.14)).rotation.y = a; } });
      blk(H, C.dark, x, 0.04, zz, 0.14, 0.04, 0.14).userData.noCrew = true;
      tier(2, () => lathe(H, C.accent, [[0.03, 0], [0.04, -0.06], [0.05, -0.18], [0.001, -0.19]], 6, 'lan:t2').position.set(x, -0.3, zz));
    }
    if (X.E.cy > 2) for (const sd of [1, -1]) {
      const p0 = [HL * 0.45, 0.3, sd * X.b(HL * 0.45)], p1 = [HL * 0.27, X.E.cy - 1.3, sd * (X.b(HL * 0.45) + 0.4)];
      tier(2, () => rope(H, C.rope, p0, p1, 0.01, 0.15));
      for (let i = 1; i <= 3; i++) { const f = i / 4; add(H, mesh(SPH_LO(), m, lerp(p0[0], p1[0], f), lerp(p0[1], p1[1], f) - 0.15 * 4 * f * (1 - f) - 0.12, lerp(p0[2], p1[2], f), 0.11, 0.14, 0.11)).userData.noCrew = true; }
    }
  },
  spikes(X) {
    const { H, C, HL } = X, E = X.E;
    for (let i = 0; i < 7; i++) { const x = (i / 6 - 0.5) * HL * 0.85; for (const sd of [1, -1]) horn(H, C.iron, [[x, -0.3, sd * X.b(x) * 0.95], [x - 0.05, -0.32, sd * (X.b(x) + 0.25)], [x - 0.15, -0.3, sd * (X.b(x) + 0.5)]], 0.07).userData.noCrew = true; }
    noCrew(sweep(H, C.iron, [[HL / 2 - 0.3, -0.2, 0], [HL / 2 + 0.5, -0.3, 0], [HL / 2 + 1.3, -0.38, 0]], (t) => 0.18 * (1 - t) + 0.005, { n: 8, m: 6, round: 0 })); // a ram
    if (E.horizontal) for (let i = 0; i < 9; i++) { const x = (i / 8 - 0.5) * E.Le * 0.75; horn(E.group, C.iron, [[x, E.cy + E.rAt(x) * 0.95, 0], [x - 0.05, E.cy + E.rAt(x) + 0.3, 0], [x - 0.2, E.cy + E.rAt(x) + 0.6, 0]], 0.1); }
    else if (X.kind === 'crystal') for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; spike(X.g, C.trim, [Math.cos(a) * 0.4, -X.HD + 0.1, Math.sin(a) * 0.4], [Math.cos(a) * 0.9, -X.HD - 0.6, Math.sin(a) * 0.9], 0.08, 6).userData.noCrew = true; }
  },
  plates(X) {
    const { H, C, HL } = X;
    for (let i = 0; i < 7; i++) {
      const x = (i / 6 - 0.5) * HL * 0.8;
      for (const sd of [1, -1]) {
        const p = group(H, x, -0.28, sd * (X.b(x) + 0.03)); p.rotation.x = sd * 0.22;
        const s = slab(p, C.iron, [[-HL * 0.065, -0.22], [HL * 0.065, -0.22], [HL * 0.065, 0.18], [0, 0.24], [-HL * 0.065, 0.18]], 0.05, 0.015); s.rotation.x = -PI / 2;
        tier(0, () => { for (const dy of [-0.15, 0.13]) for (const dx of [-1, 1]) ell(p, C.trim, dx * HL * 0.045, dy, sd * 0.035, 0.025); });
        noCrew(p);
      }
    }
  },
  braziers(X) {
    const { H, C, HL } = X, fire = X.glow(0xff6a1a, 2.0, { flick: 0.45 });
    for (const [u, sd] of [[0.38, 1], [0.38, -1], [-0.16, 1], [-0.16, -1]]) {
      const x = u * HL, z = sd * (X.b(x) - 0.3);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; rod(H, C.iron, [x + Math.cos(a) * 0.12, 0, z + Math.sin(a) * 0.12], [x, 0.36, z], 0.02, 0.02, 4); }
      lathe(H, C.trim, [[0.06, 0], [0.18, 0.06], [0.22, 0.16], [0.2, 0.17]], 12, 'brz:bowl').position.set(x, 0.34, z);
      for (let k = 0; k < 3; k++) spike(H, fire, [x + (k - 1) * 0.06, 0.45, z], [x + (k - 1) * 0.04, 0.8 + (k % 2) * 0.15, z], 0.1, 6);
      X.blocked.push([x - 0.25, x + 0.25, z - 0.25, z + 0.25]);
    }
  },
  banners(X) {
    const { H, C, HL, S } = X, E = X.E;
    if (E.horizontal) for (const sd of [1, -1]) for (const u of [-0.15, 0.15]) {
      const x = u * E.Le, y = E.cy - E.rAt(x) * 0.55, z = sd * E.rAt(x) * 0.88;
      const g = group(E.group, x, y, z); g.rotation.x = sd * 0.25; g.rotation.y = sd > 0 ? 0 : PI;
      rod(g, C.trim, [0.35, 0.02, 0], [-0.35, 0.02, 0], 0.025, 0.025, 5);
      const c = add(g, mesh(fam(null, (q) => clothGeoV(0.6, 1.4, q)), C.side)); c.position.set(0.3, 0, 0.0);
      tier(3, () => { const e = emblem(g, C.trim, S.emblem, 0.45, 0.025); e.position.set(0, -0.55, 0.03); });
    }
    else for (const sd of [1, -1]) {
      const x = HL * 0.1, z = sd * X.b(x), g = group(H, x, -0.05, z + sd * 0.05); if (sd < 0) g.rotation.y = PI;
      rod(g, C.trim, [0.33, 0, 0], [-0.33, 0, 0], 0.025, 0.025, 5);
      const c = add(g, mesh(fam(null, (q) => clothGeoV(0.55, 1.15, q)), C.side)); c.position.set(0.275, 0, 0);
      tier(3, () => { const e = emblem(g, C.trim, S.emblem, 0.4, 0.025); e.position.set(0, -0.45, 0.03); });
      noCrew(g);
    }
    // a masthead pennant forward
    banner(H, C, S, [HL * 0.45, 0.2, 0], 1.5, 0.9, { kind: S.banner === 'tug' ? 'tug' : 'streamer' });
    X.blocked.push([HL * 0.45 - 0.15, HL * 0.45 + 0.15, -0.15, 0.15]);
  },
  crystalRing(X) {
    const E = X.E, m = X.glow(mixc(X.C.env.color.getHex(), 0xffffff, 0.35), 1.0, { transparent: true, opacity: 0.85, flick: 0.15, flatShading: true });
    const y = E.horizontal ? E.cy : X.kind === 'crystal' ? E.cy - 0.4 : 1.2, R = E.horizontal ? 1.2 : X.kind === 'crystal' ? 2.3 : X.HL * 0.42;
    const r = group(X.g, 0, y, 0);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; const c = add(r, mesh(OCTA(), m, Math.cos(a) * R * (E.horizontal ? 3 : 1), (i % 2) * 0.25, Math.sin(a) * R * (E.horizontal ? 1.4 : 1), 0.18, 0.45, 0.18)); c.rotation.z = 0.3; tier(1, () => { const c2 = add(r, mesh(OCTA(), m, Math.cos(a + 0.12) * R * (E.horizontal ? 3 : 1), (i % 2) * 0.25 - 0.15, Math.sin(a + 0.12) * R * (E.horizontal ? 1.4 : 1), 0.08, 0.22, 0.08)); c2.rotation.z = -0.4; }); }
    noCrew(r);
    X.A.spin.push({ o: r, axis: 'y', speed: -0.35 });
  },
  cages(X) {
    const { H, C, HL } = X;
    for (const u of [-0.2, 0.05, 0.28]) {
      const x = u * HL, y = -X.HD - 0.9;
      const cg = group(H, x, y, 0);
      for (let k = 0; k < 4; k++) { const l = add(cg, mesh(TORUS(0.28, 8, 4), C.iron, 0, 0.75 - k * 0.11, 0, 0.06)); l.rotation.y = k % 2 ? PI / 2 : 0; }
      lathe(cg, C.iron, [[0.001, 0.42], [0.18, 0.38], [0.3, 0.3], [0.31, 0.27]], 12, 'cage:top');
      add(cg, mesh(CYL(12), C.iron, 0, -0.3, 0, 0.31, 0.06, 0.31));
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; rod(cg, C.iron, [Math.cos(a) * 0.3, -0.3, Math.sin(a) * 0.3], [Math.cos(a) * 0.3, 0.28, Math.sin(a) * 0.3], 0.015, 0.015, 3); }
      add(cg, mesh(TORUS(0.04, 16, 3), C.iron, 0, 0, 0, 0.3)).rotation.x = PI / 2;
      // a captive, slumped
      ell(cg, X.T.t(0x8a7a6a), 0, -0.12, 0, 0.1, 0.17, 0.09); ell(cg, X.T.t(0xb89a80), 0.02, 0.1, 0, 0.07); rod(cg, X.T.t(0x8a7a6a), [0, 0.0, 0.06], [0.1, 0.25, 0.12], 0.025);
      noCrew(cg);
      X.A.bobs.push({ o: cg, amp: 0.05, speed: 1.3, phase: u * 9 });
    }
  },
  skulls(X) {
    const { H, HL } = X;
    const pts = []; for (let i = 0; i < 8; i++) { const x = (i / 7 - 0.5) * HL * 0.8; for (const sd of [1, -1]) pts.push([x, 0.0, sd * (X.b(x) + 0.06)]); }
    trophies(H, X.C, 'skulls', pts, 1.2);
    for (const sd of [1, -1]) horn(H, X.C.bone, [[HL / 2 - 0.2, 0.3, sd * 0.1], [HL / 2 + 0.1, 0.6, sd * 0.25], [HL / 2 + 0.35, 0.95, sd * 0.35]], 0.07);
    ell(H, X.C.bone, HL / 2 + 0.05, 0.45, 0, 0.22, 0.24, 0.2); for (const sd of [1, -1]) ell(H, X.C.dark, HL / 2 + 0.2, 0.47, sd * 0.08, 0.06);
  },
  nest(X) {
    const { H, C } = X, E = X.E, y = E.horizontal ? E.cy + E.R : 1.8, P = E.horizontal ? E.group : H;
    add(P, mesh(TORUS(0.35, 16, 6), C.wood, 0, y - 0.1, 0, 0.7)).rotation.x = PI / 2;
    tier(1, () => { for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; rod(P, C.dark, [Math.cos(a) * 0.55, y - 0.15, Math.sin(a) * 0.55], [Math.cos(a + 0.6) * 0.85, y, Math.sin(a + 0.6) * 0.85], 0.02, 0.015, 3); } });
    for (let i = 0; i < 3; i++) ell(P, C.bone, (i - 1) * 0.2, y, (i % 2) * 0.15, 0.16, 0.2, 0.16);
  },
  crowsNest(X) {
    const { H, C, HL, S } = X, E = X.E;
    if (E.horizontal) {
      const x = E.Le * 0.15, y = E.cy + E.rAt(x) * 0.97;
      lathe(E.group, C.wood, [[0.001, 0], [0.5, 0], [0.5, 0.08], [0.001, 0.08]], 14, 'cn:floor').position.set(x, y, 0);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; rod(E.group, C.trim, [x + Math.cos(a) * 0.48, y, Math.sin(a) * 0.48], [x + Math.cos(a) * 0.48, y + 0.38, Math.sin(a) * 0.48], 0.02, 0.02, 4); }
      add(E.group, mesh(TORUS(0.025, 20, 4), C.trim, x, y + 0.38, 0, 0.48)).rotation.x = PI / 2;
      tier(2, () => { const sw = group(E.group, x + 0.2, y + 0.3, 0); lathe(sw, C.iron, [[0.05, 0], [0.04, 0.5], [0.05, 0.55]], 8, 'cn:sw').rotation.z = -PI / 2 + 0.1; });
      banner(E.group, C, S, [x - 0.2, y, 0], 1.3, 0.55);
    } else {
      const x = HL * 0.36, h = X.kind === 'balloon' || X.kind === 'lantern' ? 3.0 : 2.6;
      sweep(H, C.wood, [[x, 0, 0], [x, h * 0.5, 0], [x, h + 0.6, 0]], [0.08, 0.05], { n: 6, m: 8 });
      lathe(H, C.wood, [[0.3, -0.15], [0.42, 0.05], [0.44, 0.18], [0.001, 0.18]], 14, 'cn:bask').position.set(x, h - 0.1, 0);
      tier(1, () => { for (let i = 0; i < 6; i++) add(H, mesh(TORUS(0.08, 14, 3), C.dark, x, h - 0.05 + i * 0.04, 0, 0.36 + i * 0.015)).rotation.x = PI / 2; });
      add(H, mesh(TORUS(0.03, 20, 4), C.trim, x, h + 0.18, 0, 0.44)).rotation.x = PI / 2;
      banner(H, C, S, [x, h + 0.6, 0], 0.6, 0.6, { kind: S.banner === 'tug' ? 'tug' : 'swallow' });
      tier(2, () => { for (const sd of [1, -1]) noCrew(rope(H, C.rope, [x, h, 0], [x - 0.8, 0.28, sd * X.b(x - 0.8) * 0.9], 0.012, 0.04)); });
      X.blocked.push([x - 0.2, x + 0.2, -0.2, 0.2]);
    }
  },
  gargoyles(X) {
    const { H, C, HL } = X;
    for (const [u, sd] of [[0.42, 1], [0.42, -1], [-0.42, 1], [-0.42, -1]]) {
      const x = u * HL, z = sd * (X.b(x) - 0.05), gg = group(H, x, 0.3, z); gg.rotation.y = sd > 0 ? -PI / 2 + (u > 0 ? 0.5 : -0.5) : PI / 2 - (u > 0 ? 0.5 : -0.5);
      figurehead(gg, { ...C, bone: C.stone, metal: C.stone, metalDark: C.stone }, 'gargoyle', 0, 0.15, 0, 1.3);
      X.blocked.push([x - 0.3, x + 0.3, z - 0.3, z + 0.3]);
    }
  },
  chains(X) {
    const { H, C, HL } = X;
    for (const u of [-0.35, -0.1, 0.15, 0.35]) for (const sd of [1, -1]) {
      const x = u * HL, z = sd * X.b(x);
      for (let i = 0; i < 6; i++) { const l = add(H, mesh(TORUS(0.25, 10, 4), C.iron, x, -0.25 - i * 0.15, z, 0.08)); l.rotation.y = i % 2 ? PI / 2 : 0; l.userData.noCrew = true; }
      horn(H, C.iron, [[x, -1.12, z], [x + 0.12, -1.25, z], [x + 0.15, -1.1, z]], 0.035).userData.noCrew = true; // a hook
    }
  },
  glow(X) {
    const { H, HL, HB } = X, m = X.glow(mixc(X.C.trim.color.getHex(), 0xffffff, 0.3), 1.4, { flick: 0.2 });
    const halo = X.glow(X.C.trim.color.getHex(), 1.0, { transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, flick: 0.25 });
    for (const sd of [1, -1]) noCrew(sweep(H, m, Array.from({ length: 9 }, (_, i) => hullPt(HL, HB, X.HD, 0.08 + i * 0.1, sd > 0 ? 0.85 : PI - 0.85, 1.015)), 0.025, { n: 30, m: 4, round: 0 }));
    const d = add(H, mesh(new THREE.CircleGeometry(1, 28), halo, 0, -X.HD - 0.25, 0, HL * 0.42, HB * 0.7, 1)); d.rotation.x = PI / 2; d.userData.noCrew = true;
  },
};
/** a long hanging banner from a top bar (in its own x-y plane, top at y = 0, hanging down) */
function clothGeoV(w, h, q) {
  const nu = Math.max(2, Math.round(4 * [1, 0.7, 0.5, 0.35][q])), nv = Math.max(2, Math.round(8 * [1, 0.7, 0.5, 0.35][q]));
  const pos = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const u = i / nu, v = j / nv, tail = 1 - 0.25 * (1 - Math.abs(2 * u - 1)) * (v > 0.75 ? (v - 0.75) * 4 : 0); pos.push(-u * w, -v * h * (v > 0.8 ? lerp(1, 0.92 + 0.08 * Math.abs(2 * u - 1), (v - 0.8) * 5) : 1) * tail ** 0, Math.sin(v * 3 + u) * 0.04 * v); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

// ---------- realm dress: trophies along the rails, the realm banner amidships ----------
function realmDress(X) {
  const { H, C, S, HL } = X;
  const pts = []; for (let i = 0; i < 7; i++) { const x = (i / 6 - 0.5) * HL * 0.7; for (const sd of [1, -1]) pts.push([x, 0.2, sd * (X.b(x) + 0.05)]); }
  if (!X.dress.has('skulls') || S.trophy !== 'skulls') tier(1, () => trophies(H, C, S.trophy, pts, 1.15));
  if (!X.dress.has('banners')) { banner(H, C, S, [HL * 0.3, 0.28, X.b(HL * 0.3) - 0.08], 1.2, 0.6); X.blocked.push([HL * 0.3 - 0.2, HL * 0.3 + 0.2, X.b(HL * 0.3) - 0.3, X.b(HL * 0.3)]); }
}

// ---------- the moving parts for actions ----------
function bombBay(X) {
  const { H, C, HD } = X, w = 0.42, l = 0.9, y = -HD - 0.02;
  blk(H, C.dark, 0, y + 0.02, 0, l + 0.12, 0.05, w * 2 + 0.12).userData.noCrew = true;
  X.doors = [];
  for (const sd of [1, -1]) {
    const p = group(H, 0, y, sd * w); X.doors.push({ p, sd });
    const d = blk(p, C.iron, 0, -0.01, -sd * w / 2, l, 0.035, w); d.userData.noCrew = true;
    tier(1, () => { for (const dx of [-0.3, 0, 0.3]) ell(p, C.trim, dx, -0.03, -sd * w / 2, 0.025); });
  }
  (X.moving ||= []).push(...X.doors.map((d) => d.p));
}
function boarding(X) {
  const { H, C, HL } = X, x = HL * 0.02;
  X.ramps = [];
  for (const sd of [1, -1]) {
    const z = sd * (X.b(x) + 0.03);
    // the gangplank, stowed hanging down the outside of the hull; it swings out level to board
    const p = group(H, x, 0.28, z), pl = group(p); if (sd < 0) pl.rotation.y = PI;
    blk(pl, C.wood, 0, -0.45, 0.04, 0.42, 0.9, 0.05);
    tier(1, () => { for (let i = 0; i < 5; i++) blk(pl, C.dark, 0, -0.1 - i * 0.18, 0.07, 0.42, 0.025, 0.02); for (const ex of [-0.21, 0.21]) rod(pl, C.rope, [ex, 0.0, 0.08], [ex, -0.9, 0.08], 0.012, 0.012, 3); });
    noCrew(p);
    // a grapnel line coiled out of sight until thrown
    const gp = group(H, x - 0.6, 0.35, z); gp.visible = false;
    const gl = group(gp); if (sd < 0) gl.rotation.y = PI;
    rod(gl, C.rope, [0, 0, 0], [0, 0, 1], 0.015, 0.015, 4);
    const hk = group(gl, 0, 0, 1);
    rod(hk, C.iron, [0, 0, -0.05], [0, 0, 0.12], 0.025);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; horn(hk, C.iron, [[0, 0, 0.1], [Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0.05], [Math.cos(a) * 0.12, Math.sin(a) * 0.12, -0.05]], 0.02); }
    noCrew(gp);
    X.ramps.push({ p, sd, gp, gl, hk });
    X.moving = (X.moving || []).concat([p, gp, gl, hk]);
  }
  X.blocked.push([x - 0.3, x + 0.3, -X.b(x), -X.b(x) + 0.25], [x - 0.3, x + 0.3, X.b(x) - 0.25, X.b(x)]);
}
function hangar(X) {
  const { H, C, HL, def } = X;
  if (!def.hangar || !def.hangar.count) return;
  // a launch hatch amidships-aft with two doors and a spring catapult arm
  const x = -HL * 0.24, w = 0.62;
  X.hangarAt = [x, 0.05, 0];
  blk(H, C.dark, x, 0.02, 0, w + 0.12, 0.04, w + 0.12);
  X.hatch = [];
  for (const sd of [1, -1]) { const p = group(H, x, 0.05, sd * w / 2); const d = blk(p, C.hull, 0, 0, -sd * w / 4, w, 0.04, w / 2); d.userData.noCrew = true; tier(1, () => { blk(p, C.trim, 0, 0.025, -sd * w / 4, w, 0.015, 0.04); blk(p, C.trim, w * 0.3, 0.025, -sd * w / 4, 0.04, 0.015, w / 2); blk(p, C.trim, -w * 0.3, 0.025, -sd * w / 4, 0.04, 0.015, w / 2); }); X.hatch.push({ p, sd }); }
  const arm = group(H, x - w * 0.6, 0.1, 0);
  rod(arm, C.iron, [0, 0, 0], [w * 1.1, 0.0, 0], 0.035, 0.03, 6);
  blk(arm, C.trim, w * 1.1, 0.03, 0, 0.12, 0.06, 0.3);
  tier(1, () => { for (let i = 0; i < 5; i++) add(arm, mesh(TORUS(0.3, 10, 3), C.brass, 0.05 + i * 0.03, 0, 0, 0.06)).rotation.y = PI / 2; });
  X.arm = arm;
  X.moving = (X.moving || []).concat([...X.hatch.map((h) => h.p), arm]);
  X.blocked.push([x - w / 2 - 0.4, x + w / 2 + 0.1, -w / 2 - 0.05, w / 2 + 0.05]);
}
const hold = (k, a = 0.18, b = 0.78) => (k <= 0 || k >= 1 ? 0 : k < a ? Math.sin((k / a) * PI / 2) : k < b ? 1 : Math.cos(((k - b) / (1 - b)) * PI / 2) ** 2);
function shipActions(X) {
  const { g: I, guns, doors, ramps, hatch, arm, fx } = X;
  const restGun = () => { for (const G of guns) G.p.position.set(...G.rest); };
  const flare = (m, k, peak) => { if (!m) return; m.userData.boost = k >= 1 ? 0 : peak * pulse(k, 0.15); m.emissiveIntensity = m.userData.glowBase * (1 + m.userData.boost); };
  const bay = (k) => { const o = hold(k, 0.15, 0.75); for (const d of doors || []) d.p.rotation.x = d.sd * 1.25 * o; };
  const recoil = (sel, k, n0) => {
    sel.forEach((G, j) => {
      const kk = clamp(k * 1.6 - (j / Math.max(1, sel.length)) * 0.6, 0, 1), r = pulse(kk, 0.08) * (G.mortar ? 0.18 : 0.14);
      G.p.position.set(G.rest[0] - G.dir[0] * r, G.rest[1] - G.dir[1] * r, G.rest[2] - G.dir[2] * r);
    });
    void n0;
  };
  const acts = {
    fire(k) { const sel = guns.filter((G) => !G.mortar); if (k >= 1) { restGun(); return; } recoil(sel, k); flare(fx.furnace, k, 0.5); },
    flak(k) { const sel = guns.filter((G) => !G.mortar); if (k >= 1) { restGun(); return; } recoil(sel, k); },
    mortar(k) {
      if (k >= 1) { restGun(); bay(1); flare(fx.rockets, 1, 0); flare(fx.furnace, 1, 0); flare(fx.burner, 1, 0); flare(fx.core, 1, 0); return; }
      recoil(guns.filter((G) => G.mortar), k); bay(k); flare(fx.rockets, k, 40); flare(fx.furnace, k, 1.5); flare(fx.burner, k, 1.2); flare(fx.core, k, 1.0);
    },
    bomb(k) { bay(k >= 1 ? 1 : k); flare(fx.rockets, k >= 1 ? 1 : k, k >= 1 ? 0 : 30); },
    launch(k) {
      const o = hold(k, 0.15, 0.7);
      for (const h of hatch || []) h.p.rotation.x = -h.sd * 1.6 * o;
      if (arm) arm.rotation.z = k >= 1 ? 0 : k < 0.3 ? 0 : k < 0.45 ? ((k - 0.3) / 0.15) * 1.1 : 1.1 * (1 - clamp((k - 0.45) / 0.4, 0, 1));
    },
    board(k) {
      const o = hold(k, 0.2, 0.75);
      for (const r of ramps || []) {
        r.p.rotation.x = -r.sd * 1.4 * o;
        const t = k >= 1 ? 0 : k < 0.35 ? k / 0.35 : k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
        r.gp.visible = k > 0 && k < 1 && t > 0.02;
        r.gl.scale.set(1, 1, Math.max(0.01, 2.6 * t));
        r.hk.scale.set(1, 1, 1 / Math.max(0.01, 2.6 * t));
        r.gl.rotation.x = -0.35 * t * r.sd;
        if (k >= 1) { r.gl.scale.set(1, 1, 1); r.hk.scale.set(1, 1, 1); r.gl.rotation.x = 0; }
      }
    },
    grapple(k) { acts.board(k); },
    hit(k) { const s = k >= 1 ? 0 : Math.sin(k * 38) * (1 - k) * (1 - k); I.rotation.x = 0.05 * s; I.rotation.z = 0.025 * Math.sin(k * 23 + 1) * (1 - k); I.position.y = -0.06 * s * s; if (k >= 1) { I.rotation.set(0, 0, 0); I.position.set(0, 0, 0); } },
  };
  return acts;
}

// tatters, burns and holes that show once badly hurt
function rents(X) {
  const E = X.E, g = group(E.group || X.g); g.visible = false; X.hide2.push(g);
  const g2 = group(X.H); g2.visible = false; X.hide2.push(g2);
  const m = X.C.soot, burn = X.T.t(0x3a1a0c);
  if (E.horizontal) for (let i = 0; i < 6; i++) {
    const x = (hash(i + 40) - 0.5) * E.Le * 0.7, a = hash(i + 50) * PI - PI / 2, r = E.rAt(x), w = 0.4 + hash(i) * 0.5, aw = 0.35 / Math.max(0.4, r);
    patch(g, i % 2 ? m : burn, (s, t) => { const xx = x + (s - 0.5) * w, rr = E.rAt(xx) * 1.02, aa = a + (t - 0.5) * aw * (1 - Math.abs(s - 0.5)); return [xx, E.cy + Math.cos(aa) * rr, Math.sin(aa) * rr]; }, 4, 3);
    // a torn flap hanging loose
    tier(2, () => { const fl = group(g, x, E.cy + Math.cos(a) * r, Math.sin(a) * r); fl.rotation.x = a + 0.6; slab(fl, X.C.env, [[-0.2, 0], [0.2, 0], [0.1, 0.4], [-0.15, 0.35]], 0.02, 0); });
  } else if (E.group && E.R) for (let i = 0; i < 5; i++) { const a = hash(i + 7) * TAU, r = E.R * 0.97; ell(g, m, Math.cos(a) * r, E.cy + (hash(i) - 0.3) * E.R * 0.5, Math.sin(a) * r, 0.3, 0.35, 0.3); }
  for (let i = 0; i < 5; i++) { const x = (hash(i + 70) - 0.5) * X.HL * 0.8, sd = Math.sign(hash(i + 3) - 0.5) || 1; ell(g2, m, x, -0.3, sd * X.b(x) * 1.0, 0.25, 0.18, 0.05).userData.noCrew = true; tier(2, () => { for (let k = 0; k < 3; k++) spike(g2, X.C.wood, [x + (k - 1) * 0.08, -0.3, sd * X.b(x)], [x + (k - 1) * 0.12, -0.2 + k * 0.05, sd * (X.b(x) + 0.25)], 0.025, 3).userData.noCrew = true; }); }
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
void HEMI; void BOX; void plate; void sidesAt; void PARTS; void noCrew;
