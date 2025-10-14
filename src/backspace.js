// Backspace: minimalist 2D puzzle platformer with rewind ghosts
(function(global){
  const TILE = 24;
  const GRAV = 0.45;
  const MAX_FALL = 10;
  const SPEED = 1.3;
  const JUMP = -6.8;
  const HISTORY_FRAMES = 480; // ~8s at 60fps
  const GHOST_SPAN = 120; // ~2s path by default
  const COYOTE_FRAMES = 6; // jump forgiveness after leaving ground
  const JUMP_BUFFER_FRAMES = 6; // jump queued before landing

  // Levels (increasing difficulty)
  const LEVELS = [
    [
      "########################",
      "#......................#",
      "#..P..............S..D.#",
      "#...............#####..#",
      "#..............#.......#",
      "#......#####...#....G..#",
      "#............#.#.......#",
      "#............#.#.......#",
      "########################",
    ],
    // Level 2: requires ghost to hold switch while passing door gap
    [
      "########################",
      "#..............#####..G#",
      "#..P..........#.....#..#",
      "#..#####.S....#..D..#..#",
      "#..#...#......#.....#..#",
      "#..#...#..###########..#",
      "#..#...#...............#",
      "#..#####...............#",
      "########################",
    ],
    // Level 3: tighter jumps; switch away from door
    [
      "########################",
      "#......#####...........#",
      "#####..#...#..######...#",
      "#...#..# S #..#....#...#",
      "#...#..#####..# D..#..G#",
      "#...#.........#....#...#",
      "#...########..######...#",
      "#P.....................#",
      "########################",
    ],
  ];

  class BackspaceGame {
    constructor(levelIndex = 0) {
      this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, levelIndex));
      this.level = parseLevel(LEVELS[this.levelIndex]);
      this.width = this.level.cols * TILE;
      this.height = this.level.rows * TILE;
      this.reset();
    }

    reset(){
      const spawn = this.level.spawn || {x:2, y:2};
      this.player = { x: spawn.x*TILE+2, y: spawn.y*TILE-2, vx:0, vy:0, onGround:false };
      this.history = []; // {x,y}
      this.ghosts = []; // {path:[{x,y}], i, active}
      this.doorOpen = false;
      this.win = false;
      this.timeScale = 1;
      this.jumpCD = 0; // frames until next allowed jump
      this.framesSinceGrounded = COYOTE_FRAMES + 1;
      this.jumpBuffer = 0;
      this.emit && this.emit('ghosts', this.ghosts.length);
    }

    setLevel(index){
      this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
      this.level = parseLevel(LEVELS[this.levelIndex]);
      this.width = this.level.cols * TILE;
      this.height = this.level.rows * TILE;
      this.reset();
    }

    on(ev, fn){ this._ls=this._ls||new Map(); const a=this._ls.get(ev)||[]; a.push(fn); this._ls.set(ev,a); return ()=>this.off(ev,fn);} 
    off(ev,fn){ const a=(this._ls&&this._ls.get(ev))||[]; const i=a.indexOf(fn); if(i>=0)a.splice(i,1);} 
    emit(ev,p){ const a=(this._ls&&this._ls.get(ev))||[]; a.forEach(f=>f(p)); }

    step(input){
      if (this.win) return;
      if (this.jumpCD > 0) this.jumpCD--;
      if (input.jump) this.jumpBuffer = JUMP_BUFFER_FRAMES; else if (this.jumpBuffer > 0) this.jumpBuffer--;
      // Record history
      this.history.push({ x: this.player.x, y: this.player.y });
      if (this.history.length > HISTORY_FRAMES) this.history.shift();

      // Update door: open if player or any ghost on switch
      this.doorOpen = isOnSwitch(this.level, this.player) || this.ghosts.some(g => isOnSwitch(this.level, g));

      // Physics input
      const desired = (input.right?1:0) - (input.left?1:0);
      this.player.vx = desired * SPEED;
      const canCoyote = (this.player.onGround || this.framesSinceGrounded <= COYOTE_FRAMES);
      if (this.jumpBuffer > 0 && canCoyote && this.jumpCD <= 0) {
        this.player.vy = JUMP;
        this.player.onGround = false;
        this.framesSinceGrounded = COYOTE_FRAMES + 1;
        this.jumpCD = 24; // longer cooldown (~400ms at 60fps)
        this.jumpBuffer = 0;
      }
      this.player.vy = Math.min(MAX_FALL, this.player.vy + GRAV);
      // Move and collide
      this.player = moveAndCollide(this.level, this.player, this.doorOpen);
      // Update grounded frames for coyote/buffer
      if (this.player.onGround) this.framesSinceGrounded = 0; else this.framesSinceGrounded++;
      // If we just landed and have buffered jump, consume it now
      if (this.player.onGround && this.jumpBuffer > 0 && this.jumpCD <= 0) {
        this.player.vy = JUMP;
        this.player.onGround = false;
        this.framesSinceGrounded = COYOTE_FRAMES + 1;
        this.jumpCD = 24;
        this.jumpBuffer = 0;
      }

      // Update ghosts
      for (const g of this.ghosts) {
        if (!g.active) continue;
        if (g.i >= g.path.length-1) { g.active = false; continue; }
        g.i++;
        g.x = g.path[g.i].x;
        g.y = g.path[g.i].y;
      }

      // Win check
      if (isOnGoal(this.level, this.player)) {
        this.win = true;
        this.emit('win');
      }
      this.emit('update');
    }

    rewind(){
      if (this.history.length < 5) return; // nothing to rewind
      const n = Math.min(GHOST_SPAN, this.history.length-1);
      const path = this.history.slice(this.history.length - n).reverse();
      const ghost = { path, i: 0, x: path[0].x, y: path[0].y, active: true };
      this.ghosts.push(ghost);
      this.emit('ghosts', this.ghosts.length);
      this.emit('rewind');
      // Move player back to start of that path
      const rewindTo = this.history.length - n;
      const to = this.history[rewindTo];
      this.player.x = to.x; this.player.y = to.y;
      // Trim history to that point (branch new timeline)
      this.history = this.history.slice(0, rewindTo);
    }
  }

  function parseLevel(rows){
    const grid = rows.map(r=>r.split(""));
    let spawn=null;
    for(let y=0;y<grid.length;y++){
      for(let x=0;x<grid[y].length;x++){
        if(grid[y][x]==='P'){ spawn={x,y}; grid[y][x]='.'; }
      }
    }
    return { rows:grid.length, cols:grid[0].length, grid, spawn };
  }

  function solidAt(level, x, y, doorOpen){
    const gx = Math.floor(x / TILE);
    const gy = Math.floor(y / TILE);
    if (gy<0||gy>=level.rows||gx<0||gx>=level.cols) return true;
    const t = level.grid[gy][gx];
    if (t === '#') return true;
    if (t === 'D' && !doorOpen) return true;
    return false;
  }

  function moveAndCollide(level, b, doorOpen){
    // Horizontal
    let nx = b.x + b.vx;
    if (b.vx>0){
      if (solidAt(level, nx+6, b.y-6, doorOpen) || solidAt(level, nx+6, b.y-20, doorOpen)){
        nx = Math.floor((nx+6)/TILE)*TILE - 7; b.vx=0;
      }
    } else if (b.vx<0){
      if (solidAt(level, nx-6, b.y-6, doorOpen) || solidAt(level, nx-6, b.y-20, doorOpen)){
        nx = Math.floor((nx-6)/TILE+1)*TILE + 7; b.vx=0;
      }
    }
    b.x = nx;
    // Vertical
    let ny = b.y + b.vy;
    if (b.vy>0){ // falling
      if (solidAt(level, b.x-6, ny+1, doorOpen) || solidAt(level, b.x+6, ny+1, doorOpen)){
        ny = Math.floor((ny+1)/TILE)*TILE - 1; b.vy=0; b.onGround=true;
      }
    } else if (b.vy<0){ // rising
      if (solidAt(level, b.x-6, ny-21, doorOpen) || solidAt(level, b.x+6, ny-21, doorOpen)){
        ny = Math.floor((ny-21)/TILE+1)*TILE + 21; b.vy=0;
      }
    }
    if (b.vy !== 0) b.onGround=false;
    b.y = ny;
    return b;
  }

  function isOnSwitch(level, ent){
    const gx = Math.floor(ent.x / TILE), gy = Math.floor(ent.y / TILE);
    return level.grid[gy] && level.grid[gy][gx] === 'S';
  }
  function isOnGoal(level, ent){
    const gx = Math.floor(ent.x / TILE), gy = Math.floor(ent.y / TILE);
    return level.grid[gy] && level.grid[gy][gx] === 'G';
  }

  global.BackspaceGame = BackspaceGame;
  global.__BACKSPACE_CONST = { TILE, LEVELS_COUNT: LEVELS.length };
})(window);
