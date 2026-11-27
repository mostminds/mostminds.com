// The land itself: a shaded, textured ground mesh that follows the battle's hills and cliffs, and
// the small things that grow and lie on it (grasses, flowers, bushes, reeds, stones, logs, bones,
// drifts, lava cracks ...), chosen by biome and scattered in patches the way they grow.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRASS, SAND, SHALLOW, DEEP, FORD } from '../engine/terrain.js';

const srgb = (hex) => new THREE.Color(hex);
const rgb = (a) => new THREE.Color().setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace);

// what each land is made of besides its grass: bare soil, lush growth, dry growth, rock, and what lies on the heights
const GROUND = {
  temperate: { soil: 0x6e5a3c, lush: 0x2f6a2a, dry: 0x9a9a4a, rock: 0x8a857a, rock2: 0x6f6a62, top: 0x7f9a52 },
  snow:      { soil: 0x8a8f96, lush: 0xe8eef4, dry: 0xb8c4cc, rock: 0x7f8894, rock2: 0x5f6874, top: 0xf4f8fc },
  desert:    { soil: 0xb8884e, lush: 0x9a9a52, dry: 0xd8b874, rock: 0xb0774a, rock2: 0x8a5a3a, top: 0xd8a868 },
  swamp:     { soil: 0x3a3424, lush: 0x2a4a22, dry: 0x5a5a32, rock: 0x5a5a4a, rock2: 0x44443a, top: 0x4a5a2e },
  volcanic:  { soil: 0x2a2020, lush: 0x3a3230, dry: 0x4a3a34, rock: 0x2c2828, rock2: 0x1c1a1a, top: 0x3a3030 },
  jungle:    { soil: 0x5a4226, lush: 0x146a1c, dry: 0x6a8a2a, rock: 0x6a6a5a, rock2: 0x50503e, top: 0x2a7a2a },
};

function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

let grain = null;
/** a tiling grain so the ground is never one flat colour up close: speckle, short strokes, a few pebbles */
function grainTexture() {
  if (grain) return grain;
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, S, S);
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 5200; i++) {
    const v = 190 + Math.floor(r() * 65), x = r() * S, y = r() * S, a = 0.25 + r() * 0.35;
    g.fillStyle = `rgba(${v},${v},${v},${a})`;
    g.fillRect(x, y, 1 + r() * 2, 1 + r() * 2);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 1500; i++) {
    const x = r() * S, y = r() * S, l = 3 + r() * 6, d = (r() - 0.5) * 3, v = r() < 0.5 ? 150 + r() * 40 : 240 + r() * 15;
    g.strokeStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.3 + r() * 0.3})`; g.lineWidth = 0.8 + r() * 0.8;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + d, y + oy - l); g.stroke(); }
  }
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, rad = 1.5 + r() * 2.5, v = 165 + r() * 40;
    g.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},0.55)`; g.beginPath(); g.ellipse(x, y, rad, rad * 0.7, r() * 3, 0, 7); g.fill();
  }
  grain = new THREE.CanvasTexture(cv);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.colorSpace = THREE.SRGBColorSpace; grain.anisotropy = 4;
  return grain;
}

/**
 * The ground for a battle. Returns { mesh, hCorner, heightAt(x, z) }.
 * hCorner holds one height per tile corner ((W+1) x (H+1)), which is what units and buildings stand on.
 */
