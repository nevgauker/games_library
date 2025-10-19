// Snake UI: canvas rendering and input wiring
(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  if (canvas) { canvas.tabIndex = 0; setTimeout(()=>canvas.focus(), 0); canvas.addEventListener('click', ()=>canvas.focus()); }

  const scoreEl = document.getElementById('score');
  const lengthEl = document.getElementById('length');
  const speedEl = document.getElementById('speed');
  const bestEl = document.getElementById('best');
  const goalsEl = document.getElementById('goals');
  const statusEl = document.getElementById('status');

  const restartBtn = document.getElementById('restart-btn');
  const themeBtn = document.getElementById('theme-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const wrapBtn = document.getElementById('wrap-btn');
  const soundBtn = document.getElementById('sound-btn');
  const modal = document.getElementById('modal');
  const modalRestart = document.getElementById('modal-restart');
  const modalClose = document.getElementById('modal-close');

  const game = new SnakeGame();
  // Match canvas to grid dimensions
  canvas.width = game.width;
  canvas.height = game.height;

  let last = performance.now();
  let running = true;
  let flash = 0;
  let gflash = 0; // green flash on eat
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let elapsed = 0; // seconds since restart (running only)

  // Best score persistence
  const BEST_KEY = 'snake.best';
  function loadBest(){ const v = Number(localStorage.getItem(BEST_KEY)); return Number.isFinite(v) ? v : 0; }
  function saveBest(v){ localStorage.setItem(BEST_KEY, String(v)); }
  function updateBestUI(){ bestEl.textContent = String(loadBest() || '—'); }
  updateBestUI();

  // Goals system (tiny, persisted)
  const GOALS_KEY = 'snake.goals';
  const GOAL_LIST = [
    { key: 'firstBite', label: 'First Bite', check: (ctx) => ctx.eats >= 1 },
    { key: 'length10', label: 'Grow to 10', check: (ctx) => ctx.length >= 10 },
    { key: 'score100', label: 'Score 100', check: (ctx) => ctx.score >= 100 },
    { key: 'survive60', label: 'Survive 60s', check: (ctx) => ctx.elapsed >= 60 },
    { key: 'wrapBite', label: 'Wrap Bite', check: (ctx) => ctx.wrapBite === true },
  ];
  function loadGoals(){ try { return JSON.parse(localStorage.getItem(GOALS_KEY) || '{}'); } catch { return {}; } }
  function saveGoals(g){ localStorage.setItem(GOALS_KEY, JSON.stringify(g)); }
  let goals = loadGoals();
  let ctx = { eats: 0, length: game.snake.length, score: 0, elapsed: 0, wrapBite: false };
  function updateGoalsUI(){
    const unlocked = GOAL_LIST.filter(g => goals[g.key]).length;
    const total = GOAL_LIST.length;
    if (goalsEl) goalsEl.textContent = `${unlocked}/${total}`;
  }
  function toast(msg){
    if (!statusEl) return;
    statusEl.textContent = msg;
    if (!reduceMotion) gflash = Math.max(gflash, 0.25);
    setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, 2500);
  }
  function tryUnlock(){
    let changed = false;
    for (const g of GOAL_LIST){
      if (!goals[g.key] && g.check(ctx)) { goals[g.key] = true; changed = true; toast(`Goal unlocked: ${g.label}`); }
    }
    if (changed) { saveGoals(goals); updateGoalsUI(); }
  }
  updateGoalsUI();

  // Audio (opt-in)
  let audioCtx = null, gain = null, soundOn = (localStorage.getItem('snake.sound') === '1');
  function ensureAudio(){
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); gain = audioCtx.createGain(); gain.gain.value = 0.05; gain.connect(audioCtx.destination); } catch {}
    }
  }
  function setSound(on){ soundOn = !!on; localStorage.setItem('snake.sound', on ? '1' : '0'); if (soundBtn) soundBtn.setAttribute('aria-pressed', String(on)); }
  function beep(freq=440, dur=0.08, type='square'){
    if (!soundOn || !audioCtx || reduceMotion) return;
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq; o.connect(g); g.connect(gain);
    const now = audioCtx.currentTime;
    g.gain.value = 0.0; g.gain.linearRampToValueAtTime(1.0, now + 0.01); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.start(now); o.stop(now + dur + 0.02);
  }

  function setThemeToggle(btn){
    const root = document.documentElement;
    function cur(){ return root.getAttribute('data-theme') || 'dark'; }
    btn.addEventListener('click', ()=>{
      const next = cur() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      btn.setAttribute('aria-pressed', String(next === 'light'));
    });
  }

  function openModal(){ modal.classList.remove('hidden'); }
  function closeModal(){ modal.classList.add('hidden'); }

  restartBtn.addEventListener('click', () => { closeModal(); game.restart(); running = true; statusEl.textContent = ''; canvas && canvas.focus(); });
  themeBtn && setThemeToggle(themeBtn);
  modalRestart && modalRestart.addEventListener('click', () => { closeModal(); game.restart(); running = true; statusEl.textContent = ''; canvas && canvas.focus(); });
  modalClose && modalClose.addEventListener('click', () => { closeModal(); canvas && canvas.focus(); });
  pauseBtn && pauseBtn.addEventListener('click', () => { game.togglePause(); });
  wrapBtn && wrapBtn.addEventListener('click', () => { game.toggleWrap(); wrapBtn.setAttribute('aria-pressed', String(game.wrapWalls)); wrapBtn.textContent = game.wrapWalls ? 'Wrap: On' : 'Wrap'; statusEl.textContent = game.wrapWalls ? 'Wrap enabled' : 'Classic walls'; });
  soundBtn && soundBtn.addEventListener('click', () => { ensureAudio(); setSound(!soundOn); statusEl.textContent = soundOn ? 'Sound on' : 'Sound off'; });

  // Touch swipe controls (mobile)
  let touchStart = null;
  const SWIPE_MIN = 16; // px threshold
  function onTouchStart(e){
    if (!e.touches || e.touches.length === 0) return;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e){
    if (!touchStart) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) { touchStart = null; return; }
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      game.input(dx > 0 ? 'right' : 'left');
    } else {
      game.input(dy > 0 ? 'down' : 'up');
    }
  }
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchend', onTouchEnd, { passive: true });

  function onKey(e){
    const key = (e.key || '').toLowerCase();
    const code = e.code || '';
    if (key.startsWith('arrow') || code.startsWith('Arrow')) e.preventDefault();
    if (key === 'r' || code === 'KeyR') { game.restart(); return; }
    if (key === 'p' || code === 'KeyP' || key === ' ' || code === 'Space') { game.togglePause(); return; }
    ensureAudio();
    if (key === 'arrowleft' || key === 'a' || code === 'ArrowLeft' || code === 'KeyA') game.input('left');
    if (key === 'arrowright' || key === 'd' || code === 'ArrowRight' || code === 'KeyD') game.input('right');
    if (key === 'arrowup' || key === 'w' || code === 'ArrowUp' || code === 'KeyW') game.input('up');
    if (key === 'arrowdown' || key === 's' || code === 'ArrowDown' || code === 'KeyS') game.input('down');
  }
  document.addEventListener('keydown', onKey, { passive: false });
  window.addEventListener('keydown', onKey, { passive: false });

  game.on('score', s => { scoreEl.textContent = String(s); ctx.score = s; tryUnlock(); });
  game.on('length', n => lengthEl.textContent = String(n));
  game.on('speed', m => speedEl.textContent = `${m.toFixed(1)}x`);
  game.on('eat', () => {
    if (!reduceMotion) gflash = 0.35;
    beep(660, 0.06, 'square');
    ctx.eats += 1;
    ctx.length = Math.max(ctx.length, (Number(lengthEl.textContent) || 0));
    if (game.wrapWalls) ctx.wrapBite = true;
    tryUnlock();
  });
  game.on('pause', () => { statusEl.textContent = 'Paused'; pauseBtn && pauseBtn.setAttribute('aria-pressed', 'true'); });
  game.on('resume', () => { statusEl.textContent = ''; pauseBtn && pauseBtn.setAttribute('aria-pressed', 'false'); });
  game.on('lose', () => {
    running = false;
    statusEl.textContent = 'Crashed!';
    if (!reduceMotion) flash = 0.5;
    // best score update
    const cur = Number(scoreEl.textContent) || 0;
    const best = loadBest();
    if (cur > best) { saveBest(cur); updateBestUI(); }
    // modal message
    const msg = document.getElementById('modal-message');
    if (msg) msg.textContent = `Score: ${cur} · Best: ${Math.max(cur, best)}`;
    beep(180, 0.2, 'sawtooth');
    openModal();
  });

  function loop(t){
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (running) {
      game.step(dt);
      if (!game.paused) {
        elapsed += dt;
        ctx.elapsed = elapsed;
        tryUnlock();
      }
    }
    render();
    requestAnimationFrame(loop);
  }

  function render(){
    const TILE = window.__SNAKE_CONST.TILE;
    // background
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0,0,canvas.width, canvas.height);

    // subtle grid lines for retro vibe
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += TILE) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += TILE) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // food
    if (game.food){
      drawCell(game.food.x, game.food.y, '#ef4444');
    }
    // snake
    for (let i = game.snake.length - 1; i >= 0; i--){
      const s = game.snake[i];
      const isHead = i === 0;
      drawCell(s.x, s.y, isHead ? '#22c55e' : '#16a34a', isHead);
    }

    if (flash > 0){
      ctx.fillStyle = `rgba(239,68,68,${flash.toFixed(3)})`;
      ctx.fillRect(0,0,canvas.width, canvas.height);
      flash = Math.max(0, flash - 0.02);
    }
    if (gflash > 0){
      ctx.fillStyle = `rgba(34,197,94,${gflash.toFixed(3)})`;
      ctx.fillRect(0,0,canvas.width, canvas.height);
      gflash = Math.max(0, gflash - 0.03);
    }
  }

  function drawCell(cx, cy, color, head=false){
    const TILE = window.__SNAKE_CONST.TILE;
    const x = cx * TILE;
    const y = cy * TILE;
    ctx.fillStyle = color;
    // inset for pixel crisp borders
    const pad = 1;
    ctx.fillRect(x+pad, y+pad, TILE-2*pad, TILE-2*pad);
    if (head) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x+pad, y+pad, TILE-2*pad, 4);
    }
  }

  // Reset context on restart
  const origRestart = restartBtn.onclick;
  function resetCtx(){ elapsed = 0; ctx = { eats: 0, length: game.snake.length, score: 0, elapsed: 0, wrapBite: false }; }
  restartBtn.addEventListener('click', resetCtx);
  modalRestart && modalRestart.addEventListener('click', resetCtx);

  requestAnimationFrame(loop);
})();
