// Animators for the flying units (registered with animate.js through registry.js):
//
//   air.mount   a beast with a rider: the beast's own animator (rig.mountKind) drives the beast; the grafted rider
//               (rig keys rtorso, rarms, rforearms, rhands, rweapon, rshield, rhead) sits upright in the saddle, couches
//               his weapon in flight and strikes with it; a breath / dive asked for by an action plays on the beast.
//   air.craft   machines and conveyances: rotors and screws spin, wings flap, envelopes breathe, flames flicker, the
//               hull hovers and banks; attacks dip the nose; the dead spin in, burn and drop.
//   air.disc    a floating disc: hovers, its glow-ring turns.
//   air.multi   composites (chariot teams, flocks, a cage under a bird): each member runs its own animator.
//
// Actions (air/index.js) leave their progress on rig.act { bomb, torpedo, harpoon, strafe, drop, breath: 0..1 }.
import { runAnimator } from '../animate.js';
import { poseCarried } from '../bodies/humanoid.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const ease = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const restX = (o) => (o && o.userData.rest ? o.userData.rest[0] : 0);

function sub(rig) {
  const s = rig._sub || (rig._sub = {});
  s.torso = rig.rtorso && rig.rtorso[0]; s.head = rig.rhead && rig.rhead[0];
  s.arms = rig.rarms || []; s.forearms = rig.rforearms || []; s.hands = rig.rhands || [];
  s.weapon = rig.rweapon; s.shield = rig.rshield; s.attack = rig.rattack || 'thrust'; s.hold = rig.rhold || 'none';
  return s;
}
const _c = { t: 0, phase: 0, atk: -1, dead: 0, moving: false, flying: false };

function mountAnim(rig, inner, c, base) {
  const act = rig.act || {};
  let atk = c.atk;
  if (atk < 0 && act.breath > 0) atk = 0.3 + 0.45 * act.breath;      // the beast breathes / shrieks on its own cue
  const mc = atk === c.atk ? c : { ...c, atk };
  runAnimator(rig.mountKind, rig, inner, mc);
  // a dive asked for by 'strafe' / 'bomb' tips the whole beast nose-down
  const dive = Math.max(act.strafe || 0, act.bomb || 0, act.torpedo || 0) > 0 && c.dead <= 0 ? Math.sin(Math.max(act.strafe || 0, act.bomb || 0, act.torpedo || 0) * Math.PI) : 0;
  if (dive) inner.rotation.x += 0.28 * dive;
  if (rig.spin) for (const s of rig.spin) s.rotation.y = c.t * 1.6 + (c.phase || 0);
  if (!rig.rtorso) return;
  const S = sub(rig), dead = c.dead > 0, df = dead ? clamp(c.dead * 2) : 0;
  const riding = c.moving || c.flying;
  _c.t = c.t; _c.phase = c.phase || 0; _c.dead = c.dead; _c.moving = false; _c.flying = false;
  _c.atk = c.atk >= 0 ? c.atk : riding && S.attack === 'thrust' && !rig.rstand ? 0.2 : -1;
  base.upperBody(S, _c);
  // keep the rider upright as the beast pitches: he gives with the trunk, but only by a third
  const trunk = rig.torso || rig.body;
  const root = rig.riderRoot && rig.riderRoot[0];
  if (root && trunk && !dead) root.rotation.x = restX(root) - (trunk.rotation.x - restX(trunk)) * 0.65;
  if (S.torso) {
    if (!dead) S.torso.rotation.x += riding && !rig.rstand ? 0.14 + Math.sin(c.t * 2 + (c.phase || 0)) * 0.02 : 0.02;
    else { S.torso.rotation.x += 0.7 * df; S.torso.rotation.z += 0.35 * df; }
  }
  poseCarried(S, _c, base, S.hold, !rig.rstand);
  if (!dead && !rig.rstand && !(S.shield && S.shield[0]) && S.arms[0]) { base.R(S.arms[0], -0.62 + Math.sin(c.t * 1.6 + (c.phase || 0)) * 0.02, 0, 0.16); base.R(S.forearms[0], -0.95); }
}

