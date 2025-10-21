// UI wiring for Neon Labyrinth ’89
(function(){
  const canvas = document.getElementById('game');
  const levelEl = document.getElementById('level');
  const timeEl = document.getElementById('time');
  const statusEl = document.getElementById('status');
  const restartBtn = document.getElementById('restart-btn');
  const themeBtn = document.getElementById('theme-btn');
  const soundBtn = document.getElementById('sound-btn');
  const levelSelect = document.getElementById('level-select');
  const vjoy = document.getElementById('vjoy');

  const core = new window.NeonLabyrinthCore(canvas, {
    onUpdateHUD: ({ level, time }) => {
      levelEl.textContent = String(level);
      timeEl.textContent = time.toFixed(1);
      if (levelSelect && levelSelect.value !== String(level)) {
        levelSelect.value = String(level);
      }
    },
    onStatus: (text) => { statusEl.textContent = text; },
  });

  // Controls
  restartBtn.addEventListener('click', () => core.restart());
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'enter') core.startOrAdvance();
    else if (k === 'r') core.restart();
    else if (k === 'arrowup' || k === 'w') core.tryMove(-1, 0);
    else if (k === 'arrowdown' || k === 's') core.tryMove(1, 0);
    else if (k === 'arrowleft' || k === 'a') core.tryMove(0, -1);
    else if (k === 'arrowright' || k === 'd') core.tryMove(0, 1);
  });

  // Sound toggle
  (function setupSound(){
    const key = 'nl89.sound';
    const saved = localStorage.getItem(key);
    const enabled = saved == null ? 'true' : saved;
    const initial = enabled === 'true';
    core.setSoundEnabled(initial);
    soundBtn.setAttribute('aria-pressed', String(initial));
    soundBtn.textContent = initial ? 'Sound' : 'Muted';
    soundBtn.addEventListener('click', () => {
      const now = soundBtn.getAttribute('aria-pressed') !== 'true';
      soundBtn.setAttribute('aria-pressed', String(now));
      soundBtn.textContent = now ? 'Sound' : 'Muted';
      core.setSoundEnabled(now);
      localStorage.setItem(key, String(now));
    });
  })();

  // Theme handling (matches other games pattern)
  (function setupTheme(){
    const key = 'nl89.theme';
    const saved = localStorage.getItem(key);
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = saved || (prefersLight ? 'light' : 'dark');
    applyTheme(theme);
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      localStorage.setItem(key, next);
    });
  })();

  function applyTheme(theme){
    if (theme === 'light'){
      document.documentElement.setAttribute('data-theme', 'light');
      themeBtn.setAttribute('aria-pressed', 'true');
      themeBtn.textContent = 'Dark Theme';
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeBtn.setAttribute('aria-pressed', 'false');
      themeBtn.textContent = 'Light Theme';
    }
  }

  // Level selector
  (function setupLevelSelect(){
    const count = core.levelCount ? core.levelCount() : 5;
    levelSelect.innerHTML = '';
    for (let i = 1; i <= count; i++){
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Level ${i}`;
      levelSelect.appendChild(opt);
    }
    levelSelect.value = '1';
    levelSelect.addEventListener('change', () => {
      const idx = parseInt(levelSelect.value, 10) - 1;
      core.goToLevel(idx);
    });
  })();

  // Virtual Joystick (mobile-only)
  (function setupVirtualJoystick(){
    if (!vjoy) return;
    const isTouch = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (!isTouch) return; // keep inactive on non-touch

    const base = vjoy.querySelector('.vjoy-base');
    const stick = vjoy.querySelector('.vjoy-stick');
    const center = { x: 60, y: 60 };
    const maxRadius = 40; // pixels from center
    let dir = null; // 'u','d','l','r'
    let repeatTimer = null;

    function setStick(dx, dy){
      const r = Math.hypot(dx, dy);
      const clamped = r > maxRadius ? maxRadius : r;
      const angle = Math.atan2(dy, dx);
      const x = Math.cos(angle) * clamped;
      const y = Math.sin(angle) * clamped;
      stick.style.transform = `translate(${x}px, ${y}px)`;
      stick.style.left = `${center.x}px`;
      stick.style.top = `${center.y}px`;
    }

    function resetStick(){
      stick.style.left = `${center.x}px`;
      stick.style.top = `${center.y}px`;
      stick.style.transform = 'translate(-50%, -50%)';
    }

    function computeDir(dx, dy){
      const dead = 10; // dead zone
      if (Math.abs(dx) < dead && Math.abs(dy) < dead) return null;
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'r' : 'l';
      return dy > 0 ? 'd' : 'u';
    }

    function moveOnce(d){
      switch(d){
        case 'u': core.tryMove(-1,0); break;
        case 'd': core.tryMove(1,0); break;
        case 'l': core.tryMove(0,-1); break;
        case 'r': core.tryMove(0,1); break;
      }
    }

    function startRepeat(){
      stopRepeat();
      if (!dir) return;
      moveOnce(dir); // immediate step
      repeatTimer = setInterval(() => moveOnce(dir), 140);
    }
    function stopRepeat(){ if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; } }

    function localCoords(touch){
      const rect = base.getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }

    function onStart(e){
      const t = e.touches[0]; if (!t) return;
      const p = localCoords(t);
      const dx = p.x - center.x, dy = p.y - center.y;
      setStick(dx, dy);
      const nd = computeDir(dx, dy);
      if (nd !== dir){ dir = nd; startRepeat(); }
      e.preventDefault();
    }
    function onMove(e){
      const t = e.touches[0]; if (!t) return;
      const p = localCoords(t);
      const dx = p.x - center.x, dy = p.y - center.y;
      setStick(dx, dy);
      const nd = computeDir(dx, dy);
      if (nd !== dir){ dir = nd; startRepeat(); }
      e.preventDefault();
    }
    function onEnd(){ stopRepeat(); dir = null; resetStick(); }

    base.addEventListener('touchstart', onStart, { passive: false });
    base.addEventListener('touchmove', onMove, { passive: false });
    base.addEventListener('touchend', onEnd, { passive: false });
    base.addEventListener('touchcancel', onEnd, { passive: false });

    // Initialize knob position
    resetStick();
  })();
})();
