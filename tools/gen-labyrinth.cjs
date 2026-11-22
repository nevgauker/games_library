#!/usr/bin/env node
// Neon Labyrinth '89 level generator.
// Builds every level deterministically from a seed + feature spec and writes
// src/neonlabyrinth_levels.js. Mazes are perfect (tree) mazes carved by a seeded
// recursive backtracker; doors are placed on the solution path *before* any
// braiding, and braiding / pulse shortcuts only ever connect cells of the same
// door-region, so every locked door stays a true cut (no bypass).
//
// Usage: node tools/gen-labyrinth.cjs          print every map
//        node tools/gen-labyrinth.cjs --write  regenerate src/neonlabyrinth_levels.js
// Hand edits to the levels file are lost on --write: tune the SPECS below instead,
// then run node tools/check-labyrinth.cjs.
const fs = require('fs');
const path = require('path');

// Legend: # wall · S start · E exit · t time crystal · a/b/c key · A/B/C door
//         ~ pulse gate (opens and closes on a beat) · h/v scanner (patrols horizontally/vertically)
const SPECS = [
  { name: 'Boot Sequence', seed: 11, w: 15, h: 11, fog: 0, pace: 1.3,
    intro: 'Reach the green exit before the clock runs out. Hold a direction to glide down corridors.' },
  { name: 'Lights Out', seed: 7, w: 19, h: 13, fog: 4.5,
    intro: 'Your light only reaches a few cells. Corridors you have seen stay mapped. The exit beacon shows where to go, not how.' },
  { name: 'Time Crystals', seed: 31, w: 21, h: 15, fog: 4.5, crystals: 3,
    intro: 'White crystals add time to the clock. They hide in dead ends. Is the detour worth it?' },
  { name: 'Loops', seed: 5, w: 25, h: 17, fog: 4, braid: 0.5, crystals: 2,
    intro: 'This maze has loops: more than one way through, and more ways to get turned around.' },
  { name: 'Keycard', seed: 23, w: 23, h: 15, fog: 4, keys: 1, crystals: 2,
    intro: 'A locked gate seals the way. Find the matching keycard first.' },
  { name: 'Pulse Gates', seed: 42, w: 25, h: 17, fog: 4, braid: 0.2, pulses: 4, crystals: 2,
    intro: 'Orange gates pulse open and shut on a beat. They are shortcuts. Time your dash, or take the long way.' },
  { name: 'Scanners', seed: 99, w: 25, h: 17, fog: 4.5, braid: 0.3, scanners: 2, crystals: 2,
    intro: 'Red scanners sweep the corridors. A hit costs 5 seconds. Listen for their ping in the dark.' },
  { name: 'Double Lock', seed: 64, w: 27, h: 19, fog: 4, braid: 0.25, keys: 2, crystals: 3,
    intro: 'Two gates, two keycards. Each key waits beyond the previous gate.' },
  { name: 'Blackout Rush', seed: 13, w: 29, h: 19, fog: 3, braid: 0.4, crystals: 4, pace: 0.85,
    intro: 'Your light is dimmer and the clock is tight. Grab crystals to stay alive.' },
  { name: 'Patrol Lines', seed: 77, w: 29, h: 19, fog: 4, braid: 0.3, keys: 1, pulses: 3, scanners: 3, crystals: 3,
    intro: 'Scanners, gates and a keycard together. Keep moving.' },
  { name: 'The Vault', seed: 88, w: 31, h: 21, fog: 3.5, braid: 0.2, keys: 3, pulses: 3, crystals: 3,
    intro: 'Three nested vault doors. Map carefully. Backtracking is expensive.' },
  { name: 'Neon Core', seed: 2026, w: 33, h: 23, fog: 3.5, braid: 0.3, keys: 2, pulses: 4, scanners: 4, crystals: 4,
    intro: 'The heart of the labyrinth. Everything you have learned, all at once. Good luck.' },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function generate(spec) {
  const rand = rng(spec.seed);
  const W = spec.w, H = spec.h;
  const g = Array.from({ length: H }, () => Array(W).fill('#'));
  const inside = (r, c) => r > 0 && c > 0 && r < H - 1 && c < W - 1;
  const isFloor = (r, c) => g[r] && g[r][c] !== undefined && g[r][c] !== '#';

  // 1. Perfect maze (iterative recursive backtracker on odd cells).
  const stack = [[1, 1]];
  g[1][1] = ' ';
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const opts = DIRS.map(([dr, dc]) => [r + dr * 2, c + dc * 2, r + dr, c + dc])
      .filter(([nr, nc]) => inside(nr, nc) && g[nr][nc] === '#');
    if (!opts.length) { stack.pop(); continue; }
    const [nr, nc, wr, wc] = opts[Math.floor(rand() * opts.length)];
    g[wr][wc] = ' '; g[nr][nc] = ' ';
    stack.push([nr, nc]);
  }

  // BFS over floor; `block(r,c)` treats extra cells as walls.
  function bfs(sr, sc, block) {
    const d = Array.from({ length: H }, () => Array(W).fill(-1));
    const par = Array.from({ length: H }, () => Array(W).fill(null));
    d[sr][sc] = 0;
    const q = [[sr, sc]];
    for (let i = 0; i < q.length; i++) {
      const [r, c] = q[i];
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (!isFloor(nr, nc) || d[nr][nc] >= 0 || (block && block(nr, nc))) continue;
        d[nr][nc] = d[r][c] + 1; par[nr][nc] = [r, c]; q.push([nr, nc]);
      }
    }
    return { d, par };
  }
  const cellsWhere = (pred) => {
    const out = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (pred(r, c)) out.push([r, c]);
    return out;
  };
  const degree = (r, c) => DIRS.filter(([dr, dc]) => isFloor(r + dr, c + dc)).length;

  // 2. Start in a random corner, exit at the farthest cell (in the tree).
  const corners = [[1, 1], [1, W - 2], [H - 2, 1], [H - 2, W - 2]];
  const [sr, sc] = corners[Math.floor(rand() * 4)];
  let { d, par } = bfs(sr, sc);
  let er = sr, ec = sc;
  for (const [r, c] of cellsWhere((r, c) => d[r][c] >= 0 && r % 2 === 1 && c % 2 === 1)) {
    if (d[r][c] > d[er][ec]) { er = r; ec = c; }
  }
  const solution = [];
  for (let p = [er, ec]; p; p = par[p[0]][p[1]]) solution.unshift(p);

  // 3. Doors on solution-path passage cells, spread along the route.
  const keys = spec.keys || 0;
  const doorCells = [];
  for (let k = 0; k < keys; k++) {
    let idx = Math.round(solution.length * (k + 1) / (keys + 1));
    // passage cell = exactly one even coordinate; always degree 2 in a tree
    const isPassage = ([r, c]) => (r % 2 === 0) !== (c % 2 === 0);
    let best = null;
    for (let o = 0; o < solution.length && !best; o++) {
      for (const j of [idx + o, idx - o]) {
        if (j > 2 && j < solution.length - 2 && isPassage(solution[j]) &&
            !doorCells.some(([r, c]) => Math.abs(solution.findIndex(p => p[0] === r && p[1] === c) - j) < 6)) {
          best = solution[j]; break;
        }
      }
    }
    doorCells.push(best);
    g[best[0]][best[1]] = 'ABC'[k];
  }

  // Region labels with doors as walls (region 0 holds S, region `keys` holds E).
  const region = Array.from({ length: H }, () => Array(W).fill(-1));
  function labelRegions() {
    for (const row of region) row.fill(-1);
    const seeds = [[sr, sc]];
    for (const [r, c] of doorCells) {
      // the side farther along the solution is the next region
      const i = solution.findIndex(p => p[0] === r && p[1] === c);
      seeds.push(solution[i + 1]);
    }
    seeds.forEach(([r0, c0], id) => {
      const q = [[r0, c0]]; region[r0][c0] = id;
      for (let i = 0; i < q.length; i++) {
        const [r, c] = q[i];
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (!isFloor(nr, nc) || /[ABC]/.test(g[nr][nc]) || region[nr][nc] >= 0) continue;
          region[nr][nc] = id; q.push([nr, nc]);
        }
      }
    });
  }
  labelRegions();

  // 4. Braid: open some dead ends into a same-region neighbour.
  if (spec.braid) {
    const deadEnds = cellsWhere((r, c) => r % 2 && c % 2 && isFloor(r, c) && degree(r, c) === 1 &&
      !(r === sr && c === sc) && !(r === er && c === ec));
    for (const [r, c] of deadEnds) {
      if (degree(r, c) !== 1 || rand() > spec.braid) continue;
      const opts = DIRS.map(([dr, dc]) => [r + dr * 2, c + dc * 2, r + dr, c + dc])
        .filter(([nr, nc, wr, wc]) => inside(nr, nc) && inside(wr, wc) && g[wr][wc] === '#' &&
          isFloor(nr, nc) && region[nr][nc] === region[r][c]);
      if (!opts.length) continue;
      opts.sort((x, y) => degree(y[0], y[1]) === 1 ? 1 : -1); // prefer joining two dead ends
      const [, , wr, wc] = opts[Math.floor(rand() * Math.min(2, opts.length))];
      g[wr][wc] = ' ';
      region[wr][wc] = region[r][c];
    }
  }

  // Detour distance from the S->E route for item placement.
  const used = new Set([`${sr},${sc}`, `${er},${ec}`]);
  const routeDist = () => {
    const blockDoors = () => false;
    const fromS = bfs(sr, sc, blockDoors).d;
    // multi-source BFS from the solution cells
    const dd = Array.from({ length: H }, () => Array(W).fill(-1));
    const q = [];
    for (const [r, c] of solution) if (isFloor(r, c)) { dd[r][c] = 0; q.push([r, c]); }
    for (let i = 0; i < q.length; i++) {
      const [r, c] = q[i];
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (!isFloor(nr, nc) || dd[nr][nc] >= 0) continue;
        dd[nr][nc] = dd[r][c] + 1; q.push([nr, nc]);
      }
    }
    return { dd, fromS };
  };
  const { dd, fromS } = routeDist();
  const deadEndsNow = () => cellsWhere((r, c) => r % 2 && c % 2 && g[r][c] === ' ' && degree(r, c) === 1 && !used.has(`${r},${c}`));

  // 5. Keys: key k lives in region k, in the deepest dead end there.
  for (let k = 0; k < keys; k++) {
    const cands = deadEndsNow().filter(([r, c]) => region[r][c] === k && fromS[r][c] > 4)
      .sort((x, y) => dd[y[0]][y[1]] - dd[x[0]][x[1]]);
    let pick = cands[Math.floor(rand() * Math.min(2, cands.length))];
    if (!pick) {
      const any = cellsWhere((r, c) => r % 2 && c % 2 && g[r][c] === ' ' && region[r][c] === k && !used.has(`${r},${c}`))
        .sort((x, y) => dd[y[0]][y[1]] - dd[x[0]][x[1]]);
      pick = any[0];
    }
    g[pick[0]][pick[1]] = 'abc'[k];
    used.add(`${pick[0]},${pick[1]}`);
  }

  // 6. Crystals in dead ends, preferring short-but-real detours spread over the map.
  const crystals = spec.crystals || 0;
  {
    const cands = deadEndsNow().filter(([r, c]) => dd[r][c] >= 2 && fromS[r][c] > 3);
    const placed = [];
    // shuffle, then greedily keep the ones far from already placed crystals
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    cands.sort((x, y) => Math.abs(dd[x[0]][x[1]] - 4) - Math.abs(dd[y[0]][y[1]] - 4));
    for (const cand of cands) {
      if (placed.length >= crystals) break;
      if (placed.some(([r, c]) => Math.abs(r - cand[0]) + Math.abs(c - cand[1]) < 7)) continue;
      placed.push(cand);
    }
    for (const [r, c] of placed) { g[r][c] = 't'; used.add(`${r},${c}`); }
  }

  // 7. Pulse gates: wall passages that would be big same-region shortcuts.
  const pulses = spec.pulses || 0;
  if (pulses) {
    const cands = [];
    for (const [r, c] of cellsWhere((r, c) => inside(r, c) && g[r][c] === '#' && ((r % 2 === 0) !== (c % 2 === 0)))) {
      const pair = r % 2 === 0 ? [[r - 1, c], [r + 1, c]] : [[r, c - 1], [r, c + 1]];
      const [[ar, ac], [br, bc]] = pair;
      if (!isFloor(ar, ac) || !isFloor(br, bc)) continue;
      if (region[ar][ac] !== region[br][bc] || region[ar][ac] < 0) continue;
      const gain = bfs(ar, ac).d[br][bc];
      if (gain < 10) continue;
      cands.push({ r, c, gain, onRoute: Math.min(dd[ar][ac], dd[br][bc]) });
    }
    cands.sort((x, y) => (y.gain - y.onRoute * 3) - (x.gain - x.onRoute * 3));
    const placed = [];
    for (const cand of cands) {
      if (placed.length >= pulses) break;
      if (placed.some(p => Math.abs(p.r - cand.r) + Math.abs(p.c - cand.c) < 8)) continue;
      placed.push(cand);
    }
    for (const p of placed) g[p.r][p.c] = '~';
  }

  // 8. Scanners on long straight corridor runs away from the start.
  const scanners = spec.scanners || 0;
  if (scanners) {
    const runs = [];
    const passable = (r, c) => isFloor(r, c) && !/[ABC~]/.test(g[r][c]);
    for (let r = 1; r < H - 1; r++) {
      for (let c = 1; c < W - 1;) {
        if (!passable(r, c)) { c++; continue; }
        let e = c; while (passable(r, e + 1)) e++;
        if (e - c + 1 >= 5) runs.push({ axis: 'h', r, c: Math.floor((c + e) / 2), len: e - c + 1 });
        c = e + 1;
      }
    }
    for (let c = 1; c < W - 1; c++) {
      for (let r = 1; r < H - 1;) {
        if (!passable(r, c)) { r++; continue; }
        let e = r; while (passable(e + 1, c)) e++;
        if (e - r + 1 >= 5) runs.push({ axis: 'v', r: Math.floor((r + e) / 2), c, len: e - r + 1 });
        r = e + 1;
      }
    }
    const ok = runs.filter(run => fromS[run.r][run.c] > 9 && g[run.r][run.c] === ' ' && !used.has(`${run.r},${run.c}`))
      .sort((x, y) => y.len - x.len || dd[x.r][x.c] - dd[y.r][y.c]);
    const placed = [];
    for (const run of ok) {
      if (placed.length >= scanners) break;
      if (placed.some(p => Math.abs(p.r - run.r) + Math.abs(p.c - run.c) < 9)) continue;
      placed.push(run);
    }
    for (const p of placed) g[p.r][p.c] = p.axis;
  }

  g[sr][sc] = 'S'; g[er][ec] = 'E';
  return g.map(row => row.join(''));
}

