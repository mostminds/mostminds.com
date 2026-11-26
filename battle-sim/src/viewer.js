// Model preview used while authoring models (see docs/MODELING.md).
//   viewer.html?kind=unit&id=knight&pose=attack&lod=0&detail=high
//   kind: unit | struct | ship | creature | craft      id: one id, or several separated by commas (shown side by side)
//   pose: idle | walk | attack | death | fly           t: animation time in seconds (default picks a telling frame)
//   lod: detail level to force (0 = closest)            detail: low | medium | high | ultra
//   view: quad (default: front, side, back three-quarter, close-up) | single
//   ref=1 stands a footman beside buildings and ships for scale
import * as THREE from 'three';
import { Stage } from './render/stage.js';
import { buildUnitModel, animateUnit, buildStructure, buildShip, buildCreature, animateCreature, buildCraft, setLod } from './render/models.js';
import { setDetail, triangleStats } from './render/rigkit.js';
import { prepareDef } from './engine/battle.js';
import { UNITS as GAME_UNITS, EXAMPLE_UNIT } from './data/units.js';
const UNITS = { ...GAME_UNITS, _example: EXAMPLE_UNIT };
import { STRUCTURES } from './data/structures.js';
import { SHIPS, CREATURES, FORTS } from './data/naval.js';

const q = new URLSearchParams(location.search);
const kind = q.get('kind') || 'unit', ids = (q.get('id') || 'footman').split(',');
const pose = q.get('pose') || 'idle', view = q.get('view') || 'quad';
const stats = { kind, ids, errors: [], models: {} };
window.__stats = stats;
window.addEventListener('error', (e) => stats.errors.push(String(e.message)));
const warn = console.warn;
console.warn = (...a) => { stats.errors.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); warn(...a); };

const stage = new Stage(document.getElementById('v'));
stage.setQuality('high');
setDetail(q.get('detail') || 'high');
stage.setSky(0xa9c4dc);
stage.scene.fog.near = 500; stage.scene.fog.far = 900;
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x6f8a5a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
stage.scene.add(ground);

