/* ===================================================================
 * interlocking.js – Fahrstraßensuche, Verschluss und Signalbegriffe
 *
 * Umgesetzte Abhängigkeiten:
 *   • Fahrweg frei, verschlossen gegen andere Fahrstraßen
 *   • Weichen in Endlage (mit Umlaufzeit), Auffahrschutz
 *   • Flankenschutz durch benachbarte Weichen
 *   • Durchrutschweg hinter dem Zielsignal
 *   • Bahnübergänge geschlossen
 *   • Signalbegriffe Hp0/Hp1/Hp2/Zs1/Sh1 und Vorsignale Vr0/Vr1/Vr2
 * ================================================================= */
import {
  key, parseKey, neighbor, opp, cellAt, cellType, exitsFrom,
  requiredSwitchState, signalAt, switchGeom, isDiverging, dirDist
} from './model.js';

let routeCounter = 1;
export function resetRouteCounter() { routeCounter = 1; }

const settingsOf = sim => sim.layout.settings || {};

/* ===================================================================
 * Wegesuche
 * ================================================================= */

/**
 * start: {type:'signal', sig} | {type:'entry', cell}
 * dest : {type:'signal', sig} | {type:'exit', cell} | {type:'cell', cell}
 * ctx  : { layout, blocked:Set, locked:Map, occupied:Set, allowOccupied, mode }
 *        mode: 'train' (Zugfahrt) oder 'shunt' (Rangierfahrt)
 */
export function findRoute(start, dest, ctx) {
  const L = ctx.layout;
  const mode = ctx.mode || 'train';
  const startStates = [];
  const prefix = [];

  if (start.type === 'signal') {
    const s = start.sig;
    const n = neighbor(s.x, s.y, s.dir);
    if (!cellAt(L, n.x, n.y)) return null;
    startStates.push({ k: key(n.x, n.y), from: opp(s.dir) });
  } else {
    const c = start.cell;
    if (!c.ends.length) return null;
    const to = c.ends[0];
    prefix.push({ k: key(c.x, c.y), from: null, to });
    const n = neighbor(c.x, c.y, to);
    if (!cellAt(L, n.x, n.y)) return null;
    startStates.push({ k: key(n.x, n.y), from: opp(to) });
  }

  const destSig = dest.type === 'signal' ? dest.sig : null;
  const destKey = destSig ? key(destSig.x, destSig.y) : key(dest.cell.x, dest.cell.y);

  const usable = (k, isDest) => {
    if (ctx.blocked.has(k)) return false;
    if (ctx.locked.has(k)) return false;
    if (ctx.occupied.has(k) && !ctx.allowOccupied) {
      // Rangierfahrten dürfen auf ein besetztes Zielgleis fahren
      return !!(isDest && mode === 'shunt');
    }
    return true;
  };
  /** gilt dieses Signal für unsere Fahrt? */
  const blocksUs = sig => {
    if (!sig) return false;
    if (sig.kind === 'distant') return false;             // Vorsignale halten nicht
    if (ctx.passSignals) return false;                    // Kettensuche: Signale überfahrbar
    if (mode === 'train' && sig.kind === 'shunt') return false;  // Sperrsignal gilt nur beim Rangieren
    return true;
  };

  const open = startStates
    .filter(st => usable(st.k, st.k === destKey))
    .map(st => ({ ...st, cost: 1, prev: null, to: null }));
  const seen = new Map();
  let goal = null;

  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);
    const cur = open.shift();
    const sk = cur.k + '|' + cur.from;
    if (seen.has(sk)) continue;
    seen.set(sk, cur);

    const { x, y } = parseKey(cur.k);
    const c = cellAt(L, x, y);
    if (!c) continue;

    if (cur.k === destKey) {
      if (dest.type !== 'signal') { goal = { ...cur, to: dest.type === 'exit' ? null : null }; break; }
      const outs = exitsFrom(c, cur.from, true);
      if (outs.includes(destSig.dir)) { goal = { ...cur, to: destSig.dir }; break; }
    }

    for (const to of exitsFrom(c, cur.from, true)) {
      const sig = signalAt(L, x, y, to);
      if (blocksUs(sig) && !(destSig && sig.id === destSig.id)) continue;
      // als Flankenschutz festgehaltene Weichen dürfen nicht umgestellt werden
      const need = requiredSwitchState(c, cur.from, to);
      if (need >= 0 && ctx.holds && ctx.holds.has(cur.k) && ctx.holds.get(cur.k) !== need) continue;
      const n = neighbor(x, y, to);
      const nk = key(n.x, n.y);
      const nc = cellAt(L, n.x, n.y);
      if (!nc || !nc.ends.includes(opp(to))) continue;
      if (!usable(nk, nk === destKey)) continue;
      if (seen.has(nk + '|' + opp(to))) continue;
      let extra = 0;
      const req = requiredSwitchState(c, cur.from, to);
      if (req >= 0 && req !== (c.sw | 0)) extra += 0.15;      // Umstellen kostet Zeit
      if (isDiverging(c, cur.from, to)) extra += 0.3;          // gerader Strang bevorzugt
      open.push({ k: nk, from: opp(to), cost: cur.cost + 1 + extra, prev: { state: cur, to } });
    }
  }
  if (!goal) return null;

  const steps = [];
  let node = goal, outDir = goal.to;
  while (node) {
    steps.unshift({ k: node.k, from: node.from, to: outDir });
    if (!node.prev) break;
    outDir = node.prev.to;
    node = node.prev.state;
  }
  const full = [...prefix, ...steps];

  const switches = [];
  let diverging = false, divergeIdx = -1;
  full.forEach((st, i) => {
    const { x, y } = parseKey(st.k);
    const c = cellAt(L, x, y);
    if (!['switch', 'dkw'].includes(cellType(c))) return;
    const req = st.from === null ? -1 : requiredSwitchState(c, st.from, st.to);
    if (req >= 0) switches.push({ k: st.k, state: req });
    if (st.from !== null && st.to !== null) {
      const c2 = { ...c, sw: req >= 0 ? req : c.sw };
      if (isDiverging(c2, st.from, st.to)) { diverging = true; divergeIdx = i; }
    }
  });
  return { steps: full, switches, diverging, divergeIdx };
}

