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
import { dressDesign, animateDesign } from './shipParts.js';
import { FleetFx, P, G, toWorld } from './fleetFx.js';

const R = Math.random, rnd = (a = 1) => (R() - 0.5) * 2 * a;
const UP = new THREE.Vector3(0, 1, 0), XA = new THREE.Vector3(1, 0, 0);
const BARREL_GEO = new THREE.CylinderGeometry(0.2, 0.2, 0.4, 12);
const _t0 = new THREE.Vector3(), _t1 = new THREE.Vector3();

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
  dispose() { this.stage.scene.remove(this.root); this.crews?.dispose(); this.fx?.dispose(); this.fx = null; }

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
    this.fx ||= new FleetFx(this.stage, { sea: true });
    this.fx.reset(); this.fx.colors = SIDE_COLORS;
    this.dives = new Map(); this.climbs = new Map();
    this.models = b.ents.map((e) => this.makeModel(e));
    this.deathAt = new Map();
  }

  /** the model for one entity: built at load, or the moment a carrier launches a squadron */
  makeModel(e) {
    const b = this.b;
    if (e.air) {
      const m = buildSquadron(e.def, SIDE_COLORS[e.side], b.sides?.[e.side]?.faction);
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
      const keep = e.def.dress ? dressDesign(m, e.def, SIDE_COLORS[e.side], deckY) : dressRole(m, e.def, SIDE_COLORS[e.side], deckY, b.sides?.[e.side]?.faction);
      if (keep.length) m.userData.crewSlots = slots.filter((p) => !keep.some(([x, z, r]) => Math.hypot(p[0] - x, p[2] - z) < r));
    }
    if (!e.fort) m.rotation.order = 'YXZ'; // so a jolt rolls her about her own keel
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
    const b = this.b, st = this.stage, fx = this.fx, msgs = [];
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const sec = (ticks) => (ticks * TICK_MS) / 1000 / (this.speed || 1);
    const deckAt = (i, out = new THREE.Vector3()) => { const m = this.models[i], x = b.ents[i]; if (!m) return out.set(x.x, 0.8, x.y); const D = fx.dims(m, x); fx.deckPoint(D, out); return toWorld(m, out.x, out.y, out.z, out); };
    const flesh = (x) => x && !x.ship && !x.fort && !x.air;
    for (const e of events) {
      if (e.type === 'shot') {
        const sh = b.ents[e.from], tg = b.ents[e.to], fa = sh?.air, ta = tg?.air, sm = this.models[e.from];
        const from = V(e.x0, fa ? AIR_Y : 0.8, e.y0), to = V(e.x1, ta ? (e.hit ? AIR_Y : AIR_Y + 2) : e.hit ? 0.8 : 0, e.y1);
        const dur = sec(e.flight), look = sh?.def.arts?.shot, opt = { hit: e.hit, flesh: e.hit && flesh(tg) };
        // a broadside comes from the gun ports facing the target, a few guns at a time
        const gun = e.kind === 'cannon' || e.kind === 'heavy' || e.kind === 'chain' || e.kind === 'beam' || e.kind === 'swivel';
        const gm = gun && sh?.ship ? sm : null;
        const n0 = gm ? (gm.userData.gunTurn = (gm.userData.gunTurn || 0) + 3) : 0;
        const dir = V(e.x1 - e.x0, 0, e.y1 - e.y0).normalize();
        if (gm && shipMuzzle(gm, e.x1, e.y1, n0, from) && e.kind !== 'swivel') {
          const p = new THREE.Vector3();
          for (let k = 1; k < 3; k++) if (shipMuzzle(gm, e.x1, e.y1, n0 + k, p)) fx.muzzle(p, dir, 0.75);
        }
        if (gun && sm && !fx.act(sm, 'fire', 0.7)) fx.rock(sm, e.kind === 'heavy' ? 0.03 : 0.015);
        if (gm) this.crews.pulse?.(gm, 'fire');
        if (e.kind === 'torpedo') { // it runs along the surface trailing foam
          from.y = 0.1; to.y = e.hit ? 0.3 : 0.05;
          fx.shot('torpedo', from, to, dur, { ...opt, arc: 0, onLand: (p, f) => { if (f.hit) { fx.splash(p, 2); fx.explode(p, 0.7, { debris: 8, dcol: 0x6a4a30 }); } } });
        } else if (e.kind === 'flak') {
          // flak bursts in black puffs round the fliers
          if (sm && !fx.act(sm, 'flak', 0.5)) fx.rock(sm, 0.01);
          fx.muzzle(from, V(dir.x * 0.4, 0.9, dir.z * 0.4), 0.5);
          fx.shot('flak', from, to.add(V(rnd(1), rnd(0.5), rnd(1))), dur, { ...opt, arc: 0.05 });
        } else if (e.kind === 'beam' || (e.kind === 'mortar' && ['beam', 'lightning', 'sound'].includes(look))) {
          // a beam of light, warp-fire, lightning or sound: straight and at once
          const col = look === 'lightning' ? 0xd8e8ff : look === 'sound' ? 0xe0c0ff : (typeof sh?.def.arts?.beam === 'number' ? sh.def.arts.beam : 0x9affc0);
          from.y = 1.4;
          if (e.kind === 'mortar' && sm && !fx.act(sm, 'mortar', 0.8)) fx.rock(sm, 0.02, 0.02);
          if (look === 'sound') {
            const n = V().subVectors(to, from).normalize();
            for (let k = 0; k < 6; k++) fx.after(k * 0.06, () => fx.ring(V().lerpVectors(from, to, k / 5), n, 0.15, 0.7 + k * 0.08, col, 0.45));
            fx.after(0.3, () => fx.glyph(G.notes, to, 3, col, 0.9, 1.2, true));
          } else if (look === 'lightning') {
            fx.beam(from, to, col, 0.05, 0.3, 0.7); fx.beam(from, to, 0xffffff, 0.03, 0.18, 0.5);
            fx.emit(P.FLASH, to.x, to.y, to.z, 1, 0, 0, 0, 0, 1.4, 0xe8f0ff, 0x8aa8ff);
          } else { fx.beam(from, to, col, 0.07, 0.42); fx.emit(P.GLOW, from.x, from.y, from.z, 2, 0, 0, 0, 0, 1, col, col); }
          if (e.hit) { fx.emit(P.GLOW, to.x, to.y, to.z, 3, 0, 0, 0, 0, 1.3, col, col); fx.emit(P.SPARK, to.x, to.y, to.z, 8, 0, 0.5, 0, 3, 1, 0xffffff, col); if (!flesh(tg)) fx.splinters(to, V(dir.x, 0.4, dir.z), 4, 0.8, 0x3a2a1a); }
          else fx.splash(to, 0.8);
        } else if (e.kind === 'mortar' || e.kind === 'shell') {
          // a mortar lobs its shell high over masts and islands; some realms throw rockets, boulders, skulls or pots
          from.y = 1.4;
          const k = { rocket: 'rocket', boulder: 'boulder', skull: 'skull', pot: 'pot', acid: 'acid', stone: 'stone' }[look] || 'mortar';
          if (sm && !fx.act(sm, 'mortar', 0.9)) fx.rock(sm, 0.03, 0.04, 0.04);
          fx.shot(k, from, to, dur, { ...opt, arc: k === 'rocket' ? 1.6 : 3.2 });
          if (k === 'rocket') { fx.emit(P.FIRE, from.x, from.y, from.z, 8, 0, 0.3, 0, 2, 1); fx.emit(P.SMOKE, from.x, from.y, from.z, 6, 0, 0.2, 0, 1.2, 1); }
          else { fx.emit(P.FLASH, from.x, from.y + 0.3, from.z, 1, 0, 0, 0, 0, 1.6); fx.emit(P.GUN, from.x, from.y + 0.4, from.z, 8, 0, 1, 0, 2.2, 1.3, k === 'skull' ? 0xb8e0a8 : 0xf4f2ec); fx.ring(V(from.x, from.y + 0.2, from.z), null, 0.2, 1.4, 0xffd8a0, 0.4); }
        } else if (e.kind === 'depth') {
          from.y = 0.3; to.y = -0.2;
          fx.shot('depth', from, to, dur, { arc: 0.8 });
        } else if (e.kind === 'harpoon') {
          if (sm && !fx.act(sm, 'harpoon', 0.7)) fx.rock(sm, 0.015);
          fx.muzzle(from, dir, 0.4);
          fx.shot('harpoon', from, to, dur, { ...opt, arc: 0.3, line: true });
        } else if (e.kind === 'spell') {
          fx.shot('spell', from, to, dur, { ...opt, arc: 0.5, color: 0x8ab4ff });
        } else {
          if (e.kind === 'swivel') fx.emit(P.FLASH, from.x, from.y, from.z, 1, 0, 0, 0, 0, 0.35);
          fx.shot(['cannon', 'heavy', 'chain', 'swivel'].includes(e.kind) ? e.kind : 'cannon', from, to, dur, { ...opt, arc: e.kind === 'swivel' ? 0.1 : 0.5 });
        }
        if (gun && e.kind !== 'beam') fx.muzzle(from, dir, e.kind === 'heavy' ? 1.25 : e.kind === 'swivel' ? 0.4 : 0.9);
      } else if (e.type === 'blast') {
        fx.explode(V(e.x, 0.4, e.y), 0.6 + (e.r || 1) * 0.3, { debris: 5 });
      } else if (e.type === 'splash') {
        // the shot's own landing makes the splash
      } else if (e.type === 'hit') {
        const x = b.ents[e.id], m = this.models[e.id];
        st.splat(new THREE.Vector3(x.x, 2.5, x.y), e.dmg);
        if (m && !x.air && !fx.act(m, 'hit', 0.5)) fx.rock(m, Math.min(0.08, 0.01 + e.dmg * 0.0015), 0, 0.02);
      } else if (e.type === 'death') {
        this.deathAt.set(e.id, this.time);
        const x = b.ents[e.id], p = V(x.x, 0.5, x.y);
        if (x.ship) { fx.explode(p, 0.9, { debris: 16 }); fx.splash(p, 2); fx.emit(P.BLACK, p.x, 1, p.z, 10, 0, 1, 0, 1, 1.6); }
        else if (x.air) fx.explode(V(x.x, AIR_Y, x.y), 0.6, { debris: 8 });
        else if (!x.fort) { fx.splash(p, 2.4); fx.emit(P.SPRAY, p.x, 0, p.z, 10, 0, 1, 0, 3, 1, 0xd86a5a, 0x8a2a20); }
        else fx.explode(p, 1.2, { dcol: 0x8a8274, s0: 0x8a7a6a, s1: 0xc8bca0 });
        msgs.push({ side: x.side, text: `${x.def.name} ${x.ship ? 'is sunk' : x.fort ? 'is reduced to rubble' : x.air ? 'is shot down' : 'is slain'}` });
      } else if (e.type === 'rake') {
        const x = b.ents[e.id], m = this.models[e.id];
        const p = m ? toWorld(m, (e.stern ? -1 : 1) * fx.dims(m, x).hx, fx.dims(m, x).deckY, 0, V()) : V(x.x, 1.2, x.y);
        fx.splinters(p, UP, 14, 1); fx.emit(P.SMOKE, p.x, p.y, p.z, 4, 0, 1, 0, 0.6, 0.8); if (m) fx.rock(m, 0.02, (e.stern ? 1 : -1) * 0.05);
        msgs.push({ side: b.ents[e.by].side, text: `${b.ents[e.by].def.name} rakes ${x.def.name} ${e.stern ? 'through the stern' : 'across the bow'}` });
      } else if (e.type === 'rigging') {
        const x = b.ents[e.id], m = this.models[e.id];
        if (m) { const D = fx.dims(m, x), p = toWorld(m, 0, D.top * 0.7, 0, V()); fx.splinters(p, UP, 8, 1, 0xe8e0cc); fx.splinters(p, UP, 6, 0.8, 0x6a4a2e); }
        msgs.push({ side: 1 - b.ents[e.id].side, text: `${b.ents[e.id].def.name}'s rigging is shot away: she loses way` });
      } else if (e.type === 'tack') {
        if (b.tick % 3 === 0) msgs.push({ side: b.ents[e.id].side, text: `${b.ents[e.id].def.name} beats to windward` });
      } else if (e.type === 'boarding') {
        const a = b.ents[e.a], c = b.ents[e.c], ma = this.models[e.a], mc = this.models[e.c];
        if (ma && mc) { fx.boarding(e.a, ma, e.c, mc, a, c, this.speed || 1); this.crews.pulse?.(ma, 'board'); this.crews.pulse?.(mc, 'board'); }
      } else if (e.type === 'captured') {
        const x = b.ents[e.id], m = this.models[e.id];
        msgs.push({ side: e.by, text: `${x.def.name} ${x.fort ? 'stormed and taken' : 'boarded and captured'}` });
        m.userData.ring.material = new THREE.MeshBasicMaterial({ color: SIDE_COLORS[e.by], transparent: true, opacity: 0.6 });
        // her colours are struck and the winner's run up
        fx.strike(m, SIDE_COLORS[1 - e.by], SIDE_COLORS[e.by]);
        m.userData.setSide?.(SIDE_COLORS[e.by]);
        const p = V(x.x, (m.userData.top || 3) + 0.5, x.y);
        fx.emit(P.MOTE, p.x, p.y, p.z, 14, 0, 1, 0, 1.6, 1, SIDE_COLORS[e.by], 0xffffff);
      } else if (e.type === 'ability') {
        const x = b.ents[e.id], m = this.models[e.id];
        if (e.name === 'sweep') { fx.ring(V(x.x, 0.06, x.y), null, 0.5, e.radius, 0x9ad0ff, 0.8); for (let k = 0; k < 16; k++) { const a = (k / 16) * 6.283; fx.emit(P.SPRAY, x.x + Math.cos(a) * e.radius * 0.7, 0.05, x.y + Math.sin(a) * e.radius * 0.7, 2, Math.cos(a), 1, Math.sin(a), 2.5, 1); } }
        if (e.name === 'wave') {
          // the wave rolls out from where it breaks
          for (let k = 0; k < 4; k++) fx.ring(V(e.x, 0.1, e.y), null, 0.3, e.radius * (0.5 + k * 0.25), k % 2 ? 0xffffff : 0x9ad0ff, 0.8 + k * 0.25);
          for (let k = 0; k < 24; k++) { const a = R() * 6.283, r = R() * e.radius; fx.emit(P.SPRAY, e.x + Math.cos(a) * r, 0.1, e.y + Math.sin(a) * r, 2, Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4, 5, 1.6); }
          fx.emit(P.MIST, e.x, 1, e.y, 10, 0, 1, 0, 1, 2);
          msgs.push({ side: x.side, text: `${x.def.name} calls up a great wave` });
        }
        if (e.name === 'breath') {
          const t = b.ents[e.to], pal = e.fire ? [0xffe0a0, 0xc02a08] : e.frost ? [0xffffff, 0x8ac8f0] : [0xf0f0f0, 0xb0b0b0];
          if (m) fx.act(m, 'breath', 1);
          const src = m && m.userData.anchors?.mouth ? toWorld(m, ...m.userData.anchors.mouth, V()) : V(x.x + (t.x - x.x) * 0.15, 1.3, x.y + (t.y - x.y) * 0.15);
          const d = V(t.x - src.x, 0.9 - src.y, t.y - src.z), L = d.length(); d.normalize();
          fx.emitter(0.8, (k, dt) => { const n = Math.ceil(dt * 90); fx.emit(e.fire ? P.FIRE : P.MIST, src.x, src.y, src.z, n, d.x, d.y, d.z, L * 1.6, 1.5, pal[0], pal[1]); if (e.frost) fx.emit(P.GLYPH, src.x, src.y, src.z, 1, d.x, d.y, d.z, L * 1.2, 0.8, 0xffffff, 0xd8f0ff, G.snow); });
          msgs.push({ side: x.side, text: `${x.def.name} ${e.frost ? 'breathes killing frost: spray freezes on the rigging' : 'breathes scalding fire'}` });
        }
        if (e.name === 'snare') { const t = b.ents[e.to]; fx.ring(V(t.x, 0.05, t.y), null, 0.4, 2, 0xc8322a, 0.9); fx.emit(P.SPRAY, t.x, 0.05, t.y, 12, 0, 1, 0, 3, 1); msgs.push({ side: x.side, text: `${x.def.name} fouls ${t.def.name}'s rudder: she cannot turn` }); }
        if (e.name === 'leap') { const t = b.ents[e.to]; fx.splash(V(x.x, 0, x.y), 1.6); fx.splinters(V(t.x, 2.5, t.y), UP, 8, 0.8, 0xe8e0cc); msgs.push({ side: x.side, text: `${x.def.name} snatches topmen from ${b.ents[e.to].def.name}'s rigging` }); }
        if (e.name === 'crush') { const t = b.ents[e.to]; fx.splinters(V(t.x, 0.8, t.y), UP, 12, 1); fx.splash(V(t.x, 0, t.y), 1.4); if (this.models[e.to]) fx.rock(this.models[e.to], 0.12); msgs.push({ side: x.side, text: `${x.def.name} wraps itself round ${b.ents[e.to].def.name}` }); }
        if (e.name === 'breach') { const t = b.ents[e.to]; fx.splash(V(t.x, 0, t.y), 1.2); fx.splinters(V(t.x, 0.2, t.y), UP, 8, 0.9); msgs.push({ side: x.side, text: `${x.def.name} holes ${b.ents[e.to].def.name} below the waterline` }); }
        if (e.name === 'overboard' && e.n >= 3) msgs.push({ side: x.side, text: `${e.n} hands are swept from ${b.ents[e.to].def.name}'s deck` });
        if (e.name === 'ink' || e.name === 'charm' || e.name === 'ram') msgs.push({ side: x.side, text: `${x.def.name}: ${e.name === 'ink' ? 'ink cloud blinds the gunners' : e.name === 'charm' ? 'song lures a ship off course' : 'rams a hull'}` });
        if (e.name === 'ink') { const t = b.ents[e.to]; fx.emit(P.BLACK, t.x, 0.6, t.y, 14, 0, 0.3, 0, 1.5, 2.2, 0x0a0a12, 0x2a2a38); }
        if (e.name === 'charm') { const t = b.ents[e.to]; for (let k = 0; k < 5; k++) fx.after(k * 0.15, () => fx.emit(P.GLYPH, x.x, 1.2, x.y, 1, t.x - x.x, 0.3, t.y - x.y, 0.5, 1.1, 0xffb0e0, 0xd080ff, k % 2 ? G.note : G.notes)); }
        if (e.name === 'ram') { const t = b.ents[e.to]; this.ramFx(x, t, m, this.models[e.to]); }
      } else if (e.type === 'rumble') {
        msgs.push({ side: 0, text: 'The mountain rumbles' });
      } else if (e.type === 'eruption') {
        this.erupting.set(e.isl, e.until);
        const c = this.craters.get(e.isl);
        if (c) { fx.explode(c, 2.4, { debris: 12, dcol: 0x2a2220 }); for (let k = 0; k < 14; k++) st.puff(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 4, (Math.random() - 0.5) * 3)), k % 3 ? 0x3a2e2a : 0xff6a14, 1.6, 2.2); }
        msgs.push({ side: 1, text: 'The volcano erupts: molten rock falls on both fleets' });
      } else if (e.type === 'bombUp') {
        const isl = [...this.craters.values()].sort((a, c2) => Math.hypot(a.x - e.x0, a.z - e.y0) - Math.hypot(c2.x - e.x0, c2.z - e.y0))[0];
        const from = isl ? isl.clone() : new THREE.Vector3(e.x0, 6, e.y0);
        fx.shot('rocket', from, new THREE.Vector3(e.x1, 0.1, e.y1), sec(e.flight), { arc: 2.4 });
      } else if (e.type === 'lavabomb') {
        const p = new THREE.Vector3(e.x, 0.1, e.y);
        fx.ring(p, null, 0.3, 2.4, 0xff7a1a, 0.7);
        if (e.hit) fx.explode(p, 0.7, { debris: 6, dcol: 0x2a1a10 }); else { fx.splash(p, 1.2); fx.emit(P.MIST, p.x, 0.4, p.z, 6, 0, 1, 0, 1, 1.2, 0xffffff, 0xd8d8d8); }
      } else if (e.type === 'torpedo') {
        const x = b.ents[e.id];
        if (b.tick !== this.torpSaid) { this.torpSaid = b.tick; msgs.push({ side: x.side, text: `${x.def.name} looses a torpedo at ${b.ents[e.to].def.name}` }); }
      } else if (e.type === 'frozen') {
        const x = b.ents[e.id];
        fx.mark(e.id, 'freeze');
        fx.ring(V(x.x, 0.06, x.y), null, 0.4, 2.4, 0xd8f0ff, 0.9);
        fx.emit(P.MIST, x.x, 0.8, x.y, 8, 0, 1, 0, 1, 1.2, 0xf4fbff, 0xffffff); fx.glyph(G.snow, V(x.x, 1.4, x.y), 4, 0xe8f6ff, 0.7, 0.8);
      } else if (e.type === 'refused') {
        msgs.push({ side: e.side, text: `The ${e.name} will not sail in this company and is gone` });
      } else if (e.type === 'afire') {
        const x = b.ents[e.id];
        for (let k = 0; k < 3; k++) { const p = deckAt(e.id); fx.emit(P.FIRE, p.x, p.y, p.z, 8, 0, 1, 0, 1, 1.2); fx.emit(P.FLASH, p.x, p.y, p.z, 1, 0, 0, 0, 0, 0.9, 0xffc060, 0xff6010); }
        if (b.tick !== this.fireSaid) { this.fireSaid = b.tick; msgs.push({ side: 1 - x.side, text: `${x.def.name} is set alight` }); }
      } else if (e.type === 'keel') {
        const x = b.ents[e.id], m = b.ents[e.by];
        fx.splinters(V(x.x, 0.8, x.y), UP, 30, 1.4); fx.splash(V(x.x, 0, x.y), 2.6); fx.ring(V(x.x, 0.05, x.y), null, 0.5, 3, 0xffffff, 1.2);
        msgs.push({ side: m.side, text: `${m.def.name} breaks ${x.def.name}'s back in one bite` });
      } else if (e.type === 'swallowed') {
        const x = b.ents[e.id], m = b.ents[e.by];
        fx.splash(V(x.x, 0, x.y), 3); fx.ring(V(x.x, 0.05, x.y), null, 3, 0.3, 0x1a1424, 1.4); fx.splinters(V(x.x, 0.5, x.y), UP, 12, 1);
        msgs.push({ side: m.side, text: `${m.def.name} swallows ${x.def.name} whole` });
      } else if (e.type === 'dragged') {
        const x = b.ents[e.id], m = b.ents[e.by];
        for (let k = 0; k < 4; k++) fx.ring(V(x.x, 0.05, x.y), null, 3 + k, 0.4, 0xffffff, 1 + k * 0.3);
        fx.splash(V(x.x, 0, x.y), 2);
        msgs.push({ side: m ? m.side : 0, text: `${x.def.name} is dragged beneath the waves` });
      } else if (e.type === 'art') {
        const x = b.ents[e.id], by = e.by !== undefined ? b.ents[e.by] : null, at = new THREE.Vector3(e.x ?? x.x, 0.5, e.y ?? x.y);
        const say = (side, text, gap = 25) => { const k = `art:${e.name}`; if (b.tick - (this[k] || -999) > gap) { this[k] = b.tick; msgs.push({ side, text }); } };
        this.artFx(e, x, by, at);
        switch (e.name) {
          case 'pierce': say(by.side, `${by.def.name}'s shot punches clean through into ${x.def.name}`); break;
          case 'grapple': say(by.side, `${by.def.name} locks onto ${x.def.name}: boarders over the rail`); break;
          case 'snare': say(by.side, `${by.def.name} fouls ${x.def.name}'s rudder`); break;
          case 'misfire': say(1 - x.side, `A gun bursts aboard ${x.def.name}`); break;
          case 'plague': say(by.side, `Sickness spreads through ${x.def.name}'s crew`); break;
          case 'stun': say(by.side, `${x.def.name}'s gun crews are stunned`); break;
          case 'paralyze': case 'freeze': say(by.side, `${x.def.name} is ${e.name === 'freeze' ? 'frozen in the water' : 'held fast, unable to move'}`); break;
          case 'scare': say(by.side, `${x.def.name} turns tail and flees the fleet`); break;
          case 'dominate': say(by.side, `${x.def.name} is turned against its own side`, 5); break;
          case 'reanimate': say(x.side, `The drowned rise to crew ${x.def.name}'s fleet`); break;
          case 'blast': say(1 - x.side, `${x.def.name} explodes as she goes down`, 5); break;
          case 'fireship': say(x.side, `${x.def.name} rams home and bursts into flame`, 5); break;
          case 'intercept': say(1 - x.side, `${x.def.name}'s run is broken up by interceptors`); break;
          case 'beach': say(x.side, `${x.def.name} hits the beach and storms ashore`, 5); break;
          default: break;
        }
      } else if (e.type === 'tether') {
        const x = b.ents[e.id], h = b.ents[e.by];
        this.tether(e.by, e.id, x.tether?.until ?? b.tick + 15);
        msgs.push({ side: h.side, text: `${h.def.name} sinks a harpoon into ${x.def.name}: the beast cannot dive` });
      } else if (e.type === 'depthCharge') {
        const p = new THREE.Vector3(e.x, 0, e.y);
        fx.splash(p, 1);
        fx.after(0.4, () => { fx.emit(P.SPRAY, p.x, 0, p.z, 34, 0, 1, 0, 9, 1.7); fx.emit(P.MIST, p.x, 1.6, p.z, 8, 0, 1, 0, 1, 1.8); for (let k = 0; k < 3; k++) fx.ring(V(p.x, 0.05, p.z), null, 0.5, 1.5 + k * 1.4, 0xffffff, 0.8 + k * 0.3); });
        msgs.push({ side: b.ents[e.id].side, text: `${b.ents[e.id].def.name} drops depth charges: the beast is forced up` });
      } else if (e.type === 'barrel') {
        // a fire barrel tumbles from her stern and bobs in her wake
        const bm = new THREE.Mesh(BARREL_GEO, mat(0x6b4a2e));
        bm.position.set(e.x, 0.1, e.y); bm.rotation.z = Math.PI / 2;
        this.dynamic.add(bm); (this.barrels ||= []).push({ m: bm, x: e.x, y: e.y, born: this.time });
        fx.emit(P.SPRAY, e.x, 0.05, e.y, 6, 0, 1, 0, 2, 0.7);
        if (b.tick - (this.barrelSaid || -99) > 20) { this.barrelSaid = b.tick; msgs.push({ side: b.ents[e.id].side, text: `${b.ents[e.id].def.name} drops fire barrels astern` }); }
      } else if (e.type === 'barrelBurst') {
        const p = new THREE.Vector3(e.x, 0.3, e.y);
        fx.explode(p, 0.8, { debris: 8 }); fx.splash(p, 1);
        if (this.barrels) { const k = this.barrels.findIndex((br) => Math.hypot(br.x - e.x, br.y - e.y) < 1.5); if (k >= 0) { this.dynamic.remove(this.barrels[k].m); this.barrels.splice(k, 1); } }
      } else if (e.type === 'launch') {
        const c = b.ents[e.from], cm = this.models[e.from];
        // the deck crane or catapult throws her up; she climbs away from the deck
        if (cm && !fx.act(cm, 'launch', 1.2)) fx.rock(cm, 0.02, 0.03);
        const p = cm ? toWorld(cm, fx.dims(cm, c).bow[0] * 0.7, fx.dims(cm, c).deckY + 0.2, 0, V()) : V(c.x, 2, c.y);
        fx.emit(P.GUN, p.x, p.y, p.z, 8, 0, 0.6, 0, 1.6, 1.1); fx.emit(P.SPRAY, p.x, 0.05, p.z, 6, 0, 1, 0, 2, 0.7);
        this.climbs.set(e.id, { t0: fx.time, y0: p.y });
        if (b.tick - (this.launchSaid || -99) > 15) { this.launchSaid = b.tick; msgs.push({ side: c.side, text: `${c.def.name} launches ${b.ents[e.id].def.name.toLowerCase().startsWith('the') ? '' : 'a '}${b.ents[e.id].def.name}` }); }
      } else if (e.type === 'strafe') {
        const x = b.ents[e.id], t2 = b.ents[e.to];
        this.strafeFx(e.id, e.to);
        if (b.tick - (this.strafeSaid || -99) > 12) { this.strafeSaid = b.tick; msgs.push({ side: x.side, text: `${x.def.name} strafes ${t2.def.name}'s deck` }); }
      } else if (e.type === 'fireAboard') {
        const x = b.ents[e.id], m = this.models[e.id];
        const p = m ? toWorld(m, 0, fx.dims(m, x).top * 0.55, 0, V()) : V(x.x, 3, x.y);
        fx.emit(P.FIRE, p.x, p.y, p.z, 14, 0, 1, 0, 1, 1.3); fx.emit(P.EMBER, p.x, p.y, p.z, 10, 0, 1, 0, 2); fx.emit(P.BLACK, p.x, p.y + 0.5, p.z, 4, 0, 1, 0, 1, 1);
        if (b.tick - (this.rigFireSaid || -99) > 15) { this.rigFireSaid = b.tick; msgs.push({ side: 1 - x.side, text: `Fire in ${x.def.name}'s rigging` }); }
      } else if (e.type === 'ram') {
        const x = b.ents[e.id], t2 = b.ents[e.to];
        this.ramFx(x, t2, this.models[e.id], this.models[e.to], e.dmg);
        msgs.push({ side: x.side, text: `${x.def.name} rams ${t2.def.name} amidships` });
      } else if (e.type === 'aground') {
        const x = b.ents[e.id], m = this.models[e.id];
        fx.dust(V(x.x, 0.3, x.y), 1.4); fx.emit(P.SPRAY, x.x, 0.05, x.y, 12, 0, 1, 0, 2.5, 1); if (m) fx.rock(m, 0.1, 0.12, 0.1);
        msgs.push({ side: 1 - x.side, text: `${x.def.name} runs aground on the shoals` });
      } else if (e.type === 'anchor') {
        const x = b.ents[e.id], m = this.models[e.id];
        const p = m ? toWorld(m, fx.dims(m, x).bow[0] + 1, 0, 0, V()) : V(x.x, 0, x.y);
        fx.splash(p, 0.8); fx.ring(V(x.x, 0.05, x.y), null, 0.3, 1.6, 0xffffff, 0.8);
        msgs.push({ side: x.side, text: `${x.def.name} drops anchor and lays her mortars` });
      } else if (e.type === 'resupply') {
        const x = b.ents[e.id], m = this.models[e.id];
        if (m) fx.act(m, 'aura', 1.2);
        fx.ring(V(x.x, 0.08, x.y), null, 0.6, 4, 0xffe08a, 1.1); fx.ring(V(x.x, 0.08, x.y), null, 0.3, 2.4, 0xffffff, 0.8);
        for (let k = 0; k < 10; k++) { const p = deckAt(e.id); fx.emit(P.MOTE, p.x, p.y, p.z, 1, 0, 1, 0, 1.4, 1.2, 0xffe08a, 0xffffff); }
        msgs.push({ side: x.side, text: `${x.def.name} resupplies the line: shot, shells and spars` });
      } else if (e.type === 'landingRun') {
        msgs.push({ side: e.side, text: `${b.ents[e.id].def.name} makes her run for the beach` });
      } else if (e.type === 'submerge') {
        const x = b.ents[e.id]; fx.ring(V(x.x, 0.05, x.y), null, 0.3, 1.6, 0xffffff, 0.8); fx.emit(P.SPRAY, x.x, 0.05, x.y, 10, 0, 1, 0, 1.6, 0.8); fx.emit(P.MIST, x.x, 0.3, x.y, 4, 0, 1, 0, 0.4, 0.8);
      }
    }
    return msgs;
  }

  /** a ram: the bow drives in, a burst of splinters, a bow wave, both hulls rock */
  ramFx(x, t, mx, mt, dmg = 30) {
    const fx = this.fx, p = new THREE.Vector3((x.x + t.x) / 2, 0.6, (x.y + t.y) / 2);
    if (mx) { const D = fx.dims(mx, x); toWorld(mx, D.bow[0], D.deckY * 0.6, D.bow[2], p); }
    const d = new THREE.Vector3(t.x - x.x, 0, t.y - x.y).normalize(), s = Math.min(1.8, 0.7 + dmg / 60);
    if (mx) this.crews.pulse?.(mx, 'brace'); if (mt) this.crews.pulse?.(mt, 'brace');
    if (mx && !fx.act(mx, 'ram', 0.9)) fx.rock(mx, 0.02, -0.12 * s, 0.05);
    else if (mx) fx.rock(mx, 0.02, -0.08 * s);
    if (mt) { if (!fx.act(mt, 'hit', 0.7)) fx.rock(mt, 0.2 * s, 0.02, 0.08); else fx.rock(mt, 0.14 * s); }
    fx.splinters(p, new THREE.Vector3(d.x * 0.8, 0.5, d.z * 0.8), Math.round(18 * s), 1.1);
    fx.splinters(p, new THREE.Vector3(-d.x * 0.4, 0.6, -d.z * 0.4), Math.round(6 * s), 0.8);
    fx.emit(P.SPARK, p.x, p.y, p.z, 12, d.x, 0.5, d.z, 3);
    fx.emit(P.FLASH, p.x, p.y, p.z, 1, 0, 0, 0, 0, 1, 0xfff0d0, 0xffa060);
    // the bow wave thrown up either side of the stem
    const sx = -d.z, sz = d.x;
    for (const sg of [-1, 1]) fx.emit(P.SPRAY, p.x, 0.05, p.z, Math.round(18 * s), sx * sg + d.x * 0.3, 1.1, sz * sg + d.z * 0.3, 4 * s, 1.3);
    fx.emit(P.MIST, p.x, 0.5, p.z, 5, 0, 1, 0, 0.8, 1.2);
    fx.ring(new THREE.Vector3(p.x, 0.05, p.z), null, 0.4, 2.6 * s, 0xffffff, 1);
  }

  /** a squadron's diving run: down out of the sky, guns walking along the deck, and up again */
  strafeFx(id, to) {
    const fx = this.fx, m = this.models[id], mt = this.models[to], tg = this.b.ents[to];
    if (!m) return;
    this.dives.set(id, { t0: fx.time, dur: 1.5 });
    if (!mt) return;
    const D = fx.dims(mt, tg), dur = 0.16;
    for (let k = 0; k < 8; k++) fx.after(0.4 + k * 0.06, () => {
      if (!m.visible) return;
      const from = m.position.clone(); from.y -= 0.3;
      const to2 = toWorld(mt, D.hx * (-0.8 + k * 0.22), D.deckY + 0.05, rnd(D.hz * 0.6), new THREE.Vector3());
      fx.shot('tracer', from, to2, dur, { arc: 0, hit: true });
      fx.emit(P.FLASH, from.x, from.y, from.z, 1, 0, 0, 0, 0, 0.35, 0xfff0b0, 0xff8030);
    });
  }

  /** each ship art its own look */
  artFx(e, x, by, at) {
    const fx = this.fx, b = this.b, V = (a, c, d) => new THREE.Vector3(a, c, d), m = this.models[e.id], bm = by ? this.models[e.by] : null;
    const D = m && !x.air ? fx.dims(m, x) : null, deck = D ? toWorld(m, 0, D.deckY + 0.2, 0, V()) : at.clone();
    switch (e.name) {
      case 'pierce': {
        // the ball goes clean through one hull, splinters out of her far side, and into the next
        const f = b.ents[e.from], a = V(f.x, 0.8, f.y), c = V(x.x, 0.8, x.y), d = V().subVectors(c, a).normalize();
        fx.beam(a, c, 0xfff4d0, 0.025, 0.3);
        fx.splinters(a.clone().addScaledVector(d, f.radius * 0.8), d, 14, 1); fx.splinters(c.clone().addScaledVector(d, -x.radius * 0.8), d, 10, 0.9);
        fx.emit(P.SMOKE, a.x, a.y, a.z, 3, d.x, 0.2, d.z, 1, 0.7);
        break;
      }
      case 'misfire': {
        // a gun bursts on her own deck
        const p = V(); if (!m || !shipMuzzle(m, x.x + 5, x.y + 5, Math.floor(R() * 8), p)) p.copy(deck);
        fx.explode(p, 0.7, { debris: 10, dcol: 0x2a2a2e });
        fx.emit(P.BLACK, p.x, p.y + 0.4, p.z, 6, 0, 1, 0, 1, 1.2);
        if (m && !fx.act(m, 'hit', 0.6)) fx.rock(m, 0.1, 0, 0.05);
        break;
      }
      case 'plague': {
        // a sickly green cloud rolls across her deck
        if (D) for (let k = 0; k < 14; k++) { const p = toWorld(m, ...fx.deckPoint(D, V()).toArray(), V()); fx.emit(P.POISON, p.x, p.y + 0.2, p.z, 1, rnd(1), 0.3, rnd(1), 0.5, 1.2, 0x6a8a24, 0xb0b860); fx.emit(P.FLY, p.x, p.y + 0.4, p.z, 3); }
        fx.glyph(G.skull, deck.clone().setY(deck.y + 1), 2, 0xb8d070, 1.2, 1);
        break;
      }
      case 'stun': {
        // a concussion: a white shock ring and stars going round over the gun deck
        fx.ring(deck.clone(), null, 0.3, (x.radius || 2) * 2, 0xffffff, 0.5);
        fx.ring(deck.clone().setY(deck.y + 0.4), new THREE.Vector3(0, 1, 0).applyAxisAngle(XA, 0.4), 0.2, 1.8, 0xfff4c0, 0.4);
        fx.emitter(1.6, (k, dt) => { if (!m) return; for (let n = fx.rate(this, 'stunR', 7, dt); n > 0; n--) { const a = fx.time * 5 + n; fx.emit(P.RUNE, m.position.x + Math.cos(a) * 0.8, (D ? D.deckY : 1) + 1.1, m.position.z + Math.sin(a) * 0.8, 1, 0, 0, 0, 0, 0.8, 0xfff080, 0xffc040, G.star); } });
        break;
      }
      case 'paralyze': {
        fx.mark(e.id, 'paralyze');
        const r = x.radius || 1.5;
        for (let k = 0; k < 5; k++) fx.after(k * 0.08, () => { const c = m ? m.position : at; fx.beam(V(c.x + rnd(r), 0.4 + R(), c.z + rnd(r)), V(c.x + rnd(r), 0.4 + R(), c.z + rnd(r)), 0xd8ff60, 0.03, 0.2, 0.35); });
        if (bm) fx.beam(V(bm.position.x, 1, bm.position.z), V(x.x, 0.8, x.y), 0xd8ff60, 0.03, 0.3, 0.6);
        fx.emit(P.SPARK, x.x, 0.8, x.y, 14, 0, 0.5, 0, 3, 1, 0xf0ffa0, 0xa0d020);
        break;
      }
      case 'freeze': {
        fx.mark(e.id, 'freeze');
        fx.emit(P.MIST, x.x, 0.6, x.y, 12, 0, 1, 0, 1.4, 1.3, 0xf4fbff, 0xd8f0ff);
        fx.emit(P.SPARK, x.x, 0.8, x.y, 14, 0, 0.6, 0, 3, 1, 0xffffff, 0x9ad8ff);
        fx.glyph(G.snow, V(x.x, 1.2, x.y), 6, 0xe8f6ff, 0.8, 1);
        fx.ring(V(x.x, 0.05, x.y), null, 0.3, (x.radius || 1.5) * 1.8, 0xc8ecff, 1);
        break;
      }
      case 'scare': {
        // terror: skulls burst from the beast, it thrashes and turns tail
        fx.glyph(G.skull, V(x.x, 1.5, x.y), 4, 0xd0b0ff, 1.1, 1.4);
        fx.emit(P.SMOKE, x.x, 1, x.y, 8, 0, 0.6, 0, 1.2, 1.1, 0x3a2a4a, 0x7a6a8a);
        fx.emit(P.SPRAY, x.x, 0.05, x.y, 18, 0, 1, 0, 4, 1.2);
        break;
      }
      case 'dominate': {
        // a violet chain of will from the harpooner to the beast
        if (bm) fx.beam(V(), V(), 0xb040ff, 0.05, 1.4, 0.3, (f) => { f.a.set(bm.position.x, 1.2, bm.position.z); const c = this.models[e.id]; if (c) f.c.set(c.position.x, 0.8, c.position.z); });
        fx.glyph(G.rune, V(x.x, 1.4, x.y), 6, 0xc070ff, 0.9, 1.2, true);
        fx.ring(V(x.x, 0.06, x.y), null, 0.4, 3, 0xb040ff, 1.2);
        fx.emit(P.MOTE, x.x, 0.6, x.y, 16, 0, 1, 0, 2, 1.1, 0xd090ff, 0x6020a0);
        break;
      }
      case 'reanimate': {
        // the drowned rise from the wreck as green ghost-light and stream across to her side's decks
        const w = b.ents[e.from], src = V(w.x, 0.2, w.y);
        fx.glyph(G.skull, src.clone().setY(1), 2, 0x9affb0, 1.2, 0.8, true);
        fx.emitter(2, (k, dt) => {
          const c = this.models[e.id]; if (!c) return;
          const dst = c.position, n = Math.ceil(dt * 50);
          for (let j = 0; j < n; j++) { const u = (k * 1.5 + j * 0.13 + R() * 0.1) % 1; const p = V().lerpVectors(src, dst, u); p.y = 0.3 + Math.sin(u * Math.PI) * 3 + (D ? D.deckY * u : 0); fx.emit(P.MOTE, p.x + rnd(0.3), p.y, p.z + rnd(0.3), 1, 0, 1, 0, 0.3, 1.1, 0x9affb0, 0x2a8a5a); }
          if (R() < dt * 6) fx.emit(P.HAZE, src.x + rnd(1), 0.3, src.z + rnd(1), 1, 0, 1, 0, 0.6, 1, 0x7affa0, 0x2a6a4a);
        });
        break;
      }
      case 'blast': {
        // her magazine goes up as she sinks
        const p = V(e.x, 0.8, e.y);
        fx.explode(p, 2.4, { debris: 18 }); fx.splash(p, 3);
        fx.emit(P.BLACK, p.x, 2, p.z, 16, 0, 1, 0, 2.5, 2.4);
        fx.ring(V(p.x, 0.05, p.z), null, 1, 7, 0xffffff, 1.2);
        break;
      }
      case 'fireship': {
        const p = V(e.x, 0.8, e.y);
        fx.explode(p, 1.8, { debris: 14, c0: 0xfff0a0, c1: 0xff3a08 });
        fx.emit(P.FIRE, p.x, p.y, p.z, 40, 0, 1, 0, 2.5, 1.6);
        fx.emit(P.EMBER, p.x, p.y, p.z, 30, 0, 1, 0, 4, 1);
        for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.283; fx.shot('rocket', p, V(p.x + Math.cos(a) * 3, 0.3, p.z + Math.sin(a) * 3), 0.6 + R() * 0.3, { arc: 2 }); }
        break;
      }
      case 'intercept': {
        // interceptors dive across her line: tracers from every side and puffs round the squadron
        const c = m ? m.position : V(x.x, AIR_Y, x.y);
        for (let k = 0; k < 8; k++) fx.after(k * 0.07, () => { const a = R() * 6.283, from = V(c.x + Math.cos(a) * 6, c.y + rnd(2), c.z + Math.sin(a) * 6); fx.shot('tracer', from, V(c.x + rnd(1), c.y + rnd(0.5), c.z + rnd(1)), 0.25, { arc: 0, hit: true }); });
        for (let k = 0; k < 5; k++) fx.after(0.2 + k * 0.1, () => fx.shot('flak', V(c.x, c.y, c.z), V(c.x + rnd(2.5), c.y + rnd(1), c.z + rnd(2.5)), 0.05, { arc: 0, hit: true }));
        if (m) fx.rock(m, 0.35, 0.2);
        break;
      }
      case 'beach': {
        // her ramp drops on the sand and her troops charge the fort
        const t = b.ents[e.to], mt = this.models[e.to];
        if (m && !fx.act(m, 'beach', 1.2)) fx.rock(m, 0.02, -0.12, 0.05);
        if (!D) break;
        const bow = toWorld(m, D.bow[0], 0.1, 0, V());
        fx.dust(bow, 1.6); fx.emit(P.SPRAY, bow.x, 0.05, bow.z, 18, 0, 1, 0, 3, 1.2);
        if (mt && t) {
          const Dt = fx.dims(mt, t);
          for (let k = 0; k < 7; k++) {
            const pa = new THREE.Vector3(D.hx * (0.2 + R() * 0.5), D.deckY, rnd(D.hz * 0.6)), pb = fx.railToward(mt, Dt, m.position, rnd(0.8), new THREE.Vector3());
            fx.boarder(m, pa, mt, pb, SIDE_COLORS[x.side], { style: 'climb', delay: 0.6 + k * 0.15, dur: 1.4 + R() * 0.4, fight: 0.5 + R() * 0.6, lose: R() < 0.3, foeColor: k % 2 ? SIDE_COLORS[t.side] : null, foeLose: true });
          }
        }
        break;
      }
      case 'snare': {
        // grapnel lines whip out to her stern and foul the rudder
        if (!bm || !D) break;
        const st2 = toWorld(m, D.stern[0], 0.2, 0, V());
        for (let k = 0; k < 2; k++) fx.shot('harpoon', V(bm.position.x, 1, bm.position.z), st2.clone().add(V(rnd(0.4), 0, rnd(0.4))), 0.3 + k * 0.08, { arc: 0.4, line: true, hit: true });
        fx.after(0.35, () => { fx.emit(P.SPRAY, st2.x, 0.05, st2.z, 14, 0, 1, 0, 3, 1); fx.ring(V(st2.x, 0.05, st2.z), null, 0.2, 1.4, 0xc8322a, 0.8); });
        break;
      }
      case 'grapple': {
        if (!bm || !m) break;
        const dress = JSON.stringify(by.def.dress || '') + ' ' + (by.def.note || '');
        fx.grapple(e.by, e.id, bm, m, /\bmaw|jaw/i.test(dress));
        this.crews.pulse?.(bm, 'board'); this.crews.pulse?.(m, 'board');
        break;
      }
      default: break;
    }
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
        // just launched she climbs off the deck; on a strafing run she dives on the deck and pulls up
        const cl = this.climbs.get(i);
        if (cl) { const u = (this.fx.time - cl.t0) / 1.6; if (u >= 1) this.climbs.delete(i); else { const ez = u * u * (3 - 2 * u); m.position.y = cl.y0 + (m.position.y - cl.y0) * ez; m.rotation.z += 0.35 * (1 - u); } }
        const dv = this.dives.get(i);
        if (dv && died === undefined) { const u = (this.fx.time - dv.t0) / dv.dur; if (u >= 1) this.dives.delete(i); else { m.position.y -= 3.6 * Math.sin(u * Math.PI); m.rotation.z -= 0.75 * Math.sin(u * Math.PI * 2); } }
        animateSquadron(m, t, m.userData.phase, Math.max(1, Math.ceil(3 * e.hp / e.maxHp)));
        if (died !== undefined) { m.userData.bar.visible = false; m.userData.ring.visible = false; if (k > 2) m.visible = false; }
        else { setBar(m.userData.bar, e.hp / e.maxHp); m.userData.ring.position.y = -AIR_Y + 0.08; }
        return;
      }
      if (e.ship && m.userData.crewSlots) crewList.push({ model: m, frac: died === undefined ? (e.crew ?? 0) / Math.max(1, e.def.crew || 1) : 0, color: SIDE_COLORS[e.side], def: e.def, faction: b.sides?.[e.side]?.faction, alive: died === undefined && (m.userData.depth || 0) < 0.4 });
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
      m.rotation.x = 0;
      this.fx.pose(m);
      if (m.userData.lod) {
        const ratio = this.stage.camera.position.distanceTo(m.position) / Math.max(1, (e.def.size || 1) * 1.5);
        let lv = 0; while (lv < 5 && ratio > [14, 30, 60, 110, 200][lv]) lv++;
        setLod(m, lv);
      }
      if (!e.ship && died === undefined) animateCreature(m, t, m.userData.phase);
      else if (m.userData.beast && died === undefined) animateCreature(m.userData.beast, t, i * 1.3);
      m.userData.rig?.mixer?.update(dt * speed);
      if (m.userData.designAnim) animateDesign(m, t);
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
    // the lasting states of every hull, the boarding fights still going, then her hands
    const fx = this.fx;
    if (b.wind) { fx.wind.x = Math.cos(b.wind.dir) * b.wind.speed * 0.8; fx.wind.z = Math.sin(b.wind.dir) * b.wind.speed * 0.8; }
    fx.seaStates(b, this.models, dt, speed);
    fx.boardLinks(b, this.models, speed);
    this.crews.update(crewList, t);
    if (this.barrels) for (let k = this.barrels.length - 1; k >= 0; k--) {
      const br = this.barrels[k];
      br.m.position.y = this.waveH(br.x, br.y, t) * 0.8; br.m.rotation.x = Math.sin(t * 2 + k) * 0.3;
      if (t - br.born > 40) { this.dynamic.remove(br.m); this.barrels.splice(k, 1); }
    }
    // harpoon lines stay taut between the hunter and her catch while the tether holds
    for (let k = this.tethers.length - 1; k >= 0; k--) {
      const L = this.tethers[k], a = b.ents[L.by], c = b.ents[L.to], ma = this.models[L.by], mc = this.models[L.to];
      if (!a || !c || !a.alive || !c.alive || b.tick > L.until || !ma || !mc) { this.tethers.splice(k, 1); continue; }
      const D = fx.dims(ma, a);
      toWorld(ma, D.bow[0] * 0.8, D.deckY + 0.3, 0, _t0); _t1.set(mc.position.x, mc.position.y + 0.5, mc.position.z);
      fx.lay(fx.rope(`teth:${L.by}:${L.to}`, 'rope', 8), _t0, _t1, 0.08 + Math.sin(t * 3 + k) * 0.04, 0xd8c89a, 0.02);
      if (Math.random() < dt * 5) fx.emit(P.SPRAY, _t1.x, 0.05, _t1.z, 2, 0, 1, 0, 1.5, 0.7);
    }
    fx.update(dt);
  }

  tether(by, to, until) {
    this.tethers = this.tethers.filter((L) => !(L.by === by && L.to === to));
    this.tethers.push({ by, to, until });
  }
}
const AIR_Y = 6.5;

const buildFort = buildFortModel;
