// A sky-beast on a sculpted body (creatures.js): the realm's ground monster turned to face +x and scaled to sky
// size, with the realm's tack, howdah or saddle strapped to its trunk, the realm's own soldier seated at the neck,
// a throat-glow for its breath, and damage that shows as arrows, bleeding gashes, torn membranes or missing
// feathers, and a limp wing. animateSky drives it through the monster's own flight animator (A.rigMode).
import { THREE, PI, TAU, tintSet, shade, bake, group, EMPTY, hash, patch, sweep, emblem, tier, lerp } from './kit.js';
import { trophies } from './deco.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { styleOf } from './style.js';
import { decoMats } from './deco.js';
import { saddle, throat, beastActions } from './beasts.js';
import { seatedPilot } from './creatures.js';
import { cloneRigged } from '../rigkit.js';
import { S, H, buildPartGeometry } from '../sculpt.js';

const ray = new THREE.Raycaster();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const boxOf = (o, root) => {
  // bounds of o's meshes in root's space
  const b = new THREE.Box3(), inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4();
  o.traverse((c) => { if (c.isMesh && c.geometry !== EMPTY && c.name !== 'far') { if (!c.geometry.boundingBox) c.geometry.computeBoundingBox(); b.union(c.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, c.matrixWorld))); } });
  return b;
};
const partOf = (node) => node && node.children.find((c) => c.isMesh && c.name === 'part');
function cast(meshes, from, dir) { ray.set(from, dir.normalize()); ray.far = 1e4; const h = ray.intersectObjects(meshes, false); return h[0] || null; }

