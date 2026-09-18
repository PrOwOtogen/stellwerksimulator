/* ===================================================================
 * events.js – Zufällige Ereignisse und Störungsverwaltung
 * ================================================================= */
import { cellType, entries, parseKey, cellAt, crossings, platformCells, platforms } from './model.js';
import { workingPossible } from './interlocking.js';
import { makeTrain, hhmm, CELL_M } from './sim.js';

/** deterministischer Zufallsgenerator (Seed → reproduzierbare Läufe) */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr.length ? arr[Math.floor(rng() * arr.length)] : null;
const between = (rng, a, b) => a + rng() * (b - a);

export const EVENT_TYPES = [
  {
    id: 'weiche', name: 'Weichenstörung', weight: 3,
    desc: 'Eine Weiche lässt sich nicht mehr umstellen und muss entstört werden.',
    fire(sim, rng) {
      const cands = Object.values(sim.layout.cells)
        .filter(c => cellType(c) === 'switch' && !sim.faultySwitches.has(c.x + ',' + c.y) && !sim.lockedCells.has(c.x + ',' + c.y));
      const c = pick(rng, cands); if (!c) return null;
      const k = c.x + ',' + c.y;
      sim.faultySwitches.add(k);
      return { type: 'weiche', target: k, title: `Weiche ${k} gestört`,
        text: 'Weiche lässt sich nicht umstellen.', repairSec: Math.round(between(rng, 120, 420)) };
    },
    clear(sim, f) { sim.faultySwitches.delete(f.target); }
  },
  {
    id: 'signal', name: 'Signalstörung', weight: 3,
    desc: 'Ein Signal bleibt in Haltstellung. Vorbeifahrt nur mit Ersatzsignal (Shift + Klick).',
    fire(sim, rng) {
      const cands = Object.values(sim.layout.signals).filter(s => !sim.faultySignals.has(s.id));
      const s = pick(rng, cands); if (!s) return null;
      sim.faultySignals.add(s.id);
      return { type: 'signal', target: s.id, title: `Signal ${s.name} gestört`,
        text: 'Signal zeigt keinen Fahrtbegriff mehr. Ersatzsignal mit Shift+Klick.', repairSec: Math.round(between(rng, 180, 600)) };
    },
    clear(sim, f) { sim.faultySignals.delete(f.target); }
  },
  {
    id: 'gleis', name: 'Gleissperrung', weight: 2,
    desc: 'Ein Gleisabschnitt wird gesperrt (z. B. Oberleitungsschaden) und ist nicht befahrbar.',
    fire(sim, rng) {
      const cands = Object.values(sim.layout.cells)
        .filter(c => c.ends.length === 2 && !c.entry && !sim.lockedCells.has(c.x + ',' + c.y));
      const c = pick(rng, cands); if (!c) return null;
      const k = c.x + ',' + c.y;
      sim.blockedCells.add(k);
      return { type: 'gleis', target: k, title: `Gleissperrung ${k}`,
        text: 'Abschnitt gesperrt, keine Fahrstraße möglich.', repairSec: Math.round(between(rng, 300, 900)) };
    },
    clear(sim, f) { sim.blockedCells.delete(f.target); }
  },
  {
    id: 'einfahrtversp', name: 'Verspätete Einfahrt', weight: 4,
    desc: 'Ein noch nicht eingefahrener Zug erreicht das Stellwerk später als geplant.',
    fire(sim, rng) {
      const cands = sim.trains.filter(t => t.state === 'pending');
      const t = pick(rng, cands); if (!t) return null;
      const extra = Math.round(between(rng, 120, 900));
      t.plannedEntry += extra;
      return { type: 'einfahrtversp', target: t.id, title: `${t.nr} verspätet`,
        text: `Einfahrt erst um ${hhmm(t.plannedEntry)} (+${Math.round(extra / 60)} min).`, repairSec: null, autoSec: 60 };
    }
  },
  {
    id: 'tuer', name: 'Türstörung', weight: 3,
    desc: 'Eine Tür schließt nicht – die Haltezeit verlängert sich.',
    fire(sim, rng) {
      const cands = sim.trains.filter(t => ['run', 'hold', 'dwell'].includes(t.state));
      const t = pick(rng, cands); if (!t) return null;
      const extra = Math.round(between(rng, 60, 300));
      t.extraDwell += extra;
      if (t.state === 'dwell') t.departAt += extra;
      return { type: 'tuer', target: t.id, title: `${t.nr}: Türstörung`,
        text: `Haltezeit +${Math.round(extra / 60)} min.`, repairSec: null, autoSec: 120 };
    }
  },
  {
    id: 'fahrzeug', name: 'Fahrzeugstörung', weight: 2,
    desc: 'Ein Zug kann nur noch langsam fahren.',
    fire(sim, rng) {
      const cands = sim.trains.filter(t => ['run', 'hold', 'dwell'].includes(t.state) && !t.vmaxFault);
      const t = pick(rng, cands); if (!t) return null;
      t.vmaxFault = Math.round(between(rng, 40, 70));
      return { type: 'fahrzeug', target: t.id, title: `${t.nr}: Fahrzeugstörung`,
        text: `Höchstgeschwindigkeit nur noch ${t.vmaxFault} km/h.`, repairSec: Math.round(between(rng, 300, 1200)) };
    },
    clear(sim, f) { const t = sim.trains.find(x => x.id === f.target); if (t) t.vmaxFault = null; }
  },
  {
    id: 'notarzt', name: 'Notarzteinsatz', weight: 1,
    desc: 'Ein Fahrgast wird im Zug ärztlich versorgt – längerer Halt.',
    fire(sim, rng) {
      const cands = sim.trains.filter(t => t.state === 'dwell');
      const t = pick(rng, cands); if (!t) return null;
      const extra = Math.round(between(rng, 300, 900));
      t.departAt += extra;
      return { type: 'notarzt', target: t.id, title: `${t.nr}: Notarzteinsatz`,
        text: `Abfahrt erst ${hhmm(t.departAt)}.`, repairSec: null, autoSec: extra };
    }
  },
  {
    id: 'personen', name: 'Personen im Gleis', weight: 2,
    desc: 'Vorübergehend gilt im gesamten Bereich Langsamfahrt.',
    fire(sim, rng) {
      if (sim.faults.some(f => f.type === 'personen')) return null;
      sim.globalSpeedLimit = Math.min(sim.globalSpeedLimit || 999, 40);
      return { type: 'personen', target: null, title: 'Personen im Gleis',
        text: 'Langsamfahrt 40 km/h im gesamten Stellbereich.', repairSec: Math.round(between(rng, 240, 720)) };
    },
    clear(sim, f) { recomputeSpeedLimit(sim, f); }
  },
  {
    id: 'wetter', name: 'Unwetter', weight: 1,
    desc: 'Sturm oder Starkschnee – Geschwindigkeitsbeschränkung 80 km/h.',
    fire(sim, rng) {
      if (sim.faults.some(f => f.type === 'wetter')) return null;
      sim.globalSpeedLimit = Math.min(sim.globalSpeedLimit || 999, 80);
      return { type: 'wetter', target: null, title: 'Unwetter',
        text: 'Geschwindigkeitsbeschränkung 80 km/h.', repairSec: Math.round(between(rng, 900, 2400)) };
    },
    clear(sim, f) { recomputeSpeedLimit(sim, f); }
  },
  {
    id: 'sonderzug', name: 'Sonderzug / Umleiter', weight: 2,
    desc: 'Ein außerplanmäßiger Zug wird angemeldet und muss eingefädelt werden.',
    fire(sim, rng) {
      const es = entries(sim.layout);
      if (es.length < 2) return null;
      // nur Relationen, die ohne Fahrtrichtungswechsel befahrbar sind
      const rels = [];
      for (const a of es) for (const b of es)
        if (a.name !== b.name && workingPossible(sim.layout, a.cell, null, b.cell)) rels.push([a, b]);
      const rel = pick(rng, rels);
      if (!rel) return null;
      const [a, b] = rel;
      const nr = (rng() < 0.5 ? 'X' : 'G') + Math.floor(between(rng, 70000, 99999));
      const row = { nr, gattung: rng() < 0.5 ? 'Güterzug' : 'Sonderzug',
        entry: a.name, exit: b.name, entryTime: sim.time + Math.round(between(rng, 120, 420)),
        vmax: 90, length: 5, stops: [] };
      sim.trains.push(makeTrain(row, sim.trains.length + 1));
      return { type: 'sonderzug', target: nr, title: `Sonderzug ${nr}`,
        text: `${row.gattung} ${a.name} → ${b.name}, Einfahrt ca. ${hhmm(row.entryTime)}.`, repairSec: null, autoSec: 300 };
    }
  },
  {
    id: 'bü', name: 'Bahnübergangsstörung', weight: 2,
    desc: 'Ein Bahnübergang lässt sich nicht mehr schließen; Fahrten sind erst nach Entstörung möglich.',
    fire(sim, rng) {
      const cands = [...sim.crossingState.values()].filter(c => !c.fault);
      const bü = pick(rng, cands); if (!bü) return null;
      bü.fault = true;
      if (bü.state !== 'closed') { bü.state = 'open'; bü.readyAt = null; }
      return { type: 'bü', target: bü.name, title: `Bahnübergang ${bü.name} gestört`,
        text: 'Schranken schließen nicht – Fahrstraßen über den Übergang bleiben gesperrt.',
        repairSec: Math.round(between(rng, 300, 900)) };
    },
    clear(sim, f) { const b = sim.crossingState.get(f.target); if (b) b.fault = false; }
  },
  {
    id: 'achszaehler', name: 'Gleisfreimeldung gestört', weight: 2,
    desc: 'Ein Abschnitt meldet dauerhaft „besetzt"; er muss in Grundstellung gebracht werden.',
    fire(sim, rng) {
      const cands = Object.values(sim.layout.cells)
        .filter(c => c.ends.length === 2 && !c.entry && !sim.lockedCells.has(c.x + ',' + c.y));
      const c = pick(rng, cands); if (!c) return null;
      const k = c.x + ',' + c.y;
      sim.blockedCells.add(k);
      return { type: 'achszaehler', target: k, title: `Gleisfreimeldung ${k} gestört`,
        text: 'Abschnitt meldet Falschbelegung – Achszähler-Grundstellung nötig.',
        repairSec: Math.round(between(rng, 120, 420)) };
    },
    clear(sim, f) { sim.blockedCells.delete(f.target); }
  },
  {
    id: 'stellwerk', name: 'Stellwerksstörung', weight: 1,
    desc: 'Für einige Minuten lassen sich überhaupt keine Fahrstraßen mehr einstellen.',
    fire(sim, rng) {
      const dur = Math.round(between(rng, 180, 600));
      sim.interlockingFault = sim.time + dur;
      return { type: 'stellwerk', target: null, title: 'Stellwerksstörung',
        text: `Bedienung gestört, voraussichtlich ${Math.round(dur / 60)} min.`,
        repairSec: null, autoSec: dur };
    },
    clear(sim) { sim.interlockingFault = null; }
  },
  {
    id: 'oberleitung', name: 'Oberleitungsschaden', weight: 1,
    desc: 'Ein Gleisabschnitt ist längere Zeit nicht befahrbar.',
    fire(sim, rng) {
      const cands = Object.values(sim.layout.cells)
        .filter(c => c.ends.length === 2 && !c.entry && !sim.lockedCells.has(c.x + ',' + c.y));
      const c = pick(rng, cands); if (!c) return null;
      const k = c.x + ',' + c.y;
      sim.blockedCells.add(k);
      return { type: 'oberleitung', target: k, title: `Fahrleitungsschaden ${k}`,
        text: 'Abschnitt gesperrt, Fahrleitungsmonteur angefordert.',
        repairSec: Math.round(between(rng, 900, 2700)) };
    },
    clear(sim, f) { sim.blockedCells.delete(f.target); }
  },
  {
    id: 'zugausfall', name: 'Zugausfall', weight: 1,
    desc: 'Ein angekündigter Zug fällt aus und entfällt im Fahrplan.',
    fire(sim, rng) {
      const cands = sim.trains.filter(t => t.state === 'pending');
      const t = pick(rng, cands); if (!t) return null;
      t.state = 'done';
      t.record.cancelled = true;
      sim.stats.cancelled++;
      return { type: 'zugausfall', target: t.id, title: `${t.nr} fällt aus`,
        text: `Fahrt ${t.entryName} → ${t.exitName} entfällt.`, repairSec: null, autoSec: 120 };
    }
  },
  {
    id: 'personal', name: 'Personalmangel', weight: 2,
    desc: 'Ein Zug kann erst später bereitgestellt werden, weil das Personal fehlt.',
    fire(sim, rng) {
      const cands = sim.trains.filter(t => t.state === 'pending' || t.state === 'waiting');
      const t = pick(rng, cands); if (!t) return null;
      const extra = Math.round(between(rng, 300, 1200));
      t.plannedEntry += extra;
      if (t.state === 'waiting') t.state = 'pending';
      return { type: 'personal', target: t.id, title: `${t.nr}: fehlendes Personal`,
        text: `Bereitstellung erst ${hhmm(t.plannedEntry)}.`, repairSec: null, autoSec: 180 };
    }
  },
  {
    id: 'rangierauftrag', name: 'Lokfahrt / Rangierauftrag', weight: 2,
    desc: 'Eine langsame Lokleerfahrt wird angemeldet; sie darf auch über Sperrsignale rangiert werden.',
    fire(sim, rng) {
      const es = entries(sim.layout);
      const rels = [];
      for (const a of es) for (const b of es)
        if (a.name !== b.name && workingPossible(sim.layout, a.cell, null, b.cell)) rels.push([a, b]);
      const rel = pick(rng, rels);
      if (!rel) return null;
      const [a, b] = rel;
      const nr = 'Lok ' + Math.floor(between(rng, 100, 999));
      const row = { nr, gattung: 'Lok', kind: 'rangier', entry: a.name, exit: b.name,
        entryTime: sim.time + Math.round(between(rng, 60, 300)), vmax: 40, length: 1, stops: [] };
      sim.trains.push(makeTrain(row, sim.trains.length + 1));
      return { type: 'rangierauftrag', target: nr, title: `Lokfahrt ${nr}`,
        text: `Lokleerfahrt ${a.name} → ${b.name} angemeldet (höchstens 40 km/h).`, repairSec: null, autoSec: 300 };
    }
  }
];

