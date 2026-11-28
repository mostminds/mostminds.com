import { realmAirships, realmBehemoths } from './realms.js';
// War zeppelins: one per faction. They fly above the battle, fire broadsides, drop bombs,
// launch aircraft from a stern hangar, drop pods of shock troops and lower ladders to lift
// hard-pressed troops out of a fight. Each needs a crew: without one it drifts, and enemy
// fliers that kill the crew take the ship.
//   hull: hit points      crew: hands aboard (they also fight boarders)   marines: boarding skill
//   cannons: { perSide, dmg: [min, max], range, reload, acc }    bombs: { maxHit, radius, reload }
//   hangar: { unit, count, every }     pods: { unit, pods, perPod }     ladders: { capacity, every }
const ship = (o) => ({ len: 10, speed: 0.5, turn: 14, armour: 30, altitude: 5.6, level: 85, ...o });

export const AIRSHIPS = {
  kingdomZeppelin: ship({ name: 'Royal Zeppelin', faction: 'kingdom', style: 'kingdom', color: 0x7a5230, envelope: 0xd8c8a0, hull: 900, crew: 14, marines: 1.1,
    cannons: { perSide: 4, dmg: [8, 26], range: 10, reload: 7, acc: 0.6 }, bombs: { maxHit: 34, radius: 2, reload: 9 },
    hangar: { unit: 'gyrocopter', count: 6, every: 26 }, pods: { unit: 'knight', pods: 4, perPod: 3 }, ladders: { capacity: 8, every: 60 } }),
  goblinZeppelin: ship({ name: 'Scrap Blimp', faction: 'goblin', style: 'goblin', color: 0x5a4630, envelope: 0x8a7a4a, hull: 620, crew: 18, marines: 0.8, speed: 0.58, armour: 12, len: 9,
    cannons: { perSide: 3, dmg: [6, 22], range: 8, reload: 6, acc: 0.45 }, bombs: { maxHit: 40, radius: 2, reload: 6 },
    hangar: { unit: 'glider', count: 10, every: 16 }, pods: { unit: 'hobgoblin', pods: 4, perPod: 4 }, ladders: { capacity: 10, every: 50 } }),
  undeadZeppelin: ship({ name: 'Bone Dirigible', faction: 'undead', style: 'undead', color: 0x2a2630, envelope: 0x8a8a78, hull: 780, crew: 12, marines: 1.0, armour: 20,
    cannons: { perSide: 3, dmg: [8, 24], range: 9, reload: 7, acc: 0.55 }, bombs: { maxHit: 30, radius: 2, reload: 8 },
    hangar: { unit: 'bat', count: 12, every: 14 }, pods: { unit: 'ghoul', pods: 4, perPod: 4 }, ladders: { capacity: 8, every: 60 } }),
  infernalZeppelin: ship({ name: 'Brimstone Ark', faction: 'infernal', style: 'infernal', color: 0x2a1a1a, envelope: 0x3a2020, hull: 1100, crew: 10, marines: 1.5, speed: 0.44, armour: 45, len: 11,
    cannons: { perSide: 4, dmg: [10, 30], range: 9, reload: 8, acc: 0.55 }, bombs: { maxHit: 46, radius: 2, reload: 10 },
    hangar: { unit: 'imp', count: 12, every: 14 }, pods: { unit: 'pitFiend', pods: 3, perPod: 1 }, ladders: { capacity: 6, every: 70 } }),
  beastsZeppelin: ship({ name: 'Hide Balloon', faction: 'beasts', style: 'beasts', color: 0x6b4a2e, envelope: 0xb89a6a, hull: 700, crew: 10, marines: 1.3, armour: 10, len: 9,
    cannons: { perSide: 2, dmg: [8, 24], range: 7, reload: 7, acc: 0.45 }, bombs: { maxHit: 38, radius: 2, reload: 7 },
    hangar: { unit: 'harpy', count: 8, every: 18 }, pods: { unit: 'minotaur', pods: 3, perPod: 1 }, ladders: { capacity: 6, every: 60 } }),
  elementalZeppelin: ship({ name: 'Rune Skyship', faction: 'elemental', style: 'elemental', color: 0x7a7a82, envelope: 0x6a8aa8, hull: 1000, crew: 8, marines: 1.2, speed: 0.46, armour: 50,
    cannons: { perSide: 3, dmg: [10, 28], range: 11, reload: 8, acc: 0.65 }, bombs: { maxHit: 32, radius: 2, reload: 10 },
    hangar: { unit: 'gargoyle', count: 4, every: 30 }, pods: { unit: 'golem', pods: 2, perPod: 1 }, ladders: { capacity: 6, every: 70 } }),
  dragonsZeppelin: ship({ name: 'Drake Carrier', faction: 'dragons', style: 'dragons', color: 0x5a2a22, envelope: 0x8a3a2a, hull: 950, crew: 10, marines: 1.2, armour: 35, len: 11,
    cannons: { perSide: 3, dmg: [10, 30], range: 9, reload: 8, acc: 0.55 }, bombs: { maxHit: 44, radius: 2, reload: 9 },
    hangar: { unit: 'wyrmling', count: 3, every: 40 }, pods: { unit: 'cyclops', pods: 2, perPod: 1 }, ladders: { capacity: 6, every: 70 } }),
};
Object.assign(AIRSHIPS, realmAirships(ship)); // see realms.js
// every air wing's colossal sky-behemoth, `${faction}Behemoth` (behemoth: true; its abilities run in src/engine/behemoth.js)
Object.assign(AIRSHIPS, realmBehemoths(ship));
for (const [id, a] of Object.entries(AIRSHIPS)) a.id = id;
