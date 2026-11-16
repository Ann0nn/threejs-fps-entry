// audio.js — one job: procedural sound. Every sound is synthesized with the
// Web Audio API (oscillators and filtered noise) — no audio files, no network
// requests, nothing to download. The AudioContext is created on the first user
// gesture (click to play), so the game never tries to play sound before the
// browser allows it; in the headless screenshot demos it simply stays silent.

let ctx = null;
let master = null;

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch (_) {
    ctx = null; // No audio on this browser: the game plays on silently.
  }
}

// A short burst of filtered noise: the body of a gunshot, a footstep, a reload.
function noiseBurst(freq, dur, gain, type = 'lowpass') {
  if (!ctx) return;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start();
}

// A pure tone with a fast decay: beeps, ticks, the round jingle.
function tone(freq, dur, gain, when = 0) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + dur);
  o.connect(g).connect(master);
  o.start(ctx.currentTime + when);
  o.stop(ctx.currentTime + when + dur + 0.02);
}

export const sfx = {
  // distance 0..1: 0 is the player's own gun, 1 is far away.
  shot(def, distance = 0) {
    const v = Math.max(0.08, 1 - distance * 0.85);
    noiseBurst(def.id === 'smg' ? 2400 : 1500, 0.12, 0.9 * v);
    noiseBurst(300, 0.1, 0.7 * v);
  },
  dryFire() { tone(1200, 0.05, 0.15); },
  reload() { tone(700, 0.05, 0.2); tone(500, 0.06, 0.2, 0.15); },
  hit(head) { tone(head ? 1600 : 1100, 0.06, 0.25); },
  kill() { tone(880, 0.09, 0.25); tone(1320, 0.12, 0.2, 0.08); },
  hurt() { noiseBurst(400, 0.08, 0.5); },
  step(distance = 0) { noiseBurst(500, 0.05, Math.max(0.03, 0.16 - distance * 0.14)); },
  plantBeep() { tone(1040, 0.12, 0.3); },
  bombBeep() { tone(1400, 0.07, 0.25); },
  defuseBeep() { tone(780, 0.1, 0.25); },
  flash() { noiseBurst(6000, 0.4, 0.5, 'highpass'); },
  smoke() { noiseBurst(800, 0.5, 0.3); },
  roundWin() { tone(523, 0.14, 0.25); tone(659, 0.14, 0.25, 0.12); tone(784, 0.22, 0.25, 0.24); },
  roundLose() { tone(392, 0.16, 0.22); tone(311, 0.24, 0.22, 0.14); },
  buy() { tone(980, 0.06, 0.2); tone(1240, 0.08, 0.2, 0.06); },
};
