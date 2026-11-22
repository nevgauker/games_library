// Backspace UI + rendering
(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const ghostsEl = document.getElementById('ghosts');
  const restartBtn = document.getElementById('restart-btn');
  const themeBtn = document.getElementById('theme-btn');
  const soundBtn = document.getElementById('sound-btn');
  const levelSelect = document.getElementById('level-select');
  const modalEl = document.getElementById('modal');
  const modalNextBtn = document.getElementById('modal-next');
  const modalRestartBtn = document.getElementById('modal-restart');
  const modalCloseBtn = document.getElementById('modal-close');

  const C = window.__BACKSPACE_CONST;
  const TILE = C.TILE;
  const STEP_MS = 1000 / 60;
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let game = null;
  const input = { left:false, right:false, jump:false, rewind:false };
  let raf = 0, lastTime = 0, acc = 0;
  let flashAlpha = 0;

  // --- Juice state (purely visual, never affects the simulation) ---
  const fx = {
    particles: [],
    shake: 0,
    squash: 0,      // >0 = squashed (landing), <0 = stretched (jump)
    doorAnim: {},   // channel -> 0..1 openness for smooth slide
    plateGlow: {},  // channel -> 0..1
    bob: 0,
  };

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
    fx.particles.length = 0; fx.shake = 0; fx.squash = 0;
    for (const ch of ['a','b','c']) { fx.doorAnim[ch] = game.power[ch] ? 1 : 0; fx.plateGlow[ch] = 0; }
    const showEchoes = n => { ghostsEl.textContent = `${n} / ${game.maxEchoes}`; };
    showEchoes(game.echoesLeft());
    game.on('echoes', showEchoes);
    game.on('win', () => { sfx.win(); burst(game.player.x, game.player.y - 10, 28, '#60a5fa', 3); setTimeout(showWin, 450); });
    game.on('rewind', e => {
      flashAlpha = 0.25; sfx.rewind();
      statusEl.textContent = `Echo replays your last ${(e.path.length/60).toFixed(1)}s`;
      const s = e.path[0]; burst(s.x, s.y - 10, 14, '#a78bfa', 2);
    });
    game.on('rewind-denied', why => { sfx.denied(); statusEl.textContent = why === 'echoes' ? 'No echoes left - U undoes the last one' : 'Nothing to rewind yet'; });
    game.on('scrub-start', () => { statusEl.textContent = 'Rewinding... release to leave an echo'; });
    game.on('scrub-cancel', () => { statusEl.textContent = 'Too short - hold longer to rewind'; });
    game.on('undo', () => { sfx.undo(); statusEl.textContent = 'Echo removed'; });
    game.on('jump', () => { fx.squash = -1; sfx.jump(); dust(game.player.x, game.player.y, 5); });
    game.on('land', v => {
      if (v < 2.5) return;
      fx.squash = Math.min(1, v / 8); sfx.land(v);
      dust(game.player.x, game.player.y, Math.round(v));
    });
    game.on('door-open', () => sfx.door(true));
    game.on('door-close', () => { sfx.door(false); if (!reducedMotion) fx.shake = Math.max(fx.shake, 3); });
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
    while (acc >= STEP_MS) {
      const wasScrub = game.scrubbing;
      game.step(input);
      if (game.scrubbing && (!wasScrub || game.T % 6 === 0)) sfx.tick(game.scrub / C.MAX_REWIND);
      updateFx();
      acc -= STEP_MS;
    }
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
      if (['Backspace','Space','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
      if (e.repeat) return; // ignore auto-repeat: one press = one action
      if (e.code === 'KeyU' || e.code === 'Delete') { e.preventDefault(); game.undoEcho(); }
      if (e.code === 'KeyR') { e.preventDefault(); reset(); }
      if (e.code === 'KeyM') toggleSound();
    };
    const up = e => { k[e.code] = false; mapKeys(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => { for (const key in k) k[key] = false; mapKeys(); });
    function mapKeys(){
      input.left = !!(k['ArrowLeft']||k['KeyA']);
      input.right = !!(k['ArrowRight']||k['KeyD']);
      input.jump = !!(k['Space']||k['KeyZ']||k['KeyW']||k['ArrowUp']);
      input.rewind = !!(k['Backspace']||k['KeyX']);
    }
    levelSelect?.addEventListener('change', () => {
      reset();
      levelSelect && levelSelect.blur();
    });
  }

  // ---------- Effects ----------
  function updateFx(){
    for (const p of fx.particles) { p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life--; }
    fx.particles = fx.particles.filter(p => p.life > 0);
    fx.shake *= 0.82; if (fx.shake < 0.1) fx.shake = 0;
    fx.squash *= 0.8; if (Math.abs(fx.squash) < 0.02) fx.squash = 0;
    fx.bob += 0.08;
    const power = game.scrubbing ? game.powerAt(game.viewT) : game.power;
    for (const ch of ['a','b','c']) {
      fx.doorAnim[ch] += ((power[ch] ? 1 : 0) - fx.doorAnim[ch]) * 0.35;
      fx.plateGlow[ch] += ((power[ch] ? 1 : 0) - fx.plateGlow[ch]) * 0.25;
    }
    // little running dust
    const p = game.player;
    if (!game.scrubbing && p.onGround && Math.abs(p.vx) > 1.6 && game.T % 7 === 0) dust(p.x - p.face*4, p.y, 1);
  }
  function dust(x, y, n){
    if (reducedMotion) n = Math.min(n, 2);
    for (let i = 0; i < n; i++) fx.particles.push({ x: x + (Math.random()-0.5)*10, y, vx: (Math.random()-0.5)*1.6, vy: -Math.random()*1.2, g: 0.05, life: 18 + Math.random()*10, max: 28, color: null, r: 1.5 + Math.random()*1.5 });
  }
  function burst(x, y, n, color, speed){
    if (reducedMotion) n = Math.round(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random()*Math.PI*2, v = speed * (0.4 + Math.random());
      fx.particles.push({ x, y, vx: Math.cos(a)*v, vy: Math.sin(a)*v, g: 0.02, life: 30 + Math.random()*20, max: 50, color, r: 1.5 + Math.random()*2 });
    }
  }

  // ---------- Rendering ----------
  function draw(){
    const w = canvas.width, h = canvas.height;
    const level = game.level;
    const t = game.viewT; // during a scrub the world previews the past
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f172a';
    ctx.fillRect(0,0,w,h);
    let offX = Math.floor((w - level.cols * TILE)/2);
    let offY = Math.floor((h - level.rows * TILE)/2);
    if (fx.shake) { offX += Math.round((Math.random()-0.5)*fx.shake*2); offY += Math.round((Math.random()-0.5)*fx.shake*2); }
    ctx.translate(offX, offY);

    for(let y=0;y<level.rows;y++){
      for(let x=0;x<level.cols;x++){
        const c = level.grid[y][x];
        const rx = x*TILE, ry= y*TILE;
        if (c === '#') rect(rx,ry,TILE,TILE, '#e5e7eb');
        else if (C.PLATE[c]) drawPlate(rx,ry, '#34d399', fx.plateGlow[C.PLATE[c]]);
        else if (C.DOOR[c]) drawDoor(rx,ry, '#9ca3af', fx.doorAnim[C.DOOR[c]]);
        else if (c === 'G') drawGoal(rx,ry, '#60a5fa');
      }
    }

    // Echoes, positioned on the timeline
    for (const e of game.echoes) {
      const s = game.echoAt(e, t);
      if (!s) continue;
      const k = t - e.start, left = 1 - k / (e.path.length - 1);
      const fade = Math.min(1, k / 8, (e.path.length - 1 - k) / 8);
      ctx.globalAlpha = 0.65 * Math.max(0.2, fade);
      drawBody(s.x, s.y, '#a78bfa', s.face, 0);
      ctx.globalAlpha = 1;
      drawRing(s.x, s.y - 30, left, '#a78bfa');
    }

    if (game.scrubbing) {
      // The path the new echo will replay
      ctx.strokeStyle = '#a78bfa'; ctx.globalAlpha = 0.5; ctx.setLineDash([3,4]); ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = t; i <= game.T; i++) { const p = game.history[i]; ctx[i === t ? 'moveTo' : 'lineTo'](p.x, p.y - 10); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      const p = game.history[t];
      drawBody(p.x, p.y, '#ef4444', p.face, 0);
    } else {
      const p = game.player;
      let sq = fx.squash;
      if (!p.onGround && !sq) sq = Math.max(-0.5, Math.min(0.3, -p.vy / 14));
      drawBody(p.x, p.y, '#ef4444', p.face, sq, Math.abs(p.vx) > 0.3 && p.onGround);
    }

    // Particles
    for (const pt of fx.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max) * (pt.color ? 0.9 : 0.45);
      ctx.fillStyle = pt.color || '#e5e7eb';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1,0,0,1,0,0);

    if (game.scrubbing) {
      // Tint + scrub meter while time runs backwards
      ctx.globalAlpha = 0.08; ctx.fillStyle = '#a78bfa'; ctx.fillRect(0,0,w,h); ctx.globalAlpha = 1;
      const frac = game.scrub / C.MAX_REWIND;
      ctx.fillStyle = '#a78bfa';
      ctx.fillRect(offX, offY - 10, level.cols * TILE * frac, 4);
      ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(`-${(game.scrub/60).toFixed(1)}s`, offX + level.cols * TILE, offY - 16);
      ctx.textAlign = 'left';
    }

    if (flashAlpha > 0.001) {
      ctx.globalAlpha = flashAlpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,w,h);
      ctx.globalAlpha = 1;
      flashAlpha *= 0.9;
    }
  }

  // Squash/stretch body with eyes that look where you're heading
  function drawBody(x, y, color, face, squash, running){
    const sx = 1 + squash * 0.35, sy = 1 - squash * 0.35;
    const bw = 16 * sx, bh = 22 * sy;
    const bob = running ? Math.sin(fx.bob * 4) * 0.8 : 0;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y + bob));
    ctx.fillStyle = color;
    roundRect(-bw/2, -bh, bw, bh, 4);
    const ex = (face || 1) * 2.5, ey = -bh + 7;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ex - 4, ey, 3, 4); ctx.fillRect(ex + 1, ey, 3, 4);
    ctx.fillStyle = '#111827';
    ctx.fillRect(ex - 4 + (face > 0 ? 1 : 0), ey + 1, 2, 2); ctx.fillRect(ex + 1 + (face > 0 ? 1 : 0), ey + 1, 2, 2);
    ctx.restore();
  }

  function drawRing(x, y, frac, color){
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4, -Math.PI/2, -Math.PI/2 + Math.PI*2*Math.max(0, frac)); ctx.stroke();
  }

  function rect(x,y,w,h,color){ ctx.fillStyle=color; ctx.fillRect(x,y,w,h); }
  function drawPlate(x,y,c,glow){
    const press = glow * 2;
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.35 + glow * 0.65;
    roundRect(x+3, y+TILE-5+press, TILE-6, 5-press, 2);
    if (glow > 0.05) {
      ctx.globalAlpha = glow * 0.25;
      ctx.beginPath(); ctx.arc(x+TILE/2, y+TILE-3, 12, Math.PI, 0); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawDoor(x,y,c,open){
    const hgt = TILE * (1 - open);
    if (hgt > 0.5) rect(x+TILE/3, y, TILE/3, hgt, c);
  }
  function drawGoal(x,y,c){
    const pulse = reducedMotion ? 0 : Math.sin(fx.bob) * 1.5;
    ctx.fillStyle = c; ctx.globalAlpha = 0.25; roundRect(x+3-pulse, y+3-pulse, TILE-6+pulse*2, TILE-6+pulse*2, 6);
    ctx.globalAlpha = 1; roundRect(x+7, y+7, TILE-14, TILE-14, 3);
  }

  function roundRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath(); ctx.fill();
  }

  // ---------- Theme ----------
  function setupTheme(){
    const key = 'memory.theme';
    const saved = safeGet(key);
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(saved || (prefersLight ? 'light' : 'dark'));
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      safeSet(key, next);
    });
  }
  function applyTheme(theme){
    const light = theme === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    themeBtn.setAttribute('aria-pressed', String(light));
    themeBtn.textContent = light ? 'Dark Theme' : 'Light Theme';
  }

  // ---------- Modal ----------
  function setupModal(){
    modalRestartBtn.addEventListener('click', () => { hideModal(); reset(); });
    modalCloseBtn.addEventListener('click', hideModal);
    modalNextBtn.addEventListener('click', () => {
      const max = C.LEVELS_COUNT || 1;
      let idx = Number(levelSelect?.value || 0);
      idx = idx < max - 1 ? idx + 1 : 0;
      if (levelSelect) levelSelect.value = String(idx);
      hideModal();
      reset();
      levelSelect && levelSelect.blur();
    });
  }
  function showWin(){
    const max = C.LEVELS_COUNT || 1;
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

  // ---------- Audio (tiny WebAudio synth) ----------
  const audio = { ctx:null, master:null, muted: safeGet('backspace.muted') === '1' };
  function setupAudio(){
    updateSoundBtn();
    soundBtn?.addEventListener('click', () => { toggleSound(); soundBtn.blur(); });
    const unlock = () => {
      try{
        if (!audio.ctx) audio.ctx = new (window.AudioContext||window.webkitAudioContext)();
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
        if (!audio.master){ audio.master = audio.ctx.createGain(); audio.master.connect(audio.ctx.destination); }
        audio.master.gain.value = audio.muted ? 0 : 0.18;
      }catch{}
    };
    window.addEventListener('pointerdown', unlock, { once:true });
    window.addEventListener('keydown', unlock, { once:true });
  }
  function toggleSound(){
    audio.muted = !audio.muted;
    safeSet('backspace.muted', audio.muted ? '1' : '0');
    if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.18;
    updateSoundBtn();
  }
  function updateSoundBtn(){
    if (!soundBtn) return;
    soundBtn.textContent = audio.muted ? 'Sound: Off (M)' : 'Sound: On (M)';
    soundBtn.setAttribute('aria-pressed', String(!audio.muted));
  }
  function tone(type, f0, f1, dur, vol, delay = 0){
    if (!audio.ctx || !audio.master || audio.muted) return;
    const a = audio.ctx, t = a.currentTime + 0.002 + delay;
    const o = a.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(freq, dur, vol){
    if (!audio.ctx || !audio.master || audio.muted) return;
    const a = audio.ctx, t = a.currentTime + 0.002;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random()*2-1;
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 2;
    const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(audio.master); src.start(t);
  }
  const sfx = {
    jump: () => tone('square', 320, 640, 0.09, 0.06),
    land: v => noise(220, 0.06 + v * 0.01, Math.min(0.25, 0.05 + v * 0.02)),
    door: open => open ? tone('triangle', 260, 520, 0.12, 0.12) : (tone('triangle', 300, 110, 0.14, 0.14), noise(140, 0.1, 0.15)),
    rewind: () => { tone('sine', 900, 240, 0.22, 0.22); noise(700, 0.18, 0.1); },
    tick: frac => tone('sine', 700 - frac * 400, 680 - frac * 400, 0.04, 0.05),
    denied: () => tone('square', 160, 120, 0.12, 0.08),
    undo: () => tone('sine', 400, 700, 0.1, 0.1),
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.18, 0.12, i * 0.08)),
  };

  function safeGet(k){ try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v){ try { localStorage.setItem(k, v); } catch {} }

  init();
})();
