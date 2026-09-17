/* ===================================================================
 * main.js – Oberfläche: Betrieb, Editor, Fahrplan, Ereignisse
 * ================================================================= */
import {
  cellAt, cellType, signalsOfCell, entries, validate, newLayout,
  platforms, DIRS, key, parseKey, switchGeom
} from './model.js';
import { Sim, hhmmss, hhmm, signedMin, parseTime, trainCells, CELL_M } from './sim.js';
import { lockRoute, releaseRoute, aspectOf, clearReachCache } from './interlocking.js';
import { EventEngine, EVENT_TYPES, defaultEventConfig } from './events.js';
import { draw } from './render.js';
import { Editor, TOOL_HELP } from './editor.js';
import { demoLayout } from './demo.js';
import * as store from './storage.js';
import { renderTimetable, generateTimetable, emptyRow, GATTUNGEN } from './timetable.js';

const $ = sel => document.querySelector(sel);
const app = {
  layout: null, sim: null, events: null,
  routeStart: null, view: 'sim', dirty: false
};

/* ------------------------- Start ------------------------- */
function boot() {
  const name = store.lastName();
  app.layout = (name && store.load(name)) || demoLayout();
  if (!app.layout.events) app.layout.events = defaultEventConfig();
  newSim();
  buildUI();
  refreshLayoutList();
  requestAnimationFrame(loop);
}

function newSim() {
  app.sim = new Sim(app.layout, logMsg);
  app.events = new EventEngine(app.sim, app.layout.events, logMsg);
  app.routeStart = null;
  $('#log') && ($('#log').innerHTML = '');
  logMsg(`Stellwerk „${app.layout.name}" geladen – ${app.layout.timetable.length} Zugfahrten im Fahrplan.`);
}

/* ------------------------- Protokoll ------------------------- */
function logMsg(text, cls = '') {
  const box = $('#log');
  if (!box) return;
  const div = document.createElement('div');
  div.innerHTML = `<span class="t">${hhmm(app.sim ? app.sim.time : 0)}</span><span class="${cls}">${escapeHtml(text)}</span>`;
  box.prepend(div);
  while (box.childElementCount > 300) box.lastElementChild.remove();
}
const escapeHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* ------------------------- Hauptschleife ------------------------- */
let lastT = performance.now();
let lastPanelUpdate = 0;
let faultSig = '';
function loop(now) {
  const dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  if (app.sim.running) {
    app.sim.tick(dt);
    app.events.autoRepair = app.sim.autoRoute;
    app.events.update();
  }
  $('#clock').textContent = hhmmss(app.sim.time);
  if (app.view === 'sim') {
    draw($('#canvas'), app.layout, app.sim, { highlight: highlightCells() });
    // Seitenleiste nur bei tatsächlichen Änderungen neu aufbauen,
    // damit Schaltflächen nicht flackern und Klicks nicht verloren gehen.
    if (now - lastPanelUpdate > 400) {
      lastPanelUpdate = now;
      updateTrainTable();
      updateFaults();
      updateScore();
    }
  } else if (app.view === 'editor') {
    draw($('#canvas-edit'), app.layout, null, { grid: true, hover: editor.hover });
    $('#element-info').innerHTML = editor.describe();
  }
  requestAnimationFrame(loop);
}

function highlightCells() {
  if (!app.routeStart) return null;
  const p = app.routeStart;
  return [p.type === 'signal' ? key(p.sig.x, p.sig.y) : key(p.cell.x, p.cell.y)];
}

/* ------------------------- Betrieb: Mausbedienung ------------------------- */
function simPick(e) {
  const L = app.layout, cs = L.cellSize;
  const r = $('#canvas').getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const cx = Math.floor(px / cs), cy = Math.floor(py / cs);

  // Signal in der Nähe?
  let bestSig = null, bestD = cs * 0.8;
  for (const id in L.signals) {
    const s = L.signals[id];
    if (Math.abs(s.x - cx) > 1 || Math.abs(s.y - cy) > 1) continue;
    const c = { px: (s.x + 0.5) * cs, py: (s.y + 0.5) * cs };
    const d = DIRS[s.dir];
    const sx = c.px + d.dx * cs * 0.40 - d.dy * cs * 0.28;
    const sy = c.py + d.dy * cs * 0.40 + d.dx * cs * 0.28;
    const dist = Math.hypot(px - sx, py - sy);
    if (dist < bestD) { bestD = dist; bestSig = s; }
  }
  if (bestSig) return { type: 'signal', sig: bestSig };

  const c = cellAt(L, cx, cy);
  if (!c) return null;
  if (c.entry) return { type: 'entry', cell: c };
  if (cellType(c) === 'switch') return { type: 'switch', cell: c };
  return { type: 'cell', cell: c };
}

