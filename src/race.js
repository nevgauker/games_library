// Micro Racer: simple top-down racing with 3 tracks and 3 AI levels
(function(global){
  const TWOPI = Math.PI * 2;
  const LAPS = 3;
  const COUNTDOWN = 3;      // seconds of 3-2-1 before GO
  const SAMPLE_STEP = 4;    // px between centerline samples
  const SEARCH_WIN = 12;    // samples either side of a car's last position searched each frame
  const OFF_TRACK = 24;     // px beyond the road edge before a car's progress is frozen
  const MAX_REJOIN = 100;   // px of road a car may skip when rejoining and still get credit

  class Emitter { constructor(){ this.m=new Map(); } on(e,f){ if(!this.m.has(e)) this.m.set(e,[]); this.m.get(e).push(f);} emit(e,v){ const a=this.m.get(e); if(a) for(const f of a) f(v); } }

  // Tracks are closed loops of waypoints (canvas 640x360) smoothed into a road of half-width `half`.
  // Waypoint 0 is the start/finish line; cars race in waypoint order.
  const TRACKS = {
    oval: {
      name: 'Oval', half: 24,
      waypoints: [ [80,180],[160,60],[320,40],[480,60],[560,180],[480,300],[320,320],[160,300] ]
    },
    circuit: {
      name: 'Circuit', half: 22,
      waypoints: [ [106,210],[120,96],[240,64],[360,96],[544,96],[520,240],[400,280],[256,240],[150,300],[90,276] ]
    },
    switch: {
      name: 'Switchback', half: 20,
      // An outer loop with two hairpin "tongues" pushing down from the top edge
      waypoints: [
        [120,312],[320,316],[520,312],[588,260],[592,130],[560,62],[495,52],
        [452,100],[448,180],[410,232],[365,180],[360,100],
        [325,55],[275,58],
        [245,100],[240,180],[200,232],[158,180],[155,100],
        [120,55],[65,70],[45,150],[55,260]
      ]
    }
  };

  // look: base look-ahead (px) for steering; lane: max sideways wander; band: catch-up strength
  const AI_LEVELS = {
    easy:   { maxSpeed: 120, accel: 120, turn: 2.4, lane: 10, look: 30, band: 0.08 },
    normal: { maxSpeed: 145, accel: 160, turn: 2.8, lane: 8,  look: 34, band: 0.05 },
    hard:   { maxSpeed: 162, accel: 200, turn: 3.15, lane: 5, look: 38, band: 0.03 },
  };

  // slip values are per-frame (60fps) retention of sideways speed: lower = more grip
  const PLAYER = { accel: 220, brake: 280, maxSpeed: 170, reverse: 0.4, turn: 4.2, friction: 0.98,
                   slip: 0.55, grassSlip: 0.75, hbSlip: 0.96, hbTurn: 1.4, hbDrag: 0.985 };
  const CAR_RADIUS = 7;     // collision radius
  const GRASS_DRAG = { player: 0.93, ai: 0.94 }; // per-frame (60fps) speed decay off the road

  function angNorm(a){ while(a>Math.PI) a-=TWOPI; while(a<-Math.PI) a+=TWOPI; return a; }
  // Per-frame (60fps) decay factor converted to any frame time
  function decay(f, dt){ return Math.pow(f, dt*60); }

  // Closed centripetal Catmull-Rom spline through pts (no loops or overshoot at uneven spacing)
  function splineLoop(pts, perSeg){
    const n = pts.length, out = [];
    const knot = (a,b) => Math.sqrt(Math.hypot(b[0]-a[0], b[1]-a[1])) || 1e-6;
    const mix = (a,b,ta,tb,t) => { const u=(t-ta)/(tb-ta); return [a[0]+(b[0]-a[0])*u, a[1]+(b[1]-a[1])*u]; };
    for (let i=0;i<n;i++){
      const p0=pts[(i-1+n)%n], p1=pts[i], p2=pts[(i+1)%n], p3=pts[(i+2)%n];
      const t0=0, t1=t0+knot(p0,p1), t2=t1+knot(p1,p2), t3=t2+knot(p2,p3);
      for (let k=0;k<perSeg;k++){
        const t = t1 + (t2-t1)*k/perSeg;
        const a1=mix(p0,p1,t0,t1,t), a2=mix(p1,p2,t1,t2,t), a3=mix(p2,p3,t2,t3,t);
        const b1=mix(a1,a2,t0,t2,t), b2=mix(a2,a3,t1,t3,t);
        out.push(mix(b1,b2,t1,t2,t));
      }
    }
    return out;
  }

  // Resample a closed polyline to (nearly) even spacing
  function resample(dense, step){
    const n = dense.length, pts = [dense[0].slice()];
    let acc = 0;
    for (let i=0;i<n;i++){
      const a = dense[i], b = dense[(i+1)%n];
      const len = Math.hypot(b[0]-a[0], b[1]-a[1]);
      let pos = 0;
      while (acc + (len-pos) >= step){
        pos += step - acc; acc = 0;
        const f = pos/len; pts.push([a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f]);
      }
      acc += len - pos;
    }
    const last = pts[pts.length-1];
    if (Math.hypot(last[0]-pts[0][0], last[1]-pts[0][1]) < step*0.5) pts.pop();
    return pts;
  }

  // Road: evenly spaced centerline samples with tangents, arc length and curvature
  function buildRoad(track){
    const pts = resample(splineLoop(track.waypoints, 32), SAMPLE_STEP);
    const n = pts.length;
    const tan = pts.map((_, i) => {
      const a = pts[(i-1+n)%n], b = pts[(i+1)%n];
      const tx = b[0]-a[0], ty = b[1]-a[1], l = Math.hypot(tx,ty) || 1;
      return [tx/l, ty/l];
    });
    const s = pts.map((_, i) => i*SAMPLE_STEP);
    const L = (n-1)*SAMPLE_STEP + Math.hypot(pts[n-1][0]-pts[0][0], pts[n-1][1]-pts[0][1]);
    // curvature = heading change per px, smoothed over a few samples
    const raw = tan.map((t, i) => {
      const u = tan[(i+1)%n];
      return Math.abs(angNorm(Math.atan2(u[1],u[0]) - Math.atan2(t[1],t[0]))) / SAMPLE_STEP;
    });
    const curv = raw.map((_, i) => { let m=0; for (let k=-3;k<=3;k++) m += raw[(i+k+n)%n]; return m/7; });
    return { pts, tan, s, L, n, half: track.half, curv };
  }

  function nearest(road, x, y, from, win){
    let best = from, bd = Infinity;
    const n = road.n, lo = win == null ? 0 : -win, hi = win == null ? n-1 : win;
    for (let k=lo;k<=hi;k++){
      const i = win == null ? k : (from+k+n)%n;
      const p = road.pts[i], d = (p[0]-x)**2 + (p[1]-y)**2;
      if (d < bd){ bd = d; best = i; }
    }
    return { i: best, d: Math.sqrt(bd) };
  }

  class Car{
    constructor({x,y,a,color,isPlayer=false,ai=false}){
      this.x=x; this.y=y; this.a=a;
      this.speed=0;         // speed along the heading
      this.vx=0; this.vy=0; // actual velocity (the player's can slide sideways)
      this.skid=0;          // 0..1 how hard the tyres are sliding (for skid marks)
      this.color=color; this.isPlayer=isPlayer; this.ai=ai;
      this.idx=0;           // nearest centerline sample
      this.dist=0;          // distance driven along the road since the start line (negative on the grid)
      this.offset=0;        // distance from the centerline
      this.offRoad=false; this.wrongWay=0;
      this.lap=1; this.finished=false; this.time=0;
      this.laneOff=0; this.laneTarget=0; this.laneTimer=0; // AI wander
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

    setTrack(name){ this.trackKey=name; this.track=TRACKS[name]; this.road=buildRoad(this.track); }
    setAI(level){ this.aiLevel=level; this.aiCfg = AI_LEVELS[level]; }

    spawnCars(){
      const R = this.road;
      // 2x2 grid behind the start line: [distance back along road, offset across]. Player starts at the back.
      const slots = [ [22,-10],[22,10],[46,-10],[46,10] ];
      const place = ([back, side]) => {
        const i = (R.n - Math.round(back/SAMPLE_STEP)) % R.n;
        const [px,py] = R.pts[i], [tx,ty] = R.tan[i];
        return { x: px - ty*side, y: py + tx*side, a: Math.atan2(ty, tx) };
      };
      const colors = ['#f43f5e','#60a5fa','#f59e0b'];
      this.cars = colors.map((color,i) => new Car({ ...place(slots[i]), color, ai:true }));
      this.player = new Car({ ...place(slots[3]), color:'#34d399', isPlayer:true });
      this.cars.push(this.player);
      for (const c of this.cars){
        const hit = nearest(R, c.x, c.y, 0, null);
        c.idx = hit.i; c.dist = this.wrap(R.s[hit.i]); c.offset = hit.d;
      }
    }

    restart(){
      this.spawnCars();
      this.countdown = COUNTDOWN; this.lastCount = null;
      this.clock = 0;           // seconds since GO
      this.statusUntil = 0;     // clock time a transient status message clears
      this.finishedOrder = [];
      this.emit('lap', { lap: 1, total: LAPS });
      this.emit('time', 0);
      this.emit('pos', this.placeOf(this.player));
      this.emit('status', '');
      this.emit('reset');
    }

    input(dir){ this.inputDir = dir; }

    // wrap an arc-length difference into [-L/2, L/2)
    wrap(d){ const L = this.road.L; return ((d + L/2) % L + L) % L - L/2; }

    // Move by velocity; the canvas edge acts as a wall that scrubs speed
    move(c, dt, scrub){
      c.x += c.vx*dt; c.y += c.vy*dt;
      const m = 10;
      if (c.x<m || c.x>this.width-m || c.y<m || c.y>this.height-m){
        c.x = Math.max(m, Math.min(this.width-m, c.x));
        c.y = Math.max(m, Math.min(this.height-m, c.y));
        const f = decay(scrub, dt);
        c.speed *= f; c.vx *= f; c.vy *= f;
      }
    }

    // Follow the car along the road. Progress only accrues by driving the road continuously:
    // well off the road the car's place on the road is frozen, and when it rejoins somewhere else
    // a big jump forward earns nothing (a shortcut) while any jump back is always charged.
    trackCar(c, dt){
      const R = this.road, near = R.half + OFF_TRACK;
      const loc = nearest(R, c.x, c.y, c.idx, SEARCH_WIN);
      let i = c.idx, delta = 0, d = loc.d;
      if (loc.d <= near){
        i = loc.i; delta = this.wrap(R.s[i] - R.s[c.idx]);
      } else {
        const g = nearest(R, c.x, c.y, c.idx, null);
        if (g.d <= near){
          i = g.i; d = g.d; delta = this.wrap(R.s[i] - R.s[c.idx]);
          if (delta > MAX_REJOIN){
            delta = 0;
            if (c.isPlayer) this.flash("Shortcut! That section doesn't count", 2);
          }
        }
      }
      c.dist += delta; c.idx = i; c.offset = d;
      c.offRoad = d > R.half;

      // wrong way: moving against the road direction for a moment
      const [tx,ty] = R.tan[i], v = Math.hypot(c.vx, c.vy);
      const along = v > 0 ? (c.vx*tx + c.vy*ty) / v : 0;
      c.wrongWay = (along < -0.3 && v > 20) ? c.wrongWay + dt : 0;

      const lapsDone = Math.floor(c.dist / R.L);
      if (lapsDone >= c.lap){
        c.lap = lapsDone + 1;
        if (c.lap > LAPS) this.finish(c);
        else if (c.isPlayer) this.emit('lap', { lap: c.lap, total: LAPS });
      }
    }

    flash(msg, secs){ this.emit('status', msg); this.statusUntil = this.clock + secs; }

    updatePlayer(dt){
      const p = this.player; if (p.finished) return;
      const C = PLAYER, inp = this.inputDir || {};
      // Split velocity into forward and sideways parts relative to the current heading.
      // Turning rotates the heading only; the velocity catches up as the tyres scrub off the
      // sideways part. Strong grip normally, very little with the handbrake: that's the drift.
      const fx = Math.cos(p.a), fy = Math.sin(p.a);
      let vF = p.vx*fx + p.vy*fy, vS = -p.vx*fy + p.vy*fx;
      if (inp.throttle > 0) vF = Math.min(C.maxSpeed, vF + C.accel*dt);
      else if (inp.throttle < 0) vF = Math.max(-C.maxSpeed*C.reverse, vF - C.brake*dt);
      const hb = !!inp.handbrake && Math.abs(vF) > 30;
      vS *= decay(hb ? C.hbSlip : p.offRoad ? C.grassSlip : C.slip, dt);
      vF *= decay(p.offRoad ? GRASS_DRAG.player : hb ? C.hbDrag : C.friction, dt);
      p.vx = fx*vF - fy*vS; p.vy = fy*vF + fx*vS;
      if (inp.turn){
        // Needs a little speed to steer, steering softens at top speed, reversing flips it
        const s = Math.abs(vF);
        const grip = Math.min(1, s/40) * (1 - 0.3*s/C.maxSpeed);
        p.a += inp.turn * C.turn * grip * (hb ? C.hbTurn : 1) * Math.sign(vF) * dt;
      }
      p.speed = vF;
      p.skid = Math.min(1, Math.max(0, (Math.abs(vS) - 25) / 60) + (hb ? 0.4 : 0));
      this.move(p, dt, 0.7);
      p.time += dt;
      this.trackCar(p, dt);
    }

    // Fastest speed the AI should be doing now so it can still make every corner in the next stretch
    aiSpeedLimit(c, cfg){
      const R = this.road, brake = cfg.accel*1.5;
      let want = cfg.maxSpeed;
      for (let k=0;k<40;k++){
        const j = (c.idx + k) % R.n;
        const corner = 0.9*cfg.turn / Math.max(R.curv[j], 1e-4); // v = turn rate x radius
        want = Math.min(want, Math.sqrt(corner*corner + 2*brake*k*SAMPLE_STEP));
      }
      return Math.max(40, want);
    }

    updateAI(dt){
      const cfg = this.aiCfg, R = this.road, p = this.player;
      for (const c of this.cars){
        if (!c.ai || c.finished) continue;
        // wander smoothly between lanes
        c.laneTimer -= dt;
        if (c.laneTimer <= 0){ c.laneTarget = (Math.random()*2-1)*cfg.lane; c.laneTimer = 1 + Math.random()*1.5; }
        this.avoid(c, R);
        c.laneOff += (c.laneTarget - c.laneOff) * Math.min(1, dt*1.5);
        // steer for a point on the road ahead, further ahead at speed
        const ahead = Math.round((cfg.look + Math.abs(c.speed)*0.2) / SAMPLE_STEP);
        const j = (c.idx + ahead) % R.n;
        const [px,py] = R.pts[j], [tx,ty] = R.tan[j];
        const gx = px - ty*c.laneOff, gy = py + tx*c.laneOff;
        const angDiff = angNorm(Math.atan2(gy-c.y, gx-c.x) - c.a);
        c.a += Math.sign(angDiff) * Math.min(Math.abs(angDiff), cfg.turn*dt);
        // speed for upcoming corners, with gentle catch-up against the player
        let want = this.aiSpeedLimit(c, cfg);
        if (!p.finished){
          const gap = (c.dist - p.dist) / (R.L/2);
          want *= 1 - Math.max(-1, Math.min(1, gap)) * cfg.band;
        }
        if (c.speed < want) c.speed = Math.min(want, c.speed + cfg.accel*dt);
        else c.speed = Math.max(want, c.speed - cfg.accel*1.5*dt);
        c.speed *= decay(c.offRoad ? GRASS_DRAG.ai : 0.992, dt);
        c.vx = Math.cos(c.a)*c.speed; c.vy = Math.sin(c.a)*c.speed;
        this.move(c, dt, 0.8);
        c.time += dt;
        this.trackCar(c, dt);
      }
    }

    // If a car is close ahead in our lane and not pulling away, pick the other side of it
    avoid(c, R){
      const fx = Math.cos(c.a), fy = Math.sin(c.a), room = R.half - 8;
      for (const o of this.cars){
        if (o === c || o.finished) continue;
        const dx = o.x-c.x, dy = o.y-c.y;
        const along = dx*fx + dy*fy, side = -dx*fy + dy*fx;
        if (along > 0 && along < 44 && Math.abs(side) < 14 && o.speed < c.speed + 10){
          c.laneTarget = Math.max(-room, Math.min(room, c.laneOff + (side > 0 ? -16 : 16)));
          c.laneTimer = 0.8;
          return;
        }
      }
    }

    // Cars bump: push overlapping cars apart and trade some speed along the line between them.
    // Finished cars are ghosts so they don't block the line.
    collide(){
      const cars = this.cars.filter(c => !c.finished), minD = CAR_RADIUS*2;
      for (let i=0;i<cars.length;i++) for (let j=i+1;j<cars.length;j++){
        const a = cars[i], b = cars[j];
        const dx = b.x-a.x, dy = b.y-a.y, d = Math.hypot(dx,dy);
        if (d >= minD || d === 0) continue;
        const nx = dx/d, ny = dy/d, push = (minD-d)/2;
        a.x -= nx*push; a.y -= ny*push; b.x += nx*push; b.y += ny*push;
        const closing = (b.vx-a.vx)*nx + (b.vy-a.vy)*ny;
        if (closing < 0){
          const k = -(1 + 0.3) * closing / 2; // equal masses, a little bounce
          a.vx -= k*nx; a.vy -= k*ny; b.vx += k*nx; b.vy += k*ny;
          for (const c of [a,b]) c.speed = c.vx*Math.cos(c.a) + c.vy*Math.sin(c.a);
          if ((a.isPlayer || b.isPlayer) && closing < -15) this.emit('bump', Math.min(1, -closing/120));
        }
      }
    }

    progressOf(car){ return car.dist; }

    standings(){
      const racing = this.cars.filter(c => !c.finished).sort((a,b) => b.dist - a.dist);
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
        if (n !== this.lastCount){
          this.lastCount = n;
          if (n > 0) this.emit('status', String(n)); else this.flash('GO!', 1);
        }
      } else {
        this.clock += dt;
        if (this.statusUntil && this.clock > this.statusUntil){ this.statusUntil = 0; this.emit('status', ''); }
        this.updatePlayer(dt);
        this.updateAI(dt);
        this.collide();
      }
      this.emit('time', this.player.time);
      this.emit('pos', this.placeOf(this.player));
    }
  }

  global.RaceGame = RaceGame;
  global.__RACE_CONST = { TRACKS, AI_LEVELS, LAPS };
})(window);
