// Digger UI: canvas rendering, HUD, modal and input wiring
(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const restartBtn = document.getElementById("restart-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const pumpBtn = document.getElementById("pump-btn");
  const levelEl = document.getElementById("level");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const livesEl = document.getElementById("lives");
  const emeraldsEl = document.getElementById("emeralds");
  const monstersEl = document.getElementById("monsters");
  const statusEl = document.getElementById("status");

  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modal-title");
  const modalMessage = document.getElementById("modal-message");
  const modalNext = document.getElementById("modal-next");
  const modalRestart = document.getElementById("modal-restart");
  const modalLibrary = document.getElementById("modal-library");

  const game = new window.DiggerGame();
  const C = window.__DIGGER_CONST;
  const T = C.TILE;
  const isTouch = !!(window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);

  canvas.width = game.width;
  canvas.height = game.height;
  canvas.tabIndex = 0;
  setTimeout(() => canvas.focus(), 0);

  // ---- Storage (guarded: private windows can throw) ----
  function load(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch (_) { return fallback; } }
  function save(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} }

  let best = parseInt(load("digger.best", "0"), 10) || 0;
  let bestAtStart = best;
  bestEl.textContent = String(best);

  // ---- Status line: state-driven text plus short-lived messages ----
  let flash = null; // { text, until }
  function flashStatus(text, ms = 2500) { flash = { text, until: performance.now() + ms }; }
  function setStatus(text) { if (statusEl.textContent !== text) statusEl.textContent = text; }
  function updateStatus(now) {
    if (flash && now > flash.until) flash = null;
    if (game.paused) return setStatus("Paused");
    if (flash) return setStatus(flash.text);
    setStatus("");
  }

  // ---- Modal ----
  function modalOpen() { return !modal.classList.contains("hidden"); }
  function openModal(title, message, showNext) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalNext.classList.toggle("hidden", !showNext);
    modal.classList.remove("hidden");
    (showNext ? modalNext : modalRestart).focus();
  }
  function closeModal() {
    modal.classList.add("hidden");
    canvas.focus();
  }

  function restart() {
    closeModal();
    flash = null;
    releaseAll();
    bestAtStart = best;
    game.restart();
  }
  function goNext() {
    if (game.nextLevel()) { releaseAll(); closeModal(); }
  }

  // ---- HUD ----
  function renderLives(n) {
    livesEl.replaceChildren();
    for (let i = 0; i < Math.max(0, n); i++) {
      const s = document.createElement("span");
      s.className = "life-icon";
      livesEl.appendChild(s);
    }
    livesEl.setAttribute("aria-label", `${n} ${n === 1 ? "life" : "lives"}`);
  }

  game.on("level", (v) => (levelEl.textContent = String(v)));
  game.on("score", (v) => {
    scoreEl.textContent = String(v);
    if (v > best) { best = v; bestEl.textContent = String(best); save("digger.best", best); }
  });
  game.on("lives", renderLives);
  game.on("emeralds", (v) => (emeraldsEl.textContent = String(v)));
  game.on("monsters", (v) => (monstersEl.textContent = String(v)));

  // Floating score text, in tile coordinates
  const popups = [];
  game.on("popup", ({ x, y, text, kind }) => {
    popups.push({ x, y, text, kind, born: performance.now() });
    if (popups.length > 12) popups.shift();
  });
  game.on("status", (v) => flashStatus(v));
  game.on("pause", (p) => {
    pauseBtn.textContent = p ? "Resume (P)" : "Pause (P)";
    pauseBtn.setAttribute("aria-pressed", String(p));
  });
  game.on("win", ({ level, score, reason, final, nextLevel }) => {
    if (final) openModal("You Win!", `All ${C.MAX_LEVEL} levels cleared. Final score ${score}.${score > bestAtStart ? " New best!" : ""}`, false);
    else {
      const how = reason === "monsters" ? "Every monster cleared!" : "Every emerald collected!";
      openModal("Level Clear", `${how} Level ${level} complete — score ${score}. Ready for level ${nextLevel}?`, true);
    }
  });
  game.on("lose", ({ level, score }) => {
    openModal("Game Over", `You reached level ${level} with ${score} points.${score > bestAtStart ? " New best!" : ""}`, false);
  });

  // ---- Keyboard ----
  const held = { up: false, down: false, left: false, right: false };
  const KEY_DIR = {
    arrowup: "up", w: "up",
    arrowdown: "down", s: "down",
    arrowleft: "left", a: "left",
    arrowright: "right", d: "right",
  };
  const VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  let lastPressed = null;

  function releaseAll() {
    held.up = held.down = held.left = held.right = false;
    lastPressed = null;
    game.setDirection(0, 0);
  }

  function applyHeldDirection() {
    // The most recently pressed key wins while it is still held.
    if (lastPressed && held[lastPressed]) return game.setDirection(...VEC[lastPressed]);
    for (const d of ["up", "down", "left", "right"]) if (held[d]) return game.setDirection(...VEC[d]);
    game.setDirection(0, 0);
  }

  let restartArmedUntil = 0;
  function requestRestart() {
    const now = performance.now();
    if (!game.inProgress() || now < restartArmedUntil) { restartArmedUntil = 0; restart(); return; }
    restartArmedUntil = now + 1500;
    flashStatus("Press R again to restart", 1500);
  }

  function onKeyDown(e) {
    const k = (e.key || "").toLowerCase();
    if (k.startsWith("arrow")) e.preventDefault();

    if (modalOpen()) {
      if (k === "r") { restart(); e.preventDefault(); }
      else if (k === "enter" && !(document.activeElement instanceof HTMLButtonElement)) {
        e.preventDefault();
        if (!modalNext.classList.contains("hidden")) goNext(); else restart();
      }
      return; // focused buttons handle Enter/Space themselves
    }

    if (k === "r") { requestRestart(); return; }
    if (k === "p" || k === "escape") { game.togglePause(); return; }

    if (k === " " || e.code === "Space") {
      e.preventDefault();
      if (game.paused) game.setPaused(false);
      else game.firePump();
      return;
    }

    const d = KEY_DIR[k];
    if (!d) return;
    if (game.paused) game.setPaused(false);
    held[d] = true;
    if (!e.repeat) {
      lastPressed = d;
      game.nudge(...VEC[d]); // guarantees a step for quick taps
    }
    applyHeldDirection();
  }

  function onKeyUp(e) {
    const d = KEY_DIR[(e.key || "").toLowerCase()];
    if (!d) return;
    held[d] = false;
    applyHeldDirection();
  }

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp, { passive: false });

  // ---- Buttons / focus ----
  restartBtn.addEventListener("click", restart);
  modalRestart.addEventListener("click", restart);
  modalNext.addEventListener("click", goNext);
  modalLibrary.addEventListener("click", () => { window.location.href = "index.html"; });
  pauseBtn.addEventListener("click", () => { game.togglePause(); canvas.focus(); });
  canvas.addEventListener("click", () => { canvas.focus(); if (game.paused) game.setPaused(false); });

  // Auto-pause when the player looks away (and drop held keys, whose keyup we'll miss)
  document.addEventListener("visibilitychange", () => { if (document.hidden) { game.setPaused(true); releaseAll(); } });
  window.addEventListener("blur", () => { game.setPaused(true); releaseAll(); });

  // ---- Touch controls: joystick + pump button ----
  (function setupTouch() {
    if (!isTouch) return;
    const vjoy = document.getElementById("vjoy");
    const base = vjoy.querySelector(".vjoy-base");
    const stick = vjoy.querySelector(".vjoy-stick");
    const center = { x: 60, y: 60 };
    const maxRadius = 40;
    let dir = null;

    function setStick(dx, dy) {
      const r = Math.min(maxRadius, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      stick.style.transform = `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px))`;
    }
    function resetStick() { stick.style.transform = "translate(-50%, -50%)"; }
    function computeDir(dx, dy) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return null;
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
      return dy > 0 ? "down" : "up";
    }
    function onTouch(e) {
      const t = e.touches[0];
      if (!t) return;
      const rect = base.getBoundingClientRect();
      const dx = t.clientX - rect.left - center.x;
      const dy = t.clientY - rect.top - center.y;
      setStick(dx, dy);
      const nd = computeDir(dx, dy);
      if (nd !== dir) {
        dir = nd;
        if (dir) {
          if (game.paused) game.setPaused(false);
          game.nudge(...VEC[dir]);
          game.setDirection(...VEC[dir]);
        } else game.setDirection(0, 0);
      }
      e.preventDefault();
    }
    function onEnd() { dir = null; game.setDirection(0, 0); resetStick(); }
    base.addEventListener("touchstart", onTouch, { passive: false });
    base.addEventListener("touchmove", onTouch, { passive: false });
    base.addEventListener("touchend", onEnd, { passive: false });
    base.addEventListener("touchcancel", onEnd, { passive: false });
    resetStick();

    pumpBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (game.paused) game.setPaused(false);
      else game.firePump();
    });
  })();

  // ---- Rendering helpers ----
  const lerp = (a, b, t) => a + (b - a) * t;
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawField() {
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < C.ROWS; y++) {
      for (let x = 0; x < C.COLS; x++) {
        if (!game.dirt[y][x]) continue;
        const px = x * T, py = y * T;
        ctx.fillStyle = "#1e3a8a";
        ctx.fillRect(px, py, T, T);
        // a few fixed specks per tile for texture
        ctx.fillStyle = "rgba(147,197,253,0.18)";
        const h = (x * 73 + y * 151) % 997;
        ctx.fillRect(px + (h % 23) + 3, py + ((h >> 2) % 23) + 3, 3, 2);
        ctx.fillRect(px + ((h >> 3) % 23) + 3, py + ((h >> 5) % 23) + 3, 2, 2);
      }
    }
  }

  function drawEmeralds(now) {
    const tick = Math.floor(now / 120);
    for (const k of game.emeralds) {
      const [x, y] = k.split(",").map(Number);
      const cx = x * T + T / 2, cy = y * T + T / 2;
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.moveTo(cx, cy - 9); ctx.lineTo(cx + 8, cy); ctx.lineTo(cx, cy + 9); ctx.lineTo(cx - 8, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#bbf7d0";
      ctx.beginPath();
      ctx.moveTo(cx, cy - 9); ctx.lineTo(cx + 3, cy - 3); ctx.lineTo(cx - 3, cy - 3);
      ctx.closePath();
      ctx.fill();
      if ((x * 7 + y * 13 + tick) % 40 === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
      }
    }
  }

  function drawBag(b, bf) {
    const shake = b.shaking ? ((Math.floor(b.shakeTimer * 24) % 2 === 0) ? -2 : 2) : 0;
    const px = lerp(b.px, b.x, game.playerFrac()) * T + shake; // pushes move with the player
    const py = lerp(b.py, b.y, bf) * T;
    if (b.gold) {
      // a spilled pile of coins
      for (const [ox, oy] of [[10, 22], [22, 22], [16, 15]]) {
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath(); ctx.ellipse(px + ox, py + oy, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fde68a";
        ctx.beginPath(); ctx.ellipse(px + ox - 1, py + oy - 1, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }
    // sack body
    ctx.fillStyle = "#a16207";
    ctx.beginPath(); ctx.ellipse(px + 16, py + 19, 11, 11, 0, 0, Math.PI * 2); ctx.fill();
    // neck + tie
    ctx.fillStyle = "#854d0e";
    ctx.fillRect(px + 12, py + 4, 8, 6);
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(px + 11, py + 9, 10, 2);
    // shine
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath(); ctx.ellipse(px + 11, py + 16, 3, 5, -0.4, 0, Math.PI * 2); ctx.fill();
  }

  function drawMonster(m, mf) {
    const x = lerp(m.px, m.x, mf) * T, y = lerp(m.py, m.y, mf) * T;
    const stunned = m.stun > 0;
    // blink red/blue in the last half second before a stunned monster recovers
    const recovering = stunned && m.stun < 0.5 && Math.floor(performance.now() / 90) % 2 === 0;
    ctx.fillStyle = stunned && !recovering ? "#60a5fa" : "#ef4444";
    roundRect(x + 5, y + 5, T - 10, T - 8, 9);
    ctx.fill();
    if (stunned) {
      // dizzy stars orbiting the head
      const a = performance.now() / 200;
      ctx.fillStyle = "#fde047";
      for (let i = 0; i < 3; i++) {
        const t = a + (i * Math.PI * 2) / 3;
        ctx.fillRect(x + 16 + Math.cos(t) * 10 - 1.5, y + 4 + Math.sin(t) * 3 - 1.5, 3, 3);
      }
    }
    // jagged feet
    ctx.fillStyle = "#020617";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 9 + i * 7, y + T - 3);
      ctx.lineTo(x + 12 + i * 7, y + T - 8);
      ctx.lineTo(x + 15 + i * 7, y + T - 3);
      ctx.fill();
    }
    // eyes looking at the player
    const lx = Math.sign(game.player.x - m.x) * 1.5;
    const ly = Math.sign(game.player.y - m.y) * 1.5;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x + 9, y + 10, 6, 6);
    ctx.fillRect(x + 17, y + 10, 6, 6);
    ctx.fillStyle = "#111827";
    ctx.fillRect(x + 11 + lx, y + 12 + ly, 2, 2);
    ctx.fillRect(x + 19 + lx, y + 12 + ly, 2, 2);
  }

  function playerPos() {
    const p = game.player;
    const f = game.state === "playing" ? game.playerFrac() : 1;
    return { x: lerp(p.px, p.x, f) * T, y: lerp(p.py, p.y, f) * T };
  }

  function drawPump() {
    if (!game.pump) return;
    const pp = playerPos();
    const d = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }[game.pump.dir];
    const cx = pp.x + T / 2, cy = pp.y + T / 2;
    const len = game.pump.len * T;
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + d[0] * 14, cy + d[1] * 14);
    ctx.lineTo(cx + d[0] * len, cy + d[1] * len);
    ctx.stroke();
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(cx + d[0] * len, cy + d[1] * len, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const FACING_ANGLE = { right: 0, down: Math.PI / 2, left: 0, up: -Math.PI / 2 };

  function drawPlayer(now) {
    const pp = playerPos();
    const facing = game.lastFacing;
    let scale = 1, alpha = 1, spin = 0;
    if (game.state === "dying") {
      const t = Math.max(0, game.deathTimer); // 1 → 0
      scale = 0.3 + 0.7 * t;
      spin = (1 - t) * Math.PI * 4;
      alpha = 0.4 + 0.6 * t;
    } else if (game.invuln > 0 && Math.floor(now / 100) % 2 === 0) {
      alpha = 0.35;
    }
    if (game.state === "gameOver") return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(pp.x + T / 2, pp.y + T / 2);
    ctx.rotate(FACING_ANGLE[facing] + spin);
    if (facing === "left") ctx.scale(-1, 1);
    ctx.scale(scale, scale);

    // treads
    ctx.fillStyle = "#334155";
    roundRect(-12, 5, 20, 7, 3);
    ctx.fill();
    ctx.fillStyle = "#64748b";
    for (let i = 0; i < 4; i++) ctx.fillRect(-10 + i * 5, 7, 2, 3);
    // body
    ctx.fillStyle = "#22d3ee";
    roundRect(-12, -10, 19, 16, 4);
    ctx.fill();
    // cab window
    ctx.fillStyle = "#0e7490";
    ctx.fillRect(-9, -7, 7, 6);
    // drill: always points the way the pump will fire
    ctx.fillStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(7, -7);
    ctx.lineTo(15, -1);
    ctx.lineTo(7, 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(9, -4); ctx.lineTo(11, 2);
    ctx.moveTo(11, -3); ctx.lineTo(13, 0);
    ctx.stroke();

    ctx.restore();
  }

  function drawOverlay() {
    let title = null, color = "#fde047";
    const subs = [];
    if (game.paused) {
      title = "PAUSED";
      subs.push(isTouch ? "Tap the screen or move to resume" : "P / Esc to resume");
      color = "#f8fafc";
    } else if (game.state === "ready" && game.readyTimer === null) {
      title = isTouch ? "MOVE TO START" : "PRESS AN ARROW KEY";
      subs.push(isTouch
        ? `Level ${game.level} · Joystick digs · PUMP stuns, again pops`
        : `Level ${game.level} · Arrows/WASD dig · Space pumps · P pauses`);
      subs.push("Grab every emerald or beat every monster · Push bags sideways");
    } else if (game.state === "ready") {
      title = "READY!";
      subs.push(`${game.lives} ${game.lives === 1 ? "life" : "lives"} left`);
    }
    if (!title) return;

    const cy = game.height / 2;
    const h = 44 + subs.length * 20;
    const top = cy - h / 2;
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, top, game.width, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.font = "bold 22px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillText(title, game.width / 2, top + 24);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "13px ui-monospace, Menlo, Consolas, monospace";
    subs.forEach((s, i) => ctx.fillText(s, game.width / 2, top + 50 + i * 20));
  }

  function drawNest(now) {
    const n = game.nest();
    const cx = n.x * T + T / 2, cy = n.y * T + T / 2;
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, T * 0.9);
    glow.addColorStop(0, `rgba(239,68,68,${0.25 + 0.15 * pulse + n.flash})`);
    glow.addColorStop(1, "rgba(239,68,68,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - T, cy - T, T * 2, T * 2);
  }

  function drawPumpCharge() {
    const c = game.pumpCharge();
    if (c >= 1 || game.state !== "playing") return;
    const pp = playerPos();
    ctx.strokeStyle = "rgba(251,191,36,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pp.x + T / 2, pp.y + T / 2, T / 2 + 1, -Math.PI / 2, -Math.PI / 2 + c * Math.PI * 2);
    ctx.stroke();
  }

  const POPUP_MS = 900;
  const POPUP_COLOR = { streak: "#86efac", gold: "#fbbf24", kill: "#fca5a5" };
  function drawPopups(now) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 13px ui-monospace, Menlo, Consolas, monospace";
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      const t = (now - p.born) / POPUP_MS;
      if (t >= 1) { popups.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = "#020617";
      const x = p.x * T + T / 2, y = p.y * T + T / 2 - t * 24;
      ctx.fillText(p.text, x + 1, y + 1);
      ctx.fillStyle = POPUP_COLOR[p.kind] || "#f8fafc";
      ctx.fillText(p.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  let pumpWasReady = null;
  function syncPumpButton() {
    const ready = game.pumpReady();
    if (ready === pumpWasReady) return;
    pumpWasReady = ready;
    pumpBtn.classList.toggle("cooling", !ready);
  }

  function render(now) {
    drawField();
    drawNest(now);
    drawEmeralds(now);
    const bf = game.bagFrac();
    for (const b of game.bags) drawBag(b, bf);
    const mf = game.monsterFrac();
    for (const m of game.monsters) if (m.alive) drawMonster(m, mf);
    drawPump();
    drawPlayer(now);
    drawPumpCharge();
    drawPopups(now);
    drawOverlay();
  }

  // ---- Main loop ----
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.step(dt);
    updateStatus(now);
    if (isTouch) syncPumpButton();
    render(now);
    requestAnimationFrame(loop);
  }

  renderLives(game.lives);
  emeraldsEl.textContent = String(game.emeralds.size);
  monstersEl.textContent = String(game.monstersLeft());
  requestAnimationFrame(loop);
})();
