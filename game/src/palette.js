// palette.js — one job: SUNFALL's chosen look. A solar farm at dusk: amber and
// gold panels against a teal-violet sky, deep warm shadows. Every material and
// HUD colour in the game comes from these six values, so the scene reads as one
// place at a glance. No harbour blues, no brickworks, no snow: the field is
// saturated with those, and this palette is ours.
export const PALETTE = {
  skyTop: 0x2a2350, // violet dusk, high in the sky dome
  skyMid: 0x3d5a74, // teal, at the horizon
  skyLow: 0xe8853d, // amber, where the sun sits
  sun: 0xffc06a, // the low sun: warm gold light
  ground: 0x4a3a2c, // warm gravel yard
  panel: 0x1d2f5e, // solar cells: deep blue, slightly reflective
  panelFrame: 0x8a7f6a, // panel legs and frames: sun-bleached steel
  wall: 0x9a7f5e, // plaster walls, warm sand
  wallDark: 0x6e5740, // shaded plaster
  accent: 0xf0a830, // HUD accent, signage, HELIOS team colour
  umbra: 0x35c4b5, // UMBRA team colour: teal
  helios: 0xf0a830, // HELIOS team colour: amber
  ink: '#e9e2d4', // HUD text
  muted: '#a89a80', // HUD secondary text
  danger: '#e5484d', // damage, bomb timer, enemy markers
};