export function buildGround(b, bio, biomeId) {
  const W = b.W, H = b.H, V = W + 1, G = GROUND[biomeId] || GROUND.temperate;
  const tileAt = (x, y) => Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x));
  const BASE = [0, -0.05, -0.34, -1.3, -0.1]; // grass, sand, shallow, deep, ford
  const COL = [rgb(bio.grass), rgb(bio.sand), rgb(bio.shallow), srgb(bio.floor).multiplyScalar(1.6), rgb(bio.sand).lerp(srgb(0x8a8478), 0.55)];
  const soil = srgb(G.soil), lush = srgb(G.lush), dry = srgb(G.dry), rock = srgb(G.rock), rock2 = srgb(G.rock2), top = srgb(G.top);
  const hgt = b.height, seed = (b.seed | 0) + W;
  // a road among buildings is paved
  if (b.road && !b.paved) {
    b.paved = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!b.road[y * W + x]) continue;
      let n = 0;
      for (let dy = -3; dy <= 3 && n < 2; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && b.sid[yy * W + xx] && b.blockMove[yy * W + xx]) n++; }
      if (n >= 2) b.paved[y * W + x] = 1;
    }
  }
  const road = srgb(G.soil).lerp(srgb(0xb89a70), 0.45), road2 = srgb(G.rock).lerp(srgb(0x9a9488), 0.6); // dirt tracks, and stone setts in the towns
  // per tile corner: height, base colour, and how much of it is dry land
  const hc = new Float32Array(V * V), cc = new Float32Array(V * V * 3), land = new Float32Array(V * V), cl = new Float32Array(V * V), rd = new Float32Array(V * V);
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
    const k = y * V + x;
    let h = 0, r = 0, g = 0, bl = 0, d = 0, c = 0;
    for (const i of [tileAt(x - 1, y - 1), tileAt(x, y - 1), tileAt(x - 1, y), tileAt(x, y)]) {
      const t = b.terrain[i];
      h += (BASE[t] + (hgt ? hgt[i] : 0)) / 4; r += COL[t].r / 4; g += COL[t].g / 4; bl += COL[t].b / 4;
      if (t === GRASS) d += 0.25;
      if (b.cliff && b.cliff[i]) c += 0.25;
      if (b.road && b.road[i]) rd[k] += 0.25;
    }
    hc[k] = h; cc[k * 3] = r; cc[k * 3 + 1] = g; cc[k * 3 + 2] = bl; land[k] = d; cl[k] = c;
  }
  const corner = (x, y) => hc[Math.max(0, Math.min(H, y)) * V + Math.max(0, Math.min(W, x))];
  const heightAt = (x, z) => {
    const xi = Math.max(0, Math.min(W - 1, Math.floor(x))), yi = Math.max(0, Math.min(H - 1, Math.floor(z)));
    const fx = Math.max(0, Math.min(1, x - xi)), fy = Math.max(0, Math.min(1, z - yi));
    const a = hc[yi * V + xi], bb = hc[yi * V + xi + 1], c = hc[(yi + 1) * V + xi], d = hc[(yi + 1) * V + xi + 1];
    return a + (bb - a) * fx + (c - a) * fy + (a - bb - c + d) * fx * fy;
  };
  // the mesh is twice as fine as the tiles, so slopes are rounded and colour patches have soft edges
  const SUB = 2, FW = W * SUB, FH = H * SUB, FV = FW + 1;
  const pos = new Float32Array(FV * (FH + 1) * 3), col = new Float32Array(FV * (FH + 1) * 3), uv = new Float32Array(FV * (FH + 1) * 2);
  const c = new THREE.Color(), tmp = new THREE.Color();
  for (let j = 0; j <= FH; j++) for (let i = 0; i <= FW; i++) {
    const x = i / SUB, z = j / SUB, k = j * FV + i;
    const xi = Math.min(W - 1, Math.floor(x)), yi = Math.min(H - 1, Math.floor(z)), fx = x - xi, fy = z - yi;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    const k00 = yi * V + xi, k10 = k00 + 1, k01 = k00 + V, k11 = k01 + 1;
    let h = hc[k00] * w00 + hc[k10] * w10 + hc[k01] * w01 + hc[k11] * w11;
    const dryness = land[k00] * w00 + land[k10] * w10 + land[k01] * w01 + land[k11] * w11;
    const cliffy = cl[k00] * w00 + cl[k10] * w10 + cl[k01] * w01 + cl[k11] * w11;
    const roady = rd[k00] * w00 + rd[k10] * w10 + rd[k01] * w01 + rd[k11] * w11;
    c.setRGB(cc[k00 * 3] * w00 + cc[k10 * 3] * w10 + cc[k01 * 3] * w01 + cc[k11 * 3] * w11,
      cc[k00 * 3 + 1] * w00 + cc[k10 * 3 + 1] * w10 + cc[k01 * 3 + 1] * w01 + cc[k11 * 3 + 1] * w11,
      cc[k00 * 3 + 2] * w00 + cc[k10 * 3 + 2] * w10 + cc[k01 * 3 + 2] * w01 + cc[k11 * 3 + 2] * w11);
    // how steep the ground is here
    const sx = (corner(xi + 1, yi) + corner(xi + 1, yi + 1) - corner(xi, yi) - corner(xi, yi + 1)) / 2;
    const sz = (corner(xi, yi + 1) + corner(xi + 1, yi + 1) - corner(xi, yi) - corner(xi + 1, yi)) / 2;
    const slope = Math.hypot(sx, sz);
    const n1 = vnoise(x * 0.09, z * 0.09, seed), n2 = vnoise(x * 0.31, z * 0.31, seed + 3), n3 = vnoise(x * 1.3, z * 1.3, seed + 7);
    if (dryness > 0.05) {
      // patches: meadows of lush growth, dry stretches, worn soil
      const lushness = Math.max(0, n1 - 0.55) * 2.6, dryish = Math.max(0, 0.42 - n1) * 2.4, bare = Math.max(0, n2 - 0.7) * 2.4;
      c.lerp(lush, Math.min(0.6, lushness) * dryness);
      c.lerp(dry, Math.min(0.55, dryish) * dryness);
      c.lerp(soil, Math.min(0.7, bare) * dryness);
      // the heights: thinner, paler cover (snow in the north, bare rock in the desert)
      const up = Math.max(0, Math.min(1, (h - 1.1) / 1.6));
      c.lerp(top, up * 0.55 * dryness);
      // rock shows through on steep ground and makes the cliffs; strata give the faces their bands
      const rk = Math.max(Math.min(1, Math.max(0, slope - 0.38) * 2.2), cliffy * 0.9) * dryness;
      if (rk > 0) {
        tmp.copy(rock).lerp(rock2, (Math.sin(h * 9 + n2 * 4) * 0.5 + 0.5) * 0.7);
        c.lerp(tmp, Math.min(1, rk));
        h += (n3 - 0.5) * 0.16 * Math.min(1, rk); // broken faces, not smooth ramps
      }
      h += (n2 - 0.5) * 0.1 * dryness + (n3 - 0.5) * 0.035 * dryness;
      // roads: packed earth in the country, setts in the towns; ruts and stones break them up
      if (roady > 0.05) {
        const town = b.paved ? b.paved[yi * W + xi] : 0;
        tmp.copy(town ? road2 : road).multiplyScalar(0.92 + n3 * 0.16 + (town && ((Math.floor(x * 2) + Math.floor(z * 2)) & 1) ? 0.06 : 0));
        c.lerp(tmp, Math.min(1, roady * 1.25));
        h -= 0.03 * roady;
      }
    }
    const shade = 0.9 + n3 * 0.2;
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    col[k * 3] = c.r * shade; col[k * 3 + 1] = c.g * shade; col[k * 3 + 2] = c.b * shade;
    uv[k * 2] = x / 5; uv[k * 2 + 1] = z / 5;
  }
  const idx = new Uint32Array(FW * FH * 6);
  let q = 0;
  for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
    const a = j * FV + i, d = a + FV;
    if ((i + j) & 1) { idx[q++] = a; idx[q++] = d; idx[q++] = a + 1; idx[q++] = a + 1; idx[q++] = d; idx[q++] = d + 1; }
    else { idx[q++] = a; idx[q++] = d; idx[q++] = d + 1; idx[q++] = a; idx[q++] = d + 1; idx[q++] = a + 1; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: grainTexture(), roughness: 0.96, metalness: 0 }));
  mesh.receiveShadow = true;
  return { mesh, hCorner: hc, heightAt };
}

