/* ===================================================================
 * editor.js – Gleisplan zeichnen und Elemente setzen
 * ================================================================= */
import {
  DIRS, DIR_NAMES, key, parseKey, cellAt, ensureCell, connect, removeCell,
  inBounds, cellType, signalsOfCell, nextSignalId, platforms, sidings, newSignal,
  SIGNAL_KINDS, switchGeom, opp
} from './model.js';
import { clearReachCache } from './interlocking.js';
import { cellSizeOf } from './render.js';

export const TOOL_HELP = {
  track: 'Ziehen: Gleis zeichnen. Drei Gleisenden in einer Zelle ergeben eine Weiche, vier eine Kreuzung.',
  erase: 'Klicken oder ziehen: Gleiszelle samt Signalen entfernen.',
  signal: 'Klick nahe einem Gleisende setzt ein Hauptsignal; erneuter Klick entfernt es. Mit gedrückter Umschalttaste öffnen sich die Eigenschaften.',
  distant: 'Vorsignal setzen – zeigt den Begriff des nächsten Hauptsignals in Fahrtrichtung an.',
  shunt: 'Sperrsignal für Rangierfahrten setzen.',
  platform: 'Ziehen über Gleiszellen: Bahnsteig zuordnen (Umschalt = entfernen).',
  siding: 'Ziehen über Gleiszellen: Abstell-/Ladegleis kennzeichnen (Umschalt = entfernen).',
  entry: 'Klick auf ein Streckenende: Ein-/Ausfahrt anlegen oder entfernen.',
  crossing: 'Klick auf eine Gleiszelle: Bahnübergang anlegen (automatisch oder handbedient).',
  dkw: 'Klick auf eine Kreuzung mit vier Gleisenden: in eine Doppelkreuzungsweiche umwandeln und zurück.',
  speed: 'Klick oder Ziehen: zulässige Geschwindigkeit setzen (leer = keine Beschränkung).',
  label: 'Klick: Beschriftung setzen (leerer Text löscht sie).',
  select: 'Elemente ansehen und bearbeiten: Klick auf Signal, Weiche, Bahnsteig oder Bahnübergang.'
};

/** vorgefertigte Gleisbausteine */
export const TEMPLATES = {
  'Gleisverbindung rechts': L => [
    { type: 'line', pts: [[0, 0], [6, 0]] },
    { type: 'line', pts: [[0, 2], [6, 2]] },
    { type: 'line', pts: [[2, 2], [4, 0]] }
  ],
  'Gleisverbindung links': L => [
    { type: 'line', pts: [[0, 0], [6, 0]] },
    { type: 'line', pts: [[0, 2], [6, 2]] },
    { type: 'line', pts: [[2, 0], [4, 2]] }
  ],
  'Doppelte Gleisverbindung': L => [
    { type: 'line', pts: [[0, 0], [8, 0]] },
    { type: 'line', pts: [[0, 2], [8, 2]] },
    { type: 'line', pts: [[2, 0], [4, 2]] },
    { type: 'line', pts: [[6, 0], [4, 2]] }
  ],
  'Bahnsteiggleis (8 Zellen)': L => [
    { type: 'line', pts: [[0, 0], [8, 0]] },
    { type: 'platform', from: [1, 0], to: [7, 0] }
  ],
  'Überholgleis': L => [
    { type: 'line', pts: [[0, 0], [14, 0]] },
    { type: 'line', pts: [[2, 0], [4, 2]] },
    { type: 'line', pts: [[4, 2], [10, 2]] },
    { type: 'line', pts: [[10, 2], [12, 0]] }
  ],
  'Stumpfgleis mit Sperrsignal': L => [
    { type: 'line', pts: [[0, 0], [6, 0]] },
    { type: 'siding', from: [2, 0], to: [6, 0] },
    { type: 'signal', at: [2, 0], dir: 4, kind: 'shunt' }
  ]
};

