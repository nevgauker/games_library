// Lightweight, framework-free memory game core
// Focus: clean separation between state and UI

(function(global){

class MemoryGame {
  constructor({ size = 4, symbols = defaultSymbols() } = {}) {
    this.size = size; // board is size x size
    this.symbols = symbols;
    this.moves = 0;
    this.matchedPairs = 0;
    this.startedAt = null;
    this.endedAt = null;
    this._flippedIndexes = [];
    this._listeners = new Map();
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

  get rows() { return this.size; }
  get cols() { return this.size; }
  get totalPairs() { return (this.size * this.size) / 2; }
  get isComplete() { return this.matchedPairs === this.totalPairs; }
  get timeElapsedMs() {
    const end = this.endedAt ?? Date.now();
    return this.startedAt ? end - this.startedAt : 0;
  }

  _buildDeck() {
    const neededPairs = this.totalPairs;
    if (neededPairs > this.symbols.length) {
      throw new Error(`Not enough symbols: need ${neededPairs}, have ${this.symbols.length}`);
    }
    const selected = this.symbols.slice(0, neededPairs);
    const deck = selected
      .flatMap((sym, i) => [
        { id: `${i}a`, symbol: sym, flipped: false, matched: false },
        { id: `${i}b`, symbol: sym, flipped: false, matched: false },
      ]);
    shuffle(deck);
    this.deck = deck; // array of card objects
  }

  reset({ size = this.size, symbols = this.symbols } = {}) {
    this.size = size;
    this.symbols = symbols;
    this.moves = 0;
    this.matchedPairs = 0;
    this.startedAt = null;
    this.endedAt = null;
    this._flippedIndexes = [];
    this._buildDeck();
    this.emit('reset', this._publicState());
  }

  canFlip(index) {
    if (this.isComplete) return false;
    if (index < 0 || index >= this.deck.length) return false;
    const card = this.deck[index];
    if (card.matched || card.flipped) return false;
    if (this._flippedIndexes.length === 2) return false;
    return true;
  }

  flip(index) {
    if (!this.canFlip(index)) return false;
    if (!this.startedAt) this.startedAt = Date.now();

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
        this._flippedIndexes = [];
        this.emit('match', { pair: [i1, i2], symbol: c1.symbol });
        if (this.isComplete) {
          this.endedAt = Date.now();
          this.emit('win', this._publicState());
        }
      } else {
        // Indicate a pending mismatch; UI can schedule flip back
        this.emit('mismatch', { first: i1, second: i2 });
      }
      this.emit('move', { moves: this.moves });
    }
    this.emit('update', this._publicState());
    return true;
  }

  flipBack(indexes) {
    for (const i of indexes) {
      const card = this.deck[i];
      if (card && !card.matched) card.flipped = false;
    }
    this._flippedIndexes = [];
    this.emit('update', this._publicState());
  }

  // Convenience: expose shallow public state (immutable shape)
  _publicState() {
    return {
      rows: this.rows,
      cols: this.cols,
      moves: this.moves,
      matchedPairs: this.matchedPairs,
      totalPairs: this.totalPairs,
      isComplete: this.isComplete,
      timeElapsedMs: this.timeElapsedMs,
      deck: this.deck.map(this._publicCard),
    };
  }

  _publicCard(card) {
    return { id: card.id, symbol: card.symbol, flipped: card.flipped, matched: card.matched };
  }
}

function defaultSymbols() {
  // Emojis: safe, self-contained
  return [
    '🐶','🐱','🦊','🐼','🦁','🐸','🦄','🐵',
    '🐨','🐷','🐯','🐰','🐙','🦉','🐝','🦋',
    '🌸','🍀','🍎','🍉','🍩','🍕','⚽','🎲',
    '🎈','🚗','✈️','🚀','⭐','🌙','🌈','🔥'
  ];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// expose to global for non-module usage
global.MemoryGame = MemoryGame;
global.defaultSymbols = defaultSymbols;

})(window);
