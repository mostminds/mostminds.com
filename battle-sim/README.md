# Thousand Battles

A browser battle simulator in the style of "1,000 simulations" videos. Pick units
and quantities for two sides, build a map, watch one battle in 3D, or run 100 or
1,000 seeded battles in Web Workers and get a result card with win rate, average
survivors and a survivors histogram.

Everything is plain ES modules plus Three.js from a CDN. There is no build step.

```sh
cd battle-sim
python3 -m http.server 8000   # any static server works
# open http://localhost:8000
```

## Modes

| Mode | What happens |
| --- | --- |
| Field battle | Two armies deploy on opposite edges. A side set to *Defend* holds until the enemy closes in. |
| Island assault | Side A starts on landing craft (6 per boat) and sails for the beach. Defenders' archers and mages fire on the boats; a boat sunk before landing drowns everyone aboard. Ranged passengers can fire back from the boat. The ramp drops on landing and troops disembark onto free tiles. |
| Naval | Ships fire broadsides only at targets within ±35° of the beam, reload each side separately, lose crew as hull takes damage (fewer crew means slower sailing and fewer guns), and board ships with a much weaker crew to capture them. Sea creatures bite, ram, grapple, ink, charm and submerge. Island forts (shore battery, mortar battery, harpoon tower, sea fort) fire in every direction and can be stormed by a ship whose crew outnumbers the garrison. |

Land maps come in eight shapes (plains, island, coastline, harbor bay, archipelago, river with fords, lake, strait)
and six kinds of land (temperate, frozen north, desert, swamp, volcanic, jungle). In land battles either side can
bring **fire-support ships** that sail the deep water, bombard guns, troops, landing craft and enemy walls, and duel
with shore guns.

## Guns, castles and flight

- **Crewed guns**: cannon, ballista, mortar, shore battery and harpoon gun fire for whichever side has troops next to
  them and no enemies there. Kill the crew and step up to capture the gun. Mortars fire over walls with a dead zone up
  close; ballistae and harpoons can hit flying units; cannons, mortars and batteries batter nearby buildings.
- **Levels**: every tile has a height. Units step up or down one level at a time (ladders on watchtowers and bastions
  allow any). Castle stairs are level 1, wall-walks level 2, towers level 3. Melee can't reach more than one level
  up or down; shooters gain a tile of range per level and see over anything lower than themselves.
- **Destructible buildings**: anything with hit points can be broken. Pathfinding prices each breakable tile by how long
  it takes to break, so troops go around when that is faster and smash through when it is not. Rams and sappers
  (siege role) head straight for gates and walls; big brutes carry a siege multiplier. Rubble gives cover, and units
  standing on a collapsing wall fall and take damage. Gates open only for their owner.
- **Castle builder**: one tap places a whole castle (corner towers, wall-walks, gate, stairs, and a keep in the large size).
  Defending shooters climb onto the walls and towers and stay there.
- **Flying units** (griffon riders, harpies, gargoyles, vampire bats, imps, dragons) ignore terrain. Ground melee can
  only hit them in the moment they swoop down to strike, and after about two and a half minutes aloft they must land
  and rest.
- Healers carry 20 heals by default (`charges`), so healing duels can't stall a battle forever.

## Combat model (land)

The game runs on 0.6 s ticks and uses the classic MMO formulas:

- Attack roll `(level + 9) × (attack bonus + 64)` for the unit's style (melee, ranged or magic).
- Defence roll `(defence + 9) × (style defence bonus + 64)`; magic is defended with the target's magic level.
- Hit chance `1 − (D + 2) / (2(A + 1))` when A > D, otherwise `A / (2(D + 1))`.
- Melee and ranged max hit `⌊0.5 + (str + 9) × (str bonus + 64) / 640⌋`; magic units use `maxHit`.
- Damage is uniform from 0 to max hit. Projectiles land after a distance-based delay, and units avoid
  overkill by tracking damage already in flight.
- Terrain: walls block movement and sight, barricades/sandbags/boulders give +35% defence against
  shots that cross them, towers and gatehouses give shooters +2 range and +10% defence.

## Squad tactics

Units are grouped into squads of up to 8 of the same type. Each squad picks a role from its stats:

