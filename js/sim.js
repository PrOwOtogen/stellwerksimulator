/* ===================================================================
 * sim.js – Simulationskern
 *
 * Uhr, Fahrdynamik, Gleisbelegung, Weichenlauf, Bahnübergänge,
 * planmäßige Halte, Anschlüsse, Wenden, Rangierfahrten, Zugfunk,
 * Automatikbetrieb, Auswertung und Spielstände.
 * ================================================================= */
import {
  key, parseKey, cellAt, cellType, signalAt, entries, entryByName,
  platformCells, neighbor, opp, crossings, switches as allSwitches
} from './model.js';
import {
  lockRoute, releaseRoute, releaseOverlap, findRoute, reachAfterStep,
  routeReady, aspectOf, aspectSpeed, nextMainSignal, pathToSignal, resetRouteCounter
} from './interlocking.js';

export const CELL_M = 100;        // eine Rasterzelle entspricht 100 m
const ACCEL = 0.7;                // m/s²
const BRAKE = 0.9;                // m/s²

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
export const signedMin = sec => {
  const m = Math.round(sec / 60);
  if (m === 0) return 'pünktlich';
  return m > 0 ? `+${m} min` : `${m} min`;
};

export class Sim {
  constructor(layout, log = () => {}) {
    this.layout = layout;
    this.log = log;
    this.reset();
  }

  get cfg() { return this.layout.settings || {}; }

  reset() {
    const L = this.layout;
    resetRouteCounter();
    this.time = L.startTime ?? 6 * 3600;
    this.running = false;
    this.speedFactor = 10;
    this.trains = [];
    this.routes = [];
    this.routeQueue = [];
    this.messages = [];
    this.msgCounter = 1;
    this.lockedCells = new Map();
    this.flankHolds = new Map();      // Zellenschlüssel -> Map(Fahrstraße -> geforderte Lage)
    this.blockedCells = new Set();
    this.faultySwitches = new Set();
    this.faultySignals = new Set();
    this.faults = [];
    this.switchMoves = new Map();     // Zellenschlüssel -> { target, readyAt }
    this.crossingState = new Map();   // Name -> { state, readyAt, requests:Set }
    this.globalSpeedLimit = null;
    this.interlockingFault = null;   // Stellwerksstörung bis Zeitpunkt
    this.autoRoute = false;
    this.occupancyLog = [];           // Gleisbelegung für die Auswertung
    this.stats = {
      finished: 0, punctual: 0, delaySum: 0, routesSet: 0, maxDelay: 0,
      cancelled: 0, signalStops: 0, emergencyReleases: 0, shuntMoves: 0, faultsTotal: 0
    };
    for (const bü of crossings(L)) {
      this.crossingState.set(bü.name, {
        name: bü.name, mode: bü.mode || 'auto', state: 'open', readyAt: null, requests: new Set()
      });
    }
    let n = 1;
    for (const row of L.timetable || []) this.trains.push(makeTrain(row, n++));
  }

  /* ================= Belegung ================= */
  occupiedCells(exceptTrain = null) {
    const set = new Set();
    for (const tr of this.trains) {
      if (tr === exceptTrain) continue;
      for (const k of trainCells(tr)) set.add(k);
    }
    return set;
  }
  trainAtCell(k) {
    for (const tr of this.trains) if (trainCells(tr).includes(k)) return tr;
    return null;
  }

  /* ================= Takt ================= */
  tick(realDt) {
    if (!this.running) return;
    const dt = realDt * this.speedFactor;
    this.time += dt;
    this.updateSwitches();
    this.updateCrossings();
    this.updateRoutes();
    for (const tr of this.trains) this.updateTrain(tr, dt);
    this.updateQueue();
    if (this.autoRoute) this.autoDispatch();
  }

  /* ---- Flankenschutz: festgehaltene Weichenlagen ---- */
  flankHoldState(k) {
    const m = this.flankHolds.get(k);
    if (!m || !m.size) return null;
    return [...m.values()][0];
  }
  addFlankHold(k, routeId, state, forStep = null) {
    if (!this.flankHolds.has(k)) this.flankHolds.set(k, new Map());
    this.flankHolds.get(k).set(routeId, state);
    if (forStep) {
      if (!this._holdOwners) this._holdOwners = [];
      this._holdOwners.push({ k, routeId, forStep });
    }
  }
  /** Flankenschutz entfällt, sobald der geschützte Abschnitt aufgelöst ist */
  releaseFlankHoldsFor(routeId, stepKey) {
    if (!this._holdOwners) return;
    for (const h of this._holdOwners.filter(h => h.routeId === routeId && h.forStep === stepKey)) {
      const m = this.flankHolds.get(h.k);
      if (m) { m.delete(routeId); if (!m.size) this.flankHolds.delete(h.k); }
    }
    this._holdOwners = this._holdOwners.filter(h => !(h.routeId === routeId && h.forStep === stepKey));
  }
  removeFlankHolds(routeId) {
    for (const [k, m] of this.flankHolds) {
      m.delete(routeId);
      if (!m.size) this.flankHolds.delete(k);
    }
    if (this._holdOwners) this._holdOwners = this._holdOwners.filter(h => h.routeId !== routeId);
  }
  /** aktuell festgehaltene Lagen als einfache Karte (für die Wegesuche) */
  holdMap() {
    const out = new Map();
    for (const [k, m] of this.flankHolds) if (m.size) out.set(k, [...m.values()][0]);
    return out;
  }

