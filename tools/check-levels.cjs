#!/usr/bin/env node
// Backspace level checker. Runs the real engine headlessly and verifies, per level:
//   1. reachable   - the goal can be reached when every door is forced open
//   2. needs echo  - the goal can NOT be reached without rewinding (no bypass)
//   3. solution    - the level's scripted solution wins (echoes simulated for real)
// Usage: node tools/check-levels.cjs [levelNumber] [--strict]   (VERBOSE=1 for timings)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ['src/backspace_levels.js', 'src/backspace.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const { BackspaceGame, BACKSPACE_LEVELS } = ctx.window;
const C = ctx.window.__BACKSPACE_CONST;
const TILE = C.TILE;

const ACTIONS = [];
for (const h of [-1, 0, 1]) for (const j of [false, true]) ACTIONS.push({ left: h < 0, right: h > 0, jump: j });
const MAX_NODES = 1500000;

function makeGame(i, mutate) {
  const g = new BackspaceGame(i);
  if (mutate) { g.level.grid = g.level.grid.map(r => r.map(mutate)); g.reset(); }
  return g;
}

// Breadth-first search over inputs from the game's current state until `done(game)`.
// Returns the list of inputs, or null. Echo playback is part of the simulated state.
// Coarse key (default): merges states within ~1px. Paths stay exact because every
// node keeps its real snapshot, but a pixel-perfect trick could be missed.
// Pass --strict to use the exact key for the reachability/bypass proofs (slow).
function coarseKey(g) {
  const p = g.player;
  return [Math.round(p.x), Math.round(p.y), Math.round(p.vy * 2), p.onGround ? 1 : 0,
    Math.min(g.framesSinceGrounded, 7), g.jumpBuffer > 0 ? 1 : 0, g.jumpHeld ? 1 : 0,
    g.power.a ? 1 : 0, g.power.b ? 1 : 0, g.power.c ? 1 : 0, g.riding || 0, g.timerKey ? g.timerKey() : ''].join();
}
// Keys are built here rather than via game.stateKey(): calling into the vm
// context per state is ~100x slower.
function fineKey(g) {
  const p = g.player;
  return [Math.round(p.x * 2), Math.round(p.y * 2), Math.round(p.vy * 10), p.onGround ? 1 : 0,
    Math.min(g.framesSinceGrounded, 7), g.jumpBuffer, g.jumpHeld ? 1 : 0,
    g.power.a ? 1 : 0, g.power.b ? 1 : 0, g.power.c ? 1 : 0, g.riding || 0, g.timerKey ? g.timerKey() : ''].join();
}

const STRICT = process.argv.includes('--strict');
const proofKey = STRICT ? fineKey : coarseKey;

function search(game, done, maxFrames = 2400, keyFn = proofKey) {
  const start = game.snapshot();
  const keepHistory = game.history;
  const nodes = [{ s: start, parent: -1, a: null }];
  const seen = new Set([keyFn(game)]);
  let frontier = [0], depth = 0, found = -1;
  outer: while (frontier.length && depth < maxFrames) {
    const next = [];
    for (const ni of frontier) {
      for (const a of ACTIONS) {
        game.restore(nodes[ni].s); game.history = [];
        game.step(a);
        if (done(game)) { nodes.push({ s: null, parent: ni, a }); found = nodes.length - 1; break outer; }
        if (game.dead) continue;
        const k = keyFn(game);
        if (seen.has(k)) continue;
        seen.add(k);
        nodes.push({ s: game.snapshot(), parent: ni, a });
        next.push(nodes.length - 1);
        if (nodes.length > MAX_NODES) break outer;
      }
    }
    frontier = next; depth++;
  }
  game.restore(start); game.history = keepHistory;
  if (found < 0) return { inputs: null, explored: nodes.length };
  const inputs = [];
  for (let i = found; i > 0; i = nodes[i].parent) inputs.push(nodes[i].a);
  return { inputs: inputs.reverse(), explored: nodes.length };
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
  const isSwitch = c => /[a-cS1-3]/.test(c);
  const T0 = Date.now(); const lap = l => process.env.VERBOSE && console.log(`   ${l} ${Date.now() - T0}ms`);
  const open = search(makeGame(i, c => isDoor(c) ? '.' : c), g => g.win);
  lap('open');
  const solo = search(makeGame(i), g => g.win);
  lap('solo');
  const sol = runSolution(i);
  lap('solution');
  const problems = [];
  if (!open.inputs) problems.push('goal unreachable even with all doors open');
  if (solo.inputs) problems.push(`beatable without rewinding (${solo.inputs.length} frames) - mechanic bypass`);
  if (!sol.ok) problems.push('solution: ' + sol.msg);
  if (sol.ok && def.echoes != null && sol.echoes > def.echoes) problems.push(`solution uses ${sol.echoes} echoes, limit is ${def.echoes}`);
  void isSwitch;
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
