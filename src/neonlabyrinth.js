// Neon Labyrinth '89: game logic (headless, no DOM) + canvas renderer.
// The logic class runs in Node too; tools/check-labyrinth.cjs drives it directly.
(function (root) {
  const STEP_TIME = 0.085;      // seconds to glide one cell
  const PULSE_PERIOD = 2.4;     // a pulse gate is open for the first half of its period
  const PULSE_WARN = 0.4;       // gates flicker this long before switching
  const SCANNER_SPEED = 3;      // cells per second
  const HIT_PENALTY = 5;        // seconds lost on a scanner hit
  const HIT_GRACE = 1.5;        // invulnerability after a hit
  const HIT_RADIUS = 0.7;       // cells
  const PING_RANGE = 5;         // scanners ping when this close (cells)
  const LOW_TIME = 5;           // seconds: countdown ticks start
  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

  class NeonLabyrinthGame {
    constructor(levels) {
      this.levels = levels || root.NEON_LABYRINTH_LEVELS;
      this.events = [];
      this.held = [];
      this.queued = null;
      this.load(0);
    }

    get level() { return this.levels[this.levelIndex]; }
    levelCount() { return this.levels.length; }

    load(i) {
      this.levelIndex = Math.max(0, Math.min(i, this.levels.length - 1));
      const lvl = this.level;
      this.rows = lvl.map.length;
      this.cols = lvl.map[0].length;
      this.grid = [];
      this.pulses = [];
      this.scanners = [];
      this.crystalsTotal = 0;
      for (let r = 0; r < this.rows; r++) {
        const row = [];
        for (let c = 0; c < this.cols; c++) {
          let ch = lvl.map[r][c] || '#';
          if (ch === 'S') { this.start = { r, c }; ch = ' '; }
          else if (ch === 'E') this.exit = { r, c };
          else if (ch === 'h' || ch === 'v') {
            this.scanners.push({ axis: ch, fr: r, fc: c, tr: r, tc: c, t: 1, dir: 1, r, c });
            ch = ' ';
          } else if (ch === '~') {
            this.pulses.push({ r, c, offset: (this.pulses.length % 2) * PULSE_PERIOD / 2 });
          } else if (ch === 't') this.crystalsTotal++;
          row.push(ch);
        }
        this.grid.push(row);
      }
      this.pulseAt = new Map(this.pulses.map(p => [p.r * this.cols + p.c, p]));
      this.player = { r: this.start.r, c: this.start.c, fr: this.start.r, fc: this.start.c, t: 1, dir: 'right' };
      this.keys = new Set();
      this.timeLeft = lvl.time;
      this.elapsed = 0;
      this.clock = 0;
      this.grace = 0;
      this.bumpCooldown = 0;
      this.pingCooldown = 0;
      this.lastWhole = Math.ceil(this.timeLeft);
      this.hits = 0;
      this.crystalsTaken = 0;
      this.queued = null;
      this.state = 'ready'; // ready | playing | paused | won | lost
      this.fog = lvl.fog || 0;
      this.seen = new Uint8Array(this.rows * this.cols);
      this.visible = new Uint8Array(this.rows * this.cols);
      this._look(this.player.r, this.player.c);
      this.events.push({ type: 'load', level: this.levelIndex });
    }

    restart() { this.load(this.levelIndex); }
    begin() { if (this.state === 'ready') { this.state = 'playing'; this.events.push({ type: 'start' }); } }
    setPaused(on) {
      if (on && this.state === 'playing') this.state = 'paused';
      else if (!on && this.state === 'paused') this.state = 'playing';
    }
    togglePause() { this.setPaused(this.state === 'playing'); }

    // dirs: held directions, most recent first. queue(): a tap that must register
    // even if the key is released before the current glide ends.
    setHeld(dirs) { this.held = dirs.slice(); }
    queue(dir) { this.queued = dir; }

    starThresholds() {
      const { par, time } = this.level;
      return [par, Math.round((par + time) / 2)];
    }
    starsFor(elapsed) {
      const [three, two] = this.starThresholds();
      return elapsed <= three ? 3 : elapsed <= two ? 2 : 1;
    }

    isPulseOpen(p, clock = this.clock) {
      return ((clock + p.offset) % PULSE_PERIOD) < PULSE_PERIOD / 2;
    }
    // 0..1 how close this gate is to switching (for the flicker warning)
    pulseWarning(p) {
      const ph = (this.clock + p.offset) % (PULSE_PERIOD / 2);
      const left = PULSE_PERIOD / 2 - ph;
      return left < PULSE_WARN ? 1 - left / PULSE_WARN : 0;
    }
    _occupied(r, c) {
      const p = this.player;
      return (p.r === r && p.c === c) || (p.fr === r && p.fc === c && p.t < 1);
    }

    canEnter(r, c) {
      if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return false;
      const ch = this.grid[r][c];
      if (ch === '#') return false;
      if (ch === 'A' || ch === 'B' || ch === 'C') return this.keys.has(ch.toLowerCase());
      if (ch === '~') return this.isPulseOpen(this.pulseAt.get(r * this.cols + c)) || this._occupied(r, c);
      return true;
    }
    _scannerCanEnter(r, c) {
      const ch = this.grid[r] && this.grid[r][c];
      return ch !== undefined && ch !== '#' && ch !== '~' && ch !== 'E' && !/[ABC]/.test(ch);
    }

    // Interpolated player position in cell units
    playerPos() {
      const p = this.player, t = p.t;
      return { r: p.fr + (p.r - p.fr) * t, c: p.fc + (p.c - p.fc) * t };
    }
    scannerPos(s) { return { r: s.fr + (s.tr - s.fr) * s.t, c: s.fc + (s.tc - s.fc) * s.t }; }

    update(dt) {
      if (this.state !== 'playing') return;
      this.clock += dt;
      this.elapsed += dt;
      this.timeLeft -= dt;
      this.grace = Math.max(0, this.grace - dt);
      this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
      this.pingCooldown = Math.max(0, this.pingCooldown - dt);

      this._movePlayer(dt);
      if (this.state !== 'playing') return;
      this._moveScanners(dt);
      this._checkScanners();

      const whole = Math.ceil(this.timeLeft);
      if (whole < this.lastWhole) {
        this.lastWhole = whole;
        if (whole <= LOW_TIME && whole > 0) this.events.push({ type: 'tick', left: whole });
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.state = 'lost';
        this.events.push({ type: 'lose' });
      }
    }

    _movePlayer(dt) {
      const p = this.player;
      let remaining = dt;
      while (remaining > 0 && this.state === 'playing') {
        if (p.t < 1) {
          const need = (1 - p.t) * STEP_TIME;
          if (remaining < need) { p.t += remaining / STEP_TIME; return; }
          remaining -= need;
          p.t = 1;
          this._arrive();
          continue;
        }
        if (!this._startMove()) return;
      }
    }

    _startMove() {
      const p = this.player;
      const order = [];
      if (this.queued) order.push(this.queued);
      for (const d of this.held) if (!order.includes(d)) order.push(d);
      if (!order.length) return false;
      for (const d of order) {
        const [dr, dc] = DIRS[d];
        const nr = p.r + dr, nc = p.c + dc;
        if (!this.canEnter(nr, nc)) continue;
        const ch = this.grid[nr][nc];
        if (ch === 'A' || ch === 'B' || ch === 'C') {
          this.grid[nr][nc] = ' ';
          this.events.push({ type: 'door', r: nr, c: nc, key: ch.toLowerCase() });
        }
        if (this.queued === d) this.queued = null;
        p.fr = p.r; p.fc = p.c; p.r = nr; p.c = nc; p.t = 0; p.dir = d;
        this._look(nr, nc);
        this.events.push({ type: 'step', r: nr, c: nc });
        return true;
      }
      // nothing passable
      const tried = order[0];
      const [dr, dc] = DIRS[tried];
      const ch = this.grid[p.r + dr] && this.grid[p.r + dr][p.c + dc];
      if (this.queued || this.bumpCooldown <= 0) {
        this.events.push({ type: 'bump', dir: tried, locked: /[ABC]/.test(ch || ''), pulse: ch === '~' });
        this.bumpCooldown = 0.3;
      }
      this.queued = null;
      return false;
    }

    _arrive() {
      const p = this.player;
      const ch = this.grid[p.r][p.c];
      if (ch === 't') {
        this.grid[p.r][p.c] = ' ';
        const amount = this.level.crystal || 4;
        this.timeLeft += amount;
        this.lastWhole = Math.ceil(this.timeLeft);
        this.crystalsTaken++;
        this.events.push({ type: 'crystal', r: p.r, c: p.c, amount });
      } else if (ch === 'a' || ch === 'b' || ch === 'c') {
        this.grid[p.r][p.c] = ' ';
        this.keys.add(ch);
        this.events.push({ type: 'key', r: p.r, c: p.c, key: ch });
      } else if (ch === 'E') {
        this.state = 'won';
        this.stars = this.starsFor(this.elapsed);
        this.events.push({ type: 'win', elapsed: this.elapsed, stars: this.stars });
      }
    }

    _moveScanners(dt) {
      for (const s of this.scanners) {
        let remaining = dt * SCANNER_SPEED;
        let guard = 0;
        while (remaining > 0 && guard++ < 8) {
          if (s.t < 1) {
            const need = 1 - s.t;
            if (remaining < need) { s.t += remaining; break; }
            remaining -= need; s.t = 1; s.r = s.tr; s.c = s.tc;
            continue;
          }
          const [dr, dc] = s.axis === 'h' ? [0, s.dir] : [s.dir, 0];
          if (!this._scannerCanEnter(s.r + dr, s.c + dc)) {
            s.dir = -s.dir;
            const [br, bc] = s.axis === 'h' ? [0, s.dir] : [s.dir, 0];
            if (!this._scannerCanEnter(s.r + br, s.c + bc)) break;
            continue;
          }
          s.fr = s.r; s.fc = s.c; s.tr = s.r + dr; s.tc = s.c + dc; s.t = 0;
        }
      }
    }

    _checkScanners() {
      if (!this.scanners.length) return;
      const pp = this.playerPos();
      let nearest = Infinity;
      for (const s of this.scanners) {
        const sp = this.scannerPos(s);
        const d = Math.hypot(sp.r - pp.r, sp.c - pp.c);
        nearest = Math.min(nearest, d);
        if (d < HIT_RADIUS && this.grace <= 0) {
          this.timeLeft -= HIT_PENALTY;
          this.grace = HIT_GRACE;
          this.hits++;
          this.lastWhole = Math.ceil(this.timeLeft);
          this.events.push({ type: 'hit', r: pp.r, c: pp.c, amount: HIT_PENALTY });
        }
      }
      if (nearest <= PING_RANGE && this.pingCooldown <= 0) {
        this.events.push({ type: 'ping', closeness: 1 - nearest / PING_RANGE });
        this.pingCooldown = 0.35 + 0.6 * (nearest / PING_RANGE);
      }
    }

    // Light: flood through open corridors from (r,c) within the fog radius.
    _look(r0, c0) {
      const n = this.rows * this.cols;
      this.visible.fill(0);
      if (!this.fog) { this.visible.fill(1); this.seen.fill(1); return; }
      const R = this.fog, maxSteps = Math.ceil(R * 1.6);
      const dist = new Int16Array(n).fill(-1);
      const q = [r0 * this.cols + c0];
      dist[q[0]] = 0;
      for (let i = 0; i < q.length; i++) {
        const idx = q[i], r = Math.floor(idx / this.cols), c = idx % this.cols;
        this.visible[idx] = 1;
        const ch = this.grid[r][c];
        if (i > 0 && (ch === '~' || ch === 'A' || ch === 'B' || ch === 'C')) continue; // see it, not past it
        if (dist[idx] >= maxSteps) continue;
        for (const [dr, dc] of Object.values(DIRS)) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.cols) continue;
          const ni = nr * this.cols + nc;
          if (dist[ni] >= 0 || this.grid[nr][nc] === '#') continue;
          if (Math.hypot(nr - r0, nc - c0) > R) continue;
          dist[ni] = dist[idx] + 1;
          q.push(ni);
        }
      }
      // walls bordering lit floor
      for (const idx of q) {
        const r = Math.floor(idx / this.cols), c = idx % this.cols;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.cols) continue;
          if (this.grid[nr][nc] === '#' && Math.hypot(nr - r0, nc - c0) <= R + 1) this.visible[nr * this.cols + nc] = 1;
        }
      }
      for (let i = 0; i < n; i++) if (this.visible[i]) this.seen[i] = 1;
    }

    drainEvents() { const e = this.events; this.events = []; return e; }
  }

  // ---------------------------------------------------------------- renderer
  const PALETTES = {
    dark: {
      bg: '#05060f', fog: '#020309', grid: 'rgba(0, 229, 255, 0.05)',
      wall: '#00e5ff', wallCore: '#c9fbff', wallFill: 'rgba(0, 229, 255, 0.07)', glow: 1,
      player: '#ff2bd6', exit: '#39ff14', crystal: '#f4f7ff', crystalGlow: '#9ffcff',
      keys: { a: '#ffc400', b: '#b26bff', c: '#4d7cff' },
      pulse: '#ff7a1a', scanner: '#ff2a4a', text: '#e5f9ff', danger: '#ff2a4a',
    },
    light: {
      bg: '#eef1f8', fog: '#d9deea', grid: 'rgba(0, 90, 140, 0.06)',
      wall: '#0077a8', wallCore: '#0a4f73', wallFill: 'rgba(0, 119, 168, 0.12)', glow: 0.35,
      player: '#d1007a', exit: '#108a00', crystal: '#0d9488', crystalGlow: '#5eead4',
      keys: { a: '#b37f00', b: '#7a2fd6', c: '#2448d8' },
      pulse: '#ea580c', scanner: '#dc2626', text: '#0f172a', danger: '#dc2626',
    },
  };

  class NeonLabyrinthRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.pal = PALETTES.dark;
      this.particles = [];
      this.texts = [];
      this.trail = [];
      this.shake = 0;
      this.flash = null;
      this.cam = null;
      this.fogCanvas = document.createElement('canvas');
    }

    setTheme(name) { this.pal = PALETTES[name] || PALETTES.dark; if (this.game) this.layout(this.game); }

    layout(game) {
      this.game = game;
      const W = this.canvas.width, H = this.canvas.height;
      const fit = Math.min(Math.floor(W / game.cols), Math.floor(H / game.rows), 56);
      const shown = this.canvas.clientWidth || W;
      const minCell = Math.ceil(17 * (W / shown)); // keep cells >= ~17 CSS px on small screens
      this.cell = Math.max(fit, Math.min(minCell, 56));
      this.mazeW = game.cols * this.cell;
      this.mazeH = game.rows * this.cell;
      this._buildStatic();
      this.fogCanvas.width = W + 2 * this.cell; this.fogCanvas.height = H + 2 * this.cell;
      this.trail = [];
      this.cam = null;
      this.particles = []; this.texts = []; this.flash = null; this.shake = 0;
    }

    _buildStatic() {
      const g = this.game, cs = this.cell, pal = this.pal;
      const off = document.createElement('canvas');
      off.width = this.mazeW; off.height = this.mazeH;
      const x = off.getContext('2d');
      x.fillStyle = pal.bg; x.fillRect(0, 0, off.width, off.height);
      // faint floor grid
      x.strokeStyle = pal.grid; x.lineWidth = 1;
      x.beginPath();
      for (let r = 0; r <= g.rows; r++) { x.moveTo(0, r * cs + 0.5); x.lineTo(off.width, r * cs + 0.5); }
      for (let c = 0; c <= g.cols; c++) { x.moveTo(c * cs + 0.5, 0); x.lineTo(c * cs + 0.5, off.height); }
      x.stroke();
      const wall = (r, c) => r < 0 || c < 0 || r >= g.rows || c >= g.cols || g.level.map[r][c] === '#';
      x.fillStyle = pal.wallFill;
      const edges = new Path2D();
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        if (!wall(r, c)) continue;
        x.fillRect(c * cs, r * cs, cs, cs);
        const X = c * cs, Y = r * cs;
        if (!wall(r - 1, c) && r > 0) { edges.moveTo(X, Y); edges.lineTo(X + cs, Y); }
        if (!wall(r + 1, c) && r < g.rows - 1) { edges.moveTo(X, Y + cs); edges.lineTo(X + cs, Y + cs); }
        if (!wall(r, c - 1) && c > 0) { edges.moveTo(X, Y); edges.lineTo(X, Y + cs); }
        if (!wall(r, c + 1) && c < g.cols - 1) { edges.moveTo(X + cs, Y); edges.lineTo(X + cs, Y + cs); }
      }
      x.lineCap = 'round';
      x.strokeStyle = pal.wall;
      x.shadowColor = pal.wall;
      x.shadowBlur = cs * 0.45 * pal.glow;
      x.lineWidth = Math.max(2, cs * 0.1);
      x.stroke(edges);
      x.shadowBlur = 0;
      x.strokeStyle = pal.wallCore;
      x.lineWidth = Math.max(1, cs * 0.035);
      x.stroke(edges);
      this.staticLayer = off;
    }

    handleEvents(events) {
      const cs = this.cell;
      const center = (r, c) => ({ x: (c + 0.5) * cs, y: (r + 0.5) * cs });
      for (const e of events) {
        if (e.type === 'crystal') {
          const p = center(e.r, e.c);
          this._burst(p.x, p.y, this.pal.crystalGlow, 18);
          this.texts.push({ x: p.x, y: p.y, text: `+${e.amount}s`, color: this.pal.crystalGlow, life: 1 });
        } else if (e.type === 'key') {
          const p = center(e.r, e.c);
          this._burst(p.x, p.y, this.pal.keys[e.key], 22);
          this.texts.push({ x: p.x, y: p.y, text: 'KEY', color: this.pal.keys[e.key], life: 1 });
        } else if (e.type === 'door') {
          const p = center(e.r, e.c);
          this._burst(p.x, p.y, this.pal.keys[e.key], 26);
          this.flash = { color: this.pal.keys[e.key], a: 0.18 };
        } else if (e.type === 'hit') {
          const p = center(e.r, e.c);
          this.shake = cs * 0.35;
          this.flash = { color: this.pal.danger, a: 0.35 };
          this._burst(p.x, p.y, this.pal.scanner, 16);
          this.texts.push({ x: p.x, y: p.y, text: `-${e.amount}s`, color: this.pal.danger, life: 1.2 });
        } else if (e.type === 'bump') {
          this.shake = Math.max(this.shake, cs * 0.06);
        } else if (e.type === 'win') {
          const p = center(this.game.exit.r, this.game.exit.c);
          this._burst(p.x, p.y, this.pal.exit, 60);
          this._burst(p.x, p.y, this.pal.player, 30);
          this.flash = { color: this.pal.exit, a: 0.45 };
        } else if (e.type === 'lose') {
          this.flash = { color: this.pal.danger, a: 0.5 };
          this.shake = cs * 0.25;
        }
      }
    }

    _burst(x, y, color, n) {
      const cs = this.cell;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = (0.5 + Math.random()) * cs * 4;
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.5, color });
      }
    }

    draw(now, dt) {
      const g = this.game, ctx = this.ctx, cs = this.cell, pal = this.pal;
      const W = this.canvas.width, H = this.canvas.height;
      const t = now / 1000;
      const pp = g.playerPos();
      const px = (pp.c + 0.5) * cs, py = (pp.r + 0.5) * cs;

      // camera: centre the maze when it fits, else follow the player
      const target = {
        x: this.mazeW <= W ? (this.mazeW - W) / 2 : Math.max(0, Math.min(this.mazeW - W, px - W / 2)),
        y: this.mazeH <= H ? (this.mazeH - H) / 2 : Math.max(0, Math.min(this.mazeH - H, py - H / 2)),
      };
      if (!this.cam) this.cam = { ...target };
      const k = 1 - Math.pow(0.0005, dt);
      this.cam.x += (target.x - this.cam.x) * k;
      this.cam.y += (target.y - this.cam.y) * k;
      this.shake = Math.max(0, this.shake - dt * cs * 2.5);
      const sx = (Math.random() - 0.5) * this.shake * 2, sy = (Math.random() - 0.5) * this.shake * 2;
      const ox = Math.round(-this.cam.x + sx), oy = Math.round(-this.cam.y + sy);

      ctx.save();
      ctx.fillStyle = pal.fog; ctx.fillRect(0, 0, W, H);
      ctx.translate(ox, oy);
      ctx.drawImage(this.staticLayer, 0, 0);

      // items and hazards (fog covers what you have not seen)
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        const ch = g.grid[r][c];
        if (ch === ' ' || ch === '#') continue;
        const X = c * cs, Y = r * cs;
        if (ch === 't') this._crystal(X, Y, t);
        else if (ch === 'a' || ch === 'b' || ch === 'c') this._key(X, Y, pal.keys[ch], t);
        else if (ch === 'A' || ch === 'B' || ch === 'C') this._door(X, Y, ch.toLowerCase(), t);
        else if (ch === '~') this._pulse(g.pulseAt.get(r * g.cols + c), X, Y, t);
        else if (ch === 'E') this._exitTile(X, Y, t);
      }
      for (const s of g.scanners) this._scanner(s, t);

      // trail
      if (g.state === 'playing' || g.state === 'won') {
        const last = this.trail[this.trail.length - 1];
        if (!last || Math.hypot(last.x - px, last.y - py) > cs * 0.12) this.trail.push({ x: px, y: py });
        if (this.trail.length > 18) this.trail.shift();
      }
      if (this.trail.length > 1) {
        ctx.lineCap = 'round';
        for (let i = 1; i < this.trail.length; i++) {
          const a = i / this.trail.length;
          ctx.strokeStyle = this._alpha(pal.player, a * 0.5);
          ctx.lineWidth = cs * 0.28 * a;
          ctx.beginPath();
          ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
          ctx.lineTo(this.trail[i].x, this.trail[i].y);
          ctx.stroke();
        }
      }
      ctx.restore();

      if (g.fog) this._drawFog(ox, oy, pp);

      ctx.save();
      ctx.translate(ox, oy);
      this._beacon(t);
      this._player(px, py, t);
      // particles and floating text
      for (const p of this.particles) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt;
        ctx.fillStyle = this._alpha(p.color, Math.max(0, p.life));
        ctx.fillRect(p.x - cs * 0.06, p.y - cs * 0.06, cs * 0.12, cs * 0.12);
      }
      this.particles = this.particles.filter(p => p.life > 0);
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.round(cs * 0.55)}px ui-monospace, Consolas, monospace`;
      for (const f of this.texts) {
        f.life -= dt; f.y -= dt * cs * 1.4;
        ctx.fillStyle = this._alpha(f.color, Math.max(0, Math.min(1, f.life)));
        ctx.fillText(f.text, f.x, f.y);
      }
      this.texts = this.texts.filter(f => f.life > 0);
      ctx.restore();

      // low-time vignette
      if (g.state === 'playing' && g.timeLeft < LOW_TIME) {
        const a = 0.18 + 0.14 * Math.sin(t * 8);
        const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.65);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, this._alpha(pal.danger, a));
        ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
      }
      if (this.flash) {
        ctx.fillStyle = this._alpha(this.flash.color, this.flash.a);
        ctx.fillRect(0, 0, W, H);
        this.flash.a -= dt * 1.2;
        if (this.flash.a <= 0) this.flash = null;
      }
      if (g.state === 'paused') {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
        ctx.font = 'bold 44px ui-monospace, Consolas, monospace';
        ctx.fillText('PAUSED', W / 2, H / 2);
        ctx.font = '20px ui-monospace, Consolas, monospace';
        ctx.fillText('P or Esc to resume', W / 2, H / 2 + 38);
      }
    }

    _drawFog(ox, oy, pp) {
      const g = this.game, cs = this.cell, W = this.canvas.width, H = this.canvas.height;
      // the fog layer has a one-cell margin so blurring it never lets light leak in at the canvas edges
      const M = cs, f = this.fogCanvas.getContext('2d');
      f.globalCompositeOperation = 'source-over';
      f.clearRect(0, 0, W + 2 * M, H + 2 * M);
      f.fillStyle = this.pal.fog;
      f.fillRect(0, 0, W + 2 * M, H + 2 * M);
      f.globalCompositeOperation = 'destination-out';
      ox += M; oy += M;
      const R = g.fog;
      const c0 = Math.max(0, Math.floor(-ox / cs)), c1 = Math.min(g.cols - 1, Math.ceil((W + 2 * M - ox) / cs));
      const r0 = Math.max(0, Math.floor(-oy / cs)), r1 = Math.min(g.rows - 1, Math.ceil((H + 2 * M - oy) / cs));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = r * g.cols + c;
        if (!g.seen[i]) continue;
        let a = 0.4; // remembered
        if (g.visible[i]) {
          const d = Math.hypot(r - pp.r, c - pp.c) / (R + 0.5);
          a = Math.max(0.4, Math.min(1, 1.15 - d * d * 0.75));
        }
        f.fillStyle = `rgba(0,0,0,${a})`;
        f.fillRect(c * cs + ox, r * cs + oy, cs, cs);
      }
      f.globalCompositeOperation = 'source-over';
      const ctx = this.ctx;
      ctx.save();
      if ('filter' in ctx) ctx.filter = `blur(${Math.round(cs * 0.3)}px)`;
      ctx.drawImage(this.fogCanvas, -M, -M);
      ctx.restore();
    }

    _alpha(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
    }

    _glow(color, blur) { this.ctx.shadowColor = color; this.ctx.shadowBlur = blur * this.pal.glow; }

    _crystal(X, Y, t) {
      const ctx = this.ctx, cs = this.cell, cx = X + cs / 2, cy = Y + cs / 2;
      const s = cs * (0.26 + 0.04 * Math.sin(t * 4 + X));
      ctx.save();
      this._glow(this.pal.crystalGlow, cs * 0.6);
      ctx.fillStyle = this.pal.crystal;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 1.25); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s * 1.25); ctx.lineTo(cx - s, cy);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    _key(X, Y, color, t) {
      const ctx = this.ctx, cs = this.cell;
      const cx = X + cs / 2, cy = Y + cs / 2 + Math.sin(t * 3) * cs * 0.05;
      ctx.save();
      this._glow(color, cs * 0.5);
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.lineWidth = Math.max(2, cs * 0.1);
      ctx.beginPath(); ctx.arc(cx - cs * 0.14, cy, cs * 0.15, 0, Math.PI * 2); ctx.stroke();
      ctx.fillRect(cx, cy - cs * 0.04, cs * 0.28, cs * 0.08);
      ctx.fillRect(cx + cs * 0.18, cy, cs * 0.07, cs * 0.14);
      ctx.restore();
    }

    _door(X, Y, key, t) {
      const ctx = this.ctx, cs = this.cell, color = this.pal.keys[key];
      const ready = this.game.keys.has(key);
      ctx.save();
      this._glow(color, cs * (ready ? 0.8 : 0.35));
      ctx.fillStyle = this._alpha(color, ready ? 0.35 + 0.2 * Math.sin(t * 6) : 0.25);
      ctx.fillRect(X + 1, Y + 1, cs - 2, cs - 2);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, cs * 0.08);
      ctx.strokeRect(X + cs * 0.12, Y + cs * 0.12, cs * 0.76, cs * 0.76);
      ctx.beginPath();
      for (let i = 1; i <= 2; i++) { ctx.moveTo(X + cs * i / 3, Y + cs * 0.12); ctx.lineTo(X + cs * i / 3, Y + cs * 0.88); }
      ctx.stroke();
      ctx.restore();
    }

    _pulse(p, X, Y, t) {
      const ctx = this.ctx, cs = this.cell, g = this.game, color = this.pal.pulse;
      const warn = g.pulseWarning(p);
      const flicker = warn > 0 && Math.sin(t * 40) > 0;
      ctx.save();
      if (g.isPulseOpen(p) || g._occupied(p.r, p.c)) {
        ctx.strokeStyle = this._alpha(color, flicker ? 0.9 : 0.35);
        ctx.setLineDash([cs * 0.12, cs * 0.12]);
        ctx.lineWidth = Math.max(1, cs * 0.05);
        ctx.strokeRect(X + cs * 0.15, Y + cs * 0.15, cs * 0.7, cs * 0.7);
      } else {
        this._glow(color, cs * 0.7);
        ctx.fillStyle = this._alpha(color, flicker ? 0.45 : 0.85);
        const n = 4;
        for (let i = 0; i < n; i++) ctx.fillRect(X + 2, Y + (i + 0.2) * cs / n, cs - 4, cs / n * 0.55);
      }
      ctx.restore();
    }

    _exitTile(X, Y, t) {
      const ctx = this.ctx, cs = this.cell;
      ctx.save();
      this._glow(this.pal.exit, cs * 0.8);
      ctx.fillStyle = this.pal.exit;
      const s = cs * (0.5 + 0.06 * Math.sin(t * 5));
      ctx.fillRect(X + (cs - s) / 2, Y + (cs - s) / 2, s, s);
      ctx.restore();
    }

    // beacon rings drawn above the fog: you always know where the exit is
    _beacon(t) {
      const ctx = this.ctx, cs = this.cell, e = this.game.exit;
      const cx = (e.c + 0.5) * cs, cy = (e.r + 0.5) * cs;
      ctx.save();
      ctx.strokeStyle = this.pal.exit;
      for (let i = 0; i < 2; i++) {
        const ph = (t * 0.6 + i / 2) % 1;
        ctx.globalAlpha = (1 - ph) * 0.6;
        ctx.lineWidth = Math.max(1.5, cs * 0.07);
        ctx.beginPath(); ctx.arc(cx, cy, cs * (0.3 + ph * 1.4), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    _scanner(s, t) {
      const ctx = this.ctx, cs = this.cell, color = this.pal.scanner;
      const sp = this.game.scannerPos(s);
      const cx = (sp.c + 0.5) * cs, cy = (sp.r + 0.5) * cs;
      ctx.save();
      this._glow(color, cs * 0.6);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, cs * 0.08);
      ctx.beginPath(); ctx.arc(cx, cy, cs * 0.32, 0, Math.PI * 2); ctx.stroke();
      const a = t * 5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, cs * 0.32, a, a + 1); ctx.closePath();
      ctx.fillStyle = this._alpha(color, 0.6); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, cs * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    _player(px, py, t) {
      const ctx = this.ctx, cs = this.cell, g = this.game;
      if (g.grace > 0 && Math.sin(t * 30) > 0) return;
      const moving = g.player.t < 1 && g.state === 'playing';
      const horiz = g.player.dir === 'left' || g.player.dir === 'right';
      const stretch = moving ? 1.15 : 1, squash = moving ? 0.88 : 1;
      const w = cs * 0.52 * (horiz ? stretch : squash), h = cs * 0.52 * (horiz ? squash : stretch);
      ctx.save();
      this._glow(this.pal.player, cs * 0.9);
      ctx.fillStyle = this.pal.player;
      this._roundRect(px - w / 2, py - h / 2, w, h, cs * 0.12);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      this._roundRect(px - w * 0.18, py - h * 0.18, w * 0.36, h * 0.36, cs * 0.05);
      ctx.fill();
      ctx.restore();
    }

    _roundRect(x, y, w, h, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
  }

  root.NeonLabyrinthGame = NeonLabyrinthGame;
  root.NeonLabyrinthRenderer = NeonLabyrinthRenderer;
  root.__NEON_LABYRINTH_CONST = { STEP_TIME, PULSE_PERIOD, SCANNER_SPEED, HIT_PENALTY, LOW_TIME, DIRS };
})(typeof window !== 'undefined' ? window : globalThis);
