'use strict';
// Multiplayer sungguhan: server.js + dua halaman browser. Memeriksa lobi, lockstep (hash state identik),
// perintah lintas pemain, pembatasan (jeda/simpan), latensi, dan penanganan lawan keluar. Juga keamanan server statis.
const { spawn } = require('child_process');
const path = require('path');
const { request, sleep } = require('../cdp');
const H = require('../helpers');

module.exports = async ({ page, check, root }) => {
  const PORT = 8700 + (process.pid % 200), base = 'http://127.0.0.1:' + PORT;
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1' }), stdio: 'ignore' });
  try {
    await sleep(700);
    // ---- server statis: hanya file game yang boleh diakses
    const codes = {};
    for (const u of ['/', '/js/config.js', '/js/models.js', '/js/vendor/three.min.js', '/css/style.css', '/assets/manifest.json', '/assets/m/pohon0.bin', '/assets/t/rumput.jpg', '/assets/../server.js', '/assets/%2e%2e/server.js', '/tools/aset/olah.mjs', '/js/assets.json', '/server.js', '/tests/sim.test.js', '/js/../server.js', '/%2e%2e/%2e%2e/etc/passwd', '/js/%2e%2e/server.js', '/js/nope.js', '/js/vendor/THREE-LICENSE.txt'])
      codes[u] = (await request('GET', base + u)).status;
    check('server menyajikan file game (termasuk three.js & aset)', ['/', '/js/config.js', '/js/models.js', '/js/vendor/three.min.js', '/css/style.css', '/assets/manifest.json', '/assets/m/pohon0.bin', '/assets/t/rumput.jpg'].every(u => codes[u] === 200), codes);
    check('server menolak file di luar game & path traversal', ['/assets/../server.js', '/assets/%2e%2e/server.js', '/tools/aset/olah.mjs', '/js/assets.json', '/server.js', '/tests/sim.test.js', '/js/../server.js', '/%2e%2e/%2e%2e/etc/passwd', '/js/%2e%2e/server.js', '/js/nope.js', '/js/vendor/THREE-LICENSE.txt'].every(u => codes[u] === 404), codes);
    check('server menolak metode selain GET/HEAD', (await request('POST', base + '/')).status === 405);

    const a = await page(base + '/'), b = await page(base + '/');
    const hidden = (p, id) => p.ev(`document.getElementById('${id}').classList.contains('hidden')`);

    // ---- lobi
    await a.clickEl('#mode-tabs button[data-mode="mp"]');
    check('alamat server terisi otomatis', (await a.ev(`document.getElementById('mp-addr').value`)) === '127.0.0.1:' + PORT);
    await b.clickEl('#mode-tabs button[data-mode="mp"]');
    await b.clickEl('#mp-code');
    await b.type('zzzz');
    await b.clickEl('#mp-join');
    await sleep(500);
    check('kode ruangan salah → pesan error, tetap di form', (await b.ev(`document.getElementById('mp-status').textContent`)).includes('tidak ditemukan') && !(await hidden(b, 'mp-connect')));

    await a.clickEl('#mp-create');
    await sleep(500);
    const code = await a.ev(`BF.net.code`);
    check('tuan rumah mendapat kode ruangan 4 karakter', /^[A-Z0-9]{4}$/.test(code) && !(await hidden(a, 'mp-lobby')) && await a.ev(`document.getElementById('mp-start').disabled`), code);
    await b.clickEl('#factions .faction:nth-child(2)');   // tamu memilih Bara
    await b.ev(`document.getElementById('mp-code').value = ''`);
    await b.clickEl('#mp-code');
    await b.type(code.toLowerCase());
    await b.clickEl('#mp-join');
    await sleep(700);
    check('tamu masuk lobi sebagai slot 1', await b.ev(`BF.net.slot === 1 && BF.menu.inLobby`) && (await hidden(b, 'mp-start')));
    check('kedua pihak saling melihat wangsa lawan', await a.ev(`BF.menu.peer === 'bara' && !document.getElementById('mp-start').disabled`) && await b.ev(`BF.menu.peer === 'samudra'`));
    await a.clickEl('#factions .faction:nth-child(4)');   // tuan rumah ganti ke Padang
    await sleep(300);
    check('ganti wangsa di lobi tersiar ke lawan', await b.ev(`BF.menu.peer === 'padang'`));

    // ---- mulai
    await a.clickEl('#mp-start');
    await sleep(900);
    const info = `({ run: BF.game.running, mp: BF.game.s.mp, human: BF.game.s.human, seed: BF.game.s.seed, f: BF.game.s.players.map(q => q.faction).join(), ai: BF.game.s.players.some(q => q.isAI) })`;
    const ga = await a.ev(info), gb = await b.ev(info);
    check('kedua pemain masuk permainan yang sama (seed & wangsa), tanpa AI', ga.run && gb.run && ga.mp && gb.mp && ga.human === 0 && gb.human === 1 && ga.seed === gb.seed && ga.f === 'padang,bara' && gb.f === ga.f && !ga.ai && !gb.ai, { ga, gb });
    check('tombol jeda & kecepatan disembunyikan', (await hidden(a, 'btn-pause')) && (await hidden(a, 'btn-speed')));
    for (const p of [a, b]) await p.ev(`(() => { window.__h = {}; const st = BF.step; BF.step = s => { st(s); if (s.tick % 20 === 0) window.__h[s.tick] = BF.hash(s); }; })()`);

    // ---- perintah dari kedua sisi dengan input sungguhan
    const selectWorkers = async (p, owner) => {
      const box = await p.ev(H.workersBox(owner));
      await p.drag(box.x0, box.y0, box.x1, box.y1);
      await sleep(120);
    };
    await selectWorkers(a, 0);
    const berry = await a.ev(H.node('BF.N_BERRY', 0));
    await a.click(berry.x, berry.y, 'right');
    await selectWorkers(b, 1);
    check('tamu mengendalikan pasukannya sendiri (merah)', await b.ev(`BF.ui.sel.length === 4 && BF.ui.entities(BF.game.s).every(u => u.owner === 1)`));
    await b.key('q', 'KeyQ', 81);
    const spot = (await b.ev(H.spots('house', 1, 1)))[0];
    await b.click(spot.x, spot.y);
    await b.key('h', 'KeyH', 72);
    await sleep(100);
    await b.key('q', 'KeyQ', 81);
    await sleep(7000);

    // ---- lockstep: hash state harus identik di tick yang sama
    const ha = await a.ev(`window.__h`), hb = await b.ev(`window.__h`);
    const common = Object.keys(ha).filter(k => k in hb), diff = common.filter(k => ha[k] !== hb[k]);
    const ta = await a.ev(`BF.game.s.tick`), tb = await b.ev(`BF.game.s.tick`);
    check('simulasi berjalan di kedua sisi dengan kecepatan nyata', ta > 100 && tb > 100 && Math.abs(ta - tb) <= 10, { ta, tb });
    check('hash state identik di semua tick yang dibandingkan', common.length >= 5 && diff.length === 0, { dibandingkan: common.length, beda: diff.length });
    check('tidak ada desinkronisasi terdeteksi', await a.ev(`!BF.net.desync`) && await b.ev(`!BF.net.desync`));
    check('perintah tuan rumah berlaku di simulasi tamu', (await b.ev(`BF.game.s.units.filter(u => u.owner === 0 && u.order.type === 'gather' && u.order.res === 'food').length`)) === 4);
    check('perintah tamu berlaku di simulasi tuan rumah', await a.ev(`(() => { const s = BF.game.s; return s.buildings.some(q => q.owner === 1 && q.type === 'house') && s.players[1].res.food === 200 && s.players[1].res.wood === 220; })()`), await a.ev(`BF.game.s.players[1].res`));
    check('kabut perang per pemain: tamu tidak melihat markas tuan rumah', await b.ev(`(() => { const s = BF.game.s, th = s.buildings.find(q => q.owner === 0); return !BF.buildingSeen(s, th); })()`));
    await b.shot('30-multiplayer-tamu');

    // ---- pembatasan multiplayer
    await a.key('p', 'KeyP', 80);
    await sleep(200);
    check('P tidak menjeda multiplayer', await a.ev(`!BF.game.paused && document.getElementById('toast').textContent.includes('tidak bisa dijeda')`));
    await a.clickEl('#btn-menu');
    await sleep(150);
    const t1 = await a.ev(`BF.game.s.tick`);
    await sleep(500);
    check('Menu di multiplayer: simpan/muat nonaktif, permainan tetap jalan', await a.ev(`document.getElementById('m-save').disabled && document.getElementById('m-load').disabled`) && (await a.ev(`BF.game.s.tick`)) > t1);
    await a.clickEl('#m-resume');

    // ---- paket nakal dari lawan diabaikan (unit milik tuan rumah tidak bisa diperintah tamu)
    await b.ev(`(() => { const s = BF.game.s; BF.issue({ c: 'destroy', ids: s.units.filter(u => u.owner === 0).map(u => u.id).concat(s.buildings.filter(q => q.owner === 0).map(q => q.id)) }); BF.issue({ c: 'move', ids: s.units.filter(u => u.owner === 0).map(u => u.id), x: 1, y: 1 }); })()`);
    await sleep(800);
    check('lawan tidak bisa memerintah/menghancurkan milik kita', await a.ev(`(() => { const s = BF.game.s; return s.units.filter(u => u.owner === 0).length === 4 && s.buildings.some(q => q.owner === 0 && q.type === 'townhall') && s.units.filter(u => u.owner === 0).every(u => u.order.type === 'gather'); })()`) && await a.ev(`!BF.net.desync`));

    // ---- latensi jaringan 300 ms per arah: lebih lambat, tetapi tidak macet dan tetap sinkron
    for (const p of [a, b]) await p.ev(`(() => { const ws = BF.net.ws, send = ws.send.bind(ws); ws.send = d => setTimeout(() => { if (ws.readyState === 1) send(d); }, 300); window.__h = {}; })()`);
    const l0 = await a.ev(`BF.game.s.tick`);
    await sleep(5000);
    const la = await a.ev(`window.__h`), lb = await b.ev(`window.__h`), l1 = await a.ev(`BF.game.s.tick`);
    const lc = Object.keys(la).filter(k => k in lb);
    check('dengan latensi 300 ms: permainan tetap maju & hash identik', l1 - l0 > 20 && lc.length >= 2 && lc.every(k => la[k] === lb[k]) && await a.ev(`!BF.net.desync`) && await b.ev(`!BF.net.desync`), { majuTick: l1 - l0, dibandingkan: lc.length });

    // ---- mekanik baru di multiplayer: berburu, memperbaiki, berlindung, sikap, patroli, berdagang
    // Keadaan uji (stok, era, pasar, menara, pasukan) dipasang lewat perintah khusus '__uji' yang dieksekusi kedua sisi
    // pada turn yang sama — mengubah state langsung di satu sisi saja akan merusak sinkronisasi.
    const SETUP = `(() => { const ex = BF.exec; BF.exec = (s, pid, c) => {
      if (!c || c.c !== '__uji') return ex(s, pid, c);
      s.players.forEach((q, o) => {
        q.res = { food: 2000, wood: 2000, gold: 2000, stone: 2000 }; q.era = 1; q.popCap = 60;
        const th = s.buildings.find(b => b.owner === o && b.type === 'townhall');
        th.hp = 1200;
        const place = (type, dx, dy) => { for (let r = 0; r < 14; r++) for (let d = -r; d <= r; d++) for (const [x, y] of [[th.tx + dx + d, th.ty + dy + r], [th.tx + dx + r, th.ty + dy + d], [th.tx + dx + d, th.ty + dy - r], [th.tx + dx - r, th.ty + dy + d]]) if (BF.canPlace(s.map, type, x, y)) return BF.spawnBuilding(s, type, o, x, y, true); };
        place('market', 5, 5); place('tower', -3, 4);
        for (let i = 0; i < 5; i++) { const f = BF.findFreeNear(s.map, th.tx + 1 + i, th.ty + 5, 6, o); BF.spawnUnit(s, i < 3 ? 'spear' : 'archer', o, f.x + 0.5, f.y + 0.5); }
      });
    }; })()`;
    for (const p of [a, b]) await p.ev(SETUP);
    await a.ev(`BF.issue({ c: '__uji' })`);
    await sleep(1500);
    const ready = `(() => { const s = BF.game.s; return s.buildings.filter(q => q.type === 'market').length === 2 && s.buildings.filter(q => q.type === 'tower').length === 2 && s.units.filter(u => u.type === 'spear').length === 6; })()`;
    check('keadaan uji terpasang identik di kedua sisi', await a.ev(ready) && await b.ev(ready) && await a.ev(`!BF.net.desync`) && await b.ev(`!BF.net.desync`));
    for (const p of [a, b]) await p.ev(`window.__h = {}`);
    const orders = (me, stance, sell, buy) => `(() => { const s = BF.game.s, me = ${me}, ids = k => s.units.filter(u => u.owner === me && u.type === k).map(u => u.id);
      const own = t => s.buildings.find(q => q.owner === me && q.type === t), th = own('townhall'), w = ids('worker');
      const deer = s.animals.filter(q => q.type === 'deer' && q.state !== 'carcass').sort((x, y) => BF.dist(x.x - th.tx, x.y - th.ty) - BF.dist(y.x - th.tx, y.y - th.ty))[0];
      BF.issue({ c: 'repair', ids: w.slice(0, 2), bid: th.id });
      BF.issue({ c: 'hunt', ids: w.slice(2), aid: deer.id });
      BF.issue({ c: 'garrison', ids: ids('spear').slice(0, 2), bid: own('tower').id });
      BF.issue({ c: 'patrol', ids: ids('spear').slice(2), x: th.tx + 7, y: th.ty + 8 });
      BF.issue({ c: 'stance', ids: ids('archer'), v: ${stance} });
      BF.issue({ c: 'trade', bid: own('market').id, res: '${sell}', buy: false });
      BF.issue({ c: 'trade', bid: own('market').id, res: '${buy}', buy: true });
      window.__mk = own('market').id; })()`;
    await a.ev(orders(0, 1, 'wood', 'food'));
    await sleep(400);
    await b.ev(orders(1, 2, 'stone', 'food'));
    // satu transaksi lewat tombol panel sungguhan (jalur UI → jaringan)
    await a.ev(`BF.ui.select([window.__mk])`);
    await sleep(400);
    await a.clickEl('#cmds .cmd:nth-child(2)');   // W: Jual Kayu
    await sleep(8000);
    const seen = me => `(() => { const s = BF.game.s, me = ${me}, us = s.units.filter(u => u.owner === me), tw = s.buildings.find(q => q.owner === me && q.type === 'tower'), th = s.buildings.find(q => q.owner === me && q.type === 'townhall');
      return { dalam: tw.inside.length, sikap: us.filter(u => u.type === 'archer').map(u => u.stance).join(''), patroli: us.filter(u => u.type === 'spear' && (u.order.type === 'patrol' || (u.order.resume && u.order.resume.type === 'patrol'))).length,
        hpBalai: Math.round(th.hp), buru: us.filter(u => u.order.animal).length + us.filter(u => u.type === 'worker' && u.order.type === 'gather' && u.order.state === 'return').length, harga: Object.keys(s.market).map(r => s.market[r].toFixed(1)).join('/') }; })()`;
    const hostAtGuest = await b.ev(seen(0)), guestAtHost = await a.ev(seen(1));
    check('perintah baru tuan rumah berlaku di simulasi tamu', hostAtGuest.dalam === 2 && hostAtGuest.sikap === '11' && hostAtGuest.patroli === 1 && hostAtGuest.hpBalai > 1300 && hostAtGuest.buru >= 1, hostAtGuest);
    check('perintah baru tamu berlaku di simulasi tuan rumah', guestAtHost.dalam === 2 && guestAtHost.sikap === '22' && guestAtHost.patroli === 1 && guestAtHost.hpBalai > 1300 && guestAtHost.buru >= 1, guestAtHost);
    const price = await a.ev(`BF.game.s.market`);
    check('harga pasar bergeser oleh transaksi kedua pemain', price.wood < 95 && price.stone < 128 && price.food > 105, price);
    for (const [p, me] of [[a, 0], [b, 1]]) await p.ev(`BF.issue({ c: 'ungarrison', bid: BF.game.s.buildings.find(q => q.owner === ${me} && q.type === 'tower').id })`);
    await sleep(2500);
    const out = `BF.game.s.buildings.filter(q => q.type === 'tower').every(q => q.inside.length === 0) && BF.game.s.units.filter(u => u.type === 'spear').length === 6`;
    check('keluar dari menara berlaku di kedua sisi', await a.ev(out) && await b.ev(out));
    const na = await a.ev(`window.__h`), nb = await b.ev(`window.__h`), nc = Object.keys(na).filter(k => k in nb), nd = nc.filter(k => na[k] !== nb[k]);
    check('mekanik baru: hash state tetap identik, tanpa desinkronisasi', nc.length >= 4 && nd.length === 0 && await a.ev(`!BF.net.desync`) && await b.ev(`!BF.net.desync`), { dibandingkan: nc.length, beda: nd.length });

    // ---- tamu keluar → tuan rumah menang
    await b.clickEl('#btn-menu');
    await sleep(100);
    await b.clickEl('#m-quit');
    await sleep(700);
    check('tamu kembali ke menu awal', !(await hidden(b, 'overlay-start')) && await b.ev(`!BF.game.running && !BF.net.active`));
    check('tuan rumah: "Lawan keluar" & dinyatakan menang', !(await hidden(a, 'overlay-end')) && await a.ev(`BF.game.s.over && BF.game.s.winner === 0 && document.getElementById('end-text').textContent.includes('Lawan keluar') && document.getElementById('end-title').textContent === 'Kemenangan!'`));
  } finally {
    srv.kill();
  }
};
