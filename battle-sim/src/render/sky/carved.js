// Carved and living things aboard the realm airships, at ground-unit quality: the helmsman at the wheel (the realm's
// own sculpted soldier), sculpted figureheads (the ship figureheads of parts/bow.js, in the realm's metal and carving)
// and the sculpted engines: cowled nacelles with cooling fins and exhausts, propellers with twisted blades (and their
// shot-away twins). Sculpted pieces are meshes of their own with six detail levels, meshed on first need and shared.
import { THREE, PI, TAU, group, add, mesh, rod, ell, TORUS, CYL, lathe, tier, EMPTY } from './kit.js';
import { standingHand } from './creatures.js';
import { skinMesh } from './skin.js';
import { figureSculptGeo, weather } from '../parts/bow.js';
import { sculptL, lazyMesh, SB, S as SP, H as HP } from '../parts/kit.js';
import { styleOf as shipStyle } from '../parts/realmStyle.js';

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

/** a sculpted piece hung on P: its own mesh in the model's paint, with an entry for the detail table (X.sculpt) */
export function sculptedMesh(X, P, geos, x = 0, y = 0, z = 0, s = 1) {
  const m = lazyMesh(new THREE.Mesh(undefined, X.T.paint), geos);
  m.userData.keep = true; m.userData.lodLevel = () => X.root.userData.lod?.level ?? 0;
  m.position.set(x, y, z); m.scale.setScalar(s);
  P.add(m);
  (X.sculpt ||= []).push({ mesh: m, geos });
  return m;
}

// the airships' figure kinds as the ship sculpts name them
const FIG = { serpent: 'cobra' };
/** a sculpted figurehead under the bowsprit, facing +x (null: use the carved stand-in from deco.js) */
export function sculptedFigurehead(X, P, kind, x, y, z, s = 1) {
  const S = X.S, st0 = shipStyle({ realm: S.id, color: X.hex.hull, trim: X.hex.trim });
  const soft = S.metalKind === 'wood' || S.metalKind === 'bone';
  const st = { ...st0, id: S.id, metal: X.hex.trim, carve: soft ? (S.metalKind === 'bone' ? 0xd8cfb4 : S.wood) : X.hex.trim, metalM: soft ? 0 : st0.metalM };
  const geos = figureSculptGeo(FIG[kind] || kind, st, X.hex.hull, S.accent, 60);
  if (!geos) return null;
  const m = sculptedMesh(X, P, geos, x, y, z, s);
  m.rotation.z = -0.18; m.name = 'figurehead';
  return m;
}