// BFS over (cell, keys held) -> list of direction names, or null.
// opts.pulses: 'open' | 'closed' (default); opts.wallDoor: a gate letter treated as a wall
const ROUTE_DIRS = [['up', -1, 0], ['down', 1, 0], ['left', 0, -1], ['right', 0, 1]];
function route(map, opts = {}) {
  const H = map.length, W = map[0].length;
  let s, e;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (map[r][c] === 'S') s = [r, c];
    if (map[r][c] === 'E') e = [r, c];
  }
  const key = (r, c, m) => (r * W + c) * 8 + m;
  const prev = new Map([[key(s[0], s[1], 0), null]]);
  const q = [[s[0], s[1], 0]];
  for (let i = 0; i < q.length; i++) {
    const [r, c, m] = q[i];
    if (r === e[0] && c === e[1]) {
      const dirs = [];
      for (let k = key(r, c, m); prev.get(k); k = prev.get(k).from) dirs.unshift(prev.get(k).dir);
      return dirs;
    }
    for (const [name, dr, dc] of ROUTE_DIRS) {
      const nr = r + dr, nc = c + dc;
      const ch = map[nr] && map[nr][nc];
      if (!ch || ch === '#') continue;
      if (ch === '~' && opts.pulses !== 'open') continue;
      if (/[ABC]/.test(ch) && (ch === opts.wallDoor || !(m & (1 << (ch.charCodeAt(0) - 65))))) continue;
      const nm = /[abc]/.test(ch) ? m | (1 << (ch.charCodeAt(0) - 97)) : m;
      const k = key(nr, nc, nm);
      if (prev.has(k)) continue;
      prev.set(k, { from: key(r, c, m), dir: name });
      q.push([nr, nc, nm]);
    }
  }
  return null;
}

