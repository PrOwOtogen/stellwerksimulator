/* ===================================================================
 * sim.js – Simulationskern: Uhr, Zugfahrten, Fahrdynamik, Bilanz
 * ================================================================= */
import {
  key, parseKey, cellAt, cellType, signalAt, entries, entryByName,
  platformCells, neighbor
} from './model.js';
import { lockRoute, releaseRoute, findRoute, reachAfterStep } from './interlocking.js';

export const CELL_M = 100;        // eine Rasterzelle entspricht 100 m
const ACCEL = 0.7;                // m/s²
const BRAKE = 0.9;                // m/s²
const MIN_DWELL = 30;             // Mindesthaltezeit in Sekunden

export const hhmmss = t => {
  t = Math.floor(((t % 86400) + 86400) % 86400);
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor(t / 60) % 60).padStart(2, '0');
  const s = String(t % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
};
export const hhmm = t => hhmmss(t).slice(0, 5);
export const parseTime = str => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((str || '').trim());
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
};

export class Sim {
  constructor(layout, log = () => {}) {
    this.layout = layout;
    this.log = log;
    this.reset();
  }

  reset() {
    const L = this.layout;
    this.time = L.startTime ?? 6 * 3600;
    this.running = false;
    this.speedFactor = 10;
    this.trains = [];
    this.routes = [];
    this.lockedCells = new Map();   // Zellenschlüssel -> Fahrstraßen-ID
    this.blockedCells = new Set();  // gesperrte Gleise (Störung)
    this.faultySwitches = new Set();
    this.faultySignals = new Set();
    this.signalAspect = new Map();
    this.faults = [];               // aktive Störungen (siehe events.js)
    this.globalSpeedLimit = null;   // km/h, z. B. bei "Personen im Gleis"
    this.autoRoute = false;
    this.stats = { finished: 0, punctual: 0, delaySum: 0, routesSet: 0, maxDelay: 0, cancelled: 0 };
    for (const id in L.signals) this.signalAspect.set(id, 'Hp0');
    let n = 1;
    for (const row of L.timetable || []) this.trains.push(makeTrain(row, n++));
  }

  /* ---------------- Belegung ---------------- */
  occupiedCells(exceptTrain = null) {
    const set = new Set();
    for (const tr of this.trains) {
      if (tr === exceptTrain || !tr.steps.length || tr.state === 'done' || tr.state === 'pending' || tr.state === 'waiting') continue;
      for (const k of trainCells(tr)) set.add(k);
    }
    return set;
  }
  trainAtCell(k) {
    for (const tr of this.trains) if (trainCells(tr).includes(k)) return tr;
    return null;
  }

  /* ---------------- Takt ---------------- */
  tick(realDt) {
    if (!this.running) return;
    const dt = realDt * this.speedFactor;
    this.time += dt;
    for (const tr of this.trains) this.updateTrain(tr, dt);
    if (this.autoRoute) this.autoDispatch();
  }

