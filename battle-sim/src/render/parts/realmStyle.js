// Each realm's look at sea: what her designed ships are carved, gilded, painted and lit with.
//
//   styleOf(def)                 the style of a designed ship (realm table + the design's own colours)
//   emblem(K, st, size, o)       the realm's device as a relief in the kit's xy plane, facing +z (two tones)
//   emblemPolys(name)            the device as 2D layers [{ polys: [{ pts, holes }], tone: 0|1 }] in a unit square
//   motif(K, st, size)           one unit of the realm's running carving (gunwale frieze), xy plane facing +z, centred
//   finial(K, st, size)          a post-top ornament standing on the origin
//   lantern(K, st, size)         a stern lantern / brazier / lamp standing on the origin (glows)
//   banner(K, st, w, h, side)    a staff-hung banner in the realm's cut, its device on both faces; foot at the origin
//
// Fields of a style: wood, metal (hex), metalM (metalness), carve (carving colour), band ([main, second] paint band),
// trim (band pattern: band | stripes | checker | teeth | dots | chevron | shields), motif, emblem, figure (the
// figurehead kind a plain bow gets), lantern, finial, banner (cut: swallow | gonfalon | nobori | pennon | horsetail |
// totem | square), glow (hex of her magic light), cloth / cloth2 (the realm's colours), tone (0 bright .. 1 grim).
import * as THREE from 'three';
import { G, C, shade, blend, clamp, lerp, taper, clothPanel } from './kit.js';
import { REALMS } from '../../data/realms.js';

const PI = Math.PI;
// realm -> style (colours not given come from the realm's palette)
const T = {
  graal:      { metal: 0xd9b23a, metalM: 0.55, carve: 0xe8dcc0, motif: 'scroll', emblem: 'fleur', figure: 'horse', lantern: 'lantern', finial: 'fleur', banner: 'swallow', trim: 'checker' },
  aurelia:    { metal: 0xc9a23a, metalM: 0.55, carve: 0xc9a23a, motif: 'scroll', emblem: 'griffin', figure: 'eagle', lantern: 'lantern', finial: 'ball', banner: 'square', trim: 'stripes' },
  aethel:     { metal: 0xd8dce8, metalM: 0.5, carve: 0xf2f0ea, motif: 'feather', emblem: 'star', figure: 'swan', lantern: 'crystal', finial: 'crystal', banner: 'pennon', trim: 'band', glow: 0x9ad8ff },
  kaelneth:   { metal: 0x9a8a9a, metalM: 0.5, carve: 0x24242c, motif: 'thorn', emblem: 'moon', figure: 'cobra', lantern: 'witchlight', finial: 'spike', banner: 'pennon', trim: 'teeth', glow: 0xb03aff, tone: 0.8 },
  verdant:    { metal: 0xd8a03a, metalM: 0.2, carve: 0x5a7a2a, motif: 'leaf', emblem: 'leaf', figure: 'wolf', lantern: 'wisp', finial: 'antler', banner: 'pennon', trim: 'band', glow: 0xb8ff7a },
  grom:       { metal: 0xb8862a, metalM: 0.55, carve: 0x8a9098, motif: 'rivet', emblem: 'hammer', figure: 'boar', lantern: 'lantern', finial: 'ball', banner: 'square', trim: 'checker' },
  xibalba:    { metal: 0xd8a82a, metalM: 0.55, carve: 0xd8a82a, motif: 'step', emblem: 'sunmask', figure: 'cobra', lantern: 'brazier', finial: 'feathers', banner: 'gonfalon', trim: 'teeth', glow: 0x3affd0 },
  velikaya:   { metal: 0xd8b03a, metalM: 0.55, carve: 0xe8e0d0, motif: 'scroll', emblem: 'eagle2', figure: 'eagle', lantern: 'lantern', finial: 'onion', banner: 'gonfalon', trim: 'stripes' },
  tianlong:   { metal: 0xd8b03a, metalM: 0.55, carve: 0xd8b03a, motif: 'cloud', emblem: 'dragon', figure: 'dragon', lantern: 'paper', finial: 'curl', banner: 'nobori', trim: 'band' },
  ironbound:  { metal: 0x2a2a30, metalM: 0.55, carve: 0x8a2a1a, motif: 'spikes', emblem: 'fist', figure: 'skull', lantern: 'brazier', finial: 'spike', banner: 'square', trim: 'teeth', tone: 0.9 },
  screaming:  { metal: 0xb0782a, metalM: 0.5, carve: 0x6a1a5a, motif: 'eye', emblem: 'maw', figure: 'eye', lantern: 'witchlight', finial: 'horn', banner: 'pennon', trim: 'teeth', glow: 0xff3ad8, tone: 0.9 },
  cloven:     { metal: 0x8a8070, metalM: 0.2, carve: 0xd8cfb4, motif: 'bone', emblem: 'horns', figure: 'boar', lantern: 'skull', finial: 'horn', banner: 'totem', trim: 'dots', tone: 0.8 },
  fimbul:     { metal: 0xb8862a, metalM: 0.4, carve: 0x6a4a2a, motif: 'knot', emblem: 'axe', figure: 'wolf', lantern: 'brazier', finial: 'curl', banner: 'square', trim: 'shields' },
  ashur:      { metal: 0xb0782a, metalM: 0.55, carve: 0x26262c, motif: 'rivet', emblem: 'bull', figure: 'boar', lantern: 'brazier', finial: 'horn', banner: 'square', trim: 'teeth', glow: 0xff6a1a, tone: 0.8 },
  greenhide:  { metal: 0x5a5a5e, metalM: 0.4, carve: 0x8a1a14, motif: 'teeth', emblem: 'tusks', figure: 'boar', lantern: 'brazier', finial: 'tusk', banner: 'totem', trim: 'chevron', tone: 0.6 },
  skar:       { metal: 0x7a6a4a, metalM: 0.45, carve: 0x3a3a2a, motif: 'rivet', emblem: 'claw', figure: 'eye', lantern: 'warp', finial: 'spike', banner: 'pennon', trim: 'stripes', glow: 0x5aff5a, tone: 0.8 },
  crimson:    { metal: 0xb89a4a, metalM: 0.55, carve: 0x14141a, motif: 'bat', emblem: 'bat', figure: 'wolf', lantern: 'witchlight', finial: 'spike', banner: 'gonfalon', trim: 'band', glow: 0xff2a3a, tone: 0.9 },
  khemet:     { metal: 0xd8b03a, metalM: 0.55, carve: 0xd8b03a, motif: 'lotus', emblem: 'scarab', figure: 'cobra', lantern: 'brazier', finial: 'lotus', banner: 'gonfalon', trim: 'stripes', glow: 0x3affd8 },
  drowned:    { metal: 0x5a7a6a, metalM: 0.35, carve: 0x5a6a5a, motif: 'shell', emblem: 'trident', figure: 'skull', lantern: 'witchlight', finial: 'trident', banner: 'pennon', trim: 'band', glow: 0x5affa0, tone: 0.9 },
  gorge:      { metal: 0x5a5a5e, metalM: 0.35, carve: 0x8a2a1a, motif: 'bone', emblem: 'maw', figure: 'boar', lantern: 'brazier', finial: 'tusk', banner: 'totem', trim: 'dots', tone: 0.6 },
  westmark:   { metal: 0xd8b03a, metalM: 0.5, carve: 0xd8b03a, motif: 'scroll', emblem: 'lion', figure: 'horse', lantern: 'lantern', finial: 'ball', banner: 'square', trim: 'stripes' },
  principalities: { metal: 0xd8b03a, metalM: 0.5, carve: 0xe8c83a, motif: 'arch', emblem: 'tower', figure: 'horse', lantern: 'lantern', finial: 'ball', banner: 'swallow', trim: 'checker' },
  sunkings:   { metal: 0xd8b03a, metalM: 0.55, carve: 0xd8b03a, motif: 'scroll', emblem: 'sun', figure: 'horse', lantern: 'lantern', finial: 'cross', banner: 'square', trim: 'stripes' },
  caliphate:  { metal: 0xd8b03a, metalM: 0.5, carve: 0x2aa8a8, motif: 'arch', emblem: 'crescent', figure: 'horse', lantern: 'oil', finial: 'crescent', banner: 'pennon', trim: 'chevron' },
  shogunate:  { metal: 0xd8b03a, metalM: 0.45, carve: 0x2a2a30, motif: 'wave', emblem: 'mon', figure: 'fish', lantern: 'paper', finial: 'ball', banner: 'nobori', trim: 'band' },
  mistisles:  { metal: 0xb08a4a, metalM: 0.35, carve: 0x3a6a4a, motif: 'knot', emblem: 'triskele', figure: 'swan', lantern: 'wisp', finial: 'curl', banner: 'pennon', trim: 'band', glow: 0x9affd0 },
  thousandgods: { metal: 0xd8b03a, metalM: 0.55, carve: 0xe87a1a, motif: 'lotus', emblem: 'lotus', figure: 'tiger', lantern: 'oil', finial: 'lotus', banner: 'swallow', trim: 'dots' },
  kharnak:    { metal: 0xb07a2a, metalM: 0.55, carve: 0x1e1c1c, motif: 'spikes', emblem: 'horns', figure: 'skull', lantern: 'brazier', finial: 'horn', banner: 'square', trim: 'teeth', glow: 0xff3a1a, tone: 1 },
  morbus:     { metal: 0xa08a3a, metalM: 0.35, carve: 0x6a5a2a, motif: 'eye', emblem: 'fly', figure: 'frog', lantern: 'witchlight', finial: 'spike', banner: 'pennon', trim: 'dots', glow: 0xb8ff3a, tone: 1 },
  labyrinth:  { metal: 0xd8b03a, metalM: 0.5, carve: 0x8ad8f0, motif: 'step', emblem: 'maze', figure: 'eye', lantern: 'crystal', finial: 'crystal', banner: 'gonfalon', trim: 'checker', glow: 0x3ad8ff },
  velvet:     { metal: 0xd8b03a, metalM: 0.55, carve: 0xd8b03a, motif: 'scroll', emblem: 'mask', figure: 'swan', lantern: 'oil', finial: 'ball', banner: 'swallow', trim: 'stripes', glow: 0xd88aff },
  malvash:    { metal: 0xb08a3a, metalM: 0.5, carve: 0x3a3a40, motif: 'rivet', emblem: 'claw', figure: 'tiger', lantern: 'brazier', finial: 'horn', banner: 'square', trim: 'teeth', glow: 0xff6a1a, tone: 0.8 },
  ashhorde:   { metal: 0xb08a3a, metalM: 0.5, carve: 0x1e1e22, motif: 'spikes', emblem: 'flame', figure: 'dragon', lantern: 'brazier', finial: 'flame', banner: 'square', trim: 'teeth', glow: 0xff5a1a, tone: 0.9 },
  balor:      { metal: 0xd8c8a0, metalM: 0.2, carve: 0x5a4a2a, motif: 'eye', emblem: 'eye', figure: 'eye', lantern: 'wisp', finial: 'antler', banner: 'totem', trim: 'band', glow: 0x9aff9a, tone: 0.6 },
  kurgan:     { metal: 0xc8a060, metalM: 0.35, carve: 0x8a2a1a, motif: 'knot', emblem: 'wolfhead', figure: 'wolf', lantern: 'brazier', finial: 'horsetail', banner: 'horsetail', trim: 'chevron' },
  hearthmoot: { metal: 0xc8a040, metalM: 0.35, carve: 0x4a7a3a, motif: 'leaf', emblem: 'acorn', figure: 'frog', lantern: 'lantern', finial: 'ball', banner: 'square', trim: 'checker' },
  baobab:     { metal: 0xc87a3a, metalM: 0.25, carve: 0x9a6a3a, motif: 'chevron', emblem: 'tree', figure: 'boar', lantern: 'gourd', finial: 'feathers', banner: 'totem', trim: 'chevron' },
  nagavar:    { metal: 0xd8b03a, metalM: 0.55, carve: 0xd8b03a, motif: 'scale', emblem: 'cobra', figure: 'cobra', lantern: 'oil', finial: 'lotus', banner: 'swallow', trim: 'dots', glow: 0x3aff8a },
  pearlfleet: { metal: 0xf0e8d8, metalM: 0.45, carve: 0xe8f0f0, motif: 'shell', emblem: 'pearl', figure: 'fish', lantern: 'crystal', finial: 'shell', banner: 'pennon', trim: 'band', glow: 0x8af0ff },
  glimmer:    { metal: 0xc8a040, metalM: 0.5, carve: 0x2a5a6a, motif: 'rivet', emblem: 'gem', figure: 'frog', lantern: 'lantern', finial: 'crystal', banner: 'swallow', trim: 'stripes', glow: 0xff8ad8 },
  khanate:    { metal: 0xc8a040, metalM: 0.35, carve: 0x8a1a1a, motif: 'chevron', emblem: 'tamga', figure: 'horse', lantern: 'brazier', finial: 'horsetail', banner: 'horsetail', trim: 'chevron', tone: 0.6 },
  emerald:    { metal: 0xd8b03a, metalM: 0.55, carve: 0x2a8a5a, motif: 'step', emblem: 'sunmask', figure: 'tiger', lantern: 'brazier', finial: 'feathers', banner: 'gonfalon', trim: 'teeth', glow: 0x3aff8a },
  deeproot:   { metal: 0xe8d83a, metalM: 0.15, carve: 0x3a6a2a, motif: 'leaf', emblem: 'mushroom', figure: 'frog', lantern: 'wisp', finial: 'mushroom', banner: 'pennon', trim: 'dots', glow: 0xd8ff5a },
  goldsands:  { metal: 0xd8b03a, metalM: 0.55, carve: 0x2a8a9a, motif: 'arch', emblem: 'star8', figure: 'horse', lantern: 'oil', finial: 'crescent', banner: 'pennon', trim: 'chevron' },
};
const DEFAULT = { metal: 0xd4a83a, metalM: 0.5, carve: 0xd4a83a, motif: 'scroll', emblem: 'sun', figure: 'horse', lantern: 'lantern', finial: 'ball', banner: 'square', trim: 'band' };
export const REALM_STYLE = T;

