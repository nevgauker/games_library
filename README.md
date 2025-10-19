Game Library + Memory Game (Vanilla JS)

Persistence
- Option A (default in repo): Direct Postgres connection (Supabase) via `pg` and `DATABASE_URL`.
- Option B (alternative): Supabase client keys (anon/service role) — not currently used in code after switch.

Direct Postgres (recommended for your setup)
- API route `api/suggestions.js` connects to Postgres using `pg` and `DATABASE_URL`.
- Set Vercel Project Environment Variable:
  - `DATABASE_URL` (use pooled connection string from Supabase; sslmode=require)
- Frontend posts to `/api/suggestions`; falls back to localStorage if the API isn’t available.

Supabase table
Create a `suggestions` table (SQL example):

```
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  title text not null,
  description text not null,
  created_at timestamptz not null default now()
);
```

Local development
- Static pages run without a server; suggestion form saves to localStorage if the API isn’t configured.

Local run (Vercel CLI)
- Install the Vercel CLI: `npm i -g vercel`
- Create and fill `./.env.local` (or copy from `.env.local.example`). Ensure this exists:
  - `DATABASE_URL`
- Start the local dev server from the repo root:
  - `vercel dev`
- Open `http://localhost:3000` and use the Suggest form.
  - The form POSTs to `http://localhost:3000/api/suggestions` and should persist to your Supabase project.

Health check
- Verify server and DB connectivity:
  - `GET http://localhost:3000/api/health` → `{ ok: true, db: true, time: ... }`

Notes
- Use Supabase “Pooling” connection string for serverless to avoid connection exhaustion.
- You can use `vercel env pull .env.local` to sync env vars from your Vercel project.

Overview
- Simple, functional memory game built with plain HTML/CSS/JS.
- Clean separation: `src/game.js` contains game logic; `src/main.js` handles UI.
- Designed for easy extension (themes, scoring, levels, persistence).
 - Additional games: Checkers, Tiny Utopia, Backspace, and Pac-Man (retro canvas).

Getting Started
- Open `index.html` to view the game library.
- Click “Memory Game” to open `memory.html` and play.
- In Memory Game: choose board size (4x4 or 6x6), click tiles to match pairs.

Project Structure
- `index.html` – Main game library page
- `memory.html` – Memory game page (standalone)
- `checkers.html` – Checkers game page (standalone)
- `snake.html` – Snake game page (standalone)
- `packdash.html` – Pack & Dash! office escape (standalone)
- `utopia.html` – Tiny Utopia cozy idle sandbox
 - `pacman.html` – Pac-Man retro maze chase
- `src/style.css` – Minimal styling and card flip effect
- `src/game.js` – Core game engine (state, shuffling, moves, events)
- `src/main.js` – DOM rendering, event wiring, HUD, and interactions
- `src/checkers.js` – Checkers core (board, turn, move validation)
- `src/checkers_ui.js` – Checkers UI rendering and interactions
- `src/snake.js` – Snake engine (grid, snake movement, food, collisions)
- `src/snake_ui.js` – Snake canvas rendering and input wiring
- `src/packdash.js` – Pack & Dash! engine (timer, items, boss, coworkers)
- `src/packdash_ui.js` – Pack & Dash! canvas rendering and interactions
- `src/utopia.js` – Tiny Utopia ecosystem engine
- `src/utopia_ui.js` – Tiny Utopia UI, island rendering, ambience
 - `src/pacman.js` – Pac-Man engine (maze, pellets, ghosts, collisions)
 - `src/pacman_ui.js` – Pac-Man canvas rendering and input wiring

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
