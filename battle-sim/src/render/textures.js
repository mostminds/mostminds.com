// Procedural textures painted on canvases at load: no image files needed.
// Drawn in light greys so a material's colour tints them.
import * as THREE from 'three';

const cache = new Map();
function rand(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function paint(kind, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), r = rand(kind.length * 7919 + 13);
  const grey = (v, a = 1) => `rgba(${v},${v},${v},${a})`;
  const speckle = (n, lo, hi, a) => { for (let i = 0; i < n; i++) { x.fillStyle = grey(lo + r() * (hi - lo), a); x.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2); } };
  x.fillStyle = grey(205); x.fillRect(0, 0, size, size);
  if (kind === 'stone') {
    const rows = 8, h = size / rows;
    for (let j = 0; j < rows; j++) {
      const off = (j % 2) * (size / 8);
      for (let i = -1; i < 4; i++) {
        const w = size / 4, v = 175 + r() * 60;
        x.fillStyle = grey(v); x.fillRect(off + i * w + 2, j * h + 2, w - 4, h - 4);
        x.fillStyle = grey(v + 18, 0.5); x.fillRect(off + i * w + 2, j * h + 2, w - 4, 3);
        x.fillStyle = grey(v - 40, 0.45); x.fillRect(off + i * w + 2, j * h + h - 5, w - 4, 3);
      }
    }
    x.fillStyle = grey(110);
    for (let j = 0; j <= rows; j++) x.fillRect(0, j * h - 1, size, 2.5);
    speckle(900, 120, 240, 0.35);
  } else if (kind === 'wood') {
    const planks = 6, w = size / planks;
    for (let i = 0; i < planks; i++) {
      const v = 170 + r() * 55;
      x.fillStyle = grey(v); x.fillRect(i * w + 1, 0, w - 2, size);
      for (let k = 0; k < 14; k++) { x.fillStyle = grey(v - 30 - r() * 30, 0.35); x.fillRect(i * w + 2 + r() * (w - 5), 0, 1, size); }
      x.fillStyle = grey(90, 0.8); x.fillRect(i * w, 0, 1.5, size);
      if (r() < 0.6) { x.fillStyle = grey(110, 0.6); x.beginPath(); x.ellipse(i * w + w / 2, r() * size, 4, 7, 0, 0, 7); x.fill(); }
    }
  } else if (kind === 'tiles') {
    const rows = 8, h = size / rows;
    for (let j = 0; j < rows; j++) for (let i = -1; i < 9; i++) {
      const w = size / 8, v = 165 + r() * 70, ox = (j % 2) * w / 2;
      x.fillStyle = grey(v); x.beginPath(); x.roundRect(ox + i * w + 1, j * h, w - 2, h + 5, [0, 0, 9, 9]); x.fill();
      x.fillStyle = grey(80, 0.5); x.fillRect(ox + i * w + 1, j * h + h + 2, w - 2, 2);
    }
  } else if (kind === 'thatch') {
    for (let i = 0; i < 2600; i++) { const v = 150 + r() * 90; x.strokeStyle = grey(v, 0.7); x.lineWidth = 1 + r(); const px = r() * size, py = r() * size; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 6, py + 10 + r() * 14); x.stroke(); }
  } else if (kind === 'plaster') {
    speckle(2500, 170, 245, 0.35);
    x.fillStyle = grey(95); for (const px of [0, size / 2 - 3]) x.fillRect(px, 0, 6, size);
    x.fillRect(0, 0, size, 6); x.fillRect(0, size / 2, size, 5);
  } else if (kind === 'canvas') {
    for (let i = 0; i < size; i += 3) { x.fillStyle = grey(190 + r() * 40, 0.5); x.fillRect(0, i, size, 1); x.fillRect(i, 0, 1, size); }
  } else if (kind === 'bark') {
    for (let i = 0; i < 500; i++) { x.fillStyle = grey(120 + r() * 110, 0.6); x.fillRect(r() * size, r() * size, 2 + r() * 3, 14 + r() * 30); }
  } else speckle(1500, 160, 245, 0.4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function texture(kind) {
  if (!cache.has(kind)) cache.set(kind, paint(kind));
  return cache.get(kind);
}

const mats = new Map();
// textured, tinted material for buildings and props
export function tmat(kind, color, o = {}) {
  const k = `${kind}:${color}:${JSON.stringify(o)}`;
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ map: texture(kind), color, roughness: 0.9, metalness: 0, ...o }));
  return mats.get(k);
}

// soft vertical gradient for the sky dome
export function skyTexture(color) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  const base = new THREE.Color(color), top = base.clone().lerp(new THREE.Color(0x3a6ea8), 0.55), low = base.clone().lerp(new THREE.Color(0xffffff), 0.35);
  g.addColorStop(0, `#${top.getHexString()}`); g.addColorStop(0.55, `#${base.getHexString()}`); g.addColorStop(1, `#${low.getHexString()}`);
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