const realmById = new Map(REALMS.map((r) => [r.id, r]));
const styles = new Map();
/** the style of a designed ship */
export function styleOf(def) {
  const id = def.realm || String(def.id || '').split('_')[0];
  const key = `${id}|${def.color}|${def.sail}|${def.trim}`;
  if (styles.has(key)) return styles.get(key);
  const r = realmById.get(id), P = r?.P || {}, t = T[id] || DEFAULT;
  const cloth = P.cloth ?? def.sail ?? 0xe8e0c8, cloth2 = P.cloth2 ?? def.trim ?? 0xd4a83a;
  const st = {
    id, ...t,
    cloth, cloth2, armor: P.armor ?? 0x8a9098,
    wood: def.color ?? 0x6b4a2e,
    metal: t.metal, metalM: t.metalM ?? 0.5,
    band: [cloth, cloth2],
    glow: t.glow ?? 0xffc070,
    tone: t.tone ?? 0,
  };
  // a realm whose cloth is nearly the hull's colour paints its band in the second colour
  if (Math.abs(lum(st.band[0]) - lum(st.wood)) < 0.06) st.band = [cloth2, cloth];
  styles.set(key, st);
  return st;
}
function lum(hex) { const c = new THREE.Color(hex); return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }

// ===================================================================================
//  devices: 2D layers in the unit square (-0.5..0.5), tone 0 = field colour, 1 = second
// ===================================================================================
const circ = (cx, cy, r, n = 20, a0 = 0) => Array.from({ length: n }, (_, i) => { const a = a0 + (i / n) * PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const star = (cx, cy, R, r, n, a0 = PI / 2) => Array.from({ length: n * 2 }, (_, i) => { const a = a0 + (i / (n * 2)) * PI * 2, rr = i % 2 ? r : R; return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const mirror = (half) => [...half, ...half.slice().reverse().map(([x, y]) => [-x, y])];
const rev = (pts) => pts.slice().reverse();
/** a thick stroke along a polyline */
function stroke(pts, w0, w1 = w0) {
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const w = lerp(w0, w1, i / (pts.length - 1)) / 2;
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]); R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  return [...L, ...R.reverse()];
}
const arc = (cx, cy, r, a0, a1, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const a = lerp(a0, a1, i / n); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const P1 = (pts, holes = []) => ({ pts, holes });

const DEVICES = {
  fleur: () => [{ tone: 1, polys: [
    P1(mirror([[0, 0.48], [0.07, 0.3], [0.07, 0.05], [0.0, -0.02]])),
    P1(stroke([[0.03, 0.02], [0.18, 0.12], [0.33, 0.12], [0.38, 0.0], [0.3, -0.08]], 0.09, 0.05)),
    P1(stroke([[-0.03, 0.02], [-0.18, 0.12], [-0.33, 0.12], [-0.38, 0.0], [-0.3, -0.08]], 0.09, 0.05)),
    P1(rect(-0.25, -0.1, 0.25, -0.02)),
    P1(mirror([[0, -0.1], [0.08, -0.12], [0.12, -0.3], [0.05, -0.45], [0, -0.38]])),
  ] }],
  griffin: () => [{ tone: 1, polys: [
    P1(mirror([[0, 0.45], [0.06, 0.45], [0.06, 0.06], [0.45, 0.06], [0.45, -0.06], [0.06, -0.06], [0.06, -0.45], [0, -0.45]])),
  ] }, { tone: 0, polys: [P1(circ(0, 0, 0.12, 16))] }],
  star: () => [{ tone: 1, polys: [P1(star(0, 0, 0.48, 0.18, 8))] }, { tone: 0, polys: [P1(circ(0, 0, 0.1, 12))] }],
  star8: () => [{ tone: 1, polys: [P1(star(0, 0, 0.48, 0.3, 8, PI / 8))] }, { tone: 0, polys: [P1(star(0, 0, 0.3, 0.2, 8, PI / 8))] }],
  moon: () => [{ tone: 1, polys: [P1([...arc(0, 0, 0.45, PI * 0.25, PI * 1.75, 20), ...arc(0.16, 0, 0.36, PI * 1.62, PI * 0.38, 16)])] },
    { tone: 1, polys: [P1(star(0.24, 0.05, 0.12, 0.05, 4))] }],
  crescent: () => [{ tone: 1, polys: [P1([...arc(0, 0, 0.45, PI * 0.3, PI * 1.7, 20), ...arc(0.14, 0.02, 0.36, PI * 1.6, PI * 0.4, 16)])] },
    { tone: 1, polys: [P1(star(0.26, 0.02, 0.15, 0.06, 5))] }],
  leaf: () => [{ tone: 1, polys: [P1([...arc(0.35, -0.1, 0.62, PI * 0.62, PI * 1.12, 14), ...arc(-0.35, 0.1, 0.62, PI * 1.62, PI * 2.12, 14)])] },
    { tone: 0, polys: [P1(stroke([[-0.32, -0.38], [0, 0], [0.3, 0.36]], 0.04, 0.015))] }],
  hammer: () => [{ tone: 1, polys: [P1(rect(-0.05, -0.45, 0.05, 0.2)), P1(mirror([[0, 0.12], [0.3, 0.12], [0.36, 0.2], [0.36, 0.4], [0.3, 0.45], [0, 0.45]]))] }],
  sunmask: () => [{ tone: 1, polys: [P1(star(0, 0, 0.5, 0.36, 12))] }, { tone: 0, polys: [P1(mirror([[0, 0.3], [0.24, 0.3], [0.3, 0.1], [0.22, -0.18], [0.1, -0.3], [0, -0.3]]))] },
    { tone: 1, polys: [P1(rect(-0.18, 0.04, -0.06, 0.12)), P1(rect(0.06, 0.04, 0.18, 0.12)), P1(rect(-0.12, -0.18, 0.12, -0.12))] }],
  eagle2: () => [{ tone: 1, polys: [
    P1(mirror([[0, 0.2], [0.08, 0.28], [0.14, 0.42], [0.2, 0.36], [0.16, 0.24], [0.48, 0.3], [0.44, 0.16], [0.4, 0.02], [0.3, -0.06], [0.14, -0.08], [0.18, -0.34], [0.06, -0.24], [0, -0.46]])),
  ] }],
  dragon: () => [{ tone: 1, polys: [
    P1(stroke([[-0.4, -0.38], [-0.1, -0.3], [0.2, -0.15], [0.1, 0.05], [-0.2, 0.05], [-0.25, 0.22], [0, 0.32], [0.25, 0.28]], 0.11, 0.05)),
    P1([[0.2, 0.22], [0.48, 0.3], [0.42, 0.38], [0.18, 0.4]]),
  ] }, { tone: 1, polys: [P1(circ(-0.36, -0.36, 0.06, 8))] }],
  fist: () => [{ tone: 1, polys: [P1([[-0.3, -0.45], [0.2, -0.45], [0.2, -0.1], [0.32, 0.0], [0.32, 0.38], [-0.3, 0.38]])] },
    { tone: 0, polys: [P1(rect(-0.16, 0.06, -0.12, 0.38)), P1(rect(0.0, 0.06, 0.04, 0.38)), P1(rect(0.16, 0.06, 0.2, 0.38)), P1(rect(-0.3, -0.12, 0.2, -0.08))] }],
  maw: () => [{ tone: 1, polys: [P1(circ(0, 0, 0.46, 24))] }, { tone: 0, polys: [P1([...arc(0, 0.05, 0.32, PI * 1.1, PI * 1.9, 10), ...arc(0, -0.25, 0.32, PI * 0.25, PI * 0.75, 10)])] },
    { tone: 1, polys: [-0.2, -0.08, 0.04, 0.16].map((x) => P1([[x - 0.05, -0.1], [x + 0.05, -0.1], [x, 0.02]])) }],
  horns: () => [{ tone: 1, polys: [P1(stroke([[-0.1, -0.3], [-0.35, -0.1], [-0.4, 0.2], [-0.25, 0.45]], 0.16, 0.02)), P1(stroke([[0.1, -0.3], [0.35, -0.1], [0.4, 0.2], [0.25, 0.45]], 0.16, 0.02)), P1(circ(0, -0.28, 0.14, 14))] }],
  axe: () => [{ tone: 1, polys: [P1(rect(-0.035, -0.48, 0.035, 0.45)), P1([...arc(0.06, 0.2, 0.33, -PI * 0.42, PI * 0.42, 10).map(([x, y]) => [x, y]), [0.06, 0.32], [0.06, 0.08]])] }],
  bull: () => [{ tone: 1, polys: [P1(mirror([[0, -0.42], [0.12, -0.38], [0.2, -0.05], [0.26, 0.1], [0.46, 0.06], [0.48, 0.3], [0.36, 0.18], [0.2, 0.24], [0, 0.26]]))] },
    { tone: 0, polys: [P1(circ(-0.1, 0.06, 0.04, 8)), P1(circ(0.1, 0.06, 0.04, 8))] }],
  tusks: () => [{ tone: 1, polys: [P1(stroke([[-0.4, -0.4], [-0.3, 0], [-0.05, 0.3], [0.25, 0.42]], 0.13, 0.01)), P1(stroke([[0.4, -0.4], [0.3, 0], [0.05, 0.3], [-0.25, 0.42]], 0.13, 0.01))] }],
  claw: () => [{ tone: 1, polys: [-0.24, 0, 0.24].map((x) => P1(stroke([[x - 0.12, -0.45], [x + 0.02, -0.1], [x + 0.06, 0.2], [x + 0.02, 0.46]], 0.02, 0.12))) }],
  bat: () => [{ tone: 1, polys: [P1(mirror([[0, 0.12], [0.05, 0.24], [0.08, 0.14], [0.2, 0.2], [0.48, 0.3], [0.42, 0.08], [0.34, -0.04], [0.26, 0.04], [0.2, -0.08], [0.1, -0.02], [0.06, -0.2], [0, -0.26]]))] }],
  scarab: () => [{ tone: 1, polys: [P1(circ(0, 0.33, 0.13, 16)), P1(mirror([[0, 0.18], [0.16, 0.12], [0.2, -0.1], [0.12, -0.3], [0, -0.36]])), P1(mirror([[0.16, 0.05], [0.48, 0.2], [0.46, -0.04], [0.2, -0.12]]))] }],
  trident: () => [{ tone: 1, polys: [P1(rect(-0.035, -0.48, 0.035, 0.3)), P1(stroke([[-0.3, 0.42], [-0.3, 0.14], [0.3, 0.14], [0.3, 0.42]], 0.07)), P1([[-0.04, 0.3], [0.04, 0.3], [0, 0.48]]), P1([[-0.34, 0.4], [-0.26, 0.4], [-0.3, 0.5]]), P1([[0.26, 0.4], [0.34, 0.4], [0.3, 0.5]])] }],
  lion: () => [{ tone: 1, polys: [P1(star(0, 0.02, 0.48, 0.36, 14))] }, { tone: 0, polys: [P1(mirror([[0, 0.24], [0.18, 0.2], [0.22, 0.0], [0.12, -0.22], [0, -0.28]]))] },
    { tone: 1, polys: [P1(circ(-0.08, 0.06, 0.035, 8)), P1(circ(0.08, 0.06, 0.035, 8)), P1([[-0.05, -0.08], [0.05, -0.08], [0, -0.14]])] }],
  tower: () => [{ tone: 1, polys: [P1([[-0.24, -0.45], [0.24, -0.45], [0.2, 0.25], [0.3, 0.25], [0.3, 0.45], [0.18, 0.45], [0.18, 0.36], [0.06, 0.36], [0.06, 0.45], [-0.06, 0.45], [-0.06, 0.36], [-0.18, 0.36], [-0.18, 0.45], [-0.3, 0.45], [-0.3, 0.25], [-0.2, 0.25]], [rev([[-0.08, -0.45], [0.08, -0.45], [0.08, -0.25], [0, -0.18], [-0.08, -0.25]])])] }],
  sun: () => [{ tone: 1, polys: [P1(star(0, 0, 0.5, 0.3, 16))] }, { tone: 0, polys: [P1(circ(0, 0, 0.22, 20))] }, { tone: 1, polys: [P1(circ(0, 0, 0.12, 14))] }],
  mon: () => [{ tone: 1, polys: [P1(circ(0, 0, 0.46, 28), [rev(circ(0, 0, 0.38, 28))])] }, { tone: 1, polys: [0, 1, 2].map((i) => { const a = (i / 3) * PI * 2 + 0.3; return P1(stroke(arc(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.14, a, a + PI * 0.9, 8), 0.14, 0.02)); }) }],
  triskele: () => [{ tone: 1, polys: [0, 1, 2].map((i) => { const a = (i / 3) * PI * 2; const pts = []; for (let k = 0; k <= 14; k++) { const t = k / 14, r = 0.05 + t * 0.36, b = a + t * PI * 1.4; pts.push([Math.cos(b) * r, Math.sin(b) * r]); } return P1(stroke(pts, 0.04, 0.11)); }) }],
  lotus: () => [{ tone: 1, polys: [-2, -1, 0, 1, 2].map((i) => { const a = PI / 2 + i * 0.42, r = i ? 0.36 : 0.46; const cx = Math.cos(a) * r * 0.5, cy = -0.2 + Math.sin(a) * r * 0.5; return P1([[0, -0.25], [cx - Math.sin(a) * 0.1, cy + Math.cos(a) * 0.1 * 0], [Math.cos(a) * r, -0.2 + Math.sin(a) * r], [cx + Math.sin(a) * 0.1, cy]]); }) },
    { tone: 1, polys: [P1(rect(-0.3, -0.34, 0.3, -0.26))] }],
  fly: () => [{ tone: 1, polys: [P1(circ(0, -0.05, 0.12, 12)), P1(circ(0, 0.16, 0.08, 10)), P1([[0.02, 0.02], [0.46, 0.28], [0.4, -0.02]]), P1([[-0.02, 0.02], [-0.46, 0.28], [-0.4, -0.02]]),
    ...[-1, 1].flatMap((s) => [P1(stroke([[s * 0.06, -0.05], [s * 0.3, -0.2], [s * 0.34, -0.42]], 0.03)), P1(stroke([[s * 0.06, -0.1], [s * 0.18, -0.35], [s * 0.14, -0.48]], 0.03))])] }],
  maze: () => [{ tone: 1, polys: [P1(rect(-0.46, -0.46, 0.46, 0.46), [rev(rect(-0.38, -0.38, 0.38, 0.38))]), P1(rect(-0.3, -0.3, 0.3, -0.22)), P1(rect(0.22, -0.3, 0.3, 0.3)), P1(rect(-0.3, 0.22, 0.22, 0.3)), P1(rect(-0.3, -0.14, -0.22, 0.22)), P1(rect(-0.14, -0.14, 0.14, -0.06)), P1(rect(0.06, -0.06, 0.14, 0.14))] }],
  mask: () => [{ tone: 1, polys: [P1(mirror([[0, 0.05], [0.1, 0.12], [0.3, 0.16], [0.48, 0.3], [0.44, 0.0], [0.3, -0.16], [0.12, -0.12], [0, -0.02]]), [rev(circ(-0.2, 0.02, 0.07, 10)), rev(circ(0.2, 0.02, 0.07, 10))])] },
    { tone: 1, polys: [P1(stroke([[0.4, 0.2], [0.42, 0.4], [0.3, 0.5]], 0.05, 0.01))] }],
  eye: () => [{ tone: 1, polys: [P1([...arc(0, -0.32, 0.56, PI * 0.22, PI * 0.78, 12), ...arc(0, 0.32, 0.56, PI * 1.22, PI * 1.78, 12)])] }, { tone: 0, polys: [P1(circ(0, 0, 0.16, 16))] }, { tone: 1, polys: [P1([[0, 0.14], [0.04, 0], [0, -0.14], [-0.04, 0]])] }],
  wolfhead: () => [{ tone: 1, polys: [P1(mirror([[0, -0.46], [0.08, -0.4], [0.18, -0.1], [0.3, 0.12], [0.34, 0.46], [0.18, 0.28], [0.08, 0.3], [0, 0.28]]))] }, { tone: 0, polys: [P1([[-0.16, 0.06], [-0.06, 0.02], [-0.12, 0.12]]), P1([[0.16, 0.06], [0.06, 0.02], [0.12, 0.12]])] }],
  acorn: () => [{ tone: 1, polys: [P1(mirror([[0, -0.46], [0.12, -0.38], [0.26, -0.15], [0.28, 0.06], [0, 0.06]])), P1(mirror([[0, 0.04], [0.34, 0.04], [0.32, 0.2], [0.16, 0.3], [0.04, 0.32], [0.03, 0.46], [0, 0.46]]))] }],
  tree: () => [{ tone: 1, polys: [P1(mirror([[0, -0.46], [0.24, -0.46], [0.1, -0.36], [0.1, 0.0], [0, 0.04]])), P1(circ(0, 0.18, 0.22, 16)), P1(circ(-0.26, 0.12, 0.16, 12)), P1(circ(0.26, 0.12, 0.16, 12)), P1(circ(0, 0.36, 0.13, 12))] }],
  cobra: () => [{ tone: 1, polys: [P1(mirror([[0, 0.46], [0.12, 0.42], [0.24, 0.2], [0.2, -0.02], [0.08, -0.1], [0, -0.12]])), P1(stroke([[0, -0.12], [0.1, -0.24], [-0.1, -0.36], [0.06, -0.46], [0.28, -0.42]], 0.12, 0.03))] },
    { tone: 0, polys: [P1(circ(-0.06, 0.32, 0.03, 8)), P1(circ(0.06, 0.32, 0.03, 8)), P1(mirror([[0, 0.18], [0.1, 0.12], [0.08, 0.02], [0, -0.02]]))] }],
  pearl: () => [{ tone: 1, polys: [-3, -2, -1, 0, 1, 2, 3].map((i) => { const a = PI / 2 + i * 0.32; return P1([[0, -0.4], [Math.cos(a - 0.12) * 0.5, -0.36 + Math.sin(a - 0.12) * 0.8], [Math.cos(a + 0.12) * 0.5, -0.36 + Math.sin(a + 0.12) * 0.8]]); }) }, { tone: 0, polys: [P1(circ(0, 0.0, 0.14, 14))] }],
  gem: () => [{ tone: 1, polys: [P1([[0, -0.48], [0.42, 0.08], [0.26, 0.34], [-0.26, 0.34], [-0.42, 0.08]])] }, { tone: 0, polys: [P1(stroke([[-0.42, 0.08], [0.42, 0.08]], 0.03)), P1(stroke([[0, -0.48], [-0.12, 0.08], [0, 0.34]], 0.025)), P1(stroke([[0, -0.48], [0.12, 0.08], [0, 0.34]], 0.025))] }],
  tamga: () => [{ tone: 1, polys: [P1(rect(-0.04, -0.46, 0.04, 0.2)), P1(stroke([[-0.32, 0.46], [-0.3, 0.16], [0, 0.04], [0.3, 0.16], [0.32, 0.46]], 0.08)), P1(circ(0, -0.1, 0.1, 12), [rev(circ(0, -0.1, 0.05, 10))])] }],
  mushroom: () => [{ tone: 1, polys: [P1(mirror([[0, 0.46], [0.24, 0.42], [0.44, 0.18], [0.46, 0.06], [0, 0.06]]))] }, { tone: 0, polys: [P1(mirror([[0, 0.06], [0.1, 0.06], [0.14, -0.4], [0.2, -0.46], [0, -0.46]])), P1(circ(-0.2, 0.26, 0.06, 8)), P1(circ(0.14, 0.32, 0.05, 8)), P1(circ(0.3, 0.16, 0.04, 8))] }],
  flame: () => [{ tone: 1, polys: [P1([[0, -0.46], [0.3, -0.34], [0.38, -0.04], [0.24, 0.18], [0.26, 0.42], [0.08, 0.2], [0, 0.48], [-0.12, 0.22], [-0.3, 0.32], [-0.26, 0.06], [-0.38, -0.12], [-0.28, -0.36]])] }, { tone: 0, polys: [P1([[0, -0.36], [0.14, -0.24], [0.12, 0.02], [0, 0.18], [-0.12, 0.0], [-0.14, -0.24]])] }],
  skull: () => [{ tone: 1, polys: [P1(mirror([[0, 0.46], [0.24, 0.42], [0.36, 0.2], [0.32, -0.04], [0.2, -0.14], [0.2, -0.32], [0.1, -0.4], [0, -0.4]]), [rev(circ(-0.14, 0.08, 0.09, 10)), rev(circ(0.14, 0.08, 0.09, 10)), rev([[0, -0.04], [0.04, -0.14], [-0.04, -0.14]])])] }],
};
DEVICES.wolf = DEVICES.wolfhead; DEVICES.cross = DEVICES.griffin; DEVICES.eagle = DEVICES.eagle2; DEVICES.serpent = DEVICES.cobra;

export function emblemPolys(name) { return (DEVICES[name] || DEVICES.sun)(); }

const shapeCache = new Map();
function devGeos(name, depth) {
  const k = `${name}|${depth}`;
  if (shapeCache.has(k)) return shapeCache.get(k);
  const layers = emblemPolys(name).map((ly) => {
    const shapes = ly.polys.map(({ pts, holes }) => { const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))); for (const h of holes || []) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y)))); return s; });
    const g = depth ? new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 4 }) : new THREE.ShapeGeometry(shapes, 4);
    return { tone: ly.tone, geo: g };
  });
  shapeCache.set(k, layers);
  return layers;
}
/**
 * the realm's device as a relief in the kit's current xy plane, facing +z, size across; o: { col: [field, second],
 * depth (relief thickness, fraction of size), back: true also draw it facing -z, m, g (glow) }
 */
