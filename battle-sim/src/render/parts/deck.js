// Deck weapons, buildings, stores and the dressing along her rails and flanks (see ../shipParts.js for `c`).
// Each part is { size, fn }: big things (size 3) are placed first and take the middle of the deck.
import * as THREE from 'three';
import { Kit, G, C, shade, blend, clamp, lerp } from './kit.js';
import { glowMat } from './hull.js';
import { buildFlier } from '../fleetDress.js';

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const PI = Math.PI;

/** evenly spaced stations along her length (fractions of the deck between stern and bow) */
function along(c, n, a = 0.1, b = 0.86) { return Array.from({ length: n }, (_, i) => lerp(c.sternX, c.bowX, lerp(a, b, n === 1 ? 0.5 : i / (n - 1)))); }
const railY = (c, x, s) => c.deckAt(x, s * c.B * 0.28) + 0.22;
const railZ = (c, x, s) => s * (c.hw(x) + 0.02);
const hullH = (c, x) => Math.min(c.dy, c.deckAt(x, c.B * 0.28));

/** one of her own squadron's fliers, parked (the same mount and rider the carrier launches) */
function parkFlier(c, x, y, z, ry = 0, s = 1) {
  const f = buildFlier(c.def.squadrons?.flier || 'glider', c.side, c.def.squadrons?.color);
  f.scale.setScalar(s); f.position.set(x, y, z); f.rotation.y = ry;
  c.addMoving(f);
}

function glowColor(c, fallback) { const t = c.trimC; const col = new THREE.Color(t); const hsl = {}; col.getHSL(hsl); return hsl.s > 0.3 ? new THREE.Color().setHSL(hsl.h, 0.9, 0.62).getHex() : fallback; }

// ---- small builders (in the kit's current frame, base at the origin) ----
function barrel(K, col = C.wood, h = 0.42, band = C.iron) {
  K.add(G.cyl(h * 0.36, h * 0.36, h, 8), col, 0, h / 2, 0).add(G.cyl(h * 0.4, h * 0.4, h * 0.6, 8), col, 0, h / 2, 0);
  for (const y of [0.15, 0.85]) K.add(G.cyl(h * 0.385, h * 0.385, h * 0.06, 8), band, 0, h * y, 0, { m: 0.5 });
}
function skull(K, s = 1) {
  K.add(G.sph(0.13 * s, 7, 5), C.bone, 0, 0.12 * s, 0).add(G.box(0.12 * s, 0.08 * s, 0.13 * s), C.bone, 0.03 * s, 0.03 * s, 0);
  for (const z of [-1, 1]) K.add(G.sph(0.035 * s, 4, 3), C.black, 0.11 * s, 0.13 * s, z * 0.05 * s);
}
function flame(K, x, y, z, s, col = C.fire) {
  K.add(G.cone(0.12 * s, 0.4 * s, 6), col, x, y + 0.2 * s, z, { g: 2.5 }).add(G.cone(0.07 * s, 0.28 * s, 5), 0xffe08a, x, y + 0.16 * s, z, { g: 3 });
}
function roof4(K, w, h, col, y, flare = true) {
  K.add(G.cone(w * 0.75, h, 4), col, 0, y + h / 2, 0, { ry: PI / 4, sy: 1 });
  if (flare) for (let i = 0; i < 4; i++) { const a = PI / 4 + (i * PI) / 2; K.add(G.cone(0.06, w * 0.28, 4), col, Math.cos(a) * w * 0.56, y + 0.08, Math.sin(a) * w * 0.56, { rz: Math.cos(a) * -1.1, rx: Math.sin(a) * 1.1 }); }
}
function cage(K, r, h, col = C.iron) {
  K.add(G.cyl(r, r, 0.06, 10), col, 0, 0.03, 0, { m: 0.6 }).add(G.cyl(r, r, 0.06, 10), col, 0, h, 0, { m: 0.6 }).add(G.cone(r * 0.6, h * 0.25, 8), col, 0, h + h * 0.12, 0, { m: 0.6 });
  for (let i = 0; i < 9; i++) { const a = (i / 9) * PI * 2; K.add(G.cyl(0.02, 0.02, h, 4), col, Math.cos(a) * r, h / 2, Math.sin(a) * r, { m: 0.6 }); }
  K.add(G.sph(r * 0.45, 6, 4), 0x6a5a4a, 0, r * 0.5, 0).add(G.sph(r * 0.06, 4, 3), 0xffd23a, r * 0.3, r * 0.65, r * 0.15, { g: 2 });
}

