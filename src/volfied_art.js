// Volfied art: one procedurally painted scene per level, revealed by captured land.
// Everything is drawn with canvas primitives from a seeded RNG, so each level always looks the same.
(function (global) {
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sky(ctx, w, h, stops) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function stars(ctx, w, h, r, count, maxY = h) {
    for (let i = 0; i < count; i++) {
      const x = r() * w, y = r() * maxY, s = r() < 0.08 ? 2 : 1;
      ctx.globalAlpha = 0.35 + r() * 0.65;
      ctx.fillStyle = r() < 0.15 ? "#fde68a" : "#f8fafc";
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function blob(ctx, x, y, rad, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    ctx.globalAlpha = 1;
  }

  function ridge(ctx, w, h, r, baseY, amp, rough, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    let y = baseY;
    for (let x = 0; x <= w; x += 8) {
      y += (r() - 0.5) * rough;
      y = Math.max(baseY - amp, Math.min(baseY + amp, y));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }

  const SCENES = [
    {
      name: "Nebula",
      paint(ctx, w, h, r) {
        sky(ctx, w, h, ["#0b0420", "#1e1048", "#0a1a3a"]);
        const hues = ["#a855f7", "#ec4899", "#3b82f6", "#22d3ee", "#f472b6"];
        for (let i = 0; i < 14; i++) blob(ctx, r() * w, r() * h, 60 + r() * 160, hues[i % hues.length], 0.25 + r() * 0.25);
        stars(ctx, w, h, r, 320);
        for (let i = 0; i < 5; i++) {
          const x = r() * w, y = r() * h;
          blob(ctx, x, y, 14, "#ffffff", 0.9);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x - 10, y, 20, 1);
          ctx.fillRect(x, y - 10, 1, 20);
        }
      },
    },
    {
      name: "Ringed Giant",
      paint(ctx, w, h, r) {
        sky(ctx, w, h, ["#020617", "#0c1630", "#111827"]);
        stars(ctx, w, h, r, 260);
        const cx = w * 0.58, cy = h * 0.52, R = h * 0.34;
        const ring = (front) => {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(-0.32);
          ctx.scale(1, 0.26);
          ctx.beginPath();
          ctx.arc(0, 0, R * 1.75, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
          ctx.lineWidth = R * 0.42;
          ctx.strokeStyle = "rgba(253, 230, 138, 0.55)";
          ctx.stroke();
          ctx.lineWidth = R * 0.08;
          ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
          ctx.stroke();
          ctx.restore();
        };
        ring(false);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        const bands = ["#c2410c", "#f59e0b", "#fde68a", "#b45309", "#ea580c", "#fcd34d", "#92400e"];
        for (let y = cy - R, i = 0; y < cy + R; i++) {
          const bh = 8 + r() * 18;
          ctx.fillStyle = bands[i % bands.length];
          ctx.fillRect(cx - R, y, R * 2, bh + 1);
          y += bh;
        }
        const shade = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.2, cx, cy, R * 1.05);
        shade.addColorStop(0, "rgba(255,255,255,0.15)");
        shade.addColorStop(1, "rgba(2,6,23,0.85)");
        ctx.fillStyle = shade;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        ctx.restore();
        ring(true);
        ctx.fillStyle = "#94a3b8";
        ctx.beginPath();
        ctx.arc(w * 0.16, h * 0.24, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(2,6,23,0.6)";
        ctx.beginPath();
        ctx.arc(w * 0.16 + 6, h * 0.24 + 4, 16, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      name: "Aurora Peaks",
      paint(ctx, w, h, r) {
        sky(ctx, w, h, ["#01121c", "#062a35", "#0b1e2e"]);
        stars(ctx, w, h, r, 220, h * 0.7);
        const cols = ["#34d399", "#22d3ee", "#a78bfa"];
        for (let b = 0; b < 3; b++) {
          const base = h * (0.22 + b * 0.1), ph = r() * 10, amp = 18 + r() * 24;
          for (let x = 0; x < w; x += 3) {
            const y = base + Math.sin(x / 70 + ph) * amp + Math.sin(x / 23 + ph * 2) * 6;
            const g = ctx.createLinearGradient(0, y - 70, 0, y + 10);
            g.addColorStop(0, "rgba(0,0,0,0)");
            g.addColorStop(1, cols[b]);
            ctx.globalAlpha = 0.28;
            ctx.fillStyle = g;
            ctx.fillRect(x, y - 70, 3, 80);
          }
        }
        ctx.globalAlpha = 1;
        ridge(ctx, w, h, r, h * 0.66, 50, 26, "#1e293b");
        ridge(ctx, w, h, r, h * 0.78, 30, 18, "#0f172a");
        ridge(ctx, w, h, r, h * 0.9, 14, 10, "#020617");
      },
    },
    {
      name: "Sunset Dunes",
      paint(ctx, w, h, r) {
        sky(ctx, w, h, ["#1e1b4b", "#7e22ce", "#f472b6", "#fb923c"]);
        stars(ctx, w, h, r, 90, h * 0.35);
        const cx = w * 0.5, cy = h * 0.58, R = h * 0.26;
        const sun = ctx.createLinearGradient(0, cy - R, 0, cy + R);
        sun.addColorStop(0, "#fef08a");
        sun.addColorStop(1, "#f97316");
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = sun;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        ctx.fillStyle = "#c026d3";
        for (let i = 0; i < 6; i++) {
          const y = cy + i * i * 2.2 + 4;
          ctx.fillRect(cx - R, y, R * 2, 2 + i * 1.2);
        }
        ctx.restore();
        const dunes = ["#9a3412", "#7c2d12", "#431407", "#1c0a05"];
        dunes.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.beginPath();
          const base = h * (0.68 + i * 0.09), ph = r() * 6, amp = 14 + r() * 12;
          ctx.moveTo(0, h);
          for (let x = 0; x <= w; x += 6) ctx.lineTo(x, base + Math.sin(x / (90 + i * 30) + ph) * amp);
          ctx.lineTo(w, h);
          ctx.fill();
        });
      },
    },
    {
      name: "Neon City",
      paint(ctx, w, h, r) {
        sky(ctx, w, h, ["#030014", "#1e0b3b", "#3b0a45"]);
        stars(ctx, w, h, r, 140, h * 0.45);
        blob(ctx, w * 0.75, h * 0.2, 120, "#f0abfc", 0.25);
        const horizon = h * 0.66;
        for (let layer = 0; layer < 2; layer++) {
          let x = -10;
          while (x < w) {
            const bw = 24 + r() * 46, bh = (layer ? 60 : 110) + r() * (layer ? 90 : 120);
            ctx.fillStyle = layer ? "#0b0820" : "#1a1036";
            ctx.fillRect(x, horizon - bh, bw, bh);
            for (let wy = horizon - bh + 6; wy < horizon - 6; wy += 9) {
              for (let wx = x + 4; wx < x + bw - 4; wx += 7) {
                if (r() < 0.32) {
                  ctx.fillStyle = r() < 0.5 ? "#fde047" : r() < 0.5 ? "#22d3ee" : "#f472b6";
                  ctx.globalAlpha = layer ? 0.9 : 0.5;
                  ctx.fillRect(wx, wy, 3, 4);
                }
              }
            }
            ctx.globalAlpha = 1;
            x += bw + 2 + r() * 8;
          }
        }
        ctx.fillStyle = "#0a0118";
        ctx.fillRect(0, horizon, w, h - horizon);
        ctx.strokeStyle = "rgba(236, 72, 153, 0.7)";
        ctx.lineWidth = 1;
        for (let i = 1; i < 12; i++) {
          const y = horizon + (h - horizon) * Math.pow(i / 11, 2);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        for (let i = -16; i <= 16; i++) {
          ctx.beginPath(); ctx.moveTo(w / 2 + i * 10, horizon); ctx.lineTo(w / 2 + i * 90, h); ctx.stroke();
        }
        ctx.fillStyle = "#f472b6";
        ctx.fillRect(0, horizon - 1, w, 2);
      },
    },
  ];

  const cache = new Map();

  /** Returns a canvas with the level's scene, painted once and cached. */
  function scene(level, w, h) {
    const idx = (level - 1) % SCENES.length;
    const k = `${idx}:${w}x${h}`;
    if (cache.has(k)) return cache.get(k);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    SCENES[idx].paint(c.getContext("2d"), w, h, rng(0x5eed + idx * 7919));
    cache.set(k, c);
    return c;
  }

  function sceneName(level) {
    return SCENES[(level - 1) % SCENES.length].name;
  }

  global.VolfiedArt = { scene, sceneName };
})(window);
