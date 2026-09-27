/* ===================================================================
 * diagrams.js – Bildfahrplan, Gleisbelegung und Auswertung
 * ================================================================= */
import { app } from './app.js';
import { $, $$, h, esc, downloadText } from './dom.js';
import { entries, platforms, key, parseKey, cellAt } from '../model.js';
import { hhmm, parseTime, signedMin } from '../sim.js';
import { findRoute } from '../interlocking.js';
import { relations } from '../timetable.js';

let mode = 'graph';

export function initDiagrams() {
  for (const b of $$('#diag-seg button')) b.onclick = () => {
    mode = b.dataset.diag;
    $$('#diag-seg button').forEach(x => x.classList.toggle('active', x === b));
    drawDiagram();
  };
  $('#btn-dg-refresh').onclick = drawDiagram;
  $('#dg-route').onchange = drawDiagram;
  $('#btn-report-csv').onclick = reportCsv;
}

/** Zeitfenster auf den Betrieb einstellen */
export function resetDiagramWindow() {
  const t0 = app.layout.startTime;
  $('#dg-from').value = hhmm(t0);
  $('#dg-to').value = hhmm(t0 + 2 * 3600);
}

export function drawDiagram() {
  $('#dg-route-wrap').classList.toggle('hidden', mode !== 'graph');
  if (mode === 'graph') drawGraph(); else drawOccupancy();
}

function setup(heightPx) {
  const cv = $('#diag-canvas');
  const W = cv.clientWidth || 1000, H = heightPx;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, W, H);
  return { ctx, W, H };
}
function timeAxis(ctx, xOf, from, to, top, bottom) {
  ctx.strokeStyle = '#1b222d'; ctx.fillStyle = '#8b98a8'; ctx.font = '11px Segoe UI, sans-serif';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const step = to - from > 4 * 3600 ? 3600 : to - from > 90 * 60 ? 1800 : 900;
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
    ctx.beginPath(); ctx.moveTo(xOf(t), top); ctx.lineTo(xOf(t), bottom); ctx.stroke();
    ctx.fillText(hhmm(t), xOf(t), 10);
  }
}
function nowLine(ctx, xOf, from, to, top, bottom) {
  const t = app.sim.time;
  if (t < from || t > to) return;
  ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(xOf(t), top); ctx.lineTo(xOf(t), bottom); ctx.stroke();
  ctx.lineWidth = 1;
}