function onSimClick(e) {
  const pick = simPick(e);
  if (!pick) return;
  const sim = app.sim;

  if (pick.type === 'switch' && !app.routeStart) {
    const k = key(pick.cell.x, pick.cell.y);
    if (sim.lockedCells.has(k)) return setStatus('Weiche ist in einer Fahrstraße verschlossen.', true);
    if (sim.faultySwitches.has(k)) return setStatus('Weiche ist gestört und lässt sich nicht umstellen.', true);
    if (sim.occupiedCells().has(k)) return setStatus('Weiche ist besetzt.', true);
    pick.cell.sw = pick.cell.sw ? 0 : 1;
    const g = switchGeom(pick.cell);
    logMsg(`Weiche ${k} umgestellt.`);
    return;
  }

  if (!app.routeStart) {
    if (pick.type === 'signal' || pick.type === 'entry') {
      app.routeStart = pick;
      setStatus(`Start: <b>${label(pick)}</b> – jetzt Ziel wählen (Signal oder Ausfahrt).`);
    }
    return;
  }

  // Ziel gewählt
  let dest = null;
  if (pick.type === 'signal') dest = { type: 'signal', sig: pick.sig };
  else if (pick.type === 'entry') dest = { type: 'exit', cell: pick.cell };
  else return setStatus('Ziel muss ein Signal oder eine Ausfahrt sein.', true);

  const res = lockRoute(sim, app.routeStart, dest, { substitute: e.shiftKey });
  if (res.ok) {
    sim.stats.routesSet++;
    logMsg(`Fahrstraße ${res.route.id}: ${label(app.routeStart)} → ${res.route.destName}${res.route.substitute ? ' (Ersatzsignal)' : ''} eingestellt.`, 'ok');
    setStatus(`Fahrstraße ${res.route.id} festgelegt.`);
  } else {
    setStatus(res.reason, true);
    logMsg(res.reason, 'warn');
  }
  app.routeStart = null;
}

function onSimRightClick(e) {
  e.preventDefault();
  const pick = simPick(e);
  if (app.routeStart) { app.routeStart = null; setStatus('Auswahl abgebrochen.'); return; }
  if (!pick) return;
  const k = pick.type === 'signal' ? key(pick.sig.x, pick.sig.y) : key(pick.cell.x, pick.cell.y);
  const routeId = app.sim.lockedCells.get(k) ||
    (app.sim.routes.find(r => r.signal && pick.type === 'signal' && r.signal.id === pick.sig.id) || {}).id;
  const route = app.sim.routes.find(r => r.id === routeId);
  if (!route) return setStatus('Hier ist keine Fahrstraße eingestellt.', true);
  const busy = route.steps.some(st => app.sim.occupiedCells().has(st.k));
  if (busy && !window.confirm(`${route.id} ist befahren. Trotzdem auflösen (Hilfsauflösung)?`)) return;
  releaseRoute(app.sim, route);
  const tr = app.sim.trains.find(t => t.id === route.trainId);
  if (tr) {
    // Fahrerlaubnis bis vor den aufgelösten Abschnitt zurücknehmen
    const front = Math.floor(tr.s / CELL_M);
    let cut = tr.steps.length;
    for (let i = front + 1; i < tr.steps.length; i++) {
      if (tr.stepRoutes[i] === route) { cut = i; break; }
    }
    tr.steps = tr.steps.slice(0, cut);
    tr.stepRoutes = tr.stepRoutes.slice(0, cut);
    tr.exiting = false;
  }
  logMsg(`Fahrstraße ${route.id} aufgelöst.`, 'warn');
}

const label = p => p.type === 'signal' ? p.sig.name : (p.cell.entry || 'Ausfahrt');
function setStatus(html, warn = false) {
  const el = $('#route-status');
  el.innerHTML = html;
  el.style.color = warn ? 'var(--warn)' : '';
}

