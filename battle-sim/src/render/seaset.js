// Dressing for sea battles: what each kind of sea looks like and what stands, grows and lives on
// its islands. The pieces come from the scenery modules (arctic.js, jungleset.js, seascapes.js); a
// piece that is not there yet is simply left out.
import * as THREE from 'three';

export const SEA_LOOK = {
  temperate: { sea: 0x2a6f96, sky: 0xb4cddb, sand: 0xcdb57a, top: 0x4f7a3a },
  arctic:    { sea: 0x2f6078, sky: 0xd6e2ea, sand: 0x8a9098, top: 0xf4f8fc },
  desert:    { sea: 0x2f8f9a, sky: 0xe6d8b0, sand: 0xe0c88a, top: 0xd4b070 },
  swamp:     { sea: 0x3a5a48, sky: 0x9aa890, sand: 0x5a5236, top: 0x3a4a26 },
  volcanic:  { sea: 0x2a4452, sky: 0x8a6e62, sand: 0x3a3432, top: 0x2a2626 },
  jungle:    { sea: 0x1f8a8f, sky: 0xa8d4c4, sand: 0xe6d49a, top: 0x2a7a2a },
};

// how high the ground is at distance d from an island's centre (the mound the view draws)
export const DOME = 0.2;
export const islandY = (isl, d) => (d < isl.r * 0.72 ? 0.68 + DOME * Math.sqrt((isl.r * 0.72) ** 2 - d * d) : d < isl.r ? 0.7 : 0);

