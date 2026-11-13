'use strict';
// Multiplayer 3–4 manusia (semua lawan semua): server.js + empat halaman browser. Memeriksa lobi berkursi empat,
// ruangan penuh/terkunci, lockstep empat klien (hash identik), pemain keluar di tengah permainan (dianggap menyerah,
// yang lain tetap sinkron), pemain tumbang (selesai di layarnya saja), dan pemenang terakhir.
const { spawn } = require('child_process');
const path = require('path');
const { sleep } = require('../cdp');

module.exports = async ({ page, check, root }) => {
  const PORT = 8900 + (process.pid % 90), base = 'http://127.0.0.1:' + PORT;
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1' }), stdio: 'ignore' });
  try {
    await sleep(700);
    const P = [];
    for (let i = 0; i < 4; i++) P.push(await page(base + '/'));
    const [a, b, c, d] = P;
    const hidden = (p, id) => p.ev(`document.getElementById('${id}').classList.contains('hidden')`);
    const lobby = p => p.ev(`({ slot: BF.net.slot, in: BF.menu.inLobby, peers: BF.menu.peers, rows: [...document.querySelectorAll('#mp-players div')].map(e => e.textContent), empty: document.querySelectorAll('#mp-players .empty').length, startOff: document.getElementById('mp-start').disabled, status: document.getElementById('mp-status').textContent })`);
    const join = async (p, code, fac) => {
      await p.clickEl('#mode-tabs button[data-mode="mp"]');
      if (fac) await p.clickEl(`#factions .faction:nth-child(${fac})`);
      await p.ev(`document.getElementById('mp-code').value = ''`);
      await p.clickEl('#mp-code');
      await p.type(code.toLowerCase());
      await p.clickEl('#mp-join');
      await sleep(600);
    };

    // ---- lobi
    await a.clickEl('#mode-tabs button[data-mode="mp"]');
    await a.clickEl('#mp-create');
    await sleep(500);
    const code = await a.ev(`BF.net.code`);
    let la = await lobby(a);
    check('tuan rumah sendirian: 1 baris terisi + 3 kursi kosong, Mulai nonaktif', la.slot === 0 && la.rows.length === 4 && la.empty === 3 && la.startOff && la.rows[0].startsWith('Kamu (Biru)'), la);
    await join(b, code, 2);   // Bara
    await join(c, code, 3);   // Rimba
    la = await lobby(a);
    let lb = await lobby(b), lc = await lobby(c);
    check('dua tamu masuk slot 1 dan 2; semua saling melihat wangsa', lb.slot === 1 && lc.slot === 2 && la.peers[1] === 'bara' && la.peers[2] === 'rimba' && lb.peers[0] === 'samudra' && lb.peers[2] === 'rimba' && lc.peers[0] === 'samudra' && lc.peers[1] === 'bara', { a: la.peers, b: lb.peers, c: lc.peers });
    check('lobi tiga pemain: warna urut kursi, satu kursi kosong, tuan rumah boleh mulai', la.empty === 1 && !la.startOff && la.rows[1].startsWith('Lawan (Merah)') && la.rows[2].startsWith('Lawan (Kuning)') && lc.rows[2].startsWith('Kamu (Kuning)') && (await hidden(c, 'mp-start')), { a: la.rows, c: lc.rows });
    // tamu keluar dari lobi: ruangan tetap ada, kursinya kosong lagi
    await c.clickEl('#mp-leave');
    await sleep(500);
    la = await lobby(a); lb = await lobby(b);
    check('tamu keluar dari lobi: ruangan bertahan, kursinya kosong', la.in && lb.in && !(2 in la.peers) && !(2 in lb.peers) && la.empty === 2 && la.status.includes('keluar') && !(await c.ev(`BF.menu.inLobby`)), { a: la.peers, b: lb.peers });
    await join(c, code);
    await join(d, code, 4);   // Padang
    la = await lobby(a);
    const ld = await lobby(d);
    lc = await lobby(c);
    check('empat pemain di lobi: kursi penuh', lc.slot === 2 && ld.slot === 3 && la.empty === 0 && !la.startOff && Object.keys(ld.peers).length === 3 && ld.peers[2] === 'rimba', { a: la.peers, d: ld.peers });
    await a.shot('70-lobi-empat-pemain');
    const e = await page(base + '/');
    await join(e, code);
    check('pemain kelima ditolak: ruangan penuh', (await e.ev(`document.getElementById('mp-status').textContent`)).includes('penuh') && !(await e.ev(`BF.menu.inLobby`)));

    // ---- mulai
    await a.clickEl('#mp-start');
    await sleep(1500);
    const info = `({ run: BF.game.running, mp: BF.game.s.mp, human: BF.game.s.human, seed: BF.game.s.seed, n: BF.game.s.players.length, f: BF.game.s.players.map(q => q.faction).join(), ai: BF.game.s.players.some(q => q.isAI), pid: BF.net.pid })`;
    const g = [];
    for (const p of P) g.push(await p.ev(info));
    check('keempat pemain masuk permainan yang sama (seed, wangsa per kursi), tanpa AI', g.every((q, i) => q.run && q.mp && q.n === 4 && q.human === i && q.pid === i && q.seed === g[0].seed && q.f === 'samudra,bara,rimba,padang' && !q.ai), g);
    await join(e, code);
    check('bergabung setelah permainan dimulai ditolak', (await e.ev(`document.getElementById('mp-status').textContent`)).includes('dimulai') && !(await e.ev(`BF.menu.inLobby`)));
    for (const p of P) await p.ev(`(() => { window.__h = {}; const st = BF.step; BF.step = s => { st(s); if (s.tick % 20 === 0) window.__h[s.tick] = BF.hash(s); }; })()`);

    // ---- perintah dari tiap pemain, lalu bandingkan hash
    for (let i = 0; i < 4; i++) await P[i].ev(`(() => { const s = BF.game.s, th = s.buildings.find(q => q.owner === ${i}), w = s.units.filter(u => u.owner === ${i} && u.type === 'worker'), n = BF.findNode(s.map, th.tx, th.ty, BF.N_TREE, 20, s.map.region[BF.idx(th.tx, th.ty + 3)]); BF.issue({ c: 'gather', ids: w.map(u => u.id), nx: n.x, ny: n.y }); BF.issue({ c: 'train', bid: th.id, unit: 'worker' }); })()`);
    await sleep(7000);
    const same = async list => {
      const hs = [];
      for (const p of list) hs.push(await p.ev(`window.__h`));
      const common = Object.keys(hs[0]).filter(k => hs.every(h => k in h)), beda = common.filter(k => hs.some(h => h[k] !== hs[0][k]));
      return { dibandingkan: common.length, beda: beda.length };
    };
    let r = await same(P);
    const ticks = [];
    for (const p of P) ticks.push(await p.ev(`BF.game.s.tick`));
    check('empat simulasi berjalan bersama', ticks.every(t => t > 60) && Math.max(...ticks) - Math.min(...ticks) <= 12, ticks);
    check('hash state identik di keempat klien', r.dibandingkan >= 3 && r.beda === 0, r);
    check('perintah tiap pemain berlaku di semua klien', await d.ev(`(() => { const s = BF.game.s; return [0, 1, 2, 3].every(i => s.units.filter(u => u.owner === i && u.order.type === 'gather' && u.order.res === 'wood').length === 4 && s.players[i].res.food === 200); })()`), await d.ev(`BF.game.s.players.map(q => q.res.food)`));
    check('tidak ada desinkronisasi terdeteksi', (await Promise.all(P.map(p => p.ev(`!BF.net.desync`)))).every(Boolean));
    await c.shot('71-daring-empat-pemain');

    // ---- pemain keluar di tengah permainan: dianggap menyerah di semua klien yang tersisa, permainan lanjut
    await d.ev(`BF.menu.toStart()`);
    await sleep(2500);
    const rest = [a, b, c];
    const st = [];
    for (const p of rest) st.push(await p.ev(`(() => { const s = BF.game.s; return { out: s.players.map(q => +!!q.out).join(''), over: s.over, sisa: s.units.filter(u => u.owner === 3).length + s.buildings.filter(q => q.owner === 3).length, toast: document.getElementById('toast').textContent, tick: s.tick }; })()`));
    check('pemain keluar → dianggap menyerah: miliknya musnah di tiga klien lain, permainan lanjut', st.every(q => q.out === '0001' && !q.over && q.sisa === 0), st);
    check('klien lain diberi tahu', st.some(q => /Padang.*(keluar|menyerah)/.test(q.toast)), st.map(q => q.toast));
    for (const p of rest) await p.ev(`window.__h = {}`);
    const t0 = await a.ev(`BF.game.s.tick`);
    await sleep(4000);
    r = await same(rest);
    check('tiga klien tersisa tetap berjalan dan sinkron', (await a.ev(`BF.game.s.tick`)) > t0 + 40 && r.dibandingkan >= 2 && r.beda === 0, r);

    // ---- pemain tumbang (kehilangan semua bangunan): selesai di layarnya saja, dua lainnya lanjut
    await c.ev(`(() => { const s = BF.game.s; BF.issue({ c: 'destroy', ids: s.buildings.filter(q => q.owner === 2).map(q => q.id) }); })()`);
    await sleep(3000);
    const ec = await c.ev(`({ over: BF.game.s.over, shown: !document.getElementById('overlay-end').classList.contains('hidden'), title: document.getElementById('end-title').textContent, text: document.getElementById('end-text').textContent, cols: document.querySelectorAll('.end-table tr:first-child th').length, ws: !!BF.net.ws })`);
    check('pemain yang tumbang melihat Kekalahan (4 kolom) dan koneksinya ditutup', ec.over && ec.shown && ec.title === 'Kekalahan' && ec.text === 'Permukiman kita telah jatuh.' && ec.cols === 5 && !ec.ws, ec);
    const ab = [];
    for (const p of [a, b]) ab.push(await p.ev(`(() => { const s = BF.game.s; return { out: s.players.map(q => +!!q.out).join(''), over: s.over, tick: s.tick }; })()`));
    for (const p of [a, b]) await p.ev(`window.__h = {}`);
    await sleep(3500);
    r = await same([a, b]);
    check('dua pemain tersisa melanjutkan permainan, tetap sinkron', ab.every(q => q.out === '0011' && !q.over) && (await b.ev(`BF.game.s.tick`)) > ab[1].tick + 30 && r.dibandingkan >= 2 && r.beda === 0, { ab, r });

    // ---- pemain terakhir menyerah → pemenang
    await b.ev(`BF.issue({ c: 'resign' })`);
    await sleep(2000);
    const fin = p => p.ev(`({ over: BF.game.s.over, winner: BF.game.s.winner, title: document.getElementById('end-title').textContent, text: document.getElementById('end-text').textContent, hasil: [...document.querySelectorAll('.end-table tr:nth-child(2) td')].map(x => x.textContent).join('|') })`);
    const fa = await fin(a), fb = await fin(b);
    check('lawan terakhir menyerah → tuan rumah menang', fa.over && fa.winner === 0 && fa.title === 'Kemenangan!' && fa.hasil === 'Hasil|Menang|Tumbang|Tumbang|Tumbang', fa);
    check('yang menyerah melihat Kekalahan', fb.over && fb.winner === 0 && fb.title === 'Kekalahan' && fb.text === 'Kamu menyerah.', fb);
    await a.shot('72-daring-akhir');

    // ---- tamu keluar tepat saat tuan rumah menekan Mulai: tuan rumah belum tahu (kabar keluarnya terlambat 1,5 detik),
    //      tamu lain sudah tahu. Yang keluar tetap masuk daftar pemain, lalu dianggap menyerah — tidak ada yang menunggu.
    for (const p of [a, b, c]) { await p.ev(`BF.menu.toStart()`); await sleep(200); }
    await a.clickEl('#mode-tabs button[data-mode="mp"]');
    await a.clickEl('#mp-create');
    await sleep(500);
    const code2 = await a.ev(`BF.net.code`);
    await join(b, code2);
    await join(c, code2);
    await a.ev(`(() => { const ws = BF.net.ws, on = ws.onmessage; ws.onmessage = ev => { if (String(ev.data).includes('"left"')) setTimeout(() => on(ev), 1500); else on(ev); }; })()`);
    await c.ev(`BF.menu.toStart()`);
    await sleep(400);
    const pre = { a: await a.ev(`Object.keys(BF.menu.peers).join()`), b: await b.ev(`Object.keys(BF.menu.peers).join()`) };
    await a.clickEl('#mp-start');
    await sleep(4500);
    const race = [];
    for (const p of [a, b]) race.push(await p.ev(`(() => { const s = BF.game.s; return { run: BF.game.running, n: s.players.length, out: s.players.map(q => +!!q.out).join(''), tick: s.tick, over: s.over, wait: BF.net.waiting, hash: BF.hash(s) }; })()`));
    check('tamu keluar tepat saat Mulai: tuan rumah belum tahu, tamu lain sudah', pre.a === '1,2' && pre.b === '0', pre);
    check('permainan tetap berjalan (tidak menunggu yang keluar); ia dianggap menyerah di kedua klien', race.every(q => q.run && q.n === 3 && q.out === '001' && !q.over && q.tick > 30), race);
    for (const p of [a, b]) await p.ev(`(() => { window.__h = {}; if (!BF.step.__rekam) { const st = BF.step; BF.step = s => { st(s); if (s.tick % 20 === 0) window.__h[s.tick] = BF.hash(s); }; BF.step.__rekam = true; } })()`);
    await sleep(3000);
    r = await same([a, b]);
    check('kedua klien tetap sinkron sesudahnya', r.dibandingkan >= 2 && r.beda === 0 && (await a.ev(`!BF.net.desync`)) && (await b.ev(`!BF.net.desync`)), r);
    for (const p of P) check('tanpa galat halaman', p.errors.length === 0, p.errors.slice(0, 3));
  } finally { srv.kill(); }
};
