// Tiny Utopia UI: minimalist island view with soft sounds
(function(){
  const islandEl = document.getElementById('island');
  const plantsEl = document.getElementById('plants');
  const animalsEl = document.getElementById('animals');
  const waterEl = document.getElementById('water');
  const harmonyEl = document.getElementById('harmony');
  const plantsTr = document.getElementById('plants-tr');
  const animalsTr = document.getElementById('animals-tr');
  const waterTr = document.getElementById('water-tr');
  const harmonyTr = document.getElementById('harmony-tr');
  const statusEl = document.getElementById('status');
  const btnPlant = document.getElementById('btn-plant');
  const btnAnimal = document.getElementById('btn-animal');
  const btnWater = document.getElementById('btn-water');
  const restartBtn = document.getElementById('restart-btn');
  const themeBtn = document.getElementById('theme-btn');
  const soundBtn = document.getElementById('sound-btn');

  let game = null;
  let audio = { ctx:null, master:null, enabled:true };
  let birdsTimer = null;

  init();

  function init(){
    setupTheme();
    setupAudio();
    btnPlant.addEventListener('click', () => { game.addPlant(1); gentlePop(); });
    btnAnimal.addEventListener('click', () => { game.addAnimal(1); gentlePop(280); });
    btnWater.addEventListener('click', () => { game.addWater(8); waterPlip(); });
    restartBtn.addEventListener('click', () => game.reset());
    setupTutorial();
    newGame();
  }

  function newGame(){
    game = new TinyUtopia();
    game.on('update', render);
    render(game.state());
  }

  function render(state){
    const s = state || game.state();
    plantsEl.textContent = String(s.plants.toFixed(0));
    animalsEl.textContent = String(s.animals.toFixed(0));
    waterEl.textContent = String(s.water.toFixed(0));
    harmonyEl.textContent = `${Math.round(s.harmony*100)}%`;
    // Trends
    setTrend(plantsTr, s.dPlants, 0.15);
    setTrend(animalsTr, s.dAnimals, 0.08);
    setTrend(waterTr, s.dWater, 0.4);
    setTrend(harmonyTr, s.dHarmony, 0.01);
    statusEl.textContent = s.harmony > 0.8 ? 'Serene' : s.harmony > 0.6 ? 'Balanced' : s.harmony > 0.4 ? 'Tenuous' : 'Unbalanced';
    drawIsland(s);
    ambienceControl(s);
  }

  function setTrend(el, delta, eps){
    if (!el) return;
    el.classList.remove('up','down');
    if (delta > eps) { el.textContent = '▲'; el.classList.add('up'); }
    else if (delta < -eps) { el.textContent = '▼'; el.classList.add('down'); }
    else { el.textContent = '•'; }
  }

  function drawIsland(s){
    // Clear
    islandEl.innerHTML='';
    // Health tint and gentle bobbing
    islandEl.style.setProperty('--health', String(s.harmony));
    // Sprinkle plants as green dots
    const plantDots = Math.min(40, Math.round(s.plants/3));
    for(let i=0;i<plantDots;i++){
      const d = document.createElement('div');
      d.className = 'sprout';
      const p = randomPointInCircle(44);
      d.style.left = `${50+p.x}%`;
      d.style.top = `${50+p.y}%`;
      islandEl.appendChild(d);
    }
    // Animals as tiny emoji
    const animalDots = Math.min(20, Math.round(s.animals));
    for(let i=0;i<animalDots;i++){
      const a = document.createElement('div');
      a.className = 'animal';
      a.textContent = Math.random()<0.5?'🐑':'🐦';
      const p = randomPointInCircle(40);
      a.style.left = `${50+p.x}%`;
      a.style.top = `${50+p.y}%`;
      islandEl.appendChild(a);
    }
    // Water ring intensity
    islandEl.style.setProperty('--water', String(s.water/100));
  }

  function randomPointInCircle(r){
    const t = Math.random()*2*Math.PI; const u = Math.random()+Math.random();
    const rr = u>1 ? 2-u : u; // triangular distribution
    return { x: Math.cos(t)*rr*(r/100)*100, y: Math.sin(t)*rr*(r/100)*100 };
  }

  // Theme
  function setupTheme(){
    const key = 'memory.theme';
    const saved = localStorage.getItem(key);
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = saved || (prefersLight ? 'light' : 'dark');
    applyTheme(theme);
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next); localStorage.setItem(key, next);
    });
  }
  function applyTheme(theme){
    if (theme === 'light') { document.documentElement.setAttribute('data-theme','light'); themeBtn.setAttribute('aria-pressed','true'); themeBtn.textContent='Dark Theme'; }
    else { document.documentElement.setAttribute('data-theme','dark'); themeBtn.setAttribute('aria-pressed','false'); themeBtn.textContent='Light Theme'; }
  }

  // Audio ambience (soft wind + birds)
  function setupAudio(){
    const en = localStorage.getItem('utopia.audio.enabled');
    audio.enabled = en === null ? true : en === 'true';
    soundBtn.setAttribute('aria-pressed', audio.enabled?'true':'false');
    soundBtn.textContent = audio.enabled?'Sound On':'Sound Off';

    const unlock = () => {
      try{
        if (!audio.ctx) audio.ctx = new (window.AudioContext||window.webkitAudioContext)();
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
        if (!audio.master){ audio.master = audio.ctx.createGain(); audio.master.gain.value = 0.15; audio.master.connect(audio.ctx.destination); }
      }catch{}
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once:true });
    window.addEventListener('keydown', unlock, { once:true });

    soundBtn.addEventListener('click', () => {
      audio.enabled = !audio.enabled;
      soundBtn.setAttribute('aria-pressed', audio.enabled?'true':'false');
      soundBtn.textContent = audio.enabled?'Sound On':'Sound Off';
      localStorage.setItem('utopia.audio.enabled', String(audio.enabled));
      if (audio.ctx && audio.ctx.state==='suspended') audio.ctx.resume();
    });
  }

  // Tutorial
  function setupTutorial(){
    const done = localStorage.getItem('utopia.tutorial.done') === 'true';
    const modal = document.getElementById('modal');
    if (done || !modal) return;
    const title = document.getElementById('modal-title');
    const msg = document.getElementById('modal-message');
    const nextBtn = document.getElementById('modal-next');
    const doneBtn = document.getElementById('modal-done');
    const steps = [
      { t: 'Welcome to Tiny Utopia', m: 'Tap buttons to grow plants, spawn animals, and add water. Keep the island in balance.' },
      { t: 'Watch the meters', m: 'Trend arrows show if values rise or fall. Aim for high Harmony.' },
      { t: 'Relax and nudge', m: 'This is a cozy idle sandbox. Sit back, listen, and nudge occasionally to sustain balance.' }
    ];
    let i = 0;
    const apply = () => { title.textContent = steps[i].t; msg.textContent = steps[i].m; };
    modal.classList.remove('hidden');
    apply();
    nextBtn.addEventListener('click', () => { i = Math.min(steps.length-1, i+1); apply(); });
    doneBtn.addEventListener('click', () => { modal.classList.add('hidden'); localStorage.setItem('utopia.tutorial.done','true'); });
  }

  function gentlePop(freq=340){ if(!audio.enabled||!audio.ctx||!audio.master) return; blip(freq, 0.05, 0.14); }
  function waterPlip(){ if(!audio.enabled||!audio.ctx||!audio.master) return; noisePlip(700, 0.05, 0.08); }

  function ambienceControl(s){
    if (!audio.enabled||!audio.ctx||!audio.master) return;
    softWind(0.08 + s.harmony*0.06);
    if (!birdsTimer) {
      birdsTimer = setInterval(() => { if (Math.random()<0.3 && audio.enabled) birdChirp(); }, 3000);
    }
  }

  function softWind(level){
    // single shared noise node per session
    if (!audio._wind){
      const ctx=audio.ctx; const noise=ctx.createBuffer(1, 2*ctx.sampleRate, ctx.sampleRate); const d=noise.getChannelData(0);
      for(let i=0;i<d.length;i++){ d[i]=(Math.random()*2-1)*0.3; }
      const src=ctx.createBufferSource(); src.buffer=noise; src.loop=true;
      const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=380; bp.Q.value=0.8;
      const g=ctx.createGain(); g.gain.value=0.0;
      src.connect(bp); bp.connect(g); g.connect(audio.master);
      src.start(); audio._wind = { g };
    }
    const now = audio.ctx.currentTime; const g = audio._wind.g.gain;
    g.cancelScheduledValues(now); g.setTargetAtTime(level, now, 0.8);
  }

  function birdChirp(){ blip(1200+Math.random()*400, 0.06, 0.06); }
  function blip(freq, attack, release){
    const ctx=audio.ctx; const o=ctx.createOscillator(); const g=ctx.createGain();
    o.type='sine'; o.frequency.value=freq; g.gain.value=0; o.connect(g); g.connect(audio.master);
    const t=ctx.currentTime+0.002; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.12,t+attack); g.gain.exponentialRampToValueAtTime(0.0001,t+attack+release); o.start(t); o.stop(t+attack+release+0.05);
  }
  function noisePlip(freq, attack, release){
    const ctx=audio.ctx; const noise=ctx.createBuffer(1,1024,ctx.sampleRate); const d=noise.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1);
    const s=ctx.createBufferSource(); s.buffer=noise; const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freq; bp.Q.value=8; const g=ctx.createGain(); g.gain.value=0; s.connect(bp); bp.connect(g); g.connect(audio.master);
    const t=ctx.currentTime+0.002; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.12,t+attack); g.gain.exponentialRampToValueAtTime(0.0001,t+attack+release); s.start(t); s.stop(t+attack+release+0.05);
  }
})();
