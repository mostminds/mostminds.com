import { Stage } from './render/stage.js';
import { LandView } from './render/landView.js';
import { NavalView } from './render/navalView.js';
import { createBattle, stepBattle, prepareDef, canStand, structureFootprint } from './engine/battle.js';
import { createNaval, stepNaval } from './engine/naval.js';
import { runBatch } from './engine/batch.js';
import { TICK_MS } from './engine/combat.js';
import { UNITS } from './data/units.js';
import { SHIPS, CREATURES } from './data/naval.js';
import { STRUCTURES } from './data/structures.js';
import { PRESETS, DEFAULT_SCENARIOS } from './data/presets.js';

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- state ----------
const custom = store.get('tb.custom') || { units: {}, ships: {}, creatures: {} };
const roster = () => ({ ...UNITS, ...custom.units });
const navalDefs = () => ({ SHIPS: { ...SHIPS, ...custom.ships }, CREATURES: { ...CREATURES, ...custom.creatures } });

const state = {
  mode: 'field',
  scn: clone(DEFAULT_SCENARIOS),
  tool: null,
  rot: 0,
  speed: 2,
};
const saved = store.get('tb.state');
if (saved?.scn) { Object.assign(state.scn, saved.scn); state.mode = saved.mode || 'field'; }
for (const k of ['field', 'amphibious']) state.scn[k].mode = k;

const stage = new Stage($('view'));
let view = null;
const sim = { b: null, playing: false, acc: 0, seed: 1, started: false, ended: false };

// ---------- helpers ----------
const isNaval = () => state.mode === 'naval';
const scn = () => state.scn[state.mode];
const defFor = (id) => isNaval() ? (navalDefs().SHIPS[id] || navalDefs().CREATURES[id]) : roster()[id];
const fmtTime = (ticks) => { const s = Math.floor((ticks * TICK_MS) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const levelOf = (def) => isNaval() ? def.level : prepareDef(def).level;

function persist() { store.set('tb.state', { mode: state.mode, scn: state.scn }); }

function matchup() {
  return scn().sides.map((s) => {
    const parts = (s.groups || []).filter((g) => g.count > 0).map((g) => `${g.count} ${defFor(g.unit)?.name || g.unit}`);
    const placed = (s.placed || []).length;
    if (placed) parts.push(`${placed} placed`);
    return parts.join(', ') || 'nobody';
  }).join('  vs  ');
}

// ---------- building battles ----------
function buildSim(seed) {
  sim.seed = seed;
  sim.acc = 0; sim.ended = false;
  if (isNaval()) {
    sim.b = createNaval(scn(), seed, navalDefs());
    if (!(view instanceof NavalView)) { view?.dispose(); view = new NavalView(stage); }
  } else {
    sim.b = createBattle({ ...scn(), mode: state.mode }, roster(), seed);
    if (!(view instanceof LandView)) { view?.dispose(); view = new LandView(stage); }
  }
  view.speed = state.speed;
  view.time = performance.now() / 1000;
  view.load(sim.b);
  updateHud();
}

let rebuildTimer = 0;
function rebuildPreview() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { if (!sim.started) buildSim(sim.seed); }, 60);
  persist();
}

// ---------- HUD ----------
function sideStats(side) {
  const b = sim.b;
  if (!b) return { alive: 0, total: 0, hp: 0, max: 1 };
  const list = isNaval() ? b.ents : b.units;
  let alive = 0, hp = 0, max = 0, total = 0;
  for (const u of list) {
    const orig = isNaval() ? (u.origSide ??= u.side) : u.side;
    if (orig === side) { total++; max += isNaval() ? u.maxHp : u.def.hp; }
    if (u.alive && u.side === side) { alive++; hp += u.hp; }
  }
  return { alive, total, hp, max: max || 1 };
}
function updateHud() {
  const b = sim.b;
  const names = scn().sides.map((s, i) => s.name || `Side ${'AB'[i]}`);
  $('hudNameA').textContent = names[0]; $('hudNameB').textContent = names[1];
  const a = sideStats(0), c = sideStats(1);
  $('hudCountA').textContent = `${a.alive} / ${a.total}`;
  $('hudCountB').textContent = `${c.alive} / ${c.total}`;
  $('hudBarA').style.width = `${Math.min(100, (a.hp / a.max) * 100)}%`;
  $('hudBarB').style.width = `${Math.min(100, (c.hp / c.max) * 100)}%`;
  $('hudTime').textContent = fmtTime(b?.tick || 0);
  let st = 'Deployment';
  if (b && b.winner !== null) st = b.winner === -1 ? 'Stalemate' : `${names[b.winner]} wins!`;
  else if (sim.started) st = sim.playing ? 'Battle in progress' : 'Paused';
  $('hudState').textContent = st;
  $('play').textContent = sim.playing ? 'Pause' : sim.started && b?.winner === null ? 'Resume' : 'Start battle';
}

