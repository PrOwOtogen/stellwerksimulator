/* ===================================================================
 * gamemode.js – Startbildschirm, Szenarien, Spielstände, Hilfe
 * ================================================================= */
import { app, call } from './app.js';
import { $, h, esc, toast, openModal, closeModal } from './dom.js';
import { icon } from './icons.js';
import { hhmm, Sim } from '../sim.js';
import { SCENARIOS, goalText, goalState, evaluate, loadHighscores, saveHighscore } from '../scenarios.js';
import { LAYOUT_TEMPLATES } from '../layouts.js';
import { SCORE_RULES } from '../scoring.js';
import * as store from '../storage.js';
import { sound } from '../sound.js';

const starHtml = (n, max = 3) => `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(max - n)}</span></span>`;
const diffLabel = d => ['', 'leicht', 'mittel', 'schwer'][d];

/* ============================ Startbildschirm ============================ */
export function showStartScreen() {
  const hs = loadHighscores();
  openModal('', body => {
    body.append(h('div', {
      class: 'start-hero', html: `<span class="logo">STW</span><div><h1>Stellwerksimulator</h1>
      <p>Stelle Fahrstraßen, halte den Fahrplan und behalte bei Störungen die Nerven.</p></div>`
    }));

    body.append(h('h3', {}, 'Szenarien'));
    const sc = h('div', { class: 'cards' });
    for (const def of SCENARIOS) {
      const best = hs[def.id];
      sc.append(h('button', {
        class: 'card', onclick: () => { closeModal(); briefing(def); },
        html: `<b>${esc(def.title)}</b><small>${esc(def.desc)}</small>
          <div class="meta"><span class="diff d${def.difficulty}">${diffLabel(def.difficulty)} · ${Math.round(def.duration / 60)} min</span>
          ${best ? starHtml(best.stars) + ` <span>${best.points}</span>` : starHtml(0)}</div>`
      }));
    }
    body.append(sc);

    body.append(h('h3', {}, 'Freies Spiel'));
    const fr = h('div', { class: 'cards' });
    for (const [name, fn] of Object.entries(LAYOUT_TEMPLATES)) {
      if (name.startsWith('Leeres')) continue;
      fr.append(h('button', {
        class: 'card', onclick: () => { closeModal(); call('loadLayout', fn(), 'Freies Spiel'); call('switchView', 'sim'); },
        html: `<b>${esc(name.replace(/\s*\(.*\)/, ''))}</b><small>${esc((name.match(/\((.*)\)/) || [, ''])[1])} – eigener Rhythmus, Automatik erlaubt.</small>`
      }));
    }
    for (const n of store.listNames()) {
      fr.append(h('button', {
        class: 'card', onclick: () => { closeModal(); const L = store.load(n); if (L) { call('loadLayout', L, 'Freies Spiel'); call('switchView', 'sim'); } },
        html: `<b>${esc(n)}</b><small>gespeichertes Stellwerk</small>`
      }));
    }
    body.append(fr);

    body.append(h('h3', {}, 'Lernen und Bauen'));
    body.append(h('div', { class: 'cards' },
      h('button', { class: 'card', onclick: () => { closeModal(); call('startTutorial'); }, html: `${icon('school', 22)}<b>Einführung</b><small>Schritt für Schritt: Fahrstraßen stellen, Zugfunk, Störungen.</small>` }),
      h('button', { class: 'card', onclick: () => { closeModal(); call('newLayout'); }, html: `${icon('edit', 22)}<b>Eigenes Stellwerk</b><small>Gleisplan zeichnen, Signale setzen, Fahrplan anlegen.</small>` }),
      h('button', { class: 'card', onclick: () => { closeModal(); showSavegames(); }, html: `${icon('folder', 22)}<b>Spielstände</b><small>Gespeicherten Betrieb fortsetzen.</small>` })));
    try { localStorage.setItem('stellwerksim.seenStart', '1'); } catch { /* egal */ }
    return null;
  }, { wide: true, noOk: true, cancelLabel: 'Schließen', cls: 'start' });
}

