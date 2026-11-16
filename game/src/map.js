// map.js — one job: the SUNFALL map. A solar farm at dusk, 64 x 44 metres.
// Three lanes run west (HELIOS spawn) to east (UMBRA spawn): Panel Row in the
// north, Inverter Yard in the middle, Service Road in the south. Two bomb
// sites sit in the east yard: A "Array Hall" among the panel rows, B
// "Substation" by the transformer building.
//
// The map is data first: WALLS are axis-aligned boxes (x0,z0,x1,z1,h) that the
// simulation uses for movement collision, bullet occlusion and bot line of
// sight, and the renderer builds meshes from the same list, so what you see is
// exactly what blocks you. WAYPOINTS are the bot nav graph: bots path across
// it with breadth-first search, and every edge is clear of walls by design.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = { minX: -32, maxX: 32, minZ: -22, maxZ: 22 };

// [x0, z0, x1, z1, height, kind] — kind picks the mesh the renderer builds.
export const WALLS = [
  // Perimeter fence.
  [-32, -22, 32, -21, 4, 'fence'], [-32, 21, 32, 22, 4, 'fence'],
  [-32, -22, -31, 22, 4, 'fence'], [31, -22, 32, 22, 4, 'fence'],
  // Mid wall (x -2..0) with three gaps: north, mid and south doors.
  [-2, -21, 0, -18, 4, 'wall'], [-2, -12, 0, -2, 4, 'wall'],
  [-2, 2, 0, 12, 4, 'wall'], [-2, 18, 0, 21, 4, 'wall'],
  // East divider: forces the A/B choice in the east yard.
  [14, -3, 16, 3, 3.5, 'wall'],
  // Site A: Array Hall building and panel rows.
  [24, -21, 30, -13, 4, 'hall'],
  [18, -19, 22, -17, 2.2, 'panel'], [26, -11, 30, -9, 2.2, 'panel'],
  // North lane panels (set back from the lane centreline so the lane weaves).
  [-24, -17, -20, -15, 2.2, 'panel'], [-14, -17, -10, -15, 2.2, 'panel'],
  [-4, -17, 0, -15, 2.2, 'panel'], [6, -17, 10, -15, 2.2, 'panel'],
  [16, -17, 20, -15, 2.2, 'panel'],
  // Site B: substation, transformers, south panels.
  [22, 10, 28, 18, 4.5, 'substation'],
  [24, 8, 26, 10, 2, 'transformer'], [18, 11, 20, 13, 2, 'transformer'],
  [14, 17, 18, 19, 2.2, 'panel'], [-2, 17, 2, 19, 2.2, 'panel'],
  // East yard sheds.
  [18, -8, 22, -4, 3.5, 'shed'], [18, 4, 22, 8, 3.5, 'shed'],
  // Crates and reels: low cover (block movement, not sight over the top).
  [-14, -5, -12, -3, 1.2, 'crate'], [-14, 3, -12, 5, 1.2, 'crate'],
  [4, -6, 6, -4, 1.2, 'crate'], [4, 4, 6, 6, 1.2, 'crate'],
  [-8, 16.5, -6, 18.5, 1.2, 'crate'], [8, 16.5, 10, 18.5, 1.2, 'crate'],
  [-6, -10, -5, -9, 1, 'reel'], [2, 10, 3, 11, 1, 'reel'],
  [-26, 10, -25, 11, 1, 'reel'], [-26, -11, -25, -10, 1, 'reel'],
];

export const SITES = {
  A: { name: 'Array Hall', x: 20, z: -14, radius: 4.5 },
  B: { name: 'Substation', x: 20, z: 15, radius: 4.5 },
};

export const SPAWNS = {
  HELIOS: [[-28, -3], [-28, 0], [-28, 3], [-26, -5], [-26, 5]],
  UMBRA: [[29, -3], [29, 0], [29, 3], [27, -5], [27, 5]],
};

