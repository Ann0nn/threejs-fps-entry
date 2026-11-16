// sim.js — one job: the fixed-step simulation. Everything that happens in a
// round runs through tick(S, input, dt) at a fixed 60 Hz, apart from rendering:
// movement, shooting, grenades, the bomb, the round timer and round-end
// checks. The renderer never writes state; it only reads what the sim wrote,
// which is what makes the game deterministic from a seed and the screenshots
// reproducible.
//
// Shooting is a true analytic raycast: ray vs head sphere (r 0.22 at 1.55m)
// and ray vs body box, occluded by the map's walls (rayWalls). A head hit
// deals damage x4. Bots resolve their own fire with an accuracy roll in
// bots.botShoot; the player's fire is always raycast.

import { WEAPONS, effectiveSpread, damageAfterArmour } from './weapons.js';
import { rayWalls, rayBox, hasLineOfSight, SITES } from './map.js';
import { EYE_STAND, EYE_CROUCH, player, aliveOf, BOMB_TIME, PLANT_TIME, DEFUSE_TIME } from './state.js';
import { tickPlayer } from './player.js';
import { tickBots, damageFighter, radio } from './bots.js';
import { endRound, startLive } from './rounds.js';
import { wasPressed } from './input.js';

// Reused working storage: the hot paths allocate nothing per frame.
const _dir = { x: 0, y: 0, z: 0 };

// The aim direction from yaw/pitch, plus spread. Written into _dir. Yaw 0
// faces north (-Z); yaw PI/2 faces east (+X): forward is (sin yaw, -cos yaw),
// the same convention player.js moves with and bots.js aims with.
function aimDirection(f, spread, rng) {
  const yaw = f.yaw + (rng() - 0.5) * 2 * spread;
  const pitch = f.pitch + (rng() - 0.5) * 2 * spread + f.recoilPitch;
  _dir.x = Math.sin(yaw) * Math.cos(pitch);
  _dir.y = Math.sin(pitch);
  _dir.z = -Math.cos(yaw) * Math.cos(pitch);
  return _dir;
}

// Ray vs a fighter: head sphere first (it pays x4), then the body box.
// Returns {part, dist} or null. `eyeY` is the shooter's eye height.
function rayFighter(ox, oy, oz, dx, dy, dz, maxDist, target) {
  if (!target.alive) return null;
  const crouch = target.crouch;
  const headY = crouch ? 1.05 : 1.55;
  const bodyTop = crouch ? 1.2 : 1.7;
  // Head sphere, radius 0.22.
  const cx = target.x - ox, cy = headY - oy, cz = target.z - oz;
  const tca = cx * dx + cy * dy + cz * dz;
  if (tca > 0) {
    const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
    if (d2 < 0.22 * 0.22) {
      const t = tca - Math.sqrt(0.22 * 0.22 - d2);
      if (t > 0 && t < maxDist) return { part: 'head', dist: t };
    }
  }
  // Body box: 0.55 wide, floor to bodyTop.
  const t = rayBox(ox, oy, oz, dx, dy, dz, target.x - 0.28, bodyTop, target.z - 0.28, target.x + 0.28, target.z + 0.28);
  if (t < maxDist) return { part: 'body', dist: t };
  return null;
}