- **Frontline** melee advances on the nearest enemy squad.
- **Skirmishers** (fast melee: cavalry, wolves, ghouls) swing around the map edge to hit enemy archers and casters behind their line.
- **Artillery** (ranged and magic) advances to range, holds, and steps back from melee between shots.
- **Support** (healers) follows the most battered friendly squad and heals the weakest ally in range.
- Each squad picks a focus target (lowest effective HP) so its members concentrate fire.
- A squad reduced to a third of its strength while its side is losing falls back and merges into a healthier squad of the same role.

Pathing uses breadth-first flow fields over the grid, shared per target squad and refreshed every few ticks.

## Your own 3D models

**Your 3D models** in the app assigns a model file to any unit, ship, creature or building. Select the model file
together with every file it references:

| Format | Select together |
| --- | --- |
| `.glb` | just the file |
| `.gltf` | the `.gltf`, its `.bin` files and textures |
| `.obj` | the `.obj`, its `.mtl` and textures |
| `.ply` | just the file (vertex colours are used) |
| `.fbx` | the file and any textures |

These are the formats common model exporters write, so models you export with your own tools can be loaded as long as
you have the rights to use them. Nothing reads game files directly. Models are scaled to the unit (by height) or to the
footprint (ships, creatures, buildings). **Up axis** fixes exports that are Z-up or upside down, and **Turn** fixes facing.
Animation clips whose names contain walk/run, attack/hit/cast, death/die and idle/stand play automatically.
Models are stored in the browser's IndexedDB and never leave the device.

### Model library

Under **Your 3D models**, **Add folder** reads a whole folder of exported models (each model keeps the `.bin`, `.mtl`
and texture files it references), and the search box filters the library by file name or path. **Assign** puts a model
on the selected target. **Auto-match** replaces every unit, ship, creature and building whose name matches a file name;
a `mapping.json` in the folder sets the pairing explicitly:

```json
{ "my_knight.glb": "knight", "big_wall.obj": "struct:castleWall", "war_galley.glb": "galleon" }
```

Target ids are the keys in `src/data/units.js`, `src/data/naval.js`, and `struct:` plus a key from `src/data/structures.js`.

## Zeppelins, command and supply

- **War zeppelins**, one per faction (add them from the army list under *Zeppelins*): broadsides and bombs,
  a hangar that launches gliders, gyrocopters or the faction's own fliers, drop pods of shock troops, and
  ladders that lift hard-pressed troops out and set them down behind the lines. Each needs a crew. Enemy
  airships close, grapple and board; fliers can kill the crew and take the ship. Damage shows on the hull,
  and a wreck stays where it falls. A friendly **zeppelin tower** repairs and re-crews ships moored near it.
- **Command.** Units have ranks (Recruit, Veteran, Sergeant, Captain) and are promoted for kills. Each side
  has commanders who carry a standard. A squad that breaks, or loses its commander, falls back to the nearest
  rally point or commander, re-forms and returns.
- **Supply and engineers.** Stores come ashore from landing craft and ships, are flown in on zeppelin supply
  runs, or stand in rail wagons (every preset army on land has a supply line). Archers, crossbowmen and
  slingers carry 40 shots and medics a set number of dressings; both refill at a stocked point, and fight at
  half strength when they cannot. Each squad sets its own rally point. Engineers haul them to beachheads, rally points and forts and build what the situation calls for
  (breastworks, ballistae against fliers, cannon, aid tents, watchtowers), and repair damaged buildings and
  guns. Vanguards guard the supply chain and raid the enemy's; medics go to the wounded of their own squad first.
- **Damage and the dead.** Buildings and guns show two stages of damage before they fall; bodies stay on the field.
- **Landing craft** have a crew of three and a bow gun, and can be placed on any open water.
- **Editing.** Place troops in formation (block, line, column, wedge, hollow square, circle), and move or
  delete any group, including troops from the army list.
- **Generated scenarios** (Scenario → Generate): a village, fort, castle, city, coastal town, harbour city or
  island stronghold laid out in the defending faction's own building style, on maps up to 128 tiles, with docks,
  mooring towers, hangars, workshops and a rail supply line.

- **Deaths and matched combat.** How a soldier falls depends on what killed him and from where: thrown back by
  a blow from the front, pitched forward when cut down from behind, sideways when taken in the flank, to his
  knees, or flung by a blast. Bodies lie where and how they fell. Two evenly sized melee fighters toe to toe
  play parries, hits and killing blows together.
