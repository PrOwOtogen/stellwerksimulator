/* ===================================================================
 * simview.js – Betriebsansicht: Gleisbild, Bedienung, Seitenleiste
 * ================================================================= */
import { app, call } from './app.js';
import { $, $$, h, esc, toast, openModal, closeModal, showCtx, hideCtx } from './dom.js';
import { icon } from './icons.js';
import { Viewport } from './viewport.js';
import {
  cellAt, cellType, signalsOfCell, entries, platforms, DIRS, key, parseKey,
  switchGeom, SIGNAL_KINDS, straightBranch
} from '../model.js';
import { Sim, hhmm, signedMin, trainCells, CELL_M } from '../sim.js';
import {
  releaseRoute, aspectOf, findRoute, pointLabel, routeBlockReason, lockRouteChain
} from '../interlocking.js';
import { draw, cellSizeOf, LEGEND, TRAIN_COLORS } from '../render.js';
import { gattungOf } from '../timetable.js';
import { sound } from '../sound.js';

export let viewport = null;
const sigs = {};                    // Signaturen gegen unnötiges Neuzeichnen
let logFilter = '';

/* ============================ Protokoll ============================ */
export function logMsg(text, cls = '') {
  const e = { t: app.sim ? app.sim.time : 0, text, cls };
  app.logEntries = app.logEntries || [];
  app.logEntries.unshift(e);
  if (app.logEntries.length > 600) app.logEntries.pop();
  sigs.log = null;
  const tk = $('#ticker');
  if (tk) { tk.textContent = `${hhmm(e.t)}  ${text}`; tk.className = 'ticker ' + cls; }
}
export function clearLog() { app.logEntries = []; sigs.log = null; }

function renderLog() {
  const box = $('#log');
  const list = (app.logEntries || []).filter(e => !logFilter || e.cls === logFilter).slice(0, 300);
  const sig = logFilter + '|' + list.length + '|' + (list[0]?.text || '');
  if (sig === sigs.log) return;
  sigs.log = sig;
  box.innerHTML = list.map(e => `<div><span class="t">${hhmm(e.t)}</span><span class="${e.cls}">${esc(e.text)}</span></div>`).join('')
    || '<em>noch keine Einträge</em>';
}

/* ============================ Status ============================ */
export function setStatus(html, kind = '') {
  const el = $('#route-status');
  el.innerHTML = html;
  el.className = 'overlay route-pill ' + kind;
}

/* ============================ Aufbau ============================ */
export function initSimView() {
  viewport = new Viewport({
    wrap: $('#sim-wrap'), canvas: $('#canvas'), minimap: $('#minimap'), zoomKey: 'sim',
    leftPan: e => !app.routeStart,     // Ziehen verschiebt, Klick bedient
    onZoom: z => { $('#zoom-sim').textContent = Math.round(z * 100) + ' %'; }
  });

  const cv = $('#canvas');
  cv.addEventListener('click', onClick);
  cv.addEventListener('contextmenu', onContext);
  cv.addEventListener('mousemove', onHover);
  cv.addEventListener('mouseleave', () => { $('#tooltip').classList.add('hidden'); app.hoverPick = null; });

  for (const b of $$('#mode-seg button')) b.onclick = () => setShunt(b.dataset.mode === 'shunt');
  $('#btn-auto').onclick = () => setAuto(!app.sim.autoRoute);
  $('#btn-queue').onclick = () => {
    app.queueMode = !app.queueMode;
    $('#btn-queue').classList.toggle('active', app.queueMode);
    toast(app.queueMode ? 'Nicht einstellbare Fahrstraßen werden vorgemerkt.' : 'Fahrstraßenspeicher aus.');
  };
  for (const b of $$('#view-sim [data-zoom]')) b.onclick = () => viewport.zoomBy(b.dataset.zoom === '+' ? 1.25 : 0.8);
  $('#btn-fit').onclick = () => viewport.fit();
  $('#btn-minimap').onclick = () => {
    $('#minimap').classList.toggle('hidden');
    $('#btn-minimap').classList.toggle('active', !$('#minimap').classList.contains('hidden'));
  };
  $('#btn-legend').onclick = () => {
    $('#legend').classList.toggle('hidden');
    $('#btn-legend').classList.toggle('active', !$('#legend').classList.contains('hidden'));
  };
  $('#legend').innerHTML = LEGEND.map(([c, t]) => `<i style="background:${c}"></i><span>${t}</span>`).join('');

  for (const b of $$('#view-sim .side-tabs button')) b.onclick = () => showPane(b.dataset.pane);
  $('#btn-cmd').onclick = runCommand;
  $('#cmd').addEventListener('keydown', e => { if (e.key === 'Enter') runCommand(); e.stopPropagation(); });
  $('#train-filter').oninput = () => { sigs.trains = null; };
  $('#train-sort').onchange = () => { sigs.trains = null; };
  $('#board-platform').onchange = () => { sigs.board = null; };
  $('#funk-open').onchange = () => { sigs.msg = null; };
  $('#btn-funk-all').onclick = () => {
    let n = 0;
    for (const m of app.sim.messages) if (!m.answered && m.actions.some(a => a.key === 'accept')) { app.sim.answerMessage(m.id, 'accept'); n++; }
    toast(n ? `${n} Zugmeldung(en) angenommen.` : 'Keine offenen Zugmeldungen.');
  };
  for (const b of $$('#log-filter button')) b.onclick = () => {
    logFilter = b.dataset.f;
    $$('#log-filter button').forEach(x => x.classList.toggle('active', x === b));
    sigs.log = null;
  };
}

