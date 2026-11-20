// Snake: classic retro grid game (pure logic, no rendering)
(function(global){
  const TILE = 16; // px per cell
  const GRID = { cols: 24, rows: 24 }; // 384x384 logical board
  const INPUT_QUEUE = 2; // buffered turns, so quick double-turns are not lost

  // Modes: walls, self-collision, hazards and pacing in one place.
  const MODES = {
    classic: { label: 'Classic', wrap: false, selfHit: true,  rocks: true,  combo: true,  speedGain: 10 },
    wrap:    { label: 'Wrap',    wrap: true,  selfHit: true,  rocks: true,  combo: true,  speedGain: 10 },
    zen:     { label: 'Zen',     wrap: true,  selfHit: false, rocks: false, combo: false, speedGain: 4 },
  };
  const MODE_ORDER = ['classic', 'wrap', 'zen'];

  // Pacing: speed rises smoothly with apples eaten and keeps rising slowly
  // instead of hitting a hard cap early.
  const BASE_SPEED = 8;       // cells per second at the start
  const SPEED_CURVE = 25;     // apples to reach ~63% of the gain

  // Scoring
  const APPLE_POINTS = 10;
  const MAX_COMBO = 5;
  const COMBO_GRACE = 2.0;    // seconds on top of the travel time to the apple
  const COMBO_SLACK = 1.4;    // multiplier on straight-line travel time

  // Golden fruit
  const BONUS_EVERY = 5;      // apples
  const BONUS_LIFE = 6;       // seconds
  const BONUS_POINTS = 50;
  const BONUS_GROW = 2;

  // Rocks
  const ROCKS_EVERY = 6;      // apples
  const ROCKS_PER_WAVE = 2;
  const ROCKS_MAX = 30;
  const ROCK_ARM_TIME = 2;    // seconds of warning before a rock turns solid
  const ROCK_HEAD_CLEAR = 6;  // min distance from the head
  const ROCK_FOOD_CLEAR = 2;  // min distance from the apple

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
      this.mode = 'classic';
      this.restart();
    }

    get rules(){ return MODES[this.mode]; }
    get wrapWalls(){ return this.rules.wrap; }
    // A run is "in progress" from start() until it ends; settings are locked meanwhile.
    get inProgress(){ return this.started && this.alive; }
    // 0..1 progress from `prev` to `snake` within the current step (for smooth rendering).
    get progress(){ return this.inProgress ? Math.min(1, this.timer * this.speed) : 1; }
    // 0..1 time left to keep the combo going (for the ring around the apple).
    get comboLeft(){
      if (!this.rules.combo || !this.comboWindow) return 0;
      return Math.max(0, Math.min(1, (this.comboDeadline - this.time) / this.comboWindow));
    }

    restart(){
      const cx = Math.floor(this.cols/2);
      const cy = Math.floor(this.rows/2);
      this.snake = [ {x: cx, y: cy}, {x: cx-1, y: cy}, {x: cx-2, y: cy} ];
      this.prev = this.snake.map(s => ({ x: s.x, y: s.y }));
      this.dir = 'right';
      this.queue = [];
      this.alive = true;
      this.started = false;
      this.paused = false;
      this.won = false;
      this.deathReason = null;
      this.score = 0;
      this.apples = 0;
      this.combo = 1;
      this.maxCombo = 1;
      this.comboDeadline = 0;
      this.comboWindow = 0;
      this.pendingGrow = 0;
      this.time = 0;  // seconds of play this run
      this.timer = 0; // accumulates time between steps
      this.rocks = [];  // { x, y, armAt, armed }
      this.bonus = null; // { x, y, expires }
      this.speed = this.speedFor(0);
      this.food = null;
      this.placeFood();
      this.emit('restart');
      this.emit('score', this.score);
      this.emit('length', this.snake.length);
      this.emit('speed', this.speed / BASE_SPEED);
      this.emit('combo', this.combo);
    }

    speedFor(apples){
      return BASE_SPEED + this.rules.speedGain * (1 - Math.exp(-apples / SPEED_CURVE));
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

    // ---- Board helpers
    dist(a, b){
      let dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (this.wrapWalls) { dx = Math.min(dx, this.cols - dx); dy = Math.min(dy, this.rows - dy); }
      return dx + dy;
    }
    occupiedSet(){
      const s = new Set(this.snake.map(c => c.x + ',' + c.y));
      for (const r of this.rocks) s.add(r.x + ',' + r.y);
      if (this.food) s.add(this.food.x + ',' + this.food.y);
      if (this.bonus) s.add(this.bonus.x + ',' + this.bonus.y);
      return s;
    }
    freeCells(filter){
      const occ = this.occupiedSet();
      const out = [];
      for (let y = 0; y < this.rows; y++)
        for (let x = 0; x < this.cols; x++)
          if (!occ.has(x + ',' + y) && (!filter || filter({ x, y }))) out.push({ x, y });
      return out;
    }
    rockAt(x, y){ return this.rocks.find(r => r.x === x && r.y === y); }
    pick(cells){ return cells.length ? cells[Math.floor(Math.random() * cells.length)] : null; }

    placeFood(){
      this.food = null;
      this.food = this.pick(this.freeCells());
      if (this.food && this.rules.combo) {
        // Combo window scales with how far the apple is, so far apples are fair.
        const travel = this.dist(this.snake[0], this.food) / this.speed;
        this.comboWindow = travel * COMBO_SLACK + COMBO_GRACE;
        this.comboDeadline = this.time + this.comboWindow;
      }
    }

    spawnBonus(){
      const cell = this.pick(this.freeCells(c => this.dist(c, this.snake[0]) >= 3));
      if (!cell) return;
      this.bonus = { x: cell.x, y: cell.y, expires: this.time + BONUS_LIFE, life: BONUS_LIFE };
      this.emit('bonus-spawn', this.bonus);
    }

    spawnRocks(){
      if (this.rocks.length >= ROCKS_MAX) return;
      const head = this.snake[0];
      const v = dirVec(this.dir);
      let added = 0;
      for (let i = 0; i < ROCKS_PER_WAVE; i++){
        const cell = this.pick(this.freeCells(c => {
          if (this.dist(c, head) < ROCK_HEAD_CLEAR) return false;
          if (this.food && this.dist(c, this.food) < ROCK_FOOD_CLEAR) return false;
          // Never directly in the snake's current line of travel nearby.
          for (let k = 1; k <= 8; k++){
            let lx = head.x + v.dx * k, ly = head.y + v.dy * k;
            if (this.wrapWalls) { lx = (lx + this.cols) % this.cols; ly = (ly + this.rows) % this.rows; }
            if (lx === c.x && ly === c.y) return false;
          }
          return true;
        }));
        if (!cell) break;
        this.rocks.push({ x: cell.x, y: cell.y, armAt: this.time + ROCK_ARM_TIME, armed: false });
        added++;
      }
      if (added) this.emit('rocks-warn', added);
    }

    // ---- Time
    step(dt){
      if (!this.started || !this.alive || this.paused) return;
      this.time += dt;
      this.updateTimers();
      this.timer += dt;
      while (this.alive && this.timer >= 1 / this.speed) {
        this.timer -= 1 / this.speed;
        this.tick();
      }
    }

    updateTimers(){
      if (this.bonus && this.time >= this.bonus.expires) { this.bonus = null; this.emit('bonus-expire'); }
      if (this.combo > 1 && this.time > this.comboDeadline) { this.combo = 1; this.emit('combo', this.combo); }
      let armedNow = 0;
      for (const r of this.rocks){
        if (r.armed || this.time < r.armAt) continue;
        // Wait until the cell is clear of the snake before turning solid.
        if (this.snake.some(s => s.x === r.x && s.y === r.y)) continue;
        r.armed = true; armedNow++;
      }
      if (armedNow) this.emit('rocks', this.rocks.length);
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

      const rock = this.rockAt(nx, ny);
      if (rock && rock.armed) { this.gameOver('rock'); return; }

      const eats = !!this.food && nx === this.food.x && ny === this.food.y;
      const eatsBonus = !!this.bonus && nx === this.bonus.x && ny === this.bonus.y;
      const grows = eats || eatsBonus || this.pendingGrow > 0;

      // Self collision. The tail cell vacates this tick unless we grow, so it is safe.
      if (this.rules.selfHit) {
        const checkLen = grows ? this.snake.length : this.snake.length - 1;
        for (let i = 0; i < checkLen; i++){
          const s = this.snake[i];
          if (s.x === nx && s.y === ny) { this.gameOver('self'); return; }
        }
      }

      this.prev = this.snake.map(s => ({ x: s.x, y: s.y }));
      this.snake.unshift({ x: nx, y: ny });

      if (eats) this.eatApple(nx, ny);
      if (eatsBonus) this.eatBonus(nx, ny);

      if (eats || eatsBonus) {
        // the growth for this tick is the head we just added
      } else if (this.pendingGrow > 0) {
        this.pendingGrow--;
      } else {
        this.snake.pop();
      }
      if (eats || eatsBonus) this.emit('length', this.snake.length);

      if (eats && !this.food) this.win();
    }

    eatApple(x, y){
      this.apples++;
      if (this.rules.combo) {
        this.combo = this.time <= this.comboDeadline ? Math.min(MAX_COMBO, this.combo + 1) : 1;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
      }
      const points = APPLE_POINTS * this.combo;
      this.score += points;
      this.speed = this.speedFor(this.apples);
      this.emit('score', this.score);
      this.emit('speed', this.speed / BASE_SPEED);
      this.emit('combo', this.combo);
      this.emit('eat', { x, y, points, combo: this.combo, bonus: false });
      this.placeFood();
      if (!this.food) return;
      if (this.apples % BONUS_EVERY === 0 && !this.bonus) this.spawnBonus();
      if (this.rules.rocks && this.apples % ROCKS_EVERY === 0) this.spawnRocks();
    }

    eatBonus(x, y){
      this.bonus = null;
      this.score += BONUS_POINTS;
      this.pendingGrow += BONUS_GROW - 1; // the head added this tick is the first unit
      this.emit('score', this.score);
      this.emit('eat', { x, y, points: BONUS_POINTS, combo: this.combo, bonus: true });
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

    // Mode can only be changed between runs.
    setMode(mode){
      if (!MODES[mode] || this.inProgress) return false;
      this.mode = mode;
      this.restart();
      this.emit('mode', mode);
      return true;
    }
    nextMode(){ return this.setMode(MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length]); }
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
  SnakeGame.MODES = MODES;
  SnakeGame.MODE_ORDER = MODE_ORDER;
  SnakeGame.BONUS_LIFE = BONUS_LIFE;
  global.SnakeGame = SnakeGame;
  global.__SNAKE_CONST = { TILE, GRID };
})(window);
