(function (global) {
  const COLS = 20;
  const ROWS = 15;
  const TILE = 32;
  const MAX_LEVEL = 5;

  // Movement
  const TUNNEL_STEP = 0.12;   // seconds per tile in open tunnel
  const DIG_STEP = 0.18;      // seconds per tile when digging or pushing
  const BAG_FALL_STEP = 0.07;

  // Life cycle
  const DEATH_TIME = 1.0;
  const RESPAWN_READY = 1.2;
  const INVULN_TIME = 2.0;

  // Pump
  const PUMP_RANGE = 4;
  const PUMP_EXTEND = 0.04;   // seconds per tile of reach
  const PUMP_COOLDOWN = 0.6;
  const STUN_TIME = 2.0;

  // Scoring
  const PTS_EMERALD = 25;
  const PTS_STREAK = 250;     // every STREAK_LEN emeralds in a row
  const STREAK_LEN = 8;
  const STREAK_WINDOW = 1.0;  // max seconds between emeralds to keep a streak
  const PTS_GOLD = 300;
  const PTS_POP = 200;        // pump a stunned monster
  const PTS_CRUSH = 250;      // first monster under a bag; doubles per extra monster

  // Bag slots: each sits in solid dirt with solid dirt directly beneath,
  // so no bag falls on its own at level start.
  const BAG_SLOTS = [
    [4, 4], [12, 4], [8, 7], [15, 7], [5, 10], [13, 10],
  ];

  // Monster nest (bottom-right pocket). The first tile is the spawn mouth.
  const NEST = [
    [18, 13], [17, 13], [18, 12], [17, 12],
  ];

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const DIR_LIST = Object.values(DIRS);

  function levelConfig(level) {
    return {
      total: 4 + level * 2,                          // monsters to clear the level
      cap: Math.min(2 + level, 6),                   // alive at once
      spawnEvery: Math.max(2.5, 6 - level * 0.7),    // seconds between spawns
      monsterStep: Math.max(0.1, 0.22 - (level - 1) * 0.025),
      wander: Math.max(0.05, 0.3 - level * 0.05),    // chance of a random turn
    };
  }

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
      this.cfg = levelConfig(level);
      this.dir = { x: 0, y: 0 };
      this.queued = null;
      this.lastFacing = "right";
      this.playerAcc = 0;
      this.playerIdle = true;
      this.playerAnim = 1;      // seconds since the last player move
      this.lastStepCost = TUNNEL_STEP;
      this.playerMovedThisFrame = false;
      this.monsterAcc = 0;
      this.bagAcc = 0;
      this.pump = null;
      this.pumpCooldown = 0;
      this.invuln = 0;
      this.deathTimer = 0;
      this.readyTimer = null; // null = wait for the player's first input
      this.streak = 0;
      this.streakTimer = Infinity;
      this.spawned = 0;
      this.killed = 0;
      this.spawnTimer = this.cfg.spawnEvery;
      this.nestFlash = 0;

      this.dirt = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
      this.emeralds = new Set();
      this.bags = [];
      this.monsters = [];

      this.player = { x: 1, y: 1, px: 1, py: 1 };
      this._carve(1, 1);
      this._carveSpine();
      for (const [x, y] of NEST) this._carve(x, y);
      this._placeEmeralds();
      this._placeBags();
      this._spawnMonster(); // one waits in the nest from the start

      this.state = null;
      this._setState("ready");
      this._emitAll();
    }

    _emitAll() {
      this._emit("level", this.level);
      this._emit("score", this.score);
      this._emit("lives", this.lives);
      this._emit("emeralds", this.emeralds.size);
      this._emit("monsters", this.monstersLeft());
      this._emit("update");
    }

    monstersLeft() {
      return this.cfg.total - this.killed;
    }

    nest() {
      return { x: NEST[0][0], y: NEST[0][1], flash: this.nestFlash };
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
        this.bags.push(this._newBag(x, y));
      }
    }

    _newBag(x, y) {
      return {
        x, y, px: x, py: y,
        falling: false,
        shaking: false,
        shakeTimer: 0,
        shakeDuration: 0,
        drop: 0,
        kills: 0,
        gold: false,
      };
    }

    _spawnMonster() {
      if (this.spawned >= this.cfg.total) return false;
      const spot = NEST.find(([x, y]) =>
        !this._monsterAt(x, y) && !(this.player.x === x && this.player.y === y) && !this._bagAt(x, y));
      if (!spot) return false;
      const [x, y] = spot;
      this.monsters.push({ x, y, px: x, py: y, alive: true, stun: 0, last: null });
      this.spawned += 1;
      this.nestFlash = 0.5;
      return true;
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

    pumpReady() {
      return !this.pump && this.pumpCooldown <= 0;
    }

    /** 0..1 how recharged the pump is (1 = ready). */
    pumpCharge() {
      if (this.pump) return 0;
      return 1 - Math.max(0, this.pumpCooldown) / PUMP_COOLDOWN;
    }

    firePump() {
      if (this.paused || this.state !== "playing") return;
      if (!this.pumpReady()) return;
      this.pump = { dir: this.lastFacing, len: 0, timer: 0 };
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
      if (this.nestFlash > 0) this.nestFlash = Math.max(0, this.nestFlash - dt);

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
      if (this.pumpCooldown > 0) this.pumpCooldown = Math.max(0, this.pumpCooldown - dt);
      this.streakTimer += dt;
      this.playerAnim += dt;
      this.playerMovedThisFrame = false;

      this._stepPlayer(dt);
      if (this.state !== "playing") return this._emit("update");

      this.bagAcc += dt;
      while (this.bagAcc >= BAG_FALL_STEP && this.state === "playing") {
        this.bagAcc -= BAG_FALL_STEP;
        this._updateBags();
      }
      if (this.state !== "playing") return this._emit("update");

      for (const m of this.monsters) if (m.stun > 0) m.stun = Math.max(0, m.stun - dt);
      this.monsterAcc += dt;
      const mStep = this.cfg.monsterStep;
      while (this.monsterAcc >= mStep && this.state === "playing") {
        this.monsterAcc -= mStep;
        this._moveMonsters();
      }
      if (this.state !== "playing") return this._emit("update");

      this._updateSpawner(dt);
      this._updatePump(dt);
      this._checkContactDamage();
      this._checkLevelClear();

      this._emit("update");
    }

    _wantDir() {
      if (this.dir.x !== 0 || this.dir.y !== 0) return this.dir;
      return this.queued;
    }

    /** Seconds the next step towards d will take: digging and pushing are slower. */
    _stepCost(d) {
      const nx = this.player.x + d.x;
      const ny = this.player.y + d.y;
      if (!this._isInside(nx, ny)) return TUNNEL_STEP;
      const bag = this._bagAt(nx, ny);
      if (bag && !bag.gold) return DIG_STEP;
      return this.dirt[ny][nx] ? DIG_STEP : TUNNEL_STEP;
    }

    _stepPlayer(dt) {
      let d = this._wantDir();
      if (!d) {
        this.playerIdle = true;
        this.playerAcc = 0;
        return;
      }
      if (this.playerIdle) {
        // Starting from rest: move now, but never faster than the normal pace.
        this.playerIdle = false;
        this.playerAcc = Math.min(this._stepCost(d), this.playerAnim);
      } else {
        this.playerAcc += dt;
      }
      while (d && this.state === "playing") {
        const cost = this._stepCost(d);
        if (this.playerAcc < cost) break;
        this.playerAcc -= cost;
        this.lastStepCost = cost;
        this._movePlayer(d);
        d = this._wantDir();
      }
      if (!d) {
        this.playerIdle = true;
        this.playerAcc = 0;
      }
    }

    monsterStep() {
      return this.cfg.monsterStep;
    }

    /** 0..1 progress of the current player/monster/bag step, for smooth rendering. */
    playerFrac() {
      return Math.min(1, this.playerAnim / this.lastStepCost);
    }
    monsterFrac() {
      return this.state === "playing" ? Math.min(1, this.monsterAcc / this.cfg.monsterStep) : 1;
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

    _popup(x, y, text, kind) {
      this._emit("popup", { x, y, text, kind });
    }

    _addScore(pts) {
      this.score += pts;
      this._emit("score", this.score);
    }

    _collectEmerald(x, y) {
      const ek = key(x, y);
      if (!this.emeralds.has(ek)) return;
      this.emeralds.delete(ek);
      this.streak = this.streakTimer <= STREAK_WINDOW ? this.streak + 1 : 1;
      this.streakTimer = 0;
      this._addScore(PTS_EMERALD);
      this._emit("emeralds", this.emeralds.size);
      if (this.streak % STREAK_LEN === 0) {
        this._addScore(PTS_STREAK);
        this._popup(x, y, `STREAK +${PTS_STREAK}`, "streak");
      }
    }

    /** Pushing: a resting bag moves one tile sideways if the far tile is free. */
    _tryPush(bag, dx) {
      if (dx === 0 || bag.falling) return false;
      const tx = bag.x + dx;
      if (!this._isInside(tx, bag.y)) return false;
      if (this._bagAt(tx, bag.y) || this._monsterAt(tx, bag.y)) return false;
      bag.px = bag.x;
      bag.x = tx;
      bag.shaking = false;
      bag.shakeTimer = 0;
      // A bag shoved into dirt crushes the emerald there; the player gets it.
      this._collectEmerald(tx, bag.y);
      return true;
    }

    _movePlayer(d) {
      const p = this.player;
      p.px = p.x;
      p.py = p.y;
      for (const b of this.bags) b.px = b.x;
      this.queued = null;

      const f = facingOf(d.x, d.y);
      if (f) this.lastFacing = f;

      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (!this._isInside(nx, ny)) return;

      const bag = this._bagAt(nx, ny);
      if (bag && !bag.gold && !this._tryPush(bag, d.x)) return;
      if (bag && bag.gold) {
        this._addScore(PTS_GOLD);
        this._popup(nx, ny, `+${PTS_GOLD}`, "gold");
        this.bags = this.bags.filter((b) => b !== bag);
      }

      p.x = nx;
      p.y = ny;
      this.playerAnim = 0;
      this.playerMovedThisFrame = true;
      this._carve(nx, ny);
      this._collectEmerald(nx, ny);

      this._checkContactDamage();
      this._checkLevelClear();
    }

    _checkLevelClear() {
      if (this.state !== "playing") return;
      let reason = null;
      if (this.emeralds.size === 0) reason = "emeralds";
      else if (this.killed >= this.cfg.total) reason = "monsters";
      if (!reason) return;
      const final = !this.hasNextLevel();
      this._setState("levelClear");
      this._emit("win", {
        level: this.level,
        score: this.score,
        reason,
        final,
        nextLevel: final ? null : this.level + 1,
      });
      if (final) this._setState("won");
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
            bag.kills = 0;
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
            const pts = PTS_CRUSH * 2 ** bag.kills;
            bag.kills += 1;
            this._killMonster(m, pts, bag.kills > 1 ? `x${bag.kills} +${pts}` : `+${pts}`);
          }
        }
      }
      this.monsters = this.monsters.filter((m) => m.alive);
    }

    _killMonster(m, pts, label) {
      m.alive = false;
      this.killed += 1;
      this._addScore(pts);
      this._popup(m.x, m.y, label || `+${pts}`, "kill");
      this._emit("monsters", this.monstersLeft());
    }

    // ---- Monsters ----

    _passable(x, y) {
      if (!this._isInside(x, y) || this.dirt[y][x]) return false;
      const bag = this._bagAt(x, y);
      return !bag || bag.gold;
    }

    /** Tunnel distance from every open tile to the player (BFS). */
    _distanceField() {
      const dist = Array.from({ length: ROWS }, () => Array(COLS).fill(Infinity));
      const { x: sx, y: sy } = this.player;
      dist[sy][sx] = 0;
      const queue = [[sx, sy]];
      for (let i = 0; i < queue.length; i++) {
        const [x, y] = queue[i];
        for (const d of DIR_LIST) {
          const nx = x + d.x, ny = y + d.y;
          if (!this._passable(nx, ny) || dist[ny][nx] !== Infinity) continue;
          dist[ny][nx] = dist[y][x] + 1;
          queue.push([nx, ny]);
        }
      }
      return dist;
    }

    _moveMonsters() {
      const dist = this._distanceField();
      const p = this.player;
      for (const m of this.monsters) {
        m.px = m.x;
        m.py = m.y;
        if (!m.alive || m.stun > 0) continue;

        const opts = [];
        for (const d of DIR_LIST) {
          const nx = m.x + d.x, ny = m.y + d.y;
          if (!this._passable(nx, ny)) continue;
          const isPlayer = nx === p.x && ny === p.y;
          if (!isPlayer && this._monsterAt(nx, ny)) continue; // no stacking
          const reverse = m.last && d.x === -m.last.x && d.y === -m.last.y;
          opts.push({ d, nx, ny, dist: dist[ny][nx], reverse });
        }
        if (opts.length === 0) continue;

        const forward = opts.filter((o) => !o.reverse);
        const pool = forward.length ? forward : opts;
        const reachable = opts.some((o) => o.dist !== Infinity);
        let pick;
        if (!reachable || Math.random() < this.cfg.wander) {
          pick = pool[Math.floor(Math.random() * pool.length)];
        } else {
          let bestDist = Infinity;
          for (const o of opts) bestDist = Math.min(bestDist, o.dist);
          const bests = opts.filter((o) => o.dist === bestDist);
          pick = bests[Math.floor(Math.random() * bests.length)];
        }
        m.x = pick.nx;
        m.y = pick.ny;
        m.last = pick.d;
      }

      this.monsters = this.monsters.filter((m) => m.alive);
      this._checkContactDamage();
    }

    _updateSpawner(dt) {
      if (this.spawned >= this.cfg.total) return;
      const alive = this.monsters.filter((m) => m.alive).length;
      if (alive >= this.cfg.cap) return;
      this.spawnTimer -= dt;
      if (this.spawnTimer > 0) return;
      if (this._spawnMonster()) this.spawnTimer = this.cfg.spawnEvery;
    }

    // ---- Pump ----

    _updatePump(dt) {
      if (!this.pump) return;
      const d = DIRS[this.pump.dir];
      this.pump.timer += dt;
      while (this.pump && this.pump.timer >= PUMP_EXTEND) {
        this.pump.timer -= PUMP_EXTEND;
        const nx = this.player.x + d.x * (this.pump.len + 1);
        const ny = this.player.y + d.y * (this.pump.len + 1);
        // The pump only travels through open tunnel.
        if (this.pump.len >= PUMP_RANGE || !this._passable(nx, ny)) {
          this._endPump();
          break;
        }
        this.pump.len += 1;
        const m = this._monsterAt(nx, ny);
        if (m) {
          if (m.stun > 0) {
            this._killMonster(m, PTS_POP, `POP +${PTS_POP}`);
            this.monsters = this.monsters.filter((mm) => mm.alive);
          } else {
            m.stun = STUN_TIME;
            this._emit("event", { type: "stun", x: m.x, y: m.y });
          }
          this._endPump();
        }
      }
    }

    _endPump() {
      this.pump = null;
      this.pumpCooldown = PUMP_COOLDOWN;
    }

    // ---- Damage ----

    /** Same tile, or the two swapped tiles this frame (which used to pass through). */
    _touches(m) {
      const p = this.player;
      if (m.x === p.x && m.y === p.y) return true;
      return this.playerMovedThisFrame &&
        m.x === p.px && m.y === p.py && m.px === p.x && m.py === p.y;
    }

    _checkContactDamage() {
      if (this.state !== "playing" || this.invuln > 0) return;
      for (const m of this.monsters) {
        if (m.alive && m.stun <= 0 && this._touches(m)) {
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
      this.pumpCooldown = 0;
      this.deathTimer = DEATH_TIME;
      this._setState("dying");
    }

    _afterDeath() {
      if (this.lives <= 0) {
        this._setState("gameOver");
        this._emit("lose", { level: this.level, score: this.score });
        return;
      }
      // Respawn: player back home, monsters back to the nest, short grace period.
      this.player = { x: 1, y: 1, px: 1, py: 1 };
      this._carve(1, 1);
      this.dir = { x: 0, y: 0 };
      this.queued = null;
      this.playerIdle = true;
      this.playerAcc = 0;
      this.playerAnim = 1;
      this.monsterAcc = 0;
      this.monsters.forEach((m, i) => {
        const [x, y] = NEST[i % NEST.length];
        m.x = m.px = x;
        m.y = m.py = y;
        m.stun = 0;
        m.last = null;
      });
      this.spawnTimer = this.cfg.spawnEvery;
      this.invuln = INVULN_TIME;
      this.readyTimer = RESPAWN_READY;
      this._setState("ready");
      this._emit("update");
    }
  }

  global.DiggerGame = DiggerGame;
  global.__DIGGER_CONST = { COLS, ROWS, TILE, MAX_LEVEL, STUN_TIME };
})(window);
