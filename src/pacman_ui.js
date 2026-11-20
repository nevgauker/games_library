// Pac-Man UI: canvas rendering, HUD and input wiring
(function(){
  const { TILE } = window.__PACMAN_CONST;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.tabIndex = 0;
  setTimeout(() => canvas.focus(), 0);

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');
  const statusEl = document.getElementById('status');
  const restartBtn = document.getElementById('restart-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const themeBtn = document.getElementById('theme-btn');
  const modal = document.getElementById('modal');
  const modalMsg = document.getElementById('modal-message');
  const modalRestart = document.getElementById('modal-restart');
  const modalLibrary = document.getElementById('modal-library');

  const isTouch = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);

  // ---- Storage (guarded: private windows can throw) ----
  function load(k, fallback){ try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch (_) { return fallback; } }
  function save(k, v){ try { localStorage.setItem(k, String(v)); } catch (_) {} }

  const game = new PacmanGame();
  let best = parseInt(load('pacman.best', '0'), 10) || 0;
  let bestAtStart = best;
  bestEl.textContent = String(best);

  // ---- Theme (persisted) ----
  function applyTheme(t){
    document.documentElement.setAttribute('data-theme', t);
    themeBtn.setAttribute('aria-pressed', String(t === 'light'));
    themeBtn.textContent = t === 'light' ? 'Dark Theme' : 'Light Theme';
  }
  applyTheme(load('pacman.theme', 'dark'));
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next); save('pacman.theme', next);
  });

  // ---- Crisp canvas at any size / pixel density ----
  let viewScale = 1;
  function fitCanvas(){
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, (rect.width * dpr) / game.width);
    const w = Math.round(game.width * scale), h = Math.round(game.height * scale);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    viewScale = canvas.width / game.width;
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  // ---- Game flow ----
  function openModal(){ modal.classList.remove('hidden'); modalRestart.focus(); }
  function closeModal(){ modal.classList.add('hidden'); }
  function restart(){
    closeModal();
    bestAtStart = best;
    game.restart();
    canvas.focus();
  }

  restartBtn.addEventListener('click', restart);
  modalRestart.addEventListener('click', restart);
  modalLibrary.addEventListener('click', () => { window.location.href = 'index.html'; });
  pauseBtn.addEventListener('click', () => { game.togglePause(); canvas.focus(); });
  canvas.addEventListener('click', () => { canvas.focus(); if (game.paused) game.setPaused(false); });

  // Auto-pause when the player looks away
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.setPaused(true); });
  window.addEventListener('blur', () => game.setPaused(true));

  function onKey(e){
    const key = (e.key || '').toLowerCase();
    const code = e.code || '';
    const isArrow = key.startsWith('arrow') || code.startsWith('Arrow');
    if (isArrow || key === ' ') e.preventDefault();
    if (key === 'r' || code === 'KeyR') { restart(); return; }
    if (!modal.classList.contains('hidden')) return; // modal buttons handle their own keys
    if (key === 'p' || key === 'escape' || code === 'KeyP') { game.togglePause(); return; }
    if (key === 'arrowleft' || key === 'a' || code === 'KeyA') game.input('left');
    else if (key === 'arrowright' || key === 'd' || code === 'KeyD') game.input('right');
    else if (key === 'arrowup' || key === 'w' || code === 'KeyW') game.input('up');
    else if (key === 'arrowdown' || key === 's' || code === 'KeyS') game.input('down');
  }
  window.addEventListener('keydown', onKey, { passive: false });

  // ---- Mobile virtual joystick (coarse pointer devices only) ----
  (function setupVirtualJoystick(){
    const vjoy = document.getElementById('vjoy');
    if (!vjoy || !isTouch) return;
    const base = vjoy.querySelector('.vjoy-base');
    const stick = vjoy.querySelector('.vjoy-stick');
    const center = { x: 60, y: 60 };
    const maxRadius = 40;
    let dir = null;
    let repeatTimer = null;

    function setStick(dx, dy){
      const r = Math.min(maxRadius, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      stick.style.left = `${center.x}px`;
      stick.style.top = `${center.y}px`;
      stick.style.transform = `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px))`;
    }
    function resetStick(){
      stick.style.left = `${center.x}px`;
      stick.style.top = `${center.y}px`;
      stick.style.transform = 'translate(-50%, -50%)';
    }
    function computeDir(dx, dy){
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return null;
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
      return dy > 0 ? 'down' : 'up';
    }
    function stopRepeat(){ if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; } }
    function startRepeat(){
      stopRepeat();
      if (!dir) return;
      game.input(dir);
      repeatTimer = setInterval(() => game.input(dir), 150);
    }
    function onTouch(e){
      const t = e.touches[0]; if (!t) return;
      const rect = base.getBoundingClientRect();
      const dx = t.clientX - rect.left - center.x, dy = t.clientY - rect.top - center.y;
      setStick(dx, dy);
      const nd = computeDir(dx, dy);
      if (nd !== dir){ dir = nd; startRepeat(); }
      e.preventDefault();
    }
    function onEnd(){ stopRepeat(); dir = null; resetStick(); }
    base.addEventListener('touchstart', onTouch, { passive: false });
    base.addEventListener('touchmove', onTouch, { passive: false });
    base.addEventListener('touchend', onEnd, { passive: false });
    base.addEventListener('touchcancel', onEnd, { passive: false });
    resetStick();
  })();

  // ---- HUD ----
  function renderLives(n){
    livesEl.replaceChildren();
    for (let i = 0; i < Math.max(0, n); i++) {
      const s = document.createElement('span');
      s.className = 'life-icon';
      livesEl.appendChild(s);
    }
    livesEl.setAttribute('aria-label', `${n} ${n === 1 ? 'life' : 'lives'}`);
  }
  function setStatus(text){ if (statusEl.textContent !== text) statusEl.textContent = text; }
  let notice = null, noticeUntil = 0;
  function updateStatus(){
    if (game.paused) return setStatus('Paused');
    if (notice && performance.now() < noticeUntil) return setStatus(notice);
    switch (game.state) {
      case 'ready': return setStatus(game.readyTimer === null ? (isTouch ? 'Move the joystick to start' : 'Press an arrow key to start') : 'Get ready…');
      case 'dying': return setStatus('Caught!');
      case 'levelClear': return setStatus(`Level ${game.levelNum} clear!`);
      case 'gameOver': return setStatus('Game over');
      default: return setStatus('');
    }
  }

  game.on('score', s => {
    scoreEl.textContent = String(s);
    if (s > best) { best = s; bestEl.textContent = String(best); save('pacman.best', best); }
  });
  game.on('lives', renderLives);
  game.on('extralife', () => {
    notice = 'Extra life!'; noticeUntil = performance.now() + 2500;
    updateStatus();
    setTimeout(() => { notice = null; updateStatus(); }, 2600);
  });
  game.on('level', n => { levelEl.textContent = String(n); });
  game.on('state', updateStatus);
  game.on('pause', p => {
    pauseBtn.textContent = p ? 'Resume (P)' : 'Pause (P)';
    pauseBtn.setAttribute('aria-pressed', String(p));
    updateStatus();
  });
  game.on('gameover', ({ score, level }) => {
    const isBest = score > bestAtStart && score > 0;
    modalMsg.textContent = `Score ${score} · reached level ${level}.` + (isBest ? ' New best!' : ` Best: ${best}.`);
    openModal();
  });
  renderLives(game.lives);
  updateStatus();

  // ---- Main loop ----
  let last = performance.now();
  function loop(t){
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    game.step(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---- Rendering ----
  const FRIGHT = '#c4b5fd';

  function render(){
    ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, game.width, game.height);

    const st = game.state;
    // Level clear: walls flash white/blue
    const flashOn = st === 'levelClear' && Math.floor(game.clearProgress * 8) % 2 === 1;
    drawMaze(game.level, flashOn ? '#f8fafc' : game.level.wallColor);
    if (game.bonus && !(game.bonus.timer < 2 && Math.floor(game.clock * 6) % 2 === 0)) drawBonus(game.bonus.kind, game.bonus.x, game.bonus.y);

    const showGhosts = st !== 'levelClear' && st !== 'gameOver' && !(st === 'dying' && game.deathProgress > 0.15);
    if (showGhosts) {
      const ending = game.powerTimer > 0 && game.powerTimer < Math.min(2, game.diff.power * 0.4);
      const blink = ending && Math.floor(game.clock * 6) % 2 === 0;
      for (const g of game.ghosts) {
        if (g.state === 'eyes' || g.state === 'entering') drawEyes(g.x, g.y, g.dir);
        else if (g.frightened) drawScaredGhost(g.x, g.y, blink ? '#f8fafc' : FRIGHT, game.clock);
        else drawGhost(g.x, g.y, g.color, g.dir, game.clock);
      }
    }
    drawPopups();

    if (st === 'dying') drawDyingPac(game.pac.x, game.pac.y, game.deathProgress);
    else if (st !== 'gameOver') drawPac(game.pac.x, game.pac.y, game.pac.dir);

    drawOverlay();
  }

  // Floating points where a ghost was eaten (timed by game clock, so they freeze while paused)
  const popups = [];
  game.on('ghosteaten', ({ x, y, points }) => popups.push({ x, y, text: String(points), color: '#67e8f9', born: game.clock }));
  game.on('popup', ({ x, y, points }) => popups.push({ x, y, text: String(points), color: '#fde047', born: game.clock }));
  game.on('state', s => { if (s !== 'playing') popups.length = 0; });
  function drawPopups(){
    const LIFE = 1.0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 9px ui-monospace, Menlo, Consolas, monospace';
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i], age = game.clock - p.born;
      if (age > LIFE) { popups.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - Math.max(0, age - 0.6) / (LIFE - 0.6);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - age * 10);
    }
    ctx.globalAlpha = 1;
  }

  function drawOverlay(){
    let title = null, sub = null, color = '#fde047';
    if (game.paused) { title = 'PAUSED'; sub = isTouch ? 'Tap the maze to resume' : 'P / Esc to resume'; color = '#f8fafc'; }
    else if (game.state === 'ready' && game.readyTimer === null) {
      title = isTouch ? 'MOVE TO START' : 'PRESS AN ARROW KEY';
      sub = isTouch ? 'Joystick to steer · Pause button to rest' : 'Arrows / WASD to move · P to pause';
    }
    else if (game.state === 'ready') { title = 'READY!'; sub = `Level ${game.levelNum} · ${game.level.name}`; }
    else if (game.state === 'levelClear' && game.clearProgress > 0.5) { title = `LEVEL ${game.levelNum} CLEAR`; }
    else if (game.state === 'gameOver') { title = 'GAME OVER'; color = '#f87171'; }
    if (!title) return;

    const cy = game.height / 2;
    const h = sub ? 52 : 36;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, cy - h / 2, game.width, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = 'bold 18px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(title, game.width / 2, sub ? cy - 9 : cy);
    if (sub) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(sub, game.width / 2, cy + 13);
    }
  }

  function parseKey(k){ const p = k.split(','); return { x: +p[0], y: +p[1] }; }

  function drawMaze(level, wallColor){
    ctx.strokeStyle = wallColor;
    ctx.lineWidth = 2;
    for (let y = 0; y < level.rows; y++){
      for (let x = 0; x < level.cols; x++){
        if (level.grid[y][x] === '#') ctx.strokeRect(x*TILE + 2, y*TILE + 2, TILE - 4, TILE - 4);
      }
    }
    // Ghost-house door
    ctx.fillStyle = '#f9a8d4';
    for (const d of level.door) ctx.fillRect(d.x*TILE, d.y*TILE + TILE/2 - 1.5, TILE, 3);
    // Pellets
    ctx.fillStyle = '#f8fafc';
    for (const k of level.pellets){
      const { x, y } = parseKey(k);
      ctx.beginPath(); ctx.arc(x*TILE + TILE/2, y*TILE + TILE/2, 2, 0, Math.PI*2); ctx.fill();
    }
    // Power pellets
    ctx.fillStyle = '#fde68a';
    for (const k of level.powers){
      const { x, y } = parseKey(k);
      ctx.beginPath(); ctx.arc(x*TILE + TILE/2, y*TILE + TILE/2, 4, 0, Math.PI*2); ctx.fill();
    }
  }

  // Bonus items: one per level, drawn ~12px wide
  function drawBonus(kind, x, y){
    ctx.save();
    ctx.translate(x, y);
    switch (kind) {
      case 'berry':
        ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-2.5, 1); ctx.quadraticCurveTo(0, -6, 3, -6); ctx.moveTo(2.5, 2); ctx.lineTo(3, -6); ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(-3, 3, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(3, 3.5, 3.2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'lime':
        ctx.fillStyle = '#84cc16';
        ctx.beginPath(); ctx.ellipse(0, 1, 5.5, 4.5, -0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d9f99d';
        ctx.beginPath(); ctx.arc(-1.8, -0.8, 1.4, 0, Math.PI * 2); ctx.fill();
        break;
      case 'gem':
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(6, -1); ctx.lineTo(0, 6); ctx.lineTo(-6, -1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#cffafe';
        ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(2.5, -1); ctx.lineTo(-2.5, -1); ctx.closePath(); ctx.fill();
        break;
      case 'bell':
        ctx.fillStyle = '#facc15';
        ctx.beginPath(); ctx.moveTo(-5, 4); ctx.quadraticCurveTo(-5, -6, 0, -6); ctx.quadraticCurveTo(5, -6, 5, 4); ctx.closePath(); ctx.fill();
        ctx.fillRect(-6, 3, 12, 2);
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath(); ctx.arc(0, 6, 1.6, 0, Math.PI * 2); ctx.fill();
        break;
      case 'star':
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 2.6 : 6.2, a = -Math.PI / 2 + i * Math.PI / 5;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill();
        break;
      default: // crown
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath(); ctx.moveTo(-6, 4); ctx.lineTo(-6, -4); ctx.lineTo(-3, 0); ctx.lineTo(0, -5); ctx.lineTo(3, 0); ctx.lineTo(6, -4); ctx.lineTo(6, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath(); ctx.arc(0, 1.5, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  const DIR_ANGLE = { right: 0, down: Math.PI/2, left: Math.PI, up: -Math.PI/2 };

  function drawPacShape(x, y, facing, mouth){
    const r = TILE * 0.45;
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, facing + mouth, facing + 2*Math.PI - mouth);
    ctx.closePath();
    ctx.fill();
  }
  function drawPac(x, y, dir){ drawPacShape(x, y, DIR_ANGLE[dir] || 0, 0.35 * Math.PI); }
  function drawDyingPac(x, y, p){
    // Mouth opens until Pac folds away completely, facing up
    const mouth = 0.35*Math.PI + Math.min(1, p / 0.85) * 0.65*Math.PI;
    if (mouth < Math.PI - 0.01) drawPacShape(x, y, -Math.PI/2, mouth);
  }

  function ghostBody(x, y, color, t){
    const w = TILE*0.9, h = TILE*0.9;
    const left = x - w/2, top = y - h/2;
    const wob = Math.floor(t * 8) % 2 ? 1.2 : 0; // tiny skirt wobble
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(left, top + h);
    ctx.lineTo(left, top + h*0.4);
    ctx.arc(left + w*0.5, top + h*0.4, w*0.5, Math.PI, 0);
    ctx.lineTo(left + w, top + h);
    ctx.lineTo(left + w*0.75, top + h - 2 - wob);
    ctx.lineTo(left + w*0.5, top + h);
    ctx.lineTo(left + w*0.25, top + h - 2 - wob);
    ctx.closePath();
    ctx.fill();
  }

  function drawGhost(x, y, color, dir, t){
    ghostBody(x, y, color, t);
    drawEyes(x, y, dir);
  }

  function drawEyes(x, y, dir){
    const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir] || [0, 0];
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 3, y - 2, 2.8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 3, y - 2, 2.8, 0, Math.PI*2); ctx.fill();
    // Pupils look where the ghost is heading
    ctx.fillStyle = '#1e3a8a';
    ctx.beginPath(); ctx.arc(x - 3 + v[0]*1.3, y - 2 + v[1]*1.3, 1.4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 3 + v[0]*1.3, y - 2 + v[1]*1.3, 1.4, 0, Math.PI*2); ctx.fill();
  }

  function drawScaredGhost(x, y, color, t){
    ghostBody(x, y, color, t);
    // Distinct "scared" face: small dots and a zigzag mouth
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(x - 3.5, y - 3, 2, 2);
    ctx.fillRect(x + 1.5, y - 3, 2, 2);
    ctx.strokeStyle = '#1e1b4b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 3);
    ctx.lineTo(x - 2, y + 1.5); ctx.lineTo(x, y + 3); ctx.lineTo(x + 2, y + 1.5); ctx.lineTo(x + 4, y + 3);
    ctx.stroke();
  }

  requestAnimationFrame(loop);
})();
