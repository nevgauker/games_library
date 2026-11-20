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
  const HOUSE_SPEED = 45; // px/s while scripted out of the house
  const SPRITE_RADIUS = TILE * 0.45; // visual radius used to stop before walls

  const READY_TIME = 1.6; // countdown after a death / new level
  const DEATH_TIME = 1.5; // death animation length
  const CLEAR_TIME = 2.0; // level-clear flash length
  const RESPAWN_DELAY = 1.0; // eaten ghost waits this long in the house after its eyes get home
  const EYES_SPEED = 150; // px/s for eaten ghosts heading home
  const TUNNEL_FACTOR = 0.55; // ghost speed multiplier inside side tunnels
  const HIT_STOP = 0.4; // brief freeze when a ghost is eaten
  const GHOST_POINTS = [200, 400, 800, 1600]; // combo within one power pellet
  const EXTRA_LIFE_AT = 10000; // one bonus life at this score
  const MAX_LIVES = 5;

  // Difficulty per level (the last row repeats forever).
  //   pac/ghost/fright: speeds in px/s   power: seconds ghosts stay frightened
  //   release: seconds into a round when each ghost leaves the house
  //   modes: scatter, chase, scatter, chase, scatter durations, then chase for good
  //          (the mode clock pauses while ghosts are frightened)
  const DIFFICULTY = [
    { pac: 75, ghost: 62, fright: 48, power: 7, release: [0, 3, 7, 11], modes: [7, 20, 7, 20, 5] },
    { pac: 76, ghost: 66, fright: 50, power: 6, release: [0, 2, 5, 8], modes: [7, 20, 7, 20, 5] },
    { pac: 78, ghost: 70, fright: 52, power: 5, release: [0, 2, 4, 6], modes: [6, 20, 6, 20, 4] },
    { pac: 79, ghost: 73, fright: 54, power: 4, release: [0, 1, 3, 5], modes: [5, 20, 5, 25, 3] },
    { pac: 80, ghost: 76, fright: 55, power: 3, release: [0, 1, 2, 3], modes: [5, 20, 5, 30, 1] },
    { pac: 80, ghost: 78, fright: 56, power: 2, release: [0, 0.5, 1, 1.5], modes: [5, 20, 5, 30, 1] },
  ];

  // Bonus item: appears below the house after these many pellets are eaten, for BONUS_TIME seconds
  const BONUS_AT = [70, 170];
  const BONUS_TIME = 9;
  const BONUSES = [
    { kind: "berry", points: 100 },
    { kind: "lime", points: 300 },
    { kind: "gem", points: 500 },
    { kind: "bell", points: 1000 },
    { kind: "star", points: 2000 },
    { kind: "crown", points: 5000 },
  ];

  // Ghost personalities, in spawn order
  //   hunter   - heads straight for Pac
  //   ambusher - aims 4 tiles ahead of Pac to cut him off
  //   guard    - when Pac nears a power pellet, camps it; otherwise presses 2 tiles ahead
  //   wanderer - roams to random spots, but locks on when Pac comes within 6 tiles
  const PERSONAS = ["hunter", "ambusher", "guard", "wanderer"];

  // Mazes are 28 x 28 tiles.
  // "#" wall, "-" ghost-house door, "." pellet, "o" power pellet, " " empty,
  // "P" Pac spawn (also where bonus items appear), "G" first ghost (starts outside the door).
  // The other ghosts start in the house.
  // Symmetric mazes are written as their left 14 columns; mirror() builds the full row and
  // adds G above the door and P below the house.
  function mirror(half) {
    const rows = half.map(r => r + [...r].reverse().join(""));
    const doorRow = rows.findIndex(r => r.includes("-"));
    const put = (y, x, c) => { rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1); };
    put(doorRow - 1, 13, "G");
    put(doorRow + 5, 13, "P");
    return rows;
  }

  // Levels cycle through the mazes two levels at a time
  const MAZES = [
    {
      name: "Arcade Hall",
      wall: "#3b82f6",
      rows: [
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
      ],
    },
    {
      name: "Crossroads",
      wall: "#d946ef",
      rows: mirror([
        "##############",
        "#.....##.....#",
        "#.###.##.###.#",
        "#o###.##.###.#",
        "#.###.##.###.#",
        "#.............",
        "#.####.##.####",
        "#.####.##.####",
        "#......##....#",
        "######.#####.#",
        "     #.#####.#",
        "     #.##     ",
        "     #.## ###-",
        "######.## #   ",
        "      .   #   ",
        "######.## #   ",
        "     #.## ####",
        "     #.##     ",
        "     #.#####.#",
        "######.#####.#",
        "#.............",
        "#.####.##.####",
        "#o........####",
        "###.##.##.####",
        "#......##.....",
        "#.##########.#",
        "#.............",
        "##############",
      ]),
    },
    {
      name: "Lattice",
      wall: "#22c55e",
      rows: mirror([
        "##############",
        "#.....#......#",
        "#.###.#.####.#",
        "#o###.#.####.#",
        "#.............",
        "#.###.###.####",
        "#.....###.####",
        "###.#####.####",
        "###...........",
        "######.#####.#",
        "     #.#####.#",
        "     #.##     ",
        "     #.## ###-",
        "######.## #   ",
        "      .   #   ",
        "######.## #   ",
        "     #.## ####",
        "     #.##     ",
        "     #.#####.#",
        "######.#####.#",
        "#............#",
        "#.####.#####.#",
        "#o...........#",
        "###.#####.##.#",
        "#.............",
        "#.####.#####.#",
        "#.............",
        "##############",
      ]),
    },
  ];

  const GHOST_COLORS = ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852'];

  function mazeForLevel(n) { return MAZES[Math.floor((n - 1) / 2) % MAZES.length]; }
  function difficultyForLevel(n) { return DIFFICULTY[Math.min(n, DIFFICULTY.length) - 1]; }
  function bonusForLevel(n) { return BONUSES[Math.min(n, BONUSES.length) - 1]; }

  function parseLevel(def) {
    const grid = def.rows.map(r => r.split(""));
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
    const exitTile = { x: Math.floor(exit.x / TILE), y: Math.floor(exit.y / TILE) };
    // Side-tunnel tiles: open run from each edge of a wrap-around row (ghosts slow down here)
    const tunnel = new Set();
    for (let y = 0; y < rowsN; y++) {
      if (grid[y][0] !== ' ' || grid[y][colsN - 1] !== ' ') continue;
      for (let x = 0; x < colsN && grid[y][x] === ' '; x++) tunnel.add(key(x, y));
      for (let x = colsN - 1; x >= 0 && grid[y][x] === ' '; x--) tunnel.add(key(x, y));
    }
    // Corridor tiles (everywhere a pellet starts) - used as wander destinations
    const corridors = [...pellets, ...powers].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
    // Scatter corners sit just outside the maze so ghosts circle the nearest block
    const corners = [
      { x: colsN - 2, y: -3 }, { x: 1, y: -3 }, { x: colsN - 1, y: rowsN + 1 }, { x: 0, y: rowsN + 1 },
    ];
    return {
      name: def.name, wallColor: def.wall,
      rows: rowsN, cols: colsN, grid, pellets, powers, door, pacSpawn, exit, exitTile, house, tunnel, corridors, corners,
      totalDots: pellets.size + powers.size,
    };
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

  // Squared straight-line distance between tiles (ghost steering and range checks)
  function dist2(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  // Tie-break order when two exits are equally good
  const DIR_PRIORITY = ['up', 'left', 'down', 'right'];

  function approach(cur, target, maxStep) {
    const d = target - cur;
    if (Math.abs(d) <= maxStep) return target;
    return cur + Math.sign(d) * maxStep;
  }

  class PacmanGame {
    constructor() {
      this.score = 0;
      this.lives = 3;
      this.extraLifeGiven = false;
      this.clock = 0; // total simulated time, used for animation
      this.acc = 0;
      this.paused = false;
      this.loadLevel(1);
      this.width = this.level.cols * TILE;
      this.height = this.level.rows * TILE;
      this.resetRound();
      this.setState("ready", null); // wait for the player's first input
    }

    // Fresh maze, difficulty and bonus for level n
    loadLevel(n) {
      this.levelNum = n;
      this.level = parseLevel(mazeForLevel(n));
      this.diff = difficultyForLevel(n);
      const m = this.diff.modes;
      this.modes = [["scatter", m[0]], ["chase", m[1]], ["scatter", m[2]], ["chase", m[3]], ["scatter", m[4]], ["chase", Infinity]];
      this.bonusDef = bonusForLevel(n);
      this.dotsEaten = 0;
      this.bonusesSpawned = 0;
      this.bonus = null; // { x, y, kind, points, timer } while on the board
      this.emit("level", n);
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
      this.modeIndex = 0;
      this.modeTimer = this.modes[0][1];
      this.bonus = null; // a death or new round clears any bonus on the board
      this.combo = 0;
      this.hitStop = 0;
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
          id: i,
          persona: PERSONAS[i],
          x, y,
          homeX: x, homeY: y,
          dir: outside ? 'up' : 'left',
          color,
          frightened: false,
          // 'house' | 'leaving' | 'active' | 'eyes' (eaten, heading home) | 'entering' (eyes dropping into house)
          state: outside ? 'active' : 'house',
          releaseAt: this.diff.release[i],
          wanderTarget: null,
          wanderTimer: 0,
        };
      });
      this.emit('lives', this.lives);
      this.emit('score', this.score);
      this.emit('update');
    }

    restart() {
      this.score = 0;
      this.lives = 3;
      this.extraLifeGiven = false;
      this.acc = 0;
      this.paused = false;
      this.loadLevel(1);
      this.resetRound();
      this.emit("pause", false);
      this.setState("ready", READY_TIME);
    }

    nextLevel() {
      this.acc = 0;
      this.loadLevel(this.levelNum + 1);
      this.resetRound();
      this.setState("ready", READY_TIME);
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

    get mode() { return this.modes[this.modeIndex][0]; }

    tickPlaying(dt) {
      // Short freeze after eating a ghost so the points register
      if (this.hitStop > 0) { this.hitStop = Math.max(0, this.hitStop - dt); return; }
      this.roundTime += dt;

      // Power timer; the scatter/chase clock only runs while ghosts aren't frightened
      if (this.powerTimer > 0) {
        this.powerTimer = Math.max(0, this.powerTimer - dt);
        if (this.powerTimer === 0) {
          for (const g of this.ghosts) g.frightened = false;
        }
      } else {
        this.modeTimer -= dt;
        if (this.modeTimer <= 0 && this.modeIndex < this.modes.length - 1) {
          this.modeIndex += 1;
          this.modeTimer = this.modes[this.modeIndex][1];
          // Every roaming ghost turns around: the player's cue that the pressure changed
          for (const g of this.ghosts) if (g.state === 'active') g.dir = opp(g.dir);
          this.emit('mode', this.mode);
        }
      }

      this.movePac(dt);

      // Eat pellets/power
      const gx = Math.floor(this.pac.x / TILE), gy = Math.floor(this.pac.y / TILE);
      const k = key(gx, gy);
      if (this.level.pellets.has(k)) { this.level.pellets.delete(k); this.dotsEaten++; this.addScore(10); }
      if (this.level.powers.has(k)) { this.level.powers.delete(k); this.dotsEaten++; this.addScore(50); this.powerUp(); }
      this.updateBonus(dt, gx, gy);

      if (this.level.pellets.size === 0 && this.level.powers.size === 0) {
        this.powerTimer = 0;
        for (const g of this.ghosts) g.frightened = false;
        this.setState('levelClear', CLEAR_TIME);
        this.emit('levelclear', this.levelNum);
        return;
      }

      for (const g of this.ghosts) this.moveGhost(g, dt);

      // Collisions Pac vs Ghosts (only ghosts out in the maze, not eyes or ones in the house)
      for (const g of this.ghosts) {
        if (g.state !== 'active' && g.state !== 'leaving') continue;
        const dx = g.x - this.pac.x, dy = g.y - this.pac.y;
        if (dx * dx + dy * dy < (TILE * 0.5) * (TILE * 0.5)) {
          if (g.frightened) {
            const points = GHOST_POINTS[Math.min(this.combo, GHOST_POINTS.length - 1)];
            this.combo += 1;
            this.addScore(points);
            this.emit('ghosteaten', { x: g.x, y: g.y, points, combo: this.combo });
            g.frightened = false;
            if (g.state === 'leaving') { this.parkInHouse(g); } // still in the doorway: straight back in
            else g.state = 'eyes';
            this.hitStop = HIT_STOP;
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
      const speed = this.diff.pac * dt;
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
            g.dir = 'up'; // picks left/right at the first decision, by target
          }
        }
        return;
      }
      if (g.state === 'entering') {
        // Eyes drop down through the door, then slide to the house centre
        const s = EYES_SPEED * 0.6 * dt;
        if (g.y !== lv.house.y) { g.x = lv.exit.x; g.y = approach(g.y, lv.house.y, s); g.dir = 'down'; }
        else {
          g.x = approach(g.x, lv.house.x, s);
          if (g.x === lv.house.x) this.parkInHouse(g);
        }
        return;
      }

      // Roaming ghosts and eyes move on the grid
      if (g.persona === 'wanderer') g.wanderTimer -= dt;
      let speed = g.state === 'eyes' ? EYES_SPEED : g.frightened ? this.diff.fright : this.diff.ghost;
      if (g.state !== 'eyes' && lv.tunnel.has(key(Math.floor(g.x / TILE), Math.floor(g.y / TILE)))) speed *= TUNNEL_FACTOR;
      this.advanceGhost(g, speed * dt);
    }

    // Move a ghost `dist` pixels along the grid, deciding a new direction at every tile centre it reaches.
    // Stepping centre-to-centre means fast movers (eyes) can never skip past a junction.
    advanceGhost(g, dist) {
      const lv = this.level;
      const EPS = 1e-4;
      for (let i = 0; i < 8 && dist > EPS; i++) {
        const gx = Math.floor(g.x / TILE), gy = Math.floor(g.y / TILE);
        const cx = gx * TILE + TILE / 2, cy = gy * TILE + TILE / 2;
        if (Math.abs(g.x - cx) < EPS && Math.abs(g.y - cy) < EPS) {
          g.x = cx; g.y = cy;
          if (g.state === 'eyes' && gx === lv.exitTile.x && gy === lv.exitTile.y) { g.state = 'entering'; return; }
          const d = this.chooseDir(g, gx, gy);
          if (!d) return;
          g.dir = d;
        }
        const v = dirVec(g.dir);
        // Head for the centre of this tile if it's still ahead, otherwise the next tile's centre
        const ahead = (cx - g.x) * v.dx + (cy - g.y) * v.dy;
        const tx = ahead > EPS ? cx : cx + v.dx * TILE;
        const ty = ahead > EPS ? cy : cy + v.dy * TILE;
        const gap = Math.abs(tx - g.x) + Math.abs(ty - g.y);
        if (dist < gap) { g.x += v.dx * dist; g.y += v.dy * dist; dist = 0; }
        else { g.x = tx; g.y = ty; dist -= gap; }
        g.x = wrapX(lv, g.x);
      }
    }

    chooseDir(g, gx, gy) {
      const lv = this.level;
      const open = possibleDirs(lv, gx, gy);
      let opts = open.filter(d => d !== opp(g.dir)); // ghosts never U-turn by choice
      if (!opts.length) opts = open;
      if (!opts.length) return null;

      if (g.frightened) {
        // Panicked: random pick, but never the exit that leads closest to Pac
        if (opts.length > 1) {
          const pac = this.pacTile();
          let worst = null, worstD = Infinity;
          for (const d of opts) {
            const v = dirVec(d), dd = dist2({ x: gx + v.dx, y: gy + v.dy }, pac);
            if (dd < worstD) { worstD = dd; worst = d; }
          }
          opts = opts.filter(d => d !== worst);
        }
        return opts[Math.floor(Math.random() * opts.length)];
      }

      const target = this.targetFor(g, gx, gy);
      let best = null, bestD = Infinity;
      for (const d of DIR_PRIORITY) {
        if (!opts.includes(d)) continue;
        const v = dirVec(d), dd = dist2({ x: gx + v.dx, y: gy + v.dy }, target);
        if (dd < bestD) { bestD = dd; best = d; }
      }
      return best;
    }

    pacTile() { return { x: Math.floor(this.pac.x / TILE), y: Math.floor(this.pac.y / TILE) }; }

    // Tile each ghost steers toward
    targetFor(g, gx, gy) {
      const lv = this.level;
      if (g.state === 'eyes') return lv.exitTile;
      if (this.mode === 'scatter') return lv.corners[g.id];
      const p = this.pacTile();
      const v = dirVec(this.pac.dir);
      switch (g.persona) {
        case 'ambusher':
          return { x: p.x + v.dx * 4, y: p.y + v.dy * 4 };
        case 'guard': {
          let pellet = null, pd = Infinity;
          for (const k of lv.powers) {
            const [x, y] = k.split(',').map(Number);
            const d = dist2({ x, y }, p);
            if (d < pd) { pd = d; pellet = { x, y }; }
          }
          if (pellet && pd <= 7 * 7) return pellet;
          return { x: p.x + v.dx * 2, y: p.y + v.dy * 2 };
        }
        case 'wanderer': {
          if (dist2({ x: gx, y: gy }, p) <= 6 * 6) return p;
          const t = g.wanderTarget;
          if (!t || g.wanderTimer <= 0 || (t.x === gx && t.y === gy)) {
            g.wanderTarget = lv.corridors[Math.floor(Math.random() * lv.corridors.length)];
            g.wanderTimer = 4;
          }
          return g.wanderTarget;
        }
        default: // hunter
          return p;
      }
    }

    parkInHouse(g) {
      const lv = this.level;
      g.x = lv.house.x; g.homeX = lv.house.x;
      g.y = lv.house.y; g.homeY = lv.house.y;
      g.frightened = false;
      g.state = 'house';
      g.dir = 'up';
      g.releaseAt = this.roundTime + RESPAWN_DELAY;
    }

    powerUp() {
      this.powerTimer = this.diff.power;
      this.combo = 0;
      for (const g of this.ghosts) {
        if (g.state === 'eyes' || g.state === 'entering') continue;
        if (g.state === 'active' && !g.frightened) g.dir = opp(g.dir); // startled: turn around
        g.frightened = true;
      }
    }

    addScore(points) {
      this.score += points;
      this.emit('score', this.score);
      if (!this.extraLifeGiven && this.score >= EXTRA_LIFE_AT) {
        this.extraLifeGiven = true;
        if (this.lives < MAX_LIVES) { this.lives += 1; this.emit('lives', this.lives); }
        this.emit('extralife', this.lives);
      }
    }

    // Spawn the bonus item at pellet milestones, count it down, and let Pac collect it
    updateBonus(dt, pgx, pgy) {
      const lv = this.level;
      if (!this.bonus && this.bonusesSpawned < BONUS_AT.length && this.dotsEaten >= BONUS_AT[this.bonusesSpawned]) {
        this.bonusesSpawned += 1;
        this.bonus = {
          x: lv.pacSpawn.x * TILE + TILE / 2, y: lv.pacSpawn.y * TILE + TILE / 2,
          tx: lv.pacSpawn.x, ty: lv.pacSpawn.y,
          kind: this.bonusDef.kind, points: this.bonusDef.points, timer: BONUS_TIME,
        };
        this.emit('bonus', this.bonus);
      }
      if (!this.bonus) return;
      this.bonus.timer -= dt;
      if (pgx === this.bonus.tx && pgy === this.bonus.ty) {
        const b = this.bonus;
        this.bonus = null;
        this.addScore(b.points);
        this.emit('popup', { x: b.x, y: b.y, points: b.points, kind: 'bonus' });
      } else if (this.bonus.timer <= 0) {
        this.bonus = null;
      }
    }
  }

  global.PacmanGame = PacmanGame;
  global.__PACMAN_CONST = { TILE };
})(window);
