/* ===================================================================
 * app.js – gemeinsamer Zustand der Oberfläche
 *
 * Die Ansichtsmodule tauschen sich über dieses Objekt aus; Funktionen,
 * die mehrere Module brauchen, werden als „hooks" registriert, damit
 * keine Kreisbezüge zwischen den Modulen entstehen.
 * ================================================================= */
export const app = {
  layout: null,          // aktuelles Stellwerk
  sim: null,             // laufender Betrieb
  events: null,          // Zufallsereignisse
  score: null,           // Punktestand
  editor: null,          // Editor-Instanz
  view: 'sim',
  dirty: false,          // Gleisplan/Fahrplan geändert → Betrieb neu aufbauen
  routeStart: null,      // gewählter Fahrstraßenstart
  hoverPick: null,       // Element unter dem Mauszeiger (Betrieb)
  shuntMode: false,
  queueMode: false,
  followTrain: null,
  zoom: { sim: 1, editor: 1 },
  scenario: null,        // laufendes Szenario { def, start, end, usedAuto, scriptIdx }
  tutorial: null,        // laufendes Tutorial
  hooks: {}
};

export function register(hooks) { Object.assign(app.hooks, hooks); }
export function call(name, ...args) {
  const fn = app.hooks[name];
  return fn ? fn(...args) : undefined;
}