const ticker = $('ticker');
function pushTicker(msgs) {
  for (const m of msgs) {
    const li = document.createElement('li');
    li.textContent = m.text;
    if (m.side === 1) li.className = 'b';
    ticker.prepend(li);
  }
  while (ticker.children.length > 5) ticker.lastChild.remove();
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  try { tickFrame(now); } catch (err) { console.error(err); sim.playing = false; }
}
function tickFrame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const b = sim.b;
  if (b && sim.playing && b.winner === null) {
    sim.acc += dt * 1000 * state.speed;
    let steps = 0;
    while (sim.acc >= TICK_MS && b.winner === null && steps < 8) {
      if (isNaval()) stepNaval(b); else stepBattle(b);
      pushTicker(view.onEvents(b.events));
      sim.acc -= TICK_MS; steps++;
    }
    if (b.winner !== null) { sim.playing = false; sim.acc = 0; onBattleEnd(); }
    updateHud();
  }
  if (view) view.update(sim.playing ? sim.acc / TICK_MS : 1, now / 1000, dt, state.speed);
  stage.updateFx(dt);
  stage.render();
}

function onBattleEnd() {
  const b = sim.b, names = scn().sides.map((s) => s.name);
  pushTicker([{ side: b.winner, text: b.winner === -1 ? 'The battle ends in a stalemate' : `${names[b.winner]} hold the field after ${fmtTime(b.tick)}` }]);
}

// ---------- controls ----------
$('play').onclick = () => {
  if (!sim.started || sim.b.winner !== null) {
    if (sim.b?.winner !== null && sim.started) buildSim((Math.random() * 1e9) | 0);
    sim.started = true;
    setTool(null);
    lockEditing(true);
  }
  sim.playing = !sim.playing;
  closePanelOnPhone();
  updateHud();
};
$('reset').onclick = () => {
  sim.playing = false; sim.started = false;
  lockEditing(false);
  ticker.replaceChildren();
  buildSim((Math.random() * 1e9) | 0);
};
$('speed').onchange = (e) => { state.speed = +e.target.value; };
$('speed').value = String(state.speed);

function lockEditing(on) {
  document.querySelectorAll('#panel input, #panel select, #panel button, #panel textarea').forEach((el) => {
    if (el.closest('details') || el.id === 'preset' || el.id === 'loadPreset') return;
    el.disabled = on;
  });
  $('modeHint').textContent = on ? 'Battle running. Press Reset to edit the armies and map.' : modeHint();
}
function modeHint() {
  return {
    field: 'Two armies deploy on opposite edges. Defending sides hold position until the enemy closes in.',
    amphibious: 'Side A rides landing craft from the sea onto the island. Defenders shoot at boats before they beach; a sunk boat drowns everyone aboard.',
    naval: 'Ships fire broadsides at targets abeam, board weaker crews to capture them, and fight sea creatures. Levels are the sailing level needed for each hull.',
  }[state.mode];
}

document.querySelectorAll('.modes button').forEach((btn) => {
  btn.onclick = () => setMode(btn.dataset.mode);
});
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  sim.playing = false; sim.started = false;
  lockEditing(false);
  ticker.replaceChildren();
  setTool(null);
  $('mapBlock').hidden = isNaval();
  if (!isNaval()) unitOptions($('placeUnit'), false);
  renderSides();
  renderPresets();
  buildSim(sim.seed);
  persist();
}

