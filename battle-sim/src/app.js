import { Stage } from './render/stage.js';
import { resetModelCache } from './render/models.js';
import { LandView } from './render/landView.js';
import { NavalView } from './render/navalView.js';
import { createBattle, stepBattle, prepareDef, canStand, structureFootprint } from './engine/battle.js';
import { createNaval, stepNaval } from './engine/naval.js';
import { runBatch } from './engine/batch.js';
import { TICK_MS } from './engine/combat.js';
import { UNITS } from './data/units.js';
import { SHIPS, CREATURES, FORTS } from './data/naval.js';
import { STRUCTURES } from './data/structures.js';
import { MAP_SHAPES, BIOMES } from './engine/terrain.js';
import { addCustomModel, removeCustomModel, customModelList, restoreCustomModels, libraryAdd, libraryList, librarySearch, libraryAssign, libraryAutoMatch, libraryClear, libraryRemove } from './render/customModels.js';
import { PRESETS, DEFAULT_SCENARIOS } from './data/presets.js';
import { castleKit } from './data/castle.js';
import { generateScenario, SITES, FACTIONS } from './data/worldgen.js';
import { AIRSHIPS } from './data/airships.js';

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- state ----------
const custom = store.get('tb.custom') || { units: {}, ships: {}, creatures: {} };
const roster = () => ({ ...UNITS, ...custom.units });
const navalDefs = () => ({ SHIPS: { ...SHIPS, ...custom.ships }, CREATURES: { ...CREATURES, ...custom.creatures }, FORTS });

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
const defFor = (id) => {
  if (id?.startsWith?.('ship:')) return navalDefs().SHIPS[id.slice(5)];
  if (id?.startsWith?.('air:')) return AIRSHIPS[id.slice(4)];
  return isNaval() ? (navalDefs().SHIPS[id] || navalDefs().CREATURES[id]) : roster()[id];
};
const fmtTime = (ticks) => { const s = Math.floor((ticks * TICK_MS) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const levelOf = (def) => (isNaval() || def.hull) ? def.level : prepareDef(def).level;

function persist() { store.set('tb.state', { mode: state.mode, scn: state.scn }); }

function matchup() {
  return scn().sides.map((s) => {
    const parts = (s.groups || []).filter((g) => g.count > 0).map((g) => `${g.count} ${defFor(g.unit)?.name || g.unit}`);
    if (!isNaval()) for (const g of s.ships || []) if (g.count > 0) parts.push(`${g.count} ${navalDefs().SHIPS[g.unit]?.name || g.unit}`);
    if (!isNaval()) for (const g of s.airships || []) if (g.count > 0) parts.push(`${g.count} ${AIRSHIPS[g.unit]?.name || g.unit}`);
    const placed = (s.placed || []).length;
    if (placed) parts.push(`${placed} placed`);
    return parts.join(', ') || 'nobody';
  }).join('  vs  ');
}

// ---------- building battles ----------
// Detailed models take a moment to sculpt the first time each is needed. Whatever fits in a short
// budget is built at once; past that a progress card goes up and one model is built per frame.
let buildGen = 0;
function showLoading(label, i = 0, n = 1) {
  $('loading').hidden = label === null;
  if (label === null) return;
  $('loadingWhat').textContent = `${label} (${i + 1} of ${n})`;
  $('loadingBar').style.width = `${Math.round((i / n) * 100)}%`;
}
function buildSim(seed) {
  sim.seed = seed;
  sim.acc = 0; sim.ended = false;
  if (isNaval()) {
    sim.b = createNaval(scn(), seed, navalDefs());
    if (!(view instanceof NavalView)) { view?.dispose(); view = new NavalView(stage); }
  } else {
    sim.b = createBattle({ ...scn(), mode: state.mode }, roster(), seed, navalDefs().SHIPS);
    if (!(view instanceof LandView)) { view?.dispose(); view = new LandView(stage); }
  }
  const b = sim.b, gen = ++buildGen;
  const finish = () => {
    view.speed = state.speed;
    view.time = performance.now() / 1000;
    view.load(b);
    sim.loading = false;
    showLoading(null);
    updateHud();
  };
  const steps = view.warmList(b);
  const run = (st) => { try { st.run(); } catch (err) { console.error(err); } };
  let i = 0;
  const t0 = performance.now();
  while (i < steps.length && performance.now() - t0 < 45) run(steps[i++]);
  if (i >= steps.length) { finish(); return; }
  sim.loading = true;
  const next = () => {
    if (gen !== buildGen) return; // a newer build has replaced this one
    showLoading(steps[i].label, i, steps.length);
    requestAnimationFrame(() => setTimeout(() => { // let the card paint before the next model blocks the page
      if (gen !== buildGen) return;
      run(steps[i++]);
      if (i < steps.length) next(); else finish();
    }, 0));
  };
  next();
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
  else if (sim.loading) st = 'Sculpting models';
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
  if (b && sim.playing && !sim.loading && b.winner === null) {
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
  if (view && view.b) view.update(sim.playing && !sim.loading ? sim.acc / TICK_MS : 1, now / 1000, dt, state.speed);
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
$('quality').value = store.get('tb.quality') || 'auto';
stage.setQuality($('quality').value);
stage.onDetailChange = () => { resetModelCache(); if (sim.b && !sim.started) buildSim(sim.seed); };
$('quality').onchange = (e) => { stage.setQuality(e.target.value); store.set('tb.quality', e.target.value); };

function lockEditing(on) {
  document.querySelectorAll('#panel input, #panel select, #panel button, #panel textarea').forEach((el) => {
    if (el.closest('details') || el.id === 'preset' || el.id === 'loadPreset' || el.id === 'generate' || el.id.startsWith('gen')) return;
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
  $('seaBlock').hidden = !isNaval();
  if (!isNaval()) {
    unitOptions($('placeUnit'), false);
    $('mapShape').value = scn().shape || (mode === 'amphibious' ? 'island' : 'plains');
    $('mapBiome').value = scn().biome || 'temperate';
    $('mapSize').value = String(scn().size);
  }
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
  $('preset').value = p.id;
};

// ---------- generated scenarios ----------
$('genSite').replaceChildren(...Object.entries(SITES).map(([k, v]) => new Option(v.name, k)));
$('genSite').value = 'castle';
for (const id of ['genDef', 'genAtt']) $(id).replaceChildren(new Option('Any faction', ''), ...Object.entries(FACTIONS).map(([k, v]) => new Option(v.name, k)));
$('generate').onclick = () => {
  const g = generateScenario({ site: $('genSite').value, defender: $('genDef').value, attacker: $('genAtt').value, size: +$('genSize').value, seed: 1 + Math.floor(Math.random() * 1e9) });
  state.scn[g.mode] = clone({ ...g.scn, mode: g.mode });
  setMode(g.mode);
  $('genName').textContent = g.name;
};

// ---------- armies ----------
function unitOptions(sel, withLevels = true, withShips = false) {
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
    if (withShips) groups.set('Fire-support ships', Object.values(navalDefs().SHIPS).map((x) => ({ ...x, id: `ship:${x.id}` })));
    if (withShips) groups.set('Zeppelins', Object.values(AIRSHIPS).map((x) => ({ ...x, id: `air:${x.id}` })));
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
  if (def.hangar) {
    const c = def.cannons, u = roster();
    card.innerHTML = `<div><b>${def.name}</b> · war zeppelin</div>
      <div class="stats"><span>Hull ${def.hull}</span><span>Armour ${def.armour}</span><span>Crew ${def.crew}</span><span>Speed ${def.speed}</span>
      <span>Guns ${c.perSide}×2</span><span>Dmg ${c.dmg[0]}–${c.dmg[1]}</span><span>Range ${c.range}</span><span>Bombs ${def.bombs.maxHit}</span></div>
      ${chips([`hangar: ${def.hangar.count} ${u[def.hangar.unit]?.name || def.hangar.unit}s`, `${def.pods.pods} pods of ${def.pods.perPod} ${u[def.pods.unit]?.name || def.pods.unit}`, `ladders lift ${def.ladders.capacity}`, 'boards and can be boarded'])}`;
  } else if (def.hull) {
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
    side.ships ||= []; side.airships ||= []; side.crafts ||= [];
    const rows = [...side.groups.map((g, gi) => ({ g, gi, arr: side.groups, ship: false })),
      ...(isNaval() ? [] : side.ships.map((g, gi) => ({ g, gi, arr: side.ships, ship: true }))),
      ...(isNaval() ? [] : side.airships.map((g, gi) => ({ g, gi, arr: side.airships, ship: true, air: true })))];
    rows.forEach(({ g, gi, arr, ship, air }) => {
      const def = air ? AIRSHIPS[g.unit] : ship ? navalDefs().SHIPS[g.unit] : defFor(g.unit);
      const li = document.createElement('li');
      if (ship) li.className = air ? 'ship air' : 'ship';
      const nm = document.createElement('span'); nm.className = 'nm';
      nm.innerHTML = `${def?.name || g.unit} <span class="lv">lvl ${def ? levelOf(def) : '?'}</span>`;
      nm.onclick = () => { const old = el.querySelector('.unitcard'); old?.replaceWith(unitCard(def)); };
      const qty = document.createElement('input');
      qty.type = 'number'; qty.min = 0; qty.max = air ? 6 : isNaval() || ship ? (ship ? 30 : 60) : 500; qty.value = g.count;
      qty.id = `qty${si}_${air ? 'a' : ship ? 's' : ''}${gi}`; qty.setAttribute('aria-label', `${def?.name} count`);
      qty.onchange = () => { g.count = Math.max(0, Math.min(+qty.max, +qty.value || 0)); qty.value = g.count; renderTotals(); rebuildPreview(); };
      const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = 'Remove'; rm.setAttribute('aria-label', `Remove ${def?.name}`);
      rm.onclick = () => { arr.splice(gi, 1); renderSides(); rebuildPreview(); };
      li.append(nm, qty, rm);
      ul.append(li);
    });
    el.append(ul);

    const add = document.createElement('div'); add.className = 'row';
    const sel = document.createElement('select'); sel.id = `addUnit${si}`; sel.setAttribute('aria-label', 'Unit to add');
    unitOptions(sel, true, true);
    const qty = document.createElement('input'); qty.type = 'number'; qty.min = 1; qty.value = isNaval() ? 1 : 10; qty.id = `addQty${si}`; qty.setAttribute('aria-label', 'Quantity');
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Add';
    btn.onclick = () => {
      const n = Math.max(1, +qty.value || 1);
      const isShip = sel.value.startsWith('ship:'), isAir = sel.value.startsWith('air:');
      const arr = isAir ? side.airships : isShip ? side.ships : side.groups, id = isAir ? sel.value.slice(4) : isShip ? sel.value.slice(5) : sel.value;
      const cap = isAir ? 6 : isShip ? 30 : 500;
      const ex = arr.find((g) => g.unit === id);
      if (ex) ex.count = Math.min(cap, ex.count + (isAir ? 1 : n)); else arr.push({ unit: id, count: isAir ? 1 : Math.min(n, cap) });
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
    const ships = isNaval() ? 0 : (side.ships || []).reduce((a, g) => a + g.count, 0);
    const placed = side.placed?.length ? `, ${side.placed.length} hand-placed` : '';
    const zeps = isNaval() ? 0 : (side.airships || []).reduce((a, g) => a + g.count, 0), boats = isNaval() ? 0 : (side.crafts || []).length;
    el.textContent = `${n} ${isNaval() ? 'vessels and creatures' : 'units'}${placed}${ships ? `, ${ships} ship${ships > 1 ? 's' : ''} offshore` : ''}${zeps ? `, ${zeps} zeppelin${zeps > 1 ? 's' : ''}` : ''}${boats ? `, ${boats} landing craft` : ''}`;
  });
}

// ---------- map editor ----------
function renderPalette() {
  const pal = $('palette'), guns = $('gunPalette');
  pal.replaceChildren(); guns.replaceChildren();
  for (const [id, s] of Object.entries(STRUCTURES)) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s.name; b.dataset.tool = id;
    const flags = [s.blocksMove && 'blocks movement', s.blocksLos && 'blocks sight', s.cover && 'gives cover', s.elevated && 'raised: +2 range'].filter(Boolean).join(', ');
    const w = s.weapon;
    b.title = w ? `range ${w.range}${w.minRange ? ` (min ${w.minRange})` : ''}, max hit ${w.maxHit}, every ${w.speed} ticks${w.splash ? `, blast ${w.splash}` : ''}, ×${w.antiShip} vs ships${w.indirect ? ', fires over walls' : ''}` : `${s.w}×${s.h}, ${flags}`;
    b.onclick = () => setTool(state.tool?.id === id ? null : { kind: 'structure', id });
    (w ? guns : pal).append(b);
  }
  const fp = $('fortPalette');
  fp.replaceChildren();
  for (const [id, f] of Object.entries(FORTS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = f.name; b.dataset.tool = `fort:${id}`;
    const w = f.weapon;
    b.title = `${f.hp} hp, garrison ${f.garrison}, ${w.shots} shots of ${w.dmg[0]}–${w.dmg[1]}, range ${w.range}${w.vsCreature ? `, ×${w.vsCreature} vs creatures` : ''}${w.splash ? `, blast ${w.splash}` : ''}`;
    b.onclick = () => setTool(state.tool?.id === `fort:${id}` ? null : { kind: 'fort', id: `fort:${id}`, type: id });
    fp.append(b);
  }
  const er = document.createElement('button');
  er.type = 'button'; er.textContent = 'Erase'; er.dataset.tool = 'erase';
  er.onclick = () => setTool(state.tool?.kind === 'erase' ? null : { kind: 'erase', id: 'erase' });
  pal.append(er);
}
function setTool(t) {
  state.tool = t;
  document.querySelectorAll('#palette button, #gunPalette button, #fortPalette button').forEach((b) => b.classList.toggle('on', !!t && b.dataset.tool === t.id));
  $('islandTool').classList.toggle('on', t?.kind === 'island');
  $('kitSmall').classList.toggle('on', t?.id === 'kit16');
  $('kitLarge').classList.toggle('on', t?.id === 'kit24');
  $('seaErase').classList.toggle('on', t?.kind === 'seaErase');
  $('placeTool').classList.toggle('on', t?.kind === 'unit');
  $('moveTool').classList.toggle('on', t?.kind === 'move');
  $('deleteTool').classList.toggle('on', t?.kind === 'delUnit');
  $('craftTool').classList.toggle('on', t?.kind === 'craft');
  view?.showGhost?.(null);
}
$('rotate').onclick = () => { state.rot = (state.rot + 1) % 2; };
$('kitSmall').onclick = () => setTool(state.tool?.id === 'kit16' ? null : { kind: 'kit', id: 'kit16', size: 16 });
$('kitLarge').onclick = () => setTool(state.tool?.id === 'kit24' ? null : { kind: 'kit', id: 'kit24', size: 24 });
window.addEventListener('keydown', (e) => { if (e.key === 'r' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) state.rot = (state.rot + 1) % 2; if (e.key === 'Escape') setTool(null); });
$('clearMap').onclick = () => { scn().structures = []; scn().sides.forEach((s) => { s.placed = []; s.crafts = []; }); renderTotals(); rebuildPreview(); };
$('mapSize').onchange = (e) => {
  const n = +e.target.value;
  scn().size = n;
  scn().structures = scn().structures.filter((s) => s.x < n && s.y < n);
  scn().sides.forEach((s) => (s.placed = s.placed.filter((p) => p.x < n && p.y < n)));
  rebuildPreview();
};
$('placeTool').onclick = () => {
  if (state.tool?.kind === 'unit') return setTool(null);
  setTool({ kind: 'unit', id: 'unit', side: +$('placeSide').value, unit: $('placeUnit').value, brush: Math.max(1, Math.min(200, +$('placeBrush').value || 1)), form: $('placeForm').value });
};
const brushRadius = () => Math.max(1, Math.ceil(Math.sqrt(Math.max(1, +$('placeBrush').value || 1)) / 2) + 1);
$('moveTool').onclick = () => setTool(state.tool?.kind === 'move' ? null : { kind: 'move', id: 'move', brush: +$('placeBrush').value || 1, held: null });
$('deleteTool').onclick = () => setTool(state.tool?.kind === 'delUnit' ? null : { kind: 'delUnit', id: 'delUnit', brush: +$('placeBrush').value || 1 });
$('craftTool').onclick = () => setTool(state.tool?.kind === 'craft' ? null : { kind: 'craft', id: 'craft', side: +$('placeSide').value });

// Troops that deployed automatically become hand-placed where they stand, so they can be moved or removed one by one.
function pinSide(si) {
  const side = scn().sides[si], b = sim.b;
  if (!b || !side.groups.some((g) => g.count > 0)) return;
  const mine = b.units.filter((u) => u.side === si);
  if (mine.some((u) => u.aboard >= 0)) return; // boat-borne troops stay with their boats
  side.placed = mine.map((u) => ({ unit: u.def.id, x: u.x, y: u.y }));
  side.groups = [];
  renderSides();
}
// offsets for n soldiers in a formation facing the enemy (side A faces east)
function formation(form, n, size, side) {
  const f = side === 0 ? 1 : -1, out = [];
  if (form === 'line') { const ranks = n > 24 ? 3 : n > 8 ? 2 : 1, w = Math.ceil(n / ranks); for (let i = 0; i < n; i++) out.push([-(Math.floor(i / w)) * f, (i % w) - Math.floor(w / 2)]); }
  else if (form === 'column') { const files = n > 20 ? 3 : 2; for (let i = 0; i < n; i++) out.push([-Math.floor(i / files) * f, (i % files) - Math.floor(files / 2)]); }
  else if (form === 'wedge') { for (let r = 0, i = 0; i < n; r++) for (let k = -r; k <= r && i < n; k++, i++) out.push([-r * f, k]); }
  else if (form === 'circle') { const R = Math.max(1.5, (n * 1.15) / (2 * Math.PI)); for (let i = 0; i < n; i++) out.push([Math.round(Math.cos((i / n) * 2 * Math.PI) * R), Math.round(Math.sin((i / n) * 2 * Math.PI) * R)]); }
  else if (form === 'square') { const w = Math.ceil(Math.sqrt(n)), h = Math.ceil(n / w); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || out.length + (w - 2) * (h - 2) < n) out.push([x - (w >> 1), y - (h >> 1)]); out.length = Math.min(out.length, n); }
  else return null; // 'block': fill outward from the tile
  return out.map(([x, y]) => [x * size, y * size]);
}
['placeSide', 'placeUnit', 'placeBrush', 'placeForm'].forEach((id) => $(id).addEventListener('change', () => { if (state.tool?.kind === 'unit') { setTool(null); $('placeTool').click(); } }));

function applyTool(tile) {
  const s = scn(), t = state.tool;
  if (!t || !tile || tile.x < 0 || tile.y < 0 || tile.x >= s.size || tile.y >= s.size) return;
  if (t.kind === 'structure') {
    const st = { type: t.id, x: tile.x, y: tile.y, rot: state.rot };
    if (STRUCTURES[t.id].stretch) st.len = Math.max(1, Math.min(40, +$('wallLen').value || 4));
    if (STRUCTURES[t.id].weapon && $('gunSide').value !== '') st.side = +$('gunSide').value;
    s.structures.push(st);
  } else if (t.kind === 'kit') {
    const side = $('gunSide').value === '' ? 1 : +$('gunSide').value;
    s.structures.push(...castleKit(tile.x, tile.y, Math.min(t.size, s.size - tile.x, s.size - tile.y), side, $('kitFacing').value));
  } else if (t.kind === 'erase') {
    const i = s.structures.findIndex((st) => { const { w, h } = structureFootprint(st); return tile.x >= st.x && tile.y >= st.y && tile.x < st.x + w && tile.y < st.y + h; });
    if (i >= 0) s.structures.splice(i, 1);
    else for (const side of s.sides) side.placed = side.placed.filter((p) => Math.abs(p.x - tile.x) > 1 || Math.abs(p.y - tile.y) > 1);
  } else if (t.kind === 'craft') {
    if (sim.b.terrain[tile.y * sim.b.W + tile.x] !== 3) { $('placeHint').textContent = 'Landing craft go on open water.'; return; }
    (s.sides[t.side].crafts ||= []).push({ x: tile.x, y: tile.y });
    $('placeHint').textContent = 'Each craft carries the next six foot soldiers from that side\'s army list to the nearest enemy shore.';
    renderTotals();
  } else if (t.kind === 'delUnit') {
    const r = brushRadius() - 1;
    let hit = false;
    s.sides.forEach((side, si) => {
      if (sim.b.units.some((u) => u.side === si && u.aboard < 0 && Math.abs(u.x - tile.x) <= r && Math.abs(u.y - tile.y) <= r) && !side.placed.some((p) => Math.abs(p.x - tile.x) <= r && Math.abs(p.y - tile.y) <= r)) pinSide(si);
      const n = side.placed.length + (side.crafts || []).length;
      side.placed = side.placed.filter((p) => Math.abs(p.x - tile.x) > r || Math.abs(p.y - tile.y) > r);
      side.crafts = (side.crafts || []).filter((c) => Math.abs(c.x - tile.x) > 1 || Math.abs(c.y - tile.y) > 1);
      if (side.placed.length + side.crafts.length !== n) hit = true;
    });
    if (hit) renderSides();
  } else if (t.kind === 'move') {
    if (!t.held) {
      const r = brushRadius() - 1;
      s.sides.forEach((side, si) => { if (sim.b.units.some((u) => u.side === si && u.aboard < 0 && Math.abs(u.x - tile.x) <= r && Math.abs(u.y - tile.y) <= r)) pinSide(si); });
      const held = [];
      s.sides.forEach((side, si) => {
        side.placed.forEach((p) => { if (Math.abs(p.x - tile.x) <= r && Math.abs(p.y - tile.y) <= r) held.push({ p, si }); });
        (side.crafts || []).forEach((c) => { if (Math.abs(c.x - tile.x) <= 1 && Math.abs(c.y - tile.y) <= 1) held.push({ p: c, si, craft: true }); });
      });
      if (!held.length) { $('placeHint').textContent = 'Nothing to move there. Tap a group of troops, then tap where they should go.'; return; }
      t.held = held; t.from = tile;
      $('placeHint').textContent = `${held.length} picked up. Tap where they should go.`;
      return;
    }
    const dx = tile.x - t.from.x, dy = tile.y - t.from.y;
    for (const { p } of t.held) { p.x = Math.max(1, Math.min(s.size - 2, p.x + dx)); p.y = Math.max(1, Math.min(s.size - 2, p.y + dy)); }
    $('placeHint').textContent = `${t.held.length} moved. Tap another group to move it.`;
    t.held = null;
  } else if (t.kind === 'unit') {
    const def = prepareDef(roster()[t.unit]);
    const b = sim.b, taken = new Set();
    let placed = 0;
    const spots = formation(t.form, t.brush, def.size, t.side);
    if (spots) {
      for (const [dx, dy] of spots) {
        const x = tile.x + dx, y = tile.y + dy;
        if (taken.has(`${x},${y}`) || !canStand(b, x, y, def.size, -1)) continue;
        taken.add(`${x},${y}`);
        s.sides[t.side].placed.push({ unit: t.unit, x, y });
        placed++;
      }
    }
    for (let r = 0; !spots && r < 12 && placed < t.brush; r++) {
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
  if (moved > 8 || sim.started || !state.tool) return;
  if (isNaval()) applySeaTool(view.pickPoint(e.clientX, e.clientY));
  else applyTool(view.pickTile(e.clientX, e.clientY));
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
  tip.textContent = `${u.def.name}${u.spec && u.spec !== 'line' ? ` (${u.spec})` : ''} · ${u.hp}/${u.def.hp} hp · ${u.kills} kills${u.carry ? ' · carrying supplies' : ''}`;
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
    roster: isNaval() ? navalDefs() : { units: roster(), ships: navalDefs().SHIPS },
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

// ---------- terrain ----------
$('mapShape').replaceChildren(...Object.entries(MAP_SHAPES).map(([k, v]) => new Option(v, k)));
$('mapBiome').replaceChildren(...Object.entries(BIOMES).map(([k, v]) => new Option(v.name, k)));
$('mapShape').onchange = (e) => { scn().shape = e.target.value; rebuildPreview(); };
$('mapBiome').onchange = (e) => { scn().biome = e.target.value; rebuildPreview(); };
$('reshape').onclick = () => { scn().terrainSeed = 1 + Math.floor(Math.random() * 9999); rebuildPreview(); };

// ---------- sea map editor ----------
$('islandTool').onclick = () => setTool(state.tool?.kind === 'island' ? null : { kind: 'island', id: 'island' });
$('seaErase').onclick = () => setTool(state.tool?.kind === 'seaErase' ? null : { kind: 'seaErase', id: 'seaErase' });
$('clearSea').onclick = () => { scn().islands = []; scn().forts = []; rebuildPreview(); };
function applySeaTool(pt) {
  const s = scn(), t = state.tool;
  if (!pt || !t) return;
  s.islands ||= []; s.forts ||= [];
  const x = Math.round(pt.x * 2) / 2, y = Math.round(pt.y * 2) / 2;
  if (t.kind === 'island') s.islands.push({ x, y, r: +$('islandSize').value });
  else if (t.kind === 'fort') s.forts.push({ type: t.type, x, y, side: +$('fortSide').value });
  else if (t.kind === 'seaErase') {
    const fi = s.forts.findIndex((f) => Math.hypot(f.x - x, f.y - y) < 4);
    if (fi >= 0) s.forts.splice(fi, 1);
    else {
      const ii = s.islands.findIndex((i) => Math.hypot(i.x - x, i.y - y) < i.r + 1);
      if (ii >= 0) s.islands.splice(ii, 1);
    }
  }
  rebuildPreview();
}

// ---------- custom 3D models ----------
function renderModelPanel() {
  const sel = $('modelTarget'), keep = sel.value;
  sel.replaceChildren();
  const add = (label, entries) => {
    const og = document.createElement('optgroup'); og.label = label;
    for (const [id, d] of entries) og.append(new Option(d.name, id));
    sel.append(og);
  };
  add('Land units', Object.entries(roster()));
  add('Ships', Object.entries(navalDefs().SHIPS));
  add('Sea creatures', Object.entries(navalDefs().CREATURES));
  add('Buildings and guns', Object.entries(STRUCTURES).map(([id, d]) => [`struct:${id}`, d]));
  if (keep) sel.value = keep;
  const names = { ...roster(), ...navalDefs().SHIPS, ...navalDefs().CREATURES, ...Object.fromEntries(Object.entries(STRUCTURES).map(([id, d]) => [`struct:${id}`, d])) };
  const list = $('modelList');
  list.replaceChildren(...customModelList().map((m) => {
    const li = document.createElement('li');
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = `${names[m.id]?.name || m.id}: ${m.name}`;
    nm.title = m.clips.length ? `Clips: ${m.clips.join(', ')}` : 'No animation clips';
    const info = document.createElement('span'); info.className = 'lv'; info.textContent = `${m.clips.length} clips`;
    const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = 'Remove';
    rm.onclick = async () => { await removeCustomModel(m.id); renderModelPanel(); if (!sim.started) buildSim(sim.seed); };
    li.append(nm, info, rm);
    return li;
  }));
}
$('modelApply').onclick = async () => {
  const list = [...$('modelFile').files], msg = $('modelMsg');
  if (!list.length) { msg.textContent = 'Choose a model file first, plus any .bin, .mtl or texture files it uses.'; return; }
  const main = list.find((f) => /\.(glb|gltf|fbx|obj|ply)$/i.test(f.name));
  if (!main) { msg.textContent = 'The selection has no .glb, .gltf, .fbx, .obj or .ply file.'; return; }
  msg.textContent = `Loading ${main.name}…`;
  try {
    const files = await Promise.all(list.map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() })));
    const entry = await addCustomModel($('modelTarget').value, files, { name: main.name, scale: +$('modelScale').value || 1, yaw: +$('modelYaw').value || 0, up: $('modelUp').value });
    const extra = list.length > 1 ? ` with ${list.length - 1} supporting file${list.length > 2 ? 's' : ''}` : '';
    msg.textContent = `${main.name}${extra} assigned. ${entry.clips.length ? `Found ${entry.clips.length} animation clips.` : 'No animation clips, so it moves with a simple bob.'} If it is lying down or facing backwards, change Up axis or Turn and load it again.`;
    renderModelPanel();
    if (!sim.started) buildSim(sim.seed);
  } catch (err) {
    msg.textContent = `Could not read ${main.name}: ${err.message}. If it references other files (.bin, .mtl, textures), select them together with it.`;
  }
};

// ---------- model library ----------
const modelOpts = () => ({ scale: +$('modelScale').value || 1, yaw: +$('modelYaw').value || 0, up: $('modelUp').value });
const modelTargets = () => [
  ...Object.values(roster()).map((d) => ({ id: d.id, name: d.name })),
  ...Object.values(navalDefs().SHIPS).map((d) => ({ id: d.id, name: d.name })),
  ...Object.values(navalDefs().CREATURES).map((d) => ({ id: d.id, name: d.name })),
  ...Object.entries(STRUCTURES).map(([id, d]) => ({ id: `struct:${id}`, name: d.name })),
];
const fmtBytes = (n) => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`;
async function renderLibrary() {
  const all = await libraryList();
  const q = $('libSearch').value.trim();
  const hits = await librarySearch(q);
  $('libResults').replaceChildren(...hits.map((e) => {
    const li = document.createElement('li');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = e.name; nm.title = e.path;
    const info = document.createElement('span'); info.className = 'lv'; info.textContent = fmtBytes(e.bytes);
    const row = document.createElement('span'); row.className = 'row';
    const use = document.createElement('button'); use.type = 'button'; use.textContent = 'Assign';
    use.onclick = async () => {
      const target = $('modelTarget').value, label = $('modelTarget').selectedOptions[0]?.textContent;
      $('libMsg').textContent = `Loading ${e.name}…`;
      try { await libraryAssign(e.key, target, modelOpts()); $('libMsg').textContent = `${e.name} now stands in for ${label}.`; renderModelPanel(); if (!sim.started) buildSim(sim.seed); }
      catch (err) { $('libMsg').textContent = `Could not load ${e.name}: ${err.message}`; }
    };
    const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '×'; rm.setAttribute('aria-label', `Remove ${e.name} from the library`);
    rm.onclick = async () => { await libraryRemove(e.key); renderLibrary(); };
    row.append(use, rm);
    li.append(nm, info, row);
    return li;
  }));
  if (!$('libMsg').textContent || /in your library/.test($('libMsg').textContent)) {
    $('libMsg').textContent = all.length ? `${all.length} model${all.length > 1 ? 's' : ''} in your library${q ? `, ${hits.length} matching "${q}"` : hits.length < all.length ? `, showing the first ${hits.length}` : ''}.` : 'Your library is empty. Add a folder or files to start.';
  }
}
async function addToLibrary(input) {
  const files = [...input.files];
  if (!files.length) return;
  $('libMsg').textContent = `Reading ${files.length} files…`;
  const mapFile = files.find((f) => /^mapping\.json$/i.test(f.name));
  if (mapFile) { try { store.set('tb.modelMap', JSON.parse(await mapFile.text())); } catch { /* ignore a broken mapping file */ } }
  const n = await libraryAdd(files);
  input.value = '';
  $('libMsg').textContent = n ? `Added ${n} model${n > 1 ? 's' : ''} to your library${mapFile ? ' and saved the mapping file' : ''}.` : 'No model files found in that selection (.glb, .gltf, .fbx, .obj, .ply).';
  renderLibrary();
}
$('libFolder').onchange = (e) => addToLibrary(e.target);
$('libFiles').onchange = (e) => addToLibrary(e.target);
$('libSearch').oninput = () => { $('libMsg').textContent = ''; renderLibrary(); };
$('libClear').onclick = async () => { await libraryClear(); $('libMsg').textContent = ''; renderLibrary(); };
$('libAuto').onclick = async () => {
  $('libMsg').textContent = 'Matching names…';
  const done = await libraryAutoMatch(modelTargets(), store.get('tb.modelMap') || {}, modelOpts());
  const names = Object.fromEntries(modelTargets().map((t) => [t.id, t.name]));
  $('libMsg').textContent = done.length
    ? `Replaced ${done.length}: ${done.slice(0, 8).map((d) => `${names[d.target] || d.target} ← ${d.file}`).join(', ')}${done.length > 8 ? ', …' : ''}.`
    : 'No file names matched a unit or building. Rename files to match, or add a mapping.json.';
  renderModelPanel();
  if (!sim.started) buildSim(sim.seed);
};

// ---------- phone sheet ----------
$('sheetToggle').onclick = () => $('panel').classList.toggle('open');
function closePanelOnPhone() { $('panel').classList.remove('open'); }

// ---------- boot ----------
renderPalette();
unitOptions($('placeUnit'), false);
renderModelPanel();
renderLibrary();
restoreCustomModels().then((n) => { if (n) { renderModelPanel(); if (!sim.started) buildSim(sim.seed); } });
$('mapSize').value = String(state.scn.field.size);
const syncSize = () => { if (!isNaval()) $('mapSize').value = String(scn().size); };
new MutationObserver(syncSize).observe($('sides'), { childList: true });
setMode(state.mode);
requestAnimationFrame(frame);
window.__tb = { state, sim, stage, get view() { return view; } };