/** Langsamfahrstelle neu bestimmen, wenn mehrere Ereignisse aktiv sind */
function recomputeSpeedLimit(sim, ended) {
  const limits = sim.faults
    .filter(f => f !== ended && (f.type === 'personen' || f.type === 'wetter'))
    .map(f => (f.type === 'personen' ? 40 : 80));
  sim.globalSpeedLimit = limits.length ? Math.min(...limits) : null;
}

export function defaultEventConfig() {
  return {
    enabled: true,
    ratePerHour: 4,
    seed: 1337,
    types: Object.fromEntries(EVENT_TYPES.map(t => [t.id, { enabled: true, weight: t.weight }]))
  };
}

export class EventEngine {
  constructor(sim, config, log) {
    this.sim = sim;
    sim.eventEngine = this;
    this.cfg = config || defaultEventConfig();
    this.log = log;
    this.rng = mulberry32(this.cfg.seed | 0);
    this.nextAt = sim.time + this.interval();
    this.counter = 1;
    this.autoRepair = false;   // im Automatikbetrieb entstört der Rechner selbst
  }
  interval() {
    const rate = Math.max(0.01, this.cfg.ratePerHour);
    // exponentialverteilte Wartezeit → unregelmäßige, realistische Abstände
    return -Math.log(1 - this.rng()) * 3600 / rate;
  }
  reseed() { this.rng = mulberry32(this.cfg.seed | 0); this.nextAt = this.sim.time + this.interval(); }

