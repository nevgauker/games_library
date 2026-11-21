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
 - Additional games: Checkers, Tiny Utopia, Backspace, Pac-Man, Volfied, and Digger (retro canvas).

Getting Started
- Open `index.html` to view the game library.
- Click “Memory Game” to open `memory.html` and play.
- In Memory Game: pick a mode (Relaxed, Challenge, Time Attack, Daily), a board (3×4 up to 6×6) and a card set, then match pairs. Streaks add points, avoidable mistakes cost points, and each win earns 1–3 stars.

Project Structure
- `index.html` – Main game library page
- `memory.html` – Memory game page (standalone)
- `checkers.html` – Checkers game page (standalone)
- `snake.html` – Snake game page (standalone)
- `packdash.html` – Pack & Dash! office escape (standalone)
- `race.html` – Micro Racer (4 tracks × 3 AI levels, time trial with best-lap ghost)
- `utopia.html` – Tiny Utopia cozy idle sandbox
 - `pacman.html` – Pac-Man retro maze chase
- `volfied.html` - Volfied-inspired territory capture challenge
- `digger.html` - Digger-inspired tunnel and emerald arcade
- `src/style.css` – Minimal styling and card flip effect
- `src/game.js` – Core game engine (state, shuffling, moves, events)
- `src/main.js` – DOM rendering, event wiring, HUD, and interactions
- `src/checkers.js` – Checkers core (board, turn, move validation)
- `src/checkers_ui.js` – Checkers UI rendering and interactions
- `src/snake.js` – Snake engine (grid, snake movement, food, collisions)
- `src/snake_ui.js` – Snake canvas rendering and input wiring
- `src/packdash.js` – Pack & Dash! engine (timer, items, boss, coworkers)
- `src/packdash_ui.js` – Pack & Dash! canvas rendering and interactions
- `src/race.js` – Micro Racer engine (road splines, drift physics, AI, laps, boost pads, ghost recording)
- `src/race_ui.js` – Micro Racer canvas rendering and controls
- `src/utopia.js` – Tiny Utopia ecosystem engine
- `src/utopia_ui.js` – Tiny Utopia UI, island rendering, ambience
 - `src/pacman.js` – Pac-Man engine (maze, pellets, ghosts, collisions)
 - `src/pacman_ui.js` – Pac-Man canvas rendering and input wiring
- `src/volfied.js` - Volfied game core (territory capture, enemy collision, scoring)
- `src/volfied_ui.js` - Volfied canvas rendering and controls
- `src/digger.js` - Digger core (digging, bags, monsters, pump)
- `src/digger_ui.js` - Digger canvas rendering and controls

Extending the Game
- New symbol sets: add an entry to `SYMBOL_SETS` in `src/game.js` (18+ symbols) and an option in `memory.html`.
- Different sizes: add a `RxC` value to `SIZES` in `src/main.js` and the size selector (rows × cols must be even).
- Modes: add an entry to `MODES` in `src/main.js` (`moveLimit`, `timeLimitMs` or `daily`).
- Scoring: tune `SCORING` in `src/game.js`; stars come from `starRating()`.
- Persistence: bests are stored per mode and size under `memory.best2.<mode>.<RxC>` (Daily: `memory.daily.<date>.<RxC>`).
- Accessibility: enhance ARIA labels and keyboard navigation in `main.js`.
- Theming: add CSS variables and toggle themes via a button.

Game API (src/game.js)
- `new MemoryGame({ rows, cols, symbols, rng })` — Create a game (`size` still works for square boards; `rng` allows seeded decks via `memorySeededRng(seed)`).
- `game.on(event, handler)` — Subscribe to: `reset`, `flip`, `move`, `match` (`streak`, `points`), `mismatch` (`mistake`, `penalty`), `update`, `win`.
- `game.reset({ rows, cols, symbols, rng })` — New deck, clears state.
- `game.flip(index)` — Flip card at index if allowed.
- `game.flipBack([i, j])` — Flip back non-matching pair.
- `game.usePeek()` / `game.canPeek()` — One-time peek (costs points, caps rating at 2 stars).
- `game.end()` / `game.addBonus(points)` — End early (out of moves/time); add bonus points.
- Public state: `rows`, `cols`, `moves`, `matchedPairs`, `totalPairs`, `mistakes`, `streak`, `bestStreak`, `score`, `stars`, `isComplete`, `isOver`, `timeElapsedMs`, `deck`.

Notes
- No build step or dependencies; runs offline.
- Uses emojis for symbols to avoid external assets.

Contributing
- See agents/software_developer.md:1 for coding conventions, structure, and implementation tips.
- See agents/game_designer.md:1 for design pillars, UX guidelines, and balancing notes.
