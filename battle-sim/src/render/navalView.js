// Renders naval battles from engine/naval.js. Engine (x, y) maps to world (x, 0, y).
import * as THREE from 'three';
import { buildShip, buildCreature, animateCreature, buildFortModel, shipMuzzle, setLod, mat } from './models.js';
import { makeBar, setBar } from './stage.js';
import { SIDE_COLORS } from './landView.js';
import { TICK_MS } from '../engine/combat.js';
import { ARCTIC, SCENERY, animateScenery } from './registry.js';
import { SEA_LOOK, DOME, dressIslands } from './seaset.js';
import { Crews } from './crews.js';
import { dressRole, buildSquadron, animateSquadron } from './fleetDress.js';

// plain stand-ins for the ice and its birds, used until the sculpted ones are there
const ICE = { top: 0xf4f8fc, edge: 0xbfe0f0, deep: 0x7fb8d8 };
function plainFloe(seed) {
  const g = new THREE.CylinderGeometry(1, 1.06, 0.2, 7 + (seed % 3)); g.translate(0, 0.02, 0);
  const m = new THREE.Mesh(g, [new THREE.MeshStandardMaterial({ color: ICE.edge, roughness: 0.5 }), new THREE.MeshStandardMaterial({ color: ICE.top, roughness: 0.85 }), new THREE.MeshStandardMaterial({ color: ICE.deep, roughness: 0.5 })]);
  m.scale.set(1, 1, 0.8 + (seed % 5) * 0.06); m.rotation.y = seed; m.receiveShadow = true; return m;
}
function plainBerg(seed) {
  const grp = new THREE.Group();
  for (let k = 0; k < 3; k++) { const h = 2.4 - k * 0.7 + (seed % 3) * 0.3, c = new THREE.Mesh(new THREE.ConeGeometry(0.8 - k * 0.18, h, 5 + k), new THREE.MeshStandardMaterial({ color: k ? ICE.edge : ICE.top, roughness: 0.4, flatShading: true })); c.position.set((k - 1) * 0.5, h / 2 - 0.1, Math.sin(seed + k * 2) * 0.35); c.rotation.y = seed + k; c.castShadow = true; grp.add(c); }
  return grp;
}
function plainPenguins(seed) {
  const grp = new THREE.Group(), birds = [], black = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.6 }), white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.7 }), orange = new THREE.MeshStandardMaterial({ color: 0xf08a1a, roughness: 0.6 });
  for (let k = 0, n = 4 + (seed % 4); k < n; k++) {
    const b = new THREE.Group();
    b.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.14, 3, 8).translate(0, 0.17, 0), black));
    b.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6).scale(0.8, 1.25, 0.6).translate(0, 0.16, 0.05), white));
    b.add(new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 5).rotateX(Math.PI / 2).translate(0, 0.29, 0.1), orange));
    const a = (k / n) * 6.283 + seed, rr = 0.15 + ((seed * (k + 3)) % 7) * 0.05;
    b.position.set(Math.cos(a) * rr, 0.12, Math.sin(a) * rr); b.rotation.y = a * 3 + k; b.userData.phase = k * 1.7;
    grp.add(b); birds.push(b);
  }
  grp.userData.birds = birds; return grp;
}

