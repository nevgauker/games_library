#!/usr/bin/env node
// Backspace level checker. Runs the real engine headlessly and verifies, per level:
//   1. reachable   - the goal can be reached when every door is forced open
//   2. needs echo  - the goal can NOT be reached without rewinding (no bypass)
//   3. solution    - the level's scripted solution wins (echoes simulated for real)
// Usage: node tools/check-levels.cjs [levelNumber] [--strict]   (VERBOSE=1 for timings)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
// Load the browser scripts into this realm (a vm sandbox makes every global
// lookup such as Math.floor ~30x slower, which dominates the search).
const win = {};
for (const f of ['src/backspace_levels.js', 'src/backspace.js']) {
  new Function('window', fs.readFileSync(path.join(root, f), 'utf8') + `
//# sourceURL=${f}`)(win);
}
const { BackspaceGame, BACKSPACE_LEVELS } = win;
const C = win.__BACKSPACE_CONST;
const TILE = C.TILE;

const ACTIONS = [];
for (const h of [-1, 0, 1]) for (const j of [false, true]) ACTIONS.push({ left: h < 0, right: h > 0, jump: j });
const MAX_NODES = 1500000;
// Inputs are chosen every HOLD frames (~67 ms) - finer than any human needs and
// it keeps the search space manageable.
const HOLD = 4;

function makeGame(i, mutate) {
  const g = new BackspaceGame(i);
  if (mutate) { g.level.grid = g.level.grid.map(r => r.map(mutate)); g.reset(); }
  return g;
}

// Coarse key (default): merges states within ~3px. Paths stay exact because every
// node keeps its real snapshot, but a pixel-perfect trick could be missed.
// Pass --strict to use the exact key for the reachability/bypass proofs (slow).
function coarseKey(g) {
  const p = g.player;
  const air = !p.onGround;
  return [Math.round(p.x / 3), Math.round(p.y / 3), Math.round(p.vx), air ? Math.round(p.vy / 1.5) : 0, air ? 1 : 0,
    air && g.jumpRising ? 1 : 0, air ? Math.min(g.framesSinceGrounded, 7) : 0, g.jumpHeld ? 1 : 0,
    g.power.a ? 1 : 0, g.power.b ? 1 : 0, g.power.c ? 1 : 0, g.riding || 0, g.timerKey ? g.timerKey() : ''].join();
}
function fineKey(g) {
  const p = g.player;
  return [Math.round(p.x * 2), Math.round(p.y * 2), Math.round(p.vx * 10), Math.round(p.vy * 10), p.onGround ? 1 : 0, g.jumpRising ? 1 : 0,
    Math.min(g.framesSinceGrounded, 7), g.jumpBuffer, g.jumpHeld ? 1 : 0,
    g.power.a ? 1 : 0, g.power.b ? 1 : 0, g.power.c ? 1 : 0, g.riding || 0, g.timerKey ? g.timerKey() : ''].join();
}

const STRICT = process.argv.includes('--strict');
const proofKey = STRICT ? fineKey : coarseKey;

// Breadth-first search over inputs from the game's current state until `done(game)`.
// Returns per-frame inputs, or null. Echo playback is part of the simulated state.
// `capped` means the node budget ran out, so "not found" proves nothing.
function search(game, done, maxFrames = 2400, keyFn = proofKey) {
  const start = game.snapshot();
  const keepHistory = game.history;
  const nodes = [{ s: start, parent: -1, a: null }];
  const seen = new Set([keyFn(game)]);
  let frontier = [0], depth = 0, found = -1;
  let capped = false;
  outer: while (frontier.length && depth * HOLD < maxFrames) {
    const next = [];
    for (const ni of frontier) {
      for (const a of ACTIONS) {
        game.restore(nodes[ni].s); game.history = [];
        let hit = 0;
        for (let f = 1; f <= HOLD; f++) { game.step(a); if (done(game)) { hit = f; break; } if (game.dead) break; }
        if (hit) { nodes.push({ s: null, parent: ni, a, n: hit }); found = nodes.length - 1; break outer; }
        if (game.dead) continue;
        const k = keyFn(game);
        if (seen.has(k)) continue;
        seen.add(k);
        nodes.push({ s: game.snapshot(), parent: ni, a, n: HOLD });
        next.push(nodes.length - 1);
        if (nodes.length > MAX_NODES) { capped = true; break outer; }
      }
    }
    frontier = next; depth++;
  }
  game.restore(start); game.history = keepHistory;
  if (found < 0) return { inputs: null, explored: nodes.length, capped };
  const chunks = [];
  for (let i = found; i > 0; i = nodes[i].parent) chunks.push(nodes[i]);
  const inputs = [];
  for (const c of chunks.reverse()) for (let f = 0; f < c.n; f++) inputs.push(c.a);
  return { inputs, explored: nodes.length, capped };
}

