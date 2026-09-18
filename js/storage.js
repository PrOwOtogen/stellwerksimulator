/* ===================================================================
 * storage.js – Speichern im Browser und Im-/Export als JSON-Datei
 * ================================================================= */
import { defaultSettings } from './model.js';

const KEY = 'stellwerksim.layouts';

export function listNames() {
  return Object.keys(loadAll()).sort((a, b) => a.localeCompare(b, 'de'));
}
export function loadAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}
export function save(layout) {
  const all = loadAll();
  all[layout.name] = layout;
  localStorage.setItem(KEY, JSON.stringify(all));
}
export function load(name) {
  const all = loadAll();
  return all[name] ? migrate(all[name]) : null;
}
export function remove(name) {
  const all = loadAll();
  delete all[name];
  localStorage.setItem(KEY, JSON.stringify(all));
}
export function lastName() { return localStorage.getItem(KEY + '.last') || null; }
export function setLastName(n) { localStorage.setItem(KEY + '.last', n); }

export function exportFile(layout) {
  const blob = new Blob([JSON.stringify(layout, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = layout.name.replace(/[^\wäöüÄÖÜß -]/g, '_') + '.stw.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(migrate(JSON.parse(r.result))); }
      catch (e) { reject(e); }
    };
    r.onerror = reject;
    r.readAsText(file);
  });
}

/** ältere/unvollständige Dateien auf das aktuelle Format bringen */
export function migrate(L) {
  L.version = L.version || 1;
  if (!L.settings) L.settings = defaultSettings();
  else L.settings = { ...defaultSettings(), ...L.settings };
  L.cells = L.cells || {};
  L.signals = L.signals || {};
  L.labels = L.labels || [];
  L.timetable = L.timetable || [];
  L.gridW = L.gridW || 60; L.gridH = L.gridH || 24; L.cellSize = L.cellSize || 26;
  L.startTime = L.startTime ?? 6 * 3600;
  for (const k in L.cells) {
    const c = L.cells[k];
    c.ends = (c.ends || []).slice().sort((a, b) => a - b);
    c.sw = c.sw | 0;
    if (c.platform === undefined) c.platform = null;
    if (c.entry === undefined) c.entry = null;
    if (c.vmax === undefined) c.vmax = null;
    if (c.crossing === undefined) c.crossing = null;
    if (c.stump === undefined) c.stump = null;
    if (c.dkw === undefined) c.dkw = false;
  }
  for (const id in L.signals) {
    const s = L.signals[id];
    if (!s.kind) s.kind = 'main';
    if (s.overlap === undefined) s.overlap = null;
    if (s.selfSet === undefined) s.selfSet = false;
    if (s.blocked === undefined) s.blocked = false;
  }
  for (const row of L.timetable) {
    row.stops = (row.stops || []).map(st => ({ ...st, connections: st.connections || [] }));
    if (row.turn === undefined) row.turn = null;
  }
  L.version = 2;
  return L;
}

/* ---------------- Spielstände (laufender Betrieb) ---------------- */
const SAVE_KEY = 'stellwerksim.saves';

export function listSaves() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); }
  catch { return {}; }
}
export function saveGame(name, payload) {
  const all = listSaves();
  all[name] = { ...payload, savedAt: new Date().toISOString() };
  localStorage.setItem(SAVE_KEY, JSON.stringify(all));
}
export function loadGame(name) { return listSaves()[name] || null; }
export function deleteGame(name) {
  const all = listSaves();
  delete all[name];
  localStorage.setItem(SAVE_KEY, JSON.stringify(all));
}
