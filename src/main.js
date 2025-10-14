// Uses globals exposed by src/game.js for file:// compatibility
const { MemoryGame, defaultSymbols } = window;

const boardEl = document.getElementById('board');
const movesEl = document.getElementById('moves');
const timeEl = document.getElementById('time');
const scoreEl = document.getElementById('score');
const statusEl = document.getElementById('status');
const restartBtn = document.getElementById('restart-btn');
const themeBtn = document.getElementById('theme-btn');
const sizeSelect = document.getElementById('size-select');
const bestEl = document.getElementById('best');
const modalEl = document.getElementById('modal');
const modalTitleEl = document.getElementById('modal-title');
const modalMsgEl = document.getElementById('modal-message');
const modalRestartBtn = document.getElementById('modal-restart');
const modalCloseBtn = document.getElementById('modal-close');

let game = null;
let tickTimer = null;
let inputLocked = false;
let limitMoves = 0;

init();

function init() {
  const initialSize = parseInt(sizeSelect.value, 10);
  newGame(initialSize);

  restartBtn.addEventListener('click', () => newGame(parseInt(sizeSelect.value, 10)));
  sizeSelect.addEventListener('change', () => newGame(parseInt(sizeSelect.value, 10)));
  setupTheme();
  setupKeyboard();
  setupModal();
}

function newGame(size) {
  clearInterval(tickTimer);
  game = new MemoryGame({ size, symbols: defaultSymbols() });
  inputLocked = false;
  limitMoves = computeLimit(size);
  boardEl.style.setProperty('--cols', game.cols);
  renderBoard(game);
  updateHUD(game);
  statusEl.textContent = '';
  tickTimer = setInterval(() => updateTime(game), 250);
  updateBestHUD();
  hideModal();

  // Wire events
  game.on('flip', () => updateHUD(game));
  game.on('move', () => {
    updateHUD(game);
    // If out of moves and not complete, end game
    if (!game.isComplete && game.moves >= limitMoves && !inputLocked) {
      showGameOver();
    }
  });
  game.on('match', () => { pulseStatus('Match! ✅', 600); updateHUD(game); });
  game.on('mismatch', ({ first, second }) => handleMismatch(first, second));
  game.on('win', () => {
    statusEl.textContent = `You win! 🎉 Time: ${formatTime(game.timeElapsedMs)}, Moves: ${game.moves}`;
    recordBest();
    updateBestHUD();
    updateHUD(game);
  });
  game.on('update', () => { syncBoard(game); updateHUD(game); });
}

function renderBoard(game) {
  boardEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  game.deck.forEach((card, index) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.dataset.index = String(index);

    const button = document.createElement('button');
    button.className = 'tile';
    button.setAttribute('aria-label', 'Card');
    button.addEventListener('click', () => onCardClick(index));

    const front = document.createElement('div');
    front.className = 'face front';
    front.textContent = '🎴';

    const back = document.createElement('div');
    back.className = 'face back';
    back.textContent = card.symbol;

    button.appendChild(front);
    button.appendChild(back);
    cardEl.appendChild(button);
    frag.appendChild(cardEl);
  });
  boardEl.appendChild(frag);
  syncBoard(game);
}

function syncBoard(game) {
  const children = boardEl.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const card = game.deck[i];
    el.classList.toggle('flipped', card.flipped);
    el.classList.toggle('matched', card.matched);
    const btn = el.querySelector('button.tile');
    if (btn) {
      btn.setAttribute('aria-pressed', String(card.flipped));
      btn.setAttribute('tabindex', '0');
    }
  }
}

function onCardClick(index) {
  if (inputLocked) return;
  const ok = game.flip(index);
  if (!ok) return;
}

function handleMismatch(first, second) {
  inputLocked = true;
  // Give the player a moment to see the second card
  setTimeout(() => {
    game.flipBack([first, second]);
    inputLocked = false;
    // If no moves left after resolving mismatch, end the game
    if (!game.isComplete && game.moves >= limitMoves) {
      showGameOver();
    }
  }, 700);
}

function updateHUD(game) {
  movesEl.textContent = `${game.moves}/${limitMoves}`;
  updateTime(game);
  scoreEl.textContent = `${game.matchedPairs}/${game.totalPairs}`;
}

function updateTime(game) {
  timeEl.textContent = formatTime(game.timeElapsedMs);
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function pulseStatus(text, ttlMs = 600) {
  statusEl.textContent = text;
  const token = Symbol('pulse');
  statusEl._token = token;
  setTimeout(() => { if (statusEl._token === token) statusEl.textContent = ''; }, ttlMs);
}

// Moves limit per board size (tweakable)
function computeLimit(size) {
  // Reasonable defaults: 4x4 -> 30 moves, 6x6 -> 80 moves
  const map = { 4: 30, 6: 80 };
  return map[size] ?? Math.ceil(size * size * 1.5);
}

// Modal helpers
function setupModal() {
  modalRestartBtn.addEventListener('click', () => {
    hideModal();
    newGame(parseInt(sizeSelect.value, 10));
  });
  modalCloseBtn.addEventListener('click', hideModal);
}

function showGameOver() {
  inputLocked = true;
  modalTitleEl.textContent = 'Game Over';
  modalMsgEl.textContent = 'No moves left. Try again!';
  modalEl.classList.remove('hidden');
  modalRestartBtn.focus();
}

function hideModal() {
  modalEl.classList.add('hidden');
}

// Theme handling
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

// Best score handling (per board size)
function recordBest() {
  const key = `memory.best.${game.size}`;
  const prev = JSON.parse(localStorage.getItem(key) || 'null');
  const now = { moves: game.moves, timeMs: game.timeElapsedMs };
  if (!prev || isBetter(now, prev)) {
    localStorage.setItem(key, JSON.stringify(now));
  }
}

function isBetter(a, b) {
  // Prioritize time, then moves
  if (a.timeMs !== b.timeMs) return a.timeMs < b.timeMs;
  return a.moves < b.moves;
}

function readBest(size) {
  const key = `memory.best.${size}`;
  return JSON.parse(localStorage.getItem(key) || 'null');
}

function updateBestHUD() {
  const best = readBest(game.size);
  if (!best) bestEl.textContent = '—';
  else bestEl.textContent = `${formatTime(best.timeMs)}, ${best.moves} moves`;
}

// Keyboard navigation
let focusedIndex = 0;
function setupKeyboard() {
  boardEl.addEventListener('keydown', (e) => {
    if (!game) return;
    const cols = game.cols;
    const total = game.deck.length;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusedIndex = (focusedIndex + 1) % total;
        focusTile(focusedIndex);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusedIndex = (focusedIndex - 1 + total) % total;
        focusTile(focusedIndex);
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusedIndex = (focusedIndex + cols) % total;
        focusTile(focusedIndex);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusedIndex = (focusedIndex - cols + total) % total;
        focusTile(focusedIndex);
        break;
      case 'Enter':
      case ' ': // Space
        e.preventDefault();
        onCardClick(focusedIndex);
        break;
      default:
        break;
    }
  });

  // Initial focus to first tile on load
  requestAnimationFrame(() => focusTile(0));
}

function focusTile(index) {
  const el = boardEl.children[index];
  if (!el) return;
  const btn = el.querySelector('button.tile');
  if (btn) btn.focus();
}
