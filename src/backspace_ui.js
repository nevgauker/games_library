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
  let lastTime = 0, acc = 0;
  const STEP_MS = 1000 / 60;
  let flashAlpha = 0;
  let audio = { ctx:null, master:null, enabled:true };

  init();

  function init(){
    setupTheme();
    setupInput();
    setupModal();
    setupAudio();
    buildLevelSelect();
    restartBtn.addEventListener('click', () => reset());
    reset();
  }

  function reset(){
    const idx = Number(levelSelect?.value || 0);
    game = new BackspaceGame(idx);
    const showEchoes = n => { ghostsEl.textContent = `${n} / ${game.maxEchoes}`; };
    showEchoes(game.echoesLeft());
    game.on('echoes', showEchoes);
    game.on('win', () => { showWin(); });
    game.on('rewind', e => { flashAlpha = 0.25; playRewind(); statusEl.textContent = `Echo replays your last ${(e.path.length/60).toFixed(1)}s`; });
    game.on('rewind-denied', why => { statusEl.textContent = why === 'echoes' ? 'No echoes left - U undoes the last one' : 'Nothing to rewind yet'; });
    game.on('scrub-start', () => { statusEl.textContent = 'Rewinding... release to leave an echo'; });
    game.on('scrub-cancel', () => { statusEl.textContent = 'Too short - hold longer to rewind'; });
    game.on('undo', () => { statusEl.textContent = 'Echo removed'; });
    statusEl.textContent = game.def.hint || '';
    cancelAnimationFrame(raf);
    lastTime = 0; acc = 0;
    raf = requestAnimationFrame(tick);
  }

  // Fixed 60 Hz simulation so speed is the same on every monitor
  function tick(now){
    if (!lastTime) lastTime = now;
    acc += Math.min(250, now - lastTime);
    lastTime = now;
    while (acc >= STEP_MS) { game.step(input); acc -= STEP_MS; }
    draw();
    raf = requestAnimationFrame(tick);
  }

  function buildLevelSelect(){
    const levels = window.BACKSPACE_LEVELS || [];
    levelSelect.innerHTML = levels.map((l, i) => `<option value="${i}">${i + 1}. ${l.name}</option>`).join('');
  }

  function setupInput(){
    const k = {};
    const down = e => {
      k[e.code] = true;
      mapKeys();
      if (e.code === 'Backspace') e.preventDefault();
      if (e.repeat) return; // ignore auto-repeat: one press = one action
      if (e.code === 'KeyU' || e.code === 'Delete') { e.preventDefault(); game.undoEcho(); }
      if (e.code === 'KeyR') { e.preventDefault(); reset(); }
    };
    const up = e => { k[e.code] = false; mapKeys(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    function mapKeys(){
      input.left = !!(k['ArrowLeft']||k['KeyA']);
      input.right = !!(k['ArrowRight']||k['KeyD']);
      input.jump = !!(k['Space']||k['KeyZ']||k['KeyW']||k['ArrowUp']);
      input.rewind = !!(k['Backspace']||k['KeyX']);
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
    const t = game.viewT; // during a scrub the world previews the past
    const power = game.scrubbing ? game.powerAt(t) : game.power;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f172a';
    ctx.fillRect(0,0,w,h);
    const offX = Math.floor((w - level.cols * TILE)/2);
    const offY = Math.floor((h - level.rows * TILE)/2);
    const C = window.__BACKSPACE_CONST;
    for(let y=0;y<level.rows;y++){
      for(let x=0;x<level.cols;x++){
        const c = level.grid[y][x];
        const rx = offX + x*TILE, ry= offY + y*TILE;
        if (c === '#') rect(rx,ry,TILE,TILE, '#e5e7eb');
        else if (C.PLATE[c]) drawSwitch(rx,ry, '#34d399', power[C.PLATE[c]]);
        else if (C.DOOR[c]) { if (!power[C.DOOR[c]]) drawDoor(rx,ry, '#9ca3af'); }
        else if (c === 'G') drawGoal(rx,ry, '#60a5fa');
      }
    }
    // Echoes, positioned on the timeline
    for (const e of game.echoes) {
      const s = game.echoAt(e, t);
      if (!s) continue;
      const k = t - e.start, left = 1 - k / (e.path.length - 1);
      ctx.globalAlpha = 0.65;
      drawPlayer(offX + s.x, offY + s.y, '#a78bfa');
      ctx.globalAlpha = 1;
      drawRing(offX + s.x, offY + s.y - 30, left, '#a78bfa');
    }
    if (game.scrubbing) {
      // The path the new echo will replay
      ctx.strokeStyle = '#a78bfa'; ctx.globalAlpha = 0.5; ctx.setLineDash([3,4]); ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = t; i <= game.T; i++) { const p = game.history[i]; const fn = i === t ? 'moveTo' : 'lineTo'; ctx[fn](offX + p.x, offY + p.y - 10); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      const p = game.history[t];
      drawPlayer(offX + p.x, offY + p.y, '#ef4444');
      // Tint the world while time runs backwards
      ctx.globalAlpha = 0.08; ctx.fillStyle = '#a78bfa'; ctx.fillRect(0,0,w,h); ctx.globalAlpha = 1;
    } else {
      drawPlayer(offX + game.player.x, offY + game.player.y, '#ef4444');
    }

    if (flashAlpha > 0.001) {
      ctx.globalAlpha = flashAlpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,w,h);
      ctx.globalAlpha = 1;
      flashAlpha *= 0.9;
    }
  }

  function drawRing(x, y, frac, color){
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4, -Math.PI/2, -Math.PI/2 + Math.PI*2*Math.max(0, frac)); ctx.stroke();
  }

  function drawPlayer(x,y,color){
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.fillStyle = color;
    roundRect(-8, -22, 16, 22, 4);
    ctx.restore();
  }

  function rect(x,y,w,h,color){ ctx.fillStyle=color; ctx.fillRect(x,y,w,h); }
  function drawSwitch(x,y,c,on){
    ctx.strokeStyle=c; ctx.lineWidth=2; ctx.beginPath();
    ctx.arc(x+TILE/2, y+TILE/2, 6, 0, Math.PI*2); ctx.stroke();
    if (on) {
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
    const last = idx >= max - 1;
    modalNextBtn.classList.toggle('hidden', last);
    document.getElementById('modal-title').textContent = last ? 'All levels complete!' : 'Level complete!';
    document.getElementById('modal-message').textContent = last
      ? `You beat every level using ${game.ghostsUsed} echo(es) on the final one.`
      : `Solved with ${game.ghostsUsed} echo(es).`;
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