  /* ================= Weichen ================= */
  moveSwitch(k, state) {
    const p = parseKey(k);
    const c = cellAt(this.layout, p.x, p.y);
    if (!c || (c.sw | 0) === state) return true;
    if (this.faultySwitches.has(k)) return false;
    this.switchMoves.set(k, { target: state, readyAt: this.time + (this.cfg.switchTime ?? 6) });
    return true;
  }
  updateSwitches() {
    for (const [k, mv] of [...this.switchMoves]) {
      if (this.time < mv.readyAt) continue;
      const p = parseKey(k);
      const c = cellAt(this.layout, p.x, p.y);
      if (c) c.sw = mv.target;
      this.switchMoves.delete(k);
    }
  }
  /** Weiche von Hand umstellen */
  toggleSwitch(k) {
    const p = parseKey(k);
    const c = cellAt(this.layout, p.x, p.y);
    if (!c) return { ok: false, reason: 'Keine Weiche.' };
    if (this.lockedCells.has(k)) return { ok: false, reason: 'Weiche ist in einer Fahrstraße verschlossen.' };
    if (this.flankHoldState(k) !== null) return { ok: false, reason: 'Weiche ist als Flankenschutz festgelegt.' };
    if (this.faultySwitches.has(k)) return { ok: false, reason: 'Weiche ist gestört.' };
    if (this.occupiedCells().has(k)) return { ok: false, reason: 'Weiche ist besetzt.' };
    if (this.switchMoves.has(k)) return { ok: false, reason: 'Weiche läuft bereits um.' };
    this.moveSwitch(k, (c.sw | 0) ? 0 : 1);
    return { ok: true };
  }

  /* ================= Bahnübergänge ================= */
  requestCrossing(name, routeId) {
    const st = this.crossingState.get(name);
    if (!st) return;
    st.requests.add(routeId);
    if (st.state !== 'open') return;
    if (st.mode === 'auto' || this.autoRoute) return this.closeCrossing(name);
    if (st.fault) {
      this.addMessage(`${name} ist gestört – Fahrstraße wartet. Übergang muss gesichert werden.`,
        { from: 'Bahnübergang', kind: 'fault' });
      return;
    }
    if (!st.askedAt || this.time - st.askedAt > 120) {
      st.askedAt = this.time;
      this.addMessage(`${name} (handbedient) für eine Fahrstraße schließen?`, {
        from: 'Bahnübergang', kind: 'call', data: { crossing: name },
        actions: [{ key: 'crossing-close', label: 'Schranken schließen' }]
      });
    }
  }
  releaseCrossing(name, routeId) {
    const st = this.crossingState.get(name);
    if (!st) return;
    st.requests.delete(routeId);
    if (st.requests.size) return;
    if (st.mode === 'auto' || this.autoRoute) return this.openCrossing(name);
    if (st.state === 'closed') {
      this.addMessage(`${name}: keine Fahrstraße mehr, Schranken können geöffnet werden.`, {
        from: 'Bahnübergang', kind: 'call', data: { crossing: name },
        actions: [{ key: 'crossing-open', label: 'Schranken öffnen' }]
      });
    }
  }
  closeCrossing(name) {
    const st = this.crossingState.get(name);
    if (!st || st.fault) return;
    if (st.state === 'closed' || st.state === 'closing') return;
    st.state = 'closing';
    st.readyAt = this.time + (this.cfg.crossingCloseSec ?? 25);
  }
  openCrossing(name) {
    const st = this.crossingState.get(name);
    if (!st) return;
    st.state = 'open'; st.readyAt = null;
  }
  updateCrossings() {
    for (const st of this.crossingState.values()) {
      if (st.state === 'closing' && this.time >= st.readyAt) {
        st.state = 'closed'; st.readyAt = null;
      }
    }
  }

  /* ================= Fahrstraßen ================= */
  /** Fahrstraße in den Fahrstraßenspeicher legen */
  queueRoute(start, dest, opts = {}) {
    this.routeQueue.push({ start, dest, opts, since: this.time, id: 'Q' + (this.routeQueue.length + 1) });
  }
  updateQueue() {
    if (!this.routeQueue.length) return;
    if (this.time - (this._lastQueue || 0) < 2) return;
    this._lastQueue = this.time;
    for (const q of [...this.routeQueue]) {
      const res = lockRoute(this, q.start, q.dest, q.opts);
      if (res.ok) {
        this.routeQueue = this.routeQueue.filter(x => x !== q);
        this.stats.routesSet++;
        this.log(`Fahrstraßenspeicher: ${res.route.id} nachträglich eingestellt.`, 'ok');
      } else if (this.time - q.since > 3600) {
        this.routeQueue = this.routeQueue.filter(x => x !== q);
        this.log('Gespeicherte Fahrstraße verworfen (seit einer Stunde nicht einstellbar).', 'warn');
      }
    }
  }

