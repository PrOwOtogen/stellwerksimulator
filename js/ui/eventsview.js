/* ===================================================================
 * eventsview.js – Zufallsereignisse und geplante Baustellen
 * ================================================================= */
import { app, call } from './app.js';
import { $, h, esc, toast, inputTime } from './dom.js';
import { platforms, sidings } from '../model.js';
import { hhmm } from '../sim.js';
import { EVENT_TYPES } from '../events.js';

export function initEventsView() {
  $('#btn-ev-test').onclick = () => {
    const f = app.events.fireRandom();
    toast(f ? f.title : 'Kein Ereignis möglich (keine passenden Objekte).', f ? 'warn' : '');
    call('switchView', 'sim');
  };
  $('#btn-add-planned').onclick = () => {
    const L = app.layout;
    L.planned = L.planned || [];
    const target = platforms(L)[0] || sidings(L)[0] || '*';
    L.planned.push({ id: 'B' + Date.now().toString(36), type: 'sperrung', target, from: L.startTime + 1800, to: L.startTime + 5400, vmax: 40 });
    app.dirty = true;
    buildEventsView();
  };
}

export function buildEventsView() {
  const cfg = app.layout.events;
  $('#ev-enabled').checked = cfg.enabled;
  $('#ev-rate').value = cfg.ratePerHour;
  $('#ev-seed').value = cfg.seed;
  $('#ev-enabled').onchange = e => cfg.enabled = e.target.checked;
  $('#ev-rate').onchange = e => cfg.ratePerHour = Math.max(0, +e.target.value || 0);
  $('#ev-seed').onchange = e => { cfg.seed = parseInt(e.target.value, 10) || 0; app.events.reseed(); };

  const tb = $('#ev-table tbody');
  tb.innerHTML = '';
  for (const t of EVENT_TYPES) {
    if (!cfg.types[t.id]) cfg.types[t.id] = { enabled: true, weight: t.weight };
    const c = cfg.types[t.id];
    const cb = h('input', { type: 'checkbox', checked: c.enabled, onchange: e => c.enabled = e.target.checked });
    const w = h('input', { type: 'number', min: 0, max: 20, value: c.weight, style: { width: '4em' }, onchange: e => c.weight = Math.max(0, +e.target.value || 0) });
    tb.append(h('tr', {},
      h('td', {}, cb), h('td', {}, h('b', {}, t.name)), h('td', {}, w), h('td', { class: 'small' }, t.desc),
      h('td', {}, h('button', {
        onclick: () => {
          const f = app.events.fireRandom(t.id);
          toast(f ? f.title : 'Ereignis derzeit nicht möglich.', f ? 'warn' : '');
          call('switchView', 'sim');
        }
      }, 'auslösen'))));
  }

  // geplante Baustellen
  const L = app.layout;
  const ptb = $('#planned-table tbody');
  ptb.innerHTML = '';
  const tracks = ['*', ...platforms(L), ...sidings(L)];
  for (const p of L.planned || []) {
    const type = h('select', { onchange: e => { p.type = e.target.value; app.dirty = true; } },
      h('option', { value: 'sperrung', selected: p.type === 'sperrung' }, 'Gleissperrung'),
      h('option', { value: 'langsam', selected: p.type === 'langsam' }, 'Langsamfahrt'));
    const tgt = h('select', { onchange: e => { p.target = e.target.value; app.dirty = true; } },
      ...tracks.map(t => h('option', { value: t, selected: t === p.target }, t === '*' ? 'ganzer Bereich' : t)));
    const vmax = h('input', { type: 'number', value: p.vmax || 40, style: { width: '4.5em' }, onchange: e => { p.vmax = +e.target.value || 40; app.dirty = true; } });
    ptb.append(h('tr', {},
      h('td', {}, type), h('td', {}, tgt),
      h('td', {}, inputTime(hhmm(p.from), v => { p.from = v; app.dirty = true; })),
      h('td', {}, inputTime(hhmm(p.to), v => { p.to = v; app.dirty = true; })),
      h('td', {}, vmax),
      h('td', {}, h('button', { class: 'danger', onclick: () => { L.planned = L.planned.filter(x => x !== p); app.dirty = true; buildEventsView(); } }, '✕'))));
  }
  if (!(L.planned || []).length) ptb.innerHTML = '<tr><td colspan="6"><em>keine Baustellen geplant</em></td></tr>';
}
