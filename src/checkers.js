// Minimal two-player Checkers core (no multi-jumps, no kings; simple and extendable)
(function (global) {
  class CheckersGame {
    constructor() {
      this.size = 8;
      this.current = 1; // 1 = Red (bottom), 2 = Black (top)
      this.board = this._makeBoard();
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

    _makeBoard() {
      return Array.from({ length: this.size }, () => Array(this.size).fill(null));
    }

    reset() {
      this.board = this._makeBoard();
      // Place Black (player 2) at top rows 0..2 on dark squares
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < this.size; c++) {
          if (isDark(r, c)) this.board[r][c] = { p: 2, k: false, id: this._nextId++ };
        }
      }
      // Place Red (player 1) at bottom rows 5..7 on dark squares
      for (let r = this.size - 3; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          if (isDark(r, c)) this.board[r][c] = { p: 1, k: false, id: this._nextId++ };
        }
      }
      this.current = 1;
      this.emit('update', this.getState());
      this.emit('turn', this.current);
    }

    getState() {
      return { size: this.size, board: this.board.map(row => row.map(cloneCell)), current: this.current };
    }

    inBounds(r, c) {
      return r >= 0 && r < this.size && c >= 0 && c < this.size;
    }

    pieceAt(r, c) {
      if (!this.inBounds(r, c)) return null;
      return this.board[r][c];
    }

    // Returns list of valid moves for piece at (r,c)
    // Rules: forward diagonals (or both for kings); capture by jumping over into empty
    // Forced capture: if any capture exists for current player, only captures are allowed
    validMoves(r, c) {
      const piece = this.pieceAt(r, c);
      if (!piece) return [];
      if (piece.p !== this.current) return [];
      const directions = piece.k ? [-1, 1] : [piece.p === 1 ? -1 : 1];
      const moves = [];

      const tryStep = (dr, dc) => {
        const r1 = r + dr, c1 = c + dc;
        if (!this.inBounds(r1, c1)) return;
        if (!this.board[r1][c1]) {
          moves.push({ to: [r1, c1] });
        }
      };

      const tryJump = (dr, dc) => {
        const r1 = r + dr, c1 = c + dc;
        const r2 = r + 2 * dr, c2 = c + 2 * dc;
        if (!this.inBounds(r2, c2)) return;
        const mid = this.board[r1][c1];
        if (mid && mid.p !== piece.p && !this.board[r2][c2]) {
          moves.push({ to: [r2, c2], capture: [r1, c1] });
        }
      };

      // diagonals based on directions
      for (const dir of directions) {
        tryStep(dir, -1);
        tryStep(dir, 1);
        tryJump(dir, -1);
        tryJump(dir, 1);
      }

      // Enforce forced capture globally for current player
      const capturing = this.hasAnyCapture(this.current);
      if (capturing) return moves.filter(m => !!m.capture);
      return moves;
    }

    move(from, to) {
      const [r, c] = from;
      const piece = this.pieceAt(r, c);
      if (!piece || piece.p !== this.current) return { ok: false };
      const options = this.validMoves(r, c);
      const match = options.find(m => m.to[0] === to[0] && m.to[1] === to[1]);
      if (!match) return { ok: false };

      // apply move
      this.board[to[0]][to[1]] = piece;
      this.board[r][c] = null;
      if (match.capture) {
        const [cr, cc] = match.capture;
        const captured = this.board[cr][cc];
        this.board[cr][cc] = null;
        this.emit('capture', { at: [cr, cc], piece: captured ? { p: captured.p, k: !!captured.k, id: captured.id } : null });
      }
      // kinging
      if (!piece.k) {
        if (piece.p === 1 && to[0] === 0) piece.k = true; // Red reaches top
        if (piece.p === 2 && to[0] === this.size - 1) piece.k = true; // Black reaches bottom
      }
      // Switch turn
      this.current = this.current === 1 ? 2 : 1;
      this.emit('move', { from, to, capture: !!match.capture, current: this.current });
      this.emit('update', this.getState());
      this.emit('turn', this.current);

      // Check win condition: if one player has no pieces
      const counts = this.countPieces();
      if (counts[1] === 0 || counts[2] === 0) {
        // winner is the player who just moved (opposite of current after switch)
        const winner = this.current === 1 ? 2 : 1;
        this.emit('win', { winner, counts });
        return { ok: true };
      }

      // Stalemate detection: current player has no legal moves
      if (!this.hasAnyMove(this.current)) {
        const winner = this.current === 1 ? 2 : 1;
        this.emit('win', { winner, reason: 'noMoves' });
      }
      return { ok: true };
    }

    countPieces() {
      let c1 = 0, c2 = 0;
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          const cell = this.board[r][c];
          if (!cell) continue;
          if (cell.p === 1) c1++; else if (cell.p === 2) c2++;
        }
      }
      return { 1: c1, 2: c2 };
    }

    hasAnyCapture(player = this.current) {
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          const piece = this.board[r][c];
          if (!piece || piece.p !== player) continue;
          const dirs = piece.k ? [-1, 1] : [piece.p === 1 ? -1 : 1];
          for (const dir of dirs) {
            const r1 = r + dir, c1a = c - 1, c1b = c + 1;
            const r2a = r + 2 * dir, r2b = r + 2 * dir;
            if (this.inBounds(r2a, c - 2)) {
              const mid = this.board[r1][c1a];
              if (mid && mid.p !== player && !this.board[r2a][c - 2]) return true;
            }
            if (this.inBounds(r2b, c + 2)) {
              const mid = this.board[r1][c1b];
              if (mid && mid.p !== player && !this.board[r2b][c + 2]) return true;
            }
          }
        }
      }
      return false;
    }

    hasAnyMove(player = this.current) {
      const capturing = this.hasAnyCapture(player);
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          const piece = this.board[r][c];
          if (!piece || piece.p !== player) continue;
          const dirs = piece.k ? [-1, 1] : [piece.p === 1 ? -1 : 1];
          for (const dir of dirs) {
            // Steps if not forced to capture
            if (!capturing) {
              const r1 = r + dir;
              for (const dc of [-1, 1]) {
                const c1 = c + dc;
                if (this.inBounds(r1, c1) && !this.board[r1][c1]) return true;
              }
            }
            // Jumps
            const r1 = r + dir;
            for (const dc of [-1, 1]) {
              const c1 = c + dc;
              const r2 = r + 2 * dir;
              const c2 = c + 2 * dc;
              if (!this.inBounds(r2, c2)) continue;
              const mid = this.board[r1][c1];
              if (mid && mid.p !== player && !this.board[r2][c2]) return true;
            }
          }
        }
      }
      return false;
    }
  }

  function isDark(r, c) { return (r + c) % 2 === 1; }
  function cloneCell(cell) { return cell ? { p: cell.p, k: !!cell.k, id: cell.id } : null; }

  global.CheckersGame = CheckersGame;
})(window);
