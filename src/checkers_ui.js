// Checkers UI: renders board, handles selection and moves, shows turn
(function(){
  const boardEl = document.getElementById('board');
  const turnEl = document.getElementById('turn');
  const statusEl = document.getElementById('status');
  const restartBtn = document.getElementById('restart-btn');
  const themeBtn = document.getElementById('theme-btn');
  const soundBtn = document.getElementById('sound-btn');
  const volRange = document.getElementById('volume-range');
  const volLabel = document.getElementById('vol-label');
  const modalEl = document.getElementById('modal');
  const modalTitleEl = document.getElementById('modal-title');
  const modalMsgEl = document.getElementById('modal-message');
  const modalRestartBtn = document.getElementById('modal-restart');
  const modalCloseBtn = document.getElementById('modal-close');
  const opponentSelect = document.getElementById('opponent-select');
  const aiLevelEl = document.getElementById('ai-level');
  const aiLevelBadge = document.getElementById('ai-level-badge');

  let game = null;
  let selected = null; // {r,c}
  let valid = []; // valid moves from selection
  let gameOver = false;
  let prevPositions = new Map();
  let audio = { ctx: null, enabled: false, master: null, volume: 1 };
  let opponent = 'human'; // 'human' | 'computer'
  let aiLevel = 1; // 1..5

  init();

  function init() {
    setupTheme();
    restartBtn.addEventListener('click', () => newGame());
    setupAudio();
    setupModal();
    setupOpponent();
    newGame();
  }

  function newGame() {
    game = new CheckersGame();
    selected = null;
    valid = [];
    gameOver = false;
    prevPositions.clear();
    render();
    game.on('update', render);
    game.on('turn', (cur) => updateTurn(cur));
    game.on('move', ({ capture }) => { capture ? playCapture() : playMove(); });
    game.on('capture', () => { playRemove(); });
    game.on('win', ({ winner }) => { onWin(winner); showWin(winner); });
  }

  function render() {
    const { size, board } = game.getState();
    const prev = snapshotPositions();
    boardEl.style.setProperty('--cols', size);
    boardEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const sq = document.createElement('div');
        sq.className = `square ${((r + c) % 2 === 1) ? 'dark' : 'light'}`;
        sq.dataset.r = r; sq.dataset.c = c;
        sq.addEventListener('click', onSquareClick);

        if (selected && selected.r === r && selected.c === c) {
          sq.classList.add('selected');
        }
        const mv = valid.find(m => m.to[0] === r && m.to[1] === c);
        if (mv) sq.classList.add('move-target');

        const piece = board[r][c];
        if (piece) {
          const p = document.createElement('div');
          p.className = `piece ${piece.p === 1 ? 'red' : 'black'}${piece.k ? ' king' : ''}`;
          p.dataset.id = String(piece.id);
          p.setAttribute('aria-label', piece.p === 1 ? 'Red piece' : 'Black piece');
          sq.appendChild(p);
        }
        frag.appendChild(sq);
      }
    }
    boardEl.appendChild(frag);
    updateTurn(game.current);
    playFLIP(prev);
  }

  function onSquareClick(e) {
    if (gameOver) return;
    if (opponent === 'computer' && game.current === 2) return; // Human is Red; block input on AI turn
    const r = parseInt(e.currentTarget.dataset.r, 10);
    const c = parseInt(e.currentTarget.dataset.c, 10);
    const cell = game.pieceAt(r, c);

    // If clicking own piece, select it and show moves
    if (cell && cell.p === game.current) {
      selected = { r, c };
      valid = game.validMoves(r, c);
      if (valid.length) {
        statusEl.textContent = 'Choose a highlighted square.';
      } else {
        statusEl.textContent = game.hasAnyCapture() ? 'You must capture with another piece.' : 'No moves for this piece.';
      }
      render();
      return;
    }

    // If clicking an empty target that is valid, move
    if (selected) {
      const move = valid.find(m => m.to[0] === r && m.to[1] === c);
      if (move) {
        const ok = game.move([selected.r, selected.c], [r, c]);
        if (!ok.ok) {
          statusEl.textContent = 'Invalid move.';
        } else {
          statusEl.textContent = '';
        }
      }
      selected = null;
      valid = [];
      render();
      return;
    }

    // Otherwise, ignore clicks on opponent pieces or invalid squares
    statusEl.textContent = '';
  }

  function updateTurn(cur) {
    turnEl.textContent = cur === 1 ? 'Red' : 'Black';
    if (opponent === 'computer' && cur === 2 && !gameOver) {
      setTimeout(() => aiMove(), 420 + Math.floor(Math.random()*180));
    }
  }

  // Theme handling (copied from memory UI for file:// compatibility)
  function setupTheme() {
    const key = 'memory.theme';
    const saved = localStorage.getItem(key);
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = saved || (prefersLight ? 'light' : 'dark');
    applyTheme(theme);
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      localStorage.setItem(key, next);
    });
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      themeBtn.setAttribute('aria-pressed', 'true');
      themeBtn.textContent = 'Dark Theme';
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeBtn.setAttribute('aria-pressed', 'false');
      themeBtn.textContent = 'Light Theme';
    }
  }

  // FLIP animation helpers
  function snapshotPositions() {
    const map = new Map();
    boardEl.querySelectorAll('.piece').forEach(el => {
      const id = el.dataset.id;
      if (!id) return;
      map.set(id, el.getBoundingClientRect());
    });
    prevPositions = map;
    return map;
  }

  function playFLIP(prev) {
    boardEl.querySelectorAll('.piece').forEach(el => {
      const id = el.dataset.id;
      if (!id || !prev.has(id)) return;
      const first = prev.get(id);
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (dx === 0 && dy === 0) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.classList.add('moving');
      // force reflow
      void el.offsetWidth;
      el.style.transition = '';
      el.style.transform = '';
      setTimeout(() => { el.classList.remove('moving'); }, 250);
    });
  }

  // Opponent selection and AI
  function setupOpponent(){
    opponent = localStorage.getItem('checkers.opponent') || 'human';
    aiLevel = parseInt(localStorage.getItem('checkers.ai.level') || '1', 10);
    if (opponentSelect) opponentSelect.value = opponent;
    if (aiLevelEl) aiLevelEl.textContent = String(aiLevel);
    if (aiLevelBadge) aiLevelBadge.classList.toggle('hidden', opponent !== 'computer');
    opponentSelect?.addEventListener('change', () => {
      opponent = opponentSelect.value;
      localStorage.setItem('checkers.opponent', opponent);
      statusEl.textContent = opponent === 'computer' ? 'Playing vs Computer (Black).' : '';
      if (aiLevelBadge) aiLevelBadge.classList.toggle('hidden', opponent !== 'computer');
      if (opponent === 'computer' && game && game.current === 2 && !gameOver) setTimeout(() => aiMove(), 300);
    });
  }

  function onWin(winner){
    if (opponent !== 'computer') return;
    // Human is Red (1). Increase difficulty when human wins; decrease when AI wins.
    if (winner === 1) aiLevel = Math.min(5, aiLevel + 1);
    else aiLevel = Math.max(1, aiLevel - 1);
    if (aiLevelEl) aiLevelEl.textContent = String(aiLevel);
    localStorage.setItem('checkers.ai.level', String(aiLevel));
  }

  function aiMove(){
    if (!game || gameOver || game.current !== 2) return;
    const moves = listAllMoves(2);
    if (!moves.length) return;
    const chosen = pickAIMove(moves, aiLevel);
    game.move(chosen.from, chosen.to);
  }

  function listAllMoves(player){
    const res = [];
    const size = 8;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = game.pieceAt(r, c);
        if (!cell || cell.p !== player) continue;
        const mv = game.validMoves(r, c);
        for (const m of mv) res.push({ from: [r,c], to: m.to, capture: !!m.capture });
      }
    }
    return res;
  }

  function pickAIMove(moves, level){
    const mistakeP = {1:0.7, 2:0.45, 3:0.25, 4:0.12, 5:0.05}[level] ?? 0.25;
    const scored = moves.map(m => ({ m, s: scoreMove(m) })).sort((a,b)=>b.s-a.s);
    if (Math.random() < mistakeP) {
      const half = Math.max(1, Math.floor(scored.length/2));
      return scored[Math.floor(Math.random()*half)].m;
    }
    return scored[0].m;
  }

  function scoreMove(m){
    let s = 0;
    if (m.capture) s += 10;
    const toR = m.to[0], toC = m.to[1];
    s += toR * 0.2; // advance for Black
    s += (3.5 - Math.abs(3.5 - toC)) * 0.1; // center bonus
    if (wouldBeCapturable(2, m.to)) s -= 8; // avoid immediate recapture
    return s;
  }

  function wouldBeCapturable(playerMoved, to){
    const opp = playerMoved === 1 ? 2 : 1;
    const [r,c] = to;
    for (const dr of [-1,1]){
      for (const dc of [-1,1]){
        const ar = r + dr, ac = c + dc; // adjacent
        const lr = r - dr, lc = c - dc; // landing beyond
        const adj = inBounds(ar,ac) ? game.pieceAt(ar,ac) : null;
        if (adj && adj.p === opp && inBounds(lr,lc) && !game.pieceAt(lr,lc)) return true;
      }
    }
    return false;
  }

  function inBounds(r,c){ return r>=0 && r<8 && c>=0 && c<8; }

  // Audio: simple wood-like thock using Web Audio
  function setupAudio() {
    // Load prefs
    const en = localStorage.getItem('checkers.audio.enabled');
    const vol = localStorage.getItem('checkers.audio.volume');
    audio.enabled = en === null ? true : en === 'true';
    audio.volume = vol === null ? 1 : Math.max(0, Math.min(1, Number(vol)));
    updateSoundUI();

    const unlock = () => {
      try {
        if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (audio.ctx.state === 'suspended') audio.ctx.resume();
        if (!audio.master) {
          audio.master = audio.ctx.createGain();
          audio.master.gain.value = audio.volume;
          audio.master.connect(audio.ctx.destination);
        }
        audio.enabled = true;
        persistAudio();
      } catch {}
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    soundBtn.addEventListener('click', () => {
      audio.enabled = !audio.enabled;
      if (audio.enabled && audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
      updateSoundUI();
      persistAudio();
    });

    volRange.addEventListener('input', () => {
      const value = Math.max(0, Math.min(1, Number(volRange.value)));
      audio.volume = value;
      if (audio.master) audio.master.gain.value = value;
      persistAudio();
    });
  }

  function playMove() {
    if (!audio.enabled || !audio.ctx) return;
    woodThock(200 + Math.random() * 40, 0.09, 0.25);
  }
  function playCapture() {
    if (!audio.enabled || !audio.ctx) return;
    woodThock(160 + Math.random() * 30, 0.12, 0.35, 0.12);
  }

  function woodThock(freq = 200, dur = 0.1, gainMax = 0.25, noiseGain = 0.08) {
    const ctx = audio.ctx; if (!ctx) return;
    const t0 = ctx.currentTime + 0.002;
    // Body: short sine burst
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(gainMax, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(getOutput());
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);

    // Click: filtered noise for attack
    if (noiseGain > 0) {
      const bufferSize = 2048;
      const noise = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.7;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freq * 2, t0);
      bp.Q.value = 6;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(noiseGain, t0);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(0.04, dur));
      src.connect(bp);
      bp.connect(ng);
      ng.connect(getOutput());
      src.start(t0);
      src.stop(t0 + 0.08);
    }
  }

  // Distinct remove sound: a crisp click + short downward blip
  function playRemove() {
    if (!audio.enabled || !audio.ctx) return;
    const ctx = audio.ctx;
    const t0 = ctx.currentTime + 0.001;

    // Blip
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(820, t0);
    osc.frequency.exponentialRampToValueAtTime(260, t0 + 0.08);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.18, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    osc.connect(g);
    g.connect(getOutput());
    osc.start(t0);
    osc.stop(t0 + 0.12);

    // Clicky transient
    const bufferSize = 1024;
    const noise = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.9;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1200, t0);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
    src.connect(hp);
    hp.connect(ng);
    ng.connect(getOutput());
    src.start(t0);
    src.stop(t0 + 0.05);
  }

  function getOutput() {
    if (audio.master) return audio.master;
    if (!audio.ctx) return { connect: () => {} };
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = audio.volume;
    audio.master.connect(audio.ctx.destination);
    return audio.master;
  }

  function updateSoundUI() {
    soundBtn.setAttribute('aria-pressed', audio.enabled ? 'true' : 'false');
    soundBtn.textContent = audio.enabled ? 'Sound On' : 'Sound Off';
    volRange.value = String(audio.volume);
    volLabel.style.display = audio.enabled ? '' : 'none';
  }

  function persistAudio() {
    localStorage.setItem('checkers.audio.enabled', String(audio.enabled));
    localStorage.setItem('checkers.audio.volume', String(audio.volume));
  }

  // Modal helpers
  function setupModal() {
    modalRestartBtn.addEventListener('click', () => { hideModal(); newGame(); });
    modalCloseBtn.addEventListener('click', hideModal);
  }
  function showWin(winner) {
    gameOver = true;
    modalTitleEl.textContent = 'Victory!';
    modalMsgEl.textContent = `${winner === 1 ? 'Red' : 'Black'} wins — opponent has no pieces left.`;
    modalEl.classList.remove('hidden');
    modalRestartBtn.focus();
  }
  function hideModal() {
    modalEl.classList.add('hidden');
  }
})();
