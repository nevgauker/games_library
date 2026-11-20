// Snake: classic retro grid game (pure logic, no rendering)
(function(global){
  const TILE = 16; // px per cell
  const GRID = { cols: 24, rows: 24 }; // 384x384 canvas by default
  const BASE_SPEED = 8; // cells per second
  const SPEED_INC = 0.06; // +6% per food
  const MAX_SPEED = 20;
  const INPUT_QUEUE = 2; // buffered turns, so quick double-turns are not lost

  const OPPOSITE = { left:'right', right:'left', up:'down', down:'up' };

  class Emitter {
    constructor(){ this.map = new Map(); }
    on(ev, fn){ if (!this.map.has(ev)) this.map.set(ev, []); this.map.get(ev).push(fn); }
    emit(ev, v){ const a = this.map.get(ev); if (a) for (const f of a) f(v); }
  }

  class SnakeGame extends Emitter {
    constructor(){
      super();
      this.cols = GRID.cols;
      this.rows = GRID.rows;
      this.tile = TILE;
      this.width = this.cols * this.tile;
      this.height = this.rows * this.tile;
      this.wrapWalls = false; // classic off by default
      this.restart();
    }

    get mode(){ return this.wrapWalls ? 'wrap' : 'classic'; }
    // A run is "in progress" from start() until it ends; settings are locked meanwhile.
    get inProgress(){ return this.started && this.alive; }
    // 0..1 progress from `prev` to `snake` within the current step (for smooth rendering).
    get progress(){ return this.inProgress ? Math.min(1, this.timer * this.speed) : 1; }

    restart(){
      const cx = Math.floor(this.cols/2);
      const cy = Math.floor(this.rows/2);
      this.snake = [ {x: cx, y: cy}, {x: cx-1, y: cy}, {x: cx-2, y: cy} ];
      this.prev = this.snake.map(s => ({ x: s.x, y: s.y }));
      this.deathReason = null;
      this.dir = 'right';
      this.queue = [];
      this.alive = true;
      this.started = false;
      this.paused = false;
      this.won = false;
      this.score = 0;
      this.speed = BASE_SPEED; // cells/sec
      this.timer = 0; // accumulates time between steps
      this.placeFood();
      this.emit('restart');
      this.emit('score', this.score);
      this.emit('length', this.snake.length);
      this.emit('speed', this.speed/BASE_SPEED);
    }

    start(){
      if (this.started || !this.alive) return;
      this.started = true;
      this.timer = 0;
      this.emit('start');
    }

    input(dir){
      if (!OPPOSITE[dir] || !this.alive) return;
      // Validate against the last queued direction, not the current one,
      // so e.g. right -> (up, left) is a legal quick U-turn.
      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
      if (dir === last || OPPOSITE[dir] === last) return;
      if (this.queue.length < INPUT_QUEUE) this.queue.push(dir);
    }

    placeFood(){
      const occupied = new Set(this.snake.map(s => s.x + ',' + s.y));
      const free = [];
      for (let y = 0; y < this.rows; y++)
        for (let x = 0; x < this.cols; x++)
          if (!occupied.has(x + ',' + y)) free.push({ x, y });
      this.food = free.length ? free[Math.floor(Math.random() * free.length)] : null;
    }

    step(dt){
      if (!this.started || !this.alive || this.paused) return;
      this.timer += dt;
      const stepTime = 1 / this.speed; // seconds per grid move
      while (this.alive && this.timer >= stepTime) {
        this.timer -= stepTime;
        this.tick();
      }
    }

    tick(){
      if (this.queue.length) this.dir = this.queue.shift();
      const v = dirVec(this.dir);
      const head = this.snake[0];
      let nx = head.x + v.dx;
      let ny = head.y + v.dy;

      // wrap or collide with walls
      if (this.wrapWalls) {
        nx = (nx + this.cols) % this.cols;
        ny = (ny + this.rows) % this.rows;
      } else if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows) {
        this.gameOver('wall');
        return;
      }

      const eats = !!this.food && nx === this.food.x && ny === this.food.y;
      // Self collision. The tail cell vacates this tick unless we grow, so it is safe.
      const checkLen = eats ? this.snake.length : this.snake.length - 1;
      for (let i = 0; i < checkLen; i++){
        const s = this.snake[i];
        if (s.x === nx && s.y === ny) { this.gameOver('self'); return; }
      }

      this.prev = this.snake.map(s => ({ x: s.x, y: s.y }));
      this.snake.unshift({ x: nx, y: ny });

      if (eats) {
        this.score += 10;
        this.speed = Math.min(MAX_SPEED, this.speed * (1 + SPEED_INC));
        this.emit('score', this.score);
        this.emit('length', this.snake.length);
        this.emit('speed', this.speed/BASE_SPEED);
        this.emit('eat', { x: nx, y: ny, score: this.score });
        this.placeFood();
        if (!this.food) this.win();
      } else {
        this.snake.pop();
      }
    }

    gameOver(reason){
      this.alive = false;
      this.deathReason = reason;
      this.emit('lose', { score: this.score, reason });
    }

    win(){
      this.alive = false;
      this.won = true;
      this.prev = this.snake.map(s => ({ x: s.x, y: s.y }));
      this.emit('win', { score: this.score });
    }

    // Walls can only be changed between runs.
    setWrap(enabled){
      if (this.inProgress) return false;
      this.wrapWalls = !!enabled;
      this.emit('wrap', this.wrapWalls);
      return true;
    }
    toggleWrap(){ return this.setWrap(!this.wrapWalls); }
    pause(){ if (!this.inProgress || this.paused) return; this.paused = true; this.emit('pause'); }
    resume(){ if (!this.inProgress || !this.paused) return; this.paused = false; this.emit('resume'); }
    togglePause(){ this.paused ? this.resume() : this.pause(); }
  }

  function dirVec(dir){
    switch (dir) {
      case 'left': return { dx: -1, dy: 0 };
      case 'right': return { dx: 1, dy: 0 };
      case 'up': return { dx: 0, dy: -1 };
      case 'down': return { dx: 0, dy: 1 };
      default: return { dx: 0, dy: 0 };
    }
  }

  SnakeGame.dirVec = dirVec;
  global.SnakeGame = SnakeGame;
  global.__SNAKE_CONST = { TILE, GRID };
})(window);
