/* ===================================================================
 * main.js – Oberfläche und Bedienung
 * ================================================================= */
import {
  cellAt, cellType, signalsOfCell, entries, validate, newLayout, platforms,
  DIRS, key, parseKey, switchGeom, crossings, SIGNAL_KINDS, defaultSettings, sidings
} from './model.js';
import {
  Sim, hhmmss, hhmm, signedMin, parseTime, trainCells, CELL_M
} from './sim.js';
import {
  lockRoute, releaseRoute, aspectOf, clearReachCache, findRoute, pointLabel,
  routeBlockReason, lockRouteChain
} from './interlocking.js';
import { EventEngine, EVENT_TYPES, defaultEventConfig } from './events.js';
import { draw, cellSizeOf, LEGEND } from './render.js';
import { Editor, TOOL_HELP, TEMPLATES } from './editor.js';
import { demoLayout } from './demo.js';
import * as store from './storage.js';
import {
  renderTimetable, generateTimetable, generateTakt, emptyRow, GATTUNGEN,
  gattungOf, checkTimetable, stopsToText
} from './timetable.js';

const $ = sel => document.querySelector(sel);
const app = {
  layout: null, sim: null, events: null, editor: null,
  routeStart: null, view: 'sim', dirty: false,
  zoom: 1, editZoom: 1, shuntMode: false, queueMode: false,
  templateMode: null, followTrain: null
};

/* ============================ Start ============================ */
function boot() {
  const name = store.lastName();
  app.layout = (name && store.load(name)) || demoLayout();
  if (!app.layout.events) app.layout.events = defaultEventConfig();
  if (!app.layout.settings) app.layout.settings = defaultSettings();
  newSim();
  buildUI();
  refreshLayoutList();
  requestAnimationFrame(loop);
}

function newSim() {
  app.sim = new Sim(app.layout, logMsg);
  app.events = new EventEngine(app.sim, app.layout.events, logMsg);
  app.routeStart = null;
  if ($('#log')) $('#log').innerHTML = '';
  logMsg(`Stellwerk „${app.layout.name}" geladen – ${app.layout.timetable.length} Zugfahrten im Fahrplan.`);
}

/* ============================ Protokoll ============================ */
function logMsg(text, cls = '') {
  const box = $('#log');
  if (!box) return;
  const div = document.createElement('div');
  div.innerHTML = `<span class="t">${hhmm(app.sim ? app.sim.time : 0)}</span><span class="${cls}">${escapeHtml(text)}</span>`;
  box.prepend(div);
  while (box.childElementCount > 400) box.lastElementChild.remove();
}
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ============================ Hauptschleife ============================ */
let lastT = performance.now();
let lastPanel = 0;
let faultSig = '', msgSig = '', crossSig = '';
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
    draw($('#canvas'), app.layout, app.sim, {
      zoom: app.zoom, highlight: highlightCells(), preview: routePreview()
    });
    if (app.followTrain && now - (loop._follow || 0) > 900) {
      loop._follow = now;
      const tr = app.sim.trains.find(t => t.id === app.followTrain);
      if (tr && trainCells(tr).length) scrollToTrain(tr);
      else if (tr && tr.state === 'done') app.followTrain = null;
    }
    if (now - lastPanel > 400) {
      lastPanel = now;
      updateTrainTable(); updateFaults(); updateScore(); updateMessages();
      updateCrossingPanel(); updateQueuePanel(); updateRouteList();
    }
  } else if (app.view === 'editor') {
    draw($('#canvas-edit'), app.layout, null, {
      grid: true, hover: app.editor.hover, zoom: app.editZoom
    });
    $('#element-info').innerHTML = app.editor.describe();
  }
  requestAnimationFrame(loop);
}

function highlightCells() {
  if (!app.routeStart) return null;
  const p = app.routeStart;
  return [p.type === 'signal' ? key(p.sig.x, p.sig.y) : key(p.cell.x, p.cell.y)];
}

/** Vorschau des Fahrwegs zum Mauszeiger */
function routePreview() {
  if (!app.routeStart || !app.hoverPick) return null;
  const pick = app.hoverPick;
  let dest = null;
  if (pick.type === 'signal') dest = { type: 'signal', sig: pick.sig };
  else if (pick.type === 'entry') dest = { type: 'exit', cell: pick.cell };
  if (!dest) return null;
  const r = findRoute(app.routeStart, dest, {
    layout: app.layout, blocked: app.sim.blockedCells, locked: app.sim.lockedCells,
    occupied: app.sim.occupiedCells(), allowOccupied: false,
    mode: app.shuntMode ? 'shunt' : 'train'
  });
  return r ? r.steps : null;
}

/* ============================ Betrieb: Maus ============================ */
function simPick(e) {
  const L = app.layout, cs = cellSizeOf(L, app.zoom);
  const r = $('#canvas').getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const cx = Math.floor(px / cs), cy = Math.floor(py / cs);

  let bestSig = null, bestD = cs * 0.8;
  for (const id in L.signals) {
    const s = L.signals[id];
    if (Math.abs(s.x - cx) > 1 || Math.abs(s.y - cy) > 1) continue;
    const d = DIRS[s.dir];
    const sx = (s.x + 0.5) * cs + d.dx * cs * 0.40 - d.dy * cs * 0.30;
    const sy = (s.y + 0.5) * cs + d.dy * cs * 0.40 + d.dx * cs * 0.30;
    const dist = Math.hypot(px - sx, py - sy);
    if (dist < bestD) { bestD = dist; bestSig = s; }
  }
  if (bestSig) return { type: 'signal', sig: bestSig };

  const c = cellAt(L, cx, cy);
  if (!c) return null;
  if (c.crossing) return { type: 'crossing', cell: c };
  if (c.entry) return { type: 'entry', cell: c };
  if (['switch', 'dkw'].includes(cellType(c))) return { type: 'switch', cell: c };
  return { type: 'cell', cell: c };
}

