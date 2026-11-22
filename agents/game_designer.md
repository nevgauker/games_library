# Agent Notes — Game Designer

Vision
- A calm, cohesive web playground featuring small, modular games with instant load, quick feedback loops, and low friction. Visual language is clean, readable, and slightly playful.

Design Pillars
- Instant iteration: fast restarts, short loops, small levels.
- Clarity over complexity: minimalist visuals, clear affordances, high contrast.
- Tactile feedback: subtle animations and lightweight sound where appropriate.
- Accessibility: keyboard support and readable UI across themes.

Games Overview
- Memory (Classic): Match pairs across 5 board sizes and 4 modes (Relaxed, Challenge, Time Attack, Daily). Streak bonuses, avoidable-mistake penalties, 1–3 star rating, one-time Peek. Ideal for quick sessions.
- Checkers (Classic + AI): Local two‑player or AI (Lv 1–5, manual or adaptive, play either side). Forced capture, multi-jumps, kinging, no-moves win, 40-move draw rule.
- Tiny Utopia (Experimental): Idle sandbox; nudge plants/animals/water toward “Harmony.” Ambient audio and trends.
- Backspace (Experimental): Hold Backspace to rewind time; an echo replays what you did. Echoes hold plates, can be stood on, and block lasers. Hazards snap time back 1 s.

Tone & Aesthetics
- Minimalist shapes, soft gradients, limited palette. Background uses gentle animated blobs for playfulness.
- Keep motion subtle; respect reduced‑motion preferences.
- Use emoji sparingly to add charm (Memory symbols, Tiny Utopia animals).

UX Guidelines
- Topbar: concise title + essential controls (theme, restart, opponent/level where relevant).
- HUD: 3–5 key stats; avoid clutter. Show trends or bests to drive engagement.
- Feedback: positive microcopy (“Match! ✅”, “Serene”), small pulses/glows, short sounds.
- Modals: keep copy short; offer Restart/Next options.

Balancing & Progression
- Memory: default Relaxed 4×4. Score: +100 per pair, +50 per extra streak step, −25 per mistake (a mismatch where the right card or the flipped card had already been seen; unavoidable exploration is free). Stars: 3★ ≤ 15% of pairs in mistakes, 2★ ≤ 50%, Peek caps at 2★. Challenge move limit = ceil(2.25 × pairs) + 2 (perfect memory averages ~1.6 × pairs). Time Attack: 6s per pair, +2s per match, 10 pts per second left.
- Checkers: start with Lv 1 AI; auto-tune difficulty post-match (±1) when Adaptive is on; manual level select otherwise.
- Tiny Utopia: keep dynamics gentle; harmony > 0.8 should feel “Serene.” Add goals (“Maintain 70%+ for 60s”).
- Backspace: 12 one-screen levels, each introducing one idea (plate/door, echo platform, colour pairs, timed plates, spikes + one-way platforms, lasers, stacking) before combining them. Echo limit per level; stars for finishing, par echoes and par time. Par time ≈ 1.15 × scripted solution (incl. scrub time) + 1 s. Every level must pass `npm run check-levels` (solvable, no bypass without rewinding).

Content Guidelines
- Levels: favor short, teachable challenges. A puzzle should be solvable in under a minute once understood.
- Audio: naturalistic and light. Provide mute and remember preference.
- Theme: dark/light parity. Ensure genre badges and HUD remain readable.

Future Ideas
- Memory: shareable Daily result; shapes/colours card set for colour-blind play; card-swap twist after mismatches.
- Checkers: openings explorer, timed mode.
- Tiny Utopia: events (rainy/dry seasons), visitors, artifacts that bend rules.
- Backspace: in‑browser level editor (text grid + tileset legend), inverse doors, echoes that can be knocked off their path.

Playtesting Notes
- Observe first‑run: does the player understand controls in 10 seconds?
- Can players recover quickly (restart, undo, rewind) without friction?
- Do sounds feel pleasant and never overwhelming?