// Named callouts: the nearest one names the player's location in the HUD.
export const CALLOUTS = [
  ['Helios Gate', -28, 0, 8], ['Panel Row', -10, -14, 13],
  ['Inverter Yard', -6, 0, 11], ['Service Road', -8, 15, 15],
  ['Mid Doors', -1, 0, 5], ['Array Hall', 20, -14, 9],
  ['Substation', 20, 15, 9], ['East Yard', 11, 0, 10],
  ['Umbra Yard', 28, 0, 9], ['Solar Field', 8, -14, 10],
];

// Bot nav graph. Nodes are [name, x, z]; edges are index pairs. Every edge is
// a straight walk clear of walls.
export const WAYPOINTS = [
  ['heliosSpawn', -28, 0], ['westMid', -22, 0], ['westNorth', -24, -14],
  ['westSouth', -24, 15], ['northMid', -14, -14], ['southMid', -14, 15],
  ['northGap', -1, -14], ['midGap', -1, 0], ['southGap', -1, 15],
  ['northEast', 11, -14], ['southEast', 11, 15], ['eastMid', 11, 0],
  ['yardNorth', 5, -8], ['yardSouth', 5, 8], ['siteA', 20, -14],
  ['siteB', 20, 15], ['aHold', 26, -9], ['bHold', 15, 19],
  ['umbraSpawn', 29, 0],
];
const W = Object.fromEntries(WAYPOINTS.map((w, i) => [w[0], i]));
export const EDGES = [
  ['heliosSpawn', 'westMid'], ['westMid', 'westNorth'], ['westMid', 'westSouth'],
  ['westMid', 'northMid'], ['westMid', 'southMid'], ['westMid', 'midGap'],
  ['westNorth', 'northMid'], ['westSouth', 'southMid'],
  ['northMid', 'northGap'], ['southMid', 'southGap'],
  ['northGap', 'northEast'], ['northGap', 'yardNorth'],
  ['midGap', 'eastMid'], ['midGap', 'yardNorth'], ['midGap', 'yardSouth'],
  ['southGap', 'southEast'], ['southGap', 'yardSouth'],
  ['northEast', 'siteA'], ['northEast', 'eastMid'],
  ['southEast', 'siteB'], ['southEast', 'eastMid'],
  ['eastMid', 'siteA'], ['eastMid', 'siteB'],
  ['yardNorth', 'northEast'], ['yardNorth', 'eastMid'],
  ['yardSouth', 'southEast'], ['yardSouth', 'eastMid'],
  ['siteA', 'aHold'], ['siteB', 'bHold'],
  ['umbraSpawn', 'aHold'], ['umbraSpawn', 'bHold'],
].map(([a, b]) => [W[a], W[b]]);

// Adjacency list, built once.
export const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) { ADJ[a].push(b); ADJ[b].push(a); }

// Nearest waypoint to a position.
export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][1] - x, dz = WAYPOINTS[i][2] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Breadth-first search over the nav graph: the waypoint path from a to b.
// Returns an array of waypoint indices, start excluded, goal included.
export function findPath(a, b) {
  if (a === b) return [];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [a];
  prev[a] = a;
  while (queue.length > 0) {
    const n = queue.shift();
    if (n === b) break;
    for (const m of ADJ[n]) {
      if (prev[m] === -1) { prev[m] = n; queue.push(m); }
    }
  }
  if (prev[b] === -1) return [];
  const path = [];
  let n = b;
  while (n !== a) { path.unshift(n); n = prev[n]; }
  return path;
}

// The callout name for a position (nearest callout within its radius).
export function calloutAt(x, z) {
  let best = 'Solar Farm', bd = Infinity;
  for (const [name, cx, cz, r] of CALLOUTS) {
    const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (d < r * r && d < bd) { bd = d; best = name; }
  }
  return best;
}

// ---------------------------------------------------------------- collision

