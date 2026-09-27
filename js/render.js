/* ===================================================================
 * render.js – Zeichnen des Gleisbildes
 * ================================================================= */
import {
  DIRS, opp, key, parseKey, cellAt, cellType, switchGeom, platformCells, dkwPartner
} from './model.js';
import { CELL_M, trainCells } from './sim.js';
import { aspectOf, distantAspect } from './interlocking.js';

const COL = {
  bg: '#070a0f', grid: '#141b24',
  track: '#7d8899', trackDim: '#39414d',
  locked: '#f0f4f8', overlap: '#7fd8ff', occupied: '#f85149', blocked: '#c957d6',
  platform: '#243043', platformEdge: '#3a4a63', siding: '#2a2438',
  text: '#c3cedb', entry: '#4da3ff', moving: '#e3b341'
};
export const TRAIN_COLORS = {
  ICE: '#e8e8e8', IC: '#dcdcdc', RE: '#4da3ff', RB: '#3fb950', S: '#63d3a6',
  Güterzug: '#e3b341', Nahgüterzug: '#c79a3a', Sonderzug: '#ff9f43', Lok: '#b28cff'
};
const ASPECT_COL = {
  Hp0: '#f85149', Hp1: '#3fb950', Hp2: '#3fb950', Zs1: '#e3b341',
  Sh1: '#e8e8e8', Gestört: '#c957d6', dunkel: '#3a4553',
  Vr0: '#f0a04a', Vr1: '#3fb950', Vr2: '#3fb950'
};

export function cellSizeOf(L, zoom = 1) { return (L.cellSize || 26) * zoom; }
export function centerOf(x, y, cs) { return { px: (x + 0.5) * cs, py: (y + 0.5) * cs }; }
export function edgePoint(x, y, d, cs) {
  const c = centerOf(x, y, cs);
  return { px: c.px + DIRS[d].dx * cs / 2, py: c.py + DIRS[d].dy * cs / 2 };
}

/** Punkt in Metern entlang eines Fahrweges */
export function pointAlong(steps, dist, cs) {
  const n = steps.length;
  let idx = Math.floor(dist / CELL_M);
  let f = (dist - idx * CELL_M) / CELL_M;
  if (idx < 0) { idx = 0; f = 0; }
  if (idx >= n) {
    const last = steps[n - 1];
    const p = parseKey(last.k);
    const c = centerOf(p.x, p.y, cs);
    const d = last.to != null ? last.to : opp(last.from ?? 0);
    const over = (dist - n * CELL_M) / CELL_M;
    const e = edgePoint(p.x, p.y, d, cs);
    return { px: e.px + (e.px - c.px) * over * 2, py: e.py + (e.py - c.py) * over * 2 };
  }
  const st = steps[idx];
  const p = parseKey(st.k);
  const c = centerOf(p.x, p.y, cs);
  const a = st.from != null ? edgePoint(p.x, p.y, st.from, cs) : c;
  const b = st.to != null ? edgePoint(p.x, p.y, st.to, cs) : c;
  if (f < 0.5) { const t = f * 2; return { px: a.px + (c.px - a.px) * t, py: a.py + (c.py - a.py) * t }; }
  const t = (f - 0.5) * 2;
  return { px: c.px + (b.px - c.px) * t, py: c.py + (b.py - c.py) * t };
}