function discAnim(rig, inner, c, base) {
  const s = inner.scale.y || 1, dead = c.dead > 0;
  inner.rotation.set(0, 0, 0); inner.position.set(0, 0, 0);
  if (dead) { const f = ease(c.dead * 1.5); inner.rotation.z = 0.9 * f; inner.rotation.x = 0.3 * f; inner.position.y = -f * 0.3 * s; }
  else { inner.position.y = Math.sin(c.t * 2.2 + (c.phase || 0)) * 0.04 * s; inner.rotation.z = Math.sin(c.t * 1.3 + (c.phase || 0)) * 0.05; inner.rotation.x = c.flying ? 0.08 : 0; }
  if (rig.spin) for (const g of rig.spin) g.rotation.y = c.t * (dead ? 0.3 : 2.4);
}

/** the machines: everything keyed is driven from rig values set by the builders (air/craft.js) */
function craftAnim(rig, inner, c, base) {
  const { R, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, act = rig.act || {};
  const dead = c.dead > 0, df = dead ? ease(c.dead * 1.4) : 0, fly = c.flying && !dead;
  const run = dead ? Math.max(0, 1 - c.dead * 1.5) : fly || c.moving ? 1 : 0.25;
  // rotors (spin about Y), screws (about Z), wings (flap about Z), sway (pendulum about X)
  (rig.rotors || []).forEach((r, i) => { r.rotation.y = (r.userData.spin = (r.userData.spin || 0) + 0) + t * (18 + i * 1.3) * run * (i % 2 ? -1 : 1) * (rig.rotorRate || 1); });
  (rig.props || []).forEach((r, i) => { r.rotation.z = t * 24 * run * (i % 2 ? -1 : 1); });
  const flapRate = rig.flapRate || 5.5, flapAmp = rig.flapAmp || 0.5;
  (rig.wings || []).forEach((w, i) => {
    const sg = (w.userData.rest?.[3] ?? (i % 2 ? -1 : 1)) >= 0 ? 1 : -1;
    const f = dead ? -0.5 * df : fly ? Math.sin(t * flapRate + ph + (i >> 1) * 0.6) * flapAmp + 0.1 : 0.35 + Math.sin(t * 1.1 + ph) * 0.03;
    R(w, 0, 0, sg * f);
  });
  (rig.wingtips || []).forEach((w, i) => { const sg = (w.userData.rest?.[3] ?? (i % 2 ? -1 : 1)) >= 0 ? 1 : -1; R(w, 0, 0, sg * (fly ? Math.sin(t * flapRate + ph - 0.8) * flapAmp * 0.6 : dead ? -0.4 * df : 0.25)); });
  (rig.sway || []).forEach((w, i) => R(w, Math.sin(t * 1.7 + ph + i) * 0.06 * (dead ? 0.2 : 1), 0, Math.cos(t * 1.3 + ph + i * 2) * 0.05));
  (rig.flames || []).forEach((f, i) => { const k = dead ? 0.2 : 0.85 + Math.sin(t * 17 + i * 3) * 0.12 + Math.sin(t * 29 + i) * 0.06; f.scale.set(k, k * (1 + (act.bomb || 0) * 0.3), k); });
  if (rig.core) { const b = dead ? 1 - 0.45 * df : 1 + Math.sin(t * 1.4 + ph) * 0.012; rig.core.scale.set(dead ? 1 + 0.1 * df : 1, b, dead ? 1 + 0.1 * df : 1); }
  (rig.spin || []).forEach((g, i) => { g.rotation.y = t * (dead ? 0.2 : 1.8) * (i % 2 ? -1 : 1); });
  (rig.tails || []).forEach((x, i) => R(x, Math.sin(t * 3 + ph - i * 0.6) * 0.08, Math.sin(t * 2.2 + ph - i * 0.8) * 0.18));
  // guns recoil on the attack
  const rec = c.atk >= 0 ? keys(c.atk, [[0, 0], [0.45, 0], [0.5, 1], [0.8, 0], [1, 0]]) : act.strafe > 0 ? Math.abs(Math.sin(act.strafe * 30)) : 0;
  (rig.guns || []).forEach((g) => { if (g.userData.rest) g.position.set(g.userData.rest[3], g.userData.rest[4], g.userData.rest[5] - 0.05 * rec); });
  // the hull: hover, bank, dip into the attack; the dead spin in
  inner.rotation.set(0, 0, 0); inner.position.set(0, 0, 0);
  const heavy = rig.mass || 1;
  if (dead) {
    const spin = rig.rotors && rig.rotors.length ? 1 : 0;
    inner.rotation.z = df * (rig.crash === 'sink' ? 0.25 : 0.9);
    inner.rotation.x = df * (rig.crash === 'sink' ? 0.1 : 0.45);
    inner.rotation.y = spin * c.dead * 4;
    inner.position.y = -Math.max(0, c.dead - 0.4) * 0.5 * s;
  } else {
    const bob = Math.sin(t * 2.0 / heavy + ph) * 0.035 * s / heavy;
    const atkDip = c.atk >= 0 ? keys(c.atk, [[0, 0], [0.4, 0.12], [0.7, 0.06], [1, 0]]) : 0;
    const dive = Math.sin(clamp(Math.max(act.bomb || 0, act.torpedo || 0, act.strafe || 0, act.harpoon || 0)) * Math.PI) * 0.12;
    inner.position.y = fly || !rig.grounded ? bob : 0;
    inner.rotation.x = (fly ? 0.07 : 0) + atkDip + dive;
    inner.rotation.z = fly ? Math.sin(t * 0.9 + ph) * 0.06 / heavy : Math.sin(t * 0.9 + ph) * 0.015;
  }
}

/** composites: members run their own animators; the whole hovers */
function multiAnim(rig, inner, c, base) {
  const s = inner.scale.y || 1, dead = c.dead > 0;
  for (const m of rig.members || []) {
    const mr = m.model.userData.rig, mi = m.model.userData.inner;
    const cc = m.ctx || (m.ctx = {});
    cc.t = c.t * (m.rate || 1); cc.phase = (c.phase || 0) + (m.phase || 0); cc.atk = m.strikes === false ? -1 : c.atk; cc.dead = c.dead; cc.moving = c.moving; cc.flying = m.flying ?? c.flying; cc.fx = null;
    if (mr) runAnimator(mr.kind, mr, mi, cc);
    if (m.orbit) {
      const a = c.t * m.orbit.speed + m.orbit.a0, r = m.orbit.r * (1 + 0.15 * Math.sin(c.t * 0.7 + m.orbit.a0 * 3));
      m.model.position.set(Math.cos(a) * r, m.orbit.y + Math.sin(c.t * 1.9 + m.orbit.a0 * 2) * m.orbit.dy - (dead ? c.dead * m.orbit.y * 0.8 : 0), Math.sin(a) * r * m.orbit.zk);
      m.model.rotation.y = -a + (m.orbit.speed > 0 ? Math.PI : 0);
    }
  }
  if (rig.craft) craftAnim(rig, inner, c, base);
  else {
    inner.rotation.set(0, 0, 0);
    inner.position.y = dead ? -Math.max(0, c.dead - 0.4) * 0.5 * s : c.flying ? Math.sin(c.t * 1.8 + (c.phase || 0)) * 0.03 * s : 0;
    if (dead) inner.rotation.z = ease(c.dead * 1.4) * 0.6;
  }
}

export const animators = { 'air.mount': mountAnim, 'air.craft': craftAnim, 'air.disc': discAnim, 'air.multi': multiAnim };
