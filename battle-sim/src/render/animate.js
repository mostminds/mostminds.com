// Procedural animation for rigged models (see rigkit.js). An animator poses a
// rig from a few numbers; nothing is keyframed, so every body that follows the
// rig contract moves without extra work:
//
//   kind     biped | quad | spider | float | ram | <custom, via registerAnimators>
//   attack   swing | thrust | shoot | cast | claw | slam | bite
//   torso head neck jaw core body log        single nodes
//   legs[] shins[] arms[] forearms[] wings[] wingtips[] tail[] wheels[]   lists
//
// Bipeds: legs/shins and arms/forearms are [left (+X), right (-X)]; the right
// arm (index 1) carries the weapon. Quads: legs/shins are [front-left,
// front-right, back-left, back-right]. Models face +Z; limbs hang down -Y, so
// a negative X rotation swings a limb forward and a positive one bends a knee.
const ANIMATORS = {};
/** add or replace animators: { kind: (rig, inner, ctx, base) => void } */
export function registerAnimators(map) { Object.assign(ANIMATORS, map); }

/** set a node to its rest rotation plus an offset (radians) */
export function R(o, x = 0, y = 0, z = 0) {
  if (!o) return;
  const r = o.userData.rest;
  if (r) o.rotation.set(r[0] + x, r[1] + y, r[2] + z); else o.rotation.set(x, y, z);
}
/** set a node to its rest position plus an offset */
export function P(o, x = 0, y = 0, z = 0) {
  if (!o) return;
  const r = o.userData.rest;
  if (r) o.position.set(r[3] + x, r[4] + y, r[5] + z);
}
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
/** piecewise curve through [time, value] keys with eased segments */
export function keys(t, ks) {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) return lerp(ks[i - 1][1], ks[i][1], ease((t - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0])));
  return ks[ks.length - 1][1];
}

