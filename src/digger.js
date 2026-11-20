(function (global) {
  const COLS = 20;
  const ROWS = 15;
  const TILE = 32;
  const PLAYER_STEP = 0.12;
  const MONSTER_STEP_BASE = 0.2;
  const BAG_FALL_STEP = 0.07;
  const MAX_LEVEL = 5;
  const DEATH_TIME = 1.0;      // seconds of death animation before respawn
  const RESPAWN_READY = 1.2;   // "Ready!" countdown after a respawn
  const INVULN_TIME = 2.0;     // grace period after respawn

  // Bag slots: each sits in solid dirt with solid dirt directly beneath,
  // so no bag falls on its own at level start.
  const BAG_SLOTS = [
    [4, 4], [12, 4], [8, 7], [15, 7], [5, 10], [13, 10],
  ];

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  function key(x, y) {
    return `${x},${y}`;
  }

  function facingOf(dx, dy) {
    if (dx === 1) return "right";
    if (dx === -1) return "left";
    if (dy === 1) return "down";
    if (dy === -1) return "up";
    return null;
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

    // ---- Lifecycle ----

    restart() {
      this.level = 1;
      this.score = 0;
      this.lives = 3;
      this.paused = false;
      this._startLevel(this.level);
    }

    hasNextLevel() {
      return this.level < MAX_LEVEL;
    }

    nextLevel() {
      if (this.state !== "levelClear" || !this.hasNextLevel()) return false;
      this.level += 1;
      this._startLevel(this.level);
      return true;
    }

    /** True while the round is live (used by the UI to decide on restart confirmation). */
    inProgress() {
      return this.state === "playing" || this.state === "dying" ||
        (this.state === "ready" && (this.score > 0 || this.level > 1));
    }

    _setState(s) {
      if (this.state === s) return;
      this.state = s;
      this._emit("state", s);
    }

    _startLevel(level) {
      this.dir = { x: 0, y: 0 };
      this.queued = null;
      this.lastFacing = "right";
      this.playerAcc = PLAYER_STEP; // first input moves immediately
      this.monsterAcc = 0;
      this.bagAcc = 0;
      this.pump = null;
      this.invuln = 0;
      this.deathTimer = 0;
      this.readyTimer = null; // null = wait for the player's first input

      this.dirt = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
      this.emeralds = new Set();
      this.bags = [];
      this.monsters = [];

      this.player = { x: 1, y: 1, px: 1, py: 1 };
      this._carve(1, 1);
      this._carveSpine();
      this._carveNest(level);
      this._placeEmeralds();
      this._placeBags();
      this._spawnMonsters(level);

      this.state = null;
      this._setState("ready");
      this._emitAll();
    }

    _emitAll() {
      this._emit("level", this.level);
      this._emit("score", this.score);
      this._emit("lives", this.lives);
      this._emit("emeralds", this.emeralds.size);
      this._emit("update");
    }

    // ---- Level generation ----

    _carve(x, y) {
      if (!this._isInside(x, y)) return;
      this.dirt[y][x] = false;
    }

    _carveSpine() {
      for (let x = 1; x < COLS - 1; x++) this._carve(x, 1);
      for (let y = 1; y < ROWS - 1; y++) this._carve(1, y);
      for (let y = 3; y < ROWS - 1; y += 3) {
        for (let x = 1; x < COLS - 1; x++) this._carve(x, y);
      }
    }

    _spawnPoints(level) {
      const count = Math.min(2 + level, 7);
      const pts = [];
      for (let i = 0; i < count; i++) {
        pts.push({ x: COLS - 2 - (i % 2), y: ROWS - 2 - Math.floor(i / 2) });
      }
      return pts;
    }

    _carveNest(level) {
      // Monsters start in an open pocket instead of inside solid dirt.
      for (const p of this._spawnPoints(level)) this._carve(p.x, p.y);
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
      for (const [x, y] of BAG_SLOTS) {
        // Defensive validation: a bag must sit in dirt on top of dirt,
        // and never cover an emerald (which would hide a required pickup).
        if (!this._isInside(x, y + 1)) continue;
        if (!this.dirt[y][x] || !this.dirt[y + 1][x]) continue;
        this.emeralds.delete(key(x, y));
        this.bags.push({
          x, y, py: y,
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
      this.spawns = this._spawnPoints(level);
      for (const p of this.spawns) {
        this.monsters.push({ x: p.x, y: p.y, px: p.x, py: p.y, alive: true });
      }
    }

    // ---- Input ----

    /** Held direction (0,0 when released). */
    setDirection(dx, dy) {
      if (dx !== 0 && dy !== 0) return;
      this.dir = { x: dx, y: dy };
      const f = facingOf(dx, dy);
      if (f) {
        this.lastFacing = f;
        this._wake();
      }
    }

    /** A single press: guarantees one step even if released before the next tick. */
    nudge(dx, dy) {
      const f = facingOf(dx, dy);
      if (!f) return;
      this.queued = { x: dx, y: dy };
      this.lastFacing = f;
      this._wake();
    }

    _wake() {
      if (this.paused) return;
      if (this.state === "ready" && this.readyTimer === null) this._setState("playing");
    }

    firePump() {
      if (this.paused || this.state !== "playing") return;
      if (this.pump) return;
      this.pump = { dir: this.lastFacing, len: 0, max: 4, timer: 0 };
    }

    setPaused(p) {
      p = !!p;
      if (p && !(this.state === "playing" || this.state === "ready")) return;
      if (this.paused === p) return;
      this.paused = p;
      this._emit("pause", p);
    }

    togglePause() {
      this.setPaused(!this.paused);
    }

    // ---- Simulation ----

    step(dt) {
      if (this.paused) return;

      if (this.state === "ready") {
        if (this.readyTimer !== null) {
          this.readyTimer -= dt;
          if (this.readyTimer <= 0) {
            this.readyTimer = null;
            this._setState("playing");
          }
        }
        this._emit("update");
        return;
      }

      if (this.state === "dying") {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) this._afterDeath();
        this._emit("update");
        return;
      }

      if (this.state !== "playing") return;

      if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

      // Player: when idle, keep the timer primed so the next press moves at once.
      const wantsMove = this.queued || this.dir.x !== 0 || this.dir.y !== 0;
      if (!wantsMove) {
        this.playerAcc = Math.min(this.playerAcc + dt, PLAYER_STEP);
        this.player.px = this.player.x;
        this.player.py = this.player.y;
      } else {
        this.playerAcc += dt;
        while (this.playerAcc >= PLAYER_STEP && this.state === "playing") {
          this.playerAcc -= PLAYER_STEP;
          this._movePlayer();
          if (!this.queued && this.dir.x === 0 && this.dir.y === 0) {
            this.playerAcc = Math.min(this.playerAcc, PLAYER_STEP);
            break;
          }
        }
      }
      if (this.state !== "playing") return this._emit("update");

      this.bagAcc += dt;
      while (this.bagAcc >= BAG_FALL_STEP && this.state === "playing") {
        this.bagAcc -= BAG_FALL_STEP;
        this._updateBags();
      }
      if (this.state !== "playing") return this._emit("update");

      this.monsterAcc += dt;
      const mStep = this.monsterStep();
      while (this.monsterAcc >= mStep && this.state === "playing") {
        this.monsterAcc -= mStep;
        this._moveMonsters();
      }
      if (this.state !== "playing") return this._emit("update");

      this._updatePump(dt);
      this._checkContactDamage();

      this._emit("update");
    }

    monsterStep() {
      return Math.max(0.08, MONSTER_STEP_BASE - (this.level - 1) * 0.02);
    }

    /** 0..1 progress of the current player/monster/bag step, for smooth rendering. */
    playerFrac() {
      return Math.min(1, this.playerAcc / PLAYER_STEP);
    }
    monsterFrac() {
      return this.state === "playing" ? Math.min(1, this.monsterAcc / this.monsterStep()) : 1;
    }
    bagFrac() {
      return this.state === "playing" ? Math.min(1, this.bagAcc / BAG_FALL_STEP) : 1;
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
      const p = this.player;
      p.px = p.x;
      p.py = p.y;

      const d = this.dir.x !== 0 || this.dir.y !== 0 ? this.dir : this.queued;
      this.queued = null;
      if (!d) return;

      const f = facingOf(d.x, d.y);
      if (f) this.lastFacing = f;

      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (!this._canWalkInto(nx, ny)) return;

      const bag = this._bagAt(nx, ny);
      if (bag && bag.gold) {
        this.score += 500;
        this._emit("score", this.score);
        this._emit("event", { type: "gold", x: nx, y: ny, points: 500 });
        this.bags = this.bags.filter((b) => b !== bag);
      }

      p.x = nx;
      p.y = ny;
      this._carve(nx, ny);

      const ek = key(nx, ny);
      if (this.emeralds.has(ek)) {
        this.emeralds.delete(ek);
        this.score += 25;
        this._emit("score", this.score);
        this._emit("emeralds", this.emeralds.size);
      }

      this._checkContactDamage();
      if (this.state !== "playing") return;

      if (this.emeralds.size === 0) {
        this._setState("levelClear");
        this._emit("win", {
          level: this.level,
          score: this.score,
          final: !this.hasNextLevel(),
          nextLevel: this.hasNextLevel() ? this.level + 1 : null,
        });
        if (!this.hasNextLevel()) this._setState("won");
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
        bag.py = bag.y;
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
          if (bag.drop >= 2) {
            bag.gold = true;
            this._emit("event", { type: "burst", x: bag.x, y: bag.y });
          }
          bag.falling = false;
          bag.drop = 0;
          continue;
        }

        bag.y = ny;
        bag.drop += 1;

        if (this.player.x === bag.x && this.player.y === bag.y && this.invuln <= 0) {
          this._loseLife("Crushed by a bag!");
          return;
        }

        for (const m of this.monsters) {
          if (m.alive && m.x === bag.x && m.y === bag.y) {
            m.alive = false;
            this.score += 250;
            this._emit("score", this.score);
            this._emit("event", { type: "kill", x: m.x, y: m.y, points: 250 });
          }
        }
      }
      this.monsters = this.monsters.filter((m) => m.alive);
    }

    _moveMonsters() {
      for (const m of this.monsters) {
        m.px = m.x;
        m.py = m.y;
        if (!m.alive) continue;
        const opts = [];
        for (const d of Object.values(DIRS)) {
          const nx = m.x + d.x;
          const ny = m.y + d.y;
          if (!this._isInside(nx, ny)) continue;
          if (this.dirt[ny][nx]) continue;
          const bag = this._bagAt(nx, ny);
          if (bag && !bag.gold) continue;
          const dist = Math.abs(this.player.x - nx) + Math.abs(this.player.y - ny);
          opts.push({ nx, ny, d: dist });
        }

        if (opts.length === 0) continue;
        opts.sort((a, b) => a.d - b.d);
        m.x = opts[0].nx;
        m.y = opts[0].ny;
      }

      this.monsters = this.monsters.filter((m) => m.alive);
      this._checkContactDamage();
    }

    _updatePump(dt) {
      if (!this.pump) return;
      this.pump.timer += dt;
      if (this.pump.timer >= 0.04) {
        this.pump.timer = 0;
        this.pump.len += 1;
      }

      const head = this._pumpHead();
      const m = head && this._monsterAt(head.x, head.y);
      if (m) {
        m.alive = false;
        this.score += 250;
        this._emit("score", this.score);
        this._emit("event", { type: "kill", x: m.x, y: m.y, points: 250 });
        this.monsters = this.monsters.filter((mm) => mm.alive);
        this.pump = null;
        return;
      }

      if (this.pump.len >= this.pump.max) this.pump = null;
    }

    _pumpHead() {
      if (!this.pump) return null;
      const p = this.player;
      const d = DIRS[this.pump.dir];
      return { x: p.x + d.x * this.pump.len, y: p.y + d.y * this.pump.len };
    }

    /** Same tile, or the two swapped tiles this tick (which used to pass through). */
    _touches(m) {
      const p = this.player;
      if (m.x === p.x && m.y === p.y) return true;
      return m.x === p.px && m.y === p.py && m.px === p.x && m.py === p.y;
    }

    _checkContactDamage() {
      if (this.state !== "playing" || this.invuln > 0) return;
      for (const m of this.monsters) {
        if (m.alive && this._touches(m)) {
          this._loseLife("A monster got you!");
          return;
        }
      }
    }

    _loseLife(reason) {
      this.lives -= 1;
      this._emit("lives", this.lives);
      this._emit("status", reason);
      this.pump = null;
      this.deathTimer = DEATH_TIME;
      this._setState("dying");
    }

    _afterDeath() {
      if (this.lives <= 0) {
        this._setState("gameOver");
        this._emit("lose", { level: this.level, score: this.score });
        return;
      }
      // Respawn: player back home, monsters back to their nest, short grace period.
      this.player = { x: 1, y: 1, px: 1, py: 1 };
      this._carve(1, 1);
      this.dir = { x: 0, y: 0 };
      this.queued = null;
      this.playerAcc = PLAYER_STEP;
      this.monsterAcc = 0;
      this.monsters.forEach((m, i) => {
        const s = this.spawns[i % this.spawns.length];
        m.x = m.px = s.x;
        m.y = m.py = s.y;
      });
      this.invuln = INVULN_TIME;
      this.readyTimer = RESPAWN_READY;
      this._setState("ready");
      this._emit("update");
    }
  }

  global.DiggerGame = DiggerGame;
  global.__DIGGER_CONST = { COLS, ROWS, TILE, MAX_LEVEL };
})(window);