/* ------------------------- Anzeigen ------------------------- */
function updateTrainTable() {
  const tb = $('#train-table tbody');
  const rows = app.sim.trains.filter(t => t.state !== 'done');
  rows.sort((a, b) => (a.plannedEntry) - (b.plannedEntry));
  tb.innerHTML = '';
  for (const t of rows.slice(0, 40)) {
    const tr = document.createElement('tr');
    const stop = t.stops[t.nextStop];
    let ziel;
    if (t.state === 'pending') ziel = `Einfahrt ${hhmm(t.plannedEntry)}`;
    else if (t.state === 'dwell') ziel = `${stop ? stop.platform : ''} – Abfahrt ${hhmm(t.departAt)}`;
    else if (stop) ziel = `${stop.platform} an ${hhmm(stop.arr)} ab ${hhmm(stop.dep)}`;
    else ziel = `Ausfahrt ${t.exitName}`;
    const dl = t.state === 'pending' ? 0 : t.delay;
    const cls = dl < 60 ? 'delay-ok' : dl < 300 ? 'delay-mid' : 'delay-bad';
    tr.innerHTML = `<td>${escapeHtml(t.nr)}<br><span class="small">${stateName(t)}</span></td>
      <td>${escapeHtml(t.entryName)}→${escapeHtml(t.exitName)}</td>
      <td>${escapeHtml(ziel)}</td>
      <td class="${cls}">${t.state === 'pending' ? '–' : signedMin(dl)}</td>`;
    tb.append(tr);
  }
}
function stateName(t) {
  if (t.state === 'pending') return 'angekündigt';
  if (t.state === 'waiting') return 'wartet auf Einfahrt';
  if (t.state === 'dwell') return 'hält';
  if (t.state === 'hold') return 'steht vor ' + (t.waitSignal ? t.waitSignal.name : 'Signal');
  return Math.round(t.v * 3.6) + ' km/h';
}

function updateFaults() {
  const box = $('#fault-list');
  const f = app.sim.faults;
  // nur neu zeichnen, wenn sich Bestand oder Entstörfortschritt geändert hat
  const sig = f.map(x => `${x.id}:${x.repairing}:${x.repairUntil ? Math.round((x.repairUntil - app.sim.time) / 60) : ''}`).join('|');
  if (sig === faultSig) return;
  faultSig = sig;
  if (!f.length) { box.innerHTML = '<em>keine Störungen</em>'; return; }
  box.innerHTML = '';
  for (const fault of f) {
    const div = document.createElement('div');
    const rest = fault.repairUntil ? Math.max(0, Math.round((fault.repairUntil - app.sim.time) / 60)) : null;
    div.innerHTML = `<span><b>${escapeHtml(fault.title)}</b><br><span class="small">${escapeHtml(fault.text)}</span></span>`;
    if (fault.repairSec) {
      const b = document.createElement('button');
      b.textContent = fault.repairing ? `noch ${rest} min` : 'Entstören';
      b.disabled = !!fault.repairing;
      b.onclick = () => app.events.startRepair(fault);
      div.append(b);
    }
    box.append(div);
  }
}

function updateScore() {
  const s = app.sim.stats;
  const q = s.finished ? Math.round(100 * s.punctual / s.finished) : 100;
  const avg = s.finished ? Math.round(s.delaySum / s.finished / 60) : 0;
  $('#score').innerHTML = `
    <span>Züge gefahren</span><b>${s.finished} / ${app.sim.trains.length}</b>
    <span>Pünktlich (&lt; 5 min)</span><b>${q} %</b>
    <span>Ø Verspätung</span><b>${avg} min</b>
    <span>größte Verspätung</span><b>${Math.round(s.maxDelay / 60)} min</b>
    <span>Fahrstraßen gestellt</span><b>${s.routesSet}</b>
    <span>aktive Störungen</span><b>${app.sim.faults.length}</b>`;
}

