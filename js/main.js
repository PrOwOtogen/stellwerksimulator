/* ===================================================================
 * main.js – Start, Hauptschleife, Kopfleiste und Tastatur
 * ================================================================= */
import { app, register, call } from './ui/app.js';
import { $, $$, h, esc, toast, openModal, closeModal, modalOpen, hideCtx } from './ui/dom.js';
import { applyIcons, icon } from './ui/icons.js';
import { Sim, hhmmss, hhmm, trainCells } from './sim.js';
import { EventEngine, defaultEventConfig } from './events.js';
import { ScoreKeeper } from './scoring.js';
import { sound } from './sound.js';
import { defaultSettings } from './model.js';
import { demoLayout } from './demo.js';
import { LAYOUT_TEMPLATES } from './layouts.js';
import { scenarioById } from './scenarios.js';
import { lockRoute, releaseRoute } from './interlocking.js';
import * as store from './storage.js';
import {
  initSimView, drawSim, updatePanels, logMsg, clearLog, setStatus, setAuto, setShunt,
  showPane, syncSimControls, viewport, scrollToTrain
} from './ui/simview.js';
import { initEditorView, drawEditor, syncEditorFields, editorKey, editViewport } from './ui/editorview.js';
import { initTimetableView, refreshTimetable } from './ui/timetableview.js';
import { initEventsView, buildEventsView } from './ui/eventsview.js';
import { initDiagrams, drawDiagram, buildReport, resetDiagramWindow } from './ui/diagrams.js';
import { buildSettings } from './ui/settingsview.js';
import {
  showStartScreen, showScenarios, startScenario, updateScenario, renderHud, showSavegames, showHelp, showScore
} from './ui/gamemode.js';
import { startTutorial, stopTutorial } from './ui/tutorial.js';

/* ============================ Betrieb aufbauen ============================ */
function newSim() {
  app.sim = new Sim(app.layout, logMsg);
  app.events = new EventEngine(app.sim, app.layout.events, logMsg);
  app.score?.dispose();
  app.score = new ScoreKeeper(app.sim);
  app.score.onChange((pts, text) => {
    logMsg(`${pts > 0 ? '+' : ''}${pts} Punkte – ${text}`, 'pts');
    updateScoreChip(true);
  });
  app.sim.on(soundHook);
  app.routeStart = null;
  app.followTrain = null;
  clearLog();
  logMsg(`Stellwerk „${app.layout.name}" – ${app.layout.timetable.length} Zugfahrten im Fahrplan.`);
  syncSimControls();
  syncPlay();
  updateScoreChip();
}

function soundHook(type, d) {
  if (type === 'message') {
    if (d.kind === 'offer') sound.bell();
    else if (d.kind === 'call') sound.chime();
  }
  if (type === 'fault') sound.alarm();
}

/** anderes Stellwerk übernehmen (Vorlage, Szenario, gespeichert, Import) */
function loadLayout(L, modeLabel = 'Freies Spiel') {
  stopTutorial();
  app.scenario = null;
  if (!L.events) L.events = defaultEventConfig();
  L.settings = { ...defaultSettings(), ...(L.settings || {}) };
  app.layout = L;
  app.modeLabel = modeLabel;
  newSim();
  app.dirty = false;
  if (app.editor) { app.editor.undoStack = []; app.editor.redoStack = []; app.editor.selection = null; }
  syncEditorFields(); refreshTimetable(); buildEventsView(); resetDiagramWindow();
  refreshTitle(); refreshLayoutList();
  setStatus('Startsignal oder Einfahrt anklicken.');
  requestAnimationFrame(() => { viewport.fit(); editViewport.fit(); });
}

