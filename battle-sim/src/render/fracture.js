// Breaks a building into chunks. The cell pattern comes from three-pinata's Voronoi fracture of the
// building's bounding block (loaded from the CDN; a seeded scatter stands in if it cannot load). The
// building's own surface, with its colours and finishes, is then dealt out to the nearest cell, and
// each cell's solid from the library becomes the rough core that shows where a chunk has broken away.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let pinata = null, tried = false;
export async function loadFracture() {
  if (tried) return;
  tried = true;
  try { pinata = await import('@dgreenheck/three-pinata'); } catch (err) { console.info('fracture library unavailable; using scattered cells', err?.message || err); }
}

function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** cells filling a box: [{ c: centre, core: BufferGeometry | null }] in the box's own space */
function cells(box, count, seed) {
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  if (pinata) {
    try {
      const block = new pinata.DestructibleMesh(new THREE.BoxGeometry(size.x, size.y, size.z, 2, 2, 2), new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());
      const frags = block.fracture(new pinata.FractureOptions({ fractureMethod: 'voronoi', fragmentCount: count, voronoiOptions: { mode: '3D' }, seed }));
      const out = [];
      for (const f of frags) {
        f.updateMatrix();
        const g = f.geometry.clone().applyMatrix4(f.matrix).translate(mid.x, mid.y, mid.z);
        g.computeBoundingBox();
        const c = g.boundingBox.getCenter(new THREE.Vector3());
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
        g.clearGroups();
        out.push({ c, core: g });
      }
      if (out.length >= 3) return out;
    } catch (err) { console.info('fracture failed; using scattered cells', err?.message || err); }
  }
  const r = rng(seed), out = [];
  for (let i = 0; i < count; i++) out.push({ c: new THREE.Vector3(box.min.x + r() * size.x, box.min.y + r() * size.y, box.min.z + r() * size.z), core: null });
  return out;
}

/**
 * Chunks of a model: [{ shell, core, c }] in the model's own space, or null when its meshes cannot be
 * split (no per-vertex colour and finish, as on imported or fallback models).
 */
export function fractureModel(model, meshes, count, seed) {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const box = new THREE.Box3();
  const parts = [];
  for (const mesh of meshes) {
    const g = mesh.geometry;
    if (!g.attributes.color || !g.attributes.aPbr || !g.attributes.normal) return null;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const gg = g.index ? g.toNonIndexed() : g.clone();
    gg.applyMatrix4(rel);
    gg.computeBoundingBox(); box.union(gg.boundingBox);
    parts.push(gg);
  }
  if (!parts.length || box.isEmpty()) return null;
  const list = cells(box, count, seed);
  const buckets = list.map(() => ({ p: [], n: [], c: [], m: [] }));
  for (const g of parts) {
    const P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color.array, M = g.attributes.aPbr.array;
    for (let t = 0; t < P.length; t += 9) {
      const cx = (P[t] + P[t + 3] + P[t + 6]) / 3, cy = (P[t + 1] + P[t + 4] + P[t + 7]) / 3, cz = (P[t + 2] + P[t + 5] + P[t + 8]) / 3;
      let best = 0, bd = Infinity;
      for (let k = 0; k < list.length; k++) { const c = list[k].c, d = (c.x - cx) ** 2 + (c.y - cy) ** 2 + (c.z - cz) ** 2; if (d < bd) { bd = d; best = k; } }
      const b = buckets[best];
      for (let k = 0; k < 9; k++) { b.p.push(P[t + k]); b.n.push(N[t + k]); b.c.push(C[t + k]); b.m.push(M[t + k]); }
    }
  }
  const out = [];
  list.forEach((cell, k) => {
    const b = buckets[k];
    if (b.p.length < 27) return; // an empty corner of the block
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    shell.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    shell.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
    shell.setAttribute('aPbr', new THREE.Float32BufferAttribute(b.m, 3));
    shell.computeBoundingBox();
    const c = shell.boundingBox.getCenter(new THREE.Vector3());
    // the shell and the core turn about the chunk's own centre when it falls
    shell.translate(-c.x, -c.y, -c.z);
    let core = null;
    if (cell.core) {
      // shrink the library's solid inside the shell so it reads as the broken face, not a second skin
      const s = shell.boundingBox.getSize(new THREE.Vector3()), cs = cell.core.boundingBox.getSize(new THREE.Vector3());
      const k2 = 0.6 * Math.min(1, s.x / cs.x + 0.25, s.y / cs.y + 0.25, s.z / cs.z + 0.25);
      core = cell.core.clone().translate(-cell.c.x, -cell.c.y, -cell.c.z).scale(k2, k2, k2).translate(cell.c.x - c.x, cell.c.y - c.y, cell.c.z - c.z);
    }
    out.push({ shell, core, c });
  });
  return out.length >= 2 ? out : null;
}
export { mergeGeometries };
