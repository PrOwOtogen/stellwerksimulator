/* ===================================================================
 * tutorial.js – interaktive Einführung in die Bedienung
 *
 * Jeder Schritt hat einen Text, optional eine markierte Stelle im
 * Gleisbild und eine Bedingung, die erfüllt sein muss, bevor es
 * weitergeht. Reine Info-Schritte werden mit „Weiter" bestätigt.
 * ================================================================= */
import { app, call } from './app.js';
import { $, h, esc } from './dom.js';
import { icon } from './icons.js';
import { demoLayout } from '../demo.js';
import { entryByName } from '../model.js';
import { sound } from '../sound.js';

const sig = name => Object.values(app.layout.signals).find(s => s.name === name);
const at = s => (s ? [{ x: s.x, y: s.y }] : []);
const entryAt = name => { const e = entryByName(app.layout, name); return e ? [{ x: e.cell.x, y: e.cell.y }] : []; };
const tutTrain = () => app.sim.trains.find(t => t.plan?.tutorial);

const STEPS = [
  {
    title: 'Willkommen im Stellwerk',
    text: 'Das ist der Bahnhof Neustadt. Graue Linien sind Gleise, Punkte sind Weichen, die kleinen Lampen Signale, blaue Flächen Bahnsteige. <b>Ziehen</b> verschiebt das Gleisbild, das <b>Mausrad</b> zoomt.',
    info: true
  },
  {
    title: 'Signale',
    text: 'Hauptsignale zeigen <b style="color:#f85149">Halt</b> oder <b style="color:#3fb950">Fahrt</b>. Die Rauten sind Vorsignale – sie kündigen den Begriff des nächsten Hauptsignals an. Markiert ist das Einfahrsignal <b>A</b>.',
    info: true, pulse: () => at(sig('A'))
  },
  {
    title: 'Fahrstraße: Start wählen',
    text: 'Gleich kommt <b>RE 4010</b> aus Richtung West. Klicke auf die markierte <b>Einfahrt West</b>, um sie als Start der Fahrstraße zu wählen.',
    pulse: () => entryAt('West'),
    done: () => app.routeStart?.type === 'entry' && app.routeStart.cell.entry === 'West'
  },
  {
    title: 'Fahrstraße: Ziel wählen',
    text: 'Jetzt das Ziel: das Ausfahrsignal <b>N1</b> am Ende von Gleis 1. Weil Signal A dazwischen liegt, stellt der Simulator automatisch beide Teilfahrstraßen – die <b>Zuglenkung</b>.',
    pulse: () => at(sig('N1')),
    done: () => app.sim.routes.some(r => r.destName === 'N1')
  },
  {
    title: 'Was gerade passiert',
    text: 'Die Fahrstraße wird <b>weiß</b> verschlossen, die Weichen laufen um (gelb), der Bahnübergang schließt. Erst dann zeigt das Signal Fahrt. Im Reiter <b>Stellen</b> rechts steht zu jeder Fahrstraße, worauf sie noch wartet.',
    info: true
  },
  {
    title: 'Betrieb starten',
    text: 'Starte die Uhr mit <b>▶</b> oben (oder der Leertaste). Mit den Knöpfen 1× … 120× regelst du den Zeitraffer.',
    done: () => app.sim.running
  },
  {
    title: 'Der Zug kommt',
    text: 'RE 4010 fährt ein und hält an Gleis 1. Klicke gern auf den Zug – das Fenster zeigt Fahrplan, Geschwindigkeit und Verspätung.',
    done: () => (tutTrain()?.record.stops.length || 0) > 0
  },
  {
    title: 'Ausfahrt per Befehlszeile',
    text: 'Stelle die Ausfahrt über die Tastatur: Tippe unten links in die Befehlszeile <b>N1 Ost</b> und drücke Enter.',
    pulse: () => at(sig('N1')),
    done: () => app.sim.routes.some(r => r.signal?.name === 'N1' && r.destName === 'Ost') || tutTrain()?.exiting
  },
  {
    title: 'Das Kontextmenü',
    text: 'Mit einem <b>Rechtsklick</b> auf ein Signal öffnet sich ein Menü: Fahrstraße auflösen, Selbststellbetrieb, Signal sperren, Ersatzsignal. Probiere es an Signal <b>F</b>.',
    pulse: () => at(sig('F')),
    done: t => t.flags.context
  },
  {
    title: 'Zugfunk',
    text: 'Lokführer und Nachbarstellwerke melden sich im Reiter <b>Funk</b> – die Zahl am Reiter zeigt offene Rückfragen. Beantworte die neue Meldung.',
    enter: () => {
      call('showPane', 'funk');
      app.sim.addMessage('Lokführer RB 8010: Wir stehen bereit, bitte bestätigen Sie den Fahrauftrag.', {
        from: 'RB 8010', kind: 'call', data: { tutorial: true },
        actions: [{ key: 'wait', label: 'Verstanden' }]
      });
    },
    done: () => app.sim.messages.some(m => m.data?.tutorial && m.answered)
  },
  {
    title: 'Störungen',
    text: 'Eine Weiche ist gestört! Öffne den Reiter <b>Störungen</b> und klicke auf <b>Entstören</b>. Der Entstördienst braucht ein paar Minuten.',
    enter: () => { call('showPane', 'stoer'); app.events.fireRandom('weiche'); },
    done: () => app.sim.faults.every(f => f.repairing) || !app.sim.faults.length
  },
  {
    title: 'Geschafft!',
    text: 'Du kennst jetzt die wichtigsten Handgriffe. Für pünktliche Züge, schnelle Entstörung und angenommene Zugmeldungen gibt es Punkte. Weiter geht es mit dem Szenario <b>Erster Dienst</b> – oder spiele hier einfach weiter.',
    info: true, last: true
  }
];

