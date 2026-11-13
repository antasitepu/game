'use strict';
// Server sebagai layanan publik: penyajian file (versi, cache, kompresi, kepala keamanan), pemeriksaan asal WebSocket,
// kecocokan versi klien, pembatasan (tebak kode, ruangan & koneksi per alamat), koneksi/ruangan menganggur, pemain
// macet, dan berhenti dengan rapi. Klien WebSocket di sini dijalankan langsung dari Node (bukan peramban), kecuali
// pemeriksaan kebijakan keamanan isi (CSP) yang memakai halaman sungguhan.
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { sleep } = require('../cdp');

module.exports = async ({ page, check, root }) => {
  const PORT = 8990 + (process.pid % 9), host = '127.0.0.1:' + PORT, base = 'http://' + host;
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', STALL_MS: '1500', IDLE_MS: '2500', LOBBY_MS: '4000', ROOMS_PER_IP_PER_MIN: '3', MAX_CONN_PER_IP: '8' });
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env, stdio: 'ignore' });
  const get = (p, headers) => new Promise((res, rej) => { http.get(base + p, { headers: headers || {} }, r => { const cs = []; r.on('data', c => cs.push(c)); r.on('end', () => res({ status: r.statusCode, h: r.headers, body: Buffer.concat(cs) })); }).on('error', rej); });
  // jabat tangan WebSocket mentah (untuk mengatur kepala Origin): true bila server menjawab 101
  const upgrade = headers => new Promise(res => {
    const req = http.request(base + '/ws', { headers: Object.assign({ Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64') }, headers || {}) });
    req.on('upgrade', (r, sock) => { sock.destroy(); res(true); });
    req.on('response', () => res(false));
    req.on('error', () => res(false));
    req.end();
  });
  const open = () => new Promise(res => {
    const ws = new WebSocket('ws://' + host + '/ws'), c = { ws, msgs: [], send: o => ws.send(JSON.stringify(o)), close: () => { try { ws.close(); } catch (e) { /* sudah tertutup */ } }, get closed() { return ws.readyState >= 2; } };
    ws.addEventListener('message', e => c.msgs.push(JSON.parse(e.data)));
    ws.addEventListener('open', () => res(c));
    ws.addEventListener('error', () => res(null));
  });
  const last = (c, t) => c.msgs.filter(m => m.t === t).pop();
  try {
    await sleep(700);

    // ---- penyajian file
    const hz = await get('/healthz'), info = JSON.parse(hz.body.toString());
    check('/healthz menjawab keadaan server tanpa data pemain', hz.status === 200 && info.ok === true && /^[0-9a-f]{12}$/.test(info.build) && info.rooms === 0 && typeof info.conns === 'number' && Object.keys(info).sort().join() === 'build,conns,ok,rooms', info);
    const idx = await get('/'), html = idx.body.toString();
    const meta = /<meta name="bf-build" content="([0-9a-f]{12})">/.exec(html);
    check('index.html membawa versi permainan yang sama dengan server', !!meta && meta[1] === info.build, meta && meta[1]);
    check('kepala keamanan: CSP tanpa skrip sebaris, nosniff, tanpa bingkai, tanpa perujuk', /script-src 'self';/.test(idx.h['content-security-policy'] || '') && !/script-src[^;]*unsafe/.test(idx.h['content-security-policy']) && /frame-ancestors 'none'/.test(idx.h['content-security-policy']) &&
      idx.h['x-content-type-options'] === 'nosniff' && idx.h['x-frame-options'] === 'DENY' && idx.h['referrer-policy'] === 'no-referrer', idx.h['content-security-policy']);
    const js = await get('/js/sim.js'), jsz = await get('/js/sim.js', { 'Accept-Encoding': 'gzip' });
    check('kompresi gzip untuk klien yang mendukung, isi sama', js.h['content-encoding'] === undefined && jsz.h['content-encoding'] === 'gzip' && jsz.body.length < js.body.length * 0.5 && zlib.gunzipSync(jsz.body).equals(js.body), { asli: js.body.length, gzip: jsz.body.length });
    const not = await get('/js/sim.js', { 'If-None-Match': js.h.etag }), jpg = await get('/assets/' + JSON.parse((await get('/assets/manifest.json')).body.toString()).tekstur.rumput.file, { 'Accept-Encoding': 'gzip' });
    check('ETag: file yang belum berubah dijawab 304 tanpa isi', !!js.h.etag && js.h.etag === jsz.h.etag && not.status === 304 && not.body.length === 0 && js.h['cache-control'] === 'no-cache');
    check('gambar (JPG/WebP) tidak dikompresi ulang', jpg.status === 200 && jpg.h['content-encoding'] === undefined && !!jpg.h.etag);

    // ---- asal (Origin) WebSocket
    check('WebSocket: halaman dari host yang sama diterima', await upgrade({ Origin: base }));
    check('WebSocket: situs lain ditolak', !(await upgrade({ Origin: 'https://situs-lain.example' })) && !(await upgrade({ Origin: 'bukan-url' })));
    check('WebSocket: klien tanpa Origin (bukan peramban) diterima', await upgrade({}));

    // ---- versi klien & kode ruangan
    const a = await open(), b = await open();
    a.send({ t: 'create', v: 'versi-A' });
    await sleep(200);
    const code = (last(a, 'room') || {}).code;
    check('kode ruangan 5 karakter', /^[A-Z0-9]{5}$/.test(code || ''), code);
    b.send({ t: 'join', code, v: 'versi-B' });
    await sleep(200);
    check('versi berbeda ditolak dengan pesan yang jelas', !last(b, 'joined') && /Versi permainan berbeda/.test((last(b, 'error') || {}).m || ''), last(b, 'error'));
    b.send({ t: 'join', code, v: 'versi-A' });
    await sleep(200);
    check('versi sama diterima', (last(b, 'joined') || {}).slot === 1 && (last(a, 'peer') || {}).slot === 1);
    a.close(); b.close();

    // ---- menebak kode ruangan dibatasi
    const g = await open();
    for (let i = 0; i < 6; i++) g.send({ t: 'join', code: 'ZZZZ' + i, v: 'x' });
    await sleep(500);
    check('enam tebakan kode yang salah → koneksi diputus', g.closed && /Terlalu banyak percobaan/.test((last(g, 'error') || {}).m || '') && g.msgs.filter(m => m.t === 'error').length === 6, g.msgs.length);

    // ---- pemain macet: semua menunggu paket seorang pemain → yang tertinggal diputus, yang lain diberi tahu
    const p0 = await open(), p1 = await open(), p2 = await open();
    p0.send({ t: 'create', v: 'v' });
    await sleep(150);
    const c2 = last(p0, 'room').code;
    p1.send({ t: 'join', code: c2, v: 'v' }); await sleep(100);
    p2.send({ t: 'join', code: c2, v: 'v' }); await sleep(100);
    p0.send({ t: 'lock' });
    for (let n = 2; n <= 5; n++) { p0.send({ t: 'msg', d: { k: 't', n, c: [] } }); p2.send({ t: 'msg', d: { k: 't', n, c: [] } }); if (n <= 3) p1.send({ t: 'msg', d: { k: 't', n, c: [] } }); }
    await sleep(600);
    check('paket diteruskan ke semua klien lain dengan slot pengirim', p1.msgs.filter(m => m.t === 'msg' && m.from === 0).length === 4 && p1.msgs.filter(m => m.t === 'msg' && m.from === 2).length === 4 && p0.msgs.filter(m => m.t === 'msg' && m.from === 1).length === 2);
    check('belum melewati batas waktu: belum ada yang diputus', !p1.closed && !last(p0, 'left'));
    await sleep(2600);
    check('pemain yang tertinggal diputus; yang lain tetap tersambung dan diberi tahu slotnya', p1.closed && !p0.closed && !p2.closed && (last(p0, 'left') || {}).slot === 1 && (last(p2, 'left') || {}).slot === 1, { p0: last(p0, 'left'), p2: last(p2, 'left') });
    await sleep(2200);
    check('dua pemain yang sama-sama menunggu (giliran sama) tidak diputus', !p0.closed && !p2.closed);
    const late = await open();
    late.send({ t: 'join', code: c2, v: 'v' });
    await sleep(200);
    check('ruangan yang sudah dimulai tetap terkunci walau ada kursi kosong', !last(late, 'joined') && !!last(late, 'error'));
    p0.close(); p2.close(); late.close();

    // ---- koneksi tanpa ruangan & ruangan lobi yang menganggur
    const idle = await open(), lob = await open();
    lob.send({ t: 'create', v: 'v' });
    await sleep(3300);
    check('koneksi yang tidak masuk ruangan diputus', idle.closed && !lob.closed);
    await sleep(2200);
    check('ruangan lobi yang terlalu lama menunggu ditutup', lob.closed && /terlalu lama/.test((last(lob, 'error') || {}).m || ''), last(lob, 'error'));

    // ---- batas per alamat
    const r4 = await open();
    r4.send({ t: 'create', v: 'v' });
    await sleep(200);
    check('ruangan keempat dalam semenit dari alamat yang sama ditolak', !last(r4, 'room') && /Terlalu banyak ruangan/.test((last(r4, 'error') || {}).m || ''), last(r4, 'error'));
    r4.close();
    await sleep(200);
    const many = [];
    for (let i = 0; i < 10; i++) many.push(await open());
    check('koneksi serentak per alamat dibatasi (8)', many.filter(Boolean).length === 8, many.filter(Boolean).length);
    for (const c of many) if (c) c.close();
    await sleep(300);
    check('setelah ditutup, alamat itu bisa tersambung lagi', (JSON.parse((await get('/healthz')).body.toString())).conns === 0 && !!(await open().then(c => { if (c) c.close(); return c; })));

    // ---- halaman sungguhan: tidak ada pelanggaran CSP saat memuat dan bermain
    const p = await page('about:blank');
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ← ' + e.blockedURI));` });
    await p.send('Page.navigate', { url: base + '/' });
    for (let i = 0; i < 100 && !(await p.ev('!!(window.BF && BF.game && BF.game.ready)').catch(() => false)); i++) await sleep(100);
    check('halaman memuat permainan di bawah CSP', await p.ev(`BF.game.ready === true && BF.BUILD === '${info.build}'`), await p.ev(`BF.BUILD`).catch(() => null));
    await p.clickEl('#btn-start');
    await sleep(600);
    await p.ev(`(() => { const s = BF.game.s; s.fog.explored.fill(1); for (let i = 0; i < 20 * 60 * 6 && !s.over; i++) BF.step(s); })()`);
    await sleep(1500);
    await p.key('h', 'KeyH', 72);
    await sleep(300);
    await p.clickEl('#btn-menu');
    await sleep(300);
    check('tidak ada pelanggaran CSP saat memuat aset, bermain, dan membuka menu', (await p.ev(`window.__csp`)).length === 0 && p.errors.length === 0, { csp: await p.ev(`window.__csp.slice(0, 4)`), galat: p.errors.slice(0, 3) });

    // ---- berhenti dengan rapi
    const still = await open(), t0 = Date.now();
    const exit = new Promise(res => srv.once('exit', code => res(code)));
    srv.kill('SIGTERM');
    const codeExit = await Promise.race([exit, sleep(3000).then(() => 'macet')]);
    await sleep(200);
    check('SIGTERM: server berhenti dengan rapi dan menutup koneksi', codeExit === 0 && Date.now() - t0 < 2500 && still.closed, { codeExit, ms: Date.now() - t0 });
  } finally { srv.kill(); }
};
