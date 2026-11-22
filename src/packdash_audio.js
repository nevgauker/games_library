// Pack & Dash! sound effects, synthesised with WebAudio (no assets).
(function(global){
  function createAudio(){
    let ctx = null, master = null, enabled = true;

    function ensure(){
      if (!enabled) return null;
      if (!ctx){
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(freq, dur, { type = 'square', vol = 0.2, at = 0, slide = 0 } = {}){
      const c = ensure(); if (!c) return;
      const t0 = c.currentTime + at;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }

    function noise(dur, { vol = 0.1, at = 0, freq = 1200 } = {}){
      const c = ensure(); if (!c) return;
      const t0 = c.currentTime + at;
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol;
      src.buffer = buf; src.connect(f); f.connect(g); g.connect(master);
      src.start(t0);
    }

    const sfx = {
      step(){ noise(0.04, { vol: 0.05, freq: 700 }); },
      packTick(){ tone(660, 0.04, { type: 'triangle', vol: 0.06 }); },
      pack(){ [523, 659, 784].forEach((f, i) => tone(f, 0.09, { type: 'triangle', vol: 0.16, at: i * 0.06 })); },
      spotted(){ tone(880, 0.08, { vol: 0.12 }); tone(1175, 0.12, { vol: 0.12, at: 0.08 }); },
      bossTalk(){ tone(196, 0.35, { type: 'sawtooth', vol: 0.12, slide: -60 }); },
      murmur(){ tone(140 + Math.random() * 90, 0.08, { type: 'sawtooth', vol: 0.05 }); },
      excuse(){ noise(0.08, { vol: 0.12, freq: 2400 }); tone(500, 0.06, { type: 'triangle', vol: 0.06, slide: 300 }); },
      coworker(){ tone(740, 0.07, { type: 'triangle', vol: 0.12 }); tone(988, 0.1, { type: 'triangle', vol: 0.12, at: 0.07 }); },
      heart(){ [784, 988, 1319].forEach((f, i) => tone(f, 0.12, { type: 'sine', vol: 0.14, at: i * 0.05 })); },
      ding(){ tone(1319, 0.5, { type: 'sine', vol: 0.18 }); tone(1047, 0.7, { type: 'sine', vol: 0.18, at: 0.22 }); },
      jam(){ noise(0.18, { vol: 0.08, freq: 500 }); tone(110, 0.15, { type: 'square', vol: 0.05 }); },
      tick(){ tone(1600, 0.03, { type: 'square', vol: 0.05 }); },
      win(){ [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.14, { type: 'triangle', vol: 0.16, at: i * 0.09 })); },
      lose(){ [392, 370, 349, 294].forEach((f, i) => tone(f, i === 3 ? 0.6 : 0.22, { type: 'sawtooth', vol: 0.1, at: i * 0.22, slide: i === 3 ? -40 : 0 })); },
      star(n){ tone(880 + n * 220, 0.12, { type: 'triangle', vol: 0.14 }); },
    };

    return {
      ...sfx,
      unlock: ensure,
      get enabled(){ return enabled; },
      setEnabled(v){ enabled = !!v; if (!enabled && ctx) ctx.suspend(); else ensure(); },
    };
  }
  global.createPackDashAudio = createAudio;
})(window);
