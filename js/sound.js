/* ===================================================================
 * sound.js – kurze Signaltöne über die Web-Audio-Schnittstelle
 * ================================================================= */
const KEY = 'stellwerksim.sound';
let ctx = null;
let enabled = (() => { try { return localStorage.getItem(KEY) !== 'aus'; } catch { return true; } })();

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', vol = 0.06, delay = 0 } = {}) {
  if (!enabled) return;
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sound = {
  get enabled() { return enabled; },
  setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(KEY, enabled ? 'an' : 'aus'); } catch { /* egal */ }
  },
  /** Zugfunk / Rückfrage */
  chime() { tone(880, 0.18); tone(660, 0.25, { delay: 0.16 }); },
  /** Zugmeldung (Anbieten) */
  bell() { tone(1318, 0.12, { type: 'triangle' }); tone(1318, 0.12, { type: 'triangle', delay: 0.18 }); },
  /** Störung */
  alarm() { tone(440, 0.22, { type: 'square', vol: 0.04 }); tone(330, 0.3, { type: 'square', vol: 0.04, delay: 0.22 }); },
  /** Fahrstraße eingestellt */
  click() { tone(1600, 0.04, { type: 'square', vol: 0.025 }); },
  /** Fehlbedienung */
  error() { tone(200, 0.18, { type: 'sawtooth', vol: 0.03 }); },
  /** Szenario beendet */
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, { type: 'triangle', delay: i * 0.14 })); }
};
