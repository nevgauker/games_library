(function (global) {
  const COLS = 20;
  const ROWS = 15;
  const TILE = 32;
  const PLAYER_STEP = 0.12;
  const MONSTER_STEP_BASE = 0.2;
  const BAG_FALL_STEP = 0.07;
  const MAX_LEVEL = 5;

  function key(x, y) {
    return `${x},${y}`;
  }

  class DiggerGame {
    constructor() {
      this.width = COLS * TILE;
      this.height = ROWS * TILE;
      this._listeners = new Map();
      this.restart();
    }

    on(ev, fn) {
      const arr = this._listeners.get(ev) || [];
      arr.push(fn);
      this._listeners.set(ev, arr);
      return () => this.off(ev, fn);
    }

    off(ev, fn) {
      const arr = this._listeners.get(ev) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }

    _emit(ev, payload) {
      const arr = this._listeners.get(ev) || [];
      for (const fn of arr) fn(payload);
    }

    restart() {
      this.level = 1;
      this.score = 0;
      this.lives = 3;
      this.running = true;
      this.status = "";
      this._startLevel(this.level);
      this._emitAll();
    }

    hasNextLevel() {
      return this.level < MAX_LEVEL;
    }

    nextLevel() {
      if (!this.hasNextLevel()) return false;
      this.level += 1;
      this._startLevel(this.level);
      this.running = true;
      this.status = "";
      this._emitAll();
      return true;
    }

    _startLevel(level) {
      this.dir = { x: 0, y: 0 };
      this.lastFacing = "right";
      this.playerAcc = 0;
      this.monsterAcc = 0;
      this.bagAcc = 0;
      this.pump = null;

      this.dirt = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
      this.emeralds = new Set();
      this.bags = [];
      this.monsters = [];

      this.player = { x: 1, y: 1 };
      this._carve(this.player.x, this.player.y);
      this._carveSpine();
      this._placeEmeralds();
      this._placeBags();
      this._spawnMonsters(level);
      this._emit("level", this.level);
      this._emit("score", this.score);
      this._emit("lives", this.lives);
      this._emit("emeralds", this.emeralds.size);
      this._emit("status", this.status);
      this._emit("update");
    }

    _emitAll() {
      this._emit("level", this.level);
      this._emit("score", this.score);
      this._emit("lives", this.lives);
      this._emit("emeralds", this.emeralds.size);
      this._emit("status", this.status);
      this._emit("update");
    }

    _carve(x, y) {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
      this.dirt[y][x] = false;
    }

    _carveSpine() {
      for (let x = 1; x < COLS - 1; x++) this._carve(x, 1);
      for (let y = 1; y < ROWS - 1; y++) this._carve(1, y);
      for (let y = 3; y < ROWS - 1; y += 3) {
        for (let x = 1; x < COLS - 1; x++) this._carve(x, y);
      }
    }

    _placeEmeralds() {
      for (let y = 2; y < ROWS - 1; y++) {
        for (let x = 2; x < COLS - 1; x++) {
          if ((x + y) % 2 !== 0) continue;
          if (!this.dirt[y][x]) continue;
          this.emeralds.add(key(x, y));
        }
      }
    }

    _placeBags() {
      const bagRows = [2, 4, 6, 8, 10, 12];
      for (let i = 0; i < bagRows.length; i++) {
        const y = bagRows[i];
        const x = 4 + (i * 3) % (COLS - 6);
        this.bags.push({
          x,
          y,
          falling: false,
          shaking: false,
          shakeTimer: 0,
          shakeDuration: 0,
          drop: 0,
          gold: false,
        });
      }
    }

    _spawnMonsters(level) {
      const count = Math.min(2 + level, 7);
      for (let i = 0; i < count; i++) {
        this.monsters.push({
          x: COLS - 2 - (i % 2),
          y: ROWS - 2 - Math.floor(i / 2),
          alive: true,
        });
      }
    }

    setDirection(dx, dy) {
      if (!this.running) return;
      if (dx !== 0 && dy !== 0) return;
      this.dir = { x: dx, y: dy };
      if (dx === 1) this.lastFacing = "right";
      if (dx === -1) this.lastFacing = "left";
      if (dy === 1) this.lastFacing = "down";
      if (dy === -1) this.lastFacing = "up";
    }

    firePump() {
      if (!this.running) return;
      if (this.pump) return;
      this.pump = {
        dir: this.lastFacing,
        len: 0,
        max: 4,
        timer: 0,
      };
    }

    step(dt) {
      if (!this.running) return;

      this.playerAcc += dt;
      while (this.playerAcc >= PLAYER_STEP) {
        this.playerAcc -= PLAYER_STEP;
        this._movePlayer();
      }

      this.bagAcc += dt;
      while (this.bagAcc >= BAG_FALL_STEP) {
        this.bagAcc -= BAG_FALL_STEP;
        this._updateBags();
      }

      this.monsterAcc += dt;
      const mStep = Math.max(0.08, MONSTER_STEP_BASE - (this.level - 1) * 0.02);
      while (this.monsterAcc >= mStep) {
        this.monsterAcc -= mStep;
        this._moveMonsters();
      }

      this._updatePump(dt);
      this._checkContactDamage();

      this._emit("update");
    }

    _isInside(x, y) {
      return x >= 0 && y >= 0 && x < COLS && y < ROWS;
    }

    _bagAt(x, y) {
      return this.bags.find((b) => b.x === x && b.y === y);
    }

    _monsterAt(x, y) {
      return this.monsters.find((m) => m.alive && m.x === x && m.y === y);
    }

    _canWalkInto(x, y) {
      if (!this._isInside(x, y)) return false;
      const bag = this._bagAt(x, y);
      if (!bag) return true;
      return !!bag.gold;
    }

    _movePlayer() {
      const dx = this.dir.x;
      const dy = this.dir.y;
      if (dx === 0 && dy === 0) return;

      const nx = this.player.x + dx;
      const ny = this.player.y + dy;
      if (!this._canWalkInto(nx, ny)) return;

      const bag = this._bagAt(nx, ny);
      if (bag && bag.gold) {
        this.score += 500;
        this._emit("score", this.score);
        this.bags = this.bags.filter((b) => b !== bag);
      }

      this.player.x = nx;
      this.player.y = ny;
      this._carve(nx, ny);

      const ek = key(nx, ny);
      if (this.emeralds.has(ek)) {
        this.emeralds.delete(ek);
        this.score += 25;
        this._emit("score", this.score);
        this._emit("emeralds", this.emeralds.size);
      }

      if (this.emeralds.size === 0) {
        this.running = false;
        if (this.hasNextLevel()) {
          this._emit("win", { level: this.level, score: this.score, final: false, nextLevel: this.level + 1 });
        } else {
          this._emit("win", { level: this.level, score: this.score, final: true, nextLevel: null });
        }
      }
    }

    _belowIsSupport(x, y) {
      const by = y + 1;
      if (by >= ROWS) return true;
      if (this.dirt[by][x]) return true;
      if (this._bagAt(x, by)) return true;
      return false;
    }

    _updateBags() {
      for (const bag of this.bags) {
        if (bag.gold) continue;

        const supported = this._belowIsSupport(bag.x, bag.y);

        if (!bag.falling && !bag.shaking && !supported) {
          bag.shaking = true;
          bag.shakeTimer = 0;
          bag.shakeDuration = 1 + Math.random(); // 1-2 seconds warning
          bag.drop = 0;
        }

        if (bag.shaking) {
          if (supported) {
            bag.shaking = false;
            bag.shakeTimer = 0;
            bag.shakeDuration = 0;
            continue;
          }
          bag.shakeTimer += BAG_FALL_STEP;
          if (bag.shakeTimer >= bag.shakeDuration) {
            bag.shaking = false;
            bag.falling = true;
            bag.drop = 0;
          } else {
            continue;
          }
        }

        if (!bag.falling) continue;

        const ny = bag.y + 1;
        if (ny >= ROWS || this.dirt[ny][bag.x] || this._bagAt(bag.x, ny)) {
          if (bag.drop >= 2) bag.gold = true;
          bag.falling = false;
          bag.drop = 0;
          continue;
        }

        bag.y = ny;
        bag.drop += 1;

        if (this.player.x === bag.x && this.player.y === bag.y) {
          this._loseLife("Crushed by bag.");
          return;
        }

        for (const m of this.monsters) {
          if (m.alive && m.x === bag.x && m.y === bag.y) {
            m.alive = false;
            this.score += 250;
            this._emit("score", this.score);
          }
        }
      }
    }

    _moveMonsters() {
      for (const m of this.monsters) {
        if (!m.alive) continue;
        const opts = [];
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [dx, dy] of dirs) {
          const nx = m.x + dx;
          const ny = m.y + dy;
          if (!this._isInside(nx, ny)) continue;
          if (this.dirt[ny][nx]) continue;
          const bag = this._bagAt(nx, ny);
          if (bag && !bag.gold) continue;
          const d = Math.abs(this.player.x - nx) + Math.abs(this.player.y - ny);
          opts.push({ nx, ny, d });
        }

        if (opts.length === 0) continue;
        opts.sort((a, b) => a.d - b.d);
        const best = opts[0];
        m.x = best.nx;
        m.y = best.ny;
      }

      this.monsters = this.monsters.filter((m) => m.alive);
    }

    _updatePump(dt) {
      if (!this.pump) return;
      this.pump.timer += dt;
      if (this.pump.timer >= 0.04) {
        this.pump.timer = 0;
        this.pump.len += 1;
      }

      const head = this._pumpHead();
      if (head && this._monsterAt(head.x, head.y)) {
        const m = this._monsterAt(head.x, head.y);
        if (m) {
          m.alive = false;
          this.score += 250;
          this._emit("score", this.score);
        }
        this.pump = null;
      }

      if (this.pump && this.pump.len >= this.pump.max) {
        this.pump = null;
      }
    }

    _pumpHead() {
      if (!this.pump) return null;
      const p = this.player;
      const len = this.pump.len;
      if (this.pump.dir === "right") return { x: p.x + len, y: p.y };
      if (this.pump.dir === "left") return { x: p.x - len, y: p.y };
      if (this.pump.dir === "down") return { x: p.x, y: p.y + len };
      return { x: p.x, y: p.y - len };
    }

    _checkContactDamage() {
      for (const m of this.monsters) {
        if (!m.alive) continue;
        if (m.x === this.player.x && m.y === this.player.y) {
          this._loseLife("Monster got you.");
          return;
        }
      }
    }

    _loseLife(reason) {
      this.lives -= 1;
      this._emit("lives", this.lives);
      this.status = reason;
      this._emit("status", this.status);

      this.dir = { x: 0, y: 0 };
      this.pump = null;
      this.player = { x: 1, y: 1 };
      this._carve(this.player.x, this.player.y);

      if (this.lives <= 0) {
        this.running = false;
        this._emit("lose", { level: this.level, score: this.score });
      }
    }
  }

  global.DiggerGame = DiggerGame;
  global.__DIGGER_CONST = { COLS, ROWS, TILE, MAX_LEVEL };
})(window);
