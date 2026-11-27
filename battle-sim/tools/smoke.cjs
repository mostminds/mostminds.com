#!/usr/bin/env node
// Loads the real game, optionally loads a preset and advances the battle, saves a
// screenshot and prints any console errors. Exit code 1 if there were errors.
//   node tools/smoke.cjs --preset highcrag --ticks 60 --zoom 0.5 --out /tmp/game.png
// --preset  preset id from src/data/presets.js (default: whatever the game opens with)
// --ticks   battle ticks to simulate before the screenshot (default 0 = deployment)
// --zoom    0..0.9, how far to move the camera toward the middle of the map
// --quality low | medium | high | ultra (default medium)
// --gen     site:defender:attacker[:size[:sea]]  (sea = temperate | arctic | desert | swamp | volcanic | jungle, for site sea)
// --gen     site:defender:attacker[:size] generates a scenario instead of loading a preset (e.g. city:kingdom:goblin)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const root = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
server.listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  let code = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    page.setDefaultTimeout(300000);
    page.on('pageerror', (e) => errors.push(String(e.stack || e)));
    page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver Message|GPU stall|WebGL|THREE\./.test(m.text()))) errors.push(m.text()); });
    await page.addInitScript((q) => { try { localStorage.clear(); localStorage.setItem('tb.quality', JSON.stringify(q)); } catch { /* no storage */ } }, args.quality || 'medium');
    await page.goto(`http://localhost:${server.address().port}/index.html`);
    await page.waitForFunction(() => window.__tb && window.__tb.sim.b, null);
    const ready = () => page.waitForFunction(() => !window.__tb.sim.loading, null);
    await ready();
    if (args.preset) { await page.selectOption('#preset', args.preset); await page.click('#loadPreset'); await page.waitForTimeout(300); await ready(); await page.waitForTimeout(1200); }
    if (args.gen) { // --gen site:defender:attacker[:size] builds a generated scenario
      const [site, def = '', att = '', size = '0', sea = ''] = args.gen.split(':');
      if (sea) await page.selectOption('#genSea', sea);
      await page.selectOption('#genSite', site); await page.selectOption('#genDef', def); await page.selectOption('#genAtt', att); await page.selectOption('#genSize', size);
      await page.click('#generate'); await page.waitForTimeout(300); await ready(); await page.waitForTimeout(1200);
    }
    if (args.eval) { // --eval "js" runs in the page after loading (window.__tb = { state, sim, stage }), then the battle is rebuilt
      await page.evaluate(args.eval); await page.click('#reset'); await page.waitForTimeout(300); await ready(); await page.waitForTimeout(1200);
    }
    const ticks = +(args.ticks || 0);
    if (ticks) {
      await page.click('#play');
      await page.evaluate(async (n) => {
        const naval = window.__tb.state.mode === 'naval';
        const m = await import(naval ? './src/engine/naval.js' : './src/engine/battle.js');
        const b = window.__tb.sim.b;
        for (let i = 0; i < n && b.winner === null; i++) { (naval ? m.stepNaval : m.stepBattle)(b); window.__tb.view?.onEvents?.(b.events); } // the view hears every event, as in normal play
      }, ticks);
      await page.waitForTimeout(2500);
      await page.click('#play');
    }
    if (args.post) { await page.evaluate(args.post); await page.waitForTimeout(3500); } // --post "js" runs after the battle has been advanced
    if (args.zoom) await page.evaluate((k) => { const st = window.__tb.stage; st.camera.position.lerp(st.controls.target, k); }, +args.zoom);
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => { const r = window.__tb.stage.renderer.info.render; const b = window.__tb.sim.b; return { drawCalls: r.calls, triangles: r.triangles, entities: (b.units || b.ents).length, tick: b.tick }; });
    if (args.out) await page.screenshot({ path: args.out });
    console.log(JSON.stringify({ ...info, errors, out: args.out ? path.resolve(args.out) : null }, null, 1));
    if (errors.length) code = 1;
  } catch (err) { console.error(String(err.stack || err)); code = 2; }
  await browser.close(); server.close(); process.exit(code);
});