/* ===================================================================
 * Durchrutschweg und Flankenschutz
 * ================================================================= */

/** Durchrutschweg hinter dem Zielsignal ermitteln */
export function computeOverlap(sim, destSig, lengthM, usedKeys) {
  const L = sim.layout;
  const cells = Math.max(0, Math.round(lengthM / 100));
  const steps = [];
  if (!cells) return steps;
  let x = destSig.x, y = destSig.y, dir = destSig.dir;
  for (let i = 0; i < cells; i++) {
    const n = neighbor(x, y, dir);
    const nc = cellAt(L, n.x, n.y);
    const nk = key(n.x, n.y);
    if (!nc || !nc.ends.includes(opp(dir))) break;
    if (usedKeys.has(nk) || sim.lockedCells.has(nk) || sim.blockedCells.has(nk)) break;
    if (sim.occupiedCells().has(nk)) break;
    steps.push({ k: nk, from: opp(dir), to: null });
    // in bestehender Weichenlage weiterlaufen
    const outs = exitsFrom(nc, opp(dir), false);
    if (!outs.length) break;
    steps[steps.length - 1].to = outs[0];
    x = n.x; y = n.y; dir = outs[0];
  }
  return steps;
}

/**
 * Flankenschutz: Von jedem offenen Ende des Fahrwegs wird dem Gleis gefolgt,
 * bis ein deckendes Signal oder die erste Weiche erreicht ist. Zeigt diese
 * Weiche in den Fahrweg, wird sie abgelenkt und mitverschlossen.
 */
