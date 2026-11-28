// The flying machines and conveyances, sculpted (rotors, hulls, envelopes and wings in the prim vocabulary of
// src/render/sculpt.js) in each faction's materials (air/kit.js lookOf). Every builder returns
//   { desc: { kind: 'air.craft', nodes, ... }, k, crew: [{ parent, at, pose, yaw, s }], props: { parent, at, s, hw, bow } }
// in one authoring space (Y up, facing +Z, the lowest skid on y = 0, a man 1.0 tall). Rig keys the craft animator
// (air/anim.js) drives: body (the hull), rotors (spin about Y), props (screws, spin about Z), wings / wingtips (flap
// about Z), sway (hangs and swings), flames (flicker), core (an envelope that breathes and collapses), guns (recoil),
// tails (streamers), spin (rings that turn). crew slots are filled with the faction's baked soldiers (air/index.js).
import { S, H, rgb } from '../sculpt.js';
import { add3, sub3, mul3, lerp, clamp, num, mix, tone, node, finishes } from './kit.js';

const TAU = Math.PI * 2;
/** an aerofoil outline (span along +X, chord along Y), for rotor blades and screws */
const blade = (len, w, root = 0.04) => [[root, -w * 0.4], [len * 0.3, -w * 0.55], [len * 0.92, -w * 0.45], [len, 0], [len * 0.92, w * 0.42], [len * 0.3, w * 0.5], [root, w * 0.35]];

/** a rotor hub with n blades in the XZ plane about the origin (hard pieces) */
function rotorParts(L, R, n = 3, w = 0.09, wood = !L.grim) {
  const F = finishes(L), out = [];
  out.push(F.metal(H.lathe([[0.001, -0.06], [0.05, -0.05], [0.06, 0], [0.04, 0.03], [0.015, 0.07], [0.001, 0.08]], 16)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360;
    const b = H.extrude(blade(R, w), 0.014, 0.003).rot(90, 0, 0).rot(0, a, 0);
    out.push(wood ? b.color(L.wood).pbr(0.6).shade((x, y, z) => { const r = Math.hypot(x, z); return r > R * 0.86 ? rgb(L.cloth) : r > R * 0.8 ? rgb(L.metal) : null; }) : b.color(L.grim ? 0x3a3438 : L.metal).pbr(0.4, 0.6).shade((x, y, z) => (Math.hypot(x, z) > R * 0.88 ? rgb(L.accent) : null)));
    out.push(F.metal(H.box(0.12, 0.03, 0.05, 0.008)).at(0.1, 0, 0).rot(0, a, 0));
  }
  return out;
}
/** a pusher screw about the origin, blades in the XY plane (turns about Z) */
function screwParts(L, R, n = 3) {
  const F = finishes(L), out = [];
  out.push(F.metal(H.lathe([[0.001, -0.02], [0.04, -0.01], [0.035, 0.05], [0.001, 0.09]], 12)).rot(90, 0, 0));
  for (let i = 0; i < n; i++) out.push(H.extrude(blade(R, R * 0.35, 0.02), 0.012, 0.003).rot(0, 18, 0).rot(0, 0, (i / n) * 360).color(L.grim ? 0x3a3438 : L.wood).pbr(0.6, L.grim ? 0.5 : 0));
  return out;
}
/** rivets along a ring of radius r about the Z axis at z */
function rivetRing(out, L, r, z, n, y = 0) { for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push(H.sphere(0.009, 6).at(Math.cos(a) * r, y + Math.sin(a) * r, z).color(L.metal).pbr(0.35, L.shine).lod(1)); } }
/** a painted band round a body lying along Z (a slab that recolours the surface it cuts) */
const bandZ = (z, w, col, y = 0, raise = 0.002) => S.box(3, 3, w, 0.003).at(0, y, z).color(col).pbr(0.35, 0.6).paint(0.004, raise);
/** engraved plank seams on a hull (horizontal slabs) */
const seamsY = (ys) => ys.map((y) => S.box(4, 0.006, 4, 0.001).at(0, y, 0).color(0x2a1e14).paint(0.002, -0.0015));

/** a cloth fin / vane: an outline in XY extruded thin, in the cloth colour with a trim edge */
function vane(L, pts, d = 0.012, col = L.cloth) { return H.extrude(pts, d, 0.003).color(col).pbr(0.8).shade((x, y) => (y < pts.reduce((m, p) => Math.min(m, p[1]), 9) + 0.025 ? rgb(L.trim) : null)); }
/** a gored envelope along Z: radius r, half-length len; gores alternate cloth / cloth2, seams and bands in trim */
function envelopePrims(L, r, len, y, o = {}) {
  const out = [];
  out.push(S.ellipsoid(r, r * (o.flat || 1), len).at(0, y, 0).color(L.cloth).bump(0.0018, 20, 'noise').tint(0.06, 6).pbr(0.75));
  for (let i = 0; i < 4; i++) out.push(S.box(r * 0.42, r * 2.6, len * 2.4, 0.01).rot(0, 0, 22.5 + i * 45).at(0, y, 0).color(L.cloth2).pbr(0.75).paint(0.01));
  for (let i = 0; i < 8; i++) out.push(S.box(0.012, r * 2.6, len * 2.4, 0.002).rot(0, 0, i * 22.5).at(0, y, 0).color(L.trim).pbr(0.5, 0.4).paint(0.003, 0.002));
  for (const z of o.bands || [-0.55, 0.55]) out.push(bandZ(z * len, 0.05, L.trim, y));
  return out;
}
/** a boat-shaped hull open on top: half-length len, half-beam b, depth d; top of the gunwale at y */
function hullPrims(L, len, b, d, y, F, col = L.wood) {
  const out = [];
  out.push(F.wood(S.ellipsoid(b, d * 1.6, len), col).at(0, y, 0));
  out.push(S.box(b * 3, d * 2, len * 3, 0.01).at(0, y + d, 0).cut(0.006));          // sheer the top flat
  out.push(S.ellipsoid(b * 0.84, d * 1.4, len * 0.9).at(0, y + 0.01, 0).cut(0.01).color(tone(col, -0.12)));
  out.push(...seamsY([y - d * 0.25, y - d * 0.55, y - d * 0.85, y - d * 1.15]).map((q) => q.at(0, 0, 0)));
  out.push(S.capsule([0, y - d * 1.5, -len * 0.8], [0, y - d * 1.5, len * 0.8], 0.025, 0.025).color(tone(col, -0.15)).pbr(0.8).blend(0.03));   // keel
  return out;
}
/** a gunwale rail along the sheer of a hull made by hullPrims */
function gunwale(L, len, b, y, r = 0.02, col = L.metal) {
  const pts = [];
  for (let i = 0; i <= 40; i++) { const a = (i / 40) * TAU; pts.push([Math.sin(a) * b * 0.99, y, Math.cos(a) * len * 0.99]); }
  return H.tube(pts, r, 120, 6, true).color(col).pbr(0.4, L.shine * 0.7);
}
const seat = (parent, at, yaw = 0, s = 1) => ({ parent, at, pose: 'seat', yaw, s });
const stand = (parent, at, pose = 'stand', yaw = 0, s = 1) => ({ parent, at, pose, yaw, s });

