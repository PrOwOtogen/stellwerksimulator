/* ===================================================================
 * timetableview.js – Fahrplan bearbeiten
 * ================================================================= */
import { app } from './app.js';
import { $, h, esc, toast, openModal, clampInt, inputTime, downloadText } from './dom.js';
import { entries, platforms } from '../model.js';
import { hhmm, parseTime } from '../sim.js';
import {
  renderTimetable, generateTimetable, generateTakt, emptyRow, GATTUNGEN, checkTimetable, stopsToText
} from '../timetable.js';

export function initTimetableView() {
  $('#btn-add-train').onclick = () => { app.layout.timetable.push(emptyRow(app.layout)); refreshTimetable(); app.dirty = true; };
  $('#btn-gen-train').onclick = () => {
    const n = clampInt($('#gen-count').value, 1, 200);
    const rows = generateTimetable(app.layout, n, app.layout.startTime, Math.floor(Math.random() * 1e6));
    if (!rows.length) return toast('Kein Fahrplan möglich: Es fehlen Ein-/Ausfahrten oder befahrbare Verbindungen.', 'bad');
    if (app.layout.timetable.length && !window.confirm(`Bestehenden Fahrplan (${app.layout.timetable.length} Züge) ersetzen?`)) return;
    app.layout.timetable = rows;
    refreshTimetable(); app.dirty = true;
    toast(`${rows.length} Zugfahrten erzeugt.`, 'ok');
  };
  $('#btn-takt').onclick = taktDialog;
  $('#btn-check-tt').onclick = () => {
    $('#tt-check').innerHTML = checkTimetable(app.layout).map(m =>
      `<div class="${m.startsWith('⚠') ? 'w' : m.startsWith('✔') ? 'g' : 'i'}">${esc(m)}</div>`).join('');
  };
  $('#btn-tt-csv').onclick = () => {
    const lines = ['Zugnummer;Gattung;Einfahrt;Zeit;Ausfahrt;Halte;Wende;Vmax;Länge'];
    for (const r of app.layout.timetable) lines.push([r.nr, r.gattung, r.entry, hhmm(r.entryTime), r.exit,
      stopsToText(r.stops), r.turn ? `${r.turn.nr} → ${r.turn.exit}` : '', r.vmax, r.length].join(';'));
    downloadText(lines.join('\n'), app.layout.name + '-fahrplan.csv');
  };
  $('#btn-del-all').onclick = () => {
    if (window.confirm('Gesamten Fahrplan löschen?')) { app.layout.timetable = []; refreshTimetable(); app.dirty = true; }
  };
}

export function refreshTimetable() {
  renderTimetable($('#tt-table tbody'), app.layout, () => { app.dirty = true; }, { editStops, editTurn });
}

function editStops(row) {
  openModal(`Halte von ${row.nr}`, body => {
    const pfs = platforms(app.layout);
    const table = h('table');
    const draw = () => {
      table.innerHTML = '<thead><tr><th>Bahnsteig</th><th>an</th><th>ab</th><th>Anschluss von</th><th>max. Warten (min)</th><th></th></tr></thead>';
      const tb = h('tbody');
      row.stops.forEach((st, i) => {
        const pf = h('select', {}, ...pfs.map(p => h('option', { selected: p === st.platform }, p)));
        pf.onchange = () => st.platform = pf.value;
        const conn = h('input', { type: 'text', value: (st.connections || []).map(c => c.from).join(', ') });
        conn.onchange = () => st.connections = conn.value.split(',').map(s => s.trim()).filter(Boolean)
          .map(nr => ({ from: nr, maxWait: st.connections?.[0]?.maxWait || 600 }));
        const wait = h('input', { type: 'number', value: Math.round((st.connections?.[0]?.maxWait || 600) / 60), style: { width: '5em' } });
        wait.onchange = () => (st.connections || []).forEach(c => c.maxWait = Math.max(0, +wait.value || 0) * 60);
        tb.append(h('tr', {},
          h('td', {}, pf), h('td', {}, inputTime(hhmm(st.arr), v => st.arr = v)), h('td', {}, inputTime(hhmm(st.dep), v => st.dep = v)),
          h('td', {}, conn), h('td', {}, wait),
          h('td', {}, h('button', { class: 'danger', onclick: () => { row.stops.splice(i, 1); draw(); } }, '✕'))));
      });
      table.append(tb);
    };
    draw();
    body.append(table, h('button', {
      style: { marginTop: '8px' }, onclick: () => {
        const last = row.stops[row.stops.length - 1];
        const base = last ? last.dep + 600 : row.entryTime + 300;
        row.stops.push({ platform: pfs[0] || '', arr: base, dep: base + 120, connections: [] });
        draw();
      }
    }, '+ Halt'));
    return () => { row.stops.sort((a, b) => a.arr - b.arr); app.dirty = true; refreshTimetable(); };
  }, { wide: true });
}