export function buildRigBeast(def, sideColor, spec, tpl) {
  const D = def.sky, L = D.look || {}, T = tintSet(), S0 = styleOf(def);
  const sideM = mat0(sideColor), sideDark = mat0(shade(sideColor, 0.6));
  const dm = decoMats(T, S0, sideM, sideDark);
  const C = { ...dm, body: T.t(L.body ?? 0x6a5a40), belly: T.t(L.belly ?? 0xc8b890), dark: T.t(shade(L.body ?? 0x6a5a40, 0.6)), skin: T.t(0xd2a07a), blood: T.t(0x5a0c0a) };
  const root = new THREE.Group(), B = group(root);
  const unit = cloneRigged(tpl), rig = unit.userData.rig, inner = unit.userData.inner;
  const tilt = group(B); tilt.rotation.z = -(spec.pitch || 0);
  const wrap = new THREE.Group(); wrap.rotation.y = PI / 2; tilt.add(wrap); wrap.add(unit);
  // the monster's own materials become this model's (so damage can darken it without touching the ground units)
  unit.traverse((o) => { if (o.isMesh) o.material = T.paint; });
  // size: span and length to the design's
  const far = unit.userData.lod.far;
  if (!far.geometry.boundingBox) far.geometry.computeBoundingBox();
  const fb = far.geometry.boundingBox, span = fb.max.x - fb.min.x, len = spec.pitch ? Math.max(fb.max.z - fb.min.z, fb.max.y - fb.min.y) : fb.max.z - fb.min.z;
  const k = (def.len * (spec.serpent ? 1.0 : 1.05)) / Math.max(span, len * 1.1);
  wrap.scale.setScalar(k);
  const trunkNode = rig.body && spec.pilot === false ? rig.body : rig.torso || rig.body;
  root.updateMatrixWorld(true);
  { const c = new THREE.Vector3(); trunkNode.getWorldPosition(c); wrap.position.set(-c.x * 0.6, -c.y, -c.z); }
  root.updateMatrixWorld(true);

  // ---- where the saddle sits: on top of the trunk ----
  const trunk = partOf(trunkNode);
  // probe a coarse level of the trunk (a few thousand triangles) for the placements below
  const trunkEntry = trunk && unit.userData.lod.meshes.find((e) => e.mesh === trunk);
  if (trunkEntry) trunk.geometry = trunkEntry.geos[Math.min(2, trunkEntry.geos.length - 1)];
  const tb = boxOf(trunk || trunkNode, root);
  const seatX = THREE.MathUtils.lerp(tb.min.x, tb.max.x, spec.seatU);
  const top = cast([trunk], V(seatX, tb.max.y + 5, 0), V(0, -1, 0));
  const bot = cast([trunk], V(seatX, tb.min.y - 5, 0), V(0, 1, 0));
  const ty = top ? top.point.y : tb.max.y, by = bot ? bot.point.y : tb.min.y;
  const midY = (ty + by) / 2;
  const sideH = cast([trunk], V(seatX, midY, tb.max.z + 5), V(0, 0, -1));
  const halfW = sideH ? Math.abs(sideH.point.z) : (tb.max.z - tb.min.z) / 2;
  const bodyR = Math.max(0.25, (ty - by) / 2);
  const riders = Math.max(1, D.riders || 2);
  const info = { back: [seatX, ty, 0], backLen: Math.max(0.8, (tb.max.x - tb.min.x) * 0.35), backW: Math.max(0.35, halfW * 0.95), bodyR, caparison: !!spec.caparison && riders <= 2, howdah: riders >= 3 };
  const headNode = rig.head || rig.mhead;
  const hb = headNode ? boxOf(headNode, root) : null;
  if (hb) info.reins = [hb.min.x + (hb.max.x - hb.min.x) * 0.2, (hb.min.y + hb.max.y) / 2];

  // ---- tack: saddle or howdah, caparison, banner, grapnel lines (built in the sky frame, strapped to the trunk) ----
  info.drape = (cloth, Lc, AH, seatL) => drape(cloth, trunk, seatX, ty, midY, Lc, AH, C, S0, info.caparison);
  const tackRoot = new THREE.Group();
  const X = { B: tackRoot, C, S: S0, D, A: { glows: [] }, T, def, jaws: [], throat: null, glowOf: (c, kk, o = {}) => { const { flick, ...mo } = o; const m = T.glow(c, kk, mo); A.glows.push({ m, k: flick ?? 0.15, ph: A.glows.length * 1.7, op: mo.transparent ? mo.opacity : undefined }); return m; } };
  const A = { wings: [], tails: [], heads: [], spin: [], glows: [], body: B, speed: 2.6, droop: 0, hide2: [], movers: [], act: {}, legs: [], rigMode: true, unit, rig, inner, k: k * (inner.scale.y || 1), wingsOwn: spec.wingsOwn, tk: def.len >= 8 ? 0.55 : 0.7, phase: hash(def.id.length) * 6 };
  X.A = A;
  const { slots, len: seatLen, sides } = saddle(X, info, riders);
  const movers = [...(X.moving || [])];
  const lod = [];
  lod.push(...bake(tackRoot, movers, T));
  root.add(tackRoot); root.updateMatrixWorld(true);
  trunkNode.attach(tackRoot);

  // ---- the pilot: the realm's soldier, seated forward of the saddle ----
  const breakParts = [];
  if (spec.pilot !== false) {
    const P = seatedPilot(S0.id);
    if (P) {
      const px = Math.min(tb.max.x - 0.2, seatX + seatLen / 2 + 0.35);
      const ph = cast([trunk], V(px, tb.max.y + 5, 0), V(0, -1, 0));
      const py = ph ? ph.point.y : ty;
      const s = 1.15 / P.height;
      const pm = new THREE.Mesh(P.geos[0], T.paint); pm.castShadow = true; pm.name = 'pilot';
      pm.scale.setScalar(s); pm.rotation.y = PI / 2;
      pm.position.set(px - P.hip[2] * s, py + 0.12 - P.hip[1] * s, P.hip[0] * s);
      root.add(pm); root.updateMatrixWorld(true); trunkNode.attach(pm);
      lod.push({ mesh: pm, geos: P.geos });
      breakParts.push({ mesh: pm, at: [px, py + 0.4, 0], kind: 'rider' });
    }
  }

  if (trunkEntry) trunk.geometry = trunkEntry.geos[0];
  // ---- breath: a throat glow in the mouth ----
  let mouth = [def.len * 0.4, 0, 0];
  if (hb) {
    mouth = [hb.max.x, hb.min.y + (hb.max.y - hb.min.y) * 0.3, (hb.min.z + hb.max.z) / 2];
    if (D.arts?.breath && headNode) {
      const holder = new THREE.Group(); root.add(holder);
      const hp = group(holder, mouth[0] - 0.45, mouth[1], mouth[2]);
      throat(X, hp, 0, 0, 0.9);
      if (X.throat) { lod.push(...bake(holder, [X.throat], T)); root.updateMatrixWorld(true); headNode.attach(holder); }
      else root.remove(holder);
    }
  }
  const tails = rig.tail || rig.htails || [];
  const tailEnd = tails.length ? tails[tails.length - 1] : null;
  const tlb = tailEnd ? boxOf(tailEnd, root) : null;
  const tailTip = tlb ? [tlb.min.x, (tlb.min.y + tlb.max.y) / 2, (tlb.min.z + tlb.max.z) / 2] : [-def.len * 0.45, 0, 0];
  const feet = [...(rig.shins || []), ...(rig.hshins || [])];
  const talons = feet.length ? feet.map((f) => { const b = boxOf(f, root); return [+((b.min.x + b.max.x) / 2).toFixed(3), +b.min.y.toFixed(3), +((b.min.z + b.max.z) / 2).toFixed(3)]; }) : [[0, by - 0.3, 0]];
  const mid = talons.reduce((a, t) => [a[0] + t[0] / talons.length, a[1] + t[1] / talons.length, a[2] + t[2] / talons.length], [0, 0, 0]);

  // ---- level of detail: the monster's own sculpt levels, plus the tack and pilot ----
  const unitLod = unit.userData.lod;
  if (unitLod.far) unitLod.far.visible = false;
  const lodMeshes = [...unitLod.meshes, ...lod];
  root.traverse((o) => { if (o.isMesh) o.castShadow = !o.material.transparent; });
  const box = new THREE.Box3().setFromObject(root);
  // ---- damage: wounds built the first time she is hurt; torn wings swapped in ----
  const wingMeshes = [...(rig.wings || []), ...(rig.wingtips || [])].map(partOf).filter(Boolean);
  for (const w of wingMeshes) { const b = boxOf(w, root); breakParts.push({ mesh: w, at: [+((b.min.x + b.max.x) / 2).toFixed(3), +((b.min.y + b.max.y) / 2).toFixed(3), +((b.min.z + b.max.z) / 2).toFixed(3)], kind: 'wing' }); }
  for (const m of tackRoot.children.filter((c) => c.isMesh)) breakParts.push({ mesh: m, at: [seatX, ty + 0.3, 0], kind: riders >= 3 ? 'howdah' : 'saddle' });
  if (tailEnd && partOf(tailEnd)) breakParts.push({ mesh: partOf(tailEnd), at: tailTip, kind: 'tail' });
  const dmg = { level: 0, wounds: null, torn: new Map() };
  const lodRef = { meshes: lodMeshes, far: null, level: 0, levels: 6, toJSON: () => undefined };
  const swap = (entry, geos) => { entry.geos = geos; const g = geos[Math.min(lodRef.level, geos.length - 1)]; entry.mesh.visible = g !== EMPTY; if (entry.mesh.visible) entry.mesh.geometry = g; };
  root.userData = {
    skyAnim: true, anim: A, beast: D.creature, sculpted: true,
    muzzles: [[mouth[0], mouth[1], Math.max(0.25, Math.abs(mouth[2]))]],
    bombBay: [seatX - 0.4, by - 0.3, 0], hangar: [seatX - seatLen * 0.6, ty, 0],
    pods: [[0.6, by - 0.2, 0.5], [0.6, by - 0.2, -0.5], [-0.6, by - 0.2, 0.5], [-0.6, by - 0.2, -0.5]], ladders: [[seatX, ty - 0.2, -halfW], [seatX, ty - 0.2, halfW]],
    top: Math.max(box.max.y, ty + 0.9) + 0.15, radius: def.len / 2, props: [], crewSlots: slots,
    lod: lodRef,
    anchors: {
      mouth, bow: mouth, stern: tailTip, talons: mid, talonList: talons, bombBay: [seatX - 0.4, by - 0.3, 0],
      port: sides[1], starboard: sides[0], deckL: sides[1], deckR: sides[0], gondolaL: sides[1], gondolaR: sides[0], back: [seatX, ty + 0.2, 0], top: [0, box.max.y, 0],
    },
    breakParts,
    actions: beastActions(X, root),
    setSide(hex) { sideM.color.set(hex); sideDark.color.set(hex).multiplyScalar(0.6); },
    setDamage(lv, inf = {}) {
      lv = Math.max(0, Math.min(3, lv | 0));
      if (lv === dmg.level && !(inf && inf.fire && !dmg.fire)) return;
      dmg.level = lv; dmg.fire = !!(inf && inf.fire);
      T.damage(lv * 0.45);
      if (lv && !dmg.wounds) dmg.wounds = buildWounds(root, trunkNode, trunk, tb, spec, def, lodMeshes);
      if (dmg.wounds) dmg.wounds.forEach((w, i) => swap(w.entry, i < lv ? w.geos : w.off));
      // torn membranes and missing feathers from level 2, more at 3
      for (const node of [...(rig.wings || []), ...(rig.wingtips || [])]) {
        const m = partOf(node); if (!m) continue;
        const entry = lodMeshes.find((e) => e.mesh === m); if (!entry) continue;
        if (!dmg.torn.has(m)) dmg.torn.set(m, entry.geos);
        const base = dmg.torn.get(m);
        swap(entry, lv >= 2 ? tornGeos(base, lv, def.id + node.name) : base);
      }
      A.droop = lv >= 3 ? 1 : 0;
      A.limp = lv >= 2 ? (lv >= 3 ? 1 : 0.35) : 0;
    },
  };
  root.userData.setSide(sideColor);
  return root;
}
/** a saddle-cloth or caparison that lies on the beast: every point found on the trunk's own surface, with folds */
function drape(cloth, trunk, x0, y0, cy, Lc, AH, C, S0, big) {
  const ox = new THREE.Vector3(), dir = new THREE.Vector3();
  const hit = (x, a, sd) => {
    ox.set(x, cy + Math.cos(a) * 30, sd * Math.sin(a) * 30); dir.set(0, cy - ox.y, -ox.z);
    const h = cast([trunk], ox.clone(), dir.clone());
    if (!h) return null;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    return { p: h.point, n };
  };
  const nu = 12, nv = 8, grid = [];
  for (const sd of [1, -1]) {
    const G = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, a = lerp(0.02, AH, v), x = x0 + (u - 0.5) * Lc * (1 + v * 0.1);
      let h = hit(x, a, sd);
      if (!h) h = { p: new THREE.Vector3(x, cy + Math.cos(a) * 0.5, sd * Math.sin(a) * 0.5), n: new THREE.Vector3(0, Math.cos(a), sd * Math.sin(a)) };
      // folds that deepen toward the hem, and the cloth standing a little off the hide
      const fold = 0.035 * v * v * Math.sin(u * TAU * 3.5 + sd) + 0.03 + 0.02 * v;
      const p = h.p.clone().addScaledVector(h.n, fold);
      G.push([p.x - x0, p.y - y0, p.z]);
    }
    grid.push(G);
    patch(cloth, C.side, (u, v) => G[Math.round(v * nv) * (nu + 1) + Math.round(u * nu)], nu, nv);
    const hem = G.slice(nv * (nu + 1)).map((q, i) => [q[0], q[1] - 0.01, q[2]]);
    sweep(cloth, C.metal, hem.filter((_, i) => i % 2 === 0), 0.028, { n: 18, m: 5, round: 0 });
    const top = G.slice(0, nu + 1);
    sweep(cloth, C.metal, top.filter((_, i) => i % 3 === 0).map((q) => [q[0], q[1] + 0.012, q[2]]), 0.018, { n: 14, m: 4, round: 0 });
    tier(1, () => trophies(cloth, C, ['skulls', 'bells', 'tassels', 'beads'].includes(S0.trophy) ? S0.trophy : 'tassels', [2, 5, 7, 10].map((i) => hem[i]), 0.9));
    // the realm's emblem on the flank, laid on the cloth
    tier(3, () => {
      const q = G[Math.round(nv * 0.55) * (nu + 1) + Math.round(nu / 2)], q2 = G[Math.round(nv * 0.55) * (nu + 1) + Math.round(nu / 2) + 1], q3 = G[Math.round(nv * 0.55 + 1) * (nu + 1) + Math.round(nu / 2)];
      const t1 = new THREE.Vector3(...q2).sub(new THREE.Vector3(...q)), t2 = new THREE.Vector3(...q3).sub(new THREE.Vector3(...q)), nn = new THREE.Vector3().crossVectors(t1, t2).normalize().multiplyScalar(sd);
      const g = group(cloth, q[0] + nn.x * 0.02, q[1] + nn.y * 0.02, q[2] + nn.z * 0.02); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nn);
      emblem(g, C.metal, S0.emblem, big ? 0.5 : 0.36, 0.03);
    });
  }
}
function mat0(c) { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }); m.userData.keep = true; return m; }

