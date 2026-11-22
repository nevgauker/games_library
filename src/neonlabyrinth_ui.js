// Neon Labyrinth '89: DOM wiring, input, sound, screens and saved progress.
(function () {
  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const el = {
    level: $('level'), levelCount: $('level-count'), levelName: $('level-name'),
    time: $('time'), timeBar: $('time-bar'), keys: $('keys'), keysWrap: $('keys-wrap'),
    crystals: $('crystals'), crystalsWrap: $('crystals-wrap'), best: $('best'), status: $('status'),
    modal: $('modal'), modalTitle: $('modal-title'), modalBody: $('modal-body'), modalActions: $('modal-actions'),
    levelsBtn: $('levels-btn'), pauseBtn: $('pause-btn'), restartBtn: $('restart-btn'),
    soundBtn: $('sound-btn'), crtBtn: $('crt-btn'), themeBtn: $('theme-btn'), scanlines: $('scanlines'),
    dpad: $('dpad'), tip: $('controls-tip'),
  };
  const isTouch = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const hint = k => (isTouch ? '' : ` (${k})`);
if (isTouch) {
    el.tip.textContent = 'Hold the arrow pad to glide · tap the maze to pause';
    el.levelsBtn.textContent = 'Levels';
    el.restartBtn.textContent = 'Restart';
  }

  // ------------------------------------------------------------ storage
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('nl89.' + key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem('nl89.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ } },
  };
  const progress = Object.assign({ best: {}, stars: {} }, store.get('progress', {}));
  const saveProgress = () => store.set('progress', progress);
  const isUnlocked = i => i === 0 || progress.stars[i - 1] > 0;

  // ------------------------------------------------------------ sound
  const sound = {
    on: store.get('sound', true),
    ctx: null, master: null,
    ensure() {
      if (!this.on) return null;
      try {
        if (!this.ctx) {
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.5;
          this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { return null; }
      return this.ctx;
    },
    // enveloped tone: no clicks
    tone(freq, dur = 0.08, type = 'square', vol = 0.04, slideTo = null, delay = 0) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + delay;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    arp(notes, step = 0.06, type = 'square', vol = 0.035) {
      notes.forEach((f, i) => this.tone(f, step * 1.6, type, vol, null, i * step));
    },
  };
  let stepFlip = false;
  function playEvent(e) {
    switch (e.type) {
      case 'start': sound.arp([440, 880], 0.07); break;
      case 'step': stepFlip = !stepFlip; sound.tone(stepFlip ? 660 : 740, 0.03, 'triangle', 0.012); break;
      case 'bump':
        if (e.locked) { sound.tone(180, 0.08, 'square', 0.03); sound.tone(140, 0.1, 'square', 0.03, null, 0.07); }
        else sound.tone(e.pulse ? 300 : 110, 0.06, 'square', 0.025);
        break;
      case 'crystal': sound.arp([880, 1175, 1568], 0.05, 'triangle', 0.05); break;
      case 'key': sound.arp([523, 659, 784, 1047], 0.06, 'square', 0.04); break;
      case 'door': sound.tone(200, 0.35, 'sawtooth', 0.04, 900); break;
      case 'hit': sound.tone(240, 0.3, 'sawtooth', 0.06, 70); break;
      case 'ping': sound.tone(1300 + e.closeness * 700, 0.05, 'sine', 0.015 + e.closeness * 0.045); break;
      case 'tick': sound.tone(e.left <= 2 ? 1320 : 990, 0.05, 'square', 0.035); break;
      case 'win': sound.arp([523, 659, 784, 1047, 1319], 0.08, 'square', 0.045); break;
      case 'lose': sound.tone(420, 0.7, 'sawtooth', 0.05, 90); break;
    }
  }

  // ------------------------------------------------------------ game + renderer
  const game = new window.NeonLabyrinthGame(window.NEON_LABYRINTH_LEVELS);
  const renderer = new window.NeonLabyrinthRenderer(canvas);
  el.levelCount.textContent = String(game.levelCount());

  // ------------------------------------------------------------ modal screens
  let modalPrimary = null;
  let modalOnClose = null;
  function showModal(title, bodyHTML, actions, onClose) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = bodyHTML;
    el.modalActions.innerHTML = '';
    modalPrimary = null;
    modalOnClose = onClose || null;
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      if (a.primary) { b.classList.add('primary'); modalPrimary = a.run; }
      b.addEventListener('click', () => a.run());
      el.modalActions.appendChild(b);
    }
    el.modal.classList.remove('hidden');
    const focus = el.modalActions.querySelector('.primary') || el.modalActions.querySelector('button');
    if (focus) focus.focus({ preventScroll: true });
  }
  function hideModal() { el.modal.classList.add('hidden'); modalPrimary = null; modalOnClose = null; canvas.focus && canvas.focus(); }
  const modalOpen = () => !el.modal.classList.contains('hidden');

  const starStr = n => '★'.repeat(n) + '☆'.repeat(3 - n);
  const fmt = s => s.toFixed(1);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function briefing() {
    const lvl = game.level, i = game.levelIndex;
    const [three, two] = game.starThresholds();
    const best = progress.best[i];
    showModal(`Level ${i + 1} · ${lvl.name}`,
      `<p>${esc(lvl.intro)}</p>
       <ul class="nl-facts">
         <li>Clock: <b>${lvl.time}s</b>${lvl.crystal ? ` · crystals +${lvl.crystal}s` : ''}</li>
         <li>Stars: ★★★ under ${three}s · ★★ under ${two}s</li>
         ${best != null ? `<li>Your best: <b>${fmt(best)}s</b> ${starStr(progress.stars[i] || 0)}</li>` : ''}
       </ul>`,
      [
        { label: 'Levels', run: openLevels },
        { label: isTouch ? 'Start' : 'Start (Enter)', primary: true, run: () => { hideModal(); game.begin(); } },
      ]);
  }

  function startLevel(i, withBriefing = true) {
    game.load(i);
    renderer.layout(game);
    heldDirs.length = 0; game.setHeld([]);
    updateHUD(true);
    if (withBriefing) briefing();
    else { hideModal(); game.begin(); }
  }

  function onWin() {
    const i = game.levelIndex, t = game.elapsed, stars = game.stars;
    const prevBest = progress.best[i];
    const newBest = prevBest == null || t < prevBest;
    if (newBest) progress.best[i] = t;
    progress.stars[i] = Math.max(progress.stars[i] || 0, stars);
    saveProgress();
    const last = i === game.levelCount() - 1;
    const [three] = game.starThresholds();
    const totalStars = Object.values(progress.stars).reduce((a, b) => a + b, 0);
    const body = `
      <p class="nl-stars" aria-label="${stars} of 3 stars">${starStr(stars)}</p>
      <ul class="nl-facts">
        <li>Time: <b>${fmt(t)}s</b>${newBest ? ' <span class="nl-badge">New best!</span>' : ` · best ${fmt(prevBest)}s`}</li>
        ${game.crystalsTotal ? `<li>Crystals: ${game.crystalsTaken}/${game.crystalsTotal}</li>` : ''}
        ${game.scanners.length ? `<li>Scanner hits: ${game.hits}</li>` : ''}
        ${stars < 3 ? `<li>Three stars: finish under ${three}s. The maze is the same every time, so learn the route.</li>` : ''}
        ${last ? `<li>Total stars: <b>${totalStars}/${game.levelCount() * 3}</b></li>` : ''}
      </ul>`;
    showModal(last ? 'Labyrinth cleared!' : 'Level complete', body, [
      { label: 'Levels', run: openLevels },
      { label: 'Retry' + hint('R'), run: () => startLevel(i, false) },
      last
        ? { label: 'Play again', primary: true, run: () => startLevel(0) }
        : { label: isTouch ? 'Next' : 'Next (Enter)', primary: true, run: () => startLevel(i + 1) },
    ]);
  }

  function onLose() {
    const i = game.levelIndex;
    const tip = game.crystalsTotal > game.crystalsTaken ? 'Crystals in dead ends add time to the clock.'
      : 'The maze never changes. What you mapped this run still counts next time.';
    showModal('Time up', `<p>${tip}</p>`, [
      { label: 'Levels', run: openLevels },
      { label: isTouch ? 'Retry' : 'Retry (Enter)', primary: true, run: () => startLevel(i, false) },
    ]);
  }

  function openLevels() {
    const resumeAfter = game.state === 'playing';
    game.setPaused(true);
    const cells = game.levels.map((l, i) => {
      const open = isUnlocked(i);
      const best = progress.best[i];
      return `<button type="button" class="nl-level-card${i === game.levelIndex ? ' current' : ''}" data-level="${i}" ${open ? '' : 'disabled'}>
        <span class="nl-level-num">${i + 1}</span>
        <span class="nl-level-title">${open ? esc(l.name) : 'Locked'}</span>
        <span class="nl-level-stars">${open ? starStr(progress.stars[i] || 0) : '🔒'}</span>
        <span class="nl-level-best">${best != null ? fmt(best) + 's' : ''}</span>
      </button>`;
    }).join('');
    showModal('Levels', `<div class="nl-level-grid">${cells}</div>`, [
      { label: 'Close', primary: true, run: closeLevels },
    ], closeLevels);
    el.modalBody.querySelectorAll('[data-level]').forEach(b =>
      b.addEventListener('click', () => startLevel(parseInt(b.dataset.level, 10))));
    function closeLevels() {
      hideModal();
      if (game.state === 'ready') briefing();
      else if (game.state === 'won') onWin();
      else if (game.state === 'lost') onLose();
      else if (resumeAfter) game.setPaused(false);
    }
  }

  // ------------------------------------------------------------ HUD
  const last = {};
  function setText(node, key, value) { if (last[key] !== value) { last[key] = value; node.textContent = value; } }
  function updateHUD(force) {
    if (force) for (const k in last) delete last[k];
    const lvl = game.level, i = game.levelIndex;
    setText(el.level, 'level', String(i + 1));
    setText(el.levelName, 'name', lvl.name);
    setText(el.time, 'time', fmt(game.timeLeft));
    const pct = Math.max(0, Math.min(100, game.timeLeft / lvl.time * 100));
    el.timeBar.style.setProperty('--pct', pct + '%');
    const low = game.timeLeft < 5 && game.state === 'playing';
    el.timeBar.classList.toggle('low', low);
    el.time.classList.toggle('nl-low', low);
    if (last.pct !== Math.round(pct)) { last.pct = Math.round(pct); el.timeBar.setAttribute('aria-valuenow', String(last.pct)); }
    const hasDoors = lvl.map.some(r => /[ABC]/.test(r));
    el.keysWrap.classList.toggle('hidden', !hasDoors);
    const keyStr = [...game.keys].sort().join('');
    if (last.keys !== keyStr) {
      last.keys = keyStr;
      el.keys.innerHTML = keyStr ? [...keyStr].map(k => `<span class="nl-key nl-key-${k}" title="Key ${k.toUpperCase()}"></span>`).join('') : 'none';
    }
    el.crystalsWrap.classList.toggle('hidden', !game.crystalsTotal);
    setText(el.crystals, 'crystals', `${game.crystalsTaken}/${game.crystalsTotal}`);
    setText(el.best, 'best', progress.best[i] != null ? `${fmt(progress.best[i])}s ${starStr(progress.stars[i] || 0)}` : '–');
    const status = { ready: 'Ready', playing: '', paused: 'Paused', won: 'Escaped!', lost: 'Time up' }[game.state];
    setText(el.status, 'status', status);
    el.pauseBtn.setAttribute('aria-pressed', String(game.state === 'paused'));
    setText(el.pauseBtn, 'pauseLabel', game.state === 'paused' ? 'Resume' + hint('P') : 'Pause' + hint('P'));
  }

  // ------------------------------------------------------------ input
  const KEYMAP = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
  const heldDirs = [];
  function press(dir) {
    const i = heldDirs.indexOf(dir);
    if (i >= 0) heldDirs.splice(i, 1);
    heldDirs.unshift(dir);
    game.setHeld(heldDirs);
    if (game.state === 'playing') game.queue(dir);
  }
  function release(dir) {
    const i = heldDirs.indexOf(dir);
    if (i >= 0) heldDirs.splice(i, 1);
    game.setHeld(heldDirs);
  }
  function releaseAll() { heldDirs.length = 0; game.setHeld([]); el.dpad.querySelectorAll('.on').forEach(b => b.classList.remove('on')); }

  function togglePause() {
    if (modalOpen()) return;
    game.togglePause();
    if (game.state === 'paused') releaseAll();
  }
  function restart() {
    if (modalOpen() && el.modalTitle.textContent === 'Levels') return;
    startLevel(game.levelIndex, false);
  }

  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const dir = KEYMAP[k];
    if (dir || k === ' ' ) e.preventDefault();
    sound.ensure();
    if (modalOpen()) {
      if (k === 'enter' && modalPrimary) { e.preventDefault(); modalPrimary(); }
      else if (k === 'escape' && modalOnClose) modalOnClose();
      else if (k === 'r' && game.state !== 'ready') restart();
      else if (k === 'l' && el.modalTitle.textContent !== 'Levels') openLevels();
      return;
    }
    if (dir) { if (!e.repeat) press(dir); return; }
    if (k === 'p' || k === 'escape' || k === ' ') togglePause();
    else if (k === 'r') restart();
    else if (k === 'l') openLevels();
    else if (k === 'm') toggleSound();
    else if (k === 'enter' && game.state === 'ready') game.begin();
  });
  window.addEventListener('keyup', e => { const dir = KEYMAP[e.key.toLowerCase()]; if (dir) release(dir); });
  window.addEventListener('blur', () => { releaseAll(); game.setPaused(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseAll(); game.setPaused(true); } });

  // d-pad (touch): hold to glide
  el.dpad.querySelectorAll('button[data-dir]').forEach(b => {
    const dir = b.dataset.dir;
    const down = e => { e.preventDefault(); sound.ensure(); b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (_) {} press(dir); };
    const up = () => { b.classList.remove('on'); release(dir); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', e => e.preventDefault());
  });
  // tap the maze to pause / resume on touch
  canvas.addEventListener('click', () => { if (isTouch && !modalOpen()) togglePause(); });

  // ------------------------------------------------------------ top bar
  el.levelsBtn.addEventListener('click', () => { if (!(modalOpen() && el.modalTitle.textContent === 'Levels')) openLevels(); });
  el.pauseBtn.addEventListener('click', togglePause);
  el.restartBtn.addEventListener('click', restart);

  function applySound() {
    el.soundBtn.setAttribute('aria-pressed', String(sound.on));
    el.soundBtn.textContent = sound.on ? 'Sound: On' : 'Sound: Off';
  }
  function toggleSound() { sound.on = !sound.on; store.set('sound', sound.on); applySound(); if (sound.on) sound.tone(880, 0.06, 'triangle', 0.03); }
  el.soundBtn.addEventListener('click', toggleSound);
  applySound();

  let crt = store.get('crt', true);
  function applyCrt() {
    el.scanlines.classList.toggle('hidden', !crt);
    canvas.classList.toggle('nl-crt', crt);
    el.crtBtn.setAttribute('aria-pressed', String(crt));
    el.crtBtn.textContent = crt ? 'CRT: On' : 'CRT: Off';
  }
  el.crtBtn.addEventListener('click', () => { crt = !crt; store.set('crt', crt); applyCrt(); });
  applyCrt();

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    el.themeBtn.setAttribute('aria-pressed', String(theme === 'light'));
    el.themeBtn.textContent = theme === 'light' ? 'Dark Theme' : 'Light Theme';
    renderer.setTheme(theme);
  }
  {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(store.get('theme', null) || (prefersLight ? 'light' : 'dark'));
    el.themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      store.set('theme', next);
      applyTheme(next);
    });
  }

  // re-fit cells when the canvas display size changes (small screens zoom in + scroll)
  let lastWidth = canvas.clientWidth;
  window.addEventListener('resize', () => {
    clearTimeout(window.__nlResize);
    window.__nlResize = setTimeout(() => {
      if (Math.abs(canvas.clientWidth - lastWidth) > 24) { lastWidth = canvas.clientWidth; renderer.layout(game); }
    }, 150);
  });

  // ------------------------------------------------------------ loop
  let prev = 0, endTimer = null;
  function frame(ts) {
    const dt = prev ? Math.min(0.05, (ts - prev) / 1000) : 0;
    prev = ts;
    const before = game.state;
    game.update(dt);
    const events = game.drainEvents();
    renderer.handleEvents(events);
    for (const e of events) playEvent(e);
    if (before === 'playing' && (game.state === 'won' || game.state === 'lost')) {
      releaseAll();
      clearTimeout(endTimer);
      const levelAtEnd = game.levelIndex, stateAtEnd = game.state;
      endTimer = setTimeout(() => {
        if (game.levelIndex !== levelAtEnd || game.state !== stateAtEnd || modalOpen()) return;
        if (stateAtEnd === 'won') onWin(); else onLose();
      }, 700);
    }
    renderer.draw(ts, dt);
    updateHUD(false);
    requestAnimationFrame(frame);
  }

  // first visit starts at the furthest unlocked level
  let startAt = 0;
  while (startAt + 1 < game.levelCount() && isUnlocked(startAt + 1)) startAt++;
  startLevel(startAt);
  requestAnimationFrame(frame);
})();
