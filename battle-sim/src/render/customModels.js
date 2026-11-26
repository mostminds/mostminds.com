// User-supplied 3D models, assigned per unit / ship / creature / building id.
// Accepts the common interchange formats that model exporters write:
//  .glb, .gltf (+ .bin + textures), .obj (+ .mtl + textures), .ply (vertex colours), .fbx
// Files are parsed in the browser, kept in IndexedDB on this device only,
// auto-scaled to the target's size and animated from the file's own clips.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const registry = new Map(); // id -> { scene, clips, scale, yaw, name, size }
export const MODEL_EXTENSIONS = '.glb,.gltf,.bin,.obj,.mtl,.ply,.fbx,.png,.jpg,.jpeg,.webp,.tga,.bmp';
const base = (n) => n.split(/[\\/]/).pop().toLowerCase();
const ext = (n) => base(n).split('.').pop();
const listeners = new Set();
export const onModelsChanged = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

export const hasCustomModel = (id) => registry.has(id);
export const customModelList = () => [...registry.entries()].map(([id, e]) => ({ id, name: e.name, scale: e.scale, yaw: e.yaw, clips: e.clips.map((c) => c.name) }));

// files: [{ name, buffer }] — one model file plus any companions it references
async function parseFiles(files) {
  const urls = new Map();
  for (const f of files) urls.set(base(f.name), URL.createObjectURL(new Blob([f.buffer])));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => urls.get(base(decodeURIComponent(url))) ?? url);
  const pick = (...exts) => files.find((f) => exts.includes(ext(f.name)));
  const text = (f) => new TextDecoder().decode(f.buffer);
  const fail = (reject) => (err) => reject(err instanceof Error ? err : new Error(String(err?.message || err)));
  try {
    const gl = pick('glb', 'gltf');
    if (gl) {
      const loader = new GLTFLoader(manager);
      const gltf = await new Promise((res, rej) => loader.parse(ext(gl.name) === 'gltf' ? text(gl) : gl.buffer, '', res, fail(rej)));
      return { scene: gltf.scene || gltf.scenes[0], clips: gltf.animations || [] };
    }
    const fbx = pick('fbx');
    if (fbx) {
      const obj = new FBXLoader(manager).parse(fbx.buffer, '');
      return { scene: obj, clips: obj.animations || [] };
    }
    const objf = pick('obj');
    if (objf) {
      const loader = new OBJLoader(manager);
      const mtl = pick('mtl');
      if (mtl) {
        const mats = new MTLLoader(manager).parse(text(mtl), '');
        mats.preload();
        loader.setMaterials(mats);
      }
      const obj = loader.parse(text(objf));
      obj.traverse((o) => { if (o.isMesh && !mtl) o.material = new THREE.MeshLambertMaterial({ color: 0xb8b0a0 }); });
      await new Promise((r) => setTimeout(r, 50)); // let textures start decoding
      return { scene: obj, clips: [] };
    }
    const ply = pick('ply');
    if (ply) {
      const geo = new PLYLoader().parse(ply.buffer);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const m = new THREE.MeshLambertMaterial({ vertexColors: !!geo.attributes.color, color: geo.attributes.color ? 0xffffff : 0xb8b0a0, side: THREE.DoubleSide });
      const g = new THREE.Group(); g.add(new THREE.Mesh(geo, m));
      return { scene: g, clips: [] };
    }
    throw new Error('no .glb, .gltf, .fbx, .obj or .ply file in the selection');
  } finally {
    // keep texture URLs alive briefly so images finish decoding
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 20000);
  }
}

const UP = { y: 0, z: -Math.PI / 2, flip: Math.PI };

// files: [{ name, buffer }]; up: 'y' | 'z' | 'flip'
export async function addCustomModel(id, files, { name = 'model', scale = 1, yaw = 0, up = 'y' } = {}, persist = true) {
  if (files instanceof ArrayBuffer) files = [{ name: name.includes('.') ? name : `${name}.glb`, buffer: files }];
  const parsed = await parseFiles(files);
  const raw = parsed.scene;
  const scene = new THREE.Group();
  raw.rotation.x = UP[up] ?? 0;
  scene.add(raw);
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // put the model's feet at y=0 and centre it on its footprint
  const pivot = new THREE.Group();
  scene.position.set(-center.x, -box.min.y, -center.z);
  pivot.add(scene);
  registry.set(id, { scene: pivot, clips: parsed.clips, scale, yaw, name, size, up });
  if (persist) await dbPut({ id, files, name, scale, yaw, up });
  notify();
  return registry.get(id);
}