// ================================================================================================ gyrocopter
function gyro(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const BY = 0.52, body = node('body', 'root', [0, BY, 0], { rig: 'body', detail: 1.05 });
  const shell = L.grim ? 0x3a3236 : L.rough ? mix(L.wood, 0x6a5a48, 0.4) : L.metal;
  const P = body.prims;
  P.push(F.metal(S.ellipsoid(0.2, 0.19, 0.5), shell).at(0, 0, 0.02).bump(0.0012, 30, 'noise'));
  P.push(F.metal(S.ellipsoid(0.12, 0.12, 0.14), L.grim ? 0x2a2428 : tone(L.metal, -0.05)).at(0, -0.01, 0.48).blend(0.04));
  P.push(S.ellipsoid(0.15, 0.17, 0.24).at(0, 0.16, -0.02).cut(0.012).color(0x2a2018));       // the open cockpit
  P.push(F.leather(S.ellipsoid(0.13, 0.05, 0.16)).at(0, -0.02, -0.05).blend(0.006));          // the seat cushion
  P.push(bandZ(0.3, 0.035, L.trim), bandZ(-0.25, 0.035, L.trim), S.box(0.02, 0.5, 1.2, 0.003).at(0, 0, 0).color(L.cloth).paint(0.03));   // a stripe down the spine
  P.push(F.metal(S.cyl(0.11, 0.26, 0.03).rot(90, 0, 0), L.grim ? 0x2a2a2e : 0x5a5a60).at(0, 0.08, -0.36).blend(0.03));   // the engine
  for (const z of [-0.29, -0.34, -0.39, -0.44]) P.push(S.torus(0.118, 0.009).rot(90, 0, 0).at(0, 0.08, z).color(0x3a3a3e).pbr(0.45, 0.7).blend(0.003));
  const H0 = body.hard;
  rivetRing(H0, L, 0.185, 0.3, 14); rivetRing(H0, L, 0.19, -0.25, 14);
  H0.push(H.tube([[0.08, 0.14, -0.42], [0.1, 0.26, -0.5], [0.08, 0.36, -0.62]], 0.022, 12, 6).color(0x2a2a2e).pbr(0.5, 0.6), H.tube([[-0.08, 0.14, -0.42], [-0.1, 0.26, -0.5], [-0.08, 0.36, -0.62]], 0.022, 12, 6).color(0x2a2a2e).pbr(0.5, 0.6));
  H0.push(H.sphere(0.03, 10).at(0, 0.0, -0.5).color(L.glow).glow(1.2).lod(1));
  // tail boom, fin and tailplane in the cloth, with the trim along their edges
  H0.push(F.wood(H.tube([[0, 0.02, -0.45], [0, 0.06, -0.8], [0, 0.12, -1.12]], [0.04, 0.03, 0.02], 16, 8)));
  H0.push(vane(L, [[0.12, -0.02], [0.04, 0.24], [-0.12, 0.3], [-0.18, 0.24], [-0.12, -0.04]]).rot(0, 90, 0).at(0, 0.12, -1.06));
  for (const sx of [1, -1]) H0.push(vane(L, [[0.08, 0], [0.02, 0.2], [-0.08, 0.22], [-0.1, 0]], 0.01, L.cloth2).rot(90, 0, 0).rot(0, sx > 0 ? 90 : -90, 0).at(0, 0.12, -1.06));
  // mast and its stays
  H0.push(F.metal(H.cyl(0.024, 0.032, 0.62, 12)).at(0, 0.45, -0.16));
  for (const [x, z] of [[0.15, 0.2], [-0.15, 0.2], [0, -0.38]]) H0.push(H.tube([[x, 0.12, z], [0, 0.7, -0.16]], 0.006, 4, 4).color(0x3a3a3e).pbr(0.5, 0.6).lod(2));
  // skids
  for (const sx of [1, -1]) {
    H0.push(F.wood(H.tube([[sx * 0.24, -BY + 0.03, 0.42], [sx * 0.25, -BY + 0.02, 0.1], [sx * 0.25, -BY + 0.02, -0.35], [sx * 0.23, -BY + 0.08, -0.5]], 0.018, 20, 6)));
    for (const z of [0.18, -0.24]) H0.push(H.tube([[sx * 0.08, -0.12, z], [sx * 0.25, -BY + 0.03, z]], 0.012, 4, 5).color(0x3a3a3e).pbr(0.5, 0.6));
  }
  nodes.push(body);
  const rot = node('rotor', 'body', [0, 0.78, -0.16], { rig: 'rotors', detail: 1 }); rot.hard.push(...rotorParts(L, 1.05)); nodes.push(rot);
  const scr = node('screw', 'body', [0, 0.08, -0.53], { rig: 'props', detail: 1 }); scr.hard.push(...screwParts(L, 0.26)); nodes.push(scr);
  const gun = node('gun', 'body', [0, -0.12, 0.38], { rig: 'guns', detail: 1.2 });
  gun.hard.push(F.metal(H.cyl(0.022, 0.026, 0.42, 12)).rot(90, 0, 0).at(0, 0, 0.18), F.metal(H.cyl(0.032, 0.032, 0.04, 12)).rot(90, 0, 0).at(0, 0, 0.38), H.cyl(0.06, 0.06, 0.05, 16).rot(0, 0, 90).at(0.05, 0.02, 0).color(0x3a3a3e).pbr(0.45, 0.7));
  nodes.push(gun);
  return { desc: { kind: 'air.craft', attack: 'shoot', nodes }, k: 1, crew: [seat('body', [0, -0.0, -0.04])], props: { parent: 'body', at: [0, -0.2, -0.02], s: 1.2, hw: 0.2, bow: [0, 0.08, 0.5] } };
}