/** arms, torso and head of anything with a humanoid upper body. Returns true while attacking. */
export function upperBody(rig, c, style = rig.attack) {
  const { t, phase, atk } = c;
  const k = c.moving ? 1 : 0, s = Math.sin(t * 9.5 + phase), idle = Math.sin(t * 1.6 + phase);
  const A = rig.arms || [], F = rig.forearms || [];
  let tx = k * 0.06, ty = -s * 0.1 * k, tz = idle * 0.012;
  if (atk < 0) {
    R(A[0], s * 0.45 * k + idle * 0.02, 0, 0.03 * idle); R(F[0], -(0.18 + 0.3 * k + 0.12 * Math.max(0, s) * k));
    R(A[1], -s * 0.45 * k - idle * 0.02, 0, -0.03 * idle); R(F[1], -(0.18 + 0.3 * k + 0.12 * Math.max(0, -s) * k));
    R(rig.head, idle * 0.03, Math.sin(t * 0.7 + phase * 2) * 0.12 * (1 - k));
  } else {
    const a = atk;
    switch (style) {
      case 'thrust':
        R(A[1], keys(a, [[0, 0], [0.35, 0.7], [0.55, -1.45], [1, 0]]), 0, keys(a, [[0, 0], [0.35, -0.15], [0.55, 0.1], [1, 0]]));
        R(F[1], keys(a, [[0, -0.2], [0.35, -1.8], [0.55, -0.05], [1, -0.2]]));
        R(A[0], keys(a, [[0, 0], [0.35, -0.5], [0.55, 0.3], [1, 0]])); R(F[0], -0.7);
        tx = keys(a, [[0, 0], [0.35, -0.08], [0.55, 0.3], [1, 0]]); ty = keys(a, [[0, 0], [0.35, -0.4], [0.55, 0.3], [1, 0]]);
        break;
      case 'shoot':
        R(A[1], keys(a, [[0, 0], [0.25, -1.5], [0.7, -1.5], [1, 0]])); R(F[1], keys(a, [[0, -0.2], [0.25, -0.05], [0.7, -0.05], [1, -0.2]]));
        R(A[0], keys(a, [[0, 0], [0.25, -1.45], [0.7, -1.4], [1, 0]]), 0, -0.25);
        R(F[0], keys(a, [[0, -0.2], [0.25, -0.6], [0.5, -2.1], [0.56, -0.9], [1, -0.2]]));
        ty = keys(a, [[0, 0], [0.25, 0.5], [0.7, 0.5], [1, 0]]); tx = keys(a, [[0, 0], [0.5, -0.08], [1, 0]]);
        R(rig.head, 0, -ty * 0.8);
        break;
      case 'cast':
        R(A[1], keys(a, [[0, 0], [0.4, -2.3], [0.6, -1.5], [1, 0]]), 0, keys(a, [[0, 0], [0.4, -0.3], [1, 0]])); R(F[1], keys(a, [[0, -0.2], [0.4, -0.5], [0.6, -0.1], [1, -0.2]]));
        R(A[0], keys(a, [[0, 0], [0.4, -0.6], [0.6, -1.6], [1, 0]]), 0, 0.2); R(F[0], keys(a, [[0, -0.2], [0.4, -1.2], [0.6, -0.1], [1, -0.2]]));
        tx = keys(a, [[0, 0], [0.4, -0.2], [0.6, 0.18], [1, 0]]);
        break;
      case 'slam':
        for (const i of [0, 1]) { R(A[i], keys(a, [[0, 0], [0.4, -2.9], [0.58, 0.35], [1, 0]]), 0, (i ? 1 : -1) * keys(a, [[0, 0], [0.4, 0.35], [1, 0]])); R(F[i], keys(a, [[0, -0.2], [0.4, -0.9], [0.58, -0.05], [1, -0.2]])); }
        tx = keys(a, [[0, 0], [0.4, -0.35], [0.58, 0.55], [1, 0]]);
        break;
      case 'claw':
        R(A[1], keys(a, [[0, 0], [0.3, -2.2], [0.5, -0.4], [1, 0]]), 0, keys(a, [[0, 0], [0.3, -0.5], [0.5, 0.5], [1, 0]])); R(F[1], keys(a, [[0, -0.2], [0.3, -1.3], [0.5, -0.3], [1, -0.2]]));
        R(A[0], keys(a, [[0, 0], [0.5, -2.0], [0.7, -0.4], [1, 0]]), 0, keys(a, [[0, 0], [0.5, 0.5], [0.7, -0.5], [1, 0]])); R(F[0], keys(a, [[0, -0.2], [0.5, -1.3], [0.7, -0.3], [1, -0.2]]));
        ty = keys(a, [[0, 0], [0.3, -0.35], [0.5, 0.3], [0.7, -0.3], [1, 0]]); tx = 0.15;
        break;
      default: // swing
        R(A[1], keys(a, [[0, 0], [0.38, -2.6], [0.56, 0.45], [1, 0]]), 0, keys(a, [[0, 0], [0.38, -0.35], [0.56, 0.3], [1, 0]]));
        R(F[1], keys(a, [[0, -0.2], [0.38, -1.4], [0.56, -0.08], [1, -0.2]]));
        R(A[0], keys(a, [[0, 0], [0.38, 0.3], [0.56, -0.5], [1, 0]])); R(F[0], -0.9);
        ty = keys(a, [[0, 0], [0.38, -0.45], [0.56, 0.4], [1, 0]]); tx = keys(a, [[0, 0], [0.38, -0.12], [0.56, 0.28], [1, 0]]);
    }
  }
  R(rig.torso, tx, ty, tz);
  return atk >= 0;
}

