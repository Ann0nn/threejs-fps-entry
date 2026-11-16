// state.js — one job: the single place game state lives. Every module reads
// and writes this one object, created by createState(); nothing else holds
// match state. The simulation (sim.js) is the only writer during a tick; the
// renderer and HUD only read, which keeps the fixed-step sim apart from
// rendering and makes the demo screenshots reproducible from a seed.
//
// A fighter is the player or a bot. Positions are x/z on the ground plane;
// eye height is derived (1.62 standing, 1.1 crouched). Bots carry their AI in
// `bot`; the player has bot: null.

import { mulberry32 } from './rng.js';
import { WEAPONS } from './weapons.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.1;
export const PLAYER_RADIUS = 0.35;
export const ROUND_TIME = 100; // seconds of live play per round
export const BUY_TIME = 15; // seconds of buy phase per round
export const BOMB_TIME = 40; // seconds from plant to detonation
export const PLANT_TIME = 3.5; // seconds holding E to plant
export const DEFUSE_TIME = 5; // seconds holding E to defuse

export const BOT_NAMES = {
  HELIOS: ['Juno', 'Maren', 'Kofi', 'Sable'],
  UMBRA: ['Rook', 'Vesper', 'Ilsa', 'Dace', 'Tamsin'],
};

export function createState(seed) {
  return {
    seed,
    rng: mulberry32(seed),
    time: 0, // sim seconds since match start
    tick: 0,
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    phaseTime: 0, // seconds left in the current phase
    round: 1,
    maxRounds: 12,
    winRounds: 7,
    scores: { HELIOS: 0, UMBRA: 0 },
    roundWinner: null,
    roundReason: '',
    lossStreak: { HELIOS: 0, UMBRA: 0 },
    fighters: [],
    playerId: 0,
    bomb: {
      state: 'carried', // carried | planted | dropped | gone
      site: null, // 'A' | 'B' while planted
      x: 0, z: 0,
      carrierId: null,
      timer: 0, // seconds to detonation once planted
      plantBy: null, plantProgress: 0,
      defuseBy: null, defuseProgress: 0,
    },
    // Transient per-tick effects the renderer consumes and clears: muzzle
    // flashes, tracers, impacts, sounds. Kept in state (not in the renderer)
    // so the sim is the single author of what happened.
    fx: [],
    // Noise events for bot hearing: {x, z, radius, time}.
    noise: [],
    killfeed: [], // {text, hs, time} newest first, capped
    radio: [], // {name, text, time} newest first, capped
    damageNumbers: [], // {x, y, z, text, hs, time} world-anchored, HUD-projected
    grenades: [], // live grenade projectiles + clouds
    roundLog: [],
  };
}

export function makeFighter(id, name, team, isPlayer, role) {
  const ammo = {};
  for (const def of Object.values(WEAPONS)) {
    ammo[def.id] = { mag: def.mag, reserve: def.reserve };
  }
  return {
    id, name, team, isPlayer, role,
    x: 0, z: 0, yaw: 0, pitch: 0,
    vx: 0, vz: 0, speed: 0,
    hp: 100, armour: 0, helmet: false, alive: true,
    crouch: false,
    money: 800,
    weapons: ['pistol'],
    current: 'pistol',
    ammo,
    grenades: { smoke: 0, flash: 0 },
    kills: 0, deaths: 0,
    // Gunplay state.
    fireCooldown: 0, reloadTimer: 0, bloom: 0,
    recoilPitch: 0, recoilYaw: 0,
    // Objective state.
    planting: false, defusing: false,
    blindUntil: 0, // flashbang: sim seconds until sight returns
    lastHurtBy: null, lastHurtTime: 0,
    // Bot AI (null for the player).
    bot: isPlayer ? null : {
      state: 'route', // route | hold | engage | investigate | plant | defuse | rotate
      path: [], pathI: 0,
      targetId: null, lastSeen: 0, lastSeenX: 0, lastSeenZ: 0,
      reactAt: 0, burstLeft: 0, burstAt: 0,
      holdX: 0, holdZ: 0, holdYaw: 0,
      site: 'A', // assigned site
      lane: 'mid',
      radioAt: 0,
      strafeDir: 1, strafeAt: 0,
    },
  };
}

// The player fighter, by convention fighters[0].
export function player(S) {
  return S.fighters[S.playerId];
}

// Alive fighters of a team.
export function aliveOf(S, team) {
  return S.fighters.filter((f) => f.team === team && f.alive);
}

// Reset a fighter for a new round: health, position and objective state. Money
// and weapons carry over between rounds, as in the economy's rules.
export function resetFighterForRound(f, x, z, yaw) {
  f.x = x; f.z = z; f.yaw = yaw; f.pitch = 0;
  f.vx = 0; f.vz = 0; f.speed = 0;
  f.hp = 100; f.alive = true;
  f.crouch = false;
  f.fireCooldown = 0; f.reloadTimer = 0; f.bloom = 0;
  f.recoilPitch = 0; f.recoilYaw = 0;
  f.planting = false; f.defusing = false;
  f.blindUntil = 0;
  if (f.bot) {
    f.bot.state = 'route';
    f.bot.path = []; f.bot.pathI = 0;
    f.bot.targetId = null; f.bot.lastSeen = 0;
    f.bot.burstLeft = 0;
  }
}
