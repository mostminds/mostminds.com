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
export const STRUCT = buildings.structures;
export const rubble = buildings.rubble;
export const SIEGE = siegeMod.siege;
export const craft = siegeMod.craft;
export const ship = ships.ship;
export const CREATURES = sea.creatures;
export const CREATURE_ANIM = sea.animators || {};
for (const m of [humanoid, undead, beasts, monsters]) if (m.animators) registerAnimators(m.animators);