export function flankSwitches(sim, steps, maxDepth = 4) {
  const L = sim.layout;
  const used = new Set(steps.map(s => s.k));
  const out = [];
  const seen = new Set();
  for (const st of steps) {
    const p = parseKey(st.k);
    const c = cellAt(L, p.x, p.y);
    if (!c) continue;
    for (const d of c.ends) {
      if (d === st.from || d === st.to) continue;   // im Fahrweg benutzte Enden
      let x = p.x, y = p.y, dir = d;
      for (let i = 0; i < maxDepth; i++) {
        // deckendes Signal in Richtung unseres Fahrwegs?
        const n = neighbor(x, y, dir);
        const nc = cellAt(L, n.x, n.y);
        const nk = key(n.x, n.y);
        if (!nc || !nc.ends.includes(opp(dir)) || used.has(nk)) break;
        if (signalAt(L, n.x, n.y, opp(dir))) break;       // Signalflankenschutz
        const t = cellType(nc);
        if (t === 'switch' || t === 'dkw') {
          if (seen.has(nk)) break;
          seen.add(nk);
          const towardsUs = opp(dir);
          if (t === 'switch') {
            const g = switchGeom(nc);
            const bi = g.branches.indexOf(towardsUs);
            // Weiche zeigt nur dann in den Fahrweg, wenn dieser Zweig anliegt
            if (bi >= 0 && (nc.sw | 0) === bi) out.push({ k: nk, state: 1 - bi, reason: 'Flankenschutz', forStep: st.k });
            else if (towardsUs === g.root && exitsFrom(nc, g.root, false).length) {
              // Wurzelseite: Schutzstellung ist nicht möglich, Lage festhalten
              out.push({ k: nk, state: nc.sw | 0, reason: 'Flankenschutz (Lage festgehalten)', forStep: st.k });
            }
          } else {
            out.push({ k: nk, state: nc.sw | 0, reason: 'Flankenschutz (DKW festgehalten)', forStep: st.k });
          }
          break;
        }
        const outs = exitsFrom(nc, opp(dir), false);
        if (!outs.length) break;
        x = n.x; y = n.y; dir = outs[0];
      }
    }
  }
  return out;
}

/* ===================================================================
 * Fahrstraße einstellen
 * ================================================================= */

export function pointLabel(p) {
  if (!p) return '?';
  if (p.type === 'signal') return p.sig.name;
  return p.cell.entry || p.cell.stump || 'Gleis';
}

