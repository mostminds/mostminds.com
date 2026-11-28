// A realm's designed working ship, drawn: the parts listed in its `dress` (see src/data/fleets/index.js)
// laid over the hull model. The hull itself is the sculpted class model; the parts library (./parts/) adds
// what the design names: hull forms (twin hulls, rafts, hover, ghostly), her own rig when the design asks for a
// different cloth from the hull's, the drive (wheels, oars, stacks, treads), the bow (rams, drills, jaws,
// figureheads), deck weapons and buildings, rail and hull dressing, and beasts that tow her.
//
// Everything that does not move is gathered into one merged mesh per ship (one draw call; the geometry is shared
// by every ship of the same design and side); parts that move are a few small meshes of their own, driven by
// animateDesign through closures kept in m.userData.designFx.
import * as THREE from 'three';
const PI = Math.PI;
import { buildShip } from './models.js';
import { sculptMaterial } from './sculpt.js';
import { Kit, G, C, clamp, lerp, shade, LEVELS } from './parts/kit.js';
import { styleOf, motif, emblemOn, finial, lantern, banner } from './parts/realmStyle.js';
import { HULL_PARTS, SAIL_STYLES, buildRig, nativeSail, OAR_KINDS } from './parts/hull.js';
import { BOW_PARTS, figureHead } from './parts/bow.js';
import { DECK_PARTS } from './parts/deck.js';
import { buildTow } from './parts/beasts.js';

const profiles = new WeakMap();
const ray = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3();
let ghostMat = null;
function ghostMaterial() {
  if (ghostMat) return ghostMat;
  ghostMat = sculptMaterial().clone();
  Object.assign(ghostMat, { transparent: true, opacity: 0.5, depthWrite: false });
  ghostMat.color.set(0x8affb8); ghostMat.emissive.set(0x1fbf5a); ghostMat.emissiveIntensity = 0.55;
  return ghostMat;
}

/** the hull's deck heights and widths, sampled once per hull geometry */
function profileOf(m, def, deckY) {
  const hull = m.getObjectByName('ship');
  const geos = m.userData.lod?.meshes?.[0]?.geos;
  const geo = hull ? (geos ? geos[geos.length - 1] : hull.geometry) : null;
  const key = geo || m;
  if (profiles.has(key)) return profiles.get(key);
  const L = def.len, B = def.beam, top = m.userData.top ?? L * 0.7;
  const NX = 25, xs = Array.from({ length: NX }, (_, i) => -0.5 * L + (L * i) / (NX - 1));
  const zs = [-0.28, 0, 0.28].map((f) => f * B);
  // surfaces: highest level surface below the lower rigging at each sample
  const targets = [];
  if (geo) { const t = new THREE.Mesh(geo); t.updateMatrixWorld(true); targets.push(t); }
  else { m.updateMatrixWorld(true); m.traverse((o) => { if (o.isMesh && !o.userData.noCrew) targets.push(o); }); }
  const inv = geo ? null : new THREE.Matrix4().copy(m.matrixWorld).invert();
  const cover = [];
  const surf = xs.map((x) => zs.map((z) => {
    _o.set(x, top + 2, z); if (!geo) _o.applyMatrix4(m.matrixWorld);
    ray.set(_o, DOWN); ray.far = top + 6;
    const hits = ray.intersectObjects(targets, false).map((h) => [inv ? h.point.clone().applyMatrix4(inv).y : h.point.y, h.face ? Math.abs(h.face.normal.y) : 0]);
    for (const [y, ny] of hits) {
      if (ny < 0.5 || y > Math.max(top * 0.42, 2.2) || y < -0.3) continue;
      // something solid over this spot (a roof, a tent, a deckhouse) that is not rigging
      const cov = hits.some(([y2, n2]) => n2 > 0.3 && y2 > y + 0.9 && y2 < top * 0.62);
      cover.push(cov);
      return y;
    }
    cover.push(false);
    return null;
  }));
  // widths and ends: vertices between the waterline and the deck, close to the hull
  const all = surf.flat().filter((v) => v !== null).sort((a, b) => a - b);
  const dy = deckY ?? all[Math.floor(all.length * 0.35)] ?? B * 0.25;
  const half = new Array(NX).fill(0), halfLo = new Array(NX).fill(0);
  let bowX = L * 0.5, sternX = -L * 0.5;
  if (geo) {
    const P = geo.attributes.position.array;
    bowX = -1e9; sternX = 1e9;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = Math.abs(P[i + 2]);
      if (y < 0.1 || y > dy + 0.15 || z > B * 0.62) continue;
      const bi = Math.round(((x + L / 2) / L) * (NX - 1));
      if (bi >= 0 && bi < NX && z > half[bi]) half[bi] = z;
      if (bi >= 0 && bi < NX && y < dy * 0.45 && z > halfLo[bi]) halfLo[bi] = z;
      if (y < dy - 0.1) { if (x > bowX) bowX = x; if (x < sternX) sternX = x; }
    }
    if (bowX < 0) bowX = L * 0.5;
    if (sternX > 0) sternX = -L * 0.5;
  } else for (let i = 0; i < NX; i++) halfLo[i] = half[i] = B * 0.5 * (1 - Math.pow(Math.abs(xs[i]) / (L * 0.5), 3) * 0.7);
  const covered = xs.map((_, i) => cover.slice(i * zs.length, i * zs.length + zs.length));
  const prof = { xs, surf, covered, dy, half, halfLo, bowX, sternX, top };
  profiles.set(key, prof);
  return prof;
}

