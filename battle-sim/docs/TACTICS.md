# Squad tactics: what the simulator does and where the ideas come from

The battle AI is layered the way commercial squad AI and infantry doctrine both are: a side-level
layer owns objectives, rally points and supplies; squads choose a stance and a target; individuals
carry out a role. This note says what each layer does (`src/engine/battle.js`, `command.js`,
`airship.js`, `support.js`) and lists the frameworks it borrows from, with what has and has not been
taken from each.

## What is implemented

| Layer | Behaviour |
| --- | --- |
| Side | Beachheads where boats land, forts where the garrison has works. Supplies arrive by landing craft, ship, zeppelin supply run or rail wagon, and are used up: shooters draw ammunition and medics dressings from stocked points, and one load is always held back from building for that. |
| Squad | Each fighting squad chooses its own rally point or ground to hold: the nearest marked point behind it, or a new one a few tiles back (on its commander if he is near). It can break and rally up to three times. Hold, advance, flank, fall back, regroup. A squad that drops below strength, or whose commander has just fallen, breaks and falls back to the nearest rally point or living commander, re-forms there and goes back in. Focus fire on the weakest reachable enemy. |
| Individual | Ranks (Recruit, Veteran, Sergeant, Captain) with field promotion on kills. Specialisations: line, marksman, medic, engineer, vanguard, commander. Support troops are attached to a fighting squad and look to it first. |

- **Engineers** unload crates and wagons, carry stores to the point shortest of them, then build what the
  situation calls for: a ballista when the enemy has fliers or airships, a cannon for a beachhead or fort,
  an aid tent and a watchtower for a place held a long time, otherwise breastworks in an arc toward the
  enemy. With nothing to haul or build they repair, or wait at a held point.
- **Medics** walk to the most badly wounded soldier of their own squad, then anyone near.
- **Vanguards** mostly stand guard over medics, engineers and stores; one in three raids the enemy's
  crates, depots and wagons.
- **Commanders** are tougher, carry a standard, and are where broken squads run to.

## Frameworks referenced

1. **Layered strategy / squad / individual AI (Killzone 2 and 3).** A strategy layer assigns objectives,
   a squad layer coordinates, and individuals plan their own actions with an HTN planner.
   *Taken:* the three layers and the idea that squads, not individuals, own stance and target.
   *Not taken:* HTN planning; individuals here use fixed priority rules.
   [Killzone 2 multiplayer bots (Straatman, Verweij, Champandard)](https://www.slideshare.net/guerrillagames/killzone-2-multiplayer-bots),
   [Hierarchically-layered multiplayer bot system (Verweij)](https://www.guerrilla-games.com/media/News/Files/VUA07_Verweij_Hierarchically-Layered-MP-Bot_System.pdf)
2. **Position evaluation and tactical pathfinding (Killzone).** Candidate positions are scored by a
   weighted sum of factors such as cover, lines of fire and distance, and paths avoid exposed ground.
   *Taken:* build sites and rally points are picked by scoring candidates (distance to the wanted spot,
   free ground, facing the enemy); movement uses weighted flow fields with breach costs.
   *Not taken:* per-soldier cover scoring and threat-weighted paths.
   [Killzone's AI: dynamic procedural combat tactics (Straatman, van der Sterren, Beij)](https://www.guerrilla-games.com/read/killzones-ai-dynamic-procedural-tactics),
   [GDC Europe 2005 slides](https://www.guerrilla-games.com/media/News/Files/gdce05_killzone_ai.pdf)
3. **Squad formations led by a squad leader (Company of Heroes).** The squad is the unit of command;
   formation depends on the ground (wide wedge in the open, tight wedge in confined space, column on roads).
   *Taken:* squads as the unit of command, sergeants as leaders, hand-placed line, column, wedge, square
   and circle formations. *Not taken:* formations that reshape themselves while moving.
   [Company of Heroes squad formations explained (Jurney)](https://forum.arongranberg.com/uploads/short-url/rWod3K2KhNWcOEdjewnsLXQKU6A.pdf)
4. **Believable squad tactics: fire and manoeuvre, flanking, suppression.** Compares centralised and
   distributed coordination and scripted versus procedural tactics.
   *Taken:* centralised squad decisions (flank around a screen, focus fire). *Not taken:* suppression.
   [Believable Tactics for Squad AI (GDC AI Summit)](https://gdcvault.com/play/1015665/contactUs),
   [Blackboard-like system for squad-level combat AI](https://archive.gamedev.net/archive/reference/articles/article1931.html)
5. **Goal planning with roles (Gears Tactics).** A flank needs one unit to pin while another moves.
   *Taken:* role split inside a side (guards and raiders among the vanguard; haulers and builders
   among engineers). [How AI helps achieve tactical clarity in Gears Tactics](https://gamedeveloper.com/design/how-ai-helps-achieve-tactical-clarity-in-gears-tactics)
6. **Infantry doctrine: rally points, break contact, consolidate and reorganise.** A disrupted unit
   moves to the last designated rally point, leaders account for their soldiers, the unit reorganises
   and resumes the mission; after an assault it secures the position against counter-attack and resupplies.
   *Taken:* rally points, falling back to them, re-forming before going back in, and fortifying and
   resupplying a held point. *Not taken:* casualty collection points and ammunition as a consumable.
   [ATP 3-21.8 Infantry Platoon and Squad](https://tamucc.edu/education/departments/rotc/files/atp_3-21.8.pdf),
   [FM 3-21.8 The Infantry Rifle Platoon and Squad](https://usu.edu/military-science/files/tools-for-cadets/the-infantry-rifle-platoon-and-squad.pdf)

## Worth adding next

- Suppression and pinning (4), so shooters fix a squad while another flanks.
- Per-soldier cover scoring (2), so troops pick walls and breastworks rather than only using them when crossed.
- Utility scoring for squad stance in place of fixed thresholds, and an HTN or goal planner for engineers (1, 5).
- Powder for guns and ships as a consumable, and food for long sieges (6).
