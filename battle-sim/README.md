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

## Graphics

The look is a retro low-poly fantasy style at modern fidelity: smooth terrain with colours blended between ground types,
rounded characters with faces, armour plates, capes and shields, procedurally painted stone, wood, thatch and roof-tile
textures, soft shadows, tone mapping, a sky gradient and rippling water. Each unit type is built once, its parts are
merged into one mesh per moving limb, and every soldier is a clone of that template, so a 300-unit battle stays near
1,800 draw calls. The **Graphics** menu sets pixel density and shadow resolution (Low, Medium, High, Ultra; Auto picks
Medium on phones and High elsewhere).

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
              naval.js (ships, creatures, forts), combat.js, terrain.js (map shapes, biomes), worker.js, batch.js
src/data/     units.js, structures.js, naval.js, presets.js, castle.js (castle builder)
src/render/   stage.js, landView.js, navalView.js, models.js (procedural animated models), textures.js (painted textures),
              customModels.js (imports and the model library)
src/app.js    UI wiring
tools/        build-artifact.mjs (single-page bundle for hosting as a claude.ai artifact)
```

The engine has no DOM dependency; `node` can import it directly for headless batch runs.
