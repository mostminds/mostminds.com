// PLACEHOLDER: no buildings registered yet, so the legacy models are used.
// structures[def.model](def, w, h) -> THREE.Object3D centred on its footprint, standing on y = 0.
export const structures = {};
/** rubble(w, h, color) -> THREE.Object3D heap covering a w x h footprint, or null to use the legacy heap */
export function rubble() { return null; }