// Resolve a circle (x, z, radius) against every wall: slide along, never enter.
// Mutates and returns the [x, z] pair the caller passes in.
export function collideCircle(p, radius) {
  for (const [x0, z0, x1, z1] of WALLS) {
    const cx = Math.max(x0, Math.min(p[0], x1));
    const cz = Math.max(z0, Math.min(p[1], z1));
    const dx = p[0] - cx, dz = p[1] - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      p[0] = cx + (dx / d) * radius;
      p[1] = cz + (dz / d) * radius;
    } else {
      // Centre inside the box: push out along the smallest penetration.
      const pushL = p[0] - x0 + radius, pushR = x1 - p[0] + radius;
      const pushT = p[1] - z0 + radius, pushB = z1 - p[1] + radius;
      const m = Math.min(pushL, pushR, pushT, pushB);
      if (m === pushL) p[0] = x0 - radius;
      else if (m === pushR) p[0] = x1 + radius;
      else if (m === pushT) p[1] = z0 - radius;
      else p[1] = z1 + radius;
    }
  }
  p[0] = Math.max(MAP.minX + 0.5, Math.min(MAP.maxX - 0.5, p[0]));
  p[1] = Math.max(MAP.minZ + 0.5, Math.min(MAP.maxZ - 0.5, p[1]));
  return p;
}

