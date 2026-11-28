// A realm's sky design, drawn (see src/data/fleets/skyschema.js): an airship with its own envelope and parts,
// or a great flying beast with riders on its back. The builders live in ./sky/ (ships.js, beasts.js, kit.js).
import { buildSkyShip } from './sky/ships.js';
import { buildSkyBeast } from './sky/beasts.js';

/** returns a model for def (an AIRSHIPS entry with def.sky), or null to use the plain airship */
export function buildSkyModel(def, sideColor) {
  const D = def && def.sky;
  if (!D) return null;
  try {
    return D.kind === 'beast' ? buildSkyBeast(def, sideColor) : buildSkyShip(def, sideColor);
  } catch (err) {
    console.warn(`[skyParts] ${def.id} failed, using the plain airship`, err);
    return null;
  }
}

/** per-frame motion: wingbeats, tails and coils, rotors, rune-rings, glows */
export function animateSky(m, t) {
  const A = m.userData.anim;
  if (!A) return;
  const dr = A.droop || 0;
  // wingbeats: the outer wing lags the inner, so the stroke whips like a real one
  for (const w of A.wings) {
    const ph = t * A.speed * w.speedK + w.phase, s = Math.sin(ph);
    const amp = w.amp * (1 - 0.6 * dr), base = w.base * (1 - dr) - 0.22 * dr;
    w.sh.rotation.x = -(base + amp * s);
    if (w.el) w.el.rotation.x = -(amp * w.outerK * Math.sin(ph - 0.8)) + 0.25 * dr;
  }
  if (A.body && A.wings.length && !A.buzz) A.body.position.y = 0.07 * Math.sin(t * A.speed + 0.6) * (1 - dr);
  else if (A.body && A.buzz) A.body.position.y = 0.04 * Math.sin(t * 2.3);
  // tails, coils and necks sway as a wave runs down them
  for (const tl of A.tails) {
    const amp = tl.amp * (1 - 0.6 * dr);
    tl.segs.forEach((s, i) => {
      const u = s.userData;
      if (u.bz === undefined) u.bz = s.rotation.z;
      const k = tl.ramp ? Math.min(1, Math.max(0, (i - tl.ramp + 1) / 4)) : 1;
      s.rotation.y = (u.baseY || 0) + amp * k * Math.sin(t * tl.speed - i * tl.lag);
      if (tl.pitch) s.rotation.z = u.bz + tl.pitch * Math.sin(t * tl.speed * 0.7 - i * 0.4) - dr * 0.08;
      else if (dr) s.rotation.z = u.bz - dr * 0.12;
    });
  }
  for (const h of A.heads) {
    const u = h.p.userData;
    if (u.bz === undefined) { u.bz = h.p.rotation.z; u.by = h.p.rotation.y; }
    h.p.rotation.z = u.bz + 0.06 * Math.sin(t * 0.9) - dr * 0.3;
    h.p.rotation.y = u.by + 0.14 * Math.sin(t * 0.33 + 1);
  }
  for (const s of A.spin) s.o.rotation[s.axis] = (s.o.userData.r0 ?? (s.o.userData.r0 = s.o.rotation[s.axis])) + t * s.speed * (1 - 0.7 * dr);
  for (const b of A.bobs || []) { const u = b.o.userData; if (u.y0 === undefined) u.y0 = b.o.position.y; b.o.position.y = u.y0 + b.amp * Math.sin(t * b.speed + b.phase); }
  for (const g of A.glows) {
    const f = 1 + g.k * (Math.sin(t * 11.3 + g.ph) * 0.5 + Math.sin(t * 6.7 + g.ph * 2) * 0.5);
    g.m.emissiveIntensity = g.m.userData.glowBase * f * (1 - 0.6 * dr);
    if (g.op !== undefined) g.m.opacity = g.op * (0.75 + 0.25 * f) * (1 - 0.5 * dr);
  }
}
