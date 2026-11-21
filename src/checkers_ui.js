// Checkers UI: renders board, handles selection, multi-jumps and the computer opponent
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
  const aiControls = document.getElementById('ai-controls');
  const sideSelect = document.getElementById('side-select');
  const levelSelect = document.getElementById('ai-level-select');
  const adaptiveChk = document.getElementById('ai-adaptive');
  const undoBtn = document.getElementById('undo-btn');
  const turnDot = document.getElementById('turn-dot');
  const redLabel = document.getElementById('red-label');
  const blackLabel = document.getElementById('black-label');
  const redCount = document.getElementById('red-count');
  const blackCount = document.getElementById('black-count');
  const redKings = document.getElementById('red-kings');
  const blackKings = document.getElementById('black-kings');
  const moveNum = document.getElementById('move-num');
  const overBar = document.getElementById('over-bar');
  const overText = document.getElementById('over-text');
  const overRestart = document.getElementById('over-restart');

  const RED = 1, BLACK = 2;
  const sideName = (p) => (p === RED ? 'Red' : 'Black');

  let game = null;
  let selected = null; // {r,c}
  let valid = []; // next hops from selection
  let prevPositions = new Map();
  let audio = { ctx: null, enabled: false, master: null, volume: 1 };
  let opponent = 'human'; // 'human' | 'computer'
  let humanSide = RED;    // side the human plays vs the computer
  let aiLevel = 1;        // 1..5
  let adaptive = true;    // auto-tune level after each game vs the computer
  let aiTimer = null;
  let gameToken = 0;      // invalidates pending AI work when a new game starts
  let cursor = null;      // keyboard focus square {r,c}
  let pendingCrownId = null; // piece id to play the crowning pulse on next render
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduceMotion() { return !!(motionQuery && motionQuery.matches); }

  init();

  function init() {
    setupTheme();
    boardEl.setAttribute('role', 'grid');
    boardEl.addEventListener('click', onBoardClick);
    boardEl.addEventListener('keydown', onBoardKey);
    restartBtn.addEventListener('click', () => newGame());
    overRestart.addEventListener('click', () => newGame());
    undoBtn.addEventListener('click', undoMove);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && modalEl.classList.contains('hidden')) {
        e.preventDefault();
        undoMove();
      }
    });
    setupAudio();
    setupModal();
    setupOpponent();
    newGame();
  }

  function newGame() {
    cancelAI();
    gameToken++;
    hideModal();
    game = new CheckersGame();
    selected = null;
    valid = [];
    cursor = null;
    prevPositions.clear();
    statusEl.textContent = '';
    game.on('update', render);
    game.on('turn', onTurn);
    game.on('move', ({ capture, crowned, to }) => {
      capture ? playCapture() : playMove();
      if (crowned) {
        const p = game.pieceAt(to[0], to[1]);
        if (p) pendingCrownId = p.id;
        playCrown();
      }
    });
    game.on('capture', ({ piece }) => {
      playRemove();
      if (piece) ghostCapturedPiece(piece.id);
    });
    game.on('win', (res) => { onGameEnd(res); showEnd(res); });
    game.on('draw', (res) => { showEnd(res); });
    render();
    onTurn();
  }

  // Function declarations (not const arrows) so they are hoisted above init().
  function vsComputer() { return opponent === 'computer'; }
  function aiSide() { return humanSide === RED ? BLACK : RED; }
  function isAITurn() { return vsComputer() && !!game && !game.over && game.current === aiSide(); }
  function flipped() { return vsComputer() && humanSide === BLACK; }

  function render() {
    const state = game.getState();
    const { size, board, chain, lastMove, turnPath, turnCaptured } = state;
    const key = ([r, c]) => r * size + c;
    const humanTurn = !game.over && !isAITurn();
    // Mid multi-jump on a human turn: keep the jumping piece selected.
    if (chain && humanTurn) {
      selected = { r: chain[0], c: chain[1] };
      valid = game.validMoves(chain[0], chain[1]);
    }
    const lastSquares = new Set((lastMove ? lastMove.path : []).map(key));
    const pathSquares = new Set((turnPath || []).map(key));
    const capturedSquares = new Set([...(lastMove ? lastMove.captured : []), ...turnCaptured].map(key));
    const movable = new Set(humanTurn ? game.movablePieces().map(key) : []);
    const forced = humanTurn && game.mustCapture();
    const prev = snapshotPositions();
    const hadFocus = boardEl.contains(document.activeElement);
    if (!cursor) cursor = defaultCursor(movable, size);
    boardEl.style.setProperty('--cols', size);
    boardEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    const flip = flipped();
    for (let dr = 0; dr < size; dr++) {
      const row = document.createElement('div');
      row.className = 'board-row';
      row.setAttribute('role', 'row');
      for (let dc = 0; dc < size; dc++) {
        const r = flip ? size - 1 - dr : dr;
        const c = flip ? size - 1 - dc : dc;
        const sq = document.createElement('div');
        sq.className = `square ${((r + c) % 2 === 1) ? 'dark' : 'light'}`;
        sq.dataset.r = r; sq.dataset.c = c;
        sq.setAttribute('role', 'gridcell');
        const isCursor = cursor.r === r && cursor.c === c;
        sq.tabIndex = isCursor ? 0 : -1;

        const notes = [];
        if (selected && selected.r === r && selected.c === c) { sq.classList.add('selected'); notes.push('selected'); }
        if (valid.some(m => m.to[0] === r && m.to[1] === c)) { sq.classList.add('move-target'); notes.push('move here'); }
        const k = r * size + c;
        if (lastSquares.has(k)) sq.classList.add('last-move');
        if (pathSquares.has(k)) sq.classList.add('jump-path');
        if (capturedSquares.has(k) && !board[r][c]) sq.classList.add('captured-mark');
        if (movable.has(k)) {
          sq.classList.add('movable', ...(forced ? ['must-capture'] : []));
          notes.push(forced ? 'can capture' : 'can move');
        }

        const piece = board[r][c];
        if (piece) {
          const p = document.createElement('div');
          p.className = `piece ${piece.p === RED ? 'red' : 'black'}${piece.k ? ' king' : ''}`;
          if (piece.id === pendingCrownId && !reduceMotion()) p.classList.add('crowned');
          p.dataset.id = String(piece.id);
          p.setAttribute('aria-hidden', 'true');
          sq.appendChild(p);
        }
        const what = piece ? `${sideName(piece.p)} ${piece.k ? 'king' : 'man'}` : 'empty';
        sq.setAttribute('aria-label', [`${squareName(r, c)}, ${what}`, ...notes].join(', '));
        row.appendChild(sq);
      }
      frag.appendChild(row);
    }
    pendingCrownId = null;
    boardEl.appendChild(frag);
    if (hadFocus) focusCursor();
    updateHUD(state);
    if (!reduceMotion()) playFLIP(prev);
  }

  // ----- Keyboard / focus -----
  // Squares named like the standard diagram: files a–h from Red's left, ranks 1–8 from Red's side.
  function squareName(r, c) { return `${'ABCDEFGH'[c]}${8 - r}`; }

  function defaultCursor(movable, size) {
    const first = movable.values().next();
    if (!first.done) return { r: Math.floor(first.value / size), c: first.value % size };
    return flipped() ? { r: 0, c: 7 } : { r: 7, c: 0 };
  }

  function focusCursor() {
    const el = boardEl.querySelector(`.square[data-r="${cursor.r}"][data-c="${cursor.c}"]`);
    if (el) el.focus({ preventScroll: true });
  }

  function onBoardKey(e) {
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      let [dr, dc] = moves[e.key];
      if (flipped()) { dr = -dr; dc = -dc; } // arrows follow the screen, not the model
      cursor = { r: Math.min(7, Math.max(0, cursor.r + dr)), c: Math.min(7, Math.max(0, cursor.c + dc)) };
      boardEl.querySelectorAll('.square[tabindex="0"]').forEach(el => { el.tabIndex = -1; });
      const el = boardEl.querySelector(`.square[data-r="${cursor.r}"][data-c="${cursor.c}"]`);
      if (el) { el.tabIndex = 0; el.focus(); }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSquare(cursor.r, cursor.c);
    } else if (e.key === 'Escape' && selected && !game.chain) {
      selected = null; valid = [];
      statusEl.textContent = '';
      render();
    }
  }

  function updateHUD(state) {
    const { stats, current, moveNumber } = state;
    const kingsText = (n) => (n ? ` · ${n} king${n > 1 ? 's' : ''}` : '');
    redCount.textContent = String(stats[RED].total);
    blackCount.textContent = String(stats[BLACK].total);
    redKings.textContent = kingsText(stats[RED].kings);
    blackKings.textContent = kingsText(stats[BLACK].kings);
    const tag = (p) => (vsComputer() ? (p === humanSide ? ' (You)' : ' (AI)') : '');
    redLabel.textContent = `Red${tag(RED)}`;
    blackLabel.textContent = `Black${tag(BLACK)}`;
    turnEl.textContent = vsComputer() ? (current === humanSide ? 'You' : 'Computer') : sideName(current);
    turnDot.className = `ck-dot ${current === RED ? 'red' : 'black'}`;
    moveNum.textContent = String(moveNumber);
    undoBtn.disabled = !canUndoNow();
    overBar.classList.toggle('hidden', !game.over);
  }

  function canUndoNow() {
    return vsComputer() ? game.hasMovedInHistory(humanSide) : game.canUndo();
  }

  // Undo the last turn (vs the computer: back to the start of your previous turn).
  function undoMove() {
    if (!game || !canUndoNow()) return;
    cancelAI();
    gameToken++; // drop any AI hops still being played
    hideModal();
    selected = null; valid = [];
    let turns = 1;
    if (vsComputer()) {
      const humanToMove = game.current === humanSide;
      // Mid-turn chains count as a turn of their own; undo until it's your turn again.
      turns = humanToMove === !game.chain ? 2 : 1;
    }
    game.undoTurns(turns);
    if (!isAITurn()) statusEl.textContent = 'Move undone.';
  }

  function onBoardClick(e) {
    const sq = e.target.closest('.square');
    if (!sq || !boardEl.contains(sq)) return;
    const r = parseInt(sq.dataset.r, 10);
    const c = parseInt(sq.dataset.c, 10);
    cursor = { r, c };
    handleSquare(r, c);
  }

  function handleSquare(r, c) {
    if (game.over || isAITurn()) return;
    const cell = game.pieceAt(r, c);

    // Own piece: select it (or deselect when clicked again)
    if (cell && cell.p === game.current) {
      if (game.chain) {
        statusEl.textContent = 'Finish the jump with the same piece.';
        return;
      }
      if (selected && selected.r === r && selected.c === c) {
        selected = null; valid = [];
        statusEl.textContent = '';
        render();
        return;
      }
      selected = { r, c };
      valid = game.validMoves(r, c);
      if (valid.length) {
        statusEl.textContent = valid[0].capture ? 'Capture! Choose a highlighted square.' : 'Choose a highlighted square.';
      } else {
        statusEl.textContent = game.mustCapture() ? 'A capture is available — you must take it.' : 'No moves for this piece.';
      }
      render();
      return;
    }

    if (selected) {
      const move = valid.find(m => m.to[0] === r && m.to[1] === c);
      if (move) {
        const from = [selected.r, selected.c];
        selected = null; valid = [];
        const res = game.move(from, [r, c]); // re-renders via 'update'
        if (!res.ok) { statusEl.textContent = 'Invalid move.'; render(); }
        else if (res.continues) statusEl.textContent = 'Keep jumping!';
        return;
      }
      if (game.chain) {
        statusEl.textContent = 'Keep jumping — choose a highlighted square.';
        return;
      }
      selected = null; valid = [];
      render();
    }
    statusEl.textContent = '';
  }

  function onTurn() {
    if (game.over) return;
    if (isAITurn()) {
      scheduleAI(420 + Math.floor(Math.random() * 180));
    } else {
      cancelAI();
      statusEl.textContent = game.mustCapture() ? 'You must capture.' : (vsComputer() ? 'Your turn.' : '');
    }
  }

  // Theme handling (copied from memory UI for file:// compatibility)
  function setupTheme() {
    const key = 'memory.theme';
    const saved = readPref(key, null);
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = saved || (prefersLight ? 'light' : 'dark');
    applyTheme(theme);
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      writePref(key, next);
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

  // Captured pieces: leave a fading copy where the piece stood (the board is re-rendered right after).
  function ghostCapturedPiece(id) {
    if (reduceMotion()) return;
    const el = boardEl.querySelector(`.piece[data-id="${id}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'ck-ghost';
    Object.assign(ghost.style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
    const clone = el.cloneNode(true);
    clone.classList.remove('crowned', 'moving');
    clone.style.transform = '';
    ghost.appendChild(clone);
    document.body.appendChild(ghost);
    // Removed after the CSS animation (with a fallback in case animations are off).
    const done = () => ghost.remove();
    clone.addEventListener('animationend', done, { once: true });
    setTimeout(done, 600);
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
  function readPref(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
  }
  function writePref(key, value) {
    try { localStorage.setItem(key, String(value)); } catch {}
  }

  function setupOpponent() {
    opponent = readPref('checkers.opponent', 'human') === 'computer' ? 'computer' : 'human';
    humanSide = readPref('checkers.side', '1') === '2' ? BLACK : RED;
    aiLevel = Math.min(5, Math.max(1, parseInt(readPref('checkers.ai.level', '1'), 10) || 1));
    adaptive = readPref('checkers.ai.adaptive', 'true') !== 'false';
    opponentSelect.value = opponent;
    sideSelect.value = String(humanSide);
    levelSelect.value = String(aiLevel);
    adaptiveChk.checked = adaptive;
    updateAIControls();

    // Changing opponent or side starts a new game; confirm first if one is in progress.
    const confirmRestart = (select, current, apply, what) => {
      const next = select.value;
      const commit = () => { apply(next); newGame(); };
      if (!inProgress()) { commit(); return; }
      select.value = current();
      openModal({
        title: 'Start a new game?',
        msg: `${what(next)} starts a new game. The current game will be lost.`,
        primary: { label: 'New game', fn: () => { select.value = next; commit(); } },
        secondary: { label: 'Cancel', fn: null },
      });
    };
    opponentSelect.addEventListener('change', () => confirmRestart(
      opponentSelect,
      () => opponent,
      (v) => {
        opponent = v === 'computer' ? 'computer' : 'human';
        writePref('checkers.opponent', opponent);
        updateAIControls();
      },
      (v) => (v === 'computer' ? 'Playing the computer' : 'Playing a friend'),
    ));
    sideSelect.addEventListener('change', () => confirmRestart(
      sideSelect,
      () => String(humanSide),
      (v) => {
        humanSide = v === '2' ? BLACK : RED;
        writePref('checkers.side', humanSide);
      },
      (v) => `Switching to ${v === '2' ? 'Black' : 'Red'}`,
    ));
    levelSelect.addEventListener('change', () => {
      aiLevel = parseInt(levelSelect.value, 10) || 1;
      writePref('checkers.ai.level', aiLevel);
    });
    adaptiveChk.addEventListener('change', () => {
      adaptive = adaptiveChk.checked;
      writePref('checkers.ai.adaptive', adaptive);
    });
  }

  function inProgress() {
    return !!game && !game.over && game.canUndo();
  }

  function updateAIControls() {
    aiControls.classList.toggle('hidden', !vsComputer());
  }

  function onGameEnd(res) {
    if (!vsComputer() || !adaptive || !res.winner) return;
    if (res.winner === humanSide) aiLevel = Math.min(5, aiLevel + 1);
    else aiLevel = Math.max(1, aiLevel - 1);
    levelSelect.value = String(aiLevel);
    writePref('checkers.ai.level', aiLevel);
  }

  function cancelAI() {
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = null;
  }

  function scheduleAI(delay) {
    cancelAI();
    statusEl.textContent = 'Computer is thinking…';
    const token = gameToken;
    aiTimer = setTimeout(() => runAI(token), delay);
  }

  function runAI(token) {
    aiTimer = null;
    if (token !== gameToken || !isAITurn()) return;
    const chainSq = game.chain ? game.chain[0] * 8 + game.chain[1] : -1;
    const mv = CheckersAI.chooseMove(game.board, aiSide(), aiLevel, chainSq);
    if (!mv) return;
    const hops = [];
    for (let i = 1; i < mv.path.length; i++) hops.push([sqToRC(mv.path[i - 1]), sqToRC(mv.path[i])]);
    playHops(hops, token);
  }

  // Plays a multi-jump hop by hop so each jump is visible.
  function playHops(hops, token) {
    aiTimer = null;
    if (token !== gameToken || !isAITurn() || !hops.length) return;
    const [from, to] = hops.shift();
    const res = game.move(from, to);
    if (res.ok && res.continues && hops.length) {
      aiTimer = setTimeout(() => playHops(hops, token), 340);
    }
  }

  function sqToRC(sq) { return [sq >> 3, sq & 7]; }

  // Audio: simple wood-like thock using Web Audio
  function setupAudio() {
    // Load prefs
    const en = readPref('checkers.audio.enabled', null);
    const vol = Number(readPref('checkers.audio.volume', '1'));
    audio.enabled = en === null ? true : en === 'true';
    audio.volume = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 1;
    updateSoundUI();

    // Browsers only allow audio after a user gesture: create the context on the first one.
    // This must not touch the saved on/off preference.
    const unlock = () => {
      ensureAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    soundBtn.addEventListener('click', () => {
      audio.enabled = !audio.enabled;
      if (audio.enabled) ensureAudio();
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

  function ensureAudio() {
    try {
      if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.ctx.state === 'suspended') audio.ctx.resume();
      getOutput();
    } catch {}
  }

  // Crowning: two quick rising bell tones
  function playCrown() {
    if (!audio.enabled || !audio.ctx) return;
    const ctx = audio.ctx;
    const t0 = ctx.currentTime + 0.12; // after the landing thock
    [660, 990].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const t = t0 + i * 0.09;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(g);
      g.connect(getOutput());
      osc.start(t);
      osc.stop(t + 0.4);
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
    writePref('checkers.audio.enabled', audio.enabled);
    writePref('checkers.audio.volume', audio.volume);
  }

  // Modal helpers
  let modalActions = { primary: null, secondary: null };
  function setupModal() {
    const run = (which) => {
      const fn = modalActions[which];
      hideModal();
      if (fn) fn();
    };
    modalRestartBtn.addEventListener('click', () => run('primary'));
    modalCloseBtn.addEventListener('click', () => run('secondary'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) run('secondary');
    });
  }
  function openModal({ title, msg, primary, secondary }) {
    modalTitleEl.textContent = title;
    modalMsgEl.textContent = msg;
    modalRestartBtn.textContent = primary.label;
    modalCloseBtn.textContent = secondary.label;
    modalActions = { primary: primary.fn, secondary: secondary.fn };
    modalEl.classList.remove('hidden');
    modalRestartBtn.focus();
  }
  function showEnd(res) {
    cancelAI();
    selected = null; valid = [];
    let title, reason;
    if (res.draw) {
      title = 'Draw';
      reason = '40 moves each without a capture or a man moving.';
    } else {
      const loser = sideName(res.winner === RED ? BLACK : RED);
      if (vsComputer()) title = res.winner === humanSide ? 'You win!' : 'Computer wins';
      else title = `${sideName(res.winner)} wins!`;
      reason = res.reason === 'noMoves' ? `${loser} has no legal moves.` : `All ${loser} pieces captured.`;
    }
    const msg = `${title} ${reason}`;
    statusEl.textContent = '';
    overText.textContent = `Game over · ${msg}`;
    render(); // drop selection/movable cues and show the game-over bar
    openModal({
      title, msg: reason,
      primary: { label: 'New game', fn: newGame },
      secondary: { label: 'Close', fn: null },
    });
  }
  function hideModal() {
    modalEl.classList.add('hidden');
  }
})();
