// Pack & Dash UI: rendering + input + interactions
(function(){
  const STEP_MS = 1000 / 60;
  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  canvas.tabIndex = 0;
  const focusCanvas = () => canvas.focus({ preventScroll: true });
  setTimeout(focusCanvas, 0);
  canvas.addEventListener('click', focusCanvas);

  const scoreEl = $('score'), timeEl = $('time'), itemsEl = $('items-left'), heartsEl = $('hearts'), statusEl = $('status');
  const modal = $('modal'), excuseBtn = $('pd-excuse');

  const game = new PackDashGame(0);
  canvas.width = game.width;
  canvas.height = game.height;

  function openModal(title, msg){
    $('modal-title').textContent = title;
    $('modal-message').textContent = msg;
    modal.classList.remove('hidden');
    $('modal-restart').focus();
  }
  function closeModal(){ modal.classList.add('hidden'); }

  function restart(){
    closeModal();
    keys.length = 0; game.input(null);
    game.restart();
    acc = 0; bossFlash = 0;
    focusCanvas();
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
  function dirFor(e){ return KEY_DIR[(e.key || '').toLowerCase()] || KEY_DIR[(e.code || '').replace(/^Key/, '').toLowerCase()]; }
  function syncDir(){ game.input(keys[keys.length - 1] || null); }

  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'r'){ e.preventDefault(); restart(); return; }
    if (k === ' ' || k === 'e'){
      if (e.target === excuseBtn) return; // the button's own click handles it
      e.preventDefault();
      if (!e.repeat) game.excuse();
      return;
    }
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
  excuseBtn.addEventListener('click', () => { game.excuse(); focusCanvas(); });

  // events
  let memoryTimer = 0;
  game.on('time', t => timeEl.textContent = String(t));
  game.on('score', s => scoreEl.textContent = String(s));
  game.on('items', n => itemsEl.textContent = String(n));
  game.on('heart', n => heartsEl.textContent = String(n));
  game.on('restart', () => heartsEl.textContent = '0');
  game.on('status', msg => { clearTimeout(memoryTimer); statusEl.textContent = msg || ''; });
  game.on('memory', m => {
    clearTimeout(memoryTimer);
    statusEl.textContent = m;
    memoryTimer = setTimeout(() => { if (statusEl.textContent === m) statusEl.textContent = ''; }, 2500);
  });
  game.on('win', r => {
    const stars = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
    openModal(`You’re out! ${stars}`,
      `Escaped in ${r.time.toFixed(1)}s (par ${r.par}s). Items ${r.items} + hearts ${r.hearts} + time bonus ${r.timeBonus} = ${r.total}`);
  });
  game.on('lose', ({score, itemsLeft}) => {
    const msg = itemsLeft > 0
      ? `Time! ${itemsLeft} thing(s) waving at your desk. You’ve got this next dash. Score: ${score}`
      : `So close! The elevator music fades dramatically. Score: ${score}`;
    openModal('Game Over (for now)', msg);
  });
  timeEl.textContent = String(Math.ceil(game.timeLeft));
  scoreEl.textContent = String(game.score);
  itemsEl.textContent = String(game.itemsLeft);
  statusEl.textContent = game.def.hint || '';

  // fixed 60 Hz simulation, rendering every frame
  let last = 0, acc = 0, bossFlash = 0;
  function loop(now){
    if (!last) last = now;
    acc += Math.min(250, now - last);
    last = now;
    while (acc >= STEP_MS){
      game.step(STEP_MS / 1000);
      const bossTalk = game.talk && game.talk.kind === 'boss';
      bossFlash = bossTalk ? Math.min(0.25, bossFlash + 0.02) : Math.max(0, bossFlash - 0.02);
      acc -= STEP_MS;
    }
    const canExcuse = game.state === 'playing' && game.talk && (game.talk.kind === 'boss' || game.talk.phase === 'choose');
    excuseBtn.classList.toggle('hidden', !canExcuse);
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

    // boss vision cones
    for (const b of game.bosses){
      const active = !b.talking && b.cooldown <= 0;
      ctx.fillStyle = active ? (b.alert > 0 ? 'rgba(248,113,113,0.28)' : 'rgba(250,204,21,0.16)') : 'rgba(148,163,184,0.06)';
      for (const k of b.vision){ ctx.fillRect((k % game.cols) * TILE, Math.floor(k / game.cols) * TILE, TILE, TILE); }
    }

    ctx.fillStyle = '#18233a';
    for (const w of game.walls) ctx.fillRect(w.x, w.y, w.w, w.h);

    const e = game.elevator, open = game.itemsLeft === 0;
    ctx.fillStyle = '#334155'; ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.fillStyle = open ? '#4ade80' : '#93c5fd'; ctx.fillRect(e.x+2, e.y+2, e.w-4, 6);
    ctx.fillStyle = open ? '#22c55e' : '#60a5fa'; ctx.fillRect(e.x+2, e.y+e.h-8, e.w-4, 6);

    for (const it of game.items){
      if (it.picked) continue;
      const cx = it.gx*TILE + TILE/2, cy = it.gy*TILE + TILE/2;
      drawEmoji(it.data.icon, cx, cy, 12);
      if (it.progress > 0){
        ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 9, -Math.PI/2, -Math.PI/2 + it.progress * Math.PI * 2); ctx.stroke();
      }
    }

    for (const c of game.coworkers) drawEmoji('🙂', c.cx, c.cy, 11);
    for (const b of game.bosses){
      drawEmoji('👔', b.cx, b.cy, 11);
      if (b.alert > 0 && !b.talking){ ctx.fillStyle = '#f87171'; ctx.font = 'bold 10px system-ui'; ctx.fillText('!', b.cx, b.cy - 11); }
    }

    const p = game.player;
    ctx.fillStyle = '#34d399'; ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#22c55e'; ctx.fillRect(p.x, p.y, p.w, 3);

    // talk bubble with remaining time
    const t = game.talk;
    if (t){
      const bx = p.x + p.w/2, by = p.y - 6;
      ctx.fillStyle = 'rgba(15,23,42,0.85)'; ctx.fillRect(bx - 16, by - 8, 32, 6);
      ctx.fillStyle = t.kind === 'boss' ? '#f87171' : t.phase === 'choose' ? '#facc15' : '#f472b6';
      ctx.fillRect(bx - 15, by - 7, 30 * Math.max(0, t.t) / (t.phase === 'chat' && t.kind === 'coworker' ? 2 : t.total), 4);
    }

    if (bossFlash > 0){ ctx.fillStyle = `rgba(59,130,246,${bossFlash.toFixed(3)})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  }

  function drawEmoji(char, x, y, size){
    ctx.font = `${size}px system-ui, Apple Color Emoji, Segoe UI Emoji`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(char, x, y);
  }

  requestAnimationFrame(loop);
})();