export function draw(canvas, L, sim, opts = {}) {
  const cs = cellSizeOf(L, opts.zoom || 1);
  const ctx = canvas.getContext('2d');
  const w = Math.round(L.gridW * cs), h = Math.round(L.gridH * cs);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);
  const set = L.settings || {};

  if (opts.grid) {
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= L.gridW; x++) { ctx.moveTo(x * cs + .5, 0); ctx.lineTo(x * cs + .5, h); }
    for (let y = 0; y <= L.gridH; y++) { ctx.moveTo(0, y * cs + .5); ctx.lineTo(w, y * cs + .5); }
    ctx.stroke();
  }

  drawAreas(ctx, L, cs);

  const occupied = sim ? sim.occupiedCells() : new Set();
  const overlapKeys = new Set();
  if (sim) for (const r of sim.routes) if (!r.overlapReleased) for (const st of r.overlap || []) overlapKeys.add(st.k);

  for (const k in L.cells) drawCell(ctx, L, L.cells[k], cs, sim, occupied, overlapKeys, set);
  if (sim && sim.slowCells && sim.slowCells.size) drawSlowCells(ctx, sim, cs);
  drawCrossings(ctx, L, cs, sim);
  if (sim) for (const tr of sim.trains) drawTrain(ctx, tr, cs, set);
  for (const id in L.signals) drawSignal(ctx, L, L.signals[id], cs, sim);
  drawEntries(ctx, L, cs, sim);
  drawLabels(ctx, L, cs);
  if (sim && set.showZN !== false) drawTrainNumbers(ctx, L, sim, cs);

  if (opts.hover) {
    ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 1.5;
    ctx.strokeRect(opts.hover.x * cs + 1, opts.hover.y * cs + 1, cs - 2, cs - 2);
  }
  if (opts.highlight) {
    for (const k of opts.highlight) {
      const p = parseKey(k);
      ctx.fillStyle = 'rgba(77,163,255,.25)';
      ctx.fillRect(p.x * cs, p.y * cs, cs, cs);
    }
  }
  if (opts.selection) {
    const r = opts.selection;
    const x0 = Math.min(r.x1, r.x2), y0 = Math.min(r.y1, r.y2);
    const x1 = Math.max(r.x1, r.x2), y1 = Math.max(r.y1, r.y2);
    ctx.fillStyle = 'rgba(77,163,255,.12)';
    ctx.fillRect(x0 * cs, y0 * cs, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs);
    ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(x0 * cs + .5, y0 * cs + .5, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs);
    ctx.setLineDash([]);
  }
  if (opts.pulse && opts.pulse.length) {
    const t = (performance.now() % 1200) / 1200;
    for (const p of opts.pulse) {
      const c = centerOf(p.x, p.y, cs);
      ctx.strokeStyle = `rgba(255,196,64,${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(c.px, c.py, cs * (0.5 + t * 0.9), 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffc440'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c.px, c.py, cs * 0.55, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (opts.hoverSignal) {
    const s = opts.hoverSignal, d = DIRS[s.dir];
    const c = centerOf(s.x, s.y, cs);
    const ox = c.px + d.dx * cs * 0.40 - d.dy * cs * 0.30, oy = c.py + d.dy * cs * 0.40 + d.dx * cs * 0.30;
    ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ox, oy, cs * 0.3, 0, Math.PI * 2); ctx.stroke();
  }
  if (opts.preview) {
    ctx.strokeStyle = 'rgba(127,216,255,.7)'; ctx.lineWidth = Math.max(2, cs * 0.16);
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (const st of opts.preview) {
      const p = parseKey(st.k);
      const c = centerOf(p.x, p.y, cs);
      ctx.moveTo(c.px - cs * 0.3, c.py); ctx.lineTo(c.px + cs * 0.3, c.py);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
}

function drawAreas(ctx, L, cs) {
  const names = new Set(), sids = new Set();
  for (const k in L.cells) {
    if (L.cells[k].platform) names.add(L.cells[k].platform);
    if (L.cells[k].stump) sids.add(L.cells[k].stump);
  }
  for (const name of names) {
    const cells = platformCells(L, name);
    ctx.fillStyle = COL.platform; ctx.strokeStyle = COL.platformEdge;
    for (const c of cells) {
      ctx.fillRect(c.x * cs, c.y * cs + cs * 0.12, cs, cs * 0.76);
      ctx.strokeRect(c.x * cs + .5, c.y * cs + cs * 0.12, cs, cs * 0.76);
    }
    const minX = Math.min(...cells.map(c => c.x));
    const cy = cells.find(c => c.x === minX);
    ctx.fillStyle = COL.text;
    ctx.font = `${Math.max(9, cs * 0.34)}px Segoe UI, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(name, minX * cs + 2, cy.y * cs + cs * 0.14);
  }
  for (const name of sids) {
    const cells = Object.values(L.cells).filter(c => c.stump === name);
    ctx.fillStyle = COL.siding;
    for (const c of cells) ctx.fillRect(c.x * cs, c.y * cs + cs * 0.15, cs, cs * 0.7);
  }
}

