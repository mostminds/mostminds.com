// What a fleet's working ships carry on deck, so each role reads at a glance:
//   siege     squat mortars amidships with shells stacked beside them
//   carrier   a flight deck over the stern on trestles, with fliers parked on it
//   flak      twin mounts of many-barrelled guns pointing at the sky
//   hunter    a harpoon gun in the bow with its coil of line, barrels astern
//   troop     stores amidships, a tall command banner, a lantern for the aura
//   landing   a hinged ramp at the bow
//   line      a bronze ram at the waterline when she has one
// and squadrons: three small fliers flying together, each with its rider (see fliers.js for the styles).
import * as THREE from 'three';
import { mat } from './models.js';
import { makeFlier, animateFlier } from './fliers.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (a, b, h, n = 8) => new THREE.CylinderGeometry(a, b, h, n);
function put(g, geo, color, x, y, z, opts) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.position.set(x, y, z); m.castShadow = true; m.userData.noCrew = true; g.add(m);
  return m;
}

/** fits a ship model out for her role; returns footprints [x, z, r] where no hand should stand */
export function dressRole(m, def, sideColor, deckY) {
  const L = def.len, B = def.beam, y = deckY, g = new THREE.Group(), keep = [];
  g.userData.noCrew = true;
  switch (def.role) {
    case 'siege': {
      for (const s of [-1, 1]) {
        const x = s * L * 0.13;
        put(g, cyl(B * 0.2, B * 0.22, 0.25, 10), 0x5a4a3a, x, y + 0.12, 0);
        const tube = put(g, cyl(B * 0.13, B * 0.16, B * 0.36, 10), 0x2a2a2a, x, y + 0.36, 0);
        tube.rotation.z = -0.35 * s;
        keep.push([x, 0, B * 0.28]);
      }
      for (let k = 0; k < 5; k++) put(g, new THREE.SphereGeometry(0.11, 6, 4), 0x222222, (k % 3 - 1) * 0.22, y + 0.1 + (k > 2 ? 0.17 : 0), B * 0.28);
      break;
    }
    case 'carrier': {
      const fx = -L * 0.18, fl = L * 0.5, fw = B * 0.95, fy = y + 1.25;
      put(g, box(fl, 0.08, fw), 0x8a6a44, fx, fy, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(g, box(0.1, 1.25, 0.1), 0x4a3220, fx + sx * fl * 0.42, y + 0.62, sz * fw * 0.4);
      for (const sz of [-1, 1]) put(g, box(fl, 0.05, 0.04), 0xe8e0c8, fx, fy + 0.05, sz * fw * 0.48); // deck edge stripes
      const style = def.squadrons?.flier || 'glider';
      for (let k = 0; k < 2; k++) {
        const a = buildFlier(style, sideColor, def.squadrons?.color);
        a.scale.setScalar(1.5); a.position.set(fx - fl * 0.28 + k * fl * 0.5, fy + 0.12, (k ? -1 : 1) * fw * 0.18);
        a.traverse((o) => { o.userData.noCrew = true; }); g.add(a);
      }
      break;
    }
    case 'flak': {
      for (const s of [-1, 1]) {
        const x = s * L * 0.2;
        put(g, cyl(B * 0.2, B * 0.24, 0.22, 8), 0x3a3a3a, x, y + 0.11, 0);
        for (let k = 0; k < 4; k++) {
          const bar = put(g, cyl(0.035, 0.035, 0.8, 5), 0x1a1a1a, x + (k % 2 - 0.5) * 0.12, y + 0.55, (k > 1 ? 1 : -1) * 0.07);
          bar.rotation.z = -0.5 * s;
        }
        keep.push([x, 0, B * 0.26]);
      }
      break;
    }
    case 'hunter': {
      const x = L * 0.36;
      put(g, cyl(0.12, 0.16, 0.3, 6), 0x4a3220, x, y + 0.15, 0);
      const gun = put(g, cyl(0.06, 0.07, 0.9, 6), 0x5a5a5a, x + 0.15, y + 0.4, 0);
      gun.rotation.z = -Math.PI / 2 + 0.25;
      put(g, cyl(0.02, 0.02, 0.5, 3), 0x9a8a6a, x + 0.62, y + 0.5, 0).rotation.z = -Math.PI / 2 + 0.25; // the harpoon itself
      put(g, new THREE.TorusGeometry(0.2, 0.06, 5, 10), 0xc8b88a, x - 0.4, y + 0.06, 0).rotation.x = Math.PI / 2; // coiled line
      keep.push([x, 0, 0.45]);
      for (let k = 0; k < 2; k++) put(g, cyl(0.15, 0.15, 0.32, 8), 0x6b4a2e, -L * 0.36, y + 0.16, (k - 0.5) * 0.36); // fire barrels astern
      break;
    }
    case 'troop': {
      for (let k = 0; k < 6; k++) put(g, box(0.38, 0.32, 0.38), k % 2 ? 0x8a6a44 : 0x6b4a2e, -L * 0.05 + (k % 3 - 1) * 0.42, y + 0.16 + (k > 2 ? 0.32 : 0), B * 0.22);
      for (let k = 0; k < 3; k++) put(g, cyl(0.15, 0.15, 0.34, 8), 0x5a3a24, -L * 0.05 + (k - 1) * 0.36, y + 0.17, -B * 0.24);
      const mh = 1.6 + L * 0.42;
      put(g, cyl(0.04, 0.04, mh, 5), 0x4a3220, -L * 0.42, y + mh / 2, 0);
      const flag = put(g, box(0.9, 0.55, 0.03), sideColor, -L * 0.42 - 0.46, y + mh - 0.3, 0, { side: THREE.DoubleSide });
      g.userData.flag = flag;
      // the aura: a soft glowing lantern at the stern
      const lamp = put(g, new THREE.SphereGeometry(0.16, 8, 6), 0xffe08a, -L * 0.38, y + 0.9, 0);
      lamp.material = new THREE.MeshBasicMaterial({ color: 0xffe08a });
      keep.push([-L * 0.05, B * 0.22, 0.7], [-L * 0.05, -B * 0.24, 0.6]);
      break;
    }
    case 'landing': {
      const ramp = put(g, box(0.1, B * 0.55, B * 0.7), 0x6b4a2e, L * 0.46, y + B * 0.2, 0);
      ramp.rotation.z = -0.35;
      break;
    }
    default:
      if (def.ram) {
        const r = put(g, new THREE.ConeGeometry(B * 0.14, L * 0.12, 6), 0xb08a3a, L * 0.5 + L * 0.04, -B * 0.05, 0, { metalness: 0.6 });
        r.rotation.z = -Math.PI / 2;
      }
  }
  m.add(g);
  return keep;
}

/** a winged beast for realms that tame rather than build their fliers: a scaly wyvern with a rider */
function buildBeastFlier(sideColor, color) { return makeFlier('beast', sideColor, color); }

/** one flier of a carrier's style (glider gyro beast bird bat pegasus griffon dragon carpet disc insect kite),
 *  ridden by a figure in the side's colour; color tints its body and wings when given */
export function buildFlier(style, sideColor, color) {
  if (style === 'beast') return buildBeastFlier(sideColor, color);
  return makeFlier(style, sideColor, color);
}

/** a squadron in the air: three fliers in a loose vee */
export function buildSquadron(def, sideColor) {
  const g = new THREE.Group(), style = def.flier || 'glider';
  const slots = [[0.8, 0], [-0.7, 1.55], [-0.7, -1.55]];
  g.userData.fliers = slots.map(([x, z], i) => {
    const f = buildFlier(style, sideColor, def.color);
    f.scale.setScalar(1.5); f.position.set(x, i * 0.15, z); g.add(f);
    return f;
  });
  g.userData.top = 1.2;
  return g;
}

export function animateSquadron(m, t, phase, alive = 3) {
  m.userData.fliers.forEach((f, i) => {
    f.visible = i < alive;
    f.position.y = i * 0.15 + Math.sin(t * 2.2 + phase + i) * 0.12;
    f.rotation.x = Math.sin(t * 1.3 + phase + i * 2) * 0.06; // each rocks a little on its own
    animateFlier(f, t, phase + i * 1.9);
  });
}