export function emblem(K, st, size, o = {}) {
  const name = o.name || st.emblem, cols = o.col || [st.cloth, st.metal], depth = o.depth ?? 0.06;
  const layers = devGeos(name, 1);
  layers.forEach((ly, i) => {
    const col = cols[ly.tone] ?? cols[1];
    const metal = col === st.metal ? st.metalM : 0.05, z = i * size * depth * 0.5;
    K.add(ly.geo, col, 0, 0, z, { s: size, sz: size * depth, m: o.m ?? metal, r: metal > 0.3 ? 0.35 : 0.7, g: o.g ?? 0 });
    if (o.back) K.add(ly.geo, col, 0, 0, -z - size * depth, { s: size, sz: size * depth, m: o.m ?? metal, r: metal > 0.3 ? 0.35 : 0.7, g: o.g ?? 0 });
  });
}

// ===================================================================================
//  running carving: one unit, ~size wide and ~0.45 size tall, relief toward +z
// ===================================================================================
export function motif(K, st, size, kind = st.motif) {
  const s = size, c = st.carve, m = st.metal, gm = { m: st.metalM, r: 0.4 }, wd = { r: 0.7 };
  const metalCarve = c === st.metal;
  const o = metalCarve ? gm : wd;
  switch (kind) {
    case 'scroll': {
      for (const dir of [-1, 1]) {
        const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10, a = dir * (t * PI * 1.6) + (dir > 0 ? PI : 0), r = s * (0.2 - t * 0.13); pts.push([dir * s * 0.22 + Math.cos(a) * r, Math.sin(a) * r, 0]); }
        K.add(taper(`scroll${dir}${s.toFixed(3)}`, pts, [s * 0.045, s * 0.02], 12, 4), c, 0, 0, 0, o);
      }
      K.add(G.sph(s * 0.07, 6, 4), m, 0, 0, s * 0.02, gm);
      break;
    }
    case 'wave': {
      const pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([lerp(-0.5, 0.25, t) * s, Math.sin(t * PI) * s * 0.18, 0]); }
      for (let k = 0; k <= 6; k++) { const a = PI - (k / 6) * PI * 1.5, r = s * 0.14 * (1 - k / 9); pts.push([s * 0.25 + Math.cos(a) * r + s * 0.14, s * 0.0 + Math.sin(a) * r, 0]); }
      K.add(taper(`wave${s.toFixed(3)}`, pts, [s * 0.04, s * 0.03], 18, 4), c, 0, 0, 0, o);
      break;
    }
    case 'knot': {
      K.add(G.tor(s * 0.17, s * 0.035, 4, 12), c, -s * 0.12, 0, 0, o).add(G.tor(s * 0.17, s * 0.035, 4, 12), c, s * 0.12, 0, s * 0.01, o);
      K.add(G.box(s * 0.9, s * 0.04, s * 0.04), shade(c, 0.8), 0, -s * 0.22, 0, o).add(G.box(s * 0.9, s * 0.04, s * 0.04), shade(c, 0.8), 0, s * 0.22, 0, o);
      break;
    }
    case 'chevron': for (const sg of [-1, 1]) { K.add(G.box(s * 0.38, s * 0.08, s * 0.05), c, sg * s * 0.14, 0, 0, { ...o, rz: sg * 0.6 }); K.add(G.box(s * 0.3, s * 0.06, s * 0.04), m, sg * s * 0.12, -s * 0.15, 0, { ...gm, rz: sg * 0.6 }); } break;
    case 'teeth': for (let i = 0; i < 3; i++) K.add(G.cone(s * 0.12, s * 0.36, 4), i % 2 ? C.bone : c, (i - 1) * s * 0.3, 0, 0, { ...o, rz: i % 2 ? PI : 0, sz: 0.4 }); break;
    case 'spikes': K.add(G.rbox(s * 0.8, s * 0.3, s * 0.05, s * 0.03), c, 0, 0, 0, { m: 0.5, r: 0.45 }); for (const x of [-0.25, 0.25]) K.add(G.cone(s * 0.07, s * 0.28, 5), m, x * s, 0, s * 0.12, { rx: PI / 2, ...gm }); break;
    case 'rivet': K.add(G.rbox(s * 0.86, s * 0.34, s * 0.04, s * 0.03), shade(c, 1.05), 0, 0, 0, { m: 0.5, r: 0.4 }); for (const x of [-0.36, -0.12, 0.12, 0.36]) for (const y of [-0.11, 0.11]) K.add(G.sph(s * 0.028, 5, 3), m, x * s, y * s, s * 0.025, gm); break;
    case 'skull': case 'bone': {
      if (kind === 'skull') { K.add(G.sph(s * 0.14, 8, 6), C.bone, 0, s * 0.03, 0, { sz: 0.6 }); for (const z of [-1, 1]) K.add(G.sph(s * 0.035, 5, 3), C.black, z * s * 0.05, s * 0.04, s * 0.07); }
      else { K.add(G.cyl(s * 0.03, s * 0.03, s * 0.6, 5), C.bone, 0, 0, 0, { rz: PI / 2 }); for (const x of [-1, 1]) for (const y of [-1, 1]) K.add(G.sph(s * 0.05, 5, 4), C.bone, x * s * 0.3, y * s * 0.04, 0); }
      break;
    }
    case 'leaf': for (const sg of [-1, 1]) { K.add(G.sph(s * 0.18, 7, 4), c, sg * s * 0.18, sg * s * 0.04, 0, { sx: 1.4, sy: 0.55, sz: 0.3, rz: sg * 0.4, r: 0.7 }); } K.add(G.cyl(s * 0.015, s * 0.015, s * 0.9, 4), shade(c, 0.6), 0, 0, -s * 0.02, { rz: PI / 2 }); break;
    case 'step': K.add(G.box(s * 0.9, s * 0.07, s * 0.05), c, 0, -s * 0.18, 0, o); K.add(G.box(s * 0.07, s * 0.3, s * 0.05), c, -s * 0.2, -s * 0.06, 0, o); K.add(G.box(s * 0.3, s * 0.07, s * 0.05), c, -s * 0.06, s * 0.1, 0, o); K.add(G.box(s * 0.07, s * 0.18, s * 0.05), c, s * 0.08, 0.0, 0, o); K.add(G.box(s * 0.2, s * 0.06, s * 0.05), m, s * 0.3, s * 0.12, 0, gm); break;
    case 'lotus': for (let i = -2; i <= 2; i++) K.add(G.sph(s * 0.1, 6, 4), i ? c : m, i * s * 0.07, s * 0.06 - Math.abs(i) * s * 0.02, 0, { sx: 0.6, sy: 1.6, sz: 0.4, rz: -i * 0.35, ...(i ? o : gm) }); K.add(G.box(s * 0.7, s * 0.05, s * 0.04), c, 0, -s * 0.14, 0, o); break;
    case 'cloud': for (const [x, r] of [[-0.22, 0.14], [0.02, 0.18], [0.26, 0.12]]) K.add(G.tor(s * r, s * 0.03, 4, 10, PI * 1.4), c, x * s, 0, 0, { ...o, rz: -0.2 }); break;
    case 'feather': for (let i = 0; i < 3; i++) K.add(G.sph(s * 0.18, 6, 4), i === 1 ? m : c, (i - 1) * s * 0.28, 0, 0, { sx: 1.5, sy: 0.35, sz: 0.25, rz: 0.5, ...(i === 1 ? gm : o) }); break;
    case 'scale': for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) K.add(G.hemi(s * 0.12, 7, 3), j ? m : c, (i - 1 + j * 0.5 - 0.25) * s * 0.26, (j - 0.5) * s * 0.16, 0, { rx: PI / 2, sy: 0.3, ...(j ? gm : o) }); break;
    case 'eye': K.add(G.sph(s * 0.16, 8, 5), C.flesh, 0, 0, 0, { sx: 1.6, sz: 0.4 }); K.add(G.sph(s * 0.08, 8, 5), st.glow, 0, 0, s * 0.05, { sz: 0.5, g: 1.6 }); K.add(G.sph(s * 0.035, 5, 3), C.black, 0, 0, s * 0.085); break;
    case 'thorn': K.add(G.cyl(s * 0.03, s * 0.03, s, 4), c, 0, 0, 0, { rz: PI / 2 }); for (const x of [-0.3, 0, 0.3]) K.add(G.cone(s * 0.05, s * 0.2, 4), shade(c, 1.4), x * s, s * 0.08, 0, { rz: -0.5 }); break;
    case 'bat': K.add(G.shape('motifbat', DEVICES.bat()[0].polys[0].pts, 1), c, 0, 0, 0, { sx: s * 0.6, sy: s * 0.6, sz: s * 0.04, ...o }); break;
    case 'shell': for (let i = -3; i <= 3; i++) K.add(G.cone(s * 0.05, s * 0.32, 4), i % 2 ? c : shade(c, 0.85), i * s * 0.04, s * 0.02, 0, { rz: -i * 0.28, sz: 0.4, r: 0.4 }); break;
    case 'arch': { const g = G.shape('motifarch', [[-0.4, -0.2], [-0.4, 0.05], [-0.25, 0.2], [0, 0.3], [0.25, 0.2], [0.4, 0.05], [0.4, -0.2], [0.3, -0.2], [0.3, 0.02], [0.2, 0.12], [0, 0.18], [-0.2, 0.12], [-0.3, 0.02], [-0.3, -0.2]], 1); K.add(g, c, 0, 0, 0, { s, sz: s * 0.05, ...o }); K.add(G.sph(s * 0.05, 5, 3), m, 0, s * 0.02, 0, gm); break; }
    case 'shields': default: K.add(G.cyl(s * 0.2, s * 0.2, s * 0.04, 12), c, 0, 0, 0, { rx: PI / 2, ...o }); K.add(G.sph(s * 0.06, 6, 4), m, 0, 0, s * 0.02, gm); break;
  }
}