// ------------------------------------------------------------------------------------------
// Ground cover
// ------------------------------------------------------------------------------------------
const tint = (geo, hex, hex2 = null, axis = 'y') => {
  const p = geo.attributes.position, n = p.count, a = new Float32Array(n * 3), c1 = srgb(hex), c2 = hex2 === null ? c1 : srgb(hex2), t = new THREE.Color();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const v = axis === 'y' ? p.getY(i) : p.getX(i); if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < n; i++) { const v = axis === 'y' ? p.getY(i) : p.getX(i); t.copy(c1).lerp(c2, hi > lo ? (v - lo) / (hi - lo) : 0); a[i * 3] = t.r; a[i * 3 + 1] = t.g; a[i * 3 + 2] = t.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
};
const flat = (g) => { const o = g.index ? g.toNonIndexed() : g; o.deleteAttribute('uv'); o.computeVertexNormals(); return o; };
const join = (list) => mergeGeometries(list.map(flat), false);
/** a blade: a thin upright triangle leaning outward */
const blade = (h, w, lean, turn, hex, hex2) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-w / 2, 0, 0, w / 2, 0, 0, lean, h, 0]), 3));
  g.rotateY(turn);
  return tint(flat(g), hex, hex2);
};
/** a leaf: a kite shape arching outward */
const leaf = (len, w, rise, turn, hex, hex2) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, len * 0.5, rise, -w / 2, len * 0.5, rise, w / 2, len * 0.5, rise, -w / 2, len, rise * 0.6, 0, len * 0.5, rise, w / 2]), 3));
  g.rotateY(turn);
  return tint(flat(g), hex, hex2, 'x');
};
const at = (g, x, y, z) => g.translate(x, y, z);

