// Pack & Dash! canvas renderer: office art, characters, effects. Reads game state only.
(function(global){
  const PALETTES = {
    dark: {
      floorA:'#0f1a30', floorB:'#111d35', fleck:'rgba(148,163,184,0.08)',
      wall:'#1e293b', wallTop:'#334155', base:'#0b1222',
      desk:'#5b4636', deskTop:'#7c5e47', deskEdge:'#3b2d22', monitor:'#0f172a', screen:'#38bdf8',
      cone:'250,204,21', coneAlert:'248,113,113', coneIdle:'148,163,184',
      elevFrame:'#475569', elevDoor:'#94a3b8', elevDoorDark:'#64748b', elevInside:'#0b1222',
      shadow:'rgba(0,0,0,0.35)', itemGlow:'rgba(250,204,21,0.22)', bubble:'#f8fafc', bubbleText:'#0f172a', text:'#f8fafc',
      vignette:'239,68,68',
    },
    light: {
      floorA:'#e9e4da', floorB:'#e2dccf', fleck:'rgba(120,113,108,0.10)',
      wall:'#cbd5e1', wallTop:'#e2e8f0', base:'#94a3b8',
      desk:'#b08968', deskTop:'#d4a373', deskEdge:'#7f5539', monitor:'#1e293b', screen:'#0ea5e9',
      cone:'234,179,8', coneAlert:'220,38,38', coneIdle:'100,116,139',
      elevFrame:'#64748b', elevDoor:'#cbd5e1', elevDoorDark:'#94a3b8', elevInside:'#334155',
      shadow:'rgba(15,23,42,0.18)', itemGlow:'rgba(234,179,8,0.25)', bubble:'#ffffff', bubbleText:'#0f172a', text:'#0f172a',
      vignette:'220,38,38',
    },
  };
  const SHIRTS = ['#f472b6', '#a78bfa', '#fb923c', '#22d3ee', '#facc15'];
  const BOSS_LINES = ['Quick sync?', 'Circle back…', 'Synergy!', 'Per my email…', 'Big picture…', 'Bandwidth?'];
  const CHAT_LINES = ['Weekend plans?', 'Did you see…', 'So anyway…', 'Haha, totally', 'Lunch later?'];

  function hash(x, y){ let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  function createRenderer(canvas, game){
    const ctx = canvas.getContext('2d');
    const T = game.tile;
    let pal = PALETTES.dark;
    let particles = [], texts = [], shake = 0, elevAnim = 0, clock = 0;
    let floorCache = null, scale = 1;

    // Render at the canvas's on-screen size (times devicePixelRatio) so art and text stay crisp.
    function resize(){
      const cssW = canvas.getBoundingClientRect().width || game.width;
      const s = Math.max(1, Math.min(4, Math.round(cssW / game.width * (global.devicePixelRatio || 1) * 2) / 2));
      if (s === scale && canvas.width === Math.round(game.width * s)) return;
      scale = s;
      canvas.width = Math.round(game.width * s); canvas.height = Math.round(game.height * s);
      floorCache = null;
    }

    function setTheme(name){ pal = PALETTES[name] || PALETTES.dark; floorCache = null; }

    // Static layer (floor, walls, desks) is drawn once per level/theme.
    function buildStatic(){
      const c = document.createElement('canvas');
      c.width = Math.round(game.width * scale); c.height = Math.round(game.height * scale);
      const g = c.getContext('2d');
      g.setTransform(scale, 0, 0, scale, 0, 0);
      for (let y = 0; y < game.rows; y++) for (let x = 0; x < game.cols; x++){
        g.fillStyle = (x + y) % 2 ? pal.floorA : pal.floorB;
        g.fillRect(x*T, y*T, T, T);
        if (hash(x, y) < 0.5){ g.fillStyle = pal.fleck; g.fillRect(x*T + Math.floor(hash(y, x) * 13), y*T + Math.floor(hash(x+7, y) * 13), 2, 2); }
      }
      const edge = (x, y) => x === 0 || y === 0 || x === game.cols - 1 || y === game.rows - 1;
      for (let y = 0; y < game.rows; y++) for (let x = 0; x < game.cols; x++){
        if (!game.grid[y][x]) continue;
        const px = x*T, py = y*T;
        if (edge(x, y)){
          g.fillStyle = pal.wall; g.fillRect(px, py, T, T);
          g.fillStyle = pal.wallTop; g.fillRect(px, py, T, 3);
          if (y < game.rows - 1 && !game.grid[y+1][x]){ g.fillStyle = pal.base; g.fillRect(px, py + T - 3, T, 3); }
          continue;
        }
        // desk tile
        const below = game.isWall(x, y+1) && !edge(x, y+1);
        g.fillStyle = pal.deskTop; g.fillRect(px, py, T, T);
        g.fillStyle = pal.desk; g.fillRect(px, py + T - 2, T, 2);
        if (!below){ g.fillStyle = pal.deskEdge; g.fillRect(px, py + T - 4, T, 4); }
        if (!game.isWall(x-1, y)){ g.fillStyle = pal.deskEdge; g.fillRect(px, py, 1, T); }
        if (!game.isWall(x+1, y)){ g.fillStyle = pal.deskEdge; g.fillRect(px + T - 1, py, 1, T); }
        const r = hash(x, y);
        if (r < 0.32){ // monitor
          g.fillStyle = pal.monitor; g.fillRect(px + 3, py + 2, 10, 7);
          g.fillStyle = pal.screen; g.globalAlpha = 0.7; g.fillRect(px + 4, py + 3, 8, 5); g.globalAlpha = 1;
          g.fillStyle = pal.monitor; g.fillRect(px + 7, py + 9, 2, 2);
        } else if (r < 0.45){ // papers
          g.fillStyle = '#f1f5f9'; g.fillRect(px + 4, py + 4, 7, 8);
          g.fillStyle = '#cbd5e1'; g.fillRect(px + 5, py + 6, 5, 1); g.fillRect(px + 5, py + 8, 4, 1);
        } else if (r < 0.52){ // mug ring
          g.strokeStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.arc(px + 8, py + 7, 3, 0, Math.PI*2); g.stroke();
        }
      }
      return c;
    }

    function drawEmoji(char, x, y, size){
      ctx.font = `${size}px system-ui, Apple Color Emoji, Segoe UI Emoji`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff'; // emoji pick up the fill's alpha
      ctx.fillText(char, x, y);
    }

    function person(x, y, opts){
      const { shirt, face, bob, tie, box, skin = '#f1c27d', hair = '#3f2a1d' } = opts;
      const yb = y - Math.abs(Math.sin(bob)) * 1.5;
      ctx.fillStyle = pal.shadow; ctx.beginPath(); ctx.ellipse(x, y + 6, 5, 2, 0, 0, Math.PI*2); ctx.fill();
      // legs
      ctx.fillStyle = '#1f2937';
      const step = Math.sin(bob) * 1.5;
      ctx.fillRect(x - 3, yb + 2, 2, 4 + step); ctx.fillRect(x + 1, yb + 2, 2, 4 - step);
      // body
      ctx.fillStyle = shirt; ctx.fillRect(x - 4, yb - 3, 8, 6);
      if (tie){ ctx.fillStyle = tie; ctx.fillRect(x - 1, yb - 3, 2, 5); }
      // head
      ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(x, yb - 6, 3.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = hair; ctx.fillRect(x - 3.5, yb - 10, 7, 2.5);
      // eyes look where they're heading
      if (face.y >= 0 || face.x){
        ctx.fillStyle = '#111827';
        const ex = face.x * 1.5, ey = face.y > 0 ? 0.8 : 0;
        ctx.fillRect(x - 2 + ex, yb - 6.5 + ey, 1, 1.5); ctx.fillRect(x + 1 + ex, yb - 6.5 + ey, 1, 1.5);
      }
      if (box){ // cardboard box grows with what you've packed
        const h = 3 + Math.min(5, box);
        ctx.fillStyle = '#c08a4f'; ctx.fillRect(x - 5, yb - 1 - h + 3, 10, h);
        ctx.fillStyle = '#9a6b3a'; ctx.fillRect(x - 5, yb - 1 - h + 3, 10, 1); ctx.fillRect(x - 0.5, yb - 1 - h + 3, 1, h);
      }
    }

    function bubble(x, y, text, color){
      ctx.font = '600 7px system-ui, sans-serif';
      const w = Math.ceil(ctx.measureText(text).width) + 6, h = 10;
      const bx = Math.max(1, Math.min(game.width - w - 1, x - w/2)), by = Math.max(1, y - h - 3);
      ctx.fillStyle = pal.bubble; ctx.strokeStyle = color || pal.bubbleText; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, h, 3) : ctx.rect(bx, by, w, h); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 2, by + h); ctx.lineTo(x, by + h + 3); ctx.lineTo(x + 2, by + h); ctx.fill();
      ctx.fillStyle = pal.bubbleText; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + w/2, by + h/2 + 0.5);
    }

    function meter(x, y, frac, color){
      ctx.fillStyle = 'rgba(15,23,42,0.85)'; ctx.fillRect(x - 11, y, 22, 4);
      ctx.fillStyle = color; ctx.fillRect(x - 10, y + 1, 20 * Math.max(0, Math.min(1, frac)), 2);
    }

    // ---- effects API (called from UI on game events) ----
    function burst(x, y, color, n = 10, speed = 50){
      for (let i = 0; i < n; i++){
        const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20, life: 0.6 + Math.random() * 0.4, max: 1, color, size: 1.5 + Math.random() * 1.5 });
      }
    }
    function dust(x, y){ particles.push({ x: x + (Math.random() - 0.5) * 4, y, vx: (Math.random() - 0.5) * 10, vy: -6, life: 0.35, max: 0.35, color: 'rgba(148,163,184,0.5)', size: 2 }); }
    function floatText(x, y, text, color, size = 8){ texts.push({ x, y, text, color, size, life: 1.1, max: 1.1 }); }
    function kick(amount){ shake = Math.max(shake, amount); }
    function reset(){ particles = []; texts = []; shake = 0; elevAnim = 0; floorCache = null; }

    function render(dt){
      clock += dt;
      if (!floorCache) floorCache = buildStatic();
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.save();
      if (shake > 0){ ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake = Math.max(0, shake - dt * 20); }
      ctx.drawImage(floorCache, 0, 0, game.width, game.height);

      // boss vision cones (under everything that moves)
      for (const b of game.bosses){
        const active = !b.talking && b.cooldown <= 0;
        const rgb = !active ? pal.coneIdle : b.alert > 0 ? pal.coneAlert : pal.cone;
        const bgx = Math.floor(b.cx / T), bgy = Math.floor(b.cy / T);
        for (const k of b.vision){
          const gx = k % game.cols, gy = Math.floor(k / game.cols);
          const d = Math.abs(gx - bgx) + Math.abs(gy - bgy);
          const a = active ? (b.alert > 0 ? 0.34 : 0.24) * (1 - d / (b.range + 3)) : 0.07;
          ctx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
          ctx.fillRect(gx*T, gy*T, T, T);
        }
      }

      drawElevator(dt);

      // items
      for (const it of game.items){
        if (it.picked) continue;
        const cx = it.gx*T + T/2, cy = it.gy*T + T/2 + Math.sin(clock * 3 + it.gx) * 1.2;
        const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 9);
        glow.addColorStop(0, pal.itemGlow); glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow; ctx.fillRect(cx - 9, cy - 9, 18, 18);
        ctx.fillStyle = pal.shadow; ctx.beginPath(); ctx.ellipse(cx, it.gy*T + T - 2, 4, 1.5, 0, 0, Math.PI*2); ctx.fill();
        drawEmoji(it.data.icon, cx, cy, 12);
        if (it.progress > 0){
          ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, 9, -Math.PI/2, -Math.PI/2 + it.progress * Math.PI * 2); ctx.stroke();
        }
      }

      // people, sorted by y so they overlap naturally
      const p = game.player, pc = { x: p.x + p.w/2, y: p.y + p.h/2 };
      const people = [];
      for (const c of game.coworkers) people.push({ y: c.cy, draw: () => drawCoworker(c) });
      for (const b of game.bosses) people.push({ y: b.cy, draw: () => drawBoss(b) });
      people.push({ y: pc.y, draw: () => {
        const packed = game.items.length - game.itemsLeft;
        person(pc.x, pc.y, { shirt: '#34d399', face: p.face, bob: game.moving ? game.walked / 5 : 0, box: packed ? packed : 0, hair: '#1f2937' });
      }});
      people.sort((a, b) => a.y - b.y).forEach(o => o.draw());

      // talk bubble + timer above the player
      const t = game.talk;
      if (t){
        const choose = t.kind === 'coworker' && t.phase === 'choose';
        const frac = t.t / t.total;
        meter(pc.x, p.y - 16, frac, t.kind === 'boss' ? '#f87171' : choose ? '#facc15' : '#f472b6');
      }

      // elevator pointer once the box is packed
      if (game.itemsLeft === 0 && game.state === 'playing'){
        const e = game.elevator, ex = e.x + e.w/2, ey = e.y + e.h/2;
        const dx = ex - pc.x, dy = ey - pc.y, d = Math.hypot(dx, dy);
        if (d > 40){
          const ux = dx / d, uy = dy / d, r = 16 + Math.sin(clock * 6) * 2;
          const ax = pc.x + ux * r, ay = pc.y + uy * r;
          ctx.fillStyle = '#4ade80';
          ctx.beginPath(); ctx.moveTo(ax + ux * 5, ay + uy * 5); ctx.lineTo(ax - uy * 3.5, ay + ux * 3.5); ctx.lineTo(ax + uy * 3.5, ay - ux * 3.5); ctx.fill();
        }
      }

      // particles + floating text
      for (const q of particles){
        q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 90 * dt;
        ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.color; ctx.fillRect(q.x, q.y, q.size, q.size);
      }
      particles = particles.filter(q => q.life > 0);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const f of texts){
        f.life -= dt; f.y -= 18 * dt;
        ctx.globalAlpha = Math.min(1, Math.max(0, f.life / f.max) * 2);
        ctx.font = `700 ${f.size}px system-ui, sans-serif`;
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(15,23,42,0.8)'; ctx.strokeText(f.text, f.x, f.y);
        ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
      }
      texts = texts.filter(f => f.life > 0);
      ctx.globalAlpha = 1;

      // last-10-seconds pulse
      if (game.state === 'playing' && game.timeLeft < 10){
        const a = (0.10 + 0.08 * Math.sin(clock * 8)) * (1 - game.timeLeft / 10 * 0.5);
        const grd = ctx.createRadialGradient(game.width/2, game.height/2, game.height * 0.35, game.width/2, game.height/2, game.width * 0.7);
        grd.addColorStop(0, `rgba(${pal.vignette},0)`); grd.addColorStop(1, `rgba(${pal.vignette},${a.toFixed(3)})`);
        ctx.fillStyle = grd; ctx.fillRect(0, 0, game.width, game.height);
      }
      ctx.restore();
    }

    function drawElevator(dt){
      const e = game.elevator, open = game.itemsLeft === 0;
      elevAnim = Math.max(0, Math.min(1, elevAnim + (open ? dt * 1.5 : -dt * 3)));
      ctx.fillStyle = pal.elevFrame; ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = pal.elevInside; ctx.fillRect(e.x + 3, e.y + 5, e.w - 6, e.h - 6);
      const half = (e.w - 6) / 2, slide = half * elevAnim * 0.85;
      ctx.fillStyle = pal.elevDoor;
      ctx.fillRect(e.x + 3, e.y + 5, half - slide, e.h - 6);
      ctx.fillRect(e.x + 3 + half + slide, e.y + 5, half - slide, e.h - 6);
      ctx.fillStyle = pal.elevDoorDark;
      ctx.fillRect(e.x + 3 + half - slide - 1, e.y + 5, 1, e.h - 6);
      ctx.fillRect(e.x + 3 + half + slide, e.y + 5, 1, e.h - 6);
      // indicator light
      const glow = open ? 0.6 + 0.4 * Math.sin(clock * 5) : 1;
      ctx.fillStyle = open ? `rgba(74,222,128,${glow.toFixed(2)})` : '#f87171';
      ctx.beginPath(); ctx.arc(e.x + e.w/2, e.y + 2.5, 1.8, 0, Math.PI*2); ctx.fill();
      if (open){ ctx.fillStyle = 'rgba(74,222,128,0.12)'; ctx.fillRect(e.x - 2, e.y - 2, e.w + 4, e.h + 4); }
    }

    function drawBoss(b){
      const moving = !b.talking && b.wait <= 0;
      person(b.cx, b.cy, { shirt: '#1e3a8a', tie: '#dc2626', face: b.face, bob: moving ? clock * 9 : 0, hair: '#6b7280' });
      if (b.talking) bubble(b.cx, b.cy - 12, BOSS_LINES[Math.floor(clock / 0.9 + b.i) % BOSS_LINES.length], '#f87171');
      else if (b.alert > 0){
        ctx.fillStyle = '#f87171'; ctx.font = '900 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('!', b.cx, b.cy - 17 - Math.min(1, b.alert * 6) * 2);
      } else if (b.cooldown > 0){
        ctx.fillStyle = 'rgba(148,163,184,0.9)'; ctx.font = '600 7px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('📱', b.cx + 6, b.cy - 12);
      }
    }

    function drawCoworker(c){
      const moving = !c.talking && c.wait <= 0;
      person(c.cx, c.cy, { shirt: SHIRTS[c.i % SHIRTS.length], face: c.face, bob: moving ? clock * 8 : 0, hair: ['#78350f', '#111827', '#b45309'][c.i % 3] });
      const t = game.talk;
      if (t && t.who === c) bubble(c.cx, c.cy - 12, t.phase === 'choose' ? 'Heyyy! 👋' : CHAT_LINES[Math.floor(clock / 0.8 + c.i) % CHAT_LINES.length], '#f472b6');
      else if (c.cooldown > 0 && c.cooldown > 4.5) bubble(c.cx, c.cy - 12, 'Oh, ok!', '#94a3b8');
    }

    return { render, resize, setTheme, burst, dust, floatText, kick, reset };
  }

  global.createPackDashRenderer = createRenderer;
})(window);
