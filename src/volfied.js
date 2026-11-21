// Volfied core: territory capture on a grid, bouncing enemies, edge patrollers,
// a fuse that punishes stalling, power-ups, scoring, lives and levels.
// Coordinates: cell (cx, cy) covers [cx-0.5, cx+0.5] x [cy-0.5, cy+0.5] in enemy space,
// so an enemy at (x, y) sits inside cell (round(x), round(y)).
(function (global) {
  const GRID_W = 80;
  const GRID_H = 50;
  const CELL = 8;
  const PLAYER_STEP_S = 0.075;
  const BORDER = 1;
  const MINION_R = 0.6; // collision radius in cells (matches the drawn size)
  const BOSS_R = 1.1;
  const DEATH_FREEZE_S = 1.0;
  const RESPAWN_SAFE_S = 1.5; // patrollers can't hurt you right after a respawn
  const FUSE_DELAY_S = 0.5; // standing still this long while drawing lights the fuse
  const FUSE_SPEED = 10; // cells per second along your line
  const PATROL_STEP_S = 0.12;
  const EXTRA_LIFE_EVERY = 25000;
  const MAX_LIVES = 6;
  const START = { x: BORDER, y: Math.floor(GRID_H / 2) };

  // Interior = everything inside the starting border ring; capture % is measured against it.
  const IN_MIN_X = BORDER + 1;
  const IN_MAX_X = GRID_W - 2 - BORDER;
  const IN_MIN_Y = BORDER + 1;
  const IN_MAX_Y = GRID_H - 2 - BORDER;
  const INTERIOR = (IN_MAX_X - IN_MIN_X + 1) * (IN_MAX_Y - IN_MIN_Y + 1);

  const LEVELS = [
    { boss: 14.0, minions: 0, minionSpeed: 0, patrollers: 0, target: 75, par: 90 },
    { boss: 15.0, minions: 2, minionSpeed: 17.0, patrollers: 0, target: 75, par: 100 },
    { boss: 16.0, minions: 2, minionSpeed: 18.5, patrollers: 1, target: 77, par: 110 },
    { boss: 17.0, minions: 3, minionSpeed: 20.0, patrollers: 1, target: 78, par: 120 },
    { boss: 18.5, minions: 4, minionSpeed: 21.5, patrollers: 2, target: 80, par: 130 },
  ];

  const POWERS = {
    freeze: { label: "Freeze", duration: 4, weight: 35 },
    speed: { label: "Speed", duration: 8, weight: 30 },
    shield: { label: "Shield", duration: 6, weight: 25 },
    life: { label: "Extra life", duration: 0, weight: 10 },
  };
  const POWER_LIFETIME_S = 12;

  const SCORE = { perCell: 5, minion: 1000, overshootPerPct: 300, timePerSec: 25, perfect: 2000 };

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
      this.paused = false;
      // ready → playing ⇄ dying → (levelClear | gameOver)
      this.state = "ready";

      this._listeners = new Map();
      this._stepAcc = 0;
      this._sinceMove = 0;
      this._dyingTimer = 0;
      this._dir = { x: 0, y: 0 };

      this._startLevel(1, { resetScore: true, resetLives: true });
    }

    // ---- Events ----
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

    _fx(type, data) {
      this._emit("event", Object.assign({ type }, data));
    }

    emitAll() {
      this._emit("level", this.level);
      this._emit("score", this.score);
      this._emit("lives", this.lives);
      this._emit("capture", this.capturePercent);
      this._emit("pause", this.paused);
      this._emit("update");
    }

    // ---- Public API ----
    get target() {
      return this._levelCfg().target;
    }

    get levelConfig() {
      return Object.assign({}, this._levelCfg());
    }

    get stepSeconds() {
      return this.effects.speed > 0 ? PLAYER_STEP_S / 1.6 : PLAYER_STEP_S;
    }

    /** True while a run is underway and could be lost by restarting. */
    inProgress() {
      return this.state === "playing" || this.state === "dying" || (this.state === "ready" && (this.level > 1 || this.score > 0));
    }

    restart() {
      this.paused = false;
      this._startLevel(1, { resetScore: true, resetLives: true });
    }

    hasNextLevel() {
      return this.level < LEVELS.length;
    }

    /** Only valid after a level is cleared. */
    nextLevel() {
      if (this.state !== "levelClear" || !this.hasNextLevel()) return false;
      this._startLevel(this.level + 1, {});
      return true;
    }

    setPaused(p) {
      p = !!p;
      if (p && (this.state === "levelClear" || this.state === "gameOver")) return;
      if (this.paused === p) return;
      this.paused = p;
      if (p) this._dir = { x: 0, y: 0 };
      this._emit("pause", p);
    }

    togglePause() {
      this.setPaused(!this.paused);
    }

    /** Hold-to-move: (0, 0) stops the player. */
    setDirection(dx, dy) {
      if (dx !== 0 && dy !== 0) return;
      this._dir.x = dx;
      this._dir.y = dy;
      if ((dx || dy) && this.state === "ready" && !this.paused) this.state = "playing";
    }

    /** A fresh key press: step right away so quick taps always move one cell. */
    nudge(dx, dy) {
      this.setDirection(dx, dy);
      if (this.state !== "playing" || this.paused) return;
      if (this._sinceMove >= this.stepSeconds * 0.6) {
        this._movePlayer();
        this._sinceMove = 0;
        this._stepAcc = 0;
      }
    }

    step(dt) {
      if (this.paused) return;

      if (this.state === "dying") {
        this._dyingTimer -= dt;
        if (this._dyingTimer <= 0) this._finishDeath();
        this._emit("update");
        return;
      }
      if (this.state !== "playing") return;

      this.levelTime += dt;
      this._tickEffects(dt);

      if (this.effects.freeze <= 0) {
        this._updateEnemies(dt);
        if (this.state !== "playing") return;
        this._updatePatrollers(dt);
        if (this.state !== "playing") return;
      }

      const px = this.player.x, py = this.player.y;
      this._sinceMove += dt;
      if (this._dir.x === 0 && this._dir.y === 0) {
        this._stepAcc = 0;
      } else {
        this._stepAcc += dt;
        const stepS = this.stepSeconds;
        while (this._stepAcc >= stepS && this.state === "playing") {
          this._stepAcc -= stepS;
          this._movePlayer();
          this._sinceMove = 0;
        }
      }
      if (this.state !== "playing") return;
      this._updateFuse(dt, px !== this.player.x || py !== this.player.y);
      if (this.state !== "playing") return;
      this._updatePowerup(dt);

      this._emit("update");
    }

    // ---- Level setup ----
    _levelCfg() {
      return LEVELS[this.level - 1] || LEVELS[0];
    }

    _startLevel(level, opts) {
      this.level = Math.max(1, Math.min(LEVELS.length, level));
      if (opts.resetScore) {
        this.score = 0;
        this.nextLifeAt = EXTRA_LIFE_EVERY;
      }
      if (opts.resetLives) this.lives = 3;

      this.state = "ready";
      this._stepAcc = 0;
      this._sinceMove = PLAYER_STEP_S;
      this._dir = { x: 0, y: 0 };
      this.levelTime = 0;
      this.deathsThisLevel = 0;
      this.effects = { freeze: 0, speed: 0, shield: 0 };
      this.safeTimer = 0;
      this.fuse = null;
      this._idle = 0;
      this.powerup = null;
      this._powerTimer = 6 + Math.random() * 4;

      this._initField();
      this._spawnEntities();
      this.player = { x: START.x, y: START.y };
      this.drawStart = null;
      this.emitAll();
      this._emit("field");
    }

    _initField() {
      this.claimed = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(false));
      this.trail = new Set();
      this.trailPath = [];
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
      const bossA = -0.6 + Math.random() * 0.4;
      this.enemies.push({
        kind: "boss", r: BOSS_R, x: GRID_W * 0.62, y: GRID_H * 0.5,
        vx: Math.cos(bossA) * cfg.boss, vy: Math.sin(bossA) * cfg.boss,
        stallTicks: 0, wander: 2 + Math.random() * 2,
      });
      for (let i = 0; i < cfg.minions; i++) {
        const spawn = this._spawnPoint(i, cfg.minions);
        const angle = (Math.PI * 2 * (i + 1)) / (cfg.minions + 1) + 0.3;
        this.enemies.push({
          kind: "minion", r: MINION_R, x: spawn.x, y: spawn.y,
          vx: Math.cos(angle) * cfg.minionSpeed, vy: Math.sin(angle) * cfg.minionSpeed, stallTicks: 0,
        });
      }

      // Patrollers start on the border, away from the player's start on the left.
      const spots = [
        { x: GRID_W - 1 - BORDER, y: Math.floor(GRID_H / 2), dx: 0, dy: -1 },
        { x: Math.floor(GRID_W / 2), y: BORDER, dx: 1, dy: 0 },
        { x: Math.floor(GRID_W / 2), y: GRID_H - 1 - BORDER, dx: -1, dy: 0 },
      ];
      this.patrollers = [];
      for (let i = 0; i < cfg.patrollers; i++) {
        const s = spots[i % spots.length];
        this.patrollers.push({ x: s.x, y: s.y, px: s.x - s.dx, py: s.y - s.dy, acc: 0 });
      }
    }

    _spawnPoint(index, count) {
      const minX = BORDER + 2;
      const maxX = GRID_W - 1 - BORDER - 2;
      const minY = BORDER + 2;
      const maxY = GRID_H - 1 - BORDER - 2;
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = minX + ((col + 1.2) * (maxX - minX)) / 3.4;
      const y = minY + ((row + 1) * (maxY - minY)) / (Math.ceil(count / 2) + 1);
      return { x, y };
    }

    // ---- Scoring ----
    _addScore(n) {
      if (n <= 0) return;
      this.score += n;
      this._emit("score", this.score);
      while (this.score >= this.nextLifeAt) {
        this.nextLifeAt += EXTRA_LIFE_EVERY;
        this._gainLife();
      }
    }

    _gainLife() {
      if (this.lives >= MAX_LIVES) return;
      this.lives += 1;
      this._emit("lives", this.lives);
      this._fx("extraLife", { x: this.player.x, y: this.player.y });
    }

    // ---- Player ----
    _movePlayer() {
      const dx = this._dir.x;
      const dy = this._dir.y;
      if (dx === 0 && dy === 0) return;

      const nx = this.player.x + dx;
      const ny = this.player.y + dy;
      if (nx < BORDER || nx > GRID_W - 1 - BORDER || ny < BORDER || ny > GRID_H - 1 - BORDER) return;

      const nextClaimed = this.claimed[ny][nx];

      if (!this.isDrawing) {
        this.player.x = nx;
        this.player.y = ny;
        if (nextClaimed) {
          this._checkPatrollerHit();
          return;
        }
        this.isDrawing = true;
        this._idle = 0;
        this.drawStart = { x: nx - dx, y: ny - dy };
        this._addTrail(nx, ny);
        this._fx("startDraw", { x: nx, y: ny });
        // An enemy may already be sitting on the cell we just cut into.
        if (this._enemyOnTrail()) this._lineHit("An enemy hit your line.");
        return;
      }

      // Your own line is a wall: reversing or looping back simply doesn't move.
      if (this.trail.has(key(nx, ny))) return;

      this.player.x = nx;
      this.player.y = ny;

      if (nextClaimed) {
        this._closeTrailAndCapture(nx, ny);
        if (this.state === "playing") this._checkPatrollerHit();
      } else {
        this._addTrail(nx, ny);
        this._fx("draw", { x: nx, y: ny });
        if (this._enemyOnTrail()) this._lineHit("An enemy hit your line.");
      }
    }

    _addTrail(x, y) {
      this.trail.add(key(x, y));
      this.trailPath.push([x, y]);
    }

    /** A hit on the line: the shield absorbs it, otherwise it costs a life. */
    _lineHit(reason) {
      if (this.effects.shield > 0) return false;
      this._loseLife(reason);
      return true;
    }

    // ---- Fuse: stall mid-line and a spark burns along it toward you ----
    _updateFuse(dt, moved) {
      if (!this.isDrawing) {
        this.fuse = null;
        this._idle = 0;
        return;
      }
      this._idle = moved ? 0 : this._idle + dt;
      if (this._idle >= FUSE_DELAY_S) {
        if (!this.fuse) {
          this.fuse = { pos: 0 };
          this._fx("fuseLit", {});
        }
        this.fuse.pos += FUSE_SPEED * dt;
        if (this.fuse.pos >= this.trailPath.length - 1) {
          if (this.effects.shield > 0) this.fuse.pos = Math.max(0, this.trailPath.length - 1.01);
          else this._loseLife("The fuse caught up with you.");
        }
      } else if (this.fuse) {
        // Moving again: the spark burns back out.
        this.fuse.pos -= FUSE_SPEED * dt;
        if (this.fuse.pos <= 0) this.fuse = null;
      }
    }

    // ---- Enemies (boss + minions) ----
    _updateEnemies(dt) {
      for (const e of this.enemies) {
        if (e.kind !== "boss") continue;
        e.wander -= dt;
        if (e.wander <= 0) {
          // The boss drifts to a new heading now and then so it can't be read too easily.
          e.wander = 2 + Math.random() * 2;
          const a = Math.atan2(e.vy, e.vx) + (Math.random() - 0.5) * 1.2;
          const s = Math.hypot(e.vx, e.vy);
          e.vx = Math.cos(a) * s;
          e.vy = Math.sin(a) * s;
        }
      }
      let remaining = dt;
      // Sub-step so fast enemies can't tunnel through a 1-cell line.
      while (remaining > 1e-9) {
        const stepDt = Math.min(remaining, 1 / 120);
        remaining -= stepDt;
        for (const enemy of this.enemies) this._moveEnemy(enemy, stepDt);
        if (this.isDrawing && this._enemyOnTrail() && this._lineHit("An enemy hit your line.")) return;
      }
      for (const enemy of this.enemies) this._checkStall(enemy);
    }

    _blockedAt(px, py) {
      return this._blocked(Math.round(px), Math.round(py));
    }

    _moveEnemy(enemy, dt) {
      this._ensureEnemyInOpenArea(enemy);
      if (enemy._stallX === undefined) {
        enemy._stallX = enemy.x;
        enemy._stallY = enemy.y;
      }
      // Probe a little ahead (< 0.5 for minions so 1-cell gaps still fit; the boss is bulkier).
      const probe = (enemy.r || MINION_R) > 1 ? 0.9 : 0.45;
      const sx = Math.sign(enemy.vx);
      const sy = Math.sign(enemy.vy);
      let nx = enemy.x + enemy.vx * dt;
      let ny = enemy.y + enemy.vy * dt;

      const hitX = this._blockedAt(nx + sx * probe, enemy.y);
      const hitY = this._blockedAt(enemy.x, ny + sy * probe);
      if (hitX) {
        enemy.vx *= -1;
        nx = enemy.x;
      }
      if (hitY) {
        enemy.vy *= -1;
        ny = enemy.y;
      }
      if (!hitX && !hitY && this._blockedAt(nx + sx * probe, ny + sy * probe)) {
        // Corner: bounce straight back.
        enemy.vx *= -1;
        enemy.vy *= -1;
        nx = enemy.x;
        ny = enemy.y;
      }
      if (!this._blockedAt(nx, ny)) {
        enemy.x = nx;
        enemy.y = ny;
      }
    }

    _checkStall(enemy) {
      const moved = Math.hypot(enemy.x - enemy._stallX, enemy.y - enemy._stallY);
      enemy._stallX = enemy.x;
      enemy._stallY = enemy.y;
      enemy.stallTicks = moved < 0.02 ? enemy.stallTicks + 1 : 0;
      if (enemy.stallTicks > 10) {
        // Wedged in a pocket: try a fresh random heading.
        const speed = Math.hypot(enemy.vx, enemy.vy);
        const a = Math.random() * Math.PI * 2;
        enemy.vx = Math.cos(a) * speed;
        enemy.vy = Math.sin(a) * speed;
        this._ensureEnemyInOpenArea(enemy);
        enemy.stallTicks = 0;
      }
    }

    _ensureEnemyInOpenArea(enemy) {
      const ex = Math.round(enemy.x);
      const ey = Math.round(enemy.y);
      if (!this._blocked(ex, ey)) return true;

      const maxR = Math.max(GRID_W, GRID_H);
      for (let r = 1; r <= maxR; r++) {
        for (let y = ey - r; y <= ey + r; y++) {
          for (let x = ex - r; x <= ex + r; x++) {
            if (Math.abs(x - ex) !== r && Math.abs(y - ey) !== r) continue; // ring only
            if (!this._blocked(x, y)) {
              enemy.x = x;
              enemy.y = y;
              return true;
            }
          }
        }
      }
      return false;
    }

    _blocked(x, y) {
      if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return true;
      return this.claimed[y][x];
    }

    /** Circle (enemy) vs. square (trail cell) overlap. */
    _enemyOnTrail() {
      if (!this.isDrawing) return false;
      for (const enemy of this.enemies) {
        const R = enemy.r || MINION_R;
        const x0 = Math.round(enemy.x - R);
        const x1 = Math.round(enemy.x + R);
        const y0 = Math.round(enemy.y - R);
        const y1 = Math.round(enemy.y + R);
        for (let cy = y0; cy <= y1; cy++) {
          for (let cx = x0; cx <= x1; cx++) {
            if (!this.trail.has(key(cx, cy))) continue;
            const qx = Math.max(cx - 0.5, Math.min(enemy.x, cx + 0.5));
            const qy = Math.max(cy - 0.5, Math.min(enemy.y, cy + 0.5));
            if ((enemy.x - qx) ** 2 + (enemy.y - qy) ** 2 < R * R) return true;
          }
        }
      }
      return false;
    }

    // ---- Patrollers: crawl along the edge of claimed land, where you walk ----
    /** A claimed cell touching open interior (8-neighbourhood). */
    isEdgeCell(x, y) {
      if (x < BORDER || x > GRID_W - 1 - BORDER || y < BORDER || y > GRID_H - 1 - BORDER) return false;
      if (!this.claimed[y][x]) return false;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox, ny = y + oy;
          if (nx < IN_MIN_X || nx > IN_MAX_X || ny < IN_MIN_Y || ny > IN_MAX_Y) continue;
          if (!this.claimed[ny][nx]) return true;
        }
      }
      return false;
    }

    _updatePatrollers(dt) {
      for (const p of this.patrollers) {
        p.acc += dt;
        while (p.acc >= PATROL_STEP_S) {
          p.acc -= PATROL_STEP_S;
          this._stepPatroller(p);
          if (this._checkPatrollerHit()) return;
        }
      }
    }

    _stepPatroller(p) {
      if (!this.isEdgeCell(p.x, p.y)) this._snapPatroller(p);
      const dx = p.x - p.px, dy = p.y - p.py;
      const options = [];
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p.x + ox, ny = p.y + oy;
        if (nx === p.px && ny === p.py) continue;
        if (this.isEdgeCell(nx, ny)) options.push([nx, ny, ox === dx && oy === dy]);
      }
      let next;
      if (!options.length) next = [p.px, p.py]; // dead end: turn around
      else {
        const straight = options.find((o) => o[2]);
        next = straight && Math.random() < 0.7 ? straight : options[(Math.random() * options.length) | 0];
      }
      p.px = p.x;
      p.py = p.y;
      p.x = next[0];
      p.y = next[1];
    }

    /** After a capture swallows its path, jump to the nearest edge cell. */
    _snapPatroller(p) {
      let bestD = Infinity, bx = p.x, by = p.y;
      for (let y = BORDER; y <= GRID_H - 1 - BORDER; y++) {
        for (let x = BORDER; x <= GRID_W - 1 - BORDER; x++) {
          const d = Math.abs(x - p.x) + Math.abs(y - p.y);
          if (d < bestD && this.isEdgeCell(x, y)) {
            bestD = d;
            bx = x;
            by = y;
          }
        }
      }
      p.px = p.x = bx;
      p.py = p.y = by;
    }

    _checkPatrollerHit() {
      if (this.state !== "playing" || this.safeTimer > 0 || this.effects.shield > 0) return false;
      for (const p of this.patrollers) {
        if (p.x === this.player.x && p.y === this.player.y) {
          this._loseLife("A patroller caught you on the edge.");
          return true;
        }
      }
      return false;
    }

    // ---- Power-ups: appear in open space, collected by enclosing them ----
    _tickEffects(dt) {
      for (const k of Object.keys(this.effects)) {
        if (this.effects[k] > 0) {
          this.effects[k] = Math.max(0, this.effects[k] - dt);
          if (this.effects[k] === 0) this._fx("powerEnd", { kind: k });
        }
      }
      if (this.safeTimer > 0) this.safeTimer = Math.max(0, this.safeTimer - dt);
    }

    _updatePowerup(dt) {
      if (this.powerup) {
        this.powerup.ttl -= dt;
        if (this.powerup.ttl <= 0) {
          this._fx("powerExpire", { x: this.powerup.x, y: this.powerup.y });
          this.powerup = null;
          this._powerTimer = 8 + Math.random() * 6;
        }
        return;
      }
      this._powerTimer -= dt;
      if (this._powerTimer > 0) return;
      this._powerTimer = 2; // retry soon if no good spot right now
      const spot = this._findPowerSpot();
      if (!spot) return;
      const kind = this._rollPower();
      this.powerup = { x: spot.x, y: spot.y, kind, ttl: POWER_LIFETIME_S, max: POWER_LIFETIME_S };
      this._fx("powerSpawn", { x: spot.x, y: spot.y, kind });
    }

    _rollPower() {
      const pool = Object.entries(POWERS).filter(([k]) => k !== "life" || this.lives < MAX_LIVES);
      let roll = Math.random() * pool.reduce((s, [, v]) => s + v.weight, 0);
      for (const [k, v] of pool) {
        roll -= v.weight;
        if (roll <= 0) return k;
      }
      return pool[0][0];
    }

    _findPowerSpot() {
      for (let tries = 0; tries < 60; tries++) {
        const x = IN_MIN_X + 2 + ((Math.random() * (IN_MAX_X - IN_MIN_X - 3)) | 0);
        const y = IN_MIN_Y + 2 + ((Math.random() * (IN_MAX_Y - IN_MIN_Y - 3)) | 0);
        let ok = true;
        for (let oy = -2; oy <= 2 && ok; oy++) for (let ox = -2; ox <= 2 && ok; ox++) if (this.claimed[y + oy][x + ox]) ok = false;
        if (!ok) continue;
        if (this.enemies.some((e) => Math.hypot(e.x - x, e.y - y) < 6)) continue;
        return { x, y };
      }
      return null;
    }

    _collectPower(p) {
      const def = POWERS[p.kind];
      if (p.kind === "life") this._gainLife();
      else this.effects[p.kind] = def.duration;
      this._fx("powerGet", { x: p.x, y: p.y, kind: p.kind, label: def.label });
      this._emit("status", `${def.label}!`);
    }

    // ---- Capture ----
    _closeTrailAndCapture(endX, endY) {
      const blocked = Array.from({ length: GRID_H }, (_, y) =>
        Array.from({ length: GRID_W }, (_, x) => this.claimed[y][x] || this.trail.has(key(x, y)))
      );

      // Only the boss keeps its side open; minions on the other side are wiped out.
      const reachable = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(false));
      const q = [];
      const bosses = this.enemies.filter((e) => e.kind === "boss");
      for (const enemy of bosses.length ? bosses : this.enemies) {
        const seed = this._findEnemySeed(blocked, Math.round(enemy.x), Math.round(enemy.y));
        if (!seed || reachable[seed[1]][seed[0]]) continue;
        reachable[seed[1]][seed[0]] = true;
        q.push(seed);
      }

      for (let head = 0; head < q.length; head++) {
        const [x, y] = q[head];
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

      const cells = [];
      for (let y = BORDER; y <= GRID_H - 1 - BORDER; y++) {
        for (let x = BORDER; x <= GRID_W - 1 - BORDER; x++) {
          if (blocked[y][x] || reachable[y][x]) continue;
          this.claimed[y][x] = true;
          cells.push([x, y]);
        }
      }
      const trailCells = this.trailPath.slice();
      for (const [x, y] of trailCells) this.claimed[y][x] = true;

      this.trail.clear();
      this.trailPath = [];
      this.isDrawing = false;
      this.drawStart = null;
      this.fuse = null;

      // Minions caught on the captured side are destroyed.
      const killed = [];
      this.enemies = this.enemies.filter((e) => {
        if (e.kind === "boss") return true;
        const ex = Math.round(e.x), ey = Math.round(e.y);
        if (this.claimed[ey] && this.claimed[ey][ex]) {
          killed.push(e);
          return false;
        }
        return true;
      });
      for (const enemy of this.enemies) this._ensureEnemyInOpenArea(enemy);

      const before = this.capturePercent;
      this._recomputeCapture();
      const gained = this.capturePercent - before;

      // Bigger cuts pay more per cell.
      const mult = gained >= 20 ? 3 : gained >= 10 ? 2 : 1;
      const points = cells.length * SCORE.perCell * mult;
      this._addScore(points);

      let cx = endX;
      let cy = endY;
      if (cells.length) {
        cx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
        cy = cells.reduce((s, c) => s + c[1], 0) / cells.length;
      }
      this._emit("field");
      this._fx("capture", { cells, trail: trailCells, gained, mult, points, x: cx, y: cy, endX, endY, size: cells.length });

      for (const e of killed) {
        this._addScore(SCORE.minion);
        this._fx("minionKill", { x: e.x, y: e.y, points: SCORE.minion });
      }

      if (this.powerup && this.claimed[this.powerup.y][this.powerup.x]) {
        const p = this.powerup;
        this.powerup = null;
        this._powerTimer = 8 + Math.random() * 6;
        this._collectPower(p);
      }

      if (this.capturePercent >= this.target) this._clearLevel();
    }

    _clearLevel() {
      const cfg = this._levelCfg();
      const bonus = {
        overshoot: Math.max(0, this.capturePercent - cfg.target) * SCORE.overshootPerPct,
        time: Math.max(0, Math.round(cfg.par - this.levelTime)) * SCORE.timePerSec,
        perfect: this.deathsThisLevel === 0 ? SCORE.perfect : 0,
      };
      bonus.total = bonus.overshoot + bonus.time + bonus.perfect;
      this.state = "levelClear";
      this._dir = { x: 0, y: 0 };
      this.powerup = null;
      this._addScore(bonus.total);
      const final = !this.hasNextLevel();
      this._fx("clear", { final, bonus });
      this._emit("win", {
        capture: this.capturePercent,
        score: this.score,
        level: this.level,
        time: this.levelTime,
        bonus,
        final,
        nextLevel: final ? null : this.level + 1,
      });
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
      let owned = 0;
      for (let y = IN_MIN_Y; y <= IN_MAX_Y; y++) {
        for (let x = IN_MIN_X; x <= IN_MAX_X; x++) {
          if (this.claimed[y][x]) owned += 1;
        }
      }
      this.capturePercent = Math.floor((owned / INTERIOR) * 100);
      this._emit("capture", this.capturePercent);
    }

    // ---- Lives ----
    _loseLife(reason) {
      if (this.state !== "playing") return;
      this.lives -= 1;
      this.deathsThisLevel += 1;
      this._emit("lives", this.lives);
      this._fx("death", { x: this.player.x, y: this.player.y, trail: this.trailPath.slice(), reason });
      this._emit("status", reason);
      this.state = "dying";
      this._dyingTimer = DEATH_FREEZE_S;
      this._dir = { x: 0, y: 0 };
      this.fuse = null;
    }

    _finishDeath() {
      // Respawn where the line began (on claimed land, out of the enemies' reach).
      const back = this.drawStart || START;
      this.isDrawing = false;
      this.trail.clear();
      this.trailPath = [];
      this.drawStart = null;
      this.player.x = back.x;
      this.player.y = back.y;
      this._stepAcc = 0;
      this._idle = 0;
      this._dir = { x: 0, y: 0 };

      if (this.lives <= 0) {
        this.state = "gameOver";
        this._fx("gameOver", {});
        this._emit("lose", { score: this.score, capture: this.capturePercent, level: this.level });
      } else {
        this.state = "playing";
        this.safeTimer = RESPAWN_SAFE_S;
        this._fx("respawn", { x: back.x, y: back.y });
      }
    }
  }

  global.VolfiedGame = VolfiedGame;
  global.__VOLFIED_CONST = {
    GRID_W, GRID_H, CELL, MAX_LEVEL: LEVELS.length, MINION_R, BOSS_R, POWERS, EXTRA_LIFE_EVERY, SCORE,
  };
})(typeof window !== "undefined" ? window : globalThis);
