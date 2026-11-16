// demo.js — one job: the deterministic screenshot mode. ?shot=buy|firefight|
// plant|defuse&seed=7 poses a real mid-match round through the same state the
// playable game uses — same fighters, same sim, same HUD — and the render loop
// keeps running, so the screenshots are real renders of the game's own code,
// not composites. The mode is documented in the README and in index.html: it
// exists so the game can be shown honestly, and so a reviewer can reproduce
// any screenshot with a URL.
//
// Posing rules: every value set here is ordinary match state (positions,
// money, health, phase, timers). Nothing draws outside the game; the
// firefight's tracer and hit marker come from a real fireWeapon call, and the
// plant/defuse bars come from the real bomb state.

import { startMatch } from './rounds.js';
import { player } from './state.js';
import { fireWeapon } from './sim.js';
import { buyForBot } from './bots.js';

export function parseShot() {
  const q = new URLSearchParams(window.location.search);
  const shot = q.get('shot');
  if (!shot || !['buy', 'firefight', 'plant', 'defuse'].includes(shot)) return null;
  return { shot, seed: parseInt(q.get('seed') || '7', 10) || 7 };
}

// Shared mid-match dressing: round 6, HELIOS 3 — UMBRA 2, a kitted player.
function dressPlayer(S) {
  const p = player(S);
  p.money = 4250;
  p.weapons = ['rifle', 'pistol', 'knife'];
  p.current = 'rifle';
  p.ammo.rifle = { mag: 30, reserve: 90 };
  p.ammo.pistol = { mag: 12, reserve: 48 };
  p.armour = 100;
  p.helmet = true;
  p.grenades = { smoke: 1, flash: 1 };
  S.round = 6;
  S.scores = { HELIOS: 3, UMBRA: 2 };
}

// Park a bot at a pose: it holds there (demo mode keeps bots on their
// angles, so the staged moment stays exactly as posed).
function poseBot(S, name, x, z, yaw, state = 'hold') {
  const f = S.fighters.find((b) => b.name === name);
  if (!f) return null;
  f.x = x; f.z = z; f.yaw = yaw;
  f.bot.state = state;
  f.bot.holdX = x; f.bot.holdZ = z; f.bot.holdYaw = yaw;
  f.bot.path = [];
  if (f.weapons.includes('rifle')) f.current = 'rifle';
  else if (f.weapons.includes('smg')) f.current = 'smg';
  return f;
}

function poseTeammates(S, spots) {
  const mates = S.fighters.filter((f) => f.team === 'HELIOS' && !f.isPlayer);
  mates.forEach((f, i) => {
    const s = spots[i % spots.length];
    f.x = s[0]; f.z = s[1]; f.yaw = s[2];
    f.bot.state = 'hold';
    f.bot.holdX = s[0]; f.bot.holdZ = s[1]; f.bot.holdYaw = s[2];
    f.bot.path = [];
  });
}

function poseEnemies(S, spots) {
  const foes = S.fighters.filter((f) => f.team === 'UMBRA');
  foes.forEach((f, i) => {
    const s = spots[i % spots.length];
    f.x = s[0]; f.z = s[1]; f.yaw = s[2];
    f.bot.state = 'hold';
    f.bot.holdX = s[0]; f.bot.holdZ = s[1]; f.bot.holdYaw = s[2];
    f.bot.path = [];
  });
}

function addRadio(S, name, text) {
  S.radio.unshift({ name, text, time: S.time });
  if (S.radio.length > 5) S.radio.length = 5;
}

function addKill(S, text, hs) {
  S.killfeed.unshift({ text, hs: !!hs, time: S.time });
  if (S.killfeed.length > 5) S.killfeed.length = 5;
}

// A scripted death from earlier in the round, made real: the victim is
// actually dead (the team list shows it) and the killer's count agrees, so
// the kill feed, the team list and the radio all tell the same story.
function killFighter(S, victimName, killerName) {
  const victim = S.fighters.find((f) => f.name === victimName);
  const killer = killerName ? S.fighters.find((f) => f.name === killerName) : null;
  if (!victim) return;
  victim.hp = 0;
  victim.alive = false;
  victim.deaths++;
  if (killer) killer.kills++;
}