// One shot from fighter f: spread, raycast, damage, tracer, sound, noise.
// Returns true when a shot actually left the gun.
export function fireWeapon(S, f) {
  const def = WEAPONS[f.current];
  if (f.reloadTimer > 0 || f.fireCooldown > 0) return false;
  const ammo = f.ammo[f.current];
  if (def.melee) {
    // The knife: a short arc in front of the fighter, no ammo, no spread.
    f.fireCooldown = 60 / def.rpm;
    for (const t of S.fighters) {
      if (t.team === f.team || !t.alive) continue;
      const d = Math.hypot(t.x - f.x, t.z - f.z);
      if (d > def.range) continue;
      const wantYaw = Math.atan2(t.x - f.x, -(t.z - f.z));
      let dyaw = wantYaw - f.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      if (Math.abs(dyaw) < 0.7) damageFighter(S, t, def.damage, f, false);
    }
    S.fx.push({ type: 'sound', sound: 'shot', weapon: f.current, x: f.x, z: f.z, dist: f.isPlayer ? 0 : 0.7 });
    return true;
  }
  if (ammo.mag <= 0) {
    S.fx.push({ type: 'sound', sound: 'dryFire' });
    f.fireCooldown = 0.25;
    return false;
  }
  ammo.mag--;
  f.fireCooldown = 60 / def.rpm;
  const eyeY = f.crouch ? EYE_CROUCH : EYE_STAND;
  const speedFrac = Math.min(1, f.speed / 5.2);
  const spread = effectiveSpread(def, speedFrac, f.crouch, f.bloom);
  const dir = aimDirection(f, spread, S.rng);
  // Recoil: the aim kicks up and sideways, and bloom widens the next shots.
  // Both recover over time (see tick), so bursts beat holding the trigger.
  f.recoilPitch += def.recoil * (0.7 + S.rng() * 0.6);
  f.recoilYaw += (S.rng() - 0.5) * def.recoil * 0.6;
  f.bloom = Math.min(1.2, f.bloom + 0.22);

  const wallDist = rayWalls(f.x, eyeY, f.z, dir.x, dir.y, dir.z, def.range, 1.0);
  let best = null, bestFighter = null;
  for (const t of S.fighters) {
    if (t === f || t.team === f.team) continue;
    const hit = rayFighter(f.x, eyeY, f.z, dir.x, dir.y, dir.z, Math.min(wallDist, def.range), t);
    if (hit && (!best || hit.dist < best.dist)) { best = hit; bestFighter = t; }
  }
  const endDist = best ? best.dist : wallDist;
  const ex = f.x + dir.x * endDist, ey = eyeY + dir.y * endDist, ez = f.z + dir.z * endDist;
  S.fx.push({
    type: 'shot', fromId: f.id, x0: f.x, y0: eyeY, z0: f.z,
    x1: ex, y1: ey, z1: ez, color: def.tracer, hit: !!best, head: best && best.part === 'head',
  });
  S.fx.push({ type: 'sound', sound: 'shot', weapon: f.current, x: f.x, z: f.z, dist: f.isPlayer ? 0 : 0.6 });
  S.noise.push({ x: f.x, z: f.z, radius: 30, time: S.time });
  if (bestFighter) {
    const dmg = damageAfterArmour(def, best.part, bestFighter);
    damageFighter(S, bestFighter, dmg, f, best.part === 'head');
  }
  return true;
}

export function startReload(S, f) {
  const def = WEAPONS[f.current];
  if (def.melee || f.reloadTimer > 0) return;
  const ammo = f.ammo[f.current];
  if (ammo.mag >= def.mag || ammo.reserve <= 0) return;
  f.reloadTimer = def.reload;
  S.fx.push({ type: 'sound', sound: 'reload' });
}

// Throw a grenade: a projectile with gravity, a bounce, and a 1.6s fuse.
export function throwGrenade(S, f, type) {
  if (f.grenades[type] <= 0) return;
  f.grenades[type]--;
  const eyeY = f.crouch ? EYE_CROUCH : EYE_STAND;
  const dir = aimDirection(f, 0, S.rng);
  S.grenades.push({
    type, x: f.x, y: eyeY, z: f.z,
    vx: dir.x * 14, vy: dir.y * 14 + 3.5, vz: dir.z * 14,
    fuse: 1.6, owner: f.id,
  });
  S.fx.push({ type: 'sound', sound: 'step', x: f.x, z: f.z });
}

function detonateGrenade(S, g) {
  if (g.type === 'smoke') {
    S.grenades.push({ type: 'cloud', x: g.x, z: g.z, until: S.time + 12 });
    S.fx.push({ type: 'sound', sound: 'smoke', x: g.x, z: g.z });
    S.fx.push({ type: 'smoke', x: g.x, z: g.z });
    return;
  }
  // Flash: anyone with a line of sight to the pop, looking roughly at it,
  // is blinded for 2-4s by distance; the player gets a white overlay.
  S.fx.push({ type: 'sound', sound: 'flash', x: g.x, z: g.z });
  S.fx.push({ type: 'flash', x: g.x, y: g.y, z: g.z });
  for (const f of S.fighters) {
    if (!f.alive) continue;
    const d = Math.hypot(f.x - g.x, f.z - g.z);
    if (d > 26) continue;
    const eyeY = f.crouch ? EYE_CROUCH : EYE_STAND;
    if (!hasLineOfSight(f.x, eyeY, f.z, g.x, g.y, g.z)) continue;
    const wantYaw = Math.atan2(g.x - f.x, -(g.z - f.z));
    let dyaw = wantYaw - f.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const facing = Math.abs(dyaw) < 1.2 ? 1 : 0.4;
    const blind = (4 - d * 0.1) * facing;
    if (blind > 0.4) f.blindUntil = Math.max(f.blindUntil, S.time + blind);
  }
}