// each kind of cover is built once: a small, low-polygon model with its colours painted in
const KINDS = {
  tuft: () => join([0, 1, 2, 3, 4].map((i) => blade(0.2 + (i % 3) * 0.07, 0.07, (i - 2) * 0.05, i * 1.3, 0x3f7a2c, 0x8ab84a))),
  tallgrass: () => join([0, 1, 2, 3, 4, 5, 6].map((i) => at(blade(0.42 + (i % 3) * 0.12, 0.05, (i - 3) * 0.04, i * 0.9, 0x8a8a3a, 0xd8c86a), (i % 3 - 1) * 0.08, 0, (i % 2) * 0.07))),
  flower: () => join([blade(0.26, 0.03, 0.02, 0, 0x3f7a2c, 0x5a9a3a), at(tint(new THREE.ConeGeometry(0.075, 0.05, 6).rotateX(Math.PI), 0xffffff), 0.02, 0.28, 0), at(tint(new THREE.SphereGeometry(0.028, 5, 4), 0xf2c83a), 0.02, 0.29, 0)]),
  bush: () => join([[0, 0.16, 0, 0.2], [0.15, 0.12, 0.06, 0.15], [-0.12, 0.13, -0.08, 0.16], [0.02, 0.26, 0.02, 0.13]].map(([x, y, z, r]) => at(tint(new THREE.IcosahedronGeometry(r, 0), 0x2a5a24, 0x5a9a3a), x, y, z))),
  berry: () => join([[0, 0.14, 0, 0.18], [0.13, 0.11, 0.05, 0.13], [-0.1, 0.12, -0.07, 0.14]].map(([x, y, z, r]) => at(tint(new THREE.IcosahedronGeometry(r, 0), 0x2a5a24, 0x4a8a34), x, y, z))
    .concat([[0.1, 0.24, 0.1], [-0.12, 0.2, 0.06], [0.02, 0.3, -0.06], [0.16, 0.16, -0.04]].map(([x, y, z]) => at(tint(new THREE.SphereGeometry(0.03, 5, 4), 0xc8283a), x, y, z)))),
  fern: () => join([0, 1, 2, 3, 4, 5, 6].map((i) => leaf(0.34, 0.12, 0.16, i * 0.9, 0x2a6a2a, 0x6aaa4a))),
  broadleaf: () => join([0, 1, 2, 3, 4].map((i) => leaf(0.55, 0.3, 0.3 + (i % 2) * 0.12, i * 1.26, 0x146a1c, 0x3aaa3a))),
  reed: () => join([0, 1, 2, 3, 4, 5].map((i) => at(blade(0.7 + (i % 3) * 0.15, 0.035, (i - 2.5) * 0.03, i * 1.1, 0x4a6a2a, 0x9aaa5a), (i % 3 - 1) * 0.06, 0, (i % 2) * 0.05))
    .concat([[0.02, 0.78], [-0.05, 0.9]].map(([x, y]) => at(tint(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 5), 0x5a3a22), x, y, 0)))),
  mushroom: () => join([at(tint(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 6), 0xe8e0d0), 0, 0.06, 0), at(tint(new THREE.SphereGeometry(0.09, 7, 4, 0, 6.3, 0, 1.5), 0xb02a22, 0xd84a32), 0, 0.11, 0),
    at(tint(new THREE.CylinderGeometry(0.02, 0.025, 0.08, 5), 0xe8e0d0), 0.12, 0.04, 0.05), at(tint(new THREE.SphereGeometry(0.055, 6, 3, 0, 6.3, 0, 1.5), 0xb02a22, 0xd84a32), 0.12, 0.075, 0.05)]),
  pebble: () => join([[0, 0.04, 0, 0.09], [0.14, 0.03, 0.06, 0.06], [-0.1, 0.03, 0.1, 0.07], [0.05, 0.025, -0.12, 0.05]].map(([x, y, z, r]) => at(tint(new THREE.DodecahedronGeometry(r, 0).scale(1, 0.6, 0.85), 0x6a6a66, 0xa8a8a0), x, y, z))),
  stone: () => join([at(tint(new THREE.DodecahedronGeometry(0.3, 0).scale(1, 0.7, 0.85), 0x5a5a56, 0xa0a098), 0, 0.14, 0), at(tint(new THREE.DodecahedronGeometry(0.16, 0).scale(1, 0.7, 1), 0x5a5a56, 0x98988e), 0.3, 0.07, 0.12)]),
  crag: () => join([[0, 0.3, 0, 0.5, 1.3], [0.4, 0.2, 0.2, 0.32, 1.1], [-0.35, 0.22, -0.15, 0.36, 1.5], [0.1, 0.16, -0.4, 0.28, 0.9]].map(([x, y, z, r, s]) => at(tint(new THREE.DodecahedronGeometry(r, 0).scale(1, s, 0.9), 0x55524c, 0xa09a8e), x, y, z))),
  log: () => join([at(tint(new THREE.CylinderGeometry(0.09, 0.1, 0.9, 7).rotateZ(Math.PI / 2), 0x5a4026, 0x7a5a36), 0, 0.09, 0), at(tint(new THREE.CylinderGeometry(0.035, 0.04, 0.22, 5).rotateZ(0.9), 0x5a4026), 0.15, 0.2, 0),
    at(tint(new THREE.IcosahedronGeometry(0.07, 0).scale(1.6, 0.5, 1), 0x4a7a2a), -0.2, 0.18, 0.02)]),
  stump: () => join([at(tint(new THREE.CylinderGeometry(0.14, 0.19, 0.22, 8), 0x5a4026, 0x8a6a42), 0, 0.11, 0), at(tint(new THREE.CylinderGeometry(0.125, 0.125, 0.012, 8), 0xc8a878), 0, 0.225, 0)]),
  deadtree: () => join([at(tint(new THREE.CylinderGeometry(0.05, 0.11, 1.5, 6), 0x3a3028, 0x6a5a4a), 0, 0.75, 0), at(tint(new THREE.CylinderGeometry(0.02, 0.045, 0.7, 5).rotateZ(-0.9), 0x4a4036), 0.28, 1.15, 0),
    at(tint(new THREE.CylinderGeometry(0.02, 0.04, 0.55, 5).rotateZ(1.0), 0x4a4036), -0.24, 0.95, 0.03), at(tint(new THREE.CylinderGeometry(0.012, 0.03, 0.45, 5).rotateX(0.8), 0x4a4036), 0, 1.4, 0.16)]),
  cactus: () => join([at(tint(new THREE.CylinderGeometry(0.1, 0.11, 0.8, 7), 0x3a7a3a, 0x6aaa4a), 0, 0.4, 0), at(tint(new THREE.SphereGeometry(0.1, 7, 4), 0x6aaa4a), 0, 0.8, 0),
    at(tint(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 6).rotateZ(Math.PI / 2), 0x3a7a3a), 0.19, 0.42, 0), at(tint(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6), 0x4a8a3a, 0x6aaa4a), 0.29, 0.56, 0),
    at(tint(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 6).rotateZ(Math.PI / 2), 0x3a7a3a), -0.17, 0.3, 0), at(tint(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), 0x4a8a3a, 0x6aaa4a), -0.25, 0.4, 0)]),
  dryshrub: () => join([0, 1, 2, 3, 4, 5, 6, 7].map((i) => blade(0.3 + (i % 3) * 0.08, 0.03, Math.cos(i * 1.7) * 0.16, i * 0.8, 0x6a5232, 0xa88a52))),
  bones: () => join([at(tint(new THREE.SphereGeometry(0.09, 7, 5).scale(1, 0.85, 1.15), 0xe8e0c8), 0, 0.08, 0), at(tint(new THREE.BoxGeometry(0.07, 0.05, 0.06), 0xd8d0b8), 0, 0.03, 0.1)]
    .concat([0, 1, 2, 3].map((i) => at(tint(new THREE.TorusGeometry(0.11, 0.014, 4, 8, Math.PI).rotateY(Math.PI / 2), 0xe8e0c8), 0.25 + i * 0.09, 0, 0)))),
  drift: () => join([at(tint(new THREE.SphereGeometry(0.4, 9, 5).scale(1, 0.3, 0.8), 0xdfe8f0, 0xffffff), 0, 0.02, 0), at(tint(new THREE.SphereGeometry(0.22, 7, 4).scale(1, 0.32, 1), 0xdfe8f0, 0xffffff), 0.34, 0.01, 0.16)]),
  ice: () => join([[0, 0, 0, 0.09, 0.55, 0], [0.13, 0, 0.04, 0.06, 0.36, 0.3], [-0.1, 0, 0.08, 0.07, 0.42, -0.25], [0.02, 0, -0.12, 0.05, 0.28, 0.2]].map(([x, y, z, r, h, l]) => at(tint(new THREE.ConeGeometry(r, h, 5).translate(0, h / 2, 0).rotateZ(l), 0x9ad0f0, 0xf0faff), x, y, z))),
  obsidian: () => join([[0, 0, 0, 0.1, 0.5, 0.1], [0.14, 0, 0.05, 0.07, 0.3, 0.4], [-0.11, 0, 0.07, 0.08, 0.38, -0.3]].map(([x, y, z, r, h, l]) => at(tint(new THREE.ConeGeometry(r, h, 4).translate(0, h / 2, 0).rotateZ(l), 0x0c0c12, 0x3a3444), x, y, z))),
  ember: () => join([at(tint(new THREE.CircleGeometry(0.34, 7).rotateX(-Math.PI / 2).scale(1, 1, 0.45), 0xff6a14), 0, 0.012, 0), at(tint(new THREE.CircleGeometry(0.2, 6).rotateX(-Math.PI / 2).scale(0.5, 1, 1.4), 0xffb040), 0.1, 0.014, 0.12),
    at(tint(new THREE.DodecahedronGeometry(0.08, 0), 0x1c1a1a, 0x3a2a24), -0.2, 0.05, 0.1)]),
  lily: () => join([at(tint(new THREE.CircleGeometry(0.2, 9, 0.5, 5.6).rotateX(-Math.PI / 2), 0x2a6a32, 0x4a9a4a, 'x'), 0, 0, 0), at(tint(new THREE.CircleGeometry(0.13, 8, 1.2, 5.6).rotateX(-Math.PI / 2), 0x2a6a32), 0.3, 0, 0.14),
    at(tint(new THREE.ConeGeometry(0.06, 0.07, 6), 0xf8e8f0, 0xf0a8c8), 0.03, 0.04, 0.02)]),
};
const GLOW = new Set(['ember']);
// flower heads are dyed per plant
const PETALS = [0xf2e24a, 0xe84a5a, 0xffffff, 0x9a6ae8, 0x4aa8f0, 0xf08a2a, 0xf0a8c8];

