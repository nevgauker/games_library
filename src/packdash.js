// Pack & Dash! engine: grab your desk items, dodge small talk, reach the elevator.
// Pure simulation (no DOM). The UI drives it with step(1/60) and input(dir).
(function(global){
  const TILE = 16;
  const BASE_SPEED = 80;        // px/s
  const BOSS_TALK = 3.0;        // s the boss keeps you chatting
  const BOSS_SLOW = 0.4;        // speed multiplier while chatting
  const BOSS_COOLDOWN = 2.0;    // s after a chat before the boss can grab you again
  const COWORKER_TTL = 3.5;     // s a coworker hangs around
  const COWORKER_REACH = 22;    // px between centres that opens the greeting prompt

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function rectsOverlap(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }
  function centre(r){ return { x: r.x + r.w/2, y: r.y + r.h/2 }; }

  // Small seeded PRNG so runs (and the level checker) are reproducible.
  function mulberry32(seed){
    let a = seed >>> 0;
    return function(){
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Emitter{
    constructor(){ this.m = new Map(); }
    on(e,f){ if (!this.m.has(e)) this.m.set(e, []); this.m.get(e).push(f); }
    emit(e,v){ const a = this.m.get(e) || []; for (const f of a) f(v); }
  }

  // Parse an ASCII level into grid + entities. Throws on malformed maps.
  function parseLevel(def){
    const rows = def.map.length, cols = def.map[0].length;
    const grid = [];
    let spawn = null, bossStart = null;
    const elev = [], items = [];
    for (let y = 0; y < rows; y++){
      const line = def.map[y];
      if (line.length !== cols) throw new Error(`row ${y} has ${line.length} cols, expected ${cols}`);
      const row = [];
      for (let x = 0; x < cols; x++){
        const ch = line[x];
        row.push(ch === '#');
        if (ch === 'P') spawn = { gx:x, gy:y };
        else if (ch === 'b') bossStart = { gx:x, gy:y };
        else if (ch === 'E') elev.push({ gx:x, gy:y });
        else if (ch >= '1' && ch <= '9') items.push({ gx:x, gy:y, idx: ch.charCodeAt(0) - 49 });
        else if (ch !== '#' && ch !== '.') throw new Error(`unknown tile '${ch}' at ${x},${y}`);
      }
      grid.push(row);
    }
    if (!spawn) throw new Error('no player spawn (P)');
    if (!bossStart) throw new Error('no boss start (b)');
    if (elev.length !== 4) throw new Error(`elevator must be a 2x2 block, found ${elev.length} tiles`);
    const ex = Math.min(...elev.map(e => e.gx)), ey = Math.min(...elev.map(e => e.gy));
    for (const e of elev) if (e.gx > ex+1 || e.gy > ey+1) throw new Error('elevator tiles are not a 2x2 block');
    if (!items.length) throw new Error('no items');
    items.sort((a,b) => a.idx - b.idx);
    for (let i = 1; i < items.length; i++) if (items[i].idx === items[i-1].idx) throw new Error(`item ${items[i].idx+1} placed twice`);
    // Merge horizontal wall runs into rects for collision.
    const walls = [];
    for (let y = 0; y < rows; y++){
      let x = 0;
      while (x < cols){
        if (!grid[y][x]){ x++; continue; }
        const x0 = x; while (x < cols && grid[y][x]) x++;
        walls.push({ x:x0*TILE, y:y*TILE, w:(x-x0)*TILE, h:TILE });
      }
    }
    return { rows, cols, grid, walls, spawn, bossStart, elevator:{ gx:ex, gy:ey }, items };
  }

  class PackDashGame extends Emitter{
    constructor(levelIndex = 0, opts = {}){
      super();
      this.levels = opts.levels || global.PACKDASH_LEVELS;
      this.itemDefs = opts.items || global.PACKDASH_ITEMS;
      this.seed = opts.seed;
      this.levelIndex = levelIndex;
      this.restart();
    }

    restart(){
      const def = this.levels[this.levelIndex];
      const L = parseLevel(def);
      this.def = def;
      this.rng = mulberry32(this.seed != null ? this.seed : (Math.random() * 2**32));
      this.cols = L.cols; this.rows = L.rows; this.tile = TILE;
      this.width = L.cols * TILE; this.height = L.rows * TILE;
      this.grid = L.grid; this.walls = L.walls;
      this.state = 'playing';
      this.time = 0;
      this.timeLeft = def.time;
      this.score = 0;
      this.dir = null;
      this.effects = [];        // { kind, mul, t } - speed multiplier is their product
      this.player = { x: L.spawn.gx*TILE+2, y: L.spawn.gy*TILE+2, w: TILE-4, h: TILE-4, vx:0, vy:0 };
      this.elevator = { x: L.elevator.gx*TILE, y: L.elevator.gy*TILE, w: 2*TILE, h: 2*TILE };
      this.items = L.items.map(it => ({ gx: it.gx, gy: it.gy, picked:false, data: this.itemDefs[it.idx] }));
      if (this.items.some(it => !it.data)) throw new Error('map references an item that is not in PACKDASH_ITEMS');
      this.itemsLeft = this.items.length;
      const bc = def.boss || {};
      this.boss = { x: L.bossStart.gx*TILE+1, y: L.bossStart.gy*TILE+1, w: TILE-2, h: TILE-2,
                    dir: 1, speed: bc.speed ?? 40, range: (bc.range ?? 6) * TILE, talk: 0, cooldown: 0 };
      this.coworker = null;
      this.coworkerTimer = 2.5 + this.rng() * 3;
      this.emit('time', Math.ceil(this.timeLeft));
      this.emit('score', this.score);
      this.emit('items', this.itemsLeft);
      this.emit('status', 'Pack fast, smile often!');
    }

    input(dir){ this.dir = dir || null; }

    get speedMul(){ let m = 1; for (const e of this.effects) m *= e.mul; return m; }

    // Replaces any running effect of the same kind (no stacking, no leftovers).
    addEffect(kind, mul, t){
      this.effects = this.effects.filter(e => e.kind !== kind);
      this.effects.push({ kind, mul, t });
    }

    isWall(gx, gy){ return gy < 0 || gy >= this.rows || gx < 0 || gx >= this.cols || this.grid[gy][gx]; }

    step(dt){
      if (this.state !== 'playing') return;
      this.time += dt;
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.emit('time', Math.ceil(this.timeLeft));

      for (const e of this.effects) e.t -= dt;
      this.effects = this.effects.filter(e => e.t > 0);

      this.stepBoss(dt);
      this.stepCoworker(dt);
      this.stepPlayer(dt);
      this.pickItems();

      if (this.itemsLeft === 0 && rectsOverlap(this.player, this.elevator)){
        this.state = 'won';
        this.emit('win', { score: this.score, timeLeft: this.timeLeft });
        return;
      }
      if (this.timeLeft <= 0){
        this.state = 'lost';
        this.emit('lose', { score: this.score, itemsLeft: this.itemsLeft });
      }
    }

    stepBoss(dt){
      const b = this.boss;
      if (b.talk > 0){
        // He stands still while he talks at you.
        b.talk -= dt;
        if (b.talk <= 0){ b.cooldown = BOSS_COOLDOWN; this.emit('status', 'You escape the chat.'); }
        return;
      }
      if (b.cooldown > 0) b.cooldown -= dt;
      const oldx = b.x;
      b.x += b.dir * b.speed * dt;
      if (this.collidesAny(b)) { b.x = oldx; b.dir *= -1; }
      if (b.cooldown <= 0 && this.hasLOS(b, this.player, b.range)){
        b.talk = BOSS_TALK;
        this.addEffect('boss', BOSS_SLOW, BOSS_TALK);
        this.emit('status', 'Boss: “Quick congrats + tiny chat?” (So tiny.)');
        this.emit('bossTalk');
      }
    }

    stepCoworker(dt){
      const c = this.coworker;
      if (c){
        c.ttl -= dt;
        if (c.ttl <= 0){ this.dismissCoworker(); return; }
        const pc = centre(this.player), cc = centre(c);
        const near = Math.hypot(pc.x - cc.x, pc.y - cc.y) <= COWORKER_REACH;
        if (near !== c.near){ c.near = near; this.emit(near ? 'coworkerNear' : 'coworkerFar'); }
        return;
      }
      this.coworkerTimer -= dt;
      if (this.coworkerTimer > 0) return;
      this.coworkerTimer = 6 + this.rng() * 6;
      const spot = this.pickCoworkerSpot();
      if (!spot) return;
      this.coworker = { x: spot.gx*TILE+2, y: spot.gy*TILE+2, w: TILE-4, h: TILE-4, ttl: COWORKER_TTL, near:false };
      this.emit('coworker', { x: this.coworker.x, y: this.coworker.y });
    }

    // A floor tile 2-4 tiles from the player, clear of the boss, items and elevator.
    pickCoworkerSpot(){
      const pgx = Math.floor(centre(this.player).x / TILE), pgy = Math.floor(centre(this.player).y / TILE);
      const bgx = Math.floor(centre(this.boss).x / TILE), bgy = Math.floor(centre(this.boss).y / TILE);
      const egx = this.elevator.x / TILE, egy = this.elevator.y / TILE;
      const spots = [];
      for (let gy = pgy - 4; gy <= pgy + 4; gy++) for (let gx = pgx - 4; gx <= pgx + 4; gx++){
        const d = Math.abs(gx - pgx) + Math.abs(gy - pgy);
        if (d < 2 || d > 4 || this.isWall(gx, gy)) continue;
        if (Math.abs(gx - bgx) + Math.abs(gy - bgy) < 2) continue;
        if (gx >= egx && gx <= egx + 1 && gy >= egy && gy <= egy + 1) continue;
        if (this.items.some(it => !it.picked && it.gx === gx && it.gy === gy)) continue;
        spots.push({ gx, gy });
      }
      return spots.length ? spots[Math.floor(this.rng() * spots.length)] : null;
    }

    dismissCoworker(){
      this.coworker = null;
      this.emit('coworkerGone');
    }

    stepPlayer(dt){
      const p = this.player, s = BASE_SPEED * this.speedMul, d = this.dir;
      p.vx = d === 'left' ? -s : d === 'right' ? s : 0;
      p.vy = d === 'up' ? -s : d === 'down' ? s : 0;
      const ox = p.x, oy = p.y;
      p.x = clamp(p.x + p.vx*dt, 0, this.width - p.w);
      if (this.collidesAny(p)) p.x = ox;
      p.y = clamp(p.y + p.vy*dt, 0, this.height - p.h);
      if (this.collidesAny(p)) p.y = oy;
    }

    pickItems(){
      const p = this.player;
      for (const it of this.items){
        if (it.picked) continue;
        const r = { x: it.gx*TILE+3, y: it.gy*TILE+3, w: TILE-6, h: TILE-6 };
        if (!rectsOverlap(p, r)) continue;
        it.picked = true;
        this.itemsLeft -= 1;
        this.score += 10;
        this.emit('score', this.score);
        this.emit('items', this.itemsLeft);
        this.emit('memory', it.data.memory);
        if (this.itemsLeft === 0) this.emit('status', 'Box packed! Elevator’s open.');
      }
    }

    collidesAny(r){ for (const w of this.walls) if (rectsOverlap(r, w)) return true; return false; }

    // Boss sees along his row/column (centres within half a tile), up to maxDist px,
    // as long as no wall tile sits between you.
    hasLOS(boss, player, maxDist){
      const bc = centre(boss), pc = centre(player);
      const dx = Math.abs(bc.x - pc.x), dy = Math.abs(bc.y - pc.y);
      const sameRow = dy < TILE/2, sameCol = dx < TILE/2;
      if (!sameRow && !sameCol) return false;
      if ((sameRow ? dx : dy) > maxDist) return false;
      const bgx = Math.floor(bc.x / TILE), bgy = Math.floor(bc.y / TILE);
      const pgx = Math.floor(pc.x / TILE), pgy = Math.floor(pc.y / TILE);
      if (sameRow){
        for (let x = Math.min(bgx, pgx) + 1; x < Math.max(bgx, pgx); x++) if (this.isWall(x, bgy)) return false;
      } else {
        for (let y = Math.min(bgy, pgy) + 1; y < Math.max(bgy, pgy); y++) if (this.isWall(bgx, y)) return false;
      }
      return true;
    }

    // Coworker greeting; only valid while you're standing next to them.
    choose(action){
      const c = this.coworker;
      if (!c || !c.near || this.state !== 'playing') return false;
      if (action === 'wave'){
        this.score += 5; this.addEffect('mood', 1.2, 2.0);
        this.emit('status', 'You wave like a pro. Zoom zoom!');
      } else if (action === 'hug'){
        this.score += 10; this.addEffect('mood', 0.7, 1.0);
        this.emit('status', 'Wholesome hug achieved. Heart full, feet slower.');
      } else if (action === 'ignore'){
        this.score = Math.max(0, this.score - 2);
        this.emit('status', 'You deploy the stealth nod. Smooth.');
      } else return false;
      this.emit('score', this.score);
      this.dismissCoworker();
      return true;
    }
  }

  global.PackDashGame = PackDashGame;
  global.__PACKDASH_CONST = { TILE, BASE_SPEED, parseLevel };
})(window);
