// Renders naval battles from engine/naval.js. Engine (x, y) maps to world (x, 0, y).
import * as THREE from 'three';
import { buildShip, buildCreature, animateCreature, buildWeapon, mat } from './models.js';
import { makeBar, setBar } from './stage.js';
import { SIDE_COLORS } from './landView.js';
import { TICK_MS } from '../engine/combat.js';

export class NavalView {
  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.dynamic = new THREE.Group();
    this.root.add(this.dynamic);
    stage.scene.add(this.root);
  }
  dispose() { this.stage.scene.remove(this.root); }

  buildSea(b) {
    if (this.sea) this.root.remove(this.sea);
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(b.W * 3, b.H * 3, 160, 110);
    geo.rotateX(-Math.PI / 2);
    this.waterGeo = geo;
    this.base = Float32Array.from(geo.attributes.position.array);
    const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a6f96, roughness: 0.22, metalness: 0.3 }));
    water.position.set(b.W / 2, 0, b.H / 2);
    water.receiveShadow = true;
    g.add(water);
    for (const isl of b.islands) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(isl.r * 0.8, isl.r, 1.2, 28), mat(0xcdb57a));
      m.position.set(isl.x, 0.1, isl.y);
      const top = new THREE.Mesh(new THREE.SphereGeometry(isl.r * 0.72, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x4f7a3a));
      top.scale.y = 0.55;
      top.position.set(isl.x, 0.68, isl.y);
      g.add(m, top);
    }
    this.sea = g;
    this.root.add(g);
    this.stage.setSky(0xb4cddb);
    if (this.boundsKey !== `${b.W}x${b.H}`) {
      this.boundsKey = `${b.W}x${b.H}`;
      this.stage.setBounds(b.W, b.H);
      this.stage.camera.position.set(b.W * 0.42, 42, b.H * 0.5 + 52);
    }
  }

  load(b) {
    this.b = b;
    this.buildSea(b);
    this.stage.clear(this.dynamic);
    this.stage.clearFx();
    this.models = b.ents.map((e) => {
      const m = e.ship ? buildShip(e.def, SIDE_COLORS[e.side]) : e.fort ? buildFort(e.def) : buildCreature(e.def);
      const bar = makeBar(0x4fd36a);
      bar.position.y = e.ship ? 2 + e.def.len * 0.35 : e.fort ? 2.4 + e.def.size * 0.5 : 1 + (e.def.size || 1) * 0.5;
      setBar(bar, 1, e.ship ? Math.min(3, e.def.len * 0.4) : 0.8 + (e.def.size || 1) * 0.3);
      m.add(bar);
      const ring = new THREE.Mesh(new THREE.RingGeometry(e.radius + 0.3, e.radius + 0.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: SIDE_COLORS[e.side], transparent: true, opacity: 0.6 }));
      ring.position.y = 0.05;
      m.add(ring);
      m.userData = { ...m.userData, bar, ring, phase: e.id * 1.3, side: e.side };
      this.dynamic.add(m);
      return m;
    });
    this.deathAt = new Map();
  }

  pickPoint(clientX, clientY) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.stage.camera);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
    return { x: p.x, y: p.z };
  }

  waveH(x, z, t) { return Math.sin(x * 0.25 + t * 1.2) * 0.18 + Math.cos(z * 0.3 + t * 0.9) * 0.14; }

  onEvents(events) {
    const b = this.b, st = this.stage, msgs = [];
    for (const e of events) {
      if (e.type === 'shot') {
        const from = new THREE.Vector3(e.x0, 0.8, e.y0), to = new THREE.Vector3(e.x1, e.hit ? 0.8 : 0, e.y1);
        st.projectile(from, to, e.kind === 'spell' ? 'magic' : e.kind, (e.flight * TICK_MS) / 1000 / this.speed, 0.5);
        if (e.kind === 'cannon') st.puff(from, 0xeeeeee, 0.35, 0.9);
      } else if (e.type === 'blast') {
        st.ring(new THREE.Vector3(e.x, 0.1, e.y), e.r, 0xffb060, 0.6);
        st.puff(new THREE.Vector3(e.x, 0.3, e.y), 0x8a7a6a, 0.8, 0.9);
      } else if (e.type === 'splash') {
        st.puff(new THREE.Vector3(e.x, 0, e.y), 0xffffff, 0.3, 0.7);
      } else if (e.type === 'hit') {
        const x = b.ents[e.id];
        st.splat(new THREE.Vector3(x.x, 2.5, x.y), e.dmg);
      } else if (e.type === 'death') {
        this.deathAt.set(e.id, this.time);
        const x = b.ents[e.id];
        st.ring(new THREE.Vector3(x.x, 0, x.y), 2, 0xffffff, 1.2);
        msgs.push({ side: x.side, text: `${x.def.name} ${x.ship ? 'is sunk' : x.fort ? 'is reduced to rubble' : 'is slain'}` });
      } else if (e.type === 'captured') {
        const x = b.ents[e.id];
        msgs.push({ side: e.by, text: `${x.def.name} ${x.fort ? 'stormed and taken' : 'boarded and captured'}` });
        this.models[e.id].userData.ring.material = new THREE.MeshBasicMaterial({ color: SIDE_COLORS[e.by], transparent: true, opacity: 0.6 });
      } else if (e.type === 'ability') {
        const x = b.ents[e.id];
        if (e.name === 'sweep') st.ring(new THREE.Vector3(x.x, 0, x.y), e.radius, 0x9ad0ff, 0.8);
        if (e.name === 'ink' || e.name === 'charm' || e.name === 'ram') msgs.push({ side: x.side, text: `${x.def.name}: ${e.name === 'ink' ? 'ink cloud blinds the gunners' : e.name === 'charm' ? 'song lures a ship off course' : 'rams a hull'}` });
        if (e.name === 'ink') { const t = b.ents[e.to]; st.puff(new THREE.Vector3(t.x, 0.5, t.y), 0x111111, 1.5, 2); }
      } else if (e.type === 'submerge') {
        const x = b.ents[e.id]; st.ring(new THREE.Vector3(x.x, 0, x.y), 1, 0xffffff, 0.8);
      }
    }
    return msgs;
  }

  update(alpha, t, dt, speed = 1) {
    const b = this.b;
    if (!b) return;
    this.time = t; this.speed = speed;
    const pos = this.waterGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.array[i * 3 + 1] = this.waveH(this.base[i * 3], this.base[i * 3 + 2], t) - 0.15;
    pos.needsUpdate = true;
    if ((this.waterTick = (this.waterTick || 0) + 1) % 2 === 0) this.waterGeo.computeVertexNormals();
    b.ents.forEach((e, i) => {
      const m = this.models[i];
      const died = this.deathAt.get(i);
      if (!e.alive && died === undefined) { m.visible = false; return; }
      const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
      let dh = e.heading - e.ph; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const hd = e.ph + dh * alpha;
      if (e.fort) {
        m.position.set(x, 0, y);
        const tur = m.userData.turret;
        if (tur) tur.rotation.y = -hd;
        if (died !== undefined) { m.rotation.z = 0.2; m.userData.bar.visible = false; }
        else setBar(m.userData.bar, e.hp / e.maxHp);
        if (m.userData.side !== e.side) { m.userData.side = e.side; m.userData.ring.material.color.set(SIDE_COLORS[e.side]); }
        return;
      }
      m.position.set(x, this.waveH(x, y, t) * 0.8, y);
      m.rotation.y = -hd;
      m.rotation.z = Math.sin(t * 1.1 + i) * 0.04;
      if (!e.ship) animateCreature(m, t, m.userData.phase);
      m.userData.rig?.mixer?.update(dt * speed);
      const sub = !e.ship && b.tick < e.subUntil;
      m.position.y -= sub ? 1.2 : 0;
      if (died !== undefined) {
        const k = (t - died) * speed;
        m.position.y -= k * 0.8;
        m.rotation.x = Math.min(0.6, k * 0.3);
        m.userData.bar.visible = false; m.userData.ring.visible = false;
        if (k > 3) m.visible = false;
      } else {
        setBar(m.userData.bar, e.hp / e.maxHp);
      }
    });
  }
}

// Fort on a rocky footing; the weapon turret aims at its target.
function buildFort(def) {
  const g = new THREE.Group();
  const r = def.size;
  const rock = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.25, 1, 9), mat(0x7a756c));
  rock.position.y = 0.1; g.add(rock);
  const w = buildWeapon(def.model, def.model === 'seaFort' ? r * 0.9 : Math.max(1, r * 0.9), Math.max(1, r * 0.9));
  if (def.model !== 'seaFort' && def.model !== 'battery') w.scale.setScalar(r * 0.9);
  w.position.y = 0.6;
  g.add(w);
  g.userData.turret = w.userData.turret;
  return g;
}
