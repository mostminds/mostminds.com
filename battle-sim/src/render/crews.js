// Hands on deck: small sailors standing on every ship's and airship's deck, as many as she has crew left
// (up to what her deck holds). One instanced mesh draws every figure in the battle.
//
//   const crews = new Crews(scene)
//   crews.track(model, def, { airship })   finds the deck (raycast from above) and its standing places, once per hull type
//   crews.update(list, t)                  list: [{ model, frac (0..1 of crew aboard), color, alive }]
import * as THREE from 'three';

const slotCache = new Map();
const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();

/** where on this model hands can stand: [x, y, z] in the model's own space */
function deckSlots(model, key, airship) {
  if (slotCache.has(key)) return slotCache.get(key);
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const box = new THREE.Box3().setFromObject(model);
  const meshes = [];
  model.traverse((o) => { if (o.isMesh && o.visible !== false && !o.userData.noCrew) meshes.push(o); });
  const top = (model.userData.top ?? box.max.y) - model.position.y;
  // the hull runs along the model's x; sample a grid over it
  const sx = (box.max.x - box.min.x), sz = (box.max.z - box.min.z), cx = (box.max.x + box.min.x) / 2, cz = (box.max.z + box.min.z) / 2;
  const L = Math.max(sx, sz), alongX = sx >= sz, B = Math.min(sx, sz);
  const hits = [];
  for (let i = 0; i < 14; i++) for (let j = 0; j < 5; j++) {
    const u = -0.4 + (0.8 * i) / 13, v = -0.32 + (0.64 * j) / 4;
    from.set(cx + (alongX ? u * L : v * B), box.max.y + 2, cz + (alongX ? v * B : u * L));
    ray.set(from, down); ray.far = box.max.y - box.min.y + 4;
    const all = ray.intersectObjects(meshes, false).filter((h) => h.face && h.face.normal && new THREE.Vector3().copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.6);
    if (!all.length) continue;
    // a ship's deck is the highest level surface well below her mastheads; an airship's is the lowest (the gondola under the bag)
    const ok = airship ? all.slice().sort((a, c) => a.point.y - c.point.y) : all.filter((h) => h.point.y - model.position.y < top * 0.45 && h.point.y - model.position.y > -0.2);
    const h = ok[0];
    if (!h) continue;
    const p = h.point.clone().applyMatrix4(inv);
    hits.push([p.x, p.y, p.z]);
  }
  // keep the main deck level (drop cabin roofs and odd high points)
  const ys = hits.map((p) => p[1]).sort((a, c) => a - c), mid = ys[Math.floor(ys.length * 0.4)] ?? 0;
  const slots = hits.filter((p) => Math.abs(p[1] - mid) < 0.7);
  // a stable, spread-out order so the first few hands are not all in one corner
  slots.sort((a, c) => ((a[0] * 7.13 + a[2] * 3.7) % 1) - ((c[0] * 7.13 + c[2] * 3.7) % 1));
  slotCache.set(key, slots);
  return slots;
}

export class Crews {
  constructor(scene, max = 1600) {
    this.max = max;
    const body = new THREE.CapsuleGeometry(0.11, 0.3, 3, 6).translate(0, 0.27, 0);
    const head = new THREE.SphereGeometry(0.1, 8, 6).translate(0, 0.58, 0);
    const hat = new THREE.CylinderGeometry(0.07, 0.11, 0.07, 6).translate(0, 0.68, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.body = new THREE.InstancedMesh(body, mat, max);
    this.head = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: 0xd9a77c, roughness: 0.8 }), max);
    this.hat = new THREE.InstancedMesh(hat, new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.9 }), max);
    for (const m of [this.body, this.head, this.hat]) { m.count = 0; m.castShadow = true; m.frustumCulled = false; scene.add(m); }
    this.tmp = new THREE.Matrix4(); this.loc = new THREE.Matrix4(); this.col = new THREE.Color(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1);
    this.scale = 1;
  }
  dispose() { for (const m of [this.body, this.head, this.hat]) { m.parent && m.parent.remove(m); m.dispose(); } }
  /** finds and remembers the deck of a hull type; returns the number of standing places */
  track(model, key, opts = {}) {
    const slots = deckSlots(model, key, opts.airship);
    model.userData.crewSlots = slots;
    return slots.length;
  }
  update(list, t) {
    let n = 0;
    for (const it of list) {
      const m = it.model, slots = m && m.userData.crewSlots;
      if (!slots || !slots.length || !it.alive || m.visible === false) continue;
      const k = Math.min(slots.length, Math.ceil(slots.length * Math.max(0, Math.min(1, it.frac))));
      m.updateMatrixWorld();
      for (let i = 0; i < k && n < this.max; i++) {
        const p = slots[i], bob = Math.abs(Math.sin(t * 3 + i * 1.7)) * 0.03, turn = (i * 2.4 + Math.sin(t * 0.5 + i)) % (Math.PI * 2);
        this.q.setFromAxisAngle(this.v.set(0, 1, 0), turn);
        this.s.setScalar(this.scale * (it.size || 1));
        this.loc.compose(this.v.set(p[0], p[1] + bob, p[2]), this.q, this.s);
        this.tmp.multiplyMatrices(m.matrixWorld, this.loc);
        // a figure's size in the world follows the hull's own scale only partly: hands stay hand-sized
        this.body.setMatrixAt(n, this.tmp); this.head.setMatrixAt(n, this.tmp); this.hat.setMatrixAt(n, this.tmp);
        this.body.setColorAt(n, this.col.set(i % 4 === 0 ? 0xe8e0d0 : it.color));
        n++;
      }
    }
    for (const m of [this.body, this.head, this.hat]) { m.count = n; m.instanceMatrix.needsUpdate = true; }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}