export class Editor {
  constructor(canvas, getLayout, onChange, hooks = {}) {
    this.canvas = canvas;
    this.getLayout = getLayout;
    this.onChange = onChange;
    this.hooks = hooks;               // { properties(obj), pickCrossing(), toast(msg) }
    this.tool = 'track';
    this.zoom = 1;
    this.hover = null;
    this.drag = null;
    this.platformName = null;
    this.sidingName = null;
    this.speedValue = undefined;
    this.selected = null;
    this.undoStack = [];
    this.redoStack = [];

    canvas.addEventListener('mousedown', e => this.onDown(e));
    canvas.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('mouseup', () => {
      this.drag = null; this.platformName = null; this.sidingName = null; this.speedValue = undefined;
    });
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.onRight(e); });
  }

  /* ---------- Rückgängig / Wiederholen ---------- */
  snapshot() {
    const L = this.getLayout();
    this.undoStack.push(JSON.stringify({ cells: L.cells, signals: L.signals, labels: L.labels }));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  undo() { this.step(this.undoStack, this.redoStack); }
  redo() { this.step(this.redoStack, this.undoStack); }
  step(from, to) {
    if (!from.length) return false;
    const L = this.getLayout();
    to.push(JSON.stringify({ cells: L.cells, signals: L.signals, labels: L.labels }));
    const data = JSON.parse(from.pop());
    L.cells = data.cells; L.signals = data.signals; L.labels = data.labels;
    clearReachCache(L);
    this.onChange(true);
    return true;
  }

  cellFromEvent(e) {
    const L = this.getLayout();
    const r = this.canvas.getBoundingClientRect();
    const cs = cellSizeOf(L, this.zoom);
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return { x: Math.floor(px / cs), y: Math.floor(py / cs), fx: (px % cs) / cs, fy: (py % cs) / cs };
  }

  nearestEnd(c, fx, fy) {
    const vx = fx - 0.5, vy = fy - 0.5;
    let best = null, bestD = Infinity;
    for (const d of c.ends) {
      const dist = Math.hypot(vx - DIRS[d].dx / 2, vy - DIRS[d].dy / 2);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  onDown(e) {
    const L = this.getLayout();
    const p = this.cellFromEvent(e);
    if (!inBounds(L, p.x, p.y)) return;
    this.snapshot();
    this.drag = { last: p, shift: e.shiftKey, alt: e.altKey };
    this.apply(p, e, true);
  }

  onMove(e) {
    const L = this.getLayout();
    const p = this.cellFromEvent(e);
    this.hover = inBounds(L, p.x, p.y) ? p : null;
    if (!this.drag) { this.onChange(false); return; }
    if (p.x === this.drag.last.x && p.y === this.drag.last.y) return;
    for (const step of cellPath(this.drag.last, p)) {
      if (!inBounds(L, step.x, step.y)) continue;
      this.apply({ ...step, fx: p.fx, fy: p.fy }, e, false);
      this.drag.last = step;
    }
  }

  onRight(e) {
    const p = this.cellFromEvent(e);
    const L = this.getLayout();
    const obj = this.objectAt(p);
    if (obj && this.hooks.properties) this.hooks.properties(obj);
  }

  /** Objekt unter dem Mauszeiger bestimmen (Signal vor Zelle) */
  objectAt(p) {
    const L = this.getLayout();
    const c = cellAt(L, p.x, p.y);
    if (!c) return null;
    const sigs = signalsOfCell(L, p.x, p.y);
    if (sigs.length) {
      const d = this.nearestEnd(c, p.fx, p.fy);
      const hit = sigs.find(s => s.dir === d) || sigs[0];
      return { type: 'signal', signal: hit };
    }
    return { type: 'cell', cell: c };
  }

  apply(p, e, isFirst) {
    const L = this.getLayout();
    switch (this.tool) {
      case 'track': {
        if (!isFirst) {
          const prev = this.drag.last;
          const dx = p.x - prev.x, dy = p.y - prev.y;
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx || dy)) {
            const d = DIRS.findIndex(o => o.dx === dx && o.dy === dy);
            if (d >= 0) connect(L, prev.x, prev.y, d);
          }
        } else ensureCell(L, p.x, p.y);
        break;
      }
      case 'erase': removeCell(L, p.x, p.y); break;
      case 'signal': case 'shunt': case 'distant': {
        if (!isFirst) break;
        const c = cellAt(L, p.x, p.y);
        if (!c || !c.ends.length) break;
        const d = this.nearestEnd(c, p.fx, p.fy);
        const existing = signalsOfCell(L, p.x, p.y).find(s => s.dir === d);
        if (existing && e.shiftKey) { this.hooks.properties?.({ type: 'signal', signal: existing }); break; }
        if (existing) { delete L.signals[existing.id]; this.selected = null; break; }
        const kind = this.tool === 'shunt' ? 'shunt' : this.tool === 'distant' ? 'distant' : 'main';
        const s = newSignal(L, p.x, p.y, d, kind);
        L.signals[s.id] = s;
        this.selected = { type: 'signal', signal: s };
        if (e.shiftKey) this.hooks.properties?.(this.selected);
        break;
      }
      case 'platform': case 'siding': {
        const c = cellAt(L, p.x, p.y);
        if (!c || !c.ends.length) break;
        const field = this.tool === 'platform' ? 'platform' : 'stump';
        if (this.drag.shift) { c[field] = null; break; }
        const store = this.tool === 'platform' ? 'platformName' : 'sidingName';
        if (!this[store]) {
          const suggestion = c[field] || (this.tool === 'platform' ? nextPlatformName(L) : nextSidingName(L));
          const name = window.prompt(this.tool === 'platform' ? 'Name des Bahnsteiggleises:' : 'Name des Abstellgleises:', suggestion);
          if (!name) { this.drag = null; break; }
          this[store] = name;
        }
        c[field] = this[store];
        break;
      }
      case 'entry': {
        if (!isFirst) break;
        const c = cellAt(L, p.x, p.y);
        if (!c || !c.ends.length) break;
        if (c.entry) {
          if (window.confirm(`Ein-/Ausfahrt „${c.entry}" entfernen?`)) c.entry = null;
        } else {
          const name = window.prompt('Bezeichnung der Ein-/Ausfahrt:', 'Strecke ' + (countEntries(L) + 1));
          if (name) c.entry = name;
        }
        break;
      }
      case 'crossing': {
        if (!isFirst) break;
        const c = cellAt(L, p.x, p.y);
        if (!c || !c.ends.length) break;
        if (c.crossing) { c.crossing = null; break; }
        const name = window.prompt('Name des Bahnübergangs:', 'BÜ ' + (p.x + ',' + p.y));
        if (!name) break;
        const manual = window.confirm('Handbedienter Bahnübergang?\nOK = handbedient, Abbrechen = automatisch');
        c.crossing = { name, mode: manual ? 'manual' : 'auto' };
        break;
      }
      case 'dkw': {
        if (!isFirst) break;
        const c = cellAt(L, p.x, p.y);
        if (!c) break;
        if (c.ends.length !== 4) { this.hooks.toast?.('Eine Doppelkreuzungsweiche braucht genau vier Gleisenden.'); break; }
        c.dkw = !c.dkw; c.sw = 0;
        break;
      }
      case 'speed': {
        const c = cellAt(L, p.x, p.y);
        if (!c || !c.ends.length) break;
        if (this.speedValue === undefined) {
          const v = window.prompt('Zulässige Geschwindigkeit in km/h (leer = keine Beschränkung):', c.vmax || '');
          if (v === null) { this.drag = null; break; }
          this.speedValue = v.trim() === '' ? null : Math.max(5, parseInt(v, 10) || 0) || null;
        }
        c.vmax = this.speedValue;
        break;
      }
      case 'label': {
        if (!isFirst) break;
        const existing = (L.labels || []).find(l => l.x === p.x && l.y === p.y);
        const text = window.prompt('Beschriftung:', existing ? existing.text : '');
        if (text === null) break;
        L.labels = (L.labels || []).filter(l => !(l.x === p.x && l.y === p.y));
        if (text.trim()) L.labels.push({ x: p.x, y: p.y, text: text.trim() });
        break;
      }
      case 'select': {
        if (!isFirst) break;
        const obj = this.objectAt(p);
        this.selected = obj;
        if (obj) this.hooks.properties?.(obj);
        break;
      }
    }
    clearReachCache(L);
    this.onChange(true);
  }

  /** Baustein an einer Position einfügen */
  insertTemplate(name, x, y) {
    const L = this.getLayout();
    const parts = TEMPLATES[name]?.(L);
    if (!parts) return false;
    this.snapshot();
    for (const part of parts) {
      if (part.type === 'line') {
        const [[x1, y1], [x2, y2]] = part.pts;
        drawLine(L, x + x1, y + y1, x + x2, y + y2);
      } else if (part.type === 'platform' || part.type === 'siding') {
        const field = part.type === 'platform' ? 'platform' : 'stump';
        const nm = part.type === 'platform' ? nextPlatformName(L) : nextSidingName(L);
        for (let i = part.from[0]; i <= part.to[0]; i++) {
          const c = cellAt(L, x + i, y + part.from[1]);
          if (c) c[field] = nm;
        }
      } else if (part.type === 'signal') {
        const c = cellAt(L, x + part.at[0], y + part.at[1]);
        if (c) {
          const s = newSignal(L, c.x, c.y, part.dir, part.kind);
          L.signals[s.id] = s;
        }
      }
    }
    clearReachCache(L);
    this.onChange(true);
    return true;
  }

  describe() {
    const L = this.getLayout();
    if (!this.hover) return 'Mauszeiger über den Gleisplan bewegen.';
    const c = cellAt(L, this.hover.x, this.hover.y);
    if (!c) return `Zelle ${this.hover.x},${this.hover.y}: leer`;
    const parts = [`<b>Zelle ${c.x},${c.y}</b>`, `Typ: ${typeName(cellType(c))}`,
      `Enden: ${c.ends.map(d => DIR_NAMES[d]).join(', ') || '–'}`];
    if (cellType(c) === 'switch') {
      const g = switchGeom(c);
      parts.push(`Weiche: Wurzel ${DIR_NAMES[g.root]}, Lage ${DIR_NAMES[g.branches[c.sw | 0]]}`);
    }
    if (cellType(c) === 'dkw') parts.push(`DKW-Stellung: ${(c.sw | 0) === 0 ? 'gerade' : 'über Kreuz'}`);
    if (c.platform) parts.push(`Bahnsteig: ${c.platform}`);
    if (c.stump) parts.push(`Abstellgleis: ${c.stump}`);
    if (c.entry) parts.push(`Ein-/Ausfahrt: ${c.entry}`);
    if (c.crossing) parts.push(`Bahnübergang: ${c.crossing.name} (${c.crossing.mode === 'manual' ? 'handbedient' : 'automatisch'})`);
    if (c.vmax) parts.push(`Vmax: ${c.vmax} km/h`);
    const sigs = signalsOfCell(L, c.x, c.y);
    if (sigs.length) parts.push('Signale: ' + sigs.map(s =>
      `${s.name} (${SIGNAL_KINDS[s.kind]}, ${DIR_NAMES[s.dir]})`).join(', '));
    return parts.join('<br>');
  }
}

