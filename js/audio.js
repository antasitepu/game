'use strict';
// Suara: semua efek & musik disintesis lewat WebAudio (tanpa file aset).
(function () {
  const A = BF.audio = { ctx: null, master: null, noiseBuf: null, sfx: true, music: true, last: {}, next: 0, beat: 0, note: 3 };
  const SET_KEY = 'bf.settings';
  const SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25];

  A.load = function () {
    try {
      const o = JSON.parse(localStorage.getItem(SET_KEY) || '{}');
      if (o.sfx !== undefined) A.sfx = !!o.sfx;
      if (o.music !== undefined) A.music = !!o.music;
    } catch (e) { /* pakai default */ }
  };
  A.persist = function () {
    try { localStorage.setItem(SET_KEY, JSON.stringify({ sfx: A.sfx, music: A.music })); } catch (e) { /* abaikan */ }
  };

  // Harus dipanggil dari gestur pengguna (kebijakan autoplay browser).
  A.unlock = function () {
    if (!A.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = A.ctx = new AC();
      A.master = c.createGain();
      A.master.gain.value = 0.5;
      A.master.connect(c.destination);
      A.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = A.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (A.ctx.state === 'suspended') A.ctx.resume();
  };

  function tone(t0, freq, dur, type, vol, slide) {
    const c = A.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(A.master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function noise(t0, dur, vol, freq, type, q) {
    const c = A.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = A.noiseBuf;
    f.type = type || 'bandpass';
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q || 1;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(A.master);
    src.start(t0, Math.random() * 0.4, dur + 0.05);
  }

  // nama → [jeda minimum antar pemutaran (ms), fungsi sintesis]
  const SFX = {
    select: [40, t => tone(t, 700, 0.06, 'sine', 0.12)],
    order: [60, t => { tone(t, 520, 0.05, 'triangle', 0.12); tone(t + 0.06, 660, 0.06, 'triangle', 0.12); }],
    place: [80, t => { noise(t, 0.16, 0.35, 220, 'lowpass'); tone(t, 110, 0.14, 'sine', 0.25, 60); }],
    error: [150, t => tone(t, 150, 0.16, 'square', 0.08, 110)],
    built: [200, t => { tone(t, 392, 0.1, 'triangle', 0.16); tone(t + 0.1, 523, 0.1, 'triangle', 0.16); tone(t + 0.2, 659, 0.18, 'triangle', 0.16); }],
    ready: [150, t => { tone(t, 587, 0.08, 'sine', 0.14); tone(t + 0.09, 784, 0.12, 'sine', 0.14); }],
    tech: [200, t => { for (let i = 0; i < 4; i++) tone(t + i * 0.07, 523 * Math.pow(1.189, i), 0.12, 'sine', 0.12); }],
    clang: [70, t => { noise(t, 0.07, 0.22, 3200, 'highpass'); tone(t, 1400 + Math.random() * 500, 0.09, 'square', 0.035); }],
    arrow: [70, t => noise(t, 0.12, 0.14, 2400 - Math.random() * 600, 'bandpass', 2.5)],
    launch: [150, t => { noise(t, 0.3, 0.25, 500, 'lowpass'); tone(t, 180, 0.3, 'sawtooth', 0.06, 70); }],
    thud: [120, t => { noise(t, 0.35, 0.45, 160, 'lowpass'); tone(t, 90, 0.3, 'sine', 0.3, 40); }],
    death: [110, t => tone(t, 240 + Math.random() * 60, 0.22, 'sawtooth', 0.06, 90)],
    collapse: [250, t => { noise(t, 0.9, 0.5, 300, 'lowpass'); tone(t, 70, 0.8, 'sine', 0.3, 35); }],
    alert: [1500, t => { tone(t, 196, 0.35, 'sawtooth', 0.11); tone(t + 0.38, 196, 0.2, 'sawtooth', 0.11); tone(t + 0.6, 262, 0.5, 'sawtooth', 0.11); }],
    fanfare: [800, t => { [392, 523, 659, 784].forEach((f, i) => tone(t + i * 0.14, f, i === 3 ? 0.6 : 0.16, 'triangle', 0.2)); }],
    win: [1000, t => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(t + i * 0.16, f, i === 5 ? 0.9 : 0.18, 'triangle', 0.2)); }],
    lose: [1000, t => { [392, 349, 311, 262].forEach((f, i) => tone(t + i * 0.26, f, i === 3 ? 1.0 : 0.3, 'sawtooth', 0.1)); }],
  };

  A.play = function (name) {
    const def = SFX[name];
    if (!def || !A.sfx || !A.ctx || A.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (A.last[name] || 0) < def[0]) return;
    A.last[name] = now;
    def[1](A.ctx.currentTime);
  };

  // Ubah event simulasi menjadi suara. Suara tempur hanya untuk kejadian yang terlihat di layar.
  const WORLD = { melee: 'clang', shot: 'arrow', launch: 'launch', impact: 'thud', death: 'death', collapse: 'collapse' };
  const MINE = { built: 'built', trained: 'ready', attacked: 'alert', era: 'fanfare', tech: 'tech' };
  A.handle = function (s, events, view) {
    if (!A.sfx || !A.ctx) return;
    const N = BF.MAP_SIZE;
    for (const e of events) {
      if (WORLD[e.type]) {
        const p = BF.view.toScreen(e.x, e.y);
        if (p.x < -40 || p.y < -40 || p.x > view.w + 40 || p.y > view.h + 40) continue;
        const tx = BF.clamp(e.x | 0, 0, N - 1), ty = BF.clamp(e.y | 0, 0, N - 1);
        if (s.fog.visible[ty * N + tx]) A.play(WORLD[e.type]);
      } else if (MINE[e.type] && e.owner === s.human) A.play(MINE[e.type]);
      else if (e.type === 'over') A.play(e.winner === s.human ? 'win' : 'lose');
    }
  };

  // Musik latar generatif: petikan pentatonik lembut + nada dasar. Dipanggil tiap frame.
  A.tickMusic = function (active) {
    const c = A.ctx;
    if (!c || c.state !== 'running') return;
    if (!A.music || !active) { A.next = 0; return; }
    if (A.next < c.currentTime) A.next = c.currentTime + 0.1;
    while (A.next < c.currentTime + 0.4) {
      const t = A.next, b = A.beat++;
      if (b % 8 === 0) tone(t, SCALE[0] / 2, 3.6, 'sine', 0.05);
      if (b % 8 === 4) tone(t, SCALE[b % 16 === 4 ? 4 : 2] / 2, 1.8, 'sine', 0.035);
      if (Math.random() < 0.62) {
        A.note = BF.clamp(A.note + ((Math.random() * 5) | 0) - 2, 0, SCALE.length - 1);
        tone(t, SCALE[A.note], 0.9, 'triangle', 0.03);
      }
      A.next += 0.48;
    }
  };
})();
