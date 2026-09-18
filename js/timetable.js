/* ===================================================================
 * timetable.js – Fahrplandaten, Generatoren und Fahrplantabelle
 * ================================================================= */
import { entries, platforms, platformCells, entryByName, sidings } from './model.js';
import { workingPossible } from './interlocking.js';
import { hhmm, parseTime } from './sim.js';
import { mulberry32 } from './events.js';

export const GATTUNGEN = [
  { code: 'ICE', vmax: 250, length: 4, weight: 1, stopChance: 0.8, dwell: 180, name: 'Intercity-Express' },
  { code: 'IC', vmax: 200, length: 5, weight: 1, stopChance: 0.9, dwell: 150, name: 'Intercity' },
  { code: 'RE', vmax: 160, length: 3, weight: 3, stopChance: 1.0, dwell: 120, name: 'Regional-Express' },
  { code: 'RB', vmax: 120, length: 2, weight: 3, stopChance: 1.0, dwell: 90, name: 'Regionalbahn' },
  { code: 'S', vmax: 120, length: 2, weight: 2, stopChance: 1.0, dwell: 60, name: 'S-Bahn' },
  { code: 'Güterzug', vmax: 100, length: 7, weight: 2, stopChance: 0.1, dwell: 300, name: 'Güterzug' },
  { code: 'Nahgüterzug', vmax: 80, length: 4, weight: 1, stopChance: 0.4, dwell: 600, name: 'Nahgüterzug' },
  { code: 'Sonderzug', vmax: 120, length: 4, weight: 0, stopChance: 0.5, dwell: 120, name: 'Sonderzug' },
  { code: 'Lok', vmax: 40, length: 1, weight: 0, stopChance: 0, dwell: 0, name: 'Lokfahrt/Rangierabteilung' }
];
export const gattungOf = code => GATTUNGEN.find(g => g.code === code) || GATTUNGEN[3];

/** befahrbare Relationen des Gleisplans ermitteln */
export function relations(L) {
  const es = entries(L).map(e => e.name);
  const pfs = platforms(L);
  const out = [];
  for (const from of es) for (const to of es) {
    if (from === to) continue;
    const a = entryByName(L, from)?.cell, b = entryByName(L, to)?.cell;
    if (!a || !b || !workingPossible(L, a, null, b)) continue;
    out.push({ from, to, viaPfs: pfs.filter(pf => workingPossible(L, a, pf, b)) });
  }
  return out;
}

/** Zufallsfahrplan */
export function generateTimetable(L, count = 12, startTime = 6 * 3600, seed = 1234, opts = {}) {
  const rng = mulberry32(seed >>> 0);
  const rels = relations(L);
  if (!rels.length) return [];
  const rows = [];
  const pool = GATTUNGEN.filter(g => g.weight > 0);
  const totalW = pool.reduce((s, g) => s + g.weight, 0);
  let t = startTime + 120;
  const spread = opts.spreadSec ?? 420;
  for (let i = 0; i < count; i++) {
    let r = rng() * totalW, g = pool[0];
    for (const cand of pool) { r -= cand.weight; if (r <= 0) { g = cand; break; } }
    const rel = rels[Math.floor(rng() * rels.length)];
    t += Math.round(60 + rng() * spread);
    const nr = g.code + ' ' + (1000 + Math.floor(rng() * 8999));
    const stops = [];
    if (rel.viaPfs.length && rng() < g.stopChance) {
      const pf = rel.viaPfs[Math.floor(rng() * rel.viaPfs.length)];
      const arr = t + 240 + Math.round(rng() * 120);
      stops.push({ platform: pf, arr, dep: arr + g.dwell, connections: [] });
    }
    const row = {
      nr, gattung: g.code, entry: rel.from, entryTime: t, exit: rel.to,
      stops, vmax: g.vmax, length: g.length, turn: null
    };
    // gelegentlich endet ein Nahverkehrszug und wendet
    if (opts.turns !== false && stops.length && ['RB', 'S', 'RE'].includes(g.code) && rng() < 0.18) {
      const back = rels.find(x => x.from === rel.to && x.to === rel.from) ||
        rels.find(x => x.from === rel.to);
      if (back) {
        const dep = stops[0].arr + 420;
        row.turn = {
          nr: g.code + ' ' + (1000 + Math.floor(rng() * 8999)),
          gattung: g.code, exit: back.to, dep, wende: 300, stops: []
        };
      }
    }
    rows.push(row);
  }
  rows.sort((a, b) => a.entryTime - b.entryTime);
  return rows;
}