// What goes on an ordinary island of each sea: [key, how many for an island of radius 6, zone, scale range]
//   zones: in (the middle), mid (most of the top), rim (the beach), shore (the shallows round it), air (over it)
const PLAN = {
  temperate: [['oak', 4, 'mid', [0.8, 1.2]], ['pineStand', 3, 'mid', [0.8, 1.2]], ['wildflowers', 4, 'mid', [0.9, 1.3]], ['stoneWall', 2, 'mid', [1, 1]], ['deer', 0.7, 'mid', [1, 1.2]],
    ['sheepFlock', 0.8, 'mid', [1, 1.2]], ['haystacks', 0.6, 'mid', [1, 1.1]], ['gullFlock', 1, 'air', [1, 1.4]], ['rowboat', 1, 'rim', [1, 1.1]], ['fishingHut', 0.7, 'rim', [1, 1.1]], ['cottage', 0.8, 'mid', [1, 1.1]]],
  desert: [['datePalm', 4, 'mid', [0.8, 1.2]], ['saguaro', 3, 'mid', [0.8, 1.3]], ['dune', 2, 'mid', [0.8, 1.2]], ['rockArch', 0.5, 'mid', [0.9, 1.3]], ['ruinColumns', 0.6, 'in', [0.9, 1.2]], ['nomadTent', 0.8, 'mid', [1, 1.1]],
    ['camelGroup', 0.7, 'mid', [1, 1.1]], ['vultureFlock', 0.8, 'air', [1, 1.3]], ['watchRuin', 0.4, 'rim', [1, 1.1]], ['wreck', 0.5, 'rim', [0.9, 1.2]], ['scorpion', 1.2, 'mid', [1, 1.6]], ['lizard', 1.2, 'rim', [1, 1.5]], ['oasisPool', 0.5, 'in', [1, 1.3]]],
  swamp: [['cypress', 5, 'mid', [0.8, 1.2]], ['cypress', 3, 'shore', [0.8, 1.1]], ['reedBed', 5, 'rim', [0.9, 1.3]], ['reedBed', 3, 'shore', [0.9, 1.2]], ['deadTree', 2, 'mid', [0.8, 1.2]], ['bogMound', 1.5, 'mid', [0.9, 1.3]],
    ['stiltShack', 0.8, 'rim', [1, 1.1]], ['heronGroup', 1, 'shore', [1, 1.3]], ['alligator', 1.4, 'shore', [1, 1.3]], ['lilyPatch', 3, 'shore', [1, 1.5]], ['punt', 0.7, 'shore', [1, 1.1]], ['fireflies', 0.6, 'mid', [1, 1.4]], ['giantToad', 1.2, 'rim', [1, 1.5]]],
  volcanic: [['basaltColumns', 3, 'mid', [0.8, 1.4]], ['charredTree', 4, 'mid', [0.8, 1.2]], ['obsidianSpire', 3, 'mid', [0.8, 1.4]], ['smokeVent', 1.5, 'mid', [1, 1.4]], ['ashDune', 2, 'mid', [0.9, 1.3]], ['ashRuin', 0.6, 'mid', [1, 1.1]],
    ['fireLizard', 1.5, 'rim', [1, 1.6]], ['emberBats', 0.8, 'air', [1, 1.3]]],
  jungle: [['coconutPalm', 6, 'rim', [0.8, 1.2]], ['coconutPalm', 3, 'mid', [0.9, 1.2]], ['bananaTree', 4, 'mid', [0.9, 1.3]], ['banyan', 0.8, 'in', [0.8, 1.1]], ['bambooThicket', 2.5, 'mid', [0.9, 1.2]], ['fernClump', 6, 'mid', [0.9, 1.5]],
    ['elephantEar', 4, 'mid', [0.9, 1.4]], ['bromeliad', 4, 'mid', [1, 1.5]], ['mossLog', 1.5, 'mid', [0.9, 1.2]], ['mangrove', 5, 'shore', [0.8, 1.2]], ['crocodile', 1.5, 'shore', [1, 1.3]], ['macaw', 2, 'mid', [1.4, 2]],
    ['monkey', 1.5, 'mid', [1.3, 1.8]], ['treeFrog', 1.5, 'mid', [1.4, 2]], ['dartFrog', 1.5, 'mid', [1.5, 2.2]], ['treeSnake', 1, 'mid', [1, 1.3]], ['giantSpider', 0.8, 'mid', [1, 1.4]], ['boar', 1, 'mid', [1, 1.3]], ['canoe', 1, 'rim', [1, 1.1]]],
};
// The settled island of each sea: pieces set out round its middle. [key, x, z (in island radii), turn (radians), scale]
const SETTLEMENT = {
  // the hall stands back from the middle with open ground before its porch; the market and cook fire flank the way up from the gate
  jungle: [['tribalHall', 0, -0.22, 0, 1], ['market', 0.46, 0.34, 0.3, 0.85], ['shamanHut', -0.62, -0.3, 0.8, 1], ['cookhouse', -0.44, 0.36, -0.4, 1], ['barracks', -0.02, -0.66, 0, 0.85], ['boarPen', 0.6, -0.24, 0, 0.85],
    ['watchTower', 0.7, 0.1, 0, 1], ['watchTower', -0.4, -0.62, 0, 1], ['watchTower', -0.7, 0.14, 0, 1], ['gatehouse', 0, 0.72, 0, 0.9], ['fetishPole', 0.2, 0.34, 0, 1.2], ['fetishPole', -0.2, 0.34, 0, 1.2],
    ['boardwalk', 0, 1.04, Math.PI / 2, 1], ['boardwalk', 0, 1.3, Math.PI / 2, 1], ['canoe', 0.26, 0.92, 0.6, 1], ['canoe', -0.28, 0.92, -0.5, 1]],
  temperate: [['lighthouse', 0.62, -0.5, 0, 1], ['windmill', -0.3, -0.3, 0.5, 1], ['cottage', 0.1, 0.1, 0.2, 1], ['cottage', -0.2, 0.3, -0.4, 1], ['cottage', 0.36, 0.2, 1.2, 1], ['fishingHut', 0.2, 0.8, 0, 1], ['rowboat', -0.1, 0.9, 0.4, 1],
    ['haystacks', -0.5, 0.05, 0, 1], ['sheepFlock', 0.05, -0.4, 0, 1.1], ['stoneWall', -0.1, -0.15, 0, 1], ['stoneWall', 0.14, -0.15, 0, 1]],
  desert: [['oasisPool', 0, 0, 0, 1.4], ['nomadTent', 0.3, 0.2, 0.4, 1], ['nomadTent', -0.3, 0.25, -0.6, 1], ['nomadTent', 0.05, -0.38, 1.4, 1], ['camelGroup', -0.35, -0.2, 0, 1.1], ['ruinColumns', 0.5, -0.3, 0.2, 1.1], ['watchRuin', -0.6, -0.4, 0, 1.1],
    ['datePalm', 0.16, 0.06, 0, 1.1], ['datePalm', -0.14, 0.1, 0, 1], ['datePalm', 0.04, -0.18, 0, 1.2], ['wreck', 0.2, 0.9, 0.5, 1]],
  swamp: [['stiltShack', 0.1, 0.1, 0.2, 1.1], ['stiltShack', -0.3, 0.2, -0.5, 1], ['stiltShack', 0.35, -0.2, 1, 1], ['stiltShack', 0.1, 1.05, 0, 1], ['punt', -0.2, 1.05, 0.5, 1], ['punt', 0.4, 1.02, -0.4, 1], ['bogMound', -0.1, -0.3, 0, 1.3],
    ['fireflies', 0, 0, 0, 1.6], ['fireflies', 0.3, 0.3, 0, 1.4]],
  volcanic: [['ashRuin', 0.2, 0.2, 0.3, 1.1], ['ashRuin', -0.3, 0.1, -0.5, 1], ['ashRuin', 0, -0.35, 1.1, 1], ['smokeVent', 0.45, -0.3, 0, 1.3], ['basaltColumns', -0.5, -0.35, 0, 1.4], ['obsidianSpire', 0.5, 0.4, 0, 1.4]],
};

