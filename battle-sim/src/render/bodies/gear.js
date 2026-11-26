// Clothing, armour, headgear, capes and robes for humanoid bodies. PLACEHOLDER: dresses nothing yet.
//
// dress(ctx) is called once per humanoid after its bare body exists.
//   ctx.def   the unit definition (ctx.def.id is the unit id, e.g. 'knight')
//   ctx.o     the unit's model descriptor (species, cloth, armor, helm, hood, robe, shield, outfit, ...)
//   ctx.P     proportions from anatomy.js
//   ctx.add(nodeName, { prims: [...], hard: [...] })  appends pieces to a rig node, in that node's space
//             node names: root, torso, head, legL, legR, shinL, shinR, armL, armR, foreL, foreR
//   ctx.pose  'stand' | 'riding'
export function dress() {}
