'use strict';
// Sambung ulang di permainan daring (tiga klien): koneksi putus sebentar, putus beberapa detik (pemain lain menunggu),
// sambungan menggantung yang hanya terdeteksi lewat tanda hidup, masa tunggu habis (dianggap menyerah), dan keluar
// dengan sengaja (tidak ditunggu). Sesudah tiap gangguan, hash state semua klien yang tersisa harus tetap identik.
const { spawn } = require('child_process');
const path = require('path');
const { sleep } = require('../cdp');

module.exports = async ({ page, check, root }) => {
  const PORT = 9060 + (process.pid % 30), base = 'http://127.0.0.1:' + PORT, GRACE = 9000;
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', RECONNECT_MS: String(GRACE), LIVE_MS: '60000' }), stdio: 'ignore' });
  try {
    await sleep(700);
    const a = await page(base + '/'), b = await page(base + '/'), c = await page(base + '/'), P = [a, b, c];
    await a.clickEl('#mode-tabs button[data-mode="mp"]');
    await a.clickEl('#mp-create');
    await sleep(500);
    const code = await a.ev(`BF.net.code`);
    for (const p of [b, c]) { await p.clickEl('#mode-tabs button[data-mode="mp"]'); await p.clickEl('#mp-code'); await p.type(code.toLowerCase()); await p.clickEl('#mp-join'); await sleep(600); }
    await a.clickEl('#mp-start');
    await sleep(1500);
    for (const p of P) await p.ev(`(() => { window.__h = {}; const st = BF.step; BF.step = s => { st(s); if (s.tick % 20 === 0) window.__h[s.tick] = BF.hash(s); }; })()`);
    const st = p => p.ev(`(() => { const s = BF.game.s, n = BF.net; return { tick: s.tick, out: s.players.map(q => +!!q.out).join(''), over: s.over, lost: !!n.lost, wait: n.waiting, away: n.away.map(t => +(t > 0)).join(''), desync: n.desync, banner: document.getElementById('net-wait').classList.contains('hidden') ? '' : document.getElementById('net-wait').textContent, toast: document.getElementById('toast').textContent }; })()`);
    // hash di tick yang sama harus identik pada semua klien dalam daftar (dihitung dari saat rekaman dikosongkan)
    const sinkron = async list => { for (const p of list) await p.ev(`window.__h = {}`); await sleep(3200); const hs = []; for (const p of list) hs.push(await p.ev(`window.__h`)); const common = Object.keys(hs[0]).filter(k => hs.every(h => k in h)); return { dibandingkan: common.length, beda: common.filter(k => hs.some(h => h[k] !== hs[0][k])).length }; };
    check('tiga pemain mulai bermain; tiap klien memegang kunci kursinya', (await Promise.all(P.map(p => p.ev(`BF.game.running && BF.game.s.players.length === 3 && /^[0-9a-f]{32}$/.test(BF.net.key)`)))).every(Boolean) && new Set(await Promise.all(P.map(p => p.ev(`BF.net.key`)))).size === 3);

    // ---- A. putus sebentar: klien menyambung ulang sendiri, tidak ada yang dianggap keluar
    await b.ev(`BF.net.ws.close()`);
    await sleep(200);
    const b0 = await st(b);
    await sleep(2500);
    let sa = await st(a), sb = await st(b), sc = await st(c);
    check('koneksi putus → klien langsung mencoba menyambung ulang', b0.lost || /Tersambung lagi/.test(sb.toast), { b0: { lost: b0.lost, toast: b0.toast }, toast: sb.toast });
    check('tersambung lagi dalam beberapa detik: tidak ada yang dianggap keluar', !sb.lost && [sa, sb, sc].every(q => q.out === '000' && !q.over && !q.desync && q.away === '000'), { a: sa.out, b: sb, c: sc.out });
    let r = await sinkron(P);
    check('sesudah sambung ulang ketiga klien tetap berjalan dan sinkron', r.dibandingkan >= 2 && r.beda === 0, r);

    // ---- B. putus beberapa detik: yang lain menunggu dengan keterangan, lalu lanjut
    await c.ev(`(() => { window.__addr = BF.net.addr; BF.net.addr = '127.0.0.1:1'; BF.net.ws.close(); })()`);
    await sleep(1800);
    sa = await st(a); sc = await st(c);
    const t1 = sa.tick;
    await sleep(700);
    const sa2 = await st(a);
    check('selama terputus: pemain lain berhenti menunggu, dengan nama dan sisa waktu', sa.wait && sa.away === '001' && /Menunggu .* tersambung lagi… \(\d+ dtk\)/.test(sa.banner) && sa2.tick - t1 <= 2, { banner: sa.banner, maju: sa2.tick - t1 });
    check('yang terputus melihat keterangan menyambung ulang', sc.lost && /menyambung ulang/.test(sc.banner), sc.banner);
    await c.ev(`BF.net.addr = window.__addr`);
    await sleep(3500);
    sa = await st(a); sb = await st(b); sc = await st(c);
    check('tersambung lagi sebelum masa tunggu habis: permainan lanjut, tidak ada yang keluar', !sc.lost && [sa, sb, sc].every(q => q.out === '000' && !q.over && q.away === '000' && !q.banner) && sa.tick > t1 + 20, { a: sa, c: sc });
    r = await sinkron(P);
    check('paket yang terlewat dikirim ulang: ketiga klien tetap sinkron', r.dibandingkan >= 2 && r.beda === 0 && !(await a.ev(`BF.net.desync`)), r);

    // ---- C. sambungan menggantung (tidak tertutup, tapi tak ada data lewat): terdeteksi lewat tanda hidup
    await b.ev(`(() => { const ws = BF.net.ws; window.__kirim = 0; ws.send = () => { window.__kirim++; }; ws.onmessage = () => {}; })()`);
    await sleep(3000);
    check('sambungan menggantung: yang lain menunggu, klien itu belum sadar', (await st(a)).wait && !(await st(b)).lost);
    let pulih = false;
    for (let i = 0; i < 24 && !pulih; i++) { await sleep(500); const q = await st(b); pulih = !q.lost && /Tersambung lagi/.test(q.toast); }
    sa = await st(a); sb = await st(b);
    check('tanpa jawaban atas tanda hidup → klien menutup sambungan itu dan menyambung ulang', pulih && sa.out === '000' && sb.out === '000', { toast: sb.toast, lost: sb.lost });
    r = await sinkron(P);
    check('sesudah sambungan menggantung dipulihkan: tetap sinkron', r.dibandingkan >= 2 && r.beda === 0, r);

    // ---- D. masa tunggu habis: dianggap menyerah di klien lain; yang terputus diberi tahu tidak bisa kembali
    await c.ev(`(() => { BF.net.addr = '127.0.0.1:1'; BF.net.ws.close(); })()`);
    await sleep(GRACE + 3500);
    sa = await st(a); sb = await st(b);
    check('masa tunggu habis → pemain itu dianggap menyerah, dua lainnya lanjut', sa.out === '001' && sb.out === '001' && !sa.over && !sb.over && sa.away === '000', { a: sa, b: sb });
    r = await sinkron([a, b]);
    check('dua klien tersisa tetap sinkron', r.dibandingkan >= 2 && r.beda === 0, r);
    await c.ev(`BF.net.addr = window.__addr`);
    await sleep(4000);
    const ec = await c.ev(`({ over: BF.game.s.over, shown: !document.getElementById('overlay-end').classList.contains('hidden'), title: document.getElementById('end-title').textContent, text: document.getElementById('end-text').textContent, aktif: BF.net.active })`);
    check('yang terlambat kembali ditolak: permainannya berakhir dengan keterangan koneksi', ec.over && ec.shown && ec.text.includes('Koneksi ke server terputus') && !ec.aktif, ec);

    // ---- E. keluar dengan sengaja: tidak ditunggu
    const t0 = Date.now();
    await b.ev(`BF.menu.toStart()`);
    let menang = null;
    for (let i = 0; i < 12 && !menang; i++) { await sleep(300); const q = await a.ev(`({ over: BF.game.s.over, winner: BF.game.s.winner, title: document.getElementById('end-title').textContent, text: document.getElementById('end-text').textContent })`); if (q.over) menang = q; }
    check('keluar dengan sengaja langsung dianggap menyerah (tanpa masa tunggu)', !!menang && menang.winner === 0 && menang.title === 'Kemenangan!' && menang.text.includes('Lawan keluar') && Date.now() - t0 < 4000, { menang, ms: Date.now() - t0 });
    for (const p of P) check('tanpa galat halaman', p.errors.filter(e => !/WebSocket connection to 'ws:\/\/127\.0\.0\.1:1\//.test(e)).length === 0, p.errors.slice(0, 3));
  } finally { srv.kill(); }
};
