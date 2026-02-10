(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const restartBtn = document.getElementById("restart-btn");
  const levelEl = document.getElementById("level");
  const captureEl = document.getElementById("capture");
  const livesEl = document.getElementById("lives");
  const scoreEl = document.getElementById("score");
  const statusEl = document.getElementById("status");

  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modal-title");
  const modalMessage = document.getElementById("modal-message");
  const modalRestart = document.getElementById("modal-restart");
  const modalClose = document.getElementById("modal-close");
  const modalNext = document.getElementById("modal-next");

  const game = new window.VolfiedGame();
  const constants = window.__VOLFIED_CONST;

  canvas.width = game.width;
  canvas.height = game.height;
  canvas.tabIndex = 0;

  let last = performance.now();

  function openModal(title, message, showNext) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    if (modalNext) {
      modalNext.classList.toggle("hidden", !showNext);
    }
    modal.classList.remove("hidden");
  }

  function closeModal() {
    modal.classList.add("hidden");
    canvas.focus();
  }

  function bindHUD() {
    game.on("level", (v) => {
      levelEl.textContent = String(v);
    });
    game.on("capture", (v) => {
      captureEl.textContent = String(v);
    });
    game.on("lives", (v) => {
      livesEl.textContent = String(v);
    });
    game.on("score", (v) => {
      scoreEl.textContent = String(v);
    });
    game.on("status", (v) => {
      statusEl.textContent = v;
    });

    game.on("win", ({ capture, score, level, final, nextLevel }) => {
      if (final) {
        openModal("All Levels Clear", `Level ${level}/${constants.MAX_LEVEL}. Final score: ${score}, captured ${capture}%.`, false);
      } else {
        openModal("Sector Cleared", `Level ${level} done. Score ${score}, captured ${capture}%. Next: Level ${nextLevel}.`, true);
      }
    });

    game.on("lose", ({ capture, score, level }) => {
      openModal("Game Over", `Stopped on level ${level}. Final: ${capture}% captured, ${score} points.`, false);
    });
  }

  function setDirectionFromKey(key) {
    if (key === "arrowup" || key === "w") game.setDirection(0, -1);
    if (key === "arrowdown" || key === "s") game.setDirection(0, 1);
    if (key === "arrowleft" || key === "a") game.setDirection(-1, 0);
    if (key === "arrowright" || key === "d") game.setDirection(1, 0);
  }

  function drawEnemy(enemy, cell, idx) {
    const enemyX = enemy.x * cell;
    const enemyY = enemy.y * cell;
    ctx.save();
    ctx.translate(enemyX, enemyY);
    ctx.rotate(Math.PI / 4 + idx * 0.16);
    ctx.fillStyle = idx % 2 === 0 ? "#f97316" : "#fb7185";
    ctx.fillRect(-cell * 0.8, -cell * 0.8, cell * 1.6, cell * 1.6);
    ctx.restore();
  }

  function draw() {
    const cell = constants.CELL;

    ctx.fillStyle = "#030712";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < constants.GRID_H; y++) {
      for (let x = 0; x < constants.GRID_W; x++) {
        ctx.fillStyle = game.claimed[y][x] ? "#11243f" : "#05080f";
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    for (const point of game.trail) {
      const parts = point.split(",");
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      ctx.fillStyle = "#f43f5e";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }

    for (let i = 0; i < game.enemies.length; i++) {
      drawEnemy(game.enemies[i], cell, i);
    }

    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(game.player.x * cell, game.player.y * cell, cell, cell);

    ctx.strokeStyle = "rgba(34, 211, 238, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.step(dt);
    draw();
    requestAnimationFrame(loop);
  }

  restartBtn.addEventListener("click", () => {
    closeModal();
    game.restart();
  });

  modalRestart.addEventListener("click", () => {
    closeModal();
    game.restart();
  });

  modalClose.addEventListener("click", () => {
    closeModal();
  });

  if (modalNext) {
    modalNext.addEventListener("click", () => {
      closeModal();
      game.nextLevel();
    });
  }

  window.addEventListener(
    "keydown",
    (e) => {
      const k = e.key.toLowerCase();
      if (k.startsWith("arrow")) e.preventDefault();
      if (k === "r") {
        closeModal();
        game.restart();
        return;
      }
      if (k === "enter" && !modal.classList.contains("hidden") && game.hasNextLevel()) {
        if (game.nextLevel()) closeModal();
        return;
      }
      setDirectionFromKey(k);
    },
    { passive: false }
  );

  canvas.addEventListener("click", () => canvas.focus());

  bindHUD();
  requestAnimationFrame(loop);
})();
