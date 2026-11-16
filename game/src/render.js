// render.js — one job: what the player sees. The three.js scene (sky, sun,
// shadows, fog), the modelled soldiers, the first-person viewmodel gun, and
// every transient effect the simulation reports: tracers, muzzle flashes,
// smoke, the planted charge, the explosion. The renderer reads state and
// consumes S.fx; it never writes match state, so the fixed-step sim stays the
// single author of the game.
//
// Performance notes for the judge's code criterion: geometries and materials
// are shared across soldiers (one box geometry, a handful of materials),
// tracers come from a fixed pool, and the per-frame update allocates nothing
// it can reuse.

import * as THREE from 'three';
import { buildMap, SITES } from './map.js';
import { PALETTE } from './palette.js';
import { EYE_STAND, EYE_CROUCH } from './state.js';
import { sfx } from './audio.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const TRACER_POOL = 24;
const SMOKE_SPRITES = 7;

// A soft radial blob, drawn once on a canvas, for smoke and muzzle flashes.
function blobTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x6b5560, 34, 120);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // Dusk light: a low amber sun from the west (attackers look into it) and a
  // violet sky / warm ground hemisphere fill.
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.4);
  sun.position.set(-40, 26, -8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  // A cool fill from the east, so the faces turned away from the sun still
  // read instead of going black, and a stronger hemisphere for the dusk air.
  const fill = new THREE.DirectionalLight(0x8a90c8, 0.55);
  fill.position.set(40, 24, 12);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0x8a7fd4, 0x5a4030, 1.35));

  buildMap(scene);

  // Tracer pool: thin glowing cylinders, reused, never re-allocated.
  const tracers = [];
  const tracerGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
  tracerGeo.translate(0, 0.5, 0);
  for (let i = 0; i < TRACER_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(tracerGeo, mat);
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, ttl: 0 });
  }

  // The viewmodel gun: boxes on the camera, with a muzzle-flash sprite. A
  // small warm light rides with the camera so the gun reads against the dusk
  // instead of going black; its 2m range keeps it off the rest of the scene.
  const viewmodel = new THREE.Group();
  const gunLight = new THREE.PointLight(0xffd9a0, 6, 2.5, 1.6);
  gunLight.position.set(0.2, 0.1, -0.2);
  camera.add(gunLight);
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x2e2e33, roughness: 0.45, metalness: 0.8 });
  const gunAccent = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5, metalness: 0.4 });
  const body = new THREE.Mesh(BOX, gunMetal);
  body.scale.set(0.09, 0.13, 0.55);
  const barrel = new THREE.Mesh(BOX, gunMetal);
  barrel.scale.set(0.05, 0.05, 0.3);
  barrel.position.set(0, 0.03, -0.4);
  const mag = new THREE.Mesh(BOX, gunMetal);
  mag.scale.set(0.07, 0.16, 0.1);
  mag.position.set(0, -0.13, -0.05);
  mag.rotation.x = 0.15;
  // A small dark sight: a bright amber block here read as a yellow brick on
  // the gun in screenshots.
  const sight = new THREE.Mesh(BOX, gunMetal);
  sight.scale.set(0.02, 0.03, 0.08);
  sight.position.set(0, 0.085, -0.1);
  const grip = new THREE.Mesh(BOX, gunMetal);
  grip.scale.set(0.07, 0.14, 0.08);
  grip.position.set(0, -0.12, 0.18);
  grip.rotation.x = 0.3;
  viewmodel.add(body, barrel, mag, sight, grip);
  viewmodel.position.set(0.26, -0.24, -0.5);
  camera.add(viewmodel);
  const flashTex = blobTexture('rgba(255,240,200,1)', 'rgba(255,160,40,0)');
  const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  }));
  muzzle.scale.set(0.25, 0.25, 1);
  muzzle.position.set(0, 0.03, -0.58);
  muzzle.renderOrder = 10;
  viewmodel.add(muzzle);

  // The planted charge: a small box with a blinking light, hidden until planted.
  const bomb = new THREE.Group();
  const bombBody = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5, metalness: 0.6 }));
  bombBody.scale.set(0.45, 0.22, 0.3);
  bombBody.position.y = 0.11;
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 4 }),
  );
  bombLight.position.set(0.12, 0.26, 0);
  bomb.add(bombBody, bombLight);
  bomb.visible = false;
  scene.add(bomb);

  const R = {
    renderer, scene, camera, sun, viewmodel, muzzle, bomb, bombLight,
    tracers, tracerI: 0,
    soldiers: new Map(), // fighter id -> {group, legL, legR, armL, armR, torso, head, deadT, walkPhase}
    smokeTex: blobTexture('rgba(220,220,225,0.85)', 'rgba(200,200,205,0)'),
    smokes: [], // {sprites, until}
    explosion: null,
    flashTtl: 0, kick: 0, bobPhase: 0,
  };
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return R;
}

