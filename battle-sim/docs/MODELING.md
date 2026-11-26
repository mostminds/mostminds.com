# Modeling guide

Every model in the game is built in code. This guide is the contract between the
model families (`src/render/bodies/*`, `src/render/props/*`) and the engine.

## The look

An original, stylized medieval-fantasy world: readable silhouettes, slightly heroic
proportions, saturated but natural colours. **High fidelity, not low-poly**: smooth
sculpted forms, real anatomy (muscle groups, hands with fingers, faces with brows,
lips and ears), layered construction on gear and buildings (plates, straps, rivets,
planks, stone courses), and surface relief (scales, fur, wood grain, chipped stone).
Designs must be your own. Do not copy the characters, creatures or art of any
existing game, film or book.

`src/render/bodies/_example.js` shows how to use the kit. It is deliberately simple:
the quality bar for real models is far above it.

## Units and axes

- 1 model unit = 1 map tile. An adult human stands **1.0** tall before the unit's
  own `model.scale`. `rigkit.assemble(desc, scale)` applies the scale; build in
  unscaled model space.
- Y is up. The ground is y = 0 and the model's feet rest on it, centred on x = z = 0.
- **Units face +Z.** A character's right hand is at −X.
- **Ships and sea creatures point +X** (bow/head toward +X), waterline at y = 0.
- Angles passed to `.rot()` are **degrees**; rig `rot` arrays are degrees; animator
  code works in radians.

## The sculpting kit (`src/render/sculpt.js`)

A part is `{ prims: [...], hard: [...] }`.

**Prims** are volumes unioned *in order* with smooth blending and then meshed:

| Constructor | Shape |
| --- | --- |
| `S.sphere(r)` | sphere |
| `S.ellipsoid(rx, ry, rz)` | ellipsoid |
| `S.capsule([ax,ay,az], [bx,by,bz], ra, rb)` | tapered capsule between two points |
| `S.box(w, h, d, round)` | rounded box, full sizes |
| `S.cyl(r, h, round)` / `S.cone(r1, r2, h, round)` | along Y, centred |
| `S.torus(R, r)` | ring around Y |
| `S.limb(points, radii)` | chain of tapered capsules |
| `S.mirrorX(list)` | the list plus mirrored copies across X = 0 |

Chain modifiers (each returns the prim):

