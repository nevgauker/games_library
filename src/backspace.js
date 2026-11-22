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
  const HALF_W = 6, BODY_H = 21; // player hitbox: x±6, y-21..y (y = feet)

  const LEVELS = global.BACKSPACE_LEVELS || [];

  class BackspaceGame {
    constructor(levelIndex = 0) {
      this.setLevel(levelIndex);
    }

    setLevel(index){
      this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
      this.def = LEVELS[this.levelIndex];
      this.level = parseLevel(this.def.map);
      this.width = this.level.cols * TILE;
      this.height = this.level.rows * TILE;
      this.reset();
    }

    reset(){
      const spawn = this.level.spawn || {x:2, y:2};
      this.player = { x: spawn.x*TILE+TILE/2, y: (spawn.y+1)*TILE-1, vx:0, vy:0, onGround:false };
      this.history = []; // {x,y}
      this.ghosts = []; // {path:[{x,y}], i, x, y, active}
      this.doorOpen = false;
      this.win = false;
      this.frame = 0;
      this.ghostsUsed = 0;
      this.jumpCD = 0; // frames until next allowed jump
      this.framesSinceGrounded = COYOTE_FRAMES + 1;
      this.jumpBuffer = 0;
      this.emit('ghosts', 0);
    }

    activeGhosts(){ return this.ghosts.filter(g => g.active).length; }

    on(ev, fn){ this._ls=this._ls||new Map(); const a=this._ls.get(ev)||[]; a.push(fn); this._ls.set(ev,a); return ()=>this.off(ev,fn);}
    off(ev,fn){ const a=(this._ls&&this._ls.get(ev))||[]; const i=a.indexOf(fn); if(i>=0)a.splice(i,1);}
    emit(ev,p){ const a=(this._ls&&this._ls.get(ev))||[]; a.forEach(f=>f(p)); }

    step(input){
      if (this.win) return;
      this.frame++;
      if (this.jumpCD > 0) this.jumpCD--;
      if (input.jump) this.jumpBuffer = JUMP_BUFFER_FRAMES; else if (this.jumpBuffer > 0) this.jumpBuffer--;
      // Record history
      this.history.push({ x: this.player.x, y: this.player.y });
      if (this.history.length > HISTORY_FRAMES) this.history.shift();

      // Update door: open if player or any ghost on switch
      const wasOpen = this.doorOpen;
      this.doorOpen = isOnSwitch(this.level, this.player) || this.ghosts.some(g => g.active && isOnSwitch(this.level, g));
      if (wasOpen !== this.doorOpen) this.emit(this.doorOpen ? 'door-open' : 'door-close');
      if (!this.doorOpen) pushOutOfDoors(this.level, this.player);

      // Physics input
      const desired = (input.right?1:0) - (input.left?1:0);
      this.player.vx = desired * SPEED;
      const canCoyote = (this.player.onGround || this.framesSinceGrounded <= COYOTE_FRAMES);
      if (this.jumpBuffer > 0 && canCoyote && this.jumpCD <= 0) this.doJump();
      this.player.vy = Math.min(MAX_FALL, this.player.vy + GRAV);
      // Move and collide
      this.player = moveAndCollide(this.level, this.player, this.doorOpen);
      // Update grounded frames for coyote/buffer
      if (this.player.onGround) this.framesSinceGrounded = 0; else this.framesSinceGrounded++;
      // If we just landed and have buffered jump, consume it now
      if (this.player.onGround && this.jumpBuffer > 0 && this.jumpCD <= 0) this.doJump();

      // Update ghosts
      let expired = false;
      for (const g of this.ghosts) {
        if (!g.active) continue;
        if (g.i >= g.path.length-1) { g.active = false; expired = true; continue; }
        g.i++;
        g.x = g.path[g.i].x;
        g.y = g.path[g.i].y;
      }
      if (expired) this.emit('ghosts', this.activeGhosts());

      // Win check
      if (isOnGoal(this.level, this.player)) {
        this.win = true;
        this.emit('win');
      }
      this.emit('update');
    }

    doJump(){
      this.player.vy = JUMP;
      this.player.onGround = false;
      this.framesSinceGrounded = COYOTE_FRAMES + 1;
      this.jumpCD = 24;
      this.jumpBuffer = 0;
    }

    rewind(){
      if (this.win || this.history.length < 5) return false; // nothing to rewind
      const n = Math.min(GHOST_SPAN, this.history.length-1);
      const path = this.history.slice(this.history.length - n).reverse();
      const ghost = { path, i: 0, x: path[0].x, y: path[0].y, active: true };
      this.ghosts.push(ghost);
      this.ghostsUsed++;
      // Move player back to start of that path, with no leftover momentum
      const rewindTo = this.history.length - n;
      const to = this.history[rewindTo];
      Object.assign(this.player, { x: to.x, y: to.y, vx: 0, vy: 0, onGround: false });
      this.jumpBuffer = 0; this.jumpCD = 0; this.framesSinceGrounded = COYOTE_FRAMES + 1;
      // Trim history to that point (branch new timeline)
      this.history = this.history.slice(0, rewindTo);
      this.emit('ghosts', this.activeGhosts());
      this.emit('rewind');
      return true;
    }

    // Compact state for solvers/tests (history excluded on purpose)
    snapshot(){
      return { p: { ...this.player }, g: this.ghosts.map(g => ({ ...g })), d: this.doorOpen,
        cd: this.jumpCD, f: this.framesSinceGrounded, b: this.jumpBuffer, fr: this.frame, w: this.win };
    }
    restore(s){
      this.player = { ...s.p }; this.ghosts = s.g.map(g => ({ ...g })); this.doorOpen = s.d;
      this.jumpCD = s.cd; this.framesSinceGrounded = s.f; this.jumpBuffer = s.b; this.frame = s.fr; this.win = s.w;
    }
    stateKey(){
      const p = this.player;
      return [Math.round(p.x*2), Math.round(p.y*2), Math.round(p.vy*10), p.onGround?1:0, this.jumpCD,
        Math.min(this.framesSinceGrounded, COYOTE_FRAMES+1), this.jumpBuffer, this.doorOpen?1:0].join();
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

  // A door that shuts on the player shoves them to whichever side their centre is on
  function pushOutOfDoors(level, b){
    const y0 = Math.floor((b.y-BODY_H)/TILE), y1 = Math.floor(b.y/TILE);
    const x0 = Math.floor((b.x-HALF_W)/TILE), x1 = Math.floor((b.x+HALF_W)/TILE);
    for (let gy=y0; gy<=y1; gy++) for (let gx=x0; gx<=x1; gx++) {
      if (!level.grid[gy] || level.grid[gy][gx] !== 'D') continue;
      const center = gx*TILE + TILE/2;
      b.x = b.x < center ? gx*TILE - HALF_W - 1 : (gx+1)*TILE + HALF_W + 1;
      b.vx = 0;
    }
  }

  function moveAndCollide(level, b, doorOpen){
    // Horizontal
    let nx = b.x + b.vx;
    if (b.vx>0){
      if (solidAt(level, nx+HALF_W, b.y-6, doorOpen) || solidAt(level, nx+HALF_W, b.y-20, doorOpen)){
        nx = Math.floor((nx+HALF_W)/TILE)*TILE - HALF_W - 1; b.vx=0;
      }
    } else if (b.vx<0){
      if (solidAt(level, nx-HALF_W, b.y-6, doorOpen) || solidAt(level, nx-HALF_W, b.y-20, doorOpen)){
        nx = Math.floor((nx-HALF_W)/TILE+1)*TILE + HALF_W + 1; b.vx=0;
      }
    }
    b.x = nx;
    // Vertical
    let ny = b.y + b.vy;
    if (b.vy>0){ // falling
      if (solidAt(level, b.x-HALF_W, ny+1, doorOpen) || solidAt(level, b.x+HALF_W, ny+1, doorOpen)){
        ny = Math.floor((ny+1)/TILE)*TILE - 1; b.vy=0; b.onGround=true;
      }
    } else if (b.vy<0){ // rising
      if (solidAt(level, b.x-HALF_W, ny-BODY_H, doorOpen) || solidAt(level, b.x+HALF_W, ny-BODY_H, doorOpen)){
        ny = Math.floor((ny-BODY_H)/TILE+1)*TILE + BODY_H; b.vy=0;
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
})(typeof window !== 'undefined' ? window : globalThis);
