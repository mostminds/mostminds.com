// Runs batches of headless battles off the main thread.
import { createBattle, runToEnd } from './battle.js';
import { createNaval, runNaval } from './naval.js';

self.onmessage = (ev) => {
  const { kind, scn, roster, seeds } = ev.data;
  const results = [];
  let last = performance.now();
  for (let i = 0; i < seeds.length; i++) {
    const r = kind === 'naval' ? runNaval(createNaval(scn, seeds[i], roster)) : runToEnd(createBattle(scn, roster.units || roster, seeds[i], roster.ships || {}));
    results.push(r);
    const now = performance.now();
    if (now - last > 150) { self.postMessage({ progress: i + 1 }); last = now; }
  }
  self.postMessage({ done: true, results });
};