function tickGrenades(S, dt) {
  for (let i = S.grenades.length - 1; i >= 0; i--) {
    const g = S.grenades[i];
    if (g.type === 'cloud') {
      if (S.time > g.until) S.grenades.splice(i, 1);
      continue;
    }
    g.vy -= 18 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.15) {
      g.y = 0.15;
      g.vy = -g.vy * 0.4;
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      S.grenades.splice(i, 1);
      detonateGrenade(S, g);
    }
  }
}

// The bomb: pickup, plant, defuse, detonation. In demo mode the bomb state
// is posed (a plant at 62%, a defuse at 40%, a 32s timer) and held exactly.
function tickBomb(S, dt) {
  const b = S.bomb;
  if (S.demo) return;
  if (b.state === 'dropped') {
    for (const f of S.fighters) {
      if (f.team === 'HELIOS' && f.alive && Math.hypot(f.x - b.x, f.z - b.z) < 1.2) {
        b.state = 'carried';
        b.carrierId = f.id;
        break;
      }
    }
    return;
  }
  if (b.state === 'carried' && b.carrierId !== null) {
    const carrier = S.fighters[b.carrierId];
    if (!carrier || !carrier.alive) return;
    const site = carrier.team === 'HELIOS' ? siteAt(carrier.x, carrier.z) : null;
    const planting = carrier.planting && site && carrier.speed < 0.5;
    if (planting) {
      b.plantBy = carrier.id;
      b.plantProgress += dt / PLANT_TIME;
      if (Math.floor(b.plantProgress * 10) !== Math.floor((b.plantProgress - dt / PLANT_TIME) * 10)) {
        S.fx.push({ type: 'sound', sound: 'plantBeep' });
      }
      if (b.plantProgress >= 1) {
        b.state = 'planted';
        b.site = site;
        b.x = carrier.x;
        b.z = carrier.z;
        b.timer = BOMB_TIME;
        b.plantProgress = 0;
        b.carrierId = null;
        carrier.money += 300;
        radio(S, carrier, 'planted');
        S.fx.push({ type: 'sound', sound: 'plantBeep' });
      }
    } else {
      b.plantProgress = 0;
      b.plantBy = null;
    }
    return;
  }
  if (b.state === 'planted') {
    b.timer -= dt;
    // The beep quickens as the timer runs down.
    const interval = b.timer > 20 ? 1 : b.timer > 10 ? 0.5 : 0.25;
    b._beepAt = b._beepAt || 0;
    if (S.time >= b._beepAt) {
      b._beepAt = S.time + interval;
      S.fx.push({ type: 'sound', sound: 'bombBeep' });
    }
    if (b.timer <= 0) {
      b.state = 'gone';
      S.fx.push({ type: 'explosion', x: b.x, z: b.z });
      endRound(S, 'HELIOS', 'Charge detonated');
      return;
    }
    // A defender in the site holding E defuses.
    let defuser = null;
    for (const f of S.fighters) {
      if (f.team !== 'UMBRA' || !f.alive || !f.defusing) continue;
      if (Math.hypot(f.x - b.x, f.z - b.z) < SITES[b.site].radius && f.speed < 0.5) {
        defuser = f;
        break;
      }
    }
    if (defuser) {
      b.defuseBy = defuser.id;
      b.defuseProgress += dt / DEFUSE_TIME;
      if (b.defuseProgress >= 1) {
        b.state = 'gone';
        b.defuseProgress = 0;
        defuser.money += 300;
        endRound(S, 'UMBRA', 'Charge defused');
      }
    } else {
      b.defuseProgress = 0;
      b.defuseBy = null;
    }
  }
}

// Which site (if any) is this position inside?
function siteAt(x, z) {
  for (const [key, s] of Object.entries(SITES)) {
    if (Math.hypot(x - s.x, z - s.z) < s.radius) return key;
  }
  return null;
}

// Player weapon actions for one tick: fire, reload, switch, throw, use.
function tickPlayerActions(S, input, dt) {
  const f = player(S);
  if (!f.alive) return;
  // Semi-automatic weapons fire on the rising edge of the mouse; automatics
  // fire while held.
  const def = WEAPONS[f.current];
  const rising = input.firing && !input._prevFiring;
  input._prevFiring = input.firing;
  if (S.phase === 'live' && (def.auto ? input.firing : rising)) fireWeapon(S, f);

  if (wasPressed(input, 'r')) startReload(S, f);
  if (wasPressed(input, '1')) switchTo(S, f, 1);
  if (wasPressed(input, '2')) switchTo(S, f, 2);
  if (wasPressed(input, '3')) switchTo(S, f, 3);
  if (wasPressed(input, '4') && S.phase === 'live') throwGrenade(S, f, 'smoke');
  if (wasPressed(input, '5') && S.phase === 'live') throwGrenade(S, f, 'flash');

  // Use (E held): plant when carrying the charge in a site, defuse when a
  // defender stands on the planted charge. In demo mode the pose is staged
  // by demo.js, so the flags are left exactly as posed.
  if (S.demo) return;
  f.planting = false;
  f.defusing = false;
  if (input.useHeld && S.phase === 'live') {
    if (S.bomb.carrierId === f.id && siteAt(f.x, f.z)) f.planting = true;
    if (S.bomb.state === 'planted' && f.team === 'UMBRA' && Math.hypot(f.x - S.bomb.x, f.z - S.bomb.z) < SITES[S.bomb.site].radius) {
      f.defusing = true;
    }
  }
}