function editTurn(row) {
  openModal(`Wende von ${row.nr}`, body => {
    const es = entries(app.layout).map(e => e.name);
    const t = row.turn || { nr: row.nr + 'R', gattung: row.gattung, exit: es[0] || '', dep: (row.stops[0]?.dep || row.entryTime) + 600, wende: 300 };
    body.append(h('div', { class: 'settings-grid', html: `
      <label>Wende aktiv</label><input id="t-on" type="checkbox"${row.turn ? ' checked' : ''}>
      <label>neue Zugnummer</label><input id="t-nr" type="text" value="${esc(t.nr)}">
      <label>Gattung</label><select id="t-gat">${GATTUNGEN.map(g => `<option${g.code === t.gattung ? ' selected' : ''}>${g.code}</option>`).join('')}</select>
      <label>Ausfahrt</label><select id="t-exit">${es.map(e => `<option${e === t.exit ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select>
      <label>planmäßige Abfahrt</label><input id="t-dep" type="text" value="${hhmm(t.dep)}">
      <label>Wendezeit (min)</label><input id="t-w" type="number" value="${Math.round((t.wende || 300) / 60)}">` }));
    return () => {
      if (!$('#t-on').checked) row.turn = null;
      else row.turn = {
        nr: $('#t-nr').value, gattung: $('#t-gat').value, exit: $('#t-exit').value,
        dep: parseTime($('#t-dep').value) ?? t.dep, wende: Math.max(60, (+$('#t-w').value || 5) * 60), stops: []
      };
      app.dirty = true; refreshTimetable();
    };
  });
}

function taktDialog() {
  openModal('Taktlinie anlegen', body => {
    const es = entries(app.layout).map(e => e.name);
    const pfs = ['(kein Halt)', ...platforms(app.layout)];
    body.append(h('div', { class: 'settings-grid', html: `
      <label>Gattung</label><select id="k-gat">${GATTUNGEN.filter(g => g.code !== 'Lok').map(g => `<option${g.code === 'RE' ? ' selected' : ''}>${g.code}</option>`).join('')}</select>
      <label>von</label><select id="k-from">${es.map(e => `<option>${esc(e)}</option>`).join('')}</select>
      <label>nach</label><select id="k-to">${es.map((e, i) => `<option${i === 1 ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select>
      <label>Halt</label><select id="k-pf">${pfs.map(p => `<option>${esc(p)}</option>`).join('')}</select>
      <label>erste Einfahrt</label><input id="k-first" type="text" value="${hhmm(app.layout.startTime)}">
      <label>Takt (min)</label><input id="k-every" type="number" value="60">
      <label>Anzahl Züge</label><input id="k-count" type="number" value="6">
      <label>erste Zugnummer</label><input id="k-nr" type="number" value="4000">
      <label>Fahrzeit bis zum Halt (min)</label><input id="k-travel" type="number" value="4">
      <label>am Ende wenden</label><input id="k-turn" type="checkbox">` }));
    return () => {
      const rows = generateTakt(app.layout, {
        gattung: $('#k-gat').value, from: $('#k-from').value, to: $('#k-to').value,
        platform: $('#k-pf').value === '(kein Halt)' ? null : $('#k-pf').value,
        firstDep: parseTime($('#k-first').value) ?? app.layout.startTime,
        everyMin: +$('#k-every').value || 60, count: clampInt($('#k-count').value, 1, 200),
        nrStart: +$('#k-nr').value || 1000, travelSec: (+$('#k-travel').value || 4) * 60, turn: $('#k-turn').checked
      });
      app.layout.timetable.push(...rows);
      app.dirty = true; refreshTimetable();
      toast(`${rows.length} Zugfahrten angelegt.`, 'ok');
    };
  });
}