/* ============================ Szenarien ============================ */
export function showScenarios() {
  const hs = loadHighscores();
  openModal('Szenarien', body => {
    const sc = h('div', { class: 'cards' });
    for (const def of SCENARIOS) {
      const best = hs[def.id];
      sc.append(h('button', {
        class: 'card', onclick: () => { closeModal(); briefing(def); },
        html: `<b>${esc(def.title)}</b><small>${esc(def.desc)}</small>
          <div class="meta"><span class="diff d${def.difficulty}">${diffLabel(def.difficulty)}</span>${best ? starHtml(best.stars) : starHtml(0)}</div>`
      }));
    }
    body.append(sc);
    return null;
  }, { wide: true, noOk: true, cancelLabel: 'Schließen' });
}

function briefing(def) {
  openModal(def.title, body => {
    body.append(h('p', {}, def.desc));
    body.append(h('h3', {}, 'Ziele'));
    for (const g of def.goals) body.append(h('div', { class: 'goal-line ok', html: `<span>${esc(goalText(g))}</span><b>${icon('flag', 14)}</b>` }));
    body.append(h('p', { class: 'small', html:
      `Dauer ${Math.round(def.duration / 60)} Minuten Betriebszeit. Sterne gibt es für erfüllte Ziele und Punkte
      (${def.stars[1]} / ${def.stars[2]} für zwei bzw. drei Sterne). Mit Automatikbetrieb ist höchstens ein Stern möglich.` }));
    return () => startScenario(def);
  }, { okLabel: 'Szenario starten', cancelLabel: 'Zurück', onCancel: () => showScenarios() });
}

export function startScenario(def) {
  call('stopTutorial');
  const L = def.build();
  call('loadLayout', L, `Szenario: ${def.title}`);
  app.scenario = { def, start: L.startTime, end: L.startTime + def.duration, usedAuto: false, scriptIdx: 0, finished: false };
  call('switchView', 'sim');
  app.sim.running = true;
  call('syncPlay');
  toast(`Szenario „${def.title}" läuft – viel Erfolg!`, 'ok');
}

/** in jedem Takt: Drehbuch abarbeiten, Ende erkennen */
export function updateScenario() {
  const sc = app.scenario;
  if (!sc || sc.finished) return;
  if (app.sim.autoRoute) sc.usedAuto = true;
  const script = sc.def.script || [];
  while (sc.scriptIdx < script.length && app.sim.time >= sc.start + script[sc.scriptIdx].at) {
    app.events.fireRandom(script[sc.scriptIdx].event);
    sc.scriptIdx++;
  }
  const allDone = app.sim.trains.length && app.sim.trains.every(t => t.state === 'done');
  if (app.sim.time >= sc.end || allDone) finishScenario();
}

export function renderHud() {
  const box = $('#scenario-hud');
  const sc = app.scenario;
  if (!sc) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const rest = Math.max(0, sc.end - app.sim.time);
  const pct = Math.min(100, 100 * (app.sim.time - sc.start) / (sc.end - sc.start));
  const goals = sc.def.goals.map(g => ({ g, ...goalState(g, app.sim, app.score) }));
  box.innerHTML = `<div class="title"><span>${icon('trophy', 14)} ${esc(sc.def.title)}</span><span>${sc.finished ? 'beendet' : 'noch ' + Math.ceil(rest / 60) + ' min'}</span></div>` +
    goals.map(x => `<div class="goal${x.ok ? ' ok' : ''}"><span>${esc(goalText(x.g))}</span><b>${esc(x.text)}</b></div>`).join('') +
    `<div class="goal"><span>Punkte</span><b style="color:#ffd166">${app.score.points}</b></div>` +
    (sc.usedAuto ? '<div class="small" style="color:var(--warn)">Automatik genutzt – höchstens 1 Stern</div>' : '') +
    `<div class="bar"><i style="width:${pct}%"></i></div>`;
}