function drawLine(L, x1, y1, x2, y2) {
  const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  let x = x1, y = y1;
  for (let i = 0; i < steps; i++) {
    const d = DIRS.findIndex(o => o.dx === dx && o.dy === dy);
    if (d >= 0) connect(L, x, y, d);
    x += dx; y += dy;
  }
}

function cellPath(from, to) {
  const out = [];
  let x = from.x, y = from.y, guard = 0;
  while ((x !== to.x || y !== to.y) && guard++ < 500) {
    x += Math.sign(to.x - x);
    y += Math.sign(to.y - y);
    out.push({ x, y });
  }
  return out;
}

function typeName(t) {
  return {
    none: 'leer', empty: 'leer', stump: 'Streckenende', track: 'Gleis',
    switch: 'Weiche', crossing: 'Kreuzung', dkw: 'Doppelkreuzungsweiche', invalid: 'ungültig'
  }[t] || t;
}
function nextPlatformName(L) {
  const used = platforms(L);
  let n = 1;
  while (used.includes('Gleis ' + n)) n++;
  return 'Gleis ' + n;
}
function nextSidingName(L) {
  const used = sidings(L);
  let n = 1;
  while (used.includes('Abstellgleis ' + n)) n++;
  return 'Abstellgleis ' + n;
}
function countEntries(L) {
  return Object.values(L.cells).filter(c => c.entry).length;
}
