// Snake UI: canvas rendering, input wiring, and run flow
(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.tabIndex = 0;
  setTimeout(() => canvas.focus(), 0);

  const $ = (id) => document.getElementById(id);
  const scoreEl = $('score'), lengthEl = $('length'), speedEl = $('speed');
  const bestEl = $('best'), bestLabelEl = $('best-label'), goalsEl = $('goals'), statusEl = $('status');
  const comboEl = $('combo'), comboStat = $('combo-stat');
  const restartBtn = $('restart-btn'), themeBtn = $('theme-btn'), pauseBtn = $('pause-btn');
  const wrapBtn = $('wrap-btn'), soundBtn = $('sound-btn'), goalsBtn = $('goals-btn');
  const boardEl = $('board'), dpad = $('dpad');
  const modal = $('modal'), modalTitle = $('modal-title'), modalMsg = $('modal-message');
  const modalBadge = $('modal-badge'), modalGoals = $('modal-goals');
  const modalRestart = $('modal-restart'), modalClose = $('modal-close');
  const goalsModal = $('goals-modal'), goalsList = $('goals-list'), goalsClose = $('goals-close');

  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isTouch = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);

  // Storage helpers (storage may be unavailable in private mode)
  function load(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }
  function store(k, v){ try { localStorage.setItem(k, v); } catch {} }

  const game = new SnakeGame();
  const TILE = game.tile;
  const W = game.width, H = game.height; // logical drawing size
  // Saved mode (migrating the older wrap on/off setting).
  game.setMode(load('snake.mode', load('snake.wrap', '0') === '1' ? 'wrap' : 'classic'));
  const MODE_INFO = {
    classic: 'Walls are deadly · rocks appear as you grow',
    wrap: 'Edges loop around · rocks appear as you grow',
    zen: 'No crashes, no rocks · just relax',
  };

  // ---- High-DPI canvas: backing store matches displayed size × devicePixelRatio,
  // all drawing happens in logical board units via a transform.
  let scale = 1;
  function fitCanvas(){
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = Math.max(W, Math.round((rect.width || W) * dpr));
    if (canvas.width !== px) { canvas.width = px; canvas.height = Math.round(px * H / W); }
    scale = canvas.width / W;
  }
  if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe(canvas);
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  // ---- Run state: 'ready' -> 'countdown' -> 'playing' -> 'over'
  const COUNT_STEP = 0.6; // seconds per countdown number
  const CRASH_DELAY = 700; // ms to show the crash before the dialog
  let uiState = 'ready';
  let countdownT = 0;
  let elapsed = 0; // seconds of actual play this run
  let crashT = -1; // seconds since crash, -1 when alive
  let modalTimer = null;
  let particles = [], popups = [];
  let foodSpawnT = 1, lastFoodKey = '';
  let clock = 0;

  // ---- Best score, per mode
  // Migrate the old single best score into the classic slot.
  if (load('snake.best.classic', null) === null && load('snake.best', null) !== null) {
    store('snake.best.classic', load('snake.best', '0'));
  }
  const modeName = () => game.rules.label;
  const bestKey = () => `snake.best.${game.mode}`;
  function loadBest(){ const v = Number(load(bestKey(), '0')); return Number.isFinite(v) ? v : 0; }
  function saveBest(v){ store(bestKey(), String(v)); }
  let runStartBest = loadBest(); // to detect "New best!" while saving live
  function updateBestUI(){
    bestEl.textContent = String(loadBest() || '—');
    if (bestLabelEl) bestLabelEl.textContent = `Best · ${modeName()}`;
  }

  // ---- Goals (tiny, persisted)
  const GOAL_LIST = [
    { key: 'firstBite', label: 'First Bite', desc: 'Eat your first apple.', check: (c) => c.eats >= 1 },
    { key: 'length10', label: 'Grow to 10', desc: 'Reach a length of 10.', check: (c) => c.length >= 10 },
    { key: 'score100', label: 'Score 100', desc: 'Score 100 points in one run.', check: (c) => c.score >= 100 },
    { key: 'survive60', label: 'Survive 60s', desc: 'Stay alive for a full minute in Classic or Wrap.', check: (c) => c.mode !== 'zen' && c.elapsed >= 60 },
    { key: 'wrapBite', label: 'Wrap Bite', desc: 'Eat an apple in Wrap mode.', check: (c) => c.mode === 'wrap' && c.eats >= 1 },
    { key: 'combo3', label: 'On a Roll', desc: 'Reach a x3 combo.', check: (c) => c.maxCombo >= 3 },
    { key: 'combo5', label: 'Max Combo', desc: 'Reach a x5 combo.', check: (c) => c.maxCombo >= 5 },
    { key: 'golden', label: 'Golden Bite', desc: 'Eat a golden fruit before it vanishes.', check: (c) => c.golden >= 1 },
    { key: 'rocks10', label: 'Rock Garden', desc: 'Survive with 10 rocks on the board.', check: (c) => c.rocks >= 10 },
    { key: 'classic30', label: 'Long Haul', desc: 'Reach length 30 in Classic.', check: (c) => c.mode === 'classic' && c.length >= 30 },
    { key: 'zen60', label: 'Inner Peace', desc: 'Reach length 60 in Zen.', check: (c) => c.mode === 'zen' && c.length >= 60 },
  ];
  let goals; try { goals = JSON.parse(load('snake.goals', '{}')) || {}; } catch { goals = {}; }
  let goalCtx, runUnlocked;
  function resetGoalCtx(){
    goalCtx = { mode: game.mode, eats: 0, length: game.snake.length, score: 0, elapsed: 0, maxCombo: 1, golden: 0, rocks: 0 };
    runUnlocked = [];
  }
  resetGoalCtx();
  function updateGoalsUI(){ goalsEl.textContent = `${GOAL_LIST.filter(g => goals[g.key]).length}/${GOAL_LIST.length}`; }
  function renderGoalsList(){
    goalsList.innerHTML = '';
    for (const g of GOAL_LIST){
      const li = document.createElement('li');
      if (goals[g.key]) li.className = 'done';
      const mark = document.createElement('span'); mark.className = 'mark'; mark.textContent = goals[g.key] ? '✓' : '';
      const body = document.createElement('div');
      const name = document.createElement('div'); name.className = 'name'; name.textContent = g.label;
      const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = g.desc;
      body.append(name, desc); li.append(mark, body); goalsList.append(li);
    }
  }
  let toastTimer = null;
  function toast(msg){
    statusEl.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, 2500);
  }
  function tryUnlock(){
    let changed = false;
    for (const g of GOAL_LIST){
      if (!goals[g.key] && g.check(goalCtx)) {
        goals[g.key] = true; changed = true; runUnlocked.push(g.label);
        toast(`Goal unlocked: ${g.label}`);
        beep(990, 0.12, 'triangle');
      }
    }
    if (changed) { store('snake.goals', JSON.stringify(goals)); updateGoalsUI(); }
  }

  // ---- Audio (opt-in, independent of reduced-motion)
  let audioCtx = null, master = null, soundOn = load('snake.sound', '0') === '1';
  function ensureAudio(){
    if (!soundOn) return;
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        master = audioCtx.createGain(); master.gain.value = 0.05; master.connect(audioCtx.destination);
      } catch { return; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  function beep(freq=440, dur=0.08, type='square'){
    if (!soundOn || !audioCtx) return;
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq; o.connect(g); g.connect(master);
    const now = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(1.0, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.start(now); o.stop(now + dur + 0.02);
  }
  function setSound(on){
    soundOn = !!on; store('snake.sound', on ? '1' : '0');
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.textContent = soundOn ? 'Sound: On' : 'Sound: Off';
    if (soundOn) ensureAudio();
  }

  // ---- Theme (canvas palette follows the page theme)
  const PALETTES = {
    dark: {
      bg: '#070b14', bg2: '#0b1222', wall: 'rgba(148,163,184,0.45)', wrapWall: 'rgba(52,211,153,0.6)',
      head: '#4ade80', tail: '#15803d', dead: '#64748b', eye: '#f8fafc', pupil: '#0f172a',
      food: '#ef4444', foodHi: 'rgba(255,255,255,0.55)', leaf: '#22c55e', stem: '#a16207', glow: 10,
      shade: 'rgba(2,6,23,0.65)', text: '#e5e7eb', sub: '#94a3b8', pop: '#fde68a',
      gold: '#fbbf24', goldHi: '#fef3c7', ring: 'rgba(52,211,153,0.85)', ringBg: 'rgba(148,163,184,0.18)',
      rock: '#57534e', rockHi: '#a8a29e', rockWarn: 'rgba(251,146,60,0.9)',
    },
    light: {
      bg: '#f8fafc', bg2: '#eef2f7', wall: 'rgba(71,85,105,0.5)', wrapWall: '#059669',
      head: '#22c55e', tail: '#166534', dead: '#94a3b8', eye: '#ffffff', pupil: '#0f172a',
      food: '#dc2626', foodHi: 'rgba(255,255,255,0.7)', leaf: '#16a34a', stem: '#92400e', glow: 0,
      shade: 'rgba(248,250,252,0.8)', text: '#0f172a', sub: '#475569', pop: '#b45309',
      gold: '#f59e0b', goldHi: '#fffbeb', ring: 'rgba(5,150,105,0.85)', ringBg: 'rgba(71,85,105,0.15)',
      rock: '#78716c', rockHi: '#d6d3d1', rockWarn: 'rgba(234,88,12,0.9)',
    },
  };
  const curTheme = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  themeBtn.setAttribute('aria-pressed', String(curTheme() === 'light'));
  themeBtn.addEventListener('click', () => {
    const next = curTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    themeBtn.setAttribute('aria-pressed', String(next === 'light'));
  });

  // ---- Controls UI sync
  function syncControls(){
    const inRun = game.inProgress || uiState === 'countdown';
    wrapBtn.disabled = inRun;
    wrapBtn.title = inRun ? 'Mode can be changed between runs' : 'Switch mode: Classic → Wrap → Zen';
    wrapBtn.textContent = `Mode: ${modeName()}`;
    if (comboStat) comboStat.classList.toggle('hidden', !game.rules.combo);
    pauseBtn.disabled = !game.inProgress;
    pauseBtn.textContent = game.paused ? 'Resume' : 'Pause';
    pauseBtn.setAttribute('aria-pressed', String(game.paused));
  }
  function bump(el){
    if (reduceMotion) return;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  const isOpen = (m) => !m.classList.contains('hidden');
  const anyModalOpen = () => isOpen(modal) || isOpen(goalsModal);
  function openModal(){ modal.classList.remove('hidden'); setTimeout(() => modalRestart.focus(), 0); }
  function closeModal(){ modal.classList.add('hidden'); canvas.focus(); }
  function openGoals(){
    if (uiState === 'playing' || uiState === 'countdown') pauseGame();
    renderGoalsList();
    goalsModal.classList.remove('hidden');
    setTimeout(() => goalsClose.focus(), 0);
  }
  function closeGoals(){ goalsModal.classList.add('hidden'); canvas.focus(); }

  // ---- Run flow: the single entry points used by every control
  function newGame(){
    clearTimeout(modalTimer);
    modal.classList.add('hidden'); goalsModal.classList.add('hidden');
    canvas.focus();
    game.restart();
    uiState = 'ready';
    elapsed = 0; crashT = -1;
    particles = []; popups = [];
    resetGoalCtx();
    runStartBest = loadBest();
    statusEl.textContent = '';
    updateBestUI();
    syncControls();
  }

  function beginCountdown(){
    if (anyModalOpen()) return;
    if (uiState === 'countdown' || uiState === 'over') return;
    if (uiState === 'playing' && !game.paused) return;
    uiState = 'countdown';
    countdownT = COUNT_STEP * 3;
    syncControls();
  }

  function finishCountdown(){
    uiState = 'playing';
    if (!game.started) game.start(); else game.resume();
    syncControls();
  }

  function pauseGame(){
    if (uiState === 'countdown') {
      // Interrupted countdown: go back to the waiting screen of the same run.
      uiState = game.started ? 'playing' : 'ready';
    }
    game.pause();
    syncControls();
  }

  function togglePause(){
    if (uiState === 'ready') { beginCountdown(); return; }
    if (uiState !== 'playing') return;
    if (game.paused) beginCountdown(); else pauseGame();
  }

  function handleDir(d){
    ensureAudio();
    if (uiState === 'over' || anyModalOpen()) return;
    if (uiState === 'playing' && game.paused) beginCountdown();
    game.input(d);
    if (uiState === 'ready') beginCountdown();
  }

  // Tap/click on the board: start, resume, or replay.
  function boardTap(){
    ensureAudio();
    if (uiState === 'over') { if (crashT > CRASH_DELAY / 1000 && !anyModalOpen()) newGame(); }
    else if (uiState === 'ready' || game.paused) beginCountdown();
  }

  // ---- Buttons
  restartBtn.addEventListener('click', newGame);
  modalRestart.addEventListener('click', newGame);
  modalClose.addEventListener('click', closeModal);
  goalsBtn.addEventListener('click', openGoals);
  goalsClose.addEventListener('click', closeGoals);
  pauseBtn.addEventListener('click', () => { togglePause(); canvas.focus(); });
  wrapBtn.addEventListener('click', () => {
    if (uiState === 'over') newGame();
    if (game.nextMode()) {
      store('snake.mode', game.mode);
      newGame(); // fresh run state for the new mode
      toast(`${modeName()}: ${MODE_INFO[game.mode]}`);
    }
    syncControls();
    canvas.focus();
  });
  soundBtn.addEventListener('click', () => { setSound(!soundOn); canvas.focus(); });
  // Clicking the dim backdrop closes a dialog.
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  goalsModal.addEventListener('click', (e) => { if (e.target === goalsModal) closeGoals(); });

  // ---- Keyboard (single listener; window catches everything that bubbles)
  const KEY_DIRS = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  };
  window.addEventListener('keydown', (e) => {
    const code = e.code || '';
    if (isOpen(goalsModal)) {
      if (code === 'Escape' || code === 'KeyG') { e.preventDefault(); closeGoals(); }
      return;
    }
    if (isOpen(modal)) {
      if (code === 'Escape') { e.preventDefault(); closeModal(); }
      else if (code === 'KeyR') { e.preventDefault(); newGame(); }
      return; // Enter/Space activate the focused dialog button natively
    }
    // Let focused buttons handle their own Enter/Space activation.
    const onButton = e.target && e.target.tagName === 'BUTTON';
    if (onButton && (code === 'Space' || code === 'Enter')) return;

    if (KEY_DIRS[code]) { e.preventDefault(); handleDir(KEY_DIRS[code]); return; }
    if (code === 'KeyR') { e.preventDefault(); newGame(); return; }
    if (code === 'KeyG') { e.preventDefault(); openGoals(); return; }
    if (code === 'KeyP' || code === 'Space' || code === 'Escape') { e.preventDefault(); ensureAudio(); togglePause(); return; }
    if (code === 'Enter') { e.preventDefault(); boardTap(); }
  });

  // ---- Auto-pause when the player leaves the tab/window
  function autoPause(){ if (uiState === 'playing' || uiState === 'countdown') pauseGame(); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
  window.addEventListener('blur', autoPause);

  // ---- Touch: swipes register mid-gesture (no need to lift the finger);
  // keep dragging to chain turns. A short touch without movement is a tap.
  const SWIPE_MIN = 18;
  let touch = null; // { x, y, swiped }
  boardEl.addEventListener('touchstart', (e) => {
    const t = e.touches && e.touches[0];
    if (t) touch = { x: t.clientX, y: t.clientY, swiped: false };
    e.preventDefault();
  }, { passive: false });
  boardEl.addEventListener('touchmove', (e) => {
    const t = e.touches && e.touches[0];
    if (!touch || !t) return;
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_MIN) {
      handleDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      touch = { x: t.clientX, y: t.clientY, swiped: true };
    }
    e.preventDefault();
  }, { passive: false });
  boardEl.addEventListener('touchend', (e) => {
    if (touch && !touch.swiped) boardTap();
    touch = null;
    e.preventDefault();
  }, { passive: false });
  boardEl.addEventListener('touchcancel', () => { touch = null; });
  canvas.addEventListener('click', () => { canvas.focus(); boardTap(); });

  // ---- D-pad (shown on touch devices via CSS). pointerdown fires instantly.
  if (dpad) {
    dpad.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button[data-dir]');
      if (!b) return;
      e.preventDefault();
      handleDir(b.dataset.dir);
      b.classList.add('on');
    });
    const clearOn = () => dpad.querySelectorAll('.on').forEach(b => b.classList.remove('on'));
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => dpad.addEventListener(ev, clearOn));
    dpad.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- Game events
  game.on('score', s => {
    scoreEl.textContent = String(s); goalCtx.score = s;
    if (s) bump(scoreEl);
    // Save best live so a closed tab or Zen session never loses it.
    if (s > loadBest()) { saveBest(s); updateBestUI(); }
    tryUnlock();
  });
  game.on('length', n => { lengthEl.textContent = String(n); goalCtx.length = Math.max(goalCtx.length, n); tryUnlock(); });
  game.on('speed', m => speedEl.textContent = `${m.toFixed(1)}x`);
  game.on('combo', c => {
    if (!comboEl) return;
    comboEl.textContent = `x${c}`;
    comboEl.classList.toggle('hot', c > 1);
    if (c > 1) bump(comboEl);
    goalCtx.maxCombo = Math.max(goalCtx.maxCombo, c);
    tryUnlock();
  });
  game.on('eat', (e) => {
    const cx = e.x * TILE + TILE / 2, cy = e.y * TILE + TILE / 2;
    spawnBurst(cx, cy, e.bonus);
    popups.push({ x: cx, y: cy, t: 0, text: e.combo > 1 && !e.bonus ? `+${e.points} ×${e.combo}` : `+${e.points}`, gold: e.bonus });
    if (e.bonus) {
      [784, 988, 1175].forEach((f, i) => setTimeout(() => beep(f, 0.08, 'triangle'), i * 70));
      goalCtx.golden += 1;
    } else {
      beep(660 + 90 * (e.combo - 1), 0.06, 'square'); // pitch climbs with the combo
      goalCtx.eats += 1;
    }
    tryUnlock();
  });
  game.on('bonus-spawn', () => { toast('Golden fruit! Grab it before it fades'); beep(1320, 0.1, 'triangle'); });
  game.on('rocks-warn', () => { toast('Rocks incoming!'); beep(150, 0.15, 'triangle'); });
  game.on('rocks', () => { goalCtx.rocks = game.rocks.filter(r => r.armed).length; tryUnlock(); });
  game.on('pause', () => { statusEl.textContent = 'Paused'; syncControls(); });
  game.on('resume', () => { statusEl.textContent = ''; syncControls(); });

  function fmtTime(s){ const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; }

  function endRun(won){
    uiState = 'over';
    crashT = 0;
    const cur = game.score;
    const best = Math.max(runStartBest, loadBest());
    const isBest = cur > runStartBest && cur > 0;
    modalTitle.textContent = won ? 'Board Cleared!' : 'Game Over';
    const REASONS = { wall: 'You hit the wall.', self: 'You bit your own tail.', rock: 'You crashed into a rock.' };
    modalMsg.textContent = won ? 'You filled the entire board. Incredible!' : (REASONS[game.deathReason] || 'Crashed!');
    $('ms-combo').textContent = `x${game.maxCombo}`;
    $('ms-combo').parentElement.classList.toggle('hidden', !game.rules.combo);
    modalBadge.classList.toggle('hidden', !isBest);
    $('ms-score').textContent = String(cur);
    $('ms-best-label').textContent = `Best · ${modeName()}`;
    $('ms-best').textContent = String(Math.max(cur, best));
    $('ms-length').textContent = String(game.snake.length);
    $('ms-apples').textContent = String(goalCtx.eats);
    $('ms-time').textContent = fmtTime(elapsed);
    modalGoals.classList.toggle('hidden', runUnlocked.length === 0);
    modalGoals.textContent = runUnlocked.length ? `Goals unlocked: ${runUnlocked.join(', ')}` : '';
    statusEl.textContent = won ? 'You filled the board!' : 'Crashed!';
    syncControls();
    clearTimeout(modalTimer);
    modalTimer = setTimeout(openModal, CRASH_DELAY);
  }
  game.on('lose', () => { beep(180, 0.25, 'sawtooth'); endRun(false); });
  game.on('win', () => { beep(880, 0.2, 'triangle'); endRun(true); });

  // ---- Effects
  function spawnBurst(x, y, gold){
    if (reduceMotion) return;
    const P = PALETTES[curTheme()];
    const count = gold ? 20 : 12;
    for (let i = 0; i < count; i++){
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const v = (gold ? 60 : 40) + Math.random() * 70;
      const life = 0.35 + Math.random() * 0.25;
      const color = gold ? (i % 2 ? P.gold : P.goldHi) : (i % 3 ? P.food : P.leaf);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color });
    }
  }
  function updateEffects(dt){
    for (const p of particles){ p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    for (const p of popups) p.t += dt;
    popups = popups.filter(p => p.t < 0.7);
    if (crashT >= 0) crashT += dt;
    if (foodSpawnT < 1) foodSpawnT = Math.min(1, foodSpawnT + dt / 0.2);
    const fk = game.food ? game.food.x + ',' + game.food.y : '';
    if (fk !== lastFoodKey) { lastFoodKey = fk; foodSpawnT = reduceMotion ? 1 : 0; }
  }

  // ---- Main loop
  let last = performance.now();
  function loop(t){
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    clock += dt;
    if (uiState === 'countdown') {
      countdownT -= dt;
      if (countdownT <= 0) finishCountdown();
    } else if (uiState === 'playing' && !game.paused) {
      game.step(dt);
      if (game.alive) { elapsed += dt; goalCtx.elapsed = elapsed; tryUnlock(); }
    }
    updateEffects(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---- Rendering helpers
  // Colors are mixed as [r,g,b] arrays; css() turns one into a CSS color.
  function rgb(h){ const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mix(A, B, t){ return [0, 1, 2].map(k => Math.round(A[k] + (B[k] - A[k]) * t)); }
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const center = (c) => ({ x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2 });

  // Slide from `from` toward `to` by a (0..1). A wrap crossing slides in from just
  // outside the opposite edge instead of across the whole board.
  function slide(from, to, a){
    let fx = from.x, fy = from.y;
    if (fx - to.x > 1) fx = to.x - 1; else if (to.x - fx > 1) fx = to.x + 1;
    if (fy - to.y > 1) fy = to.y - 1; else if (to.y - fy > 1) fy = to.y + 1;
    return center({ x: fx + (to.x - fx) * a, y: fy + (to.y - fy) * a });
  }

  // Body path for smooth movement: interior segments stay on their grid cells
  // (so corners stay square); only the head tip and tail tip slide.
  function snakePoints(){
    const a = game.progress;
    const cur = game.snake, prev = game.prev;
    const n = cur.length;
    const pts = [slide(cur[1] || cur[0], cur[0], a)];
    for (let i = 1; i < n; i++) pts.push(center(cur[i]));
    const tailFrom = prev[prev.length - 1];
    // Tail tip trails from the vacated cell (skipped on a growth step, when the tail stays put).
    if (tailFrom && prev.length === n) pts.push(slide(tailFrom, cur[n - 1], a));
    return pts;
  }

  function render(){
    const P = PALETTES[curTheme()];
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // Crash shake
    if (crashT >= 0 && crashT < 0.35 && !reduceMotion) {
      const amp = 4 * (1 - crashT / 0.35);
      ctx.translate((Math.random() - 0.5) * amp * 2, (Math.random() - 0.5) * amp * 2);
    }

    // Checkerboard background
    ctx.fillStyle = P.bg;
    ctx.fillRect(-8, -8, W + 16, H + 16);
    ctx.fillStyle = P.bg2;
    for (let y = 0; y < game.rows; y++)
      for (let x = (y % 2); x < game.cols; x += 2)
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);

    drawRocks(P);
    drawFood(P);
    drawBonus(P);
    drawSnake(P);
    drawEffects(P);
    drawWalls(P);

    // Crash vignette
    if (crashT >= 0 && crashT < 0.6 && !game.won) {
      const k = 1 - crashT / 0.6;
      const g = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.75);
      g.addColorStop(0, 'rgba(239,68,68,0)');
      g.addColorStop(1, `rgba(239,68,68,${(0.45 * k).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // Overlays
    if (uiState === 'ready') {
      drawOverlay(P, 'Snake', [
        isTouch ? 'Tap to start' : 'Press any arrow key to start',
        isTouch ? 'Swipe the board or use the pad' : 'Arrows / WASD steer · Space pauses',
        `Mode: ${modeName()}`,
        MODE_INFO[game.mode],
      ]);
    } else if (uiState === 'countdown') {
      drawOverlay(P, String(Math.max(1, Math.ceil(countdownT / COUNT_STEP))), [game.started ? 'Resuming…' : 'Get ready…']);
    } else if (uiState === 'playing' && game.paused) {
      drawOverlay(P, 'Paused', [isTouch ? 'Tap to resume' : 'Space or arrow key to resume']);
    } else if (uiState === 'over' && crashT > CRASH_DELAY / 1000 && !anyModalOpen()) {
      drawOverlay(P, game.won ? 'Board Cleared!' : 'Game Over', [`Score: ${game.score}`, isTouch ? 'Tap to play again' : 'Press R or Enter to play again']);
    }
  }

  function drawWalls(P){
    ctx.save();
    ctx.lineWidth = 2;
    if (game.wrapWalls) { ctx.strokeStyle = P.wrapWall; ctx.setLineDash([6, 6]); ctx.lineDashOffset = reduceMotion ? 0 : -clock * 12; }
    else ctx.strokeStyle = P.wall;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.restore();
  }

  function drawFood(P){
    if (!game.food) return;
    const c = center(game.food);
    const pulse = reduceMotion ? 1 : 1 + Math.sin(clock * 5) * 0.05;
    const spawn = 1 - Math.pow(1 - foodSpawnT, 3); // ease-out pop-in
    const r = TILE * 0.38 * pulse * (0.3 + 0.7 * spawn);
    ctx.save();
    if (P.glow) { ctx.shadowColor = P.food; ctx.shadowBlur = P.glow * scale; }
    ctx.fillStyle = P.food;
    ctx.beginPath(); ctx.arc(c.x, c.y + 1, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = P.foodHi;
    ctx.beginPath(); ctx.arc(c.x - r * 0.35, c.y - r * 0.25, r * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = P.stem; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(c.x, c.y - r + 1); ctx.lineTo(c.x + 1, c.y - r - 3); ctx.stroke();
    ctx.fillStyle = P.leaf;
    ctx.beginPath(); ctx.ellipse(c.x + 3.5, c.y - r - 1.5, 3, 1.6, -0.5, 0, Math.PI * 2); ctx.fill();

    // Combo timer ring: how long you have to keep the streak going.
    if (game.rules.combo && game.started && game.alive) {
      const left = game.comboLeft;
      const R = TILE * 0.68;
      ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.strokeStyle = P.ringBg;
      ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.stroke();
      if (left > 0) {
        ctx.strokeStyle = P.ring;
        ctx.beginPath(); ctx.arc(c.x, c.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
      }
    }
  }

  function drawBonus(P){
    const b = game.bonus;
    if (!b) return;
    const left = b.expires - game.time;
    // Blink during the last 2 seconds as a warning.
    if (left < 2 && !reduceMotion && Math.floor(clock * 8) % 2) return;
    const c = center(b);
    const r = TILE * 0.42 * (reduceMotion ? 1 : 1 + Math.sin(clock * 7) * 0.06);
    ctx.save();
    if (P.glow) { ctx.shadowColor = P.gold; ctx.shadowBlur = P.glow * 1.6 * scale; }
    // Five-point star
    ctx.fillStyle = P.gold;
    ctx.beginPath();
    for (let i = 0; i < 10; i++){
      const a = -Math.PI / 2 + i * Math.PI / 5 + (reduceMotion ? 0 : clock * 0.8);
      const rr = i % 2 ? r * 0.48 : r * 1.1;
      ctx.lineTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = P.goldHi;
    ctx.beginPath(); ctx.arc(c.x - r * 0.15, c.y - r * 0.2, r * 0.2, 0, Math.PI * 2); ctx.fill();
    // Lifetime ring
    ctx.strokeStyle = P.gold; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(c.x, c.y, TILE * 0.7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, left / b.life)); ctx.stroke();
  }

  function drawRocks(P){
    for (const rk of game.rocks){
      const x = rk.x * TILE, y = rk.y * TILE;
      if (!rk.armed) {
        // Warning: pulsing dashed outline where a rock is about to land.
        const a = reduceMotion ? 0.8 : 0.45 + 0.45 * Math.abs(Math.sin(clock * 6));
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = P.rockWarn; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
        ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
        ctx.restore();
        continue;
      }
      // Solid rock: lumpy rounded stone with a highlight.
      ctx.fillStyle = P.rock;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + TILE - 2);
      ctx.lineTo(x + 1.5, y + 7);
      ctx.lineTo(x + 5, y + 2.5);
      ctx.lineTo(x + 11, y + 2);
      ctx.lineTo(x + TILE - 1.5, y + 7);
      ctx.lineTo(x + TILE - 2.5, y + TILE - 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.rockHi;
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(x + 5, y + 4); ctx.lineTo(x + 10, y + 3.5); ctx.lineTo(x + 7, y + 7); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawSnake(P){
    const pts = snakePoints();
    const n = pts.length;
    const deadK = crashT >= 0 && !game.won ? Math.min(1, crashT / 0.4) : 0;
    const head = mix(rgb(P.head), rgb(P.dead), deadK);
    const tail = mix(rgb(P.tail), rgb(P.dead), deadK);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Body: tapered, head-to-tail gradient; skip links that span a wrap edge.
    for (let i = n - 1; i >= 1; i--){
      const a = pts[i], b = pts[i - 1];
      if (Math.abs(a.x - b.x) > TILE * 1.5 || Math.abs(a.y - b.y) > TILE * 1.5) continue;
      const t = i / (n - 1);
      ctx.strokeStyle = css(mix(head, tail, t));
      ctx.lineWidth = TILE * (0.8 - 0.25 * t);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // Head
    const h = pts[0];
    ctx.fillStyle = css(head);
    ctx.beginPath(); ctx.arc(h.x, h.y, TILE * 0.48, 0, Math.PI * 2); ctx.fill();
    // Eyes look where the snake is heading
    const v = SnakeGame.dirVec(game.dir);
    const px = -v.dy, py = v.dx;
    for (const side of [-1, 1]){
      const ex = h.x + v.dx * TILE * 0.12 + px * side * TILE * 0.2;
      const ey = h.y + v.dy * TILE * 0.12 + py * side * TILE * 0.2;
      ctx.fillStyle = P.eye;
      ctx.beginPath(); ctx.arc(ex, ey, TILE * 0.15, 0, Math.PI * 2); ctx.fill();
      if (deadK > 0.5) {
        const s = TILE * 0.08;
        ctx.strokeStyle = P.pupil; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(ex - s, ey - s); ctx.lineTo(ex + s, ey + s); ctx.moveTo(ex + s, ey - s); ctx.lineTo(ex - s, ey + s); ctx.stroke();
      } else {
        ctx.fillStyle = P.pupil;
        ctx.beginPath(); ctx.arc(ex + v.dx * TILE * 0.06, ey + v.dy * TILE * 0.06, TILE * 0.075, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawEffects(P){
    for (const p of particles){
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 11px system-ui, sans-serif';
    for (const p of popups){
      const k = p.t / 0.7;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = p.gold ? P.gold : P.pop;
      ctx.fillText(p.text, p.x, p.y - (reduceMotion ? 10 : 8 + k * 16));
    }
    ctx.globalAlpha = 1;
  }

  function drawOverlay(P, title, lines){
    ctx.fillStyle = P.shade;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = P.text;
    const big = title.length <= 2;
    ctx.font = `700 ${big ? 72 : 32}px system-ui, sans-serif`;
    // Sit in the upper part of the board so the snake (spawned at center) stays visible.
    const top = H * 0.24;
    ctx.fillText(title, W / 2, top);
    ctx.font = '500 14px system-ui, sans-serif';
    ctx.fillStyle = P.sub;
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, top + (big ? 64 : 40) + i * 22));
  }

  // ---- Init
  setSound(soundOn);
  updateBestUI();
  updateGoalsUI();
  syncControls();
  requestAnimationFrame(loop);
})();