function onSimClick(e) {
  hideCtx();
  const pick = simPick(e);
  if (!pick) return;
  const sim = app.sim;

  if (pick.type === 'switch' && !app.routeStart) {
    const res = sim.toggleSwitch(key(pick.cell.x, pick.cell.y));
    if (!res.ok) return setStatus(res.reason, true);
    logMsg(`Weiche ${pick.cell.x},${pick.cell.y} wird umgestellt.`);
    return;
  }
  if (pick.type === 'crossing' && !app.routeStart) {
    const st = sim.crossingState.get(pick.cell.crossing.name);
    if (!st) return;
    if (st.state === 'open') { sim.closeCrossing(st.name); logMsg(`${st.name}: Schranken schließen.`); }
    else { sim.openCrossing(st.name); logMsg(`${st.name}: Schranken öffnen.`); }
    return;
  }

  if (!app.routeStart) {
    if (pick.type === 'signal' || pick.type === 'entry') {
      app.routeStart = pick;
      setStatus(`Start: <b>${label(pick)}</b>${app.shuntMode ? ' (Rangierfahrt)' : ''} – Ziel wählen.`);
    }
    return;
  }

  let dest = null;
  if (pick.type === 'signal') dest = { type: 'signal', sig: pick.sig };
  else if (pick.type === 'entry') dest = { type: 'exit', cell: pick.cell };
  else if (app.shuntMode && pick.cell) dest = { type: 'cell', cell: pick.cell };
  else return setStatus('Ziel muss ein Signal oder eine Ausfahrt sein.', true);

  const opts = { substitute: e.shiftKey, shunt: app.shuntMode };
  // Zuglenkung: liegen Signale dazwischen, wird die ganze Kette gestellt
  const res = lockRouteChain(sim, app.routeStart, dest, opts);
  const von = label(app.routeStart);

  if (res.routes.length) {
    sim.stats.routesSet += res.routes.length;
    for (const r of res.routes) {
      if (r.mode === 'shunt') sim.stats.shuntMoves++;
      if (r.signal) r.signal.lastDest = Sim.refOfDest(r.dest);
    }
    const kette = res.routes.map(r => r.destName).join(' → ');
    logMsg(`${res.routes.length} Fahrstraße${res.routes.length > 1 ? 'n' : ''}: ${von} → ${kette}` +
      `${res.routes.some(r => r.substitute) ? ' (Ersatzsignal)' : ''}` +
      `${res.routes.some(r => r.diverging) ? ' – Langsamfahrt' : ''} eingestellt.`, 'ok');
    const why = res.routes.map(r => routeBlockReason(sim, r)).find(Boolean);
    setStatus(`${res.routes.length} von ${res.gesamt} Teilfahrstraßen eingestellt: ${escapeHtml(von)} → ${escapeHtml(kette)}.` +
      (why ? ` <span style="color:var(--warn)">Halt – wartet: ${escapeHtml(why)}</span>` : '') +
      (res.ok ? '' : ` <span style="color:var(--warn)">Weiter geht es nicht: ${escapeHtml(res.reason)}</span>`));
    if (why && /geschlossen werden|gestört/.test(why)) toast(why);
    if (!res.ok && app.queueMode && res.restStart) {
      sim.queueRoute(res.restStart, res.restDest, opts);
      toast('Restweg in den Fahrstraßenspeicher gelegt.');
    }
  } else if (app.queueMode && !res.needsSubstitute) {
    sim.queueRoute(app.routeStart, dest, opts);
    setStatus(`In den Fahrstraßenspeicher gelegt: ${res.reason}`, true);
  } else {
    setStatus(res.reason, true);
    logMsg(res.reason, 'warn');
  }
  app.routeStart = null;
}

/* ---------------------- Kontextmenü ---------------------- */
function onSimContext(e) {
  e.preventDefault();
  const pick = simPick(e);
  if (!pick) return hideCtx();
  const items = [];
  const sim = app.sim;

  if (pick.type === 'signal') {
    const s = pick.sig;
    items.push({ title: `${s.name} – ${SIGNAL_KINDS[s.kind]} (${aspectOf(sim, s)})` });
    items.push({ label: 'Als Fahrstraßenstart wählen', fn: () => { app.routeStart = pick; setStatus(`Start: <b>${s.name}</b>`); } });
    const route = sim.routes.find(r => r.signal && r.signal.id === s.id);
    if (route) {
      items.push({
        label: `Fahrstraße ${route.id} auflösen`, fn: () => {
          const busy = route.steps.some(st => sim.occupiedCells().has(st.k));
          if (busy) {
            const until = releaseRoute(sim, route, { delay: true });
            sim.stats.emergencyReleases++;
            logMsg(`Hilfsauflösung für ${route.id} eingeleitet, Auflösung um ${hhmm(until)}.`, 'warn');
          } else {
            sim.freeTrainAuthority(route);
            releaseRoute(sim, route);
            logMsg(`Fahrstraße ${route.id} aufgelöst.`, 'warn');
          }
        }
      });
    }
    items.push({
      label: (s.selfSet ? 'Selbststellbetrieb ausschalten' : 'Selbststellbetrieb einschalten'),
      fn: () => { s.selfSet = !s.selfSet; logMsg(`${s.name}: Selbststellbetrieb ${s.selfSet ? 'ein' : 'aus'}.`); }
    });
    items.push({
      label: s.blocked ? 'Signalsperre aufheben' : 'Signal sperren',
      fn: () => { s.blocked = !s.blocked; logMsg(`${s.name} ${s.blocked ? 'gesperrt' : 'freigegeben'}.`, 'warn'); }
    });
    items.push({
      label: 'Ersatzsignal (Zs1) zum nächsten Signal', fn: () => {
        const tr = sim.trains.find(t => t.waitSignal && t.waitSignal.id === s.id);
        sim.addMessage(`Ersatzsignal an ${s.name} angefordert.`, { from: 'Fdl' });
        sim.answerMessage(sim.messages[0].id, 'zs1');
        sim.messages[0].data = { signalId: s.id, trainId: tr ? tr.id : null };
      }
    });
  } else if (pick.type === 'switch') {
    const k = key(pick.cell.x, pick.cell.y);
    items.push({ title: `Weiche ${k}` });
    items.push({ label: 'Umstellen', fn: () => { const r = sim.toggleSwitch(k); if (!r.ok) toast(r.reason); } });
    const rid = sim.lockedCells.get(k);
    const route = sim.routes.find(r => r.id === rid);
    if (route) items.push({
      label: `Fahrstraße ${route.id} auflösen`, fn: () => { sim.freeTrainAuthority(route); releaseRoute(sim, route); logMsg(`${route.id} aufgelöst.`, 'warn'); }
    });
    if (sim.faultySwitches.has(k)) items.push({ label: 'Störung anzeigen', fn: () => switchView('sim') });
  } else if (pick.type === 'crossing') {
    const st = sim.crossingState.get(pick.cell.crossing.name);
    items.push({ title: `${st.name} (${st.mode === 'manual' ? 'handbedient' : 'automatisch'})` });
    items.push({ label: 'Schranken schließen', fn: () => sim.closeCrossing(st.name) });
    items.push({ label: 'Schranken öffnen', fn: () => sim.openCrossing(st.name) });
  } else {
    const k = key(pick.cell.x, pick.cell.y);
    const rid = sim.lockedCells.get(k);
    const route = sim.routes.find(r => r.id === rid);
    items.push({ title: `Gleis ${k}` });
    if (route) items.push({
      label: `Fahrstraße ${route.id} auflösen`, fn: () => {
        const busy = route.steps.some(st => sim.occupiedCells().has(st.k));
        if (busy) { releaseRoute(sim, route, { delay: true }); sim.stats.emergencyReleases++; logMsg(`Hilfsauflösung ${route.id} läuft.`, 'warn'); }
        else { sim.freeTrainAuthority(route); releaseRoute(sim, route); logMsg(`${route.id} aufgelöst.`, 'warn'); }
      }
    });
    const tr = sim.trainAtCell(k);
    if (tr) items.push({ label: `Zug ${tr.nr} verfolgen`, fn: () => { app.followTrain = tr.id; toast(`${tr.nr} wird verfolgt.`); } });
    if (sim.blockedCells.has(k)) items.push({ label: 'Gleissperrung aufheben', fn: () => { sim.blockedCells.delete(k); logMsg(`Sperrung ${k} aufgehoben.`, 'warn'); } });
    else items.push({ label: 'Gleis sperren', fn: () => { sim.blockedCells.add(k); logMsg(`Gleis ${k} gesperrt.`, 'warn'); } });
  }
  showCtx(e.clientX, e.clientY, items);
}

function showCtx(x, y, items) {
  const m = $('#ctxmenu');
  m.innerHTML = '';
  for (const it of items) {
    if (it.title) {
      const d = document.createElement('div');
      d.className = 'title'; d.textContent = it.title;
      m.append(d, Object.assign(document.createElement('div'), { className: 'sep' }));
      continue;
    }
    const b = document.createElement('button');
    b.textContent = it.label;
    b.onclick = () => { hideCtx(); it.fn(); };
    m.append(b);
  }
  m.classList.remove('hidden');
  m.style.left = Math.min(x, window.innerWidth - 220) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 10) + 'px';
}
const hideCtx = () => $('#ctxmenu').classList.add('hidden');