// what grows where: [kind, plants per 100 tiles, where it likes to be, scale range]
//   where: 'any' open land, 'meadow' lush patches, 'dry' dry patches, 'bare' worn soil, 'wet' beside water, 'water' on the shallows,
//          'high' on the hills, 'cliff' along cliff lines, 'sand' beaches
const COVER = {
  temperate: [['tuft', 60, 'any', [0.8, 1.5]], ['tallgrass', 9, 'dry', [0.8, 1.4]], ['flower', 26, 'meadow', [0.8, 1.3]], ['bush', 3.5, 'any', [0.8, 1.7]], ['berry', 1.2, 'meadow', [0.9, 1.5]], ['fern', 5, 'meadow', [0.8, 1.4]],
    ['reed', 30, 'wet', [0.8, 1.4]], ['mushroom', 1.6, 'meadow', [0.8, 1.4]], ['pebble', 4, 'bare', [0.7, 1.5]], ['stone', 1.4, 'high', [0.8, 2]], ['log', 0.7, 'any', [0.8, 1.3]], ['stump', 0.8, 'any', [0.8, 1.3]], ['crag', 60, 'cliff', [0.9, 1.9]], ['lily', 5, 'water', [0.8, 1.4]]],
  snow: [['drift', 9, 'any', [0.8, 2]], ['ice', 2.2, 'high', [0.8, 1.8]], ['tuft', 8, 'dry', [0.7, 1.1]], ['dryshrub', 2.5, 'any', [0.8, 1.3]], ['stone', 2.2, 'any', [0.8, 2]], ['pebble', 3, 'bare', [0.7, 1.4]], ['deadtree', 0.5, 'any', [0.8, 1.4]],
    ['log', 0.5, 'any', [0.8, 1.2]], ['crag', 60, 'cliff', [0.9, 1.9]], ['ice', 10, 'wet', [0.7, 1.4]], ['bush', 1, 'meadow', [0.8, 1.3]]],
  desert: [['dryshrub', 9, 'any', [0.8, 1.5]], ['cactus', 1.6, 'any', [0.7, 1.6]], ['tallgrass', 6, 'meadow', [0.7, 1.2]], ['pebble', 7, 'any', [0.7, 1.6]], ['stone', 2.4, 'any', [0.8, 2.2]], ['bones', 0.5, 'bare', [0.9, 1.4]],
    ['reed', 24, 'wet', [0.8, 1.3]], ['flower', 3, 'meadow', [0.7, 1.1]], ['crag', 60, 'cliff', [0.9, 2]], ['deadtree', 0.25, 'dry', [0.8, 1.2]]],
  swamp: [['reed', 12, 'any', [0.8, 1.5]], ['reed', 40, 'wet', [0.9, 1.6]], ['fern', 9, 'any', [0.8, 1.5]], ['mushroom', 4, 'any', [0.8, 1.6]], ['tuft', 24, 'any', [0.8, 1.4]], ['deadtree', 1.1, 'any', [0.8, 1.6]], ['log', 1.4, 'any', [0.8, 1.4]],
    ['stump', 1.2, 'any', [0.8, 1.4]], ['lily', 14, 'water', [0.8, 1.5]], ['bush', 2.5, 'meadow', [0.8, 1.5]], ['pebble', 2, 'bare', [0.7, 1.3]], ['crag', 60, 'cliff', [0.9, 1.8]]],
  volcanic: [['obsidian', 5, 'any', [0.8, 1.8]], ['ember', 2.4, 'bare', [0.8, 1.8]], ['ember', 1, 'any', [0.7, 1.4]], ['stone', 4, 'any', [0.8, 2.2]], ['pebble', 7, 'any', [0.7, 1.5]], ['deadtree', 0.8, 'any', [0.8, 1.5]], ['bones', 0.7, 'any', [0.9, 1.4]],
    ['dryshrub', 2.5, 'dry', [0.7, 1.2]], ['crag', 70, 'cliff', [0.9, 2.1]]],
  jungle: [['broadleaf', 12, 'any', [0.8, 1.6]], ['fern', 14, 'any', [0.8, 1.5]], ['tuft', 40, 'any', [0.9, 1.6]], ['flower', 14, 'meadow', [0.9, 1.5]], ['bush', 5, 'any', [0.9, 1.8]], ['berry', 1.5, 'meadow', [0.9, 1.5]], ['mushroom', 2, 'any', [0.8, 1.4]],
    ['reed', 34, 'wet', [0.9, 1.5]], ['log', 1.2, 'any', [0.8, 1.4]], ['stone', 1.2, 'high', [0.8, 1.8]], ['lily', 12, 'water', [0.8, 1.5]], ['crag', 60, 'cliff', [0.9, 1.9]]],
};