// ---------------------------------------------------------------------------------------------
// damage pieces: arrows and bolts stuck in the hide, bleeding gashes; torn wings
// ---------------------------------------------------------------------------------------------
const GEO = new Map();
const cachedGeo = (key, make) => { if (!GEO.has(key)) GEO.set(key, make()); return GEO.get(key); };
/** an arrow along +Y from its head (buried, at the origin) to the fletching, sculpted shaft and fletching */
const arrowGeo = (lv) => cachedGeo(`arrow${lv}`, () => buildPartGeometry({ prims: [], hard: [
  H.cyl(0.012, 0.012, 0.9, 6).at(0, 0.45, 0).color(0x6a4a2a).pbr(0.8),
  H.cone(0.02, 0.06, 5).at(0, 0.03, 0).color(0x3a3a3e).pbr(0.4, 0.8),
  ...[0, 120, 240].map((a) => H.extrude([[0, 0], [0.05, 0.03], [0.05, 0.2], [0, 0.17]], 0.004, 0).rot(0, a, 0).at(0, 0.7, 0).color(a ? 0xe8e0d0 : 0x8a1a14).pbr(0.9)),
] }, { res: 40, lod: lv, ao: 0 }));
/** a ragged wound: a raised lip of torn hide around a deep red cut, blood running from it (normal along +Y) */
const gashGeo = (skin, lv) => cachedGeo(`gash${skin}:${lv}`, () => buildPartGeometry({ prims: [
  S.ellipsoid(0.22, 0.05, 0.07).color(skin).pbr(0.7).bump(0.01, 30, 'noise'),
  S.ellipsoid(0.18, 0.08, 0.035).at(0, 0.03, 0).color(0x3a0606).pbr(0.25).cut(0.012),
  S.ellipsoid(0.16, 0.02, 0.03).at(0, -0.01, 0).color(0x7a0e0c).pbr(0.2).paint(0.01),
  S.capsule([0.05, 0.01, 0.04], [0.1, -0.01, 0.24], 0.022, 0.01).color(0x6a0a08).pbr(0.2).blend(0.02),
  S.capsule([-0.06, 0.01, 0.04], [-0.08, -0.01, 0.17], 0.018, 0.008).color(0x6a0a08).pbr(0.2).blend(0.02),
] }, { res: [90, 50, 26][lv] ?? 26, ao: 0.4 }));