// ===================================================================================
//  finials, lanterns, banners
// ===================================================================================
export function finial(K, st, size, kind = st.finial) {
  const s = size, m = st.metal, gm = { m: st.metalM, r: 0.35 };
  K.add(G.cyl(s * 0.1, s * 0.13, s * 0.12, 8), m, 0, s * 0.06, 0, gm);
  switch (kind) {
    case 'ball': K.add(G.sph(s * 0.16, 10, 8), m, 0, s * 0.28, 0, gm).add(G.cone(s * 0.05, s * 0.2, 6), m, 0, s * 0.52, 0, gm); break;
    case 'onion': K.add(G.lathe('onion', [[0, 0], [0.12, 0.04], [0.2, 0.16], [0.16, 0.3], [0.05, 0.42], [0.01, 0.56], [0, 0.6]], 10), m, 0, s * 0.1, 0, { s, ...gm }); break;
    case 'fleur': emblemAt(K, st, 'fleur', s * 0.7, 0, s * 0.45, 0, [m, m]); break;
    case 'cross': K.add(G.box(s * 0.06, s * 0.55, s * 0.06), m, 0, s * 0.38, 0, gm).add(G.box(s * 0.3, s * 0.06, s * 0.06), m, 0, s * 0.48, 0, gm); break;
    case 'crescent': K.add(G.tor(s * 0.16, s * 0.035, 4, 12, PI * 1.4), m, 0, s * 0.36, 0, { ...gm, rz: -PI * 0.2 }); K.add(G.sph(s * 0.05, 6, 4), m, 0, s * 0.18, 0, gm); break;
    case 'crystal': K.add(G.oct(s * 0.16), st.glow, 0, s * 0.36, 0, { sy: 2, g: 1.2, r: 0.2 }); break;
    case 'spike': K.add(G.cone(s * 0.08, s * 0.55, 6), m, 0, s * 0.38, 0, gm); for (const a of [0, 2.1, 4.2]) K.add(G.cone(s * 0.03, s * 0.2, 4), m, Math.cos(a) * s * 0.08, s * 0.2, Math.sin(a) * s * 0.08, { rz: -Math.cos(a) * 1.0, rx: Math.sin(a) * 1.0, ...gm }); break;
    case 'horn': for (const z of [-1, 1]) K.add(taper(`fhorn${z}`, [[0, 0, 0], [0, 0.2, z * 0.12], [0.08, 0.38, z * 0.2], [0.18, 0.46, z * 0.14]], [0.06, 0.005], 8, 5), C.bone, 0, s * 0.1, 0, { s }); K.add(G.sph(s * 0.09, 6, 4), m, 0, s * 0.16, 0, gm); break;
    case 'tusk': K.add(taper('ftusk', [[0, 0, 0], [0.06, 0.25, 0], [0.18, 0.45, 0], [0.32, 0.5, 0]], [0.07, 0.005], 8, 5), C.bone, 0, s * 0.1, 0, { s }); break;
    case 'curl': { const pts = []; for (let k = 0; k <= 14; k++) { const t = k / 14, a = PI * 1.0 - t * PI * 2.2, r = 0.22 * (1 - t * 0.6); pts.push([0.22 + Math.cos(a) * r, 0.25 + 0.2 * t + Math.sin(a) * r, 0]); } pts.unshift([0, 0, 0]); K.add(taper('fcurl', pts, [0.07, 0.02], 18, 5), st.carve, 0, s * 0.1, 0, { s, r: 0.6 }); break; }
    case 'lotus': for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; K.add(G.sph(s * 0.1, 6, 4), m, Math.cos(a) * s * 0.07, s * 0.3, Math.sin(a) * s * 0.07, { sx: 0.5, sy: 1.6, sz: 0.5, rz: -Math.cos(a) * 0.5, rx: Math.sin(a) * 0.5, ...gm }); } K.add(G.sph(s * 0.07, 6, 4), st.glow, 0, s * 0.34, 0, { g: 0.6 }); break;
    case 'feathers': for (let i = -2; i <= 2; i++) K.add(G.sph(s * 0.16, 6, 4), i % 2 ? st.cloth : st.cloth2, i * s * 0.02, s * 0.4, 0, { sx: 0.25, sy: 1.6, sz: 0.06, rz: -i * 0.35, ry: PI / 2 }); break;
    case 'antler': for (const z of [-1, 1]) { K.add(taper(`fant${z}`, [[0, 0, 0], [0.04, 0.2, z * 0.1], [0, 0.42, z * 0.22]], [0.035, 0.01], 8, 4), C.bone, 0, s * 0.1, 0, { s }); K.add(taper(`fant2${z}`, [[0.02, 0.18, z * 0.08], [0.14, 0.3, z * 0.12]], [0.022, 0.006], 4, 4), C.bone, 0, s * 0.1, 0, { s }); } break;
    case 'trident': K.add(G.box(s * 0.04, s * 0.3, s * 0.04), m, 0, s * 0.28, 0, gm).add(G.box(s * 0.04, s * 0.04, s * 0.3), m, 0, s * 0.4, 0, gm); for (const z of [-1, 0, 1]) K.add(G.cone(s * 0.03, s * 0.2, 4), m, 0, s * 0.5, z * s * 0.13, gm); break;
    case 'flame': K.add(G.cone(s * 0.14, s * 0.4, 7), C.fire, 0, s * 0.34, 0, { g: 2.2 }).add(G.cone(s * 0.08, s * 0.28, 6), 0xffe08a, 0, s * 0.3, 0, { g: 3 }); break;
    case 'skull': K.add(G.sph(s * 0.14, 8, 6), C.bone, 0, s * 0.28, 0).add(G.box(s * 0.12, s * 0.1, s * 0.16), C.bone, s * 0.04, s * 0.18, 0); break;
    case 'shell': for (let i = -3; i <= 3; i++) K.add(G.cone(s * 0.05, s * 0.34, 4), C.bone, 0, s * 0.3, i * s * 0.03, { rx: i * 0.25, sx: 0.4, r: 0.4 }); K.add(G.sph(s * 0.06, 6, 4), 0xf4f0ff, 0, s * 0.18, 0, { m: 0.4, r: 0.2 }); break;
    case 'mushroom': K.add(G.cyl(s * 0.05, s * 0.06, s * 0.25, 6), 0xe8e0c8, 0, s * 0.24, 0).add(G.hemi(s * 0.18, 10, 4), 0xc82a2a, 0, s * 0.34, 0, { sy: 0.7 }); for (let i = 0; i < 4; i++) K.add(G.sph(s * 0.025, 4, 3), 0xffffff, Math.cos(i * 1.6) * s * 0.1, s * 0.44, Math.sin(i * 1.6) * s * 0.1); break;
    case 'horsetail': K.add(G.sph(s * 0.08, 6, 4), m, 0, s * 0.2, 0, gm); for (let i = 0; i < 7; i++) { const a = (i / 7) * PI * 2; K.add(G.cone(s * 0.05, s * 0.5, 4), i % 2 ? 0x2a2018 : 0xe8e0d0, Math.cos(a) * s * 0.05, s * 0.0, Math.sin(a) * s * 0.05, { rx: PI + Math.sin(a) * 0.25, rz: Math.cos(a) * 0.25, r: 0.95 }); } break;
    default: K.add(G.sph(s * 0.14, 8, 6), m, 0, s * 0.26, 0, gm);
  }
}
function emblemAt(K, st, name, size, x, y, z, col) { K.push(x, y, z); emblem(K, st, size, { name, col, back: true, depth: 0.08 }); K.pop(); }

