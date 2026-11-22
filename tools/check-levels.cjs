#!/usr/bin/env node
// Backspace level checker. Runs the real engine headlessly and verifies, per level:
//   1. solution    - the level's scripted solution wins (echoes simulated for real),
//                    within the level's echo limit
//   2. needs echo  - the goal can NOT be reached without rewinding (no bypass)
// Usage: node tools/check-levels.cjs [levelNumber] [--strict] [--write-demos]   (VERBOSE=1 for timings)
//   --write-demos  also records each solution as an input tape in src/backspace_demos.js
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
    g.power.a ? 1 : 0, g.power.b ? 1 : 0, g.power.c ? 1 : 0, g.riding || 0, g.timerKey(), echoClock(g)].join();
}
function fineKey(g) {
  const p = g.player;
  return [Math.round(p.x * 2), Math.round(p.y * 2), Math.round(p.vx * 10), Math.round(p.vy * 10), p.onGround ? 1 : 0, g.jumpRising ? 1 : 0,
    Math.min(g.framesSinceGrounded, 7), g.jumpBuffer, g.jumpHeld ? 1 : 0,
    g.power.a ? 1 : 0, g.power.b ? 1 : 0, g.power.c ? 1 : 0, g.riding || 0, g.timerKey(), echoClock(g)].join();
}

// While echoes are moving, *when* you are somewhere matters (waiting for an
// echo is a real strategy), so add a coarse clock to the key.
function echoClock(g) { return g.activeEchoes() ? Math.floor(g.T / 8) : ''; }

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

// Weighted A* toward a point: much faster than BFS for scripted solution steps.
function seek(game, done, target, maxFrames = 2400) {
  const start = game.snapshot();
  const keepHistory = game.history;
  const h = g => Math.abs(g.player.x - target[0]) + Math.abs(g.player.y - target[1]);
  const nodes = [{ s: start, parent: -1, a: null, n: 0, d: 0 }];
  const heap = new Heap();
  heap.push(h(game), 0);
  const seen = new Set([coarseKey(game)]);
  let found = -1;
  while (heap.size && nodes.length < MAX_NODES) {
    const ni = heap.pop(), node = nodes[ni];
    if (node.d * HOLD >= maxFrames) continue;
    for (const a of ACTIONS) {
      game.restore(node.s); game.history = [];
      let hit = 0;
      for (let f = 1; f <= HOLD; f++) { game.step(a); if (done(game)) { hit = f; break; } if (game.dead) break; }
      if (hit) { nodes.push({ s: null, parent: ni, a, n: hit }); found = nodes.length - 1; break; }
      if (game.dead) continue;
      const k = coarseKey(game);
      if (seen.has(k)) continue;
      seen.add(k);
      nodes.push({ s: game.snapshot(), parent: ni, a, n: HOLD, d: node.d + 1 });
      heap.push(h(game) + (node.d + 1) * 6 + (a !== node.a ? 3 : 0), nodes.length - 1);
    }
    if (found >= 0) break;
  }
  game.restore(start); game.history = keepHistory;
  if (found < 0) return { inputs: null };
  const chunks = [];
  for (let i = found; i > 0; i = nodes[i].parent) chunks.push(nodes[i]);
  const inputs = [];
  for (const c of chunks.reverse()) for (let f = 0; f < c.n; f++) inputs.push(c.a);
  return { inputs };
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.v.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = v.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop();
    if (v.length) {
      k[0] = lk; v[0] = lv; let i = 0;
      for (;;) { const l = 2*i+1, r = l+1; let m = i;
        if (l < v.length && k[l] < k[m]) m = l; if (r < v.length && k[r] < k[m]) m = r;
        if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; }
    }
    return top;
  }
}

function feetTile(g) { return [Math.floor(g.player.x / TILE), Math.floor(g.player.y / TILE)]; }
const IDLE = { left: false, right: false, jump: false };

// Default demo captions per step type (levels can override with `say`)
function defaultSay(step) {
  if (step.to) return 'Move';
  if (step.ride) return 'Jump onto your echo';
  if (step.wait) return 'Wait here - your echo will copy this';
  if (step.rewind) return 'Hold Backspace to rewind';
  if (step.undo) return 'Press U to undo the last echo';
  return '';
}

