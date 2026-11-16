// rounds.js — one job: the match. Rounds, the economy, and the buy menu's
// rules. A match is first to 7 rounds, at most 12. Each round is a buy phase
// (15s: spend, then move out) and a live phase (100s: plant, defuse, or
// eliminate). Money is the tactics layer: winning pays $3,250, losing pays
// $1,400 plus $500 per consecutive loss (capped at $3,400), kills pay $300,
// planting and defusing pay $300 each. Saving for a rifle is a real decision
// against buying armour and grenades now.

import { WEAPONS, GEAR } from './weapons.js';
import { SPAWNS } from './map.js';
import { BOT_NAMES, makeFighter, resetFighterForRound, BUY_TIME, ROUND_TIME } from './state.js';
import { assignRoles, buyForBot } from './bots.js';

const WIN_BONUS = 3250;
const LOSS_BONUS = 1400;
const LOSS_STREAK_BONUS = 500;
const LOSS_BONUS_CAP = 3400;
export const MAX_MONEY = 16000;
const ROUND_END_TIME = 4.5;

// Build the ten fighters and start round 1. The player is always HELIOS
// (attack): the demo screenshots and the review playthrough start on attack,
// and the plant objective reads best from that side.
export function startMatch(S) {
  S.fighters = [];
  S.fighters.push(makeFighter(0, 'You', 'HELIOS', true, 'entry'));
  let id = 1;
  for (const name of BOT_NAMES.HELIOS) {
    S.fighters.push(makeFighter(id++, name, 'HELIOS', false, 'entry'));
  }
  for (const name of BOT_NAMES.UMBRA) {
    S.fighters.push(makeFighter(id++, name, 'UMBRA', false, 'holder'));
  }
  S.scores = { HELIOS: 0, UMBRA: 0 };
  S.lossStreak = { HELIOS: 0, UMBRA: 0 };
  S.round = 1;
  S.roundLog = [];
  startRound(S);
}

// Set up one round: spawns, roles, bot shopping, the charge on its carrier.
export function startRound(S) {
  const spawns = { HELIOS: [...SPAWNS.HELIOS], UMBRA: [...SPAWNS.UMBRA] };
  for (const f of S.fighters) {
    const [x, z] = spawns[f.team].shift() || [0, 0];
    const yaw = f.team === 'HELIOS' ? Math.PI / 2 : -Math.PI / 2;
    resetFighterForRound(f, x, z, yaw);
    // Keep the weapons bought in earlier rounds; restore full magazines.
    // Grenades are spent each round, so the pouch starts empty and the bots
    // shop for fresh ones in buyForBot.
    for (const wid of f.weapons) {
      const def = WEAPONS[wid];
      f.ammo[wid] = { mag: def.mag, reserve: def.reserve };
    }
    f.grenades = { smoke: 0, flash: 0 };
    if (!f.isPlayer) buyForBot(S, f);
  }
  assignRoles(S);
  S.bomb.state = 'carried';
  S.bomb.site = null;
  S.bomb.timer = 0;
  S.bomb.plantProgress = 0;
  S.bomb.defuseProgress = 0;
  S.bomb.plantBy = null;
  S.bomb.defuseBy = null;
  S.grenades = [];
  S.fx = [];
  S.phase = 'buy';
  S.phaseTime = BUY_TIME;
  S.roundWinner = null;
  S.roundReason = '';
}

// The buy phase is over: the round goes live.
export function startLive(S) {
  if (S.phase !== 'buy') return;
  S.phase = 'live';
  S.phaseTime = ROUND_TIME;
}

// End a round: score, money, the banner, and the next round (or the match).
export function endRound(S, winner, reason) {
  if (S.phase !== 'live') return;
  S.phase = 'roundEnd';
  S.phaseTime = ROUND_END_TIME;
  S.roundWinner = winner;
  S.roundReason = reason;
  S.scores[winner]++;
  const loser = winner === 'HELIOS' ? 'UMBRA' : 'HELIOS';
  S.lossStreak[winner] = 0;
  S.lossStreak[loser]++;
  const lossPay = Math.min(LOSS_BONUS_CAP, LOSS_BONUS + LOSS_STREAK_BONUS * (S.lossStreak[loser] - 1));
  for (const f of S.fighters) {
    f.money = Math.min(MAX_MONEY, f.money + (f.team === winner ? WIN_BONUS : lossPay));
  }
  S.roundLog.push({ round: S.round, winner, reason });
  const p = S.fighters[S.playerId];
  S.fx.push({ type: 'sound', sound: p.team === winner ? 'roundWin' : 'roundLose' });
}

// Advance from the round-end pause: the next round, or the match result.
export function advanceAfterRound(S) {
  if (S.scores.HELIOS >= S.winRounds || S.scores.UMBRA >= S.winRounds || S.round >= S.maxRounds) {
    S.phase = 'matchEnd';
    S.roundWinner = S.scores.HELIOS === S.scores.UMBRA ? 'DRAW'
      : S.scores.HELIOS > S.scores.UMBRA ? 'HELIOS' : 'UMBRA';
    S.roundReason = S.roundWinner === 'DRAW' ? 'Match drawn' : `${S.roundWinner} takes the match`;
    return;
  }
  S.round++;
  startRound(S);
}

// The buy menu's rules: only during the buy phase, only with the money, only
// once per item per round for gear, and a primary replaces the other primary.
export function buyItem(S, f, itemId) {
  if (S.phase !== 'buy') return { ok: false, why: 'The buy phase is over' };
  const weapon = WEAPONS[itemId];
  if (weapon) {
    if (f.weapons.includes(itemId)) return { ok: false, why: 'Already owned' };
    if (f.money < weapon.price) return { ok: false, why: 'Not enough money' };
    // One primary slot: buying a rifle sells the SMG back for nothing.
    if (weapon.slot === 1) {
      f.weapons = f.weapons.filter((w) => WEAPONS[w].slot !== 1);
    }
    f.money -= weapon.price;
    f.weapons.push(itemId);
    f.current = itemId;
    f.ammo[itemId] = { mag: weapon.mag, reserve: weapon.reserve };
    S.fx.push({ type: 'sound', sound: 'buy' });
    return { ok: true };
  }
  const gear = GEAR[itemId];
  if (!gear) return { ok: false, why: 'No such item' };
  if (f.money < gear.price) return { ok: false, why: 'Not enough money' };
  if (itemId === 'smoke' || itemId === 'flash') {
    if (f.grenades[itemId] >= 1) return { ok: false, why: 'Already carrying one' };
    f.money -= gear.price;
    f.grenades[itemId]++;
  } else if (itemId === 'armour') {
    if (f.armour > 0) return { ok: false, why: 'Already wearing armour' };
    f.money -= gear.price;
    f.armour = 100;
  } else if (itemId === 'helmet') {
    if (f.helmet) return { ok: false, why: 'Already wearing a helmet' };
    if (f.armour <= 0) return { ok: false, why: 'Buy the vest first' };
    f.money -= gear.price;
    f.helmet = true;
  }
  S.fx.push({ type: 'sound', sound: 'buy' });
  return { ok: true };
}
