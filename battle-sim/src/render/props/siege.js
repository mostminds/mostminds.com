// PLACEHOLDER: no siege weapons registered yet, so the legacy models are used.
// siege[model](w, h, def) -> THREE.Object3D with userData.turret (a Group at x = 0, z = 0 that yaws about Y; the barrel points +X).
export const siege = {};
/** craft(sideColorHex) -> landing craft Object3D with userData.ramp, or null to use the legacy boat */
export function craft() { return null; }
