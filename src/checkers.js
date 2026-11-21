// Checkers core: American/English rules on an 8x8 board.
// - Men move diagonally forward; kings move diagonally both ways.
// - Captures are mandatory and chain into multi-jumps with the same piece.
// - A man that is crowned during a jump ends the turn.
// - Draw after QUIET_LIMIT plies with no capture and no man moved.
//
// `CheckersRules` is a compact, allocation-light rules layer (Int8Array board) shared
// with the AI. `CheckersGame` wraps it with UI-friendly cells ({p,k,id}), events and undo.
(function (global) {
  const SIZE = 8;
  const RED = 1;   // bottom, moves up (row decreasing), positive values in compact boards
  const BLACK = 2; // top, moves down (row increasing), negative values in compact boards
  const QUIET_LIMIT = 80; // 40 moves per side

  // ---------- Compact rules ----------
  // Compact board: Int8Array(64), index = r * 8 + c.
  // +1 red man, +2 red king, -1 black man, -2 black king, 0 empty.
  // A move: { from, to, path: [sq...], caps: [sq...], capVals: [v...], piece, crown }

  function sideSign(player) { return player === RED ? 1 : -1; }
  function inb(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
  function dirsFor(v) {
    if (v === 2 || v === -2) return [-1, 1];
    return v > 0 ? [-1] : [1];
  }
  function crownsAt(v, r) {
    return (v === 1 && r === 0) || (v === -1 && r === SIZE - 1);
  }

  function fromCells(cells) {
    const b = new Int8Array(SIZE * SIZE);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = cells[r][c];
        if (!cell) continue;
        const mag = cell.k ? 2 : 1;
        b[r * SIZE + c] = cell.p === RED ? mag : -mag;
      }
    }
    return b;
  }

  function captureDFS(b, sq, v, orig, path, caps, capVals, out) {
    const r = sq >> 3, c = sq & 7;
    let extended = false;
    for (const dr of dirsFor(v)) {
      for (const dc of [-1, 1]) {
        const r2 = r + 2 * dr, c2 = c + 2 * dc;
        if (!inb(r2, c2)) continue;
        const mid = (r + dr) * SIZE + (c + dc);
        const land = r2 * SIZE + c2;
        const mv = b[mid];
        if (mv * v >= 0 || b[land] !== 0) continue;
        extended = true;
        const crown = crownsAt(v, r2);
        const nv = crown ? 2 * Math.sign(v) : v;
        b[sq] = 0; b[mid] = 0; b[land] = nv;
        path.push(land); caps.push(mid); capVals.push(mv);
        if (crown) record(out, path, caps, capVals, orig, nv);
        else captureDFS(b, land, nv, orig, path, caps, capVals, out);
        path.pop(); caps.pop(); capVals.pop();
        b[land] = 0; b[mid] = mv; b[sq] = v;
      }
    }
    if (!extended && caps.length) record(out, path, caps, capVals, orig, v);
  }

  function record(out, path, caps, capVals, orig, finalV) {
    out.push({
      from: path[0],
      to: path[path.length - 1],
      path: path.slice(),
      caps: caps.slice(),
      capVals: capVals.slice(),
      piece: orig,
      crown: Math.abs(orig) === 1 && Math.abs(finalV) === 2,
    });
  }

  // All legal full-turn moves for `player`. When `chainSq` >= 0, only continuing
  // captures by the piece on that square are legal (mid multi-jump).
  function generate(b, player, chainSq = -1) {
    const sign = sideSign(player);
    const out = [];
    if (chainSq >= 0) {
      const v = b[chainSq];
      if (v * sign > 0) captureDFS(b, chainSq, v, v, [chainSq], [], [], out);
      return out;
    }
    for (let sq = 0; sq < 64; sq++) {
      const v = b[sq];
      if (v * sign > 0) captureDFS(b, sq, v, v, [sq], [], [], out);
    }
    if (out.length) return out;
    for (let sq = 0; sq < 64; sq++) {
      const v = b[sq];
      if (v * sign <= 0) continue;
      const r = sq >> 3, c = sq & 7;
      for (const dr of dirsFor(v)) {
        for (const dc of [-1, 1]) {
          const r1 = r + dr, c1 = c + dc;
          if (!inb(r1, c1)) continue;
          const to = r1 * SIZE + c1;
          if (b[to] !== 0) continue;
          out.push({ from: sq, to, path: [sq, to], caps: [], capVals: [], piece: v, crown: crownsAt(v, r1) });
        }
      }
    }
    return out;
  }

  function apply(b, m) {
    b[m.from] = 0;
    for (const cs of m.caps) b[cs] = 0;
    b[m.to] = m.crown ? 2 * Math.sign(m.piece) : m.piece;
  }

  function undo(b, m) {
    b[m.to] = 0;
    for (let i = 0; i < m.caps.length; i++) b[m.caps[i]] = m.capVals[i];
    b[m.from] = m.piece;
  }

  const CheckersRules = { SIZE, RED, BLACK, QUIET_LIMIT, sideSign, fromCells, generate, apply, undo };

  // ---------- Game wrapper ----------
  const sqOf = (r, c) => r * SIZE + c;
  const rcOf = (sq) => [sq >> 3, sq & 7];

  class CheckersGame {
    constructor() {
      this.size = SIZE;
      this._listeners = new Map();
      this._nextId = 1;
      this.reset();
    }

    on(event, handler) {
      const arr = this._listeners.get(event) || [];
      arr.push(handler);
      this._listeners.set(event, arr);
      return () => this.off(event, handler);
    }
    off(event, handler) {
      const arr = this._listeners.get(event) || [];
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    }
    emit(event, payload) {
      const arr = this._listeners.get(event) || [];
      for (const fn of arr) fn(payload);
    }

    reset() {
      this.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (!isDark(r, c)) continue;
          if (r < 3) this.board[r][c] = { p: BLACK, k: false, id: this._nextId++ };
          else if (r >= SIZE - 3) this.board[r][c] = { p: RED, k: false, id: this._nextId++ };
        }
      }
      this.current = RED;
      this.chain = null;       // [r,c] of piece mid multi-jump, else null
      this.quietPlies = 0;
      this.over = null;        // { winner?, draw?, reason }
      this.history = [];
      this.turnPath = null;    // squares visited by the piece moving this turn
      this.lastMove = null;    // { player, path: [[r,c]...], captured: [[r,c]...] }
      this._turnCaptured = []; // squares captured so far this turn
      this.plies = 0;          // completed turns
      this.emit('update', this.getState());
      this.emit('turn', this.current);
    }

    getState() {
      return {
        size: SIZE,
        board: this.board.map(row => row.map(cloneCell)),
        current: this.current,
        chain: this.chain ? this.chain.slice() : null,
        over: this.over,
        lastMove: this.lastMove,
        turnPath: this.turnPath ? this.turnPath.map(p => p.slice()) : null,
        turnCaptured: this._turnCaptured.map(p => p.slice()),
        quietPlies: this.quietPlies,
        plies: this.plies,
        moveNumber: Math.floor(this.plies / 2) + 1,
        stats: this.pieceStats(),
      };
    }

    inBounds(r, c) { return inb(r, c); }
    pieceAt(r, c) { return inb(r, c) ? this.board[r][c] : null; }

    compact() { return fromCells(this.board); }

    // Full-turn legal moves for the side to move, in [r,c] form.
    legalMoves() {
      if (this.over) return [];
      const chainSq = this.chain ? sqOf(this.chain[0], this.chain[1]) : -1;
      return generate(this.compact(), this.current, chainSq).map(m => ({
        from: rcOf(m.from),
        to: rcOf(m.to),
        path: m.path.map(rcOf),
        captures: m.caps.map(rcOf),
        crown: m.crown,
      }));
    }

    // Next single hops available to the piece at (r,c): [{ to, capture? }]
    validMoves(r, c) {
      const piece = this.pieceAt(r, c);
      if (!piece || piece.p !== this.current) return [];
      const seen = new Set();
      const hops = [];
      for (const m of this.legalMoves()) {
        if (m.from[0] !== r || m.from[1] !== c) continue;
        const [tr, tc] = m.path[1];
        const key = tr * SIZE + tc;
        if (seen.has(key)) continue;
        seen.add(key);
        hops.push(m.captures.length ? { to: [tr, tc], capture: m.captures[0] } : { to: [tr, tc] });
      }
      return hops;
    }

    // Squares of pieces that have at least one legal move this turn.
    movablePieces() {
      const seen = new Set();
      const res = [];
      for (const m of this.legalMoves()) {
        const key = m.from[0] * SIZE + m.from[1];
        if (!seen.has(key)) { seen.add(key); res.push(m.from); }
      }
      return res;
    }

    mustCapture() {
      const moves = this.legalMoves();
      return moves.length > 0 && moves[0].captures.length > 0;
    }

    // Apply one hop. During a multi-jump the same player keeps moving the same piece;
    // the result then has `continues: true`.
    move(from, to) {
      if (this.over) return { ok: false };
      const [r, c] = from;
      const piece = this.pieceAt(r, c);
      if (!piece || piece.p !== this.current) return { ok: false };
      const hop = this.validMoves(r, c).find(m => m.to[0] === to[0] && m.to[1] === to[1]);
      if (!hop) return { ok: false };

      this.history.push(this._snapshot());
      if (!this.chain) { this.turnPath = [[r, c]]; this._turnCaptured = []; }

      const wasMan = !piece.k;
      this.board[to[0]][to[1]] = piece;
      this.board[r][c] = null;
      this.turnPath.push([to[0], to[1]]);

      if (hop.capture) {
        const [cr, cc] = hop.capture;
        const captured = this.board[cr][cc];
        this.board[cr][cc] = null;
        this._turnCaptured.push([cr, cc]);
        this.emit('capture', { at: [cr, cc], piece: cloneCell(captured) });
      }

      let crowned = false;
      if (wasMan && crownsAt(piece.p === RED ? 1 : -1, to[0])) {
        piece.k = true;
        crowned = true;
      }

      // Multi-jump continuation
      if (hop.capture && !crowned) {
        const more = generate(this.compact(), this.current, sqOf(to[0], to[1]));
        if (more.length) {
          this.chain = [to[0], to[1]];
          this.emit('move', { from, to, capture: true, crowned, continues: true, current: this.current });
          this.emit('update', this.getState());
          return { ok: true, continues: true };
        }
      }

      // End of turn
      const mover = this.current;
      this.chain = null;
      this.quietPlies = (this._turnCaptured.length > 0 || wasMan) ? 0 : this.quietPlies + 1;
      this.lastMove = { player: mover, path: this.turnPath, captured: this._turnCaptured };
      this.turnPath = null;
      this._turnCaptured = [];
      this.plies++;
      this.current = mover === RED ? BLACK : RED;
      this.over = this._checkEnd(mover);

      this.emit('move', { from, to, capture: !!hop.capture, crowned, continues: false, current: this.current });
      this.emit('update', this.getState());
      this.emit('turn', this.current);
      if (this.over) {
        if (this.over.draw) this.emit('draw', this.over);
        else this.emit('win', this.over);
      }
      return { ok: true, continues: false };
    }

    _checkEnd(mover) {
      const counts = this.countPieces();
      if (counts[this.current] === 0) return { winner: mover, reason: 'noPieces', counts };
      if (!this.hasAnyMove(this.current)) return { winner: mover, reason: 'noMoves', counts };
      if (this.quietPlies >= QUIET_LIMIT) return { draw: true, reason: 'quiet', counts };
      return null;
    }

    _snapshot() {
      return {
        board: this.board.map(row => row.map(cloneCell)),
        current: this.current,
        chain: this.chain ? this.chain.slice() : null,
        quietPlies: this.quietPlies,
        over: this.over,
        turnPath: this.turnPath ? this.turnPath.map(p => p.slice()) : null,
        lastMove: this.lastMove,
        turnCaptured: this._turnCaptured.map(p => p.slice()),
        plies: this.plies,
      };
    }

    // Undo the last hop. Returns false when there is nothing to undo.
    undo() {
      const s = this.history.pop();
      if (!s) return false;
      this._restore(s);
      this.emit('update', this.getState());
      this.emit('turn', this.current);
      return true;
    }

    // Undo up to `n` whole turns (a partial multi-jump counts as one). Emits once.
    // Returns the number of turns undone.
    undoTurns(n = 1) {
      let done = 0;
      while (done < n && this.history.length) {
        do { this._restore(this.history.pop()); } while (this.chain && this.history.length);
        done++;
      }
      if (done) {
        this.emit('update', this.getState());
        this.emit('turn', this.current);
      }
      return done;
    }

    canUndo() { return this.history.length > 0; }

    // True if `player` has made at least one hop that is still in the undo history.
    hasMovedInHistory(player) { return this.history.some(s => s.current === player); }

    _restore(s) {
      this.board = s.board;
      this.current = s.current;
      this.chain = s.chain;
      this.quietPlies = s.quietPlies;
      this.over = s.over;
      this.turnPath = s.turnPath;
      this.lastMove = s.lastMove;
      this._turnCaptured = s.turnCaptured;
      this.plies = s.plies;
    }

    // { 1: { total, kings }, 2: { total, kings } }
    pieceStats() {
      const st = { 1: { total: 0, kings: 0 }, 2: { total: 0, kings: 0 } };
      for (const row of this.board) {
        for (const cell of row) {
          if (!cell) continue;
          st[cell.p].total++;
          if (cell.k) st[cell.p].kings++;
        }
      }
      return st;
    }

    countPieces() {
      let c1 = 0, c2 = 0;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const cell = this.board[r][c];
          if (!cell) continue;
          if (cell.p === RED) c1++; else c2++;
        }
      }
      return { 1: c1, 2: c2 };
    }

    hasAnyCapture(player = this.current) {
      const moves = generate(this.compact(), player);
      return moves.length > 0 && moves[0].caps.length > 0;
    }

    hasAnyMove(player = this.current) {
      return generate(this.compact(), player).length > 0;
    }
  }

  function isDark(r, c) { return (r + c) % 2 === 1; }
  function cloneCell(cell) { return cell ? { p: cell.p, k: !!cell.k, id: cell.id } : null; }

  global.CheckersRules = CheckersRules;
  global.CheckersGame = CheckersGame;
})(window);
