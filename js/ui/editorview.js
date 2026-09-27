/* ===================================================================
 * editorview.js – Editor-Ansicht: Werkzeuge, Anlage, Prüfung
 * ================================================================= */
import { app, call } from './app.js';
import { $, $$, h, esc, toast, openModal, clampInt } from './dom.js';
import { icon } from './icons.js';
import { Viewport } from './viewport.js';
import { validate, SIGNAL_KINDS, cellAt } from '../model.js';
import { hhmm, parseTime } from '../sim.js';
import { clearReachCache } from '../interlocking.js';
import { draw } from '../render.js';
import { Editor, TOOL_HELP, TEMPLATES } from '../editor.js';
import { demoLayout } from '../demo.js';

export let editViewport = null;
let flash = null;          // hervorgehobene Zelle aus der Prüfung

const TOOLS = [
  ['track', 'Gleis', 'route'], ['erase', 'Radieren', 'trash'],
  ['signal', 'Hauptsignal', 'signal'], ['distant', 'Vorsignal', 'signal'],
  ['shunt', 'Sperrsignal', 'signal'], ['platform', 'Bahnsteig', 'list'],
  ['siding', 'Abstellgleis', 'list'], ['entry', 'Ein-/Ausfahrt', 'flag'],
  ['crossing', 'Bahnübergang', 'warn'], ['dkw', 'DKW', 'route'],
  ['speed', 'Geschwindigkeit', 'clock'], ['label', 'Beschriftung', 'edit'],
  ['select', 'Eigenschaften', 'crosshair'], ['area', 'Bereich', 'select']
];

