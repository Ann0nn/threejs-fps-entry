# SUNFALL — a round-based tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Ann0nn/threejs-fps-entry/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Ann0nn/threejs-fps-entry/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A complete round-based tactical FPS in three.js, built for [make.fun](https://make.fun/r/s27wgn68)'s `threejs-fps-02` bounty. HELIOS attacks, UMBRA defends a solar farm at dusk: plant the charge at Array Hall or the Substation, or stop them. First to 7 rounds takes the match.

**The game:** 5v5 with 9 bots in visible roles (entry fragger, angle holder, planter, rotator) that follow waypoint routes, hold angles, react to sight and sound, plant and defuse, and talk on the radio. Hitscan gunplay with x4 headshots, recoil and spread that punish firing on the move, and a crosshair that shows the spread. A full economy: money per round, kill, plant and defuse, spent in a buy menu on rifles, SMGs, armour, helmets, smoke and flash grenades. A fixed-step simulation kept apart from rendering, one module per job.

**The map:** three lanes — Panel Row, Inverter Yard, Service Road — with named callouts, a live minimap, and a dusk palette of amber panels against a teal-violet sky.

## Play it

Serve `game/` with any static file server and open `index.html` in desktop Chrome (WebGL 2). No build step, no network requests:

```sh
cd game && python3 -m http.server 8080
```

then open http://localhost:8080. Click to play: WASD to move, mouse to look, click to fire, R to reload, E (hold) to plant/defuse, B for the buy menu, Ctrl to crouch.

## Screenshots

The four screenshots in `screenshots/` are real renders of the game's own code, posed with its documented demo mode — the same sim, the same HUD, no composites:

```
game/index.html?shot=buy|firefight|plant|defuse&seed=7
```

## Files

- `game/index.html` — the page and HUD
- `game/src/` — the game: `main` (loop), `sim` (fixed-step simulation), `bots` (AI), `rounds` (match + economy), `weapons`, `map`, `render`, `hud`, `player`, `input`, `audio`, `state`, `demo`, `rng`, `palette`
- `game/vendor/three/` — three.js 0.187.0, byte for byte from the kit
- `main.ts` — the entrypoint: copies `game/` + `screenshots/` to `/output` and writes `dossier.json`
- `screenshots/` — the four entry screenshots
- `LICENSE` — MIT

---

<sub>Entered on [make.fun](https://make.fun/?ref=s27wgn68&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