// Ray vs one 3D box (slab test). Origin o, direction d (unit), box x0..x1,
// 0..h, z0..z1. Returns the distance to the entry point, or Infinity.
export function rayBox(ox, oy, oz, dx, dy, dz, x0, h, z0, x1, z1) {
  let tmin = 0, tmax = Infinity;
  const axes = [[ox, dx, x0, x1], [oy, dy, 0, h], [oz, dz, z0, z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Distance from a ray origin to the nearest wall, or Infinity when clear.
// Only walls at least `minH` tall count (crates don't block sight or bullets
// fired over them from a standing eye height).
export function rayWalls(ox, oy, oz, dx, dy, dz, maxDist, minH) {
  let best = maxDist;
  for (const [x0, z0, x1, z1, h] of WALLS) {
    if (h < minH) continue;
    const t = rayBox(ox, oy, oz, dx, dy, dz, x0, h, z0, x1, z1);
    if (t < best) best = t;
  }
  return best;
}

// Line of sight between two points at the given heights: true when no tall
// wall crosses the segment.
export function hasLineOfSight(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) return true;
  const hit = rayWalls(ax, ay, az, dx / dist, dy / dist, dz / dist, dist, 2);
  return hit >= dist - 0.01;
}

// ---------------------------------------------------------------- meshes

// A canvas texture with painted text, for site signage.
function signTexture(text, sub, w = 512, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#241d16';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#f0a830';
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = '#f0a830';
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, sub ? h / 2 - 18 : h / 2);
  if (sub) {
    g.fillStyle = '#e9e2d4';
    g.font = 'bold 30px system-ui, sans-serif';
    g.fillText(sub, w / 2, h / 2 + 38);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Ground texture: warm gravel with a service road, site rings and lane dashes.
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 704;
  const g = c.getContext('2d');
  g.fillStyle = '#554433';
  g.fillRect(0, 0, 1024, 704);
  // Gravel speckle.
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,220,160,0.06)';
    g.fillRect(Math.random() * 1024, Math.random() * 704, 2, 2);
  }
  const px = (x) => (x + 32) * 16, pz = (z) => (z + 22) * 16;
  // Service road along the south lane.
  g.fillStyle = '#38302a';
  g.fillRect(px(-32), pz(12.5), 1024, 5 * 16);
  g.strokeStyle = 'rgba(240,168,48,0.5)';
  g.lineWidth = 3;
  g.setLineDash([18, 14]);
  g.beginPath(); g.moveTo(px(-32), pz(15)); g.lineTo(px(32), pz(15)); g.stroke();
  g.setLineDash([]);
  // Painted site rings.
  for (const [sx, sz, label] of [[20, -14, 'A'], [20, 15, 'B']]) {
    g.strokeStyle = 'rgba(240,168,48,0.85)';
    g.lineWidth = 5;
    g.beginPath(); g.arc(px(sx), pz(sz), 4.5 * 16, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(240,168,48,0.9)';
    g.font = 'bold 64px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, px(sx), pz(sz));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Solar-cell texture: a dark blue face with a lighter grid, so a panel reads
// as a panel at a glance instead of a black slab.
function panelTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 128);
  grad.addColorStop(0, '#3a5aa0');
  grad.addColorStop(0.5, '#2a4480');
  grad.addColorStop(1, '#31497a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(160,190,255,0.35)';
  g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 32) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke();
  }
  for (let y = 0; y <= 128; y += 32) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Build the static map meshes into the scene. Returns nothing; the meshes are
// named so the dossier's Game block and a reader can see the structure.
export function buildMap(scene) {
  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.95 }),
    wallDark: new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.95 }),
    fence: new THREE.MeshStandardMaterial({ color: 0x5a5148, roughness: 0.9, metalness: 0.3 }),
    panel: new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.4, metalness: 0.4, emissive: 0x16224d, emissiveIntensity: 0.5 }),
    frame: new THREE.MeshStandardMaterial({ color: PALETTE.panelFrame, roughness: 0.6, metalness: 0.5 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x7a5c38, roughness: 0.9 }),
    reel: new THREE.MeshStandardMaterial({ color: 0x3d4a55, roughness: 0.7, metalness: 0.4 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x4a3a30, roughness: 0.9 }),
    window: new THREE.MeshStandardMaterial({ color: 0x201409, emissive: 0xffb84d, emissiveIntensity: 1.6 }),
  };

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 44),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  // Sky dome: a canvas vertical gradient, violet over teal over amber.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 512;
  const sg = skyCanvas.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#241d4a');
  grad.addColorStop(0.45, '#3d5a74');
  grad.addColorStop(0.72, '#c96a3a');
  grad.addColorStop(0.85, '#e8853d');
  grad.addColorStop(1, '#7a4a3a');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 4, 512);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  sky.name = 'sky';
  scene.add(sky);

  // The low sun: a glowing disc in the west, so attackers look into the sunset.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }),
  );
  sunDisc.position.set(-120, 16, -10);
  sunDisc.lookAt(0, 4, 0);
  sunDisc.name = 'sun-disc';
  scene.add(sunDisc);
  const sunGlow = new THREE.Mesh(
    new THREE.CircleGeometry(18, 32),
    new THREE.MeshBasicMaterial({ color: 0xff9a4d, transparent: true, opacity: 0.35, fog: false }),
  );
  sunGlow.position.set(-121, 16, -10);
  sunGlow.lookAt(0, 4, 0);
  scene.add(sunGlow);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  function addBox(x0, z0, x1, z1, h, mat, name) {
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(x1 - x0, h, z1 - z0);
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = name;
    scene.add(m);
    return m;
  }

  for (const [x0, z0, x1, z1, h, kind] of WALLS) {
    if (kind === 'panel') {
      // A tilted solar panel on two legs; the collider is the AABB, the mesh
      // is the tilted face, so the panel reads as a panel, not a block.
      const w = x1 - x0, d = z1 - z0;
      const face = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d + 1.2), mats.panel);
      face.position.set((x0 + x1) / 2, 1.9, (z0 + z1) / 2);
      face.rotation.x = -0.5;
      face.castShadow = true;
      face.receiveShadow = true;
      face.name = 'solar-panel';
      scene.add(face);
      for (const lx of [-w / 3, w / 3]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.6, 0.18), mats.frame);
        leg.position.set((x0 + x1) / 2 + lx, 0.8, (z0 + z1) / 2 + 0.3);
        leg.castShadow = true;
        scene.add(leg);
      }
      // A low base rail, so the collider reads in the world.
      addBox(x0, z0, x1, z1, 0.25, mats.frame, 'panel-base');
    } else if (kind === 'fence') {
      addBox(x0, z0, x1, z1, h, mats.fence, 'fence');
    } else if (kind === 'crate') {
      addBox(x0, z0, x1, z1, h, mats.crate, 'crate');
      addBox(x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, h + 0.08, mats.wallDark, 'crate-lid');
    } else if (kind === 'reel') {
      const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1, 20), mats.reel);
      reel.position.set((x0 + x1) / 2, 0.5, (z0 + z1) / 2);
      reel.castShadow = true;
      reel.name = 'cable-reel';
      scene.add(reel);
    } else if (kind === 'hall' || kind === 'substation' || kind === 'shed') {
      addBox(x0, z0, x1, z1, h, mats.wall, kind);
      addBox(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, 0.3, mats.roof, kind + '-roof')
        .position.y = h + 0.15;
      // Lit windows: warm rectangles on the long faces.
      const wx = x1 - x0 > z1 - z0 ? (x0 + x1) / 2 : x0;
      const wz = x1 - x0 > z1 - z0 ? z0 - 0.06 : (z0 + z1) / 2;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(6, (x1 - x0) * 0.7), 1), mats.window);
      win.position.set(wx, 2.4, wz);
      if (x1 - x0 <= z1 - z0) win.rotation.y = Math.PI / 2;
      win.name = 'lit-window';
      scene.add(win);
    } else if (kind === 'transformer') {
      addBox(x0, z0, x1, z1, h, mats.wallDark, 'transformer');
      const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 12), mats.frame);
      coil.position.set((x0 + x1) / 2, h + 0.45, (z0 + z1) / 2);
      coil.castShadow = true;
      scene.add(coil);
    } else {
      addBox(x0, z0, x1, z1, h, mats.wall, 'wall');
    }
  }

  // Signage: site boards facing the approaches.
  function addSign(text, sub, x, y, z, ry) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.1),
      new THREE.MeshBasicMaterial({ map: signTexture(text, sub) }),
    );
    sign.position.set(x, y, z);
    sign.rotation.y = ry;
    sign.name = 'sign-' + text;
    scene.add(sign);
    // A mounting pole down to the ground, set behind the board (its front
    // face would otherwise split the sign's text down the middle).
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, y, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.7, metalness: 0.5 }),
    );
    pole.position.set(x - Math.sin(ry) * 0.15, y / 2, z - Math.cos(ry) * 0.15);
    scene.add(pole);
  }
  // Site signs face their approaches from the far edge of each site, so a
  // player planting or retaking sees the site's name ahead of them. The Array
  // Hall sign rides high on its pole, above the panel row that hides a
  // low sign from the plant spot.
  addSign('ARRAY HALL', 'SITE A', 20, 4.6, -17.8, 0); // faces south, toward mid (a plane's front is +Z; PI would turn it away)
  addSign('SUBSTATION', 'SITE B', 20, 3.2, 12.4, 0); // faces north, toward mid
  addSign('PANEL ROW', '', -8, 2.6, -13.2, Math.PI);
  addSign('SERVICE ROAD', '', -8, 2.6, 13.2, 0);

  // Light poles: emissive lamps, no extra real lights. The site poles stand
  // at the sites' edges, never on the plant spot itself.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.7, metalness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x201408, emissive: 0xffc06a, emissiveIntensity: 3 });
  for (const [px, pz] of [[-14, 0], [11, 0], [16, -18], [16, 19], [-28, 0]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 8), poleMat);
    pole.position.set(px, 3, pz);
    pole.castShadow = true;
    scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), lampMat);
    lamp.position.set(px, 6.1, pz);
    scene.add(lamp);
  }
}