const label = p => p.type === 'signal' ? p.sig.name : (p.cell.entry || 'Gleis');
function setStatus(html, warn = false) {
  const el = $('#route-status');
  el.innerHTML = html;
  el.style.color = warn ? 'var(--warn)' : '';
}

/* ============================ Panels ============================ */
function updateTrainTable() {
  const tb = $('#train-table tbody');
  const filter = ($('#train-filter').value || '').toLowerCase();
  const sort = $('#train-sort').value;
  let rows = app.sim.trains.filter(t => t.state !== 'done');
  if (filter) rows = rows.filter(t =>
    t.nr.toLowerCase().includes(filter) ||
    (t.stops[t.nextStop]?.platform || '').toLowerCase().includes(filter) ||
    t.entryName.toLowerCase().includes(filter) || t.exitName.toLowerCase().includes(filter));
  rows.sort((a, b) => sort === 'delay' ? b.delay - a.delay
    : sort === 'nr' ? a.nr.localeCompare(b.nr, 'de', { numeric: true })
      : a.plannedEntry - b.plannedEntry);
  $('#train-count').textContent = `(${rows.length} unterwegs / ${app.sim.stats.finished} fertig)`;
  tb.innerHTML = '';
  for (const t of rows.slice(0, 60)) {
    const tr = document.createElement('tr');
    const stop = t.stops[t.nextStop];
    let ziel;
    if (t.state === 'pending') ziel = `Einfahrt ${hhmm(t.plannedEntry)}`;
    else if (t.state === 'turning') ziel = `Wende bis ${hhmm(t.turnReadyAt)}`;
    else if (t.state === 'dwell') ziel = `${stop ? stop.platform : ''} – ab ${hhmm(t.departAt)}${t.waitForConnection ? ' (Anschluss)' : ''}`;
    else if (stop) ziel = `${stop.platform} an ${hhmm(stop.arr)} ab ${hhmm(stop.dep)}`;
    else ziel = `Ausfahrt ${t.exitName}`;
    const dl = t.state === 'pending' ? 0 : t.delay;
    const cls = dl < 60 ? 'delay-ok' : dl < 300 ? 'delay-mid' : 'delay-bad';
    tr.innerHTML = `<td>${escapeHtml(t.nr)}<br><span class="small">${stateName(t)}</span></td>
      <td>${escapeHtml(t.entryName)}→${escapeHtml(t.exitName)}</td>
      <td>${escapeHtml(ziel)}</td>
      <td class="${cls}">${t.state === 'pending' ? '–' : signedMin(dl)}</td>`;
    tr.onclick = () => { app.followTrain = t.id; scrollToTrain(t); };
    tb.append(tr);
  }
}
function stateName(t) {
  if (t.state === 'pending') return 'angekündigt';
  if (t.state === 'waiting') return 'wartet auf Einfahrt';
  if (t.state === 'dwell') return 'hält';
  if (t.state === 'turning') return 'wendet';
  if (t.state === 'hold') return 'steht vor ' + (t.waitSignal ? t.waitSignal.name : 'Signal');
  return Math.round(t.v * 3.6) + ' km/h';
}
function scrollToTrain(t) {
  const cells = trainCells(t);
  if (!cells.length) return;
  const p = parseKey(cells[0]);
  const cs = cellSizeOf(app.layout, app.zoom);
  const wrap = $('#view-sim .canvas-wrap');
  wrap.scrollTo({ left: p.x * cs - wrap.clientWidth / 2, top: p.y * cs - wrap.clientHeight / 2, behavior: 'smooth' });
}

function updateMessages() {
  const box = $('#messages');
  const sig = app.sim.messages.map(m => m.id + (m.answered ? '!' : '')).join(',');
  if (sig === msgSig) return;
  msgSig = sig;
  box.innerHTML = '';
  for (const m of app.sim.messages.slice(0, 12)) {
    const div = document.createElement('div');
    div.className = 'msg ' + m.kind + (m.answered ? ' answered' : '');
    div.innerHTML = `<div class="head"><span>${escapeHtml(m.from)}</span><span>${hhmm(m.time)}</span></div>
      <div>${escapeHtml(m.text)}</div>`;
    if (m.actions.length && !m.answered) {
      const acts = document.createElement('div');
      acts.className = 'acts';
      for (const a of m.actions) {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.onclick = () => { app.sim.answerMessage(m.id, a.key); msgSig = ''; };
        acts.append(b);
      }
      div.append(acts);
    }
    box.append(div);
  }
}

function updateCrossingPanel() {
  const box = $('#crossing-list');
  const list = [...app.sim.crossingState.values()];
  const sig = list.map(c => c.name + c.state + c.fault).join(',');
  if (sig === crossSig) return;
  crossSig = sig;
  if (!list.length) { box.innerHTML = '<em>keine Bahnübergänge</em>'; return; }
  box.innerHTML = '';
  for (const c of list) {
    const div = document.createElement('div');
    div.style.display = 'flex'; div.style.justifyContent = 'space-between'; div.style.gap = '6px';
    const txt = c.fault ? 'gestört' : c.state === 'closed' ? 'geschlossen' : c.state === 'closing' ? 'schließt' : 'offen';
    div.innerHTML = `<span>${escapeHtml(c.name)} <span class="small">(${c.mode === 'manual' ? 'handbedient' : 'automatisch'})</span></span>
      <b class="${c.state === 'closed' ? 'delay-ok' : 'delay-mid'}">${txt}</b>`;
    const b = document.createElement('button');
    b.textContent = c.state === 'open' ? 'schließen' : 'öffnen';
    b.onclick = () => { c.state === 'open' ? app.sim.closeCrossing(c.name) : app.sim.openCrossing(c.name); crossSig = ''; };
    div.append(b);
    box.append(div);
  }
}

function updateQueuePanel() {
  const box = $('#queue-list');
  const q = app.sim.routeQueue;
  if (!q.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<b>Fahrstraßenspeicher:</b> ' + q.map(x =>
    `${escapeHtml(pointLabel(x.start))} → ${escapeHtml(pointLabel(x.dest))}`).join(', ');
}

/** eingestellte Fahrstraßen mit ihrem Zustand */
function updateRouteList() {
  const box = $('#route-list');
  const rs = app.sim.routes;
  if (!rs.length) { box.innerHTML = '<em>keine Fahrstraße eingestellt</em>'; return; }
  box.innerHTML = '';
  for (const r of rs) {
    const why = routeBlockReason(app.sim, r);
    const div = document.createElement('div');
    div.className = 'r';
    const from = r.signal ? r.signal.name : (r.entryName || '?');
    const zug = r.trainId ? (app.sim.trains.find(t => t.id === r.trainId)?.nr || '') : '';
    div.innerHTML = `<span><b>${r.id}</b> ${escapeHtml(from)} → ${escapeHtml(r.destName)}` +
      `${zug ? ' <span class="small">(' + escapeHtml(zug) + ')</span>' : ''}<br>` +
      (why ? `<span class="why">wartet: ${escapeHtml(why)}</span>`
        : `<span class="ok">${r.mode === 'shunt' ? 'Sh1 – Rangierfahrt' : r.substitute ? 'Zs1 – Ersatzsignal' : r.diverging ? 'Hp2 – Langsamfahrt' : 'Hp1 – Fahrt frei'}</span>`) +
      `</span>`;
    const b = document.createElement('button');
    b.textContent = '✕'; b.title = 'Fahrstraße auflösen';
    b.onclick = () => {
      const busy = r.steps.some(st => app.sim.occupiedCells().has(st.k));
      if (busy) { releaseRoute(app.sim, r, { delay: true }); app.sim.stats.emergencyReleases++; logMsg(`Hilfsauflösung ${r.id} läuft.`, 'warn'); }
      else { app.sim.freeTrainAuthority(r); releaseRoute(app.sim, r); logMsg(`${r.id} aufgelöst.`, 'warn'); }
    };
    div.append(b);
    box.append(div);
  }
}