  updateRoutes() {
    for (const r of [...this.routes]) {
      // Hilfsauflösung mit Wartezeit
      if (r.releaseAt && this.time >= r.releaseAt) {
        this.freeTrainAuthority(r);
        releaseRoute(this, r);
        this.log(`Fahrstraße ${r.id} hilfsweise aufgelöst.`, 'warn');
        continue;
      }
      // Durchrutschweg auflösen, wenn der Zug steht
      if (!r.overlapReleased && r.trainId) {
        const tr = this.trains.find(t => t.id === r.trainId);
        if (tr && tr.v === 0 && tr.state !== 'run') {
          tr.standingSince = tr.standingSince ?? this.time;
          if (this.time - tr.standingSince > (this.cfg.overlapReleaseSec ?? 60)) {
            releaseOverlap(this, r);
            this.log(`Durchrutschweg der Fahrstraße ${r.id} aufgelöst.`);
          }
        }
      }
    }
    // Selbststellbetrieb
    if (this.time - (this._lastSelfSet || 0) > 5) {
      this._lastSelfSet = this.time;
      for (const id in this.layout.signals) {
        const sig = this.layout.signals[id];
        if (!sig.selfSet || !sig.lastDest) continue;
        if (this.routes.some(r => r.signal && r.signal.id === sig.id)) continue;
        const tr = this.trains.find(t => t.state === 'hold' && t.waitSignal && t.waitSignal.id === sig.id);
        if (!tr) continue;
        const dest = this.destFromRef(sig.lastDest);
        if (!dest) continue;
        const res = lockRoute(this, { type: 'signal', sig }, dest, {});
        if (res.ok) {
          this.stats.routesSet++;
          this.log(`Selbststellbetrieb: ${res.route.id} ab ${sig.name} eingestellt.`);
        }
      }
    }
  }

  /** Zielreferenz {type,id|k} in ein Zielobjekt auflösen */
  destFromRef(ref) {
    if (!ref) return null;
    if (ref.type === 'signal') {
      const s = this.layout.signals[ref.id];
      return s ? { type: 'signal', sig: s } : null;
    }
    const p = parseKey(ref.k);
    const c = cellAt(this.layout, p.x, p.y);
    return c ? { type: ref.type, cell: c } : null;
  }
  static refOfDest(dest) {
    return dest.type === 'signal'
      ? { type: 'signal', id: dest.sig.id }
      : { type: dest.type, k: key(dest.cell.x, dest.cell.y) };
  }

  /** Fahrerlaubnis eines Zuges auf eine aufgelöste Fahrstraße zurücknehmen */
  freeTrainAuthority(route) {
    const tr = this.trains.find(t => t.id === route.trainId);
    if (!tr) return;
    const front = Math.floor(tr.s / CELL_M);
    let cut = tr.steps.length;
    for (let i = front + 1; i < tr.steps.length; i++) {
      if (tr.stepRoutes[i] === route) { cut = i; break; }
    }
    tr.steps = tr.steps.slice(0, cut);
    tr.stepRoutes = tr.stepRoutes.slice(0, cut);
    tr.exiting = false;
  }

  /* ================= Meldungen / Zugfunk ================= */
  addMessage(text, opts = {}) {
    const m = {
      id: 'M' + (this.msgCounter++), time: this.time, text,
      from: opts.from || 'Betrieb', kind: opts.kind || 'info',
      actions: opts.actions || [], data: opts.data || {}, answered: false
    };
    this.messages.unshift(m);
    while (this.messages.length > 60) this.messages.pop();
    return m;
  }
  answerMessage(id, actionKey) {
    const m = this.messages.find(x => x.id === id);
    if (!m || m.answered) return;
    m.answered = true;
    m.answer = actionKey;
    const tr = m.data.trainId ? this.trains.find(t => t.id === m.data.trainId) : null;
    switch (actionKey) {
      case 'zs1': {
        const sig = m.data.signalId ? this.layout.signals[m.data.signalId] : null;
        if (!sig) break;
        const next = nextMainSignal(this.layout, sig.x, sig.y, sig.dir);
        const dest = next ? { type: 'signal', sig: next } : this.exitDestFor(tr);
        if (!dest) { this.log('Kein Ziel für die Vorbeifahrt gefunden.', 'warn'); break; }
        const res = lockRoute(this, { type: 'signal', sig }, dest, { substitute: true });
        if (res.ok) { this.stats.routesSet++; this.log(`Ersatzsignal an ${sig.name} erteilt.`, 'warn'); }
        else this.log(`Ersatzsignal nicht möglich: ${res.reason}`, 'bad');
        break;
      }
      case 'wait':
        if (tr) tr.askedAt = this.time;
        break;
      case 'connection-keep':
        if (tr) { tr.waitForConnection = true; this.log(`${tr.nr} wartet auf Anschluss.`, 'warn'); }
        break;
      case 'connection-drop':
        if (tr) {
          tr.waitForConnection = false;
          tr.dropConnections = true;
          if (tr.state === 'dwell') tr.departAt = Math.min(tr.departAt, this.time + 20);
          this.log(`${tr.nr}: Anschluss aufgegeben.`, 'warn');
        }
        break;
      case 'crossing-close':
        this.closeCrossing(m.data.crossing);
        this.log(`${m.data.crossing}: Schranken werden geschlossen.`);
        break;
      case 'crossing-open':
        this.openCrossing(m.data.crossing);
        this.log(`${m.data.crossing}: Schranken geöffnet.`);
        break;
      case 'repair': {
        const f = this.faults.find(x => x.id === m.data.faultId);
        if (f && this.eventEngine) this.eventEngine.startRepair(f);
        break;
      }
    }
  }
  exitDestFor(tr) {
    if (!tr) return null;
    const e = entryByName(this.layout, tr.exitName);
    return e ? { type: 'exit', cell: e.cell } : null;
  }

