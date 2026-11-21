// Uses globals exposed by src/game.js for file:// compatibility
const { MemoryGame, MemorySymbolSets, memorySeededRng } = window;

const $ = (id) => document.getElementById(id);
const mainEl = document.querySelector('main');
const boardEl = $('board');
const scoreEl = $('score');
const pairsEl = $('pairs');
const movesEl = $('moves');
const movesLabelEl = $('moves-label');
const movesStatEl = $('moves-stat');
const mistakesEl = $('mistakes');
const timeEl = $('time');
const timeLabelEl = $('time-label');
const timeStatEl = $('time-stat');
const bestEl = $('best');
const bestLabelEl = $('best-label');
const statusEl = $('status');
const peekBtn = $('peek-btn');
const modeSelect = $('mode-select');
const sizeSelect = $('size-select');
const setSelect = $('set-select');
const soundBtn = $('sound-btn');
const themeBtn = $('theme-btn');
const restartBtn = $('restart-btn');
const modalEl = $('modal');
const modalTitleEl = $('modal-title');
const modalBadgeEl = $('modal-badge');
const modalStarsEl = $('modal-stars');
const modalMsgEl = $('modal-message');
const modalStatsEl = $('modal-stats');
const modalNextBtn = $('modal-next');
const modalRestartBtn = $('modal-restart');
const modalCloseBtn = $('modal-close');

const MISMATCH_DELAY_MS = 800;
const PEEK_MS = 1200;
const LOW_MOVES_WARNING = 5;
const LOW_TIME_WARNING_MS = 10000;
const TIME_ATTACK_SECONDS_PER_PAIR = 6;
const TIME_ATTACK_BONUS_PER_MATCH_MS = 2000;
const TIME_BONUS_POINTS_PER_SECOND = 10;
const SIZES = ['3x4', '4x4', '4x5', '5x6', '6x6'];

const MODES = {
  relaxed:   { name: 'Relaxed' },
  challenge: { name: 'Challenge', moveLimit: (pairs) => Math.ceil(pairs * 2.25) + 2 },
  timed:     { name: 'Time Attack', timeLimitMs: (pairs) => pairs * TIME_ATTACK_SECONDS_PER_PAIR * 1000 },
  daily:     { name: 'Daily', daily: true },
};

let game = null;
let mode = MODES.relaxed;
let modeKey = 'relaxed';
let sizeKey = '4x4';
let tickTimer = null;
let pending = null;      // pending mismatch: { first, second, timer }
let peekTimer = null;
let peeking = false;
let moveLimit = Infinity;
let timeLimitMs = Infinity;
let bonusTimeMs = 0;
let focusedIndex = 0;
let focusBeforeModal = null;
let lastScore = 0;

function init() {
  const saved = loadJSON('memory.settings') || {};
  if (MODES[saved.mode]) modeSelect.value = saved.mode;
  if (SIZES.includes(saved.size)) sizeSelect.value = saved.size;
  if (saved.set && MemorySymbolSets[saved.set]) setSelect.value = saved.set;

  for (const sel of [modeSelect, sizeSelect, setSelect]) {
    sel.addEventListener('change', () => { saveSettings(); newGame(); });
  }
  restartBtn.addEventListener('click', () => newGame());
  peekBtn.addEventListener('click', () => usePeek());
  soundBtn.addEventListener('click', () => setSound(!soundOn));
  setupTheme();
  setupKeyboard();
  setupModal();
  setSound(soundOn);
  updateSizeStars();
  newGame();
}

function saveSettings() {
  saveJSON('memory.settings', { mode: modeSelect.value, size: sizeSelect.value, set: setSelect.value });
}

// ---------- Game lifecycle ----------

