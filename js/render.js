/* ===================================================================
 * render.js – Zeichnen des Gleisbildes auf ein Canvas
 * ================================================================= */
import { DIRS, opp, key, parseKey, cellAt, cellType, switchGeom, platformCells } from './model.js';
import { CELL_M, trainCells } from './sim.js';
import { aspectOf } from './interlocking.js';

const COL = {
  bg: '#070a0f', grid: '#141b24',
  track: '#7d8899', trackDim: '#39414d',
  locked: '#f0f4f8', occupied: '#f85149', blocked: '#c957d6',
  platform: '#243043', platformEdge: '#3a4a63',
  text: '#c3cedb', entry: '#4da3ff'
};
const TRAIN_COLORS = { ICE: '#e6e6e6', IC: '#e6e6e6', RE: '#4da3ff', RB: '#3fb950', S: '#63d3a6', Güterzug: '#e3b341', Sonderzug: '#ff9f43' };

export function centerOf(x, y, cs) { return { px: (x + 0.5) * cs, py: (y + 0.5) * cs }; }
export function edgePoint(x, y, d, cs) {
  const c = centerOf(x, y, cs);
  return { px: c.px + DIRS[d].dx * cs / 2, py: c.py + DIRS[d].dy * cs / 2 };
}

/** Position eines Punktes in Metern entlang eines Fahrweges */
export function pointAlong(steps, dist, cs) {
  const n = steps.length;
  let idx = Math.floor(dist / CELL_M);
  let f = (dist - idx * CELL_M) / CELL_M;
  if (idx < 0) { idx = 0; f = 0; }
  if (idx >= n) {           // hinter dem Fahrweg (ausfahrender Zug) verlängern
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
  const cs = L.cellSize || 26;
  const ctx = canvas.getContext('2d');
  const w = L.gridW * cs, h = L.gridH * cs;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);

  if (opts.grid) {
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= L.gridW; x++) { ctx.moveTo(x * cs + .5, 0); ctx.lineTo(x * cs + .5, h); }
    for (let y = 0; y <= L.gridH; y++) { ctx.moveTo(0, y * cs + .5); ctx.lineTo(w, y * cs + .5); }
    ctx.stroke();
  }

  drawPlatforms(ctx, L, cs);

  const occupied = sim ? sim.occupiedCells() : new Set();
  for (const k in L.cells) drawCell(ctx, L, L.cells[k], cs, sim, occupied);

  if (sim) for (const tr of sim.trains) drawTrain(ctx, tr, cs);
  for (const id in L.signals) drawSignal(ctx, L, L.signals[id], cs, sim);
  drawEntries(ctx, L, cs, sim);
  drawLabels(ctx, L, cs);

  if (opts.hover) {
    ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 1.5;
    ctx.strokeRect(opts.hover.x * cs + 1, opts.hover.y * cs + 1, cs - 2, cs - 2);
  }
  if (opts.highlight) for (const k of opts.highlight) {
    const p = parseKey(k);
    ctx.fillStyle = 'rgba(77,163,255,.2)';
    ctx.fillRect(p.x * cs, p.y * cs, cs, cs);
  }
}

