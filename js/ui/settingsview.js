/* ===================================================================
 * settingsview.js – Betriebsparameter
 * ================================================================= */
import { app } from './app.js';
import { $, h, toast } from './dom.js';
import { SCORE_RULES } from '../scoring.js';

const GROUPS = {
  '#set-dyn': [
    ['metersPerCell', 'Streckenmaßstab: Meter je Rasterzelle', 'num', 5],
    ['dynamicFactor', 'Fahrdynamik-Faktor (1 = vorbildgetreu)', 'num', 0.1],
    ['accel', 'Anfahrbeschleunigung ohne Gattungswert (m/s²)', 'num', 0.1],
    ['brake', 'Bremsverzögerung ohne Gattungswert (m/s²)', 'num', 0.1],
    ['minDwell', 'Mindesthaltezeit (s)', 'num', 5]
  ],
  '#set-tech': [
    ['flankProtection', 'Flankenschutz fordern', 'bool'],
    ['overlapM', 'Durchrutschweg (m)', 'num', 50],
    ['overlapReleaseSec', 'Auflösung des Durchrutschwegs nach Stillstand (s)', 'num', 10],
    ['switchTime', 'Weichenumlaufzeit (s)', 'num', 1],
    ['crossingCloseSec', 'Schließzeit Bahnübergang (s)', 'num', 5],
    ['releaseDelaySec', 'Wartezeit Hilfsauflösung (s)', 'num', 10],
    ['divergingSpeed', 'Hp2: Geschwindigkeit über abzweigende Weichen (km/h)', 'num', 5],
    ['substituteSpeed', 'Zs1: Geschwindigkeit bei Ersatzsignal (km/h)', 'num', 5],
    ['shuntSpeed', 'Rangiergeschwindigkeit (km/h)', 'num', 5]
  ],
  '#set-ops': [
    ['trainReporting', 'Zugmeldeverfahren: Züge müssen angenommen werden', 'bool'],
    ['offerLeadSec', 'Anbieten vor planmäßiger Einfahrt (s)', 'num', 30],
    ['punctualLimit', 'Grenze „pünktlich" (s)', 'num', 30],
    ['showVmax', 'Geschwindigkeiten im Gleisbild', 'bool'],
    ['showZN', 'Zugnummern im Gleisbild', 'bool']
  ]
};

const DYNAMIC_PRESETS = {
  'Vorbildgetreu': { metersPerCell: 100, dynamicFactor: 1, switchTime: 6, crossingCloseSec: 25 },
  'Zügig': { metersPerCell: 50, dynamicFactor: 1.2, switchTime: 5, crossingCloseSec: 18 },
  'Sehr zügig': { metersPerCell: 25, dynamicFactor: 1.6, switchTime: 3, crossingCloseSec: 10 }
};

export function buildSettings(onReset) {
  const st = app.layout.settings;
  const defaults = { trainReporting: false, offerLeadSec: 180 };
  for (const [sel, fields] of Object.entries(GROUPS)) {
    const box = $(sel);
    box.innerHTML = '';
    for (const [k, label, type, step] of fields) {
      if (st[k] === undefined && k in defaults) st[k] = defaults[k];
      const inp = type === 'bool'
        ? h('input', { type: 'checkbox', checked: st[k] !== false && st[k] !== undefined ? !!st[k] : false })
        : h('input', { type: 'number', value: st[k] ?? 0, step: step || 1 });
      if (type === 'bool' && (k === 'showVmax' || k === 'showZN' || k === 'flankProtection')) inp.checked = st[k] !== false;
      inp.onchange = () => {
        st[k] = type === 'bool' ? inp.checked : (parseFloat(inp.value) || 0);
        if (['metersPerCell', 'trainReporting'].includes(k)) { app.dirty = true; toast('Wirkt nach dem Zurücksetzen des Betriebs.'); }
      };
      box.append(h('label', {}, label), inp);
    }
  }
  const pr = $('#dyn-presets');
  pr.innerHTML = '';
  for (const [name, vals] of Object.entries(DYNAMIC_PRESETS)) {
    pr.append(h('button', {
      onclick: () => { Object.assign(st, vals); buildSettings(onReset); onReset?.(); toast(`Fahrdynamik „${name}" übernommen.`, 'ok'); }
    }, name));
  }
  $('#score-rules').innerHTML = SCORE_RULES.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');
}