const box = new THREE.Box3();
const items = [];
let x = 0;
const T = q.has('t') ? +q.get('t') : { idle: 0.4, walk: 0.165, attack: 0.5, death: 1, fly: 0.3 }[pose] ?? 0.4;
for (const id of ids) {
  const t0 = performance.now();
  let m = null, width = 1.2, anim = null;
  try {
    if (kind === 'unit') {
      const def = prepareDef(UNITS[id]);
      m = buildUnitModel(def);
      width = Math.max(1.2, def.size * 1.3 * (def.model?.scale || 1));
      anim = () => {
        if (pose === 'walk') animateUnit(m, T, true, -1, 0, 0, false);
        else if (pose === 'attack') animateUnit(m, 0.4, false, T, 0, 0, false);
        else if (pose === 'death') animateUnit(m, 0.4, false, -1, T, 0, false);
        else if (pose === 'fly') animateUnit(m, T, true, -1, 0, 0, true);
        else animateUnit(m, T, false, -1, 0, 0, false);
      };
      stats.models[id] = { triangles: triangleStats(m), sculpted: !!m.userData.rig?.v2, height: m.userData.rig?.height };
    } else if (kind === 'struct') {
      const def = STRUCTURES[id];
      const w = def.stretch ? +(q.get('len') || 6) : def.w, h = def.h;
      m = buildStructure(def, w, h); width = Math.max(w, h) + 1;
    } else if (kind === 'ship') { const def = SHIPS[id]; m = buildShip(def, 0x3d7bd9); width = def.len + 1; }
    else if (kind === 'creature') { const def = CREATURES[id]; m = buildCreature(def); width = (def.size || 1) * 2.4 + 1; anim = () => animateCreature(m, T, 0); stats.models[id] = { triangles: triangleStats(m) }; }
    else if (kind === 'fort') { const def = FORTS[id]; const mod = await import('./render/models.js'); m = mod.buildWeapon(def.model, def.size, def.size, def); width = def.size * 2 + 1; }
    else if (kind === 'craft') { m = buildCraft(0x3d7bd9); width = 3; }
  } catch (err) { stats.errors.push(`${id}: ${err.stack || err}`); }
  if (!m) continue;
  m.position.x = x + width / 2; x += width;
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  stage.scene.add(m);
  if (q.has('lod')) setLod(m, +q.get('lod'));
  anim?.();
  let tris = 0;
  m.traverse((o) => { if (o.isMesh && o.visible) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  (stats.models[id] ||= {}).visibleTriangles = Math.round(tris);
  stats.models[id].buildMs = Math.round(performance.now() - t0);
  items.push(m);
}
if (q.get('ref') && items.length) {
  const r = buildUnitModel(prepareDef(UNITS.footman));
  animateUnit(r, 0.4, false, -1, 0, 0, false);
  r.position.set(x + 0.6, 0, 0); stage.scene.add(r); items.push(r);
}
stage.scene.updateMatrixWorld(true);
for (const m of items) box.expandByObject(m);
if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
const R = Math.max(size.x, size.y, size.z) * 0.5 + 0.08;
stage.sun.position.set(c.x - R * 2, R * 4 + 2, c.z + R * 3); stage.sun.target.position.copy(c);
const sc = stage.sun.shadow.camera; sc.left = sc.bottom = -R * 2.2; sc.right = sc.top = R * 2.2; sc.far = R * 14 + 10; sc.updateProjectionMatrix();
stage.controls.enabled = false;

const cam = (ax, ay, dist, target = c) => {
  const k = new THREE.PerspectiveCamera(30, 1, 0.05, 2000);
  k.position.set(target.x + Math.sin(ax) * Math.cos(ay) * dist, target.y + Math.sin(ay) * dist, target.z + Math.cos(ax) * Math.cos(ay) * dist);
  k.lookAt(target);
  return k;
};
const D = R / Math.tan((15 * Math.PI) / 180) * 1.12;
const upper = new THREE.Vector3(c.x, box.min.y + size.y * 0.78, c.z);
const cams = view === 'single'
  ? [cam(0.6, 0.3, D)]
  : [cam(0, 0.12, D), cam(Math.PI / 2, 0.12, D), cam(Math.PI + 0.7, 0.3, D), ids.length === 1 && kind === 'unit' ? cam(0.45, 0.1, D * 0.42, upper) : cam(0.7, 0.75, D)];
const names = view === 'single' ? ['three-quarter'] : ['front (+Z)', 'side (+X)', 'back three-quarter', ids.length === 1 && kind === 'unit' ? 'close-up' : 'high three-quarter'];

function draw() {
  const r = stage.renderer, w = window.innerWidth, h = window.innerHeight;
  r.setPixelRatio(1); r.setSize(w, h); r.setScissorTest(true);
  const cols = cams.length > 1 ? 2 : 1, rows = cams.length > 1 ? 2 : 1;
  cams.forEach((k, i) => {
    const vw = w / cols, vh = h / rows, vx = (i % cols) * vw, vy = (rows - 1 - Math.floor(i / cols)) * vh;
    r.setViewport(vx, vy, vw, vh); r.setScissor(vx, vy, vw, vh);
    k.aspect = vw / vh; k.updateProjectionMatrix();
    r.render(stage.scene, k);
  });
}
draw(); draw();
document.getElementById('label').textContent = `${kind}: ${ids.join(', ')}  pose ${pose}\n${names.join('  |  ')}\n${Object.entries(stats.models).map(([k, v]) => `${k}: ${v.visibleTriangles} tris${v.triangles ? ` (levels ${v.triangles.join(' / ')})` : ''}`).join('\n')}`;
stats.drawCalls = stage.renderer.info.render.calls;
window.__ready = true;