export function lockRoute(sim, start, dest, opts = {}) {
  const L = sim.layout;
  const cfg = settingsOf(sim);
  if (sim.interlockingFault && sim.time < sim.interlockingFault)
    return { ok: false, reason: 'Stellwerksstörung – derzeit lassen sich keine Fahrstraßen einstellen.' };
  const mode = opts.shunt ? 'shunt' : 'train';
  const startSig = start.type === 'signal' ? start.sig : null;

  if (startSig && startSig.blocked && !opts.substitute)
    return { ok: false, reason: `Signal ${startSig.name} ist gesperrt.` };
  if (startSig && mode === 'train' && startSig.kind === 'shunt')
    return { ok: false, reason: `${startSig.name} ist ein Sperrsignal – nur Rangierfahrstraßen möglich.` };
  if (startSig && startSig.kind === 'distant')
    return { ok: false, reason: `${startSig.name} ist ein Vorsignal und kennt keine Fahrstraße.` };

  /* Eine Anschlussfahrstraße überlagert den Durchrutschweg der Fahrstraße,
     die vor demselben Signal endet – dieser wird dadurch aufgelöst. */
  const prevRoutes = startSig
    ? sim.routes.filter(r => !r.overlapReleased && r.overlap.length &&
      r.dest && r.dest.type === 'signal' && r.dest.sig.id === startSig.id)
    : [];
  const locked = prevRoutes.length ? new Map(sim.lockedCells) : sim.lockedCells;
  for (const r of prevRoutes) {
    for (const st of r.overlap) if (locked.get(st.k) === r.id) locked.delete(st.k);
  }

  const ctx = {
    layout: L, blocked: sim.blockedCells, locked, holds: sim.holdMap(),
    occupied: sim.occupiedCells(), allowOccupied: false, mode
  };
  const res = findRoute(start, dest, ctx);
  if (!res) return { ok: false, reason: 'Kein freier Fahrweg vorhanden (besetzt, verschlossen oder gestört).' };

  // gestörte Weichen dürfen nicht umgestellt werden
  for (const s of res.switches) {
    const p = parseKey(s.k);
    const c = cellAt(L, p.x, p.y);
    if (sim.faultySwitches.has(s.k) && (c.sw | 0) !== s.state)
      return { ok: false, reason: `Weiche ${s.k} ist gestört und lässt sich nicht umstellen.` };
  }

  const substitute = startSig ? sim.faultySignals.has(startSig.id) || startSig.blocked : false;
  if (substitute && !opts.substitute)
    return {
      ok: false, needsSubstitute: true,
      reason: `Signal ${startSig.name} ist gestört. Fahrt nur mit Ersatzsignal (Umschalt + Klick auf das Ziel).`
    };

  const used = new Set(res.steps.map(s => s.k));

  // Durchrutschweg nur bei Zugfahrten mit Zielsignal
  let overlap = [];
  if (mode === 'train' && dest.type === 'signal') {
    const len = dest.sig.overlap ?? cfg.overlapM ?? 200;
    overlap = computeOverlap(sim, dest.sig, len, used);
  }

  // Flankenschutz
  let flanks = [];
  if (cfg.flankProtection !== false && mode === 'train') {
    flanks = flankSwitches(sim, res.steps);
    const occ = sim.occupiedCells();
    for (const f of flanks) {
      const p = parseKey(f.k);
      const c = cellAt(L, p.x, p.y);
      const cur = c.sw | 0;
      const held = sim.flankHoldState(f.k);
      if (held !== null && held !== f.state)
        return { ok: false, reason: `Flankenschutz nicht herstellbar: Weiche ${f.k} ist in anderer Lage festgelegt.` };
      if (cur === f.state) continue;                 // liegt bereits richtig
      if (sim.lockedCells.has(f.k))
        return { ok: false, reason: `Flankenschutz nicht herstellbar: Weiche ${f.k} ist verschlossen.` };
      if (sim.faultySwitches.has(f.k))
        return { ok: false, reason: `Flankenschutz nicht herstellbar: Weiche ${f.k} ist gestört.` };
      if (occ.has(f.k))
        return { ok: false, reason: `Flankenschutz nicht herstellbar: Weiche ${f.k} ist besetzt.` };
    }
  }

  const route = {
    id: 'FS' + (routeCounter++),
    start, dest, mode,
    steps: res.steps,
    overlap,
    switches: res.switches,
    flanks,
    signal: startSig,
    entryName: start.type === 'entry' ? start.cell.entry : null,
    destName: pointLabel(dest),
    diverging: res.diverging,
    divergeIdx: res.divergeIdx,
    substitute,
    trainId: null,
    forTrainId: opts.forTrain || null,
    passed: false,
    overlapReleased: overlap.length === 0,
    releaseAt: null,
    setAt: sim.time
  };

  for (const r of prevRoutes) {
    releaseOverlap(sim, r);
    sim.log?.(`Durchrutschweg der Fahrstraße ${r.id} durch Anschlussfahrstraße aufgelöst.`);
  }

  // Weichen laufen lassen (Umlaufzeit)
  for (const s of [...res.switches, ...flanks]) {
    const p = parseKey(s.k);
    const c = cellAt(L, p.x, p.y);
    if ((c.sw | 0) !== s.state) sim.moveSwitch(s.k, s.state);
  }
  // Verschluss
  for (const st of route.steps) sim.lockedCells.set(st.k, route.id);
  for (const st of route.overlap) sim.lockedCells.set(st.k, route.id);
  // Flankenschutzweichen werden nur in ihrer Lage festgehalten, nicht gesperrt
  for (const f of route.flanks) sim.addFlankHold(f.k, route.id, f.state, f.forStep);

  // Bahnübergänge anfordern
  route.crossings = [...new Set(route.steps.concat(route.overlap).map(st => {
    const p = parseKey(st.k);
    const c = cellAt(L, p.x, p.y);
    return c && c.crossing ? c.crossing.name : null;
  }).filter(Boolean))];
  for (const name of route.crossings) sim.requestCrossing(name, route.id);

  sim.routes.push(route);
  return { ok: true, route };
}

