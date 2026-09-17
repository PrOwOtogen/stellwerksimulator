/* ===================================================================
 * model.js – Datenmodell des Stellwerks
 *
 * Der Gleisplan ist ein Raster. Jede Zelle besitzt eine Menge von
 * "Enden" (Richtungen 0..7), in die Gleis führt. Aus der Anzahl der
 * Enden ergibt sich der Elementtyp:
 *   2 Enden  -> durchgehendes Gleis
 *   3 Enden  -> Weiche (ein Wurzelende, zwei Zweige)
 *   4 Enden  -> Kreuzung (nur gegenüberliegende Enden verbunden)
 * ================================================================= */

export const DIRS = [
  { dx: 1, dy: 0 },   // 0 O
  { dx: 1, dy: 1 },   // 1 SO
  { dx: 0, dy: 1 },   // 2 S
  { dx: -1, dy: 1 },  // 3 SW
  { dx: -1, dy: 0 },  // 4 W
  { dx: -1, dy: -1 }, // 5 NW
  { dx: 0, dy: -1 },  // 6 N
  { dx: 1, dy: -1 }   // 7 NO
];
export const DIR_NAMES = ['O', 'SO', 'S', 'SW', 'W', 'NW', 'N', 'NO'];

export const opp = d => (d + 4) % 8;
export const key = (x, y) => x + ',' + y;
export const parseKey = k => { const [x, y] = k.split(',').map(Number); return { x, y }; };
export const neighbor = (x, y, d) => ({ x: x + DIRS[d].dx, y: y + DIRS[d].dy });

/** kleinster Winkelabstand zweier Richtungen in Achteln (0..4) */
export function dirDist(a, b) {
  const d = Math.abs(a - b) % 8;
  return Math.min(d, 8 - d);
}

/** Leeres Stellwerk erzeugen */
export function newLayout(name = 'Neues Stellwerk') {
  return {
    version: 1,
    name,
    gridW: 64,
    gridH: 26,
    cellSize: 26,
    cells: {},        // "x,y" -> Zelle
    signals: {},      // id -> { id, x, y, dir, kind:'main'|'shunt', name }
    labels: [],       // { x, y, text }
    timetable: [],    // Fahrplanzeilen
    startTime: 6 * 3600,
    events: null      // Ereigniskonfiguration (siehe events.js)
  };
}

/** Zelle holen/anlegen */
export function cellAt(L, x, y) { return L.cells[key(x, y)]; }
export function ensureCell(L, x, y) {
  const k = key(x, y);
  if (!L.cells[k]) L.cells[k] = { x, y, ends: [], platform: null, entry: null, vmax: null, sw: 0 };
  return L.cells[k];
}

export function inBounds(L, x, y) { return x >= 0 && y >= 0 && x < L.gridW && y < L.gridH; }

/** Gleisverbindung zwischen zwei benachbarten Zellen herstellen */
export function connect(L, x, y, d) {
  const n = neighbor(x, y, d);
  if (!inBounds(L, x, y) || !inBounds(L, n.x, n.y)) return false;
  const a = ensureCell(L, x, y), b = ensureCell(L, n.x, n.y);
  if (!a.ends.includes(d)) a.ends.push(d);
  if (!b.ends.includes(opp(d))) b.ends.push(opp(d));
  a.ends.sort((p, q) => p - q); b.ends.sort((p, q) => p - q);
  a.sw = 0; b.sw = 0;
  return true;
}

/** Zelle vollständig entfernen (inkl. Gegenenden der Nachbarn) */
export function removeCell(L, x, y) {
  const c = cellAt(L, x, y);
  if (!c) return;
  for (const d of [...c.ends]) {
    const n = neighbor(x, y, d);
    const nc = cellAt(L, n.x, n.y);
    if (nc) {
      nc.ends = nc.ends.filter(e => e !== opp(d));
      nc.sw = 0;
      if (nc.ends.length === 0 && !nc.platform && !nc.entry) delete L.cells[key(n.x, n.y)];
    }
  }
  delete L.cells[key(x, y)];
  for (const id of Object.keys(L.signals)) {
    const s = L.signals[id];
    if (s.x === x && s.y === y) delete L.signals[id];
  }
}

/** Typ einer Zelle aus der Anzahl der Enden ableiten */
export function cellType(c) {
  if (!c) return 'none';
  switch (c.ends.length) {
    case 0: return 'empty';
    case 1: return 'stump';      // Stumpfende / Ein-Ausfahrt
    case 2: return 'track';
    case 3: return 'switch';     // Weiche
    case 4: return 'crossing';   // Kreuzung
    default: return 'invalid';
  }
}

/**
 * Weichengeometrie: liefert { root, branches:[b0,b1] }.
 * Die beiden Enden mit dem kleinsten Winkelabstand sind die Zweige,
 * das verbleibende Ende ist die Wurzel (Spitze der Weiche).
 */
