// Shared Three.js stage: renderer, camera, controls, lights and pooled FX.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Stage {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fb8c8);
    this.scene.fog = new THREE.Fog(0x9fb8c8, 80, 220);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.screenSpacePanning = false;
    const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x5a4a30, 0.9);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    this.sun = sun;
    this.scene.add(hemi, sun, sun.target);
    this.fx = [];
    this.splatTex = new Map();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }
  setBounds(w, h) {
    const s = Math.max(w, h);
    const cam = this.sun.shadow.camera;
    cam.left = -s * 0.75; cam.right = s * 0.75; cam.top = s * 0.75; cam.bottom = -s * 0.75; cam.far = s * 4;
    cam.updateProjectionMatrix();
    this.sun.position.set(w / 2 - s * 0.4, s * 1.2, h / 2 + s * 0.5);
    this.sun.target.position.set(w / 2, 0, h / 2);
    this.controls.target.set(w / 2, 0, h / 2);
    this.camera.position.set(w * 0.3, s * 0.42, h / 2 + s * 0.62);
    this.controls.maxDistance = s * 2.2;
    this.scene.fog.near = s * 1.2; this.scene.fog.far = s * 3.5;
  }
  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  clear(group) { while (group.children.length) group.remove(group.children[0]); }

  // ---- hitsplats: damage numbers in a coloured badge ----
  splat(pos, dmg, kind = 'hit') {
    const key = `${kind}:${dmg}`;
    let tex = this.splatTex.get(key);
    if (!tex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = kind === 'heal' ? '#2f8f3a' : kind === 'poison' ? '#3a7a2a' : dmg > 0 ? '#b3261e' : '#2f5aa8';
      x.beginPath(); x.arc(32, 32, 26, 0, Math.PI * 2); x.fill();
      x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,.55)'; x.stroke();
      x.fillStyle = '#fff'; x.font = 'bold 30px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(dmg), 32, 34);
      tex = new THREE.CanvasTexture(c); this.splatTex.set(key, tex);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.position.copy(pos);
    s.scale.setScalar(0.55);
    s.renderOrder = 10;
    this.scene.add(s);
    this.fx.push({ obj: s, t: 0, life: 1.0, update: (f, dt) => { f.obj.position.y += dt * 0.4; f.obj.material.opacity = 1 - Math.max(0, f.t - 0.6) / 0.4; } });
  }

  projectile(from, to, kind, duration, arc = 0.6) {
    const colors = { fire: 0xff7a1a, ice: 0x9fe0ff, shadow: 0x6a3aa0, poison: 0x6ad040, holy: 0xfff0a0, magic: 0x8ab4ff };
    let obj;
    if (kind === 'arrow' || kind === 'bolt' || kind === 'ranged') {
      obj = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 3), new THREE.MeshBasicMaterial({ color: 0x3a2a1a }));
      obj.geometry.rotateX(Math.PI / 2);
    } else if (kind === 'rock' || kind === 'cannon' || kind === 'musket') {
      obj = new THREE.Mesh(new THREE.SphereGeometry(kind === 'musket' ? 0.06 : 0.14, 6, 4), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    } else {
      obj = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: colors[kind] || colors.magic }));
    }
    this.scene.add(obj);
    const a = from.clone(), b = to.clone();
    const prev = new THREE.Vector3();
    this.fx.push({
      obj, t: 0, life: Math.max(0.15, duration),
      update: (f) => {
        const k = Math.min(1, f.t / f.life);
        prev.copy(f.obj.position);
        f.obj.position.lerpVectors(a, b, k);
        f.obj.position.y += Math.sin(k * Math.PI) * arc * a.distanceTo(b) * 0.15;
        if (k > 0.02) f.obj.lookAt(prev.lerp(f.obj.position, 2));
        else f.obj.lookAt(b);
      },
    });
  }

  ring(pos, radius, color, life = 0.6) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.3, 24), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y += 0.05;
    this.scene.add(m);
    this.fx.push({ obj: m, t: 0, life, update: (f) => { const k = f.t / f.life; f.obj.scale.setScalar(1 + k * radius * 3.5); f.obj.material.opacity = 1 - k; } });
  }

  puff(pos, color = 0xdddddd, size = 0.5, life = 1) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    m.position.copy(pos);
    this.scene.add(m);
    this.fx.push({ obj: m, t: 0, life, update: (f, dt) => { const k = f.t / f.life; f.obj.scale.setScalar(1 + k * 1.5); f.obj.position.y += dt * 0.6; f.obj.material.opacity = 0.8 * (1 - k); } });
  }

  updateFx(dt) {
    for (const f of this.fx) { f.t += dt; f.update(f, dt); }
    const dead = this.fx.filter((f) => f.t >= f.life);
    for (const f of dead) { this.scene.remove(f.obj); f.obj.geometry?.dispose?.(); if (f.obj.material && !f.obj.material.map) f.obj.material.dispose(); }
    this.fx = this.fx.filter((f) => f.t < f.life);
  }
  clearFx() { for (const f of this.fx) this.scene.remove(f.obj); this.fx = []; }
  render() { this.controls.update(); this.renderer.render(this.scene, this.camera); }
}

// Health bar: two sprites (background + fill) in a group
const barBg = new THREE.SpriteMaterial({ color: 0x5a0d0d, depthTest: false });
const barMats = new Map();
export function makeBar(color) {
  if (!barMats.has(color)) barMats.set(color, new THREE.SpriteMaterial({ color, depthTest: false }));
  const g = new THREE.Group();
  const bg = new THREE.Sprite(barBg), fg = new THREE.Sprite(barMats.get(color));
  bg.center.set(0, 0.5); fg.center.set(0, 0.5);
  bg.scale.set(0.7, 0.08, 1); fg.scale.set(0.7, 0.08, 1);
  bg.position.x = -0.35; fg.position.x = -0.35;
  bg.renderOrder = 8; fg.renderOrder = 9;
  g.add(bg, fg);
  g.userData.fg = fg; g.userData.w = 0.7;
  return g;
}
export function setBar(bar, ratio, width) {
  const w = width || bar.userData.w;
  bar.children[0].scale.x = w; bar.children[0].position.x = -w / 2;
  bar.userData.fg.scale.x = Math.max(0.001, w * ratio); bar.userData.fg.position.x = -w / 2;
}
