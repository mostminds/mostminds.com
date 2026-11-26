// Terrain codes shared by engine, renderer and editor.
export const GRASS = 0, SAND = 1, SHALLOW = 2, DEEP = 3;

export const MAP_SHAPES = {
  plains: 'Open plains',
  island: 'Island',
  coast: 'Coastline',
  harbor: 'Harbor bay',
  archipelago: 'Archipelago',
  river: 'River with fords',
  lake: 'Lake',
  strait: 'Strait',
};

export const BIOMES = {
  temperate: { name: 'Temperate', grass: [0.33, 0.5, 0.24], sand: [0.82, 0.74, 0.52], shallow: [0.62, 0.56, 0.4], water: 0x2f6f9a, floor: 0x1f3f55, sky: 0x9fb8c8, outer: 0x4b6a35 },
  snow:      { name: 'Frozen north', grass: [0.78, 0.82, 0.88], sand: [0.6, 0.62, 0.65], shallow: [0.55, 0.62, 0.68], water: 0x3a6a8a, floor: 0x1f3448, sky: 0xc8d4de, outer: 0xd8dee6 },
  desert:    { name: 'Desert', grass: [0.8, 0.68, 0.42], sand: [0.88, 0.8, 0.58], shallow: [0.6, 0.62, 0.5], water: 0x2f7f8a, floor: 0x29525a, sky: 0xe0cfa8, outer: 0xc4a466 },
  swamp:     { name: 'Swamp', grass: [0.27, 0.33, 0.2], sand: [0.38, 0.36, 0.24], shallow: [0.32, 0.36, 0.26], water: 0x3a4f36, floor: 0x1e2a1c, sky: 0x8a9a84, outer: 0x2e3a22 },
  volcanic:  { name: 'Volcanic', grass: [0.24, 0.22, 0.22], sand: [0.42, 0.38, 0.36], shallow: [0.4, 0.3, 0.26], water: 0x283c4a, floor: 0x401a10, sky: 0x8a6a5a, outer: 0x2a2424 },
  jungle:    { name: 'Jungle', grass: [0.18, 0.46, 0.18], sand: [0.84, 0.76, 0.5], shallow: [0.5, 0.6, 0.48], water: 0x1f7f8a, floor: 0x184a4a, sky: 0xa8d0c0, outer: 0x2a5a24 },
};

// Seeded value noise for coastlines
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s) { return noise(x, y, s) * 0.6 + noise(x * 2.1, y * 2.1, s + 1) * 0.3 + noise(x * 4.3, y * 4.3, s + 2) * 0.1; }

// "height" > 0 is land; sand/shallow rings come from bands near zero.
function classify(h) {
  if (h > 0.08) return GRASS;
  if (h > 0) return SAND;
  if (h > -0.08) return SHALLOW;
  return DEEP;
}

export function generateTerrain(shape, size, seed = 7) {
  if (shape === 'field' || !shape) shape = 'plains';
  if (shape === 'amphibious') shape = 'island';
  const t = new Uint8Array(size * size);
  const S = size, f = 6 / S;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x * f, y * f, seed) - 0.5;
    const nx = x / S, ny = y / S;
    let h;
    switch (shape) {
      case 'plains': h = 1; break;
      case 'island': {
        const a = Math.atan2(ny - 0.5, nx - 0.7);
        const w = 1 + 0.07 * Math.sin(a * 3 + 1.3) + 0.05 * Math.sin(a * 7 + 0.4);
        const d = Math.hypot((nx - 0.7) / 0.3, (ny - 0.5) / 0.44) / w;
        h = (1 - d) * 0.75;
        if (x >= S - 1) h = Math.max(h, 0.01);
        break;
      }
      case 'coast': h = (nx - 0.42 - n * 0.25) * 1.6; break;
      case 'harbor': {
        h = (nx - 0.3 - n * 0.15) * 1.6;
        const bay = Math.hypot((nx - 0.58) / 0.2, (ny - 0.5) / 0.26);
        const mouth = nx < 0.6 && Math.abs(ny - 0.5) < 0.09;
        if (bay < 1) h = Math.min(h, (bay - 1) * 0.5);
        if (mouth) h = Math.min(h, -0.12);
        break;
      }
      case 'archipelago': {
        h = -0.4;
        const isles = [[0.55, 0.22, 0.13], [0.62, 0.62, 0.16], [0.84, 0.35, 0.14], [0.86, 0.8, 0.12], [0.4, 0.82, 0.08]];
        for (const [cx, cy, r] of isles) h = Math.max(h, (1 - Math.hypot(nx - cx, ny - cy) / r) * 0.5 + n * 0.35);
        break;
      }
      case 'river': {
        const rx = 0.5 + Math.sin(ny * 7 + 1) * 0.06 + n * 0.04;
        const d = Math.abs(nx - rx) * S;
        h = d < 1.6 ? -0.3 : d < 3 ? -0.04 : d < 4 ? 0.04 : 1;
        // fords: shallow crossings
        for (const fy of [0.18, 0.52, 0.84]) if (Math.abs(ny - fy) * S < 2 && d < 3) h = -0.04;
        break;
      }
      case 'lake': {
        const d = Math.hypot((nx - 0.5) / 0.2, (ny - 0.5) / 0.28) - n * 0.6;
        h = (d - 1) * 0.5;
        break;
      }
      case 'strait': {
        const c = 0.5 + Math.sin(nx * 5) * 0.06 + n * 0.12;
        h = (Math.abs(ny - c) - 0.14) * 2;
        if (nx < 0.12) h = Math.min(h, -0.2); // open sea to the west for landing craft
        break;
      }
      default: h = 1;
    }
    t[y * S + x] = classify(h);
  }
  return t;
}