/** a lantern standing on the origin, about size tall */
export function lantern(K, st, size, kind = st.lantern) {
  const s = size, m = st.metal, gm = { m: st.metalM, r: 0.35 }, gl = st.glow;
  switch (kind) {
    case 'paper': K.add(G.sph(s * 0.22, 10, 8), 0xd82a1a, 0, s * 0.4, 0, { sy: 1.25, g: 0.9, r: 0.9 }); for (const y of [0.13, 0.67]) K.add(G.cyl(s * 0.1, s * 0.1, s * 0.05, 8), C.black, 0, s * y, 0); K.add(G.box(s * 0.02, s * 0.25, s * 0.02), 0xd8b03a, 0, s * 0.0, 0); break;
    case 'brazier': K.add(G.cyl(s * 0.04, s * 0.05, s * 0.4, 5), C.iron, 0, s * 0.2, 0, { m: 0.5 }); K.add(G.lathe('brazbowl', [[0.04, 0], [0.2, 0.06], [0.26, 0.2], [0.24, 0.22]], 10), m, 0, s * 0.38, 0, { s, ...gm }); K.add(G.cone(s * 0.18, s * 0.42, 7), C.fire, 0, s * 0.78, 0, { g: 2.2 }); K.add(G.cone(s * 0.1, s * 0.3, 6), 0xffe08a, 0, s * 0.72, 0, { g: 3 }); break;
    case 'skull': K.add(G.cyl(s * 0.03, s * 0.03, s * 0.4, 5), C.dark, 0, s * 0.2, 0); K.add(G.sph(s * 0.16, 8, 6), C.bone, 0, s * 0.5, 0); for (const z of [-1, 1]) K.add(G.sph(s * 0.04, 5, 3), gl, s * 0.12, s * 0.52, z * s * 0.06, { g: 3 }); K.add(G.cone(s * 0.08, s * 0.2, 5), gl, 0, s * 0.72, 0, { g: 2 }); break;
    case 'crystal': K.add(G.cyl(s * 0.03, s * 0.04, s * 0.35, 6), m, 0, s * 0.17, 0, gm); K.add(G.tor(s * 0.12, s * 0.02, 4, 12), m, 0, s * 0.42, 0, { rx: PI / 2, ...gm }); K.add(G.oct(s * 0.13), gl, 0, s * 0.58, 0, { sy: 1.8, g: 2 }); break;
    case 'witchlight': K.add(G.cyl(s * 0.03, s * 0.04, s * 0.45, 5), C.iron, 0, s * 0.22, 0, { m: 0.5 }); K.add(G.tor(s * 0.14, s * 0.018, 3, 10), C.iron, 0, s * 0.62, 0, { m: 0.5 }); for (let i = 0; i < 4; i++) { const a = i * PI / 2; K.add(G.cone(s * 0.02, s * 0.18, 4), C.iron, Math.cos(a) * s * 0.12, s * 0.72, Math.sin(a) * s * 0.12, { m: 0.5 }); } K.add(G.sph(s * 0.11, 8, 6), gl, 0, s * 0.62, 0, { g: 2.6 }); break;
    case 'wisp': K.add(taper('wispstaff', [[0, 0, 0], [0.02, 0.3, 0], [0.12, 0.55, 0], [0.04, 0.68, 0]], [0.035, 0.015], 10, 4), C.wood, 0, 0, 0, { s }); K.add(G.sph(s * 0.1, 8, 6), gl, s * 0.06, s * 0.6, 0, { g: 2.6 }); break;
    case 'warp': K.add(G.cyl(s * 0.04, s * 0.05, s * 0.4, 6), C.iron, 0, s * 0.2, 0, { m: 0.5 }); K.add(G.cyl(s * 0.11, s * 0.11, s * 0.3, 6, true), C.iron, 0, s * 0.58, 0, { m: 0.5 }); K.add(G.dod(s * 0.09), gl, 0, s * 0.58, 0, { g: 2.6 }); break;
    case 'gourd': K.add(G.cyl(s * 0.03, s * 0.03, s * 0.35, 5), C.wood, 0, s * 0.17, 0); K.add(G.sph(s * 0.15, 8, 6), 0xc89a4a, 0, s * 0.48, 0, { sy: 1.2 }); K.add(G.sph(s * 0.1, 8, 6), 0xc89a4a, 0, s * 0.68, 0); for (let i = 0; i < 3; i++) K.add(G.sph(s * 0.03, 4, 3), 0xffb040, Math.cos(i * 2.1) * s * 0.14, s * 0.48, Math.sin(i * 2.1) * s * 0.14, { g: 2.5 }); break;
    case 'oil': K.add(G.cyl(s * 0.03, s * 0.04, s * 0.35, 6), m, 0, s * 0.17, 0, gm); K.add(G.lathe('oillamp', [[0, 0], [0.12, 0.02], [0.16, 0.1], [0.1, 0.18], [0.04, 0.22]], 10), m, 0, s * 0.36, 0, { s, ...gm }); K.add(G.cone(s * 0.05, s * 0.16, 5), 0xffc050, 0, s * 0.66, 0, { g: 2.5 }); break;
    case 'lantern': default:
      K.add(G.cyl(s * 0.03, s * 0.04, s * 0.32, 6), C.iron, 0, s * 0.16, 0, { m: 0.5 });
      K.add(G.cyl(s * 0.13, s * 0.11, s * 0.04, 8), m, 0, s * 0.34, 0, gm);
      K.add(G.cyl(s * 0.1, s * 0.1, s * 0.26, 8), 0xffd88a, 0, s * 0.48, 0, { g: 1.8 });
      for (let i = 0; i < 4; i++) { const a = PI / 4 + i * PI / 2; K.add(G.box(s * 0.02, s * 0.28, s * 0.02), m, Math.cos(a) * s * 0.11, s * 0.48, Math.sin(a) * s * 0.11, gm); }
      K.add(G.cone(s * 0.15, s * 0.16, 8), m, 0, s * 0.69, 0, gm).add(G.tor(s * 0.04, s * 0.01, 3, 8), m, 0, s * 0.8, 0, gm);
  }
}