function updateFaults() {
  const box = $('#fault-list');
  const f = app.sim.faults;
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
      b.onclick = () => { app.events.startRepair(fault); faultSig = ''; };
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
    <span>Pünktlich</span><b>${q} %</b>
    <span>Ø Verspätung</span><b>${avg} min</b>
    <span>größte Verspätung</span><b>${Math.round(s.maxDelay / 60)} min</b>
    <span>Fahrstraßen</span><b>${s.routesSet}</b>
    <span>davon Rangierfahrten</span><b>${s.shuntMoves}</b>
    <span>Halte vor Signal</span><b>${s.signalStops}</b>
    <span>Hilfsauflösungen</span><b>${s.emergencyReleases}</b>
    <span>Ausfälle</span><b>${s.cancelled}</b>
    <span>Störungen gesamt</span><b>${s.faultsTotal}</b>`;
}

function buildLegend() {
  $('#legend').innerHTML = LEGEND.map(([c, t]) =>
    `<i style="background:${c}"></i><span>${t}</span>`).join('');
}

/* ============================ Editor ============================ */
function buildEditor() {
  app.editor = new Editor($('#canvas-edit'), () => app.layout, () => { app.dirty = true; }, {
    properties: obj => openProperties(obj),
    toast
  });
  for (const b of document.querySelectorAll('.tool')) {
    b.onclick = () => {
      document.querySelectorAll('.tool').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      app.editor.tool = b.dataset.tool;
      app.templateMode = null;
      $('#tool-help').textContent = TOOL_HELP[app.editor.tool] || '';
    };
  }
  $('#tool-help').textContent = TOOL_HELP.track;
  const tsel = $('#template-select');
  tsel.innerHTML = Object.keys(TEMPLATES).map(n => `<option>${n}</option>`).join('');
  $('#btn-template').onclick = () => {
    app.templateMode = tsel.value;
    toast(`„${tsel.value}" – jetzt in den Gleisplan klicken.`);
  };
  $('#canvas-edit').addEventListener('mousedown', e => {
    if (!app.templateMode) return;
    const p = app.editor.cellFromEvent(e);
    app.editor.insertTemplate(app.templateMode, p.x, p.y);
    app.templateMode = null;
    app.dirty = true;
    e.stopPropagation();
  }, true);

  $('#btn-undo').onclick = () => { if (!app.editor.undo()) toast('Nichts rückgängig zu machen.'); app.dirty = true; };
  $('#btn-redo').onclick = () => { app.editor.redo(); app.dirty = true; };
  $('#stw-name').onchange = e => { app.layout.name = e.target.value || 'Stellwerk'; refreshLayoutList(); };
  $('#grid-w').onchange = e => { app.layout.gridW = clampInt(e.target.value, 10, 240); app.dirty = true; };
  $('#grid-h').onchange = e => { app.layout.gridH = clampInt(e.target.value, 6, 160); app.dirty = true; };
  $('#cell-size').oninput = e => { app.layout.cellSize = clampInt(e.target.value, 14, 48); };
  $('#start-time').onchange = e => {
    const t = parseTime(e.target.value);
    if (t === null) { e.target.value = hhmm(app.layout.startTime); return; }
    app.layout.startTime = t; app.dirty = true;
  };
  $('#btn-clear').onclick = () => {
    if (!window.confirm('Gleisplan wirklich vollständig leeren?')) return;
    app.editor.snapshot();
    app.layout.cells = {}; app.layout.signals = {}; app.layout.labels = []; app.layout.timetable = [];
    clearReachCache(app.layout);
    app.dirty = true;
  };
  $('#btn-demo').onclick = () => {
    if (!window.confirm('Demo-Stellwerk laden? Nicht gespeicherte Änderungen gehen verloren.')) return;
    app.layout = demoLayout();
    newSim(); syncEditorFields(); refreshTimetable(); buildEventsView(); buildSettings();
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

/* ---------------------- Eigenschaftsdialoge ---------------------- */
function openProperties(obj) {
  if (obj.type === 'signal') return signalProperties(obj.signal);
  return cellProperties(obj.cell);
}

function signalProperties(s) {
  openModal(`Signal ${s.name}`, body => {
    const f = document.createElement('div');
    f.className = 'settings-grid';
    f.innerHTML = `
      <label>Bezeichnung</label><input id="p-name" type="text" value="${escapeHtml(s.name)}">
      <label>Art</label><select id="p-kind">${Object.entries(SIGNAL_KINDS).map(([k, v]) =>
      `<option value="${k}"${k === s.kind ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <label>Durchrutschweg (m, leer = Voreinstellung)</label><input id="p-ov" type="number" value="${s.overlap ?? ''}">
      <label>Selbststellbetrieb</label><input id="p-self" type="checkbox"${s.selfSet ? ' checked' : ''}>
      <label>gesperrt</label><input id="p-block" type="checkbox"${s.blocked ? ' checked' : ''}>`;
    body.append(f);
    return () => {
      s.name = $('#p-name').value || s.name;
      s.kind = $('#p-kind').value;
      const ov = $('#p-ov').value.trim();
      s.overlap = ov === '' ? null : Math.max(0, parseInt(ov, 10) || 0);
      s.selfSet = $('#p-self').checked;
      s.blocked = $('#p-block').checked;
      app.dirty = true;
    };
  });
}

function cellProperties(c) {
  openModal(`Gleiszelle ${c.x},${c.y}`, body => {
    const f = document.createElement('div');
    f.className = 'settings-grid';
    f.innerHTML = `
      <label>Bahnsteig</label><input id="p-pf" type="text" value="${escapeHtml(c.platform || '')}">
      <label>Abstellgleis</label><input id="p-sd" type="text" value="${escapeHtml(c.stump || '')}">
      <label>Ein-/Ausfahrt</label><input id="p-en" type="text" value="${escapeHtml(c.entry || '')}">
      <label>Vmax (km/h)</label><input id="p-vm" type="number" value="${c.vmax ?? ''}">
      <label>Bahnübergang</label><input id="p-bu" type="text" value="${escapeHtml(c.crossing?.name || '')}">
      <label>BÜ handbedient</label><input id="p-bm" type="checkbox"${c.crossing?.mode === 'manual' ? ' checked' : ''}>
      <label>Doppelkreuzungsweiche</label><input id="p-dkw" type="checkbox"${c.dkw ? ' checked' : ''}${c.ends.length === 4 ? '' : ' disabled'}>
      <label>Streckenkilometer</label><input id="p-km" type="text" value="${escapeHtml(c.km || '')}">`;
    body.append(f);
    return () => {
      c.platform = $('#p-pf').value.trim() || null;
      c.stump = $('#p-sd').value.trim() || null;
      c.entry = $('#p-en').value.trim() || null;
      const vm = $('#p-vm').value.trim();
      c.vmax = vm === '' ? null : Math.max(5, parseInt(vm, 10) || 0);
      const bu = $('#p-bu').value.trim();
      c.crossing = bu ? { name: bu, mode: $('#p-bm').checked ? 'manual' : 'auto' } : null;
      if (c.ends.length === 4) c.dkw = $('#p-dkw').checked;
      c.km = $('#p-km').value.trim() || null;
      clearReachCache(app.layout);
      app.dirty = true;
    };
  });
}

/* ============================ Fahrplan ============================ */
function refreshTimetable() {
  renderTimetable($('#tt-table tbody'), app.layout, () => { app.dirty = true; }, {
    editStops: row => editStops(row),
    editTurn: row => editTurn(row)
  });
}

function editStops(row) {
  openModal(`Halte von ${row.nr}`, body => {
    const pfs = platforms(app.layout);
    const wrap = document.createElement('div');
    wrap.className = 'stop-editor';
    const table = document.createElement('table');
    const draw = () => {
      table.innerHTML = `<thead><tr><th>Bahnsteig</th><th>an</th><th>ab</th><th>Anschluss von</th><th>max. Warten</th><th></th></tr></thead>`;
      const tb = document.createElement('tbody');
      row.stops.forEach((st, i) => {
        const tr = document.createElement('tr');
        const pf = document.createElement('select');
        pf.innerHTML = pfs.map(p => `<option${p === st.platform ? ' selected' : ''}>${escapeHtml(p)}</option>`).join('');
        pf.onchange = () => st.platform = pf.value;
        const an = inputTime(hhmm(st.arr), v => st.arr = v);
        const ab = inputTime(hhmm(st.dep), v => st.dep = v);
        const conn = document.createElement('input');
        conn.type = 'text'; conn.value = (st.connections || []).map(c => c.from).join(', ');
        conn.onchange = () => st.connections = conn.value.split(',').map(s => s.trim()).filter(Boolean)
          .map(nr => ({ from: nr, maxWait: (st.connections?.[0]?.maxWait) || 600 }));
        const wait = document.createElement('input');
        wait.type = 'number'; wait.style.width = '5em';
        wait.value = Math.round(((st.connections?.[0]?.maxWait) || 600) / 60);
        wait.onchange = () => (st.connections || []).forEach(c => c.maxWait = Math.max(0, +wait.value || 0) * 60);
        const del = document.createElement('button');
        del.textContent = '✕'; del.className = 'danger';
        del.onclick = () => { row.stops.splice(i, 1); draw(); };
        for (const el of [pf, an, ab, conn, wait, del]) {
          const td = document.createElement('td'); td.append(el); tr.append(td);
        }
        tb.append(tr);
      });
      table.append(tb);
    };
    draw();
    const add = document.createElement('button');
    add.textContent = 'Halt hinzufügen';
    add.onclick = () => {
      const last = row.stops[row.stops.length - 1];
      const base = last ? last.dep + 600 : row.entryTime + 300;
      row.stops.push({ platform: pfs[0] || '', arr: base, dep: base + 120, connections: [] });
      draw();
    };
    wrap.append(table, add);
    body.append(wrap);
    return () => { row.stops.sort((a, b) => a.arr - b.arr); app.dirty = true; refreshTimetable(); };
  });
}

function editTurn(row) {
  openModal(`Wende von ${row.nr}`, body => {
    const es = entries(app.layout).map(e => e.name);
    const t = row.turn || { nr: row.nr + 'R', gattung: row.gattung, exit: es[0] || '', dep: (row.stops[0]?.dep || row.entryTime) + 600, wende: 300, stops: [] };
    const f = document.createElement('div');
    f.className = 'settings-grid';
    f.innerHTML = `
      <label>Wende aktiv</label><input id="t-on" type="checkbox"${row.turn ? ' checked' : ''}>
      <label>neue Zugnummer</label><input id="t-nr" type="text" value="${escapeHtml(t.nr)}">
      <label>Gattung</label><select id="t-gat">${GATTUNGEN.map(g =>
      `<option${g.code === t.gattung ? ' selected' : ''}>${g.code}</option>`).join('')}</select>
      <label>Ausfahrt</label><select id="t-exit">${es.map(e =>
      `<option${e === t.exit ? ' selected' : ''}>${escapeHtml(e)}</option>`).join('')}</select>
      <label>planmäßige Abfahrt</label><input id="t-dep" type="text" value="${hhmm(t.dep)}">
      <label>Wendezeit (min)</label><input id="t-w" type="number" value="${Math.round((t.wende || 300) / 60)}">`;
    body.append(f);
    return () => {
      if (!$('#t-on').checked) { row.turn = null; app.dirty = true; refreshTimetable(); return; }
      row.turn = {
        nr: $('#t-nr').value, gattung: $('#t-gat').value, exit: $('#t-exit').value,
        dep: parseTime($('#t-dep').value) ?? t.dep,
        wende: Math.max(60, (+$('#t-w').value || 5) * 60), stops: []
      };
      app.dirty = true; refreshTimetable();
    };
  });
}

function taktDialog() {
  openModal('Taktlinie anlegen', body => {
    const es = entries(app.layout).map(e => e.name);
    const pfs = ['(kein Halt)', ...platforms(app.layout)];
    const f = document.createElement('div');
    f.className = 'settings-grid';
    f.innerHTML = `
      <label>Gattung</label><select id="k-gat">${GATTUNGEN.filter(g => g.code !== 'Lok').map(g =>
      `<option${g.code === 'RE' ? ' selected' : ''}>${g.code}</option>`).join('')}</select>
      <label>von</label><select id="k-from">${es.map(e => `<option>${escapeHtml(e)}</option>`).join('')}</select>
      <label>nach</label><select id="k-to">${es.map((e, i) => `<option${i === 1 ? ' selected' : ''}>${escapeHtml(e)}</option>`).join('')}</select>
      <label>Halt</label><select id="k-pf">${pfs.map(p => `<option>${escapeHtml(p)}</option>`).join('')}</select>
      <label>erste Abfahrt</label><input id="k-first" type="text" value="06:00">
      <label>Takt (min)</label><input id="k-every" type="number" value="60">
      <label>Anzahl Züge</label><input id="k-count" type="number" value="8">
      <label>erste Zugnummer</label><input id="k-nr" type="number" value="4000">
      <label>Fahrzeit bis zum Halt (min)</label><input id="k-travel" type="number" value="5">
      <label>Wende am Ende</label><input id="k-turn" type="checkbox">`;
    body.append(f);
    return () => {
      const rows = generateTakt(app.layout, {
        gattung: $('#k-gat').value, from: $('#k-from').value, to: $('#k-to').value,
        platform: $('#k-pf').value === '(kein Halt)' ? null : $('#k-pf').value,
        firstDep: parseTime($('#k-first').value) ?? 6 * 3600,
        everyMin: +$('#k-every').value || 60, count: clampInt($('#k-count').value, 1, 200),
        nrStart: +$('#k-nr').value || 1000, travelSec: (+$('#k-travel').value || 5) * 60,
        turn: $('#k-turn').checked
      });
      app.layout.timetable.push(...rows);
      app.dirty = true;
      refreshTimetable();
      toast(`${rows.length} Zugfahrten angelegt.`);
    };
  });
}

function timetableCsv() {
  const lines = ['Zugnummer;Gattung;Einfahrt;Zeit;Ausfahrt;Halte;Wende;Vmax;Länge'];
  for (const r of app.layout.timetable) {
    lines.push([r.nr, r.gattung, r.entry, hhmm(r.entryTime), r.exit,
      stopsToText(r.stops), r.turn ? `${r.turn.nr} → ${r.turn.exit}` : '', r.vmax, r.length].join(';'));
  }
  downloadText(lines.join('\n'), app.layout.name + '-fahrplan.csv');
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ============================ Ereignisse ============================ */
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
    const test = document.createElement('button');
    test.textContent = 'auslösen';
    test.onclick = () => {
      const f = app.events.fireRandom(t.id);
      toast(f ? `${f.title}` : 'Ereignis derzeit nicht möglich.');
      switchView('sim');
    };
    for (const el of [cb, document.createTextNode(t.name), w, document.createTextNode(t.desc), test]) {
      const td = document.createElement('td'); td.append(el); tr.append(td);
    }
    tr.children[3].className = 'small';
    tb.append(tr);
  }
  $('#btn-ev-test').onclick = () => {
    const f = app.events.fireRandom();
    toast(f ? f.title : 'Kein Ereignis möglich.');
    switchView('sim');
  };
}

/* ============================ Gleisbelegung ============================ */
function drawOccupancy() {
  const cv = $('#occ-canvas');
  const from = parseTime($('#occ-from').value) ?? 6 * 3600;
  const to = parseTime($('#occ-to').value) ?? from + 6 * 3600;
  const pfs = platforms(app.layout);
  const W = cv.clientWidth || 1000, rowH = 26, H = 40 + pfs.length * rowH;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, W, H);
  const left = 90, right = W - 12;
  const xOf = t => left + (right - left) * (t - from) / Math.max(1, to - from);

  ctx.strokeStyle = '#222a35'; ctx.fillStyle = '#8b98a8';
  ctx.font = '11px Segoe UI'; ctx.textBaseline = 'middle';
  for (let t = Math.ceil(from / 1800) * 1800; t <= to; t += 1800) {
    ctx.beginPath(); ctx.moveTo(xOf(t), 18); ctx.lineTo(xOf(t), H); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(hhmm(t), xOf(t), 10);
  }
  pfs.forEach((pf, i) => {
    const y = 26 + i * rowH;
    ctx.textAlign = 'left'; ctx.fillStyle = '#c3cedb';
    ctx.fillText(pf, 6, y + rowH / 2);
    ctx.strokeStyle = '#1b222d';
    ctx.beginPath(); ctx.moveTo(left, y + rowH); ctx.lineTo(right, y + rowH); ctx.stroke();

    // Plan
    for (const row of app.layout.timetable) {
      for (const st of row.stops) {
        if (st.platform !== pf) continue;
        ctx.fillStyle = '#39414d';
        ctx.fillRect(xOf(st.arr), y + 4, Math.max(3, xOf(st.dep) - xOf(st.arr)), rowH * 0.34);
        ctx.fillStyle = '#8b98a8';
        ctx.font = '10px Segoe UI';
        ctx.fillText(row.nr, xOf(st.arr) + 2, y + 4 + rowH * 0.17);
      }
    }
    // Ist
    for (const o of app.sim.occupancyLog) {
      if (o.platform !== pf) continue;
      const end = o.to ?? app.sim.time;
      const late = (o.from - o.planFrom) > 300;
      ctx.fillStyle = late ? '#f85149' : '#3fb950';
      ctx.fillRect(xOf(o.from), y + rowH * 0.5, Math.max(3, xOf(end) - xOf(o.from)), rowH * 0.34);
      ctx.fillStyle = '#0a0e14';
      ctx.font = 'bold 10px Segoe UI';
      ctx.fillText(o.nr, xOf(o.from) + 2, y + rowH * 0.67);
    }
  });
  // aktuelle Zeit
  if (app.sim.time >= from && app.sim.time <= to) {
    ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(xOf(app.sim.time), 18); ctx.lineTo(xOf(app.sim.time), H); ctx.stroke();
    ctx.lineWidth = 1;
  }
}

/* ============================ Auswertung ============================ */
function buildReport() {
  const rep = app.sim.report();
  const done = rep.trains.filter(t => t.state === 'done');
  $('#report-kpi').innerHTML = `
    <span>Züge insgesamt</span><b>${rep.trains.length}</b>
    <span>abgewickelt</span><b>${done.length}</b>
    <span>pünktlich (&lt; ${Math.round((app.layout.settings.punctualLimit ?? 300) / 60)} min)</span><b>${rep.stats.punctual}</b>
    <span>Ø Verspätung</span><b>${Math.round(rep.avgDelay / 60)} min</b>
    <span>Fahrstraßen gestellt</span><b>${rep.stats.routesSet}</b>
    <span>Störungen</span><b>${rep.stats.faultsTotal}</b>`;

  const tb = $('#report-table tbody');
  tb.innerHTML = '';
  for (const t of rep.trains) {
    const tr = document.createElement('tr');
    const halte = t.halte.map(h =>
      `${h.platform}: ${hhmm(h.anPlan)}→${h.anIst ? hhmm(h.anIst) : '—'} / ${hhmm(h.abPlan)}→${h.abIst ? hhmm(h.abIst) : '—'}`).join('<br>') || '–';
    const cls = t.delay < 60 ? 'delay-ok' : t.delay < 300 ? 'delay-mid' : 'delay-bad';
    tr.innerHTML = `<td>${escapeHtml(t.nr)}</td><td>${escapeHtml(t.gattung)}</td>
      <td>${escapeHtml(t.von)} → ${escapeHtml(t.nach)}</td><td class="small">${halte}</td>
      <td>${stateLabel(t.state)}</td><td class="${cls}">${signedMin(t.delay)}</td>`;
    tb.append(tr);
  }

  // Verspätungsverteilung
  const cv = $('#report-canvas');
  const W = cv.clientWidth || 900, H = 180;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, W, H);
  const buckets = [0, 0, 0, 0, 0, 0];
  const labels = ['pünktlich', '< 3 min', '< 5 min', '< 10 min', '< 20 min', '≥ 20 min'];
  for (const t of done) {
    const m = t.delay / 60;
    buckets[m < 1 ? 0 : m < 3 ? 1 : m < 5 ? 2 : m < 10 ? 3 : m < 20 ? 4 : 5]++;
  }
  if (!done.length) {
    ctx.fillStyle = '#8b98a8'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('Noch keine abgeschlossenen Zugfahrten – das Diagramm füllt sich im Betrieb.', W / 2, H / 2);
    return;
  }
  const max = Math.max(1, ...buckets);
  const bw = (W - 40) / buckets.length;
  buckets.forEach((v, i) => {
    const h = (H - 50) * v / max;
    ctx.fillStyle = ['#3fb950', '#63d3a6', '#e3b341', '#e08c3a', '#f85149', '#c957d6'][i];
    ctx.fillRect(20 + i * bw + 8, H - 30 - h, bw - 16, h);
    ctx.fillStyle = '#c3cedb'; ctx.font = '11px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], 20 + i * bw + bw / 2, H - 14);
    if (v) ctx.fillText(String(v), 20 + i * bw + bw / 2, H - 36 - h);
  });
}
const stateLabel = s => ({
  done: 'beendet', pending: 'angekündigt', waiting: 'wartet', run: 'unterwegs',
  hold: 'steht', dwell: 'hält', turning: 'wendet'
}[s] || s);

function reportCsv() {
  const rep = app.sim.report();
  const lines = ['Zug;Gattung;von;nach;Zustand;Verspätung_min;Halte'];
  for (const t of rep.trains) {
    lines.push([t.nr, t.gattung, t.von, t.nach, t.state, Math.round(t.delay / 60),
      t.halte.map(h => `${h.platform} an ${hhmm(h.anPlan)}/${h.anIst ? hhmm(h.anIst) : '-'} ab ${hhmm(h.abPlan)}/${h.abIst ? hhmm(h.abIst) : '-'}`).join(' | ')].join(';'));
  }
  downloadText(lines.join('\n'), app.layout.name + '-auswertung.csv');
}

/* ============================ Einstellungen ============================ */
const SETTING_FIELDS = [
  ['flankProtection', 'Flankenschutz fordern', 'bool'],
  ['overlapM', 'Durchrutschweg (m)', 'num'],
  ['overlapReleaseSec', 'Auflösung Durchrutschweg nach (s)', 'num'],
  ['switchTime', 'Weichenumlaufzeit (s)', 'num'],
  ['accel', 'Anfahrbeschleunigung (m/s²)', 'num'],
  ['brake', 'Bremsverzögerung (m/s²)', 'num'],
  ['crossingCloseSec', 'Schließzeit Bahnübergang (s)', 'num'],
  ['releaseDelaySec', 'Wartezeit Hilfsauflösung (s)', 'num'],
  ['minDwell', 'Mindesthaltezeit (s)', 'num'],
  ['punctualLimit', 'Grenze „pünktlich" (s)', 'num'],
  ['divergingSpeed', 'Geschwindigkeit über abzweigende Weichen (km/h)', 'num'],
  ['substituteSpeed', 'Geschwindigkeit bei Ersatzsignal (km/h)', 'num'],
  ['shuntSpeed', 'Rangiergeschwindigkeit (km/h)', 'num'],
  ['showVmax', 'Geschwindigkeiten im Gleisbild anzeigen', 'bool'],
  ['showZN', 'Zugnummern im Gleisbild anzeigen', 'bool']
];

function buildSettings() {
  const box = $('#settings-form');
  const st = app.layout.settings;
  box.innerHTML = '';
  for (const [key_, label_, type] of SETTING_FIELDS) {
    const lab = document.createElement('label');
    lab.textContent = label_;
    const inp = document.createElement('input');
    if (type === 'bool') { inp.type = 'checkbox'; inp.checked = st[key_] !== false; }
    else {
      inp.type = 'number';
      inp.value = st[key_] ?? 0;
      if (key_ === 'accel' || key_ === 'brake') inp.step = '0.1';
    }
    inp.onchange = () => {
      st[key_] = type === 'bool' ? inp.checked : (parseFloat(inp.value) || 0);
      app.dirty = type === 'bool' ? app.dirty : true;
    };
    box.append(lab, inp);
  }
  refreshSaveList();
}

function refreshSaveList() {
  const box = $('#savegame-list');
  const all = store.listSaves();
  const names = Object.keys(all);
  if (!names.length) { box.innerHTML = '<em>keine Spielstände gespeichert</em>'; return; }
  box.innerHTML = '';
  for (const n of names) {
    const div = document.createElement('div');
    div.style.display = 'flex'; div.style.justifyContent = 'space-between'; div.style.gap = '6px';
    div.innerHTML = `<span>${escapeHtml(n)} <span class="small">${new Date(all[n].savedAt).toLocaleString('de-DE')} – ${escapeHtml(all[n].sim?.layoutName || '')}</span></span>`;
    const load = document.createElement('button');
    load.textContent = 'laden';
    load.onclick = () => loadGame(n);
    const del = document.createElement('button');
    del.textContent = '✕'; del.className = 'danger';
    del.onclick = () => { store.deleteGame(n); refreshSaveList(); };
    div.append(load, del);
    box.append(div);
  }
}

function saveGame() {
  const name = $('#save-name').value.trim() || `${app.layout.name} ${hhmm(app.sim.time)}`;
  store.saveGame(name, { layout: app.layout, sim: app.sim.toJSON() });
  refreshSaveList();
  toast(`Spielstand „${name}" gespeichert.`);
}

function loadGame(name) {
  const data = store.loadGame(name);
  if (!data) return;
  app.layout = store.migrate(data.layout);
  newSim();
  Sim.restore(app.sim, data.sim);
  app.sim.running = false;
  app.dirty = false;                 // geladenen Zustand nicht sofort zurücksetzen
  $('#btn-play').textContent = '▶';
  $('#auto-route').checked = app.sim.autoRoute;
  syncEditorFields(); refreshTimetable(); buildEventsView(); refreshLayoutList();
  switchView('sim');
  toast(`Spielstand „${name}" geladen (${hhmm(app.sim.time)}).`);
}

/* ============================ Modal / Hilfe ============================ */
function openModal(title, build) {
  const m = $('#modal');
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  const apply = build(body);
  m.classList.remove('hidden');
  $('#modal-ok').onclick = () => { if (apply) apply(); m.classList.add('hidden'); };
  $('#modal-cancel').onclick = () => m.classList.add('hidden');
}

function showHelp() {
  openModal('Bedienung und Tastenkürzel', body => {
    body.innerHTML = `
      <div class="helpgrid">
        <span class="kbd">Klick</span><span>Signal/Einfahrt wählen: erst Start, dann Ziel → Fahrstraße</span>
        <span class="kbd">weites Ziel</span><span>Zuglenkung: liegen Signale dazwischen, wird die ganze Kette von Teilfahrstraßen gestellt</span>
        <span class="kbd">Umschalt+Klick</span><span>Ziel mit Ersatzsignal (Zs1) – Vorbeifahrt am gestörten Signal</span>
        <span class="kbd">Rechtsklick</span><span>Kontextmenü: Auflösung, Selbststellbetrieb, Signalsperre, Gleissperrung</span>
        <span class="kbd">Klick auf Weiche</span><span>Weiche umstellen (Umlaufzeit beachten)</span>
        <span class="kbd">Klick auf BÜ</span><span>Schranken schließen bzw. öffnen</span>
        <span class="kbd">Leertaste</span><span>Start/Pause</span>
        <span class="kbd">A</span><span>Automatikbetrieb ein/aus</span>
        <span class="kbd">R</span><span>Rangierfahrstraßen-Modus ein/aus</span>
        <span class="kbd">1…6</span><span>Zeitraffer 1× bis 120×</span>
        <span class="kbd">+ / −</span><span>Gleisbild vergrößern/verkleinern</span>
        <span class="kbd">Esc</span><span>Auswahl abbrechen, Menüs schließen</span>
        <span class="kbd">Strg+Z / Strg+Y</span><span>Editor: rückgängig / wiederholen</span>
        <span class="kbd">F1</span><span>diese Hilfe</span>
      </div>
      <p class="small">Signalbegriffe: Hp0 Halt · Hp1 Fahrt · Hp2 Langsamfahrt (abzweigende Weiche) ·
      Zs1 Ersatzsignal · Sh1 Rangierfahrt · Vr0/Vr1/Vr2 Vorsignal.
      Eine Fahrstraße zeigt erst Fahrt, wenn alle Weichen in Endlage liegen, der Flankenschutz steht,
      der Durchrutschweg frei ist und die Bahnübergänge geschlossen sind. Das Feld
      „Fahrstraße" zeigt zu jeder eingestellten Fahrstraße, worauf sie noch wartet.</p>
      <p class="small"><b>Damit Züge nicht unnötig bremsen:</b> Fahrstraßen im Voraus stellen –
      der Durchrutschweg der vorherigen Fahrstraße wird dabei automatisch überlagert.
      Ein Zug, der erst am Einfahrsignal eine Weiterfahrt bekommt, verliert durch Bremsen und
      Anfahren rund eine Minute. Anfahrbeschleunigung und Bremsverzögerung lassen sich unter
      „Einstellungen" ändern, das Tempo des Betriebs oben rechts (bis 120×).</p>`;
    return null;
  });
}

/* ============================ Rahmen ============================ */
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
  $('#shunt-mode').onchange = e => { app.shuntMode = e.target.checked; setStatus(app.shuntMode ? 'Rangierbetrieb: Start wählen.' : 'Zugfahrten: Start wählen.'); };
  $('#queue-mode').onchange = e => app.queueMode = e.target.checked;
  $('#btn-reset').onclick = () => { newSim(); $('#btn-play').textContent = '▶'; };
  $('#btn-route-cancel').onclick = () => { app.routeStart = null; setStatus('Auswahl abgebrochen.'); };
  $('#train-filter').oninput = () => updateTrainTable();
  $('#train-sort').onchange = () => updateTrainTable();

  $('#canvas').addEventListener('click', onSimClick);
  $('#canvas').addEventListener('contextmenu', onSimContext);
  $('#canvas').addEventListener('mousemove', e => { app.hoverPick = app.routeStart ? simPick(e) : null; });
  document.addEventListener('click', e => { if (!e.target.closest('#ctxmenu')) hideCtx(); });
  $('#canvas-hint').textContent = 'Klick: Fahrstraße · Rechtsklick: Menü · Leertaste: Start/Pause · F1: Hilfe';

  for (const box of ['#zoom-box', '#zoom-box-edit']) {
    $(box).querySelectorAll('button').forEach(b => b.onclick = () => zoom(b.dataset.zoom === '+' ? 1.25 : 0.8, box === '#zoom-box'));
  }

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') { app.routeStart = null; hideCtx(); $('#modal').classList.add('hidden'); setStatus('Auswahl abgebrochen.'); }
    if (e.key === 'F1') { e.preventDefault(); showHelp(); }
    if (app.view === 'sim') {
      if (e.key === ' ') { e.preventDefault(); $('#btn-play').click(); }
      if (e.key.toLowerCase() === 'a') { $('#auto-route').checked = !$('#auto-route').checked; $('#auto-route').onchange({ target: $('#auto-route') }); }
      if (e.key.toLowerCase() === 'r') { $('#shunt-mode').checked = !$('#shunt-mode').checked; app.shuntMode = $('#shunt-mode').checked; setStatus(app.shuntMode ? 'Rangierbetrieb aktiv.' : 'Zugfahrten.'); }
      if ('123456'.includes(e.key)) {
        const v = [1, 2, 5, 10, 30, 60][+e.key - 1];
        $('#speed').value = String(v); app.sim.speedFactor = v;
      }
      if (e.key === '+' || e.key === '-') zoom(e.key === '+' ? 1.25 : 0.8, true);
    }
    if (app.view === 'editor') {
      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); app.editor.undo(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); app.editor.redo(); }
      if (e.key === '+' || e.key === '-') zoom(e.key === '+' ? 1.25 : 0.8, false);
    }
  });

  $('#btn-help').onclick = showHelp;
  $('#btn-new').onclick = () => {
    const name = window.prompt('Name des neuen Stellwerks:', 'Mein Stellwerk');
    if (!name) return;
    app.layout = newLayout(name);
    app.layout.events = defaultEventConfig();
    newSim(); syncEditorFields(); refreshTimetable(); buildEventsView(); buildSettings(); refreshLayoutList();
    switchView('editor');
  };
  $('#btn-save').onclick = () => {
    store.save(app.layout); store.setLastName(app.layout.name);
    refreshLayoutList();
    toast(`Stellwerk „${app.layout.name}" gespeichert.`);
  };
  $('#btn-export').onclick = () => store.exportFile(app.layout);
  $('#btn-import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      app.layout = await store.importFile(file);
      if (!app.layout.events) app.layout.events = defaultEventConfig();
      newSim(); syncEditorFields(); refreshTimetable(); buildEventsView(); buildSettings(); refreshLayoutList();
      toast(`Datei „${file.name}" geladen.`);
    } catch (err) { window.alert('Datei konnte nicht gelesen werden: ' + err.message); }
    e.target.value = '';
  };
  $('#stw-select').onchange = e => {
    const L = store.load(e.target.value);
    if (!L) return;
    app.layout = L;
    if (!app.layout.events) app.layout.events = defaultEventConfig();
    store.setLastName(L.name);
    newSim(); syncEditorFields(); refreshTimetable(); buildEventsView(); buildSettings();
  };

  $('#btn-add-train').onclick = () => { app.layout.timetable.push(emptyRow(app.layout)); refreshTimetable(); app.dirty = true; };
  $('#btn-gen-train').onclick = () => {
    const n = clampInt($('#gen-count').value, 1, 200);
    const rows = generateTimetable(app.layout, n, app.layout.startTime, Math.floor(Math.random() * 1e6));
    if (!rows.length) return window.alert('Kein Fahrplan möglich: Es fehlen Ein-/Ausfahrten oder befahrbare Verbindungen.');
    app.layout.timetable = rows;
    refreshTimetable(); app.dirty = true;
    toast(`${rows.length} Zugfahrten erzeugt.`);
  };
  $('#btn-takt').onclick = taktDialog;
  $('#btn-check-tt').onclick = () => {
    $('#tt-check').innerHTML = checkTimetable(app.layout).map(escapeHtml).join('<br>');
  };
  $('#btn-tt-csv').onclick = timetableCsv;
  $('#btn-del-all').onclick = () => {
    if (window.confirm('Gesamten Fahrplan löschen?')) { app.layout.timetable = []; refreshTimetable(); app.dirty = true; }
  };

  $('#btn-occ-refresh').onclick = drawOccupancy;
  $('#btn-report-refresh').onclick = buildReport;
  $('#btn-report-csv').onclick = reportCsv;
  $('#btn-savegame').onclick = saveGame;

  buildEditor();
  refreshTimetable();
  buildEventsView();
  buildSettings();
  buildLegend();
  setStatus('Startsignal oder Einfahrt anklicken.');
}

