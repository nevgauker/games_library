#!/usr/bin/env node
// Neon Labyrinth '89 level checker. For every level it verifies:
//   structure  - rectangular, sealed border, one S and one E, keys match gates
//   solvable   - the exit is reachable with every pulse gate CLOSED (gates are
//                only ever shortcuts, never required)
//   locks      - every locked gate is a true cut: without it the exit is unreachable
//   timing     - the real engine, driven along the optimal route, wins within par
//                (three stars are earnable) and the clock leaves room to explore
//                but still applies pressure
// Usage: node tools/check-labyrinth.cjs [levelNumber]
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const win = {};
for (const f of ['src/neonlabyrinth_levels.js', 'src/neonlabyrinth.js']) {
  new Function('window', 'globalThis', fs.readFileSync(path.join(root, f), 'utf8'))(win, win);
}
const LEVELS = win.NEON_LABYRINTH_LEVELS;
const { NeonLabyrinthGame } = win;
const { STEP_TIME } = win.__NEON_LABYRINTH_CONST;

const gen = require('./gen-labyrinth.cjs');
const { route } = gen;
if (gen.STEP_TIME !== STEP_TIME) { console.error('STEP_TIME differs between tools/gen-labyrinth.cjs and the engine'); process.exit(1); }

// Drive the real engine along a route (holding each direction until it is taken).
function simulate(index, dirs) {
  const g = new NeonLabyrinthGame(LEVELS);
  g.load(index);
  g.begin();
  let i = 0, frames = 0;
  const dt = 1 / 60;
  while (g.state === 'playing' && frames < 60 * 600) {
    const want = dirs[i];
    g.setHeld(want ? [want] : []);
    const before = `${g.player.r},${g.player.c}`;
    g.update(dt);
    if (`${g.player.r},${g.player.c}` !== before) i++;
    g.drainEvents();
    frames++;
  }
  return { state: g.state, elapsed: g.elapsed, hits: g.hits, timeLeft: g.timeLeft, stars: g.stars };
}

function check(index) {
  const lvl = LEVELS[index];
  const map = lvl.map;
  const errors = [], notes = [];
  const H = map.length, W = map[0].length;
  if (map.some(r => r.length !== W)) errors.push('map is not rectangular');
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const border = r === 0 || c === 0 || r === H - 1 || c === W - 1;
    if (border && map[r][c] !== '#') errors.push(`border open at ${r},${c}`);
    if (!/[# SEtabcABC~hv]/.test(map[r][c])) errors.push(`unknown tile '${map[r][c]}' at ${r},${c}`);
  }
  const count = ch => map.join('').split(ch).length - 1;
  if (count('S') !== 1) errors.push(`expected one S, found ${count('S')}`);
  if (count('E') !== 1) errors.push(`expected one E, found ${count('E')}`);
  for (const d of 'ABC') {
    if (count(d) && !count(d.toLowerCase())) errors.push(`gate ${d} has no keycard`);
    if (count(d.toLowerCase()) && !count(d)) errors.push(`keycard ${d.toLowerCase()} opens nothing`);
  }
  if (!(lvl.par < lvl.time)) errors.push('par must be below the time limit');

  const safe = route(map, { pulses: 'closed' });
  const fast = route(map, { pulses: 'open' });
  if (!safe) errors.push('not solvable with pulse gates closed');
  for (const d of 'ABC') {
    if (count(d) && route(map, { pulses: 'open', wallDoor: d })) errors.push(`gate ${d} can be bypassed`);
  }
  if (errors.length) return { errors, notes };

  const floor = map.join('').replace(/#/g, '').length;
  const safeT = safe.length * STEP_TIME, fastT = fast.length * STEP_TIME;
  const simSafe = simulate(index, safe);
  const simFast = fast.length < safe.length ? simulate(index, fast) : simSafe;
  const best = simFast.elapsed < simSafe.elapsed ? simFast : simSafe;
  if (simSafe.state !== 'won') errors.push(`engine run of the safe route ended '${simSafe.state}'`);
  if (best.elapsed > lvl.par) errors.push(`par ${lvl.par}s not reachable: best engine run takes ${best.elapsed.toFixed(1)}s`);
  // must leave room to explore in the dark, and still apply pressure
  const perCell = floor * STEP_TIME;
  const minTime = safeT * 1.3 + perCell * (lvl.fog ? 0.8 : 0.3) + 3;
  const maxTime = safeT * 1.6 + perCell * (lvl.fog ? 1.5 : 0.7) + 8;
  if (lvl.time < minTime) errors.push(`time ${lvl.time}s too tight (need >= ${minTime.toFixed(0)}s)`);
  if (lvl.time > maxTime) errors.push(`time ${lvl.time}s too generous (want <= ${maxTime.toFixed(0)}s)`);
  if (lvl.par < safeT * 1.1 && lvl.par < fastT * 1.1) notes.push('par is very tight');

  notes.push(`optimal ${safe.length} moves (${safeT.toFixed(1)}s)` + (fast.length < safe.length ? `, ${fast.length} via pulse gates` : '') +
    ` · engine best ${best.elapsed.toFixed(1)}s, ${best.hits} scanner hit(s) · floor ${floor} · time ${lvl.time}s · par ${lvl.par}s`);
  return { errors, notes };
}

const only = process.argv[2] ? [parseInt(process.argv[2], 10) - 1] : LEVELS.map((_, i) => i);
let failed = 0;
for (const i of only) {
  const { errors, notes } = check(i);
  const ok = !errors.length;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  L${i + 1} ${LEVELS[i].name}`);
  for (const n of notes) console.log(`      ${n}`);
  for (const e of errors) console.log(`   !! ${e}`);
}
console.log(failed ? `\n${failed} level(s) failed` : `\nall ${only.length} level(s) passed`);
process.exit(failed ? 1 : 0);