export function showPane(name) {
  for (const b of $$('#view-sim .side-tabs button')) b.classList.toggle('active', b.dataset.pane === name);
  for (const p of $$('#view-sim .pane')) p.classList.toggle('active', p.id === 'pane-' + name);
}

export function setShunt(on) {
  app.shuntMode = on;
  $$('#mode-seg button').forEach(b => b.classList.toggle('active', (b.dataset.mode === 'shunt') === on));
  setStatus(on ? 'Rangierbetrieb: Sperrsignal als Start wählen.' : 'Zugfahrten: Startsignal oder Einfahrt anklicken.');
}

export function setAuto(on) {
  app.sim.autoRoute = on;
  if (on && app.scenario) app.scenario.usedAuto = true;
  $('#btn-auto').classList.toggle('active', on);
  $('#st-auto-wrap').classList.toggle('hidden', !on);
  logMsg(on ? 'Automatikbetrieb eingeschaltet.' : 'Automatikbetrieb ausgeschaltet.', 'warn');
}

/** nach dem Laden eines neuen Betriebs: Zustand der Bedienelemente angleichen */
export function syncSimControls() {
  $('#btn-auto').classList.toggle('active', !!app.sim.autoRoute);
  $('#st-auto-wrap').classList.toggle('hidden', !app.sim.autoRoute);
  for (const k in sigs) sigs[k] = null;
}

/* ============================ Zeichnen ============================ */
export function drawSim() {
  draw($('#canvas'), app.layout, app.sim, {
    zoom: app.zoom.sim,
    highlight: highlightCells(),
    preview: routePreview(),
    hoverSignal: app.hoverPick?.type === 'signal' ? app.hoverPick.sig : null,
    pulse: app.tutorial?.pulse?.() || null
  });
  viewport.drawMinimap(app.sim);
}

function highlightCells() {
  if (!app.routeStart) return null;
  const p = app.routeStart;
  return [p.type === 'signal' ? key(p.sig.x, p.sig.y) : key(p.cell.x, p.cell.y)];
}

function routePreview() {
  if (!app.routeStart || !app.hoverPick) return null;
  const dest = destOf(app.hoverPick);
  if (!dest) return null;
  const r = findRoute(app.routeStart, dest, {
    layout: app.layout, blocked: app.sim.blockedCells, locked: new Map(), holds: new Map(),
    occupied: new Set(), allowOccupied: true, mode: app.shuntMode ? 'shunt' : 'train', passSignals: true
  });
  return r ? r.steps : null;
}

/* ============================ Maus ============================ */
function simPick(e) {
  const L = app.layout;
  const p = viewport.cellAt(e);
  const cs = viewport.cs;
  let best = null, bestD = cs * 0.8;
  for (const id in L.signals) {
    const s = L.signals[id];
    if (Math.abs(s.x - p.x) > 1 || Math.abs(s.y - p.y) > 1) continue;
    const d = DIRS[s.dir];
    const sx = (s.x + 0.5) * cs + d.dx * cs * 0.40 - d.dy * cs * 0.30;
    const sy = (s.y + 0.5) * cs + d.dy * cs * 0.40 + d.dx * cs * 0.30;
    const dist = Math.hypot(p.px - sx, p.py - sy);
    if (dist < bestD) { bestD = dist; best = s; }
  }
  if (best) return { type: 'signal', sig: best };
  const c = cellAt(L, p.x, p.y);
  if (!c) return null;
  if (c.crossing) return { type: 'crossing', cell: c };
  if (c.entry) return { type: 'entry', cell: c };
  if (['switch', 'dkw'].includes(cellType(c))) return { type: 'switch', cell: c };
  return { type: 'cell', cell: c };
}

function destOf(pick) {
  if (!pick) return null;
  if (pick.type === 'signal') return { type: 'signal', sig: pick.sig };
  if (pick.type === 'entry') return { type: 'exit', cell: pick.cell };
  if (pick.cell && (app.shuntMode || pick.cell.ends.length === 1)) return { type: 'cell', cell: pick.cell };
  return null;
}

const label = p => p.type === 'signal' ? p.sig.name : (p.cell.entry || `Gleis ${p.cell.x},${p.cell.y}`);

function onClick(e) {
  hideCtx();
  if (viewport.consumePan()) return;
  const pick = simPick(e);
  if (!pick) return;
  const sim = app.sim;

  if (!app.routeStart && pick.type === 'switch') {
    const res = sim.toggleSwitch(key(pick.cell.x, pick.cell.y));
    if (!res.ok) { sound.error(); return setStatus(res.reason, 'warn'); }
    logMsg(`Weiche ${pick.cell.x},${pick.cell.y} wird umgestellt.`);
    return;
  }
  if (!app.routeStart && pick.type === 'crossing') {
    const st = sim.crossingState.get(pick.cell.crossing.name);
    if (!st) return;
    if (st.state === 'open') sim.closeCrossing(st.name); else sim.openCrossing(st.name);
    logMsg(`${st.name}: Schranken ${st.state === 'open' ? 'öffnen' : 'schließen'}.`);
    return;
  }
  if (!app.routeStart) {
    if (pick.type === 'signal' || pick.type === 'entry') {
      if (pick.type === 'signal' && pick.sig.kind === 'distant') return setStatus(`${pick.sig.name} ist ein Vorsignal – bitte ein Hauptsignal wählen.`, 'warn');
      app.routeStart = pick;
      setStatus(`Start <b>${esc(label(pick))}</b>${app.shuntMode ? ' (Rangierfahrt)' : ''} – jetzt das Ziel anklicken. Esc bricht ab.`);
      call('tutorialEvent', 'start', pick);
    } else {
      const tr = sim.trainAtCell(key(pick.cell.x, pick.cell.y));
      if (tr) trainDetails(tr);
    }
    return;
  }
  const dest = destOf(pick);
  if (!dest) return setStatus('Ziel muss ein Signal, eine Ausfahrt oder ein Gleisende sein.', 'warn');
  setRouteChain(app.routeStart, dest, { substitute: e.shiftKey, shunt: app.shuntMode });
  app.routeStart = null;
}

