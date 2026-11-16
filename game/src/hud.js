// hud.js — one job: the DOM layer. Health, armour, cash, ammo, the round
// timer and scores, the minimap, the kill feed, radio chatter, the dynamic
// crosshair, hit markers, floating damage numbers, the plant/defuse bars,
// the buy menu and the round banners. The HUD reads state and never writes
// match state (buying goes through rounds.buyItem, which validates it).
//
// The minimap is a 2D canvas drawn from the same WALLS data the simulation
// collides with, so the map on screen is the map in the world.

import * as THREE from 'three';
import { WEAPONS, GEAR, effectiveSpread } from './weapons.js';
import { WALLS, SITES, MAP, calloutAt } from './map.js';
import { player } from './state.js';
import { buyItem } from './rounds.js';
import { wasPressed } from './input.js';

const $ = (id) => document.getElementById(id);
const BUY_KEYS = ['rifle', 'smg', 'pistol', 'armour', 'helmet', 'smoke', 'flash'];

export function createHud(callbacks) {
  const H = {
    callbacks,
    buyOpen: false,
    hitAt: 0, hitHead: false,
    hurtAt: 0,
    lastFeed: '', lastRadio: '', lastTeam: '',
    dmgPool: [],
    minimap: $('minimap').getContext('2d'),
  };
  // Damage-number pool: 8 reusable divs, projected from world space.
  for (let i = 0; i < 8; i++) {
    const d = document.createElement('div');
    d.className = 'dmg';
    d.style.display = 'none';
    $('damage-layer').appendChild(d);
    H.dmgPool.push(d);
  }
  // Buy menu buttons.
  $('buy-grid').innerHTML = BUY_KEYS.map((id, i) => {
    const item = WEAPONS[id] || GEAR[id];
    return `<button class="buy-item" data-item="${id}">
      <span class="buy-key">${i + 1}</span>
      <span class="buy-name">${item.name}</span>
      <span class="buy-blurb">${buyBlurb(id)}</span>
      <span class="buy-price">$${item.price}</span>
    </button>`;
  }).join('');
  $('buy-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-item]');
    if (btn) H.callbacks.onBuy(btn.dataset.item);
  });
  $('buy-close').addEventListener('click', () => setBuyOpen(H, false));
  return H;
}

function buyBlurb(id) {
  const w = WEAPONS[id];
  if (!w) return GEAR[id].blurb;
  if (w.melee) return 'Silent, 55 damage up close';
  return `${w.damage} dmg · ${w.mag} rounds · ${w.rpm} rpm`;
}

export function setBuyOpen(H, open) {
  H.buyOpen = open;
  $('buy-menu').hidden = !open;
  if (open) document.exitPointerLock?.();
}

export function toggleBuy(H, S) {
  if (S.phase !== 'buy' && !H.buyOpen) return;
  setBuyOpen(H, !H.buyOpen);
}