function newGame() {
  // Cancel anything still pending from the previous game
  clearInterval(tickTimer);
  clearTimeout(peekTimer);
  if (pending) clearTimeout(pending.timer);
  pending = null;
  peeking = false;

  modeKey = modeSelect.value;
  mode = MODES[modeKey];
  sizeKey = sizeSelect.value;
  let [rows, cols] = sizeKey.split('x').map(Number);
  // Tall screens get the long side vertically
  if (rows !== cols && window.innerHeight > window.innerWidth) [rows, cols] = [cols, rows];

  let symbols = MemorySymbolSets[setSelect.value] || MemorySymbolSets.mixed;
  let rng = Math.random;
  if (mode.daily) {
    rng = memorySeededRng(`memory-daily-${todayKey()}-${sizeKey}`);
    symbols = MemorySymbolSets.mixed;
  }
  setSelect.disabled = !!mode.daily;
  setSelect.title = mode.daily ? 'The Daily board uses the same cards for everyone' : '';

  game = new MemoryGame({ rows, cols, symbols, rng });
  const pairs = game.totalPairs;
  moveLimit = mode.moveLimit ? mode.moveLimit(pairs) : Infinity;
  timeLimitMs = mode.timeLimitMs ? mode.timeLimitMs(pairs) : Infinity;
  bonusTimeMs = 0;
  focusedIndex = 0;
  lastScore = 0;

  mainEl.style.setProperty('--cols', cols);
  mainEl.style.setProperty('--rows', rows);
  boardEl.classList.remove('over');
  movesLabelEl.textContent = isFinite(moveLimit) ? 'Moves left' : 'Moves';
  timeLabelEl.textContent = isFinite(timeLimitMs) ? 'Time left' : 'Time';
  bestLabelEl.textContent = mode.daily ? "Today's best" : 'Best';

  renderBoard();
  updateHUD();
  updateBestHUD();
  setStatus(introText());
  tickTimer = setInterval(tick, 100);
  hideModal({ restoreFocus: false });

  game.on('flip', () => sfx('flip'));
  game.on('match', onMatch);
  game.on('mismatch', onMismatch);
  game.on('move', () => {
    // A mismatch is checked when it resolves; only check here after a match
    if (!pending && outOfMoves()) showGameOver('moves');
  });
  game.on('win', () => showWin());
  game.on('update', () => { syncBoard(); updateHUD(); });
}

function introText() {
  if (mode.daily) return `Daily board for ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: the same cards for everyone today.`;
  if (isFinite(moveLimit)) return `Challenge: find all ${game.totalPairs} pairs within ${moveLimit} moves.`;
  if (isFinite(timeLimitMs)) return `Time Attack: ${Math.round(timeLimitMs / 1000)}s on the clock, +${TIME_ATTACK_BONUS_PER_MATCH_MS / 1000}s per match. The clock starts on your first flip.`;
  return '';
}

function outOfMoves() {
  return !game.isComplete && game.moves >= moveLimit;
}

function timeLeftMs() {
  return timeLimitMs + bonusTimeMs - game.timeElapsedMs;
}

function tick() {
  if (isFinite(timeLimitMs) && game.startedAt && !game.isOver && timeLeftMs() <= 0) {
    showGameOver('time');
    return;
  }
  updateTime();
}

function onMatch({ pair, streak, points }) {
  pulseCards(pair, 'just-matched', 650);
  let msg = streak > 1 ? `Streak ×${streak}! +${points}` : `Match! +${points}`;
  if (isFinite(timeLimitMs)) {
    bonusTimeMs += TIME_ATTACK_BONUS_PER_MATCH_MS;
    msg += ` · +${TIME_ATTACK_BONUS_PER_MATCH_MS / 1000}s`;
  }
  setStatus(msg, 1200);
  sfx(streak > 1 ? 'streak' : 'match', streak);
}

function onMismatch({ first, second, mistake, penalty }) {
  for (const i of [first, second]) boardEl.children[i]?.classList.add('wrong');
  setStatus(mistake ? `Mistake: you'd seen that card before${penalty ? ` −${penalty}` : ''}` : 'No match', MISMATCH_DELAY_MS + 400);
  sfx(mistake ? 'mistake' : 'miss');
  // Give the player a moment to see the second card. Clicking another card skips the wait.
  pending = { first, second, timer: setTimeout(resolveMismatch, MISMATCH_DELAY_MS) };
}

