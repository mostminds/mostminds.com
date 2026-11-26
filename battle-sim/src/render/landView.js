// Renders a land/amphibious battle state produced by engine/battle.js.
import * as THREE from 'three';
import { buildUnitModel, animateUnit, buildStructure, buildCraft, mat } from './models.js';
import { makeBar, setBar } from './stage.js';
import { STRUCTURES } from '../data/structures.js';
import { structureFootprint } from '../engine/battle.js';
import { DEEP, SHALLOW, SAND } from '../engine/terrain.js';
import { TICK_MS } from '../engine/combat.js';

export const SIDE_COLORS = [0x3d7bd9, 0xd9463d];

export class LandView {
  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.dynamic = new THREE.Group();
    this.root.add(this.dynamic);
    stage.scene.add(this.root);
    this.models = []; this.crafts = [];
    this.ghost = null;
    this.ray = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.discGeo = new THREE.CircleGeometry(0.42, 12).rotateX(-Math.PI / 2);
  }

  dispose() { this.stage.scene.remove(this.root); }

  buildTerrain(b) {
    if (this.terrainKey === `${b.mode}:${b.W}`) return;
    this.terrainKey = `${b.mode}:${b.W}`;
    if (this.terrain) this.root.remove(this.terrain);
    const g = new THREE.Group();
    const N = b.W * b.H;
    const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), N);
    tiles.receiveShadow = true;
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    for (let y = 0; y < b.H; y++) for (let x = 0; x < b.W; x++) {
      const t = b.terrain[y * b.W + x];
      if (t === DEEP) continue;
      const top = t === SHALLOW ? -0.22 : t === SAND ? -0.03 : 0;
      m4.makeScale(1, 1, 1).setPosition(x + 0.5, top - 0.5, y + 0.5);
      tiles.setMatrixAt(n, m4);
      const v = ((x * 7 + y * 13) % 5) * 0.012 + ((x + y) % 2) * 0.015;
      if (t === SHALLOW) col.setRGB(0.62 + v, 0.56 + v, 0.4);
      else if (t === SAND) col.setRGB(0.82 + v, 0.74 + v, 0.52);
      else col.setRGB(0.33 + v, 0.5 + v, 0.24);
      tiles.setColorAt(n, col);
      n++;
    }
    tiles.count = n;
    g.add(tiles);
    const S = b.W;
    if (b.mode === 'amphibious') {
      this.water = new THREE.Mesh(new THREE.PlaneGeometry(S * 4, S * 4, 1, 1), new THREE.MeshLambertMaterial({ color: 0x2f6f9a, transparent: true, opacity: 0.82 }));
      this.water.rotation.x = -Math.PI / 2; this.water.position.set(S / 2, -0.12, S / 2);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(S * 4, S * 4), mat(0x1f3f55));
      floor.rotation.x = -Math.PI / 2; floor.position.set(S / 2, -1.2, S / 2);
      g.add(this.water, floor);
      this.stage.scene.background.set(0xa8c4d4);
    } else {
      this.water = null;
      const outer = new THREE.Mesh(new THREE.PlaneGeometry(S * 5, S * 5), mat(0x4b6a35));
      outer.rotation.x = -Math.PI / 2; outer.position.set(S / 2, -0.02, S / 2); outer.receiveShadow = true;
      g.add(outer);
      this.stage.scene.background.set(0x9fb8c8);
    }
    // faint tile grid for placement
    const grid = new THREE.GridHelper(S, S, 0x000000, 0x000000);
    grid.material.opacity = 0.07; grid.material.transparent = true;
    grid.position.set(S / 2, 0.01, S / 2);
    g.add(grid);
    this.terrain = g;
    this.root.add(g);
    this.stage.setBounds(b.W, b.H);
  }

  buildStructures(list) {
    if (this.structGroup) this.root.remove(this.structGroup);
    this.structGroup = new THREE.Group();
    for (const s of list) {
      const { w, h, def } = structureFootprint(s);
      const m = buildStructure(def, w, h);
      m.position.set(s.x + w / 2, 0, s.y + h / 2);
      m.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      this.structGroup.add(m);
    }
    this.root.add(this.structGroup);
  }

  // Full rebuild for a fresh battle object
  load(b) {
    this.b = b;
    this.buildTerrain(b);
    this.buildStructures(b.structures);
    this.stage.clear(this.dynamic);
    this.stage.clearFx();
    this.models = b.units.map((u) => {
      const m = buildUnitModel(u.def);
      const disc = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ color: SIDE_COLORS[u.side], transparent: true, opacity: 0.55 }));
      disc.scale.setScalar(u.def.size);
      disc.position.y = 0.02;
      m.add(disc);
      const bar = makeBar(SIDE_COLORS[u.side] === SIDE_COLORS[0] ? 0x4fd36a : 0x4fd36a);
      const top = 1.05 * (u.def.model?.scale || 1) + (u.def.model?.body === 'dragon' ? 0.4 : 0);
      bar.position.y = top;
      m.add(bar);
      setBar(bar, 1, 0.5 + 0.3 * u.def.size);
      m.userData.bar = bar; m.userData.disc = disc; m.userData.top = top;
      m.userData.phase = (u.id * 1.7) % 6.28;
      m.userData.rotY = Math.PI / 2 - u.face;
      this.dynamic.add(m);
      return m;
    });
    this.crafts = b.crafts.map((c) => {
      const m = buildCraft(SIDE_COLORS[c.side]);
      const bar = makeBar(0xd8b04a); bar.position.y = 1.1; setBar(bar, 1, 1.2);
      m.add(bar); m.userData.bar = bar;
      this.dynamic.add(m);
      return m;
    });
    this.deathAt = new Map();
    this.lastTickTime = performance.now();
  }

  groundY(x, y) {
    const b = this.b;
    if (x < 0 || y < 0 || x >= b.W || y >= b.H) return 0;
    const i = y * b.W + x;
    if (b.elevated[i]) {
      const s = b.structures.find((s) => x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h && STRUCTURES[s.type].elevated);
      return s ? (STRUCTURES[s.type].model === 'tower' ? 1.06 : STRUCTURES[s.type].model === 'gate' ? 1.8 : 0.76) : 0;
    }
    const t = b.terrain[i];
    return t === SHALLOW ? -0.2 : t === SAND ? -0.03 : 0;
  }

  unitPos(u, alpha, out) {
    const s = u.def.size / 2;
    if (u.aboard >= 0) {
      const c = this.b.crafts[u.aboard];
      const k = c.passengers.indexOf(u.id);
      const cx = c.px + (c.x - c.px) * alpha, cy = c.py + (c.y - c.py) * alpha;
      out.set(cx + 0.5 - 0.6 + (k % 3) * 0.55, 0.1 + this.waveY(cx, cy), cy + 0.5 - 0.35 + Math.floor(k / 3) * 0.7);
      return out;
    }
    const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
    const gy = this.groundY(Math.round(x), Math.round(y));
    return out.set(x + s, gy, y + s);
  }
  waveY(x, y) { return Math.sin(this.time * 1.6 + x * 0.4 + y * 0.3) * 0.06; }

  onEvents(events) {
    const b = this.b, st = this.stage;
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const msgs = [];
    for (const e of events) {
      if (e.type === 'attack') {
        const u = b.units[e.from];
        if (e.style === 'melee') continue;
        this.unitPos(u, 0, v); v.y += 0.6 * (u.def.model?.scale || 1);
        if (e.craft !== undefined) { const c = b.crafts[e.craft]; w.set(c.x + 0.5, 0.3, c.y + 0.5); }
        else { this.unitPos(b.units[e.to], 1, w); w.y += 0.5; }
        st.projectile(v.clone(), w.clone(), e.proj, (e.delay * TICK_MS) / 1000 / this.speed, e.proj === 'arrow' || e.proj === 'ranged' ? 0.8 : 0.2);
      } else if (e.type === 'hit') {
        const u = b.units[e.id];
        this.unitPos(u, 1, v); v.y += this.models[u.id].userData.top + 0.25;
        st.splat(v, e.dmg, e.style === 'poison' ? 'poison' : 'hit');
      } else if (e.type === 'heal') {
        this.unitPos(b.units[e.to], 1, v); v.y += this.models[e.to].userData.top + 0.25;
        st.splat(v, e.amount, 'heal');
        st.ring(v.setY(0.05), 0.4, 0x8ff0a0);
      } else if (e.type === 'death') {
        this.deathAt.set(e.id, this.time);
        if (e.drowned) { this.unitPos(b.units[e.id], 1, v); st.puff(v, 0xffffff, 0.3); }
      } else if (e.type === 'craftHit') {
        const c = b.crafts[e.craft]; v.set(c.x + 0.5, 1.1, c.y + 0.5);
        st.splat(v, e.dmg, 'hit');
      } else if (e.type === 'sunk') {
        const c = b.crafts[e.craft]; v.set(c.x + 0.5, 0, c.y + 0.5);
        st.puff(v, 0xffffff, 1, 1.5); st.ring(v, 1.5, 0xffffff, 1);
        msgs.push({ side: c.side, text: 'Landing craft sunk with all hands' });
      } else if (e.type === 'land') {
        const c = b.crafts[e.craft];
        msgs.push({ side: c.side, text: 'Landing craft hits the beach' });
      } else if (e.type === 'ability') {
        const u = b.units[e.id];
        this.unitPos(u, 1, v);
        if (e.name === 'stomp') st.ring(v, e.radius, 0xc8a070, 0.7);
        if (e.name === 'breath') {
          const t = b.units[e.to]; this.unitPos(t, 1, w);
          for (let i = 0; i < 6; i++) st.projectile(v.clone().setY(1), w.clone().add(new THREE.Vector3((Math.random() - 0.5) * e.radius * 2, 0.2, (Math.random() - 0.5) * e.radius * 2)), 'fire', 0.5 / this.speed, 0.1);
          msgs.push({ side: u.side, text: `${u.def.name} breathes fire` });
        }
        if (e.name === 'charge') st.ring(v, 0.6, 0xffffff, 0.4);
      } else if (e.type === 'flank') {
        msgs.push({ side: e.side, text: `${e.name} squad swings wide to flank` });
      } else if (e.type === 'regroup') {
        msgs.push({ side: e.side, text: `Broken ${e.name} squad falls back to regroup` });
      }
    }
    return msgs;
  }

  update(alpha, t, dt, speed = 1) {
    const b = this.b;
    if (!b) return;
    this.time = t; this.speed = speed;
    if (this.water) this.water.position.y = -0.12 + Math.sin(t * 0.8) * 0.03;
    const v = new THREE.Vector3();
    const tickNow = b.tick + alpha;
    b.units.forEach((u, i) => {
      const m = this.models[i];
      if (!m) return;
      const died = this.deathAt.get(i);
      if (!u.alive && died === undefined) { m.visible = false; return; }
      let dead = 0;
      if (died !== undefined) {
        dead = Math.min(1.5, (t - died) * speed / 1.2);
        if (dead >= 1.5) { m.visible = false; return; }
        m.userData.bar.visible = false; m.userData.disc.visible = false;
      }
      m.visible = true;
      this.unitPos(u, died !== undefined ? 1 : alpha, m.position);
      const want = Math.PI / 2 - u.face;
      let d = want - m.userData.rotY; d = Math.atan2(Math.sin(d), Math.cos(d));
      m.userData.rotY += d * Math.min(1, dt * 10);
      m.rotation.y = m.userData.rotY;
      const moving = u.alive && (u.x !== u.px || u.y !== u.py) && u.aboard < 0;
      const since = (tickNow - u.lastAttack) * 0.6 * 1.6;
      const atk = since >= 0 && since < 1 ? since : -1;
      animateUnit(m, t, moving, atk, dead, m.userData.phase);
      if (u.alive) setBar(m.userData.bar, u.hp / u.def.hp);
      if (u.aboard >= 0) m.scale.setScalar(Math.min(0.75, 1 / u.def.size)); else m.scale.setScalar(1);
    });
    b.crafts.forEach((c, i) => {
      const m = this.crafts[i];
      if (c.sunk) { m.position.y -= dt * 0.5 * speed; if (m.position.y < -2) m.visible = false; return; }
      const x = c.px + (c.x - c.px) * alpha, y = c.py + (c.y - c.py) * alpha;
      m.position.set(x + 0.5, c.landed ? -0.12 : this.waveY(x, y) - 0.05, y + 0.5);
      m.rotation.z = c.landed ? 0 : Math.sin(t * 1.3 + i) * 0.04;
      m.userData.ramp.rotation.z = c.landed ? -Math.min(1.4, (m.userData.rampT = (m.userData.rampT || 0) + dt * 2 * speed)) : 0;
      setBar(m.userData.bar, c.hp / c.maxHp);
      m.userData.bar.visible = !c.landed;
    });
  }

  // ---- editor helpers ----
  pickTile(clientX, clientY) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.stage.camera);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, p)) return null;
    return { x: Math.floor(p.x), y: Math.floor(p.z) };
  }

  showGhost(tool, tile, rot) {
    if (this.ghost) { this.root.remove(this.ghost); this.ghost = null; }
    if (!tool || !tile) return;
    let w = 1, h = 1, color = 0xffffff;
    if (tool.kind === 'structure') ({ w, h } = structureFootprint({ type: tool.id, rot }));
    if (tool.kind === 'erase') color = 0xff4040;
    if (tool.kind === 'unit') color = SIDE_COLORS[tool.side];
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, h), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false }));
    m.position.set(tile.x + w / 2, 0.08, tile.y + h / 2);
    m.renderOrder = 20;
    if (tool.kind === 'unit' && tool.brush > 1) { const r = Math.ceil(Math.sqrt(tool.brush)); m.scale.set(r, 1, r); }
    this.ghost = m;
    this.root.add(m);
  }
}