/**
 * Taktfahrplan: eine Linie im festen Takt.
 * opts: { gattung, from, to, platform, firstDep, everyMin, count, nrStart, dwell, turn }
 */
export function generateTakt(L, opts) {
  const g = gattungOf(opts.gattung);
  const rows = [];
  const every = Math.max(1, opts.everyMin || 60) * 60;
  let nr = opts.nrStart || 1000;
  for (let i = 0; i < (opts.count || 1); i++) {
    const t = (opts.firstDep || 6 * 3600) + i * every;
    const stops = [];
    if (opts.platform) {
      const arr = t + (opts.travelSec || 240);
      stops.push({ platform: opts.platform, arr, dep: arr + (opts.dwell ?? g.dwell), connections: [] });
    }
    rows.push({
      nr: `${g.code} ${nr}`, gattung: g.code, entry: opts.from, entryTime: t, exit: opts.to,
      stops, vmax: g.vmax, length: g.length,
      turn: opts.turn ? { nr: `${g.code} ${nr + 1}`, gattung: g.code, exit: opts.from, dep: t + (opts.travelSec || 240) + 600, wende: opts.turnWait ?? 300, stops: [] } : null
    });
    nr += 2;
  }
  return rows;
}

export function emptyRow(L) {
  const es = entries(L).map(e => e.name);
  return {
    nr: 'RB 0000', gattung: 'RB',
    entry: es[0] || '', entryTime: 6 * 3600,
    exit: es[1] || es[0] || '', stops: [], vmax: 120, length: 2, turn: null
  };
}

/* ---------------- Textdarstellung der Halte ----------------
 * "Gleis 2@08:15/08:17>RE 4711" – Anschluss von RE 4711
 * ---------------------------------------------------------- */
export const stopsToText = stops => (stops || []).map(s => {
  const conn = (s.connections || []).map(c => '>' + c.from).join('');
  return `${s.platform}@${hhmm(s.arr)}/${hhmm(s.dep)}${conn}`;
}).join('; ');

export function textToStops(text) {
  const out = [];
  for (const part of (text || '').split(';')) {
    const m = /^\s*(.+?)\s*@\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\/\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/.exec(part);
    if (!m) continue;
    const connections = (m[4] || '').split('>').map(s => s.trim()).filter(Boolean)
      .map(nr => ({ from: nr, maxWait: 600 }));
    out.push({ platform: m[1], arr: parseTime(m[2]), dep: parseTime(m[3]), connections });
  }
  return out;
}

export const turnToText = turn => turn ? `${turn.nr} → ${turn.exit} ab ${hhmm(turn.dep)}` : '–';

/** Fahrplan auf Durchführbarkeit prüfen */
export function checkTimetable(L) {
  const msgs = [];
  const es = entries(L).map(e => e.name);
  const pfs = platforms(L);
  for (const row of L.timetable) {
    const a = entryByName(L, row.entry)?.cell;
    const b = entryByName(L, row.exit)?.cell;
    if (!a) { msgs.push(`⚠ ${row.nr}: Einfahrt „${row.entry}" gibt es nicht.`); continue; }
    if (!b) { msgs.push(`⚠ ${row.nr}: Ausfahrt „${row.exit}" gibt es nicht.`); continue; }
    if (!workingPossible(L, a, null, b))
      msgs.push(`⚠ ${row.nr}: ${row.entry} → ${row.exit} ist ohne Fahrtrichtungswechsel nicht befahrbar.`);
    for (const st of row.stops) {
      if (!pfs.includes(st.platform)) { msgs.push(`⚠ ${row.nr}: Bahnsteig „${st.platform}" gibt es nicht.`); continue; }
      if (!workingPossible(L, a, st.platform, b))
        msgs.push(`⚠ ${row.nr}: Halt in ${st.platform} liegt nicht auf dem Weg ${row.entry} → ${row.exit}.`);
      if (st.dep < st.arr) msgs.push(`⚠ ${row.nr}: Abfahrt vor Ankunft in ${st.platform}.`);
      if (st.arr < row.entryTime) msgs.push(`⚠ ${row.nr}: Ankunft in ${st.platform} liegt vor der Einfahrt.`);
      for (const c of st.connections || [])
        if (!L.timetable.some(r => r.nr === c.from)) msgs.push(`ℹ ${row.nr}: Anschlusszug „${c.from}" steht nicht im Fahrplan.`);
    }
    if (row.turn) {
      if (!row.stops.length) msgs.push(`⚠ ${row.nr}: Wende ohne vorherigen Halt ist nicht möglich.`);
      if (!es.includes(row.turn.exit)) msgs.push(`⚠ ${row.nr}: Wende-Ziel „${row.turn.exit}" gibt es nicht.`);
    }
  }
  if (!msgs.length) msgs.push('✔ Fahrplan ohne Beanstandung.');
  msgs.unshift(`${L.timetable.length} Zugfahrten, ${L.timetable.filter(r => r.turn).length} Wenden, ` +
    `${L.timetable.reduce((n, r) => n + r.stops.length, 0)} Halte, ` +
    `${L.timetable.reduce((n, r) => n + r.stops.reduce((m, s) => m + (s.connections || []).length, 0), 0)} Anschlüsse.`);
  return msgs;
}

