// Micro Racer: simple top-down racing with 3 tracks and 3 AI levels
(function(global){
  const TWOPI = Math.PI * 2;
  const LAPS = 3;
  const COUNTDOWN = 3;      // seconds of 3-2-1 before GO
  const GATE_RADIUS = 90;   // a car must pass within this distance of a waypoint for it to count

  class Emitter { constructor(){ this.m=new Map(); } on(e,f){ if(!this.m.has(e)) this.m.set(e,[]); this.m.get(e).push(f);} emit(e,v){ const a=this.m.get(e); if(a) for(const f of a) f(v); } }

  // Three tracks as waypoint loops (canvas 640x360).
  // Each waypoint is also a "gate": a line through the waypoint, across the direction of travel.
  // Cars must cross the gates in order; crossing gate 0 after all the others completes a lap.
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

  // lane: max sideways offset from the waypoint the AI aims for (re-rolled per waypoint)
  // look: distance at which the AI starts steering for the next waypoint
  const AI_LEVELS = {
    easy:   { maxSpeed: 110, accel: 110, turn: 2.1, lane: 14, look: 40 },
    normal: { maxSpeed: 140, accel: 160, turn: 2.6, lane: 10, look: 50 },
    hard:   { maxSpeed: 170, accel: 200, turn: 3.2, lane: 6,  look: 60 },
  };

  const PLAYER = { accel: 220, brake: 280, maxSpeed: 170, reverse: 0.4, turn: 4.2, friction: 0.98 };

  function angNorm(a){ while(a>Math.PI) a-=TWOPI; while(a<-Math.PI) a+=TWOPI; return a; }
  // Per-frame (60fps) decay factor converted to any frame time
  function decay(f, dt){ return Math.pow(f, dt*60); }

  function buildGates(wps){
    const n = wps.length;
    return wps.map(([x,y], i) => {
      const [px,py] = wps[(i-1+n)%n], [nx,ny] = wps[(i+1)%n];
      const tx = nx-px, ty = ny-py, l = Math.hypot(tx,ty) || 1;
      return { x, y, tx: tx/l, ty: ty/l };
    });
  }

  class Car{
    constructor({x,y,a,color,isPlayer=false,ai=false}){
      this.x=x; this.y=y; this.a=a; this.speed=0;
      this.color=color; this.isPlayer=isPlayer; this.ai=ai;
      this.gate=0;          // index of the next gate to cross
      this.started=false;   // grid is behind the start line; the first crossing starts lap 1
      this.lap=1; this.finished=false; this.time=0;
      this.target=0; this.laneOff=0; // AI steering
    }
  }

  class RaceGame extends Emitter{
    constructor(){
      super();
      this.width = 640; this.height = 360;
      this.laps = LAPS;
      this.setTrack('oval');
      this.setAI('normal');
      this.restart();
    }

    setTrack(name){ this.trackKey=name; this.track=TRACKS[name]; this.gates=buildGates(this.track.waypoints); }
    setAI(level){ this.aiLevel=level; this.aiCfg = AI_LEVELS[level]; }

    spawnCars(){
      const g = this.gates[0];
      const nx = -g.ty, ny = g.tx; // across the track
      const a = Math.atan2(g.ty, g.tx);
      // 2x2 grid behind the start line: [distance along track, offset across]. Player starts at the back.
      const slots = [ [-22,-10],[-22,10],[-46,-10],[-46,10] ];
      const place = ([u,v]) => ({ x: g.x + g.tx*u + nx*v, y: g.y + g.ty*u + ny*v, a });
      const colors = ['#f43f5e','#60a5fa','#f59e0b'];
      this.cars = colors.map((color,i) => new Car({ ...place(slots[i]), color, ai:true }));
      this.player = new Car({ ...place(slots[3]), color:'#34d399', isPlayer:true });
      this.cars.push(this.player);
    }

    restart(){
      this.spawnCars();
      this.countdown = COUNTDOWN; this.lastCount = null;
      this.clock = 0;           // seconds since GO
      this.goCleared = false;
      this.finishedOrder = [];
      this.emit('lap', { lap: 1, total: LAPS });
      this.emit('time', 0);
      this.emit('pos', this.placeOf(this.player));
      this.emit('status', '');
    }

    input(dir){ this.inputDir = dir; }

    // Move along heading; the canvas edge acts as a wall that scrubs speed
    move(c, dt, scrub){
      c.x += Math.cos(c.a)*c.speed*dt; c.y += Math.sin(c.a)*c.speed*dt;
      const m = 10;
      if (c.x<m || c.x>this.width-m || c.y<m || c.y>this.height-m){
        c.x = Math.max(m, Math.min(this.width-m, c.x));
        c.y = Math.max(m, Math.min(this.height-m, c.y));
        c.speed *= decay(scrub, dt);
      }
    }

    updatePlayer(dt){
      const p = this.player; if (p.finished) return;
      const C = PLAYER, inp = this.inputDir || {};
      if (inp.throttle > 0) p.speed = Math.min(C.maxSpeed, p.speed + C.accel*dt);
      else if (inp.throttle < 0) p.speed = Math.max(-C.maxSpeed*C.reverse, p.speed - C.brake*dt);
      if (inp.turn){
        // Needs a little speed to steer, steering softens at top speed, reversing flips it
        const s = Math.abs(p.speed);
        const grip = Math.min(1, s/40) * (1 - 0.3*s/C.maxSpeed);
        p.a += inp.turn * C.turn * grip * Math.sign(p.speed) * dt;
      }
      this.move(p, dt, 0.7);
      p.speed *= decay(C.friction, dt);
      p.time += dt;
      this.handleProgress(p);
    }

    updateAI(dt){
      const cfg = this.aiCfg, n = this.gates.length;
      for (const c of this.cars){
        if (!c.ai || c.finished) continue;
        const g = this.gates[c.target];
        // aim at the waypoint, shifted sideways by this car's lane offset
        const tx = g.x - g.ty*c.laneOff, ty = g.y + g.tx*c.laneOff;
        const angDiff = angNorm(Math.atan2(ty-c.y, tx-c.x) - c.a);
        c.a += Math.sign(angDiff) * Math.min(Math.abs(angDiff), cfg.turn*dt);
        // ease off near the waypoint, full speed on the straights
        const d = Math.hypot(tx-c.x, ty-c.y);
        const want = Math.min(cfg.maxSpeed, Math.max(60, d*2));
        if (c.speed < want) c.speed = Math.min(want, c.speed + cfg.accel*dt);
        else c.speed = Math.max(want, c.speed - cfg.accel*0.6*dt);
        this.move(c, dt, 0.8);
        c.speed *= decay(0.992, dt);
        c.time += dt;
        this.handleProgress(c);
        // steer for the next waypoint early, but never more than one past the gate still owed
        // (on tracks that fold back on themselves a later waypoint can look "passed" too soon)
        const ahead = (c.target - c.gate + n) % n;
        if (ahead > 1){ c.target = c.gate; c.laneOff = (Math.random()*2-1) * cfg.lane; }
        else if (ahead === 0 && (d < cfg.look || this.crossed(c, c.target))){
          c.target = (c.target + 1) % n;
          c.laneOff = (Math.random()*2-1) * cfg.lane;
        }
      }
    }

    // Has the car crossed gate i (past the line through the waypoint, and near it)?
    crossed(c, i){
      const g = this.gates[i];
      const dx = c.x-g.x, dy = c.y-g.y;
      return dx*g.tx + dy*g.ty >= 0 && Math.hypot(dx,dy) < GATE_RADIUS;
    }

    handleProgress(car){
      if (!this.crossed(car, car.gate)) return;
      if (car.gate === 0){
        if (!car.started) car.started = true;
        else {
          car.lap += 1;
          if (car.lap > LAPS){ this.finish(car); return; }
          if (car.isPlayer) this.emit('lap', { lap: car.lap, total: LAPS });
        }
      }
      car.gate = (car.gate + 1) % this.gates.length;
    }

    // Gates crossed so far, plus the fraction of the way to the next one
    progressOf(car){
      const n = this.gates.length;
      const next = this.gates[car.gate];
      const d = Math.hypot(next.x-car.x, next.y-car.y);
      if (!car.started) return -d/1000;
      const prev = this.gates[(car.gate-1+n)%n];
      const seg = Math.hypot(next.x-prev.x, next.y-prev.y) || 1;
      const passed = (car.lap-1)*n + (car.gate === 0 ? n : car.gate);
      return passed - 1 + Math.max(0, Math.min(1, 1 - d/seg));
    }

    standings(){
      const racing = this.cars.filter(c => !c.finished).sort((a,b) => this.progressOf(b) - this.progressOf(a));
      return [...this.finishedOrder, ...racing];
    }

    placeOf(car){ return this.standings().indexOf(car) + 1; }

    finish(car){
      if (car.finished) return;
      car.finished = true;
      this.finishedOrder.push(car);
      if (car.isPlayer) this.emit('finish', { pos: this.placeOf(car), time: car.time });
    }

    step(dt){
      if (this.countdown > 0){
        this.countdown -= dt;
        const n = Math.max(0, Math.ceil(this.countdown));
        if (n !== this.lastCount){ this.lastCount = n; this.emit('status', n > 0 ? String(n) : 'GO!'); }
      } else {
        this.clock += dt;
        if (!this.goCleared && this.clock > 1){ this.goCleared = true; this.emit('status', ''); }
        this.updatePlayer(dt);
        this.updateAI(dt);
      }
      this.emit('time', this.player.time);
      this.emit('pos', this.placeOf(this.player));
    }
  }

  global.RaceGame = RaceGame;
  global.__RACE_CONST = { TRACKS, AI_LEVELS, LAPS };
})(window);