- **Fracture.** Damaged buildings break into chunks (cell pattern from the three-pinata library, loaded from
  the CDN) that fall as damage mounts and stay as rubble; repairs set them back.
- **Sailing.** Naval battles have a wind (arrow and streaks on the sea). Ships are slow close-hauled, cannot
  sail into the wind's eye and tack instead, shoot better from windward, rake for extra damage through bow
  or stern, and lose way as their rigging is shot up. Oared craft and beasts ignore the wind.
- **War beasts** (Siege Crab, War Serpent, Leviathan Ark, in the ship lists): crewed sea creatures with a
  fighting tower. They fight as ships at sea; in land battles they swim to the enemy shore and land troops,
  stores and, for the crab and the ark, a siege weapon.

- **Bigger maps, drier feet.** Preset land maps are 72 to 128 tiles across and sea battles 210 by 135; generated
  sites run from 96 to 160. Soldiers on foot keep out of all water: rivers are crossed at gravel fords, and
  straits and island chains are joined by tidal sandbars. Rally points are never set in water. Units glide
  between tiles, cut corners, keep their own spot in the rank and stride by the ground they cover.

- **Generate map** (the button in the run bar) builds a new map in one press. Towns have districts: a market
  square with hall and stalls, bank, inns, gardens, fountain, barracks, a temple quarter with its graveyard,
  shrines, an alchemist's laboratory (which explodes when destroyed), dock houses and a palace. Inns and temples
  heal troops of the side that holds them; market halls and dock houses hold stores.
- **Cities on levels.** Cities and castles have an upper town on a terrace and a higher terrace for the palace,
  reached by elevated timber walkways from the wall-walk, a rail viaduct with supply wagons, stone bridges over
  rivers, and a cable car that carries stores up from the square. All of them can be destroyed.

- **Faction towns.** Every faction builds in its own look: goblin scrap and hide, undead bone and black stone,
  demon basalt and brass, beastfolk timber and bone, elemental crystal, dragon-roost rock. Each also has
  buildings only it raises (goblin scrap huts, war drums and breweries; undead crypts, bone spires and charnel
  houses; demon forges, obelisks and pit gates; beast yurts, totems and bone pits; elemental crystal spires,
  monoliths and stone rings; dragon nests, perches and hoards).
- **More troops.** 21 further unit types (pikemen, scouts, grenadiers, war priests, goblin spearmen and bombers,
  troll shamans, wights, banshees, plague bearers, alpha wolves, broodmothers, ogre magi, frost golems, storm
  elementals, hellhounds, cultists, hell knights, kobolds, dragon knights, whelps).
- **Specialisations.** On reaching Veteran a soldier takes one of his kind's trades (an archer becomes a
  Sharpshooter, Fire archer or Quickshot; a wraith a Restless or Soul-leech, and so on), which shifts his
  stats and shows in the tooltip.
- **Under the walkways.** Troops arriving at ground level pass beneath walkways and viaducts; those coming off
  a wall or terrace cross on top.

## Lords of the deep

Nine great sea monsters that any fleet may bind or ally with (add them from the ship list in a naval battle):

- **Triton**, a giant sea-god with a trident: calls up tidal waves that batter, throw back and slow ships, and
  sweeps hands off their decks. He will not sail with the Shadow-Kin, the Ironbound, the Endless Screaming or
  the Greenhide Hordes, and leaves a fleet that includes their ships.
- **Sea Elemental**, a living waterspout: washes crews overboard and takes about an eighth of the harm from
  cannon; other monsters and magic hurt it normally.
- **Kraken**: wraps a ship, crushes her and drags her under when she is nearly broken; ink and sweeping arms.
- **Sea Dragon**, finned and wingless: a cone of scalding fire that burns hulls and rigging.
- **Megalodon**: goes into a frenzy against a wounded ship and snatches sailors.
- **Ironshell Colossus**, an armoured giant crab: shrugs off much of a broadside and shears weakened hulls in two.
- **Abyssal Maw**, a deep-sea fish that is mostly jaw: swallows small damaged craft whole and drags larger ones down.
- **Great Coil Serpent**: constricts and batters.
- **Horned Behemoth**, a whale with a spiral horn: devastating rams that leave a ship taking water.