// ---------- presets ----------
function renderPresets() {
  const sel = $('preset');
  sel.replaceChildren(...PRESETS.map((p) => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name + (p.mode !== state.mode ? `  (${p.mode === 'naval' ? 'Naval' : p.mode === 'amphibious' ? 'Island assault' : 'Field'})` : '');
    return o;
  }));
  const first = PRESETS.find((p) => p.mode === state.mode);
  if (first) sel.value = first.id;
}
$('loadPreset').onclick = () => {
  const p = PRESETS.find((x) => x.id === $('preset').value);
  if (!p) return;
  state.scn[p.mode] = clone({ ...p.scn, mode: p.mode === 'naval' ? undefined : p.mode });
  setMode(p.mode);
};

// ---------- armies ----------
function unitOptions(sel, withLevels = true) {
  sel.replaceChildren();
  const groups = new Map();
  if (isNaval()) {
    const d = navalDefs();
    groups.set('Ships', Object.values(d.SHIPS));
    groups.set('Sea creatures', Object.values(d.CREATURES));
  } else {
    for (const u of Object.values(roster())) {
      const c = u.category || 'Imported';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(u);
    }
  }
  for (const [name, list] of groups) {
    const og = document.createElement('optgroup'); og.label = name;
    for (const u of list) {
      const o = document.createElement('option');
      o.value = u.id;
      o.textContent = withLevels ? `${u.name} (lvl ${levelOf(u)})` : u.name;
      og.append(o);
    }
    sel.append(og);
  }
}

function unitCard(def) {
  const card = document.createElement('div');
  card.className = 'unitcard';
  if (!def) return card;
  const chips = (list) => `<div class="chips">${list.map((t) => `<span class="chip">${t}</span>`).join('')}</div>`;
  if (def.hull) {
    const c = def.cannons;
    card.innerHTML = `<div><b>${def.name}</b> · sailing level ${def.level}</div>
      <div class="stats"><span>Hull ${def.hull}</span><span>Armour ${def.armour}</span><span>Crew ${def.crew}</span><span>Speed ${def.speed}</span>
      <span>Guns ${c.perSide}×2</span><span>Dmg ${c.dmg[0]}–${c.dmg[1]}</span><span>Range ${c.range || def.musket?.range}</span><span>Reload ${c.reload}t</span></div>`;
  } else if (def.attack) {
    const a = def.attack;
    card.innerHTML = `<div><b>${def.name}</b> · level ${def.level}</div>
      <div class="stats"><span>HP ${def.hp}</span><span>Armour ${def.armour}</span><span>Speed ${def.speed}</span><span>Size ${def.size}</span>
      <span>Max hit ${a.maxHit}</span><span>Range ${a.range}</span><span>Every ${a.speed}t</span><span>Acc ${Math.round(a.acc * 100)}%</span></div>
      ${def.abilities.length ? chips(def.abilities.map((x) => x.type)) : ''}`;
  } else {
    const d = prepareDef(def);
    card.innerHTML = `<div><b>${d.name}</b> · combat level ${d.level} · ${d.style}, ${d.role}</div>
      <div class="stats"><span>HP ${d.hp}</span><span>Att ${d.att}</span><span>Str ${d.str}</span><span>Def ${d.def}</span>
      <span>Rng ${d.rng}</span><span>Mag ${d.mag}</span><span>Max ${d.max}</span><span>Spd ${d.speed}t</span>
      <span>Range ${d.range}</span><span>Move ${d.move}</span><span>Size ${d.size}</span><span>${(d.speed * 0.6).toFixed(1)}s/hit</span></div>
      ${d.abilities.length ? chips(d.abilities.map((x) => x.type + (x.style ? ` vs ${x.style}` : ''))) : ''}`;
  }
  return card;
}

