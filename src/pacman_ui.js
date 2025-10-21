// Pac-Man UI: canvas rendering and input wiring
(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  // ensure keyboard focus
  if (canvas) { canvas.tabIndex = 0; setTimeout(()=>canvas.focus(), 0); canvas.addEventListener('click', ()=>canvas.focus()); }

  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');
  const statusEl = document.getElementById('status');

  const restartBtn = document.getElementById('restart-btn');
  const themeBtn = document.getElementById('theme-btn');
  const modal = document.getElementById('modal');
  const modalNext = document.getElementById('modal-next');
  const modalRestart = document.getElementById('modal-restart');
  const modalClose = document.getElementById('modal-close');

  const game = new PacmanGame();
  // Match canvas to level dimensions
  canvas.width = game.width;
  canvas.height = game.height;

  let last = performance.now();
  let running = true;
  let flash = 0;

  function setThemeToggle(btn){
    const root = document.documentElement;
    function cur(){ return root.getAttribute('data-theme') || 'dark'; }
    btn.addEventListener('click', ()=>{
      const next = cur() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      btn.setAttribute('aria-pressed', String(next === 'light'));
    });
  }

  function openModal(title, msg){
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = msg;
    modal.classList.remove('hidden');
  }
  function closeModal(){ modal.classList.add('hidden'); }

  restartBtn.addEventListener('click', () => { closeModal(); game.restart(); running = true; canvas && canvas.focus(); });
  themeBtn && setThemeToggle(themeBtn);
  modalRestart && modalRestart.addEventListener('click', () => { closeModal(); game.restart(); running = true; canvas && canvas.focus(); });
  modalClose && modalClose.addEventListener('click', () => { closeModal(); canvas && canvas.focus(); });
  modalNext && modalNext.addEventListener('click', () => { closeModal(); game.nextLevel(); running = true; canvas && canvas.focus(); });

  // Mobile virtual joystick (appears only on coarse pointer devices)
  (function setupVirtualJoystick(){
    const vjoy = document.getElementById('vjoy');
    if (!vjoy) return;
    const isTouch = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (!isTouch) return;

    const base = vjoy.querySelector('.vjoy-base');
    const stick = vjoy.querySelector('.vjoy-stick');
    const center = { x: 60, y: 60 };
    const maxRadius = 40;
    let dir = null; // 'left'|'right'|'up'|'down'
    let repeatTimer = null;

    function setStick(dx, dy){
      const r = Math.hypot(dx, dy);
      const clamped = r > maxRadius ? maxRadius : r;
      const angle = Math.atan2(dy, dx);
      const x = Math.cos(angle) * clamped;
      const y = Math.sin(angle) * clamped;
      stick.style.transform = `translate(${x}px, ${y}px)`;
      stick.style.left = `${center.x}px`;
      stick.style.top = `${center.y}px`;
    }
    function resetStick(){
      stick.style.left = `${center.x}px`;
      stick.style.top = `${center.y}px`;
      stick.style.transform = 'translate(-50%, -50%)';
    }
    function computeDir(dx, dy){
      const dead = 10;
      if (Math.abs(dx) < dead && Math.abs(dy) < dead) return null;
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
      return dy > 0 ? 'down' : 'up';
    }
    function applyDir(d){ if (!d) return; game.input(d); }
    function startRepeat(){
      stopRepeat();
      if (!dir) return;
      applyDir(dir);
      repeatTimer = setInterval(() => applyDir(dir), 150);
    }
    function stopRepeat(){ if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; } }
    function localCoords(touch){
      const rect = base.getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    function onStart(e){
      const t = e.touches[0]; if (!t) return;
      const p = localCoords(t);
      const dx = p.x - center.x, dy = p.y - center.y;
      setStick(dx, dy);
      const nd = computeDir(dx, dy);
      if (nd !== dir){ dir = nd; startRepeat(); }
      e.preventDefault();
    }
    function onMove(e){
      const t = e.touches[0]; if (!t) return;
      const p = localCoords(t);
      const dx = p.x - center.x, dy = p.y - center.y;
      setStick(dx, dy);
      const nd = computeDir(dx, dy);
      if (nd !== dir){ dir = nd; startRepeat(); }
      e.preventDefault();
    }
    function onEnd(){ stopRepeat(); dir = null; resetStick(); }

    base.addEventListener('touchstart', onStart, { passive: false });
    base.addEventListener('touchmove', onMove, { passive: false });
    base.addEventListener('touchend', onEnd, { passive: false });
    base.addEventListener('touchcancel', onEnd, { passive: false });

    resetStick();
  })();

  function onKey(e){
    const key = (e.key || '').toLowerCase();
    const code = e.code || '';
    if (key.startsWith('arrow') || code.startsWith('Arrow')) e.preventDefault();
    if (key === 'r' || code === 'KeyR') { game.restart(); return; }
    if (key === 'arrowleft' || key === 'a' || code === 'ArrowLeft' || code === 'KeyA') game.input('left');
    if (key === 'arrowright' || key === 'd' || code === 'ArrowRight' || code === 'KeyD') game.input('right');
    if (key === 'arrowup' || key === 'w' || code === 'ArrowUp' || code === 'KeyW') game.input('up');
    if (key === 'arrowdown' || key === 's' || code === 'ArrowDown' || code === 'KeyS') game.input('down');
  }
  document.addEventListener('keydown', onKey, { passive: false });
  window.addEventListener('keydown', onKey, { passive: false });

  game.on('score', s => scoreEl.textContent = String(s));
  game.on('lives', l => livesEl.textContent = String(l));
  game.on('level', n => levelEl.textContent = String(n));
  game.on('win', () => { running = false; openModal('You Win!', 'All dots cleared.'); });
  game.on('lose', () => { statusEl.textContent = 'Game Over'; flash = 0.6; });

  function loop(t){
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (running) game.step(dt);
    render();
    requestAnimationFrame(loop);
  }

  function render(){
    const TILE = window.__PACMAN_CONST.TILE;
    // background
    ctx.fillStyle = '#000';
    ctx.fillRect(0,0,canvas.width, canvas.height);

    // Maze walls and dots/power
    drawMaze(game.level, TILE);

    // Ghosts
    for (const g of game.ghosts) drawGhost(g.x, g.y, g.frightened ? '#1e90ff' : g.color, TILE);

    // Pac-Man
    drawPac(game.pac.x, game.pac.y, game.pac.dir, TILE);

    if (flash > 0){
      ctx.fillStyle = `rgba(239,68,68,${flash.toFixed(3)})`;
      ctx.fillRect(0,0,canvas.width, canvas.height);
      flash = Math.max(0, flash - 0.02);
    }
  }

  function parseKey(k){ const p = k.split(','); return { x: +p[0], y: +p[1] }; }

  function drawMaze(level, TILE){
    // Walls
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    for (let y=0; y<level.rows; y++){
      for (let x=0; x<level.cols; x++){
        if (level.grid[y][x] === '#'){
          const px = x*TILE, py = y*TILE;
          ctx.strokeRect(px+2, py+2, TILE-4, TILE-4);
        }
      }
    }
    // Pellets
    ctx.fillStyle = '#f8fafc';
    for (const k of level.pellets){
      const {x,y} = parseKey(k);
      const cx = x*TILE + TILE/2, cy = y*TILE + TILE/2;
      ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI*2); ctx.fill();
    }
    // Power pellets
    ctx.fillStyle = '#fde68a';
    for (const k of level.powers){
      const {x,y} = parseKey(k);
      const cx = x*TILE + TILE/2, cy = y*TILE + TILE/2;
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI*2); ctx.fill();
    }
  }

  function drawPac(x, y, dir, TILE){
    const r = TILE*0.45;
    const mouth = 0.35 * Math.PI;
    let a0 = 0, a1 = 2*Math.PI;
    if (dir === 'right'){ a0 = mouth; a1 = 2*Math.PI - mouth; }
    if (dir === 'left'){ a0 = Math.PI + mouth; a1 = Math.PI - mouth; }
    if (dir === 'up'){ a0 = -Math.PI/2 + mouth; a1 = 3*Math.PI/2 - mouth; }
    if (dir === 'down'){ a0 = Math.PI/2 + mouth; a1 = 5*Math.PI/2 - mouth; }
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, a0, a1);
    ctx.closePath();
    ctx.fill();
  }

  function drawGhost(x, y, color, TILE){
    const w = TILE*0.9, h = TILE*0.9;
    const left = x - w/2, top = y - h/2;
    ctx.fillStyle = color;
    // head
    ctx.beginPath();
    ctx.moveTo(left, top + h);
    ctx.lineTo(left, top + h*0.4);
    ctx.arc(left + w*0.5, top + h*0.4, w*0.5, Math.PI, 0);
    ctx.lineTo(left + w, top + h);
    ctx.closePath();
    ctx.fill();
    // eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 3, y - 2, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 3, y - 2, 3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.beginPath(); ctx.arc(x - 3, y - 2, 1.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 3, y - 2, 1.5, 0, Math.PI*2); ctx.fill();
  }

  requestAnimationFrame(loop);
})();
