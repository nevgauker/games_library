// Micro Racer UI: canvas rendering, input (keyboard + touch), HUD, results, records, sound
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const W = 640, H = 360;                                  // logical canvas size (matches the engine)
  const SCALE = Math.min(2, Math.ceil(window.devicePixelRatio || 1)); // crisp on high-DPI screens

  const hud = {
    lap: $('lap'), lapTotal: $('lap-total'), pos: $('pos'), carTotal: $('car-total'),
    time: $('time'), lastLap: $('last-lap'), bestLap: $('best-lap'), bestRace: $('best-race'), status: $('status'),
  };
  const modal = $('modal'), modalTitle = $('modal-title'), modalMessage = $('modal-message');
  const modalBadges = $('modal-badges'), resultsBody = $('results-body');
  const modalRestart = $('modal-restart'), modalClose = $('modal-close');
  const restartBtn = $('restart-btn'), pauseBtn = $('pause-btn'), soundBtn = $('sound-btn'), themeBtn = $('theme-btn');
  const trackSel = $('track-select'), aiSel = $('ai-select');

  const isTouch = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function load(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }
  function store(k, v){ try { localStorage.setItem(k, v); } catch {} }

  const { TRACKS, LAPS } = window.__RACE_CONST;
  const game = new RaceGame();

  canvas.width = W * SCALE; canvas.height = H * SCALE;
  canvas.tabIndex = 0;
  setTimeout(() => canvas.focus(), 0);

  // Restore the last track / AI choice
  const savedTrack = load('race.track', 'oval'), savedAI = load('race.ai', 'normal');
  if (TRACKS[savedTrack]) trackSel.value = savedTrack;
  if ([...aiSel.options].some(o => o.value === savedAI)) aiSel.value = savedAI;
  game.setTrack(trackSel.value); game.setAI(aiSel.value);

  // ---------- Helpers ----------
  function ordinal(n){ const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); }
  function fmt(t){
    if (t == null || !isFinite(t)) return '—';
    if (t < 60) return t.toFixed(2) + 's';
    const m = Math.floor(t / 60); return `${m}:${(t - m*60).toFixed(2).padStart(5, '0')}`;
  }
  function setText(el, v){ if (el && el.textContent !== v) el.textContent = v; }
  const AI_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

  // ---------- Records (per track, in this browser) ----------
  function getRecords(){ try { return JSON.parse(load('race.best.' + game.trackKey, '{}')) || {}; } catch { return {}; } }
  function setRecords(r){ store('race.best.' + game.trackKey, JSON.stringify(r)); }
  let raceBadges = [];
  function showRecords(){
    const r = getRecords();
    setText(hud.bestLap, fmt(r.lap)); setText(hud.bestRace, fmt(r.race));
  }

  // ---------- Theme ----------
  const PALETTES = {
    dark: {
      grass: '#0b2416', speckA: 'rgba(52,211,153,0.07)', speckB: 'rgba(0,0,0,0.2)',
      asphalt: '#2b313d', center: 'rgba(226,232,240,0.22)', curbA: '#e2e8f0', curbB: '#e11d48',
      startA: '#f8fafc', startB: '#0f172a', skid: '8,10,14', dust: '140,110,60', smoke: '200,205,215',
      shade: 'rgba(2,6,23,0.62)', text: '#f8fafc', sub: '#cbd5e1', outline: 'rgba(7,17,31,0.85)',
      ring: '#f8fafc', accent: '#34d399', warn: '#eab308', danger: '#f43f5e',
    },
    light: {
      grass: '#8cc47a', speckA: 'rgba(255,255,255,0.2)', speckB: 'rgba(22,101,52,0.16)',
      asphalt: '#4b5263', center: 'rgba(255,255,255,0.5)', curbA: '#ffffff', curbB: '#dc2626',
      startA: '#ffffff', startB: '#111827', skid: '20,22,28', dust: '120,90,40', smoke: '240,242,245',
      shade: 'rgba(248,250,252,0.72)', text: '#0f172a', sub: '#334155', outline: 'rgba(255,255,255,0.92)',
      ring: '#0f172a', accent: '#059669', warn: '#b45309', danger: '#dc2626',
    },
  };
  const curTheme = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  themeBtn.setAttribute('aria-pressed', String(curTheme() === 'light'));
  themeBtn.addEventListener('click', () => {
    const next = curTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    themeBtn.setAttribute('aria-pressed', String(next === 'light'));
    canvas.focus();
  });

  // ---------- Sound (Web Audio, off by default) ----------
  const sound = { on: load('race.sound', '0') === '1', ac: null };
  function ensureAudio(){
    if (!sound.on) return;
    if (!sound.ac){
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ac = sound.ac = new AC();
      const master = sound.master = ac.createGain(); master.gain.value = 0.18; master.connect(ac.destination);
      // engine: sawtooth through a low-pass, pitch follows speed
      const eng = sound.eng = ac.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 60;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const eg = sound.engGain = ac.createGain(); eg.gain.value = 0;
      eng.connect(lp).connect(eg).connect(master); eng.start();
      // tyres: looped noise through a band-pass, volume follows sliding
      const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1;
      const noise = ac.createBufferSource(); noise.buffer = buf; noise.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.8;
      const ng = sound.skidGain = ac.createGain(); ng.gain.value = 0;
      noise.connect(bp).connect(ng).connect(master); noise.start();
    }
    if (sound.ac.state === 'suspended') sound.ac.resume();
  }
  function blip(freq, dur, type = 'square', vol = 0.5, delay = 0){
    if (!sound.on || !sound.ac) return;
    const ac = sound.ac, o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + delay;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(sound.master); o.start(t); o.stop(t + dur + 0.02);
  }
  function updateAudio(){
    if (!sound.ac) return;
    const p = game.player, t = sound.ac.currentTime;
    const live = sound.on && !game.waiting && !game.paused && !p.finished;
    const v = Math.hypot(p.vx, p.vy);
    sound.eng.frequency.setTargetAtTime(55 + Math.abs(p.speed)*0.9, t, 0.05);
    sound.engGain.gain.setTargetAtTime(live ? 0.22 + (input().throttle > 0 ? 0.25 : 0) : 0, t, 0.08);
    const slide = live ? Math.min(0.5, p.skid*0.45 + (p.offRoad && v > 30 ? 0.12 : 0)) : 0;
    sound.skidGain.gain.setTargetAtTime(slide, t, 0.05);
  }
  function setSound(on){
    sound.on = !!on; store('race.sound', on ? '1' : '0');
    soundBtn.setAttribute('aria-pressed', String(sound.on));
    soundBtn.textContent = sound.on ? 'Sound: On' : 'Sound: Off';
    if (sound.on) ensureAudio(); else if (sound.ac) sound.ac.suspend();
  }
  soundBtn.addEventListener('click', () => { setSound(!sound.on); canvas.focus(); });
  setSound(sound.on);

  // ---------- Input: keyboard + touch merged ----------
  const keys = { throttle: 0, turn: 0, handbrake: false };
  const touch = { throttle: 0, turn: 0, handbrake: false };
  function input(){
    return {
      throttle: keys.throttle || touch.throttle,
      turn: keys.turn || touch.turn,
      handbrake: keys.handbrake || touch.handbrake,
    };
  }
  function clearInput(){ Object.assign(keys, { throttle: 0, turn: 0, handbrake: false }); Object.assign(touch, { throttle: 0, turn: 0, handbrake: false }); }

  const is = (e, ...names) => { const k = (e.key || '').toLowerCase(), c = e.code || ''; return names.some(n => n === k || n === c); };
  const UP = ['arrowup','w','ArrowUp','KeyW'], DOWN = ['arrowdown','s','ArrowDown','KeyS'];
  const LEFT = ['arrowleft','a','ArrowLeft','KeyA'], RIGHT = ['arrowright','d','ArrowRight','KeyD'];

  function onKey(e){
    if (e.target && (e.target.tagName === 'SELECT' || (e.target.tagName === 'BUTTON' && is(e, 'enter', ' ')))) return;
    if (isOpen()){
      if (is(e, 'enter')){ e.preventDefault(); resetRace(true); }
      else if (is(e, 'escape')){ e.preventDefault(); closeModal(); }
      return;
    }
    if (is(e, ...UP, ...DOWN, ...LEFT, ...RIGHT, ' ', 'Space')) e.preventDefault();
    if (is(e, 'r', 'KeyR')){ if (!e.repeat) resetRace(true); return; }
    if (is(e, 'p', 'KeyP', 'escape')){ if (!e.repeat) togglePause(); return; }
    if (game.waiting && is(e, 'enter', ' ', 'Space', ...UP)){ startRace(); }
    if (game.paused && is(e, 'enter', ' ', 'Space')){ togglePause(); return; }
    if (is(e, ...UP)) keys.throttle = 1;
    if (is(e, ...DOWN)) keys.throttle = -1;
    if (is(e, ...LEFT)) keys.turn = -1;
    if (is(e, ...RIGHT)) keys.turn = 1;
    if (is(e, ' ', 'Space')) keys.handbrake = true;
  }
  function onKeyUp(e){
    if (is(e, ...UP) && keys.throttle > 0) keys.throttle = 0;
    if (is(e, ...DOWN) && keys.throttle < 0) keys.throttle = 0;
    if (is(e, ...LEFT) && keys.turn < 0) keys.turn = 0;
    if (is(e, ...RIGHT) && keys.turn > 0) keys.turn = 0;
    if (is(e, ' ', 'Space')) keys.handbrake = false;
  }
  document.addEventListener('keydown', onKey, { passive: false });
  document.addEventListener('keyup', onKeyUp);

  // Tap / click the track to start or resume
  canvas.addEventListener('pointerdown', () => {
    canvas.focus(); ensureAudio();
    if (game.waiting) startRace(); else if (game.paused) togglePause();
  });

  // Touch: joystick steers (x, analog) and drives (push up = gas, down = brake); DRIFT is the handbrake
  (function setupTouch(){
    const vjoy = $('vjoy'), driftBtn = $('drift-btn');
    if (vjoy){
      const base = vjoy.querySelector('.vjoy-base'), stick = vjoy.querySelector('.vjoy-stick');
      const R = 40; let id = null;
      const place = (dx, dy) => { stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
      function move(e){
        const r = base.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width/2), dy = e.clientY - (r.top + r.height/2);
        const len = Math.hypot(dx, dy); if (len > R){ dx *= R/len; dy *= R/len; }
        place(dx, dy);
        const tx = dx / R;
        touch.turn = Math.abs(tx) < 0.15 ? 0 : Math.max(-1, Math.min(1, (tx - Math.sign(tx)*0.15) / 0.85));
        touch.throttle = dy < -12 ? 1 : dy > 16 ? -1 : 0;
      }
      function end(){ id = null; touch.turn = 0; touch.throttle = 0; place(0, 0); }
      base.addEventListener('pointerdown', e => {
        id = e.pointerId; base.setPointerCapture(id); ensureAudio();
        if (game.waiting) startRace(); else if (game.paused) togglePause();
        move(e); e.preventDefault();
      });
      base.addEventListener('pointermove', e => { if (e.pointerId === id){ move(e); e.preventDefault(); } });
      base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
    }
    if (driftBtn){
      const on = e => { touch.handbrake = true; driftBtn.classList.add('on'); e.preventDefault(); };
      const off = () => { touch.handbrake = false; driftBtn.classList.remove('on'); };
      driftBtn.addEventListener('pointerdown', on);
      driftBtn.addEventListener('pointerup', off); driftBtn.addEventListener('pointercancel', off); driftBtn.addEventListener('pointerleave', off);
    }
  })();

  // ---------- Race flow ----------
  // Every way of starting over goes through here so the modal, status and input are always reset.
  // autoStart skips the start screen (Restart / R): the driver is clearly ready.
  function resetRace(autoStart){
    closeModal(false);
    clearInput();
    game.restart();
    raceBadges = [];
    setText(hud.lastLap, '—');
    showRecords();
    if (autoStart) startRace();
    syncControls();
    canvas.focus();
  }
  function startRace(){ ensureAudio(); game.start(); syncControls(); }
  function togglePause(){ game.setPaused(!game.paused); }
  function syncControls(){
    pauseBtn.disabled = game.waiting || game.player.finished;
    pauseBtn.textContent = game.paused ? 'Resume' : 'Pause';
    pauseBtn.setAttribute('aria-pressed', String(game.paused));
  }

  restartBtn.addEventListener('click', () => resetRace(true));
  pauseBtn.addEventListener('click', () => { togglePause(); canvas.focus(); });
  modalRestart.addEventListener('click', () => resetRace(true));
  modalClose.addEventListener('click', () => closeModal(true));
  trackSel.addEventListener('change', () => { store('race.track', trackSel.value); game.setTrack(trackSel.value); resetRace(false); });
  aiSel.addEventListener('change', () => { store('race.ai', aiSel.value); game.setAI(aiSel.value); resetRace(false); });

  // Leaving the tab or window pauses the race (and drops held keys so nothing sticks)
  document.addEventListener('visibilitychange', () => { if (document.hidden){ clearInput(); game.setPaused(true); } });
  window.addEventListener('blur', () => { clearInput(); game.setPaused(true); });

  // ---------- Engine events ----------
  game.on('lap', ({lap,total}) => setText(hud.lap, String(Math.min(lap,total))));
  game.on('pos', p => setText(hud.pos, ordinal(p)));
  game.on('time', t => setText(hud.time, t.toFixed(1)));
  game.on('status', s => setText(hud.status, s || ''));
  game.on('paused', p => { syncControls(); setText(hud.status, p ? 'Paused' : ''); });
  game.on('tick', n => { if (n > 0) blip(440, 0.15, 'square', 0.35); else blip(880, 0.35, 'square', 0.4); });
  game.on('bump', k => { shake = reduceMotion ? 0 : Math.max(shake, 2 + 5*k); blip(80 + 40*k, 0.12, 'triangle', 0.3 + 0.4*k); });
  game.on('lapTime', ({lap, time}) => {
    setText(hud.lastLap, fmt(time));
    const r = getRecords();
    if (r.lap == null || time < r.lap){
      r.lap = time; setRecords(r); showRecords();
      if (!raceBadges.includes('New best lap!')) raceBadges.push('New best lap!');
      game.flash(`New best lap! ${fmt(time)}`, 2.5);
      blip(660, 0.12, 'square', 0.35); blip(990, 0.25, 'square', 0.35, 0.12);
    } else if (lap < LAPS){
      game.flash(`Lap ${lap}: ${fmt(time)}`, 2);
      blip(660, 0.15, 'square', 0.3);
    }
  });
  game.on('finish', ({pos, time}) => {
    const r = getRecords();
    if (r.race == null || time < r.race){ r.race = time; setRecords(r); showRecords(); raceBadges.unshift('New track record!'); }
    [523, 659, 784].forEach((f, i) => blip(f, 0.22, 'square', 0.35, i*0.14));
    modalTitle.textContent = pos === 1 ? 'You Win!' : 'Race Complete';
    modalMessage.textContent = `You finished ${ordinal(pos)} of ${game.cars.length} · ${fmt(time)} · ${TRACKS[game.trackKey].name}, ${AI_NAMES[game.aiLevel]} AI`;
    modalBadges.textContent = raceBadges.join(' · ');
    modalBadges.hidden = raceBadges.length === 0;
    renderResults();
    modal.classList.remove('hidden');
    syncControls();
    setTimeout(() => modalRestart.focus(), 0);
  });

  function isOpen(){ return !modal.classList.contains('hidden'); }
  function closeModal(focus){ modal.classList.add('hidden'); if (focus) canvas.focus(); }

  // Results table; refreshed while the modal is open as the rivals cross the line
  function renderResults(){
    const rows = game.standings().map((c, i) => {
      const best = c.lapTimes.length ? Math.min(...c.lapTimes) : null;
      const time = c.finished ? fmt(c.time) : `Lap ${Math.min(c.lap, LAPS)}/${LAPS}…`;
      return `<tr class="${c.isPlayer ? 'you' : ''}"><td>${ordinal(i+1)}</td>` +
        `<td><span class="race-swatch" style="background:${c.color}"></span>${c.name}</td>` +
        `<td>${time}</td><td>${fmt(best)}</td></tr>`;
    }).join('');
    if (resultsBody.innerHTML !== rows) resultsBody.innerHTML = rows;
  }

  // ---------- Effects: skid marks, dust/smoke, bump shake ----------
  function layer(){
    const c = document.createElement('canvas'); c.width = W*SCALE; c.height = H*SCALE;
    const g = c.getContext('2d'); g.scale(SCALE, SCALE); return [c, g];
  }
  const [marks, mctx] = layer();
  const lastWheels = new Map(); // car -> previous rear wheel positions while skidding
  let particles = [], shake = 0;

  game.on('reset', () => {
    mctx.clearRect(0, 0, W, H);
    lastWheels.clear(); particles = []; shake = 0;
  });

  function rearWheels(c){
    const fx = Math.cos(c.a), fy = Math.sin(c.a), bx = c.x - fx*7, by = c.y - fy*7;
    return [[bx - fy*4, by + fx*4], [bx + fy*4, by - fx*4]];
  }
  function layMarks(P){
    for (const c of game.cars){
      if (c.finished || c.skid < 0.05){ lastWheels.delete(c); continue; }
      const now = rearWheels(c), prev = lastWheels.get(c);
      if (prev){
        mctx.strokeStyle = `rgba(${P.skid},${0.25 + 0.35*c.skid})`; mctx.lineWidth = 2; mctx.lineCap = 'round';
        for (let w = 0; w < 2; w++){ mctx.beginPath(); mctx.moveTo(prev[w][0], prev[w][1]); mctx.lineTo(now[w][0], now[w][1]); mctx.stroke(); }
      }
      lastWheels.set(c, now);
    }
  }
  function updateParticles(dt, P){
    if (dt > 0){
      for (const c of game.cars){
        if (c.finished) continue;
        const v = Math.hypot(c.vx, c.vy);
        const dust = c.offRoad && v > 30, smoke = c.skid > 0.3;
        if (!(dust || smoke) || Math.random() > dt*40) continue;
        const [[x, y]] = rearWheels(c);
        particles.push({
          x, y, vx: -c.vx*0.15 + (Math.random()-0.5)*20, vy: -c.vy*0.15 + (Math.random()-0.5)*20,
          life: 0.6, max: 0.6, r: 2 + Math.random()*2, color: dust ? P.dust : P.smoke,
        });
      }
    }
    for (const p of particles){ p.x += p.vx*dt; p.y += p.vy*dt; p.life -= dt; p.r += dt*6; }
    particles = particles.filter(p => p.life > 0).slice(-300);
  }
  function drawParticles(){
    for (const p of particles){
      ctx.fillStyle = `rgba(${p.color},${0.35 * p.life / p.max})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
    }
  }

  // ---------- Track layer (drawn once per track + theme) ----------
  let trackCache = null, cacheKey = null;
  function trackLayer(P, theme){
    const key = game.trackKey + ':' + theme;
    if (cacheKey === key && trackCache) return trackCache;
    cacheKey = key;
    const R = game.road, [off, g] = layer();
    trackCache = off;

    // grass, with a fixed speckle so it doesn't shimmer between restarts
    g.fillStyle = P.grass; g.fillRect(0, 0, W, H);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 1100; i++){
      g.fillStyle = rnd() < 0.5 ? P.speckA : P.speckB;
      g.fillRect(rnd() * W, rnd() * H, 2, 2);
    }
    const path = new Path2D();
    R.pts.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y));
    path.closePath();
    g.lineJoin = 'round'; g.lineCap = 'round';
    // red/white curbs just outside the road edge
    g.lineWidth = 2*R.half + 8; g.strokeStyle = P.curbA; g.stroke(path);
    g.setLineDash([10, 10]); g.strokeStyle = P.curbB; g.stroke(path); g.setLineDash([]);
    // asphalt and a faint centre line
    g.lineWidth = 2*R.half; g.strokeStyle = P.asphalt; g.stroke(path);
    g.lineWidth = 1.5; g.setLineDash([10, 14]); g.strokeStyle = P.center; g.stroke(path); g.setLineDash([]);
    // checkered start line across the road
    const [x, y] = R.pts[0], [tx, ty] = R.tan[0], sq = 4, w = Math.ceil(R.half / sq) * sq;
    g.save();
    g.translate(x, y); g.transform(-ty, tx, tx, ty, 0, 0); // x: across the road, y: along it
    for (let i = -w; i < w; i += sq) for (let j = 0; j < 2; j++){
      g.fillStyle = ((i/sq + j) & 1) ? P.startA : P.startB;
      g.fillRect(i, (j-1)*sq, sq, sq);
    }
    g.restore();
    return off;
  }

  // ---------- Rendering ----------
  function render(dt){
    const theme = curTheme(), P = PALETTES[theme];
    const running = !game.waiting && !game.paused && game.countdown <= 0;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.save();
    if (shake > 0.2) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
    shake *= Math.pow(0.85, dt*60);
    ctx.drawImage(trackLayer(P, theme), 0, 0, W, H);
    if (running) layMarks(P);
    ctx.drawImage(marks, 0, 0, W, H);
    updateParticles(game.paused ? 0 : dt, P);
    drawParticles();
    for (const c of game.cars) drawCar(c, P);
    ctx.restore();

    if (game.waiting) return drawStartScreen(P);
    if (game.countdown > 0 || game.clock < 2) drawYou(P);
    drawWrongWay(P);
    drawCountdown(P);
    if (game.paused) drawPaused(P);
  }

  function roundRect(g, x, y, w, h, r){
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
  }
  function drawCar(c, P){
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(c.a);
    if (c.finished) ctx.globalAlpha = 0.35; // finished cars are ghosts
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; roundRect(ctx, -8, -3.5, 18, 10, 3); ctx.fill();   // shadow
    ctx.fillStyle = '#0b0f17';                                                             // wheels
    for (const [wx, wy] of [[-7,-6.5],[3,-6.5],[-7,4.5],[3,4.5]]) ctx.fillRect(wx, wy, 4.5, 2);
    ctx.fillStyle = c.color; roundRect(ctx, -9, -5, 18, 10, 3); ctx.fill();               // body
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-9, -1, 18, 2);                 // stripe
    ctx.fillStyle = 'rgba(15,23,42,0.75)'; ctx.fillRect(1, -3.5, 3.5, 7);                  // windscreen
    if (c.isPlayer){ ctx.strokeStyle = P.ring; ctx.lineWidth = 1.5; roundRect(ctx, -9, -5, 18, 10, 3); ctx.stroke(); }
    ctx.restore();
  }

  function label(text, x, y, size, fill, P, align = 'center'){
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size/8); ctx.strokeStyle = P.outline; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }

  function drawYou(P){
    const p = game.player, y = p.y - 18;
    label('YOU', p.x, y - 6, 11, P.text, P);
    ctx.fillStyle = P.text; ctx.beginPath(); ctx.moveTo(p.x - 4, y + 1); ctx.lineTo(p.x + 4, y + 1); ctx.lineTo(p.x, y + 6); ctx.fill();
  }

  function drawStartScreen(P){
    ctx.fillStyle = P.shade; ctx.fillRect(0, 0, W, H);
    drawYou(P);
    const r = getRecords();
    label('MICRO RACER', W/2, 92, 44, P.accent, P);
    label(`${TRACKS[game.trackKey].name} · ${AI_NAMES[game.aiLevel]} AI · ${LAPS} laps`, W/2, 140, 18, P.text, P);
    label(`Best race ${fmt(r.race)}   ·   Best lap ${fmt(r.lap)}`, W/2, 168, 14, P.sub, P);
    const blink = reduceMotion || (performance.now() % 1000) < 650;
    if (blink) label(isTouch ? 'Tap to race' : 'Press Enter or ↑ to race', W/2, 222, 22, P.warn, P);
    label(isTouch ? 'Joystick: steer · push up to go, down to brake · hold DRIFT to slide'
                  : 'Arrows / WASD drive · Space handbrake · P pause · R restart', W/2, 262, 13, P.sub, P);
    label("Stay on the road: grass slows you and shortcuts don't count", W/2, 284, 13, P.sub, P);
  }

  function drawPaused(P){
    ctx.fillStyle = P.shade; ctx.fillRect(0, 0, W, H);
    label('PAUSED', W/2, H/2 - 14, 40, P.text, P);
    label(isTouch ? 'Tap to resume' : 'Press P to resume', W/2, H/2 + 24, 16, P.sub, P);
  }

  function drawWrongWay(P){
    const p = game.player;
    if (p.finished || p.wrongWay < 0.6 || (performance.now() % 600) > 400) return;
    label('WRONG WAY', W/2, 60, 32, P.danger, P);
  }

  function drawCountdown(P){
    let text = null;
    if (game.countdown > 0) text = String(Math.ceil(game.countdown));
    else if (game.clock < 0.8) text = 'GO!';
    if (text) label(text, W/2, H/2, 72, text === 'GO!' ? P.accent : P.warn, P);
  }

  // ---------- Main loop ----------
  setText(hud.lapTotal, String(LAPS));
  setText(hud.carTotal, String(game.cars.length));
  let last = performance.now(), resultsT = 0;
  function loop(t){
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    game.input(input());
    game.step(dt);
    render(dt);
    updateAudio();
    if (isOpen() && (resultsT -= dt) <= 0){ resultsT = 0.25; renderResults(); }
    requestAnimationFrame(loop);
  }
  resetRace(false);
  requestAnimationFrame(loop);
})();
