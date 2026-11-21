// Lightweight, framework-free memory game core
// Focus: clean separation between state and UI

(function(global){

// Scoring rules (tweakable)
const SCORING = {
  match: 100,        // each pair found
  streakBonus: 50,   // extra per consecutive match beyond the first (x2 = +50, x3 = +100, ...)
  mistake: 25,       // mismatch you could have avoided (see _isMistake)
  peek: 100,         // cost of the one-time peek
};

class MemoryGame {
  // Board is rows x cols (must hold an even number of cards). `size` is kept for square boards.
  constructor({ rows, cols, size = 4, symbols = defaultSymbols(), rng = Math.random } = {}) {
    this._listeners = new Map();
    this._setup({ rows: rows ?? size, cols: cols ?? size, symbols, rng });
  }

  _setup({ rows, cols, symbols, rng }) {
    if ((rows * cols) % 2 !== 0) throw new Error(`Board ${rows}x${cols} has an odd number of cards`);
    this.rows = rows;
    this.cols = cols;
    this.symbols = symbols;
    this.rng = rng;
    this.moves = 0;
    this.matchedPairs = 0;
    this.mistakes = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.score = 0;
    this.peekUsed = false;
    this.startedAt = null;
    this.endedAt = null;
    this._flippedIndexes = [];
    this._seen = new Set(); // card indexes the player has seen face up
    this._buildDeck();
  }

  on(event, handler) {
    const arr = this._listeners.get(event) || [];
    arr.push(handler);
    this._listeners.set(event, arr);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const arr = this._listeners.get(event) || [];
    const idx = arr.indexOf(handler);
    if (idx >= 0) arr.splice(idx, 1);
  }

  emit(event, payload) {
    const arr = this._listeners.get(event) || [];
    for (const fn of arr) fn(payload);
  }

  get size() { return this.rows === this.cols ? this.rows : null; }
  get totalPairs() { return (this.rows * this.cols) / 2; }
  get isComplete() { return this.matchedPairs === this.totalPairs; }
  get isOver() { return this.endedAt !== null; }
  get hasPendingMismatch() { return this._flippedIndexes.length === 2; }
  get timeElapsedMs() {
    const end = this.endedAt ?? Date.now();
    return this.startedAt ? end - this.startedAt : 0;
  }
  // 1-3 stars from avoidable mistakes; using the peek caps the rating at 2
  get stars() { return starRating(this.totalPairs, this.mistakes, this.peekUsed); }

  _buildDeck() {
    const neededPairs = this.totalPairs;
    if (neededPairs > this.symbols.length) {
      throw new Error(`Not enough symbols: need ${neededPairs}, have ${this.symbols.length}`);
    }
    // Pick a random subset so each game uses a different mix of symbols
    const selected = shuffle(this.symbols.slice(), this.rng).slice(0, neededPairs);
    const deck = selected
      .flatMap((sym, i) => [
        { id: `${i}a`, symbol: sym, flipped: false, matched: false },
        { id: `${i}b`, symbol: sym, flipped: false, matched: false },
      ]);
    shuffle(deck, this.rng);
    this.deck = deck; // array of card objects
  }

  reset({ rows = this.rows, cols = this.cols, symbols = this.symbols, rng = this.rng } = {}) {
    this._setup({ rows, cols, symbols, rng });
    this.emit('reset', this._publicState());
  }

  // End the game early (e.g. out of moves): freezes the clock and blocks flips
  end() {
    if (this.endedAt === null) this.endedAt = Date.now();
  }

  // Extra points awarded by the UI (e.g. time bonus)
  addBonus(points) {
    this.score += points;
    this.emit('update', this._publicState());
  }

  _start() {
    if (!this.startedAt) this.startedAt = Date.now();
  }

  canFlip(index) {
    if (this.isOver) return false;
    if (index < 0 || index >= this.deck.length) return false;
    const card = this.deck[index];
    if (card.matched || card.flipped) return false;
    if (this._flippedIndexes.length === 2) return false;
    return true;
  }

  flip(index) {
    if (!this.canFlip(index)) return false;
    this._start();

    const card = this.deck[index];
    card.flipped = true;
    this._flippedIndexes.push(index);
    this.emit('flip', { index, card: this._publicCard(card) });

    if (this._flippedIndexes.length === 2) {
      const [i1, i2] = this._flippedIndexes;
      const c1 = this.deck[i1];
      const c2 = this.deck[i2];
      this.moves += 1;
      if (c1.symbol === c2.symbol) {
        c1.matched = true;
        c2.matched = true;
        this.matchedPairs += 1;
        this.streak += 1;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        const points = SCORING.match + SCORING.streakBonus * (this.streak - 1);
        this.score += points;
        this._flippedIndexes = [];
        this._seen.add(i1).add(i2);
        this.emit('match', { pair: [i1, i2], symbol: c1.symbol, streak: this.streak, points });
        if (this.isComplete) {
          this.endedAt = Date.now();
          this.emit('win', this._publicState());
        }
      } else {
        const mistake = this._isMistake(i1, i2);
        let penalty = 0;
        if (mistake) {
          this.mistakes += 1;
          penalty = Math.min(SCORING.mistake, this.score);
          this.score -= penalty;
        }
        this.streak = 0;
        this._seen.add(i1).add(i2);
        // Indicate a pending mismatch; UI calls flipBack after showing it
        this.emit('mismatch', { first: i1, second: i2, mistake, penalty });
      }
      this.emit('move', { moves: this.moves });
    }
    this.emit('update', this._publicState());
    return true;
  }

  // A mismatch counts as a mistake when the player already had the information to avoid it:
  // the first card's partner had been seen (they could have matched it), or the second
  // card had been seen before (they knew it was not the match).
  _isMistake(i1, i2) {
    const partner = this.deck.findIndex((c, i) => i !== i1 && c.symbol === this.deck[i1].symbol);
    return this._seen.has(partner) || this._seen.has(i2);
  }

  flipBack(indexes) {
    for (const i of indexes) {
      const card = this.deck[i];
      if (card && !card.matched) card.flipped = false;
    }
    this._flippedIndexes = [];
    this.emit('update', this._publicState());
  }

  // One-time power-up: the UI briefly shows every card. Costs points, caps the rating at 2 stars,
  // and counts every card as seen.
  canPeek() {
    return !this.peekUsed && !this.isOver && !this.hasPendingMismatch;
  }

  usePeek() {
    if (!this.canPeek()) return false;
    this._start();
    this.peekUsed = true;
    this.score = Math.max(0, this.score - SCORING.peek);
    this.deck.forEach((c, i) => { if (!c.matched) this._seen.add(i); });
    this.emit('update', this._publicState());
    return true;
  }

  // Convenience: expose shallow public state (immutable shape)
  _publicState() {
    return {
      rows: this.rows,
      cols: this.cols,
      moves: this.moves,
      matchedPairs: this.matchedPairs,
      totalPairs: this.totalPairs,
      mistakes: this.mistakes,
      streak: this.streak,
      bestStreak: this.bestStreak,
      score: this.score,
      isComplete: this.isComplete,
      timeElapsedMs: this.timeElapsedMs,
      deck: this.deck.map(this._publicCard),
    };
  }

  _publicCard(card) {
    return { id: card.id, symbol: card.symbol, flipped: card.flipped, matched: card.matched };
  }
}

function starRating(pairs, mistakes, peekUsed) {
  let stars = 1;
  if (mistakes <= Math.floor(pairs * 0.15)) stars = 3;
  else if (mistakes <= Math.ceil(pairs * 0.5)) stars = 2;
  return peekUsed ? Math.min(stars, 2) : stars;
}

// Symbol sets (each has at least 18 symbols, enough for the largest 6x6 board)
const SYMBOL_SETS = {
  animals: ['🐶','🐱','🦊','🐼','🦁','🐸','🦄','🐵','🐨','🐷','🐯','🐰','🐙','🦉','🐝','🦋','🐢','🐧','🐳','🦀'],
  food:    ['🍎','🍉','🍩','🍕','🍔','🍟','🌮','🍣','🍪','🍰','🧁','🍓','🍒','🍌','🍇','🥕','🌽','🥐','🍿','🧀'],
  travel:  ['🚀','✈️','🚗','🚲','⛵','🚁','🛸','🌙','⭐','🌍','🪐','☄️','🌈','🔥','⚡','❄️','🎈','🏰','🗽','🚂'],
  sports:  ['⚽','🏀','🏈','⚾','🎾','🏐','🎱','🏓','🎯','🎲','🎮','🧩','♟️','🎳','🏆','🥊','⛳','🛹','🎸','🎨'],
};
SYMBOL_SETS.mixed = [].concat(SYMBOL_SETS.animals, SYMBOL_SETS.food, SYMBOL_SETS.travel, SYMBOL_SETS.sports);

function defaultSymbols() {
  return SYMBOL_SETS.mixed.slice();
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Deterministic RNG from a string seed (used for the Daily board)
function seededRng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function mulberry32() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// expose to global for non-module usage
global.MemoryGame = MemoryGame;
global.defaultSymbols = defaultSymbols;
global.MemorySymbolSets = SYMBOL_SETS;
global.MemoryScoring = SCORING;
global.memorySeededRng = seededRng;
global.memoryStarRating = starRating;

})(window);
