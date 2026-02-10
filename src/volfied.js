(function (global) {
  const GRID_W = 80;
  const GRID_H = 50;
  const CELL = 8;
  const PLAYER_STEP_S = 0.075;
  const BORDER = 1;

  const LEVELS = [
    { enemies: 1, speed: 16.5, targetCapture: 75 },
    { enemies: 2, speed: 18.0, targetCapture: 76 },
    { enemies: 3, speed: 19.5, targetCapture: 77 },
    { enemies: 4, speed: 21.0, targetCapture: 78 },
    { enemies: 5, speed: 22.5, targetCapture: 80 },
  ];

  function key(x, y) {
    return `${x},${y}`;
  }

  class VolfiedGame {
    constructor() {
      this.width = GRID_W * CELL;
      this.height = GRID_H * CELL;

      this.level = 1;
      this.score = 0;
      this.lives = 3;
      this.capturePercent = 0;
      this.status = "";
      this.running = true;

      this._listeners = new Map();
      this._stepAcc = 0;
      this._dir = { x: 0, y: 0 };

      this._startLevel(1, { resetScore: true, resetLives: true });
      this._emitAll();
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

    _emitAll() {
      this._emit("level", this.level);
      this._emit("score", this.score);
      this._emit("lives", this.lives);
      this._emit("capture", this.capturePercent);
      this._emit("status", this.status);
      this._emit("update");
    }

    restart() {
      this.level = 1;
      this.score = 0;
      this.lives = 3;
      this.capturePercent = 0;
      this.running = true;
      this.status = "";
      this._stepAcc = 0;
      this._dir = { x: 0, y: 0 };

      this._startLevel(1, { resetScore: false, resetLives: false });
      this._emitAll();
    }

    hasNextLevel() {
      return this.level < LEVELS.length;
    }

    nextLevel() {
      if (!this.hasNextLevel()) return false;
      const next = this.level + 1;
      this._startLevel(next, { resetScore: false, resetLives: false });
      this.running = true;
      this.status = "";
      this._emitAll();
      return true;
    }

    setDirection(dx, dy) {
      if (!this.running) return;
      if (dx !== 0 && dy !== 0) return;
      this._dir.x = dx;
      this._dir.y = dy;
    }

    step(dt) {
      if (!this.running) return;

      this._updateEnemies(dt);
      this._checkEnemyTrailCollision();

      this._stepAcc += dt;
      while (this._stepAcc >= PLAYER_STEP_S) {
        this._stepAcc -= PLAYER_STEP_S;
        this._movePlayer();
      }

      this._emit("update");
    }

    _levelCfg() {
      return LEVELS[this.level - 1] || LEVELS[0];
    }

    _startLevel(level, opts) {
      this.level = Math.max(1, Math.min(LEVELS.length, level));
      if (opts && opts.resetScore) this.score = 0;
      if (opts && opts.resetLives) this.lives = 3;

      this.capturePercent = 0;
      this.status = "";
      this.running = true;
      this._stepAcc = 0;
      this._dir = { x: 0, y: 0 };

      this._initField();
      this._spawnEntities();
      this.player = { x: 1, y: Math.floor(GRID_H / 2) };
    }

    _initField() {
      this.claimed = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(false));
      this.trail = new Set();
      this.isDrawing = false;

      for (let x = BORDER; x <= GRID_W - 1 - BORDER; x++) {
        this.claimed[BORDER][x] = true;
        this.claimed[GRID_H - 1 - BORDER][x] = true;
      }
      for (let y = BORDER; y <= GRID_H - 1 - BORDER; y++) {
        this.claimed[y][BORDER] = true;
        this.claimed[y][GRID_W - 1 - BORDER] = true;
      }

      this._recomputeCapture();
    }

    _spawnEntities() {
      const cfg = this._levelCfg();
      this.enemies = [];
      for (let i = 0; i < cfg.enemies; i++) {
        const spawn = this._spawnPoint(i, cfg.enemies);
        const angle = (Math.PI * 2 * (i + 1)) / (cfg.enemies + 1);
        this.enemies.push({
          x: spawn.x,
          y: spawn.y,
          vx: Math.cos(angle) * cfg.speed,
          vy: Math.sin(angle) * cfg.speed,
          stallTicks: 0,
        });
      }
    }

    _spawnPoint(index, count) {
      const minX = BORDER + 2;
      const maxX = GRID_W - 1 - BORDER - 2;
      const minY = BORDER + 2;
      const maxY = GRID_H - 1 - BORDER - 2;
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = minX + ((col + 1) * (maxX - minX)) / 4;
      const y = minY + ((row + 1) * (maxY - minY)) / (Math.ceil(count / 3) + 1);
      return { x, y };
    }

    _movePlayer() {
      const dx = this._dir.x;
      const dy = this._dir.y;
      if (dx === 0 && dy === 0) return;

      const nx = this.player.x + dx;
      const ny = this.player.y + dy;
      if (nx < BORDER || nx > GRID_W - 1 - BORDER || ny < BORDER || ny > GRID_H - 1 - BORDER) return;

      const nextClaimed = this.claimed[ny][nx];
      const nextTrail = this.trail.has(key(nx, ny));

      if (!this.isDrawing) {
        if (nextClaimed) {
          this.player.x = nx;
          this.player.y = ny;
          return;
        }

        this.isDrawing = true;
        this.player.x = nx;
        this.player.y = ny;
        this.trail.add(key(nx, ny));
        return;
      }

      if (nextTrail) {
        this._loseLife("Trail crossed itself.");
        return;
      }

      this.player.x = nx;
      this.player.y = ny;

      if (nextClaimed) this._closeTrailAndCapture();
      else this.trail.add(key(nx, ny));
    }

    _updateEnemies(dt) {
      for (let i = 0; i < this.enemies.length; i++) this._updateEnemy(this.enemies[i], dt);
    }

    _updateEnemy(enemy, dt) {
      this._ensureEnemyInOpenArea(enemy);
      const prevX = enemy.x;
      const prevY = enemy.y;

      let remaining = dt;
      while (remaining > 0) {
        const stepDt = Math.min(remaining, 1 / 120);
        remaining -= stepDt;

        let nx = enemy.x + enemy.vx * stepDt;
        let ny = enemy.y + enemy.vy * stepDt;
        const hitX = this._blocked(Math.round(nx), Math.round(enemy.y));
        const hitY = this._blocked(Math.round(enemy.x), Math.round(ny));

        if (hitX) {
          enemy.vx *= -1;
          nx = enemy.x + enemy.vx * stepDt;
        }
        if (hitY) {
          enemy.vy *= -1;
          ny = enemy.y + enemy.vy * stepDt;
        }
        if (this._blocked(Math.round(nx), Math.round(ny))) {
          enemy.vx *= -1;
          enemy.vy *= -1;
          nx = enemy.x + enemy.vx * stepDt;
          ny = enemy.y + enemy.vy * stepDt;
          if (this._blocked(Math.round(nx), Math.round(ny))) {
            this._ensureEnemyInOpenArea(enemy);
            continue;
          }
        }

        const minX = BORDER + 1;
        const maxX = GRID_W - 1 - BORDER - 1;
        const minY = BORDER + 1;
        const maxY = GRID_H - 1 - BORDER - 1;
        enemy.x = Math.min(maxX, Math.max(minX, nx));
        enemy.y = Math.min(maxY, Math.max(minY, ny));

        if (hitX && hitY) {
          enemy.x += Math.sign(enemy.vx) * 0.35;
          enemy.y += Math.sign(enemy.vy) * 0.35;
          enemy.x = Math.min(maxX, Math.max(minX, enemy.x));
          enemy.y = Math.min(maxY, Math.max(minY, enemy.y));
        }
      }

      const moved = Math.hypot(enemy.x - prevX, enemy.y - prevY);
      enemy.stallTicks = moved < 0.02 ? enemy.stallTicks + 1 : 0;
      if (enemy.stallTicks > 10) {
        enemy.vx *= -1;
        enemy.vy *= -1;
        enemy.x += Math.sign(enemy.vx) * 0.6;
        enemy.y += Math.sign(enemy.vy) * 0.6;
        this._ensureEnemyInOpenArea(enemy);
        enemy.stallTicks = 0;
      }
    }

    _ensureEnemyInOpenArea(enemy) {
      const ex = Math.round(enemy.x);
      const ey = Math.round(enemy.y);
      if (!this._blocked(ex, ey)) return;

      for (let r = 1; r <= 8; r++) {
        for (let y = ey - r; y <= ey + r; y++) {
          for (let x = ex - r; x <= ex + r; x++) {
            if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) continue;
            if (!this._blocked(x, y)) {
              enemy.x = x;
              enemy.y = y;
              return;
            }
          }
        }
      }

      enemy.x = Math.floor(GRID_W / 2);
      enemy.y = Math.floor(GRID_H / 2);
    }

    _blocked(x, y) {
      if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return true;
      return this.claimed[y][x];
    }

    _checkEnemyTrailCollision() {
      if (!this.isDrawing) return;
      for (const enemy of this.enemies) {
        const ex = Math.round(enemy.x);
        const ey = Math.round(enemy.y);
        if (this.trail.has(key(ex, ey))) {
          this._loseLife("Enemy hit your trail.");
          return;
        }
      }
    }

    _closeTrailAndCapture() {
      const blocked = Array.from({ length: GRID_H }, (_, y) =>
        Array.from({ length: GRID_W }, (_, x) => this.claimed[y][x] || this.trail.has(key(x, y)))
      );

      const reachable = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(false));
      const q = [];

      for (const enemy of this.enemies) {
        const sx = Math.round(enemy.x);
        const sy = Math.round(enemy.y);
        const seed = this._findEnemySeed(blocked, sx, sy);
        if (!seed) continue;
        if (reachable[seed[1]][seed[0]]) continue;
        reachable[seed[1]][seed[0]] = true;
        q.push(seed);
      }

      while (q.length > 0) {
        const [x, y] = q.shift();
        const neighbors = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
          if (blocked[ny][nx] || reachable[ny][nx]) continue;
          reachable[ny][nx] = true;
          q.push([nx, ny]);
        }
      }

      let captured = 0;
      for (let y = BORDER; y <= GRID_H - 1 - BORDER; y++) {
        for (let x = BORDER; x <= GRID_W - 1 - BORDER; x++) {
          if (blocked[y][x]) continue;
          if (!reachable[y][x]) {
            this.claimed[y][x] = true;
            captured += 1;
          }
        }
      }

      for (const cell of this.trail) {
        const parts = cell.split(",");
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        this.claimed[y][x] = true;
      }

      this.trail.clear();
      this.isDrawing = false;
      for (const enemy of this.enemies) this._ensureEnemyInOpenArea(enemy);

      this.score += captured * 5;
      this._emit("score", this.score);
      this._recomputeCapture();

      if (captured > 0) {
        this.status = `Captured ${captured} cells.`;
        this._emit("status", this.status);
      }

      if (this.capturePercent >= this._levelCfg().targetCapture) {
        this.running = false;
        if (this.hasNextLevel()) {
          this.status = "Sector cleared.";
          this._emit("status", this.status);
          this._emit("win", {
            capture: this.capturePercent,
            score: this.score,
            level: this.level,
            final: false,
            nextLevel: this.level + 1,
          });
        } else {
          this.status = "All sectors cleared.";
          this._emit("status", this.status);
          this._emit("win", {
            capture: this.capturePercent,
            score: this.score,
            level: this.level,
            final: true,
            nextLevel: null,
          });
        }
      }
    }

    _findEnemySeed(blocked, sx, sy) {
      if (sx >= 0 && sx < GRID_W && sy >= 0 && sy < GRID_H && !blocked[sy][sx]) return [sx, sy];

      for (let r = 1; r <= 3; r++) {
        for (let y = sy - r; y <= sy + r; y++) {
          for (let x = sx - r; x <= sx + r; x++) {
            if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) continue;
            if (!blocked[y][x]) return [x, y];
          }
        }
      }
      return null;
    }

    _recomputeCapture() {
      const total = GRID_W * GRID_H;
      let owned = 0;
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          if (this.claimed[y][x]) owned += 1;
        }
      }
      this.capturePercent = Math.floor((owned / total) * 100);
      this._emit("capture", this.capturePercent);
    }

    _loseLife(reason) {
      this.lives -= 1;
      this._emit("lives", this.lives);

      this.isDrawing = false;
      this.trail.clear();
      this.player.x = 1;
      this.player.y = Math.floor(GRID_H / 2);
      this._dir.x = 0;
      this._dir.y = 0;

      this.status = reason;
      this._emit("status", this.status);

      if (this.lives <= 0) {
        this.running = false;
        this._emit("lose", { score: this.score, capture: this.capturePercent, level: this.level });
      }
    }
  }

  global.VolfiedGame = VolfiedGame;
  global.__VOLFIED_CONST = { GRID_W, GRID_H, CELL, MAX_LEVEL: LEVELS.length };
})(window);
