// Checkers AI: iterative-deepening negamax with alpha-beta pruning and a capture
// extension, built on the compact CheckersRules layer from checkers.js.
(function (global) {
  const R = global.CheckersRules;
  const WIN = 100000;
  const MAX_EXTENSION = 8; // extra plies allowed while captures are pending
  const TIMEOUT = {};

  // depth: max search plies; mistake: chance of picking a random move from the better half;
  // timeMs: search budget (depth 1 always completes).
  const LEVELS = {
    1: { name: 'Beginner', depth: 1, mistake: 0.5, timeMs: 50 },
    2: { name: 'Casual', depth: 2, mistake: 0.3, timeMs: 100 },
    3: { name: 'Club', depth: 4, mistake: 0.12, timeMs: 250 },
    4: { name: 'Strong', depth: 6, mistake: 0.04, timeMs: 450 },
    5: { name: 'Expert', depth: 12, mistake: 0, timeMs: 800 },
  };

  let nodes = 0;
  let deadline = Infinity;

  function now() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  // Static evaluation, from Red's point of view.
  function evaluateRed(b) {
    let score = 0;
    let redMat = 0, blackMat = 0, total = 0;
    const redKings = [], blackKings = [], redAll = [], blackAll = [];
    for (let sq = 0; sq < 64; sq++) {
      const v = b[sq];
      if (!v) continue;
      total++;
      const r = sq >> 3, c = sq & 7;
      const central = r >= 2 && r <= 5 && c >= 2 && c <= 5 ? 4 : 0;
      if (v === 1) {
        redMat += 100;
        score += 2 * (7 - r) + (r === 7 ? 6 : 0) + central;
        redAll.push(sq);
      } else if (v === 2) {
        redMat += 160;
        score += central;
        redKings.push(sq); redAll.push(sq);
      } else if (v === -1) {
        blackMat += 100;
        score -= 2 * r + (r === 0 ? 6 : 0) + central;
        blackAll.push(sq);
      } else {
        blackMat += 160;
        score -= central;
        blackKings.push(sq); blackAll.push(sq);
      }
    }
    const material = redMat - blackMat;
    score += material;
    if (material !== 0) {
      const ahead = Math.sign(material);
      // Trade down when ahead.
      score += ahead * (24 - total) * 3;
      // In the endgame, the stronger side's kings close in on enemy pieces.
      if (total <= 10) {
        const hunters = ahead > 0 ? redKings : blackKings;
        const prey = ahead > 0 ? blackAll : redAll;
        let dist = 0;
        for (const k of hunters) {
          let best = 14;
          for (const p of prey) {
            const d = Math.max(Math.abs((k >> 3) - (p >> 3)), Math.abs((k & 7) - (p & 7)));
            if (d < best) best = d;
          }
          dist += best;
        }
        score -= ahead * dist * 3;
      }
    }
    return score;
  }

  function orderMoves(moves) {
    if (moves.length < 2) return moves;
    return moves.sort((a, b) => (b.caps.length - a.caps.length) || ((b.crown ? 1 : 0) - (a.crown ? 1 : 0)));
  }

  function negamax(b, player, depth, alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && now() > deadline) throw TIMEOUT;
    const moves = R.generate(b, player);
    if (!moves.length) return -WIN + ply;
    const capturing = moves[0].caps.length > 0;
    if (depth <= 0 && (!capturing || depth <= -MAX_EXTENSION)) {
      const e = evaluateRed(b);
      return player === R.RED ? e : -e;
    }
    orderMoves(moves);
    const opp = player === R.RED ? R.BLACK : R.RED;
    let best = -Infinity;
    for (const m of moves) {
      R.apply(b, m);
      const v = -negamax(b, opp, depth - 1, -beta, -alpha, ply + 1);
      R.undo(b, m);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Scores every root move at `depth`. Ties with the best move get exact scores
  // (window starts at best - 1) so we can choose randomly among equals.
  function searchRoot(b, player, moves, depth) {
    const opp = player === R.RED ? R.BLACK : R.RED;
    let best = -Infinity;
    const scored = [];
    for (const m of moves) {
      R.apply(b, m);
      let s;
      try {
        s = -negamax(b, opp, depth - 1, -Infinity, -(best - 1), 1);
      } finally {
        R.undo(b, m);
      }
      if (s > best) best = s;
      scored.push({ m, s });
    }
    scored.sort((a, c) => c.s - a.s);
    return scored;
  }

  // cells: game board ([r][c] of {p,k} | null). Returns a compact move
  // ({ from, to, path, caps, ... } with square indices) or null when there is none.
  function chooseMove(cells, player, level, chainSq = -1) {
    const cfg = LEVELS[level] || LEVELS[3];
    const b = R.fromCells(cells);
    let moves = R.generate(b, player, chainSq);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];

    let scored = null;
    nodes = 0;
    const budgetEnd = now() + cfg.timeMs;
    for (let d = 1; d <= cfg.depth; d++) {
      deadline = d === 1 ? Infinity : budgetEnd;
      try {
        scored = searchRoot(b, player, moves, d);
      } catch (e) {
        if (e !== TIMEOUT) throw e;
        break;
      }
      moves = scored.map(x => x.m); // best-first ordering for the next iteration
      if (Math.abs(scored[0].s) > WIN - 1000) break; // forced win/loss found
      if (now() > budgetEnd) break;
    }
    deadline = Infinity;

    if (cfg.mistake > 0 && Math.random() < cfg.mistake) {
      const half = Math.max(1, Math.ceil(scored.length / 2));
      return scored[Math.floor(Math.random() * half)].m;
    }
    const top = scored[0].s;
    const ties = scored.filter(x => x.s === top);
    return ties[Math.floor(Math.random() * ties.length)].m;
  }

  global.CheckersAI = { LEVELS, chooseMove, evaluateRed };
})(window);
