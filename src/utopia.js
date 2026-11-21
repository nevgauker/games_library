// Tiny Utopia: minimalist idle ecosystem engine
(function(global){
  // All tuning lives here so the simulation, Harmony score and UI share one set of rules.
  const CFG = {
    tickMs: 1000,
    start: { plants: 20, animals: 5, water: 55, seeds: 15 },
    maxPlants: 200,
    maxAnimals: 60,
    maxTrees: 12,
    maxFoxes: 8,
    // Player actions: amount added and Seeds cost
    actions: {
      plant:  { amount: 5,  cost: 3 },
      animal: { amount: 1,  cost: 5 },
      water:  { amount: 10, cost: 2 },
      tree:   { amount: 1,  cost: 8 },
      fox:    { amount: 1,  cost: 10 },
    },
    // Seeds: a calm island earns more
    seedBase: 0.05,
    seedPerHarmony: 0.2,
    maxSeeds: 60,
    // Plants: logistic growth, scaled by water
    plantSeed: 0.2,
    plantRate: 0.12,
    plantCap: 70,
    // Grazers
    eatRate: 0.3,
    eatHalfSat: 6,
    foodPerAnimal: 3,
    birthRate: 0.03,
    deathRate: 0.06,
    animalCap: 16,
    visitorChance: 0.02,
    // Trees pull water back toward the middle, and wither in hard drought
    treeBuffer: 0.006,
    treeWitherChance: 0.01,
    // Foxes hunt grazers
    foxHunt: 0.06,
    foxHalfSat: 4,
    preyPerFox: 4,
    foxBirth: 0.02,
    foxDeath: 0.03,
    // Water
    evapBase: 0.35,
    evapPerPlant: 0.006,
    rainChance: 0.065,
    rainMin: 4,
    rainMax: 9,
    // Harmony targets
    idealPlants: [10, 50],
    idealAnimals: [3, 15],
    idealWater: 50,
    diversityBonus: 0.04,
    // Events
    eventGap: [60, 120],
    offlineMaxTicks: 600,
  };

  const EVENTS = {
    drought:   { name: 'Drought',         icon: '☀️', duration: 30, text: 'No rain and fierce sun — water dries up fast.', mods: { rain: 0, evap: 1.6 } },
    rainy:     { name: 'Rainy season',    icon: '🌧️', duration: 25, text: 'Frequent rain. Watch for flooding.',            mods: { rain: 4 } },
    bloom:     { name: 'Bloom',           icon: '🌸', duration: 30, text: 'Plants grow faster for a while.',               mods: { growth: 1.6 } },
    migration: { name: 'Migrating birds', icon: '🐦', duration: 0,  text: 'A flock settles on the island.' },
    wolf:      { name: 'Wolf passes',     icon: '🐺', duration: 0,  text: 'A wolf swims by and scatters the herd.' },
  };
  const WEATHER = ['drought', 'rainy', 'bloom'];

  const GOALS = [
    { id: 'reach75', text: 'Reach 75% Harmony', reward: { seeds: 10 }, note: 'The weather starts to change.' },
    { id: 'hold70',  text: 'Keep Harmony above 70% for 30 s', hold: 30, reward: { seeds: 5, unlock: 'tree' }, note: 'Trees unlocked — they steady the water level.' },
    { id: 'trees3',  text: 'Plant 3 trees', reward: { seeds: 15 } },
    { id: 'weather', text: 'Weather a drought, rainy season or bloom with Harmony above 50%', reward: { unlock: 'fox' }, note: 'Foxes unlocked — they keep the herd in check.' },
    { id: 'foxes',   text: 'Keep 2+ foxes and 8+ animals for 60 s', hold: 60, reward: { seeds: 20 } },
    { id: 'serene',  text: 'Stay Serene (80%+) for 2 minutes', hold: 120, reward: { seeds: 30 }, note: 'Your island is a true utopia.' },
  ];

  const HINTS = {
    good: 'All is calm. Enjoy the view 🌿',
    dry: 'The soil is dry — add water 💧',
    wet: 'The island is waterlogged — let it dry out.',
    sparse: 'The meadow is thin — grow plants 🌱',
    overgrown: 'Plants are running wild — more grazers would help 🐑',
    quiet: 'The meadow is quiet — spawn an animal 🐑',
    crowded: 'Too many animals for the island.',
    hungry: 'Animals are hungry — grow plants 🌱',
    'foxes-hungry': 'The foxes are short of prey.',
  };

  class TinyUtopia {
    constructor(save) {
      this._listeners = new Map();
      this.tickMs = CFG.tickMs;
      this._paused = false;
      this.reset();
      if (save) this.load(save);
    }

    reset() {
      this.time = 0;
      this.plants = CFG.start.plants;
      this.animals = CFG.start.animals;
      this.water = CFG.start.water;
      this.trees = 0;
      this.foxes = 0;
      this.seeds = CFG.start.seeds;
      this.unlocked = { tree: false, fox: false };
      this.goalIndex = 0;
      this.goalHold = 0;
      this.weatherPassed = false;
      this.event = null;          // { id, remaining, minHarmony }
      this.eventsOn = false;
      this.nextEventIn = 0;
      this.forcedEvent = null;
      this.sereneStreak = 0;
      this.bestSerene = 0;
      this.health = this.harmony();
      this._prev = this._snapshot();
      this._startTimer();
      this.emit('reset', this.state(true));
      this.emit('update', this.state(true));
    }

    // ---- lifecycle ----
    pause(){ if (this._paused) return; this._paused = true; this._stopTimer(); this.emit('update', this.state()); }
    resume(){ if (!this._paused) return; this._paused = false; this._startTimer(); this.emit('update', this.state()); }
    get paused(){ return this._paused; }
    destroy(){ this._stopTimer(); this._listeners.clear(); }
    _startTimer(){ this._stopTimer(); if (!this._paused) this._timer = setInterval(() => this._tick(), this.tickMs); }
    _stopTimer(){ if (this._timer) { clearInterval(this._timer); this._timer = null; } }

    on(ev, fn){ const a=this._listeners.get(ev)||[]; a.push(fn); this._listeners.set(ev,a); return ()=>this.off(ev,fn); }
    off(ev, fn){ const a=this._listeners.get(ev)||[]; const i=a.indexOf(fn); if(i>=0) a.splice(i,1); }
    emit(ev, payload){ if (this._silent) return; const a=this._listeners.get(ev)||[]; a.forEach(f=>f(payload)); }

    // ---- player actions ----
    canBuy(kind){
      const act = CFG.actions[kind];
      if (!act) return { ok:false, reason:'unknown' };
      if ((kind === 'tree' || kind === 'fox') && !this.unlocked[kind]) return { ok:false, reason:'locked' };
      const full = { plant: this.plants >= CFG.maxPlants, animal: this.animals >= CFG.maxAnimals, water: this.water >= 100,
                     tree: this.trees >= CFG.maxTrees, fox: this.foxes >= CFG.maxFoxes }[kind];
      if (full) return { ok:false, reason:'full' };
      if (this.seeds < act.cost) return { ok:false, reason:'seeds', need: act.cost - this.seeds };
      return { ok:true };
    }
    buy(kind){
      const check = this.canBuy(kind);
      if (!check.ok) return check;
      const act = CFG.actions[kind];
      this.seeds -= act.cost;
      this._add(kind, act.amount);
      this._checkGoal(0);
      this.emit('update', this.state());
      return { ok:true, amount: act.amount, cost: act.cost };
    }
    _add(kind, n){
      if (kind === 'plant') this.plants = clamp(this.plants + n, 0, CFG.maxPlants);
      else if (kind === 'animal') this.animals = clamp(this.animals + n, 0, CFG.maxAnimals);
      else if (kind === 'water') this.water = clamp(this.water + n, 0, 100);
      else if (kind === 'tree') this.trees = clamp(this.trees + n, 0, CFG.maxTrees);
      else if (kind === 'fox') this.foxes = clamp(this.foxes + n, 0, CFG.maxFoxes);
    }
    // Free additions, used by tests and tools
    addPlant(n=CFG.actions.plant.amount){ this._add('plant', n); this.emit('update', this.state()); }
    addAnimal(n=CFG.actions.animal.amount){ this._add('animal', n); this.emit('update', this.state()); }
    addWater(n=CFG.actions.water.amount){ this._add('water', n); this.emit('update', this.state()); }

    // ---- reading state ----
    _snapshot(){ return { plants: this.plants, animals: this.animals, water: this.water, harmony: this.health, seeds: this.seeds }; }

    state(initial=false){
      const h = this.harmony();
      const deltas = initial ? { dPlants:0, dAnimals:0, dWater:0, dHarmony:0, dSeeds:0 } : {
        dPlants: this.plants - this._prev.plants,
        dAnimals: this.animals - this._prev.animals,
        dWater: this.water - this._prev.water,
        dHarmony: h - this._prev.harmony,
        dSeeds: this.seeds - this._prev.seeds,
      };
      const goal = GOALS[this.goalIndex];
      return {
        time: this.time, plants: this.plants, animals: this.animals, water: this.water,
        trees: this.trees, foxes: this.foxes, seeds: this.seeds, harmony: h, paused: this._paused,
        unlocked: { ...this.unlocked },
        goal: goal ? { index: this.goalIndex, total: GOALS.length, text: goal.text, progress: this.goalProgress(), detail: this.goalDetail() }
                   : { index: GOALS.length, total: GOALS.length, done: true, progress: 1 },
        event: this.event ? { id: this.event.id, ...EVENTS[this.event.id], remaining: this.event.remaining } : null,
        hint: this.diagnose(),
        bestSerene: this.bestSerene, sereneStreak: this.sereneStreak,
        ...deltas,
      };
    }

    factors(){
      const p = this.plants, a = this.animals, w = this.water;
      return {
        plants: sigmoidRange(p, CFG.idealPlants[0], CFG.idealPlants[1]),
        animals: sigmoidRange(a, CFG.idealAnimals[0], CFG.idealAnimals[1]),
        water: Math.max(0, 1 - Math.abs(w - CFG.idealWater) / 50),
        food: Math.min(1, foodRatio(p, a)),
      };
    }

    harmony(){
      const f = this.factors();
      let score = f.plants*0.35 + f.animals*0.25 + f.water*0.2 + f.food*0.2;
      // Variety helps: a few trees, and foxes that are not starving
      if (this.trees >= 1) score += CFG.diversityBonus;
      if (this.foxes >= 0.5 && this.animals >= CFG.preyPerFox * this.foxes) score += CFG.diversityBonus;
      return clamp(score, 0, 1);
    }

    // The range where each meter reads as healthy (its factor is at least 0.6)
    zones(){
      const t = Math.atanh(0.4);
      const band = ([lo, hi]) => { const mid=(lo+hi)/2, span=(hi-lo)/2; return [mid - t*span, mid + t*span]; };
      return { plants: band(CFG.idealPlants), animals: band(CFG.idealAnimals), water: [CFG.idealWater - 20, CFG.idealWater + 20] };
    }

    // The single most useful thing to tell the player right now
    diagnose(){
      // Only flag a meter once it leaves its green zone, so the hint agrees with what the player sees.
      const f = this.factors();
      const z = this.zones();
      const outside = (v, [lo, hi]) => v < lo || v > hi;
      const mid = (r) => (r[0] + r[1]) / 2;
      const issues = [];
      if (outside(this.water, z.water)) issues.push({ id: this.water < CFG.idealWater ? 'dry' : 'wet', weight: 0.2 * (1 - f.water) });
      if (outside(this.plants, z.plants)) issues.push({ id: this.plants < mid(CFG.idealPlants) ? 'sparse' : 'overgrown', weight: 0.35 * (1 - f.plants) });
      if (outside(this.animals, z.animals)) issues.push({ id: this.animals < mid(CFG.idealAnimals) ? 'quiet' : 'crowded', weight: 0.25 * (1 - f.animals) });
      if (f.food < 0.85) issues.push({ id: 'hungry', weight: 0.2 * (1 - f.food) * 1.5 + 0.1 }); // starving animals is the most urgent
      if (this.foxes >= 0.5 && this.animals < CFG.preyPerFox * this.foxes) issues.push({ id: 'foxes-hungry', weight: 0.06 });
      if (!issues.length) return { id: 'good', text: HINTS.good };
      issues.sort((x, y) => y.weight - x.weight);
      const top = issues[0];
      let text = HINTS[top.id];
      if (top.id === 'crowded' && this.unlocked.fox) text += ' A fox or two would help 🦊';
      if (top.id === 'wet' && this.unlocked.tree) text += ' Trees soak up the excess 🌳';
      if (top.id === 'dry' && this.unlocked.tree && this.trees < 3) text += ' Trees help hold water 🌳';
      return { id: top.id, text };
    }

    goalProgress(){
      const g = GOALS[this.goalIndex]; if (!g) return 1;
      if (g.hold) return clamp(this.goalHold / g.hold, 0, 1);
      if (g.id === 'reach75') return clamp(this.health / 0.75, 0, 1);
      if (g.id === 'trees3') return clamp(this.trees / 3, 0, 1);
      if (g.id === 'weather') return this._weatherActive() ? 1 - this.event.remaining / EVENTS[this.event.id].duration : 0;
      return 0;
    }
    goalDetail(){
      const g = GOALS[this.goalIndex]; if (!g) return '';
      if (g.hold) return `${Math.floor(this.goalHold)} / ${g.hold} s`;
      if (g.id === 'reach75') return `${Math.round(this.health*100)}%`;
      if (g.id === 'trees3') return `${Math.floor(this.trees)} / 3`;
      if (g.id === 'weather') {
        if (!this._weatherActive()) return 'Waiting for the weather to turn…';
        return this.event.minHarmony >= 0.5 ? `${Math.ceil(this.event.remaining)} s left — keep Harmony above 50%`
                                            : 'Harmony dipped below 50% — try the next one';
      }
      return '';
    }
    _weatherActive(){ return !!this.event && WEATHER.includes(this.event.id); }

    _checkGoal(dt){
      // Goals only progress while someone is watching, not during the away catch-up.
      const g = GOALS[this.goalIndex]; if (!g || this._offline) return;
      const h = this.health = this.harmony();
      let done = false;
      if (g.id === 'reach75') done = h >= 0.75;
      else if (g.id === 'hold70') { this.goalHold = h > 0.7 ? this.goalHold + dt : 0; done = this.goalHold >= g.hold; }
      else if (g.id === 'trees3') done = this.trees >= 3;
      else if (g.id === 'weather') done = this.weatherPassed;
      else if (g.id === 'foxes') { this.goalHold = (this.foxes >= 2 && this.animals >= 8) ? this.goalHold + dt : 0; done = this.goalHold >= g.hold; }
      else if (g.id === 'serene') { this.goalHold = h >= 0.8 ? this.goalHold + dt : 0; done = this.goalHold >= g.hold; }
      if (!done) return;

      this.goalIndex += 1;
      this.goalHold = 0;
      this.weatherPassed = false;
      if (g.reward.seeds) this.seeds = Math.min(CFG.maxSeeds, this.seeds + g.reward.seeds);
      if (g.reward.unlock) this.unlocked[g.reward.unlock] = true;
      if (g.id === 'reach75') { this.eventsOn = true; this.nextEventIn = randRange(...CFG.eventGap); }
      if (g.id === 'trees3') { this.forcedEvent = 'drought'; this.nextEventIn = Math.min(this.nextEventIn, 15); }
      this.emit('goal', { goal: g, next: GOALS[this.goalIndex] || null });
    }

    // ---- events ----
    _startEvent(id){
      const def = EVENTS[id];
      if (id === 'migration') this._add('animal', 3);
      if (id === 'wolf') this.animals = Math.max(1, this.animals * 0.7);
      this.event = def.duration ? { id, remaining: def.duration, minHarmony: this.health } : null;
      this.emit('event', { phase: 'start', id, ...def });
    }
    _endEvent(){
      const e = this.event; this.event = null;
      const survived = e.minHarmony >= 0.5;
      if (WEATHER.includes(e.id) && survived) this.weatherPassed = true;
      // A failed attempt at the weather goal comes round again sooner
      if (GOALS[this.goalIndex]?.id === 'weather' && !survived) this.nextEventIn = Math.min(this.nextEventIn, 30);
      this.emit('event', { phase: 'end', id: e.id, ...EVENTS[e.id], survived });
    }
    _pickEvent(){
      if (this.forcedEvent) { const id = this.forcedEvent; this.forcedEvent = null; return id; }
      const pool = ['drought', 'drought', 'rainy', 'rainy', 'bloom', 'bloom', 'migration', 'wolf'];
      if (this.animals < 6) pool.pop();
      if (GOALS[this.goalIndex]?.id === 'weather') return WEATHER[Math.floor(Math.random() * WEATHER.length)];
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // ---- simulation ----
    _tick(){
      this.time += 1;
      const p = this.plants, a = this.animals, w = this.water, f = this.foxes;
      const mods = this.event ? (EVENTS[this.event.id].mods || {}) : {};

      // Plants grow best around half water; drought and flooding both slow them.
      const wf = w <= 50 ? w / 50 : 1 - (w - 50) / 100;
      const growth = (CFG.plantSeed + CFG.plantRate * p * (1 - p / CFG.plantCap)) * wf * (mods.growth || 1);
      const grazing = a * CFG.eatRate * p / (p + CFG.eatHalfSat);
      this.plants = clamp(p + growth - grazing, 0, CFG.maxPlants);

      // Grazers breed when well fed and starve when not (same rule Harmony uses).
      const fed = Math.min(1, foodRatio(p, a));
      const crowd = Math.max(0, 1 - a / CFG.animalCap);
      const hunted = f * CFG.foxHunt * a / (a + CFG.foxHalfSat);
      let animals = a + a * (CFG.birthRate * fed * crowd - CFG.deathRate * (1 - fed)) - hunted;
      if (animals < 0.5 && this.plants > 10 && Math.random() < CFG.visitorChance) animals = 1;
      this.animals = clamp(animals, 0, CFG.maxAnimals);

      // Foxes thrive with enough prey and dwindle without it.
      if (f > 0) {
        const foxFed = Math.min(1, a / (CFG.preyPerFox * f));
        const foxCrowd = Math.max(0, 1 - f / CFG.maxFoxes);
        this.foxes = clamp(f + f * (CFG.foxBirth * foxFed * foxCrowd - CFG.foxDeath * (1 - foxFed)), 0, CFG.maxFoxes);
        if (this.foxes < 0.3) this.foxes = 0;
      }

      // Water: evaporation and rain, with trees nudging it back toward the middle.
      const evap = (CFG.evapBase + CFG.evapPerPlant * p) * (mods.evap || 1);
      const rainChance = CFG.rainChance * (mods.rain ?? 1);
      const rain = Math.random() < rainChance ? CFG.rainMin + Math.random() * (CFG.rainMax - CFG.rainMin) : 0;
      const buffer = (CFG.idealWater - w) * CFG.treeBuffer * this.trees;
      this.water = clamp(w - evap + rain + buffer, 0, 100);
      if (this.water < 10 && this.trees >= 1 && Math.random() < CFG.treeWitherChance * this.trees) {
        this.trees -= 1;
        this.emit('wither', {});
      }

      // Seeds and streaks
      this.health = this.harmony();
      this.seeds = Math.min(CFG.maxSeeds, this.seeds + CFG.seedBase + CFG.seedPerHarmony * this.health);
      this.sereneStreak = this.health >= 0.8 ? this.sereneStreak + 1 : 0;
      this.bestSerene = Math.max(this.bestSerene, this.sereneStreak);

      // Events
      if (this.event) {
        this.event.minHarmony = Math.min(this.event.minHarmony, this.health);
        this.event.remaining -= 1;
        if (this.event.remaining <= 0) this._endEvent();
      } else if (this.eventsOn && !this._offline) {
        this.nextEventIn -= 1;
        if (this.nextEventIn <= 0) { this._startEvent(this._pickEvent()); this.nextEventIn = randRange(...CFG.eventGap); }
      }

      this._checkGoal(1);
      this.emit('update', this.state());
      this._prev = this._snapshot();
      if (rain > 0) this.emit('rain', rain);
    }

    // ---- saving ----
    toJSON(){
      const keys = ['time','plants','animals','water','trees','foxes','seeds','unlocked','goalIndex','goalHold','weatherPassed',
                    'event','eventsOn','nextEventIn','forcedEvent','sereneStreak','bestSerene'];
      const out = { v: 1, savedAt: Date.now() };
      keys.forEach(k => { out[k] = this[k]; });
      return out;
    }
    load(save){
      if (!save || save.v !== 1) return false;
      const num = (k, lo, hi) => { if (Number.isFinite(save[k])) this[k] = clamp(save[k], lo, hi); };
      num('time', 0, Infinity); num('plants', 0, CFG.maxPlants); num('animals', 0, CFG.maxAnimals); num('water', 0, 100);
      num('trees', 0, CFG.maxTrees); num('foxes', 0, CFG.maxFoxes); num('seeds', 0, CFG.maxSeeds);
      num('goalIndex', 0, GOALS.length); num('goalHold', 0, Infinity); num('nextEventIn', 0, Infinity);
      num('sereneStreak', 0, Infinity); num('bestSerene', 0, Infinity);
      this.unlocked = { tree: !!save.unlocked?.tree, fox: !!save.unlocked?.fox };
      this.weatherPassed = !!save.weatherPassed;
      this.eventsOn = !!save.eventsOn;
      this.forcedEvent = EVENTS[save.forcedEvent] ? save.forcedEvent : null;
      this.event = save.event && EVENTS[save.event.id] ? { ...save.event } : null;
      this.health = this.harmony();
      this._prev = this._snapshot();
      this.emit('reset', this.state(true));
      this.emit('update', this.state(true));
      return true;
    }
    // Simulate time spent away (quietly, without new events), capped so nothing spirals too far.
    catchUp(seconds){
      const snap = () => ({ plants: this.plants, animals: this.animals, water: this.water, trees: this.trees, foxes: this.foxes, seeds: this.seeds, harmony: this.harmony() });
      const before = snap();
      const ticks = Math.min(CFG.offlineMaxTicks, Math.max(0, Math.floor(seconds)));
      this._silent = true; this._offline = true;
      for (let i = 0; i < ticks; i++) this._tick();
      this._silent = false; this._offline = false;
      this._prev = this._snapshot();
      this.emit('reset', this.state(true));
      this.emit('update', this.state(true));
      return { seconds, ticks, before, after: snap() };
    }
  }

  function foodRatio(p, a){ return a <= 0 ? (p > 0 ? 1 : 0) : p / (CFG.foodPerAnimal * a + 1); }
  function sigmoidRange(x, lo, hi){
    // Bell-ish curve: 1 at the middle of [lo, hi], falling off smoothly outside.
    const mid = (lo+hi)/2; const span = (hi-lo)/2;
    if (span <= 0) return 0;
    const t = (x - mid)/span;
    const s = 1/(1+Math.exp(-t*2));
    return 1 - Math.abs(2*s-1);
  }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function randRange(lo, hi){ return lo + Math.random() * (hi - lo); }

  TinyUtopia.CFG = CFG;
  TinyUtopia.EVENTS = EVENTS;
  TinyUtopia.GOALS = GOALS;
  global.TinyUtopia = TinyUtopia;
})(window);
