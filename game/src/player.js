// player.js — one job: how the player moves and looks. Acceleration-based
// movement (no instant stops), crouching (slower, quieter, tighter spread),
// and circle-vs-wall collision, shared with the bots through map.js.
//
// Speeds: run 5.2 m/s, walk (Shift) 2.6 m/s, crouch 1.9 m/s. The speed feeds
// the gunplay model: effectiveSpread() in weapons.js grows with it, so a
// player who stops to aim shoots straighter than one who sprays on the move.

import { collideCircle } from './map.js';
import { PLAYER_RADIUS } from './state.js';
import { takeLook } from './input.js';

const RUN_SPEED = 5.2;
const WALK_SPEED = 2.6;
const CROUCH_SPEED = 1.9;
const ACCEL = 42; // m/s^2 toward the desired velocity
const FRICTION = 10; // m/s^2 of damping with no input
const LOOK_SENS = 0.0022; // radians per pixel of mouse travel

// One fixed-step tick of player control. Reads the input object, writes the
// fighter's position, velocity and facing. `firing` and weapon handling live
// in sim.js; this module only moves and looks.
export function tickPlayer(S, input, dt) {
  const f = S.fighters[S.playerId];
  if (!f.alive) return;

  // Look: pointer-lock mouse delta turns yaw and pitch; pitch is clamped so
  // the player cannot look past straight up or down.
  const [dx, dy] = takeLook(input);
  f.yaw -= dx * LOOK_SENS;
  f.pitch -= dy * LOOK_SENS;
  f.pitch = Math.max(-1.5, Math.min(1.5, f.pitch));

  // Crouch is a held key (Control or C).
  f.crouch = input.keys.has('control') || input.keys.has('c');

  // Wish direction in world space from the keys, rotated by the facing yaw.
  let ix = 0, iz = 0;
  if (input.keys.has('w')) iz -= 1;
  if (input.keys.has('s')) iz += 1;
  if (input.keys.has('a')) ix -= 1;
  if (input.keys.has('d')) ix += 1;
  const ilen = Math.hypot(ix, iz);
  if (ilen > 0) { ix /= ilen; iz /= ilen; }

  const maxSpeed = f.crouch ? CROUCH_SPEED : input.keys.has('shift') ? WALK_SPEED : RUN_SPEED;
  const sin = Math.sin(f.yaw), cos = Math.cos(f.yaw);
  // Forward is -Z rotated by yaw; right is +X rotated by yaw.
  const wishX = (ix * cos - iz * sin) * maxSpeed;
  const wishZ = (ix * sin + iz * cos) * maxSpeed;

  // Accelerate toward the wish velocity; with no input, friction stops the
  // player over a short slide instead of instantly.
  const rate = ilen > 0 ? ACCEL : FRICTION;
  f.vx += clamp(wishX - f.vx, -rate * dt, rate * dt);
  f.vz += clamp(wishZ - f.vz, -rate * dt, rate * dt);
  f.speed = Math.hypot(f.vx, f.vz);

  const p = [f.x + f.vx * dt, f.z + f.vz * dt];
  collideCircle(p, PLAYER_RADIUS);
  f.x = p[0];
  f.z = p[1];

  // Footstep noise bots can hear: running is loud, walking is quiet, crouch
  // is silent. A step every 0.38s of travel while moving.
  if (f.speed > 0.5 && !f.crouch) {
    f._stepAt = (f._stepAt || 0) + dt * f.speed;
    if (f._stepAt > 2.1) {
      f._stepAt = 0;
      const loud = input.keys.has('shift') ? 6 : 14;
      S.noise.push({ x: f.x, z: f.z, radius: loud, time: S.time });
    }
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