  /* ================= Zugsteuerung ================= */
  updateTrain(tr, dt) {
    if (tr.state === 'done') return;

    if (tr.state === 'pending') {
      if (this.time >= tr.plannedEntry) {
        tr.state = 'waiting';
        this.log(`${tr.nr} wartet auf Einfahrt in ${tr.entryName}.`, 'warn');
        this.addMessage(`${tr.nr} (${tr.gattung}) steht zur Einfahrt in ${tr.entryName} bereit.`, { from: tr.nr, kind: 'train' });
      }
      return;
    }

    if (tr.state === 'waiting') {
      tr.delay = Math.max(tr.delay, this.time - tr.plannedEntry);
      this.bindRoute(tr);
      return;
    }

    if (tr.state === 'dwell') {
      this.updateDwell(tr);
      this.bindRoute(tr);
      return;
    }

    if (tr.state === 'turning') {     // Wendezeit läuft
      if (this.time >= tr.turnReadyAt) this.finishTurn(tr);
      return;
    }

    /* --- fahren --- */
    this.bindRoute(tr);
    const authorityEnd = tr.steps.length * CELL_M;
    let stopAt = tr.exiting ? Infinity : authorityEnd;

    const ps = this.platformStopPos(tr);
    if (ps !== null && ps < stopAt) stopAt = ps;
    const obstacle = this.obstaclePos(tr);
    if (obstacle !== null && obstacle < stopAt) stopAt = obstacle;

    const dRest = stopAt - tr.s;
    const vLimit = this.speedLimitFor(tr);
    let vTarget = vLimit / 3.6;
    if (dRest < Infinity) {
      const vBrake = Math.sqrt(Math.max(0, 2 * BRAKE * dRest));
      vTarget = Math.min(vTarget, vBrake);
      if (dRest < 25 && vTarget < 2) vTarget = Math.min(2, Math.max(0.6, dRest / 4));
    }
    if (tr.v < vTarget) tr.v = Math.min(vTarget, tr.v + ACCEL * dt);
    else tr.v = Math.max(vTarget, tr.v - BRAKE * dt * 1.2);
    if (tr.v < 0.15) tr.v = 0;
    tr.vMaxSeen = Math.max(tr.vMaxSeen || 0, tr.v * 3.6);

    const before = tr.s;
    tr.s = Math.min(stopAt, tr.s + tr.v * dt);
    if (stopAt !== Infinity && stopAt - tr.s < 0.4) { tr.s = stopAt; tr.v = 0; }
    if (tr.s > before) { this.onAdvance(tr, before); tr.standingSince = null; }

    if (ps !== null && tr.s >= ps - 0.6 && tr.v === 0) this.arriveAtStop(tr);

    if (tr.v === 0 && !tr.exiting && tr.s >= authorityEnd - 0.5) {
      if (tr.state !== 'hold') {
        tr.state = 'hold';
        tr.holdSince = this.time;
        this.stats.signalStops++;
      }
      tr.waitSignal = this.signalAtAuthorityEnd(tr);
      tr.standingSince = tr.standingSince ?? this.time;
      this.maybeDriverCall(tr);
    } else if (tr.v > 0) {
      tr.state = 'run';
      tr.waitSignal = null;
      tr.holdSince = null;
    }

    if (tr.exiting && tr.s - tr.lenM > authorityEnd) this.finishTrain(tr);
  }

  /** Lokführer meldet sich, wenn er zu lange vor einem Halt zeigenden Signal steht */
  maybeDriverCall(tr) {
    if (!tr.waitSignal || tr.kind === 'rangier') return;
    if (tr.askedAt && this.time - tr.askedAt < 600) return;
    if (this.time - (tr.holdSince || this.time) < 240) return;
    if (this.routes.some(r => r.signal && r.signal.id === tr.waitSignal.id)) return;
    tr.askedAt = this.time;
    this.addMessage(
      `${tr.nr} steht seit ${Math.round((this.time - tr.holdSince) / 60)} min vor ${tr.waitSignal.name} und fragt nach Weiterfahrt.`,
      {
        from: tr.nr, kind: 'call',
        data: { trainId: tr.id, signalId: tr.waitSignal.id },
        actions: [
          { key: 'zs1', label: 'Vorbeifahrt (Zs1) erteilen' },
          { key: 'wait', label: 'Warten lassen' }
        ]
      });
  }

  onAdvance(tr, before) {
    const frontIdx = Math.min(tr.steps.length - 1, Math.floor(tr.s / CELL_M));
    const beforeIdx = Math.min(tr.steps.length - 1, Math.floor(before / CELL_M));
    for (let i = beforeIdx; i <= frontIdx; i++) {
      const r = tr.stepRoutes[i];
      if (r && !r.passed && i === tr.routeStart.get(r.id)) r.passed = true;   // Haltfall
    }
    const tailIdx = Math.floor((tr.s - tr.lenM) / CELL_M);
    while (tr.released < tailIdx && tr.released < tr.steps.length) {
      const i = tr.released;
      const r = tr.stepRoutes[i];
      const k = tr.steps[i].k;
      if (r && this.lockedCells.get(k) === r.id) this.lockedCells.delete(k);
      if (r) this.releaseFlankHoldsFor(r.id, k);   // Flankenschutz mit auflösen
      tr.released++;
    }
    for (const r of [...this.routes]) {
      if (r.trainId === tr.id && r.passed && r.steps.every(st => this.lockedCells.get(st.k) !== r.id)) {
        if (!r.overlapReleased) releaseOverlap(this, r);
        releaseRoute(this, r);
      }
    }
  }