// ================================================================================================ twin-rotor heavy
function gyrobomber(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const BY = 0.62, body = node('body', 'root', [0, BY, 0], { rig: 'body', detail: 0.72 });
  const shell = L.grim ? 0x3a3236 : L.rough ? mix(L.wood, 0x6a5a48, 0.4) : L.metal, P = body.prims, H0 = body.hard;
  P.push(F.metal(S.ellipsoid(0.3, 0.27, 0.95), shell).bump(0.0012, 26, 'noise'));
  P.push(F.wood(S.ellipsoid(0.31, 0.12, 0.9)).at(0, -0.14, 0).blend(0.03));                   // a planked belly
  P.push(S.ellipsoid(0.2, 0.2, 0.22).at(0, 0.2, 0.55).cut(0.012).color(0x2a2018));            // pilot's well
  P.push(S.ellipsoid(0.22, 0.2, 0.26).at(0, 0.2, -0.32).cut(0.012).color(0x2a2018));          // gunner's well
  P.push(F.metal(S.ellipsoid(0.17, 0.17, 0.2), tone(shell, -0.06)).at(0, 0.0, 0.9).blend(0.05));
  for (const z of [0.72, 0.2, -0.15, -0.6]) { P.push(bandZ(z, 0.04, L.trim)); rivetRing(H0, L, 0.28 - Math.abs(z) * 0.08, z, 16); }
  P.push(S.box(0.03, 0.6, 2.2, 0.003).at(0, 0.1, 0).color(L.cloth).paint(0.03));
  // side engines on stub wings, each with a screw
  for (const sx of [1, -1]) {
    H0.push(F.wood(H.box(0.5, 0.035, 0.24, 0.01)).at(sx * 0.45, 0.02, 0.02));
    P.push(F.metal(S.capsule([sx * 0.62, 0.02, 0.18], [sx * 0.62, 0.02, -0.22], 0.085, 0.07), 0x4a4a50).blend(0.01));
    for (const z of [0.1, 0.0, -0.1]) P.push(S.torus(0.09, 0.008).rot(90, 0, 0).at(sx * 0.62, 0.02, z).color(0x2e2e32).pbr(0.45, 0.7).blend(0.003));
    H0.push(H.tube([[sx * 0.62, 0.1, -0.12], [sx * 0.62, 0.24, -0.2], [sx * 0.6, 0.3, -0.3]], 0.018, 8, 6).color(0x2a2a2e).pbr(0.5, 0.6));
  }
  // tail with twin fins
  H0.push(F.wood(H.tube([[0, 0.05, -0.85], [0, 0.12, -1.35]], [0.06, 0.035], 10, 8)));
  for (const sx of [1, -1]) H0.push(vane(L, [[0.12, -0.02], [0.04, 0.26], [-0.12, 0.3], [-0.16, 0.22], [-0.1, -0.04]]).rot(0, 90, 0).at(sx * 0.2, 0.14, -1.3));
  H0.push(vane(L, [[0.04, 0], [0.04, 0.2], [-0.04, 0.2], [-0.04, 0]], 0.012, L.cloth2).rot(90, 0, 0).scale(5, 1, 1).at(0, 0.14, -1.3));
  // masts fore and aft
  for (const z of [0.36, -0.68]) { H0.push(F.metal(H.cyl(0.03, 0.04, 0.62, 12)).at(0, 0.5, z)); for (const sx of [1, -1]) H0.push(H.tube([[sx * 0.2, 0.15, z + 0.12], [0, 0.78, z]], 0.007, 4, 4).color(0x3a3a3e).pbr(0.5, 0.6).lod(2)); }
  // skids and a bomb-aimer's window
  for (const sx of [1, -1]) {
    H0.push(F.wood(H.tube([[sx * 0.3, -BY + 0.03, 0.8], [sx * 0.32, -BY + 0.02, 0.2], [sx * 0.32, -BY + 0.02, -0.6], [sx * 0.29, -BY + 0.08, -0.8]], 0.022, 24, 6)));
    for (const z of [0.5, -0.45]) H0.push(H.tube([[sx * 0.12, -0.2, z], [sx * 0.32, -BY + 0.03, z]], 0.014, 4, 5).color(0x3a3a3e).pbr(0.5, 0.6));
  }
  nodes.push(body);
  for (const [i, z] of [[0, 0.36], [1, -0.68]]) { const r = node(`rotor${i}`, 'body', [0, 0.82 + i * 0.08, z], { rig: 'rotors', detail: 0.95 }); r.hard.push(...rotorParts(L, 1.05, i ? 3 : 3, 0.1)); nodes.push(r); }
  for (const sx of [1, -1]) { const s = node(`screw${sx > 0 ? 'L' : 'R'}`, 'body', [sx * 0.62, 0.02, 0.3], { rig: 'props', detail: 1 }); s.hard.push(...screwParts(L, 0.2)); nodes.push(s); }
  const gun = node('gun', 'body', [0, 0.32, -0.12], { rig: 'guns', detail: 1.2 });
  gun.hard.push(F.metal(H.cyl(0.03, 0.035, 0.5, 12)).rot(90, 0, 0).at(0, 0, -0.2), F.metal(H.box(0.12, 0.08, 0.14, 0.01)).at(0, -0.04, 0), H.cyl(0.012, 0.012, 0.2, 6).at(0, -0.14, 0).color(0x3a3a3e));
  nodes.push(gun);
  return { desc: { kind: 'air.craft', attack: 'shoot', mass: 1.4, nodes }, k: 1.05, crew: [seat('body', [0, 0.02, 0.52]), stand('body', [0, -0.12, -0.36], 'kneel', 180)],
    props: { parent: 'body', at: [0, -0.3, -0.05], s: 1.5, hw: 0.32, bow: [0, 0.1, 0.95] }, defaults: { bombs: 4 } };
}