function newLayoutDialog() {
  openModal('Neues Stellwerk', body => {
    body.append(h('div', { class: 'settings-grid', html: `
      <label>Vorlage</label><select id="nl-tpl">${Object.keys(LAYOUT_TEMPLATES).map(n => `<option${n.startsWith('Leeres') ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <label>Name</label><input id="nl-name" type="text" value="Mein Stellwerk">` }));
    body.append(h('p', { class: 'small' }, 'Die Vorlagen bringen Gleisplan, Signale und Fahrplan mit. Das leere Stellwerk öffnet den Editor.'));
    return () => {
      const tpl = $('#nl-tpl').value;
      const L = LAYOUT_TEMPLATES[tpl]();
      const nm = $('#nl-name').value.trim();
      if (nm) L.name = nm;
      loadLayout(L, 'Freies Spiel');
      switchView(L.timetable.length ? 'sim' : 'editor');
      toast(`„${L.name}" angelegt.`, 'ok');
    };
  });
}

/* ============================ Ansichten ============================ */
function switchView(view) {
  if (view === 'sim' && app.dirty) {
    const hadScenario = !!app.scenario;
    newSim();
    app.dirty = false;
    if (hadScenario) { app.scenario = null; toast('Anlage geändert – das Szenario wurde beendet.', 'warn'); }
  }
  app.view = view;
  hideCtx();
  $$('#topbar [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + view));
  if (view === 'timetable') refreshTimetable();
  if (view === 'events') buildEventsView();
  if (view === 'editor') { syncEditorFields(); if (!app.editorFitted) { app.editorFitted = true; requestAnimationFrame(() => editViewport.fit()); } }
  if (view === 'diagrams') requestAnimationFrame(drawDiagram);
  if (view === 'report') requestAnimationFrame(buildReport);
  if (view === 'settings') buildSettings(() => { newSim(); app.dirty = false; });
}

function refreshTitle() {
  $('#stw-title').textContent = app.layout.name;
  $('#mode-label').textContent = app.modeLabel || 'Freies Spiel';
  document.title = `${app.layout.name} – Stellwerksimulator`;
}

function refreshLayoutList() {
  const sel = $('#stw-select');
  const names = store.listNames();
  const all = names.includes(app.layout.name) ? names : [app.layout.name, ...names];
  sel.innerHTML = all.map(n => `<option${n === app.layout.name ? ' selected' : ''}>${esc(n)}</option>`).join('');
}

function syncPlay() {
  const run = !!app.sim?.running;
  $('#btn-play').innerHTML = icon(run ? 'pause' : 'play');
  $('#clock').classList.toggle('running', run);
  $$('#speed-seg button').forEach(b => b.classList.toggle('active', +b.dataset.speed === app.sim?.speedFactor));
}

function updateScoreChip(bump = false) {
  $('#score-val').textContent = app.score ? app.score.points : 0;
  if (bump) {
    const c = $('#score-chip');
    c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
  }
}

function setSpeed(v) { app.sim.speedFactor = v; syncPlay(); }

/* ============================ Zeitsprung ============================ */
function fastForward() {
  const sim = app.sim;
  const target = sim.nextInterestingTime();
  if (target === null) return toast('Gerade fahren Züge – ein Zeitsprung ist jetzt nicht möglich.', 'warn');
  if (target <= sim.time + 10) return toast('Gleich passiert etwas – kein Zeitsprung nötig.');
  const running = sim.running, sf = sim.speedFactor, from = sim.time, mc = sim.msgCounter;
  sim.running = true; sim.speedFactor = 1;
  for (let i = 0; i < 7200 && sim.time < target; i++) {
    sim.tick(1); app.events.update();
    if (app.scenario) updateScenario();
    if (sim.msgCounter !== mc && sim.messages[0]?.actions.length) break;
    if (sim.trains.some(t => t.state === 'run' && t.v > 0.5)) break;
  }
  sim.speedFactor = sf; sim.running = running;
  toast(`Zeitsprung: ${Math.round((sim.time - from) / 60)} min vorgespult (jetzt ${hhmm(sim.time)}).`);
}

/* ============================ Hauptschleife ============================ */
let lastT = performance.now(), lastPanel = 0, lastDiag = 0, lastFollow = 0;
function loop(now) {
  const dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  const sim = app.sim;
  if (sim.running) {
    sim.tick(dt);
    app.events.autoRepair = sim.autoRoute;
    app.events.update();
  }
  if (app.scenario) updateScenario();
  if (app.tutorial) app.tutorial.update();
  $('#clock').textContent = hhmmss(sim.time);

  if (app.view === 'sim') {
    drawSim();
    if (app.followTrain && now - lastFollow > 900) {
      lastFollow = now;
      const tr = sim.trains.find(t => t.id === app.followTrain);
      if (tr && trainCells(tr).length) scrollToTrain(tr);
      else if (!tr || tr.state === 'done') app.followTrain = null;
    }
  } else if (app.view === 'editor') drawEditor();
  if (now - lastPanel > 400) {
    lastPanel = now;
    if (app.view === 'sim') { updatePanels(); renderHud(); }
  }
  if (app.view === 'diagrams' && sim.running && now - lastDiag > 2000) { lastDiag = now; drawDiagram(); }
  requestAnimationFrame(loop);
}

/* ============================ Kopfleiste ============================ */
function wireHeader() {
  $$('#topbar [data-view]').forEach(b => {
    b.onclick = () => switchView(b.dataset.view);
    if (!b.title) b.title = b.textContent.trim();
  });
  $('#btn-home').onclick = showStartScreen;
  $('#btn-play').onclick = () => { app.sim.running = !app.sim.running; syncPlay(); };
  $$('#speed-seg button').forEach(b => b.onclick = () => setSpeed(+b.dataset.speed));
  $('#btn-skip').onclick = fastForward;
  $('#score-chip').onclick = showScore;
  const syncSound = () => { $('#btn-sound').innerHTML = icon(sound.enabled ? 'sound' : 'mute'); };
  $('#btn-sound').onclick = () => { sound.setEnabled(!sound.enabled); syncSound(); if (sound.enabled) sound.chime(); toast(sound.enabled ? 'Signaltöne an' : 'Signaltöne aus'); };
  syncSound();

  const menu = $('#main-menu');
  $('#btn-menu').onclick = e => { e.stopPropagation(); menu.classList.toggle('hidden'); };
  document.addEventListener('click', e => {
    if (!e.target.closest('.menu-wrap')) menu.classList.add('hidden');
    if (!e.target.closest('#ctxmenu')) hideCtx();
  });
  $$('#main-menu [data-cmd]').forEach(b => b.onclick = () => { menu.classList.add('hidden'); command(b.dataset.cmd); });
  $('#stw-select').onchange = e => {
    const L = store.load(e.target.value);
    menu.classList.add('hidden');
    if (L) { loadLayout(L, 'Freies Spiel'); store.setLastName(L.name); }
  };
  $('#import-file').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      loadLayout(await store.importFile(file), 'Freies Spiel');
      toast(`Datei „${file.name}" geladen.`, 'ok');
    } catch (err) { toast('Datei konnte nicht gelesen werden: ' + err.message, 'bad'); }
    e.target.value = '';
  };
}

function command(cmd) {
  switch (cmd) {
    case 'home': return showStartScreen();
    case 'scenarios': return showScenarios();
    case 'tutorial': return startTutorial();
    case 'new': return newLayoutDialog();
    case 'save':
      store.save(app.layout); store.setLastName(app.layout.name); refreshLayoutList();
      return toast(`Stellwerk „${app.layout.name}" gespeichert.`, 'ok');
    case 'export': return store.exportFile(app.layout);
    case 'import': return $('#import-file').click();
    case 'savegames': return showSavegames();
    case 'reset':
      newSim(); app.dirty = false;
      if (app.scenario) { app.scenario = null; toast('Szenario abgebrochen.'); }
      return toast('Betrieb zurückgesetzt.');
    case 'help': return showHelp();
  }
}

/* ============================ Tastatur ============================ */
function wireKeys() {
  window.addEventListener('keydown', e => {
    const inField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
    if (e.key === 'Escape') {
      app.routeStart = null; hideCtx(); $('#main-menu').classList.add('hidden');
      if (modalOpen()) closeModal();
      if (app.view === 'sim') setStatus('Auswahl abgebrochen.');
      if (app.view === 'editor' && app.editor.selection) { app.editor.selection = null; $('#area-actions').classList.add('hidden'); }
      return;
    }
    if (e.key === 'F1') { e.preventDefault(); showHelp(); return; }
    if (inField || modalOpen()) return;
    const k = e.key.toLowerCase();
    if (app.view === 'sim') {
      if (e.key === ' ') {
        e.preventDefault();
        if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
        app.sim.running = !app.sim.running; syncPlay();
      }
      else if (k === 'a') setAuto(!app.sim.autoRoute);
      else if (k === 'r') setShunt(!app.shuntMode);
      else if (k === 'f') viewport.fit();
      else if (k === 'z') fastForward();
      else if ('1234567'.includes(e.key) && e.key.length === 1) setSpeed([1, 2, 5, 10, 30, 60, 120][+e.key - 1]);
      else if (e.key === '+' || e.key === '-') viewport.zoomBy(e.key === '+' ? 1.25 : 0.8);
    } else if (app.view === 'editor') {
      if (editorKey(e)) return;
      if (e.key === '+' || e.key === '-') editViewport.zoomBy(e.key === '+' ? 1.25 : 0.8);
      else if (k === 'f' && !e.ctrlKey) editViewport.fit();
    }
  });
}

/* ============================ Start ============================ */
function boot() {
  applyIcons();
  const name = store.lastName();
  app.layout = (name && store.load(name)) || demoLayout();
  app.layout.settings = { ...defaultSettings(), ...(app.layout.settings || {}) };
  if (!app.layout.events) app.layout.events = defaultEventConfig();

  register({
    loadLayout, switchView, refreshTitle, refreshLayoutList, syncPlay, showPane,
    newLayout: newLayoutDialog, startTutorial, stopTutorial,
    startScenarioById: id => { const d = scenarioById(id); if (d) startScenario(d); },
    tutorialEvent: (type, data) => app.tutorial?.event(type, data),
    afterRestore: () => { syncSimControls(); syncPlay(); updateScoreChip(); }
  });

  initSimView(); initEditorView(); initTimetableView(); initEventsView(); initDiagrams();
  wireHeader(); wireKeys();
  loadLayout(app.layout, 'Freies Spiel');
  requestAnimationFrame(loop);

  let seen = false;
  try { seen = !!localStorage.getItem('stellwerksim.seenStart'); } catch { /* egal */ }
  if (!seen) showStartScreen();
}

/* Debug-Schnittstelle für Konsole und Tests */
window.stellwerk = {
  app, get sim() { return app.sim; }, get layout() { return app.layout; },
  lockRoute, releaseRoute, switchView, toast, startScenario: id => call('startScenarioById', id),
  startTutorial, fastForward
};

boot();