/** Fahrstraßenkette stellen und Ergebnis melden (Maus, Befehlszeile, Tutorial) */
export function setRouteChain(start, dest, opts) {
  const sim = app.sim;
  const res = lockRouteChain(sim, start, dest, opts);
  const von = pointLabel(start);
  if (res.routes.length) {
    sim.stats.routesSet += res.routes.length;
    for (const r of res.routes) {
      if (r.mode === 'shunt') sim.stats.shuntMoves++;
      if (r.signal) r.signal.lastDest = Sim.refOfDest(r.dest);
      if (r.substitute) sim.emit('substitute', { route: r.id });
    }
    sim.emit('routeSet', { routes: res.routes, manual: true });
    sound.click();
    const kette = res.routes.map(r => r.destName).join(' → ');
    logMsg(`${res.routes.length} Fahrstraße${res.routes.length > 1 ? 'n' : ''}: ${von} → ${kette}` +
      `${res.routes.some(r => r.substitute) ? ' (Ersatzsignal)' : ''}${res.routes.some(r => r.diverging) ? ' – Langsamfahrt' : ''}.`, 'ok');
    const why = res.routes.map(r => routeBlockReason(sim, r)).find(Boolean);
    setStatus(`${res.routes.length}/${res.gesamt} Fahrstraßen: <b>${esc(von)} → ${esc(kette)}</b>` +
      (why ? ` · <span style="color:var(--warn)">wartet: ${esc(why)}</span>` : '') +
      (res.ok ? '' : ` · <span style="color:var(--warn)">weiter nicht möglich: ${esc(res.reason)}</span>`), res.ok ? 'ok' : 'warn');
    if (why && /geschlossen werden|gestört/.test(why)) toast(why, 'warn');
    if (!res.ok && app.queueMode && res.restStart) {
      sim.queueRoute(res.restStart, res.restDest, opts);
      toast('Restweg in den Fahrstraßenspeicher gelegt.');
    }
  } else if (app.queueMode && !res.needsSubstitute) {
    sim.queueRoute(start, dest, opts);
    setStatus(`Vorgemerkt: ${esc(von)} → ${esc(pointLabel(dest))} (${esc(res.reason)})`, 'warn');
  } else {
    sound.error();
    setStatus(esc(res.reason), 'warn');
    logMsg(res.reason, 'warn');
  }
  return res;
}

/** Fahrstraße auflösen – befahren nur als Hilfsauflösung mit Wartezeit */
export function dissolve(route) {
  const sim = app.sim;
  const busy = route.steps.some(st => sim.occupiedCells().has(st.k));
  if (busy) {
    const until = releaseRoute(sim, route, { delay: true });
    sim.stats.emergencyReleases++;
    sim.emit('emergencyRelease', { route: route.id });
    logMsg(`Hilfsauflösung ${route.id} eingeleitet, frei um ${hhmm(until)}.`, 'warn');
  } else {
    sim.freeTrainAuthority(route);
    releaseRoute(sim, route);
    logMsg(`Fahrstraße ${route.id} aufgelöst.`, 'warn');
  }
  sigs.routes = null;
}