export function flap(rig, c, rate = c.flying ? 9 : 2.2, amp = c.flying ? 0.55 : 0.08) {
  const W = rig.wings || [], T = rig.wingtips || [];
  const f = Math.sin(c.t * rate + c.phase);
  W.forEach((w, i) => { const sg = (w.userData.rest?.[3] ?? (i ? -1 : 1)) >= 0 ? 1 : -1; R(w, 0, 0, sg * (f * amp + (c.flying ? 0.1 : 0))); });
  T.forEach((w, i) => { const sg = (w.userData.rest?.[3] ?? (i ? -1 : 1)) >= 0 ? 1 : -1; R(w, 0, 0, sg * Math.sin(c.t * rate + c.phase - 0.9) * amp * 0.8); });
}
export function wagTail(rig, c, amp = 0.18) {
  (rig.tail || []).forEach((s, i) => R(s, Math.sin(c.t * 2.2 + c.phase - i * 0.5) * amp * 0.25, Math.sin(c.t * (c.moving ? 6 : 2.6) + c.phase - i * 0.7) * amp));
}
/** fall over and sink. side = true topples sideways (four-legged things) */
export function die(inner, c, side = false) {
  if (c.dead <= 0) { inner.rotation.x = 0; inner.rotation.z = 0; return false; }
  const f = Math.min(1, c.dead * 2);
  if (side) inner.rotation.z = ease(f) * Math.PI / 2; else inner.rotation.x = -ease(f) * Math.PI / 2;
  inner.position.y = -Math.max(0, c.dead - 0.5) * 0.8 * (inner.scale.y || 1);
  return true;
}

export function biped(rig, inner, c) {
  const ph = c.t * 9.5 + c.phase, k = c.moving && !c.flying ? 1 : 0;
  const L = rig.legs || [], S = rig.shins || [];
  for (let i = 0; i < 2; i++) {
    const sg = i === 0 ? 1 : -1;
    if (c.flying) { R(L[i], 0.35 + Math.sin(c.t * 2 + i) * 0.05); R(S[i], 0.7); continue; }
    R(L[i], -Math.sin(ph) * sg * 0.62 * k);
    R(S[i], k * (0.12 + Math.max(0, Math.cos(ph) * sg) * 1.0));
  }
  upperBody(rig, c);
  flap(rig, c);
  wagTail(rig, c);
  inner.position.y = k * Math.abs(Math.sin(ph)) * 0.03 * (inner.scale.y || 1);
  die(inner, c);
}

export function quad(rig, inner, c) {
  const ph = c.t * 9 + c.phase, k = c.moving && !c.flying ? 1 : 0;
  const L = rig.legs || [], S = rig.shins || [];
  for (let i = 0; i < L.length; i++) {
    const sg = i === 0 || i === 3 ? 1 : -1; // diagonal pairs move together
    if (c.flying) { R(L[i], i < 2 ? -0.5 : 0.6); R(S[i], 0.9); continue; }
    R(L[i], -Math.sin(ph) * sg * 0.5 * k);
    R(S[i], k * Math.max(0, Math.cos(ph) * sg) * 0.8);
  }
  const idle = Math.sin(c.t * 1.4 + c.phase);
  let hx = idle * 0.04 + k * Math.sin(ph * 2) * 0.04, lunge = 0, jaw = 0;
  if (c.atk >= 0 && !(rig.arms && rig.arms.length)) {
    hx = keys(c.atk, [[0, 0], [0.35, -0.5], [0.55, 0.45], [1, 0]]);
    lunge = keys(c.atk, [[0, 0], [0.35, -0.08], [0.55, 0.22], [1, 0]]);
    jaw = keys(c.atk, [[0, 0], [0.35, 0.7], [0.58, 0.05], [1, 0]]);
  }
  R(rig.neck, hx * 0.6); R(rig.head, hx * (rig.neck ? 0.5 : 1)); R(rig.jaw, jaw);
  if (rig.arms && rig.arms.length) upperBody(rig, c); else R(rig.torso, 0, Math.sin(ph) * 0.03 * k);
  flap(rig, c);
  wagTail(rig, c);
  inner.position.y = (k * Math.abs(Math.sin(ph)) * 0.025) * (inner.scale.y || 1);
  inner.position.z = lunge * (inner.scale.z || 1);
  die(inner, c, true);
}

