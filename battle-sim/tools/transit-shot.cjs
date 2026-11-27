// Preview sheet of the supply-line vehicles (handcars or pack beasts, cable gondolas, balloons), one faction per row.
//   node tools/transit-shot.cjs --f kingdom,grom,cloven --what all --out /tmp/sheet.png
// --f     comma-separated faction ids (see FAMILY in src/render/props/transit.js)
// --what  rail | gondola | balloon | all (default all)      --zoom  1 = whole sheet, 2+ = closer (default 1)
// --yaw   degrees to turn the camera round the sheet (default 35)
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const root = path.resolve(__dirname, '..');
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}</style>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/", "@dgreenheck/three-pinata": "https://cdn.jsdelivr.net/npm/@dgreenheck/three-pinata@2.0.1/build/three-pinata.es.js" } }</script></head><body>
<script type="module">
import * as THREE from 'three';
import { transitLook, buildConsist, buildGondola, buildBalloonFor } from './src/render/props/transit.js';
const q = new URLSearchParams(location.search), facs = q.get('f').split(','), what = q.get('what') || 'all', zoom = +(q.get('zoom') || 1), yaw = (+(q.get('yaw') || 35) * Math.PI) / 180;
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(1500, 900); document.body.appendChild(r.domElement); r.shadowMap.enabled = true;
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x9fb8c8);
sc.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.1)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-8, 14, 10); sun.castShadow = true; sun.shadow.camera.left = -30; sun.shadow.camera.right = 30; sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30; sun.shadow.mapSize.set(2048, 2048); sc.add(sun);
const gnd = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a8a42 })); gnd.receiveShadow = true; sc.add(gnd);
const box = new THREE.Box3(); let tris = 0, calls = 0;
facs.forEach((f, i) => { const L = transitLook(f), z = i * 5.6, col = i % 2 ? 0xd84a4a : 0x4a7fd8; let x = 0; const row = new THREE.Group();
  if (what === 'all' || what === 'rail') for (const c of buildConsist(L, col)) { c.position.set(-x - c.userData.len / 2, 0, 0); x += c.userData.len + 0.25; row.add(c); }
  if (what === 'all' || what === 'gondola') { const gon = buildGondola(L, col); gon.position.set(what === 'all' ? 3 : 0, 2.2, 0); row.add(gon); }
  if (what === 'all' || what === 'balloon') { const bal = buildBalloonFor(L, col); bal.position.set(what === 'all' ? 7 : 0, 0, 0); row.add(bal); }
  row.position.z = z; sc.add(row); });
sc.updateMatrixWorld(true); sc.traverse((o) => { if (o.isMesh && o !== gnd) { box.expandByObject(o); calls++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); o.castShadow = true; } });
const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()), R = Math.max(s.x, s.z, s.y * 1.6) * 1.15 / zoom + 3;
const cam = new THREE.PerspectiveCamera(32, 1500 / 900, 0.1, 800); cam.position.set(c.x + Math.sin(yaw) * R, c.y + R * 0.55, c.z + Math.cos(yaw) * R); cam.lookAt(c);
r.render(sc, cam); window.__info = { triangles: Math.round(tris), meshes: calls, rows: facs.length }; window.__done = true;
</script></body></html>`;
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((q, r) => { const u = q.url.split('?')[0]; if (u === '/__sheet.html') { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE); return; } const f = path.join(root, decodeURIComponent(u)); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
server.listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } }); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 600))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.goto(`http://localhost:${server.address().port}/__sheet.html?f=${args.f || 'kingdom'}&what=${args.what || 'all'}&zoom=${args.zoom || 1}&yaw=${args.yaw || 35}`);
  await page.waitForFunction(() => window.__done, null, { timeout: 90000 }).catch(() => errors.push('timed out'));
  const info = await page.evaluate(() => window.__info || null);
  if (args.out) await page.screenshot({ path: args.out });
  console.log(JSON.stringify({ ...info, errors, out: args.out || null }));
  await browser.close(); server.close(); process.exit(errors.length ? 1 : 0);
});