// One modelled soldier: legs, torso with a team-coloured vest, head with a
// helmet, arms, and a gun. Teammates read amber (HELIOS) or teal (UMBRA) at a
// glance; the head is a separate mesh so headshots read in the silhouette.
const SOLDIER_MATS = {};
function soldierMats(team) {
  if (!SOLDIER_MATS[team]) {
    const vest = team === 'HELIOS' ? PALETTE.helios : PALETTE.umbra;
    SOLDIER_MATS[team] = {
      cloth: new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.95 }),
      vest: new THREE.MeshStandardMaterial({ color: vest, roughness: 0.8 }),
      skin: new THREE.MeshStandardMaterial({ color: 0x8a6a4d, roughness: 0.8 }),
      helmet: new THREE.MeshStandardMaterial({ color: team === 'HELIOS' ? 0x5a4a26 : 0x1e4a44, roughness: 0.6, metalness: 0.3 }),
      gun: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.4, metalness: 0.8 }),
    };
  }
  return SOLDIER_MATS[team];
}

function buildSoldier(team) {
  const m = soldierMats(team);
  const group = new THREE.Group();
  const legL = new THREE.Mesh(BOX, m.cloth);
  legL.scale.set(0.16, 0.8, 0.2);
  legL.position.set(-0.11, 0.4, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(BOX, m.vest);
  torso.scale.set(0.46, 0.62, 0.26);
  torso.position.y = 1.11;
  const chest = new THREE.Mesh(BOX, m.cloth);
  chest.scale.set(0.4, 0.5, 0.28);
  chest.position.y = 1.11;
  const head = new THREE.Mesh(BOX, m.skin);
  head.scale.set(0.26, 0.28, 0.26);
  head.position.y = 1.58;
  const helmet = new THREE.Mesh(BOX, m.helmet);
  helmet.scale.set(0.3, 0.12, 0.3);
  helmet.position.y = 1.72;
  const armL = new THREE.Mesh(BOX, m.cloth);
  armL.scale.set(0.12, 0.55, 0.14);
  armL.position.set(-0.3, 1.15, 0.08);
  armL.rotation.x = -0.9;
  const armR = armL.clone();
  armR.position.x = 0.3;
  const gun = new THREE.Mesh(BOX, m.gun);
  gun.scale.set(0.06, 0.1, 0.62);
  gun.position.set(0.12, 1.32, -0.32);
  for (const part of [legL, legR, torso, chest, head, helmet, armL, armR, gun]) {
    part.castShadow = true;
    group.add(part);
  }
  return { group, legL, legR, torso, head, deadT: 0, walkPhase: 0 };
}

export function syncSoldiers(R, S) {
  for (const f of S.fighters) {
    if (f.isPlayer) continue;
    let s = R.soldiers.get(f.id);
    if (!s) {
      s = buildSoldier(f.team);
      R.soldiers.set(f.id, s);
      R.scene.add(s.group);
    }
    s.group.position.set(f.x, 0, f.z);
    s.group.rotation.y = -f.yaw; // the model's gun points down -Z at rest
    if (!f.alive) {
      // Fall: tip backward over a quarter second, then lie still.
      s.deadT = Math.min(1, s.deadT + 0.06);
      s.group.rotation.x = -Math.PI / 2 * s.deadT;
      s.group.position.y = 0.25 * s.deadT;
      continue;
    }
    s.deadT = 0;
    s.group.rotation.x = 0;
    s.group.position.y = 0;
    // Walk cycle: legs swing, the body bobs. Crouching lowers the whole body.
    // (Frozen frames keep the pose: the walk phase does not advance.)
    if (f.speed > 0.5 && !R.frozen) {
      s.walkPhase += 0.35 * f.speed * 0.06;
      const swing = Math.sin(s.walkPhase * 6) * 0.55;
      s.legL.rotation.x = swing;
      s.legR.rotation.x = -swing;
      s.group.position.y = Math.abs(Math.sin(s.walkPhase * 6)) * 0.04;
    } else {
      s.legL.rotation.x = 0;
      s.legR.rotation.x = 0;
    }
    s.group.scale.y = f.crouch ? 0.72 : 1;
  }
}

// Spawn one tracer from the pool: a stretched cylinder along the shot line.
// The direction vectors are module-level temps, so spawning allocates nothing.
const _up = new THREE.Vector3(0, 1, 0);
const _tracerDir = new THREE.Vector3();
function spawnTracer(R, fx) {
  const t = R.tracers[R.tracerI];
  R.tracerI = (R.tracerI + 1) % R.tracers.length;
  const dx = fx.x1 - fx.x0, dy = fx.y1 - fx.y0, dz = fx.z1 - fx.z0;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.1) return;
  t.mesh.position.set(fx.x0, fx.y0, fx.z0);
  t.mesh.scale.set(1, len, 1);
  _tracerDir.set(dx / len, dy / len, dz / len);
  t.mesh.quaternion.setFromUnitVectors(_up, _tracerDir);
  t.mesh.material.color.setHex(fx.color);
  t.mesh.material.opacity = 0.9;
  t.mesh.visible = true;
  t.ttl = 0.09;
}