function onContext(e) {
  e.preventDefault();
  if (app.routeStart) { app.routeStart = null; setStatus('Auswahl abgebrochen.'); return; }
  const pick = simPick(e);
  if (!pick) return hideCtx();
  const sim = app.sim;
  const items = [];
  call('tutorialEvent', 'context', pick);

  if (pick.type === 'signal') {
    const s = pick.sig;
    items.push({ title: `${s.name} · ${SIGNAL_KINDS[s.kind]} · ${aspectOf(sim, s)}` });
    if (s.kind !== 'distant') items.push({ label: 'Als Fahrstraßenstart wählen', fn: () => { app.routeStart = pick; setStatus(`Start <b>${esc(s.name)}</b> – Ziel anklicken.`); } });
    const route = sim.routes.find(r => r.signal && r.signal.id === s.id);
    if (route) items.push({ label: `Fahrstraße ${route.id} auflösen`, fn: () => dissolve(route) });
    if (s.kind !== 'distant') {
      items.push({ label: s.selfSet ? 'Selbststellbetrieb aus' : 'Selbststellbetrieb ein', fn: () => { s.selfSet = !s.selfSet; logMsg(`${s.name}: Selbststellbetrieb ${s.selfSet ? 'ein' : 'aus'}.`); } });
      items.push({ label: s.blocked ? 'Signalsperre aufheben' : 'Signal sperren', fn: () => { s.blocked = !s.blocked; logMsg(`${s.name} ${s.blocked ? 'gesperrt' : 'freigegeben'}.`, 'warn'); } });
      items.push({ label: 'Ersatzsignal (Zs1) bis zum nächsten Signal', fn: () => substituteAt(s) });
    }
  } else if (pick.type === 'switch') {
    const k = key(pick.cell.x, pick.cell.y);
    items.push({ title: `Weiche ${k}` });
    items.push({ label: 'Umstellen', fn: () => { const r = sim.toggleSwitch(k); if (!r.ok) toast(r.reason, 'warn'); } });
    const route = sim.routes.find(r => r.id === sim.lockedCells.get(k));
    if (route) items.push({ label: `Fahrstraße ${route.id} auflösen`, fn: () => dissolve(route) });
  } else if (pick.type === 'crossing') {
    const st = sim.crossingState.get(pick.cell.crossing.name);
    items.push({ title: `${st.name} (${st.mode === 'manual' ? 'handbedient' : 'automatisch'})` });
    items.push({ label: 'Schranken schließen', fn: () => sim.closeCrossing(st.name) });
    items.push({ label: 'Schranken öffnen', fn: () => sim.openCrossing(st.name) });
  } else {
    const k = key(pick.cell.x, pick.cell.y);
    items.push({ title: pick.cell.platform ? `${pick.cell.platform} (${k})` : `Gleis ${k}` });
    const route = sim.routes.find(r => r.id === sim.lockedCells.get(k));
    if (route) items.push({ label: `Fahrstraße ${route.id} auflösen`, fn: () => dissolve(route) });
    const tr = sim.trainAtCell(k);
    if (tr) {
      items.push({ label: `${tr.nr}: Einzelheiten …`, fn: () => trainDetails(tr) });
      items.push({ label: `${tr.nr} verfolgen`, fn: () => { app.followTrain = tr.id; toast(`${tr.nr} wird verfolgt.`); } });
    }
    if (sim.blockedCells.has(k)) items.push({ label: 'Gleissperrung aufheben', fn: () => { sim.blockedCells.delete(k); logMsg(`Sperrung ${k} aufgehoben.`, 'warn'); } });
    else items.push({ label: 'Gleis sperren', fn: () => { sim.blockedCells.add(k); logMsg(`Gleis ${k} gesperrt.`, 'warn'); } });
  }
  showCtx(e.clientX, e.clientY, items);
}

function substituteAt(s, tr = null) {
  const sim = app.sim;
  tr = tr || sim.trains.find(t => t.waitSignal && t.waitSignal.id === s.id);
  const m = sim.addMessage(`Ersatzsignal an ${s.name} angefordert.`, { from: 'Fdl' });
  m.data = { signalId: s.id, trainId: tr ? tr.id : null };
  sim.answerMessage(m.id, 'zs1');
  sim.emit('substitute', { signal: s.id });
}