  /* ---------------- Zugsteuerung ---------------- */
  updateTrain(tr, dt) {
    if (tr.state === 'done') return;

    if (tr.state === 'pending') {
      if (this.time >= tr.plannedEntry) {
        tr.state = 'waiting';
        this.log(`${tr.nr} wartet auf Einfahrt in ${tr.entryName}.`, 'warn');
      }
      return;
    }

    if (tr.state === 'waiting') {
      tr.delay = Math.max(tr.delay, this.time - tr.plannedEntry);
      this.bindRoute(tr);
      return;
    }

    if (tr.state === 'dwell') {
      if (this.time >= tr.departAt) {
        const st = tr.stops[tr.nextStop];
        tr.delay = this.time - st.dep;
        this.log(`${tr.nr} fährt in ${st.platform} ab (${signedMin(tr.delay)}).`, tr.delay > 180 ? 'warn' : 'ok');
        tr.nextStop++;
        tr.state = 'run';
      }
      this.bindRoute(tr);
      return;
    }

    /* --- fahren --- */
    this.bindRoute(tr);
    const authorityEnd = tr.steps.length * CELL_M;
    let stopAt = tr.exiting ? Infinity : authorityEnd;

    // planmäßiger Halt am Bahnsteig
    const ps = this.platformStopPos(tr);
    if (ps !== null && ps < stopAt) stopAt = ps;

    // Sicherheitshalt vor besetztem Gleis
    const obstacle = this.obstaclePos(tr);
    if (obstacle !== null && obstacle < stopAt) stopAt = obstacle;

    const dRest = stopAt - tr.s;
    const vLimit = this.speedLimitFor(tr);
    let vTarget = vLimit / 3.6;
    if (dRest < Infinity) {
      const vBrake = Math.sqrt(Math.max(0, 2 * BRAKE * dRest));
      vTarget = Math.min(vTarget, vBrake);
      if (dRest < 25 && vTarget < 2) vTarget = Math.min(2, Math.max(0.6, dRest / 4)); // Schleichfahrt
    }
    if (tr.v < vTarget) tr.v = Math.min(vTarget, tr.v + ACCEL * dt);
    else tr.v = Math.max(vTarget, tr.v - BRAKE * dt * 1.2);
    if (tr.v < 0.15) tr.v = 0;

    const before = tr.s;
    tr.s = Math.min(stopAt, tr.s + tr.v * dt);
    if (stopAt - tr.s < 0.4) { tr.s = stopAt === Infinity ? tr.s : stopAt; tr.v = 0; }
    if (tr.s > before) this.onAdvance(tr, before);

    // Bahnsteighalt erreicht?
    if (ps !== null && tr.s >= ps - 0.6 && tr.v === 0) this.arriveAtStop(tr);

    // Stillstand vor Halt zeigendem Signal
    if (tr.v === 0 && !tr.exiting && tr.s >= authorityEnd - 0.5) {
      tr.state = 'hold';
      tr.waitSignal = this.signalAtAuthorityEnd(tr);
    } else if (tr.v > 0) {
      tr.state = 'run';
      tr.waitSignal = null;
    }

    // Zug hat das Stellwerk verlassen
    if (tr.exiting && tr.s - tr.lenM > authorityEnd) this.finishTrain(tr);
  }

  /** Fortschritt: Auflösung hinter dem Zug, Haltfall der Signale */
  onAdvance(tr, before) {
    const frontIdx = Math.min(tr.steps.length - 1, Math.floor(tr.s / CELL_M));
    const beforeIdx = Math.min(tr.steps.length - 1, Math.floor(before / CELL_M));
    // Haltfall: Signal fällt zurück, sobald der Zug es überfahren hat
    for (let i = beforeIdx; i <= frontIdx; i++) {
      const r = tr.stepRoutes[i];
      if (r && !r.passed && i === tr.routeStart.get(r.id)) {
        r.passed = true;
        if (r.signal) this.signalAspect.set(r.signal.id, 'Hp0');
      }
    }
    // Fahrstraßenauflösung Zelle für Zelle hinter dem Zugschluss
    const tailIdx = Math.floor((tr.s - tr.lenM) / CELL_M);
    while (tr.released < tailIdx && tr.released < tr.steps.length) {
      const i = tr.released;
      const r = tr.stepRoutes[i];
      const k = tr.steps[i].k;
      if (r && this.lockedCells.get(k) === r.id) this.lockedCells.delete(k);
      tr.released++;
    }
    for (const r of [...this.routes]) {
      if (r.trainId === tr.id && r.steps.every(st => this.lockedCells.get(st.k) !== r.id)) {
        this.routes = this.routes.filter(x => x !== r);
        if (r.signal) this.signalAspect.set(r.signal.id, 'Hp0');
      }
    }
  }

  /** Signal, vor dem der Zug gerade steht */
  signalAtAuthorityEnd(tr) {
    if (!tr.steps.length) return null;
    const last = tr.steps[tr.steps.length - 1];
    if (last.to === null || last.to === undefined) return null;
    const p = parseKey(last.k);
    return signalAt(this.layout, p.x, p.y, last.to);
  }

