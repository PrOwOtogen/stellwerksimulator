/* ===================================================================
 * interlocking.js – Fahrstraßensuche und Verschlusslogik
 * ================================================================= */
import {
  key, parseKey, neighbor, opp, cellAt, cellType, exitsFrom,
  requiredSwitchState, signalAt, switchGeom
} from './model.js';

let routeCounter = 1;

/**
 * Sucht einen Weg von einem Startpunkt zu einem Ziel.
 * start: {type:'signal', sig} | {type:'entry', cell}
 * dest : {type:'signal', sig} | {type:'exit',  cell}
 * ctx  : { layout, blocked:Set, locked:Map(cellKey->routeId), occupied:Set, allowOccupied:bool }
 * Ergebnis: { steps:[{k,from,to}], switches:[{k,state}] } oder null
 */
export function findRoute(start, dest, ctx) {
  const L = ctx.layout;
  const startStates = [];
  const prefix = [];

  if (start.type === 'signal') {
    const s = start.sig;
    const n = neighbor(s.x, s.y, s.dir);
    const c = cellAt(L, n.x, n.y);
    if (!c) return null;
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
  const destKey = dest.type === 'signal' ? key(dest.sig.x, dest.sig.y) : key(dest.cell.x, dest.cell.y);

  const cellUsable = (k) => {
    if (ctx.blocked.has(k)) return false;
    if (ctx.locked.has(k)) return false;
    if (!ctx.allowOccupied && ctx.occupied.has(k)) return false;
    return true;
  };

  // Dijkstra über Zustände (Zelle, Eintrittsende)
  const open = startStates
    .filter(st => cellUsable(st.k))
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

    // Ziel erreicht?
    if (cur.k === destKey) {
      if (dest.type === 'exit') { goal = { ...cur, to: null }; break; }
      const outs = exitsFrom(c, cur.from, true);
      if (outs.includes(destSig.dir)) { goal = { ...cur, to: destSig.dir }; break; }
    }

    for (const to of exitsFrom(c, cur.from, true)) {
      // Kein Signal in Fahrtrichtung überfahren (außer es ist das Zielsignal)
      const sig = signalAt(L, x, y, to);
      if (sig && !(destSig && sig.id === destSig.id)) continue;
      const n = neighbor(x, y, to);
      const nk = key(n.x, n.y);
      const nc = cellAt(L, n.x, n.y);
      if (!nc || !nc.ends.includes(opp(to))) continue;
      if (!cellUsable(nk)) continue;
      if (seen.has(nk + '|' + opp(to))) continue;
      // Weichen in Grundstellung leicht bevorzugen
      let extra = 0;
      if (cellType(c) === 'switch') {
        const req = requiredSwitchState(c, cur.from, to);
        if (req >= 0 && req !== (c.sw | 0)) extra = 0.15;
      }
      open.push({ k: nk, from: opp(to), cost: cur.cost + 1 + extra, prev: { state: cur, to } });
    }
  }
  if (!goal) return null;

  // Pfad zurückverfolgen
  const steps = [];
  let node = goal;
  let outDir = goal.to;
  while (node) {
    steps.unshift({ k: node.k, from: node.from, to: outDir });
    if (!node.prev) break;
    outDir = node.prev.to;
    node = node.prev.state;
  }
  const full = [...prefix, ...steps];

  // benötigte Weichenstellungen sammeln
  const switches = [];
  for (const st of full) {
    const { x, y } = parseKey(st.k);
    const c = cellAt(L, x, y);
    if (cellType(c) !== 'switch') continue;
    const req = st.from === null ? -1 : requiredSwitchState(c, st.from, st.to);
    if (req >= 0) switches.push({ k: st.k, state: req });
  }
  return { steps: full, switches };
}

/** Beschreibung eines Start-/Zielpunktes für die Anzeige */
export function pointLabel(p) {
  if (!p) return '?';
  if (p.type === 'signal') return p.sig.name;
  return p.cell.entry || 'Ausfahrt';
}

/**
 * Fahrstraße einrichten: prüft Verschlüsse, stellt Weichen, verriegelt.
 * sim = Laufzeitzustand (siehe sim.js)
 */