function resolveMismatch() {
  if (!pending) return;
  const { first, second, timer } = pending;
  clearTimeout(timer);
  pending = null;
  for (const i of [first, second]) boardEl.children[i]?.classList.remove('wrong');
  game.flipBack([first, second]);
  if (outOfMoves()) showGameOver('moves');
}

function onCardClick(index) {
  if (peeking || game.isOver) return;
  if (pending) {
    const { first, second } = pending;
    resolveMismatch();
    if (index === first || index === second || game.isOver) return;
  }
  game.flip(index);
}

function usePeek() {
  if (peeking || !game.canPeek()) return;
  game.usePeek();
  peeking = true;
  sfx('peek');
  setStatus('Peek! Remember what you can…', PEEK_MS);
  for (const el of boardEl.children) if (!el.classList.contains('matched')) el.classList.add('peeking');
  updatePeekBtn();
  peekTimer = setTimeout(() => {
    peeking = false;
    for (const el of boardEl.children) el.classList.remove('peeking');
  }, PEEK_MS);
}

function endRound() {
  game.end();
  clearInterval(tickTimer);
  clearTimeout(peekTimer);
  peeking = false;
  for (const el of boardEl.children) el.classList.remove('peeking');
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
  updateHUD();
  boardEl.classList.add('over');
}

function showWin() {
  endRound();
  let timeBonus = 0;
  if (isFinite(timeLimitMs)) {
    timeBonus = Math.max(0, Math.floor(timeLeftMs() / 1000)) * TIME_BONUS_POINTS_PER_SECOND;
    if (timeBonus) game.addBonus(timeBonus);
  }
  const stars = game.stars;
  const isNewBest = recordBest(stars);
  recordSizeStars(stars);
  updateBestHUD();
  updateSizeStars();
  sfx('win');
  setStatus(`You win! 🎉 ${game.score} points${isNewBest ? ' · New best!' : ''}`);

  const stats = [
    ['Score', game.score],
    ['Moves', game.moves],
    ['Mistakes', game.mistakes],
    ['Best streak', `×${game.bestStreak}`],
    ['Time', formatTime(game.timeElapsedMs)],
  ];
  if (timeBonus) stats.push(['Time bonus', `+${timeBonus}`]);

  const nextSize = SIZES[SIZES.indexOf(sizeKey) + 1];
  showModal({
    title: mode.daily ? 'Daily done! 🎉' : 'You win! 🎉',
    badge: isNewBest ? (mode.daily ? "New best today! 🏆" : 'New best! 🏆') : '',
    stars,
    message: starHint(stars),
    stats,
    next: nextSize,
  });
}

function starHint(stars) {
  const pairs = game.totalPairs;
  if (stars === 3) return 'Perfect memory. Three stars!';
  if (game.peekUsed && stars === 2) return 'Peeking caps the rating at 2 stars. Try it without!';
  const needed = stars === 1 ? Math.ceil(pairs * 0.5) : Math.floor(pairs * 0.15);
  const target = stars + 1;
  return `Make ${needed === 0 ? 'no' : `${needed} or fewer`} mistake${needed === 1 ? '' : 's'} for ${target} stars.`;
}

function showGameOver(reason) {
  endRound();
  sfx('lose');
  const title = reason === 'time' ? "Time's up!" : 'Out of moves';
  setStatus(`${title} Press Restart to try again.`);
  showModal({
    title,
    message: `You found ${game.matchedPairs} of ${game.totalPairs} pairs. Try again!`,
    stats: [
      ['Score', game.score],
      ['Pairs', `${game.matchedPairs}/${game.totalPairs}`],
      ['Mistakes', game.mistakes],
    ],
    restartLabel: 'Try again',
  });
}