function renderSides() {
  const wrap = $('sides');
  wrap.replaceChildren();
  scn().sides.forEach((side, si) => {
    side.groups ||= []; side.placed ||= [];
    const el = document.createElement('div');
    el.className = `side ${si ? 'b' : 'a'}`;
    const head = document.createElement('div'); head.className = 'side-head';
    head.innerHTML = `<span class="tag">${'AB'[si]}</span>`;
    const name = document.createElement('input');
    name.id = `sideName${si}`; name.value = side.name || ''; name.setAttribute('aria-label', `Side ${'AB'[si]} name`);
    name.oninput = () => { side.name = name.value; updateHud(); persist(); };
    head.append(name);
    if (!isNaval()) {
      const post = document.createElement('select');
      post.id = `posture${si}`; post.setAttribute('aria-label', 'Posture');
      post.innerHTML = '<option value="attack">Attack</option><option value="defend">Defend</option>';
      post.value = side.posture || 'attack';
      post.onchange = () => { side.posture = post.value; rebuildPreview(); };
      head.append(post);
    }
    el.append(head);

    const ul = document.createElement('ul'); ul.className = 'groups';
    side.groups.forEach((g, gi) => {
      const def = defFor(g.unit);
      const li = document.createElement('li');
      const nm = document.createElement('span'); nm.className = 'nm';
      nm.innerHTML = `${def?.name || g.unit} <span class="lv">lvl ${def ? levelOf(def) : '?'}</span>`;
      nm.onclick = () => { const old = el.querySelector('.unitcard'); old?.replaceWith(unitCard(def)); };
      const qty = document.createElement('input');
      qty.type = 'number'; qty.min = 0; qty.max = isNaval() ? 60 : 500; qty.value = g.count;
      qty.id = `qty${si}_${gi}`; qty.setAttribute('aria-label', `${def?.name} count`);
      qty.onchange = () => { g.count = Math.max(0, Math.min(+qty.max, +qty.value || 0)); qty.value = g.count; renderTotals(); rebuildPreview(); };
      const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = 'Remove'; rm.setAttribute('aria-label', `Remove ${def?.name}`);
      rm.onclick = () => { side.groups.splice(gi, 1); renderSides(); rebuildPreview(); };
      li.append(nm, qty, rm);
      ul.append(li);
    });
    el.append(ul);

    const add = document.createElement('div'); add.className = 'row';
    const sel = document.createElement('select'); sel.id = `addUnit${si}`; sel.setAttribute('aria-label', 'Unit to add');
    unitOptions(sel);
    const qty = document.createElement('input'); qty.type = 'number'; qty.min = 1; qty.value = isNaval() ? 1 : 10; qty.id = `addQty${si}`; qty.setAttribute('aria-label', 'Quantity');
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Add';
    btn.onclick = () => {
      const n = Math.max(1, +qty.value || 1);
      const ex = side.groups.find((g) => g.unit === sel.value);
      if (ex) ex.count += n; else side.groups.push({ unit: sel.value, count: n });
      renderSides(); rebuildPreview();
    };
    add.append(sel, qty, btn);
    el.append(add);
    const card = unitCard(defFor(sel.value));
    sel.onchange = () => el.querySelector('.unitcard').replaceWith(unitCard(defFor(sel.value)));
    el.append(card);
    const tot = document.createElement('div'); tot.className = 'side-total'; tot.dataset.side = si;
    el.append(tot);
    wrap.append(el);
  });
  renderTotals();
  const ps = $('placeSide');
  ps.options[0].textContent = scn().sides[0].name || 'Side A';
  ps.options[1].textContent = scn().sides[1].name || 'Side B';
}
function renderTotals() {
  document.querySelectorAll('.side-total').forEach((el) => {
    const side = scn().sides[+el.dataset.side];
    const n = side.groups.reduce((a, g) => a + g.count, 0) + (side.placed?.length || 0);
    const placed = side.placed?.length ? `, ${side.placed.length} hand-placed` : '';
    el.textContent = `${n} ${isNaval() ? 'vessels and creatures' : 'units'}${placed}`;
  });
}

