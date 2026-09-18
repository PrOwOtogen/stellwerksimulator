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
export function defaultSettings() {
  return {
    flankProtection: true,   // Flankenschutz fordern
    overlapM: 200,           // Durchrutschweg hinter dem Zielsignal
    overlapReleaseSec: 60,   // Auflösung des Durchrutschwegs nach Stillstand
    switchTime: 6,           // Umlaufzeit einer Weiche in Sekunden
    minDwell: 30,            // Mindesthaltezeit
    punctualLimit: 300,      // Grenze für „pünktlich"
    releaseDelaySec: 90,     // Wartezeit bei der Hilfsauflösung
    crossingCloseSec: 25,    // Schließzeit eines Bahnübergangs
    shuntSpeed: 25,          // Rangiergeschwindigkeit
    divergingSpeed: 40,      // Geschwindigkeit über abzweigende Weichen (Hp2)
    substituteSpeed: 40,     // Fahrt auf Ersatzsignal (Zs1)
    showVmax: true, showZN: true, showGrid: false, showKm: false
  };
}

export function newLayout(name = 'Neues Stellwerk') {
  return {
    version: 2,
    name,
    gridW: 64,
    gridH: 26,
    cellSize: 26,
    cells: {},        // "x,y" -> Zelle
    signals: {},      // id -> Signal
    labels: [],       // { x, y, text }
    timetable: [],    // Fahrplanzeilen
    startTime: 6 * 3600,
    settings: defaultSettings(),
    events: null      // Ereigniskonfiguration (siehe events.js)
  };
}