/** Ist die Fahrstraße vollständig hergestellt (Weichen, Bahnübergänge)? */
export function routeReady(sim, route) {
  for (const s of [...route.switches, ...route.flanks]) {
    // bereits aufgelöste Abschnitte werden nicht mehr überwacht
    const stillLocked = sim.lockedCells.get(s.k) === route.id ||
      (s.forStep && sim.lockedCells.get(s.forStep) === route.id);
    if (!stillLocked && route.passed) continue;
    if (sim.switchMoves.has(s.k)) return false;
    const p = parseKey(s.k);
    const c = cellAt(sim.layout, p.x, p.y);
    if ((c.sw | 0) !== s.state) return false;
  }
  for (const name of route.crossings || []) {
    const bü = sim.crossingState.get(name);
    if (!bü || bü.state !== 'closed') return false;
  }
  return true;
}

/**
 * Warum zeigt eine eingestellte Fahrstraße noch keinen Fahrtbegriff?
 * Liefert null, wenn alles hergestellt ist.
 */
export function routeBlockReason(sim, route) {
  const moving = [...route.switches, ...route.flanks].filter(s => sim.switchMoves.has(s.k));
  if (moving.length) return `Weichen laufen um (${moving.map(m => m.k).join(', ')})`;
  for (const s of [...route.switches, ...route.flanks]) {
    const stillLocked = sim.lockedCells.get(s.k) === route.id ||
      (s.forStep && sim.lockedCells.get(s.forStep) === route.id);
    if (!stillLocked && route.passed) continue;
    const p = parseKey(s.k);
    const c = cellAt(sim.layout, p.x, p.y);
    if ((c.sw | 0) !== s.state) return `Weiche ${s.k} nicht in Endlage`;
  }
  for (const name of route.crossings || []) {
    const bü = sim.crossingState.get(name);
    if (!bü) continue;
    if (bü.fault) return `${name} ist gestört`;
    if (bü.state === 'closing') return `${name} schließt`;
    if (bü.state !== 'closed') return `${name} muss geschlossen werden`;
  }
  return null;
}

/** Fahrstraße auflösen; mit { delay:true } als Hilfsauflösung mit Wartezeit */
export function releaseRoute(sim, route, opts = {}) {
  if (opts.delay) {
    const cfg = settingsOf(sim);
    route.releaseAt = sim.time + (cfg.releaseDelaySec ?? 90);
    return route.releaseAt;
  }
  for (const st of route.steps) if (sim.lockedCells.get(st.k) === route.id) sim.lockedCells.delete(st.k);
  for (const st of route.overlap) if (sim.lockedCells.get(st.k) === route.id) sim.lockedCells.delete(st.k);
  sim.removeFlankHolds(route.id);
  sim.routes = sim.routes.filter(r => r !== route);
  for (const name of route.crossings || []) sim.releaseCrossing(name, route.id);
  return null;
}

/** Nur den Durchrutschweg auflösen */
export function releaseOverlap(sim, route) {
  for (const st of route.overlap) if (sim.lockedCells.get(st.k) === route.id) sim.lockedCells.delete(st.k);
  route.overlapReleased = true;
}

/* ===================================================================
 * Signalbegriffe
 * ================================================================= */

export function aspectOf(sim, sig) {
  if (sig.kind === 'distant') return distantAspect(sim, sig);
  const route = sim.routes.find(r => r.signal && r.signal.id === sig.id && !r.passed);
  if (!route) {
    if (sim.faultySignals.has(sig.id)) return 'Gestört';
    return 'Hp0';
  }
  if (!routeReady(sim, route)) return 'Hp0';
  if (route.mode === 'shunt') return 'Sh1';
  if (route.substitute) return 'Zs1';
  return route.diverging ? 'Hp2' : 'Hp1';
}

