# Libraries and sources for the next round of polish

What exists for each area, how it would fit this project (plain ES modules, three.js r160, models sculpted
in code), and what to check before using it. Licences are as stated by each source when searched; confirm
before shipping anything.

## Death animations

| Source | What it is | Fit |
| --- | --- | --- |
| [Quaternius Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) ([part 2](https://quaternius.itch.io/universal-animation-library-2)) | 120+ humanoid clips including deaths, glTF/FBX, CC0 | Best free option. Needs retargeting onto our jointed rigs, or use on imported skinned models. |
| [Mixamo](https://app.cinevva.com/guides/free-character-animations-rigging) | Large mocap library, free with an Adobe account; raw files may not be redistributed | Good for your own imported models; clips cannot be committed to a public repo as raw files. |
| [Rokoko free mocap](https://www.fab.com/listings/5aab4fdc-7cea-4acd-b1ff-2ca3b3706c02) / [Deaths mocap pack](https://blendermarket.com/products/deaths-mocap-animations) | Death-specific mocap sets | Check licence terms per pack. |
| [CMU-derived free character animations](https://rancidmilk.itch.io/free-character-animations) | CMU mocap converted to glTF/FBX on a Quaternius rig; custom "don't resell as animations" licence | Large variety, uneven quality. |
| [rapierjs-ragdoll](https://dev.to/mattvb91/realistic-ragdoll-physics-in-threejs-1pko), [three.js RapierPhysics](https://threejs.org/docs/pages/RapierPhysics.html) | Physics ragdolls in three.js with Rapier | Our rigs are rigid jointed parts, which suits ragdolls well: blend from the death pose into physics for the last half second. Rapier is WASM and must be loaded from an allowed CDN. |

## Matched (paired) melee combat

- [How Total War's matched combat began](https://www.dbltap.com/news/total-war-medieval-2-matched-combat-animations-spartan-total-warrior-history) and the [Rome II preview](https://pcgamer.com/rome-2-total-war-preview): two or more fighters play one choreographed sequence chosen from a pool, triggered by chance when a pairing fits.
- [Dawn of War 4 sync kills](https://www.pcgamer.com/games/rts/dawn-of-war-4s-combat-director-goes-even-further-than-the-original-games-sync-kill-animations-i-dont-think-any-rts-has-really-done-anything-like-this-in-the-past) and its [animation system](https://techradar.com/gaming/warhammer-40-000-dawn-of-war-4-creative-director-says-the-games-advanced-animation-system-is-an-evolution-of-the-melee-system-that-initially-sounded-pretty-much-impossible-our-big-concern-was-is-this-not-responsive-enough): synchronised kills extended to all melee, with responsiveness as the main risk.
- [Total War: Warhammer II at scale](https://gamedeveloper.com/design/designing-i-total-war-warhammer-ii-i-to-handle-tons-of-units-and-massive-battles): combat resolved per individual, driven by animation.

No reusable library was found; this is a technique. Fit here: the engine already knows attacker, target, hit or
miss and the killing blow each tick, so a paired sequence (attacker strike + defender parry, or kill + fall) can
be chosen when two size-matched melee units face each other, and both animators driven from one shared clock.

## Destructible buildings

| Source | What it is | Fit |
| --- | --- | --- |
| [three-pinata](https://cdn.jsdelivr.net/npm/@dgreenheck/three-pinata@2.0.1/README.md) | Real-time Voronoi fracture and slicing for three.js (needs three ≥ 0.158), separate inner-face material | Closest match. Fracture a building's mesh into chunks at each damage stage instead of the current clip-plane cut. Needs UVs or a vertex-colour path for our material. |
| [three.js ConvexObjectBreaker](https://threejs.org/docs/pages/ConvexObjectBreaker.html) | Built-in addon that splits convex pieces on impact | Works for walls built from convex blocks; our buildings are concave merged meshes, so they would need to be authored as blocks. |
| [Pre-fracturing research](https://arxiv.org/pdf/2111.05249) | Swap in a pre-broken version on impact; notes plain Voronoi looks artificial | Supports doing the fracture at build time (we already cache geometry) and swapping per stage. |

## Ship combat

- [BSD `sail`](https://manpages.debian.org/jessie/bsdgames/sail.6.en.html) ([source](https://gitweb.dragonflybsd.org/dragonfly.git/blob/HEAD:/games/sail/sail.6)): open-source, BSD-licensed computer version of *Wooden Ships & Iron Men*; models the weather gage, points of sail, grappling and boarding. The one open rule set that can be read as code.
- [Wooden Ships & Iron Men (browser version)](https://mtorpey.github.io/wooden-ships/) and the [Admiralty miniatures rules](https://wtj.com/games/admiralty/docu_rules.htm): speed from ship type, wind strength, heading to the wind and sail setting; raking fire; crew quality.
- [Naval Action](https://store.steampowered.com/app/311310/?l=english) and [Ultimate Admiral: Age of Sail](https://store.steampowered.com/app/1069650/_/) as references for yard angles, heel, being taken aback, and [why most games get sailing wrong](https://pcgamer.com/finally-a-naval-combat-sim-that-gets-sailing-ships-right).

Fit here: the naval mode has broadsides, boarding and capture but no wind. Adding a wind direction with
speed by point of sail, raking bonuses for bow and stern shots, and sail or rigging damage would follow these directly.

## Unit specialisation and variation

- [GPU Gems 3: animated crowd rendering](https://developer.nvidia.com/gpugems/GPUGems3/gpugems3_ch02.html): split characters into instanced parts and swap heads and gear per individual.
- [Generating, animating and rendering varied individuals for real-time crowds (EPFL)](https://infoscience.epfl.ch/record/135641) and [GPU techniques for visually diverse crowds](https://ueaeprints.uea.ac.uk/23926): per-part colour shifts, body-mass and skeleton scaling.
- [Attack of the clones (Lincoln)](https://repository.lincoln.ac.uk/articles/journal_contribution/Attack_on_the_clones_managing_player_perceptions_of_visual_variety_and_believability_in_video_game_crowds/24334159): which variations players actually notice. Heads and colour matter most.
- [Creating diversity and variety (SIGGRAPH 2021)](https://history.siggraph.org/wp-content/uploads/2022/06/2021-Talks-Kaur_Creating-Diversity-and-Variety.pdf), [Crowds in Hitman (GDC)](https://gdcvault.com/play/1015315/Crowds-in-Hitman).

Fit here: every soldier of a type is currently a clone of one template. Two or three head, hair and helm
variants per type, a per-soldier tint and height scale, and rank or specialisation marks (a sergeant's crest,
an engineer's pack, a medic's satchel) are cheap with the part-based rigs.

## Large themed combat maps (city, fort, fortified settlement, harbour, air base, island hopping)

No single library produces battle maps for this game; the useful pieces are layout generators, constraint
solvers for placing parts, terrain generators, and model kits. Licences as reported by each source: confirm before use.

| Need | Source | What it gives | Fit |
| --- | --- | --- | --- |
| City and town layouts | [Watabou Medieval Fantasy City Generator](https://watabou.itch.io/medieval-fantasy-city-generator) ([older source: TownGeneratorOS](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/6592/source-code)) | Wards, walls with gates and towers, a citadel, rivers and harbours; newer versions export GeoJSON | Best reference for organic walled cities. The method (Voronoi wards, walls round the inner wards, streets from gates to the plaza) would replace our street grid. The current tool is Haxe, not a JS library. |
| Road networks | [t-mw/citygen](https://github.com/t-mw/citygen) | Open JavaScript road-growth city generator (highways, then streets, then lots) | Could lay real street networks for the 144 and 160 tile cities. |
| Fitting themed parts together | Wave function collapse: [kchapelier/wavefunctioncollapse](https://npmjs.com/package/wavefunctioncollapse) (MIT, port of [mxgmn's original](https://raw.githubusercontent.com/mxgmn/WaveFunctionCollapse/master/README.md)), [BlazinWFC](https://github.com/arkyris/blazinwfc), [ndwfc](https://github.com/LingDong-/ndwfc) | Fills a grid from tiles with adjacency rules | The right tool for harbours (quay, pier, warehouse, crane), forts (wall, bastion, gate, glacis) and air bases (mooring tower, hangar, workshop, apron): define each theme as a tile set with sockets. |
| Islands and coastlines | [Red Blob Games polygon map generation](https://www.redblobgames.com/maps/polygon-map-generation/), [mapgen2](https://redblobgames.com/maps/mapgen2), [mapgen4](https://www.redblobgames.com/maps/mapgen4) (Apache 2 per forks), [Evelios/procedural-island](https://github.com/Evelios/procedural-island) | Island shapes from noise minus distance to the edge, elevation, rivers | Would replace our fixed island and archipelago formulas with varied island chains for island hopping. |
| Building and prop kits | [Kenney Castle Kit](https://kenney-assets.itch.io/castle-kit) and [Fantasy Town Kit](https://opengameart.org/content/fantasy-town-kit), [KayKit Medieval Builder Pack](https://opengameart.org/content/kaykit-medieval-builder-pack-10), [Quaternius Medieval Village MegaKit](https://quaternius.com/packs/medievalvillagemegakit.html) (all CC0) | Hundreds of modular walls, houses, docks and props in glTF | Usable today through the model library (import a folder, auto-match by name). They are low-poly, so they would not match the sculpted look; no free kit found for airships or air bases. |

What the game does now: `src/data/worldgen.js` lays out villages, forts, castles, cities, coastal towns,
harbour cities and island strongholds from hand-written rules per faction (street grid, warren, necropolis,
stone rings, lair). The most valuable upgrades from the sources above, in order: wave function collapse tile
sets per theme (adds air bases and proper harbours cheaply), Voronoi wards for cities, and noise-based island
chains with several defended islands for island hopping.