export class NavalView {
  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    this.dynamic = new THREE.Group();
    this.root.add(this.dynamic);
    stage.scene.add(this.root);
  }
  dispose() { this.stage.scene.remove(this.root); this.crews?.dispose(); }

  buildSea(b) {
    if (this.sea) this.root.remove(this.sea);
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(b.W * 3, b.H * 3, 160, 110);
    geo.rotateX(-Math.PI / 2);
    this.waterGeo = geo;
    this.base = Float32Array.from(geo.attributes.position.array);
    const arctic = b.theme === 'arctic', look = SEA_LOOK[b.theme] || SEA_LOOK.temperate;
    const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: look.sea, roughness: 0.22, metalness: 0.3 }));
    water.position.set(b.W / 2, 0, b.H / 2);
    water.receiveShadow = true;
    g.add(water);
    // pack ice, bergs and the birds that live on them
    const sc = ARCTIC.scenery || {};
    this.birds = [];
    b.islands.forEach((isl, k) => {
      if (!isl.ice) return;
      const seed = Math.round(isl.x * 7 + isl.y * 13 + k);
      if (isl.berg) {
        const m = (sc.iceberg || plainBerg)(seed);
        m.position.set(isl.x, 0, isl.y); m.scale.setScalar(isl.r / 1.0); m.rotation.y = seed;
        g.add(m);
        return;
      }
      // a field of floes fills the patch of pack ice, biggest in the middle
      const n = Math.max(3, Math.round(isl.r * isl.r * 0.55));
      for (let j = 0; j < n; j++) {
        const a = j * 2.4 + seed, rr = Math.sqrt((j + 0.5) / n) * isl.r * 0.92, s = (0.9 + ((seed + j * 7) % 5) * 0.22) * (1.25 - rr / isl.r * 0.6);
        const m = (sc.floe || plainFloe)(seed + j);
        m.position.set(isl.x + Math.cos(a) * rr, 0, isl.y + Math.sin(a) * rr); m.scale.multiplyScalar(s); m.rotation.y = a;
        g.add(m);
        if ((seed + j) % 4 === 0 && rr < isl.r * 0.7) {
          const p = (sc.penguinGroup || plainPenguins)(seed + j);
          p.position.set(m.position.x, 0.14, m.position.z); p.scale.setScalar(1.5); p.rotation.y = a * 2;
          g.add(p); this.birds.push(p);
        }
      }
    });
    for (const isl of b.islands) {
      if (isl.ice) continue;
      if (arctic) {
        // islands of the far north: grey rock under snow, with a colony of penguins on the shore
        const m = new THREE.Mesh(new THREE.CylinderGeometry(isl.r * 0.8, isl.r, 1.2, 28), mat(0x8a9098));
        m.position.set(isl.x, 0.1, isl.y);
        const top = new THREE.Mesh(new THREE.SphereGeometry(isl.r * 0.72, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xf4f8fc));
        top.scale.y = 0.55; top.position.set(isl.x, 0.68, isl.y);
        g.add(m, top);
        const seed = Math.round(isl.x * 3 + isl.y * 5);
        for (let j = 0; j < Math.min(4, Math.round(isl.r / 2)); j++) { const a = seed + j * 1.9, p = (sc.penguinGroup || plainPenguins)(seed + j); p.position.set(isl.x + Math.cos(a) * isl.r * 0.82, 0.72, isl.y + Math.sin(a) * isl.r * 0.82); p.scale.setScalar(1.5); g.add(p); this.birds.push(p); }
        continue;
      }
      // a low island in the colours of its sea: flat enough to build and grow on when the sea has a climate
      const m = new THREE.Mesh(new THREE.CylinderGeometry(isl.r * 0.8, isl.r, 1.2, 28), mat(look.sand));
      m.position.set(isl.x, 0.1, isl.y); m.receiveShadow = true;
      const top = new THREE.Mesh(new THREE.SphereGeometry(isl.r * 0.72, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(look.top));
      top.scale.y = b.theme && b.theme !== 'open' ? DOME : 0.55; top.receiveShadow = true;
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
    // trees, beasts, villages and volcanoes, by the kind of sea this is
    const set = dressIslands(b, g, SCENERY);
    this.scenery = set.moving; this.craters = set.craters; this.erupting = new Map();
    this.stage.setSky(look.sky);
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
    this.crews?.dispose();
    this.crews = new Crews(this.stage.scene);
    this.tethers = []; this.barrels = [];
    this.models = b.ents.map((e) => this.makeModel(e));
    this.deathAt = new Map();
  }

  /** the model for one entity: built at load, or the moment a carrier launches a squadron */
  makeModel(e) {
    const b = this.b;
    if (e.air) {
      const m = buildSquadron(e.def, SIDE_COLORS[e.side]);
      const bar = makeBar(0x4fd36a); bar.position.y = 2.2; setBar(bar, 1, 1.2); m.add(bar);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.6, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: SIDE_COLORS[e.side], transparent: true, opacity: 0.35 }));
      m.add(ring);
      m.userData = { ...m.userData, bar, ring, phase: e.id * 1.3, side: e.side, air: true };
      this.dynamic.add(m);
      return m;
    }
    const m = e.ship ? buildShip(e.def, SIDE_COLORS[e.side]) : e.fort ? buildFort(e.def) : buildCreature(e.def);
    if (e.ship && !e.def.beast) {
      // hands on deck: find where they can stand, then fit her out for her role and keep them clear of the fittings
      const n = this.crews.track(m, `ship:${e.def.id}`);
      const slots = m.userData.crewSlots, ys = slots.map((p) => p[1]).sort((a, c) => a - c);
      const deckY = n ? ys[Math.floor(n / 2)] : e.def.beam * 0.25;
      const keep = dressRole(m, e.def, SIDE_COLORS[e.side], deckY);
      if (keep.length) m.userData.crewSlots = slots.filter((p) => !keep.some(([x, z, r]) => Math.hypot(p[0] - x, p[2] - z) < r));
    }
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
        const fa = b.ents[e.from]?.air, ta = b.ents[e.to]?.air;
        const from = new THREE.Vector3(e.x0, fa ? AIR_Y : 0.8, e.y0), to = new THREE.Vector3(e.x1, ta ? (e.hit ? AIR_Y : AIR_Y + 2) : e.hit ? 0.8 : 0, e.y1);
        // a broadside comes from the gun ports facing the target, a few guns at a time
        const gun = e.kind === 'cannon' || e.kind === 'heavy' || e.kind === 'chain';
        const gm = gun && b.ents[e.from]?.ship ? this.models[e.from] : null;
        const n0 = gm ? (gm.userData.gunTurn = (gm.userData.gunTurn || 0) + 3) : 0;
        if (gm && shipMuzzle(gm, e.x1, e.y1, n0, from)) {
          const p = new THREE.Vector3();
          for (let k = 1; k < 3; k++) if (shipMuzzle(gm, e.x1, e.y1, n0 + k, p)) st.puff(p.clone(), 0xeeeeee, 0.3, 0.9);
        }
        if (e.kind === 'torpedo') { // it runs along the surface trailing foam
          from.y = 0.1; to.y = 0.1;
          st.projectile(from, to, 'harpoon', (e.flight * TICK_MS) / 1000 / this.speed, 0);
          for (let k = 1; k <= 4; k++) st.puff(from.clone().lerp(to, k / 5), 0xffffff, 0.25, 0.8);
        } else if (e.kind === 'flak') {
          // flak bursts in grey puffs round the fliers
          st.projectile(from, to, 'flak', (e.flight * TICK_MS) / 1000 / this.speed, 0.05);
          if (Math.random() < 0.5) st.puff(to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2)), 0x5a5a5a, 0.4, 0.8);
        } else if (e.kind === 'mortar') {
          // a mortar lobs its shell high over masts and islands
          from.y = 1.4;
          st.projectile(from, to, 'mortar', (e.flight * TICK_MS) / 1000 / this.speed, 3.2);
          st.puff(from.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xcfc4b4, 0.7, 1.2);
        } else if (e.kind === 'depth') {
          from.y = 0.3; to.y = -0.2;
          st.projectile(from, to, 'depth', (e.flight * TICK_MS) / 1000 / this.speed, 0.8);
        } else st.projectile(from, to, e.kind === 'spell' ? 'magic' : e.kind, (e.flight * TICK_MS) / 1000 / this.speed, e.kind === 'swivel' ? 0.1 : 0.5);
        if (gun) st.puff(from.clone(), 0xeeeeee, e.kind === 'heavy' ? 0.55 : 0.35, 0.9);
        if (e.kind === 'swivel') st.puff(from.clone(), 0xeeeeee, 0.15, 0.5);
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
        msgs.push({ side: x.side, text: `${x.def.name} ${x.ship ? 'is sunk' : x.fort ? 'is reduced to rubble' : x.air ? 'is shot down' : 'is slain'}` });
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
        if (e.name === 'wave') {
          // the wave rolls out from where it breaks
          for (let k = 0; k < 4; k++) st.ring(new THREE.Vector3(e.x, 0.1, e.y), e.radius * (0.4 + k * 0.2), k % 2 ? 0xffffff : 0x9ad0ff, 0.7 + k * 0.25);
          for (let k = 0; k < 8; k++) st.puff(new THREE.Vector3(e.x + (Math.random() - 0.5) * e.radius * 1.6, 0.6 + Math.random() * 1.6, e.y + (Math.random() - 0.5) * e.radius * 1.6), 0xffffff, 0.6, 1.1);
          msgs.push({ side: x.side, text: `${x.def.name} calls up a great wave` });
        }
        if (e.name === 'breath') {
          const t = b.ents[e.to], n = 7;
          for (let k = 1; k <= n; k++) st.puff(new THREE.Vector3(x.x + (t.x - x.x) * k / n + (Math.random() - 0.5) * k * 0.3, 1.2 + Math.random(), x.y + (t.y - x.y) * k / n + (Math.random() - 0.5) * k * 0.3), e.fire ? [0xff7a1a, 0xffc040, 0xe8e8e8][k % 3] : e.frost ? [0xd8f0ff, 0xffffff, 0x9ad0f0][k % 3] : 0xe8e8e8, 0.5 + k * 0.08, 0.9);
          msgs.push({ side: x.side, text: `${x.def.name} ${e.frost ? 'breathes killing frost: spray freezes on the rigging' : 'breathes scalding fire'}` });
        }
        if (e.name === 'snare') { const t = b.ents[e.to]; st.ring(new THREE.Vector3(t.x, 0, t.y), 2, 0xc8322a, 0.9); msgs.push({ side: x.side, text: `${x.def.name} fouls ${t.def.name}'s rudder: she cannot turn` }); }
        if (e.name === 'leap') msgs.push({ side: x.side, text: `${x.def.name} snatches topmen from ${b.ents[e.to].def.name}'s rigging` });
        if (e.name === 'crush') msgs.push({ side: x.side, text: `${x.def.name} wraps itself round ${b.ents[e.to].def.name}` });
        if (e.name === 'breach') msgs.push({ side: x.side, text: `${x.def.name} holes ${b.ents[e.to].def.name} below the waterline` });
        if (e.name === 'overboard' && e.n >= 3) msgs.push({ side: x.side, text: `${e.n} hands are swept from ${b.ents[e.to].def.name}'s deck` });
        if (e.name === 'ink' || e.name === 'charm' || e.name === 'ram') msgs.push({ side: x.side, text: `${x.def.name}: ${e.name === 'ink' ? 'ink cloud blinds the gunners' : e.name === 'charm' ? 'song lures a ship off course' : 'rams a hull'}` });
        if (e.name === 'ink') { const t = b.ents[e.to]; st.puff(new THREE.Vector3(t.x, 0.5, t.y), 0x111111, 1.5, 2); }
      } else if (e.type === 'rumble') {
        msgs.push({ side: 0, text: 'The mountain rumbles' });
      } else if (e.type === 'eruption') {
        this.erupting.set(e.isl, e.until);
        const c = this.craters.get(e.isl);
        if (c) for (let k = 0; k < 14; k++) st.puff(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 4, (Math.random() - 0.5) * 3)), k % 3 ? 0x3a2e2a : 0xff6a14, 1.6, 2.2);
        msgs.push({ side: 1, text: 'The volcano erupts: molten rock falls on both fleets' });
      } else if (e.type === 'bombUp') {
        const isl = [...this.craters.values()].sort((a, c2) => Math.hypot(a.x - e.x0, a.z - e.y0) - Math.hypot(c2.x - e.x0, c2.z - e.y0))[0];
        const from = isl ? isl.clone() : new THREE.Vector3(e.x0, 6, e.y0);
        st.projectile(from, new THREE.Vector3(e.x1, 0.1, e.y1), 'shell', (e.flight * TICK_MS) / 1000 / this.speed, 2.4);
      } else if (e.type === 'lavabomb') {
        const p = new THREE.Vector3(e.x, 0.1, e.y);
        st.ring(p, 2.4, 0xff7a1a, 0.7);
        for (let k = 0; k < 5; k++) st.puff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.4 + Math.random() * 1.8, (Math.random() - 0.5) * 2)), e.hit ? [0xff7a1a, 0xffc040, 0x3a2e2a][k % 3] : [0xffffff, 0xe8e8e8, 0xff9a4a][k % 3], 0.7, 1.2);
      } else if (e.type === 'torpedo') {
        const x = b.ents[e.id];
        if (b.tick !== this.torpSaid) { this.torpSaid = b.tick; msgs.push({ side: x.side, text: `${x.def.name} looses a torpedo at ${b.ents[e.to].def.name}` }); }
      } else if (e.type === 'frozen') {
        const x = b.ents[e.id];
        st.ring(new THREE.Vector3(x.x, 0.1, x.y), 2.2, 0xd8f0ff, 0.9);
        for (let k = 0; k < 3; k++) st.puff(new THREE.Vector3(x.x + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, x.y + (Math.random() - 0.5) * 2), 0xe8f6ff, 0.5, 1.1);
      } else if (e.type === 'refused') {
        msgs.push({ side: e.side, text: `The ${e.name} will not sail in this company and is gone` });
      } else if (e.type === 'afire') {
        const x = b.ents[e.id];
        for (let k = 0; k < 4; k++) st.puff(new THREE.Vector3(x.x + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, x.y + (Math.random() - 0.5) * 2), k % 2 ? 0xff7a1a : 0xffc040, 0.5, 1.2);
        if (b.tick !== this.fireSaid) { this.fireSaid = b.tick; msgs.push({ side: 1 - x.side, text: `${x.def.name} is set alight` }); }
      } else if (e.type === 'keel') {
        const x = b.ents[e.id], m = b.ents[e.by];
        st.ring(new THREE.Vector3(x.x, 0, x.y), 3, 0xffffff, 1.2);
        msgs.push({ side: m.side, text: `${m.def.name} breaks ${x.def.name}'s back in one bite` });
      } else if (e.type === 'swallowed') {
        const x = b.ents[e.id], m = b.ents[e.by];
        st.ring(new THREE.Vector3(x.x, 0, x.y), 3, 0x1a1424, 1.4);
        msgs.push({ side: m.side, text: `${m.def.name} swallows ${x.def.name} whole` });
      } else if (e.type === 'dragged') {
        const x = b.ents[e.id], m = b.ents[e.by];
        for (let k = 0; k < 3; k++) st.ring(new THREE.Vector3(x.x, 0, x.y), 1.5 + k, 0xffffff, 0.9 + k * 0.3);
        msgs.push({ side: m ? m.side : 0, text: `${x.def.name} is dragged beneath the waves` });
      } else if (e.type === 'tether') {
        const x = b.ents[e.id], h = b.ents[e.by];
        this.tether(e.by, e.id, x.tether?.until ?? b.tick + 15);
        msgs.push({ side: h.side, text: `${h.def.name} sinks a harpoon into ${x.def.name}: the beast cannot dive` });
      } else if (e.type === 'depthCharge') {
        const p = new THREE.Vector3(e.x, 0, e.y);
        for (let k = 0; k < 3; k++) st.ring(p, 1.5 + k * 1.2, 0xffffff, 0.8 + k * 0.3);
        for (let k = 0; k < 6; k++) st.puff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2.5, (Math.random() - 0.5) * 2)), 0xf4f8ff, 0.7, 1.1);
        msgs.push({ side: b.ents[e.id].side, text: `${b.ents[e.id].def.name} drops depth charges: the beast is forced up` });
      } else if (e.type === 'barrel') {
        // a fire barrel tumbles from her stern and bobs in her wake
        const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2e }));
        bm.position.set(e.x, 0.1, e.y); bm.rotation.z = Math.PI / 2;
        this.dynamic.add(bm); (this.barrels ||= []).push({ m: bm, x: e.x, y: e.y, born: this.time });
        if (b.tick - (this.barrelSaid || -99) > 20) { this.barrelSaid = b.tick; msgs.push({ side: b.ents[e.id].side, text: `${b.ents[e.id].def.name} drops fire barrels astern` }); }
      } else if (e.type === 'barrelBurst') {
        const p = new THREE.Vector3(e.x, 0.3, e.y);
        st.ring(p, 2.2, 0xff7a1a, 0.7);
        for (let k = 0; k < 6; k++) st.puff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 2, (Math.random() - 0.5) * 1.5)), [0xff7a1a, 0xffc040, 0x3a2e2a][k % 3], 0.6, 1.1);
        if (this.barrels) { const k = this.barrels.findIndex((br) => Math.hypot(br.x - e.x, br.y - e.y) < 1.5); if (k >= 0) { this.dynamic.remove(this.barrels[k].m); this.barrels.splice(k, 1); } }
      } else if (e.type === 'launch') {
        const c = b.ents[e.from];
        st.puff(new THREE.Vector3(c.x, 2, c.y), 0xe8e8e8, 0.5, 0.9);
        if (b.tick - (this.launchSaid || -99) > 15) { this.launchSaid = b.tick; msgs.push({ side: c.side, text: `${c.def.name} launches ${b.ents[e.id].def.name.toLowerCase().startsWith('the') ? '' : 'a '}${b.ents[e.id].def.name}` }); }
      } else if (e.type === 'strafe') {
        const x = b.ents[e.id], t2 = b.ents[e.to];
        for (let k = 0; k < 4; k++) st.projectile(new THREE.Vector3(x.x, AIR_Y - 0.5, x.y), new THREE.Vector3(t2.x + (Math.random() - 0.5) * 2, 0.8, t2.y + (Math.random() - 0.5) * 2), 'swivel', 0.25 + k * 0.05, 0);
        if (b.tick - (this.strafeSaid || -99) > 12) { this.strafeSaid = b.tick; msgs.push({ side: x.side, text: `${x.def.name} strafes ${t2.def.name}'s deck` }); }
      } else if (e.type === 'fireAboard') {
        const x = b.ents[e.id];
        for (let k = 0; k < 3; k++) st.puff(new THREE.Vector3(x.x + (Math.random() - 0.5) * 2, 2 + Math.random() * 2, x.y + (Math.random() - 0.5) * 2), k % 2 ? 0xff7a1a : 0xffc040, 0.5, 1.1);
        if (b.tick - (this.rigFireSaid || -99) > 15) { this.rigFireSaid = b.tick; msgs.push({ side: 1 - x.side, text: `Fire in ${x.def.name}'s rigging` }); }
      } else if (e.type === 'ram') {
        const x = b.ents[e.id], t2 = b.ents[e.to];
        const p = new THREE.Vector3((x.x + t2.x) / 2, 0.5, (x.y + t2.y) / 2);
        st.ring(p, 2.5, 0xffffff, 0.9);
        for (let k = 0; k < 6; k++) st.puff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2)), k % 2 ? 0x8a6a44 : 0xffffff, 0.5, 1);
        msgs.push({ side: x.side, text: `${x.def.name} rams ${t2.def.name} amidships` });
      } else if (e.type === 'aground') {
        const x = b.ents[e.id];
        st.puff(new THREE.Vector3(x.x, 0.3, x.y), 0xc8b088, 0.8, 1.2);
        msgs.push({ side: 1 - x.side, text: `${x.def.name} runs aground on the shoals` });
      } else if (e.type === 'anchor') {
        const x = b.ents[e.id];
        st.ring(new THREE.Vector3(x.x, 0, x.y), 1.2, 0xffffff, 0.8);
        msgs.push({ side: x.side, text: `${x.def.name} drops anchor and lays her mortars` });
      } else if (e.type === 'resupply') {
        const x = b.ents[e.id];
        st.ring(new THREE.Vector3(x.x, 0.1, x.y), 4, 0xffe08a, 1.1);
        msgs.push({ side: x.side, text: `${x.def.name} resupplies the line: shot, shells and spars` });
      } else if (e.type === 'landingRun') {
        msgs.push({ side: e.side, text: `${b.ents[e.id].def.name} makes her run for the beach` });
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
    // island life stirs: a few pieces each frame, nearest the camera first is not worth the sort
    if (this.scenery && this.scenery.length) {
      const n = this.scenery.length, step = Math.max(1, Math.ceil(n / 160));
      this.sceneTurn = ((this.sceneTurn || 0) + 1) % step;
      for (let k = this.sceneTurn; k < n; k += step) animateScenery(this.scenery[k], t);
    }
    // a volcano in eruption pours smoke and sparks from its crater
    if (this.erupting && this.erupting.size) {
      for (const [isl, until] of this.erupting) {
        if (b.tick > until) { this.erupting.delete(isl); continue; }
        const c = this.craters.get(isl);
        if (c && Math.random() < dt * 14) this.stage.puff(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 2, (Math.random() - 0.5) * 1.5)), [0x2a2424, 0x4a3a34, 0xff6a14, 0xffb040][Math.floor(Math.random() * 4)], 1.2 + Math.random(), 1.8);
      }
    }
    // the penguins shuffle, flap and hop
    if (this.birds && this.birds.length) {
      for (const p of this.birds) {
        if (ARCTIC.animateScenery) { ARCTIC.animateScenery(p, t); continue; }
        for (const bd of p.userData.birds || []) { const ph = bd.userData.phase || 0; bd.rotation.z = Math.sin(t * 6 + ph) * 0.14; bd.position.y = 0.12 + Math.max(0, Math.sin(t * 1.3 + ph * 2) - 0.85) * 0.6; }
      }
    }
    const pos = this.waterGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.array[i * 3 + 1] = this.waveH(this.base[i * 3], this.base[i * 3 + 2], t) - 0.15;
    pos.needsUpdate = true;
    if ((this.waterTick = (this.waterTick || 0) + 1) % 2 === 0) this.waterGeo.computeVertexNormals();
    const crewList = this.crewList || (this.crewList = []);
    crewList.length = 0;
    b.ents.forEach((e, i) => {
      const m = this.models[i] || (this.models[i] = this.makeModel(e));
      const died = this.deathAt.get(i);
      if (!e.alive && died === undefined) { m.visible = false; return; }
      const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
      let dh = e.heading - e.ph; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const hd = e.ph + dh * alpha;
      if (e.air) {
        // a squadron flies above the masts; shot down, it tumbles into the sea
        const k = died !== undefined ? (t - died) * speed : 0;
        m.position.set(x, Math.max(-1, AIR_Y - k * k * 4), y);
        m.rotation.y = -hd; m.rotation.z = Math.sin(t * 0.9 + i) * 0.15 + (died !== undefined ? k * 2 : 0);
        animateSquadron(m, t, m.userData.phase, Math.max(1, Math.ceil(3 * e.hp / e.maxHp)));
        if (died !== undefined) { m.userData.bar.visible = false; m.userData.ring.visible = false; if (k > 2) m.visible = false; }
        else { setBar(m.userData.bar, e.hp / e.maxHp); m.userData.ring.position.y = -AIR_Y + 0.08; }
        return;
      }
      if (e.ship && m.userData.crewSlots) crewList.push({ model: m, frac: died === undefined ? (e.crew ?? 0) / Math.max(1, e.def.crew || 1) : 0, color: SIDE_COLORS[e.side], alive: died === undefined && (m.userData.depth || 0) < 0.4 });
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
      // creatures sound; a diving boat goes down until only her wake shows
      const sub = !e.fort && b.tick < e.subUntil;
      const depth = sub ? (e.ship ? (m.userData.top || 1.6) + 0.5 : 1.2) : 0;
      m.userData.depth = (m.userData.depth || 0) + (depth - (m.userData.depth || 0)) * Math.min(1, dt * 3 * speed);
      m.position.y -= m.userData.depth;
      if (e.ship && m.userData.bar) m.userData.bar.visible = died === undefined && m.userData.depth < 0.6;
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
    this.crews.update(crewList, t);
    if (this.barrels) for (let k = this.barrels.length - 1; k >= 0; k--) {
      const br = this.barrels[k];
      br.m.position.y = this.waveH(br.x, br.y, t) * 0.8; br.m.rotation.x = Math.sin(t * 2 + k) * 0.3;
      if (t - br.born > 40) { this.dynamic.remove(br.m); this.barrels.splice(k, 1); }
    }
    // harpoon lines stay taut between the hunter and her catch while the tether holds
    for (let k = this.tethers.length - 1; k >= 0; k--) {
      const L = this.tethers[k], a = b.ents[L.by], c = b.ents[L.to], ma = this.models[L.by], mc = this.models[L.to];
      if (!a || !c || !a.alive || !c.alive || b.tick > L.until) { this.dynamic.remove(L.line); L.line.geometry.dispose(); this.tethers.splice(k, 1); continue; }
      const arr = L.line.geometry.attributes.position.array;
      arr[0] = ma.position.x; arr[1] = ma.position.y + 0.9; arr[2] = ma.position.z;
      arr[3] = mc.position.x; arr[4] = mc.position.y + 0.5; arr[5] = mc.position.z;
      L.line.geometry.attributes.position.needsUpdate = true;
    }
  }

  tether(by, to, until) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xd8c89a }));
    line.frustumCulled = false;
    this.dynamic.add(line);
    this.tethers.push({ by, to, until, line });
  }
}

const AIR_Y = 6.5;

const buildFort = buildFortModel;
