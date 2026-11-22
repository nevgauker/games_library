// Pack & Dash UI: screens, HUD, input (keyboard + touch), progress, and the game loop.
(function(){
  const STEP_MS = 1000 / 60;
  const STORE_KEY = 'packdash.progress.v1';
  const $ = id => document.getElementById(id);
  const LEVELS = window.PACKDASH_LEVELS;

  const canvas = $('game');
  canvas.tabIndex = 0;
  const focusCanvas = () => canvas.focus({ preventScroll: true });
  canvas.addEventListener('click', focusCanvas);

  const el = {
    floorNum: $('floor-num'), floorName: $('floor-name'), time: $('time'), timerFill: $('timer-fill'), timerPar: $('timer-par'),
    checklist: $('checklist'), hearts: $('hearts'), speed: $('speed'), score: $('score'), status: $('status'),
    excuse: $('pd-excuse'), start: $('start-card'), modal: $('modal'), floors: $('floors-modal'), pause: $('pause-modal'),
    soundBtn: $('sound-btn'), pauseBtn: $('pause-btn'), themeBtn: $('theme-btn'),
  };

  // ---- progress (localStorage is optional: private mode etc. just means no saving) ----
  function loadProgress(){
    try { return Object.assign({ levels: {}, sound: true, last: 0 }, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); }
    catch (e) { return { levels: {}, sound: true, last: 0 }; }
  }
  function saveProgress(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) {} }
  const progress = loadProgress();
  const unlocked = i => i === 0 || !!progress.levels[i - 1];
  const totalStars = () => Object.values(progress.levels).reduce((s, l) => s + (l.stars || 0), 0);

  // ---- game + presentation ----
  let levelIndex = Math.min(progress.last || 0, LEVELS.length - 1);
  if (!unlocked(levelIndex)) levelIndex = 0;
  const game = new PackDashGame(levelIndex);
  const fx = createPackDashRenderer(canvas, game);
  const sfx = createPackDashAudio();

  const themeName = () => document.documentElement.getAttribute('data-theme') || 'dark';
  fx.setTheme(themeName());

  let started = false, paused = false;
  const keys = [];

  function anyModalOpen(){ return [el.modal, el.floors, el.pause].some(m => !m.classList.contains('hidden')); }
  function running(){ return started && !paused && !anyModalOpen() && game.state === 'playing'; }

  function loadLevel(i){
    levelIndex = i;
    progress.last = i; saveProgress();
    game.load(i);
    afterRestart();
  }
  function restart(){
    game.restart();
    afterRestart();
  }
  function afterRestart(){
    for (const m of [el.modal, el.floors, el.pause]) m.classList.add('hidden');
    keys.length = 0; game.input(null);
    paused = false; el.pauseBtn.setAttribute('aria-pressed', 'false');
    fx.reset(); fx.resize();
    acc = 0; lastTick = 0;
    buildHud();
    showStartCard();
  }

  function showStartCard(){
    started = false;
    const d = game.def, best = progress.levels[levelIndex];
    $('start-num').textContent = String(levelIndex + 1);
    $('start-title').textContent = d.name;
    $('start-hint').textContent = d.hint || '';
    const nw = $('start-new');
    nw.textContent = d.intro ? `New: ${d.intro}` : '';
    nw.classList.toggle('hidden', !d.intro);
    $('start-par').textContent = String(game.par);
    $('start-limit').textContent = String(game.timeLimit);
    $('start-best').textContent = best ? `best ${'★'.repeat(best.stars)}${'☆'.repeat(3 - best.stars)} ${best.score}` : 'not cleared yet';
    el.status.textContent = '';
    el.start.classList.remove('hidden');
    $('start-btn').focus({ preventScroll: true });
  }
  function startPlay(){
    if (started || game.state !== 'playing' || anyModalOpen()) return;
    started = true;
    el.start.classList.add('hidden');
    el.status.textContent = game.def.hint || '';
    sfx.unlock();
    focusCanvas();
  }

  function setPaused(v){
    if (!started || game.state !== 'playing') v = false;
    paused = v;
    el.pause.classList.toggle('hidden', !v);
    el.pauseBtn.setAttribute('aria-pressed', String(v));
    keys.length = 0; game.input(null);
    if (v) $('pause-resume').focus(); else focusCanvas();
  }

  // ---- HUD ----
  function buildHud(){
    el.floorNum.textContent = String(levelIndex + 1);
    el.floorName.textContent = game.def.name;
    el.checklist.innerHTML = '';
    for (const it of game.items){
      const s = document.createElement('span');
      s.className = 'pd-check';
      s.textContent = it.data.icon;
      const w = it.data.weight || 1;
      s.title = `${it.data.name}${w > 1 ? ` (heavy ×${w})` : ''}`;
      s.dataset.id = it.id;
      if (w > 1) s.dataset.heavy = '▪'.repeat(w - 1);
      el.checklist.appendChild(s);
    }
    const parAt = (game.timeLimit - game.par) / game.timeLimit;
    el.timerPar.style.left = `${(parAt * 100).toFixed(1)}%`;
    el.hearts.textContent = '0';
    el.score.textContent = '0';
    shownSec = -1;
    updateHud();
  }
  let shownSec = -1;
  function updateHud(){
    const frac = game.timeLeft / game.timeLimit;
    el.timerFill.style.width = `${(frac * 100).toFixed(2)}%`;
    el.timerFill.dataset.tier = game.time <= game.par ? 'gold' : game.time <= game.silver ? 'silver' : 'late';
    const sec = Math.ceil(game.timeLeft);
    if (sec !== shownSec){ shownSec = sec; el.time.textContent = String(sec); el.time.classList.toggle('pd-urgent', sec <= 10); }
    el.speed.textContent = String(Math.round(game.weightMul * 100));
    const canExcuse = running() && game.talk && (game.talk.kind === 'boss' || game.talk.phase === 'choose');
    el.excuse.classList.toggle('hidden', !canExcuse);
  }

  // ---- result + floors ----
  function showResult(win, r){
    const stars = $('modal-stars'), dl = $('modal-breakdown');
    stars.innerHTML = ''; dl.innerHTML = '';
    const next = $('modal-next');
    if (win){
      const prev = progress.levels[levelIndex];
      const best = !prev || r.total > prev.score;
      progress.levels[levelIndex] = {
        stars: Math.max(r.stars, prev ? prev.stars : 0),
        score: Math.max(r.total, prev ? prev.score : 0),
        time: Math.min(r.time, prev && prev.time ? prev.time : Infinity),
      };
      saveProgress();
      $('modal-title').textContent = ['You’re out! 🎉', 'Smooth exit! 🎉', 'Legendary exit! 🏆'][r.stars - 1];
      stars.setAttribute('aria-label', `${r.stars} of 3 stars`);
      for (let i = 0; i < 3; i++){
        const s = document.createElement('span');
        s.textContent = '★';
        s.className = i < r.stars ? 'on' : '';
        s.style.animationDelay = `${0.15 + i * 0.22}s`;
        stars.appendChild(s);
        if (i < r.stars) setTimeout(() => sfx.star(i), 150 + i * 220);
      }
      const rows = [
        ['Time', `${r.time.toFixed(1)}s`, r.stars === 3 ? `par ${r.par}s ✓` : r.stars === 2 ? `★★★ under ${r.par}s` : `★★ under ${r.silver}s`],
        ['Items packed', `+${r.items}`, ''],
        ['Hearts', `+${r.hearts}`, r.heartCount ? `${r.heartCount} ♥` : ''],
        ['Time bonus', `+${r.timeBonus}`, ''],
        ['Total', String(r.total), best ? 'new best!' : `best ${progress.levels[levelIndex].score}`],
      ];
      for (const [k, v, note] of rows){
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        if (note){ const sm = document.createElement('small'); sm.textContent = note; dd.appendChild(sm); }
        dl.append(dt, dd);
      }
      const lastLevel = levelIndex === LEVELS.length - 1;
      $('modal-message').textContent = game.def.outro || (lastLevel ? 'That was the last floor. You’re free! Enjoy the weekend.' : 'The doors close. Next stop…');
      next.classList.toggle('hidden', lastLevel);
    } else {
      $('modal-title').textContent = 'Missed the elevator';
      stars.setAttribute('aria-label', 'No stars');
      $('modal-message').textContent = r.itemsLeft > 0
        ? `Time! ${r.itemsLeft} thing(s) still waving at you from the desks. One more dash?`
        : 'So close! The elevator music fades dramatically. One more dash?';
      next.classList.toggle('hidden', !unlocked(levelIndex + 1) || levelIndex === LEVELS.length - 1);
    }
    el.modal.classList.remove('hidden');
    (win && !next.classList.contains('hidden') ? next : $('modal-restart')).focus();
  }

  function openFloors(){
    const grid = $('floor-grid');
    grid.innerHTML = '';
    LEVELS.forEach((d, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pd-floor-btn' + (i === levelIndex ? ' current' : '');
      const rec = progress.levels[i];
      const open = unlocked(i);
      b.disabled = !open;
      b.innerHTML = `<span class="n">${i + 1}</span><span class="name"></span><span class="st">${open ? (rec ? '★'.repeat(rec.stars) + '☆'.repeat(3 - rec.stars) : '☆☆☆') : '🔒'}</span>`;
      b.querySelector('.name').textContent = d.name;
      b.setAttribute('aria-label', `Floor ${i + 1}: ${d.name}${open ? (rec ? `, ${rec.stars} stars` : '') : ', locked'}`);
      b.addEventListener('click', () => loadLevel(i));
      grid.appendChild(b);
    });
    $('total-stars').textContent = `${totalStars()} / ${LEVELS.length * 3}`;
    el.pause.classList.add('hidden');
    el.floors.classList.remove('hidden');
    keys.length = 0; game.input(null);
    const cur = grid.querySelector('.current') || grid.querySelector('button:not([disabled])');
    if (cur) cur.focus();
  }
  function closeFloors(){
    el.floors.classList.add('hidden');
    if (!started) $('start-btn').focus({ preventScroll: true });
    else if (game.state === 'playing') setPaused(true);
    else el.modal.classList.remove('hidden');
  }

  // ---- buttons ----
  $('restart-btn').addEventListener('click', restart);
  $('modal-restart').addEventListener('click', restart);
  $('pause-restart').addEventListener('click', restart);
  $('modal-next').addEventListener('click', () => loadLevel(Math.min(levelIndex + 1, LEVELS.length - 1)));
  $('floors-btn').addEventListener('click', openFloors);
  $('modal-floors').addEventListener('click', () => { el.modal.classList.add('hidden'); openFloors(); });
  $('pause-floors').addEventListener('click', openFloors);
  $('floors-close').addEventListener('click', closeFloors);
  $('pause-resume').addEventListener('click', () => setPaused(false));
  el.pauseBtn.addEventListener('click', () => setPaused(!paused));
  $('start-btn').addEventListener('click', startPlay);
  el.excuse.addEventListener('click', () => { game.excuse(); focusCanvas(); });

  function setSound(on){
    sfx.setEnabled(on);
    progress.sound = on; saveProgress();
    el.soundBtn.textContent = `Sound: ${on ? 'On' : 'Off'}`;
    el.soundBtn.setAttribute('aria-pressed', String(on));
  }
  el.soundBtn.addEventListener('click', () => setSound(!sfx.enabled));
  setSound(progress.sound !== false);

  el.themeBtn.addEventListener('click', () => {
    const next = themeName() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    el.themeBtn.setAttribute('aria-pressed', String(next === 'light'));
    fx.setTheme(next);
  });

  // ---- keyboard: most recent direction wins, the previous one is the buffered turn ----
  const KEY_DIR = { arrowleft:'left', a:'left', arrowright:'right', d:'right', arrowup:'up', w:'up', arrowdown:'down', s:'down' };
  function dirFor(e){ return KEY_DIR[(e.key || '').toLowerCase()] || KEY_DIR[(e.code || '').replace(/^Key/, '').toLowerCase()]; }
  function syncDir(){ game.input(keys[keys.length - 1] || null, keys[keys.length - 2] || null); }
  function press(d){ if (!keys.includes(d)) keys.push(d); syncDir(); }
  function release(d){ const i = keys.indexOf(d); if (i >= 0) keys.splice(i, 1); syncDir(); }
  const onButton = () => document.activeElement && document.activeElement.tagName === 'BUTTON';

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const k = (e.key || '').toLowerCase();
    const d = dirFor(e);
    sfx.unlock();

    if (k === 'm'){ setSound(!sfx.enabled); return; }

    if (!el.floors.classList.contains('hidden')){
      if (k === 'escape'){ e.preventDefault(); closeFloors(); }
      return; // Tab/Enter work on the floor buttons
    }
    if (!el.modal.classList.contains('hidden')){
      if (k === 'r'){ e.preventDefault(); restart(); }
      else if (k === 'enter' && !onButton()){ e.preventDefault(); const n = $('modal-next'); if (n.classList.contains('hidden')) restart(); else n.click(); }
      return;
    }
    if (!el.pause.classList.contains('hidden')){
      if (k === 'p' || k === 'escape'){ e.preventDefault(); setPaused(false); }
      else if (k === 'r'){ e.preventDefault(); restart(); }
      return;
    }
    if (k === 'r'){ e.preventDefault(); restart(); return; }
    if (!started){
      if (k === 'escape'){ e.preventDefault(); openFloors(); return; }
      if (k === 'tab' || k === 'shift' || k === 'p') return;
      if ((k === 'enter' || k === ' ') && onButton() && document.activeElement.id !== 'start-btn') return;
      e.preventDefault();
      startPlay();
      if (d) press(d);
      return;
    }
    if (k === 'p' || k === 'escape'){ e.preventDefault(); setPaused(true); return; }
    if (k === ' ' || k === 'e'){
      e.preventDefault();
      if (!e.repeat) game.excuse();
      return;
    }
    if (d){ e.preventDefault(); press(d); }
  });
  document.addEventListener('keyup', e => { const d = dirFor(e); if (d) release(d); });
  window.addEventListener('blur', () => { keys.length = 0; syncDir(); if (running()) setPaused(true); });
  document.addEventListener('visibilitychange', () => { last = 0; acc = 0; if (document.hidden && running()) setPaused(true); });

  // ---- touch controls ----
  for (const b of document.querySelectorAll('.pd-dpad button[data-dir]')){
    const d = b.dataset.dir;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      sfx.unlock();
      if (anyModalOpen()) return;
      if (!started) startPlay();
      if (b.setPointerCapture) b.setPointerCapture(e.pointerId);
      b.classList.add('held');
      press(d);
    });
    const up = () => { b.classList.remove('held'); release(d); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  $('touch-excuse').addEventListener('pointerdown', e => {
    e.preventDefault();
    sfx.unlock();
    if (anyModalOpen()) return;
    if (!started){ startPlay(); return; }
    game.excuse();
  });
  el.start.addEventListener('pointerdown', e => { if (e.target.id !== 'start-btn') startPlay(); });

  // ---- game events → HUD, effects, sound ----
  const T = game.tile;
  const pcx = () => game.player.x + game.player.w/2, pcy = () => game.player.y + game.player.h/2;
  let memoryTimer = 0;
  function say(msg, ms){
    clearTimeout(memoryTimer);
    el.status.textContent = msg || '';
    if (ms) memoryTimer = setTimeout(() => { if (el.status.textContent === msg) el.status.textContent = ''; }, ms);
  }
  game.on('score', s => el.score.textContent = String(s));
  game.on('heart', n => el.hearts.textContent = String(n));
  game.on('status', msg => { if (started) say(msg); });
  game.on('memory', m => say(m, 3000));
  game.on('packStart', () => sfx.packTick());
  game.on('packed', it => {
    const x = it.gx*T + T/2, y = it.gy*T + T/2;
    fx.burst(x, y, '#facc15', 14, 60); fx.burst(x, y, '#34d399', 8, 40);
    fx.floatText(x, y - 8, '+10', '#facc15');
    if ((it.data.weight || 1) > 1) fx.floatText(x, y + 4, 'heavy!', '#fb923c', 6);
    const chip = el.checklist.querySelector(`[data-id="${it.id}"]`);
    if (chip) chip.classList.add('packed');
    sfx.pack();
  });
  game.on('spotted', () => sfx.spotted());
  game.on('coworkerSeek', () => sfx.coworker());
  game.on('cake', k => {
    const x = k.gx*T + T/2, y = k.gy*T + T/2;
    fx.burst(x, y, '#f472b6', 18, 60); fx.floatText(x, y - 8, '🎂 +40', '#f472b6', 9);
    sfx.heart();
  });
  game.on('cakeStart', () => sfx.packTick());
  game.on('printerJam', q => {
    const p = game.player, d = Math.hypot(q.gx*T - p.x, q.gy*T - p.y);
    if (d < 6 * T){ fx.burst(q.x + T/2, q.y + T/2, '#f8fafc', 6, 30); sfx.jam(); }
  });
  game.on('bossTalk', () => { fx.kick(4); sfx.bossTalk(); });
  game.on('coworkerTalk', () => sfx.coworker());
  game.on('excuse', ({kind}) => {
    const lines = kind === 'boss' ? ['Sorry!', 'Gotta run!', 'Totally!', 'Mm-hm!', 'Love that!'] : ['*nod*', 'Later!', '👋'];
    fx.floatText(pcx() + (Math.random() - 0.5) * 16, pcy() - 14, lines[Math.floor(Math.random() * lines.length)], '#93c5fd', 7);
    sfx.excuse();
  });
  game.on('heart', () => { fx.floatText(pcx(), pcy() - 12, '♥ +25', '#f472b6', 9); fx.burst(pcx(), pcy() - 6, '#f472b6', 8, 30); sfx.heart(); });
  game.on('elevatorOpen', () => { const e = game.elevator; fx.burst(e.x + e.w/2, e.y + e.h/2, '#4ade80', 16, 50); if (!game.schedule) sfx.ding(); });
  game.on('win', r => {
    const e = game.elevator; fx.burst(e.x + e.w/2, e.y + e.h/2, '#facc15', 30, 80); sfx.win();
    keys.length = 0; game.input(null);
    setTimeout(() => { if (game.state === 'won') showResult(true, r); }, 700);
  });
  game.on('lose', r => {
    sfx.lose();
    keys.length = 0; game.input(null);
    setTimeout(() => { if (game.state === 'lost') showResult(false, r); }, 500);
  });

  // ---- fixed 60 Hz simulation, rendering every frame ----
  let last = 0, acc = 0, stepDist = 0, murmurT = 0, lastTick = 0, doorsWere = false;
  function loop(now){
    if (!last) last = now;
    const frame = Math.min(250, now - last);
    last = now;
    if (running()) acc += frame; else acc = 0;
    while (acc >= STEP_MS){
      const walked = game.walked;
      game.step(STEP_MS / 1000);
      stepDist += game.walked - walked;
      if (stepDist >= 14){ stepDist = 0; sfx.step(); fx.dust(pcx(), game.player.y + game.player.h); }
      if (game.talk && game.talk.phase === 'chat'){ murmurT -= STEP_MS / 1000; if (murmurT <= 0){ murmurT = 0.16; sfx.murmur(); } }
      const sec = Math.ceil(game.timeLeft);
      if (game.state === 'playing' && sec <= 10 && sec !== lastTick){ lastTick = sec; sfx.tick(); }
      const doors = game.doorsOpen;
      if (game.schedule && doors && !doorsWere) sfx.ding();
      doorsWere = doors;
      acc -= STEP_MS;
    }
    updateHud();
    // effects keep animating after a win/lose, freeze while paused or before the start
    fx.render(running() || game.state !== 'playing' ? frame / 1000 : 0);
    requestAnimationFrame(loop);
  }
  window.addEventListener('resize', () => fx.resize());

  afterRestart();
  requestAnimationFrame(loop);
})();