- `.at(x,y,z)`, `.rot(degX,degY,degZ)`, `.scale(s)`: applied in call order, so `.rot().at()` rotates about the prim's own centre and then places it.
- `.color(hex)`, `.pbr(roughness, metalness)`, `.glow(0..2)`.
- `.blend(k)`: how softly it melts into what came before. `0` = crisp seam, `0.02–0.08` = flesh. Default `0.025`.
- `.cut(k)`: carve this volume out of everything before it (eye sockets, mouths, grooves, gaps between plates). Give it a `.color()` to tint the carved surface.
- `.paint(soft, raise)`: recolour the surface inside this volume without changing shape. `raise > 0` embosses (belts, trim, veins, scars, brows), `raise < 0` engraves (seams, panel lines).
- `.bump(amp, freq, kind)`: real surface relief, kinds `noise`, `scales`, `ridges`, `fur`, `rock`, `weave`. Features need to be at least ~3 cells wide to resolve (at the default 96 cells per unit that is ~0.03; raise the node's `detail` for finer relief).
- `.tint(amp, freq)`: mottle the colour (skin variation, moss, rust).
- `.mirrorX()`: a mirrored copy.

**Hard pieces** are ordinary geometry that keeps sharp edges: blades, plates, planks, gems, eyes.
`H.box(w,h,d,bevel)`, `H.sphere(r,seg)`, `H.cyl(rt,rb,h,seg)`, `H.cone`, `H.capsule`, `H.torus`,
`H.lathe(profile [[r,y],…], seg)`, `H.extrude(outline [[x,y],…], depth, bevel, holes)`,
`H.tube(points, radiusOrRadii, tubular, radial)`, `H.sheet(w,h,sx,sy, warp(u,v)→[dx,dy,dz])`,
`H.geo(anyBufferGeometry)`, `H.mirrorX(list)`.
Modifiers: `.at`, `.rot`, `.scale(sx,sy,sz)`, `.color`, `.pbr`, `.glow`, `.shade(fn)` (per-vertex colour,
`fn(x,y,z,nx,ny,nz)` in the piece's own space → hex / `[r,g,b]` / `null`), `.lod(n)`, `.mirrorX()`.

Helpers: `rgb(hex)`, `noise3`, `fbm3`, `cells3`, `distanceTo(prims, x, y, z)` (signed distance to a
prim list, for fitting gear to a body), `buildPartGeometry(part, { res, lod, ao })`,
`sculptMesh(part, opts)` (one static mesh), `sculptMaterial()`.

Things that matter:

- Every vertex gets baked ambient occlusion from the prims, so overlapping volumes read as creases. Hard pieces pick up contact shadow from the prims of the same part.
- Colours meet more sharply than shapes, so a blended sleeve still has a clean cuff line.
- Put anything that must be crisp (eyes, teeth, claws, blades, buckles, rivets) in `hard`.
- A prim only blends with prims in the **same node**. Hide joints between nodes with an overlapping ball of the neighbouring colour on each side.

## Rigs (`src/render/rigkit.js`, `src/render/animate.js`)

A body builder returns a description:

```js
{ kind: 'biped', attack: 'swing', nodes: [
  { name: 'root', pos: [0, 0, 0] },
  { name: 'torso', parent: 'root', rig: 'torso', pos: [0, hipY, 0], prims: [...], hard: [...], detail: 1 },
  ...
] }
```

- A node is one rigid piece that rotates about its own origin (`pos`, in its parent's space). Parents must be listed before children.
- `rig` files the node where animators look for it. Single nodes: `torso head neck jaw core body log`. Lists (in order): `legs shins arms forearms wings wingtips tail wheels shards`.
- `detail` multiplies the sculpt resolution for that node (use ~1.5–2 on heads).
- Bipeds: `legs`/`shins` and `arms`/`forearms` are `[left (+X), right (−X)]`. The **right arm (index 1) carries the weapon**, the left the shield. Limbs hang down −Y in the rest pose.
- Quadrupeds: `legs`/`shins` are `[front-left, front-right, back-left, back-right]`.
- `kind` picks the animator: `biped`, `quad`, `spider`, `float`, `ram`. `attack` picks the motion: `swing thrust shoot cast claw slam bite`.
- Need different motion? Export `animators = { myKind(rig, inner, ctx, base) { ... } }` from your module. `ctx = { t, moving, atk (−1 or 0..1), dead (0 or 0..1.5), phase, flying }`; `base` has `R(node, rx, ry, rz)` (rest pose + offset, radians), `P`, `keys`, `upperBody`, `flap`, `wagTail`, `die`, and the stock animators to delegate to.

Each node is meshed at several detail levels automatically; the last level is one merged mesh in
the rest pose. Hard pieces appear on **every** level unless flagged: `.lod(0)` = closest level only,
`.lod(1)` = two closest. Un-flagged pieces smaller than about 2% of a unit are dropped automatically
at distance, but flag generously: rivets, stitches, teeth, fingernails are `.lod(0)` or `.lod(1)`.

### Budgets (at the `high` preset; the preview prints them)

| | Closest level | Far (last) level | Build time |
| --- | --- | --- | --- |
| Human-sized unit, fully equipped | 40k–90k triangles | under 3,500 | under 0.6 s |
| Large monster (size 2–3) | 60k–160k | under 6,000 | under 1.2 s |
| Small prop (crate, tree, rock) | 3k–12k | n/a | fast |
| Wall section, gun, landing craft | 8k–30k | n/a | |
| Tower, house, keep, ship | 25k–120k | n/a | |

Spend triangles where the eye goes: heads, hands, weapons, silhouettes.

## Family contracts

### Humanoids (`bodies/humanoid.js`, `bodies/anatomy.js`, `bodies/gear.js`, `bodies/weapons.js`)

- `bodies.humanoid(def, o)` → description. `o` is the unit's `model` field: `species`, `build`, `skin`, `cloth`, `armor`, `weapon`, `shield`, `helm` (`true` | `'full'` | `'horned'`), `hood`, `robe`, `horns`, `wings`, `cyclops`, `hunch`, `outfit`, plus `pose: 'riding'` when a mount asks for a rider (legs astride a saddle about 0.3 wide, seat at the hip joint).
- Node names: `root`, `legL`, `shinL`, `legR`, `shinR`, `torso`, `head`, `armL`, `foreL`, `armR`, `foreR`, plus optional wings/tails. Joint positions come from `proportions(o)` in `anatomy.js`.
- `gear.dress(ctx)` adds clothing and armour; `ctx = { def, o, P, pose, nodes, add(nodeName, { prims, hard }) }` where `nodes[name].prims` is the bare body so gear can wrap it.
- `weapons.weapon(kind)` → `{ prims, hard, hold, attack, length }` in the **weapon frame**: grip at the origin, business end along **+Y**, edge/front toward **+Z**. `weapons.shield(opts)` → `{ prims, hard }`, outer face **+Z**, top **+Y**. The humanoid attaches them to `foreR` / `foreL` and sets the description's `attack` from the weapon.

### Other bodies

`bodies.<name>(def, o)` for `skeleton`, `quadruped`, `rider`, `spider`, `bat`, `dragon`, `golem`,
`elemental`, `ram`. Builders may special-case `def.id` for per-unit flourishes.

### Buildings (`props/buildings.js`)

`structures[def.model](def, w, h)` → `THREE.Object3D` centred on its footprint (`w` tiles along X,
`h` along Z; rotated pieces arrive with `w` and `h` swapped), resting on y = 0.

- Walk surfaces must be flat, clear, and exactly at `LEVEL_H × level` (`LEVEL_H` = 0.8, from `models.js`): watchtower deck and castle wall-walk at 1.6, castle tower top at 2.4, raised deck, bastion and stairs at 0.8. Parapets and crenellations go on the edges only.
- The archway (`gate`) must leave its passage open; `castleGate` is a closed door filling its footprint.
- `castleWall` is stretchable: its length (the larger of `w`, `h`) varies from 1 to 40.
- `rubble(w, h, colorHex)` → a heap of debris for a destroyed structure.
- Keep each structure to a handful of meshes (merge geometry). Set `castShadow`/`receiveShadow`.

### Siege weapons and landing craft (`props/siege.js`)

- `siege[model](w, h, def)` for `cannon`, `ballista`, `mortar`, `battery` (2×2 stone emplacement), `harpoon`, `seaFort` (naval fort; `w` is its radius). Must set `userData.turret`: a Group **at x = 0, z = 0** that the game yaws about Y; the barrel points **+X** at yaw 0. The game nudges the turret's x/z for recoil.
- `craft(sideColorHex)` → landing craft about 2.2 long (bow +X), 1.5 wide, deck near y = 0.1, with `userData.ramp`: a Group hinged at the bow that the game rotates about Z (0 = up, −1.4 = dropped).

### Ships (`props/ships.js`)

`ship(def, sideColorHex)` → hull `def.len` long and `def.beam` wide, `def.sails` masts,
`def.cannons.perSide` guns per broadside, hull colour `def.color`, sail colour `def.sail`, a flag in the
side colour. The eight classes run from a log raft to a ship of the line; scale the rigging and
ornament with the class.

### Sea creatures (`props/seacreatures.js`)

`creatures[def.model](def)` for `crab`, `shark`, `eel`, `siren`, `serpent`, `kraken`, `leviathan`.
Return `cloneRigged(template)` of a cached `assemble(desc, scale)`. The body should fit inside a
circle of radius about `def.size × 1.3`. `animators[rig.kind](model, { t, phase })` poses it each frame.

## Checking your work

```sh
cd battle-sim
node tools/model-shot.cjs --kind unit --id knight --out /tmp/x/knight.png            # four views + stats
node tools/model-shot.cjs --kind unit --id knight --pose attack --t 0.4 --out ...     # poses: idle walk attack death fly
node tools/model-shot.cjs --kind unit --id militia,footman,knight --out sheet.png     # several side by side
node tools/model-shot.cjs --kind unit --id knight --lod 2 --out ...                   # a far detail level
node tools/model-shot.cjs --kind struct --id castleTower --ref 1 --out ...            # with a footman for scale
node tools/model-shot.cjs --kind ship --id frigate --out ...   (also: creature, fort, craft)
node tools/model-shot.cjs --kind weapon --id sword,greataxe,shield:kite --out ...     # weapons on their own, +Y up
node tools/smoke.cjs --preset highcrag --ticks 60 --zoom 0.5 --out /tmp/x/game.png    # the real game
```

The tool prints JSON: triangles per detail level, build time, and any errors (a builder that throws
falls back to the old model and is listed under `errors`). **Open the PNG and look at it.** Check every
pose, the far levels, and the whole family side by side. Iterate until it would hold up next to
hand-made art.
