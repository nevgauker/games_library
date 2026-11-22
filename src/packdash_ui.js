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
  const fx = createPackDashRenderer(canvas, game);
  const sfx = createPackDashAudio();
  const themeName = () => document.documentElement.getAttribute('data-theme')
    || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  fx.setTheme(themeName());
  fx.resize();
  window.addEventListener('resize', () => fx.resize());
  window.__packdash = game; // handy for debugging / automated checks

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
    fx.reset();
    acc = 0;
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
    fx.setTheme(next);
  });

  // input: most recently pressed direction wins, releasing falls back to the previous one
  const keys = [];
  const KEY_DIR = { arrowleft:'left', a:'left', arrowright:'right', d:'right', arrowup:'up', w:'up', arrowdown:'down', s:'down' };
  function dirFor(e){ return KEY_DIR[(e.key || '').toLowerCase()] || KEY_DIR[(e.code || '').replace(/^Key/, '').toLowerCase()]; }
  function syncDir(){ game.input(keys[keys.length - 1] || null, keys[keys.length - 2] || null); }

  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const k = (e.key || '').toLowerCase();
    sfx.unlock();
    if (k === 'r'){ e.preventDefault(); restart(); return; }
    if (k === 'm'){ sfx.setEnabled(!sfx.enabled); return; }
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
  const T = game.tile;
  const pcx = () => game.player.x + game.player.w/2, pcy = () => game.player.y + game.player.h/2;
  game.on('packStart', () => sfx.packTick());
  game.on('packed', it => {
    const x = it.gx*T + T/2, y = it.gy*T + T/2;
    fx.burst(x, y, '#facc15', 14, 60); fx.burst(x, y, '#34d399', 8, 40);
    fx.floatText(x, y - 8, '+10', '#facc15');
    if ((it.data.weight || 1) > 1) fx.floatText(x, y + 4, 'heavy!', '#fb923c', 6);
    sfx.pack();
  });
  game.on('spotted', () => sfx.spotted());
  game.on('bossTalk', () => { fx.kick(4); sfx.bossTalk(); });
  game.on('coworkerTalk', () => sfx.coworker());
  game.on('excuse', ({kind}) => {
    const lines = kind === 'boss' ? ['Sorry!', 'Gotta run!', 'Totally!', 'Mm-hm!', 'Love that!'] : ['*nod*', 'Later!', '👋'];
    fx.floatText(pcx() + (Math.random() - 0.5) * 16, pcy() - 14, lines[Math.floor(Math.random() * lines.length)], '#93c5fd', 7);
    sfx.excuse();
  });
  game.on('heart', () => { fx.floatText(pcx(), pcy() - 12, '♥ +25', '#f472b6', 9); fx.burst(pcx(), pcy() - 6, '#f472b6', 8, 30); sfx.heart(); });
  game.on('elevatorOpen', () => { const e = game.elevator; fx.burst(e.x + e.w/2, e.y + e.h/2, '#4ade80', 16, 50); sfx.ding(); });
  game.on('win', () => { const e = game.elevator; fx.burst(e.x + e.w/2, e.y + e.h/2, '#facc15', 30, 80); sfx.win(); });
  game.on('lose', () => sfx.lose());
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
  let last = 0, acc = 0, stepDist = 0, murmurT = 0, lastTick = 0;
  function loop(now){
    if (!last) last = now;
    const frame = Math.min(250, now - last);
    acc += frame;
    last = now;
    while (acc >= STEP_MS){
      const walked = game.walked;
      game.step(STEP_MS / 1000);
      if (game.walked < walked) stepDist = 0;
      stepDist += game.walked - walked;
      if (stepDist >= 14){ stepDist = 0; sfx.step(); fx.dust(pcx(), game.player.y + game.player.h); }
      if (game.talk && game.talk.phase === 'chat'){ murmurT -= STEP_MS / 1000; if (murmurT <= 0){ murmurT = 0.16; sfx.murmur(); } }
      const sec = Math.ceil(game.timeLeft);
      if (game.state === 'playing' && sec <= 10 && sec !== lastTick){ lastTick = sec; sfx.tick(); }
      if (sec > 10) lastTick = 0;
      acc -= STEP_MS;
    }
    const canExcuse = game.state === 'playing' && game.talk && (game.talk.kind === 'boss' || game.talk.phase === 'choose');
    excuseBtn.classList.toggle('hidden', !canExcuse);
    fx.render(frame / 1000);
    requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', () => { last = 0; acc = 0; });

  requestAnimationFrame(loop);
})();