// ================================================================================================ hang-glider
function glider(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const wing = node('body', 'root', [0, 0.95, 0], { rig: 'body', detail: 1 });
  const N = [0, 0.02, 0.75], K = [0, 0.04, -0.6], tip = (sx) => [sx * 1.3, 0.12, -0.42];
  const frame = L.grim ? 0xd8cfb4 : L.wood;
  wing.hard.push(F.wood(H.tube([N, K], 0.018, 8, 6), frame));
  for (const sx of [1, -1]) {
    const T = tip(sx);
    wing.hard.push(F.wood(H.tube([N, [sx * 0.6, 0.08, 0.2], T], [0.02, 0.016, 0.01], 16, 6), frame));
    // the sail: a bellied sheet between keel and leading edge, three panels each with a batten
    const sail = H.sheet(1, 1, 18, 14, null);
    const p = sail.geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5;
      const keel = lerp3(N, K, u), edge = lerp3(N, T, u * (1 - 0.12 * Math.sin(v * Math.PI)));
      const q = lerp3(keel, edge, v);
      p.setXYZ(i, q[0], q[1] + 0.07 * Math.sin(Math.PI * v) * Math.min(1, u * 1.5), q[2]);
    }
    sail.geo.computeVertexNormals();
    wing.hard.push(sail.color(L.cloth).pbr(0.8).shade((x, y, z) => { const v = Math.abs(x) / 1.3, b = Math.floor(v * 3); return Math.abs(v * 3 - Math.round(v * 3)) < 0.04 ? rgb(L.trim) : b % 2 ? rgb(L.cloth2) : null; }));
    for (let k = 1; k < 3; k++) { const b = k / 3; wing.hard.push(F.wood(H.tube([lerp3(N, T, b * 0.3), lerp3(K, T, b)], 0.007, 4, 4), frame).lod(1)); }
    wing.hard.push(F.wood(H.tube([[0, 0.03, 0.12], [sx * 0.3, -0.48, 0.18]], 0.012, 4, 6), frame));
    wing.hard.push(H.tube([[sx * 0.3, -0.48, 0.18], T], 0.003, 6, 3).color(0x3a3020).lod(1), H.tube([[0, 0.25, 0.05], T], 0.003, 6, 3).color(0x3a3020).lod(1));
  }
  wing.hard.push(F.wood(H.tube([[-0.3, -0.48, 0.18], [0.3, -0.48, 0.18]], 0.014, 4, 6), frame), F.wood(H.cyl(0.012, 0.012, 0.26, 6), frame).at(0, 0.15, 0.05));
  wing.hard.push(vane(L, [[0.1, 0], [-0.04, 0.2], [-0.2, 0.26], [-0.18, 0.04]], 0.01, L.cloth2).rot(0, 90, 0).at(0, 0.04, -0.6));
  nodes.push(wing);
  const tails = [];
  for (let i = 0; i < 3; i++) { const n = node(`streamer${i}`, i ? `streamer${i - 1}` : 'body', i ? [0, 0, -0.18] : [0, 0.02, -0.62], { rig: 'tails', detail: 0.8 }); n.hard.push(H.sheet(0.06, 0.18, 2, 4).rot(-90, 0, 0).rot(0, 90, 0).at(0, 0, -0.09).color(i % 2 ? L.cloth2 : L.trim).pbr(0.8)); nodes.push(n); tails.push(n); }
  return { desc: { kind: 'air.craft', attack: 'shoot', mass: 0.8, nodes }, k: 1, crew: [{ parent: 'body', at: [0, -0.64, -0.62], pose: 'prone', yaw: 0, s: 1 }], props: { parent: 'body', at: [0, -0.62, 0.0], s: 1.0, hw: 0.2, bow: [0, -0.5, 0.35] } };
}
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ================================================================================================ ornithopter
function ornithopter(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const BY = 0.5, body = node('body', 'root', [0, BY, 0], { rig: 'body', detail: 0.95 });
  const P = body.prims, H0 = body.hard;
  P.push(...hullPrims(L, 0.85, 0.3, 0.14, 0.08, F, L.grim ? 0x2e2628 : L.wood));
  P.push(F.metal(S.ellipsoid(0.12, 0.1, 0.18), L.metal).at(0, 0.0, 0.86).blend(0.04));                // a beaked prow
  P.push(F.metal(S.cone(0.06, 0.0, 0.2, 0.01)).rot(90, 0, 0).at(0, 0.0, 1.02).blend(0.01));
  H0.push(gunwale(L, 0.85, 0.3, 0.08));
  // the engine house amidships: a boxed clockwork with a crank to each wing
  P.push(F.metal(S.box(0.32, 0.22, 0.3, 0.03), L.grim ? 0x3a3236 : tone(L.metal, -0.1)).at(0, 0.12, 0.05));
  P.push(S.cyl(0.07, 0.25, 0.01).rot(0, 0, 90).at(0, 0.18, 0.05).color(L.metal).pbr(0.3, L.shine).blend(0.01));
  for (let i = 0; i < 6; i++) H0.push(H.sphere(0.01, 6).at(-0.16 + i * 0.064, 0.23, 0.2).color(L.metal).pbr(0.35, L.shine).lod(1));
  // a tail fan of slats
  for (let i = -3; i <= 3; i++) H0.push(H.extrude([[0, 0], [0.04, 0.35], [-0.04, 0.35]], 0.008, 0.002).rot(-90, 0, 0).rot(0, i * 12, 0).at(0, 0.05, -0.8).color(i % 2 ? L.cloth : L.cloth2).pbr(0.8));
  // landing legs
  for (const sx of [1, -1]) for (const z of [0.4, -0.45]) { H0.push(F.wood(H.tube([[sx * 0.15, -0.1, z], [sx * 0.26, -BY + 0.05, z + 0.05]], 0.018, 4, 6))); H0.push(F.metal(H.sphere(0.035, 10)).at(sx * 0.26, -BY + 0.035, z + 0.05)); }
  nodes.push(body);
  // two pairs of wings, each a jointed arm with ribs and a stretched membrane
  const wingPart = (n, sx, span, ch, col) => {
    const pts = [[0, 0, 0], [sx * span * 0.45, 0.05, 0.02], [sx * span, 0.0, -0.05]];
    n.hard.push(F.wood(H.tube(pts, [0.03, 0.02, 0.008], 16, 8), L.grim ? 0xd8cfb4 : L.wood));
    const g = H.sheet(1, 1, 16, 6), p = g.geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5; const sc = Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.55); p.setXYZ(i, sx * u * span, -0.01 + 0.02 * Math.sin(v * Math.PI), 0.02 - v * ch * (0.35 + 0.65 * sc) + 0.03 * Math.abs(Math.sin(u * 9)) * v); }
    g.geo.computeVertexNormals();
    n.hard.push(g.color(col).pbr(0.75).shade((x, y, z) => (Math.abs(Math.sin(Math.abs(x) / span * 6 * Math.PI)) < 0.06 ? rgb(tone(col, -0.2)) : null)));
    for (let k = 1; k < 6; k++) n.hard.push(F.wood(H.tube([[sx * span * k / 6, 0.01, 0], [sx * span * k / 6 * 1.04, 0.0, -ch * 0.8 * Math.sin(Math.min(1, k / 6 * 1.15) * Math.PI * 0.55) - 0.02]], 0.006, 4, 4), L.grim ? 0xd8cfb4 : L.wood).lod(1));
  };
  for (const [j, z, span, ch] of [[0, 0.3, 1.2, 0.42], [1, -0.32, 0.95, 0.34]]) for (const sx of [1, -1]) {
    const n = node(`wing${j}${sx > 0 ? 'L' : 'R'}`, 'body', [sx * 0.26, 0.16, z], { rig: 'wings', detail: 0.9 });
    wingPart(n, sx, span, ch, j ? L.cloth2 : L.cloth);
    n.hard.push(F.metal(H.sphere(0.04, 10)));
    nodes.push(n);
  }
  const gun = node('gun', 'body', [0, 0.16, 0.66], { rig: 'guns', detail: 1.2 });
  gun.hard.push(F.metal(H.cyl(0.02, 0.025, 0.36, 10)).rot(90, 0, 0).at(0, 0.02, 0.12), F.wood(H.box(0.05, 0.05, 0.2, 0.006)).at(0, -0.02, -0.06), H.cyl(0.015, 0.015, 0.14, 6).at(0, -0.1, 0).color(0x3a3a3e));
  nodes.push(gun);
  return { desc: { kind: 'air.craft', attack: 'shoot', flapRate: 4.6, flapAmp: 0.55, nodes }, k: 1.05, crew: [seat('body', [0, 0.06, 0.42]), stand('body', [0, -0.02, -0.42], 'stand', 0)],
    props: { parent: 'body', at: [0, -0.18, -0.05], s: 1.3, hw: 0.3, bow: [0, 0.12, 0.6] } };
}

