# Agent Notes — Software Developer

Scope: This repository hosts a minimal web “game library” and multiple small games built with plain HTML/CSS/JS. Goals are simplicity, extensibility, and no build tooling. Keep the code approachable and modular for future additions.

Technology Baseline
- No build step or bundlers. Scripts load via `<script>` tags; avoid module imports for file:// compatibility.
- Vanilla JS, minimal DOM APIs. No external dependencies.
- CSS organized in a shared `src/style.css`. Prefer CSS variables and small utility classes.
- All pages are self-contained HTML entries: `index.html`, `memory.html`, `checkers.html`, `utopia.html`, `backspace.html`.

Project Structure
- `index.html` — Game library landing page with cards and genres.
- `memory.html` — Memory game UI; logic in `src/game.js`, glue in `src/main.js`.
- `checkers.html` — Checkers page; core in `src/checkers.js`, UI in `src/checkers_ui.js`.
- `utopia.html` — Tiny Utopia page; engine in `src/utopia.js`, UI/audio in `src/utopia_ui.js`.
- `backspace.html` — Backspace platformer; levels in `src/backspace_levels.js`, timeline engine in `src/backspace.js` (no DOM; also runs in Node), UI/render/audio in `src/backspace_ui.js`. `npm run check-levels` (tools/check-levels.cjs) searches every level with the real engine: the scripted solution must win within the echo limit and par, and the level must be unbeatable without rewinding. `npm run demos` re-records each verified solution as an input tape in `src/backspace_demos.js` (played by the in-game ▶ Demo button, captions come from each solution step's `say`); rerun it whenever a level changes.
- `src/style.css` — Shared styles including themes, layout, components, and per‑game sections.
- `README.md` — Usage, structure, extension notes.

Coding Conventions
- Prefer small, single-purpose modules: “engine” files expose events/state; “ui” files wire DOM, input, and rendering.
- Avoid global side effects beyond attaching minimal globals for engines (required for file://).
- Keep functions pure where feasible; emit events for state changes.
- Use descriptive names; avoid one-letter variables beyond trivial loops.
- Comments sparingly; code should be self-explanatory. Document non-obvious math or rules.
- Accessibility: buttons should be focusable; keyboard support where it makes sense. Use ARIA labels for controls and regions.

Styling Guidelines
- Use CSS variables for color and theming. Dark/light themes via `data-theme` attribute on `html`.
- Keep animations subtle and respect `prefers-reduced-motion`.
- Reuse existing classes; add new sections under a clear comment (e.g., `/* Backspace */`).

Adding a New Game
1) Create `game-name.html` with a topbar, HUD, main section, and footer.
2) Add engine in `src/game-name.js` and UI in `src/game-name_ui.js` (if needed).
3) Wire scripts in the page, no modules. Expose engine via `window` if necessary.
4) Update `index.html` with a new card, icon, description, and genre.
5) Update `README.md` structure list.

Testing/Validation
- Open `.html` files directly in a browser; no server required.
- Check both light/dark themes and keyboard interactions.
- Validate performance: avoid excessive reflows; batch DOM updates.

Performance Tips
- Prefer document fragments and single-pass renders.
- For animations, use transform/opacity for GPU-accelerated paths.
- Use FLIP for animating moved elements (example: Checkers pieces).

Audio
- Web Audio only after user interaction. Keep a single master gain. Persist preferences to `localStorage`.
- Provide a Sound toggle and optional volume when relevant.

Persistence
- Use namespaced keys (e.g., `memory.best2.<mode>.<RxC>`, `checkers.ai.level`, `utopia.tutorial.done`).

Extensibility Playbook
- Memory: done — symbol sets, board sizes, modes, local bests, keyboard navigation. Next: shareable Daily result.
- Checkers: rules toggles (forced capture, multi-jump), AI depth/heuristics, side selection.
- Tiny Utopia: goals/achievements, seasonal events, data-driven parameters.
- Backspace: in-browser level editor; run the checker in CI.

Review Checklist
- [ ] Page loads from file:// with no console errors.
- [ ] Controls accessible and keyboard-friendly.
- [ ] Theme toggle works; contrast acceptable.
- [ ] No blocking network/dependencies. Clean and minimal DOM/CSS/JS.

