// Snake: classic retro grid game
(function(global){
  const TILE = 16; // px per cell
  const GRID = { cols: 24, rows: 24 }; // 384x384 canvas by default
  const BASE_SPEED = 8; // cells per second
  const SPEED_INC = 0.06; // +6% per food

  function key(x,y){ return x+","+y; }

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
      this.paused = false;
      this.restart();
    }

    restart(){
      const cx = Math.floor(this.cols/2);
      const cy = Math.floor(this.rows/2);
      this.snake = [ {x: cx, y: cy}, {x: cx-1, y: cy}, {x: cx-2, y: cy} ];
      this.dir = 'right';
      this.nextDir = 'right';
      this.alive = true;
      this.score = 0;
      this.speed = BASE_SPEED; // cells/sec
      this.timer = 0; // accumulates time between steps
      this.placeFood();
      this.emit('score', this.score);
      this.emit('length', this.snake.length);
      this.emit('speed', this.speed/BASE_SPEED);
    }

    input(dir){
      const opp = { left:'right', right:'left', up:'down', down:'up' };
      if (dir && opp[dir] !== this.dir) this.nextDir = dir;
    }

    placeFood(){
      const occupied = new Set(this.snake.map(s => key(s.x,s.y)));
      let x, y, tries = 0;
      do {
        x = Math.floor(Math.random() * this.cols);
        y = Math.floor(Math.random() * this.rows);
        tries++;
        if (tries > 1000) break;
      } while (occupied.has(key(x,y)));
      this.food = { x, y };
    }

    step(dt){
      if (!this.alive || this.paused) return;
      this.timer += dt;
      const stepTime = 1 / this.speed; // seconds per grid move
      while (this.timer >= stepTime) {
        this.timer -= stepTime;
        this.tick();
      }
    }

    tick(){
      // update direction
      this.dir = this.nextDir || this.dir;
      const v = dirVec(this.dir);
      const head = this.snake[0];
      let nx = head.x + v.dx;
      let ny = head.y + v.dy;

      // wrap or collide with walls
      if (this.wrapWalls) {
        if (nx < 0) nx = this.cols - 1; else if (nx >= this.cols) nx = 0;
        if (ny < 0) ny = this.rows - 1; else if (ny >= this.rows) ny = 0;
      } else {
        if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows) {
          this.gameOver();
          return;
        }
      }
      // self collision
      for (let i = 0; i < this.snake.length; i++){
        const s = this.snake[i];
        if (s.x === nx && s.y === ny) { this.gameOver(); return; }
      }

      // move
      this.snake.unshift({ x: nx, y: ny });

      // food check
      if (this.food && nx === this.food.x && ny === this.food.y) {
        this.score += 10;
        this.emit('score', this.score);
        this.emit('length', this.snake.length);
        // speed up slightly each food for rising tension
        this.speed = Math.min(20, this.speed * (1 + SPEED_INC));
        this.emit('speed', this.speed/BASE_SPEED);
        this.emit('eat', { x: nx, y: ny, score: this.score });
        this.placeFood();
      } else {
        this.snake.pop(); // no grow
      }
    }

    gameOver(){
      this.alive = false;
      this.emit('lose');
    }

    setWrap(enabled){ this.wrapWalls = !!enabled; this.emit('wrap', this.wrapWalls); }
    toggleWrap(){ this.setWrap(!this.wrapWalls); }
    pause(){ if (!this.alive) return; this.paused = true; this.emit('pause'); }
    resume(){ if (!this.alive) return; this.paused = false; this.emit('resume'); }
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

  global.SnakeGame = SnakeGame;
  global.__SNAKE_CONST = { TILE, GRID };
})(window);
