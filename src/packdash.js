// Pack & Dash! engine: grab your desk items, dodge small talk, reach the elevator.
// Pure simulation (no DOM). The UI drives it with step(1/60), input(dir) and excuse().
//
// Rules
//  - Stand on an item for PACK_TIME to pack it. Each item adds weight; weight slows you.
//  - Bosses patrol fixed routes with a vision cone. Seen for SPOT_TIME (or bumped into)
//    and you're stuck in a chat; mash excuse() to cut it short.
//  - Coworkers patrol too. Bump into one and you have CHOICE_TIME to excuse yourself,
//    otherwise you chat for COWORKER_CHAT seconds and earn a heart. (The excuse itself
//    costs a NOD_TIME nod.) Coworkers who see you in their row/column hurry over.
//  - All items packed + reach the elevator = win. Stars come from time vs. par.
//  - Wet floor (w): step on it and you slide until something stops you.
//  - Printers (p): jam on a timer; a jammed printer blocks its tile.
//  - Cake (K): optional. Stand on it for CAKE_TIME: +PTS_CAKE, but +1 weight.
//  - Elevator schedule (level.elevator): the doors only open part of each cycle.
(function(global){
  const TILE = 16;
  const BASE_SPEED = 80;         // px/s with an empty box
  const WEIGHT_SLOW = 0.035;     // speed lost per weight unit
  const MIN_WEIGHT_MUL = 0.6;
  const PACK_TIME = 0.45;        // s standing on an item to pack it
  const SPOT_TIME = 0.3;         // s in a boss's cone before he starts talking
  const BOSS_CHAT = 3.0;         // s a boss chat lasts if you never excuse yourself
  const EXCUSE_CUT = 0.12;       // s each excuse press removes from a boss chat
  const BOSS_COOLDOWN = 3.0;     // s a boss ignores you after a chat
  const CHOICE_TIME = 1.0;       // s to excuse yourself from a coworker
  const COWORKER_CHAT = 2.0;     // s of small talk if you don't
  const COWORKER_COOLDOWN = 6.0; // s before the same coworker engages again
  const NOD_TIME = 0.4;          // s the awkward 'excuse me' nod holds you
  const SEEK_RANGE = 4;          // tiles: coworkers notice you along their row/column
  const SEEK_MUL = 1.3;          // ...and hurry over this much faster than they stroll
  const PTS_ITEM = 10, PTS_HEART = 25, PTS_PER_SECOND = 5, PTS_CAKE = 40;
  const CAKE_TIME = 1.0;         // s standing on the cake to eat it
  const SLIDE_MUL = 1.25;        // wet floor slide speed vs. walking
  const PRINTER = { period: 5, jam: 2 };

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function rectsOverlap(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }
  function centre(r){ return { x: r.x + r.w/2, y: r.y + r.h/2 }; }

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

  // Parse an ASCII level into grid + entities. Throws on malformed levels.
  function parseLevel(def, itemDefs){
    const rows = def.map.length, cols = def.map[0].length;
    const grid = [];
    let spawn = null, cake = null;
    const elev = [], items = [], wet = new Set(), printers = [];
    for (let y = 0; y < rows; y++){
      const line = def.map[y];
      if (line.length !== cols) throw new Error(`row ${y} has ${line.length} cols, expected ${cols}`);
      const row = [];
      for (let x = 0; x < cols; x++){
        const ch = line[x];
        row.push(ch === '#');
        if (ch === 'P') spawn = { gx:x, gy:y };
        else if (ch === 'E') elev.push({ gx:x, gy:y });
        else if (ch === 'w') wet.add(y * cols + x);
        else if (ch === 'p') printers.push({ gx:x, gy:y });
        else if (ch === 'K'){ if (cake) throw new Error('more than one cake'); cake = { gx:x, gy:y }; }
        else if (ch >= '1' && ch <= '9'){
          const id = (def.items || [])[ch.charCodeAt(0) - 49];
          if (!id || !itemDefs[id]) throw new Error(`item '${ch}' at ${x},${y} has no entry in level.items/PACKDASH_ITEMS`);
          if (items.some(it => it.id === id)) throw new Error(`item '${ch}' placed twice`);
          items.push({ gx:x, gy:y, id, n: ch.charCodeAt(0) - 48 });
        }
        else if (ch !== '#' && ch !== '.' && ch !== 'w' && ch !== 'p' && ch !== 'K') throw new Error(`unknown tile '${ch}' at ${x},${y}`);
      }
      grid.push(row);
    }
    if (!spawn) throw new Error('no player spawn (P)');
    if (elev.length !== 4) throw new Error(`elevator must be a 2x2 block, found ${elev.length} tiles`);
    const ex = Math.min(...elev.map(e => e.gx)), ey = Math.min(...elev.map(e => e.gy));
    for (const e of elev) if (e.gx > ex+1 || e.gy > ey+1) throw new Error('elevator tiles are not a 2x2 block');
    if (!items.length) throw new Error('no items');
    if (items.length !== (def.items || []).length) throw new Error('level.items lists items that are not on the map');
    items.sort((a,b) => a.n - b.n);
    const isWall = (x, y) => y < 0 || y >= rows || x < 0 || x >= cols || grid[y][x];
    for (const it of items) if (wet.has(it.gy * cols + it.gx)) throw new Error(`item at ${it.gx},${it.gy} sits on a wet tile`);
    for (const kind of ['bosses', 'coworkers']){
      (def[kind] || []).forEach((a, i) => {
        const pts = a.path;
        if (!pts || !pts.length) throw new Error(`${kind}[${i}] has no path`);
        for (let k = 0; k < pts.length; k++){
          const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % pts.length];
          if (k === pts.length - 1 && !a.loop) { if (isWall(x0, y0)) throw new Error(`${kind}[${i}] waypoint ${x0},${y0} is a wall`); break; }
          if (x0 !== x1 && y0 !== y1) throw new Error(`${kind}[${i}] segment ${x0},${y0} -> ${x1},${y1} is not straight`);
          const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
          for (let s = 0; s <= n; s++){
            const x = x0 + Math.sign(x1 - x0) * s, y = y0 + Math.sign(y1 - y0) * s;
            if (isWall(x, y)) throw new Error(`${kind}[${i}] path crosses a wall at ${x},${y}`);
            if (printers.some(q => q.gx === x && q.gy === y)) throw new Error(`${kind}[${i}] path crosses a printer at ${x},${y}`);
          }
        }
      });
    }
    // Merge horizontal wall runs into rects for collision and drawing.
    const walls = [];
    for (let y = 0; y < rows; y++){
      let x = 0;
      while (x < cols){
        if (!grid[y][x]){ x++; continue; }
        const x0 = x; while (x < cols && grid[y][x]) x++;
        walls.push({ x:x0*TILE, y:y*TILE, w:(x-x0)*TILE, h:TILE });
      }
    }
    return { rows, cols, grid, walls, spawn, elevator:{ gx:ex, gy:ey }, items, wet, printers, cake };
  }

  // An NPC walking a fixed route of tile waypoints (ping-pong, or looping if def.loop).
  // It pauses at the route's ends (ping-pong) or at its first waypoint (loop).
  function makeWalker(def, size, kind, i){
    const pts = def.path.map(([x, y]) => ({ x: x*TILE + TILE/2, y: y*TILE + TILE/2 }));
    const w = {
      kind, i, pts, loop: !!def.loop, speed: def.speed ?? 40, pause: def.pause ?? 0.6, line: def.line,
      cx: pts[0].x, cy: pts[0].y, w: size, h: size, to: pts.length > 1 ? 1 : 0, step: 1,
      wait: def.delay ?? 0, face: { x: 1, y: 0 }, cooldown: 0, talking: false, alert: 0,
      range: def.range ?? 5, vision: [], seek: def.seek ?? SEEK_RANGE, home: null, seeking: false,
    };
    if (def.face) w.face = { x: def.face[0], y: def.face[1] };
    else aimAt(w);
    return w;
  }
  function aimAt(w){
    const t = w.pts[w.to], dx = t.x - w.cx, dy = t.y - w.cy;
    if (dx || dy) w.face = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
  }
  function advanceTarget(w){
    const n = w.pts.length, at = w.to;
    if (w.loop){ w.to = (at + 1) % n; return at === 0; }
    if (at + w.step < 0 || at + w.step >= n) w.step = -w.step;
    w.to = at + w.step;
    return at === 0 || at === n - 1;
  }
  function walkerRect(w){ return { x: w.cx - w.w/2, y: w.cy - w.h/2, w: w.w, h: w.h }; }

  class PackDashGame extends Emitter{
    constructor(levelIndex = 0, opts = {}){
      super();
      this.levels = opts.levels || global.PACKDASH_LEVELS;
      this.itemDefs = opts.items || global.PACKDASH_ITEMS;
      this.seed = opts.seed;
      this.load(levelIndex);
    }

    load(levelIndex){ this.levelIndex = levelIndex; this.restart(); }

    restart(){
      const def = this.levels[this.levelIndex];
      const L = parseLevel(def, this.itemDefs);
      this.def = def;
      this.rng = mulberry32(this.seed != null ? this.seed : (Math.random() * 2**32));
      this.cols = L.cols; this.rows = L.rows; this.tile = TILE;
      this.width = L.cols * TILE; this.height = L.rows * TILE;
      this.grid = L.grid; this.walls = L.walls;
      this.state = 'playing';
      this.time = 0;
      this.timeLimit = def.time;
      this.timeLeft = def.time;
      this.par = def.par;
      this.silver = def.silver ?? Math.ceil(def.par * 1.3);
      this.score = 0; this.hearts = 0; this.weight = 0;
      this.dir = null; this.fallback = null; this.moving = false; this.walked = 0;
      this.talk = null;          // { kind:'boss'|'coworker', who, phase:'choose'|'chat', t }
      this.player = { x: L.spawn.gx*TILE+2, y: L.spawn.gy*TILE+2, w: TILE-4, h: TILE-4, vx:0, vy:0, face:{ x:1, y:0 } };
      this.elevator = { x: L.elevator.gx*TILE, y: L.elevator.gy*TILE, w: 2*TILE, h: 2*TILE };
      this.items = L.items.map(it => ({ gx: it.gx, gy: it.gy, id: it.id, picked:false, progress:0, data: this.itemDefs[it.id] }));
      this.itemsLeft = this.items.length;
      this.wet = L.wet; this.slide = null;
      const pc = Object.assign({}, PRINTER, def.printers || {});
      this.printers = L.printers.map((q, i) => ({ gx: q.gx, gy: q.gy, x: q.gx*TILE, y: q.gy*TILE, w: TILE, h: TILE,
        period: pc.period, jam: pc.jam, phase: (pc.offset || 0) + i * pc.period / 2, jammed: false }));
      this.printerIgnore = [];
      this.cake = L.cake ? { gx: L.cake.gx, gy: L.cake.gy, eaten: false, progress: 0 } : null;
      this.cakeEaten = false;
      this.schedule = def.elevator || null;
      this.bosses = (def.bosses || []).map((b, i) => Object.assign(makeWalker(b, TILE-2, 'boss', i), { look: b.look || 'boss' }));
      this.coworkers = (def.coworkers || []).map((c, i) => makeWalker(c, TILE-4, 'coworker', i));
      this.updatePrinters();
      for (const b of this.bosses) this.updateVision(b);
      this.emit('restart');
      this.emit('time', Math.ceil(this.timeLeft));
      this.emit('score', this.score);
      this.emit('items', this.itemsLeft);
      this.emit('status', def.hint || 'Pack fast, smile often!');
    }

    // dir: newest held direction. fallback: the previously held one, used while dir is
    // blocked so you can "pre-turn" into a gap you're about to pass.
    input(dir, fallback){ this.dir = dir || null; this.fallback = fallback || null; }

    // "Excuse me!" - escape a coworker before the chat starts, or chip away at a boss chat.
    excuse(){
      const t = this.talk;
      if (!t || this.state !== 'playing') return false;
      if (t.kind === 'coworker' && t.phase === 'choose'){
        this.emit('status', 'You deploy the stealth nod. Smooth.');
        this.emit('excuse', { kind: 'coworker' });
        t.phase = 'nod'; t.t = t.total = NOD_TIME;
        return true;
      }
      if (t.kind === 'boss'){
        t.t -= EXCUSE_CUT;
        this.emit('excuse', { kind: 'boss' });
        if (t.t <= 0) this.endTalk();
        return true;
      }
      return false;
    }

    get weightMul(){ return Math.max(MIN_WEIGHT_MUL, 1 - WEIGHT_SLOW * this.weight); }
    get speed(){ return BASE_SPEED * this.weightMul; }

    isWall(gx, gy){ return gy < 0 || gy >= this.rows || gx < 0 || gx >= this.cols || this.grid[gy][gx]; }
    isWet(gx, gy){ return this.wet.has(gy * this.cols + gx); }
    printerAt(gx, gy){ return this.printers.find(q => q.gx === gx && q.gy === gy) || null; }
    // Wall, or a printer that is jammed right now.
    isBlocked(gx, gy){ if (this.isWall(gx, gy)) return true; const q = this.printerAt(gx, gy); return !!(q && q.jammed); }

    // Elevator doors: always open once packed, unless the level runs them on a schedule.
    scheduleOpen(){
      const s = this.schedule;
      if (!s) return true;
      return ((this.time + (s.offset || 0)) % s.period) < s.open;
    }
    // Seconds until the doors next open (0 if open now).
    scheduleWait(){
      const s = this.schedule;
      if (!s || this.scheduleOpen()) return 0;
      return s.period - ((this.time + (s.offset || 0)) % s.period);
    }
    get doorsOpen(){ return this.itemsLeft === 0 && this.scheduleOpen(); }

    updatePrinters(){
      for (const q of this.printers){
        const j = ((this.time + q.phase) % q.period) < q.jam;
        if (j !== q.jammed){ q.jammed = j; this.emit(j ? 'printerJam' : 'printerClear', q); }
      }
    }
    tileOf(r){ const c = centre(r); return { gx: Math.floor(c.x / TILE), gy: Math.floor(c.y / TILE) }; }

    step(dt){
      if (this.state !== 'playing') return;
      this.time += dt;
      this.timeLeft = Math.max(0, this.timeLimit - this.time);
      this.emit('time', Math.ceil(this.timeLeft));

      this.updatePrinters();
      this.stepTalk(dt);
      for (const b of this.bosses) this.stepWalker(b, dt);
      for (const c of this.coworkers) this.stepWalker(c, dt);
      this.stepPlayer(dt);
      this.checkEncounters(dt);
      this.stepPacking(dt);
      this.stepCake(dt);

      if (this.doorsOpen && !this.talk && rectsOverlap(this.player, this.elevator)){
        this.state = 'won';
        this.emit('win', this.result());
        return;
      }
      if (this.timeLeft <= 0){
        this.state = 'lost';
        this.endTalk(true);
        this.emit('lose', { score: this.score, itemsLeft: this.itemsLeft });
      }
    }

    result(){
      const items = (this.items.length - this.itemsLeft) * PTS_ITEM;
      const hearts = this.hearts * PTS_HEART;
      const timeBonus = Math.floor(this.timeLeft) * PTS_PER_SECOND;
      const cake = this.cakeEaten ? PTS_CAKE : 0;
      const time = this.time;
      const stars = time <= this.par ? 3 : time <= this.silver ? 2 : 1;
      return { time, stars, par: this.par, silver: this.silver, items, hearts, heartCount: this.hearts,
               timeBonus, cake, total: items + hearts + timeBonus + cake };
    }

    stepTalk(dt){
      const t = this.talk;
      if (!t) return;
      t.t -= dt;
      if (t.t > 0) return;
      if (t.kind === 'coworker' && t.phase === 'choose'){
        t.phase = 'chat'; t.t = t.total = COWORKER_CHAT;
        this.hearts += 1;
        this.score += PTS_HEART;
        this.emit('score', this.score);
        this.emit('heart', this.hearts);
        this.emit('status', t.who.line || 'Small talk achieved. Heart full, schedule fuller.');
        return;
      }
      this.endTalk();
    }

    endTalk(silent){
      const t = this.talk;
      if (!t) return;
      this.talk = null;
      t.who.talking = false;
      t.who.alert = 0;
      t.who.cooldown = t.kind === 'boss' ? BOSS_COOLDOWN : COWORKER_COOLDOWN;
      if (!silent){
        if (t.kind === 'boss') this.emit('status', 'You escape the chat.');
        this.emit('talkEnd', t);
      }
    }

    startTalk(who){
      if (who.kind === 'boss'){
        this.talk = { kind: 'boss', who, phase: 'chat', t: BOSS_CHAT, total: BOSS_CHAT };
        this.emit('status', 'Boss: “Quick congrats + tiny chat?” Mash Space to excuse yourself!');
        this.emit('bossTalk', who);
      } else {
        this.talk = { kind: 'coworker', who, phase: 'choose', t: CHOICE_TIME, total: CHOICE_TIME };
        this.emit('status', 'A coworker! Space to excuse yourself, or stay for a ♥.');
        this.emit('coworkerTalk', who);
      }
      who.talking = true;
    }

    stepWalker(w, dt){
      if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt);
      if (w.kind === 'coworker' && !w.talking && this.stepSeek(w, dt)) return;
      if (!w.talking && w.pts.length > 1){
        let budget = w.speed * dt;
        if (w.wait > 0){ const used = Math.min(w.wait, dt); w.wait -= used; budget = w.speed * (dt - used); }
        while (budget > 0){
          const t = w.pts[w.to], dx = t.x - w.cx, dy = t.y - w.cy, d = Math.hypot(dx, dy);
          if (d > budget){ w.cx += dx / d * budget; w.cy += dy / d * budget; break; }
          w.cx = t.x; w.cy = t.y; budget -= d;
          const pause = advanceTarget(w);
          aimAt(w);
          if (pause && w.pause > 0){ w.wait = w.pause; break; }
        }
      }
      if (w.kind === 'boss') this.updateVision(w);
    }

    // Coworkers hurry toward a player they can see along their row/column, then walk back
    // to the spot where they left their route. Returns true while that overrides patrolling.
    stepSeek(w, dt){
      const pc = centre(this.player);
      const dx = pc.x - w.cx, dy = pc.y - w.cy;
      let axis = null;
      if (w.cooldown <= 0 && !this.talk){
        if (Math.abs(dy) < TILE/2 && Math.abs(dx) <= w.seek * TILE) axis = 'x';
        else if (Math.abs(dx) < TILE/2 && Math.abs(dy) <= w.seek * TILE) axis = 'y';
        if (axis && !this.clearLine(w.cx, w.cy, pc.x, pc.y)) axis = null;
        if (axis && w.home && w.home.axis !== axis) axis = null;
      }
      if (axis){
        if (!w.home) w.home = { x: w.cx, y: w.cy, axis };
        if (!w.seeking) this.emit('coworkerSeek', w);
        w.seeking = true;
        const d = axis === 'x' ? dx : dy, step = Math.sign(d) * Math.min(Math.abs(d), w.speed * SEEK_MUL * dt);
        if (axis === 'x'){ w.cx += step; w.face = { x: Math.sign(d) || w.face.x, y: 0 }; }
        else { w.cy += step; w.face = { x: 0, y: Math.sign(d) || w.face.y }; }
        return true;
      }
      w.seeking = false;
      if (!w.home) return false;
      const hx = w.home.x - w.cx, hy = w.home.y - w.cy, hd = Math.hypot(hx, hy), s = w.speed * dt;
      if (hd <= s){ w.cx = w.home.x; w.cy = w.home.y; w.home = null; aimAt(w); return false; }
      w.cx += hx / hd * s; w.cy += hy / hd * s;
      w.face = Math.abs(hx) >= Math.abs(hy) ? { x: Math.sign(hx), y: 0 } : { x: 0, y: Math.sign(hy) };
      return true;
    }

    // Cone of floor tiles in front of the boss, widening with distance, blocked by walls.
    updateVision(b){
      const bgx = Math.floor(b.cx / TILE), bgy = Math.floor(b.cy / TILE);
      const f = b.face, px = -f.y, py = f.x;
      const vis = [];
      for (let d = 1; d <= b.range; d++){
        const wdt = d < 2 ? 0 : d < 5 ? 1 : 2;
        for (let o = -wdt; o <= wdt; o++){
          const gx = bgx + f.x*d + px*o, gy = bgy + f.y*d + py*o;
          if (this.isWall(gx, gy)) continue;
          if (this.clearLine(b.cx, b.cy, gx*TILE + TILE/2, gy*TILE + TILE/2)) vis.push(gy * this.cols + gx);
        }
      }
      b.vision = vis;
    }

    clearLine(x0, y0, x1, y1){
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4);
      for (let i = 1; i < n; i++){
        const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
        if (this.isWall(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
      }
      return true;
    }

    // Is a tile currently watched by an attentive boss? (UI + bots)
    watched(gx, gy){
      const k = gy * this.cols + gx;
      return this.bosses.some(b => !b.talking && b.cooldown <= 0 && b.vision.includes(k));
    }

    checkEncounters(dt){
      if (this.talk) return;
      const p = this.player, { gx, gy } = this.tileOf(p), k = gy * this.cols + gx;
      for (const b of this.bosses){
        if (b.cooldown > 0) { b.alert = 0; continue; }
        const bumped = rectsOverlap(p, walkerRect(b));
        const seen = b.vision.includes(k);
        if (seen && b.alert === 0) this.emit('spotted', b);
        b.alert = seen ? b.alert + dt : Math.max(0, b.alert - dt * 2);
        if (bumped || b.alert >= SPOT_TIME){ this.startTalk(b); return; }
      }
      for (const c of this.coworkers){
        if (c.cooldown > 0) continue;
        if (rectsOverlap(p, walkerRect(c))){ this.startTalk(c); return; }
      }
    }

    stepPlayer(dt){
      const p = this.player;
      const ox = p.x, oy = p.y;
      p.vx = p.vy = 0;
      // Printers that jammed on top of you don't trap you; you can walk off them.
      this.printerIgnore = this.printers.filter(q => q.jammed && rectsOverlap(p, q));
      const here = this.tileOf(p);
      if (!this.isWet(here.gx, here.gy)) this.slide = null;
      else if (!this.slide && this.dir && !this.talk) this.slide = this.dir;
      if (this.slide && !this.talk){
        if (!this.tryMove(this.slide, this.speed * SLIDE_MUL * dt, false)) this.slide = null;
      } else if (!this.talk && this.dir){
        const dist = this.speed * dt;
        const fb = this.fallback && this.fallback !== this.dir ? this.fallback : null;
        // With a fallback held, a direction that leads into a wall tile yields straight away.
        if (!this.tryMove(this.dir, dist, !!fb) && fb){
          p.x = ox; p.y = oy;
          this.tryMove(fb, dist, false);
        }
      }
      this.moving = p.x !== ox || p.y !== oy;
      if (this.moving){
        p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt;
        this.walked += Math.hypot(p.x - ox, p.y - oy);
      }
    }

    // Move along one axis, sliding the other axis toward the lane (tile row/column)
    // that is open ahead - so corners and gaps don't snag. Returns true if we got anywhere.
    tryMove(dir, dist, needOpenLane){
      const p = this.player;
      const horiz = dir === 'left' || dir === 'right';
      const sign = dir === 'left' || dir === 'up' ? -1 : 1;
      const c = centre(p);
      const gx = Math.floor(c.x / TILE), gy = Math.floor(c.y / TILE);
      const perp = horiz ? c.y : c.x;
      const lane = horiz ? gy : gx;
      const open = l => horiz ? !this.isBlocked(gx + sign, l) && !this.isBlocked(gx, l) : !this.isBlocked(l, gy + sign) && !this.isBlocked(l, gy);
      let target = lane;
      if (!open(lane)){
        const side = perp - (lane * TILE + TILE/2) >= 0 ? 1 : -1;
        if (open(lane + side) && Math.abs(perp - ((lane + side) * TILE + TILE/2)) <= 10) target = lane + side;
      }
      if (needOpenLane && !open(target)) return false;
      const off = target * TILE + TILE/2 - perp;
      const sx = p.x, sy = p.y;
      if (off){
        const step = Math.sign(off) * Math.min(Math.abs(off), dist);
        if (horiz) p.y += step; else p.x += step;
        if (this.collidesAny(p)){ if (horiz) p.y -= step; else p.x -= step; }
      }
      const mx = p.x, my = p.y;
      if (horiz) p.x = clamp(p.x + sign * dist, 0, this.width - p.w);
      else p.y = clamp(p.y + sign * dist, 0, this.height - p.h);
      if (this.collidesAny(p)){ p.x = mx; p.y = my; }
      const advanced = p.x !== mx || p.y !== my;
      // Only sliding sideways against a dead end doesn't count as getting anywhere.
      if (!advanced && !(open(target) && (p.x !== sx || p.y !== sy))) return false;
      p.face = horiz ? { x: sign, y: 0 } : { x: 0, y: sign };
      return true;
    }

    stepPacking(dt){
      const p = this.player;
      for (const it of this.items){
        if (it.picked) continue;
        const r = { x: it.gx*TILE+3, y: it.gy*TILE+3, w: TILE-6, h: TILE-6 };
        if (!this.talk && rectsOverlap(p, r)){
          if (it.progress === 0) this.emit('packStart', it);
          it.progress = Math.min(1, it.progress + dt / PACK_TIME);
          if (it.progress >= 1) this.pack(it);
        } else if (it.progress > 0){
          it.progress = 0;
          this.emit('packCancel', it);
        }
      }
    }

    pack(it){
      it.picked = true;
      this.itemsLeft -= 1;
      this.weight += it.data.weight || 1;
      this.score += PTS_ITEM;
      this.emit('score', this.score);
      this.emit('items', this.itemsLeft);
      this.emit('packed', it);
      this.emit('memory', it.data.memory);
      if (this.itemsLeft === 0){
        this.emit('elevatorOpen');
        this.emit('status', this.schedule ? 'Box packed! Catch the elevator while its light is green.' : 'Box packed! Elevator’s open.');
      }
    }

    collidesAny(r){
      for (const w of this.walls) if (rectsOverlap(r, w)) return true;
      for (const q of this.printers) if (q.jammed && !this.printerIgnore.includes(q) && rectsOverlap(r, q)) return true;
      return false;
    }

    stepCake(dt){
      const k = this.cake;
      if (!k || k.eaten) return;
      const r = { x: k.gx*TILE+3, y: k.gy*TILE+3, w: TILE-6, h: TILE-6 };
      if (!this.talk && rectsOverlap(this.player, r)){
        if (k.progress === 0) this.emit('cakeStart', k);
        k.progress = Math.min(1, k.progress + dt / CAKE_TIME);
        if (k.progress >= 1){
          k.eaten = true; this.cakeEaten = true;
          this.weight += 1;
          this.score += PTS_CAKE;
          this.emit('score', this.score);
          this.emit('cake', k);
          this.emit('status', 'Cake! +40. Delicious. You feel… heavier.');
        }
      } else k.progress = 0;
    }
  }

  global.PackDashGame = PackDashGame;
  global.__PACKDASH_CONST = { TILE, BASE_SPEED, PACK_TIME, SLIDE_MUL, CAKE_TIME, SPOT_TIME, BOSS_CHAT, EXCUSE_CUT, CHOICE_TIME, COWORKER_CHAT, parseLevel, walkerRect };
})(window);
