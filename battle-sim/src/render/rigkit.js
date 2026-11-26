// Turns a body description into a jointed, cloneable model with detail levels.
//
// A description is { kind, attack, nodes: [...] }. Each node is one rigid piece
// that pivots about its own origin:
//   { name, parent, pos: [x,y,z], rot: [degX,degY,degZ], rig: 'legs', prims: [...], hard: [...], detail: 1 }
// `rig` files the node under that key so animators can find it (see animate.js).
// Every node is meshed once per detail level; clones share the geometry and a
// model swaps levels as the camera moves. The last level is a single merged
// mesh in the rest pose, so a distant soldier costs one draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPartGeometry, sculptMaterial } from './sculpt.js';

/** sculpt resolution (cells per model unit) for each detail level, closest first */
export const DETAIL = {
  low: [44, 24, 13],
  medium: [64, 34, 17],
  high: [96, 50, 26, 14],
  ultra: [144, 76, 38, 18],
};
let detailKey = 'high';
export const getDetail = () => detailKey;
export function setDetail(k) { if (DETAIL[k]) detailKey = k; }

const DEG = Math.PI / 180;
const lodTable = new Map();   // level-0 geometry uuid -> [geometry per level]
const rigOf = new WeakMap();  // template -> rig description (names only)
const EMPTY = new THREE.BufferGeometry(); // stands for "nothing to draw at this level"
EMPTY.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
const SINGLE = new Set(['torso', 'head', 'jaw', 'neck', 'core', 'body', 'log', 'turret']);

export function assemble(desc, scale = 1) {
  const levels = DETAIL[detailKey];
  const outer = new THREE.Group(), inner = new THREE.Group();
  inner.scale.setScalar(scale);
  outer.add(inner);
  const groups = new Map();
  const rig = { kind: desc.kind || 'biped', attack: desc.attack || 'swing', v2: true };
  // plain values on the description (hold, variant, ...) ride along for animators
  for (const [k, v] of Object.entries(desc)) if (!(k in rig) && k !== 'nodes' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) rig[k] = v;
  const mat = sculptMaterial();
  const farParts = [];

  for (const node of desc.nodes) {
    const g = new THREE.Group();
    g.position.set(...(node.pos || [0, 0, 0]));
    if (node.rot) g.rotation.set(node.rot[0] * DEG, node.rot[1] * DEG, node.rot[2] * DEG);
    if (node.parent && !groups.has(node.parent)) throw new Error(`node "${node.name}" lists unknown parent "${node.parent}" (parents must come first)`);
    (node.parent ? groups.get(node.parent) : inner).add(g);
    groups.set(node.name, g);
    if (node.rig) {
      if (SINGLE.has(node.rig)) { rig[node.rig] = g; g.name = `rig:${node.rig}`; }
      else { (rig[node.rig] ||= []).push(g); g.name = `rig:${node.rig}:${rig[node.rig].length - 1}`; }
    }
    const geos = [];
    for (let li = 0; li < levels.length; li++) {
      // minRes keeps thin limbs from slipping between sample points on the coarse levels
      geos.push(buildPartGeometry(node, { res: Math.max(levels[li] * (node.detail || 1), node.minRes || 0), lod: li, levels: levels.length }));
    }
    if (!geos[0]) continue;
    // a sculpt too thin for a coarse level borrows the level before it; a node whose hard pieces
    // have all dropped out at that level is simply not drawn there
    const sculpted = (node.prims || []).flat(Infinity).length > 0;
    for (let li = 1; li < geos.length; li++) if (!geos[li]) geos[li] = sculpted ? geos[li - 1] : EMPTY;
    const mesh = new THREE.Mesh(geos[0], mat);
    mesh.castShadow = true;
    mesh.name = 'part';
    g.add(mesh);
    lodTable.set(geos[0].uuid, geos);
    if (geos[geos.length - 1] !== EMPTY) farParts.push({ g, geo: geos[geos.length - 1] });
  }

  // far level: everything merged in the rest pose
  outer.updateMatrixWorld(true);
  const invInner = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  const merged = mergeGeometries(farParts.map(({ g, geo }) => geo.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(invInner, g.matrixWorld))), false);
  let height = 1;
  if (merged) {
    const far = new THREE.Mesh(merged, mat);
    far.castShadow = true; far.visible = false; far.name = 'far';
    inner.add(far);
    merged.computeBoundingBox();
    height = merged.boundingBox.max.y * scale;
  }
  rig.levels = levels.length + 1;
  rig.height = height;
  rigOf.set(outer, rig);
  return outer;
}

/** an independent, animatable copy of a template (geometry and material are shared) */
export function cloneRigged(tpl) {
  const c = tpl.clone(true);
  const src = rigOf.get(tpl), rig = {};
  for (const [k, v] of Object.entries(src)) rig[k] = Array.isArray(v) ? [] : v?.isObject3D ? null : v;
  const lod = { meshes: [], far: null, level: 0, levels: src.levels };
  c.traverse((o) => {
    if (o.name.startsWith('rig:')) {
      const [, k, i] = o.name.split(':');
      if (i !== undefined) rig[k][+i] = o; else rig[k] = o;
      o.userData.rest = [o.rotation.x, o.rotation.y, o.rotation.z, o.position.x, o.position.y, o.position.z];
    } else if (o.name === 'far') lod.far = o;
    else if (o.isMesh && lodTable.has(o.geometry.uuid)) lod.meshes.push({ mesh: o, geos: lodTable.get(o.geometry.uuid) });
  });
  c.userData = { rig, inner: c.children[0], lod };
  return c;
}

/** switch a model to detail level n (0 = closest; the last level is the merged far mesh) */
export function setLod(model, n) {
  const lod = model.userData.lod;
  if (!lod) return;
  n = Math.max(0, Math.min(lod.levels - 1, n));
  if (n === lod.level) return;
  const far = n === lod.levels - 1 && lod.far;
  for (const { mesh, geos } of lod.meshes) {
    const geo = geos[Math.min(n, geos.length - 1)];
    mesh.visible = !far && geo !== EMPTY;
    if (mesh.visible) mesh.geometry = geo;
  }
  if (lod.far) lod.far.visible = !!far;
  lod.level = n;
}

/** triangle count of a model at each detail level */
export function triangleStats(model) {
  const lod = model.userData.lod;
  if (!lod) return [];
  const out = [];
  for (let n = 0; n < lod.levels - 1; n++) {
    let t = 0;
    for (const { geos } of lod.meshes) { const g = geos[Math.min(n, geos.length - 1)]; if (g !== EMPTY) t += (g.index ? g.index.count : g.attributes.position.count) / 3; }
    out.push(Math.round(t));
  }
  if (lod.far) out.push(Math.round((lod.far.geometry.index ? lod.far.geometry.index.count : lod.far.geometry.attributes.position.count) / 3));
  return out;
}

/**
 * One static geometry of a model as it is posed right now, at a coarse detail level. Used for
 * the fallen: a body costs one draw call and every body of that unit type shares the geometry.
 */
export function bakePose(model, level = 2) {
  const lod = model.userData.lod;
  if (!lod || !lod.meshes.length) return null;
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const parts = [];
  for (const { mesh, geos } of lod.meshes) {
    const g = geos[Math.min(level, geos.length - 1)];
    if (!g || g === EMPTY) continue;
    const c = g.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    if (!(c.index.array instanceof Uint32Array)) c.setIndex(new THREE.BufferAttribute(Uint32Array.from(c.index.array), 1));
    parts.push(c);
  }
  return parts.length ? mergeGeometries(parts, false) : null;
}