  signalAtAuthorityEnd(tr) {
    if (!tr.steps.length) return null;
    const last = tr.steps[tr.steps.length - 1];
    if (last.to === null || last.to === undefined) return null;
    const p = parseKey(last.k);
    return signalAt(this.layout, p.x, p.y, last.to);
  }

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
    return (last + 1) * CELL_M;
  }

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
    if (tr.kind === 'rangier') v = Math.min(v, this.cfg.shuntSpeed ?? 25);
    const i = Math.min(tr.steps.length - 1, Math.max(0, Math.floor(tr.s / CELL_M)));
    for (let j = i; j < Math.min(tr.steps.length, i + 3); j++) {
      const p = parseKey(tr.steps[j].k);
      const c = cellAt(this.layout, p.x, p.y);
      if (c && c.vmax) v = Math.min(v, c.vmax);
    }
    const r = tr.stepRoutes[i];
    if (r) {
      if (r.mode === 'shunt') v = Math.min(v, this.cfg.shuntSpeed ?? 25);
      if (r.substitute) v = Math.min(v, this.cfg.substituteSpeed ?? 40);
      // Langsamfahrt über abzweigende Weichen bis zur letzten Ablenkung
      if (r.diverging && r.divergeIdx >= 0) {
        const base = tr.routeStart.get(r.id) ?? 0;
        if (i <= base + r.divergeIdx + 1) v = Math.min(v, this.cfg.divergingSpeed ?? 40);
      }
    }
    return Math.max(10, v);
  }

  /* ================= Halte, Anschlüsse, Wenden ================= */
  arriveAtStop(tr) {
    const st = tr.stops[tr.nextStop];
    if (tr.state === 'dwell') return;
    tr.state = 'dwell';
    tr.v = 0;
    const arrDelay = this.time - st.arr;
    tr.delay = arrDelay;
    this.stats.maxDelay = Math.max(this.stats.maxDelay, arrDelay);
    let dwell = Math.max(this.cfg.minDwell ?? 30, st.dep - this.time);
    if (tr.extraDwell) { dwell += tr.extraDwell; tr.extraDwell = 0; }
    tr.departAt = this.time + dwell;
    st.actualArr = this.time;
    tr.record.stops.push({ platform: st.platform, plannedArr: st.arr, actualArr: this.time, plannedDep: st.dep, actualDep: null });
    this.occupancyLog.push({ platform: st.platform, nr: tr.nr, from: this.time, to: null, planFrom: st.arr, planTo: st.dep });
    this.log(`${tr.nr} hält in ${st.platform} (${signedMin(arrDelay)}), Abfahrt ${hhmm(tr.departAt)}.`,
      arrDelay > 300 ? 'bad' : arrDelay > 60 ? 'warn' : 'ok');
    this.checkConnections(tr, st);
  }

  /** Anschlusszüge prüfen und gegebenenfalls nachfragen */
  checkConnections(tr, st) {
    if (!st.connections || !st.connections.length || tr.dropConnections) return;
    for (const conn of st.connections) {
      const feeder = this.trains.find(t => t.nr === conn.from);
      if (!feeder || feeder.state === 'done') continue;
      const arrived = feeder.record.stops.some(s => s.platform === conn.platform || !conn.platform);
      if (arrived) continue;
      const wait = Math.min(conn.maxWait ?? 600, 1800);
      tr.waitForConnection = true;
      tr.connectionUntil = this.time + wait;
      tr.connectionFrom = conn.from;
      this.addMessage(`${tr.nr} in ${st.platform}: Anschluss von ${conn.from} noch nicht eingetroffen (bis zu ${Math.round(wait / 60)} min Wartezeit).`, {
        from: tr.nr, kind: 'call', data: { trainId: tr.id },
        actions: [
          { key: 'connection-keep', label: 'Anschluss abwarten' },
          { key: 'connection-drop', label: 'Anschluss aufgeben' }
        ]
      });
      return;
    }
  }

  updateDwell(tr) {
    // auf Anschluss warten
    if (tr.waitForConnection && !tr.dropConnections) {
      const feeder = this.trains.find(t => t.nr === tr.connectionFrom);
      const feederArrived = !feeder || feeder.state === 'done' || feeder.record.stops.length > 0;
      if (!feederArrived && this.time < (tr.connectionUntil ?? 0)) {
        tr.departAt = Math.max(tr.departAt, this.time + 10);
        return;
      }
      tr.waitForConnection = false;
    }
    if (this.time < tr.departAt) return;

    const st = tr.stops[tr.nextStop];
    tr.delay = this.time - st.dep;
    const rec = tr.record.stops[tr.record.stops.length - 1];
    if (rec) rec.actualDep = this.time;
    const occ = this.occupancyLog.find(o => o.nr === tr.nr && o.platform === st.platform && o.to === null);
    if (occ) occ.to = this.time;
    this.log(`${tr.nr} fährt in ${st.platform} ab (${signedMin(tr.delay)}).`, tr.delay > 180 ? 'warn' : 'ok');
    tr.nextStop++;
    // Wende nach dem letzten Halt?
    if (tr.nextStop >= tr.stops.length && tr.turn && !tr.turned) return this.startTurn(tr);
    tr.state = 'run';
  }

  startTurn(tr) {
    tr.state = 'turning';
    tr.v = 0;
    tr.turnReadyAt = this.time + (tr.turn.wende ?? 300);
    this.log(`${tr.nr} wendet, Bereitstellung als ${tr.turn.nr} um ${hhmm(tr.turnReadyAt)}.`, 'ok');
    this.addMessage(`${tr.nr} wendet und verkehrt weiter als ${tr.turn.nr} nach ${tr.turn.exit}.`, { from: tr.nr, kind: 'train' });
  }

  /** Fahrtrichtungswechsel: Zug steht, Fahrweg wird umgedreht */
  finishTurn(tr) {
    const frontIdx = Math.min(tr.steps.length - 1, Math.floor(Math.max(0, tr.s - 0.001) / CELL_M));
    const tailIdx = Math.max(0, Math.floor((tr.s - tr.lenM) / CELL_M));
    const occupied = tr.steps.slice(tailIdx, frontIdx + 1);
    if (!occupied.length) { tr.state = 'run'; return; }
    for (const r of [...this.routes]) if (r.trainId === tr.id) { this.freeTrainAuthority(r); releaseRoute(this, r); }

    const reversed = occupied.slice().reverse().map(st => ({ k: st.k, from: st.to ?? opp(st.from), to: st.from ?? opp(st.to) }));
    tr.steps = reversed;
    tr.stepRoutes = reversed.map(() => null);
    tr.routeStart = new Map();
    tr.released = 0;
    tr.s = reversed.length * CELL_M;
    tr.v = 0;
    tr.turned = true;
    // neue Zugidentität
    const t = tr.turn;
    tr.nr = t.nr || tr.nr;
    tr.gattung = t.gattung || tr.gattung;
    tr.exitName = t.exit || tr.exitName;
    tr.stops = (t.stops || []).map(s => ({ ...s }));
    tr.nextStop = 0;
    tr.turn = null;
    tr.delay = t.dep != null ? this.time - t.dep : tr.delay;
    tr.plannedEntry = t.dep ?? tr.plannedEntry;
    tr.state = 'hold';
    tr.holdSince = this.time;
    tr.exiting = false;
    tr.record.turnedAt = this.time;
    this.log(`${tr.nr} steht zur Abfahrt bereit (Wende abgeschlossen).`, 'ok');
  }

  finishTrain(tr) {
    tr.state = 'done';
    tr.v = 0;
    for (let i = tr.released; i < tr.steps.length; i++) {
      const r = tr.stepRoutes[i];
      if (r && this.lockedCells.get(tr.steps[i].k) === r.id) this.lockedCells.delete(tr.steps[i].k);
    }
    for (const r of [...this.routes]) if (r.trainId === tr.id) releaseRoute(this, r);
    tr.record.finishedAt = this.time;
    tr.record.finalDelay = tr.delay;
    this.stats.finished++;
    this.stats.delaySum += tr.delay;
    if (tr.delay < (this.cfg.punctualLimit ?? 300)) this.stats.punctual++;
    this.log(`${tr.nr} hat das Stellwerk über ${tr.exitName} verlassen (${signedMin(tr.delay)}).`,
      tr.delay < 300 ? 'ok' : 'warn');
  }

  /* ================= Fahrstraßen an Züge binden ================= */
  bindRoute(tr) {
    if (tr.state === 'done' || tr.state === 'turning') return;
    if (tr.state === 'waiting') {
      const cands = this.routes.filter(r => !r.trainId && r.entryName && r.entryName === tr.entryName);
      const r = cands.find(x => x.forTrainId === tr.id) || cands[0];
      if (!r || !routeReady(this, r)) return;
      r.trainId = tr.id;
      tr.steps = r.steps.slice();
      tr.stepRoutes = r.steps.map(() => r);
      tr.routeStart.set(r.id, 0);
      tr.s = 0; tr.v = 0; tr.released = 0;
      tr.state = 'run';
      tr.exiting = r.dest.type === 'exit';
      tr.record.entryAt = this.time;
      tr.delay = this.time - tr.plannedEntry;
      this.log(`${tr.nr} fährt aus ${tr.entryName} ein (${signedMin(tr.delay)}).`, 'ok');
      return;
    }
    const sig = this.signalAtAuthorityEnd(tr);
    const free = this.routes.filter(r => !r.trainId && r.signal);
    let route = null, prefix = null;
    if (sig) route = free.find(r => r.signal.id === sig.id);
    if (!route && tr.v === 0) {
      // Zug steht nicht unmittelbar am Signal (z. B. nach dem Wenden):
      // Weg bis zum Signal voraus prüfen und anhängen
      for (const r of free) {
        const last = tr.steps[tr.steps.length - 1];
        if (!last) continue;
        const p = parseKey(last.k);
        const startFrom = last.to != null ? last.to : null;
        if (startFrom === null) continue;
        const n = neighbor(p.x, p.y, startFrom);
        if (!cellAt(this.layout, n.x, n.y)) continue;
        const path = pathToSignal(this, key(n.x, n.y), opp(startFrom), r.signal);
        if (path) { route = r; prefix = path; break; }
      }
    }
    if (!route) return;
    if (!routeReady(this, route)) return;
    route.trainId = tr.id;
    if (prefix) {
      tr.steps = tr.steps.concat(prefix);
      tr.stepRoutes = tr.stepRoutes.concat(prefix.map(() => null));
    }
    route.consumedAt = this.time;
    tr.routeStart.set(route.id, tr.steps.length);
    tr.steps = tr.steps.concat(route.steps);
    tr.stepRoutes = tr.stepRoutes.concat(route.steps.map(() => route));
    tr.exiting = route.dest.type === 'exit';
    if (tr.state === 'hold') { tr.state = 'run'; tr.holdSince = null; }
  }

  /* ================= Automatikbetrieb ================= */
  autoDispatch() {
    if (this.time - (this._lastAuto || 0) < 3) return;
    this._lastAuto = this.time;
    for (const tr of this.trains) {
      if (['done', 'pending', 'turning'].includes(tr.state)) continue;
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
        const sig = this.signalAtAuthorityEnd(tr) || this.nextSignalAhead(tr);
        if (!sig) continue;
        if (this.routes.some(r => r.signal && r.signal.id === sig.id)) continue;
        start = { type: 'signal', sig };
      }
      const dest = this.bestDestination(tr, start);
      if (!dest) {
        tr.noRouteSince = tr.noRouteSince ?? this.time;
        if (!tr.noRouteWarned && this.time - tr.noRouteSince > 900) {
          tr.noRouteWarned = true;
          this.log(`${tr.nr}: seit 15 min kein Fahrweg zum Ziel – bitte von Hand eingreifen.`, 'bad');
          this.addMessage(
            `${tr.nr} steht seit 15 min ohne Fahrweg (${tr.stops[tr.nextStop]?.platform || 'Ausfahrt ' + tr.exitName}). ` +
            'Möglicherweise blockieren sich Züge gegenseitig – Fahrstraße von Hand stellen oder Zug zurücksetzen.',
            { from: 'Betriebsleitung', kind: 'fault', data: { trainId: tr.id } });
        }
        continue;
      }
      tr.noRouteSince = null; tr.noRouteWarned = false;
      const res = lockRoute(this, start, dest, { substitute: true, forTrain: tr.id });
      if (res.ok) {
        res.route.forTrainId = tr.id;
        tr.lastRouteError = null;
        this.stats.routesSet++;
        this.log(`Automatik: ${res.route.id} für ${tr.nr} bis ${res.route.destName} gestellt.`);
      } else {
        tr.lastRouteError = res.reason;
      }
    }
  }

  /** nächstes Signal in Fahrtrichtung vor dem Zug (auch mit Abstand) */
  nextSignalAhead(tr) {
    const last = tr.steps[tr.steps.length - 1];
    if (!last || last.to == null) return null;
    const p = parseKey(last.k);
    return nextMainSignal(this.layout, p.x, p.y, last.to, 15);
  }

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
      layout: L, blocked: this.blockedCells, locked, holds: this.holdMap(),
      occupied: this.occupiedCells(tr), allowOccupied: false, mode: 'train'
    };
    const target = this.targetCell(tr);
    if (!target) return null;
    const stop = tr.stops[tr.nextStop] || null;
    const targetKeys = stop
      ? new Set(platformCells(L, stop.platform).map(c => key(c.x, c.y)))
      : new Set([key(target.x, target.y)]);

    const cands = [];
    for (const id in L.signals) {
      const s = L.signals[id];
      if (s.kind === 'distant' || s.kind === 'shunt') continue;
      cands.push({ type: 'signal', sig: s });
    }
    for (const e of entries(L)) if (e.name === tr.exitName) cands.push({ type: 'exit', cell: e.cell });

    const scored = [];
    for (const d of cands) {
      if (d.type === 'signal' && start.type === 'signal' && d.sig.id === start.sig.id) continue;
      const r = findRoute(start, d, ctx);
      if (!r || !r.steps.length) continue;
      const lastStep = r.steps[r.steps.length - 1];
      const last = parseKey(lastStep.k);
      const serves = stop && r.steps.some(st => {
        const p = parseKey(st.k);
        const c = cellAt(L, p.x, p.y);
        return c && c.platform === stop.platform;
      });
      const reachesPlatform = r.steps.some(st => {
        const p = parseKey(st.k);
        const c = cellAt(L, p.x, p.y);
        return c && c.platform;
      });
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
      const merged = new Set(extraLocked);
      for (const st of cand.route.steps) merged.add(st.k);
      if (this.planToSafe(tr, { type: 'signal', sig: cand.dest.sig }, merged, depth - 1)) return cand;
    }
    return null;
  }

  /* ================= Auswertung ================= */
  report() {
    const rows = this.trains.map(t => ({
      nr: t.nr, gattung: t.gattung, von: t.entryName, nach: t.exitName,
      state: t.state, delay: t.state === 'done' ? t.record.finalDelay : t.delay,
      halte: t.record.stops.map(s => ({
        platform: s.platform,
        anPlan: s.plannedArr, anIst: s.actualArr,
        abPlan: s.plannedDep, abIst: s.actualDep
      }))
    }));
    const done = rows.filter(r => r.state === 'done');
    return {
      stats: { ...this.stats },
      trains: rows,
      avgDelay: done.length ? done.reduce((a, r) => a + r.delay, 0) / done.length : 0,
      occupancy: this.occupancyLog.slice()
    };
  }

  /* ================= Spielstand ================= */
  toJSON() {
    return {
      time: this.time, layoutName: this.layout.name,
      autoRoute: this.autoRoute, speedFactor: this.speedFactor,
      globalSpeedLimit: this.globalSpeedLimit,
      stats: this.stats, occupancyLog: this.occupancyLog,
      switchStates: Object.fromEntries(Object.entries(this.layout.cells)
        .filter(([, c]) => ['switch', 'dkw'].includes(cellType(c)))
        .map(([k, c]) => [k, c.sw | 0])),
      blockedCells: [...this.blockedCells],
      faultySwitches: [...this.faultySwitches],
      faultySignals: [...this.faultySignals],
      crossings: [...this.crossingState.entries()].map(([n, s]) => [n, { state: s.state, mode: s.mode, requests: [...s.requests] }]),
      faults: this.faults.map(f => ({
        id: f.id, type: f.type, target: f.target, title: f.title, text: f.text,
        since: f.since, repairSec: f.repairSec, repairUntil: f.repairUntil,
        autoUntil: f.autoUntil, repairing: f.repairing
      })),
      routes: this.routes.map(r => ({
        id: r.id, mode: r.mode, steps: r.steps, overlap: r.overlap, switches: r.switches,
        flanks: r.flanks, signalId: r.signal ? r.signal.id : null, entryName: r.entryName,
        destName: r.destName, diverging: r.diverging, divergeIdx: r.divergeIdx,
        substitute: r.substitute, trainId: r.trainId, forTrainId: r.forTrainId,
        passed: r.passed, overlapReleased: r.overlapReleased, releaseAt: r.releaseAt,
        crossings: r.crossings,
        startRef: r.start.type === 'signal' ? { type: 'signal', id: r.start.sig.id } : { type: 'entry', k: key(r.start.cell.x, r.start.cell.y) },
        destRef: Sim.refOfDest(r.dest)
      })),
      trains: this.trains.map(t => ({
        id: t.id, nr: t.nr, gattung: t.gattung, kind: t.kind, vmax: t.vmax, lenM: t.lenM,
        plannedEntry: t.plannedEntry, entryName: t.entryName, exitName: t.exitName,
        stops: t.stops, nextStop: t.nextStop, state: t.state, s: t.s, v: t.v,
        released: t.released, delay: t.delay, exiting: t.exiting, extraDwell: t.extraDwell,
        vmaxFault: t.vmaxFault, departAt: t.departAt, steps: t.steps,
        stepRouteIds: t.stepRoutes.map(r => (r ? r.id : null)),
        routeStart: [...t.routeStart.entries()], record: t.record, turn: t.turn,
        turned: t.turned, turnReadyAt: t.turnReadyAt, plan: t.plan
      }))
    };
  }

  static restore(sim, data) {
    sim.time = data.time;
    sim.autoRoute = !!data.autoRoute;
    sim.speedFactor = data.speedFactor || 10;
    sim.globalSpeedLimit = data.globalSpeedLimit ?? null;
    sim.stats = data.stats || sim.stats;
    sim.occupancyLog = data.occupancyLog || [];
    sim.blockedCells = new Set(data.blockedCells || []);
    sim.faultySwitches = new Set(data.faultySwitches || []);
    sim.faultySignals = new Set(data.faultySignals || []);
    for (const [k, v] of Object.entries(data.switchStates || {})) {
      const p = parseKey(k);
      const c = cellAt(sim.layout, p.x, p.y);
      if (c) c.sw = v;
    }
    sim.crossingState = new Map((data.crossings || []).map(([n, s]) => [n, { name: n, state: s.state, mode: s.mode, readyAt: null, requests: new Set(s.requests) }]));
    sim.faults = (data.faults || []).map(f => ({ ...f }));
    sim.lockedCells = new Map();
    sim.routes = (data.routes || []).map(r => {
      const route = {
        ...r,
        signal: r.signalId ? sim.layout.signals[r.signalId] : null,
        start: r.startRef.type === 'signal'
          ? { type: 'signal', sig: sim.layout.signals[r.startRef.id] }
          : { type: 'entry', cell: cellAt(sim.layout, ...Object.values(parseKey(r.startRef.k))) },
        dest: sim.destFromRef(r.destRef)
      };
      for (const st of route.steps) sim.lockedCells.set(st.k, route.id);
      for (const st of route.overlap || []) if (!route.overlapReleased) sim.lockedCells.set(st.k, route.id);
      for (const f of route.flanks || []) sim.lockedCells.set(f.k, route.id);
      return route;
    });
    const byId = new Map(sim.routes.map(r => [r.id, r]));
    sim.trains = (data.trains || []).map(t => {
      const tr = makeTrain(t.plan || {}, 1);
      Object.assign(tr, t, {
        stepRoutes: (t.stepRouteIds || []).map(id => (id ? byId.get(id) || null : null)),
        routeStart: new Map(t.routeStart || [])
      });
      delete tr.stepRouteIds;
      return tr;
    });
    return sim;
  }
}