/* ---------------- Tooltip ---------------- */
function onHover(e) {
  const pick = simPick(e);
  app.hoverPick = pick;
  const tip = $('#tooltip');
  if (viewport.isPanning || !pick) { tip.classList.add('hidden'); return; }
  const html = tooltipFor(pick);
  if (!html) { tip.classList.add('hidden'); return; }
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const x = Math.min(e.clientX + 16, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.min(e.clientY + 16, window.innerHeight - tip.offsetHeight - 8);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}

const row = (a, b) => `<div class="t-row"><span>${a}</span><span>${b}</span></div>`;

function tooltipFor(pick) {
  const sim = app.sim;
  if (pick.type === 'signal') {
    const s = pick.sig;
    const r = sim.routes.find(x => x.signal && x.signal.id === s.id && !x.passed);
    return `<b>${esc(s.name)}</b> · ${SIGNAL_KINDS[s.kind]}` +
      row('Begriff', aspectOf(sim, s)) +
      (r ? row('Fahrstraße', `${r.id} → ${esc(r.destName)}`) : '') +
      (r && routeBlockReason(sim, r) ? row('wartet', esc(routeBlockReason(sim, r))) : '') +
      (s.selfSet ? row('Selbststellbetrieb', 'ein') : '') +
      (s.blocked ? row('Zustand', 'gesperrt') : sim.faultySignals.has(s.id) ? row('Zustand', 'gestört') : '');
  }
  const k = key(pick.cell.x, pick.cell.y);
  const tr = sim.trainAtCell(k);
  if (tr) {
    const stop = tr.stops[tr.nextStop];
    return `<b>${esc(tr.nr)}</b> · ${esc(gattungOf(tr.gattung).name)}` +
      row('Lauf', `${esc(tr.entryName)} → ${esc(tr.exitName)}`) +
      row('Zustand', stateName(tr)) +
      row('Ziel', stop ? `${esc(stop.platform)} ab ${hhmm(stop.dep)}` : 'Ausfahrt') +
      row('Verspätung', signedMin(tr.delay));
  }
  if (pick.type === 'switch') {
    const c = pick.cell;
    const t = cellType(c);
    const lage = t === 'dkw' ? ((c.sw | 0) ? 'über Kreuz' : 'gerade') : ((c.sw | 0) === straightBranch(c) ? 'gerader Strang' : 'abzweigend');
    const fs = sim.lockedCells.get(k);
    return `<b>Weiche ${k}</b>` + row('Lage', lage) +
      (sim.switchMoves.has(k) ? row('Zustand', 'läuft um') : '') +
      (fs ? row('verschlossen', fs) : '') +
      (sim.flankHoldState(k) !== null ? row('Flankenschutz', 'festgelegt') : '') +
      (sim.faultySwitches.has(k) ? row('Störung', 'ja') : '');
  }
  if (pick.type === 'crossing') {
    const st = sim.crossingState.get(pick.cell.crossing.name);
    return `<b>${esc(st.name)}</b>` + row('Schranken', st.fault ? 'gestört' : { open: 'offen', closing: 'schließen', closed: 'geschlossen' }[st.state]) +
      row('Bedienung', st.mode === 'manual' ? 'von Hand' : 'automatisch');
  }
  if (pick.type === 'entry') {
    const w = sim.trains.filter(t => t.entryName === pick.cell.entry && ['waiting', 'pending'].includes(t.state))
      .sort((a, b) => a.plannedEntry - b.plannedEntry).slice(0, 3);
    return `<b>${esc(pick.cell.entry)}</b> · Ein-/Ausfahrt` +
      (w.length ? w.map(t => row(esc(t.nr), t.state === 'waiting' ? 'wartet' : hhmm(t.plannedEntry))).join('') : row('nächste Züge', '–'));
  }
  const c = pick.cell;
  const fs = sim.lockedCells.get(k);
  if (c.platform || fs || sim.blockedCells.has(k)) {
    return `<b>${esc(c.platform || c.stump || 'Gleis ' + k)}</b>` +
      (fs ? row('Fahrstraße', fs) : '') +
      (sim.blockedCells.has(k) ? row('Zustand', 'gesperrt') : '') +
      (sim.slowCells.get(k) ? row('Langsamfahrt', sim.slowCells.get(k) + ' km/h') : '') +
      (c.vmax ? row('Vmax', c.vmax + ' km/h') : '');
  }
  return null;
}

/* ============================ Befehlszeile ============================ */
function resolvePoint(text, asDest) {
  const L = app.layout;
  const t = text.trim().toLowerCase();
  if (!t) return null;
  for (const id in L.signals) if (L.signals[id].name.toLowerCase() === t) return { type: 'signal', sig: L.signals[id] };
  for (const e of entries(L)) if (e.name.toLowerCase() === t) return { type: asDest ? 'exit' : 'entry', cell: e.cell };
  for (const pf of platforms(L)) {
    if (pf.toLowerCase() !== t) continue;
    const cells = Object.values(L.cells).filter(c => c.platform === pf);
    const stumpf = cells.find(c => c.ends.length === 1);
    if (stumpf) return { type: 'cell', cell: stumpf };
    for (const c of cells) { const sg = signalsOfCell(L, c.x, c.y)[0]; if (sg) return { type: 'signal', sig: sg }; }
  }
  return null;
}

export function runCommand() {
  const raw = $('#cmd').value.trim();
  if (!raw) return;
  // „Gleis 2" soll als ein Name erkannt werden: erst vollständige Namen prüfen
  const words = raw.split(/[\s,>→]+/).filter(Boolean);
  let start = null, dest = null;
  for (let i = 1; i < words.length && !(start && dest); i++) {
    const a = resolvePoint(words.slice(0, i).join(' '), false);
    const b = resolvePoint(words.slice(i).join(' '), true);
    if (a && b) { start = a; dest = b; }
  }
  if (!start || !dest) return setStatus(`„${esc(raw)}" – Start und Ziel nicht erkannt. Beispiel: <b>A N1</b> oder <b>West Ost</b>.`, 'warn');
  const res = setRouteChain(start, dest, { shunt: app.shuntMode });
  if (res.routes.length) $('#cmd').value = '';
  call('tutorialEvent', 'command', raw);
}

/* ============================ Zugdetails ============================ */
export function stateName(t) {
  switch (t.state) {
    case 'pending': return t.offered && !t.accepted ? 'angeboten' : 'angekündigt';
    case 'waiting': return 'wartet auf Einfahrt';
    case 'dwell': return t.waitForConnection ? 'wartet auf Anschluss' : 'hält';
    case 'turning': return 'wendet';
    case 'hold': return 'steht vor ' + (t.waitSignal ? t.waitSignal.name : 'Signal');
    case 'done': return 'ausgefahren';
    default: return Math.round(t.v * 3.6) + ' km/h';
  }
}

export function trainDetails(tr) {
  const sim = app.sim;
  openModal(`${tr.nr} · ${gattungOf(tr.gattung).name}`, body => {
    const g = gattungOf(tr.gattung);
    const sig = sim.signalAtAuthorityEnd(tr);
    const rest = tr.steps.length ? Math.max(0, tr.steps.length * CELL_M - tr.s) : 0;
    body.append(h('div', { class: 'settings-grid', html: `
      <span>Lauf</span><b>${esc(tr.entryName)} → ${esc(tr.exitName)}</b>
      <span>Zustand</span><b>${stateName(tr)}</b>
      <span>Geschwindigkeit</span><b>${Math.round(tr.v * 3.6)} km/h (zulässig ${Math.round(sim.speedLimitFor(tr))})</b>
      <span>Höchstgeschwindigkeit</span><b>${tr.vmax} km/h${tr.vmaxFault ? ` – gestört: ${tr.vmaxFault}` : ''}</b>
      <span>Länge · Anfahren · Bremsen</span><b>${tr.lenM} m · ${(tr.accel || g.accel || .7).toFixed(2)} · ${(tr.brake || g.brake || .9).toFixed(2)} m/s²</b>
      <span>Verspätung</span><b class="${tr.delay > 300 ? 'delay-bad' : tr.delay > 60 ? 'delay-mid' : 'delay-ok'}">${signedMin(tr.delay)}</b>
      <span>Fahrerlaubnis</span><b>${tr.steps.length ? Math.round(rest) + ' m bis ' + esc(sig ? sig.name : 'Fahrwegende') : 'keine'}</b>
      <span>Wende</span><b>${tr.turn ? `als ${esc(tr.turn.nr)} nach ${esc(tr.turn.exit)} ab ${hhmm(tr.turn.dep)}` : tr.record.turnedAt ? 'gewendet' : '–'}</b>` }));

    const tb = h('tbody');
    tr.stops.forEach((st, i) => {
      const rec = tr.record.stops[i];
      tb.append(h('tr', { class: i === tr.nextStop ? 'sel' : '' },
        h('td', {}, st.platform, st.changedFrom ? h('span', { class: 'small' }, ` (statt ${st.changedFrom})`) : ''),
        h('td', {}, `${hhmm(st.arr)} / ${rec?.actualArr ? hhmm(rec.actualArr) : '—'}`),
        h('td', {}, `${hhmm(st.dep)} / ${rec?.actualDep ? hhmm(rec.actualDep) : '—'}`),
        h('td', {}, (st.connections || []).map(c => c.from).join(', ') || '–')));
    });
    body.append(h('table', { style: { marginTop: '10px' } },
      h('thead', { html: '<tr><th>Halt</th><th>an Plan/Ist</th><th>ab Plan/Ist</th><th>Anschluss</th></tr>' }), tb));

    // Gleiswechsel
    const stop = tr.stops[tr.nextStop];
    if (stop && tr.state !== 'dwell' && tr.state !== 'done') {
      const alt = sim.alternativePlatforms(tr);
      if (alt.length) {
        const sel = h('select', {}, h('option', { value: '' }, `${stop.platform} (wie geplant)`), ...alt.map(p => h('option', { value: p }, p)));
        body.append(h('div', { class: 'row', style: { marginTop: '10px' } },
          h('label', {}, 'Gleiswechsel für den nächsten Halt:'), sel,
          h('button', { onclick: () => { if (sel.value && sim.changePlatform(tr, sel.value)) { toast(`${tr.nr} hält jetzt in ${sel.value}.`, 'ok'); closeModal(); } } }, 'Übernehmen')));
      }
    }

    body.append(h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { onclick: () => { app.followTrain = app.followTrain === tr.id ? null : tr.id; closeModal(); } },
        app.followTrain === tr.id ? 'Verfolgung beenden' : 'Zug verfolgen'),
      h('button', { disabled: !tr.waitSignal, onclick: () => { substituteAt(tr.waitSignal, tr); closeModal(); } }, 'Ersatzsignal erteilen'),
      tr.state === 'pending' && tr.offered && !tr.accepted
        ? h('button', { class: 'primary', onclick: () => { tr.accepted = true; sim.emit('answered', { m: {}, action: 'accept' }); closeModal(); } }, 'Zug annehmen') : null,
      h('button', {
        class: 'danger', onclick: () => {
          if (!window.confirm(`${tr.nr} wirklich ausfallen lassen?`)) return;
          if (['run', 'hold', 'dwell', 'turning'].includes(tr.state)) sim.finishTrain(tr);
          else { tr.state = 'done'; tr.record.cancelled = true; }
          sim.stats.cancelled++;
          sim.emit('cancelled', { tr });
          logMsg(`${tr.nr} wurde gestrichen.`, 'warn');
          closeModal();
        }
      }, 'Zug streichen')));
    return null;
  }, { noCancel: true, okLabel: 'Schließen' });
}

