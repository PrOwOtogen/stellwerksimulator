/* ===================================================================
 * scoring.js – Punktesystem für den Fahrdienstleiter
 *
 * Punkte gibt es für pünktliche Zugfahrten, sauber gehaltene Anschlüsse
 * und zügige Entstörung; Abzüge für Verspätungen, Halte vor Signalen,
 * Hilfsauflösungen und gestrichene Züge. Im Automatikbetrieb zählen
 * Zugfahrten nur zu einem Viertel.
 * ================================================================= */

export const SCORE_RULES = [
  ['Zugfahrt abgeschlossen', '+40'],
  ['… davon pünktlich (unter 1 min)', '+30'],
  ['… bis zur Pünktlichkeitsgrenze', '+15'],
  ['je Minute über der Pünktlichkeitsgrenze', '−4 (höchstens −60)'],
  ['pünktliche Abfahrt am Bahnsteig', '+10'],
  ['Halt vor einem Halt zeigenden Signal', '−5'],
  ['Zug angenommen (Zugmeldeverfahren)', '+2'],
  ['Entstörung innerhalb von 2 min beauftragt', '+10'],
  ['Störung behoben', '+5'],
  ['Anschluss gehalten', '+8'],
  ['Hilfsauflösung', '−20'],
  ['Ersatzsignal', '−5'],
  ['Zug gestrichen', '−100'],
  ['Automatikbetrieb', 'Zugfahrten zählen ¼']
];

export class ScoreKeeper {
  constructor(sim) {
    this.sim = sim;
    this.points = 0;
    this.entries = [];
    this.listeners = [];
    this.unsub = sim.on((type, data) => this.handle(type, data));
  }
  onChange(fn) { this.listeners.push(fn); }

  add(pts, text) {
    if (!pts) return;
    pts = Math.round(pts);
    this.points += pts;
    this.entries.unshift({ t: this.sim.time, pts, text });
    if (this.entries.length > 200) this.entries.pop();
    for (const fn of this.listeners) fn(pts, text);
  }

  handle(type, d) {
    const limit = this.sim.cfg.punctualLimit ?? 300;
    switch (type) {
      case 'finish': {
        const faktor = d.auto ? 0.25 : 1;
        let pts = 40;
        if (d.delay < 60) pts += 30;
        else if (d.delay < limit) pts += 15;
        else pts -= Math.min(60, Math.round((d.delay - limit) / 60) * 4);
        this.add(pts * faktor, `${d.tr.nr} abgeschlossen (${Math.round(d.delay / 60)} min)`);
        break;
      }
      case 'depart':
        if (d.delay < 60) this.add(10, `${d.tr.nr} pünktlich ab ${d.stop.platform}`);
        break;
      case 'signalStop':
        if (d.signal && d.tr.kind !== 'rangier') this.add(-5, `${d.tr.nr} hält vor ${d.signal.name}`);
        break;
      case 'answered':
        if (d.action === 'accept') this.add(2, 'Zug angenommen');
        if (d.action === 'connection-keep') this.add(8, 'Anschluss gehalten');
        break;
      case 'repairStarted':
        if (this.sim.time - d.since < 120) this.add(10, `schnelle Entstörung: ${d.title}`);
        break;
      case 'faultCleared':
        if (d.fault.repairSec) this.add(5, `${d.fault.title} behoben`);
        break;
      case 'emergencyRelease':
        this.add(-20, `Hilfsauflösung ${d.route || ''}`.trim());
        break;
      case 'substitute':
        this.add(-5, 'Ersatzsignal');
        break;
      case 'cancelled':
        this.add(-100, `${d.tr.nr} gestrichen`);
        break;
    }
  }

  dispose() { this.unsub?.(); }
}
