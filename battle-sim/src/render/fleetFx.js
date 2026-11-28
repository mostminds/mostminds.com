// Fleet effects: everything that happens between hulls, at sea and in the air. Muzzle flashes, smoke, shot
// trails and impacts, splinters, grapnel lines and chains, boarders leaping and swinging across, struck colours,
// the ship arts (wards, fog, ice, plague, notes, runes...) and the lasting states read from the engine each frame.
//
// Everything is drawn from a few fixed pools made once (four point systems and a dozen instanced meshes), so a
// forty-ship battle costs the same draw calls as a duel; when a pool is full the oldest piece is reused.
//
//   const fx = new FleetFx(stage, { floor: (x, z) => 0, sea: true })
//   fx.update(dt)                     once a frame, after the view has posed its models
//   fx.act(model, 'fire', 0.6)        runs model.userData.actions.fire(k, model) for k 0..1; false if she has none
//   fx.seaStates(b, models, tick, t)  the lasting states of every hull in a sea battle (call before fx.update)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hovers } from '../engine/fleetarts.js';

const R = Math.random, rnd = (a = 1) => (R() - 0.5) * 2 * a, lerp = (a, c, k) => a + (c - a) * k;
const UP = new THREE.Vector3(0, 1, 0), XA = new THREE.Vector3(1, 0, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _col = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const hexR = (h) => ((h >> 16) & 255) / 255, hexG = (h) => ((h >> 8) & 255) / 255, hexB = (h) => (h & 255) / 255;

/** a point given in a model's own space, in the world (no matrix update needed) */
export function toWorld(m, x, y, z, out) { return out.set(x * m.scale.x, y * m.scale.y, z * m.scale.z).applyQuaternion(m.quaternion).add(m.position); }

// ---------------------------------------------------------------- glyphs
// a 4 x 3 atlas of little white signs drawn once: notes, sparkles, runes, snowflakes, skulls, thorns, gusts...
export const G = { note: 0, notes: 1, star: 2, rune: 3, snow: 4, skull: 5, thorn: 6, gust: 7, swords: 8, sun: 9, drop: 10, chevron: 11 };
let atlasTex = null;
function glyphAtlas() {
  if (atlasTex) return atlasTex;
  const S = 128, c = document.createElement('canvas'); c.width = S * 4; c.height = S * 3;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round';
  const cell = (i, f) => { x.save(); x.translate((i % 4) * S, Math.floor(i / 4) * S); x.beginPath(); f(); x.restore(); };
  const P2 = Math.PI * 2;
  cell(0, () => { x.ellipse(46, 94, 21, 15, -0.45, 0, P2); x.fill(); x.lineWidth = 9; x.beginPath(); x.moveTo(64, 90); x.lineTo(64, 20); x.quadraticCurveTo(92, 32, 98, 62); x.stroke(); });
  cell(1, () => { x.ellipse(34, 98, 18, 13, -0.45, 0, P2); x.fill(); x.beginPath(); x.ellipse(92, 86, 18, 13, -0.45, 0, P2); x.fill(); x.lineWidth = 8; x.beginPath(); x.moveTo(50, 94); x.lineTo(50, 30); x.moveTo(108, 82); x.lineTo(108, 18); x.stroke(); x.lineWidth = 14; x.beginPath(); x.moveTo(50, 32); x.lineTo(108, 20); x.stroke(); });
  cell(2, () => { for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, r = k % 2 ? 11 : 58; x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } x.closePath(); x.fill(); });
  cell(3, () => { x.lineWidth = 10; x.moveTo(46, 20); x.lineTo(46, 108); x.moveTo(46, 32); x.lineTo(84, 56); x.lineTo(46, 80); x.moveTo(84, 56); x.lineTo(84, 108); x.stroke(); x.lineWidth = 5; x.beginPath(); x.arc(64, 64, 58, 0, P2); x.stroke(); });
  cell(4, () => { x.lineWidth = 8; x.translate(64, 64); for (let k = 0; k < 6; k++) { x.rotate(Math.PI / 3); x.moveTo(0, 0); x.lineTo(0, -54); x.moveTo(0, -30); x.lineTo(-15, -45); x.moveTo(0, -30); x.lineTo(15, -45); } x.stroke(); });
  cell(5, () => {
    x.arc(64, 54, 40, Math.PI * 0.85, Math.PI * 2.15); x.lineTo(90, 96); x.lineTo(38, 96); x.closePath(); x.fill(); x.fillRect(44, 90, 40, 22);
    x.globalCompositeOperation = 'destination-out';
    x.beginPath(); x.ellipse(48, 60, 11, 13, 0, 0, P2); x.fill(); x.beginPath(); x.ellipse(80, 60, 11, 13, 0, 0, P2); x.fill();
    x.beginPath(); x.moveTo(64, 72); x.lineTo(57, 85); x.lineTo(71, 85); x.fill(); for (const px of [52, 62, 72]) x.fillRect(px, 100, 5, 14);
  });
  cell(6, () => { x.lineWidth = 9; x.moveTo(14, 110); x.bezierCurveTo(40, 60, 80, 90, 112, 18); x.stroke(); for (const [px, py, a] of [[34, 84, -1], [58, 74, 1], [78, 62, -1], [96, 40, 1]]) { x.beginPath(); x.moveTo(px - 6, py - 6); x.lineTo(px + a * 26, py - 14); x.lineTo(px + 6, py + 6); x.fill(); } });
  cell(7, () => { x.lineWidth = 9; x.arc(64, 64, 40, 0.4, 4.2); x.stroke(); x.beginPath(); x.arc(64, 64, 20, 0.4, 3.6); x.stroke(); x.beginPath(); x.moveTo(98, 80); x.lineTo(124, 84); x.stroke(); });
  cell(8, () => { x.lineWidth = 9; x.moveTo(22, 22); x.lineTo(104, 104); x.moveTo(106, 22); x.lineTo(24, 104); x.stroke(); x.lineWidth = 12; x.beginPath(); x.moveTo(78, 96); x.lineTo(96, 78); x.moveTo(32, 78); x.lineTo(50, 96); x.stroke(); });
  cell(9, () => { x.arc(64, 64, 26, 0, P2); x.fill(); x.lineWidth = 8; for (let k = 0; k < 10; k++) { const a = (k / 10) * P2; x.moveTo(64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36); x.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); } x.stroke(); });
  cell(10, () => { x.moveTo(64, 12); x.bezierCurveTo(90, 56, 100, 74, 100, 84); x.arc(64, 84, 36, 0, Math.PI); x.bezierCurveTo(28, 74, 38, 56, 64, 12); x.fill(); });
  cell(11, () => { x.lineWidth = 14; x.moveTo(24, 70); x.lineTo(64, 34); x.lineTo(104, 70); x.moveTo(24, 106); x.lineTo(64, 70); x.lineTo(104, 106); x.stroke(); });
  atlasTex = new THREE.CanvasTexture(c);
  return atlasTex;
}

