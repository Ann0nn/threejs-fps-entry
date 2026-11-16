// main.js — one job: boot the game and run the loop. The loop is a fixed-step
// simulation (60 Hz, accumulated, capped so a slow frame never spirals) with
// rendering apart from it: each animation frame runs as many sim ticks as the
// elapsed time needs, then draws once. Buy-menu keys are consumed before the
// sim sees them; the sim's effects are consumed by the renderer and the HUD
// after the ticks, then cleared. Nothing else lives here.

import { createState, player, BUY_TIME } from './state.js';
import { createInput, bindInput } from './input.js';
import { tick } from './sim.js';
import { startMatch, advanceAfterRound } from './rounds.js';
import { createRenderer, consumeFx, renderFrame } from './render.js';
import { createHud, updateHud, consumeHudFx, handleBuyKeys, toggleBuy, setBuyOpen, buyFromMenu } from './hud.js';
import { ensureAudio } from './audio.js';
import { parseShot, setupShot } from './demo.js';

const STEP = 1 / 60; // fixed sim step: 60 Hz
const MAX_FRAME = 0.1; // a slow frame never advances the sim more than this

const shot = parseShot();
const seed = shot ? shot.seed : (Date.now() % 100000);
const S = createState(seed);
const input = createInput();

let R;
try {
  R = createRenderer(document.getElementById('game'));
} catch (e) {
  window.__shotError = 'WebGL failed: ' + String(e && e.message || e);
  document.getElementById('overlay-copy').textContent =
    'WebGL 2 is not available in this browser, so SUNFALL cannot start here.';
  throw e;
}

const H = createHud({
  onBuy: (itemId) => buyFromMenu(S, H, itemId),
});

bindInput(input, document.getElementById('game'), (locked) => {
  // Losing pointer lock mid-round re-opens the start overlay as a pause.
  if (!locked && S.phase !== 'menu' && !shot) {
    document.getElementById('overlay').hidden = false;
    document.getElementById('overlay-title').textContent = 'Paused';
    document.getElementById('overlay-copy').textContent = 'Click to play on.';
    document.getElementById('play').textContent = 'Resume';
  }
});

document.getElementById('play').addEventListener('click', () => {
  ensureAudio();
  document.getElementById('overlay').hidden = true;
  document.getElementById('game').requestPointerLock();
  if (S.phase === 'menu') {
    // The match is already set up behind the menu (see below): Play just
    // opens the buy phase.
    S.phase = 'buy';
    S.phaseTime = BUY_TIME;
  } else if (S.phase === 'matchEnd') {
    startMatch(S);
  }
});

// The match is set up at boot and held in the menu phase, so the start
// overlay sits over a live view of the map from the HELIOS spawn instead of
// a black screen. Demo mode replaces it with its posed round.
let demoPlan = null;
let demoFired = false;
let framesRendered = 0;
if (shot) {
  document.getElementById('overlay').hidden = true;
  demoPlan = setupShot(S, shot.shot);
  if (shot.shot === 'buy') setBuyOpen(H, true);
  window.__shotName = shot.shot;
} else {
  startMatch(S);
  S.phase = 'menu';
}

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const frameDt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;

  // B toggles the buy menu (buy phase only); buy-menu keys are consumed here
  // so the sim never sees them as weapon switches.
  if (input.buyToggle) {
    input.buyToggle = false;
    toggleBuy(H, S);
  }
  handleBuyKeys(H, S, input);

  // Fixed-step simulation. Once a demo shot is flagged ready, the sim freezes:
  // the screenshot captures the posed moment exactly, muzzle flash and all,
  // instead of the moment after it.
  const frozen = !!(shot && window.__shotReady);
  if (!frozen) {
    acc += frameDt;
    let steps = 0;
    while (acc >= STEP && steps < 8) {
      tick(S, input, STEP);
      acc -= STEP;
      steps++;
      // The round-end pause advances to the next round (or the match result).
      if (S.phase === 'roundEnd' && S.phaseTime <= 0) advanceAfterRound(S);
    }
    if (steps === 8) acc = 0; // never spiral on a slow frame
  }

  // The demo's scripted moment: once the sim reaches it, fire, then flag the
  // shot ready on the frame that draws it — muzzle flash, tracer, hit marker
  // and damage number all in the same rendered frame.
  if (demoPlan && !demoFired && S.time >= demoPlan.at) {
    demoFired = true;
    if (demoPlan.fire) demoPlan.fire();
  }

  consumeFx(R, S);
  consumeHudFx(H, S);
  S.fx.length = 0;
  renderFrame(R, S, frozen ? 0 : frameDt, frozen);
  updateHud(H, S, R, frameDt);
  framesRendered++;

  // The shot is ready on the first frame drawn after the scripted moment:
  // the effects it fired are in this frame's render and HUD.
  if (shot && !window.__shotReady && demoFired && framesRendered >= 2) {
    window.__shotReady = true;
  }
}

requestAnimationFrame(frame);