// ---------- engines ----------
const f2 = (v) => v.toFixed(2);
/** a cowled engine nacelle, nose at +x, about 1.25 long (scaled by the caller): cooling fins, exhausts, rivets, a grille */
export function nacelleGeo(trim, iron, dmg = false) {
  return sculptL(`skynac|${trim}|${iron}|${dmg ? 1 : 0}`, () => {
    const B = new SB(), M = (p, k = 0.04) => p.color(trim).pbr(0.32, 0.85).blend(k).bump(0.0015, 40, 'noise');
    const prof = [[0.63, 0.025], [0.56, 0.12], [0.42, 0.2], [0.12, 0.232], [-0.22, 0.222], [-0.44, 0.17], [-0.56, 0.1], [-0.62, 0.06]];
    for (let i = 0; i < prof.length - 1; i++) B.p(M(SP.capsule([prof[i][0], 0, 0], [prof[i + 1][0], 0, 0], prof[i][1], prof[i + 1][1])));
    // the cowl ring and a band of cooling fins round the cylinders
    B.p(SP.torus(0.214, 0.026).rot(0, 0, 90).at(0.42, 0, 0).color(iron).pbr(0.45, 0.8).blend(0.01));
    for (let i = 0; i < 6; i++) B.p(SP.torus(0.236, 0.011).rot(0, 0, 90).at(-0.2 + i * 0.065, 0, 0).color(iron).pbr(0.5, 0.75).blend(0.006));
    // the intake under her chin, grilled
    B.p(SP.box(0.16, 0.06, 0.14, 0.02).at(0.38, -0.2, 0).cut(0.008).color(0x0c0a08));
    for (let i = 0; i < 4; i++) B.p(SP.box(0.015, 0.05, 0.13, 0.004).at(0.32 + i * 0.04, -0.2, 0).color(iron).pbr(0.5, 0.8).blend(0.004));
    // three exhaust stubs up her flank, sooted at the mouth
    for (let i = 0; i < 3; i++) {
      const x = 0.05 - i * 0.13, a = [x, 0.17, 0.12], b = [x - 0.06, 0.29, 0.15], c = [x - 0.15, 0.32, 0.15];
      B.p(SP.capsule(a, b, 0.032, 0.03).color(iron).pbr(0.5, 0.7).blend(0.02));
      B.p(SP.capsule(b, c, 0.03, 0.03).color(iron).pbr(0.5, 0.7).blend(0.015));
      B.p(SP.sphere(0.03).at(...c).cut(0.006).color(0x0a0806));
      B.p(SP.sphere(0.08).at(...c).paint(0.02).color(0x1a1612));
    }
    // panel seams with rivets, and the bearing the shaft runs aft through
    for (const x of [0.26, -0.34]) {
      B.p(SP.cyl(0.25, 0.008).rot(0, 0, 90).at(x, 0, 0).paint(0.002, -0.003).color(shade(trim, 0.55)));
      for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2, r = x > 0 ? 0.226 : 0.2; B.h(HP.sphere(0.011, 6).color(shade(trim, 0.7)).pbr(0.4, 0.85).at(x + 0.025, Math.cos(a) * r, Math.sin(a) * r).lod(1)); }
    }
    B.p(SP.cyl(0.05, 0.1, 0.01).rot(0, 0, 90).at(-0.65, 0, 0).color(iron).pbr(0.45, 0.8).blend(0.01));
    if (dmg) {
      // shot through: two holes in the cowl with their lips blown out, a torn panel, everything aft of them blackened
      for (const [x, a] of [[0.05, 0.9], [-0.28, 2.4]]) {
        const y = Math.sin(a) * 0.22, z = Math.cos(a) * 0.22;
        B.p(SP.sphere(0.07).at(x, y, z).cut(0.008).color(0x0a0806));
        B.p(SP.sphere(0.16).at(x - 0.05, y, z).paint(0.03).color(0x1a1512));
        for (let k = 0; k < 4; k++) { const b = (k / 4) * Math.PI * 2; B.p(SP.ellipsoid(0.035, 0.008, 0.02).rot(0, 0, (b * 180) / Math.PI).at(x + Math.cos(b) * 0.065, y + Math.sin(b) * 0.06, z * 1.12).color(0x2a2420).pbr(0.6, 0.6).blend(0.004)); }
      }
      B.p(SP.box(0.2, 0.03, 0.14, 0.01).rot(30, 0, 20).at(-0.12, 0.25, 0.1).color(trim).pbr(0.35, 0.85).blend(0.004));
      B.p(SP.ellipsoid(0.5, 0.3, 0.3).at(-0.45, 0.1, 0).paint(0.05).color(0x1e1a16));
    }
    return B.part();
  }, { res: 96, min: 12, paint: weather(trim, { kind: 'bronze', amt: 0.6, soot: 4, sootY: 0.26 }) });
}
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
/** a propeller about the x axis, blades of length R twisted from root to tip on a bolted hub, a spinner aft; shot away if broken */
export function propGeo(R, n, wood, trim, broken) {
  return sculptL(`skyprop|${f2(R)}|${n}|${wood}|${trim}|${broken ? 1 : 0}`, () => {
    const B = new SB();
    for (let i = 0; i < n; i++) {
      // shot away: one blade bent back, the rest snapped near the root
      const len = !broken || i === 0 ? R : R * (0.2 + 0.12 * ((i * 7) % 3) / 2);
      B.push([0, 0, 0], [(i / n) * 360 + (broken ? 17 : 0), broken && i === 0 ? 24 : 0, broken && i === 0 ? -18 : 0]);
      const N = 7;
      for (let k = 0; k < N; k++) {
        const t = (k + 0.5) / N, y = 0.07 + t * (len - 0.07), chord = (0.06 + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * (len < R ? 1 : 1 - 0.3 * t * t);
        B.p(SP.ellipsoid(0.014, (len / N) * 0.75, chord).rot(0, 55 - 35 * t, 0).at(0, y, 0).color(wood).pbr(0.55, 0.05).blend(0.035).bump(0.0015, 50, 'fur'));
      }
      if (len === R) B.p(SP.box(0.08, R * 0.14, 0.2, 0.01).at(0, R * 0.93, 0).paint(0.004).color(trim).pbr(0.3, 0.85)); // the tip sheathed in metal
      else { B.p(SP.sphere(0.06).at(0.01, len + 0.02, 0.03).cut(0.01)); B.p(SP.sphere(0.07).at(0, len, 0).paint(0.02).color(0x1a1410)); }
      B.pop();
    }
    B.p(SP.cyl(0.085, 0.13, 0.02).rot(0, 0, 90).color(trim).pbr(0.32, 0.85).blend(0.02));
    B.p(SP.cone(0.11, 0.004, 0.22, 0.01).rot(0, 0, 90).at(-0.15, 0, 0).color(trim).pbr(0.28, 0.85).blend(0.02));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; B.h(HP.sphere(0.012, 6).color(shade(trim, 0.7)).pbr(0.4, 0.85).at(0.066, Math.cos(a) * 0.06, Math.sin(a) * 0.06).lod(1)); }
    return B.part();
  }, { res: 110, min: 12 });
}
void lathe;