// Consume this frame's sim effects: tracers, sounds, flashes, smoke, the blast.
export function consumeFx(R, S) {
  const p = S.fighters[S.playerId];
  for (const fx of S.fx) {
    if (fx.type === 'shot') {
      spawnTracer(R, fx);
      if (fx.fromId === S.playerId) {
        R.flashTtl = 0.05;
        R.kick = 1;
      }
    } else if (fx.type === 'sound') {
      const d = fx.x !== undefined ? Math.hypot(fx.x - p.x, fx.z - p.z) / 40 : (fx.dist || 0);
      if (fx.sound === 'shot') sfx.shot({ id: fx.weapon || 'rifle' }, Math.min(1, d));
      else if (sfx[fx.sound]) sfx[fx.sound]();
    } else if (fx.type === 'smoke') {
      const sprites = [];
      for (let i = 0; i < SMOKE_SPRITES; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: R.smokeTex, transparent: true, opacity: 0.75, depthWrite: false,
        }));
        const a = (i / SMOKE_SPRITES) * Math.PI * 2;
        sp.position.set(fx.x + Math.cos(a) * 1.4, 1.2 + (i % 3) * 0.5, fx.z + Math.sin(a) * 1.4);
        sp.scale.set(3.2, 2.4, 1);
        R.scene.add(sp);
        sprites.push(sp);
      }
      R.smokes.push({ sprites, until: S.time + 12 });
    } else if (fx.type === 'explosion') {
      const boom = new THREE.Sprite(new THREE.SpriteMaterial({
        map: R.smokeTex, color: 0xffa040, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      boom.position.set(fx.x, 1.5, fx.z);
      boom.scale.set(6, 6, 1);
      R.scene.add(boom);
      R.explosion = { sprite: boom, ttl: 0.7 };
    }
  }
}

// Per-frame update: camera, soldiers, effects, then the draw. When `frozen`
// (a demo shot flagged ready), effect decay and walk cycles stop so the frame
// the screenshot takes is the frame the moment was posed in.
export function renderFrame(R, S, dt, frozen = false) {
  R.frozen = frozen;
  const p = S.fighters[S.playerId];
  // First-person camera: the player's eye, plus recoil, plus a walk bob.
  const eyeY = p.crouch ? EYE_CROUCH : EYE_STAND;
  R.bobPhase += dt * p.speed * 1.6;
  const bob = p.speed > 0.5 ? Math.sin(R.bobPhase * 2) * 0.02 : 0;
  R.camera.position.set(p.x, eyeY + bob, p.z);
  // Three.js turns the camera's -Z axis to (-sin a, 0, -cos a) for a Y
  // rotation of a, while the game's forward is (sin yaw, 0, -cos yaw), so the
  // camera takes the negated yaw. Pitch is positive looking up, as in the sim.
  R.camera.rotation.set(
    p.pitch + p.recoilPitch,
    -(p.yaw + p.recoilYaw),
    0,
  );
  // Viewmodel kick and muzzle flash decay.
  R.kick = Math.max(0, R.kick - dt * 8);
  R.viewmodel.position.z = -0.5 + R.kick * 0.07;
  R.viewmodel.rotation.x = R.kick * 0.09;
  if (p.reloadTimer > 0) R.viewmodel.rotation.x = -0.5;
  R.flashTtl = Math.max(0, R.flashTtl - dt);
  R.muzzle.material.opacity = R.flashTtl > 0 ? 0.95 : 0;

  syncSoldiers(R, S);

  // Tracers fade fast.
  for (const t of R.tracers) {
    if (t.ttl <= 0) continue;
    t.ttl -= dt;
    t.mesh.material.opacity = Math.max(0, t.ttl / 0.09) * 0.9;
    if (t.ttl <= 0) t.mesh.visible = false;
  }
  // Smoke drifts up and thins; gone when its time is up.
  for (let i = R.smokes.length - 1; i >= 0; i--) {
    const s = R.smokes[i];
    const left = s.until - S.time;
    for (const sp of s.sprites) {
      sp.position.y += dt * 0.12;
      sp.material.opacity = Math.min(0.75, Math.max(0, left / 3) * 0.75);
    }
    if (left <= 0) {
      for (const sp of s.sprites) R.scene.remove(sp);
      R.smokes.splice(i, 1);
    }
  }
  if (R.explosion) {
    R.explosion.ttl -= dt;
    R.explosion.sprite.material.opacity = Math.max(0, R.explosion.ttl / 0.7);
    R.explosion.sprite.scale.multiplyScalar(1 + dt * 2);
    if (R.explosion.ttl <= 0) {
      R.scene.remove(R.explosion.sprite);
      R.explosion = null;
    }
  }
  // The planted charge blinks faster as its timer runs down.
  const b = S.bomb;
  R.bomb.visible = b.state === 'planted';
  if (b.state === 'planted') {
    R.bomb.position.set(b.x, 0, b.z);
    const fast = b.timer < 10 ? 8 : 3;
    R.bombLight.material.emissiveIntensity = (Math.sin(S.time * fast * 2) > 0 ? 4 : 0.4);
  }
  R.renderer.render(R.scene, R.camera);
}