/** erwarteter Begriff des nächsten Hauptsignals (für Vorsignale) */
export function distantAspect(sim, sig) {
  const next = nextMainSignal(sim.layout, sig.x, sig.y, sig.dir);
  if (!next) return 'dunkel';
  const a = aspectOf(sim, next);
  if (a === 'Hp1') return 'Vr1';
  if (a === 'Hp2' || a === 'Zs1') return 'Vr2';
  return 'Vr0';
}

/** dem Gleis in Fahrtrichtung folgen und das nächste Hauptsignal suchen */
export function nextMainSignal(L, x, y, dir, maxCells = 40) {
  let cx = x, cy = y, d = dir;
  for (let i = 0; i < maxCells; i++) {
    const sig = signalAt(L, cx, cy, d);
    if (sig && (sig.kind === 'main' || sig.kind === 'combined') && !(cx === x && cy === y && i === 0)) return sig;
    if (i > 0) {
      const s2 = signalAt(L, cx, cy, d);
      if (s2 && (s2.kind === 'main' || s2.kind === 'combined')) return s2;
    }
    const n = neighbor(cx, cy, d);
    const nc = cellAt(L, n.x, n.y);
    if (!nc || !nc.ends.includes(opp(d))) return null;
    const outs = exitsFrom(nc, opp(d), false);
    if (!outs.length) return null;
    cx = n.x; cy = n.y; d = outs[0];
    const sHere = signalAt(L, cx, cy, d);
    if (sHere && (sHere.kind === 'main' || sHere.kind === 'combined')) return sHere;
  }
  return null;
}

/** zulässige Geschwindigkeit, die ein Signalbegriff erlaubt (km/h) */
export function aspectSpeed(sim, aspect) {
  const cfg = settingsOf(sim);
  switch (aspect) {
    case 'Hp2': return cfg.divergingSpeed ?? 40;
    case 'Zs1': return cfg.substituteSpeed ?? 40;
    case 'Sh1': return cfg.shuntSpeed ?? 25;
    default: return null;
  }
}

/* ===================================================================
 * Topologische Erreichbarkeit (ohne Signale, Verschlüsse, Belegung)
 * ================================================================= */
const reachCache = new WeakMap();
function cacheFor(L) {
  let c = reachCache.get(L);
  if (!c) { c = new Map(); reachCache.set(L, c); }
  return c;
}
export function clearReachCache(L) { reachCache.delete(L); }

export function reachSet(L, cellKey, fromEnd) {
  const ck = cellKey + '|' + fromEnd;
  const cache = cacheFor(L);
  if (cache.has(ck)) return cache.get(ck);
  const out = new Set();
  const stack = [[cellKey, fromEnd]];
  const seen = new Set();
  while (stack.length) {
    const [k, from] = stack.pop();
    const sk = k + '|' + from;
    if (seen.has(sk)) continue;
    seen.add(sk);
    out.add(k);
    const p = parseKey(k);
    const c = cellAt(L, p.x, p.y);
    if (!c) continue;
    for (const to of exitsFrom(c, from, true)) {
      const n = neighbor(p.x, p.y, to);
      const nc = cellAt(L, n.x, n.y);
      if (nc && nc.ends.includes(opp(to))) stack.push([key(n.x, n.y), opp(to)]);
    }
  }
  cache.set(ck, out);
  return out;
}

export function reachFromEntry(L, cell) {
  if (!cell.ends.length) return new Set();
  const to = cell.ends[0];
  const n = neighbor(cell.x, cell.y, to);
  const s = new Set(reachSet(L, key(n.x, n.y), opp(to)));
  s.add(key(cell.x, cell.y));
  return s;
}

export function reachAfterStep(L, step) {
  if (step.to === null || step.to === undefined) return new Set();
  const p = parseKey(step.k);
  const n = neighbor(p.x, p.y, step.to);
  if (!cellAt(L, n.x, n.y)) return new Set();
  return reachSet(L, key(n.x, n.y), opp(step.to));
}