// ================================================================================================ war-kite
function kite(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const k = node('body', 'root', [0, 1.55, 0], { rig: 'body', detail: 0.95 });
  const spar = L.grim ? 0xd8cfb4 : L.wood;
  // a bird-shaped kite: a cross of spars, swept wings of cloth panels, the faction's colours and a staring eye / sun
  const tipL = [1.25, 0.25, -0.35], tipR = [-1.25, 0.25, -0.35], nose = [0, 0.1, 0.55], tail = [0, -0.05, -0.75];
  k.hard.push(F.wood(H.tube([nose, [0, 0.02, 0], tail], 0.016, 12, 6), spar));
  k.hard.push(F.wood(H.tube([tipR, [-0.5, 0.18, 0.05], [0, 0.12, 0.12], [0.5, 0.18, 0.05], tipL], 0.015, 24, 6), spar));
  const panel = (a, b, c, col) => { const g = H.sheet(1, 1, 8, 8), p = g.geo.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5; const q = lerp3(lerp3(a, b, u), lerp3(a, c, u), v); p.setXYZ(i, q[0], q[1] + 0.03 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI), q[2]); } g.geo.computeVertexNormals(); return g.color(col).pbr(0.82); };
  for (const sx of [1, -1]) {
    const tp = sx > 0 ? tipL : tipR, mid = [sx * 0.5, 0.18, 0.05];
    k.hard.push(panel([0, 0.12, 0.12], mid, [0, 0.02, -0.3], L.cloth), panel(mid, tp, [sx * 0.42, 0.1, -0.5], sx > 0 ? L.cloth2 : L.cloth2), panel([0, 0.02, -0.3], mid, [sx * 0.42, 0.1, -0.5], L.cloth));
    k.hard.push(H.tube([tp, [sx * 0.42, 0.1, -0.52], [0, 0.0, -0.32]], 0.004, 8, 3).color(L.trim).pbr(0.6).lod(1));
  }
  k.hard.push(panel(nose, [0.18, 0.08, 0.15], [-0.18, 0.08, 0.15], L.trim));
  k.prims.push(S.cyl(0.16, 0.01, 0.003).rot(90, 0, 0).at(0, 0.08, 0.0).color(L.accent).glow(L.grim ? 0.6 : 0).pbr(0.6));   // the device on the breast
  k.prims.push(S.cyl(0.07, 0.014, 0.003).rot(90, 0, 0).at(0, 0.085, 0.0).color(L.grim ? L.glow : L.trim).glow(L.grim ? 1.2 : 0).pbr(0.4, 0.5));
  // the harness lines down to the hanging man, and the tether trailing away
  for (const p of [[0.25, 0.1, 0.1], [-0.25, 0.1, 0.1], [0, 0.05, -0.25]]) k.hard.push(H.tube([p, [0, -0.62, 0.0]], 0.004, 4, 3).color(0x3a3020).pbr(0.9));
  k.hard.push(F.wood(H.tube([[-0.22, -0.62, 0.02], [0.22, -0.62, 0.02]], 0.014, 4, 6), spar));
  k.hard.push(H.tube([[0, -0.62, 0], [0, -1.0, -0.4], [0, -1.5, -1.1]], 0.004, 16, 3).color(0xb89a64).pbr(0.9).lod(2));
  nodes.push(k);
  for (let i = 0; i < 4; i++) { const n = node(`tail${i}`, i ? `tail${i - 1}` : 'body', i ? [0, 0, -0.22] : [0, -0.05, -0.76], { rig: 'tails', detail: 0.8 }); n.hard.push(H.box(0.12, 0.008, 0.06, 0.002).rot(0, 45, 0).at(0, 0, -0.11).color(i % 2 ? L.trim : L.cloth2).pbr(0.8), H.tube([[0, 0, 0], [0, 0, -0.22]], 0.003, 2, 3).color(0x3a3020)); nodes.push(n); }
  const hang = node('harness', 'body', [0, -0.62, 0.02], { rig: 'sway', detail: 1 });
  nodes.push(hang);
  return { desc: { kind: 'air.craft', attack: 'shoot', mass: 0.8, nodes }, k: 1, crew: [stand('harness', [0, -1.02, 0], 'wave', 0)], props: { parent: 'harness', at: [0, -1.05, 0.0], s: 0.9, hw: 0.15, bow: [0, -0.6, 0.2] } };
}

// ================================================================================================ hot-air balloon (the sculpted war balloon of bodies/machines.js, crewed)
export function balloonSpec(L) {
  return { body: 'balloon', o: { color: L.cloth, trim: L.trim, glow: L.glow }, k: 1.75, dropNodes: ['crew0', 'crew1'], crew: [stand('gondola', [0.1, -0.8, 0.1], 'stand', 20), stand('gondola', [-0.1, -0.8, -0.12], 'aim', 180)], props: { parent: 'gondola', at: [0, -0.9, 0], s: 0.6, hw: 0.28 } };
}

// ================================================================================================ dirigible
function dirigible(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const EY = 1.75, env = node('envelope', 'root', [0, EY, 0], { rig: 'core', detail: 0.42 });
  env.prims.push(...envelopePrims(L, 0.5, 1.55, 0, { bands: [-0.6, 0, 0.6] }));
  env.prims.push(F.metal(S.ellipsoid(0.12, 0.12, 0.1)).at(0, 0, 1.53).blend(0.04));
  for (const [ax, ay] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) env.hard.push(vane(L, [[0.25, 0], [0.0, 0.42], [-0.3, 0.46], [-0.3, 0]], 0.016, L.cloth2).rot(0, 90, 0).rot(0, 0, ax ? (ax > 0 ? -90 : 90) : ay > 0 ? 0 : 180).at(0, 0, -1.18));
  // the net over the bag, its lines gathered to the gondola
  for (let i = 0; i < 6; i++) { const z = -0.9 + i * 0.36; for (const sx of [1, -1]) env.hard.push(H.tube([[sx * 0.48, -0.12, z], [sx * 0.24, -0.62, z * 0.6]], 0.004, 4, 3).color(0x3a3020).pbr(0.9).lod(2)); }
  nodes.push(env);
  const gon = node('body', 'root', [0, 0.38, 0], { rig: 'body', detail: 0.8 });
  gon.prims.push(...hullPrims(L, 0.7, 0.26, 0.12, 0.1, F, L.grim ? 0x2e2628 : L.wood));
  gon.hard.push(gunwale(L, 0.7, 0.26, 0.1, 0.016));
  for (const z of [0.45, 0, -0.45]) for (const sx of [1, -1]) gon.hard.push(F.wood(H.cyl(0.014, 0.014, 0.55, 6)).at(sx * 0.24, 0.38, z));
  gon.hard.push(F.wood(H.box(0.04, 0.03, 1.2, 0.004)).at(0.24, 0.66, 0), F.wood(H.box(0.04, 0.03, 1.2, 0.004)).at(-0.24, 0.66, 0));
  for (const sx of [1, -1]) {
    gon.prims.push(F.metal(S.capsule([sx * 0.42, 0.18, 0.05], [sx * 0.42, 0.18, -0.25], 0.07, 0.06), 0x4a4a50));
    gon.hard.push(F.wood(H.box(0.22, 0.03, 0.12, 0.006)).at(sx * 0.3, 0.18, -0.1));
  }
  gon.hard.push(vane(L, [[0.1, 0], [0.04, 0.22], [-0.12, 0.25], [-0.14, 0]], 0.012).rot(0, 90, 0).at(0, 0.05, -0.75));
  for (const sx of [1, -1]) gon.hard.push(F.wood(H.tube([[sx * 0.2, -0.05, 0.4], [sx * 0.24, -0.38, 0.4], [sx * 0.24, -0.38, -0.4], [sx * 0.2, -0.05, -0.4]], 0.016, 16, 5)));
  nodes.push(gon);
  for (const sx of [1, -1]) { const s = node(`screw${sx > 0 ? 'L' : 'R'}`, 'body', [sx * 0.42, 0.18, -0.32], { rig: 'props', detail: 1 }); s.hard.push(...screwParts(L, 0.2)); nodes.push(s); }
  const gun = node('gun', 'body', [0, 0.18, 0.62], { rig: 'guns', detail: 1.2 });
  gun.hard.push(F.metal(H.cyl(0.022, 0.028, 0.36, 10)).rot(90, 0, 0).at(0, 0.02, 0.14), F.metal(H.sphere(0.05, 12)).at(0, 0, -0.02));
  nodes.push(gun);
  return { desc: { kind: 'air.craft', attack: 'shoot', mass: 1.6, crash: 'sink', nodes }, k: 1.35, crew: [stand('body', [0, -0.02, 0.42], 'aim', 0), stand('body', [0.08, -0.02, -0.05], 'stand', 30), stand('body', [-0.06, -0.02, -0.45], 'stand', 180)],
    props: { parent: 'body', at: [0, -0.15, 0], s: 1.3, hw: 0.26, bow: [0, 0.1, 0.72] } };
}