function switchTo(S, f, slot) {
  const owned = f.weapons.map((id) => WEAPONS[id]).filter((w) => w.slot === slot);
  if (owned.length === 0) return;
  const next = owned[0];
  if (f.current !== next.id) {
    f.current = next.id;
    f.reloadTimer = 0;
  }
}

// Reload completion for every fighter, in one place.
function tickReloads(S, dt) {
  for (const f of S.fighters) {
    if (f.reloadTimer <= 0) continue;
    f.reloadTimer -= dt;
    if (f.reloadTimer > 0) continue;
    const def = WEAPONS[f.current];
    const ammo = f.ammo[f.current];
    const take = Math.min(def.mag - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
  }
}

// Recoil and bloom recover over time, so bursts stay accurate and long sprays
// climb. Recovery is per second, tuned so a 3-round burst is back on target
// in about half a second.
function tickRecoil(S, dt) {
  for (const f of S.fighters) {
    f.bloom = Math.max(0, f.bloom - dt * 2.2);
    f.recoilPitch = approach(f.recoilPitch, 0, dt * 0.09);
    f.recoilYaw = approach(f.recoilYaw, 0, dt * 0.09);
  }
}

function approach(v, target, step) {
  if (v > target) return Math.max(target, v - step);
  return Math.min(target, v + step);
}

// Round-end checks during live play. Elimination ends the round at once,
// unless the bomb is planted: then the defenders must defuse or die.
function checkRoundEnd(S) {
  if (S.phase !== 'live') return;
  const helios = aliveOf(S, 'HELIOS').length;
  const umbra = aliveOf(S, 'UMBRA').length;
  const planted = S.bomb.state === 'planted';
  if (!planted && helios === 0) endRound(S, 'UMBRA', 'HELIOS eliminated');
  else if (!planted && umbra === 0) endRound(S, 'HELIOS', 'UMBRA eliminated');
  else if (planted && umbra === 0) endRound(S, 'HELIOS', 'Defenders eliminated');
}

// The master fixed-step tick. Called at 60 Hz from main.js.
export function tick(S, input, dt) {
  S.time += dt;
  S.tick++;
  if (S.phase === 'menu' || S.phase === 'matchEnd') return;

  tickPlayer(S, input, dt);
  tickPlayerActions(S, input, dt);
  if (S.phase === 'live') tickBots(S, dt);
  tickReloads(S, dt);
  tickRecoil(S, dt);
  tickGrenades(S, dt);
  if (S.phase === 'live') tickBomb(S, dt);

  // Phase timers. The round clock stops once the bomb is planted: the bomb's
  // own timer decides the round from then on.
  if (S.phase === 'buy') {
    S.phaseTime -= dt;
    if (S.phaseTime <= 0) startLive(S);
  } else if (S.phase === 'live') {
    if (S.bomb.state !== 'planted') {
      S.phaseTime -= dt;
      if (S.phaseTime <= 0) endRound(S, 'UMBRA', 'Time expired');
    }
  } else if (S.phase === 'roundEnd') {
    S.phaseTime -= dt;
  }

  checkRoundEnd(S);

  // Age out transient lists. Noise older than 2s is forgotten; damage numbers
  // live 0.9s; the kill feed keeps 6s, the radio 8s.
  for (let i = S.noise.length - 1; i >= 0; i--) {
    if (S.time - S.noise[i].time > 2) S.noise.splice(i, 1);
  }
  for (let i = S.damageNumbers.length - 1; i >= 0; i--) {
    if (S.time - S.damageNumbers[i].time > 0.9) S.damageNumbers.splice(i, 1);
  }
  for (let i = S.killfeed.length - 1; i >= 0; i--) {
    if (S.time - S.killfeed[i].time > 6) S.killfeed.splice(i, 1);
  }
  for (let i = S.radio.length - 1; i >= 0; i--) {
    if (S.time - S.radio[i].time > 8) S.radio.splice(i, 1);
  }
}