class Tutorial {
  constructor() { this.i = 0; this.flags = {}; this.entered = -1; }
  get step() { return STEPS[this.i]; }
  pulse() { return this.step?.pulse ? this.step.pulse() : null; }
  event(type) { if (type === 'context') this.flags.context = true; }
  update() {
    const st = this.step;
    if (!st) return;
    if (this.entered !== this.i) { this.entered = this.i; st.enter?.(); this.render(); }
    if (!st.info && st.done?.(this)) { sound.chime(); this.next(); }
  }
  next() {
    if (this.i < STEPS.length - 1) { this.i++; this.render(); }
  }
  render() {
    const st = this.step;
    const box = $('#tutorial');
    box.classList.remove('hidden');
    box.innerHTML = '';
    box.append(
      h('div', { class: 'step' }, `Einführung · Schritt ${this.i + 1} von ${STEPS.length}`),
      h('h4', {}, st.title),
      h('p', { html: st.text }));
    const acts = h('div', { class: 'acts' });
    acts.append(h('button', { onclick: () => stopTutorial() }, 'Beenden'));
    if (st.last) {
      acts.append(h('button', { class: 'primary', onclick: () => { stopTutorial(); call('startScenarioById', 'einstieg'); } }, 'Szenario starten'));
    } else if (st.info) {
      acts.append(h('button', { class: 'primary', onclick: () => this.next() }, 'Weiter'));
    } else {
      acts.append(h('span', { class: 'small', html: icon('crosshair', 14) + ' wartet auf deine Aktion …' }));
    }
    box.append(acts, h('div', { class: 'prog', html: `<i style="width:${100 * (this.i + 1) / STEPS.length}%"></i>` }));
  }
}

export function startTutorial() {
  const L = demoLayout();
  L.name = 'Einführung – Bahnhof Neustadt';
  const t0 = L.startTime;
  L.timetable = [
    { nr: 'RE 4010', gattung: 'RE', entry: 'West', entryTime: t0 + 90, exit: 'Ost', vmax: 160, length: 3, accel: 0.95, brake: 1,
      stops: [{ platform: 'Gleis 1', arr: t0 + 330, dep: t0 + 420, connections: [] }], turn: null, tutorial: true },
    { nr: 'RB 8010', gattung: 'RB', entry: 'Nord', entryTime: t0 + 1500, exit: 'Süd', vmax: 120, length: 2, accel: 1.1, brake: 1.1,
      stops: [{ platform: 'Gleis 3', arr: t0 + 1750, dep: t0 + 1840, connections: [] }], turn: null }
  ];
  L.events.enabled = false;
  call('loadLayout', L, 'Einführung');
  call('switchView', 'sim');
  app.tutorial = new Tutorial();
  app.tutorial.render();
}

export function stopTutorial() {
  app.tutorial = null;
  $('#tutorial').classList.add('hidden');
}