### Beasts of the ancient seas

Ten prehistoric hunters, also in the ship list of a naval battle:

- **Dunkleosteus**, the armoured bone-shearer: armour does not count against its bite, and ironclad plate only
  makes it bite harder.
- **Leedsichthys**, the gilded giant: slow, with by far the most hit points in the sea; enemy ships near it
  shoot at it before anything behind it.
- **Tylosaurus**, the mottled mosasaur: fast, sweeps decks with its tail and drags crew overboard.
- **Shonisaurus**, the red-backed ichthyosaur: its ram grows with every tile of straight run before impact.
- **Kronosaurus**, the pliosaur: the heaviest bite in the sea, and a chance to break a weakened ship's back outright.
- **Elasmosaurus**, the serpent-neck: strikes from seven tiles away, taking crew rather than hull.
- **Tusoteuthis**, the scarlet squid: fouls a ship's rudder from medium range so she cannot turn, then closes to crush.
- **Orthoceras**, the cone-shelled lancer: moves only in straight jet bursts and punches through armour.
- **Xiphactinus**, the fang-fish: weak alone; bites harder for each of its kind nearby, goes for damaged ships
  and cripples oared ones. Add two or three.
- **Styxosaurus**, the stinger-neck: fast, rears up to snatch topmen from the rigging. (There are no fliers in
  sea battles yet, so its anti-flier role is not in the game.)

### Generated sea battles, the frozen sea and diving boats

- **Generate on the sea.** In Naval mode, *Generate* (or *Generate map*, or the place "Sea battle") builds a sea
  battle: islands large and small, the defender's islands fortified with shore batteries, mortars, harpoon
  towers or a sea fort (the attacker sometimes holds one too), two fleets drawn from the chosen factions' own
  hulls, a diving boat or two each, and sea monsters bound to each fleet. The attacker gets a larger fleet to
  pay for the forts it must face.
- **The frozen sea.** Northern factions usually fight in it, others sometimes: fields of pack ice and drifting
  bergs that ships must steer round (ice-breaking hulls go through, sea creatures swim beneath, a submerged
  boat passes under), snow-covered islands, penguin colonies on the ice and shores, and the hunters of cold
  water: the **Tusk-Lord Walrus**, **Killer Whales** and **Narwhals** in pods, the **Rime Kraken**, the
  **Polar Serpent** whose frost breath slows ships and their gun crews, and the **Berg Titan**, a living iceberg.
- **Diving boats.** Every faction has an undersea unit. Boat-building peoples have a submersible in their own
  colours: it goes under as it closes (nothing can aim at it then), comes up within range and looses a torpedo
  ahead, which counts well under half the target's armour and leaves her taking water. Peoples who build no
  such thing send a beast instead: the Cloven a Tylosaurus, the Gorge-Tribes a Kronosaurus, the Mist-Cloaked
  Isles an Elasmosaurus, the Fimbulwinter Raiders a Polar Serpent, the Verdant Host a Great Coil Serpent, the
  Xibalbans a Shonisaurus, the Endless Screaming an Abyssal Maw, and Beasts, Elementals and Dragons a
  Megalodon, a Sea Elemental and a Sea Dragon.

### Six seas

A generated sea battle takes its sea from the lands of the two factions, or from the **Sea** picker beside
*Place*: the grey sea (temperate), the frozen sea, the burning coast (desert), the drowned marshes (swamp), the
sea of fire (volcanic) or the green lagoons (jungle). Each has its own water and sky, its own islands, its own
hunters in the water, and its own life and buildings ashore.

- **Hunters by sea.** Besides the monsters above: Cinder Serpents and Magma Crabs in volcanic water, Bog
  Lurkers and Mire Eels in the marshes, Coral Drakes and Dune Crabs on desert reefs, River Tyrants and Lagoon
  Stranglers in the lagoons.
- **The sea of fire.** One or two islands are live volcanoes. Each rumbles, then erupts for a spell, throwing
  molten rock up to thirty tiles: it damages whatever it lands on, of either fleet, and sets ships alight.
