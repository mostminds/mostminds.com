// Carved and living things aboard the realm airships, at ground-unit quality: the helmsman at the wheel (the realm's
// own sculpted soldier) and sculpted figureheads (the heads of the game's sculpted monsters, gilded or carved).
import { THREE, PI, TAU, group, add, mesh, rod, ell, TORUS, CYL, lathe, tier, EMPTY } from './kit.js';
import { standingHand } from './creatures.js';
import { skinMesh } from './skin.js';

/** a ship's wheel on its post aft, and the realm's soldier at it, facing the bow */
export function helmsman(X) {
  const { H, C, HL, S } = X;
  if (!H || X.kind === 'crystal') return;
  const x = -HL * 0.2, z = 0;
  // the wheel: rim, spokes with turned handles, on a post
  rod(H, C.wood, [x + 0.45, 0, z], [x + 0.45, 0.62, z], 0.05, 0.06, 8);
  const w = group(H, x + 0.38, 0.78, z); w.rotation.y = PI / 2;
  add(w, mesh(TORUS(0.08, 24, 6), C.wood, 0, 0, 0, 0.3));
  add(w, mesh(CYL(10), C.trim, 0, 0, 0, 0.06, 0.12, 0.06)).rotation.x = PI / 2;
  tier(1, () => { for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; rod(w, C.wood, [0, 0, 0], [Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0], 0.014, 0.018, 5); ell(w, C.wood, Math.cos(a) * 0.43, Math.sin(a) * 0.43, 0, 0.025, 0.025, 0.025); } });
  X.blocked.push([x - 0.35, x + 0.6, -0.4, 0.4]);
  const P = standingHand(S.id);
  if (!P) return;
  const s = 1.12 / P.height;
  const holder = group(H, x - 0.05, 0.0, z); holder.rotation.y = PI / 2; holder.scale.setScalar(s);
  skinMesh(X, holder, (q) => P.geos[[0, 1, 3, 4][q]] || EMPTY, 'crew');
}

/** a sculpted figurehead (null: use the carved stand-in from deco.js) */
export function sculptedFigurehead() { return null; }
void lathe;
