'use strict';
// Pemasangan sebagai aplikasi: manifest dan service worker disajikan, halaman dikendalikan service worker, dan setelah
// pernah dibuka game tetap bisa dimuat dan dimainkan lawan AI walau servernya mati (tanpa internet).
const { spawn } = require('child_process');
const http = require('http'), path = require('path');
const { sleep } = require('../cdp');

module.exports = async ({ blank, check, root }) => {
  const PORT = 9130 + (process.pid % 30), base = 'http://127.0.0.1:' + PORT;
  let srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1' }), stdio: 'ignore' });
  const get = p => new Promise((res, rej) => { http.get(base + p, r => { const cs = []; r.on('data', c => cs.push(c)); r.on('end', () => res({ status: r.statusCode, h: r.headers, body: Buffer.concat(cs).toString() })); }).on('error', rej); });
  try {
    await sleep(700);
    const man = await get('/manifest.webmanifest'), m = JSON.parse(man.body), sw = await get('/sw.js');
    check('manifest aplikasi disajikan: layar penuh, mendatar, tiga ikon (satu maskable)', man.status === 200 && /manifest\+json/.test(man.h['content-type']) && m.display === 'fullscreen' && m.orientation === 'landscape' && m.icons.length === 3 &&
      m.icons.some(i => i.purpose === 'maskable') && m.icons.every(i => /^assets\/ikon\/.+\.png$/.test(i.src)) && m.start_url === './', { status: man.status, type: man.h['content-type'] });
    check('service worker disajikan dari akar situs', sw.status === 200 && /javascript/.test(sw.h['content-type']) && sw.body.includes("addEventListener('fetch'"));
    check('berkas lain di akar tetap tidak disajikan', (await get('/server.js')).status === 404 && (await get('/DEPLOY.md')).status === 404 && (await get('/package.json')).status === 404);

    const p = await blank();
    const siap = async () => { for (let i = 0; i < 150 && !(await p.ev('!!(window.BF && BF.game && BF.game.ready)').catch(() => false)); i++) await sleep(100); return p.ev('!!(window.BF && BF.game && BF.game.ready)').catch(() => false); };
    await p.send('Page.navigate', { url: base + '/' });
    await siap();
    check('halaman menautkan manifest dan warna tema', await p.ev(`!!document.querySelector('link[rel="manifest"][href="manifest.webmanifest"]') && document.querySelector('meta[name="theme-color"]').content === '#2a2117'`));
    const aktif = await p.ev(`navigator.serviceWorker.ready.then(r => !!r.active)`);
    // pemuatan pertama terjadi sebelum service worker aktif; pemuatan kedua lewat service worker dan mengisi simpanan
    await p.send('Page.reload');
    await siap();
    await sleep(1500);
    const st = await p.ev(`(async () => { const c = await caches.open('benteng-fajar-v1'), keys = (await c.keys()).map(r => new URL(r.url).pathname); return { kendali: !!navigator.serviceWorker.controller, n: keys.length, index: keys.includes('/'), sim: keys.includes('/js/sim.js'), manifest: keys.includes('/assets/manifest.json'), model: keys.some(k => k.startsWith('/assets/m/')), tekstur: keys.some(k => k.startsWith('/assets/t/')), build: BF.BUILD }; })()`);
    check('service worker aktif dan mengendalikan halaman', aktif && st.kendali, st);
    check('berkas game tersimpan untuk luring (halaman, skrip, model, tekstur)', st.index && st.sim && st.manifest && st.model && st.tekstur && st.n > 60, st);

    // ---- tanpa internet: server dimatikan
    srv.kill();
    await sleep(600);
    let mati = false;
    try { await get('/'); } catch (e) { mati = true; }
    await p.send('Page.reload');
    const ok = await siap();
    check('server mati: halaman tetap termuat dari simpanan', mati && ok && await p.ev(`BF.BUILD === '${st.build}'`), { mati, ok });
    await p.ev(`document.getElementById('btn-start').click()`);
    for (let i = 0; i < 40 && !(await p.ev('BF.game.running')); i++) await sleep(100);
    await p.ev(`(() => { const s = BF.game.s; for (let i = 0; i < 20 * 60 * 3 && !s.over; i++) BF.step(s); })()`);
    await sleep(800);
    check('tanpa internet: permainan lawan AI berjalan (aset termuat, AI membangun)', await p.ev(`BF.game.running && BF.game.s.players[1].isAI && BF.game.s.buildings.filter(b => b.owner === 1).length >= 2 && BF.models.rigged('worker')`));
    await p.shot('95-luring');
    await p.clickEl('#btn-menu');
    await sleep(200);
    check('Menu menawarkan layar penuh', (await p.ev(`document.getElementById('m-full').textContent`)).startsWith('Layar penuh: ') && !(await p.ev(`document.getElementById('m-full').classList.contains('hidden')`)));
    check('tanpa galat halaman saat luring', p.errors.length === 0, p.errors.slice(0, 3));

    // ---- server hidup lagi dengan berkas yang sama: halaman memuat dari jaringan lagi
    srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1' }), stdio: 'ignore' });
    await sleep(800);
    await p.send('Page.reload');
    check('server hidup lagi: halaman termuat seperti biasa', (await siap()) && await p.ev(`BF.BUILD === '${st.build}'`));
  } finally { srv.kill(); }
};