- **Islands.** Every island is dressed for its sea, and the largest carries a settlement: a jungle village on
  stilts (tribal hall, shaman's hut, market, cookhouse, barracks, boar pen, watch towers, gatehouse and
  boardwalk) among palms, banana trees, banyans and mangroves, with boars, macaws, monkeys, crocodiles, frogs
  and snakes; a lighthouse, windmill and cottages on the grey sea; an oasis camp with camels on the burning
  coast; stilt shacks and fireflies in the marshes; ash-buried ruins under the volcano. (`src/render/seaset.js`
  lays them out; the pieces are in `src/render/props/jungleset.js`, `seascapes.js` and `arctic.js`.)

## The land

- **Hills and cliffs.** Dry land rolls into hills up to about three tiles high, with flat-topped heights
  edged by cliffs. Cliffs cannot be climbed: armies go round them or up the slopes left through every cliff
  line, and a cliff that would cut part of the map off is opened. The ground stays level where anything is
  built and falls away to the shore. Generated maps have hills and cliffs; presets and hand-built maps get
  gentle hills only, so their balance is unchanged. (`generateRelief` in `src/engine/terrain.js`; a scenario
  sets `relief: { hills, cliffs }`.)
- **Ground.** The ground mesh is twice as fine as the tiles and painted by what is there: lush meadow, dry
  stretches, worn soil, paler cover on the heights, banded rock on steep ground and cliff faces, and a fine
  grain over all of it.
- **What grows on it.** Each land has its own cover, scattered in patches the way it grows: grass tufts, tall
  grass, flowers in seven colours, bushes, berry bushes, ferns, reeds along the water, lilies on the shallows,
  mushrooms, pebbles, stones, logs and stumps in temperate country; drifts, ice shards and dead trees in the
  north; cactus, dry shrubs and bones in the desert; reeds, ferns and dead trees in the swamp; obsidian
  shards and glowing lava cracks in volcanic land; broad-leaved plants and ferns in the jungle; and boulders
  along every cliff line. Density follows the graphics setting. (`src/render/groundcover.js`.)

## Rally points, generals and the wounded

Land battles and island assaults are fought over **rally points at fixed places** (the tall banners, each with
a ring marking the ground that must be held). Rules are in `src/engine/fronts.js`.

- **Whose they are.** An attacking army's points are fortified camps: breastworks, siege pieces and stores for
  the assault (a landing force has only the beaches it comes in on). A defender's are its headquarters in the
  middle of the place and a few lightly held posts, where its engineers raise what the fight calls for: shore
  batteries and harpoon guns while there is anything on the water, cannon and mortars against infantry,
  ballistae against fliers, then breastworks, an aid tent and a watchtower. Generated maps lay the points out;
  a map that names none gets two a side.
- **Taking one.** A point turns when only the other side's soldiers have stood on it for a while. It keeps
  half its stores.
- **Teams.** Part of each army is told off to hold its own points (half of a defender, about a fifth of an
  attacker, shooters first) and the rest to take the enemy's, a named point each. When a battle goes quiet,
  more are sent forward. A broken squad falls back to the nearest point its side still holds.
- **Generals.** Each faction has one (King, Tsar, Shogun, Great Warboss, Lich King and so on): a single soldier
  no bigger than his troops and worth a company of them, marked by a gold crown and ring. He keeps to his
  headquarters and moves to another point if it falls.
- **Winning.** Hold every rally point with the enemy general dead, or leave the enemy with nobody standing. At
  the time limit the side holding more points wins.
- **The wounded.** A foot soldier struck down may be left alive on the field. A medic goes to him, takes him up
  on a stretcher in his faction's colours and carries him to an aid tent, raising one at the nearest rally
  point if there is none; after a while there he returns to the fight at half strength. Left too long, he
  dies. Healers still heal in the field as before.

### More country

- **Map shapes.** Besides plains, river, lake, coast, harbour, island, strait and archipelago: two rivers, marsh
  and meres, an isthmus, a crescent bay, a peninsula, a fjord coast, an atoll and twin isles. Generated sites
  draw from those that suit them.
- **Life on the land.** Land maps carry the same scenery as the seas, by climate: deer, sheep, haystacks and
  gulls; camels, cactus, ruins and vultures; cypress, herons, alligators and fireflies; charred trees, vents
  and fire lizards; palms, mangroves, crocodiles, macaws and monkeys; penguins and ice floes in the north. It
  is decoration: troops walk through it.

## Capture the flag

