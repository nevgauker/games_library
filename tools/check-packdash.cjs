#!/usr/bin/env node
// Pack & Dash! level checker. Runs the real engine headlessly and verifies, per level:
//   1. parse       - the map is well formed (spawn, boss, 2x2 elevator, known items)
//   2. reachable   - every item and the elevator can be walked to from the spawn
//   3. safe spawn  - the boss can't spot a player who stands still for the first 2 s
//   4. bot wins    - a bot walking the shortest item route (ignoring coworkers, eating
//                    every boss chat) beats the clock on SEEDS different random seeds
// Usage: node tools/check-packdash.cjs [levelNumber]
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const win = {};
for (const f of ['src/packdash_levels.js', 'src/packdash.js']) {
  new Function('window', fs.readFileSync(path.join(root, f), 'utf8') + `\n//# sourceURL=${f}`)(win);
}
const { PackDashGame, PACKDASH_LEVELS } = win;
const { TILE, BASE_SPEED } = win.__PACKDASH_CONST;
const DT = 1 / 60;
const SEEDS = 25;

// BFS over floor tiles; returns { dist, prev } from a start tile.
function bfs(g, sx, sy) {
  const dist = new Map(), prev = new Map(), key = (x, y) => y * g.cols + x;
  const q = [[sx, sy]]; dist.set(key(sx, sy), 0);
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (g.isWall(nx, ny) || dist.has(k)) continue;
      dist.set(k, dist.get(key(x, y)) + 1); prev.set(k, [x, y]); q.push([nx, ny]);
    }
  }
  return { dist, prev, key };
}
function pathTo(b, tx, ty) {
  const out = []; let cur = [tx, ty];
  while (cur) { out.push(cur); cur = b.prev.get(b.key(cur[0], cur[1])); }
  return out.reverse();
}
function* permutations(a, n = a.length) {
  if (n <= 1) { yield a.slice(); return; }
  for (let i = 0; i < n; i++) {
    yield* permutations(a, n - 1);
    const j = n % 2 ? 0 : i; [a[n - 1], a[j]] = [a[j], a[n - 1]];
  }
}

// Shortest tile route spawn -> all items (any order) -> elevator.
function planRoute(g) {
  const tileOf = r => [Math.floor((r.x + r.w / 2) / TILE), Math.floor((r.y + r.h / 2) / TILE)];
  const spawn = tileOf(g.player);
  const elev = [g.elevator.x / TILE, g.elevator.y / TILE];
  const points = [spawn, ...g.items.map(it => [it.gx, it.gy]), elev];
  const searches = points.map(p => bfs(g, p[0], p[1]));
  const d = (i, j) => searches[i].dist.get(searches[i].key(points[j][0], points[j][1]));
  const problems = [];
  points.slice(1).forEach((p, i) => {
    if (d(0, i + 1) == null) problems.push(i + 1 === points.length - 1 ? 'elevator unreachable' : `item ${g.items[i].data.name} unreachable`);
  });
  if (problems.length) return { problems };
  const last = points.length - 1;
  let best = null;
  for (const order of permutations(g.items.map((_, i) => i + 1))) {
    let len = 0, at = 0;
    for (const i of order) { len += d(at, i); at = i; }
    len += d(at, last);
    if (!best || len < best.len) best = { len, order };
  }
  const tiles = [];
  let at = 0;
  for (const i of [...best.order, last]) {
    const seg = pathTo(searches[at], points[i][0], points[i][1]);
    tiles.push(...(tiles.length ? seg.slice(1) : seg));
    at = i;
  }
  return { problems, len: best.len, tiles };
}

// Drive the player through tile centres, one axis at a time.
function runBot(levelIndex, seed, tiles) {
  const g = new PackDashGame(levelIndex, { seed });
  let chats = 0, result = null, wp = 1, stuck = 0, lastWp = 1;
  g.on('bossTalk', () => chats++);
  g.on('win', () => result = 'win');
  g.on('lose', () => result = 'lose');
  const limit = Math.ceil(g.def.time / DT) + 10;
  for (let f = 0; f < limit && !result; f++) {
    const p = g.player, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    while (wp < tiles.length) {
      const tx = tiles[wp][0] * TILE + TILE / 2, ty = tiles[wp][1] * TILE + TILE / 2;
      if (Math.abs(cx - tx) <= 1 && Math.abs(cy - ty) <= 1) { wp++; continue; }
      g.input(Math.abs(cx - tx) > 1 ? (cx < tx ? 'right' : 'left') : (cy < ty ? 'down' : 'up'));
      break;
    }
    if (wp >= tiles.length) g.input(null);
    stuck = wp === lastWp ? stuck + 1 : 0; lastWp = wp;
    if (stuck > 600) return { result: 'stuck', at: tiles[wp], chats };
    g.step(DT);
  }
  return { result: result || 'timeout', time: g.time, timeLeft: g.timeLeft, chats };
}

function checkLevel(i) {
  const def = PACKDASH_LEVELS[i];
  const label = `Level ${i + 1} "${def.name}"`;
  const fails = [];
  let g;
  try { g = new PackDashGame(i, { seed: 1 }); }
  catch (e) { console.log(`✗ ${label}: parse - ${e.message}`); return false; }

  const route = planRoute(g);
  fails.push(...route.problems);

  for (let s = 1; s <= 5; s++) {
    const idle = new PackDashGame(i, { seed: s });
    let spotted = false; idle.on('bossTalk', () => spotted = true);
    for (let f = 0; f < 120 && !spotted; f++) idle.step(DT);
    if (spotted) { fails.push(`boss spots an idle player at spawn within ${(idle.time).toFixed(2)}s`); break; }
  }

  let summary = '';
  if (!route.problems.length) {
    const ideal = route.len * TILE / BASE_SPEED;
    const runs = [];
    for (let s = 1; s <= SEEDS; s++) runs.push(runBot(i, s, route.tiles));
    const bad = runs.filter(r => r.result !== 'win');
    if (bad.length) fails.push(`bot failed ${bad.length}/${SEEDS} seeds (${[...new Set(bad.map(r => r.result + (r.at ? '@' + r.at : '')))].join(', ')})`);
    const wins = runs.filter(r => r.result === 'win');
    if (wins.length) {
      const times = wins.map(r => r.time), chats = wins.map(r => r.chats);
      summary = `route ${route.len} tiles (ideal ${ideal.toFixed(1)}s), bot ${Math.min(...times).toFixed(1)}-${Math.max(...times).toFixed(1)}s ` +
                `of ${def.time}s, boss chats ${Math.min(...chats)}-${Math.max(...chats)}`;
    }
  }
  console.log(`${fails.length ? '✗' : '✓'} ${label}${summary ? ': ' + summary : ''}`);
  for (const f of fails) console.log(`    - ${f}`);
  return !fails.length;
}

const arg = process.argv.slice(2).find(a => /^\d+$/.test(a));
const indices = arg ? [Number(arg) - 1] : PACKDASH_LEVELS.map((_, i) => i);
let ok = true;
for (const i of indices) ok = checkLevel(i) && ok;
process.exit(ok ? 0 : 1);
