// Backspace UI: rendering, input, menus, progress and audio.
(function(){
  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');
  const statusEl = $('status');
  const pipsEl = $('echo-pips');
  const timeEl = $('time');
  const parEl = $('par');
  const themeBtn = $('theme-btn');
  const soundBtn = $('sound-btn');
  const pauseBtn = $('pause-btn');
  const touchEl = $('touch');
  const winModal = $('modal'), levelsModal = $('levels-modal'), pauseModal = $('pause-modal');

  const C = window.__BACKSPACE_CONST;
  const LEVELS = window.BACKSPACE_LEVELS || [];
  const TILE = C.TILE;
  const STEP_MS = 1000 / 60;
  const MARGIN = 10;          // canvas padding around the map (map units)
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CH_SHAPE = { a:'circle', b:'triangle', c:'square' };

  let game = null;
  let levelIndex = 0;
  let paused = false;
  const keys = { left:false, right:false, jump:false, rewind:false };
  const touch = { left:false, right:false, jump:false, rewind:false };
  const input = { left:false, right:false, jump:false, rewind:false };
  let raf = 0, lastTime = 0, acc = 0;
  let view = { scale: 1, dpr: 1 };
  let pal = null;
  let flashAlpha = 0, flashColor = '#ffffff';
  let lastTimeText = '';
  // Demo playback: replays a level's verified solution (src/backspace_demos.js)
  const DEMOS = window.BACKSPACE_DEMOS || {};
  const DEMO_SEEN_KEY = 'backspace.demoSeen.v1';
  let demo = null;            // { tape, i, captions, caption, mask, done }
  // Level-1 coaching
  let coach = { plateFrames: 0, msg: '', target: null };

  // Purely visual state; never affects the simulation
  const fx = { particles: [], shake: 0, squash: 0, doorAnim: {}, plateGlow: {}, bob: 0 };

  // ---------- Progress ----------
  const PROGRESS_KEY = 'backspace.progress.v1';
  let progress = loadProgress();
  function loadProgress(){ try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { return {}; } }
  function saveProgress(){ safeSet(PROGRESS_KEY, JSON.stringify(progress)); }
  function recordOf(i){ return progress[LEVELS[i].name] || null; }
  function unlocked(i){ return i === 0 || !!recordOf(i - 1) || !!recordOf(i); }
  function starsFor(def, frames, echoes){
    const par = def.par || {};
    let s = 1;
    if (par.echoes == null || echoes <= par.echoes) s++;
    if (par.time == null || frames / 60 <= par.time) s++;
    return s;
  }
  function totalStars(){ return LEVELS.reduce((n, d) => n + ((progress[d.name] && progress[d.name].stars) || 0), 0); }

  // ---------- Setup ----------
  function init(){
    setupTheme();
    setupInput();
    setupTouch();
    setupMenus();
    setupAudio();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { if (document.hidden && !game.win) setPaused(true); });
    const last = Number(safeGet('backspace.last') || 0);
    loadLevel(Number.isFinite(last) && last < LEVELS.length && unlocked(last) ? last : 0);
    raf = requestAnimationFrame(tick);
  }

  function loadLevel(i, opts = {}){
    levelIndex = Math.max(0, Math.min(LEVELS.length - 1, i));
    safeSet('backspace.last', String(levelIndex));
    game = new BackspaceGame(levelIndex);
    fx.particles.length = 0; fx.shake = 0; fx.squash = 0;
    for (const ch of ['a','b','c']) { fx.doorAnim[ch] = game.power[ch] ? 1 : 0; fx.plateGlow[ch] = 0; }
    bindGame();
    const def = game.def;
    $('level-num').textContent = String(levelIndex + 1);
    $('level-name').textContent = def.name;
    const par = def.par || {};
    parEl.textContent = [par.echoes != null ? `${par.echoes} echo${par.echoes === 1 ? '' : 'es'}` : null, par.time != null ? `${par.time}s` : null].filter(Boolean).join(' · ') || '-';
    renderPips();
    statusEl.textContent = def.hint || '';
    hideAll();
    setPaused(false);
    lastTime = 0; acc = 0;
    coach = { plateFrames: 0, msg: '', target: null };
    demo = null;
    $('demo-btn').disabled = !DEMOS[def.name];
    resize();
    // First visit to level 1: show how it's done before handing over control
    if (levelIndex === 0 && DEMOS[def.name] && !safeGet(DEMO_SEEN_KEY) && !opts.noAutoDemo) startDemo();
  }
  function restart(){ loadLevel(levelIndex, { noAutoDemo: true }); }

  function startDemo(){
    const d = DEMOS[LEVELS[levelIndex].name];
    if (!d) return;
    if (game.T > 0 || game.echoes.length) loadLevel(levelIndex, { noAutoDemo: true });
    hideAll(); paused = false;
    demo = { tape: d.tape, i: 0, captions: d.captions, caption: '', mask: 0, done: 0 };
    statusEl.textContent = 'Demo - press any key to skip';
    $('demo-btn').textContent = '■ Skip demo';
  }
  // End the demo and hand the (fresh) level to the player
  function stopDemo(){
    if (!demo) return;
    demo = null;
    safeSet(DEMO_SEEN_KEY, '1');
    loadLevel(levelIndex, { noAutoDemo: true });
    coach.turn = 150;
    $('demo-btn').textContent = '▶ Demo';
    statusEl.textContent = 'Your turn! ' + (game.def.hint || '');
  }
  function demoInput(){
    if (demo.done) { demo.done++; if (demo.done > 90) stopDemo(); return { left:false, right:false, jump:false, rewind:false }; }
    const m = demo.i < demo.tape.length ? parseInt(demo.tape[demo.i], 16) : 0;
    for (const c of demo.captions) if (c.f === demo.i) { demo.caption = c.text; statusEl.textContent = c.text; }
    demo.i++; demo.mask = m;
    if (demo.i >= demo.tape.length) demo.done = 1;
    return { left: !!(m & 1), right: !!(m & 2), jump: !!(m & 4), rewind: !!(m & 8) };
  }

  function bindGame(){
    game.on('echoes', renderPips);
    game.on('win', onWin);
    game.on('rewind', e => {
      flashAlpha = reducedMotion ? 0.12 : 0.25; flashColor = '#ffffff'; sfx.rewind();
      statusEl.textContent = `Echo replays your last ${(e.path.length/60).toFixed(1)}s`;
      const s = e.path[0]; burst(s.x, s.y - 10, 14, pal.echo, 2);
    });
    game.on('rewind-denied', why => { sfx.denied(); statusEl.textContent = why === 'echoes' ? 'No echoes left - press U to undo the last one' : 'Nothing to rewind yet'; });
    game.on('scrub-start', () => { statusEl.textContent = 'Rewinding... release to leave an echo'; });
    game.on('scrub-cancel', () => { statusEl.textContent = 'Too short - hold a little longer to rewind'; });
    game.on('undo', () => { sfx.undo(); statusEl.textContent = 'Echo removed'; });
    game.on('jump', () => { fx.squash = -1; sfx.jump(); dust(game.player.x, game.player.y, 5); });
    game.on('land', v => { if (v < 2.5) return; fx.squash = Math.min(1, v / 8); sfx.land(v); dust(game.player.x, game.player.y, Math.round(v)); });
    game.on('death', d => {
      sfx.death(); flashAlpha = reducedMotion ? 0.15 : 0.35; flashColor = '#ef4444';
      burst(d.at.x, d.at.y - 10, 20, pal.player, 2.5);
      if (!reducedMotion) fx.shake = 5;
      statusEl.textContent = d.cause === 'laser' ? 'Zapped! Time snapped back a second.' : 'Ouch! Time snapped back a second.';
    });
    game.on('door-open', () => sfx.door(true));
    game.on('door-close', () => { sfx.door(false); if (!reducedMotion) fx.shake = Math.max(fx.shake, 3); });
  }

  function renderPips(){
    const left = game.echoesLeft(), max = game.maxEchoes;
    pipsEl.innerHTML = Array.from({ length: max }, (_, i) => `<span class="bs-pip${i < left ? '' : ' used'}"></span>`).join('');
    pipsEl.setAttribute('aria-label', `${left} of ${max} echoes left`);
  }

  // ---------- Loop ----------
  function tick(now){
    if (!lastTime) lastTime = now;
    acc += Math.min(250, now - lastTime);
    lastTime = now;
    if (paused || anyModalOpen()) acc = 0;
    while (acc >= STEP_MS) {
      if (demo) {
        const inp = demoInput();
        if (!demo) break; // demo just finished and reloaded the level
        Object.assign(input, inp);
      } else mergeInput();
      const wasScrub = game.scrubbing;
      game.step(input);
      if (game.scrubbing && (!wasScrub || game.frame % 6 === 0)) sfx.tick(game.scrub / C.MAX_REWIND);
      updateFx();
      if (!demo && game.def.coach) updateCoach();
      acc -= STEP_MS;
    }
    const tt = (game.frame / 60).toFixed(1);
    if (tt !== lastTimeText) { timeEl.textContent = tt; lastTimeText = tt; }
    draw();
    raf = requestAnimationFrame(tick);
  }
  function mergeInput(){
    for (const k of ['left','right','jump','rewind']) input[k] = keys[k] || touch[k];
  }

  // ---------- Layout ----------
  function resize(){
    if (!game) return;
    const mapW = game.level.cols * TILE + MARGIN * 2, mapH = game.level.rows * TILE + MARGIN * 2;
    const availW = stage.clientWidth || mapW;
    const top = stage.getBoundingClientRect().top + window.scrollY;
    const touchH = getComputedStyle(touchEl).display !== 'none' ? touchEl.offsetHeight + 16 : 0;
    const availH = Math.max(160, window.innerHeight - top - touchH - 56);
    const scale = Math.max(0.4, Math.min(availW / mapW, availH / mapH, 3));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.width = Math.floor(mapW * scale) + 'px';
    canvas.style.height = Math.floor(mapH * scale) + 'px';
    canvas.width = Math.round(mapW * scale * dpr);
    canvas.height = Math.round(mapH * scale * dpr);
    view = { scale, dpr, mapW, mapH };
  }

  // ---------- Palette (follows the page theme) ----------
  function readPalette(){
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    pal = light ? {
      bg: css('--bg') || '#f3f4f6', field: '#ffffff', wall: '#475569', wallTop: '#64748b', grid: 'rgba(15,23,42,0.05)',
      text: '#111827', muted: '#6b7280', player: '#dc2626', echo: '#7c3aed', goal: '#2563eb', dust: '#94a3b8',
      ch: { a: '#059669', b: '#d97706', c: '#0284c7' }, eye: '#ffffff', pupil: '#111827', tip: 'rgba(255,255,255,0.92)',
      spike: '#64748b', laser: '#e11d48',
    } : {
      bg: css('--bg') || '#0f172a', field: '#111a2e', wall: '#cbd5e1', wallTop: '#f1f5f9', grid: 'rgba(255,255,255,0.03)',
      text: '#e5e7eb', muted: '#9ca3af', player: '#ef4444', echo: '#a78bfa', goal: '#60a5fa', dust: '#e5e7eb',
      ch: { a: '#34d399', b: '#fbbf24', c: '#38bdf8' }, eye: '#ffffff', pupil: '#111827', tip: 'rgba(15,23,42,0.88)',
      spike: '#94a3b8', laser: '#fb7185',
    };
  }

  // ---------- Effects ----------
  function updateFx(){
    for (const p of fx.particles) { p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life--; }
    if (fx.particles.length) fx.particles = fx.particles.filter(p => p.life > 0);
    fx.shake *= 0.82; if (fx.shake < 0.1) fx.shake = 0;
    fx.squash *= 0.8; if (Math.abs(fx.squash) < 0.02) fx.squash = 0;
    fx.bob += 0.08;
    const power = game.scrubbing ? game.powerAt(game.viewT) : game.power;
    for (const ch of ['a','b','c']) {
      fx.doorAnim[ch] += ((power[ch] ? 1 : 0) - fx.doorAnim[ch]) * 0.35;
      fx.plateGlow[ch] += ((power[ch] ? 1 : 0) - fx.plateGlow[ch]) * 0.25;
    }
    const p = game.player;
    if (!game.scrubbing && p.onGround && Math.abs(p.vx) > 1.6 && game.T % 7 === 0) dust(p.x - p.face*4, p.y, 1);
  }
  function dust(x, y, n){
    if (reducedMotion) n = Math.min(n, 2);
    for (let i = 0; i < n; i++) fx.particles.push({ x: x + (Math.random()-0.5)*10, y, vx: (Math.random()-0.5)*1.6, vy: -Math.random()*1.2, g: 0.05, life: 18 + Math.random()*10, max: 28, color: null, r: 1.5 + Math.random()*1.5 });
  }
  function burst(x, y, n, color, speed){
    if (reducedMotion) n = Math.round(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random()*Math.PI*2, v = speed * (0.4 + Math.random());
      fx.particles.push({ x, y, vx: Math.cos(a)*v, vy: Math.sin(a)*v, g: 0.02, life: 30 + Math.random()*20, max: 50, color, r: 1.5 + Math.random()*2 });
    }
  }

  // ---------- Rendering ----------
  function draw(){
    if (!pal) readPalette();
    const level = game.level;
    const t = game.viewT; // during a scrub the world previews the past
    const k = view.scale * view.dpr;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let sx = 0, sy = 0;
    if (fx.shake) { sx = (Math.random()-0.5)*fx.shake*2; sy = (Math.random()-0.5)*fx.shake*2; }
    ctx.setTransform(k, 0, 0, k, (MARGIN + sx) * k, (MARGIN + sy) * k);

    // Field + subtle grid
    ctx.fillStyle = pal.field; ctx.fillRect(0, 0, level.cols*TILE, level.rows*TILE);
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 1; x < level.cols; x++) { ctx.moveTo(x*TILE, 0); ctx.lineTo(x*TILE, level.rows*TILE); }
    for (let y = 1; y < level.rows; y++) { ctx.moveTo(0, y*TILE); ctx.lineTo(level.cols*TILE, y*TILE); }
    ctx.stroke();

    drawLinks(level);

    for (let y = 0; y < level.rows; y++) {
      for (let x = 0; x < level.cols; x++) {
        const c = level.grid[y][x];
        const rx = x*TILE, ry = y*TILE;
        if (c === '#') drawWall(level, x, y);
        else if (C.PLATE[c]) drawPlate(rx, ry, C.PLATE[c], C.TIMED[c]);
        else if (c === '^') drawSpikes(rx, ry);
        else if (c === '-') drawPlank(rx, ry);
        else if (C.LASER[c]) drawEmitter(rx, ry, C.LASER[c]);
        else if (C.DOOR[c]) drawDoor(rx, ry, C.DOOR[c]);
        else if (c === 'G') drawGoal(rx, ry);
      }
    }

    drawTips();
    drawBeams(t);

    // Echoes, positioned on the timeline
    for (const e of game.echoes) {
      const s = game.echoAt(e, t);
      if (!s) continue;
      const kk = t - e.start, left = 1 - kk / (e.path.length - 1);
      const fade = Math.min(1, kk / 8, (e.path.length - 1 - kk) / 8);
      ctx.globalAlpha = 0.7 * Math.max(0.25, fade);
      drawBody(s.x, s.y, pal.echo, s.face, 0);
      ctx.globalAlpha = 1;
      drawRing(s.x, s.y - 30, left, pal.echo);
    }

    if (game.scrubbing) {
      ctx.strokeStyle = pal.echo; ctx.globalAlpha = 0.6; ctx.setLineDash([3,4]); ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = t; i <= game.T; i++) { const p = game.history[i]; ctx[i === t ? 'moveTo' : 'lineTo'](p.x, p.y - 10); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      const p = game.history[t];
      drawBody(p.x, p.y, pal.player, p.face, 0);
    } else {
      const p = game.player;
      let sq = fx.squash;
      if (!p.onGround && !sq) sq = Math.max(-0.5, Math.min(0.3, -p.vy / 14));
      drawBody(p.x, p.y, pal.player, p.face, sq, Math.abs(p.vx) > 0.3 && p.onGround);
    }

    for (const pt of fx.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max) * (pt.color ? 0.9 : 0.45);
      ctx.fillStyle = pt.color || pal.dust;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (game.scrubbing) {
      ctx.globalAlpha = 0.07; ctx.fillStyle = pal.echo; ctx.fillRect(-MARGIN, -MARGIN, view.mapW, view.mapH); ctx.globalAlpha = 1;
      const frac = game.scrub / C.MAX_REWIND, wpx = level.cols * TILE;
      ctx.fillStyle = pal.echo; ctx.fillRect(0, -7, wpx * frac, 4);
      ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = pal.text;
      ctx.fillText(`-${(game.scrub/60).toFixed(1)}s`, wpx - 4, 14);
      ctx.textAlign = 'left';
    }

    if (demo) drawDemoOverlay();
    else if (game.def.coach && !game.win) drawCoach();

    if (flashAlpha > 0.001) {
      ctx.globalAlpha = flashAlpha; ctx.fillStyle = flashColor; ctx.fillRect(-MARGIN, -MARGIN, view.mapW, view.mapH); ctx.globalAlpha = 1;
      flashAlpha *= 0.9;
    }
  }

  // ---------- Demo overlay & coaching ----------
  function drawDemoOverlay(){
    const W = game.level.cols * TILE;
    // badge
    ctx.font = '700 10px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillStyle = pal.echo; roundRect(4, 4, 112, 16, 5);
    ctx.fillStyle = '#ffffff'; ctx.fillText('DEMO · any key skips', 10, 12.5);
    // caption
    if (demo.caption) {
      ctx.font = '600 12px system-ui, sans-serif';
      const w = Math.min(W - 16, ctx.measureText(demo.caption).width + 24);
      const x = (W - w) / 2, y = 26;
      ctx.fillStyle = pal.tip; ctx.globalAlpha = 0.95; roundRect(x, y, w, 24, 8); ctx.globalAlpha = 1;
      ctx.fillStyle = pal.text; ctx.textAlign = 'center'; ctx.fillText(demo.caption, W / 2, y + 12.5, W - 28); ctx.textAlign = 'left';
    }
    // keys being pressed
    const m = demo.mask, keysShown = [['←', m & 1], ['→', m & 2], ['Space', m & 4], ['⌫ Backspace', m & 8]];
    ctx.font = '600 10px system-ui, sans-serif';
    let x = W - 4;
    for (let i = keysShown.length - 1; i >= 0; i--) {
      const [label, on] = keysShown[i];
      const w = ctx.measureText(label).width + 12; x -= w;
      ctx.globalAlpha = on ? 1 : 0.35;
      ctx.fillStyle = on ? (label.startsWith('⌫') ? pal.echo : pal.goal) : pal.tip; roundRect(x, 4, w, 16, 4);
      ctx.fillStyle = on ? '#ffffff' : pal.text; ctx.fillText(label, x + 6, 12.5);
      x -= 4;
    }
    ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
  }

  // Step-by-step prompts for the tutorial level, reacting to what the player does
  function updateCoach(){
    if (game.win) return;
    const p = game.player, level = game.level;
    const tile = (level.grid[Math.floor(p.y / TILE)] || [])[Math.floor(p.x / TILE)];
    const onPlate = !!C.PLATE[tile];
    coach.plateFrames = onPlate && !game.scrubbing ? coach.plateFrames + 1 : (game.scrubbing ? coach.plateFrames : 0);
    const find = test => { for (let y = 0; y < level.rows; y++) for (let x = 0; x < level.cols; x++) if (test(level.grid[y][x])) return [x, y]; return null; };
    let msg, target = null;
    if (game.scrubbing) {
      msg = game.scrub < 90 ? 'Keep holding Backspace... time is running backwards' : 'Now let go of Backspace!';
    } else if (!game.echoes.length) {
      if (!onPlate) { msg = 'Walk onto the green plate'; target = find(c => !!C.PLATE[c]); }
      else if (coach.plateFrames < 50) msg = 'The door opens while you stand here... but closes when you leave';
      else if (coach.plateFrames < 100) msg = 'Stay on the plate a little longer';
      else msg = 'Now HOLD Backspace (or X) to rewind time';
    } else if (game.activeEchoes() && game.power.a) {
      msg = 'Your echo is holding the plate - run through the door!'; target = find(c => c === 'G');
    } else if (game.activeEchoes()) {
      // Will the echo actually reach a plate during the rest of its replay?
      const e = game.echoes[game.echoes.length - 1], k = game.T - e.start;
      const willPress = e.path.slice(Math.max(0, k)).some(s => C.PLATE[(level.grid[Math.floor(s.y / TILE)] || [])[Math.floor(s.x / TILE)]]);
      msg = willPress ? 'Your echo is replaying your moves - watch it step onto the plate'
        : 'Your echo never reaches the plate. Press U to undo it - stand ON the plate before rewinding';
    } else {
      msg = 'Your echo has finished. Press U to undo it, stand on the plate longer, then rewind again';
    }
    coach.target = target;
    if (coach.turn > 0) { coach.turn--; if (!game.echoes.length && !onPlate) msg = 'Your turn! ' + msg; }
    if (msg !== coach.msg) { coach.msg = msg; statusEl.textContent = msg; }
  }
  function drawCoach(){
    if (!coach.msg) return;
    const W = game.level.cols * TILE;
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const w = Math.min(W - 16, ctx.measureText(coach.msg).width + 24), x = (W - w) / 2, y = 26;
    ctx.fillStyle = pal.tip; ctx.globalAlpha = 0.95; roundRect(x, y, w, 24, 8); ctx.globalAlpha = 1;
    ctx.fillStyle = pal.text; ctx.textAlign = 'center'; ctx.fillText(coach.msg, W / 2, y + 12.5, W - 28); ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (coach.target) {
      // bouncing arrow over the next thing to go to
      const [tx, ty] = coach.target, b = reducedMotion ? 0 : Math.abs(Math.sin(fx.bob * 1.5)) * 5;
      const cx = tx * TILE + TILE / 2, cy = ty * TILE - 6 - b;
      ctx.fillStyle = pal.goal;
      ctx.beginPath(); ctx.moveTo(cx - 7, cy - 9); ctx.lineTo(cx + 7, cy - 9); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
    }
  }

  function drawWall(level, x, y){
    const rx = x*TILE, ry = y*TILE;
    ctx.fillStyle = pal.wall; ctx.fillRect(rx - 0.25, ry - 0.25, TILE + 0.5, TILE + 0.5); // overlap hides seams at fractional scales
    const above = level.grid[y-1] && level.grid[y-1][x];
    if (above && above !== '#') { ctx.fillStyle = pal.wallTop; ctx.fillRect(rx, ry, TILE, 3); }
  }

  // Faint lines connecting each plate to the doors it powers
  function drawLinks(level){
    if (!level._links) {
      const plates = [], doors = [];
      level.grid.forEach((row, y) => row.forEach((c, x) => {
        if (C.PLATE[c]) plates.push({ x, y, ch: C.PLATE[c] });
        if (C.DOOR[c]) doors.push({ x, y, ch: C.DOOR[c] });
      }));
      level._links = [];
      for (const p of plates) for (const d of doors) if (d.ch === p.ch) level._links.push({ p, d });
    }
    ctx.lineWidth = 1.5; ctx.setLineDash([2, 5]);
    for (const { p, d } of level._links) {
      ctx.strokeStyle = pal.ch[p.ch];
      ctx.globalAlpha = 0.18 + fx.plateGlow[p.ch] * 0.4;
      const x0 = p.x*TILE + TILE/2, y0 = p.y*TILE + TILE - 4, x1 = d.x*TILE + TILE/2, y1 = d.y*TILE + TILE/2;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 30, x1, y1);
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  function drawShape(shape, x, y, r, fill){
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(x, y, r, 0, Math.PI*2);
    else if (shape === 'triangle') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r*0.8); ctx.lineTo(x - r, y + r*0.8); ctx.closePath(); }
    else ctx.rect(x - r*0.85, y - r*0.85, r*1.7, r*1.7);
    if (fill) ctx.fill(); else ctx.stroke();
  }

  function drawPlate(x, y, ch, timed){
    const glow = fx.plateGlow[ch], col = pal.ch[ch];
    if (timed) {
      // clock face with the remaining linger time
      const left = game.scrubbing ? 0 : game.timerLeft(ch);
      const cx = x + TILE/2, cy = y + TILE - 13;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI*2); ctx.stroke();
      if (left > 0) { ctx.fillStyle = col; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 6, -Math.PI/2, -Math.PI/2 + Math.PI*2*left); ctx.closePath(); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.strokeStyle = pal.text; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 4); ctx.moveTo(cx, cy); ctx.lineTo(cx + 3, cy); ctx.stroke();
      ctx.fillStyle = col; ctx.globalAlpha = 0.45 + glow * 0.55;
      roundRect(x+3, y+TILE-5+glow*2, TILE-6, 5-glow*2, 2);
      ctx.globalAlpha = 1;
      return;
    }
    const press = glow * 2;
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.45 + glow * 0.55;
    roundRect(x+3, y+TILE-5+press, TILE-6, 5-press, 2);
    if (glow > 0.05) {
      ctx.globalAlpha = glow * 0.18;
      ctx.beginPath(); ctx.arc(x+TILE/2, y+TILE-3, 13, Math.PI, 0); ctx.fill();
    }
    ctx.globalAlpha = 0.55 + glow * 0.45; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    drawShape(CH_SHAPE[ch], x+TILE/2, y+TILE-12, 3.5, glow > 0.5);
    ctx.globalAlpha = 1;
  }
  function drawDoor(x, y, ch){
    const open = fx.doorAnim[ch], col = pal.ch[ch];
    const bw = 10, bx = x + (TILE - bw) / 2;
    // Outline marks where the door is even when it's open
    ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.strokeRect(bx + 0.5, y + 0.5, bw - 1, TILE - 1); ctx.setLineDash([]);
    const hgt = TILE * (1 - open);
    if (hgt > 0.5) {
      ctx.globalAlpha = 1; ctx.fillStyle = col;
      ctx.fillRect(bx, y, bw, hgt);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let yy = y + 4; yy < y + hgt - 2; yy += 6) ctx.fillRect(bx + 2, yy, bw - 4, 2);
      if (hgt > 12) { ctx.fillStyle = pal.field; drawShape(CH_SHAPE[ch], x + TILE/2, y + hgt/2, 3, true); }
    }
    ctx.globalAlpha = 1;
  }
  function drawGoal(x, y){
    const pulse = reducedMotion ? 0 : Math.sin(fx.bob) * 1.5;
    ctx.fillStyle = pal.goal; ctx.globalAlpha = 0.22;
    roundRect(x+2-pulse, y+2-pulse, TILE-4+pulse*2, TILE-4+pulse*2, 7);
    ctx.globalAlpha = 1; roundRect(x+7, y+7, TILE-14, TILE-14, 3);
  }

  function drawSpikes(x, y){
    ctx.fillStyle = pal.spike;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const sx = x + i*6; ctx.moveTo(sx, y + TILE); ctx.lineTo(sx + 3, y + TILE/2 + 1); ctx.lineTo(sx + 6, y + TILE); }
    ctx.closePath(); ctx.fill();
  }
  function drawPlank(x, y){
    ctx.fillStyle = pal.wall; ctx.fillRect(x, y, TILE, 4);
    ctx.fillStyle = pal.wallTop; ctx.fillRect(x, y, TILE, 1.5);
    ctx.globalAlpha = 0.35; ctx.fillStyle = pal.wall;
    ctx.fillRect(x + 3, y + 4, 2, 4); ctx.fillRect(x + TILE - 5, y + 4, 2, 4);
    ctx.globalAlpha = 1;
  }
  function drawEmitter(x, y, dir){
    ctx.fillStyle = pal.wall; ctx.fillRect(x - 0.25, y - 0.25, TILE + 0.5, TILE + 0.5);
    ctx.fillStyle = pal.laser;
    const mx = dir > 0 ? x + TILE - 6 : x;
    roundRect(mx, y + TILE/2 - 5, 6, 10, 2);
  }
  function drawBeams(t){
    if (!game.level.lasers.length) return;
    const power = game.scrubbing ? game.powerAt(t) : game.power;
    const player = game.scrubbing ? game.history[t] : game.player;
    const beams = game.beamsAt(t, power, player);
    const flicker = reducedMotion ? 1 : 0.85 + Math.random() * 0.15;
    for (const b of beams) {
      const x0 = Math.min(b.x0, b.x1), w = Math.abs(b.x1 - b.x0);
      ctx.globalAlpha = 0.18 * flicker; ctx.fillStyle = pal.laser; ctx.fillRect(x0, b.y - 4, w, 8);
      ctx.globalAlpha = 0.95 * flicker; ctx.fillRect(x0, b.y - 1.5, w, 3);
      if (b.hit) { ctx.globalAlpha = 0.6 * flicker; ctx.beginPath(); ctx.arc(b.x1, b.y, 4, 0, Math.PI*2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    // show idle emitters' aim faintly when the laser is off
    if (!beams.length) {
      ctx.strokeStyle = pal.laser; ctx.globalAlpha = 0.15; ctx.setLineDash([2, 6]); ctx.lineWidth = 1;
      for (const L of game.level.lasers) {
        const y = L.y*TILE + TILE/2, x0 = L.dir > 0 ? (L.x+1)*TILE : L.x*TILE;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + L.dir * TILE * 4, y); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }

  // In-world tutorial labels (level.tips: [{at:[col,row], text}])
  function drawTips(){
    const tips = game.def.tips;
    if (!tips) return;
    ctx.font = '600 10px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    for (const tip of tips) {
      const [cx, cy] = tip.at;
      const w = ctx.measureText(tip.text).width + 12;
      let x = cx*TILE + TILE/2 - w/2; const y = cy*TILE + 3;
      x = Math.max(2, Math.min(game.level.cols*TILE - w - 2, x));
      ctx.fillStyle = pal.tip; ctx.globalAlpha = 0.9;
      roundRect(x, y, w, 18, 5);
      ctx.globalAlpha = 1; ctx.fillStyle = pal.text; ctx.fillText(tip.text, x + 6, y + 9.5);
    }
    ctx.textBaseline = 'alphabetic';
  }

  function drawBody(x, y, color, face, squash, running){
    const sx = 1 + squash * 0.35, sy = 1 - squash * 0.35;
    const bw = 16 * sx, bh = 22 * sy;
    const bob = running && !reducedMotion ? Math.sin(fx.bob * 4) * 0.8 : 0;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = color;
    roundRect(-bw/2, -bh, bw, bh, 4);
    const ex = (face || 1) * 2.5, ey = -bh + 7, look = face > 0 ? 1 : 0;
    ctx.fillStyle = pal.eye;
    ctx.fillRect(ex - 4, ey, 3, 4); ctx.fillRect(ex + 1, ey, 3, 4);
    ctx.fillStyle = pal.pupil;
    ctx.fillRect(ex - 4 + look, ey + 1, 2, 2); ctx.fillRect(ex + 1 + look, ey + 1, 2, 2);
    ctx.restore();
  }
  function drawRing(x, y, frac, color){
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4, -Math.PI/2, -Math.PI/2 + Math.PI*2*Math.max(0, frac)); ctx.stroke();
  }
  function roundRect(x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath(); ctx.fill();
  }

  // ---------- Input ----------
  function setupInput(){
    const k = {};
    const map = () => {
      keys.left = !!(k.ArrowLeft || k.KeyA);
      keys.right = !!(k.ArrowRight || k.KeyD);
      keys.jump = !!(k.Space || k.KeyZ || k.KeyW || k.ArrowUp);
      keys.rewind = !!(k.Backspace || k.KeyX);
    };
    window.addEventListener('keydown', e => {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (demo) { // any key skips the demo
        if (/^(Shift|Control|Alt|Meta)/.test(e.code) || e.repeat) return;
        e.preventDefault(); stopDemo(); return;
      }
      const modal = openModal();
      if (e.code === 'Escape') { e.preventDefault(); if (modal === pauseModal || !modal) togglePause(); else if (modal === levelsModal) closeLevels(); return; }
      if (modal === winModal) {
        if (e.code === 'Enter') { e.preventDefault(); nextLevel(); }
        else if (e.code === 'KeyR') { e.preventDefault(); restart(); }
        return;
      }
      if (modal === levelsModal) return;
      if (e.code === 'KeyP') { e.preventDefault(); togglePause(); return; }
      if (modal) return;
      k[e.code] = true; map();
      if (['Backspace','Space','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
      if (e.repeat) return; // one press = one action
      if (e.code === 'KeyU' || e.code === 'Delete') { e.preventDefault(); game.undoEcho(); }
      if (e.code === 'KeyR') { e.preventDefault(); restart(); }
      if (e.code === 'KeyM') toggleSound();
    });
    window.addEventListener('keyup', e => { k[e.code] = false; map(); });
    window.addEventListener('blur', () => { for (const key in k) k[key] = false; map(); });
  }

  function setupTouch(){
    touchEl.querySelectorAll('button[data-key]').forEach(btn => {
      const key = btn.dataset.key;
      const on = e => {
        e.preventDefault();
        if (demo) { stopDemo(); return; }
        if (key === 'undo') { game.undoEcho(); return; }
        touch[key] = true; btn.classList.add('on');
        try { btn.setPointerCapture(e.pointerId); } catch {}
        unlockAudio();
      };
      const off = () => { if (key in touch) touch[key] = false; btn.classList.remove('on'); };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('lostpointercapture', off);
      btn.addEventListener('contextmenu', e => e.preventDefault());
    });
  }

  // ---------- Menus ----------
  function setupMenus(){
    $('restart-btn').addEventListener('click', e => { restart(); e.currentTarget.blur(); });
    $('levels-btn').addEventListener('click', openLevels);
    pauseBtn.addEventListener('click', e => { togglePause(); e.currentTarget.blur(); });
    $('modal-restart').addEventListener('click', restart);
    $('modal-next').addEventListener('click', nextLevel);
    $('modal-levels').addEventListener('click', openLevels);
    $('levels-close').addEventListener('click', closeLevels);
    $('pause-resume').addEventListener('click', () => setPaused(false));
    $('pause-restart').addEventListener('click', restart);
    $('pause-levels').addEventListener('click', openLevels);
    $('demo-btn').addEventListener('click', e => { if (demo) stopDemo(); else startDemo(); e.currentTarget.blur(); });
    $('pause-demo').addEventListener('click', () => { setPaused(false); startDemo(); });
    canvas.addEventListener('pointerdown', () => { if (demo) stopDemo(); });
    for (const m of [winModal, levelsModal, pauseModal]) {
      m.addEventListener('click', e => { if (e.target === m && m !== winModal) { if (m === levelsModal) closeLevels(); else setPaused(false); } });
    }
  }
  function openModal(){ return [levelsModal, winModal, pauseModal].find(m => !m.classList.contains('hidden')) || null; }
  function anyModalOpen(){ return !!openModal(); }
  function hideAll(){ for (const m of [winModal, levelsModal, pauseModal]) m.classList.add('hidden'); }
  function setPaused(v){
    paused = v && !game.win;
    pauseModal.classList.toggle('hidden', !paused);
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.textContent = paused ? 'Resume (P)' : 'Pause (P)';
    for (const key in touch) touch[key] = false;
    if (paused) $('pause-resume').focus();
  }
  function togglePause(){ if (!game.win) setPaused(!paused); }

  function openLevels(){
    const grid = $('level-grid');
    grid.innerHTML = LEVELS.map((d, i) => {
      const r = recordOf(i), ok = unlocked(i);
      const stars = r ? r.stars : 0;
      const s = [0,1,2].map(n => n < stars ? '★' : '<span class="off">★</span>').join('');
      const sub = r ? `${(r.time/60).toFixed(1)}s · ${r.echoes} echo${r.echoes === 1 ? '' : 'es'}` : (ok ? 'Not solved yet' : 'Locked');
      return `<button type="button" class="bs-level-card${i === levelIndex ? ' current' : ''}" data-i="${i}" ${ok ? '' : 'disabled'}>
        <span class="n">Level ${i + 1}</span><span class="t">${escapeHtml(d.name)}</span><span class="s" aria-label="${stars} stars">${s}</span><span class="n">${sub}</span></button>`;
    }).join('');
    grid.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => loadLevel(Number(b.dataset.i))));
    $('total-stars').textContent = `${totalStars()} / ${LEVELS.length * 3}`;
    pauseModal.classList.add('hidden'); winModal.classList.add('hidden');
    levelsModal.classList.remove('hidden');
    const cur = grid.querySelector('.current') || grid.querySelector('button:not([disabled])');
    cur && cur.focus();
  }
  function closeLevels(){
    levelsModal.classList.add('hidden');
    if (game.win) showWinModal(); else if (paused) setPaused(true);
  }
  function nextLevel(){
    if (levelIndex < LEVELS.length - 1) loadLevel(levelIndex + 1); else openLevels();
  }

  let lastResult = null;
  function onWin(){
    sfx.win();
    burst(game.player.x, game.player.y - 10, 28, pal.goal, 3);
    if (demo) { demo.caption = 'Solved! Now you try.'; statusEl.textContent = demo.caption; return; } // demos never count
    const def = game.def, frames = game.frame, echoes = game.ghostsUsed;
    const stars = starsFor(def, frames, echoes);
    const prev = progress[def.name];
    const best = {
      stars: Math.max(stars, prev ? prev.stars : 0),
      time: prev ? Math.min(prev.time, frames) : frames,
      echoes: prev ? Math.min(prev.echoes, echoes) : echoes,
    };
    progress[def.name] = best; saveProgress();
    lastResult = { stars, frames, echoes, prev, newBest: !prev || frames < prev.time || stars > prev.stars };
    setTimeout(showWinModal, reducedMotion ? 150 : 500);
  }
  function showWinModal(){
    if (!lastResult || !game.win) return;
    const { stars, frames, echoes, prev, newBest } = lastResult;
    const def = game.def, par = def.par || {};
    const last = levelIndex >= LEVELS.length - 1;
    $('modal-title').textContent = last ? 'All levels complete!' : `${def.name} complete!`;
    $('modal-stars').innerHTML = [0,1,2].map(i => `<span class="bs-star${i < stars ? ' on pop' : ''}" style="animation-delay:${i * 140}ms">★</span>`).join('');
    $('modal-stars').setAttribute('aria-label', `${stars} of 3 stars`);
    $('res-time').textContent = `${(frames/60).toFixed(1)}s`;
    $('res-echoes').textContent = String(echoes);
    const tp = $('res-time-par'), ep = $('res-echoes-par');
    tp.textContent = par.time != null ? `par ${par.time}s` : ''; tp.classList.toggle('ok', par.time != null && frames/60 <= par.time);
    ep.textContent = par.echoes != null ? `par ${par.echoes}` : ''; ep.classList.toggle('ok', par.echoes != null && echoes <= par.echoes);
    const tips = [];
    if (newBest && prev) tips.push('New personal best!');
    if (stars < 3) {
      if (par.echoes != null && echoes > par.echoes) tips.push(`Try it with ${par.echoes} echo${par.echoes === 1 ? '' : 'es'}.`);
      else if (par.time != null && frames/60 > par.time) tips.push(`Beat ${par.time}s for the third star.`);
    }
    if (last) tips.push(`Total: ${totalStars()} / ${LEVELS.length * 3} stars.`);
    $('modal-message').textContent = tips.join(' ');
    $('modal-next').textContent = last ? 'Level select' : 'Next level (Enter)';
    winModal.classList.remove('hidden');
    $('modal-next').focus();
  }

  // ---------- Theme ----------
  function setupTheme(){
    const key = 'memory.theme';
    const saved = safeGet(key);
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(saved || (prefersLight ? 'light' : 'dark'));
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      safeSet(key, next);
      themeBtn.blur();
    });
  }
  function applyTheme(theme){
    const light = theme === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    themeBtn.setAttribute('aria-pressed', String(light));
    themeBtn.textContent = light ? 'Dark' : 'Light';
    readPalette();
  }

  // ---------- Audio (tiny WebAudio synth) ----------
  const audio = { ctx:null, master:null, muted: safeGet('backspace.muted') === '1' };
  function setupAudio(){
    updateSoundBtn();
    soundBtn.addEventListener('click', () => { toggleSound(); soundBtn.blur(); });
    window.addEventListener('pointerdown', unlockAudio, { once:true });
    window.addEventListener('keydown', unlockAudio, { once:true });
  }
  function unlockAudio(){
    try {
      if (!audio.ctx) audio.ctx = new (window.AudioContext||window.webkitAudioContext)();
      if (audio.ctx.state === 'suspended') audio.ctx.resume();
      if (!audio.master){ audio.master = audio.ctx.createGain(); audio.master.connect(audio.ctx.destination); }
      audio.master.gain.value = audio.muted ? 0 : 0.18;
    } catch {}
  }
  function toggleSound(){
    audio.muted = !audio.muted;
    safeSet('backspace.muted', audio.muted ? '1' : '0');
    if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.18;
    updateSoundBtn();
  }
  function updateSoundBtn(){
    soundBtn.textContent = audio.muted ? 'Sound: Off' : 'Sound: On';
    soundBtn.setAttribute('aria-pressed', String(!audio.muted));
  }
  function tone(type, f0, f1, dur, vol, delay = 0){
    if (!audio.ctx || !audio.master || audio.muted) return;
    const a = audio.ctx, t = a.currentTime + 0.002 + delay;
    const o = a.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(freq, dur, vol){
    if (!audio.ctx || !audio.master || audio.muted) return;
    const a = audio.ctx, t = a.currentTime + 0.002;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random()*2-1;
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 2;
    const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(audio.master); src.start(t);
  }
  const sfx = {
    jump: () => tone('square', 320, 640, 0.09, 0.06),
    land: v => noise(220, 0.06 + v * 0.01, Math.min(0.25, 0.05 + v * 0.02)),
    door: open => open ? tone('triangle', 260, 520, 0.12, 0.12) : (tone('triangle', 300, 110, 0.14, 0.14), noise(140, 0.1, 0.15)),
    rewind: () => { tone('sine', 900, 240, 0.22, 0.22); noise(700, 0.18, 0.1); },
    tick: frac => tone('sine', 700 - frac * 400, 680 - frac * 400, 0.04, 0.05),
    denied: () => tone('square', 160, 120, 0.12, 0.08),
    undo: () => tone('sine', 400, 700, 0.1, 0.1),
    death: () => { tone('sawtooth', 400, 80, 0.25, 0.12); noise(500, 0.2, 0.12); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.18, 0.12, i * 0.08)),
  };

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function safeGet(k){ try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v){ try { localStorage.setItem(k, v); } catch {} }

  init();
  // Debug/test hook (used by headless smoke tests)
  window.__backspaceDebug = { get game(){ return game; }, loadLevel };
})();
