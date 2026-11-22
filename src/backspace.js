// Backspace: one-screen puzzle platformer about rewinding time.
//
// The world runs on a timeline clock T. Every frame the player's state is
// recorded in history[T]. Rewinding by n frames sends the player (and the
// whole world) back to T-n and spawns an *echo* that replays exactly what the
// player did during those n frames. Older echoes are positioned by T too, so
// they rewind with the world and stay in sync: the level state is a pure
// function of T, the echoes and the player.
(function(global){
  const TILE = 24;
  const GRAV = 0.45;
  const MAX_FALL = 10;
  const SPEED = 1.3;
  const JUMP = -6.8;
  const COYOTE_FRAMES = 6;      // jump forgiveness after leaving ground
  const JUMP_BUFFER_FRAMES = 6; // jump queued before landing
  const HALF_W = 6, BODY_H = 21; // hitbox: x±6, y-21..y (y = feet)
  const MAX_REWIND = 300;       // 5 s of rewind per echo
  const MIN_REWIND = 20;        // shorter scrubs are cancelled
  const SCRUB_SPEED = 3;        // timeline frames per frame while holding rewind
  const MAX_TIMELINE = 60 * 60 * 15;

  const LEVELS = global.BACKSPACE_LEVELS || [];

  // Map legend -> roles. Plates (lowercase) power doors (uppercase) of the same channel.
  const PLATE = { S:'a', a:'a', b:'b', c:'c' };
  const DOOR  = { D:'a', A:'a', B:'b', C:'c' };
  const CHANNELS = ['a','b','c'];

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
      this.maxEchoes = this.def.echoes != null ? this.def.echoes : 3;
      this.reset();
    }

    reset(){
      const spawn = this.level.spawn || {x:2, y:2};
      this.player = { x: spawn.x*TILE+TILE/2, y: (spawn.y+1)*TILE-1, vx:0, vy:0, onGround:false, face:1 };
      this.T = 0;
      this.history = [recordOf(this.player)];
      this.echoes = [];       // {start, path:[{x,y,face,onGround}], id}
      this.nextEchoId = 1;
      this.power = { a:false, b:false, c:false };
      this.win = false;
      this.frame = 0;         // real frames played (for the timer)
      this.scrub = 0;         // >0 while holding rewind
      this.riding = null;     // echo id the player stands on
      this.framesSinceGrounded = COYOTE_FRAMES + 1;
      this.jumpBuffer = 0;
      this.jumpHeld = false;
      this.updatePower();
      this.emit('echoes', this.echoesLeft());
    }

    on(ev, fn){ this._ls=this._ls||new Map(); const a=this._ls.get(ev)||[]; a.push(fn); this._ls.set(ev,a); return ()=>this.off(ev,fn);}
    off(ev,fn){ const a=(this._ls&&this._ls.get(ev))||[]; const i=a.indexOf(fn); if(i>=0)a.splice(i,1);}
    emit(ev,p){ const a=(this._ls&&this._ls.get(ev))||[]; a.forEach(f=>f(p)); }

    echoesLeft(){ return this.maxEchoes - this.echoes.length; }
    get ghostsUsed(){ return this.echoes.length; }
    get scrubbing(){ return this.scrub > 0; }
    // Timeline frame being shown: during a scrub the world previews T - scrub
    get viewT(){ return this.T - this.scrub; }
    maxRewind(){ return Math.min(MAX_REWIND, this.T); }
    canRewind(){ return !this.win && this.echoesLeft() > 0 && this.T >= MIN_REWIND; }

    // Echo state at timeline frame t (null if not present then)
    echoAt(e, t){
      const k = t - e.start;
      return (k >= 0 && k < e.path.length) ? e.path[k] : null;
    }
    // Entities that exist at time t: echoes, plus the player at the present
    bodiesAt(t, includePlayer = true){
      const out = [];
      for (const e of this.echoes) { const s = this.echoAt(e, t); if (s) out.push(s); }
      if (includePlayer) out.push(t === this.T ? this.player : this.history[t]);
      return out;
    }
    powerAt(t){
      const p = { a:false, b:false, c:false };
      for (const b of this.bodiesAt(t)) {
        if (!b) continue;
        const ch = PLATE[tileAt(this.level, b.x, b.y)];
        if (ch) p[ch] = true;
      }
      return p;
    }
    updatePower(){
      const prev = this.power;
      this.power = this.powerAt(this.T);
      for (const ch of CHANNELS) if (prev[ch] !== this.power[ch]) this.emit(this.power[ch] ? 'door-open' : 'door-close', ch);
    }

    step(input){
      if (this.win) return;
      this.frame++;

      // --- Rewind scrubbing: world is frozen while the key is held ---
      if (input.rewind) {
        if (!this.scrubbing) {
          if (!this.canRewind()) { if (!this._denied) { this._denied = true; this.emit('rewind-denied', this.echoesLeft() <= 0 ? 'echoes' : 'time'); } return this.emit('update'); }
          this.emit('scrub-start');
        }
        this.scrub = Math.min(this.maxRewind(), this.scrub + SCRUB_SPEED);
        this.emit('update');
        return;
      }
      this._denied = false;
      if (this.scrubbing) {
        const n = this.scrub; this.scrub = 0;
        if (n >= MIN_REWIND) this.rewind(n); else this.emit('scrub-cancel');
        this.emit('update');
        return;
      }

      this.advance(input);
      this.emit('update');
    }

    // One frame of simulation
    advance(input){
      const p = this.player;
      const nextT = this.T + 1;
      if (nextT > MAX_TIMELINE) return;

      if (input.jump && !this.jumpHeld) this.jumpBuffer = JUMP_BUFFER_FRAMES;
      else if (this.jumpBuffer > 0) this.jumpBuffer--;
      this.jumpHeld = !!input.jump;

      // Doors respond to who stands on plates right now (echoes at their next frame)
      const prevPower = this.power;
      this.power = this.powerFor(nextT, p);
      for (const ch of CHANNELS) if (prevPower[ch] !== this.power[ch]) this.emit(this.power[ch] ? 'door-open' : 'door-close', ch);
      pushOutOfDoors(this.level, p, this.power);

      // Ride the echo we stand on
      if (this.riding != null) {
        const e = this.echoes.find(x => x.id === this.riding);
        const a = e && this.echoAt(e, this.T), b = e && this.echoAt(e, nextT);
        if (a && b) moveX(this.level, p, b.x - a.x, this.power);
      }

      // Horizontal input
      const desired = (input.right?1:0) - (input.left?1:0);
      p.vx = desired * SPEED;
      if (desired) p.face = desired;
      const canJump = p.onGround || this.framesSinceGrounded <= COYOTE_FRAMES;
      if (this.jumpBuffer > 0 && canJump) this.doJump();
      p.vy = Math.min(MAX_FALL, p.vy + GRAV);

      // Move + collide with tiles
      const prevFeet = p.y;
      moveX(this.level, p, p.vx, this.power);
      moveY(this.level, p, this.power);

      // Echo tops are one-way platforms
      this.riding = null;
      if (p.vy >= 0) {
        for (const e of this.echoes) {
          const now = this.echoAt(e, nextT), before = this.echoAt(e, this.T) || now;
          if (!now) continue;
          const top = now.y - BODY_H - 1, prevTop = before.y - BODY_H - 1;
          if (Math.abs(p.x - now.x) < HALF_W * 2 && prevFeet <= prevTop + 2 && p.y >= top - 0.01 && p.y <= top + 14) {
            p.y = top; p.vy = 0; p.onGround = true; this.riding = e.id;
          }
        }
      }

      if (p.onGround) this.framesSinceGrounded = 0; else this.framesSinceGrounded++;
      if (p.onGround && this.jumpBuffer > 0) this.doJump();

      this.T = nextT;
      this.history[this.T] = recordOf(p);
      this.history.length = this.T + 1;

      // Echoes that just finished
      for (const e of this.echoes) if (this.T - e.start === e.path.length) this.emit('echo-end', e.id);

      if (tileAt(this.level, p.x, p.y) === 'G') { this.win = true; this.emit('win'); }
    }

    powerFor(t, player){
      const p = { a:false, b:false, c:false };
      const bodies = this.bodiesAt(t, false); bodies.push(player);
      for (const b of bodies) { const ch = PLATE[tileAt(this.level, b.x, b.y)]; if (ch) p[ch] = true; }
      return p;
    }

    doJump(){
      this.player.vy = JUMP;
      this.player.onGround = false;
      this.framesSinceGrounded = COYOTE_FRAMES + 1;
      this.jumpBuffer = 0;
      this.riding = null;
      this.emit('jump');
    }

    // Send the world back n frames and leave an echo replaying them
    rewind(n){
      if (!this.canRewind()) return false;
      n = Math.max(MIN_REWIND, Math.min(n || MAX_REWIND, this.maxRewind()));
      const from = this.T - n;
      const path = this.history.slice(from, this.T + 1);
      const echo = { start: from, path, id: this.nextEchoId++ };
      this.echoes.push(echo);
      this.T = from;
      this.history.length = this.T + 1;
      const s = this.history[this.T];
      Object.assign(this.player, { x: s.x, y: s.y, vx: 0, vy: 0, onGround: s.onGround, face: s.face });
      this.jumpBuffer = 0; this.framesSinceGrounded = s.onGround ? 0 : COYOTE_FRAMES + 1;
      this.riding = null;
      this.updatePower();
      this.emit('echoes', this.echoesLeft());
      this.emit('rewind', echo);
      return true;
    }

    // Remove the most recent echo (stack order keeps the timeline consistent)
    undoEcho(){
      if (!this.echoes.length || this.win) return false;
      const e = this.echoes.pop();
      if (this.riding === e.id) this.riding = null;
      this.updatePower();
      this.emit('echoes', this.echoesLeft());
      this.emit('undo', e);
      return true;
    }

    // Compact state for solvers/tests. History is kept by reference; callers manage it.
    snapshot(){
      return { p: { ...this.player }, T: this.T, e: this.echoes.slice(), n: this.nextEchoId, pw: { ...this.power },
        f: this.framesSinceGrounded, b: this.jumpBuffer, jh: this.jumpHeld, r: this.riding, fr: this.frame, w: this.win };
    }
    restore(s){
      this.player = { ...s.p }; this.T = s.T; this.echoes = s.e.slice(); this.nextEchoId = s.n; this.power = { ...s.pw };
      this.framesSinceGrounded = s.f; this.jumpBuffer = s.b; this.jumpHeld = s.jh; this.riding = s.r; this.frame = s.fr; this.win = s.w;
      this.scrub = 0;
    }
    stateKey(){
      const p = this.player;
      return [Math.round(p.x*2), Math.round(p.y*2), Math.round(p.vy*10), p.onGround?1:0,
        Math.min(this.framesSinceGrounded, COYOTE_FRAMES+1), this.jumpBuffer, this.jumpHeld?1:0,
        this.power.a?1:0, this.power.b?1:0, this.power.c?1:0, this.riding||0].join();
    }
  }

  function recordOf(p){ return { x: p.x, y: p.y, face: p.face, onGround: p.onGround, vy: p.vy }; }

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

  function tileAt(level, x, y){
    const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
    return (level.grid[gy] && level.grid[gy][gx]) || '#';
  }

  function solidAt(level, x, y, power){
    const t = tileAt(level, x, y);
    if (t === '#') return true;
    const ch = DOOR[t];
    return !!ch && !power[ch];
  }

  // A door that shuts on the player shoves them to whichever side their centre is on
  function pushOutOfDoors(level, b, power){
    const y0 = Math.floor((b.y-BODY_H)/TILE), y1 = Math.floor(b.y/TILE);
    const x0 = Math.floor((b.x-HALF_W)/TILE), x1 = Math.floor((b.x+HALF_W)/TILE);
    for (let gy=y0; gy<=y1; gy++) for (let gx=x0; gx<=x1; gx++) {
      const ch = level.grid[gy] && DOOR[level.grid[gy][gx]];
      if (!ch || power[ch]) continue;
      const center = gx*TILE + TILE/2;
      b.x = b.x < center ? gx*TILE - HALF_W - 1 : (gx+1)*TILE + HALF_W + 1;
      b.vx = 0;
    }
  }

  function moveX(level, b, dx, power){
    if (!dx) return;
    let nx = b.x + dx;
    if (dx>0){
      if (solidAt(level, nx+HALF_W, b.y-6, power) || solidAt(level, nx+HALF_W, b.y-20, power)){
        nx = Math.floor((nx+HALF_W)/TILE)*TILE - HALF_W - 1; b.vx=0;
      }
    } else {
      if (solidAt(level, nx-HALF_W, b.y-6, power) || solidAt(level, nx-HALF_W, b.y-20, power)){
        nx = Math.floor((nx-HALF_W)/TILE+1)*TILE + HALF_W + 1; b.vx=0;
      }
    }
    b.x = nx;
  }

  function moveY(level, b, power){
    let ny = b.y + b.vy;
    b.onGround = false;
    if (b.vy>0){ // falling
      if (solidAt(level, b.x-HALF_W, ny+1, power) || solidAt(level, b.x+HALF_W, ny+1, power)){
        ny = Math.floor((ny+1)/TILE)*TILE - 1; b.vy=0; b.onGround=true;
      }
    } else if (b.vy<0){ // rising
      if (solidAt(level, b.x-HALF_W, ny-BODY_H, power) || solidAt(level, b.x+HALF_W, ny-BODY_H, power)){
        ny = Math.floor((ny-BODY_H)/TILE+1)*TILE + BODY_H; b.vy=0;
      }
    }
    b.y = ny;
  }

  global.BackspaceGame = BackspaceGame;
  global.__BACKSPACE_CONST = { TILE, LEVELS_COUNT: LEVELS.length, MAX_REWIND, MIN_REWIND, HALF_W, BODY_H, PLATE, DOOR };
})(typeof window !== 'undefined' ? window : globalThis);
