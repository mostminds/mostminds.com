// Renders a land/amphibious battle state produced by engine/battle.js.
import * as THREE from 'three';
import { animateCreature, buildUnitModel, animateUnit, buildStructure, buildCraft, buildShip, buildRubble, buildAirship, buildDropPod, buildCableCar, shipMuzzle, setLod, mat, LEVEL_H } from './models.js';
import { bakePose } from './rigkit.js';
import { sculptMaterial } from './sculpt.js';
import { LIFTED } from '../engine/airship.js';
import { loadFracture, fractureModel } from './fracture.js';
import { makeBar, setBar } from './stage.js';
import { STRUCTURES } from '../data/structures.js';
import { structureFootprint } from '../engine/battle.js';
import { GRASS, DEEP, SHALLOW, SAND, BIOMES } from '../engine/terrain.js';
import { TICK_MS } from '../engine/combat.js';

export const SIDE_COLORS = [0x3d7bd9, 0xd9463d];
// camera distance (in unit sizes) beyond which a model drops to the next detail level
const LOD_STEPS = [9, 20, 40, 75, 130];
const NOTHING = new THREE.BufferGeometry();
NOTHING.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));

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
    this.tumbling = [];
    loadFracture();
  }

  dispose() { this.stage.scene.remove(this.root); }

  buildTerrain(b) {
    const key = `${b.mode}:${b.W}:${b.shape}:${b.biome}:${hashTerrain(b.terrain)}`;
    if (this.terrainKey === key) return;
    this.terrainKey = key;
    const bio = BIOMES[b.biome] || BIOMES.temperate;
    if (this.terrain) this.root.remove(this.terrain);
    const g = new THREE.Group();
    const W = b.W, H = b.H, V = W + 1;
    const tileAt = (x, y) => b.terrain[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
    const BASE = [0, -0.05, -0.34, -1.3, -0.1]; // grass, sand, shallow, deep, ford
    const deepCol = new THREE.Color(bio.floor).multiplyScalar(1.6);
    const COL = [new THREE.Color().setRGB(...bio.grass, THREE.SRGBColorSpace), new THREE.Color().setRGB(...bio.sand, THREE.SRGBColorSpace), new THREE.Color().setRGB(...bio.shallow, THREE.SRGBColorSpace), deepCol,
      new THREE.Color().setRGB(...bio.sand, THREE.SRGBColorSpace).lerp(new THREE.Color(0x8a8478), 0.55)]; // fords are gravel
    const noise = (x, y) => Math.sin(x * 0.31 + 1.7) * Math.cos(y * 0.27 + 0.4) * 0.5 + Math.sin(x * 0.83 + y * 0.61) * 0.25 + Math.sin(x * 1.9 - y * 1.3) * 0.12;
    // one height and one blended colour per tile corner: smooth ground instead of flat squares
    const hc = (this.hCorner = new Float32Array(V * V));
    const pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3);
    const c = new THREE.Color();
    for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
      const ts = [tileAt(x - 1, y - 1), tileAt(x, y - 1), tileAt(x - 1, y), tileAt(x, y)];
      let h = 0; c.setRGB(0, 0, 0);
      for (const t of ts) { h += BASE[t] / 4; c.r += COL[t].r / 4; c.g += COL[t].g / 4; c.b += COL[t].b / 4; }
      const dry = ts.every((t) => t === GRASS);
      const n = noise(x, y);
      if (dry) h += n * 0.09;
      const shade = 1 + n * 0.14 + ((x * 7 + y * 13) % 5 - 2) * 0.012;
      const k = y * V + x;
      hc[k] = h;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = y;
      col[k * 3] = c.r * shade; col[k * 3 + 1] = c.g * shade; col[k * 3 + 2] = c.b * (1 + n * 0.05);
    }
    const idx = new Uint32Array(W * H * 6);
    let q = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = y * V + x, d = a + V;
      idx[q++] = a; idx[q++] = d; idx[q++] = a + 1; idx[q++] = a + 1; idx[q++] = d; idx[q++] = d + 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    ground.receiveShadow = true;
    g.add(ground);

    const S = W;
    const wet = b.terrain.some((t) => t === DEEP || t === SHALLOW);
    if (wet) {
      const wg = new THREE.PlaneGeometry(S * 4, S * 4, 96, 96);
      wg.rotateX(-Math.PI / 2);
      this.waterBase = Float32Array.from(wg.attributes.position.array);
      this.water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: bio.water, transparent: true, opacity: 0.8, roughness: 0.18, metalness: 0.25 }));
      this.water.position.set(S / 2, -0.12, S / 2);
      this.water.receiveShadow = true;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(S * 4, S * 4), mat(bio.floor));
      floor.rotation.x = -Math.PI / 2; floor.position.set(S / 2, -1.5, S / 2);
      g.add(this.water, floor);
    } else {
      this.water = null;
      const outer = new THREE.Mesh(new THREE.PlaneGeometry(S * 5, S * 5), new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...bio.grass, THREE.SRGBColorSpace).multiplyScalar(0.9), roughness: 1 }));
      outer.rotation.x = -Math.PI / 2; outer.position.set(S / 2, -0.12, S / 2); outer.receiveShadow = true;
      g.add(outer);
    }
    this.stage.setSky(bio.sky);
    // faint tile grid for placement, only while editing
    const grid = new THREE.GridHelper(S, S, 0x000000, 0x000000);
    grid.material.opacity = 0.05; grid.material.transparent = true; grid.material.depthWrite = false;
    grid.position.set(S / 2, 0.12, S / 2);
    this.grid = grid;
    g.add(grid);
    this.terrain = g;
    this.root.add(g);
    if (this.boundsKey !== b.W) { this.boundsKey = b.W; this.stage.setBounds(b.W, b.H); }
  }

  buildStructures(list) {
    if (this.structGroup) this.root.remove(this.structGroup);
    this.structGroup = new THREE.Group();
    this.structModels = [];
    // terraces raise whatever is built on them
    const W = this.b.W;
    this.podium = new Uint8Array(W * this.b.H);
    for (const s of list) { const { w, h, def } = structureFootprint(s); if (def.stretch2 && !s.destroyed) for (let y = s.y; y < s.y + h; y++) for (let x = s.x; x < s.x + w; x++) if (x >= 0 && y >= 0 && x < W && y < this.b.H) this.podium[y * W + x] = Math.max(this.podium[y * W + x], def.level); }
    for (const s of list) this.makeStruct(s);
    this.root.add(this.structGroup);
  }

  makeStruct(s) {
    {
      const { w, h, def } = structureFootprint(s);
      const m = buildStructure(def, w, h, { x: s.x, y: s.y, side: s.side ?? s.owner ?? null, style: s.style || this.b.style || null, look: s.look || this.b.look || null });
      // weapons sitting on a bastion or deck are raised to its top
      const onTop = def.stretch2 ? 0 : this.podium[Math.min(this.b.H - 1, s.y + (h >> 1)) * this.b.W + Math.min(this.b.W - 1, s.x + (w >> 1))];
      const base = def.level ? (def.model === 'stairs' && onTop ? onTop * LEVEL_H : 0) : onTop ? onTop * LEVEL_H : Math.max(0, this.groundY(s.x + (w >> 1), s.y + (h >> 1)));
      m.position.set(s.x + w / 2, base, s.y + h / 2);
      if ((s.rot || 0) % 2 && def.weapon) m.rotation.y = Math.PI / 2;
      this.structModels.push(m);
      m.userData.meshes = [];
      m.traverse((c) => { if (c.isMesh) m.userData.meshes.push(c); });
      m.userData.tall = new THREE.Box3().setFromObject(m).max.y - base;
      if (def.hp && !def.weapon) {
        const bar = makeBar(0xd8b04a);
        bar.position.y = (def.level || def.losHeight || 1) * LEVEL_H + 0.7;
        setBar(bar, s.hp / (s.maxHp || def.hp), Math.min(3, 0.6 + Math.max(w, h) * 0.3));
        bar.visible = s.hp < (s.maxHp || def.hp);
        m.add(bar); m.userData.bar = bar;
      }
      if (s.destroyed) { m.visible = false; this.addRubble(s); }
      else if (s.maxHp && s.hp < s.maxHp) this.pendingStages = (this.pendingStages || []).concat(this.structModels.length - 1);
      m.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      this.structGroup.add(m);
      return m;
    }
  }

  addRubble(s) {
    const r = buildRubble(s.w, s.h, STRUCTURES[s.type].color, STRUCTURES[s.type].model);
    r.position.set(s.x + s.w / 2, 0, s.y + s.h / 2);
    this.structGroup.add(r);
  }

  /** every distinct model this battle needs, as { label, run } steps, so the page can build them one per frame */
  warmList(b) {
    const out = [], seen = new Set();
    const add = (key, label, run) => { if (!seen.has(key)) { seen.add(key); out.push({ label, run }); } };
    for (const u of b.units) add(`u:${u.def.id}`, u.def.name || u.def.id, () => buildUnitModel(u.def));
    for (const s of b.structures) {
      const { w, h, def } = structureFootprint(s);
      add(`s:${def.id}:${w}x${h}:${s.style || b.style || ''}`, def.name || def.id, () => buildStructure(def, w, h, { x: s.x, y: s.y, side: s.side ?? s.owner ?? null, style: s.style || b.style || null, look: s.look || b.look || null }));
    }
    for (const sh of b.ships) add(`h:${sh.def.id}:${sh.side}`, sh.def.name || sh.def.id, () => buildShip(sh.def, SIDE_COLORS[sh.side]));
    for (const c of b.crafts) add(`c:${c.side}`, 'Landing craft', () => buildCraft(SIDE_COLORS[c.side]));
    for (const a of b.airships) {
      add(`a:${a.def.id}`, a.def.name, () => buildAirship(a.def, SIDE_COLORS[a.side]));
      add(`p:${a.def.style}`, 'Drop pod', () => buildDropPod(a.def.style, SIDE_COLORS[a.side]));
      for (const id of [a.def.hangar.unit, a.def.pods.unit]) { const d = b.getDef(id); if (d) add(`u:${d.id}`, d.name, () => buildUnitModel(d)); }
    }
    return out;
  }

  // one unit's model with its side disc and health bar (also used for units that arrive mid-battle)
  addUnitModel(u) {
    const m = buildUnitModel(u.def);
    const disc = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ color: SIDE_COLORS[u.side], transparent: true, opacity: 0.55 }));
    disc.scale.setScalar(u.def.size);
    disc.position.y = 0.02;
    m.add(disc);
    const bar = makeBar(SIDE_COLORS[u.side] === SIDE_COLORS[0] ? 0x4fd36a : 0x4fd36a);
    const top = m.userData.rig?.height ? m.userData.rig.height + 0.12 : 1.05 * (u.def.model?.scale || 1) + (u.def.model?.body === 'dragon' ? 0.4 : 0);
    bar.position.y = top;
    m.add(bar);
    setBar(bar, 1, 0.5 + 0.3 * u.def.size);
    m.userData.bar = bar; m.userData.disc = disc; m.userData.top = top;
    m.userData.phase = (u.id * 1.7) % 6.28;
    m.userData.rotY = Math.PI / 2 - u.face;
    if (u.spec === 'commander') {
      // commanders carry the standard their squads rally on
      const st = new THREE.Group();
      st.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, top + 1.0, 6).translate(0, (top + 1.0) / 2, 0), mat(0x4a3a26)));
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42, 4, 1), new THREE.MeshStandardMaterial({ color: SIDE_COLORS[u.side], side: THREE.DoubleSide, roughness: 0.9 }));
      cloth.position.set(0.33, top + 0.72, 0); st.add(cloth);
      st.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mat(0xd8b04a, { metalness: 0.9, roughness: 0.3 })).translateY(top + 1.03));
      st.position.set(-0.28 * u.def.size, 0, -0.2); m.add(st); m.userData.standard = st;
    }
    this.dynamic.add(m);
    return m;
  }

  makeGunMark(g) {
    const m = this.structModels[g.si];
    m.rotation.y = 0;
    const flag = new THREE.Group();
    flag.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 4), mat(0x3a2a1a)));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.26), new THREE.MeshBasicMaterial({ color: 0xbbbbbb, side: THREE.DoubleSide }));
    cloth.position.set(0.2, 0.4, 0);
    flag.add(cloth);
    flag.position.set(-g.w / 2 + 0.1, 0.55 + (g.w > 1 ? 0.5 : 0), -g.h / 2 + 0.1);
    m.add(flag);
    const bar = makeBar(0xd8b04a); bar.position.y = g.w > 1 ? 1.6 : 1.15; setBar(bar, 1, 0.5 + g.w * 0.3);
    m.add(bar);
    return { model: m, cloth, bar, aim: g.aim, owner: undefined };
  }

  // Full rebuild for a fresh battle object
  load(b) {
    this.b = b;
    this.buildTerrain(b);
    this.buildStructures(b.structures);
    this.gunMarks = b.guns.map((g) => this.makeGunMark(g));
    this.stage.clear(this.dynamic);
    this.stage.clearFx();
    this.models = b.units.map((u) => this.addUnitModel(u));
    this.shipModels = b.ships.map((sh) => {
      const m = buildShip(sh.def, SIDE_COLORS[sh.side]);
      const bar = makeBar(0x4fd36a); bar.position.y = (m.userData.top ?? 1.7 + sh.def.len * 0.35) + 0.3; setBar(bar, 1, Math.min(3, sh.def.len * 0.4));
      m.add(bar); m.userData.bar = bar;
      const ring = new THREE.Mesh(new THREE.RingGeometry(sh.radius + 0.3, sh.radius + 0.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: SIDE_COLORS[sh.side], transparent: true, opacity: 0.6 }));
      ring.position.y = 0.05; m.add(ring); m.userData.ring = ring;
      this.dynamic.add(m);
      return m;
    });
    this.crafts = b.crafts.map((c) => {
      const m = buildCraft(SIDE_COLORS[c.side]);
      const bar = makeBar(0xd8b04a); bar.position.y = 1.1; setBar(bar, 1, 1.2);
      m.add(bar); m.userData.bar = bar;
      // the bow gun and the boat's own crew
      const gun = new THREE.Group();
      gun.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.55, 8).rotateZ(-Math.PI / 2).translate(0.2, 0, 0), mat(0x2b2b2e, { metalness: 0.8, roughness: 0.4 })));
      gun.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6).translate(0, -0.15, 0), mat(0x5a4630)));
      gun.position.set(0.8, 0.62, 0); m.add(gun); m.userData.gun = gun;
      m.userData.pips = [-0.28, 0, 0.28].map((z) => {
        const p = new THREE.Group();
        p.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat(0xd9a77c)));
        p.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(SIDE_COLORS[c.side])));
        p.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.26, 8).translate(0, -0.2, 0), mat(0x6b4a2e)));
        p.position.set(-0.85, 0.62, z); m.add(p);
        return p;
      });
      m.rotation.y = -Math.atan2(c.ty - c.y, c.tx - c.x);
      this.dynamic.add(m);
      return m;
    });
    this.airModels = b.airships.map((a) => {
      const m = buildAirship(a.def, SIDE_COLORS[a.side]);
      m.userData.setSide?.(SIDE_COLORS[a.side]);
      const top = (m.userData.top ?? 4.2) + 0.5;
      const bar = makeBar(0x4fd36a); bar.position.y = top; setBar(bar, 1, 3.2); m.add(bar);
      const crew = makeBar(0xe8d8a0); crew.position.y = top - 0.24; setBar(crew, 1, 2.2); m.add(crew);
      const lp = (m.userData.ladders || [[0, 0, 0.7]])[0];
      const ladder = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 5).translate(0, -0.5, 0), mat(0xc8b48a));
      ladder.position.set(lp[0], lp[1], lp[2]); ladder.visible = false; m.add(ladder);
      const mark = new THREE.Mesh(new THREE.RingGeometry(a.radius * 0.5, a.radius * 0.5 + 0.25, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: SIDE_COLORS[a.side], transparent: true, opacity: 0.5 }));
      this.dynamic.add(m, mark);
      return { m, bar, crew, ladder, mark, side: a.side, dmg: 0, downAt: undefined, smoke: 0 };
    });
    this.falling = [];
    // cable cars: a cable between each pair of towers and a gondola running along it
    this.cableMarks = (b.cmd.cables || []).map((cb) => {
      const A = b.structures[cb.a], Z = b.structures[cb.c], ma = this.structModels[cb.a], mz = this.structModels[cb.c];
      const top = (m) => (m.userData.cableAt ? m.userData.cableAt[1] : (m.userData.tall || 4) - 0.2);
      const pa = new THREE.Vector3(A.x + A.w / 2, ma.position.y + top(ma), A.y + A.h / 2), pz = new THREE.Vector3(Z.x + Z.w / 2, mz.position.y + top(mz), Z.y + Z.h / 2);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pz]), new THREE.LineBasicMaterial({ color: 0x2a2620 }));
      const car = buildCableCar(SIDE_COLORS[cb.side]);
      this.dynamic.add(line, car);
      return { cb, pa, pz, line, car };
    });
    this.pointMarks = new Map(); this.crateMarks = new Map(); this.siteMarks = new Map();
    this.makeFlags(b);
    for (const p of b.cmd.points) this.markPoint(p);
    for (const c of b.cmd.crates) this.markCrate(c);
    this.corpseGeo = new Map();
    this.noBody = new Set();
    this.smokeT = 0;
    this.stage.renderer.localClippingEnabled = true;
    for (const i of this.pendingStages || []) this.structStage(i);
    this.pendingStages = [];
    this.deathAt = new Map();
    this.shipSunkAt = new Map();
    this.timers = [];
    this.lastTickTime = performance.now();
  }

  groundY(x, y) {
    const b = this.b;
    if (x < 0 || y < 0 || x >= b.W || y >= b.H) return 0;
    const i = y * b.W + x;
    if (b.level[i]) {
      // the first and last tile of a stone bridge are its ramps
      const st = b.sid[i] ? b.structures[b.sid[i] - 1] : null;
      if (st && st.type === 'stoneBridge' && (st.w >= st.h ? x === st.x || x === st.x + st.w - 1 : y === st.y || y === st.y + st.h - 1)) return b.level[i] * LEVEL_H * 0.5;
      return b.level[i] * LEVEL_H;
    }
    const hc = this.hCorner, V = b.W + 1;
    if (!hc) return 0;
    const h = (hc[y * V + x] + hc[y * V + x + 1] + hc[(y + 1) * V + x] + hc[(y + 1) * V + x + 1]) / 4;
    return Math.max(h, -0.22); // wade, don't sink
  }

  // a rally point, beachhead or fort: a pennant on a pole, with the stores stacked beside it
  /** capture the flag: a stand at each fort's heart and the flag that lives on it */
  makeFlags(b) {
    this.flags = [];
    if (!b.ctf) return;
    const stone = mat(0x8a8a86), wood = mat(0x4a3a26), gold = mat(0xd8b04a, { metalness: 0.9, roughness: 0.3 });
    for (const f of b.ctf.flags) {
      const col = SIDE_COLORS[f.side], gy = this.groundY(f.hx, f.hy);
      // the stand: a stepped plinth with a ring in the side's colour
      const stand = new THREE.Group();
      stand.add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.16, 8).translate(0, 0.08, 0), stone));
      stand.add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.14, 8).translate(0, 0.23, 0), stone));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.02, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7 }));
      ring.position.y = 0.04; stand.add(ring);
      stand.position.set(f.hx + 0.5, gy, f.hy + 0.5);
      stand.traverse((o) => { if (o.isMesh && o !== ring) { o.castShadow = true; o.receiveShadow = true; } });
      this.dynamic.add(stand);
      // the flag: a tall pole, a long swallow-tailed banner, a gilt finial
      const flag = new THREE.Group(), H = 3.6;
      flag.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, H, 6).translate(0, H / 2, 0), wood));
      flag.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6).translate(0, H + 0.05, 0), gold));
      const geo = new THREE.PlaneGeometry(1.7, 1.05, 8, 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 0.75) pos.setY(i, pos.getY(i) * (1.25 - Math.abs(pos.getY(i)) * 1.1)); // swallow tail
      const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, roughness: 0.85, emissive: col, emissiveIntensity: 0.18 }));
      cloth.position.set(0.88, H - 0.6, 0); cloth.castShadow = true;
      flag.add(cloth);
      // a shaft of light so the flag can be found from across the field
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 9, 10, 1, true).translate(0, 4.5, 0), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      flag.add(beam);
      flag.userData = { cloth, base: geo.attributes.position.array.slice(), ring };
      this.dynamic.add(flag);
      this.flags.push({ flag, stand, pos: new THREE.Vector3(f.hx + 0.5, gy + 0.3, f.hy + 0.5), lean: 0 });
    }
  }
  updateFlags(alpha, t, dt) {
    const b = this.b;
    if (!b.ctf || !this.flags.length) return;
    const v = new THREE.Vector3();
    b.ctf.flags.forEach((f, i) => {
      const o = this.flags[i];
      let lean = 0;
      if (f.state === 'carried' && b.units[f.carrier]) {
        const u = b.units[f.carrier], m = this.models[u.id];
        this.unitPos(u, alpha, v);
        v.y += 0.15; v.x -= 0.18;
        if (m) m.userData.carrying = t;
        lean = 0.22;
      } else if (f.state === 'dropped') { v.set(f.x + 0.5, this.groundY(f.x, f.y) + 0.02, f.y + 0.5); lean = 1.05; }
      else v.set(f.hx + 0.5, this.groundY(f.hx, f.hy) + 0.3, f.hy + 0.5);
      o.pos.lerp(v, Math.min(1, dt * 10));
      o.lean += (lean - o.lean) * Math.min(1, dt * 6);
      o.flag.position.copy(o.pos);
      o.flag.rotation.z = -o.lean;
      // the cloth flies
      const { cloth, base } = o.flag.userData, p = cloth.geometry.attributes.position;
      for (let k = 0; k < p.count; k++) { const x = base[k * 3] + 0.85; p.setZ(k, Math.sin(t * 5 + x * 4 + i) * 0.09 * x); }
      p.needsUpdate = true;
      o.stand.children[2].material.opacity = f.state === 'home' ? 0.7 : 0.3 + 0.3 * Math.abs(Math.sin(t * 4)); // the empty stand pulses
    });
  }
  /** a fallen soldier comes back at his fort: his body is cleared away and he stands whole again */
  reviveUnit(id) {
    const old = this.models[id];
    if (old) this.dynamic.remove(old);
    this.deathAt.delete(id); this.noBody.delete(id);
    this.models[id] = this.addUnitModel(this.b.units[id]);
  }
  markPoint(p) {
    if (this.pointMarks.has(p.id)) return;
    const g = new THREE.Group(), y = Math.max(0, this.groundY(p.x, p.y));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 6).translate(0, 1.3, 0), mat(0x4a3a26)));
    const pennant = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 2.55, 0), new THREE.Vector3(0, 1.95, 0), new THREE.Vector3(1.0, 2.25, 0)]), new THREE.MeshBasicMaterial({ color: SIDE_COLORS[p.side], side: THREE.DoubleSide }));
    g.add(pennant);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.68, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: p.kind === 'beachhead' ? 0xf0d060 : p.kind === 'fort' || p.kind === 'hold' ? 0xffffff : SIDE_COLORS[p.side], transparent: true, opacity: 0.55 }));
    ring.position.y = 0.05; g.add(ring);
    const stores = buildStructure(STRUCTURES.crates, 1, 1, null);
    stores.position.set(0.7, 0, 0.5); stores.visible = false; g.add(stores);
    g.position.set(p.x + 0.5, y, p.y + 0.5);
    this.dynamic.add(g);
    this.pointMarks.set(p.id, { g, stores, pennant });
  }
  markCrate(c) {
    if (this.crateMarks.has(c.id)) return;
    const m = buildStructure(STRUCTURES.crates, 1, 1, null);
    m.scale.setScalar(0.85);
    m.position.set(c.x + 0.5, Math.max(0, this.groundY(c.x, c.y)), c.y + 0.5);
    this.dynamic.add(m);
    this.crateMarks.set(c.id, m);
  }

  airPos(a, alpha, out) {
    const m = this.airModels[a.id];
    const x = a.px + (a.x - a.px) * alpha, y = a.py + (a.y - a.py) * alpha;
    return out.set(x, m && m.m.position.y ? m.m.position.y : a.def.altitude, y);
  }

  // Buildings show their wounds: scorched and crumbling at two thirds, broken open and burning at one third.
  structStage(i) {
    const b = this.b, s = b.structures[i], m = this.structModels[i], def = STRUCTURES[s.type];
    if (!m || !s.maxHp) return;
    const g = def.weapon ? b.guns.find((x) => x.si === i) : null;
    const r = g ? g.hp / g.maxHp : s.hp / s.maxHp;
    const stage = r > 0.66 ? 0 : r > 0.33 ? 1 : 2;
    if (m.userData.stage === stage || (!stage && m.userData.stage === undefined)) return;
    m.userData.stage = stage;
    if (m.userData.debris) { m.remove(m.userData.debris); m.userData.debris = null; }
    // real masonry and timber break into chunks; anything that cannot be split is darkened and gets rubble at its foot
    const fr = def.weapon ? null : this.fracture(i);
    if (fr) {
      fr.mat.color.setScalar(1).multiplyScalar(stage === 0 ? 1 : stage === 1 ? 0.85 : 0.62);
      // walls and decks people stand on lose pieces of their faces; everything else loses its top first
      const share = def.level ? [0, 0.12, 0.28][stage] : [0, 0.22, 0.5][stage];
      this.dropChunks(fr, Math.round(fr.chunks.length * share));
      return;
    }
    for (const mesh of m.userData.meshes) {
      mesh.userData.mat0 ||= mesh.material;
      if (!stage) { mesh.material = mesh.userData.mat0; continue; }
      const mt = mesh.userData.mat0.clone();
      if (mt.color) mt.color.multiplyScalar(stage === 1 ? 0.78 : 0.5).multiply(new THREE.Color(1, 0.93, 0.86));
      mesh.material = mt;
    }
    if (stage && !def.weapon) {
      const d = buildRubble(Math.max(1, s.w), Math.max(1, s.h), def.color, def.model);
      d.scale.set(1.12, 0.4 + stage * 0.25, 1.12);
      m.add(d); m.userData.debris = d;
    }
  }

  // Split a structure's model into chunks the first time it is hurt. Returns null if it cannot be split.
  fracture(i) {
    const m = this.structModels[i], s = this.b.structures[i], def = STRUCTURES[s.type];
    if (m.userData.frac !== undefined) return m.userData.frac;
    m.userData.frac = null;
    const count = Math.max(8, Math.min(26, Math.round(6 + s.w * s.h * 1.4 + (m.userData.tall || 1) * 2)));
    const parts = fractureModel(m, m.userData.meshes, count, 1 + i * 7919);
    if (!parts) return null;
    const mat = sculptMaterial().clone();
    const coreMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color).multiplyScalar(0.7), roughness: 1, flatShading: true });
    const group = new THREE.Group();
    const chunks = parts.map((p, k) => {
      const g = new THREE.Group();
      const shell = new THREE.Mesh(p.shell, mat); shell.castShadow = true; shell.receiveShadow = true; g.add(shell);
      let core = null;
      if (p.core) { core = new THREE.Mesh(p.core, coreMat); core.visible = false; core.castShadow = true; g.add(core); }
      g.position.copy(p.c);
      group.add(g);
      return { g, core, home: p.c.clone(), fallen: false, k };
    });
    // which go first: the highest, or for walkable works the outer faces low down
    const order = chunks.slice().sort(def.level ? (a, c) => (a.home.y - c.home.y) + (((a.k * 37) % 7) - ((c.k * 37) % 7)) * 0.2 : (a, c) => c.home.y - a.home.y);
    // the whole model gives way to its chunks (a model may itself be the mesh, so it is emptied, not hidden)
    for (const mesh of m.userData.meshes) { mesh.userData.geo0 = mesh.geometry; mesh.geometry = NOTHING; }
    m.add(group);
    m.userData.frac = { chunks, order, mat, group };
    return m.userData.frac;
  }

  // The first n chunks in falling order come down (or go back up, when repairs have been made).
  dropChunks(fr, n) {
    fr.order.forEach((c, idx) => {
      if (idx < n && !c.fallen) {
        c.fallen = true;
        if (c.core) c.core.visible = true;
        const out = new THREE.Vector3(c.home.x, 0, c.home.z);
        if (out.lengthSq() < 0.01) out.set(Math.sin(c.k * 2.4), 0, Math.cos(c.k * 2.4));
        out.normalize().multiplyScalar(0.6 + ((c.k * 53) % 10) / 9);
        this.tumbling.push({ c, v: new THREE.Vector3(out.x, 0.6 + ((c.k * 31) % 10) / 8, out.z), w: new THREE.Vector3(((c.k * 17) % 9) - 4, ((c.k * 29) % 7) - 3, ((c.k * 13) % 9) - 4).multiplyScalar(0.7), wait: idx * 0.05, rest: 0.12 + ((c.k * 41) % 10) / 34 });
      } else if (idx >= n && c.fallen) {
        // mended: the piece is set back in place
        c.fallen = false; if (c.core) c.core.visible = false;
        c.g.position.copy(c.home); c.g.rotation.set(0, 0, 0);
        this.tumbling = this.tumbling.filter((t) => t.c !== c);
      }
    });
  }

  unitPos(u, alpha, out) {
    const s = u.def.size / 2;
    if (u.aboard >= LIFTED) {
      const a = this.b.airships[u.aboard - LIFTED], k = Math.max(0, a.cargo.indexOf(u.id));
      this.airPos(a, alpha, out);
      out.x += ((k % 4) - 1.5) * 0.42; out.z += (Math.floor(k / 4) % 2 - 0.5) * 0.5; out.y += 0.04;
      return out;
    }
    if (u.aboard >= 0) {
      const c = this.b.crafts[u.aboard];
      const k = c.passengers.indexOf(u.id);
      const cx = c.px + (c.x - c.px) * alpha, cy = c.py + (c.y - c.py) * alpha;
      out.set(cx + 0.5 - 0.6 + (k % 3) * 0.55, 0.1 + this.waveY(cx, cy), cy + 0.5 - 0.35 + Math.floor(k / 3) * 0.7);
      return out;
    }
    const x = u.px + (u.x - u.px) * alpha, y = u.py + (u.y - u.py) * alpha;
    let gy = this.groundY(Math.round(x), Math.round(y));
    if (u.under) gy = 0; // passing beneath a walkway or viaduct
    if (u.def.fly) {
      const m = this.models[u.id];
      const want = u.alive && !(u.landedUntil > this.b.tick) ? 2.6 + Math.sin((this.time || 0) * 2 + u.id) * 0.15 : 0; // landed and fallen fliers are on the ground
      if (m) { m.userData.air = (m.userData.air ?? want) + (want - (m.userData.air ?? want)) * 0.15; gy = Math.max(0, gy) + (u.alive ? m.userData.air : Math.max(0, m.userData.air)); }
      else gy += want;
    }
    return out.set(x + s, gy, y + s);
  }
  waveY(x, y) { return Math.sin(this.time * 1.6 + x * 0.4 + y * 0.3) * 0.06; }

  onEvents(events) {
    const b = this.b, st = this.stage;
    while (this.models.length < b.units.length) this.models.push(this.addUnitModel(b.units[this.models.length])); // launched aircraft, pod troops
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const msgs = [];
    for (const e of events) {
      if (e.type === 'attack') {
        const u = b.units[e.from];
        if (e.style === 'melee') { if (e.air !== undefined) { this.airPos(b.airships[e.air], 1, w); st.puff(w.clone(), 0xd8d0c0, 0.25, 0.5); } continue; }
        this.unitPos(u, 0, v); v.y += 0.6 * (u.def.model?.scale || 1);
        if (e.struct !== undefined) {
          if (e.style === 'melee') continue;
          const st = b.structures[e.struct]; w.set(st.x + st.w / 2, 1, st.y + st.h / 2);
        } else if (e.craft !== undefined) { const c = b.crafts[e.craft]; w.set(c.x + 0.5, 0.3, c.y + 0.5); }
        else if (e.ship !== undefined) { const sh = b.ships[e.ship]; w.set(sh.x, 0.8, sh.y); }
        else if (e.air !== undefined) this.airPos(b.airships[e.air], 1, w);
        else { this.unitPos(b.units[e.to], 1, w); w.y += 0.5; }
        st.projectile(v.clone(), w.clone(), e.proj, (e.delay * TICK_MS) / 1000 / this.speed, e.proj === 'arrow' || e.proj === 'ranged' ? 0.8 : 0.2);
      } else if (e.type === 'gunFire') {
        const g = b.guns[e.gun];
        // a model may say where its muzzle is: userData.muzzle = [distance out along the barrel, height]
        const gmod = this.structModels[g.si], mz = gmod.userData.muzzle || [0.6, g.w > 1 ? 0.9 : 0.5], gs = gmod.scale.x;
        v.set(g.cx, gmod.position.y + mz[1] * gs, g.cy);
        w.set(e.x1, e.h1 ?? 0.3, e.y1);
        st.puff(v.clone().add(new THREE.Vector3(Math.cos(g.aim) * mz[0] * gs, 0, Math.sin(g.aim) * mz[0] * gs)), 0xeeeeee, g.w > 1 ? 0.45 : 0.3, 0.9);
        st.projectile(v.clone(), w.clone(), e.shot, (e.delay * TICK_MS) / 1000 / this.speed, e.shot === 'shell' ? 2.4 : 0.4);
        if (e.shot !== 'bolt') this.later(e.delay, () => { st.puff(w.clone(), 0x8a7a6a, 0.4, 0.8); st.ring(w.clone().setY(0.05), b.guns[e.gun].wpn.splash || 0.4, 0xffb060, 0.5); });
      } else if (e.type === 'shipFire') {
        const sh = b.ships[e.ship];
        for (let i = 0; i < e.guns; i++) {
          const off = (i / Math.max(1, e.guns - 1) - 0.5) * sh.def.len * 0.6;
          if (!shipMuzzle(this.shipModels[e.ship], e.x1, e.y1, i * 2 + (b.tick % 2), v)) v.set(sh.x + Math.cos(sh.heading) * off, 0.7, sh.y + Math.sin(sh.heading) * off);
          w.set(e.x1 + (Math.random() - 0.5) * 1.5, 0.2, e.y1 + (Math.random() - 0.5) * 1.5);
          st.projectile(v.clone(), w.clone(), 'cannon', (e.delay * TICK_MS) / 1000 / this.speed, 0.5);
          if (i % 2 === 0) st.puff(v.clone(), 0xeeeeee, 0.35, 0.9);
        }
        const target = new THREE.Vector3(e.x1, 0.2, e.y1);
        this.later(e.delay, () => st.puff(target, 0x8a7a6a, 0.5, 0.8));
      } else if (e.type === 'shipHit') {
        const sh = b.ships[e.ship]; st.splat(v.set(sh.x, 2.4, sh.y), e.dmg);
      } else if (e.type === 'gunHit') {
        const g = b.guns[e.gun]; st.splat(v.set(g.cx, 1.6, g.cy), e.dmg);
        this.structStage(g.si);
      } else if (e.type === 'shipSunk') {
        const sh = b.ships[e.ship]; this.shipSunkAt.set(e.ship, this.time);
        st.ring(v.set(sh.x, 0, sh.y), 2, 0xffffff, 1.2);
        msgs.push({ side: sh.side, text: `${sh.def.name} goes down` });
      } else if (e.type === 'gunCaptured') {
        const g = b.guns[e.gun];
        msgs.push({ side: e.side, text: `${STRUCTURES[g.type].name} captured` });
      } else if (e.type === 'gunDestroyed') {
        const g = b.guns[e.gun];
        st.puff(v.set(g.cx, 0.5, g.cy), 0x444444, 0.9, 1.6);
        msgs.push({ side: g.owner ?? 0, text: `${STRUCTURES[g.type].name} knocked out` });
      } else if (e.type === 'structHit') {
        const st = b.structures[e.s], m = this.structModels[e.s];
        if (m?.userData.bar) { m.userData.bar.visible = true; setBar(m.userData.bar, st.hp / st.maxHp); }
        this.structStage(e.s);
        if (e.dmg > 0) st && this.stage.splat(v.set(st.x + st.w / 2, (STRUCTURES[st.type].level || 1) * LEVEL_H + 0.9, st.y + st.h / 2), e.dmg);
        if (st && e.dmg >= 20) st && this.stage.puff(v.set(st.x + st.w / 2, 0.6, st.y + st.h / 2), 0xb0a898, 0.4, 0.7);
      } else if (e.type === 'structDestroyed') {
        const st = b.structures[e.s], m = this.structModels[e.s];
        const fr = m && !STRUCTURES[st.type].weapon ? this.fracture(e.s) : null;
        if (fr) { fr.mat.color.setScalar(0.55); this.dropChunks(fr, fr.chunks.length); if (m.userData.bar) m.userData.bar.visible = false; m.userData.stage = 3; } // it comes down in pieces and lies there
        else { if (m) m.visible = false; this.addRubble(st); }
        for (let k = 0; k < 4; k++) st && this.stage.puff(v.set(st.x + Math.random() * st.w, 0.5 + Math.random(), st.y + Math.random() * st.h).clone(), 0xb0a898, 0.8, 1.6);
        msgs.push({ side: e.side >= 0 ? e.side : 0, text: `${STRUCTURES[st.type].name} ${STRUCTURES[st.type].door ? 'is broken open' : 'collapses'}` });
      } else if (e.type === 'hit') {
        const u = b.units[e.id];
        this.unitPos(u, 1, v); v.y += this.models[u.id].userData.top + 0.25;
        st.splat(v, e.dmg, e.style === 'poison' ? 'poison' : 'hit');
        if (e.style === 'fall') msgs.push({ side: u.side, text: `${u.def.name} falls from the walls` });
      } else if (e.type === 'heal') {
        this.unitPos(b.units[e.to], 1, v); v.y += this.models[e.to].userData.top + 0.25;
        st.splat(v, e.amount, 'heal');
        st.ring(v.setY(0.05), 0.4, 0x8ff0a0);
      } else if (e.type === 'death') {
        this.deathAt.set(e.id, this.time);
        this.howDied(e);
        if (e.drowned) { this.unitPos(b.units[e.id], 1, v); st.puff(v, 0xffffff, 0.3); this.noBody.add(e.id); }
        else if (b.units[e.id].aboard >= 0) this.noBody.add(e.id);
      } else if (e.type === 'beastLanding') {
        const sh = b.ships[e.ship];
        st.ring(v.set(e.x + 0.5, 0.05, e.y + 0.5), 2, 0xffffff, 0.8);
        msgs.push({ side: sh.side, text: `${sh.def.name} comes ashore: ${e.n} troops${e.gun ? ' and a siege weapon' : ''} landed` });
      } else if (e.type === 'explode') {
        v.set(e.x, 0.6, e.y);
        st.ring(v.clone().setY(0.05), e.r, 0x9a6aff, 0.8);
        for (let k = 0; k < 7; k++) st.puff(v.clone().add(new THREE.Vector3((Math.random() - 0.5) * e.r, Math.random() * 2, (Math.random() - 0.5) * e.r)), [0x9a6aff, 0x6aff9a, 0xffb040][k % 3], 0.8, 1.4);
        msgs.push({ side: 0, text: "An alchemist's laboratory goes up" });
      } else if (e.type === 'cable') {
        if (b.tick % 3 === 0) msgs.push({ side: b.cmd.cables.find((c) => c.a === e.a)?.side ?? 1, text: 'The cable car brings stores to the upper town' });
      } else if (e.type === 'duel') {
        // a matched exchange: both fighters play the same blow, facing one another
        const dur = 0.62;
        for (const [id, role] of [[e.a, 'a'], [e.d, 'd']]) { const m = this.models[id]; if (m) m.userData.duel = { role, kind: e.kind, t0: this.time + (role === 'd' ? 0.12 : 0), dur, other: role === 'a' ? e.d : e.a }; }
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
      } else if (e.type === 'reinforce') {
        for (const id of e.ids) this.reviveUnit(id);
        if (e.ids.length >= 6) msgs.push({ side: e.side, text: `${e.ids.length} return to the fight` });
      } else if (e.type === 'flagTaken') {
        const u = b.units[e.by]; this.unitPos(u, 1, v);
        st.ring(v.clone().setY(0.05), 1.4, SIDE_COLORS[u.side], 0.9);
        msgs.push({ side: u.side, text: `${u.def.name} takes the enemy flag` });
      } else if (e.type === 'flagDropped') {
        st.ring(v.set(e.x + 0.5, 0.05, e.y + 0.5), 1.2, 0xffffff, 0.7);
        msgs.push({ side: e.flag, text: e.why === 'lifted' ? 'The flag is left behind' : 'The flag carrier is down' });
      } else if (e.type === 'flagReturned') {
        const f = b.ctf.flags[e.flag];
        st.ring(v.set(f.hx + 0.5, 0.05, f.hy + 0.5), 1.6, SIDE_COLORS[e.flag], 0.9);
        msgs.push({ side: e.flag, text: e.by >= 0 ? 'The flag is carried home' : 'The flag returns to its stand' });
      } else if (e.type === 'flagCaptured') {
        const f = b.ctf.flags[e.side];
        v.set(f.hx + 0.5, 0.05, f.hy + 0.5);
        for (let k = 0; k < 3; k++) st.ring(v.clone(), 1.2 + k * 0.9, SIDE_COLORS[e.side], 0.8 + k * 0.3);
        for (let k = 0; k < 10; k++) st.puff(v.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2)), [SIDE_COLORS[e.side], 0xffd24a, 0xffffff][k % 3], 0.35);
        msgs.push({ side: e.side, text: `Flag captured! ${e.score[0]} – ${e.score[1]}` });
      } else if (e.type === 'point') {
        this.markPoint(b.cmd.points[e.point]);
        msgs.push({ side: e.side, text: e.kind === 'beachhead' ? 'A beachhead is marked: stores come ashore' : e.kind === 'fort' ? 'The garrison holds its works' : e.kind === 'hold' ? 'A squad marks the ground it will hold' : 'A squad sets its rally point behind the line' });
      } else if (e.type === 'crate') {
        this.markCrate({ id: e.crate, x: e.x, y: e.y });
      } else if (e.type === 'crateGone') {
        const m = this.crateMarks.get(e.crate); if (m) { this.dynamic.remove(m); this.crateMarks.delete(e.crate); }
      } else if (e.type === 'supplyIn' || (e.type === 'raid' && e.point !== undefined)) {
        const pm = this.pointMarks.get(e.point);
        if (pm) { pm.stores.visible = e.stock > 0; pm.stores.scale.setScalar(Math.min(1.5, 0.7 + e.stock * 0.12)); }
        if (e.type === 'raid') msgs.push({ side: e.side, text: 'Vanguard raiders burn enemy stores' });
      } else if (e.type === 'raid') {
        msgs.push({ side: e.side, text: e.what === 'crate' ? 'Vanguard raiders carry off enemy supplies' : 'Vanguard raiders wreck a supply wagon' });
      } else if (e.type === 'airSupply' || e.type === 'shipSupply') {
        if (e.air !== undefined) this.airPos(b.airships[e.air], 1, v); else { const sh = b.ships[e.ship]; v.set(sh.x, 0.8, sh.y); }
        st.projectile(v.clone(), w.set(e.x + 0.5, 0.3, e.y + 0.5).clone(), 'rock', 1.2 / this.speed, e.air !== undefined ? 0 : 1.2);
      } else if (e.type === 'buildStart') {
        const gm = new THREE.Mesh(new THREE.BoxGeometry(e.w, 0.5, e.h), new THREE.MeshBasicMaterial({ color: SIDE_COLORS[e.side], transparent: true, opacity: 0.25 }));
        gm.position.set(e.x + e.w / 2, Math.max(0, this.groundY(e.x, e.y)) + 0.25, e.y + e.h / 2);
        this.dynamic.add(gm); this.siteMarks.set(e.site, gm);
      } else if (e.type === 'built') {
        const gm = this.siteMarks.get(e.site); if (gm) { this.dynamic.remove(gm); this.siteMarks.delete(e.site); }
        while (this.structModels.length < b.structures.length) this.makeStruct(b.structures[this.structModels.length]);
        while (this.gunMarks.length < b.guns.length) this.gunMarks.push(this.makeGunMark(b.guns[this.gunMarks.length]));
        const sx = b.structures[e.s];
        st.ring(v.set(sx.x + sx.w / 2, 0.05, sx.y + sx.h / 2), 1, 0xe8d070, 0.6);
        msgs.push({ side: e.side, text: `Engineers finish a ${STRUCTURES[e.kind].name.toLowerCase()}` });
      } else if (e.type === 'outOfAmmo') {
        const u = b.units[e.id];
        if (!this.saidOut || this.time - this.saidOut > 3) { this.saidOut = this.time; msgs.push({ side: e.side, text: e.medic ? `${(u.baseDef || u.def).name}s have run out of dressings` : `${(u.baseDef || u.def).name}s are out of ammunition and no stores are in reach` }); }
      } else if (e.type === 'resupplied') {
        this.unitPos(b.units[e.id], 1, v); st.ring(v.setY(0.05), 0.4, 0xe8d070, 0.4);
      } else if (e.type === 'airSupplyRun') {
        msgs.push({ side: b.airships[e.air].side, text: `${b.airships[e.air].def.name} turns away on a supply run` });
      } else if (e.type === 'fallback') {
        msgs.push({ side: e.side, text: `${e.name} squad breaks and falls back to ${e.to}` });
      } else if (e.type === 'rallied') {
        if (b.tick % 2 === 0) msgs.push({ side: e.side, text: `${e.name} squad rallies and re-forms` });
      } else if (e.type === 'commanderDown') {
        const u = b.units[e.id];
        msgs.push({ side: 1 - e.side, text: `${(u.baseDef || u.def).name} commander has fallen: nearby squads waver` });
      } else if (e.type === 'promoted') {
        this.unitPos(b.units[e.id], 1, v); st.ring(v.setY(0.05), 0.5, 0xf0d060, 0.6);
      } else if (e.type === 'repair') {
        const si = e.gun !== undefined ? b.guns[e.gun].si : e.s, sm = this.structModels[si], sx = b.structures[si];
        st.splat(v.set(sx.x + sx.w / 2, (sm?.userData.tall || 1) + 0.6, sx.y + sx.h / 2), '+', 'heal');
        st.ring(v.set(sx.x + sx.w / 2, 0.05, sx.y + sx.h / 2), Math.max(sx.w, sx.h) * 0.3, 0xe8d070, 0.5);
        if (sm?.userData.bar) { setBar(sm.userData.bar, sx.hp / sx.maxHp); sm.userData.bar.visible = sx.hp < sx.maxHp; }
        this.structStage(si);
      } else if (e.type === 'craftFire') {
        const c = b.crafts[e.craft]; v.set(c.x + 0.5, 0.7, c.y + 0.5);
        this.unitPos(b.units[e.to], 1, w); w.y += 0.5;
        st.projectile(v.clone(), w.clone(), 'musket', (e.delay * TICK_MS) / 1000 / this.speed, 0.2);
        st.puff(v.clone(), 0xeeeeee, 0.16, 0.5);
      } else if (e.type === 'craftCrew') {
        if (e.crew === 0) msgs.push({ side: b.crafts[e.craft].side, text: 'A landing craft loses its last crewman' });
      } else if (e.type === 'airFire') {
        const a = b.airships[e.air], am = this.airModels[e.air].m;
        w.set(e.x1, e.h1 ?? 0.3, e.y1);
        for (let i = 0; i < e.guns; i++) {
          if (!shipMuzzle(am, e.x1, e.y1, i, v)) this.airPos(a, 1, v);
          const to = w.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.4, 0, (Math.random() - 0.5) * 1.4));
          st.projectile(v.clone(), to, 'cannon', (e.delay * TICK_MS) / 1000 / this.speed, 0.15);
          st.puff(v.clone(), 0xeeeeee, 0.3, 0.8);
        }
        this.later(e.delay, () => st.puff(w.clone(), 0x8a7a6a, 0.45, 0.8));
      } else if (e.type === 'bomb') {
        const a = b.airships[e.air];
        this.airPos(a, 1, v); v.y -= 0.9;
        w.set(e.x, 0.1, e.y);
        st.projectile(v.clone(), w.clone(), 'shell', (e.delay * TICK_MS) / 1000 / this.speed, 0);
        const at = w.clone();
        this.later(e.delay, () => {
          st.ring(at.clone(), e.radius, 0xffa040, 0.7);
          st.puff(at.clone().setY(0.5), 0xff8a30, 0.9, 0.5); st.puff(at.clone().setY(0.9), 0x4a4640, 1.1, 1.6);
        });
      } else if (e.type === 'podDrop') {
        const a = b.airships[e.air];
        const pod = buildDropPod(a.def.style, SIDE_COLORS[a.side]);
        this.airPos(a, 1, v); v.y -= 0.6;
        this.dynamic.add(pod);
        this.falling.push({ obj: pod, from: v.clone(), to: new THREE.Vector3(e.x + 0.5, Math.max(0, this.groundY(e.x, e.y)), e.y + 0.5), t0: this.time, dur: (e.delay * TICK_MS) / 1000 / this.speed, stay: 30 });
      } else if (e.type === 'podLand') {
        v.set(e.x + 0.5, 0.1, e.y + 0.5);
        st.ring(v.clone(), 1.4, 0xd8c8a0, 0.6); st.puff(v.clone().setY(0.4), 0xb0a898, 0.8, 1.1);
        msgs.push({ side: e.side, text: `Drop pod lands: ${e.n} shock troops storm out` });
      } else if (e.type === 'airLaunch') {
        const a = b.airships[e.air];
        this.airPos(a, 1, v); st.puff(v.clone(), 0xffffff, 0.3, 0.6);
        if (b.tick % 3 === 0) msgs.push({ side: a.side, text: `${a.def.name} launches ${b.units[e.ids[0]].def.name}s` });
      } else if (e.type === 'airHit') {
        if (e.dmg > 0) { this.airPos(b.airships[e.air], 1, v); v.x += (Math.random() - 0.5) * 3; st.splat(v.clone(), e.dmg); st.puff(v.clone(), 0x55504a, 0.35, 0.8); }
      } else if (e.type === 'airCaptured') {
        const a = b.airships[e.air];
        msgs.push({ side: e.side, text: `${a.def.name} is boarded and taken!` });
      } else if (e.type === 'airGrapple') {
        msgs.push({ side: b.airships[e.air].side, text: `${b.airships[e.air].def.name} grapples ${b.airships[e.other].def.name}` });
      } else if (e.type === 'airBoard') {
        this.airPos(b.airships[e.other], 1, v); st.puff(v.clone(), 0xd8d0c0, 0.3, 0.5);
      } else if (e.type === 'airAdrift') {
        msgs.push({ side: b.airships[e.air].side, text: `${b.airships[e.air].def.name} drifts with no crew` });
      } else if (e.type === 'airRescue') {
        msgs.push({ side: b.airships[e.air].side, text: `${b.airships[e.air].def.name} goes in to lift troops out` });
      } else if (e.type === 'airLift') {
        msgs.push({ side: b.airships[e.air].side, text: `${e.n} troops climb the ladders` });
      } else if (e.type === 'airUnload') {
        if (e.n) msgs.push({ side: b.airships[e.air].side, text: `${e.n} rescued troops set down behind the lines` });
      } else if (e.type === 'airRefit') {
        msgs.push({ side: b.airships[e.air].side, text: `${b.airships[e.air].def.name} runs for a mooring tower` });
      } else if (e.type === 'airDown') {
        const a = b.airships[e.air];
        this.airModels[e.air].downAt = this.time;
        this.airPos(a, 1, v);
        for (let k = 0; k < 6; k++) st.puff(v.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 2, (Math.random() - 0.5) * 2)), k % 2 ? 0xff8a30 : 0x3a3632, 1.1, 1.8);
        msgs.push({ side: 1 - a.side, text: `${a.def.name} is shot down!` });
      } else if (e.type === 'flank') {
        msgs.push({ side: e.side, text: `${e.name} squad swings wide to flank` });
      } else if (e.type === 'regroup') {
        msgs.push({ side: e.side, text: `Broken ${e.name} squad falls back to regroup` });
      }
    }
    return msgs;
  }

  // run fn after `ticks` game ticks of animation time
  later(ticks, fn) { this.timers.push({ at: this.time + (ticks * TICK_MS) / 1000 / this.speed, fn }); }

  update(alpha, t, dt, speed = 1) {
    const b = this.b;
    if (!b) return;
    this.time = t; this.speed = speed;
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.at <= t);
      this.timers = this.timers.filter((x) => x.at > t);
      for (const x of due) x.fn();
    }
    b.guns.forEach((g, i) => {
      const gm = this.gunMarks[i];
      const turret = gm.model.userData.turret;
      let d = g.aim - gm.aim; d = Math.atan2(Math.sin(d), Math.cos(d));
      gm.aim += d * Math.min(1, dt * 6);
      if (turret) {
        turret.rotation.y = -gm.aim;
        const kick = (b.tick + alpha - g.lastFire) * 0.6 * speed;
        turret.position.x = kick >= 0 && kick < 0.4 ? -Math.cos(gm.aim) * 0.12 * (1 - kick / 0.4) : 0;
        turret.position.z = kick >= 0 && kick < 0.4 ? -Math.sin(gm.aim) * 0.12 * (1 - kick / 0.4) : 0;
      }
      if (gm.owner !== g.owner) {
        gm.owner = g.owner;
        gm.cloth.material.color.set(g.owner === null ? 0xbbbbbb : SIDE_COLORS[g.owner]);
      }
      setBar(gm.bar, g.hp / g.maxHp);
      if (g.destroyed && !gm.wrecked) {
        gm.wrecked = true;
        gm.model.rotation.z = 0.35; gm.model.position.y -= 0.15; gm.bar.visible = false;
        gm.model.traverse((c) => { if (c.isMesh && c.material.color) { c.material = c.material.clone(); c.material.color.multiplyScalar(0.35); } });
      }
    });
    b.ships.forEach((sh, i) => {
      const m = this.shipModels[i];
      const sunk = this.shipSunkAt.get(i);
      if (!sh.alive && sunk === undefined) { m.visible = false; return; }
      const x = sh.px + (sh.x - sh.px) * alpha, y = sh.py + (sh.y - sh.py) * alpha;
      let dh = sh.heading - sh.ph; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      m.position.set(x, this.waveY(x, y) - 0.1, y);
      m.rotation.y = -(sh.ph + dh * alpha);
      m.rotation.z = Math.sin(t * 1.1 + i) * 0.04;
      if (m.userData.beast && sunk === undefined) animateCreature(m.userData.beast, t, i * 1.3);
      if (m.userData.lod) {
        const ratio = this.stage.camera.position.distanceTo(m.position) / 1.5;
        let lv = 0; while (lv < 5 && ratio > [14, 30, 60, 110, 200][lv]) lv++;
        setLod(m, lv);
      }
      if (sunk !== undefined) {
        const k = (t - sunk) * speed;
        m.position.y -= k * 0.7; m.rotation.x = Math.min(0.6, k * 0.3);
        m.userData.bar.visible = false; m.userData.ring.visible = false;
        if (k > 3) m.visible = false;
      } else setBar(m.userData.bar, sh.hp / sh.maxHp);
    });
    if (this.water) {
      const p = this.water.geometry.attributes.position, base = this.waterBase;
      for (let k = 0; k < p.count; k++) p.array[k * 3 + 1] = Math.sin(base[k * 3] * 0.35 + t * 1.3) * 0.045 + Math.cos(base[k * 3 + 2] * 0.3 + t * 1.0) * 0.04;
      p.needsUpdate = true;
      if ((this.waterTick = (this.waterTick || 0) + 1) % 3 === 0) this.water.geometry.computeVertexNormals();
    }
    if (this.grid) this.grid.visible = b.tick === 0;
    this.updateFlags(alpha, t, dt);
    const v = new THREE.Vector3();
    const tickNow = b.tick + alpha;
    const cam = this.stage.camera.position;
    while (this.models.length < b.units.length) this.models.push(this.addUnitModel(b.units[this.models.length]));
    b.units.forEach((u, i) => {
      const m = this.models[i];
      if (!m) return;
      let died = this.deathAt.get(i);
      if (!u.alive && died === undefined) {
        // already dead when this view first saw it: lay the body straight away
        if (u.aboard >= 0) { m.visible = false; return; }
        this.deathAt.set(i, -1e6); died = -1e6;
      }
      let dead = 0;
      if (died !== undefined) {
        if (this.noBody.has(i)) { m.visible = false; return; }
        if (m.userData.corpse) return; // lying where it fell
        // the pose is complete at 0.5; past that the family animators sink the body, which we no longer want
        const dd = m.userData.death;
        dead = Math.min(0.5, ((t - died) * speed) / (dd ? dd.dur : 1.2) / 2);
        m.userData.bar.visible = false; m.userData.disc.visible = false;
      }
      m.visible = true;
      this.unitPos(u, died !== undefined ? 1 : alpha, m.position);
      // Natural movement: the engine steps tile to tile, but a soldier glides after his place in the
      // grid, cuts corners, keeps his own spot within the tile, and turns the way he is really going.
      let walkDir = null, walked = 0;
      const ud = m.userData;
      if (u.aboard < 0) {
        if (u.def.size === 1) { m.position.x += (((u.id * 73) % 17) / 17 - 0.5) * 0.3; m.position.z += (((u.id * 137) % 19) / 19 - 0.5) * 0.3; } // not ruler-straight ranks
        if (died !== undefined) { if (ud.sp) m.position.copy(ud.sp); } // he lies where he actually was
        else if (!ud.sp || ud.sp.distanceToSquared(m.position) > 16) ud.sp = m.position.clone();
        else {
          const k = 1 - Math.exp(-dt * speed * (6.5 + (u.id % 5) * 0.5));
          const ox = ud.sp.x, oz = ud.sp.z;
          ud.sp.lerp(m.position, k);
          const dx = ud.sp.x - ox, dz = ud.sp.z - oz;
          walked = Math.hypot(dx, dz);
          const v = walked / Math.max(1e-4, dt * speed);
          ud.vel = (ud.vel || 0) + (v - (ud.vel || 0)) * Math.min(1, dt * 8);
          if (ud.vel > 0.5) walkDir = Math.atan2(dz, dx);
          m.position.copy(ud.sp);
        }
      } else { ud.sp = null; ud.vel = 0; }
      const dth = m.userData.death;
      if (dth && dth.fling && dead > 0) {
        // thrown by the blast: out along its line, up and down again
        const k = Math.min(1, dead * 2);
        m.position.x += dth.fling.x * k; m.position.z += dth.fling.z * k; m.position.y += Math.sin(k * Math.PI) * dth.fling.h;
      }
      let duel = m.userData.duel;
      if (duel) { const k = (t - duel.t0) * speed / duel.dur; if (k >= 1 || !u.alive) { m.userData.duel = null; duel = null; } else duel.k = Math.max(0, k); }
      const since = (tickNow - u.lastAttack) * 0.6 * 1.6;
      const atk = since >= 0 && since < 1 ? since : -1;
      const facing = dth ? dth.face : duel && b.units[duel.other] ? Math.atan2(b.units[duel.other].y - u.y, b.units[duel.other].x - u.x) : walkDir !== null && atk < 0 ? walkDir : u.face;
      const want = Math.PI / 2 - facing;
      let d = want - m.userData.rotY; d = Math.atan2(Math.sin(d), Math.cos(d));
      m.userData.rotY += d * Math.min(1, dt * 7 * Math.max(1, speed * 0.6));
      m.rotation.y = m.userData.rotY;
      const moving = u.alive && u.aboard < 0 && ((ud.vel || 0) > 0.35 || (!ud.sp && (u.x !== u.px || u.y !== u.py)));
      // the stride follows the ground covered, so feet do not skate; standing still, the clock runs on time
      ud.clock = (ud.clock ?? t) + (moving ? walked * 0.64 : dt);
      const airborne = !!u.def.fly && u.alive && !(u.landedUntil > b.tick);
      if (m.userData.lod) {
        // detail follows how large the unit is on screen
        const ratio = cam.distanceTo(m.position) / Math.max(1, u.def.size * 0.8);
        let lv = 0; while (lv < LOD_STEPS.length && ratio > LOD_STEPS[lv]) lv++;
        if (dead > 0 || duel) lv = Math.min(lv, m.userData.lod.levels - 2); // the far level cannot bend, and these must
        setLod(m, lv);
      }
      animateUnit(m, airborne ? t : ud.clock, moving || airborne, duel && duel.role === 'a' && atk < 0 ? duel.k : atk, dead, m.userData.phase, airborne, dth || duel ? { death: dth, duel } : null);
      if (u.def.fly) m.userData.disc.position.y = -(m.position.y - Math.max(0, this.groundY(u.x, u.y))) + 0.02;
      m.userData.rig?.mixer?.update(dt * speed);
      if (u.alive) { m.userData.bar.visible = u.hp < u.def.hp; if (u.hp < u.def.hp) setBar(m.userData.bar, u.hp / u.def.hp); }
      if (u.aboard >= 0) m.scale.setScalar(Math.min(0.75, 1 / u.def.size)); else m.scale.setScalar(1);
      if (u.carry || m.userData.load) {
        if (!m.userData.load) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.26), mat(0xa07a48)); l.position.set(0, m.userData.top - 0.02, 0.05); m.add(l); m.userData.load = l; }
        m.userData.load.visible = !!u.carry && u.alive;
      }
      if (dead >= 0.5) this.layBody(u, m);
    });
    this.updateAir(alpha, t, dt, speed);
    for (const cm of this.cableMarks || []) {
      // the car shuttles while both towers stand; when one falls the cable drops and the car with it
      if (cm.cb.live) { const ph = ((t * speed * 0.09 + cm.cb.a * 0.3) % 2); const k = ph < 1 ? ph : 2 - ph; cm.car.position.lerpVectors(cm.pa, cm.pz, k * k * (3 - 2 * k)); cm.car.position.y -= Math.sin(k * Math.PI) * 0.35; cm.car.rotation.y = Math.atan2(cm.pa.x - cm.pz.x, cm.pa.z - cm.pz.z) + Math.PI / 2; }
      else if (cm.line.visible) { cm.line.visible = false; this.tumbling.push({ c: { g: cm.car, k: 3 }, v: new THREE.Vector3(0.3, 0, 0.2), w: new THREE.Vector3(1, 0.5, 2), wait: 0, rest: 0.4 }); }
    }
    // masonry in the air
    if (this.tumbling.length) {
      const h = Math.min(0.05, dt) * Math.max(1, Math.min(3, speed));
      this.tumbling = this.tumbling.filter((q) => {
        if (q.wait > 0) { q.wait -= h; return true; }
        q.v.y -= 9.8 * h;
        q.c.g.position.addScaledVector(q.v, h);
        q.c.g.rotation.x += q.w.x * h; q.c.g.rotation.y += q.w.y * h; q.c.g.rotation.z += q.w.z * h;
        if (q.c.g.position.y <= q.rest) {
          q.c.g.position.y = q.rest;
          if (Math.abs(q.v.y) < 1.2) return false; // settled
          q.v.y *= -0.25; q.v.x *= 0.5; q.v.z *= 0.5; q.w.multiplyScalar(0.4);
          if (Math.random() < 0.3) { const wp = q.c.g.getWorldPosition(new THREE.Vector3()); this.stage.puff(wp, 0xb0a898, 0.3, 0.8); }
        }
        return true;
      });
    }
    // wounded buildings and guns smoke
    if ((this.smokeT += dt) > 0.25) {
      this.smokeT = 0;
      for (let k = 0; k < 3; k++) {
        const i = Math.floor(Math.random() * this.structModels.length), m = this.structModels[i];
        if (!m || !m.userData.stage || m.userData.stage > 2 || !m.visible) continue;
        const s = b.structures[i];
        v.set(s.x + Math.random() * s.w, (m.userData.tall || 1) * (m.userData.stage === 2 ? 0.55 : 0.85), s.y + Math.random() * s.h);
        this.stage.puff(v.clone(), m.userData.stage === 2 && Math.random() < 0.4 ? 0xff7a28 : 0x3e3a36, 0.3 + m.userData.stage * 0.12, 1.6);
      }
    }
    b.crafts.forEach((c, i) => {
      const m = this.crafts[i];
      if (c.sunk) { m.position.y -= dt * 0.5 * speed; if (m.position.y < -2) m.visible = false; return; }
      const x = c.px + (c.x - c.px) * alpha, y = c.py + (c.y - c.py) * alpha;
      m.position.set(x + 0.5, c.landed ? -0.12 : this.waveY(x, y) - 0.05, y + 0.5);
      m.userData.gun.rotation.y = -c.aim - m.rotation.y; m.userData.gun.visible = c.crew > 0;
      m.userData.pips.forEach((p, k) => { p.visible = k < c.crew; });
      if (c.wrecked && !m.userData.wrecked) { m.userData.wrecked = true; m.traverse((o) => { if (o.isMesh && o.material.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.4); } }); }
      m.rotation.z = c.landed ? 0 : Math.sin(t * 1.3 + i) * 0.04;
      m.userData.ramp.rotation.z = c.landed ? -Math.min(1.4, (m.userData.rampT = (m.userData.rampT || 0) + dt * 2 * speed)) : 0;
      setBar(m.userData.bar, c.hp / c.maxHp);
      m.userData.bar.visible = !c.landed;
    });
  }

  // How a soldier falls depends on what killed him and from where.
  howDied(e) {
    const u = this.b.units[e.id], m = this.models[e.id];
    if (!m) return;
    const seed = (e.id * 2654435761) >>> 8;
    const pick = (seed % 100) / 100;
    const from = e.ax !== undefined ? Math.atan2(e.ay - u.y, e.ax - u.x) : u.face; // bearing to whatever struck him
    let rel = from - u.face; rel = Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel)));
    let style, face = u.face, fling = null;
    if (e.blast) {
      style = 'blast'; face = from;
      const d = 0.9 + pick * 1.6;
      fling = { x: -Math.cos(from) * d, z: -Math.sin(from) * d, h: 0.5 + pick * 0.6 };
    } else if (m.userData.duel && m.userData.duel.kind === 'kill') { style = 'kneel'; face = from; }
    else if (e.style === 'fall' || e.style === 'poison') style = pick < 0.5 ? 'front' : 'kneel';
    else if (e.style === 'melee' || e.style === 'stomp') {
      if (rel > 2.0) style = 'front';            // cut down from behind: pitches forward
      else if (rel > 0.9) style = 'side';         // taken in the flank
      else { style = pick < 0.3 ? 'kneel' : 'back'; face = from; }
    } else { style = pick < 0.6 ? 'back' : pick < 0.85 ? 'side' : 'kneel'; if (style !== 'side') face = from; } // shot or blasted by magic
    m.userData.death = { style, seed, face, fling, dur: 1.0 + pick * 0.5 };
    m.userData.duel = null;
  }

  // A fallen unit becomes one static mesh in its last pose; every body of that type shares the geometry.
  layBody(u, m) {
    m.userData.corpse = true;
    const dd = m.userData.death;
    const key = `${u.def.id}:${dd ? `${dd.style}:${dd.seed & 7}` : ''}`; // a few shared poses per kind of fall
    if (m.userData.lod && m.userData.rig?.v2) {
      if (!this.corpseGeo.has(key)) { setLod(m, 0); setLod(m, 2); this.corpseGeo.set(key, bakePose(m, 2)); }
      const geo = this.corpseGeo.get(key);
      if (geo) {
        const body = new THREE.Mesh(geo, sculptMaterial());
        body.receiveShadow = true;
        for (const c of [...m.children]) if (c !== m.userData.bar && c !== m.userData.disc) c.visible = false;
        m.add(body);
      }
    }
    m.updateMatrixWorld(true);
  }

  updateAir(alpha, t, dt, speed) {
    const b = this.b, v = new THREE.Vector3();
    b.airships.forEach((a, i) => {
      const am = this.airModels[i], m = am.m;
      const x = a.px + (a.x - a.px) * alpha, y = a.py + (a.y - a.py) * alpha;
      let dh = a.heading - a.ph; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const ground = Math.max(0, this.groundY(Math.round(x), Math.round(y)));
      let alt = a.def.altitude + Math.sin(t * 0.9 + i * 2) * 0.12;
      if (a.mode === 'rescue' || a.mode === 'ferry' || a.ladder > 0) alt -= 0.8;
      am.alt = am.alt === undefined ? alt : am.alt + (alt - am.alt) * Math.min(1, dt * 1.5);
      m.rotation.set(0, -(a.ph + dh * alpha), Math.sin(t * 0.7 + i) * 0.015);
      const level = !a.alive ? 3 : a.hp > a.maxHp * 0.66 ? 0 : a.hp > a.maxHp * 0.33 ? 1 : 2;
      if (level !== am.dmg) { am.dmg = level; m.userData.setDamage?.(level); }
      if (am.side !== a.side) { am.side = a.side; m.userData.setSide?.(SIDE_COLORS[a.side]); am.mark.material.color.set(SIDE_COLORS[a.side]); }
      if (am.downAt !== undefined) {
        // she comes down burning and lies where she fell
        const k = Math.min(1, ((t - am.downAt) * speed) / 3);
        m.position.set(x, ground + 0.9 + (am.alt - 0.9) * (1 - k * k), y);
        m.rotation.z = k * 0.35; m.rotation.x = k * 0.12;
        am.bar.visible = am.crew.visible = am.ladder.visible = false; am.mark.visible = false;
        if (k < 1 && Math.random() < 0.5) this.stage.puff(v.set(x + (Math.random() - 0.5) * 4, m.position.y + 1.5, y + (Math.random() - 0.5) * 2).clone(), Math.random() < 0.5 ? 0xff8030 : 0x2e2a28, 0.7, 1.4);
        else if (k >= 1 && Math.random() < 0.04) this.stage.puff(v.set(x + (Math.random() - 0.5) * 4, ground + 1.2, y + (Math.random() - 0.5) * 2).clone(), 0x2e2a28, 0.6, 2);
        return;
      }
      m.position.set(x, ground * 0.3 + am.alt, y);
      am.mark.position.set(x, ground + 0.06, y);
      for (const p of m.userData.props || []) p.rotation.x = t * (a.crew > 0 ? 22 : 2);
      setBar(am.bar, a.hp / a.maxHp); setBar(am.crew, a.crew / a.def.crew);
      const down = a.ladder > 0 || ((a.mode === 'rescue' || a.mode === 'ferry') && Math.hypot((a.pick || a.drop || a).x - a.x, (a.pick || a.drop || a).y - a.y) < 3);
      am.ladder.visible = down; if (down) am.ladder.scale.y = Math.max(0.5, m.position.y - ground - 0.2);
      if (m.userData.lod) { const ratio = this.stage.camera.position.distanceTo(m.position) / 2.5; let lv = 0; while (lv < 5 && ratio > [14, 30, 60, 110, 200][lv]) lv++; setLod(m, lv); }
      // the worse the damage, the more she smokes
      if (level && (am.smoke += dt) > (level === 1 ? 0.5 : 0.18)) {
        am.smoke = 0;
        this.stage.puff(v.set(x + (Math.random() - 0.5) * a.radius, m.position.y + 1.5 + Math.random() * 1.5, y + (Math.random() - 0.5) * 1.5).clone(), level === 2 && Math.random() < 0.35 ? 0xff7a28 : 0x35312e, 0.45, 1.5);
      }
    });
    // drop pods on their way down, then standing where they landed
    this.falling = this.falling.filter((f) => {
      const k = Math.min(1, (t - f.t0) / f.dur);
      f.obj.position.lerpVectors(f.from, f.to, k * k);
      f.obj.rotation.y = k * 2;
      return true;
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
    if (tool.kind === 'erase' || tool.kind === 'delUnit') color = 0xff4040;
    if (tool.kind === 'move') color = tool.held ? 0x60e080 : 0xf0d060;
    if (tool.kind === 'craft') color = SIDE_COLORS[tool.side];
    if (tool.kind === 'unit') color = SIDE_COLORS[tool.side];
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, h), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false }));
    m.position.set(tile.x + w / 2, 0.08, tile.y + h / 2);
    m.renderOrder = 20;
    if ((tool.kind === 'unit' || tool.kind === 'move' || tool.kind === 'delUnit') && tool.brush > 1) { const r = Math.ceil(Math.sqrt(tool.brush)); m.scale.set(r, 1, r); }
    this.ghost = m;
    this.root.add(m);
  }
}

function hashTerrain(t) { let h = 0; for (let i = 0; i < t.length; i += 7) h = (h * 31 + t[i]) | 0; return h; }