/* ------------------------- Editor ------------------------- */
let editor = null;
function buildEditor() {
  editor = new Editor($('#canvas-edit'), () => app.layout, () => { app.dirty = true; });
  for (const b of document.querySelectorAll('.tool')) {
    b.onclick = () => {
      document.querySelectorAll('.tool').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      editor.tool = b.dataset.tool;
      $('#tool-help').textContent = TOOL_HELP[editor.tool] || '';
    };
  }
  $('#tool-help').textContent = TOOL_HELP.track;
  $('#stw-name').onchange = e => { app.layout.name = e.target.value || 'Stellwerk'; refreshLayoutList(); };
  $('#grid-w').onchange = e => { app.layout.gridW = clampInt(e.target.value, 10, 200); app.dirty = true; };
  $('#grid-h').onchange = e => { app.layout.gridH = clampInt(e.target.value, 6, 120); app.dirty = true; };
  $('#cell-size').oninput = e => { app.layout.cellSize = clampInt(e.target.value, 14, 48); };
  $('#start-time').onchange = e => {
    const t = parseTime(e.target.value);
    if (t === null) { e.target.value = hhmm(app.layout.startTime); return; }
    app.layout.startTime = t; app.dirty = true;
  };
  $('#btn-clear').onclick = () => {
    if (!window.confirm('Gleisplan wirklich vollständig leeren?')) return;
    app.layout.cells = {}; app.layout.signals = {}; app.layout.labels = [];
    app.layout.timetable = [];
    clearReachCache(app.layout);
    app.dirty = true;
  };
  $('#btn-demo').onclick = () => {
    if (!window.confirm('Demo-Stellwerk laden? Der aktuelle Plan geht verloren, sofern nicht gespeichert.')) return;
    app.layout = demoLayout();
    newSim(); syncEditorFields(); refreshTimetable();
  };
  $('#btn-validate').onclick = () => {
    $('#validate-out').innerHTML = validate(app.layout).map(escapeHtml).join('<br>');
  };
  syncEditorFields();
}
function syncEditorFields() {
  $('#stw-name').value = app.layout.name;
  $('#grid-w').value = app.layout.gridW;
  $('#grid-h').value = app.layout.gridH;
  $('#cell-size').value = app.layout.cellSize;
  $('#start-time').value = hhmm(app.layout.startTime);
}
const clampInt = (v, a, b) => Math.max(a, Math.min(b, parseInt(v, 10) || a));

/* ------------------------- Fahrplan ------------------------- */
function refreshTimetable() {
  renderTimetable($('#tt-table tbody'), app.layout, () => { app.dirty = true; });
}

/* ------------------------- Ereignisse ------------------------- */
function buildEventsView() {
  const cfg = app.layout.events;
  $('#ev-enabled').checked = cfg.enabled;
  $('#ev-rate').value = cfg.ratePerHour;
  $('#ev-seed').value = cfg.seed;
  $('#ev-enabled').onchange = e => cfg.enabled = e.target.checked;
  $('#ev-rate').onchange = e => cfg.ratePerHour = Math.max(0, +e.target.value || 0);
  $('#ev-seed').onchange = e => { cfg.seed = parseInt(e.target.value, 10) || 0; app.events.reseed(); };
  const tb = $('#ev-table tbody');
  tb.innerHTML = '';
  for (const t of EVENT_TYPES) {
    if (!cfg.types[t.id]) cfg.types[t.id] = { enabled: true, weight: t.weight };
    const c = cfg.types[t.id];
    const tr = document.createElement('tr');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = c.enabled;
    cb.onchange = () => c.enabled = cb.checked;
    const w = document.createElement('input');
    w.type = 'number'; w.min = 0; w.max = 20; w.value = c.weight; w.style.width = '4em';
    w.onchange = () => c.weight = Math.max(0, +w.value || 0);
    const td1 = document.createElement('td'); td1.append(cb);
    const td2 = document.createElement('td'); td2.textContent = t.name;
    const td3 = document.createElement('td'); td3.append(w);
    const td4 = document.createElement('td'); td4.textContent = t.desc; td4.className = 'small';
    tr.append(td1, td2, td3, td4);
    tb.append(tr);
  }
  $('#btn-ev-test').onclick = () => {
    const f = app.events.fireRandom();
    if (!f) logMsg('Kein Ereignis möglich (keine passenden Objekte oder alle Arten abgeschaltet).', 'warn');
    switchView('sim');
  };
}

