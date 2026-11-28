// Every faction's air arm: eight kinds of aircraft and one colossal sky-behemoth.
//
// A design file exports `AIRWINGS = { factionId: { transport, bomber, fighter, cas, hunter, naval, assault, escort,
// behemoth } }`, for all 44 realms (src/data/realms.js) and the seven original factions (kingdom, goblin, undead,
// infernal, beasts, elemental, dragons — src/data/worldgen.js). Names are the faction's own and original: no names
// from any commercial setting. `name` never includes the faction adjective (the game adds it).
//
// ---- the eight aircraft (each becomes a flying unit, id `${faction}_air_${role}`) ----
//   transport  drops troops, ammunition and rations at forward rally points; lifts out surrounded troops
//   bomber     high-altitude carpet bombing and heavy drops on fortifications and slow warships
//   fighter    fast dogfighters / flak platforms that shred fliers and intercept bombers
//   cas        close air support: low strafing runs on ground troops (guns, rockets, arrows, breath)
//   hunter     anti-monster: harpoons, slaying lances, venom against dragons, giants and great beasts
//   naval      anti-ship and anti-leviathan: torpedoes, armour-piercing dive bombs, depth charges
//   assault    air-to-land shock: dives into enemy formations, or drops shock troops into them
//   escort     orbits its own airships and behemoth, shoots down missiles and fliers, repels aerial boarders
// Each aircraft entry:
//   name, note           its name and one or two sentences: what it looks like and does
//   tier                 'light' | 'medium' | 'heavy'  (sets size, hit points and price with the role template)
//   count                how many fly together (1..8)
//   model                a unit model spec, as the realm rosters use (see realms.js `mk`):
//       { body: 'rider', mountType, outfit, weapon, ...palette }  a rider on a flying mount
//       { body: 'aircraft', kind, style, ...colours }             a machine or conveyance
//       { body: 'dragon' | 'flier', kind, ...colours }            a great beast flying alone (riderless or with crew)
//     flying mountTypes: griffon hippogriff halfgriffon pegasus longma eagle roc vulture bat wyvern drake phoenix
//       serpent pterosaur fly moth manticore sphinx harpy swan crow wasp beetle gargoyle carpet disc
//     aircraft kinds: gyro gyrobomber glider ornithopter kite balloon dirigible lantern skiff chariot cage pod
//       carpet disc construct spirit swarm
//     colours: skin cloth cloth2 armor trim mount (hex numbers), plus style (a realm id or original faction id
//     whose look to borrow). Omit to use the faction's palette.
//   arts                 1..4 of the role's arts below (numbers are parameters)
//
// Aircraft arts:
//   any role   armour: n   magicWard: x (0..1)   regen: n   terror: true   fireTrail: true   poison: dmg   speed: x (0.7..1.4)
//              breath: 'fire'|'frost'|'acid'|'plague'|'lightning'|'light'|'warp'|'sound'
//   transport  carry: n (troops dropped, 2..12)   troop: unitId (defaults to the faction's line infantry)
//              supply: n (crates per run)   extract: true   heal: n
//   bomber     bombs: n (per run, 1..8)   blast: radius (1..4)   incendiary: true   vsStructure: x (1..3)   vsShip: x
//   fighter    guns: n   vsAir: x (1.2..2.5)   intercept: true   flak: true   dogfight: true
//   cas        strafe: dmg   rockets: n   arrows: true   suppress: true (pinned troops slow down)
//   hunter     vsMonster: x (1.5..3)   harpoon: true   lance: true   pin: ticks   venom: dmg
//   naval      torpedo: dmg   diveBomb: dmg   depthCharge: true   vsShip: x   vsLeviathan: x
//   assault    charge: x (1.2..2.5)   shock: true (knocks troops back)   dropTroops: unitId   dropCount: n
//   escort     orbit: true   pointDefense: true (shoots down missiles/bombs)   vsAir: x   repelBoarders: true
//
// ---- the behemoth (id `${faction}Behemoth`, a colossal airship-class unit) ----
//   name, note
//   form      airship | citadel | island | hulk | pyramid | cathedral | spire | palace | beast | crag
//   look      { hull, trim, glow, envelope? } colours
//   parts     4..12 visual parts: envelopes(n 1..4) gondola decks(n) towers spires domes roosts terraces
//             bells lanterns obelisks mirrors waterfalls roots tree crystals cages chains skulls statues
//             smokestacks turrets cannons rocketRacks drums totems banners vortex mist runes wings
//             (any short noun is allowed; the model builder maps what it knows and ignores the rest)
//   abilities exactly 8, each { kind, name, note, ...params }, kinds from:
//     broadside   { dmg, range }           heavy guns downward at ships, forts and troops
//     beam        { dmg, range }           a focused beam (sun, dragon-fire, warp lightning) that cuts ships and walls
//     barrage     { salvo, dmg, radius }   rocket / mortar / skull / boulder saturation strike
//     bombBay     { dmg, radius }          carpet bombing from opened keel doors
//     meteor      { dmg, radius }          calls down a strike from the sky
//     hangar      { role, max }            launches, repairs and rearms its own aircraft (a role above)
//     dropPods    { unit, count }          drops troops onto a forward rally point
//     teleport    { unit, count }          gates / beams / roots that set troops down at a rally point
//     extraction  { capacity }             lifts surrounded friendly troops to safety
//     supplyDrop  { amount }               drops munitions and rations: resupplies and heals ground troops
//     pointDefense{ dmg, range }           automatic turrets shred fliers and missiles near it
//     snipers     { dmg, range }           picks off fliers, monster riders and captains
//     flares      { penalty }              enemy anti-air is less accurate
//     ward        { reduce, radius }       a dome that softens incoming fire on allies beneath it
//     phase       { chance }               shots may pass through it
//     camouflage  { radius }               allies near it are hard to target from afar
//     aura        { radius, effect: 'courage'|'frenzy'|'vigor'|'reload'|'dispel'|'terror' }
//     heal        { amount, radius }       mends allied troops, hulls and constructs below
//     raise       { radius }               the slain beneath it rise as its own troops
//     cloud       { dmg, radius, kind }    gas, plague, spores, slime or warp-fire raining down
//     sonic       { stun, radius }         a shockwave that stuns crews and shakes walls
//     gale        { push, radius }         winds that throw fliers and airships off course
//     lightning   { dmg, strikes }         bolts at fliers and powder
//     harpoon     { pull }                 hauls a ship, monster or airship into its guns
//     swarm       { dmg, radius }          stinging/biting swarms blind and wear down fliers
//
// Designs live in a.js and b.js; this file merges them.
import { AIRWINGS as A } from './a.js';
import { AIRWINGS as B } from './b.js';

export const AIRWINGS = { ...A, ...B };
export const AIR_ROLES = ['transport', 'bomber', 'fighter', 'cas', 'hunter', 'naval', 'assault', 'escort'];