// ---------- Rendering ----------

function renderBoard() {
  boardEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  game.deck.forEach((card, index) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.dataset.index = String(index);
    cardEl.style.setProperty('--i', index);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tile';
    button.addEventListener('click', () => onCardClick(index));

    const front = document.createElement('div');
    front.className = 'face front';
    front.setAttribute('aria-hidden', 'true');
    front.textContent = '?';

    const back = document.createElement('div');
    back.className = 'face back';
    back.setAttribute('aria-hidden', 'true');
    back.textContent = card.symbol;

    button.appendChild(front);
    button.appendChild(back);
    cardEl.appendChild(button);
    frag.appendChild(cardEl);
  });
  boardEl.appendChild(frag);
  syncBoard();
  // Deal-in animation runs once per new board
  boardEl.classList.add('dealing');
  clearTimeout(boardEl._dealTimer);
  boardEl._dealTimer = setTimeout(() => boardEl.classList.remove('dealing'), game.deck.length * 15 + 400);
}

function syncBoard() {
  const children = boardEl.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const card = game.deck[i];
    el.classList.toggle('flipped', card.flipped);
    el.classList.toggle('matched', card.matched);
    const btn = el.firstElementChild;
    btn.setAttribute('aria-label', cardLabel(i, card));
    // Roving tabindex: only one card is in the tab order; arrows move between cards
    btn.tabIndex = i === focusedIndex ? 0 : -1;
  }
}

function cardLabel(index, card) {
  const pos = `Row ${Math.floor(index / game.cols) + 1}, column ${(index % game.cols) + 1}`;
  if (card.matched) return `${pos}: ${card.symbol}, matched`;
  if (card.flipped) return `${pos}: ${card.symbol}`;
  return `${pos}: hidden`;
}

function pulseCards(indexes, cls, ms) {
  for (const i of indexes) {
    const el = boardEl.children[i];
    if (!el) continue;
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }
}

function updateHUD() {
  if (game.score !== lastScore) {
    bump(scoreEl);
    lastScore = game.score;
  }
  scoreEl.textContent = String(game.score);
  pairsEl.textContent = `${game.matchedPairs}/${game.totalPairs}`;
  mistakesEl.textContent = String(game.mistakes);
  if (isFinite(moveLimit)) {
    const left = Math.max(0, moveLimit - game.moves);
    movesEl.textContent = String(left);
    movesStatEl.classList.toggle('low', left <= LOW_MOVES_WARNING);
  } else {
    movesEl.textContent = String(game.moves);
    movesStatEl.classList.remove('low');
  }
  updateTime();
  updatePeekBtn();
}

function updateTime() {
  if (isFinite(timeLimitMs)) {
    const left = Math.max(0, timeLeftMs());
    timeEl.textContent = left < LOW_TIME_WARNING_MS ? `${(left / 1000).toFixed(1)}s` : formatTime(Math.ceil(left / 1000) * 1000);
    timeStatEl.classList.toggle('low', !!game.startedAt && left <= LOW_TIME_WARNING_MS);
  } else {
    timeEl.textContent = formatTime(game.timeElapsedMs);
    timeStatEl.classList.remove('low');
  }
}

function updatePeekBtn() {
  peekBtn.disabled = game.peekUsed || game.isOver;
  peekBtn.classList.toggle('used', game.peekUsed);
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Set the status line. With ttlMs it clears itself afterwards; a later call
// (e.g. the win message) always replaces a pending clear.
function setStatus(text, ttlMs = 0) {
  statusEl.textContent = text;
  const token = Symbol('status');
  statusEl._token = token;
  if (ttlMs > 0) {
    setTimeout(() => { if (statusEl._token === token) statusEl.textContent = ''; }, ttlMs);
  }
}

// ---------- Modal ----------

function setupModal() {
  modalRestartBtn.addEventListener('click', () => newGame());
  modalNextBtn.addEventListener('click', () => {
    const next = modalNextBtn.dataset.size;
    if (next) {
      sizeSelect.value = next;
      saveSettings();
    }
    newGame();
  });
  modalCloseBtn.addEventListener('click', () => hideModal());
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) hideModal(); });
  modalEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideModal();
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog
      const focusables = [...modalEl.querySelectorAll('button')].filter((b) => !b.classList.contains('hidden'));
      const i = focusables.indexOf(document.activeElement);
      e.preventDefault();
      const step = e.shiftKey ? -1 : 1;
      focusables[(i + step + focusables.length) % focusables.length].focus();
    }
  });
}