// ---------------------------------------------------------------- point systems
const PVS = `attribute float psize; attribute float palpha; attribute vec3 pcol; attribute float pcell;
uniform float uScale; varying vec3 vC; varying float vA; varying float vCell;
void main() { vC = pcol; vA = palpha; vCell = pcell; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = palpha > 0.003 ? clamp(psize * uScale / max(0.3, -mv.z), 1.0, 256.0) : 0.0; }`;
const PFS = {
  add: `varying vec3 vC; varying float vA; void main() { vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0; if (d > 1.0 || vA < 0.003) discard; float a = pow(1.0 - d, 1.6); gl_FragColor = vec4(vC * (1.0 + 0.6 * a), a * vA); }`,
  smoke: `varying vec3 vC; varying float vA; varying float vCell; void main() { vec2 p = gl_PointCoord - 0.5; float ang = atan(p.y, p.x);
    float r = length(p) * 2.0 * (1.0 + 0.13 * sin(ang * 5.0 + vCell * 6.283) + 0.07 * sin(ang * 9.0 - vCell * 15.0)); if (r > 1.0 || vA < 0.003) discard;
    float a = smoothstep(1.0, 0.25, r); vec3 c = vC * (1.08 - 0.32 * (p.y + 0.5)); gl_FragColor = vec4(c, a * vA); }`,
  glyph: `uniform sampler2D uAtlas; varying vec3 vC; varying float vA; varying float vCell; void main() { if (vA < 0.003) discard;
    float cx = mod(vCell, 4.0), cy = floor(vCell / 4.0); vec2 uv = vec2((cx + gl_PointCoord.x) / 4.0, (3.0 - cy - gl_PointCoord.y) / 3.0);
    vec4 t = texture2D(uAtlas, uv); if (t.a < 0.05) discard; gl_FragColor = vec4(vC, t.a * vA); }`,
};
class Points {
  constructor(n, kind) {
    this.n = n; this.cur = 0; this.live = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.cell = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.s0 = new Float32Array(n); this.grow = new Float32Array(n); this.age = new Float32Array(n); this.life = new Float32Array(n); this.a0 = new Float32Array(n);
    this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.fi = new Uint8Array(n); this.wind = kind === 'smoke' ? 1 : 0;
    const at = (a, k) => { const b = new THREE.BufferAttribute(a, k); b.setUsage(THREE.DynamicDrawUsage); return b; };
    g.setAttribute('position', at(this.pos, 3)); g.setAttribute('pcol', at(this.col, 3)); g.setAttribute('psize', at(this.size, 1)); g.setAttribute('palpha', at(this.alpha, 1)); g.setAttribute('pcell', at(this.cell, 1));
    const additive = kind === 'add' || kind === 'glyphA';
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVS, fragmentShader: PFS[kind === 'glyphA' ? 'glyph' : kind],
      uniforms: { uScale: { value: 400 }, uAtlas: { value: kind.startsWith('glyph') ? glyphAtlas() : null } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.obj = new THREE.Points(g, this.mat);
    this.obj.frustumCulled = false; this.obj.renderOrder = additive ? 6 : 5;
    this.geo = g;
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, c0, c1, a0, drag, grav, cell, fi) {
    const i = this.cur; this.cur = (this.cur + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.c0[i3] = hexR(c0); this.c0[i3 + 1] = hexG(c0); this.c0[i3 + 2] = hexB(c0);
    this.c1[i3] = hexR(c1); this.c1[i3 + 1] = hexG(c1); this.c1[i3 + 2] = hexB(c1);
    this.s0[i] = size; this.grow[i] = grow; this.age[i] = 0; this.life[i] = life; this.a0[i] = a0; this.drag[i] = drag; this.grav[i] = grav; this.cell[i] = cell; this.fi[i] = fi;
    this.size[i] = size; this.alpha[i] = fi ? 0 : a0;
    this.col[i3] = this.c0[i3]; this.col[i3 + 1] = this.c0[i3 + 1]; this.col[i3 + 2] = this.c0[i3 + 2];
    this.live = this.n;
  }
  update(dt, wx, wz) {
    if (!this.live) return;
    let any = 0;
    const { pos, vel, col, c0, c1 } = this;
    for (let i = 0; i < this.n; i++) {
      const L = this.life[i];
      if (L <= 0) continue;
      const age = (this.age[i] += dt);
      if (age >= L) { this.life[i] = 0; this.alpha[i] = 0; this.size[i] = 0; continue; }
      any = 1;
      const i3 = i * 3, k = age / L, dr = Math.max(0, 1 - this.drag[i] * dt);
      vel[i3] *= dr; vel[i3 + 1] = vel[i3 + 1] * dr - this.grav[i] * dt; vel[i3 + 2] *= dr;
      pos[i3] += (vel[i3] + wx * this.wind) * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += (vel[i3 + 2] + wz * this.wind) * dt;
      col[i3] = c0[i3] + (c1[i3] - c0[i3]) * k; col[i3 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * k; col[i3 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * k;
      this.size[i] = this.s0[i] * Math.max(0.05, 1 + this.grow[i] * k);
      this.alpha[i] = this.a0[i] * (this.fi[i] ? Math.min(1, k * 7) : 1) * (1 - k);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.pcol.needsUpdate = a.psize.needsUpdate = a.palpha.needsUpdate = a.pcell.needsUpdate = true;
    if (!any) this.live = 0;
  }
  clear() { this.life.fill(0); this.alpha.fill(0); this.size.fill(0); this.live = 1; }
}

// particle looks: system, life, size, growth over life, colours from/to, opacity, drag, gravity (negative rises), random speed, jitter
const L = (s, life, size, grow, c0, c1, a, drag, grav, vr, jit = 0, fi = 1) => ({ s, life, size, grow, c0, c1, a, drag, grav, vr, jit, fi });
export const P = {
  FLASH: L('add', [0.07, 0.13], [0.8, 1.2], 0.7, 0xfff6d0, 0xff9a30, 1, 0, 0, 0, 0, 0),
  FIRE: L('add', [0.4, 0.85], [0.3, 0.55], -0.45, 0xffd27a, 0xb02808, 0.85, 1.4, -2.4, 0.45, 0.15),
  FIREBALL: L('add', [0.5, 1.0], [0.8, 1.4], 0.6, 0xfff0b0, 0xc83a0a, 0.9, 2.2, -1.2, 2.2, 0.4, 0),
  EMBER: L('add', [0.8, 1.7], [0.05, 0.09], 0, 0xffc060, 0xff3a10, 1, 0.5, -0.9, 0.9, 0.3),
  SPARK: L('add', [0.18, 0.42], [0.05, 0.08], -0.5, 0xfffbe0, 0xffa040, 1, 1.4, 7, 3.2, 0, 0),
  GLINT: L('add', [0.07, 0.14], [0.22, 0.36], 0.6, 0xffffff, 0xbfe0ff, 1, 0, 0, 0, 0, 0),
  MOTE: L('add', [0.8, 1.6], [0.08, 0.15], 0.2, 0xffffff, 0xffffff, 0.9, 0.8, -0.6, 0.4, 0.2),
  GLOW: L('add', [0.25, 0.45], [0.6, 1.0], 0.5, 0xffffff, 0xffffff, 0.7, 0, 0, 0, 0, 0),
  TRACE: L('add', [0.12, 0.2], [0.08, 0.12], -0.6, 0xfff0a0, 0xff8030, 1, 0, 0, 0, 0, 0),
  SMOKE: L('smoke', [1.6, 2.6], [0.45, 0.8], 2.2, 0x7a746c, 0xb8b2a8, 0.5, 0.9, -0.6, 0.35, 0.2),
  BLACK: L('smoke', [2, 3.2], [0.5, 0.9], 2.4, 0x1e1a18, 0x5a544e, 0.6, 0.6, -1.1, 0.3, 0.2),
  GUN: L('smoke', [1.6, 2.8], [0.28, 0.48], 3, 0xf4f2ec, 0xd0cec8, 0.6, 2.4, -0.25, 0.25, 0.1),
  SPRAY: L('smoke', [0.6, 1.1], [0.13, 0.26], 0.9, 0xffffff, 0xd8ecf4, 0.9, 0.4, 9, 0.6, 0.1, 0),
  MIST: L('smoke', [1, 1.8], [0.45, 0.75], 1.8, 0xf4f8fa, 0xe0ecf0, 0.45, 1.5, -0.2, 0.4, 0.2),
  DUST: L('smoke', [1.4, 2.4], [0.45, 0.8], 2, 0xa89878, 0xc8bca0, 0.55, 1.4, -0.15, 0.6, 0.3),
  POISON: L('smoke', [1.8, 3], [0.45, 0.8], 1.6, 0x6a8a24, 0xa8b850, 0.42, 1, -0.3, 0.3, 0.3),
  FOG: L('smoke', [3, 4.5], [1.4, 2.2], 0.8, 0xdfe6ea, 0xeef2f4, 0.3, 1, -0.05, 0.2, 0),
  HAZE: L('smoke', [2, 3], [0.8, 1.2], 1, 0xd8b8e8, 0xf0e0f8, 0.2, 1, -0.15, 0.2, 0.3),
  FLY: L('smoke', [0.4, 0.8], [0.035, 0.05], 0, 0x101010, 0x101010, 0.9, 0, 0, 1.6, 0.4, 0),
  CHIP: L('smoke', [0.5, 0.9], [0.06, 0.1], 0, 0x5a4028, 0x5a4028, 1, 0.3, 9, 2.5, 0.1, 0),
  GLYPH: L('glyph', [1.2, 2], [0.32, 0.46], 0.2, 0xffffff, 0xffffff, 0.9, 0.6, -0.5, 0.25, 0.2),
  RUNE: L('glyphA', [0.9, 1.5], [0.3, 0.42], 0.1, 0xffffff, 0xffffff, 1, 0.6, -0.3, 0.15, 0.1),
};

// ---------------------------------------------------------------- instanced pools
class Pool {
  constructor(scene, geo, material, n) {
    this.n = n; this.mesh = new THREE.InstancedMesh(geo, material, n);
    this.mesh.frustumCulled = false; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.used = new Uint8Array(n); this.stamp = new Float64Array(n); this.free = [];
    for (let i = n - 1; i >= 0; i--) { this.free.push(i); this.mesh.setMatrixAt(i, ZERO); this.mesh.setColorAt(i, _col.set(0xffffff)); }
    this.clock = 0; this.dirty = this.cdirty = true; this.owner = new Array(n).fill(null);
    scene.add(this.mesh);
  }
  /** a free instance, or the oldest one taken back from whoever had it (its owner's steal() is told) */
  alloc(owner = null) {
    let i;
    if (this.free.length) i = this.free.pop();
    else { let o = 0; for (let k = 1; k < this.n; k++) if (this.stamp[k] < this.stamp[o]) o = k; i = o; const ow = this.owner[i]; if (ow && ow.steal) ow.steal(this, i); }
    this.used[i] = 1; this.stamp[i] = ++this.clock; this.owner[i] = owner;
    return i;
  }
  release(i) { if (i < 0 || !this.used[i]) return; this.used[i] = 0; this.owner[i] = null; this.mesh.setMatrixAt(i, ZERO); this.free.push(i); this.dirty = true; }
  put(i, pos, quat, sx, sy = sx, sz = sx) { if (i < 0) return; _m.compose(pos, quat, _s.set(sx, sy, sz)); this.mesh.setMatrixAt(i, _m); this.dirty = true; }
  hide(i) { if (i >= 0) { this.mesh.setMatrixAt(i, ZERO); this.dirty = true; } }
  tint(i, hex, k = 1) { if (i < 0) return; _col.set(hex); if (k !== 1) _col.multiplyScalar(k); this.mesh.setColorAt(i, _col); this.cdirty = true; }
  flush() { if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; } if (this.cdirty && this.mesh.instanceColor) { this.mesh.instanceColor.needsUpdate = true; this.cdirty = false; } }
  clear() { this.free.length = 0; for (let i = this.n - 1; i >= 0; i--) { this.used[i] = 0; this.owner[i] = null; this.free.push(i); this.mesh.setMatrixAt(i, ZERO); } this.dirty = true; }
}

// a fresnel shell for wards, lures and glows; flat radial glow for hover light; an oily slick
const BUBBLE_VS = `varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vCol;
void main() { vCol = instanceColor; vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`;
const BUBBLE_FS = `uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vCol;
void main() { float f = 1.0 - abs(dot(normalize(vN), vV)); float rim = pow(f, 2.2);
  float hex = abs(sin(vW.x * 5.0 + uTime * 0.7) * sin(vW.y * 5.0 - uTime) * sin(vW.z * 5.0 + uTime * 0.4));
  float band = smoothstep(0.92, 1.0, sin(vW.y * 3.0 - uTime * 2.5) * 0.5 + 0.5);
  float a = rim * 0.85 + hex * 0.1 + band * 0.18; gl_FragColor = vec4(vCol * a, 1.0); }`;
const DISC_VS = `varying vec2 vU; varying vec3 vCol; void main() { vU = uv; vCol = instanceColor; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`;
const DISC_FS = `uniform float uTime; varying vec2 vU; varying vec3 vCol; void main() { vec2 p = vU - 0.5; float d = length(p) * 2.0; if (d > 1.0) discard;
  float a = pow(1.0 - d, 1.8) * (0.75 + 0.25 * sin(uTime * 3.0 + d * 9.0)); gl_FragColor = vec4(vCol * a, 1.0); }`;
const SLICK_FS = `uniform float uTime; varying vec2 vU; varying vec3 vCol; void main() { vec2 p = vU - 0.5; float ang = atan(p.y, p.x); float d = length(p) * 2.0 * (1.0 + 0.12 * sin(ang * 4.0 + uTime * 0.3) + 0.06 * sin(ang * 11.0));
  if (d > 1.0) discard; float sheen = 0.5 + 0.5 * sin(d * 18.0 - uTime * 1.2 + ang * 2.0);
  vec3 c = mix(vCol, vec3(0.35, 0.2 + 0.25 * sheen, 0.45 * sheen), 0.35 * sheen * (1.0 - d)); gl_FragColor = vec4(c, smoothstep(1.0, 0.7, d) * 0.85); }`;

function figureGeos() {
  const put = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g.index ? g.toNonIndexed() : g; };
  const body = [
    put(new THREE.BoxGeometry(0.07, 0.21, 0.08), 0.045, 0.105, 0), put(new THREE.BoxGeometry(0.07, 0.21, 0.08), -0.045, 0.105, 0),
    put(new THREE.CylinderGeometry(0.085, 0.11, 0.28, 7), 0, 0.34, 0),
    put(new THREE.CylinderGeometry(0.03, 0.026, 0.25, 5), 0.125, 0.4, 0.07, -1.1, 0, -0.15),
    put(new THREE.CylinderGeometry(0.03, 0.026, 0.24, 5), -0.13, 0.36, 0.02, -0.3, 0, 0.2),
    put(new THREE.CylinderGeometry(0.095, 0.095, 0.025, 10), -0.16, 0.36, 0.08, 0, 0, Math.PI / 2),
  ];
  const tinted = (g, hex) => { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = hexR(hex); c[i * 3 + 1] = hexG(hex); c[i * 3 + 2] = hexB(hex); } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
  const bits = [
    tinted(put(new THREE.SphereGeometry(0.072, 8, 6), 0, 0.565, 0), 0xd8b08a),
    tinted(put(new THREE.SphereGeometry(0.078, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.575, 0), 0x6a645c),
    tinted(put(new THREE.BoxGeometry(0.022, 0.34, 0.04), 0.13, 0.6, 0.24, 0.5, 0, 0), 0xe6ecf2),
    tinted(put(new THREE.BoxGeometry(0.1, 0.02, 0.03), 0.13, 0.46, 0.17, 0.5, 0, 0), 0x8a6a3a),
  ];
  for (const g of [...body, ...bits]) g.deleteAttribute('uv');
  return [mergeGeometries(body, false), mergeGeometries(bits, false)];
}

// ---------------------------------------------------------------- the effects
export class FleetFx {
  constructor(stage, { floor, sea = true, water } = {}) {
    this.stage = stage; this.scene = stage.scene; this.floor = floor || (() => 0); this.sea = sea; this.water = water || (() => sea);
    this.time = 0; this.wind = { x: 0, z: 0 };
    const sc = this.scene;
    this.ps = { add: new Points(2600, 'add'), smoke: new Points(2600, 'smoke'), glyph: new Points(500, 'glyph'), glyphA: new Points(500, 'glyphA') };
    for (const k in this.ps) sc.add(this.ps[k].obj);
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, ...o });
    const add = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.debris = new Pool(sc, box, std({ roughness: 0.9 }), 360);
    this.balls = new Pool(sc, new THREE.SphereGeometry(1, 10, 8), std({ roughness: 0.45, metalness: 0.6 }), 180);
    const strandGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
    this.strands = new Pool(sc, strandGeo, std({ roughness: 0.95, side: THREE.DoubleSide }), 1000);
    this.links = new Pool(sc, new THREE.TorusGeometry(0.5, 0.15, 5, 10).scale(1.6, 1, 1), std({ roughness: 0.4, metalness: 0.75 }), 720);
    this.planks = new Pool(sc, box, std({ roughness: 0.9 }), 40);
    this.glows = new Pool(sc, new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0), add(), 260);
    this.rings = new Pool(sc, new THREE.RingGeometry(0.84, 1, 48), Object.assign(add(), { side: THREE.DoubleSide }), 90);
    this.uTime = { value: 0 };
    const sh = (vs, fs, blend) => new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { uTime: this.uTime }, transparent: true, depthWrite: false, blending: blend, side: THREE.DoubleSide });
    this.bubbles = new Pool(sc, new THREE.SphereGeometry(1, 28, 18), sh(BUBBLE_VS, BUBBLE_FS, THREE.AdditiveBlending), 50);
    const disc = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.discs = new Pool(sc, disc, sh(DISC_VS, DISC_FS, THREE.AdditiveBlending), 50);
    this.slicks = new Pool(sc, disc, sh(DISC_VS, SLICK_FS, THREE.NormalBlending), 24);
    const ice = new THREE.CircleGeometry(1, 18); const ip = ice.attributes.position;
    for (let i = 1; i < ip.count; i++) { const f = 0.8 + ((i * 37) % 11) / 30; ip.setX(i, ip.getX(i) * f); ip.setY(i, ip.getY(i) * f); }
    ice.rotateX(-Math.PI / 2);
    this.ices = new Pool(sc, ice, std({ color: 0xffffff, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true }), 24);
    const [fb, fh] = figureGeos();
    this.figBody = new Pool(sc, fb, std({ roughness: 0.8, flatShading: true }), 150);
    this.figHead = new Pool(sc, fh, std({ roughness: 0.55, metalness: 0.25, vertexColors: true, flatShading: true }), 150);
    this.pools = [this.debris, this.balls, this.strands, this.links, this.planks, this.glows, this.rings, this.bubbles, this.discs, this.slicks, this.ices, this.figBody, this.figHead];
    this.flagGeo = new THREE.PlaneGeometry(0.8, 0.5, 8, 2).translate(0.4, 0, 0);
    this.staffGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.8, 5).translate(0, 0.4, 0);
    this.reset();
  }

  reset() {
    for (const k in this.ps) this.ps[k].clear();
    for (const p of this.pools) p.clear();
    this.deb = []; this.flights = []; this.fRings = []; this.fGlows = []; this.figs = []; this.acts = []; this.timers = []; this.emitters = [];
    this.rigs = new Map(); this.links2 = new Map(); this.flags = []; this.ropes = new Map();
    for (const f of this.oldFlags || []) f.parent?.remove(f);
    this.oldFlags = [];
  }
  dispose() {
    for (const k in this.ps) { this.scene.remove(this.ps[k].obj); this.ps[k].geo.dispose(); }
    for (const p of this.pools) { this.scene.remove(p.mesh); p.mesh.dispose(); }
  }

  // ------------------------------------------------ basics
  /** how much continuous emission a place deserves: less far from the camera and on low quality */
  near(p) { const d = this.stage.camera.position.distanceTo(p); return (d < 45 ? 1 : d < 90 ? 0.55 : d < 160 ? 0.25 : 0.1) * (this.stage.quality === 'low' ? 0.5 : 1); }
  /** n particles of look Pp at (x, y, z), thrown along (dx, dy, dz) at speed sp */
  emit(Pp, x, y, z, n = 1, dx = 0, dy = 0, dz = 0, sp = 0, sz = 1, c0 = Pp.c0, c1 = Pp.c1, cell = -1) {
    const S = this.ps[Pp.s], j = Pp.jit * sz, vr = Pp.vr;
    for (let k = 0; k < n; k++) {
      const s = sp * (0.6 + R() * 0.8);
      S.emit(x + rnd(j), y + rnd(j), z + rnd(j), dx * s + rnd(vr), dy * s + rnd(vr), dz * s + rnd(vr),
        lerp(Pp.life[0], Pp.life[1], R()), lerp(Pp.size[0], Pp.size[1], R()) * sz, Pp.grow, c0, c1, Pp.a, Pp.drag, Pp.grav, cell >= 0 ? cell : R(), Pp.fi);
    }
  }
  /** emission at a steady rate (per second): returns how many to make this frame */
  rate(obj, key, perSec, dt) { const v = (obj[key] || 0) + perSec * dt; const n = Math.floor(v); obj[key] = v - n; return n; }
  glyph(cell, p, n, color, sz = 1, dy = 0.6, additive = false) { this.emit(additive ? P.RUNE : P.GLYPH, p.x, p.y, p.z, n, 0, 1, 0, dy, sz, color, color, cell); }
  after(sec, fn) { this.timers.push({ at: this.time + sec, fn }); }
  /** a burst spread over time: fn(k, dt) is called every frame for dur seconds */
  emitter(dur, fn) { if (this.emitters.length > 80) this.emitters.shift(); this.emitters.push({ t: 0, dur, fn }); }

  /** run a model's action hook; false when she has none */
  act(m, name, dur = 0.8) {
    const fn = m?.userData?.actions?.[name];
    if (!fn) return false;
    for (const a of this.acts) if (a.m === m && a.name === name) { a.t = 0; a.dur = dur; return true; }
    if (this.acts.length > 160) { const o = this.acts.shift(); o.fn(1, o.m); }
    this.acts.push({ m, name, fn, t: 0, dur });
    return true;
  }
  /** a jolt that rocks a hull: roll about her keel and pitch about her beam, dying away */
  rock(m, roll = 0.08, pitch = 0, heave = 0) {
    if (!m) return;
    const r = m.userData._rk || (m.userData._rk = { t0: -99, roll: 0, pitch: 0, heave: 0 });
    const left = Math.exp(-(this.time - r.t0) * 2.2);
    r.roll = r.roll * left + roll; r.pitch = r.pitch * left + pitch; r.heave = r.heave * left + heave; r.t0 = this.time;
  }
  /** add the rocking to a model the view has just posed */
  pose(m) {
    const r = m.userData._rk;
    if (!r) return;
    const age = this.time - r.t0;
    if (age > 3) { m.userData._rk = null; return; }
    const d = Math.exp(-age * 2.2), w = Math.sin(age * 7.5);
    m.rotation.x += r.roll * d * w; m.rotation.z += r.pitch * d * Math.sin(age * 6 + 0.6); m.position.y -= r.heave * d * Math.abs(w);
  }

  // ------------------------------------------------ the shape of a hull, in her own space
  dims(m, e) {
    if (m.userData._fx) return m.userData._fx;
    const ud = m.userData, skip = new Set([ud.bar, ud.ring, ud.crew, ud.mark].filter(Boolean));
    const p0 = m.position.clone(), q0 = m.quaternion.clone(), s0 = m.scale.clone();
    m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const c of m.children) if (!skip.has(c) && !c.isSprite && !c.userData.fxFlag) box.expandByObject(c);
    m.position.copy(p0); m.quaternion.copy(q0); m.scale.copy(s0); m.updateMatrixWorld(true);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -0.5), new THREE.Vector3(1, 1.5, 0.5));
    const slots = ud.crewSlots, ys = slots && slots.length ? slots.map((p) => p[1]).sort((a, c) => a - c) : null;
    const len = e?.def?.len, hx = Math.max(0.6, Math.min(box.max.x, -box.min.x, len ? len * 0.5 : 99) * 0.9);
    const hz = Math.max(0.3, Math.min(box.max.z, -box.min.z, e?.def?.beam ? e.def.beam * 0.5 : 99));
    const deckY = ys ? ys[Math.floor(ys.length / 2)] : Math.max(0.3, (e?.def?.beam || 1) * 0.25);
    const an = ud.anchors || {};
    const top = Math.min(ud.top ?? box.max.y, box.max.y + 0.2);
    const D = {
      hx, hz, deckY, top, box,
      bow: an.bow || [hx, deckY, 0], stern: an.stern || [-hx, deckY, 0],
      deckL: an.deckL || [0, deckY, -hz], deckR: an.deckR || [0, deckY, hz],
      mouth: an.mouth || null, talons: an.talons || null,
      slots: slots && slots.length ? slots : null,
    };
    ud._fx = D;
    return D;
  }
  /** a random place on her deck, in her own space */
  deckPoint(D, out) { if (D.slots) { const s = D.slots[Math.floor(R() * D.slots.length)]; return out.set(s[0], s[1], s[2]); } return out.set(rnd(D.hx * 0.8), D.deckY, rnd(D.hz * 0.7)); }
  /** the rail of m facing the point w (world), at fraction u along her (-1 stern .. 1 bow), in her own space */
  railToward(m, D, w, u, out) {
    _p.copy(w).sub(m.position).applyQuaternion(_q2.copy(m.quaternion).invert());
    const side = _p.z >= 0 ? 1 : -1, an = side > 0 ? D.deckR : D.deckL;
    return out.set(an[0] + u * D.hx * 0.7, an[1], an[2] !== 0 ? an[2] : side * D.hz);
  }

  // ------------------------------------------------ one-off recipes
  muzzle(p, dir, s = 1) {
    this.emit(P.FLASH, p.x, p.y, p.z, 1, 0, 0, 0, 0, s);
    this.emit(P.FIRE, p.x + dir.x * 0.2, p.y, p.z + dir.z * 0.2, 3, dir.x, dir.y, dir.z, 3.5 * s, 0.6 * s);
    this.emit(P.GUN, p.x + dir.x * 0.25, p.y, p.z + dir.z * 0.25, 4, dir.x, dir.y + 0.1, dir.z, 2.6 * s, s);
    this.emit(P.SPARK, p.x, p.y, p.z, 3, dir.x, dir.y + 0.2, dir.z, 4 * s, 1);
  }
  splash(p, s = 1) {
    const y = this.floor(p.x, p.z);
    this.emit(P.SPRAY, p.x, y, p.z, Math.round(12 * s), 0, 1, 0, 4.5 * Math.sqrt(s), s);
    this.emit(P.SPRAY, p.x, y, p.z, Math.round(6 * s), 0, 1, 0, 2, s * 1.4);
    this.emit(P.MIST, p.x, y + 0.3 * s, p.z, Math.round(3 * s), 0, 1, 0, 0.6, s);
    this.ring(_a.set(p.x, y + 0.04, p.z), null, 0.2 * s, 1.3 * s, 0xc8dce8, 0.9);
  }
  dust(p, s = 1) {
    const y = this.floor(p.x, p.z);
    this.emit(P.DUST, p.x, y + 0.2, p.z, Math.round(6 * s), 0, 1, 0, 1.2, s);
    this.emit(P.CHIP, p.x, y + 0.1, p.z, Math.round(6 * s), 0, 1, 0, 3, 1, 0x6a5a40, 0x6a5a40);
  }
  /** wood (or col) splinters from p, thrown along dir */
  splinters(p, dir, n = 8, s = 1, col = 0x7a5a38) {
    for (let k = 0; k < n; k++) {
      const i = this.debris.alloc(this.deb);
      const d = this.deb[i] || (this.deb[i] = { p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), sx: 0, sy: 0, sz: 0, t: 0, life: 0, on: false, wet: false });
      const sp = (2.5 + R() * 4) * s;
      d.p.copy(p); d.v.set(dir.x * sp + rnd(2.2 * s), 1.6 + R() * 4 * s + dir.y * sp, dir.z * sp + rnd(2.2 * s));
      d.r.set(R() * 6, R() * 6, R() * 6); d.w.set(rnd(14), rnd(14), rnd(14));
      const big = R() < 0.25 ? 2.2 : 1;
      d.sx = (0.05 + R() * 0.06) * big * s; d.sy = (0.03 + R() * 0.03) * s; d.sz = (0.2 + R() * 0.35) * big * s;
      d.t = 0; d.life = 3 + R() * 3; d.on = true; d.wet = false;
      this.debris.tint(i, col, 0.7 + R() * 0.5);
    }
  }
  /** a blast: fireball, sparks, smoke, shock ring, splinters */
  explode(p, s = 1, o = {}) {
    const c0 = o.c0 ?? 0xfff0b0, c1 = o.c1 ?? 0xc83a0a;
    this.emit(P.FLASH, p.x, p.y, p.z, 2, 0, 0, 0, 0, 2.2 * s, o.flash ?? 0xfff6d0);
    this.emit(P.FIREBALL, p.x, p.y, p.z, Math.round(14 * s), 0, 0.4, 0, 1.5 * s, s, c0, c1);
    this.emit(P.SPARK, p.x, p.y, p.z, Math.round(16 * s), 0, 0.6, 0, 5 * s);
    this.emit(P.EMBER, p.x, p.y, p.z, Math.round(10 * s), 0, 1, 0, 2 * s);
    this.emit(P.BLACK, p.x, p.y + 0.4 * s, p.z, Math.round(8 * s), 0, 1, 0, 1.4 * s, 1.3 * s, o.s0 ?? P.BLACK.c0, o.s1 ?? P.BLACK.c1);
    this.ring(_a.set(p.x, Math.max(this.floor(p.x, p.z) + 0.05, p.y - 0.3), p.z), null, 0.3, 3.2 * s, o.ring ?? 0xffa040, 0.55);
    if (o.debris !== 0) this.splinters(p, UP, Math.round((o.debris ?? 10) * s), Math.min(1.6, s), o.dcol ?? 0x4a3a2a);
  }
  /** a flat or tilted ring growing from r0 to r1 and fading; normal null lies on the water */
  ring(p, normal, r0, r1, color, life = 0.8) {
    if (this.fRings.length >= this.rings.n) this.endRing(this.fRings.shift());
    const i = this.rings.alloc();
    const q = new THREE.Quaternion();
    if (normal) q.setFromUnitVectors(_d.set(0, 0, 1), normal); else q.setFromAxisAngle(XA, -Math.PI / 2);
    this.fRings.push({ i, p: p.clone(), q, r0, r1, color, life, t: 0 });
  }
  endRing(r) { this.rings.release(r.i); }
  /** a glowing beam, or a jagged bolt, from a to c */
  beam(a, c, color, width = 0.08, life = 0.35, jag = 0, follow = null) {
    const n = jag ? 7 : 1, f = { a: a.clone(), c: c.clone(), color, width, life, t: 0, jag, items: [], pts: [], flick: 0, follow };
    for (let k = 0; k < n * 2; k++) f.items.push(this.glows.alloc());
    for (let k = 0; k <= n; k++) f.pts.push(new THREE.Vector3());
    this.layBolt(f);
    if (this.fGlows.length > 16) this.endGlow(this.fGlows.shift());
    this.fGlows.push(f);
    return f;
  }
  layBolt(f) {
    const n = f.pts.length - 1;
    _d.subVectors(f.c, f.a); const len = _d.length();
    for (let k = 0; k <= n; k++) { f.pts[k].lerpVectors(f.a, f.c, k / n); if (f.jag && k > 0 && k < n) f.pts[k].add(_b.set(rnd(f.jag), rnd(f.jag), rnd(f.jag)).multiplyScalar(Math.min(1, len / 4))); }
  }
  endGlow(f) { for (const i of f.items) this.glows.release(i); }
  /** a stretch of strand (rope, shaft, chain bar) from a to c on pool item i */
  seg(pool, i, a, c, r) {
    _d.subVectors(c, a); const len = _d.length();
    if (len < 1e-4) { pool.hide(i); return; }
    _q.setFromUnitVectors(UP, _d.multiplyScalar(1 / len));
    pool.put(i, a, _q, r, len, r);
  }

  // ------------------------------------------------ ropes and chains between two moving points
  /** a rope (or chain) object kept by key; lay() it every frame; drop() when done */
  rope(key, kind = 'rope', n = 8) {
    let r = this.ropes.get(key);
    if (!r) { r = { kind, n, items: [], seen: 0, pts: [] }; for (let k = 0; k <= n; k++) r.pts.push(new THREE.Vector3()); this.ropes.set(key, r); }
    r.seen = this.time;
    return r;
  }
  /** lay a rope from a to c sagging by sag; colour col, thickness rad */
  lay(r, a, c, sag, col = 0xc8b48a, rad = 0.02) {
    const n = r.n, pool = r.kind === 'chain' ? this.links : this.strands;
    for (let k = 0; k <= n; k++) { const u = k / n; r.pts[k].lerpVectors(a, c, u); r.pts[k].y -= sag * 4 * u * (1 - u); }
    if (r.kind === 'chain') {
      // links along the curve, every other one turned a quarter
      const tot = a.distanceTo(c), want = Math.min(30, Math.max(4, Math.round(tot / 0.16)));
      while (r.items.length < want) { const i = pool.alloc(); pool.tint(i, col); r.items.push(i); }
      while (r.items.length > want) pool.release(r.items.pop());
      const ls = (tot / want) * 0.78;
      for (let k = 0; k < want; k++) {
        const u = (k + 0.5) / want, s = u * n, j = Math.min(n - 1, Math.floor(s));
        _p.lerpVectors(r.pts[j], r.pts[j + 1], s - j);
        _d.subVectors(r.pts[j + 1], r.pts[j]).normalize();
        _q.setFromUnitVectors(XA, _d); if (k % 2) _q.multiply(_q2.setFromAxisAngle(XA, Math.PI / 2));
        pool.put(r.items[k], _p, _q, ls, ls * 0.9, ls * 0.9);
      }
      return;
    }
    while (r.items.length < n) { const i = pool.alloc(); pool.tint(i, col); r.items.push(i); }
    for (let k = 0; k < n; k++) this.seg(pool, r.items[k], r.pts[k], r.pts[k + 1], rad);
  }
  dropRope(key) { const r = this.ropes.get(key); if (!r) return; const pool = r.kind === 'chain' ? this.links : this.strands; for (const i of r.items) pool.release(i); this.ropes.delete(key); }

  // ------------------------------------------------ shots in flight
  /**
   * a shot from a to c over dur seconds: kind cannon heavy chain swivel harpoon flak depth mortar rocket boulder skull pot acid stone
   * bomb tracer torpedo spell; hit says whether it strikes (else it falls in the sea or the dirt); onLand(p) runs as it lands
   */
  shot(kind, a, c, dur, { arc = 0.5, hit = false, color = 0, onLand = null, line = false, flesh = false } = {}) {
    if (this.flights.length >= 150) this.land(this.flights.shift(), true);
    const f = { kind, a: a.clone(), c: c.clone(), dur: Math.max(0.12, dur), arc, hit, color, onLand, flesh, t: 0, ball: -1, b2: -1, st: -1, line: line ? this.strands.alloc() : -1, p: a.clone(), prev: a.clone(), spin: R() * 6 };
    const big = { cannon: 0.085, heavy: 0.12, chain: 0.07, mortar: 0.15, boulder: 0.26, pot: 0.13, acid: 0.13, stone: 0.12, bomb: 0.16, depth: 0.16 }[kind];
    if (big) { f.ball = this.balls.alloc(); f.r = big; this.balls.tint(f.ball, { boulder: 0x8a8274, pot: 0x8a5a34, acid: 0x5a7a2a, stone: 0x9a9488, depth: 0x4a3420, bomb: 0x2a2622 }[kind] ?? 0x26262a); }
    if (kind === 'chain') { f.b2 = this.balls.alloc(); this.balls.tint(f.b2, 0x26262a); f.st = this.strands.alloc(); this.strands.tint(f.st, 0x303034); }
    if (kind === 'harpoon' || kind === 'rocket') { f.st = this.strands.alloc(); this.strands.tint(f.st, kind === 'rocket' ? 0x8a2a20 : 0x3a2a1a); }
    if (f.line >= 0) this.strands.tint(f.line, 0xd8c89a);
    this.flights.push(f);
    return f;
  }
  land(f, quiet = false) {
    this.balls.release(f.ball); this.balls.release(f.b2); this.strands.release(f.st); this.strands.release(f.line);
    if (quiet) return;
    const p = f.c, k = f.kind;
    if (f.onLand) f.onLand(p, f);
    const floorY = this.floor(p.x, p.z), wet = this.water(p.x, p.z);
    const onFloor = !f.hit && p.y < floorY + 0.6;
    if (k === 'depth') {
      this.splash(p, 0.6);
      const q = p.clone();
      this.after(0.55, () => { this.emit(P.SPRAY, q.x, 0, q.z, 30, 0, 1, 0, 9, 1.6); this.emit(P.MIST, q.x, 1.5, q.z, 8, 0, 1, 0, 1, 1.6); this.ring(q.setY(0.05), null, 0.5, 4, 0xffffff, 1.2); this.ring(q, null, 0.3, 2.5, 0xa8d8f0, 0.9); });
      return;
    }
    if (onFloor) {
      if (wet) this.splash(p, k === 'heavy' || k === 'mortar' || k === 'boulder' ? 1.4 : k === 'swivel' || k === 'tracer' ? 0.35 : k === 'bomb' ? 1.8 : 0.9);
      else this.dust(p, k === 'bomb' || k === 'mortar' ? 1.6 : 0.6);
      if (k === 'bomb' || k === 'mortar' || k === 'rocket' || k === 'skull' || k === 'pot' || k === 'acid') this.impact(k, p, f);
      return;
    }
    // round shot into a beast draws blood, not splinters
    this.impact(f.flesh && (k === 'cannon' || k === 'heavy' || k === 'chain' || k === 'swivel' || k === 'tracer') ? 'harpoon' : k, p, f);
  }
  /** what a shot does where it strikes */
  impact(k, p, f) {
    const dir = _c.subVectors(f.c, f.a).setY(0).normalize();
    switch (k) {
      case 'mortar': case 'bomb': this.explode(p, k === 'bomb' ? 1.3 : 1, { dcol: this.sea ? 0x5a4630 : 0x5a4a34 }); if (!this.water(p.x, p.z)) this.dust(p, 2); break;
      case 'rocket': this.explode(p, 0.7, { debris: 4 }); break;
      case 'skull': this.explode(p, 0.8, { c0: 0xd0ffb0, c1: 0x2a8a3a, ring: 0x6aff8a, flash: 0xc0ffc0, debris: 3 }); this.glyph(G.skull, p, 2, 0x9aff9a, 1.4, 1.2, true); break;
      case 'pot': case 'acid': this.emit(P.POISON, p.x, p.y, p.z, 10, 0, 0.5, 0, 1.5, 1.2, 0x8ab030, 0xc8d860); this.emit(P.SPRAY, p.x, p.y, p.z, 12, 0, 1, 0, 3, 1, 0xb0d040, 0x6a8a20); this.glyph(G.drop, p, 3, 0xb8e040, 0.8, 1.2); break;
      case 'boulder': case 'stone': this.emit(P.DUST, p.x, p.y, p.z, 8, 0, 0.6, 0, 1.5, 1.2); this.splinters(p, dir, k === 'boulder' ? 12 : 6, 1.1, 0x8a8274); this.splinters(p, dir, 6, 1, 0x7a5a38); break;
      case 'flak': this.emit(P.FLASH, p.x, p.y, p.z, 1, 0, 0, 0, 0, 1.2, 0xffd890); this.emit(P.BLACK, p.x, p.y, p.z, 3, 0, 0, 0, 0, 0.8); this.emit(P.SPARK, p.x, p.y, p.z, 8, 0, 0, 0, 0, 1); break;
      case 'tracer': case 'swivel': this.emit(P.SPARK, p.x, p.y, p.z, 4, -dir.x, 0.5, -dir.z, 2); this.emit(P.CHIP, p.x, p.y, p.z, 3, -dir.x, 0.6, -dir.z, 2); break;
      case 'spell': this.emit(P.GLOW, p.x, p.y, p.z, 3, 0, 0, 0, 0, 1.4, f.color || 0x8ab4ff, f.color || 0x8ab4ff); this.emit(P.MOTE, p.x, p.y, p.z, 10, 0, 1, 0, 2, 1, f.color || 0x8ab4ff, 0xffffff); break;
      case 'harpoon': this.emit(P.SPARK, p.x, p.y, p.z, 4, 0, 0.5, 0, 2); this.emit(P.SPRAY, p.x, p.y, p.z, 6, 0, 1, 0, 2.5, 0.8, 0xc84a3a, 0x7a1a14); break;
      default: { // round shot into timber
        const s = k === 'heavy' ? 1.5 : k === 'chain' ? 0.8 : 1;
        this.emit(P.SPARK, p.x, p.y, p.z, Math.round(5 * s), -dir.x, 0.6, -dir.z, 2.5);
        this.emit(P.SMOKE, p.x, p.y, p.z, Math.round(2 * s), 0, 1, 0, 0.4, 0.8 * s);
        this.splinters(p, _d.set(dir.x * 0.6, 0.4, dir.z * 0.6), Math.round(6 * s), 0.8 * s);
        if (k === 'chain') { this.splinters(p.clone().setY(p.y + 1.5), UP, 5, 0.8, 0xe8e0cc); this.splinters(p.clone().setY(p.y + 1.2), UP, 3, 0.6, 0xc8b48a); }
      }
    }
  }
  stepFlight(f, dt) {
    f.t += dt;
    const k = Math.min(1, f.t / f.dur), dist = f.a.distanceTo(f.c);
    f.prev.copy(f.p);
    f.p.lerpVectors(f.a, f.c, k); f.p.y += Math.sin(k * Math.PI) * f.arc * dist * 0.15;
    const p = f.p, d = _d.subVectors(p, f.prev);
    const sp = d.length(); if (sp > 1e-5) d.multiplyScalar(1 / sp); else d.subVectors(f.c, f.a).normalize();
    const near = this.near(p);
    switch (f.kind) {
      case 'cannon': case 'heavy': if (R() < 0.35 * near) this.emit(P.GUN, p.x, p.y, p.z, 1, 0, 0, 0, 0, f.kind === 'heavy' ? 0.5 : 0.35); break;
      case 'mortar': this.emit(P.SPARK, p.x, p.y, p.z, 1, 0, 0, 0, 0); if (R() < 0.5 * near) this.emit(P.SMOKE, p.x, p.y, p.z, 1, 0, 0, 0, 0, 0.35); break;
      case 'bomb': if (R() < 0.3 * near) this.emit(P.GUN, p.x, p.y, p.z, 1, 0, 0, 0, 0, 0.25); break;
      case 'rocket': this.emit(P.FIRE, p.x - d.x * 0.3, p.y - d.y * 0.3, p.z - d.z * 0.3, 2, -d.x, -d.y, -d.z, 2, 0.6); this.emit(P.SMOKE, p.x, p.y, p.z, Math.ceil(2 * near), -d.x, -d.y, -d.z, 0.5, 0.45); break;
      case 'skull': this.emit(P.RUNE, p.x, p.y, p.z, 1, 0, 0, 0, 0, 2.2, 0xb8ffb0, 0x3a9a4a, G.skull); this.emit(P.FIRE, p.x, p.y, p.z, 2, -d.x, -d.y, -d.z, 1, 0.8, 0xc0ffa0, 0x1a6a2a); break;
      case 'pot': case 'acid': if (R() < 0.6 * near) this.emit(P.POISON, p.x, p.y, p.z, 1, 0, -1, 0, 0.5, 0.3, 0x8ab030, 0xb0c860); break;
      case 'boulder': case 'stone': if (R() < 0.25 * near) this.emit(P.DUST, p.x, p.y, p.z, 1, 0, 0, 0, 0, 0.3); break;
      case 'flak': case 'tracer': case 'swivel': this.emit(P.TRACE, p.x, p.y, p.z, 1, 0, 0, 0, 0, f.kind === 'swivel' ? 0.7 : 1, f.kind === 'flak' ? 0xffe080 : 0xfff0c0, 0xff7020); this.emit(P.TRACE, p.x - d.x * sp * 0.5, p.y - d.y * sp * 0.5, p.z - d.z * sp * 0.5, 1, 0, 0, 0, 0, 0.8); break;
      case 'torpedo': if (R() < 0.8 * near) this.emit(P.SPRAY, p.x, 0.05, p.z, 1, 0, 1, 0, 0.8, 0.8); break;
      case 'spell': this.emit(P.GLOW, p.x, p.y, p.z, 1, 0, 0, 0, 0, 0.7, f.color || 0x8ab4ff, f.color || 0x8ab4ff); this.emit(P.MOTE, p.x, p.y, p.z, 1, 0, 0, 0, 0, 0.8, f.color || 0x8ab4ff, 0xffffff); break;
      default: break;
    }
    if (f.ball >= 0) { _e.set(f.spin + k * 9, f.spin * 2 + k * 7, 0); _q.setFromEuler(_e); this.balls.put(f.ball, p, _q, f.r, f.kind === 'depth' ? f.r * 1.3 : f.r, f.r); }
    if (f.kind === 'chain') {
      // two balls on a chain, tumbling end over end
      const a = f.spin + f.t * 22; _b.set(Math.cos(a) * 0.3, Math.sin(a) * 0.12, Math.sin(a) * 0.3);
      _c.copy(p).add(_b); _p.copy(p).sub(_b);
      this.balls.put(f.ball, _c, _q.identity(), f.r); this.balls.put(f.b2, _p, _q, f.r);
      this.seg(this.strands, f.st, _p, _c, 0.012);
    }
    if (f.kind === 'harpoon' || f.kind === 'rocket') { _c.copy(p).addScaledVector(d, -0.55); this.seg(this.strands, f.st, _c, p, f.kind === 'rocket' ? 0.05 : 0.028); }
    if (f.line >= 0) { _c.copy(p).addScaledVector(d, -0.5); _c.y -= 0.02; this.seg(this.strands, f.line, f.a, _c, 0.012); }
    return k >= 1;
  }

  // ------------------------------------------------ boarders
  /**
   * a figure crossing from (mA, local pa) to (mB, local pb): style leap | swing | plank | climb; then a fight at the far rail
   * with sparks and steel; lose drops it into the sea (or the dirt far below)
   */
  boarder(mA, pa, mB, pb, color, { style = 'leap', fight = 0.9, lose = false, delay = 0, foeColor = null, foeLose = false, dur = 0.8 } = {}) {
    if (this.figs.length >= this.figBody.n - 2) return null;
    const f = { mA, pa: pa.clone(), mB, pb: pb.clone(), color, style, fight, lose, t: -delay, dur, mode: 'go', p: new THREE.Vector3(), v: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, i: this.figBody.alloc(), foe: null, glint: 0 };
    this.figBody.tint(f.i, color);
    this.figs.push(f);
    if (foeColor !== null) {
      // the defender waits at the rail, a step inboard
      const g = { mA: mB, pa: pb.clone().multiplyScalar(1).setZ(pb.z * 0.6), mB, pb: pb.clone().setZ(pb.z * 0.6), color: foeColor, style: 'guard', fight: dur + fight, lose: foeLose, t: -delay, dur: 0.01, mode: 'go', p: new THREE.Vector3(), v: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, i: this.figBody.alloc(), foe: f, glint: 0 };
      this.figBody.tint(g.i, foeColor);
      f.foe = g; this.figs.push(g);
    }
    return f;
  }
  stepFig(f, dt) {
    f.t += dt;
    if (f.t < 0) { this.figBody.hide(f.i); this.figHead.hide(f.i); return false; }
    const A = toWorld(f.mA, f.pa.x, f.pa.y, f.pa.z, _a), B = toWorld(f.mB, f.pb.x, f.pb.y, f.pb.z, _b);
    let yawTo = null;
    if (f.mode === 'go') {
      const k = Math.min(1, f.t / f.dur), ease = k * k * (3 - 2 * k);
      if (f.style === 'leap') { f.p.lerpVectors(A, B, ease); f.p.y += Math.sin(k * Math.PI) * (0.6 + A.distanceTo(B) * 0.25); f.pitch = Math.sin(k * Math.PI) * 0.5; }
      else if (f.style === 'swing') {
        // on a rope from a point high between the ships: down through the dip and up onto her rail
        f.p.lerpVectors(A, B, k); f.p.y += -Math.sin(k * Math.PI) * 0.55 + k * 0.1;
        _c.lerpVectors(A, B, 0.5); _c.y += 2.6;
        if (!f.rope) { f.rope = this.strands.alloc(); this.strands.tint(f.rope, 0xc8b48a); }
        _p.copy(f.p); _p.y += 0.62; this.seg(this.strands, f.rope, _p, _c, 0.014);
        f.pitch = (0.5 - k) * 0.8; f.roll = 0;
      } else if (f.style === 'plank') { f.p.lerpVectors(A, B, k); f.p.y += Math.abs(Math.sin(k * Math.PI * 5)) * 0.06 + 0.05; f.pitch = 0.15; }
      else if (f.style === 'climb') { f.p.lerpVectors(A, B, ease); f.pitch = 0; }
      else { f.p.copy(B); }
      _c.subVectors(B, A); if (f.style !== 'guard' && _c.lengthSq() > 1e-4) yawTo = Math.atan2(_c.x, _c.z);
      if (k >= 1) { f.mode = 'fight'; f.t = 0; if (f.rope !== undefined && f.rope >= 0) { this.strands.release(f.rope); f.rope = -1; } }
    } else if (f.mode === 'fight') {
      // hacking at the rail: lunges, sparks and a glint of steel
      f.p.copy(B);
      const lunge = Math.max(0, Math.sin(f.t * 11 + f.i)) * 0.06;
      f.pitch = lunge * 3; f.roll = Math.sin(f.t * 7 + f.i) * 0.1;
      const other = f.foe;
      if (other) { _c.subVectors(other.p, f.p); if (_c.lengthSq() > 1e-4) yawTo = Math.atan2(_c.x, _c.z); }
      else { _c.subVectors(f.mB.position, f.p); yawTo = Math.atan2(_c.x, _c.z); }
      if (f.style !== 'guard' && (f.glint -= dt) <= 0) {
        f.glint = 0.12 + R() * 0.2;
        _c.copy(f.p); if (f.foe) _c.lerp(f.foe.p, 0.5); else _c.addScaledVector(_d.set(Math.sin(f.yaw), 0, Math.cos(f.yaw)), 0.2);
        _c.y += 0.45;
        this.emit(P.SPARK, _c.x, _c.y, _c.z, 3, 0, 0.3, 0, 1.5);
        if (R() < 0.45) this.emit(P.GLINT, _c.x, _c.y + 0.05, _c.z, 1);
      }
      if (f.t >= f.fight) {
        if (f.lose) { f.mode = 'fall'; f.v.set(rnd(0.8), 2.2, rnd(0.8)); _c.subVectors(f.p, f.mB.position).setY(0).normalize(); f.v.addScaledVector(_c, 1.6); f.t = 0; }
        else { f.mode = 'in'; f.t = 0; }
      }
    } else if (f.mode === 'fall') {
      f.v.y -= 9.8 * dt; f.p.addScaledVector(f.v, dt); f.pitch += dt * 7; f.roll += dt * 3;
      if (f.p.y < this.floor(f.p.x, f.p.z) - 0.1) {
        if (this.water(f.p.x, f.p.z)) this.splash(f.p, 0.45); else this.dust(f.p, 0.4);
        return true;
      }
    } else if (f.mode === 'in') {
      // gone below or into the press of the crew
      const k = f.t / 0.35; f.p.lerpVectors(B, f.mB.position, k * 0.35);
      if (k >= 1) return true;
    }
    if (yawTo !== null) f.yaw = yawTo;
    _e.set(f.pitch, f.yaw, f.roll); _q.setFromEuler(_e);
    const s = f.mB.scale.x > 1.2 ? 1.15 : 1;
    this.figBody.put(f.i, f.p, _q, s); this.figHead.put(f.i, f.p, _q, s);
    return false;
  }
  endFig(f) { if (f.rope >= 0) this.strands.release(f.rope); this.figBody.release(f.i); this.figHead.release(f.i); if (f.foe && f.foe.foe === f) f.foe.foe = null; }

  // ------------------------------------------------ struck colours
  /** her colours come down and the winner's go up on a staff over her masthead */
  strike(m, oldHex, newHex, top) {
    const D = this.dims(m);
    const y0 = top ?? D.top;
    let st = m.userData.fxStaff;
    if (!st) {
      st = new THREE.Mesh(this.staffGeo, new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.8 }));
      st.position.set(D.hx * 0.08, y0 - 0.1, 0); st.userData.fxFlag = true; m.add(st); m.userData.fxStaff = st;
    }
    const mk = (hex) => { const f = new THREE.Mesh(this.flagGeo.clone(), new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7, side: THREE.DoubleSide })); f.userData.fxFlag = true; f.userData.base = Float32Array.from(f.geometry.attributes.position.array); st.add(f); return f; };
    const old = m.userData.fxFlagMesh || mk(oldHex);
    const nu = mk(newHex); nu.position.y = 0.05; nu.scale.setScalar(0.01);
    m.userData.fxFlagMesh = nu;
    const was = this.flags.find((F) => F.f === old);
    if (was) { was.mode = 'down'; was.t = 0; } else this.flags.push({ f: old, t: 0, mode: 'down' });
    this.flags.push({ f: nu, t: -0.9, mode: 'up' });
    this.emit(P.GLINT, ...toWorld(m, D.hx * 0.08, y0 + 0.6, 0, _a).toArray(), 1);
  }
  stepFlags(dt) {
    const t = this.time;
    for (let k = this.flags.length - 1; k >= 0; k--) {
      const F = this.flags[k], f = F.f; F.t += dt;
      if (F.mode === 'down') { const u = Math.min(1, F.t / 1.3); f.position.y = 0.72 - u * 0.7; f.scale.setScalar(Math.max(0.01, 1 - Math.max(0, u - 0.75) * 4)); if (u >= 1) { f.parent?.remove(f); f.geometry.dispose(); f.material.dispose(); this.flags.splice(k, 1); continue; } }
      else if (F.mode === 'up') { if (F.t < 0) continue; const u = Math.min(1, F.t / 1.5); f.position.y = 0.05 + u * 0.67; f.scale.setScalar(Math.max(0.01, Math.min(1, u * 3))); if (u >= 1) F.mode = 'fly'; }
      // wave the cloth
      const pa = f.geometry.attributes.position, base = f.userData.base;
      for (let i = 0; i < pa.count; i++) { const x = base[i * 3]; pa.array[i * 3 + 2] = Math.sin(x * 7 - t * 7 + k) * 0.07 * x; pa.array[i * 3 + 1] = base[i * 3 + 1] - x * x * 0.05; }
      pa.needsUpdate = true;
    }
  }

  // ------------------------------------------------ per-frame
  update(dt) {
    if (!(dt > 0)) dt = 0.016;
    this.time += dt; this.uTime.value = this.time;
    // timers and emitters
    if (this.timers.length) { const due = this.timers.filter((x) => x.at <= this.time); if (due.length) { this.timers = this.timers.filter((x) => x.at > this.time); for (const x of due) x.fn(); } }
    for (let k = this.emitters.length - 1; k >= 0; k--) { const e = this.emitters[k]; e.t += dt; e.fn(Math.min(1, e.t / e.dur), dt); if (e.t >= e.dur) this.emitters.splice(k, 1); }
    // actions
    for (let k = this.acts.length - 1; k >= 0; k--) { const a = this.acts[k]; a.t += dt; const u = Math.min(1, a.t / a.dur); a.fn(u, a.m); if (u >= 1) this.acts.splice(k, 1); }
    // flights
    for (let k = this.flights.length - 1; k >= 0; k--) { const f = this.flights[k]; if (this.stepFlight(f, dt)) { this.flights.splice(k, 1); this.land(f); } }
    // splinters: tumble, hit the water and float a while, or lie in the dirt
    for (let i = 0; i < this.debris.n; i++) {
      const d = this.deb[i];
      if (!d || !d.on || !this.debris.used[i]) continue;
      d.t += dt;
      if (d.t > d.life) { d.on = false; this.debris.release(i); continue; }
      const fy = this.floor(d.p.x, d.p.z);
      if (!d.wet) {
        d.v.y -= 9.8 * dt; d.p.addScaledVector(d.v, dt); d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
        if (d.p.y < fy) { d.wet = true; d.p.y = fy; d.float = this.water(d.p.x, d.p.z); if (d.float && R() < 0.35) this.emit(P.SPRAY, d.p.x, fy, d.p.z, 2, 0, 1, 0, 1.5, 0.6); d.r.x = 0; d.r.z = rnd(0.3); }
      } else if (d.float) { d.p.y = fy - 0.12 + Math.sin(this.time * 2 + i) * 0.03; d.p.x += this.wind.x * dt * 0.1; d.p.z += this.wind.z * dt * 0.1; }
      const shrink = Math.min(1, (d.life - d.t) * 2);
      _e.set(d.r.x, d.r.y, d.r.z); _q.setFromEuler(_e);
      this.debris.put(i, d.p, _q, d.sx * shrink, d.sy * shrink, d.sz * shrink);
    }
    // rings and beams
    for (let k = this.fRings.length - 1; k >= 0; k--) {
      const r = this.fRings[k]; r.t += dt; const u = r.t / r.life;
      if (u >= 1) { this.endRing(r); this.fRings.splice(k, 1); continue; }
      const rad = lerp(r.r0, r.r1, 1 - (1 - u) * (1 - u));
      this.rings.put(r.i, r.p, r.q, rad); this.rings.tint(r.i, r.color, (1 - u) * 0.9);
    }
    for (let k = this.fGlows.length - 1; k >= 0; k--) {
      const f = this.fGlows[k]; f.t += dt; const u = f.t / f.life;
      if (u >= 1) { this.endGlow(f); this.fGlows.splice(k, 1); continue; }
      if (f.follow) f.follow(f);
      if (f.jag && (f.flick -= dt) <= 0) { f.flick = 0.05; this.layBolt(f); }
      const n = f.pts.length - 1, w = f.width * (1 - u * 0.6);
      for (let j = 0; j < n; j++) {
        this.seg(this.glows, f.items[j * 2], f.pts[j], f.pts[j + 1], w * 2.4); this.glows.tint(f.items[j * 2], f.color, (1 - u) * 0.45);
        this.seg(this.glows, f.items[j * 2 + 1], f.pts[j], f.pts[j + 1], w * 0.7); this.glows.tint(f.items[j * 2 + 1], 0xffffff, (1 - u));
      }
    }
    // boarders
    for (let k = this.figs.length - 1; k >= 0; k--) { const f = this.figs[k]; if (this.stepFig(f, dt)) { this.endFig(f); this.figs.splice(k, 1); } }
    if (this.flags.length) this.stepFlags(dt);
    // ropes nobody laid this frame go slack and are taken in
    for (const [key, r] of this.ropes) if (this.time - r.seen > 0.25) this.dropRope(key);
    // point sizes follow the camera
    const cam = this.stage.camera, h = this.stage.renderer.domElement.height || 900;
    const sc = h / (2 * Math.tan((cam.fov * Math.PI) / 360));
    for (const k in this.ps) { this.ps[k].mat.uniforms.uScale.value = sc; this.ps[k].update(dt, this.wind.x, this.wind.z); }
    for (const p of this.pools) p.flush();
  }

  // ================================================ the lasting states of hulls at sea
  /** mark what last struck a hull, so its lasting look can match (freeze, paralyze, briar...) */
  mark(i, what) { this.rigOf(i).last = what; }
  rigOf(i) { let r = this.rigs.get(i); if (!r) { r = { items: {}, acc: {}, last: '', fire: null }; this.rigs.set(i, r); } return r; }
  /** keep (or let go of) one pooled piece of a rig */
  hold(r, key, pool, on) {
    const it = r.items;
    if (on) { if (it[key] === undefined || it[key] < 0) it[key] = pool.alloc(); return it[key]; }
    if (it[key] >= 0) { pool.release(it[key]); it[key] = -1; }
    return -1;
  }
  freeRig(i) {
    const r = this.rigs.get(i); if (!r) return;
    const P2 = { ward: this.bubbles, lure: this.bubbles, hover: this.discs, turned: this.discs, slick: this.slicks, ice: this.ices, auraDisc: this.discs };
    for (const k in r.items) { const pool = P2[k] || this.strands; if (r.items[k] >= 0) pool.release(r.items[k]); }
    for (const k of ['anchor', 'rud0', 'rud1', 'rud2']) this.dropRope(`${k}:${i}`);
    this.rigs.delete(i);
  }

  /**
   * every hull's lasting states from her engine fields, each frame: fire and poison, plague, wards, fog, dispel runes,
   * lulling notes, gusts, spurs, war-fury, courage, anchors, hover glow, fouled rudders, briars and ice, fear, turned beasts,
   * hunters' sludge and lures, supply auras, grapples and maws. models[i] is ents[i]'s model, posed this frame.
   */
  seaStates(b, models, dt, speed = 1) {
    const tick = b.tick, T = this.time;
    for (let i = 0; i < b.ents.length; i++) {
      const e = b.ents[i], m = models[i];
      if (!m || !e.alive || !m.visible || e.air || (m.userData.depth || 0) > 0.6) { if (this.rigs.has(i)) this.freeRig(i); continue; }
      const r = this.rigOf(i), D = this.dims(m, e), A = e.def.arts || {}, nk = this.near(m.position), acc = r.acc;
      const rad = e.radius || D.hx, ship = e.ship || e.fort;
      // ---- harm over time: fire, poison or the sea coming in
      if (e.dot && e.dot.until > tick && !e.dot.grip) {
        const by = b.ents[e.dot.by], ba = by?.def?.arts || {};
        const kind = ba.poison || ba.acid || ba.skyPoison || e.dot.poison ? 'poison' : by && !by.ship && !by.fort && !by.air ? 'water' : 'fire';
        if (!r.fire) r.fire = [0, 1, 2].map(() => this.deckPoint(D, new THREE.Vector3()));
        for (const lp of r.fire) {
          const w = toWorld(m, lp.x, lp.y, lp.z, _a);
          if (kind === 'fire') {
            for (let n = this.rate(lp, 'f', 16 * nk, dt); n > 0; n--) this.emit(P.FIRE, w.x, w.y + 0.1, w.z, 1, 0, 1, 0, 0.6, 1.1);
            if (this.rate(lp, 's', 4 * nk, dt)) this.emit(P.BLACK, w.x, w.y + 0.6, w.z, 1, 0, 1, 0, 0.8, 0.8);
            if (this.rate(lp, 'e', 3 * nk, dt)) this.emit(P.EMBER, w.x, w.y + 0.3, w.z, 1, 0, 1, 0, 1);
          } else if (kind === 'poison') {
            if (this.rate(lp, 'f', 5 * nk, dt)) this.emit(P.POISON, w.x, w.y + 0.2, w.z, 1, 0, 1, 0, 0.4, 0.8, 0x6a9a2a, 0xb8d050);
            if (this.rate(lp, 'e', 4 * nk, dt)) this.emit(P.MOTE, w.x, w.y + 0.1, w.z, 1, 0, 1, 0, 0.6, 0.8, 0xb8ff60, 0x4a8a20);
          } else if (this.rate(lp, 'f', 6 * nk, dt)) this.emit(P.SPRAY, w.x, 0.05, w.z, 2, 0, 1, 0, 1.6, 0.8);
        }
      } else r.fire = null;
      // ---- plague: a sickly miasma over the deck, flies, a skull now and then
      if (e.plagueUntil > tick) {
        this.deckPoint(D, _c); const w = toWorld(m, _c.x, _c.y, _c.z, _a);
        if (this.rate(acc, 'pl', 4 * nk, dt)) this.emit(P.POISON, w.x, w.y + 0.15, w.z, 1, 0, 1, 0, 0.2, 1, 0x7a8a30, 0xa0a860);
        for (let n = this.rate(acc, 'fl', 12 * nk, dt); n > 0; n--) this.emit(P.FLY, w.x, w.y + 0.4, w.z, 1);
        if (this.rate(acc, 'sk', 0.7, dt)) this.glyph(G.skull, _p.copy(w).setY(w.y + 0.8), 1, 0xb8d070, 1, 0.5);
      }
      // ---- a ward: a shimmering shell over her
      const ward = this.hold(r, 'ward', this.bubbles, e.wardUntil > tick);
      if (ward >= 0) { this.bubbles.tint(ward, 0xffd870, 0.55 + 0.15 * Math.sin(T * 3 + i)); _p.copy(m.position); _p.y += D.deckY * 0.6; this.bubbles.put(ward, _p, m.quaternion, rad * 1.25 * (1 + 0.02 * Math.sin(T * 4)), Math.max(1.2, D.top * 0.75), rad * 0.95); }
      // ---- a fog bank about her
      if (e.fogged > tick) for (let n = this.rate(acc, 'fog', 5 * Math.max(0.4, nk), dt); n > 0; n--) { const a = R() * 6.283, d = rad * (0.6 + R() * 1.2); this.emit(P.FOG, m.position.x + Math.cos(a) * d, 0.5 + R() * 1.2, m.position.z + Math.sin(a) * d, 1); }
      // ---- dispelled: pale runes circling her
      if (e.dispelled > tick && this.rate(acc, 'dis', 3 * nk, dt)) { const a = T * 1.5 + R() * 0.6; this.glyph(G.rune, _p.set(m.position.x + Math.cos(a) * rad * 1.1, D.deckY + 0.4, m.position.z + Math.sin(a) * rad * 1.1), 1, 0x9ff0ff, 0.9, 0.3, true); }
      // ---- lulled: drifting notes and a lilac haze
      if (e.lulled > tick) {
        if (this.rate(acc, 'lul', 2.5 * nk, dt)) { this.deckPoint(D, _c); toWorld(m, _c.x, _c.y + 0.6, _c.z, _p); this.emit(P.GLYPH, _p.x, _p.y, _p.z, 1, rnd(1), 1, rnd(1), 0.5, 1, 0xe0c0ff, 0xb090e0, R() < 0.5 ? G.note : G.notes); }
        if (this.rate(acc, 'hz', 1.2 * nk, dt)) this.emit(P.HAZE, m.position.x + rnd(rad), D.deckY + 0.5, m.position.z + rnd(rad), 1);
      }
      // ---- a friendly wind: gusts blowing into her sails from astern
      if (e.windUntil > tick && this.rate(acc, 'wnd', 4 * nk, dt)) {
        const st = toWorld(m, -D.hx * 1.3, D.deckY + 0.8 + R() * D.top * 0.4, rnd(D.hz), _p); _d.set(1, 0, 0).applyQuaternion(m.quaternion);
        this.emit(P.GLYPH, st.x, st.y, st.z, 1, _d.x, 0.05, _d.z, 3.2, 1.1, 0xf4fbff, 0xd8ecff, G.gust);
      }
      // ---- spurred: she throws a bow wave
      if (e.spurred > tick && this.rate(acc, 'spr', 10 * nk, dt)) { const s = R() < 0.5 ? 1 : -1; toWorld(m, D.hx * 0.9, 0.05, s * D.hz * 0.6, _p); _d.set(0.3, 0, s).applyQuaternion(m.quaternion); this.emit(P.SPRAY, _p.x, 0.05, _p.z, 2, _d.x, 0.8, _d.z, 2.2, 0.8); if (R() < 0.1) this.glyph(G.chevron, _p.setY(D.top * 0.6), 1, 0x9ad8ff, 0.7, 0.6); }
      // ---- war-fury for boarders, and courage
      if (e.boardAura > tick) {
        if (this.rate(acc, 'ba', 5 * nk, dt)) { this.deckPoint(D, _c); toWorld(m, _c.x, _c.y, _c.z, _p); this.emit(P.EMBER, _p.x, _p.y + 0.2, _p.z, 1, 0, 1, 0, 1, 1.3, 0xff6a3a, 0xa01a0a); }
        if (this.rate(acc, 'bs', 0.6 * nk, dt)) this.glyph(G.swords, _p.copy(m.position).setY(D.top * 0.7), 1, 0xff5a3a, 1, 0.5, true);
      }
      if (e.fearless > tick) {
        if (this.rate(acc, 'fe', 4 * nk, dt)) { this.deckPoint(D, _c); toWorld(m, _c.x, _c.y, _c.z, _p); this.emit(P.MOTE, _p.x, _p.y + 0.2, _p.z, 1, 0, 1, 0, 0.8, 1, 0xffe080, 0xffa020); }
        if (this.rate(acc, 'fs', 0.4 * nk, dt)) this.glyph(G.sun, _p.copy(m.position).setY(D.top * 0.8), 1, 0xffd060, 1.1, 0.4, true);
      }
      // ---- anchored: her cable runs down into the water
      if (e.anchored && e.ship) {
        toWorld(m, D.bow[0] * 0.9, D.deckY, D.bow[2], _a); toWorld(m, D.bow[0] + 1.6, -1.4, 0, _b);
        this.lay(this.rope(`anchor:${i}`, 'chain', 6), _a, _b, 0.15, 0x3a3a3e);
        if (this.rate(acc, 'anc', 0.5, dt)) { toWorld(m, D.bow[0] + 1.0, 0.05, 0, _p); this.ring(_p, null, 0.1, 0.9, 0xc0d8e4, 1.2); }
      }
      // ---- hover: a glow on the water under her and motes falling through it
      const hv = this.hold(r, 'hover', this.discs, hovers(e));
      if (hv >= 0) {
        const col = typeof A.beam === 'number' ? A.beam : 0x9affd0;
        this.discs.tint(hv, col, 0.8); _p.set(m.position.x, 0.06, m.position.z); this.discs.put(hv, _p, m.quaternion, D.hx * 1.15, 1, D.hz * 1.6);
        m.position.y += 0.35 + Math.sin(T * 1.3 + i) * 0.08;
        if (this.rate(acc, 'hm', 6 * nk, dt)) { this.emit(P.MOTE, m.position.x + rnd(D.hx), 0.1, m.position.z + rnd(D.hz), 1, 0, 1, 0, 0.3, 0.8, col, 0xffffff); }
      }
      // ---- a fouled rudder: weed and cut line trailing from her stern, churning
      if (e.rudderUntil > tick && ship) {
        for (let k = 0; k < 3; k++) {
          toWorld(m, D.stern[0], 0.1, (k - 1) * D.hz * 0.3, _a);
          toWorld(m, D.stern[0] - 1.1 - k * 0.3, -0.25 + Math.sin(T * 3 + k) * 0.1, (k - 1) * 0.5 + Math.sin(T * 2.3 + k * 2) * 0.25, _b);
          this.lay(this.rope(`rud${k}:${i}`, 'rope', 5), _a, _b, -0.05, k === 1 ? 0x8a2a22 : 0x3a5a2a, 0.03);
        }
        if (this.rate(acc, 'rd', 5 * nk, dt)) { toWorld(m, D.stern[0] - 0.3, 0, 0, _p); this.emit(P.SPRAY, _p.x, 0.05, _p.z, 1, 0, 1, 0, 1.2, 0.7); }
      }
      // ---- slowed: briars on a hull, ice or a paralysing crackle on a beast
      const slow = e.slowUntil > tick;
      const frozen = slow && !ship && r.last === 'freeze', para = slow && !ship && r.last === 'paralyze';
      const ic = this.hold(r, 'ice', this.ices, frozen || (slow && ship && r.last === 'freeze'));
      if (ic >= 0) { this.ices.tint(ic, 0xe8f6ff); _p.set(m.position.x, 0.04, m.position.z); this.ices.put(ic, _p, m.quaternion, rad * 1.5, 1, rad * 1.2); if (this.rate(acc, 'sn', 2 * nk, dt)) this.glyph(G.snow, _p.set(m.position.x + rnd(rad), 0.8 + R(), m.position.z + rnd(rad)), 1, 0xe8f6ff, 0.6, 0.2); if (this.rate(acc, 'fm', 2 * nk, dt)) this.emit(P.MIST, m.position.x + rnd(rad), 0.2, m.position.z + rnd(rad), 1, 0, 1, 0, 0.2, 0.7, 0xf0f8ff, 0xffffff); }
      if (para && (acc.pz = (acc.pz || 0) - dt) <= 0) {
        acc.pz = 0.12 + R() * 0.2;
        _a.set(m.position.x + rnd(rad * 0.8), 0.3 + R() * 1.2, m.position.z + rnd(rad * 0.8)); _b.set(m.position.x + rnd(rad * 0.8), 0.3 + R() * 1.2, m.position.z + rnd(rad * 0.8));
        this.beam(_a, _b, 0xd8ff60, 0.02, 0.14, 0.25); this.emit(P.SPARK, _b.x, _b.y, _b.z, 2, 0, 0, 0, 0, 1, 0xf0ffa0, 0xa0d020);
      }
      if (slow && ship && r.last !== 'freeze' && this.rate(acc, 'br', 5 * nk, dt)) { const a = R() * 6.283; this.emit(P.GLYPH, m.position.x + Math.cos(a) * D.hx * 0.8, 0.15, m.position.z + Math.sin(a) * D.hz * 1.2, 1, 0, 1, 0, 0.25, 1, 0x4a6a2a, 0x2a3a1a, G.thorn); }
      // ---- fear: a beast that bolts, thrashing
      if (e.fleeUntil > tick) {
        if (this.rate(acc, 'fr', 1.4 * nk, dt)) this.glyph(G.skull, _p.copy(m.position).setY(D.top + 0.4), 1, 0xd0b0ff, 0.9, 0.8);
        if (this.rate(acc, 'ft', 8 * nk, dt)) { toWorld(m, -D.hx, 0.05, rnd(D.hz), _p); this.emit(P.SPRAY, _p.x, 0.05, _p.z, 2, 0, 1, 0, 2.5, 0.9); }
      }
      // ---- a beast turned against its own: a violet aura with runes going round
      const tn = this.hold(r, 'turned', this.discs, e.turnedUntil > tick && e.trueSide !== undefined);
      if (tn >= 0) {
        this.discs.tint(tn, 0xb040ff, 0.9); _p.set(m.position.x, 0.07, m.position.z); _q.setFromAxisAngle(UP, T * 0.8); this.discs.put(tn, _p, _q, rad * 1.4);
        if (this.rate(acc, 'tr', 4 * nk, dt)) { const a = T * 2 + R(); this.glyph(G.rune, _p.set(m.position.x + Math.cos(a) * rad, 0.6 + R() * D.top * 0.5, m.position.z + Math.sin(a) * rad), 1, 0xc070ff, 0.8, 0.4, true); }
        if (this.rate(acc, 'tm', 6 * nk, dt)) this.emit(P.MOTE, m.position.x + rnd(rad), 0.3, m.position.z + rnd(rad), 1, 0, 1, 0, 0.6, 1, 0xd090ff, 0x6020a0);
      }
      // ---- hunters: an oily slick that burns beasts, a glowing lure
      const sl = this.hold(r, 'slick', this.slicks, !!A.sludge && e.ship);
      if (sl >= 0) {
        let hot = 0; for (const o of b.ents) if (o.alive && !o.ship && !o.fort && !o.air && o.side !== e.side && Math.hypot(o.x - e.x, o.y - e.y) < A.sludge) { hot = 1; break; }
        const s = A.sludge * (hot ? 0.85 : 0.4); this.slicks.tint(sl, 0x1a1810); toWorld(m, -D.hx * 0.6, 0, 0, _p); _p.y = 0.03; this.slicks.put(sl, _p, m.quaternion, s * 1.2, 1, s);
        if (this.rate(acc, 'sb', (hot ? 6 : 2) * nk, dt)) this.emit(P.SMOKE, _p.x + rnd(s * 0.7), 0.05, _p.z + rnd(s * 0.7), 1, 0, 1, 0, 0.3, 0.5, 0x3a3420, 0x6a6040);
      }
      const lu = this.hold(r, 'lure', this.bubbles, !!A.lure && e.ship);
      if (lu >= 0) {
        toWorld(m, D.bow[0] + 0.6, D.deckY + 0.5 + Math.sin(T * 2 + i) * 0.1, 0, _p);
        this.bubbles.tint(lu, 0xa0ffe0, 1); this.bubbles.put(lu, _p, _q.identity(), 0.16);
        if (this.rate(acc, 'lg', 6 * nk, dt)) this.emit(P.GLOW, _p.x, _p.y, _p.z, 1, 0, 0, 0, 0, 0.7, 0xa0ffe0, 0x40c0a0);
        if (this.rate(acc, 'lr', 0.6, dt)) this.ring(_b.set(_p.x, 0.05, _p.z), null, 0.2, A.lure * 0.6, 0x60e0c0, 1.6);
        toWorld(m, D.bow[0], D.top * 0.5, 0, _a); _b.copy(_p); _b.y += 0.15;
        this.lay(this.rope(`lure:${i}`, 'rope', 3), _a, _b, 0.1, 0x3a3a30, 0.01);
      }
      // ---- auras round a supply ship: her 'aura' action pulses, a ring goes out over the ships she covers
      const AUR = A.ward ? 0xffd870 : A.boardAura ? 0xff5a3a : A.fearless ? 0xffc040 : A.lull ? 0xc89aff : A.dispel ? 0x9ff0ff : A.fog ? 0xcfd8de : A.regen ? 0x7aff9a : A.spur ? 0x8ad0ff : A.wind ? 0xe8f4ff : A.refill ? 0xfff2c0 : 0;
      if (AUR && e.ship && (acc.au = (acc.au || 0) - dt * speed) <= 0) {
        acc.au = 2.4;
        if (!this.act(m, 'aura', 1.2 / Math.max(0.5, speed))) this.emit(P.GLOW, m.position.x, D.top * 0.6, m.position.z, 2, 0, 0, 0, 0, 1.6, AUR, AUR);
        const R0 = e.def.supply?.radius || 11;
        this.ring(_p.set(m.position.x, 0.06, m.position.z), null, rad, R0, AUR, 1.8);
        this.ring(_p, null, rad * 0.6, R0 * 0.6, AUR, 1.3);
        for (let k = 0; k < Math.ceil(6 * nk); k++) { this.deckPoint(D, _c); toWorld(m, _c.x, _c.y, _c.z, _a); this.emit(P.MOTE, _a.x, _a.y, _a.z, 1, 0, 1, 0, 1.5, 1.2, AUR, 0xffffff); }
        if (A.regen) this.glyph(G.drop, _p.copy(m.position).setY(D.top * 0.7), 2, 0x7aff9a, 0.8, 0.6, true);
      }
      // ---- grappled: chains or grapnel lines between her and the hull she holds
      const gl = this.links2.get(`g:${i}`);
      if (gl && e.lockUntil > tick && e.lockTo === gl.to && b.ents[gl.to]?.alive && models[gl.to]) {
        const mt = models[gl.to], Dt = this.dims(mt, b.ents[gl.to]);
        const n = gl.maw ? 1 : 3;
        for (let k = 0; k < n; k++) {
          const u = n === 1 ? 0.8 : -0.4 + k * 0.6;
          this.railToward(m, D, mt.position, u, _c); toWorld(m, _c.x, _c.y, _c.z, _a);
          this.railToward(mt, Dt, m.position, u * 0.8, _c); toWorld(mt, _c.x, _c.y, _c.z, _b);
          // thrown, then hauled in: the sag closes as the hulls come together
          const age = T - gl.born, thrown = Math.min(1, age / 0.5);
          if (thrown < 1) _b.lerpVectors(_a, _b, thrown).y += Math.sin(thrown * Math.PI) * 1.2;
          const sag = thrown < 1 ? 0.3 : Math.max(0.03, 0.35 - (age - 0.5) * 0.4) + Math.sin(T * 2 + k) * 0.02;
          this.lay(this.rope(`gr${k}:${i}`, 'chain', 6), _a, _b, sag, gl.maw ? 0x6a5a4a : 0x3a3a40);
        }
        if (gl.maw && this.rate(acc, 'mw', 3 * nk, dt)) { toWorld(m, D.bow[0], D.deckY * 0.5, 0, _p); this.emit(P.SPRAY, _p.x, 0.1, _p.z, 2, 0, 1, 0, 2, 0.8); if (R() < 0.3) this.emit(P.CHIP, _p.x, _p.y, _p.z, 2, 0, 1, 0, 2); }
      } else if (gl) this.links2.delete(`g:${i}`);
    }
    for (const i of this.rigs.keys()) if (i >= b.ents.length) this.freeRig(i);
  }

  /** a grapple begins: by (index) holds to; maw: a closing jaw rather than chains */
  grapple(byI, toI, mBy, mTo, maw) {
    this.links2.set(`g:${byI}`, { to: toI, born: this.time, maw });
    this.act(mBy, 'grapple', 1.0);
    const D = this.dims(mBy), w = toWorld(mBy, D.bow[0], D.deckY, 0, _a);
    if (maw) { this.emit(P.SPRAY, w.x, 0.2, w.z, 16, 0, 1, 0, 3.5, 1.2); this.splinters(w, UP, 10, 1); this.emit(P.SPARK, w.x, w.y, w.z, 10, 0, 0.5, 0, 3); this.rock(mTo, 0.14, 0.05, 0.06); }
    else { this.rock(mTo, 0.06); this.emit(P.SPARK, w.x, w.y, w.z, 4, 0, 0.5, 0, 2); }
  }

  /** a boarding fight between two hulls this tick: grapnel lines, a plank across, boarders going over and steel at the rail */
  boarding(kA, mA, kC, mC, eA, eC, speed = 1) {
    const key = `b:${Math.min(kA, kC)}:${Math.max(kA, kC)}`;
    let L = this.links2.get(key);
    const fresh = !L;
    if (!L) { L = { a: kA, c: kC, mA, mC, born: this.time, seen: this.time, plank: -1, plankK: 0, u: rnd(0.4), crewA: eA.crew, crewC: eC.crew }; this.links2.set(key, L); this.act(mA, 'board', 1.2); this.act(mC, 'board', 1.2); }
    L.seen = this.time; L.speed = speed;
    const lostA = Math.max(0, (L.crewA ?? eA.crew) - eA.crew), lostC = Math.max(0, (L.crewC ?? eC.crew) - eC.crew);
    L.crewA = eA.crew; L.crewC = eC.crew;
    if (fresh) return;
    // boarders go over from the hull with more hands; those that fall are the ones each side lost
    const atkA = (eA.crew || 0) >= (eC.crew || 0) || eC.fort;
    const [mF, mT, eF, eT, lostF, lostT] = atkA ? [mA, mC, eA, eC, lostA, lostC] : [mC, mA, eC, eA, lostC, lostA];
    const DF = this.dims(mF, eF), DT = this.dims(mT, eT), cF = this.side(eF), cT = this.side(eT);
    const n = Math.min(4, 1 + Math.floor(R() * 3) + (lostT > 2 ? 1 : 0));
    let fl = Math.min(n, lostF), tl = Math.min(n, lostT);
    for (let k = 0; k < n; k++) {
      const u = rnd(0.7);
      const pa = this.railToward(mF, DF, mT.position, u, new THREE.Vector3()), pb = this.railToward(mT, DT, mF.position, u * 0.8, new THREE.Vector3());
      const style = L.plank >= 0 && L.plankK >= 1 && k === 0 ? 'plank' : R() < 0.45 ? 'swing' : 'leap';
      const lose = fl > 0 && R() < 0.6; if (lose) fl--;
      const foeLose = !lose && tl > 0; if (foeLose) tl--;
      this.boarder(mF, pa, mT, pb, cF, { style, delay: k * 0.18 + R() * 0.2, dur: style === 'swing' ? 0.95 : style === 'plank' ? 1.1 : 0.7, fight: 0.6 + R() * 0.6, lose, foeColor: cT, foeLose });
    }
  }
  side(e) { return this.colors ? this.colors[e.side] : 0xcccccc; }
  /** each frame: the grapnel lines and plank of every boarding fight still going */
  boardLinks(b, models, speed = 1) {
    for (const [key, L] of this.links2) {
      if (key[0] !== 'b') continue;
      const ea = b.ents[L.a], ec = b.ents[L.c], ma = models[L.a], mc = models[L.c];
      const stale = this.time - L.seen > 2.6 / Math.max(0.25, speed);
      if (!ea || !ec || !ea.alive || !ec.alive || stale || !ma || !mc) { this.planks.release(L.plank); this.links2.delete(key); continue; }
      const Da = this.dims(ma, ea), Dc = this.dims(mc, ec), age = this.time - L.born;
      for (let k = 0; k < 3; k++) {
        const u = L.u + (k - 1) * 0.5;
        this.railToward(ma, Da, mc.position, u, _c); toWorld(ma, _c.x, _c.y, _c.z, _a);
        this.railToward(mc, Dc, ma.position, u * 0.8, _c); toWorld(mc, _c.x, _c.y, _c.z, _b);
        const th = Math.min(1, Math.max(0, (age - k * 0.15) / 0.45));
        if (th <= 0) continue;
        if (th < 1) { _b.lerpVectors(_a, _b, th); _b.y += Math.sin(th * Math.PI) * 1.1; }
        this.lay(this.rope(`bl${k}:${key}`, 'rope', 7), _a, _b, th < 1 ? 0.25 : Math.max(0.04, 0.3 - (age - 0.6) * 0.5), 0xc8b48a, 0.018);
      }
      // the boarding plank comes down across the gap on its hinge
      if (ea.fort || ec.fort) continue;
      if (L.plank < 0 && age > 0.7) { L.plank = this.planks.alloc(); this.planks.tint(L.plank, 0x8a6a44); }
      if (L.plank >= 0) {
        L.plankK = Math.min(1, (age - 0.7) / 0.6);
        this.railToward(ma, Da, mc.position, L.u * 0.5, _c); toWorld(ma, _c.x, _c.y + 0.05, _c.z, _a);
        this.railToward(mc, Dc, ma.position, L.u * 0.4, _c); toWorld(mc, _c.x, _c.y + 0.05, _c.z, _b);
        _d.subVectors(_b, _a); const len = _d.length() + 0.3;
        const k = L.plankK, ease = k * k, elev = Math.atan2(_d.y, Math.hypot(_d.x, _d.z));
        // from upright at her rail to lying across the gap, with a bounce as it lands
        _e.set(-lerp(Math.PI / 2, elev, ease) - (k < 1 ? 0 : Math.max(0, 0.06 - (age - 1.3) * 0.2) * Math.sin(age * 30)), Math.atan2(_d.x, _d.z), 0, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(0, 0, len / 2).applyQuaternion(_q).add(_a);
        this.planks.put(L.plank, _p, _q, 0.34, 0.05, len);
        if (k >= 1 && !L.landed) { L.landed = true; this.emit(P.CHIP, _b.x, _b.y, _b.z, 4, 0, 1, 0, 2); this.emit(P.DUST, _b.x, _b.y, _b.z, 2, 0, 1, 0, 0.5, 0.5, 0xb8a888, 0xd8ccb8); }
      }
    }
  }
}
