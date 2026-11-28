// A realm's sky design, drawn (see src/data/fleets/skyschema.js): an airship with its own envelope and parts,
// or a great flying beast with riders on its back. The builders live in ./sky/ (ships.js, beasts.js, kit.js,
// style.js for each realm's look, deco.js for the dressing). Every model carries userData.lod (six detail levels),
// userData.actions (fire, mortar, bomb, launch, board, hit; breath, shriek, dive, snatch for beasts) and
// userData.anchors (bow, stern, port, starboard, bombBay, mouth, talons ...).
import { buildSkyShip } from './sky/ships.js';
import { buildSkyBeast } from './sky/beasts.js';
import { animateRig } from './animate.js';

/** returns a model for def (an AIRSHIPS entry with def.sky), or null to use the plain airship */
export function buildSkyModel(def, sideColor) {
  const D = def && def.sky;
  if (!D) return null;
  try {
    return D.kind === 'beast' ? buildSkyBeast(def, sideColor) : buildSkyShip(def, sideColor);
  } catch (err) {
    console.error(`[skyParts] ${def.id} failed, using the plain airship`, err);
    return null;
  }
}

/**
 * per-frame motion: wingbeats, tails and coils, rotors, rune-rings, glows. Idempotent for a given t, so the
 * actions (which set A.act and call this again with the last t) can be applied in any order with it.
 */
export function animateSky(m, t) {
  const A = m.userData.anim;
  if (!A) return;
  A.t = t;
  const act = A.act || {}, dr = A.droop || 0, fold = act.fold || 0, flare = act.flare || 0, beat = act.beat || 0;
  if (A.rigMode) { animateRigBeast(A, t, act, dr, fold, flare, beat); bodyMotion(A, act, dr, fold); for (const g of A.glows) glow(g, t, dr); return; }
  // wingbeats: the outer wing lags the inner, so the stroke whips like a real one
  for (const w of A.wings) {
    const ph = t * A.speed * w.speedK * (1 + beat) + w.phase, s = Math.sin(ph);
    const amp = w.amp * (1 - 0.6 * dr) * (1 - fold * 0.92) * (1 - flare * 0.75) * (1 + beat * 0.4), base = w.base * (1 - dr) - 0.22 * dr;
    let rx = -(base + amp * s);
    rx = rx + (-0.12 - rx) * fold + (-1.05 - rx) * flare;
    const u = w.sh.userData; if (u.ry0 === undefined) u.ry0 = w.sh.rotation.y;
    w.sh.rotation.x = rx;
    w.sh.rotation.y = u.ry0 - (w.foldY ?? 0.85) * fold + 0.25 * flare;
    if (w.el) {
      const e = w.el.userData; if (e.ry0 === undefined) e.ry0 = w.el.rotation.y;
      w.el.rotation.x = (-(amp * w.outerK * Math.sin(ph - 0.8)) + 0.25 * dr) * (1 - fold) + 0.35 * fold * (w.foldX ?? 1) - 0.3 * flare;
      w.el.rotation.y = e.ry0 - (w.foldEl ?? 1.1) * fold;
    }
  }
  if (A.body) {
    const bu = A.body.userData; if (bu.y0 === undefined) bu.y0 = A.body.position.y;
    if (A.wings.length && !A.buzz) A.body.position.y = bu.y0 + 0.07 * Math.sin(t * A.speed + 0.6) * (1 - dr) * (1 - fold);
    else if (A.buzz) A.body.position.y = bu.y0 + 0.04 * Math.sin(t * 2.3);
    bodyMotion(A, act, dr, fold);
  }
  // tails, coils and necks sway as a wave runs down them
  for (const tl of A.tails) {
    const amp = tl.amp * (1 - 0.6 * dr) * (1 + (act.lash || 0) * 2);
    tl.segs.forEach((s, i) => {
      const u = s.userData;
      if (u.bz === undefined) u.bz = s.rotation.z;
      const k = tl.ramp ? Math.min(1, Math.max(0, (i - tl.ramp + 1) / 4)) : 1;
      s.rotation.y = (u.baseY || 0) + amp * k * Math.sin(t * tl.speed * (1 + (act.lash || 0)) - i * tl.lag);
      if (tl.pitch) s.rotation.z = u.bz + tl.pitch * Math.sin(t * tl.speed * 0.7 - i * 0.4) - dr * 0.08;
      else if (dr) s.rotation.z = u.bz - dr * 0.12;
      else s.rotation.z = u.bz;
    });
  }
  for (const h of A.heads) {
    const u = h.p.userData;
    if (u.bz === undefined) { u.bz = h.p.rotation.z; u.by = h.p.rotation.y; u.px = h.p.position.x; u.py = h.p.position.y; }
    h.p.rotation.z = u.bz + 0.06 * Math.sin(t * 0.9) * (1 - (act.still || 0)) - dr * 0.3 + (act.headUp || 0);
    h.p.rotation.y = u.by + 0.14 * Math.sin(t * 0.33 + 1) * (1 - (act.still || 0)) + (act.headYaw || 0);
    h.p.position.x = u.px + (act.thrust || 0);
    h.p.position.y = u.py + (act.thrustY || 0);
  }
  for (const s of A.spin) s.o.rotation[s.axis] = (s.o.userData.r0 ?? (s.o.userData.r0 = s.o.rotation[s.axis])) + t * s.speed * (1 - 0.7 * dr);
  for (const b of A.bobs || []) { const u = b.o.userData; if (u.y0 === undefined) u.y0 = b.o.position.y; b.o.position.y = u.y0 + b.amp * Math.sin(t * b.speed + b.phase); }
  for (const g of A.glows) glow(g, t, dr);
}
function glow(g, t, dr) {
  const f = 1 + g.k * (Math.sin(t * 11.3 + g.ph) * 0.5 + Math.sin(t * 6.7 + g.ph * 2) * 0.5);
  g.m.emissiveIntensity = g.m.userData.glowBase * f * (1 - 0.6 * dr) * (1 + (g.m.userData.boost || 0));
  if (g.op !== undefined) g.m.opacity = g.op * (0.75 + 0.25 * f) * (1 - 0.5 * dr);
}
function bodyMotion(A, act, dr, fold) {
  if (!A.body) return;
  A.body.rotation.z = -(act.pitch || 0) + (act.rear || 0) - 0.12 * dr;
  A.body.rotation.x = (act.roll || 0) + 0.18 * dr;
  A.body.position.x = act.lunge || 0;
  void fold;
}

