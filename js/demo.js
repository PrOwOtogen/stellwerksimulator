/* ===================================================================
 * demo.js – Beispielstellwerk „Bahnhof Neustadt"
 *
 * Durchgangsbahnhof mit vier Bahnsteiggleisen, vier Streckenästen,
 * Abstellgleis, zwei Bahnübergängen, Vor- und Sperrsignalen.
 * ================================================================= */
import { newLayout, connect, ensureCell, key, defaultSettings } from './model.js';
import { defaultEventConfig } from './events.js';
import { generateTimetable, generateTakt } from './timetable.js';

function line(L, x1, y1, x2, y2) {
  const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  let x = x1, y = y1;
  for (let i = 0; i < steps; i++) {
    connect(L, x, y, dirOf(dx, dy));
    x += dx; y += dy;
  }
}
const dirOf = (dx, dy) => [[5, 4, 3], [6, -1, 2], [7, 0, 1]][dx + 1][dy + 1];

function sig(L, name, x, y, dir, kind = 'main', extra = {}) {
  const id = 'sig' + Object.keys(L.signals).length;
  L.signals[id] = { id, name, x, y, dir, kind, overlap: null, selfSet: false, blocked: false, ...extra };
  return L.signals[id];
}
function platform(L, name, y, x1, x2) {
  for (let x = x1; x <= x2; x++) if (L.cells[key(x, y)]) L.cells[key(x, y)].platform = name;
}
function siding(L, name, y, x1, x2) {
  for (let x = x1; x <= x2; x++) if (L.cells[key(x, y)]) L.cells[key(x, y)].stump = name;
}
function crossing(L, name, x, y, mode = 'auto') {
  const c = L.cells[key(x, y)];
  if (c) c.crossing = { name, mode };
}