// Each setup returns {at, fire} — `at` is the sim time to run before the shot
// is ready, and `fire` is an optional function main.js calls once at that
// time (the firefight's real burst).
export function setupShot(S, shot) {
  startMatch(S);
  dressPlayer(S);
  // The bots get a mid-match bankroll and shop like real round-6 players
  // (rifle, armour, helmet, grenades), so the kill feed's weapon names and
  // the damage they take agree with what they are carrying.
  for (const f of S.fighters) {
    if (!f.isPlayer) {
      f.money = 4250;
      buyForBot(S, f);
    }
  }
  const p = player(S);
  S.demo = true;

  if (shot === 'buy') {
    S.phase = 'buy';
    S.phaseTime = 12;
    p.x = -28; p.z = 0; p.yaw = Math.PI / 2; // down Inverter Yard
    poseTeammates(S, [[-26, -3, Math.PI / 2], [-26, 3, Math.PI / 2], [-24, -5, 1.2], [-24, 5, 1.9]]);
    poseEnemies(S, [[29, -3, -Math.PI / 2], [29, 3, -Math.PI / 2], [27, -5, -1.2], [27, 5, -1.9], [28, 0, -Math.PI / 2]]);
    addRadio(S, 'Juno', 'Rifle and armour, we take A this round');
    addRadio(S, 'Maren', 'Holding B long');
    return { at: 0.4 };
  }

  if (shot === 'firefight') {
    S.phase = 'live';
    S.phaseTime = 82;
    p.x = -6; p.z = -14; p.yaw = Math.PI / 2; // down Panel Row toward A
    p.hp = 76;
    poseTeammates(S, [[-10, -12, Math.PI / 2], [-4, -10, 1.2], [-12, -16, Math.PI / 2], [-2, -17, 1.9]]);
    poseEnemies(S, [[4, -14, -Math.PI / 2], [13, -10, -2.2], [18, -17, -Math.PI / 2], [24, -8, -2.4], [26, -18, -Math.PI / 2]]);
    addRadio(S, 'Juno', 'Contact at Panel Row, rotating');
    addKill(S, 'Maren  ▸  Vesper  [HS]   HELIX AR', true);
    addKill(S, 'Rook  ▸  Sable   HELIX AR', false);
    killFighter(S, 'Vesper', 'Maren');
    killFighter(S, 'Sable', 'Rook');
    // The burst: three real shots at the enemy in frame. The sim's raycast,
    // tracer, muzzle flash, hit marker and damage number all come from it.
    return {
      at: 0.5,
      fire() {
        const t = S.fighters.find((b) => b.name === 'Rook');
        if (!t) return;
        // Aim the player at the target's chest, then fire for real. The aim
        // sits a touch low so the burst's recoil climbs through the target
        // instead of over it: the burst lands a headshot and the follow-ups.
        p.yaw = Math.atan2(t.x - p.x, -(t.z - p.z));
        p.pitch = -0.02;
        p.bloom = 0;
        p.speed = 0;
        for (let i = 0; i < 4; i++) {
          p.fireCooldown = 0;
          fireWeapon(S, p);
        }
        p.ammo.rifle.mag = 21;
      },
    };
  }

  if (shot === 'plant') {
    S.phase = 'live';
    S.phaseTime = 48;
    // The player carries the charge and is planting at A, facing the sign.
    S.bomb.carrierId = p.id;
    S.bomb.state = 'carried';
    p.x = 20; p.z = -11; p.yaw = 0; // facing north: sign + panel rows ahead
    p.hp = 88;
    p.planting = true;
    S.bomb.plantBy = p.id;
    S.bomb.plantProgress = 0.62;
    poseTeammates(S, [[16, -17, 2.6], [24, -10, -2.4], [14, -13, 1.9], [22, -18, 0.4]]);
    poseEnemies(S, [[11, -8, 0.8], [5, -14, 1.2], [13, 4, -0.6], [26, 8, -2.0], [28, 0, -Math.PI / 2]]);
    addRadio(S, 'Maren', 'Planting at A, cover the doors');
    addRadio(S, 'Juno', 'Holding Array Hall');
    addKill(S, 'You  ▸  Ilsa  [HS]   HELIX AR', true);
    killFighter(S, 'Ilsa', 'You');
    return { at: 0.4 };
  }

  // defuse: the charge is down at B and an UMBRA bot is on it. The player
  // (HELIOS) is retaking down Service Road: bomb timer, defuse bar, and the
  // defuser in frame.
  S.phase = 'live';
  S.phaseTime = 64;
  S.bomb.state = 'planted';
  S.bomb.site = 'B';
  S.bomb.x = 20; S.bomb.z = 15;
  S.bomb.timer = 32;
  S.bomb.carrierId = null;
  p.x = 12; p.z = 15; p.yaw = Math.PI / 2; // down Service Road toward B
  p.hp = 76;
  p.ammo.rifle.mag = 20;
  const defuser = S.fighters.find((b) => b.name === 'Rook');
  if (defuser) {
    defuser.x = 20; defuser.z = 15; defuser.yaw = -Math.PI / 2;
    defuser.defusing = true;
    defuser.bot.state = 'defuse';
    S.bomb.defuseBy = defuser.id;
    S.bomb.defuseProgress = 0.4;
  }
  poseTeammates(S, [[9, 12, 1.2], [14, 18, 1.9], [6, 15, Math.PI / 2], [16, 11, 0.9]]);
  const others = S.fighters.filter((f) => f.team === 'UMBRA' && f.name !== 'Rook');
  const spots = [[24, 11, -2.2], [26, 18, -2.6], [17, 19, -0.8], [23, 7, -1.4]];
  others.forEach((f, i) => {
    const s = spots[i % spots.length];
    f.x = s[0]; f.z = s[1]; f.yaw = s[2];
    f.bot.state = 'hold';
    f.bot.holdX = s[0]; f.bot.holdZ = s[1]; f.bot.holdYaw = s[2];
    f.bot.path = [];
  });
  addRadio(S, 'Kofi', "They're on the bomb at B!");
  addRadio(S, 'Sable', 'Rotating to B, hold the doors');
  addKill(S, 'Vesper  ▸  Maren   HELIX AR', false);
  killFighter(S, 'Maren', 'Vesper');
  return { at: 0.4 };
}