export async function removeCustomModel(id) {
  registry.delete(id);
  await dbDelete(id);
  notify();
}

export async function updateCustomModel(id, { scale, yaw }) {
  const e = registry.get(id);
  if (!e) return;
  if (scale !== undefined) e.scale = scale;
  if (yaw !== undefined) e.yaw = yaw;
  const rec = await dbGet(id);
  if (rec) await dbPut({ ...rec, scale: e.scale, yaw: e.yaw });
  notify();
}

const pickClip = (clips, re) => clips.find((c) => re.test(c.name));

// kind: 'unit' (height-normalised) or 'ship' / 'creature' (length-normalised)
export function instantiateCustom(id, targetSize, kind = 'unit') {
  const e = registry.get(id);
  if (!e) return null;
  const obj = skeletonClone(e.scene);
  const longest = Math.max(e.size.x, e.size.z) || 1;
  const k = kind === 'unit' ? targetSize / (e.size.y || 1) : targetSize / longest; // ships, creatures and buildings fit their footprint
  obj.scale.setScalar(k * e.scale);
  obj.rotation.y = (e.yaw * Math.PI) / 180;
  const inner = new THREE.Group();
  inner.add(obj);
  const outer = new THREE.Group();
  outer.add(inner);
  const rig = { kind: 'gltf', legs: [], arms: [] };
  if (e.clips.length) {
    rig.mixer = new THREE.AnimationMixer(obj);
    const act = (clip, once = false) => {
      if (!clip) return null;
      const a = rig.mixer.clipAction(clip);
      if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      return a;
    };
    rig.actions = {
      idle: act(pickClip(e.clips, /idle|stand|breath/i) || e.clips[0]),
      walk: act(pickClip(e.clips, /walk|run|move|locomot/i)),
      attack: act(pickClip(e.clips, /attack|hit|swing|slash|strike|shoot|cast|punch|stab/i), true),
      death: act(pickClip(e.clips, /death|die|dead|fall/i), true),
    };
    rig.current = null;
  }
  outer.userData.rig = rig;
  outer.userData.inner = inner;
  return outer;
}

export function animateCustom(model, t, moving, atk, dead) {
  const r = model.userData.rig, inner = model.userData.inner;
  if (r.actions) {
    let want = r.actions.idle, key = 'idle';
    if (dead > 0 && r.actions.death) { want = r.actions.death; key = 'death'; }
    else if (atk >= 0 && atk < 0.95 && r.actions.attack) { want = r.actions.attack; key = 'attack'; }
    else if (moving && r.actions.walk) { want = r.actions.walk; key = 'walk'; }
    if (r.current !== key && want) {
      const prev = r.current && r.actions[r.current];
      want.reset().play();
      if (prev && prev !== want) prev.crossFadeTo(want, 0.15, false);
      r.current = key;
    }
  }
  inner.position.y = !r.actions?.walk && moving ? Math.abs(Math.sin(t * 10)) * 0.04 : 0;
  if (dead > 0 && !r.actions?.death) {
    inner.rotation.x = -Math.min(1, dead * 2) * Math.PI / 2;
    inner.position.y = -Math.max(0, dead - 0.5) * 0.8;
  } else if (dead > 1) inner.position.y = -(dead - 1) * 0.8;
}

// ---------- IndexedDB (this device only) ----------
function db() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open('thousand-battles', 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => req.result.createObjectStore('models', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const t = d.transaction('models', mode);
      const r = fn(t.objectStore('models'));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
    });
  } catch { return undefined; }
}
const dbPut = (rec) => tx('readwrite', (s) => s.put(rec));
const dbDelete = (id) => tx('readwrite', (s) => s.delete(id));
const dbGet = (id) => tx('readonly', (s) => s.get(id));
const dbAll = () => tx('readonly', (s) => s.getAll());

export async function restoreCustomModels() {
  const all = (await dbAll()) || [];
  let n = 0;
  for (const rec of all) {
    try { await addCustomModel(rec.id, rec.files || rec.buffer, rec, false); n++; } catch { /* skip unreadable file */ }
  }
  return n;
}