// Buy-menu keys, consumed before the sim sees them (main.js calls this first
// each frame): 1-7 buy, B or Escape closes.
export function handleBuyKeys(H, S, input) {
  if (!H.buyOpen) return;
  if (wasPressed(input, 'escape') || wasPressed(input, 'b')) {
    setBuyOpen(H, false);
    return;
  }
  for (let i = 0; i < BUY_KEYS.length; i++) {
    if (wasPressed(input, String(i + 1))) H.callbacks.onBuy(BUY_KEYS[i]);
  }
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The minimap: walls, sites, the player arrow, teammates, the planted charge.
function drawMinimap(H, S) {
  const g = H.minimap;
  const W = 190, Ht = 132;
  const sx = W / (MAP.maxX - MAP.minX), sz = Ht / (MAP.maxZ - MAP.minZ);
  const X = (x) => (x - MAP.minX) * sx, Z = (z) => (z - MAP.minZ) * sz;
  g.clearRect(0, 0, W, Ht);
  g.fillStyle = 'rgba(16,14,20,0.72)';
  g.fillRect(0, 0, W, Ht);
  g.fillStyle = 'rgba(233,226,212,0.55)';
  for (const [x0, z0, x1, z1] of WALLS) {
    g.fillRect(X(x0), Z(z0), Math.max(1, (x1 - x0) * sx), Math.max(1, (z1 - z0) * sz));
  }
  for (const [key, s] of Object.entries(SITES)) {
    g.strokeStyle = S.bomb.state === 'planted' && S.bomb.site === key ? '#e5484d' : '#f0a830';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(X(s.x), Z(s.z), s.radius * sx, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#e9e2d4';
    g.font = 'bold 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(key, X(s.x), Z(s.z) + 4);
  }
  // Teammates: dots. The player: a white arrow rotated by yaw.
  for (const f of S.fighters) {
    if (!f.alive) continue;
    if (f.isPlayer) {
      g.save();
      g.translate(X(f.x), Z(f.z));
      g.rotate(f.yaw);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.closePath();
      g.fill();
      g.restore();
    } else if (f.team === 'HELIOS') {
      g.fillStyle = '#f0a830';
      g.beginPath();
      g.arc(X(f.x), Z(f.z), 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (S.bomb.state === 'planted') {
    const pulse = 3 + Math.sin(S.time * 6) * 1.5;
    g.fillStyle = '#e5484d';
    g.beginPath();
    g.arc(X(S.bomb.x), Z(S.bomb.z), pulse, 0, Math.PI * 2);
    g.fill();
  }
}

// Consume this frame's HUD effects: hit markers and the hurt flash.
export function consumeHudFx(H, S) {
  for (const fx of S.fx) {
    if (fx.type === 'hitmarker') {
      H.hitAt = S.time;
      H.hitHead = !!fx.head;
      if (fx.head) $('hitmarker').classList.add('head');
      else $('hitmarker').classList.remove('head');
    }
    if (fx.type === 'hurt') H.hurtAt = S.time;
  }
}

export function updateHud(H, S, R, dt) {
  const p = player(S);
  const def = WEAPONS[p.current];
  const ammo = p.ammo[p.current];

  // Top bar: scores, timer, round.
  $('score-helios').textContent = S.scores.HELIOS;
  $('score-umbra').textContent = S.scores.UMBRA;
  $('round-label').textContent = `ROUND ${Math.min(S.round, S.maxRounds)} / ${S.maxRounds}`;
  const planted = S.bomb.state === 'planted';
  const timerEl = $('timer');
  if (S.phase === 'buy') {
    timerEl.textContent = `BUY ${fmtTime(S.phaseTime)}`;
    timerEl.classList.remove('danger');
  } else if (planted) {
    timerEl.textContent = fmtTime(S.bomb.timer);
    timerEl.classList.add('danger');
  } else {
    timerEl.textContent = fmtTime(S.phaseTime);
    timerEl.classList.toggle('danger', S.phaseTime < 15);
  }

  // Bottom left: health, armour, cash, location.
  $('health-value').textContent = Math.max(0, p.hp);
  $('health-bar').style.width = `${Math.max(0, p.hp)}%`;
  $('armour-value').textContent = p.armour > 0 ? `${p.armour}${p.helmet ? '+H' : ''}` : '—';
  $('cash-value').textContent = `$${p.money.toLocaleString()}`;
  $('location').textContent = calloutAt(p.x, p.z).toUpperCase();

  // Bottom right: weapon, ammo, loadout.
  $('weapon-name').textContent = def.name;
  if (def.melee) {
    $('ammo-mag').textContent = '—';
    $('ammo-reserve').textContent = '';
  } else {
    $('ammo-mag').textContent = ammo.mag;
    $('ammo-reserve').textContent = `/ ${ammo.reserve}`;
  }
  $('ammo').classList.toggle('empty', !def.melee && ammo.mag === 0);
  $('ammo').classList.toggle('reloading', p.reloadTimer > 0);
  $('reload-label').textContent = p.reloadTimer > 0 ? 'RELOADING' : '';
  $('loadout').innerHTML = [1, 2, 3].map((slot) => {
    const w = p.weapons.map((id) => WEAPONS[id]).find((w) => w.slot === slot);
    if (!w) return '';
    return `<span class="${p.current === w.id ? 'on' : ''}">${slot} ${w.name}</span>`;
  }).join('') +
    `<span>${p.grenades.smoke > 0 ? '4 Smoke' : ''}</span>` +
    `<span>${p.grenades.flash > 0 ? '5 Flash' : ''}</span>`;

  // Teammate bars.
  const teamHtml = S.fighters.filter((f) => f.team === 'HELIOS' && !f.isPlayer).map((f) => `
    <div class="mate ${f.alive ? '' : 'dead'}">
      <span>${f.name}</span>
      <span class="mate-hp"><i style="width:${f.alive ? f.hp : 0}%"></i></span>
      <span>${f.alive ? f.hp : '✕'}</span>
    </div>`).join('');
  if (teamHtml !== H.lastTeam) {
    H.lastTeam = teamHtml;
    $('team-list').innerHTML = teamHtml;
  }

  // Kill feed and radio.
  const feedHtml = S.killfeed.map((k) => `<div class="${k.hs ? 'hs' : ''}">${k.text}</div>`).join('');
  if (feedHtml !== H.lastFeed) {
    H.lastFeed = feedHtml;
    $('killfeed').innerHTML = feedHtml;
  }
  const radioHtml = S.radio.map((r) => `<div><b>${r.name}</b> ${r.text}</div>`).join('');
  if (radioHtml !== H.lastRadio) {
    H.lastRadio = radioHtml;
    $('radio').innerHTML = radioHtml;
  }

  // Crosshair: the gap is the spread. Still and crouched is tight; moving and
  // spraying is wide — the gunplay model, visible in the middle of the screen.
  const speedFrac = Math.min(1, p.speed / 5.2);
  const spread = effectiveSpread(def, speedFrac, p.crouch, p.bloom);
  const gap = 5 + spread * 900;
  $('crosshair').style.setProperty('--gap', `${gap.toFixed(1)}px`);
  $('crosshair').style.display = p.alive && S.phase !== 'menu' ? 'block' : 'none';

  // Hitmarker: 140ms, red for a headshot.
  $('hitmarker').classList.toggle('on', S.time - H.hitAt < 0.14);
  // Hurt vignette: fades over 0.6s.
  $('hurt').style.opacity = Math.max(0, 0.7 - (S.time - H.hurtAt) * 1.2).toFixed(2);
  // Flashbang: white until sight returns.
  const blindLeft = Math.max(0, p.blindUntil - S.time);
  $('flash').style.opacity = Math.min(1, blindLeft / 2).toFixed(2);
  // Death: a dark veil and the respawn note.
  $('dead-veil').style.opacity = p.alive ? '0' : '0.55';

  // Objective bars: planting, defusing, and the planted bomb countdown.
  const bar = $('objective');
  const b = S.bomb;
  if (p.planting && b.plantBy === p.id) {
    bar.hidden = false;
    $('objective-label').textContent = `PLANTING AT ${siteAtLabel(p)}`;
    $('objective-fill').style.width = `${b.plantProgress * 100}%`;
    $('objective-fill').className = 'plant';
  } else if (p.defusing && b.defuseBy === p.id) {
    bar.hidden = false;
    $('objective-label').textContent = `DEFUSING AT ${b.site}`;
    $('objective-fill').style.width = `${b.defuseProgress * 100}%`;
    $('objective-fill').className = 'defuse';
  } else if (planted && b.defuseBy !== null) {
    const defuser = S.fighters[b.defuseBy];
    bar.hidden = false;
    $('objective-label').textContent = `${defuser ? defuser.name : 'Enemy'} IS DEFUSING AT ${b.site}`;
    $('objective-fill').style.width = `${b.defuseProgress * 100}%`;
    $('objective-fill').className = 'defuse';
  } else if (planted) {
    bar.hidden = false;
    $('objective-label').textContent = `BOMB AT ${b.site} — ${fmtTime(b.timer)}`;
    $('objective-fill').style.width = `${(b.timer / 40) * 100}%`;
    $('objective-fill').className = 'bomb';
  } else if (b.plantBy !== null && b.plantBy !== p.id) {
    const planter = S.fighters[b.plantBy];
    bar.hidden = false;
    $('objective-label').textContent = `${planter ? planter.name : 'Teammate'} IS PLANTING`;
    $('objective-fill').style.width = `${b.plantProgress * 100}%`;
    $('objective-fill').className = 'plant';
  } else {
    bar.hidden = true;
  }

  // Round banner.
  if (S.phase === 'roundEnd' && S.roundWinner) {
    $('banner').hidden = false;
    $('banner-title').textContent = `${S.roundWinner} WINS THE ROUND`;
    $('banner-sub').textContent = S.roundReason;
  } else if (S.phase === 'matchEnd') {
    $('banner').hidden = false;
    $('banner-title').textContent = S.roundWinner === 'DRAW' ? 'MATCH DRAWN' : `${S.roundWinner} TAKES THE MATCH`;
    $('banner-sub').textContent = `${S.scores.HELIOS} — ${S.scores.UMBRA} · ${S.roundReason}`;
  } else {
    $('banner').hidden = true;
  }

  // Buy menu state: prices, affordability, owned marks.
  if (H.buyOpen) {
    $('buy-cash').textContent = `$${p.money.toLocaleString()}`;
    for (const el of document.querySelectorAll('.buy-item')) {
      const id = el.dataset.item;
      const item = WEAPONS[id] || GEAR[id];
      const owned = p.weapons.includes(id) ||
        (id === 'armour' && p.armour > 0) || (id === 'helmet' && p.helmet) ||
        (id === 'smoke' && p.grenades.smoke > 0) || (id === 'flash' && p.grenades.flash > 0);
      el.classList.toggle('owned', owned);
      el.classList.toggle('poor', !owned && p.money < item.price);
    }
  }

  // Damage numbers: project each world-anchored number to the screen.
  for (let i = 0; i < H.dmgPool.length; i++) {
    const d = H.dmgPool[i];
    const n = S.damageNumbers[i];
    if (!n) { d.style.display = 'none'; continue; }
    const age = S.time - n.time;
    _proj.set(n.x, n.y + age * 0.5, n.z).project(R.camera);
    if (_proj.z > 1) { d.style.display = 'none'; continue; }
    d.style.display = 'block';
    d.style.left = `${(_proj.x * 0.5 + 0.5) * window.innerWidth}px`;
    d.style.top = `${(-_proj.y * 0.5 + 0.5) * window.innerHeight}px`;
    d.style.opacity = Math.max(0, 1 - age / 0.9).toFixed(2);
    d.textContent = n.text;
    d.classList.toggle('hs', n.hs);
  }

  drawMinimap(H, S);
}

// Reused projection vector (no allocation per damage number per frame).
const _proj = new THREE.Vector3();

function siteAtLabel(p) {
  for (const [key, s] of Object.entries(SITES)) {
    if (Math.hypot(p.x - s.x, p.z - s.z) < s.radius) return key;
  }
  return '?';
}

// Buying from the menu: validated by rounds.buyItem; the HUD only reports.
export function buyFromMenu(S, H, itemId) {
  const res = buyItem(S, player(S), itemId);
  $('buy-note').textContent = res.ok ? '' : res.why;
  return res.ok;
}