The **Capture the flag** button builds two forts facing each other across open ground, each in its own
faction's style (chosen under *Generate a scenario*, or any two), each with a flag on a stand at its heart.

- A soldier on foot who reaches the enemy flag takes it and runs for home. He scores when he brings it to
  his own stand while his own flag is there. First to three wins; at the time limit the higher score wins,
  then whichever side laid hands on the other's flag more often.
- Kill the carrier and the flag falls. The next raider at hand picks it up; its owners send it home by
  holding the spot clear for a few moments, and a flag left lying returns by itself. The carrier takes half
  damage and does not stop to fight.
- About a third of each army (shooters and healers first) holds the fort and runs down anyone who takes the
  flag. The rest raid: each squad has its own way in, by the main gate or round the edges of the field to the
  open posterns north and south. The main gate must be broken.
- The fallen return in waves at their own fort, whole and rearmed, keeping their rank.

The rules are in `src/engine/ctf.js`; the map comes from `generateScenario({ site: 'ctf' })`.

## The realms

Twenty-seven further factions, in four groups, each with its own troops, beasts, ships, airship (where it
flies one) and way of building. They are described in `src/data/realms.js`: one entry per realm, expanded
into units, ship classes and map-generator factions. Pick them under *Generate a scenario* or add their
troops from the army list.

- **The Realms of Order:** the Graalish Kingdoms, the Aurelian Empire, the Aethelian Dominion, the Shadow-Kin
  of Kael'Neth, the Verdant Host of Athel-Vael, the Grom Holds, the Xibalban Temple-Cities, the Tsardom of
  Velikaya, the Celestial Dynasty of Tian-Long.
- **The Forces of Destruction:** the Ironbound Legions, the Endless Screaming, the Cloven Herds, the
  Fimbulwinter Raiders, the Ziggurat Forges of Ashur, the Greenhide Hordes, the Warrens of Skar.
- **The Undead Legions:** the Crimson Aristocracy, the Eternal Dynasties of Khemet, the Drowned Armada.
- **Outcasts and Distant Lands:** the Gorge-Tribes of the Steppe, the Free Republic of Westmark, the Merchant
  Principalities, the Kingdoms of the Sun, the Caliphates of the Great Desert, the Shogunate of the Rising
  Sun, the Mist-Cloaked Isles, the Kingdoms of the Thousand Gods.

What each realm brings beyond its roster: eight further peoples (elf, dwarf, orc, lizardfolk, ratfolk,
goat-headed beastfolk, tigerfolk, mummy); thirty costumes with their headgear; twenty weapons (pike, katana,
khopesh, handgun, repeater and so on); fourteen beast kinds and twelve mounts (pegasus, bear, raptor, rhino,
mammoth, elephant with howdah, clockwork horse); thirteen great beasts (hydra, tree-warden, the saurians,
phoenix, sphinx, djinn, wreck colossus); seven war machines (steam tank, war wagon, balloon, flying carpet);
twenty-six ship hulls; a building style of its own; and two landmark buildings (cathedral, pagoda, pyramid,
longhouse, castle keep and the rest). Generated armies are priced per realm so each is a fair match for the
first factions at equal points.

All designs are original and drawn from history and folklore; none copies another game's factions,
creatures or names. A realm's troops take their statistics from a unit of the first roster scaled by a
factor, so the realms stay in balance with it. Where a body, costume, weapon, hull or building style has
not been sculpted yet, the descriptor names a stand-in (`alt`) and the game uses that.

`docs/TACTICS.md` describes the squad AI and the published frameworks it draws on.

## Graphics

The look is a chunky classic fantasy MMO style with dense, smooth geometry: nothing is built from boxes and
cones. Every unit, building, siege weapon, ship and sea creature is sculpted in code the first time it is
needed, from smoothly blended volumes (anatomy, cloth, fur, stone) meshed at high resolution plus crisp
hard-surface pieces (blades, plate, rivets, planks, rigging). A soldier is 50,000 to 90,000 triangles up close,
a mounted knight about 170,000, a ship of the line about 87,000.

- **Units** are jointed rigs with knees, elbows, wrists and jaws: faces with eyes and teeth, hands with
  fingers gripping their weapons, layered clothing and armour per unit, mounts with seated riders.
- **Detail levels.** Each model is built at several levels and swaps as the camera moves; the farthest level
  is a single merged mesh of a few thousand triangles, so a 320-unit battle draws about 2,000 meshes and
  0.7 million triangles at a typical view.
