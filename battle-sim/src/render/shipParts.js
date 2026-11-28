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
import { buildShip } from './models.js';
import { sculptMaterial } from './sculpt.js';
import { Kit, clamp } from './parts/kit.js';
import { HULL_PARTS, SAIL_STYLES, buildRig, nativeSail, OAR_KINDS } from './parts/hull.js';
import { BOW_PARTS } from './parts/bow.js';
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
  const surf = xs.map((x) => zs.map((z) => {
    _o.set(x, top + 2, z); if (!geo) _o.applyMatrix4(m.matrixWorld);
    ray.set(_o, DOWN); ray.far = top + 6;
    const hits = ray.intersectObjects(targets, false);
    for (const h of hits) {
      const p = inv ? h.point.clone().applyMatrix4(inv) : h.point;
      if (!h.face || h.face.normal.y < 0.5) continue;
      if (p.y > Math.max(top * 0.42, 2.2) || p.y < -0.3) continue;
      return p.y;
    }
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
  const prof = { xs, surf, dy, half, halfLo, bowX, sternX, top };
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
  const ctx = {
    m, def, L, B, side: sideColor, dy,
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
    addMoving(obj, fn) { obj.traverse((o) => { o.userData.noCrew = true; if (o.isMesh) o.castShadow = true; }); ctx.group.add(obj); if (fn) ctx.fx.push(fn); return obj; },
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
          const y = ctx.deckAt(x, z), clutter = Math.max(0, y - ctx.floorAt(x) - 0.25);
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

  // 3. hang it on the model
  if (!ctx.kit.empty) ctx.group.add(ctx.kit.mesh());
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
  return ctx.keep;
}

/** per-frame motion for the parts that move (towed beasts swimming, turrets, wheels, glows) */
export function animateDesign(m, t) {
  const fx = m.userData.designFx;
  if (!fx) return;
  const ph = m.userData.phase || 0;
  for (let i = 0; i < fx.length; i++) fx[i](t, ph);
}
