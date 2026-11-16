// rng.js — one job: deterministic randomness. A mulberry32 generator seeded per
// match (and per screenshot demo) so bot behaviour and demo scenes reproduce.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick one element of an array with the given rng.
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// Integer in [min, max] with the given rng.
export function intBetween(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}
