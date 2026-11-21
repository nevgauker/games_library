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

  // ---- Sound: tiny Web Audio synth, no audio files ----
  // The context can only start after a user gesture, so unlock() runs on the first key/tap.
  const Sound = (function(){
    let ac = null, master = null, siren = null;
    let muted = load('pacman.muted', '0') === '1';
    let lastChomp = 0, chompHigh = false;
    const VOLUME = 0.22;
    function unlock(){
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      master.connect(ac.destination);
    }
    function tone(freq, { to = null, dur = 0.1, type = 'square', vol = 0.5, at = 0 } = {}){
      if (!ac || muted) return;
      const t0 = ac.currentTime + at;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    const seq = (notes, step, opts) => notes.forEach((f, i) => tone(f, { ...opts, at: i * step }));
    function stopSiren(){
      if (!siren) return;
      try { siren.o.stop(); siren.lfo.stop(); } catch (_) {}
      siren = null;
    }
    return {
      unlock,
      get muted(){ return muted; },
      setMuted(m){
        muted = m; save('pacman.muted', m ? '1' : '0');
        if (master) master.gain.value = m ? 0 : VOLUME;
        if (m) stopSiren();
      },
      chomp(){
        const now = performance.now();
        if (now - lastChomp < 60) return;
        lastChomp = now; chompHigh = !chompHigh;
        tone(chompHigh ? 480 : 360, { to: chompHigh ? 360 : 480, dur: 0.07, type: 'triangle', vol: 0.4 });
      },
      power(){ tone(180, { to: 720, dur: 0.25, type: 'sawtooth', vol: 0.18 }); },
      ghost(){ tone(260, { to: 1400, dur: 0.32, type: 'square', vol: 0.2 }); },
      bonus(){ seq([660, 880, 1320], 0.07, { dur: 0.09, vol: 0.22 }); },
      extraLife(){ seq([880, 1175, 1568, 1760], 0.09, { dur: 0.14, type: 'triangle', vol: 0.4 }); },
      start(){ seq([523, 659, 784, 1047, 784, 1047], 0.11, { dur: 0.12, type: 'triangle', vol: 0.35 }); },
      clear(){ seq([784, 988, 1175, 1568, 1175, 1568], 0.08, { dur: 0.1, type: 'triangle', vol: 0.35 }); },
      death(){
        tone(720, { to: 90, dur: 1.1, type: 'sawtooth', vol: 0.22 });
        tone(140, { to: 60, dur: 0.25, type: 'square', vol: 0.25, at: 1.1 });
      },
      // Warbling tone that runs while ghosts are frightened
      siren(on){
        if (on && !siren && ac && !muted) {
          const o = ac.createOscillator(), lfo = ac.createOscillator(), depth = ac.createGain(), g = ac.createGain();
          o.type = 'triangle'; o.frequency.value = 300;
          lfo.frequency.value = 7; depth.gain.value = 80;
          lfo.connect(depth); depth.connect(o.frequency);
          g.gain.value = 0.07;
          o.connect(g); g.connect(master);
          o.start(); lfo.start();
          siren = { o, lfo };
        } else if (!on) stopSiren();
      },
    };
  })();
  ['keydown', 'pointerdown', 'touchstart'].forEach(ev => window.addEventListener(ev, Sound.unlock, { passive: true }));

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

  const soundBtn = document.getElementById('sound-btn');
  function renderSoundBtn(){
    soundBtn.textContent = Sound.muted ? 'Sound: Off (M)' : 'Sound: On (M)';
    soundBtn.setAttribute('aria-pressed', String(!Sound.muted));
  }
  function toggleSound(){ Sound.unlock(); Sound.setMuted(!Sound.muted); renderSoundBtn(); }
  soundBtn.addEventListener('click', () => { toggleSound(); canvas.focus(); });
  renderSoundBtn();

  // Swipe on the maze to steer (touch devices); each 18px of drag counts as a new swipe
  (function setupSwipe(){
    canvas.style.touchAction = 'none';
    let origin = null;
    canvas.addEventListener('touchstart', e => {
      const t = e.touches[0]; if (!t) return;
      origin = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      const t = e.touches[0]; if (!t || !origin) return;
      const dx = t.clientX - origin.x, dy = t.clientY - origin.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
      game.input(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      origin = { x: t.clientX, y: t.clientY };
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', () => { origin = null; });
  })();

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
    if (key === 'm' || code === 'KeyM') { toggleSound(); return; }
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
      case 'ready': return setStatus(game.readyTimer === null ? (isTouch ? 'Swipe or move the joystick to start' : 'Press an arrow key to start') : 'Get ready…');
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

  // ---- Sound hooks ----
  let prevState = game.state, prevReadyWaiting = true;
  game.on('eat', kind => { if (kind === 'power') Sound.power(); else Sound.chomp(); });
  game.on('ghosteaten', () => Sound.ghost());
  game.on('popup', () => Sound.bonus());
  game.on('extralife', () => Sound.extraLife());
  game.on('death', () => Sound.death());
  game.on('levelclear', () => Sound.clear());
  game.on('level', () => Sound.start()); // restart and each new level
  game.on('state', s => {
    if (s === 'playing' && prevState === 'ready' && prevReadyWaiting) Sound.start(); // very first start
    prevReadyWaiting = s === 'ready' && game.readyTimer === null;
    prevState = s;
  });

  // ---- Main loop ----
  let last = performance.now();
  function loop(t){
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    game.step(dt);
    Sound.siren(game.state === 'playing' && !game.paused && game.powerTimer > 0);
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
      sub = isTouch ? 'Swipe the maze or use the joystick' : 'Arrows / WASD to move · P to pause';
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

  // Walls are traced as continuous outlines once per maze/colour/scale and cached offscreen.
  // Each wall tile draws an edge on every side that faces open space, inset from the tile edge;
  // the edge ends are extended or shortened so neighbouring edges meet at convex and concave corners.
  let wallCacheLevel = null;
  const wallCache = new Map();
  function wallLayer(level, color){
    if (wallCacheLevel !== level) { wallCache.clear(); wallCacheLevel = level; }
    const k = color + "|" + viewScale;
    let layer = wallCache.get(k);
    if (!layer) { layer = buildWallLayer(level, color); wallCache.set(k, layer); }
    return layer;
  }
  function buildWallLayer(level, color){
    const c = document.createElement("canvas");
    c.width = Math.round(game.width * viewScale);
    c.height = Math.round(game.height * viewScale);
    const g = c.getContext("2d");
    g.setTransform(viewScale, 0, 0, viewScale, 0, 0);
    const W = (x, y) => (y < 0 || y >= level.rows || x < 0 || x >= level.cols) ? true : level.grid[y][x] === "#";
    const I = 4; // inset from the tile edge
    // Faint fill so wall blocks read as solid
    g.fillStyle = color;
    g.globalAlpha = 0.1;
    for (let y = 0; y < level.rows; y++) for (let x = 0; x < level.cols; x++) {
      if (W(x, y)) g.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
    g.globalAlpha = 1;
    g.beginPath();
    for (let y = 0; y < level.rows; y++) for (let x = 0; x < level.cols; x++) {
      if (!W(x, y)) continue;
      const px = x * TILE, py = y * TILE, T = TILE;
      // end offset along an edge: convex corner, straight continuation, or concave corner
      const endH = (side, dx) => !W(x + dx, y) ? (dx < 0 ? px + I : px + T - I)
        : !W(x + dx, y + side) ? (dx < 0 ? px : px + T) : (dx < 0 ? px - I : px + T + I);
      const endV = (side, dy) => !W(x, y + dy) ? (dy < 0 ? py + I : py + T - I)
        : !W(x + side, y + dy) ? (dy < 0 ? py : py + T) : (dy < 0 ? py - I : py + T + I);
      if (!W(x, y - 1)) { g.moveTo(endH(-1, -1), py + I); g.lineTo(endH(-1, 1), py + I); }
      if (!W(x, y + 1)) { g.moveTo(endH(1, -1), py + T - I); g.lineTo(endH(1, 1), py + T - I); }
      if (!W(x - 1, y)) { g.moveTo(px + I, endV(-1, -1)); g.lineTo(px + I, endV(-1, 1)); }
      if (!W(x + 1, y)) { g.moveTo(px + T - I, endV(1, -1)); g.lineTo(px + T - I, endV(1, 1)); }
    }
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.lineCap = "round";
    g.shadowColor = color;
    g.shadowBlur = 6 * viewScale; // neon glow (shadowBlur ignores the transform)
    g.stroke();
    g.shadowBlur = 0;
    g.stroke(); // second pass keeps the core line crisp
    return c;
  }

  function drawMaze(level, wallColor){
    ctx.drawImage(wallLayer(level, wallColor), 0, 0, game.width, game.height);
    // Ghost-house door
    ctx.fillStyle = "#f9a8d4";
    for (const d of level.door) ctx.fillRect(d.x*TILE, d.y*TILE + TILE/2 - 1.5, TILE, 3);
    // Pellets
    ctx.fillStyle = "#f8fafc";
    for (const k of level.pellets){
      const { x, y } = parseKey(k);
      ctx.beginPath(); ctx.arc(x*TILE + TILE/2, y*TILE + TILE/2, 2, 0, Math.PI*2); ctx.fill();
    }
    // Power pellets pulse while the round is live
    const live = game.state === "playing" && !game.paused;
    const r = live ? 3.6 + 1.2 * Math.sin(game.clock * 7) : 4;
    ctx.fillStyle = "#fde68a";
    ctx.shadowColor = "#fde68a";
    ctx.shadowBlur = 6 * viewScale;
    for (const k of level.powers){
      const { x, y } = parseKey(k);
      ctx.beginPath(); ctx.arc(x*TILE + TILE/2, y*TILE + TILE/2, r, 0, Math.PI*2); ctx.fill();
    }
    ctx.shadowBlur = 0;
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
  // Mouth opens and closes with distance travelled, so it stops chomping against a wall
  let chompPhase = 0.6, lastPac = null;
  function drawPac(x, y, dir){
    if (lastPac && game.state === "playing" && !game.paused) {
      const moved = Math.abs(x - lastPac.x) + Math.abs(y - lastPac.y);
      if (moved < TILE) chompPhase += moved * 0.4; // ignore tunnel wrap jumps
    }
    lastPac = { x, y };
    const mouth = (0.04 + 0.3 * Math.abs(Math.sin(chompPhase))) * Math.PI;
    drawPacShape(x, y, DIR_ANGLE[dir] || 0, mouth);
  }
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
