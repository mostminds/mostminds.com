// Terrain codes shared by engine, renderer and editor.
export const GRASS = 0, SAND = 1, SHALLOW = 2, DEEP = 3;
// FORD: a gravel crossing through a river. It is the only water land troops will walk through.
export const FORD = 4;
/** water that soldiers on foot keep out of (shallows and deep water alike) */
export const isWater = (t) => t === SHALLOW || t === DEEP;

export const MAP_SHAPES = {
  plains: 'Open plains',
  island: 'Island',
  coast: 'Coastline',
  harbor: 'Harbor bay',
  archipelago: 'Archipelago',
  river: 'River with fords',
  lake: 'Lake',
  strait: 'Strait',
  twinRivers: 'Two rivers',
  marsh: 'Marsh and meres',
  isthmus: 'Isthmus',
  bay: 'Crescent bay',
  peninsula: 'Peninsula',
  fjord: 'Fjord coast',
  atoll: 'Atoll',
  twinIsles: 'Twin isles',
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
        for (const fy of [0.18, 0.52, 0.84]) if (Math.abs(ny - fy) * S < Math.max(2, S * 0.03) && d < 3) h = 9; // ford
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
      case 'twinRivers': {
        // two rivers cross the field, each with its fords
        h = 1;
        for (const [c, ph, fords] of [[0.36, 0.7, [0.26, 0.7]], [0.64, 2.9, [0.34, 0.8]]]) {
          const rx = c + Math.sin(ny * 6 + ph) * 0.05 + n * 0.04, d = Math.abs(nx - rx) * S;
          let hh = d < 1.4 ? -0.3 : d < 2.6 ? -0.04 : d < 3.4 ? 0.04 : 1;
          for (const fy of fords) if (Math.abs(ny - fy) * S < Math.max(2, S * 0.03) && d < 2.6) hh = 9;
          if (hh === 9 || h === 9) h = 9; else h = Math.min(h, hh);
        }
        break;
      }
      case 'marsh': {
        // firm ground broken by meres and reedy pools; the edges where armies form up stay dry
        const m = fbm(x * f * 2.6 + 9, y * f * 2.6 + 4, seed + 31), edge = Math.min(nx, 1 - nx);
        h = edge < 0.16 ? 1 : (0.6 - m) * 1.4 + (edge < 0.24 ? 0.3 : 0);
        if (Math.abs(ny - 0.5) < 0.035 + (m - 0.5) * 0.03) h = Math.max(h, 0.12); // a causeway through the middle
        break;
      }
      case 'isthmus': {
        // sea to north and south; the land narrows to a neck between the armies
        const half = 0.2 + 0.26 * Math.pow(Math.abs(nx - 0.5) * 2, 1.4) + n * 0.06;
        h = (half - Math.abs(ny - 0.5)) * 2.2;
        break;
      }
      case 'bay': {
        // a great bay bites into the southern shore: the field curves round it
        const d = Math.hypot((nx - 0.5) / 0.3, (ny - 1.02) / 0.5) - n * 0.3;
        h = (d - 1) * 0.6;
        break;
      }
      case 'peninsula': {
        // a tongue of land running west into the sea from the eastern edge
        const half = 0.12 + 0.3 * Math.pow(Math.max(0, (nx - 0.34) / 0.66), 0.7) + n * 0.1;
        h = (half - Math.abs(ny - 0.5)) * 1.6 - Math.max(0, 0.34 - nx) * 4; // rounded off at its western tip
        if (x >= S - 1 && Math.abs(ny - 0.5) < 0.4) h = Math.max(h, 0.2);
        break;
      }
      case 'fjord': {
        // a coast cut by long inlets
        const inlet = Math.max(0, Math.sin(ny * 9.5 + seed) - 0.55) * 0.5;
        h = (nx - 0.4 - n * 0.2 - inlet * (1 - Math.min(1, Math.max(0, (nx - 0.4) / 0.38)))) * 1.6;
        break;
      }
      case 'atoll': {
        // a ring of land round a lagoon, open to the sea on the west
        const dx = (nx - 0.66) / 0.3, dy = (ny - 0.5) / 0.42, d = Math.hypot(dx, dy) + n * 0.25;
        h = (0.2 - Math.abs(d - 0.78)) * 1.8;
        if (dx < -0.6 && Math.abs(dy) < 0.16) h = Math.min(h, -0.12); // the pass into the lagoon
        break;
      }
      case 'twinIsles': {
        // two islands, north and south, joined at low water
        h = -0.4;
        for (const [cx, cy, rx, ry] of [[0.66, 0.26, 0.26, 0.2], [0.68, 0.74, 0.28, 0.2]]) h = Math.max(h, (1 - Math.hypot((nx - cx) / rx, (ny - cy) / ry)) * 0.6 + n * 0.2);
        break;
      }
      default: h = 1;
    }
    t[y * S + x] = h === 9 ? FORD : classify(h);
  }
  // Tidal sandbars: land troops cannot wade, so separated shores are joined by gravel crossings
  const bar = (x0, y0, x1, y1, w) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let k = 0; k <= n; k++) {
      const cx = x0 + ((x1 - x0) * k) / n, cy = y0 + ((y1 - y0) * k) / n;
      for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++) {
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x > 0 && y > 0 && x < S - 1 && y < S - 1 && isWater(t[y * S + x])) t[y * S + x] = FORD;
      }
    }
  };
  if (shape === 'strait') for (const fx of [0.42, 0.78]) bar(fx * S, 0.2 * S, fx * S, 0.8 * S, 1);
  if (shape === 'twinIsles') for (const fx of [0.6, 0.74]) bar(fx * S, 0.3 * S, fx * S, 0.7 * S, 1);
  if (shape === 'archipelago') {
    const isles = [[0.55, 0.22], [0.62, 0.62], [0.84, 0.35], [0.86, 0.8], [0.4, 0.82]];
    for (const [a, c] of [[0, 2], [0, 1], [1, 3], [2, 3], [1, 4]]) bar(isles[a][0] * S, isles[a][1] * S, isles[c][0] * S, isles[c][1] * S, 1);
  }
  return t;
}