export function spider(rig, inner, c) {
  const ph = c.t * 13 + c.phase, k = c.moving ? 1 : 0;
  (rig.legs || []).forEach((l, i) => {
    const sideSign = (l.userData.rest?.[3] ?? 0) >= 0 ? 1 : -1, a = ph + (i % 2) * Math.PI + Math.floor(i / 2) * 0.4;
    let lift = k * Math.max(0, Math.cos(a)) * 0.22, sweep = k * Math.sin(a) * 0.24;
    if (c.atk >= 0 && (i % 4) === 0) { lift = keys(c.atk, [[0, 0], [0.4, 0.9], [0.58, -0.2], [1, 0]]); sweep = 0; }
    R(l, 0, sweep * sideSign, lift * sideSign);
  });
  R(rig.head, c.atk >= 0 ? keys(c.atk, [[0, 0], [0.4, -0.3], [0.58, 0.3], [1, 0]]) : 0);
  inner.position.y = (Math.sin(c.t * 3 + c.phase) * 0.01 + (c.atk >= 0 ? keys(c.atk, [[0, 0], [0.4, 0.06], [0.58, -0.03], [1, 0]]) : 0)) * (inner.scale.y || 1);
  inner.position.z = (c.atk >= 0 ? keys(c.atk, [[0, 0], [0.4, -0.05], [0.58, 0.2], [1, 0]]) : 0) * (inner.scale.z || 1);
  if (c.dead > 0) { inner.rotation.z = Math.min(1, c.dead * 2) * Math.PI; inner.position.y = (0.25 - Math.max(0, c.dead - 0.5) * 0.8) * (inner.scale.y || 1); } else inner.rotation.z = 0;
}

export function float(rig, inner, c) {
  const bob = Math.sin(c.t * 3 + c.phase) * 0.06;
  P(rig.core, 0, bob, 0);
  if (rig.core) rig.core.scale.setScalar(1 + (c.atk >= 0 ? Math.sin(c.atk * Math.PI) * 0.35 : Math.sin(c.t * 5 + c.phase) * 0.03));
  (rig.shards || []).forEach((s, i) => R(s, Math.sin(c.t * 1.3 + i) * 0.3, c.t * (1.4 + i * 0.25) + c.phase + i * 2.1, Math.cos(c.t * 1.1 + i) * 0.3));
  if (rig.arms) upperBody(rig, c);
  flap(rig, { ...c, flying: true }, 12, 0.6);
  wagTail(rig, c);
  if (c.dead > 0) { const f = Math.min(1, c.dead); inner.position.y = -f * 0.6 * (inner.scale.y || 1); inner.rotation.z = f * 1.2; } else { inner.position.y = 0; inner.rotation.z = 0; }
}

export function ram(rig, inner, c) {
  P(rig.log, 0, 0, c.atk >= 0 ? keys(c.atk, [[0, 0], [0.45, -0.3], [0.6, 0.4], [1, 0]]) : Math.sin(c.t * 1.5 + c.phase) * 0.02);
  if (c.moving) (rig.wheels || []).forEach((w) => R(w, c.t * 5));
  if (c.dead > 0) { inner.rotation.z = Math.min(1, c.dead) * 0.5; inner.position.y = -Math.max(0, c.dead - 0.5) * 0.4 * (inner.scale.y || 1); } else inner.rotation.z = 0;
}

const BASE = { R, P, keys, upperBody, flap, wagTail, die, biped, quad, spider, float, ram };
Object.assign(ANIMATORS, { biped, quad, spider, float, ram });
/** the shared helpers every animator is handed (for composite models that drive other bodies' animators) */
export const ANIM_BASE = BASE;
/** run the animator registered for `kind` (biped if none) on a rig: lets one model drive another body's motion */
export function runAnimator(kind, rig, inner, ctx) { (ANIMATORS[kind] || biped)(rig, inner, ctx, BASE); }

/** ctx: { t (s), moving, atk (-1 or 0..1), dead (0 or 0..1.5), phase, flying } */
export function animateRig(model, ctx) {
  const rig = model.userData.rig, inner = model.userData.inner;
  (ANIMATORS[rig.kind] || biped)(rig, inner, ctx, BASE);
  if (ctx.fx) applyFx(rig, inner, ctx);
}