// ================================================================================================ sky-lantern
function lantern(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const EY = 1.95, env = node('envelope', 'root', [0, EY, 0], { rig: 'core', detail: 0.55 });
  // a tall paper lantern on ribs, glowing from within, a roof cap and tassels
  const paper = L.grim ? mix(L.cloth, 0x3a2a2a, 0.3) : mix(L.cloth, 0xf0d8a0, 0.35);
  env.prims.push(S.ellipsoid(0.62, 0.78, 0.62).color(paper).glow(0.45).pbr(0.85).bump(0.0015, 30, 'weave'));
  for (let i = 0; i < 10; i++) env.prims.push(S.torus(0.62 * Math.sqrt(1 - Math.pow((i - 4.5) / 5.4, 2)), 0.008).at(0, ((i - 4.5) / 5.4) * 0.78, 0).color(tone(L.wood, -0.1)).pbr(0.7).blend(0.003));
  for (let i = 0; i < 8; i++) env.prims.push(S.box(0.016, 1.8, 1.4, 0.002).rot(0, i * 22.5, 0).color(L.cloth2).paint(0.004, 0.002));
  env.prims.push(S.box(0.9, 0.22, 0.9, 0.01).at(0, 0.1, 0).color(L.accent).glow(0.4).paint(0.01));   // a painted band of the faction's colour
  env.hard.push(F.metal(H.cone(0.4, 0.22, 12)).at(0, 0.84, 0), F.metal(H.sphere(0.05, 10)).at(0, 0.98, 0), F.metal(H.torus(0.32, 0.02, 24, 6).rot(90, 0, 0)).at(0, -0.72, 0));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; env.hard.push(H.cone(0.03, 0.16, 6).rot(180, 0, 0).at(Math.cos(a) * 0.4, 0.62, Math.sin(a) * 0.4).color(L.trim).pbr(0.8).lod(1)); }
  nodes.push(env);
  const fl = node('flame', 'envelope', [0, -0.55, 0], { rig: 'flames', detail: 1 });
  fl.prims.push(S.ellipsoid(0.08, 0.18, 0.08).at(0, 0.12, 0).color(0xffc040).glow(1.8), S.sphere(0.05).at(0, 0.03, 0).color(0xffe8a0).glow(2).blend(0.03));
  nodes.push(fl);
  const plat = node('body', 'root', [0, 0.32, 0], { rig: 'body', detail: 1 });
  plat.hard.push(F.wood(H.cyl(0.42, 0.38, 0.06, 20)).at(0, 0, 0));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; plat.hard.push(F.wood(H.cyl(0.012, 0.012, 0.32, 6)).at(Math.cos(a) * 0.4, 0.17, Math.sin(a) * 0.4)); plat.hard.push(H.tube([[Math.cos(a) * 0.4, 0.32, Math.sin(a) * 0.4], [Math.cos(a) * 0.3, EY - 0.32 - 0.72, Math.sin(a) * 0.3]], 0.004, 4, 3).color(0x3a3020).pbr(0.9).lod(2)); }
  plat.hard.push(F.wood(H.torus(0.4, 0.016, 32, 5).rot(90, 0, 0)).at(0, 0.33, 0), F.metal(H.torus(0.42, 0.012, 32, 5).rot(90, 0, 0)).at(0, 0.02, 0));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; plat.hard.push(H.cone(0.025, 0.12, 6).rot(180, 0, 0).at(Math.cos(a) * 0.42, -0.08, Math.sin(a) * 0.42).color(L.trim).pbr(0.8).lod(1)); }
  nodes.push(plat);
  return { desc: { kind: 'air.craft', attack: 'shoot', mass: 1.4, crash: 'sink', nodes }, k: 1, crew: [stand('body', [0.14, 0.03, 0.12], 'aim', 10), stand('body', [-0.15, 0.03, -0.08], 'stand', 200)], props: { parent: 'body', at: [0, -0.05, 0], s: 1.0, hw: 0.35 } };
}

