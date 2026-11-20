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
    ctx.drawImage(trackLayer(), 0, 0);
    for (const c of game.cars){ drawCar(c); }
    drawWrongWay();
    drawCountdown();
  }

  // The track never changes during a race, so draw it once per track onto an offscreen canvas
  let trackCache = null, cachedRoad = null;
  function trackLayer(){
    if (cachedRoad === game.road) return trackCache;
    const R = cachedRoad = game.road;
    const off = trackCache = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const g = off.getContext('2d');

    // grass, with a fixed speckle so it doesn't shimmer between restarts
    g.fillStyle = '#0b2416'; g.fillRect(0, 0, off.width, off.height);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1100; i++){
      g.fillStyle = rnd() < 0.5 ? 'rgba(52,211,153,0.07)' : 'rgba(0,0,0,0.2)';
      g.fillRect(rnd() * off.width, rnd() * off.height, 2, 2);
    }

    const path = new Path2D();
    R.pts.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y));
    path.closePath();
    g.lineJoin = 'round'; g.lineCap = 'round';
    // red/white curbs just outside the road edge
    g.lineWidth = 2*R.half + 8; g.strokeStyle = '#e2e8f0'; g.stroke(path);
    g.setLineDash([10, 10]); g.strokeStyle = '#e11d48'; g.stroke(path); g.setLineDash([]);
    // asphalt and a faint centre line
    g.lineWidth = 2*R.half; g.strokeStyle = '#2b313d'; g.stroke(path);
    g.lineWidth = 1.5; g.setLineDash([10, 14]); g.strokeStyle = 'rgba(226,232,240,0.22)'; g.stroke(path); g.setLineDash([]);

    drawStartLine(g, R);
    return off;
  }

  // Checkered line across the road at the start of the centerline
  function drawStartLine(g, R){
    const [x, y] = R.pts[0], [tx, ty] = R.tan[0];
    const sq = 4, w = Math.ceil(R.half / sq) * sq;
    g.save();
    g.translate(x, y); g.transform(-ty, tx, tx, ty, 0, 0); // x: across the road, y: along it
    for (let i = -w; i < w; i += sq){
      for (let j = 0; j < 2; j++){
        g.fillStyle = ((i/sq + j) & 1) ? '#f8fafc' : '#0f172a';
        g.fillRect(i, (j-1)*sq, sq, sq);
      }
    }
    g.restore();
  }

  function drawWrongWay(){
    const p = game.player;
    if (p.finished || p.wrongWay < 0.6 || (performance.now() % 600) > 400) return;
    ctx.save();
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(7,17,31,0.85)'; ctx.fillStyle = '#f43f5e';
    ctx.strokeText('WRONG WAY', canvas.width/2, 60);
    ctx.fillText('WRONG WAY', canvas.width/2, 60);
    ctx.restore();
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