/* ---------------- Bildfahrplan ---------------- */
function drawGraph() {
  const L = app.layout;
  const rels = relations(L).filter(r => r.kind === 'durchfahrt');
  const sel = $('#dg-route');
  const sig = rels.map(r => r.from + r.to).join('|');
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = rels.map((r, i) => `<option value="${i}">${esc(r.from)} → ${esc(r.to)}</option>`).join('');
  }
  $('#dg-hint').textContent = 'Zeit-Weg-Linien: durchgezogen die tatsächliche Fahrt (grün pünktlich, gelb/rot verspätet), gestrichelt der Fahrplan. Steile Linien = schnelle Fahrt, waagerechte Stücke = Halt.';
  const { ctx, W, H } = setup(440);
  if (!rels.length) {
    ctx.fillStyle = '#8b98a8'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('Für einen Bildfahrplan werden zwei durchgehend verbundene Ein-/Ausfahrten benötigt.', W / 2, H / 2);
    return;
  }
  const rel = rels[Math.min(rels.length - 1, +sel.value || 0)];
  const a = entries(L).find(e => e.name === rel.from), b = entries(L).find(e => e.name === rel.to);
  const path = findRoute({ type: 'entry', cell: a.cell }, { type: 'exit', cell: b.cell }, {
    layout: L, blocked: new Set(), locked: new Map(), holds: new Map(), occupied: new Set(), allowOccupied: true, mode: 'train', passSignals: true
  });
  if (!path) return;
  const pos = new Map();
  path.steps.forEach((st, i) => { if (!pos.has(st.k)) pos.set(st.k, i); });
  const maxIdx = path.steps.length - 1;
  const from = parseTime($('#dg-from').value) ?? L.startTime;
  const to = parseTime($('#dg-to').value) ?? from + 2 * 3600;
  const left = 110, right = W - 16, top = 22, bottom = H - 16;
  const xOf = t => left + (right - left) * (t - from) / Math.max(1, to - from);
  const yOf = i => top + (bottom - top) * i / Math.max(1, maxIdx);
  timeAxis(ctx, xOf, from, to, top, bottom);

  const marks = [{ i: 0, name: rel.from }];
  const seen = new Set();
  path.steps.forEach((st, i) => {
    const p = parseKey(st.k), c = cellAt(L, p.x, p.y);
    if (c && c.platform && !seen.has(c.platform)) { seen.add(c.platform); marks.push({ i, name: c.platform }); }
  });
  marks.push({ i: maxIdx, name: rel.to });
  ctx.textAlign = 'left';
  for (const m of marks) {
    ctx.strokeStyle = '#2b3543';
    ctx.beginPath(); ctx.moveTo(left, yOf(m.i)); ctx.lineTo(right, yOf(m.i)); ctx.stroke();
    ctx.fillStyle = '#c3cedb'; ctx.fillText(m.name, 6, yOf(m.i));
  }
  ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  for (const row of L.timetable) {
    if (row.entry !== rel.from || row.exit !== rel.to) continue;
    const pts = [[row.entryTime, 0]];
    for (const st of row.stops) {
      const cells = Object.values(L.cells).filter(c => c.platform === st.platform && pos.has(key(c.x, c.y)));
      if (!cells.length) continue;
      const i = Math.min(...cells.map(c => pos.get(key(c.x, c.y))));
      pts.push([st.arr, i], [st.dep, i]);
    }
    const last = pts[pts.length - 1];
    const run = Math.max(90, (last[0] - row.entryTime) * (maxIdx - last[1]) / Math.max(1, last[1]));
    pts.push([last[0] + run, maxIdx]);
    ctx.strokeStyle = 'rgba(139,152,168,.6)';
    ctx.beginPath();
    pts.forEach(([t, i], n) => n ? ctx.lineTo(xOf(t), yOf(i)) : ctx.moveTo(xOf(t), yOf(i)));
    ctx.stroke();
  }
  ctx.setLineDash([]); ctx.lineWidth = 2;
  for (const tr of app.sim.trains) {
    const log = (tr.trackLog || []).filter(p => pos.has(p.k) && p.t >= from && p.t <= to);
    if (log.length < 2) continue;
    ctx.strokeStyle = tr.delay > 300 ? '#f85149' : tr.delay > 60 ? '#e3b341' : '#3fb950';
    ctx.beginPath();
    log.forEach((p, n) => n ? ctx.lineTo(xOf(p.t), yOf(pos.get(p.k))) : ctx.moveTo(xOf(p.t), yOf(pos.get(p.k))));
    ctx.stroke();
    const lp = log[log.length - 1];
    ctx.fillStyle = '#dce4ee'; ctx.font = '10px Segoe UI';
    ctx.fillText(tr.nr, xOf(lp.t) + 3, yOf(pos.get(lp.k)) - 6);
  }
  nowLine(ctx, xOf, from, to, top, bottom);
}

/* ---------------- Gleisbelegung ---------------- */
function drawOccupancy() {
  const L = app.layout;
  const pfs = platforms(L);
  $('#dg-hint').textContent = 'Obere Balkenhälfte: Fahrplan. Untere Hälfte: tatsächliche Belegung (grün pünktlich, rot mehr als 5 min zu spät). Überlappungen zeigen Konflikte.';
  const rowH = 30;
  const { ctx, W, H } = setup(Math.max(160, 40 + pfs.length * rowH));
  const from = parseTime($('#dg-from').value) ?? L.startTime;
  const to = parseTime($('#dg-to').value) ?? from + 2 * 3600;
  const left = 90, right = W - 12;
  const xOf = t => left + (right - left) * (t - from) / Math.max(1, to - from);
  timeAxis(ctx, xOf, from, to, 18, H);
  pfs.forEach((pf, i) => {
    const y = 26 + i * rowH;
    ctx.textAlign = 'left'; ctx.fillStyle = '#c3cedb'; ctx.font = '12px Segoe UI';
    ctx.fillText(pf, 6, y + rowH / 2);
    ctx.strokeStyle = '#1b222d';
    ctx.beginPath(); ctx.moveTo(left, y + rowH); ctx.lineTo(right, y + rowH); ctx.stroke();
    for (const row of L.timetable) for (const st of row.stops) {
      if (st.platform !== pf) continue;
      ctx.fillStyle = '#39414d';
      ctx.fillRect(xOf(st.arr), y + 4, Math.max(3, xOf(st.dep) - xOf(st.arr)), rowH * 0.36);
      ctx.fillStyle = '#9aa7b8'; ctx.font = '10px Segoe UI';
      ctx.fillText(row.nr, xOf(st.arr) + 2, y + 4 + rowH * 0.18);
    }
    for (const o of app.sim.occupancyLog) {
      if (o.platform !== pf) continue;
      const end = o.to ?? app.sim.time;
      ctx.fillStyle = (o.from - o.planFrom) > 300 ? '#f85149' : '#3fb950';
      ctx.fillRect(xOf(o.from), y + rowH * 0.5, Math.max(3, xOf(end) - xOf(o.from)), rowH * 0.36);
      ctx.fillStyle = '#0a0e14'; ctx.font = 'bold 10px Segoe UI';
      ctx.fillText(o.nr, xOf(o.from) + 2, y + rowH * 0.68);
    }
  });
  nowLine(ctx, xOf, from, to, 18, H);
}