// ---------- map editor ----------
function renderPalette() {
  const pal = $('palette');
  pal.replaceChildren();
  for (const [id, s] of Object.entries(STRUCTURES)) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s.name; b.dataset.tool = id;
    const flags = [s.blocksMove && 'blocks movement', s.blocksLos && 'blocks sight', s.cover && 'gives cover', s.elevated && 'raised: +2 range'].filter(Boolean).join(', ');
    b.title = `${s.w}×${s.h}, ${flags}`;
    b.onclick = () => setTool(state.tool?.id === id ? null : { kind: 'structure', id });
    pal.append(b);
  }
  const er = document.createElement('button');
  er.type = 'button'; er.textContent = 'Erase'; er.dataset.tool = 'erase';
  er.onclick = () => setTool(state.tool?.kind === 'erase' ? null : { kind: 'erase', id: 'erase' });
  pal.append(er);
}
function setTool(t) {
  state.tool = t;
  document.querySelectorAll('#palette button').forEach((b) => b.classList.toggle('on', !!t && b.dataset.tool === t.id));
  $('placeTool').classList.toggle('on', t?.kind === 'unit');
  view?.showGhost?.(null);
}
$('rotate').onclick = () => { state.rot = (state.rot + 1) % 2; };
window.addEventListener('keydown', (e) => { if (e.key === 'r' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) state.rot = (state.rot + 1) % 2; if (e.key === 'Escape') setTool(null); });
$('clearMap').onclick = () => { scn().structures = []; scn().sides.forEach((s) => (s.placed = [])); renderTotals(); rebuildPreview(); };
$('mapSize').onchange = (e) => {
  const n = +e.target.value;
  scn().size = n;
  scn().structures = scn().structures.filter((s) => s.x < n && s.y < n);
  scn().sides.forEach((s) => (s.placed = s.placed.filter((p) => p.x < n && p.y < n)));
  rebuildPreview();
};
$('placeTool').onclick = () => {
  if (state.tool?.kind === 'unit') return setTool(null);
  setTool({ kind: 'unit', id: 'unit', side: +$('placeSide').value, unit: $('placeUnit').value, brush: Math.max(1, Math.min(50, +$('placeBrush').value || 1)) });
};
['placeSide', 'placeUnit', 'placeBrush'].forEach((id) => $(id).addEventListener('change', () => { if (state.tool?.kind === 'unit') { setTool(null); $('placeTool').click(); } }));

function applyTool(tile) {
  const s = scn(), t = state.tool;
  if (!t || !tile || tile.x < 0 || tile.y < 0 || tile.x >= s.size || tile.y >= s.size) return;
  if (t.kind === 'structure') {
    s.structures.push({ type: t.id, x: tile.x, y: tile.y, rot: state.rot });
  } else if (t.kind === 'erase') {
    const i = s.structures.findIndex((st) => { const { w, h } = structureFootprint(st); return tile.x >= st.x && tile.y >= st.y && tile.x < st.x + w && tile.y < st.y + h; });
    if (i >= 0) s.structures.splice(i, 1);
    else for (const side of s.sides) side.placed = side.placed.filter((p) => Math.abs(p.x - tile.x) > 1 || Math.abs(p.y - tile.y) > 1);
  } else if (t.kind === 'unit') {
    const def = prepareDef(roster()[t.unit]);
    const b = sim.b, taken = new Set();
    let placed = 0;
    for (let r = 0; r < 12 && placed < t.brush; r++) {
      for (let dy = -r; dy <= r && placed < t.brush; dy++) for (let dx = -r; dx <= r && placed < t.brush; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tile.x + dx * def.size, y = tile.y + dy * def.size;
        if (taken.has(`${x},${y}`) || !canStand(b, x, y, def.size, -1)) continue;
        taken.add(`${x},${y}`);
        s.sides[t.side].placed.push({ unit: t.unit, x, y });
        placed++;
      }
    }
    renderTotals();
  }
  rebuildPreview();
}

// pointer handling: tap to apply, drag to orbit
const canvas = stage.renderer.domElement;
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 8 || sim.started || isNaval() || !state.tool) return;
  applyTool(view.pickTile(e.clientX, e.clientY));
});
canvas.addEventListener('pointermove', (e) => {
  if (isNaval() || !(view instanceof LandView)) return;
  const tile = view.pickTile(e.clientX, e.clientY);
  if (state.tool && !sim.started && e.pointerType === 'mouse') view.showGhost(state.tool, tile, state.rot);
  showTip(e, tile);
});
canvas.addEventListener('pointerleave', () => { $('tip').hidden = true; view?.showGhost?.(null); });

