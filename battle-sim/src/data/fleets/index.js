// Each realm's own working ships: seven hulls, one per fleet role, with their own names, looks and arts.
//
// A design file exports `DESIGNS = { realmId: { line, hunter, siege, carrier, flak, troop, landing } }`. Every entry:
//   name   the ship's own name, without the realm's adjective (the game adds that):   'Ironfist Frigate'
//   note   one or two sentences on what she does, shown in the ship list
//   base   (line only) the hull she is built on: 'frigate' | 'galleon' | 'manowar' | 'brigantine' | 'cutter'
//   look   { hull, sail, trim } colours (hex numbers); omit to keep the realm's own
//   dress  deck and hull parts to draw, from PARTS below (order does not matter; 2 to 7 is right)
//   arts   her signature abilities, from ARTS below (1 to 3 is right)
//   mul    optional stat multipliers { hull, speed, armour, crew, turn } (keep each within 0.7 .. 1.4)
//   flier  (carrier only) { style, name, color } — style from FLIERS below
//
// PARTS (what is drawn):
//   hull form   catamaran trimaran outriggers raft lowHull boxHull ghost hover
//   sails       noSails lateen junkSails squareSail leafSails silkSails tatteredSails
//   drive       paddles sternWheel oars stacks treadWheel
//   bow         bowGun drill jaws blade ram glacis ramp jawRamp
//               figure:dragon figure:wolf figure:tiger figure:cobra figure:horse figure:scarab figure:swan figure:eagle
//               figure:skull figure:eye figure:boar figure:frog figure:comet figure:fish
//   weapons     turrets ballista repeater harpoonGun winch kegs trebuchet catapult mortarPit bombard rocketRack
//               crystalRing lens organPipes mirrors pumpCannon skullPile
//   buildings   pagoda tower pyramid ziggurat temple obelisk monolith stones tree deadTree nest perches flightDeck pad
//               yurt dome pulpit shrine sarcophagus portal anvil cauldron vats cages corpses barrels crates tables
//               chimneys drums totem braziers lanterns banners shields spikes plates chains skulls gargoyles
//               astrolabe bells pustules vines bones cranes
//   towed beast tow:mosasaur tow:boar tow:turtle tow:mammoth tow:orca tow:hippo tow:gator tow:rhino tow:serpent tow:whale
//
// FLIERS: glider gyro beast (scaly wyvern) bird bat pegasus griffon dragon carpet disc insect kite
//
// ARTS (what she does; numbers are the parameter):
//  gunnery     pierce: p        a hit carries on into the next enemy hull behind for half damage (chance p, 0.2..0.6)
//              beam: hex        her broadside is a beam of that colour that ignores half the target's armour
//              turrets: true    her guns bear in every direction
//              fireShot: p      chance a hit sets the target alight (0.1..0.35)
//              plague: p        chance a hit sickens the crew, who die off over time (0.1..0.35)
//              overcharge: p    chance a broadside does 1.8x; a quarter of those misfire and hurt her (0.1..0.3)
//              wedge: true      +6% accuracy and ram for each friendly line ship within 8 tiles (max +30%)
//              chainBias: x     more chain shot to strip a fleeing ship's sails (0.1..0.4)
//              fear: p          chance a hit makes the target's gun crews falter: her reload slows (0.1..0.3)
//  ramming     ram: true        she has a ram (if her hull had none)
//              grapple: true    a ram or close pass locks the target alongside for a while: boarding is forced
//              drill: x         ram damage x (1.3..2), ignoring armour, and she leaves the target leaking
//              blade: true      she rams with no damage to herself, and from any angle up to 60 degrees
//              snare: ticks     her ram fouls the target's rudder: it cannot turn (10..30)
//              tow: true        a beast tows her (draw it with tow:...): her ram hits a third harder
//  hull & crew lowProfile: x    enemy direct fire against her is x less accurate (0.15..0.4)
//              antiBoard: x     her crew counts x when defending against boarders (1.3..2)
//              boardBonus: x    her crew counts x when she boards (1.2..1.8)
//              oars: true       she sprints a quarter faster when closing, whatever the wind
//              windRunner: true a fifth faster on a beam reach
//              magicWard: x     spells, breath and curses do x less to her (0.3..1)
//              hover: true      she floats above the water: no shoals, no grounding, nothing from below
//  hunters     kegs: dmg        her harpoon lines carry powder kegs that burst when the line parts (20..60)
//              noRegen: ticks   a beast she hits cannot heal for that long (30..90)
//              scare: p         chance a beast she hits flees the fleet for a while (0.15..0.4)
//              paralyze: ticks  a beast she hits may be held still for that long (6..18)
//              freeze: ticks    as paralyze, by frost
//              poison: dmg      a beast she hits is poisoned: dmg every 3 ticks for 15 ticks (3..8)
//              beastBane: x     her harpoons and swivels do x to beasts (1.3..2)
//              lure: r          beasts within r tiles go for her first (6..14)
//              sludge: r        beasts within r tiles are blinded and burned a little every few ticks (5..10)
//              swarm: true      her harpoons hit harder for each other friendly hunter on the same beast
//              dominate: p      chance a harpooned beast turns on its own side for a while (0.05..0.2)
//              grabber: true    she hauls a tethered beast alongside and her crew hack at it
//  siege       shot: kind       how her shells look: mortar rocket beam boulder skull pot acid sound lightning stone
//              incendiary: true her shells set hulls and forts burning
//              salvo: n         n lighter shells at once, scattered (2..5)
//              breaker: x       damage x against forts (1.3..2)
//              terror: n        each hit kills up to n more crew (2..6)
//              briar: ticks     a hit fouls the target: slowed for that long (10..30)
//              acid: dmg        a hit corrodes: dmg every 3 ticks for 15 ticks (3..8)
//              stun: ticks      a hit silences the target's guns for that long (3..8)
//              rapid: x         reload x (0.5..0.9 is faster)
//              claws: true      she anchors anywhere, and a rough sea does not throw her aim
//              single: x        one colossal gun: damage x and reload x (2..3)
//              fireship: dmg    she is a fire-ship: she runs at the biggest enemy and bursts on contact (80..200)
//              fortify: x       while anchored she takes x less damage (0.2..0.5)
//  sky         aa: { range, dmg:[a,b], reload, acc, guns } her own guns into the sky (carrier and flak)
//              netting: true    her sky guns slow what they hit
//              snipe: p         chance each sky hit kills a flier outright (0.05..0.25)
//              skyPoison: dmg   her sky hits poison fliers (2..6)
//              intercept: r     enemy fliers within r tiles of her fleet strike at half effect (8..16)
//              (flier stats in `flier`: hp, dmg:[a,b], burn, crewKill, speed, hunter: true = goes for enemy fliers first)
//  supply      fearless: true   her side's crews near her never falter and defend boarding a quarter better
//              ward: x          her side's ships near her take x less damage (0.1..0.3)
//              fog: x           enemy direct fire against ships near her is x less accurate, and mortars cannot find them (0.1..0.35)
//              regen: n         n more hull mended per round for every ship near her (2..8)
//              refill: n        n fresh hands per round to every ship near her, up to full crew (1..3)
//              reanimate: x     when an enemy ship near her sinks or is taken, x of its crew rise to fill hers (0.2..0.6)
//              spur: x          reloads near her x (0.6..0.85 is faster)
//              dispel: true     her side's ships near her shrug off spells, ink, charm and fear
//              lull: x          enemy ships near her reload x slower and defend boarding x worse (0.15..0.4)
//              wind: x          her side's ships near her sail x faster (0.1..0.25)
//              boardAura: x     her side's boarders near her count x more (0.15..0.4)
//              blast: dmg       when she goes down she explodes (80..200)
//  landing     phase: true      she passes through shoals and reefs and over low islands
//              stealth: true    she cannot be targeted until she is within 8 tiles of a fort
//              charge: x        her crew counts x when she storms a fort (1.2..2)
//              beachKill: n     she kills n of the garrison the moment she beaches (3..12)
//              armour: n        extra armour (5..20)
import { DESIGNS as A } from './order.js';
import { DESIGNS as B } from './savage.js';
import { DESIGNS as C } from './dark.js';
import { DESIGNS as D } from './east.js';
import { DESIGNS as E } from './extra.js';

export const FLEET_DESIGNS = { ...A, ...B, ...C, ...D, ...E };
export const DESIGN_ROLES = ['line', 'hunter', 'siege', 'carrier', 'flak', 'troop', 'landing'];