function drawPlatforms(ctx, L, cs) {
  const names = new Set();
  for (const k in L.cells) if (L.cells[k].platform) names.add(L.cells[k].platform);
  for (const name of names) {
    const cells = platformCells(L, name);
    ctx.fillStyle = COL.platform;
    ctx.strokeStyle = COL.platformEdge;
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
}

function drawCell(ctx, L, c, cs, sim, occupied) {
  if (!c.ends.length) return;
  const k = key(c.x, c.y);
  const center = centerOf(c.x, c.y, cs);
  const t = cellType(c);
  let color = COL.track, lw = Math.max(2, cs * 0.12);
  if (sim) {
    if (occupied.has(k)) { color = COL.occupied; lw += 1; }
    else if (sim.lockedCells.has(k)) { color = COL.locked; lw += 1; }
    if (sim.blockedCells.has(k)) color = COL.blocked;
  }
  const geom = t === 'switch' ? switchGeom(c) : null;
  for (const d of c.ends) {
    let col = color, dashed = false;
    if (geom && geom.branches.includes(d) && geom.branches.indexOf(d) !== (c.sw | 0)) { col = COL.trackDim; }
    if (sim && sim.blockedCells.has(k)) { col = COL.blocked; dashed = true; }
    const e = edgePoint(c.x, c.y, d, cs);
    ctx.strokeStyle = col;
    ctx.lineWidth = col === COL.trackDim ? lw * 0.7 : lw;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath(); ctx.moveTo(center.px, center.py); ctx.lineTo(e.px, e.py); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (t === 'switch') {
    const faulty = sim && sim.faultySwitches.has(k);
    ctx.fillStyle = faulty ? '#f85149' : (sim && sim.lockedCells.has(k) ? '#f0f4f8' : '#9fb0c6');
    ctx.beginPath(); ctx.arc(center.px, center.py, Math.max(2, cs * 0.13), 0, Math.PI * 2); ctx.fill();
    if (faulty) {
      ctx.fillStyle = '#f85149';
      ctx.font = `bold ${Math.max(8, cs * 0.4)}px Segoe UI`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', center.px, center.py - cs * 0.42);
    }
  }
  if (c.vmax && isSpeedSectionStart(L, c)) {
    ctx.fillStyle = '#e3b341';
    ctx.font = `${Math.max(7, cs * 0.28)}px Consolas, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(c.vmax, center.px, c.y * cs + cs * 0.72);
  }
}

/** Geschwindigkeit nur am Anfang eines Abschnitts beschriften */
function isSpeedSectionStart(L, c) {
  for (const d of c.ends) {
    const n = { x: c.x + DIRS[d].dx, y: c.y + DIRS[d].dy };
    const nc = cellAt(L, n.x, n.y);
    if (nc && nc.vmax === c.vmax && (n.x < c.x || (n.x === c.x && n.y < c.y))) return false;
  }
  return true;
}

function drawSignal(ctx, L, s, cs, sim) {
  const c = centerOf(s.x, s.y, cs);
  const d = DIRS[s.dir];
  const px = c.px + d.dx * cs * 0.40, py = c.py + d.dy * cs * 0.40;
  const perp = { x: -d.dy, y: d.dx };
  const ox = px + perp.x * cs * 0.28, oy = py + perp.y * cs * 0.28;
  let aspect = 'Hp0';
  if (sim) aspect = aspectOf(sim, s);
  const col = aspect === 'Hp1' ? '#3fb950' : aspect === 'Zs1' ? '#e3b341' : aspect === 'Gestört' ? '#c957d6' : '#f85149';
  ctx.strokeStyle = '#8b98a8'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ox, oy); ctx.stroke();
  ctx.fillStyle = col;
  const r = Math.max(2.5, cs * (s.kind === 'shunt' ? 0.11 : 0.15));
  if (s.kind === 'shunt') { ctx.fillRect(ox - r, oy - r, r * 2, r * 2); }
  else { ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.fill(); }
  if (cs >= 22) {
    ctx.fillStyle = COL.text;
    ctx.font = `${Math.max(8, cs * 0.3)}px Segoe UI`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(s.name, ox, oy + r + 1);
  }
}

function drawEntries(ctx, L, cs, sim) {
  for (const k in L.cells) {
    const c = L.cells[k];
    if (!c.entry) continue;
    const ctr = centerOf(c.x, c.y, cs);
    ctx.fillStyle = COL.entry;
    ctx.beginPath();
    ctx.arc(ctr.px, ctr.py, cs * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `bold ${Math.max(9, cs * 0.34)}px Segoe UI`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = COL.entry;
    ctx.fillText(c.entry, ctr.px, c.y * cs - 1);
    if (sim) {
      const waiting = sim.trains.filter(t => t.state === 'waiting' && t.entryName === c.entry);
      if (waiting.length) {
        ctx.fillStyle = '#e3b341';
        ctx.font = `${Math.max(8, cs * 0.3)}px Segoe UI`;
        ctx.textBaseline = 'top';
        ctx.fillText(waiting.map(t => t.nr).join(','), ctr.px, (c.y + 1) * cs + 1);
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

function drawTrain(ctx, tr, cs) {
  if (!trainCells(tr).length) return;
  const head = pointAlong(tr.steps, tr.s, cs);
  const tail = pointAlong(tr.steps, Math.max(0, tr.s - tr.lenM), cs);
  const col = TRAIN_COLORS[tr.gattung] || '#4da3ff';
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(3, cs * 0.3);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  // dem Fahrweg folgen (stützpunktweise)
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const d = Math.max(0, tr.s - tr.lenM) + (tr.lenM * i / n);
    const p = pointAlong(tr.steps, Math.min(d, tr.s), cs);
    i === 0 ? ctx.moveTo(p.px, p.py) : ctx.lineTo(p.px, p.py);
  }
  ctx.stroke();
  ctx.fillStyle = '#08121f';
  ctx.beginPath(); ctx.arc(head.px, head.py, Math.max(2, cs * 0.1), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = col;
  ctx.font = `bold ${Math.max(8, cs * 0.32)}px Segoe UI`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(tr.nr, (head.px + tail.px) / 2, Math.min(head.py, tail.py) - cs * 0.22);
}
