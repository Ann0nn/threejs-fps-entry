// bots.js — one job: the nine bots' brains. Each bot has a visible role
// (entry fragger, angle holder, planter, rotator) and a state machine:
//
//   route       follow the waypoint graph to its lane's objective
//   hold        sit on an angle, sweeping slowly, waiting for a push
//   engage      an enemy is seen: aim, burst fire, strafe between shots
//   investigate a shot or a footstep was heard: go and look
//   plant       the carrier stands in a site and plants the charge
//   defuse      a defender stands on the planted charge and defuses it
//   rotate      the bomb is down elsewhere: move to the other site
//
// Perception is honest: a bot sees only what is in front of it, within range,
// with a clear line of sight (map.hasLineOfSight, which smoke also blocks),
// and it hears gunfire and footsteps through the sim's noise events. Bots
// talk on the radio, naming what they do, so their tactics are legible in the
// HUD and in the screenshots.

import { WAYPOINTS, nearestWaypoint, findPath, hasLineOfSight, collideCircle, calloutAt, SITES } from './map.js';
import { WEAPONS, damageAfterArmour } from './weapons.js';
import { EYE_STAND, PLAYER_RADIUS } from './state.js';
import { pick, intBetween } from './rng.js';

const BOT_SPEED = 4.6;
const SIGHT_RANGE = 46;
const SIGHT_FOV = 1.9; // radians of half-angle: a wide but not omniscient cone
const HEAR_SHOT = 30; // gunfire is heard this far
const SMOKE_RADIUS = 3.5;

// Role lines the bots say on the radio. The callout is filled in per line.
const LINES = {
  contact: ['Contact at {c}', 'Enemy at {c}', 'They are pushing {c}'],
  heard: ['Steps heard, {c}', 'Noise at {c}, checking it out', 'Heard shots at {c}'],
  plant: ['Planting at {c}', 'Charge going down at {c}', 'Cover me, planting {c}'],
  rotate: ['Rotating to {c}', 'Moving to {c}', 'Bomb is {c}, rotating'],
  hold: ['Holding {c}', 'On {c} long', 'Watching {c}'],
  planted: ['Charge is down at {c}', 'Bomb planted {c}, hold the site'],
};

export function radio(S, f, kind) {
  // Only the player's own team talks on the radio: hearing the enemy's
  // callouts would leak their positions and read as a bug.
  if (f.team !== 'HELIOS') return;
  if (S.time < f.bot.radioAt) return;
  f.bot.radioAt = S.time + 6 + S.rng() * 4;
  const line = pick(S.rng, LINES[kind]).replace('{c}', calloutAt(f.x, f.z));
  S.radio.unshift({ name: f.name, text: line, time: S.time });
  if (S.radio.length > 5) S.radio.length = 5;
}

// Assign roles, lanes and sites at the start of a round. HELIOS attacks one
// site (the planter's), with entries ahead of the carrier; UMBRA holds both.
export function assignRoles(S) {
  const rng = S.rng;
  const attackSite = rng() < 0.5 ? 'A' : 'B';
  const lanes = ['north', 'mid', 'south'];
  const helios = S.fighters.filter((f) => f.team === 'HELIOS' && !f.isPlayer);
  const umbra = S.fighters.filter((f) => f.team === 'UMBRA');
  const carrier = helios[intBetween(rng, 0, helios.length - 1)];
  S.bomb.carrierId = carrier.id;
  for (const f of helios) {
    const b = f.bot;
    b.site = attackSite;
    b.lane = pick(rng, lanes);
    b.state = 'route';
    b.holdX = 0; b.holdZ = 0;
    if (f === carrier) {
      f.role = 'planter';
      b.lane = attackSite === 'A' ? 'north' : 'south';
    } else if (f.role !== 'entry' && f.role !== 'rotator') {
      f.role = rng() < 0.6 ? 'entry' : 'rotator';
    }
  }
  // UMBRA: two hold A, two hold B, one floats mid and rotates.
  const holds = [
    ['aHold', 'A'], ['aHold', 'A'], ['bHold', 'B'], ['bHold', 'B'], ['eastMid', null],
  ];
  umbra.forEach((f, i) => {
    const [wp, site] = holds[i % holds.length];
    const w = WAYPOINTS.find((w) => w[0] === wp);
    f.bot.holdX = w[1];
    f.bot.holdZ = w[2];
    f.bot.site = site || (rng() < 0.5 ? 'A' : 'B');
    f.bot.state = 'route';
    f.role = site ? 'holder' : 'rotator';
  });
}