  /** Haltposition am nächsten planmäßigen Bahnsteig (oder null) */
  platformStopPos(tr) {
    if (tr.nextStop >= tr.stops.length) return null;
    const stop = tr.stops[tr.nextStop];
    const startIdx = Math.max(0, Math.floor(tr.s / CELL_M));
    let first = -1;
    for (let i = startIdx; i < tr.steps.length; i++) {
      const p = parseKey(tr.steps[i].k);
      const c = cellAt(this.layout, p.x, p.y);
      if (c && c.platform === stop.platform) { first = i; break; }
    }
    if (first < 0) return null;
    let last = first;
    while (last + 1 < tr.steps.length) {
      const p = parseKey(tr.steps[last + 1].k);
      const c = cellAt(this.layout, p.x, p.y);
      if (!c || c.platform !== stop.platform) break;
      last++;
    }
    return (last + 1) * CELL_M;   // Zugspitze am Bahnsteigende
  }

  /** Position eines belegten Gleises vor dem Zug (Sicherheitsabstand) */
  obstaclePos(tr) {
    const occ = this.occupiedCells(tr);
    const startIdx = Math.max(0, Math.floor(tr.s / CELL_M));
    for (let i = startIdx; i < tr.steps.length; i++) {
      if (occ.has(tr.steps[i].k)) return Math.max(tr.s, i * CELL_M - 10);
    }
    return null;
  }

  speedLimitFor(tr) {
    let v = tr.vmax;
    if (this.globalSpeedLimit) v = Math.min(v, this.globalSpeedLimit);
    if (tr.vmaxFault) v = Math.min(v, tr.vmaxFault);
    const i = Math.min(tr.steps.length - 1, Math.max(0, Math.floor(tr.s / CELL_M)));
    for (let j = i; j < Math.min(tr.steps.length, i + 3); j++) {
      const p = parseKey(tr.steps[j].k);
      const c = cellAt(this.layout, p.x, p.y);
      if (c && c.vmax) v = Math.min(v, c.vmax);
      const r = tr.stepRoutes[j];
      if (r && r.substitute) v = Math.min(v, 40);   // Fahrt auf Ersatzsignal
      if (r && r.dest && r.dest.type === 'signal' && j === tr.steps.length - 1) v = Math.min(v, 90);
    }
    return Math.max(10, v);
  }

  arriveAtStop(tr) {
    const st = tr.stops[tr.nextStop];
    if (tr.state === 'dwell') return;
    tr.state = 'dwell';
    tr.v = 0;
    const arrDelay = this.time - st.arr;
    tr.delay = arrDelay;
    this.stats.maxDelay = Math.max(this.stats.maxDelay, arrDelay);
    let dwell = Math.max(MIN_DWELL, st.dep - this.time);
    if (tr.extraDwell) { dwell += tr.extraDwell; tr.extraDwell = 0; }
    tr.departAt = this.time + dwell;
    this.log(`${tr.nr} hält in ${st.platform} (${signedMin(arrDelay)}), Abfahrt ${hhmm(tr.departAt)}.`,
      arrDelay > 300 ? 'bad' : arrDelay > 60 ? 'warn' : 'ok');
  }

  finishTrain(tr) {
    tr.state = 'done';
    tr.v = 0;
    for (let i = tr.released; i < tr.steps.length; i++) {
      const r = tr.stepRoutes[i];
      if (r && this.lockedCells.get(tr.steps[i].k) === r.id) this.lockedCells.delete(tr.steps[i].k);
    }
    this.routes = this.routes.filter(r => r.trainId !== tr.id);
    this.stats.finished++;
    this.stats.delaySum += tr.delay;
    if (tr.delay < 300) this.stats.punctual++;
    this.log(`${tr.nr} hat das Stellwerk über ${tr.exitName} verlassen (${signedMin(tr.delay)}).`,
      tr.delay < 300 ? 'ok' : 'warn');
  }

  /* ---------------- Fahrstraßen an Züge binden ---------------- */
  bindRoute(tr) {
    if (tr.state === 'done') return;
    if (tr.state === 'waiting') {
      const cands = this.routes.filter(r => !r.trainId && r.entryName && r.entryName === tr.entryName);
      const r = cands.find(r => r.forTrainId === tr.id) || cands[0];
      if (!r) return;
      r.trainId = tr.id;
      tr.steps = r.steps.slice();
      tr.stepRoutes = r.steps.map(() => r);
      tr.routeStart.set(r.id, 0);
      tr.s = 0; tr.v = 0; tr.released = 0;
      tr.state = 'run';
      tr.exiting = r.dest.type === 'exit';
      tr.actualEntry = this.time;
      tr.delay = this.time - tr.plannedEntry;
      this.log(`${tr.nr} fährt aus ${tr.entryName} ein (${signedMin(tr.delay)}).`, 'ok');
      return;
    }
    // Anschlussfahrstraße am Signal vor dem Zug
    const sig = this.signalAtAuthorityEnd(tr);
    if (!sig) return;
    const r = this.routes.find(r => !r.trainId && r.signal && r.signal.id === sig.id);
    if (!r) return;
    r.trainId = tr.id;
    tr.routeStart.set(r.id, tr.steps.length);
    tr.steps = tr.steps.concat(r.steps);
    tr.stepRoutes = tr.stepRoutes.concat(r.steps.map(() => r));
    tr.exiting = r.dest.type === 'exit';
    if (tr.state === 'hold') tr.state = 'run';
  }