function makeCtx(m, def, sideColor, deckY) {
  const L = def.len, B = def.beam;
  const prof = profileOf(m, def, deckY);
  const NX = prof.xs.length;
  const idx = (x) => clamp(((x + L / 2) / L) * (NX - 1), 0, NX - 1);
  const interp = (arr, x) => { const f = idx(x), i = Math.floor(f), j = Math.min(NX - 1, i + 1), t = f - i; return arr[i] * (1 - t) + arr[j] * t; };
  const dy = prof.dy;
  const fill = (v) => (v === null || v === undefined ? dy : v);
  const col = (zi) => prof.surf.map((row) => fill(row[zi]));
  const mid = col(1), port = col(0), star = col(2);
  const floor = prof.surf.map((row) => Math.min(...row.map(fill)));
  const halfS = prof.half.map((h) => Math.max(h, B * 0.12)), halfL = prof.halfLo.map((h, i) => Math.max(Math.min(h || halfS[i], halfS[i]), B * 0.08));
  const env = envelopeOf(m, def, prof);
  const ctx = {
    m, def, L, B, side: sideColor, dy, prof,
    st: styleOf(def),
    actions: {}, anchors: {}, lodMeshes: [],
    /** register an action hook: fn(k, model), k 0 -> 1, at rest when k = 1 (several per name are all run) */
    action(name, fn) { (ctx.actions[name] ||= []).push(fn); },
    /** a named point in model space for effects (bow, stern, deckL, deckR, mouth, gun, ...) */
    anchor(name, p) { ctx.anchors[name] = p.slice(); },
    /** the outside of the hull at (x, y): its half-width there (falls back to hw) */
    sideZ: (x, y) => env.sideZ(x, y),
    /** the stern face's x at height y (and the bow's) */
    sternAt: (y) => env.sternAt(y), bowAt: (y) => env.bowAt(y),
    k: clamp(L / 10, 0.7, 1.4),
    hullC: def.color ?? 0x6b4a2e, sailC: def.sail ?? 0xe8e0c8, trimC: def.trim ?? 0xd4a83a,
    bowX: prof.bowX, sternX: prof.sternX, top: m.userData.top ?? L * 0.7,
    /** surface height under (x, z) */
    deckAt: (x, z = 0) => interp(z < -B * 0.14 ? port : z > B * 0.14 ? star : mid, x),
    floorAt: (x) => interp(floor, x),
    /** the hull's half-width near deck level at x */
    hw: (x) => interp(halfS, x),
    /** and low down, near the waterline */
    hwLo: (x) => interp(halfL, x),
    kit: new Kit(),
    group: new THREE.Group(),
    fx: [],
    keep: [],
    taken: [],
    has: (p) => def.dress.includes(p),
    /** an animated mesh of the dressing */
    addMoving(obj, fn) { obj.traverse((o) => { o.userData.noCrew = true; if (o.isMesh) { o.castShadow = true; if (o.userData.lodGeos) ctx.lodMeshes.push(o); } }); ctx.group.add(obj); if (fn) ctx.fx.push(fn); return obj; },
    /**
     * a free place on deck for something of radius r: pref is the wanted x as a fraction of the length,
     * mode 'c' on the centre line, 's' to one side (returns z on the freer side); keep: crew stay clear
     */
    place(r, pref = 0, mode = 'c', keep = true) {
      const lo = ctx.sternX + r + 0.25, hi = ctx.bowX - r - L * 0.08;
      let best = null;
      for (let i = 0; i <= 40; i++) {
        const x = lo + ((hi - lo) * i) / 40;
        for (const sgn of mode === 'c' ? [0] : [1, -1]) {
          const z = sgn * Math.max(0, ctx.hw(x) - r - 0.12);
          const y = ctx.deckAt(x, z), zi = z < -B * 0.14 ? 0 : z > B * 0.14 ? 2 : 1;
          let cov = 0;
          for (let j = Math.floor(idx(x - r * 0.7)); j <= Math.ceil(idx(x + r * 0.7)); j++) if (prof.covered[j]?.[zi]) cov++;
          const clutter = Math.max(0, y - Math.min(dy, ctx.floorAt(x)) - 0.3) + cov * 1.5;
          let over = 0;
          for (const [tx, tz, tr] of ctx.taken) { const d = Math.hypot(tx - x, tz - z); if (d < tr + r) over += (tr + r - d); }
          const narrow = mode === 'c' ? Math.max(0, r * 0.8 - ctx.hw(x)) : 0;
          const score = Math.abs(x - pref * L) / L + over * 1.6 + clutter * 0.8 + narrow * 2 + (sgn < 0 ? 0.001 : 0);
          if (!best || score < best.score) best = { x, z, y, score };
        }
      }
      ctx.taken.push([best.x, best.z, r]);
      if (keep) ctx.keep.push([best.x, best.z, r + 0.15]);
      return best;
    },
  };
  return ctx;
}