// Bots spend their money like players do: rifle when they can afford it, SMG
// when they cannot, armour with what is left, a grenade when rich.
export function buyForBot(S, f) {
  const rng = S.rng;
  const primary = f.money >= 2700 ? 'rifle' : f.money >= 1200 ? 'smg' : null;
  if (primary && !f.weapons.includes(primary)) {
    f.money -= WEAPONS[primary].price;
    f.weapons.push(primary);
    f.current = primary;
  }
  if (f.money >= 650 && f.armour === 0) {
    f.money -= 650;
    f.armour = 100;
  }
  // The helmet is its own purchase: a bot that already owns a vest still
  // buys one (nesting it inside the vest branch left every bot unhelmeted
  // after round one).
  if (!f.helmet && f.armour > 0 && f.money >= 350) {
    f.money -= 350;
    f.helmet = true;
  }
  if (f.money >= 300 && rng() < 0.5) { f.money -= 300; f.grenades.smoke++; }
  else if (f.money >= 200 && rng() < 0.4) { f.money -= 200; f.grenades.flash++; }
  const def = WEAPONS[f.current];
  f.ammo[f.current] = { mag: def.mag, reserve: def.reserve };
}

// Is the segment from (ax,ay,az) to (bx,by,bz) blocked by a smoke cloud?
function blockedBySmoke(S, ax, ay, az, bx, by, bz) {
  for (const g of S.grenades) {
    if (g.type !== 'cloud' || S.time > g.until) continue;
    // Closest distance from the cloud centre to the segment.
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const len2 = abx * abx + aby * aby + abz * abz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((g.x - ax) * abx + (1.5 - ay) * aby + (g.z - az) * abz) / len2)) : 0;
    const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
    const d2 = (g.x - cx) ** 2 + (1.5 - cy) ** 2 + (g.z - cz) ** 2;
    if (d2 < SMOKE_RADIUS * SMOKE_RADIUS) return true;
  }
  return false;
}

// Can this bot see that fighter right now? Range, facing cone, walls, smoke,
// and no flashbang blindness. Crouching targets read slightly smaller.
export function canSee(S, bot, target) {
  if (!target.alive || S.time < bot.blindUntil) return false;
  const dx = target.x - bot.x, dz = target.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > SIGHT_RANGE) return false;
  const wantYaw = Math.atan2(dx, -dz);
  let dyaw = wantYaw - bot.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  if (Math.abs(dyaw) > SIGHT_FOV) return false;
  const eyeY = EYE_STAND, chestY = target.crouch ? 1.0 : 1.3;
  if (!hasLineOfSight(bot.x, eyeY, bot.z, target.x, chestY, target.z)) return false;
  if (blockedBySmoke(S, bot.x, eyeY, bot.z, target.x, chestY, target.z)) return false;
  return true;
}

// Move a bot toward (tx, tz) at bot speed, with wall collision. Returns true
// when it arrives within 0.4m.
function moveToward(S, f, tx, tz, dt) {
  const dx = tx - f.x, dz = tz - f.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.4) { f.speed = 0; return true; }
  const sp = Math.min(BOT_SPEED, dist * 2.5);
  f.vx = (dx / dist) * sp;
  f.vz = (dz / dist) * sp;
  f.speed = sp;
  const p = [f.x + f.vx * dt, f.z + f.vz * dt];
  collideCircle(p, PLAYER_RADIUS);
  f.x = p[0];
  f.z = p[1];
  // Face where it walks, unless it is aiming at someone.
  if (!f.bot.targetId) f.yaw = Math.atan2(dx, -dz);
  return false;
}

