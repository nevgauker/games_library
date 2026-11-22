#!/usr/bin/env node
// Pack & Dash! level checker. Runs the real engine headlessly and verifies, per level:
//   1. parse       - map, items and NPC routes are well formed
//   2. reachable   - every item and the elevator can be walked to from the spawn
//   3. safe spawn  - nobody talks to a player who stands still for the first 2 s
//   4. par         - a stealth bot (waits out boss cones, excuses itself from
//                    coworkers, mashes out of boss chats) beats the level's par time
// Warnings (exit 0) flag levels that look too generous: par far above the bot's
// time, or a time limit far above par.
// Usage: node tools/check-packdash.cjs [levelNumber] [-v]
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const win = {};
for (const f of ['src/packdash_levels.js', 'src/packdash.js']) {
  new Function('window', fs.readFileSync(path.join(root, f), 'utf8') + `\n//# sourceURL=${f}`)(win);
}
const { PackDashGame, PACKDASH_LEVELS, PACKDASH_ITEMS } = win;
const { TILE, BASE_SPEED, PACK_TIME, SLIDE_MUL } = win.__PACKDASH_CONST;
const TOL = 2.5;               // px from a tile centre that counts as 'there'
const DT = 1 / 60;
const ORDERS = 24;            // most promising item orders to simulate
const CAUTION = [0, 1, 2];    // tiles of look-ahead the bot keeps out of boss cones
const MASH_EVERY = 10;        // frames between excuse presses (6/s, a relaxed human mash)
const VERBOSE = process.argv.includes('-v');

