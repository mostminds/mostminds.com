// Air effects for land and amphibious battles: what the air wings (engine/airwing.js) and the sky-behemoths
// (engine/behemoth.js) are seen to do. Paratroopers under canopies or sliding down ropes, crates on parachutes,
// rope lifts, sticks of bombs, strafing runs walking along the ranks, rockets, harpoon lines that hold while the
// beast is pinned, torpedo runs, dives, dogfight tracers and flak; and for the behemoths broadsides, beams,
// barrages, bomb bays, meteors, gates and roots, lifts, supply drops, turrets and marksmen, flares, domes, veils,
// auras, mending, the raised dead, raining clouds, shockwaves, gales, lightning, chains and swarms.
//
// It draws on the view's FleetFx (its point systems, rings, beams, shots, ropes, figures and pools) and adds a
// handful of fixed pools of its own (canopies, crates, rocks, swarm fliers), so the cost stays flat however much
// is in the air. Nothing here allocates per frame; events allocate a little, as FleetFx's recipes do.
//
//   const air = new AirFx(view)   view: the LandView (b, models, airModels, shipModels, fx, speed)
//   air.reset()                   on every load, after fx.reset()
//   air.onEvent(e, msgs)          for { type: 'airRole' } and { type: 'behemoth' } events
//   air.update(dt)                once a frame after the units and airships are posed, before fx.update()
//   air.podTrail(obj, dur)        smoke and fire behind a falling drop pod; air.podImpact(p) where it lands
import * as THREE from 'three';
import { P, G, toWorld, Pool } from './fleetFx.js';
import { TICK_MS } from '../engine/combat.js';

const R = Math.random, rnd = (a = 1) => (R() - 0.5) * 2 * a, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _col = new THREE.Color(), WHITE = new THREE.Color(1, 1, 1);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = (k) => k * k * (3 - 2 * k);

// particle looks of our own, in FleetFx's shape: system, life, size, growth, colours, opacity, drag, gravity, spread, jitter, fade-in
const L = (s, life, size, grow, c0, c1, a, drag, grav, vr, jit = 0, fi = 1) => ({ s, life, size, grow, c0, c1, a, drag, grav, vr, jit, fi });
const RAIN = L('add', [0.45, 0.7], [0.07, 0.11], -0.2, 0xffffff, 0xffffff, 0.9, 0, 5, 0.2, 0, 0);
const DRIP = L('smoke', [0.5, 0.8], [0.07, 0.12], 0, 0xffffff, 0xffffff, 0.95, 0, 7, 0.2, 0, 0);
const FLARE = L('add', [0.18, 0.3], [0.55, 0.8], 0.4, 0xfff6e0, 0xff7a30, 1, 0, 0, 0, 0, 0);
const STREAK = L('add', [0.35, 0.6], [0.12, 0.2], 1.2, 0xffffff, 0xd8ecff, 0.45, 0.2, 0, 0.3, 0.2, 1);
const COLUMN = L('add', [0.6, 1.1], [0.2, 0.35], 0.4, 0xffffff, 0xffffff, 0.85, 0.5, -3, 0.3, 0.3, 1);

const AURA = { courage: [0xffd060, G.sun], frenzy: [0xff3a20, G.swords], vigor: [0x60ff90, G.drop], reload: [0x80c8ff, G.chevron], dispel: [0xe8e0ff, G.star], terror: [0xb050ff, G.skull] };
const AURA_SAY = { courage: 'the ranks beneath it stand firm', frenzy: 'a battle-fury takes the ranks beneath it', vigor: 'the troops beneath it fight on refreshed', reload: 'the guns beneath it reload faster', dispel: 'curses and wounds lift from the troops beneath it', terror: 'the enemy beneath it falters in dread' };
// a cloud's substance: haze colours, its rain, and whether it burns
const CLOUD = {
  gas: { c: [0x7a9a30, 0xb8c860], rain: 0x9ac040, drip: false },
  poison: { c: [0x5a8a40, 0xa0c070], rain: 0x80c060, drip: false },
  plague: { c: [0x6a6a30, 0x9a9058], rain: 0x8a8a40, drip: false, flies: true },
  spores: { c: [0xb0b070, 0xe8e0b0], rain: 0xf0e8a0, drip: false },
  slime: { c: [0x4a9a28, 0x7ac040], rain: 0x58d030, drip: true },
  acid: { c: [0xa0b030, 0xd8d860], rain: 0xd0e040, drip: true },
  fire: { c: [0x5a4030, 0x8a7060], rain: 0xffa030, fire: [0xffd27a, 0xb02808] },
  'warp-fire': { c: [0x5a3a6a, 0x4a8a6a], rain: 0xc060ff, fire: [0x80ffb0, 0xa020e0] },
  hail: { c: [0xc8ccd0, 0xe8ecf0], rain: 0xf0f6ff, drip: true, hail: true },
};

/** the colour and manner of an ability from its name: a beam, a gate, lightning, a swarm... */
function tone(name = '', glow) {
  const n = name.toLowerCase();
  const col = /hell|wyrm|fire|flame|naphtha|burn/.test(n) && !/jade|warp/.test(n) ? 0xff7a20
    : /jade|warp|venom|green|bile/.test(n) ? 0x60ff70
    : /eye|gaze|baleful|blood/.test(n) ? /petrif|stone/.test(n) ? 0xd8d0a8 : 0xff4030
    : /iridescent|change|colour/.test(n) ? 0xd070ff
    : /sun|noon|solar|gold|capstone|monstrance|mirror|lens|radiance|holy|rose|light|crystal/.test(n) ? 0xffe8a0
    : /frost|ice|tide|wave|water|pearl/.test(n) ? 0x9ad8ff
    : /shadow|dark|death|necro/.test(n) ? 0x9a70ff
    : typeof glow === 'number' ? glow : 0xbfe0ff;
  const style = /root|tree|vine/.test(n) ? 'roots' : /tide|wave|water|fall/.test(n) ? 'water' : /gate|mirror|ring|rift|portal|door|circle|coil|lamp|djinn/.test(n) ? 'gate' : 'light';
  const shot = /skull|soul|spirit/.test(n) ? 'skull' : /boulder|stone|rock/.test(n) ? 'boulder' : /rocket|fire-arrow|firework|hwacha/.test(n) ? 'rocket' : /acid|pot|dung|bile/.test(n) ? 'pot' : 'mortar';
  const bug = /bat|furies|harp|crow|raven|bird/.test(n) ? 0x18141a : /sprite|thorn|fairy|wisp/.test(n) ? 0x2a4a1a : /fly|flies|locust|insect|bee|wasp|hornet/.test(n) ? 0x1e1c10 : 0x201a16;
  return { col, style, shot, bug };
}