// ================================================================================================ flying gunboat
function skiff(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const BY = 0.55, body = node('body', 'root', [0, BY, 0], { rig: 'body', detail: 0.72 });
  const hull = L.grim ? 0x2e2a2c : L.wood, P = body.prims, H0 = body.hard;
  P.push(...hullPrims(L, 1.0, 0.36, 0.17, 0.14, F, hull));
  P.push(S.box(0.9, 0.05, 2.4, 0.004).at(0, 0.02, 0).color(L.cloth).paint(0.006, 0.002));       // a painted strake
  P.push(F.metal(S.ellipsoid(0.06, 0.12, 0.08), L.metal).at(0, 0.12, 1.0).blend(0.02));           // stem cap
  H0.push(gunwale(L, 1.0, 0.36, 0.14, 0.022));
  // deck planks inside
  for (let i = -4; i <= 4; i++) H0.push(F.wood(H.box(0.5 - Math.abs(i) * 0.03, 0.015, 0.16, 0.003), tone(hull, 0.06)).at(0, 0.02, i * 0.18).lod(1));
  // a mast with a fan-ribbed sail, and two stub vanes like fins
  H0.push(F.wood(H.cyl(0.026, 0.03, 1.4, 10)).at(0, 0.75, 0.25), F.wood(H.cyl(0.016, 0.016, 0.8, 8)).rot(0, 0, 90).at(0, 1.15, 0.25));
  const sail = H.sheet(0.78, 0.7, 10, 8, (u, v) => [0, 0, Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.08]);
  H0.push(sail.at(0, 0.82, 0.22).color(L.cloth).pbr(0.82).shade((x, y) => (Math.abs(x) < 0.08 && Math.abs(y) < 0.08 ? rgb(L.cloth2) : Math.abs(Math.sin(x * 22)) < 0.06 ? rgb(tone(L.cloth, -0.15)) : y < -0.31 ? rgb(L.trim) : null)));
  H0.push(F.metal(H.sphere(0.04, 10)).at(0, 1.47, 0.25));
  // the lift: glowing stones slung under the keel (or a skull lamp for the grim)
  for (const z of [0.45, -0.45]) { P.push(S.ellipsoid(0.06, 0.1, 0.06).at(0, -0.2, z).color(L.glow).glow(1.1).pbr(0.2).bump(0.004, 20, 'rock')); H0.push(F.metal(H.torus(0.065, 0.01, 16, 5).rot(90, 0, 0)).at(0, -0.16, z)); }
  // stern post with a lantern, rudder
  H0.push(F.wood(H.tube([[0, 0.12, -0.98], [0, 0.4, -1.08], [0, 0.55, -1.02]], 0.03, 10, 8), hull), F.metal(H.sphere(0.05, 10)).at(0, 0.6, -1.02), H.sphere(0.03, 8).at(0, 0.6, -1.02).color(L.glow).glow(1.4).lod(1));
  H0.push(vane(L, [[0.08, -0.3], [0.08, 0.05], [-0.12, 0.08], [-0.16, -0.25]], 0.02, hull).rot(0, 90, 0).at(0, -0.05, -1.0));
  nodes.push(body);
  for (const sx of [1, -1]) { const v = node(`vane${sx > 0 ? 'L' : 'R'}`, 'body', [sx * 0.34, 0.02, -0.1], { rig: 'wings', detail: 0.9 }); v.hard.push(H.extrude([[0, 0.12], [sx * 0.7, 0.05], [sx * 0.62, -0.18], [0, -0.22]], 0.012, 0.003).rot(90, 0, 0).color(L.cloth2).pbr(0.8).shade((x) => (Math.abs(x) > 0.55 ? rgb(L.trim) : null))); v.hard.push(F.wood(H.tube([[0, 0, 0.1], [sx * 0.7, 0, 0.05]], 0.012, 4, 5))); nodes.push(v); }
  const gun = node('gun', 'body', [0, 0.24, 0.8], { rig: 'guns', detail: 1.15 });
  gun.prims.push(F.metal(S.capsule([0, 0, -0.18], [0, 0, 0.22], 0.05, 0.04), L.grim ? 0x2a2a2e : L.metal));
  gun.prims.push(S.torus(0.05, 0.012).rot(90, 0, 0).at(0, 0, 0.2).color(L.metal).pbr(0.3, L.shine).blend(0.004));
  gun.hard.push(F.wood(H.box(0.14, 0.06, 0.18, 0.01)).at(0, -0.06, -0.08), F.metal(H.cyl(0.03, 0.04, 0.16, 10)).at(0, -0.14, -0.05));
  nodes.push(gun);
  return { desc: { kind: 'air.craft', attack: 'shoot', mass: 1.5, flapRate: 1.4, flapAmp: 0.12, crash: 'sink', nodes }, k: 1.1,
    crew: [stand('body', [0, 0.03, 0.58], 'kneel', 0), stand('body', [0.12, 0.03, -0.25], 'aim', 40), stand('body', [-0.04, 0.03, -0.75], 'stand', 0)],
    props: { parent: 'body', at: [0, -0.25, 0], s: 1.4, hw: 0.36, bow: [0, 0.2, 0.95] } };
}

// ================================================================================================ chariot car
function chariotCar(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const body = node('body', 'root', [0, 0.42, -0.3], { rig: 'body', detail: 1 });
  const P = body.prims, H0 = body.hard;
  P.push(F.metal(S.ellipsoid(0.42, 0.34, 0.36), L.grim ? 0x3a3236 : L.metal).at(0, 0.1, 0));
  P.push(S.box(2, 1, 2, 0.01).at(0, 0.62, -0.2).cut(0.01));
  P.push(S.box(2, 1, 1, 0.01).at(0, 0.6, -0.6).cut(0.02));
  P.push(S.ellipsoid(0.36, 0.3, 0.3).at(0, 0.18, 0).cut(0.01).color(0x2a2018));
  P.push(S.box(0.95, 0.05, 1, 0.004).at(0, 0.0, 0).color(L.cloth).paint(0.01, 0.002), S.box(0.95, 0.02, 1, 0.004).at(0, 0.06, 0).color(L.trim).paint(0.004, 0.002));
  P.push(S.cyl(0.11, 0.06, 0.01).rot(90, 0, 0).at(0, 0.03, 0.36).color(L.trim).pbr(0.3, L.shine).blend(0.006));   // a boss on the breastwork
  for (let i = 0; i < 12; i++) { const a = -1.2 + (i / 11) * 2.4; H0.push(H.sphere(0.012, 6).at(Math.sin(a) * 0.41, 0.1, Math.cos(a) * 0.35).color(L.trim).pbr(0.3, L.shine).lod(1)); }
  H0.push(F.wood(H.box(0.7, 0.03, 0.5, 0.006)).at(0, -0.08, -0.05));
  // the pole running forward to the yoke, the yoke, and traces
  H0.push(F.wood(H.tube([[0, -0.06, 0.3], [0, 0.0, 0.8], [0, 0.18, 1.45]], 0.026, 16, 8)));
  H0.push(F.metal(H.tube([[-0.5, 0.22, 1.45], [0, 0.2, 1.47], [0.5, 0.22, 1.45]], 0.02, 12, 6)));
  // wheels that turn in the air like the sun's
  nodes.push(body);
  for (const sx of [1, -1]) {
    const w = node(`wheel${sx > 0 ? 'L' : 'R'}`, 'body', [sx * 0.44, -0.08, -0.02], { rig: 'props', detail: 1 });
    w.hard.push(F.metal(H.torus(0.3, 0.025, 36, 8).rot(0, 90, 0)), F.metal(H.cyl(0.05, 0.05, 0.1, 12).rot(0, 0, 90)));
    for (let i = 0; i < 8; i++) w.hard.push(F.wood(H.cyl(0.012, 0.016, 0.28, 6)).at(0, 0.14, 0).rot(i * 45, 0, 0));
    w.hard.push(H.torus(0.32, 0.01, 36, 5).rot(0, 90, 0).color(L.glow).glow(L.grim ? 1 : 0.4).lod(1));
    // so it spins about the axle (Z in the props convention): turn the wheel's frame
    w.rot = [0, 90, 0];
    for (const h of w.hard) h.rot(0, -90, 0);
    nodes.push(w);
  }
  return { desc: { kind: 'air.craft', attack: 'shoot', nodes }, k: 1, crew: [stand('body', [0.1, -0.06, 0.08], 'brace', 0), stand('body', [-0.14, -0.06, -0.12], 'aim', 0)], props: { parent: 'body', at: [0, -0.25, 0], s: 1.0, hw: 0.4, bow: [0, 0.2, 0.4] } };
}