function showTip(e, tile) {
  const tip = $('tip');
  const b = sim.b;
  if (!tile || !b || !b.occ || e.pointerType !== 'mouse') { tip.hidden = true; return; }
  const o = tile.x >= 0 && tile.y >= 0 && tile.x < b.W && tile.y < b.H ? b.occ[tile.y * b.W + tile.x] : 0;
  if (!o) { tip.hidden = true; return; }
  const u = b.units[o - 1];
  const r = $('view').getBoundingClientRect();
  tip.textContent = `${u.def.name} · ${u.hp}/${u.def.hp} hp · ${u.kills} kills`;
  tip.style.left = `${e.clientX - r.left + 14}px`; tip.style.top = `${e.clientY - r.top + 14}px`;
  tip.hidden = false;
}

// ---------- batch simulations ----------
let batch = null;
$('batchBtn').onclick = async () => {
  if (batch) return;
  const count = +$('batchCount').value;
  sim.playing = false; updateHud();
  $('progress').hidden = false; $('result').hidden = true;
  $('progressBar').style.width = '0%';
  $('progressText').textContent = `Running ${count.toLocaleString()} battles…`;
  const t0 = performance.now();
  batch = runBatch({
    kind: isNaval() ? 'naval' : 'land',
    scn: isNaval() ? clone(scn()) : { ...clone(scn()), mode: state.mode },
    roster: isNaval() ? navalDefs() : roster(),
    count,
    onProgress: (p) => { $('progressBar').style.width = `${Math.round(p * 100)}%`; $('progressText').textContent = `Running ${count.toLocaleString()} battles… ${Math.round(p * count).toLocaleString()} done`; },
  });
  try {
    const agg = await batch.promise;
    showResult(agg, (performance.now() - t0) / 1000);
  } catch { /* cancelled */ }
  batch = null;
  $('progress').hidden = true;
};
$('cancelBatch').onclick = () => { batch?.cancel(); batch = null; $('progress').hidden = true; };
$('closeResult').onclick = () => { $('result').hidden = true; };

function showResult(agg, secs) {
  const names = scn().sides.map((s, i) => s.name || `Side ${'AB'[i]}`);
  const top = agg.top;
  $('resMatchup').textContent = matchup();
  $('resWinner').textContent = agg.wins[top] ? names[top] : 'No winner';
  $('resWinner').style.color = top === 0 ? '#9cc0ff' : '#ff9a8e';
  $('resWon').textContent = `Won ${agg.wins[top].toLocaleString()} of ${agg.n.toLocaleString()} battles`;
  $('resAvgLabel').textContent = isNaval() ? 'Average afloat, captures included' : 'Average survivors left';
  $('resAvg').textContent = `${Math.round(agg.avgSurvivors)} / ${agg.initial[top]}`;
  $('resChartTitle').textContent = `${names[top]} left standing in ${agg.wins[top].toLocaleString()} wins`;
  const chart = $('resChart');
  chart.replaceChildren();
  const maxPct = Math.max(1, ...agg.hist.map(([, c]) => c / agg.n));
  let hist = agg.hist;
  if (hist.length > 24) {
    // bucket wide ranges so the chart stays readable
    const lo = hist[0][0], hi = hist[hist.length - 1][0], step = Math.ceil((hi - lo + 1) / 20);
    const m = new Map();
    for (const [k, c] of hist) { const b = lo + Math.floor((k - lo) / step) * step; m.set(b, (m.get(b) || 0) + c); }
    hist = [...m.entries()].map(([k, c]) => [`${k}–${k + step - 1}`, c]);
  }
  const maxC = Math.max(1, ...hist.map(([, c]) => c));
  for (const [k, c] of hist) {
    const pct = (c / agg.n) * 100;
    const col = document.createElement('div'); col.className = 'col';
    col.innerHTML = `<span class="pct">${pct < 1 ? '<1' : Math.round(pct)}%</span><i style="height:${(c / maxC) * 100}%"></i><span class="x">${k}</span>`;
    chart.append(col);
  }
  void maxPct;
  const other = 1 - top;
  $('resFoot').textContent = `${names[other]} won ${agg.wins[other].toLocaleString()}, ${agg.draws.toLocaleString()} stalemates. Average battle length ${fmtTime(agg.avgTicks)} of game time. Simulated in ${secs.toFixed(1)}s.`;
  $('result').hidden = false;
}

