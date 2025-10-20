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

  restartBtn.addEventListener('click', () => { closeModal(); game.restart(); statusEl.textContent=''; canvas && canvas.focus(); });
  modalRestart && modalRestart.addEventListener('click', () => { closeModal(); game.restart(); statusEl.textContent=''; canvas && canvas.focus(); });
  modalClose && modalClose.addEventListener('click', () => { closeModal(); canvas && canvas.focus(); });
  themeBtn && setThemeToggle(themeBtn);
  trackSel.addEventListener('change', () => { game.setTrack(trackSel.value); game.restart(); });
  aiSel.addEventListener('change', () => { game.setAI(aiSel.value); game.restart(); });

  // input
  const input = { throttle: 0, turn: 0 };
  function onKey(e){
    const k=(e.key||'').toLowerCase(); const c=e.code||'';
    if (k.startsWith('arrow')||c.startsWith('Arrow')) e.preventDefault();
    if (k==='r'||c==='KeyR'){ game.restart(); return; }
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
  game.on('finish', ({pos,time}) => { openModal('Race Complete', `Finish: ${pos}/4 · Time: ${time.toFixed(1)}s`); });

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

    // draw start line between wp[0] and wp[1]
    ctx.strokeStyle = '#eab308'; ctx.lineWidth=3;
    const a=wp[0], b=wp[1];
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();

    // cars
    for (const c of game.cars){ drawCar(c); }
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