  /* ---------------- Automatikbetrieb ---------------- */
  autoDispatch() {
    if (this.time - (this._lastAuto || 0) < 3) return;   // nicht in jedem Frame
    this._lastAuto = this.time;
    for (const tr of this.trains) {
      if (tr.state === 'done' || tr.state === 'pending') continue;
      // während der Fahrt erst kurz vor Ende der Fahrerlaubnis disponieren
      if (tr.state === 'run' && tr.v > 0.2) {
        const rest = tr.steps.length * CELL_M - tr.s;
        if (tr.exiting || rest > 900) continue;
      }
      if (this.routes.some(r => r.trainId === tr.id && !r.passed)) continue;
      let start;
      if (tr.state === 'waiting') {
        const e = entryByName(this.layout, tr.entryName);
        if (!e) continue;
        if (this.routes.some(r => !r.trainId && r.entryName === tr.entryName)) continue;
        start = { type: 'entry', cell: e.cell };
      } else {
        const sig = this.signalAtAuthorityEnd(tr);
        if (!sig) continue;
        if (this.routes.some(r => r.signal && r.signal.id === sig.id)) continue;
        start = { type: 'signal', sig };
      }
      const dest = this.bestDestination(tr, start);
      if (!dest) {
        tr.noRouteSince = tr.noRouteSince ?? this.time;
        if (!tr.noRouteWarned && this.time - tr.noRouteSince > 900) {
          tr.noRouteWarned = true;
          this.log(`${tr.nr}: seit 15 min kein Fahrweg zum Ziel – Fahrplanrelation prüfen.`, 'bad');
        }
        continue;
      }
      tr.noRouteSince = null; tr.noRouteWarned = false;
      const res = lockRoute(this, start, dest, { substitute: true, forTrain: tr.id });
      if (res.ok) {
        res.route.forTrainId = tr.id;
        this.stats.routesSet++;
        this.log(`Automatik: ${res.route.id} für ${tr.nr} bis ${res.route.destName} gestellt.`);
      }
    }
  }

  /** Zielpunkt eines Zuges: nächster Bahnsteig, sonst Ausfahrt */
  targetCell(tr) {
    const L = this.layout;
    const stop = tr.stops[tr.nextStop];
    if (stop) {
      const cells = platformCells(L, stop.platform);
      if (cells.length) return cells[Math.floor(cells.length / 2)];
    }
    const e = entryByName(L, tr.exitName);
    return e ? e.cell : null;
  }

  /**
   * Fahrstraßenziel für den Automatikbetrieb.
   * Grundsatz der Betriebsführung: ein Zug wird nur in Bewegung gesetzt,
   * wenn er bis zu einem „sicheren Platz" (Bahnsteig oder Ausfahrt) kommt.
   * Dadurch bleibt kein Zug auf freier Strecke stehen und blockiert den
   * Gegenverkehr – Verklemmungen auf eingleisigen Abschnitten entfallen.
   */
  bestDestination(tr, start) {
    const plan = this.planToSafe(tr, start, new Set(), 3);
    return plan ? plan.dest : null;
  }