// Layered on top of every family's own animation:
//  fx.death = { style: 'back' | 'front' | 'side' | 'kneel' | 'blast', seed }  how this one falls
//  fx.duel  = { role: 'a' | 'd', kind: 'parry' | 'hit' | 'kill', k: 0..1 }     a matched exchange with an opponent
const bell = (k) => Math.sin(Math.max(0, Math.min(1, k)) * Math.PI);
function applyFx(rig, inner, c) {
  const fx = c.fx;
  if (c.dead > 0 && fx.death) {
    const d = fx.death, s = d.seed | 0, e = ease(Math.min(1, c.dead * 2));
    const rx = inner.rotation.x, rz = inner.rotation.z, backFaller = Math.abs(rx) >= Math.abs(rz);
    if (!backFaller) inner.rotation.z = rz * (s & 1 ? 1 : -1); // four-legged and long bodies roll onto either flank
    else if (d.style === 'front') inner.rotation.x = Math.abs(rx) * 0.97; // on its face
    else if (d.style === 'side') { inner.rotation.x = 0; inner.rotation.z = Math.abs(rx) * (s & 1 ? 1 : -1); }
    else if (d.style === 'kneel') {
      // sinks to the knees, hangs there, then pitches forward
      const k1 = ease(Math.min(1, c.dead * 5)), k2 = ease(Math.max(0, Math.min(1, (c.dead * 2 - 0.45) / 0.55)));
      inner.rotation.x = k2 * Math.PI / 2 * 0.97;
      const kneel = k1 * (1 - k2);
      for (const sh of rig.shins || []) sh.rotation.x += 1.5 * kneel;
      for (const lg of rig.legs || []) lg.rotation.x -= 0.35 * kneel;
      inner.position.y -= 0.2 * kneel * (inner.scale.y || 1);
      if (rig.head) rig.head.rotation.x += 0.5 * k1;
    } else if (d.style === 'blast') inner.rotation.x = rx - Math.sin(Math.min(1, c.dead * 2) * Math.PI) * 0.8; // tumbles through the air
    // no two bodies lie alike: limbs sprawl by seed
    const sp = (i, amp) => (((s >> (i * 2)) & 3) - 1.5) * amp * e;
    (rig.arms || []).forEach((a, i) => { if (i < 2) { a.rotation.z += sp(i, 0.45); a.rotation.x += sp(i + 2, 0.35); } });
    (rig.forearms || []).forEach((a, i) => { if (i < 2) a.rotation.x += sp(i + 4, 0.4) - 0.2 * e; });
    if (backFaller) (rig.legs || []).forEach((a, i) => { if (i < 2) { a.rotation.z += sp(i + 6, 0.22); a.rotation.x += sp(i + 8, 0.3); } });
    if (rig.head) rig.head.rotation.y += sp(10, 0.5);
    return;
  }
  if (fx.duel && c.dead <= 0) {
    const d = fx.duel, w = bell(d.k), sc = inner.scale.z || 1;
    if (d.role === 'a') {
      // the attacker steps into the blow; a killing stroke is driven right through
      inner.position.z += (d.kind === 'kill' ? 0.3 : 0.2) * w * sc;
      if (rig.torso) { rig.torso.rotation.x += (d.kind === 'kill' ? 0.3 : 0.16) * w; rig.torso.rotation.y += (d.kind === 'kill' ? -0.35 : -0.15) * w; }
    } else if (d.kind === 'parry') {
      // the defender gives a half step and throws the guard up
      inner.position.z -= 0.12 * w * sc;
      const guard = rig.arms && (rig.shield ? rig.arms[0] : rig.arms[1]);
      if (guard) { guard.rotation.x -= 1.1 * w; guard.rotation.z += (rig.shield ? 0.5 : -0.3) * w; }
      if (rig.torso) rig.torso.rotation.x -= 0.12 * w;
    } else {
      // struck: the body jerks back from the blow
      const late = bell(Math.max(0, d.k - 0.35) / 0.65);
      inner.position.z -= 0.2 * late * sc;
      if (rig.torso) { rig.torso.rotation.x -= 0.4 * late; rig.torso.rotation.y += 0.25 * late; }
      if (rig.head) rig.head.rotation.x -= 0.35 * late;
    }
  }
}