export class AirFx {
  constructor(view) {
    this.v = view; this.fx = view.fx;
    const fx = this.fx, sc = fx.scene;
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, ...o });
    // a parachute canopy: an open dome with a scalloped skirt
    const can = new THREE.SphereGeometry(0.5, 14, 5, 0, Math.PI * 2, 0, 1.15); const cp = can.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), z = cp.getZ(i), a = Math.atan2(z, x); cp.setY(i, cp.getY(i) * 0.62 + (cp.getY(i) < 0.25 ? Math.abs(Math.sin(a * 7)) * 0.04 : 0)); }
    can.computeVertexNormals();
    this.canopies = new Pool(sc, can, std({ side: THREE.DoubleSide, roughness: 0.9 }), 64);
    this.crates = new Pool(sc, new THREE.BoxGeometry(0.42, 0.32, 0.42), std({ color: 0xffffff, roughness: 0.85 }), 40);
    const rock = new THREE.IcosahedronGeometry(1, 1); const rp = rock.attributes.position;
    for (let i = 0; i < rp.count; i++) { const f = 0.8 + ((i * 53) % 13) / 30; rp.setXYZ(i, rp.getX(i) * f, rp.getY(i) * f, rp.getZ(i) * f); }
    rock.computeVertexNormals();
    this.rocks = new Pool(sc, rock, std({ color: 0xffffff, roughness: 1, flatShading: true, emissive: 0xff5010, emissiveIntensity: 0.35 }), 8);
    // a swarm flier: two swept wings and a body, lit by nothing
    const w = new THREE.BufferGeometry();
    w.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.5, -1, 0.15, -0.3, -0.25, 0, -0.5, 0, 0, 0.5, 1, 0.15, -0.3, 0.25, 0, -0.5, 0, 0.05, 0.6, -0.12, 0, -0.6, 0.12, 0, -0.6], 3));
    this.bugs = new Pool(sc, w.scale(0.09, 0.09, 0.09), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), 260);
    fx.pools.push(this.canopies, this.crates, this.rocks, this.bugs); // FleetFx clears, flushes and disposes them with its own
    this.reset();
  }

  reset() {
    this.chutes = []; this.lines = []; this.cols = []; this.meteors = []; this.swarms = []; this.shells = []; this.discs = []; this.scars = [];
    this.dips = new Map(); this.rise = new Map(); this.wards = new Map(); this.auras = new Map(); this.zones = new WeakMap(); this.zoneList = [];
    this.flares = []; for (let k = 0; k < 32; k++) this.flares.push({ p: V(), v: V(), t: 0, life: 0, on: false });
    this.flareAt = 0; this.said = new Map(); this.stamp = 0; this.lastIc = new Map();
  }

  // ------------------------------------------------ small helpers
  sec(ticks) { return (ticks * TICK_MS) / 1000 / (this.v.speed || 1); }
  floor(x, z) { return this.fx.floor(x, z); }
  gp(x, z, out = V()) { return out.set(x, this.floor(x, z) + 0.05, z); }
  /** a ticker line, at most once per `gap` ticks for its key */
  say(msgs, key, side, text, gap = 40) { const t = this.v.b.tick, l = this.said.get(key); if (l !== undefined && t - l < gap) return; this.said.set(key, t); msgs.push({ side, text }); }
  act(m, name, dur = 0.9) { return !!m && this.fx.act(m, name, dur); }
  /** a named anchor of model m in the world, else its fallback (local x, y, z), else its position */
  anchor(m, names, out, fb = null) {
    const an = m.userData.anchors;
    if (an) for (const n of names) { const p = an[n]; if (p && p.length >= 3) return toWorld(m, p[0], p[1], p[2], out); }
    if (fb) return toWorld(m, fb[0], fb[1], fb[2], out);
    return out.copy(m.position);
  }
  /** the local point of an anchor (for figures that climb to a moving model) */
  local(m, names, fb) { const an = m.userData.anchors; if (an) for (const n of names) if (an[n]) return V(an[n][0], an[n][1], an[n][2]); return V(...fb); }
  craft(id) { const u = this.v.b.units[id], m = this.v.models[id]; return u && m ? { u, m } : null; }
  /** the middle of a unit's model in the world */
  unitAt(id, out) {
    const u = this.v.b.units[id], m = this.v.models[id];
    if (m) return out.copy(m.position).setY(m.position.y + 0.45 * Math.min(2.5, u ? u.def.size || 1 : 1));
    if (u) return this.gp(u.x + u.def.size / 2, u.y + u.def.size / 2, out).setY(out.y + 0.5);
    return null;
  }
  beh(id) { const a = this.v.b.airships[id], am = this.v.airModels[id]; if (!a || !am || am.downAt !== undefined) return null; return { a, am, m: am.m, D: this.fx.dims(am.m, a) }; }
  belly(B, names, out) { return this.anchor(B.m, names, out, [0, B.D.box.min.y + 0.1, 0]); }
  hull(B, out, top = false) { const D = B.D; return toWorld(B.m, rnd(D.hx * 0.75), top ? D.top * 0.8 : D.box.min.y + (D.deckY - D.box.min.y) * R(), rnd(D.hz * 0.8), out); }
  side(i) { return this.fx.colors ? this.fx.colors[i] : i ? 0xd9463d : 0x3d7bd9; }
  /** a target given as { to: unit id | air: airship id | gun | ship, x, y }, in the world */
  markAt(e, out) {
    const b = this.v.b;
    if (typeof e.to === 'number') return this.unitAt(e.to, out);
    if (e.air !== undefined) { const am = this.v.airModels[e.air]; return am ? out.copy(am.m.position) : out.set(e.x, 4, e.y); }
    if (e.gun !== undefined) { const g = b.guns[e.gun]; return this.gp(g.cx, g.cy, out).setY(out.y + 0.6); }
    if (e.ship !== undefined) { const m = this.v.shipModels[e.ship]; return m ? out.copy(m.position).setY(0.8) : out.set(b.ships[e.ship].x, 0.8, b.ships[e.ship].y); }
    return this.gp(e.x + 0.5, e.y + 0.5, out).setY(out.y + 0.4);
  }
  /**
   * who fired and at what: a lightning bolt or harpoon aimed at an airship carries that airship's id in `air` (the
   * engine's extra fields overwrite the source's), so the source is then the nearest enemy behemoth with that ability
   */
  source(e) {
    const b = this.v.b;
    const atAir = (e.kind === 'lightning' || e.kind === 'harpoon') && e.to === undefined && e.gun === undefined && e.ship === undefined;
    const mark = { to: e.to, gun: e.gun, ship: e.ship, x: e.x, y: e.y, air: undefined };
    if (!atAir) return { src: e.air, mark };
    const t = b.airships[e.air];
    let best = -1, bd = Infinity;
    for (const o of b.airships) {
      if (!o.alive || !o.def.behemoth || (t && o.side === t.side) || !(o.def.abilities || []).some((x) => x.kind === e.kind)) continue;
      const d = t ? Math.hypot(o.x - t.x, o.y - t.y) : 0;
      if (d < bd) { bd = d; best = o.id; }
    }
    mark.air = e.air;
    return { src: best, mark };
  }
  /** a burnt patch on the ground that fades after life seconds */
  scar(p, r, col = 0x2a2018, life = 14) {
    const fx = this.fx;
    if (this.scars.length >= 26) fx.stains.release(this.scars.shift().i);
    const i = fx.stains.alloc(); fx.stains.tint(i, col);
    const s = { i, p: V(p.x, this.floor(p.x, p.z) + 0.03, p.z), r, t: 0, life, rot: R() * 6 };
    this.scars.push(s);
    return s;
  }
  /** an upright pillar of light (or a lift beam) at p: radius r, height h */
  column(p, r, h, col, life = 1.5, from = null) {
    const fx = this.fx;
    if (this.cols.length > 24) this.endCol(this.cols.shift());
    const c = { i: fx.glows.alloc(), j: fx.glows.alloc(), p: p.clone(), r, h, col, t: 0, life, from };
    this.cols.push(c);
    return c;
  }
  endCol(c) { this.fx.glows.release(c.i); this.fx.glows.release(c.j); }
  /** a timed line between two moving points: a(out) and c(out) return false when it should go */
  line(key, kind, a, c, life, o = {}) {
    if (this.lines.length > 30) this.lines.shift();
    const old = this.lines.findIndex((l) => l.key === key); if (old >= 0) this.lines.splice(old, 1);
    this.lines.push({ key, kind, a, c, until: this.fx.time + life, t0: this.fx.time + (o.delay || 0), sag: o.sag ?? 0.2, col: o.col ?? 0xc8b48a, rad: o.rad ?? 0.022, n: o.n ?? 8, keep: o.keep || null, getSag: o.getSag || null });
  }
  dip(id, depth, dur) { this.dips.set(id, { t0: this.fx.time, depth, dur }); }
  /** a unit seen to arrive: rising from below (dy < 0), dropping from above (dy > 0), and/or growing from a gate */
  arrive(id, dy, dur, delay = 0, grow = false) { this.rise.set(id, { t0: this.fx.time + delay, dy, dur, grow }); }
  flashBubble(p, r, col, life = 0.5, m = null) {
    if (this.shells.length > 10) this.fx.bubbles.release(this.shells.shift().i);
    this.shells.push({ i: this.fx.bubbles.alloc(), p: p.clone(), r, col, t: 0, life, m });
  }
  glowDisc(p, r, col, life = 2) {
    if (this.discs.length > 10) this.fx.discs.release(this.discs.shift().i);
    this.discs.push({ i: this.fx.discs.alloc(), p: V(p.x, this.floor(p.x, p.z) + 0.07, p.z), r, col, t: 0, life });
  }

  // ------------------------------------------------ payloads under canopies
  /** a parachute from `from` (world) to a unit (id >= 0, its model rides under it) or to the ground point `to` with a crate */
  chute(from, { id = -1, to = null, delay = 0, dur = 1.8, col = 0xe8e2cc, rope = false } = {}) {
    const fx = this.fx;
    if (this.chutes.length >= 40) this.endChute(this.chutes.shift());
    const c = { id, from: from.clone(), to: to ? to.clone() : null, t: -delay, dur, ph: R() * 6, rope, canopy: -1, crate: -1, s0: -1, s1: -1, down: false };
    if (!rope) { c.canopy = this.canopies.alloc(); this.canopies.tint(c.canopy, col); c.s0 = fx.strands.alloc(); c.s1 = fx.strands.alloc(); fx.strands.tint(c.s0, 0xd8d0b8); fx.strands.tint(c.s1, 0xd8d0b8); }
    if (id < 0) { c.crate = this.crates.alloc(); this.crates.tint(c.crate, R() < 0.5 ? 0x8a6a3a : 0x6a7a4a); }
    this.chutes.push(c);
    return c;
  }
  endChute(c) { this.canopies.release(c.canopy); this.crates.release(c.crate); this.fx.strands.release(c.s0); this.fx.strands.release(c.s1); }
  stepChute(c, dt) {
    const fx = this.fx, b = this.v.b;
    c.t += dt;
    let m = null, P0 = _a;
    if (c.id >= 0) {
      m = this.v.models[c.id]; const u = b.units[c.id];
      if (!m || !u) return true;
      if (c.t < 0) { m.visible = false; return false; }
      P0.copy(m.position);
    } else { if (c.t < 0) { this.crates.hide(c.crate); this.canopies.hide(c.canopy); return false; } P0.copy(c.to); }
    const k = Math.min(1, c.t / c.dur);
    // under a canopy: a quick fall until it opens, then a slow swaying drift down; on a rope: a fast slide
    const kk = c.rope ? Math.pow(k, 1.4) : k < 0.12 ? k * 2.2 : 0.264 + (k - 0.12) * (0.736 / 0.88);
    const sway = c.rope ? 0 : Math.sin(c.t * 2.6 + c.ph) * 0.25 * (1 - k);
    _b.set((c.from.x - P0.x) * (1 - kk) + sway, (c.from.y - P0.y) * (1 - kk), (c.from.z - P0.z) * (1 - kk));
    const pos = _c.copy(P0).add(_b);
    if (m) m.position.copy(pos);
    else { _q.setFromAxisAngle(UP, c.ph); this.crates.put(c.crate, _d.copy(pos).setY(pos.y + 0.16), _q, 1); }
    if (c.rope) {
      // the rope hangs from the craft to the ground; the trooper rides down it
      const top = _d.copy(c.from);
      if (k < 1) fx.lay(fx.rope(`ar:${c.id}:${c.ph}`, 'rope', 4), top, _p.copy(pos).setY(Math.max(this.floor(pos.x, pos.z), pos.y - 0.2)), 0.05, 0xb8a47a, 0.018);
      return k >= 1;
    }
    const open = Math.min(1, c.t / (c.dur * 0.14));
    if (k < 1) {
      const top = _d.copy(pos).setY(pos.y + (m ? 1.35 : 1.05));
      _q.setFromAxisAngle(_p.set(0, 0, 1), sway * 0.35);
      this.canopies.put(c.canopy, top, _q, 0.25 + open * 0.85, 0.3 + open * 0.7, 0.25 + open * 0.85);
      const sh = _p.copy(pos).setY(pos.y + (m ? 0.55 : 0.32));
      _b.set(top.x - 0.42 * open, top.y + 0.02, top.z); fx.seg(fx.strands, c.s0, sh, _b, 0.008);
      _b.set(top.x + 0.42 * open, top.y + 0.02, top.z); fx.seg(fx.strands, c.s1, sh, _b, 0.008);
      return false;
    }
    if (!c.down) { c.down = true; c.t1 = c.t; fx.dust(pos, c.id >= 0 ? 0.35 : 0.6); if (c.id < 0) fx.emit(P.MOTE, pos.x, pos.y + 0.3, pos.z, 6, 0, 1, 0, 1, 1, 0xfff0a0, 0xffffff); }
    // the canopy settles over to one side and is gathered in; a crate is opened and taken
    const u2 = (c.t - c.t1) / 0.9;
    _q.setFromAxisAngle(_p.set(0, 0, 1), u2 * 1.4);
    this.canopies.put(c.canopy, _d.set(pos.x + u2 * 0.6, this.floor(pos.x, pos.z) + 0.25 + (1 - u2) * 0.9, pos.z), _q, 1.1, Math.max(0.05, 1 - u2), 1.1);
    fx.strands.hide(c.s0); fx.strands.hide(c.s1);
    if (c.id < 0) { this.crates.put(c.crate, _d.copy(pos).setY(this.floor(pos.x, pos.z) + 0.16), _q.setFromAxisAngle(UP, c.ph), Math.max(0.01, 1 - Math.max(0, u2 - 1.2))); return u2 > 2.2; }
    return u2 >= 1;
  }

  // ------------------------------------------------ events
  onEvent(e, msgs) {
    try { if (e.type === 'airRole') this.role(e, msgs); else if (e.type === 'behemoth') this.ability(e, msgs); }
    catch (err) { if (globalThis.__airFxStrict) throw err; globalThis.console?.warn('[airFx]', e.type, e.kind, err); }
  }

  role(e, msgs) {
    const C = this.craft(e.id);
    if (!C) return;
    const { u, m } = C, fx = this.fx, b = this.v.b, name = u.def.name, sideCol = this.side(u.side);
    switch (e.kind) {
      case 'drop': {
        // machines throw out troopers under canopies; beasts and riders let them slide down ropes
        const rope = u.def.model?.body !== 'aircraft' || e.role === 'assault';
        this.act(m, 'drop', 1.8);
        const from = this.anchor(m, ['cargo'], V(), [0, -0.1, 0]);
        (e.ids || []).slice(0, 12).forEach((id, k) => this.chute(from, { id, delay: k * (rope ? 0.12 : 0.18), dur: rope ? 0.75 : 1.9 + R() * 0.4, col: k % 3 ? 0xe8e2cc : sideCol, rope }));
        this.say(msgs, `drop:${u.side}`, u.side, rope ? `${name} lands ${e.n} troops on ropes in the thick of it` : `${name} drops ${e.n} paratroopers on the rally point`, 30);
        break;
      }
      case 'supply': {
        this.act(m, 'drop', 1.6);
        const from = this.anchor(m, ['cargo'], V(), [0, -0.1, 0]);
        for (let k = 0; k < Math.min(4, Math.max(1, e.n)); k++) this.chute(from, { to: this.gp(e.x + 0.5 + rnd(1), e.y + 0.5 + rnd(1)), delay: k * 0.2, dur: 2 + R() * 0.4 });
        this.say(msgs, `supply:${u.side}`, u.side, `${name} parachutes supplies to the rally point`, 40);
        break;
      }
      case 'lift': {
        // a rope (or a cage) let down; the hurt go up it hand over hand
        this.act(m, 'drop', 2.2);
        const local = this.local(m, ['cargo'], [0, -0.1, 0]), cx = e.x + 0.5, cz = e.y + 0.5;
        this.line(`lift:${e.id}`, 'rope', (o) => !!this.anchor(m, ['cargo'], o, [0, -0.1, 0]), (o) => !!this.gp(cx, cz, o), 2.4, { sag: 0.05, col: 0xb8a47a, rad: 0.022, n: 5 });
        const g = new THREE.Object3D(); this.gp(cx, cz, g.position);
        for (let k = 0; k < Math.min(4, e.n); k++) fx.boarder(g, V(rnd(0.3), 0, rnd(0.3)), m, local, sideCol, { style: 'climb', delay: 0.3 + k * 0.3, dur: 1.1, fight: 0.01 });
        fx.dust(g.position, 0.5);
        this.say(msgs, `lift:${u.side}`, u.side, `${name} lifts ${e.n} surrounded troops out on a rope`, 30);
        break;
      }
      case 'bomb': {
        // a stick of bombs walked along her line of flight
        this.act(m, 'bomb', 1.3);
        const n = e.n || 2, r = e.r || 1.5, cf = Math.cos(u.face), sf = Math.sin(u.face);
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * r * 0.8, rel = i * 0.09;
          const to = this.gp(e.x + 0.5 + cf * off, e.y + 0.5 + sf * off);
          fx.after(rel, () => {
            const from = this.anchor(m, ['bombBay'], V(), [0, -0.05, 0]);
            const f = fx.shot('bomb', from, to, Math.max(0.2, this.sec((e.delay ?? 2) + (i >> 1)) - rel), { arc: 0, onLand: (p) => {
              fx.ring(V(p.x, p.y + 0.05, p.z), null, 0.3, r * 1.3, 0xffa040, 0.7);
              this.scar(p, r * 0.7, 0x2a2018, 12);
              if (e.fire) { const q = p.clone(); fx.emitter(3.5, (k2, dt) => { const nn = fx.rate(q, 'f', 26 * (1 - k2) * fx.near(q), dt); if (nn) fx.emit(P.FIRE, q.x + rnd(r * 0.6), q.y, q.z + rnd(r * 0.6), nn, 0, 1, 0, 0.6, 1.3); if (R() < dt * 6) fx.emit(P.BLACK, q.x, q.y + 0.4, q.z, 1, 0, 1, 0, 0.5, 1.2); }); }
            } });
            f.r = 0.13;
          });
        }
        this.say(msgs, `bomb:${u.side}`, u.side, `${name} drops a stick of ${e.fire ? 'firebombs' : 'bombs'}`, 30);
        break;
      }
      case 'strafe': {
        // a low pass: tracer (or arrows) walking along the ranks from x,y to `to`
        this.act(m, 'strafe', 1.2); this.dip(e.id, 1.1, 1.2);
        const x0 = e.x, z0 = e.y, x1 = e.to.x, z1 = e.to.y, shots = 9;
        for (let k = 0; k < shots; k++) fx.after(0.25 + k * 0.06, () => {
          if (!m.visible) return;
          const s = k / (shots - 1), gx = x0 + (x1 - x0) * s + rnd(0.4), gz = z0 + (z1 - z0) * s + rnd(0.4);
          const from = this.anchor(m, ['muzzle'], V(), [0, 0, 0.4]), to = this.gp(gx, gz, V());
          if (e.arrows) { this.v.stage.projectile(from, to, 'arrow', 0.22, 0.1); if (k % 3 === 0) fx.after(0.22, () => fx.dust(to, 0.25)); }
          else { fx.shot('tracer', from, to, 0.12, { arc: 0 }); if (k % 2 === 0) fx.emit(P.FLASH, from.x, from.y, from.z, 1, 0, 0, 0, 0, 0.35, 0xfff0b0, 0xff8030); }
        });
        this.say(msgs, `strafe:${u.side}`, u.side, `${name} strafes the enemy ranks${e.n ? `: ${e.n} hit` : ''}`, 30);
        break;
      }
      case 'rocket': {
        this.act(m, 'strafe', 1);
        const n = Math.min(8, e.n || 2);
        for (let i = 0; i < n; i++) fx.after(i * 0.07, () => {
          const from = this.anchor(m, ['rockets', 'muzzle'], V(), [0, 0, 0.3]);
          fx.emit(P.FIRE, from.x, from.y, from.z, 3, 0, 0, 0, 0.5, 0.6);
          fx.shot('rocket', from, this.gp(e.x + 0.5 + rnd(2), e.y + 0.5 + rnd(2)), Math.max(0.25, this.sec(2 + (i >> 1)) - i * 0.07), { arc: 0.12 });
        });
        this.say(msgs, `rocket:${u.side}`, u.side, `${name} looses ${n} rockets`, 40);
        break;
      }
      case 'harpoon': {
        // the harpoon flies on its line; while the beast is pinned the line stays, taut and tugging
        this.act(m, 'harpoon', 0.7);
        const t = b.units[e.to], at = this.unitAt(e.to, V());
        if (!t || !at) break;
        const from = this.anchor(m, ['harpoon', 'muzzle'], V(), [0, 0, 0.4]);
        fx.shot('harpoon', from, e.hit ? at : at.clone().add(V(rnd(1.2), -0.4, rnd(1.2))), 0.3, { arc: 0.05, hit: e.hit, flesh: true, line: !e.hit });
        if (e.hit) {
          this.line(`hp:${e.id}`, 'rope', (o) => u.alive && t.alive && t.pinUntil > b.tick && !!this.anchor(m, ['harpoon', 'muzzle'], o, [0, 0, 0.4]), (o) => !!this.unitAt(e.to, o), 60, { delay: 0.3, sag: 0.12, col: 0x5a4a34, rad: 0.022, n: 8, keep: true });
          this.say(msgs, `harpoon:${e.id}`, u.side, `${name} harpoons ${t.def.name}: it is pinned${t.def.fly ? ' and hauled out of the sky' : ''}`, 30);
        }
        break;
      }
      case 'torpedo': {
        // down to the water, a splash, and a running wake to the hull
        this.act(m, 'torpedo', 0.9); this.dip(e.id, 1.6, 1.1);
        const tx = e.to.x, tz = e.to.y;
        fx.after(0.35, () => {
          const at = this.anchor(m, ['torpedo', 'bombBay'], V(), [0, -0.1, 0]), w0 = this.gp(at.x, at.z, V());
          fx.splash(w0, 0.8);
          const to = this.gp(tx, tz, V()).setY(this.floor(tx, tz) + 0.25), dur = Math.max(0.4, this.sec(3) - 0.35);
          const f = fx.shot('torpedo', w0, to, dur, { arc: 0, hit: true, onLand: (p) => { fx.splash(p, 2.2); fx.explode(p, 0.8, { debris: 8, dcol: 0x6a4a30 }); fx.after(0.15, () => fx.emit(P.SPRAY, p.x, p.y, p.z, 26, 0, 1, 0, 8, 1.5)); } });
          fx.emitter(dur, (k, dt) => { if (fx.rate(f, 'wk', 30 * fx.near(f.p), dt)) fx.emit(P.MIST, f.p.x, this.floor(f.p.x, f.p.z) + 0.04, f.p.z, 1, 0, 0.2, 0, 0.3, 0.55, 0xffffff, 0xe8f4f8); });
        });
        this.say(msgs, `torp:${u.side}`, u.side, `${name} drops a torpedo`, 30);
        break;
      }
      case 'dive': {
        // a steep dive: on a ship a bomb let go at the bottom, on troops a crash into their ranks
        const p = this.gp(e.x + 0.5, e.y + 0.5);
        this.act(m, e.role === 'naval' ? 'bomb' : 'strafe', 1);
        if (e.role === 'naval') {
          this.dip(e.id, 1.8, 1.1);
          fx.after(0.45, () => { const from = this.anchor(m, ['bombBay'], V(), [0, -0.05, 0]); fx.shot('bomb', from, p, 0.25, { arc: 0 }); });
        } else {
          fx.after(0.15, () => { fx.ring(p, null, 0.3, 2.2, 0xe8d8b0, 0.6); fx.emit(P.DUST, p.x, p.y + 0.2, p.z, 10, 0, 0.4, 0, 2.2, 1.2); fx.emit(P.SPARK, p.x, p.y + 0.4, p.z, 8, 0, 0.6, 0, 3); fx.emit(P.CHIP, p.x, p.y + 0.1, p.z, 6, 0, 1, 0, 3, 1, 0x6a5a40, 0x6a5a40); });
        }
        this.say(msgs, `dive:${u.side}`, u.side, e.role === 'naval' ? `${name} dive-bombs the ship below` : `${name} dives into the ranks${e.n ? `: ${e.n} struck` : ''}`, 40);
        break;
      }
      case 'intercept': {
        // a dogfight burst: two streams of tracer at the other flier
        const last = this.lastIc.get(e.id) ?? -9; if (fx.time - last < 0.25) break; this.lastIc.set(e.id, fx.time);
        const t = b.units[e.to];
        for (let k = 0; k < 3; k++) fx.after(k * 0.06, () => {
          const from = this.anchor(m, ['muzzle'], V(), [0, 0, 0.4]), to = this.unitAt(e.to, V());
          if (!to) return;
          to.add(_a.set(rnd(0.35), rnd(0.25), rnd(0.35)));
          fx.shot('tracer', from, to, 0.1, { arc: 0, hit: true }); if (k === 0) fx.emit(P.FLASH, from.x, from.y, from.z, 1, 0, 0, 0, 0, 0.3, 0xfff0b0, 0xff8030);
        });
        if (t && (t.def.airRole === 'bomber' || t.def.airRole === 'transport')) this.say(msgs, `ic:${u.side}`, u.side, `${name} intercepts ${t.def.name}`, 60);
        break;
      }
      case 'pd': {
        // the escort's guns break up a missile short of the ship: flak and a burst
        const am = this.v.airModels[e.air], p = am ? V(e.x, am.m.position.y - 0.3, e.y) : V(e.x, 4, e.y);
        const from = this.anchor(m, ['muzzle'], V(), [0, 0, 0.4]);
        fx.shot('flak', from, p, 0.15, { arc: 0, hit: true });
        for (let k = 0; k < 3; k++) fx.after(0.12 + k * 0.08, () => { const q = p.clone().add(V(rnd(0.8), rnd(0.5), rnd(0.8))); fx.emit(P.FLASH, q.x, q.y, q.z, 1, 0, 0, 0, 0, 1.1, 0xffd890); fx.emit(P.BLACK, q.x, q.y, q.z, 3, 0, 0, 0, 0, 0.8); fx.emit(P.SPARK, q.x, q.y, q.z, 8, 0, 0, 0, 0, 1); });
        this.say(msgs, `pd:${u.side}`, u.side, `${name} shoots down a missile short of its ship`, 40);
        break;
      }
      default: break;
    }
  }

  ability(e, msgs) {
    const S0 = this.source(e), B = S0.src >= 0 ? this.beh(S0.src) : null, mk = S0.mark;
    if (!B) return;
    const { a, m, D } = B, fx = this.fx, b = this.v.b, A = a.def.name, N = e.name || e.kind, side = a.side;
    const T = tone(N, a.def.look?.glow);
    const say = (text, gap = 50) => this.say(msgs, `bh:${e.kind}:${a.id}`, side, text, gap);
    const tgt = () => this.gp(e.x + 0.5, e.y + 0.5);
    this.act(m, e.kind, 1.2);
    switch (e.kind) {
      case 'broadside': {
        // the great guns along her side fire down in turn, each in a bank of smoke
        if (!this.act(m, 'fire', 0.8)) fx.rock(m, 0.03);
        const T0 = tgt(), n = e.n || 6;
        for (let i = 0; i < n; i++) fx.after(i * 0.07, () => {
          const mz = fx.railToward(m, D, T0, -0.8 + (1.6 * i) / Math.max(1, n - 1), V()); toWorld(m, mz.x, mz.y, mz.z, mz);
          const to = T0.clone().add(V(rnd(1.4), 0, rnd(1.4))); to.y = this.floor(to.x, to.z) + 0.05;
          const dir = V().subVectors(to, mz).normalize();
          fx.muzzle(mz, dir, 1.5); fx.emit(P.GUN, mz.x, mz.y, mz.z, 5, dir.x, dir.y, dir.z, 2, 2.2);
          fx.shot('heavy', mz, to, Math.max(0.15, this.sec(e.delay || 1) - i * 0.07), { arc: 0.05, onLand: (p) => { fx.explode(p, 0.85, { debris: 6, dcol: 0x5a4a34 }); } });
        });
        say(`${A} fires ${N} down on the enemy`, 60);
        break;
      }
      case 'beam': {
        // a sustained beam from its eye, lens or jaws, scorching a line to the mark
        const T1 = tgt().setY(this.floor(e.x + 0.5, e.y + 0.5) + 0.1), names = ['beam', 'eye', 'lens', 'mouth', 'bow'];
        const from = this.belly(B, names, V()), life = 1.7;
        const gx = from.x, gz = from.z;
        fx.beam(from, T1, T.col, 0.32, life, 0, (f) => { if (m.visible) this.belly(B, names, f.a); f.c.set(T1.x + Math.sin(f.t * 5) * 0.25, T1.y, T1.z + Math.cos(f.t * 4) * 0.25); fx.layBolt(f); });
        fx.beam(from, T1, 0xffffff, 0.12, life * 0.9, 0, (f) => { if (m.visible) this.belly(B, names, f.a); f.c.copy(T1); fx.layBolt(f); });
        fx.emit(P.GLOW, from.x, from.y, from.z, 3, 0, 0, 0, 0, 2.4, T.col, T.col);
        fx.emitter(life, (k, dt) => {
          const nk = fx.near(T1);
          const n = fx.rate(T1, 'bm', 40 * nk, dt);
          for (let j = 0; j < n; j++) {
            const s = 0.55 + R() * 0.45, x = gx + (T1.x - gx) * s + rnd(0.3), z = gz + (T1.z - gz) * s + rnd(0.3), y = this.floor(x, z) + 0.1;
            fx.emit(j % 3 ? P.FIRE : P.EMBER, x, y, z, 1, 0, 1, 0, 1, 1.2, T.col === 0x60ff70 ? 0xc0ffb0 : 0xffd27a, T.col === 0x60ff70 ? 0x1a8a2a : 0xb02808);
          }
          if (R() < dt * 10) fx.emit(P.BLACK, T1.x + rnd(0.5), T1.y + 0.3, T1.z + rnd(0.5), 1, 0, 1, 0, 0.6, 1.4);
          if (R() < dt * 14) fx.emit(P.SPARK, T1.x, T1.y + 0.2, T1.z, 4, 0, 1, 0, 3);
        });
        fx.ring(T1, null, 0.3, 1.8, T.col, 0.6);
        for (let s = 0.6; s <= 1.01; s += 0.2) this.scar(V(gx + (T1.x - gx) * s, 0, gz + (T1.z - gz) * s), 0.8, 0x1a1410, 16);
        say(`${A} burns a line through the enemy with ${N}${e.n ? `: ${e.n} caught in it` : ''}`, 60);
        break;
      }
      case 'barrage': {
        // a salvo in high arcs over the mark
        if (!this.act(m, 'mortar', 0.8)) fx.rock(m, 0.02, 0.02);
        const n = Math.min(16, e.n || 6), T0 = tgt();
        for (let i = 0; i < n; i++) fx.after(i * 0.08, () => {
          const from = this.hull(B, V(), true), to = T0.clone().add(V(rnd(3), 0, rnd(3))); to.y = this.floor(to.x, to.z) + 0.05;
          fx.emit(P.FLASH, from.x, from.y, from.z, 1, 0, 0, 0, 0, 1, 0xfff0c0); fx.emit(P.GUN, from.x, from.y, from.z, 3, 0, 1, 0, 1, 1.2);
          fx.shot(T.shot, from, to, Math.max(0.3, this.sec((e.delay || 2) + (i >> 1)) - i * 0.08), { arc: 1.5 });
        });
        say(`${A} looses ${N}: ${n} shells come down`, 60);
        break;
      }
      case 'bombBay': {
        // the keel doors open and a stick of heavy bombs walks across the ground
        this.act(m, 'bomb', 1.5);
        const n = e.n || 5, x1 = e.to ? e.to.x : e.x, z1 = e.to ? e.to.y : e.y, r = e.r || 2;
        const bay = this.belly(B, ['bombBay', 'keel'], V()); fx.emit(P.GLOW, bay.x, bay.y, bay.z, 2, 0, 0, 0, 0, 2, 0xffc070, 0xff8030);
        for (let i = 0; i < n; i++) {
          const s = n > 1 ? i / (n - 1) : 0.5, to = this.gp(e.x + (x1 - e.x) * s, e.y + (z1 - e.y) * s), rel = i * 0.12;
          fx.after(rel, () => {
            const from = this.belly(B, ['bombBay', 'keel'], V()); from.add(_a.set(rnd(0.3), 0, rnd(0.3)));
            const f = fx.shot('bomb', from, to, Math.max(0.3, this.sec((e.delay || 3) + (i >> 1)) - rel), { arc: 0, onLand: (p) => { fx.explode(p, 0.5 + r * 0.25, { debris: 6 }); fx.ring(V(p.x, p.y + 0.06, p.z), null, 0.4, r * 1.6, 0xffa040, 0.8); this.scar(p, r * 0.9, 0x221a14, 16); } });
            f.r = 0.32;
          });
        }
        say(`${A} opens its bomb bay: ${N}`, 60);
        break;
      }
      case 'meteor': {
        // a burning rock from high in the sky, a warning glow below it, and a crater
        const T0 = tgt(), r = e.r || 3, dur = Math.max(0.8, this.sec(e.delay || 5));
        if (this.meteors.length >= this.rocks.n) { const o = this.meteors.shift(); this.rocks.release(o.i); }
        const i = this.rocks.alloc(); this.rocks.tint(i, 0x4a3a32);
        this.meteors.push({ i, a: V(T0.x - 14, T0.y + 44, T0.z - 9), c: T0.clone(), t: 0, dur, s: 0.45 + r * 0.22, r, warn: 0 });
        say(`${A} calls down ${N}`, 40);
        break;
      }
      case 'hangar': {
        const p = this.anchor(m, ['hangar', 'stern'], V(), [-D.hx * 0.8, D.deckY, 0]);
        fx.emit(P.GLOW, p.x, p.y, p.z, 2, 0, 0, 0, 0, 1.6, 0xffe0a0, 0xffa040); fx.emit(P.GUN, p.x, p.y, p.z, 6, 0, 0.2, 0, 1.2, 1.2);
        break;
      }
      case 'dropPods': {
        if (!this.act(m, 'launch', 1)) fx.rock(m, 0.02);
        say(`${A}: ${N} — ${e.n} troops on the way down`, 60);
        break;
      }
      case 'teleport': {
        const T0 = tgt(), ids = e.ids || [];
        if (T.style === 'roots') {
          // roots burst up out of the ground in arches and the troops climb out from among them
          for (let k = 0; k < 7; k++) {
            const ang = (k / 7) * Math.PI * 2 + R() * 0.5, r0 = 0.3, r1 = 1.4 + R() * 1.2, h = 1 + R() * 1.4, born = fx.time + k * 0.05;
            const ax = T0.x + Math.cos(ang) * r0, az = T0.z + Math.sin(ang) * r0, cx = T0.x + Math.cos(ang) * r1, cz = T0.z + Math.sin(ang) * r1;
            const L0 = { born, h };
            this.line(`root:${a.id}:${k}`, 'rope', (o) => !!this.gp(ax, az, o), (o) => { const g = Math.min(1, (fx.time - born) / 0.5); this.gp(ax + (cx - ax) * g, az + (cz - az) * g, o); L0.sag = -h * g; return true; }, 2.6, { sag: -h, col: 0x4a3420, rad: 0.07, n: 7, getSag: L0 });
          }
          fx.emit(P.DUST, T0.x, T0.y + 0.2, T0.z, 18, 0, 0.6, 0, 2, 1.4); fx.emit(P.CHIP, T0.x, T0.y + 0.2, T0.z, 14, 0, 1, 0, 3, 1, 0x5a4028, 0x5a4028);
          fx.emit(P.GLYPH, T0.x, T0.y + 0.6, T0.z, 6, 0, 1, 0, 0.8, 1, 0x9ad070, 0x5a8a30, G.thorn);
          ids.forEach((id, k) => this.arrive(id, -1, 0.9, 0.3 + k * 0.08));
        } else if (T.style === 'gate') {
          // a ring of light stands open on the ground; they step through it
          const n = V(1, 0, 0.3).normalize();
          fx.emitter(1.8, (k, dt) => {
            if (fx.rate(T0, 'gt', 9, dt)) fx.ring(V(T0.x, T0.y + 1.3, T0.z), n, 1.15, 1.35, T.col, 0.35);
            if (fx.rate(T0, 'gm', 30 * fx.near(T0), dt)) { const a2 = R() * 6.28; fx.emit(P.MOTE, T0.x, T0.y + 1.3 + Math.sin(a2) * 1.1, T0.z + Math.cos(a2) * 1.1, 1, 0, 0.3, 0, 0.5, 1.2, T.col, 0xffffff); }
          });
          fx.emit(P.GLOW, T0.x, T0.y + 1.3, T0.z, 4, 0, 0, 0, 0, 3, T.col, T.col);
          this.column(T0, 0.9, 2.6, T.col, 1.6);
          ids.forEach((id, k) => this.arrive(id, 0, 0.7, 0.2 + k * 0.12, true));
        } else if (T.style === 'water') {
          fx.emitter(1.2, (k, dt) => { const nn = fx.rate(T0, 'wt', 60 * fx.near(T0), dt); if (nn) fx.emit(P.SPRAY, T0.x + rnd(0.8), T0.y, T0.z + rnd(0.8), nn, 0, 1, 0, 6, 1.2); });
          fx.emit(P.MIST, T0.x, T0.y + 1, T0.z, 10, 0, 1, 0, 1, 1.6);
          fx.ring(T0, null, 0.4, 3, 0xd8f0ff, 1);
          ids.forEach((id, k) => this.arrive(id, -0.8, 0.8, 0.3 + k * 0.08));
        } else {
          // a shaft of light from the sky; they come down in it
          this.column(T0, 1.5, 18, T.col, 1.8);
          for (const id of ids) { const p = this.unitAt(id, V()); if (p) this.column(this.gp(p.x, p.z, p), 0.35, 7, 0xffffff, 1.2); }
          fx.ring(T0, null, 0.4, 3.2, T.col, 1);
          fx.emit(P.MOTE, T0.x, T0.y + 0.5, T0.z, 30, 0, 1, 0, 2, 1.4, T.col, 0xffffff);
          ids.forEach((id, k) => this.arrive(id, 3.5, 0.9, k * 0.08));
        }
        say(`${N}: ${e.n} ${e.n === 1 ? 'warrior appears' : 'troops appear'} at the rally point`, 40);
        break;
      }
      case 'extraction': {
        // a beam (or a bridge of cloud) lowered from her belly; the surrounded are drawn up it
        const T0 = tgt(), names = ['extraction', 'cargo', 'keel'], local = this.local(m, names, [0, D.box.min.y + 0.1, 0]);
        const cloud = /cloud|mist|bridge/.test(N.toLowerCase()), col = cloud ? 0xf0f4ff : T.col;
        this.column(T0, 1.1, 1, col, 2.4, (o) => this.belly(B, names, o));
        if (cloud) fx.emitter(2.2, (k, dt) => { const nn = fx.rate(T0, 'cb', 30 * fx.near(T0), dt); for (let j = 0; j < nn; j++) { const s = R(); this.belly(B, names, _a); fx.emit(P.MIST, T0.x + (_a.x - T0.x) * s + rnd(0.6), T0.y + (_a.y - T0.y) * s, T0.z + (_a.z - T0.z) * s + rnd(0.6), 1, 0, 0, 0, 0, 1.6, 0xffffff, 0xe8f0ff); } });
        const g = new THREE.Object3D(); g.position.copy(T0);
        for (let k = 0; k < Math.min(6, e.n || 1); k++) fx.boarder(g, V(rnd(0.6), 0, rnd(0.6)), m, local, this.side(side), { style: 'climb', delay: 0.3 + k * 0.2, dur: 1.5, fight: 0.01 });
        if (e.to) { const p = this.gp(e.to.x + 0.5, e.to.y + 0.5); fx.after(1.4, () => { fx.ring(p, null, 0.3, 2, col, 0.8); fx.emit(P.MOTE, p.x, p.y + 0.3, p.z, 14, 0, 1, 0, 1.2, 1, col, 0xffffff); }); }
        say(`${A} lifts ${e.n} surrounded troops to safety`, 50);
        break;
      }
      case 'supplyDrop': {
        const from = this.belly(B, ['cargo', 'bombBay', 'keel'], V()), T0 = tgt(), n = clamp(e.n || 3, 2, 6);
        this.act(m, 'drop', 1.6);
        for (let k = 0; k < n; k++) this.chute(from.clone().add(V(rnd(1), 0, rnd(1))), { to: this.gp(T0.x + rnd(2.2), T0.z + rnd(2.2)), delay: k * 0.15, dur: 2.4 + R() * 0.5, col: k % 2 ? 0xe8e2cc : this.side(side) });
        fx.after(2.6, () => { fx.ring(T0, null, 0.3, (e.r || 4) * 0.9, 0xfff0a0, 1); fx.emit(P.MOTE, T0.x, T0.y + 0.3, T0.z, 20, 0, 1, 0, 1.5, 1.2, 0xfff0a0, 0xffffff); });
        say(`${A} drops ${N} over the line`, 60);
        break;
      }
      case 'pointDefense': {
        if (e.pd) {
          // a missile at her or a consort blown apart in a ripple of flak
          let best = null, bd = 9;
          for (const o of b.airships) { const d = Math.hypot(o.x - e.x, o.y - e.y); if (o.alive && d < bd) { bd = d; best = o; } }
          const alt = best ? this.v.airModels[best.id].m.position.y : m.position.y;
          for (let k = 0; k < 4; k++) fx.after(k * 0.07, () => { const q = V(e.x + rnd(2), alt + rnd(1), e.y + rnd(2)), from = this.hull(B, V()); fx.shot('flak', from, q, 0.12, { arc: 0, hit: true }); });
          this.say(msgs, `bhpd:${a.id}`, side, `${A}'s turrets shoot a missile out of the air`, 60);
        } else {
          for (let k = 0; k < 5; k++) fx.after(k * 0.05, () => {
            const from = this.hull(B, V()), to = this.unitAt(e.to, V());
            if (!to) return;
            to.add(_a.set(rnd(0.4), rnd(0.3), rnd(0.4)));
            fx.shot('tracer', from, to, 0.12, { arc: 0, hit: true }); fx.emit(P.FLASH, from.x, from.y, from.z, 1, 0, 0, 0, 0, 0.45, 0xfff0b0, 0xff8030);
          });
        }
        break;
      }
      case 'snipers': {
        // one bright crack from a gallery, a puff, and the mark goes down (or a spray of dirt beside it)
        const from = this.hull(B, V(), true), to = this.unitAt(e.to, V());
        if (!to) break;
        if (!e.hit) to.add(V(rnd(0.8), -0.3, rnd(0.8)));
        fx.emit(P.FLASH, from.x, from.y, from.z, 1, 0, 0, 0, 0, 0.6, 0xffffff, 0xffc060); fx.emit(P.GUN, from.x, from.y, from.z, 2, 0, 0.2, 0, 0.5, 0.6);
        fx.beam(from, to, 0xfff4d0, 0.012, 0.14);
        fx.shot('tracer', from, to, 0.1, { arc: 0, hit: e.hit, onLand: (p) => { if (e.hit) fx.emit(P.SPRAY, p.x, p.y, p.z, 6, 0, 1, 0, 1.5, 0.6, 0xc84a3a, 0x7a1a14); } });
        const t = b.units[e.to];
        if (e.hit && t && (t.def.leader || t.def.fly)) this.say(msgs, `snipe:${a.id}`, side, `${A}'s marksmen pick off ${t.def.name}`, 50);
        break;
      }
      case 'heal': {
        // a soft light below it; motes rise from the troops it mends
        const c = V(m.position.x, 0, m.position.z), R0 = (e.r || 8) + a.radius * 0.4;
        this.gp(c.x, c.z, c);
        this.glowDisc(c, R0, 0x80ffa0, 1.8);
        fx.ring(c, null, 0.5, R0, 0xb0ffb0, 1.2);
        fx.emitter(1.6, (k, dt) => { const nn = fx.rate(c, 'hl', 70 * fx.near(c), dt); for (let j = 0; j < nn; j++) { const ang = R() * 6.28, rr = Math.sqrt(R()) * R0, x = c.x + Math.cos(ang) * rr, z = c.z + Math.sin(ang) * rr; fx.emit(P.MOTE, x, this.floor(x, z) + 0.2, z, 1, 0, 1, 0, 1.2, 1.3, j % 2 ? 0xa0ffb0 : 0xfff0a0, 0xffffff); } });
        fx.emit(P.GLYPH, c.x, c.y + 1, c.z, 5, 0, 1, 0, 1, 1.2, 0xb0ffb0, 0xffffff, G.drop);
        say(`${N} mends ${e.n} beneath ${A}`, 80);
        break;
      }
      case 'raise': {
        // a green light pours down; the dead claw their way up out of the ground
        const c = this.gp(m.position.x, m.position.z), R0 = e.r || 8;
        this.glowDisc(c, R0, 0x50ff60, 2.6);
        this.column(c, R0 * 0.35, 1, 0x40ff60, 2.2, (o) => this.belly(B, ['raise', 'keel'], o));
        for (const [k, id] of (e.ids || []).entries()) {
          const p = this.unitAt(id, V()); if (!p) continue;
          this.gp(p.x, p.z, p);
          this.column(p, 0.35, 3, 0x60ff70, 1.6);
          this.arrive(id, -1.1, 1.3, 0.2 + k * 0.15);
          fx.emit(P.POISON, p.x, p.y + 0.2, p.z, 8, 0, 0.5, 0, 0.8, 1, 0x50c050, 0x90e090); fx.emit(P.CHIP, p.x, p.y + 0.1, p.z, 6, 0, 1, 0, 2, 1, 0x4a3a28, 0x4a3a28);
          fx.glyph(G.skull, V(p.x, p.y + 1, p.z), 1, 0x90ff90, 1.1, 0.8, true);
        }
        say(`The slain rise beneath ${A}: ${e.n} join its ranks`, 40);
        break;
      }
      case 'cloud': {
        // it pours out of the belly, and then hangs and rains where it fell (update() follows b.skyZones)
        const C = CLOUD[e.cloud] || CLOUD.gas, T0 = tgt(), from = this.belly(B, ['cloud', 'vent', 'keel'], V());
        fx.emitter(0.9, (k, dt) => {
          const nn = fx.rate(T0, 'cl', 40 * fx.near(T0), dt);
          for (let j = 0; j < nn; j++) { const s = R(); fx.emit(P.POISON, from.x + (T0.x - from.x) * s + rnd(1), from.y + (T0.y - from.y) * s, from.z + (T0.z - from.z) * s + rnd(1), 1, 0, -1, 0, 1, 1.8, C.c[0], C.c[1]); }
        });
        say(`${N} rains down on the enemy`, 50);
        break;
      }
      case 'sonic': {
        // rings of force travelling down to the mark, then a shockwave that throws up a ring of dust
        const T0 = tgt(), from = this.belly(B, ['sonic', 'bell', 'mouth', 'keel'], V()), r = e.r || 4, d = V().subVectors(T0, from).normalize();
        for (let k = 0; k < 6; k++) fx.after(k * 0.05, () => fx.ring(V().lerpVectors(from, T0, k / 6), d, 0.3, 0.9 + k * 0.25, 0xf0e8ff, 0.4));
        for (let k = 0; k < 4; k++) fx.after(0.3 + k * 0.12, () => fx.ring(V(T0.x, T0.y + 0.05, T0.z), null, 0.3, r * (1 + k * 0.25), k % 2 ? 0xffffff : 0xe8d8b8, 0.8));
        fx.after(0.3, () => {
          for (let j = 0; j < 28; j++) { const ang = (j / 28) * 6.28, x = T0.x + Math.cos(ang) * r * 0.5, z = T0.z + Math.sin(ang) * r * 0.5; fx.emit(P.DUST, x, this.floor(x, z) + 0.2, z, 1, Math.cos(ang), 0.15, Math.sin(ang), 5, 1.2); }
          fx.emit(P.CHIP, T0.x, T0.y + 0.2, T0.z, 12, 0, 1, 0, 4, 1, 0x6a5a40, 0x6a5a40); fx.emit(P.GLINT, T0.x, T0.y + 1, T0.z, 2);
        });
        say(`${N}: the ranks below reel and walls shake`, 50);
        break;
      }
      case 'gale': {
        // wind streaks driven out from it on all sides, gusts and a swirl of dust
        const c = m.position.clone(), r = (e.r || 8) + a.radius * 0.4;
        fx.ring(c, null, D.hx, r, 0xffffff, 1);
        fx.emitter(1.6, (k, dt) => {
          const nn = fx.rate(c, 'gl', 90 * fx.near(c), dt);
          for (let j = 0; j < nn; j++) { const ang = R() * 6.28, rr = D.hx * (0.6 + R() * 0.8), y = c.y + rnd(2.2); fx.emit(STREAK, c.x + Math.cos(ang) * rr, y, c.z + Math.sin(ang) * rr, 1, Math.cos(ang), 0, Math.sin(ang), 12, 1, 0xffffff, 0xd8ecff); }
          if (fx.rate(c, 'gg', 8, dt)) { const ang = R() * 6.28; fx.emit(P.GLYPH, c.x + Math.cos(ang) * D.hx, c.y, c.z + Math.sin(ang) * D.hx, 1, Math.cos(ang), 0, Math.sin(ang), 4, 1.1, 0xffffff, 0xd8ecff, G.gust); }
        });
        if (e.n) say(`${N} hurls ${e.n} enemy ${e.n === 1 ? 'flier' : 'fliers'} off course`, 50);
        break;
      }
      case 'lightning': {
        // a forked bolt from the top of it to the mark, a flash and sparks
        const to = this.markAt(mk, V()), from = this.anchor(m, ['lightning', 'top', 'mast'], V(), [rnd(D.hx * 0.4), D.top, rnd(D.hz * 0.4)]);
        const col = T.col === 0xbfe0ff ? 0xd8e8ff : T.col;
        fx.beam(from, to, col, 0.07, 0.4, 0.9); fx.beam(from, to, 0xffffff, 0.03, 0.25, 0.6);
        const mid = V().lerpVectors(from, to, 0.55);
        for (let k = 0; k < 2; k++) fx.beam(mid, mid.clone().add(V(rnd(2.5), -1 - R() * 2, rnd(2.5))), col, 0.035, 0.25, 0.45);
        fx.emit(P.FLASH, to.x, to.y, to.z, 2, 0, 0, 0, 0, 2, 0xffffff, col); fx.emit(P.SPARK, to.x, to.y, to.z, 14, 0, 0.5, 0, 4, 1, 0xffffff, col);
        fx.emit(P.GLOW, from.x, from.y, from.z, 2, 0, 0, 0, 0, 2, col, col);
        if (to.y < this.floor(to.x, to.z) + 1.2) { fx.ring(V(to.x, this.floor(to.x, to.z) + 0.05, to.z), null, 0.2, 1.6, col, 0.5); this.scar(to, 0.5, 0x1a1a1a, 8); }
        say(`${N} strikes from ${A}`, 50);
        break;
      }
      case 'harpoon': {
        // a great harpoon on a chain; the chain stays taut while it hauls the mark in
        const names = ['harpoon', 'bow'], to0 = this.markAt(mk, V());
        const from = this.anchor(m, names, V(), [D.hx * 0.8, D.deckY, 0]);
        fx.shot('harpoon', from, to0, 0.35, { arc: 0.05, hit: true, flesh: e.to !== undefined });
        const held = (o) => (mk.to !== undefined ? !!(b.units[mk.to]?.alive && this.unitAt(mk.to, o)) : !!this.markAt(mk, o));
        this.line(`bhh:${a.id}`, 'chain', (o) => m.visible && !!this.anchor(m, names, o, [D.hx * 0.8, D.deckY, 0]), held, 2.8, { delay: 0.35, sag: 0.25, col: 0x56565a });
        fx.after(0.35, () => { const p = this.markAt(mk, V()); fx.emit(P.SPARK, p.x, p.y, p.z, 8, 0, 0.5, 0, 3); fx.emit(P.DUST, p.x, p.y, p.z, 4, 0, 0.5, 0, 1, 1); });
        const nm = mk.to !== undefined ? b.units[mk.to]?.def.name : mk.ship !== undefined ? b.ships[mk.ship]?.def.name : mk.air !== undefined ? b.airships[mk.air]?.def.name : null;
        if (nm) say(`${A} hauls ${nm} in on ${N}`, 50);
        break;
      }
      case 'swarm': {
        // a boiling cloud of small fliers pours out of it and round the enemy fliers near it
        const n = Math.min(80, 30 + (e.n || 0) * 10), r = (e.r || 6) + a.radius * 0.4;
        while (this.swarms.length >= 3) this.endSwarm(this.swarms.shift());
        const S = { air: a.id, items: [], ph: [], t: 0, dur: 3.2, r, c: m.position.clone() };
        for (let k = 0; k < n; k++) { const i = this.bugs.alloc(); this.bugs.tint(i, T.bug, 0.7 + R() * 0.6); S.items.push(i); S.ph.push(R() * 100); }
        this.swarms.push(S);
        if (e.n) say(`${N} boils out of ${A} and mobs the enemy fliers`, 60);
        break;
      }
      case 'aura': {
        const [col, gl] = AURA[e.effect] || AURA.courage, c = this.gp(m.position.x, m.position.z), R0 = (e.r || 8) + a.radius * 0.4;
        for (let k = 0; k < 3; k++) fx.after(k * 0.25, () => fx.ring(c, null, R0 * 0.2, R0, col, 1.1));
        for (let k = 0; k < 8; k++) { const ang = R() * 6.28, rr = R() * R0; fx.glyph(gl, V(c.x + Math.cos(ang) * rr, c.y + 0.6, c.z + Math.sin(ang) * rr), 1, col, 0.9, 0.7, e.effect !== 'terror'); }
        this.say(msgs, `aura:${a.id}:${e.effect}`, side, `${N}: ${AURA_SAY[e.effect] || 'the troops beneath it take heart'}`, 240);
        break;
      }
      case 'ward': {
        const c = this.gp(m.position.x, m.position.z);
        fx.ring(c, null, 0.5, (e.r || 8) + a.radius * 0.4, this.side(side), 1.2);
        fx.glyph(G.rune, V(c.x, c.y + 1, c.z), 6, 0xd8e8ff, 1, 1, true);
        this.say(msgs, `ward:${a.id}`, side, `${N} rises over ${A}`, 600);
        break;
      }
      case 'camouflage': {
        const c = m.position;
        fx.emit(P.FOG, c.x, c.y - 1, c.z, 14, 0, 0, 0, 1.4, 2.4, 0xc8d4c0, 0xe0e8dc);
        this.say(msgs, `camo:${a.id}`, side, `${N}: ${A} and the troops beneath it fade from sight`, 600);
        break;
      }
      case 'flares': {
        for (let k = 0; k < (e.dodge ? 4 : 8); k++) this.flare(B);
        if (e.dodge) this.say(msgs, `flared:${a.id}`, side, `${A}'s flares draw the enemy's fire`, 80);
        else this.say(msgs, `flares:${a.id}`, side, `${A} fires ${N}`, 600);
        break;
      }
      case 'phase': {
        this.flashBubble(m.position, Math.max(D.hx, D.top) * 1.15, 0xb8a0ff, e.dodge ? 0.45 : 0.9, m);
        fx.emit(P.MOTE, m.position.x, m.position.y, m.position.z, 16, 0, 0, 0, 2, 1.4, 0xc8b0ff, 0xffffff);
        if (e.dodge) this.say(msgs, `phased:${a.id}`, side, `Shots pass straight through ${A}`, 80);
        else this.say(msgs, `phase:${a.id}`, side, `${N}: ${A} wavers half out of the world`, 600);
        break;
      }
      default: break;
    }
  }

  flare(B) {
    const f = this.flares.find((x) => !x.on) || this.flares[(this.flareAt = (this.flareAt + 1) % this.flares.length)];
    this.hull(B, f.p); const ang = R() * 6.28;
    f.v.set(Math.cos(ang) * (2 + R() * 2.5), 1.5 + R() * 2, Math.sin(ang) * (2 + R() * 2.5)); f.t = 0; f.life = 2.2 + R() * 1.2; f.on = true;
    this.fx.emit(P.FLASH, f.p.x, f.p.y, f.p.z, 1, 0, 0, 0, 0, 0.8, 0xffffff, 0xffa060);
  }
  endSwarm(S) { for (const i of S.items) this.bugs.release(i); }

  // drop pods (landView's podDrop / podLand): a fiery trail on the way down, a crash and a crater
  podTrail(obj, dur) {
    const fx = this.fx, p = obj.position;
    fx.emitter(Math.max(0.2, dur), (k, dt) => { const nk = fx.near(p); if (fx.rate(obj.userData, 'pt', 40 * nk, dt)) fx.emit(P.FIRE, p.x, p.y + 0.4, p.z, 2, 0, 1, 0, 1, 1); if (fx.rate(obj.userData, 'ps', 14 * nk, dt)) fx.emit(P.SMOKE, p.x, p.y + 0.6, p.z, 1, 0, 1, 0, 0.3, 0.9); });
  }
  podImpact(p) { const fx = this.fx; fx.explode(p, 0.7, { debris: 8, dcol: 0x5a4a34 }); fx.dust(p, 1.6); this.scar(p, 1.1, 0x2a2018, 18); }

  // ------------------------------------------------ per frame
  update(dt) {
    const v = this.v, b = v.b, fx = this.fx;
    if (!b) return;
    if (!(dt > 0)) dt = 0.016;
    const now = fx.time;
    // aircraft dipping into a run, and troops arriving by gate, root or light
    for (const [id, d] of this.dips) {
      const m = v.models[id], u = (now - d.t0) / d.dur;
      if (!m || u >= 1 || u < 0) { if (m) m.rotation.x = 0; this.dips.delete(id); continue; }
      const gy = this.floor(m.position.x, m.position.z) + 0.4;
      m.position.y = Math.max(gy, m.position.y - d.depth * Math.sin(u * Math.PI));
      m.rotation.x = Math.sin(u * Math.PI * 2) * 0.5;
    }
    for (const [id, r] of this.rise) {
      const m = v.models[id], u = (now - r.t0) / r.dur;
      if (!m || u >= 1) { this.rise.delete(id); continue; }
      if (u < 0) { if (r.dy !== 0 || r.grow) m.visible = false; continue; }
      const k = ease(u);
      m.position.y += r.dy * (1 - k);
      if (r.grow) m.scale.multiplyScalar(0.15 + 0.85 * k);
    }
    // canopies and ropes
    for (let k = this.chutes.length - 1; k >= 0; k--) { const c = this.chutes[k]; if (this.stepChute(c, dt)) { this.endChute(c); this.chutes.splice(k, 1); } }
    for (let k = this.lines.length - 1; k >= 0; k--) {
      const l = this.lines[k];
      if (now > l.until) { this.lines.splice(k, 1); continue; }
      if (now < l.t0) continue;
      if (!l.a(_a) || !l.c(_b)) { if (l.keep || now > l.t0 + 0.1) this.lines.splice(k, 1); continue; }
      const sag = l.getSag ? l.getSag.sag ?? l.sag : l.sag;
      const tug = l.keep ? Math.sin(now * 5 + k) * 0.05 : 0;
      fx.lay(fx.rope(l.key, l.kind, l.n), _a, _b, sag + tug, l.col, l.rad);
    }
    // pillars of light and lift beams
    for (let k = this.cols.length - 1; k >= 0; k--) {
      const c = this.cols[k]; c.t += dt; const u = c.t / c.life;
      if (u >= 1) { this.endCol(c); this.cols.splice(k, 1); continue; }
      const f = Math.min(1, u * 5) * (1 - Math.max(0, u - 0.6) / 0.4);
      if (c.from) {
        // from a moving point above down to c.p
        if (!c.from(_a)) { this.endCol(c); this.cols.splice(k, 1); continue; }
        _d.subVectors(_a, c.p); const len = _d.length();
        _q.setFromUnitVectors(UP, _d.multiplyScalar(1 / Math.max(1e-4, len)));
        fx.glows.put(c.i, c.p, _q, c.r, len, c.r); fx.glows.put(c.j, c.p, _q, c.r * 0.4, len, c.r * 0.4);
        if (R() < dt * 30 * fx.near(c.p)) { const s = R(); fx.emit(COLUMN, c.p.x + rnd(c.r * 0.6), c.p.y + len * s * 0.3, c.p.z + rnd(c.r * 0.6), 1, 0, 1, 0, 0.5, 1, c.col, 0xffffff); }
      } else {
        _q.identity();
        fx.glows.put(c.i, c.p, _q, c.r, c.h, c.r); fx.glows.put(c.j, c.p, _q, c.r * 0.45, c.h, c.r * 0.45);
        if (R() < dt * 20 * fx.near(c.p)) fx.emit(COLUMN, c.p.x + rnd(c.r * 0.6), c.p.y, c.p.z + rnd(c.r * 0.6), 1, 0, 1, 0, 0.5, 1, c.col, 0xffffff);
      }
      fx.glows.tint(c.i, c.col, 0.35 * f); fx.glows.tint(c.j, 0xffffff, 0.5 * f);
    }
    // meteors on the way down, then their craters
    for (let k = this.meteors.length - 1; k >= 0; k--) {
      const M = this.meteors[k]; M.t += dt; const u = Math.min(1, M.t / M.dur), kk = Math.pow(u, 1.5);
      _p.lerpVectors(M.a, M.c, kk);
      _e.set(M.t * 3, M.t * 2.2, 0); _q.setFromEuler(_e); this.rocks.put(M.i, _p, _q, M.s);
      const nk = Math.max(0.35, fx.near(_p));
      _d.subVectors(M.a, M.c).normalize();
      fx.emit(P.FIREBALL, _p.x, _p.y, _p.z, Math.ceil(3 * nk), _d.x, _d.y, _d.z, 1.5, M.s * 1.2);
      if (fx.rate(M, 'sm', 30 * nk, dt)) fx.emit(P.BLACK, _p.x + _d.x * M.s, _p.y + _d.y * M.s, _p.z + _d.z * M.s, 2, _d.x, _d.y, _d.z, 0.6, M.s * 2.2);
      if (fx.rate(M, 'em', 20 * nk, dt)) fx.emit(P.EMBER, _p.x, _p.y, _p.z, 2, 0, 0, 0, 2);
      if ((M.warn -= dt) <= 0) { M.warn = 0.35; fx.ring(V(M.c.x, M.c.y + 0.05, M.c.z), null, M.r * 1.4, M.r * 0.3, 0xff5020, 0.5); }
      if (u >= 1) {
        const p = M.c;
        fx.explode(p, 1.6 + M.r * 0.4, { debris: 26, dcol: 0x3a2a20, c1: 0xb02808 });
        fx.dust(p, 3.2); fx.splinters(p, UP, 18, 1.5, 0x4a3a30);
        for (let j = 0; j < 3; j++) fx.after(j * 0.12, () => fx.ring(V(p.x, p.y + 0.06, p.z), null, 0.5, M.r * (1.6 + j * 0.6), j ? 0xd8c8a8 : 0xffa040, 1));
        fx.emit(P.BLACK, p.x, p.y + 1, p.z, 16, 0, 1, 0, 2.2, 2.6);
        this.scar(p, M.r * 1.25, 0x161210, 30);
        const q = p.clone(); fx.emitter(5, (k2, dt2) => { if (fx.rate(q, 'cr', 16 * (1 - k2) * fx.near(q), dt2)) fx.emit(R() < 0.6 ? P.FIRE : P.EMBER, q.x + rnd(M.r * 0.7), q.y + 0.05, q.z + rnd(M.r * 0.7), 1, 0, 1, 0, 0.6, 1); if (R() < dt2 * 3) fx.emit(P.SMOKE, q.x + rnd(M.r * 0.5), q.y + 0.2, q.z + rnd(M.r * 0.5), 1, 0, 1, 0, 0.4, 1.4); });
        this.rocks.release(M.i); this.meteors.splice(k, 1);
      }
    }
    // swarms boiling round their behemoth
    for (let k = this.swarms.length - 1; k >= 0; k--) {
      const S = this.swarms[k]; S.t += dt; const u = S.t / S.dur;
      if (u >= 1) { this.endSwarm(S); this.swarms.splice(k, 1); continue; }
      const am = v.airModels[S.air]; if (am) S.c.copy(am.m.position);
      const out = Math.sin(Math.min(1, u * 1.15) * Math.PI), Rr = 1 + S.r * out;
      for (let j = 0; j < S.items.length; j++) {
        const ph = S.ph[j], ang = ph + S.t * (1.4 + (j % 5) * 0.25) * (j % 2 ? 1 : -1), rr = Rr * (0.35 + ((j * 37) % 23) / 34);
        _p.set(S.c.x + Math.cos(ang) * rr + Math.sin(S.t * 7 + ph) * 0.3, S.c.y - 0.8 + Math.sin(S.t * 3 + ph * 1.7) * (0.8 + rr * 0.15), S.c.z + Math.sin(ang) * rr + Math.cos(S.t * 6 + ph) * 0.3);
        _e.set(0, -ang + (j % 2 ? 0 : Math.PI), Math.sin(S.t * 40 + ph) * 0.9); _q.setFromEuler(_e);
        const s = 1.1 * Math.min(1, u * 8, (1 - u) * 6);
        this.bugs.put(S.items[j], _p, _q, s, s * (0.4 + Math.abs(Math.sin(S.t * 38 + ph))), s);
      }
      if (fx.rate(S, 'fl', 30 * fx.near(S.c), dt)) { const ang = R() * 6.28; fx.emit(P.FLY, S.c.x + Math.cos(ang) * Rr * 0.6, S.c.y - 1, S.c.z + Math.sin(ang) * Rr * 0.6, 2); }
    }
    // flares drifting down under their own light
    for (const f of this.flares) {
      if (!f.on) continue;
      f.t += dt; if (f.t >= f.life) { f.on = false; continue; }
      const dr = Math.max(0, 1 - 1.6 * dt); f.v.x *= dr; f.v.z *= dr; f.v.y = f.v.y * dr - 1.4 * dt;
      f.p.addScaledVector(f.v, dt);
      fx.emit(FLARE, f.p.x, f.p.y, f.p.z, 1, 0, 0, 0, 0, 1 - f.t / f.life * 0.5);
      if (fx.rate(f, 's', 10 * fx.near(f.p), dt)) fx.emit(P.SMOKE, f.p.x, f.p.y, f.p.z, 1, 0, 0, 0, 0, 0.35, 0xe8e4dc, 0xd0ccc4);
    }
    // transient shells and glows
    for (let k = this.shells.length - 1; k >= 0; k--) {
      const s = this.shells[k]; s.t += dt; const u = s.t / s.life;
      if (u >= 1) { fx.bubbles.release(s.i); this.shells.splice(k, 1); continue; }
      fx.bubbles.put(s.i, s.m ? s.m.position : s.p, _q.identity(), s.r * (1 + u * 0.15)); fx.bubbles.tint(s.i, s.col, (1 - u) * 0.8);
    }
    for (let k = this.discs.length - 1; k >= 0; k--) {
      const s = this.discs[k]; s.t += dt; const u = s.t / s.life;
      if (u >= 1) { fx.discs.release(s.i); this.discs.splice(k, 1); continue; }
      fx.discs.put(s.i, s.p, _q.identity(), s.r); fx.discs.tint(s.i, s.col, 0.45 * Math.min(1, u * 5) * (1 - u));
    }
    for (let k = this.scars.length - 1; k >= 0; k--) {
      const s = this.scars[k]; s.t += dt;
      if (s.t >= s.life) { fx.stains.release(s.i); this.scars.splice(k, 1); continue; }
      const g = Math.min(1, s.t * 6) * Math.min(1, (s.life - s.t) / 2);
      _q.setFromAxisAngle(UP, s.rot); fx.stains.put(s.i, s.p, _q, s.r * g, 1, s.r * g);
    }
    this.standing(dt);
    this.clouds(dt);
  }

  // what b.skyFx holds this tick: domes, veils, flares and auras over each working behemoth
  standing(dt) {
    const v = this.v, b = v.b, fx = this.fx, F = b.skyFx, st = ++this.stamp;
    if (F) {
      for (const w of F.ward) {
        const am = v.airModels[w.air]; if (!am || am.downAt !== undefined) continue;
        let r = this.wards.get(w.air); if (!r) { r = { i: fx.bubbles.alloc(), st }; this.wards.set(w.air, r); }
        r.st = st;
        const p = am.m.position, R0 = w.r + w.hull, gy = this.floor(p.x, p.z);
        fx.bubbles.put(r.i, _p.set(p.x, gy, p.z), _q.identity(), R0, Math.min(R0 * 0.7, (p.y - gy) + 1.5), R0);
        _col.set(this.side(w.side)).lerp(WHITE, 0.5);
        fx.bubbles.mesh.setColorAt(r.i, _col.multiplyScalar(0.32 + 0.06 * Math.sin(fx.time * 2 + w.air))); fx.bubbles.cdirty = true;
      }
      for (const a of F.aura) {
        const am = v.airModels[a.air]; if (!am || am.downAt !== undefined) continue;
        let r = this.auras.get(a.air); if (!r) { r = { i: fx.discs.alloc(), st }; this.auras.set(a.air, r); }
        r.st = st;
        const p = am.m.position, col = (AURA[a.effect] || AURA.courage)[0];
        fx.discs.put(r.i, _p.set(p.x, this.floor(p.x, p.z) + 0.06, p.z), _q.identity(), a.r + a.hull); fx.discs.tint(r.i, col, 0.16 + 0.05 * Math.sin(fx.time * 3 + a.air));
      }
      for (const c of F.camo) {
        const am = v.airModels[c.air]; if (!am || am.downAt !== undefined) continue;
        const p = am.m.position, nk = fx.near(p), D = fx.dims(am.m, b.airships[c.air]);
        if (fx.rate(am, 'cm', 7 * nk, dt)) { toWorld(am.m, rnd(D.hx), D.box.min.y + R() * (D.top - D.box.min.y), rnd(D.hz * 1.2), _a); fx.emit(P.FOG, _a.x, _a.y, _a.z, 1, 0, 0, 0, 0.3, 1.4, 0xb8c8b0, 0xdce4d8); }
        if (fx.rate(am, 'cg', 5 * nk, dt)) { const ang = R() * 6.28, rr = R() * (c.r + c.hull), x = p.x + Math.cos(ang) * rr, z = p.z + Math.sin(ang) * rr; fx.emit(P.HAZE, x, this.floor(x, z) + 0.5, z, 1, 0, 0, 0, 0.2, 1.6, 0xb8d0b0, 0xd8e8d0); }
        if (fx.rate(am, 'cs', 6 * nk, dt)) { toWorld(am.m, rnd(D.hx), D.deckY, rnd(D.hz), _a); fx.emit(P.GLINT, _a.x, _a.y, _a.z, 1, 0, 0, 0, 0, 0.8, 0xe0ffe0, 0xa0d0a0); }
      }
      for (const f of F.flares) {
        const am = v.airModels[f.air]; if (!am || am.downAt !== undefined) continue;
        if (fx.rate(am, 'fr', 1.6, dt)) { const a = b.airships[f.air]; this.flare({ a, am, m: am.m, D: fx.dims(am.m, a) }); }
      }
      for (const f of F.phase) {
        const am = v.airModels[f.air]; if (!am || am.downAt !== undefined) continue;
        const D = fx.dims(am.m, b.airships[f.air]), nk = fx.near(am.m.position);
        if (fx.rate(am, 'ph', 14 * nk, dt)) { toWorld(am.m, rnd(D.hx * 1.05), D.box.min.y + R() * (D.top - D.box.min.y), rnd(D.hz * 1.1), _a); fx.emit(R() < 0.5 ? P.GLINT : P.MOTE, _a.x, _a.y, _a.z, 1, 0, 0.2, 0, 0.3, 1, 0xc8b0ff, 0x8ab4ff); }
      }
    }
    for (const [k, r] of this.wards) if (r.st !== st) { fx.bubbles.release(r.i); this.wards.delete(k); }
    for (const [k, r] of this.auras) if (r.st !== st) { fx.discs.release(r.i); this.auras.delete(k); }
  }

  // the clouds a behemoth let fall: they hang, rain and stain the ground until their tick runs out
  clouds(dt) {
    const b = this.v.b, fx = this.fx, Z = b.skyZones || [], st = this.stamp;
    for (const z of Z) {
      if (z.until < b.tick) continue;
      let r = this.zones.get(z);
      const C = CLOUD[z.kind] || CLOUD.gas;
      if (!r) { r = { i: fx.stains.alloc(), z, st, c: V(z.x + 0.5, 0, z.y + 0.5) }; this.gp(r.c.x, r.c.z, r.c); this.zones.set(z, r); this.zoneList.push(r); fx.stains.tint(r.i, C.fire ? 0x2a1a12 : C.c[0], C.fire ? 1 : 0.55); }
      r.st = st;
      const c = r.c, R0 = z.r, nk = fx.near(c), left = Math.min(1, (z.until - b.tick) / 4);
      _q.setFromAxisAngle(UP, z.from); fx.stains.put(r.i, _p.set(c.x, c.y - 0.02, c.z), _q, R0 * 0.95, 1, R0 * 0.95);
      // the rain or the drip, falling from the cloud bank above
      const nr = fx.rate(r, 'rn', (C.hail ? 70 : 55) * R0 * 0.3 * nk * left, dt);
      for (let j = 0; j < nr; j++) {
        const ang = R() * 6.28, rr = Math.sqrt(R()) * R0, x = c.x + Math.cos(ang) * rr, z2 = c.z + Math.sin(ang) * rr;
        fx.emit(C.drip ? DRIP : RAIN, x, c.y + 3.6 + R() * 1.2, z2, 1, 0, -1, 0, C.hail ? 7 : 4, C.hail ? 1.4 : 1, C.rain, C.rain);
      }
      // the bank itself, and what lingers on the ground
      if (fx.rate(r, 'bk', 5 * R0 * 0.3 * nk * left, dt)) { const ang = R() * 6.28, rr = Math.sqrt(R()) * R0 * 0.9; fx.emit(P.POISON, c.x + Math.cos(ang) * rr, c.y + 4.2 + R() * 0.6, c.z + Math.sin(ang) * rr, 1, 0, 0, 0, 0.2, 3, C.c[0], C.c[1]); }
      if (fx.rate(r, 'gd', 9 * R0 * 0.3 * nk * left, dt)) { const ang = R() * 6.28, rr = Math.sqrt(R()) * R0, x = c.x + Math.cos(ang) * rr, z2 = c.z + Math.sin(ang) * rr; fx.emit(C.hail ? P.DUST : P.POISON, x, this.floor(x, z2) + 0.25, z2, 1, 0, 0.3, 0, 0.3, 1.8, C.c[0], C.c[1]); }
      if (C.fire && fx.rate(r, 'fi', 14 * R0 * 0.3 * nk * left, dt)) { const ang = R() * 6.28, rr = Math.sqrt(R()) * R0, x = c.x + Math.cos(ang) * rr, z2 = c.z + Math.sin(ang) * rr; fx.emit(P.FIRE, x, this.floor(x, z2) + 0.05, z2, 1, 0, 1, 0, 0.6, 1.2, C.fire[0], C.fire[1]); }
      if (C.flies && fx.rate(r, 'fy', 10 * nk, dt)) fx.emit(P.FLY, c.x + rnd(R0 * 0.6), c.y + 0.6, c.z + rnd(R0 * 0.6), 3);
      if (C.hail && fx.rate(r, 'hl', 10 * nk * left, dt)) { const x = c.x + rnd(R0 * 0.7), z2 = c.z + rnd(R0 * 0.7); fx.emit(P.CHIP, x, this.floor(x, z2) + 0.05, z2, 2, 0, 1, 0, 2, 0.8, 0xe8f0ff, 0xc8d8e8); }
    }
    for (let k = this.zoneList.length - 1; k >= 0; k--) {
      const r = this.zoneList[k];
      if (r.st === st && r.z.until >= b.tick) continue;
      fx.stains.release(r.i); this.zones.delete(r.z); this.zoneList.splice(k, 1);
    }
  }
}