function runSolution(i) {
  const def = BACKSPACE_LEVELS[i];
  const g = makeGame(i);
  const log = [];
  // Every input is recorded so the solution can be replayed as an in-game demo
  const tape = [], captions = [];
  const play = a => { tape.push((a.left ? 1 : 0) | (a.right ? 2 : 0) | (a.jump ? 4 : 0) | (a.rewind ? 8 : 0)); g.step(a); };
  for (const step of def.solution || []) {
    if (g.win) break;
    const say = step.say != null ? step.say : defaultSay(step);
    if (say) captions.push({ f: tape.length, text: say });
    if (step.to) {
      const [tx, ty] = step.to;
      const r = seek(g, gg => gg.win || (gg.player.onGround && feetTile(gg)[0] === tx && feetTile(gg)[1] === ty), [tx * TILE + TILE / 2, ty * TILE + TILE - 1]);
      if (!r.inputs) return { ok: false, msg: `cannot reach ${step.to} (step ${log.length + 1})` };
      for (const a of r.inputs) play(a);
    } else if (step.ride) {
      // stand on top of echo #step.ride
      const e = g.echoes.find(x => x.id === step.ride), es = e && g.echoAt(e, g.T);
      const r = es && seek(g, gg => gg.win || (gg.player.onGround && gg.riding === step.ride), [es.x, es.y - 22]);
      if (!r) return { ok: false, msg: `echo ${step.ride} is not present (step ${log.length + 1})` };
      if (!r.inputs) return { ok: false, msg: `cannot stand on echo ${step.ride} (step ${log.length + 1})` };
      for (const a of r.inputs) play(a);
    } else if (step.wait) {
      for (let k = 0; k < step.wait && !g.win; k++) play(IDLE);
    } else if (step.undo) {
      g.undoEcho();
    } else if (step.rewind) {
      // Hold rewind like a player would (scrub runs at 3 frames per frame), then release
      const before = g.echoes.length;
      for (let k = 0; k < Math.ceil(step.rewind / 3); k++) play({ ...IDLE, rewind: true });
      play(IDLE);
      if (g.echoes.length !== before + 1) return { ok: false, msg: `rewind failed (step ${log.length + 1})` };
    }
    log.push(step);
  }
  // g.frame includes the time spent holding rewind, like the in-game timer
  return g.win
    ? { ok: true, frames: g.frame, echoes: g.ghostsUsed, playFrames: g.frame, tape, captions }
    : { ok: false, msg: 'solution finished without reaching the goal' };
}

function checkLevel(i) {
  const def = BACKSPACE_LEVELS[i];
  const T0 = Date.now(); const lap = l => process.env.VERBOSE && console.log(`   ${l} ${Date.now() - T0}ms`);
  const solo = search(makeGame(i), g => g.win);
  lap('solo');
  const sol = runSolution(i);
  lap('solution');
  const problems = [];
  if (!solo.inputs && solo.capped) problems.push('bypass search ran out of budget (inconclusive)');
  if (solo.inputs) problems.push(`beatable without rewinding (${solo.inputs.length} frames) - mechanic bypass`);
  if (!sol.ok) problems.push('solution: ' + sol.msg);
  if (sol.ok && def.echoes != null && sol.echoes > def.echoes) problems.push(`solution uses ${sol.echoes} echoes, limit is ${def.echoes}`);
  if (sol.ok && def.par && def.par.time != null && sol.playFrames / 60 > def.par.time) problems.push(`par time ${def.par.time}s is below the scripted solution (${(sol.playFrames / 60).toFixed(1)}s incl. scrubbing)`);
  if (sol.ok && def.par && def.par.echoes != null && sol.echoes > def.par.echoes) problems.push(`par echoes ${def.par.echoes} is below the solution's ${sol.echoes}`);
  return { def, solo, sol, problems };
}

// Input tape as one hex digit per frame (bits: 1 left, 2 right, 4 jump, 8 rewind)
function encodeTape(tape) { return tape.map(m => m.toString(16)).join(''); }
const demos = {};
const WRITE_DEMOS = process.argv.includes('--write-demos');

const numArg = process.argv.slice(2).find(a => /^\d+$/.test(a));
const only = numArg ? Number(numArg) - 1 : null;
let failed = 0;
BACKSPACE_LEVELS.forEach((def, i) => {
  if (only != null && i !== only) return;
  const r = checkLevel(i);
  const ok = r.problems.length === 0;
  if (!ok) failed++;
  const info = r.sol.ok ? `solved in ${(r.sol.frames / 60).toFixed(1)}s, ${r.sol.echoes} echo(es), par ${def.par ? def.par.time + 's' : '-'}` : '';
  if (r.sol.ok) demos[def.name] = { tape: encodeTape(r.sol.tape), captions: r.sol.captions, frames: r.sol.tape.length };
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. ${def.name.padEnd(22)} ${info}`);
  for (const p of r.problems) console.log(`        - ${p}`);
});
if (WRITE_DEMOS) {
  if (failed || only != null) console.log('\nNot writing demos: run all levels and fix failures first.');
  else {
    const body = '// Generated by `npm run demos` (tools/check-levels.cjs --write-demos). Do not edit.\n' +
      '// In-game demos: each level\'s verified solution as a recorded input tape.\n' +
      '(function(global){\n  global.BACKSPACE_DEMOS = ' + JSON.stringify(demos) + ';\n})(typeof window !== \'undefined\' ? window : globalThis);\n';
    fs.writeFileSync(path.join(root, 'src/backspace_demos.js'), body);
    console.log('\nWrote src/backspace_demos.js');
  }
}
console.log(failed ? `\n${failed} level(s) failed` : '\nAll levels OK');
process.exit(failed ? 1 : 0);
