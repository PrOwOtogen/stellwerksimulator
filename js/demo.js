/* ===================================================================
 * demo.js – Beispielstellwerk „Bahnhof Neustadt"
 * ================================================================= */
import { newLayout, connect, ensureCell, key, nextSignalId } from './model.js';
import { defaultEventConfig } from './events.js';
import { generateTimetable } from './timetable.js';

/** gerade Gleisstrecke zwischen zwei Punkten (achsparallel oder diagonal) */
function line(L, x1, y1, x2, y2) {
  const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  let x = x1, y = y1;
  for (let i = 0; i < steps; i++) {
    const d = dirOf(dx, dy);
    connect(L, x, y, d);
    x += dx; y += dy;
  }
}
function dirOf(dx, dy) {
  return [[5, 4, 3], [6, -1, 2], [7, 0, 1]][dx + 1][dy + 1];
}
function sig(L, name, x, y, dir, kind = 'main') {
  const id = 'sig' + Object.keys(L.signals).length;
  L.signals[id] = { id, name, x, y, dir, kind };
}
function platform(L, name, y, x1, x2) {
  for (let x = x1; x <= x2; x++) {
    const c = L.cells[key(x, y)];
    if (c) c.platform = name;
  }
}

export function demoLayout() {
  const L = newLayout('Bahnhof Neustadt');
  L.gridW = 58; L.gridH = 20; L.cellSize = 26;

  // durchgehendes Hauptgleis (Gleis 3)
  line(L, 1, 9, 54, 9);

  // Bahnsteiggleise 1, 2 und 4
  line(L, 16, 5, 40, 5);
  line(L, 18, 7, 38, 7);
  line(L, 16, 11, 40, 11);

  // westliche Weichenstraße
  line(L, 12, 9, 16, 5);    // Gleis 1
  line(L, 16, 9, 18, 7);    // Gleis 2
  line(L, 14, 9, 16, 11);   // Gleis 4

  // östliche Weichenstraße
  line(L, 40, 5, 44, 9);
  line(L, 38, 7, 40, 9);
  line(L, 40, 11, 42, 9);

  // Abzweig Nord (nach Nordwesten) und Süd (nach Südosten)
  line(L, 8, 9, 3, 4);
  line(L, 3, 4, 3, 1);
  line(L, 48, 9, 52, 13);
  line(L, 52, 13, 52, 16);

  // Ein-/Ausfahrten
  ensureCell(L, 1, 9).entry = 'West';
  ensureCell(L, 54, 9).entry = 'Ost';
  ensureCell(L, 3, 1).entry = 'Nord';
  ensureCell(L, 52, 16).entry = 'Süd';

  // Bahnsteige
  platform(L, 'Gleis 1', 5, 22, 33);
  platform(L, 'Gleis 2', 7, 22, 33);
  platform(L, 'Gleis 3', 9, 22, 33);
  platform(L, 'Gleis 4', 11, 22, 33);

  // Einfahrsignale
  sig(L, 'A', 11, 9, 0);    // aus West
  sig(L, 'F', 45, 9, 4);    // aus Ost
  sig(L, 'N', 5, 6, 1);     // aus Nord
  sig(L, 'S', 51, 12, 5);   // aus Süd

  // Ausfahrsignale der Bahnsteiggleise
  sig(L, 'N1', 35, 5, 0); sig(L, 'P1', 19, 5, 4);
  sig(L, 'N2', 35, 7, 0); sig(L, 'P2', 19, 7, 4);
  sig(L, 'N3', 35, 9, 0); sig(L, 'P3', 19, 9, 4);
  sig(L, 'N4', 35, 11, 0); sig(L, 'P4', 19, 11, 4);

  // Geschwindigkeiten im Bahnhofsbereich
  for (const k in L.cells) {
    const c = L.cells[k];
    if (c.x >= 12 && c.x <= 46 && c.y !== 9) c.vmax = 60;
  }

  L.labels = [
    { x: 24, y: 1, text: 'Bahnhof Neustadt' },
    { x: 24, y: 2, text: 'Gleis 1/2: Fernverkehr · Gleis 3/4: Nahverkehr' }
  ];

  L.startTime = 6 * 3600;
  L.events = defaultEventConfig();
  L.timetable = generateTimetable(L, 14, L.startTime, 4711);
  return L;
}