function buildWounds(root, trunkNode, trunk, tb, spec, def, lodMeshes) {
  // sample the trunk from the sides and above; level 1 gets a few arrows, 2 adds gashes, 3 a pin-cushion
  const sets = [[], [], []];
  const skin = 0xb87060;
  const inv = new THREE.Matrix4();
  trunkNode.updateMatrixWorld(true); root.updateMatrixWorld(true);
  inv.copy(trunkNode.matrixWorld).invert().multiply(root.matrixWorld);
  const nInv = new THREE.Matrix3().getNormalMatrix(inv);
  let n = 0;
  for (let i = 0; i < 26; i++) {
    const u = hash(i * 7.31 + 1), side = i % 2 ? 1 : -1, up = hash(i * 3.7 + 2);
    const x = THREE.MathUtils.lerp(tb.min.x, tb.max.x, 0.15 + 0.7 * u);
    const from = V(x, THREE.MathUtils.lerp(tb.min.y, tb.max.y + 1, up), side * (tb.max.z + 4));
    const h = cast([trunk], from, V(0, (tb.min.y + tb.max.y) / 2 - from.y, -from.z));
    if (!h) continue;
    const p = h.point.clone(), nrm = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    // into the trunk's own space
    const lp = p.clone().applyMatrix4(inv), ln = nrm.clone().applyMatrix3(nInv).normalize();
    const tier = n < 5 ? 0 : n < 12 ? 1 : 2; n++;
    const gash = i % 3 === 1;
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), gash ? ln : ln.clone().add(V(-0.4, 0.3, 0).applyMatrix3(nInv)).normalize());
    if (gash) q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), hash(i) * PI));
    sets[tier].push({ gash, M: new THREE.Matrix4().compose(lp, q, V(1, 1, 1)) });
  }
  // inherit the trunk mesh's world scale so the pieces are sized in sky units
  const ws = new THREE.Vector3(); trunkNode.getWorldScale(ws); const rs = new THREE.Vector3(); root.getWorldScale(rs);
  const kk = rs.x / ws.x;
  const out = [];
  sets.forEach((list, ti) => {
    const geos = [0, 1, 2].map((lv) => {
      const parts = list.map(({ gash, M }) => {
        const g = (gash ? gashGeo(skin, lv) : arrowGeo(Math.min(lv, 1))).clone();
        const Mk = M.clone(); const s = new THREE.Vector3(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(); Mk.decompose(pp, qq, s);
        const f = kk * (gash ? 1.3 : 0.9); Mk.compose(pp, qq, V(f, f, f));
        g.applyMatrix4(Mk);
        if (!(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
        return g;
      });
      return parts.length ? mergeGeometries(parts, false) : EMPTY;
    });
    const m = new THREE.Mesh(EMPTY, trunk.material); m.visible = false; m.castShadow = true; m.name = 'wounds';
    trunkNode.add(m);
    const entry = { mesh: m, geos: [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY] };
    lodMeshes.push(entry);
    out.push({ entry, geos: [geos[0], geos[1], geos[2], EMPTY, EMPTY, EMPTY], off: entry.geos });
  });
  void spec; void def;
  return out;
}

/** the wing with holes torn through it: triangles inside a few ragged spheres are dropped (same holes at every level) */
const TORN = new Map();
function tornGeos(geos, lv, seed) {
  const key = geos[0].uuid + ':' + lv;
  if (TORN.has(key)) return TORN.get(key);
  const g0 = geos[0];
  if (!g0.boundingBox) g0.computeBoundingBox();
  const bb = g0.boundingBox, size = bb.getSize(V(0, 0, 0)), diag = size.length();
  const P0 = g0.attributes.position;
  const holes = [];
  const nh = lv >= 3 ? 6 : 3;
  let s = 0; for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) % 9973;
  for (let i = 0; i < nh; i++) {
    const vi = Math.floor(hash(s + i * 13.1) * P0.count);
    holes.push([P0.getX(vi), P0.getY(vi), P0.getZ(vi), diag * (lv >= 3 ? 0.11 : 0.08) * (0.6 + 0.8 * hash(s + i * 5.7))]);
  }
  const cut = (g) => {
    if (!g || g === EMPTY || !g.index) return g;
    const P = g.attributes.position, I = g.index.array, keep = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const cx = (P.getX(a) + P.getX(b) + P.getX(c)) / 3, cy = (P.getY(a) + P.getY(b) + P.getY(c)) / 3, cz = (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3;
      let inside = false;
      for (const [hx, hy, hz, r] of holes) {
        const d = Math.hypot(cx - hx, cy - hy, cz - hz), rag = r * (0.75 + 0.5 * Math.sin(cx * 41 + cy * 37 + cz * 29));
        if (d < rag) { inside = true; break; }
      }
      if (!inside) keep.push(a, b, c);
    }
    const out = g.clone();
    out.setIndex(new THREE.BufferAttribute(P.count > 65535 ? new Uint32Array(keep) : new Uint16Array(keep), 1));
    return out;
  };
  const res = geos.map(cut);
  TORN.set(key, res);
  return res;
}
