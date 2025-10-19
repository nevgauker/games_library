// Pack & Dash! Minimal humorous office dash
(function(global){
  const TILE = 16;
  const COLS = 24; // 384px
  const ROWS = 20; // 320px
  const BASE_SPEED = 80; // px/s

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function rectsOverlap(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }

  class Emitter{ constructor(){ this.m=new Map(); } on(e,f){ if(!this.m.has(e)) this.m.set(e,[]); this.m.get(e).push(f);} emit(e,v){ const a=this.m.get(e)||[]; for(const f of a) f(v); } }

  // Procedural tiny office: outer walls + a few desks (rects)
  function makeOffice(){
    const walls = [];
    // outer border
    walls.push({x:0,y:0,w:COLS*TILE,h:TILE}); // top
    walls.push({x:0,y:(ROWS-1)*TILE,w:COLS*TILE,h:TILE}); // bottom
    walls.push({x:0,y:0,w:TILE,h:ROWS*TILE}); // left
    walls.push({x:(COLS-1)*TILE,y:0,w:TILE,h:ROWS*TILE}); // right
    // desks
    const desk = (gx,gy,gw,gh)=>({x:gx*TILE,y:gy*TILE,w:gw*TILE,h:gh*TILE});
    walls.push(desk(6,5,4,2));
    walls.push(desk(14,5,4,2));
    walls.push(desk(6,11,4,2));
    walls.push(desk(14,11,4,2));
    return walls;
  }

  const ITEMS = [
    { icon:'☕', name:'coffee mug', memory:'“Remember the latte art phase? Abstract, but heartfelt.”' },
    { icon:'🌱', name:'desk plant', memory:'“Remember naming the plant Carl? A true survivor.”' },
    { icon:'🧼', name:'weird stress ball', memory:'“Remember squishing this during all‑hands? Elite form.”' },
    { icon:'🖊️', name:'favorite pen', memory:'“Remember guarding this pen like treasure? Valid.”' },
    { icon:'📎', name:'lucky paperclip', memory:'“Remember the paperclip chain championship? Unstoppable.”' },
    { icon:'🍪', name:'secret snack', memory:'“Remember snack o’clock at 3:07? Iconic.”' },
  ];

  class PackDashGame extends Emitter{
    constructor(){
      super();
      this.cols=COLS; this.rows=ROWS; this.tile=TILE; this.width=COLS*TILE; this.height=ROWS*TILE;
      this.restart();
    }

    restart(){
      this.timeLeft = 60.0;
      this.score = 0;
      this.walls = makeOffice();
      this.player = { x: 2*TILE+2, y: 2*TILE+2, w: TILE-4, h: TILE-4, vx:0, vy:0 };
      this.baseSpeed = BASE_SPEED; this.speedMul = 1.0; this.slowTimer=0; this.boostTimer=0;
      this.elevator = { x:(COLS-3)*TILE, y:(ROWS-3)*TILE, w:2*TILE, h:2*TILE };
      // scatter items
      this.items = [];
      const spots = [ [4,4],[10,4],[18,4],[4,9],[18,9],[8,15] ];
      for (let i=0;i<ITEMS.length;i++){
        const [gx,gy] = spots[i];
        this.items.push({ gx, gy, picked:false, data: ITEMS[i] });
      }
      this.itemsLeft = this.items.length;
      // boss
      this.boss = { x: 12*TILE, y: 2*TILE, w: TILE-2, h: TILE-2, dir: 1, talk:0 };
      // coworker spawn
      this.coworker = null; this.coworkerTimer = 2.5 + Math.random()*3;
      this.emit('time', Math.ceil(this.timeLeft));
      this.emit('score', this.score);
      this.emit('items', this.itemsLeft);
      this.emit('status', 'Pack fast, smile often!');
    }

    input(dir){
      const s = this.baseSpeed * this.speedMul;
      this.player.vx = dir==='left'?-s:dir==='right'?s:0;
      this.player.vy = dir==='up'?-s:dir==='down'?s:0;
      if (!dir) { this.player.vx=0; this.player.vy=0; }
    }

    step(dt){
      if (this.timeLeft <= 0) return;
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.emit('time', Math.ceil(this.timeLeft));
      // decay buffs/debuffs
      if (this.boostTimer>0){ this.boostTimer-=dt; if (this.boostTimer<=0) this.speedMul = Math.max(1.0, this.speedMul); }
      if (this.slowTimer>0){ this.slowTimer-=dt; if (this.slowTimer<=0) this.speedMul = Math.max(1.0, this.speedMul); }
      if (this.boss.talk>0){ this.boss.talk-=dt; if (this.boss.talk<=0) this.emit('status','You escape the chat.'); }

      // boss roam horizontally; bounce on desks/walls
      const b = this.boss; const bs = 40; const oldx=b.x; b.x += b.dir*bs*dt;
      const bRect = {x:b.x,y:b.y,w:b.w,h:b.h};
      if (this.collidesAny(bRect, this.walls)) { b.x=oldx; b.dir*=-1; }

      // boss line-of-sight (same row or col within 6 tiles, no wall between)
      if (this.boss.talk<=0 && this.hasLOS(b, this.player, 6*TILE)){
        this.boss.talk = 3.0; // long awkward talk
        this.speedMul = 0.4; this.slowTimer = 3.0;
        this.emit('status','Boss: “Quick congrats + tiny chat?” (So tiny.)');
        this.emit('bossTalk');
      }

      // coworker spawn
      this.coworkerTimer -= dt;
      if (this.coworkerTimer<=0 && !this.coworker){
        const dx = (Math.random()<0.5?-1:1)*(2+Math.floor(Math.random()*3));
        const dy = (Math.random()<0.5?-1:1)*(1+Math.floor(Math.random()*2));
        const gx = clamp(Math.floor(this.player.x/TILE)+dx, 2, COLS-3), gy = clamp(Math.floor(this.player.y/TILE)+dy, 2, ROWS-3);
        this.coworker = { x: gx*TILE+2, y: gy*TILE+2, w: TILE-4, h: TILE-4, ttl: 3.5 };
        this.emit('coworker', { x:this.coworker.x, y:this.coworker.y });
        this.coworkerTimer = 6 + Math.random()*6;
      }
      if (this.coworker){ this.coworker.ttl -= dt; if (this.coworker.ttl<=0) { this.coworker=null; this.emit('coworkerGone'); } }

      // movement with collision (separate axis)
      const p=this.player; const oldPx=p.x, oldPy=p.y;
      p.x = clamp(p.x + p.vx*dt, TILE+1, this.width - TILE - 1);
      if (this.collidesAny(p, this.walls)) p.x = oldPx;
      p.y = clamp(p.y + p.vy*dt, TILE+1, this.height - TILE - 1);
      if (this.collidesAny(p, this.walls)) p.y = oldPy;

      // items
      for (const it of this.items){
        if (!it.picked){
          const r = { x: it.gx*TILE+3, y: it.gy*TILE+3, w: TILE-6, h: TILE-6 };
          if (rectsOverlap(p, r)){
            it.picked = true; this.itemsLeft -= 1; this.score += 10; this.emit('score', this.score); this.emit('items', this.itemsLeft);
            this.emit('memory', it.data.memory);
          }
        }
      }

      // coworker interaction zone (small)
      if (this.coworker && rectsOverlap(p, this.coworker)) {
        // ambient, no action here; UI handles choices
      }

      // win/lose
      const needElevator = this.itemsLeft===0;
      const inElev = rectsOverlap(p, this.elevator);
      if (needElevator && inElev){ this.timeLeft = 0; this.emit('win', { score: this.score }); return; }
      if (this.timeLeft<=0){ this.emit('lose', { score: this.score, itemsLeft: this.itemsLeft }); }
    }

    collidesAny(r, arr){ for (const a of arr){ if (rectsOverlap(r,a)) return true; } return false; }

    hasLOS(boss, player, maxDist){
      const dx = Math.abs((boss.x+boss.w/2) - (player.x+player.w/2));
      const dy = Math.abs((boss.y+boss.h/2) - (player.y+player.h/2));
      if (dx>maxDist && dy>maxDist) return false;
      const sameRow = dy < TILE/2; const sameCol = dx < TILE/2;
      if (!(sameRow || sameCol)) return false;
      // check walls between
      if (sameRow){
        const y = boss.y; const minx = Math.min(boss.x, player.x), maxx = Math.max(boss.x, player.x);
        for (const w of this.walls){ if (y >= w.y-1 && y <= w.y+w.h+1 && !(w.x > maxx || w.x+w.w < minx)) return false; }
        return true;
      }
      if (sameCol){
        const x = boss.x; const miny = Math.min(boss.y, player.y), maxy = Math.max(boss.y, player.y);
        for (const w of this.walls){ if (x >= w.x-1 && x <= w.x+w.w+1 && !(w.y > maxy || w.y+w.h < miny)) return false; }
        return true;
      }
      return false;
    }

    // coworker choice outcomes
    choose(action){
      if (!this.coworker) return;
      if (action==='wave'){ this.score += 5; this.emit('score', this.score); this.speedMul = 1.2; this.boostTimer = 2.0; this.emit('status','You wave like a pro. Zoom zoom!'); }
      else if (action==='hug'){ this.score += 10; this.emit('score', this.score); this.speedMul = 0.7; this.slowTimer = 1.0; this.emit('status','Wholesome hug achieved. Heart full, feet slower.'); }
      else if (action==='ignore'){ this.score = Math.max(0, this.score - 2); this.emit('score', this.score); this.emit('status','You deploy the stealth nod. Smooth.'); }
      this.coworker = null; this.emit('coworkerGone');
    }
  }

  global.PackDashGame = PackDashGame;
  global.__PACKDASH_CONST = { TILE, COLS, ROWS };
})(window);