function showModal({ title, badge = '', stars = 0, message = '', stats = [], next = null, restartLabel = 'Play again' }) {
  modalTitleEl.textContent = title;
  modalBadgeEl.textContent = badge;
  modalBadgeEl.classList.toggle('hidden', !badge);
  modalStarsEl.classList.toggle('hidden', !stars);
  modalStarsEl.innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    const s = document.createElement('span');
    s.textContent = '★';
    s.className = i <= stars ? 'on' : 'off';
    s.style.setProperty('--d', `${i * 140}ms`);
    modalStarsEl.appendChild(s);
  }
  modalStarsEl.setAttribute('aria-label', `${stars} of 3 stars`);
  modalMsgEl.textContent = message;
  modalStatsEl.innerHTML = '';
  for (const [label, value] of stats) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = String(value);
    div.append(dt, dd);
    modalStatsEl.appendChild(div);
  }
  modalNextBtn.classList.toggle('hidden', !next);
  modalNextBtn.dataset.size = next || '';
  modalNextBtn.textContent = next ? `Next: ${next.replace('x', ' × ')}` : '';
  modalRestartBtn.textContent = restartLabel;
  focusBeforeModal = document.activeElement;
  modalEl.classList.remove('hidden');
  modalRestartBtn.focus();
}

function isModalOpen() {
  return !modalEl.classList.contains('hidden');
}

function hideModal({ restoreFocus = true } = {}) {
  if (!isModalOpen()) return;
  modalEl.classList.add('hidden');
  if (restoreFocus && focusBeforeModal && document.contains(focusBeforeModal)) {
    focusBeforeModal.focus();
  } else {
    focusTile(focusedIndex);
  }
  focusBeforeModal = null;
}

// ---------- Bests and progression ----------

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bestKey() {
  return mode.daily ? `memory.daily.${todayKey()}.${sizeKey}` : `memory.best2.${modeKey}.${sizeKey}`;
}

// Higher score wins; ties go to fewer moves, then faster time
function isBetter(a, b) {
  if (a.score !== b.score) return a.score > b.score;
  if (a.moves !== b.moves) return a.moves < b.moves;
  return a.timeMs < b.timeMs;
}

// Returns true when this run set a new best
function recordBest(stars) {
  const prev = loadJSON(bestKey());
  const now = { score: game.score, moves: game.moves, timeMs: game.timeElapsedMs, stars };
  if (!prev || isBetter(now, prev)) {
    saveJSON(bestKey(), now);
    return true;
  }
  return false;
}

function updateBestHUD() {
  const best = loadJSON(bestKey());
  bestEl.textContent = best ? `${best.score} ${'★'.repeat(best.stars || 0)}` : '—';
}

function recordSizeStars(stars) {
  const all = loadJSON('memory.stars') || {};
  if ((all[sizeKey] || 0) < stars) {
    all[sizeKey] = stars;
    saveJSON('memory.stars', all);
  }
}

