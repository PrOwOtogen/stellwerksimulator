/* ===================================================================
 * viewport.js – Verschieben, Zoomen, Einpassen und Übersichtskarte
 *
 * Das Gleisbild liegt in einem scrollbaren Container. Verschoben wird
 * mit gedrückter mittlerer Maustaste, mit Leertaste + Ziehen oder (im
 * Betrieb) durch Ziehen auf dem Gleisbild; das Mausrad zoomt um den
 * Mauszeiger herum.
 * ================================================================= */
import { app } from './app.js';
import { cellSizeOf, drawMinimap } from '../render.js';

let spaceHeld = false;
window.addEventListener('keydown', e => { if (e.code === 'Space' && e.target === document.body) spaceHeld = true; });
window.addEventListener('keyup', e => { if (e.code === 'Space') spaceHeld = false; });

export class Viewport {
  constructor({ wrap, canvas, minimap, zoomKey, leftPan = () => false, onZoom = () => {} }) {
    this.wrap = wrap;
    this.canvas = canvas;
    this.minimap = minimap;
    this.zoomKey = zoomKey;
    this.leftPan = leftPan;
    this.onZoom = onZoom;
    this.drag = null;
    this.panned = false;

    wrap.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    canvas.addEventListener('mousedown', e => this.onDown(e), true);
    window.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('mouseup', () => this.onUp());
    canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });

    if (minimap) {
      const go = e => {
        const r = minimap.getBoundingClientRect();
        const L = app.layout;
        const sc = Math.min(minimap.width / L.gridW, minimap.height / L.gridH);
        this.centerOn((e.clientX - r.left) / sc, (e.clientY - r.top) / sc, false);
      };
      let down = false;
      minimap.addEventListener('mousedown', e => { down = true; go(e); e.preventDefault(); });
      window.addEventListener('mousemove', e => { if (down) go(e); });
      window.addEventListener('mouseup', () => { down = false; });
    }
  }

  get zoom() { return app.zoom[this.zoomKey]; }
  get cs() { return cellSizeOf(app.layout, this.zoom); }

  /** Rasterzelle unter dem Mauszeiger */
  cellAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const cs = this.cs;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return { x: Math.floor(px / cs), y: Math.floor(py / cs), fx: (px % cs) / cs, fy: (py % cs) / cs, px, py };
  }

  setZoom(z, anchor = null) {
    const L = app.layout;
    z = Math.max(0.3, Math.min(4, z));
    const old = this.cs;
    const rect = this.wrap.getBoundingClientRect();
    // Ankerpunkt in Bildschirm- und Rasterkoordinaten
    const mx = anchor ? anchor.clientX - rect.left : this.wrap.clientWidth / 2;
    const my = anchor ? anchor.clientY - rect.top : this.wrap.clientHeight / 2;
    const cx = (this.wrap.scrollLeft + mx - this.canvas.offsetLeft) / old;
    const cy = (this.wrap.scrollTop + my - this.canvas.offsetTop) / old;
    app.zoom[this.zoomKey] = z;
    const cs = this.cs;
    this.canvas.width = Math.round(L.gridW * cs);
    this.canvas.height = Math.round(L.gridH * cs);
    // Gleisbild wird zentriert, solange es kleiner als der Ausschnitt ist
    this.wrap.scrollLeft = cx * cs + this.canvas.offsetLeft - mx;
    this.wrap.scrollTop = cy * cs + this.canvas.offsetTop - my;
    this.onZoom(z);
  }
  zoomBy(f, anchor) { this.setZoom(this.zoom * f, anchor); }

  /** belegte Fläche des Gleisplans */
  bounds() {
    const L = app.layout;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k in L.cells) {
      const c = L.cells[k];
      if (!c.ends.length) continue;
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y);
    }
    for (const l of L.labels || []) { x0 = Math.min(x0, l.x); y0 = Math.min(y0, l.y); x1 = Math.max(x1, l.x + 6); y1 = Math.max(y1, l.y); }
    if (!isFinite(x0)) return { x0: 0, y0: 0, x1: L.gridW - 1, y1: L.gridH - 1 };
    return { x0: Math.max(0, x0 - 1), y0: Math.max(0, y0 - 1), x1: Math.min(L.gridW - 1, x1 + 1), y1: Math.min(L.gridH - 1, y1 + 2) };
  }

  /** Zoom so wählen, dass der ganze Gleisplan sichtbar ist */
  fit() {
    const L = app.layout;
    const b = this.bounds();
    const base = L.cellSize || 26;
    const w = (b.x1 - b.x0 + 1) * base, hgt = (b.y1 - b.y0 + 1) * base;
    const z = Math.max(0.3, Math.min(2.5, Math.min(this.wrap.clientWidth / w, this.wrap.clientHeight / hgt) * 0.97));
    this.setZoom(z);
    this.centerOn((b.x0 + b.x1 + 1) / 2, (b.y0 + b.y1 + 1) / 2, false);
  }

  centerOn(cx, cy, smooth = true) {
    const cs = this.cs;
    this.wrap.scrollTo({
      left: cx * cs + this.canvas.offsetLeft - this.wrap.clientWidth / 2,
      top: cy * cs + this.canvas.offsetTop - this.wrap.clientHeight / 2,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  /** sichtbarer Ausschnitt in Rasterzellen */
  visible() {
    const cs = this.cs;
    const ox = this.canvas.offsetLeft, oy = this.canvas.offsetTop;
    return {
      x0: (this.wrap.scrollLeft - ox) / cs, y0: (this.wrap.scrollTop - oy) / cs,
      x1: (this.wrap.scrollLeft - ox + this.wrap.clientWidth) / cs,
      y1: (this.wrap.scrollTop - oy + this.wrap.clientHeight) / cs
    };
  }

  drawMinimap(sim) {
    if (!this.minimap || this.minimap.classList.contains('hidden')) return;
    drawMinimap(this.minimap, app.layout, sim, this.visible());
  }

  /* ---------- Maus ---------- */
  onWheel(e) {
    if (e.shiftKey) return;                       // Umschalt + Rad: normal scrollen
    e.preventDefault();
    this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e);
  }
  onDown(e) {
    const pan = e.button === 1 || (e.button === 0 && (spaceHeld || this.leftPan(e)));
    if (!pan) return;
    this.drag = { x: e.clientX, y: e.clientY, sl: this.wrap.scrollLeft, st: this.wrap.scrollTop, moved: false, forced: e.button === 1 || spaceHeld };
    this.panned = false;
    if (this.drag.forced) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  onMove(e) {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    if (!this.drag.moved && Math.hypot(dx, dy) < 5 && !this.drag.forced) return;
    this.drag.moved = true;
    this.wrap.scrollLeft = this.drag.sl - dx;
    this.wrap.scrollTop = this.drag.st - dy;
    this.wrap.classList.add('panning');
  }
  onUp() {
    if (!this.drag) return;
    this.panned = this.drag.moved;
    this.drag = null;
    this.wrap.classList.remove('panning');
  }
  /** true, wenn der letzte Mausklick eigentlich ein Verschieben war */
  consumePan() { const p = this.panned; this.panned = false; return p; }
  get isPanning() { return !!(this.drag && this.drag.moved); }
}