export function scrollToTrain(t) {
  const cells = trainCells(t);
  if (!cells.length) return;
  const p = parseKey(cells[cells.length - 1]);
  viewport.centerOn(p.x, p.y);
}

/* ============================ Seitenleiste ============================ */
export function updatePanels() {
  updateRoutes(); updateQueue(); updateCrossings(); updatePlannedList();
  updateTrains(); updateBoard(); updateMessages(); updateFaults(); updateStatusbar();
  if ($('#pane-log').classList.contains('active')) renderLog();
}

function updateRoutes() {
  const box = $('#route-list');
  const rs = app.sim.routes;
  const sig = rs.map(r => r.id + (routeBlockReason(app.sim, r) || '') + r.trainId + r.releaseAt).join('|');
  if (sig === sigs.routes) return;
  sigs.routes = sig;
  if (!rs.length) { box.innerHTML = '<em>keine Fahrstraße eingestellt</em>'; return; }
  box.innerHTML = '';
  for (const r of rs) {
    const why = routeBlockReason(app.sim, r);
    const from = r.signal ? r.signal.name : (r.entryName || '?');
    const zug = r.trainId ? (app.sim.trains.find(t => t.id === r.trainId)?.nr || '') : '';
    const state = r.releaseAt ? `<span class="why">Hilfsauflösung bis ${hhmm(r.releaseAt)}</span>`
      : why ? `<span class="why">wartet: ${esc(why)}</span>`
        : `<span class="ok">${r.mode === 'shunt' ? 'Sh1 Rangierfahrt' : r.substitute ? 'Zs1 Ersatzsignal' : r.diverging ? 'Hp2 Langsamfahrt' : 'Hp1 Fahrt'}</span>`;
    box.append(h('div', { class: 'r' },
      h('span', { html: `<b>${r.id}</b> ${esc(from)} → ${esc(r.destName)}${zug ? ` <span class="small">${esc(zug)}</span>` : ''}<br>${state}` }),
      h('button', { title: 'Fahrstraße auflösen', onclick: () => dissolve(r), html: icon('trash', 14) })));
  }
}