function feetTile(g) { return [Math.floor(g.player.x / TILE), Math.floor(g.player.y / TILE)]; }
const IDLE = { left: false, right: false, jump: false };

function runSolution(i) {
  const def = BACKSPACE_LEVELS[i];
  const g = makeGame(i);
  const log = [];
  for (const step of def.solution || []) {
    if (g.win) break;
    if (step.to) {
      const [tx, ty] = step.to;
      const r = search(g, gg => gg.win || (gg.player.onGround && feetTile(gg)[0] === tx && feetTile(gg)[1] === ty), 2400, coarseKey);
      if (!r.inputs) return { ok: false, msg: `cannot reach ${step.to} (step ${log.length + 1})` };
      for (const a of r.inputs) g.step(a);
    } else if (step.wait) {
      for (let k = 0; k < step.wait && !g.win; k++) g.step(IDLE);
    } else if (step.undo) {
      g.undoEcho();
    } else if (step.rewind) {
      if (!g.rewind(step.rewind)) return { ok: false, msg: `rewind failed (step ${log.length + 1})` };
    }
    log.push(step);
  }
  return g.win
    ? { ok: true, frames: g.frame, echoes: g.ghostsUsed }
    : { ok: false, msg: 'solution finished without reaching the goal' };
}

function checkLevel(i) {
  const def = BACKSPACE_LEVELS[i];
  const isDoor = c => /[A-CD]/.test(c);
  const T0 = Date.now(); const lap = l => process.env.VERBOSE && console.log(`   ${l} ${Date.now() - T0}ms`);
  const open = search(makeGame(i, c => isDoor(c) ? '.' : c), g => g.win);
  lap('open');
  const solo = search(makeGame(i), g => g.win);
  lap('solo');
  const sol = runSolution(i);
  lap('solution');
  const problems = [];
  if (!open.inputs) problems.push(open.capped ? 'search budget ran out (inconclusive)' : 'goal unreachable even with all doors open');
  if (!solo.inputs && solo.capped) problems.push('bypass search ran out of budget (inconclusive)');
  if (solo.inputs) problems.push(`beatable without rewinding (${solo.inputs.length} frames) - mechanic bypass`);
  if (!sol.ok) problems.push('solution: ' + sol.msg);
  if (sol.ok && def.echoes != null && sol.echoes > def.echoes) problems.push(`solution uses ${sol.echoes} echoes, limit is ${def.echoes}`);
  return { def, open, solo, sol, problems };
}

const numArg = process.argv.slice(2).find(a => /^\d+$/.test(a));
const only = numArg ? Number(numArg) - 1 : null;
let failed = 0;
BACKSPACE_LEVELS.forEach((def, i) => {
  if (only != null && i !== only) return;
  const r = checkLevel(i);
  const ok = r.problems.length === 0;
  if (!ok) failed++;
  const info = r.sol.ok ? `solved in ${r.sol.frames}f (${(r.sol.frames / 60).toFixed(1)}s), ${r.sol.echoes} echo(es)` : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. ${def.name.padEnd(22)} ${info}`);
  for (const p of r.problems) console.log(`        - ${p}`);
});
console.log(failed ? `\n${failed} level(s) failed` : '\nAll levels OK');
process.exit(failed ? 1 : 0);
