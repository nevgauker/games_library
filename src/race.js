// Micro Racer: simple top-down racing with 3 tracks and 3 AI levels
(function(global){
  const TWOPI = Math.PI * 2;

  class Emitter { constructor(){ this.m=new Map(); } on(e,f){ if(!this.m.has(e)) this.m.set(e,[]); this.m.get(e).push(f);} emit(e,v){ const a=this.m.get(e); if(a) for(const f of a) f(v); } }

  // Three tracks as waypoint loops (normalized to canvas 640x360)
  // Cars steer toward the next waypoint; lap counts when crossing start line between wp[0] and wp[1]
  const TRACKS = {
    oval: {
      name: 'Oval',
      waypoints: [ [80,180],[160,60],[320,40],[480,60],[560,180],[480,300],[320,320],[160,300] ]
    },
    circuit: {
      name: 'Circuit',
      waypoints: [ [96,300],[120,96],[240,64],[360,96],[544,96],[520,240],[400,280],[256,240] ]
    },
    switch: {
      name: 'Switchback',
      waypoints: [ [80,300],[150,260],[220,220],[290,180],[360,140],[430,110],[520,90],[540,220],[430,230],[320,240],[210,260],[120,280] ]
    }
  };

  const AI_LEVELS = {
    easy:   { maxSpeed: 110, accel: 110, turn: 2.1, jitter: 10, look: 80 },
    normal: { maxSpeed: 140, accel: 160, turn: 2.6, jitter: 6,  look: 110 },
    hard:   { maxSpeed: 170, accel: 200, turn: 3.2, jitter: 3,  look: 140 },
  };

  function angNorm(a){ while(a>Math.PI) a-=TWOPI; while(a<-Math.PI) a+=TWOPI; return a; }
  function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

  class Car{
    constructor({x,y,a,color,isPlayer=false,ai=null}){
      this.x=x; this.y=y; this.a=a; // angle
      this.vx=0; this.vy=0; this.va=0;
      this.speed=0; this.color=color; this.isPlayer=isPlayer; this.ai=ai; this.wp=0; this.progress=0; this.lap=1; this.lapsTotal=3; this.finished=false; this.time=0;
    }
  }

  class RaceGame extends Emitter{
    constructor(){
      super();
      this.width = 640; this.height = 360;
      this.setTrack('oval');
      this.setAI('normal');
      this.restart();
    }

    setTrack(name){ this.trackKey=name; this.track=TRACKS[name]; }
    setAI(level){ this.aiLevel=level; this.aiCfg = AI_LEVELS[level]; }

    spawnCars(){
      const [sx,sy] = this.track.waypoints[0];
      const [sx2,sy2] = this.track.waypoints[1];
      const ang = Math.atan2(sy2-sy, sx2-sx);
      const line = [ {x:sx-10,y:sy-10}, {x:sx-10,y:sy+10}, {x:sx+10,y:sy-10}, {x:sx+10,y:sy+10} ];
      const colors = ['#f43f5e','#60a5fa','#f59e0b'];
      this.cars = [];
      this.player = new Car({ x: sx-18, y: sy+12, a: ang, color:'#34d399', isPlayer:true });
      this.cars.push(this.player);
      for (let i=0;i<3;i++){
        const jitter = (i-1)*10;
        const ai = new Car({ x: sx-20-(i*10), y: sy-10+(i*12), a: ang, color: colors[i%colors.length], ai: { level:this.aiLevel } });
        this.cars.push(ai);
      }
    }

    restart(){
      this.spawnCars();
      this.time=0; this.countdown=1.2; // small go delay
      this.finishedOrder = []; // placement order
      this.emit('lap', { car: this.player, lap: 1, total: this.player.lapsTotal });
      this.emit('pos', 1);
      this.emit('time', 0);
    }

    input(dir){ this.inputDir = dir; }

    updatePlayer(dt){
      const p = this.player; if (p.finished) return;
      const ACCEL = 220, TURN = 3.0, FRICTION = 0.98, BRAKE = 280, MAXS = 170;
      let ax=0, ay=0;
      if (this.inputDir){
        if (this.inputDir.throttle>0){ p.speed = Math.min(MAXS, p.speed + ACCEL*dt); }
        if (this.inputDir.throttle<0){ p.speed = Math.max(-MAXS*0.4, p.speed - BRAKE*dt); }
        if (this.inputDir.turn){ p.a += this.inputDir.turn * TURN * dt * (1.0 + Math.abs(p.speed)/200); }
      }
      // velocity from speed+angle
      p.vx = Math.cos(p.a) * p.speed;
      p.vy = Math.sin(p.a) * p.speed;
      // integrate
      p.x += p.vx*dt; p.y += p.vy*dt;
      // soft bounds
      if (p.x<10) { p.x=10; p.speed*=0.7; }
      if (p.x>this.width-10) { p.x=this.width-10; p.speed*=0.7; }
      if (p.y<10) { p.y=10; p.speed*=0.7; }
      if (p.y>this.height-10) { p.y=this.height-10; p.speed*=0.7; }
      // friction
      p.speed *= FRICTION;
      p.time += dt;
      this.handleProgress(p);
    }

    updateAI(dt){
      for (const c of this.cars){
        if (!c.ai || c.finished) continue;
        const cfg = this.aiCfg;
        const wp = this.track.waypoints[c.wp % this.track.waypoints.length];
        // steer to waypoint with a bit of jitter based on level
        const jitter = ((Math.random()*2-1)*cfg.jitter);
        const tx = wp[0] + jitter, ty = wp[1] + jitter;
        const angTo = Math.atan2(ty - c.y, tx - c.x);
        let angDiff = angNorm(angTo - c.a);
        c.a += Math.sign(angDiff) * Math.min(Math.abs(angDiff), cfg.turn*dt);
        // throttle towards target
        const d = Math.hypot(tx - c.x, ty - c.y);
        const want = Math.min(cfg.maxSpeed, Math.max(60, d * 2.0));
        if (c.speed < want) c.speed = Math.min(want, c.speed + cfg.accel*dt);
        else c.speed = Math.max(want, c.speed - cfg.accel*0.6*dt);
        // integrate
        c.vx = Math.cos(c.a) * c.speed;
        c.vy = Math.sin(c.a) * c.speed;
        c.x += c.vx*dt; c.y += c.vy*dt;
        // bounds and drag
        if (c.x<10) { c.x=10; c.speed*=0.8; }
        if (c.x>this.width-10) { c.x=this.width-10; c.speed*=0.8; }
        if (c.y<10) { c.y=10; c.speed*=0.8; }
        if (c.y>this.height-10) { c.y=this.height-10; c.speed*=0.8; }
        c.speed *= 0.992;
        c.time += dt;
        this.handleProgress(c);
        // switch wp
        if (dist({x:tx,y:ty}, c) < cfg.look) { c.wp = (c.wp + 1) % this.track.waypoints.length; }
      }
    }

    handleProgress(car){
      // progress measured by current waypoint index
      // lap increment when car crosses from last wp to wp0
      const n = this.track.waypoints.length;
      const wp = car.wp % n;
      const target = this.track.waypoints[wp];
      // if close enough, advance
      const close = Math.hypot(target[0]-car.x, target[1]-car.y) < 26;
      if (close) {
        car.wp = (car.wp + 1) % n;
        if (car.wp === 0){
          // completed a lap
          car.lap += 1;
          if (car.isPlayer) this.emit('lap', { car, lap: Math.min(car.lap, car.lapsTotal), total: car.lapsTotal });
          if (car.lap > car.lapsTotal) this.finish(car);
        }
      }
    }

    finish(car){
      if (car.finished) return;
      car.finished = true;
      this.finishedOrder.push(car);
      if (car.isPlayer){
        const pos = this.placeOf(car);
        this.emit('finish', { pos, time: car.time });
      }
    }

    placeOf(car){
      const arr = [...this.cars];
      arr.sort((a,b)=> (b.lap-a.lap) || (b.wp-a.wp) || (a.time-b.time));
      return arr.indexOf(car)+1;
    }

    step(dt){
      if (this.countdown>0){ this.countdown -= dt; if (this.countdown<=0) this.emit('status','Go!'); }
      this.time += dt; this.emit('time', this.time);
      if (this.countdown<=0){
        this.updatePlayer(dt);
        this.updateAI(dt);
      }
      // live position update
      const pos = this.placeOf(this.player);
      this.emit('pos', pos);
    }
  }

  global.RaceGame = RaceGame;
  global.__RACE_CONST = { TRACKS, AI_LEVELS };
})(window);