// Follow the bot's waypoint path. Recomputes the path when it has none.
function followPath(S, f, goalWp, dt) {
  const b = f.bot;
  if (b.path.length === 0 || b.pathI >= b.path.length) {
    const from = nearestWaypoint(f.x, f.z);
    b.path = findPath(from, goalWp);
    b.pathI = 0;
    if (b.path.length === 0) return true; // already there
  }
  const wp = WAYPOINTS[b.path[b.pathI]];
  if (moveToward(S, f, wp[1], wp[2], dt)) b.pathI++;
  return b.pathI >= b.path.length;
}

// One bot shot at its target: an accuracy roll, not a hitscan cheat. Base
// accuracy falls with distance and target speed; the bot's own movement and
// the target crouching move it further. A headshot lands 12% of hits.
function botShoot(S, f, target) {
  const def = WEAPONS[f.current];
  if (def.melee) return;
  const ammo = f.ammo[f.current];
  if (ammo.mag <= 0) {
    if (f.reloadTimer <= 0) {
      f.reloadTimer = def.reload;
      S.fx.push({ type: 'sound', sound: 'reload', x: f.x, z: f.z });
    }
    return;
  }
  ammo.mag--;
  f.fireCooldown = 60 / def.rpm;
  const dist = Math.hypot(target.x - f.x, target.z - f.z);
  let acc = 0.62 - dist * 0.008 - target.speed * 0.03 - f.speed * 0.04;
  if (target.crouch) acc -= 0.08;
  acc = Math.max(0.06, Math.min(0.85, acc));
  const hit = S.rng() < acc;
  const head = hit && S.rng() < 0.12;
  // The tracer always flies: to the target on a hit, wide on a miss.
  const miss = hit ? 0 : 0.6 + S.rng() * 0.9;
  const tx = target.x + (S.rng() - 0.5) * miss * 2;
  const tz = target.z + (S.rng() - 0.5) * miss * 2;
  S.fx.push({
    type: 'shot', fromId: f.id, x0: f.x, y0: EYE_STAND, z0: f.z,
    x1: tx, y1: head ? 1.55 : 1.2, z1: tz, color: def.tracer, hit, head,
  });
  S.noise.push({ x: f.x, z: f.z, radius: HEAR_SHOT, time: S.time });
  if (!hit) return;
  const dmg = damageAfterArmour(def, head ? 'head' : 'body', target);
  damageFighter(S, target, dmg, f, head);
}

// Apply damage to a fighter: health, armour wear, death, kill feed, money.
export function damageFighter(S, target, dmg, attacker, head) {
  if (!target.alive) return;
  target.hp -= dmg;
  target.lastHurtBy = attacker ? attacker.id : null;
  target.lastHurtTime = S.time;
  if (target.armour > 0) target.armour = Math.max(0, target.armour - Math.ceil(dmg * 0.5));
  S.damageNumbers.push({
    x: target.x, y: head ? 1.9 : 1.4, z: target.z,
    text: head ? `HEAD x4 ${dmg}` : `${dmg}`, hs: head, time: S.time,
  });
  if (attacker && attacker.isPlayer) S.fx.push({ type: 'hitmarker', head });
  if (target.hp > 0) {
    if (target.isPlayer) S.fx.push({ type: 'hurt' });
    return;
  }
  target.hp = 0;
  target.alive = false;
  target.deaths++;
  if (attacker) {
    attacker.kills++;
    attacker.money += 300; // kill bonus
  }
  const weapon = attacker ? WEAPONS[attacker.current].name : '';
  S.killfeed.unshift({
    text: `${attacker ? attacker.name : '—'}  ▸  ${target.name}${head ? '  [HS]' : ''}   ${weapon}`,
    hs: head, time: S.time,
  });
  if (S.killfeed.length > 5) S.killfeed.length = 5;
  if (attacker && attacker.isPlayer) S.fx.push({ type: 'sound', sound: 'kill' });
  // The bomb drops where the carrier died: the nearest living attacker picks
  // it up by walking over it (the sim handles pickup).
  if (S.bomb.carrierId === target.id && S.bomb.state === 'carried') {
    S.bomb.carrierId = null;
    S.bomb.state = 'dropped';
    S.bomb.x = target.x;
    S.bomb.z = target.z;
  }
}

