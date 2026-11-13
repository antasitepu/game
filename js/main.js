'use strict';
// Bootstrap: loop utama (simulasi fixed-timestep + render 3D), ukuran kanvas, mulai/berhenti permainan.
(function () {
  const MM_SIZE = 170, SPEEDS = [1, 1.5, 2], AUTOSAVE_TICKS = 3 * 60 * BF.TICK_RATE;
  const $ = id => document.getElementById(id);
  // cam: sasaran kamera di tanah (x, y dalam tile), sudut putar (yaw), dan zoom (tinggi bidang pandang dalam tile)
  const game = BF.game = {
    s: null, ready: false, running: false, paused: false, menuOpen: false, speed: 1, w: 0, h: 0, dpr: 1, canvas: null,
    cam: { x: BF.MAP_SIZE / 2, y: BF.MAP_SIZE / 2, yaw: BF.view.YAW_DEFAULT, zoom: BF.view.ZOOM_DEFAULT },
  };
  let fx, mmCtx, acc = 0, last = 0, frameNo = 0, drawn = 0;

  function resize() {
    const dpr = game.dpr = window.devicePixelRatio || 1, mm = $('minimap'), f = $('fx');
    game.w = window.innerWidth;
    game.h = window.innerHeight;
    // bagian layar yang tertutup HUD: bar atas, dan di bawah — panel penuh (layar biasa) atau hanya setinggi kotak info
    // (layar pendek: panel melayang, peta terlihat di sela-selanya)
    BF.ui.inset = { top: $('topbar').offsetHeight, bottom: window.matchMedia('(max-height: 540px)').matches ? $('info').offsetHeight + 12 : $('bottom').offsetHeight };
    BF.gfx.resize(game.w, game.h, dpr);
    f.width = Math.round(game.w * dpr);
    f.height = Math.round(game.h * dpr);
    mm.width = mm.height = Math.round(MM_SIZE * dpr);
  }

  game.setPaused = function (on) {
    game.paused = !!on;
    $('paused').classList.toggle('hidden', !game.paused || game.menuOpen);
    $('btn-pause').textContent = game.paused ? 'Lanjut' : 'Jeda';
  };

  game.togglePause = function () {
    const s = game.s;
    if (!game.running || !s || s.over || game.menuOpen) return;
    if (s.mp) { BF.hud.toast('Multiplayer tidak bisa dijeda'); return; }
    game.setPaused(!game.paused);
  };

  function setSpeed(v) {
    game.speed = v;
    $('btn-speed').textContent = v + '×';
  }

  // opts: {state} untuk memuat simpanan, atau {difficulty, factions, players, seed, mp, human} untuk permainan baru.
  game.start = function (opts) {
    BF.audio.unlock();
    const s = game.s = opts.state || BF.newGame({
      difficulty: opts.difficulty, factions: opts.factions, players: opts.players, seed: opts.seed, mp: opts.mp, human: opts.human,
      ai: BF.SLOTS.map((q, i) => !opts.mp && i > 0),
    });
    game.running = true;
    game.menuOpen = false;
    acc = 0;
    game.setPaused(false);
    setSpeed(1);
    BF.ui.reset();
    game.cam.yaw = BF.view.YAW_DEFAULT;
    game.cam.zoom = BF.view.ZOOM_DEFAULT;
    const home = s.buildings.find(b => b.owner === s.human && b.type === 'townhall') || s.buildings.find(b => b.owner === s.human);
    if (home) BF.input.centerOn(home.tx + home.size / 2, home.ty + home.size / 2);
    for (const id of ['overlay-start', 'overlay-end', 'overlay-help', 'overlay-menu']) $(id).classList.add('hidden');
    $('btn-speed').classList.toggle('hidden', s.mp);
    $('btn-pause').classList.toggle('hidden', s.mp);
    const foes = s.players.filter(p => p.id !== s.human);
    BF.hud.toast(opts.state ? 'Permainan dimuat.' : 'Kumpulkan sumber daya, bangun pasukan, robohkan markas ' + (foes.length === 1 ? foes[0].name : 'semua lawan') + '!');
  };

  game.stop = function () {
    game.running = false;
    game.menuOpen = false;
    game.setPaused(false);
  };

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000), s = game.s;
    last = now;
    if (s && game.running) {
      if (!game.paused && !s.over) {
        acc += dt * (s.mp ? 1 : game.speed);
        let n = 0;
        while (acc >= BF.DT && n < 8) {
          if (!BF.net.advance(s)) { acc = Math.min(acc, BF.DT); break; } // menunggu paket lawan
          acc -= BF.DT;
          n++;
          if (!s.mp && !s.tutorial && !s.over && s.tick % AUTOSAVE_TICKS === 0) BF.save.write('auto', s);
        }
        if (acc > BF.DT * 8) acc = 0;
      }
      BF.input.update(dt);
      // Simulasi maju tiap frame layar; gambar dibatasi sesuai mutu grafis (mode hemat: 30 kali per detik). Batasnya
      // dilonggarkan 3 ms supaya getar waktu antar-frame tidak membuat satu gambar terlewat.
      if (now - drawn >= 1000 / BF.gfx.QUALITY[BF.gfx.quality].fps - 3) {
        drawn = now;
        // alpha: posisi di antara dua tick simulasi, agar gerak unit mulus pada 60 fps
        BF.render({ fx, w: game.w, h: game.h, dpr: game.dpr, cam: game.cam, s, ui: BF.ui, alpha: game.paused || s.over ? 1 : Math.min(1, acc / BF.DT) });
        if (frameNo++ % 4 === 0) {
          mmCtx.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);
          BF.renderMinimap(mmCtx, MM_SIZE, s);
        }
      }
      BF.hud.update(s);
    }
    BF.audio.tickMusic(!!s && game.running && !game.paused && !s.over);
    requestAnimationFrame(frame);
  }

  function init() {
    game.canvas = $('game');
    fx = $('fx').getContext('2d');
    mmCtx = $('minimap').getContext('2d');
    BF.gfx.init(game.canvas);
    resize();
    window.addEventListener('resize', resize);
    BF.hud.init();
    BF.input.init(game.canvas, $('minimap'));
    BF.menu.init();
    $('btn-pause').addEventListener('click', game.togglePause);
    $('btn-idle').addEventListener('click', BF.input.nextIdleWorker);
    $('btn-speed').addEventListener('click', () => setSpeed(SPEEDS[(SPEEDS.indexOf(game.speed) + 1) % SPEEDS.length]));
    game.ready = true;
    requestAnimationFrame(frame);
  }

  // Aset (model, tekstur, langit) dimuat dulu; tanpa server (file dibuka langsung) aset tidak bisa diambil.
  window.addEventListener('load', () => {
    BF.assets.muat().then(init, e => {
      const b = $('btn-start');
      b.disabled = true;
      b.textContent = 'Aset gagal dimuat — jalankan "node server.js" lalu buka alamatnya';
      console.error('Gagal memuat aset: ' + e.message);
    });
  });
})();