/* ---------------- Auswertung ---------------- */
const stateLabel = s => ({ done: 'beendet', pending: 'angekündigt', waiting: 'wartet', run: 'unterwegs', hold: 'steht', dwell: 'hält', turning: 'wendet' }[s] || s);

export function buildReport() {
  const rep = app.sim.report();
  const done = rep.trains.filter(t => t.state === 'done');
  const q = rep.stats.finished ? Math.round(100 * rep.stats.punctual / rep.stats.finished) : 0;
  const kpi = (label, val) => `<div class="kpi-card"><small>${label}</small><b>${val}</b></div>`;
  $('#report-kpi').innerHTML =
    kpi('Punkte', app.score ? app.score.points : 0) +
    kpi('Zugfahrten', `${done.length}/${rep.trains.length}`) +
    kpi('Pünktlichkeit', done.length ? q + ' %' : '–') +
    kpi('Ø Verspätung', done.length ? (rep.avgDelay / 60).toFixed(1) + ' min' : '–') +
    kpi('Fahrstraßen', rep.stats.routesSet) +
    kpi('Halte vor Signal', rep.stats.signalStops) +
    kpi('Störungen', rep.stats.faultsTotal);

  const tb = $('#report-table tbody');
  tb.innerHTML = '';
  for (const t of rep.trains) {
    const halte = t.halte.map(x => `${esc(x.platform)}: ${hhmm(x.anPlan)}→${x.anIst ? hhmm(x.anIst) : '—'} / ${hhmm(x.abPlan)}→${x.abIst ? hhmm(x.abIst) : '—'}`).join('<br>') || '–';
    const cls = t.delay < 60 ? 'delay-ok' : t.delay < 300 ? 'delay-mid' : 'delay-bad';
    tb.append(h('tr', { html: `<td><b>${esc(t.nr)}</b></td><td>${esc(t.gattung)}</td><td>${esc(t.von)} → ${esc(t.nach)}</td>
      <td class="small">${halte}</td><td>${stateLabel(t.state)}</td><td class="${cls}">${t.state === 'pending' ? '–' : signedMin(t.delay)}</td>` }));
  }

  const sl = $('#score-log');
  const ent = app.score ? app.score.entries : [];
  sl.innerHTML = ent.length ? ent.slice(0, 120).map(e =>
    `<div><span class="t">${hhmm(e.t)}</span><span class="${e.pts >= 0 ? 'ok' : 'bad'}">${e.pts > 0 ? '+' : ''}${e.pts}</span> ${esc(e.text)}</div>`).join('')
    : '<em>noch keine Punkte</em>';

  const cv = $('#report-canvas');
  const W = cv.clientWidth || 600, H = 220;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, W, H);
  if (!done.length) {
    ctx.fillStyle = '#8b98a8'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('Noch keine abgeschlossenen Zugfahrten.', W / 2, H / 2);
    return;
  }
  const buckets = [0, 0, 0, 0, 0, 0];
  const labels = ['pünktlich', '< 3 min', '< 5 min', '< 10 min', '< 20 min', '≥ 20 min'];
  for (const t of done) { const m = t.delay / 60; buckets[m < 1 ? 0 : m < 3 ? 1 : m < 5 ? 2 : m < 10 ? 3 : m < 20 ? 4 : 5]++; }
  const max = Math.max(1, ...buckets), bw = (W - 30) / 6;
  buckets.forEach((v, i) => {
    const bh = (H - 56) * v / max;
    ctx.fillStyle = ['#3fb950', '#63d3a6', '#e3b341', '#e08c3a', '#f85149', '#c957d6'][i];
    ctx.fillRect(15 + i * bw + 8, H - 30 - bh, bw - 16, bh);
    ctx.fillStyle = '#c3cedb'; ctx.font = '11px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], 15 + i * bw + bw / 2, H - 14);
    if (v) ctx.fillText(String(v), 15 + i * bw + bw / 2, H - 38 - bh);
  });
}

function reportCsv() {
  const rep = app.sim.report();
  const lines = ['Zug;Gattung;von;nach;Zustand;Verspätung_min;Halte'];
  for (const t of rep.trains) lines.push([t.nr, t.gattung, t.von, t.nach, t.state, Math.round(t.delay / 60),
    t.halte.map(x => `${x.platform} an ${hhmm(x.anPlan)}/${x.anIst ? hhmm(x.anIst) : '-'} ab ${hhmm(x.abPlan)}/${x.abIst ? hhmm(x.abIst) : '-'}`).join(' | ')].join(';'));
  downloadText(lines.join('\n'), app.layout.name + '-auswertung.csv');
}