function zoom(factor, isSim) {
  if (isSim) {
    app.zoom = Math.max(0.4, Math.min(3, app.zoom * factor));
    $('#zoom-label').textContent = Math.round(app.zoom * 100) + ' %';
  } else {
    app.editZoom = Math.max(0.4, Math.min(3, app.editZoom * factor));
    app.editor.zoom = app.editZoom;
    $('#zoom-label-edit').textContent = Math.round(app.editZoom * 100) + ' %';
  }
}

function switchView(view) {
  if (view === 'sim' && app.dirty) { newSim(); app.dirty = false; $('#btn-play').textContent = '▶'; }
  app.view = view;
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.view === view);
  for (const s of document.querySelectorAll('.view')) s.classList.remove('active');
  $('#view-' + view).classList.add('active');
  if (view === 'timetable') refreshTimetable();
  if (view === 'events') buildEventsView();
  if (view === 'editor') syncEditorFields();
  if (view === 'occupancy') drawOccupancy();
  if (view === 'report') buildReport();
  if (view === 'settings') buildSettings();
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

function inputTime(value, apply) {
  const i = document.createElement('input');
  i.type = 'text'; i.value = value; i.style.width = '5em';
  i.onchange = () => { const t = parseTime(i.value); if (t !== null) apply(t); else i.value = value; };
  return i;
}

/* Debug-Schnittstelle: erlaubt Konsole und Tests den Zugriff auf den Zustand */
window.stellwerk = {
  app, get sim() { return app.sim; }, get layout() { return app.layout; },
  lockRoute, releaseRoute, switchView, toast
};

boot();
