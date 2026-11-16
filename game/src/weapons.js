// weapons.js — one job: everything a weapon is. Damage, fire rate, magazine,
// spread and recoil. The gunplay model lives here and in sim.fireWeapon:
//
//   * Hits are raycast against bodies: a head hit deals damage x headMult (x4).
//   * Spread grows with movement and with sustained fire (bloom), and shrinks
//     when crouched and still — stopping to aim pays, firing on the move is
//     punished. See effectiveSpread().
//   * Recoil kicks the aim up and sideways per shot and recovers over time.
//
// Armour absorbs half of body damage; headshots ignore armour unless the target
// wears a helmet. All values are data, so the buy menu and the HUD read the
// same table the simulation shoots with.

export const WEAPONS = {
  rifle: {
    id: 'rifle', name: 'HELIX AR', slot: 1, price: 2700, auto: true,
    mag: 30, reserve: 90, damage: 34, headMult: 4, rpm: 600,
    spread: 0.011, moveSpread: 0.030, recoil: 0.013, range: 70, reload: 2.4,
    tracer: 0xffd27a,
  },
  smg: {
    id: 'smg', name: 'DUSK SMG', slot: 1, price: 1200, auto: true,
    mag: 32, reserve: 96, damage: 26, headMult: 4, rpm: 800,
    spread: 0.016, moveSpread: 0.036, recoil: 0.010, range: 45, reload: 2.1,
    tracer: 0xffe9a8,
  },
  pistol: {
    id: 'pistol', name: 'SPARROW Pistol', slot: 2, price: 500, auto: false,
    mag: 12, reserve: 48, damage: 30, headMult: 4, rpm: 320,
    spread: 0.009, moveSpread: 0.018, recoil: 0.020, range: 50, reload: 1.8,
    tracer: 0xfff3c4,
  },
  knife: {
    id: 'knife', name: 'RIDGE Knife', slot: 3, price: 0, melee: true,
    mag: Infinity, reserve: Infinity, damage: 55, headMult: 1, rpm: 90,
    spread: 0, moveSpread: 0, recoil: 0, range: 2.3, reload: 0,
    tracer: 0xffffff,
  },
};

// Buy-menu gear that is not a gun.
export const GEAR = {
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, blurb: 'Blocks sight for 12s' },
  flash: { id: 'flash', name: 'Flash Grenade', price: 200, blurb: 'Blinds anyone looking at it' },
  armour: { id: 'armour', name: 'Kevlar Vest', price: 650, blurb: 'Halves body damage' },
  helmet: { id: 'helmet', name: 'Helmet', price: 350, blurb: 'Armour then covers headshots too' },
};

// The spread (radians of random cone) of one shot, given how the shooter moves.
// Still and crouched is the tightest cone; sprinting and spraying is the widest.
export function effectiveSpread(def, speedFrac, crouched, bloom) {
  let s = def.spread * (1 + def.moveSpread * 40 * speedFrac + bloom);
  if (crouched) s *= 0.7;
  return s;
}

// Damage after armour. Armour halves body damage; it only covers the head when
// the target wears a helmet.
export function damageAfterArmour(def, part, target) {
  let dmg = part === 'head' ? def.damage * def.headMult : def.damage;
  if (target.armour > 0 && (part !== 'head' || target.helmet)) dmg *= 0.5;
  return Math.round(dmg);
}
