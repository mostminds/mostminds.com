// Renders naval battles from engine/naval.js. Engine (x, y) maps to world (x, 0, y).
import * as THREE from 'three';
import { buildShip, buildCreature, animateCreature, buildFortModel, shipMuzzle, setLod, mat } from './models.js';
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
    // the wind: a pennant-shaped arrow lying on the water at the map's edge, and streaks blowing across the sea
    const arrow = new THREE.Group();
    const shaft = new THREE.Shape(); shaft.moveTo(-3, -0.5); shaft.lineTo(1, -0.5); shaft.lineTo(1, -1.4); shaft.lineTo(3.4, 0); shaft.lineTo(1, 1.4); shaft.lineTo(1, 0.5); shaft.lineTo(-3, 0.5); shaft.closePath();
    arrow.add(new THREE.Mesh(new THREE.ShapeGeometry(shaft).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })));
    arrow.position.set(b.W / 2, 0.25, 5);
    g.add(arrow); this.windArrow = arrow;
    this.streaks = [];
    for (let k = 0; k < 26; k++) {
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.07).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }));
      sm.position.set(Math.random() * b.W, 0.2, Math.random() * b.H);
      g.add(sm); this.streaks.push(sm);
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

  /** every distinct model this battle needs, as { label, run } steps, so the page can build them one per frame */
  warmList(b) {
    const out = [], seen = new Set();
    for (const e of b.ents) {
      const key = e.ship ? `h:${e.def.id}:${e.side}` : e.fort ? `f:${e.def.id}` : `c:${e.def.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label: e.def.name || e.def.id, run: () => (e.ship ? buildShip(e.def, SIDE_COLORS[e.side]) : e.fort ? buildFort(e.def) : buildCreature(e.def)) });
    }
    return out;
  }

  load(b) {
    this.b = b;
    this.buildSea(b);
    this.stage.clear(this.dynamic);
    this.stage.clearFx();
    this.models = b.ents.map((e) => {
      const m = e.ship ? buildShip(e.def, SIDE_COLORS[e.side]) : e.fort ? buildFort(e.def) : buildCreature(e.def);
      const bar = makeBar(0x4fd36a);
      bar.position.y = e.ship ? (m.userData.top ?? 1.7 + e.def.len * 0.35) + 0.3 : e.fort ? Math.max(2.4 + e.def.size * 0.5, (m.userData.top || 0) + 0.4) : Math.max(1 + (e.def.size || 1) * 0.5, (m.userData.rig?.height || 0) + 0.3);
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
        // a broadside comes from the gun ports facing the target, a few guns at a time
        const gm = e.kind === 'cannon' && b.ents[e.from]?.ship ? this.models[e.from] : null;
        const n0 = gm ? (gm.userData.gunTurn = (gm.userData.gunTurn || 0) + 3) : 0;
        if (gm && shipMuzzle(gm, e.x1, e.y1, n0, from)) {
          const p = new THREE.Vector3();
          for (let k = 1; k < 3; k++) if (shipMuzzle(gm, e.x1, e.y1, n0 + k, p)) st.puff(p.clone(), 0xeeeeee, 0.3, 0.9);
        }
        st.projectile(from, to, e.kind === 'spell' ? 'magic' : e.kind, (e.flight * TICK_MS) / 1000 / this.speed, 0.5);
        if (e.kind === 'cannon') st.puff(from.clone(), 0xeeeeee, 0.35, 0.9);
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
      } else if (e.type === 'rake') {
        const x = b.ents[e.id];
        st.puff(new THREE.Vector3(x.x, 1.2, x.y), 0xd8c8a8, 0.6, 0.9);
        msgs.push({ side: b.ents[e.by].side, text: `${b.ents[e.by].def.name} rakes ${x.def.name} ${e.stern ? 'through the stern' : 'across the bow'}` });
      } else if (e.type === 'rigging') {
        msgs.push({ side: 1 - b.ents[e.id].side, text: `${b.ents[e.id].def.name}'s rigging is shot away: she loses way` });
      } else if (e.type === 'tack') {
        if (b.tick % 3 === 0) msgs.push({ side: b.ents[e.id].side, text: `${b.ents[e.id].def.name} beats to windward` });
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
    if (this.windArrow && b.wind) {
      this.windArrow.rotation.y = -b.wind.dir;
      const wx = Math.cos(b.wind.dir), wz = Math.sin(b.wind.dir);
      for (const sm of this.streaks) {
        sm.rotation.y = -b.wind.dir;
        sm.position.x += wx * dt * 9 * b.wind.speed; sm.position.z += wz * dt * 9 * b.wind.speed;
        if (sm.position.x < 0 || sm.position.x > b.W || sm.position.z < 0 || sm.position.z > b.H) sm.position.set(Math.random() * b.W, 0.2, Math.random() * b.H);
      }
    }
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
      if (m.userData.lod) {
        const ratio = this.stage.camera.position.distanceTo(m.position) / Math.max(1, (e.def.size || 1) * 1.5);
        let lv = 0; while (lv < 5 && ratio > [14, 30, 60, 110, 200][lv]) lv++;
        setLod(m, lv);
      }
      if (!e.ship && died === undefined) animateCreature(m, t, m.userData.phase);
      else if (m.userData.beast && died === undefined) animateCreature(m.userData.beast, t, i * 1.3);
      m.userData.rig?.mixer?.update(dt * speed);
      const sub = !e.ship && b.tick < e.subUntil;
      m.position.y -= sub ? 1.2 : 0;
      if (died !== undefined) {
        const k = (t - died) * speed;
        m.userData.bar.visible = false; m.userData.ring.visible = false;
        if (e.ship && !m.userData.beast) {
          // she settles on the bottom with her mastheads still above water
          const down = Math.min((m.userData.top || 3) * 0.72, k * 0.8);
          m.position.y -= down; m.rotation.x = Math.min(0.35, k * 0.12); m.rotation.z = Math.min(0.5, k * 0.2);
        } else {
          // a dead beast rolls belly-up and drifts
          const r = Math.min(1, k / 2.5), e2 = r * r * (3 - 2 * r);
          m.rotation.x = e2 * Math.PI * 0.92;
          m.position.y += -0.25 * e2 + Math.sin(t * 0.8 + i) * 0.05;
          m.rotation.z = Math.sin(t * 0.5 + i) * 0.05;
        }
      } else {
        setBar(m.userData.bar, e.hp / e.maxHp);
      }
    });
  }
}

const buildFort = buildFortModel;
