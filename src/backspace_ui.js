// Backspace UI + rendering
(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const ghostsEl = document.getElementById('ghosts');
  const restartBtn = document.getElementById('restart-btn');
  const themeBtn = document.getElementById('theme-btn');
  const levelSelect = document.getElementById('level-select');
  const modalEl = document.getElementById('modal');
  const modalNextBtn = document.getElementById('modal-next');
  const modalRestartBtn = document.getElementById('modal-restart');
  const modalCloseBtn = document.getElementById('modal-close');

  const TILE = window.__BACKSPACE_CONST.TILE;
  let game = null;
  let input = { left:false, right:false, jump:false };
  let raf = 0;
  let flashAlpha = 0;
  let audio = { ctx:null, master:null, enabled:true };

  init();

  function init(){
    setupTheme();
    setupInput();
    setupModal();
    setupAudio();
    restartBtn.addEventListener('click', () => reset());
    reset();
  }

  function reset(){
    const idx = Number(levelSelect?.value || 0);
    game = new BackspaceGame(idx);
    ghostsEl.textContent = '0';
    game.on('update', draw);
    game.on('ghosts', n => ghostsEl.textContent = String(n));
    game.on('win', () => { showWin(); });
    game.on('rewind', () => { flashAlpha = 0.25; playRewind(); });
    cancelAnimationFrame(raf);
    tick();
  }

  function tick(){
    game.step(input);
    raf = requestAnimationFrame(tick);
  }

  function setupInput(){
    const k = {};
    const down = e => {
      k[e.code] = true;
      mapKeys();
      if (e.code === 'Backspace') { e.preventDefault(); game.rewind(); }
      if (e.code === 'KeyR') { e.preventDefault(); reset(); }
    };
    const up = e => { k[e.code] = false; mapKeys(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    function mapKeys(){
      input.left = !!(k['ArrowLeft']||k['KeyA']);
      input.right = !!(k['ArrowRight']||k['KeyD']);
      input.jump = !!(k['Space']||k['KeyZ']||k['KeyW']||k['ArrowUp']);
    }
    levelSelect?.addEventListener('change', () => {
      reset();
      // Remove focus from selector after switching levels
      levelSelect && levelSelect.blur();
    });
  }

  function draw(){
    const w = canvas.width, h = canvas.height;
    const level = game.level;
    // Clear
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f172a';
    ctx.fillRect(0,0,w,h);
    const mapW = level.cols * TILE;
    const mapH = level.rows * TILE;
    const offX = Math.floor((w - mapW)/2);
    const offY = Math.floor((h - mapH)/2);
    const wall = '#e5e7eb';
    const accent = '#34d399';
    const goalC = '#60a5fa';
    const doorC = '#9ca3af';
    // Draw grid
    for(let y=0;y<level.rows;y++){
      for(let x=0;x<level.cols;x++){
        const t = level.grid[y][x];
        const rx = offX + x*TILE, ry= offY + y*TILE;
        if (t === '#') { rect(rx,ry,TILE,TILE, wall); }
        else if (t === 'S') { drawSwitch(rx,ry, accent); }
        else if (t === 'D') { if (!game.doorOpen) drawDoor(rx,ry, doorC); }
        else if (t === 'G') { drawGoal(rx,ry, goalC); }
      }
    }
    // Draw ghosts
    ctx.globalAlpha = 0.6;
    for (const g of game.ghosts) {
      if (!g.active) continue;
      // Trail behind ghost (faded)
      if (g.i > 0) {
        const step = 6;
        for (let t = 1; t <= 4; t++) {
          const idx = Math.max(0, g.i - t*step);
          const p = g.path[idx];
          const a = Math.max(0, 0.12 - t*0.02);
          if (!p || a <= 0) continue;
          ctx.globalAlpha = a;
          drawPlayer(offX + p.x, offY + p.y, '#a78bfa');
        }
      }
      ctx.globalAlpha = 0.6;
      drawPlayer(offX + g.x, offY + g.y, '#a78bfa');
    }
    ctx.globalAlpha = 1;
    // Draw player (red)
    drawPlayer(offX + game.player.x, offY + game.player.y, '#ef4444');

    // Highlight switch state with soft tint when door is open
    if (game.doorOpen) {
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#34d399';
      ctx.fillRect(offX, offY, level.cols*TILE, level.rows*TILE);
      ctx.globalAlpha = 1;
    }

    // Rewind flash overlay
    if (flashAlpha > 0.001) {
      ctx.globalAlpha = flashAlpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,w,h);
      ctx.globalAlpha = 1;
      flashAlpha *= 0.9;
    }
  }

  function drawPlayer(x,y,color){
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.fillStyle = color;
    roundRect(-8, -22, 16, 22, 4);
    ctx.restore();
  }

  function rect(x,y,w,h,color){ ctx.fillStyle=color; ctx.fillRect(x,y,w,h); }
  function drawSwitch(x,y,c){
    ctx.strokeStyle=c; ctx.lineWidth=2; ctx.beginPath();
    ctx.arc(x+TILE/2, y+TILE/2, 6, 0, Math.PI*2); ctx.stroke();
    if (game && game.doorOpen) {
      ctx.fillStyle = '#34d399';
      ctx.globalAlpha = 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  function drawDoor(x,y,c){ rect(x+TILE/3,y, TILE/3, TILE, c); }
  function drawGoal(x,y,c){ ctx.fillStyle=c; roundRect(x+6,y+6,TILE-12,TILE-12,4); }

  function roundRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath(); ctx.fill();
  }

  // Theme handling
  function setupTheme(){
    const key = 'memory.theme';
    const saved = localStorage.getItem(key);
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = saved || (prefersLight ? 'light' : 'dark');
    applyTheme(theme);
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      localStorage.setItem(key, next);
    });
  }
  function applyTheme(theme){
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme','light');
      themeBtn.setAttribute('aria-pressed','true');
      themeBtn.textContent='Dark Theme';
    } else {
      document.documentElement.setAttribute('data-theme','dark');
      themeBtn.setAttribute('aria-pressed','false');
      themeBtn.textContent='Light Theme';
    }
  }

  // Modal helpers
  function setupModal(){
    modalRestartBtn.addEventListener('click', () => { hideModal(); reset(); });
    modalCloseBtn.addEventListener('click', hideModal);
    modalNextBtn.addEventListener('click', () => {
      const max = window.__BACKSPACE_CONST.LEVELS_COUNT || 1;
      let idx = Number(levelSelect?.value || 0);
      if (idx < max - 1) idx += 1; else idx = 0;
      if (levelSelect) levelSelect.value = String(idx);
      hideModal();
      reset();
      // Remove focus from selector after programmatic switch
      levelSelect && levelSelect.blur();
    });
  }
  function showWin(){
    const max = window.__BACKSPACE_CONST.LEVELS_COUNT || 1;
    const idx = Number(levelSelect?.value || 0);
    if (idx >= max - 1) { modalNextBtn.disabled = true; modalNextBtn.textContent = 'Next Level ▶'; }
    else { modalNextBtn.disabled = false; modalNextBtn.textContent = 'Next Level ▶'; }
    modalEl.classList.remove('hidden');
  }
  function hideModal(){ modalEl.classList.add('hidden'); }

  // Minimal audio: unlock on interaction; rewind whoosh
  function setupAudio(){
    const unlock = () => {
      try{
        if (!audio.ctx) audio.ctx = new (window.AudioContext||window.webkitAudioContext)();
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
        if (!audio.master){ audio.master = audio.ctx.createGain(); audio.master.gain.value = 0.18; audio.master.connect(audio.ctx.destination); }
      }catch{}
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once:true });
    window.addEventListener('keydown', unlock, { once:true });
  }

  function playRewind(){
    if (!audio.ctx || !audio.master) return;
    const ctx = audio.ctx;
    const t = ctx.currentTime + 0.002;
    const o = ctx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(240, t+0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t+0.02); g.gain.exponentialRampToValueAtTime(0.0001, t+0.22);
    o.connect(g); g.connect(audio.master); o.start(t); o.stop(t+0.24);
    const nbuf = ctx.createBuffer(1, 2048, ctx.sampleRate); const d = nbuf.getChannelData(0); for (let i=0;i<d.length;i++) d[i] = (Math.random()*2-1)*0.6;
    const nsrc = ctx.createBufferSource(); nsrc.buffer = nbuf; const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.setValueAtTime(700, t); bp.Q.value=3;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.1, t); ng.gain.exponentialRampToValueAtTime(0.0001, t+0.18);
    nsrc.connect(bp); bp.connect(ng); ng.connect(audio.master); nsrc.start(t); nsrc.stop(t+0.2);
  }
})();
