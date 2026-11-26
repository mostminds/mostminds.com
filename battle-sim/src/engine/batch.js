// Fans a batch of seeded battles across Web Workers and aggregates the results.
import { createBattle, runToEnd } from './battle.js';
import { createNaval, runNaval } from './naval.js';

export function aggregate(results) {
  const n = results.length;
  const wins = [0, 0], draws = results.filter((r) => r.winner === -1).length;
  for (const r of results) if (r.winner >= 0) wins[r.winner]++;
  const top = wins[0] >= wins[1] ? 0 : 1;
  const hist = new Map();
  let surv = 0, ticks = 0;
  for (const r of results) {
    ticks += r.ticks;
    if (r.winner === top) { surv += r.survivors[top]; hist.set(r.survivors[top], (hist.get(r.survivors[top]) || 0) + 1); }
  }
  return {
    n, wins, draws, top, initial: results[0]?.initial || [0, 0],
    avgSurvivors: wins[top] ? surv / wins[top] : 0,
    avgTicks: n ? ticks / n : 0,
    hist: [...hist.entries()].sort((a, c) => a[0] - c[0]),
  };
}

export function runBatch({ kind, scn, roster, count, onProgress }) {
  const seeds = Array.from({ length: count }, (_, i) => 1000 + i * 7919);
  const threads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  let cancelled = false;
  const workers = [];
  const promise = new Promise((resolve, reject) => {
    let workerOk = true;
    const chunks = Array.from({ length: threads }, (_, t) => seeds.filter((_, i) => i % threads === t)).filter((c) => c.length);
    const progress = new Array(chunks.length).fill(0);
    const all = [];
    let finished = 0;
    try {
      for (const [t, chunk] of chunks.entries()) {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        workers.push(w);
        w.onmessage = (ev) => {
          if (ev.data.progress) { progress[t] = ev.data.progress; onProgress?.(progress.reduce((a, c) => a + c, 0) / count); }
          if (ev.data.done) {
            all.push(...ev.data.results); progress[t] = chunk.length; finished++;
            onProgress?.(progress.reduce((a, c) => a + c, 0) / count);
            w.terminate();
            if (finished === chunks.length) resolve(aggregate(all));
          }
        };
        w.onerror = (e) => { e.preventDefault?.(); if (workerOk) { workerOk = false; workers.forEach((x) => x.terminate()); fallback(); } };
        w.postMessage({ kind, scn, roster, seeds: chunk });
      }
    } catch { workerOk = false; fallback(); }

    // Main-thread fallback in small slices so the page stays responsive
    function fallback() {
      const out = [];
      let i = 0;
      const slice = () => {
        if (cancelled) return reject(new Error('cancelled'));
        const end = performance.now() + 30;
        while (i < seeds.length && performance.now() < end) {
          out.push(kind === 'naval' ? runNaval(createNaval(scn, seeds[i], roster)) : runToEnd(createBattle(scn, roster.units || roster, seeds[i], roster.ships || {})));
          i++;
        }
        onProgress?.(i / count);
        if (i < seeds.length) setTimeout(slice, 0); else resolve(aggregate(out));
      };
      slice();
    }
  });
  return { promise, cancel: () => { cancelled = true; workers.forEach((w) => w.terminate()); } };
}
