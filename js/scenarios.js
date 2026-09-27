/* ===================================================================
 * scenarios.js – Spielszenarien mit Zielen, Sternen und Bestenliste
 * ================================================================= */
import { LAYOUT_TEMPLATES } from './layouts.js';
import { generateTakt, generateTimetable } from './timetable.js';
import { defaultEventConfig, EVENT_TYPES } from './events.js';

const T = h => Math.round(h * 3600);
const tpl = name => LAYOUT_TEMPLATES[Object.keys(LAYOUT_TEMPLATES).find(k => k.startsWith(name))]();

/** nur ausgewählte Ereignisarten zulassen */
function onlyEvents(L, ids, rate) {
  L.events = defaultEventConfig();
  L.events.ratePerHour = rate;
  for (const t of EVENT_TYPES) L.events.types[t.id].enabled = ids.includes(t.id);
}

export const SCENARIOS = [
  {
    id: 'einstieg',
    title: 'Erster Dienst',
    difficulty: 1,
    duration: 60 * 60,
    desc: 'Ein ruhiger Morgen in Neustadt. Wenige Züge, kaum Störungen – ideal, um die Bedienung kennenzulernen.',
    goals: [{ type: 'finished', min: 5 }, { type: 'punctuality', min: 80 }],
    stars: [150, 300, 420],
    build() {
      const L = tpl('Bahnhof Neustadt');
      L.name = 'Neustadt – Erster Dienst';
      L.timetable = [
        ...generateTakt(L, { gattung: 'RE', from: 'West', to: 'Ost', platform: 'Gleis 1', firstDep: T(6) + 120, everyMin: 30, count: 2, nrStart: 4010, travelSec: 210 }),
        ...generateTakt(L, { gattung: 'RE', from: 'Ost', to: 'West', platform: 'Gleis 2', firstDep: T(6) + 600, everyMin: 30, count: 2, nrStart: 4011, travelSec: 210 }),
        ...generateTakt(L, { gattung: 'RB', from: 'Nord', to: 'Süd', platform: 'Gleis 3', firstDep: T(6) + 900, everyMin: 30, count: 2, nrStart: 8010, travelSec: 240 })
      ].sort((a, b) => a.entryTime - b.entryTime);
      onlyEvents(L, ['tuer', 'einfahrtversp'], 1);
      return L;
    }
  },
  {
    id: 'berufsverkehr',
    title: 'Berufsverkehr',
    difficulty: 2,
    duration: 2 * 3600,
    desc: 'Dichter Takt auf allen Linien, Züge werden vom Nachbarstellwerk angeboten und müssen angenommen werden. Halte den Knoten flüssig!',
    goals: [{ type: 'finished', min: 16 }, { type: 'punctuality', min: 70 }],
    stars: [500, 900, 1250],
    build() {
      const L = tpl('Bahnhof Neustadt');
      L.name = 'Neustadt – Berufsverkehr';
      L.settings.trainReporting = true;
      L.timetable = [
        ...generateTakt(L, { gattung: 'RE', from: 'West', to: 'Ost', platform: 'Gleis 1', firstDep: T(6) + 120, everyMin: 30, count: 4, nrStart: 4020, travelSec: 210 }),
        ...generateTakt(L, { gattung: 'RE', from: 'Ost', to: 'West', platform: 'Gleis 2', firstDep: T(6) + 480, everyMin: 30, count: 4, nrStart: 4021, travelSec: 210 }),
        ...generateTakt(L, { gattung: 'S', from: 'West', to: 'Ost', platform: 'Gleis 4', firstDep: T(6) + 900, everyMin: 20, count: 5, nrStart: 2040, travelSec: 200 }),
        ...generateTakt(L, { gattung: 'RB', from: 'Nord', to: 'Süd', platform: 'Gleis 3', firstDep: T(6) + 300, everyMin: 30, count: 4, nrStart: 8020, travelSec: 240 }),
        ...generateTimetable(L, 3, T(6) + 1200, 9001, { spreadSec: 1500, turns: false })
      ].sort((a, b) => a.entryTime - b.entryTime);
      onlyEvents(L, ['tuer', 'einfahrtversp', 'weiche', 'signal', 'fahrzeug', 'personal'], 2);
      return L;
    }
  },
  {
    id: 'stoerungstag',
    title: 'Störungstag',
    difficulty: 3,
    duration: 2 * 3600,
    desc: 'Heute geht alles schief: Weichen-, Signal- und Stellwerksstörungen, Personen im Gleis. Entstöre schnell und halte die Verspätungen klein.',
    goals: [{ type: 'finished', min: 10 }, { type: 'avgDelay', max: 8 }],
    stars: [250, 550, 800],
    script: [
      { at: 15 * 60, event: 'weiche' },
      { at: 35 * 60, event: 'signal' },
      { at: 55 * 60, event: 'stellwerk' },
      { at: 75 * 60, event: 'personen' },
      { at: 95 * 60, event: 'gleis' }
    ],
    build() {
      const L = tpl('Bahnhof Neustadt');
      L.name = 'Neustadt – Störungstag';
      L.timetable = [
        ...generateTakt(L, { gattung: 'RE', from: 'West', to: 'Ost', platform: 'Gleis 1', firstDep: T(6) + 120, everyMin: 30, count: 4, nrStart: 4030, travelSec: 210 }),
        ...generateTakt(L, { gattung: 'RE', from: 'Ost', to: 'West', platform: 'Gleis 2', firstDep: T(6) + 600, everyMin: 30, count: 4, nrStart: 4031, travelSec: 210 }),
        ...generateTakt(L, { gattung: 'RB', from: 'Nord', to: 'Süd', platform: 'Gleis 3', firstDep: T(6) + 300, everyMin: 30, count: 4, nrStart: 8030, travelSec: 240 })
      ].sort((a, b) => a.entryTime - b.entryTime);
      L.events = defaultEventConfig();
      L.events.ratePerHour = 3;
      return L;
    }
  },
  {
    id: 'baustelle',
    title: 'Baustelle Gleis 3',
    difficulty: 2,
    duration: 2 * 3600,
    desc: 'Gleis 3 wird ab 06:15 für eine Stunde gesperrt, auf Gleis 4 gilt Langsamfahrt. Leite die Züge per Gleiswechsel auf andere Bahnsteige um.',
    goals: [{ type: 'finished', min: 12 }, { type: 'punctuality', min: 65 }],
    stars: [300, 600, 850],
    build() {
      const L = tpl('Bahnhof Neustadt');
      L.name = 'Neustadt – Baustelle';
      L.planned = [
        { id: 'B1', type: 'sperrung', target: 'Gleis 3', from: T(6) + 900, to: T(7) + 900 },
        { id: 'B2', type: 'langsam', target: 'Gleis 4', vmax: 30, from: T(6), to: T(8) }
      ];
      L.timetable = [
        ...generateTakt(L, { gattung: 'RE', from: 'West', to: 'Ost', platform: 'Gleis 1', firstDep: T(6) + 120, everyMin: 30, count: 4, nrStart: 4040, travelSec: 210 }),
        ...generateTakt(L, { gattung: 'RB', from: 'Nord', to: 'Süd', platform: 'Gleis 3', firstDep: T(6) + 300, everyMin: 30, count: 4, nrStart: 8040, travelSec: 240 }),
        ...generateTakt(L, { gattung: 'S', from: 'West', to: 'Ost', platform: 'Gleis 3', firstDep: T(6) + 700, everyMin: 30, count: 4, nrStart: 2050, travelSec: 200 })
      ].sort((a, b) => a.entryTime - b.entryTime);
      onlyEvents(L, ['tuer', 'einfahrtversp'], 1);
      return L;
    }
  },
  {
    id: 'nebenbahn',
    title: 'Kreuzungen auf der Nebenbahn',
    difficulty: 2,
    duration: 3 * 3600,
    desc: 'Eingleisige Strecke: In Waldheim müssen sich die Züge kreuzen. Plane, welcher Zug auf welches Gleis fährt, damit sich nichts festfährt.',
    goals: [{ type: 'finished', min: 9 }, { type: 'punctuality', min: 75 }],
    stars: [300, 600, 850],
    build() {
      const L = tpl('Kreuzungsbahnhof');
      L.name = 'Waldheim – Kreuzungsbetrieb';
      L.events.ratePerHour = 1;
      return L;
    }
  },
  {
    id: 'kopfbahnhof',
    title: 'Kopfbahnhof am Morgen',
    difficulty: 3,
    duration: 150 * 60,
    desc: 'In Seestadt wendet jeder Zug. Die eingleisige Zufahrt ist der Engpass – räume die Kopfgleise rechtzeitig und nutze die Wendezeiten.',
    goals: [{ type: 'finished', min: 6 }, { type: 'avgDelay', max: 6 }],
    stars: [200, 420, 600],
    build() {
      const L = tpl('Kopfbahnhof');
      L.name = 'Seestadt – Morgenverkehr';
      L.timetable = generateTimetable(L, 10, T(8), 31337, { spreadSec: 1000 });
      onlyEvents(L, ['tuer', 'einfahrtversp', 'weiche', 'fahrzeug'], 1.5);
      return L;
    }
  }
];

