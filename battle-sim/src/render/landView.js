// Renders a land/amphibious battle state produced by engine/battle.js.
import * as THREE from 'three';
import { Crews } from './crews.js';
import { buildSkyModel, animateSky } from './skyParts.js';
import { animateCreature, buildUnitModel, animateUnit, buildStructure, buildCraft, buildShip, buildRubble, buildAirship, buildDropPod, buildCableCar, buildBalloon, buildTrain, buildHalt, shipMuzzle, setLod, mat, LEVEL_H } from './models.js';
import { bakePose } from './rigkit.js';
import { sculptMaterial } from './sculpt.js';
import { LIFTED } from '../engine/airship.js';
import { RIDE, sideFaction } from '../engine/transit.js';
import { transitLook, buildConsist, buildGondola, buildBalloonFor, buildVessel, trackLook } from './props/transit.js';
import { loadFracture, fractureModel } from './fracture.js';
import { makeBar, setBar } from './stage.js';
import { STRUCTURES } from '../data/structures.js';
import { structureFootprint } from '../engine/battle.js';
import { GRASS, DEEP, SHALLOW, SAND, BIOMES } from '../engine/terrain.js';
import { buildGround, buildCover } from './groundcover.js';
import { SCENERY, animateScenery } from './registry.js';
import { REALMS } from '../data/realms.js';
import { getDetail } from './rigkit.js';
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

  dispose() { this.stage.scene.remove(this.root); this.crews?.dispose(); }

  buildTerrain(b) {
    const key = `${b.mode}:${b.W}:${b.shape}:${b.biome}:${hashTerrain(b.terrain)}:${b.height ? hashRelief(b.height, b.cliff) : 0}`;
    if (this.terrainKey === key) return;
    this.terrainKey = key;
    const bio = BIOMES[b.biome] || BIOMES.temperate;
    if (this.terrain) this.root.remove(this.terrain);
    const g = new THREE.Group();
    const W = b.W;
    // the ground follows the battle's hills and cliffs, with soil, meadow and rock painted in (see groundcover.js)
    const gr = buildGround(b, bio, b.biome);
    this.hCorner = gr.hCorner; this.heightAt = gr.heightAt;
    g.add(gr.mesh);

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
      // a railway laid for a line of supply is drawn as one curving track with the line (see load)
      const m = s.type === 'rail' && s.line !== undefined ? new THREE.Group() : buildStructure(def, w, h, { x: s.x, y: s.y, side: s.side ?? s.owner ?? null, style: s.style || this.b.style || null, look: s.look || this.b.look || null });
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
    for (const R of b.reserve || []) for (const w of R) for (const d of w.defs) add(`u:${d.id}`, d.name || d.id, () => buildUnitModel(d));
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
    if (u.def.leader) {
      // the general: a crown of gold over his head and a gold ring at his feet, though he stands no taller than his men
      const gold = new THREE.MeshBasicMaterial({ color: 0xffd24a });
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 14).rotateX(Math.PI / 2), gold);
      crown.position.y = top + 0.32; m.add(crown);
      for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 4), gold); sp.position.set(Math.cos(k * 1.2566) * 0.2, top + 0.4, Math.sin(k * 1.2566) * 0.2); m.add(sp); }
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.62 * u.def.size, 0.74 * u.def.size, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.8 }));
      halo.position.y = 0.03; m.add(halo);
      m.userData.crown = crown;
    }
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
    this.crews?.dispose();
    this.crews = new Crews(this.stage.scene);
    this.shipModels = b.ships.map((sh) => {
      const m = buildShip(sh.def, SIDE_COLORS[sh.side]);
      if (!sh.def.beast) this.crews.track(m, `ship:${sh.def.id}`);
      const bar = makeBar(0x4fd36a); bar.position.y = (m.userData.top ?? 1.7 + sh.def.len * 0.35) + 0.3; setBar(bar, 1, Math.min(3, sh.def.len * 0.4));
      m.add(bar); m.userData.bar = bar;
      const ring = new THREE.Mesh(new THREE.RingGeometry(sh.radius + 0.3, sh.radius + 0.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: SIDE_COLORS[sh.side], transparent: true, opacity: 0.6 }));
      ring.position.y = 0.05; m.add(ring); m.userData.ring = ring;
      this.dynamic.add(m);
      return m;
    });
    this.crafts = b.crafts.map((c) => this.craftModel(c));
    this.airModels = b.airships.map((a) => {
      const m = buildSkyModel(a.def, SIDE_COLORS[a.side]) || buildAirship(a.def, SIDE_COLORS[a.side]);
      m.userData.setSide?.(SIDE_COLORS[a.side]);
      // hands in the gondola (or riders on the beast's back): find where they stand before the bars go on, then draw her big enough to see them
      if (!m.userData.crewSlots) this.crews.track(m, `air:${a.def.id}`, { airship: true });
      m.scale.multiplyScalar(AIR_SCALE);
      const top = (m.userData.top ?? 4.2) + 0.5 / AIR_SCALE;
      const bar = makeBar(0x4fd36a); bar.position.y = top; setBar(bar, 1, 3.2); bar.scale.setScalar(1 / AIR_SCALE); m.add(bar);
      const crew = makeBar(0xe8d8a0); crew.position.y = top - 0.24 / AIR_SCALE; setBar(crew, 1, 2.2); crew.scale.setScalar(1 / AIR_SCALE); m.add(crew);
      const lp = (m.userData.ladders || [[0, 0, 0.7]])[0];
      const ladder = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 5).translate(0, -0.5, 0), mat(0xc8b48a));
      ladder.position.set(lp[0], lp[1], lp[2]); ladder.visible = false; ladder.scale.set(1 / AIR_SCALE, 1, 1 / AIR_SCALE); m.add(ladder);
      const mark = new THREE.Mesh(new THREE.RingGeometry(a.radius * 0.5, a.radius * 0.5 + 0.25, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: SIDE_COLORS[a.side], transparent: true, opacity: 0.5 }));
      this.dynamic.add(m, mark);
      return { m, bar, crew, ladder, mark, side: a.side, dmg: 0, downAt: undefined, smoke: 0 };
    });
    this.falling = [];
    // trains, cable cars and balloons: each line's vehicle, and what it runs on
    this.cableMarks = [];
    this.transitMarks = ((b.transit && b.transit.lines) || []).map((L) => {
      const col = SIDE_COLORS[L.side], tm = { L, tops: null, line: null, car: null, fell: false, smoke: 0 };
      const look = transitLook(L.faction || sideFaction(b, L.side));
      if (L.kind === 'boat') {
        // the boat follows the waterway, its corners rounded off
        const P = L.path, n = P.length;
        tm.pts = P.map((_, k) => { let x = 0, y = 0; for (let j = -2; j <= 2; j++) { const q = P[Math.max(0, Math.min(n - 1, k + j))]; x += q[0]; y += q[1]; } return [x / 5 + 0.5, y / 5 + 0.5]; });
        tm.car = buildVessel(look, col, L.vessel || 'riverboat');
        tm.car.visible = !L.idle;
      } else if (L.kind === 'rail') {
        // the line the cars follow: the tile path with its corners rounded off
        const P = L.path, n = P.length;
        tm.pts = P.map((_, k) => { let x = 0, y = 0; for (let j = -2; j <= 2; j++) { const q = P[Math.max(0, Math.min(n - 1, k + j))]; x += q[0]; y += q[1]; } return [x / 5 + 0.5, y / 5 + 0.5]; });
        this.layTrack(tm.pts, trackLook(look));
        tm.cars = buildConsist(look, col);
        tm.beasts = look.savage;
        for (const c of tm.cars) this.dynamic.add(c);
        // offsets of each car's middle behind the head of the train, in tiles
        let off = 0; tm.offs = tm.cars.map((c) => { const o = off + c.userData.len / 2; off += c.userData.len + 0.25; return o; }); tm.total = off;
        for (const s of L.stops) {
          if (s.depot) continue;
          // the halt stands beside the track, on the side the rally point is
          const k = s.k, a = L.path[Math.max(0, k - 1)], z = L.path[k], dx = z[0] - a[0], dy = z[1] - a[1];
          const p = s.point >= 0 ? b.cmd.points[s.point] : null, sgn = p && (dx ? p.y < s.y : p.x < s.x) ? -1 : 1;
          const h = buildHalt(col);
          h.position.set(s.x + 0.5 + (dx ? -dx * 1.5 : sgn * 1.1), Math.max(0, this.groundY(s.x, s.y)), s.y + 0.5 + (dx ? sgn * 1.1 : -dy * 1.5));
          h.rotation.y = dx ? (sgn > 0 ? 0 : Math.PI) : (sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
          this.dynamic.add(h);
        }
      } else {
        const top = (m) => (L.kind === 'balloon' ? (m.userData.tall || 3.3) + 0.25 : m.userData.cableAt ? m.userData.cableAt[1] : (m.userData.tall || 4) - 0.2);
        tm.tops = L.stops.map((s) => { const m = this.structModels[s.st]; return new THREE.Vector3(s.x, m.position.y + top(m), s.y); });
        if (L.kind === 'cable') {
          tm.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(tm.tops), new THREE.LineBasicMaterial({ color: 0x2a2620 }));
          this.dynamic.add(tm.line);
          tm.car = buildGondola(look, col);
        } else tm.car = buildBalloonFor(look, col);
      }
      if (tm.car) this.dynamic.add(tm.car);
      return tm;
    });
    this.pointMarks = new Map(); this.crateMarks = new Map(); this.siteMarks = new Map();
    // grasses, flowers, stones and the rest of what lies underfoot, thicker at higher graphics settings
    if (this.cover) this.root.remove(this.cover);
    this.cover = buildCover(b, b.biome, this.heightAt, { low: 0.3, medium: 0.65, high: 1, ultra: 1.4 }[getDetail()] ?? 0.65);
    this.root.add(this.cover);
    this.buildScenery(b);
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
  /** a landing craft: the boat, its bow gun, its crew and a bar for its hull */
  craftModel(c) {
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
  }
  reviveUnit(id) {
    const old = this.models[id];
    if (old) this.dynamic.remove(old);
    this.deathAt.delete(id); this.noBody.delete(id);
    this.models[id] = this.addUnitModel(this.b.units[id]);
  }
  /** a fixed rally point: a tall banner in its holder's colour over a ring marking the ground that must be held */
  markFixed(p) {
    const g = new THREE.Group(), y = Math.max(0, this.groundY(p.x, p.y)), col = SIDE_COLORS[p.side], H = p.role === 'hq' ? 5 : 4;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, H, 6).translate(0, H / 2, 0), mat(0x4a3a26)));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6).translate(0, H + 0.08, 0), mat(0xd8b04a, { metalness: 0.9, roughness: 0.3 })));
    const geo = new THREE.PlaneGeometry(p.role === 'hq' ? 2.2 : 1.7, p.role === 'hq' ? 1.3 : 1.0, 6, 2);
    const pennant = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, roughness: 0.85, emissive: col, emissiveIntensity: 0.15 }));
    pennant.position.set((p.role === 'hq' ? 1.1 : 0.85) + 0.06, H - (p.role === 'hq' ? 0.75 : 0.6), 0); pennant.castShadow = true;
    g.add(pennant);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.7, 4.0, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5 }));
    ring.position.y = 0.06; g.add(ring);
    // a headquarters wears a second, gold ring
    if (p.role === 'hq') { const r2 = new THREE.Mesh(new THREE.RingGeometry(4.15, 4.3, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.6 })); r2.position.y = 0.06; g.add(r2); }
    const stores = buildStructure(STRUCTURES.crates, 1, 1, null);
    stores.position.set(0.9, 0, 0.7); stores.visible = p.stock > 0; g.add(stores);
    g.position.set(p.x + 0.5, y, p.y + 0.5);
    this.dynamic.add(g);
    this.pointMarks.set(p.id, { g, stores, pennant, ring, base: geo.attributes.position.array.slice(), fixed: true });
  }
  /** one curving line of track along these points: ballast, sleepers and two rails, or for a pack trail a beaten path with marker stakes */
  layTrack(pts, T) {
    const seen = new Set(), segs = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], c = pts[k + 1], key = `${Math.round((a[0] + c[0]) * 2)},${Math.round((a[1] + c[1]) * 2)}`;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.02 || seen.has(key)) continue;
      seen.add(key);
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      segs.push({ mx, mz, len, ang: Math.atan2(-(c[1] - a[1]), c[0] - a[0]), y: Math.max(0, this.groundY(Math.floor(mx), Math.floor(mz))) });
    }
    if (!segs.length) return;
    const dummy = new THREE.Object3D();
    const strip = (geo, material, per, place) => {
      const im = new THREE.InstancedMesh(geo, material, segs.length * per);
      let n = 0;
      for (const [i, s] of segs.entries()) for (let j = 0; j < per; j++) if (place(dummy, s, j, i) !== false) { dummy.updateMatrix(); im.setMatrixAt(n++, dummy.matrix); }
      im.count = n; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true;
      this.dynamic.add(im);
    };
    const along = (o, s, y, side = 0, fwd = 0, sx = 1) => { o.position.set(s.mx + Math.cos(s.ang) * fwd - Math.sin(s.ang) * side * -1 * 0 + Math.sin(s.ang) * side, s.y + y, s.mz - Math.sin(s.ang) * fwd + Math.cos(s.ang) * side); o.rotation.set(0, s.ang, 0); o.scale.set(sx, 1, 1); };
    strip(new THREE.BoxGeometry(1, 0.05, T.trail ? 1.1 : 0.95), mat(T.bed, { roughness: 1 }), 1, (o, s) => along(o, s, 0.03, 0, 0, s.len + 0.12));
    if (T.trail) {
      // marker stakes with a scrap of hide, now on one side and now on the other
      strip(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 5).translate(0, 0.45, 0), mat(0x5a4026), 1, (o, s, j, i) => (i % 5 === 2 ? along(o, s, 0, i % 10 === 2 ? 0.75 : -0.75) : false));
      strip(new THREE.BoxGeometry(0.3, 0.2, 0.03).translate(0.15, 0.8, 0), mat(T.stake), 1, (o, s, j, i) => (i % 5 === 2 ? along(o, s, 0, i % 10 === 2 ? 0.75 : -0.75) : false));
      return;
    }
    strip(new THREE.BoxGeometry(0.16, 0.06, 0.8), mat(T.sleeper), 2, (o, s, j) => along(o, s, 0.07, 0, (j - 0.5) * s.len * 0.5));
    const iron = T.glow ? new THREE.MeshStandardMaterial({ color: T.rail, emissive: T.glow, emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.45 }) : mat(T.rail, { metalness: 0.6, roughness: 0.45 });
    strip(new THREE.BoxGeometry(1, 0.07, 0.06), iron, 2, (o, s, j) => along(o, s, 0.13, j ? 0.26 : -0.26, 0, s.len + 0.06));
  }
  /** what a faction's stretchers are made of: its own cloth on poles of its own kind */
  stretcherFor(side) {
    const fac = this.b.sides[side]?.faction, realm = REALMS.find((r) => r.id === fac);
    const cloth = realm ? realm.P.cloth : { kingdom: 0xe8e0d0, goblin: 0x7a6a4a, undead: 0x5a5a66, infernal: 0x6a1a14, beasts: 0x8a6a4a, elemental: 0x9ab0c8, dragons: 0x8a3a2a }[fac] ?? 0xe8e0d0;
    const poles = ['undead', 'crimson', 'khemet', 'drowned'].includes(fac) ? 0xe8e0c8 : ['grom', 'ashur', 'ironbound', 'infernal'].includes(fac) ? 0x4a4a50 : ['tianlong', 'shogunate', 'xibalba', 'thousandgods', 'verdant'].includes(fac) ? 0xa8a04a : 0x5a4026;
    const g = new THREE.Group();
    for (const z of [-0.2, 0.2]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 5).rotateZ(Math.PI / 2).translate(0, 0, z), mat(poles)));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.4), new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.9 })));
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.7, 3, 8).rotateZ(Math.PI / 2).translate(0, 0.12, 0), mat(SIDE_COLORS[side]));
    g.add(body, new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6).translate(0.5, 0.14, 0), mat(0xd9a77c)));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.42).translate(-0.2, 0.2, 0), new THREE.MeshStandardMaterial({ color: side === 0 ? 0xf4f4f0 : 0xf4f4f0, roughness: 0.9 }))); // a blanket
    g.position.set(0, 0.55, -0.75); g.rotation.y = Math.PI / 2;
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  /** plants, beasts and oddments of the land, by its climate: decoration only, thinner at lower graphics settings */
  buildScenery(b) {
    if (this.sceneryGroup) this.root.remove(this.sceneryGroup);
    const g = (this.sceneryGroup = new THREE.Group()); this.scenery = [];
    this.root.add(g);
    const plan = LAND_SCENERY[b.biome];
    if (!plan) return;
    const W = b.W, H = b.H, T = b.terrain, budget = { low: 50, medium: 110, high: 190, ultra: 280 }[getDetail()] ?? 110;
    const tiles = { open: [], sand: [], shallow: [], cliff: [], air: [] };
    const h2 = (x, y, k) => { let h = (x * 374761393 + y * 668265263 + k * 1274126177 + (b.seed | 0)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const nearBuilt = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = (y + dy) * W + x + dx; if (b.sid[i] || b.level[i] || b.door[i] >= 0) return true; } return false; };
    const nearLand = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const t = T[(y + dy) * W + x + dx]; if (t === GRASS || t === SAND) return true; } return false; };
    for (let y = 3; y < H - 3; y += 1) for (let x = 3; x < W - 3; x += 1) {
      if (h2(x, y, 1) > 0.34) continue; // a third of the tiles are candidates
      const i = y * W + x, t = T[i];
      if (b.cliff && b.cliff[i]) { tiles.cliff.push(i); continue; }
      if (t === SHALLOW) { if (nearLand(x, y)) tiles.shallow.push(i); continue; }
      if (t === DEEP || nearBuilt(x, y) || b.blockMove[i]) continue;
      if (t === SAND) tiles.sand.push(i); else if (t === GRASS) { tiles.open.push(i); if (h2(x, y, 2) < 0.3) tiles.air.push(i); }
    }
    const land = tiles.open.length + tiles.sand.length + 1;
    let made = 0;
    plan.forEach(([key, per, where, [s0, s1]], li) => {
      const make = SCENERY[key], list = tiles[where];
      if (!make || !list || !list.length) return;
      const n = Math.min(list.length, Math.max(per >= 1 ? 1 : 0, Math.round(per * (land * 3) / 1000 * (budget / 110))));
      for (let k = 0; k < n && made < budget; k++) {
        const i = list[Math.floor(h2(li, k, 7) * list.length)], x = i % W, y = (i / W) | 0, r = h2(x, y, li + 9);
        let o; try { o = make(Math.floor(r * 1000) + li); } catch { o = null; }
        if (!o) continue;
        const px = x + 0.5, pz = y + 0.5, wet = where === 'shallow';
        o.position.set(px, wet ? -0.11 : this.heightAt ? this.heightAt(px, pz) : 0, pz);
        o.rotation.y = r * Math.PI * 2; o.scale.multiplyScalar(s0 + (s1 - s0) * h2(x, y, li + 21));
        g.add(o); this.scenery.push(o); made++;
      }
    });
  }
  markPoint(p) {
    if (this.pointMarks.has(p.id)) return;
    if (p.fixed) { this.markFixed(p); return; }
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
    if (u.aboard >= RIDE) {
      const L = this.b.transit.lines[u.aboard - RIDE], tm = this.transitMarks && this.transitMarks[L.id], k = L.crew ? L.crew.indexOf(u.id) : -1;
      if (k >= 0 && tm && tm.cars && tm.cars[k >> 1]) {
        // a hand at the pump: one at each end of the beam, facing the other
        const c = tm.cars[k >> 1], o = k % 2 ? -0.62 : 0.62;
        out.set(c.position.x + Math.cos(c.rotation.y) * o, c.position.y + (c.userData.deck || 0.58), c.position.z - Math.sin(c.rotation.y) * o);
        return out;
      }
      const car = tm && tm.car, seats = car && car.userData.seats;
      if (car && seats && seats.length > 1) { const i = Math.max(0, L.riders.indexOf(u.id)); out.copy(seats[1 + (i % (seats.length - 1))]); car.localToWorld(out); return out; }
      if (car) out.set(car.position.x + ((u.id % 3) - 1) * 0.25, car.position.y + 0.1, car.position.z + ((u.id % 2) - 0.5) * 0.4); else out.set(L.px + (L.x - L.px) * alpha, 4, L.py + (L.y - L.py) * alpha);
      return out;
    }
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
      } else if (e.type === 'transit') {
        if (e.kind === 'balloon' && e.men) msgs.push({ side: e.side, text: `A balloon ${e.stop && !e.stores ? 'sets down' : 'takes up'} ${e.men} at the mast` });
        else if (e.stores && (this.transitSaid || 0) + 40 < b.tick) { this.transitSaid = b.tick; msgs.push({ side: e.side, text: e.kind === 'rail' ? 'The supply train unloads at the halt' : e.kind === 'cable' ? 'The cable car sets stores down in the district' : 'A balloon brings stores to the outpost' }); }
      } else if (e.type === 'transitHit') {
        const tm = this.transitMarks[e.line];
        if (tm && tm.cars) { const c = tm.cars[0].position; st.puff(new THREE.Vector3(c.x, c.y + 1, c.z), 0xd8c8a0, 0.3, 0.6); }
        if ((this.trainCry || 0) + 80 < b.tick) { this.trainCry = b.tick; msgs.push({ side: e.side, text: tm && tm.beasts ? 'The pack caravan is under attack' : 'The handcars are under attack' }); }
      } else if (e.type === 'transitDown') {
        msgs.push({ side: e.side, text: e.kind === 'rail' ? (e.beasts ? 'The pack beasts are slain: their loads lie on the trail' : 'The handcars are wrecked: their stores lie by the track') : e.kind === 'cable' ? 'The cable falls: the car goes with it' : e.kind === 'boat' ? 'A supply boat is holed and goes down' : 'The balloon has no mast left to fly to' });
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
        if (e.wave) msgs.push({ side: e.side, text: e.landing ? `Wave ${e.wave}: ${e.ids.length} put out in the landing craft` : `Wave ${e.wave}: ${e.ids.length} march in with fresh stores` });
        else if (e.ids.length >= 6) msgs.push({ side: e.side, text: `${e.ids.length} return to the fight` });
      } else if (e.type === 'fell') {
        if ((this.fellSaid || 0) + 20 < b.tick) { this.fellSaid = b.tick; msgs.push({ side: b.units[e.id].side, text: 'The walkway gives way: those on it fall to their deaths' }); }
      } else if (e.type === 'transitOut') {
        if (b.tick > 20) msgs.push({ side: e.side, text: 'Holding two landings, they put their own boat on the water' });
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
      } else if (e.type === 'pointTaken') {
        const pm = this.pointMarks.get(e.point), col = SIDE_COLORS[e.side];
        if (pm) { pm.pennant.material.color.set(col); if (pm.pennant.material.emissive) pm.pennant.material.emissive.set(col); if (pm.ring) pm.ring.material.color.set(col); }
        for (let k = 0; k < 3; k++) st.ring(v.set(e.x + 0.5, 0.06, e.y + 0.5), 2 + k * 1.2, col, 0.8 + k * 0.3);
        msgs.push({ side: e.side, text: e.hq ? 'The enemy headquarters is taken' : 'A rally point changes hands' });
      } else if (e.type === 'stretcherUp') {
        // the wounded man is lifted: his medic carries the stretcher now
        const body = this.models[e.id], med = this.models[e.medic];
        if (body) { body.visible = false; this.noBody.add(e.id); }
        if (med && !med.userData.stretcher) { const sg = this.stretcherFor(b.units[e.medic].side); med.add(sg); med.userData.stretcher = sg; med.userData.stretcherOf = e.id; }
      } else if (e.type === 'stretcherDown') {
        for (const m of this.models) if (m && m.userData.stretcherOf === e.id) { m.remove(m.userData.stretcher); m.userData.stretcher = null; m.userData.stretcherOf = undefined; }
        if (e.dropped) { const body = this.models[e.id]; if (body) { this.noBody.delete(e.id); body.visible = true; body.position.set(e.x + 0.5, Math.max(0, this.groundY(e.x, e.y)), e.y + 0.5); } }
        else { st.ring(v.set(b.units[e.id].x + 0.5, 0.06, b.units[e.id].y + 0.5), 1.2, 0xffffff, 0.7); if (b.tick !== this.aidSaid) { this.aidSaid = b.tick; msgs.push({ side: b.units[e.id].side, text: 'A wounded soldier is carried to the aid tent' }); } }
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
      } else if (e.type === 'airFire' && e.breath) {
        // a great beast breathes on what lies below
        const a = b.airships[e.air], am = this.airModels[e.air].m;
        const col = { fire: [0xff7a1a, 0xffc040, 0x3a2e2a], acid: [0x9ad040, 0x6a9a20, 0xd8f080], frost: [0xd8f0ff, 0xffffff, 0x9ad0f0], warp: [0x7a3aff, 0x40e0a0, 0xff40c0], plague: [0x8a9a40, 0x5a6a2a, 0xb0b060], light: [0xfff0a0, 0xffffff, 0xffd060], sound: [0xe0c0ff, 0xffffff, 0xc0a0e0] }[e.breath] || [0xff7a1a, 0xffc040, 0x3a2e2a];
        const from = am.position.clone(); from.x += Math.cos(-am.rotation.y) * a.radius * 0.9; from.z += Math.sin(-am.rotation.y) * a.radius * 0.9;
        for (let k = 1; k <= 8; k++) { const p = from.clone().lerp(new THREE.Vector3(e.x1, e.h1 ?? 0.3, e.y1), k / 8); p.x += (Math.random() - 0.5) * k * 0.25; p.z += (Math.random() - 0.5) * k * 0.25; this.later(Math.floor(k / 3), () => st.puff(p, col[k % 3], 0.4 + k * 0.07, 0.9)); }
      } else if (e.type === 'airArt') {
        const a = b.airships[e.air];
        const p = new THREE.Vector3(e.x, (this.airModels[e.air]?.m.position.y) || 4, e.y);
        if (e.name === 'volatile') { for (let k = 0; k < 14; k++) st.puff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 5)), [0x7aff4a, 0xffc040, 0x3a2e2a][k % 3], 1.2, 1.6); msgs.push({ side: 1 - a.side, text: `${a.def.name} goes up in a ball of fire` }); }
        else if (e.name === 'shriek') { st.ring(p, 6, 0xe0d0ff, 0.9); if (b.tick - (this.shriekSaid || -99) > 30) { this.shriekSaid = b.tick; msgs.push({ side: a.side, text: `${a.def.name} shrieks: crews and fliers reel` }); } }
        else if (e.name === 'snatch') { if (b.tick - (this.snatchSaid || -99) > 30) { this.snatchSaid = b.tick; msgs.push({ side: a.side, text: `${a.def.name} plucks soldiers from the ranks and drops them from on high` }); } }
        else if (e.name === 'petrify') { st.puff(new THREE.Vector3(e.x, 3, e.y), 0x9a9a92, 0.6, 1.2); msgs.push({ side: a.side, text: `${a.def.name}'s gaze turns a flier to stone` }); }
      } else if (e.type === 'airWild') {
        const a = b.airships[e.air];
        msgs.push({ side: 1 - a.side, text: `${a.def.name}'s riders are all slain: the beast fights on alone` });
      } else if (e.type === 'bomb' && e.rocket) {
        const a = b.airships[e.air], am = this.airModels[e.air].m;
        st.projectile(am.position.clone(), new THREE.Vector3(e.x, 0.2, e.y), 'flak', (e.delay * TICK_MS) / 1000 / this.speed, 0.2);
        this.later(e.delay, () => { st.ring(new THREE.Vector3(e.x, 0.2, e.y), 1.4, 0xffa040, 0.6); st.puff(new THREE.Vector3(e.x, 0.5, e.y), 0x8a7a6a, 0.6, 0.9); });
        void a;
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
    // the land's own life stirs: a few pieces a frame
    if (this.scenery && this.scenery.length) {
      const n = this.scenery.length, step = Math.max(1, Math.ceil(n / 60));
      this.sceneTurn = ((this.sceneTurn || 0) + 1) % step;
      for (let k = this.sceneTurn; k < n; k += step) animateScenery(this.scenery[k], t);
    }
    // rally banners fly
    for (const pm of this.pointMarks.values()) if (pm.fixed) {
      const pp = pm.pennant.geometry.attributes.position, w = pm.base;
      for (let k = 0; k < pp.count; k++) { const x = w[k * 3] + 1.1; pp.setZ(k, Math.sin(t * 4 + x * 3) * 0.08 * x); }
      pp.needsUpdate = true;
    }
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
    // the hands aboard every ship and airship: fewer as she takes damage or loses crew
    const cl = this.crewList || (this.crewList = []);
    cl.length = 0;
    b.ships.forEach((sh, i) => { const m = this.shipModels[i]; if (m.userData.crewSlots) cl.push({ model: m, frac: 0.35 + 0.65 * sh.hp / Math.max(1, sh.maxHp), color: SIDE_COLORS[sh.side], alive: sh.alive && !this.shipSunkAt.has(i) }); });
    b.airships.forEach((a, i) => { const am = this.airModels[i]; cl.push({ model: am.m, frac: a.crew / Math.max(1, a.def.crew), color: SIDE_COLORS[a.side], alive: a.alive && am.downAt === undefined }); });
    this.crews.update(cl, t);
    for (const tm of this.transitMarks || []) {
      const L = tm.L, x = L.px + (L.x - L.px) * alpha, z = L.py + (L.y - L.py) * alpha, car = tm.car;
      if (!L.live) {
        // the cable drops and the car with it; a balloon with nowhere to go settles where it is
        if (!tm.fell) { tm.fell = true; if (tm.line) tm.line.visible = false; if (L.kind === 'cable') this.tumbling.push({ c: { g: car, k: 3 }, v: new THREE.Vector3(0.3, 0, 0.2), w: new THREE.Vector3(1, 0.5, 2), wait: 0, rest: 0.4 }); }
        if (L.kind === 'balloon') car.position.y = Math.max(this.groundY(Math.round(L.x), Math.round(L.y)), car.position.y - dt * 1.5);
        if (L.kind === 'boat') { car.position.y -= dt * 0.4 * speed; car.rotation.z += dt * 0.15; if (car.position.y < -2.5) car.visible = false; } // she settles and goes down
        // a wrecked handcar lies off the rails on its side; a dead beast lies where it dropped
        if (L.kind === 'rail') tm.cars.forEach((c, ci) => { const want = (ci % 2 ? -1 : 1) * (tm.beasts ? Math.PI / 2 : 1.25); c.rotation.x += (want - c.rotation.x) * Math.min(1, dt * 4); if (tm.beasts) for (const lg of c.userData.legs) lg.piv.rotation.z = 0.5; });
        continue;
      }
      const moving = L.x !== L.px || L.y !== L.py;
      if (L.kind === 'boat') {
        car.visible = !L.idle;
        if (L.idle) continue;
        const pts = tm.pts, last = pts.length - 1, q = Math.max(0, Math.min(last, moving ? L.k - L.dir * (1 - alpha) : L.k));
        const f = Math.floor(q), r = q - f, a = pts[f], c = pts[Math.min(last, f + 1)];
        const bx = a[0] + (c[0] - a[0]) * r, bz = a[1] + (c[1] - a[1]) * r;
        car.position.set(bx, this.waveY(bx, bz) + 0.02, bz);
        const ahead = pts[Math.max(0, Math.min(last, Math.round(q + 2 * L.dir)))], behind = pts[Math.max(0, Math.min(last, Math.round(q - 2 * L.dir)))];
        if (ahead !== behind) {
          let d = Math.atan2(-(ahead[1] - behind[1]), ahead[0] - behind[0]) - car.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          car.rotation.y += d * Math.min(1, dt * 3);
        }
        car.rotation.x = Math.sin(t * 1.2 + L.id) * 0.03;
        if (car.userData.wheel) car.userData.wheel.rotation.z -= moving ? dt * 3 * speed : 0;
        for (const o of car.userData.sweep || []) o.rotation.z = moving ? Math.sin(t * 3 * speed ** 0.5 + L.id) * 0.4 : 0;
        continue;
      }
      if (L.kind === 'rail') {
        // each car rides the curve by itself: its place is so far back along the line, its heading the line's there
        const pts = tm.pts, last = pts.length - 1;
        const at = (q, out) => { // a point at (fractional) index q, carried on straight past either end
          if (q <= 0) { out[0] = pts[0][0] + (pts[0][0] - pts[1][0]) * -q; out[1] = pts[0][1] + (pts[0][1] - pts[1][1]) * -q; return out; }
          if (q >= last) { out[0] = pts[last][0] + (pts[last][0] - pts[last - 1][0]) * (q - last); out[1] = pts[last][1] + (pts[last][1] - pts[last - 1][1]) * (q - last); return out; }
          const f = Math.floor(q), r = q - f; out[0] = pts[f][0] + (pts[f + 1][0] - pts[f][0]) * r; out[1] = pts[f][1] + (pts[f + 1][1] - pts[f][1]) * r; return out;
        };
        const sHead = (moving ? L.k - L.dir * (1 - alpha) : L.k) + (tm.beasts ? 0 : 0);
        const A = [0, 0], B = [0, 0], C = [0, 0];
        tm.cars.forEach((c, ci) => {
          // an engine keeps the outward end of its train and runs tender-first on the way home; beasts turn about and walk
          const q = tm.beasts ? sHead - L.dir * (tm.offs[ci] - tm.total / 2) : sHead + tm.total / 2 - tm.offs[ci];
          at(q, A); at(q + 0.7, B); at(q - 0.7, C);
          const gy = Math.max(0, this.groundY(Math.max(0, Math.min(b.W - 1, Math.floor(A[0]))), Math.max(0, Math.min(b.H - 1, Math.floor(A[1])))));
          c.position.set(A[0], gy + (tm.beasts ? 0.03 : 0.1), A[1]);
          let want = Math.atan2(-(B[1] - C[1]), B[0] - C[0]);
          if (tm.beasts && L.dir < 0) want += Math.PI;
          let d = want - c.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          c.rotation.y += tm.beasts ? d * Math.min(1, dt * 5) : d;
          // the beasts fall one by one as the caravan is cut down
          const dead = tm.beasts && ci >= Math.ceil(L.hp / (L.maxHp / tm.cars.length));
          if (tm.beasts && dead) { c.rotation.x += (Math.PI / 2 - c.rotation.x) * Math.min(1, dt * 4); for (const lg of c.userData.legs) lg.piv.rotation.z = 0.5; return; }
          if (c.userData.beam) c.userData.beam.rotation.z = moving ? Math.sin(t * 6 * speed ** 0.5 + c.userData.phase) * 0.32 : 0.12;
          if (tm.beasts) {
            const sw = moving ? 0.5 : 0;
            for (const lg of c.userData.legs) lg.piv.rotation.z = Math.sin(t * 7 * speed ** 0.5 + lg.ph + ci) * sw;
            c.userData.body.position.y = moving ? Math.abs(Math.sin(t * 7 * speed ** 0.5 + ci)) * 0.04 : 0;
          } else if (moving && c.userData.stack) {
            tm.smoke -= dt;
            if (tm.smoke <= 0) { tm.smoke = 0.22; c.updateMatrixWorld(); this.stage.puff(c.userData.stack.clone().applyMatrix4(c.matrixWorld), c.userData.smoke ?? 0xd8d4cc, 0.35, 1.3); }
          }
        });
      } else {
        const pt = L.path[L.k], pp = L.path[Math.max(0, Math.min(L.path.length - 1, L.k - (moving ? L.dir : 0)))];
        // height along the leg: a cable sags, a balloon climbs away from the mast and comes down on the next
        const at = (q) => { const a = tm.tops[q[2]], c = tm.tops[q[2] + 1], f = q[3]; return a.y + (c.y - a.y) * f + (L.kind === 'cable' ? -Math.sin(f * Math.PI) * 0.35 : Math.sin(f * Math.PI) ** 0.6 * 7); };
        const y = at(pp) + (at(pt) - at(pp)) * alpha;
        if (L.kind === 'cable') { car.position.set(x, y, z); if (moving) car.rotation.y = Math.atan2(L.px - L.x, L.py - L.y) + Math.PI / 2; }
        else {
          car.position.set(x + Math.sin(t * 0.7 + L.id) * 0.12, y + Math.sin(t * 1.1 + L.id * 2) * 0.1, z);
          car.rotation.y += dt * 0.08; car.rotation.z = Math.sin(t * 0.6 + L.id) * 0.03;
          if (car.userData.fire) car.userData.fire.scale.setScalar(moving ? 0.8 + Math.sin(t * 11) * 0.3 : 0.4);
        }
      }
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
      const m = this.crafts[i] || (this.crafts[i] = this.craftModel(c));
      if (c.sunk) { m.position.y -= dt * 0.5 * speed; if (m.position.y < -2) m.visible = false; return; }
      const x = c.px + (c.x - c.px) * alpha, y = c.py + (c.y - c.py) * alpha;
      m.position.set(x + 0.5, c.landed ? -0.12 : this.waveY(x, y) - 0.05, y + 0.5);
      m.userData.gun.rotation.y = -c.aim - m.rotation.y; m.userData.gun.visible = c.crew > 0;
      m.userData.pips.forEach((p, k) => { p.visible = k < c.crew; });
      if (c.wrecked && !m.userData.wrecked) { m.userData.wrecked = true; m.traverse((o) => { if (o.isMesh && o.material.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.4); } }); }
      m.rotation.z = c.landed ? 0 : Math.sin(t * 1.3 + i) * 0.04;
      if (!c.landed && (c.x !== c.px || c.y !== c.py)) { let d = -Math.atan2(c.y - c.py, c.x - c.px) - m.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; m.rotation.y += d * Math.min(1, dt * 4); }
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
      if (m.userData.skyAnim) animateSky(m, t);
      setBar(am.bar, a.hp / a.maxHp); setBar(am.crew, a.crew / a.def.crew);
      const down = a.ladder > 0 || ((a.mode === 'rescue' || a.mode === 'ferry') && Math.hypot((a.pick || a.drop || a).x - a.x, (a.pick || a.drop || a).y - a.y) < 3);
      am.ladder.visible = down; if (down) am.ladder.scale.y = Math.max(0.5, m.position.y - ground - 0.2) / AIR_SCALE;
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

// What the open country holds besides its trees, by climate: [piece, how many per thousand tiles of land, where, scale range]
//   where: open ground, sand, the shallows beside land, cliff tiles, or in the air over open ground
const LAND_SCENERY = {
  temperate: [['wildflowers', 5, 'open', [0.9, 1.4]], ['deer', 0.6, 'open', [1, 1.2]], ['sheepFlock', 0.4, 'open', [1, 1.1]], ['haystacks', 0.4, 'open', [1, 1.1]], ['stoneWall', 0.8, 'open', [1, 1]], ['gullFlock', 0.4, 'air', [1, 1.3]],
    ['rowboat', 0.6, 'sand', [1, 1.1]], ['fishingHut', 0.3, 'sand', [1, 1]], ['oak', 2, 'cliff', [0.8, 1.2]], ['pineStand', 2, 'cliff', [0.8, 1.2]], ['reedBed', 2.5, 'shallow', [0.9, 1.2]], ['lilyPatch', 1.5, 'shallow', [1, 1.4]], ['heronGroup', 0.4, 'shallow', [1, 1.2]]],
  snow: [['penguinGroup', 1.4, 'sand', [1.3, 1.7]], ['floe', 7, 'shallow', [0.7, 1.3]], ['pineStand', 2.5, 'cliff', [0.8, 1.2]], ['deer', 0.5, 'open', [1, 1.2]], ['deadTree', 0.8, 'open', [0.8, 1.1]], ['gullFlock', 0.3, 'air', [1, 1.3]]],
  desert: [['saguaro', 3, 'open', [0.8, 1.3]], ['dune', 1.2, 'open', [0.8, 1.2]], ['ruinColumns', 0.25, 'open', [0.9, 1.1]], ['rockArch', 0.5, 'cliff', [0.9, 1.3]], ['camelGroup', 0.3, 'open', [1, 1.1]], ['vultureFlock', 0.5, 'air', [1, 1.3]],
    ['scorpion', 1.2, 'open', [1, 1.6]], ['lizard', 1.2, 'open', [1, 1.5]], ['wreck', 0.3, 'sand', [0.9, 1.1]], ['datePalm', 2, 'sand', [0.8, 1.2]], ['oasisPool', 0.12, 'open', [1, 1.3]], ['reedBed', 1.5, 'shallow', [0.9, 1.2]]],
  swamp: [['reedBed', 5, 'sand', [0.9, 1.3]], ['reedBed', 4, 'shallow', [0.9, 1.3]], ['cypress', 3.5, 'shallow', [0.8, 1.2]], ['deadTree', 1.5, 'open', [0.8, 1.2]], ['heronGroup', 0.8, 'shallow', [1, 1.3]], ['alligator', 0.9, 'shallow', [1, 1.3]],
    ['lilyPatch', 3, 'shallow', [1, 1.5]], ['fireflies', 0.3, 'open', [1, 1.4]], ['bogMound', 1, 'open', [0.9, 1.3]], ['giantToad', 1, 'open', [1, 1.5]], ['punt', 0.3, 'shallow', [1, 1.1]]],
  volcanic: [['charredTree', 2.5, 'open', [0.8, 1.2]], ['obsidianSpire', 1.2, 'open', [0.8, 1.3]], ['basaltColumns', 2, 'cliff', [0.9, 1.4]], ['basaltColumns', 0.6, 'open', [0.8, 1.1]], ['smokeVent', 0.8, 'open', [1, 1.4]], ['ashDune', 1, 'open', [0.9, 1.3]],
    ['fireLizard', 1.2, 'open', [1, 1.6]], ['emberBats', 0.5, 'air', [1, 1.3]]],
  jungle: [['coconutPalm', 3.5, 'sand', [0.8, 1.2]], ['bananaTree', 1.5, 'open', [0.9, 1.2]], ['bambooThicket', 1.5, 'cliff', [0.9, 1.2]], ['fernClump', 5, 'open', [0.9, 1.5]], ['elephantEar', 3, 'open', [0.9, 1.4]], ['bromeliad', 3, 'open', [1, 1.5]],
    ['mossLog', 1, 'open', [0.9, 1.2]], ['mangrove', 3.5, 'shallow', [0.8, 1.2]], ['crocodile', 0.9, 'shallow', [1, 1.3]], ['macaw', 1, 'open', [1.4, 2]], ['monkey', 0.8, 'open', [1.3, 1.8]], ['treeFrog', 0.8, 'open', [1.4, 2]],
    ['dartFrog', 0.8, 'open', [1.5, 2.2]], ['treeSnake', 0.5, 'open', [1, 1.3]], ['giantSpider', 0.4, 'open', [1, 1.4]], ['boar', 0.5, 'open', [1, 1.3]], ['lilyPatch', 1.5, 'shallow', [1, 1.4]]],
};
function hashRelief(h, c) { let v = 0; for (let i = 0; i < h.length; i += 5) v = (v * 31 + Math.round(h[i] * 50) + (c[i] ? 7 : 0)) | 0; return v; }
function hashTerrain(t) { let h = 0; for (let i = 0; i < t.length; i += 7) h = (h * 31 + t[i]) | 0; return h; }

const AIR_SCALE = 1.5; // airships are drawn half again as big as their footprint so their crews show
