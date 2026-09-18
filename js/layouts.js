/* ===================================================================
 * layouts.js – weitere Beispielstellwerke als Vorlagen
 * ================================================================= */
import { newLayout, connect, ensureCell, key, defaultSettings } from './model.js';
import { defaultEventConfig } from './events.js';
import { generateTakt, generateTimetable } from './timetable.js';
import { demoLayout } from './demo.js';

export function line(L, x1, y1, x2, y2) {
  const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  let x = x1, y = y1;
  for (let i = 0; i < steps; i++) {
    connect(L, x, y, dirOf(dx, dy));
    x += dx; y += dy;
  }
}
const dirOf = (dx, dy) => [[5, 4, 3], [6, -1, 2], [7, 0, 1]][dx + 1][dy + 1];

function sig(L, name, x, y, dir, kind = 'main') {
  const id = 'sig' + Object.keys(L.signals).length;
  L.signals[id] = { id, name, x, y, dir, kind, overlap: null, selfSet: false, blocked: false };
}
function platform(L, name, y, x1, x2) {
  for (let x = x1; x <= x2; x++) if (L.cells[key(x, y)]) L.cells[key(x, y)].platform = name;
}

/* -------------------------------------------------------------
 * Eingleisiger Kreuzungsbahnhof – Züge müssen sich hier kreuzen
 * ----------------------------------------------------------- */
export function kreuzungsbahnhof() {
  const L = newLayout('Kreuzungsbahnhof Waldheim');
  L.gridW = 46; L.gridH = 14; L.cellSize = 26;
  L.settings = defaultSettings();

  line(L, 1, 8, 44, 8);              // durchgehendes Gleis 1
  line(L, 12, 8, 14, 6);             // Ausweichgleis 2
  line(L, 14, 6, 30, 6);
  line(L, 30, 6, 32, 8);

  ensureCell(L, 1, 8).entry = 'Westheim';
  ensureCell(L, 44, 8).entry = 'Ostheim';
  platform(L, 'Gleis 1', 8, 17, 27);
  platform(L, 'Gleis 2', 6, 17, 27);
  L.cells[key(6, 8)].crossing = { name: 'BÜ Mühlweg', mode: 'auto' };

  sig(L, 'A', 10, 8, 0);             // Einfahrsignale
  sig(L, 'F', 34, 8, 4);
  sig(L, 'Vr A', 5, 8, 0, 'distant');
  sig(L, 'Vr F', 39, 8, 4, 'distant');
  sig(L, 'N1', 28, 8, 0, 'combined'); sig(L, 'P1', 16, 8, 4, 'combined');
  sig(L, 'N2', 28, 6, 0, 'combined'); sig(L, 'P2', 16, 6, 4, 'combined');

  for (const k in L.cells) {
    const c = L.cells[k];
    if (c.y === 6) c.vmax = 50;                       // Ausweichgleis abzweigend
    if (c.x >= 12 && c.x <= 32 && c.y === 8) c.vmax = 90;
  }
  L.labels = [{ x: 16, y: 2, text: 'Kreuzungsbahnhof Waldheim' },
  { x: 16, y: 3, text: 'eingleisige Strecke – Kreuzungen planen!' }];
  L.startTime = 7 * 3600;
  L.events = defaultEventConfig();
  L.events.ratePerHour = 1.5;        // kleine Anlage: weniger Störungen
  L.timetable = [
    ...generateTakt(L, { gattung: 'RB', from: 'Westheim', to: 'Ostheim', platform: 'Gleis 1', firstDep: 7 * 3600, everyMin: 60, count: 5, nrStart: 3010, travelSec: 200 }),
    ...generateTakt(L, { gattung: 'RB', from: 'Ostheim', to: 'Westheim', platform: 'Gleis 2', firstDep: 7 * 3600 + 900, everyMin: 60, count: 5, nrStart: 3011, travelSec: 200 }),
    ...generateTimetable(L, 5, 7 * 3600 + 1200, 2024, { spreadSec: 1200 })
  ].sort((a, b) => a.entryTime - b.entryTime);
  return L;
}

/* -------------------------------------------------------------
 * Kopfbahnhof – alle Züge wenden
 * ----------------------------------------------------------- */
export function kopfbahnhof() {
  const L = newLayout('Kopfbahnhof Seestadt');
  L.gridW = 44; L.gridH = 18; L.cellSize = 26;
  L.settings = defaultSettings();

  line(L, 1, 12, 16, 12);            // Zulauf
  line(L, 12, 12, 14, 10);           // Weichenfächer
  line(L, 14, 10, 16, 8);
  line(L, 16, 8, 18, 6);
  line(L, 16, 12, 38, 12);           // Gleis 4
  line(L, 14, 10, 38, 10);           // Gleis 3
  line(L, 16, 8, 38, 8);             // Gleis 2
  line(L, 18, 6, 38, 6);             // Gleis 1
  line(L, 6, 12, 2, 16);             // Hafenbahn zweigt Richtung Bahnhof ab
  line(L, 2, 16, 1, 16);

  ensureCell(L, 1, 12).entry = 'Hauptstrecke';
  ensureCell(L, 1, 16).entry = 'Hafenbahn';
  for (let g = 1; g <= 4; g++) platform(L, 'Gleis ' + g, [6, 8, 10, 12][g - 1], 24, 38);

  sig(L, 'A', 10, 12, 0);
  sig(L, 'Vr A', 6, 12, 0, 'distant');
  sig(L, 'P1', 22, 6, 4, 'combined'); sig(L, 'P2', 22, 8, 4, 'combined');
  sig(L, 'P3', 22, 10, 4, 'combined'); sig(L, 'P4', 22, 12, 4, 'combined');
  sig(L, 'Ra1', 23, 6, 0, 'shunt'); sig(L, 'Ra2', 23, 8, 0, 'shunt');

  for (const k in L.cells) {
    const c = L.cells[k];
    if (c.x >= 10 && c.x <= 24) c.vmax = 50;
    if (c.x > 24) c.vmax = 30;                        // Bahnsteigbereich Kopfgleise
  }
  L.labels = [{ x: 26, y: 2, text: 'Kopfbahnhof Seestadt' },
  { x: 26, y: 3, text: 'Alle Züge wenden – Gleise rechtzeitig räumen!' },
  { x: 30, y: 15, text: 'Prellböcke am Gleisende' }];
  L.startTime = 8 * 3600;
  L.events = defaultEventConfig();
  L.events.ratePerHour = 2;
  // Kopfbahnhof mit eingleisiger Zufahrt: Fahrplan bewusst entzerrt
  L.timetable = generateTimetable(L, 10, 8 * 3600, 777, { spreadSec: 1500 });
  return L;
}

/* -------------------------------------------------------------
 * Vorlagenverzeichnis
 * ----------------------------------------------------------- */
export const LAYOUT_TEMPLATES = {
  'Bahnhof Neustadt (Durchgangsbahnhof)': demoLayout,
  'Kreuzungsbahnhof Waldheim (eingleisig)': kreuzungsbahnhof,
  'Kopfbahnhof Seestadt (Wendebetrieb)': kopfbahnhof,
  'Leeres Stellwerk': () => {
    const L = newLayout('Mein Stellwerk');
    L.settings = defaultSettings();
    L.events = defaultEventConfig();
    return L;
  }
};