// ---------- import / export ----------
const NUM = ['hp', 'att', 'str', 'def', 'rng', 'mag'];
function normaliseUnit(id, u) {
  if (typeof u !== 'object' || !u) throw new Error(`${id} is not an object`);
  const out = { id, name: u.name || id, category: u.category || 'Imported', style: u.style || 'melee', speed: 4, range: 1, move: 1, size: 1, bonus: {}, abilities: [], ...u };
  out.id = id;
  for (const k of NUM) { out[k] = Number(out[k] ?? 1); if (!Number.isFinite(out[k])) throw new Error(`${id}.${k} must be a number`); }
  if (!['melee', 'ranged', 'magic'].includes(out.style)) throw new Error(`${id}.style must be melee, ranged or magic`);
  if (out.style !== 'melee' && out.range === 1) out.range = 7;
  out.model ||= { body: 'humanoid', skin: 0xb0a090, cloth: 0x6a6a7a, weapon: out.style === 'ranged' ? 'longbow' : out.style === 'magic' ? 'staff' : 'sword', scale: Math.min(2.4, 0.8 + out.size * 0.3) };
  return out;
}
$('importBtn').onclick = () => {
  const msg = $('importMsg');
  try {
    const data = JSON.parse($('importText').value);
    const sets = data.units || data.ships || data.creatures ? data : { units: data };
    let n = 0;
    for (const [id, u] of Object.entries(sets.units || {})) { custom.units[id] = normaliseUnit(id, u); n++; }
    for (const [id, s] of Object.entries(sets.ships || {})) {
      if (!s.hull || !s.cannons) throw new Error(`ship ${id} needs hull and cannons`);
      custom.ships[id] = { id, name: id, level: 1, armour: 0, speed: 0.5, turn: 6, crew: 10, len: 5, beam: 2, sails: 1, color: 0x6b4a2e, sail: 0xe8e2d0, ...s }; n++;
    }
    for (const [id, c] of Object.entries(sets.creatures || {})) {
      if (!c.hp || !c.attack) throw new Error(`creature ${id} needs hp and attack`);
      custom.creatures[id] = { id, name: id, level: 1, armour: 0, speed: 0.5, size: 1.5, abilities: [], model: 'serpent', color: 0x4a6a5a, ...c }; n++;
    }
    store.set('tb.custom', custom);
    msg.textContent = `Imported ${n} ${n === 1 ? 'entry' : 'entries'}. They appear under "Imported" in the unit lists.`;
    renderSides(); unitOptions($('placeUnit'), false);
  } catch (err) {
    msg.textContent = `Could not import: ${err.message}. Check the JSON and try again.`;
  }
};
$('exportBtn').onclick = async () => {
  const text = JSON.stringify({ mode: state.mode, scenario: scn(), custom }, null, 1);
  $('importText').value = text;
  try { await navigator.clipboard.writeText(text); $('importMsg').textContent = 'Scenario copied to the clipboard and shown above.'; }
  catch { $('importText').select(); $('importMsg').textContent = 'Scenario shown above and selected. Copy it from there.'; }
};
$('importText').placeholder = `{
  "sentinel": {
    "name": "Tower Sentinel", "hp": 90, "att": 70, "str": 75,
    "def": 80, "rng": 1, "mag": 1, "style": "melee", "speed": 5,
    "size": 2, "bonus": { "att": 40, "str": 50, "defMelee": 120 },
    "abilities": [{ "type": "cleave", "radius": 1, "mult": 0.5 }]
  }
}`;

// ---------- phone sheet ----------
$('sheetToggle').onclick = () => $('panel').classList.toggle('open');
function closePanelOnPhone() { $('panel').classList.remove('open'); }

// ---------- boot ----------
renderPalette();
unitOptions($('placeUnit'), false);
$('mapSize').value = String(state.scn.field.size);
const syncSize = () => { if (!isNaval()) $('mapSize').value = String(scn().size); };
new MutationObserver(syncSize).observe($('sides'), { childList: true });
setMode(state.mode);
requestAnimationFrame(frame);
window.__tb = { state, sim };
