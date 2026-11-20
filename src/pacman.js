// Pac-Man: minimalist retro maze chase
// Engine only: no DOM. The UI listens to events and reads public state for rendering.
//
// Round flow (this.state):
//   ready      -> waiting for first input (readyTimer === null) or a short countdown
//   playing    -> normal play
//   dying      -> death animation, then ready (or gameOver when out of lives)
//   levelClear -> maze flash, then the next level starts in ready
//   gameOver   -> frozen until restart()
// `paused` is a separate flag that freezes everything except gameOver/ready-waiting.
(function (global) {
  const TILE = 16; // tile size in pixels
  const STEP = 1 / 60; // physics timestep
  const PAC_SPEED = 75; // px/s
  const GHOST_SPEED = 68; // px/s (slower than Pac when not frightened)
  const FRIGHT_SPEED = 55; // px/s when frightened
  const HOUSE_SPEED = 45; // px/s while scripted out of the house
  const POWER_TIME = 6.0; // seconds of power pellet
  const SPRITE_RADIUS = TILE * 0.45; // visual radius used to stop before walls

  const READY_TIME = 1.6; // countdown after a death / new level
  const DEATH_TIME = 1.5; // death animation length
  const CLEAR_TIME = 2.0; // level-clear flash length
  const RELEASE_TIMES = [0, 2, 5, 8]; // seconds into a round when each ghost leaves
  const RESPAWN_DELAY = 1.5; // eaten ghost waits this long in the house

  // 28 x 28 tiles.
  // '#' wall, '-' ghost-house door, '.' pellet, 'o' power pellet, ' ' empty,
  // 'P' Pac spawn, 'G' first ghost (starts outside the door). The other ghosts start in the house.
  const MAZE = [
    "############################",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#o####.#####.##.#####.####o#",
    "#.####.#####.##.#####.####.#",
    "#..........................#",
    "#.####.##.########.##.####.#",
    "#.####.##.########.##.####.#",
    "#......##....##....##......#",
    "######.##### ## #####.######",
    "     #.##### ## #####.#     ",
    "     #.##    G     ##.#     ",
    "     #.## ###--### ##.#     ",
    "######.## #      # ##.######",
    "      .   #      #   .      ",
    "######.## #      # ##.######",
    "     #.## ######## ##.#     ",
    "     #.##    P     ##.#     ",
    "     #.##### ## #####.#     ",
    "######.##### ## #####.######",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#o..##................##..o#",
    "###.##.##.########.##.##.###",
    "#......##....##....##......#",
    "#.##########.##.##########.#",
    "#..........................#",
    "############################",
  ];

  const GHOST_COLORS = ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852'];

  function parseLevel(rows) {
    const grid = rows.map(r => r.split(""));
    const rowsN = grid.length, colsN = grid[0].length;
    const pellets = new Set();
    const powers = new Set();
    const door = [];
    let pacSpawn = { x: 13, y: 17 };
    let ghostSpawn = null;
    for (let y = 0; y < rowsN; y++) {
      for (let x = 0; x < colsN; x++) {
        const t = grid[y][x];
        if (t === '.') pellets.add(key(x, y));
        if (t === 'o') powers.add(key(x, y));
        if (t === '-') door.push({ x, y });
        if (t === 'P') { pacSpawn = { x, y }; grid[y][x] = ' '; }
        if (t === 'G') { ghostSpawn = { x, y }; grid[y][x] = ' '; }
      }
    }
    // Ghost house geometry (pixels): door centre, the exit point above it, and the house floor
    const doorX = door.length ? (door[0].x + door[door.length - 1].x + 1) * TILE / 2 : 14 * TILE;
    const doorRow = door.length ? door[0].y : 12;
    const exit = ghostSpawn
      ? { x: ghostSpawn.x * TILE + TILE / 2, y: ghostSpawn.y * TILE + TILE / 2 }
      : { x: doorX - TILE / 2, y: (doorRow - 1) * TILE + TILE / 2 };
    const house = { x: doorX, y: (doorRow + 2) * TILE + TILE / 2 };
    return { rows: rowsN, cols: colsN, grid, pellets, powers, door, pacSpawn, exit, house };
  }

  function key(x, y) { return `${x},${y}`; }

  function isTunnelRow(level, gy) {
    if (gy < 0 || gy >= level.rows) return false;
    return level.grid[gy][0] === ' ' && level.grid[gy][level.cols - 1] === ' ';
  }

  // Walls and the house door are solid for Pac and for ghosts roaming the maze.
  // (Ghosts get in and out of the house with scripted movement, not grid movement.)
  function blocked(level, gx, gy) {
    if (gy < 0 || gy >= level.rows) return true;
    let x = gx;
    if (gx < 0 || gx >= level.cols) {
      if (!isTunnelRow(level, gy)) return true;
      x = (gx + level.cols) % level.cols;
    }
    const t = level.grid[gy][x];
    return t === '#' || t === '-';
  }

  function wrapX(level, px) {
    const w = level.cols * TILE;
    if (px < 0) return px + w;
    if (px >= w) return px - w;
    return px;
  }

  function atTileCenter(px, py) {
    const { cx, cy } = centerCoords(px, py);
    return Math.abs(px - cx) < 0.6 && Math.abs(py - cy) < 0.6;
  }

  function centerCoords(px, py) {
    const gx = Math.floor(px / TILE);
    const gy = Math.floor(py / TILE);
    return { cx: gx * TILE + TILE / 2, cy: gy * TILE + TILE / 2 };
  }

  function dirVec(dir) {
    switch (dir) {
      case 'left': return { dx: -1, dy: 0 };
      case 'right': return { dx: 1, dy: 0 };
      case 'up': return { dx: 0, dy: -1 };
      case 'down': return { dx: 0, dy: 1 };
      default: return { dx: 0, dy: 0 };
    }
  }

  function opp(dir) {
    return dir === 'left' ? 'right' : dir === 'right' ? 'left' : dir === 'up' ? 'down' : 'up';
  }

  function possibleDirs(level, gx, gy) {
    const dirs = [];
    if (!blocked(level, gx - 1, gy)) dirs.push('left');
    if (!blocked(level, gx + 1, gy)) dirs.push('right');
    if (!blocked(level, gx, gy - 1)) dirs.push('up');
    if (!blocked(level, gx, gy + 1)) dirs.push('down');
    return dirs;
  }

  function distance(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function approach(cur, target, maxStep) {
    const d = target - cur;
    if (Math.abs(d) <= maxStep) return target;
    return cur + Math.sign(d) * maxStep;
  }

  class PacmanGame {
    constructor() {
      this.level = parseLevel(MAZE);
      this.width = this.level.cols * TILE;
      this.height = this.level.rows * TILE;
      this.score = 0;
      this.lives = 3;
      this.levelNum = 1;
      this.clock = 0; // total simulated time, used for animation
      this.acc = 0;
      this.paused = false;
      this.resetRound();
      this.setState('ready', null); // wait for the player's first input
    }

    on(ev, fn) { this._ls = this._ls || new Map(); const a = this._ls.get(ev) || []; a.push(fn); this._ls.set(ev, a); return () => this.off(ev, fn); }
    off(ev, fn) { const a = (this._ls && this._ls.get(ev)) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    emit(ev, p) { const a = (this._ls && this._ls.get(ev)) || []; a.forEach(f => f(p)); }

    setState(state, timer) {
      this.state = state;
      this.stateTimer = timer;
      this.emit('state', state);
    }

    // Seconds left on the ready countdown, or null when waiting for input
    get readyTimer() { return this.state === 'ready' ? this.stateTimer : null; }
    // 0..1 progress through the death animation
    get deathProgress() { return this.state === 'dying' ? 1 - this.stateTimer / DEATH_TIME : 0; }
    // 0..1 progress through the level-clear flash
    get clearProgress() { return this.state === 'levelClear' ? 1 - this.stateTimer / CLEAR_TIME : 0; }

    resetRound() {
      const lv = this.level;
      this.roundTime = 0;
      this.powerTimer = 0;
      this.pac = {
        x: lv.pacSpawn.x * TILE + TILE / 2,
        y: lv.pacSpawn.y * TILE + TILE / 2,
        dir: 'left',
        want: 'left',
      };
      // Ghost 0 starts outside the door; the others wait in the house, spread across its floor
      const housePos = [-2 * TILE, 0, 2 * TILE];
      this.ghosts = GHOST_COLORS.map((color, i) => {
        const outside = i === 0;
        const x = outside ? lv.exit.x : lv.house.x + housePos[i - 1];
        const y = outside ? lv.exit.y : lv.house.y;
        return {
          x, y,
          homeX: x, homeY: y,
          dir: 'left',
          color,
          frightened: false,
          state: outside ? 'active' : 'house', // 'house' | 'leaving' | 'active'
          releaseAt: RELEASE_TIMES[i],
        };
      });
      this.emit('lives', this.lives);
      this.emit('score', this.score);
      this.emit('update');
    }

    restart() {
      this.level = parseLevel(MAZE);
      this.score = 0;
      this.lives = 3;
      this.levelNum = 1;
      this.acc = 0;
      this.paused = false;
      this.resetRound();
      this.emit('level', this.levelNum);
      this.emit('pause', false);
      this.setState('ready', READY_TIME);
    }

    nextLevel() {
      this.level = parseLevel(MAZE);
      this.levelNum += 1;
      this.acc = 0;
      this.resetRound();
      this.emit('level', this.levelNum);
      this.setState('ready', READY_TIME);
    }

    input(dir) {
      if (this.state === 'gameOver' || this.paused) return;
      this.pac.want = dir;
      if (this.state === 'ready' && this.stateTimer === null) this.setState('playing', 0);
    }

    canPause() {
      return this.state === 'playing' || this.state === 'dying' || this.state === 'levelClear' ||
        (this.state === 'ready' && this.stateTimer !== null);
    }

    setPaused(p) {
      p = !!p;
      if (p && !this.canPause()) return;
      if (p === this.paused) return;
      this.paused = p;
      this.emit('pause', p);
    }

    togglePause() { this.setPaused(!this.paused); }

    step(dt) {
      if (!this.paused) {
        this.acc += dt;
        while (this.acc >= STEP) {
          this.tick(STEP);
          this.acc -= STEP;
        }
      }
      this.emit('update');
    }

    tick(dt) {
      this.clock += dt;
      switch (this.state) {
        case 'ready':
          this.bobHouseGhosts();
          if (this.stateTimer !== null) {
            this.stateTimer -= dt;
            if (this.stateTimer <= 0) this.setState('playing', 0);
          }
          return;
        case 'dying':
          this.stateTimer -= dt;
          if (this.stateTimer <= 0) {
            if (this.lives <= 0) {
              this.setState('gameOver', 0);
              this.emit('gameover', { score: this.score, level: this.levelNum });
            } else {
              this.resetRound();
              this.setState('ready', READY_TIME);
            }
          }
          return;
        case 'levelClear':
          this.stateTimer -= dt;
          if (this.stateTimer <= 0) this.nextLevel();
          return;
        case 'playing':
          this.tickPlaying(dt);
          return;
        default:
          return; // gameOver
      }
    }

    tickPlaying(dt) {
      this.roundTime += dt;

      // Power timer
      if (this.powerTimer > 0) {
        this.powerTimer = Math.max(0, this.powerTimer - dt);
        if (this.powerTimer === 0) {
          for (const g of this.ghosts) g.frightened = false;
        }
      }

      this.movePac(dt);

      // Eat pellets/power
      const gx = Math.floor(this.pac.x / TILE), gy = Math.floor(this.pac.y / TILE);
      const k = key(gx, gy);
      if (this.level.pellets.has(k)) { this.level.pellets.delete(k); this.score += 10; this.emit('score', this.score); }
      if (this.level.powers.has(k)) { this.level.powers.delete(k); this.score += 50; this.emit('score', this.score); this.powerUp(); }

      if (this.level.pellets.size === 0 && this.level.powers.size === 0) {
        this.powerTimer = 0;
        for (const g of this.ghosts) g.frightened = false;
        this.setState('levelClear', CLEAR_TIME);
        this.emit('levelclear', this.levelNum);
        return;
      }

      for (const g of this.ghosts) this.moveGhost(g, dt);

      // Collisions Pac vs Ghosts (ghosts still inside the house can't touch Pac)
      for (const g of this.ghosts) {
        if (g.state === 'house') continue;
        const dx = g.x - this.pac.x, dy = g.y - this.pac.y;
        if (dx * dx + dy * dy < (TILE * 0.5) * (TILE * 0.5)) {
          if (g.frightened) {
            this.sendHome(g);
            this.score += 200; this.emit('score', this.score);
          } else {
            this.lives -= 1; this.emit('lives', this.lives);
            this.powerTimer = 0;
            this.setState('dying', DEATH_TIME);
            this.emit('death', this.lives);
            return;
          }
        }
      }
    }

    movePac(dt) {
      // Grid-based movement with buffered turns and wall clamping
      let gx = Math.floor(this.pac.x / TILE), gy = Math.floor(this.pac.y / TILE);
      const { cx, cy } = centerCoords(this.pac.x, this.pac.y);
      const tol = 1.5; // tolerance for turning/snap to avoid wall overlap
      if (this.pac.want) {
        const wantV = dirVec(this.pac.want);
        // Snap to tile center on the perpendicular axis if close
        if (wantV.dy !== 0 && Math.abs(this.pac.x - cx) <= tol) this.pac.x = cx;
        if (wantV.dx !== 0 && Math.abs(this.pac.y - cy) <= tol) this.pac.y = cy;
        gx = Math.floor(this.pac.x / TILE); gy = Math.floor(this.pac.y / TILE);
        // If desired direction is open from the current tile, allow the turn immediately
        if (wantV.dy !== 0 && Math.abs(this.pac.x - cx) <= tol && !blocked(this.level, gx, gy + wantV.dy)) this.pac.dir = this.pac.want;
        if (wantV.dx !== 0 && Math.abs(this.pac.y - cy) <= tol && !blocked(this.level, gx + wantV.dx, gy)) this.pac.dir = this.pac.want;
      }
      // Allow immediate reversal mid-tile
      if (this.pac.want && this.pac.want === opp(this.pac.dir)) {
        const rv = dirVec(this.pac.want);
        const rgx = Math.floor(this.pac.x / TILE), rgy = Math.floor(this.pac.y / TILE);
        if (!blocked(this.level, rgx + rv.dx, rgy + rv.dy)) this.pac.dir = this.pac.want;
      }
      let pv = dirVec(this.pac.dir);
      const speed = PAC_SPEED * dt;
      if (pv.dx !== 0 || pv.dy !== 0) {
        gx = Math.floor(this.pac.x / TILE); gy = Math.floor(this.pac.y / TILE);
        let nx = gx + pv.dx, ny = gy + pv.dy;
        // If forward is blocked, allow immediate perpendicular turn if open (force snap)
        if (blocked(this.level, nx, ny) && this.pac.want && this.pac.want !== this.pac.dir) {
          const wantV = dirVec(this.pac.want);
          const c = centerCoords(this.pac.x, this.pac.y);
          const tolTurn = 2;
          if (wantV.dy !== 0) {
            if (Math.abs(this.pac.x - c.cx) <= tolTurn) this.pac.x = c.cx;
            if (!blocked(this.level, gx, gy + wantV.dy)) this.pac.dir = this.pac.want;
          } else if (wantV.dx !== 0) {
            if (Math.abs(this.pac.y - c.cy) <= tolTurn) this.pac.y = c.cy;
            if (!blocked(this.level, gx + wantV.dx, gy)) this.pac.dir = this.pac.want;
          }
          pv = dirVec(this.pac.dir);
          nx = gx + pv.dx; ny = gy + pv.dy;
        }
        const move = this.clampMove(this.pac, pv, speed, blocked(this.level, nx, ny));
        this.pac.x += pv.dx * move;
        this.pac.y += pv.dy * move;
        // Keep aligned to grid perpendicular to movement to help turning
        const c2 = centerCoords(this.pac.x, this.pac.y);
        const tolAlign = 4;
        if (pv.dx !== 0 && Math.abs(this.pac.y - c2.cy) <= tolAlign) this.pac.y = c2.cy;
        if (pv.dy !== 0 && Math.abs(this.pac.x - c2.cx) <= tolAlign) this.pac.x = c2.cx;
      }
      this.pac.x = wrapX(this.level, this.pac.x);
    }

    // Distance an actor may move this tick, stopping short of a blocked next tile
    clampMove(a, v, move, nextBlocked) {
      if (!nextBlocked) return move;
      const gx = Math.floor(a.x / TILE), gy = Math.floor(a.y / TILE);
      const BUF = SPRITE_RADIUS + 1;
      if (v.dx > 0) return Math.max(0, Math.min(move, (gx + 1) * TILE - BUF - a.x));
      if (v.dx < 0) return Math.max(0, Math.min(move, a.x - (gx * TILE + BUF)));
      if (v.dy > 0) return Math.max(0, Math.min(move, (gy + 1) * TILE - BUF - a.y));
      if (v.dy < 0) return Math.max(0, Math.min(move, a.y - (gy * TILE + BUF)));
      return move;
    }

    bobHouseGhosts() {
      for (const g of this.ghosts) if (g.state === 'house') this.bob(g);
    }

    bob(g) { g.y = g.homeY + Math.sin(this.clock * 5 + g.homeX) * 2; }

    moveGhost(g, dt) {
      const lv = this.level;
      if (g.state === 'house') {
        this.bob(g);
        if (this.roundTime >= g.releaseAt) g.state = 'leaving';
        return;
      }
      if (g.state === 'leaving') {
        // Slide to the door column, then straight up through the door
        const s = HOUSE_SPEED * dt;
        if (g.x !== lv.exit.x) {
          g.y = approach(g.y, g.homeY, s);
          g.x = approach(g.x, lv.exit.x, s);
          g.dir = g.x < lv.exit.x ? 'right' : 'left';
        } else {
          g.y = approach(g.y, lv.exit.y, s);
          g.dir = 'up';
          if (g.y === lv.exit.y) {
            g.state = 'active';
            g.dir = g.homeX > lv.house.x ? 'right' : 'left';
          }
        }
        return;
      }

      const ggx = Math.floor(g.x / TILE), ggy = Math.floor(g.y / TILE);
      if (atTileCenter(g.x, g.y)) {
        const dirs = possibleDirs(lv, ggx, ggy).filter(d => d !== opp(g.dir));
        if (dirs.length > 0) {
          const pac = { x: Math.floor(this.pac.x / TILE), y: Math.floor(this.pac.y / TILE) };
          // Frightened ghosts maximise distance from Pac; otherwise minimise it
          const sign = g.frightened ? -1 : 1;
          let best = Infinity, bestDir = dirs[0];
          for (const d of dirs) {
            const v = dirVec(d);
            const score = sign * distance({ x: ggx + v.dx, y: ggy + v.dy }, pac);
            if (score < best) { best = score; bestDir = d; }
          }
          if (bestDir !== g.dir) {
            // Snap onto the centre so turns never accumulate drift
            const c = centerCoords(g.x, g.y);
            g.x = c.cx; g.y = c.cy;
          }
          g.dir = bestDir;
        }
      }
      const v = dirVec(g.dir);
      const spd = (g.frightened ? FRIGHT_SPEED : GHOST_SPEED) * dt;
      const mv = this.clampMove(g, v, spd, blocked(lv, ggx + v.dx, ggy + v.dy));
      g.x = wrapX(lv, g.x + v.dx * mv);
      g.y += v.dy * mv;
    }

    sendHome(g) {
      const lv = this.level;
      g.x = lv.house.x; g.homeX = lv.house.x;
      g.y = lv.house.y; g.homeY = lv.house.y;
      g.frightened = false;
      g.state = 'house';
      g.releaseAt = this.roundTime + RESPAWN_DELAY;
    }

    powerUp() {
      this.powerTimer = POWER_TIME;
      for (const g of this.ghosts) g.frightened = true;
    }
  }

  global.PacmanGame = PacmanGame;
  global.__PACMAN_CONST = { TILE, POWER_TIME };
})(window);
