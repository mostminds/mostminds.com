// One place that gathers every model family.
import * as humanoid from './bodies/humanoid.js';
import * as undead from './bodies/undead.js';
import * as beasts from './bodies/beasts.js';
import * as monsters from './bodies/monsters.js';
import * as buildings from './props/buildings.js';
import * as siegeMod from './props/siege.js';
import * as ships from './props/ships.js';
import * as sea from './props/seacreatures.js';
import { registerAnimators } from './animate.js';
import { exampleBody } from './bodies/_example.js';

export const BODIES = { example: exampleBody, ...humanoid.bodies, ...undead.bodies, ...beasts.bodies, ...monsters.bodies };
// great beasts and war machines of the realms: each file is optional, and a unit whose body is not
// there yet is drawn with the stand-in its descriptor names (see models.js standIn)
const laterBodies = [];
for (const f of ['titans', 'machines', 'chaosbeasts', 'chaosbeasts2', 'fringefolk', 'fringebeasts']) {
  try { const m = await import(`./bodies/${f}.js`); Object.assign(BODIES, m.bodies || {}); laterBodies.push(m); }
  catch (err) { console.info(`${f} models not available yet; stand-ins are used`, err?.message || err); }
}
// airships, aircraft, drop pods and the buildings that serve them
let air = {};
try { air = await import('./props/airships.js'); } catch (err) { console.warn('[models] airship models unavailable, using simple shapes', err); }
export const AIR = air;
// civic buildings, terraces, walkways, bridges, viaducts and cable cars
let civic = {};
try { civic = await import('./props/civic.js'); } catch (err) { console.info('civic building models not available yet; simple shapes stand in', err?.message || err); }
export const CIVIC = civic;
// each faction's own buildings, and the restyling that gives every other building that faction's look
let fac = {};
try { fac = await import('./props/factions.js'); } catch (err) { console.info('faction building styles not available yet', err?.message || err); }
export const FACTION = fac;
export const STRUCT = { ...buildings.structures, ...(air.structures || {}), ...(civic.structures || {}), ...(fac.structures || {}) };
// the realms' own landmark buildings, in three optional files
for (const f of ['realmsOrder', 'realmsRuin', 'realmsFar', 'realmsChaos', 'realmsFringe']) {
  try { const m = await import(`./props/${f}.js`); Object.assign(STRUCT, m.structures || {}); }
  catch (err) { console.info(`${f} buildings not available yet`, err?.message || err); }
}
export const rubble = buildings.rubble;
export const SIEGE = siegeMod.siege;
export const craft = siegeMod.craft;
export const ship = ships.ship;
export const CREATURES = { ...sea.creatures };
export const CREATURE_ANIM = { ...(sea.animators || {}) };
// beasts of the ancient seas (optional until sculpted: a creature without a model is drawn as its nearest kin)
try { const m = await import('./props/ancientseas.js'); Object.assign(CREATURES, m.creatures || {}); Object.assign(CREATURE_ANIM, m.animators || {}); }
catch (err) { console.info('ancient sea creatures not available yet', err?.message || err); }
// the great beasts the newer realms bring to sea (optional until sculpted)
for (const f of ['realmseas', 'realmseas2']) {
  try { const m = await import(`./props/${f}.js`); Object.assign(CREATURES, m.creatures || {}); Object.assign(CREATURE_ANIM, m.animators || {}); }
  catch (err) { console.info(`${f} creatures not available yet`, err?.message || err); }
}
// the frozen sea: its hunters, and the ice and penguins that dress it (optional until sculpted)
let arctic = {};
try { arctic = await import('./props/arctic.js'); Object.assign(CREATURES, arctic.creatures || {}); Object.assign(CREATURE_ANIM, arctic.animators || {}); }
catch (err) { console.info('arctic sea models not available yet', err?.message || err); }
export const ARCTIC = arctic;
// island scenery for the other seas: the jungle village and its life, and the temperate, desert, swamp and volcanic sets
const sets = [arctic];
for (const f of ['jungleset', 'seascapes']) {
  try { sets.push(await import(`./props/${f}.js`)); }
  catch (err) { console.info(`${f} scenery not available yet`, err?.message || err); }
}
/** every scenery builder, and one call that animates whatever piece it is given */
export const SCENERY = Object.assign({}, ...sets.map((m) => m.scenery || {}));
export function animateScenery(obj, t) { for (const m of sets) if (m.animateScenery) m.animateScenery(obj, t); }
for (const m of [humanoid, undead, beasts, monsters, ...laterBodies]) if (m.animators) registerAnimators(m.animators);