/**
 * a banner on a staff, foot at the origin, flying toward -x (astern), w long and h deep, device on both faces;
 * side: the side colour for a streamer at the staff head. Returns the height of the staff head.
 */
export function banner(K, st, w, h, side, kind = st.banner) {
  const staffH = h * 1.9 + w * 0.2, pole = C.dark;
  K.add(G.cyl(w * 0.025, w * 0.035, staffH, 6), pole, 0, staffH / 2, 0);
  const top = staffH;
  if (kind === 'totem') {
    // a pole of skulls and horns instead of cloth
    for (let i = 0; i < 3; i++) { K.add(G.sph(w * 0.12, 8, 6), C.bone, 0, top - h * 0.3 - i * h * 0.45, 0); for (const z of [-1, 1]) K.add(G.sph(w * 0.03, 4, 3), C.black, w * 0.1, top - h * 0.28 - i * h * 0.45, z * w * 0.05); }
    for (const z of [-1, 1]) K.add(taper(`totemhorn${z}`, [[0, 0, 0], [0, 0.2, z * 0.25], [0.1, 0.4, z * 0.32]], [0.06, 0.008], 8, 5), C.bone, 0, top - h * 0.2, 0, { s: w * 0.8 });
    K.add(G.shape('totemrag', [[0, 0], [-1, -0.1], [-0.8, -0.5], [-1, -0.9], [0, -1]]), st.cloth, -w * 0.02, top - h * 0.4, 0, { sx: w * 0.5, sy: h * 0.7 });
    return top;
  }
  if (kind === 'horsetail') {
    K.add(G.tor(w * 0.14, w * 0.025, 4, 10), st.metal, 0, top - w * 0.05, 0, { rx: PI / 2, m: st.metalM });
    for (let i = 0; i < 9; i++) { const a = (i / 9) * PI * 2; K.add(G.cone(w * 0.05, h * 1.1, 4), i % 3 ? 0x2a2018 : 0xe8e0d0, Math.cos(a) * w * 0.1, top - h * 0.6, Math.sin(a) * w * 0.1, { rx: PI + Math.sin(a) * 0.12, rz: Math.cos(a) * 0.12, r: 0.95 }); }
    K.add(G.cone(w * 0.05, w * 0.4, 6), st.metal, 0, top + w * 0.2, 0, { m: st.metalM, r: 0.35 });
    return top + w * 0.4;
  }
  // cloth hung from a crossbar (gonfalon, nobori) or flown from the staff (others)
  const hang = kind === 'gonfalon' || kind === 'nobori';
  const W = hang ? h * 0.75 : w, Hh = hang ? w * 1.05 : h;
  const shapeFn = (u, v) => {
    let x = -u * W, y;
    if (hang) { x = -u * W; y = -v * Hh; if (kind === 'gonfalon' && v > 0.8) { const k = (v - 0.8) / 0.2, tooth = Math.abs(((u * 3) % 1) - 0.5) * 2; y = -Hh * (0.8 + 0.2 * k * (1 - tooth * 0.9)); } }
    else if (kind === 'pennon') y = (v - 0.5) * Hh * (1 - u * 0.92);
    else if (kind === 'swallow') { y = (v - 0.5) * Hh; if (u > 0.72) { const notch = (u - 0.72) / 0.28; y = (v - 0.5) * Hh * (1 + 0.0 * notch); x = -lerp(0.72, 1, notch) * W + (1 - Math.abs(v - 0.5) * 2) * notch * W * 0.22; } }
    else y = (v - 0.5) * Hh;
    return [x, y];
  };
  const key = `ban${kind}${W.toFixed(2)},${Hh.toFixed(2)}`;
  const geo = clothPanel(key, (u, v) => { const [x, y] = shapeFn(u, v); return [x, y, 1]; }, 0, 10, 6);
  const yb = hang ? top - w * 0.06 : top - Hh * 0.55;
  K.add(geo, st.cloth, -w * 0.03, yb, 0, { r: 0.85, ry: 0.12 });
  // the hem in the second colour
  K.detail(2, () => {
    if (hang) { K.add(G.box(W * 1.04, w * 0.03, w * 0.03), st.metal, -W / 2 - w * 0.03, yb + w * 0.01, 0, { m: st.metalM }); K.add(G.box(W * 0.98, Hh * 0.06, 0.012), st.cloth2, -W / 2 - w * 0.03, yb - Hh * 0.06, -W * 0.06, { ry: 0.12 }); }
    // the device on both faces (the panel is turned 0.12 about y)
    const dx = -w * 0.03 - W * 0.48, dy = hang ? yb - Hh * 0.42 : yb, sz = Math.min(W, Hh) * 0.62;
    K.push(dx, dy, Math.sin(0.12) * W * 0.48, 0, 0.12, 0); emblem(K, st, sz, { col: [st.cloth2, st.metal === st.cloth ? st.cloth2 : st.metal], depth: 0.02, back: true }); K.pop();
  });
  // the staff head and a streamer in her side's colour
  K.add(G.sph(w * 0.05, 6, 4), st.metal, 0, top + w * 0.03, 0, { m: st.metalM, r: 0.35 });
  if (hang) K.add(G.cyl(w * 0.02, w * 0.02, W * 1.1, 5), C.dark, -W / 2, top - w * 0.05, 0, { rz: PI / 2 });
  if (side !== undefined) K.add(G.shape('streamer', [[0, -0.06], [-1, 0], [0, 0.06]]), side, 0, top - w * 0.02, 0, { sx: w * 0.55, sy: w * 0.4 });
  return top + w * 0.06;
}

