// Volfied UI: canvas rendering, HUD, modal, sound and input wiring
(function () {
  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const restartBtn = $("restart-btn");
  const pauseBtn = $("pause-btn");
  const soundBtn = $("sound-btn");
  const levelEl = $("level");
  const captureEl = $("capture");
  const targetEl = $("target");
  const progressEl = $("progress");
  const progressFill = progressEl.querySelector(".vf-progress-fill");
  const progressMark = progressEl.querySelector(".vf-progress-mark");
  const livesEl = $("lives");
  const scoreEl = $("score");
  const bestEl = $("best");
  const statusEl = $("status");
  const dpad = $("dpad");

  const modal = $("modal");
  const modalTitle = $("modal-title");
  const modalMessage = $("modal-message");
  const modalNext = $("modal-next");
  const modalRestart = $("modal-restart");
  const modalLibrary = $("modal-library");

  const game = new window.VolfiedGame();
  const C = window.__VOLFIED_CONST;
  const CELL = C.CELL;
  const isTouch = !!(window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  canvas.width = game.width;
  canvas.height = game.height;
  canvas.tabIndex = 0;
  setTimeout(() => canvas.focus(), 0);

  // ---- Storage (guarded: private windows can throw) ----
  function load(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch (_) { return fallback; } }
  function save(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} }

  let best = parseInt(load("volfied.best", "0"), 10) || 0;
  let bestAtStart = best;
  bestEl.textContent = String(best);

  // ---- Status line: short-lived messages, "Paused" while paused ----
  let flash = null; // { text, until }
  function flashStatus(text, ms = 2500) { flash = { text, until: performance.now() + ms }; }
  function setStatus(text) { if (statusEl.textContent !== text) statusEl.textContent = text; }
  function updateStatus(now) {
    if (flash && now > flash.until) flash = null;
    if (game.paused) return setStatus("Paused");
    setStatus(flash ? flash.text : "");
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
  // Let the capture / death effects play before the dialog covers them.
  let modalTimer = null;
  function openModalSoon(...args) {
    clearTimeout(modalTimer);
    modalTimer = setTimeout(() => openModal(...args), 900);
  }

  function restart() {
    clearTimeout(modalTimer);
    closeModal();
    flash = null;
    releaseAll();
    particles.length = 0;
    popups.length = 0;
    fills.length = 0;
    bestAtStart = best;
    game.restart();
  }
  function goNext() {
    clearTimeout(modalTimer);
    if (game.nextLevel()) {
      releaseAll();
      fills.length = 0;
      closeModal();
    }
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
  function renderCapture(v) {
    const t = game.target;
    captureEl.textContent = String(v);
    targetEl.textContent = String(t);
    progressFill.style.width = `${Math.min(100, v)}%`;
    progressMark.style.left = `${t}%`;
    progressEl.classList.toggle("done", v >= t);
    progressEl.setAttribute("aria-valuenow", String(v));
    progressEl.setAttribute("aria-valuetext", `${v}% of ${t}% target`);
  }

  game.on("level", (v) => { levelEl.textContent = String(v); renderCapture(game.capturePercent); });
  game.on("capture", renderCapture);
  game.on("lives", renderLives);
  game.on("score", (v) => {
    scoreEl.textContent = String(v);
    if (v > best) { best = v; bestEl.textContent = String(best); save("volfied.best", best); }
  });
  game.on("status", (v) => flashStatus(v));
  game.on("pause", (p) => {
    pauseBtn.textContent = p ? "Resume (P)" : "Pause (P)";
    pauseBtn.setAttribute("aria-pressed", String(p));
    if (p) releaseAll();
  });
  game.on("win", ({ capture, score, level, time, bonus, final, nextLevel }) => {
    const parts = [];
    if (bonus.overshoot) parts.push(`over target +${bonus.overshoot}`);
    if (bonus.time) parts.push(`time +${bonus.time}`);
    if (bonus.perfect) parts.push(`no lives lost +${bonus.perfect}`);
    const bonusText = parts.length ? ` Bonus: ${parts.join(", ")}.` : "";
    const head = `${capture}% captured in ${Math.round(time)}s.${bonusText}`;
    if (final) {
      const newBest = score > bestAtStart ? " New best!" : "";
      openModalSoon("All Sectors Clear", `${head} You cleared all ${C.MAX_LEVEL} levels! Final score: ${score}.${newBest}`, false);
    } else {
      openModalSoon(`Level ${level} Cleared`, `${head} Score ${score}. Next: level ${nextLevel}, ${window.VolfiedArt.sceneName(nextLevel)}.`, true);
    }
  });
  game.on("lose", ({ capture, score, level }) => {
    openModalSoon("Game Over", `Stopped on level ${level} at ${capture}% captured with ${score} points.${score > bestAtStart ? " New best!" : ""}`, false);
  });

  // ---- Sound (Web Audio, off by default like the rest of the library) ----
  let audioCtx = null, master = null, soundOn = load("volfied.sound", "0") === "1";
  function ensureAudio() {
    if (!soundOn) return;
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        master = audioCtx.createGain();
        master.gain.value = 0.06;
        master.connect(audioCtx.destination);
      } catch (_) { audioCtx = null; return; }
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }
  function tone(freq, dur, type = "square", vol = 1, slideTo = null, delay = 0) {
    if (!soundOn || !audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  let noiseBuf = null;
  function noise(dur, vol = 1, cutoff = 1200, delay = 0) {
    if (!soundOn || !audioCtx) return;
    if (!noiseBuf) {
      noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.5, audioCtx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = audioCtx.currentTime + delay;
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuf;
    const f = audioCtx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = cutoff;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }
  const arp = (notes, step, len, type = "square", vol = 0.7) =>
    notes.forEach((f, i) => tone(f, len, type, vol, null, i * step));
  let drawTick = 0;
  const SFX = {
    startDraw: () => tone(440, 0.06, "square", 0.4, 660),
    draw: () => { drawTick = (drawTick + 1) % 2; tone(drawTick ? 300 : 340, 0.03, "triangle", 0.25); },
    capture: (e) => {
      const n = Math.max(2, Math.min(6, 2 + Math.round(e.gained / 4)));
      arp([523, 659, 784, 1046, 1318, 1568].slice(0, n), 0.05, 0.1, "square", 0.55);
      if (e.mult > 1) arp([1568, 2093], 0.07, 0.12, "triangle", 0.6);
    },
    fuseLit: () => noise(0.25, 0.5, 3000),
    minionKill: () => { tone(900, 0.18, "square", 0.6, 120); noise(0.15, 0.4, 1500); },
    powerSpawn: () => arp([880, 1175], 0.06, 0.08, "triangle", 0.4),
    powerGet: () => arp([784, 988, 1175, 1568], 0.05, 0.1, "triangle", 0.7),
    powerEnd: () => tone(600, 0.15, "triangle", 0.4, 300),
    powerExpire: () => tone(500, 0.12, "triangle", 0.3, 250),
    extraLife: () => arp([659, 784, 988, 1318, 1568, 1976], 0.06, 0.1, "square", 0.6),
    death: () => tone(700, 0.8, "square", 0.55, 70),
    respawn: () => tone(330, 0.1, "triangle", 0.5, 660),
    clear: () => arp([523, 659, 784, 1046, 1318], 0.09, 0.14, "square", 0.6),
    gameOver: () => arp([392, 330, 262, 196], 0.18, 0.22, "triangle", 0.8),
  };
  // Continuous sizzle while the fuse is advancing.
  let sizzleAt = 0, lastFusePos = 0;
  function fuseSound(now) {
    const pos = game.fuse ? game.fuse.pos : 0;
    if (game.fuse && pos > lastFusePos && now > sizzleAt) {
      noise(0.07, 0.3, 4000);
      sizzleAt = now + 90;
    }
    lastFusePos = pos;
  }
  function setSound(on, quiet = false) {
    soundOn = !!on;
    save("volfied.sound", soundOn ? "1" : "0");
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    soundBtn.textContent = soundOn ? "Sound: On" : "Sound: Off";
    if (soundOn && !quiet) { ensureAudio(); tone(880, 0.08, "square", 0.5); }
  }
  setSound(soundOn, true);
  soundBtn.addEventListener("click", () => { setSound(!soundOn); canvas.focus(); });
  // Browsers only allow audio after a user gesture.
  window.addEventListener("pointerdown", ensureAudio, { passive: true });
  window.addEventListener("keydown", ensureAudio, { passive: true });

  // ---- Effects: capture fill sweep, particles, popups, shake ----
  const fills = [];     // { cells, ox, oy, born, maxD }
  const particles = [];
  const popups = [];    // { x, y, text, born } in pixels
  let shakeAmp = 0;
  let deathFlashUntil = 0;
  const px = (c) => (c + 0.5) * CELL; // cell index → pixel centre

  function burstAt(x, y, color, count, speed = 90, size = 3) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.35 + Math.random() * 0.4, color, size });
    }
    if (particles.length > 500) particles.splice(0, particles.length - 500);
  }
  function shake(amount) { if (!reduceMotion) shakeAmp = Math.max(shakeAmp, amount); }
  function popup(x, y, text, color, big) {
    // Keep labels inside the playfield.
    x = Math.max(40, Math.min(game.width - 40, x));
    y = Math.max(30, Math.min(game.height - 20, y));
    popups.push({ x, y, text, color, big, born: performance.now() });
    if (popups.length > 10) popups.shift();
  }
  const POWER_STYLE = {
    freeze: { color: "#7dd3fc", glyph: "❄", short: "FREEZE" },
    speed: { color: "#facc15", glyph: "»", short: "SPEED" },
    shield: { color: "#4ade80", glyph: "◆", short: "SHIELD" },
    life: { color: "#f472b6", glyph: "+", short: "1UP" },
  };

  const FX = {
    startDraw: (e) => burstAt(px(e.x), px(e.y), "#67e8f9", 5, 50, 2),
    capture: (e) => {
      if (e.cells.length) {
        let maxD = 1;
        for (const [x, y] of e.cells) maxD = Math.max(maxD, Math.hypot(x - e.endX, y - e.endY));
        fills.push({ cells: e.cells, ox: e.endX, oy: e.endY, born: performance.now(), maxD });
      }
      for (let i = 0; i < e.trail.length; i += 3) burstAt(px(e.trail[i][0]), px(e.trail[i][1]), "#a5f3fc", 2, 40, 2);
      if (e.gained > 0) popup(px(e.x), px(e.y), e.mult > 1 ? `+${e.gained}% ×${e.mult}` : `+${e.gained}%`, e.mult > 1 ? "#fde047" : "#a5f3fc", e.mult > 1);
      if (e.gained >= 10) shake(2);
    },
    minionKill: (e) => {
      burstAt(px(e.x), px(e.y), "#f43f5e", 22, 160);
      burstAt(px(e.x), px(e.y), "#fecdd3", 8, 80);
      popup(px(e.x), px(e.y) - 10, `+${e.points}`, "#fda4af", true);
      shake(3);
    },
    powerSpawn: (e) => burstAt(px(e.x), px(e.y), POWER_STYLE[e.kind].color, 12, 80),
    powerGet: (e) => {
      burstAt(px(e.x), px(e.y), POWER_STYLE[e.kind].color, 24, 150);
      popup(px(e.x), px(e.y) - 12, e.label.toUpperCase(), POWER_STYLE[e.kind].color, true);
    },
    powerExpire: (e) => burstAt(px(e.x), px(e.y), "#64748b", 8, 50),
    extraLife: (e) => {
      burstAt(px(e.x), px(e.y), "#22d3ee", 18, 130);
      popup(px(e.x), px(e.y) - 14, "1UP", "#4ade80", true);
      flashStatus("Extra life!");
    },
    death: (e) => {
      burstAt(px(e.x), px(e.y), "#22d3ee", 26, 170);
      for (let i = 0; i < e.trail.length; i += 2) burstAt(px(e.trail[i][0]), px(e.trail[i][1]), "#f43f5e", 2, 60, 2);
      shake(6);
      deathFlashUntil = performance.now() + 160;
    },
    respawn: (e) => burstAt(px(e.x), px(e.y), "#67e8f9", 14, 90),
    clear: () => shake(3),
  };
  game.on("event", (e) => {
    if (SFX[e.type]) SFX[e.type](e);
    if (FX[e.type]) FX[e.type](e);
  });

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    shakeAmp = shakeAmp > 0.1 ? shakeAmp * Math.pow(0.002, dt) : 0;
  }

  // ---- Keyboard: hold to move, most recent key wins ----
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
    if (dpad) dpad.querySelectorAll(".on").forEach((b) => b.classList.remove("on"));
  }
  function applyHeldDirection() {
    if (lastPressed && held[lastPressed]) return game.setDirection(...VEC[lastPressed]);
    for (const d of ["up", "down", "left", "right"]) if (held[d]) return game.setDirection(...VEC[d]);
    game.setDirection(0, 0);
  }
  function press(d) {
    if (game.paused) game.setPaused(false);
    held[d] = true;
    lastPressed = d;
    game.nudge(...VEC[d]);
    applyHeldDirection();
  }
  function release(d) {
    held[d] = false;
    applyHeldDirection();
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
    if (k.startsWith("arrow") || k === " ") e.preventDefault();

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
    if (k === "m") { setSound(!soundOn); return; }
    if (k === " " && game.paused) { game.setPaused(false); return; }

    const d = KEY_DIR[k];
    if (!d) return;
    if (e.repeat) { held[d] = true; applyHeldDirection(); return; }
    press(d);
  }
  function onKeyUp(e) {
    const d = KEY_DIR[(e.key || "").toLowerCase()];
    if (d) release(d);
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

  // Auto-pause when the player looks away (and drop held keys, whose keyup we'll miss).
  function autoPause() {
    releaseAll();
    if (game.state === "playing" || game.state === "dying") game.setPaused(true);
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) autoPause(); });
  window.addEventListener("blur", autoPause);

  // ---- Touch D-pad: hold a button to move, slide between buttons to turn ----
  if (dpad) {
    let activePointer = null;
    let touchDir = null;
    function dirAt(x, y) {
      const el = document.elementFromPoint(x, y);
      const b = el && el.closest && el.closest("#dpad button[data-dir]");
      return b ? b.dataset.dir : null;
    }
    function setTouchDir(d) {
      if (d === touchDir) return;
      if (touchDir) release(touchDir);
      dpad.querySelectorAll(".on").forEach((b) => b.classList.remove("on"));
      touchDir = d;
      if (d) {
        press(d);
        const b = dpad.querySelector(`button[data-dir="${d}"]`);
        if (b) b.classList.add("on");
      }
    }
    dpad.addEventListener("pointerdown", (e) => {
      const d = dirAt(e.clientX, e.clientY);
      if (!d) return;
      e.preventDefault();
      activePointer = e.pointerId;
      try { dpad.setPointerCapture(e.pointerId); } catch (_) {}
      setTouchDir(d);
    });
    dpad.addEventListener("pointermove", (e) => {
      if (e.pointerId !== activePointer) return;
      const d = dirAt(e.clientX, e.clientY);
      if (d) setTouchDir(d);
    });
    const end = (e) => {
      if (e.pointerId !== activePointer) return;
      activePointer = null;
      setTouchDir(null);
    };
    dpad.addEventListener("pointerup", end);
    dpad.addEventListener("pointercancel", end);
    dpad.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ---- Rendering ----
  // Cool colours are yours (player, line); warm colours are enemies.
  const COLORS = {
    void: "#04060d",
    voidDot: "rgba(148, 163, 184, 0.10)",
    edge: "#38bdf8",
    trail: [103, 232, 249], // #67e8f9
    player: "#e0fbff",
    playerGlow: "rgba(34, 211, 238, 0.45)",
    enemies: [
      { body: "#f97316", core: "#fed7aa", glow: "rgba(249, 115, 22, 0.35)" },
      { body: "#f43f5e", core: "#fecdd3", glow: "rgba(244, 63, 94, 0.35)" },
      { body: "#e879f9", core: "#fae8ff", glow: "rgba(232, 121, 249, 0.35)" },
    ],
  };

  // Territory changes only on capture / level start, so draw it once into a layer:
  // open space is dark with a faint dot grid; claimed land shows the level's picture,
  // outlined where it meets open space.
  const layer = document.createElement("canvas");
  layer.width = canvas.width;
  layer.height = canvas.height;
  const lctx = layer.getContext("2d");
  function redrawLayer() {
    const W = C.GRID_W, H = C.GRID_H, cl = game.claimed;
    lctx.fillStyle = COLORS.void;
    lctx.fillRect(0, 0, layer.width, layer.height);
    lctx.fillStyle = COLORS.voidDot;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (!cl[y][x]) lctx.fillRect(x * CELL + 3, y * CELL + 3, 1, 1);

    lctx.save();
    lctx.beginPath();
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        if (!cl[y][x]) { x++; continue; }
        const x0 = x;
        while (x < W && cl[y][x]) x++;
        lctx.rect(x0 * CELL, y * CELL, (x - x0) * CELL, CELL);
      }
    }
    lctx.clip();
    lctx.drawImage(window.VolfiedArt.scene(game.level, layer.width, layer.height), 0, 0);
    lctx.restore();

    const open = (x, y) => x >= 0 && x < W && y >= 0 && y < H && !cl[y][x];
    lctx.beginPath();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!cl[y][x]) continue;
        const X = x * CELL, Y = y * CELL;
        if (open(x, y - 1)) { lctx.moveTo(X, Y + 0.5); lctx.lineTo(X + CELL, Y + 0.5); }
        if (open(x, y + 1)) { lctx.moveTo(X, Y + CELL - 0.5); lctx.lineTo(X + CELL, Y + CELL - 0.5); }
        if (open(x - 1, y)) { lctx.moveTo(X + 0.5, Y); lctx.lineTo(X + 0.5, Y + CELL); }
        if (open(x + 1, y)) { lctx.moveTo(X + CELL - 0.5, Y); lctx.lineTo(X + CELL - 0.5, Y + CELL); }
      }
    }
    lctx.lineWidth = 1;
    lctx.strokeStyle = COLORS.edge;
    lctx.shadowColor = COLORS.edge;
    lctx.shadowBlur = 6;
    lctx.stroke();
    lctx.shadowBlur = 0;
  }
  game.on("field", redrawLayer);
  redrawLayer();

  const BOSS = { body: "#dc2626", core: "#fef2f2", glow: "rgba(220, 38, 38, 0.35)", spikes: "#fb923c" };
  const PATROL = { body: "#fbbf24", glow: "rgba(251, 191, 36, 0.35)" };
  const FROZEN = { body: "#7dd3fc", core: "#f0f9ff", glow: "rgba(125, 211, 252, 0.35)", spikes: "#bae6fd" };
  const minionPal = (i) => COLORS.enemies[i % COLORS.enemies.length];

  // Level clear: the rest of the picture fades in and the enemies burst.
  let clearAt = 0;
  game.on("event", (e) => {
    if (e.type !== "clear") return;
    clearAt = performance.now();
    game.enemies.forEach((en, i) => burstAt(px(en.x), px(en.y), en.kind === "boss" ? BOSS.body : minionPal(i).body, en.kind === "boss" ? 40 : 18, 140));
    game.patrollers.forEach((p) => burstAt(px(p.x), px(p.y), PATROL.body, 12, 100));
  });
  game.on("field", () => { clearAt = 0; });

  /** 0 (safe) … 1 (an enemy is about to touch the line). */
  function lineDanger() {
    if (!game.isDrawing || !game.trailPath.length) return 0;
    let best = Infinity;
    for (const e of game.enemies) {
      const r = e.r || C.MINION_R;
      for (const [x, y] of game.trailPath) {
        const d = Math.hypot(e.x - x, e.y - y) - r;
        if (d < best) best = d;
      }
    }
    return Math.max(0, Math.min(1, (6 - best) / 6));
  }

  function drawFills(now) {
    const SWEEP = 0.35, FADE = 0.45;
    for (let i = fills.length - 1; i >= 0; i--) {
      const f = fills[i];
      const t = (now - f.born) / 1000;
      if (t > SWEEP + FADE) { fills.splice(i, 1); continue; }
      ctx.fillStyle = "#e0f2fe";
      for (const [x, y] of f.cells) {
        const local = t - (Math.hypot(x - f.ox, y - f.oy) / f.maxD) * SWEEP;
        if (local < 0) continue;
        const a = 0.55 * (1 - local / FADE);
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    ctx.globalAlpha = 1;
  }

  function fillPath(path, from, to) {
    for (let i = from; i <= to && i < path.length; i++) {
      const [x, y] = path[i];
      ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      if (i > from) {
        // Join neighbouring cells so the line reads as one stroke.
        const [x0, y0] = path[i - 1];
        ctx.fillRect(Math.min(x0, x) * CELL + 1, Math.min(y0, y) * CELL + 1,
          (Math.abs(x - x0) + 1) * CELL - 2, (Math.abs(y - y0) + 1) * CELL - 2);
      }
    }
  }

  function drawTrail(now) {
    const path = game.trailPath;
    if (!path.length) return;
    let [r, g, b] = COLORS.trail;
    let alpha = 1;
    if (game.state === "dying") {
      [r, g, b] = [244, 63, 94];
      alpha = Math.floor(now / 90) % 2 ? 0.25 : 1;
    } else if (game.effects.shield > 0) {
      [r, g, b] = [134, 239, 172];
    } else {
      // Pulse toward white, faster as an enemy closes in on the line.
      const danger = lineDanger();
      if (danger > 0) {
        const k = danger * (0.5 + 0.5 * Math.sin(now / (90 - danger * 50)));
        r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k;
      }
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
    fillPath(path, 0, path.length - 1);

    // Fuse: the burned part goes dark and a spark races toward the player.
    const fuse = game.fuse;
    if (fuse && game.state === "playing") {
      const i = Math.min(path.length - 1, Math.floor(fuse.pos));
      ctx.fillStyle = "#334155";
      fillPath(path, 0, i);
      const [ax, ay] = path[i];
      const [bx, by] = path[Math.min(path.length - 1, i + 1)];
      const f = fuse.pos - i;
      const sx = px(ax + (bx - ax) * f), sy = px(ay + (by - ay) * f);
      ctx.fillStyle = "rgba(253, 224, 71, 0.35)";
      ctx.beginPath(); ctx.arc(sx, sy, 7 + Math.random() * 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fffbeb";
      ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
      if (!game.paused && Math.random() < 0.7) burstAt(sx, sy, Math.random() < 0.5 ? "#fde047" : "#fb923c", 1, 70, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawMinion(enemy, idx, now, frozen, live) {
    const pal = frozen ? FROZEN : minionPal(idx);
    const R = (enemy.r || C.MINION_R) * CELL; // drawn at the true hit radius
    const x = px(enemy.x), y = px(enemy.y);
    const pulse = 1 + 0.12 * Math.sin(now / 160 + idx);
    ctx.fillStyle = pal.glow;
    ctx.beginPath();
    ctx.arc(x, y, R * 2.1 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4 + idx * 0.7 + (live ? now / 300 : 0));
    ctx.fillStyle = pal.body;
    const s = R * 0.85; // half-side; corners reach ~1.2R, edges ~0.85R — averages the hit radius
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.fillStyle = pal.core;
    ctx.fillRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8);
    ctx.restore();
  }

  function drawBoss(enemy, now, frozen, live) {
    const pal = frozen ? FROZEN : BOSS;
    const R = (enemy.r || C.BOSS_R) * CELL;
    const x = px(enemy.x), y = px(enemy.y);
    const t = live ? now : 0;
    ctx.fillStyle = pal.glow;
    ctx.beginPath();
    ctx.arc(x, y, R * 2.2 * (1 + 0.1 * Math.sin(now / 220)), 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    // Spikes (counter-rotating) behind a hexagonal body.
    ctx.rotate(-t / 500);
    ctx.fillStyle = pal.spikes;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rr = i % 2 ? R * 0.75 : R * 1.35;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.rotate(t / 250);
    ctx.fillStyle = pal.body;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = pal.core;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.35 * (1 + 0.2 * Math.sin(now / 120)), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemies(now) {
    const frozen = game.effects.freeze > 0;
    const live = game.state === "playing" && !game.paused && !frozen;
    let m = 0;
    for (const e of game.enemies) {
      if (e.kind === "boss") drawBoss(e, now, frozen, live);
      else drawMinion(e, m++, now, frozen, live);
    }
  }

  function drawPatrollers(now) {
    const frozen = game.effects.freeze > 0;
    for (const p of game.patrollers) {
      const x = px(p.x), y = px(p.y);
      ctx.fillStyle = frozen ? FROZEN.glow : PATROL.glow;
      ctx.fillRect(px(p.px) - 3, px(p.py) - 3, 6, 6); // afterimage on the previous cell
      ctx.beginPath();
      ctx.arc(x, y, CELL * (1.1 + 0.15 * Math.sin(now / 90)), 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(frozen ? 0 : now / 120);
      ctx.fillStyle = frozen ? FROZEN.body : PATROL.body;
      ctx.fillRect(-CELL * 0.6, -1.5, CELL * 1.2, 3);
      ctx.fillRect(-1.5, -CELL * 0.6, 3, CELL * 1.2);
      ctx.fillStyle = "#fffbeb";
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPowerup(now) {
    const p = game.powerup;
    if (!p) return;
    if (p.ttl < 3 && Math.floor(now / 120) % 2) return; // blink before it vanishes
    const st = POWER_STYLE[p.kind];
    const x = px(p.x), y = px(p.y);
    const s = 9 * (1 + 0.08 * Math.sin(now / 150));
    ctx.fillStyle = st.color;
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.arc(x, y, s * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // Ring shows how long it stays.
    ctx.strokeStyle = st.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, s * 1.6, -Math.PI / 2, -Math.PI / 2 + (p.ttl / p.max) * Math.PI * 2);
    ctx.stroke();
    roundRect(x - s, y - s, s * 2, s * 2, 4);
    ctx.fillStyle = "#020617";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = st.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 13px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillText(st.glyph, x, y + 1);
  }

  function drawPlayer(now) {
    if (game.state === "dying") return;
    const blinking = game.state === "ready" || game.safeTimer > 0;
    if (blinking && Math.floor(now / (game.state === "ready" ? 300 : 100)) % 2) return;
    const x = game.player.x * CELL, y = game.player.y * CELL;
    ctx.fillStyle = COLORS.playerGlow;
    ctx.fillRect(x - 3, y - 3, CELL + 6, CELL + 6);
    ctx.fillStyle = "#020617"; // dark rim keeps the player readable over bright pictures
    ctx.fillRect(x - 1, y - 1, CELL + 2, CELL + 2);
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.fillStyle = game.effects.speed > 0 ? "#facc15" : "#22d3ee";
    ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    if (game.effects.shield > 0) {
      ctx.strokeStyle = "#4ade80";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.lineDashOffset = -now / 40;
      ctx.beginPath();
      ctx.arc(x + CELL / 2, y + CELL / 2, CELL * 1.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawEffectPills() {
    let x = 12;
    ctx.font = "bold 11px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const k of ["freeze", "speed", "shield"]) {
      const left = game.effects[k];
      if (!(left > 0)) continue;
      const st = POWER_STYLE[k];
      const text = `${st.short} ${left.toFixed(1)}`;
      const w = ctx.measureText(text).width + 16;
      roundRect(x, 12, w, 18, 9);
      ctx.fillStyle = "rgba(2, 6, 23, 0.8)";
      ctx.fill();
      ctx.strokeStyle = st.color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = st.color;
      ctx.fillText(text, x + 8, 21.5);
      x += w + 6;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups(now) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      const t = (now - p.born) / 1000;
      if (t > 1.2) { popups.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, 2.5 * (1.2 - t));
      ctx.font = `bold ${p.big ? 20 : 16}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = "#020617";
      ctx.fillText(p.text, p.x + 1, p.y - t * 30 + 1);
      ctx.fillStyle = p.color || "#a5f3fc";
      ctx.fillText(p.text, p.x, p.y - t * 30);
    }
    ctx.globalAlpha = 1;
  }

  const LEVEL_TIPS = [
    "Stop mid-line and a fuse burns toward you · keep moving",
    "NEW: minions · enclose them on the captured side to destroy them",
    "NEW: patrollers crawl the edges and can catch you there",
    "Power-ups appear in open space · enclose one to collect it",
    "Final sector · every threat at once",
  ];

  function drawOverlay() {
    let title = null, color = "#fde047";
    const subs = [];
    if (game.paused) {
      title = "PAUSED";
      subs.push(isTouch ? "Tap the screen or the pad to resume" : "P / Esc to resume");
      color = "#f8fafc";
    } else if (game.state === "ready") {
      const cfg = game.levelConfig;
      const foes = ["1 boss"];
      if (cfg.minions) foes.push(`${cfg.minions} minions`);
      if (cfg.patrollers) foes.push(`${cfg.patrollers} patroller${cfg.patrollers > 1 ? "s" : ""}`);
      title = `LEVEL ${game.level} / ${C.MAX_LEVEL} · ${window.VolfiedArt.sceneName(game.level).toUpperCase()}`;
      subs.push(`Claim ${game.target}% · ${foes.join(" + ")}`);
      subs.push(isTouch ? "Hold the pad to move and cut lines" : "Hold Arrows/WASD to move · P pauses · M sound");
      subs.push("Cut from the edge · the side without the boss becomes yours");
      subs.push("Anything touching your line costs a life");
      subs.push(LEVEL_TIPS[(game.level - 1) % LEVEL_TIPS.length]);
    } else if (game.state === "dying") {
      title = game.lives > 0 ? `${game.lives} ${game.lives === 1 ? "LIFE" : "LIVES"} LEFT` : "";
      color = "#f87171";
    } else if (game.state === "levelClear") {
      title = game.hasNextLevel() ? "SECTOR CLEARED!" : "ALL SECTORS CLEARED!";
      color = "#4ade80";
    } else if (game.state === "gameOver") {
      title = "GAME OVER";
      color = "#f87171";
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
    ctx.font = "13px ui-monospace, Menlo, Consolas, monospace";
    subs.forEach((s, i) => {
      ctx.fillStyle = s.startsWith("NEW") ? "#fde047" : "#cbd5e1";
      ctx.fillText(s, game.width / 2, top + 50 + i * 20);
    });
  }

  function draw(now) {
    ctx.save();
    if (shakeAmp > 0) ctx.translate((Math.random() - 0.5) * shakeAmp * 2, (Math.random() - 0.5) * shakeAmp * 2);
    ctx.drawImage(layer, 0, 0);
    if (clearAt) {
      ctx.globalAlpha = Math.min(1, (now - clearAt) / 700);
      ctx.drawImage(window.VolfiedArt.scene(game.level, canvas.width, canvas.height), 0, 0);
      ctx.globalAlpha = 1;
    }
    drawFills(now);
    drawTrail(now);
    if (!clearAt) {
      drawPowerup(now);
      drawEnemies(now);
      drawPatrollers(now);
    }
    drawPlayer(now);
    drawParticles();
    drawPopups(now);
    ctx.restore();

    if (now < deathFlashUntil) {
      ctx.fillStyle = "rgba(244, 63, 94, 0.18)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (game.effects.freeze > 0) {
      ctx.fillStyle = "rgba(125, 211, 252, 0.06)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.strokeStyle = "rgba(34, 211, 238, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    drawEffectPills();
    drawOverlay();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.step(dt);
    updateParticles(game.paused ? 0 : dt);
    updateStatus(now);
    fuseSound(now);
    draw(now);
    requestAnimationFrame(loop);
  }

  game.emitAll();
  requestAnimationFrame(loop);
})();
