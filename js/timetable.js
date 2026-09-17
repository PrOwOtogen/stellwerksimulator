/* ===================================================================
 * timetable.js – Fahrplandaten, Zufallsfahrplan und Fahrplantabelle
 * ================================================================= */
import { entries, platforms, platformCells, entryByName } from './model.js';
import { workingPossible } from './interlocking.js';
import { hhmm, parseTime } from './sim.js';
import { mulberry32 } from './events.js';

export const GATTUNGEN = [
  { code: 'ICE', vmax: 200, length: 4, weight: 1, stopChance: 0.8, dwell: 180 },
  { code: 'IC', vmax: 160, length: 4, weight: 1, stopChance: 0.9, dwell: 150 },
  { code: 'RE', vmax: 140, length: 3, weight: 3, stopChance: 1.0, dwell: 120 },
  { code: 'RB', vmax: 120, length: 2, weight: 3, stopChance: 1.0, dwell: 90 },
  { code: 'S', vmax: 100, length: 2, weight: 2, stopChance: 1.0, dwell: 60 },
  { code: 'Güterzug', vmax: 90, length: 6, weight: 2, stopChance: 0.1, dwell: 300 }
];

/** Fahrplan zufällig erzeugen */
export function generateTimetable(L, count = 12, startTime = 6 * 3600, seed = 1234) {
  const rng = mulberry32(seed >>> 0);
  const es = entries(L).map(e => e.name);
  const pfs = platforms(L);
  if (es.length < 2) return [];
  // nur Relationen verwenden, die ohne Fahrtrichtungswechsel befahrbar sind
  const relations = [];
  for (const from of es) for (const to of es) {
    if (from === to) continue;
    const a = entryByName(L, from).cell, b = entryByName(L, to).cell;
    if (!workingPossible(L, a, null, b)) continue;
    const viaPfs = pfs.filter(pf => workingPossible(L, a, pf, b));
    relations.push({ from, to, viaPfs });
  }
  if (!relations.length) return [];
  const rows = [];
  const totalW = GATTUNGEN.reduce((s, g) => s + g.weight, 0);
  let t = startTime + 120;
  for (let i = 0; i < count; i++) {
    let r = rng() * totalW, g = GATTUNGEN[0];
    for (const cand of GATTUNGEN) { r -= cand.weight; if (r <= 0) { g = cand; break; } }
    const rel = relations[Math.floor(rng() * relations.length)];
    const from = rel.from, to = rel.to;
    t += Math.round(90 + rng() * 420);
    const nr = g.code + ' ' + (1000 + Math.floor(rng() * 8999));
    const stops = [];
    if (rel.viaPfs.length && rng() < g.stopChance) {
      const pf = rel.viaPfs[Math.floor(rng() * rel.viaPfs.length)];
      const arr = t + 240 + Math.round(rng() * 120);
      stops.push({ platform: pf, arr, dep: arr + g.dwell });
    }
    rows.push({ nr, gattung: g.code, entry: from, entryTime: t, exit: to, stops, vmax: g.vmax, length: g.length });
  }
  rows.sort((a, b) => a.entryTime - b.entryTime);
  return rows;
}

export function emptyRow(L) {
  const es = entries(L).map(e => e.name);
  return {
    nr: 'RB 0000', gattung: 'RB',
    entry: es[0] || '', entryTime: 6 * 3600,
    exit: es[1] || es[0] || '', stops: [], vmax: 120, length: 2
  };
}

export const stopsToText = stops =>
  (stops || []).map(s => `${s.platform}@${hhmm(s.arr)}/${hhmm(s.dep)}`).join('; ');

export function textToStops(text) {
  const out = [];
  for (const part of (text || '').split(';')) {
    const m = /^\s*(.+?)\s*@\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\/\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*$/.exec(part);
    if (!m) continue;
    out.push({ platform: m[1], arr: parseTime(m[2]), dep: parseTime(m[3]) });
  }
  return out;
}

/** Fahrplantabelle aufbauen (bearbeitbar) */
export function renderTimetable(tbody, L, onChange) {
  tbody.innerHTML = '';
  const es = entries(L).map(e => e.name);
  L.timetable.sort((a, b) => a.entryTime - b.entryTime);
  L.timetable.forEach((row, i) => {
    const tr = document.createElement('tr');
    const cell = (child) => { const td = document.createElement('td'); td.append(child); tr.append(td); return td; };
    const txt = (val, apply, width) => {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = val;
      if (width) inp.style.width = width;
      inp.onchange = () => { apply(inp.value); onChange(); };
      return inp;
    };
    const sel = (val, options, apply) => {
      const s = document.createElement('select');
      for (const o of options) {
        const op = document.createElement('option');
        op.value = o; op.textContent = o; if (o === val) op.selected = true;
        s.append(op);
      }
      s.onchange = () => { apply(s.value); onChange(); };
      return s;
    };
    cell(txt(row.nr, v => row.nr = v, '7em'));
    cell(sel(row.gattung, GATTUNGEN.map(g => g.code), v => {
      row.gattung = v;
      const g = GATTUNGEN.find(x => x.code === v);
      if (g) { row.vmax = g.vmax; row.length = g.length; }
    }));
    cell(sel(row.entry, es, v => row.entry = v));
    cell(txt(hhmm(row.entryTime), v => { const t = parseTime(v); if (t !== null) row.entryTime = t; }, '5em'));
    cell(sel(row.exit, es, v => row.exit = v));
    cell(txt(stopsToText(row.stops), v => row.stops = textToStops(v), '20em'));
    cell(txt(String(row.vmax), v => row.vmax = Math.max(10, +v || 100), '4em'));
    cell(txt(String(row.length), v => row.length = Math.max(1, +v || 2), '3em'));
    const del = document.createElement('button');
    del.textContent = '✕'; del.className = 'danger';
    del.onclick = () => { L.timetable.splice(i, 1); renderTimetable(tbody, L, onChange); onChange(); };
    cell(del);
    tbody.append(tr);
  });
}