export const DECK_PARTS = {
  // ================= buildings =================
  pagoda: { size: 3, fn(c) {
    const w = clamp(Math.min(c.hw(0) * 1.6, c.L * 0.28), 1.4, 3.4), tiers = c.L > 10 ? 4 : 3, at = c.place(w * 0.62, -0.08), K = c.kit;
    const wall = blend(c.trimC, 0xb0201a, 0.5), roof = shade(c.hullC, 0.6) || 0x2a2a3a;
    K.push(at.x, at.y, 0);
    let y = 0, ww = w;
    for (let i = 0; i < tiers; i++) {
      const h = 0.75 * c.k * (i ? 0.85 : 1);
      K.add(G.box(ww * 0.72, h, ww * 0.72), i % 2 ? 0xf0e6d0 : wall, 0, y + h / 2, 0);
      for (const s of [-1, 1]) K.add(G.box(0.05, h * 0.5, ww * 0.4), 0xffd88a, s * ww * 0.365, y + h * 0.5, 0, { g: 0.8 });
      roof4(K, ww, h * 0.55, roof, y + h);
      K.add(G.box(ww * 1.06, 0.06, ww * 1.06), c.trimC, 0, y + h + 0.02, 0, { ry: 0, m: 0.5 });
      y += h + h * 0.4; ww *= 0.78;
    }
    K.add(G.cyl(0.04, 0.06, 1.0 * c.k, 5), C.gold, 0, y + 0.4 * c.k, 0, { m: 0.8 });
    for (let i = 0; i < 4; i++) K.add(G.tor(0.12 - i * 0.02, 0.025, 3, 8), C.gold, 0, y + 0.2 * c.k + i * 0.16, 0, { rx: PI / 2, m: 0.8 });
    K.pop();
    c.nestAt = [at.x, at.y + y + 0.3, 0]; c.topAt = Math.max(c.topAt || 0, at.y + y + 1);
  } },
  tower: { size: 3, fn(c) {
    const w = clamp(c.B * 0.36, 1.0, 2.0), h = clamp(c.L * 0.34, 2.6, 5), at = c.place(w * 0.75, -0.18), K = c.kit;
    const stone = c.def.realm && /scrap|greenhide|gorge|cloven/.test(c.def.realm + c.def.kind) ? C.wood : blend(c.hullC, C.stone, 0.6);
    K.push(at.x, at.y, 0);
    K.add(G.box(w, h, w), stone, 0, h / 2, 0, { r: 0.9 });
    for (let k = 1; k < 4; k++) K.add(G.box(w * 1.02, 0.05, w * 1.02), shade(stone, 0.65), 0, (h * k) / 4, 0);
    for (const s of [-1, 1]) K.add(G.box(0.05, 0.35, 0.18), 0xffc86a, s * w * 0.51, h * 0.7, 0, { g: 1 });
    K.add(G.box(w * 1.3, 0.14, w * 1.3), shade(stone, 0.8), 0, h + 0.07, 0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const a = (i * PI) / 2, t = (j - 1) * w * 0.42;
      K.add(G.box(0.22, 0.3, 0.22), stone, Math.cos(a) * w * 0.6 - Math.sin(a) * t, h + 0.29, Math.sin(a) * w * 0.6 + Math.cos(a) * t);
    }
    K.add(G.cyl(0.04, 0.04, 1.4, 5), C.dark, 0, h + 0.8, 0).add(G.box(0.03, 0.5, 0.75), c.side, 0, h + 1.2, 0.38);
    K.pop();
    c.nestAt = [at.x, at.y + h + 0.15, 0]; c.topAt = Math.max(c.topAt || 0, at.y + h + 1.6);
  } },
  pyramid: { size: 3, fn(c) {
    if (c.def.kind === 'serpentBarge') return; // her class is built round a stepped pyramid already
    const w = clamp(Math.min(c.hw(0) * 1.7, c.L * 0.3), 1.6, 3.6), at = c.place(w * 0.62, -0.05), K = c.kit, col = blend(c.hullC, 0xd8c08a, 0.6), n = 5, sh = 0.32 * c.k;
    K.push(at.x, at.y, 0);
    for (let i = 0; i < n; i++) { const ww = w * (1 - i / (n + 0.6)); K.add(G.box(ww, sh, ww), i % 2 ? shade(col, 0.88) : col, 0, sh * (i + 0.5), 0); }
    K.add(G.cone(w * 0.2, sh * 1.6, 4), C.gold, 0, sh * (n + 0.8), 0, { ry: PI / 4, m: 0.85, r: 0.25 });
    K.add(G.box(w * 0.18, sh * n * 0.8, w * 0.22), shade(col, 0.7), w * 0.45, sh * n * 0.4, 0, { rz: 0.75 });
    K.pop();
    c.nestAt = [at.x, at.y + sh * n + 0.6, 0]; c.topAt = Math.max(c.topAt || 0, at.y + sh * (n + 2));
  } },
  ziggurat: { size: 3, fn(c) {
    if (c.def.kind === 'serpentBarge') { const x = -c.L * 0.08; flame(c.kit, x, c.deckAt(x) + 0.05, 0, 1.6 * c.k); return; } // her class's own stepped pyramid; crown it with fire
    const w = clamp(Math.min(c.hw(0) * 1.75, c.L * 0.34), 1.8, 3.8), at = c.place(w * 0.62, -0.08), K = c.kit, col = blend(c.hullC, 0xa07a50, 0.5), n = 3, sh = 0.55 * c.k;
    K.push(at.x, at.y, 0);
    for (let i = 0; i < n; i++) { const ww = w * (1 - i * 0.28); K.add(G.box(ww, sh, ww * 0.9), i % 2 ? shade(col, 0.85) : col, 0, sh * (i + 0.5), 0); K.add(G.box(ww * 1.02, 0.06, ww * 0.92), c.trimC, 0, sh * (i + 1), 0, { m: 0.4 }); }
    // the stair up her face
    K.add(G.box(Math.hypot(w * 0.5, sh * n), 0.12, w * 0.2), shade(col, 0.7), w * 0.3, sh * n * 0.5, 0, { rz: -Math.atan2(sh * n, w * 0.5) });
    for (let i = 0; i < 6; i++) K.add(G.box(0.08, 0.06, w * 0.22), shade(col, 0.55), w * 0.52 - (w * 0.45 * i) / 6, sh * n * (i / 6) + 0.1, 0);
    K.add(G.box(w * 0.3, sh * 0.8, w * 0.3), shade(col, 0.9), 0, sh * n + sh * 0.4, 0);
    flame(K, 0, sh * n + sh * 0.8, 0, 1.6 * c.k);
    K.pop();
    c.topAt = Math.max(c.topAt || 0, at.y + sh * n + 1.6);
  } },
  temple: { size: 3, fn(c) {
    const w = clamp(Math.min(c.hw(0) * 1.6, c.L * 0.3), 1.6, 3.2), d = w * 0.7, h = 1.4 * c.k, at = c.place(w * 0.6, -0.12), K = c.kit, col = blend(c.trimC, 0xe8e0d0, 0.6);
    K.push(at.x, at.y, 0);
    K.add(G.box(w, 0.18, d), col, 0, 0.09, 0).add(G.box(w * 0.9, 0.1, d * 0.9), shade(col, 0.9), 0, 0.23, 0);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) K.add(G.cyl(0.08 * c.k, 0.09 * c.k, h, 8), col, -w * 0.38 + (w * 0.76 * i) / 3, 0.28 + h / 2, s * d * 0.36);
    K.add(G.box(w * 0.6, h * 0.8, d * 0.4), 0x3a2a1a, 0, 0.28 + h * 0.4, 0).add(G.sph(0.16, 8, 6), 0xffd23a, 0, 0.28 + h * 0.5, 0, { g: 2 });
    K.add(G.box(w * 0.94, 0.16, d * 0.94), c.trimC, 0, 0.36 + h, 0, { m: 0.5 });
    K.add(G.shape('pediment', [[-0.5, 0], [0.5, 0], [0, 0.32]], 1), col, 0, 0.44 + h, 0, { sx: d * 1.0, sy: d * 1.0, sz: w * 0.94, ry: PI / 2 });
    K.pop();
    c.topAt = Math.max(c.topAt || 0, at.y + h + 0.8);
  } },
  obelisk: { size: 2.5, fn(c) {
    const h = clamp(c.L * 0.32, 2.4, 4.2), w = 0.32 * c.k, at = c.place(0.55, -0.22), K = c.kit, col = blend(c.hullC, C.darkStone, 0.5);
    K.push(at.x, at.y, 0);
    K.add(G.box(w * 3, 0.3, w * 3), shade(col, 0.8), 0, 0.15, 0);
    K.add(G.cyl(w * 0.5, w * 0.8, h, 4), col, 0, 0.3 + h / 2, 0, { ry: PI / 4, r: 0.5 });
    K.add(G.cone(w * 0.52, w * 1.3, 4), C.gold, 0, 0.3 + h + w * 0.62, 0, { ry: PI / 4, m: 0.9, r: 0.25 });
    const gc = glowColor(c, 0x6af0ff);
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) K.add(G.box(0.02, 0.12, w * 0.5), gc, s * w * 0.58 * (1 - (i / 5) * 0.3), 0.6 + i * h * 0.17, 0, { g: 2 });
    K.pop();
    c.topAt = Math.max(c.topAt || 0, at.y + h + 0.8);
  } },
  monolith: { size: 2.5, fn(c) {
    const h = clamp(c.L * 0.26, 2, 3.6), w = clamp(c.B * 0.26, 0.7, 1.3), at = c.place(w * 0.6, 0.0), K = c.kit, gc = glowColor(c, 0xa04aff);
    K.push(at.x, at.y, 0, 0, 0.3, 0.06);
    K.add(G.box(w, h, w * 0.35), 0x141418, 0, h / 2, 0, { r: 0.3, m: 0.2 });
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) K.add(G.box(w * (0.2 + hash(i) * 0.4), 0.05, 0.02), gc, (hash(i + 4) - 0.5) * w * 0.4, h * (0.15 + i * 0.13), s * w * 0.18, { g: 2.5 });
    K.pop();
    c.topAt = Math.max(c.topAt || 0, at.y + h);
  } },
  stones: { size: 2.8, fn(c) {
    const R = clamp(c.hw(0) * 0.72, 0.9, 1.8), at = c.place(R + 0.2, -0.15), K = c.kit, n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + 0.3, h = (1.1 + hash(i) * 0.8) * c.k;
      K.add(G.box(0.32 * c.k, h, 0.22 * c.k), blend(C.darkStone, 0x2a2430, hash(i + 1)), at.x + Math.cos(a) * R, at.y + h / 2, Math.sin(a) * R * 0.85, { ry: -a, rz: (hash(i + 2) - 0.5) * 0.2, r: 0.9 });
      if (i % 2 === 0) K.add(G.box(0.03, 0.3, 0.1), glowColor(c, 0xb04aff), at.x + Math.cos(a) * (R - 0.17 * c.k), at.y + h * 0.6, Math.sin(a) * (R - 0.17) * 0.85, { ry: -a, g: 2.5 });
    }
    K.add(G.cyl(R * 0.4, R * 0.45, 0.25, 8), 0x2a2430, at.x, at.y + 0.12, 0);
    c.stonesAt = [at.x, at.y];
  } },
  tree: { size: 3, fn(c) {
    const h = clamp(c.L * 0.42, 3, 6), at = c.place(clamp(c.B * 0.3, 0.8, 1.4), -0.05), K = c.kit, bark = 0x5a4030, leaf = blend(C.leaf, c.sailC, 0.2);
    K.push(at.x, at.y, 0);
    K.add(G.cyl(0.18 * c.k, 0.42 * c.k, h * 0.65, 8), bark, 0, h * 0.32, 0, { r: 0.95 });
    for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2; K.bar([0, 0.4, 0], [Math.cos(a) * 0.9 * c.k, 0.02, Math.sin(a) * 0.7 * c.k], 0.09 * c.k, bark); }
    for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2 + 0.5; K.bar([0, h * 0.5, 0], [Math.cos(a) * 0.9 * c.k, h * 0.78, Math.sin(a) * 0.7 * c.k], 0.08 * c.k, bark); }
    const blobs = [[0, 0.92, 0, 1.1], [0.75, 0.78, 0.35, 0.8], [-0.7, 0.8, -0.3, 0.85], [0.2, 0.75, -0.7, 0.75], [-0.3, 0.76, 0.7, 0.75], [0, 1.15, 0, 0.7]];
    blobs.forEach(([x, y, z, r], i) => K.add(G.ico(r * c.k * 1.05, 1), shade(leaf, 0.85 + hash(i) * 0.3), x * c.k, y * h, z * c.k, { r: 0.85 }));
    K.pop();
    c.nestAt = [at.x, at.y + h * 1.2, 0]; c.topAt = Math.max(c.topAt || 0, at.y + h * 1.3);
  } },
  deadTree: { size: 2.5, fn(c) {
    const h = clamp(c.L * 0.36, 2.6, 5), at = c.place(0.6, 0.05), K = c.kit, bark = 0x4a4038, k = c.k;
    K.push(at.x, at.y, 0);
    const trunk = [[0, 0, 0], [0.12, 0.3, 0.05], [-0.08, 0.6, 0], [0.05, 0.85, 0.06], [0, 1, 0]].map(([x, y, z]) => [x * k, y * h, z * k]);
    for (let i = 0; i < trunk.length - 1; i++) K.bar(trunk[i], trunk[i + 1], 0.26 * k * (1 - i * 0.2), bark, { r2: 0.26 * k * (1 - (i + 1) * 0.2) });
    for (let i = 0; i < 4; i++) { const a = i * 1.6; K.bar([0, 0.15, 0], [Math.cos(a) * 0.6 * k, 0, Math.sin(a) * 0.5 * k], 0.1 * k, bark, { r2: 0.03 }); }
    const br = [[0.4, 0.5, 0.35], [0.55, -0.6, 0.15], [0.7, 0.3, -0.5], [0.62, -0.4, 0.6], [0.85, 0.2, 0.4], [0.8, -0.3, -0.35]];
    br.forEach(([f, dx, dz], i) => {
      const a = [0, f * h, 0], b = [dx * 1.8 * k, f * h + 0.55 * h * 0.35, dz * 1.8 * k], e = [dx * 2.6 * k, f * h + 0.7, dz * 2.4 * k + 0.2];
      K.bar(a, b, 0.09 * k, bark, { r2: 0.05 * k }).bar(b, e, 0.05 * k, bark, { r2: 0.015 });
      K.bar(b, [b[0] + 0.3, b[1] + 0.45, b[2] - 0.2], 0.035 * k, bark, { r2: 0.01 });
      if (i < 3) K.bar(e, [e[0], e[1] - 0.6, e[2]], 0.012, C.rope).add(G.box(0.1, 0.25, 0.1), 0x6a5a48, e[0], e[1] - 0.72, e[2]);
    });
    K.pop();
    if (!c.nestAt) c.nestAt = [at.x, at.y + h, 0];
    c.topAt = Math.max(c.topAt || 0, at.y + h + 0.6);
  } },
  portal: { size: 3, fn(c) {
    const R = clamp(c.B * 0.34, 0.9, 1.8), at = c.place(R * 0.7, -0.05), K = c.kit, gc = glowColor(c, 0x9a4aff), y = at.y + R + 0.3;
    K.push(at.x, at.y, 0);
    K.add(G.box(R * 1.3, 0.3, R * 0.8), C.darkStone, 0, 0.15, 0);
    for (const s of [-1, 1]) { K.add(G.box(0.35, R * 2.4, 0.4), C.darkStone, s * R * 1.08, R * 1.2, 0); K.add(G.cone(0.22, 0.6, 4), C.darkStone, s * R * 1.08, R * 2.4 + 0.3, 0, { ry: PI / 4 }); }
    K.add(G.tor(R, R * 0.12, 6, 24), 0x2a2030, 0, R + 0.3, 0, { m: 0.3 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; K.add(G.box(0.1, 0.1, 0.1), gc, Math.cos(a) * R, R + 0.3 + Math.sin(a) * R, R * 0.12, { g: 3 }); }
    K.pop();
    const g = new THREE.Group(); g.position.set(at.x, y, 0);
    const disc = new THREE.Mesh(G.circle(R * 0.92, 24), glowMat(gc, 0.55));
    const sw = new Kit();
    for (let i = 0; i < 3; i++) sw.add(G.tor(R * (0.3 + i * 0.22), 0.04, 3, 16, PI * 1.2), 0xffffff, 0, 0, 0.02, { rz: i * 2, g: 3 });
    const swirl = new THREE.Mesh(sw.build(), glowMat(blend(gc, 0xffffff, 0.4), 0.8));
    g.add(disc, swirl);
    c.addMoving(g, (t, ph) => { swirl.rotation.z = -t * 2.2; disc.material.opacity = 0.45 + 0.15 * Math.sin(t * 3 + ph); });
    c.topAt = Math.max(c.topAt || 0, at.y + R * 2.6);
  } },
  flightDeck: { size: 3.5, fn(c) {
    const fl = clamp(c.L * 0.42, 3, 6), fw = clamp(2 * c.hw(-c.L * 0.2) + 0.5, 2, 5), fx = c.sternX + fl / 2 + 0.1, fy = c.deckAt(fx) + 1.3, K = c.kit;
    c.taken.push([fx, 0, fl * 0.45]); c.keep.push([fx, 0, fl * 0.3], [fx - fl * 0.3, 0, fw * 0.4], [fx + fl * 0.3, 0, fw * 0.4]);
    K.add(G.box(fl, 0.12, fw), shade(c.hullC, 0.9), fx, fy, 0);
    for (const s of [-1, 1]) K.add(G.box(fl, 0.03, 0.08), 0xe8e0c8, fx, fy + 0.07, s * fw * 0.46);
    for (let i = 0; i < 5; i++) K.add(G.box(fl * 0.08, 0.03, 0.12), 0xe8e0c8, fx - fl * 0.4 + (fl * 0.8 * i) / 4, fy + 0.07, 0);
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) K.add(G.box(0.14, fy - c.deckAt(fx + sx * fl * 0.42), 0.14), C.dark, fx + sx * fl * 0.42, (fy + c.deckAt(fx + sx * fl * 0.42)) / 2, sz * fw * 0.38);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) K.add(G.sph(0.05, 5, 3), i % 2 ? 0xff4a2a : 0x4aff6a, fx - fl / 2 + (fl * i) / 5, fy + 0.1, s * fw * 0.5, { g: 3 });
    parkFlier(c, fx - fl * 0.22, fy + 0.08, fw * 0.18, 0, 1.1);
    parkFlier(c, fx + fl * 0.2, fy + 0.08, -fw * 0.18, 0.3, 1.1);
    c.topAt = Math.max(c.topAt || 0, fy + 0.5);
  } },
  pad: { size: 2.5, fn(c) {
    const r = clamp(c.B * 0.33, 0.9, 1.6), at = c.place(r * 0.8, -0.26), y = at.y + 0.9, K = c.kit;
    K.add(G.cyl(r, r, 0.1, 18), 0x3a3a3e, at.x, y, 0, { m: 0.5 });
    for (let i = 0; i < 8; i++) K.add(G.box(r * 0.22, 0.02, 0.1), i % 2 ? c.side : 0xf0e8d0, at.x + Math.cos((i / 8) * PI * 2) * r * 0.8, y + 0.06, Math.sin((i / 8) * PI * 2) * r * 0.8, { ry: -(i / 8) * PI * 2 + PI / 2 });
    K.add(G.tor(r * 0.45, 0.04, 3, 16), 0xf0e8d0, at.x, y + 0.06, 0, { rx: PI / 2 });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * PI * 2 + PI / 4; K.add(G.box(0.1, 0.9, 0.1), C.iron, at.x + Math.cos(a) * r * 0.7, at.y + 0.45, Math.sin(a) * r * 0.7, { m: 0.5 }); }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; K.add(G.sph(0.05, 5, 3), 0xffd23a, at.x + Math.cos(a) * r, y + 0.08, Math.sin(a) * r, { g: 3 }); }
    parkFlier(c, at.x, y + 0.08, 0, 0.6, 0.95);
    c.topAt = Math.max(c.topAt || 0, y + 0.3);
  } },
  yurt: { size: 2.6, fn(c) {
    const r = clamp(c.hw(0) * 0.7, 0.8, 1.5), at = c.place(r, -0.12), K = c.kit, h = 0.9 * c.k;
    K.push(at.x, at.y, 0);
    K.add(G.cyl(r, r, h, 14), C.felt, 0, h / 2, 0).add(G.cone(r * 1.08, h * 0.75, 14), shade(C.felt, 0.85), 0, h + h * 0.37, 0);
    K.add(G.tor(r * 1.0, 0.04, 3, 18), c.side, 0, h * 0.75, 0, { rx: PI / 2 }).add(G.tor(r * 1.0, 0.04, 3, 18), c.trimC, 0, h * 0.25, 0, { rx: PI / 2 });
    K.add(G.box(0.05, h * 0.75, r * 0.45), c.trimC, r * 0.98, h * 0.38, 0).add(G.cyl(0.12, 0.12, 0.12, 8), C.dark, 0, h * 1.78, 0);
    K.pop();
  } },
  dome: { size: 2.8, fn(c) {
    const r = clamp(c.hw(0) * 0.72, 0.8, 1.6), at = c.place(r, -0.1), K = c.kit, col = blend(c.trimC, 0xe8d8b0, 0.3);
    K.push(at.x, at.y, 0);
    K.add(G.cyl(r * 0.95, r, 0.5 * c.k, 14), blend(c.hullC, 0xe8e0d0, 0.5), 0, 0.25 * c.k, 0);
    K.add(G.hemi(r * 0.95, 14, 6), col, 0, 0.5 * c.k, 0, { m: 0.5, r: 0.35 });
    for (let i = 0; i < 6; i++) K.add(G.box(0.05, 0.3 * c.k, 0.16), 0xffd88a, Math.cos((i / 6) * PI * 2) * r * 0.96, 0.28 * c.k, Math.sin((i / 6) * PI * 2) * r * 0.96, { ry: -(i / 6) * PI * 2, g: 1 });
    K.add(G.cyl(0.03, 0.05, 0.6, 5), C.gold, 0, 0.5 * c.k + r * 0.95 + 0.3, 0, { m: 0.8 }).add(G.sph(0.1, 6, 4), C.gold, 0, 0.5 * c.k + r * 0.95 + 0.62, 0, { m: 0.8 });
    K.pop();
  } },
  shrine: { size: 2, fn(c) {
    const w = clamp(c.B * 0.24, 0.7, 1.1), at = c.place(w * 0.7, -0.3), K = c.kit, wall = blend(c.trimC, 0xb02a1a, 0.4);
    K.push(at.x, at.y, 0);
    K.add(G.box(w * 1.1, 0.12, w * 1.1), C.stone, 0, 0.06, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.add(G.cyl(0.04, 0.04, w * 0.9, 5), wall, sx * w * 0.4, 0.12 + w * 0.45, sz * w * 0.4);
    K.add(G.box(w * 0.6, w * 0.5, w * 0.5), shade(wall, 0.7), 0, 0.12 + w * 0.25, 0).add(G.sph(0.08, 6, 4), 0xffd23a, w * 0.31, 0.12 + w * 0.3, 0, { g: 2.5 });
    roof4(K, w * 1.2, w * 0.45, shade(c.hullC, 0.6), 0.12 + w * 0.9);
    K.pop();
  } },
  pulpit: { size: 1.8, fn(c) {
    const at = c.place(0.55, 0.12), K = c.kit, col = blend(c.hullC, C.dark, 0.4);
    K.push(at.x, at.y, 0);
    K.add(G.cyl(0.42, 0.3, 1.1, 8), col, 0, 0.55, 0).add(G.cyl(0.48, 0.48, 0.1, 8), c.trimC, 0, 1.12, 0, { m: 0.5 });
    K.add(G.box(0.25, 0.3, 0.35), col, 0.32, 1.25, 0, { rz: -0.4 }).add(G.box(0.18, 0.04, 0.3), C.cloth, 0.38, 1.38, 0, { rz: -0.4 });
    for (let i = 0; i < 4; i++) K.add(G.box(0.25, 0.08, 0.4), col, -0.45 - i * 0.18, 0.9 - i * 0.24, 0);
    K.add(G.cyl(0.03, 0.03, 1.6, 4), C.dark, -0.3, 1.9, 0).add(G.box(0.03, 0.7, 0.45), c.side, -0.3, 2.3, 0.24);
    K.pop();
  } },
  sarcophagus: { size: 1.9, fn(c) {
    const l = clamp(c.B * 0.42, 1.2, 2), at = c.place(l * 0.55, -0.05), K = c.kit, st = blend(C.stone, 0xd8c08a, 0.4);
    K.push(at.x, at.y, 0);
    K.add(G.box(l * 1.25, 0.2, l * 0.65), shade(st, 0.8), 0, 0.1, 0).add(G.box(l, 0.45, l * 0.42), st, 0, 0.42, 0);
    K.add(G.box(l * 1.02, 0.14, l * 0.45), C.gold, 0, 0.71, 0, { m: 0.85, r: 0.3 });
    K.add(G.sph(0.15, 8, 6), C.gold, l * 0.36, 0.82, 0, { sx: 0.8, m: 0.85, r: 0.3 }).add(G.box(l * 0.5, 0.06, 0.12), 0x1a4a8a, 0, 0.8, 0, { m: 0.4 });
    for (const s of [-1, 1]) K.add(G.cyl(0.06, 0.08, 0.6, 6), C.gold, l * 0.5 * s, 0.5, l * 0.3, { m: 0.8 });
    K.pop();
  } },
  // ================= weapons =================
  turrets: { size: 2.2, fn(c) {
    const r = clamp(c.B * 0.17, 0.45, 0.9);
    [0.26, -0.26].forEach((pref, i) => {
      const at = c.place(r, pref, 'c');
      c.kit.add(G.cyl(r * 1.05, r * 1.15, 0.2, 12), C.iron, at.x, at.y + 0.1, 0, { m: 0.6 });
      const K = new Kit(), body = blend(c.hullC, C.iron, 0.4);
      K.add(G.cyl(r * 0.92, r, r * 0.55, 12), body, 0, r * 0.28, 0, { m: 0.65, r: 0.45 });
      K.add(G.cyl(r * 0.75, r * 0.92, r * 0.2, 12), shade(body, 0.85), 0, r * 0.65, 0, { m: 0.65, r: 0.45 });
      K.add(G.box(r * 0.5, r * 0.2, r * 0.6), shade(body, 0.7), -r * 0.2, r * 0.8, 0, { m: 0.6 });
      for (const z of [-1, 1]) {
        K.add(G.cyl(r * 0.1, r * 0.13, r * 1.6, 8), C.iron, r * 1.2, r * 0.35, z * r * 0.28, { rz: -PI / 2, m: 0.8, r: 0.35 });
        K.add(G.cyl(r * 0.14, r * 0.14, r * 0.12, 8), c.trimC, r * 1.95, r * 0.35, z * r * 0.28, { rz: -PI / 2, m: 0.8 });
      }
      const tm = K.mesh(); tm.position.set(at.x, at.y + 0.2, 0);
      const home = i ? PI : 0;
      tm.rotation.y = home;
      c.addMoving(tm, (t, ph) => { tm.rotation.y = home + Math.sin(t * 0.25 + ph + i * 2) * 1.1; });
    });
  } },
  ballista: { size: 2, fn(c) {
    const at = c.place(0.6, 0.3, 'c'), K = c.kit, s = clamp(c.B * 0.3, 0.9, 1.5);
    K.push(at.x, at.y, 0, 0, 0, 0, s);
    K.add(G.cyl(0.16, 0.22, 0.55, 6), C.dark, 0, 0.27, 0).add(G.box(1.1, 0.12, 0.18), C.wood, 0.1, 0.62, 0, { rz: 0.08 });
    K.add(G.tube('ballbow', [[0.45, 0.68, -0.75], [0.6, 0.68, -0.35], [0.62, 0.68, 0], [0.6, 0.68, 0.35], [0.45, 0.68, 0.75]], 0.045, 12, 5), C.dark, 0, 0, 0);
    K.bar([0.45, 0.68, -0.75], [-0.25, 0.68, 0], 0.012, C.rope).bar([0.45, 0.68, 0.75], [-0.25, 0.68, 0], 0.012, C.rope);
    K.add(G.cyl(0.025, 0.025, 0.9, 4), C.wood, 0.25, 0.72, 0, { rz: PI / 2 }).add(G.cone(0.05, 0.16, 4), C.iron, 0.75, 0.72, 0, { rz: -PI / 2, m: 0.7 });
    for (const z of [-1, 1]) K.add(G.cyl(0.08, 0.08, 0.14, 8), C.bronze, 0.55, 0.68, z * 0.16, { rx: PI / 2, m: 0.7 });
    K.pop();
  } },
  repeater: { size: 1.6, fn(c) {
    for (const pref of [0.2, -0.22]) {
      const at = c.place(0.45, pref, 's'), K = c.kit, s = c.k, out = Math.sign(at.z || 1);
      K.push(at.x, at.y, at.z, 0, out > 0 ? -PI / 2 : PI / 2, 0, s);
      K.add(G.cyl(0.08, 0.12, 0.6, 6), C.iron, 0, 0.3, 0, { m: 0.5 }).add(G.box(0.55, 0.22, 0.3), C.bronze, 0.05, 0.7, 0, { m: 0.7, r: 0.35 });
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) K.add(G.cyl(0.03, 0.03, 0.55, 5), C.iron, 0.5, 0.64 + j * 0.1, -0.08 + i * 0.08, { rz: -PI / 2, m: 0.8 });
      K.add(G.box(0.3, 0.3, 0.22), C.wood, -0.05, 0.95, 0).add(G.cyl(0.11, 0.11, 0.04, 8), C.bronze, -0.1, 0.7, 0.2, { rx: PI / 2, m: 0.7 });
      K.pop();
    }
  } },
  harpoonGun: { size: 1.8, fn(c) {
    const at = c.place(0.5, 0.36, 'c'), K = c.kit;
    K.push(at.x, at.y, 0, 0, 0, 0, c.k);
    K.add(G.cyl(0.14, 0.2, 0.5, 6), C.dark, 0, 0.25, 0).add(G.box(0.3, 0.2, 0.25), C.iron, 0, 0.55, 0, { m: 0.6 });
    K.add(G.cyl(0.07, 0.09, 1.1, 8), C.iron, 0.3, 0.68, 0, { rz: -PI / 2 + 0.2, m: 0.7 });
    K.add(G.cyl(0.025, 0.025, 0.7, 4), C.wood, 0.95, 0.84, 0, { rz: -PI / 2 + 0.2 });
    K.add(G.cone(0.08, 0.25, 4), C.steel, 1.35, 0.92, 0, { rz: -PI / 2 + 0.2, m: 0.8 });
    for (const z of [-1, 1]) K.add(G.cone(0.03, 0.18, 3), C.steel, 1.22, 0.88, z * 0.06, { rz: PI / 2 + 0.2 + 0.5, rx: z * 0.6, m: 0.8 });
    K.add(G.tor(0.22, 0.07, 5, 12), C.rope, -0.5, 0.08, 0, { rx: PI / 2 }).add(G.tor(0.16, 0.06, 5, 10), C.rope, -0.5, 0.18, 0, { rx: PI / 2 });
    K.pop();
  } },
  winch: { size: 1.8, fn(c) {
    const at = c.place(0.6, 0.14, 'c'), K = c.kit, w = clamp(c.B * 0.32, 0.9, 1.5);
    K.push(at.x, at.y, 0);
    for (const z of [-1, 1]) { K.bar([-0.35, 0, z * w / 2], [0, 0.75, z * w / 2], 0.06, C.dark).bar([0.35, 0, z * w / 2], [0, 0.75, z * w / 2], 0.06, C.dark); K.add(G.cyl(0.38, 0.38, 0.05, 12), C.iron, 0, 0.62, z * (w / 2 + 0.08), { rx: PI / 2, m: 0.6 }); }
    K.add(G.cyl(0.26, 0.26, w * 0.85, 10), C.wood, 0, 0.62, 0, { rx: PI / 2 });
    for (let i = 0; i < 6; i++) K.add(G.tor(0.28, 0.035, 3, 10), C.iron, 0, 0.62, -w * 0.36 + (w * 0.72 * i) / 5, { m: 0.6 });
    K.add(G.box(0.1, 0.1, 0.5), C.iron, 0.25, 0.9, w / 2 + 0.2, { m: 0.6 });
    K.pop();
    K.rope([at.x + 0.25, at.y + 0.85, 0], [c.bowX - 0.2, c.deckAt(c.bowX - 0.4) + 0.3, 0], 0.08, 0.03, C.iron);
  } },
  kegs: { size: 1, fn(c) {
    for (const pref of [0.12, -0.3]) {
      const at = c.place(0.45, pref, 's'), K = c.kit;
      for (let i = 0; i < 4; i++) { K.push(at.x + (i % 2) * 0.3 - 0.15, at.y + (i > 1 ? 0.36 : 0), at.z + (i % 2 ? 0.08 : -0.08)); barrel(K, 0x5a3a24, 0.36, 0xb02a1a); K.pop(); }
      K.add(G.cyl(0.01, 0.01, 0.25, 3), C.rope, at.x, at.y + 0.85, at.z).add(G.sph(0.03, 4, 3), C.fire, at.x, at.y + 0.98, at.z, { g: 3 });
    }
  } },
  trebuchet: { size: 3, fn(c) {
    const h = clamp(c.L * 0.3, 2.4, 4), at = c.place(clamp(c.B * 0.3, 0.9, 1.4), 0, 'c'), K = c.kit, w = clamp(c.B * 0.34, 0.9, 1.4);
    K.push(at.x, at.y, 0);
    K.add(G.box(h * 0.8, 0.16, w), C.dark, 0, 0.08, 0);
    for (const z of [-1, 1]) { K.bar([-h * 0.3, 0.1, z * w * 0.42], [0, h * 0.7, z * w * 0.42], 0.08, C.wood).bar([h * 0.3, 0.1, z * w * 0.42], [0, h * 0.7, z * w * 0.42], 0.08, C.wood); }
    K.add(G.cyl(0.07, 0.07, w, 6), C.iron, 0, h * 0.7, 0, { rx: PI / 2, m: 0.6 });
    K.bar([-h * 0.32, h * 0.25, 0], [h * 0.55, h * 1.1, 0], 0.08, C.wood, { r2: 0.05 });
    K.add(G.box(0.5, 0.5, w * 0.6), C.darkStone, -h * 0.3, h * 0.12, 0).add(G.sph(0.22, 6, 4), C.stone, -h * 0.05, 0.3, w * 0.15);
    K.rope([h * 0.55, h * 1.1, 0], [h * 0.4, h * 0.6, 0], 0.05, 0.02, C.rope);
    K.pop();
    c.topAt = Math.max(c.topAt || 0, at.y + h * 1.15);
  } },
  catapult: { size: 2, fn(c) {
    const at = c.place(0.7, 0.12, 'c'), K = c.kit, s = clamp(c.B * 0.3, 0.9, 1.5);
    K.push(at.x, at.y, 0, 0, 0, 0, s);
    K.add(G.box(1.2, 0.14, 0.6), C.wood, 0, 0.07, 0);
    for (const z of [-1, 1]) { K.add(G.box(0.12, 0.8, 0.1), C.wood, 0.25, 0.45, z * 0.28); K.add(G.box(1.1, 0.1, 0.1), C.wood, 0, 0.18, z * 0.28); }
    K.add(G.box(0.1, 0.1, 0.66), C.dark, 0.25, 0.85, 0).add(G.tor(0.12, 0.06, 4, 8), C.rope, -0.35, 0.22, 0, { ry: PI / 2 });
    K.bar([-0.35, 0.22, 0], [0.2, 1.15, 0], 0.05, C.wood);
    K.add(G.hemi(0.18, 8, 4), C.dark, 0.26, 1.24, 0, { rx: PI, rz: 0.6 }).add(G.sph(0.14, 6, 4), C.stone, 0.24, 1.25, 0);
    K.pop();
  } },
  mortarPit: { size: 2, fn(c) {
    const r = clamp(c.B * 0.22, 0.6, 1.0), at = c.place(r, 0.05, 'c'), K = c.kit;
    K.push(at.x, at.y, 0);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; K.add(G.sph(0.16, 6, 4), 0x9a8a6a, Math.cos(a) * r, 0.1, Math.sin(a) * r, { sx: 1.4, sy: 0.7, ry: -a }); K.add(G.sph(0.15, 6, 4), 0x8a7a5a, Math.cos(a + 0.26) * r, 0.25, Math.sin(a + 0.26) * r, { sx: 1.4, sy: 0.7, ry: -a }); }
    K.add(G.cyl(r * 0.55, r * 0.6, 0.25, 10), C.dark, 0, 0.12, 0);
    K.add(G.cyl(r * 0.4, r * 0.32, r * 0.9, 10), C.iron, 0.08, 0.5, 0, { rz: -0.4, m: 0.7, r: 0.4 }).add(G.tor(r * 0.4, 0.05, 4, 10), c.trimC, 0.27, 0.9, 0, { rz: -0.4, rx: PI / 2, m: 0.8 });
    for (let i = 0; i < 4; i++) K.add(G.sph(0.12, 6, 4), C.black, -r * 0.5 + (i % 2) * 0.2, 0.1 + (i > 1 ? 0.18 : 0), r * 0.45);
    K.pop();
  } },
  bombard: { size: 2.2, fn(c) {
    const at = c.place(0.8, 0.22, 'c'), K = c.kit, r = clamp(c.B * 0.11, 0.3, 0.6), l = r * 4.2;
    K.push(at.x, at.y, 0);
    K.add(G.box(l * 1.05, 0.25, r * 2.6), C.dark, 0, 0.12, 0);
    K.push(0, 0.25 + r, 0, 0, 0, -PI / 2 + 0.25);
    K.add(G.cyl(r, r * 1.08, l, 12), c.trimC === 0xd4a83a ? C.bronze : 0x3a3a40, 0, 0, 0, { m: 0.75, r: 0.35 });
    for (let i = 0; i < 5; i++) K.add(G.cyl(r * 1.12, r * 1.12, 0.08, 12), C.iron, 0, -l / 2 + (l * (i + 0.5)) / 5, 0, { m: 0.7 });
    K.add(G.cyl(r * 0.7, r * 0.7, 0.02, 12), C.black, 0, l / 2 + 0.01, 0);
    K.pop();
    K.add(G.sph(r * 0.7, 8, 6), C.stone, -l * 0.5, 0.25 + r * 0.7, r * 1.4);
    K.pop();
  } },
  rocketRack: { size: 1.8, fn(c) {
    for (const pref of [0.15, -0.2]) {
      const at = c.place(0.55, pref, 's'), K = c.kit, out = Math.sign(at.z || 1);
      K.push(at.x, at.y, at.z, 0, 0, 0, c.k);
      K.add(G.box(0.7, 0.5, 0.1), C.dark, 0, 0.25, -0.2).add(G.box(0.7, 0.5, 0.1), C.dark, 0, 0.25, 0.2);
      K.push(0, 0.55, 0, out * -0.6, 0, 0);
      K.add(G.box(0.9, 0.08, 0.6), C.wood, 0, 0, 0);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { K.add(G.cyl(0.05, 0.05, 0.6, 6), j ? 0xb02a1a : 0xd4a83a, -0.25 + i * 0.16, 0.09 + j * 0.1, 0, { rx: PI / 2 }); K.add(G.cone(0.05, 0.14, 6), C.iron, -0.25 + i * 0.16, 0.09 + j * 0.1, 0.37, { rx: PI / 2, m: 0.7 }); }
      K.pop(); K.pop();
    }
  } },
  crystalRing: { size: 2, fn(c) {
    const R = clamp(c.B * 0.26, 0.7, 1.3), at = c.place(R * 0.9, 0.05, 'c'), gc = glowColor(c, 0xb08aff), y = at.y + 1.1 * c.k;
    c.kit.add(G.cyl(0.25, 0.4, 0.5, 6), C.darkStone, at.x, at.y + 0.25, 0).add(G.oct(0.4 * c.k), gc, at.x, y + 0.2, 0, { sy: 1.9, g: 1.8, r: 0.2 });
    const K = new Kit();
    K.add(G.tor(R, 0.05, 4, 24), C.gold, 0, 0, 0, { rx: PI / 2, m: 0.85, r: 0.3 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; K.add(G.oct(0.16 * c.k), gc, Math.cos(a) * R, 0.15, Math.sin(a) * R, { sy: 1.8, g: 2.2, r: 0.2 }); }
    const ring = K.mesh(); ring.position.set(at.x, y, 0);
    c.addMoving(ring, (t, ph) => { ring.rotation.y = t * 0.6; ring.rotation.z = Math.sin(t * 0.7 + ph) * 0.15; ring.position.y = y + Math.sin(t * 1.4 + ph) * 0.1; });
  } },
  lens: { size: 2, fn(c) {
    const R = clamp(c.B * 0.2, 0.55, 1.0), at = c.place(R, 0.25, 'c'), K = c.kit, gc = glowColor(c, 0xff6ad8), y = at.y + R + 0.5;
    K.add(G.cyl(0.22, 0.32, 0.5, 8), C.bronze, at.x, at.y + 0.25, 0, { m: 0.7 });
    for (const z of [-1, 1]) K.bar([at.x, at.y + 0.5, z * 0.2], [at.x, y, z * (R + 0.1)], 0.05, C.gold, { m: 0.8 });
    K.push(at.x, y, 0, 0, 0, -0.45);
    K.add(G.tor(R, 0.08, 5, 20), C.gold, 0, 0, 0, { ry: PI / 2, m: 0.85, r: 0.3 });
    K.add(G.sph(R * 0.95, 12, 8), gc, 0, 0, 0, { sx: 0.18, g: 1.6, r: 0.1, m: 0.3 });
    K.pop();
  } },
  organPipes: { size: 2.2, fn(c) {
    const w = clamp(c.B * 0.5, 1.2, 2.2), at = c.place(0.7, -0.15, 'c'), K = c.kit, n = 7;
    K.push(at.x, at.y, 0);
    K.add(G.box(0.6, 0.4, w), shade(c.hullC, 0.8), 0, 0.2, 0);
    for (let i = 0; i < n; i++) {
      const h = (1.0 + (1 - Math.abs(i - (n - 1) / 2) / ((n - 1) / 2)) * 1.4) * c.k, z = -w / 2 + (w * (i + 0.5)) / n;
      K.add(G.cyl(0.08, 0.09, h, 8), C.gold, 0, 0.4 + h / 2, z, { m: 0.9, r: 0.25 }).add(G.cone(0.1, 0.2, 8), C.gold, 0, 0.4 + h + 0.08, z, { rx: PI, m: 0.9, r: 0.25 });
      K.add(G.box(0.03, 0.06, 0.1), C.black, 0.08, 0.6, z);
    }
    K.pop();
    c.topAt = Math.max(c.topAt || 0, at.y + 3);
  } },
  mirrors: { size: 2, fn(c) {
    const at = c.place(0.8, -0.05, 'c'), K = c.kit, gc = glowColor(c, 0xfff0c0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI * 2 + PI / 4, x = at.x + Math.cos(a) * 0.55, z = Math.sin(a) * 0.55;
      K.add(G.cyl(0.04, 0.06, 0.9, 5), C.gold, x, at.y + 0.45, z, { m: 0.8 });
      K.push(x, at.y + 1.1 * c.k, z, 0, -a, 0.4);
      K.add(G.box(0.05, 0.7 * c.k, 0.55 * c.k), C.gold, 0, 0, 0, { m: 0.85 }).add(G.box(0.02, 0.6 * c.k, 0.46 * c.k), blend(gc, 0xffffff, 0.5), 0.03, 0, 0, { m: 1, r: 0.05, g: 0.6 });
      K.pop();
    }
    K.add(G.oct(0.22), gc, at.x, at.y + 1.0, 0, { g: 2.5, sy: 1.6 });
  } },
  pumpCannon: { size: 2, fn(c) {
    const at = c.place(0.7, 0.25, 'c'), K = c.kit, goo = C.slime;
    K.push(at.x, at.y, 0);
    K.add(G.sph(0.5 * c.k, 10, 8), shade(c.hullC, 0.8), -0.2, 0.5 * c.k, 0, { sy: 0.85 });
    for (let i = 0; i < 4; i++) K.add(G.tor(0.5 * c.k, 0.04, 3, 12), C.iron, -0.2, 0.2 + i * 0.18, 0, { rx: PI / 2, s: 1 - Math.abs(i - 1.5) * 0.15, m: 0.6 });
    K.add(G.tube('pumphose', [[0.2, 0.5, 0], [0.6, 0.7, 0], [1.0, 0.55, 0], [1.4, 0.65, 0]], 0.09, 10, 6), C.iron, 0, 0, 0, { m: 0.5 });
    K.add(G.cyl(0.14, 0.09, 0.3, 8), C.bronze, 1.5, 0.66, 0, { rz: -PI / 2, m: 0.7 });
    for (let i = 0; i < 3; i++) K.add(G.sph(0.06 - i * 0.012, 5, 4), goo, 1.65 + i * 0.05, 0.6 - i * 0.15, 0, { g: 1.6 });
    K.add(G.box(0.4, 0.3, 0.3), C.dark, -0.8, 0.15, 0).add(G.box(0.4, 0.06, 0.32), 0x5a3a2a, -0.8, 0.34, 0, { rz: 0.25 });
    K.pop();
  } },
  skullPile: { size: 1.2, fn(c) {
    const at = c.place(0.55, -0.1, 'c'), K = c.kit;
    for (let i = 0; i < 14; i++) {
      const lvl = i < 7 ? 0 : i < 11 ? 1 : i < 13 ? 2 : 3, a = i * 2.4, r = (3 - lvl) * 0.15;
      K.push(at.x + Math.cos(a) * r, at.y + lvl * 0.2, Math.sin(a) * r, 0, a, 0, 1.2); skull(K); K.pop();
    }
    K.add(G.cyl(0.3, 0.38, 0.6, 8), C.iron, at.x - 0.6, at.y + 0.3, 0, { m: 0.5 }).add(G.cyl(0.2, 0.2, 0.05, 8), C.fire, at.x - 0.6, at.y + 0.61, 0, { g: 2.5 });
  } },
  // ================= stores and furniture =================
  nest: { size: 0.5, fn(c) {
    let p = c.nestAt;
    if (!p) {
      const at = c.place(0.4, -0.38, 'c'), h = clamp(c.L * 0.3, 2.4, 4);
      c.kit.add(G.cyl(0.08, 0.1, h, 6), C.dark, at.x, at.y + h / 2, 0);
      p = [at.x, at.y + h, 0];
    }
    const K = c.kit, r = clamp(c.B * 0.22, 0.6, 1.1);
    K.add(G.tor(r, r * 0.35, 6, 14), 0x6a5236, p[0], p[1] + r * 0.2, p[2], { rx: PI / 2, sy: 1, r: 1 });
    K.add(G.cyl(r * 0.9, r * 0.4, r * 0.4, 10), 0x5a4228, p[0], p[1], p[2]);
    for (let i = 0; i < 10; i++) { const a = i * 0.63; K.bar([p[0] + Math.cos(a) * r * 1.2, p[1] + r * 0.3, p[2] + Math.sin(a) * r * 1.2], [p[0] + Math.cos(a + 1.3) * r * 1.3, p[1] + r * 0.1, p[2] + Math.sin(a + 1.3) * r * 1.3], 0.025, 0x8a6a46); }
    for (let i = 0; i < 3; i++) K.add(G.sph(0.14, 7, 5), 0xe8dcc0, p[0] + (i - 1) * 0.2, p[1] + 0.18, p[2] + (i % 2) * 0.12, { sy: 1.3 });
    c.topAt = Math.max(c.topAt || 0, p[1] + r);
  } },
  perches: { size: 0, fn(c) {
    for (const s of [-1, 1]) for (const x of along(c, 3, 0.2, 0.75)) {
      const y = railY(c, x, s), z = railZ(c, x, s), h = 1.2 * c.k;
      c.kit.bar([x, y - 0.2, z], [x, y + h, z + s * 0.6], 0.06, C.dark);
      c.kit.add(G.cyl(0.05, 0.05, 0.9, 5), C.wood, x, y + h, z + s * 0.6, { rz: PI / 2 });
      c.kit.add(G.cone(0.04, 0.18, 4), C.iron, x + 0.45, y + h + 0.06, z + s * 0.6, { m: 0.7 }).add(G.cone(0.04, 0.18, 4), C.iron, x - 0.45, y + h + 0.06, z + s * 0.6, { m: 0.7 });
    }
  } },
  cages: { size: 1.2, fn(c) {
    const hooks = c.hooks || [];
    for (let i = 0; i < 2; i++) {
      const K = c.kit;
      if (hooks[i]) { const [x, y, z] = hooks[i]; K.push(x, y - 1.1, z); cage(K, 0.32, 0.65); K.pop(); K.bar([x, y, z], [x, y - 0.3, z], 0.015, C.iron); continue; }
      const at = c.place(0.42, i ? -0.25 : 0.05, 's');
      K.push(at.x, at.y, at.z); cage(K, 0.34, 0.75); K.pop();
    }
  } },
  corpses: { size: 0.5, fn(c) {
    for (const s of [-1, 1]) for (const x of along(c, 2, 0.25, 0.7)) {
      const y = railY(c, x, s), z = railZ(c, x, s), K = c.kit;
      K.add(G.box(0.1, 1.6, 0.1), C.dark, x, y + 0.6, z).add(G.box(0.08, 0.08, 0.6), C.dark, x, y + 1.35, z + s * 0.25);
      K.bar([x, y + 1.35, z + s * 0.5], [x, y + 1.05, z + s * 0.5], 0.012, C.rope);
      K.add(G.custom('corpse', () => new THREE.CapsuleGeometry(0.11, 0.5, 2, 6)), 0x7a7060, x, y + 0.7, z + s * 0.5, { rz: 0.08 }).add(G.sph(0.09, 6, 4), 0x9a8a70, x, y + 1.05, z + s * 0.5);
    }
    const at = c.place(0.5, -0.15, 's');
    c.kit.add(G.custom('corpse', () => new THREE.CapsuleGeometry(0.11, 0.5, 2, 6)), 0x7a7060, at.x, at.y + 0.1, at.z, { rz: PI / 2 }).add(G.custom('corpse', () => new THREE.CapsuleGeometry(0.11, 0.5, 2, 6)), 0x6a6050, at.x + 0.1, at.y + 0.1, at.z + 0.25, { rz: PI / 2, ry: 0.4 });
  } },
  barrels: { size: 1, fn(c) {
    for (const pref of [0.25, -0.32]) {
      const at = c.place(0.45, pref, 's'), K = c.kit;
      for (let i = 0; i < 4; i++) { K.push(at.x + (i % 2) * 0.34 - 0.17, at.y + (i === 3 ? 0.44 : 0), at.z + (i === 2 ? 0.3 * -Math.sign(at.z || 1) : 0) + (i === 3 ? -0.1 * Math.sign(at.z || 1) : 0)); barrel(K); K.pop(); }
    }
  } },
  crates: { size: 1, fn(c) {
    for (const pref of [0.08, -0.38]) {
      const at = c.place(0.45, pref, 's'), K = c.kit;
      const st = [[0, 0, 0, 0.4], [0.42, 0, 0.05, 0.36], [0.2, 0.4, 0, 0.34], [-0.05, 0, -0.35 * Math.sign(at.z || 1), 0.3]];
      st.forEach(([dx, dy, dz, s], i) => { K.add(G.box(s, s, s), i % 2 ? C.plank : 0x9a7a4a, at.x + dx - 0.2, at.y + dy + s / 2, at.z + dz, { ry: hash(i) * 0.5 }); K.add(G.box(s * 1.01, 0.04, s * 1.01), C.dark, at.x + dx - 0.2, at.y + dy + s * 0.5, at.z + dz, { ry: hash(i) * 0.5 }); });
    }
  } },
  tables: { size: 1.4, fn(c) {
    for (const pref of [0.1, -0.2]) {
      const at = c.place(0.55, pref, 'c'), K = c.kit;
      K.add(G.box(1.1, 0.06, 0.5), C.plank, at.x, at.y + 0.5, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.add(G.box(0.06, 0.5, 0.06), C.dark, at.x + sx * 0.48, at.y + 0.25, sz * 0.2);
      for (const sz of [-1, 1]) K.add(G.box(1.0, 0.05, 0.18), C.dark, at.x, at.y + 0.28, sz * 0.42);
      K.add(G.cyl(0.07, 0.06, 0.14, 6), C.bronze, at.x - 0.3, at.y + 0.6, 0.05, { m: 0.6 }).add(G.sph(0.1, 6, 4), 0xb05a3a, at.x + 0.2, at.y + 0.58, -0.05).add(G.box(0.25, 0.04, 0.18), C.cloth, at.x + 0.05, at.y + 0.55, 0.1);
    }
  } },
  chimneys: { size: 1.4, fn(c) {
    const n = c.L > 10 ? 3 : 2, K = c.kit, grp = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const at = c.place(0.35, -0.1 + (i - (n - 1) / 2) * 0.16, 's'), h = (1.6 + hash(i) * 0.6) * c.k;
      K.add(G.box(0.4, h, 0.4), C.brick, at.x, at.y + h / 2, at.z).add(G.box(0.5, 0.14, 0.5), shade(C.brick, 0.7), at.x, at.y + h, at.z);
      for (let k = 1; k < 4; k++) K.add(G.box(0.41, 0.025, 0.41), 0x6a3a2a, at.x, at.y + (h * k) / 4, at.z);
      K.add(G.box(0.3, 0.02, 0.3), C.fire, at.x, at.y + h + 0.07, at.z, { g: 2 });
      for (let k = 0; k < 2; k++) { const o = new THREE.Mesh(G.ico(1, 1), smoke()); o.userData.p = { x: at.x, y: at.y + h, z: at.z, k }; grp.add(o); }
    }
    c.addMoving(grp, (t, ph) => grp.children.forEach((o) => { const p = o.userData.p, f = (t * 0.3 + p.k * 0.5 + ph * 0.1) % 1; o.position.set(p.x - f * 1.1, p.y + 0.25 + f * 1.3, p.z); o.scale.setScalar(0.18 * (1 + f * 2)); }));
  } },
  drums: { size: 1.6, fn(c) {
    const at = c.place(0.8, 0.0, 'c'), K = c.kit, skin = 0xd8c8a0;
    [[0, 0, 0.5], [-0.55, 0.35, 0.35], [-0.5, -0.4, 0.38]].forEach(([dx, dz, r], i) => {
      const h = r * 1.3, bx = at.x + dx, bz = dz;
      K.add(G.cyl(r, r * 0.9, h, 12), i ? c.side : 0x8a2a1a, bx, at.y + h / 2 + 0.2, bz).add(G.cyl(r * 1.02, r * 1.02, 0.03, 12), skin, bx, at.y + h + 0.21, bz);
      for (const y of [0.25, h + 0.15]) K.add(G.tor(r, 0.03, 3, 12), C.bronze, bx, at.y + y, bz, { rx: PI / 2, m: 0.6 });
      for (let k = 0; k < 3; k++) K.add(G.box(0.05, 0.2, 0.05), C.dark, bx + Math.cos(k * 2.1) * r * 0.8, at.y + 0.1, bz + Math.sin(k * 2.1) * r * 0.8);
      K.bar([bx + r * 0.3, at.y + h + 0.6, bz], [bx, at.y + h + 0.25, bz + 0.1], 0.025, C.bone);
    });
  } },
  totem: { size: 1.4, fn(c) {
    const at = c.place(0.4, -0.32, 'c'), K = c.kit, h = clamp(c.L * 0.28, 2.2, 3.6), cols = [0x8a2a1a, 0x2a5a8a, 0xd4a83a, 0x2a6a3a];
    K.push(at.x, at.y, 0);
    const n = 4, sh = h / (n + 0.5);
    for (let i = 0; i < n; i++) {
      K.add(G.cyl(0.26, 0.28, sh, 8), shade(C.wood, 0.9 + (i % 2) * 0.2), 0, sh * (i + 0.5), 0);
      K.add(G.box(0.08, sh * 0.25, 0.4), cols[i % 4], 0.25, sh * (i + 0.6), 0).add(G.box(0.12, 0.05, 0.08), C.black, 0.28, sh * (i + 0.8), 0.1).add(G.box(0.12, 0.05, 0.08), C.black, 0.28, sh * (i + 0.8), -0.1);
      K.add(G.cone(0.08, 0.2, 4), cols[(i + 1) % 4], 0.3, sh * (i + 0.45), 0, { rz: -PI / 2 });
    }
    for (const s of [-1, 1]) K.add(G.shape('totwing', [[0, 0], [0.2, 0.25], [0.1, 0.9], [-0.1, 0.1]], 0.05), cols[0], 0, h - sh * 0.6, s * 0.25, { rx: s * -1.2, sx: 1, sy: 1 });
    K.pop();
    c.topAt = Math.max(c.topAt || 0, at.y + h + 0.5);
  } },
  braziers: { size: 0, fn(c) {
    const grp = new THREE.Group(), fm = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const s of [-1, 1]) for (const x of along(c, 2, 0.22, 0.78)) {
      const y = c.deckAt(x, s * c.B * 0.28), z = s * (c.hw(x) - 0.3), K = c.kit;
      for (let k = 0; k < 3; k++) { const a = (k / 3) * PI * 2; K.bar([x + Math.cos(a) * 0.22, y, z + Math.sin(a) * 0.22], [x, y + 0.7, z], 0.025, C.iron, { m: 0.6 }); }
      K.add(G.cyl(0.24, 0.14, 0.2, 8), C.iron, x, y + 0.78, z, { m: 0.6 }).add(G.sph(0.16, 6, 4), C.fire, x, y + 0.86, z, { g: 3, sy: 0.4 });
      const f = new THREE.Mesh(G.cone(0.17, 0.5, 6), fm); f.position.set(x, y + 1.1, z); grp.add(f);
      c.keep.push([x, z, 0.35]);
    }
    c.addMoving(grp, (t, ph) => grp.children.forEach((f, i) => { const k = 0.8 + 0.3 * Math.sin(t * 9 + i * 1.7 + ph) + 0.15 * Math.sin(t * 17 + i); f.scale.set(1, k, 1); }));
  } },
  lanterns: { size: 0, fn(c) {
    const gc = glowColor(c, 0xffc86a), K = c.kit;
    for (const s of [-1, 1]) for (const x of along(c, 3, 0.12, 0.85)) {
      const y = railY(c, x, s), z = railZ(c, x, s) - s * 0.05;
      K.add(G.cyl(0.03, 0.03, 0.9, 4), C.dark, x, y + 0.35, z).add(G.box(0.03, 0.03, 0.25), C.dark, x, y + 0.78, z + s * 0.1);
      K.add(G.cyl(0.11, 0.13, 0.26, 6), gc, x, y + 0.62, z + s * 0.2, { g: 2.2, r: 0.4 }).add(G.cone(0.14, 0.1, 6), C.iron, x, y + 0.79, z + s * 0.2, { m: 0.6 });
    }
  } },
  banners: { size: 0, fn(c) {
    const K = c.kit, n = c.L > 10 ? 3 : 2, h = 1.9 * c.k;
    for (const s of [-1, 1]) for (const [i, x] of along(c, n, 0.12, 0.8).entries()) {
      const y = railY(c, x, s) - 0.15, z = railZ(c, x, s) - s * 0.08;
      K.add(G.cyl(0.03, 0.035, h, 5), C.dark, x, y + h / 2, z).add(G.sph(0.06, 6, 4), C.gold, x, y + h + 0.04, z, { m: 0.8 });
      K.add(G.box(0.04, 0.04, 0.5), C.dark, x, y + h - 0.08, z + s * 0.0, { ry: PI / 2 });
      K.add(G.shape('banner', [[-0.25, 0], [0.25, 0], [0.25, -0.9], [0, -0.75], [-0.25, -0.9]]), (i + (s > 0 ? 1 : 0)) % 2 ? c.side : c.trimC, x, y + h - 0.1, z, { sx: c.k, sy: c.k, ry: PI / 2 + 0.25 * s });
    }
  } },
  shields: { size: 0, fn(c) {
    const K = c.kit;
    for (const s of [-1, 1]) {
      const xs = along(c, Math.max(5, Math.round(c.L * 0.8)), 0.12, 0.84);
      xs.forEach((x, i) => {
        const y = railY(c, x, s) - 0.25, z = railZ(c, x, s) + s * 0.06, r = 0.26 * c.k;
        K.add(G.cyl(r, r, 0.05, 12), i % 2 ? c.side : c.trimC, x, y, z, { rx: PI / 2 });
        K.add(G.tor(r, 0.025, 3, 12), C.iron, x, y, z + s * 0.01, { m: 0.6 }).add(G.sph(r * 0.25, 6, 4), C.iron, x, y, z + s * 0.03, { m: 0.7, sz: 0.6 });
      });
    }
  } },
  spikes: { size: 0, fn(c) {
    const K = c.kit;
    for (const s of [-1, 1]) for (const x of along(c, Math.max(6, Math.round(c.L)), 0.06, 0.92)) {
      const y = railY(c, x, s) - 0.15, z = railZ(c, x, s);
      K.add(G.cone(0.07, 0.5 * c.k, 5), C.iron, x, y + 0.15, z + s * 0.12, { rx: s * 0.9, m: 0.7, r: 0.4 });
    }
    for (let i = 0; i < 3; i++) K.add(G.cone(0.08, 0.6, 5), C.iron, c.bowX - 0.3 - i * 0.3, c.deckAt(c.bowX - 0.5) + 0.3, 0, { rz: -1.2, m: 0.7 });
  } },
  plates: { size: 0, fn(c) {
    const K = c.kit, col = blend(c.hullC, C.steel, 0.55);
    for (const s of [-1, 1]) {
      const xs = along(c, Math.max(4, Math.round(c.L * 0.5)), 0.1, 0.84);
      xs.forEach((x, i) => {
        const y1 = hullH(c, x) * 0.88, y0 = 0.08, zl = c.hwLo(x) + 0.04, zh = c.hw(x) + 0.04, tilt = Math.atan2(zh - zl, y1 - y0);
        const z = s * (zl + zh) / 2, w = (c.bowX - c.sternX) * 0.74 / xs.length + 0.08, h = Math.hypot(y1 - y0, zh - zl);
        K.add(G.box(w, h, 0.06), shade(col, 0.85 + (i % 2) * 0.15), x, (y0 + y1) / 2, z, { rx: s * tilt, m: 0.7, r: 0.45 });
        for (const yy of [0.15, 0.85]) for (const xx of [-0.4, 0, 0.4]) K.add(G.sph(0.035, 4, 3), C.iron, x + xx * w, y0 + (y1 - y0) * yy, s * (lerp(zl, zh, yy) + 0.035), { m: 0.8 });
      });
    }
  } },
  chains: { size: 0, fn(c) {
    const K = c.kit;
    for (const s of [-1, 1]) {
      const xs = along(c, 4, 0.12, 0.85);
      for (let i = 0; i < xs.length - 1; i++) {
        const a = [xs[i], railY(c, xs[i], s) - 0.15, railZ(c, xs[i], s) + s * 0.05], b = [xs[i + 1], railY(c, xs[i + 1], s) - 0.15, railZ(c, xs[i + 1], s) + s * 0.05];
        K.rope(a, b, 0.45, 0.045, C.iron, { m: 0.7, r: 0.45 });
      }
      for (const x of xs) K.add(G.tor(0.09, 0.03, 4, 8), C.iron, x, railY(c, x, s) - 0.2, railZ(c, x, s) + s * 0.06, { m: 0.7 });
    }
    // an anchor at the bow
    const bx = c.bowX - c.L * 0.08, z = c.hw(bx) + 0.1, y = c.deckAt(bx) - 0.2;
    K.bar([bx, y, z], [bx - 0.1, y - 0.9, z + 0.05], 0.05, C.iron, { m: 0.7 }).add(G.tor(0.3, 0.05, 4, 10, PI), C.iron, bx - 0.1, y - 0.9, z + 0.05, { rz: PI, m: 0.7 });
  } },
  skulls: { size: 0, fn(c) {
    const K = c.kit;
    for (const s of [-1, 1]) for (const x of along(c, 3, 0.15, 0.85)) {
      const y = railY(c, x, s), z = railZ(c, x, s);
      K.add(G.cyl(0.02, 0.02, 0.7, 4), C.dark, x, y + 0.2, z);
      K.push(x, y + 0.55, z, 0, s > 0 ? -PI / 2 : PI / 2, 0, 1.3); skull(K); K.pop();
    }
    K.push(c.bowX - 0.2, c.deckAt(c.bowX - 0.4) + 0.3, 0, 0, 0, 0, 2.2); skull(K); K.pop();
  } },
  gargoyles: { size: 0, fn(c) {
    const K = c.kit, st = blend(C.darkStone, c.hullC, 0.2);
    for (const s of [-1, 1]) for (const x of [lerp(c.sternX, c.bowX, 0.12), lerp(c.sternX, c.bowX, 0.85)]) {
      const y = railY(c, x, s), z = railZ(c, x, s);
      K.push(x, y, z, 0, s > 0 ? -PI / 2 : PI / 2, 0, c.k);
      K.add(G.sph(0.22, 7, 5), st, 0, 0.25, 0, { sx: 1.2 }).add(G.sph(0.14, 7, 5), st, 0.22, 0.45, 0).add(G.cone(0.06, 0.18, 4), st, 0.38, 0.42, 0, { rz: -PI / 2 });
      for (const w of [-1, 1]) { K.add(G.shape('gwing', [[0, 0], [-0.4, 0.5], [-0.25, 0.2], [-0.5, 0.25]], 0.03), st, -0.05, 0.3, w * 0.15, { ry: w * 0.6 }); K.add(G.cone(0.03, 0.14, 4), st, 0.15, 0.58, w * 0.07); K.add(G.sph(0.03, 4, 3), 0xff4a1a, 0.33, 0.5, w * 0.06, { g: 3 }); }
      K.pop();
    }
  } },
  astrolabe: { size: 1.6, fn(c) {
    const at = c.place(0.6, -0.3, 'c'), R = 0.55 * c.k, y = at.y + 0.9 + R;
    c.kit.add(G.cyl(0.12, 0.25, 0.9, 6), C.bronze, at.x, at.y + 0.45, 0, { m: 0.8, r: 0.3 }).add(G.sph(0.14, 8, 6), 0x4a8aff, at.x, y, 0, { g: 1.5 });
    const K = new Kit();
    K.add(G.tor(R, 0.035, 4, 24), C.gold, 0, 0, 0, { m: 0.9, r: 0.25 }).add(G.tor(R * 0.86, 0.03, 4, 22), C.gold, 0, 0, 0, { rx: PI / 2, m: 0.9, r: 0.25 }).add(G.tor(R * 0.72, 0.03, 4, 20), C.bronze, 0, 0, 0, { ry: PI / 2, m: 0.9, r: 0.25 });
    K.add(G.tor(R * 1.05, 0.02, 3, 24), C.gold, 0, 0, 0, { rx: PI / 2 - 0.4, m: 0.9 });
    const m = K.mesh(); m.position.set(at.x, y, 0);
    c.addMoving(m, (t) => { m.rotation.y = t * 0.5; m.rotation.x = Math.sin(t * 0.3) * 0.3; });
  } },
  bells: { size: 1.6, fn(c) {
    const at = c.place(0.6, -0.12, 'c'), K = c.kit, w = clamp(c.B * 0.4, 1.0, 1.8), h = 1.7 * c.k;
    for (const z of [-1, 1]) K.add(G.box(0.12, h, 0.12), C.dark, at.x, at.y + h / 2, z * w / 2);
    K.add(G.box(0.14, 0.14, w + 0.2), C.dark, at.x, at.y + h, 0);
    const bell = G.lathe('bell', [[0, 0.5], [0.12, 0.48], [0.2, 0.36], [0.22, 0.12], [0.32, 0], [0.3, -0.03]], 10);
    [-0.3, 0, 0.3].forEach((f, i) => { const s = (i === 1 ? 1.1 : 0.8) * c.k; K.add(bell, C.bronze, at.x, at.y + h - 0.6 * s, f * w, { s, m: 0.85, r: 0.3 }); K.add(G.sph(0.05, 5, 4), C.iron, at.x, at.y + h - 0.6 * s - 0.02, f * w); });
  } },
  pustules: { size: 0, fn(c) {
    const K = new Kit(), goo = blend(C.slime, 0xd8e05a, 0.3), flesh = blend(c.hullC, C.flesh, 0.5);
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
      const x = lerp(c.sternX, c.bowX, 0.12 + i * 0.14 + hash(i + s) * 0.05), top = hullH(c, x), y = top * (0.35 + hash(i * 3 + s) * 0.4), z = s * (c.hw(x) + 0.05), r = (0.18 + hash(i + 2) * 0.16) * c.k;
      K.add(G.sph(r * 1.2, 8, 6), flesh, x, y, z, { sz: 0.6 }).add(G.sph(r, 8, 6), goo, x, y, z + s * r * 0.4, { g: 1.1, r: 0.25 });
    }
    for (let i = 0; i < 4; i++) { const at = c.place(0.25, (hash(i) - 0.5) * 0.7, 's', false); K.add(G.sph(0.22 * c.k, 8, 6), goo, at.x, at.y + 0.1, at.z, { g: 1.1, r: 0.25, sy: 0.7 }); }
    const m = K.mesh();
    c.addMoving(m, (t, ph) => { const k = 1 + 0.03 * Math.sin(t * 2.2 + ph); m.scale.set(1, k, 1); });
  } },
  vines: { size: 0, fn(c) {
    const K = c.kit, vine = 0x3a6a2a, leaf = C.leaf;
    for (const s of [-1, 1]) {
      const xs = along(c, 7, 0.05, 0.95);
      for (let i = 0; i < xs.length - 1; i++) {
        const a = [xs[i], railY(c, xs[i], s) - 0.1, railZ(c, xs[i], s) + s * 0.06], b = [xs[i + 1], railY(c, xs[i + 1], s) - 0.1, railZ(c, xs[i + 1], s) + s * 0.06];
        K.rope(a, b, 0.25 + hash(i) * 0.3, 0.05, vine, { m: 0, r: 0.9 });
        K.add(G.ico(0.16, 0), shade(leaf, 0.8 + hash(i) * 0.4), (a[0] + b[0]) / 2, a[1] - 0.3, a[2], { sy: 0.5 });
        K.bar([a[0], a[1], a[2]], [a[0] + 0.1, a[1] - 0.6 - hash(i + 3) * 0.6, a[2] + s * 0.04], 0.025, vine);
      }
    }
    for (const x of along(c, 2, 0.3, 0.7)) K.add(G.ico(0.3, 0), leaf, x, c.deckAt(x) + 0.2, 0, { sy: 0.5 });
  } },
  bones: { size: 1, fn(c) {
    const K = c.kit;
    for (const x of along(c, 4, 0.2, 0.8)) {
      const w = c.hw(x), y = c.deckAt(x, c.B * 0.28);
      K.add(G.tor(w * 0.95, 0.07 * c.k, 5, 14, PI), C.bone, x, y + 0.15, 0, { ry: PI / 2, sy: 1.5, r: 0.7 });
      for (const s of [-1, 1]) K.add(G.cone(0.08, 0.5, 5), C.bone, x, y + 0.35, s * (w + 0.15), { rx: s * 1.2 });
    }
    K.add(G.cyl(0.08, 0.06, (c.bowX - c.sternX) * 0.6, 6), C.bone, (c.bowX + c.sternX) / 2, c.dy + c.hw(0) * 1.4 + 0.15, 0, { rz: PI / 2 });
    const at = c.place(0.4, 0.3, 's', false); K.push(at.x, at.y, at.z, 0, 0.5, 0, 1.4); skull(K); K.pop();
  } },
  cranes: { size: 1.4, fn(c) {
    c.hooks = [];
    for (const [pref, s] of [[0.15, 1], [-0.2, -1]]) {
      const at = c.place(0.35, pref, 's'), z0 = at.z, sg = Math.sign(z0) || s, K = c.kit, h = 2 * c.k, reach = c.hw(at.x) + 0.9;
      K.add(G.box(0.18, h, 0.18), C.dark, at.x, at.y + h / 2, z0).add(G.cyl(0.18, 0.2, 0.15, 8), C.iron, at.x, at.y + 0.08, z0, { m: 0.6 });
      const tip = [at.x, at.y + h + 0.5, sg * reach];
      K.bar([at.x, at.y + h * 0.4, z0], tip, 0.06, C.wood).bar([at.x, at.y + h, z0], tip, 0.03, C.rope);
      K.add(G.cyl(0.12, 0.12, 0.2, 8), C.iron, at.x, at.y + h * 0.5, z0 - sg * 0.15, { rx: PI / 2, m: 0.6 });
      K.bar(tip, [tip[0], tip[1] - 0.6, tip[2]], 0.015, C.rope).add(G.tor(0.07, 0.02, 3, 8, PI * 1.5), C.iron, tip[0], tip[1] - 0.66, tip[2], { m: 0.7 });
      c.hooks.push([tip[0], tip[1] - 0.3, tip[2]]);
    }
  } },
  anvil: { size: 1, fn(c) {
    const at = c.place(0.5, 0.0, 's'), K = c.kit;
    K.push(at.x, at.y, at.z, 0, 0, 0, c.k);
    K.add(G.cyl(0.25, 0.3, 0.45, 8), C.wood, 0, 0.22, 0).add(G.box(0.5, 0.16, 0.22), C.iron, 0, 0.53, 0, { m: 0.7, r: 0.4 }).add(G.box(0.3, 0.12, 0.16), C.iron, 0, 0.4, 0, { m: 0.7 });
    K.add(G.cone(0.08, 0.25, 4), C.iron, 0.35, 0.55, 0, { rz: -PI / 2, m: 0.7 }).add(G.box(0.2, 0.05, 0.08), 0xff6a1a, -0.05, 0.64, 0, { g: 3 });
    K.add(G.box(0.12, 0.1, 0.1), C.iron, 0.1, 0.68, 0.18, { m: 0.7 }).bar([0.1, 0.66, 0.18], [0.1, 0.62, 0.55], 0.02, C.wood);
    K.add(G.box(0.5, 0.55, 0.45), C.brick, -0.65, 0.28, 0).add(G.box(0.3, 0.2, 0.05), C.fire, -0.65, 0.3, 0.23, { g: 2.5 });
    K.pop();
  } },
  cauldron: { size: 1.4, fn(c) {
    const at = c.place(0.6, -0.05, 'c'), K = c.kit, r = 0.5 * c.k, goo = c.def.realm && /morbus|plague|screaming/.test(c.def.realm) ? C.slime : 0x6aff5a;
    for (let k = 0; k < 3; k++) { const a = (k / 3) * PI * 2; K.bar([at.x + Math.cos(a) * r * 1.2, at.y, Math.sin(a) * r * 1.2], [at.x, at.y + r * 2.6, 0], 0.04, C.iron, { m: 0.6 }); }
    K.add(G.lathe('cauldron', [[0, 0], [0.6, 0.05], [0.95, 0.35], [1, 0.7], [0.85, 0.95], [0.9, 1.0]], 12), C.iron, at.x, at.y + 0.2, 0, { s: r, m: 0.6, r: 0.5 });
    K.add(G.circle(r * 0.86, 12), goo, at.x, at.y + 0.2 + r * 0.92, 0, { rx: -PI / 2, g: 2 });
    for (let i = 0; i < 3; i++) K.add(G.sph(0.07 * c.k, 5, 4), goo, at.x + (hash(i) - 0.5) * r, at.y + 0.25 + r, (hash(i + 4) - 0.5) * r, { g: 2 });
    flame(K, at.x, at.y, 0, 0.9);
  } },
  vats: { size: 1.8, fn(c) {
    const at = c.place(0.75, -0.1, 'c'), K = c.kit, goo = 0xa0ff3a;
    [[0, 0.32], [-0.62, -0.25], [0.55, -0.35]].forEach(([dx, dz], i) => {
      const r = (0.38 - i * 0.04) * c.k, h = r * 2.1;
      K.add(G.cyl(r, r * 1.05, h, 10, true), C.wood, at.x + dx, at.y + h / 2, dz);
      for (const y of [0.2, 0.8]) K.add(G.tor(r * 1.02, 0.03, 3, 12), C.iron, at.x + dx, at.y + h * y, dz, { rx: PI / 2, m: 0.6 });
      K.add(G.circle(r * 0.96, 10), goo, at.x + dx, at.y + h * 0.9, dz, { rx: -PI / 2, g: 1.8 });
    });
    K.bar([at.x, at.y + 0.85, 0.32], [at.x + 0.55, at.y + 0.75, -0.35], 0.05, C.bronze, { m: 0.7 });
  } },
};

let smokeM = null;
function smoke() { return (smokeM ||= new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 1, transparent: true, opacity: 0.5, depthWrite: false })); }
