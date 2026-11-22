// Pack & Dash UI: rendering + input + interactions
(function(){
  const STEP_MS = 1000 / 60;
  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  canvas.tabIndex = 0;
  setTimeout(() => canvas.focus({ preventScroll: true }), 0);
  canvas.addEventListener('click', () => canvas.focus({ preventScroll: true }));

  const scoreEl = $('score'), timeEl = $('time'), itemsEl = $('items-left'), statusEl = $('status');
  const modal = $('modal'), choice = $('pd-choice');

  const game = new PackDashGame(0);
  canvas.width = game.width;
  canvas.height = game.height;

  function openChoice(){ choice.classList.remove('hidden'); }
  function closeChoice(){ choice.classList.add('hidden'); }
  function openModal(title, msg){
    $('modal-title').textContent = title;
    $('modal-message').textContent = msg;
    modal.classList.remove('hidden');
    $('modal-restart').focus();
  }
  function closeModal(){ modal.classList.add('hidden'); }

  function restart(){
    closeModal(); closeChoice();
    keys.length = 0; game.input(null);
    game.restart();
    acc = 0; bossFlash = 0;
    canvas.focus({ preventScroll: true });
  }

  $('restart-btn').addEventListener('click', restart);
  $('modal-restart').addEventListener('click', restart);

  const themeBtn = $('theme-btn');
  themeBtn.addEventListener('click', () => {
    const root = document.documentElement;
    const next = (root.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    themeBtn.setAttribute('aria-pressed', String(next === 'light'));
  });

  // input: most recently pressed direction wins, releasing falls back to the previous one
  const keys = [];
  const KEY_DIR = { arrowleft:'left', a:'left', arrowright:'right', d:'right', arrowup:'up', w:'up', arrowdown:'down', s:'down' };
  const CHOICE_KEYS = { '1':'wave', '2':'hug', '3':'ignore' };
  function dirFor(e){ return KEY_DIR[(e.key || '').toLowerCase()] || KEY_DIR[(e.code || '').replace(/^Key/, '').toLowerCase()]; }
  function syncDir(){ game.input(keys[keys.length - 1] || null); }

  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'r'){ e.preventDefault(); restart(); return; }
    if (CHOICE_KEYS[k]){ if (game.choose(CHOICE_KEYS[k])) e.preventDefault(); return; }
    const d = dirFor(e);
    if (!d) return;
    e.preventDefault();
    if (!keys.includes(d)) keys.push(d);
    syncDir();
  });
  document.addEventListener('keyup', e => {
    const d = dirFor(e);
    if (!d) return;
    const i = keys.indexOf(d);
    if (i >= 0) keys.splice(i, 1);
    syncDir();
  });
  window.addEventListener('blur', () => { keys.length = 0; syncDir(); });

  for (const btn of choice.querySelectorAll('button[data-choice]')){
    btn.addEventListener('click', () => { game.choose(btn.dataset.choice); canvas.focus({ preventScroll: true }); });
  }

  // events
  let memoryTimer = 0;
  game.on('time', t => timeEl.textContent = String(t));
  game.on('score', s => scoreEl.textContent = String(s));
  game.on('items', n => itemsEl.textContent = String(n));
  game.on('status', msg => { clearTimeout(memoryTimer); statusEl.textContent = msg || ''; });
  game.on('memory', m => {
    clearTimeout(memoryTimer);
    statusEl.textContent = m;
    memoryTimer = setTimeout(() => { if (statusEl.textContent === m) statusEl.textContent = ''; }, 2500);
  });
  game.on('coworkerNear', openChoice);
  game.on('coworkerFar', closeChoice);
  game.on('coworkerGone', closeChoice);
  game.on('win', ({score}) => { closeChoice(); openModal('You’re out! 🎉', `Elevator doors close triumphantly. Score: ${score}`); });
  game.on('lose', ({score, itemsLeft}) => {
    closeChoice();
    const msg = itemsLeft > 0
      ? `Time! ${itemsLeft} thing(s) waving at your desk. You’ve got this next dash. Score: ${score}`
      : `So close! The elevator music fades dramatically. Score: ${score}`;
    openModal('Game Over (for now)', msg);
  });
  // the constructor's initial events fired before these listeners existed
  timeEl.textContent = String(Math.ceil(game.timeLeft));
  scoreEl.textContent = String(game.score);
  itemsEl.textContent = String(game.itemsLeft);
  statusEl.textContent = 'Pack fast, smile often!';

  // fixed 60 Hz simulation, rendering every frame
  let last = 0, acc = 0, bossFlash = 0;
  function loop(now){
    if (!last) last = now;
    acc += Math.min(250, now - last);
    last = now;
    while (acc >= STEP_MS){
      game.step(STEP_MS / 1000);
      bossFlash = game.boss.talk > 0 ? Math.min(0.4, bossFlash + 0.02) : Math.max(0, bossFlash - 0.02);
      acc -= STEP_MS;
    }
    render();
    requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', () => { last = 0; acc = 0; });

  function render(){
    const TILE = game.tile;
    ctx.fillStyle = '#0a1224';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(148,163,184,0.07)'; ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += TILE){ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    for (let y = 0; y <= canvas.height; y += TILE){ ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }

    ctx.fillStyle = '#18233a';
    for (const w of game.walls) ctx.fillRect(w.x, w.y, w.w, w.h);

    const e = game.elevator;
    ctx.fillStyle = '#334155'; ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.fillStyle = '#93c5fd'; ctx.fillRect(e.x+2, e.y+2, e.w-4, 6);
    ctx.fillStyle = '#60a5fa'; ctx.fillRect(e.x+2, e.y+e.h-8, e.w-4, 6);

    for (const it of game.items){
      if (!it.picked) drawEmoji(it.data.icon, it.gx*TILE + TILE/2, it.gy*TILE + TILE/2, 12);
    }

    drawEmoji('👔', game.boss.x + game.boss.w/2, game.boss.y + game.boss.h/2, 10);
    const c = game.coworker;
    if (c) drawEmoji('🙂', c.x + c.w/2, c.y + c.h/2, 10);

    const p = game.player;
    ctx.fillStyle = '#34d399'; ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#22c55e'; ctx.fillRect(p.x, p.y, p.w, 3);

    if (bossFlash > 0){ ctx.fillStyle = `rgba(59,130,246,${bossFlash.toFixed(3)})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  }

  function drawEmoji(char, x, y, size){
    ctx.font = `${size}px system-ui, Apple Color Emoji, Segoe UI Emoji`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(char, x, y);
  }

  requestAnimationFrame(loop);
})();