const envelopes = new WeakMap();
/** the outside of the hull, binned by length and height from her coarsest geometry: half-widths and end faces */
function envelopeOf(m, def, prof) {
  if (envelopes.has(prof)) return envelopes.get(prof);
  const L = def.len, B = def.beam, dy = prof.dy;
  const hull = m.getObjectByName('ship');
  const geos = m.userData.lod?.meshes?.[0]?.geos;
  const geo = hull ? (geos ? geos[geos.length - 1] : hull.geometry) : null;
  const NX = 48, NY = 10, x0 = prof.sternX - 0.3, x1 = prof.bowX + 0.3, y1 = dy + 0.5;
  const zmax = new Float32Array(NX * NY).fill(-1), sx = new Float32Array(NY).fill(1e9), bx = new Float32Array(NY).fill(-1e9);
  const bi = (x) => Math.round(((x - x0) / (x1 - x0)) * (NX - 1)), bj = (y) => Math.round((y / y1) * (NY - 1));
  if (geo && geo.attributes.position) {
    const P = geo.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = Math.abs(P[i + 2]);
      if (y < 0 || y > y1 || z > B * 0.62 || x < x0 || x > x1) continue;
      const a = bi(x), b = bj(y), k = b * NX + a;
      if (z > zmax[k]) zmax[k] = z;
      if (z < B * 0.14) { if (x < sx[b]) sx[b] = x; if (x > bx[b]) bx[b] = x; }
    }
  }
  // fill the holes from the nearest filled bin along the length, then from the profile
  for (let b = 0; b < NY; b++) for (let a = 0; a < NX; a++) {
    if (zmax[b * NX + a] >= 0) continue;
    let best = -1;
    for (let d = 1; d < 4 && best < 0; d++) for (const e of [a - d, a + d]) if (e >= 0 && e < NX && zmax[b * NX + e] >= 0) { best = zmax[b * NX + e]; break; }
    zmax[b * NX + a] = best;
  }
  const hwP = (x) => { const NXp = prof.xs.length, f = clamp(((x + L / 2) / L) * (NXp - 1), 0, NXp - 1), i = Math.floor(f), j = Math.min(NXp - 1, i + 1); return lerp(prof.half[i], prof.half[j], f - i); };
  const env = {
    sideZ(x, y) {
      const fa = clamp(((x - x0) / (x1 - x0)) * (NX - 1), 0, NX - 1), fb = clamp((y / y1) * (NY - 1), 0, NY - 1);
      const a = Math.floor(fa), b = Math.floor(fb), a2 = Math.min(NX - 1, a + 1), b2 = Math.min(NY - 1, b + 1), ta = fa - a, tb = fb - b;
      const v = (i, j) => zmax[j * NX + i];
      const q = [v(a, b), v(a2, b), v(a, b2), v(a2, b2)];
      if (q.some((z) => z < 0)) return Math.max(0.05, Math.max(...q, -1) > 0 ? Math.max(...q) : hwP(x));
      return lerp(lerp(q[0], q[1], ta), lerp(q[2], q[3], ta), tb);
    },
    sternAt(y) { const b = clamp(Math.round((y / y1) * (NY - 1)), 0, NY - 1); return sx[b] < 1e8 ? sx[b] : prof.sternX; },
    bowAt(y) { const b = clamp(Math.round((y / y1) * (NY - 1)), 0, NY - 1); return bx[b] > -1e8 ? bx[b] : prof.bowX; },
  };
  envelopes.set(prof, env);
  return env;
}