// Show the best rating earned on each board size in the size picker
function updateSizeStars() {
  const all = loadJSON('memory.stars') || {};
  for (const opt of sizeSelect.options) {
    const stars = all[opt.value] || 0;
    const base = opt.value.replace('x', ' × ');
    opt.textContent = stars ? `${base}  ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : base;
  }
}

// ---------- Sound (opt-in) ----------

let audioCtx = null;
let master = null;
let soundOn = safeGet('memory.sound') === '1';

function ensureAudio() {
  if (!soundOn) return;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      master = audioCtx.createGain();
      master.gain.value = 0.06;
      master.connect(audioCtx.destination);
    } catch { return; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function tone(freq, dur = 0.08, type = 'sine', delay = 0, vol = 1) {
  if (!soundOn || !audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  g.connect(master);
  const t = audioCtx.currentTime + delay;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function sfx(name, streak = 1) {
  if (!soundOn) return;
  ensureAudio();
  switch (name) {
    case 'flip': tone(520, 0.05, 'triangle', 0, 0.6); break;
    case 'match': tone(660, 0.09, 'sine'); tone(880, 0.12, 'sine', 0.08); break;
    case 'streak': {
      const base = 660 * Math.pow(2, Math.min(streak - 1, 6) / 12);
      tone(base, 0.08, 'sine'); tone(base * 1.25, 0.08, 'sine', 0.07); tone(base * 1.5, 0.14, 'sine', 0.14);
      break;
    }
    case 'miss': tone(240, 0.12, 'triangle', 0, 0.7); break;
    case 'mistake': tone(220, 0.1, 'square', 0, 0.35); tone(185, 0.16, 'square', 0.09, 0.35); break;
    case 'peek': tone(990, 0.06, 'sine'); tone(1320, 0.1, 'sine', 0.06); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'sine', i * 0.1)); break;
    case 'lose': [392, 330, 262].forEach((f, i) => tone(f, 0.18, 'triangle', i * 0.12)); break;
  }
}

function setSound(on) {
  soundOn = !!on;
  safeSet('memory.sound', soundOn ? '1' : '0');
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundBtn.textContent = soundOn ? 'Sound: On' : 'Sound: Off';
  if (soundOn) ensureAudio();
}

// ---------- Theme ----------

function setupTheme() {
  const key = 'memory.theme';
  const saved = safeGet(key);
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    safeSet(key, next);
  });
}

function applyTheme(theme) {
  const light = theme === 'light';
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  themeBtn.setAttribute('aria-pressed', String(light));
  themeBtn.textContent = light ? 'Theme: Light' : 'Theme: Dark';
}

// ---------- Storage ----------

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function loadJSON(key) {
  try { return JSON.parse(safeGet(key) || 'null'); } catch { return null; }
}

function saveJSON(key, value) {
  safeSet(key, JSON.stringify(value));
}

// ---------- Keyboard ----------

// Arrows move between cards; Enter/Space flip via the native button click
function setupKeyboard() {
  boardEl.addEventListener('focusin', (e) => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    focusedIndex = parseInt(cardEl.dataset.index, 10);
    syncBoard();
  });

  boardEl.addEventListener('keydown', (e) => {
    const cols = game.cols;
    const total = game.deck.length;
    const row = Math.floor(focusedIndex / cols);
    const col = focusedIndex % cols;
    let next = focusedIndex;
    switch (e.key) {
      case 'ArrowRight': if (col < cols - 1) next += 1; break;
      case 'ArrowLeft': if (col > 0) next -= 1; break;
      case 'ArrowDown': if (focusedIndex + cols < total) next += cols; break;
      case 'ArrowUp': if (row > 0) next -= cols; break;
      case 'Home': next = row * cols; break;
      case 'End': next = row * cols + cols - 1; break;
      default: return;
    }
    e.preventDefault();
    focusTile(next);
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    if (key === 'r') { e.preventDefault(); newGame(); }
    else if (key === 'p' && !isModalOpen()) { e.preventDefault(); usePeek(); }
    else if (key === 'm') { e.preventDefault(); setSound(!soundOn); }
  });
}

function focusTile(index) {
  const el = boardEl.children[index];
  if (!el) return;
  focusedIndex = index;
  syncBoard();
  el.firstElementChild.focus();
}

init();