// a sculpted beast (sky/rigbeast.js): the monster's own flight animator beats its wings and sways its tail; the sky
// actions lay their poses over that (ground-monster frame: +Z forward, +X its left, so wings beat about Z)
const _rest = (o) => o.userData.rest || [0, 0, 0, 0, 0, 0];
const mixTo = (o, ax, v, k) => { if (k > 0) o.rotation[ax] += (v - o.rotation[ax]) * Math.min(1, k); };
function animateRigBeast(A, t, act, dr, fold, flare, beat) {
  const rig = A.rig, tt = t * A.tk * (1 + 0.8 * beat) + A.phase;
  // every joint back to rest first, so the overlays below never pile up on a joint the animator leaves alone
  if (!A.joints) { A.joints = []; for (const v of Object.values(rig)) for (const o of Array.isArray(v) ? v : [v]) if (o && o.isObject3D && o.userData.rest) A.joints.push(o); }
  for (const o of A.joints) { const r = o.userData.rest; o.rotation.set(r[0], r[1], r[2]); o.position.set(r[3], r[4], r[5]); }
  animateRig(A.unit, { t: tt, moving: false, atk: -1, dead: 0, phase: 0, flying: true });
  const W = rig.wings || [], WT = rig.wingtips || [];
  if (!A.wingsOwn) {
    // a monster that never flew on the ground (the sphinx) beats its grafted wings here
    const b = tt * 6.2;
    W.forEach((w, i) => { const r = _rest(w), sg = r[3] >= 0 ? 1 : -1; w.rotation.set(r[0], r[1] + sg * 0.08 * Math.cos(b), r[2] + sg * (0.1 + 0.55 * Math.sin(b))); if (WT[i]) { const q = _rest(WT[i]); WT[i].rotation.set(q[0], q[1], q[2] + sg * 0.45 * Math.sin(b - 1)); } });
  }
  const limp = Math.max(dr, A.limp || 0);
  W.forEach((w, i) => {
    const r = _rest(w), sg = r[3] >= 0 ? 1 : -1, tip = WT[i], q = tip ? _rest(tip) : null;
    // dive: swept back and closed along the flanks; shriek: flared high; hurt: one wing hangs (the one on her hit side)
    if (fold) { mixTo(w, 'z', r[2] - sg * 0.15, fold); w.rotation.y += sg * 1.05 * fold; if (tip) { mixTo(tip, 'z', q[2] - sg * 0.3, fold); tip.rotation.y += sg * 1.2 * fold; } }
    if (flare) { mixTo(w, 'z', r[2] + sg * 0.95, flare); if (tip) mixTo(tip, 'z', q[2] + sg * 0.25, flare); }
    const lame = limp * (i === 0 ? 1 : 0.35);
    if (lame) { mixTo(w, 'z', r[2] - sg * 0.55, 0.75 * lame); if (tip) mixTo(tip, 'z', q[2] - sg * 0.6, 0.8 * lame); }
  });
  if (rig.jaw && act.jaw) rig.jaw.rotation.x += 0.75 * act.jaw;
  if (rig.mjaw && act.jaw) rig.mjaw.rotation.x += 0.75 * act.jaw;
  const head = rig.head || rig.mhead;
  if (head) {
    head.rotation.x += -(act.headUp || 0) + 0.35 * dr;
    head.rotation.y += act.headYaw || 0;
    const r = _rest(head), k = 1 / (A.k || 1);
    head.position.set(r[3], r[4] + (act.thrustY || 0) * k, r[5] + (act.thrust || 0) * k * 0.8);
  }
  if (rig.neck) rig.neck.rotation.x += -(act.headUp || 0) * 0.4 + 0.25 * dr;
  // talons reach down and forward to snatch or drop, and close on what they hold
  const reach = act.reach || 0, curl = act.curl || 0;
  for (const l of [...(rig.legs || []), ...(rig.hlegs || [])]) l.rotation.x -= 0.9 * reach;
  for (const s of [...(rig.shins || []), ...(rig.hshins || [])]) s.rotation.x += 0.5 * curl - 0.3 * reach;
  (rig.hlegs || []).forEach((l) => { l.rotation.x += 1.0; });
  (rig.hshins || []).forEach((s) => { s.rotation.x += 0.35; });
  const lash = act.lash || 0;
  (rig.tail || []).forEach((s, i) => { s.rotation.y += lash * 0.25 * Math.sin(t * 9 - i * 0.8) + dr * 0.05; s.rotation.x += 0.06 * dr; });
}