const geoCache = new Map();
const kindGeo = (k) => { if (!geoCache.has(k)) geoCache.set(k, KINDS[k]()); return geoCache.get(k); };
const coverMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

/**
 * Scatter the ground cover for a battle. `heightAt(x, z)` gives the ground; density scales with the graphics setting.
 * Returns a Group of instanced meshes (nothing in it blocks or is hit: it is all underfoot).
 */
export function buildCover(b, biomeId, heightAt, density = 1) {
  const W = b.W, H = b.H, group = new THREE.Group(), list = COVER[biomeId] || COVER.temperate, seed = (b.seed | 0) * 7 + W;
  const T = b.terrain;
  // which tiles are free ground, beside water, or along a cliff
  const taken = (i) => b.blockMove[i] && !(b.cliff && b.cliff[i]) || b.level[i] || b.sid[i] || b.door[i] >= 0 || (b.road && b.road[i]);
  const nearT = (x, y, test) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && test(ny * W + nx)) return true; } return false; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  list.forEach(([kind, per100, where, [s0, s1]], li) => {
    const spots = [];
    const want = per100 / 100 * density;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, t = T[i];
      const r0 = hash2(x, y, seed + li * 31);
      let p = 0;
      if (where === 'water') { if (t === SHALLOW && nearT(x, y, (j) => T[j] === GRASS || T[j] === SAND)) p = want; }
      else if (where === 'cliff') { if (b.cliff && b.cliff[i]) p = want; }
      else if (where === 'wet') { if ((t === GRASS || t === SAND || t === FORD) && !taken(i) && nearT(x, y, (j) => T[j] === SHALLOW || T[j] === DEEP)) p = want; }
      else if (where === 'sand') { if (t === SAND && !taken(i)) p = want; }
      else if (t === GRASS && !taken(i)) {
        const n1 = vnoise(x * 0.09, y * 0.09, (b.seed | 0) + W), n2 = vnoise(x * 0.31, y * 0.31, (b.seed | 0) + W + 3);
        const hgt = b.height ? b.height[i] : 0;
        if (where === 'any') p = want;
        else if (where === 'meadow') p = n1 > 0.55 ? want * 2.6 * Math.min(1, (n1 - 0.55) * 6) : 0;
        else if (where === 'dry') p = n1 < 0.42 ? want * 2.4 * Math.min(1, (0.42 - n1) * 6) : 0;
        else if (where === 'bare') p = n2 > 0.66 ? want * 4 : 0;
        else if (where === 'high') p = hgt > 1 ? want * 3 : 0;
      }
      if (p <= 0) continue;
      // more than one to a tile where growth is thick
      for (let k = 0; k < 3 && p > 0; k++, p -= 1) if (r0 * 0.999 + k * 0.37 - Math.floor(r0 * 0.999 + k * 0.37) < p) spots.push(x, y, k);
    }
    const n = spots.length / 3;
    if (!n) return;
    const mesh = new THREE.InstancedMesh(kindGeo(kind), GLOW.has(kind) ? glowMat : coverMat, n);
    const big = kind === 'crag' || kind === 'stone' || kind === 'deadtree' || kind === 'cactus' || kind === 'log' || kind === 'bush' || kind === 'berry';
    mesh.castShadow = big; mesh.receiveShadow = !GLOW.has(kind);
    for (let k = 0; k < n; k++) {
      const x = spots[k * 3], y = spots[k * 3 + 1], j = spots[k * 3 + 2];
      const r1 = hash2(x * 3 + j, y * 5, seed + li), r2 = hash2(x * 7, y * 3 + j, seed + li + 1), r3 = hash2(x + j * 11, y * 13, seed + li + 2);
      const px = x + 0.1 + r1 * 0.8, pz = y + 0.1 + r2 * 0.8, s = s0 + (s1 - s0) * r3;
      const py = where === 'water' ? -0.11 : heightAt(px, pz) - (kind === 'crag' ? 0.12 : 0.01);
      e.set(kind === 'crag' ? (r1 - 0.5) * 0.5 : 0, r3 * 6.283, kind === 'log' || kind === 'bones' ? 0 : (r2 - 0.5) * 0.16);
      q.setFromEuler(e);
      sc.set(s, s * (0.85 + r1 * 0.3), s);
      m4.compose(v.set(px, py, pz), q, sc);
      mesh.setMatrixAt(k, m4);
      if (kind === 'flower') col.set(PETALS[Math.floor(hash2(Math.floor(x / 5), Math.floor(y / 5), seed) * PETALS.length + r1 * 1.4) % PETALS.length]);
      else { const d = 0.82 + r2 * 0.36; col.setRGB(d, d * (0.96 + r1 * 0.08), d * (0.94 + r3 * 0.1)); }
      mesh.setColorAt(k, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  return group;
}
void DEEP;