  planToSafe(tr, start, extraLocked, depth) {
    if (depth <= 0) return null;
    const L = this.layout;
    const locked = new Map(this.lockedCells);
    for (const k of extraLocked) locked.set(k, 'PLAN');
    const ctx = {
      layout: L, blocked: this.blockedCells, locked,
      occupied: this.occupiedCells(tr), allowOccupied: false
    };
    const target = this.targetCell(tr);
    if (!target) return null;
    const stop = tr.stops[tr.nextStop] || null;
    const targetKeys = stop
      ? new Set(platformCells(L, stop.platform).map(c => key(c.x, c.y)))
      : new Set([key(target.x, target.y)]);

    const cands = [];
    for (const id in L.signals) cands.push({ type: 'signal', sig: L.signals[id] });
    for (const e of entries(L)) if (e.name === tr.exitName) cands.push({ type: 'exit', cell: e.cell });

    const scored = [];
    for (const d of cands) {
      if (d.type === 'signal' && start.type === 'signal' && d.sig.id === start.sig.id) continue;
      const r = findRoute(start, d, ctx);
      if (!r || !r.steps.length) continue;
      const lastStep = r.steps[r.steps.length - 1];
      const last = parseKey(lastStep.k);

      // hält der Fahrweg am nächsten planmäßigen Bahnsteig?
      const serves = stop && r.steps.some(st => {
        const p = parseKey(st.k);
        const c = cellAt(L, p.x, p.y);
        return c && c.platform === stop.platform;
      });
      // führt er wenigstens auf ein Bahnsteiggleis (sicherer Halteplatz)?
      const reachesPlatform = r.steps.some(st => {
        const p = parseKey(st.k);
        const c = cellAt(L, p.x, p.y);
        return c && c.platform;
      });
      // bleibt das Ziel danach erreichbar?
      if (!serves && d.type !== 'exit') {
        const after = reachAfterStep(L, lastStep);
        let ok = false;
        for (const k of targetKeys) if (after.has(k)) { ok = true; break; }
        if (!ok) continue;
      }
      let score = Math.hypot(last.x - target.x, last.y - target.y) * 2 + r.steps.length * 0.05;
      if (serves) score -= 80;
      else if (d.type === 'exit') score -= 80;
      else if (reachesPlatform) score -= 20;
      scored.push({ dest: d, route: r, score, safe: !!(serves || d.type === 'exit' || (!stop && reachesPlatform)) });
    }
    scored.sort((a, b) => a.score - b.score);

    for (const cand of scored.slice(0, 6)) {
      if (cand.safe) return cand;
      // Zwischenziel: nur zulässig, wenn der Anschluss bis zum sicheren Platz frei ist
      const nextStart = { type: 'signal', sig: cand.dest.sig };
      const merged = new Set(extraLocked);
      for (const st of cand.route.steps) merged.add(st.k);
      const cont = this.planToSafe(tr, nextStart, merged, depth - 1);
      if (cont) return cand;
    }
    return null;
  }
}

/* ---------------- Hilfsfunktionen ---------------- */

export function makeTrain(row, idx) {
  const stops = (row.stops || []).map(s => ({ platform: s.platform, arr: s.arr, dep: s.dep }));
  return {
    id: 'T' + idx,
    nr: row.nr || ('Zug ' + idx),
    gattung: row.gattung || 'RB',
    vmax: row.vmax || 120,
    lenM: (row.length || 2) * 100,
    plannedEntry: row.entryTime,
    entryName: row.entry,
    exitName: row.exit,
    stops,
    nextStop: 0,
    state: 'pending',
    steps: [],
    stepRoutes: [],
    routeStart: new Map(),
    s: 0, v: 0, released: 0,
    delay: 0,
    exiting: false,
    extraDwell: 0,
    vmaxFault: null,
    waitSignal: null,
    departAt: 0,
    plan: row
  };
}

/** Zellen, die ein Zug aktuell belegt */
export function trainCells(tr) {
  if (!tr.steps.length || tr.state === 'done' || tr.state === 'pending' || tr.state === 'waiting') return [];
  const out = [];
  const front = Math.min(tr.steps.length - 1, Math.floor(Math.max(0, tr.s - 0.001) / CELL_M));
  const tail = Math.max(0, Math.floor((tr.s - tr.lenM) / CELL_M) + (((tr.s - tr.lenM) % CELL_M === 0) ? 0 : 0));
  for (let i = Math.max(0, tail); i <= front; i++) out.push(tr.steps[i].k);
  return out;
}

export const signedMin = sec => {
  const m = Math.round(sec / 60);
  if (m === 0) return 'pünktlich';
  return m > 0 ? `+${m} min` : `${m} min`;
};
