// Backspace: one-screen puzzle platformer about rewinding time.
//
// The world runs on a timeline clock T. Every frame the player's state is
// recorded in history[T]. Rewinding by n frames sends the player (and the
// whole world) back to T-n and spawns an *echo* that replays exactly what the
// player did during those n frames. Older echoes are positioned by T too, so
// they rewind with the world and stay in sync: the level state is a function
// of T, the echoes and the player.
//
// Map legend
//   #  wall              .  empty            P  spawn          G  goal
//   a b c  hold plates (S = a)               A B C  doors (D = A), open while
//   1 2 3  timed plates for channel a/b/c:          their channel is powered
//          the channel stays powered 3 s after the last press
//   -  one-way platform (stand on it, jump up through it)
//   ^  spikes: touching them snaps time back 1 s (no echo is made)
//   >  <  laser emitters firing right/left. Always on, or only while the
//          channel named by the level's `lasers` field is powered. Beams stop
//          at walls, closed doors and bodies - an echo makes a perfect shield.
(function(global){
  const TILE = 24;
  const GRAV = 0.45;
  const MAX_FALL = 9;
  const SPEED = 2.1;            // max run speed (px/frame)
  const ACCEL = 0.35, AIR_ACCEL = 0.22;
  const FRICTION = 0.4, AIR_DRAG = 0.08;
  const JUMP = -7.2;            // ~2.4 tiles at full height (3+ standing on an echo)
  const JUMP_CUT = 0.45;        // releasing jump early keeps this much upward speed
  const COYOTE_FRAMES = 6;      // jump forgiveness after leaving ground
  const JUMP_BUFFER_FRAMES = 6; // jump queued before landing
  const HALF_W = 6, BODY_H = 21; // hitbox: x±6, y-21..y (y = feet)
  const MAX_REWIND = 300;       // 5 s of rewind per echo
  const MIN_REWIND = 20;        // shorter scrubs are cancelled
  const SCRUB_SPEED = 3;        // timeline frames per frame while holding rewind
  const TIMER_FRAMES = 180;     // timed plates linger 3 s
  const DEATH_REWIND = 60;      // hazards snap time back 1 s
  const MAX_TIMELINE = 60 * 60 * 15;

  const LEVELS = global.BACKSPACE_LEVELS || [];

  const PLATE = { S:'a', a:'a', b:'b', c:'c', 1:'a', 2:'b', 3:'c' };
  const TIMED = { 1:true, 2:true, 3:true };
  const DOOR  = { D:'a', A:'a', B:'b', C:'c' };
  const LASER = { '>': 1, '<': -1 };
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
      this.lastPress = { a:-1e9, b:-1e9, c:-1e9 }; // timeline frame of last timed-plate press
      this.win = false;
      this.dead = false;      // true for the frame a hazard snapped time back
      this.deaths = 0;
      this.frame = 0;         // real frames played (for the timer)
      this.scrub = 0;         // >0 while holding rewind
      this.riding = null;     // echo id the player stands on
      this.framesSinceGrounded = COYOTE_FRAMES + 1;
      this.jumpBuffer = 0;
      this.jumpHeld = false;
      this.jumpRising = false;
      this.recomputeTimers();
      this.power = this.powerFor(this.T, this.player);
      this.emit('echoes', this.echoesLeft());
    }

    on(ev, fn){ this._ls=this._ls||new Map(); const a=this._ls.get(ev)||[]; a.push(fn); this._ls.set(ev,a); return ()=>this.off(ev,fn);}
    off(ev,fn){ const a=(this._ls&&this._ls.get(ev))||[]; const i=a.indexOf(fn); if(i>=0)a.splice(i,1);}
    emit(ev,p){ if (!this._ls) return; const a=this._ls.get(ev); if (a) a.forEach(f=>f(p)); }

    echoesLeft(){ return this.maxEchoes - this.echoes.length; }
    get ghostsUsed(){ return this.echoes.length; }
    get scrubbing(){ return this.scrub > 0; }
    // Timeline frame being shown: during a scrub the world previews T - scrub
    get viewT(){ return this.T - this.scrub; }
    maxRewind(){ return Math.min(MAX_REWIND, this.T); }
    canRewind(){ return !this.win && this.echoesLeft() > 0 && this.T >= MIN_REWIND; }
    timerFrames(){ return TIMER_FRAMES; }

    // Echo state at timeline frame t (null if not present then)
    echoAt(e, t){
      const k = t - e.start;
      return (k >= 0 && k < e.path.length) ? e.path[k] : null;
    }
    // Bodies that exist at time t: echoes, plus the player (live at the present, recorded in the past)
    bodiesAt(t, includePlayer = true){
      const out = [];
      for (const e of this.echoes) { const s = this.echoAt(e, t); if (s) out.push(s); }
      if (includePlayer) { const p = t === this.T ? this.player : this.history[t]; if (p) out.push(p); }
      return out;
    }
    activeEchoes(t = this.T){ let n = 0; for (const e of this.echoes) if (this.echoAt(e, t)) n++; return n; }

    // Timed plates: when was each channel last pressed, looking back from T?
    recomputeTimers(){
      this.lastPress = { a:-1e9, b:-1e9, c:-1e9 };
      for (let t = Math.max(0, this.T - TIMER_FRAMES); t <= this.T; t++) {
        for (const b of this.bodiesAt(t)) {
          const c = tileAt(this.level, b.x, b.y);
          if (TIMED[c]) this.lastPress[PLATE[c]] = t;
        }
      }
    }
    // Power at an arbitrary timeline frame (used to preview the past while scrubbing)
    powerAt(t){
      const p = { a:false, b:false, c:false };
      for (let u = Math.max(0, t - TIMER_FRAMES); u <= t; u++) {
        for (const b of this.bodiesAt(u)) {
          const c = tileAt(this.level, b.x, b.y);
          if (PLATE[c] && (u === t || TIMED[c])) p[PLATE[c]] = true;
        }
      }
      return p;
    }
    // Power for the frame being simulated; updates timed-plate memory
    powerFor(t, player){
      const p = { a:false, b:false, c:false };
      const bodies = this.bodiesAt(t, false); bodies.push(player);
      for (const b of bodies) {
        const c = tileAt(this.level, b.x, b.y), ch = PLATE[c];
        if (!ch) continue;
        p[ch] = true;
        if (TIMED[c]) this.lastPress[ch] = t;
      }
      for (const ch of CHANNELS) if (t - this.lastPress[ch] <= TIMER_FRAMES) p[ch] = true;
      return p;
    }
    setPower(next){
      const prev = this.power;
      this.power = next;
      for (const ch of CHANNELS) if (prev[ch] !== next[ch]) this.emit(next[ch] ? 'door-open' : 'door-close', ch);
    }
    // Remaining linger time per channel, for HUD/rendering (0..1)
    timerLeft(ch, t = this.T){
      const left = TIMER_FRAMES - (t - this.lastPress[ch]);
      return left > 0 ? left / TIMER_FRAMES : 0;
    }

    lasersOn(power){
      const ch = this.def.lasers;
      return !ch || !!power[ch];
    }
    // Laser beams at time t: [{x0, x1, y, dir, hit}] where hit is the body that stopped it
    beamsAt(t, power, player){
      const out = [];
      if (!this.level.lasers.length || !this.lasersOn(power)) return out;
      const bodies = this.bodiesAt(t, false);
      if (player) bodies.push(player);
      for (const L of this.level.lasers) {
        const y = L.y * TILE + TILE / 2;
        let x0 = L.dir > 0 ? (L.x + 1) * TILE : L.x * TILE;
        // walk tiles until something solid
        let gx = L.x + L.dir, x1 = x0;
        while (gx >= 0 && gx < this.level.cols && !solidTile(this.level.grid[L.y][gx], power)) gx += L.dir;
        x1 = L.dir > 0 ? gx * TILE : (gx + 1) * TILE;
        let hit = null, best = Infinity;
        for (const b of bodies) {
          if (y < b.y - BODY_H || y > b.y) continue;
          const edge = L.dir > 0 ? b.x - HALF_W : b.x + HALF_W;
          const d = (edge - x0) * L.dir;
          if (d >= -HALF_W * 2 && d < (x1 - x0) * L.dir && d < best) { best = d; hit = b; }
        }
        if (hit) x1 = L.dir > 0 ? hit.x - HALF_W : hit.x + HALF_W;
        out.push({ x0, x1, y, dir: L.dir, hit });
      }
      return out;
    }

    step(input){
      if (this.win) return;
      this.frame++;

      // --- Rewind scrubbing: world is frozen while the key is held ---
      if (input.rewind) {
        if (!this.scrubbing) {
          if (!this.canRewind()) { if (!this._denied) { this._denied = true; this.emit('rewind-denied', this.echoesLeft() <= 0 ? 'echoes' : 'time'); } return; }
          this.emit('scrub-start');
        }
        this.scrub = Math.min(this.maxRewind(), this.scrub + SCRUB_SPEED);
        return;
      }
      this._denied = false;
      if (this.scrubbing) {
        const n = this.scrub; this.scrub = 0;
        if (n >= MIN_REWIND) this.rewind(n); else this.emit('scrub-cancel');
        return;
      }

      this.advance(input);
    }

    // One frame of simulation
    advance(input){
      const p = this.player;
      const nextT = this.T + 1;
      if (nextT > MAX_TIMELINE) return;
      this.dead = false;

      if (input.jump && !this.jumpHeld) this.jumpBuffer = JUMP_BUFFER_FRAMES;
      else if (this.jumpBuffer > 0) this.jumpBuffer--;
      this.jumpHeld = !!input.jump;

      // Doors respond to who stands on plates right now (echoes at their next frame)
      this.setPower(this.powerFor(nextT, p));
      pushOutOfDoors(this.level, p, this.power);

      // Ride the echo we stand on
      if (this.riding != null) {
        const e = this.echoes.find(x => x.id === this.riding);
        const a = e && this.echoAt(e, this.T), b = e && this.echoAt(e, nextT);
        if (a && b) moveX(this.level, p, b.x - a.x, this.power);
      }

      // Horizontal input with acceleration / friction
      const desired = (input.right?1:0) - (input.left?1:0);
      const grounded = p.onGround;
      if (desired) {
        p.face = desired;
        const a = grounded ? ACCEL : AIR_ACCEL;
        const boost = Math.sign(p.vx) !== desired && p.vx !== 0 ? 2 : 1; // snappy turnarounds
        p.vx = clamp(p.vx + desired * a * boost, -SPEED, SPEED);
      } else {
        const f = grounded ? FRICTION : AIR_DRAG;
        p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
      }
      const canJump = p.onGround || this.framesSinceGrounded <= COYOTE_FRAMES;
      if (this.jumpBuffer > 0 && canJump) this.doJump();
      // Variable jump height: let go early for a short hop
      if (!input.jump && p.vy < -2 && this.jumpRising) { p.vy *= JUMP_CUT; this.jumpRising = false; }
      if (p.vy >= 0) this.jumpRising = false;
      p.vy = Math.min(MAX_FALL, p.vy + GRAV);

      // Move + collide with tiles
      const prevFeet = p.y, wasGround = grounded, fallSpeed = p.vy;
      moveX(this.level, p, p.vx, this.power);
      moveY(this.level, p, this.power);

      // Echo heads are one-way platforms
      this.riding = null;
      if (p.vy >= 0) {
        for (const e of this.echoes) {
          const now = this.echoAt(e, nextT);
          if (!now) continue;
          const before = this.echoAt(e, this.T) || now;
          const top = now.y - BODY_H - 1, prevTop = before.y - BODY_H - 1;
          if (Math.abs(p.x - now.x) < HALF_W * 2 && prevFeet <= prevTop + 2 && p.y >= top - 0.01 && p.y <= top + 14) {
            p.y = top; p.vy = 0; p.onGround = true; this.riding = e.id;
          }
        }
      }

      if (p.onGround && !wasGround && this.framesSinceGrounded > 2) this.emit('land', fallSpeed);
      if (p.onGround) this.framesSinceGrounded = 0; else this.framesSinceGrounded++;
      if (p.onGround && this.jumpBuffer > 0) this.doJump();

      this.T = nextT;
      this.history[this.T] = recordOf(p);
      this.history.length = this.T + 1;

      // Hazards
      if (touchesSpikes(this.level, p)) return this.die('spikes');
      if (this.level.lasers.length) {
        for (const b of this.beamsAt(this.T, this.power, p)) if (b.hit === p) return this.die('laser');
      }

      for (const e of this.echoes) if (this.T - e.start === e.path.length) this.emit('echo-end', e.id);

      if (tileAt(this.level, p.x, p.y) === 'G' || tileAt(this.level, p.x, p.y - BODY_H/2) === 'G') { this.win = true; this.emit('win'); }
    }

    // Hazards snap time back a second; no echo is created
    die(cause){
      const at = { x: this.player.x, y: this.player.y };
      this.deaths++;
      this.T = Math.max(0, this.T - DEATH_REWIND);
      this.history.length = this.T + 1;
      if (this.history[this.T]) this.restoreFromHistory(); // solvers run without history and discard dead states
      this.dead = true;
      this.emit('death', { cause, at });
    }

    restoreFromHistory(){
      const s = this.history[this.T];
      Object.assign(this.player, { x: s.x, y: s.y, vx: 0, vy: 0, onGround: s.onGround, face: s.face });
      this.jumpBuffer = 0; this.jumpRising = false; this.framesSinceGrounded = s.onGround ? 0 : COYOTE_FRAMES + 1;
      this.riding = null;
      this.recomputeTimers();
      this.setPower(this.powerFor(this.T, this.player));
    }

    doJump(){
      this.player.vy = JUMP;
      this.player.onGround = false;
      this.framesSinceGrounded = COYOTE_FRAMES + 1;
      this.jumpBuffer = 0;
      this.jumpRising = true;
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
      this.restoreFromHistory();
      this.emit('echoes', this.echoesLeft());
      this.emit('rewind', echo);
      return true;
    }

    // Remove the most recent echo (stack order keeps the timeline consistent)
    undoEcho(){
      if (!this.echoes.length || this.win || this.scrubbing) return false;
      const e = this.echoes.pop();
      if (this.riding === e.id) this.riding = null;
      this.recomputeTimers();
      this.setPower(this.powerFor(this.T, this.player));
      this.emit('echoes', this.echoesLeft());
      this.emit('undo', e);
      return true;
    }

    // Compact state for solvers/tests. History is kept by reference; callers manage it.
    snapshot(){
      return { p: { ...this.player }, T: this.T, e: this.echoes.slice(), n: this.nextEchoId, pw: { ...this.power }, lp: { ...this.lastPress },
        f: this.framesSinceGrounded, b: this.jumpBuffer, jh: this.jumpHeld, jr: this.jumpRising, r: this.riding, fr: this.frame, w: this.win, d: this.deaths };
    }
    restore(s){
      this.player = { ...s.p }; this.T = s.T; this.echoes = s.e.slice(); this.nextEchoId = s.n; this.power = { ...s.pw }; this.lastPress = { ...s.lp };
      this.framesSinceGrounded = s.f; this.jumpBuffer = s.b; this.jumpHeld = s.jh; this.jumpRising = s.jr; this.riding = s.r; this.frame = s.fr; this.win = s.w; this.deaths = s.d;
      this.scrub = 0; this.dead = false;
    }
    // Timed plates as coarse buckets (for solvers' state keys)
    timerKey(){
      let k = '';
      for (const ch of CHANNELS) { const left = TIMER_FRAMES - (this.T - this.lastPress[ch]); k += left > 0 ? Math.ceil(left / 8) : 0; k += ','; }
      return k;
    }
  }

  function recordOf(p){ return { x: p.x, y: p.y, face: p.face, onGround: p.onGround, vx: p.vx, vy: p.vy }; }
  function clamp(v, a, b){ return v < a ? a : v > b ? b : v; }

  function parseLevel(rows){
    const grid = rows.map(r=>r.split(""));
    let spawn = null;
    const lasers = [];
    for(let y=0;y<grid.length;y++){
      for(let x=0;x<grid[y].length;x++){
        const c = grid[y][x];
        if (c === 'P') { spawn={x,y}; grid[y][x]='.'; }
        if (LASER[c]) lasers.push({ x, y, dir: LASER[c] });
      }
    }
    return { rows:grid.length, cols:grid[0].length, grid, spawn, lasers };
  }

  function tileAt(level, x, y){
    const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
    return (level.grid[gy] && level.grid[gy][gx]) || '#';
  }

  function solidTile(t, power){
    if (t === '#' || LASER[t]) return true;
    const ch = DOOR[t];
    return !!ch && !power[ch];
  }
  function solidAt(level, x, y, power){ return solidTile(tileAt(level, x, y), power); }

  function touchesSpikes(level, b){
    // spikes occupy the lower half of their tile
    for (const x of [b.x - HALF_W + 1, b.x + HALF_W - 1]) {
      for (const y of [b.y, b.y - 8]) {
        if (tileAt(level, x, y) === '^' && (y % TILE) >= TILE / 2 - 2) return true;
      }
    }
    return false;
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
      const landsOn = x => {
        if (solidAt(level, x, ny+1, power)) return true;
        // one-way platforms: solid only when we were above their top edge
        const gy = Math.floor((ny+1)/TILE);
        return tileAt(level, x, ny+1) === '-' && b.y <= gy*TILE - 1;
      };
      if (landsOn(b.x-HALF_W) || landsOn(b.x+HALF_W)){
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
  global.__BACKSPACE_CONST = { TILE, LEVELS_COUNT: LEVELS.length, MAX_REWIND, MIN_REWIND, TIMER_FRAMES, HALF_W, BODY_H, PLATE, DOOR, TIMED, LASER };
})(typeof window !== 'undefined' ? window : globalThis);