/** Fahrplantabelle aufbauen */
export function renderTimetable(tbody, L, onChange, hooks = {}) {
  tbody.innerHTML = '';
  const es = entries(L).map(e => e.name);
  L.timetable.sort((a, b) => a.entryTime - b.entryTime);
  L.timetable.forEach((row, i) => {
    const tr = document.createElement('tr');
    const cell = child => { const td = document.createElement('td'); td.append(child); tr.append(td); return td; };
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
        op.value = o; op.textContent = o;
        if (o === val) op.selected = true;
        s.append(op);
      }
      s.onchange = () => { apply(s.value); onChange(); };
      return s;
    };
    cell(txt(row.nr, v => row.nr = v, '7em'));
    cell(sel(row.gattung, GATTUNGEN.map(g => g.code), v => {
      row.gattung = v;
      const g = gattungOf(v);
      row.vmax = g.vmax; row.length = g.length;
    }));
    cell(sel(row.entry, es, v => row.entry = v));
    cell(txt(hhmm(row.entryTime), v => { const t = parseTime(v); if (t !== null) row.entryTime = t; }, '5em'));
    cell(sel(row.exit, es, v => row.exit = v));

    const stopsBox = document.createElement('span');
    stopsBox.append(txt(stopsToText(row.stops), v => row.stops = textToStops(v), '18em'));
    if (hooks.editStops) {
      const b = document.createElement('button');
      b.textContent = '…'; b.title = 'Halte im Einzelnen bearbeiten';
      b.onclick = () => hooks.editStops(row);
      stopsBox.append(b);
    }
    cell(stopsBox);

    const turnBox = document.createElement('span');
    turnBox.append(document.createTextNode(turnToText(row.turn)));
    if (hooks.editTurn) {
      const b = document.createElement('button');
      b.textContent = '…'; b.title = 'Wende bearbeiten';
      b.onclick = () => hooks.editTurn(row);
      turnBox.append(b);
    }
    cell(turnBox);

    cell(txt(String(row.vmax), v => row.vmax = Math.max(10, +v || 100), '4em'));
    cell(txt(String(row.length), v => row.length = Math.max(1, +v || 2), '3em'));
    const tools = document.createElement('span');
    const dup = document.createElement('button');
    dup.textContent = '⧉'; dup.title = 'Zug verdoppeln';
    dup.onclick = () => {
      const copy = JSON.parse(JSON.stringify(row));
      copy.entryTime += 3600;
      copy.stops.forEach(s => { s.arr += 3600; s.dep += 3600; });
      if (copy.turn) copy.turn.dep += 3600;
      L.timetable.push(copy);
      renderTimetable(tbody, L, onChange, hooks); onChange();
    };
    const del = document.createElement('button');
    del.textContent = '✕'; del.className = 'danger'; del.title = 'Zug löschen';
    del.onclick = () => { L.timetable.splice(i, 1); renderTimetable(tbody, L, onChange, hooks); onChange(); };
    tools.append(dup, del);
    cell(tools);
    tbody.append(tr);
  });
}