export function initEditorView() {
  app.editor = new Editor($('#canvas-edit'), () => app.layout, changed => { if (changed) app.dirty = true; }, {
    properties: obj => openProperties(obj),
    toast,
    selection: sel => $('#area-actions').classList.toggle('hidden', !sel)
  });
  editViewport = new Viewport({
    wrap: $('#edit-wrap'), canvas: $('#canvas-edit'), minimap: $('#minimap-edit'), zoomKey: 'editor',
    onZoom: z => { app.editor.zoom = z; $('#zoom-editor').textContent = Math.round(z * 100) + ' %'; }
  });

  const box = $('#tools');
  box.innerHTML = '';
  for (const [id, lbl, ic] of TOOLS) {
    box.append(h('button', {
      class: 'tool' + (id === 'track' ? ' active' : ''), 'data-tool': id,
      html: icon(ic, 14) + ' ' + lbl, onclick: () => setTool(id)
    }));
  }
  $('#tool-help').textContent = TOOL_HELP.track;

  const tsel = $('#template-select');
  tsel.innerHTML = Object.keys(TEMPLATES).map(n => `<option>${esc(n)}</option>`).join('');
  $('#btn-template').onclick = () => {
    app.templateMode = tsel.value;
    setEditStatus(`„${tsel.value}" – jetzt die linke obere Ecke im Gleisplan anklicken.`);
  };
  $('#canvas-edit').addEventListener('mousedown', e => {
    if (!app.templateMode || e.button !== 0) return;
    const p = app.editor.cellFromEvent(e);
    app.editor.insertTemplate(app.templateMode, p.x, p.y);
    toast(`Baustein „${app.templateMode}" gesetzt.`, 'ok');
    app.templateMode = null;
    app.dirty = true;
    setEditStatus('Baustein eingefügt. Strg+Z macht ihn rückgängig.');
    e.stopImmediatePropagation();
  }, true);
  $('#canvas-edit').addEventListener('mousemove', e => {
    const p = editViewport.cellAt(e);
    $('#edit-coords').textContent = `Zelle ${p.x},${p.y}`;
  });

  $('#btn-undo').onclick = () => { if (!app.editor.undo()) toast('Nichts rückgängig zu machen.'); };
  $('#btn-redo').onclick = () => app.editor.redo();
  for (const b of $$('#view-editor [data-zoom]')) b.onclick = () => editViewport.zoomBy(b.dataset.zoom === '+' ? 1.25 : 0.8);
  $('#btn-fit-edit').onclick = () => editViewport.fit();
  for (const b of $$('#view-editor .side-tabs button')) b.onclick = () => {
    $$('#view-editor .side-tabs button').forEach(x => x.classList.toggle('active', x === b));
    $$('#view-editor .pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + b.dataset.pane));
  };

  $('#btn-area-copy').onclick = () => toast(`${app.editor.copySelection()} Zellen kopiert.`);
  $('#btn-area-cut').onclick = () => toast(`${app.editor.cutSelection()} Zellen ausgeschnitten.`);
  $('#btn-area-del').onclick = () => { app.editor.deleteSelection(); toast('Bereich gelöscht.'); };

  $('#stw-name').onchange = e => { app.layout.name = e.target.value || 'Stellwerk'; call('refreshTitle'); call('refreshLayoutList'); };
  $('#grid-w').onchange = e => { app.layout.gridW = clampInt(e.target.value, 10, 240); app.dirty = true; };
  $('#grid-h').onchange = e => { app.layout.gridH = clampInt(e.target.value, 6, 160); app.dirty = true; };
  $('#cell-size').oninput = e => { app.layout.cellSize = clampInt(e.target.value, 14, 48); };
  $('#start-time').onchange = e => {
    const t = parseTime(e.target.value);
    if (t === null) { e.target.value = hhmm(app.layout.startTime); return; }
    app.layout.startTime = t; app.dirty = true;
  };
  $('#btn-clear').onclick = () => {
    if (!window.confirm('Gleisplan wirklich vollständig leeren? (Strg+Z macht es rückgängig)')) return;
    app.editor.snapshot();
    app.layout.cells = {}; app.layout.signals = {}; app.layout.labels = [];
    clearReachCache(app.layout);
    app.dirty = true;
  };
  $('#btn-demo').onclick = () => {
    if (!window.confirm('Demo-Stellwerk laden? Nicht gespeicherte Änderungen gehen verloren.')) return;
    call('loadLayout', demoLayout(), 'Freies Spiel');
  };
  $('#btn-autosignals').onclick = () => {
    const n = app.editor.autoSignals();
    toast(n ? `${n} Signale gesetzt – bitte prüfen und bei Bedarf umbenennen.` : 'Keine Stellen ohne Signal gefunden.', n ? 'ok' : '');
  };
  $('#btn-validate').onclick = runValidation;
  syncEditorFields();
}

export function setTool(id) {
  app.editor.tool = id;
  app.templateMode = null;
  $$('#tools .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
  $('#tool-help').textContent = TOOL_HELP[id] || '';
  setEditStatus(TOOL_HELP[id] || '');
  if (id !== 'area') { app.editor.selection = null; $('#area-actions').classList.add('hidden'); }
}

function setEditStatus(text) { $('#edit-status').textContent = text; }

export function syncEditorFields() {
  $('#stw-name').value = app.layout.name;
  $('#grid-w').value = app.layout.gridW;
  $('#grid-h').value = app.layout.gridH;
  $('#cell-size').value = app.layout.cellSize;
  $('#start-time').value = hhmm(app.layout.startTime);
}

export function drawEditor() {
  const pulse = flash && performance.now() < flash.until ? [flash] : null;
  draw($('#canvas-edit'), app.layout, null, {
    grid: true, hover: app.editor.hover, zoom: app.zoom.editor,
    selection: app.editor.tool === 'area' ? app.editor.selection : null, pulse
  });
  editViewport.drawMinimap(null);
  $('#element-info').innerHTML = app.editor.describe();
}

/** Tastatur im Editor (Strg+C/X/V, Entf, Pfeile, Strg+Z/Y) */
export function editorKey(e) {
  const ed = app.editor;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z') { e.preventDefault(); ed.undo(); return true; }
  if (e.ctrlKey && k === 'y') { e.preventDefault(); ed.redo(); return true; }
  if (ed.tool !== 'area') return false;
  if (e.ctrlKey && k === 'c') { e.preventDefault(); toast(`${ed.copySelection()} Zellen kopiert.`); return true; }
  if (e.ctrlKey && k === 'x') { e.preventDefault(); toast(`${ed.cutSelection()} Zellen ausgeschnitten.`); return true; }
  if (e.ctrlKey && k === 'v') {
    e.preventDefault();
    if (!ed.clipboard) { toast('Zwischenablage ist leer.'); return true; }
    const p = ed.hover || { x: 0, y: 0 };
    ed.paste(p.x, p.y);
    toast('Eingefügt.', 'ok');
    return true;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ed.deleteSelection(); return true; }
  const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (mv && ed.selection) { e.preventDefault(); ed.moveSelection(mv[0], mv[1]); return true; }
  return false;
}

/* ---------------- Prüfung mit Sprung zur Fundstelle ---------------- */
function runValidation() {
  const msgs = validate(app.layout);
  const box = $('#validate-out');
  box.innerHTML = '';
  let warn = 0;
  for (const m of msgs) {
    const cls = m.startsWith('⚠') ? 'w' : m.startsWith('ℹ') ? 'i' : 'g';
    if (cls === 'w') warn++;
    const pos = locate(m);
    const el = h('div', { class: cls + (pos ? ' click' : ''), title: pos ? 'Zur Stelle springen' : '' }, m);
    if (pos) el.onclick = () => {
      editViewport.centerOn(pos.x, pos.y);
      flash = { x: pos.x, y: pos.y, until: performance.now() + 4000 };
    };
    box.append(el);
  }
  $('#badge-check').textContent = warn || '';
}

function locate(text) {
  const m = /(?:Zelle|Weiche|Gleis|Signal)\s+(\d+),(\d+)/.exec(text) || /(\d+),(\d+)/.exec(text);
  if (m) return { x: +m[1], y: +m[2] };
  const s = /Signal\s+(?:„)?([^\s:„"]+)/.exec(text);
  if (s) {
    const sg = Object.values(app.layout.signals).find(x => x.name === s[1]);
    if (sg) return { x: sg.x, y: sg.y };
  }
  return null;
}

/* ---------------- Eigenschaftsdialoge ---------------- */
function openProperties(obj) {
  if (obj.type === 'signal') return signalProperties(obj.signal);
  return cellProperties(obj.cell);
}

function signalProperties(s) {
  openModal(`Signal ${s.name}`, body => {
    body.append(h('div', { class: 'settings-grid', html: `
      <label>Bezeichnung</label><input id="p-name" type="text" value="${esc(s.name)}">
      <label>Art</label><select id="p-kind">${Object.entries(SIGNAL_KINDS).map(([k, v]) =>
      `<option value="${k}"${k === s.kind ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <label>Durchrutschweg in m (leer = Voreinstellung)</label><input id="p-ov" type="number" value="${s.overlap ?? ''}">
      <label>Selbststellbetrieb</label><input id="p-self" type="checkbox"${s.selfSet ? ' checked' : ''}>
      <label>gesperrt</label><input id="p-block" type="checkbox"${s.blocked ? ' checked' : ''}>` }));
    body.append(h('button', {
      class: 'danger', style: { marginTop: '10px' }, onclick: () => {
        app.editor.snapshot(); delete app.layout.signals[s.id]; app.dirty = true;
        $('#modal').classList.add('hidden'); toast(`Signal ${s.name} entfernt.`);
      }
    }, 'Signal entfernen'));
    return () => {
      app.editor.snapshot();
      s.name = $('#p-name').value.trim() || s.name;
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
    body.append(h('div', { class: 'settings-grid', html: `
      <label>Bahnsteig</label><input id="p-pf" type="text" value="${esc(c.platform || '')}">
      <label>Abstellgleis</label><input id="p-sd" type="text" value="${esc(c.stump || '')}">
      <label>Ein-/Ausfahrt</label><input id="p-en" type="text" value="${esc(c.entry || '')}">
      <label>Vmax (km/h)</label><input id="p-vm" type="number" value="${c.vmax ?? ''}">
      <label>Bahnübergang</label><input id="p-bu" type="text" value="${esc(c.crossing?.name || '')}">
      <label>BÜ von Hand bedient</label><input id="p-bm" type="checkbox"${c.crossing?.mode === 'manual' ? ' checked' : ''}>
      <label>Doppelkreuzungsweiche</label><input id="p-dkw" type="checkbox"${c.dkw ? ' checked' : ''}${c.ends.length === 4 ? '' : ' disabled'}>
      <label>Streckenkilometer</label><input id="p-km" type="text" value="${esc(c.km || '')}">` }));
    return () => {
      app.editor.snapshot();
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
