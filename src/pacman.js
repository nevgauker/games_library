// Pac-Man: minimalist retro maze chase
(function (global) {
  const TILE = 16; // tile size in pixels
  const STEP = 1 / 60; // physics timestep
  const PAC_SPEED = 75; // px/s
  const GHOST_SPEED = 68; // px/s (slower than Pac when not frightened)
  const FRIGHT_SPEED = 55; // px/s when frightened
  const POWER_TIME = 6.0; // seconds of power pellet
  const SPRITE_RADIUS = TILE * 0.45; // visual radius used to stop before walls

  // Simple classic-like maze (28 x 31 tiles). '#' walls, '.' pellets, 'o' power, ' ' empty, 'P' spawn, 'G' ghost house spawn
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
    "     #.##          ##.#     ",
    "     #.## ###GG### ##.#     ",
    "######.## #      # ##.######",
    "      .   #  PP  #   .      ",
    "######.## #      # ##.######",
    "     #.## ######## ##.#     ",
    "     #.##          ##.#     ",
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

  function parseLevel(rows) {
    const grid = rows.map(r => r.split(""));
    const rowsN = grid.length, colsN = grid[0].length;
    const pellets = new Set();
    const powers = new Set();
    const ghosts = [];
    let pacSpawn = null;
    let ghostHouse = null;
    for (let y = 0; y < rowsN; y++) {
      for (let x = 0; x < colsN; x++) {
        const t = grid[y][x];
        if (t === '.') pellets.add(key(x, y));
        if (t === 'o') powers.add(key(x, y));
        if (t === 'P') { pacSpawn = { x, y }; grid[y][x] = ' '; }
        if (t === 'G') { ghosts.push({ x, y }); grid[y][x] = ' '; ghostHouse = ghostHouse || { x, y }; }
      }
    }
    // Determine house interior as rectangle bounded by walls on ghost row; pick door on bottom row
    const houseInterior = new Set();
    let houseDoor = null;
    if (ghosts.length) {
      const rowG = ghosts[0].y;
      const minGX = Math.min.apply(null, ghosts.map(g=>g.x));
      const maxGX = Math.max.apply(null, ghosts.map(g=>g.x));
      let leftWallX = minGX - 1; while (leftWallX > 0 && grid[rowG][leftWallX] !== '#') leftWallX--;
      let rightWallX = maxGX + 1; while (rightWallX < colsN-1 && grid[rowG][rightWallX] !== '#') rightWallX++;
      let bottomRow = rowG + 1;
      for (let y = rowG + 1; y < Math.min(rowsN, rowG + 6); y++) {
        if (grid[y][leftWallX] === '#' && grid[y][rightWallX] === '#') { bottomRow = y; break; }
      }
      for (let y = rowG; y < bottomRow; y++) {
        for (let x = leftWallX + 1; x < rightWallX; x++) {
          if (grid[y][x] === ' ') houseInterior.add(key(x, y));
        }
      }
      const avgGX = Math.round((minGX + maxGX) / 2);
      let bestX = null, bestD = Infinity;
      for (let x = leftWallX + 1; x < rightWallX; x++) {
        if (grid[bottomRow][x] === ' ') {
          const d = Math.abs(x - avgGX);
          if (d < bestD) { bestD = d; bestX = x; }
        }
      }
      if (bestX != null) houseDoor = { x: bestX, y: bottomRow };
    }
    return { rows: rowsN, cols: colsN, grid, pellets, powers, pacSpawn, ghosts, ghostHouse, houseInterior, houseDoor };
  }

  function key(x, y) { return `${x},${y}`; }
  function fromKey(k) { const [x, y] = k.split(',').map(Number); return { x, y }; }

  function isTunnelRow(level, gy){
    if (gy < 0 || gy >= level.rows) return false;
    return level.grid[gy][0] === ' ' && level.grid[gy][level.cols - 1] === ' ';
  }

  function isWall(level, gx, gy) {
    if (gy < 0 || gy >= level.rows) return true;
    // Only allow horizontal wrap on tunnel rows
    if (gx < 0 || gx >= level.cols) {
      if (!isTunnelRow(level, gy)) return true;
      const wx = (gx + level.cols) % level.cols;
      const tW = level.grid[gy][wx];
      return tW === '#';
    }
    const t = level.grid[gy][gx];
    return t === '#';
  }

  function wrapX(level, px) {
    const w = level.cols * TILE;
    if (px < 0) return px + w;
    if (px >= w) return px - w;
    return px;
  }

  function atTileCenter(px, py) {
    const gx = Math.floor(px / TILE);
    const gy = Math.floor(py / TILE);
    const cx = gx * TILE + TILE / 2;
    const cy = gy * TILE + TILE / 2;
    return Math.abs(px - cx) < 0.6 && Math.abs(py - cy) < 0.6;
  }

  function centerCoords(px, py){
    const gx = Math.floor(px / TILE);
    const gy = Math.floor(py / TILE);
    const cx = gx * TILE + TILE / 2;
    const cy = gy * TILE + TILE / 2;
    return { cx, cy };
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
    if (!isWall(level, gx - 1, gy)) dirs.push('left');
    if (!isWall(level, gx + 1, gy)) dirs.push('right');
    if (!isWall(level, gx, gy - 1)) dirs.push('up');
    if (!isWall(level, gx, gy + 1)) dirs.push('down');
    return dirs;
  }

  function blockedForPlayer(level, gx, gy) {
    if (gy < 0 || gy >= level.rows || gx < 0 || gx >= level.cols) return true;
    if (level.grid[gy][gx] === '#') return true;
    if (level.houseDoor && gx === level.houseDoor.x && gy === level.houseDoor.y) return true;
    if (level.houseInterior && level.houseInterior.has(key(gx, gy))) return true;
    return false;
  }

  function possibleDirsForGhost(level, ghost, gx, gy) {
    const dirs = [];
    if (!blockedForGhost(level, ghost, gx - 1, gy)) dirs.push('left');
    if (!blockedForGhost(level, ghost, gx + 1, gy)) dirs.push('right');
    if (!blockedForGhost(level, ghost, gx, gy - 1)) dirs.push('up');
    if (!blockedForGhost(level, ghost, gx, gy + 1)) dirs.push('down');
    return dirs;
  }

  function blockedForGhost(level, ghost, gx, gy) {
    if (gy < 0 || gy >= level.rows || gx < 0 || gx >= level.cols) return true;
    // Door: only passable when leaving the house
    if (level.houseDoor && gx === level.houseDoor.x && gy === level.houseDoor.y) {
      return !(ghost.state === 'leaving');
    }
    // Interior: passable only while leaving; blocked otherwise
    if (level.houseInterior && level.houseInterior.has(key(gx, gy))) {
      return !(ghost.state === 'leaving');
    }
    // Regular walls
    return level.grid[gy][gx] === '#';
  }

  function distance(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.abs(dx) + Math.abs(dy);
  }

  class PacmanGame {
    constructor(levelIndex = 0) {
      this.levelIndex = levelIndex;
      this.level = parseLevel(MAZE);
      this.width = this.level.cols * TILE;
      this.height = this.level.rows * TILE;
      this.score = 0;
      this.lives = 3;
      this.levelNum = 1;
      this.powerTimer = 0;
      this.acc = 0;
      this.resetPositions();
    }

    on(ev, fn) { this._ls = this._ls || new Map(); const a = this._ls.get(ev) || []; a.push(fn); this._ls.set(ev, a); return () => this.off(ev, fn); }
    off(ev, fn) { const a = (this._ls && this._ls.get(ev)) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    emit(ev, p) { const a = (this._ls && this._ls.get(ev)) || []; a.forEach(f => f(p)); }

    resetPositions() {
      const ps0 = this.level.pacSpawn || { x: 13, y: 17 };
      // Adjust spawn: place Pac-Man below the first wall below current spawn
      let sx = ps0.x, sy = ps0.y;
      for (let yy = sy + 1; yy < this.level.rows - 1; yy++) {
        if (this.level.grid[yy][sx] === '#') { sy = yy + 1; break; }
      }
      const ps = { x: sx, y: sy };
      this.pac = {
        x: ps.x * TILE + TILE / 2,
        y: ps.y * TILE + TILE / 2,
        dir: 'left',
        want: 'left',
      };
      this.ghosts = [];
      const colors = ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852'];
      const spawns = this.level.ghosts.length ? this.level.ghosts : [{ x: 13, y: 13 }, { x: 14, y: 13 }, { x: 13, y: 14 }, { x: 14, y: 14 }];
      for (let i = 0; i < 4; i++) {
        const g0 = spawns[i % spawns.length];
        this.ghosts.push({
          x: g0.x * TILE + TILE / 2,
          y: g0.y * TILE + TILE / 2,
          dir: 'left',
          color: colors[i],
          frightened: false,
          eaten: false,
          state: 'leaving', // 'leaving' until it exits the house, then 'chase'
        });
      }
      this.emit('lives', this.lives);
      this.emit('score', this.score);
      this.emit('update');
    }

    restart() {
      // Reset dots/power and score for this level
      this.level = parseLevel(MAZE);
      this.score = 0;
      this.lives = 3;
      this.levelNum = 1;
      this.powerTimer = 0;
      this.acc = 0;
      this.resetPositions();
      this.emit('level', this.levelNum);
    }

    nextLevel() {
      // For now, reuse same layout and speed, just reset pellets and increment level counter
      const savedScore = this.score;
      this.level = parseLevel(MAZE);
      this.levelNum += 1;
      this.powerTimer = 0;
      this.acc = 0;
      this.resetPositions();
      this.score = savedScore;
      this.emit('level', this.levelNum);
      this.emit('score', this.score);
    }

    input(dir) {
      this.pac.want = dir;
    }

    step(dt) {
      // Fixed timestep
      this.acc += dt;
      while (this.acc >= STEP) {
        this.tick(STEP);
        this.acc -= STEP;
      }
      this.emit('update');
    }

    tick(dt) {
      // Power timer
      if (this.powerTimer > 0) {
        this.powerTimer = Math.max(0, this.powerTimer - dt);
        if (this.powerTimer === 0) {
          for (const g of this.ghosts) g.frightened = false;
        }
      }

      // Pac-Man movement: grid-based with wall collisions
      let gx = Math.floor(this.pac.x / TILE), gy = Math.floor(this.pac.y / TILE);
      const { cx, cy } = centerCoords(this.pac.x, this.pac.y);
      const tol = 4; // pixels tolerance for turning/snap
      if (this.pac.want) {
        const wantV = dirVec(this.pac.want);
        // Snap to tile center on the perpendicular axis if close
        if (wantV.dy !== 0 && Math.abs(this.pac.x - cx) <= tol) this.pac.x = cx;
        if (wantV.dx !== 0 && Math.abs(this.pac.y - cy) <= tol) this.pac.y = cy;
        // Recompute tile indices after snap
        gx = Math.floor(this.pac.x / TILE); gy = Math.floor(this.pac.y / TILE);
        // If desired direction is open from the current tile, allow the turn immediately
        if (wantV.dy !== 0 && !blockedForPlayer(this.level, gx, gy + wantV.dy)) this.pac.dir = this.pac.want;
        if (wantV.dx !== 0 && !blockedForPlayer(this.level, gx + wantV.dx, gy)) this.pac.dir = this.pac.want;
      }
      // Allow immediate reversal mid-tile if opposite direction
      if (this.pac.want && this.pac.want === opp(this.pac.dir)) {
        const rv = dirVec(this.pac.want);
        const rgx = Math.floor(this.pac.x / TILE), rgy = Math.floor(this.pac.y / TILE);
        if (!isWall(this.level, rgx + rv.dx, rgy + rv.dy)) this.pac.dir = this.pac.want;
      }
      // Move with collision clamp against next tile wall
      let pv = dirVec(this.pac.dir);
      const speed = PAC_SPEED * dt;
      if (pv.dx !== 0 || pv.dy !== 0) {
        gx = Math.floor(this.pac.x / TILE); gy = Math.floor(this.pac.y / TILE);
        let nx = gx + pv.dx, ny = gy + pv.dy;
        // If forward is blocked, allow immediate perpendicular turn if open (force snap)
        if (blockedForPlayer(this.level, nx, ny) && this.pac.want && this.pac.want !== this.pac.dir) {
          const wantV = dirVec(this.pac.want);
          const c = centerCoords(this.pac.x, this.pac.y);
          const tolTurn = 4;
          if (wantV.dy !== 0) {
            if (Math.abs(this.pac.x - c.cx) <= tolTurn) this.pac.x = c.cx;
            if (!blockedForPlayer(this.level, gx, gy + wantV.dy)) this.pac.dir = this.pac.want;
          } else if (wantV.dx !== 0) {
            if (Math.abs(this.pac.y - c.cy) <= tolTurn) this.pac.y = c.cy;
            if (!blockedForPlayer(this.level, gx + wantV.dx, gy)) this.pac.dir = this.pac.want;
          }
          // Recompute forward after possible turn
          pv = dirVec(this.pac.dir);
          nx = gx + pv.dx; ny = gy + pv.dy;
        }
        // compute distance to tile edge along movement axis (respect sprite radius + small margin)
        let move = speed;
        if (blockedForPlayer(this.level, nx, ny)) {
          const BUF = SPRITE_RADIUS + 1; // stop so the sprite does not overlap the wall visually
          if (pv.dx > 0) {
            const stop = (gx + 1) * TILE - BUF; // right boundary minus radius
            move = Math.max(0, Math.min(move, stop - this.pac.x));
          } else if (pv.dx < 0) {
            const stop = gx * TILE + BUF; // left boundary plus radius
            move = Math.max(0, Math.min(move, this.pac.x - stop));
          } else if (pv.dy > 0) {
            const stop = (gy + 1) * TILE - BUF; // bottom boundary minus radius
            move = Math.max(0, Math.min(move, stop - this.pac.y));
          } else if (pv.dy < 0) {
            const stop = gy * TILE + BUF; // top boundary plus radius
            move = Math.max(0, Math.min(move, this.pac.y - stop));
          }
        }
        this.pac.x += pv.dx * move;
        this.pac.y += pv.dy * move;
        // Keep aligned to grid perpendicular to movement to help turning (snap only when close)
        const c2 = centerCoords(this.pac.x, this.pac.y);
        const tolAlign = 4;
        if (pv.dx !== 0 && Math.abs(this.pac.y - c2.cy) <= tolAlign) this.pac.y = c2.cy;
        if (pv.dy !== 0 && Math.abs(this.pac.x - c2.cx) <= tolAlign) this.pac.x = c2.cx;
      }
      // Wrap tunnels
      this.pac.x = wrapX(this.level, this.pac.x);

      // Eat pellets/power
      gx = Math.floor(this.pac.x / TILE); gy = Math.floor(this.pac.y / TILE);
      const k = key(gx, gy);
      if (this.level.pellets.has(k)) { this.level.pellets.delete(k); this.score += 10; this.emit('score', this.score); }
      if (this.level.powers.has(k)) { this.level.powers.delete(k); this.score += 50; this.emit('score', this.score); this.powerUp(); }

      // Ghost logic
      for (const g of this.ghosts) {
        // Respawn eaten ghosts at house center
        if (g.eaten) {
          const hs = this.level.ghostHouse || { x: 13, y: 13 };
          g.x = hs.x * TILE + TILE / 2; g.y = hs.y * TILE + TILE / 2; g.dir = 'left'; g.eaten = false; g.frightened = false;
        }
        const gv = dirVec(g.dir);
        const ggx = Math.floor(g.x / TILE), ggy = Math.floor(g.y / TILE);
        // At intersections, possibly choose new dir
        if (atTileCenter(g.x, g.y)) {
          const dirs = possibleDirsForGhost(this.level, g, ggx, ggy).filter(d => d !== opp(g.dir));
          let chosen = g.dir;
          if (dirs.length > 0) {
            if (g.state === 'leaving') {
              // Move toward the house door
              const target = this.level.houseDoor || { x: ggx, y: ggy + 1 };
              let best = Infinity; let bestDir = dirs[0];
              for (const d of dirs) {
                const v = dirVec(d);
                const cand = { x: (ggx + v.dx), y: (ggy + v.dy) };
                const dist = distance(cand, target);
                if (dist < best) { best = dist; bestDir = d; }
              }
              chosen = bestDir;
            } else if (g.frightened) {
              // random choice
              chosen = dirs[Math.floor(Math.random() * dirs.length)];
            } else {
              // chase bias: choose dir that minimizes manhattan distance to pac
              const target = { x: Math.floor(this.pac.x / TILE), y: Math.floor(this.pac.y / TILE) };
              let best = Infinity; let bestDir = dirs[0];
              for (const d of dirs) {
                const v = dirVec(d);
                const cand = { x: (ggx + v.dx), y: (ggy + v.dy) };
                const dist = distance(cand, target);
                if (dist < best) { best = dist; bestDir = d; }
              }
              chosen = bestDir;
            }
          }
          g.dir = chosen;
        }
        const gspd = (g.frightened ? FRIGHT_SPEED : GHOST_SPEED) * dt;
        const gv2 = dirVec(g.dir);
        let mv = gspd;
        // Wall clamp for ghosts as well (respect sprite radius + margin)
        const ngx = Math.floor(g.x / TILE), ngy = Math.floor(g.y / TILE);
        const ax = ngx + gv2.dx, ay = ngy + gv2.dy;
        if (blockedForGhost(this.level, g, ax, ay)) {
          const BUF = SPRITE_RADIUS + 1;
          if (gv2.dx > 0) { const stop = (ngx + 1) * TILE - BUF; mv = Math.max(0, Math.min(mv, stop - g.x)); }
          else if (gv2.dx < 0) { const stop = ngx * TILE + BUF; mv = Math.max(0, Math.min(mv, g.x - stop)); }
          else if (gv2.dy > 0) { const stop = (ngy + 1) * TILE - BUF; mv = Math.max(0, Math.min(mv, stop - g.y)); }
          else if (gv2.dy < 0) { const stop = ngy * TILE + BUF; mv = Math.max(0, Math.min(mv, g.y - stop)); }
        }
        g.x += gv2.dx * mv;
        g.y += gv2.dy * mv;
        g.x = wrapX(this.level, g.x);
        // If a leaving ghost crossed below the door row, switch to chase
        if (g.state === 'leaving' && this.level.houseDoor && Math.floor(g.y / TILE) > this.level.houseDoor.y) {
          g.state = 'chase';
        }
      }

      // Collisions Pac vs Ghosts
      for (const g of this.ghosts) {
        const dx = g.x - this.pac.x, dy = g.y - this.pac.y;
        if (dx * dx + dy * dy < (TILE * 0.5) * (TILE * 0.5)) {
          if (g.frightened) {
            g.eaten = true;
            this.score += 200; this.emit('score', this.score);
          } else {
            // lose life
            this.lives -= 1; this.emit('lives', this.lives);
            if (this.lives <= 0) { this.emit('lose'); this.restart(); return; }
            this.resetPositions();
            return;
          }
        }
      }

      // Win check: all pellets cleared
      if (this.level.pellets.size === 0 && this.level.powers.size === 0) {
        this.emit('win');
      }
    }

    powerUp() {
      this.powerTimer = POWER_TIME;
      for (const g of this.ghosts) g.frightened = true;
    }
  }

  global.PacmanGame = PacmanGame;
  global.__PACMAN_CONST = { TILE };
})(window);