// classes with a plain stem that takes the realm's figurehead (the rest carry a carved prow of their own)
const PLAIN_STEM = new Set(['cog', 'fluyt', 'treasureGalleon', 'paddleGalleon', 'dhow', 'warGalley', 'oxBarge', 'curragh', 'icebreaker', 'shroudGalleon', 'dreadGalley', 'razorGalley', 'scrapHulk', 'dreadnought']);
const BOW_KINDS = ['bowGun', 'drill', 'jaws', 'blade', 'ram', 'glacis', 'ramp', 'jawRamp'];
// living or makeshift hulls take no paint band or carved frieze
const NO_FRIEZE = new Set(['fleshBarge', 'hideRaft', 'livingSkiff', 'submersible']);

/** the realm's own dressing on every designed ship: frieze, paint band, stern plaque and lanterns, ensign, figurehead */
function dressRealm(c) {
  const K = c.kit, st = c.st, dress = c.def.dress, dy = c.dy;
  const flat = dress.includes('raft') || dress.includes('boxHull') || NO_FRIEZE.has(c.def.kind);
  const xa = c.sternX + c.L * 0.1, xb = c.bowX - c.L * 0.12;
  // a painted band along her side, in the realm's pattern
  if (!flat && !dress.includes('lowHull')) {
    const y0 = dy * 0.6, y1 = dy * 0.76, n = Math.max(12, Math.round((xb - xa) / 0.25));
    for (const s of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        const xA = lerp(xa, xb, i / n), xB = lerp(xa, xb, (i + 1) / n), xm = (xA + xB) / 2;
        const col = st.trim === 'checker' ? st.band[i % 2] : st.band[0];
        const zA = c.sideZ(xA, (y0 + y1) / 2) + 0.012, zB = c.sideZ(xB, (y0 + y1) / 2) + 0.012;
        const ang = Math.atan2(zB - zA, xB - xA);
        K.add(G.box(Math.hypot(xB - xA, zB - zA) + 0.01, y1 - y0, 0.012), col, xm, (y0 + y1) / 2, s * (zA + zB) / 2, { ry: -s * ang, r: 0.6 });
        if (st.trim === 'stripes') K.add(G.box(Math.hypot(xB - xA, zB - zA) + 0.01, (y1 - y0) * 0.22, 0.014), st.band[1], xm, y1 + (y1 - y0) * 0.25, s * ((zA + zB) / 2 + 0.002), { ry: -s * ang, r: 0.6 });
        K.detail(2, () => {
          if (st.trim === 'teeth' && i % 1 === 0) K.add(G.cone((y1 - y0) * 0.35, (y1 - y0) * 0.8, 3), 0xf0ead8, xm, (y0 + y1) / 2 + (y1 - y0) * 0.05, s * ((zA + zB) / 2 + 0.006), { rz: PI, sz: 0.05 });
          if (st.trim === 'dots' && i % 2 === 0) K.add(G.sph((y1 - y0) * 0.3, 6, 4), st.band[1], xm, (y0 + y1) / 2, s * ((zA + zB) / 2 + 0.006), { sz: 0.3 });
          if (st.trim === 'chevron' && i % 2 === 0) for (const d of [-1, 1]) K.add(G.box((y1 - y0) * 0.7, (y1 - y0) * 0.16, 0.014), st.band[1], xm + d * (y1 - y0) * 0.22, (y0 + y1) / 2, s * ((zA + zB) / 2 + 0.006), { ry: -s * ang, rz: d * 0.7 });
        });
      }
    }
  }
  // the carved frieze under her rail
  if (!flat) {
    const size = clamp(dy * 0.3, 0.16, 0.38), y = dy * (st.trim === 'shields' ? 0.94 : 0.9), pitch = size * 1.2, n = Math.max(3, Math.floor((xb - xa) / pitch));
    K.detail(2, () => {
      for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
        const x = lerp(xa, xb, (i + 0.5) / n), z = c.sideZ(x, y), dz = (c.sideZ(x + 0.1, y) - c.sideZ(x - 0.1, y)) / 0.2;
        const ry = s > 0 ? Math.atan2(-dz, 1) : Math.PI - Math.atan2(-dz, 1);
        K.push(x, y, s * (z + 0.015), 0, ry, 0);
        if (st.trim === 'shields') { K.add(G.cyl(size * 0.42, size * 0.42, 0.04, 14), i % 2 ? st.band[0] : st.band[1], 0, 0, 0, { rx: PI / 2, r: 0.7 }); K.add(G.sph(size * 0.12, 6, 4), st.metal, 0, 0, 0.03, { m: st.metalM }); K.add(G.tor(size * 0.42, size * 0.03, 3, 14), st.metal, 0, 0, 0.02, { m: st.metalM }); }
        else motif(K, st, size);
        K.pop();
      }
    });
  }
  // the stern: a plaque with her device, two lanterns, a finial and her ensign
  const ys = dy * 0.7, xsF = c.sternAt(ys), wS = c.sideZ(xsF + 0.15, ys);
  const plaque = clamp(Math.min(wS * 1.1, dy * 0.75), 0.3, 1.2);
  if (!flat && wS > plaque * 0.42) K.detail(2, () => {
    K.push(xsF - 0.025, ys, 0, 0, -PI / 2, 0);
    K.add(G.cyl(plaque * 0.62, plaque * 0.62, 0.04, 18), shade(st.carve, 0.85), 0, 0, -0.01, { rx: PI / 2, m: st.carve === st.metal ? st.metalM : 0, r: 0.6 });
    K.add(G.tor(plaque * 0.62, plaque * 0.05, 4, 20), st.metal, 0, 0, 0.0, { m: st.metalM, r: 0.4 });
    emblemOn(K, st, plaque * 0.85, { depth: 0.06, col: [st.cloth, st.metal] });
    for (const d of [-1, 1]) { K.push(d * plaque * 0.8, 0, 0); motif(K, st, plaque * 0.5); K.pop(); }
    K.pop();
  });
  const xl = c.sternX + Math.min(0.45, c.L * 0.05), ls = clamp(c.B * 0.18, 0.35, 0.7);
  for (const s of [-1, 1]) {
    const z = s * Math.max(0.15, c.hw(xl) - 0.12), y = Math.max(c.deckAt(xl, z), dy) + 0.15;
    K.push(xl, y, z); lantern(K, st, ls); K.pop();
  }
  const ex = c.sternX + Math.min(0.25, c.L * 0.03), ey = Math.max(c.deckAt(ex, 0), dy);
  const bw = clamp(c.L * 0.1, 0.7, 1.4);
  K.push(ex, ey, 0); const top = banner(K, st, bw, bw * 0.6, c.side); K.pop();
  c.topAt = Math.max(c.topAt || 0, ey + top);
  // the bow: a plain stem gets the realm's figurehead; a stem with nothing gets its finial
  const bowPart = dress.some((p) => BOW_KINDS.includes(p) || p.startsWith('figure:') || p.startsWith('tow:'));
  if (!bowPart && PLAIN_STEM.has(c.def.kind) && !flat) figureHead(c, st.figure);
  else if (!bowPart && !flat) { const x = c.bowAt(dy) - 0.1, y = Math.max(c.deckAt(x - 0.2), dy) + 0.1; K.push(x, y, 0); finial(K, st, clamp(c.B * 0.2, 0.35, 0.7)); K.pop(); }
}

