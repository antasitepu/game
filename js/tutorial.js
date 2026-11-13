'use strict';
// Tutorial: permainan terpandu melawan satu pos musuh kecil (AI lawan dimatikan). Panel di kiri atas menampilkan satu
// langkah; langkah dianggap selesai saat keadaan permainan memenuhi syaratnya, lalu berlanjut ke langkah berikutnya.
// Hanya untuk permainan tunggal: keadaan awal diubah langsung di state (markas musuh diganti pos kecil, stok ditambah).
(function () {
  const $ = id => document.getElementById(id), idx = BF.idx, dist = BF.dist;
  const tut = BF.tutorial = { active: false, i: 0, doneAt: 0, cam0: null, post: 0 };
  const DELAY = 1400;                                       // jeda "selesai" sebelum langkah berikutnya (ms)

  const mine = (s, type) => s.units.filter(u => u.owner === s.human && !u.dead && (!type || u.type === type));
  const gathering = (s, res) => mine(s, 'worker').filter(u => u.order.type === 'gather' && u.order.res === res).length;
  const built = (s, type) => s.buildings.some(b => b.owner === s.human && b.type === type && b.built && !b.dead);

  // done(s): syarat selesai. enter(s): dijalankan sekali saat langkah mulai. tick(s): tiap frame selama langkah aktif.
  const STEPS = [
    {
      title: 'Gerakkan kamera',
      text: 'Geser kamera dengan tombol panah atau dorong kursor ke tepi layar. Roda mouse untuk zoom, tombol [ dan ] untuk memutar.',
      done() { const c = BF.game.cam, o = tut.cam0; return dist(c.x - o.x, c.y - o.y) > 3 || Math.abs(c.zoom - o.zoom) > o.zoom * 0.1 || Math.abs(c.yaw - o.yaw) > 0.2; },
    },
    {
      title: 'Pilih pekerja',
      text: 'Seret kotak di sekeliling para pekerja di depan Balai Kota, atau klik ganda salah satunya.',
      done: s => BF.ui.entities(s).filter(e => e.kind === 'unit' && e.owner === s.human && e.type === 'worker').length >= 2,
    },
    {
      title: 'Kumpulkan pangan',
      text: 'Dengan pekerja terpilih, klik kanan semak beri (buah merah) di dekat markas. Rusa bisa diburu dengan cara yang sama.',
      done: s => gathering(s, 'food') >= 2,
    },
    {
      title: 'Tebang kayu',
      text: 'Pilih dua pekerja lain, lalu klik kanan sebatang pohon. Kayu dipakai untuk hampir semua bangunan.',
      done: s => gathering(s, 'wood') >= 1,
    },
    {
      title: 'Bangun Rumah',
      text: 'Rumah menaikkan batas populasi. Pilih seorang pekerja, tekan Q, lalu klik lahan kosong di dekat Balai Kota.',
      done: s => built(s, 'house'),
    },
    {
      title: 'Latih pekerja',
      text: 'Tekan H untuk memilih Balai Kota, lalu Q dua kali untuk melatih dua Pekerja. Makin banyak pekerja, makin cepat ekonomi tumbuh.',
      done: s => mine(s, 'worker').length >= 6,
    },
    {
      title: 'Bangun Barak',
      text: 'Pilih pekerja, tekan R, lalu klik lahan kosong. Beberapa pekerja sekaligus membangun lebih cepat.',
      done: s => built(s, 'barracks'),
    },
    {
      title: 'Latih pasukan',
      text: 'Klik Barak, lalu tekan Q tiga kali untuk melatih tiga Prajurit Tombak.',
      done: s => mine(s, 'spear').length >= 3,
    },
    {
      title: 'Robohkan pos musuh',
      text: 'Seret kotak untuk memilih prajuritmu, lalu klik kanan pos musuh. Lingkaran kuning yang berkedip di minimap menunjukkan letaknya. Robohkan untuk menang.',
      enter(s) {                                            // pos musuh ditampilkan di peta (sudah "dijelajahi")
        const b = s.byId.get(tut.post);
        if (!b) return;
        for (let y = b.ty - 3; y <= b.ty + b.size + 2; y++) for (let x = b.tx - 3; x <= b.tx + b.size + 2; x++) if (BF.inBounds(x, y)) s.fog.explored[idx(x, y)] = 1;
        s.fog.version++;
      },
      tick(s) {                                             // penanda berkedip di minimap (memakai penanda "diserang")
        const b = s.byId.get(tut.post), p = s.players[s.human];
        if (b && s.tick - p.alertTick > 100) { p.alertTick = s.tick; p.alertX = b.tx + b.size / 2; p.alertY = b.ty + b.size / 2; }
      },
      done: s => s.over && s.winner === s.human,
    },
  ];
  tut.STEPS = STEPS;

  function render(done) {
    const st = STEPS[tut.i], last = tut.i === STEPS.length - 1;
    $('tut-step').textContent = `Tutorial · ${tut.i + 1}/${STEPS.length}`;
    $('tut-title').textContent = (done ? '✓ ' : '') + st.title;
    $('tut-text').textContent = !done ? st.text : last ? 'Tutorial selesai. Sekarang coba permainan penuh melawan AI.' : 'Bagus!';
    $('tutorial').classList.toggle('done', !!done);
  }

  tut.stop = function () {
    tut.active = false;
    $('tutorial').classList.add('hidden');
  };

  // Mulai permainan tutorial dengan wangsa pilihan pemain.
  tut.start = function (faction) {
    const fk = Object.keys(BF.FACTIONS), game = BF.game;
    game.start({ difficulty: 'easy', factions: [faction, fk.find(k => k !== faction)], seed: 4202 });
    const s = game.s, me = s.human, foe = 1 - me, map = s.map;
    s.tutorial = true;                                      // (tidak ikut tersimpan; simpanan otomatis dilewati di main.js)
    s.players[foe].isAI = false;
    s.players[me].res = { food: 400, wood: 400, gold: 100, stone: 100 };
    // pos musuh: satu rumah dijaga satu prajurit bersikap bertahan, ±16 tile dari markas ke arah tengah peta
    const th = s.buildings.find(b => b.owner === me && b.type === 'townhall'), hx = th.tx + 1.5, hy = th.ty + 1.5;
    const dx = BF.MAP_SIZE / 2 - hx, dy = BF.MAP_SIZE / 2 - hy, l = dist(dx, dy) || 1, reg = map.region[idx(th.tx, th.ty + 3)];
    let spot = null;
    for (let d = 16; d < 34 && !spot; d++)
      for (let r = 0; r < 4 && !spot; r++)
        for (let k = -r; k <= r && !spot; k++)
          for (const [x, y] of [[k, r], [r, k], [k, -r], [-r, k]]) {
            const tx = Math.round(hx + dx / l * d) + x, ty = Math.round(hy + dy / l * d) + y;
            if (!spot && BF.canPlace(map, 'house', tx, ty) && map.region[idx(tx, ty)] === reg) spot = { tx, ty };
          }
    if (!spot) { BF.hud.toast('Tutorial tidak bisa disiapkan di peta ini.'); return; }
    const post = BF.spawnBuilding(s, 'house', foe, spot.tx, spot.ty, true);
    const g = BF.findFreeNear(map, spot.tx + 1, spot.ty + 3, 5, foe), guard = BF.spawnUnit(s, 'spear', foe, g.x + 0.5, g.y + 0.5);
    guard.stance = 1;
    // markas musuh yang asli disingkirkan tanpa bekas: pos tadi menjadi satu-satunya bangunannya
    for (const e of s.units.concat(s.buildings)) if (e.owner === foe && e !== post && e !== guard) BF.kill(s, e, true);
    s.effects.length = 0;
    s.events.length = 0;
    tut.post = post.id;
    tut.i = 0;
    tut.doneAt = 0;
    tut.cam0 = { x: game.cam.x, y: game.cam.y, zoom: game.cam.zoom, yaw: game.cam.yaw };
    tut.active = true;
    $('tutorial').classList.remove('hidden');
    render(false);
    BF.hud.toast('Tutorial: ikuti petunjuk di kiri atas.');
  };

  // Dipanggil tiap frame selama permainan berjalan (lewat BF.hud.update).
  tut.update = function (s) {
    if (!tut.active) return;
    if (!s.tutorial) { tut.stop(); return; }                // permainan lain dimulai atau dimuat
    const st = STEPS[tut.i], now = performance.now();
    if (tut.doneAt) {
      if (now - tut.doneAt < DELAY || tut.i === STEPS.length - 1) return;
      tut.doneAt = 0;
      tut.i++;
      if (STEPS[tut.i].enter) STEPS[tut.i].enter(s);
      render(false);
      return;
    }
    if (st.tick) st.tick(s);
    if (st.done(s)) { tut.doneAt = now; BF.audio.play('tech'); render(true); }
  };

  window.addEventListener('load', () => {
    const hu = BF.hud.update, start = BF.game.start, stop = BF.game.stop;
    BF.hud.update = s => { hu(s); tut.update(s); };
    BF.game.start = opts => { tut.stop(); start(opts); };   // permainan apa pun yang dimulai menutup tutorial yang sedang berjalan
    BF.game.stop = () => { tut.stop(); stop(); };
    $('btn-tutorial').addEventListener('click', () => { if (BF.game.ready) tut.start(BF.menu.faction); });
    $('tut-close').addEventListener('click', tut.stop);
  });
})();
