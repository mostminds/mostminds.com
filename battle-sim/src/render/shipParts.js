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
import { Kit, G, C, clamp, lerp, shade, hash, LEVELS, LAZY, sculptL, lazyMap, SB, S, H, noise3 } from './parts/kit.js';
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

/** the paint band on one beam: a strip following the hull between heights y0 and y1, the trim pattern baked in */
function bandGeo(c, s, y0, y1, xa, xb) {
  const st = c.st, h = y1 - y0;
  return G.custom(`band|${c.def.id}|${profKey(c.prof)}|${s}|${st.trim}|${st.band}`, () => {
    const NU = clamp(Math.round((xb - xa) / 0.035), 60, 500), NV = 8, P = [], Cc = [], idx = [];
    const c0 = new THREE.Color(st.band[0]), c1 = new THREE.Color(st.band[1]), bone = new THREE.Color(0xf0ead8);
    const pat = (X, v) => {
      const f = (X / (h * 0.9)) % 1;
      switch (st.trim) {
        case 'stripes': return v > 0.7 && v < 0.88 ? c1 : v < 0.12 ? c1 : c0;
        case 'checker': return (Math.floor(X / h) + Math.floor(v * 2)) % 2 ? c1 : c0;
        case 'teeth': return 1 - v < 0.75 * (1 - Math.abs(2 * f - 1)) ? bone : c0;
        case 'dots': return Math.hypot((f - 0.5) * 0.9, (v - 0.5)) < 0.28 ? c1 : c0;
        case 'chevron': return Math.abs(Math.abs(f - 0.5) * 2 - v) < 0.22 ? c1 : c0;
        default: return v > 0.82 || v < 0.1 ? c1 : c0;
      }
    };
    // the hull's envelope is binned: take a running median and a mean along her length so the paint lies smooth
    const Z = [];
    for (let j = 0; j <= NV; j++) {
      const y = lerp(y0, y1, j / NV), raw = Array.from({ length: NU + 1 }, (_, i) => c.sideZ(lerp(xa, xb, i / NU), y));
      const med = raw.map((_, i) => { const w = raw.slice(Math.max(0, i - 7), i + 8).sort((a, b) => a - b); return w[Math.floor(w.length * 0.2)]; });
      Z.push(med.map((_, i) => { let t = 0, n = 0; for (let k = Math.max(0, i - 8); k <= Math.min(NU, i + 8); k++) { t += med[k]; n++; } return t / n; }));
    }
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const x = lerp(xa, xb, i / NU), v = j / NV, y = lerp(y0, y1, v);
      P.push(x, y, s * (Z[j][i] + 0.016));
      const col = pat(x - xa, v); Cc.push(col.r, col.g, col.b);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, d = a + NU + 1, e = d + 1; if (s > 0) idx.push(a, b, e, a, e, d); else idx.push(a, e, b, a, d, e); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}

/** the realm's own dressing on every designed ship: frieze, paint band, stern plaque and lanterns, ensign, figurehead */
function dressRealm(c) {
  const K = c.kit, st = c.st, dress = c.def.dress, dy = c.dy;
  const flat = dress.includes('raft') || dress.includes('boxHull') || NO_FRIEZE.has(c.def.kind);
  const xa = c.sternX + c.L * 0.1, xb = c.bowX - c.L * 0.12;
  // a painted band along her side, in the realm's pattern: a skin laid on the hull's own curve, the pattern in its colours
  if (!flat && !dress.includes('lowHull')) {
    const y0 = dy * 0.6, y1 = dy * 0.76;
    for (const s of [-1, 1]) K.add(bandGeo(c, s, y0, y1, xa, xb), 0xffffff, 0, 0, 0, { r: 0.62, grain: 0.08 });
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
  const prof = globalThis.__dressTimes;
  const run = (name, fn) => {
    const t0 = prof ? performance.now() : 0;
    try { fn(); } catch (err) { console.warn(`[shipParts] ${def.id}: ${name} failed`, err); }
    if (prof) { const k = name.split(':')[0]; prof[k] = (prof[k] || 0) + performance.now() - t0; }
  };
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
  const tk = prof ? performance.now() : 0;
  if (!ctx.kit.empty) {
    const km = ctx.kit.mesh(undefined, `${def.id}|${sideColor}|${profKey(ctx.prof)}`);
    km.name = 'dress';
    ctx.group.add(km); ctx.lodMeshes.push(km);
  }
  if (prof) prof.merge = (prof.merge || 0) + performance.now() - tk;
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
  wireDamage(m, ctx);
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
      // the finest levels are meshed only when she is first drawn that close (see Kit.mesh)
      const lv = Math.min(lod.level || 0, geos.length - 1);
      mesh.userData.lodLevel = () => lod.level || 0;
      const g = geos[mesh.userData.pending0 ? Math.max(lv, LAZY) : lv];
      mesh.geometry = g; mesh.visible = mesh.userData.pending0 || !!g.attributes.position?.count;
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
  ctx.action('hit', (k) => { const a = Math.sin(k * Math.PI * 7) * (1 - k) * 0.03, l = m.userData.list || 0; grp.rotation.x = l + a; grp.rotation.z = a * 0.5; if (k >= 1) grp.rotation.set(l, 0, 0); });
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

// =====================================================================================
//  damage: userData.setDamage(level 0..3, { side, fire }) and userData.breakParts
// =====================================================================================
// What she shows, cheapest first: prebuilt overlays (shot holes with splinters and scorch at 1; ragged breaches
// showing ribs, charred planking at 2; more breaches, a holed waterline and glowing embers at 3), each a merged
// mesh with its own detail levels built the first time that level is asked for and shared by every ship of the
// design (the far beam is a mirror image); a broken mast hanging over the side at 2 and every mast down at 3 (cut
// out of her hull and rig and swung about the break, the pieces listed in breakParts); her planking charred; a list.
// The sculpted hull's own setDamage, the deck parts' partDamage hooks and the parts' own (towed beasts) are called too.
const OVER = new Map();
const _n = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
let dmgPieces = null;
/** the overlay pieces, sculpted once: shot hole, breach (with ribs), scorch, splinters, embers (all facing +z) */
function damagePieces() {
  if (dmgPieces) return dmgPieces;
  const char = 0x1c1612, black = 0x060504, wood = 0x6a4a2c, raw = 0xb89a6a;
  const hole = (seed) => () => {
    const B = new SB();
    B.h(H.cyl(0.26, 0.26, 0.012, 20).color(char).pbr(0.95).rot(90, 0, 0).shade((x, y, z) => (Math.hypot(x, z) > 0.14 + 0.09 * noise3(x * 20 + seed, z * 20, seed) ? [0.09, 0.06, 0.04] : null)));
    B.h(H.cyl(0.11, 0.08, 0.07, 12).color(black).pbr(1).rot(90, 0, 0).at(0, 0, 0.0));
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + hash(seed + i) * 0.5, l = 0.07 + hash(seed + i * 3) * 0.1; B.h(H.box(l, 0.016, 0.012, 0.003).color(i % 3 ? raw : wood).pbr(0.9).rot(0, -25 - hash(i + seed) * 30, (a * 180) / Math.PI).at(Math.cos(a) * (0.1 + l * 0.4), Math.sin(a) * (0.1 + l * 0.4), 0.02)); }
    return B.part();
  };
  const breach = () => {
    const B = new SB(), pts = [];
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, r = 0.5 * (0.7 + 0.45 * hash(i * 7 + 1)); pts.push([Math.cos(a) * r * 1.3, Math.sin(a) * r]); }
    B.h(H.extrude(pts.map(([x, y]) => [x * 1.35, y * 1.35]), 0.012, 0.002).color(char).pbr(0.95).shade((x, y) => (noise3(x * 9, y * 9, 3) > 0.55 ? [0.12, 0.07, 0.035] : null)));
    B.h(H.extrude(pts, 0.03, 0.002).color(black).pbr(1).at(0, 0, 0.012));
    for (const x of [-0.42, -0.08, 0.28]) B.h(H.tube([[x, -0.55, -0.06], [x + 0.03, 0, 0.0], [x, 0.55, -0.06]], 0.035, 12, 6).color(0x4a3220).pbr(0.9).shade((xx, yy) => (Math.abs(yy) > 0.3 ? [0.04, 0.03, 0.02] : null)));
    for (let i = 0; i < 12; i++) { const top = i < 6, x = -0.55 + (i % 6) * 0.22, l = 0.12 + hash(i) * 0.22; B.h(H.box(0.2, 0.05, 0.025, 0.004).color(i % 2 ? wood : raw).pbr(0.9).scale(1, 1, 1).rot(0, 0, (top ? -1 : 1) * (8 + hash(i + 2) * 25)).at(x, (top ? 1 : -1) * (0.36 + l * 0.3), 0.02 + hash(i + 5) * 0.04)); }
    return B.part();
  };
  const scorch = (seed) => () => {
    const B = new SB(), pts = [];
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, r = 0.5 * (0.55 + 0.6 * hash(seed + i * 5)); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    B.h(H.extrude(pts, 0.006, 0.002).color(char).pbr(1).shade((x, y) => { const n = noise3(x * 8 + seed, y * 8, seed); return n > 0.62 ? [0.02, 0.016, 0.012] : n < 0.3 ? [0.09, 0.06, 0.04] : null; }));
    return B.part();
  };
  const splinters = () => {
    const B = new SB();
    for (let i = 0; i < 10; i++) B.h(H.cone(0.02, 0.18 + hash(i) * 0.2, 4).color(i % 3 ? raw : wood).pbr(0.9).rot(hash(i + 1) * 40 - 20, 0, hash(i + 2) * 50 - 25).at((hash(i + 3) - 0.5) * 0.4, 0.08, (hash(i + 4) - 0.5) * 0.1));
    return B.part();
  };
  const embers = () => {
    const B = new SB(), pts = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, r = 0.45 * (0.6 + 0.5 * hash(i * 3 + 9)); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    B.h(H.extrude(pts, 0.01, 0.002).color(0x2a1208).pbr(1).glow(0).shade((x, y) => (noise3(x * 10, y * 10, 1) > 0.55 ? [1.0, 0.32, 0.05] : null)));
    B.h(H.extrude(pts.map(([x, y]) => [x * 0.5, y * 0.5]), 0.012, 0.002).color(0xff6a1a).glow(1.6).at(0, 0, 0.008));
    for (let i = 0; i < 5; i++) B.h(H.cone(0.05 + hash(i) * 0.04, 0.25 + hash(i + 1) * 0.3, 7).color(i % 2 ? 0xff8a2a : 0xffc860).glow(2.2).rot(-90, 0, 0).at((hash(i + 2) - 0.5) * 0.5, (hash(i + 3) - 0.5) * 0.4, 0.12));
    return B.part();
  };
  const o = { res: 40, ao: 0.3 };
  dmgPieces = {
    hole: [0, 1, 2].map((s) => sculptL(`dmghole${s}`, hole(s * 17 + 3), o)),
    breach: sculptL('dmgbreach', breach, o),
    scorch: [0, 1].map((s) => sculptL(`dmgscorch${s}`, scorch(s * 31 + 5), o)),
    splinters: sculptL('dmgsplinters', splinters, o),
    embers: sculptL('dmgembers', embers, o),
  };
  return dmgPieces;
}

/** the overlay of one damage level for a design, built on the starboard (+z) beam; the port beam mirrors it */
function overlayKit(c, level) {
  const P = damagePieces(), K = new Kit(), dy = c.dy, L = c.L, id = c.def.id;
  let seed = 0; for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) % 9973;
  const rnd = (k) => hash(seed + level * 101 + k);
  const xa = c.sternX + L * 0.12, xb = c.bowX - L * 0.18;
  // laid on the hull's skin: turned to its normal (along and up the side), sunk a little so the edges bite
  const onSide = (s, x, y, geo, sc, k) => {
    const z = c.sideZ(x, y), fx = (c.sideZ(x + 0.1, y) - c.sideZ(x - 0.1, y)) / 0.2, fy = (c.sideZ(x, y + 0.1) - c.sideZ(x, y - 0.1)) / 0.2;
    _n.set(-fx, -fy, 1).normalize(); if (s < 0) _n.z = -_n.z;
    _q.setFromUnitVectors(_z, _n).multiply(_q2.setFromAxisAngle(_z, rnd(k) * 6.28));
    _e.setFromQuaternion(_q, 'XYZ');
    K.push(x, y, s * (z - 0.01 * sc), _e.x, _e.y, _e.z); K.add(geo, 0xffffff, 0, 0, 0, { s: sc }); K.pop();
  };
  const onDeck = (x, z, geo, sc, k) => { const y = c.deckAt(x, z) + 0.012; K.push(x, y, z, -Math.PI / 2, 0, rnd(k) * 6); K.add(geo, 0xffffff, 0, 0, 0, { s: sc }); K.pop(); };
  const lo = Math.max(0.2, dy * 0.45), hi = Math.max(lo + 0.1, dy * 0.9);
  const k = clamp(dy * 0.42, 0.45, 1.25);
  if (level === 1) {
    for (let i = 0; i < 10; i++) onSide(i < 7 ? 1 : -1, lerp(xa, xb, rnd(i)), lerp(lo, hi, rnd(i + 20)), P.hole[i % 3], k * (0.8 + rnd(i + 40) * 0.5), i);
    for (let i = 0; i < 4; i++) onDeck(lerp(xa, xb, rnd(i + 60)), (rnd(i + 70) - 0.5) * c.B * 0.5, P.scorch[i % 2], k * (0.7 + rnd(i + 80) * 0.6), i + 60);
    for (let i = 0; i < 3; i++) onSide(1, lerp(xa, xb, rnd(i + 300)), lerp(lo, hi, rnd(i + 310)), P.scorch[i % 2], k * 0.9, i + 300);
    for (let i = 0; i < 2; i++) { const x = lerp(xa, xb, rnd(i + 90)), z = c.hw(x) - 0.05; K.push(x, c.deckAt(x, z) + 0.25, z); K.add(P.splinters, 0xffffff, 0, 0, 0, { s: k }); K.pop(); }
  } else if (level === 2) {
    for (let i = 0; i < 3; i++) onSide(i < 2 ? 1 : -1, lerp(xa, xb, 0.2 + rnd(i) * 0.6), lerp(lo, hi, 0.35 + rnd(i + 20) * 0.3), P.breach, k * (0.9 + rnd(i + 40) * 0.4), i + 5);
    for (let i = 0; i < 5; i++) onSide(i < 3 ? 1 : -1, lerp(xa, xb, rnd(i + 120)), lerp(lo, hi, rnd(i + 140)), P.hole[i % 3], k, i + 9);
    for (let i = 0; i < 5; i++) onDeck(lerp(xa, xb, rnd(i + 160)), (rnd(i + 170) - 0.5) * c.B * 0.6, P.scorch[i % 2], k * (1 + rnd(i + 180) * 0.7), i + 160);
    for (let i = 0; i < 3; i++) { const x = lerp(xa, xb, rnd(i + 190)), z = (i % 2 ? -1 : 1) * (c.hw(x) - 0.05); K.push(x, c.deckAt(x, z) + 0.25, z); K.add(P.splinters, 0xffffff, 0, 0, 0, { s: k * 1.3 }); K.pop(); }
  } else {
    for (let i = 0; i < 4; i++) onSide(i % 2 ? -1 : 1, lerp(xa, xb, 0.1 + rnd(i) * 0.8), i === 0 ? Math.max(0.12, dy * 0.18) : lerp(lo, hi, rnd(i + 20)), P.breach, k * (1.1 + rnd(i + 40) * 0.4), i + 15);
    for (let i = 0; i < 6; i++) onDeck(lerp(xa, xb, rnd(i + 200)), (rnd(i + 210) - 0.5) * c.B * 0.6, i < 3 ? P.embers : P.scorch[i % 2], k * (1.1 + rnd(i + 220) * 0.6), i + 200);
  }
  return K;
}
/** the fire overlay (embers on deck and side), shown with fire from level 2 */
function fireKit(c) {
  const P = damagePieces(), K = new Kit(), k = clamp(c.B * 0.35, 0.7, 1.4);
  for (let i = 0; i < 4; i++) { const x = lerp(c.sternX + c.L * 0.15, c.bowX - c.L * 0.2, hash(i * 7 + 3)), z = (hash(i + 11) - 0.5) * c.B * 0.5; K.push(x, c.deckAt(x, z) + 0.015, z, -Math.PI / 2, 0, i); K.add(P.embers, 0xffffff, 0, 0, 0, { s: k }); K.pop(); }
  return K;
}

/** where her masts stand: her own rig's, else found in the hull (columns of geometry on the centre line, high up) */
function findMasts(m, ctx) {
  const out = (ctx.masts || []).map((t) => ({ x: t.x, own: true, span: t.span || 0.8 }));
  const hull = m.getObjectByName('ship'), geos = m.userData.lod?.meshes?.[0]?.geos;
  const geo = hull ? (geos ? geos[geos.length - 1] : hull.geometry) : null;
  if (!geo || out.length) return out;
  // a mast is a tall thin column on the centre line: bins along her length that hold geometry over most of the height
  const P = geo.attributes.position.array, dy = ctx.dy, top = ctx.top, bin = 0.25, x0 = ctx.sternX - 1, NB = Math.ceil((ctx.bowX - x0 + 1) / bin);
  const lo = new Float32Array(NB).fill(1e9), hi = new Float32Array(NB).fill(-1e9), cnt = new Uint32Array(NB);
  for (let i = 0; i < P.length; i += 3) {
    const y = P[i + 1]; if (y < dy + 0.8 || Math.abs(P[i + 2]) > 0.16) continue;
    const b = Math.floor((P[i] - x0) / bin); if (b < 0 || b >= NB) continue;
    cnt[b]++; if (y < lo[b]) lo[b] = y; if (y > hi[b]) hi[b] = y;
  }
  const need = (top - dy - 0.8) * 0.55, cand = [];
  for (let b = 0; b < NB; b++) if (cnt[b] >= 6 && hi[b] - lo[b] > need) cand.push([x0 + (b + 0.5) * bin, hi[b] - lo[b] + cnt[b] * 0.002, hi[b]]);
  cand.sort((a, b) => b[1] - a[1]);
  for (const [x, , h] of cand) if (!out.some((o) => Math.abs(o.x - x) < Math.max(0.9, ctx.L * 0.08))) out.push({ x, own: false, span: 0.8, h });
  return out.sort((a, b) => a.x - b.x);
}

/**
 * splitGeo, remembered per source geometry and cut: every ship of a design shares her pristine geometry, so the
 * second ship (and the second visit to a level) costs nothing. The charring only depends on the level (and at level
 * 2 on the beam that was hit), the pieces on where the masts break.
 */
const SPLITS = new WeakMap();
function splitCached(g, broken, level, side, fire, top, wantChar) {
  let m = SPLITS.get(g);
  if (!m) SPLITS.set(g, (m = new Map()));
  const cut = broken.map((q) => `${q.x.toFixed(2)},${q.cutY.toFixed(2)},${q.x0 > -1e8 ? q.x0.toFixed(2) : '-'},${q.x1 < 1e8 ? q.x1.toFixed(2) : '-'}`).join(';');
  const ch = wantChar && level >= 2 ? (level >= 3 ? '3' : `2|${side}`) : 'n';
  const k = `${cut}|${ch}|${top.toFixed(2)}`;
  if (!m.has(k)) { m.set(k, splitGeo(g, broken, level, side, fire, top, wantChar)); if (m.size > 24) m.delete(m.keys().next().value); }
  return m.get(k);
}
/** split an indexed geometry: triangles a mast takes go to its piece; the rest stay (colours charred to level) */
function splitGeo(g, broken, level, side, fire, top, wantChar) {
  const P = g.attributes.position.array, I = g.index ? g.index.array : null, n = I ? I.length : P.length / 3;
  const keep = [], pieces = broken.map(() => []);
  for (let t = 0; t < n; t += 3) {
    const a = I ? I[t] : t, b = I ? I[t + 1] : t + 1, c = I ? I[t + 2] : t + 2;
    const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
    let k = -1;
    for (let i = 0; i < broken.length; i++) { const q = broken[i]; if (cy > q.cutY && cx >= q.x0 && cx < q.x1) { k = i; break; } }
    (k < 0 ? keep : pieces[k]).push(a, b, c);
  }
  const mk = (idx, char) => {
    const o = new THREE.BufferGeometry();
    for (const [name, at] of Object.entries(g.attributes)) o.setAttribute(name, at);
    if (char && g.attributes.color) o.setAttribute('color', charColours(g, level, side, fire, top));
    if (char && level >= 3 && g.attributes.aPbr) o.setAttribute('aPbr', emberPbr(g, fire || level >= 3));
    const big = g.attributes.position.count > 65535;
    o.setIndex(new THREE.BufferAttribute(big ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    o.boundingSphere = g.boundingSphere; o.boundingBox = g.boundingBox;
    if (!o.boundingSphere) o.computeBoundingSphere();
    return o;
  };
  return { keep: mk(keep, wantChar && level >= 2), pieces: pieces.map((p) => mk(p, false)) };
}
const CHARN = new WeakMap();
/** the char pattern's noise at every vertex, worked out once per geometry */
function charNoise(g) {
  let N = CHARN.get(g);
  if (!N) {
    const P = g.attributes.position; N = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); N[i] = noise3(x * 1.3 + 7, y * 1.6, z * 1.3) * 0.8 + noise3(x * 5, y * 5, z * 5) * 0.2; }
    CHARN.set(g, N);
  }
  return N;
}
function charColours(g, level, side, fire, top) {
  const P = g.attributes.position, C0 = g.attributes.color, out = new Float32Array(C0.count * 3), NZ = charNoise(g);
  const amt = level >= 3 ? 0.92 : 0.8, cover = level >= 3 ? 0.4 : 0.55;
  for (let i = 0; i < C0.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let r = C0.getX(i), gg = C0.getY(i), b = C0.getZ(i);
    if (y < top * 0.6 && (level >= 3 || z * side > -0.2)) {
      const n = NZ[i];
      if (n > cover - 0.08) {
        const f = clamp((n - cover) * 4, 0, 1) * amt, e = clamp((n - cover + 0.08) * 8, 0, 1) * (1 - f) * 0.5; // char, and a scorched brown fringe
        r = lerp(lerp(r, 0.16, e), 0.028, f); gg = lerp(lerp(gg, 0.075, e), 0.022, f); b = lerp(lerp(b, 0.03, e), 0.018, f);
      }
    }
    out[i * 3] = r; out[i * 3 + 1] = gg; out[i * 3 + 2] = b;
  }
  return new THREE.BufferAttribute(out, 3);
}
function emberPbr(g, on) {
  const P = g.attributes.position, A = g.attributes.aPbr, out = new Float32Array(A.array);
  if (on) for (let i = 0; i < A.count; i++) { const n = noise3(P.getX(i) * 2.2 + 3, P.getY(i) * 2.2, P.getZ(i) * 2.2); if (n > 0.8) { out[i * 3] = 1; out[i * 3 + 2] = 0.5; } }
  return new THREE.BufferAttribute(out, 3);
}

function wireDamage(m, ctx) {
  const ud = m.userData, def = ctx.def;
  const hullSet = typeof ud.setDamage === 'function' ? ud.setDamage : null;
  const bp = (ud.breakParts ||= []);
  for (const b of ctx.breakable || []) bp.push({ mesh: b.mesh, at: [b.mesh.position.x, b.mesh.position.y, b.mesh.position.z], kind: b.kind });
  const lift = ctx.lift || 0, lod = () => ud.lod;
  const masts = findMasts(m, ctx);
  // the Voronoi cell of each mast along her length
  masts.forEach((q, i) => { q.x0 = i ? (masts[i - 1].x + q.x) / 2 : -1e9; q.x1 = i < masts.length - 1 ? (q.x + masts[i + 1].x) / 2 : 1e9; });
  const overlays = [null, null, null, null], fireG = { g: null };
  const keyBase = `${def.id}|${profKey(ctx.prof)}`; // overlays and cuts do not depend on her side's colour
  const addOverlay = (kitFn, key) => {
    let geos = OVER.get(key);
    if (!geos) { geos = kitFn().levels(key); OVER.set(key, geos); if (OVER.size > 300) OVER.delete(OVER.keys().next().value); }
    // shown straight at her current level (no stand-in level built first); finer levels are meshed when she is drawn closer
    const g = new THREE.Group(), mesh = new THREE.Mesh(geos[lod()?.level || 0], ctx.ghost ? ghostMaterial() : sculptMaterial());
    mesh.castShadow = true; mesh.userData.noCrew = true; mesh.userData.lodGeos = geos; mesh.userData.lodLevel = () => lod()?.level || 0;
    g.add(mesh); ctx.group.add(g);
    lod()?.meshes.push({ mesh, geos });
    return g;
  };
  const hull = m.getObjectByName('ship'), dressM = ctx.group.getObjectByName('dress'), flags = m.getObjectByName('flags');
  const hullE = hull && lod()?.meshes.find((e) => e.mesh === hull), dressE = dressM && lod()?.meshes.find((e) => e.mesh === dressM);
  const pristine = { hull: hullE?.geos, dress: dressE?.geos, flags: flags?.geometry };
  const cuts = new Map(); // `${level}|${side}|${fire}` -> state
  let state = null, cur = '';
  const swap = (e, geos) => { if (!e) return; e.geos = geos; e.mesh.userData.lodGeos = geos; const lv = lod()?.level || 0; e.mesh.geometry = geos[e.mesh.userData.pending0 ? Math.max(lv, LAZY) : lv]; };
  const makeCut = (level, side, fire) => {
    const nb = level >= 3 ? masts.length : Math.min(1, masts.length);
    const main = masts.length ? masts.reduce((b, q) => ((q.h ?? -Math.abs(q.x)) > (b.h ?? -Math.abs(b.x)) ? q : b), masts[0]) : null;
    const broken = level >= 3 ? masts.slice() : nb && main ? [main] : [];
    const deckAt = (x) => Math.max(ctx.dy, ctx.deckAt(x));
    const cutsAt = broken.map((q) => ({ ...q, cutY: level >= 3 ? deckAt(q.x) + 0.55 : deckAt(q.x) + (ctx.top - deckAt(q.x)) * 0.42 }));
    const st = { pivots: [], hull: null, dress: null, flags: null };
    if (pristine.hull && !hullSet) {
      const parts = new Map();
      const one = (g) => { if (!parts.has(g)) parts.set(g, splitCached(g, cutsAt, level, side, fire, ctx.top, true)); return parts.get(g); };
      st.hull = lazyMap(pristine.hull, (g) => one(g).keep);
      st.hullPieces = cutsAt.map((_, i) => lazyMap(pristine.hull, (g) => one(g).pieces[i]));
      if (pristine.flags) st.flags = splitCached(pristine.flags, cutsAt, level, side, fire, ctx.top, false).keep;
    }
    if (pristine.dress && cutsAt.some((q) => q.own)) {
      const own = cutsAt.map((q) => (q.own ? { ...q, x0: q.x - q.span, x1: q.x + q.span } : { ...q, cutY: 1e9 }));
      const parts = new Map();
      const one = (g) => { if (!parts.has(g)) parts.set(g, splitCached(g, own, level, side, fire, ctx.top, false)); return parts.get(g); };
      st.dress = lazyMap(pristine.dress, (g) => one(g).keep);
      st.dressPieces = own.map((_, i) => lazyMap(pristine.dress, (g) => one(g).pieces[i]));
    }
    // the broken tops: swung about the break, hanging over the side (2) or down alongside (3)
    cutsAt.forEach((q, i) => {
      const piv = new THREE.Group(); piv.position.set(q.x, q.cutY + lift, 0); piv.name = 'brokenMast';
      const fall = level >= 3 ? (i % 2 ? -side : side) : side;
      piv.rotation.set(fall * (level >= 3 ? 1.5 : 1.12), 0, level >= 3 ? 0.1 * (i - 1) : -0.18);
      if (level >= 3) piv.position.y = Math.max(ctx.dy * 0.7, q.cutY - 0.8) + lift;
      for (const [arr] of [[st.hullPieces?.[i]], [st.dressPieces?.[i]]]) {
        if (!arr) continue;
        // its geometry is set when the state is applied, at her current level only
        const mesh = new THREE.Mesh(undefined, hull?.material || sculptMaterial());
        mesh.castShadow = true; mesh.userData.noCrew = true; mesh.userData.lodGeos = arr;
        mesh.userData.lodLevel = () => lod()?.level || 0;
        mesh.position.set(-q.x, -q.cutY, 0);
        piv.add(mesh);
      }
      if (piv.children.length) st.pivots.push({ piv, q });
    });
    return st;
  };
  const apply = (st) => {
    if (state === st) return;
    if (state) for (const { piv } of state.pivots) { piv.removeFromParent(); for (const c of piv.children) { const e = lod()?.meshes.findIndex((x) => x.mesh === c); if (e >= 0) lod().meshes.splice(e, 1); } const i = bp.findIndex((b) => b.mesh === piv); if (i >= 0) bp.splice(i, 1); }
    state = st;
    swap(hullE, st?.hull || pristine.hull);
    swap(dressE, st?.dress || pristine.dress);
    if (flags && pristine.flags) flags.geometry = st?.flags || pristine.flags;
    if (st) for (const { piv, q } of st.pivots) {
      m.add(piv);
      for (const c of piv.children) { lod()?.meshes.push({ mesh: c, geos: c.userData.lodGeos }); c.geometry = c.userData.lodGeos[lod()?.level || 0]; }
      bp.push({ mesh: piv, at: [q.x, q.cutY + lift, 0], kind: 'mast' });
    }
  };
  const listOf = (lv, side) => (lv >= 3 ? 0.11 : lv >= 2 ? 0.045 : 0) * side;
  const setList = (a) => {
    ud.list = a;
    if (hull) hull.rotation.x = a;
    if (flags) flags.rotation.x = a;
    ctx.group.rotation.x = a;
    if (state) for (const { piv } of state.pivots) piv.userData.list = a;
  };
  ud.setDamage = (level, info = {}) => {
    level = clamp(level | 0, 0, 3);
    const side = info.side === -1 ? -1 : 1, fire = !!info.fire && level >= 2;
    const tag = `${level}|${level ? side : 0}|${fire ? 1 : 0}`;
    if (tag === cur) return;
    cur = tag;
    const PR = globalThis.__dmgProf, pt = PR ? performance.now() : 0, lap = PR ? (k, t0) => { PR[k] = (PR[k] || 0) + performance.now() - t0; return performance.now(); } : null;
    let tt = pt;
    if (hullSet) { try { hullSet(level, info); } catch (err) { console.warn('[shipParts] hull setDamage', err); } }
    if (PR) tt = lap('hull', tt);
    for (const f of ud.partDamage || []) { try { f(level, info); } catch (err) { console.warn('[shipParts] partDamage', err); } }
    if (PR) tt = lap('parts', tt);
    for (const f of ctx.damageFns || []) { try { f(level, info); } catch (err) { console.warn('[shipParts] damage', err); } }
    // overlays: every level up to this one, mirrored onto the beam that was hit
    for (let k = 1; k <= 3; k++) {
      if (level >= k && !overlays[k]) overlays[k] = addOverlay(() => overlayKit(ctx, k), `${keyBase}|dmg${k}`);
      if (overlays[k]) { overlays[k].visible = level >= k; overlays[k].scale.z = side; }
    }
    if (fire && !fireG.g) fireG.g = addOverlay(() => fireKit(ctx), `${keyBase}|fire`);
    if (fireG.g) fireG.g.visible = fire;
    if (PR) tt = lap('overlays', tt);
    // masts and charring
    if (level >= 2 && (masts.length || pristine.hull)) {
      const ck = `${level}|${side}|${fire ? 1 : 0}`;
      if (!cuts.has(ck)) cuts.set(ck, makeCut(level, side, fire));
      apply(cuts.get(ck));
    } else apply(null);
    if (PR) tt = lap('masts', tt);
    setList(listOf(level, side));
  };
  // the first ship of a design warms her damage in idle time: the overlay pieces, her first overlay and the hull
  // cut at a heavy hit, at the detail level she is drawn at, so the first hit in battle finds them made
  if (!WARM.has(keyBase) && !globalThis.__noDmgWarm) {
    WARM.add(keyBase);
    idle(() => {
      try {
        const lv = lod()?.level ?? LAZY, P = damagePieces();
        for (const a of [...P.hole, P.breach, ...P.scorch, P.splinters, P.embers]) void a[lv];
        const key = `${keyBase}|dmg1`;
        let geos = OVER.get(key);
        if (!geos) { geos = overlayKit(ctx, 1).levels(key); OVER.set(key, geos); }
        void geos[lv];
        if (masts.length || pristine.hull) idle(() => { try { const st = makeCut(2, 1, false); void st.hull?.[lv]; void st.dress?.[lv]; for (const a of [...(st.hullPieces || []), ...(st.dressPieces || [])]) void a[lv]; } catch (err) { void err; } });
      } catch (err) { void err; }
    });
  }
}
const WARM = new Set();
const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 300));