// Shortest paths over floor tiles (Dijkstra). Stepping onto wet floor slides you
// to where the slide stops, so those moves are single directed edges.
function bfs(g, sx, sy) {
  const dist = new Map(), prev = new Map(), key = (x, y) => y * g.cols + x;
  const done = new Set();
  dist.set(key(sx, sy), 0);
  const open = [[sx, sy]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(key(...open[i])) < dist.get(key(...open[bi]))) bi = i;
    const [x, y] = open.splice(bi, 1)[0], k0 = key(x, y);
    if (done.has(k0)) continue;
    done.add(k0);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      let nx = x + dx, ny = y + dy, n = 1;
      if (g.isWall(nx, ny)) continue;
      while (g.isWet(nx, ny) && !g.isWall(nx + dx, ny + dy)) { nx += dx; ny += dy; n++; }
      const slid = g.isWet(x + dx, y + dy);
      const cost = dist.get(k0) + (slid ? n / SLIDE_MUL : n);
      const k = key(nx, ny);
      if (dist.has(k) && dist.get(k) <= cost) continue;
      dist.set(k, cost); prev.set(k, [x, y]); open.push([nx, ny]);
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
const speedFor = w => BASE_SPEED * Math.max(0.6, 1 - 0.035 * w);

// Candidate routes spawn -> items (some order) -> elevator, best estimated time first.
function planRoutes(g) {
  const sp = g.tileOf(g.player);
  const points = [[sp.gx, sp.gy], ...g.items.map(it => [it.gx, it.gy]), [g.elevator.x / TILE, g.elevator.y / TILE]];
  const searches = points.map(p => bfs(g, p[0], p[1]));
  const d = (i, j) => searches[i].dist.get(searches[i].key(points[j][0], points[j][1]));
  const problems = [];
  const last = points.length - 1;
  for (let j = 1; j <= last; j++) if (d(0, j) == null) problems.push(j === last ? 'elevator unreachable' : `${g.items[j - 1].data.name} unreachable`);
  if (problems.length) return { problems, routes: [] };
  const cands = [];
  for (const order of permutations(g.items.map((_, i) => i + 1))) {
    let est = 0, at = 0, w = 0;
    for (const i of order) { est += d(at, i) * TILE / speedFor(w) + PACK_TIME; w += g.items[i - 1].data.weight || 1; at = i; }
    est += d(at, last) * TILE / speedFor(w);
    cands.push({ est, order });
  }
  cands.sort((a, b) => a.est - b.est);
  const routes = cands.slice(0, ORDERS).map(({ est, order }) => {
    const steps = [];
    let at = 0;
    for (const i of [...order, last]) {
      const seg = pathTo(searches[at], points[i][0], points[i][1]);
      for (const t of (steps.length ? seg.slice(1) : seg)) steps.push({ gx: t[0], gy: t[1] });
      if (i !== last) steps[steps.length - 1].item = true;
      at = i;
    }
    return { est, order, steps };
  });
  return { problems, routes };
}

function runBot(levelIndex, route, caution, levels = PACKDASH_LEVELS) {
  const g = new PackDashGame(levelIndex, { seed: 1, levels });
  const steps = route.steps;
  let result = null, wp = 1, frame = 0, waited = 0, chats = 0, hearts = 0;
  g.on('bossTalk', () => chats++);
  g.on('win', r => result = { win: true, ...r });
  g.on('lose', () => result = { win: false });
  const limit = Math.ceil(g.timeLimit / DT) + 10;
  for (; frame < limit && !result; frame++) {
    if (g.talk) {
      g.input(null);
      if (g.talk.kind === 'coworker' || frame % MASH_EVERY === 0) g.excuse();
      g.step(DT); continue;
    }
    const p = g.player, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    let dir = null;
    while (wp < steps.length) {
      const s = steps[wp], tx = s.gx * TILE + TILE / 2, ty = s.gy * TILE + TILE / 2;
      const there = Math.abs(cx - tx) <= TOL && Math.abs(cy - ty) <= TOL;
      if (there) {
        if (s.item && g.items.some(it => !it.picked && it.gx === s.gx && it.gy === s.gy)) break; // packing
        wp++; continue;
      }
      dir = Math.abs(cx - tx) > TOL ? (cx < tx ? 'right' : 'left') : (cy < ty ? 'down' : 'up');
      // Wait for a jammed printer ahead to clear.
      const h0 = g.tileOf(p);
      const ax = h0.gx + (dir === 'right' ? 1 : dir === 'left' ? -1 : 0), ay = h0.gy + (dir === 'down' ? 1 : dir === 'up' ? -1 : 0);
      if (g.isBlocked(ax, ay) && !g.isWall(ax, ay)) { dir = null; break; }
      // Hold back while the next tiles are watched (unless we're already in plain view).
      const here = g.tileOf(p);
      if (caution > 0 && waited < 4 && !g.watched(here.gx, here.gy)) {
        for (let k = 0; k < caution && wp + k < steps.length; k++) {
          if (g.watched(steps[wp + k].gx, steps[wp + k].gy)) { dir = null; break; }
        }
      }
      break;
    }
    waited = dir ? 0 : waited + DT;
    g.input(dir);
    g.step(DT);
  }
  return Object.assign(result || { win: false }, { chats });
}

function checkLevel(i) {
  const def = PACKDASH_LEVELS[i];
  const label = `Level ${i + 1} "${def.name}"`;
  const fails = [], warns = [];
  let g;
  try { g = new PackDashGame(i, { seed: 1 }); }
  catch (e) { console.log(`✗ ${label}: parse - ${e.message}`); return false; }
  if (!(def.par > 0) || !(def.time > def.par)) fails.push('needs par > 0 and time > par');

  const idle = new PackDashGame(i, { seed: 1 });
  let talked = null; idle.on('bossTalk', () => talked = 'boss'); idle.on('coworkerTalk', () => talked = 'a coworker');
  for (let f = 0; f < 120 && !talked; f++) idle.step(DT);
  if (talked) fails.push(`${talked} talks to an idle player at spawn within ${idle.time.toFixed(2)}s`);

  const { problems, routes } = planRoutes(g);
  fails.push(...problems);
  let summary = '';
  if (routes.length) {
    let best = null;
    for (const r of routes) for (const c of CAUTION) {
      const res = runBot(i, r, c);
      if (res.win && (!best || res.time < best.time)) best = { ...res, caution: c, route: r };
    }
    // Same routes with nobody around: how much do the NPCs actually cost?
    const empty = PACKDASH_LEVELS.map((d, j) => j === i ? Object.assign({}, d, { bosses: [], coworkers: [] }) : d);
    let alone = null;
    for (const r of routes) { const res = runBot(i, r, 0, empty); if (res.win && (!alone || res.time < alone.time)) alone = res; }
    if (!best) fails.push('stealth bot never escapes in time');
    else {
      const ideal = routes[0].est;
      const cost = alone ? best.time - alone.time : 0;
      summary = `bot ${best.time.toFixed(1)}s (alone ${alone ? alone.time.toFixed(1) : '-'}s, NPCs cost ${cost.toFixed(1)}s, boss chats ${best.chats}), par ${def.par}s, limit ${def.time}s`;
      const npcs = (def.bosses || []).length + (def.coworkers || []).length;
      if (npcs && cost < 0.3) warns.push(`NPCs never get in the way: they cost the bot ${cost.toFixed(1)}s`);
      if (def.par < best.time * 1.1) warns.push(`par is tight for humans: bot needs ${best.time.toFixed(1)}s`);
      if (best.time > def.par) fails.push(`par ${def.par}s not reached by the bot (${best.time.toFixed(1)}s)`);
      if (def.par > best.time * 1.35) warns.push(`par is generous: bot needs ${best.time.toFixed(1)}s`);
      if (def.time > def.par * 2.2) warns.push(`time limit is generous: ${def.time}s vs par ${def.par}s`);
      if (VERBOSE) console.log(`    best order ${best.route.order.map(n => g.items[n - 1].id).join(' > ')}, caution ${best.caution}`);
    }
  }
  console.log(`${fails.length ? '✗' : '✓'} ${label}${summary ? ': ' + summary : ''}`);
  for (const f of fails) console.log(`    - ${f}`);
  for (const w of warns) console.log(`    ! ${w}`);
  return !fails.length;
}

const arg = process.argv.slice(2).find(a => /^\d+$/.test(a));
const indices = arg ? [Number(arg) - 1] : PACKDASH_LEVELS.map((_, i) => i);
let ok = true;
for (const i of indices) ok = checkLevel(i) && ok;
process.exit(ok ? 0 : 1);
