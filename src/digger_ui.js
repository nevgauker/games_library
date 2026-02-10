(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const restartBtn = document.getElementById("restart-btn");
  const levelEl = document.getElementById("level");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const emeraldsEl = document.getElementById("emeralds");
  const statusEl = document.getElementById("status");

  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modal-title");
  const modalMessage = document.getElementById("modal-message");
  const modalNext = document.getElementById("modal-next");
  const modalRestart = document.getElementById("modal-restart");
  const modalClose = document.getElementById("modal-close");

  const game = new window.DiggerGame();
  const C = window.__DIGGER_CONST;

  canvas.width = game.width;
  canvas.height = game.height;
  canvas.tabIndex = 0;

  let last = performance.now();

  function openModal(title, message, showNext) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalNext.classList.toggle("hidden", !showNext);
    modal.classList.remove("hidden");
  }

  function closeModal() {
    modal.classList.add("hidden");
    canvas.focus();
  }

  function bindHUD() {
    game.on("level", (v) => (levelEl.textContent = String(v)));
    game.on("score", (v) => (scoreEl.textContent = String(v)));
    game.on("lives", (v) => (livesEl.textContent = String(v)));
    game.on("emeralds", (v) => (emeraldsEl.textContent = String(v)));
    game.on("status", (v) => (statusEl.textContent = v));

    game.on("win", ({ level, score, final, nextLevel }) => {
      if (final) openModal("You Win", `Level ${level}/${C.MAX_LEVEL} cleared. Final score ${score}.`, false);
      else openModal("Level Clear", `Level ${level} complete. Next level ${nextLevel}.`, true);
    });

    game.on("lose", ({ level, score }) => {
      openModal("Game Over", `You reached level ${level}. Score ${score}.`, false);
    });
  }

  function drawGrid() {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < C.ROWS; y++) {
      for (let x = 0; x < C.COLS; x++) {
        if (game.dirt[y][x]) {
          ctx.fillStyle = "#1e3a8a";
          ctx.fillRect(x * C.TILE, y * C.TILE, C.TILE, C.TILE);
          ctx.strokeStyle = "rgba(59,130,246,0.12)";
          ctx.strokeRect(x * C.TILE + 2, y * C.TILE + 2, C.TILE - 4, C.TILE - 4);
        } else {
          ctx.fillStyle = "#020617";
          ctx.fillRect(x * C.TILE, y * C.TILE, C.TILE, C.TILE);
        }
      }
    }
  }

  function drawEmeralds() {
    for (const k of game.emeralds) {
      const p = k.split(",");
      const x = Number(p[0]);
      const y = Number(p[1]);
      const cx = x * C.TILE + C.TILE / 2;
      const cy = y * C.TILE + C.TILE / 2;
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.moveTo(cx, cy - 9);
      ctx.lineTo(cx + 8, cy);
      ctx.lineTo(cx, cy + 9);
      ctx.lineTo(cx - 8, cy);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawBags() {
    for (const b of game.bags) {
      const shakeOffset = b.shaking ? ((Math.floor(b.shakeTimer * 24) % 2 === 0) ? -2 : 2) : 0;
      const x = b.x * C.TILE + shakeOffset;
      const y = b.y * C.TILE;
      if (b.gold) {
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(x + 4, y + 4, C.TILE - 8, C.TILE - 8);
      } else {
        ctx.fillStyle = "#a16207";
        ctx.fillRect(x + 5, y + 2, C.TILE - 10, C.TILE - 4);
      }
    }
  }

  function drawMonsters() {
    for (const m of game.monsters) {
      if (!m.alive) continue;
      const x = m.x * C.TILE;
      const y = m.y * C.TILE;
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(x + 6, y + 6, C.TILE - 12, C.TILE - 12);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x + 10, y + 11, 4, 4);
      ctx.fillRect(x + 18, y + 11, 4, 4);
    }
  }

  function drawPump() {
    if (!game.pump) return;
    const p = game.player;
    ctx.fillStyle = "#fbbf24";
    for (let i = 1; i <= game.pump.len; i++) {
      let x = p.x;
      let y = p.y;
      if (game.pump.dir === "right") x += i;
      if (game.pump.dir === "left") x -= i;
      if (game.pump.dir === "down") y += i;
      if (game.pump.dir === "up") y -= i;
      if (x < 0 || y < 0 || x >= C.COLS || y >= C.ROWS) break;
      ctx.fillRect(x * C.TILE + 10, y * C.TILE + 10, C.TILE - 20, C.TILE - 20);
    }
  }

  function drawPlayer() {
    const x = game.player.x * C.TILE;
    const y = game.player.y * C.TILE;
    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(x + 6, y + 6, C.TILE - 12, C.TILE - 12);
  }

  function render() {
    drawGrid();
    drawEmeralds();
    drawBags();
    drawMonsters();
    drawPump();
    drawPlayer();
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.step(dt);
    render();
    requestAnimationFrame(loop);
  }

  const held = { up: false, down: false, left: false, right: false };

  function applyHeldDirection() {
    if (held.up && !held.down) return game.setDirection(0, -1);
    if (held.down && !held.up) return game.setDirection(0, 1);
    if (held.left && !held.right) return game.setDirection(-1, 0);
    if (held.right && !held.left) return game.setDirection(1, 0);
    game.setDirection(0, 0);
  }

  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    if (k.startsWith("arrow")) e.preventDefault();

    if (k === "r") {
      closeModal();
      game.restart();
      return;
    }

    if (k === " " || e.code === "Space") {
      e.preventDefault();
      game.firePump();
      return;
    }

    if (k === "enter" && !modal.classList.contains("hidden") && game.hasNextLevel()) {
      if (game.nextLevel()) closeModal();
      return;
    }

    if (k === "arrowup" || k === "w") held.up = true;
    if (k === "arrowdown" || k === "s") held.down = true;
    if (k === "arrowleft" || k === "a") held.left = true;
    if (k === "arrowright" || k === "d") held.right = true;
    applyHeldDirection();
  }

  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (k === "arrowup" || k === "w") held.up = false;
    if (k === "arrowdown" || k === "s") held.down = false;
    if (k === "arrowleft" || k === "a") held.left = false;
    if (k === "arrowright" || k === "d") held.right = false;
    applyHeldDirection();
  }

  restartBtn.addEventListener("click", () => {
    closeModal();
    game.restart();
  });

  modalRestart.addEventListener("click", () => {
    closeModal();
    game.restart();
  });

  modalNext.addEventListener("click", () => {
    if (game.nextLevel()) closeModal();
  });

  modalClose.addEventListener("click", closeModal);

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp, { passive: false });
  canvas.addEventListener("click", () => canvas.focus());

  bindHUD();
  requestAnimationFrame(loop);
})();