export function workingPossible(L, entryCell, platformName, exitCell) {
  if (!entryCell || !exitCell || !entryCell.ends.length) return false;
  const exitKey = key(exitCell.x, exitCell.y);
  const to = entryCell.ends[0];
  const n0 = neighbor(entryCell.x, entryCell.y, to);
  if (!cellAt(L, n0.x, n0.y)) return false;
  const stack = [[key(n0.x, n0.y), opp(to), platformName ? 0 : 1]];
  const seen = new Set();
  while (stack.length) {
    const [k, from, got] = stack.pop();
    const sk = k + '|' + from + '|' + got;
    if (seen.has(sk)) continue;
    seen.add(sk);
    const p = parseKey(k);
    const c = cellAt(L, p.x, p.y);
    if (!c) continue;
    const g = got || (platformName && c.platform === platformName ? 1 : 0);
    if (k === exitKey && g) return true;
    for (const t of exitsFrom(c, from, true)) {
      const n = neighbor(p.x, p.y, t);
      const nc = cellAt(L, n.x, n.y);
      if (nc && nc.ends.includes(opp(t))) stack.push([key(n.x, n.y), opp(t), g]);
    }
  }
  return false;
}

/** Weg vom Zug bis zu einem Signal voraus (für Wendefahrten und Nachrücken) */
export function pathToSignal(sim, fromKey, fromEnd, sig, maxCells = 15) {
  const L = sim.layout;
  const steps = [];
  let k = fromKey, from = fromEnd;
  const occupied = sim.occupiedCells();
  for (let i = 0; i < maxCells; i++) {
    const p = parseKey(k);
    const c = cellAt(L, p.x, p.y);
    if (!c) return null;
    const outs = exitsFrom(c, from, false);
    if (!outs.length) return null;
    const to = outs[0];
    if (i > 0 && (sim.lockedCells.has(k) || sim.blockedCells.has(k))) return null;
    steps.push({ k, from, to });
    if (p.x === sig.x && p.y === sig.y && to === sig.dir) return steps;
    const n = neighbor(p.x, p.y, to);
    const nk = key(n.x, n.y);
    const nc = cellAt(L, n.x, n.y);
    if (!nc || !nc.ends.includes(opp(to))) return null;
    if (occupied.has(nk)) return null;
    k = nk; from = opp(to);
  }
  return null;
}


/* ===================================================================
 * Zuglenkung: eine Folge von Fahrstraßen bis zum entfernten Ziel
 * ================================================================= */

/**
 * Zerlegt den Weg zum Ziel an den dazwischenliegenden Hauptsignalen und
 * stellt die Teilfahrstraßen nacheinander ein.
 * Ergebnis: { ok, routes, reason, gestellt, gesamt }
 */
export function lockRouteChain(sim, start, dest, opts = {}) {
  const L = sim.layout;
  const mode = opts.shunt ? 'shunt' : 'train';
  const ctx = {
    layout: L, blocked: sim.blockedCells, locked: new Map(), holds: new Map(),
    occupied: new Set(), allowOccupied: true, mode, passSignals: true
  };
  const path = findRoute(start, dest, ctx);
  if (!path) return { ok: false, reason: 'Es gibt keinen Fahrweg zu diesem Ziel.', routes: [] };

  // Schnittpunkte an Hauptsignalen bestimmen
  const legs = [];
  let current = start;
  path.steps.forEach((st, i) => {
    if (i === path.steps.length - 1 || st.to == null) return;
    const p = parseKey(st.k);
    const sig = signalAt(L, p.x, p.y, st.to);
    if (!sig) return;
    if (sig.kind === 'distant') return;
    if (mode === 'train' && sig.kind === 'shunt') return;
    legs.push({ from: current, to: { type: 'signal', sig } });
    current = { type: 'signal', sig };
  });
  legs.push({ from: current, to: dest });

  const routes = [];
  for (const leg of legs) {
    const res = lockRoute(sim, leg.from, leg.to, opts);
    if (!res.ok) {
      return {
        ok: routes.length > 0, routes, gestellt: routes.length, gesamt: legs.length,
        reason: res.reason, needsSubstitute: res.needsSubstitute,
        restStart: leg.from, restDest: dest
      };
    }
    routes.push(res.route);
  }
  return { ok: true, routes, gestellt: routes.length, gesamt: legs.length };
}