export function finishScenario() {
  const sc = app.scenario;
  if (!sc || sc.finished) return;
  sc.finished = true;
  app.sim.running = false;
  call('syncPlay');
  const res = evaluate(sc.def, app.sim, app.score, sc.usedAuto);
  const rekord = res.stars > 0 && saveHighscore(sc.def.id, res);
  sound.fanfare();
  openModal(res.passed ? 'Szenario geschafft!' : 'Szenario nicht bestanden', body => {
    body.append(h('div', {
      class: 'result-big', html: `${starHtml(res.stars)}<div class="pts">${res.points} Punkte</div>
      <div class="small">${esc(sc.def.title)}${rekord ? ' · neuer Bestwert!' : ''}${res.usedAuto ? ' · mit Automatik' : ''}</div>`
    }));
    for (const g of res.goals) body.append(h('div', { class: 'goal-line' + (g.ok ? ' ok' : ''), html: `<span>${esc(goalText(g.goal))}</span><b>${g.ok ? '✔' : '✘'} ${esc(g.text)}</b>` }));
    const s = app.sim.stats;
    body.append(h('p', { class: 'small', html: `Zugfahrten ${s.finished} · Fahrstraßen ${s.routesSet} · Halte vor Signal ${s.signalStops} · Hilfsauflösungen ${s.emergencyReleases} · Störungen ${s.faultsTotal}` }));
    body.append(h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'primary', onclick: () => { closeModal(); startScenario(sc.def); } }, 'Nochmal spielen'),
      h('button', { onclick: () => { closeModal(); showScenarios(); } }, 'Andere Szenarien'),
      h('button', { onclick: () => { closeModal(); call('switchView', 'report'); } }, 'Auswertung ansehen')));
    return null;
  }, { noOk: true, cancelLabel: 'Weiter ansehen' });
}

/* ============================ Spielstände ============================ */
export function showSavegames() {
  openModal('Spielstände', body => {
    const name = h('input', { type: 'text', placeholder: `${app.layout.name} ${hhmm(app.sim.time)}`, style: { flex: 1 } });
    body.append(h('div', { class: 'row' }, name, h('button', {
      class: 'primary', onclick: () => {
        const n = name.value.trim() || `${app.layout.name} ${hhmm(app.sim.time)}`;
        store.saveGame(n, { layout: app.layout, sim: app.sim.toJSON(), score: app.score?.points || 0 });
        toast(`Spielstand „${n}" gespeichert.`, 'ok');
        closeModal(); showSavegames();
      }
    }, 'Aktuellen Betrieb speichern')));
    const all = store.listSaves();
    const names = Object.keys(all).sort((a, b) => (all[b].savedAt || '').localeCompare(all[a].savedAt || ''));
    const list = h('div', { class: 'route-list' });
    for (const n of names) {
      list.append(h('div', { class: 'r' },
        h('span', { html: `<b>${esc(n)}</b><br><span class="small">${new Date(all[n].savedAt).toLocaleString('de-DE')} · ${esc(all[n].sim?.layoutName || '')} · ${hhmm(all[n].sim?.time || 0)}</span>` }),
        h('span', {},
          h('button', { class: 'primary', onclick: () => { closeModal(); loadGame(n); } }, 'Laden'), ' ',
          h('button', { class: 'danger', onclick: () => { store.deleteGame(n); closeModal(); showSavegames(); } }, '✕'))));
    }
    body.append(names.length ? list : h('em', {}, 'Noch keine Spielstände gespeichert.'));
    return null;
  }, { noOk: true, cancelLabel: 'Schließen' });
}

function loadGame(n) {
  const data = store.loadGame(n);
  if (!data) return;
  call('stopTutorial');
  call('loadLayout', store.migrate(data.layout), 'Spielstand');
  Sim.restore(app.sim, data.sim);
  if (app.score && data.score) app.score.points = data.score;
  app.sim.running = false;
  app.dirty = false;
  call('afterRestore');
  call('switchView', 'sim');
  toast(`Spielstand „${n}" geladen (${hhmm(app.sim.time)}).`, 'ok');
}

