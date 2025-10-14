Game Library + Memory Game (Vanilla JS)

Overview
- Simple, functional memory game built with plain HTML/CSS/JS.
- Clean separation: `src/game.js` contains game logic; `src/main.js` handles UI.
- Designed for easy extension (themes, scoring, levels, persistence).

Getting Started
- Open `index.html` to view the game library.
- Click “Memory Game” to open `memory.html` and play.
- In Memory Game: choose board size (4x4 or 6x6), click tiles to match pairs.

Project Structure
- `index.html` — Main game library page
- `memory.html` — Memory game page (standalone)
- `checkers.html` — Checkers game page (standalone)
- `utopia.html` — Tiny Utopia cozy idle sandbox
- `src/style.css` — Minimal styling and card flip effect
- `src/game.js` — Core game engine (state, shuffling, moves, events)
- `src/main.js` — DOM rendering, event wiring, HUD, and interactions
- `src/checkers.js` — Checkers core (board, turn, move validation)
- `src/checkers_ui.js` — Checkers UI rendering and interactions
- `src/utopia.js` — Tiny Utopia ecosystem engine
- `src/utopia_ui.js` — Tiny Utopia UI, island rendering, ambience

Extending the Game
- New symbol sets: pass a custom `symbols` array when creating `MemoryGame`.
- Different sizes: call `game.reset({ size: 6 })` or use the selector.
- Scoring: subscribe to `move`, `match`, `win` events in `main.js`.
- Persistence: store and load best time/moves from `localStorage`.
- Accessibility: enhance ARIA labels and keyboard navigation in `main.js`.
- Theming: add CSS variables and toggle themes via a button.

Game API (src/game.js)
- `new MemoryGame({ size, symbols })` — Create a game with square board.
- `game.on(event, handler)` — Subscribe to: `reset`, `flip`, `move`, `match`, `mismatch`, `update`, `win`.
- `game.reset({ size, symbols })` — New deck, clears state.
- `game.flip(index)` — Flip card at index if allowed.
- `game.flipBack([i, j])` — Flip back non-matching pair.
- Public state: `rows`, `cols`, `moves`, `matchedPairs`, `totalPairs`, `isComplete`, `timeElapsedMs`, `deck`.

Notes
- No build step or dependencies; runs offline.
- Uses emojis for symbols to avoid external assets.

Contributing
- See agents/software_developer.md:1 for coding conventions, structure, and implementation tips.
- See agents/game_designer.md:1 for design pillars, UX guidelines, and balancing notes.
