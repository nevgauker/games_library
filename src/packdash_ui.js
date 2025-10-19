// Pack & Dash UI: rendering + input + interactions
(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  if (canvas) { canvas.tabIndex = 0; setTimeout(()=>canvas.focus(), 0); canvas.addEventListener('click', ()=>canvas.focus()); }

  const scoreEl = document.getElementById('score');
  const timeEl = document.getElementById('time');
  const itemsEl = document.getElementById('items-left');
  const statusEl = document.getElementById('status');

  const restartBtn = document.getElementById('restart-btn');
  const themeBtn = document.getElementById('theme-btn');
  const modal = document.getElementById('modal');
  const modalRestart = document.getElementById('modal-restart');
  const modalClose = document.getElementById('modal-close');

  const game = new PackDashGame();
  canvas.width = game.width;
  canvas.height = game.height;

  // coworker choice panel (lightweight)
  const choice = document.createElement('div');
  choice.style.position = 'absolute';
  choice.style.left = '50%';
  choice.style.transform = 'translateX(-50%)';
  choice.style.bottom = '32px';
  choice.style.background = 'var(--panel)';
  choice.style.border = '1px solid rgba(255,255,255,0.08)';
  choice.style.padding = '8px 10px';
  choice.style.borderRadius = '10px';
  choice.style.display = 'none';
  choice.style.gap = '8px';
  choice.style.boxShadow = '0 8px 16px rgba(0,0,0,0.25)';
  choice.setAttribute('role','group');
  const waveBtn = document.createElement('button'); waveBtn.textContent = '👋 Wave (+5)';
  const hugBtn = document.createElement('button'); hugBtn.textContent = '🤗 Hug (+10, cozy)';
  const ignBtn = document.createElement('button'); ignBtn.textContent = '🕶️ Stealth Nod (-2)';
  choice.append(waveBtn, hugBtn, ignBtn);
  document.body.appendChild(choice);

  function openChoice(){ choice.style.display = 'flex'; }
  function closeChoice(){ choice.style.display = 'none'; }

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

  restartBtn.addEventListener('click', () => { closeModal(); closeChoice(); game.restart(); statusEl.textContent=''; canvas && canvas.focus(); });
  modalRestart && modalRestart.addEventListener('click', () => { closeModal(); closeChoice(); game.restart(); statusEl.textContent=''; canvas && canvas.focus(); });
  modalClose && modalClose.addEventListener('click', () => { closeModal(); canvas && canvas.focus(); });
  themeBtn && setThemeToggle(themeBtn);

  // input
  const keys = new Set();
  function updateDir(){
    // prioritize last pressed; simple mapping
    if (keys.has('left')) game.input('left');
    else if (keys.has('right')) game.input('right');
    else if (keys.has('up')) game.input('up');
    else if (keys.has('down')) game.input('down');
    else game.input(null);
  }
  function onKey(e){
    const k=(e.key||'').toLowerCase(); const c=e.code||'';
    if (k.startsWith('arrow')||c.startsWith('Arrow')) e.preventDefault();
    if (k==='r'||c==='KeyR'){ game.restart(); return; }
    if (k==='arrowleft'||k==='a'||c==='ArrowLeft'||c==='KeyA') { keys.add('left'); keys.delete('right'); }
    if (k==='arrowright'||k==='d'||c==='ArrowRight'||c==='KeyD') { keys.add('right'); keys.delete('left'); }
    if (k==='arrowup'||k==='w'||c==='ArrowUp'||c==='KeyW') { keys.add('up'); keys.delete('down'); }
    if (k==='arrowdown'||k==='s'||c==='ArrowDown'||c==='KeyS') { keys.add('down'); keys.delete('up'); }
    updateDir();
  }
  function onKeyUp(e){
    const k=(e.key||'').toLowerCase(); const c=e.code||'';
    if (k==='arrowleft'||k==='a'||c==='ArrowLeft'||c==='KeyA') keys.delete('left');
    if (k==='arrowright'||k==='d'||c==='ArrowRight'||c==='KeyD') keys.delete('right');
    if (k==='arrowup'||k==='w'||c==='ArrowUp'||c==='KeyW') keys.delete('up');
    if (k==='arrowdown'||k==='s'||c==='ArrowDown'||c==='KeyS') keys.delete('down');
    updateDir();
  }
  document.addEventListener('keydown', onKey, { passive:false });
  document.addEventListener('keyup', onKeyUp, { passive:false });

  // coworker choice actions
  waveBtn.addEventListener('click', ()=>{ game.choose('wave'); closeChoice(); });
  hugBtn.addEventListener('click', ()=>{ game.choose('hug'); closeChoice(); });
  ignBtn.addEventListener('click', ()=>{ game.choose('ignore'); closeChoice(); });

  // events
  game.on('time', t => timeEl.textContent = String(t));
  game.on('score', s => scoreEl.textContent = String(s));
  game.on('items', n => itemsEl.textContent = String(n));
  game.on('status', msg => statusEl.textContent = msg || '');
  game.on('memory', m => { statusEl.textContent = m; setTimeout(()=>{ if(statusEl.textContent===m) statusEl.textContent=''; }, 2500); });
  game.on('coworker', () => openChoice());
  game.on('coworkerGone', () => closeChoice());
  game.on('bossTalk', () => {/* visual handled via render flash */});
  game.on('win', ({score}) => { openModal('You’re out! 🎉', `Elevator doors close triumphantly. Score: ${score}`); });
  game.on('lose', ({score, itemsLeft}) => { const msg = itemsLeft>0 ? `Time! ${itemsLeft} thing(s) waving at your desk. You’ve got this next dash. Score: ${score}` : `So close! The elevator music fades dramatically. Score: ${score}`; openModal('Game Over (for now)', msg); });

  let last = performance.now();
  let bossFlash = 0;
  function loop(t){
    const dt = Math.min(0.05, (t-last)/1000); last=t;
    game.step(dt);
    render(dt);
    requestAnimationFrame(loop);
  }

  function render(dt){
    const TILE = window.__PACKDASH_CONST.TILE;
    // bg
    ctx.fillStyle = '#0a1224';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // subtle grid
    ctx.strokeStyle = 'rgba(148,163,184,0.07)'; ctx.lineWidth=1;
    for (let x=0;x<=canvas.width;x+=TILE){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for (let y=0;y<=canvas.height;y+=TILE){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }

    // walls/desks
    ctx.fillStyle = '#18233a';
    for (const w of game.walls){ ctx.fillRect(w.x,w.y,w.w,w.h); }

    // elevator
    ctx.fillStyle = '#334155';
    const e = game.elevator; ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.fillStyle = '#93c5fd'; ctx.fillRect(e.x+2, e.y+2, e.w-4, 6);
    ctx.fillStyle = '#60a5fa'; ctx.fillRect(e.x+2, e.y+e.h-8, e.w-4, 6);

    // items
    for (const it of game.items){ if (it.picked) continue; const cx = it.gx*TILE + TILE/2, cy = it.gy*TILE + TILE/2; drawEmoji(it.data.icon, cx, cy, 12); }

    // boss
    drawEmoji('👔', game.boss.x+game.boss.w/2, game.boss.y+game.boss.h/2, 10);
    if (game.boss.talk>0){ bossFlash = Math.min(0.4, bossFlash + 0.02); }
    else { bossFlash = Math.max(0, bossFlash - 0.02); }

    // coworker
    if (game.coworker){ drawEmoji('🙂', game.coworker.x+game.coworker.w/2, game.coworker.y+game.coworker.h/2, 10); }

    // player
    const p = game.player; ctx.fillStyle = '#34d399'; ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#22c55e'; ctx.fillRect(p.x, p.y, p.w, 3);

    if (bossFlash>0){ ctx.fillStyle = `rgba(59,130,246,${bossFlash.toFixed(3)})`; ctx.fillRect(0,0,canvas.width,canvas.height); }
  }

  function drawEmoji(char, x, y, size){
    ctx.font = `${size}px system-ui, Apple Color Emoji, Segoe UI Emoji`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(char, x, y);
  }

  requestAnimationFrame(loop);
})();