/* ============================ Hilfe, Punkte ============================ */
export function showHelp() {
  openModal('Bedienung', body => {
    body.innerHTML = `<div class="helpgrid">
      <span class="kbd">Klick</span><span>Signal oder Einfahrt als Start, dann Ziel anklicken – liegen Signale dazwischen, wird die ganze Fahrstraßenkette gestellt</span>
      <span class="kbd">Umschalt+Klick</span><span>Ziel mit Ersatzsignal Zs1 (Vorbeifahrt am gestörten Signal)</span>
      <span class="kbd">Rechtsklick</span><span>Menü: Fahrstraße auflösen, Selbststellbetrieb, Signal sperren, Gleis sperren, Zugdetails</span>
      <span class="kbd">Klick auf Weiche / BÜ / Zug</span><span>Weiche umstellen · Schranken bedienen · Zugdetails mit Gleiswechsel</span>
      <span class="kbd">Ziehen · Mausrad</span><span>Gleisbild verschieben · zoomen (auch mittlere Maustaste oder Leertaste + Ziehen)</span>
      <span class="kbd">Leertaste</span><span>Start/Pause</span>
      <span class="kbd">1 … 7</span><span>Zeitraffer 1× bis 120×</span>
      <span class="kbd">Z</span><span>Zeitsprung bis zum nächsten Ereignis (wenn gerade kein Zug fährt)</span>
      <span class="kbd">A · R · F</span><span>Automatik · Rangiermodus · Gleisbild einpassen</span>
      <span class="kbd">Esc</span><span>Auswahl abbrechen, Menüs schließen</span>
      <span class="kbd">Befehlszeile</span><span>„A N1", „West Ost" oder „Hauptstrecke Gleis 2" + Enter</span>
      <span class="kbd">Editor</span><span>Strg+Z/Y rückgängig/wiederholen · Werkzeug „Bereich": Strg+C/X/V, Entf, Pfeiltasten</span>
      <span class="kbd">F1</span><span>diese Hilfe</span></div>
      <h3>Signalbegriffe</h3>
      <p class="small">Hp0 Halt · Hp1 Fahrt · Hp2 Langsamfahrt über abzweigende Weichen · Zs1 Ersatzsignal · Sh1 Rangierfahrt ·
      Vr0/Vr1/Vr2 Vorsignal kündigt Halt/Fahrt/Langsamfahrt an. Eine Fahrstraße zeigt erst Fahrt, wenn alle Weichen liegen,
      der Flankenschutz steht, der Durchrutschweg frei ist und die Bahnübergänge geschlossen sind – der Reiter „Stellen" nennt den Wartegrund.</p>
      <h3>Tipps</h3>
      <p class="small">Fahrstraßen früh stellen, dann bremsen die Züge nicht vor dem Einfahrsignal. Zugmeldungen rechtzeitig annehmen,
      Störungen sofort entstören lassen, bei gesperrten Bahnsteigen per Zugdetails einen Gleiswechsel verfügen.</p>`;
    return null;
  }, { noOk: true, cancelLabel: 'Schließen', wide: true });
}

export function showScore() {
  openModal(`Punktestand: ${app.score.points}`, body => {
    body.append(h('div', { class: 'two-col' },
      h('div', {}, h('h3', {}, 'Letzte Wertungen'), h('div', {
        class: 'log short', html: app.score.entries.slice(0, 60).map(e =>
          `<div><span class="t">${hhmm(e.t)}</span><span class="${e.pts >= 0 ? 'ok' : 'bad'}">${e.pts > 0 ? '+' : ''}${e.pts}</span> ${esc(e.text)}</div>`).join('') || '<em>noch keine</em>'
      })),
      h('div', {}, h('h3', {}, 'Regeln'), h('div', { class: 'score-rules', html: SCORE_RULES.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('') }))));
    return null;
  }, { noOk: true, cancelLabel: 'Schließen', wide: true });
}