/**
 * the device laid on a surface in the kit's current frame: centred at o.at ([x, y], default origin) in the xy plane;
 * o.cloth(x, y) gives the surface's z there (a bellied sail), else it is a flat relief of thickness o.depth (of size).
 * On cloth it is drawn on both faces. o: { name, col: [field, second], faded, key (cache key for the conformed copy) }
 */
export function emblemOn(K, st, size, o = {}) {
  const name = o.name || st.emblem, at = o.at || [0, 0];
  let cols = o.col || [st.cloth2 === st.cloth ? st.metal : st.cloth2, st.metal];
  if (o.faded) cols = cols.map((c) => blend(c, 0x6a6050, 0.45));
  if (!o.cloth) { K.push(at[0], at[1], 0); emblem(K, st, size, { name, col: cols, depth: o.depth ?? 0.06 }); K.pop(); return; }
  const flat = devGeos(name, 0);
  flat.forEach((ly, i) => {
    for (const face of [1, -1]) {
      const geo = G.custom(`emb${o.key}|${name}|${size.toFixed(3)}|${i}|${face}`, () => {
        const g = ly.geo.clone(), P = g.attributes.position;
        for (let k = 0; k < P.count; k++) {
          const x = at[0] + P.getX(k) * size * face, y = at[1] + P.getY(k) * size;
          P.setXYZ(k, x, y, o.cloth(x, y) + face * size * (0.012 + i * 0.006));
        }
        g.computeVertexNormals(); return g;
      });
      const col = cols[ly.tone] ?? cols[1], metal = col === st.metal;
      K.add(geo, col, 0, 0, 0, { m: metal ? st.metalM * 0.6 : 0, r: metal ? 0.45 : 0.85 });
    }
  });
}

/** pick a colour that reads against the hull */
export function contrast(st, base) { return Math.abs(lum(st.metal) - lum(base)) > 0.15 ? st.metal : blend(st.metal, 0xffffff, 0.4); }
export { clamp };