function updateQueue() {
  const q = app.sim.routeQueue;
  $('#queue-list').innerHTML = q.length ? '<b>Fahrstraßenspeicher:</b> ' + q.map(x => `${esc(pointLabel(x.start))} → ${esc(pointLabel(x.dest))}`).join(', ') : '';
}

function updateCrossings() {
  const box = $('#crossing-list');
  const list = [...app.sim.crossingState.values()];
  const sig = list.map(c => c.name + c.state + c.fault).join(',');
  if (sig === sigs.cross) return;
  sigs.cross = sig;
  if (!list.length) { box.innerHTML = '<em>keine</em>'; return; }
  box.innerHTML = '';
  for (const c of list) {
    const col = c.fault ? 'var(--violet)' : c.state === 'closed' ? 'var(--bad)' : c.state === 'closing' ? 'var(--warn)' : 'var(--ok)';
    const txt = c.fault ? 'gestört' : { open: 'offen', closing: 'schließt', closed: 'geschlossen' }[c.state];
    box.append(h('div', { class: 'c' },
      h('span', { html: `<i class="dot" style="background:${col}"></i>${esc(c.name)} <span class="small">${c.mode === 'manual' ? 'von Hand' : 'automatisch'} · ${txt}</span>` }),
      h('button', { onclick: () => { c.state === 'open' ? app.sim.closeCrossing(c.name) : app.sim.openCrossing(c.name); sigs.cross = null; } },
        c.state === 'open' ? 'schließen' : 'öffnen')));
  }
}

function updatePlannedList() {
  const list = app.layout.planned || [];
  const sig = list.map(p => p.id + app.sim.plannedActive.has(p.id)).join(',');
  if (sig === sigs.planned) return;
  sigs.planned = sig;
  $('#planned-list').innerHTML = list.length ? list.map(p =>
    `<div>${app.sim.plannedActive.has(p.id) ? '<b style="color:var(--warn)">aktiv</b>' : hhmm(p.from)} · ${p.type === 'sperrung' ? 'Sperrung' : 'Langsamfahrt ' + (p.vmax || 40) + ' km/h'} ${esc(p.target && p.target !== '*' ? p.target : 'ganzer Bereich')} bis ${hhmm(p.to)}</div>`).join('')
    : '<em>keine geplant</em>';
}

function updateTrains() {
  const box = $('#train-list');
  const filter = ($('#train-filter').value || '').toLowerCase();
  const sort = $('#train-sort').value;
  let rows = app.sim.trains.filter(t => t.state !== 'done');
  if (filter) rows = rows.filter(t => [t.nr, t.entryName, t.exitName, t.stops[t.nextStop]?.platform || ''].some(x => x.toLowerCase().includes(filter)));
  rows.sort((a, b) => sort === 'delay' ? b.delay - a.delay
    : sort === 'nr' ? a.nr.localeCompare(b.nr, 'de', { numeric: true }) : a.plannedEntry - b.plannedEntry);
  const sig = sort + filter + rows.slice(0, 40).map(t => t.id + t.state + Math.round(t.delay / 60) + Math.round(t.v) + t.nextStop).join(',');
  if (sig === sigs.trains) return;
  sigs.trains = sig;
  $('#train-count').textContent = `${rows.length} offen · ${app.sim.stats.finished} abgeschlossen`;
  box.innerHTML = '';
  for (const t of rows.slice(0, 40)) {
    const stop = t.stops[t.nextStop];
    let ziel;
    if (t.state === 'pending') ziel = `Einfahrt ${t.entryName} ${hhmm(t.plannedEntry)}`;
    else if (t.state === 'turning') ziel = `wendet bis ${hhmm(t.turnReadyAt)}`;
    else if (t.state === 'dwell') ziel = `${stop ? stop.platform : ''} ab ${hhmm(t.departAt)}`;
    else if (stop) ziel = `${stop.platform} an ${hhmm(stop.arr)}${stop.changedFrom ? ' (Gleiswechsel)' : ''}`;
    else ziel = `Ausfahrt ${t.exitName}`;
    const dl = t.state === 'pending' && !(t.offered && t.delay > 0) ? null : t.delay;
    const cls = dl === null ? '' : dl < 60 ? 'delay-ok' : dl < 300 ? 'delay-mid' : 'delay-bad';
    const col = TRAIN_COLORS[t.gattung] || '#4da3ff';
    const el = h('div', { class: 't', title: 'Einzelheiten' },
      h('span', { html: `<span class="gat" style="background:${col}">${esc(t.gattung)}</span><span class="nr">${esc(t.nr)}</span>` }),
      h('span', { class: 'dl ' + cls }, dl === null ? '' : signedMin(dl)),
      h('span', { class: 'st' }, `${stateName(t)} · ${ziel}`),
      h('span', { class: 'st' }, `${t.entryName} → ${t.exitName}`));
    el.onclick = () => { scrollToTrain(t); trainDetails(t); };
    box.append(el);
  }
  if (!rows.length) box.innerHTML = '<em>keine Züge mehr im Fahrplan</em>';
}