export function switchGeom(c) {
  if (c.ends.length !== 3) return null;
  const [a, b, d] = c.ends;
  const pairs = [[a, b, d], [a, d, b], [b, d, a]];
  pairs.sort((p, q) => dirDist(p[0], p[1]) - dirDist(q[0], q[1]));
  const [b0, b1, root] = pairs[0];
  return { root, branches: [b0, b1] };
}

/** Zweigindex (0/1) einer Richtung an einer Weiche */
export function branchIndex(c, dir) {
  const g = switchGeom(c);
  if (!g) return -1;
  return g.branches.indexOf(dir);
}

/**
 * Von welchem Ende kann man – bei aktueller Weichenstellung – wohin?
 * `from` ist das Ende, durch das der Zug die Zelle betritt.
 * Liefert Array möglicher Ausfahrt-Enden.
 */
export function exitsFrom(c, from, ignoreSwitchState = false) {
  if (!c || !c.ends.includes(from)) return [];
  const t = cellType(c);
  if (t === 'track') return c.ends.filter(e => e !== from);
  if (t === 'stump') return [];
  if (t === 'crossing') return c.ends.includes(opp(from)) ? [opp(from)] : [];
  if (t === 'switch') {
    const g = switchGeom(c);
    if (from === g.root) {
      return ignoreSwitchState ? [...g.branches] : [g.branches[c.sw | 0]];
    }
    const bi = g.branches.indexOf(from);
    if (bi < 0) return [];
    if (!ignoreSwitchState && (c.sw | 0) !== bi) return []; // auffahren verhindern
    return [g.root];
  }
  return [];
}

/** Welche Weichenstellung ist nötig, um from->to zu fahren? (-1 = egal) */
export function requiredSwitchState(c, from, to) {
  if (cellType(c) !== 'switch') return -1;
  const g = switchGeom(c);
  if (from === g.root) return g.branches.indexOf(to);
  return g.branches.indexOf(from);
}

/** Signal an Zelle/Richtung finden */
export function signalAt(L, x, y, dir) {
  for (const id in L.signals) {
    const s = L.signals[id];
    if (s.x === x && s.y === y && s.dir === dir) return s;
  }
  return null;
}
export function signalsOfCell(L, x, y) {
  return Object.values(L.signals).filter(s => s.x === x && s.y === y);
}

export function nextSignalId(L, kind) {
  const prefix = kind === 'shunt' ? 'Sp' : 'S';
  let n = 1;
  const used = new Set(Object.values(L.signals).map(s => s.name));
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

/** Alle Ein-/Ausfahrten */
export function entries(L) {
  return Object.values(L.cells).filter(c => c.entry).map(c => ({ name: c.entry, x: c.x, y: c.y, cell: c }));
}
export function entryByName(L, name) {
  return entries(L).find(e => e.name === name) || null;
}
/** Alle Bahnsteignamen */
export function platforms(L) {
  const s = new Set();
  for (const k in L.cells) if (L.cells[k].platform) s.add(L.cells[k].platform);
  return [...s].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
}
export function platformCells(L, name) {
  return Object.values(L.cells).filter(c => c.platform === name);
}

/** Gleisplan auf offensichtliche Fehler prüfen */
export function validate(L) {
  const msgs = [];
  let tracks = 0, switches = 0;
  for (const k in L.cells) {
    const c = L.cells[k];
    const t = cellType(c);
    if (t === 'invalid') msgs.push(`⚠ Zelle ${k}: ${c.ends.length} Gleisenden – maximal 4 erlaubt.`);
    if (t === 'stump' && !c.entry) msgs.push(`ℹ Zelle ${k}: Stumpfgleis ohne Ein-/Ausfahrt.`);
    if (t === 'switch') switches++;
    if (t !== 'empty') tracks++;
  }
  for (const id in L.signals) {
    const s = L.signals[id];
    const c = cellAt(L, s.x, s.y);
    if (!c) { msgs.push(`⚠ Signal ${s.name} steht auf keinem Gleis.`); continue; }
    if (!c.ends.includes(s.dir)) msgs.push(`⚠ Signal ${s.name}: Richtung ${DIR_NAMES[s.dir]} ohne Gleisende.`);
  }
  if (entries(L).length < 2) msgs.push('⚠ Mindestens zwei Ein-/Ausfahrten werden für einen Fahrplan benötigt.');
  for (const e of entries(L)) if (e.cell.ends.length !== 1)
    msgs.push(`ℹ Ein-/Ausfahrt ${e.name}: sollte genau ein Gleisende besitzen (hat ${e.cell.ends.length}).`);
  msgs.unshift(`${tracks} Gleiszellen, ${switches} Weichen, ${Object.keys(L.signals).length} Signale, ${entries(L).length} Ein-/Ausfahrten, ${platforms(L).length} Bahnsteige.`);
  return msgs;
}
