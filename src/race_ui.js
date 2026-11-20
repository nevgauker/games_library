// Micro Racer UI: canvas render + input + HUD
(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  if (canvas) { canvas.tabIndex = 0; setTimeout(()=>canvas.focus(), 0); canvas.addEventListener('click', ()=>canvas.focus()); }

  const lapEl = document.getElementById('lap');
  const posEl = document.getElementById('pos');
  const timeEl = document.getElementById('time');
  const statusEl = document.getElementById('status');

  const restartBtn = document.getElementById('restart-btn');
  const themeBtn = document.getElementById('theme-btn');
  const trackSel = document.getElementById('track-select');
  const aiSel = document.getElementById('ai-select');
  const modal = document.getElementById('modal');
  const modalRestart = document.getElementById('modal-restart');
  const modalClose = document.getElementById('modal-close');

  const game = new RaceGame();
  canvas.width = game.width; canvas.height = game.height;
  document.getElementById('lap-total').textContent = String(game.laps);
  document.getElementById('car-total').textContent = String(game.cars.length);

  function ordinal(n){ const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); }

  function setThemeToggle(btn){
    const root = document.documentElement;
    function cur(){ return root.getAttribute('data-theme') || 'dark'; }
    btn.addEventListener('click', ()=>{
      const next = cur() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      btn.setAttribute('aria-pressed', String(next === 'light'));
    });
  }
  function openModal(title, msg){ document.getElementById('modal-title').textContent = title; document.getElementById('modal-message').textContent = msg; modal.classList.remove('hidden'); }
  function closeModal(){ modal.classList.add('hidden'); }

  // Every way of starting over goes through here so the modal, status and input are always reset
  function resetRace(){
    closeModal();
    input.throttle = 0; input.turn = 0;
    game.restart();
    canvas && canvas.focus();
  }

  restartBtn.addEventListener('click', resetRace);
  modalRestart && modalRestart.addEventListener('click', resetRace);
  modalClose && modalClose.addEventListener('click', () => { closeModal(); canvas && canvas.focus(); });
  themeBtn && setThemeToggle(themeBtn);
  trackSel.addEventListener('change', () => { game.setTrack(trackSel.value); resetRace(); });
  aiSel.addEventListener('change', () => { game.setAI(aiSel.value); resetRace(); });

  // input
  const input = { throttle: 0, turn: 0 };
  function onKey(e){
    const k=(e.key||'').toLowerCase(); const c=e.code||'';
    if (k.startsWith('arrow')||c.startsWith('Arrow')) e.preventDefault();
    if (e.target && e.target.tagName === 'SELECT') return; // let the dropdowns use their own keys
    if (k==='r'||c==='KeyR'){ if (!e.repeat) resetRace(); return; }
    if (k==='arrowup'||k==='w'||c==='ArrowUp'||c==='KeyW') input.throttle = 1;
    if (k==='arrowdown'||k==='s'||c==='ArrowDown'||c==='KeyS') input.throttle = -1;
    if (k==='arrowleft'||k==='a'||c==='ArrowLeft'||c==='KeyA') input.turn = -1;
    if (k==='arrowright'||k==='d'||c==='ArrowRight'||c==='KeyD') input.turn = 1;
  }
  function onKeyUp(e){
    const k=(e.key||'').toLowerCase(); const c=e.code||'';
    if (k==='arrowup'||k==='w'||c==='ArrowUp'||c==='KeyW') if (input.throttle>0) input.throttle = 0;
    if (k==='arrowdown'||k==='s'||c==='ArrowDown'||c==='KeyS') if (input.throttle<0) input.throttle = 0;
    if (k==='arrowleft'||k==='a'||c==='ArrowLeft'||c==='KeyA') if (input.turn<0) input.turn = 0;
    if (k==='arrowright'||k==='d'||c==='ArrowRight'||c==='KeyD') if (input.turn>0) input.turn = 0;
  }
  document.addEventListener('keydown', onKey, { passive:false });
  document.addEventListener('keyup', onKeyUp, { passive:false });

  // events
  game.on('lap', ({lap,total}) => lapEl.textContent = String(Math.min(lap,total)));
  game.on('pos', p => posEl.textContent = String(p));
  game.on('time', t => timeEl.textContent = (t).toFixed(1));
  game.on('status', s => statusEl.textContent = s||'');
  game.on('finish', ({pos,time}) => {
    const title = pos === 1 ? 'You Win!' : 'Race Complete';
    openModal(title, `You finished ${ordinal(pos)} of ${game.cars.length} · Time: ${time.toFixed(1)}s`);
  });

  let last = performance.now();
  function loop(t){
    const dt = Math.min(0.05, (t-last)/1000); last=t;
    game.input(input);
    game.step(dt);
    render();
    requestAnimationFrame(loop);
  }

  function render(){
    // background
    ctx.fillStyle = '#07111f'; ctx.fillRect(0,0,canvas.width, canvas.height);
    // track: draw path by connecting waypoints as dashed inner lines
    const wp = game.track.waypoints;
    ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 2; ctx.setLineDash([8,8]);
    ctx.beginPath();
    for (let i=0;i<wp.length;i++){
      const [x,y]=wp[i]; if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);

    drawCheckpoints();
    drawStartLine();

    // cars
    for (const c of game.cars){ drawCar(c); }

    drawCountdown();
  }

  // Checkered line across the track at gate 0
  function drawStartLine(){
    const g = game.gates[0];
    const nx = -g.ty, ny = g.tx; // across the track
    const half = 28, sq = 4;
    ctx.save();
    ctx.translate(g.x, g.y); ctx.transform(nx, ny, g.tx, g.ty, 0, 0);
    for (let i = -half; i < half; i += sq){
      for (let j = 0; j < 2; j++){
        ctx.fillStyle = ((i/sq + j) & 1) ? '#f8fafc' : '#0f172a';
        ctx.fillRect(i, (j-1)*sq, sq, sq);
      }
    }
    ctx.restore();
  }

  // Faint dots on every checkpoint, the player's next one highlighted
  function drawCheckpoints(){
    const p = game.player;
    game.gates.forEach((g, i) => {
      if (i === 0) return; // the start line marks gate 0
      const next = !p.finished && p.started && i === p.gate;
      ctx.beginPath(); ctx.arc(g.x, g.y, next ? 6 : 3, 0, Math.PI*2);
      ctx.fillStyle = next ? '#34d399' : 'rgba(14,165,233,0.45)';
      ctx.fill();
      if (next){ ctx.strokeStyle = 'rgba(52,211,153,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.x, g.y, 12, 0, Math.PI*2); ctx.stroke(); }
    });
  }

  function drawCountdown(){
    let text = null;
    if (game.countdown > 0) text = String(Math.ceil(game.countdown));
    else if (game.clock < 0.8) text = 'GO!';
    if (!text) return;
    ctx.save();
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(7,17,31,0.85)';
    ctx.fillStyle = text === 'GO!' ? '#34d399' : '#eab308';
    ctx.strokeText(text, canvas.width/2, canvas.height/2);
    ctx.fillText(text, canvas.width/2, canvas.height/2);
    ctx.restore();
  }

  function drawCar(c){
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(c.a);
    ctx.fillStyle = c.color;
    // triangle car
    ctx.beginPath();
    ctx.moveTo(10,0); ctx.lineTo(-8,-6); ctx.lineTo(-8,6); ctx.closePath();
    ctx.fill();
    // cockpit
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(-4,-3,6,6);
    ctx.restore();
  }

  requestAnimationFrame(loop);
})();