// Clock and par come from the real route lengths, so difficulty stays consistent:
//   time = 1.5 x the safe route + an exploration allowance per floor cell (bigger
//          in the dark) + 5 s, scaled by the level's pace
//   par  = 1.25 x the fastest route (pulse gates allowed, plus a little gate waiting) + 2 s
const STEP_TIME = 0.085; // keep in sync with src/neonlabyrinth.js
function timing(spec, map) {
  const safe = route(map), fast = route(map, { pulses: 'open' }) || safe;
  const floor = map.join('').replace(/#/g, '').length;
  const explore = floor * STEP_TIME * (spec.fog ? 1.1 : 0.4);
  const time = Math.round((safe.length * STEP_TIME * 1.5 + explore + 5) * (spec.pace || 1));
  const gatesOnFast = Math.min(fast.length, safe.length) < safe.length ? (spec.pulses || 0) : 0;
  const par = Math.ceil(Math.min(fast.length, safe.length) * STEP_TIME * 1.25 + 2 + gatesOnFast * 0.6);
  return { time, par };
}

function buildFile() {
  const levels = SPECS.map(s => {
    const map = generate(s);
    const out = { name: s.name, intro: s.intro, fog: s.fog, ...timing(s, map) };
    if (s.crystals) out.crystal = 4;
    out.map = map;
    return out;
  });
  const body = levels.map(l => {
    const meta = Object.entries(l).filter(([k]) => k !== 'map').map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
    return `  {\n    ${meta},\n    map: [\n${l.map.map(r => `      ${JSON.stringify(r)},`).join('\n')}\n    ],\n  },`;
  }).join('\n');
  return `// Neon Labyrinth '89 levels. GENERATED by tools/gen-labyrinth.cjs --write; edit the SPECS there.
// Legend: # wall · S start · E exit · t time crystal · a/b/c keycard · A/B/C locked gate
//         ~ pulse gate · h/v scanner patrolling horizontally/vertically
// fog: light radius in cells (0 = full view) · time: clock in seconds
// par: finish time for three stars · crystal: seconds added per crystal
(function (root) {
  root.NEON_LABYRINTH_LEVELS = [
${body}
  ];
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

if (require.main === module) {
  if (process.argv.includes('--write')) {
    const file = path.join(__dirname, '..', 'src', 'neonlabyrinth_levels.js');
    fs.writeFileSync(file, buildFile());
    console.log('wrote', path.relative(process.cwd(), file));
  } else {
    SPECS.forEach((s, i) => console.log(`L${i + 1} ${s.name}\n${generate(s).join('\n')}\n`));
  }
}
module.exports = { generate, route, timing, SPECS, STEP_TIME };