// Pick the visible enemy this bot should shoot: the nearest one it can see.
function acquireTarget(S, f) {
  let best = null, bd = Infinity;
  for (const t of S.fighters) {
    if (t.team === f.team || !t.alive) continue;
    if (!canSee(S, f, t)) continue;
    const d = (t.x - f.x) ** 2 + (t.z - f.z) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

// The newest noise this bot can hear (gunfire or footsteps within radius).
function hearNoise(S, f) {
  let best = null;
  for (const n of S.noise) {
    if (S.time - n.time > 1.2) continue;
    const d = Math.hypot(n.x - f.x, n.z - f.z);
    if (d < n.radius && (!best || n.time > best.time)) best = n;
  }
  return best;
}

// One fixed-step tick for every bot.
export function tickBots(S, dt) {
  for (const f of S.fighters) {
    if (f.isPlayer || !f.alive) continue;
    const b = f.bot;
    if (f.reloadTimer > 0) {
      f.reloadTimer -= dt;
      if (f.reloadTimer <= 0) {
        const def = WEAPONS[f.current];
        const need = def.mag - f.ammo[f.current].mag;
        const take = Math.min(need, f.ammo[f.current].reserve);
        f.ammo[f.current].mag += take;
        f.ammo[f.current].reserve -= take;
      }
    }
    f.fireCooldown -= dt;
    // Planting and defusing are per-tick states: the plant/defuse cases below
    // set them, everything else clears them, so a bot that breaks off to fight
    // stops the objective the same tick.
    f.planting = false;
    f.defusing = false;

    // In demo mode the bots hold their poses for the camera: they do not
    // acquire targets or leave their angles.
    const target = S.demo ? null : acquireTarget(S, f);
    if (target) {
      b.targetId = target.id;
      b.lastSeen = S.time;
      b.lastSeenX = target.x;
      b.lastSeenZ = target.z;
      if (b.state !== 'engage') {
        b.state = 'engage';
        b.reactAt = S.time + 0.35 + S.rng() * 0.3;
        b.burstLeft = 0;
        radio(S, f, 'contact');
      }
    } else if (b.state === 'engage' && S.time - b.lastSeen > 2.5) {
      b.targetId = null;
      b.state = 'investigate';
      b.path = [];
    }

    switch (b.state) {
      case 'route': {
        const goal = goalWaypoint(S, f);
        if (followPath(S, f, goal, dt)) {
          if (f.team === 'UMBRA') { b.state = 'hold'; b.holdYaw = f.yaw; radio(S, f, 'hold'); }
          else if (S.bomb.carrierId === f.id && atSite(S, f, b.site)) { b.state = 'plant'; radio(S, f, 'plant'); }
          else { b.state = 'hold'; b.holdYaw = f.yaw; }
        }
        break;
      }
      case 'hold': {
        f.speed = 0;
        // Sweep the angle slowly: a holder watches, it does not stare.
        f.yaw = b.holdYaw + Math.sin(S.time * 0.35 + f.id) * 0.5;
        // A holder leaves its angle for a noise only sometimes, and at most
        // once every few seconds — otherwise every footstep unpeels the site.
        // In demo mode holders stay posed for the camera.
        const noise = hearNoise(S, f);
        if (noise && !S.demo && S.time >= (b.nextHearCheck || 0)) {
          b.nextHearCheck = S.time + 2 + S.rng() * 3;
          if (S.rng() < 0.4) {
            b.state = 'investigate';
            b.lastSeenX = noise.x; b.lastSeenZ = noise.z;
            radio(S, f, 'heard');
          }
        }
        // The planter holds at the site until its entry has cleared it, then
        // plants. A carrier that reaches its site plants at once.
        if (S.bomb.carrierId === f.id && atSite(S, f, b.site)) {
          b.state = 'plant';
          radio(S, f, 'plant');
        }
        break;
      }
      case 'engage': {
        if (!target) { b.state = 'investigate'; b.path = []; break; }
        // Face the target, strafe between bursts, fire in bursts of 3-5.
        f.yaw = Math.atan2(target.x - f.x, -(target.z - f.z));
        if (S.time > b.strafeAt) {
          b.strafeAt = S.time + 0.7 + S.rng() * 0.6;
          b.strafeDir = S.rng() < 0.5 ? -1 : 1;
        }
        const sx = Math.cos(f.yaw) * b.strafeDir, sz = -Math.sin(f.yaw) * b.strafeDir;
        const p = [f.x + sx * BOT_SPEED * 0.5 * dt, f.z + sz * BOT_SPEED * 0.5 * dt];
        collideCircle(p, PLAYER_RADIUS);
        f.x = p[0]; f.z = p[1];
        f.speed = BOT_SPEED * 0.5;
        if (S.time >= b.reactAt && f.fireCooldown <= 0 && f.reloadTimer <= 0) {
          if (b.burstLeft <= 0) {
            b.burstLeft = 3 + intBetween(S.rng, 0, 2);
            b.burstAt = S.time + 0.5 + S.rng() * 0.4;
          }
          if (S.time >= b.burstAt || b.burstLeft >= 3) {
            botShoot(S, f, target);
            b.burstLeft--;
            if (b.burstLeft <= 0) b.burstAt = S.time + 0.5 + S.rng() * 0.5;
          }
        }
        break;
      }
      case 'investigate': {
        const arrived = moveToward(S, f, b.lastSeenX, b.lastSeenZ, dt);
        if (arrived) {
          b.state = f.team === 'UMBRA' ? 'hold' : 'route';
          b.holdYaw = f.yaw;
          b.path = [];
        }
        break;
      }
      case 'plant': {
        f.planting = true;
        f.speed = 0;
        break;
      }
      case 'defuse': {
        f.defusing = true;
        f.speed = 0;
        break;
      }
      case 'rotate': {
        const goal = goalWaypoint(S, f);
        if (followPath(S, f, goal, dt)) {
          if (S.bomb.state === 'planted' && atSite(S, f, S.bomb.site)) {
            b.state = 'defuse';
          } else {
            b.state = 'hold';
            b.holdYaw = f.yaw;
          }
        }
        break;
      }
    }

    // The bomb going down re-tasks every defender: rotate to the planted site.
    if (S.bomb.state === 'planted' && f.team === 'UMBRA' && b.state !== 'defuse' && b.state !== 'engage') {
      if (b.state !== 'rotate' || b.site !== S.bomb.site) {
        b.site = S.bomb.site;
        b.state = 'rotate';
        b.path = [];
        radio(S, f, 'rotate');
      }
    }
  }
}

// The waypoint this bot is walking toward right now.
function goalWaypoint(S, f) {
  const b = f.bot;
  if (f.team === 'UMBRA') {
    if (S.bomb.state === 'planted') return S.bomb.site === 'A' ? 14 : 15; // siteA/siteB
    if (b.state === 'rotate') return b.site === 'A' ? 14 : 15;
    return WAYPOINTS.findIndex((w) => w[1] === b.holdX && w[2] === b.holdZ);
  }
  // HELIOS: lane waypoint first, then the site.
  const laneWp = b.lane === 'north' ? 6 : b.lane === 'south' ? 8 : 7; // gaps
  const siteWp = b.site === 'A' ? 14 : 15;
  const atLane = Math.abs(f.x - WAYPOINTS[laneWp][1]) < 2 && Math.abs(f.z - WAYPOINTS[laneWp][2]) < 2;
  const pastMid = f.x > 2;
  if (!pastMid && !atLane) return laneWp;
  return siteWp;
}

// Is this fighter standing inside its assigned site's radius?
function atSite(S, f, site) {
  const s = SITES[site];
  return Math.hypot(f.x - s.x, f.z - s.z) < s.radius;
}