export function lockRoute(sim, start, dest, opts = {}) {
  const L = sim.layout;
  const ctx = {
    layout: L,
    blocked: sim.blockedCells,
    locked: sim.lockedCells,
    occupied: sim.occupiedCells(),
    allowOccupied: false
  };
  const res = findRoute(start, dest, ctx);
  if (!res) return { ok: false, reason: 'Kein freier Fahrweg vorhanden (belegt, verschlossen oder gestört).' };

  // gestörte Weichen dürfen nicht umgestellt werden
  for (const s of res.switches) {
    const p = parseKey(s.k);
    const c = cellAt(L, p.x, p.y);
    if (sim.faultySwitches.has(s.k) && (c.sw | 0) !== s.state) {
      return { ok: false, reason: `Weiche ${s.k} ist gestört und lässt sich nicht umstellen.` };
    }
  }

  const startSig = start.type === 'signal' ? start.sig : null;
  const substitute = startSig ? sim.faultySignals.has(startSig.id) : false;
  if (substitute && !opts.substitute) {
    return { ok: false, reason: `Signal ${startSig.name} ist gestört. Fahrstraße nur mit Ersatzsignal (Umschalttaste + Klick) möglich.`, needsSubstitute: true };
  }

  const route = {
    id: 'FS' + (routeCounter++),
    start, dest,
    steps: res.steps,
    switches: res.switches,
    signal: startSig,
    entryName: start.type === 'entry' ? start.cell.entry : null,
    destName: pointLabel(dest),
    substitute,
    trainId: null,
    consumed: false,
    releasedUpTo: -1
  };

  for (const s of res.switches) {
    const p = parseKey(s.k);
    cellAt(L, p.x, p.y).sw = s.state;
  }
  for (const st of route.steps) sim.lockedCells.set(st.k, route.id);
  sim.routes.push(route);
  if (startSig) sim.signalAspect.set(startSig.id, substitute ? 'Zs1' : 'Hp1');
  return { ok: true, route };
}

/** Fahrstraße auflösen (Hilfsauflösung oder nach Zugfahrt) */
export function releaseRoute(sim, route, fromIndex = 0) {
  for (let i = fromIndex; i < route.steps.length; i++) {
    const k = route.steps[i].k;
    if (sim.lockedCells.get(k) === route.id) sim.lockedCells.delete(k);
  }
  if (fromIndex === 0) {
    sim.routes = sim.routes.filter(r => r !== route);
    if (route.signal) sim.signalAspect.set(route.signal.id, 'Hp0');
  }
}

/** Signalbegriff bestimmen */
export function aspectOf(sim, sig) {
  if (sim.faultySignals.has(sig.id)) {
    const a = sim.signalAspect.get(sig.id);
    return a === 'Zs1' ? 'Zs1' : 'Gestört';
  }
  return sim.signalAspect.get(sig.id) || 'Hp0';
}

/* ===================================================================
 * Topologische Erreichbarkeit (ohne Signale, Verschlüsse und Belegung)
 * Wird für den Automatikbetrieb und den Fahrplangenerator benötigt.
 * ================================================================= */
const reachCache = new WeakMap();

function cacheFor(L) {
  let c = reachCache.get(L);
  if (!c) { c = new Map(); reachCache.set(L, c); }
  return c;
}
export function clearReachCache(L) { reachCache.delete(L); }

/**
 * Alle Zellen, die von einem Zustand (Zelle, Eintrittsende) aus ohne
 * Fahrtrichtungswechsel erreichbar sind.
 */
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
      const nk = key(n.x, n.y);
      const nc = cellAt(L, n.x, n.y);
      if (nc && nc.ends.includes(opp(to))) stack.push([nk, opp(to)]);
    }
  }
  cache.set(ck, out);
  return out;
}

/** Erreichbarkeit ab einer Ein-/Ausfahrtzelle */
export function reachFromEntry(L, cell) {
  if (!cell.ends.length) return new Set();
  const to = cell.ends[0];
  const n = neighbor(cell.x, cell.y, to);
  const s = new Set(reachSet(L, key(n.x, n.y), opp(to)));
  s.add(key(cell.x, cell.y));
  return s;
}

/** Erreichbarkeit hinter dem Zielsignal einer Fahrstraße */
export function reachAfterStep(L, step) {
  if (step.to === null || step.to === undefined) return new Set();
  const p = parseKey(step.k);
  const n = neighbor(p.x, p.y, step.to);
  if (!cellAt(L, n.x, n.y)) return new Set();
  return reachSet(L, key(n.x, n.y), opp(step.to));
}

/**
 * Gibt es eine durchgehende Fahrt Einfahrt → (Bahnsteig) → Ausfahrt,
 * ohne dass der Zug die Fahrtrichtung wechseln muss?
 */
export function workingPossible(L, entryCell, platformName, exitCell) {
  if (!entryCell || !exitCell || !entryCell.ends.length) return false;
  const exitKey = key(exitCell.x, exitCell.y);
  const to = entryCell.ends[0];
  const n0 = neighbor(entryCell.x, entryCell.y, to);
  if (!cellAt(L, n0.x, n0.y)) return false;
  const start = [key(n0.x, n0.y), opp(to), platformName ? 0 : 1];
  const stack = [start];
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
