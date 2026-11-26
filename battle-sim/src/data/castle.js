// Stamps a complete multi-level castle: corner towers (level 3), wall-walks
// (level 2) between them, a gate on the face toward `facing`, stairs (level 1)
// up to the walls on the inside, and an optional keep in the middle.
export function castleKit(x, y, size, side = 1, facing = 'west', keep = size >= 20) {
  const S = Math.max(12, size), out = [];
  const T = 3; // tower width
  const add = (o) => out.push({ rot: 0, side, ...o });
  for (const [tx, ty] of [[x, y], [x + S - T, y], [x, y + S - T], [x + S - T, y + S - T]]) add({ type: 'castleTower', x: tx, y: ty });
  const run = S - 2 * T; // wall length between towers
  const gateAt = Math.floor((run - 3) / 2);
  const face = (fx, fy, rot, withGate) => {
    if (!withGate) { add({ type: 'castleWall', x: fx, y: fy, rot, len: run }); return; }
    const a = gateAt, c = run - gateAt - 3;
    if (rot === 0) {
      if (a) add({ type: 'castleWall', x: fx, y: fy, rot, len: a });
      add({ type: 'castleGate', x: fx + a, y: fy, rot: 0 });
      if (c) add({ type: 'castleWall', x: fx + a + 3, y: fy, rot, len: c });
    } else {
      if (a) add({ type: 'castleWall', x: fx, y: fy, rot, len: a });
      add({ type: 'castleGate', x: fx, y: fy + a, rot: 1 });
      if (c) add({ type: 'castleWall', x: fx, y: fy + a + 3, rot, len: c });
    }
  };
  face(x + T, y, 0, facing === 'north');
  face(x + T, y + S - 1, 0, facing === 'south');
  face(x, y + T, 1, facing === 'west');
  face(x + S - 1, y + T, 1, facing === 'east');
  // stairs up to each wall-walk, inside the courtyard
  add({ type: 'stairs', x: x + T + 1, y: y + 1 });
  add({ type: 'stairs', x: x + S - T - 3, y: y + S - 2 });
  add({ type: 'stairs', x: x + 1, y: y + S - T - 3, rot: 1 });
  add({ type: 'stairs', x: x + S - 2, y: y + T + 1, rot: 1 });
  if (keep) add({ type: 'keep', x: x + Math.floor(S / 2) - 2, y: y + Math.floor(S / 2) - 2 });
  return out;
}