/** swap the hull for the same class built with other options (no masts, oars); returns true when done */
function rebuildHull(m, def, sideColor, opts) {
  const hullM = m.getObjectByName('ship');
  if (!hullM || !m.userData.lod) return false;
  let n;
  try { n = buildShip({ ...def, ...opts }, sideColor); } catch (err) { console.warn('[shipParts] hull rebuild failed', err); return false; }
  const hullN = n.getObjectByName('ship');
  if (!hullN || !n.userData.lod) return false;
  hullM.geometry = hullN.geometry;
  m.userData.lod.meshes[0].geos = n.userData.lod.meshes[0].geos;
  m.userData.top = n.userData.top;
  if (n.userData.muzzles) m.userData.muzzles = n.userData.muzzles;
  const fM = m.getObjectByName('flags'), fN = n.getObjectByName('flags');
  if (fM) {
    if (fN) { fM.geometry = fN.geometry; const ss = n.userData.setSide; if (ss) m.userData.setSide = (hex) => { ss(hex); fM.geometry = fN.geometry; }; }
    else fM.visible = false;
  }
  return true;
}

/** adds def.dress parts to model m; deckY is the deck height in the model's space (found if omitted).
 *  returns footprints [[x, z, r], ...] where deck crew should not stand */
export function dressDesign(m, def, sideColor, deckY) {
  const dress = def.dress || [];
  if (!dress.length) return [];
  // 1. the hull itself: her own rig instead of the class's, or none; oars where the class rows only when asked
  const sailStyle = SAIL_STYLES.find((s) => dress.includes(s));
  const native = nativeSail(def.kind);
  const strip = (dress.includes('noSails') || (sailStyle && !native.includes(sailStyle))) && (def.sails | 0) > 0;
  const wantOars = dress.includes('oars') && !def.oars && OAR_KINDS.includes(def.kind);
  if (strip || wantOars) rebuildHull(m, def, sideColor, { ...(strip ? { sails: 0 } : {}), ...(wantOars ? { oars: true } : {}) });
  if (dress.includes('noSails')) for (const s of m.userData.sails || []) s.visible = false;

  const ctx = makeCtx(m, def, sideColor, deckY);
  ctx.ownRig = !!sailStyle && (strip || (def.sails | 0) === 0 || !m.getObjectByName('ship'));
  ctx.nativeOars = OAR_KINDS.includes(def.kind);

  // 2. parts, in order: hull forms, rig, drive, bow, deck, beasts
  const run = (name, fn) => { try { fn(); } catch (err) { console.warn(`[shipParts] ${def.id}: ${name} failed`, err); } };
  for (const p of dress) if (HULL_PARTS[p]) run(p, () => HULL_PARTS[p](ctx));
  if (ctx.ownRig) run('rig', () => buildRig(ctx, sailStyle));
  for (const p of dress) if (BOW_PARTS[p]) run(p, () => BOW_PARTS[p](ctx));
  else if (p.startsWith('figure:') && BOW_PARTS.figure) run(p, () => BOW_PARTS.figure(ctx, p.slice(7)));
  // the big things first, so they get the middle of the deck
  const deck = dress.filter((p) => DECK_PARTS[p]).sort((a, b) => (DECK_PARTS[b].size || 0) - (DECK_PARTS[a].size || 0));
  for (const p of deck) run(p, () => DECK_PARTS[p].fn(ctx));
  for (const p of dress) if (p.startsWith('tow:')) run(p, () => buildTow(ctx, p.slice(4)));
  // and the realm's own carving, paint, lanterns, ensign and figurehead
  run('realm', () => dressRealm(ctx));

  // 3. hang it on the model: the still dressing is one mesh with its own detail levels, shared by every ship of
  // the same design and side
  if (!ctx.kit.empty) {
    const km = ctx.kit.mesh(undefined, `${def.id}|${sideColor}|${profKey(ctx.prof)}`);
    km.name = 'dress';
    ctx.group.add(km); ctx.lodMeshes.push(km);
  }
  ctx.group.userData.noCrew = true;
  ctx.group.traverse((o) => { o.userData.noCrew = true; });
  m.add(ctx.group);
  if (ctx.lift) {
    // hovering: everything she is lifts; the game's standing places and gun muzzles follow
    for (const c of m.children) if (c !== ctx.group && c !== ctx.hoverGlow) c.position.y += ctx.lift;
    ctx.group.position.y += ctx.lift;
    if (ctx.hoverGlow) ctx.hoverGlow.position.y -= ctx.lift;
    m.userData.top = (m.userData.top ?? 0) + ctx.lift;
    if (m.userData.muzzles) m.userData.muzzles = m.userData.muzzles.map(([x, y, z]) => [x, y + ctx.lift, z]);
    const slots = m.userData.crewSlots;
    if (slots && !slots.__lifted) { for (const p of slots) p[1] += ctx.lift; Object.defineProperty(slots, '__lifted', { value: true }); }
  }
  if (ctx.ghost) {
    const gm = ghostMaterial();
    m.traverse((o) => { if (o.isMesh && (o.name === 'ship' || o.name === 'flags' || o.parent === ctx.group || o.userData.ghostly)) { o.material = gm; o.castShadow = false; } });
  }
  if (ctx.topAt) m.userData.top = Math.max(m.userData.top ?? 0, ctx.topAt + (ctx.lift || 0));
  if (ctx.fx.length) { m.userData.designAnim = true; m.userData.designFx = ctx.fx; }
  hookUp(m, ctx);
  return ctx.keep;
}

