// Tiny Utopia UI: island view, meters, goals and soft sounds
(function(){
  const $ = (id) => document.getElementById(id);
  const islandEl = $('island');
  const els = {
    harmony: $('harmony'), harmonyTr: $('harmony-tr'), harmonyFill: $('harmony-fill'), status: $('status'),
    plants: $('plants'), plantsTr: $('plants-tr'),
    animals: $('animals'), animalsTr: $('animals-tr'),
    water: $('water'), waterTr: $('water-tr'),
    seeds: $('seeds'), seedsChip: document.querySelector('.seeds-chip'),
    trees: $('trees'), treesChip: $('trees-chip'), foxes: $('foxes'), foxesChip: $('foxes-chip'),
    hint: $('hint'),
    goal: $('goal'), goalLabel: $('goal-label'), goalText: $('goal-text'), goalDetail: $('goal-detail'), goalFill: $('goal-fill'),
    banner: $('event-banner'), pausedOverlay: $('paused-overlay'), toasts: $('toasts'),
    pauseBtn: $('pause-btn'), helpBtn: $('help-btn'), restartBtn: $('restart-btn'), themeBtn: $('theme-btn'), soundBtn: $('sound-btn'),
    modal: $('modal'), modalTitle: $('modal-title'), modalMsg: $('modal-message'), modalNext: $('modal-next'), modalDone: $('modal-done'),
  };
  const actionBtns = [...document.querySelectorAll('.ut-action')];
  const meters = {
    plants: { el: $('meter-plants'), max: 80 },
    animals: { el: $('meter-animals'), max: 24 },
    water: { el: $('meter-water'), max: 100 },
  };

  const CFG = TinyUtopia.CFG;
  const SAVE_KEY = 'utopia.save.v1';
  const TUTORIAL_KEY = 'utopia.tutorial.done';
  const KEYS = { '1': 'plant', '2': 'animal', '3': 'water', '4': 'tree', '5': 'fox' };
  const ICONS = { plant: '🌱', animal: '🐑', water: '💧', tree: '🌳', fox: '🦊' };
  const LAND_R = 36;                         // sprites stay within this radius (% of island)
  const POND = { x: -14, y: -10, rx: 12, ry: 9 };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let game = null;
  let audio = { ctx:null, master:null, enabled:true };
  let birdsTimer = null;
  const sprites = { plants: [], animals: [], trees: [], foxes: [] };
  let spawnFocus = null;                     // where the next sprites of a kind should appear
  const pauseReasons = new Set();            // the game runs only when nothing asks it to pause
  let lastWanderTime = -1;
  let lastHintId = '';
  let bannerTimer = null;
  let rainTimer = null;
  let lastShortToast = 0;
  let modalState = null;

  init();

  function init(){
    setupTheme();
    setupAudio();
    actionBtns.forEach(btn => {
      const kind = btn.dataset.kind;
      btn.querySelector('.ut-cost').textContent = `${CFG.actions[kind].cost} ✨`;
      btn.addEventListener('click', () => act(kind));
    });
    els.restartBtn.addEventListener('click', () => {
      if (!confirm('Start a new island? Your progress and goals will reset.')) return;
      try { localStorage.removeItem(SAVE_KEY); } catch {}
      game.reset();
      toast('🏝️ A fresh island rises from the sea.');
    });
    els.pauseBtn.addEventListener('click', () => setPaused('user', !pauseReasons.has('user')));
    els.helpBtn.addEventListener('click', () => showTutorial());
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', () => {
      setPaused('hidden', document.hidden);
      if (document.hidden) save();
    });
    window.addEventListener('pagehide', save);
    setupMeters();
    startGame();
  }

  function startGame(){
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch {}
    game = new TinyUtopia();
    game.on('reset', clearSprites);
    game.on('update', render);
    game.on('goal', onGoal);
    game.on('event', onEvent);
    game.on('rain', onRain);
    game.on('wither', () => toast('🍂 A tree withered in the dry spell.'));
    const loaded = saved && game.load(saved);
    render(game.state(true));

    if (!localStorage.getItem(TUTORIAL_KEY)) { showTutorial(); return; }
    if (loaded && saved.savedAt) {
      const away = (Date.now() - saved.savedAt) / 1000;
      if (away > 60) showAwaySummary(game.catchUp(away));
    }
  }

  function save(){
    if (!game) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.toJSON())); } catch {}
  }

  function setPaused(reason, on){
    if (on) pauseReasons.add(reason); else pauseReasons.delete(reason);
    if (!game) return;
    if (pauseReasons.size) game.pause(); else game.resume();
    const userPaused = pauseReasons.has('user');
    els.pauseBtn.textContent = userPaused ? 'Resume' : 'Pause';
    els.pauseBtn.setAttribute('aria-pressed', String(userPaused));
    els.pausedOverlay.classList.toggle('hidden', !userPaused);
    if (audio.ctx) {
      if (pauseReasons.has('hidden')) audio.ctx.suspend().catch(()=>{});
      else if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(()=>{});
    }
    if (userPaused || pauseReasons.has('hidden')) setWind(0);
  }

  function onKey(e){
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!els.modal.classList.contains('hidden')) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (KEYS[e.key]) { e.preventDefault(); act(KEYS[e.key]); }
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setPaused('user', !pauseReasons.has('user')); }
  }

  // ---- Actions ----
  function act(kind){
    if (pauseReasons.has('user')) setPaused('user', false);
    const check = game.canBuy(kind);
    if (!check.ok) {
      if (check.reason === 'seeds') {
        bump(els.seedsChip, 'short');
        const now = Date.now();
        if (now - lastShortToast > 2500) { lastShortToast = now; toast(`Need ${Math.ceil(check.need)} more ✨ — Seeds grow faster when Harmony is high.`); }
      } else if (check.reason === 'full') toast(`The island can't hold more ${ICONS[kind]}`);
      return;
    }
    const point = kind === 'water' ? { x: POND.x, y: POND.y } : randomLandPoint();
    spawnFocus = { kind, x: point.x, y: point.y, left: kind === 'plant' ? 3 : 1 };
    const res = game.buy(kind);
    spawnFocus = null;
    if (!res.ok) return;
    floatText(point, `+${res.amount} ${ICONS[kind]}`);
    bump(els.seedsChip, 'spent');
    if (kind === 'water') waterPlip(); else gentlePop(kind === 'animal' ? 280 : kind === 'fox' ? 220 : kind === 'tree' ? 260 : 340);
  }

  // ---- Rendering ----
  function setupMeters(){
    const zones = TinyUtopia.prototype.zones(); // depends only on the shared CFG
    Object.entries(meters).forEach(([key, m]) => {
      const [lo, hi] = zones[key];
      m.zone = [lo, hi];
      const z = m.el.querySelector('.ut-zone');
      z.style.left = `${pct(lo, m.max)}%`;
      z.style.width = `${pct(hi, m.max) - pct(lo, m.max)}%`;
    });
  }

  function render(state){
    const s = state || game.state();
    const status = s.harmony > 0.8 ? 'Serene' : s.harmony > 0.6 ? 'Balanced' : s.harmony > 0.4 ? 'Tenuous' : 'Unbalanced';
    const statusCls = status.toLowerCase();

    els.harmony.textContent = `${Math.round(s.harmony*100)}%`;
    els.status.textContent = status;
    els.status.className = `ut-status ${statusCls}`;
    els.harmonyFill.style.width = `${Math.round(s.harmony*100)}%`;
    els.harmonyFill.className = `ut-fill ${statusCls}`;
    setTrend(els.harmonyTr, s.dHarmony, 0.005);

    setMeter('plants', s.plants, els.plants, els.plantsTr, s.dPlants, 0.15);
    setMeter('animals', s.animals, els.animals, els.animalsTr, s.dAnimals, 0.05);
    setMeter('water', s.water, els.water, els.waterTr, s.dWater, 0.2);

    els.seeds.textContent = String(Math.floor(s.seeds));
    els.trees.textContent = String(Math.round(s.trees));
    els.foxes.textContent = String(Math.round(s.foxes));
    els.treesChip.classList.toggle('hidden', !s.unlocked.tree);
    els.foxesChip.classList.toggle('hidden', !s.unlocked.fox);

    actionBtns.forEach(btn => {
      const kind = btn.dataset.kind;
      const locked = (kind === 'tree' || kind === 'fox') && !s.unlocked[kind];
      btn.classList.toggle('hidden', locked);
      const short = s.seeds < CFG.actions[kind].cost;
      btn.classList.toggle('unaffordable', short);
      btn.setAttribute('aria-label', `${btn.querySelector('.ut-act-name').textContent}, costs ${CFG.actions[kind].cost} seeds${short ? ', not enough seeds yet' : ''}`);
    });

    if (s.hint.id !== lastHintId || els.hint.textContent !== s.hint.text) {
      lastHintId = s.hint.id;
      els.hint.textContent = s.hint.text;
      els.hint.classList.toggle('good', s.hint.id === 'good');
    }

    renderGoal(s.goal, s);

    if (s.event) {
      els.banner.textContent = `${s.event.icon} ${s.event.name} · ${Math.ceil(s.event.remaining)}s`;
      els.banner.classList.remove('hidden');
    } else if (!bannerTimer) {
      els.banner.classList.add('hidden');
    }
    const ev = s.event && s.event.id;
    islandEl.classList.toggle('drought', ev === 'drought');
    islandEl.classList.toggle('bloom', ev === 'bloom');
    if (ev === 'rainy') islandEl.classList.add('raining');
    else if (!rainTimer) islandEl.classList.remove('raining');

    // Land turns from dusty tan to lush green with Harmony
    const h = s.harmony;
    islandEl.style.setProperty('--land', `hsl(${Math.round(38 + 82*h)} ${Math.round(28 + 22*h)}% ${Math.round(34 + 8*h)}%)`);
    islandEl.style.setProperty('--water', String(s.water/100));
    islandEl.setAttribute('aria-label', `Island: ${status}. About ${Math.round(s.plants)} plants, ${Math.round(s.animals)} animals` +
      `${s.trees >= 1 ? `, ${Math.round(s.trees)} trees` : ''}${s.foxes >= 0.5 ? `, ${Math.round(s.foxes)} foxes` : ''}, water at ${Math.round(s.water)}%.`);

    drawIsland(s);
    if (s.time % 5 === 0 && s.time !== 0) save();
    ambienceControl(s);
  }

  function setMeter(key, value, valEl, trEl, delta, eps){
    const m = meters[key];
    valEl.textContent = String(Math.round(value));
    m.el.querySelector('.ut-marker').style.left = `${pct(value, m.max)}%`;
    m.el.classList.toggle('off', value < m.zone[0] || value > m.zone[1]);
    setTrend(trEl, delta, eps);
  }

  function renderGoal(g, s){
    if (g.done) {
      els.goalLabel.textContent = 'All goals complete';
      els.goalText.textContent = 'Your island is a true utopia. Keep it thriving!';
      els.goalDetail.textContent = `Best Serene streak: ${formatTime(s.bestSerene)}`;
      els.goalFill.style.width = '100%';
      els.goal.classList.add('done');
      return;
    }
    els.goal.classList.remove('done');
    els.goalLabel.textContent = `Goal ${g.index + 1} / ${g.total}`;
    if (els.goalText.textContent !== g.text) els.goalText.textContent = g.text;
    els.goalDetail.textContent = g.detail;
    els.goalFill.style.width = `${Math.round(g.progress * 100)}%`;
  }

  function setTrend(el, delta, eps){
    el.classList.remove('up','down');
    if (delta > eps) { el.textContent = '▲'; el.classList.add('up'); }
    else if (delta < -eps) { el.textContent = '▼'; el.classList.add('down'); }
    else { el.textContent = '•'; }
  }

  // ---- Game events ----
  function onGoal({ goal, next }){
    const reward = [goal.reward.seeds ? `+${goal.reward.seeds} ✨` : '', goal.note || ''].filter(Boolean).join(' · ');
    toast(`🎯 Goal complete: ${goal.text}${reward ? ` — ${reward}` : ''}`, 5500);
    chime();
    if (goal.reward.unlock) {
      const btn = actionBtns.find(b => b.dataset.kind === goal.reward.unlock);
      if (btn) { btn.classList.remove('unlocked'); void btn.offsetWidth; btn.classList.add('unlocked'); }
    }
    if (!next) {
      save();
      showModal({ title: 'Utopia achieved 🏝️', pages: ['Every goal is complete. Your island is calm, green and full of life.',
        ], doneLabel: 'Keep playing' });
    }
  }

  function onEvent(e){
    if (e.phase === 'start') {
      toast(`${e.icon} ${e.name} — ${e.text}`, 5000);
      if (!e.duration) {
        els.banner.textContent = `${e.icon} ${e.name}`;
        els.banner.classList.remove('hidden');
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => { bannerTimer = null; if (game && !game.event) els.banner.classList.add('hidden'); }, 4000);
      }
    } else {
      toast(`${e.icon} ${e.name} has passed${e.survived ? ' — the island held steady.' : '.'}`);
    }
  }

  function onRain(){
    if (game.event && game.event.id === 'rainy') return;
    islandEl.classList.add('raining');
    clearTimeout(rainTimer);
    rainTimer = setTimeout(() => { rainTimer = null; if (!(game.event && game.event.id === 'rainy')) islandEl.classList.remove('raining'); }, 1600);
    if (audioReady()) noisePlip(1400, 0.2, 0.6, 0.05);
  }

  // ---- Island sprites ----
  function drawIsland(s){
    syncSprites(sprites.plants, Math.min(60, Math.round(s.plants / 2)), () => makeSprite('plant'));
    syncSprites(sprites.animals, Math.min(25, Math.round(s.animals)), () => makeSprite('animal'));
    syncSprites(sprites.trees, Math.min(CFG.maxTrees, Math.round(s.trees)), () => makeSprite('tree'));
    syncSprites(sprites.foxes, Math.min(CFG.maxFoxes, Math.round(s.foxes)), () => makeSprite('fox'));

    // Animals amble a little each tick; birds roam further.
    if (!reduceMotion && s.time !== lastWanderTime) {
      sprites.animals.forEach(wander);
      sprites.foxes.forEach(wander);
    }
    lastWanderTime = s.time;
  }

  function syncSprites(list, target, create){
    while (list.length < target) list.push(create());
    while (list.length > target) {
      const i = Math.floor(Math.random() * list.length);
      removeSprite(list.splice(i, 1)[0]);
    }
  }

  function makeSprite(kind){
    const p = takeFocusPoint(kind) || randomLandPoint();
    const el = document.createElement('div');
    const sprite = { el, x: p.x, y: p.y, kind };
    if (kind === 'plant') {
      el.className = 'sprout';
      el.style.setProperty('--size', (0.8 + Math.random() * 0.6).toFixed(2));
    } else if (kind === 'animal') {
      sprite.kind = Math.random() < 0.7 ? 'sheep' : 'bird';
      el.className = `animal ${sprite.kind}`;
      el.textContent = sprite.kind === 'sheep' ? '🐑' : '🐦';
    } else if (kind === 'tree') {
      el.className = 'tree';
      el.textContent = Math.random() < 0.5 ? '🌳' : '🌲';
    } else {
      el.className = 'fox';
      el.textContent = '🦊';
    }
    placeSprite(sprite);
    islandEl.appendChild(el);
    if (!reduceMotion) {
      el.classList.add('entering');
      el.addEventListener('animationend', () => el.classList.remove('entering'), { once:true });
    }
    return sprite;
  }

  function takeFocusPoint(kind){
    if (!spawnFocus || spawnFocus.kind !== kind || spawnFocus.left <= 0) return null;
    spawnFocus.left -= 1;
    for (let tries = 0; tries < 12; tries++) {
      const p = { x: spawnFocus.x + (Math.random()*2 - 1) * 6, y: spawnFocus.y + (Math.random()*2 - 1) * 6 };
      if (onLand(p)) return p;
    }
    return { x: spawnFocus.x, y: spawnFocus.y };
  }

  function removeSprite(sprite){
    const el = sprite.el;
    if (reduceMotion) { el.remove(); return; }
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 450);
  }

  function clearSprites(){
    Object.values(sprites).forEach(list => list.splice(0).forEach(s => s.el.remove()));
  }

  function wander(sprite){
    if (Math.random() < 0.35) return; // sometimes just graze in place
    const step = sprite.kind === 'bird' ? 9 : sprite.kind === 'fox' ? 6 : 3;
    let p = { x: sprite.x + (Math.random()*2 - 1) * step, y: sprite.y + (Math.random()*2 - 1) * step };
    if (!onLand(p)) return;
    if (p.x < sprite.x - 0.5) sprite.el.classList.add('flip');
    else if (p.x > sprite.x + 0.5) sprite.el.classList.remove('flip');
    sprite.x = p.x; sprite.y = p.y;
    placeSprite(sprite);
  }

  function placeSprite(sprite){
    sprite.el.style.left = `${50 + sprite.x}%`;
    sprite.el.style.top = `${50 + sprite.y}%`;
    sprite.el.style.zIndex = String(Math.round(50 + sprite.y)); // lower on screen draws in front
  }

  function onLand(p){
    if (Math.hypot(p.x, p.y) > LAND_R) return false;
    const dx = (p.x - POND.x) / POND.rx, dy = (p.y - POND.y) / POND.ry;
    return dx*dx + dy*dy > 1;
  }

  function randomLandPoint(){
    for (let tries = 0; tries < 30; tries++) {
      const t = Math.random()*2*Math.PI; const u = Math.random()+Math.random();
      const rr = u > 1 ? 2-u : u; // triangular distribution, denser toward the middle
      const p = { x: Math.cos(t)*rr*LAND_R, y: Math.sin(t)*rr*LAND_R + 4 };
      if (onLand(p)) return p;
    }
    return { x: 10, y: 10 };
  }

  function floatText(p, text){
    if (reduceMotion) return;
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.left = `${50 + p.x}%`;
    el.style.top = `${50 + p.y}%`;
    islandEl.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once:true });
  }

  // ---- Toasts and modal ----
  function toast(text, ms=4000){
    const el = document.createElement('div');
    el.className = 'ut-toast';
    el.textContent = text;
    els.toasts.appendChild(el);
    while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
  }

  function bump(el, cls){
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once:true });
  }

  function showModal({ title, pages, doneLabel='Got it', skipLabel='Skip', onClose }){
    if (modalState) closeModal(true);
    const titles = Array.isArray(title) ? title : pages.map(() => title);
    modalState = { i: 0, pages, titles, doneLabel, skipLabel, onClose, opener: document.activeElement };
    els.modal.classList.remove('hidden');
    setPaused('modal', true);
    applyModal();
  }
  function applyModal(){
    const m = modalState;
    const last = m.i === m.pages.length - 1;
    els.modalTitle.textContent = m.titles[m.i];
    els.modalMsg.textContent = m.pages[m.i];
    els.modalNext.classList.toggle('hidden', last);
    els.modalDone.textContent = last ? m.doneLabel : m.skipLabel;
    (last ? els.modalDone : els.modalNext).focus();
  }
  function closeModal(silent){
    if (!modalState) return;
    const { onClose, opener } = modalState;
    modalState = null;
    els.modal.classList.add('hidden');
    setPaused('modal', false);
    if (!silent && onClose) onClose();
    if (opener && opener.focus && document.body.contains(opener)) opener.focus();
  }
  els.modalNext.addEventListener('click', () => { if (!modalState) return; modalState.i = Math.min(modalState.pages.length - 1, modalState.i + 1); applyModal(); });
  els.modalDone.addEventListener('click', () => closeModal());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalState) closeModal(); });

  function showTutorial(){
    const a = CFG.actions;
    showModal({
      title: ['Welcome to Tiny Utopia', 'Seeds ✨', 'Read the meters', 'Goals and weather'],
      pages: [
        'Your little island needs balance: plants feed the animals, and plants need water. Keep them in harmony.',
        `Every action costs Seeds — plants ${a.plant.cost}, animals ${a.animal.cost}, water ${a.water.cost}. You earn Seeds over time, faster when Harmony is high.`,
        'Keep each marker inside its green zone. The line under the meters tells you what the island needs most right now.',
        'Complete goals to unlock trees, foxes and changing weather. Keys 1–5 run the actions and P pauses. Your island is saved and keeps living while you are away.',
      ],
      onClose: () => { try { localStorage.setItem(TUTORIAL_KEY, 'true'); } catch {} },
    });
  }

  function showAwaySummary(r){
    const { before: b, after: a } = r;
    const diff = (x, y) => { const d = Math.round(y) - Math.round(x); return d === 0 ? 'steady' : (d > 0 ? `+${d}` : String(d)); };
    const parts = [
      `🌱 ${Math.round(a.plants)} (${diff(b.plants, a.plants)})`,
      `🐑 ${Math.round(a.animals)} (${diff(b.animals, a.animals)})`,
      `💧 ${Math.round(a.water)} (${diff(b.water, a.water)})`,
      `✨ ${Math.floor(a.seeds)} (${diff(b.seeds, a.seeds)})`,
    ];
    const mood = a.harmony >= 0.6 ? 'The island carried on peacefully.' : 'Things drifted a little — it could use a nudge.';
    showModal({ title: `While you were away (${formatTime(r.seconds)})`, pages: [`${mood} ${parts.join(' · ')}. Harmony is ${Math.round(a.harmony*100)}%.`], doneLabel: 'Continue' });
  }

  // ---- Theme ----
  function setupTheme(){
    const key = 'memory.theme';
    let saved = null; try { saved = localStorage.getItem(key); } catch {}
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(saved || (prefersLight ? 'light' : 'dark'));
    els.themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next); try { localStorage.setItem(key, next); } catch {}
    });
  }
  function applyTheme(theme){
    const light = theme === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    els.themeBtn.setAttribute('aria-pressed', String(light));
    els.themeBtn.textContent = light ? 'Dark Theme' : 'Light Theme';
  }

  // ---- Audio ambience (soft wind + birds) ----
  function setupAudio(){
    let en = null; try { en = localStorage.getItem('utopia.audio.enabled'); } catch {}
    audio.enabled = en === null ? true : en === 'true';
    updateSoundBtn();

    const unlock = () => {
      try{
        if (!audio.ctx) audio.ctx = new (window.AudioContext||window.webkitAudioContext)();
        if (audio.ctx.state === 'suspended' && !document.hidden) audio.ctx.resume();
        if (!audio.master){ audio.master = audio.ctx.createGain(); audio.master.gain.value = 0.15; audio.master.connect(audio.ctx.destination); }
      }catch{}
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once:true });
    window.addEventListener('keydown', unlock, { once:true });

    els.soundBtn.addEventListener('click', () => {
      audio.enabled = !audio.enabled;
      updateSoundBtn();
      try { localStorage.setItem('utopia.audio.enabled', String(audio.enabled)); } catch {}
      if (!audio.enabled) setWind(0);
      else if (game) ambienceControl(game.state());
    });
  }
  function updateSoundBtn(){
    els.soundBtn.setAttribute('aria-pressed', String(audio.enabled));
    els.soundBtn.textContent = audio.enabled ? 'Sound On' : 'Sound Off';
  }

  function audioReady(){ return audio.enabled && audio.ctx && audio.master; }
  function gentlePop(freq=340){ if(!audioReady()) return; blip(freq, 0.05, 0.14); }
  function waterPlip(){ if(!audioReady()) return; noisePlip(700, 0.05, 0.08); }
  function chime(){ if(!audioReady()) return; blip(660, 0.02, 0.3); setTimeout(() => audioReady() && blip(990, 0.02, 0.4), 140); }

  function ambienceControl(s){
    if (!audioReady() || pauseReasons.size) return;
    setWind(0.08 + s.harmony*0.06 + (s.event && s.event.id === 'rainy' ? 0.05 : 0));
    if (!birdsTimer) {
      birdsTimer = setInterval(() => { if (Math.random()<0.3 && audioReady() && !pauseReasons.size) birdChirp(); }, 3000);
    }
  }

  function setWind(level){
    if (!audio.ctx || !audio.master) return;
    if (!audio._wind){
      if (level <= 0) return;
      const ctx=audio.ctx; const noise=ctx.createBuffer(1, 2*ctx.sampleRate, ctx.sampleRate); const d=noise.getChannelData(0);
      for(let i=0;i<d.length;i++){ d[i]=(Math.random()*2-1)*0.3; }
      const src=ctx.createBufferSource(); src.buffer=noise; src.loop=true;
      const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=380; bp.Q.value=0.8;
      const g=ctx.createGain(); g.gain.value=0.0;
      src.connect(bp); bp.connect(g); g.connect(audio.master);
      src.start(); audio._wind = { g };
    }
    const now = audio.ctx.currentTime; const g = audio._wind.g.gain;
    g.cancelScheduledValues(now); g.setTargetAtTime(level, now, level > 0 ? 0.8 : 0.2);
  }

  function birdChirp(){ blip(1200+Math.random()*400, 0.06, 0.06); }
  function blip(freq, attack, release){
    const ctx=audio.ctx; const o=ctx.createOscillator(); const g=ctx.createGain();
    o.type='sine'; o.frequency.value=freq; g.gain.value=0; o.connect(g); g.connect(audio.master);
    const t=ctx.currentTime+0.002; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.12,t+attack); g.gain.exponentialRampToValueAtTime(0.0001,t+attack+release); o.start(t); o.stop(t+attack+release+0.05);
  }
  function noisePlip(freq, attack, release, peak=0.12){
    const ctx=audio.ctx; const len=Math.ceil((attack+release+0.05)*ctx.sampleRate);
    const noise=ctx.createBuffer(1,len,ctx.sampleRate); const d=noise.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1);
    const s=ctx.createBufferSource(); s.buffer=noise; const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freq; bp.Q.value=8; const g=ctx.createGain(); g.gain.value=0; s.connect(bp); bp.connect(g); g.connect(audio.master);
    const t=ctx.currentTime+0.002; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(peak,t+attack); g.gain.exponentialRampToValueAtTime(0.0001,t+attack+release); s.start(t); s.stop(t+attack+release+0.05);
  }

  // ---- helpers ----
  function pct(v, max){ return Math.max(0, Math.min(100, v / max * 100)); }
  function formatTime(sec){
    sec = Math.floor(sec);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60), h = Math.floor(m / 60);
    return h ? `${h}h ${m % 60}m` : `${m}m ${sec % 60}s`;
  }
})();
