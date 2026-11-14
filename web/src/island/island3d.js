// <island-3d> — ported from frontend/island3d.js, unchanged except for four things:
//   * three is a real dependency now (`import * as THREE`) instead of a CDN dynamic import,
//   * the element reads the shared /state store instead of polling and opening its own SSE,
//   * `lowPower` throttles the frame rate while the scene is only the CCTV inset,
//   * every villager now moves on their OWN decision (src/island/pulse.js) rather than on
//     the poll or on a single global "the round settled" flag, which used to march the
//     whole village off together. /state is still the truth, but only for villagers who
//     have not already moved on an event of their own.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { subscribe } from '../store.js';
import { subscribeActs, subscribeUpdates, subscribeRound, owns, setPopulation } from './pulse.js';
import { rand, FACE_CELL, FACE_LOOKS, FACE_COLS, HAPPY, GRIN, NEUTRAL, WORRIED, SAD, DECIDING, drawFace, moodOf, BLOB, bodyOf, blobParts } from './blob.js';

// <island-3d>: an orbitable orchard island under a snow-capped crag, one blob per agent. Each round plays as a day:
// when a round settles everyone walks to the market (dusk), then back out to the area where
// their next shift happens. Blobs walk the coast road at a steady pace, on the ground.
// Drag to orbit, scroll to zoom, click a place to open it (dispatches "moku:location").
(function () {
  const SEA = 0;
  // Where each task happens. An agent that is deciding (no task yet this round) stays put.
  const AREAS = [
    // "docks" is the orchard: the id is the game's, the place is where the apples are picked.
    // `top` is how far above its ground the place's label rides (the top of what stands there).
    { id: "docks",    name: "Orchard", color: "#d1495b", x: -70, z: 38,  tasks: ["gather_food"], top: 7.4 },
    { id: "forest",   name: "Forest", color: "#3f9450", x: 40,  z: -48, tasks: ["gather_wood"], top: 5.3 },
    { id: "workshop", name: "Workshop", color: "#d98c2b", x: 60,  z: 8,   tasks: ["craft_net", "smoke_fish"], top: 7.6 },
    { id: "site",     name: "Building site", color: "#cf6046", x: -16, z: -50, tasks: ["build_house"], top: 7.9 },
    { id: "market",   name: "Market",                   color: "#8a8f98", x: 18,  z: 56,  tasks: ["idle"], top: 6.9 },
  ];
  const MARKET = AREAS.at(-1);
  const areaOf = task => AREAS.find(a => a.tasks.includes(task));

  function hash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  function fbm(x, y, oct) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * freq, y * freq); norm += amp; amp *= 0.5; freq *= 2.03; }
    return sum / norm;
  }
  function sstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  // the raw landscape, with no road graded into it. ROAD is laid out on this field; height()
  // below is the same field with the road's corridor levelled, and is what everything draws on.
  function baseHeight(x, z) {
    const d = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    const coast = fbm(Math.cos(ang) * 1.9 + 5, Math.sin(ang) * 1.9 + 9, 4);
    const R = 62 + coast * 30;
    const inland = 1 - sstep(R * 0.5, R, d);
    const base = fbm(x * 0.032 + 11, z * 0.032 + 7, 5);
    let y = (base * 0.8 + 0.2) * inland * 19;
    const dc = Math.hypot((x + 46) * 1.05, (z + 26) * 0.95);        // eroded crater ridge
    y += Math.exp(-Math.pow(dc - 14, 2) / 62) * 21 * inland;
    y -= Math.exp(-Math.pow(dc, 2) / 90) * 7 * inland;               // crater bowl
    const spine = Math.max(0, 1 - Math.hypot((x - 10) * 0.85, (z + 2) * 1.25) / 44);
    y += Math.pow(spine, 1.8) * 25 * inland;                          // main ridge
    y += fbm(x * 0.11 + 3, z * 0.11 + 2, 4) * 3.4 * inland;           // gullies
    const ridged = 1 - Math.abs(fbm(x * 0.05 + 21, z * 0.05 + 13, 4) * 2 - 1);
    y += Math.pow(ridged, 2.2) * 5.5 * inland;                        // eroded spurs
    y += fbm(x * 0.34 + 41, z * 0.34 + 29, 3) * 1.1 * inland;         // fine surface detail
    y -= 11 * sstep(R * 0.93, R + 30, d);                             // shelf drops under water
    y -= 14 * sstep(R + 26, R + 90, d);
    return y;
  }

  // The coast road: a loop of waypoints just above the beach. Blobs walk area -> road -> along
  // it -> area, so nobody climbs the mountain or swims. ROAD_HALF_W is the ribbon's half-width
  // (see the "sandy ribbon" mesh below). Every lane offset below is clamped inside it, so a
  // blob's path and its standing spot both always stay on the road, never spilling into the grass.
  const ROAD_HALF_W = 3.2;
  // 2.2m is the top of the beach: walking in from the sea the raw ground first clears it about
  // 7 units inland of the waterline, still on the flat backshore. The loop stops right there
  // and takes no further step inland, which is what used to carry it up the hillside.
  const ROAD_LEVEL = 2.2;
  const ROAD = Array.from({ length: 36 }, (_, i) => {
    const t = i / 36 * Math.PI * 2;
    let r = 120;
    while (r > 10 && baseHeight(Math.cos(t) * r, Math.sin(t) * r) < ROAD_LEVEL) r--;
    return [Math.cos(t) * r, Math.sin(t) * r];
  });
  // the level the ground is graded to under each waypoint, so the path is level across its
  // width instead of tilted. Averaged with its neighbours so the road does not step from one
  // waypoint to the next, and never below ROAD_LEVEL so a dip can never take it into the sea.
  const ROAD_RAW_Y = ROAD.map(([x, z]) => baseHeight(x, z));
  const ROAD_Y = ROAD_RAW_Y.map((y, i) => Math.max(ROAD_LEVEL,
    (ROAD_RAW_Y[(i + 35) % 36] + 2 * y + ROAD_RAW_Y[(i + 1) % 36]) / 4));
  const nearestRoad = (x, z) => ROAD.reduce((best, p, i) =>
    Math.hypot(p[0] - x, p[1] - z) < Math.hypot(ROAD[best][0] - x, ROAD[best][1] - z) ? i : best, 0);
  // the nearest point on the road as a polyline (not just the nearest waypoint, which
  // under-measures on the straight stretch between two of them): how far off the road (x,z)
  // lies, and the level the road has been graded to there.
  function roadNear(x, z) {
    let best = Infinity, y = 0;
    for (let i = 0; i < ROAD.length; i++) {
      const j = (i + 1) % ROAD.length, [ax, az] = ROAD[i], [bx, bz] = ROAD[j];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) { best = d; y = ROAD_Y[i] + (ROAD_Y[j] - ROAD_Y[i]) * t; }
    }
    return { d: best, y };
  }
  // used to keep trees, grass and rocks from clipping through the ribbon
  const distToRoad = (x, z) => roadNear(x, z).d;
  const ROAD_R = ROAD.map(([x, z]) => Math.hypot(x, z));
  // how far from the centre the camera's focus slides when fully zoomed in: just inside the road
  const FOCUS_R = Math.min(...ROAD_R) * 0.86;
  const ROAD_R_IN = Math.min(...ROAD_R) - ROAD_HALF_W * 2, ROAD_R_OUT = Math.max(...ROAD_R) + ROAD_HALF_W * 2;
  // the raw field with the road's corridor graded flat across its width, easing back out to
  // 1.5x the ribbon's half-width so the cut meets the hillside without a step. Never build
  // ROAD from this one, it reads ROAD; use baseHeight. The pads below sit on top of it.
  function roadHeight(x, z) {
    const b = baseHeight(x, z);
    // the corridor only ever lies in a ring around the island, so the mountain, the shallows and
    // the sea skip the polyline scan: this runs three times per terrain vertex
    const r = Math.hypot(x, z);
    if (r < ROAD_R_IN || r > ROAD_R_OUT) return b;
    const { d, y } = roadNear(x, z);
    return b + (y - b) * (1 - sstep(ROAD_HALF_W, ROAD_HALF_W * 1.5, d));
  }
  // the road's direction and sideways normal at waypoint i, so a lane offset can be applied
  // perpendicular to the road no matter which way it is curving at that point
  function roadFrame(i) {
    const n = ROAD.length, p = ROAD[i], nxt = ROAD[(i + 1) % n], prv = ROAD[(i - 1 + n) % n];
    const dx = nxt[0] - prv[0], dz = nxt[1] - prv[1], len = Math.hypot(dx, dz) || 1;
    const tx = dx / len, tz = dz / len;
    return { x: p[0], z: p[1], tx, tz, nx: -tz, nz: tx };
  }
  // Each destination stands on a graded pad beside the road. The raw slope runs several
  // units across a building's footprint here, and the dry strip seaward of the road is only
  // two or three units wide, so there is nowhere flat to stand: the village is terraced in
  // instead. Sited against the road's normal from the road-graded field, then cut into the
  // field everything is drawn on, the same two-pass order the road itself uses.
  const PADS = [
    { x: 40, z: -48, w: 8.4, d: 6.6 },    // forest: logging camp
    { x: 60, z: 8, w: 8.4, d: 6.6 },      // workshop: the basket-weaver's hut
    { x: -16, z: -50, w: 7.8, d: 7.8 },   // building site: a cottage in its scaffold
    { x: 18, z: 56, w: 7.8, d: 7.8 }      // market: the round stall
  ].map(p => {
    const f = roadFrame(nearestRoad(p.x, p.z));
    const span = Math.hypot(p.w, p.d);
    // inland of the ribbon by half a footprint plus clearance, on whichever side the area
    // itself lies, so the building fronts the road instead of standing in it
    const side = Math.sign((p.x - f.x) * f.nx + (p.z - f.z) * f.nz) || 1;
    const off = ROAD_HALF_W + span / 2 + 0.6;
    const x = f.x + f.nx * off * side, z = f.z + f.nz * off * side;
    // level with the road it fronts, so there is no step from the path to the door
    const y = roadHeight(f.x, f.z);
    // the deeper the cut into the hillside, the further the ease-out runs: a fixed skirt
    // leaves a near vertical bank behind the taller sites and the village reads as a quarry
    const cut = Math.abs(y - roadHeight(x, z));
    const r = span / 2 + 0.8;
    // cutting and filling need very different reaches. A cut runs out far so the bank behind
    // the building is a slope and not a quarry wall; a fill is kept to a tight skirt, since
    // out past the road the ground is dropping to the water and a wide one would silt up the
    // shallows with new land.
    // `face` turns a place to front the road: a model's own +z points at it
    return { x, z, y, r, rCut: r + Math.max(6, cut * 2.6), rFill: r + 1.6, face: Math.atan2(f.x - x, f.z - z) };
  });
  // the ground everything is drawn on: the road-graded field with the village pads cut in,
  // each easing out to meet the hillside without a rim
  function height(x, z) {
    let y = roadHeight(x, z);
    for (const p of PADS) {
      const d = Math.hypot(x - p.x, z - p.z);
      const reach = p.y < y ? p.rCut : p.rFill;
      if (d < reach) y += (p.y - y) * (1 - sstep(p.r, reach, d));
    }
    return y;
  }
  // height() is five octaves of fbm on top of each other — something like eighty sines a
  // call. Walking a hundred villagers called it once per villager per frame, which on its
  // own is thirty million sines a second and was by far the most expensive thing on the
  // page. The terrain never changes, so it is baked once here and read back bilinearly;
  // the error is a few hundredths of a unit, under a blob some four units tall.
  const HGRID = 384, HSPAN = 360;
  const HTABLE = new Float32Array(HGRID * HGRID);
  for (let j = 0; j < HGRID; j++) {
    const z = (j / (HGRID - 1) - 0.5) * HSPAN;
    for (let i = 0; i < HGRID; i++) HTABLE[j * HGRID + i] = height((i / (HGRID - 1) - 0.5) * HSPAN, z);
  }
  function heightAt(x, z) {
    const fx = (x / HSPAN + 0.5) * (HGRID - 1), fz = (z / HSPAN + 0.5) * (HGRID - 1);
    if (!(fx >= 0 && fx <= HGRID - 1 && fz >= 0 && fz <= HGRID - 1)) return height(x, z);
    const i = fx | 0, j = fz | 0;
    const i1 = i + 1 < HGRID ? i + 1 : i, j1 = j + 1 < HGRID ? j + 1 : j;
    const tx = fx - i, tz = fz - j;
    const a = HTABLE[j * HGRID + i], b = HTABLE[j * HGRID + i1];
    const c = HTABLE[j1 * HGRID + i], d = HTABLE[j1 * HGRID + i1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  // the pad a destination stands on, or null where there is none: the orchard grows on the
  // open slope, and picking the merely nearest pad would fling its label across the island
  const padFor = (cx, cz) => {
    let best = null, bd = 20;
    for (const p of PADS) {
      const d = Math.hypot(p.x - cx, p.z - cz);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  // waypoints from (x0,z0) to (x1,z1); lane (a signed distance across the ribbon) keeps each
  // blob in its own strip of the road, offset sideways at every waypoint rather than in one
  // fixed world direction, so it tracks the road through curves instead of cutting corners.
  function route(x0, z0, x1, z1, lane) {
    const path = [];
    if (Math.hypot(x1 - x0, z1 - z0) > 40) {
      const a = nearestRoad(x0, z0), b = nearestRoad(x1, z1), n = ROAD.length;
      const step = (b - a + n) % n <= n / 2 ? 1 : n - 1;         // the shorter way round
      for (let i = a; ; i = (i + step) % n) {
        const f = roadFrame(i);
        path.push([f.x + f.nx * lane, f.z + f.nz * lane]);
        if (i === b) break;
      }
    }
    path.push([x1, z1]);
    return path;
  }
  // what a villager looks like (face atlas, moods, bodies) lives in blob.js, shared with the
  // place card's lineup so both draw the same villager from the same id
  // a blob's own lane across the road, stable per agent, always inside the ribbon
  const laneFor = id => (rand(id, 3) * 2 - 1) * (ROAD_HALF_W - 0.6);
  // an agent's own standing spot for an area: the point on the road nearest that area, nudged
  // along the road (so a crowd queues rather than stacking) and across it into its own lane,
  // always on the road itself, never out on the grass around the area.
  // half the length of that queue: eight units did for dots; bodies need room, so it grows
  // with the village (set in apply()) up to a stretch of road that still reads as one place
  let queueHalf = 8;
  function spot(id, area) {
    const f = roadFrame(nearestRoad(area.x, area.z));
    const along = (rand(id, 1) * 2 - 1) * queueHalf;
    return [f.x + f.tx * along + f.nx * laneFor(id), f.z + f.tz * along + f.nz * laneFor(id)];
  }

  // The orchard: three rows of apple trees on the slope just inland of the road, opposite the
  // stretch the pickers queue on. Nothing is graded for it: the trees stand on the hillside.
  const ORCHARD = (() => {
    const a = AREAS[0], f = roadFrame(nearestRoad(a.x, a.z));
    const side = Math.sign(-f.x * f.nx - f.z * f.nz) || 1;        // inland: toward the middle of the island
    const nx = f.nx * side, nz = f.nz * side, trees = [];
    for (let row = 0; row < 3; row++) for (let k = -2; k <= 2; k++) {
      const d = ROAD_HALF_W + 5 + row * 5.8, along = k * 5.8 + (row % 2) * 2.9 - 1.4;
      const x = f.x + f.tx * along + nx * d, z = f.z + f.tz * along + nz * d, y = height(x, z);
      if (y > 2.4 && y < 17 && distToRoad(x, z) > ROAD_HALF_W + 3) trees.push([x, z, y]);
    }
    const x = f.x + nx * (ROAD_HALF_W + 10.8), z = f.z + nz * (ROAD_HALF_W + 10.8);
    return { f, nx, nz, trees, x, z, y: height(x, z), near: (px, pz, r) => Math.hypot(px - x, pz - z) < r };
  })();

  // ---- the party stage: who is a player, what they said, and the weather of the event ----
  const SKY = 0x3f7da3, FOG = 0.0011;                                    // the open sea at the rim, and the backdrop behind it
  const PLAYER = ["#ff5d5d", "#ffb02e", "#ffe14d", "#7be36a", "#2ee6c5", "#4db8ff", "#8f9bff", "#c77dff", "#ff7ad9", "#ff8a4d", "#b6f24d", "#f2f2f2"];
  const GOLD = "#ffd34d";
  const MAX_SAY = 6, SAY_MS = 3500, MAX_RINGS = 24, MAX_HOUSES = 96;
  const clip = t => { t = String(t).replace(/\s+/g, " ").trim(); return t.length > 70 ? t.slice(0, 68).trimEnd() + "\u2026" : t; };
  // how an event looks: sky and fog, the sun's colour and strength, a wash over the picture
  // (r, g, b, alpha), and where it applies the sea, the ground (r, g, b, alpha) and the trees
  const LOOKS = {
    storm: { sky: 0x1b2833, sun: 0x8fa3c2, sunK: 0.4, hemiK: 0.62, fog: 0.004, tint: [14, 24, 44, 0.26], sea: [0x081a26, 0x1d4152, 0x4f7f84], land: [0.9, 0.93, 0.97, 0.2] },
    cold: { sky: 0x5f8299, sun: 0xcfe4ff, sunK: 0.8, hemiK: 1, fog: 0.0034, tint: [165, 210, 255, 0.17], sea: [0x154560, 0x4488a6, 0xa9d9e4], land: [0.93, 0.96, 1, 0.85], trees: [2.1, 2.3, 2.9] },
    fire: { sky: 0x3d2418, sun: 0xff9a55, sunK: 0.75, hemiK: 0.7, fog: 0.0034, tint: [255, 96, 16, 0.1] },
    gold: { sky: 0x4f8ea6, sun: 0xffd98c, sunK: 1.3, hemiK: 1.1, fog: 0.0015, tint: [255, 190, 40, 0.08], sea: [0x4a87a2, 0x76b6bf, 0xdff0cf] },
    blight: { sky: 0x2c4a2a, sun: 0xd2e08a, sunK: 0.85, hemiK: 0.85, fog: 0.004, tint: [110, 150, 20, 0.15], sea: [0x14402e, 0x3f7a4a, 0xa5c070], land: [0.46, 0.42, 0.16, 0.5], trees: [1.5, 1.05, 0.45] },
  };
  // ---- the lens: see render(). Three small shaders over a full-screen quad. ----
  const FX_QUERY = new URLSearchParams(location.search).get("fx");
  const LENS_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  // what is bright enough to glow, shrunk four times
  const LENS_BRIGHT = `
    uniform sampler2D tColor; uniform vec2 uTexel; varying vec2 vUv;
    void main() {
      vec3 c = (texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb
              + texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
      c = min(c, vec3(4.0));
      gl_FragColor = vec4(c * smoothstep(0.82, 1.25, max(c.r, max(c.g, c.b))), 1.0);
    }`;
  const LENS_BLUR = `
    uniform sampler2D tColor; uniform vec2 uStep; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tColor, vUv).rgb * 0.227;
      c += (texture2D(tColor, vUv + uStep * 1.385).rgb + texture2D(tColor, vUv - uStep * 1.385).rgb) * 0.316;
      c += (texture2D(tColor, vUv + uStep * 3.231).rgb + texture2D(tColor, vUv - uStep * 3.231).rgb) * 0.0703;
      gl_FragColor = vec4(c, 1.0);
    }`;
  // Focus, glow, vignette. How far out of focus a pixel is, 0..1, comes from its depth
  // relative to the focus distance: nothing at all across the island (the villagers and the
  // five places have to be read from the back of a room), then rising behind it and in front
  // of it; and a little from the top and bottom edges of the frame. Each tap of the blur is
  // weighed by how far out of focus IT is, so nothing sharp smears into the blur beside it.
  const LENS_OUT = `
    uniform sampler2D tColor, tDepth, tGlow;
    uniform vec2 uTexel, uClip;
    uniform float uFocus, uMaxR, uGlow, uTaps;
    varying vec2 vUv;
    float depthAt(vec2 uv) { float d = texture2D(tDepth, uv).x; return uClip.x * uClip.y / (uClip.y - d * (uClip.y - uClip.x)); }
    float blurOf(float z, vec2 uv) {
      float rel = (z - uFocus) / uFocus;
      float far = smoothstep(0.1, 0.62, rel), near = smoothstep(0.27, 0.5, -rel);
      float edge = max(smoothstep(0.86, 1.0, uv.y), smoothstep(0.14, 0.0, uv.y)) * 0.55;
      return max(max(far * 0.9, near), edge);
    }
    void main() {
      vec3 col = texture2D(tColor, vUv).rgb;
      float z = depthAt(vUv), radius = blurOf(z, vUv) * uMaxR;
      if (radius > 0.6) {
        float sum = 1.0;
        vec2 dir = vec2(1.0, 0.0);
        for (int i = 0; i < 20; i++) {
          if (float(i) >= uTaps) break;
          dir = mat2(-0.7374, 0.6755, -0.6755, -0.7374) * dir;                 // the golden angle
          float ri = radius * sqrt((float(i) + 0.5) / uTaps);
          vec2 uv = vUv + dir * ri * uTexel;
          float zi = depthAt(uv);
          float wi = zi > z ? 1.0 : clamp(blurOf(zi, uv) * uMaxR - ri + 1.0, 0.0, 1.0);
          col += texture2D(tColor, uv).rgb * wi;
          sum += wi;
        }
        col /= sum;
      }
      col += texture2D(tGlow, vUv).rgb * uGlow;
      vec2 v = (vUv - vec2(0.5, 0.46)) * vec2(1.25, 1.1);
      col = mix(col, vec3(0.05, 0.045, 0.1), smoothstep(0.38, 1.0, dot(v, v) * 2.2) * 0.34);
      col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;   // no banding in the falloff
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`;
  // sRGB to linear, for the two shaders below that work in display colours: three then
  // converts back for the screen, or leaves it linear for the lens
  const TO_LINEAR = `
      gl_FragColor.rgb = mix(pow(gl_FragColor.rgb * 0.9478672986 + 0.0521327014, vec3(2.4)), gl_FragColor.rgb * 0.0773993808, vec3(lessThanEqual(gl_FragColor.rgb, vec3(0.04045))));
      #include <colorspace_fragment>`;

  // one particle shader for rain, snow, embers, smoke, sparkles and confetti: everything is
  // moved in the vertex shader from a seed, so a system costs one draw call and no CPU
  const P_VERT = `
    attribute float aRnd;
    attribute vec3 aBase;
    uniform float uSize, uPx, uGrow, uSway, uTime, uHail;
    uniform vec3 uBox, uOrigin, uOff, uDrift;
    varying float vA, vRnd, vHail;
    void main() {
      vec3 p = mod(position * uBox + uOff * (0.75 + 0.5 * aRnd), uBox);
      float life = p.y / uBox.y;
      p.xz = (p.xz - uBox.xz * 0.5) * mix(1.0, 0.25 + life * 1.1, uGrow);
      p += uDrift * life * life;
      p.x += sin(uTime * (0.7 + aRnd) + aRnd * 43.0) * uSway;
      p.z += cos(uTime * (0.6 + aRnd * 0.8) + aRnd * 71.0) * uSway;
      vec4 mv = viewMatrix * vec4(p + uOrigin + aBase, 1.0);
      gl_Position = projectionMatrix * mv;
      vHail = step(fract(aRnd * 13.7) + 0.0001, uHail);        // this share of the drops are hailstones
      gl_PointSize = min(mix(220.0, uPx * 0.011, vHail), uSize * mix(1.0, 0.16, vHail) * (0.6 + 0.8 * fract(aRnd * 7.3)) * mix(1.0, 0.5 + 1.6 * life, uGrow) * uPx / -mv.z);
      vA = mix(1.0, sin(life * 3.14159), uGrow);
      vRnd = aRnd;
    }`;
  const P_FRAG = `
    uniform vec3 uColor;
    uniform float uAlpha, uStreak, uSoft, uRainbow;
    varying float vA, vRnd, vHail;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float disc = 1.0 - smoothstep(0.5 - uSoft, 0.5, length(c));
      float streak = (1.0 - smoothstep(0.012, 0.04, abs(c.x + c.y * 0.3))) * (1.0 - smoothstep(0.3, 0.5, abs(c.y)));
      float stone = 1.0 - smoothstep(0.34, 0.5, length(c));
      float a = mix(mix(disc, streak, uStreak) * uAlpha, stone * min(1.0, uAlpha * 2.0), vHail) * vA;
      if (a < 0.02) discard;
      vec3 col = mix(uColor, 0.55 + 0.45 * cos(6.2832 * (vRnd * 5.0 + vec3(0.0, 0.33, 0.67))), uRainbow);
      col = mix(col, vec3(0.96, 0.98, 1.0) * (0.82 + 0.18 * smoothstep(0.3, -0.2, c.y)), vHail);
      gl_FragColor = vec4(col, a);${TO_LINEAR}
    }`;

  const TEMPLATE_CSS = `
    :host, island-3d { display:block; position:absolute; inset:0; }
    .i3d-canvas { position:absolute; inset:0; cursor:grab; }
    .i3d-canvas:active { cursor:grabbing; }
    .i3d-overlay { position:absolute; inset:0; pointer-events:none; overflow:hidden; transition:opacity .35s ease; }
    /* Hide UI: the place labels go with the rest of the furniture (IslandApp sets the attribute) */
    island-3d[hide-labels] .i3d-overlay { opacity:0; }
    island-3d[hide-labels] .i3d-pin { pointer-events:none !important; }
    /* A place label is set the way the rest of the page's furniture is: no box at all, just
       a small tracked uppercase name and a mono head-count in the page's own pale blues, held
       off the terrain by a soft shadow (as Hide UI and Start are), over a dot in the area's
       colour on the spot itself. It is placed with a transform alone, from the top-left
       corner, so the per-frame move never touches layout (see loop()). */
    .i3d-pin { position:absolute; left:0; top:0; transform-origin:50% 100%; display:flex; flex-direction:column; align-items:center; gap:4px;
      font-family:Nunito, system-ui, sans-serif; background:none; border:0; padding:0; margin:0; cursor:pointer;
      pointer-events:auto; opacity:0; transition:opacity .2s ease; will-change:transform; }
    .i3d-tag { display:flex; align-items:center; gap:6px; white-space:nowrap; }
    .i3d-name { font-size:11px; font-weight:900; letter-spacing:.13em; text-transform:uppercase;
      text-shadow:0 1px 2px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,.85), 0 0 10px rgba(0,0,0,.7); }
    .i3d-count { font-family:'IBM Plex Mono', ui-monospace, monospace; font-size:11px; font-weight:500; line-height:1; color:#fff;
      font-variant-numeric:tabular-nums; padding:2px 5px; border-radius:3px; box-shadow:0 1px 3px rgba(0,0,0,.55);
      text-shadow:0 1px 1px rgba(0,0,0,.45); }
    .i3d-pin.compact .i3d-name { display:none; }
    .i3d-dot { width:7px; height:7px; border-radius:50%; box-shadow:0 0 0 1.5px rgba(242,243,244,.9), 0 1px 3px rgba(0,0,0,.6); }
    .i3d-pin:hover .i3d-name { filter:brightness(1.15); }
    /* the event's wash over the picture: under the labels, over the canvas */
    .i3d-tint { position:absolute; inset:0; pointer-events:none; opacity:0; }
    /* a player's name, riding over their blob in their own colour */
    .i3d-who { --c:#fff; position:absolute; left:0; top:0; opacity:0; transition:opacity .25s ease; will-change:transform; white-space:nowrap;
      font:900 clamp(12px, 1.7vh, 20px)/1 Nunito, system-ui, sans-serif; letter-spacing:.03em; color:#fff; padding:.28em .62em .3em;
      border-radius:99px; background:rgba(10,18,28,.84); border:.16em solid var(--c); box-shadow:0 2px 6px rgba(0,0,0,.5); }
    .i3d-who::after, .i3d-say::after { content:""; position:absolute; left:50%; top:100%; margin:.12em 0 0 -.36em; border:.36em solid transparent;
      border-top-color:var(--c); border-bottom:0; }
    .i3d-who.win { font-size:clamp(15px, 2.4vh, 30px); color:#3a2500; background:#ffd34d; border-color:#fff3b0; border-radius:.7em; text-align:center;
      box-shadow:0 0 0 .14em rgba(255,211,77,.4), 0 3px 12px rgba(0,0,0,.55); }
    .i3d-who.win::before { content:"WINNER"; display:block; font-size:.52em; letter-spacing:.22em; margin-bottom:.22em; opacity:.7; }
    /* what a villager just said */
    .i3d-say { --c:#fffdf5; position:absolute; left:0; top:0; opacity:0; transition:opacity .3s ease; will-change:transform; box-sizing:border-box;
      width:max-content; max-width:15em; font:800 clamp(15px, 2.2vh, 26px)/1.18 Nunito, system-ui, sans-serif; color:#17212b; text-align:center;
      padding:.38em .7em .44em; border-radius:.8em; background:#fffdf5; border:.14em solid var(--c); box-shadow:0 3px 10px rgba(0,0,0,.5);
      overflow-wrap:anywhere; }
    .i3d-say.ai { font-size:clamp(13px, 1.8vh, 22px); max-width:17em; }
    .i3d-say b { display:block; font-size:.6em; font-weight:900; letter-spacing:.12em; text-transform:uppercase; color:#7a8794; margin-bottom:.15em; }
  `;

  class Island3D extends HTMLElement {
    connectedCallback() {
      if (this._booted) return;
      this._booted = true;
      const style = document.createElement("style");
      style.textContent = TEMPLATE_CSS;
      this.appendChild(style);
      this.canvasHost = document.createElement("div");
      this.canvasHost.className = "i3d-canvas";
      this.overlay = document.createElement("div");
      this.overlay.className = "i3d-overlay";
      this.tint = document.createElement("div");
      this.tint.className = "i3d-tint";
      this.appendChild(this.canvasHost);
      this.appendChild(this.tint);
      this.appendChild(this.overlay);
      this.tags = new Map();            // blob id -> a player's (or the winner's) name tag
      this.says = [];                   // the speech bubbles on screen, at most MAX_SAY
      this.sayQueue = [];               // villagers' lines waiting for a free bubble
      this.winner = null;
      // the pin rides over the building rather than over the area's nominal centre, which
      // can sit a dozen units inland of the pad the hut ended up on. Only the label moves:
      // spot() still routes blobs from AREAS, and the pad was cut at the road waypoint
      // nearest that same centre, so the crowd already gathers at the door.
      this.areas = AREAS.map(a => {
        const pad = padFor(a.x, a.z) || ORCHARD;             // over the treetops, for the one place with no pad
        return { ...a, x: pad.x, z: pad.z, ground: pad.y, y: pad.y + a.top, count: 0, shown: -1 };
      });
      this.areaById = new Map(this.areas.map(a => [a.id, a]));
      // agent id -> { id, x, z, job, dest, path, marketAt, marketUntil, mood, ...bodyOf(id) }
      // marketAt / marketUntil are that ONE villager's day at the market: they set off in
      // their own moment after the round settles and leave the moment their own next
      // decision lands. There is deliberately no global "everyone is at the market" flag
      // any more — that flag was what made the whole village turn in one lump.
      this.blobs = new Map();
      this.round = null;
      this.speed = 30;                  // walking speed, world units a second
      this.areas.forEach(a => {
        a.pin = document.createElement("button");
        a.pin.className = "i3d-pin";
        // The site's own colour carries the label: the name is set in a lightened tint of it
        // (the full colour is a mid-tone, and forest green on a green hillside disappears),
        // the head-count sits on a chip of the colour itself, and the dot on the roof matches.
        const tint = "#" + [1, 3, 5].map(i => Math.round(parseInt(a.color.slice(i, i + 2), 16) * 0.42 + 255 * 0.58).toString(16).padStart(2, "0")).join("");
        a.pin.innerHTML = `<span class="i3d-tag"><span class="i3d-name" style="color:${tint}">${a.name}</span>` +
          `<span class="i3d-count" style="background:${a.color}">0</span></span>` +
          `<span class="i3d-dot" style="background:${a.color}"></span>`;
        a.countEl = a.pin.querySelector(".i3d-count");
        a.pin.addEventListener("click", () => window.dispatchEvent(new CustomEvent("moku:location", { detail: a.id })));
        this.overlay.appendChild(a.pin);
      });
      // the tags are measured for decluttering; measure again once the real fonts are in
      document.fonts?.ready?.then(() => { this.areas.forEach(a => { a.boxW = 0; }); for (const t of this.tags.values()) t.bw = 0; });
      this.boot();
    }
    disconnectedCallback() {
      this._unsub?.();
      this._unsubActs?.();
      this._unsubUpdates?.();
      this._unsubRound?.();
      cancelAnimationFrame(this._raf);
      this.dropLens();
      if (this.renderer) this.renderer.dispose();
    }

    // The CCTV inset renders the same scene into a canvas that is then scaled to about a
    // seventh of its width, so at full device pixel ratio it was shading roughly fifty
    // times the pixels anybody could see. Half a CSS pixel is still oversampled for it.
    set lowPower(on) {
      on = !!on;
      if (on === this._lowPower) return;
      this._lowPower = on;
      if (this.renderer) { this.renderer.setPixelRatio(this.pixelRatio()); this.resize(); }
      for (const p of this.fx?.points || []) p.geometry.setDrawRange(0, on ? Math.ceil(p.userData.n * 0.35) : p.userData.n);
    }
    get lowPower() { return !!this._lowPower; }

    // A budget as well as a cap: at 1.8 on a large display the island was shading sixteen
    // million pixels a frame. Small windows are untouched; only very big ones come down.
    pixelRatio() {
      const dpr = window.devicePixelRatio || 1;
      if (this._lowPower) return Math.min(0.5, dpr);
      const px = Math.max(1, (this.clientWidth || 1) * (this.clientHeight || 1));
      return Math.min(1.8, dpr, Math.sqrt(4.2e6 / px));
    }

    async boot() {
      this.THREE = THREE;
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x86b4c9, FOG);
      this.scene = scene;

      const camera = new THREE.PerspectiveCamera(42, 1, 1, 1600);
      this.camera = camera;
      // The opening shot is taken for the host screen, whose panels sit over the top right
      // (the leaderboard), the top left and the bottom edge: from the market's side of the
      // island and fairly high, so the market and the workshop are in the lower middle of the
      // frame, the orchard and the forest either side, and the far shore shows over the peak.
      this.orbit = { r: 220, theta: 1.2, phi: 0.8, tr: 220, ttheta: 1.2, tphi: 0.8 };

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      // Keep the high-density surface that makes the water read as water rather than a
      // flat blue plane — but inside a pixel budget, and far below it while the scene is
      // only the CCTV thumbnail (pixelRatio() above).
      this.renderer = renderer;
      renderer.setPixelRatio(this.pixelRatio());
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setClearColor(SKY, 1);
      this.canvasHost.appendChild(renderer.domElement);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";

      // warm and soft: a low sun the colour of late afternoon, and enough sky in the shadows
      // that a shadow is a tint on the model and not a hole in it
      this.hemi = new THREE.HemisphereLight(0xfff1e0, 0xa8c49a, 1.3);
      scene.add(this.hemi);
      scene.add(new THREE.AmbientLight(0xfff6ee, 0.45));
      const sun = new THREE.DirectionalLight(0xffe6c4, 1.5);
      sun.position.set(-90, 130, 70);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -170; sun.shadow.camera.right = 170;
      sun.shadow.camera.top = 170; sun.shadow.camera.bottom = -170;
      sun.shadow.camera.far = 420;
      sun.shadow.bias = -0.0012;
      scene.add(sun);
      this.sun = sun;

      // ---- terrain ----
      const SIZE = 340, SEG = 330;
      const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const y = height(x, z);
        pos.setY(i, y);
        const hx = height(x + 1.4, z), hz = height(x, z + 1.4);
        const slope = Math.min(1, (Math.abs(y - hx) + Math.abs(y - hz)) / 2.6);
        // a shingle shore, meadow on the lower slopes, rough pasture above it, then bare grey
        // rock and snow on the tops (the snow line itself is drawn per pixel, in the shader)
        if (y < -3) c.set(0x9cc3c9);
        else if (y < 1.3) c.set(0xe2d5b8);
        else if (y < 3) c.setHex(0xe2d5b8).lerp(new THREE.Color(0xa6d48c), (y - 1.3) / 1.7);
        else if (y < 11) c.setHex(0xa6d48c).lerp(new THREE.Color(0x92c983), (y - 3) / 8);
        else if (y < 21) c.setHex(0x92c983).lerp(new THREE.Color(0x88b78c), (y - 11) / 10);
        else if (y < 29) c.setHex(0x88b78c).lerp(new THREE.Color(0x9c96b2), (y - 21) / 8);
        else c.setHex(0x9c96b2);
        if (slope > 0.58 && y > 2) c.lerp(new THREE.Color(y < 13 ? 0xbfc79a : 0x9a94ae), Math.min(1, (slope - 0.58) * 2));   // a bank low down, crag above
        if (y > -0.9 && y < 0.9) c.lerp(new THREE.Color(0xf3f1e8), 0.3 - Math.abs(y) * 0.25);   // surf line
        c.multiplyScalar(0.96 + fbm(x * 0.5, z * 0.5, 2) * 0.08);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      // The per-vertex palette above sets the broad bands; this shader adds the
      // per-pixel detail they cannot carry (sand grain, grass clumping and rock
      // strata), the same way the water surface is upscaled. No extra geometry.
      const landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
      this.landTint = { value: new THREE.Vector4(1, 1, 1, 0) };      // snow, blight: see stage()
      this.landTime = { value: 0 }; this.landShade = { value: 0.16 };   // the cloud shadows that drift over it
      landMat.onBeforeCompile = (sh) => {
        sh.uniforms.uLand = this.landTint;
        sh.uniforms.uTime = this.landTime; sh.uniforms.uShade = this.landShade;
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;")
          .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWNrm = normalize(mat3(modelMatrix) * objectNormal);");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", `#include <common>
            varying vec3 vWPos;
            varying vec3 vWNrm;
            uniform vec4 uLand;
            uniform float uTime, uShade;
            float vRough = 0.9;
            vec3 vFacet = vec3(0.0);
            float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float vn(vec2 p){
              vec2 i = floor(p), f = fract(p);
              vec2 u = f * f * (3.0 - 2.0 * f);
              return mix(mix(h21(i), h21(i + vec2(1,0)), u.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), u.x), u.y);
            }
            float fb(vec2 p, int oct){
              float s = 0.0, a = 0.5;
              for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vn(p); p *= 2.07; a *= 0.5; }
              return s;
            }
            // worley-ish cell noise for grass clumps and rock facets
            float cells(vec2 p){
              vec2 ip = floor(p), fp = fract(p);
              float d = 1.0;
              for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
                vec2 g = vec2(float(x), float(y));
                vec2 o = vec2(h21(ip + g), h21(ip + g + 7.3));
                d = min(d, length(g + o - fp));
              }
              return d;
            }
            // the same cells, but which one: a tilt of its own for every cell, which is what
            // cuts a smooth hillside into the flat facets of a model
            vec3 facetOf(vec2 p){
              vec2 ip = floor(p), fp = fract(p), id = ip;
              float d = 9.0;
              for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
                vec2 g = vec2(float(x), float(y));
                float l = length(g + vec2(h21(ip + g), h21(ip + g + 7.3)) - fp);
                if (l < d) { d = l; id = ip + g; }
              }
              return vec3(h21(id + 1.7) - 0.5, h21(id + 3.3) - 0.5, h21(id + 5.1) - 0.5);
            }`)
          .replace("#include <color_fragment>", `#include <color_fragment>
            {
              vec3 wp = vWPos;
              float alt = wp.y;
              float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);

              // --- shingle: fine grit, and pebbles a shade lighter and darker than the bed ---
              float grain = fb(wp.xz * 9.0, 3);
              float pebble = cells(wp.xz * 2.4);
              float sandMask = 1.0 - smoothstep(0.8, 3.4, alt);
              vec3 sandDetail = vec3(0.03, 0.03, 0.028) * (grain - 0.5) * 2.0
                              + vec3(0.045, 0.045, 0.045) * (0.45 - pebble);

              // --- grass: clumped cells + blade-scale speckle, dries out with altitude ---
              float clump = 1.0 - cells(wp.xz * 0.55);
              float blades = fb(wp.xz * 14.0, 3);
              float grassMask = smoothstep(1.8, 4.0, alt) * (1.0 - smoothstep(13.0, 21.0, alt)) * (1.0 - smoothstep(0.42, 0.72, slope));
              vec3 grassDetail = vec3(-0.03, 0.045, -0.02) * (clump - 0.45) * 1.25
                               + vec3(0.02, 0.028, 0.014) * (blades - 0.5) * 0.9;

              // --- rock: cracked grey crag on steep or high ground ---
              float strata = fb(wp.xz * 0.4 + alt * 0.3, 4);
              float facet = 1.0 - cells(wp.xz * 1.25 + alt * 0.4);
              float rockMask = clamp(smoothstep(0.5, 0.85, slope) + smoothstep(20.0, 29.0, alt), 0.0, 1.0);
              vec3 rockDetail = vec3(0.04, 0.04, 0.045) * (strata - 0.5) * 1.4
                              + vec3(0.03, 0.03, 0.034) * (facet - 0.5);

              // --- facets: big ones on the crag, broad shallow ones across the meadow ---
              vec3 crag = facetOf(wp.xz * 0.2 + alt * 0.07), turf = facetOf(wp.xz * 0.11);
              vFacet = crag * vec3(1.5, 0.0, 1.5) * rockMask + turf * vec3(0.42, 0.0, 0.42) * grassMask;
              diffuseColor.rgb *= 1.0 + crag.y * 0.14 * rockMask + turf.y * 0.07 * grassMask;

              // --- damp sand right at the tideline ---
              float wet = (1.0 - smoothstep(0.0, 1.7, alt)) * step(0.02, alt);
              diffuseColor.rgb *= mix(1.0, 0.72, wet);

              diffuseColor.rgb += sandDetail * sandMask
                                + grassDetail * grassMask
                                + rockDetail * rockMask;

              // --- meadow flowers: drifts of white, yellow and pink dots, gone before they could shimmer ---
              float drift = smoothstep(0.5, 0.66, fb(wp.xz * 0.08 + 31.0, 3)) * grassMask * (1.0 - smoothstep(9.0, 15.0, alt));
              vec2 fc = wp.xz * 0.95, fi = floor(fc);
              float fpick = h21(fi + 3.7);
              float petal = 1.0 - smoothstep(0.09, 0.17, length(fract(fc) - 0.5 - (vec2(h21(fi), h21(fi + 9.1)) - 0.5) * 0.5));
              petal *= step(0.4, h21(fi + 1.3)) * clamp(1.6 - fwidth(fc.x) * 2.2, 0.0, 1.0);
              vec3 fcol = fpick < 0.4 ? vec3(1.0, 0.97, 0.9) : fpick < 0.75 ? vec3(1.0, 0.84, 0.22) : vec3(0.96, 0.55, 0.72);
              diffuseColor.rgb += vec3(0.05, 0.045, -0.02) * drift;
              diffuseColor.rgb = mix(diffuseColor.rgb, fcol, petal * drift);

              // --- the snow line: ragged, lower in the gullies' shade, thin on the steepest faces ---
              float snowCap = smoothstep(30.0, 33.5, alt + fb(wp.xz * 0.16, 3) * 7.0 - slope * 9.0);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.97, 1.0) * (1.0 + crag.y * 0.08), snowCap);

              // large-scale mottling so the whole island never reads flat
              diffuseColor.rgb *= 0.95 + fb(wp.xz * 0.075, 4) * 0.11;
              // cloud shadows: soft, slow, and only as deep as the weather lets them be
              diffuseColor.rgb *= 1.0 - uShade * smoothstep(0.52, 0.7, fb(wp.xz * 0.014 + vec2(uTime * 0.02, uTime * 0.008) + 40.0, 3));
              diffuseColor.rgb = mix(diffuseColor.rgb, uLand.rgb * (0.86 + 0.28 * grain), uLand.a * smoothstep(0.5, 0.86, vWNrm.y) * smoothstep(0.7, 1.6, alt));
              diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 1.0);

              vRough = clamp(0.62 + (1.0 - wet) * 0.3 + (strata - 0.5) * 0.25 * rockMask, 0.35, 1.0);
            }`)
          .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = vRough;")
          .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n  normal = normalize(normal + mat3(viewMatrix) * vFacet);");
      };
      const land = new THREE.Mesh(geo, landMat);
      land.castShadow = true;
      land.receiveShadow = true;
      scene.add(land);

      // ---- trees: a temperate mix, instanced ----
      // Round leafy trees on the lower slopes, in woods with meadow between them; conifers
      // above them and all round the logging camp; apple trees in rows in the orchard, and
      // apples on the wild ones that stand near it. Three draw calls for every crown and
      // trunk on the island (the two kinds of crown share one material, which is what the
      // weather tints), and one more for the apples.
      const mergeGeos = geos => {
        const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
        const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
        const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
        let o = 0;
        for (const g of parts) {
          pos.set(g.attributes.position.array, o * 3);
          nor.set(g.attributes.normal.array, o * 3);
          o += g.attributes.position.count;
        }
        const out = new THREE.BufferGeometry();
        out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
        return out;
      };
      const ball = (r, x, y, z, detail = 0) => new THREE.IcosahedronGeometry(r, detail).translate(x, y, z);
      const tier = (r, h, y) => new THREE.ConeGeometry(r, h, 6).translate(0, y, 0);
      // a leafy crown is three faceted lobes; the apples are set on those same lobes
      const LOBES = [[2.15, 0, 4.4, 0], [1.55, 1.35, 3.5, 0.5], [1.45, -1.15, 3.6, -0.7]];
      const leafGeo = mergeGeos(LOBES.map((l, i) => ball(...l).rotateY(i * 0.4)));
      const firGeo = mergeGeos([tier(2.3, 3.2, 2.7), tier(1.75, 2.8, 4.7), tier(1.15, 2.6, 6.5)]);
      const fruit = (n, salt, size) => mergeGeos(Array.from({ length: n }, (_, i) => {
        const [r, cx, cy, cz] = LOBES[i % 3], a = hash2(i + salt, 3.3) * 6.283, up = -0.35 + hash2(i + salt, 8.1) * 1.05, flat = Math.sqrt(1 - up * up);
        return ball(size, cx + Math.cos(a) * flat * r * 0.97, cy + up * r * 0.97, cz + Math.sin(a) * flat * r * 0.97, 0);
      }));
      const TREES = 400;
      const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: true });
      const leafy = new THREE.InstancedMesh(leafGeo, crownMat, TREES), firs = new THREE.InstancedMesh(firGeo, crownMat, TREES);
      const trunkGeo = new THREE.CylinderGeometry(0.2, 0.34, 3.2, 6);
      trunkGeo.translate(0, 1.6, 0);
      const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x8c6a55, roughness: 1, metalness: 0, flatShading: true }), TREES);
      const appleMat = new THREE.MeshStandardMaterial({ color: 0xe0443e, roughness: 0.45, metalness: 0, flatShading: true });
      const apples = new THREE.InstancedMesh(fruit(13, 0, 0.3), appleMat, 80);
      // the bumper crop: as many again on every apple tree, shown while the event lasts (stage())
      this.laden = new THREE.InstancedMesh(fruit(22, 40, 0.34), appleMat, 80);
      this.laden.visible = false;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), tp = new THREE.Vector3();
      const tcol = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
      const treeXZ = this.treeXZ = [];
      const count = { leafy: 0, firs: 0, trunks: 0, apples: 0 };
      const plant = (x, z, hgt, fir, s, tall, i, fruity) => {
        tp.set(x, hgt - 0.3, z);
        sc.set(s, s * tall, s);
        q.setFromAxisAngle(UP, hash2(i, 2) * 6.28);
        m4.compose(tp, q, sc);
        trunks.setMatrixAt(count.trunks++, m4);
        if (fir) {
          tcol.setHSL(0.4 + hash2(i, 11) * 0.045, 0.3 + hash2(i, 13) * 0.1, 0.3 + hash2(i, 17) * 0.07);
          firs.setMatrixAt(count.firs, m4); firs.setColorAt(count.firs++, tcol);
        } else {
          // the odd leafy tree has turned: a gold or russet crown among the greens
          const turned = !fruity && hash2(i, 19) < 0.1;
          if (turned) tcol.setHSL(0.06 + hash2(i, 11) * 0.06, 0.66, 0.6);
          else tcol.setHSL(0.27 + hash2(i, 11) * 0.07, 0.4 + hash2(i, 13) * 0.12, 0.47 + hash2(i, 17) * 0.09);
          leafy.setMatrixAt(count.leafy, m4); leafy.setColorAt(count.leafy++, tcol);
          if (fruity && count.apples < 80) { apples.setMatrixAt(count.apples, m4); this.laden.setMatrixAt(count.apples++, m4); }
        }
        treeXZ.push([x, z, hgt]);
      };
      // the orchard's rows: small, even, heavy with fruit
      ORCHARD.trees.forEach(([x, z, y], i) => plant(x, z, y, false, 0.8 + hash2(i, 5) * 0.08, 0.92, 900 + i, true));
      const camp = AREAS[1];
      for (let i = 0; i < 90000 && count.trunks < TREES; i++) {
        const x = (hash2(i * 1.7, 3.1) - 0.5) * 210;
        const z = (hash2(i * 2.3, 9.7) - 0.5) * 210;
        const hgt = height(x, z);
        if (hgt < 2.6 || hgt > 27) continue;
        const sl = Math.abs(hgt - height(x + 1.5, z)) + Math.abs(hgt - height(x, z + 1.5));
        if (sl > 4.4) continue;
        const logging = Math.hypot(x - camp.x, z - camp.z) < 36;          // the forest proper
        // woods and clearings: outside the forest, trees keep to the patches this picks out
        if (!logging && fbm(x * 0.045 + 3, z * 0.045 + 17, 3) < 0.47) continue;
        if (hash2(i * 5.3, 1.9) > (logging ? 0.2 : 0.1)) continue;
        if (distToRoad(x, z) < ROAD_HALF_W + 4) continue;                 // clear of the road, crown included
        if (ORCHARD.near(x, z, 19) || PADS.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 3)) continue;
        const fir = hgt > 15.5 + (hash2(i, 31) - 0.5) * 7 || (logging && hash2(i, 33) < 0.7);
        const s = (fir ? 0.85 : 0.82) + hash2(i * 0.9, 4.4) * 0.45;
        plant(x, z, hgt, fir, s, 0.88 + hash2(i, 7) * 0.4, i, !fir && ORCHARD.near(x, z, 42) && hash2(i, 37) < 0.75);
      }
      leafy.count = count.leafy; firs.count = count.firs; trunks.count = count.trunks; apples.count = this.laden.count = count.apples;
      for (const m of [leafy, firs, trunks, apples, this.laden]) {
        m.castShadow = m !== this.laden; m.receiveShadow = true;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        scene.add(m);
      }
      this.treeMat = crownMat;

      // ---- water: shader surface with waves, depth shading and shoreline foam ----
      const HMAP = 256;
      const hdata = new Uint8Array(HMAP * HMAP * 4);
      for (let j = 0; j < HMAP; j++) {
        for (let k = 0; k < HMAP; k++) {
          const wx = (k / (HMAP - 1) - 0.5) * SIZE;
          const wz = (j / (HMAP - 1) - 0.5) * SIZE;
          const hh = height(wx, wz);
          const v = Math.max(0, Math.min(255, Math.round((hh + 40) * 3.1)));  // -40..42 -> 0..255
          const o = (j * HMAP + k) * 4;
          hdata[o] = v; hdata[o + 1] = v; hdata[o + 2] = v; hdata[o + 3] = 255;
        }
      }
      const hTex = new THREE.DataTexture(hdata, HMAP, HMAP, THREE.RGBAFormat);
      hTex.minFilter = hTex.magFilter = THREE.LinearFilter;
      hTex.needsUpdate = true;

      const waterUniforms = {
        uTime: { value: 0 },
        uHeight: { value: hTex },
        uSize: { value: SIZE },
        uSun: { value: new THREE.Vector3(-90, 130, 70).normalize() },
        // a northern sea: slate out deep, grey-green over the shallows
        uDeep: { value: new THREE.Color(0x3f7da3).convertLinearToSRGB() },
        uMid: { value: new THREE.Color(0x5fa6c2).convertLinearToSRGB() },
        uShallow: { value: new THREE.Color(0xbfe6e0).convertLinearToSRGB() },
        uFoam: { value: new THREE.Color(0xf2fbff) },
        uCam: { value: new THREE.Vector3() },
        uRough: { value: 0 },                              // 0 calm .. 1 storm
        // The colour the sea dissolves into at its rim: the renderer's clear colour exactly,
        // so where the plane stops there is nothing to see stop. This material writes its
        // colour straight to the canvas with no output transform, so it needs the value as it
        // will be displayed (sRGB), not the linear one a THREE.Color holds.
        uHorizon: { value: new THREE.Color(SKY).convertLinearToSRGB() }
      };
      const waterMat = new THREE.ShaderMaterial({
        uniforms: waterUniforms,
        vertexShader: `
          uniform float uTime, uRough;
          varying vec3 vWorld;
          varying vec2 vWave;
          void main() {
            vec3 p = position;
            float w1 = sin(p.x * 0.055 + uTime * 0.9) * cos(p.y * 0.041 - uTime * 0.7);
            float w2 = sin((p.x + p.y) * 0.031 - uTime * 1.3);
            float w3 = sin(p.y * 0.12 + uTime * 1.9) * 0.35;
            float disp = (w1 * 0.55 + w2 * 0.4 + w3 * 0.18) * (1.0 + uRough * 0.9)
                       + uRough * 0.5 * sin(p.x * 0.21 + uTime * 2.6) * cos(p.y * 0.17 - uTime * 2.1);
            p.z += disp;
            vWave = vec2(w1, w2);
            vec4 wp = modelMatrix * vec4(p, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform float uTime, uRough;
          uniform float uSize;
          uniform sampler2D uHeight;
          uniform vec3 uSun, uCam, uDeep, uMid, uShallow, uFoam, uHorizon;
          varying vec3 vWorld;
          varying vec2 vWave;

          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p){
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                       mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
          }
          float fbm(vec2 p){
            float s = 0.0, a = 0.5;
            for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
            return s;
          }
          float terrainAt(vec2 xz){
            vec2 uv = xz / uSize + 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return -40.0;
            return texture2D(uHeight, uv).r * 255.0 / 3.1 - 40.0;
          }
          void main() {
            vec2 xz = vWorld.xz;
            float r = length(xz);
            // Past the rim the sea is the backdrop's own colour and nothing else: no noise,
            // no lighting. Zoomed right out this is most of the water on screen, so the wide
            // shot costs less than it did, not more.
            if (r > 530.0) { gl_FragColor = vec4(uHorizon, 1.0);${TO_LINEAR}
              return; }
            // The seabed is only known inside the terrain's square, and at that square's edge
            // it is not yet as deep as the open sea is taken to be, which drew the square on
            // the water. Ease the depth out to the open sea's before the edge is reached.
            float depth = mix(-terrainAt(xz), 40.0, smoothstep(uSize * 0.26, uSize * 0.495, r));   // metres of water
            float shore = smoothstep(0.0, 10.0, depth);
            // a long ramp: the shallows' colour thins into the open sea over the whole shelf, reaching
            // the deep colour only where the depth does (40), so there is no ring to find an edge on
            float mid = smoothstep(5.0, 26.0, depth);
            mid = mid * mid * (3.0 - 2.0 * mid);
            vec3 col = mix(mix(uShallow, uMid, shore), uDeep, mid);

            // Two scrolling fractal fields give the old water its fine choppy
            // highlights and keep the foam from reading as a uniform ring.
            float n1 = fbm(xz * 0.19 + vec2(uTime * 0.16, uTime * 0.11));
            float n2 = fbm(xz * 0.46 - vec2(uTime * 0.23, uTime * 0.19));
            float e = 0.55;
            float hxa = fbm((xz + vec2(e, 0.0)) * 0.19 + vec2(uTime * 0.16, uTime * 0.11));
            float hza = fbm((xz + vec2(0.0, e)) * 0.19 + vec2(uTime * 0.16, uTime * 0.11));
            vec3 nrm = normalize(vec3((n1 - hxa) * 5.0, 1.0, (n1 - hza) * 5.0));

            // lighting: diffuse tint + sharp sun glint + fresnel sky
            vec3 viewDir = normalize(uCam - vWorld);
            vec3 halfv = normalize(uSun + viewDir);
            float spec = pow(max(dot(nrm, halfv), 0.0), 220.0) * 0.7;
            float sparkle = pow(max(dot(nrm, halfv), 0.0), 40.0) * 0.07 * (0.4 + n2);
            float fres = pow(1.0 - max(dot(nrm, viewDir), 0.0), 3.0);
            col += vec3(0.10, 0.14, 0.18) * (n1 - 0.5) * (0.4 + 0.7 * uRough);
            col = mix(col, vec3(0.62, 0.84, 0.92), fres * 0.28);
            col += vec3(1.0, 0.97, 0.88) * (spec + sparkle) * (1.0 - uRough * 0.85);
            col = mix(col, uFoam * 0.8, uRough * 0.55 * smoothstep(0.56, 0.74, n2 + vWave.x * 0.12));   // whitecaps

            // shoreline foam: band over shallow ground, broken up by noise and swell
            float band = 1.0 - smoothstep(0.0, 4.2, depth);
            float swell = 0.5 + 0.5 * sin(depth * 2.1 - uTime * 2.2 + n1 * 5.0);
            float foam = band * smoothstep(0.35, 0.85, swell * (0.55 + 0.7 * fbm(xz * 0.7 + uTime * 0.08))) * (0.55 + 0.45 * uRough);
            foam += (1.0 - smoothstep(0.0, 0.7, depth)) * 0.55;
            // a pale ring where the shelf drops away: the edge of the model's base, lapping
            float ring = smoothstep(4.0, 9.0, depth) * (1.0 - smoothstep(9.0, 15.0 + 2.0 * sin(uTime * 0.7 + n1 * 4.0), depth));
            col = mix(col, uShallow, ring * 0.3);
            col = mix(col, uFoam, clamp(foam, 0.0, 0.9));

            // …and the lit, choppy sea fades into that flat colour on the way out to the rim
            col = mix(col, uHorizon, smoothstep(260.0, 520.0, r));

            float alpha = clamp(0.62 + shore * 0.38 + foam * 0.4, 0.0, 1.0);
            gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);${TO_LINEAR}
          }`,
        transparent: true,
        depthWrite: true
      });
      const water = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1100, 150, 150), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.y = SEA;
      water.receiveShadow = false;
      scene.add(water);
      this.water = water;
      this.waterUniforms = waterUniforms;

      // ---- villagers: Primer blobs ----
      // One pear of a body, instanced: every villager is the same lathe under its own matrix
      // (height, girth and lean from its id), so the whole village is one draw call. The face
      // is a patch of that same lathe, a hair proud of the skin, sharing the body's matrices
      // and picking its cell of a canvas-drawn atlas — mood across, the villager's own
      // features down. Hats and the like are modelled in the body's space too, so they take
      // the body's matrix as it is. The meshes themselves are built in syncBlobs().
      {
        // the body, the face patch, the face atlas and the hats are blob.js's (blobParts), so
        // the place card's lineup renders the very same model
        const parts = blobParts();
        this.blobGeo = parts.bodyGeo;
        this.blobMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
        this.faceGeo = parts.faceGeo;

        const atlas = new THREE.CanvasTexture(parts.atlas);
        atlas.colorSpace = THREE.SRGBColorSpace;
        atlas.anisotropy = 4;
        this.faceMat = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        this.faceMat.onBeforeCompile = (sh) => {
          sh.vertexShader = "attribute vec2 aFace;\n" + sh.vertexShader.replace("#include <uv_vertex>",
            `#include <uv_vertex>\n\tvMapUv = (vMapUv + aFace) * vec2(${(1 / FACE_COLS).toFixed(6)}, ${(1 / FACE_LOOKS).toFixed(6)});`);
        };

        const std = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0 });
        this.extras = parts.extras.map(e => ({ mat: std(e.color), geo: e.geo }));
      }
      // one linear colour per area, worked out once: `new Color().set("#1f9fb5")` per blob
      // per frame was a hundred string parses and sRGB conversions a frame for nothing
      this.areaRGB = new Map(AREAS.map(a => { const col = new THREE.Color(a.color); return [a.id, [col.r, col.g, col.b]]; }));

      // ---- the places: an orchard, a logging camp, a basket-weaver's hut, a cottage going up
      // in its scaffold, and a round market stall ----
      // Every piece of every place is baked into one mesh per colour, so the whole village is
      // a dozen draw calls however many crates and rungs it is made of. A place is modelled in
      // its own frame: origin on its ground, +z toward the road it fronts, +x along it.
      {
        const WOOD = 0xc8a17b, DARK = 0x97755a, PLANK = 0xe8cc94, THATCH = 0xe6b868, WICKER = 0xd9ad68, RIM = 0xa9824c,
          STONE = 0xb7b1b3, DAUB = 0xf5ecd9, CANVAS = 0xefe6cf, SHADE = 0x5b4b55, APPLE = 0xe0443e, IRON = 0x7f858f,
          STRIPE = 0xe8685f, CREAM = 0xfdf5e3, LEAF = 0x86c07a;
        const baked = new Map();
        const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
        const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
        // a ridge roof (or a tent): base w × len on y = 0, ridge along z at height h
        const gable = (w, h, len) => new THREE.CylinderGeometry(1, 1, len, 3).rotateX(-Math.PI / 2).scale(w / 1.732, h / 1.5, 1).translate(0, h / 3, 0);
        const place = (x, y, z, rot = 0, k = 1) => {
          const base = new THREE.Matrix4().makeRotationY(rot).scale(new THREE.Vector3(k, k, k)).setPosition(x, y, z), local = new THREE.Matrix4();
          const e = new THREE.Euler(), qq = new THREE.Quaternion(), a3 = new THREE.Vector3(), b3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
          const bake = (geo, color) => {
            const g = geo.index ? geo.toNonIndexed() : geo.clone();
            g.deleteAttribute("uv");
            g.applyMatrix4(local.premultiply(base));
            (baked.get(color) || baked.set(color, []).get(color)).push(g);
          };
          const put = (geo, color, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) => {
            local.makeRotationFromEuler(e.set(rx, ry, rz)).setPosition(px, py, pz);
            bake(geo, color);
            return put;
          };
          // a square timber from a to b
          put.beam = (color, a, b, thick = 0.2) => {
            a3.set(...a); b3.set(...b);
            const len = a3.distanceTo(b3);
            qq.setFromUnitVectors(UP, b3.clone().sub(a3).normalize());
            local.compose(a3.add(b3).multiplyScalar(0.5), qq, one);
            bake(box(thick, len, thick), color);
            return put;
          };
          // the ground under a point of the place, in the place's own height: props out at
          // the edge of a pad stand on what is really there
          const c = Math.cos(rot), sn = Math.sin(rot);
          put.on = (px, pz) => (height(x + (px * c + pz * sn) * k, z + (pz * c - px * sn) * k) - y) / k;
          return put;
        };
        // a heap of apples: one lumpy red mound reads from across the island where single apples would not
        const heap = (put, x, y, z, r = 0.5) => put(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.55, 0.8), APPLE, x, y, z);
        const crate = (put, x, z, ry = 0, y = put.on(x, z)) => { put(box(1.1, 0.6, 0.8), DARK, x, y + 0.3, z, 0, ry); heap(put, x, y + 0.62, z, 0.5); };
        const basket = (put, x, z, y = put.on(x, z), full = false) => {
          put(cyl(0.56, 0.4, 0.56), WICKER, x, y + 0.28, z)(cyl(0.6, 0.6, 0.1), RIM, x, y + 0.56, z);
          if (full) heap(put, x, y + 0.6, z, 0.46);
          else if (full === null) put(new THREE.TorusGeometry(0.5, 0.05, 4, 8, Math.PI), RIM, x, y + 0.58, z);      // the top of a stack shows its handle
        };
        const ladder = (put, a, b, color = PLANK) => {
          const dx = b[0] - a[0], dz = b[2] - a[2], n = Math.hypot(dx, dz) || 1, sx = -dz / n * 0.3, sz = dx / n * 0.3;
          put.beam(color, [a[0] + sx, a[1], a[2] + sz], [b[0] + sx, b[1], b[2] + sz], 0.1).beam(color, [a[0] - sx, a[1], a[2] - sz], [b[0] - sx, b[1], b[2] - sz], 0.1);
          for (let k = 1; k < 7; k++) {
            const t = k / 7, x = a[0] + dx * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + dz * t;
            put.beam(color, [x + sx, y, z + sz], [x - sx, y, z - sz], 0.08);
          }
        };
        // the ground under a rotated footprint, corner to corner. A single centre sample
        // says nothing about what the far corners sit on, which is how a building ends up
        // with one wall buried and the opposite one hanging in the air.
        const groundUnder = (x, z, w, d, rot) => {
          const c = Math.cos(rot), sn = Math.sin(rot);
          let lo = Infinity, hi = -Infinity;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
            const lx = a * w / 2, lz = b * d / 2;
            const y = height(x + lx * c + lz * sn, z - lx * sn + lz * c);
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
          return { lo, hi };
        };
        // a place on its graded pad, standing on the high corner of what the pad actually came
        // out as, on a stone footing that takes up whatever the ground drops across it
        const onPad = (area, w, d, k = 1.25) => {
          const p = padFor(area.x, area.z), g = groundUnder(p.x, p.z, w * k, d * k, p.face), put = place(p.x, g.hi, p.z, p.face, k);
          put.foot = (g.hi - g.lo) / k + 0.9;
          return put;
        };

        // the orchard: crates and baskets by the road, a cart, a ladder up the nearest tree
        {
          const O = ORCHARD, f = O.f, d = ROAD_HALF_W + 1.9, ox = f.x + O.nx * d, oz = f.z + O.nz * d;
          const rot = Math.atan2(-O.nx, -O.nz), put = place(ox, height(ox, oz), oz, rot);
          crate(put, -3.4, 0.2, 0.2); crate(put, -2.1, -0.1, -0.15); crate(put, -2.8, 0.1, 0.5, put.on(-2.8, 0.1) + 0.6);
          basket(put, -0.4, 0.3, undefined, true); basket(put, 0.8, 0, undefined, true); basket(put, 0.3, -1, undefined, true);
          // the cart, its shafts down on the grass
          const cx = 4.6, cy = put.on(cx, 0);
          put(box(2.4, 0.6, 1.4), WOOD, cx, cy + 1, 0)(box(2.5, 0.12, 1.5), DARK, cx, cy + 0.7, 0);
          for (const s of [-1, 1]) {
            put(cyl(0.6, 0.6, 0.14, 10), DARK, cx - 0.2, cy + 0.6, s * 0.85, Math.PI / 2);
            put.beam(DARK, [cx + 1.2, cy + 0.8, s * 0.5], [cx + 2.9, cy + 0.15, s * 0.5], 0.1);
          }
          heap(put, cx, cy + 1.4, 0, 1.05);
          // the ladder leans on the first tree of the front row that is there to lean on
          const t = O.trees.find(([x, z]) => Math.abs((x - f.x) * f.tx + (z - f.z) * f.tz) < 4) || O.trees[0];
          if (t) {
            const c = Math.cos(rot), sn = Math.sin(rot), lx = (t[0] - ox) * c - (t[1] - oz) * sn, lz = (t[0] - ox) * sn + (t[1] - oz) * c, ly = t[2] - height(ox, oz);
            ladder(put, [lx + 0.5, ly - 0.2, lz + 2], [lx + 0.2, ly + 3.5, lz + 0.9]);
            basket(put, lx - 1.3, lz + 1.6, undefined, true);
          }
        }

        // the forest: a logging camp. A canvas tent, the day's logs stacked, a log on the
        // sawhorse, an axe left in the chopping block
        {
          const put = onPad(AREAS[1], 6, 5);
          put(gable(3.8, 3.1, 4.2), CANVAS, -1.6, 0, -0.9)(box(1, 1.7, 0.1), SHADE, -1.6, 0.85, 1.19);
          put.beam(DARK, [-1.6, 3.1, -3.4], [-1.6, 3.1, 1.6], 0.16).beam(DARK, [-1.6, 0, 1.4], [-1.6, 3.2, 1.4], 0.16);
          const log = (x, y, z, len = 4.2, r = 0.36, ry = 0) => put(cyl(r, r, len, 7), y > 0.6 ? WOOD : DARK, x, y, z, Math.PI / 2, 0, ry)(cyl(r * 0.8, r * 0.8, len + 0.04, 7), PLANK, x, y, z, Math.PI / 2, 0, ry);
          const py = put.on(2.6, -1.2);
          [[0, 0], [1, 0], [2, 0], [0.5, 1], [1.5, 1], [1, 2]].forEach(([c, r]) => log(1.9 + c * 0.74, py + 0.36 + r * 0.63, -1.2));
          put.beam(DARK, [1.5, py, -1.2 + 1.4], [1.5, py + 1.3, -1.2 + 1.4], 0.14).beam(DARK, [4.1, py, -1.2 + 1.4], [4.1, py + 1.3, -1.2 + 1.4], 0.14);
          // sawhorse: two crossed pairs, a log across them
          const sy = put.on(1.6, 2);
          for (const sz of [1.3, 2.7]) put.beam(WOOD, [0.9, sy, sz], [2.3, sy + 1.5, sz], 0.14).beam(WOOD, [2.3, sy, sz], [0.9, sy + 1.5, sz], 0.14);
          log(1.6, sy + 1.12, 2, 3.2, 0.3);
          // chopping block and axe
          const by = put.on(-0.6, 2.5);
          put(cyl(0.6, 0.7, 0.8, 9), DARK, -0.6, by + 0.4, 2.5)(cyl(0.5, 0.5, 0.04, 9), PLANK, -0.6, by + 0.81, 2.5);
          put.beam(WOOD, [-0.55, by + 0.9, 2.5], [0.25, by + 1.9, 2.75], 0.1)(box(0.5, 0.34, 0.1), IRON, -0.62, by + 0.95, 2.48, 0, 0.3, 0.9);
          // stumps where the nearest trees came down
          [[-4.3, 1.4], [4.4, 2.3], [-3.9, -3.4]].forEach(([x, z]) => put(cyl(0.45, 0.6, 0.6, 8), DARK, x, put.on(x, z) + 0.25, z)(cyl(0.4, 0.4, 0.04, 8), PLANK, x, put.on(x, z) + 0.56, z));
        }

        // the workshop: the basket-weaver's hut. Daubed walls in a timber frame under a
        // steep thatch, a lean-to at the front, and the week's baskets stacked under it
        {
          const put = onPad(AREAS[2], 6.4, 5), W = 5.6, D = 4, H = 2.7;
          put(box(W + 0.5, put.foot, D + 0.5), STONE, 0, -put.foot / 2 + 0.06, -0.5);
          put(box(W, H, D), DAUB, 0, H / 2, -0.5);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(box(0.28, H, 0.28), DARK, sx * W / 2, H / 2, -0.5 + sz * D / 2);
          for (const sz of [-1, 1]) put(box(W + 0.2, 0.24, 0.26), DARK, 0, H - 0.12, -0.5 + sz * D / 2)(box(W + 0.2, 0.2, 0.26), DARK, 0, 1.25, -0.5 + sz * D / 2);
          put(gable(D + 1.3, 3, W + 1), THATCH, 0, H - 0.05, -0.5, 0, Math.PI / 2)(box(W + 1.1, 0.16, 0.3), RIM, 0, H + 2.95, -0.5);
          put(box(1, 1.9, 0.14), SHADE, -1.5, 0.95, 1.56)(box(0.9, 0.8, 0.14), SHADE, 1.3, 1.6, 1.56);
          // the lean-to and what is under it
          put(box(3.6, 0.12, 2), PLANK, 1.1, 2.25, 2.35, 0.32).beam(DARK, [-0.5, 0, 3.15], [-0.5, 2, 3.15], 0.16).beam(DARK, [2.7, 0, 3.15], [2.7, 2, 3.15], 0.16);
          for (let k = 0; k < 3; k++) basket(put, 0.3, 2.4, k * 0.58, k === 2 ? null : false);
          for (let k = 0; k < 2; k++) basket(put, 1.5, 2.6, k * 0.58, k === 1 ? null : false);
          basket(put, 2.4, 2.2, 0, null); basket(put, 0.9, 3.3, put.on(0.9, 3.3), null);
          // more of them at the gable end, and withies leaning on the wall, waiting
          for (let k = 0; k < 4; k++) basket(put, 3.9, -0.4, put.on(3.9, -0.4) + k * 0.58, k === 3 ? null : false);
          for (let k = 0; k < 2; k++) basket(put, 4.1, 0.9, put.on(4.1, 0.9) + k * 0.58, k === 1 ? null : false);
          for (let k = 0; k < 5; k++) put.beam(0xb9b06a, [-3.3 - k * 0.12, 0, 0.4 - k * 0.35], [-2.95, 2.5 - k * 0.1, 0.3 - k * 0.35], 0.07);
          put(cyl(0.2, 0.2, 2.2, 6), 0xb9b06a, -3.6, put.on(-3.6, -1.6) + 0.2, -1.6, Math.PI / 2);
        }

        // the building site: a round cottage half up, its rafters on, inside a timber scaffold;
        // planks stacked by the road
        {
          const put = onPad(AREAS[3], 6.4, 6.4), R = 2.9;
          put(cyl(R + 0.9, R + 1, put.foot, 12), STONE, 0, -put.foot / 2 + 0.06, 0);
          put(cyl(1.9, 2, 1.7, 12), DAUB, 0, 0.85, 0)(cyl(1.7, 1.7, 0.06, 12), SHADE, 0, 1.71, 0)(box(0.8, 1.3, 0.3), SHADE, 0, 0.65, 1.86);
          for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283 + 0.3; put.beam(WOOD, [Math.cos(a) * 2.05, 1.7, Math.sin(a) * 2.05], [0, 4.1, 0], 0.13); }
          const corners = [[-R, -R], [R, -R], [R, R], [-R, R]];
          corners.forEach(([x, z], i) => {
            const g = Math.min(0, put.on(x, z)) - 0.2, [nx, nz] = corners[(i + 1) % 4];
            put.beam(i % 2 ? DARK : WOOD, [x, g, z], [x, 5.9, z], 0.24);
            for (const y of [2.5, 4.7]) put.beam(WOOD, [x, y, z], [nx, y, nz], 0.16);
            if (i % 2 === 0) put.beam(DARK, [x, 0.2, z], [nx, 2.5, nz], 0.12).beam(DARK, [nx, 2.5, nz], [x, 4.7, z], 0.12);
          });
          // the decks the builders stand on: all round at the first lift, front and one side at the second
          put(box(2 * R + 0.6, 0.12, 1), PLANK, 0, 2.62, R - 0.35)(box(2 * R + 0.6, 0.12, 1), PLANK, 0, 2.62, -R + 0.35);
          put(box(1, 0.12, 2 * R - 1.4), PLANK, R - 0.35, 2.62, 0)(box(1, 0.12, 2 * R - 1.4), PLANK, -R + 0.35, 2.62, 0);
          put(box(2 * R + 0.6, 0.12, 1), PLANK, 0, 4.82, R - 0.35)(box(1, 0.12, 2 * R - 1.4), PLANK, R - 0.35, 4.82, 0);
          ladder(put, [-R - 1.5, put.on(-R - 1.5, R - 0.3) , R - 0.3], [-R + 0.3, 2.9, R - 0.3]);
          for (let k = 0; k < 5; k++) put(box(3.4, 0.2, 0.7), PLANK, R + 1.5, put.on(R + 1.5, 0.8) + 0.12 + k * 0.22, 0.8, 0, 0.12 * (k % 2));
          for (let k = 0; k < 3; k++) put(box(3.4, 0.2, 0.7), PLANK, R + 1.6, put.on(R + 1.6, -0.5) + 0.12 + k * 0.22, -0.5, 0, -0.1);
          for (let k = 0; k < 5; k++) put(new THREE.IcosahedronGeometry(0.42 - k * 0.03, 0), STONE, -R - 1.3 + (k % 3) * 0.6, put.on(-R - 1, -1.6) + 0.25 + (k > 2 ? 0.45 : 0), -1.6 - (k % 2) * 0.5, k, k * 2);
        }

        // the market: a round stall under a striped canopy, apples on the counter and by the crate all round it
        {
          const put = onPad(AREAS[4], 6.4, 6.4), R = 3.7, N = 12, wedge = 6.2832 / N, postH = 2.7;
          put(cyl(R + 0.2, R + 0.4, put.foot, 16), STONE, 0, -put.foot / 2 + 0.06, 0);
          for (let k = 0; k < N; k++) {
            const color = k % 2 ? CREAM : STRIPE;
            put(new THREE.ConeGeometry(R, 2, N, 1, true, k * wedge, wedge), color, 0, postH + 1, 0);
            put(new THREE.CylinderGeometry(R, R, 0.55, N, 1, true, k * wedge, wedge), color, 0, postH - 0.27, 0);
            if (k % 2 === 0) { const a = (k + 0.5) * wedge; put(cyl(0.13, 0.15, postH, 6), DARK, Math.sin(a) * (R - 0.25), postH / 2, Math.cos(a) * (R - 0.25)); }
          }
          put(cyl(0.16, 0.18, postH + 2.3, 6), DARK, 0, (postH + 2.3) / 2, 0)(new THREE.IcosahedronGeometry(0.28, 1), 0xffc94a, 0, postH + 2.4, 0);
          put(cyl(1.7, 1.7, 0.95, 14), PLANK, 0, 0.475, 0)(cyl(1.85, 1.85, 0.1, 14), WOOD, 0, 0.98, 0);
          heap(put, 0.8, 1.12, 0.6, 0.55); heap(put, -0.7, 1.12, 0.7, 0.5); heap(put, 0, 1.12, -0.9, 0.5);
          put(cyl(0.4, 0.3, 0.4), WICKER, -0.2, 1.22, 0.1)(new THREE.IcosahedronGeometry(0.33, 1).scale(1, 0.5, 1), LEAF, -0.2, 1.42, 0.1);
          for (const a of [0.5, 1.5, 2.4, 3.9, 5.2]) crate(put, Math.sin(a) * 2.75, Math.cos(a) * 2.75, a, 0);
          crate(put, Math.sin(0.5) * 2.75, Math.cos(0.5) * 2.75, 0.9, 0.6); crate(put, Math.sin(3.9) * 2.75, Math.cos(3.9) * 2.75, 4.2, 0.6);
          basket(put, Math.sin(3.1) * 2.7, Math.cos(3.1) * 2.7, 0, true);
        }

        for (const [color, list] of baked) {
          const mesh = new THREE.Mesh(mergeGeometries(list), new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, flatShading: true }));
          mesh.castShadow = mesh.receiveShadow = true;
          scene.add(mesh);
        }
      }

      this.buildStage();
      this._frame = 0;
      this.bindInput();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this);
      this.resize();
      this.loop();
      // the road: a sandy ribbon laid on the ground along the waypoints. Each slice samples
      // several points across the width, not just the two edges. On a slope the terrain
      // between two edge samples can bulge up above the straight line joining them, which is
      // what pokes the mountain through a wide, coarsely-sliced ribbon.
      {
        const pts = [];
        ROAD.forEach(([x, z], i) => {
          const [nx, nz] = ROAD[(i + 1) % ROAD.length], steps = Math.ceil(Math.hypot(nx - x, nz - z) / 2.4);
          for (let k = 0; k < steps; k++) pts.push([x + (nx - x) * k / steps, z + (nz - z) * k / steps]);
        });
        // SPAN is wider than following the ground needs: the spare vertices are what carry the
        // worn-pale centre and gritty shoulders, which two edge samples per slice cannot hold.
        const n = pts.length, SPAN = 9;      // cross-section samples per slice, edge to edge
        // the worn strip wanders instead of running dead centre, and stones gather in stretches
        // rather than evenly. Both are read off the compass bearing so they close at the seam.
        const alongNoise = (x, z, f, sx, sy) => {
          const a = Math.atan2(z, x);
          return vnoise(Math.cos(a) * f + sx, Math.sin(a) * f + sy);
        };
        const verts = [], index = [], rcol = [];
        const worn = new THREE.Color(0xeedcb8), grit = new THREE.Color(0xc9b592), pale = new THREE.Color(0xd9d0c2);
        const rc = new THREE.Color();
        const frames = pts.map(([x, z], i) => {
          const [ax, az] = pts[(i + n - 1) % n], [bx, bz] = pts[(i + 1) % n];
          const len = Math.hypot(bx - ax, bz - az) || 1;
          return {
            x, z, px: -(bz - az) / len, pz: (bx - ax) / len,
            wander: (alongNoise(x, z, 3.1, 5, 2) * 2 - 1) * 0.45,
            clump: alongNoise(x, z, 8.4, 13, 7),
          };
        });
        const rings = frames.map(f => {
          const ring = [];
          for (let s = 0; s < SPAN; s++) {
            const across = s / (SPAN - 1) * 2 - 1;
            const vx = f.x + f.px * across * ROAD_HALF_W, vz = f.z + f.pz * across * ROAD_HALF_W;
            ring.push([vx, height(vx, vz) + 0.4, vz]);
            const g = fbm(vx * 0.55 + 3, vz * 0.55 + 8, 3);
            const wear = smooth(1 - Math.min(1, Math.abs(across - f.wander) / 0.95));
            rc.copy(grit).lerp(worn, Math.min(1, wear * (0.55 + g * 0.5)));
            rc.lerp(pale, Math.max(0, g - 0.52) * 1.25);                   // bare stone showing through
            rc.multiplyScalar(Math.min(1.12, 0.9 + fbm(vx * 1.7 + 21, vz * 1.7 + 13, 2) * 0.24));
            rcol.push(rc.r, rc.g, rc.b);
          }
          return ring;
        });
        rings.forEach(ring => ring.forEach(([vx, vy, vz]) => verts.push(vx, vy, vz)));
        for (let i = 0; i < n; i++) {
          const ni = (i + 1) % n;
          for (let s = 0; s < SPAN - 1; s++) {
            const a = i * SPAN + s, b = a + 1, c = ni * SPAN + s, d = c + 1;
            index.push(a, b, c, b, d, c);
          }
        }
        const roadGeo = new THREE.BufferGeometry();
        roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        roadGeo.setAttribute("color", new THREE.Float32BufferAttribute(rcol, 3));
        roadGeo.setIndex(index);
        roadGeo.computeVertexNormals();
        // The vertex tones above set the broad wear pattern; this adds what they are far too
        // coarse to hold, grit at sand scale and a pebble-sized mottle, the same upscaling
        // trick the land uses. Nothing to fetch and no extra triangles.
        const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
        roadMat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vRPos;")
            .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n  vRPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
          sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", `#include <common>
              varying vec3 vRPos;
              float rRough = 1.0;
              float rh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
              float rvn(vec2 p){
                vec2 i = floor(p), f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(rh(i), rh(i + vec2(1,0)), u.x), mix(rh(i + vec2(0,1)), rh(i + vec2(1,1)), u.x), u.y);
              }
              float rfb(vec2 p, int oct){
                float s = 0.0, a = 0.5;
                for (int i = 0; i < 5; i++) { if (i >= oct) break; s += a * rvn(p); p *= 2.07; a *= 0.5; }
                return s;
              }
              // cell noise sized to a pebble: the fill breaks into stones with dark gaps
              // between them instead of dithering into uniform speckle
              float rcell(vec2 p){
                vec2 ip = floor(p), fp = fract(p);
                float d = 1.0;
                for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
                  vec2 g = vec2(float(x), float(y));
                  vec2 o = vec2(rh(ip + g), rh(ip + g + 7.3));
                  d = min(d, length(g + o - fp));
                }
                return d;
              }`)
            .replace("#include <color_fragment>", `#include <color_fragment>
              {
                vec2 wp = vRPos.xz;
                float grit = rfb(wp * 11.0, 3);
                float top = 1.0 - smoothstep(0.04, 0.30, rcell(wp * 2.6));     // a pebble's crown
                float bed = 1.0 - rcell(wp * 0.8);                             // drifts of loose stone
                float stony = clamp(0.25 + bed * 1.1, 0.0, 1.0);               // bare stretches between them
                top *= stony;
                diffuseColor.rgb += vec3(0.055, 0.05, 0.038) * (grit - 0.5) * 2.0;
                diffuseColor.rgb *= 0.88 + top * 0.2;
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.71, 0.67), top * 0.36);
                diffuseColor.rgb = clamp(diffuseColor.rgb, 0.0, 1.0);
                // trodden stone takes a sheen, the loose grit around it does not
                rRough = clamp(1.0 - top * 0.36 - (grit - 0.5) * 0.16, 0.45, 1.0);
              }`)
            .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = rRough;");
        };
        const road = new THREE.Mesh(roadGeo, roadMat);
        road.receiveShadow = true;
        scene.add(road);

        // real stones set into the path, so it reads as a footpath and not a painted strip.
        // Clustered along the same worn centre line the vertex colours follow, with a few
        // strays out to the shoulders, and sunk in rather than dropped on top. One draw call,
        // and small enough that a blob reads as walking over them, not round them.
        const pebGeo = new THREE.IcosahedronGeometry(0.5, 0);
        const MAX_PEB = 420;
        const pebbles = new THREE.InstancedMesh(pebGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.66, flatShading: true }), MAX_PEB);
        const pcol = new THREE.Color(), eu = new THREE.Euler();
        let pebPlaced = 0;
        for (let i = 0; i < 2600 && pebPlaced < MAX_PEB; i++) {
          const f = frames[Math.floor(hash2(i * 0.731, 12.4) * n) % n];
          if (hash2(i * 1.37, 5.9) > 0.012 + f.clump * f.clump * 0.44) continue;   // stony stretches, bare stretches
          const r = hash2(i * 2.17, 31.3) * 2 - 1;
          // cubed and measured off the wandering centre rather than the ribbon's, so the trail
          // winds with the worn strip and only the odd stray reaches a shoulder
          const across = f.wander + r * r * r * (0.93 - Math.abs(f.wander));
          const x = f.x + f.px * across * ROAD_HALF_W, z = f.z + f.pz * across * ROAD_HALF_W;
          const top = height(x, z) + 0.4;
          if (top < SEA + 0.6) continue;                  // never a stone standing in the water
          const s = 0.2 + hash2(i * 3.91, 8.2) * 0.34;
          const ys = 0.5 + hash2(i * 4.53, 19.7) * 0.32;  // squashed: worn flat, not tumbled
          tp.set(x, top - 0.2 * s * ys, z);
          sc.set(s * (0.85 + hash2(i, 51) * 0.4), s * ys, s * (0.85 + hash2(i, 53) * 0.4));
          eu.set(hash2(i, 55) * 6.28, hash2(i, 57) * 6.28, hash2(i, 59) * 6.28);
          q.setFromEuler(eu);
          m4.compose(tp, q, sc);
          pebbles.setMatrixAt(pebPlaced, m4);
          pcol.setHSL(0.09 + hash2(i, 63) * 0.05, 0.04 + hash2(i, 65) * 0.07, 0.44 + hash2(i, 61) * 0.26);
          pebbles.setColorAt(pebPlaced, pcol);
          pebPlaced++;
        }
        pebbles.count = pebPlaced;
        pebbles.instanceMatrix.needsUpdate = true;
        if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
        pebbles.receiveShadow = true;
        scene.add(pebbles);
      }

      // The shared store polls /state and holds the one EventSource; a settled round reaches
      // us the moment it lands, and the scene keeps its last picture if the server goes away.
      this._unsub = subscribe(s => this.apply(s));
      // …and every villager's own answer reaches us the moment THAT villager answers.
      this._unsubActs = subscribeActs(act => this.onAct(act));
      // Later news about a villager who has already acted (their shift arriving after their
      // first order, say) still moves that one villager — and only that one.
      this._unsubUpdates = subscribeUpdates(act => this.onAct(act));
      this._unsubRound = subscribeRound(e => this.settle(e.round, e.roundMs ?? e.ms));
    }

    /** /state: the truth, for first load, reconnection and drift — never a starting gun. */
    apply(s) {
      if (!s) return;                                    // server down: keep the last picture
      if (!s.running) { this.blobs.clear(); this.round = null; this.syncBlobs(); this.syncStage(null); return; }
      setPopulation(s.agents?.length);
      queueHalf = Math.min(24, Math.max(8, (s.agents?.length || 0) * 0.5));
      let changed = false;
      for (const a of s.agents) {
        let b = this.blobs.get(a.id);
        if (!b) {
          changed = true;
          const job = areaOf(a.activity) || MARKET, [x, z] = spot(a.id, job);
          this.blobs.set(a.id, b = { id: a.id, x, z, job, dest: job, path: [], marketAt: 0, marketUntil: 0, mood: HAPPY, ...bodyOf(a.id) });
        }
        b.mood = moodOf(a);
        b.human = !!a.human; b.name = a.name; b.houses = a.houses | 0;
        // A villager whose own news we already hold — shown or still waiting for its slot
        // — is left alone. Without this the poll lands in the middle of a staggered burst
        // and sets the whole village at once: the very lump the stagger is breaking up.
        if (!owns(a.id)) b.job = areaOf(a.activity) || b.job;
      }
      if (this.blobs.size !== s.agents.length) {         // a new game with a smaller village
        const here = new Set(s.agents.map(a => a.id));
        for (const id of this.blobs.keys()) if (!here.has(id)) this.blobs.delete(id);
        changed = true;
      }
      if (changed) this.syncBlobs();
      this.syncStage(s);
      this.settle(s.round, s.roundMs);                   // deduped against the SSE round event
    }

    /** A round settled. Everyone drifts to the market — each in their own moment. */
    settle(round, roundMs) {
      if (typeof round !== 'number') return;
      if (this.round === null) { this.round = round; return; }   // first snapshot: no market trip
      if (round === this.round) return;
      this.round = round;
      const now = performance.now();
      const quick = !(roundMs >= 3000);                  // too short to fit the trip in
      const stay = Math.min(9000, Math.max(3000, (roundMs || 0) * 0.45));
      this.speed = quick ? 60 : Math.max(30, 200 / (stay / 1000 * 0.6));
      for (const b of this.blobs.values()) {
        if (quick) { b.marketAt = 0; b.marketUntil = 0; continue; }
        b.marketAt = now + rand(b.id, 9) * 900;          // sets off in their own moment
        // …and leaves the moment their own answer lands. The fallback, for a villager whose
        // answer never comes, is staggered too, so a village of stragglers still trickles.
        b.marketUntil = now + stay + rand(b.id, 10) * 700;
      }
    }

    /** One villager's own decision has landed: this is the only thing that moves them. */
    onAct(act) {
      const b = this.blobs.get(act.id);
      if (!b) return;
      const area = areaOf(act.task);
      if (area) b.job = area;
      b.marketAt = 0; b.marketUntil = 0;                 // their day at the market is over
      if (act.thought) this.hear(b, act.thought);
    }

    // ---- the party stage ---------------------------------------------------------------
    // Everything the party game adds to the island and nothing the walk depends on: players'
    // rings, houses, the weather's particles and creatures, the winner's crown. All built
    // once, hidden until wanted, and driven from stage() by a handful of eased weights.
    buildStage() {
      const THREE = this.THREE, scene = this.scene, U = this.waterUniforms;
      const col = hex => new THREE.Color(hex);
      for (const L of Object.values(LOOKS)) {
        L.skyC = col(L.sky); L.sunC = col(L.sun);
        if (L.sea) L.seaC = L.sea.map(hex => col(hex).convertLinearToSRGB());      // as seen: the sea writes its colours as they are
        if (L.trees) L.treesC = new THREE.Color().setRGB(...L.trees);
      }
      const fx = this.fx = {
        target: null, w: { storm: 0, cold: 0, fire: 0, shoal: 0, boom: 0, gulls: 0, blight: 0, tax: 0 },
        mix: { storm: 0, cold: 0, fire: 0, gold: 0, blight: 0 },
        clear0: col(SKY), clear: col(SKY), tmp: col(0), fog0: scene.fog.color.clone(), hemi0: this.hemi.color.clone(),
        sea: [U.uDeep.value, U.uMid.value, U.uShallow.value], sea0: [U.uDeep.value.clone(), U.uMid.value.clone(), U.uShallow.value.clone()],
        time: { value: 0 }, px: { value: 1000 }, bolt: 0, boltAt: 0, tintKey: "", points: [],
        houses: [], houseCount: new Map(), houseAnim: false, code: null,
        M: { m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, "YXZ"), p: new THREE.Vector3(), s: new THREE.Vector3() },
      };
      const hide = m => { m.visible = false; m.frustumCulled = false; scene.add(m); return m; };

      // particles: see P_VERT. `u` overrides the defaults; arrays set vectors and colours.
      const points = (n, u, blending = THREE.NormalBlending) => {
        const geo = new THREE.BufferGeometry(), seed = new Float32Array(n * 3), rnd = new Float32Array(n);
        for (let i = 0; i < n; i++) { seed[i * 3] = hash2(i, 1.3); seed[i * 3 + 1] = hash2(i, 2.7); seed[i * 3 + 2] = hash2(i, 4.1); rnd[i] = hash2(i, 6.9); }
        geo.setAttribute("position", new THREE.BufferAttribute(seed, 3));
        geo.setAttribute("aRnd", new THREE.BufferAttribute(rnd, 1));
        const uniforms = { uTime: fx.time, uPx: fx.px, uSize: { value: 1 }, uGrow: { value: 0 }, uSway: { value: 0 }, uAlpha: { value: 1 },
          uStreak: { value: 0 }, uSoft: { value: 0.15 }, uRainbow: { value: 0 }, uHail: { value: 0 }, uBox: { value: new THREE.Vector3(1, 1, 1) },
          uOrigin: { value: new THREE.Vector3() }, uOff: { value: new THREE.Vector3() }, uDrift: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(1, 1, 1) } };
        for (const k in u) { if (Array.isArray(u[k])) uniforms[k].value.set(...u[k]); else uniforms[k].value = u[k]; }
        const p = hide(new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms, vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthWrite: false, blending })));
        p.material.defaultAttributeValues.aBase = [0, 0, 0];
        p.renderOrder = 5; p.userData.n = n;
        if (this._lowPower) geo.setDrawRange(0, Math.ceil(n * 0.35));
        fx.points.push(p);
        return p;
      };
      fx.rain = points(2400, { uBox: [380, 130, 380] });                     // rain, hail and snow
      fx.embers = points(220, { uBox: [30, 36, 30], uGrow: 1, uSway: 1.4, uSize: 0.7, uSoft: 0.3 }, THREE.AdditiveBlending);   // and coin sparkles
      fx.smoke = points(90, { uBox: [26, 64, 26], uGrow: 1, uSway: 1.5, uSize: 16, uSoft: 0.5, uColor: [0.3, 0.28, 0.27], uDrift: [-30, 0, 12] });
      // chimney smoke: a few puffs to a cottage, each rising from that cottage's own chimney
      fx.chimneys = points(MAX_HOUSES * 4, { uBox: [1.5, 7, 1.5], uGrow: 1, uSway: 0.3, uSize: 2.1, uSoft: 0.5, uAlpha: 0.55, uColor: [1, 0.98, 0.95], uDrift: [2.2, 0, 0.9] });
      fx.points.pop();                                     // its draw range is the houses there are, not lowPower's to set
      fx.chimneys.geometry.setAttribute("aBase", new THREE.BufferAttribute(new Float32Array(MAX_HOUSES * 12), 3));
      fx.chimneys.geometry.setDrawRange(0, 0);
      fx.confetti = points(260, { uBox: [22, 24, 22], uSway: 1.6, uSize: 0.6, uSoft: 0.06, uRainbow: 1 });

      // the fire: the trees nearest the logging camp burn
      const forest = this.areaById.get("forest"), market = this.areaById.get("market");
      const burn = this.treeXZ.map(p => [p, Math.hypot(p[0] - forest.x, p[1] - forest.z)]).filter(e => e[1] > 7 && e[1] < 46)
        .sort((a, b) => a[1] - b[1]).slice(0, 14).map(e => e[0]);
      if (!burn.length) burn.push([forest.x, forest.z, forest.ground]);
      const mean = k => burn.reduce((sum, p) => sum + p[k], 0) / burn.length;
      fx.burn = burn;
      fx.firePos = new THREE.Vector3(mean(0), mean(2), mean(1));
      fx.marketPos = new THREE.Vector3(market.x, market.ground, market.z);
      const flameGeo = new THREE.ConeGeometry(2.5, 10, 6);          // a flame wraps the whole tree, which shows through it
      flameGeo.translate(0, 5, 0);
      fx.flames = hide(new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, fog: false }), burn.length));
      burn.forEach((_, i) => fx.flames.setColorAt(i, col(i % 3 ? 0xff6a14 : 0xffb928)));
      // in the scene from the start, at zero: a light that arrives later recompiles every material
      fx.fireLight = new THREE.PointLight(0xff6a1a, 0, 170, 1.2);
      fx.fireLight.position.copy(fx.firePos).y += 11;
      scene.add(fx.fireLight);

      // crows: two wings, a tail and a body, flapped by scaling; each makes off with an apple
      const wing = new THREE.BufferGeometry();
      // a wing in two panels, up to the wrist and down again to the tip, so it is never a line edge-on
      const half = s => [0, 0, -0.5, 0, 0, 0.6, s * 0.9, 0.5, 0.5, 0, 0, -0.5, s * 0.9, 0.5, 0.5, s * 0.9, 0.5, -0.4,
        s * 0.9, 0.5, -0.4, s * 0.9, 0.5, 0.5, s * 1.9, 0.12, 0.1];
      wing.setAttribute("position", new THREE.Float32BufferAttribute([...half(-1), ...half(1), -0.35, 0, -1.1, 0.35, 0, -1.1, 0, 0, -0.3], 3));
      wing.computeVertexNormals();
      const crowBody = new THREE.ConeGeometry(0.26, 1.5, 5).toNonIndexed();
      crowBody.rotateX(Math.PI / 2); crowBody.deleteAttribute("uv");
      fx.crows = hide(new THREE.InstancedMesh(mergeGeometries([wing, crowBody]), new THREE.MeshBasicMaterial({ color: 0x14141b, side: THREE.DoubleSide }), 20));
      // …and in fair weather a few white birds ride the air over the crag
      fx.birds = hide(new THREE.InstancedMesh(fx.crows.geometry, new THREE.MeshBasicMaterial({ color: 0xfffaf0, side: THREE.DoubleSide }), 6));
      fx.fair = 1;
      const appleGeo = new THREE.IcosahedronGeometry(0.42, 1), appleMat = this.laden.material;
      fx.loot = hide(new THREE.InstancedMesh(appleGeo, appleMat, 20));
      // the bumper crop: apples dropping out of the orchard's trees and bouncing away down the rows
      fx.apples = hide(new THREE.InstancedMesh(appleGeo, appleMat, 44));

      // a ring on the ground under every player, in the colour of their name tag
      const ringGeo = new THREE.RingGeometry(0.66, 0.93, 32);
      ringGeo.rotateX(-Math.PI / 2);
      fx.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), MAX_RINGS);
      fx.rings.count = 0; fx.rings.frustumCulled = false; fx.rings.renderOrder = 2;
      scene.add(fx.rings);

      // the winner's crown
      const spikes = Array.from({ length: 6 }, (_, i) => new THREE.ConeGeometry(0.1, 0.36, 6).translate(Math.cos(i * 1.0472) * 0.33, 0.27, Math.sin(i * 1.0472) * 0.33));
      fx.crown = hide(new THREE.Mesh(mergeGeometries([new THREE.CylinderGeometry(0.36, 0.3, 0.22, 12, 1, true), ...spikes]),
        new THREE.MeshStandardMaterial({ color: 0xffcf3a, emissive: 0xb07400, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide })));

      // houses: plots on gentle ground just inland of the road, filled outward from the
      // building site as villagers finish them
      const site = this.areaById.get("site"), plots = [];
      for (let i = 0; i < 40000 && plots.length < 160; i++) {
        const x = (hash2(i * 1.31, 5.7) - 0.5) * 220, z = (hash2(i * 2.71, 8.3) - 0.5) * 220;
        if (Math.hypot(x, z) < ROAD_R_IN - 16) continue;
        const dr = distToRoad(x, z);
        if (dr < ROAD_HALF_W + 3.4 || dr > 19) continue;
        const y = height(x, z);
        if (y < 2.6 || y > 15 || Math.abs(y - height(x + 1.6, z)) + Math.abs(y - height(x, z + 1.6)) > 2) continue;
        if (PADS.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 4.5) || ORCHARD.near(x, z, 22)) continue;
        if (plots.some(p => Math.hypot(p.x - x, p.z - z) < 5.4) || this.treeXZ.some(p => Math.hypot(p[0] - x, p[1] - z) < 3)) continue;
        plots.push({ x, z, y, d: Math.hypot(x - site.x, z - site.z), rot: Math.atan2(x, z) + (hash2(i, 77) - 0.5) * 0.7 });
      }
      fx.plots = plots.sort((a, b) => a.d - b.d).slice(0, MAX_HOUSES);
      // a cottage: a round wall with a door and a window in it, under a conical roof in its owner's colour
      const shade = (g, v) => g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(v), 3));
      const wallGeo = shade(new THREE.CylinderGeometry(1.5, 1.62, 3.5, 10).translate(0, 0.35, 0), 1);     // 1.4 of it below the plot, to take up the slope
      const holes = [new THREE.BoxGeometry(0.8, 1.4, 0.3).translate(0, 0.7, 1.5), new THREE.BoxGeometry(0.3, 0.6, 0.6).translate(1.42, 1.25, 0.2)].map(g => shade(g, 0.3));
      holes.push(shade(new THREE.BoxGeometry(0.5, 1.5, 0.5).translate(0.95, 3.35, -0.4), 0.78));           // the chimney
      const roofGeo = new THREE.ConeGeometry(2.2, 2.3, 10).translate(0, 3.2, 0);
      fx.walls = new THREE.InstancedMesh(mergeGeometries([wallGeo, ...holes]), new THREE.MeshStandardMaterial({ color: 0xf6eddb, vertexColors: true, roughness: 1, flatShading: true }), MAX_HOUSES);
      fx.roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), MAX_HOUSES);
      for (const m of [fx.walls, fx.roofs]) { m.count = 0; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }
    }

    /** /state again, for the party's side of things: who is a player, who won, what the event is, who owns a house. */
    syncStage(s) {
      const fx = this.fx, party = s?.party || null, now = performance.now();
      if (!fx) return;
      this.winner = party?.status === "ended" ? party.results?.winner?.id ?? null : null;
      fx.target = party && party.status !== "ended" ? party.event?.id || null : null;

      // name tags and rings: every player, plus the winner whoever they are
      let seat = 0, ring = 0;
      const seen = new Set();
      for (const b of this.blobs.values()) {
        const win = b.id === this.winner;
        b.color = b.human ? PLAYER[seat++ % PLAYER.length] : null;
        b.ring = (b.human || win) && ring < MAX_RINGS ? ring++ : -1;
        if (b.ring >= 0) fx.rings.setColorAt(b.ring, fx.tmp.set(win ? GOLD : b.color));
        if (!b.human && !win) continue;
        seen.add(b.id);
        let t = this.tags.get(b.id);
        if (!t) {
          t = { id: b.id, el: document.createElement("div"), box: {} };
          t.el.className = "i3d-who";
          this.overlay.appendChild(t.el);
          this.tags.set(b.id, t);
        }
        const key = `${b.name}|${b.color}|${win}`;
        if (key !== t.key) {
          t.key = key; t.win = win; t.bw = 0;
          t.el.textContent = b.name || "?";
          t.el.style.setProperty("--c", win ? GOLD : b.color);
          t.el.classList.toggle("win", win);
          t.el.style.zIndex = win ? 1600 : 1500;
        }
      }
      for (const [id, t] of this.tags) if (!seen.has(id)) { t.el.remove(); this.tags.delete(id); }
      fx.rings.count = ring;
      if (fx.rings.instanceColor) fx.rings.instanceColor.needsUpdate = true;

      // houses only ever go up within a game; a count that fell means a new game
      let reset = fx.code !== (party?.code ?? null);
      for (const b of this.blobs.values()) if ((fx.houseCount.get(b.id) || 0) > (b.houses || 0)) reset = true;
      if (reset) { fx.houses.length = 0; fx.houseCount.clear(); fx.code = party?.code ?? null; fx.houseAnim = true; }
      // players first, and when the plots run out a player's house takes over a villager's
      for (const human of [true, false]) for (const b of this.blobs.values()) {
        if (!!b.human !== human) continue;
        let c = fx.houseCount.get(b.id) || 0;
        for (; c < (b.houses || 0); c++) {
          const i = fx.houses.length < fx.plots.length ? fx.houses.length : human ? fx.houses.findIndex(x => !x.human) : -1;
          if (i < 0) break;
          fx.roofs.setColorAt(i, fx.tmp.set(b.color || ["#e2806a", "#d9907a", "#e6a56c", "#c98a8f", "#d77a5c"][(b.id + c) % 5]));
          fx.houses[i] = { born: now, human };
          fx.houseAnim = true;
        }
        fx.houseCount.set(b.id, c);
      }
      if (fx.houseAnim && fx.roofs.instanceColor) fx.roofs.instanceColor.needsUpdate = true;
    }

    /** A villager said something. Players are heard at once; the village waits for a free bubble. */
    hear(b, text) {
      text = clip(text);
      if (!text) return;
      if (b.human) { this.speak(b, text); return; }
      const q = this.sayQueue, line = { id: b.id, text, at: performance.now() }, i = q.findIndex(x => x.id === b.id);
      if (i >= 0) q[i] = line; else q.push(line);
      if (q.length > 40) q.shift();
    }
    speak(b, text) {
      let s = this.says.find(x => x.id === b.id);
      if (!s) {
        if (this.says.length >= MAX_SAY) {
          if (!b.human) return false;
          // a player always gets a word in: the oldest villager's bubble makes room, or failing that the oldest player's
          const old = this.says.find(x => !x.human) || this.says[0];
          old.el.remove();
          this.says.splice(this.says.indexOf(old), 1);
        }
        s = { id: b.id, el: document.createElement("div"), human: !!b.human, box: {} };
        s.el.className = b.human ? "i3d-say" : "i3d-say ai";
        s.el.style.zIndex = b.human ? 2600 : 2500;
        this.overlay.appendChild(s.el);
        this.says.push(s);
      }
      s.el.textContent = "";
      if (!b.human && b.name) s.el.appendChild(document.createElement("b")).textContent = b.name;
      s.el.appendChild(document.createTextNode(text));
      s.el.style.setProperty("--c", b.human ? b.color : "#fffdf5");
      s.until = performance.now() + SAY_MS; s.bw = 0; s.lift = undefined;
      return true;
    }
    // behind the mountain, along the view ray
    hidden(x, y, z) {
      const cam = this.camera.position;
      for (let t = 0.12; t < 0.94; t += 0.06) if (heightAt(cam.x + (x - cam.x) * t, cam.z + (z - cam.z) * t) > cam.y + (y - cam.y) * t + 1.2) return true;
      return false;
    }
    inView(b) {
      const v = this._pinVector, y = (b.y ?? heightAt(b.x, b.z)) + 3;
      v.set(b.x, y, b.z).project(this.camera);
      return v.z < 1 && Math.abs(v.x) < 0.9 && v.y < 0.75 && v.y > -0.95 && !this.hidden(b.x, y, b.z);
    }

    // Name tags and speech bubbles ride over their blobs, placed like the pins: a transform a
    // frame, no layout. Tags are laid out first, nearest the camera first, and anything that
    // would land on a label already placed is lifted clear of it, so a crowd at the market
    // stacks its names instead of piling them up.
    labels(dt, now) {
      if (!this.tags.size && !this.says.length && !this.sayQueue.length) return;
      const w = this.clientWidth, h = this.clientHeight, v = this._pinVector || (this._pinVector = new this.THREE.Vector3());
      const slow = this._frame % 3 === 0, ease = Math.min(1, dt * 10), tail = Math.min(11, Math.max(6, h * 0.01));
      // a villager's line gets a bubble when one is free, one at a time and picked at random, so
      // a village that answers all at once is heard a few voices at a time, not as a wall
      const q = this.sayQueue;
      while (q.length && now - q[0].at > 6000) q.shift();
      if (q.length && now >= (this._sayAt || 0) && this.says.length < MAX_SAY) {
        const line = q.splice(Math.floor(Math.random() * q.length), 1)[0], b = this.blobs.get(line.id);
        if (b && this.inView(b) && this.speak(b, line.text)) this._sayAt = now + 420;
      }
      for (let i = this.says.length - 1; i >= 0; i--) {
        const s = this.says[i];
        if (!this.blobs.has(s.id) || now > s.until + 400) { s.el.remove(); this.says.splice(i, 1); }
      }
      const items = this._items || (this._items = []), boxes = this._boxes || (this._boxes = []);
      items.length = boxes.length = 0;
      for (const t of this.tags.values()) items.push(t);
      for (const l of items.concat(this.says)) {
        const b = this.blobs.get(l.id), say = l.until !== undefined;
        if (!b) { l.on = false; continue; }
        if (!l.bw) { l.bw = l.el.offsetWidth; l.bh = l.el.offsetHeight; }
        const head = (b.y ?? heightAt(b.x, b.z)) + (b.h || 3), y = head + 0.9 + (l.win ? 1.2 + 0.7 * (this.zoom || BLOB) : 0);
        // the winner's label keeps the room under it, down to their head, for the hop and the crown
        l.foot = l.win ? (-v.set(b.x, head, b.z).project(this.camera).y * 0.5 + 0.5) * h : 0;
        v.set(b.x, y, b.z).project(this.camera);
        l.sx = (v.x * 0.5 + 0.5) * w; l.sy = (-v.y * 0.5 + 0.5) * h;
        l.on = v.z < 1 && (say ? l.human || (l.sx > 0 && l.sx < w && l.sy > 0 && l.sy < h + 40) : l.sx > -30 && l.sx < w + 30 && l.sy > -10 && l.sy < h + 40);
        if (!say && slow) l.dim = this.hidden(b.x, y, b.z);
      }
      items.sort((a, b) => (b.win ? 1e6 : b.sy) - (a.win ? 1e6 : a.sy));    // the winner first, then nearest the camera
      const free = (x0, x1, y0, y1) => { for (const B of boxes) if (x0 < B.x1 && x1 > B.x0 && y0 < B.y1 && y1 > B.y0) return false; return true; };
      for (const l of items.concat(this.says)) {
        const say = l.until !== undefined, el = l.el, bw = l.bw + 4, bh = l.bh + tail;
        let ox = 0, lift = 0;
        if (l.on) {
          if (say) {
            // a bubble sits on its speaker's name tag, wherever that went, and rises clear of anything in the way
            const mine = this.tags.get(l.id), tag = mine?.on ? mine.box : null;
            let cx = Math.min(w - bw / 2 - 4, Math.max(bw / 2 + 4, tag ? (tag.x0 + tag.x1) / 2 : l.sx)), y1 = Math.min(h - 4, tag ? tag.y0 - 1 : l.sy);
            for (let pass = 0; pass < 8; pass++) {
              let hit = false;
              for (const B of boxes) if (cx - bw / 2 < B.x1 && cx + bw / 2 > B.x0 && y1 - bh < B.y1 && y1 > B.y0) { y1 = B.y0 - 2; hit = true; }
              if (!hit) break;
            }
            if (y1 < bh + 4) {                            // up against the top edge: step aside instead of piling up
              y1 = bh + 4;
              for (let pass = 0; pass < 4; pass++) {
                let hit = false;
                for (const B of boxes) if (cx - bw / 2 < B.x1 && cx + bw / 2 > B.x0 && y1 - bh < B.y1 && y1 > B.y0) { cx = B.x0 + B.x1 < w ? B.x1 + bw / 2 + 4 : B.x0 - bw / 2 - 4; hit = true; }
                if (!hit) break;
              }
            }
            ox = cx - l.sx; lift = l.sy - y1;
          } else {
            // a name goes over its own blob; in a crowd, beside a name already there, and only then above it
            search: for (let k = 0; k < 9; k++) for (let j = 0; j < 3; j++) {
              const cx = l.sx + (j === 2 ? -1 : j) * (bw + 2), y1 = l.sy - k * (bh + 2);
              if ((!k || y1 - bh > 2) && free(cx - bw / 2, cx + bw / 2, y1 - bh, y1)) { ox = cx - l.sx; lift = k * (bh + 2); break search; }
            }
          }
          const B = l.box, cx = l.sx + ox;
          B.x0 = cx - bw / 2; B.x1 = cx + bw / 2; B.y1 = Math.max(l.foot || 0, l.sy - lift); B.y0 = l.sy - lift - bh;
          boxes.push(B);
        }
        if (l.lift === undefined || !l.on) { l.lift = lift; l.ox = ox; }
        else { l.lift += (lift - l.lift) * ease; l.ox += (ox - l.ox) * ease; }
        const tx = Math.round(l.sx + l.ox), ty = Math.round(l.sy - l.lift - tail);
        if (l.on && (tx !== l.tx || ty !== l.ty)) { l.tx = tx; l.ty = ty; el.style.transform = `translate3d(${tx}px,${ty}px,0) translate(-50%,-100%)`; }
        const op = !l.on || (say && now > l.until) ? 0 : l.dim ? 0.55 : 1;
        if (op !== l.op) { l.op = op; el.style.opacity = op; }
      }
    }

    // The weather of the current event, and the end of the game. Every event has a weight
    // that eases to 1 while it is on and back to 0 after; the lights, the sky, the sea, the
    // wash over the picture and the particles are all read off those weights each frame.
    stage(dt, now) {
      const fx = this.fx, THREE = this.THREE;
      if (!fx) return;
      const t = now * 0.001, w = fx.w, mix = fx.mix, k = Math.min(1, dt * 0.9), M = fx.M, U = this.waterUniforms;
      for (const id in w) {
        const to = id === fx.target ? 1 : 0;
        w[id] += (to - w[id]) * k;
        if (!to && w[id] < 0.004) w[id] = 0;
      }
      mix.storm = w.storm; mix.cold = w.cold; mix.fire = w.fire; mix.blight = w.blight; mix.gold = Math.max(w.shoal, w.boom);
      fx.time.value = t;
      fx.px.value = this.renderer.domElement.height / (2 * Math.tan(this.camera.fov * Math.PI / 360));

      // light, sky, sea and ground: dusk first (the market filling), then each look by its weight
      const d = this.dusk || 0, sun = this.sun.color.setRGB(1, 0.9 - 0.3 * d, 0.74 - 0.44 * d), trees = this.treeMat.color.setRGB(1, 1, 1);
      let sunI = 1.5 - 0.4 * d, hemiI = 1.3 - 0.5 * d, fog = FOG, tr = 0, tg = 0, tb = 0, ta = 0, lr = 0, lg = 0, lb = 0, la = 0;
      fx.clear.copy(fx.clear0); this.scene.fog.color.copy(fx.fog0); this.hemi.color.copy(fx.hemi0);
      for (let i = 0; i < 3; i++) fx.sea[i].copy(fx.sea0[i]);
      for (const id in LOOKS) {
        const m = mix[id], L = LOOKS[id];
        if (!m) continue;
        sun.lerp(L.sunC, m); this.hemi.color.lerp(L.sunC, m * 0.6);
        sunI *= 1 + (L.sunK - 1) * m; hemiI *= 1 + (L.hemiK - 1) * m; fog += (L.fog - FOG) * m;
        fx.clear.lerp(L.skyC, m); this.scene.fog.color.lerp(L.skyC, m);
        const a = L.tint[3] * m;
        tr += L.tint[0] * a; tg += L.tint[1] * a; tb += L.tint[2] * a; ta += a;
        if (L.sea) for (let i = 0; i < 3; i++) fx.sea[i].lerp(L.seaC[i], m);
        if (L.land) { const g = L.land[3] * m; lr += L.land[0] * g; lg += L.land[1] * g; lb += L.land[2] * g; la += g; }
        if (L.trees) trees.lerp(L.treesC, m);
      }
      // lightning: now and then, while the storm is on
      if (w.storm > 0.6 && now > fx.boltAt) { fx.bolt = 1; fx.boltAt = now + 3000 + Math.random() * 6000; }
      fx.bolt = fx.bolt < 0.02 ? 0 : fx.bolt * Math.exp(-dt * 6);
      this.sun.intensity = sunI; this.hemi.intensity = hemiI + fx.bolt * 2.4; this.scene.fog.density = fog;
      this.renderer.setClearColor(fx.clear, 1);
      U.uHorizon.value.copy(fx.clear).convertLinearToSRGB();
      U.uRough.value = w.storm;
      this.landTint.value.set(la ? lr / la : 1, la ? lg / la : 1, la ? lb / la : 1, Math.min(1, la));
      ta = Math.round(ta * (1 - 0.75 * fx.bolt) * 250) / 250;
      const key = ta ? `rgb(${Math.round(tr / ta)},${Math.round(tg / ta)},${Math.round(tb / ta)})|${ta}` : "";
      if (key !== fx.tintKey) {
        fx.tintKey = key;
        this.tint.style.opacity = ta;
        if (ta) this.tint.style.background = key.split("|")[0];
      }

      // rain, hail and snow are one system: the storm is rain with hailstones through it, and
      // the snow's share of it slows the fall, rounds the drop and whitens it
      const wet = Math.max(w.storm, w.cold);
      if ((fx.rain.visible = wet > 0.01)) {
        const u = fx.rain.material.uniforms, snow = w.cold / (w.storm + w.cold);
        u.uOff.value.x += (-34 + 30 * snow) * dt; u.uOff.value.y += (-160 + 149 * snow) * dt; u.uOff.value.z += 3 * snow * dt;
        u.uStreak.value = 1 - snow; u.uHail.value = 0.6 * (1 - snow); u.uSize.value = 6.4 - 4.6 * snow; u.uSway.value = 2.6 * snow; u.uSoft.value = 0.12 + 0.2 * snow;
        u.uAlpha.value = wet * (0.5 + 0.45 * snow);
        u.uColor.value.setRGB(0.76 + 0.24 * snow, 0.85 + 0.15 * snow, 0.96 + 0.04 * snow);
      } else fx.rain.material.uniforms.uOff.value.set(0, 0, 0);

      // embers over the burning trees; the same sparks, in gold, over the market when money moves
      const coins = Math.max(w.boom * 0.8, w.tax), hot = Math.max(w.fire, coins);
      if ((fx.embers.visible = hot > 0.01)) {
        const u = fx.embers.material.uniforms, fire = w.fire >= coins;
        u.uOrigin.value.copy(fire ? fx.firePos : fx.marketPos);
        u.uColor.value.setRGB(1, fire ? 0.5 : 0.82, fire ? 0.12 : 0.25);
        u.uAlpha.value = hot; u.uOff.value.y += (fire ? 10 : 6) * dt;
      }
      if ((fx.smoke.visible = fx.flames.visible = w.fire > 0.01)) {
        const u = fx.smoke.material.uniforms;
        u.uOrigin.value.copy(fx.firePos); u.uAlpha.value = 0.75 * w.fire; u.uOff.value.y += 7 * dt;
        fx.burn.forEach((p, i) => {
          const f = 0.75 + 0.35 * Math.abs(Math.sin(t * (7 + i % 4) + i * 2.1)), s = w.fire * (0.8 + (i % 3) * 0.2);
          M.p.set(p[0], p[2] - 0.4, p[1]); M.s.set(s, s * f, s);
          fx.flames.setMatrixAt(i, M.m.compose(M.p, M.q.identity(), M.s));
        });
        fx.flames.instanceMatrix.needsUpdate = true;
      }
      fx.fireLight.intensity = w.fire * 520 * (0.8 + 0.2 * Math.sin(t * 11) * Math.sin(t * 7.3));

      // fair weather: the white birds circle the crag, and the cloud shadows drift over the
      // meadow. Any weather at all sends the birds out to sea and takes the sun off the ground.
      const foul = Math.max(w.storm, w.cold, w.fire, w.gulls, w.blight);
      fx.fair += ((foul > 0.05 ? 0 : 1) - fx.fair) * Math.min(1, dt * 0.5);
      this.landTime.value = t; this.landShade.value = 0.15 * (1 - foul);
      if ((fx.birds.visible = fx.fair > 0.01)) {
        const big = (this.zoom || BLOB) / BLOB;
        for (let i = 0; i < fx.birds.count; i++) {
          const a = t * (0.22 + rand(i, 12) * 0.08) + rand(i, 11) * 1.6 + (i > 2 ? 3.4 : 0), r = 26 + rand(i, 13) * 16 + (1 - fx.fair) * 300;
          const beat = Math.sin(t * 0.5 + i * 2.1) > 0.3 ? 0.55 : 0.2 + 0.6 * Math.sin(t * 7 + i * 1.7);        // glide, then a few beats
          M.p.set(-12 + Math.cos(a) * r * 1.5, 50 + rand(i, 14) * 9 + Math.sin(t * 0.6 + i) * 2, -12 + Math.sin(a) * r);
          M.e.set(0, Math.atan2(-1.5 * Math.sin(a), Math.cos(a)), 0.3); M.s.set(big, big * beat, big);
          fx.birds.setMatrixAt(i, M.m.compose(M.p, M.q.setFromEuler(M.e), M.s));
        }
        fx.birds.instanceMatrix.needsUpdate = true;
      }

      // crows wheel in from the sea, circle the orchard, and one after another stoop on it
      if ((fx.crows.visible = fx.loot.visible = w.gulls > 0.01)) {
        const O = ORCHARD, big = (this.zoom || BLOB) / BLOB * 1.5;      // like the villagers, they grow with the distance
        for (let i = 0; i < fx.crows.count; i++) {
          const stoop = Math.pow(Math.max(0, Math.sin(t * 0.8 + i * 1.9)), 5), hi = O.y + 13 + rand(i, 4) * 8;
          const a = t * (0.6 + rand(i, 2) * 0.35) + rand(i, 1) * 6.283, r = (8 + rand(i, 3) * 22) * (1 - 0.45 * stoop) + (1 - w.gulls) * 260;
          const x = O.x + Math.cos(a) * r, z = O.z + Math.sin(a) * r, flap = Math.sin(t * 10 + i * 1.7);
          M.p.set(x, Math.max(hi - stoop * (hi - O.y - 5.5), heightAt(x, z) + 6.5), z);
          M.e.set(0.45 * stoop, -a, 0.4); M.s.set(big, big * (0.35 + 0.9 * flap), big);
          fx.crows.setMatrixAt(i, M.m.compose(M.p, M.q.setFromEuler(M.e), M.s));
          M.p.y -= 0.4 * big; M.s.setScalar(w.gulls * big * 0.6);
          fx.loot.setMatrixAt(i, M.m.compose(M.p, M.q, M.s));
        }
        fx.crows.instanceMatrix.needsUpdate = fx.loot.instanceMatrix.needsUpdate = true;
      }

      // the bumper crop: every apple tree carries twice the fruit, and it rains out of them:
      // each apple drops from a crown, bounces three times down the slope and is gone
      this.laden.visible = w.shoal > 0.3;
      const T = ORCHARD.trees;
      if ((fx.apples.visible = w.shoal > 0.01 && T.length > 0)) {
        for (let i = 0; i < fx.apples.count; i++) {
          const period = 1.7 + rand(i, 5) * 1.3, c = t / period + rand(i, 6), n = Math.floor(c), u = c - n, tree = T[(i + n * 7) % T.length];
          const dir = hash2(i * 7.7, n * 0.9) * 6.283, reach = 1.2 + u * (2.5 + 5 * hash2(i * 3.1, n * 1.7));
          const x = tree[0] + Math.sin(dir) * reach, z = tree[1] + Math.cos(dir) * reach, v = (u - 0.2) / 0.8;
          const y = u < 0.2 ? 3.4 * (1 - u * u * 25) : Math.abs(Math.sin(v * Math.PI * 3)) * (1 - v) * 2.6;
          M.p.set(x, heightAt(x, z) + 0.45 + y, z);
          M.e.set(t * 5 + i, 0, t * 3); M.s.setScalar(w.shoal * Math.min(1, (1 - u) * 8));
          fx.apples.setMatrixAt(i, M.m.compose(M.p, M.q.setFromEuler(M.e), M.s));
        }
        fx.apples.instanceMatrix.needsUpdate = true;
      }

      // the winner: a crown turning over their head, confetti coming down round them
      const champ = this.winner != null ? this.blobs.get(this.winner) : null;
      if ((fx.crown.visible = fx.confetti.visible = !!champ && champ.y !== undefined)) {
        const z = this.zoom || BLOB, u = fx.confetti.material.uniforms;
        fx.crown.position.set(champ.x, champ.top + 0.1 * z, champ.z);
        fx.crown.rotation.y = t * 1.6;
        fx.crown.scale.setScalar(z * 1.05);
        u.uOrigin.value.set(champ.x, champ.y - 1, champ.z); u.uOff.value.y -= 9 * dt;
      }

      // a new house grows out of its plot
      if ((fx.chimneys.visible = fx.houses.length > 0 && !this._lowPower)) fx.chimneys.material.uniforms.uOff.value.y += 1.5 * dt;
      if (fx.houseAnim) {
        let live = false;
        const base = fx.chimneys.geometry.attributes.aBase;
        fx.houses.forEach((hs, i) => {
          const p = fx.plots[i], g = Math.min(1, (now - hs.born) / 700), s = 1 - Math.pow(1 - g, 3) + 0.25 * Math.sin(g * Math.PI);
          if (g < 1) live = true;
          M.p.set(p.x, p.y, p.z); M.e.set(0, p.rot, 0); M.s.set(s, s, s);
          M.m.compose(M.p, M.q.setFromEuler(M.e), M.s);
          fx.walls.setMatrixAt(i, M.m); fx.roofs.setMatrixAt(i, M.m);
          const c = Math.cos(p.rot), sn = Math.sin(p.rot);
          for (let k = 0; k < 4; k++) base.setXYZ(i * 4 + k, p.x + 0.95 * c - 0.4 * sn, p.y + 4, p.z - 0.95 * sn - 0.4 * c);
        });
        base.needsUpdate = true;
        fx.chimneys.geometry.setDrawRange(0, fx.houses.length * 4);
        fx.walls.count = fx.roofs.count = fx.houses.length;
        fx.walls.instanceMatrix.needsUpdate = fx.roofs.instanceMatrix.needsUpdate = true;
        fx.houseAnim = live;
      }
    }

    // ---- the lens ------------------------------------------------------------------------
    // The island is photographed as a tabletop model: the scene is drawn once into a
    // multisampled target with its depth, and one pass over that picture puts it out of
    // focus by depth (and a little toward the top and bottom of the frame, the way a tilted
    // lens does), adds the glow of whatever is brightest, and darkens the corners. The
    // HTML labels are untouched: the camera is the same camera.
    // fx="off" on the element or ?fx=0 on the page turns all of it off (and lowPower always
    // does); fx="lite" / ?fx=lite keeps the focus at half the samples and drops the glow.
    static get observedAttributes() { return ["fx"]; }
    attributeChangedCallback() { this._fxMode = null; }
    get fxMode() {
      if (this._lowPower || this._fxBroken) return "off";
      if (!this._fxMode) {
        const v = (this.getAttribute("fx") ?? FX_QUERY ?? "on").toLowerCase();
        this._fxMode = /^(off|0|false|no)$/.test(v) ? "off" : v === "lite" ? "lite" : "on";
      }
      return this._fxMode;
    }
    dropLens() {
      const L = this._lens;
      if (!L) return;
      for (const t of [L.scene, L.glowA, L.glowB]) t.dispose();
      L.scene.depthTexture.dispose();
      for (const m of [L.bright, L.blur, L.out]) m.dispose();
      L.quad.geometry.dispose();
      this._lens = null;
    }
    lens(w, h) {
      const THREE = this.THREE;
      let L = this._lens;
      if (!L) {
        const type = THREE.HalfFloatType, small = { type, depthBuffer: false };
        const pass = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader: LENS_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
        L = this._lens = {
          w: 0, h: 0,
          scene: new THREE.WebGLRenderTarget(1, 1, { type, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) }),
          glowA: new THREE.WebGLRenderTarget(1, 1, small), glowB: new THREE.WebGLRenderTarget(1, 1, small),
          cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), stage: new THREE.Scene(),
        };
        L.bright = pass(LENS_BRIGHT, { tColor: { value: L.scene.texture }, uTexel: { value: new THREE.Vector2() } });
        L.blur = pass(LENS_BLUR, { tColor: { value: null }, uStep: { value: new THREE.Vector2() } });
        L.out = pass(LENS_OUT, { tColor: { value: L.scene.texture }, tDepth: { value: L.scene.depthTexture }, tGlow: { value: L.glowA.texture },
          uTexel: { value: new THREE.Vector2() }, uClip: { value: new THREE.Vector2() }, uFocus: { value: 200 }, uMaxR: { value: 8 },
          uGlow: { value: 0 }, uTaps: { value: 20 } });
        L.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), L.out);
        L.quad.frustumCulled = false;
        L.stage.add(L.quad);
      }
      if (L.w !== w || L.h !== h) {
        L.w = w; L.h = h;
        L.scene.setSize(w, h);
        const gw = Math.max(1, w >> 2), gh = Math.max(1, h >> 2);
        L.glowA.setSize(gw, gh); L.glowB.setSize(gw, gh);
        L.bright.uniforms.uTexel.value.set(1 / w, 1 / h);
        L.out.uniforms.uTexel.value.set(1 / w, 1 / h);
        L.gw = gw; L.gh = gh;
      }
      return L;
    }
    render() {
      const r = this.renderer, mode = this.fxMode;
      if (mode === "off" || !r.capabilities.isWebGL2 || !r.extensions.has("EXT_color_buffer_float")) {
        if (this._lens) this.dropLens();
        r.render(this.scene, this.camera);
        return;
      }
      const L = this.lens(r.domElement.width, r.domElement.height), draw = (mat, target) => {
        L.quad.material = mat;
        r.setRenderTarget(target);
        r.render(L.stage, L.cam);
      };
      r.setRenderTarget(L.scene);
      r.render(this.scene, this.camera);
      const glow = mode === "on";
      if (glow) {
        // the glow: what is brightest, at a quarter of the size, blurred twice each way
        draw(L.bright, L.glowA);
        for (let i = 0; i < 2; i++) {
          L.blur.uniforms.tColor.value = L.glowA.texture; L.blur.uniforms.uStep.value.set((1.2 + i * 1.6) / L.gw, 0);
          draw(L.blur, L.glowB);
          L.blur.uniforms.tColor.value = L.glowB.texture; L.blur.uniforms.uStep.value.set(0, (1.2 + i * 1.6) / L.gh);
          draw(L.blur, L.glowA);
        }
      }
      const u = L.out.uniforms;
      u.uClip.value.set(this.camera.near, this.camera.far);
      u.uFocus.value = this.focus || 200;
      u.uMaxR.value = L.h * 0.0085;
      u.uGlow.value = glow ? 0.55 : 0;
      u.uTaps.value = glow ? 20 : 10;
      draw(L.out, null);
    }

    bindInput() {
      const el = this.renderer.domElement;
      let dragging = false, px = 0, py = 0;
      el.addEventListener("pointerdown", (e) => { dragging = true; px = e.clientX; py = e.clientY; el.setPointerCapture(e.pointerId); });
      el.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const o = this.orbit;
        o.ttheta += (e.clientX - px) * 0.006;
        o.tphi = Math.min(1.42, Math.max(0.16, o.tphi + (e.clientY - py) * 0.005));
        px = e.clientX; py = e.clientY;
      });
      const stop = () => { dragging = false; };
      el.addEventListener("pointerup", stop);
      el.addEventListener("pointercancel", stop);
      el.addEventListener("wheel", (e) => {
        e.preventDefault();
        const o = this.orbit;
        o.tr = Math.min(400, Math.max(48, o.tr * (1 + Math.sign(e.deltaY) * 0.09)));
      }, { passive: false });
    }

    resize() {
      if (!this.renderer || !this.camera) return;
      const w = this.clientWidth || 1, h = this.clientHeight || 1;
      const want = this.pixelRatio();
      if (Math.abs(this.renderer.getPixelRatio() - want) > 0.01) this.renderer.setPixelRatio(want);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      // …and the island sits a little left of centre and a little high, clear of the leaderboard
      // and the ticker. (The inset has no panels over it, so it stays centred.)
      if (this._lowPower) this.camera.clearViewOffset(); else this.camera.setViewOffset(w, h, w * 0.08, h * 0.035, w, h);
      this.camera.updateProjectionMatrix();
    }

    // One instance per blob, rebuilt when the village changes size; the matrices, colours
    // and faces are written every frame in walk(). The face mesh reads the body's matrices.
    syncBlobs() {
      if (!this.blobGeo) return;
      const THREE = this.THREE, n = this.blobs.size;
      for (const m of this.blobMeshes || []) { this.scene.remove(m); m.dispose(); }
      this.face?.geometry.dispose();
      this.blobMeshes = [];
      this.body = this.face = null;
      if (!n) return;
      const add = (geo, mat, count) => {
        const m = new THREE.InstancedMesh(geo, mat, count);
        m.frustumCulled = false;
        this.scene.add(m); this.blobMeshes.push(m);
        return m;
      };
      this.body = add(this.blobGeo, this.blobMat, n);
      this.body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.body.castShadow = true;
      this.face = add(this.faceGeo.clone(), this.faceMat, n);
      this.face.instanceMatrix = this.body.instanceMatrix;
      this.face.geometry.setAttribute("aFace", new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2));
      const counts = this.extras.map(() => 0);
      for (const b of this.blobs.values()) if (b.extra >= 0) b.extraAt = counts[b.extra]++;
      this.extraMeshes = this.extras.map((e, k) => counts[k] ? add(e.geo, e.mat, counts[k]) : null);
    }

    // Walk every blob toward where it should be. Where that is, is that blob's own
    // business: their own market window, then their own job the moment their own decision
    // lands. Nothing here is shared between villagers any more except the clock.
    walk(dt, now) {
      if (!this.body || this.body.count !== this.blobs.size) return;
      const THREE = this.THREE;
      const mats = this.body.instanceMatrix.array, col = this.body.instanceColor.array;
      const faces = this.face.geometry.attributes.aFace;
      const M = this._bm || (this._bm = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, "YXZ"), p: new THREE.Vector3(), s: new THREE.Vector3() });
      const cam = this.camera.position;
      // zoomed right out a villager is a few pixels: let them grow with the distance, so the
      // village stays readable from the far orbit and is life-size once you come down to it
      const zoom = this.zoom = BLOB * Math.min(1.8, Math.max(1, this.orbit.r / 150));
      const rings = this.fx.rings, ringSize = BLOB * Math.min(2.2, Math.max(1, this.orbit.r / 120));
      let faceDirty = false;
      // Nobody stands in anybody: overlapping pairs ease apart. A village
      // tops out at 137, so every pair every frame is nine thousand cheap tests.
      const all = this._all || (this._all = []);
      all.length = 0;
      for (const b of this.blobs.values()) all.push(b);
      const ease = Math.min(1, dt * 6) * 0.5;
      for (let p = 0; p < all.length; p++) for (let q = p + 1; q < all.length; q++) {
        const A = all[p], B = all[q], dx = B.x - A.x, dz = B.z - A.z;
        const min = (A.girth + B.girth) * BLOB * 0.56;
        if (Math.abs(dx) >= min || Math.abs(dz) >= min) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const ang = d > 1e-3 ? 0 : (A.id * 2.4 + B.id), ux = d > 1e-3 ? dx / d : Math.cos(ang), uz = d > 1e-3 ? dz / d : Math.sin(ang);
        // someone walking through steps round someone standing, not the other way about
        const wa = !A.path.length === !B.path.length ? 1 : A.path.length ? 2 : 0, push = (min - d) * ease;
        A.x -= ux * push * wa; A.z -= uz * push * wa; B.x += ux * push * (2 - wa); B.z += uz * push * (2 - wa);
      }
      const areas = this.areas;
      for (let k = 0; k < areas.length; k++) areas[k].count = 0;
      let i = 0, crowd = 0;
      for (const b of this.blobs.values()) {
        const held = now >= b.marketAt && now < b.marketUntil;
        if (held) crowd++;
        const dest = held ? MARKET : b.job;
        if (dest !== b.dest) {
          b.dest = dest;
          b.path = route(b.x, b.z, ...spot(b.id, dest), laneFor(b.id));
        }
        const ox = b.x, oz = b.z;
        let left = this.speed * dt;
        while (b.path.length && left > 0) {
          const [tx, tz] = b.path[0], d = Math.hypot(tx - b.x, tz - b.z);
          if (d <= left) { b.x = tx; b.z = tz; left -= d; b.path.shift(); }
          else { b.x += (tx - b.x) / d * left; b.z += (tz - b.z) / d * left; left = 0; }
        }
        const working = !b.path.length && dest !== MARKET;
        const win = b.id === this.winner;                // the winner cannot keep still
        const hop = working ? Math.abs(Math.sin(now * 0.006 + b.id)) : win ? Math.abs(Math.sin(now * 0.0075)) : 0;
        // They look where they are going; standing, they turn to whoever is watching,
        // each a little to one side of it, so a crowd is not a firing squad.
        const moved = Math.hypot(b.x - ox, b.z - oz) > 1e-4;
        const want = moved ? Math.atan2(b.x - ox, b.z - oz) : Math.atan2(cam.x - b.x, cam.z - b.z) + b.aside;
        if (b.yaw === undefined) b.yaw = want;
        b.yaw += Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw)) * Math.min(1, dt * 7);
        // a waddle on the road, a squash and stretch through the hop at work, breathing otherwise
        const step = moved ? Math.sin(now * 0.014 + b.phase) : 0;
        const tall = working || win ? 0.9 + 0.17 * hop : moved ? 1 : 1 + 0.025 * Math.sin(now * 0.003 + b.phase);
        const wide = working || win ? 1.06 - 0.09 * hop : 1;
        M.e.set(b.leanX, b.yaw, b.leanZ + step * 0.07);
        M.p.set(b.x, Math.max(0.8, heightAt(b.x, b.z)) - 0.06 + hop * 1.2 + Math.abs(step) * 0.22, b.z);
        const big = win ? zoom * 1.4 : zoom;             // …and stands a head taller
        M.s.set(big * b.girth * wide, big * b.tall * tall, big * b.girth * wide);
        M.m.compose(M.p, M.q.setFromEuler(M.e), M.s).toArray(mats, i * 16);
        if (b.extra >= 0) M.m.toArray(this.extraMeshes[b.extra].instanceMatrix.array, b.extraAt * 16);
        // where their head is: at rest for the name tag (a label that hops cannot be read), as it is for the crown
        b.y = M.p.y - hop * 1.2 - Math.abs(step) * 0.22; b.h = big * b.tall * 1.2; b.top = M.p.y + M.s.y * 1.2;
        if (b.ring >= 0) {                               // a player's ring, in their colour, on the ground
          const rs = ringSize * b.girth * (win ? 1.4 : 1) * (1 + 0.07 * Math.sin(now * 0.005 + b.id));
          M.p.y = Math.max(0.8, heightAt(b.x, b.z)) + 0.56; M.s.set(rs, 1, rs);
          M.m.compose(M.p, M.q.identity(), M.s).toArray(rings.instanceMatrix.array, b.ring * 16);
        }
        const rgb = this.areaRGB.get(b.job.id);          // coloured by job: the market crowd shows who does what
        col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
        const cell = b.mood * 2 + ((now * 0.001 + b.phase) % b.blinkEvery < 0.13 ? 1 : 0);
        if (faces.array[i * 2] !== cell) { faces.array[i * 2] = cell; faceDirty = true; }
        faces.array[i * 2 + 1] = FACE_LOOKS - 1 - b.look;
        if (!b.path.length) this.areaById.get(dest.id).count++;
        i++;
      }
      this.body.instanceMatrix.needsUpdate = this.body.instanceColor.needsUpdate = true;
      for (const m of this.extraMeshes) if (m) m.instanceMatrix.needsUpdate = true;
      rings.instanceMatrix.needsUpdate = true;
      if (faceDirty || !this._facesSent) faces.needsUpdate = this._facesSent = true;
      for (let k = 0; k < areas.length; k++) {
        const l = areas[k];
        if (l.shown !== l.count) { l.shown = l.count; l.countEl.textContent = l.count; l.boxW = 0; }
      }

      // Dusk follows the crowd rather than a flag: it draws in as the market fills and
      // lifts as the villagers trickle back out to their shifts, one by one.
      const dark = this.blobs.size ? crowd / this.blobs.size : 0;
      this.dusk = (this.dusk || 0) + (dark - (this.dusk || 0)) * Math.min(1, dt * 1.5);   // the lights are set in stage()
    }

    loop() {
      this._raf = requestAnimationFrame(this._tick || (this._tick = () => this.loop()));
      // Nothing to draw into, or nobody looking: skip the whole frame. (Browsers already
      // throttle rAF on a hidden tab, but not every host does, and a zero-sized canvas
      // still costs a full render.)
      if (document.hidden || !this.clientWidth || !this.clientHeight) { this._last = 0; return; }
      // Inset in the corner of the admin panel, the scene is a security camera: ~8 fps is
      // plenty, and the rest of the frames are given back to the dashboard.
      if (this._lowPower) {
        const t = performance.now();
        if (t - (this._lpAt || 0) < 120) return;
        this._lpAt = t;
      }
      this._frame = (this._frame || 0) + 1;
      if (this._frame === 3) { this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true; }
      const o = this.orbit;
      o.r += (o.tr - o.r) * 0.09;
      o.theta += (o.ttheta - o.theta) * 0.12;
      o.phi += (o.tphi - o.phi) * 0.12;
      const w0 = this.clientWidth || 1, h0 = this.clientHeight || 1;
      if (w0 !== this._w || h0 !== this._h) { this._w = w0; this._h = h0; this.resize(); }
      const cy = Math.cos(o.phi) * o.r;
      const cr = Math.sin(o.phi) * o.r;
      // What the camera looks at, and so what a zoom closes in on. It used to be the island's
      // centre — a point inside the mountain, so the view ray met the ground high on the near
      // slope and zooming in ended in a hillside. Zoomed out it is still the centre (a touch
      // lower, to sit the island in the frame); as the camera comes in, the focus slides out
      // toward the shore on the camera's own side and down to the road, so a zoom lands on
      // the village below you and orbiting at close range sweeps round the coast.
      const zk = Math.min(1, Math.max(0, (190 - o.r) / (190 - 48)));
      const ze = zk * zk * (3 - 2 * zk);
      const fr = FOCUS_R * ze, fx = Math.cos(o.theta) * fr, fz = Math.sin(o.theta) * fr, fy = 3 + 1.5 * ze;
      this.camera.position.set(fx + Math.cos(o.theta) * cr, Math.max(14, cy), fz + Math.sin(o.theta) * cr);
      this.camera.lookAt(fx, fy, fz);
      this.focus = Math.hypot(this.camera.position.x - fx, this.camera.position.y - fy, this.camera.position.z - fz);   // what the lens is focused on
      this.camera.updateMatrixWorld(true);

      const now = performance.now(), dt = Math.min(0.1, (now - (this._last || now)) / 1000);
      this.walk(dt, now);
      this.stage(dt, now);
      this._last = now;

      // Area labels follow their spot on the island. The work is split in two by cost.
      // EVERY frame: project the anchor with this frame's camera and move the label with a
      // transform — no layout, no style recalc beyond the one property, so the label is glued
      // to the ground it points at however fast the island is dragged. (It used to be placed
      // every third frame with left/top, so at 60 Hz it trailed the terrain by up to two
      // frames of camera motion, which is what read as lag.)
      // EVERY THIRD frame: the slow questions, whose answers change slowly — is it behind
      // the mountain along the view ray, and does it overlap a nearer label.
      {
        const w = this.clientWidth, h = this.clientHeight;
        const v = this._pinVector || (this._pinVector = new this.THREE.Vector3());
        const cam = this.camera.position;
        const slow = this._frame % 3 === 0 || !this._pinsPlaced;
        const areas = this.areas;
        for (let k = 0; k < areas.length; k++) {
          const l = areas[k];
          v.set(l.x, l.y, l.z).project(this.camera);
          l.sx = (v.x * 0.5 + 0.5) * w; l.sy = (-v.y * 0.5 + 0.5) * h;
          l.off = v.z > 1 || l.sx < -20 || l.sx > w + 20 || l.sy < -10 || l.sy > h + 30;
          if (!slow) continue;
          l.dist = Math.hypot(cam.x - l.x, cam.y - l.y, cam.z - l.z);
          l.occluded = false;
          if (!l.off) {                                   // terrain occlusion along the view ray
            for (let t = 0.12; t < 0.94; t += 0.06) {
              const px = cam.x + (l.x - cam.x) * t;
              const py = cam.y + (l.y - cam.y) * t;
              const pz = cam.z + (l.z - cam.z) * t;
              if (heightAt(px, pz) > py + 1.2) { l.occluded = true; break; }
            }
          }
        }

        if (slow) {
          this._pinsPlaced = true;
          const placedBoxes = [];
          const order = this._pinOrder || (this._pinOrder = areas.slice());
          order.sort((a, b) => a.dist - b.dist);
          for (const l of order) {
            // measured, not guessed: the tag is as wide as its name and its count. Only a
            // changed count invalidates it, and a transform never dirties layout, so this
            // read is free on every other pass.
            if (!l.boxW) {
              const was = l.pin.classList.contains("compact");
              l.pin.classList.remove("compact");
              l.boxW = l.pin.offsetWidth; l.boxH = l.pin.offsetHeight;
              l.pin.classList.add("compact");
              l.smallW = l.pin.offsetWidth;
              l.pin.classList.toggle("compact", was);
            }
            let show = !l.off && !l.occluded, compact = false;
            if (show) {
              const hits = bw => {
                const box = { x0: l.sx - bw / 2 - 3, x1: l.sx + bw / 2 + 3, y0: l.sy - l.boxH - 3, y1: l.sy + 3 };
                return { box, clash: placedBoxes.some(b => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) };
              };
              const full = hits(l.boxW);
              if (full.clash) {
                const small = hits(l.smallW);               // keep the marker, drop the name
                if (small.clash) show = false; else { compact = true; placedBoxes.push(small.box); }
              } else placedBoxes.push(full.box);
            }
            if (show !== l.vis) {
              l.vis = show;
              l.pin.style.opacity = show ? 1 : 0;
              l.pin.style.pointerEvents = show ? "auto" : "none";
            }
            if (compact !== l.compact) { l.compact = compact; l.pin.classList.toggle("compact", compact); }
            const z = 1000 - Math.round(l.dist);
            if (z !== l.z0) { l.z0 = z; l.pin.style.zIndex = String(z); }
          }
        }

        for (let k = 0; k < areas.length; k++) {
          const l = areas[k];
          if (!l.vis || l.off) continue;
          // whole pixels: the text stays crisp, and a label at rest does not shimmer
          const tx = Math.round(l.sx), ty = Math.round(l.sy);
          if (tx === l.tx && ty === l.ty) continue;
          l.tx = tx; l.ty = ty;
          l.pin.style.transform = `translate3d(${tx}px,${ty}px,0) translate(-50%,-100%)`;
        }
      }

      this.labels(dt, now);

      if (this.waterUniforms) {
        this.waterUniforms.uTime.value = performance.now() * 0.001;
        this.waterUniforms.uCam.value.copy(this.camera.position);
      }
      this.render();
    }
  }

  if (!customElements.get("island-3d")) customElements.define("island-3d", Island3D);
})();