/** Zelle holen/anlegen */
export function cellAt(L, x, y) { return L.cells[key(x, y)]; }
export function ensureCell(L, x, y) {
  const k = key(x, y);
  if (!L.cells[k]) L.cells[k] = {
    x, y, ends: [], platform: null, entry: null, vmax: null, sw: 0,
    dkw: false,        // Doppelkreuzungsweiche
    crossing: null,    // Bahnübergang: { name, mode:'auto'|'manual' }
    stump: null,       // Abstellgleis-Bezeichnung
    km: null           // Streckenkilometer (nur Anzeige)
  };
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
    case 4: return c.dkw ? 'dkw' : 'crossing';   // Doppelkreuzungsweiche / Kreuzung
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

/**
 * Doppelkreuzungsweiche: in Grundstellung (0) verbindet sie die
 * gegenüberliegenden Enden, in Stellung 1 die beiden Stränge über Kreuz.
 */
export function dkwPartner(c, from, state) {
  if (!c.ends.includes(from)) return null;
  if ((state | 0) === 0) return c.ends.includes(opp(from)) ? opp(from) : null;
  let best = null, bestD = Infinity;
  for (const e of c.ends) {
    if (e === from || e === opp(from)) continue;
    const d = dirDist(opp(from), e);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

/** Index des geraden Stranges einer Weiche (der andere lenkt ab) */
export function straightBranch(c) {
  const g = switchGeom(c);
  if (!g) return -1;
  const [b0, b1] = g.branches;
  return dirDist(opp(g.root), b0) <= dirDist(opp(g.root), b1) ? 0 : 1;
}

/** Lenkt eine Fahrt über diese Zelle ab (→ Langsamfahrt/Hp2)? */
export function isDiverging(c, from, to) {
  const t = cellType(c);
  if (t === 'dkw') return (c.sw | 0) === 1;
  if (t !== 'switch') return false;
  const g = switchGeom(c);
  const straight = straightBranch(c);
  const branch = from === g.root ? g.branches.indexOf(to) : g.branches.indexOf(from);
  return branch >= 0 && branch !== straight;
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
  if (t === 'dkw') {
    if (ignoreSwitchState) {
      const a = dkwPartner(c, from, 0), b = dkwPartner(c, from, 1);
      return [a, b].filter(v => v !== null);
    }
    const p = dkwPartner(c, from, c.sw | 0);
    return p === null ? [] : [p];
  }
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
  if (cellType(c) === 'dkw') {
    if (dkwPartner(c, from, 0) === to) return 0;
    if (dkwPartner(c, from, 1) === to) return 1;
    return -1;
  }
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

export const SIGNAL_KINDS = {
  main: 'Hauptsignal',
  combined: 'Haupt- und Vorsignal',
  distant: 'Vorsignal',
  shunt: 'Sperrsignal'
};

export function newSignal(L, x, y, dir, kind = 'main') {
  return {
    id: 'sig' + Date.now().toString(36) + Math.floor(Math.random() * 1e4),
    name: nextSignalId(L, kind), x, y, dir, kind,
    overlap: null,       // eigener Durchrutschweg in m (null = Voreinstellung)
    selfSet: false,      // Selbststellbetrieb
    blocked: false       // vom Fahrdienstleiter gesperrt
  };
}

export function nextSignalId(L, kind) {
  const prefix = kind === 'shunt' ? 'Ra' : kind === 'distant' ? 'Vr' : 'S';
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

/** Alle Bahnübergänge */
export function crossings(L) {
  const map = new Map();
  for (const k in L.cells) {
    const c = L.cells[k];
    if (!c.crossing) continue;
    const name = c.crossing.name;
    if (!map.has(name)) map.set(name, { name, mode: c.crossing.mode || 'auto', cells: [] });
    map.get(name).cells.push(c);
  }
  return [...map.values()];
}

/** Alle Abstellgleis-Bezeichnungen */
export function sidings(L) {
  const s = new Set();
  for (const k in L.cells) if (L.cells[k].stump) s.add(L.cells[k].stump);
  return [...s].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
}

/** Alle Weichen (inkl. DKW) */
export function switches(L) {
  return Object.values(L.cells).filter(c => ['switch', 'dkw'].includes(cellType(c)));
}

/** Gleisplan auf offensichtliche Fehler prüfen */
export function validate(L) {
  const msgs = [];
  let tracks = 0, switchCount = 0;
  for (const k in L.cells) {
    const c = L.cells[k];
    const t = cellType(c);
    if (t === 'invalid') msgs.push(`⚠ Zelle ${k}: ${c.ends.length} Gleisenden – maximal 4 erlaubt.`);
    if (t === 'stump' && !c.entry) msgs.push(`ℹ Zelle ${k}: Stumpfgleis ohne Ein-/Ausfahrt.`);
    if (t === 'switch' || t === 'dkw') switchCount++;
    if (t !== 'empty') tracks++;
  }
  const names = new Map();
  for (const id in L.signals) {
    const s = L.signals[id];
    const c = cellAt(L, s.x, s.y);
    if (!c) { msgs.push(`⚠ Signal ${s.name} steht auf keinem Gleis.`); continue; }
    if (!c.ends.includes(s.dir)) msgs.push(`⚠ Signal ${s.name}: Richtung ${DIR_NAMES[s.dir]} ohne Gleisende.`);
    names.set(s.name, (names.get(s.name) || 0) + 1);
  }
  for (const [n, cnt] of names) if (cnt > 1) msgs.push(`⚠ Signalname „${n}" ist ${cnt}-fach vergeben.`);
  for (const bü of crossings(L)) {
    const hasTrack = bü.cells.some(c => c.ends.length);
    if (!hasTrack) msgs.push(`⚠ Bahnübergang ${bü.name} liegt auf keinem Gleis.`);
  }
  if (entries(L).length < 2) msgs.push('⚠ Mindestens zwei Ein-/Ausfahrten werden für einen Fahrplan benötigt.');
  for (const e of entries(L)) if (e.cell.ends.length !== 1)
    msgs.push(`ℹ Ein-/Ausfahrt ${e.name}: sollte genau ein Gleisende besitzen (hat ${e.cell.ends.length}).`);
  const sigKinds = Object.values(L.signals).reduce((a, s) => { a[s.kind] = (a[s.kind] || 0) + 1; return a; }, {});
  msgs.unshift(`${tracks} Gleiszellen, ${switchCount} Weichen, ${platforms(L).length} Bahnsteige, ${entries(L).length} Ein-/Ausfahrten, ${crossings(L).length} Bahnübergänge.`);
  msgs.splice(1, 0, `Signale: ${Object.entries(sigKinds).map(([k, v]) => `${v}× ${SIGNAL_KINDS[k] || k}`).join(', ') || 'keine'}.`);
  return msgs;
}