function drawCell(ctx, L, c, cs, sim, occupied, overlapKeys, set) {
  if (!c.ends.length) return;
  const k = key(c.x, c.y);
  const center = centerOf(c.x, c.y, cs);
  const t = cellType(c);
  let color = COL.track, lw = Math.max(2, cs * 0.12);
  if (sim) {
    if (occupied.has(k)) { color = COL.occupied; lw += 1; }
    else if (overlapKeys.has(k)) { color = COL.overlap; lw += 0.5; }
    else if (sim.lockedCells.has(k)) { color = COL.locked; lw += 1; }
    if (sim.blockedCells.has(k)) color = COL.blocked;
  }
  const geom = t === 'switch' ? switchGeom(c) : null;
  const moving = sim && sim.switchMoves.has(k);

  for (const d of c.ends) {
    let col = color, dashed = false;
    if (geom && geom.branches.includes(d) && geom.branches.indexOf(d) !== (c.sw | 0)) col = COL.trackDim;
    if (t === 'dkw') {
      const active = dkwPartner(c, d, c.sw | 0);
      if (active === null) col = COL.trackDim;
    }
    if (moving) col = COL.moving;
    if (sim && sim.blockedCells.has(k)) { col = COL.blocked; dashed = true; }
    const e = edgePoint(c.x, c.y, d, cs);
    ctx.strokeStyle = col;
    ctx.lineWidth = col === COL.trackDim ? lw * 0.7 : lw;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath(); ctx.moveTo(center.px, center.py); ctx.lineTo(e.px, e.py); ctx.stroke();
    ctx.setLineDash([]);
  }

  if (t === 'switch' || t === 'dkw') {
    const faulty = sim && sim.faultySwitches.has(k);
    ctx.fillStyle = faulty ? '#f85149' : moving ? COL.moving
      : (sim && sim.lockedCells.has(k) ? '#f0f4f8' : '#9fb0c6');
    ctx.beginPath();
    if (t === 'dkw') {
      const r = Math.max(2.5, cs * 0.15);
      ctx.moveTo(center.px, center.py - r); ctx.lineTo(center.px + r, center.py);
      ctx.lineTo(center.px, center.py + r); ctx.lineTo(center.px - r, center.py);
      ctx.closePath();
    } else {
      ctx.arc(center.px, center.py, Math.max(2, cs * 0.13), 0, Math.PI * 2);
    }
    ctx.fill();
    if (faulty) {
      ctx.fillStyle = '#f85149';
      ctx.font = `bold ${Math.max(8, cs * 0.4)}px Segoe UI`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', center.px, center.py - cs * 0.42);
    }
  }

  if (c.vmax && set.showVmax !== false && isSpeedSectionStart(L, c)) {
    ctx.fillStyle = '#e3b341';
    ctx.font = `${Math.max(7, cs * 0.28)}px Consolas, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(c.vmax, center.px, c.y * cs + cs * 0.72);
  }
}

function isSpeedSectionStart(L, c) {
  for (const d of c.ends) {
    const nc = cellAt(L, c.x + DIRS[d].dx, c.y + DIRS[d].dy);
    if (nc && nc.vmax === c.vmax && (nc.x < c.x || (nc.x === c.x && nc.y < c.y))) return false;
  }
  return true;
}

function drawCrossings(ctx, L, cs, sim) {
  for (const k in L.cells) {
    const c = L.cells[k];
    if (!c.crossing) continue;
    const st = sim ? sim.crossingState.get(c.crossing.name) : null;
    const col = !st ? '#8b98a8'
      : st.fault ? '#c957d6'
        : st.state === 'closed' ? '#f85149'
          : st.state === 'closing' ? '#e3b341' : '#3fb950';
    const ctr = centerOf(c.x, c.y, cs);
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.5, cs * 0.08);
    ctx.beginPath();
    ctx.moveTo(ctr.px - cs * 0.30, ctr.py - cs * 0.42);
    ctx.lineTo(ctr.px - cs * 0.30, ctr.py + cs * 0.42);
    ctx.moveTo(ctr.px + cs * 0.30, ctr.py - cs * 0.42);
    ctx.lineTo(ctr.px + cs * 0.30, ctr.py + cs * 0.42);
    ctx.stroke();
    if (cs >= 20) {
      ctx.fillStyle = col;
      ctx.font = `${Math.max(7, cs * 0.26)}px Segoe UI`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('BÜ', ctr.px, ctr.py + cs * 0.45);
    }
  }
}

function drawSignal(ctx, L, s, cs, sim) {
  const c = centerOf(s.x, s.y, cs);
  const d = DIRS[s.dir];
  const px = c.px + d.dx * cs * 0.40, py = c.py + d.dy * cs * 0.40;
  const perp = { x: -d.dy, y: d.dx };
  const ox = px + perp.x * cs * 0.30, oy = py + perp.y * cs * 0.30;
  const aspect = sim ? aspectOf(sim, s) : (s.kind === 'distant' ? 'Vr0' : 'Hp0');
  const col = ASPECT_COL[aspect] || '#f85149';
  ctx.strokeStyle = s.blocked ? '#c957d6' : '#8b98a8';
  ctx.lineWidth = s.blocked ? 2 : 1;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ox, oy); ctx.stroke();

  const r = Math.max(2.5, cs * (s.kind === 'shunt' ? 0.11 : 0.15));
  ctx.fillStyle = col;
  if (s.kind === 'shunt') {
    ctx.fillRect(ox - r, oy - r, r * 2, r * 2);
  } else if (s.kind === 'distant') {
    ctx.beginPath();
    ctx.moveTo(ox, oy - r * 1.2); ctx.lineTo(ox + r * 1.2, oy); ctx.lineTo(ox, oy + r * 1.2);
    ctx.lineTo(ox - r * 1.2, oy); ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.fill();
    if (s.kind === 'combined' && sim) {
      // Vorsignal am selben Mast
      const va = distantAspect(sim, s);
      if (va && va !== 'dunkel') {
        ctx.fillStyle = ASPECT_COL[va] || '#3a4553';
        ctx.beginPath();
        ctx.arc(ox + perp.x * r * 1.6, oy + perp.y * r * 1.6, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (aspect === 'Hp2') {           // zweiter Lichtpunkt für Langsamfahrt
    ctx.fillStyle = '#e3b341';
    ctx.beginPath(); ctx.arc(ox - perp.x * r * 1.1, oy - perp.y * r * 1.1, r * 0.45, 0, Math.PI * 2); ctx.fill();
  }
  if (cs >= 20) {
    ctx.fillStyle = s.selfSet ? '#63d3a6' : COL.text;
    ctx.font = `${Math.max(8, cs * 0.3)}px Segoe UI`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(s.name + (s.selfSet ? ' ⟳' : ''), ox, oy + r + 1);
  }
}
function drawEntries(ctx, L, cs, sim) {
  for (const k in L.cells) {
    const c = L.cells[k];
    if (!c.entry) continue;
    const ctr = centerOf(c.x, c.y, cs);
    ctx.fillStyle = COL.entry;
    ctx.beginPath(); ctx.arc(ctr.px, ctr.py, cs * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.font = `bold ${Math.max(9, cs * 0.34)}px Segoe UI`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(c.entry, ctr.px, c.y * cs - 1);
    if (sim) {
      const waiting = sim.trains.filter(t => t.state === 'waiting' && t.entryName === c.entry);
      if (waiting.length) {
        ctx.fillStyle = '#e3b341';
        ctx.font = `${Math.max(8, cs * 0.3)}px Segoe UI`;
        ctx.textBaseline = 'top';
        ctx.fillText(waiting.slice(0, 2).map(t => t.nr).join(','), ctr.px, (c.y + 1) * cs + 1);
      }
    }
  }
}

function drawLabels(ctx, L, cs) {
  ctx.fillStyle = COL.text;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const l of L.labels || []) {
    ctx.font = `${Math.max(9, cs * 0.4)}px Segoe UI`;
    ctx.fillText(l.text, l.x * cs + 2, (l.y + 0.5) * cs);
  }
}

function drawTrain(ctx, tr, cs, set) {
  if (!trainCells(tr).length) return;
  const head = pointAlong(tr.steps, tr.s, cs);
  const tail = pointAlong(tr.steps, Math.max(0, tr.s - tr.lenM), cs);
  const col = TRAIN_COLORS[tr.gattung] || '#4da3ff';
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(3, cs * 0.3);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const d = Math.max(0, tr.s - tr.lenM) + (tr.lenM * i / n);
    const p = pointAlong(tr.steps, Math.min(d, tr.s), cs);
    i === 0 ? ctx.moveTo(p.px, p.py) : ctx.lineTo(p.px, p.py);
  }
  ctx.stroke();
  // Spitze als Pfeil in Fahrtrichtung
  const back = pointAlong(tr.steps, Math.max(0, tr.s - Math.min(tr.lenM, 30)), cs);
  let ang = Math.atan2(head.py - back.py, head.px - back.px);
  if (!isFinite(ang) || (head.px === back.px && head.py === back.py)) ang = 0;
  const r = Math.max(4, cs * 0.26);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(head.px + Math.cos(ang) * r, head.py + Math.sin(ang) * r);
  ctx.lineTo(head.px + Math.cos(ang + 2.4) * r, head.py + Math.sin(ang + 2.4) * r);
  ctx.lineTo(head.px + Math.cos(ang - 2.4) * r, head.py + Math.sin(ang - 2.4) * r);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#08121f'; ctx.lineWidth = 1; ctx.stroke();
  tr._label = { px: (head.px + tail.px) / 2, py: Math.min(head.py, tail.py) };
}

/** Zugnummernfelder (ZN) über den Zügen */
function drawTrainNumbers(ctx, L, sim, cs) {
  for (const tr of sim.trains) {
    if (!tr._label || !trainCells(tr).length) continue;
    const col = TRAIN_COLORS[tr.gattung] || '#4da3ff';
    // haltende und wendende Züge zeigen ihre Abfahrtszeit
    const zeit = t => `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
    const zusatz = tr.state === 'dwell' ? ' ab ' + zeit(tr.departAt)
      : tr.state === 'turning' ? ' wendet bis ' + zeit(tr.turnReadyAt)
        : tr.state === 'hold' && tr.waitSignal ? ' ⛔ ' + tr.waitSignal.name : '';
    const text = tr.nr + zusatz;
    ctx.font = `bold ${Math.max(8, cs * 0.3)}px Segoe UI`;
    const w = ctx.measureText(text).width + 6;
    const x = tr._label.px - w / 2, y = tr._label.py - cs * 0.72;
    ctx.fillStyle = 'rgba(8,14,22,.85)';
    ctx.fillRect(x, y, w, cs * 0.38);
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, w, cs * 0.38);
    ctx.fillStyle = col;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(text, tr._label.px, y + cs * 0.04);
    if (tr.delay > 180) {
      ctx.fillStyle = tr.delay > 300 ? '#f85149' : '#e3b341';
      ctx.font = `${Math.max(7, cs * 0.26)}px Segoe UI`;
      ctx.fillText('+' + Math.round(tr.delay / 60), tr._label.px + w / 2 + cs * 0.22, y + cs * 0.06);
    }
  }
}

