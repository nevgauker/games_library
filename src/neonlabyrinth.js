// Neon Labyrinth '89 core logic (no DOM wiring here)
// Exposes a simple API used by neonlabyrinth_ui.js

(function(){
  const CELL = 24; // pixels per cell
  const WALL_COLOR = '#00f0ff';
  const PATH_COLOR = '#0d1117';
  const GRID_COLOR = 'rgba(0,240,255,0.08)';
  const PLAYER_COLOR = '#ff00a8';
  const EXIT_COLOR = '#39ff14';

  const LEVELS = [
    { time: 20, map: [
      "###################",
      "#S   #           #",
      "# ### ########## #",
      "#   #        #   #",
      "### # ###### # ###",
      "#   #    #   #   #",
      "# ###### # ##### #",
      "#      # #     # #",
      "###### # ##### # #",
      "#      #     # # #",
      "# ####### ### # # #",
      "#     #   #   #   #",
      "##### # ### #######",
      "#     #     #    E#",
      "###################",
    ]},
    { time: 30, map: [
      "###################",
      "#S   #       #   ##",
      "### # # ##### #  ##",
      "#   # #     # #   #",
      "# ### ##### # ### #",
      "#   #     # #   # #",
      "### ##### # ### # #",
      "#   #   # #   # # #",
      "# # # # # ### # # #",
      "# #   # #   #   # #",
      "# ##### ### ##### #",
      "#     #   #     # #",
      "##### ### # ### # #",
      "#     #   #   #  E#",
      "###################",
    ]},
    { time: 40, map: [
      "###################",
      "#S      #       ###",
      "# ####### #####   #",
      "# #     #     ### #",
      "# # ### ##### #   #",
      "# #   #     # # ###",
      "# ### ##### # #   #",
      "#   #     # # ### #",
      "### ##### # # #   #",
      "#   #   # # # # ###",
      "# ### # # # # #   #",
      "#   # #   #   ### #",
      "### # ############ #",
      "#   #           # E#",
      "###################",
    ]},
    { time: 50, map: [
      "###################",
      "#S    #     #    ##",
      "#### # # ### # ## ##",
      "#    # # #   # #  ##",
      "# #### # # ### # ###",
      "# #    # #   # #   #",
      "# # #### ### # ### #",
      "# #    #   # #   # #",
      "# #### ### # ### # #",
      "#    #   # #   # # #",
      "#### ### # ### # # #",
      "#    #   #   # #   #",
      "# #### ####### ### #",
      "#    #         #  E#",
      "###################",
    ]},
    { time: 60, map: [
      "###################",
      "#S   #   #   #   ##",
      "### ### # # ### # #",
      "#   #   # #   # # #",
      "# # # ### ### # # #",
      "# # #   #   # # # #",
      "# ### # # # # ### #",
      "#   # # # # #   # #",
      "### # # # # # ### #",
      "#   # # # # #   # #",
      "# ### # # # ### # #",
      "#   #   #   #   # #",
      "# # ### ### ### # #",
      "# #   #   #   #  E#",
      "###################",
    ]},
  ];

  function normalizeMap(mapRows) {
    const maxLen = Math.max(...mapRows.map(r => r.length));
    return mapRows.map(row => row.length < maxLen ? row + '#'.repeat(maxLen - row.length) : row);
  }

  class NeonLabyrinthCore {
    constructor(canvas, hooks = {}){
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.hooks = hooks; // { onTimeUp, onLevelComplete, onGameComplete, onUpdateHUD }

      this.levelIndex = 0;
      this.grid = [];
      this.rows = 0; this.cols = 0;
      this.player = { r: 0, c: 0 };
      this.exitPos = { r: 0, c: 0 };
      this.timeLeft = 0;
      this.running = false;
      this.last = 0;
      this.soundEnabled = true;

      this._tick = this._tick.bind(this);
      requestAnimationFrame(this._tick);
      this.loadLevel(0);
    }

    setSoundEnabled(v){ this.soundEnabled = !!v; }

    beep(freq=440, dur=0.08, type='square', vol=0.03){
      if (!this.soundEnabled) return;
      try {
        this._actx = this._actx || new (window.AudioContext || window.webkitAudioContext)();
        const o = this._actx.createOscillator();
        const g = this._actx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.value = vol;
        o.connect(g); g.connect(this._actx.destination);
        o.start(); o.stop(this._actx.currentTime + dur);
      } catch(e) {}
    }

    loadLevel(i){
      const lvl = LEVELS[i];
      const norm = normalizeMap(lvl.map);
      const map = norm.map(r => r.split(''));
      this.rows = map.length; this.cols = map[0].length;
      this.grid = Array.from({length: this.rows}, (_, r) => Array.from({length: this.cols}, (_, c) => {
        const ch = map[r][c];
        if (ch === 'S') { this.player = { r, c }; return 0; }
        if (ch === 'E') { this.exitPos = { r, c }; return 0; }
        return ch === '#' ? 1 : 0;
      }));
      // Ensure solvable; if not, carve a simple guaranteed path
      if (!this.isSolvable()) {
        this.carveGuaranteedPath();
      }
      // Make levels 2-5 increasingly challenging by adding walls while
      // preserving the shortest path between S and E.
      if (i >= 1) {
        const intensity = [0, 0.12, 0.2, 0.28, 0.35][Math.min(i, 4)];
        this.addDifficulty(intensity);
      }
      this.timeLeft = lvl.time;
      this.fitCanvas();
      this.running = false; this.last = 0;
      this._status('Press Enter to start');
      this._hud();
    }

    restart(){ this.loadLevel(this.levelIndex); }

    startOrAdvance(){
      if (!this.running && this.timeLeft > 0 && this.player.r === this.exitPos.r && this.player.c === this.exitPos.c){
        // Level complete and acknowledged
        if (this.levelIndex === LEVELS.length - 1){
          // Already at last level; restart campaign
          this.levelIndex = 0; this.loadLevel(this.levelIndex);
          this.running = true; this._status(''); return;
        }
        this.levelIndex = Math.min(this.levelIndex + 1, LEVELS.length - 1);
        this.loadLevel(this.levelIndex);
        this.running = true; this._status(''); return;
      }
      if (!this.running && this.timeLeft === 0){
        this.loadLevel(this.levelIndex);
        this.running = true; this._status(''); return;
      }
      if (!this.running){ this.running = true; this._status(''); }
    }

    fitCanvas(){
      this.canvas.width = Math.min(640, this.cols * CELL);
      this.canvas.height = Math.min(480, this.rows * CELL);
    }

    tryMove(dr, dc){
      if (!this.running) return;
      const nr = this.player.r + dr;
      const nc = this.player.c + dc;
      if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) return;
      if (this.grid[nr][nc] === 1){ this.beep(200, 0.05, 'square', 0.02); return; }
      this.player.r = nr; this.player.c = nc; this.beep(880, 0.03, 'square', 0.02);
      if (this.player.r === this.exitPos.r && this.player.c === this.exitPos.c){
        this.running = false; this.beep(1200, 0.12, 'square', 0.04);
        if (this.levelIndex === LEVELS.length - 1){ this._status('You escaped! Press Enter to play again.'); }
        else { this._status('Level complete! Press Enter for next.'); }
        if (this.hooks.onLevelComplete) this.hooks.onLevelComplete(this.levelIndex);
      }
      this._hud();
    }

    _hud(){ if (this.hooks.onUpdateHUD) this.hooks.onUpdateHUD({ level: this.levelIndex+1, time: this.timeLeft }); }
    _status(text){ if (this.hooks.onStatus) this.hooks.onStatus(text); }

    _tick(ts){
      if (!this._last) this._last = ts; const dt = (ts - this._last) / 1000; this._last = ts;
      if (this.running){
        this.timeLeft -= dt;
        if (this.timeLeft <= 0){
          this.timeLeft = 0; this.running = false; this.beep(120, 0.2, 'sawtooth', 0.05);
          this._status('Time up! Press Enter to retry level.');
          if (this.hooks.onTimeUp) this.hooks.onTimeUp(this.levelIndex);
        }
        this._hud();
      }
      this.draw();
      requestAnimationFrame(this._tick);
    }

    draw(){
      const ctx = this.ctx;
      // Background
      ctx.fillStyle = PATH_COLOR; ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
      // Grid
      ctx.strokeStyle = GRID_COLOR; ctx.lineWidth = 1;
      for (let r=0; r<=this.rows; r++){ const y = r*CELL + 0.5; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(this.cols*CELL,y); ctx.stroke(); }
      for (let c=0; c<=this.cols; c++){ const x = c*CELL + 0.5; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,this.rows*CELL); ctx.stroke(); }
      // Walls
      ctx.fillStyle = WALL_COLOR;
      for (let r=0; r<this.rows; r++) for (let c=0; c<this.cols; c++) if (this.grid[r][c]===1) ctx.fillRect(c*CELL+1, r*CELL+1, CELL-2, CELL-2);
      // Exit
      ctx.fillStyle = EXIT_COLOR; ctx.shadowColor = EXIT_COLOR; ctx.shadowBlur = 8;
      ctx.fillRect(this.exitPos.c*CELL+4, this.exitPos.r*CELL+4, CELL-8, CELL-8); ctx.shadowBlur = 0;
      // Player
      ctx.fillStyle = PLAYER_COLOR; ctx.shadowColor = PLAYER_COLOR; ctx.shadowBlur = 8;
      ctx.fillRect(this.player.c*CELL+5, this.player.r*CELL+5, CELL-10, CELL-10); ctx.shadowBlur = 0;
    }

    levelCount(){ return LEVELS.length; }
    goToLevel(i){ this.levelIndex = Math.max(0, Math.min(i, this.levelCount()-1)); this.loadLevel(this.levelIndex); }

    isSolvable(){
      const q = [];
      const seen = Array.from({length: this.rows}, () => Array(this.cols).fill(false));
      const start = this.player, goal = this.exitPos;
      q.push([start.r, start.c]);
      seen[start.r][start.c] = true;
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      while (q.length){
        const [r,c] = q.shift();
        if (r === goal.r && c === goal.c) return true;
        for (const [dr,dc] of dirs){
          const nr = r+dr, nc = c+dc;
          if (nr<0||nc<0||nr>=this.rows||nc>=this.cols) continue;
          if (seen[nr][nc] || this.grid[nr][nc]===1) continue;
          seen[nr][nc] = true; q.push([nr,nc]);
        }
      }
      return false;
    }

    carveGuaranteedPath(){
      // Carve a Manhattan path from S to E
      const sr = this.player.r, sc = this.player.c;
      const er = this.exitPos.r, ec = this.exitPos.c;
      const rstep = sr <= er ? 1 : -1;
      const cstep = sc <= ec ? 1 : -1;
      for (let c = sc; c !== ec; c += cstep){ this.grid[sr][c] = 0; }
      for (let r = sr; r !== er; r += rstep){ this.grid[r][ec] = 0; }
      this.grid[er][ec] = 0;
    }

    shortestPath(){
      // BFS with parent tracking from S to E
      const q = [];
      const seen = Array.from({length: this.rows}, () => Array(this.cols).fill(false));
      const parent = Array.from({length: this.rows}, () => Array(this.cols).fill(null));
      const s = this.player, g = this.exitPos;
      q.push([s.r, s.c]);
      seen[s.r][s.c] = true;
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      while (q.length){
        const [r,c] = q.shift();
        if (r === g.r && c === g.c){
          // reconstruct
          const path = [];
          let cr = r, cc = c;
          while (!(cr === s.r && cc === s.c)){
            path.push([cr, cc]);
            const p = parent[cr][cc];
            if (!p) break; cr = p[0]; cc = p[1];
          }
          path.push([s.r, s.c]);
          return path.reverse();
        }
        for (const [dr,dc] of dirs){
          const nr = r+dr, nc = c+dc;
          if (nr<0||nc<0||nr>=this.rows||nc>=this.cols) continue;
          if (seen[nr][nc] || this.grid[nr][nc]===1) continue;
          seen[nr][nc] = true; parent[nr][nc] = [r,c]; q.push([nr,nc]);
        }
      }
      return null;
    }

    addDifficulty(intensity=0.2){
      // Preserve the current shortest path; add walls elsewhere up to a target ratio
      let path = this.shortestPath();
      if (!path) { this.carveGuaranteedPath(); path = this.shortestPath(); }
      const pathSet = new Set(path.map(([r,c]) => `${r},${c}`));
      // collect open cells not on path, not S/E
      const open = [];
      for (let r=0;r<this.rows;r++){
        for (let c=0;c<this.cols;c++){
          if (this.grid[r][c]===0 && !pathSet.has(`${r},${c}`)){
            if (!((r===this.player.r && c===this.player.c) || (r===this.exitPos.r && c===this.exitPos.c))){
              open.push([r,c]);
            }
          }
        }
      }
      // shuffle
      for (let i=open.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); const t=open[i]; open[i]=open[j]; open[j]=t; }
      const target = Math.max(1, Math.floor(open.length * intensity));
      let added = 0, attempts = 0;
      while (added < target && attempts < open.length * 3){
        const pick = open[attempts % open.length];
        attempts++;
        const [r,c] = pick;
        if (this.grid[r][c]===1) continue; // already wall from earlier attempts
        this.grid[r][c] = 1;
        if (this.isSolvable()){
          added++;
        } else {
          this.grid[r][c] = 0; // revert if it breaks solvability
        }
      }
    }
  }

  window.NeonLabyrinthCore = NeonLabyrinthCore;
})();