let profN = 0;
const profIds = new WeakMap();
function profKey(prof) { if (!profIds.has(prof)) profIds.set(prof, ++profN); return profIds.get(prof); }

/** detail levels, action hooks and anchors onto the model */
function hookUp(m, ctx) {
  // detail levels: append the dressing's meshes to the hull's table (or start one)
  if (ctx.lodMeshes.length) {
    const lod = (m.userData.lod ||= { meshes: [], far: null, level: 0, levels: LEVELS, toJSON: () => undefined });
    for (const mesh of ctx.lodMeshes) {
      const geos = mesh.userData.lodGeos;
      lod.meshes.push({ mesh, geos });
      const g = geos[Math.min(lod.level || 0, geos.length - 1)];
      mesh.geometry = g; mesh.visible = !!g.attributes.position?.count;
    }
  }
  // anchors: her ends and rails, then whatever the parts named
  const L = ctx.L, lift = ctx.lift || 0, dy = ctx.dy;
  const xm = (ctx.bowX + ctx.sternX) / 2;
  const base = {
    bow: [ctx.bowX, Math.max(dy, ctx.deckAt(ctx.bowX - L * 0.05)) + lift, 0],
    stern: [ctx.sternX, Math.max(dy, ctx.deckAt(ctx.sternX + L * 0.05)) + lift, 0],
    deckL: [xm, ctx.deckAt(xm, -ctx.B * 0.3) + 0.2 + lift, -ctx.hw(xm)],
    deckR: [xm, ctx.deckAt(xm, ctx.B * 0.3) + 0.2 + lift, ctx.hw(xm)],
  };
  for (const [k, p] of Object.entries(ctx.anchors)) base[k] = [p[0], p[1] + lift, p[2]];
  m.userData.anchors = { ...(m.userData.anchors || {}), ...base };
  // a shudder through the dressing when she is hit
  const grp = ctx.group;
  ctx.action('hit', (k) => { const a = Math.sin(k * Math.PI * 7) * (1 - k) * 0.03; grp.rotation.x = a; grp.rotation.z = a * 0.5; if (k >= 1) grp.rotation.set(0, 0, 0); });
  const acts = (m.userData.actions ||= {});
  for (const [name, fns] of Object.entries(ctx.actions)) {
    const prev = acts[name];
    acts[name] = (k, model) => { if (prev) prev(k, model); for (const f of fns) f(k, model); };
  }
}

/** per-frame motion for the parts that move (towed beasts swimming, turrets, wheels, glows) */
export function animateDesign(m, t) {
  const fx = m.userData.designFx;
  if (!fx) return;
  if ((m.userData.lod?.level ?? 0) >= 4) return; // a speck on the horizon: nothing to see move
  const ph = m.userData.phase || 0;
  for (let i = 0; i < fx.length; i++) fx[i](t, ph);
}