- **Loading.** Sculpting a model takes a fraction of a second, so a new battle shows a progress card while
  its models are built one per frame; they are then cached for the session.
- **Graphics menu.** Low, Medium, High and Ultra set pixel density, shadow resolution and sculpt resolution
  (Auto picks Medium on phones and High elsewhere). Changing it rebuilds the models.
- **Scene.** Smooth terrain with colours blended between ground types, soft shadows, tone mapping, an
  environment-lit sky and rippling water.

Models you import yourself (see above) replace the built-in ones unit by unit.

### Authoring models

`docs/MODELING.md` is the guide: the sculpting kit, rig conventions, budgets and per-family contracts.
`viewer.html` previews any model, and two tools render it headlessly:

```sh
node tools/model-shot.cjs --kind unit --id knight@idle,knight@attack:0.38,knight@death --out knight.png
node tools/model-shot.cjs --kind ship --id galleon --water 0 --ref 1 --out galleon.png
node tools/smoke.cjs --preset horde --ticks 40 --zoom 0.55 --out game.png   # the real game, errors reported
```

## Adding your own units

The built-in roster is an original fantasy roster. Add your own through
**Import your own units** in the app, using the same fields:

```json
{
  "units": {
    "sentinel": {
      "name": "Tower Sentinel", "category": "My units",
      "hp": 90, "att": 70, "str": 75, "def": 80, "rng": 1, "mag": 1,
      "style": "melee", "speed": 5, "range": 1, "move": 1, "size": 2,
      "bonus": { "att": 40, "str": 50, "defMelee": 120, "defRanged": 100, "defMagic": 10 },
      "abilities": [{ "type": "cleave", "radius": 1, "mult": 0.5 }]
    }
  },
  "ships": {
    "junk": { "name": "War Junk", "level": 55, "hull": 380, "armour": 20, "speed": 0.5, "turn": 6, "crew": 30,
              "len": 6.5, "beam": 2.6, "sails": 2, "cannons": { "perSide": 4, "dmg": [8, 20], "range": 14, "reload": 9, "acc": 0.55 } }
  },
  "creatures": {
    "whale": { "name": "Storm Whale", "level": 70, "hp": 500, "armour": 30, "speed": 0.5, "size": 4, "model": "leviathan",
               "attack": { "range": 3, "maxHit": 30, "speed": 6, "acc": 0.6 }, "abilities": [{ "type": "ram", "damage": 60, "cooldown": 25 }] }
  }
}
```

`speed` is ticks between attacks, `range` and `size` are in tiles, `move` is tiles per tick.
Bonus keys: `att str rngAtt rngStr magAtt defMelee defRanged defMagic`.
Abilities are listed at the top of `src/data/units.js` and `src/data/naval.js`.
Imported units are saved in the browser and can be placed by hand or added to armies.

## Layout

```
src/engine/   battle.js (land + amphibious, levels, breaching, flight), support.js (guns, fire-support ships),
              airship.js (zeppelins), command.js (ranks, rally points, supply, engineers, vanguards),
              naval.js (ships, creatures, forts), combat.js, terrain.js (map shapes, biomes), worker.js, batch.js
src/data/     units.js, structures.js, naval.js, airships.js, presets.js, castle.js (castle builder), worldgen.js (generated scenarios)
src/render/   stage.js, landView.js, navalView.js, textures.js,
              sculpt.js (sculpting kit), rigkit.js (jointed rigs and detail levels), animate.js (poses),
              registry.js + models.js (gathers the model families; falls back to simple shapes if a builder fails),
              bodies/  humanoid.js, anatomy.js, gear.js, weapons.js, undead.js, beasts.js, monsters.js
              props/   buildings.js, civic.js, siege.js, ships.js, seacreatures.js, airships.js
              customModels.js (imports and the model library)
src/app.js    UI wiring          src/viewer.js + viewer.html   model preview page
docs/         MODELING.md (how the models are authored), TACTICS.md (squad AI and its references)
tools/        model-shot.cjs, smoke.cjs (headless previews and game checks),
              build-artifact.mjs (single-page bundle for hosting as a claude.ai artifact)
```

The engine has no DOM dependency; `node` can import it directly for headless batch runs.
