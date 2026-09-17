/* ===================================================================
 * editor.js – Gleisplan zeichnen und Elemente setzen
 * ================================================================= */
import {
  DIRS, DIR_NAMES, key, parseKey, cellAt, ensureCell, connect, removeCell,
  inBounds, cellType, signalsOfCell, nextSignalId, platforms, opp
} from './model.js';
import { clearReachCache } from './interlocking.js';

export const TOOL_HELP = {
  track: 'Ziehen: Gleis zeichnen. Aus Verzweigungen entstehen automatisch Weichen (3 Enden) bzw. Kreuzungen (4 Enden).',
  erase: 'Klicken oder ziehen: Gleiszelle samt Signalen entfernen.',
  signal: 'Klick nahe einem Gleisende setzt ein Hauptsignal in diese Richtung; Klick auf ein Signal entfernt es.',
  shunt: 'Wie Hauptsignal, jedoch als Sperrsignal (Rangierfahrten).',
  platform: 'Ziehen über Gleiszellen: Bahnsteig zuordnen. Mit gedrückter Umschalttaste wird die Zuordnung gelöscht.',
  entry: 'Klick auf eine Gleiszelle am Rand: Ein-/Ausfahrt anlegen oder entfernen.',
  speed: 'Klick auf eine Gleiszelle: zulässige Geschwindigkeit setzen (leer = keine Beschränkung).',
  label: 'Klick auf eine freie Stelle: Beschriftung setzen (leerer Text löscht sie).'
};