/* ================= Hilfsfunktionen ================= */

export function makeTrain(row, idx) {
  const stops = (row.stops || []).map(s => ({
    platform: s.platform, arr: s.arr, dep: s.dep,
    connections: s.connections || [], actualArr: null
  }));
  return {
    id: row.id || ('T' + idx),
    nr: row.nr || ('Zug ' + idx),
    gattung: row.gattung || 'RB',
    kind: row.kind || (row.gattung === 'Lok' || row.gattung === 'Rangier' ? 'rangier' : 'zug'),
    vmax: row.vmax || 120,
    lenM: (row.length || 2) * 100,
    plannedEntry: row.entryTime ?? 0,
    entryName: row.entry,
    exitName: row.exit,
    stops,
    turn: row.turn || null,
    turned: false,
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
    holdSince: null,
    standingSince: null,
    askedAt: null,
    departAt: 0,
    waitForConnection: false,
    dropConnections: false,
    record: { stops: [], entryAt: null, finishedAt: null, finalDelay: 0 },
    plan: row
  };
}

/** Zellen, die ein Zug aktuell belegt */
export function trainCells(tr) {
  if (!tr.steps.length || ['done', 'pending', 'waiting'].includes(tr.state)) return [];
  const out = [];
  const front = Math.min(tr.steps.length - 1, Math.floor(Math.max(0, tr.s - 0.001) / CELL_M));
  const tail = Math.max(0, Math.floor((tr.s - tr.lenM) / CELL_M));
  for (let i = tail; i <= front; i++) out.push(tr.steps[i].k);
  return out;
}
