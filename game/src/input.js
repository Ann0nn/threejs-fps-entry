// input.js — one job: the keyboard and mouse. Pointer lock for mouse look,
// WASD movement, firing, reloading, weapon slots, crouch, the buy menu and
// the plant/defuse key. The module owns no game state: it records what the
// player is doing into a plain object the simulation reads each tick, and
// reports one-shot presses (buy, use, slot) as edge-triggered flags the sim
// clears after consuming.

export function createInput() {
  return {
    locked: false, // pointer lock held
    keys: new Set(),
    mouseDX: 0, mouseDY: 0, // accumulated look since the last tick
    firing: false, // mouse held
    pressed: new Set(), // keys pressed since the last tick (edge triggers)
    buyToggle: false, // B pressed since the last tick
    useHeld: false, // E held (plant / defuse)
  };
}

// Wire the listeners. `el` is the canvas container (clicking it locks the
// pointer); `onLockChange` tells main.js the lock state for the start overlay.
export function bindInput(input, el, onLockChange) {
  el.addEventListener('click', () => {
    if (!input.locked) el.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === el;
    onLockChange(input.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  });
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && input.locked) input.firing = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    input.keys.add(k);
    input.pressed.add(k);
    if (k === 'b') input.buyToggle = true;
    if (k === 'e') input.useHeld = true;
    if (k === 'control' || k === ' ') e.preventDefault();
  });
  document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    input.keys.delete(k);
    if (k === 'e') input.useHeld = false;
  });
  // Losing the window clears held keys so the player never runs on alone.
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.firing = false;
    input.useHeld = false;
  });
}

// Drain the accumulated look delta (the sim calls this once per tick).
export function takeLook(input) {
  const dx = input.mouseDX, dy = input.mouseDY;
  input.mouseDX = 0;
  input.mouseDY = 0;
  return [dx, dy];
}

// Was this key pressed since the last tick? Consumes the press.
export function wasPressed(input, key) {
  if (!input.pressed.has(key)) return false;
  input.pressed.delete(key);
  return true;
}