export const scenarioById = id => SCENARIOS.find(s => s.id === id) || null;

/* ---------------- Ziele und Bewertung ---------------- */

export function goalText(g) {
  switch (g.type) {
    case 'finished': return `mindestens ${g.min} Zugfahrten abschließen`;
    case 'punctuality': return `Pünktlichkeit mindestens ${g.min} %`;
    case 'avgDelay': return `Ø Verspätung höchstens ${g.max} min`;
    case 'points': return `mindestens ${g.min} Punkte`;
    default: return g.type;
  }
}

/** Fortschritt eines Ziels: { value, ok, text } */
export function goalState(g, sim, score) {
  const s = sim.stats;
  const q = s.finished ? Math.round(100 * s.punctual / s.finished) : 0;
  const avg = s.finished ? s.delaySum / s.finished / 60 : 0;
  switch (g.type) {
    case 'finished': return { value: s.finished, ok: s.finished >= g.min, text: `${s.finished}/${g.min} Züge` };
    case 'punctuality': return { value: q, ok: s.finished > 0 && q >= g.min, text: `${q} % pünktlich` };
    case 'avgDelay': return { value: avg, ok: s.finished > 0 && avg <= g.max, text: `Ø ${avg.toFixed(1)} min` };
    case 'points': return { value: score.points, ok: score.points >= g.min, text: `${score.points} Punkte` };
    default: return { value: 0, ok: false, text: '?' };
  }
}

export function evaluate(def, sim, score, usedAuto) {
  const goals = def.goals.map(g => ({ goal: g, ...goalState(g, sim, score) }));
  const passed = goals.every(g => g.ok);
  let stars = 0;
  if (passed) {
    stars = 1;
    if (score.points >= def.stars[1]) stars = 2;
    if (score.points >= def.stars[2]) stars = 3;
    if (usedAuto) stars = Math.min(stars, 1);
  }
  return { goals, passed, stars, points: score.points, usedAuto };
}

/* ---------------- Bestenliste ---------------- */
const HS_KEY = 'stellwerksim.highscores';
export function loadHighscores() {
  try { return JSON.parse(localStorage.getItem(HS_KEY) || '{}'); } catch { return {}; }
}
export function saveHighscore(id, result) {
  const all = loadHighscores();
  const prev = all[id];
  const better = !prev || result.stars > prev.stars || (result.stars === prev.stars && result.points > prev.points);
  if (better) {
    all[id] = { points: result.points, stars: result.stars, date: new Date().toISOString() };
    try { localStorage.setItem(HS_KEY, JSON.stringify(all)); } catch { /* egal */ }
  }
  return better;
}