// ------------------------------------------------------------------------------------------
// Relief: rolling hills over the dry land, and flat-topped heights edged with cliffs.
// Heights are in tiles (a soldier stands about one tall). Ground is kept level where anything is
// built (`built` marks those tiles) and falls away to nothing at the water's edge. A cliff tile
// cannot be walked; every cliff line is left with slopes through it, and any cliff that would cut
// part of the map off is removed.
//   opts.hills   0..1.5   how high the hills roll (0 = flat)
//   opts.cliffs  0..1     how much of the high ground breaks into cliffs (0 = none)
// Returns { height: Float32Array per tile, cliff: Uint8Array per tile }.
// ------------------------------------------------------------------------------------------
export function generateRelief(terrain, S, seed = 7, opts = {}, built = null, track = null) {
  const N = S * S, height = new Float32Array(N), cliff = new Uint8Array(N);
  const hills = opts.hills ?? 0.6, cliffs = opts.cliffs ?? 0;
  if (hills <= 0) return { height, cliff };
  // distance (in tiles, capped) from water and from anything built: two sweeps of a chamfer transform
  const dist = (isSource) => {
    const d = new Float32Array(N).fill(99);
    for (let i = 0; i < N; i++) if (isSource(i)) d[i] = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x; let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) { v = Math.min(v, d[i - S] + 1); if (x > 0) v = Math.min(v, d[i - S - 1] + 1.4); if (x < S - 1) v = Math.min(v, d[i - S + 1] + 1.4); }
      d[i] = v;
    }
    for (let y = S - 1; y >= 0; y--) for (let x = S - 1; x >= 0; x--) {
      const i = y * S + x; let v = d[i];
      if (x < S - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < S - 1) { v = Math.min(v, d[i + S] + 1); if (x < S - 1) v = Math.min(v, d[i + S + 1] + 1.4); if (x > 0) v = Math.min(v, d[i + S - 1] + 1.4); }
      d[i] = v;
    }
    return d;
  };
  const dWater = dist((i) => terrain[i] !== GRASS);
  const dBuilt = built ? dist((i) => built[i] === 1) : null;
  const dTrack = track ? dist((i) => track[i] === 1) : null; // a railway runs in a cutting: level on the line, banks close by
  const ss = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const f1 = 3.2 / S * (S / 96) ** 0.5, s2 = seed * 3 + 11;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (terrain[i] !== GRASS) continue;
    // level ground by the shore and around buildings, rising away from both
    let m = ss(1, 9, dWater[i]);
    if (dBuilt) m *= ss(3, 16, dBuilt[i]);
    if (dTrack) m *= ss(1, 7, dTrack[i]);
    // keep the map's edges low so armies can form up there
    m *= ss(0, 14, Math.min(x, y, S - 1 - x, S - 1 - y));
    if (m <= 0) continue;
    const u = x * f1, v = y * f1;
    const roll = fbm(u, v, s2) * 0.75 + fbm(u * 2.6, v * 2.6, s2 + 5) * 0.25;         // 0..1
    let h = Math.max(0, roll - 0.36) * 2.6 * hills;                                   // broad hills, with flat valleys between
    h += (noise(x * 0.23, y * 0.23, s2 + 9) - 0.5) * 0.22 * hills;                   // small swells
    if (cliffs > 0) {
      // table-lands: a step up whose edge is a cliff, except where it relaxes into a slope
      const mesa = fbm(u * 1.3 + 40, v * 1.3 + 17, s2 + 21);
      const edge = 0.63 - cliffs * 0.07;
      const ramp = noise(x * 0.11 + 5, y * 0.11 + 9, s2 + 33);                         // high = a way up
      const wide = ramp > 0.56 ? 0.16 : 0.012;
      h += ss(edge - wide, edge + wide, mesa) * (1.5 + cliffs * 0.5);
    }
    height[i] = Math.max(0, h) * m;
  }
  if (cliffs > 0) {
    // a tile is a cliff when the ground across it is too steep to climb
    const at = (x, y) => height[Math.max(0, Math.min(S - 1, y)) * S + Math.max(0, Math.min(S - 1, x))];
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      if (terrain[i] !== GRASS || (built && built[i]) || Math.min(x, y, S - 1 - x, S - 1 - y) < 4 || (dBuilt && dBuilt[i] < 4) || (dTrack && dTrack[i] < 3)) continue;
      let lo = Infinity, hi = -Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const hh = at(x + dx, y + dy); if (hh < lo) lo = hh; if (hh > hi) hi = hh; }
      if (hi - lo > 1.05 && height[i] - lo > 0.3 && hi - height[i] > 0.3) cliff[i] = 1;
    }
    // no part of the map may be cut off: open any cliff that borders a pocket of ground
    const comp = new Int32Array(N), stack = [];
    for (let pass = 0; pass < 24; pass++) {
      comp.fill(0);
      let n = 0, best = 0, bestSize = 0;
      for (let s = 0; s < N; s++) {
        if (comp[s] || cliff[s]) continue;
        n++; let size = 0; comp[s] = n; stack.push(s);
        while (stack.length) {
          const i = stack.pop(), x = i % S, y = (i / S) | 0; size++;
          if (x > 0 && !comp[i - 1] && !cliff[i - 1]) { comp[i - 1] = n; stack.push(i - 1); }
          if (x < S - 1 && !comp[i + 1] && !cliff[i + 1]) { comp[i + 1] = n; stack.push(i + 1); }
          if (y > 0 && !comp[i - S] && !cliff[i - S]) { comp[i - S] = n; stack.push(i - S); }
          if (y < S - 1 && !comp[i + S] && !cliff[i + S]) { comp[i + S] = n; stack.push(i + S); }
        }
        if (size > bestSize) { bestSize = size; best = n; }
      }
      if (n <= 1) break;
      let opened = 0;
      for (let i = 0; i < N; i++) {
        if (!cliff[i]) continue;
        const x = i % S, y = (i / S) | 0;
        const c = [x > 0 ? comp[i - 1] : 0, x < S - 1 ? comp[i + 1] : 0, y > 0 ? comp[i - S] : 0, y < S - 1 ? comp[i + S] : 0];
        if (c.some((k) => k && k !== best)) { cliff[i] = 0; opened++; }
      }
      if (!opened) break;
      if (pass === 23) cliff.fill(0);
    }
    // where a cliff was opened the ground is eased so the gap reads as a path
    for (let k = 0; k < 2; k++) for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      if (cliff[i] || terrain[i] !== GRASS) continue;
      let lo = Infinity, hi = -Infinity;
      for (const j of [i - 1, i + 1, i - S, i + S]) { if (cliff[j]) continue; if (height[j] < lo) lo = height[j]; if (height[j] > hi) hi = height[j]; }
      if (hi - lo > 1.2) height[i] = (lo + hi) / 2;
    }
  }
  return { height, cliff };
}