// ================================================================================================ troop cage under a balloon
function cage(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const EY = 2.75, env = node('envelope', 'root', [0, EY, 0], { rig: 'core', detail: 0.45 });
  env.prims.push(...envelopePrims(L, 0.75, 0.95, 0, { flat: 1.1, bands: [-0.3, 0.3] }));
  env.hard.push(F.metal(H.torus(0.35, 0.02, 24, 6).rot(90, 0, 0)).at(0, -0.8, 0));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; env.hard.push(H.tube([[Math.cos(a) * 0.7, -0.2, Math.sin(a) * 0.85], [Math.cos(a) * 0.35, -0.8, Math.sin(a) * 0.35]], 0.005, 4, 3).color(0x3a3020).pbr(0.9).lod(2)); }
  nodes.push(env);
  const fl = node('burner', 'envelope', [0, -0.95, 0], { rig: 'flames', detail: 1 });
  fl.prims.push(S.ellipsoid(0.07, 0.16, 0.07).at(0, 0.1, 0).color(0xffa030).glow(1.8)); fl.hard.push(H.cyl(0.07, 0.05, 0.08, 10).color(0x2a2a2e).pbr(0.5, 0.6));
  nodes.push(fl);
  const c = node('body', 'root', [0, 0.04, 0], { rig: 'body', detail: 1 });
  const W = 0.42, D = 0.42, Hh = 0.95, bar = L.grim ? 0x2e2a2c : 0x4a4448;
  c.hard.push(F.wood(H.box(W * 2, 0.05, D * 2, 0.008)).at(0, 0, 0), F.metal(H.box(W * 2.04, 0.04, D * 2.04, 0.006)).at(0, Hh, 0));
  for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU, x = clamp(Math.cos(a) * W * 1.45, -W, W), z = clamp(Math.sin(a) * D * 1.45, -D, D); c.hard.push(H.cyl(0.012, 0.012, Hh, 6).at(x, Hh / 2, z).color(bar).pbr(0.45, 0.7)); }
  for (const y of [0.35, 0.7]) for (const [a, b] of [[[-W, y, -D], [W, y, -D]], [[W, y, -D], [W, y, D]], [[W, y, D], [-W, y, D]], [[-W, y, D], [-W, y, -D]]]) c.hard.push(H.tube([a, b], 0.01, 2, 5).color(bar).pbr(0.45, 0.7));
  for (const sx of [1, -1]) for (const sz of [1, -1]) c.hard.push(H.tube([[sx * W, Hh, sz * D], [sx * 0.3, EY - 0.04 - 0.8, sz * 0.3]], 0.006, 4, 3).color(0x3a3020).pbr(0.9));
  c.hard.push(H.cyl(0.04, 0.04, 0.12, 8).at(0, Hh + 0.08, 0).color(L.metal).pbr(0.3, L.shine));
  nodes.push(c);
  return { desc: { kind: 'air.craft', attack: 'shoot', mass: 1.6, crash: 'sink', nodes }, k: 1,
    crew: [stand('body', [0.18, 0.03, 0.16], 'brace', 0), stand('body', [-0.18, 0.03, 0.12], 'stand', -20), stand('body', [0.02, 0.03, -0.2], 'brace', 180), stand('body', [-0.22, 0.03, -0.18], 'stand', 160)],
    props: { parent: 'body', at: [0, 0, 0], s: 1.0, hw: 0.42 } };
}

// ================================================================================================ drop pod
function pod(L, o) {
  const F = finishes(L), nodes = [node('root', null, [0, 0, 0])];
  const body = node('body', 'root', [0, 0.62, 0], { rig: 'body', detail: 0.8 });
  const shell = L.grim ? 0x3a3236 : L.rough ? mix(L.wood, 0x5a4a3a, 0.4) : tone(L.metal, -0.05), P = body.prims, H0 = body.hard;
  P.push(F.metal(S.capsule([0, -0.35, 0], [0, 0.2, 0], 0.4, 0.42), shell).bump(0.0012, 26, 'noise'));
  P.push(F.metal(S.cone(0.36, 0.08, 0.3, 0.04), tone(shell, -0.1)).at(0, -0.62, 0).blend(0.05));
  P.push(S.cyl(0.36, 0.5, 0.02).at(0, 0.45, 0).cut(0.01).color(0x2a2018));
  for (const y of [0.1, -0.2]) { P.push(S.box(1.2, 0.04, 1.2, 0.003).at(0, y, 0).color(L.trim).pbr(0.35, L.shine).paint(0.004, 0.003)); for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; H0.push(H.sphere(0.011, 6).at(Math.cos(a) * 0.42, y, Math.sin(a) * 0.42).color(L.metal).pbr(0.35, L.shine).lod(1)); } }
  P.push(S.box(0.3, 0.3, 1.2, 0.01).at(0, -0.05, 0).color(L.cloth).paint(0.01, 0.002));
  P.push(S.cyl(0.12, 1.2, 0.01).rot(90, 0, 0).at(0, -0.05, 0).color(L.cloth2).paint(0.006, 0.003));
  for (let i = 0; i < 4; i++) H0.push(vane(L, [[0, 0.3], [0.2, 0.05], [0.2, -0.3], [0, -0.1]], 0.02, L.cloth).rot(0, i * 90 + 45, 0).at(Math.cos((i * 90 + 45) * Math.PI / 180) * 0.4, -0.45, -Math.sin((i * 90 + 45) * Math.PI / 180) * 0.4));
  H0.push(F.metal(H.torus(0.4, 0.03, 32, 6).rot(90, 0, 0)).at(0, 0.21, 0));
  nodes.push(body);
  // the drogue: a striped canopy on its lines
  const ch = node('chute', 'body', [0, 1.45, 0], { rig: 'sway', detail: 0.55 });
  ch.prims.push(S.ellipsoid(0.75, 0.32, 0.75).color(L.cloth).pbr(0.8).bump(0.0015, 24, 'weave'), S.ellipsoid(0.72, 0.3, 0.72).at(0, -0.04, 0).cut(0.01).color(tone(L.cloth, -0.2)));
  ch.prims.push(S.box(2, 0.6, 2, 0.002).at(0, -0.3, 0).cut(0.01));
  for (let i = 0; i < 4; i++) ch.prims.push(S.box(0.3, 0.8, 1.8, 0.01).rot(0, i * 45, 0).color(L.cloth2).paint(0.01));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ch.hard.push(H.tube([[Math.cos(a) * 0.72, -0.02, Math.sin(a) * 0.72], [0, -0.8, 0]], 0.004, 4, 3).color(0xd8c8a0).pbr(0.9).lod(2)); }
  nodes.push(ch);
  return { desc: { kind: 'air.craft', attack: 'slam', mass: 1.2, crash: 'sink', grounded: true, nodes }, k: 1, crew: [stand('body', [0.08, -0.38, 0.06], 'brace', 0), stand('body', [-0.1, -0.38, -0.08], 'wave', 180)], props: { parent: 'body', at: [0, -0.5, 0], s: 1.0, hw: 0.4 } };
}

export const CRAFT = { gyro, gyrobomber, glider, ornithopter, kite, dirigible, lantern, skiff, chariot: chariotCar, cage, pod };