export function demoLayout() {
  const L = newLayout('Bahnhof Neustadt');
  L.gridW = 58; L.gridH = 20; L.cellSize = 26;
  L.settings = defaultSettings();

  /* --- Gleise --- */
  line(L, 1, 9, 54, 9);            // durchgehendes Hauptgleis (Gleis 3)
  line(L, 16, 5, 40, 5);           // Gleis 1
  line(L, 18, 7, 38, 7);           // Gleis 2
  line(L, 16, 11, 40, 11);         // Gleis 4

  line(L, 12, 9, 16, 5);           // Weichenstraße West
  line(L, 16, 9, 18, 7);
  line(L, 14, 9, 16, 11);

  line(L, 40, 5, 44, 9);           // Weichenstraße Ost
  line(L, 38, 7, 40, 9);
  line(L, 40, 11, 42, 9);

  line(L, 8, 9, 3, 4);             // Abzweig Nord
  line(L, 3, 4, 3, 1);
  line(L, 48, 9, 52, 13);          // Abzweig Süd
  line(L, 52, 13, 52, 16);

  line(L, 37, 11, 39, 13);         // Abstellgleis (Stumpfgleis)
  line(L, 39, 13, 45, 13);

  /* --- Betriebsstellen --- */
  ensureCell(L, 1, 9).entry = 'West';
  ensureCell(L, 54, 9).entry = 'Ost';
  ensureCell(L, 3, 1).entry = 'Nord';
  ensureCell(L, 52, 16).entry = 'Süd';

  platform(L, 'Gleis 1', 5, 22, 33);
  platform(L, 'Gleis 2', 7, 22, 33);
  platform(L, 'Gleis 3', 9, 22, 33);
  platform(L, 'Gleis 4', 11, 22, 33);
  siding(L, 'Abstellgruppe', 13, 40, 45);

  crossing(L, 'BÜ Lindenstraße', 6, 9, 'auto');
  crossing(L, 'BÜ Feldweg', 50, 9, 'manual');

  /* --- Signale --- */
  sig(L, 'A', 11, 9, 0);                       // Einfahrsignal aus West
  sig(L, 'F', 45, 9, 4);                       // Einfahrsignal aus Ost
  sig(L, 'N', 5, 6, 1);                        // Einfahrsignal aus Nord
  sig(L, 'S', 51, 12, 5);                      // Einfahrsignal aus Süd
  sig(L, 'Vr A', 4, 9, 0, 'distant');          // Vorsignale
  sig(L, 'Vr F', 49, 9, 4, 'distant');
  sig(L, 'Vr N', 3, 3, 2, 'distant');
  sig(L, 'Vr S', 52, 15, 6, 'distant');

  sig(L, 'N1', 35, 5, 0, 'combined'); sig(L, 'P1', 19, 5, 4, 'combined');
  sig(L, 'N2', 35, 7, 0, 'combined'); sig(L, 'P2', 19, 7, 4, 'combined');
  sig(L, 'N3', 35, 9, 0, 'combined'); sig(L, 'P3', 19, 9, 4, 'combined');
  sig(L, 'N4', 35, 11, 0, 'combined'); sig(L, 'P4', 19, 11, 4, 'combined');

  sig(L, 'Ra1', 36, 11, 0, 'shunt');           // Rangieren Richtung Abstellgruppe
  sig(L, 'Ra2', 41, 13, 4, 'shunt');           // aus der Abstellgruppe zurück
  sig(L, 'Ra3', 40, 13, 0, 'shunt');

  /* --- Geschwindigkeiten --- */
  for (const k in L.cells) {
    const c = L.cells[k];
    if (c.x >= 12 && c.x <= 46 && c.y !== 9) c.vmax = 60;
    if (c.y === 13) c.vmax = 25;
    if (c.y === 9 && c.x > 46) c.vmax = 100;
  }

  L.labels = [
    { x: 23, y: 1, text: 'Bahnhof Neustadt' },
    { x: 23, y: 2, text: 'Gleis 1/2 Fernverkehr · Gleis 3/4 Nahverkehr' },
    { x: 41, y: 14, text: 'Abstellgruppe' }
  ];

  L.startTime = 6 * 3600;
  L.events = defaultEventConfig();

  /* --- Fahrplan: Takt-Linien plus Zufallsverkehr --- */
  const takt = [
    ...generateTakt(L, { gattung: 'RE', from: 'West', to: 'Ost', platform: 'Gleis 1', firstDep: 6 * 3600 + 180, everyMin: 60, count: 5, nrStart: 4010, travelSec: 300 }),
    ...generateTakt(L, { gattung: 'RE', from: 'Ost', to: 'West', platform: 'Gleis 2', firstDep: 6 * 3600 + 900, everyMin: 60, count: 5, nrStart: 4011, travelSec: 300 }),
    ...generateTakt(L, { gattung: 'RB', from: 'Nord', to: 'Süd', platform: 'Gleis 3', firstDep: 6 * 3600 + 600, everyMin: 60, count: 4, nrStart: 8010, travelSec: 360 }),
    ...generateTakt(L, { gattung: 'S', from: 'West', to: 'Ost', platform: 'Gleis 4', firstDep: 6 * 3600 + 1500, everyMin: 30, count: 6, nrStart: 2010, travelSec: 300 })
  ];
  const zufall = generateTimetable(L, 8, 6 * 3600 + 1800, 4711, { spreadSec: 900 });
  L.timetable = [...takt, ...zufall].sort((a, b) => a.entryTime - b.entryTime);

  // ein Anschluss und eine Wende als Beispiel
  const reOst = L.timetable.find(r => r.entry === 'Ost' && r.stops.length);
  const rbNord = L.timetable.find(r => r.entry === 'Nord' && r.stops.length);
  if (reOst && rbNord) {
    rbNord.stops[0].connections = [{ from: reOst.nr, maxWait: 480 }];
  }
  const sBahn = L.timetable.find(r => r.gattung === 'S' && r.stops.length);
  if (sBahn) sBahn.turn = { nr: 'S 2099', gattung: 'S', exit: 'West', dep: sBahn.stops[0].dep + 600, wende: 300, stops: [] };

  return L;
}