function updateBoard() {
  const sel = $('#board-platform');
  const pfs = platforms(app.layout);
  if (sel.dataset.sig !== pfs.join('|')) {
    sel.dataset.sig = pfs.join('|');
    sel.innerHTML = pfs.map(p => `<option>${esc(p)}</option>`).join('');
  }
  const pf = sel.value || pfs[0];
  const rows = [];
  for (const tr of app.sim.trains) {
    if (tr.state === 'done') continue;
    tr.stops.forEach((st, i) => {
      if (st.platform !== pf || i < tr.nextStop) return;
      rows.push({ nr: tr.nr, dep: st.dep, delay: tr.delay, ziel: tr.turn ? tr.turn.exit : tr.exitName, chg: st.changedFrom, here: tr.state === 'dwell' && i === tr.nextStop });
    });
  }
  rows.sort((a, b) => a.dep - b.dep);
  const html = rows.slice(0, 8).map(r =>
    `<div class="row2"><span>${hhmm(r.dep)}</span><span>${esc(r.nr)}</span><span class="${r.chg ? 'chg' : ''}">${esc(r.ziel)}${r.chg ? ' ⇄' : ''}${r.here ? ' ●' : ''}</span>` +
    `<span class="late">${r.delay > 60 ? '+' + Math.round(r.delay / 60) : ''}</span></div>`).join('') || '<em>keine Abfahrten</em>';
  if (html !== sigs.board) { $('#board').innerHTML = html; sigs.board = html; }
}

function updateMessages() {
  const msgs = app.sim.messages;
  const open = msgs.filter(m => m.actions.length && !m.answered).length;
  $('#badge-funk').textContent = open || '';
  const onlyOpen = $('#funk-open').checked;
  const list = msgs.filter(m => !onlyOpen || (m.actions.length && !m.answered)).slice(0, 25);
  const sig = onlyOpen + list.map(m => m.id + (m.answered ? '!' : '')).join(',');
  if (sig === sigs.msg) return;
  sigs.msg = sig;
  const box = $('#messages');
  box.innerHTML = '';
  for (const m of list) {
    const div = h('div', { class: `msg ${m.kind}${m.answered ? ' answered' : ''}` },
      h('div', { class: 'head' }, h('span', {}, m.from), h('span', {}, hhmm(m.time))),
      h('div', {}, m.text));
    if (m.actions.length && !m.answered) {
      div.append(h('div', { class: 'acts' }, ...m.actions.map((a, i) =>
        h('button', { class: i === 0 ? 'primary' : '', onclick: () => { app.sim.answerMessage(m.id, a.key); sigs.msg = null; } }, a.label))));
    } else if (m.answered && m.answer) {
      const a = m.actions.find(x => x.key === m.answer);
      if (a) div.append(h('div', { class: 'small' }, '✓ ' + a.label));
    }
    box.append(div);
  }
  if (!list.length) box.innerHTML = '<em>keine Meldungen</em>';
}

function updateFaults() {
  const f = app.sim.faults;
  $('#badge-stoer').textContent = f.length || '';
  const sig = f.map(x => `${x.id}:${x.repairing}:${x.repairUntil ? Math.round((x.repairUntil - app.sim.time) / 60) : ''}`).join('|') +
    '#' + app.sim.blockedCells.size + app.sim.faultySwitches.size + app.sim.faultySignals.size;
  if (sig === sigs.faults) return;
  sigs.faults = sig;
  const box = $('#fault-list');
  box.innerHTML = '';
  for (const fault of f) {
    const rest = fault.repairUntil ? Math.max(0, Math.round((fault.repairUntil - app.sim.time) / 60)) : null;
    const el = h('div', { class: 'f' + (fault.repairing ? ' rep' : '') },
      h('span', { html: `<b>${esc(fault.title)}</b><br><span class="small">${esc(fault.text)} · seit ${hhmm(fault.since)}</span>` }));
    if (fault.repairSec) el.append(h('button', {
      class: fault.repairing ? '' : 'primary', disabled: !!fault.repairing,
      onclick: () => { app.events.startRepair(fault); sigs.faults = null; }
    }, fault.repairing ? `noch ${rest} min` : 'Entstören'));
    box.append(el);
  }
  if (!f.length) box.innerHTML = '<em>keine Störungen – alles läuft</em>';
  const L = app.layout, sim = app.sim;
  const parts = [];
  if (sim.blockedCells.size) parts.push(`Gleise gesperrt: ${[...sim.blockedCells].slice(0, 12).join(', ')}${sim.blockedCells.size > 12 ? ' …' : ''}`);
  if (sim.faultySwitches.size) parts.push(`Weichen gestört: ${[...sim.faultySwitches].join(', ')}`);
  const sg = Object.values(L.signals).filter(s => s.blocked || sim.faultySignals.has(s.id)).map(s => s.name);
  if (sg.length) parts.push(`Signale gesperrt/gestört: ${sg.join(', ')}`);
  if (sim.interlockingFault && sim.time < sim.interlockingFault) parts.push(`Stellwerksstörung bis ${hhmm(sim.interlockingFault)}`);
  $('#blocked-list').innerHTML = parts.map(esc).join('<br>') || '<em>nichts gesperrt</em>';
}

function updateStatusbar() {
  const s = app.sim.stats, sim = app.sim;
  $('#st-trains').textContent = `${s.finished}/${sim.trains.length}`;
  $('#st-punct').textContent = s.finished ? Math.round(100 * s.punctual / s.finished) + ' %' : '–';
  $('#st-delay').textContent = s.finished ? `Ø ${(s.delaySum / s.finished / 60).toFixed(1)} min` : 'Ø –';
  $('#st-active').textContent = `${sim.trains.filter(t => ['run', 'hold', 'dwell', 'turning', 'waiting'].includes(t.state)).length} im Bereich`;
  $('#st-faults').textContent = sim.faults.length;
}