function hash(n) { let h = (n * 374761393) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

/** a plain cone with a glowing crater, used when the sculpted volcano is not there */
function plainVolcano() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.ConeGeometry(1, 1.15, 12, 1, true).translate(0, 0.575, 0), new THREE.MeshStandardMaterial({ color: 0x2a2424, roughness: 1, flatShading: true })));
  const lava = new THREE.Mesh(new THREE.CircleGeometry(0.2, 10).rotateX(-Math.PI / 2).translate(0, 1.1, 0), new THREE.MeshBasicMaterial({ color: 0xff6a14 }));
  g.add(lava); g.userData.lava = lava;
  return g;
}

/**
 * Dress the islands of a sea battle. `sc` is the merged scenery map (key -> (seed) => Object3D).
 * Adds everything to `group` and returns { moving: [objects to animate], craters: Map(island index -> THREE.Vector3) }.
 */
export function dressIslands(b, group, sc) {
  const theme = b.theme && PLAN[b.theme] ? b.theme : null, moving = [], craters = new Map();
  if (!theme) return { moving, craters };
  const forts = b.ents.filter((e) => e.fort);
  const clearOfForts = (x, z) => forts.every((f) => Math.hypot(f.x - x, f.y - z) > 2.6);
  const put = (key, x, z, y, turn, scale, seed) => {
    const make = sc[key];
    if (!make) return null;
    let o;
    try { o = make(seed); } catch (err) { console.warn(`[scenery] ${key} failed`, err); return null; }
    if (!o) return null;
    o.position.set(x, y, z); o.rotation.y = turn; o.scale.multiplyScalar(scale);
    group.add(o); moving.push(o);
    return o;
  };
  // the island with a settlement: the biggest that is not a volcano
  const lands = b.islands.map((isl, i) => ({ isl, i })).filter((x) => !x.isl.ice);
  const home = lands.filter((x) => !x.isl.volcano).sort((a, c) => c.isl.r - a.isl.r)[0];
  for (const { isl, i } of lands) {
    const seed = Math.round(isl.x * 13 + isl.y * 7 + i * 101), used = [];
    const free = (x, z, rad) => used.every((u) => Math.hypot(u[0] - x, u[1] - z) > u[2] + rad) && clearOfForts(x, z);
    if (isl.volcano) {
      // the mountain itself, lava running to the sea, and its crater for the eruption to come from
      const s = isl.r * 0.62, cone = (sc.volcanoCone || plainVolcano)(seed);
      cone.position.set(isl.x, 0.6, isl.y); cone.scale.multiplyScalar(s); cone.rotation.y = seed;
      group.add(cone); moving.push(cone);
      const cr = cone.userData.crater; // the sculpted cone says where its crater is
      craters.set(i, new THREE.Vector3(isl.x, 0.6 + (Array.isArray(cr) ? cr[1] + 0.12 : 1.12) * s, isl.y));
      used.push([isl.x, isl.y, s * 0.95]);
      if (sc.lavaFlow) for (let k = 0; k < 3; k++) {
        const a = seed + k * 2.1;
        for (let j = 0; j < 4; j++) { const d = s * 0.85 + j * (isl.r - s * 0.85) / 4 + 0.4; put('lavaFlow', isl.x + Math.cos(a) * d, isl.y + Math.sin(a) * d, islandY(isl, d) + 0.03, -a, (isl.r - s * 0.85) / 4 + 0.1, seed + k * 7 + j); }
      }
    }
    // the settlement
    const settled = home && home.i === i && isl.r >= 6 && SETTLEMENT[theme];
    if (settled) {
      const k = Math.min(1, Math.max(0.55, isl.r / 9));
      SETTLEMENT[theme].forEach(([key, fx, fz, turn, scale], n) => {
        const x = isl.x + fx * isl.r, z = isl.y + fz * isl.r, d = Math.hypot(fx, fz) * isl.r;
        if (!clearOfForts(x, z)) return;
        if (put(key, x, z, islandY(isl, d), turn, scale * k, seed + n)) used.push([x, z, 1.6 * scale * k]);
      });
    }
    // what grows and lives there
    PLAN[theme].forEach(([key, per6, zone, [s0, s1]], li) => {
      if (!sc[key]) return;
      const area = (isl.r * isl.r) / 36, want = per6 * area * (settled && zone !== 'shore' && zone !== 'rim' && zone !== 'air' ? 0.6 : 1);
      const n = Math.floor(want) + (hash(seed + li * 17) < want % 1 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        for (let tries = 0; tries < 6; tries++) {
          const h1 = hash(seed + li * 131 + k * 17 + tries * 7919), h2 = hash(seed + li * 57 + k * 29 + tries * 104729), h3 = hash(seed * 3 + li + k * 11);
          const a = h1 * Math.PI * 2;
          const d = zone === 'in' ? h2 * isl.r * 0.3 : zone === 'mid' ? Math.sqrt(h2) * isl.r * 0.66 : zone === 'rim' ? isl.r * (0.76 + h2 * 0.16) : zone === 'shore' ? isl.r + 0.4 + h2 * 1.6 : Math.sqrt(h2) * isl.r * 0.7;
          const x = isl.x + Math.cos(a) * d, z = isl.y + Math.sin(a) * d, s = s0 + (s1 - s0) * h3;
          const rad = zone === 'air' ? 0 : 0.45 * s + (key === 'banyan' ? 1.6 : 0);
          if (zone !== 'air' && !free(x, z, rad)) continue;
          if (put(key, x, z, zone === 'shore' ? 0 : islandY(isl, d), h3 * Math.PI * 2, s, seed + li * 13 + k)) { if (zone !== 'air') used.push([x, z, rad]); }
          break;
        }
      }
    });
  }
  return { moving, craters };
}
