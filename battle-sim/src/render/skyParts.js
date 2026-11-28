// A realm's sky design, drawn (see src/data/fleets/skyschema.js): an airship with its own envelope and parts,
// or a great flying beast with riders on its back. The builders live in ./sky/ (ships.js, beasts.js, kit.js,
// style.js for each realm's look, deco.js for the dressing). Every model carries userData.lod (six detail levels),
// userData.actions (fire, mortar, bomb, launch, board, hit; breath, shriek, dive, snatch for beasts) and
// userData.anchors (bow, stern, port, starboard, bombBay, mouth, talons ...).
import { buildSkyShip } from './sky/ships.js';
import { buildSkyBeast } from './sky/beasts.js';

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
    A.body.rotation.z = -(act.pitch || 0) + (act.rear || 0);
    A.body.rotation.x = act.roll || 0;
    A.body.position.x = act.lunge || 0;
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
  for (const g of A.glows) {
    const f = 1 + g.k * (Math.sin(t * 11.3 + g.ph) * 0.5 + Math.sin(t * 6.7 + g.ph * 2) * 0.5);
    g.m.emissiveIntensity = g.m.userData.glowBase * f * (1 - 0.6 * dr) * (1 + (g.m.userData.boost || 0));
    if (g.op !== undefined) g.m.opacity = g.op * (0.75 + 0.25 * f) * (1 - 0.5 * dr);
  }
}