  update() {
    const sim = this.sim;
    // laufende Störungen abarbeiten
    for (const f of [...sim.faults]) {
      if (f.repairUntil && sim.time >= f.repairUntil) this.clearFault(f, 'entstört');
      else if (f.autoUntil && sim.time >= f.autoUntil) this.clearFault(f, 'erledigt');
    }
    if (this.autoRepair) for (const f of sim.faults) if (f.repairSec && !f.repairing) this.startRepair(f);
    if (!this.cfg.enabled) return;
    if (sim.time >= this.nextAt) {
      this.nextAt = sim.time + this.interval();
      this.fireRandom();
    }
  }

  weightedType() {
    const list = EVENT_TYPES.filter(t => this.cfg.types[t.id]?.enabled);
    const total = list.reduce((s, t) => s + (this.cfg.types[t.id].weight || 0), 0);
    if (total <= 0) return null;
    let r = this.rng() * total;
    for (const t of list) { r -= this.cfg.types[t.id].weight || 0; if (r <= 0) return t; }
    return list[list.length - 1];
  }

  fireRandom(forcedId = null) {
    const type = forcedId ? EVENT_TYPES.find(t => t.id === forcedId) : this.weightedType();
    if (!type) return null;
    const res = type.fire(this.sim, this.rng);
    if (!res) return null;
    const fault = {
      id: 'E' + (this.counter++), ...res, typeDef: type,
      since: this.sim.time,
      repairUntil: null,
      autoUntil: res.autoSec ? this.sim.time + res.autoSec : null,
      repairing: false
    };
    this.sim.faults.push(fault);
    this.sim.stats.faultsTotal++;
    this.log(`⚠ ${fault.title}: ${fault.text}`, 'bad');
    this.sim.addMessage(`${fault.title}: ${fault.text}`, {
      from: 'Störungsmeldung', kind: 'fault', data: { faultId: fault.id },
      actions: fault.repairSec ? [{ key: 'repair', label: 'Entstörung beauftragen' }] : []
    });
    return fault;
  }

  /** Entstörung beauftragen (dauert Zeit) */
  startRepair(fault) {
    if (!fault.repairSec || fault.repairing) return;
    fault.repairing = true;
    fault.repairUntil = this.sim.time + fault.repairSec;
    this.log(`Entstörungsdienst für „${fault.title}" angefordert, fertig ca. ${hhmm(fault.repairUntil)}.`, 'warn');
  }

  clearFault(fault, why = 'behoben') {
    if (fault.typeDef?.clear) fault.typeDef.clear(this.sim, fault);
    this.sim.faults = this.sim.faults.filter(f => f !== fault);
    this.log(`✔ ${fault.title} ${why}.`, 'ok');
  }
}
