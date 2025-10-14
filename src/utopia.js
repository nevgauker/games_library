// Tiny Utopia: minimalist idle ecosystem engine
(function(global){
  class TinyUtopia {
    constructor() {
      this._listeners = new Map();
      this.tickMs = 1000;
      this.reset();
    }

    reset() {
      this.time = 0;
      this.plants = 10;
      this.animals = 4;
      this.water = 50; // 0..100
      this.health = 1; // 0..1
      this._prev = { plants: this.plants, animals: this.animals, water: this.water, harmony: this.health };
      this._timer && clearInterval(this._timer);
      this._timer = setInterval(() => this._tick(), this.tickMs);
      this.emit('update', this.state(true));
    }

    on(ev, fn){ const a=this._listeners.get(ev)||[]; a.push(fn); this._listeners.set(ev,a); return ()=>this.off(ev,fn); }
    off(ev, fn){ const a=this._listeners.get(ev)||[]; const i=a.indexOf(fn); if(i>=0) a.splice(i,1); }
    emit(ev, payload){ const a=this._listeners.get(ev)||[]; a.forEach(f=>f(payload)); }

    addPlant(n=1){ this.plants = Math.min(200, this.plants + n); this.emit('update', this.state()); }
    addAnimal(n=1){ this.animals = Math.min(100, this.animals + n); this.emit('update', this.state()); }
    addWater(n=6){ this.water = clamp(this.water + n, 0, 100); this.emit('update', this.state()); }

    state(initial=false){
      const h = this.harmony();
      const deltas = initial ? { dPlants:0, dAnimals:0, dWater:0, dHarmony:0 } : {
        dPlants: this.plants - this._prev.plants,
        dAnimals: this.animals - this._prev.animals,
        dWater: this.water - this._prev.water,
        dHarmony: h - this._prev.harmony,
      };
      return { time:this.time, plants:this.plants, animals:this.animals, water:this.water, harmony:h, ...deltas };
    }

    harmony(){
      // Score plants/animals balance and water in mid-range
      const p = this.plants, a = this.animals, w = this.water;
      const plantOk = sigmoidRange(p, 10, 50); // best 10..50
      const animalOk = sigmoidRange(a, 3, 15); // best 3..15
      const waterOk = 1 - Math.abs(w - 50) / 50; // best near 50
      const foodOk = p > 0 ? Math.min(1, p / (a * 4 + 1)) : 0; // enough plants per animal
      const score = (plantOk*0.35 + animalOk*0.25 + waterOk*0.2 + foodOk*0.2);
      return clamp(score, 0, 1);
    }

    _tick(){
      // rates influenced by balance
      this.time += 1;
      const p = this.plants, a = this.animals, w = this.water;
      const waterFactor = clamp((w/50), 0, 2); // <50 slows plants
      const plantGrowth = Math.max(0, 0.8 * waterFactor * Math.exp(-p/140));
      const grazing = Math.min(p, a * 0.45); // animals eat plants
      const plantDelta = plantGrowth - (grazing * 0.5);
      this.plants = clamp(p + plantDelta, 0, 300);

      const foodRatio = p > 0 ? p/(a*5+1) : 0;
      const birth = a > 0 ? 0.16 * Math.min(1, foodRatio) : 0;
      const death = a > 0 ? 0.12 * (1 - Math.min(1, foodRatio)) : 0;
      const animalDelta = birth - death;
      this.animals = clamp(a + animalDelta, 0, 150);

      const evap = 0.5; // per tick evaporation (gentler)
      const rain = Math.random() < 0.08 ? (4 + Math.random()*6) : 0; // a bit more frequent
      this.water = clamp(w - evap + rain, 0, 100);

      // small stochasticity to feel alive
      if (Math.random() < 0.015 && this.plants > 1) this.plants -= 1;
      if (Math.random() < 0.015) this.plants += 1;

      const hPrev = this.health;
      this.health = this.harmony();
      // update prevs for next delta calc
      this._prev = { plants: this.plants, animals: this.animals, water: this.water, harmony: this.health };
      this.emit('update', this.state());
    }
  }

  function sigmoidRange(x, lo, hi){
    // 0 below lo, 1 near mid, 0 above hi (smoothly)
    const mid = (lo+hi)/2; const span = (hi-lo)/2;
    if (span <= 0) return 0;
    const t = (x - mid)/span;
    const s = 1/(1+Math.exp(-t*2)); // 0..1
    // bell-ish curve centered at mid
    return 1 - Math.abs(2*s-1);
  }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  global.TinyUtopia = TinyUtopia;
})(window);
