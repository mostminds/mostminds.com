#!/usr/bin/env node
// Renders a model preview to a PNG and prints build stats as JSON.
//   node tools/model-shot.cjs --kind unit --id knight --pose attack --out /tmp/knight.png
//   node tools/model-shot.cjs --kind unit --id militia,footman,knight --out sheet.png
//   node tools/model-shot.cjs --kind struct --id castleTower --ref 1 --out tower.png
// Options mirror viewer.html's query string: kind, id, pose, t, lod, detail, view, ref, len, cam, water, ground, opts, bbox.
//   --cam "35,17,0.5,0,1.4,0"   one free camera: azimuth, elevation (degrees), distance x fitted, optional target x,y,z
//   --cam "0,10,0.4;90,10,0.4;180,10,0.4"   several, laid out in a grid
// Extra: --width 1600 --height 1200 (image size).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const out = args.out || 'model.png';
const root = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, async () => {
  const port = server.address().port;
  const qs = new URLSearchParams();
  for (const k of ['kind', 'id', 'spec', 'pose', 't', 'lod', 'detail', 'view', 'ref', 'len', 'cam', 'water', 'ground', 'opts', 'bbox']) if (args[k] !== undefined) qs.set(k, args[k]);
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let code = 0;
  try {
    const page = await browser.newPage({ viewport: { width: +(args.width || 1600), height: +(args.height || 1200) }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.stack || e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:${port}/viewer.html?${qs}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 }).catch(() => errors.push('timed out waiting for the preview to finish building'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: out });
    const stats = await page.evaluate(() => window.__stats || {});
    stats.errors = [...(stats.errors || []), ...errors];
    stats.out = path.resolve(out);
    console.log(JSON.stringify(stats, null, 1));
    if (stats.errors.length) code = 1;
  } catch (err) { console.error(String(err.stack || err)); code = 2; }
  await browser.close();
  server.close();
  process.exit(code);
});