/** Legende für die Betriebsansicht */
export const LEGEND = [
  ['#3fb950', 'Fahrt (Hp1/Hp2)'], ['#f85149', 'Halt (Hp0) / besetzt'],
  ['#e3b341', 'Ersatzsignal, Weiche läuft'], ['#f0f4f8', 'Fahrstraße verschlossen'],
  ['#7fd8ff', 'Durchrutschweg'], ['#c957d6', 'gesperrt/gestört'],
  ['#e8e8e8', 'Rangierfahrt (Sh1)']
];


/** Langsamfahrstellen (Baustellen) gelb gepunktet unterlegen */
function drawSlowCells(ctx, sim, cs) {
  ctx.strokeStyle = '#e3b341'; ctx.lineWidth = 2; ctx.setLineDash([2, 3]);
  for (const k of sim.slowCells.keys()) {
    const p = parseKey(k);
    ctx.strokeRect(p.x * cs + 2, p.y * cs + cs * 0.2, cs - 4, cs * 0.6);
  }
  ctx.setLineDash([]);
}

/** Übersichtskarte mit Ausschnittsrahmen */
export function drawMinimap(canvas, L, sim, view) {
  const W = canvas.clientWidth || 220, H = canvas.clientHeight || 120;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(7,10,15,.92)'; ctx.fillRect(0, 0, W, H);
  const sc = Math.min(W / L.gridW, H / L.gridH);
  const occ = sim ? sim.occupiedCells() : new Set();
  ctx.lineWidth = Math.max(1, sc * 0.35);
  for (const k in L.cells) {
    const c = L.cells[k];
    if (!c.ends.length) continue;
    const col = occ.has(k) ? '#f85149' : sim && sim.lockedCells.has(k) ? '#f0f4f8' : c.platform ? '#6c7f99' : '#4b5666';
    ctx.strokeStyle = col;
    const cx = (c.x + 0.5) * sc, cy = (c.y + 0.5) * sc;
    ctx.beginPath();
    for (const d of c.ends) { ctx.moveTo(cx, cy); ctx.lineTo(cx + DIRS[d].dx * sc / 2, cy + DIRS[d].dy * sc / 2); }
    ctx.stroke();
  }
  if (view) {
    const x0 = Math.max(0, view.x0), y0 = Math.max(0, view.y0);
    const x1 = Math.min(L.gridW, view.x1), y1 = Math.min(L.gridH, view.y1);
    const ganz = x0 <= 0 && y0 <= 0 && x1 >= L.gridW && y1 >= L.gridH;
    if (!ganz) {
      ctx.fillStyle = 'rgba(77,163,255,.08)';
      ctx.fillRect(x0 * sc, y0 * sc, (x1 - x0) * sc, (y1 - y0) * sc);
      ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 * sc + .5, y0 * sc + .5, (x1 - x0) * sc - 1, (y1 - y0) * sc - 1);
    }
  }
}