export class Editor {
  constructor(canvas, getLayout, onChange) {
    this.canvas = canvas;
    this.getLayout = getLayout;
    this.onChange = onChange;
    this.tool = 'track';
    this.hover = null;
    this.drag = null;
    this.platformName = null;
    this.selected = null;

    canvas.addEventListener('mousedown', e => this.onDown(e));
    canvas.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('mouseup', () => { this.drag = null; this.platformName = null; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  cellFromEvent(e) {
    const L = this.getLayout();
    const r = this.canvas.getBoundingClientRect();
    const cs = L.cellSize;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return { x: Math.floor(px / cs), y: Math.floor(py / cs), fx: (px % cs) / cs, fy: (py % cs) / cs };
  }

  /** Richtung, die dem Klickpunkt innerhalb der Zelle am nächsten liegt */
  nearestEnd(c, fx, fy) {
    const vx = fx - 0.5, vy = fy - 0.5;
    let best = null, bestD = Infinity;
    for (const d of c.ends) {
      const dx = DIRS[d].dx / 2, dy = DIRS[d].dy / 2;
      const dist = Math.hypot(vx - dx, vy - dy);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  onDown(e) {
    const L = this.getLayout();
    const p = this.cellFromEvent(e);
    if (!inBounds(L, p.x, p.y)) return;
    this.drag = { last: p, shift: e.shiftKey };
    this.apply(p, e, true);
  }

  onMove(e) {
    const L = this.getLayout();
    const p = this.cellFromEvent(e);
    this.hover = inBounds(L, p.x, p.y) ? p : null;
    if (!this.drag) { this.onChange(false); return; }
    if (p.x === this.drag.last.x && p.y === this.drag.last.y) return;
    // Bei schneller Mausbewegung übersprungene Zellen nachtragen,
    // damit die gezeichnete Linie lückenlos bleibt.
    for (const step of cellPath(this.drag.last, p)) {
      if (!inBounds(L, step.x, step.y)) continue;
      this.apply({ ...step, fx: p.fx, fy: p.fy }, e, false);
      this.drag.last = step;
    }
  }

  apply(p, e, isFirst) {
    const L = this.getLayout();
    const k = key(p.x, p.y);
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
      case 'erase':
        removeCell(L, p.x, p.y);
        break;
      case 'signal': case 'shunt': {
        const c = cellAt(L, p.x, p.y);
        if (!c || !c.ends.length) break;
        const existing = signalsOfCell(L, p.x, p.y);
        const d = this.nearestEnd(c, p.fx, p.fy);
        const hit = existing.find(s => s.dir === d);
        if (hit) { delete L.signals[hit.id]; this.selected = null; }
        else {
          const kind = this.tool === 'shunt' ? 'shunt' : 'main';
          const id = 'sig' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
          L.signals[id] = { id, name: nextSignalId(L, kind), x: p.x, y: p.y, dir: d, kind };
          this.selected = { type: 'signal', id };
        }
        break;
      }
      case 'platform': {
        const c = cellAt(L, p.x, p.y);
        if (!c || !c.ends.length) break;
        if (this.drag.shift) { c.platform = null; break; }
        if (!this.platformName) {
          const suggestion = c.platform || nextPlatformName(L);
          const name = window.prompt('Name des Bahnsteiggleises:', suggestion);
          if (!name) { this.drag = null; break; }
          this.platformName = name;
        }
        c.platform = this.platformName;
        break;
      }
      case 'entry': {
        if (!isFirst) break;
        const c = cellAt(L, p.x, p.y);
        if (!c || !c.ends.length) break;
        if (c.entry) {
          if (window.confirm(`Ein-/Ausfahrt „${c.entry}" entfernen?`)) c.entry = null;
        } else {
          const name = window.prompt('Bezeichnung der Ein-/Ausfahrt (z. B. Richtung Hamburg):', 'Strecke ' + (countEntries(L) + 1));
          if (name) c.entry = name;
        }
        break;
      }
      case 'speed': {
        if (!isFirst) break;
        const c = cellAt(L, p.x, p.y);
        if (!c || !c.ends.length) break;
        const v = window.prompt('Zulässige Geschwindigkeit in km/h (leer = keine Beschränkung):', c.vmax || '');
        if (v === null) break;
        c.vmax = v.trim() === '' ? null : Math.max(5, parseInt(v, 10) || 0) || null;
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
    }
    clearReachCache(L);
    this.onChange(true);
  }

  /** Beschreibung der Zelle unter dem Mauszeiger */
  describe() {
    const L = this.getLayout();
    if (!this.hover) return 'Nichts ausgewählt.';
    const c = cellAt(L, this.hover.x, this.hover.y);
    if (!c) return `Zelle ${this.hover.x},${this.hover.y}: leer`;
    const parts = [`Zelle ${c.x},${c.y}`, `Typ: ${typeName(cellType(c))}`,
      `Enden: ${c.ends.map(d => DIR_NAMES[d]).join(', ') || '–'}`];
    if (c.platform) parts.push(`Bahnsteig: ${c.platform}`);
    if (c.entry) parts.push(`Ein-/Ausfahrt: ${c.entry}`);
    if (c.vmax) parts.push(`Vmax: ${c.vmax} km/h`);
    const sigs = signalsOfCell(L, c.x, c.y);
    if (sigs.length) parts.push('Signale: ' + sigs.map(s => `${s.name} (${DIR_NAMES[s.dir]}${s.kind === 'shunt' ? ', Sperrsignal' : ''})`).join(', '));
    return parts.join('<br>');
  }
}

/** Zellen zwischen zwei Punkten (Achter-Nachbarschaft, je Schritt eine Zelle) */
function cellPath(from, to) {
  const out = [];
  let x = from.x, y = from.y;
  let guard = 0;
  while ((x !== to.x || y !== to.y) && guard++ < 500) {
    x += Math.sign(to.x - x);
    y += Math.sign(to.y - y);
    out.push({ x, y });
  }
  return out;
}

function typeName(t) {
  return { none: 'leer', empty: 'leer', stump: 'Stumpfgleis/Streckenende', track: 'Gleis', switch: 'Weiche', crossing: 'Kreuzung', invalid: 'ungültig' }[t] || t;
}
function nextPlatformName(L) {
  const used = platforms(L);
  let n = 1;
  while (used.includes('Gleis ' + n)) n++;
  return 'Gleis ' + n;
}
function countEntries(L) {
  return Object.values(L.cells).filter(c => c.entry).length;
}