/* ------------------------- Rahmen ------------------------- */
function buildUI() {
  for (const b of document.querySelectorAll('.tab')) b.onclick = () => switchView(b.dataset.view);

  $('#btn-play').onclick = () => {
    app.sim.running = !app.sim.running;
    $('#btn-play').textContent = app.sim.running ? '⏸' : '▶';
  };
  $('#speed').onchange = e => app.sim.speedFactor = +e.target.value;
  $('#auto-route').onchange = e => {
    app.sim.autoRoute = e.target.checked;
    logMsg(e.target.checked ? 'Automatikbetrieb eingeschaltet.' : 'Automatikbetrieb ausgeschaltet.');
  };
  $('#btn-reset').onclick = () => { newSim(); $('#btn-play').textContent = '▶'; };
  $('#btn-route-cancel').onclick = () => { app.routeStart = null; setStatus('Auswahl abgebrochen.'); };
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { app.routeStart = null; setStatus('Auswahl abgebrochen.'); }
    if (e.key === ' ' && app.view === 'sim' && e.target === document.body) { e.preventDefault(); $('#btn-play').click(); }
  });

  $('#canvas').addEventListener('click', onSimClick);
  $('#canvas').addEventListener('contextmenu', onSimRightClick);
  $('#canvas-hint').textContent = 'Klick: Signal/Einfahrt wählen · Rechtsklick: Fahrstraße auflösen · Leertaste: Start/Pause';

  $('#btn-new').onclick = () => {
    const name = window.prompt('Name des neuen Stellwerks:', 'Mein Stellwerk');
    if (!name) return;
    app.layout = newLayout(name);
    app.layout.events = defaultEventConfig();
    newSim(); syncEditorFields(); refreshTimetable(); buildEventsView(); refreshLayoutList();
    switchView('editor');
  };
  $('#btn-save').onclick = () => {
    store.save(app.layout); store.setLastName(app.layout.name);
    refreshLayoutList();
    logMsg(`Stellwerk „${app.layout.name}" gespeichert.`, 'ok');
  };
  $('#btn-export').onclick = () => store.exportFile(app.layout);
  $('#btn-import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      app.layout = await store.importFile(file);
      if (!app.layout.events) app.layout.events = defaultEventConfig();
      newSim(); syncEditorFields(); refreshTimetable(); buildEventsView(); refreshLayoutList();
      logMsg(`Datei „${file.name}" geladen.`, 'ok');
    } catch (err) { window.alert('Datei konnte nicht gelesen werden: ' + err.message); }
    e.target.value = '';
  };
  $('#stw-select').onchange = e => {
    const L = store.load(e.target.value);
    if (!L) return;
    app.layout = L;
    if (!app.layout.events) app.layout.events = defaultEventConfig();
    store.setLastName(L.name);
    newSim(); syncEditorFields(); refreshTimetable(); buildEventsView();
  };

  $('#btn-add-train').onclick = () => { app.layout.timetable.push(emptyRow(app.layout)); refreshTimetable(); app.dirty = true; };
  $('#btn-gen-train').onclick = () => {
    const n = clampInt($('#gen-count').value, 1, 200);
    const rows = generateTimetable(app.layout, n, app.layout.startTime, Math.floor(Math.random() * 1e6));
    if (!rows.length) return window.alert('Kein Fahrplan möglich: Es fehlen Ein-/Ausfahrten oder befahrbare Verbindungen.');
    app.layout.timetable = rows;
    refreshTimetable();
    app.dirty = true;
    logMsg(`${rows.length} Zugfahrten erzeugt. „Betrieb zurücksetzen" übernimmt sie.`, 'ok');
  };
  $('#btn-del-all').onclick = () => {
    if (window.confirm('Gesamten Fahrplan löschen?')) { app.layout.timetable = []; refreshTimetable(); app.dirty = true; }
  };

  buildEditor();
  refreshTimetable();
  buildEventsView();
  setStatus('Startsignal oder Einfahrt anklicken.');
}

function switchView(view) {
  // Änderungen an Gleisplan/Fahrplan erfordern einen neuen Betriebsablauf
  if (view === 'sim' && app.dirty) { newSim(); app.dirty = false; $('#btn-play').textContent = '▶'; }
  app.view = view;
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.view === view);
  for (const s of document.querySelectorAll('.view')) s.classList.remove('active');
  $('#view-' + view).classList.add('active');
  if (view === 'timetable') refreshTimetable();
  if (view === 'events') buildEventsView();
  if (view === 'editor') syncEditorFields();
}

function refreshLayoutList() {
  const sel = $('#stw-select');
  const names = store.listNames();
  sel.innerHTML = '';
  const all = names.includes(app.layout.name) ? names : [app.layout.name, ...names];
  for (const n of all) {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    if (n === app.layout.name) o.selected = true;
    sel.append(o);
  }
}

boot();
