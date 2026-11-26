// Terrain codes shared by engine, renderer and editor.
export const GRASS = 0, SAND = 1, SHALLOW = 2, DEEP = 3;

export function generateTerrain(mode, size) {
  const t = new Uint8Array(size * size);
  if (mode !== 'amphibious') return t;
  const cx = size * 0.7, cy = size * 0.5;
  const rx = size * 0.3, ry = size * 0.44;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = Math.atan2(y - cy, x - cx);
      const wobble = 1 + 0.07 * Math.sin(a * 3 + 1.3) + 0.05 * Math.sin(a * 7 + 0.4);
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry) / wobble;
      let v = DEEP;
      if (d < 0.86) v = GRASS;
      else if (d < 1.0) v = SAND;
      else if (d < 1.12) v = SHALLOW;
      if (x >= size - 1) v = Math.min(v, SAND); // island runs to the east edge
      t[y * size + x] = v;
    }
  }
  return t;
}
